/**
 * src/canvas/states/canvasIdle.js
 *
 * The Baseline Equilibrium — the canvas in its resting, listening state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Idle is not nothing. It is the specific quality of attention that a
 * skilled therapist maintains when a client is speaking — fully present,
 * completely undemanding. Not leaning forward with urgency (breakthrough),
 * not retreating to give space (waiting), not slowing down to contain
 * distress (cooldown). Just: here, breathing, witnessing.
 *
 * The idle state plays this role at the application level too. It is the
 * environment before the session begins, the environment during ordinary
 * conversation, and the state the canvas returns to after any intervention
 * (cooldown, breakthrough, stillness) has completed its work.
 *
 * Because idle is the most frequently active state in any session, it is
 * also the most consequential for the user's overall experience. The other
 * states derive their emotional impact from contrast with idle — a breakthrough
 * only feels radiant because idle was calm; a cooldown only feels grounding
 * because idle was lively. Idle is the reference frame everything else is
 * measured against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MATHEMATICAL PHILOSOPHY: THE IDENTITY TRANSFORM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every override in this file is the mathematical identity element for its
 * operation:
 *
 *   Multiplicative identity: 1.0  (x × 1.0 = x — no change)
 *   Additive identity:       0.0  (x + 0.0 = x — no change)
 *
 * This means idle is the one state that makes zero modification to the
 * painting's parameters. The canvas in idle mode is precisely the painting —
 * no louder, no quieter, no faster, no slower. It is Frankenthaler as
 * Frankenthaler intended, Pollock as the drip fell.
 *
 * This is intentional design, not laziness. It means:
 *
 * 1. Any visual calibration you do to the painting files (adjusting wash
 *    opacities, tuning particle speeds) immediately manifests in idle mode
 *    without requiring any compensating changes here. The painting and the
 *    idle state are the same thing.
 *
 * 2. The mathematical relationship between idle and every other state is
 *    completely transparent. Cooldown's speedMul of 0.35 means "35% of idle."
 *    Breakthrough's opacityMul of 1.25 means "125% of idle." All comparisons
 *    are relative to idle's 1.0 identity, which is unambiguous.
 *
 * 3. When debugging visual artifacts, you can always reset to idle and see
 *    the painting in its pure form. Idle is the ground truth.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THIS STATE IS ACTIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Active in these FSM conditions (from theme.js modeToCanvasState()):
 *   mode: 'intake'            → 'idle'  (before session starts)
 *   mode: 'closed'            → 'idle'  (after session ends)
 *
 * Also the default state for LivingCanvas.jsx before the sessionStore has
 * connected and provided a mode. All screens that don't explicitly set
 * overrideCanvasState render the painting in idle mode.
 *
 * NOT active during:
 *   - Live session ('guided', 'free_chat') → these map to null overrides
 *     in LivingCanvas.jsx's STATE_OVERRIDES_MAP, which means the painting
 *     runs with no overrides applied (equivalent to idle, but distinct —
 *     future states could differentiate guided from idle if needed)
 *   - Cooldown, crisis, pause → those use their own dedicated states
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OVERRIDE OBJECT SHAPE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All six fields are required. LivingCanvas.jsx's mergeCanvasParams() applies
 * them with fallback defaults (?? 1.0 for multipliers, ?? 0.0 for additive),
 * but explicit values in every state file prevent silent misconfiguration
 * if a field is accidentally added to the shape in the future.
 *
 *   speedMul    — multiplier on painting.particleSpeed
 *   opacityMul  — multiplier on painting.particleOpacity
 *   flowMul     — multiplier on painting.flowSpeed
 *   varianceMul — multiplier on painting.angleVariance
 *   sedimentAdd — additive delta on painting.ageSediment
 *   radiusMul   — multiplier on painting.particleRadius
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEBUG NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * If the canvas looks wrong in idle mode, the problem is in the painting
 * file (gentle.js, direct.js, etc.) or in the NoiseField engine — not here.
 * Idle does nothing. It cannot introduce a visual artifact.
 *
 * To verify idle is active:
 *   console.log('[canvasState]', LivingCanvas's currentCanvasStateRef.current)
 *   // Should print 'idle' on pre-session screens
 *
 * To verify idle applies no modifications:
 *   All six values below are identity elements. If any were accidentally
 *   changed, the painting would look different from its raw file definition.
 *   The test: does the canvas in idle look identical to a direct render of
 *   the painting with no state file applied? It should.
 *
 * To verify state transitions from idle:
 *   Add the following temporarily to LivingCanvas.jsx's frame loop:
 *   if (frameCount % 300 === 0) console.log('[state]', currentCanvasStateRef.current)
 *   This logs the state every 5 seconds at 60fps, letting you verify that
 *   transitions to cooldown/breakthrough/etc. fire and resolve correctly.
 */


// ─────────────────────────────────────────────────────────────────────────────
// IDLE OVERRIDES
//
// The mathematical identity. No painting parameter is modified.
// ─────────────────────────────────────────────────────────────────────────────

export const canvasIdleOverrides = Object.freeze({
    // Particle travel speed — 1.0 = exactly as the painting defines it
    // Gentle's particles drift; Pollock's particles rush. Both do so
    // at their native pace. Idle does not impose a tempo.
    speedMul: 1.0,
  
    // Particle opacity — 1.0 = exactly as the painting defines it
    // Gentle's whisper-opacity and Pollock's confident presence are both
    // preserved intact. Idle does not dim or amplify.
    opacityMul: 1.0,
  
    // Field evolution speed — 1.0 = exactly as the painting defines it
    // The macro-currents shift at their natural geological or gestural pace.
    // This is the most perceptually important parameter — changes here are
    // the first thing a user consciously registers as "the room speeding up/
    // slowing down." Idle holds it perfectly still at its natural rhythm.
    flowMul: 1.0,
  
    // Angle variance — 1.0 = exactly as the painting defines it
    // Gentle's zero variance means zero here (1.0 × 0.0 = 0.0).
    // Pollock's 0.72 variance means 0.72 here (1.0 × 0.72 = 0.72).
    // The painting's gestural character is exactly preserved.
    varianceMul: 1.0,
  
    // Sediment (additive) — 0.0 = no modification to the painting's ageSediment
    // Particles fade into the background at exactly the rate the painting
    // specifies. Frankenthaler's high-soak and Pollock's low-soak are both
    // intact. The trail lengths feel like the artist's intent.
    sedimentAdd: 0.0,
  
    // Particle radius — 1.0 = exactly as the painting defines it
    // Gentle's large soft pools and Practical's thin chalk lines are
    // both preserved at their native scale.
    radiusMul: 1.0,
  })