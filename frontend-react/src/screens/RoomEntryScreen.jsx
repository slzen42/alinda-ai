/**
 * src/screens/RoomEntryScreen.jsx
 *
 * The Threshold — the first surface a user encounters.
 * Desktop-first design with responsive shrinking for mobile.
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
  import { useThemeToggle }         from 'hooks/useTheme'
  import { api }                    from 'lib/api'
  import { soundManager }           from 'lib/soundManager'
  import {
    transitionStone,
    transitionStoneReduced,
    transitionReveal,
    transitionVanish,
  } from 'animations/motionTokens'
  import {
    pageVariants,
    pageVariantsReduced,
    inscriptionVariants,
    inscriptionVariantsReduced,
  } from 'animations/transitions'
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const MODE = Object.freeze({ CREATE: 'create', JOIN: 'join' })
  const MAX_NAME_LENGTH       = 40
  const ROOM_CODE_LENGTH      = 6
  const CODE_ALPHABET         = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  
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
  // SEGMENTED CONTROL
  // ─────────────────────────────────────────────────────────────────────────────
  
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
                'relative flex-1 py-3 text-sm tracking-[0.08em] font-sans',
                'no-tap-flash outline-none rounded-lg transition-colors duration-300',
                'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-1',
                isActive
                  ? 'text-text-primary z-10'
                  : 'text-text-muted hover:text-text-secondary',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="segment-pill"
                  className="absolute inset-0 rounded-lg bg-surface-raised border border-surface-edge"
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
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CARVED INPUT
  // Clean, reliable input — static label above, placeholder inside
  // ─────────────────────────────────────────────────────────────────────────────
  
  const CarvedInput = React.forwardRef(function CarvedInput(
    {
      id,
      label,
      value,
      onChange,
      type          = 'text',
      placeholder   = '',
      maxLength,
      autoComplete  = 'off',
      autoCapitalize = 'off',
      spellCheck    = false,
      inputMode,
      hint,
      error,
      disabled,
      className,
      ...rest
    },
    ref
  ) {
    const [isFocused, setIsFocused] = useState(false)
  
    return (
      <div className="w-full space-y-1.5">
        {/* Static label above the field */}
        <label
          htmlFor={id}
          className="
            block text-xs font-sans
            tracking-[0.12em] uppercase
            text-text-muted
            ml-1
          "
        >
          {label}
        </label>
  
        {/* The field container — the "carved" look */}
        <div className={clsx(
          'relative w-full rounded-xl overflow-hidden',
          'transition-all duration-300',
          'shadow-stone-inset bg-surface-base',
          'border',
          error
            ? 'border-terracotta'
            : isFocused
              ? 'border-text-secondary'
              : 'border-surface-edge',
        )}>
          <input
            ref={ref}
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
            placeholder={placeholder}
            className={clsx(
              'w-full appearance-none',
              'bg-transparent',       // transparent bg
              'px-4 py-3.5',
              'text-text-primary font-sans text-base',
              'tracking-[0.04em]',    // slightly open letter spacing
              'placeholder:text-text-muted placeholder:tracking-[0.04em]',
              'outline-none border-none ring-0',
              'selection:bg-bronze/20',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              // Autofill kill — prevents browser-injected yellow/white backgrounds
              '[&:-webkit-autofill]:shadow-[0_0_0_1000px_var(--surface-base)_inset]',
              '[&:-webkit-autofill]:[--webkit-text-fill-color:var(--text-primary)]',
              className,
            )}
            {...rest}
          />
        </div>
  
        {/* Hint or error */}
        <AnimatePresence mode="wait">
          {(hint || error) && (
            <motion.p
              key={error ? 'error' : 'hint'}
              className={clsx(
                'ml-1 text-xs font-sans leading-relaxed',
                error ? 'text-terracotta' : 'text-text-muted'
              )}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {error || hint}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    )
  })
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ROOM CODE DISPLAY
  // ─────────────────────────────────────────────────────────────────────────────
  
  function RoomCodeDisplay({ code }) {
    const [copied, setCopied]  = useState(false)
    const timerRef             = useRef(null)
  
    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 2000)
      } catch {
        const el = document.getElementById('rcd')
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
        className="w-full rounded-xl border border-surface-edge bg-surface-base shadow-stone-inset"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={transitionReveal}
      >
        <div className="px-4 pt-3 pb-0.5">
          <p className="text-[10px] font-sans text-text-muted tracking-[0.14em] uppercase">
            Room code — share this with your partner
          </p>
        </div>
        <div className="flex items-center gap-3 px-4 pb-3.5">
          <p
            id="rcd"
            className="
              flex-1 font-mono text-2xl tracking-[0.35em]
              text-text-primary font-light select-all
            "
            aria-label={`Room code: ${code.split('').join(' ')}`}
          >
            {code}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className={clsx(
              'no-tap-flash shrink-0',
              'text-xs font-sans tracking-[0.06em] rounded-lg px-3 py-1.5',
              'transition-all duration-300 outline-none',
              'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-1',
              copied
                ? 'text-bronze-strong bg-bronze-soft'
                : 'text-text-muted bg-surface-edge/50 hover:text-text-primary hover:bg-surface-raised',
            )}
            aria-label={copied ? 'Copied' : 'Copy room code'}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={copied ? 'copied' : 'copy'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {copied ? 'Copied' : 'Copy'}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </motion.div>
    )
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FORM ERROR
  // ─────────────────────────────────────────────────────────────────────────────
  
  function FormError({ message }) {
    if (!message) return null
    return (
      <motion.div
        className="w-full rounded-xl px-4 py-3 bg-terracotta-soft border border-terracotta/30"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={transitionReveal}
      >
        <p className="text-sm font-sans text-terracotta-strong leading-relaxed">
          {message}
        </p>
      </motion.div>
    )
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // THEME TOGGLE — larger, more visible, with labelled ring
  // ─────────────────────────────────────────────────────────────────────────────
  
  function ThemeToggle() {
    const { isDark, toggleMode } = useThemeToggle()
    const [showLabel, setShowLabel] = useState(false)
  
    return (
      <div className="relative group">
        <button
          type="button"
          onClick={toggleMode}
          onMouseEnter={() => setShowLabel(true)}
          onMouseLeave={() => setShowLabel(false)}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="
            no-tap-flash
            w-10 h-10 flex items-center justify-center
            rounded-full
            bg-surface-raised/80 backdrop-blur-sm
            border border-surface-edge
            text-text-secondary hover:text-text-primary
            transition-all duration-300
            outline-none focus-visible:ring-2 focus-visible:ring-bronze
            hover:bg-surface-overlay hover:border-text-muted
            hover:scale-105 active:scale-95
          "
        >
          {isDark ? (
            /* Sun — switch to Olympian */
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="9" y1="1.5" x2="9" y2="3"     stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="9" y1="15"  x2="9" y2="16.5"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="1.5" y1="9" x2="3" y2="9"      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="15" y1="9"  x2="16.5" y2="9"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="3.87" y1="3.87" x2="4.94" y2="4.94" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="13.06" y1="13.06" x2="14.13" y2="14.13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="3.87" y1="14.13" x2="4.94" y2="13.06"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="13.06" y1="4.94" x2="14.13" y2="3.87"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            /* Moon — switch to Titan */
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M13 9.5A6 6 0 0 1 6.5 3a6.003 6.003 0 0 0 7 7z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
  
        {/* Tooltip */}
        <AnimatePresence>
          {showLabel && (
            <motion.div
              className="
                absolute right-12 top-1/2 -translate-y-1/2
                bg-surface-overlay border border-surface-edge rounded-lg
                px-2.5 py-1.5 whitespace-nowrap
                text-xs font-sans text-text-secondary tracking-wide
                pointer-events-none
              "
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              transition={{ duration: 0.15 }}
            >
              {isDark ? 'Light mode' : 'Dark mode'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN COMPONENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  export default function RoomEntryScreen() {
    const prefersReduced = useReducedMotion()
    const nameInputId    = useId()
    const codeInputId    = useId()
    const nameRef        = useRef(null)
  
    const [mode,       setMode]       = useState(MODE.CREATE)
    const [name,       setName]       = useState('')
    const [codeInput,  setCodeInput]  = useState('')
    const [roomCode,   setRoomCode]   = useState(() => generateRoomCode())
    const [isLoading,  setIsLoading]  = useState(false)
    const [error,      setError]      = useState(null)
    const [nameError,  setNameError]  = useState(null)
    const [codeError,  setCodeError]  = useState(null)
  
    const initSession = useSessionStore(s => s.initSession)
    const setMyRole   = useSessionStore(s => s.setMyRole)
  
    const isCreate    = mode === MODE.CREATE
    const trimmedName = name.trim()
    const trimmedCode = isCreate ? roomCode : codeInput.trim().toUpperCase()
    const canSubmit   = trimmedName.length >= 1 && (isCreate || trimmedCode.length === ROOM_CODE_LENGTH)
  
    // Regenerate code when switching to Create
    useEffect(() => {
      if (isCreate) setRoomCode(generateRoomCode())
      setError(null); setNameError(null); setCodeError(null)
      setCodeInput('')
    }, [mode, isCreate])
  
    // Focus name input on mount
    useEffect(() => {
      setTimeout(() => nameRef.current?.focus(), 300)
    }, [])
  
    const handleNameChange = useCallback((e) => {
      setName(e.target.value.slice(0, MAX_NAME_LENGTH))
      if (nameError) setNameError(null)
      if (error)     setError(null)
    }, [nameError, error])
  
    const handleCodeChange = useCallback((e) => {
      const cleaned = e.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, ROOM_CODE_LENGTH)
      setCodeInput(cleaned)
      if (codeError) setCodeError(null)
      if (error)     setError(null)
    }, [codeError, error])
  
    const validate = useCallback(() => {
      let valid = true
      if (!trimmedName) {
        setNameError('Please enter your name.')
        valid = false
      }
      if (!isCreate && trimmedCode.length !== ROOM_CODE_LENGTH) {
        setCodeError(`The code is ${ROOM_CODE_LENGTH} characters.`)
        valid = false
      }
      return valid
    }, [trimmedName, trimmedCode, isCreate])
  
    const handleSubmit = useCallback(async () => {
      if (!validate()) return
      setIsLoading(true)
      setError(null)
  
      try {
        if (isCreate) {
          const session = await api.createRoom({ room_id: trimmedCode, name_a: trimmedName })
          initSession(session.room_id, 'a')
          setMyRole('a')
          soundManager.playJoin?.()
        } else {
          const session = await api.joinRoom({ room_id: trimmedCode, name_b: trimmedName })
          initSession(session.room_id, 'b')
          setMyRole('b')
          soundManager.playJoin?.()
        }
      } catch (err) {
        setIsLoading(false)
        const msgs = {
          ROOM_NOT_FOUND: 'That room code wasn\'t found. Please check it with your partner.',
          ROOM_FULL:      'This room already has two partners.',
          SESSION_CLOSED: 'This session has ended. Please create a new room.',
          NETWORK:        'Alinda couldn\'t reach the server. Still trying…',
          TIMEOUT:        'This is taking longer than expected. Please try again.',
        }
        if (err?.type && err.type !== 'DUPLICATE_REQUEST') {
          setError(msgs[err.type] ?? err.userMessage ?? 'Something went wrong.')
        }
      }
    }, [validate, isCreate, trimmedCode, trimmedName, initSession, setMyRole])
  
    const handleKeyDown = useCallback((e) => {
      if (e.key === 'Enter' && canSubmit && !isLoading) handleSubmit()
    }, [canSubmit, isLoading, handleSubmit])
  
    const containerVars   = prefersReduced ? pageVariantsReduced       : pageVariants
    const inscriptionVars = prefersReduced ? inscriptionVariantsReduced : inscriptionVariants
    const revealTrans     = prefersReduced ? { duration: 0.1 }          : transitionReveal
  
    return (
      <motion.div
        className="
          fixed inset-0
          flex items-center justify-center
          px-4 py-8 sm:px-8
        "
        variants={containerVars}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {/* Theme toggle — top right, always visible */}
        <div className="absolute top-5 right-5 sm:top-6 sm:right-6 z-10">
          <ThemeToggle />
        </div>
  
        {/* ─── THE CARD ──────────────────────────────────────────────────── */}
        <motion.div
          className="
            relative w-full
            max-w-[420px] sm:max-w-[480px] lg:max-w-[520px]
            rounded-3xl overflow-hidden
            border border-surface-edge
            frosted-overlay
          "
          style={{
            boxShadow: [
              'inset 0 1px 0 0 rgba(255,255,255,0.06)',
              '0 32px 80px -16px rgba(42,38,33,0.22)',
              '0 8px 24px -8px rgba(42,38,33,0.14)',
            ].join(', '),
          }}
          onKeyDown={handleKeyDown}
        >
          {/* Top highlight */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-surface-edge to-transparent" />
  
          <div className="px-8 py-10 sm:px-10 sm:py-12 flex flex-col gap-7">
  
            {/* ── WORDMARK ────────────────────────────────────────────────── */}
            <div className="flex flex-col items-center gap-3">
              <motion.h1
                className="
                  font-serif font-light
                  text-[2.75rem] sm:text-[3.25rem]
                  tracking-[0.22em]
                  text-text-primary select-none
                "
                variants={inscriptionVars}
                initial="hidden"
                animate="visible"
              >
                Alinda
              </motion.h1>
  
              {/* Meander rule */}
              <motion.div
                className="flex items-center gap-4 w-full justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...revealTrans, delay: 0.3 }}
              >
                <div className="h-px flex-1 max-w-[60px] bg-surface-edge" />
                <svg
                  width="32" height="8" viewBox="0 0 32 8"
                  fill="none" aria-hidden="true"
                  className="text-surface-edge"
                >
                  <path
                  d="M0 7h6V1h20v6h6"
                  stroke="currentColor" strokeWidth="1" strokeLinecap="square" fill="none"
                />
              </svg>
              <div className="h-px flex-1 max-w-[60px] bg-surface-edge" />
            </motion.div>

            <motion.p
              className="font-sans text-sm text-text-secondary tracking-[0.06em] text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...revealTrans, delay: 0.45 }}
            >
              A private space for two.
            </motion.p>
          </div>

          {/* ── SEGMENTED CONTROL ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.55 }}
          >
            <SegmentedControl value={mode} onChange={setMode} disabled={isLoading} />
          </motion.div>

          {/* ── FORM ────────────────────────────────────────────────────── */}
          <motion.div
            className="flex flex-col gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.65 }}
          >
            {/* Name */}
            <CarvedInput
              ref={nameRef}
              id={nameInputId}
              label="Your name"
              value={name}
              onChange={handleNameChange}
              type="text"
              placeholder="Enter your name"
              maxLength={MAX_NAME_LENGTH}
              autoComplete="given-name"
              autoCapitalize="words"
              spellCheck={false}
              disabled={isLoading}
              error={nameError}
              aria-required="true"
            />

            {/* Code field — different for create vs join */}
            <AnimatePresence mode="wait">
              {isCreate ? (
                <motion.div
                  key="code-display"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: revealTrans }}
                  exit={{ opacity: 0, y: -4, transition: transitionVanish }}
                >
                  <RoomCodeDisplay code={roomCode} />
                </motion.div>
              ) : (
                <motion.div
                  key="code-input"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: revealTrans }}
                  exit={{ opacity: 0, y: -4, transition: transitionVanish }}
                >
                  <CarvedInput
                    id={codeInputId}
                    label="Room code"
                    value={codeInput}
                    onChange={handleCodeChange}
                    type="text"
                    inputMode="text"
                    placeholder="Enter 6-character code"
                    maxLength={ROOM_CODE_LENGTH}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={isLoading}
                    error={codeError}
                    hint={!codeError && !codeInput ? 'Your partner will share this with you' : null}
                    aria-required="true"
                    className="font-mono tracking-[0.25em] uppercase"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Network error */}
            <AnimatePresence>
              {error && <FormError message={error} />}
            </AnimatePresence>
          </motion.div>

          {/* ── PRIMARY ACTION ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.75 }}
          >
            <Button
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              isDisabled={!canSubmit}
              onClick={handleSubmit}
            >
              {isCreate ? 'Create Room' : 'Enter Room'}
            </Button>
          </motion.div>

          {/* ── DISCLOSURE ─────────────────────────────────────────────── */}
          <motion.p
            className="text-center text-xs text-text-muted font-sans leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...revealTrans, delay: 0.88 }}
          >
            Alinda is an AI guide, not a licensed therapist.{' '}
            <span className="opacity-60">Your conversation is private.</span>
          </motion.p>

        </div>

        {/* Bottom edge */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-surface-edge/50 to-transparent" />
      </motion.div>
    </motion.div>
  )
}