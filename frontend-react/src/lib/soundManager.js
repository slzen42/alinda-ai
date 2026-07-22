/**
 * src/lib/soundManager.js
 *
 * The acoustic environment manager for Alinda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL AUDIO PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Standard web apps use sound for alerts — a notification ping that triggers
 * the sympathetic nervous system's orienting response. In a therapy context,
 * orienting responses interrupt emotional processing. Every sound in Alinda
 * must do the opposite: deepen presence rather than interrupt it.
 *
 * Three principles govern every audio decision here:
 *
 * SLOW ATTACK, LONG DECAY:
 *   High-attack sounds (sharp clicks, bright pings) cause a physical flinch
 *   response. All default sounds use slow attack times (50–150ms) so they
 *   swell rather than strike. Decays extend naturally rather than cutting off,
 *   fading into the room's ambient texture.
 *
 * SOMATIC ANCHORING:
 *   Low frequencies (below 200Hz) are processed in the body — the chest
 *   and gut — rather than in the analytical cortex. Phase transition sounds
 *   use low-frequency content specifically to ground the user physically
 *   before a cognitive shift. High-frequency content is used sparingly and
 *   only at low amplitude.
 *
 * PRESENCE OVER VOLUME:
 *   All sounds operate at volumes that feel like the room's own texture,
 *   not like an application notifying you. The default volume ceiling for
 *   event sounds is 0.35 (35% of maximum). Ambient loops are even lower:
 *   0.18 to 0.25. The user should feel the sounds more than hear them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE UNLOCK RITUAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Browsers block audio from playing without prior user interaction.
 * This is enforced at the operating system level on iOS and at the
 * browser policy level on Chrome/Android. The unlock() method must be
 * called in response to a genuine user gesture — a tap, a click —
 * before any audio can play.
 *
 * In Alinda, the unlock is triggered by the "Start Session" or "Enter Room"
 * button tap — the user's first deliberate interaction with the application.
 * After this, the AudioContext remains unlocked for the session's duration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIO FILE REQUIREMENTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Default sounds (public/sounds/default/):
 *   join.mp3           — soft singing bowl strike, ~1.2s total, slow attack
 *   intake-complete.mp3 — two-tone soft chime, ascending, ~1.5s
 *   message-arrive.mp3  — single soft piano key, felted, ~0.8s
 *   mode-shift.mp3      — low cello harmonic, ~2s, almost sub-bass
 *   breakthrough.mp3    — ascending crystalline chime, ~2.5s
 *   session-end.mp3     — slow gong fade, ~3s
 *   phase-arrival.mp3   — barely audible breath/presence sound, ~1s
 *
 * Ambient loops (public/sounds/ambient/):
 *   ocean.mp3   — ocean waves, seamlessly looping, 30–60s source
 *   rain.mp3    — gentle indoor rain, seamlessly looping
 *   wind.mp3    — soft wind through leaves, seamlessly looping
 *   forest.mp3  — forest ambience, birds, insects, seamlessly looping
 *
 * ALL files should be exported at MP3 128kbps. Normalize all default
 * sounds to -12dB LUFS (use Audacity: Effect → Normalize → -12dB).
 * This ensures consistent perceived volume across sounds sourced from
 * different places. Ambient loops should be normalized to -18dB LUFS
 * (quieter baseline since they run continuously).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module exports a singleton SoundManager instance.
 * Components import { soundManager } and call methods directly.
 * No React state. No subscriptions. Pure imperative audio control.
 *
 * The graph for each played sound:
 *   AudioBufferSourceNode → GainNode (per-sound envelope) → PannerNode
 *     → GainNode (master volume) → AudioContext.destination
 *
 * The graph for ambient loops:
 *   AudioBufferSourceNode (loop=true) → GainNode (loop volume/fade)
 *     → PannerNode (slow drift) → GainNode (master volume)
 *     → AudioContext.destination
 */


// ─────────────────────────────────────────────────────────────────────────────
// SOUND FILE MANIFEST
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SOUNDS = {
    join:           '/sounds/default/join.mp3',
    intakeComplete: '/sounds/default/intake-complete.mp3',
    messageArrive:  '/sounds/default/message-arrive.mp3',
    modeShift:      '/sounds/default/mode-shift.mp3',
    breakthrough:   '/sounds/default/breakthrough.mp3',
    sessionEnd:     '/sounds/default/session-end.mp3',
    phaseArrival:   '/sounds/default/phase-arrival.mp3',
  }
  
  const AMBIENT_LOOPS = {
    ocean:  '/sounds/ambient/ocean.mp3',
    rain:   '/sounds/ambient/rain.mp3',
    wind:   '/sounds/ambient/wind.mp3',
    forest: '/sounds/ambient/forest.mp3',
  }
  
  // Volume ceilings — therapeutic restraint encoded as constants
  const VOLUME = Object.freeze({
    EVENT_MAX:      0.35,   // default sounds never exceed this
    AMBIENT_MAX:    0.22,   // ambient loops, at full volume
    AMBIENT_INTRO:  0.00,   // loops always start silent and fade in
    BREAKTHROUGH:   0.45,   // the one event that can be slightly louder
    PHASE_ARRIVAL:  0.12,   // barely there — a subliminal presence
    MASTER_DEFAULT: 0.80,   // master volume, leaving headroom
  })
  
  // Timing constants (seconds, using AudioContext clock)
  const TIMING = Object.freeze({
    EVENT_ATTACK:   0.08,   // 80ms — swell, not strike
    EVENT_DECAY:    0.60,   // 600ms sustain before natural decay of the sample
    FADE_IN_SHORT:  0.80,   // ambient fade in: short (after unlock)
    FADE_IN_LONG:   3.00,   // ambient fade in: long (session start)
    FADE_OUT_SHORT: 1.50,   // ambient fade out: quick (state changes)
    FADE_OUT_LONG:  4.00,   // ambient fade out: session end
    PANNER_DRIFT:   8.00,   // seconds for panner to drift left→right→left
  })
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SOUND MANAGER CLASS
  // ─────────────────────────────────────────────────────────────────────────────
  
  class SoundManager {
    constructor() {
      // Web Audio API context — created lazily on first unlock()
      this._ctx             = null
      this._masterGain      = null
      this._isUnlocked      = false
      this._isMuted         = false
  
      // Preloaded audio buffers
      this._buffers         = new Map()   // key → AudioBuffer
      this._loadingPromises = new Map()   // key → Promise (prevents duplicate fetches)
  
      // Active ambient loop state
      this._activeLoop      = null        // { key, source, gainNode, pannerNode, driftInterval }
  
      // Whether default event sounds are enabled
      // (separate from mute — the user can disable events but keep ambient)
      this._eventsEnabled   = true
  
      // Spatial panning drift state for ambient
      this._pannerDriftDir  = 1           // 1 = moving right, -1 = moving left
      this._pannerDriftTimer = null
  
      // Preload queue — populated by preloadForSession()
      this._preloadQueue    = []
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Creates the AudioContext and master gain node.
     * Must be called in response to a user gesture (tap/click) to satisfy
     * browser autoplay policy. Safe to call multiple times — no-ops after first.
     *
     * Called by: RoomEntryScreen.jsx when the user taps "Start Session".
     */
    unlock() {
      if (this._isUnlocked) return
  
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (!AudioCtx) {
          console.warn('[soundManager] Web Audio API not available on this device.')
          return
        }
  
        this._ctx = new AudioCtx()
  
        // Master gain — sits at the end of the chain, controls overall volume
        this._masterGain = this._ctx.createGain()
        this._masterGain.gain.setValueAtTime(VOLUME.MASTER_DEFAULT, this._ctx.currentTime)
        this._masterGain.connect(this._ctx.destination)
  
        // Some browsers create the context in a suspended state even after a
        // user gesture. Explicitly resume it.
        if (this._ctx.state === 'suspended') {
          this._ctx.resume()
        }
  
        this._isUnlocked = true
  
        // Apply current mute state (may have been set before unlock)
        if (this._isMuted) {
          this._masterGain.gain.setValueAtTime(0, this._ctx.currentTime)
        }
  
      } catch (err) {
        console.error('[soundManager] Failed to create AudioContext:', err)
      }
    }
  
    /**
     * Returns true if the audio system is ready to play sounds.
     * Components can check this before calling play methods.
     */
    get ready() {
      return this._isUnlocked && this._ctx !== null && this._ctx.state !== 'closed'
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // PRELOADING
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Preloads a single audio file into memory as a decoded AudioBuffer.
     * Idempotent — subsequent calls for the same key return the cached buffer.
     *
     * @param {string} key — one of the keys in DEFAULT_SOUNDS or AMBIENT_LOOPS
     * @param {string} url — the file path
     * @returns {Promise<AudioBuffer | null>}
     */
    async _preload(key, url) {
      if (this._buffers.has(key)) return this._buffers.get(key)
      if (this._loadingPromises.has(key)) return this._loadingPromises.get(key)
  
      const promise = (async () => {
        try {
          const response = await fetch(url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const arrayBuffer = await response.arrayBuffer()
  
          // decodeAudioData requires an active AudioContext.
          // If called before unlock(), we need to create a temporary context
          // just for decoding. We store the decoded buffer and discard the context.
          const ctx = this._ctx ?? new (window.AudioContext || window.webkitAudioContext)()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  
          this._buffers.set(key, audioBuffer)
          return audioBuffer
        } catch (err) {
          console.warn(`[soundManager] Failed to preload '${key}' (${url}):`, err)
          return null
        } finally {
          this._loadingPromises.delete(key)
        }
      })()
  
      this._loadingPromises.set(key, promise)
      return promise
    }
  
    /**
     * Preloads all default event sounds immediately.
     * Called during the intake screen (user is filling forms — good time to load).
     * Non-blocking — returns a promise but callers don't need to await it.
     * If files are missing, logs a warning and continues gracefully.
     *
     * @returns {Promise<void>}
     */
    async preloadDefaults() {
      const promises = Object.entries(DEFAULT_SOUNDS).map(
        ([key, url]) => this._preload(key, url)
      )
      await Promise.allSettled(promises)
    }
  
    /**
     * Preloads a specific ambient loop by key.
     * Called when the user selects their ambient preference on the intake screen,
     * so the loop is ready immediately when cooldown/waiting begins.
     *
     * @param {'ocean' | 'rain' | 'wind' | 'forest'} loopKey
     * @returns {Promise<void>}
     */
    async preloadAmbient(loopKey) {
      const url = AMBIENT_LOOPS[loopKey]
      if (!url) {
        console.warn(`[soundManager] Unknown ambient key: '${loopKey}'`)
        return
      }
      await this._preload(loopKey, url)
    }
  
    /**
     * Convenience method — preloads everything.
     * Use only when bandwidth is not a concern (WiFi, desktop).
     * On mobile, prefer preloadDefaults() + preloadAmbient(userChoice).
     *
     * @returns {Promise<void>}
     */
    async preloadAll() {
      const all = [
        ...Object.entries(DEFAULT_SOUNDS),
        ...Object.entries(AMBIENT_LOOPS),
      ]
      await Promise.allSettled(all.map(([key, url]) => this._preload(key, url)))
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL AUDIO GRAPH CONSTRUCTION
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Creates a complete audio graph for a one-shot sound event:
     *   source → gainNode → pannerNode → masterGain → destination
     *
     * @param {AudioBuffer} buffer
     * @param {Object} options
     * @param {number} options.volume      — peak volume (0–1)
     * @param {number} options.pan         — stereo pan (-1 left, 0 center, +1 right)
     * @param {number} options.attackTime  — seconds to reach peak volume
     * @returns {{ source, gainNode }}
     */
    _buildEventGraph(buffer, { volume = VOLUME.EVENT_MAX, pan = 0, attackTime = TIMING.EVENT_ATTACK }) {
      const ctx  = this._ctx
      const now  = ctx.currentTime
  
      const source   = ctx.createBufferSource()
      source.buffer  = buffer
  
      const gainNode = ctx.createGain()
      gainNode.gain.setValueAtTime(0, now)
      gainNode.gain.linearRampToValueAtTime(volume, now + attackTime)
      // Natural decay handled by the sample's own envelope
  
      const panner = ctx.createStereoPanner()
      panner.pan.setValueAtTime(pan, now)
  
      source.connect(gainNode)
      gainNode.connect(panner)
      panner.connect(this._masterGain)
  
      return { source, gainNode }
    }
  
    /**
     * Creates an audio graph for a looping ambient sound:
     *   source (loop) → gainNode (fades) → pannerNode (drifts) → masterGain
     *
     * @param {AudioBuffer} buffer
     * @returns {{ source, gainNode, pannerNode }}
     */
    _buildLoopGraph(buffer) {
      const ctx = this._ctx
  
      const source      = ctx.createBufferSource()
      source.buffer     = buffer
      source.loop       = true
  
      const gainNode    = ctx.createGain()
      gainNode.gain.setValueAtTime(VOLUME.AMBIENT_INTRO, ctx.currentTime)
  
      const pannerNode  = ctx.createStereoPanner()
      pannerNode.pan.setValueAtTime(0, ctx.currentTime)
  
      source.connect(gainNode)
      gainNode.connect(pannerNode)
      pannerNode.connect(this._masterGain)
  
      return { source, gainNode, pannerNode }
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // EVENT SOUNDS
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Core play method for one-shot events.
     * Silently no-ops if unlocked is false, muted, events disabled, or
     * the buffer hasn't been preloaded yet.
     *
     * @param {string} key — key from DEFAULT_SOUNDS
     * @param {Object} options
     * @param {number} [options.volume]
     * @param {number} [options.pan]    — stereo position (-1 to +1)
     * @param {number} [options.delay]  — seconds before playing (AudioContext time)
     */
    _playEvent(key, { volume = VOLUME.EVENT_MAX, pan = 0, delay = 0 } = {}) {
      if (!this.ready || this._isMuted || !this._eventsEnabled) return
  
      const buffer = this._buffers.get(key)
      if (!buffer) {
        // Not preloaded yet — attempt to preload for next time, skip this play
        const url = DEFAULT_SOUNDS[key]
        if (url) this._preload(key, url)
        return
      }
  
      const { source } = this._buildEventGraph(buffer, { volume, pan })
      source.start(this._ctx.currentTime + delay)
    }
  
    /** Partner joined the room — centered, welcoming, unhurried */
    playJoin()           { this._playEvent('join',           { volume: 0.30, pan: 0 }) }
  
    /** Both intakes complete — slightly more present, signals transition */
    playIntakeComplete() { this._playEvent('intakeComplete', { volume: 0.32, pan: 0 }) }
  
    /**
     * New message arrived — very subtle, almost subliminal.
     * Panned very slightly right (Alinda's messages) or left (partner's),
     * creating a subtle spatial map of who is speaking.
     *
     * @param {'alinda' | 'partner' | 'self'} sender
     */
    playMessageArrive(sender = 'alinda') {
      const pan = sender === 'alinda' ? 0 : sender === 'partner' ? -0.2 : 0.2
      this._playEvent('messageArrive', { volume: 0.22, pan })
    }
  
    /**
     * FSM mode shift — cooldown, pause, safety state entry.
     * Low frequency content grounds the body before the visual shift.
     */
    playModeShift()      { this._playEvent('modeShift',    { volume: 0.28, pan: 0 }) }
  
    /**
     * Breakthrough moment — the one event that can be slightly louder.
     * Still restrained, but present enough to mark the moment.
     */
    playBreakthrough()   { this._playEvent('breakthrough', { volume: VOLUME.BREAKTHROUGH, pan: 0 }) }
  
    /** Session end — long, slow, allows the user to breathe with it */
    playSessionEnd()     { this._playEvent('sessionEnd',   { volume: 0.30, pan: 0 }) }
  
    /**
     * Phase arrival — the barely-audible presence sound when a session phase
     * transition completes. Designed to be felt rather than heard.
     * Connected to PhaseInterpolator's onArrival callback in LivingCanvas.jsx.
     */
    playPhaseArrival()   { this._playEvent('phaseArrival', { volume: VOLUME.PHASE_ARRIVAL, pan: 0 }) }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // AMBIENT LOOPS
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Starts an ambient loop. If a different loop is already playing,
     * cross-fades smoothly between them.
     *
     * @param {'ocean' | 'rain' | 'wind' | 'forest'} loopKey
     * @param {{ fadeIn?: number }} options
     */
    async startAmbient(loopKey, { fadeIn = TIMING.FADE_IN_LONG } = {}) {
      if (!loopKey || !AMBIENT_LOOPS[loopKey]) return
  
      // If this loop is already playing, do nothing
      if (this._activeLoop?.key === loopKey) return
  
      // Fade out the current loop if one exists
      if (this._activeLoop) {
        await this._fadeOutLoop(this._activeLoop, TIMING.FADE_OUT_SHORT)
      }
  
      // Ensure the buffer is loaded
      const buffer = this._buffers.get(loopKey) ?? await this._preload(loopKey, AMBIENT_LOOPS[loopKey])
      if (!buffer || !this.ready) return
  
      const { source, gainNode, pannerNode } = this._buildLoopGraph(buffer)
      source.start()
  
      // Fade in
      const ctx = this._ctx
      gainNode.gain.cancelScheduledValues(ctx.currentTime)
      gainNode.gain.setValueAtTime(0, ctx.currentTime)
      gainNode.gain.linearRampToValueAtTime(
        this._isMuted ? 0 : VOLUME.AMBIENT_MAX,
        ctx.currentTime + fadeIn
      )
  
      // Start the slow spatial drift — panner drifts -0.25 → +0.25 → -0.25
      // over TIMING.PANNER_DRIFT seconds per direction. Creates the sense of
      // a physical room that has slightly different character on each side.
      const driftInterval = this._startPannerDrift(pannerNode)
  
      this._activeLoop = { key: loopKey, source, gainNode, pannerNode, driftInterval }
    }
  
    /**
     * Fades out and stops the active ambient loop.
     *
     * @param {number} [fadeOut] — seconds for the fade
     */
    async stopAmbient(fadeOut = TIMING.FADE_OUT_LONG) {
      if (!this._activeLoop) return
      await this._fadeOutLoop(this._activeLoop, fadeOut)
      this._activeLoop = null
    }
  
    /**
     * Internal: fades out a loop node and disconnects it.
     * @param {{ source, gainNode, pannerNode, driftInterval }} loop
     * @param {number} fadeTime
     */
    _fadeOutLoop(loop, fadeTime) {
      return new Promise(resolve => {
        if (!loop || !this._ctx) { resolve(); return }
  
        clearInterval(loop.driftInterval)
  
        const { gainNode, source } = loop
        const ctx = this._ctx
        const now = ctx.currentTime
  
        gainNode.gain.cancelScheduledValues(now)
        gainNode.gain.setValueAtTime(gainNode.gain.value, now)
        gainNode.gain.linearRampToValueAtTime(0, now + fadeTime)
  
        setTimeout(() => {
          try {
            source.stop()
            gainNode.disconnect()
            loop.pannerNode.disconnect()
          } catch {
            // Already stopped or disconnected
          }
          resolve()
      }, (fadeTime * 1000) + 50)
    })
  }

  /**
   * Starts the slow stereo drift for an ambient loop's panner.
   * The panner oscillates between -0.25 and +0.25 over 8 seconds per direction.
   * This is so slow it registers as spatial texture, not as movement.
   *
   * @param {StereoPannerNode} pannerNode
   * @returns {number} — interval ID for cleanup
   */
  _startPannerDrift(pannerNode) {
    let direction = 1
    let currentPan = 0

    const STEP = 0.25 / (TIMING.PANNER_DRIFT * 10)   // amount to move per 100ms

    return setInterval(() => {
      if (!this._ctx || this._ctx.state === 'closed') return

      currentPan += direction * STEP
      if (currentPan >= 0.25) {
        currentPan = 0.25
        direction = -1
      } else if (currentPan <= -0.25) {
        currentPan = -0.25
        direction = 1
      }

      pannerNode.pan.linearRampToValueAtTime(
        currentPan,
        this._ctx.currentTime + 0.15   // smooth 150ms transition per step
      )
    }, 100)
  }

  /**
   * Adjusts the volume of the active ambient loop.
   * Called when the user changes volume in the settings or a state transition
   * requires a temporary volume reduction (e.g., cooldown state quiets the loop).
   *
   * @param {number} volume — 0 to 1
   * @param {number} [rampTime] — seconds
   */
  setAmbientVolume(volume, rampTime = 1.0) {
    if (!this._activeLoop || !this._ctx) return
    const now = this._ctx.currentTime
    this._activeLoop.gainNode.gain.linearRampToValueAtTime(
      this._isMuted ? 0 : Math.min(volume, VOLUME.AMBIENT_MAX),
      now + rampTime
    )
  }


  // ─────────────────────────────────────────────────────────────────────────
  // VOLUME AND MUTE CONTROL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Sets the master volume.
   * @param {number} volume — 0 to 1
   * @param {number} [rampTime]
   */
  setMasterVolume(volume, rampTime = 0.3) {
    if (!this._masterGain || !this._ctx) return
    const now = this._ctx.currentTime
    this._masterGain.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, volume)),
      now + rampTime
    )
  }

  /**
   * Mutes all audio. Event sounds stop immediately; ambient fades over 1s.
   */
  mute() {
    if (this._isMuted) return
    this._isMuted = true
    if (this._masterGain && this._ctx) {
      const now = this._ctx.currentTime
      this._masterGain.gain.linearRampToValueAtTime(0, now + 0.5)
    }
  }

  /**
   * Unmutes. Ambient sound fades back in; master volume restores.
   */
  unmute() {
    if (!this._isMuted) return
    this._isMuted = false
    if (this._masterGain && this._ctx) {
      const now = this._ctx.currentTime
      this._masterGain.gain.linearRampToValueAtTime(VOLUME.MASTER_DEFAULT, now + 0.8)
    }
  }

  /** Toggles mute state. Returns new muted status. */
  toggleMute() {
    this._isMuted ? this.unmute() : this.mute()
    return this._isMuted
  }

  /** Whether the manager is currently muted. */
  get isMuted() { return this._isMuted }

  /** Enable/disable default event sounds independently of ambient and mute. */
  setEventsEnabled(enabled) {
    this._eventsEnabled = Boolean(enabled)
  }


  // ─────────────────────────────────────────────────────────────────────────
  // SESSION LIFECYCLE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Full session start sequence:
   *   1. Short fade-in of ambient loop (if one is selected)
   *   2. Play intake-complete sound
   * Called by LivingCanvas.jsx or session store when session_started_at is set.
   *
   * @param {string | null} ambientKey — user's ambient preference
   */
  async onSessionStart(ambientKey) {
    this.playIntakeComplete()
    if (ambientKey) {
      await this.startAmbient(ambientKey, { fadeIn: TIMING.FADE_IN_LONG })
    }
  }

  /**
   * Full session end sequence:
   *   1. Play session-end sound
   *   2. Fade out ambient over 4 seconds
   * Called by session store when session.mode becomes 'closed'.
   */
  async onSessionEnd() {
    this.playSessionEnd()
    await this.stopAmbient(TIMING.FADE_OUT_LONG)
  }

  /**
   * Cooldown entry — quiets ambient slightly, plays grounding tone.
   * The ambient doesn't stop — it becomes a quieter support layer.
   */
  onCooldownEnter() {
    this.playModeShift()
    this.setAmbientVolume(VOLUME.AMBIENT_MAX * 0.5, 1.5)
  }

  /**
   * Cooldown exit — restores ambient volume gently.
   */
  onCooldownExit() {
    this.setAmbientVolume(VOLUME.AMBIENT_MAX, 2.0)
  }

  /**
   * Cleanup — call when the component tree unmounts.
   * Stops all audio and closes the AudioContext.
   */
  async destroy() {
    if (this._activeLoop) {
      await this._fadeOutLoop(this._activeLoop, 0.5)
    }
    if (this._ctx && this._ctx.state !== 'closed') {
      await this._ctx.close()
    }
    this._buffers.clear()
    this._isUnlocked = false
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const soundManager = new SoundManager()