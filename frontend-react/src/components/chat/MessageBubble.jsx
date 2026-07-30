/**
 * src/components/chat/MessageBubble.jsx
 *
 * The physical language of conversation in Alinda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE VISUAL REGISTERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HUMAN PARTNERS (self + partner):
 *   Frosted, slightly elevated stone panes — carved from the same block.
 *   No hierarchy between them: identical material, identical weight.
 *   The only difference is spatial direction (left / right) and the
 *   single sharp corner that acts as a subtle directional tail.
 *   Partners are equal. The UI enforces this visually.
 *
 * ALINDA:
 *   No bubble. No border. No containment.
 *   Her words float in the absolute center of the timeline,
 *   rendered in Cormorant Garamond — the room's own serif.
 *   A soft radial glow behind her text (not a shadow — an emanation)
 *   ensures readability against the LivingCanvas regardless of the
 *   painting behind it. The glow pulses at 0.1Hz, the room's breath.
 *
 * SYSTEM:
 *   Minimal centered notices. No attribution, no material.
 *   The room speaking, not a participant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EQUALITY PRINCIPLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * In couples therapy, the visual environment must communicate neutrality.
 * If the local user's bubbles were brighter, larger, or differently
 * coloured than their partner's, the UI would be taking sides.
 * Both human partners use exactly the same CSS — `bg-surface-raised`,
 * `border-surface-edge`, `text-text-primary`, `font-sans` — differing
 * only in which bottom corner is sharp.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENTRANCE PHYSICS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Messages do not pop. They surface — rising 8px from below opacity:0.
 * The stone easing (cubic-bezier(0.20, 0.00, 0.00, 1.00)) ensures a
 * decisive, physical arrival with zero elastic rebound.
 * Alinda's messages have a slightly slower, more deliberate entrance —
 * her words settle rather than arrive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUPING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Consecutive messages from the same sender within 5 minutes form a group.
 * Only the first message in a group shows the sender's name.
 * All subsequent messages in the group omit the name but still show
 * the time on hover. This reduces visual noise dramatically while
 * preserving the attribution that makes the conversation legible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OPTIMISTIC MESSAGES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When the user sends a message, it appears immediately in the UI
 * (before server confirmation) with a slightly reduced opacity and a
 * small "sending" indicator. When the server confirms, the optimistic
 * version is replaced by the canonical version — the swap is invisible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * message:         MessageResponse | OptimisticMessage
 * myRole:          'a' | 'b'
 * nameA:           string | null
 * nameB:           string | null
 * isFirstInGroup:  boolean — whether to show the sender's name
 * isLastInGroup:   boolean — whether to add bottom margin for group separation
 * index:           number  — used for stagger delay on initial load
 */

import React, { useState, useRef, useCallback } from 'react'
import { motion, useReducedMotion }              from 'framer-motion'
import { clsx }                                  from 'clsx'

import {
  resolveIdentity,
  isSystemMessage,
  isOptimisticMessage,
  ALINDA_NAME,
} from 'utils/roleHelpers'
import {
  formatMessageTime,
  formatAccessibleDateTime,
} from 'utils/formatTime'
import { transitionReveal, transitionStone } from 'animations/motionTokens'


// ─────────────────────────────────────────────────────────────────────────────
// ENTRANCE ANIMATION VARIANTS
// ─────────────────────────────────────────────────────────────────────────────

const humanEntrance = {
  hidden:  { opacity: 0, y: 8 },
  visible: (delay = 0) => ({
    opacity:    1,
    y:          0,
    transition: {
      type:     'tween',
      ease:     [0.20, 0.00, 0.00, 1.00],   // stone
      duration: 0.40,
      delay:    Math.min(delay * 0.04, 0.3), // stagger on load, no stagger when live
    },
  }),
}

const alindaEntrance = {
  hidden:  { opacity: 0, y: 12 },
  visible: (delay = 0) => ({
    opacity:    1,
    y:          0,
    transition: {
      type:     'tween',
      ease:     [0.25, 0.00, 0.10, 1.00],   // slightly longer settle
      duration: 0.60,
      delay:    Math.min(delay * 0.04, 0.3),
    },
  }),
}

const reducedEntrance = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
}

const systemEntrance = {
  hidden:  { opacity: 0, scale: 0.97 },
  visible: {
    opacity:    1,
    scale:      1,
    transition: { type: 'tween', ease: 'easeOut', duration: 0.30 },
  },
}


// ─────────────────────────────────────────────────────────────────────────────
// ALINDA GLOW
//
// A soft radial emanation behind Alinda's text — not a shadow.
// It makes her text readable against any painting background without
// boxing her in a container. The glow pulses at 0.1Hz — the room's breath.
// ─────────────────────────────────────────────────────────────────────────────

function AlindaGlow({ prefersReduced }) {
  if (prefersReduced) {
    return (
      <div
        aria-hidden="true"
        className="
          absolute inset-0 pointer-events-none rounded-2xl
          -mx-8 -my-4
        "
        style={{
          background: 'radial-gradient(ellipse 90% 140% at 50% 50%, rgba(122,140,110,0.18) 0%, transparent 70%)',
        }}
      />
    )
  }

  return (
    <motion.div
      aria-hidden="true"
      className="
        absolute inset-0 pointer-events-none rounded-2xl
        -mx-8 -my-4
      "
      style={{
        // Two layered radials: a warm bronze outer halo + a brighter
        // sage inner focus. Together they read as "candlelight behind words."
        background: [
          'radial-gradient(ellipse 120% 200% at 50% 50%, rgba(122,140,110,0.22) 0%, transparent 60%)',
          'radial-gradient(ellipse 60% 100% at 50% 50%, rgba(180,160,110,0.12) 0%, transparent 50%)',
        ].join(', '),
      }}
      animate={{
        opacity: [0.7, 1.0, 0.7],
        scale:   [0.98, 1.02, 0.98],
      }}
      transition={{
        // 0.1Hz: 10-second cycle, asymmetric (4s expand, 6s contract)
        times:      [0, 0.4, 1],
        duration:   10,
        repeat:     Infinity,
        ease:       'easeInOut',
      }}
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// TIMESTAMP
//
// Appears on hover (desktop) or on the second tap (mobile — handled by
// a touch event that toggles local state). Aria-label provides the full
// accessible datetime regardless of visible state.
// ─────────────────────────────────────────────────────────────────────────────

function Timestamp({ timestamp, className }) {
  const readable   = formatMessageTime(timestamp)
  const accessible = formatAccessibleDateTime(timestamp)

  if (!readable) return null

  return (
    <time
      dateTime={timestamp}
      aria-label={accessible}
      className={clsx(
        'text-[10px] font-sans text-text-muted/60',
        'tracking-wide select-none leading-none',
        className
      )}
    >
      {readable}
    </time>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// OPTIMISTIC INDICATOR
//
// A tiny visual signal that the message is in-flight.
// Not an error state — just honest presence.
// ─────────────────────────────────────────────────────────────────────────────

function SendingDot() {
  return (
    <motion.span
      aria-label="Sending"
      className="
        inline-block w-1.5 h-1.5 rounded-full
        bg-text-muted/40 mb-0.5 ml-1.5 flex-shrink-0
      "
      animate={{ opacity: [0.3, 0.9, 0.3] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// HUMAN BUBBLE — self and partner
// ─────────────────────────────────────────────────────────────────────────────

function HumanBubble({
  message,
  identity,
  isFirstInGroup,
  isLastInGroup,
  prefersReduced,
  index,
}) {
  const [showTimestamp, setShowTimestamp] = useState(false)
  const tapRef = useRef(null)

  const isSelf      = identity.isSelf
  const isOptimistic = isOptimisticMessage(message)

  // Mobile: toggle timestamp on tap
  const handleTap = useCallback(() => {
    clearTimeout(tapRef.current)
    setShowTimestamp(v => !v)
    tapRef.current = setTimeout(() => setShowTimestamp(false), 3000)
  }, [])

  const variants = prefersReduced ? reducedEntrance : humanEntrance

  return (
    <motion.div
      className={clsx(
        'flex flex-col',
        isSelf ? 'items-end' : 'items-start',
        isFirstInGroup ? 'mt-4' : 'mt-1',
        isLastInGroup  ? 'mb-2' : '',
      )}
      variants={variants}
      initial="hidden"
      animate="visible"
      custom={index}
      layout
    >
      {/* Sender name — only on first message in a group */}
      {isFirstInGroup && !isSelf && (
        <p className="
          text-[11px] font-sans text-text-muted
          tracking-[0.07em] mb-1.5
          ml-1 select-none
        ">
          {identity.shortName}
        </p>
      )}

      {/* The bubble */}
      <div className="relative flex items-end gap-2">
        <button
          type="button"
          onClick={handleTap}
          className="
            no-tap-flash text-left
            outline-none focus-visible:ring-2 focus-visible:ring-bronze/60
            focus-visible:ring-offset-1 rounded-[12px]
          "
          aria-label={`Message from ${identity.displayName}: ${message.content}`}
        >
          <div
            className={clsx(
              // The bubble material — frosted stone pane
              'relative px-4 py-3',
              'bg-surface-raised',
              'border border-surface-edge',
              // Shadow — ambient, not floating
              'shadow-ambient',
              // The asymmetric corner system:
              // Three soft corners (12px) + one sharp "tail" corner (3px)
              isSelf
                ? 'bubble-self'    // defined in index.css: bottom-right sharp
                : 'bubble-other',  // defined in index.css: bottom-left sharp
              // Optimistic state — slightly transparent
              isOptimistic && 'opacity-70',
            )}
          >
            {/* Message content */}
            <p className="
              font-sans text-[15px] sm:text-[15.5px]
              text-text-primary
              leading-relaxed
              max-w-[65ch] sm:max-w-[55ch]
              break-words
              whitespace-pre-wrap
            ">
              {message.content}
            </p>

            {/* Timestamp — inline, only when toggled (mobile) or on hover (desktop) */}
            <div className={clsx(
              'flex mt-1.5',
              isSelf ? 'justify-end' : 'justify-start',
              'items-center gap-1',
            )}>
              {/* Desktop: always visible at low opacity, brightens on hover */}
              <span className="hidden sm:block">
                <Timestamp
                  timestamp={message.timestamp}
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                />
              </span>
              {/* Mobile: only visible when toggled */}
              <AnimatePresence>
                {showTimestamp && (
                  <motion.span
                    className="sm:hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Timestamp timestamp={message.timestamp} />
                  </motion.span>
                )}
              </AnimatePresence>

              {/* Sending indicator */}
              {isOptimistic && <SendingDot />}
            </div>
          </div>
        </button>
      </div>
    </motion.div>
  )
}

// We need AnimatePresence for the timestamp — import it
import { AnimatePresence } from 'framer-motion'


// ─────────────────────────────────────────────────────────────────────────────
// ALINDA BUBBLE — uncontained, centered, serif
// ─────────────────────────────────────────────────────────────────────────────

function AlindaBubble({ message, isFirstInGroup, index, prefersReduced }) {
  const variants = prefersReduced ? reducedEntrance : alindaEntrance

  return (
    <motion.div
      className={clsx(
        'flex flex-col items-center',
        isFirstInGroup ? 'mt-6 mb-2' : 'mt-3 mb-1',
        'px-6 sm:px-12 lg:px-20',   // wide margins on desktop
      )}
      variants={variants}
      initial="hidden"
      animate="visible"
      custom={index}
      layout
    >
      {/* Alinda's name — first of group only */}
      {isFirstInGroup && (
        <p className="
          text-[11px] font-sans text-bronze/70
          tracking-[0.14em] uppercase mb-3
          select-none
        ">
          {ALINDA_NAME}
        </p>
      )}

      {/* The uncontained text with glow emanation */}
      <div className="relative">
        {/* Glow sits behind the text via z-index */}
        <AlindaGlow prefersReduced={prefersReduced} />

        {/* The text itself */}
        <p className="
          relative z-10
          font-serif text-[17px] sm:text-[18.5px]
          text-text-primary
          leading-[1.65] tracking-[0.01em]
          text-center
          max-w-[52ch]
          break-words
          whitespace-pre-wrap
        ">
          {message.content}
        </p>

        {/* Timestamp — always visible, below message, very muted */}
        <div className="flex justify-center mt-2">
          <Timestamp
            timestamp={message.timestamp}
            className="opacity-40"
          />
        </div>
      </div>
    </motion.div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM BUBBLE — centered notice, no attribution
// ─────────────────────────────────────────────────────────────────────────────

function SystemBubble({ message }) {
  return (
    <motion.div
      className="flex justify-center my-5 px-4"
      variants={systemEntrance}
      initial="hidden"
      animate="visible"
      layout
    >
      <div className="
        inline-flex items-center gap-2
        px-4 py-2
        bg-surface-overlay/40
        border border-surface-edge/50
        rounded-full
        max-w-[48ch]
      ">
        {/* Subtle horizontal rule on each side */}
        <div className="h-px w-6 bg-surface-edge/60 flex-shrink-0" />
        <p className="
          text-[12px] font-sans text-text-muted
          tracking-[0.06em] text-center
          leading-relaxed
        ">
          {message.content}
        </p>
        <div className="h-px w-6 bg-surface-edge/60 flex-shrink-0" />
      </div>
    </motion.div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// DATE SEPARATOR
//
// Exported so ChatScreen can render it between message groups.
// A thin line with the date centered inside — minimal, legible.
// ─────────────────────────────────────────────────────────────────────────────

export function DateSeparator({ label }) {
  return (
    <div className="flex items-center gap-4 my-6 px-4 sm:px-8" aria-label={label} role="separator">
      <div className="flex-1 h-px bg-surface-edge/50" />
      <span className="
        text-[11px] font-sans text-text-muted/70
        tracking-[0.10em] uppercase select-none
        flex-shrink-0
      ">
        {label}
      </span>
      <div className="flex-1 h-px bg-surface-edge/50" />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function MessageBubble({
  message,
  myRole,
  nameA,
  nameB,
  isFirstInGroup = true,
  isLastInGroup  = true,
  index          = 0,
}) {
  const prefersReduced = useReducedMotion()

  // System messages don't need role resolution
  if (isSystemMessage(message)) {
    return <SystemBubble message={message} />
  }

  const identity = resolveIdentity(
    message.sender,
    myRole,
    nameA,
    nameB,
  )

  if (identity.isAlinda) {
    return (
      <AlindaBubble
        message={message}
        isFirstInGroup={isFirstInGroup}
        index={index}
        prefersReduced={prefersReduced}
      />
    )
  }

  // Human: self or partner
  return (
    <HumanBubble
      message={message}
      identity={identity}
      isFirstInGroup={isFirstInGroup}
      isLastInGroup={isLastInGroup}
      prefersReduced={prefersReduced}
      index={index}
    />
  )
}