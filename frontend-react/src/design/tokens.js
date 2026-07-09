/**
 * src/design/tokens.js
 *
 * The immutable ledger of design values for Alinda.
 *
 * This file contains zero logic. Pure static data only.
 * No imports. No functions. No conditionals.
 *
 * How this file is used:
 *   - theme.js imports from here for palette resolution and format conversion
 *   - animations/motionTokens.js imports easing and duration values
 *   - canvas/engine/* imports palette hex values and canvas defaults
 *   - React components do NOT import from here — they read CSS custom
 *     properties via Tailwind classes (e.g. bg-surface-base). This file
 *     is exclusively for JavaScript contexts where var() is inaccessible.
 *
 * Sync contract:
 *   Every hex value in this file has a corresponding CSS custom property
 *   in src/index.css. They must stay identical. There is no automatic
 *   enforcement — it is a manual contract. If a color changes, change it
 *   in both places.
 */


// ─────────────────────────────────────────────────────────────────────────────
// OLYMPIAN PALETTE — Light mode
//
// The weathered marble of the Acropolis frieze. Not white.
// Warm gray-ivory, centuries of atmosphere absorbed into the stone.
// Cooler on exposed surfaces, warmer in the recessed grooves.
// ─────────────────────────────────────────────────────────────────────────────

export const olympian = {
    // Surfaces — the physical stone
    surfaceBase:    '#EDEAE3',   // ground plane — raw weathered marble
    surfaceRaised:  '#F2EFE9',   // cards, inputs — facing the light
    surfaceOverlay: '#F7F4EF',   // overlays, modals — highest and palest
    surfaceEdge:    '#D4D0C8',   // borders — shadow caught in the grooves
  
    // Text — warm charcoal, not cold black
    textPrimary:   '#2E2B27',
    textSecondary: '#6B645C',
    textMuted:     '#9A9087',
    textInverse:   '#F2EFE9',
  
    // Accent: Terracotta — fired Attic clay
    terracotta:       '#C17A5B',
    terracottaSoft:   'rgba(193, 122, 91, 0.10)',
    terracottaStrong: '#9B5A3E',
  
    // Accent: Bronze — oxidised ancient instruments
    bronze:       '#7A8C6E',
    bronzeSoft:   'rgba(122, 140, 110, 0.10)',
    bronzeStrong: '#5C6E52',
  
    // Crisis/Safety — aged ochre, not alarm red
    crisis:     '#8B7355',
    crisisSoft: 'rgba(139, 115, 85, 0.10)',
  
    // Shadows — warm, directional, never harsh
    shadowStone:     'rgba(42, 38, 33, 0.14)',
    shadowStoneDeep: 'rgba(42, 38, 33, 0.24)',
    shadowAmbient:   'rgba(42, 38, 33, 0.08)',
  
    // Glows — bronze light rising from the floor
    glowTurn:   'rgba(122, 140, 110, 0.22)',
    glowAlinda: 'rgba(122, 140, 110, 0.18)',
  
    // Grain overlay opacity
    grainOpacity: 0.04,
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TITAN PALETTE — Dark mode
  //
  // The dark marble of Mount Othrys. Cool near-black with blue-gray
  // undertones — the deep gray-green of antique marble in the Naples
  // Archaeological Museum. Cold, heavy, ancient. Not void. Stone.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const titan = {
    // Surfaces
    surfaceBase:    '#1A1C1E',   // the Titan stone itself
    surfaceRaised:  '#22252A',   // catching a little cold light
    surfaceOverlay: '#2A2E35',   // the deepest chamber
    surfaceEdge:    '#343840',   // cracks in the dark stone
  
    // Text — limestone white against dark ground
    textPrimary:   '#D8D5CF',
    textSecondary: '#9A9590',
    textMuted:     '#5C5F65',
    textInverse:   '#2E2B27',
  
    // Accent: Terracotta — deeper ember in Titan darkness
    terracotta:       '#A0604A',
    terracottaSoft:   'rgba(160, 96, 74, 0.12)',
    terracottaStrong: '#C17A5B',   // brighter against dark ground
  
    // Accent: Bronze — more luminous in darkness
    // The Titans' domain had its own cold phosphorescent light.
    bronze:       '#8FA88E',
    bronzeSoft:   'rgba(143, 168, 142, 0.12)',
    bronzeStrong: '#A8C4A6',      // almost glowing
  
    // Crisis — cool ochre, even more muted against dark stone
    crisis:     '#A08060',
    crisisSoft: 'rgba(160, 128, 96, 0.12)',
  
    // Shadows — much deeper and cooler
    shadowStone:     'rgba(0, 0, 0, 0.32)',
    shadowStoneDeep: 'rgba(0, 0, 0, 0.52)',
    shadowAmbient:   'rgba(0, 0, 0, 0.24)',
  
    // Glows — bronze is more pronounced in darkness
    glowTurn:   'rgba(143, 168, 142, 0.28)',
    glowAlinda: 'rgba(143, 168, 142, 0.22)',
  
    // Grain opacity — slightly stronger on dark ground
    grainOpacity: 0.055,
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HEX-ONLY PALETTE MAPS
  //
  // The canvas engine works in pure hex (no alpha, no rgba strings).
  // Alpha is applied mathematically during rendering via hexToRgba()
  // in theme.js. Only the values the canvas actually needs are listed.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const olympianHex = {
    surfaceBase:   '#EDEAE3',
    surfaceRaised: '#F2EFE9',
    terracotta:    '#C17A5B',
    bronze:        '#7A8C6E',
    textPrimary:   '#2E2B27',
    crisis:        '#8B7355',
  }
  
  export const titanHex = {
    surfaceBase:   '#1A1C1E',
    surfaceRaised: '#22252A',
    terracotta:    '#A0604A',
    bronze:        '#8FA88E',
    textPrimary:   '#D8D5CF',
    crisis:        '#A08060',
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SPACING
  //
  // Base unit for the 4px grid. The canvas engine uses this when it
  // needs to align generative brushstrokes with DOM element boundaries.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const BASE_UNIT = 4   // px
  
  export const spacing = {
    0:    0,
    0.5:  2,
    1:    4,
    1.5:  6,
    2:    8,
    2.5:  10,
    3:    12,
    4:    16,
    5:    20,
    6:    24,
    8:    32,
    10:   40,
    12:   48,
    16:   64,
    20:   80,
    24:   96,
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TYPOGRAPHY
  //
  // Exported as strings for canvas contexts that need to draw text
  // (e.g. if Alinda's name is ever rendered directly onto the canvas).
  // DOM typography is handled by Tailwind's fontFamily config which
  // reads these same values via theme.js.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const fontFamily = {
    serif: '"Cormorant Garamond", Georgia, serif',
    sans:  '"DM Sans", system-ui, sans-serif',
  }
  
  // Numeric px values — Tailwind uses rem strings; the canvas uses px numbers.
  export const fontSize = {
    xs:   13,
    sm:   15,
    base: 17,
    lg:   19,
    xl:   22,
    '2xl': 28,
    '3xl': 36,
    '4xl': 48,
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EASING CURVES
  //
  // Stored here rather than in motionTokens.js because the canvas engine
  // also uses these curves for its own interpolation, independently of
  // Framer Motion. motionTokens.js imports from here.
  //
  // All curves are cubic-bezier [p1x, p1y, p2x, p2y] format,
  // compatible with both CSS cubic-bezier() and Framer Motion's `ease`.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const easing = {
    // Heavy stone settling — slow to start, arrives with authority.
    // Primary easing for screen transitions and overlay entrances.
    stone:    [0.32, 0.00, 0.00, 1.00],
  
    // Content appearing — starts quickly, decelerates gently.
    // Message bubbles, cards rising into view.
    reveal:   [0.00, 0.00, 0.20, 1.00],
  
    // Content leaving — starts immediately, eases at the very end.
    // Elements disappearing from the canvas.
    vanish:   [0.40, 0.00, 1.00, 1.00],
  
    // The canvas's own breath — almost linear, imperceptibly organic.
    // Drives the LivingCanvas pulse so it never reads as mechanical.
    breath:   [0.45, 0.00, 0.55, 1.00],
  
    // Crisp and precise, like pressing into firm clay.
    // Button presses, copy confirmation, small UI interactions.
    settle:   [0.20, 0.00, 0.00, 1.00],
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DURATION SCALE
  //
  // In milliseconds. motionTokens.js and the canvas engine both import
  // from here, ensuring they share the same rhythm.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const duration = {
    instant:    0,
    micro:     80,    // button press response — imperceptible delay
    fast:     180,    // small UI transitions — feel snappy
    moderate: 350,    // most UI transitions — feel deliberate
    slow:     500,    // theme crossfade, screen entrances — feel inevitable
    breath:  3200,    // canvas breathing cycle — one inhale+exhale
    phase:   8000,    // session phase canvas interpolation step — imperceptibly slow
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CANVAS DEFAULTS
  //
  // Global constraints shared across all painting definitions.
  // Individual paintings in src/paintings/*.js override these selectively.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const canvasDefaults = {
    // Rendering
    targetFPS:        60,
    mobileTargetFPS:  30,    // enforced by qualityTiers.js
  
    // Flow field
    noiseScale:  0.003,      // zoom level — higher = more zoomed in, less diffuse
    noiseSpeed:  0.0004,     // temporal drift — how fast the field evolves
    noiseOctaves: 4,          // complexity layers — higher = more organic, more expensive
  
    // Colour
    alphaBase:   0.72,       // base layer opacity before blending
    alphaDecay:  0.015,      // how quickly paint fades between frames (trail length)
  
    // Breath
    breathPeriod: 3200,      // ms for one full breath cycle (matches duration.breath)
    breathDepth:  0.06,      // how much the field expands/contracts per breath (0-1)
  
    // Breakthrough bloom
    bloomRadius:    0.18,    // normalized 0-1 radius of the breakthrough expansion
    bloomDuration:  2400,    // ms for one full bloom event
  
    // Phase resolution
    phaseSettleDepth: 0.35,  // how much the field "tightens" from opening→closing
  }