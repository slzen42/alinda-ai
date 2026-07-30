/**
 * src/screens/WaitingScreen.jsx
 *
 * The Liminal Space — the holding environment between intake and session.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Waiting for your partner..." is the most anxiety-inducing copy we could
 * display. The anxious mind fills silence with worst-case stories:
 * "Are they writing a novel about me?" "Have they changed their mind?"
 *
 * This screen does not acknowledge the wait at all. It provides a complete
 * sensory environment — breathing rhythm, rotating poetry, nature colours —
 * that interrupts the anxious loop by giving the nervous system something
 * else to entrain to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BREATHING PULSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 0.1Hz (10-second cycle): 4 seconds expanding, 6 seconds contracting.
 * This asymmetric cycle matches the clinical "parasympathetic breath" —
 * the exhale is longer than the inhale, activating the vagus nerve.
 * By watching a visual object breathe at this rate, the user's own
 * breath rate tends to synchronise unconsciously (neural entrainment).
 *
 * The pulse is fixed at 120px maximum diameter — human heart scale.
 * On a 27" monitor, the vast negative space around it is intentional.
 * Emptiness on this screen is not a design gap; it is the design.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NATURE OVERLAY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Rather than the blob-like circular washes of the clinical paintings,
 * this screen uses a CSS radial gradient overlay — two large soft wells
 * of teal and sage that bleed into each other, creating the impression
 * of light through water or forest canopy. The canvas particle layer
 * (in canvasWaiting state) provides fine texture underneath.
 *
 * The overlay responds to the active theme:
 *   Olympian (light): aqua, sage, pale gold — dappled midday light
 *   Titan (dark):     deep teal, forest green, dark water — evening river
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POETRY ROTATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each phrase holds for 12 seconds, crossfades over 3 seconds.
 * Cormorant Garamond italic — a whisper, not an instruction.
 * None of the phrases mention waiting, partners, or time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXIT — THE SEAMLESS HANDOFF
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When both partners complete intake, the backend FSM transitions mode
 * to 'guided'. The sessionStore detects this (via WebSocket or polling).
 * App.jsx's state-driven router unmounts WaitingScreen and mounts
 * ChatScreen. The page transition variant in App.jsx handles the
 * dissolve — no navigation code needed here.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

import { useThemeStore }    from 'store/themeStore'
import { useThemeToggle }   from 'hooks/useTheme'
import { useSessionStore }  from 'store/sessionStore'


// ─────────────────────────────────────────────────────────────────────────────
// POETRY
// ─────────────────────────────────────────────────────────────────────────────

const POETRY = [
  'Water shapes itself to the stone.',
  'The canopy catches the light.',
  'Nothing is required of you right now.',
  'Let the moment arrive on its own terms.',
  'The tide comes in without effort.',
  'Breathing in the quiet.',
  'The branches sway, and the roots hold.',
  'What is here now is enough.',
  'Rest in the space between thoughts.',
  'The river does not rush to reach the sea.',
  'This room holds you both.',
  'One breath at a time.',
]

// Display: 12s | Crossfade: 3s | Timer fires at: 12s
const POEM_DISPLAY_MS   = 12_000
const POEM_CROSSFADE_MS = 3_000


// ─────────────────────────────────────────────────────────────────────────────
// BREATHING RING
//
// Three concentric rings that expand and contract together.
// The outer ring trails the inner two by a fraction, creating a
// gentle ripple effect — like surface tension on still water.
// ─────────────────────────────────────────────────────────────────────────────

const RINGS = [
  { diameter: 120, borderWidth: 1.0, baseOpacity: 0.22, delay: 0.15 },
  { diameter: 78,  borderWidth: 1.5, baseOpacity: 0.40, delay: 0.08 },
  { diameter: 40,  borderWidth: 2.0, baseOpacity: 0.65, delay: 0.00 },
]

function BreathingRings({ color, prefersReduced }) {
  if (prefersReduced) {
    // Static rings — no motion
    return (
      <div className="relative flex items-center justify-center" style={{ width: 128, height: 128 }}>
        {RINGS.map((ring, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width:       ring.diameter,
              height:      ring.diameter,
              border:      `${ring.borderWidth}px solid ${color}`,
              opacity:     ring.baseOpacity,
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 128, height: 128 }}
      aria-hidden="true"
    >
      {RINGS.map((ring, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width:       ring.diameter,
            height:      ring.diameter,
            border:      `${ring.borderWidth}px solid ${color}`,
            // Soft glow — stronger on inner rings
            boxShadow:   `0 0 ${12 + (2 - i) * 8}px 0 ${color}${Math.round(ring.baseOpacity * 40).toString(16).padStart(2,'0')}`,
          }}
          animate={{
            scale:   [1, 1.32, 1],
            opacity: [ring.baseOpacity, ring.baseOpacity * 1.5, ring.baseOpacity],
          }}
          transition={{
            // The 10s cycle: times[0→1] = 4s inhale, times[1→2] = 6s exhale
            times:      [0, 0.4, 1],
            duration:   10,
            ease:       'easeInOut',
            repeat:     Infinity,
            delay:      ring.delay,
          }}
        />
      ))}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// POETRY DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

function PoetryLine({ prefersReduced }) {
  const [index,   setIndex]   = useState(0)
  const [visible, setVisible] = useState(true)
  const timerRef              = useRef(null)

  // Advance to next poem after POEM_DISPLAY_MS
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setIndex(prev => (prev + 1) % POETRY.length)
    }, POEM_DISPLAY_MS)
    return () => clearTimeout(timerRef.current)
  }, [index])

  const fadeDuration = prefersReduced ? 0.1 : POEM_CROSSFADE_MS / 1000

  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: '2rem' }}
      aria-live="polite"
      aria-label="A calm thought while you wait"
    >
      <AnimatePresence mode="sync">
        <motion.p
          key={index}
          className="
            font-serif italic
            text-base sm:text-lg
            text-text-muted
            tracking-wide text-center
            select-none pointer-events-none
          "
          initial={{ opacity: 0 }}
          animate={{ opacity: 1,  transition: { duration: fadeDuration } }}
          exit={{ opacity: 0,     transition: { duration: fadeDuration } }}
        >
          {POETRY[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// NATURE OVERLAY
//
// Two large soft wells of colour layered with CSS radial gradients.
// These are much larger than the canvas wash circles — they cover the
// full screen and blend into each other, eliminating the "blob" look.
//
// Sits between the canvas (z:-1) and the UI elements (z:10).
// ─────────────────────────────────────────────────────────────────────────────

function NatureOverlay({ isDark }) {
  const gradient = isDark
    ? [
        'radial-gradient(ellipse 80% 70% at 15% 40%,  rgba(30,75,95,0.45)  0%, transparent 65%)',
        'radial-gradient(ellipse 70% 80% at 85% 60%,  rgba(45,90,80,0.35)  0%, transparent 60%)',
        'radial-gradient(ellipse 100% 50% at 50% 95%, rgba(20,50,65,0.40)  0%, transparent 70%)',
        'radial-gradient(ellipse 60% 60% at 70% 15%,  rgba(155,140,80,0.08) 0%, transparent 55%)',
      ].join(', ')
    : [
        'radial-gradient(ellipse 80% 70% at 15% 40%,  rgba(80,155,175,0.28)  0%, transparent 65%)',
        'radial-gradient(ellipse 70% 80% at 85% 60%,  rgba(100,160,140,0.22)  0%, transparent 60%)',
        'radial-gradient(ellipse 100% 50% at 50% 95%, rgba(60,120,145,0.20)  0%, transparent 70%)',
        'radial-gradient(ellipse 60% 60% at 70% 15%,  rgba(210,195,130,0.12) 0%, transparent 55%)',
      ].join(', ')

  return (
    <motion.div
      className="fixed inset-0 pointer-events-none"
      style={{
        background:  gradient,
        zIndex:      1,
        mixBlendMode: isDark ? 'screen' : 'multiply',
        opacity:      0.9,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.9 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 2.5, ease: 'easeInOut' }}
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SUBTLE BREATHE INSTRUCTION (optional, appears after 8s)
//
// After the user has been waiting for 8 seconds, a very soft instruction
// appears above the rings. It fades in gently and doesn't demand attention.
// ─────────────────────────────────────────────────────────────────────────────

function BreathingGuide({ prefersReduced }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 8000)
    return () => clearTimeout(timer)
  }, [])

  if (prefersReduced) return null

  return (
    <AnimatePresence>
      {show && (
        <motion.p
          className="
            font-sans text-[11px] text-text-muted/50
            tracking-[0.18em] uppercase text-center
            select-none pointer-events-none
          "
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 2, ease: 'easeInOut' }}
        >
          breathe with the light
        </motion.p>
      )}
    </AnimatePresence>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// THEME TOGGLE (minimal — corner placement)
// ─────────────────────────────────────────────────────────────────────────────

function MinimalThemeToggle() {
  const { isDark, toggleMode } = useThemeToggle()
  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="
        no-tap-flash
        w-9 h-9 flex items-center justify-center
        rounded-full
        bg-surface-raised/40 backdrop-blur-sm
        border border-surface-edge/40
        text-text-muted/60 hover:text-text-muted
        transition-all duration-500
        outline-none focus-visible:ring-2 focus-visible:ring-bronze/40
      "
    >
      {isDark ? (
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
          <line x1="9" y1="1.5" x2="9" y2="3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="9" y1="15" x2="9" y2="16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="1.5" y1="9" x2="3" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="15" y1="9" x2="16.5" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M13 9.5A6 6 0 0 1 6.5 3a6.003 6.003 0 0 0 7 7z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function WaitingScreen() {
  const prefersReduced = useReducedMotion()
  const resolvedMode   = useThemeStore(s => s.resolvedMode)
  const isDark         = resolvedMode === 'dark'
  const myRole         = useSessionStore(s => s.myRole)

  // Ring colour — bronze in Olympian, luminous bronze in Titan
  const ringColor = isDark ? '#8FA88E' : '#7A8C6E'

  return (
    <motion.div
      className="fixed inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: prefersReduced ? 0.15 : 1.8,
        ease: 'easeInOut'
      }}
    >
      {/* ─── NATURE OVERLAY — between canvas and UI ─────────────────── */}
      <NatureOverlay isDark={isDark} />

      {/* ─── THEME TOGGLE — top right, very subtle ──────────────────── */}
      <div className="absolute top-5 right-5 z-20">
        <MinimalThemeToggle />
      </div>

      {/* ─── CENTRAL CONTENT ─────────────────────────────────────────── */}
      <div
        className="
          fixed inset-0 z-10
          flex flex-col items-center justify-center
          gap-10 sm:gap-12
          px-6
          pointer-events-none
        "
      >
        {/* Breathing guide — appears after 8 seconds */}
        <div className="h-5">
          <BreathingGuide prefersReduced={prefersReduced} />
        </div>

        {/* The pulse — three concentric breathing rings */}
        <BreathingRings
          color={ringColor}
          prefersReduced={prefersReduced}
        />

        {/* Poetry — rotating, crossfading phrases */}
        <div className="w-full max-w-xs sm:max-w-sm lg:max-w-md">
          <PoetryLine prefersReduced={prefersReduced} />
        </div>
      </div>

      {/* ─── ACCESSIBILITY ANNOUNCEMENT ──────────────────────────────── */}
      {/* Screen readers get a useful description while sighted users see poetry */}
      <p className="sr-only" role="status">
        Waiting for your partner to complete their intake.
        Take a moment to breathe. The session will begin when they are ready.
      </p>
    </motion.div>
  )
}