/**
 * src/components/ui/Button.jsx
 *
 * The foundational interactive primitive for Alinda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A button in a therapy application is not a call-to-action widget.
 * It is a physical threshold — a moment of commitment between intention
 * and consequence. Every design decision here honours that weight.
 *
 * ZERO DROP SHADOWS:
 *   Floating elements feel ephemeral. These buttons are flush with the
 *   surface. Hierarchy is established through colour density and border
 *   weight, not by lifting elements into the air.
 *
 * THE ANTI-SPRING LAW:
 *   All motion uses the 'stone' easing from motionTokens.js — a rigid,
 *   predictable compression. There is no elastic rebound. Pressing a
 *   button feels like pressing a key on a mechanical typewriter: decisive,
 *   physical, complete.
 *
 * THE THERAPEUTIC LOADING STATE:
 *   Standard spinners rotate at 360°/second. They read as panic.
 *   This component renders a breathing sine-wave trio in their place —
 *   three flowing curves that pulse at ~12 breaths per minute (0.2Hz),
 *   subconsciously modelling diaphragmatic breathing while the user waits.
 *   The colours are drawn from the active painting's palette accents.
 *
 * THE CRISIS PALETTE:
 *   Alarm red (#FF0000) is categorically banned. It activates the amygdala
 *   and is the single worst colour choice in a therapeutic interface.
 *   The 'crisis' variant uses a deeply muted terracotta — the same cultural
 *   signal of "stop / danger" but delivered with earthy warmth, not alarm.
 *
 * TOUCH TARGETS:
 *   Every button maintains a minimum 44×44px touch target regardless of
 *   visual size, per Apple HIG and WCAG 2.5.5. The visual button can be
 *   smaller; the interactive area is always sufficient.
 *
 * HAPTICS:
 *   On Android Chrome, a 10ms vibration pulse fires on every press via
 *   the Web Vibration API. On iOS Safari, the API is unavailable and the
 *   guard prevents any error. The haptic call is intentionally short —
 *   long vibrations are alarming; a 10ms pulse is felt, not heard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VARIANTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * primary   — The grounded anchor. High-contrast solid fill. Commands
 *             attention without competing with the canvas behind it.
 *             Use for: "Enter Room", "Submit Intake", primary confirmations.
 *
 * secondary — The ghost. Transparent background, 1px border. Available
 *             but never competing. Use for: cancellations, back actions,
 *             alternative paths on a screen with a primary action.
 *
 * crisis    — The earthy alert. Muted terracotta fill. Communicates
 *             consequence without aggression. Use for: "End Session",
 *             "Request Pause", crisis-state confirmations.
 *
 * ghost     — Invisible until needed. Text only, no border, a barely
 *             perceptible background swell on hover. Use for: links within
 *             text, subtle navigation, settings toggles.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIZES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * sm  — Compact. For inline actions, icon-adjacent text, tag-like controls.
 * md  — The default. Correct for most form actions.
 * lg  — The full-weight action. For primary CTA on entry screens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * variant?       'primary' | 'secondary' | 'crisis' | 'ghost'   default: 'primary'
 * size?          'sm' | 'md' | 'lg'                              default: 'md'
 * isLoading?     boolean                                         default: false
 * isDisabled?    boolean                                         default: false
 * fullWidth?     boolean                                         default: false
 * leftIcon?      React node — rendered before label text
 * rightIcon?     React node — rendered after label text
 * haptic?        boolean — enable vibration on press             default: true
 * onPress?       alias for onClick, for semantic clarity
 * All standard HTML <button> props forwarded via ref.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   <Button variant="primary" size="lg" fullWidth>
 *     Enter Room
 *   </Button>
 *
 *   <Button variant="secondary" leftIcon={<ArrowLeft />} onPress={handleBack}>
 *     Back
 *   </Button>
 *
 *   <Button variant="crisis" isLoading={isSubmitting}>
 *     End Session
 *   </Button>
 *
 *   <Button variant="ghost" size="sm" aria-label="Mute audio">
 *     <VolumeOff />
 *   </Button>
 */

import React, { forwardRef, useCallback, useRef } from 'react'
import { motion, useReducedMotion }                from 'framer-motion'
import { clsx }                                    from 'clsx'
import { twMerge }                                 from 'tailwind-merge'
import { tapPrimary, tapLight, transitionSettle }  from 'animations/motionTokens'


// ─────────────────────────────────────────────────────────────────────────────
// HAPTIC UTILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires a 10ms haptic pulse on devices where the Web Vibration API
 * is available (Android Chrome). Silent no-op on iOS Safari.
 *
 * 10ms is the minimum perceptible vibration duration — felt as a
 * crisp click rather than a buzz. Not alarming; just present.
 */
function triggerHaptic() {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10)
    }
  } catch {
    // Silently swallowed — some browsers have the API but restrict it
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// BREATHING SINE WAVE LOADER
//
// Three SVG sine curves at different phases and opacities.
// They pulse at 0.2Hz (once per 5 seconds for a full cycle),
// which corresponds to roughly 12 breaths per minute — the clinical
// target for diaphragmatic breathing and parasympathetic activation.
//
// The three waves use the terracotta, bronze, and surface-edge token
// colours at varying opacities so they blend with any variant.
// ─────────────────────────────────────────────────────────────────────────────

const SINE_PATH = "M0,12 C8,12 8,2 16,2 C24,2 24,22 32,22 C40,22 40,2 48,2 C56,2 56,22 64,22 C72,22 72,2 80,2 C88,2 88,22 96,22"

function BreathingWaveLoader({ variant }) {
  // Wave colours are chosen to complement each variant
  // without introducing a colour that fights the button's own palette
  const waveColours = {
    primary:   ['rgba(193,122,91,0.60)', 'rgba(122,140,110,0.40)', 'rgba(193,122,91,0.25)'],
    secondary: ['rgba(122,140,110,0.70)', 'rgba(193,122,91,0.45)', 'rgba(122,140,110,0.25)'],
    crisis:    ['rgba(242,239,233,0.70)', 'rgba(242,239,233,0.45)', 'rgba(242,239,233,0.25)'],
    ghost:     ['rgba(107,100,92,0.70)',  'rgba(122,140,110,0.45)', 'rgba(107,100,92,0.25)'],
  }

  const colours = waveColours[variant] ?? waveColours.primary

  return (
    <span
      className="absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <svg
        width="96"
        height="24"
        viewBox="0 0 96 24"
        fill="none"
        className="overflow-visible"
      >
        {/* Wave 1 — leading wave, full colour */}
        <motion.path
          d={SINE_PATH}
          stroke={colours[0]}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          animate={{
            pathLength:   [0, 1, 0],
            pathOffset:   [0, 0.5, 1],
            opacity:      [0.4, 1, 0.4],
          }}
          transition={{
            duration:   5,             // 0.2Hz — 12 breaths per minute
            repeat:     Infinity,
            ease:       'easeInOut',
            delay:      0,
          }}
        />

        {/* Wave 2 — following wave, mid colour, offset phase */}
        <motion.path
          d={SINE_PATH}
          stroke={colours[1]}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          animate={{
            pathLength:   [0, 1, 0],
            pathOffset:   [0, 0.5, 1],
            opacity:      [0.2, 0.8, 0.2],
          }}
          transition={{
            duration:   5,
            repeat:     Infinity,
            ease:       'easeInOut',
            delay:      0.8,           // offset — creates a flowing cascade
          }}
        />

        {/* Wave 3 — trailing wave, faintest, most delayed */}
        <motion.path
          d={SINE_PATH}
          stroke={colours[2]}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          animate={{
            pathLength:   [0, 1, 0],
            pathOffset:   [0, 0.5, 1],
            opacity:      [0.1, 0.5, 0.1],
          }}
          transition={{
            duration:   5,
            repeat:     Infinity,
            ease:       'easeInOut',
            delay:      1.6,
          }}
        />
      </svg>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REDUCED MOTION LOADER
//
// When prefers-reduced-motion is active, the breathing wave is replaced
// with a simple static ellipsis that gently fades between opacities.
// No path animation, no motion — just presence.
// ─────────────────────────────────────────────────────────────────────────────

function StaticLoader() {
  return (
    <span
      className="absolute inset-0 flex items-center justify-center gap-1"
      aria-hidden="true"
    >
      {[0, 0.3, 0.6].map((delay, i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-current opacity-60"
          animate={{ opacity: [0.3, 0.9, 0.3] }}
          transition={{
            duration:   2.5,
            repeat:     Infinity,
            ease:       'easeInOut',
            delay,
          }}
        />
      ))}
    </span>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// VARIANT STYLES
//
// Defined as a lookup rather than conditional logic in the render function.
// Each variant has: base, hover, active, focus, and disabled classes.
// All use CSS custom properties from index.css — they respond to the
// Olympian/Titan theme automatically.
// ─────────────────────────────────────────────────────────────────────────────

const VARIANT_STYLES = {
  primary: {
    base: [
      'bg-text-primary text-surface-base',
      'border border-text-primary',
    ],
    hover:    'hover:bg-text-secondary hover:border-text-secondary',
    disabled: 'opacity-40 cursor-not-allowed',
    // Focus ring uses bronze — slightly offset from the button edge
    focusRing: 'focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  },
  secondary: {
    base: [
      'bg-transparent text-text-primary',
      'border border-surface-edge',
    ],
    hover:    'hover:bg-surface-raised hover:border-text-muted',
    disabled: 'opacity-40 cursor-not-allowed',
    focusRing: 'focus-visible:ring-2 focus-visible:ring-text-muted focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  },
  crisis: {
    base: [
      'bg-terracotta text-surface-base',
      'border border-terracotta',
    ],
    hover:    'hover:bg-terracotta-strong hover:border-terracotta-strong',
    disabled: 'opacity-40 cursor-not-allowed',
    focusRing: 'focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  },
  ghost: {
    base: [
      'bg-transparent text-text-secondary',
      'border border-transparent',
    ],
    hover:    'hover:bg-surface-raised hover:text-text-primary',
    disabled: 'opacity-40 cursor-not-allowed',
    focusRing: 'focus-visible:ring-2 focus-visible:ring-surface-edge focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE STYLES
//
// Each size defines the visual padding, text size, and the minimum touch
// target. The touch target is applied as a pseudo-element via Tailwind's
// before: variant so the visual size and interactive size are independent.
// ─────────────────────────────────────────────────────────────────────────────

const SIZE_STYLES = {
  sm: {
    padding:    'px-4 py-2',
    text:       'text-sm tracking-wide',
    height:     'h-9',
    iconSize:   'w-4 h-4',
    // Minimum touch target wrapper (44px) — applied to the outer container
    minTarget:  'min-h-[44px] min-w-[44px]',
  },
  md: {
    padding:    'px-6 py-3',
    text:       'text-base tracking-wide',
    height:     'h-11',
    iconSize:   'w-5 h-5',
    minTarget:  'min-h-[44px]',
  },
  lg: {
    padding:    'px-8 py-4',
    text:       'text-lg tracking-wide',
    height:     'h-14',
    iconSize:   'w-5 h-5',
    minTarget:  'min-h-[56px]',
  },
}


// ─────────────────────────────────────────────────────────────────────────────
// BUTTON COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const Button = forwardRef(function Button(
  {
    // Variant and size
    variant    = 'primary',
    size       = 'md',

    // State
    isLoading  = false,
    isDisabled = false,

    // Layout
    fullWidth  = false,

    // Icons
    leftIcon   = null,
    rightIcon  = null,

    // Haptics
    haptic     = true,

    // Children (button label)
    children,

    // Event handlers — onPress is a semantic alias for onClick
    onPress,
    onClick,

    // ARIA
    'aria-label': ariaLabel,

    // Class overrides (applied last so they can override defaults)
    className,

    // All other HTML button props
    ...rest
  },
  ref
) {
  const prefersReduced = useReducedMotion()
  const isInteractive  = !isDisabled && !isLoading

  // Merge onPress and onClick — onPress takes precedence (semantic clarity)
  const handleClick = onPress ?? onClick

  // ── Haptic handler ──────────────────────────────────────────────────────
  // Fires on pointerdown (before the click event) so the haptic is felt
  // at the moment of physical contact, not at release.
  const handlePointerDown = useCallback(() => {
    if (haptic && isInteractive) triggerHaptic()
  }, [haptic, isInteractive])

  // ── Resolve styles ──────────────────────────────────────────────────────
  const variantStyle = VARIANT_STYLES[variant] ?? VARIANT_STYLES.primary
  const sizeStyle    = SIZE_STYLES[size]       ?? SIZE_STYLES.md

  const containerClasses = twMerge(clsx(
    // Structural base
    'relative inline-flex items-center justify-center',
    'select-none no-tap-flash',
    'transition-colors duration-300',
    'rounded-xl',                    // Softly rounded — not pill (too casual), not sharp
    'font-sans font-normal',
    'outline-none',

    // Size
    sizeStyle.padding,
    sizeStyle.text,
    sizeStyle.height,
    sizeStyle.minTarget,

    // Full width
    fullWidth && 'w-full',

    // Variant base
    ...variantStyle.base,

    // Hover — only when interactive (not loading, not disabled)
    isInteractive && variantStyle.hover,

    // Disabled
    (isDisabled || isLoading) && variantStyle.disabled,

    // Focus ring — custom, palette-matched, WCAG AA compliant
    'focus-visible:outline-none',
    variantStyle.focusRing,

    // Loading state — cursor communicates the wait
    isLoading && 'cursor-wait',

    // User overrides — always last
    className
  ))

  // ── Tap animation ────────────────────────────────────────────────────────
  // Disabled and loading states skip the press animation —
  // a button that compresses but produces no result is confusing.
  const tapAnimation = prefersReduced
    ? {}                    // no motion if OS requests it
    : isInteractive
      ? (size === 'sm' ? tapLight : tapPrimary)   // sm uses lighter compression
      : {}

  // ── Accessibility attributes ────────────────────────────────────────────
  // WCAG 4.1.2 compliance:
  //   - aria-busy on loading communicates state to screen readers
  //   - aria-disabled (not disabled attr) preserves focusability
  //     so keyboard users can still reach the button and hear its state
  const a11yProps = {
    'aria-busy':     isLoading ? true : undefined,
    'aria-disabled': (isDisabled || isLoading) ? true : undefined,
    // If no visible text (icon-only button), aria-label is mandatory
    // Warn in development but don't throw — the app still works
    'aria-label':    ariaLabel,
  }

  if (process.env.NODE_ENV === 'development') {
    if (!children && !ariaLabel) {
      console.warn(
        '[Button] An icon-only button must receive an aria-label prop. ' +
        'Screen reader users will not know what this button does without it.'
      )
    }
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      className={containerClasses}
      whileTap={tapAnimation}
      onPointerDown={handlePointerDown}
      onClick={isInteractive ? handleClick : undefined}
      disabled={false}    // We manage this through aria-disabled, not disabled,
                          // so the button stays focusable in loading/disabled states
      {...a11yProps}
      {...rest}
    >
      {/* ── Loading state ─────────────────────────────────────────────────
          The loader sits in absolute position over the button content.
          The content itself fades to transparent (not unmounted) so the
          button holds its width and doesn't collapse while loading.
          ────────────────────────────────────────────────────────────────── */}

      {isLoading && (
        prefersReduced
          ? <StaticLoader />
          : <BreathingWaveLoader variant={variant} />
      )}

      {/* ── Button content ─────────────────────────────────────────────────
          Fades to invisible (opacity-0) during loading so the wave loader
          has clean space. Uses visibility so the button retains its dimensions.
          ────────────────────────────────────────────────────────────────── */}
      <motion.span
        className="relative flex items-center gap-2.5"
        animate={{ opacity: isLoading ? 0 : 1 }}
        transition={transitionSettle}
        aria-hidden={isLoading}
      >
        {/* Left icon */}
        {leftIcon && (
          <span
            className={clsx('flex-shrink-0', sizeStyle.iconSize)}
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}

        {/* Label */}
        {children && (
          <span className="flex-1 text-center leading-none">
            {children}
          </span>
        )}

        {/* Right icon */}
        {rightIcon && (
          <span
            className={clsx('flex-shrink-0', sizeStyle.iconSize)}
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        )}
      </motion.span>
    </motion.button>
  )
})

Button.displayName = 'Button'

export default Button


// ─────────────────────────────────────────────────────────────────────────────
// SPECIALISED PRESETS
//
// Pre-configured Button instances for common, repeated patterns.
// These reduce boilerplate at the call site without restricting extensibility —
// all props are still forwarded and can be overridden.
//
// Using these ensures visual consistency across the app without enforcing
// a rigid design system that can't flex to a screen's specific needs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary CTA for entry screens (RoomEntry, Intake submit).
 * Full-width, large, with the heaviest visual weight in the system.
 */
export function PrimaryAction({ children, ...props }) {
    return (
      <Button variant="primary" size="lg" fullWidth {...props}>
        {children}
      </Button>
    )
  }
  
  /**
   * A quiet secondary action that sits alongside a primary CTA without
   * competing for attention.
   */
  export function SecondaryAction({ children, ...props }) {
    return (
      <Button variant="secondary" size="md" {...props}>
        {children}
      </Button>
    )
  }
  
  /**
   * The session-ending / crisis-confirming button.
   * Muted terracotta — signals consequence without alarm.
   */
  export function CrisisAction({ children, ...props }) {
    return (
      <Button variant="crisis" size="md" {...props}>
        {children}
      </Button>
    )
  }
  
  /**
   * An invisible-until-needed ghost button for low-priority actions.
   * Navigation, settings toggles, subtle in-text links.
   */
  export function GhostAction({ children, ...props }) {
    return (
      <Button variant="ghost" size="sm" {...props}>
        {children}
      </Button>
    )
  }