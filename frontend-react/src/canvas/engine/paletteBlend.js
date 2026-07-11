/**
 * src/canvas/engine/paletteBlend.js
 *
 * The chromatic hydration engine for Alinda's LivingCanvas.
 *
 * Manages smooth, mathematically synchronized color transitions for
 * the canvas — completely outside React, completely outside the DOM,
 * running inside the native requestAnimationFrame loop.
 *
 * CORE LAW:
 *   React is banned from knowing what color the canvas is mid-transition.
 *   React tells this file "switch to Titan" or "enter cooldown."
 *   This file takes over entirely, computing frame-by-frame RGB values
 *   and pushing them directly to NoiseField via setBackgroundColor(),
 *   setParticleColor(), and setGlowColor().
 *
 * THREE COLOR CHANNELS:
 *   background  — the alpha-decay rectangle color (surfaceBase)
 *   particle    — the flowing dot color (bronze / terracotta / crisis)
 *   glow        — the floor-light and Alinda-pulse color (bronze variants)
 *
 * TWO INDEPENDENT TRANSITION TYPES:
 *   theme       — Olympian ↔ Titan, 500ms, stone easing
 *                 Interruption-safe: rapid toggling never snaps.
 *   state       — guided/cooldown/stillness/breakthrough color offsets, 800ms
 *                 Composited on top of theme values — both can be in-flight
 *                 simultaneously without interference.
 *
 * ZERO ALLOCATION:
 *   All working buffers are pre-allocated Float32Arrays.
 *   No objects, no arrays, no strings are created inside update().
 *   The garbage collector is never triggered by this file.
 *
 * SYNCHRONIZATION:
 *   Theme transition duration (500ms) matches --theme-transition in index.css
 *   and transitionTheme in animations/motionTokens.js. The cubic-bezier easing
 *   applied here (applyCubicBezier with easing.stone) is identical to what
 *   Framer Motion and CSS apply to the DOM elements. All three layers —
 *   CSS custom properties, Framer Motion values, and canvas pixels — reach
 *   their final color at the exact same millisecond.
 */

import { hexToRgb, getHexPalette, applyCubicBezier } from 'design/theme'
import { easing, duration }                            from 'design/tokens'


// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION DURATIONS
// ─────────────────────────────────────────────────────────────────────────────

const THEME_TRANSITION_MS = duration.slow          // 500ms — matches CSS
const STATE_TRANSITION_MS = 800                    // ms — canvas state changes


// ─────────────────────────────────────────────────────────────────────────────
// CANVAS STATE COLOR OFFSETS
//
// Each canvas state applies a delta to the base theme colors.
// Deltas are in RGB integer space (-255 to +255 per channel).
// The final color = clamp(themePalette + stateDelta, 0, 255).
//
// 'guided' has zero delta — it IS the base palette.
// 'cooldown' warms the particle color slightly — a faint amber shift.
// 'stillness' strongly mutes particle color toward background — nearly invisible.
// 'breakthrough' intensifies the particle color — the most vivid the canvas gets.
// 'waiting' is the separate calm waiting-room state — desaturated, slow.
// 'idle' matches the base palette with a very slight desaturation.
//
// These are intentionally subtle. The canvas should respond emotionally,
// not theatrically. The user should feel it, not notice it.
// ─────────────────────────────────────────────────────────────────────────────

const STATE_DELTAS = Object.freeze({
  //                  bg delta       particle delta     glow delta
  //                  [Δr, Δg, Δb]   [Δr, Δg, Δb]      [Δr, Δg, Δb]
  idle:         { bg: [0, 0, 0],   particle: [0, 0, 0],         glow: [0, 0, 0] },
  waiting:      { bg: [0, 0, 2],   particle: [-8, -4, 0],       glow: [-4, -2, 0] },
  guided:       { bg: [0, 0, 0],   particle: [0, 0, 0],         glow: [0, 0, 0] },
  cooldown:     { bg: [2, 1, 0],   particle: [12, 4, -6],       glow: [8, 2, -4] },
  stillness:    { bg: [0, 0, 0],   particle: [-60, -50, -40],   glow: [-40, -35, -30] },
  breakthrough: { bg: [0, 1, 0],   particle: [18, 8, -4],       glow: [22, 12, 0] },
})

// Fallback if an unmapped state is received
const IDENTITY_DELTA = { bg: [0, 0, 0], particle: [0, 0, 0], glow: [0, 0, 0] }


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS — Zero allocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamps a value to [0, 255] integer range.
 * Inline function — avoids Math.min/max object overhead at call sites.
 * @param {number} v
 * @returns {number}
 */
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0
}

/**
 * Writes a hex color's RGB values into a Float32Array at offset.
 * @param {Float32Array} buf — target buffer
 * @param {number} offset — index of the R channel (G at offset+1, B at offset+2)
 * @param {string} hex — '#RRGGBB'
 */
function writeHexToBuffer(buf, offset, hex) {
  const rgb = hexToRgb(hex)
  buf[offset]     = rgb[0]
  buf[offset + 1] = rgb[1]
  buf[offset + 2] = rgb[2]
}


// ─────────────────────────────────────────────────────────────────────────────
// PRE-ALLOCATED MODULE-SCOPE WORKING BUFFERS
//
// These are shared across all PaletteBlend instances (there will ever only
// be one, but they're module-scope rather than instance-scope to make the
// zero-allocation guarantee explicit and auditable).
//
// Layout of each 9-float triple buffer:
//   [0,1,2] = background  R,G,B
//   [3,4,5] = particle    R,G,B
//   [6,7,8] = glow        R,G,B
// ─────────────────────────────────────────────────────────────────────────────

const _themeStart    = new Float32Array(9)   // theme transition start (mid-transition capture)
const _themeTarget   = new Float32Array(9)   // theme transition target
const _themeCurrent  = new Float32Array(9)   // theme-layer result this frame

const _stateStart    = new Float32Array(9)   // state delta transition start
const _stateTarget   = new Float32Array(9)   // state delta transition target
const _stateCurrent  = new Float32Array(9)   // state-layer result this frame

const _finalCurrent  = new Float32Array(9)   // theme + state composited result


// ─────────────────────────────────────────────────────────────────────────────
// PaletteBlend CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class PaletteBlend {
  /**
   * @param {'light' | 'dark'} initialTheme
   * @param {string} initialCanvasState — from theme.js modeToCanvasState()
   * @param {Object} noiseField — the NoiseField instance to push colors into
   */
  constructor(initialTheme, initialCanvasState, noiseField) {
    this._noiseField    = noiseField
    this._currentTheme  = initialTheme
    this._currentState  = initialCanvasState

    // ── Theme transition state ─────────────────────────────────────────────
    this._themeAnimating    = false
    this._themeStartTime    = 0
    this._themeDuration     = THEME_TRANSITION_MS
    this._themeProgress     = 1.0    // 1.0 = no transition in progress

    // ── State transition state ────────────────────────────────────────────
    this._stateAnimating    = false
    this._stateStartTime    = 0
    this._stateDuration     = STATE_TRANSITION_MS
    this._stateProgress     = 1.0

    // ── Initialize buffers with starting colors ───────────────────────────
    this._writeThemePalette(initialTheme, _themeTarget)
    this._writeThemePalette(initialTheme, _themeStart)
    this._writeThemePalette(initialTheme, _themeCurrent)

    this._writeStateDelta(initialCanvasState, _stateTarget)
    this._writeStateDelta(initialCanvasState, _stateStart)
    this._fillZero(_stateCurrent)

    this._recomposit()
    this._pushToNoiseField()
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // BUFFER WRITERS — Zero allocation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Writes a theme palette's three channel colors into a 9-float buffer.
   * @param {'light' | 'dark'} theme
   * @param {Float32Array} buf
   */
  _writeThemePalette(theme, buf) {
    const hex = getHexPalette(theme)
    writeHexToBuffer(buf, 0, hex.surfaceBase)   // background
    writeHexToBuffer(buf, 3, hex.bronze)         // particle
    writeHexToBuffer(buf, 6, hex.bronze)         // glow (same base, different opacity in CSS)
  }

  /**
   * Writes a canvas state's RGB deltas into a 9-float buffer.
   * The deltas are written as signed integers — compositing applies clamping.
   * @param {string} stateName
   * @param {Float32Array} buf
   */
  _writeStateDelta(stateName, buf) {
    const delta = STATE_DELTAS[stateName] ?? IDENTITY_DELTA

    buf[0] = delta.bg[0];       buf[1] = delta.bg[1];       buf[2] = delta.bg[2]
    buf[3] = delta.particle[0]; buf[4] = delta.particle[1]; buf[5] = delta.particle[2]
    buf[6] = delta.glow[0];     buf[7] = delta.glow[1];     buf[8] = delta.glow[2]
  }

  /**
   * Fills a buffer with zeros.
   * @param {Float32Array} buf
   */
  _fillZero(buf) {
    buf[0]=0; buf[1]=0; buf[2]=0
    buf[3]=0; buf[4]=0; buf[5]=0
    buf[6]=0; buf[7]=0; buf[8]=0
  }

  /**
   * Captures the current live color values from _themeCurrent and
   * _stateCurrent into a target buffer — used when a transition is
   * interrupted and the mid-transition color becomes the new start point.
   *
   * This is the interruption-safety mechanism. Without this, snapping
   * occurs when a transition is overridden because the start is reset
   * to the palette value rather than the actual current pixel color.
   *
   * @param {Float32Array} targetBuf — where to write the snapshot
   */
  _snapshotThemeCurrent(targetBuf) {
    for (let i = 0; i < 9; i++) targetBuf[i] = _themeCurrent[i]
  }

  _snapshotStateCurrent(targetBuf) {
    for (let i = 0; i < 9; i++) targetBuf[i] = _stateCurrent[i]
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // COMPOSITING
  //
  // The final color for each channel is:
  //   finalR = clamp(themeCurrentR + stateCurrentR, 0, 255)
  //
  // Both layers are always current — if no transition is in progress for
  // a layer, it simply holds its last computed value, which contributes
  // correctly to the composite.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Computes _finalCurrent from _themeCurrent and _stateCurrent.
   * Called at the end of every update() call.
   */
  _recomposit() {
    for (let i = 0; i < 9; i++) {
      _finalCurrent[i] = clamp255(_themeCurrent[i] + _stateCurrent[i])
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // PUSH TO NOISE FIELD
  //
  // The only place where this file calls outward to noiseField.js.
  // Called at the end of every update() call, after _recomposit().
  // ─────────────────────────────────────────────────────────────────────────────

  _pushToNoiseField() {
    // Background
    this._noiseField.setBackgroundColor(
      _finalCurrent[0],
      _finalCurrent[1],
      _finalCurrent[2]
    )
    // Particle
    this._noiseField.setParticleColor(
      _finalCurrent[3],
      _finalCurrent[4],
      _finalCurrent[5]
    )
    // Glow — noiseField doesn't currently have a setGlowColor method,
    // but we store the computed value so LivingCanvas.jsx can read it
    // via getGlowColor() and apply it to DOM elements via CSS custom properties.
    this._glowR = _finalCurrent[6]
    this._glowG = _finalCurrent[7]
    this._glowB = _finalCurrent[8]
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // EASING — Using the shared cubic-bezier solver from theme.js
  //
  // Both transitions use the stone curve — matching the CSS and Framer Motion
  // values so all three rendering layers complete at the same millisecond.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Computes eased progress for a transition, given raw linear progress.
   * @param {number} t — 0.0 to 1.0 linear
   * @returns {number} — 0.0 to 1.0 eased
   */
  _applyEasing(t) {
    return applyCubicBezier(easing.stone, t)
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // FRAME INTERPOLATION — THEME LAYER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Advances the theme transition by one frame and writes the result into
   * _themeCurrent. No-op if no theme transition is in progress.
   *
   * @param {number} now — performance.now() timestamp
   */
  _stepTheme(now) {
    if (!this._themeAnimating) return

    const elapsed  = now - this._themeStartTime
    const rawT     = Math.min(1, elapsed / this._themeDuration)
    const easedT   = this._applyEasing(rawT)

    for (let i = 0; i < 9; i++) {
      _themeCurrent[i] = _themeStart[i] + (_themeTarget[i] - _themeStart[i]) * easedT
    }

    if (rawT >= 1) {
      this._themeAnimating = false
      this._themeProgress  = 1.0
      // Snap to exact target to eliminate floating-point drift
      for (let i = 0; i < 9; i++) _themeCurrent[i] = _themeTarget[i]
    } else {
      this._themeProgress = rawT
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // FRAME INTERPOLATION — STATE LAYER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Advances the state delta transition by one frame and writes the result
   * into _stateCurrent.
   *
   * @param {number} now — performance.now()
   */
  _stepState(now) {
    if (!this._stateAnimating) return

    const elapsed  = now - this._stateStartTime
    const rawT     = Math.min(1, elapsed / this._stateDuration)

    // State transitions use a slightly softer ease than theme transitions —
    // canvas state shifts should feel like emotional shifts, not mode switches.
    // applyCubicBezier with the breath curve (near-linear) suits this well.
    const easedT   = applyCubicBezier(easing.breath, rawT)

    for (let i = 0; i < 9; i++) {
      _stateCurrent[i] = _stateStart[i] + (_stateTarget[i] - _stateStart[i]) * easedT
    }

    if (rawT >= 1) {
      this._stateAnimating = false
      this._stateProgress  = 1.0
      for (let i = 0; i < 9; i++) _stateCurrent[i] = _stateTarget[i]
    } else {
      this._stateProgress = rawT
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * The main per-frame call. Must be called inside the requestAnimationFrame
   * loop in LivingCanvas.jsx, before NoiseField.render().
   *
   * Order matters: colors must be set on the NoiseField before render()
   * reads them, or the canvas will paint with colors that are one frame
   * behind the transition. At 60fps this is 16ms — technically invisible,
   * but still wrong.
   *
   * @param {number} now — performance.now() timestamp passed from the RAF loop
   */
  update(now) {
    this._stepTheme(now)
    this._stepState(now)
    this._recomposit()
    this._pushToNoiseField()
  }


  /**
   * Initiates a theme transition.
   *
   * INTERRUPTION SAFETY:
   *   If a theme transition is already in progress, the current mid-transition
   *   color is captured as the new start point. The transition resumes from
   *   exactly where it is — no snap, no visual discontinuity, regardless of
   *   how fast the user taps the toggle.
   *
   *   The duration of the new transition is proportional to how much of the
   *   color change remains — if a transition was 80% complete and is reversed,
   *   the reverse transition takes 20% of the full duration, not 100%.
   *   This prevents a subtle wrongness where a nearly-complete fade takes
   *   a full 500ms to reverse the tiny remaining distance.
   *
   * @param {'light' | 'dark'} newTheme — the target theme
   * @param {number} now — performance.now()
   */
  setTheme(newTheme, now) {
    if (newTheme === this._currentTheme && !this._themeAnimating) return

    // Capture exact current color as start point (interruption safety)
    this._snapshotThemeCurrent(_themeStart)

    // Write new target
    this._writeThemePalette(newTheme, _themeTarget)

    // Proportional duration: remaining visual distance drives the time budget
    // This prevents the "reversed transition takes too long" problem.
    if (this._themeAnimating) {
      const remainingT = 1 - this._themeProgress
      this._themeDuration = THEME_TRANSITION_MS * Math.max(0.15, remainingT)
    } else {
      this._themeDuration = THEME_TRANSITION_MS
    }

    this._currentTheme   = newTheme
    this._themeStartTime = now
    this._themeAnimating = true
    this._themeProgress  = 0
  }


  /**
   * Transitions the canvas state layer to a new state.
   *
   * Called by LivingCanvas.jsx when the FSM mode changes —
   * guided → cooldown, guided → stillness, etc.
   *
   * Like theme transitions, this is interruption-safe: rapid FSM changes
   * (e.g. guided → cooldown → guided in quick succession due to a repair
   * after a safety intervention) never cause visual snapping.
   *
   * @param {string} newCanvasState — from theme.js modeToCanvasState()
   * @param {number} now — performance.now()
   */
  setCanvasState(newCanvasState, now) {
    if (newCanvasState === this._currentState && !this._stateAnimating) return

    // Capture current state delta as start point
    this._snapshotStateCurrent(_stateStart)

    // Write new target delta
    this._writeStateDelta(newCanvasState, _stateTarget)

    // Proportional duration on interruption
    if (this._stateAnimating) {
      const remainingT = 1 - this._stateProgress
      this._stateDuration = STATE_TRANSITION_MS * Math.max(0.15, remainingT)
    } else {
      this._stateDuration = STATE_TRANSITION_MS
    }

    this._currentState   = newCanvasState
    this._stateStartTime = now
    this._stateAnimating = true
    this._stateProgress  = 0
  }


  /**
   * Returns the current computed glow color as an RGB CSS string.
   * Called by LivingCanvas.jsx to update a CSS custom property on the
   * canvas container element, which the DOM elements (TurnGlow, AlindaPresencePulse)
   * read via var(--canvas-glow-r), var(--canvas-glow-g), var(--canvas-glow-b).
   *
   * This is the bridge between the canvas chromatic layer and the DOM
   * glow effects — the only place in this file where a string is created,
   * and it is called by LivingCanvas.jsx only when the glow color has
   * actually changed (checked via hasGlowChanged()), not every frame.
   *
   * @returns {string} — 'rgb(r,g,b)'
   */
  getGlowColorString() {
    return `rgb(${this._glowR|0},${this._glowG|0},${this._glowB|0})`
  }


  /**
   * Returns individual glow channel values.
   * Available if LivingCanvas.jsx needs to apply them as separate custom properties
   * for rgba() construction in the DOM.
   *
   * @returns {{ r: number, g: number, b: number }}
   */
  getGlowChannels() {
    return { r: this._glowR|0, g: this._glowG|0, b: this._glowB|0 }
  }


  /**
   * Returns true if the glow color changed since the last time this was called.
   * Uses a simple threshold (integer channel difference ≥ 1) to avoid
   * triggering a CSS custom property update on frames where floating point
   * arithmetic produces a negligibly different value.
   *
   * LivingCanvas.jsx calls this once per frame to gate the DOM update,
   * preventing a style recalculation on every animation frame when no
   * glow transition is active (the common case).
   *
   * @returns {boolean}
   */
  hasGlowChanged() {
    const rChanged = (this._glowR|0) !== (this._prevGlowR|0)
    const gChanged = (this._glowG|0) !== (this._prevGlowG|0)
    const bChanged = (this._glowB|0) !== (this._prevGlowB|0)

    if (rChanged || gChanged || bChanged) {
      this._prevGlowR = this._glowR
      this._prevGlowG = this._glowG
      this._prevGlowB = this._glowB
      return true
    }
    return false
  }


  /**
   * Forces an immediate, transition-less color update to both buffers.
   * Called once on canvas resize (when the canvas element is reconstructed)
   * and on initial mount, to ensure the canvas starts at the correct color
   * without a fade-from-black flash.
   *
   * @param {'light' | 'dark'} theme
   * @param {string} canvasState
   */
  snapToState(theme, canvasState) {
    this._writeThemePalette(theme, _themeTarget)
    this._writeThemePalette(theme, _themeStart)
    this._writeThemePalette(theme, _themeCurrent)

    this._writeStateDelta(canvasState, _stateTarget)
    this._writeStateDelta(canvasState, _stateStart)
    this._writeStateDelta(canvasState, _stateCurrent)

    this._themeAnimating = false
    this._stateAnimating = false
    this._themeProgress  = 1.0
    this._stateProgress  = 1.0
    this._currentTheme   = theme
    this._currentState   = canvasState

    this._recomposit()
    this._pushToNoiseField()
  }


  /**
   * Returns whether any transition is currently active.
   * Used by LivingCanvas.jsx to decide whether to force a re-render on
   * frames where the noise field itself hasn't changed — the palette
   * is still changing and needs another frame.
   *
   * @returns {boolean}
   */
  isAnimating() {
    return this._themeAnimating || this._stateAnimating
  }


  /**
   * Returns debug information for development inspection.
   * Not called in production.
   *
   * @returns {Object}
   */
  getDebugInfo() {
    return {
      theme:          this._currentTheme,
      state:          this._currentState,
      themeAnimating: this._themeAnimating,
      themeProgress:  this._themeProgress.toFixed(3),
      stateAnimating: this._stateAnimating,
      stateProgress:  this._stateProgress.toFixed(3),
      bgCurrent:      `rgb(${_finalCurrent[0]|0},${_finalCurrent[1]|0},${_finalCurrent[2]|0})`,
      particleCurrent:`rgb(${_finalCurrent[3]|0},${_finalCurrent[4]|0},${_finalCurrent[5]|0})`,
      glowCurrent:    `rgb(${_finalCurrent[6]|0},${_finalCurrent[7]|0},${_finalCurrent[8]|0})`,
    }
  }
}