/**
 * src/paintings/direct.js
 *
 * The Direct painting — Chu Teh-Chun, "Évocation Hivernale" (1988)
 *
 * THE WASH LAYER FOR DIRECT:
 *
 * Teh-Chun's painting has a fundamentally different wash structure than
 * Frankenthaler. Where Frankenthaler has multiple distinct color areas
 * separated by raw canvas, Teh-Chun has a continuous atmospheric DARK ground
 * from which LIGHT SOURCES emerge.
 *
 * The wash layer encodes this: a large deep indigo-black atmospheric wash
 * covers most of the canvas (this IS the painting's ground in Titan mode).
 * Over it, smaller, brighter wash circles represent the luminous passages
 * where light breaks through — warm white, pale gold, ice blue.
 *
 * In Olympian (light) mode: the background is already light marble, so the
 * atmospheric dark wash works inversely — it creates deep atmospheric passages
 * that the luminous particles emerge from. The effect is less dramatic but
 * still architectural.
 *
 * In Titan (dark) mode: the dark wash barely reads against the dark ground,
 * but the luminous wash circles (warm white, pale gold) appear genuinely
 * radiant — cold light in a dark winter sky. This is where Direct reaches
 * its full power.
 */

const direct = {
    name: 'direct',
  
    // ── WASH LAYER ────────────────────────────────────────────────────────────
    //
    // The wash structure:
    //   1. Deep indigo atmosphere — the continuous dark ground
    //   2. Luminous warm white — the primary light source
    //   3. Pale gold — the second light source, warmer, at a distance
    //   4. Ice blue — the winter cold pervading the atmosphere
    //   5. Silver — where the atmosphere is thinnest
    //
    // In dark mode: the indigo wash nearly disappears (dark on dark = subtle
    // deepening), while the light sources become genuinely radiant.
    // In light mode: all washes are visible as tonal shifts on marble.
    washColors: [
      // Deep indigo atmosphere — the pervading darkness of winter
      // Large radius, relatively low opacity to not overwhelm in light mode.
      // In dark mode this adds depth to an already deep ground.
      { r: 35,  g: 42,  b: 75,  opacity: 0.018, radius: 420 },
  
      // Luminous warm white — the primary light source
      // Smaller radius — light sources are concentrated, not diffuse.
      // Higher relative opacity because this IS what the painting is about.
      { r: 245, g: 240, b: 218, opacity: 0.025, radius: 210 },
  
      // Pale gold — the warmth of a remembered fire, at a distance
      // Medium radius — present but subordinate to the white.
      { r: 225, g: 195, b: 115, opacity: 0.016, radius: 175 },
  
      // Ice blue — the winter cold that pervades even the light areas
      // Large radius but very low opacity — the cold is everywhere, subtly.
      { r: 155, g: 188, b: 218, opacity: 0.012, radius: 300 },
  
      // Silver-grey — where atmosphere thins and the sky shows through
      { r: 195, g: 205, b: 215, opacity: 0.010, radius: 240 },
    ],
  
    washSpeed: 0.042,   // slightly faster than Gentle — winter light shifts
  
    // ── PARTICLE PALETTE ──────────────────────────────────────────────────────
    //
    // Where Frankenthaler's particles echo her wash colors, Teh-Chun's particles
    // are almost exclusively in the luminous register — they represent light
    // traveling through atmosphere, not paint pools.
    particleColors: [
      [175, 198, 218],   // pale glacial blue — the dominant atmospheric tone
      [242, 236, 205],   // luminous warm white — the light source
      [110, 145, 190],   // cool medium blue — winter sky
      [200, 215, 230],   // silver-blue — frost and reflected light
      [215, 178, 80],    // amber-gold — the ember of warmth
      [80,  130, 165],   // deep glacial teal — the weight beneath the light
    ],
  
    // ── VECTOR FIELD ─────────────────────────────────────────────────────────
  
    fieldAngleOffset: -0.25,  // slight upward-right lean — light rises
    flowSpeed: 0.68,
  
    // ── PARTICLE PHYSICS ─────────────────────────────────────────────────────
  
    particleSpeed: 0.72,
    angleVariance: 0.10,     // slight deviation — light is precise but alive
    particleRadius: 1.5,
    particleOpacity: 0.48,
    ageSediment: 0.22,
  
    settleBias: -Math.PI * 0.25,
    breathDepthMulOverride: 0.90,
    flowSpeedBaseOverride:  0.85,
  }
  
  export default direct