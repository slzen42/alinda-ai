/**
 * src/components/chat/MessageInput.jsx
 *
 * The Floating Vellum — the user's literal voice in the room.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHYSICAL ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A wide frosted glass pill anchored to the bottom of the screen.
 * It sits above the TurnGlow (z:5) and below the UI layer (z:10).
 * The keyboard inset hook moves it upward when the virtual keyboard
 * appears — the movement uses a Framer Motion spring (the single
 * permitted spring in the application) to match the OS keyboard's
 * own spring physics.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOCUS STATES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AT REST:    Slightly transparent, no border, ambient shadow only
 * FOCUSED:    scale 1.008, higher opacity, 1px bronze border illuminates
 * TYPING:     Border remains; send button morphs from ring → filled chevron
 * DISABLED:   Lockdown state — breathing gradient, italic placeholder, no border
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MORPHING SEND BUTTON
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * At rest (empty input): a thin muted circle outline — open potential.
 * Ready (text present):  the outline fills with bronze; a chevron (^)
 *                        slides up from below into the center.
 *
 * This two-step morph (fill → reveal chevron) prevents the button from
 * feeling like it's demanding action. The chevron only appears once the
 * user has already decided to say something — it follows their intent,
 * never precedes it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOCKDOWN BREATHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * In crisis_pause / cooldown mode, the input box is disabled.
 * A horizontal gradient sweep breathes left-to-right at 0.1Hz using
 * the Alinda colour trio (bronze, sage, pale gold). The placeholder
 * centers and becomes italic: "The room is paused. Just breathe."
 *
 * The box is visually alive — the breath communicates that the room
 * is still holding the user, just not accepting new words right now.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTO-EXPAND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The textarea expands upward to fit content, up to a maximum of 6 lines
 * (~148px). Beyond that, internal scrolling activates. The expansion uses
 * Framer Motion's layout animation — the pill physically grows, pushing
 * the content above it upward.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEYBOARD INSET
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The spring exception: useSpring on keyboardHeight moves the input
 * container upward to match the native keyboard's own spring curve.
 * Every other animation in the app uses stone easing (tweens).
 * This single spring is justified because matching native OS physics
 * here makes the input feel like part of the device rather than a
 * web overlay.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS (all consumed from hooks — this component takes no props)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All state comes from:
 *   useInputState()         — canSend, isOffline, myRole
 *   useSessionState()       — mode, isInCrisis, isPauseActive
 *   useTypingIndicator()    — onTypingActivity, onTypingStop
 *   useKeyboardInset()      — keyboardHeight
 *   useSessionStore()       — addOptimisticMessage, roomId, myRole
 *   alindaWS.sendMessage()  — outbound WebSocket
 */

import React, {
    useState,
    useRef,
    useCallback,
    useEffect,
    useId,
  } from 'react'
  import { motion, AnimatePresence, useReducedMotion, useSpring } from 'framer-motion'
  import { clsx }                  from 'clsx'
  
  import { useInputState }         from 'hooks/useSessionState'
  import { useSessionState }       from 'hooks/useSessionState'
  import { useTypingIndicator }    from 'hooks/useTypingIndicator'
  import { useKeyboardInset }      from 'hooks/useKeyboardInset'
  import { useSessionStore }       from 'store/sessionStore'
  import { alindaWS }              from 'lib/websocket'
  import { soundManager }          from 'lib/soundManager'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const MAX_CHARS    = 4000
  const MAX_ROWS     = 6
  const LINE_HEIGHT  = 24    // px per line (matches text-base leading-relaxed)
  const MIN_HEIGHT   = 44    // px — single line, matches min touch target
  const MAX_HEIGHT   = LINE_HEIGHT * MAX_ROWS + 24  // +24 for vertical padding
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // LOCKDOWN GRADIENT BREATHING
  //
  // Animates a left-to-right gradient sweep across the disabled input.
  // Uses the Alinda colour trio at very low opacity.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function LockdownBreath() {
    return (
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <motion.div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(
              90deg,
              rgba(122,140,110,0) 0%,
              rgba(122,140,110,0.12) 25%,
              rgba(143,175,140,0.10) 50%,
              rgba(196,165,90,0.08) 75%,
              rgba(122,140,110,0) 100%
            )`,
          }}
          animate={{
            x: ['-100%', '100%'],
          }}
          transition={{
            // 0.1Hz: 10s cycle, linear so the sweep is consistent
            duration: 10,
            repeat:   Infinity,
            ease:     'easeInOut',
            times:    [0, 1],
          }}
        />
      </motion.div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SEND BUTTON
  //
  // Two states: ring (empty) → filled with chevron (has text)
  // The morph is a two-layer animation: background fills, then chevron reveals.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function SendButton({ hasText, isDisabled, onClick, prefersReduced }) {
    const haptic = useCallback(() => {
      try { navigator.vibrate?.(10) } catch {}
    }, [])
  
    const handleClick = useCallback(() => {
      if (isDisabled) return
      haptic()
      onClick()
    }, [isDisabled, haptic, onClick])
  
    return (
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-label={hasText ? 'Send message' : 'Type a message to send'}
        className="
          no-tap-flash relative flex-shrink-0
          w-9 h-9 sm:w-10 sm:h-10
          flex items-center justify-center
          rounded-full
          outline-none
          focus-visible:ring-2 focus-visible:ring-bronze/60
          focus-visible:ring-offset-2 focus-visible:ring-offset-transparent
          transition-colors duration-200
          disabled:cursor-not-allowed
        "
        whileTap={!isDisabled && !prefersReduced
          ? { scale: 0.90, transition: { type: 'tween', duration: 0.12 } }
          : {}
        }
      >
        {/* Background ring → filled circle */}
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            backgroundColor: hasText
              ? 'rgba(122,140,110,1)'    // bronze-sage — solid
              : 'rgba(0,0,0,0)',          // transparent
            borderWidth:     hasText ? 0 : 1.5,
            borderColor:     hasText
              ? 'rgba(0,0,0,0)'
              : 'rgba(122,140,110,0.40)',
            borderStyle:     'solid',
          }}
          transition={{
            duration: prefersReduced ? 0.1 : 0.28,
            ease: [0.20, 0.00, 0.00, 1.00],
          }}
        />
  
        {/* Chevron — slides up from below when text arrives */}
        <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
          <AnimatePresence mode="wait">
            {hasText ? (
              <motion.svg
                key="chevron"
                width="14"
                height="10"
                viewBox="0 0 14 10"
                fill="none"
                aria-hidden="true"
                className="relative z-10"
                initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{
                  type: 'tween',
                  ease: [0.20, 0.00, 0.00, 1.00],
                  duration: prefersReduced ? 0.1 : 0.22,
                }}
              >
                {/* Clean upward chevron */}
                <path
                  d="M1 8L7 2L13 8"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </motion.svg>
            ) : (
              // Empty state — just the ring, no inner icon
              <motion.div key="empty" className="w-full h-full" />
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN COMPONENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  export default function MessageInput() {
    const prefersReduced = useReducedMotion()
    const textareaId     = useId()
    const textareaRef    = useRef(null)
    const containerRef   = useRef(null)
  
    // ── Hooks ─────────────────────────────────────────────────────────────────
    const { canSend, myRole }           = useInputState()
    const { mode, isInCrisis, isPauseActive } = useSessionState()
    const { onTypingActivity, onTypingStop }  = useTypingIndicator()
    const { keyboardHeight }                  = useKeyboardInset()
    const addOptimistic                       = useSessionStore(s => s.addOptimisticMessage)
    const roomId                              = useSessionStore(s => s.roomId)
  
    // ── Local state ───────────────────────────────────────────────────────────
    const [text,      setText]      = useState('')
    const [isFocused, setIsFocused] = useState(false)
    const [height,    setHeight]    = useState(MIN_HEIGHT)
  
    // ── Derived ────────────────────────────────────────────────────────────────
    const isLocked    = isInCrisis || isPauseActive || mode === 'cooldown'
    const isDisabled  = isLocked || !canSend
    const hasText     = text.trim().length > 0
    const isSendable  = hasText && !isDisabled
  
    // ── Keyboard spring (the one permitted spring) ────────────────────────────
    // Moves the input container up when the virtual keyboard opens.
    // Spring stiffness/damping chosen to approximately match iOS keyboard curve.
    const springBottom = useSpring(keyboardHeight, {
      stiffness: 320,
      damping:   32,
      mass:      1,
    })
  
    // ── Auto-expand ────────────────────────────────────────────────────────────
    const autoExpand = useCallback(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      const scrollH = el.scrollHeight
      const clamped = Math.min(Math.max(scrollH, MIN_HEIGHT), MAX_HEIGHT)
      el.style.height = `${clamped}px`
      setHeight(clamped)
    }, [])
  
    // ── Handlers ───────────────────────────────────────────────────────────────
    const handleChange = useCallback((e) => {
      if (isLocked) return
      const val = e.target.value.slice(0, MAX_CHARS)
      setText(val)
      autoExpand()
      if (val.trim()) onTypingActivity()
      else            onTypingStop()
    }, [isLocked, autoExpand, onTypingActivity, onTypingStop])
  
    const handleSend = useCallback(() => {
      if (!isSendable) return
      const content = text.trim()
      setText('')
      setHeight(MIN_HEIGHT)
      if (textareaRef.current) {
        textareaRef.current.style.height = `${MIN_HEIGHT}px`
      }
      onTypingStop()
  
      // Optimistic display
      const { clientId, queued } = alindaWS.sendMessage(content)
      addOptimistic(content, clientId)
  
      // Sound
      soundManager.playMessageArrive?.('self')
  
      // Refocus
      setTimeout(() => textareaRef.current?.focus(), 50)
    }, [isSendable, text, onTypingStop, addOptimistic])
  
    const handleKeyDown = useCallback((e) => {
      // Cmd/Ctrl+Enter or plain Enter on desktop submits
      // Shift+Enter always inserts newline
      if (e.key === 'Enter' && !e.shiftKey) {
        // On mobile (virtual keyboard), Enter inserts newline — don't submit
        // We detect mobile via touch support as a proxy
        const isMobile = window.matchMedia('(pointer: coarse)').matches
        if (!isMobile) {
          e.preventDefault()
          handleSend()
        }
      }
    }, [handleSend])
  
    // Reset height when text is cleared externally
    useEffect(() => {
      if (!text && textareaRef.current) {
        textareaRef.current.style.height = `${MIN_HEIGHT}px`
        setHeight(MIN_HEIGHT)
      }
    }, [text])
  
    // ── Lockdown placeholder ──────────────────────────────────────────────────
    const placeholder = isLocked
      ? 'The room is paused. Just breathe.'
      : isFocused
        ? 'Speak freely\u2026'
        : 'Your thoughts\u2026'
  
    // ── Focus animation values ────────────────────────────────────────────────
    const pillVariants = {
      rest:     { scale: 1.000, opacity: 0.88 },
      focused:  { scale: 1.006, opacity: 1.00 },
      locked:   { scale: 1.000, opacity: 0.72 },
    }
    const pillState = isLocked ? 'locked' : isFocused ? 'focused' : 'rest'
  
    const borderColor = isLocked
      ? 'rgba(122,140,110,0)'
      : isFocused
        ? 'rgba(122,140,110,0.55)'    // bronze — gentle, not glaring
        : 'rgba(122,140,110,0)'
  
    return (
      <motion.div
        className="
          fixed inset-x-0
          flex items-end justify-center
          px-4 sm:px-6 lg:px-8
          pb-3 sm:pb-4
          pointer-events-none
        "
        style={{
          // z-index 20: above TurnGlow (5) and canvas (-1), below overlays (40)
          zIndex:       20,
          // Spring-driven keyboard lift — the one permitted spring
          bottom:       springBottom,
        }}
      >
        {/* ── THE PILL ──────────────────────────────────────────────────────── */}
        <motion.div
          ref={containerRef}
          layout
          className="
            relative w-full max-w-2xl
            flex items-end gap-3
            px-4 py-3
            rounded-2xl
            bg-surface-overlay/90
            backdrop-blur-xl
            shadow-ambient
            pointer-events-auto
          "
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor,
          }}
          variants={pillVariants}
          animate={prefersReduced ? {} : pillState}
          transition={{
            type:     'tween',
            ease:     [0.20, 0.00, 0.00, 1.00],
            duration: 0.28,
          }}
        >
          {/* Lockdown breathing gradient */}
          {isLocked && <LockdownBreath />}
  
          {/* ── TEXTAREA ────────────────────────────────────────────────────── */}
          <div className="flex-1 relative">
            <label htmlFor={textareaId} className="sr-only">
              Message
            </label>
            <textarea
              ref={textareaRef}
              id={textareaId}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={isLocked}
              placeholder={placeholder}
              rows={1}
              maxLength={MAX_CHARS}
              aria-label="Message input"
              aria-multiline="true"
              aria-disabled={isLocked}
              className={clsx(
                'w-full bg-transparent resize-none',
                'font-sans text-[15px] text-text-primary',
                'leading-relaxed',
                'placeholder:transition-all placeholder:duration-500',
                isLocked
                  ? 'placeholder:text-text-muted/60 placeholder:italic placeholder:text-center'
                  : 'placeholder:text-text-muted',
                'outline-none border-none',
                'selection:bg-bronze/20',
                'overflow-hidden',
                isLocked && 'cursor-not-allowed',
              )}
              style={{
                height:     height,
                minHeight:  MIN_HEIGHT,
                maxHeight:  MAX_HEIGHT,
                overflowY:  height >= MAX_HEIGHT ? 'auto' : 'hidden',
                // Scrollbar styling for browsers that support it
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--surface-edge) transparent',
              }}
            />
          </div>
  
          {/* ── SEND BUTTON ─────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 self-end pb-0.5">
            <SendButton
              hasText={hasText}
              isDisabled={!isSendable}
              onClick={handleSend}
              prefersReduced={prefersReduced}
            />
          </div>
        </motion.div>
  
        {/* ── CHARACTER LIMIT WARNING ──────────────────────────────────────── */}
        <AnimatePresence>
          {text.length > MAX_CHARS * 0.9 && (
            <motion.p
              className="
                absolute bottom-full mb-1 right-4 sm:right-6
                text-[11px] font-sans text-text-muted/60
                tracking-wide
              "
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {MAX_CHARS - text.length} remaining
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    )
  }