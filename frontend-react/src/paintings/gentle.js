/**
 * src/paintings/gentle.js
 *
 * The Gentle painting — Helen Frankenthaler, "Mountains and Sea" (1952)
 *
 * ARTISTIC PHILOSOPHY: THE SOAK-STAIN
 *
 * Frankenthaler poured heavily diluted paint directly onto raw, unprimed
 * canvas laid flat on the floor. The paint didn't sit on the surface —
 * it was absorbed into the fabric itself. The resulting image has no
 * separation between medium and ground. The color IS the canvas.
 *
 * This is the governing law of this painting mode: the particles must
 * not appear to move across the surface. They must appear to be emerging
 * from within it — blooming outward from the material itself — and then
 * slowly reabsorbing back in. The user should never see a particle.
 * They should only see color, slowly redistributing its weight.
 *
 * THE PERIPHERAL VISION TRICK:
 *
 * When the user looks directly at the chat text, the peripheral nervous
 * system registers the background as a still image. The movement is
 * below the threshold of foveal attention — it only becomes visible
 * when the user looks away or unfocuses.
 *
 * This is achieved mathematically through two simultaneous effects:
 *   1. Large radius + microscopic opacity = soft luminous clouds that
 *      register as tone, not motion
 *   2. Zero angle variance = perfectly laminar flow with no jitter
 *      to attract peripheral attention
 *
 * CLINICAL PURPOSE:
 *
 * The Gentle canvas is a visual de-escalator. Surrounding an anxious
 * user with an environment that is slow, seamless, and unified provides
 * what Winnicott called a "holding environment" — a signal to the nervous
 * system that there is no urgency, no threat, no need for vigilance.
 *
 * It physically invites co-regulation. The breath slows to match it.
 *
 * FRANKENTHALER'S PALETTE TRANSLATED:
 *
 * Mountains and Sea used a specific set of diluted, almost accidental
 * colors — a washed blue-green for the sea, a soft rose-pink for the
 * distant hills, a yellowed ochre for the scraped canvas showing through.
 * These don't map directly to our Olympian/Titan palettes, but the
 * painting engine's current particle color (set by PaletteBlend from
 * the theme's bronze/terracotta tokens) already carries their warmth.
 * The gentle params amplify the softness of those colors without
 * introducing new ones — the palette remains therapeutically coherent.
 *
 * PHASE BEHAVIOR:
 *
 * settleBias points toward a gentle horizontal drift (0 radians = east).
 * In opening: the field is nearly circular — no preferred direction.
 * In closing: the particles have all found the same slow eastward drift,
 * like a tide going out. Quieter than stillness, because still water
 * can feel frozen. Moving water, very slowly, feels like rest.
 */

// The physical parameters exported from this file directly feed
// NoiseField.updatePaintingParams() via LivingCanvas.jsx.
// Every value here was chosen to produce the soak-stain effect at
// three different scales simultaneously:
//   macro   — the broad sweeping currents (large radius, low opacity)
//   meso    — the mid-scale color pooling (slow field evolution)
//   micro   — the sediment effect (high ageSediment)

const gentle = {
    name: 'gentle',
  
    // ── Vector field character ──────────────────────────────────────────────────
  
    // fieldAngleOffset: rotates the entire field's base direction.
    // 0 = horizontal drift (eastward). Gentle doesn't impose a direction;
    // it lets the fBm noise dominate, with only the faintest eastward lean.
    // A value of 0 means the macro-currents are purely noise-driven.
    fieldAngleOffset: 0.0,
  
    // flowSpeed: multiplier on the field's temporal evolution rate.
    // 0.22 means the vector field evolves at 22% of the standard rate.
    // This is what makes the macro-currents feel like deep ocean water —
    // they move, but on a geological timescale.
    // At 60fps, the field shifts approximately 1.3° per second on average.
    flowSpeed: 0.22,
  
    // ── Particle motion ─────────────────────────────────────────────────────────
  
    // particleSpeed: how far each particle moves per frame along its vector.
    // 0.28 = 28% of the standard travel speed.
    // Crucially, slow particles overlap heavily because they linger in each
    // position for many frames — this creates the dense, pooled color effect.
    particleSpeed: 0.28,
  
    // angleVariance: how much each particle deviates from its pure vector angle.
    // 0.0 = absolutely zero deviation. Perfect laminar flow.
    // This is the most important parameter for the peripheral vision effect —
    // any jitter above ~0.04 will attract the eye's motion detection system.
    // Zero variance means the field looks like slow water, not scattered leaves.
    angleVariance: 0.0,
  
    // ── Visual character ─────────────────────────────────────────────────────────
  
    // particleRadius: the drawn dot radius in CSS pixels (at DPR 1.0).
    // 3.2 is large — roughly a grain of fine sand visible under magnification.
    // But because opacity is microscopic, overlapping large dots don't appear
    // as dots; they appear as soft pools of tonal variation.
    // This is directly inspired by Frankenthaler's poured paint: a large
    // volume of diluted color leaving a wide, soft impression.
    particleRadius: 3.2,
  
    // particleOpacity: the alpha of each individual drawn dot.
    // 0.09 means each dot is 91% transparent.
    // At 1400 particles overlapping over many frames, the accumulated opacity
    // creates visible color, but no single dot is ever perceptible.
    // This is the mathematical equivalent of heavily diluted watercolor:
    // individually imperceptible, collectively luminous.
    particleOpacity: 0.09,
  
    // ageSediment: how strongly particles drift toward the background color
    // as they age (0.0 = no drift, 1.0 = immediate full reabsorption).
    // 0.72 is high — particles spend their youth leaving a color trace,
    // then progressively dissolve into the background surface.
    // This creates the soak-stain effect: color appears, pools, then
    // slowly sinks back into the stone. The canvas is always mid-absorption.
    ageSediment: 0.72,
  
    // ── Field settling (phase interpolation target) ──────────────────────────────
  
    // settleBias: the angle (radians) the field drifts toward as the session
    // reaches closing phase. 0 = east (horizontal rightward drift).
    // For Gentle, this is a barely-perceptible eastward lean — not a strong
    // direction, more like a tide finding its way.
    settleBias: 0.0,
  
    // ── Breathing character ───────────────────────────────────────────────────────
    // These are used by PhaseInterpolator's starting modifiers for Gentle sessions.
    // They override the tier config's base breathDepth during the opening phase.
  
    // breathDepthMulOverride: how much more expansive the breath cycle is
    // compared to standard, specifically for Gentle sessions.
    // 1.5 = 50% more expansive — the canvas visibly expands and contracts
    // on a 3.2-second cycle, like a slow, conscious inhale.
    breathDepthMulOverride: 1.50,
  
    // flowSpeedBaseOverride: the base noiseSpeed multiplier for the opening phase
    // of a Gentle session — before PhaseInterpolator begins calming it further.
    flowSpeedBaseOverride: 0.65,
  }
  
  export default gentle