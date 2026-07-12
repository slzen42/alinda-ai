/**
 * src/animations/motionTokens.js
 *
 * Physics primitives for Alinda's motion system.
 *
 * THE ANTI-SPRING LAW:
 *   Every transition uses type: 'tween'.
 *   No spring, no bounce, no damping, no stiffness.
 *   Stone does not bounce. Marble does not have elasticity.
 *
 * REDUCED MOTION:
 *   Every transition has a parallel *Reduced named export.
 *   components/transitions.js selects between them via useReducedMotion().
 *   Individual components never check useReducedMotion directly.
 *
 * NAMING:
 *   transition{Curve}         — full motion
 *   transition{Curve}Reduced  — prefers-reduced-motion version
 */

import { easing, duration } from 'design/tokens'

// Framer Motion expects duration in seconds; our tokens use milliseconds.
const ms = (ms) => ms / 1000


// ─────────────────────────────────────────────────────────────────────────────
// BASELINE TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Heavy, slow, inevitable. Screen entrances, overlay appearances. */
export const transitionStone = {
  type:     'tween',
  ease:     easing.stone,
  duration: ms(duration.slow),   // 500ms
}

export const transitionStoneReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),  // 80ms — opacity only
}


/** Starts quickly, decelerates gently. Message bubbles, rising cards. */
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


/** Slightly faster departure. Elements accelerate into their exit. */
export const transitionVanish = {
  type:     'tween',
  ease:     easing.vanish,
  duration: ms(duration.fast),   // 180ms
}

export const transitionVanishReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


/** Crisp, precise. Button presses, copy confirmation, input focus. */
export const transitionSettle = {
  type:     'tween',
  ease:     easing.settle,
  duration: ms(duration.fast),
}

export const transitionSettleReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


/** Canvas and ambient UI pulsing. Almost imperceptibly slow. */
export const transitionBreath = {
  type:       'tween',
  ease:       easing.breath,
  duration:   ms(duration.breath),   // 3200ms
  repeat:     Infinity,
  repeatType: 'reverse',
}

export const transitionBreathReduced = {
  type:       'tween',
  ease:       'linear',
  duration:   ms(duration.breath * 2),
  repeat:     Infinity,
  repeatType: 'reverse',
}


/**
 * Theme crossfade. Matches --theme-transition in index.css (500ms)
 * so CSS and JS-animated values complete at exactly the same moment.
 */
export const transitionTheme = {
  type:     'tween',
  ease:     easing.stone,
  duration: ms(duration.slow),
}

export const transitionThemeReduced = {
  type:     'tween',
  ease:     'linear',
  duration: ms(duration.micro),
}


// ─────────────────────────────────────────────────────────────────────────────
// STAGGER TIMING
// ─────────────────────────────────────────────────────────────────────────────

/** Standard — message lists, summary sections, intake steps. 150ms between children. */
export const staggerStandard = {
  staggerChildren: 0.15,
  delayChildren:   0,
}

/** Slow — Session Summary dashboard. More room to breathe between items. */
export const staggerSlow = {
  staggerChildren: 0.25,
  delayChildren:   0.1,
}

/** Fast — small UI element groups, star ratings. */
export const staggerFast = {
  staggerChildren: 0.06,
  delayChildren:   0,
}


// ─────────────────────────────────────────────────────────────────────────────
// TAP / PRESS PRIMITIVES
// Replace disabled native tap highlight (from index.css).
// All use scale — never color changes that fight the palette.
// ─────────────────────────────────────────────────────────────────────────────

/** Primary buttons and large interactive surfaces. */
export const tapPrimary = {
  scale:      0.97,
  transition: transitionSettle,
}

/** Smaller interactive elements — copy button, close icon. */
export const tapLight = {
  scale:      0.985,
  transition: transitionSettle,
}

/** Painting preview cards on IntakeScreen. */
export const tapSelector = {
  scale:      0.96,
  opacity:    0.85,
  transition: transitionSettle,
}

/** Interactive elements that give no visual feedback (scroll areas). */
export const tapNone = {}


// ─────────────────────────────────────────────────────────────────────────────
// HOVER PRIMITIVES
// Desktop-only enhancements. Invisible on touch devices.
// ─────────────────────────────────────────────────────────────────────────────

export const hoverPrimary = {
  scale: 1.015,
  transition: {
    type:     'tween',
    ease:     easing.settle,
    duration: ms(duration.fast),
  },
}

export const hoverLift = {
  scale: 1.02,
  y:     -2,
  transition: {
    type:     'tween',
    ease:     easing.settle,
    duration: ms(duration.fast),
  },
}


// ─────────────────────────────────────────────────────────────────────────────
// DELAY OFFSETS
// For manually staggered elements that can't use staggerChildren.
// Usage: { ...transitionReveal, delay: delayOffset.second }
// ─────────────────────────────────────────────────────────────────────────────

export const delayOffset = {
  first:  0,
  second: ms(150),
  third:  ms(300),
  fourth: ms(450),
  fifth:  ms(600),
}


// ─────────────────────────────────────────────────────────────────────────────
// MOTION BUNDLES
// Convenience spreads for common component patterns.
// ─────────────────────────────────────────────────────────────────────────────

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