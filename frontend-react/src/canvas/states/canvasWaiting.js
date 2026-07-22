/**
 * src/canvas/states/canvasWaiting.js
 *
 * The Holding Environment — the canvas during suspension and anticipation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The waiting state is one of the most psychologically precise challenges
 * in this application's design. Waiting in a clinical setting is almost
 * never neutral — it activates anticipatory anxiety. The mind fills the
 * void of "what happens next" with its worst predictions. A user who has
 * just poured their intake answers into the app and is now waiting for
 * their partner to do the same is in a genuinely vulnerable state: they
 * have begun to open, they have committed to being here, and now the
 * room is empty.
 *
 * The visual environment in this state must accomplish a specific
 * clinical task: it must interrupt the brain's tendency to generate
 * anxious predictions by giving the perceptual system something slow,
 * unified, and unresolved to rest in. Not a distraction — a held space.
 *
 * The neurological mechanism:
 *   When the visual field moves slowly and uniformly, the brain's superior
 *   colliculus (which manages rapid eye movement and threat detection) goes
 *   into a lower-alert state. Smooth pursuit eye movement — tracking a
 *   slowly moving object — activates the parasympathetic nervous system
 *   in the same way deep exhalation does. The waiting canvas exploits
 *   this by making the visual field's natural slow drift even slower and
 *   more predictable, literally entrained to the viewer's visual cortex
 *   at a calming frequency.
 *
 * The felt experience:
 *   Being underwater. Watching dust motes suspended in a wide beam of
 *   afternoon sunlight. The stillness of a room just before something
 *   beautiful is about to begin. Anticipation without urgency.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THIS STATE IS ACTIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Active in these conditions:
 *
 *   WaitingScreen.jsx passes overrideCanvasState='waiting' as a prop to
 *   LivingCanvas.jsx explicitly. This is the primary trigger — WaitingScreen
 *   always shows the waiting state regardless of FSM mode.
 *
 *   Also activates when FSM mode maps to 'waiting' via modeToCanvasState():
 *     mode: 'ready_for_session' → 'waiting'
 *   This handles the brief period after both intakes are submitted but
 *   before the opening message arrives — the canvas stays in waiting state
 *   rather than snapping directly to the idle/guided state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VISUAL DESIGN DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This state departs from the painting's character in five ways, each of
 * which has a specific clinical justification:
 *
 * 1. SLOWER PARTICLES (speedMul: 0.55)
 *    Particle speed is the parameter most directly correlated with perceived
 *    urgency. At 55% of the painting's native speed, particles slow to a
 *    drift rather than a travel. The difference between 100% and 55% is
 *    large enough to be consciously perceptible — the user will register
 *    that "the room got slower" without being able to name exactly why.
 *    This is the parameter to tune if the waiting state feels too slow
 *    (increase toward 0.70) or not calming enough (decrease toward 0.45).
 *
 * 2. SLOWER FIELD EVOLUTION (flowMul: 0.58)
 *    The macro-currents in the field shift more slowly. This is distinct
 *    from particle speed — it governs how quickly the underlying direction
 *    the particles are moving changes, not how fast they travel in that
 *    direction. Slowing both independently creates the "suspended" quality:
 *    particles move slowly through a field that itself barely changes.
 *    Neither the passengers nor the water they're in has any urgency.
 *
 * 3. SMOOTHER FLOW (varianceMul: 0.42)
 *    Angle variance is the most direct visual correlate of anxiety. High
 *    variance = scattered, unpredictable motion that activates the threat-
 *    detection system. At 42% of native variance, Pollock's chaotic 0.72
 *    becomes 0.30 — still complex but organized, like eddies in a stream
 *    rather than rapids. Gentle's native zero stays zero (0.42 × 0.0 = 0.0).
 *    This means Gentle users notice no change in variance, which is correct:
 *    their environment was already laminar, and it stays that way.
 *    Practical users (native 0.55) drop to 0.23 — their urgent gestural marks
 *    become slower, rounder, more contemplative.
 *
 * 4. SOFTER MARKS (radiusMul: 1.18)
 *    Larger particle radius means individual dots become softer blobs, and
 *    overlapping blobs become even softer pools. This removes any sense of
 *    sharpness or precision from the visual field — sharpness implies action,
 *    and action implies urgency. Soft diffuse marks signal the opposite:
 *    there is time, there is space, there is no required next move.
 *    The 1.18 multiplier is deliberately modest — Gentle's 3.2px becomes
 *    3.77px (barely perceptible individually), while Practical's 0.9px
 *    becomes 1.06px (thin line becomes slightly softer line). The radius
 *    shift is felt as atmosphere, not as a visible scale change.
 *
 * 5. SLIGHT DIMMING (opacityMul: 0.78)
 *    The canvas steps back from the foreground. Colors become softer and
 *    less saturated without changing hue — as if the light in the room
 *    dropped by 20%. This creates visual breathing room: the canvas is
 *    present but not assertive, supporting rather than occupying.
 *    At 0.78, Gentle's already-microscopic 0.28 becomes 0.22 — extremely
 *    delicate, almost atmospheric. Pollock's confident 0.65 becomes 0.51 —
 *    still present but noticeably quieter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WAITING CANVAS IS NOT THE STILLNESS CANVAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Stillness (canvasStillness.js) is a near-complete suspension of motion,
 * used for crisis states and safety pauses. Waiting is NOT that severe.
 *
 * The difference in felt experience:
 *   Waiting: a room breathing slowly, present and alive but unhurried.
 *   Stillness: a room holding its breath.
 *
 * The difference in clinical intent:
 *   Waiting: "You are safe here; take your time."
 *   Stillness: "Stop. Be still. Nothing else matters right now."
 *
 * If the waiting state ever starts to feel oppressive or too slowed-down,
 * the problem is almost certainly sedimentAdd being non-zero (causing
 * trails to shorten visibly) or speedMul going below 0.45. The waiting
 * state should feel alive — just slow. It should never feel frozen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRANSITION BEHAVIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Entering waiting:
 *   PaletteBlend.setCanvasState('waiting', now) transitions the color layer
 *   over 800ms. The particle physics (handled by mergeCanvasParams) change
 *   immediately on the next updatePaintingParams() call from LivingCanvas.jsx.
 *   There is a 800ms color transition with an immediate physics transition —
 *   this is intentional. The physics change is subtle enough not to feel
 *   like a snap, while the color change is gradual enough to feel like
 *   the room breathing out.
 *
 * Exiting waiting:
 *   When Partner B's intake completes, the FSM transitions to guided mode.
 *   LivingCanvas.jsx detects this and transitions out of waiting. The
 *   canvas speed gradually returns to normal over the same 800ms color
 *   transition period. The user experiences this as the room becoming
 *   present and alive just as the session is about to begin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEBUG NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The most common issue in waiting state: it feels too slow or static.
 * Debug steps:
 *
 *   1. Verify the override is being applied:
 *      In LivingCanvas.jsx, add to applyCurrentParams():
 *      console.log('[mergeCanvasParams] state:', stateName, 'overrides:', overrides)
 *      Should show canvasWaitingOverrides being applied.
 *
 *   2. Verify particle speed is correctly reduced:
 *      The merged particleSpeed should be painting.particleSpeed × 0.55.
 *      For gentle (native 0.32): merged = 0.32 × 0.55 = 0.176
 *      For balanced (native 1.10): merged = 1.10 × 0.55 = 0.605
 *      Read from NoiseField's constructor to confirm.
 *
 *   3. Verify flow speed:
 *      Add to NoiseField.render(), temporarily:
 *      if (frameCount % 120 === 0) console.log('[flow]', this._time)
 *      Compare the rate of time increase between idle and waiting modes.
 *      In waiting, time should advance at ~56% of idle's rate.
 *
 *   4. If the waiting state looks identical to idle:
 *      The most likely cause is the spread operator bug from the earlier
 *      debugging session — mergeCanvasParams returning the painting unchanged.
 *      Verify that the spread operator fix is in place and that the
 *      STATE_OVERRIDES_MAP in LivingCanvas.jsx contains 'waiting': canvasWaitingOverrides
 *      rather than null or undefined.
 *
 *   5. If the waiting state looks too dramatic (big visual shift):
 *      Increase speedMul toward 0.70, opacityMul toward 0.88, varianceMul toward 0.65.
 *      The transition should feel like the room exhaling, not like the room
 *      going to sleep.
 *
 * Calibration reference values (Gentle painting in waiting state):
 *   Native particle speed: 0.32 → merged: 0.176
 *   Native flow speed: 0.22 → merged: 0.128
 *   Native variance: 0.0 → merged: 0.0 (zero × anything = zero)
 *   Native opacity: 0.28 → merged: 0.218
 *   Native radius: 3.2 → merged: 3.776
 *   Native sediment: 0.68 → merged: 0.68 + 0.0 = 0.68 (unchanged)
 */


// ─────────────────────────────────────────────────────────────────────────────
// WAITING OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────

export const canvasWaitingOverrides = Object.freeze({
    // Particle speed: 55% of native
    // The room moves but doesn't travel. Drift, not direction.
    // If this feels too slow: increase to 0.65
    // If the waiting state fails to register as calmer than idle: decrease to 0.45
    speedMul: 0.55,
  
    // Particle opacity: 78% of native
    // The canvas steps back — present but not assertive.
    // Creates visual breathing room without dimming to the point of absence.
    opacityMul: 0.78,
  
    // Field evolution: 58% of native
    // The underlying direction changes more slowly — the current barely shifts.
    // Combined with speedMul, creates the "suspended in still water" quality.
    // Slightly higher than speedMul (0.58 vs 0.55) so that while particles
    // move slowly, the field they're moving through still shows faint drift —
    // the room is slow but not frozen.
    flowMul: 0.58,
  
    // Angle variance: 42% of native
    // Chaotic fields become organized. Organized fields become laminar.
    // Laminar fields never became chaotic (zero × 0.42 = zero).
    // The result: all four paintings develop smooth, predictable flow in waiting.
    varianceMul: 0.42,
  
    // Sediment addition: 0.0
    // Trail length stays exactly as the painting defines it.
    //
    // Why not increase sediment to shorten trails and simplify the field?
    // Because shorter trails in a slow-moving field create a sparse, empty
    // canvas — which reads as desolate rather than held. Gentle's long soak
    // trails and Pollock's short surface trails both serve the waiting state
    // correctly at their native lengths. The slowness of motion already
    // simplifies the visual field without removing the trails' presence.
    sedimentAdd: 0.0,
  
    // Particle radius: 118% of native
    // Marks become softly larger. Not dramatically — the change is atmospheric.
    // Gentle's 3.2px → 3.78px: imperceptible per-dot, felt as overall softness.
    // Practical's 0.9px → 1.06px: thin chalk lines develop a very slight softness.
    // The field loses any sense of sharpness or precision at this multiplier,
    // which is exactly the clinical intent: nothing in this environment is
    // demanding, incisive, or requiring immediate response.
    radiusMul: 1.18,
  })