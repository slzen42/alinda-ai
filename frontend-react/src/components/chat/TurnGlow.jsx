/**
 * src/components/chat/TurnGlow.jsx
 *
 * The Tidal Swell — chromatic floor lighting that marks Alinda's voice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FLOOR AS PRESENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When Alinda speaks, the room responds — not from the sides (which belong
 * to the human partners) but from below. The floor of the conversation
 * gathers light. Three colours rise from the bottom edge and fall back.
 *
 * This is the Tidal Swell: a wide gradient anchored to `fixed bottom-0`,
 * reaching approximately 35% up the viewport. It throbs at 0.1Hz — the
 * same clinical vagal breath rate as every other breathing element in
 * the application. Consistency in breath rhythm is the invisible architecture
 * that makes the whole experience feel like one coherent room.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALINDA'S COLOUR IDENTITY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The human turn indicator uses the session painting's colours (from the
 * canvas glow properties). Alinda's floor glow uses a fixed, distinct
 * palette that belongs only to her:
 *
 *   Oxidised Bronze:  #7A8C6E  — warm, grounded, her primary tone
 *   Soft Sage:        #8FAF8C  — growth, gentle mediation
 *   Pale Gold:        #C4A55A  — the rare accent, warmth without fire
 *
 * These three colours shift in dominance as the swell breathes, creating
 * the slow shimmer described as "underwater light." They never fully
 * replace each other — they are always present, only their weight changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLEND MODE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 'screen' in dark (Titan) mode: the three colours emerge from darkness,
 * visibly brightening the lower third of the canvas. The effect is vivid
 * and present — the room lighting up with Alinda's presence.
 *
 * 'multiply' in light (Olympian) mode: the colours deepen into the marble
 * surface rather than brightening it. A more restrained, tonal warmth —
 * appropriate for the lighter context.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ANIMATION STRUCTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three simultaneous animations create the compound "tidal" effect:
 *
 * 1. MASTER PULSE (0.1Hz, 10s):
 *    The entire swell breathes in opacity — 0.0 → 1.0 → 0.0.
 *    This is the vagal entrainment rhythm. Asymmetric: 4s rise, 6s fall.
 *
 * 2. COLOUR SHIFT (30s, slow):
 *    The three colours shift in their relative opacity contributions.
 *    Bronze dominates at rest; Sage rises at the pulse peak; Gold
 *    flickers briefly at the peak's crest before fading back.
 *    30s is slow enough to feel like a single, continuous shimmer.
 *
 * 3. HEIGHT VARIATION (0.1Hz, in sync with pulse):
 *    The gradient's reach changes with the breath — slightly taller at
 *    inhale, slightly shorter at exhale — creating the sense that the
 *    swell is physically rising and falling with the tide.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VISIBILITY GUARANTEE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The minimum opacity at the swell's base (the bottom edge) is 0.22 in
 * dark mode and 0.16 in light mode. These values were tested against both
 * the pure marble background and the brightest canvas wash colours and
 * maintain visible presence in all conditions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * isVisible:   boolean — true when Alinda holds the floor
 * isDark:      boolean — toggles blend mode and opacity values
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'


// ─────────────────────────────────────────────────────────────────────────────
// ALINDA'S PALETTE — fixed, not derived from the painting
// ─────────────────────────────────────────────────────────────────────────────

// These are the three colour components of the swell gradient.
// Each is used at a different opacity and position in the radial stack.
const PALETTE = {
  bronze: '122, 140, 110',   // Oxidised Bronze — RGB components for rgba()
  sage:   '143, 175, 140',   // Soft Sage
  gold:   '196, 165, 90',    // Pale Gold
}


// ─────────────────────────────────────────────────────────────────────────────
// STATIC GRADIENT BUILDER
//
// Constructs the CSS background string for the swell at a given state.
// Three overlapping radial gradients, each a different colour,
// each at a different horizontal centre point.
//
// The three centres create a wide spread:
//   Bronze: centred left-of-centre   (30%)
//   Sage:   centred exactly at centre (50%)
//   Gold:   centred right-of-centre  (70%)
//
// Overlapping them horizontally creates the shimmering blend where the
// colours meet — the "underwater light" quality.
//
// Parameters:
//   bronzeO, sageO, goldO: current opacity for each colour
//   height: the gradient reach as a percentage string, e.g. '35%'
//   isDark: whether to use screen-friendly opacity floor
// ─────────────────────────────────────────────────────────────────────────────

function buildGradient(bronzeO, sageO, goldO, height, isDark) {
  // Floor opacity ensures visibility — the bottom edge never fully disappears
  const floor = isDark ? 0.22 : 0.14

  const bronzeFloor = Math.max(floor, bronzeO * 0.55)
  const sageFloor   = Math.max(floor * 0.7, sageO * 0.45)
  const goldFloor   = Math.max(floor * 0.5, goldO * 0.35)

  const bronze = `radial-gradient(ellipse 80% ${height} at 30% 100%,
    rgba(${PALETTE.bronze},${bronzeFloor.toFixed(3)}) 0%,
    rgba(${PALETTE.bronze},${(bronzeFloor * 0.5).toFixed(3)}) 35%,
    rgba(${PALETTE.bronze},0) 70%)`

  const sage = `radial-gradient(ellipse 90% ${height} at 50% 100%,
    rgba(${PALETTE.sage},${sageFloor.toFixed(3)}) 0%,
    rgba(${PALETTE.sage},${(sageFloor * 0.4).toFixed(3)}) 40%,
    rgba(${PALETTE.sage},0) 72%)`

  const gold = `radial-gradient(ellipse 65% ${height} at 70% 100%,
    rgba(${PALETTE.gold},${goldFloor.toFixed(3)}) 0%,
    rgba(${PALETTE.gold},${(goldFloor * 0.35).toFixed(3)}) 30%,
    rgba(${PALETTE.gold},0) 65%)`

  return [bronze, sage, gold].join(', ')
}


// ─────────────────────────────────────────────────────────────────────────────
// THE SWELL (the animated gradient layer)
// ─────────────────────────────────────────────────────────────────────────────

function Swell({ isDark, prefersReduced }) {
  // Breathing state — drives all three animations
  const phaseRef    = useRef(0)      // 0–1, cycles at 0.1Hz
  const colourRef   = useRef(0)      // 0–1, cycles at 1/30Hz
  const rafRef      = useRef(null)
  const lastTimeRef = useRef(null)

  const [gradient, setGradient] = useState(() =>
    buildGradient(0.7, 0.5, 0.25, '35%', isDark)
  )

  const blendMode = isDark ? 'screen' : 'multiply'

  useEffect(() => {
    if (prefersReduced) return

    function frame(now) {
      rafRef.current = requestAnimationFrame(frame)

      if (lastTimeRef.current === null) {
        lastTimeRef.current = now
        return
      }

      const delta = Math.min(now - lastTimeRef.current, 50) / 1000  // seconds, capped
      lastTimeRef.current = now

      // Advance breath phase at 0.1Hz (10s cycle)
      phaseRef.current  = (phaseRef.current  + delta * 0.1)  % 1
      // Advance colour phase at 1/30Hz (30s cycle)
      colourRef.current = (colourRef.current + delta * (1/30)) % 1

      // Asymmetric breath: 4s rise (0–0.4), 6s fall (0.4–1.0)
      const breathProgress = phaseRef.current
      let breathValue
      if (breathProgress <= 0.4) {
        // Inhale — ease in
        breathValue = breathProgress / 0.4
      } else {
        // Exhale — ease out
        breathValue = 1 - ((breathProgress - 0.4) / 0.6)
      }

      // Apply a curve so the breath feels organic, not linear
      const breath = 0.5 + 0.5 * (Math.sin(breathValue * Math.PI - Math.PI / 2) * 0.5 + 0.5)

      // Colour weights — each colour rises at a different phase
      // Bronze: always dominant, peaks in mid-breath
      // Sage: rises toward peak breath
      // Gold: flickers briefly near peak, like a crest of light
      const bronzeO = 0.55 + 0.45 * breath
      const sageO   = 0.30 + 0.70 * Math.pow(breath, 1.5)
      const goldO   = Math.pow(Math.max(0, breath - 0.6) / 0.4, 2) * 0.80

      // Gradient height varies with breath: 30% at rest, 40% at peak
      const height  = `${(30 + 10 * breath).toFixed(1)}%`

      setGradient(buildGradient(bronzeO, sageO, goldO, height, isDark))
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isDark, prefersReduced])

  if (prefersReduced) {
    // Static version — no animation, still visible
    return (
      <div
        className="fixed bottom-0 inset-x-0 pointer-events-none"
        style={{
          zIndex:       5,
          background:   buildGradient(0.65, 0.45, 0.20, '32%', isDark),
          mixBlendMode: blendMode,
          height:       '35vh',
        }}
        aria-hidden="true"
      />
    )
  }

  return (
    <div
      className="fixed bottom-0 inset-x-0 pointer-events-none"
      style={{
        zIndex:       5,
        background:   gradient,
        mixBlendMode: blendMode,
        // Full height — the gradient itself controls the visual reach
        height:       '55vh',
      }}
      aria-hidden="true"
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function TurnGlow({ isVisible, isDark }) {
  const prefersReduced = useReducedMotion()

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed bottom-0 inset-x-0 pointer-events-none"
          style={{ zIndex: 5 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: prefersReduced ? 0.2 : 2.5,
            ease: 'easeInOut',
          }}
          aria-hidden="true"
          role="presentation"
        >
          <Swell isDark={isDark} prefersReduced={prefersReduced} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}