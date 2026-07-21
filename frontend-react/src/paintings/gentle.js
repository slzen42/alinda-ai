/**
 * src/paintings/gentle.js
 *
 * The Gentle painting — Helen Frankenthaler, "Mountains and Sea" (1952)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT YOU ARE LOOKING AT IN THE REFERENCE IMAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The painting has five distinct color areas that the eye discovers gradually:
 *
 * 1. The CERULEAN BLUE — upper right and the blue "sea" stripe along the
 *    bottom. Genuinely blue. Not a blue tint — blue. Pool-like.
 *
 * 2. The CORAL PINK — the large central-left area. Warm, salmon-adjacent.
 *    The biggest color mass in the painting.
 *
 * 3. The SAGE GREEN — upper center and scattered passages. The one cool-
 *    warm neutral. More present than it appears at first.
 *
 * 4. The RAW LINEN — the cream ground that shows through everywhere,
 *    especially at the edges. Where no paint was poured.
 *
 * 5. The PALE LAVENDER — a brief atmospheric passage between blue and pink.
 *
 * These are not adjacent, equal divisions of the canvas. They overlap,
 * pool at their centers, thin toward their edges, and reveal each other
 * through their transparency. The raw linen ground unifies everything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY WASH LAYER + PARTICLES, NOT PARTICLES ALONE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A single particle is a 3.2px dot at 0.28 opacity. No matter how many
 * accumulate, dots never look like poured paint. They look like dots.
 *
 * Frankenthaler poured heavily diluted paint — the color spread across
 * the canvas in continuous, area-filling washes that covered square feet
 * of surface with a single gesture. This is an inherently different shape
 * than a dot: it is an area.
 *
 * The wash layer creates those areas. Soft gradient circles, 280–380px
 * radius, slowly drifting via noise-driven positions, accumulate into
 * visible pools of color against the marble ground. The particles then
 * add fine textural life on top of those pools — the sensation of the
 * paint surface itself, not just the color.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WASH LAYER STEADY STATE CALCULATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * With alphaDecay=0.015 and wash opacity=0.022 per frame:
 *   Combined per frame: new = 0.978 × old + 0.022 × washColor
 *   Steady state: old = 0.022/0.022 × washColor - no, let me redo:
 *
 *   Alpha decay first: afterDecay = 0.985 × old + 0.015 × bgColor
 *   Wash second: afterWash = 0.978 × afterDecay + 0.022 × washColor
 *   Expand: afterWash = 0.978 × (0.985 × old + 0.015 × bg) + 0.022 × wash
 *          = 0.9633 × old + 0.01467 × bg + 0.022 × wash
 *   Steady state (afterWash = old):
 *     old × (1 - 0.9633) = 0.01467 × bg + 0.022 × wash
 *     old × 0.0367 = 0.01467 × bg + 0.022 × wash
 *     old = 0.40 × bg + 0.60 × wash
 *
 * At steady state: canvas is 40% background, 60% wash color.
 * Frankenthaler's cerulean [95, 165, 195] on marble [237, 234, 227]:
 *   R: 0.40 × 237 + 0.60 × 95  = 95  + 57  = 152  (clearly blue)
 *   G: 0.40 × 234 + 0.60 × 165 = 94  + 99  = 193  (clearly blue-green)
 *   B: 0.40 × 227 + 0.60 × 195 = 91  + 117 = 208  (clearly blue)
 *   Result: rgb(152, 193, 208) — a clean, visible cerulean wash. ✓
 */

const gentle = {
    name: 'gentle',
  
    // ── WASH LAYER — Frankenthaler's poured color areas ─────────────────────────
    //
    // These are the primary visual element of the Gentle mode.
    // Five colors from the painting, each moving on its own noise trajectory.
    // The resulting canvas looks like you are standing in front of the painting.
    //
    // Opacity per color is tuned to the color's actual abundance in the painting.
    // Blue and pink are the largest areas → higher opacity.
    // Lavender is the most ephemeral → lowest opacity.
    //
    // Radius is tuned to the color's spatial character in the painting:
    // The sea/sky blue covers the upper third of the canvas → large radius.
    // The lavender is a transitional passage → medium.
    washColors: [
      // Cerulean blue — the sea and sky. The most saturated color in the painting.
      // In the reference: upper right, and the horizontal stripe at bottom.
      // High opacity + large radius creates the sea-like sweep.
      { r: 95,  g: 165, b: 195, opacity: 0.022, radius: 380 },
  
      // Coral pink — the dominant color mass. Large, warm, central.
      // Slightly lower opacity because it's more translucent in the actual painting.
      { r: 208, g: 130, b: 110, opacity: 0.020, radius: 340 },
  
      // Sage green — the land, the hills. Cooler than the pink.
      // More diffuse in the painting — medium opacity, medium radius.
      { r: 130, g: 175, b: 140, opacity: 0.016, radius: 290 },
  
      // Pale lavender — the atmospheric haze where sea meets sky.
      // Rarely noticed consciously — this is the subliminal color.
      { r: 170, g: 155, b: 192, opacity: 0.012, radius: 250 },
  
      // Warm ochre — the raw canvas catching warm light at the edges.
      // Not a strong color; just a slight warming where the linen shows.
      { r: 218, g: 195, b: 155, opacity: 0.009, radius: 220 },
    ],
  
    // How fast the wash positions drift (fraction of field evolution speed).
    
    // 0.035 means the wash positions move at 3.5% of the field's normal rate —
    // perceptibly stable over a minute, subtly different over an hour.
    washSpeed: 0.035,
  
    // ── PARTICLE COLOR PALETTE ────────────────────────────────────────────────
    //
    // The particles provide fine textural life ON TOP of the wash layer.
    // Their colors should relate to the wash colors but be more varied —
    // the micro-texture of the paint surface, not the wash itself.
    particleColors: [
      [140, 185, 195],   // blue-green — echoes the cerulean wash
      [210, 145, 130],   // coral — echoes the pink wash
      [145, 178, 148],   // sage — echoes the green wash
      [180, 165, 200],   // lavender — the atmospheric in-between tone
      [218, 195, 155],   // warm linen — the canvas ground itself
      [110, 155, 185],   // deeper cerulean — shadow in the blue areas
    ],
  
    // ── VECTOR FIELD ──────────────────────────────────────────────────────────
  
    // Minimal directional lean — the flow is almost circular, barely eastward.
    // Frankenthaler worked from above with no preferred direction.
    fieldAngleOffset: 0.05,
  
    // Glacially slow field evolution
    flowSpeed: 0.22,
  
    // ── PARTICLE PHYSICS ─────────────────────────────────────────────────────
  
    particleSpeed: 0.28,    // the slowest particles — they drift, not travel
    angleVariance: 0.0,     // zero jitter — perfect laminar flow
  
    // Large radius for soft accumulation into pools
    particleRadius: 3.2,
  
    // Corrected from 0.09 — the original was too low to be visible.
    // At 0.28, particles are still "watercolor" (72% transparent)
    // but accumulate into genuinely visible soft areas in dense zones.
    particleOpacity: 0.28,
  
    // High sediment — particles reabsorb into the ground as they age,
    // reinforcing the soak-stain quality where color bleeds into the fabric.
    ageSediment: 0.68,
  
    // ── PHASE SETTLING ───────────────────────────────────────────────────────
  
    // Eastward — a barely perceptible tide-going-out direction at closing.
    settleBias: 0.0,
  
    breathDepthMulOverride: 1.50,
    flowSpeedBaseOverride:  0.65,
  }

  
  export default gentle