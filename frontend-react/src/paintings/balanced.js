/**
 * src/paintings/balanced.js
 *
 * The Balanced painting — Jackson Pollock, "Blue Poles" (1952)
 *
 * THE WASH LAYER FOR BALANCED:
 *
 * Pollock worked in many layers. The wash layer for Blue Poles represents
 * those foundational layers — the aluminum enamel ground, the first raw
 * umber passages, the early black skeins — which exist beneath the
 * visible drip work and give the painting its luminous depth.
 *
 * Unlike Frankenthaler (distinct color areas) or Teh-Chun (light emerging
 * from dark), Pollock's wash structure is DENSE AND OVERLAPPING. Many
 * colors are present everywhere simultaneously, in different proportions.
 * The eye can never settle on a single dominant color area because there
 * isn't one.
 *
 * This is encoded by using MORE wash circles with SMALLER radii,
 * creating a richer, more complex ground. Seven distinct colors cycle
 * through the canvas simultaneously — the richest wash palette of all
 * four paintings.
 */

const balanced = {
    name: 'balanced',
  
    // ── WASH LAYER ────────────────────────────────────────────────────────────
    //
    // Seven colors — the full Pollock palette.
    // All relatively similar opacity because in Blue Poles, no single
    // color truly dominates — they all compete and coexist.
    //
    // Smaller radii than Frankenthaler's — Pollock's color passages are
    // more localized, less sweeping. The richness comes from their quantity.
    //
    // The pole blue appears as the smallest, most concentrated wash —
    // a narrow deep column that moves slowly through the field, exactly
    // as the actual poles move through the painting.
    washColors: [
      // Aluminum silver ground — the glowing underpaint layer
      { r: 200, g: 200, b: 195, opacity: 0.016, radius: 280 },
  
      // Raw umber — the structural warm dark
      { r: 85,  g: 68,  b: 48,  opacity: 0.014, radius: 240 },
  
      // Golden ochre — warmth and energy, frequent
      { r: 200, g: 148, b: 42,  opacity: 0.015, radius: 220 },
  
      // Deep pole blue — rare, narrow, the namesake
      // Smallest radius — the poles are concentrated passages, not fields
      { r: 38,  g: 58,  b: 132, opacity: 0.018, radius: 160 },
  
      // Near-black — the primary drip skein color
      { r: 28,  g: 25,  b: 20,  opacity: 0.014, radius: 260 },
  
      // Cadmium orange — the energetic burst, rare and vivid
      { r: 215, g: 92,  b: 38,  opacity: 0.013, radius: 190 },
  
      // Warm white — the light passages that open up space
      { r: 240, g: 235, b: 225, opacity: 0.015, radius: 230 },
    ],
  
    washSpeed: 0.048,   // faster than Gentle — Pollock's field is energetic
  
    // ── PARTICLE PALETTE ──────────────────────────────────────────────────────
    //
    // 11 colors, distributed non-uniformly.
    // Silver and black are most abundant (matching painting proportions).
    // Blue and orange are rare accents (named in the title but sparse in the paint).
    particleColors: [
      [215, 215, 210],   // aluminum silver — ground, most abundant
      [215, 215, 210],   // silver again
      [215, 215, 210],   // silver third time
      [25,  22,  18],    // near-black drip — structural dominance
      [25,  22,  18],    // black again
      [240, 238, 232],   // warm white — light passages
      [240, 238, 232],   // white again
      [210, 155, 45],    // golden ochre — warmth
      [65,  55,  40],    // raw umber — quiet structure
      [42,  65,  140],   // deep pole blue — rarest, the namesake
      [218, 98,  45],    // cadmium orange — energetic burst
    ],
  
    // ── VECTOR FIELD ─────────────────────────────────────────────────────────
  
    fieldAngleOffset: -Math.PI * 0.08,  // faint vertical bias — the poles
    flowSpeed: 0.95,                     // nearly full speed — Pollock's energy
  
    // ── PARTICLE PHYSICS ─────────────────────────────────────────────────────
  
    particleSpeed: 1.10,
    angleVariance: 0.72,    // highest variance — dripped paint from all directions
    particleRadius: 1.4,
    particleOpacity: 0.65,
    ageSediment: 0.10,      // lowest — enamel doesn't soak, it stays on surface
  
    settleBias: -Math.PI * 0.5,
    breathDepthMulOverride: 1.20,
    flowSpeedBaseOverride:  1.00,
  }
  
  
  export default balanced