/**
 * src/paintings/practical.js
 *
 * The Practical painting — Cy Twombly, "Leda and the Swan" (1962)
 *
 * THE WASH LAYER FOR PRACTICAL:
 *
 * Twombly barely uses wash. The ground is ALMOST the point — a warm
 * cream that isn't quite white, not quite yellow, not quite grey. The
 * marks exist in tension with an enormous amount of untouched surface.
 *
 * Where Frankenthaler's canvas is the vehicle for color and Pollock's
 * canvas is the foundation for complexity, Twombly's canvas is the
 * primary material. The marks are intrusions into a space that was
 * already complete.
 *
 * The wash layer for Practical is minimal:
 * - A very faint warm tone over the whole canvas (the specific quality
 *   of the aged cream surface Twombly used)
 * - Occasional soft passages of the few colors that do appear —
 *   an ash grey, a rare flesh tone, an even rarer red
 *
 * Most of the visual content comes from the PARTICLES — the calligraphic
 * lines, the arcing gestural marks — rather than from color washes.
 *
 * CLINICAL RELEVANCE: The restraint of the wash layer is intentional.
 * Practical mode serves users who want clarity and forward motion —
 * a minimal, uncluttered environment that doesn't soften or wrap.
 * The canvas should feel like a room where focused work is possible.
 * Not sparse — the marks are everywhere — but not soft either.
 */

const practical = {
    name: 'practical',
  
    // ── WASH LAYER — MINIMAL ─────────────────────────────────────────────────
    //
    // Three subtle washes. None is prominent — this is the most restrained
    // wash palette of all four paintings, matching Twombly's minimal use
    // of background color.
    //
    // The warm toning wash covers the whole canvas at very low opacity.
    // It exists to shift the marble background slightly toward Twombly's
    // specific cream-grey ground — not as a visible color but as a tonal
    // quality that distinguishes this canvas from the neutral default.
    washColors: [
      // Warm ground toning — the aged cream of Twombly's canvas surface
      // Very large radius (fills most of screen), very low opacity.
      // Not a color — a tonal quality. The whole canvas is very subtly warmer.
      { r: 215, g: 208, b: 188, opacity: 0.008, radius: 500 },
  
      // Ash grey passages — where the chalk marks accumulate in pools
      // Medium radius, low opacity. Shows where sustained mark-making happened.
      { r: 168, g: 160, b: 150, opacity: 0.009, radius: 220 },
  
      // Flesh tone — the brief warm body presence in the painting
      // Small radius — Twombly's flesh tones are concentrated, not spread.
      // The rarest and most intimate color.
      { r: 218, g: 185, b: 165, opacity: 0.007, radius: 160 },
    ],
  
    washSpeed: 0.055,   // fastest wash movement — urgency suits Twombly
  
    // ── PARTICLE PALETTE ─────────────────────────────────────────────────────
    //
    // Twombly's marks carry the whole painting. The palette is almost
    // monochromatic — drama comes from mark energy, not color.
    particleColors: [
      [175, 168, 158],   // warm ash grey — the chalk hand, dominant
      [175, 168, 158],   // ash grey again
      [175, 168, 158],   // ash grey third — this IS the painting's primary mark
      [235, 230, 218],   // dirty white — near-atmosphere, the ambient field
      [235, 230, 218],   // dirty white again
      [220, 195, 175],   // pale flesh — the body's warm presence
      [80,  75,  70],    // charcoal — the emphatic, heavy mark
      [198, 162, 150],   // muted rose — the rare blush
      [165, 90,  75],    // red-brown — rarest, most urgent accent
    ],
  
    // ── VECTOR FIELD ─────────────────────────────────────────────────────────
  
    fieldAngleOffset: 0.15,   // rightward — forward motion, things going somewhere
    flowSpeed: 1.35,           // fastest field evolution — urgency, gestural energy
  
    // ── PARTICLE PHYSICS ─────────────────────────────────────────────────────
  
    particleSpeed: 1.45,      // fastest particles — the arm moves
    angleVariance: 0.55,      // high but not Pollock — directional but alive
    particleRadius: 0.9,      // thinnest mark — chalk, not paint
    particleOpacity: 0.75,    // most opaque — chalk sits on surface confidently
    ageSediment: 0.15,        // chalk fades but doesn't soak
  
    settleBias: Math.PI * 0.1,
    breathDepthMulOverride: 0.80,
    flowSpeedBaseOverride:  1.10,
  }
  
  export default practical