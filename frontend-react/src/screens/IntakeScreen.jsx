/**
 * src/screens/IntakeScreen.jsx
 *
 * The Five Stations — a progressive, one-question-at-a-time intake experience.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY: PROGRESSIVE DISCLOSURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Scrolling intake forms are anxiety generators. The user sees all their
 * unanswered questions at once and enters a state of anticipatory dread.
 *
 * This screen shows exactly one question at a time. The user's entire
 * cognitive load at any moment is: "answer this one thing."
 *
 * The spatial metaphor: each "Next" moves the user forward through a
 * hallway toward the therapy room. Questions slide left on exit, enter
 * from the right. Forward motion is embodied, not abstract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIVE STATIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 0. SOMATIC CHECK-IN
 *    "How much tension are you carrying into this room?"
 *    A carved slider — bronze at calm, terracotta at overwhelmed.
 *    Haptic pulses as the weight increases.
 *
 * 1. NARRATIVE ANCHOR
 *    "From your perspective, what brings you both here today?"
 *    A deep stone-inset textarea. The room goes quiet while typing.
 *
 * 2. INTENT CARDS
 *    "What do you need most from this session?"
 *    Physical card tiles with an optional elaboration field.
 *
 * 3. ALINDA'S STYLE (maps to session_style + the four paintings)
 *    "How would you like Alinda to guide you today?"
 *    The four painting modes as beautifully described cards.
 *
 * 4. CLOSING HOPE
 *    "What would make this session feel like it was worth it?"
 *    A small, open-ended text input. Ends on forward motion, not procedure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BACKEND CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * api.submitIntake({
 *   room_id:       string,
 *   role:          'a' | 'b',
 *   intake_text:   string,   ← constructed from all five stations
 *   session_style: string,   ← one of: gentle | direct | practical | balanced
 * })
 *
 * The intake_text is a structured narrative combining all station answers.
 * The backend's intake_analyzer.py reads this as free text and extracts
 * psychological dimensions from it — it is designed for prose, not JSON.
 */

import React, {
    useState,
    useCallback,
    useRef,
    useEffect,
    useId,
  } from 'react'
  import {
    motion,
    AnimatePresence,
    useReducedMotion,
    useSpring,
    useTransform,
  } from 'framer-motion'
  import { clsx }           from 'clsx'
  import Button              from 'components/ui/Button'
  import { useSessionStore } from 'store/sessionStore'
  import { api }             from 'lib/api'
  import { soundManager }    from 'lib/soundManager'
  import {
    transitionStone,
    transitionStoneReduced,
    transitionReveal,
    transitionRevealReduced,
    transitionVanish,
    staggerStandard,
  } from 'animations/motionTokens'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const TOTAL_STATIONS = 5
  
  // Minimum characters required to advance from Station 1 (Narrative)
  const NARRATIVE_MIN_CHARS = 20
  
  // Character limit and when to show the counter
  const NARRATIVE_MAX_CHARS  = 2000
  const NARRATIVE_SHOW_COUNT = 200
  
  // How long to wait after typing stops before "listening mode" fades back
  const LISTENING_RETURN_DELAY_MS = 900
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INTAKE CONTENT DEFINITIONS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const INTENT_OPTIONS = [
    {
      id:          'heard',
      headline:    'To be heard',
      description: 'I need to feel understood before anything else.',
      icon:        '◎',
    },
    {
      id:          'solve',
      headline:    'To solve something',
      description: 'There is a specific problem we need to work through.',
      icon:        '◈',
    },
    {
      id:          'deescalate',
      headline:    'To lower the temperature',
      description: 'Things have been heated. I need calm before clarity.',
      icon:        '◇',
    },
    {
      id:          'understand',
      headline:    'To understand',
      description: 'I want to see my partner\'s perspective more clearly.',
      icon:        '◉',
    },
    {
      id:          'other',
      headline:    'Something else',
      description: 'I\'ll describe it in my own words.',
      icon:        '○',
    },
  ]
  
  const STYLE_OPTIONS = [
    {
      id:          'gentle',
      title:       'Gentle',
      subtitle:    'Soft and unhurried',
      description: 'Prioritise emotional validation. Move at whatever pace feels right.',
      previewColors: ['#5FA8C3', '#D08870', '#82AF8C'],   // Frankenthaler
    },
    {
      id:          'balanced',
      title:       'Balanced',
      subtitle:    'Open and complex',
      description: 'Equal parts validation and structure. Hold space for everything.',
      previewColors: ['#D7D7D2', '#191612', '#D29B2D'],   // Pollock
    },
    {
      id:          'direct',
      title:       'Direct',
      subtitle:    'Clear and precise',
      description: 'Keep us honest and on track. We can handle directness.',
      previewColors: ['#AFC6DA', '#F5F0CD', '#D7B250'],   // Teh-Chun
    },
    {
      id:          'practical',
      title:       'Practical',
      subtitle:    'Forward-moving',
      description: 'Challenge us, point to patterns, help us take concrete steps.',
      previewColors: ['#AFA89E', '#DCB9A8', '#A35A4B'],   // Twombly
    },
  ]
  
  // Labels for the tension slider endpoints
  const SLIDER_LABELS = { left: 'Calm', right: 'Overwhelmed' }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HAPTIC UTILITY
  // ─────────────────────────────────────────────────────────────────────────────
  
  function haptic(ms = 8) {
    try { navigator.vibrate?.(ms) } catch {}
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PROGRESS DOTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  function ProgressDots({ current, total, isListening }) {
    return (
      <motion.div
        className="flex items-center justify-center gap-2.5"
        animate={{ opacity: isListening ? 0.2 : 1 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const isPast    = i < current
          const isCurrent = i === current
  
          return (
            <motion.div
              key={i}
              className="rounded-full transition-all duration-500"
              animate={{
                width:           isCurrent ? 20 : 6,
                height:          6,
                backgroundColor: isPast || isCurrent
                  ? 'var(--accent-bronze)'
                  : 'var(--surface-edge)',
                opacity:         isPast ? 0.6 : 1,
              }}
              transition={{ type: 'tween', ease: [0.20, 0.00, 0.00, 1.00], duration: 0.35 }}
              aria-hidden="true"
            />
          )
        })}
      </motion.div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATION WRAPPER
  // Handles the directional slide transition between stations
  // ─────────────────────────────────────────────────────────────────────────────
  
  const stationVariants = {
    enter: (direction) => ({
      x:       direction > 0 ? 48 : -48,
      opacity: 0,
    }),
    center: {
      x:       0,
      opacity: 1,
    },
    exit: (direction) => ({
      x:       direction > 0 ? -48 : 48,
      opacity: 0,
    }),
  }
  
  const stationVariantsReduced = {
    enter:  { opacity: 0 },
    center: { opacity: 1 },
    exit:   { opacity: 0 },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATION 0: SOMATIC SLIDER
  // ─────────────────────────────────────────────────────────────────────────────
  
  function TensionSlider({ value, onChange }) {
    const trackRef      = useRef(null)
    const isDragging    = useRef(false)
    const lastHapticVal = useRef(0)
  
    // Convert 0–100 value to a colour between bronze and terracotta
    // Bronze:     rgb(122, 140, 110)
    // Terracotta: rgb(193, 122, 91)
    const trackColor = `linear-gradient(to right,
      rgb(122,140,110) 0%,
      rgb(193,122,91) ${value}%,
      var(--surface-edge) ${value}%
    )`
  
    // Haptic pulse every 10 units of tension change
    useEffect(() => {
      const bucket = Math.floor(value / 10)
      if (bucket !== Math.floor(lastHapticVal.current / 10)) {
        haptic(6)
        lastHapticVal.current = value
      }
    }, [value])
  
    const getValueFromEvent = useCallback((e) => {
      const track = trackRef.current
      if (!track) return
      const rect    = track.getBoundingClientRect()
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const pct     = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      onChange(Math.round(pct * 100))
    }, [onChange])
  
    const handlePointerDown = useCallback((e) => {
      isDragging.current = true
      getValueFromEvent(e)
      e.currentTarget.setPointerCapture(e.pointerId)
    }, [getValueFromEvent])
  
    const handlePointerMove = useCallback((e) => {
      if (!isDragging.current) return
      getValueFromEvent(e)
    }, [getValueFromEvent])
  
    const handlePointerUp = useCallback(() => {
      isDragging.current = false
    }, [])
  
    // Keyboard support
    const handleKeyDown = useCallback((e) => {
      let next = value
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  next = Math.max(0,   value - 5)
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')    next = Math.min(100, value + 5)
      if (e.key === 'Home')  next = 0
      if (e.key === 'End')   next = 100
      if (next !== value) { onChange(next); haptic(6) }
    }, [value, onChange])
  
    const tensionLabel =
      value <= 20  ? 'Very calm'      :
      value <= 40  ? 'A little tense' :
      value <= 60  ? 'Moderately tense' :
      value <= 80  ? 'Quite tense'    :
                     'Very overwhelmed'
  
    return (
      <div className="w-full space-y-4">
        {/* Track */}
        <div
          ref={trackRef}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={tensionLabel}
          aria-label="Tension level"
          tabIndex={0}
          className="
            relative w-full h-3 rounded-full cursor-pointer
            shadow-stone-inset
            outline-none
            focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2
            focus-visible:ring-offset-surface-base
          "
          style={{ background: trackColor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          {/* Thumb */}
          <motion.div
            className="
              absolute top-1/2 -translate-y-1/2 -translate-x-1/2
              w-6 h-6 rounded-full
              bg-surface-raised border-2 border-surface-edge
              shadow-ambient
            "
            style={{ left: `${value}%` }}
            animate={{ scale: isDragging.current ? 1.15 : 1 }}
            transition={{ type: 'tween', duration: 0.1 }}
          />
        </div>
  
        {/* Labels */}
        <div className="flex justify-between">
          <span className="text-xs font-sans text-text-muted">{SLIDER_LABELS.left}</span>
          <motion.span
            key={tensionLabel}
            className="text-xs font-sans text-text-secondary"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {tensionLabel}
          </motion.span>
          <span className="text-xs font-sans text-text-muted">{SLIDER_LABELS.right}</span>
        </div>
      </div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATION 1: NARRATIVE TEXTAREA
  // ─────────────────────────────────────────────────────────────────────────────
  
  function NarrativeTextarea({ value, onChange, onListeningChange }) {
    const textareaRef   = useRef(null)
    const timerRef      = useRef(null)
    const [isListening, setIsListening] = useState(false)
    const textareaId    = useId()
  
    // Auto-expand the textarea height
    const autoExpand = useCallback(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }, [])
  
    const handleChange = useCallback((e) => {
      onChange(e.target.value.slice(0, NARRATIVE_MAX_CHARS))
      autoExpand()
  
      // Enter "listening mode" — the room goes quiet
      if (!isListening) {
        setIsListening(true)
        onListeningChange?.(true)
      }
  
      // Reset the return timer
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setIsListening(false)
        onListeningChange?.(false)
      }, LISTENING_RETURN_DELAY_MS)
    }, [onChange, autoExpand, isListening, onListeningChange])
  
    useEffect(() => {
      // Focus on mount
      setTimeout(() => textareaRef.current?.focus(), 100)
      return () => clearTimeout(timerRef.current)
    }, [])
  
    const showCounter = value.length >= NARRATIVE_SHOW_COUNT
    const remaining   = NARRATIVE_MAX_CHARS - value.length
  
    return (
      <div className="w-full relative">
        <label
          htmlFor={textareaId}
          className="sr-only"
        >
          What brings you both here today
        </label>
  
        <div className="
          relative w-full rounded-2xl overflow-hidden
          shadow-stone-inset-deep bg-surface-base
          border border-surface-edge
          focus-within:border-text-muted
          transition-colors duration-300
        ">
          <textarea
            id={textareaId}
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            placeholder="Take your time. There is no right or wrong way to answer this."
            maxLength={NARRATIVE_MAX_CHARS}
            rows={4}
            className="
              w-full bg-transparent resize-none
              px-5 py-4
              text-text-primary font-sans text-base leading-relaxed
              placeholder:text-text-muted
              outline-none border-none
              selection:bg-bronze/20
              min-h-[120px]
            "
            style={{ height: 'auto' }}
          />
  
          {/* Character counter — only after threshold */}
          <AnimatePresence>
            {showCounter && (
              <motion.div
                className="px-4 pb-3 flex justify-end"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className={clsx(
                  'text-xs font-sans',
                  remaining < 100 ? 'text-terracotta' : 'text-text-muted'
                )}>
                  {remaining} remaining
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATION 2: INTENT CARDS
  // ─────────────────────────────────────────────────────────────────────────────
  
  function IntentCards({ selectedId, elaboration, onSelectId, onElaborationChange }) {
    const elabId   = useId()
    const elabRef  = useRef(null)
  
    // Focus the elaboration field when a card is selected
    useEffect(() => {
      if (selectedId && elabRef.current) {
        setTimeout(() => elabRef.current?.focus(), 200)
      }
    }, [selectedId])
  
    return (
      <div className="w-full space-y-3">
        {INTENT_OPTIONS.map((opt) => {
          const isSelected = selectedId === opt.id
          return (
            <motion.button
              key={opt.id}
              type="button"
              onClick={() => onSelectId(isSelected ? null : opt.id)}
              className={clsx(
                'w-full text-left rounded-2xl px-5 py-4',
                'border transition-colors duration-300',
                'no-tap-flash outline-none',
                'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-1',
                isSelected
                  ? 'border-bronze bg-bronze-soft'
                  : 'border-surface-edge bg-surface-base hover:border-text-muted',
              )}
              whileTap={{
                scale:      0.985,
                transition: { type: 'tween', ease: [0.20,0.00,0.00,1.00], duration: 0.15 }
              }}
              animate={{
                opacity: !selectedId || isSelected ? 1 : 0.45,
                scale:   isSelected ? 1.00 : !selectedId ? 1 : 0.99,
              }}
              transition={{ type: 'tween', duration: 0.25 }}
              aria-pressed={isSelected}
            >
              <div className="flex items-start gap-4">
                {/* Icon */}
                <span
                  className={clsx(
                    'text-xl mt-0.5 transition-colors duration-300 select-none',
                    isSelected ? 'text-bronze-strong' : 'text-text-muted'
                  )}
                  aria-hidden="true"
                >
                  {opt.icon}
                </span>
  
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    'font-sans font-medium text-base leading-snug',
                    isSelected ? 'text-text-primary' : 'text-text-secondary'
                  )}>
                    {opt.headline}
                  </p>
                  <p className="font-sans text-sm text-text-muted leading-relaxed mt-0.5">
                    {opt.description}
                  </p>
                </div>
  
                {/* Selection indicator */}
                <motion.div
                  className={clsx(
                    'w-4 h-4 rounded-full border mt-1 flex-shrink-0 transition-colors duration-300',
                    isSelected
                      ? 'bg-bronze border-bronze'
                      : 'border-surface-edge bg-transparent'
                  )}
                  animate={{ scale: isSelected ? [1, 1.2, 1] : 1 }}
                  transition={{ duration: 0.25 }}
                />
              </div>
            </motion.button>
          )
        })}
  
        {/* Optional elaboration field */}
        <AnimatePresence>
          {selectedId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'tween', ease: [0.20,0.00,0.00,1.00], duration: 0.35 }}
              className="overflow-hidden"
            >
              <div className="pt-1">
                <label
                  htmlFor={elabId}
                  className="block text-xs font-sans text-text-muted mb-2 ml-1"
                >
                  Would you like to say more? (optional)
                </label>
                <div className="
                  rounded-2xl overflow-hidden
                  border border-surface-edge bg-surface-base shadow-stone-inset
                  focus-within:border-text-muted transition-colors duration-300
                ">
                  <textarea
                    id={elabId}
                    ref={elabRef}
                    value={elaboration}
                    onChange={(e) => onElaborationChange(e.target.value.slice(0, 400))}
                    placeholder="Add any details that feel important…"
                    rows={2}
                    className="
                      w-full bg-transparent resize-none
                      px-4 py-3
                      text-text-primary font-sans text-sm leading-relaxed
                      placeholder:text-text-muted
                      outline-none border-none
                    "
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }
  
  

  // ─────────────────────────────────────────────────────────────────────────────
  // STATION 3: STYLE SELECTION
  // ─────────────────────────────────────────────────────────────────────────────

function StyleSelector({ selectedId, onSelect }) {
    return (
      <div className="w-full grid grid-cols-2 gap-3">
        {STYLE_OPTIONS.map((opt) => {
          const isSelected = selectedId === opt.id
          const [c1, c2, c3] = opt.previewColors
  
          return (
            <motion.button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={clsx(
                'relative rounded-2xl overflow-hidden',
                'text-left p-4',
                'border transition-colors duration-300',
                'no-tap-flash outline-none',
                'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-1',
                isSelected
                  ? 'border-bronze'
                  : 'border-surface-edge hover:border-text-muted',
              )}
              whileTap={{
                scale: 0.97,
                transition: { type: 'tween', ease: [0.20,0.00,0.00,1.00], duration: 0.15 }
              }}
              animate={{
                opacity: !selectedId || isSelected ? 1 : 0.5,
              }}
              transition={{ type: 'tween', duration: 0.25 }}
              aria-pressed={isSelected}
            >
              {/* Colour preview — three small dots from the painting's palette */}
              <div className="flex gap-1.5 mb-3" aria-hidden="true">
                {[c1, c2, c3].map((colour, i) => (
                  <motion.div
                    key={i}
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: colour, opacity: 0.85 }}
                    animate={{ scale: isSelected ? [1, 1.1, 1] : 1 }}
                    transition={{ delay: i * 0.04, duration: 0.3 }}
                  />
                ))}
              </div>
  
              <p className={clsx(
                'font-serif text-base font-light leading-tight',
                isSelected ? 'text-text-primary' : 'text-text-secondary'
              )}>
                {opt.title}
              </p>
              <p className="font-sans text-xs text-text-muted mt-0.5 leading-snug">
                {opt.subtitle}
              </p>
  
              {/* Description on select */}
              <AnimatePresence>
                {isSelected && (
                  <motion.p
                    className="font-sans text-xs text-text-muted mt-2 leading-relaxed"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {opt.description}
                  </motion.p>
                )}
              </AnimatePresence>
  
              {/* Selection ring */}
              {isSelected && (
                <motion.div
                  className="absolute inset-0 rounded-2xl border-2 border-bronze pointer-events-none"
                  layoutId="style-ring"
                  transition={{ type: 'tween', ease: [0.20,0.00,0.00,1.00], duration: 0.28 }}
                />
              )}
            </motion.button>
          )
        })}
      </div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATION 4: CLOSING HOPE (the final question)
  // ─────────────────────────────────────────────────────────────────────────────
  
  function ClosingHopeInput({ value, onChange }) {
    const inputId  = useId()
    const inputRef = useRef(null)
  
    useEffect(() => {
      setTimeout(() => inputRef.current?.focus(), 100)
    }, [])
  
    return (
      <div className="w-full">
        <label htmlFor={inputId} className="sr-only">
          What would make this session feel worth it
        </label>
        <div className="
          rounded-2xl overflow-hidden
          border border-surface-edge bg-surface-base shadow-stone-inset
          focus-within:border-text-muted transition-colors duration-300
        ">
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, 200))}
            placeholder="Even a small shift would feel meaningful…"
            className="
              w-full bg-transparent
              px-5 py-4
              text-text-primary font-sans text-base
              placeholder:text-text-muted
              outline-none border-none
            "
          />
        </div>
        <p className="mt-2 ml-1 text-xs font-sans text-text-muted">
          Optional. There is no wrong answer here.
        </p>
      </div>
    )
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INTAKE TEXT SERIALISER
  //
  // Combines all five station answers into a structured narrative string
  // that intake_analyzer.py can read as coherent clinical prose.
  // The format uses section headers that the LLM can pattern-match on,
  // while remaining legible as human writing.
  // ─────────────────────────────────────────────────────────────────────────────
  
  function buildIntakeText({ tension, narrative, intentId, intentLabel, elaboration, style, hope }) {
    const tensionDesc =
      tension <= 20  ? 'very little tension or anxiety' :
      tension <= 40  ? 'a mild level of tension'        :
      tension <= 60  ? 'a moderate level of tension'    :
      tension <= 80  ? 'significant tension'             :
                       'a great deal of tension and overwhelm'
  
    const sections = [
      `EMOTIONAL STATE ON ARRIVAL:\nI am carrying ${tensionDesc} (${tension}/100) into this session.`,
      `WHAT BRINGS ME HERE:\n${narrative.trim() || 'Not specified.'}`,
      `WHAT I NEED MOST:\n${intentLabel}${elaboration.trim() ? '\n\n' + elaboration.trim() : ''}`,
      `PREFERRED SESSION APPROACH:\n${style}`,
      hope.trim()
        ? `WHAT WOULD MAKE THIS WORTHWHILE:\n${hope.trim()}`
        : null,
    ].filter(Boolean)
  
    return sections.join('\n\n---\n\n')
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATION DEFINITIONS
  // ─────────────────────────────────────────────────────────────────────────────
  
  function getStationConfig(stationIndex) {
    const stations = [
      {
        question: 'How much tension are you carrying into this room?',
        subtext:  'There is no right answer. Just notice what is true for you right now.',
        canAdvance: () => true,   // slider always has a value
      },
      {
        question: 'From your perspective, what brings you both here today?',
        subtext:  'Speak freely. This is only seen by Alinda — not shared with your partner.',
        canAdvance: (state) => state.narrative.length >= NARRATIVE_MIN_CHARS,
      },
      {
        question: 'What do you need most from this session?',
        subtext:  'Select the one that feels closest.',
        canAdvance: (state) => Boolean(state.intentId),
      },
      {
        question: 'How would you like Alinda to guide you?',
        subtext:  'This shapes the room\'s emotional character for you personally.',
        canAdvance: (state) => Boolean(state.style),
      },
      {
        question: 'What would make this session feel like it was worth it?',
        subtext:  'A small, honest answer is better than a perfect one.',
        canAdvance: () => true,   // optional
      },
    ]
    return stations[stationIndex]
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN SCREEN COMPONENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  export default function IntakeScreen() {
    const prefersReduced = useReducedMotion()
  
    // ── Form state ──────────────────────────────────────────────────────────
    const [station,     setStation]     = useState(0)
    const [direction,   setDirection]   = useState(1)   // 1 = forward, -1 = back
    const [isListening, setIsListening] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError,  setSubmitError]  = useState(null)
  
    // Station-specific answers
    const [tension,      setTension]      = useState(30)
    const [narrative,    setNarrative]    = useState('')
    const [intentId,     setIntentId]     = useState(null)
    const [elaboration,  setElaboration]  = useState('')
    const [style,        setStyle]        = useState(null)
    const [hope,         setHope]         = useState('')
  
    // ── Store ──────────────────────────────────────────────────────────────
    const roomId = useSessionStore(s => s.roomId)
    const myRole = useSessionStore(s => s.myRole)
  
    // ── Derived ────────────────────────────────────────────────────────────
    const state = { tension, narrative, intentId, elaboration, style, hope }
    const stationConfig = getStationConfig(station)
    const canAdvance    = stationConfig.canAdvance(state)
    const isLastStation = station === TOTAL_STATIONS - 1
  
    const intentLabel = INTENT_OPTIONS.find(o => o.id === intentId)?.headline ?? ''
  
    // ── Navigation ─────────────────────────────────────────────────────────
    const goNext = useCallback(async () => {
      if (!canAdvance) return
  
      if (!isLastStation) {
        setDirection(1)
        setStation(s => s + 1)
        soundManager.playMessageArrive?.('self')
        return
      }
  
      // Final station — submit
      setIsSubmitting(true)
      setSubmitError(null)
  
      const intakeText = buildIntakeText({
        tension,
        narrative,
        intentId,
        intentLabel,
        elaboration,
        style: style ?? 'balanced',
        hope,
      })
  
      try {
        await api.submitIntake({
          room_id:       roomId,
          role:          myRole,
          intake_text:   intakeText,
          session_style: style ?? 'balanced',
        })
  
        // App.jsx will detect mode change from sessionStore (via WebSocket
        // or polling) and transition automatically.
        soundManager.playIntakeComplete?.()
  
      } catch (err) {
        setIsSubmitting(false)
        setSubmitError(
          err?.type === 'TIMEOUT'
            ? 'This is taking a moment. Please try once more.'
            : err?.userMessage ?? 'Something went wrong. Please try again.'
        )
      }
    }, [
      canAdvance, isLastStation, tension, narrative, intentId,
      intentLabel, elaboration, style, hope, roomId, myRole
    ])
  
    const goBack = useCallback(() => {
      if (station === 0) return
      setDirection(-1)
      setStation(s => s - 1)
    }, [station])
  
    const handleKeyDown = useCallback((e) => {
      if (e.key === 'Enter' && !e.shiftKey && canAdvance && !isSubmitting) {
        // Enter submits on all stations except the textarea (station 1)
        if (station !== 1) goNext()
      }
    }, [canAdvance, isSubmitting, station, goNext])
  
    // ── Variants ───────────────────────────────────────────────────────────
    const vars      = prefersReduced ? stationVariantsReduced : stationVariants
    const stoneTrans = prefersReduced ? transitionStoneReduced : transitionStone
  
    return (
      <motion.div
        className="
          fixed inset-0
          flex items-center justify-center
          p-4 sm:p-8
          overflow-y-auto
        "
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={stoneTrans}
        onKeyDown={handleKeyDown}
      >
        {/* ─────────────────────────────────────────────────────────────────────
            THE FLOATING CARD
            Uses Framer Motion's `layout` so it smoothly resizes between stations
            ───────────────────────────────────────────────────────────────────── */}
        <motion.div
          layout
          className="
            relative w-full max-w-md
            rounded-3xl overflow-hidden
            border border-surface-edge
            frosted-overlay
            my-auto
          "
          style={{
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 24px 64px -12px rgba(42,38,33,0.18)',
          }}
          transition={{
            layout: { type: 'tween', ease: [0.20,0.00,0.00,1.00], duration: 0.45 }
          }}
        >
          {/* Top edge highlight */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-surface-edge to-transparent" />
  
          <div className="px-7 pt-7 pb-8 flex flex-col gap-6">
  
            {/* ── HEADER: wordmark + progress + step counter ──────────────── */}
            <div className="flex flex-col items-center gap-3">
              {/* Miniature wordmark — smaller than entry screen, receded */}
              <motion.p
                className="
                  font-serif font-light text-xl tracking-[0.16em]
                  text-text-muted select-none
                "
                animate={{ opacity: isListening ? 0.2 : 1 }}
                transition={{ duration: 0.6 }}
              >
                Alinda
              </motion.p>
  
              <ProgressDots
                current={station}
                total={TOTAL_STATIONS}
                isListening={isListening}
              />
  
              {/* Step counter */}
              <motion.p
                className="text-xs font-sans text-text-muted tracking-widest uppercase"
                animate={{ opacity: isListening ? 0.15 : 0.6 }}
                transition={{ duration: 0.6 }}
              >
                {station + 1} of {TOTAL_STATIONS}
              </motion.p>
            </div>
  
            {/* ── STATION CONTENT ─────────────────────────────────────────── */}
            <div className="relative overflow-hidden min-h-[80px]">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={station}
                  custom={direction}
                  variants={vars}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    type:     'tween',
                    ease:     [0.25, 0.00, 0.15, 1.00],
                    duration: prefersReduced ? 0.12 : 0.38,
                  }}
                  className="flex flex-col gap-5"
                >
                  {/* Question heading */}
                  <div className="space-y-1.5">
                    <h2 className="
                      font-serif font-light text-2xl leading-snug
                      text-text-primary
                    ">
                      {stationConfig.question}
                    </h2>
                    <p className="font-sans text-sm text-text-muted leading-relaxed">
                      {stationConfig.subtext}
                    </p>
                  </div>
  
                  {/* Station-specific UI */}
                  {station === 0 && (
                    <TensionSlider
                      value={tension}
                      onChange={setTension}
                    />
                  )}
  
                  {station === 1 && (
                    <NarrativeTextarea
                      value={narrative}
                      onChange={setNarrative}
                      onListeningChange={setIsListening}
                    />
                  )}
  
                  {station === 2 && (
                    <IntentCards
                      selectedId={intentId}
                      elaboration={elaboration}
                      onSelectId={setIntentId}
                      onElaborationChange={setElaboration}
                    />
                  )}
  
                  {station === 3 && (
                    <StyleSelector
                      selectedId={style}
                      onSelect={setStyle}
                    />
                  )}
  
                  {station === 4 && (
                    <ClosingHopeInput
                      value={hope}
                      onChange={setHope}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
  
            {/* ── ERROR ──────────────────────────────────────────────────── */}
            <AnimatePresence>
              {submitError && (
                <motion.div
                  className="
                    rounded-xl px-4 py-3
                    bg-terracotta-soft border border-terracotta/30
                  "
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <p className="text-sm font-sans text-terracotta-strong">
                    {submitError}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
  
            {/* ── NAVIGATION ─────────────────────────────────────────────── */}
            <motion.div
              className="flex gap-3 items-center"
              animate={{
                opacity: isListening ? 0.15 : 1,
                y:       isListening ? 4 : 0,
              }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            >
              {/* Back button — invisible on first station */}
              <AnimatePresence>
                {station > 0 && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <button
                      type="button"
                      onClick={goBack}
                      disabled={isSubmitting}
                      className="
                        no-tap-flash w-11 h-11 flex items-center justify-center
                        rounded-xl text-text-muted hover:text-text-primary
                        hover:bg-surface-raised transition-colors duration-300
                        outline-none focus-visible:ring-2 focus-visible:ring-bronze
                        disabled:opacity-40
                      "
                      aria-label="Go back"
                    >
                      {/* Left chevron */}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
  
              {/* Primary action */}
              <div className="flex-1">
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  isLoading={isSubmitting}
                  isDisabled={!canAdvance}
                  onClick={goNext}
                >
                  {isLastStation ? 'Begin Session' : 'Continue'}
                </Button>
              </div>
            </motion.div>
  
            {/* ── PRIVACY NOTE — only on Station 1 (Narrative) ──────────── */}
            <AnimatePresence>
              {station === 1 && (
                <motion.p
                  className="text-center text-xs font-sans text-text-muted/60 -mt-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  Your partner cannot see your answers. Only Alinda reads them.
                </motion.p>
              )}
            </AnimatePresence>
  
          </div>
  
          {/* Bottom edge */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-surface-edge/50 to-transparent" />
        </motion.div>
      </motion.div>
    )
  }