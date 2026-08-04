/**
 * src/components/chat/StagePill.jsx
 *
 * The Silent Compass — a phase indicator that earns its silence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROGRESSIVE MINIMIZATION PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Therapy is easily derailed by UI clutter. A persistent stage label
 * ("DEEPENING PHASE") demands cognitive attention at the exact moment
 * the user needs all their cognition for the conversation.
 *
 * The StagePill solves this by defaulting to near-invisibility:
 *   1. A new stage arrives → pill drops from top, fully expanded, text visible
 *   2. After 5 seconds → text fades, pill collapses to a 6px dot
 *   3. At rest → a tiny frosted point, barely registered consciously
 *   4. User is disoriented → tap/hover → pill expands back, text returns
 *   5. User releases → pill re-starts the 5-second collapse timer
 *
 * The stage information is always available. It is never forced on anyone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPATIAL POSITIONING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The pill sits at the top-center of the screen, below AlindaPresencePulse:
 *
 *   [Zenith dot]              ← AlindaPresencePulse (14px from top, 8px)
 *   [Stage pill / micro dot]  ← StagePill (30px from top when collapsed)
 *
 * When collapsed, the 6px dot sits 6px below the 8px pulse dot —
 * 14px gaps. Together they form a minimal vertical composition at the
 * ceiling of the room: two points, different sizes, same axis.
 *
 * When expanded, the pill descends slightly (to 28px from top) so it
 * doesn't crowd the pulse dot. The expansion is animated via layout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STAGE VOCABULARY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Stage labels are deliberately spare. No explanatory text. No progress
 * percentage. Just the name of where the room currently is:
 *
 *   guided      → "Guided"
 *   free_chat   → "Free conversation"
 *   cooldown    → "Cooling down"
 *   wrapping_up → "Wrapping up"
 *
 * "Free conversation" rather than "FREE CHAT" — all-caps tracking feels
 * clinical; mixed case feels like human speech. This is consistent with
 * Alinda's voice throughout the application.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COLLAPSE TIMING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EXPAND  → immediate on hover/tap
 * COLLAPSE → 5 seconds after:
 *   a) initial mount
 *   b) mouse leaves / tap ends (with 800ms grace period before timer starts)
 *
 * The 800ms grace prevents accidental collapse when the user quickly
 * moves their cursor from the pill to something nearby.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FROSTED MATERIAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The pill uses the same frosted overlay material as the card components:
 * bg-surface-overlay with backdrop-blur. When collapsed to 6px, the blur
 * renders as a tiny frosted glass sphere — distinct from the bronze metallic
 * pulse dot above it. One is light; one is glass.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * mode:        string — the current FSM mode (maps to display label)
 * isVisible:   boolean — false before session starts and after session ends
 */

import React, {
    useState,
    useEffect,
    useRef,
    useCallback,
  } from 'react'
  import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
  import { clsx } from 'clsx'



  // Add after the existing clsx import:
  import { useSessionStore } from 'store/sessionStore'
  import { useThemeStore }   from 'store/themeStore'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE LABEL MAP
  // ─────────────────────────────────────────────────────────────────────────────
  
  const STAGE_LABELS = {
    guided:      'Guided',
    free_chat:   'Free conversation',
    cooldown:    'Cooling down',
    wrapping_up: 'Wrapping up',
    paused:      'Paused',
    crisis_pause: 'Taking a moment',
  }
  
  function getStageLabel(mode) {
    return STAGE_LABELS[mode] ?? null
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TIMING CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const EXPANDED_HOLD_MS  = 5000   // how long the pill stays open on new stage
  const HOVER_GRACE_MS    = 800    // delay before collapse timer after mouse-leave
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE ARC GEOMETRY (for the collapsed dot ring)
  // ─────────────────────────────────────────────────────────────────────────────

  const PILL_ARC_SIZE   = 18       // SVG viewBox size for the collapsed-dot arc
  const PILL_CENTER     = 9        // cx, cy
  const PILL_RADIUS     = 6.5      // arc radius — tighter than standalone indicator
  const PILL_CIRC       = 2 * Math.PI * PILL_RADIUS   // ≈ 40.84
  const PILL_TRACK_W    = 0.8      // track stroke width
  const PILL_ARC_W      = 1.2      // drawn arc stroke width

  const PHASE_PROGRESS_MAP = Object.freeze({
    opening:     0.10,
    exploration: 0.32,
    deepening:   0.56,
    resolution:  0.76,
    closing:     0.92,
    closed:      1.00,
  })

  function resolvePhaseProgress(phase) {
    return PHASE_PROGRESS_MAP[phase] ?? PHASE_PROGRESS_MAP.opening
  }

  function phaseToOffset(progress) {
    return PILL_CIRC * (1 - Math.max(0, Math.min(1, progress)))
  }

  function getArcColor(isDark) {
    // Cooler sage-bronze — sibling to AlindaPresencePulse, not identical
    return isDark
      ? 'rgba(148, 168, 138, 0.85)'
      : 'rgba(112, 130, 100, 0.80)'
  }

  function getTrackColor(isDark) {
    return isDark
      ? 'rgba(255,255,255,0.09)'
      : 'rgba(0,0,0,0.11)'
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // THE MICRO DOT (collapsed state)
  //
  // 6px frosted glass sphere — distinct from the 8px bronze pulse dot above.
  // Taps/clicks expand the pill.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function MicroDot({ onExpand, phase, isDark, prefersReduced }) {
    const progress     = resolvePhaseProgress(phase)
    const targetOffset = phaseToOffset(progress)
    const arcColor     = getArcColor(isDark)
    const trackColor   = getTrackColor(isDark)
  
    return (
      <motion.button
        type="button"
        onClick={onExpand}
        className="
          no-tap-flash
          flex items-center justify-center
          outline-none
          focus-visible:ring-2 focus-visible:ring-bronze/60
          focus-visible:ring-offset-2 focus-visible:ring-offset-transparent
        "
        aria-label="Show current session phase and stage"
        whileHover={{ scale: 1.35 }}
        whileTap={{ scale: 0.88 }}
        transition={{ type: 'tween', ease: [0.20, 0.00, 0.00, 1.00], duration: 0.2 }}
      >
        {/*
          The SVG contains both the phase arc ring AND the frosted dot center.
          The arc rotates -90° so it starts from 12 o'clock.
          The dot sits at the SVG center as a foreignObject isn't needed —
          a filled circle with the right color is sufficient at this size.
        */}
        <svg
          width={PILL_ARC_SIZE}
          height={PILL_ARC_SIZE}
          viewBox={`0 0 ${PILL_ARC_SIZE} ${PILL_ARC_SIZE}`}
          aria-hidden="true"
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Track — full circle, hairline */}
          <circle
            cx={PILL_CENTER}
            cy={PILL_CENTER}
            r={PILL_RADIUS}
            fill="none"
            stroke={trackColor}
            strokeWidth={PILL_TRACK_W}
          />
  
          {/* Phase arc — animates on phase change */}
          <motion.circle
            cx={PILL_CENTER}
            cy={PILL_CENTER}
            r={PILL_RADIUS}
            fill="none"
            stroke={arcColor}
            strokeWidth={PILL_ARC_W}
            strokeLinecap="round"
            strokeDasharray={PILL_CIRC}
            animate={{ strokeDashoffset: targetOffset }}
            initial={{ strokeDashoffset: PILL_CIRC }}
            transition={prefersReduced
              ? { duration: 0 }
              : {
                  type:     'tween',
                  ease:     [0.25, 0.10, 0.10, 1.00],
                  duration: 1.2,
                }
            }
          />
  
          {/*
            The center dot — the original 6px frosted glass sphere,
            approximated as a filled circle.
            Using rgba with slight transparency so the canvas breathes through it.
            In Titan (dark): near-white frosted.
            In Olympian (light): near-black frosted.
          */}
          <circle
            cx={PILL_CENTER}
            cy={PILL_CENTER}
            r={2.8}
            fill={isDark
              ? 'rgba(210, 210, 205, 0.72)'
              : 'rgba(38, 36, 33, 0.65)'
            }
            style={{
              // Counteract the -90° SVG rotation so the dot stays circular
              // (it already is a circle so this has no visual effect,
              // but if a drop-shadow filter is ever added, this prevents skew)
              transformOrigin: `${PILL_CENTER}px ${PILL_CENTER}px`,
              transform: 'rotate(90deg)',
            }}
          />
        </svg>
      </motion.button>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // THE EXPANDED PILL
  // ─────────────────────────────────────────────────────────────────────────────
  
  function ExpandedPill({ label, onCollapse, onMouseEnter, onMouseLeave }) {
    return (
      <motion.button
        type="button"
        onClick={onCollapse}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="
          no-tap-flash
          inline-flex items-center gap-2
          px-4 py-2
          bg-surface-overlay/85
          backdrop-blur-md
          border border-surface-edge/60
          rounded-full
          outline-none
          focus-visible:ring-2 focus-visible:ring-bronze/60
          hover:bg-surface-overlay hover:border-surface-edge
          transition-colors duration-300
        "
        layout
        aria-label={`Current phase: ${label}. Tap to dismiss.`}
        aria-live="polite"
      >
        {/* Status dot */}
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-bronze flex-shrink-0"
          animate={{ opacity: [0.5, 1.0, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
  
        {/* Label */}
        <span className="
          font-sans text-[12px] text-text-secondary
          tracking-[0.08em]
          whitespace-nowrap
          select-none
        ">
          {label}
        </span>
      </motion.button>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN COMPONENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  export default function StagePill({ mode, isVisible, phase }) {
    const prefersReduced    = useReducedMotion()
    const isDark = useThemeStore(s => s.resolvedMode === 'dark')
  
    const [isExpanded, setIsExpanded] = useState(true)
    const [prevMode,   setPrevMode]   = useState(mode)
  
    const collapseTimerRef = useRef(null)
    const graceTimerRef    = useRef(null)
  
    const label = getStageLabel(mode)
  
    // ── When mode changes, expand and start the collapse timer ───────────────
    useEffect(() => {
      if (mode !== prevMode && mode) {
        setPrevMode(mode)
        setIsExpanded(true)
        scheduleCollapse()
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode])
  
    // ── Initial mount: start collapse timer ───────────────────────────────────
    useEffect(() => {
      if (!isVisible) return
      scheduleCollapse()
      return () => {
        clearTimeout(collapseTimerRef.current)
        clearTimeout(graceTimerRef.current)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible])
  
    const scheduleCollapse = useCallback(() => {
      clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = setTimeout(() => {
        setIsExpanded(false)
      }, EXPANDED_HOLD_MS)
    }, [])
  
    const handleExpand = useCallback(() => {
      clearTimeout(collapseTimerRef.current)
      clearTimeout(graceTimerRef.current)
      setIsExpanded(true)
    }, [])
  
    const handleCollapse = useCallback(() => {
      setIsExpanded(false)
    }, [])
  
    const handleMouseEnter = useCallback(() => {
      // Cancel pending collapse while hovering
      clearTimeout(collapseTimerRef.current)
      clearTimeout(graceTimerRef.current)
    }, [])
  
    const handleMouseLeave = useCallback(() => {
      // Grace period before restarting collapse timer
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = setTimeout(() => {
        scheduleCollapse()
      }, HOVER_GRACE_MS)
    }, [scheduleCollapse])
  
    // Don't render if no label or not visible
    if (!isVisible || !label) return null
  
    // The top offset changes slightly between collapsed/expanded
    // to prevent the pill from overlapping the pulse dot
    const topOffset = isExpanded ? 30 : 30   // same in both states — it's below pulse
  
    return (
      <div
        className="
          fixed left-1/2 -translate-x-1/2
          flex items-center justify-center
          pointer-events-auto
        "
        style={{ top: topOffset, zIndex: 15 }}
      >
        <AnimatePresence mode="wait">
          {isExpanded ? (
            <motion.div
              key="expanded"
              initial={prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, y: -12, scale: 0.9 }
              }
              animate={prefersReduced
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1 }
              }
              exit={prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.85, transition: { duration: 0.25 } }
              }
              transition={{
                type:     'tween',
                ease:     [0.20, 0.00, 0.00, 1.00],
                duration: prefersReduced ? 0.15 : 0.45,
              }}
            >
              <ExpandedPill
                label={label}
                onCollapse={handleCollapse}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.5 }
              }
              animate={prefersReduced
                ? { opacity: 1 }
                : { opacity: 1, scale: 1 }
              }
              exit={prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.5, transition: { duration: 0.2 } }
              }
              transition={{
                type:     'tween',
                ease:     [0.20, 0.00, 0.00, 1.00],
                duration: prefersReduced ? 0.15 : 0.35,
              }}
            >
                
                <MicroDot
                  onExpand={handleExpand}
                  phase={phase}
                  isDark={isDark}
                  prefersReduced={prefersReduced}
                />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )

  }