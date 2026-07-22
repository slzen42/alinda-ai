/**
 * src/canvas/states/canvasStillness.js
 *
 * The Deep Pause — the canvas during crisis, safety lockdown, and
 * the held silence after profound confession.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PURPOSE — AND WHY STILLNESS IS NOT COOLDOWN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is the most important distinction in the entire canvas state system:
 *
 *   COOLDOWN is for distress that needs to be de-escalated.
 *   STILLNESS is for moments that need to be witnessed.
 *
 * Cooldown says: "The room will slow down to help you breathe."
 * Stillness says: "Something significant just happened. Stop. Stay here."
 *
 * In clinical practice, therapists use silence differently depending on
 * its function:
 *
 * CONTAINING silence — used during high emotion to create space for
 *   regulation. This is what cooldown does visually.
 *
 * WITNESSING silence — used after a significant disclosure, a moment of
 *   vulnerability, or a painful realization. The therapist does not rush
 *   to respond. They sit with what was said. This is what stillness does.
 *   The canvas is not trying to help the user calm down — it is trying to
 *   honor the weight of what just happened by holding it without movement.
 *
 * Stillness activates in three conditions:
 *
 * 1. CRISIS / SAFETY INTERVENTION:
 *    When the FSM detects self-harm ideation or acute danger, the canvas
 *    immediately and completely empties. This is not aesthetic — it is a
 *    clinical decision. A visually complex or stimulating background is
 *    inappropriate when someone is in acute crisis. The canvas should become
 *    as close to a blank, calm surface as possible without disappearing
 *    entirely. Disappearing entirely would feel like abandonment. An almost-
 *    still canvas feels like presence without demand.
 *
 * 2. PAUSE SCREEN:
 *    When either partner initiates a pause, the canvas enters stillness —
 *    not cooldown. A pause is not a crisis; it is a deliberate choice.
 *    The canvas honors that choice by holding the painting's accumulated
 *    structures in near-suspension, like a photograph of everything that
 *    has been building in the room. The pause screen is a moment to look
 *    at where you are, not to be rescued from it.
 *
 * 3. PROFOUND REALIZATION / BREAKTHROUGH AFTERMATH:
 *    After a breakthrough bloom has faded (canvasBreakthrough.js completes
 *    its timer), if the AI detects that the user has entered a contemplative
 *    state — silent, processing, not typing — the canvas may transition from
 *    breakthrough's energy into stillness. The room becomes quiet after the
 *    illumination, making space for integration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FROZEN PAINTING EFFECT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The most important visual phenomenon in this state is not what moves
 * but what was left behind when movement stopped.
 *
 * Consider what happens mathematically:
 *
 * At the moment stillness activates, the canvas contains the accumulated
 * alpha-decay history of everything that happened during the session.
 * Pollock's canvas has ~200 frames of drip trails, all overlapping, forming
 * a dense web of marks at varying opacity. Frankenthaler's canvas has soft
 * pools of cerulean and coral at various stages of accumulation.
 *
 * When the engine drops to near-zero speed:
 *   - Particles stop moving (or nearly stop)
 *   - The alpha-decay rectangle continues running (at alphaDecay = 0.015),
 *     very slowly washing everything toward the background color
 *   - New particle marks are almost imperceptible (near-zero opacity at
 *     near-zero speed means they deposit almost no color before dying)
 *
 * The result is that the canvas becomes a slowly-dissolving photograph
 * of everything that has been painted during the session. The accumulated
 * structures — the trails, the washes, the pools — remain visible but
 * are very slowly absorbed into the ground. Over about 2-3 minutes, they
 * would fully dissolve back to blank marble.
 *
 * In practice, a pause screen rarely lasts 3 minutes. What the user sees
 * is the painting's accumulated history held nearly frozen, very slowly
 * breathing itself back into the stone. The visual metaphor is perfect:
 * everything that was said during the session is still present in the room,
 * slowly settling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NEAR-ZERO FLOOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Why near-zero rather than absolute zero?
 *
 * A completely frozen canvas — zero speed, zero flow — would display any
 * accumulated artifacts as permanently frozen. If the canvas happened to
 * freeze with an asymmetric concentration of color in one corner, it would
 * stay there with no drift toward equilibrium. The visual result after
 * extended stillness would be a strange, asymmetric color artifact.
 *
 * At near-zero (speedMul 0.05), the canvas still makes microscopic corrections
 * toward equilibrium. Over many minutes, everything very slowly returns to
 * the centered, balanced distribution of the field. But in any reasonable
 * pause duration (30 seconds to 3 minutes), this movement is completely
 * imperceptible. The canvas reads as static.
 *
 * More importantly: near-zero shows that something is still alive in the room,
 * even if it is barely moving. A completely static image on a screen reads
 * as frozen, broken, or off. A very slowly breathing canvas reads as held.
 * The user's eye will not consciously register the motion, but the visual
 * cortex's motion detection system will register it subliminally — and
 * will interpret it as presence. The room is still here. It just got quiet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VISUAL CHANGES AT EACH VALUE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * speedMul: 0.05
 *   Particles move at 5% of native speed. On Practical (native 1.45 speed),
 *   particles now travel at 0.0725 CSS pixels per frame — less than one pixel
 *   every 14 frames. Completely imperceptible at normal viewing distance.
 *   On Gentle (native 0.32), merged speed is 0.016 — essentially motionless.
 *   The painting's accumulated structures are held in place.
 *   The minimum near-zero floor, not absolute zero.
 *
 * flowMul: 0.04
 *   The vector field evolves at 4% of normal rate. At this level, the field
 *   changes would take approximately 25× longer than normal to produce any
 *   visible shift in particle direction. Over a 3-minute pause, the field
 *   might shift by a few degrees — imperceptible to conscious observation.
 *   The macro-currents of the painting are frozen in their current state.
 *
 * varianceMul: 0.0
 *   Absolute zero. Every particle follows its field vector exactly.
 *   No deviation, no individual character, no gestural energy.
 *   The mathematical consequence: if the field is nearly frozen AND variance
 *   is zero, then every particle in a given region of the canvas is moving
 *   in exactly the same direction at exactly the same speed. The entire field
 *   moves as a single, unified entity — which at near-zero speed means it
 *   barely moves at all.
 *   The visual result: whatever marks were on the canvas before stillness
 *   activated remain essentially stationary. The "frozen painting" effect.
 *
 * opacityMul: 0.25
 *   New particles appear at 25% of the painting's native opacity. This is
 *   the lowest opacity value in the entire state system.
 *   Why so low? Because in stillness, we DON'T want new marks being made.
 *   The existing accumulated painting on the canvas is what we're preserving —
 *   new marks would add noise to the frozen structure.
 *   At 0.25 opacity and near-zero speed, new particles deposit so little color
 *   per frame that they are mathematically invisible against the accumulated
 *   background. The canvas draws no new marks during stillness. Only the
 *   existing structure, very slowly settling, remains.
 *
 * radiusMul: 1.65
 *   New marks, though nearly invisible in opacity, are drawn at 165% of their
 *   native radius. Why increase radius when decreasing opacity?
 *   Because the few moments when a new mark IS perceptible (immediately after
 *   the stillness state activates, before full accumulation has settled) should
 *   read as soft, diffuse, atmospheric — not as sharp individual dots.
 *   Gentle's 3.2px becomes 5.28px — a soft cloud.
 *   Practical's 0.9px becomes 1.49px — a slightly softer chalk whisper.
 *   The combined effect: if anything new is visible during stillness, it is
 *   soft and large, adding ambient presence rather than gestural marks.
 *
 * sedimentAdd: 0.50
 *   The most extreme sedimentation value in the system.
 *   Adding 0.50 to any painting's sediment:
 *   - Gentle (base 0.68): becomes 1.18 — capped at 1.0 in the engine.
 *     Particles dissolve into the background instantaneously. No trails.
 *   - Direct (base 0.22): becomes 0.72. Trails are very short.
 *   - Balanced (base 0.10): becomes 0.60. Pollock's enamel, which normally
 *     stays on the surface forever, now fades at a significant rate.
 *   - Practical (base 0.15): becomes 0.65. Twombly's chalk marks vanish
 *     as fast as they're made.
 *   The result: even at near-zero speed, the few marks that do appear are
 *   immediately absorbed. The canvas makes no new permanent marks during stillness.
 *   Only the accumulated history from before stillness activated remains,
 *   and that history very slowly settles toward the marble ground.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPOUND EFFECT: THE FROZEN PAINTING IN PRACTICE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * What happens at the moment of transition from guided to stillness:
 *
 * T+0ms:    Stillness overrides applied. Physics immediately change.
 * T+0ms:    PaletteBlend begins 800ms color transition — colors very subtly
 *            drain of saturation (from paletteBlend.js STATE_DELTAS['stillness']):
 *            bg delta: [0,0,0], particle delta: [-60,-50,-40], glow: [-40,-35,-30]
 *            Particles shift significantly toward background (muted, desaturated).
 * T+0–800ms: The canvas slows from its native speed to near-zero over this
 *            period. Because the physics change is not gradual in the same way
 *            (mergeCanvasParams applies immediately), there may be a brief visible
 *            snap in particle speed. This is acceptable — the slowdown reads as
 *            intentional and dramatic, which suits the clinical moment.
 * T+800ms:  Color transition complete. Canvas is now in full stillness.
 * T+800ms+: The accumulated painting structure is now visible — washes, trails,
 *            the session's mark-making history — very slowly settling.
 * T+5min:   If stillness has been held for 5 minutes (unusual but possible in
 *            a long safety pause), the canvas has drifted noticeably toward
 *            equilibrium. The accumulated marks are somewhat fainter. The
 *            ground is reasserting itself. This is correct — the longer the
 *            silence is held, the more the canvas returns to the neutral
 *            marble from which everything began.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GRIEF AND REALIZATION QUALITY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * For the non-crisis uses of stillness (pause screen, breakthrough aftermath,
 * profound realization), the visual experience should feel like:
 *
 *   "The painting in this room has been accumulating everything we said.
 *    And now it is resting with all of it. So are we."
 *
 * Not empty. Not simple. Still holding everything that was here, very
 * gently dissolving it back into the stone. The session's emotional history
 * visible and present but beginning to settle.
 *
 * This is one of the most artistically sophisticated moments in the entire
 * application. The user does not know they are looking at a particle system.
 * They see the room, and the room is being quiet with them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEBUG NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To test stillness in the test App.jsx:
 *   overrideCanvasState="stillness"
 *   Wait 5–10 seconds for the alpha-decay to clear the initial particle draw.
 *   The canvas should show a very slowly settling cream/marble ground.
 *   On first load (no prior painting history), it may look nearly blank —
 *   this is correct for stillness with no accumulated history.
 *
 * Better test: add a temporary button to App.jsx that toggles between
 *   'guided' (or null, to see the painting) and 'stillness'.
 *   Run for 20–30 seconds in guided to accumulate paint history, then
 *   switch to stillness. You should see the accumulated painting freeze
 *   and very slowly begin to settle.
 *
 * Most common issue: stillness looks identical to cooldown.
 *   The most significant numerical differences are:
 *   - speedMul: 0.35 (cooldown) vs 0.05 (stillness) — large gap
 *   - opacityMul: 0.62 (cooldown) vs 0.25 (stillness) — large gap
 *   - sedimentAdd: 0.32 (cooldown) vs 0.50 (stillness) — significant gap
 *   If they look similar, verify the correct state file's export is mapped
 *   in LivingCanvas.jsx's STATE_OVERRIDES_MAP.
 *
 * Most common issue: stillness looks like a blank white screen.
 *   This means there was no prior painting history when stillness activated.
 *   The alpha-decay will have cleared any initial particle marks within
 *   ~200 frames at the near-zero opacity. Without accumulated paint from
 *   a prior guided session, there is nothing for stillness to freeze.
 *   In the real app, stillness only activates during an active session —
 *   the canvas will always have painting history by that point.
 *
 * Calibration reference (Gentle painting in stillness):
 *   Native particle speed:   0.32 → merged: 0.016  (essentially zero)
 *   Native flow speed:       0.22 → merged: 0.009  (essentially zero)
 *   Native variance:         0.00 → merged: 0.000  (exact zero)
 *   Native opacity:          0.28 → merged: 0.070  (invisible new marks)
 *   Native radius:           3.2  → merged: 5.28   (soft if visible at all)
 *   Native sediment:         0.68 → merged: 1.00   (capped — instant absorption)
 */

export const canvasStillnessOverrides = Object.freeze({
    speedMul:    0.05,
    opacityMul:  0.25,
    flowMul:     0.04,
    varianceMul: 0.0,
    sedimentAdd: 0.50,
    radiusMul:   1.65,
  })