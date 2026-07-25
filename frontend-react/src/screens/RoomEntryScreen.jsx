/**
 * src/screens/RoomEntryScreen.jsx
 *
 * The Threshold — the first physical surface the user encounters.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN INTENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The LivingCanvas is already breathing at Z:-1 when this screen mounts.
 * The entry card does not cover it — it floats above it like a pane of
 * polished alabaster, letting the canvas bleed through the frosted surface.
 *
 * This screen must accomplish one clinical task before it accomplishes
 * anything technical: it must make the person feel they have arrived
 * somewhere real. Not a web form. Not a signup page. A room.
 *
 * Every visual decision follows from that intent:
 *   - The wordmark is engraved, not printed
 *   - The inputs are carved, not overlaid
 *   - The card floats, not sits
 *   - The transitions dissolve, not switch
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CREATE path (Partner A):
 *   1. Enter name
 *   2. A room code is generated client-side (6 uppercase alphanumeric chars)
 *   3. Code is displayed with a copy button — Partner A shares it with Partner B
 *   4. Tap "Enter Room" → api.createRoom() → sessionStore.initSession('a')
 *   5. App.jsx detects mode change → IntakeScreen
 *
 * JOIN path (Partner B):
 *   1. Enter name
 *   2. Enter the room code Partner A shared
 *   3. Tap "Enter Room" → api.joinRoom() → sessionStore.initSession('b')
 *   4. App.jsx detects mode change → WaitingScreen (or IntakeScreen if A is ready)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NETWORK RESILIENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * api.js handles retries transparently. If the first network call fails,
 * the breathing wave loader continues while api.js silently retries with
 * exponential backoff. The user experiences "it's taking a moment"
 * rather than "there was an error." Errors only surface after all retries
 * are exhausted, and even then as calm, warm copy rather than raw errors.
 */

import React, {
    useState,
    useCallback,
    useRef,
    useEffect,
    useId,
  } from 'react'
  import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
  import { clsx }                                       from 'clsx'
  
  import Button, { PrimaryAction }  from 'components/ui/Button'
  import { useSessionStore }        from 'store/sessionStore'
  import { useThemeStore }          from 'store/themeStore'
  import { useThemeToggle }         from 'hooks/useTheme'
  import { api }                    from 'lib/api'
  import { soundManager }           from 'lib/soundManager'
  import {
    transitionReveal,
    transitionRevealReduced,
    transitionVanish,
    transitionStone,
    transitionStoneReduced,
    staggerStandard,
  } from 'animations/motionTokens'
  import {
    pageVariants,
    pageVariantsReduced,
    inscriptionVariants,
    inscriptionVariantsReduced,
    staggerContainerVariants,
  } from 'animations/transitions'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const MODE = Object.freeze({ CREATE: 'create', JOIN: 'join' })
  
  const MAX_NAME_LENGTH    = 40
  const ROOM_CODE_LENGTH   = 6
  const MAX_CODE_INPUT_LENGTH = ROOM_CODE_LENGTH
  
  // Characters used for room code generation.
  // Deliberately excludes visually ambiguous characters: 0/O, 1/I/L
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  
  /**
   * Generates a human-readable, unambiguous room code.
   * Client-side generation means Partner A sees the code instantly
   * without waiting for a server round-trip.
   *
   * @returns {string} — e.g. "MR4KJW"
   */
  function generateRoomCode() {
    const chars = []
    const array = new Uint8Array(ROOM_CODE_LENGTH)
    crypto.getRandomValues(array)
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      chars.push(CODE_ALPHABET[array[i] % CODE_ALPHABET.length])
    }
    return chars.join('')
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INNER COMPONENTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * The sliding segmented control (Create / Join).
   * The active pill uses Framer Motion's layoutId to glide between positions.
   */
  function SegmentedControl({ value, onChange, disabled }) {
    const prefersReduced = useReducedMotion()
  
    const segments = [
      { id: MODE.CREATE, label: 'Create' },
      { id: MODE.JOIN,   label: 'Join'   },
    ]
  
    return (
      <div
        role="radiogroup"
        aria-label="Session mode"
        className="
          relative flex w-full
          bg-surface-base rounded-xl p-1
          border border-surface-edge
        "
      >
        {segments.map(({ id, label }) => {
          const isActive = value === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              onClick={() => onChange(id)}
              className={clsx(
                'relative flex-1 py-2.5 text-sm tracking-wide',
                'no-tap-flash outline-none rounded-lg',
                'transition-colors duration-300',
                'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-1',
                isActive
                  ? 'text-text-primary z-10'
                  : 'text-text-muted hover:text-text-secondary',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {/* Sliding background pill */}
              {isActive && (
                <motion.span
                  layoutId="segment-pill"
                  className="
                    absolute inset-0 rounded-lg
                    bg-surface-raised border border-surface-edge
                  "
                  transition={prefersReduced
                    ? { duration: 0.1 }
                    : { type: 'tween', ease: [0.20, 0.00, 0.00, 1.00], duration: 0.28 }
                  }
                />
              )}
              <span className="relative">{label}</span>
            </button>
          )
        })}
      </div>
    )
  }
  
  
  /**
   * A single "carved" input field — visually recessed into the card surface.
   * Floating label rises on focus or when a value is present.
   */
  function CarvedInput({
    id,
    label,
    value,
    onChange,
    type         = 'text',
    placeholder  = '',
    maxLength,
    autoComplete = 'off',
    autoCapitalize = 'off',
    spellCheck   = false,
    inputMode,
    hint,
    disabled,
    error,
    ...rest
  }) {
    const [isFocused, setIsFocused] = useState(false)
    const isFloated = isFocused || Boolean(value)
  
    return (
      <div className="relative w-full">
        {/* The carved input container */}
        <div className={clsx(
          'relative w-full rounded-xl overflow-hidden',
          'transition-all duration-300',
          // Sunken / debossed appearance
          'bg-surface-base shadow-stone-inset',
          'border',
          error
            ? 'border-terracotta'
            : isFocused
              ? 'border-text-muted'
              : 'border-surface-edge',
        )}>
          {/* Floating label */}
          <motion.label
            htmlFor={id}
            className={clsx(
              'absolute left-4 pointer-events-none',
              'transition-all duration-300 font-sans',
              isFloated
                ? 'top-2 text-xs text-text-muted'
                : 'top-1/2 -translate-y-1/2 text-base text-text-muted',
            )}
            animate={{
              y:        isFloated ? 0 : 0,
              fontSize: isFloated ? '0.75rem' : '1rem',
            }}
          >
            {label}
          </motion.label>
  
          {/* The actual input */}
          <input
            id={id}
            type={type}
            value={value}
            onChange={onChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            maxLength={maxLength}
            autoComplete={autoComplete}
            autoCapitalize={autoCapitalize}
            spellCheck={spellCheck}
            inputMode={inputMode}
            disabled={disabled}
            placeholder={isFocused ? placeholder : ''}
            className={clsx(
              'w-full bg-transparent',
              'pt-6 pb-2 px-4',
              'text-text-primary font-sans text-base',
              'outline-none border-none',
              'selection:bg-bronze/20',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
            {...rest}
          />
        </div>
  
        {/* Hint or error text */}
        <AnimatePresence mode="wait">
          {(hint || error) && (
            <motion.p
              key={error ? 'error' : 'hint'}
              className={clsx(
                'mt-1.5 ml-1 text-xs font-sans',
                error ? 'text-terracotta' : 'text-text-muted'
              )}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {error || hint}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    )
  }
  
  
  /**
   * The room code display with copy-to-clipboard functionality.
   * Shown to the creator (Partner A) after their code is generated.
   */
  function RoomCodeDisplay({ code }) {
    const [copied, setCopied] = useState(false)
    const timerRef            = useRef(null)
  
    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code)
        setCopied(true)
        soundManager.playJoin?.()  // soft chime to confirm copy
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard API unavailable — show manual selection
        const el = document.getElementById('room-code-display')
        if (el) {
          const range = document.createRange()
          range.selectNodeContents(el)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(range)
        }
      }
    }, [code])
  
    useEffect(() => () => clearTimeout(timerRef.current), [])
  
    return (
      <motion.div
        className="
          w-full rounded-xl overflow-hidden
          border border-surface-edge
          bg-surface-base shadow-stone-inset
        "
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={transitionReveal}
      >
        <div className="px-4 pt-2.5 pb-1">
          <p className="text-xs text-text-muted font-sans tracking-wider uppercase">
            Room code — share this with your partner
          </p>
        </div>
  
        <div className="flex items-center gap-3 px-4 pb-3">
          {/* The code itself */}
          <p
            id="room-code-display"
            className="
              flex-1 font-mono text-2xl tracking-[0.3em]
              text-text-primary font-light select-all
            "
            aria-label={`Room code: ${code.split('').join(' ')}`}
          >
            {code}
          </p>
  
          {/* Copy button */}
          <button
            type="button"
            onClick={handleCopy}
            className={clsx(
              'no-tap-flash flex items-center gap-1.5',
              'text-xs font-sans tracking-wide rounded-lg px-3 py-1.5',
              'transition-all duration-300 outline-none',
              'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-1',
              copied
                ? 'text-bronze-strong bg-bronze-soft'
                : 'text-text-muted bg-surface-edge hover:text-text-primary hover:bg-surface-raised',
            )}
            aria-label={copied ? 'Code copied' : 'Copy room code'}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={copied ? 'copied' : 'copy'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {copied ? 'Copied' : 'Copy'}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </motion.div>
    )
  }
  
  
  /**
   * A small, themed error message rendered below the form.
   */
  function FormError({ message }) {
    if (!message) return null
    return (
      <motion.div
        className="
          w-full rounded-xl px-4 py-3
          bg-terracotta-soft border border-terracotta/30
        "
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={transitionReveal}
      >
        <p className="text-sm font-sans text-terracotta-strong leading-relaxed">
          {message}
        </p>
      </motion.div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DISCLOSURE LINE (bottom of card)
  // ─────────────────────────────────────────────────────────────────────────────
  
  function DisclosureLine() {
    return (
      <p className="text-center text-xs text-text-muted font-sans leading-relaxed">
        Alinda is an AI guide, not a licensed therapist.{' '}
        <span className="text-text-muted/70">Your conversation is private.</span>
      </p>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // THEME TOGGLE (top-right of screen, outside the card)
  // ─────────────────────────────────────────────────────────────────────────────
  
  function ThemeToggle() {
    const { isDark, toggleMode } = useThemeToggle()
  
    return (
      <button
        type="button"
        onClick={toggleMode}
        aria-label={isDark ? 'Switch to Olympian (light) mode' : 'Switch to Titan (dark) mode'}
        className="
          no-tap-flash w-9 h-9 flex items-center justify-center
          rounded-full text-text-muted hover:text-text-primary
          hover:bg-surface-raised transition-colors duration-300
          outline-none focus-visible:ring-2 focus-visible:ring-bronze
          focus-visible:ring-offset-1 focus-visible:ring-offset-surface-base
        "
      >
        {/* Minimal sun/moon icons rendered inline — no icon library dependency */}
        {isDark ? (
          // Sun — Olympian
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="8" y1="1" x2="8" y2="2.5"   stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="8" y1="13.5" x2="8" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="1" y1="8" x2="2.5" y2="8"   stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="13.5" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="3.05" y1="3.05" x2="4.11" y2="4.11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="11.89" y1="11.89" x2="12.95" y2="12.95" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="3.05" y1="12.95" x2="4.11" y2="11.89" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="11.89" y1="4.11" x2="12.95" y2="3.05" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        ) : (
          // Moon — Titan
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M11.5 8.5A5 5 0 0 1 5.5 2.5a5.002 5.002 0 0 0 6 6z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN SCREEN COMPONENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  export default function RoomEntryScreen() {
    const prefersReduced  = useReducedMotion()
    const nameInputId     = useId()
    const codeInputId     = useId()
  
    // ── Local form state ──────────────────────────────────────────────────────
    const [mode,       setMode]       = useState(MODE.CREATE)
    const [name,       setName]       = useState('')
    const [codeInput,  setCodeInput]  = useState('')   // JOIN: partner-entered code
    const [roomCode,   setRoomCode]   = useState(() => generateRoomCode())   // CREATE
    const [isLoading,  setIsLoading]  = useState(false)
    const [error,      setError]      = useState(null)
    const [nameError,  setNameError]  = useState(null)
    const [codeError,  setCodeError]  = useState(null)
  
    // ── Store actions ─────────────────────────────────────────────────────────
    const initSession = useSessionStore(s => s.initSession)
    const setMyRole   = useSessionStore(s => s.setMyRole)
  
    // ── Derived state ─────────────────────────────────────────────────────────
    const isCreate       = mode === MODE.CREATE
    const trimmedName    = name.trim()
    const trimmedCode    = isCreate ? roomCode : codeInput.trim().toUpperCase()
    const canSubmit      = trimmedName.length >= 1 && (isCreate || trimmedCode.length === ROOM_CODE_LENGTH)
  
    // ── Regenerate room code when switching to Create mode ────────────────────
    useEffect(() => {
      if (isCreate) setRoomCode(generateRoomCode())
      setError(null)
      setNameError(null)
      setCodeError(null)
    }, [mode, isCreate])
  
    // ── Input handlers ────────────────────────────────────────────────────────
    const handleNameChange = useCallback((e) => {
      setName(e.target.value.slice(0, MAX_NAME_LENGTH))
      if (nameError) setNameError(null)
      if (error)     setError(null)
    }, [nameError, error])
  
    const handleCodeInputChange = useCallback((e) => {
      // Force uppercase, strip non-alphanumeric, enforce length
      const cleaned = e.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, MAX_CODE_INPUT_LENGTH)
      setCodeInput(cleaned)
      if (codeError) setCodeError(null)
      if (error)     setError(null)
    }, [codeError, error])
  
    // ── Validation ────────────────────────────────────────────────────────────
    const validate = useCallback(() => {
      let valid = true
      if (!trimmedName) {
        setNameError('Please enter your name so your partner knows you\'ve arrived.')
        valid = false
      }
      if (!isCreate && trimmedCode.length !== ROOM_CODE_LENGTH) {
        setCodeError(`The room code is ${ROOM_CODE_LENGTH} characters long.`)
        valid = false
      }
      return valid
    }, [trimmedName, trimmedCode, isCreate])
  
    // ── Submit handler ────────────────────────────────────────────────────────
    const handleSubmit = useCallback(async () => {
      if (!validate()) return
      setIsLoading(true)
      setError(null)
  
      try {
        if (isCreate) {
          // CREATE — Partner A
          const session = await api.createRoom({
            room_id: trimmedCode,
            name_a:  trimmedName,
          })
          initSession(session.room_id, 'a')
          setMyRole('a')
          soundManager.playJoin()
  
        } else {
          // JOIN — Partner B
          const session = await api.joinRoom({
            room_id: trimmedCode,
            name_b:  trimmedName,
          })
          initSession(session.room_id, 'b')
          setMyRole('b')
          soundManager.playJoin()
        }
  
        // App.jsx detects mode change in sessionStore and transitions automatically.
        // No navigation call needed here.
  
      } catch (err) {
        setIsLoading(false)
  
        // Map API error types to warm, contextual copy
        const errorMessages = {
          ROOM_NOT_FOUND:  'That room code wasn\'t found. Please check it with your partner and try again.',
          ROOM_FULL:       'This room already has two partners. Each session is private to one couple.',
          SESSION_CLOSED:  'This session has ended. Please create a new room to begin again.',
          NETWORK:         'Alinda couldn\'t reach the server just now. Take a breath — we\'re trying again.',
        TIMEOUT:         'This is taking longer than expected. Please try once more.',
        DUPLICATE_REQUEST: null,  // silently ignored — user tapped twice
      }

      if (err?.type && err.type !== 'DUPLICATE_REQUEST') {
        setError(errorMessages[err.type] ?? err.userMessage ?? 'Something went wrong. Please try again.')
      } else if (!err?.type) {
        setError('Something unexpected happened. Please try again.')
      }
    }
  }, [validate, isCreate, trimmedCode, trimmedName, initSession, setMyRole])

  // ── Keyboard submit ───────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && canSubmit && !isLoading) handleSubmit()
  }, [canSubmit, isLoading, handleSubmit])

  // ── Animation variants ────────────────────────────────────────────────────
  const containerVars   = prefersReduced ? pageVariantsReduced       : pageVariants
  const inscriptionVars = prefersReduced ? inscriptionVariantsReduced : inscriptionVariants
  const revealTrans     = prefersReduced ? transitionRevealReduced    : transitionReveal

  return (
    <motion.div
      className="
        fixed inset-0
        flex items-center justify-center
        p-4 sm:p-8
      "
      variants={containerVars}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* Theme toggle — top right, outside the card */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10">
        <ThemeToggle />
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          THE CARD — Floating alabaster pane
          ───────────────────────────────────────────────────────────────────── */}
      <motion.div
        className="
          relative w-full max-w-sm
          rounded-3xl overflow-hidden
          border border-surface-edge
          frosted-overlay
        "
        style={{
          // The frosted-overlay class handles backdrop-filter.
          // This additional shadow creates depth against the canvas
          // without a floating drop-shadow. It reads as the card
          // pressing slightly into the canvas below it.
          boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 24px 64px -12px rgba(42,38,33,0.18)',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Subtle top-edge highlight — the light catching the stone's rim */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-surface-edge to-transparent" />

        <div className="px-7 py-8 flex flex-col gap-6">

          {/* ── WORDMARK ──────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-2">
            <motion.h1
              className="
                font-serif font-light
                text-4xl tracking-[0.18em]
                text-text-primary
                select-none
              "
              variants={inscriptionVars}
              initial="hidden"
              animate="visible"
            >
              Alinda
            </motion.h1>

            {/* The meander line — one thin decorative rule beneath the wordmark */}
            <motion.div
              className="flex items-center gap-3 w-full justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...revealTrans, delay: 0.3 }}
            >
              <div className="h-px flex-1 max-w-[48px] bg-surface-edge" />
              {/* A minimal Greek meander motif — three segments */}
              <svg
                width="20"
                height="6"
                viewBox="0 0 20 6"
                fill="none"
                aria-hidden="true"
                className="text-surface-edge opacity-60"
              >
                <path
                  d="M0 5h4V1h12v4h4"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="square"
                  fill="none"
                />
              </svg>
              <div className="h-px flex-1 max-w-[48px] bg-surface-edge" />
            </motion.div>

            <motion.p
              className="
                font-sans text-sm text-text-muted
                tracking-wide text-center
              "
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...revealTrans, delay: 0.45 }}
            >
              A private space for two.
            </motion.p>
          </div>

          {/* ── SEGMENTED CONTROL ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.55 }}
          >
            <SegmentedControl
              value={mode}
              onChange={setMode}
              disabled={isLoading}
            />
          </motion.div>

          {/* ── FORM FIELDS ────────────────────────────────────────────────── */}
          <motion.div
            className="flex flex-col gap-4"
            variants={staggerContainerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Name input — always shown */}
            <motion.div
              variants={{
                hidden:  { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0, transition: revealTrans },
              }}
            >
              <CarvedInput
                id={nameInputId}
                label="Your name"
                value={name}
                onChange={handleNameChange}
                type="text"
                maxLength={MAX_NAME_LENGTH}
                autoComplete="given-name"
                autoCapitalize="words"
                spellCheck={false}
                disabled={isLoading}
                error={nameError}
                aria-required="true"
                aria-describedby={nameError ? `${nameInputId}-error` : undefined}
              />
            </motion.div>

            {/* Room code — different UI depending on mode */}
            <AnimatePresence mode="wait">
              {isCreate ? (
                /* CREATE: display generated code with copy button */
                <motion.div
                  key="room-code-display"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: revealTrans }}
                  exit={{ opacity: 0, y: -4, transition: transitionVanish }}
                >
                  <RoomCodeDisplay code={roomCode} />
                </motion.div>
              ) : (
                /* JOIN: carved input for entering the code */
                <motion.div
                  key="room-code-input"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: revealTrans }}
                  exit={{ opacity: 0, y: -4, transition: transitionVanish }}
                >
                  <CarvedInput
                    id={codeInputId}
                    label="Room code"
                    value={codeInput}
                    onChange={handleCodeInputChange}
                    type="text"
                    inputMode="text"
                    maxLength={MAX_CODE_INPUT_LENGTH}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={isLoading}
                    error={codeError}
                    hint={
                      !codeError && !codeInput
                        ? 'Your partner will share this with you'
                        : null
                    }
                    aria-required="true"
                    aria-describedby={codeError ? `${codeInputId}-error` : undefined}
                    className="font-mono tracking-[0.2em]"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Network / form-level error */}
            <AnimatePresence>
              {error && <FormError message={error} />}
            </AnimatePresence>
          </motion.div>

          {/* ── PRIMARY ACTION ─────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.7 }}
          >
            <PrimaryAction
              isLoading={isLoading}
              isDisabled={!canSubmit}
              onClick={handleSubmit}
              fullWidth
              aria-label={isCreate ? 'Create room and enter' : 'Join room and enter'}
            >
              {isLoading
                ? null   // loader takes over
                : isCreate
                  ? 'Create Room'
                  : 'Enter Room'
              }
            </PrimaryAction>
          </motion.div>

          {/* ── DISCLOSURE ─────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.85 }}
          >
            <DisclosureLine />
          </motion.div>

        </div>

        {/* Subtle bottom-edge shadow — the card pressing into its surface */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-surface-edge/50 to-transparent" />
      </motion.div>
    </motion.div>
  )
}