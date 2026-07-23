/**
 * src/hooks/useWebSocket.js
 *
 * Marries the vanilla WebSocket client (lib/websocket.js) to React's lifecycle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS HOOK SOLVES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * React components mount, unmount, and fast-refresh. The WebSocket singleton
 * (alindaWS) does not know about any of this. Without careful lifecycle
 * management:
 *
 *   - A component remounting could open a second connection (memory leak,
 *     duplicate messages)
 *   - A component unmounting without cleanup leaves the connection open and
 *     its event listeners alive, causing ghost updates to dead components
 *   - React StrictMode in development mounts every component twice
 *     (intentionally) — naively written socket logic opens two sockets
 *
 * This hook is the single point where alindaWS.connect() and alindaWS.close()
 * are called, and where all EventEmitter listeners are registered and cleaned up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPECTED sessionStore ACTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * sessionStore must expose these actions (called by this hook):
 *   applySessionState(sessionStateResponse)   — full state update
 *   appendMessages(messages[])                — new messages confirmed by server
 *   setTypingStatus(role, isTyping)           — partner or Alinda typing
 *   setConnectionStatus('online'|'degraded'|'offline')
 *   confirmOptimisticMessage(clientId)        — message arrived confirmed
 *   setReconnecting(attempt, delayMs)         — reconnection in progress
 */

import { useEffect, useRef }      from 'react'
import { alindaWS }               from 'lib/websocket'
import { onConnectionHealth }     from 'lib/api'
import { useSessionStore }        from 'store/sessionStore'


/**
 * Manages the WebSocket connection lifecycle and routes all incoming events
 * to the session store. Must be mounted exactly once per session — in App.jsx
 * or a persistent layout wrapper, NOT inside screen components that unmount.
 *
 * @param {string | null} roomId  — from routing; null means not in a room yet
 * @param {'a' | 'b' | null} role — from routing; null before room is joined
 */
export function useWebSocket(roomId, role) {
  const applyState          = useSessionStore(s => s.applySessionState)
  const appendMessages      = useSessionStore(s => s.appendMessages)
  const setTyping           = useSessionStore(s => s.setTypingStatus)
  const setConnStatus       = useSessionStore(s => s.setConnectionStatus)
  const confirmOptimistic   = useSessionStore(s => s.confirmOptimisticMessage)
  const setReconnecting     = useSessionStore(s => s.setReconnecting)

  // Track whether we successfully connected this mount cycle.
  // Prevents StrictMode's double-mount from opening duplicate connections.
  const connectedRef        = useRef(false)
  const cleanedUpRef        = useRef(false)

  useEffect(() => {
    // React StrictMode unmounts + remounts in development.
    // The cleanup from the first mount sets cleanedUpRef to true,
    // and the second mount sees it's been cleaned up and proceeds normally.
    cleanedUpRef.current = false

    if (!roomId || !role) return

    // ── Register event handlers ─────────────────────────────────────────────

    const unsubscribers = []

    const unsub = (...args) => unsubscribers.push(alindaWS.on(...args))

    // Server confirmed one or more new messages — may include partner messages,
    // AI messages, or system messages. Deduplication already applied by alindaWS.
    unsub('new_message', (messages) => {
      if (cleanedUpRef.current) return
      appendMessages(messages)
      // Check if any confirmed message was an optimistic one we sent
      messages.forEach(msg => {
        if (msg.extra_data?.client_id !== undefined) {
          confirmOptimistic(msg.extra_data.client_id)
        }
      })
    })

    // Full session state update — FSM mode changed, turn changed, etc.
    // This is the primary synchronization mechanism.
    unsub('state_update', (state) => {
      if (cleanedUpRef.current) return
      applyState(state)
    })

    // Typing indicator — role is the partner's role ('a', 'b', or 'ai')
    unsub('typing_status', ({ role: typingRole, is_typing }) => {
      if (cleanedUpRef.current) return
      setTyping(typingRole, is_typing)
    })

    // Idle redirect — server generated a system message handing off the floor.
    // Comes as a { message } payload; treated as a new system message.
    unsub('idle_redirect', ({ message }) => {
      if (cleanedUpRef.current) return
      // Construct a minimal message-like object for the store
      appendMessages([{
        id:           `idle-redirect-${Date.now()}`,
        sender:        'system',
        message_type:  'system',
        content:       message,
        timestamp:     new Date().toISOString(),
        extra_data:    { type: 'turn_assignment' },
      }])
    })

    // Connection state events
    unsub('connected', () => {
      if (cleanedUpRef.current) return
      setConnStatus('online')
    })

    unsub('disconnected', () => {
      if (cleanedUpRef.current) return
      setConnStatus('degraded')
    })

    unsub('reconnecting', ({ attempt, delayMs }) => {
      if (cleanedUpRef.current) return
      setReconnecting?.(attempt, delayMs)
      setConnStatus(attempt >= 3 ? 'offline' : 'degraded')
    })

    unsub('connection_status', (status) => {
      if (cleanedUpRef.current) return
      // Translate WebSocket status to our three-tier health model
      const healthMap = {
        connected:    'online',
        connecting:   'degraded',
        reconnecting: 'degraded',
        disconnected: 'degraded',
        closed:       'offline',
        closing:      'degraded',
      }
      setConnStatus(healthMap[status] ?? 'degraded')
    })

    unsub('error', ({ type, message }) => {
      if (cleanedUpRef.current) return
      console.warn('[useWebSocket] Server error:', type, message)
      // Non-fatal errors (server_error, outbox_full) are logged.
      // Fatal errors (room_not_found, forbidden) close the connection —
      // sessionStore should listen for mode:'closed' via applyState.
    })

    // ── REST API connection health ──────────────────────────────────────────
    // The REST API has its own health tracking (used for polling fallback).
    // We subscribe to it here to unify health signals in sessionStore.
    const unsubHealth = onConnectionHealth((health) => {
      if (cleanedUpRef.current) return
      // Only downgrade, never upgrade — WS connection success handles upgrade.
      if (health === 'offline') setConnStatus('offline')
    })

    // ── Open the connection ────────────────────────────────────────────────
    // Only connect if not already connected to this room+role pair.
    // This guards against StrictMode double-invocation.
    if (!connectedRef.current) {
      alindaWS.connect(roomId, role)
      connectedRef.current = true
    }

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      cleanedUpRef.current  = true
      connectedRef.current  = false

      // Unregister all event listeners
      unsubscribers.forEach(fn => fn())
      unsubHealth()

      // In development (StrictMode), we intentionally do NOT close the socket
      // on the first cleanup — the socket should survive the remount.
      // In production, this cleanup only runs on genuine unmount (route change,
      // tab close) — we do close.
      if (process.env.NODE_ENV === 'production') {
        alindaWS.close('component_unmount')
      }
    }
  }, [roomId, role, applyState, appendMessages, setTyping, setConnStatus, confirmOptimistic, setReconnecting])

  // ── Return connection status for components that need to render it ────────
  // This is a read-only passthrough — no local state, no re-renders from here.
  return {
    isConnected:  alindaWS.isConnected,
    outboxCount:  alindaWS.outboxCount,
    status:       alindaWS.status,
  }
}