/**
 * src/paintings/resolveCanvasStyle.js
 *
 * Per-device painting resolution.
 *
 * Called by LivingCanvas.jsx with the current role and session style data
 * to determine which painting this specific device should render.
 *
 * The resolution logic mirrors exactly what the backend
 * session_manager._resolve_session_style() computed and stored.
 * This file does NOT re-run clinical logic — it simply reads
 * the already-resolved data from the session and applies it.
 *
 * Resolution hierarchy:
 *   matched/safety_override → use session_style (both devices see the same)
 *   asymmetric              → use this device's role-specific style
 *
 * @param {'a'|'b'} role
 * @param {string} styleA
 * @param {string} styleB
 * @param {'matched'|'asymmetric'|'safety_override'} styleResolution
 * @param {string} sessionStyle — the backend-resolved shared style
 * @returns {'gentle'|'direct'|'practical'|'balanced'}
 */
export function resolveCanvasStyle(role, styleA, styleB, styleResolution, sessionStyle) {
    const VALID = new Set(['gentle', 'direct', 'practical', 'balanced'])
    const fallback = 'balanced'
  
    if (styleResolution === 'asymmetric') {
      const roleStyle = role === 'a' ? styleA : styleB
      return VALID.has(roleStyle) ? roleStyle : fallback
    }
  
    return VALID.has(sessionStyle) ? sessionStyle : fallback
  }