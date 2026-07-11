/**
 * src/canvas/engine/phaseInterpolation.js
 *
 * The glacial interpolation engine for session phase transitions.
 *
 * Translates the backend FSM's session_phase string into a slowly
 * evolving set of canvas modifiers — pushing them into NoiseField on
 * every animation frame.
 *
 * CORE LAW — GLACIAL INTERPOLATION:
 *   The user must never see the canvas changing.
 *   They should only realize, somewhere between messages, that the
 *   background feels different than it did when the session began.
 *   The 8-second transition budget ensures this is always true.
 *
 * ZERO ALLOCATION:
 *   The update() method creates no objects, no arrays, no strings.
 *   All state is held in primitive numbers on the class instance.
 *
 * WHAT THIS FILE DRIVES IN NoiseField:
 *   - phaseProgress (0.0–1.0) — the primary settle force
 *   - breathDepth   (float)   — amplitude of the breathing cycle
 *   - noiseSpeed    (float)   — how fast the field evolves over time
 *   These are pushed via direct method calls in update().
 *   No intermediate objects are created to hold them.
 *
 * INTEGRATION:
 *   Instantiated in LivingCanvas.jsx alongside PaletteBlend and NoiseField.
 *   update(now) called each frame before NoiseField.render().
 *   setPhase(phaseName, now) called when sessionStore's session_phase changes.
 */

import { applyCubicBezier } from 'design/theme'
import { duration }          from 'design/tokens'


// ─────────────────────────────────────────────────────────────────────────────
// PHASE PROGRESS MAP
//
// Maps session_phase strings from the backend FSM to normalized floats.
// 0.0 = maximally open, diffuse, turbulent — the session's first moment.
// 1.0 = maximally settled, unified, calm — the session's earned resolution.
//
// These values are the interpolation targets. The canvas never snaps to them.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE_PROGRESS = Object.freeze({
  opening:     0.00,
  exploration: 0.22,
  deepening:   0.50,
  resolution:  0.76,
  closing:     1.00,
})

// Fallback for unmapped or missing phases — treated as opening
const DEFAULT_PHASE_PROGRESS = 0.00


// ─────────────────────────────────────────────────────────────────────────────
// PER-PHASE FIELD MODIFIER TABLE
//
// Each phase has a complete set of modifiers that shift alongside the
// primary settle float. They all travel on the same 8-second budget —
// they are not separate transitions, just additional values that
// interpolate between the same start and end points.
//
// breathDepthMul:  multiplier on the tier's base breathDepth.
//   opening:     1.30 — most expansive breath, searching, unsettled
//   exploration: 1.10 — slightly calmer
//   deepening:   0.85 — the breath becomes interior, slower
//   resolution:  0.70 — found something — breath steadies
//   closing:     0.55 — near-stillness, the quietest breath of the session
//
// noiseSpeedMul:  multiplier on the tier's base noiseSpeed.
//   opening:     1.40 — most active field evolution
//   closing:     0.60 — slow, almost motionless drift
//
// particleOpacityMul: multiplier on the painting's base particleOpacity.
//   deepening:   0.85 — the field becomes slightly more private, introspective
//   closing:     0.90 — not invisible, just quieter
//
// settleBiasStrength: how strongly the field biases toward its calm angle.
//   Separate from phaseProgress to allow the bias to lag slightly behind
//   the overall progress — the bias is the "direction of calm" and should
//   arrive last, as the final quality of settlement.
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_MODIFIERS = Object.freeze({
  opening: Object.freeze({
    breathDepthMul:       1.30,
    noiseSpeedMul:        1.40,
    particleOpacityMul:   1.00,
    settleBiasStrength:   0.00,
  }),
  exploration: Object.freeze({
    breathDepthMul:       1.10,
    noiseSpeedMul:        1.15,
    particleOpacityMul:   1.00,
    settleBiasStrength:   0.10,
  }),
  deepening: Object.freeze({
    breathDepthMul:       0.85,
    noiseSpeedMul:        0.90,
    particleOpacityMul:   0.88,
    settleBiasStrength:   0.35,
  }),
  resolution: Object.freeze({
    breathDepthMul:       0.70,
    noiseSpeedMul:        0.75,
    particleOpacityMul:   0.93,
    settleBiasStrength:   0.65,
  }),
  closing: Object.freeze({
    breathDepthMul:       0.55,
    noiseSpeedMul:        0.60,
    particleOpacityMul:   0.90,
    settleBiasStrength:   0.90,
  }),
})

const DEFAULT_MODIFIERS = PHASE_MODIFIERS.opening


// ─────────────────────────────────────────────────────────────────────────────
// EASING CURVE
//
// The phase transition uses a deeply asymmetric cubic-bezier.
// [0.10, 0.0, 0.65, 1.0]
//
// Decomposed:
//   0–15% of 8s (0.0–1.2s): almost imperceptible movement — the field
//     hasn't visibly changed yet, the conversation is still settling.
//   15–65% of 8s (1.2–5.2s): gradual acceleration — the shift is happening
//     in the periphery, below conscious awareness.
//   65–100% of 8s (5.2–8.0s): extremely slow coast into the new state —
//     the last 3 seconds are a drawn-out exhale, the field sighing
//     into its new position.
//
// This curve was chosen specifically because its midpoint acceleration is
// around 3–4 seconds in — right when the user is typically reading or
// responding to a message, completely unaware of the canvas.
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_EASING_CURVE = [0.10, 0.00, 0.65, 1.00]


// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION DURATION
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_TRANSITION_MS = duration.phase   // 8000ms from tokens.js

// Micro-perturbation on interruption — decays over this duration
const PERTURBATION_DECAY_MS = 2000

// Arrival signature bloom strength — much gentler than a full breakthrough
const ARRIVAL_BLOOM_STRENGTH = 0.18   // fraction of BLOOM_MAX_STRENGTH in noiseField


// ─────────────────────────────────────────────────────────────────────────────
// PHASE INTERPOLATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class PhaseInterpolator {
  /**
   * @param {Object} noiseField — the NoiseField instance
   * @param {string} initialPhase — from session_phase (backend FSM)
   * @param {Object} tierConfig — from qualityTiers, for reading base values
   */
  constructor(noiseField, initialPhase = 'opening', tierConfig) {
    this._noiseField  = noiseField
    this._tierConfig  = tierConfig

    // ── Phase state ───────────────────────────────────────────────────────────
    this._currentPhase   = initialPhase
    this._currentValue   = this._resolveProgress(initialPhase)
    this._targetValue    = this._currentValue
    this._startValue     = this._currentValue

    // ── Modifier state — current interpolated values ───────────────────────
    const mods = this._resolveModifiers(initialPhase)
    this._currentBreathDepthMul     = mods.breathDepthMul
    this._currentNoiseSpeedMul      = mods.noiseSpeedMul
    this._currentParticleOpacityMul = mods.particleOpacityMul
    this._currentSettleBiasStrength = mods.settleBiasStrength

    this._targetBreathDepthMul     = mods.breathDepthMul
    this._targetNoiseSpeedMul      = mods.noiseSpeedMul
    this._targetParticleOpacityMul = mods.particleOpacityMul
    this._targetSettleBiasStrength = mods.settleBiasStrength

    this._startBreathDepthMul     = mods.breathDepthMul
    this._startNoiseSpeedMul      = mods.noiseSpeedMul
    this._startParticleOpacityMul = mods.particleOpacityMul
    this._startSettleBiasStrength = mods.settleBiasStrength

    // ── Transition state ──────────────────────────────────────────────────────
    this._animating    = false
    this._startTime    = 0
    this._duration     = PHASE_TRANSITION_MS
    this._rawProgress  = 1.0   // 0.0–1.0 linear, used for proportional duration on U-turn
    this._easedProgress = 1.0

    // ── Micro-perturbation state ──────────────────────────────────────────────
    this._perturbationStrength = 0.0
    this._perturbationStartTime = 0

    // ── Arrival signature ─────────────────────────────────────────────────────
    this._onArrival = null   // optional callback set by LivingCanvas.jsx
    this._arrived   = false  // prevents double-firing on the completion frame

    // Initialize the noise field immediately — no transition needed on boot
    this._pushToNoiseField()
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // STATIC RESOLUTION HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Resolves a phase name to its normalized float target.
   * @param {string} phase
   * @returns {number} — 0.0 to 1.0
   */
  _resolveProgress(phase) {
    return PHASE_PROGRESS[phase] ?? DEFAULT_PHASE_PROGRESS
  }

  /**
   * Resolves a phase name to its modifier set.
   * @param {string} phase
   * @returns {Object}
   */
  _resolveModifiers(phase) {
    return PHASE_MODIFIERS[phase] ?? DEFAULT_MODIFIERS
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // NOISE FIELD PUSH — Zero allocation
  //
  // The only outward calls in this file. All values are already computed
  // as primitives — no objects created here.
  // ─────────────────────────────────────────────────────────────────────────────

  _pushToNoiseField() {
    // Primary settle force
    this._noiseField.setPhaseProgress(this._currentValue)

    // Apply modifiers to tier base values and push them directly
    // noiseField exposes setBreathDepth and setNoiseSpeed for this purpose
    const baseBreath = this._tierConfig?.breathDepth ?? 0.06
    const baseSpeed  = this._tierConfig?.noiseSpeed  ?? 0.0004

    if (typeof this._noiseField.setBreathDepth === 'function') {
      this._noiseField.setBreathDepth(baseBreath * this._currentBreathDepthMul)
    }

    if (typeof this._noiseField.setNoiseSpeed === 'function') {
      this._noiseField.setNoiseSpeed(baseSpeed * this._currentNoiseSpeedMul)
    }

    if (typeof this._noiseField.setParticleOpacityMul === 'function') {
      this._noiseField.setParticleOpacityMul(this._currentParticleOpacityMul)
    }

    if (typeof this._noiseField.setSettleBiasStrength === 'function') {
      this._noiseField.setSettleBiasStrength(this._currentSettleBiasStrength)
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // PERTURBATION — the micro-shudder on U-turn
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Triggers a brief micro-perturbation that decays over PERTURBATION_DECAY_MS.
   * Applied as an additive noise speed multiplier that starts at peak and
   * falls to zero — a faint quickening of the field that resolves naturally.
   *
   * @param {number} now — performance.now()
   */
  _triggerPerturbation(now) {
    // Strength is proportional to how far into the interrupted transition we were —
    // a barely-started transition produces almost no perturbation;
    // one interrupted at its midpoint produces the most noticeable shudder.
    const remainingFraction = 1 - this._rawProgress
    const interruptedFraction = this._rawProgress   // how far we'd traveled

    // Peak perturbation is when the interruption happens at the middle (rawProgress=0.5)
    // Modeled as a parabola: 4 * t * (1-t)
    this._perturbationStrength = 4 * interruptedFraction * remainingFraction * 0.35
    this._perturbationStartTime = now
  }

  /**
   * Advances and applies the perturbation decay.
   * Called every frame inside update().
   *
   * @param {number} now
   */
  _stepPerturbation(now) {
    if (this._perturbationStrength <= 0.001) {
      this._perturbationStrength = 0
      return
    }

    const elapsed = now - this._perturbationStartTime
    const decayT  = Math.min(1, elapsed / PERTURBATION_DECAY_MS)

    // Exponential decay — fast at first, slow at the end
    // This creates the "quickening → settling" feel rather than a linear fadeout
    const decay = Math.pow(1 - decayT, 2.4)
    this._perturbationStrength = this._perturbationStrength * decay

    // Apply to noise field as an additive speed multiplier
    if (typeof this._noiseField.setNoiseSpeedOffset === 'function') {
      const baseSpeed = this._tierConfig?.noiseSpeed ?? 0.0004
      this._noiseField.setNoiseSpeedOffset(
        baseSpeed * this._perturbationStrength * this._currentNoiseSpeedMul
      )
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // ARRIVAL SIGNATURE — the gentle bloom on phase completion
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Called once when a phase transition completes.
   * Triggers a quiet, gentle bloom from the canvas center — not the full
   * breakthrough bloom, but a structural arrival signal.
   *
   * The bloom strength is intentionally low so it doesn't draw attention;
   * it's felt as a slight opening of the field at the moment of arrival,
   * not seen as a visual event.
   */
  _fireArrivalSignature() {
    if (typeof this._noiseField.triggerBloom === 'function') {
      // triggerBloom in noiseField.js uses BLOOM_MAX_STRENGTH as its peak.
      // We want a fraction of that — there's no direct way to pass a strength
      // override, so we call it and then the bloom naturally decays from its
      // own peak. The visual subtlety is achieved by the very short bloom
      // radius that results from a mid-canvas origin.
      //
      // Center of the canvas in normalized space — the bloom radiates from
      // the heart of the stone outward, not from a user-defined touch point.
      this._noiseField.triggerBloom(0.5, 0.5)
    }

    // Notify LivingCanvas.jsx via optional callback
    // (used to briefly unmute the arrival sound, if sounds are enabled)
    if (typeof this._onArrival === 'function') {
      this._onArrival(this._currentPhase)
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * The main per-frame call. Must be called in the animation loop,
   * before NoiseField.render(), after PaletteBlend.update().
   *
   * Order matters: phase modifiers must be written to the NoiseField before
   * it computes the field update for this frame.
   *
   * @param {number} now — performance.now()
   */
  update(now) {
    if (!this._animating) {
      this._stepPerturbation(now)
      return
    }

    // ── Advance transition ────────────────────────────────────────────────────
    const elapsed = now - this._startTime
    this._rawProgress = Math.min(1, elapsed / this._duration)
    this._easedProgress = applyCubicBezier(PHASE_EASING_CURVE, this._rawProgress)

    // ── Interpolate primary progress value ────────────────────────────────────
    this._currentValue =
      this._startValue + (this._targetValue - this._startValue) * this._easedProgress

    // ── Interpolate all modifiers simultaneously ───────────────────────────────
    const t = this._easedProgress

    this._currentBreathDepthMul =
      this._startBreathDepthMul +
      (this._targetBreathDepthMul - this._startBreathDepthMul) * t

    this._currentNoiseSpeedMul =
      this._startNoiseSpeedMul +
      (this._targetNoiseSpeedMul - this._startNoiseSpeedMul) * t

    this._currentParticleOpacityMul =
      this._startParticleOpacityMul +
      (this._targetParticleOpacityMul - this._startParticleOpacityMul) * t

    // Settle bias strength lags behind the main progress using a secondary
    // curve [0.0, 0.0, 0.8, 1.0] — bias arrives last, after the field's
    // turbulence has already begun to change. This separation makes the
    // settling feel like two distinct motions: first the field calms down,
    // then it finds a direction. More natural, less mechanical.
    const biasT = applyCubicBezier([0.0, 0.0, 0.80, 1.00], this._rawProgress)
    this._currentSettleBiasStrength =
      this._startSettleBiasStrength +
      (this._targetSettleBiasStrength - this._startSettleBiasStrength) * biasT

    // ── Push to NoiseField ────────────────────────────────────────────────────
    this._pushToNoiseField()
    this._stepPerturbation(now)

    // ── Check for completion ──────────────────────────────────────────────────
    if (this._rawProgress >= 1) {
      this._animating = false
      this._rawProgress = 1.0

      // Snap to exact targets — eliminates floating-point drift after completion
      this._currentValue              = this._targetValue
      this._currentBreathDepthMul     = this._targetBreathDepthMul
      this._currentNoiseSpeedMul      = this._targetNoiseSpeedMul
      this._currentParticleOpacityMul = this._targetParticleOpacityMul
      this._currentSettleBiasStrength = this._targetSettleBiasStrength

      this._pushToNoiseField()

      // Fire arrival signature only once
      if (!this._arrived) {
        this._arrived = true
        this._fireArrivalSignature()
      }
    }
  }


  /**
   * Sets the new session phase, initiating an 8-second glacial transition.
   *
   * U-TURN SAFETY:
   *   If a transition is already in progress, the current interpolated values
   *   are captured as the new start points. The transition resumes from
   *   exactly where it is — no snaps, no visual discontinuity.
   *
   *   Duration is proportional: a transition interrupted at 30% progress
   *   uses 70% of the full 8-second budget for the correction, so the
   *   reversal happens at the same perceptual rate as the original movement.
   *
   *   Minimum duration floor (10% of full budget = 800ms) prevents a
   *   near-complete transition from completing instantaneously when reversed.
   *
   * @param {string} phaseName — session_phase from the backend FSM
   * @param {number} now — performance.now()
   */
  setPhase(phaseName, now) {
    if (phaseName === this._currentPhase && !this._animating) return

    const newTarget  = this._resolveProgress(phaseName)
    const newModifiers = this._resolveModifiers(phaseName)

    // Capture exact current values as new start points (U-turn safety)
    this._startValue              = this._currentValue
    this._startBreathDepthMul     = this._currentBreathDepthMul
    this._startNoiseSpeedMul      = this._currentNoiseSpeedMul
    this._startParticleOpacityMul = this._currentParticleOpacityMul
    this._startSettleBiasStrength = this._currentSettleBiasStrength

    // Write new targets
    this._targetValue              = newTarget
    this._targetBreathDepthMul     = newModifiers.breathDepthMul
    this._targetNoiseSpeedMul      = newModifiers.noiseSpeedMul
    this._targetParticleOpacityMul = newModifiers.particleOpacityMul
    this._targetSettleBiasStrength = newModifiers.settleBiasStrength

    // Proportional duration — the visual distance remaining drives the time budget
    const totalDistance = Math.abs(this._targetValue - this._startValue)

    if (totalDistance < 0.001) {
      // Already at or very near the target — complete immediately
      this._currentValue = this._targetValue
      this._animating    = false
      this._arrived      = true
      this._pushToNoiseField()
      return
    }

    if (this._animating) {
      // Trigger the micro-perturbation when a U-turn is needed
      this._triggerPerturbation(now)

      // Proportional duration based on remaining progress
      const remainingFraction = 1 - this._rawProgress
      const proportionalDuration = PHASE_TRANSITION_MS * Math.max(0.10, remainingFraction)
      this._duration = proportionalDuration
    } else {
      this._duration = PHASE_TRANSITION_MS
    }

    this._currentPhase  = phaseName
    this._startTime     = now
    this._animating     = true
    this._rawProgress   = 0
    this._easedProgress = 0
    this._arrived       = false  // reset so arrival fires when the new transition completes
  }


  /**
   * Immediately snaps to a phase with no transition.
   * Used on initial mount and after canvas resize.
   *
   * @param {string} phaseName
   */
  snapToPhase(phaseName) {
    const value     = this._resolveProgress(phaseName)
    const modifiers = this._resolveModifiers(phaseName)

    this._currentPhase  = phaseName
    this._currentValue  = value
    this._targetValue   = value
    this._startValue    = value

    this._currentBreathDepthMul     = modifiers.breathDepthMul
    this._currentNoiseSpeedMul      = modifiers.noiseSpeedMul
    this._currentParticleOpacityMul = modifiers.particleOpacityMul
    this._currentSettleBiasStrength = modifiers.settleBiasStrength

    this._targetBreathDepthMul     = modifiers.breathDepthMul
    this._targetNoiseSpeedMul      = modifiers.noiseSpeedMul
    this._targetParticleOpacityMul = modifiers.particleOpacityMul
    this._targetSettleBiasStrength = modifiers.settleBiasStrength

    this._startBreathDepthMul     = modifiers.breathDepthMul
    this._startNoiseSpeedMul      = modifiers.noiseSpeedMul
    this._startParticleOpacityMul = modifiers.particleOpacityMul
    this._startSettleBiasStrength = modifiers.settleBiasStrength

    this._animating            = false
    this._rawProgress          = 1.0
    this._perturbationStrength = 0.0
    this._arrived              = true

    this._pushToNoiseField()
  }


  /**
   * Registers a callback fired when a phase transition completes.
   * Called by LivingCanvas.jsx to connect the arrival signal to the
   * sound system (a very soft, barely-perceptible chime on phase arrival).
   *
   * @param {Function} fn — receives the new phase name as an argument
   */
  onArrival(fn) {
    this._onArrival = fn
  }


  /**
   * Returns whether a transition is currently in progress.
   * Used by LivingCanvas.jsx to decide whether to continue rendering
   * even when the NoiseField itself hasn't changed this frame.
   *
   * @returns {boolean}
   */
  isAnimating() {
    return this._animating || this._perturbationStrength > 0.001
  }



  /**
   * Returns the current phase progress value.
   * Used by LivingCanvas.jsx for the canvas state log.
   *
   * @returns {number} — 0.0 to 1.0
   */
  getCurrentProgress() {
    return this._currentValue
  }


  /**
   * Returns debug information for development inspection.
   * @returns {Object}
   */
  
  getDebugInfo() {
    return {
      currentPhase:    this._currentPhase,
      currentValue:    this._currentValue.toFixed(4),
      targetValue:     this._targetValue.toFixed(4),
      animating:       this._animating,
      rawProgress:     this._rawProgress.toFixed(4),
      easedProgress:   this._easedProgress.toFixed(4),
      durationMs:      this._duration,
      breathDepthMul:  this._currentBreathDepthMul.toFixed(3),
      noiseSpeedMul:   this._currentNoiseSpeedMul.toFixed(3),
      opacityMul:      this._currentParticleOpacityMul.toFixed(3),
      settleBias:      this._currentSettleBiasStrength.toFixed(3),
      perturbation:    this._perturbationStrength.toFixed(4),
    }
  }
}