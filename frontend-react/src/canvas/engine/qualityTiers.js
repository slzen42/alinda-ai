/**
 * src/canvas/engine/qualityTiers.js
 *
 * The hardware intelligence layer for Alinda's LivingCanvas.
 *
 * Core law: a perfectly smooth, slightly softer canvas is infinitely
 * better than a sharp, stuttering canvas. This file interrogates the
 * device once at boot, classifies it into one of three immutable tiers,
 * and exports a configuration object that the canvas engine treats as
 * an operating contract for the entire session.
 *
 * THE THREE TIERS:
 *   MONUMENTAL  — High-end desktop / iPad Pro. Visual perfection.
 *   STANDARD    — Modern mobile / baseline. Flawless frame rate, managed thermals.
 *   CONSERVE    — Older devices / low battery / thermal throttle. Stability over fidelity.
 *
 * THE DYNAMIC DOWNGRADE:
 *   Even correct initial classification isn't enough. A new iPhone in
 *   the hot sun will thermally throttle mid-session. The rendering loop
 *   in LivingCanvas.jsx calls recordFrame() on every animation frame and
 *   checkForDowngrade() periodically. If the device is failing to hit its
 *   target FPS, this module silently reclassifies and returns a new config.
 *   The user never sees a loading screen or a visual cut — the canvas
 *   simply becomes slightly softer.
 *
 * MATHEMATICAL NOTE — alpha decay vs. frame rate:
 *   At 60fps, one frame = 16.7ms. At 30fps, one frame = 33.3ms.
 *   If alphaDecay stays constant between tiers, the canvas trail is
 *   literally halved in visual length at 30fps because half as many
 *   frames are painted per second. To maintain the same visual half-life
 *   (the perceptual "depth" of the trail) at any frame rate, alphaDecay
 *   must scale linearly with frame interval:
 *
 *     decayPerFrame = decayPerSecond * (frameIntervalMs / 1000)
 *
 *   This is why CONSERVE.alphaDecay is double STANDARD.alphaDecay —
 *   not aesthetics, but physics. The "dreamy" quality at 30fps is a
 *   consequence of correct math, not a manual tweak.
 */


// ─────────────────────────────────────────────────────────────────────────────
// TIER NAME CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_MONUMENTAL = 'monumental'
export const TIER_STANDARD   = 'standard'
export const TIER_CONSERVE   = 'conserve'


// ─────────────────────────────────────────────────────────────────────────────
// IMMUTABLE TIER DEFINITIONS
//
// Each tier is frozen at definition time. Nothing in the runtime can
// accidentally mutate these — the canvas engine always receives a
// known, stable contract.
//
// alphaDecay: how quickly previous frames fade per paint cycle.
//   Visual half-life = ln(2) / (decayPerFrame * targetFPS) seconds.
//   Standard: decay=0.015 @ 60fps → half-life ≈ 0.77s
//   Conserve: decay=0.030 @ 30fps → half-life ≈ 0.77s (identical visual result)
//
// noiseScale and noiseSpeed are invariant across tiers — these control
// the spatial and temporal character of the flow field, not its cost.
// Octave count is what controls the rendering cost.
//
// particleCount: the number of flow-field traces active simultaneously.
//   This is the second most expensive parameter after pixel ratio.
//   Halving it at Conserve costs almost no visual quality on small screens.
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_CONFIGS = Object.freeze({
  [TIER_MONUMENTAL]: Object.freeze({
    name:            TIER_MONUMENTAL,
    targetFPS:       60,
    frameInterval:   1000 / 60,          // ~16.7ms
    pixelRatio:      2.0,                // DPR cap — Retina-quality on high-end hardware
    noiseOctaves:    4,                  // full complexity — the stone feels impossibly deep
    noiseScale:      0.003,
    noiseSpeed:      0.0004,
    alphaDecay:      0.015,              // per-frame decay @ 60fps
    particleCount:   1400,
    breathDepth:     0.06,               // canvas breathing amplitude
    transitionSpeed: 1.0,                // phase-interpolation speed multiplier (1.0 = normal)
  }),

  [TIER_STANDARD]: Object.freeze({
    name:            TIER_STANDARD,
    targetFPS:       60,
    frameInterval:   1000 / 60,
    pixelRatio:      1.5,                // DPR cap — still crisp, GPU load substantially reduced
    noiseOctaves:    3,                  // missing 4th octave is imperceptible on phone screens
    noiseScale:      0.003,
    noiseSpeed:      0.0004,
    alphaDecay:      0.015,              // same visual half-life as MONUMENTAL @ same FPS
    particleCount:   900,
    breathDepth:     0.055,
    transitionSpeed: 1.0,
  }),

  [TIER_CONSERVE]: Object.freeze({
    name:            TIER_CONSERVE,
    targetFPS:       30,
    frameInterval:   1000 / 30,          // ~33.3ms
    pixelRatio:      1.0,                // native pixels only — no supersampling
    noiseOctaves:    2,                  // minimum for organic appearance
    noiseScale:      0.003,
    noiseSpeed:      0.0003,             // slightly slower drift — suits the dreamier aesthetic
    alphaDecay:      0.030,              // DOUBLE standard — maintains same visual half-life @ 30fps
    particleCount:   500,
    breathDepth:     0.04,               // gentler breath — matches the slower frame cadence
    transitionSpeed: 0.6,                // phase interpolation moves more slowly — less computation
  }),
})


// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC DOWNGRADE THRESHOLDS
//
// The rendering loop calls recordFrame() on every animation frame.
// These constants define when a downgrade is triggered.
//
// DROPPED_FRAME_WINDOW: how many recent frames to keep in the rolling buffer
// DROPPED_FRAME_RATIO_THRESHOLD: if this fraction of recent frames are
//   "dropped" (significantly below target FPS), trigger a downgrade check
// DOWNGRADE_COOLDOWN_MS: minimum time between downgrades — prevents
//   thrashing if the device oscillates around the threshold
// ─────────────────────────────────────────────────────────────────────────────

export const DROPPED_FRAME_WINDOW             = 60    // evaluate the last 60 frames
export const DROPPED_FRAME_RATIO_THRESHOLD    = 0.25  // 25% dropped = sustained underperformance
export const FRAME_BUDGET_MULTIPLIER          = 1.5   // "dropped" = frame took > 1.5× its budget
export const DOWNGRADE_COOLDOWN_MS            = 8000  // wait 8s before another downgrade
export const PERFORMANCE_SAMPLE_INTERVAL_MS   = 5000  // check for downgrade every 5s


// ─────────────────────────────────────────────────────────────────────────────
// DETECTION HEURISTICS — THE HARDWARE DETECTIVE
//
// Runs exactly once per browser session. Result is stored in sessionStorage
// so re-navigation doesn't re-detect (and doesn't re-trigger the async
// battery check). sessionStorage is deliberately used over localStorage —
// this is a snapshot of the device's current state, not a lasting preference.
// A user who charges their phone and reopens the app deserves a fresh assessment.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_TIER_KEY = 'alinda-canvas-tier'

/**
 * Checks whether a detection result is already stored for this browser session.
 * Returns the stored tier name, or null if detection needs to run.
 *
 * @returns {string | null}
 */
function getStoredTier() {
  try {
    return sessionStorage.getItem(SESSION_TIER_KEY)
  } catch {
    return null
  }
}

/**
 * Persists the detected tier to sessionStorage for the rest of this session.
 *
 * @param {string} tierName
 */
function storeTier(tierName) {
  try {
    sessionStorage.setItem(SESSION_TIER_KEY, tierName)
  } catch {
    // sessionStorage unavailable (private browsing on some browsers) — silently continue
  }
}


/**
 * Detects whether the device is likely mobile based on touch capability
 * and user agent. Mobile devices dissipate heat into the user's palm
 * rather than through a fan — they receive a hardware penalty by default
 * to protect battery life and surface temperature.
 *
 * This is not a punitive judgment; it's a physical reality.
 * Modern mobile hardware is powerful, but thermal constraints are real.
 *
 * @returns {boolean}
 */
function isMobileDevice() {
  const hasTouchPrimary = (
    navigator.maxTouchPoints > 1 ||
    window.matchMedia('(pointer: coarse)').matches
  )
  const mobileUA = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
  return hasTouchPrimary && mobileUA
}


/**
 * Reads the Battery Status API if available (Chrome/Android only — iOS
 * does not expose this API). Returns the charge level (0.0–1.0) and
 * whether the device is currently charging.
 *
 * A device at <20% battery that is not charging should immediately
 * go to CONSERVE regardless of other signals — running the canvas
 * at full fidelity on a dying phone is inconsiderate engineering.
 *
 * @returns {Promise<{ level: number, charging: boolean } | null>}
 */
async function readBattery() {
  try {
    if (!('getBattery' in navigator)) return null
    const battery = await navigator.getBattery()
    return { level: battery.level, charging: battery.charging }
  } catch {
    return null
  }
}


/**
 * Reads the Network Information API if available.
 * A device on a slow data connection is likely not a high-end desktop
 * (and may be on a low-power radio — a mild hint toward STANDARD).
 * This signal is weak and only used as a tiebreaker.
 *
 * @returns {'4g' | '3g' | '2g' | 'slow-2g' | 'wifi' | null}
 */
function readConnectionType() {
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    return conn?.effectiveType || null
  } catch {
    return null
  }
}


/**
 * Checks whether the user has requested reduced motion at the OS level.
 * If true, we apply CONSERVE regardless of hardware capability —
 * respecting accessibility preferences takes priority over visual fidelity.
 * The canvas still runs (it's therapeutic, not decorative) but at
 * minimum computational cost and minimum movement.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}


/**
 * The core detection function. Runs once, asynchronously, on boot.
 * Interrogates available browser APIs to classify the device into
 * a tier, then stores the result for the session.
 *
 * Classification logic (priority order — first match wins):
 *   1. prefers-reduced-motion → CONSERVE (accessibility first)
 *   2. Battery < 20% and not charging → CONSERVE
 *   3. CPU cores < 4 → CONSERVE
 *   4. Device memory < 2GB → CONSERVE
 *   5. CPU cores < 8 OR device is mobile → STANDARD
 *   6. Everything else → MONUMENTAL
 *
 * The bias toward CONSERVE and STANDARD for borderline cases is
 * intentional. A user on Tier 2 who can't tell the difference from
 * Tier 1 loses nothing. A user on Tier 1 hardware running Tier 2
 * configuration is completely fine. The inverse — pushing a Tier 3
 * device to Tier 1 — causes heat, drain, and stutter, which are
 * directly incompatible with a therapeutic app.
 *
 * @returns {Promise<string>} — one of the TIER_* constants
 */
async function detectTier() {
  // Reduced motion check — no hardware interrogation needed
  if (prefersReducedMotion()) {
    return TIER_CONSERVE
  }

  // Battery check — async, but worth awaiting before the first frame
  const battery = await readBattery()
  if (battery && !battery.charging && battery.level < 0.20) {
    return TIER_CONSERVE
  }

  // CPU core count
  const cores = navigator.hardwareConcurrency || 2
  if (cores < 4) return TIER_CONSERVE

  // Device memory (in GB; not available on all browsers — missing = assume 2GB)
  const memoryGB = navigator.deviceMemory || 2
  if (memoryGB < 2) return TIER_CONSERVE

  // Mobile device — inherent thermal penalty
  if (isMobileDevice()) {
    // Modern mobile (8+ cores, 4GB+ RAM) qualifies for Standard.
    // We intentionally never put a phone into Monumental — a phone screen
    // is physically smaller (reducing the benefit of DPR 2.0) and
    // thermally constrained (increasing the cost of running it).
    return TIER_STANDARD
  }

  // Baseline desktop / tablet — capable but not top-tier
  if (cores < 8 || memoryGB < 4) {
    return TIER_STANDARD
  }

  // High-end desktop / high-performance tablet (iPad Pro with M-series chip)
  return TIER_MONUMENTAL
}


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — TIER INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the tier for this device and session.
 *
 * On first call: runs detection (async, ~5–50ms) and stores the result.
 * On subsequent calls within the same browser session: returns the
 *   cached sessionStorage value instantly.
 *
 * Should be called in LivingCanvas.jsx as early as possible — ideally
 * before the canvas element is even sized, so the correct pixel ratio
 * is applied on the very first render rather than causing a resize.
 *
 * @returns {Promise<string>} — one of TIER_MONUMENTAL, TIER_STANDARD, TIER_CONSERVE
 */
export async function resolveTier() {
  const stored = getStoredTier()
  if (stored && TIER_CONFIGS[stored]) return stored

  const detected = await detectTier()
  storeTier(detected)
  return detected
}


/**
 * Returns the config object for a given tier name.
 * Synchronous — use after resolveTier() has completed.
 *
 * @param {string} tierName
 * @returns {Object} — the frozen tier config
 */
export function getTierConfig(tierName) {
  return TIER_CONFIGS[tierName] ?? TIER_CONFIGS[TIER_STANDARD]
}


/**
 * Convenience function: resolves tier and returns its config in one call.
 *
 * @returns {Promise<Object>}
 */
export async function getActiveConfig() {
  const tier = await resolveTier()
  return getTierConfig(tier)
}


// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC DOWNGRADE SYSTEM
//
// The PerformanceMonitor class is instantiated by LivingCanvas.jsx
// and receives a frame timestamp on every animation frame.
// It maintains a rolling window of frame intervals and computes
// whether the device is sustaining its target FPS.
//
// When sustained underperformance is detected, it calls the onDowngrade
// callback provided by LivingCanvas.jsx, which updates the active config
// and reconstructs the rendering parameters.
//
// The downgrade is one-directional within a session — once downgraded,
// the tier never upgrades back. Even if the device cools and recovers,
// upgrading mid-session would cause a visible quality jump that would
// feel like a glitch. The user will simply get a fresh tier assessment
// next time they open the app.
// ─────────────────────────────────────────────────────────────────────────────

export class PerformanceMonitor {
  /**
   * @param {Object} config — the current tier config from getTierConfig()
   * @param {Function} onDowngrade — called with the new config when a downgrade is triggered
   */
  constructor(config, onDowngrade) {
    this._config         = config
    this._onDowngrade    = onDowngrade
    this._frameTimes     = []              // rolling window of frame intervals (ms)
    this._lastFrameTime  = null
    this._lastCheckTime  = performance.now()
    this._lastDowngrade  = 0              // timestamp of last downgrade
    this._downgraded     = false          // was a downgrade already triggered this session?
  }

  /**
   * Call on every animation frame with the current timestamp.
   * Returns immediately — designed to be O(1) overhead.
   *
   * @param {number} now — performance.now() timestamp
   */
  recordFrame(now) {
    if (this._lastFrameTime !== null) {
      const delta = now - this._lastFrameTime
      this._frameTimes.push(delta)

      // Keep the rolling window at its defined size
      if (this._frameTimes.length > DROPPED_FRAME_WINDOW) {
        this._frameTimes.shift()
      }
    }
    this._lastFrameTime = now

    // Only evaluate downgrade on the sample interval, not every frame
    if (now - this._lastCheckTime >= PERFORMANCE_SAMPLE_INTERVAL_MS) {
      this._lastCheckTime = now
      this._evaluatePerformance(now)
    }
  }

  /**
   * Evaluates the rolling frame window and triggers a downgrade if warranted.
   * Called automatically by recordFrame() on the sample interval.
   *
   * @private
   */
  _evaluatePerformance(now) {
    if (this._frameTimes.length < DROPPED_FRAME_WINDOW * 0.5) return  // not enough data yet
    if (now - this._lastDowngrade < DOWNGRADE_COOLDOWN_MS) return      // in cooldown period

    const budget  = this._config.frameInterval * FRAME_BUDGET_MULTIPLIER
    const dropped = this._frameTimes.filter(dt => dt > budget).length
    const ratio   = dropped / this._frameTimes.length

    if (ratio >= DROPPED_FRAME_RATIO_THRESHOLD) {
      this._triggerDowngrade(now)
    }
  }

  /**
   * Performs the downgrade: determines the next-lower tier, updates
   * internal config, clears the frame buffer (stale data from the
   * higher tier is meaningless for the lower tier's budget), and
   * notifies LivingCanvas.jsx via the callback.
   *
   * @private
   */
  _triggerDowngrade(now) {
    const tierOrder = [TIER_MONUMENTAL, TIER_STANDARD, TIER_CONSERVE]
    const currentIdx = tierOrder.indexOf(this._config.name)

    if (currentIdx === -1 || currentIdx >= tierOrder.length - 1) {
      // Already at CONSERVE — no lower tier available
      return
    }

    const newTierName = tierOrder[currentIdx + 1]
    const newConfig   = getTierConfig(newTierName)

    // Persist the downgraded tier so it survives same-session navigation
    storeTier(newTierName)

    this._config      = newConfig
    this._lastDowngrade = now
    this._frameTimes  = []   // clear stale data
    this._downgraded  = true

    console.info(
      `[Alinda] Canvas performance downgrade: ${tierOrder[currentIdx]} → ${newTierName}. ` +
      `The canvas has adjusted to protect device thermals.`
    )

    this._onDowngrade(newConfig)
  }

  /**
   * Returns the current active config object (may differ from the initial
   * config if a downgrade was triggered mid-session).
   *
   * @returns {Object}
   */
  getConfig() {
    return this._config
  }

  /**
   * Returns true if a downgrade was triggered at any point this session.
   * Used by LivingCanvas.jsx to log telemetry (future: send to backend
   * as a signal that the user's device was under stress — potentially
   * relevant clinical context for "why was Partner A's engagement low?").
   *
   * @returns {boolean}
   */
  wasDowngraded() {
    return this._downgraded
  }

  /**
   * Returns current performance stats for debugging.
   * Not called in production — available for development inspection.
   *
   * @returns {Object}
   */
  getStats() {
    if (this._frameTimes.length === 0) return { avgFPS: null, droppedRatio: 0 }
    const avgDelta = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length
    const budget   = this._config.frameInterval * FRAME_BUDGET_MULTIPLIER
    const dropped  = this._frameTimes.filter(dt => dt > budget).length
    return {
      tierName:     this._config.name,
      avgFPS:       Math.round(1000 / avgDelta),
      targetFPS:    this._config.targetFPS,
      droppedRatio: (dropped / this._frameTimes.length).toFixed(3),
      sampleSize:   this._frameTimes.length,
    }
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// VISIBILITY PAUSE HELPER
//
// When the app is backgrounded (user switches apps on mobile), the
// animation loop should pause entirely — both to conserve battery and
// because the canvas has no reason to compute when no one can see it.
// The canvas loop itself handles the pause; this file exports the
// relevant Page Visibility API event name as a constant so the canvas
// engine doesn't have a magic string dependency.
// ─────────────────────────────────────────────────────────────────────────────

export const VISIBILITY_CHANGE_EVENT = 'visibilitychange'

/**
 * Returns true if the document is currently visible to the user.
 * The canvas loop should check this before scheduling each frame.
 *
 * @returns {boolean}
 */
export function isDocumentVisible() {
  return typeof document !== 'undefined'
    ? document.visibilityState === 'visible'
    : true
}


// ─────────────────────────────────────────────────────────────────────────────
// REDUCED MOTION QUERY EXPORT
//
// Exported here because the canvas engine needs to re-check this
// during the session (e.g. if a user enables reduced motion in
// system preferences while the app is open). Other parts of the app
// use Framer Motion's useReducedMotion hook; the canvas engine uses
// this direct query since it runs outside React.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a MediaQueryList for prefers-reduced-motion.
 * The canvas engine can add an event listener to this to detect
 * OS-level motion preference changes in real time.
 *
 * @returns {MediaQueryList | null}
 */
export function getReducedMotionQuery() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)')
  } catch {
    return null
  }
}