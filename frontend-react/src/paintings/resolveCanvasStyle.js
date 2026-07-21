/**
 * src/paintings/resolveCanvasStyle.js
 *
 * The clinical arbitration engine for canvas style resolution.
 *
 * Accepts all the messy, real-world inputs — two partners' preferences,
 * the backend's resolution strategy, the session's override — and returns
 * a single definitive painting key that the canvas engine can use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE STRATEGIES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ASYMMETRIC ('asymmetric'):
 *   The default strategy when partners chose different styles.
 *   Each partner's device renders their own chosen painting.
 *   Partner A might be in Frankenthaler's cerulean washes while Partner B
 *   is in Teh-Chun's cold winter light — the same session, different lenses.
 *   This is Strategy A and it is the design decision we committed to.
 *   The canvas is purely local to the device; no data is shared.
 *
 * MATCHED ('matched'):
 *   When partners chose the same style, or when the backend resolved a
 *   clinical compromise between their choices. Both devices render the
 *   same painting environment. The backend has already computed which
 *   painting to use (via session_manager._resolve_session_style()) and
 *   sends it as `sessionStyle` in the session state.
 *
 * SAFETY OVERRIDE ('safety_override'):
 *   The backend detected that one partner's nervous system needs a specific
 *   environment regardless of stated preferences (high intake vulnerability
 *   combined with a gentle selection — the gentle selection wins for both).
 *   The backend sends `sessionStyle` and `styleResolution='safety_override'`.
 *   Both devices receive the same environment. User preferences are ignored.
 *   Clinical safety takes precedence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMPROMISE MATRIX (Client-side reference)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When `styleResolution === 'matched'`, the backend has already resolved the
 * compromise and sends it in `sessionStyle`. The matrix below is the client-
 * side documentation of the clinical logic the backend applied, plus a
 * client-side fallback for edge cases where `sessionStyle` is missing.
 *
 * Clinical rationale for each combination:
 *   gentle + gentle   → gentle    (unanimous)
 *   gentle + direct   → gentle    (protect the vulnerable register)
 *   gentle + practical → balanced (meet in the middle)
 *   gentle + balanced  → gentle   (gentle accommodates the unsure partner)
 *   direct + direct   → direct    (unanimous)
 *   direct + practical → direct   (both action-oriented; direct has more energy)
 *   direct + balanced  → balanced (balanced accommodates the structured partner)
 *   practical + practical → practical (unanimous)
 *   practical + balanced  → balanced  (balanced accommodates the forward partner)
 *   balanced + balanced   → balanced  (unanimous)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRE-SESSION BEHAVIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Before both partners have submitted intake (styleResolution is null or
 * undefined), the function falls back to the role's own style if known,
 * then to the shared session style, then to 'balanced'.
 * This means:
 *   - Partner A's waiting screen shows their chosen style (if submitted)
 *   - Partner B's waiting screen shows their chosen style (if submitted)
 *   - Pre-submission: both see 'balanced'
 *   - This transition is handled gracefully without any special case logic
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORT AND USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   import { resolveCanvasStyle } from 'paintings/resolveCanvasStyle'
 *   import { useSessionStore }    from 'store/sessionStore'
 *
 *   // In LivingCanvas.jsx:
 *   const sessionStyleA   = useSessionStore(s => s.session?.session_style_a ?? 'balanced')
 *   const sessionStyleB   = useSessionStore(s => s.session?.session_style_b ?? 'balanced')
 *   const styleResolution = useSessionStore(s => s.session?.style_resolution ?? null)
 *   const sessionStyle    = useSessionStore(s => s.session?.session_style ?? 'balanced')
 *
 *   const paintingKey = resolveCanvasStyle(
 *     role,             // 'a' or 'b' — the role prop on LivingCanvas
 *     sessionStyleA,
 *     sessionStyleB,
 *     styleResolution,
 *     sessionStyle,
 *   )
 */

import { isValidStyle } from './index'


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK = 'balanced'

/**
 * Validates and normalizes a style key.
 * Returns the key if valid, null if not.
 * Null is used rather than the fallback so callers can chain fallbacks.
 *
 * @param {string | null | undefined} key
 * @returns {string | null}
 */
function validated(key) {
  if (!key || typeof key !== 'string') return null
  const normalized = key.trim().toLowerCase()
  return isValidStyle(normalized) ? normalized : null
}


// ─────────────────────────────────────────────────────────────────────────────
// COMPROMISE MATRIX
//
// Maps [styleA, styleB] → the shared painting key.
// Used as a client-side fallback when styleResolution is 'matched' but
// sessionStyle is missing or invalid.
// Also used by IntakeScreen to preview the compromise before both partners
// have submitted (if Partner A has submitted and the UI wants to show what
// the shared result will be if both choose the same strategy).
// ─────────────────────────────────────────────────────────────────────────────

const COMPROMISE_MATRIX = Object.freeze({
  'gentle+gentle':     'gentle',
  'gentle+direct':     'gentle',     // protect the vulnerable register
  'gentle+practical':  'balanced',   // meet in the middle
  'gentle+balanced':   'gentle',     // gentle accommodates the unsure partner
  'direct+gentle':     'gentle',     // symmetric
  'direct+direct':     'direct',
  'direct+practical':  'direct',     // both action-oriented
  'direct+balanced':   'balanced',   // balanced accommodates structured
  'practical+gentle':  'balanced',   // symmetric
  'practical+direct':  'direct',     // symmetric
  'practical+practical': 'practical',
  'practical+balanced':  'balanced', // balanced accommodates forward
  'balanced+gentle':   'gentle',     // symmetric
  'balanced+direct':   'balanced',   // symmetric
  'balanced+practical': 'balanced',  // symmetric
  'balanced+balanced': 'balanced',
})

/**
 * Resolves the clinical compromise between two style choices.
 * Used internally and exported for IntakeScreen preview logic.
 *
 * @param {string} styleA
 * @param {string} styleB
 * @returns {string}
 */
export function resolveCompromise(styleA, styleB) {
  const a = validated(styleA) ?? FALLBACK
  const b = validated(styleB) ?? FALLBACK
  return COMPROMISE_MATRIX[`${a}+${b}`] ?? FALLBACK
}


// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY RESOLUTION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the correct painting key for a specific partner's device.
 *
 * This function is the single entry point for all canvas style decisions.
 * It handles all three strategies and all edge cases, always returning a
 * valid painting key regardless of input quality.
 *
 * Decision order:
 *   1. Safety override → use sessionStyle (backend takes full control)
 *   2. Matched → use sessionStyle (backend resolved the compromise)
 *   3. Asymmetric → use this device's own role-specific style (Strategy A)
 *   4. No resolution yet → role-specific style → sessionStyle → 'balanced'
 *
 * @param {'a' | 'b'} role           — which partner is viewing this device
 * @param {string | null} styleA     — Partner A's intake choice
 * @param {string | null} styleB     — Partner B's intake choice
 * @param {string | null} styleResolution — 'asymmetric' | 'matched' | 'safety_override' | null
 * @param {string | null} sessionStyle    — the backend-resolved shared style
 * @returns {'gentle' | 'direct' | 'practical' | 'balanced'}
 */
export function resolveCanvasStyle(
  role,
  styleA,
  styleB,
  styleResolution,
  sessionStyle,
) {
  // ── Strategy C: Safety Override ───────────────────────────────────────────
  // Backend has determined a clinical necessity. Both partners see the same
  // painting regardless of their preferences. No further logic applies.
  if (styleResolution === 'safety_override') {
    return (
      validated(sessionStyle) ??
      resolveCompromise(styleA, styleB) ??
      FALLBACK
    )
  }

  // ── Strategy B: Matched ───────────────────────────────────────────────────
  // Partners chose the same style, or the backend resolved a compromise.
  // The backend's `sessionStyle` is the authoritative answer.
  // Client-side compromise matrix is the fallback if `sessionStyle` is missing.
  if (styleResolution === 'matched') {
    return (
      validated(sessionStyle) ??
      resolveCompromise(styleA, styleB) ??
      FALLBACK
    )
  }

  // ── Strategy A: Asymmetric ────────────────────────────────────────────────
  // Partners chose different styles and neither triggered the safety threshold.
  // This device renders its own role's chosen style.
  // The canvas is purely local — no synchronization between devices.
  if (styleResolution === 'asymmetric') {
    const myStyle = role === 'a' ? styleA : styleB
    return (
      validated(myStyle) ??
      validated(sessionStyle) ??
      FALLBACK
    )
  }

  // ── Pre-session / No resolution yet ──────────────────────────────────────
  // styleResolution is null or undefined — intake hasn't completed yet.
  // Show this partner's own choice if they've submitted intake,
  // otherwise the shared fallback, otherwise balanced.
  // This ensures Partner A's waiting screen shows Frankenthaler immediately
  // after they submit intake, without waiting for Partner B to submit.
  const myStyle = role === 'a' ? styleA : styleB
  return (
    validated(myStyle) ??
    validated(sessionStyle) ??
    FALLBACK
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// WAITING SCREEN RESOLVER
//
// Specialized resolver for the WaitingScreen — before both intakes are
// submitted. Shows the submitting partner their own chosen painting
// immediately, creating a sense of the space they will inhabit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the painting to show on the WaitingScreen.
 *
 * Called when this partner has submitted intake but the other hasn't yet.
 * Shows this partner's chosen style so they can sit with their environment
 * while waiting — not a neutral balanced screen, but their own space.
 *
 * @param {'a' | 'b'} role
 * @param {string | null} myStyle — this partner's style choice
 * @returns {'gentle' | 'direct' | 'practical' | 'balanced'}
 */
export function resolveWaitingStyle(role, myStyle) {
  return validated(myStyle) ?? FALLBACK
}


// ─────────────────────────────────────────────────────────────────────────────
// INTAKE SCREEN PREVIEW RESOLVER
//
// Returns what the shared result would be if both partners kept their
// current selections. Used by IntakeScreen to show "if you both choose X,
// you'll share Y" — a transparency feature for the matching system.
//
// Only relevant when styleResolution will be 'matched'.
// In asymmetric sessions, each partner gets their own — no preview needed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Previews the compromise result for the IntakeScreen.
 * Called with the current (possibly incomplete) style selections.
 *
 * @param {string | null} styleA — null if Partner A hasn't chosen yet
 * @param {string | null} styleB — null if Partner B hasn't chosen yet
 * @returns {string | null} — the compromise key, or null if either partner
 *   hasn't chosen yet (can't preview a compromise without both inputs)
 */

export function previewCompromise(styleA, styleB) {
  const a = validated(styleA)
  const b = validated(styleB)
  
  if (!a || !b) return null   // incomplete — can't preview yet
  return resolveCompromise(a, b)
}