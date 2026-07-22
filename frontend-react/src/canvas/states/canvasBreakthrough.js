/**
 * src/canvas/states/canvasBreakthrough.js
 *
 * The "Aha" Moment — the canvas during cognitive breakthrough and
 * successful therapeutic reframing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A breakthrough in therapy is a specific, identifiable neurological event.
 * It is not "feeling better" — it is the moment when a previously unconscious
 * pattern becomes conscious. When someone realizes, for the first time, that
 * their anger at their partner is actually grief about their father. When
 * they hear themselves say something they have never been able to articulate
 * before, and the act of hearing themselves say it changes what they know.
 *
 * Neurologically, a genuine breakthrough involves:
 *   - Sudden dopaminergic release (the "reward" for solving a hard problem)
 *   - Activation of the anterior cingulate cortex (conflict resolution, insight)
 *   - A brief expansion of attention — the world briefly feels more spacious
 *   - Sometimes: tears, laughter, or a long exhale
 *
 * The visual environment during a breakthrough should honor this expansion.
 * Not celebrate it loudly — that would feel trivial and intrusive.
 * Rather: the room should become briefly, visibly more alive, as if the
 * insight itself added energy to the space. The canvas should feel the way
 * a room feels when someone opens a window in spring: suddenly more air,
 * more light, more movement, and then — gently — a return to the ordinary
 * room, which now feels permanently slightly different than it did before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TIMING CONTRACT WITH LivingCanvas.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Breakthrough is the only state in this system that is designed to be
 * TEMPORARY and SELF-RESOLVING. It does not wait for the FSM to transition
 * it away — it has its own internal timer managed in LivingCanvas.jsx:
 *
 *   activateBreakthroughState() in LivingCanvas.jsx:
 *     1. Applies these overrides immediately via applyCurrentParams()
 *     2. Calls noiseField.triggerBloom(0.5, 0.45) simultaneously
 *     3. Sets a setTimeout for canvasDefaults.bloomDuration + 300ms (≈2700ms)
 *     4. After that timer fires: restores the pre-breakthrough painting params
 *
 * This means the user sees:
 *   T+0ms:    Canvas energy spikes — faster, brighter, more alive
 *   T+0ms:    Bloom expansion begins from canvas center
 *   T+0–2400ms: Bloom decays naturally (triggerBloom's built-in decay)
 *   T+2700ms: Canvas params restore to idle/guided state
 *   T+2700–4300ms: PaletteBlend's 800ms color transition completes the return
 *
 * Total visible breakthrough duration: approximately 4–5 seconds.
 * Long enough to be felt. Short enough not to become a performance.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BLOOM RELATIONSHIP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This state and the triggerBloom() function in noiseField.js are designed
 * to be activated simultaneously — they are two layers of the same event:
 *
 * PHYSICS LAYER (these overrides):
 *   The global field parameters spike upward. ALL particles move faster,
 *   are more opaque, leave longer trails, and follow more varied paths.
 *   This is the whole-canvas energy expansion — the room breathing in.
 *
 * GEOMETRIC LAYER (triggerBloom):
 *   A mathematical repulsor appears at the center of the canvas for ~2400ms.
 *   Particles near the center are pushed outward with force proportional to
 *   their proximity (Gaussian falloff). Particles at the canvas edge are
 *   barely affected. This creates a visible radial expansion from the center —
 *   a bloom of outward motion that decays naturally as the repulsor fades.
 *
 * Together they create compound breakthrough physics:
 *   - All particles are moving faster (physics layer)
 *   - Particles near center are also being pushed outward (geometric layer)
 *   - Trails are longer (negative sediment addition, physics layer)
 *   - Colors are more opaque (physics layer)
 *
 * The result: a brief, expansive bloom from the center of the canvas
 * where everything rushes outward and becomes momentarily vivid, before
 * returning to its natural flow. The room opened. Now it is closing again,
 * gently, back to what it was.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE ONLY STATE WITH NEGATIVE SEDIMENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every other state either leaves sediment unchanged (idle), reduces trails
 * slightly (waiting), or dramatically increases sedimentation to remove
 * trails (cooldown, stillness). Breakthrough is the single exception —
 * it DECREASES sedimentation below the painting's native value.
 *
 * Negative sedimentAdd means the merged ageSediment = painting.ageSediment - 0.12.
 * For paintings with low native sediment (Pollock: 0.10), the merged value
 * is 0.10 - 0.12 = -0.02. The engine clamps ageSediment at 0.0 in the
 * age-blend calculation (the ageMix never goes negative), so effectively
 * the painting's sediment goes to zero — particles NEVER drift toward
 * the background color as they age. They maintain their full chosen color
 * until they are absorbed by the alpha-decay on the next frame.
 *
 * For high-sediment paintings (Gentle: 0.68), merged becomes 0.56 — still
 * relatively high, but reduced enough that trails extend noticeably compared
 * to gentle's default. Frankenthaler's watercolor pools linger slightly
 * longer before being absorbed.
 *
 * The visual effect: during breakthrough, particle trails extend by 20–40%
 * compared to idle. On Pollock's canvas, the dense web of drip skeins
 * briefly becomes even denser and more elaborately interconnected. On
 * Practical's canvas, Twombly's gestural arcs sweep further before fading.
 * The canvas accumulates more color history per second than usual — for
 * just these few seconds, everything the particles do is more permanent.
 *
 * This is the visual metaphor for insight: what was ephemeral becomes
 * briefly indelible. The moment leaves a mark.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VISUAL CHANGES AT EACH VALUE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * speedMul: 1.45
 *   Particles move at 145% of native speed. The canvas rushes.
 *   On Gentle (native 0.32 → merged 0.464): still unhurried in absolute terms,
 *     but noticeably faster than its usual drift. Frankenthaler's slow pools
 *     briefly develop small currents.
 *   On Practical (native 1.45 → merged 2.103): Twombly's urgency doubles.
 *     Gestural arcs sweep the full canvas width in seconds. The marks become
 *     almost calligraphic lightning.
 *   On Balanced (native 1.10 → merged 1.595): Pollock's energetic field
 *     becomes frenetic — the drip skeins rush and cross in rapid bursts.
 *   This is the most perceptible single change in the state — the user will
 *   consciously notice "the canvas got faster" even if they cannot name why.
 *
 * flowMul: 1.50
 *   The vector field evolves at 150% of normal rate. Slightly higher than
 *   speedMul because the directional changes should lead the particle motion:
 *   the field opens outward first, and the particles rush to follow.
 *   Combined with the bloom's geometric repulsor, this means particles are
 *   simultaneously being pushed away from center AND moving faster AND
 *   following a rapidly evolving field. The compound effect is a dynamic,
 *   visually rich expansion with no dead zones — every area of the canvas
 *   is simultaneously alive.
 *
 * varianceMul: 1.22
 *   Angle variance increases by 22%. The brief jitter of individual expression
 *   enters the field:
 *   - Gentle (0.00 × 1.22 = 0.00): no change. Gentle's laminar quality is
 *     preserved even during breakthrough — the expansion is expressed through
 *     speed and bloom, not scatter. This is clinically appropriate: a gentle
 *     breakthrough is an expansive exhale, not an explosion.
 *   - Direct (0.10 × 1.22 = 0.122): slightly increased. Cold light becomes
 *     slightly more dynamic, less architectural.
 *   - Balanced (0.72 × 1.22 = 0.878): Pollock's chaos approaches its physical
 *     maximum — particles scatter in nearly random directions within the
 *     general outward flow of the bloom. The drip-from-all-sides quality of
 *     the painting's physical creation is momentarily re-enacted.
 *   - Practical (0.55 × 1.22 = 0.671): Twombly's gestural marks reach their
 *     maximum expression. The arm is fully extended, moving at full speed,
 *     with maximum directional freedom. This is the Twombly canvas at its
 *     most genuinely spontaneous.
 *
 * opacityMul: 1.28
 *   All marks become 28% more opaque than native.
 *   This creates the "hyper-vibrant" quality you described — colors that
 *   seem to assert themselves more strongly than usual.
 *   On Gentle (native 0.28 → merged 0.358): still fundamentally watercolor,
 *     but a watercolor that has pooled more heavily, more densely present.
 *   On Balanced (native 0.65 → merged 0.832): Pollock's marks approach
 *     near-full opacity. The enamel on the canvas reads as its physical self —
 *     heavy, present, undeniable. The silver and black particles become almost
 *     as opaque as the actual paint in the painting.
 *   Note: opacityMul is capped internally by the engine at 1.0 per-particle
 *   (globalAlpha cannot exceed 1.0), so very high-opacity paintings don't
 *   "overflow" — they simply reach full opacity sooner in their accumulation.
 *   The practical effect: dense areas of the canvas hit saturation faster.
 *
 * sedimentAdd: -0.12
 *   Negative. Trail extension. The moment leaves marks.
 *   See the extended discussion in the NEGATIVE SEDIMENT section above.
 *   Key calibrated values:
 *   - Gentle: 0.68 - 0.12 = 0.56 (still soak-heavy, but trails extend ~20%)
 *   - Direct: 0.22 - 0.12 = 0.10 (crisp marks now barely fade at all)
 *   - Balanced: 0.10 - 0.12 = effectively 0.0 (Pollock's enamel is PERMANENT
 *     for the duration of breakthrough — the canvas accumulates maximally)
 *   - Practical: 0.15 - 0.12 = 0.03 (Twombly's chalk is nearly permanent)
 *
 * radiusMul: 1.08
 *   A modest 8% increase in radius. The most restrained multiplier in this state.
 *   Why restrained when everything else is amplified?
 *   Because radius increase reduces visual precision. Larger particles look
 *   softer and less energetic — the opposite of what breakthrough should feel.
 *   The modest 1.08 increase adds just enough diffusion to make the expanded,
 *   faster marks read as radiant rather than sharp — a small softening of the
 *   bloom's energy so it doesn't read as harsh or alarming.
 *   Gentle's 3.2px becomes 3.46px (imperceptible per-dot).
 *   Practical's 0.9px becomes 0.97px (still effectively a line).
 *   The radius increase is felt as ambient warmth, not as a visible scale change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPOUND EFFECT: WHAT THE USER ACTUALLY SEES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * On the Gentle/Frankenthaler canvas:
 *   The cerulean sea washes suddenly feel like they have a current.
 *   The coral pools develop small, bright eddies at their centers.
 *   A soft radial bloom opens from the painting's center — the colors
 *   briefly separate, each wash asserting itself before the center
 *   becomes bright and open. It looks like watching a flower open
 *   in time-lapse, at 2× speed, for 4 seconds.
 *
 * On the Balanced/Pollock canvas:
 *   The drip skeins rush and multiply. The aluminum silver ground becomes
 *   momentarily brilliant. The pole blue — normally the rarest color, barely
 *   visible — surges with new particle deposits for just these seconds.
 *   The geometric bloom at center creates a brief clear zone that immediately
 *   fills with converging skeins from all directions. It looks like the
 *   painting's violent, energetic creation process momentarily replayed.
 *
 * On the Direct/Teh-Chun canvas:
 *   The cold luminous whites become genuinely blinding for just a moment.
 *   Light particles rush outward from the center bloom, creating the sensation
 *   of a searchlight or the sun emerging from clouds. The ice-blue atmosphere
 *   is briefly overwhelmed by the rushing white. Then the cold settles back.
 *
 * On the Practical/Twombly canvas:
 *   The gestural arcs reach their maximum sweep. Marks that normally
 *   travel 40% of the canvas width in a lifetime now reach 60–70%.
 *   The trail extension makes each arc leave a longer, more assertive
 *   path before fading. For 4 seconds, the canvas looks like someone
 *   wrote something in the air with light.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RETURN — WHY BREAKTHROUGH DOESN'T END ABRUPTLY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When the breakthrough timer fires in LivingCanvas.jsx and restores the
 * idle/guided params, the transition back happens over PaletteBlend's 800ms
 * color window. But the PHYSICS change (particle speed, variance, sediment)
 * is immediate — the moment the timer fires, particles begin moving at their
 * native pace again.
 *
 * This creates a beautiful compounding effect on the return:
 *   - The physics return to normal immediately (particles slow)
 *   - But the canvas carries the HISTORY of the breakthrough's marks —
 *     all those extra-opaque, longer-trail, faster-deposited particles
 *     from the last 2.7 seconds are still on the canvas, accumulated
 *   - The alpha-decay continues at its normal rate, slowly absorbing them
 *   - For the next 60–90 frames after breakthrough ends, the canvas is
 *     slightly richer than its normal idle state — more accumulated color
 *
 * The user experience: the breakthrough isn't over when the physics reset.
 * The room gradually returns to its normal state over the following minute.
 * The insight settled something in the painting. The canvas is slightly
 * different than it was before the breakthrough — just slightly — which
 * is exactly how a real insight affects a person.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL RESTRAINT — WHAT BREAKTHROUGH IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This state is NOT a celebration. It does not feel like a fireworks display,
 * a success sound, or a UI animation that says "congratulations." Those
 * responses would trivialize the moment and likely embarrass the user who
 * just experienced something genuinely vulnerable.
 *
 * The multipliers in this file are calibrated to feel like:
 *   "Something just happened and the room noticed."
 *
 * Not:
 *   "Congratulations! You had a breakthrough! Here is your reward!"
 *
 * The difference is restraint. The canvas is more alive for a few seconds.
 * The user might not consciously register it — they might only notice,
 * slightly, that the room felt different for a moment. That is correct.
 * The therapeutic moment is the insight. The canvas honors it by being
 * present with slightly more aliveness. Then it returns.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEBUG NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To manually trigger breakthrough in the test App.jsx, add a button:
 *
 *   import { useRef } from 'react'
 *
 *   // In App(), add a ref to access LivingCanvas internals:
 *   // (Note: LivingCanvas doesn't expose refs by default — for testing,
 *   //  temporarily add a window-level debug hook)
 *
 * Simpler approach — temporarily add to LivingCanvas.jsx's useEffect:
 *   window._triggerBreakthrough = () => {
 *     if (noiseFieldRef.current) {
 *       noiseFieldRef.current.triggerBloom(0.5, 0.45)
 *       activateBreakthroughState()
 *     }
 *   }
 * Then call window._triggerBreakthrough() in the browser console.
 *
 * What to look for:
 *   - Immediate visible speed increase in particle motion
 *   - A radial expansion from canvas center (~0.5, 0.45 normalized)
 *   - Trails noticeably longer than in idle
 *   - Colors slightly more vivid
 *   - After ~2.7 seconds: gradual return to normal speed
 *   - Canvas slightly richer than before breakthrough for ~30-60 more seconds
 *
 * Most common issue: breakthrough looks identical to idle.
 *   Verify that activateBreakthroughState() in LivingCanvas.jsx is actually
 *   calling applyCurrentParams() after setting the breakthrough overrides.
 *   The STATE_OVERRIDES_MAP check: if 'breakthrough' is not in the map,
 *   the merge returns the identity (no change). Log the merged params
 *   immediately after applyCurrentParams() to confirm breakthrough values.
 *
 * Most common issue: breakthrough looks too aggressive / alarming.
 *   The clinical line between "expansive" and "alarming" is crossed when
 *   speedMul exceeds ~1.6 or varianceMul exceeds ~1.35.
 *   If the canvas feels anxious rather than expansive:
 *   - Decrease speedMul to 1.30
 *   - Decrease varianceMul to 1.10
 *   - Decrease opacityMul to 1.15
 *   The bloom radius (BLOOM_GAUSSIAN_SIGMA in noiseField.js) is also worth
 *   tuning if the geometric expansion feels too sharp-edged.
 *
 * Calibration reference (Balanced/Pollock in breakthrough):
 *   Native particle speed:   1.10 → merged: 1.595
 *   Native flow speed:       0.95 → merged: 1.425
 *   Native variance:         0.72 → merged: 0.878
 *   Native opacity:          0.65 → merged: 0.832
 *   Native radius:           1.4  → merged: 1.512
 *   Native sediment:         0.10 → merged: 0.0 (floored — trails PERMANENT)
 *
 * Calibration reference (Gentle/Frankenthaler in breakthrough):
 *   Native particle speed:   0.32 → merged: 0.464
 *   Native flow speed:       0.22 → merged: 0.330
 *   Native variance:         0.00 → merged: 0.000 (zero stays zero)
 *   Native opacity:          0.28 → merged: 0.358
 *   Native radius:           3.2  → merged: 3.456
 *   Native sediment:         0.68 → merged: 0.56 (trails extend ~20%)
 */

export const canvasBreakthroughOverrides = Object.freeze({
    speedMul:    1.45,
    opacityMul:  1.28,
    flowMul:     1.50,
    varianceMul: 1.22,
    sedimentAdd: -0.12,
    radiusMul:   1.08,
  })