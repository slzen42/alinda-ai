/**
 * src/design/theme.js
 *
 * The resolution engine — the bridge between design tokens and the canvas.
 *
 * Contains pure utility functions. No state, no side effects.
 *
 * Consumed by:
 *   - src/canvas/engine/* — for color math and format conversion
 *   - src/canvas/LivingCanvas.jsx — for palette resolution on theme change
 *   - src/hooks/useTheme.js — for computing the active palette object
 *
 * NOT consumed by React UI components directly.
 * They use Tailwind classes that read CSS custom properties from index.css.
 * This file exists exclusively for JavaScript contexts where var() is
 * not accessible (canvas rendering contexts, Framer Motion values).
 */

import {
    olympian,
    titan,
    olympianHex,
    titanHex,
    canvasDefaults,
    duration,
    easing,
  } from './tokens'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MEMOIZATION
  //
  // The canvas engine calls hex conversion functions on every rendered
  // frame — up to 60 times per second. A Map cache ensures these string
  // operations happen exactly once per unique input rather than once per
  // frame, eliminating a real and measurable source of jank.
  // ─────────────────────────────────────────────────────────────────────────────
  
  const _hexToRgbCache   = new Map()
  const _rgbPaletteCache = new Map()
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HEX ↔ RGB UTILITIES
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Converts a hex color string to [r, g, b] integers (0–255).
   * Memoized — safe to call on every animation frame.
   *
   * @param {string} hex — e.g. '#EDEAE3' or 'EDEAE3'
   * @returns {[number, number, number]}
   */
  export function hexToRgb(hex) {
    if (_hexToRgbCache.has(hex)) return _hexToRgbCache.get(hex)
  
    const clean = hex.replace('#', '')
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    const result = [r, g, b]
  
    _hexToRgbCache.set(hex, result)
    return result
  }
  
  /**
   * Converts a hex color to normalized [r, g, b] floats (0.0–1.0).
   * Used by WebGL shader contexts which expect normalized values.
   *
   * @param {string} hex
   * @returns {[number, number, number]}
   */
  export function hexToRgbNormalized(hex) {
    const [r, g, b] = hexToRgb(hex)
    return [r / 255, g / 255, b / 255]
  }
  
  /**
   * Converts a hex color and an alpha value to a CSS rgba() string.
   * Used when the canvas engine constructs CSS color values dynamically.
   *
   * @param {string} hex
   * @param {number} alpha — 0.0 to 1.0
   * @returns {string} — 'rgba(237, 234, 227, 0.5)'
   */
  export function hexToRgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
  }
  
  /**
   * Linearly interpolates between two hex colors.
   * Used by the canvas engine for smooth color transitions between
   * session phases and between painting styles.
   *
   * @param {string} hexA — start color
   * @param {string} hexB — end color
   * @param {number} t — 0.0 (full A) to 1.0 (full B)
   * @returns {string} — interpolated hex color
   */
  export function lerpColor(hexA, hexB, t) {
    const clamped    = Math.max(0, Math.min(1, t))
    const [r1,g1,b1] = hexToRgb(hexA)
    const [r2,g2,b2] = hexToRgb(hexB)
  
    const r = Math.round(r1 + (r2 - r1) * clamped)
    const g = Math.round(g1 + (g2 - g1) * clamped)
    const b = Math.round(b1 + (b2 - b1) * clamped)
  
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PALETTE RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Returns the complete token object for the current theme.
   * The single function the canvas calls when the user toggles modes.
   *
   * @param {'light' | 'dark'} mode
   * @returns {typeof olympian}
   */
  export function getCanvasPalette(mode) {
    return mode === 'dark' ? titan : olympian
  }
  
  /**
   * Returns the hex-only token object for the current theme.
   * Used by canvas math that works exclusively with pure hex values.
   *
   * @param {'light' | 'dark'} mode
   * @returns {typeof olympianHex}
   */
  export function getHexPalette(mode) {
    return mode === 'dark' ? titanHex : olympianHex
  }
  
  /**
   * Returns the full set of canvas-ready [r, g, b] integer arrays for
   * the current theme. Called once per theme change; the result is held
   * in the canvas engine's memory for the duration of that theme —
   * not recomputed per frame.
   *
   * @param {'light' | 'dark'} mode
   * @returns {Object.<string, [number, number, number]>}
   */
  export function getRgbPalette(mode) {
    if (_rgbPaletteCache.has(mode)) return _rgbPaletteCache.get(mode)
  
    const hex = getHexPalette(mode)
    const result = {}
    for (const [key, value] of Object.entries(hex)) {
      result[key] = hexToRgb(value)
    }
  
    _rgbPaletteCache.set(mode, result)
    return result
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DEVICE / CANVAS RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Calculates the optimal canvas pixel ratio for this device.
   *
   * A Retina iPhone has a device pixel ratio of 3.0 — a 390px wide canvas
   * would render at 1170 physical pixels, which is visually perfect but
   * 3× the GPU cost of ratio 1.0. We cap at 2.0 for the LivingCanvas,
   * since the flow-field's inherent softness makes sub-pixel precision
   * above 2.0 imperceptible while the performance cost remains very real.
   *
   * This cap applies only to the LivingCanvas — the DOM renders at native
   * device resolution; Tailwind and React are unaffected.
   *
   * @param {'high' | 'standard'} qualityTier — from canvas/engine/qualityTiers.js
   * @returns {number}
   */
  export function getCanvasPixelRatio(qualityTier) {
    const deviceRatio = typeof window !== 'undefined'
      ? (window.devicePixelRatio || 1)
      : 1
    const cap = qualityTier === 'high' ? 2.0 : 1.5
    return Math.min(deviceRatio, cap)
  }
  
  /**
   * Returns the physical pixel dimensions the canvas element should be
   * set to, accounting for the capped pixel ratio and the actual CSS size.
   *
   * @param {number} cssWidth
   * @param {number} cssHeight
   * @param {'high' | 'standard'} qualityTier
   * @returns {{ width: number, height: number, ratio: number }}
   */
  export function getCanvasDimensions(cssWidth, cssHeight, qualityTier) {
    const ratio = getCanvasPixelRatio(qualityTier)
    return {
      width:  Math.round(cssWidth  * ratio),
      height: Math.round(cssHeight * ratio),
      ratio,
    }
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION PHASE → CANVAS PROGRESS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Maps a session phase name to a normalized 0–1 progress value.
   *
   * Drives the canvas's gradual "resolving" effect over the course of
   * the session: 0.0 is maximally open, diffuse, and breathing —
   * the way the session begins before anything has been said. 1.0 is
   * settled, coherent, and still — the way a session feels when
   * something true has been worked through.
   *
   * The canvas never snaps between these values; phaseInterpolation.js
   * lerps between them over the full phase duration.
   *
   * @param {string} phase — session_phase from the backend FSM
   * @returns {number} — 0.0 to 1.0
   */
  export function phaseToProgress(phase) {
    const map = {
      opening:     0.0,
      exploration: 0.2,
      deepening:   0.5,
      resolution:  0.75,
      closing:     1.0,
    }
    return map[phase] ?? 0.0
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FSM MODE → CANVAS STATE NAME
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Maps a backend FSM mode string to the canvas state name used by
   * LivingCanvas.jsx to select which canvas/states/*.js parameters are active.
   *
   * The mapping is intentionally conservative — when in doubt, default
   * to 'guided' rather than to any extreme state. The canvas should only
   * reach 'stillness' when the backend explicitly signals crisis or lockdown.
   *
   * @param {string} mode — session.mode from SessionStateResponse
   * @returns {'idle' | 'waiting' | 'guided' | 'cooldown' | 'stillness' | 'breakthrough'}
   */
  export function modeToCanvasState(mode) {
    const map = {
      intake:            'idle',
      ready_for_session: 'waiting',
      guided:            'guided',
      free_chat:         'guided',     // free_chat is calm, not different from guided
      cooldown:          'cooldown',
      safety_lockdown:   'stillness',  // the quietest possible visual state
      crisis_pause:      'stillness',
      paused:            'cooldown',   // paused feels like a gentler cooldown
      wrapping_up:       'guided',
      closed:            'idle',
    }
    return map[mode] ?? 'guided'
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EASING EXPORT BRIDGE
  //
  // Framer Motion accepts easing arrays directly; the canvas engine
  // uses them via a manual cubic-bezier evaluator. Both import from
  // tokens.js via this re-export so there is one import per consumer.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export { easing, duration }
  
  
  /**
   * Evaluates a cubic-bezier easing curve at time t.
   * Used by the canvas engine for its own non-Framer-Motion interpolations,
   * since the canvas runs outside React's animation loop.
   *
   * This is a simplified but accurate cubic-bezier solver sufficient for
   * the gentle easing curves used here (none of which have inflection points
   * or extreme control point values that would require Newton-Raphson iteration).
   *
   * @param {[number, number, number, number]} curve — [p1x, p1y, p2x, p2y]
   * @param {number} t — input time 0.0 to 1.0
   * @returns {number} — eased value 0.0 to 1.0
   */
  export function applyCubicBezier([p1x, p1y, p2x, p2y], t) {
    // Binary search for x, then evaluate y at that parameter.
    // Accurate to within 0.0001 — imperceptible at 60fps.
    let lo = 0, hi = 1, mid
  
    const bezierX = (u) =>
      3 * p1x * u * (1 - u) ** 2 + 3 * p2x * u ** 2 * (1 - u) + u ** 3
  
    const bezierY = (u) =>
      3 * p1y * u * (1 - u) ** 2 + 3 * p2y * u ** 2 * (1 - u) + u ** 3
  
    for (let i = 0; i < 16; i++) {
      mid = (lo + hi) / 2
      const x = bezierX(mid)
      if (Math.abs(x - t) < 0.0001) break
      if (x < t) lo = mid
      else        hi = mid
    }
  
    return bezierY(mid)
  }
  

  
  // ─────────────────────────────────────────────────────────────────────────────
  // CANVAS DEFAULTS RE-EXPORT
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Re-exported so canvas files only need to import from theme.js rather
  // than importing from both theme.js and tokens.js separately.
  export { canvasDefaults }