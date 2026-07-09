/**
 * src/animations/motionTokens.js
 *
 * The physics primitives for Alinda's motion system.
 *
 * Consumes raw values from design/tokens.js and formats them into
 * ready-to-use Framer Motion transition objects.
 *
 * THE ANTI-SPRING LAW:
 *   Every transition in this file uses type: 'tween'.
 *   No spring, no bounce, no damping, no stiffness.
 *   Stone does not bounce. Marble does not have elasticity.
 *   Movement here is the sliding of heavy slabs, or ink bleeding
 *   slowly into absorbent paper. This is enforced at the primitive
 *   level so no individual component can accidentally introduce
 *   spring physics by omitting a transition definition.
 *
 * REDUCED MOTION:
 *   Every exported object has a .reduced variant. Components should
 *   check useReducedMotion() from Framer Motion and swap to the
 *   .reduced variant when true. This is handled centrally in
 *   transitions.js using the useReducedMotion hook, not in individual
 *   components — this file defines both versions for every primitive.
 *
 * Usage:
 *   import { transitionStone, tapPrimitive } from 'animations/motionTokens'
 *   <motion.div transition={transitionStone} whileTap={tapPrimitive} />
 */

import { easing, duration } from 'design/tokens'


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER
//
// Converts a token duration (ms) to seconds, since Framer Motion
// expects duration in seconds while our token system uses milliseconds
// for consistency with CSS transition-duration.
// ─────────────────────────────────────────────────────────────────────────────

const ms = (ms) => ms / 1000


// ─────────────────────────────────────────────────────────────────────────────
// BASELINE TRANSITION OBJECTS
//
// Each object is a complete Framer Motion transition config — pass
// directly to the `transition` prop of any motion element.
//
// Naming convention:
//   transition{Curve}    — the full-weight version
//   .reduced             — for prefers-reduced-motion users
//
// The .reduced variants are never instant (which can feel abrupt) —
// they are fast (80ms) opacity-only crossfades that convey the same
// state change without any spatial movement.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stone — heavy, slow, inevitable.
 * Primary transition for screen entrances, overlay appearances,
 * any element that should feel like it has real physical weight.
 * The slowest and most deliberate transition in the system.
 */

export const transitionStone = {
    type:     'tween',
    ease:     easing.stone,
    duration: ms(duration.slow),
  }
  
  export const transitionStoneReduced = {
    type:     'tween',
    ease:     'linear',
    duration: ms(duration.micro),
  }


/**
 * Reveal — content appearing.
 * Starts quickly, decelerates gently into its resting position.
 * Used for message bubbles, cards rising into view, text appearing.
 * Faster than Stone to feel responsive, not ponderous.
 */
export const transitionReveal = {
  type:     'tween',
  ease:     easing.reveal,
  duration: ms(duration.moderate),  // 350ms
}

export const transitionRevealReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


/**
 * Vanish — content leaving.
 * Slightly faster than reveal — departure should feel natural,
 * not slow enough to feel like dragging something away.
 * Elements accelerate into their exit rather than decelerating.
 */
export const transitionVanish = {
  type:     'tween',
  ease:     easing.vanish,
  duration: ms(duration.fast),  // 180ms
}

export const transitionVanishReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


/**
 * Settle — small, precise UI interactions.
 * Crisp and immediate — pressing into firm clay.
 * Used for button presses, copy confirmation, input focus states.
 * Short duration with a decisive ease that arrives without hesitation.
 */
export const transitionSettle = {
  type:     'tween',
  ease:     easing.settle,
  duration: ms(duration.fast),  // 180ms
}

export const transitionSettleReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


/**
 * Breath — the canvas and ambient UI pulsing.
 * Almost imperceptibly slow — one inhale and exhale over 3.2 seconds.
 * Used for the turn glow, Alinda's presence pulse, any element that
 * should feel like it's alive without visibly moving.
 * Never reduced to zero — a very slow, very subtle opacity shift
 * is used instead so the pulsing isn't completely gone for anyone.
 */
export const transitionBreath = {
  type:       'tween',
  ease:       easing.breath,
  duration:   ms(duration.breath),    // 3200ms
  repeat:     Infinity,
  repeatType: 'reverse',              // pendulum — inhale then exhale
}

export const transitionBreathReduced = {
  type:       'tween',
  ease:       'linear',
  duration:   ms(duration.breath * 2), // even slower, barely perceptible
  repeat:     Infinity,
  repeatType: 'reverse',
}


/**
 * Theme crossfade — used when switching Olympian ↔ Titan.
 * Matches the CSS transition-duration defined on <html> in index.css
 * (--theme-transition: 500ms) so JS-animated values and CSS-animated
 * values complete at the same moment, avoiding visual inconsistency
 * where some elements have already changed while others are mid-fade.
 */
export const transitionTheme = {
  type:     'tween',
  ease:     easing.stone,
  duration: ms(duration.slow),  // 500ms — matches --theme-transition
}

export const transitionThemeReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


// ─────────────────────────────────────────────────────────────────────────────
// STAGGER TIMING
//
// Used on parent containers to cascade children in sequence.
// The parent variant sets staggerChildren; the children use their
// own reveal/vanish transitions independently.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard stagger — for message lists, summary sections, intake steps.
 * 150ms between each child: enough to read each item before the next
 * arrives, not so long that the cascade feels like loading.
 */
export const staggerStandard = {
  staggerChildren:  0.15,
  delayChildren:    0,
}

/**
 * Slow stagger — for the Session Summary dashboard sections.
 * More breathing room between items, matching the contemplative tone
 * of reading clinical insights about your own session.
 */
export const staggerSlow = {
  staggerChildren:  0.25,
  delayChildren:    0.1,
}

/**
 * Fast stagger — for small UI element groups (star ratings, quick options).
 * Still sequential, never simultaneous, but tighter than standard.
 */
export const staggerFast = {
  staggerChildren:  0.06,
  delayChildren:    0,
}


// ─────────────────────────────────────────────────────────────────────────────
// TAP / PRESS PRIMITIVES
//
// Replace the browser's native tap feedback (which we've disabled in
// index.css). Applied directly to the whileTap prop of interactive elements.
// All use scale transforms — never color changes, which would fight
// the carefully constructed palette.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard press — for primary buttons and large interactive surfaces.
 * A subtle, decisive scale-down that reads as pressing into stone.
 * Never less than 0.96 — any smaller reads as a UI glitch.
 */
export const tapPrimary = {
  scale:      0.97,
  transition: transitionSettle,
}

/**
 * Light press — for smaller interactive elements (copy button, close icon).
 * Even more subtle than primary — barely perceptible, but definitively present.
 */
export const tapLight = {
  scale:      0.985,
  transition: transitionSettle,
}

/**
 * Style selector press — for the painting preview cards on IntakeScreen.
 * Scales down slightly and adds a very subtle opacity change to reinforce
 * the "selecting from a set" interaction.
 */
export const tapSelector = {
  scale:      0.96,
  opacity:    0.85,
  transition: transitionSettle,
}

/**
 * No-op tap — for elements that are interactive but should give no
 * visual feedback (e.g. the session transcript area where tapping
 * to scroll is expected behavior, not a press action).
 * Explicitly defined rather than omitted so it's clear the absence
 * of feedback is intentional.
 */
export const tapNone = {}


// ─────────────────────────────────────────────────────────────────────────────
// HOVER PRIMITIVES
//
// Hover states are subtle — they signal interactivity without
// anticipating the press. On touch devices, hover states are
// intentionally invisible (touch doesn't hover); these are
// desktop-only enhancements.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard hover — for buttons and cards.
 * A barely perceptible scale-up and brightness increase.
 * Communicates "this is pressable" without excitement.
 */
export const hoverPrimary = {
  scale:  1.015,
  transition: {
    type:     'tween',
    ease:     easing.settle,
    duration: ms(duration.fast),
  },
}

/**
 * Lift hover — for cards that should appear to rise from the surface.
 * Slightly more pronounced than standard, for larger clickable areas.
 */
export const hoverLift = {
  scale:     1.02,
  y:         -2,
  transition: {
    type:     'tween',
    ease:     easing.settle,
    duration: ms(duration.fast),
  },
}


// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATION HELPERS
//
// Utility objects for coordinating multiple animated elements.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delay offsets — for manually staggered elements when the automatic
 * staggerChildren approach isn't flexible enough (e.g. specific layout
 * requirements where children aren't direct descendants of the parent).
 *
 * Usage: { ...transitionReveal, delay: delayOffset.second }
 */
export const delayOffset = {
  first:  0,
  second: ms(150),
  third:  ms(300),
  fourth: ms(450),
  fifth:  ms(600),
}


/**
 * A complete transition bundle — the full set of properties needed for
 * a component that has both entry/exit and interactive states.
 *
 * Usage: spread into a component's props alongside its own variants.
 *   <motion.div {...motionBundle.card} variants={myCardVariants}>
 */
export const motionBundle = {
  card: {
    whileTap:   tapPrimary,
    whileHover: hoverLift,
    transition: transitionReveal,
  },
  button: {
    whileTap:   tapPrimary,
    whileHover: hoverPrimary,
    transition: transitionSettle,
  },
  selector: {
    whileTap:   tapSelector,
    whileHover: hoverLift,
    transition: transitionReveal,
  },
}