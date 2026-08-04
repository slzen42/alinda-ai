/**
 * src/screens/ChatScreen.jsx
 *
 * The Room — where all components converge into a single lived experience.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE Z-AXIS STACK (The Physical Room)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  z:-1   LivingCanvas      — the painting (managed by App.jsx)
 *  z:5    TurnIndicator     — human side-wash, illuminates the canvas
 *  z:5    TurnGlow          — Alinda's tidal floor swell
 *  z:10   Message timeline  — the carved stone messages on the floor
 *  z:10   StagePill         — top-center, frosted capsule with phase arc
 *  z:10   SessionProgressBar — top-right, hourglass
 *  z:15   AlindaPresencePulse — zenith dot, above StagePill
 *  z:20   MessageInput      — floating vellum, bottom of screen
 *  z:25   ScrollChevron     — scroll-to-bottom, above the input
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MESSAGE TIMELINE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The scroll container is `fixed inset-0 overflow-y-auto`. This sidesteps
 * the entire class of mobile Safari bugs where sticky children of overflow
 * containers behave unpredictably. MessageInput is separately fixed at bottom.
 *
 * Top padding (pt-32 sm:pt-36): creates the "top void" — the ceiling
 *   constellation (StagePill, Pulse, Hourglass) always floats in empty air,
 *   never overlapping a message. On desktop the added top breathing room (pt-36)
 *   accounts for the wider viewport making the ceiling feel taller.
 *
 * Bottom padding (pb-40 sm:pb-44): creates the "bottom void" — the newest
 *   message rests comfortably above the MessageInput, not trapped under it.
 *   Additional dynamic padding via CSS custom property `--keyboard-inset`
 *   ensures the scroll container adjusts when the virtual keyboard opens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCROLL AGENCY — TRAUMA-INFORMED AUTO-SCROLL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Auto-scroll is ACTIVE by default: every new message smoothly scrolls
 * to the bottom.
 *
 * Auto-scroll LOCKS when: the user manually scrolls more than 150px above
 * the bottom. This threshold is intentionally generous — a small accidental
 * swipe doesn't lock; a deliberate read-scroll does.
 *
 * While locked: a floating chevron appears above the MessageInput showing
 * a count badge of messages received since the user scrolled up. The user
 * can tap it to unlock and return to the bottom.
 *
 * Auto-scroll UNLOCKS when: the user taps the scroll chevron, OR when they
 * manually scroll back to the bottom (within 80px of the bottom).
 *
 * The clinical intent: we never violently yank the screen from a user who
 * is re-reading previous context. Their concentration is not interrupted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MESSAGE GROUPING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ChatScreen processes the raw message array into grouped display data
 * before rendering. Each processed item has:
 *
 *   isFirstInGroup:     boolean — show sender name label
 *   isLastInGroup:      boolean — apply bottom group margin
 *   showDateSeparator:  boolean — inject a DateSeparator before this message
 *   dateSeparatorLabel: string  — "Today", "Yesterday", "July 23", etc.
 *
 * A new group begins when:
 *   a) The sender changes from the previous message
 *   b) The sender is the same, but >5 minutes have elapsed
 *   c) The message is a system message (always its own group)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESKTOP LAYOUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * On desktop (lg: breakpoint, 1024px+), the message timeline is centered
 * in a max-width column (max-w-2xl) rather than filling the full viewport.
 * This prevents Alinda's centered text and the human bubbles from drifting
 * to extreme edges of a 27" monitor. The column is left/right padded
 * with empty canvas space — the room breathes on both sides.
 *
 * The ceiling elements (StagePill, Hourglass, Pulse) remain full-viewport-
 * anchored. They float above the column, not constrained by it.
 */

import React, {
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
    lazy,
    Suspense,
  } from 'react'
  import {
    motion,
    AnimatePresence,
    useReducedMotion,
  } from 'framer-motion'
  import { clsx } from 'clsx'
  
  // Components — all built
  import MessageBubble, { DateSeparator } from 'components/chat/MessageBubble'
  import TypingIndicator                  from 'components/chat/TypingIndicator'
  import TurnIndicator                    from 'components/chat/TurnIndicator'
  import TurnGlow                         from 'components/chat/TurnGlow'
  import AlindaPresencePulse              from 'components/chat/AlindaPresencePulse'
  import StagePill                        from 'components/chat/StagePill'
  import MessageInput                     from 'components/chat/MessageInput'
  import SessionProgressBar               from 'components/progress/SessionProgressBar'
  
  // Hooks and stores
  import { useSessionStore }    from 'store/sessionStore'
  import { useThemeStore }      from 'store/themeStore'
  import { useSessionState }    from 'hooks/useSessionState'
  import { useTurnState }       from 'hooks/useSessionState'
  import { useCrisisState }     from 'hooks/useSessionState'
  import { useTypingIndicator } from 'hooks/useTypingIndicator'
  
  // Utilities
  import {
    isSameCalendarDay,
    formatDateSeparator,
    formatTimeOnly,
    formatAccessibleDateTime,
  } from 'utils/formatTime'
  import {
    isSystemMessage,
    isAlindaMessage,
    isNewMessageGroup,
  } from 'utils/roleHelpers'
  
  // Motion
  import { transitionStone, transitionStoneReduced } from 'animations/motionTokens'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  // How far from the bottom (px) before we consider the user "at the bottom"
  const SCROLL_LOCK_THRESHOLD   = 150
  const SCROLL_UNLOCK_THRESHOLD = 80
  
  // Scroll animation duration for smooth scrollTo calls
  const SCROLL_DURATION_MS      = 420
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE PROCESSING
  //
  // Pure function — takes the raw message array and returns a processed array
  // with grouping metadata and date separator information.
  // Called inside useMemo so it only re-runs when messages change.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function processMessages(messages) {
    if (!messages || messages.length === 0) return []
  
    const processed = []
    const now = new Date()
  
    for (let i = 0; i < messages.length; i++) {
      const msg  = messages[i]
      const prev = messages[i - 1] ?? null
      const next = messages[i + 1] ?? null
  
      // ── Date separator ──────────────────────────────────────────────────────
      // Show if this is the first message, or if the date changed
      const showDateSeparator = i === 0 || (
        prev && !isSameCalendarDay(prev.timestamp, msg.timestamp)
      )
      const dateSeparatorLabel = showDateSeparator
        ? formatDateSeparator(msg.timestamp, now)
        : null
  
      // ── Group start ─────────────────────────────────────────────────────────
      // System messages are always their own group
      const isFirst = i === 0 || showDateSeparator || isNewMessageGroup(msg, prev)
  
      // ── Group end ────────────────────────────────────────────────────────────
      // Last in group if next message starts a new group or doesn't exist
      const isLast = !next || isNewMessageGroup(next, msg)
  
      processed.push({
        ...msg,
        _isFirstInGroup:     isFirst,
        _isLastInGroup:      isLast,
        _showDateSeparator:  showDateSeparator,
        _dateSeparatorLabel: dateSeparatorLabel,
      })
    }
  
    return processed
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION COMMENCEMENT MARKER
  //
  // Appears as the first item in the timeline — before any messages.
  // Establishes the therapeutic frame: the room has opened, both people present.
  // Never scrolls away — it's the anchor at the top of history.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function SessionCommencementMarker({ nameA, nameB, startedAt }) {
    const timeStr = startedAt ? formatTimeOnly(startedAt) : null
  
    return (
      <div
        className="flex flex-col items-center gap-1.5 pt-6 pb-4"
        aria-label="Session started"
      >
        {/* Thin horizontal rule */}
        <div className="flex items-center gap-4 w-full max-w-xs">
          <div className="flex-1 h-px bg-surface-edge/40" />
          <div className="w-1.5 h-1.5 rounded-full bg-bronze/40 flex-shrink-0" />
          <div className="flex-1 h-px bg-surface-edge/40" />
        </div>
  
        {/* Names */}
        {nameA && nameB && (
          <p className="
            font-serif italic text-[13px]
            text-text-muted/60
            tracking-wide text-center
            select-none
          ">
            {nameA} and {nameB} are here.
          </p>
        )}
  
        {/* Time */}
        {timeStr && (
          <p className="
            font-sans text-[11px]
            text-text-muted/40
            tracking-[0.06em] text-center
            select-none
          ">
            {timeStr}
          </p>
        )}
      </div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SCROLL-TO-BOTTOM CHEVRON
  //
  // Appears when the user has scrolled up more than SCROLL_LOCK_THRESHOLD.
  // Shows a count badge of messages received while scrolled up.
  // Tapping it scrolls smoothly to the bottom and resets the count.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function ScrollChevron({ count, onPress, prefersReduced }) {
    return (
      <motion.button
        type="button"
        onClick={onPress}
        aria-label={
          count > 0
            ? `${count} new message${count === 1 ? '' : 's'} — scroll to bottom`
            : 'Scroll to bottom'
        }
        className="
          no-tap-flash
          flex items-center gap-2
          px-4 py-2.5
          rounded-full
          bg-surface-overlay/90 backdrop-blur-md
          border border-surface-edge/60
          shadow-ambient
          text-text-secondary
          hover:text-text-primary hover:border-surface-edge
          transition-colors duration-300
          outline-none
          focus-visible:ring-2 focus-visible:ring-bronze/50
        "
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={prefersReduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        transition={{ type: 'tween', ease: [0.20, 0.00, 0.00, 1.00], duration: 0.3 }}
        whileTap={{ scale: 0.95 }}
      >
        {/* New message count badge */}
        {count > 0 && (
          <motion.span
            className="
              flex items-center justify-center
              w-5 h-5 rounded-full
              bg-bronze text-surface-base
              text-[10px] font-sans font-medium
              select-none
            "
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'tween', duration: 0.2 }}
          >
            {count > 9 ? '9+' : count}
          </motion.span>
        )}
  
        {/* Down chevron */}
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1 1.5L6 6.5L11 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </motion.button>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SMOOTH SCROLL HELPER
  //
  // Uses requestAnimationFrame for smooth scrollTo — more reliable than
  // `behavior: 'smooth'` which is ignored in some mobile browsers when
  // called immediately after a DOM mutation.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function smoothScrollTo(element, targetY, duration) {
    const startY     = element.scrollTop
    const distance   = targetY - startY
    const startTime  = performance.now()
  
    // Stone easing: [0.20, 0.00, 0.00, 1.00]
    function easeStone(t) {
      // Approximation of cubic-bezier(0.20, 0.00, 0.00, 1.00) for scroll
      return t < 0.5
        ? 2 * t * t
        : -1 + (4 - 2 * t) * t
    }
  
    function step(currentTime) {
      const elapsed  = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      element.scrollTop = startY + distance * easeStone(progress)
      if (progress < 1) requestAnimationFrame(step)
    }
  
    requestAnimationFrame(step)
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN COMPONENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  export default function ChatScreen() {
    const prefersReduced = useReducedMotion()
  
    // ── Store subscriptions — granular to minimise re-renders ─────────────────
    const displayMessages = useSessionStore(s => s.displayMessages)
    const session         = useSessionStore(s => s.session)
    const myRole          = useSessionStore(s => s.myRole)
  
    const nameA       = session?.name_a    ?? null
    const nameB       = session?.name_b    ?? null
    const mode        = session?.mode      ?? null
    const sessionPhase = session?.session_phase ?? 'opening'
    const startedAt   = session?.session_started_at ?? null
    const myName      = myRole === 'a' ? nameA : nameB
  
    const isDark = useThemeStore(s => s.resolvedMode === 'dark')
  
    // ── Session state ──────────────────────────────────────────────────────────
    const {
      isSessionActive,
      isInCrisis,
      isPauseActive,
      canvasState,
    } = useSessionState()
  
    const { isMyTurn, currentTurn } = useTurnState()
  
    // ── Typing indicators ──────────────────────────────────────────────────────
    const {
      partnerIsTyping,
      alindaIsTyping,
      partnerName,
    } = useTypingIndicator()
  
    // ── Derived turn state ────────────────────────────────────────────────────
    const isAlindaTurn  = currentTurn === 'ai'
    const isHumanTurn   = currentTurn === 'a' || currentTurn === 'b'
    const isOpenFloor   = !currentTurn && isSessionActive
    const showPulse     = isOpenFloor || (isSessionActive && !isHumanTurn && !isAlindaTurn)
  
    // ── Message processing ────────────────────────────────────────────────────
    const processedMessages = useMemo(
      () => processMessages(displayMessages),
      [displayMessages]
    )
  
    // ── Scroll state ──────────────────────────────────────────────────────────
    const scrollRef           = useRef(null)   // the scroll container element
    const scrollLocked        = useRef(false)  // whether user has scrolled up
    const newMessageCount     = useRef(0)      // messages since scroll lock
    const lastMessageCount    = useRef(0)      // previous message count
    const rafScrollRef        = useRef(null)   // RAF handle for scroll position checks
    const [isScrolledUp, setIsScrolledUp]     = useState(false)
    const [missedCount,  setMissedCount]      = useState(0)
  
    // ── Initial scroll to bottom on mount ─────────────────────────────────────
    // Immediate (no animation) — user should see the latest messages first.
    useEffect(() => {
      const el = scrollRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
    }, [])
  
    // ── Auto-scroll on new messages ───────────────────────────────────────────
    useEffect(() => {
      const currentCount = displayMessages.length
      const isNewMessage = currentCount > lastMessageCount.current
      lastMessageCount.current = currentCount
  
      if (!isNewMessage) return
  
      const el = scrollRef.current
      if (!el) return
  
      if (scrollLocked.current) {
        // User is reading — don't auto-scroll, increment the badge
        newMessageCount.current++
        setMissedCount(newMessageCount.current)
      } else {
        // Auto-scroll to bottom
        smoothScrollTo(el, el.scrollHeight, prefersReduced ? 0 : SCROLL_DURATION_MS)
      }
    }, [displayMessages.length, prefersReduced])
  
    // ── Scroll position tracking ──────────────────────────────────────────────
    // RAF-throttled: checks scroll position every frame while scrolling,
    // then stops checking until the next scroll event.
    const handleScroll = useCallback(() => {
      if (rafScrollRef.current) return  // already queued
  
      rafScrollRef.current = requestAnimationFrame(() => {
        rafScrollRef.current = null
        const el = scrollRef.current
        if (!el) return
  
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  
        if (!scrollLocked.current && distanceFromBottom > SCROLL_LOCK_THRESHOLD) {
          // User scrolled up — lock auto-scroll
          scrollLocked.current = true
          setIsScrolledUp(true)
        } else if (scrollLocked.current && distanceFromBottom <= SCROLL_UNLOCK_THRESHOLD) {
          // User scrolled back to bottom — unlock
          scrollLocked.current = false
          newMessageCount.current = 0
          setIsScrolledUp(false)
          setMissedCount(0)
        }
      })
    }, [])
  
    useEffect(() => {
      return () => {
        if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current)
      }
    }, [])
  
    // ── Scroll to bottom (from chevron button) ────────────────────────────────
    const handleScrollToBottom = useCallback(() => {
      const el = scrollRef.current
      if (!el) return
      scrollLocked.current    = false
      newMessageCount.current = 0
      setIsScrolledUp(false)
      setMissedCount(0)
      smoothScrollTo(el, el.scrollHeight, prefersReduced ? 0 : SCROLL_DURATION_MS)
    }, [prefersReduced])
  
    // ── Entrance animation ────────────────────────────────────────────────────
    const entranceVariants = {
      hidden:  { opacity: 0, y: 10 },
      visible: {
        opacity: 1,
        y: 0,
        transition: prefersReduced
          ? { duration: 0.15 }
          : {
              type:     'tween',
              ease:     [0.20, 0.00, 0.00, 1.00],
              duration: 1.2,
            },
      },
    }
  
    // ── Keyboard-aware bottom padding ─────────────────────────────────────────
    // The scroll container reads --keyboard-inset (injected by useKeyboardInset)
    // via a CSS calc. When the keyboard is open, the effective bottom of the
    // scroll area moves up so messages aren't hidden behind the input.
    const scrollBottomPadding = 'calc(10rem + var(--keyboard-inset, 0px))'
  
    return (
      <motion.div
        className="fixed inset-0"
        variants={entranceVariants}
        initial="hidden"
        animate="visible"
      >
        {/* ─────────────────────────────────────────────────────────────────────
            Z:5 — AMBIENT TURN LIGHTING
            Below the message timeline, above the canvas.
            Neither element has pointer-events so they never intercept taps.
            ───────────────────────────────────────────────────────────────────── */}
        <TurnIndicator
          isVisible={isHumanTurn}
          isMyTurn={isMyTurn}
          isDark={isDark}
        />
        <TurnGlow
          isVisible={isAlindaTurn}
          isDark={isDark}
        />
  
        {/* ─────────────────────────────────────────────────────────────────────
            Z:10 — CEILING CONSTELLATION
            Session progress and stage information.
            Three corners: top-left reserved for future menu, top-center StagePill,
            top-right SessionProgressBar.
            ───────────────────────────────────────────────────────────────────── */}
        <StagePill
          mode={mode}
          isVisible={isSessionActive}
          phase={sessionPhase}
        />
        <SessionProgressBar />
  
        {/* ─────────────────────────────────────────────────────────────────────
          Z:15 — THE ZENITH
          AlindaPresencePulse sits above StagePill at the very ceiling.
          It mounts when the floor is open — not during Alinda's active turn
          (TurnGlow handles that) and not during a human turn.
          ───────────────────────────────────────────────────────────────────── */}
      <AlindaPresencePulse
        isVisible={showPulse}
        isDark={isDark}
      />

      {/* ─────────────────────────────────────────────────────────────────────
          Z:10 — THE MESSAGE TIMELINE
          The primary scrollable surface. Fixed inset-0 so it fills the
          full viewport. Content is centered in a max-width column on desktop.
          ───────────────────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="
          fixed inset-0
          overflow-y-auto
          overscroll-none
        "
        style={{
          zIndex: 10,
          // Custom scrollbar — thin, themed
          scrollbarWidth:    'thin',
          scrollbarColor:    'var(--surface-edge) transparent',
          WebkitOverflowScrolling: 'touch',
        }}
        role="log"
        aria-label="Session conversation"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
      >
        {/* Inner column — centered on desktop, full-width on mobile */}
        <div className="
          relative mx-auto
          w-full max-w-2xl
          px-4 sm:px-6
        ">
          {/* TOP PADDING — breathing room below the ceiling */}
          <div
            className="pt-32 sm:pt-36"
            aria-hidden="true"
          />

          {/* SESSION COMMENCEMENT MARKER */}
          {(nameA || nameB) && (
            <SessionCommencementMarker
              nameA={nameA}
              nameB={nameB}
              startedAt={startedAt}
            />
          )}

          {/* MESSAGES */}
          <div className="flex flex-col">
            <AnimatePresence initial={false}>
              {processedMessages.map((msg, i) => {
                const items = []

                // Date separator
                if (msg._showDateSeparator && msg._dateSeparatorLabel) {
                  items.push(
                    <DateSeparator
                      key={`sep-${msg.id ?? i}`}
                      label={msg._dateSeparatorLabel}
                    />
                  )
                }

                // The message bubble
                items.push(
                  <MessageBubble
                    key={msg.id ?? `optimistic-${msg.extra_data?.client_id ?? i}`}
                    message={msg}
                    myRole={myRole}
                    nameA={nameA}
                    nameB={nameB}
                    isFirstInGroup={msg._isFirstInGroup}
                    isLastInGroup={msg._isLastInGroup}
                    index={i}
                  />
                )

                return items
              })}
            </AnimatePresence>

            {/* TYPING INDICATORS — always last in the list */}
            {/* Partner typing */}
            <TypingIndicator
              isVisible={partnerIsTyping}
              isAlinda={false}
              partnerName={partnerName}
            />

            {/* Alinda typing */}
            <TypingIndicator
              isVisible={alindaIsTyping}
              isAlinda={true}
            />
          </div>

          {/* BOTTOM PADDING — breathing room above the MessageInput */}
          {/* Dynamic: accounts for keyboard inset and input expansion */}
          <div
            aria-hidden="true"
            style={{ height: scrollBottomPadding }}
          />
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          Z:25 — SCROLL-TO-BOTTOM CHEVRON
          Appears when user is scrolled up. Shows missed message count.
          Sits above the MessageInput, centered.
          ───────────────────────────────────────────────────────────────────── */}
      <div
        className="
          fixed left-1/2 -translate-x-1/2
          flex items-center justify-center
          pointer-events-none
        "
        style={{
          // Position above the MessageInput (approx 80px from bottom)
          // Accounting for keyboard inset
          bottom:  'calc(5.5rem + var(--keyboard-inset, 0px))',
          zIndex:  25,
        }}
      >
        <AnimatePresence>
          {isScrolledUp && (
            <div className="pointer-events-auto">
              <ScrollChevron
                count={missedCount}
                onPress={handleScrollToBottom}
                prefersReduced={prefersReduced}
              />
            </div>
          )}
        </AnimatePresence>
      </div>


      {/* ─────────────────────────────────────────────────────────────────────
          Z:20 — THE FLOATING VELLUM (MessageInput)
          MessageInput manages its own keyboard spring and fixed positioning.
          It is mounted here; it positions itself.
          ───────────────────────────────────────────────────────────────────── */}
      <MessageInput />
    </motion.div>
  )

}