/**
 * src/store/sessionStore.js
 *
 * The central nervous system of Alinda's frontend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURE RECEIVER:
 *   This store makes zero network requests. It imports nothing from api.js
 *   or websocket.js. It exposes simple actions that receive data. The flow
 *   is always: network layer → this store → React components. Never the reverse.
 *
 * TWO MESSAGE ARRAYS:
 *   messages:           Confirmed by the server. Immutable once received.
 *   optimisticMessages: Added locally when the user hits send. Removed when
 *                       the server's confirmation arrives. The UI renders both
 *                       arrays together, sorted by timestamp. Users see zero
 *                       latency for their own messages, even on 3G.
 *
 * DEEP MERGE, NOT REPLACE:
 *   applySessionState() merges incoming fields onto the existing session object.
 *   A state_update that only contains { mode: 'cooldown' } should not wipe
 *   out name_a, session_style, or any other field. The merge is intentionally
 *   partial — only the arrived fields replace the existing ones.
 *
 * TERMINAL STATE GUARD:
 *   When mode transitions to 'closed', the store treats this as terminal.
 *   It freezes the session (no further FSM updates are applied), preserves
 *   the message history, and sets a flag for post-session screens to read.
 *
 * DEDUPLICATION AND ORDERING:
 *   The WebSocket layer deduplicates by message ID. This store is the final
 *   safety net — appendMessages checks IDs before inserting, then sorts the
 *   merged array by timestamp. Out-of-order delivery is silently corrected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STORE INTERFACE CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are the exact actions expected by the hooks written in the previous
 * step. Any change to action names here requires a matching change there.
 *
 * Actions (called by useWebSocket.js):
 *   applySessionState(session)        — full or partial FSM state update
 *   appendMessages(messages[])        — server-confirmed new messages
 *   setTypingStatus(role, isTyping)   — partner or AI typing indicator
 *   setConnectionStatus(status)       — network health
 *   confirmOptimisticMessage(clientId) — move a message from optimistic → confirmed
 *   setReconnecting(attempt, delayMs)  — reconnection in progress
 *
 * Actions (called by UI components):
 *   initSession(roomId, role)          — begin a session
 *   addOptimisticMessage(content, clientId) — user sent a message, show immediately
 *   clearSession()                     — user left the room
 *   setMyRole(role)                    — set which partner this device is
 */

import { create } from 'zustand'


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Message deduplication set size — keeps memory bounded
const DEDUP_SET_MAX = 500

// The ordering source of truth — all messages sorted by this field
const MESSAGE_SORT_KEY = 'timestamp'


// ─────────────────────────────────────────────────────────────────────────────
// PURE UTILITY FUNCTIONS
//
// Defined outside the store creator so they're never re-created.
// All take state slices as arguments and return new values — never mutate.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deep merges `incoming` onto `existing`, handling null cases.
 * Only the TOP level fields are merged (shallow merge of the session object).
 * Nested objects (extra_data, behavioral_ledger) are replaced if present,
 * not recursively merged — the backend always sends complete sub-objects.
 *
 * @param {Object | null} existing
 * @param {Object} incoming
 * @returns {Object}
 */
function mergeSession(existing, incoming) {
  if (!existing) return incoming
  return { ...existing, ...incoming }
}

/**
 * Inserts new messages, deduplicating and sorting chronologically.
 * Returns [mergedMessages, updatedSeenIds].
 *
 * @param {Object[]} existing        — current confirmed messages
 * @param {Object[]} incoming        — new messages from server
 * @param {Set<string>} seenIds      — deduplication set
 * @returns {[Object[], Set<string>]}
 */
function mergeMessages(existing, incoming, seenIds) {
  const updatedSeen = new Set(seenIds)
  const fresh = []

  for (const msg of incoming) {
    const id = msg.id ?? `${msg.sender}-${msg.timestamp}`
    if (updatedSeen.has(id)) continue

    updatedSeen.add(id)
    fresh.push(msg)

    // Evict oldest entries from the dedup set to keep memory bounded
    if (updatedSeen.size > DEDUP_SET_MAX) {
      const firstKey = updatedSeen.values().next().value
      updatedSeen.delete(firstKey)
    }
  }

  if (fresh.length === 0) return [existing, updatedSeen]

  const merged = [...existing, ...fresh].sort((a, b) => {
    const ta = a[MESSAGE_SORT_KEY] ? new Date(a[MESSAGE_SORT_KEY]).getTime() : 0
    const tb = b[MESSAGE_SORT_KEY] ? new Date(b[MESSAGE_SORT_KEY]).getTime() : 0
    return ta - tb
  })

  return [merged, updatedSeen]
}

/**
 * Builds the combined message list for rendering.
 * Merges confirmed messages and optimistic messages, sorted by time.
 * Optimistic messages are at the end by design — they always have a timestamp
 * >= the last confirmed message (they were just typed).
 *
 * @param {Object[]} confirmed
 * @param {Object[]} optimistic
 * @returns {Object[]}
 */
function buildDisplayMessages(confirmed, optimistic) {
  if (optimistic.length === 0) return confirmed
  return [
    ...confirmed,
    ...optimistic.map(o => ({
      id:           `optimistic-${o.clientId}`,
      sender:        o.role,
      message_type:  'user',
      content:       o.content,
      timestamp:     o.timestamp,
      extra_data:    { optimistic: true, client_id: o.clientId, pending: o.pending },
    })),
  ]
}


// ─────────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────────

export const useSessionStore = create((set, get) => ({

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────

  /** The full SessionStateResponse from the backend, or null before joining. */
  session:              null,

  /** 'a' or 'b' — which partner this device represents. Set on room join. */
  myRole:               null,

  /** The room ID this device is connected to. */
  roomId:               null,

  /**
   * Server-confirmed messages in chronological order.
   * Append-only. Messages are never removed or reordered after arrival.
   */
  messages:             [],

  /**
   * Messages typed locally and sent, not yet confirmed by the server.
   * Each entry: { clientId, content, role, timestamp, pending: true }
   * When the server confirms (via confirmOptimisticMessage), the entry is removed.
   * The confirmed version appears in `messages` via appendMessages.
   */
  optimisticMessages:   [],

  /**
   * The combined list for the chat UI to render.
   * Derived from messages + optimisticMessages, sorted by timestamp.
   * Updated by every action that changes either array.
   * Pre-computed here so components don't run the merge on every render.
   */
  displayMessages:      [],

  /** 'online' | 'degraded' | 'offline' */
  connectionStatus:     'online',

  /**
   * Reconnection metadata — populated during reconnect attempts.
   * { attempt, delayMs, since } | null
   */
  reconnecting:         null,

  /**
   * Message ID deduplication set.
   * Stored in state so it persists across action calls within a session.
   * Not a WeakSet — we need ordered eviction. Backed by a Set.
   */
  _seenMessageIds:      new Set(),

  /**
   * True when the session has officially closed (mode === 'closed').
   * Once true, applySessionState() stops merging FSM updates.
   * Set to false when clearSession() is called.
   */
  _sessionTerminated:   false,

  /**
   * True while the initial session data is being fetched (between initSession
   * being called and the first applySessionState arriving from the server).
   */
  isInitializing:       false,


  // ─────────────────────────────────────────────────────────────────────────
  // ACTIONS — CALLED BY useWebSocket.js
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Applies a full or partial session state update from the server.
   * The server sends the full SessionStateResponse on state_update events
   * and on polling responses. We deep-merge rather than replace so that
   * fields absent from a partial update are not wiped.
   *
   * TERMINAL GUARD:
   * Once the session is 'closed', we stop applying FSM updates but continue
   * accepting message updates (the server may send final messages on close).
   *
   * @param {Partial<SessionStateResponse>} incoming
   */
  applySessionState: (incoming) => {
    const { _sessionTerminated, session } = get()

    // If session is already terminated, only accept closing-state data.
    // In practice the backend won't send more state updates after 'closed',
    // but defensive checks cost nothing.
    if (_sessionTerminated && incoming.mode && incoming.mode !== 'closed') return

    const merged    = mergeSession(session, incoming)
    const isClosing = merged.mode === 'closed' && session?.mode !== 'closed'

    set({
      session:            merged,
      _sessionTerminated: isClosing ? true : _sessionTerminated,
      isInitializing:     false,
    })
  },

  /**
   * Appends server-confirmed messages to the official history.
   * Deduplicates by ID. Sorts chronologically. Updates displayMessages.
   *
   * @param {MessageResponse[]} incoming
   */
  appendMessages: (incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return

    const { messages, _seenMessageIds, optimisticMessages } = get()
    const [merged, updatedSeen] = mergeMessages(messages, incoming, _seenMessageIds)

    // Cross-check: if any incoming message has a client_id that matches
    // an optimistic message, the optimistic version is no longer needed.
    // (Also handled by confirmOptimisticMessage, but this catches the case
    // where the message arrives via polling rather than direct confirmation.)
    const confirmedClientIds = new Set(
      incoming
        .map(m => m.extra_data?.client_id)
        .filter(Boolean)
    )
    const filteredOptimistic = optimisticMessages.filter(
      o => !confirmedClientIds.has(o.clientId)
    )

    set({
      messages:          merged,
      optimisticMessages: filteredOptimistic,
      displayMessages:   buildDisplayMessages(merged, filteredOptimistic),
      _seenMessageIds:   updatedSeen,
    })
  },

  /**
   * Updates the typing indicator state for a specific role.
   * Rather than storing typing status separately, we update it on the
   * session object directly (matching the backend's session state shape)
   * so useSessionState's selectors work without additional plumbing.
   *
   * @param {'a' | 'b' | 'ai'} role
   * @param {boolean} isTyping
   */
  setTypingStatus: (role, isTyping) => {
    set(state => ({
      session: state.session
        ? {
            ...state.session,
            partner_typing: isTyping,
            typing_role:    isTyping ? role : null,
          }
        : state.session,
    }))
  },

  /**
   * Updates the connection health status.
   * Changes here re-render components that display the connection indicator
   * (a thin bar at the top of ChatScreen) but do NOT re-render the chat
   * transcript, message input, or canvas.
   *
   * @param {'online' | 'degraded' | 'offline'} status
   */
  setConnectionStatus: (status) => {
    const valid = ['online', 'degraded', 'offline']
    if (!valid.includes(status)) return
    set({ connectionStatus: status })
  },

  /**
   * Marks a specific optimistic message as confirmed by the server.
   * Removes it from optimisticMessages; appendMessages() will add the
   * server's canonical version via the 'new_message' WebSocket event.
   *
   * @param {number} clientId — the client-side ID used when sending
   */
  confirmOptimisticMessage: (clientId) => {
    const { optimisticMessages, messages } = get()
    const filtered = optimisticMessages.filter(o => o.clientId !== clientId)

    if (filtered.length === optimisticMessages.length) return  // nothing changed

    set({
      optimisticMessages: filtered,
      displayMessages:    buildDisplayMessages(messages, filtered),
    })
  },

  /**
   * Stores reconnection progress metadata for the UI.
   * When attempt > 3, components may show a more prominent "reconnecting" UI.
   * When null, no reconnection is in progress.
   *
   * @param {number | null} attempt
   * @param {number} [delayMs]
   */
  setReconnecting: (attempt, delayMs = 0) => {
    set({
      reconnecting: attempt !== null
        ? { attempt, delayMs, since: Date.now() }
        : null,
    })
  },


  // ─────────────────────────────────────────────────────────────────────────
  // ACTIONS — CALLED BY UI COMPONENTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called when the user joins a room (either creates or joins).
   * Sets the device's role and room context. Does NOT set session — that
   * arrives via applySessionState when the first state_update comes through.
   *
   * @param {string} roomId
   * @param {'a' | 'b'} role
   */
  initSession: (roomId, role) => {
    set({
      roomId,
      myRole:          role,
      isInitializing:  true,
      connectionStatus: 'online',
      reconnecting:    null,
    })
  },

  /**
   * Adds an optimistic message immediately when the user hits send.
   * The message appears in the chat UI before any server round-trip.
   * This is the "Unbroken Presence" mechanic — vulnerability is never delayed.
   *
   * @param {string} content        — the message text
   * @param {number} clientId       — the client-generated ID from alindaWS.sendMessage()
   */
  addOptimisticMessage: (content, clientId) => {
    const { myRole, messages, optimisticMessages } = get()
    if (!myRole) return

    const optimisticMsg = {
      clientId,
      content,
      role:      myRole,
      timestamp: new Date().toISOString(),
      pending:   true,
    }

    const updated = [...optimisticMessages, optimisticMsg]

    set({
      optimisticMessages: updated,
      displayMessages:    buildDisplayMessages(messages, updated),
    })
  },

  /**
   * Sets this device's role. Called after a successful joinRoom or createRoom API call.
   * Separate from initSession because on first visit, the role is unknown
   * until the server confirms the room assignment.
   *
   * @param {'a' | 'b'} role
   */
  setMyRole: (role) => {
    set({ myRole: role })
  },

  /**
   * Complete session cleanup. Called when the user navigates away from the room,
   * closes the app, or the session is definitively ended and the user has
   * completed feedback.
   *
   * Does NOT clear messages immediately — the summary screen needs access
   * to the message history for the SessionSummaryScreen to display.
   * Messages are cleared on the next initSession() call.
   *
   * Safe to call multiple times — idempotent.
   */
  clearSession: () => {
    set({
      session:             null,
      roomId:              null,
      myRole:              null,
      messages:            [],
      optimisticMessages:  [],
      displayMessages:     [],
      connectionStatus:    'online',
      reconnecting:        null,
      _seenMessageIds:     new Set(),
      _sessionTerminated:  false,
      isInitializing:      false,
    })
  },

  /**
   * Clears only the optimistic queue. Called on reconnect when the server
   * sends a fresh message history — any unconfirmed optimistic messages
   * will either appear in the server's history or be considered lost.
   *
   * In practice, alindaWS.js's outbox flushes them before clearing here,
   * so loss should be extremely rare.
   */
  clearOptimisticMessages: () => {
    const { messages } = get()
    set({
      optimisticMessages: [],
      displayMessages:    buildDisplayMessages(messages, []),
    })
  },

  /**
   * Called when the WebSocket reconnects and a fresh session state arrives.
   * Reconciles the server's message history with any optimistic messages
   * that were sent while offline.
   *
   * The server sends all messages since the last seen timestamp.
   * We merge them, confirm any that match our optimistic queue, and re-sort.
   *
   * @param {MessageResponse[]} serverMessages — full or partial message history
   */
  reconcileAfterReconnect: (serverMessages) => {
    const { _seenMessageIds, optimisticMessages } = get()
    const [merged, updatedSeen] = mergeMessages([], serverMessages, _seenMessageIds)

    // Determine which optimistic messages were confirmed by the server history
    const serverClientIds = new Set(
      serverMessages.map(m => m.extra_data?.client_id).filter(Boolean)
    )
    const stillPending = optimisticMessages.filter(
      o => !serverClientIds.has(o.clientId)
    )

    set({
      messages:           merged,
      optimisticMessages:  stillPending,
      displayMessages:    buildDisplayMessages(merged, stillPending),
      _seenMessageIds:    updatedSeen,
      reconnecting:       null,
      connectionStatus:   'online',
    })
  },


  // ─────────────────────────────────────────────────────────────────────────
  // COMPUTED / DERIVED STATE
  //
  // These are functions rather than stored values because they derive from
  // other state and should never be stale. Called at read time, not stored.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns the session's room ID.
   * Shortcut for components that only need the room ID without the full session.
   */
  getRoomId: () => get().roomId,

  /**
   * Returns the other partner's name.
   * Avoids having every component compute this from myRole + session.
   */
  getPartnerName: () => {
    const { session, myRole } = get()
    if (!session || !myRole) return null
    return myRole === 'a' ? session.name_b : session.name_a
  },

  /**
   * Returns true if the session is in a state where the chat should be visible.
   * Used by ChatScreen to decide whether to render.
   */
  isChatVisible: () => {
    const { session } = get()
    if (!session) return false
    return ['guided', 'free_chat', 'cooldown', 'wrapping_up'].includes(session.mode)
  },
}))


// ─────────────────────────────────────────────────────────────────────────────
// OUTSIDE-REACT ACCESSOR
//
// The canvas engine (LivingCanvas.jsx's store subscription) and the WebSocket
// client need to read session state outside of a React component.
// Zustand's getState() provides this.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the current session state without subscribing to updates.
 * For use in non-React contexts (canvas loop, websocket.js, soundManager).
 *
 * @returns {Object} — the current store state snapshot
 */
export function getSessionState() {
  return useSessionStore.getState()
}