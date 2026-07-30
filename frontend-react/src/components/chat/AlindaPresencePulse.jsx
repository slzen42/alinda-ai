/**
 * src/components/chat/AlindaPresencePulse.jsx
 *
 * The Zenith — a single point of warm light at the ceiling of the room.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPATIAL METAPHOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When Alinda holds the floor, the TurnGlow fills the bottom of the room
 * with a tidal swell of bronze and sage. When she releases the floor —
 * when the session enters Free Chat — that dispersed light doesn't simply
 * disappear. It gathers. It condenses. It rises.
 *
 * The AlindaPresencePulse is the residue of that gathering: a single,
 * warm point of light at the absolute top-center of the screen, smaller
 * than a fingertip, breathing at the room's 0.1Hz rhythm.
 *
 * It tells both partners: "I am still here. The floor is yours.
 * I am not gone — I am watching from above, holding the room."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENTRANCE ANIMATION: THE CONDENSATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The pulse does not travel from the floor (which would require brittle
 * cross-component choreography with TurnGlow's exit timing).
 *
 * Instead, it condenses at the ceiling:
 *   - Mounts as a wide, soft horizontal blur: 80px wide, opacity 0.4, blur 12px
 *   - Over 1.2 seconds, collapses inward: width 8px, opacity 1.0, blur 0px
 *   - Easing: [0.4, 0.0, 0.2, 1.0] — starts slow (gathering), ends sharp
 *
 * This produces the "light coalescing into a point" quality.
 * The visual register is: diffuse → focused. Energy gathering, not dispersing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ZENITH AT REST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Once condensed, the pulse is:
 *   - 8px diameter sphere of warm bronze
 *   - Box shadow: three layered glows (2px sharp, 8px medium, 20px diffuse)
 *   - Opacity pulse at 0.1Hz (10s cycle, asymmetric 4s/6s)
 *   - Scale pulse: 1.0 → 1.35 → 1.0 in sync with opacity
 *
 * The glow layers are sized so the pulse is visible on any background —
 * the 20px diffuse outer glow provides the halo that reads against
 * the brightest canvas wash colours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLEND MODE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The glow layers use rgba with opacity — no blend mode on the dot itself.
 * The dot needs to read as a physical point of light, not as a transparent
 * wash. Blend modes are reserved for the floor-covering TurnGlow.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESKTOP VS MOBILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The pulse is always exactly 8px regardless of screen size.
 * On a 27" desktop monitor, the dot is the size of a small LED indicator.
 * The vast negative space around it is intentional — it enforces the
 * clinical truth that Alinda is present but not dominant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * isVisible:   boolean — true when the room is in Free Chat / open floor
 * isDark:      boolean — adjusts glow intensity for Olympian vs Titan
 */

import React, { useRef, useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'


// ─────────────────────────────────────────────────────────────────────────────
// GLOW PALETTE — Alinda's fixed identity colours
// ─────────────────────────────────────────────────────────────────────────────

// The dot itself
const DOT_COLOR       = '#8A9C78'     // oxidised bronze-sage — warm but not gold

// Glow layers — three radii for depth
const GLOW_SHARP      = 'rgba(138, 156, 120, 0.90)'   // 2px — the core
const GLOW_MID        = 'rgba(138, 156, 120, 0.45)'   // 8px — the halo
const GLOW_DIFFUSE    = 'rgba(138, 156, 120, 0.18)'   // 22px — the atmosphere
const GLOW_DARK_MID   = 'rgba(180, 200, 155, 0.55)'   // stronger in Titan mode
const GLOW_DARK_DIFF  = 'rgba(180, 200, 155, 0.22)'

const DOT_SIZE = 8   // px — fixed regardless of screen size


// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION VARIANTS
// ─────────────────────────────────────────────────────────────────────────────

// The condensation entrance
const condensationVariants = {
  dispersed: {
    width:    80,
    height:   4,
    opacity:  0.35,
    filter:   'blur(10px)',
    scaleX:   1,
  },
  condensed: {
    width:    DOT_SIZE,
    height:   DOT_SIZE,
    opacity:  1.0,
    filter:   'blur(0px)',
    scaleX:   1,
    transition: {
      type:     'tween',
      ease:     [0.4, 0.0, 0.2, 1.0],
      duration: 1.2,
    },
  },
}

const reducedCondensationVariants = {
  dispersed: { opacity: 0 },
  condensed: {
    opacity:    1,
    transition: { duration: 0.3 },
  },
}

// The ambient breath at rest — 0.1Hz, asymmetric
const breathVariants = {
  breathing: {
    scale:   [1.0, 1.38, 1.0],
    opacity: [0.7, 1.0,  0.7],
    transition: {
      times:    [0, 0.4, 1],
      duration: 10,
      repeat:   Infinity,
      ease:     'easeInOut',
    },
  },
  static: {
    scale:   1,
    opacity: 0.85,
  },
}


// ─────────────────────────────────────────────────────────────────────────────
// THE DOT
// ─────────────────────────────────────────────────────────────────────────────

function PulseDot({ isDark, prefersReduced }) {
  const mid  = isDark ? GLOW_DARK_MID  : GLOW_MID
  const diff = isDark ? GLOW_DARK_DIFF : GLOW_DIFFUSE

  const boxShadow = [
    `0 0 2px 1px ${GLOW_SHARP}`,
    `0 0 8px 4px ${mid}`,
    `0 0 22px 10px ${diff}`,
  ].join(', ')

  return (
    <motion.div
      className="rounded-full flex-shrink-0"
      style={{
        width:           DOT_SIZE,
        height:          DOT_SIZE,
        backgroundColor: DOT_COLOR,
        boxShadow,
      }}
      variants={breathVariants}
      animate={prefersReduced ? 'static' : 'breathing'}
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function AlindaPresencePulse({ isVisible, isDark }) {
  const prefersReduced = useReducedMotion()

  // Two-phase mount: first "dispersed" then "condensed"
  // The condensation animation fires on mount, then rests at condensed.
  const [phase, setPhase] = useState('dispersed')

  useEffect(() => {
    if (!isVisible) {
      setPhase('dispersed')
      return
    }
    // Tiny delay before starting condensation — ensures the component
    // is fully mounted and the AnimatePresence fade-in has begun
    const timer = setTimeout(() => setPhase('condensed'), 60)
    return () => clearTimeout(timer)
  }, [isVisible])

  const condensationVars = prefersReduced
    ? reducedCondensationVariants
    : condensationVariants

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="
            fixed top-0 left-1/2 -translate-x-1/2
            flex items-center justify-center
            pointer-events-none
          "
          style={{
            // 14px from top — comfortable distance from browser chrome
            // on both mobile and desktop
            paddingTop: 14,
            zIndex:     15,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity:    0,
            scale:      0.5,
            transition: { duration: 0.5, ease: 'easeIn' },
          }}
          transition={{ duration: 0.4 }}
          aria-live="polite"
          aria-label="Alinda is listening"
          role="status"
        >
          {/* Condensation wrapper — handles the width/blur animation */}
          <motion.div
            className="flex items-center justify-center overflow-visible"
            variants={condensationVars}
            initial="dispersed"
            animate={phase}
            style={{
              // The container starts wide for the dispersed state
              borderRadius: DOT_SIZE / 2,
              backgroundColor: phase === 'dispersed' ? DOT_COLOR : 'transparent',
            }}
          >
            {/* The dot only renders once condensed — prevents layout shift */}
            {phase === 'condensed' && (
              <PulseDot isDark={isDark} prefersReduced={prefersReduced} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}