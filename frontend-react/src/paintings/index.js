/**
 * src/paintings/index.js
 *
 * The painting registry — the strict border guard between the UI layer
 * and the canvas engine. No component imports a painting object directly.
 * Everything passes through this file.
 *
 * THREE RESPONSIBILITIES:
 *
 * 1. SAFE ACCESS — getPainting() catches any invalid or corrupted style key
 *    (from a WebSocket payload, a corrupted localStorage, a future database
 *    migration that introduced a new key before the frontend knew about it)
 *    and returns a known-safe fallback without crashing the canvas engine.
 *
 * 2. UI CONTRACT — STYLE_MANIFEST is the single source of truth for the
 *    IntakeScreen. Adding a fifth painting style requires only adding an
 *    entry here — the IntakeScreen renders dynamically from this data.
 *    No component hardcodes the four style names.
 *
 * 3. PREVIEW PARAMS — getPreviewPainting() returns a lightweight version
 *    of any painting for the IntakeScreen's small animated preview canvases.
 *    The full wash layer and particle count are expensive; previews get
 *    higher opacity and no wash layer so colors read at thumbnail size.
 *
 * CLINICAL NOTE ON DESCRIPTIONS:
 *    The descriptions in STYLE_MANIFEST are written for therapy clients,
 *    not art audiences. They describe the felt quality of the environment,
 *    not the painting technique. A client choosing "Gentle" should feel
 *    they are choosing how they want to be met, not what art they like.
 */

import gentle    from './gentle'
import direct    from './direct'
import practical from './practical'
import balanced  from './balanced'


// ─────────────────────────────────────────────────────────────────────────────
// THE MASTER REGISTRY
//
// Frozen: nothing can add, remove, or mutate entries at runtime.
// ─────────────────────────────────────────────────────────────────────────────

const PAINTINGS = Object.freeze({
  gentle,
  direct,
  practical,
  balanced,
})

const VALID_STYLES = new Set(Object.keys(PAINTINGS))

const FALLBACK_KEY = 'balanced'


// ─────────────────────────────────────────────────────────────────────────────
// STYLE MANIFEST
//
// The complete UI contract for each painting style.
// IntakeScreen reads from this — nothing is hardcoded in the component.
//
// Fields:
//   key              — the string the backend stores and the canvas consumes
//   title            — human-readable display name
//   intakeLabel      — the short descriptor under the title on IntakeScreen
//   description      — the therapeutic framing a client reads to make their
//                      choice; written in second person, inviting not prescriptive
//   paintingRef      — the artwork it draws from, not shown to users by default
//                      but available for an "about this space" screen later
//   previewColors    — [r,g,b] arrays for the animated mini-canvas previews
//                      on IntakeScreen; drawn directly onto a tiny canvas
//                      without the full wash layer for performance
//   accentHex        — the color used for this style's card border, selection
//                      ring, and any UI accent on screens specific to this style
//   sessionPhaseAffinity — which session phases this style best serves,
//                      as a hint for future adaptive-style features
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_MANIFEST = Object.freeze([
  Object.freeze({
    key:        'gentle',
    title:      'Gentle',
    intakeLabel: 'Soft and unhurried',
    description: (
      'A slow, held space. Colours arrive the way watercolour soaks into paper — ' +
      'soft at the edges, no hard lines, nothing demanded before you are ready. ' +
      'For when you need to feel steady before you find the words.'
    ),
    paintingRef: 'Helen Frankenthaler — Mountains and Sea, 1952',
    previewColors: [
      [95,  165, 195],   // cerulean sea wash
      [208, 130, 110],   // coral mountain
      [130, 175, 140],   // sage coast
    ],
    accentHex: '#8DB9C7',   // the cerulean — soft and aquatic
    sessionPhaseAffinity: ['opening', 'deepening'],
  }),

  Object.freeze({
    key:        'direct',
    title:      'Direct',
    intakeLabel: 'Clear and precise',
    description: (
      'Cold light in a winter room. Luminous, architectural, unambiguous. ' +
      'For when you know what you need to say and want a space that does not ' +
      'soften the edges of it before you have had the chance to.'
    ),
    paintingRef: 'Chu Teh-Chun — Évocation Hivernale, 1988',
    previewColors: [
      [245, 240, 218],   // luminous warm white — the light source
      [155, 188, 218],   // ice blue — the cold atmosphere
      [215, 178, 80],    // amber gold — the distant ember
    ],
    accentHex: '#9BB8D6',   // ice blue — precise and cool
    sessionPhaseAffinity: ['exploration', 'resolution'],
  }),

  Object.freeze({
    key:        'practical',
    title:      'Practical',
    intakeLabel: 'Forward-moving',
    description: (
      'Gestural, urgent, always mid-motion. The kind of space where marks ' +
      'are made quickly and move forward. For when you want to work through ' +
      'something rather than sit inside it — to understand by doing, not by waiting.'
    ),
    paintingRef: 'Cy Twombly — Leda and the Swan, 1962',
    previewColors: [
      [175, 168, 158],   // warm ash grey — the chalk hand
      [220, 195, 175],   // pale flesh — the body's warmth
      [165, 90,  75],    // red-brown — the urgent accent
    ],
    accentHex: '#A59688',   // warm ash — restrained, purposeful
    sessionPhaseAffinity: ['exploration', 'resolution', 'closing'],
  }),

  Object.freeze({
    key:        'balanced',
    title:      'Balanced',
    intakeLabel: 'Open and complex',
    description: (
      'Many things moving at once, held together by invisible structure. ' +
      'Rich, layered, never fully resolved — because some things do not need ' +
      'to be. For when you are not sure what you need, or when you need ' +
      'the room to hold more than one thing at a time.'
    ),
    paintingRef: 'Jackson Pollock — Blue Poles, 1952',
    previewColors: [
      [215, 215, 210],   // aluminum silver — the luminous ground
      [42,  65,  140],   // deep pole blue — the namesake, rarest
      [210, 155, 45],    // golden ochre — the warmth and energy
    ],
    accentHex: '#6B7EC8',   // the pole blue — structural, present
    sessionPhaseAffinity: ['opening', 'exploration', 'deepening'],
  }),
])


// ─────────────────────────────────────────────────────────────────────────────
// LIGHTWEIGHT OVERRIDES FOR INTAKE SCREEN MINI-PREVIEWS
//
// The four small animated canvases on the IntakeScreen style selector
// should not run the full wash layer (5 gradient objects per frame on a
// 120×120 canvas would be relatively expensive for 4 simultaneous canvases)
// and should use higher particle opacity so colors read at thumbnail size.
//
// These are applied on top of the base painting params in getPreviewPainting().
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_OVERRIDES = Object.freeze({
  // Disable wash layer — too expensive for 4 simultaneous small canvases
  washColors:      [],
  washSpeed:       0,
  washEnabled:     false,

  // Higher opacity so individual particles read at small size
  // (at full size, particles are numerous enough to accumulate; at 120×120 they need individual presence)
  particleOpacity: 0.80,

  // Less sediment so color stays visible longer in the small viewport
  ageSediment: 0.04,

  // Slightly faster flow so the preview looks alive rather than nearly-static
  // (the user is choosing between these in real time; they need to look distinct)
  flowSpeed: 0.55,

  // Slightly larger radius so dots are visible at thumbnail size
  particleRadius: 1.8,
})


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary painting resolver. The only way components access paintings.
 *
 * NEVER throws. On any invalid input, returns the balanced fallback.
 * The canvas engine should never receive undefined or null painting params.
 *
 * @param {string | null | undefined} key
 * @returns {Object} — a painting params object safe to pass to NoiseField
 */
export function getPainting(key) {
  if (!key || typeof key !== 'string') {
    return PAINTINGS[FALLBACK_KEY]
  }

  const normalized = key.trim().toLowerCase()

  if (VALID_STYLES.has(normalized)) {
    return PAINTINGS[normalized]
  }

  console.warn(
    `[paintings/index] Unknown style key '${key}'. ` +
    `Valid keys are: ${[...VALID_STYLES].join(', ')}. ` +
    `Falling back to '${FALLBACK_KEY}'.`
  )

  return PAINTINGS[FALLBACK_KEY]
}


/**
 * Returns lightweight painting params for the IntakeScreen's animated
 * mini-preview canvases. Disables the wash layer and adjusts visual
 * params so the painting character reads at small canvas sizes.
 *
 * @param {string} key
 * @returns {Object}
 */
export function getPreviewPainting(key) {
  const base = getPainting(key)
  return { ...base, ...PREVIEW_OVERRIDES }
}


/**
 * Returns the full style manifest array for the IntakeScreen to render from.
 * Each entry contains all the information needed to display a style option:
 * title, description, preview colors, and accent color.
 *
 * @returns {ReadonlyArray<Object>}
 */
export function getAvailableStyles() {
  return STYLE_MANIFEST
}


/**
 * Returns the style manifest entry for a specific key.
 * Used when you need just the title/description/accent for a known key,
 * without needing the full painting params.
 *
 * @param {string} key
 * @returns {Object | null} — the manifest entry, or null if key is unknown
 */
export function getStyleInfo(key) {
  return STYLE_MANIFEST.find(s => s.key === key) ?? null
}


/**
 * Type guard — returns true if the string is a valid painting style key.
 * Used for input validation before making API calls or storing preferences.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isValidStyle(key) {
  return typeof key === 'string' && VALID_STYLES.has(key.trim().toLowerCase())
}


/**
 * Returns all valid style keys as an array.
 * Useful for iteration when you need keys but not the full manifest.
 *
 * @returns {string[]}
 */
export function getPaintingKeys() {
  return [...VALID_STYLES]
}


// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT
//
// The safe starting state before any session exists. Used by LivingCanvas.jsx
// before the sessionStore has data, by the test App.jsx, and as the
// absolute fallback in all resolver functions.
//
// Currently points to gentle (for visual testing).
// Will point to balanced when routing is implemented.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PAINTING_PARAMS = gentle