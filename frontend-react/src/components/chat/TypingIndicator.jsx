/**
 * src/components/chat/TypingIndicator.jsx
 *
 * The Flowing Wave — presence modeled as continuous motion.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Standard typing indicators (bouncing dots, spinning circles) communicate
 * computational urgency — "the machine is working." In a therapy session,
 * that urgency is the last thing a waiting user should feel.
 *
 * This indicator communicates something different: patience, continuity,
 * and the specific quality of deliberate thought. The waves flow without
 * beginning or end. They don't rush. They don't stop. They simply continue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WAVE ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three horizontal sine waves, phase-offset by 120° from each other:
 *   Wave 1 (Teal):   phase offset 0°    — the leading wave
 *   Wave 2 (Sage):   phase offset 120°  — the middle wave
 *   Wave 3 (Silver): phase offset 240°  — the trailing wave
 *
 * All three animate their strokeDashoffset simultaneously, creating the
 * illusion that the wave pattern is scrolling horizontally through the
 * SVG viewport. Because the path repeats at exact intervals, the scrolling
 * is perfectly seamless — there is no visible loop point.
 *
 * The animation runs at 0.2Hz (5 seconds per cycle) for the wave scroll.
 * A separate opacity pulse runs at 0.1Hz (10 seconds) — the room's breath —
 * creating a compound rhythm that never settles into a recognisable pattern.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COLOUR PALETTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These colours are drawn from water and flora — the same register as
 * the WaitingScreen nature overlay. They never appear elsewhere in the UI,
 * which gives the typing indicator a unique, immediately-recognisable identity:
 *
 *   Sea-glass Teal:  #6BA3A0  — stillness, depth
 *   Soft Sage:       #7A9B78  — growth, groundedness
 *   Muted Silver:    #9DA5AE  — clarity, neutrality
 *
 * All three at ~60% opacity against surface-overlay background.
 * They read in both Olympian and Titan modes because they are mid-value
 * tones — neither bright enough to clash with light backgrounds nor
 * dark enough to disappear into dark backgrounds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTEXTUAL WHISPER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Below the wave, a single italicised line in Cormorant Garamond:
 *   "Sarah is typing..."
 *   "Alinda is considering..."
 *
 * "Considering" rather than "typing" for Alinda — she is not typing
 * in the way a human types. She is weighing, holding, forming. The word
 * choice communicates this without explanation.
 *
 * The text fades in 800ms after the indicator first appears, so it doesn't
 * flash onto screen simultaneously with the wave. It arrives as an afterthought.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO VISUAL MODES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PARTNER: Left-aligned, same spatial position as the partner's bubbles.
 *   The wave sits in a soft container matching the partner bubble material.
 *
 * ALINDA: Centered, floating, containerless — matching her message style.
 *   The wave is slightly wider. The whisper text is centered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * isVisible:     boolean — controlled by useTypingIndicator's grace-period state
 * isAlinda:      boolean — selects the visual mode and whisper copy
 * partnerName:   string  — used in whisper text for partner mode
 */

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { clsx } from 'clsx'


// ─────────────────────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────────────────────

const WAVE_COLOURS = {
  teal:   '#6BA3A0',
  sage:   '#7A9B78',
  silver: '#9DA5AE',
}

const WAVE_OPACITY = 0.65


// ─────────────────────────────────────────────────────────────────────────────
// SINE WAVE PATH GENERATOR
//
// Generates an SVG path string for a single sine wave that spans the
// full viewport width and repeats once beyond the right edge.
// The extra period ensures there's no visible seam when the path scrolls.
//
// Parameters:
//   width:      the SVG viewBox width (equals the visible container width)
//   amplitude:  how tall the wave is (in viewBox units)
//   period:     how long one full cycle is (in viewBox units)
//   yOffset:    vertical centre of the wave
//   phaseShift: horizontal offset applied to the wave's start point (degrees)
// ─────────────────────────────────────────────────────────────────────────────

function buildSinePath(
  width,
  amplitude,
  period,
  yOffset,
  phaseShift = 0
) {
  // Number of points to sample along the path
  const STEPS   = 120
  const TOTAL_W = width + period   // draw one extra period for seamless scroll

  const points = []
  for (let i = 0; i <= STEPS; i++) {
    const x   = (i / STEPS) * TOTAL_W
    const rad = ((x + phaseShift) / period) * 2 * Math.PI
    const y   = yOffset + amplitude * Math.sin(rad)
    if (i === 0) points.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`)
    else         points.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return points.join(' ')
}


// ─────────────────────────────────────────────────────────────────────────────
// ANIMATED WAVE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single animated sine wave stroke.
 * Scrolls horizontally via strokeDashoffset animation.
 * The path is one period longer than the container — when scrolled by
 * exactly one period, the pattern repeats seamlessly.
 */
function AnimatedWave({
  colour,
  strokeWidth,
  amplitude,
  period,
  phaseShift,
  svgWidth,
  svgHeight,
  scrollDuration,   // how many seconds for one full scroll cycle
  opacity,
  delay,
}) {
  const path = buildSinePath(
    svgWidth,
    amplitude,
    period,
    svgHeight / 2,
    phaseShift,
  )

  return (
    <motion.path
      d={path}
      fill="none"
      stroke={colour}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      // strokeDasharray = period (one full cycle)
      // animating dashoffset from 0 → -period scrolls the pattern left
      // at the rate of scrollDuration seconds per cycle
      strokeDasharray={`${period} ${period}`}
      animate={{
        strokeDashoffset: [0, -period],
      }}
      transition={{
        duration:   scrollDuration,
        repeat:     Infinity,
        ease:       'linear',
        delay,
      }}
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// THE BREATHING PULSE ON THE WHOLE INDICATOR
//
// Separate from the wave scroll — this is the 0.1Hz room-breath.
// Applied to the SVG container's opacity so all three waves breathe together.
// ─────────────────────────────────────────────────────────────────────────────

const breathVariants = {
  breathing: {
    opacity:    [0.7, 1.0, 0.7],
    scale:      [0.99, 1.01, 0.99],
    transition: {
      times:    [0, 0.4, 1],
      duration: 10,
      repeat:   Infinity,
      ease:     'easeInOut',
    },
  },
  static: {
    opacity: 0.85,
    scale:   1,
  },
}


// ─────────────────────────────────────────────────────────────────────────────
// REDUCED MOTION VERSION
//
// Three static horizontal lines with gentle opacity pulse — no path animation.
// The lines still breathe at 0.1Hz, maintaining the room's rhythm.
// ─────────────────────────────────────────────────────────────────────────────

function ReducedMotionIndicator({ isAlinda }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {[WAVE_COLOURS.teal, WAVE_COLOURS.sage, WAVE_COLOURS.silver].map((col, i) => (
        <motion.div
          key={i}
          className="h-0.5 rounded-full"
          style={{
            backgroundColor: col,
            width: isAlinda ? 32 : 24,
          }}
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{
            duration: 10,
            repeat:   Infinity,
            ease:     'easeInOut',
            delay:    i * 0.5,
          }}
        />
      ))}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// WHISPER TEXT
//
// Fades in 800ms after the indicator appears.
// Never appears immediately — the deliberate delay communicates unhurried thought.
// ─────────────────────────────────────────────────────────────────────────────

function WhisperText({ text, isAlinda }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 800)
    return () => clearTimeout(timer)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.p
          className={clsx(
            'font-serif italic text-[13px]',
            'text-text-muted/70',
            'tracking-[0.03em]',
            'leading-none',
            'select-none pointer-events-none',
            isAlinda ? 'text-center' : 'text-left',
          )}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          {text}
        </motion.p>
      )}
    </AnimatePresence>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// WAVE CANVAS
//
// The SVG that holds all three animated wave paths.
// Width is responsive — reads from its container via a ResizeObserver.
// ─────────────────────────────────────────────────────────────────────────────

const SVG_HEIGHT    = 28   // viewBox height in SVG units
const WAVE_AMPLITUDE = 6    // peak-to-trough in SVG units
const WAVE_PERIOD    = 60   // one cycle in SVG units

// Three waves, each scrolling at slightly different rates to prevent
// exact phase alignment — the visual result is a constantly-shifting
// braid rather than a rigid pattern.
const WAVE_CONFIG = [
  { colour: WAVE_COLOURS.teal,   strokeWidth: 1.2, phaseShift: 0,    rate: 5.0, delay: 0,    opacity: WAVE_OPACITY },
  { colour: WAVE_COLOURS.sage,   strokeWidth: 1.0, phaseShift: 20,   rate: 5.8, delay: 0,    opacity: WAVE_OPACITY * 0.85 },
  { colour: WAVE_COLOURS.silver, strokeWidth: 0.8, phaseShift: 40,   rate: 6.6, delay: 0,    opacity: WAVE_OPACITY * 0.70 },
]

function WaveCanvas({ width, prefersReduced }) {
  if (!width) return null

  if (prefersReduced) {
    return (
      <div className="flex items-center justify-center" style={{ height: SVG_HEIGHT }}>
        <ReducedMotionIndicator isAlinda={false} />
      </div>
    )
  }

  return (
    <svg
      width={width}
      height={SVG_HEIGHT}
      viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
      className="overflow-hidden"
      aria-hidden="true"
    >
      {WAVE_CONFIG.map((cfg, i) => (
        <AnimatedWave
          key={i}
          colour={cfg.colour}
          strokeWidth={cfg.strokeWidth}
          amplitude={WAVE_AMPLITUDE}
          period={WAVE_PERIOD}
          phaseShift={cfg.phaseShift}
          svgWidth={width}
          svgHeight={SVG_HEIGHT}
          scrollDuration={cfg.rate}
          opacity={cfg.opacity}
          delay={cfg.delay}
        />
      ))}
    </svg>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// PARTNER TYPING INDICATOR
// Left-aligned, sits where partner bubbles sit
// ─────────────────────────────────────────────────────────────────────────────

function PartnerIndicator({ partnerName, prefersReduced, containerRef, width }) {
  const whisperText = `${partnerName} is typing\u2026`

  return (
    <div className="flex flex-col items-start gap-1.5 ml-1">
      {/* Container — matches partner bubble material */}
      <motion.div
        className="
          relative overflow-hidden
          bg-surface-raised
          border border-surface-edge
          rounded-[12px] rounded-bl-[3px]
          shadow-ambient
          px-4 py-3
        "
        variants={breathVariants}
        animate={prefersReduced ? 'static' : 'breathing'}
        style={{ width: width ? Math.min(width, 120) : 96 }}
        ref={containerRef}
      >
        <WaveCanvas
          width={width ? Math.min(width, 88) : 64}
          prefersReduced={prefersReduced}
        />
      </motion.div>

      {/* Whisper text below the bubble */}
      <WhisperText text={whisperText} isAlinda={false} />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// ALINDA TYPING INDICATOR
// Centered, floating, containerless — matching her message register
// ─────────────────────────────────────────────────────────────────────────────

function AlindaIndicator({ prefersReduced, containerRef, width }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6">
      {/* The name label */}
      <p className="
        text-[11px] font-sans text-bronze/60
        tracking-[0.14em] uppercase select-none
      ">
        Alinda
      </p>

      {/* The wave — no container, floating directly over the canvas */}
      <motion.div
        className="relative"
        variants={breathVariants}
        animate={prefersReduced ? 'static' : 'breathing'}
        ref={containerRef}
      >
        {/* Glow behind the wave — same as AlindaBubble's glow */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 120% 300% at 50% 50%, rgba(122,140,110,0.15) 0%, transparent 70%)',
            transform: 'scaleY(3)',
          }}
        />

        <WaveCanvas
          width={width ?? 140}
          prefersReduced={prefersReduced}
        />
      </motion.div>

      {/* Whisper — "considering" not "typing" for Alinda */}
      <WhisperText
        text="Alinda is considering\u2026"
        isAlinda
      />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function TypingIndicator({
  isVisible    = false,
  isAlinda     = false,
  partnerName  = 'Your partner',
}) {
  const prefersReduced = useReducedMotion()
  const containerRef   = useRef(null)
  const [width, setWidth] = useState(isAlinda ? 140 : 96)

  // Measure the container so wave fills the exact available space
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width)
        if (w > 0) setWidth(isAlinda ? Math.min(w, 160) : Math.min(w, 120))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isAlinda])

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className={clsx(
            'py-1',
            isAlinda ? 'flex justify-center' : 'flex justify-start',
          )}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{
            duration: prefersReduced ? 0.1 : 0.45,
            ease: [0.20, 0.00, 0.00, 1.00],
          }}
          aria-live="polite"
          aria-label={
            isAlinda
              ? 'Alinda is composing a response'
              : `${partnerName} is typing`
          }
        >
          {isAlinda ? (
            <AlindaIndicator
              prefersReduced={prefersReduced}
              containerRef={containerRef}
              width={width}
            />
          ) : (
            <PartnerIndicator
              partnerName={partnerName}
              prefersReduced={prefersReduced}
              containerRef={containerRef}
              width={width}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}