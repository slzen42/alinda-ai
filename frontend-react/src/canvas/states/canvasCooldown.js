/**
 * src/canvas/states/canvasCooldown.js
 *
 * The De-escalation — the canvas during active emotional intervention.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cooldown is triggered by the backend FSM when mediator_logic.py detects
 * sustained high distress — a DISTRESS escalation score above the critical
 * threshold, or a 'cooldown_start' action from the AI mediator. It is an
 * active, deliberate visual intervention.
 *
 * When the human nervous system floods — acute anger, panic, or overwhelming
 * emotion — the prefrontal cortex (which handles language, reasoning, and
 * voluntary control) loses access to the brain's decision-making processes.
 * The amygdala takes over. In this state, the user literally cannot think
 * clearly. They cannot hear what Alinda is saying. They cannot access the
 * insight that might help them. They are in survival mode.
 *
 * No amount of clever AI language can reach someone who is flooded.
 * What CAN reach them is their perceptual system, which continues operating
 * below the level of thought. The visual environment becomes the intervention.
 *
 * The cooldown canvas works through three simultaneous mechanisms:
 *
 * 1. PACE ENFORCEMENT:
 *    Slowing the visual field forces the user's eyes to decelerate their
 *    scanning. Rapid eye movements (saccades) are both a symptom and a
 *    sustaining mechanism of acute anxiety — the eyes dart, looking for
 *    threat confirmation, and each rapid movement reinforces the neural
 *    state of alert. A slow, predictable visual field breaks this cycle.
 *    The eyes have to slow down to follow something that is moving slowly.
 *    Slowed eye movement activates the parasympathetic nervous system.
 *
 * 2. NOISE REMOVAL:
 *    The flooded brain cannot process complexity. Pollock's dense web of
 *    crossing lines and competing colors is normally experienced as rich
 *    and layered — but to a flooded nervous system, it registers as chaos
 *    that demands processing capacity the system doesn't have. By reducing
 *    variance to near-zero and sediment to near-maximum, the canvas
 *    removes that demand. What remains is space: a few slow, clean paths
 *    against mostly-empty ground. The visual cortex can process this
 *    without cognitive effort.
 *
 * 3. WEIGHT INDUCTION:
 *    Heavy, slow, inevitable motion is neurologically associated with
 *    safety. This is why the sound of ocean waves regulates the nervous
 *    system: the rhythm is slow, predictable, and vast — it does not require
 *    response. The cooldown canvas creates a visual analog of this experience.
 *    Something large is moving, very slowly, in a direction that is entirely
 *    determined. There is nothing to track or prepare for. The body can rest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COOLDOWN IS NOT VISIBLE TO THE PARTNER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An important clinical note: each device runs its own canvas independently.
 * When the FSM enters cooldown mode, both partners' canvases transition to
 * cooldown — but they do so simultaneously and without announcement. Neither
 * partner sees a label that says "COOLDOWN TRIGGERED." The canvas simply
 * becomes what it needs to be, and the room's tone shifts. This is exactly
 * how skilled co-regulation works in physical therapy: the therapist adjusts
 * their own pace and volume without making the client feel diagnosed or managed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THIS STATE IS ACTIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Active when FSM mode maps to 'cooldown' via modeToCanvasState():
 *   mode: 'cooldown'   → 'cooldown'
 *   mode: 'paused'     → 'cooldown'  (a user-initiated pause uses cooldown
 *                                      energy — different from crisis stillness)
 *
 * Also activates via PauseOverlay.jsx if the component passes
 * overrideCanvasState='cooldown' explicitly.
 *
 * Duration:
 *   The backend FSM controls when cooldown ends. When it resolves back to
 *   'guided', LivingCanvas.jsx detects the mode change and transitions the
 *   canvas back through PaletteBlend and applyCurrentParams(). The transition
 *   out of cooldown uses PaletteBlend's 800ms color transition — the canvas
 *   does not snap back to full energy immediately. This is intentional: the
 *   nervous system needs time to return from a calm state, and snapping back
 *   immediately would undo the grounding effect.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VISUAL CHANGES AT EACH VALUE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * speedMul: 0.35
 *   At 35% of native speed, the subjective experience of the canvas shifts
 *   from "painting in motion" to "geology in motion." The user notices that
 *   "the screen got slower" within about 2 seconds of the cooldown beginning.
 *   Below ~0.30, the motion becomes imperceptible and the canvas reads as
 *   nearly static — which tips into stillness territory. Above ~0.45, the
 *   deceleration is subtle enough that some users won't consciously register
 *   it. 0.35 is the sweet spot: unmistakably slower, not yet still.
 *
 * flowMul: 0.28
 *   Slightly lower than speedMul. The field's directional changes slow more
 *   than the particles' travel speed — this means particles follow long,
 *   sustained curves rather than constantly changing direction. On any painting,
 *   the result is that a particle near the center of the screen traces a
 *   large, gentle arc and stays on that arc for many seconds before the
 *   field slowly shifts it. This creates the "molasses" quality you described:
 *   motion that has committed to a direction and will not be hurried.
 *   Calibrated lower than speedMul because field evolution creates cognitive
 *   load even when individual particles are slow — unpredictable direction
 *   changes keep the eye busy regardless of speed.
 *
 * varianceMul: 0.08
 *   This is the most dramatic departure from native behavior in this state.
 *   At 8% of native variance:
 *   - Gentle (native 0.00): still 0.00. No change. Gentle was already laminar.
 *   - Direct (native 0.10): becomes 0.008. Near-perfect lines.
 *   - Balanced (native 0.72): becomes 0.058. Pollock's explosive scatter
 *     becomes a calm, organized drift. This is the most dramatic visible
 *     change in the Balanced painting mode — the chaotic web of competing
 *     lines suddenly has direction.
 *   - Practical (native 0.55): becomes 0.044. Twombly's gestural urgency
 *     becomes contemplative arcs. The marks lose their hurry.
 *   The clinical impact: all four paintings become versions of laminar flow
 *   in cooldown. The underlying current is clear, the paths are predictable.
 *   The room has chosen a direction and committed to it.
 *
 * opacityMul: 0.62
 *   Colors retreat. The marble ground becomes more present. On Gentle's
 *   wash layer (already at 40% saturation steady-state), this brings
 *   the visible color pools to about 25% saturation — still visible as
 *   soft tonal areas but no longer commanding attention.
 *   On Pollock (native opacity 0.65 per particle), particles draw at
 *   0.40 opacity — present but receding. The canvas becomes the background
 *   it always was, more clearly than before.
 *
 * sedimentAdd: 0.32
 *   This is the parameter responsible for the "sparse negative space" quality.
 *   Adding 0.32 to any painting's sediment:
 *   - Gentle (base 0.68): becomes 1.00. Maximum possible sedimentation.
 *     Particles blend completely into the background at the end of their life —
 *     no trails, no residue. Color appears from the wash layer only, with
 *     the particle system contributing micro-texture that vanishes on contact
 *     with the alpha-decay accumulation. The canvas looks almost empty.
 *   - Direct (base 0.22): becomes 0.54. Trails that previously stayed crisp
 *     now fade quickly. The cold-light luminous quality softens significantly.
 *   - Balanced (base 0.10): becomes 0.42. Pollock's sticky enamel now fades
 *     at a moderate rate. The dense web of drip skeins thins dramatically.
 *   - Practical (base 0.15): becomes 0.47. Twombly's chalk lines, already
 *     ephemeral, now disappear even faster. What remains is mostly the
 *     suggestion of where marks were, not the marks themselves.
 *
 * radiusMul: 0.85
 *   Marks are slightly smaller. Each particle occupies less visual space.
 *   Combined with high sediment (marks vanish faster) and low opacity
 *   (marks are quieter), this triples the sparsity effect: fewer marks
 *   are visible, they're smaller when visible, and they're quieter when
 *   present. The canvas becomes mostly ground.
 *   The 0.85 multiplier is modest by design — the goal is not to make marks
 *   invisible (that's stillness), but to make them less assertive. A few
 *   small, slow, clean marks on mostly-empty space is more grounding than
 *   an empty screen, which can feel like abandonment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPOUND EFFECT: HOW THE SIX VALUES INTERACT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The six multipliers are not independent — they interact:
 *
 * speedMul × flowMul: Both are low (0.35 × 0.28 equivalent effect on perceived
 *   motion). Slow particles in a slowly-changing field means the screen feels
 *   enormously heavy. Neither factor alone would produce this — slow particles
 *   in a fast field still look chaotic; fast particles in a slow field still
 *   look busy. Both together is what creates "molasses."
 *
 * varianceMul × sedimentAdd: Low variance makes the paths predictable; high
 *   sediment makes the traces short. The result: clean, brief marks on open
 *   ground, going in the same direction. Like a handful of slow-falling
 *   leaves in a windless afternoon — each one following an almost identical
 *   path, each one brief.
 *
 * opacityMul × radiusMul: Neither alone would make marks quiet. Together,
 *   they reduce the visual "weight" of each mark to about 53% of native
 *   (0.62 × 0.85 = 0.527). Marks that previously asserted themselves now
 *   support the ground rather than competing with it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIMULTANEOUS COLOR INTERVENTION (from paletteBlend.js)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When PaletteBlend.setCanvasState('cooldown', now) is called in LivingCanvas.jsx,
 * the color deltas defined in paletteBlend.js's STATE_DELTAS['cooldown'] also
 * activate:
 *   background delta:  [+2, +1, 0]   → the marble ground becomes very slightly
 *                                       warmer, like the sun came out from behind
 *                                       a cloud — a barely-perceptible warmth
 *   particle delta:    [+12, +4, -6] → particles shift slightly warmer (toward
 *                                       amber rather than bronze) — the one small
 *                                       visual warmth offered during a cold moment
 *   glow delta:        [+8, +2, -4]  → the turn glow and Alinda pulse warm slightly
 *
 * This color intervention is entirely separate from the six physics overrides
 * in this file. Both happen simultaneously, creating a compound effect:
 * the canvas slows and empties (physics) while becoming subtly warmer (color).
 * The combined message is "you are held in something warm and unhurried."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEBUG NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To manually test cooldown in the test App.jsx:
 *   Change overrideCanvasState="idle" to overrideCanvasState="cooldown"
 *   The canvas should visibly slow over the 800ms color transition period.
 *   Pollock and Practical show the most dramatic change (high native variance).
 *   Gentle shows the least dramatic change (near-laminar natively).
 *
 * Most common issue: cooldown looks identical to waiting.
 *   Verify speedMul is 0.35 here vs 0.55 in waiting. The difference is
 *   substantial. If they look the same, the override is not being applied.
 *   Use the debug technique from canvasWaiting.js: log the merged params
 *   immediately after applyCurrentParams() runs.
 *
 * Most common issue: cooldown feels too aggressive/dark.
 *   Increase opacityMul toward 0.70 and decrease sedimentAdd toward 0.22.
 *   The clinical intent is grounding, not erasure. The canvas should feel
 *   heavy and sparse, not empty and abandoned.
 *
 * Calibration reference (Balanced painting in cooldown):
 *   Native particle speed:   1.10 → merged: 0.385
 *   Native flow speed:       0.95 → merged: 0.266
 *   Native variance:         0.72 → merged: 0.058  ← the biggest visible change
 *   Native opacity:          0.65 → merged: 0.403
 *   Native radius:           1.4  → merged: 1.19
 *   Native sediment:         0.10 → merged: 0.42   ← trails shorten dramatically
 */

export const canvasCooldownOverrides = Object.freeze({
    speedMul:    0.35,
    opacityMul:  0.62,
    flowMul:     0.28,
    varianceMul: 0.08,
    sedimentAdd: 0.32,
    radiusMul:   0.85,
  })