/**
 * src/components/progress/SessionProgressBar.jsx
 *
 * The Hourglass — time passing like gravity, not like a countdown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN RATIONALE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Countdown clocks induce scarcity anxiety — they make every passing
 * second feel like a loss. The hourglass inverts this psychology: it shows
 * accumulation in the lower chamber, not depletion. Time is gathering,
 * not draining. The session is building, not ending.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOURGLASS GEOMETRY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An SVG wireframe hourglass: 14px wide × 22px tall.
 * Deliberately tiny — the size of a watch indicator, not a dashboard element.
 * The geometry is precise: two triangles meeting at a 1px waist.
 *
 * Upper chamber: fills from the TOP downward as the session progresses
 *   (sand draining out) — depicted by a clipping rectangle shrinking.
 * Lower chamber: fills from the BOTTOM upward as the session progresses
 *   (sand accumulating) — depicted by a clipping rectangle growing.
 *
 * The fill colour is a warm bronze at low opacity.
 * The wireframe itself is surface-edge — barely visible, like a hairline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ZERO-RENDER ANIMATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The fill levels update every animation frame via a RAF loop that reads
 * `progressRef.current` from `useSessionTimer`. It writes directly to the
 * SVG `<rect>` elements via imperative DOM refs — no React state, no
 * re-renders. 60fps smooth on any device.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TIME TOOLTIP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Hovering or tapping the hourglass reveals a frosted pill sliding
 * downward from below the hourglass. It shows remaining time in DM Sans.
 * It disappears when focus leaves. On mobile, a tap toggles it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FINAL TEN MINUTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When fewer than 10 minutes remain, the bronze fill shifts to a warmer,
 * slightly more saturated terracotta. This is perceptible peripherally
 * without demanding conscious attention. No label. No alert. Just a
 * colour shift — the room warming as the session approaches its close.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POSITIONING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Fixed, top-right corner. 16px from top, 16px from right on mobile.
 * 20px from top, 20px from right on desktop.
 * z-index: 50 — atmosphere layer, above all UI chrome.
 *
 * The StagePill and AlindaPresencePulse occupy the top-center.
 * This component occupies the top-right. No overlap on any screen size.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

import { useSessionTimer }  from 'hooks/useSessionTimer'
import { useThemeStore }    from 'store/themeStore'


// ─────────────────────────────────────────────────────────────────────────────
// HOURGLASS SVG GEOMETRY
// ─────────────────────────────────────────────────────────────────────────────

// All coordinates in SVG viewBox units (viewBox="0 0 14 22")
const W     = 14    // total width
const H     = 22    // total height
const NECK  = 1     // waist width
const MID_Y = H / 2 // y-coordinate of the waist

// Upper triangle: corners at (0,0), (W,0), (NECK/2, MID_Y)
// Lower triangle: corners at (NECK/2, MID_Y), (W-NECK/2, MID_Y), (W,H), (0,H)
const UPPER_PATH = `M 0,0 L ${W},0 L ${W/2 + NECK/2},${MID_Y} L ${W/2 - NECK/2},${MID_Y} Z`
const LOWER_PATH = `M ${W/2 - NECK/2},${MID_Y} L ${W/2 + NECK/2},${MID_Y} L ${W},${H} L 0,${H} Z`

// The waist gap — a 1px horizontal line at the neck
const NECK_PATH = `M ${W/2 - NECK/2},${MID_Y} L ${W/2 + NECK/2},${MID_Y}`


// ─────────────────────────────────────────────────────────────────────────────
// COLOUR HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getFillColor(isLastTen, isDark) {
  if (isLastTen) {
    // Warmer terracotta — the room warming as closing approaches
    return isDark
      ? 'rgba(185, 110, 80, 0.72)'
      : 'rgba(175, 95, 65, 0.65)'
  }
  return isDark
    ? 'rgba(142, 158, 122, 0.70)'   // bronze — Titan mode
    : 'rgba(122, 140, 110, 0.60)'   // bronze — Olympian mode
}

function getWireColor(isDark) {
  return isDark
    ? 'rgba(255,255,255,0.14)'
    : 'rgba(0,0,0,0.16)'
}


// ─────────────────────────────────────────────────────────────────────────────
// THE HOURGLASS (imperative DOM animation)
// ─────────────────────────────────────────────────────────────────────────────

function Hourglass({ progressRef, isLastTen, isDark, prefersReduced }) {
  const upperFillRef = useRef(null)  // rect that clips the upper fill
  const lowerFillRef = useRef(null)  // rect that clips the lower fill
  const rafRef       = useRef(null)
  const prevProg     = useRef(-1)

  const fillColor = getFillColor(isLastTen, isDark)
  const wireColor = getWireColor(isDark)

  useEffect(() => {
    if (prefersReduced) {
      // Static — just show current state without RAF
      const prog = progressRef.current ?? 0
      const upperH = MID_Y * (1 - prog)
      const lowerH = MID_Y * prog

      if (upperFillRef.current) {
        upperFillRef.current.setAttribute('height', upperH.toFixed(2))
        upperFillRef.current.setAttribute('y', (MID_Y - upperH).toFixed(2))
      }
      if (lowerFillRef.current) {
        lowerFillRef.current.setAttribute('height', lowerH.toFixed(2))
        lowerFillRef.current.setAttribute('y', (MID_Y + (MID_Y - lowerH)).toFixed(2))
      }
      return
    }

    function frame() {
      rafRef.current = requestAnimationFrame(frame)

      const prog = progressRef.current ?? 0
      if (Math.abs(prog - prevProg.current) < 0.0001) return  // no change
      prevProg.current = prog

      // Upper chamber: shrinks from MID_Y → 0 as session progresses
      const upperH  = MID_Y * (1 - prog)
      const upperY  = MID_Y - upperH   // anchored to the waist

      // Lower chamber: grows from 0 → MID_Y as session progresses
      const lowerH  = MID_Y * prog
      const lowerY  = MID_Y + (MID_Y - lowerH)  // anchored to the waist

      if (upperFillRef.current) {
        upperFillRef.current.setAttribute('height', upperH.toFixed(3))
        upperFillRef.current.setAttribute('y', upperY.toFixed(3))
      }
      if (lowerFillRef.current) {
        lowerFillRef.current.setAttribute('height', lowerH.toFixed(3))
        lowerFillRef.current.setAttribute('y', lowerY.toFixed(3))
      }
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [progressRef, prefersReduced])

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Clip paths constrain fill to the triangular chambers */}
        <clipPath id="upper-clip">
          <path d={UPPER_PATH} />
        </clipPath>
        <clipPath id="lower-clip">
          <path d={LOWER_PATH} />
        </clipPath>
      </defs>

      {/* Upper fill — clipped to upper triangle */}
      <g clipPath="url(#upper-clip)">
        <rect
          ref={upperFillRef}
          x={0}
          y={MID_Y}
          width={W}
          height={0}
          fill={fillColor}
          style={{ transition: prefersReduced ? 'none' : undefined }}
        />
      </g>

      {/* Lower fill — clipped to lower triangle */}
      <g clipPath="url(#lower-clip)">
        <rect
          ref={lowerFillRef}
          x={0}
          y={H}
          width={W}
          height={0}
          fill={fillColor}
        />
      </g>

      {/* Wireframe — drawn last so it sits over the fill */}
      <path d={UPPER_PATH} stroke={wireColor} strokeWidth="0.8" />
      <path d={LOWER_PATH} stroke={wireColor} strokeWidth="0.8" />
    </svg>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// TIME TOOLTIP PILL
// ─────────────────────────────────────────────────────────────────────────────

function TimePill({ remainingDisplay, elapsedDisplay }) {
  return (
    <motion.div
      className="
        absolute top-full mt-2 right-0
        bg-surface-overlay/90
        backdrop-blur-md
        border border-surface-edge/60
        rounded-xl
        px-3 py-2
        whitespace-nowrap
        shadow-ambient
        pointer-events-none
      "
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: 'tween', ease: [0.20, 0.00, 0.00, 1.00], duration: 0.25 }}
    >
      <p className="text-[12px] font-sans text-text-secondary tracking-wide">
        {remainingDisplay} remaining
      </p>
      <p className="text-[10px] font-sans text-text-muted/60 mt-0.5">
        {elapsedDisplay} elapsed
      </p>
    </motion.div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function SessionProgressBar() {
  const prefersReduced = useReducedMotion()
  const isDark         = useThemeStore(s => s.resolvedMode === 'dark')

  const {
    progressRef,
    remainingDisplay,
    elapsedDisplay,
    isLastTenMinutes,
    isTimeExpired,
    isPaused,
  } = useSessionTimer()

  const [showPill, setShowPill]   = useState(false)
  const tapTimerRef               = useRef(null)
  const isMobileRef               = useRef(typeof window !== 'undefined'
    ? window.matchMedia('(pointer: coarse)').matches
    : false
  )

  const handleMouseEnter = useCallback(() => {
    if (!isMobileRef.current) setShowPill(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (!isMobileRef.current) setShowPill(false)
  }, [])

  const handleTap = useCallback(() => {
    if (!isMobileRef.current) return
    setShowPill(v => !v)
    clearTimeout(tapTimerRef.current)
    tapTimerRef.current = setTimeout(() => setShowPill(false), 4000)
  }, [])

  useEffect(() => () => clearTimeout(tapTimerRef.current), [])

  return (
    <div
      className="
        fixed top-4 right-4
        sm:top-5 sm:right-5
        z-50
        pointer-events-auto
      "
    >
      <div className="relative">
        {/* Touch/hover target — larger than the visual hourglass */}
        <button
          type="button"
          className="
            no-tap-flash
            flex items-center justify-center
            w-9 h-9
            rounded-xl
            outline-none
            focus-visible:ring-2 focus-visible:ring-bronze/40
            focus-visible:ring-offset-1
          "
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleTap}
          aria-label={`Session time: ${remainingDisplay} remaining`}
          aria-live="polite"
        >
          <Hourglass
            progressRef={progressRef}
            isLastTen={isLastTenMinutes}
            isDark={isDark}
            prefersReduced={prefersReduced}
          />

          {/* Paused indicator — tiny dot overlay when session is paused */}
          {isPaused && (
            <motion.div
              className="
                absolute -bottom-0.5 -right-0.5
                w-2.5 h-2.5 rounded-full
                bg-terracotta border-2 border-surface-base
              "
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              aria-label="Paused"
            />
          )}
        </button>

        {/* Time tooltip pill */}
        <AnimatePresence>
          {showPill && !isTimeExpired && (
            <TimePill
              remainingDisplay={remainingDisplay}
              elapsedDisplay={elapsedDisplay}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}