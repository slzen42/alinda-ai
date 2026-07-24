/**
 * src/utils/roleHelpers.js
 *
 * The perspective engine — translating backend roles into human-centered UI copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The backend knows roles. The UI knows people. This file is the translation.
 *
 * THE "YOU" PRINCIPLE:
 *   The local user is never referred to by name in their own interface.
 *   If Michael is Partner A, Michael's screen says "Your turn" — not
 *   "Michael's turn." First-person language is warmer, more immediate,
 *   and removes the clinical distance of third-person self-reference.
 *   Exceptions: the intake screen shows "Michael submitted their intake"
 *   for Partner B's awareness — Partner B needs to see the third-person
 *   name because it's information about someone else.
 *
 * ALINDA AS MEDIATOR, NOT TOOL:
 *   The AI is never "the AI" or "the bot" or "assistant" in the UI.
 *   It is "Alinda" — always, uniformly, across every screen and copy
 *   string. This file enforces that by never accepting 'ai' as a
 *   display name; it always resolves to ALINDA_NAME.
 *
 * POSSESSIVES HANDLED CORRECTLY:
 *   English possessive for names ending in 's' is contested:
 *   "James's" (modern AP/Chicago style) vs "James'" (older style).
 *   We use the modern form: "James's turn." This is a design decision,
 *   not a grammar error. It can be changed in one place here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRIPARTITE RESOLVER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every message, turn indicator, and typing bubble has one of three identities:
 *   SELF    — this device's user
 *   PARTNER — the other human in the session
 *   ALINDA  — the AI mediator
 *
 * resolveIdentity() takes the raw backend data and returns a structured
 * identity object that components use declaratively, without any logic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAYOUT DIRECTIVES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Chat UI layout follows identity:
 *   SELF    → right-aligned, outgoing bubble styling
 *   PARTNER → left-aligned, incoming bubble styling
 *   ALINDA  → centered, distinct intervention styling
 *
 * Rather than putting `if (isSelf) 'flex-end' else 'flex-start'` logic
 * inside MessageBubble, the layout directives live here. MessageBubble
 * receives a layout object and renders declaratively.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SYSTEM MESSAGES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The backend also sends system-type messages (turn assignments, idle redirects).
 * These have sender='system' and are rendered as centered, un-attributed notices.
 * They are not "from" anyone — they are the room speaking.
 */


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical name for the AI mediator — never changes. */
export const ALINDA_NAME = 'Alinda'

/**
 * The first-person label for the local user.
 * Used everywhere the user would see their own name.
 */
export const SELF_LABEL = 'You'

/**
 * The label used when the partner's name is not yet known
 * (before intake is submitted, or before they join).
 */
export const PARTNER_PLACEHOLDER = 'Your partner'

/**
 * Message types from the backend's MessageResponse.
 * Mirrors backend/schemas.py's message_type field values.
 */
export const MESSAGE_TYPES = Object.freeze({
  USER:   'user',
  AI:     'ai',
  SYSTEM: 'system',
})

/**
 * Sender identifiers from the backend.
 * Mirrors what session_manager.py writes as `sender` on ChatMessage.
 */
export const SENDERS = Object.freeze({
  A:      'a',
  B:      'b',
  AI:     'ai',
  SYSTEM: 'system',
})

/**
 * Identity categories — returned by resolveIdentity(), used by all UI logic.
 */
export const IDENTITY = Object.freeze({
  SELF:    'self',
  PARTNER: 'partner',
  ALINDA:  'alinda',
  SYSTEM:  'system',
})


// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT DIRECTIVE OBJECTS
//
// Pre-built Tailwind class strings for each identity category.
// MessageBubble reads these objects instead of computing classes inline.
// ─────────────────────────────────────────────────────────────────────────────

export const LAYOUT = Object.freeze({
  self: Object.freeze({
    container:  'flex justify-end',
    bubble:     'bubble-self bg-surface-raised text-text-primary',
    nameLabel:  null,   // self doesn't show a name label above their bubble
    align:      'right',
  }),
  partner: Object.freeze({
    container:  'flex justify-start',
    bubble:     'bubble-other bg-surface-raised text-text-primary',
    nameLabel:  'text-text-secondary text-sm mb-1',
    align:      'left',
  }),
  alinda: Object.freeze({
    container:  'flex justify-center',
    bubble:     'bubble-alinda bg-surface-overlay text-text-primary shadow-glow-alinda',
    nameLabel:  'text-bronze-strong text-sm mb-1 text-center tracking-wide',
    align:      'center',
  }),
  system: Object.freeze({
    container:  'flex justify-center',
    bubble:     'rounded-full bg-transparent text-text-muted text-sm px-4 py-1',
    nameLabel:  null,
    align:      'center',
  }),
})


// ─────────────────────────────────────────────────────────────────────────────
// CORE RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the full identity of a message sender relative to the local user.
 *
 * @param {string} sender       — from message.sender: 'a', 'b', 'ai', 'system'
 * @param {'a' | 'b'} myRole   — this device's role
 * @param {string | null} nameA — Partner A's display name (from session)
 * @param {string | null} nameB — Partner B's display name (from session)
 *
 * @returns {{
 *   identity:     'self' | 'partner' | 'alinda' | 'system',
 *   displayName:  string,       — "You", "Sarah", "Alinda", or ""
 *   shortName:    string,       — first name only, or "You", "Alinda"
 *   isSelf:       boolean,
 *   isPartner:    boolean,
 *   isAlinda:     boolean,
 *   isSystem:     boolean,
 *   layout:       { container, bubble, nameLabel, align },
 *   ariaLabel:    string,       — accessible "sent by X" label
 * }}
 */
export function resolveIdentity(sender, myRole, nameA, nameB) {
  const partnerRole   = myRole === SENDERS.A ? SENDERS.B : SENDERS.A
  const partnerName   = myRole === SENDERS.A
    ? (nameB ?? PARTNER_PLACEHOLDER)
    : (nameA ?? PARTNER_PLACEHOLDER)

  // ── System messages ───────────────────────────────────────────────────────
  if (sender === SENDERS.SYSTEM || !sender) {
    return {
      identity:    IDENTITY.SYSTEM,
      displayName: '',
      shortName:   '',
      isSelf:      false,
      isPartner:   false,
      isAlinda:    false,
      isSystem:    true,
      layout:      LAYOUT.system,
      ariaLabel:   'Session note',
    }
  }

  // ── Alinda ────────────────────────────────────────────────────────────────
  if (sender === SENDERS.AI) {
    return {
      identity:    IDENTITY.ALINDA,
      displayName: ALINDA_NAME,
      shortName:   ALINDA_NAME,
      isSelf:      false,
      isPartner:   false,
      isAlinda:    true,
      isSystem:    false,
      layout:      LAYOUT.alinda,
      ariaLabel:   `${ALINDA_NAME} said`,
    }
  }

  // ── Self (local user) ─────────────────────────────────────────────────────
  if (sender === myRole) {
    const myName = myRole === SENDERS.A ? (nameA ?? SELF_LABEL) : (nameB ?? SELF_LABEL)
    return {
      identity:    IDENTITY.SELF,
      displayName: SELF_LABEL,
      shortName:   SELF_LABEL,
      isSelf:      true,
      isPartner:   false,
      isAlinda:    false,
      isSystem:    false,
      layout:      LAYOUT.self,
      ariaLabel:   `You said`,
    }
  }

  // ── Partner (the other human) ─────────────────────────────────────────────
  const firstName = _firstName(partnerName)
  return {
    identity:    IDENTITY.PARTNER,
    displayName: partnerName,
    shortName:   firstName,
    isSelf:      false,
    isPartner:   true,
    isAlinda:    false,
    isSystem:    false,
    layout:      LAYOUT.partner,
    ariaLabel:   `${partnerName} said`,
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// POSSESSIVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the grammatically correct possessive for a name.
 *
 *   "Sarah"  → "Sarah's"
 *   "James"  → "James's"   (modern AP/Chicago style — 's after all names)
 *   "You"    → "Your"      (special case: first-person possessive)
 *   "Alinda" → "Alinda's"
 *
 * @param {string} name
 * @returns {string}
 */
export function possessive(name) {
  if (!name) return ''
  if (name === SELF_LABEL)  return 'Your'
  if (name === ALINDA_NAME) return `${ALINDA_NAME}'s`

  // Modern style: always add 's after the apostrophe
  // "James's", "Bess's", "Chris's"
  return `${name}'s`
}

/**
 * Returns the turn label for the turn indicator.
 * Produces natural, grammatically correct sentences:
 *
 *   It's your turn      → "Your turn"
 *   It's Sarah's turn   → "Sarah's turn"
 *   It's Alinda's turn  → "Alinda is responding"
 *   Open floor          → "Open conversation"
 *
 * @param {string | null} currentTurn  — 'a', 'b', 'ai', or null (open floor)
 * @param {'a' | 'b'} myRole
 * @param {string | null} nameA
 * @param {string | null} nameB
 * @returns {string}
 */
export function formatTurnLabel(currentTurn, myRole, nameA, nameB) {
  if (!currentTurn) return 'Open conversation'

  if (currentTurn === SENDERS.AI) return `${ALINDA_NAME} is responding`

  if (currentTurn === myRole) return 'Your turn'

  const partnerName = myRole === SENDERS.A
    ? (nameB ?? PARTNER_PLACEHOLDER)
    : (nameA ?? PARTNER_PLACEHOLDER)

  return `${possessive(partnerName)} turn`
}

/**
 * Returns the typing indicator label.
 *
 *   "Sarah is typing…"
 *   "Alinda is responding…"
 *   "" (if no one is typing)
 *
 * @param {boolean} partnerTyping
 * @param {boolean} alindaTyping
 * @param {string | null} partnerName
 * @returns {string}
 */
export function formatTypingLabel(partnerTyping, alindaTyping, partnerName) {
  if (alindaTyping)  return `${ALINDA_NAME} is responding\u2026`   // ellipsis character
  if (partnerTyping) return `${partnerName ?? PARTNER_PLACEHOLDER} is typing\u2026`
  return ''
}

/**
 * Returns the crisis ready status label.
 * Used in the CrisisOverlay to show who has confirmed they're ready.
 *
 *   "You're ready. Waiting for Sarah."
 *   "Sarah is ready. Take your time."
 *   "Both of you are ready."
 *
 * @param {boolean} myReady
 * @param {boolean} partnerReady
 * @param {string | null} partnerName
 * @returns {string}
 */
export function formatCrisisReadyLabel(myReady, partnerReady, partnerName) {
  const name = partnerName ?? PARTNER_PLACEHOLDER

  if (myReady && partnerReady) return 'Both of you are ready.'
  if (myReady)                 return `You're ready. Waiting for ${name}.`
  if (partnerReady)            return `${name} is ready. Take your time.`
  return ''
}

/**
 * Returns the end-session status label.
 * Used in the EndSessionScreen to reflect the two-step mutual end process.
 *
 * @param {boolean} iAsked         — this user requested the end
 * @param {boolean} partnerAsked   — the partner requested the end
 * @param {string | null} partnerName
 * @returns {string}
 */
export function formatEndSessionLabel(iAsked, partnerAsked, partnerName) {
  const name = partnerName ?? PARTNER_PLACEHOLDER

  if (iAsked && !partnerAsked) {
    return `Waiting for ${name} to confirm.`
  }
  if (partnerAsked && !iAsked) {
    return `${name} has asked to end the session.`
  }
  return ''
}


// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE TYPE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the message should be rendered as a system/notice
 * rather than a chat bubble.
 *
 * @param {{ sender: string, message_type: string }} message
 * @returns {boolean}
 */
export function isSystemMessage(message) {
  return (
    message?.sender        === SENDERS.SYSTEM ||
    message?.message_type  === MESSAGE_TYPES.SYSTEM
  )
}

/**
 * Returns true if the message is from Alinda.
 *
 * @param {{ sender: string }} message
 * @returns {boolean}
 */
export function isAlindaMessage(message) {
  return message?.sender === SENDERS.AI
}

/**
 * Returns true if the message is from the local user.
 *
 * @param {{ sender: string }} message
 * @param {'a' | 'b'} myRole
 * @returns {boolean}
 */
export function isSelfMessage(message, myRole) {
  return message?.sender === myRole
}

/**
 * Returns true if the message was sent optimistically (not yet confirmed).
 * Used by MessageBubble to apply a "pending" visual state.
 *
 * @param {{ extra_data?: { optimistic?: boolean } }} message
 * @returns {boolean}
 */
export function isOptimisticMessage(message) {
  return Boolean(message?.extra_data?.optimistic)
}

/**
 * Returns true if this message should start a new visual group.
 * A new group starts when the sender changes or when more than
 * 5 minutes have passed since the last message.
 *
 * Grouping reduces visual noise — consecutive messages from the same
 * sender share one name label rather than repeating it on every bubble.
 *
 * @param {{ sender: string, timestamp: string }} message
 * @param {{ sender: string, timestamp: string } | null} previousMessage
 * @returns {boolean}
 */
export function isNewMessageGroup(message, previousMessage) {
  if (!previousMessage) return true
  if (message.sender !== previousMessage.sender) return true

  const tCurr = message.timestamp     ? new Date(message.timestamp).getTime()     : 0
  const tPrev = previousMessage.timestamp ? new Date(previousMessage.timestamp).getTime() : 0
  const diffMinutes = (tCurr - tPrev) / 60_000

  return diffMinutes > 5
}


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the first name from a full display name.
 * "Sarah Johnson" → "Sarah"
 * "Soumyadeep"    → "Soumyadeep"
 * ""              → ""
 *
 * @param {string | null | undefined} fullName
 * @returns {string}
 */
function _firstName(fullName) {
  if (!fullName) return ''
  return fullName.split(' ')[0] ?? fullName
}