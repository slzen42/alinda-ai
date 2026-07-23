/**
 * src/lib/websocket.js
 *
 * The real-time nervous system for Alinda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY: UNBROKEN PRESENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Therapy depends on presence. A dropped connection that silently loses a
 * message — especially a message typed during a moment of acute vulnerability —
 * is a betrayal of the therapeutic frame. The user typed something real.
 * That cannot disappear.
 *
 * Two specific failure modes this file makes impossible:
 *
 * LOST MESSAGE (The Train-Tunnel Problem):
 *   Cell service dies mid-sentence. The user finishes typing and taps send.
 *   The message appears in the UI immediately (optimistic local state in
 *   sessionStore.js). This module places it in the offline outbox. The moment
 *   the WebSocket reconnects, the outbox flushes in chronological order.
 *   The vulnerability was held, not lost.
 *
 * SILENT DISCONNECTION (The Dead-Socket Problem):
 *   TCP can take up to 60 seconds to detect a dropped connection. A user
 *   waiting for a response for 60 seconds, wondering if Alinda heard them,
 *   is a clinical failure. Application-level heartbeats detect death in ≤10s.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE: PURE EVENT EMITTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This class extends a minimal EventEmitter. It knows nothing about React,
 * nothing about Zustand, nothing about components. It only:
 *   - Opens, maintains, and reconnects a WebSocket connection
 *   - Receives frames and emits typed events
 *   - Queues outbound messages when disconnected
 *   - Enforces deduplication and ordering on inbound messages
 *
 * sessionStore.js registers listeners via alindaWS.on('new_message', handler).
 * When the handler fires, it updates Zustand state, which triggers React.
 * The transport and the UI never directly touch each other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FRAME VOCABULARY (matching backend/websocket_manager.py)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Inbound (server → client):
 *   { type: 'ping',          payload: {} }
 *   { type: 'new_message',   payload: MessageResponse[] }
 *   { type: 'state_update',  payload: SessionStateResponse }
 *   { type: 'typing_status', payload: { role, is_typing } }
 *   { type: 'idle_redirect', payload: { message } }
 *   { type: 'error',         payload: { detail } }
 *
 * Outbound (client → server):
 *   { type: 'pong',          payload: {} }
 *   { type: 'message',       payload: { content, client_id } }
 *   { type: 'typing_status', payload: { is_typing } }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MESSAGE ORDERING AND DEDUPLICATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each outbound message gets a `client_id` — a monotonically increasing
 * integer combined with a timestamp. The server echoes confirmed messages
 * back as 'new_message' frames containing the persisted ChatMessage.
 *
 * When the client receives a 'new_message' frame, it checks:
 *   1. Is the message ID already in the seen-set? Drop it (duplicate).
 *   2. Is the message's client_id in the outbox? Remove from outbox (confirmed).
 *
 * This handles the reconnect-replay scenario: if the server replays messages
 * from before the reconnection, they're caught by the seen-set and dropped.
 */


// ─────────────────────────────────────────────────────────────────────────────
// MINIMAL EVENT EMITTER
//
// Deliberately not using Node's EventEmitter (not available in browsers)
// or a third-party library. This 40-line implementation is all we need.
// ─────────────────────────────────────────────────────────────────────────────

class EventEmitter {
    constructor() {
      this._listeners = new Map()   // event → Set<handler>
    }
  
    on(event, handler) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set())
      this._listeners.get(event).add(handler)
      return () => this.off(event, handler)   // returns unsubscribe fn
    }
  
    off(event, handler) {
      this._listeners.get(event)?.delete(handler)
    }
  
    emit(event, data) {
      this._listeners.get(event)?.forEach(fn => {
        try { fn(data) }
        catch (err) { console.error(`[AlindaWS] Error in '${event}' listener:`, err) }
      })
    }
  
    removeAllListeners(event) {
      if (event) this._listeners.delete(event)
      else this._listeners.clear()
    }
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  const WS_BASE = (() => {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
    // Derive from current page URL (handles both HTTP and HTTPS → WS/WSS)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}`
  })()
  
  const CONFIG = Object.freeze({
    HEARTBEAT_INTERVAL_MS:   8_000,   // ping every 8 seconds
    PONG_TIMEOUT_MS:         5_000,   // declare dead if no pong within 5s after ping
    MISSED_PONGS_THRESHOLD:  2,       // consecutive missed pongs before disconnect
    RECONNECT_BASE_MS:       500,     // initial reconnect wait
    RECONNECT_MAX_MS:        30_000,  // ceiling reconnect wait (30s)
    RECONNECT_MAX_ATTEMPTS:  Infinity, // never give up during an active session
    DEDUP_CACHE_SIZE:        200,     // max message IDs to remember for dedup
    OUTBOX_MAX:              50,      // max queued messages (safety ceiling)
  })
  
  // Connection states — emitted as 'connection_status' events
  export const ConnectionStatus = Object.freeze({
    CONNECTING:    'connecting',
    CONNECTED:     'connected',
    DISCONNECTED:  'disconnected',
    RECONNECTING:  'reconnecting',
    CLOSING:       'closing',
    CLOSED:        'closed',
  })
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ALINDA WEB SOCKET CLIENT
  // ─────────────────────────────────────────────────────────────────────────────
  
  class AlindaWebSocketClient extends EventEmitter {
    constructor() {
      super()
  
      this._ws                  = null
      this._roomId              = null
      this._role                = null
      this._status              = ConnectionStatus.CLOSED
      this._reconnectAttempt    = 0
      this._intentionalClose    = false
  
      // Heartbeat
      this._heartbeatTimer      = null
      this._pongTimer           = null
      this._missedPongs         = 0
  
      // Outbox — queued messages pending connection
      this._outbox              = []   // { clientId, payload, timestamp }
      this._clientIdCounter     = 0
  
      // Deduplication — seen server-assigned message IDs
      this._seenIds             = new Set()
      this._seenIdsQueue        = []   // ordered list for eviction (FIFO)
  
      // Reconnect timer handle
      this._reconnectTimer      = null
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // CONNECTION LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Opens a WebSocket connection to the given room and role.
     * Safe to call multiple times — cleanly replaces any existing connection.
     *
     * URL shape matches backend/websocket_manager.py:
     *   wss://domain/ws/{room_id}/{role}
     *
     * @param {string} roomId
     * @param {'a' | 'b'} role
     */
    connect(roomId, role) {
      this._roomId            = roomId
      this._role              = role
      this._intentionalClose  = false
  
      this._openSocket()
    }
  
    /**
     * Closes the connection intentionally.
     * Suppresses reconnection logic. Flushes outbox to REST API before closing
     * so pending messages are not lost even on deliberate disconnect.
     *
     * @param {string} [reason]
     */
    async close(reason = 'client_close') {
      this._intentionalClose = true
      this._clearTimers()
  
      // Flush remaining outbox via REST before closing
      if (this._outbox.length > 0) {
        await this._flushOutboxViaRest()
      }
  
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.close(1000, reason)
      }
  
      this._setStatus(ConnectionStatus.CLOSED)
      this.emit('closed', { reason })
    }
  
    /**
     * Opens the native WebSocket and binds event handlers.
     * @private
     */
    _openSocket() {
      if (!this._roomId || !this._role) return
  
      this._clearTimers()
      this._setStatus(ConnectionStatus.CONNECTING)
  
      const url = `${WS_BASE}/ws/${this._roomId}/${this._role}`
  
      try {
        this._ws = new WebSocket(url)
      } catch (err) {
        console.error('[AlindaWS] Failed to construct WebSocket:', err)
        this._scheduleReconnect()
        return
      }
  
      this._ws.onopen    = this._handleOpen.bind(this)
      this._ws.onmessage = this._handleMessage.bind(this)
      this._ws.onclose   = this._handleClose.bind(this)
      this._ws.onerror   = this._handleError.bind(this)
    }
  
    _handleOpen() {
      this._reconnectAttempt = 0
      this._missedPongs      = 0
      this._setStatus(ConnectionStatus.CONNECTED)
      this.emit('connected', { roomId: this._roomId, role: this._role })
  
      this._startHeartbeat()
      this._flushOutbox()
    }
  
    _handleClose(event) {
      this._clearTimers()
  
      if (this._intentionalClose || event.code === 1000) {
        this._setStatus(ConnectionStatus.CLOSED)
        return
      }
  
      // Application-level close codes from backend/websocket_manager.py
      if (event.code === 4404) {
        this.emit('error', { type: 'ROOM_NOT_FOUND', message: 'Room not found.' })
        this._setStatus(ConnectionStatus.CLOSED)
        return
      }
      if (event.code === 4403) {
        this.emit('error', { type: 'FORBIDDEN', message: 'Role not authorized in this room.' })
        this._setStatus(ConnectionStatus.CLOSED)
        return
      }
  
      // Unexpected close — schedule reconnect
      this._setStatus(ConnectionStatus.DISCONNECTED)
      this._scheduleReconnect()
    }
  
    _handleError(event) {
      // WebSocket onerror fires just before onclose.
      // We handle reconnection in onclose to avoid double-triggering.
      console.warn('[AlindaWS] WebSocket error event (close follows):', event.type)
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // INBOUND MESSAGE HANDLING
    // ─────────────────────────────────────────────────────────────────────────
  
    _handleMessage(event) {
      let frame
      try {
        frame = JSON.parse(event.data)
      } catch {
        console.warn('[AlindaWS] Received non-JSON frame:', event.data)
        return
      }
  
      const { type, payload } = frame
  
      switch (type) {
        case 'ping':
          // Reply immediately — server expects pong within _PONG_TIMEOUT_MS
          this._send({ type: 'pong', payload: {} })
          return
  
        case 'new_message':
          this._handleNewMessages(payload)
          return
  
        case 'state_update':
          this.emit('state_update', payload)
          return
  
        case 'typing_status':
          this.emit('typing_status', payload)
          return
  
        case 'idle_redirect':
          // Server generated a system message — emit as new_message for consistency
          this.emit('idle_redirect', payload)
          return
  
        case 'error':
          this.emit('error', { type: 'SERVER_ERROR', message: payload?.detail ?? 'Unknown error.' })
          return
  
        default:
          // Unknown frame type — forward as generic event in case sessionStore
          // wants to handle future frame types without updating this file
          this.emit(type, payload)
      }
    }
  
    /**
     * Processes incoming message frames, applying deduplication.
     * A message seen before (same server-assigned id) is silently dropped.
     * Outbox entries whose client_id is confirmed by this message are removed.
     *
     * @param {Array} messages — array of MessageResponse objects
     * @private
     */
    _handleNewMessages(messages) {
      if (!Array.isArray(messages)) messages = [messages]
  
      const fresh = messages.filter(msg => {
        if (!msg?.id) return true   // no ID — can't dedup, pass through
  
        if (this._seenIds.has(msg.id)) {
          return false   // duplicate — drop
        }
  
        // Add to seen set with FIFO eviction
        this._seenIds.add(msg.id)
        this._seenIdsQueue.push(msg.id)
        if (this._seenIdsQueue.length > CONFIG.DEDUP_CACHE_SIZE) {
          const evicted = this._seenIdsQueue.shift()
          this._seenIds.delete(evicted)
        }
  
        // If this message was optimistically queued in the outbox, confirm it
        if (msg.extra_data?.client_id !== undefined) {
          this._outbox = this._outbox.filter(
            o => o.clientId !== msg.extra_data.client_id
          )
        }
  
        return true
      })
  
      if (fresh.length > 0) {
        this.emit('new_message', fresh)
      }
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // HEARTBEAT
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Starts the application-level ping/pong loop.
     * The server pings us every 25s (from backend/websocket_manager.py).
     * We ping the server every 8s to detect connection death faster.
     *
     * If CONFIG.MISSED_PONGS_THRESHOLD consecutive pongs are missed,
     * we declare the connection dead and reconnect.
     * @private
     */
    _startHeartbeat() {
      this._clearHeartbeatTimers()
  
      this._heartbeatTimer = setInterval(() => {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return
  
        // Send application-level ping
        this._send({ type: 'ping', payload: {} })
  
        // Wait for pong — if it doesn't arrive in time, count as missed
        this._pongTimer = setTimeout(() => {
          this._missedPongs++
          console.warn(`[AlindaWS] Pong ${this._missedPongs} missed (threshold: ${CONFIG.MISSED_PONGS_THRESHOLD})`)
  
          if (this._missedPongs >= CONFIG.MISSED_PONGS_THRESHOLD) {
            console.warn('[AlindaWS] Connection presumed dead. Reconnecting.')
            this._ws?.close()
            this._scheduleReconnect()
          }
        }, CONFIG.PONG_TIMEOUT_MS)
  
      }, CONFIG.HEARTBEAT_INTERVAL_MS)
  
      // Listen for pongs to clear the timeout
      const handlePong = () => {
        this._missedPongs = 0
        clearTimeout(this._pongTimer)
      }
      this.on('pong_received', handlePong)
    }
  
    _clearHeartbeatTimers() {
      clearInterval(this._heartbeatTimer)
      clearTimeout(this._pongTimer)
      this._heartbeatTimer = null
      this._pongTimer      = null
    }
  
    _clearTimers() {
      this._clearHeartbeatTimers()
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // RECONNECTION WITH EXPONENTIAL BACKOFF + JITTER
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Schedules a reconnection attempt using exponential backoff with jitter.
     *
     * Base delay doubles each attempt: 500ms → 1s → 2s → 4s → ... → 30s.
     * Jitter ±30%: prevents 1,000 devices from hitting the server simultaneously
     * after a shared outage (thundering herd).
     * @private
     */
    _scheduleReconnect() {
      if (this._intentionalClose) return
      if (this._reconnectAttempt >= CONFIG.RECONNECT_MAX_ATTEMPTS) {
        this.emit('error', { type: 'MAX_RECONNECTS', message: 'Could not reconnect after multiple attempts.' })
        this._setStatus(ConnectionStatus.CLOSED)
        return
      }
  
      const base      = Math.min(
        CONFIG.RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
        CONFIG.RECONNECT_MAX_MS
      )
      const jitter    = base * (0.7 + Math.random() * 0.6)   // ±30%
      const delay     = Math.round(jitter)
  
      this._reconnectAttempt++
      this._setStatus(ConnectionStatus.RECONNECTING)
  
      this.emit('reconnecting', {
        attempt: this._reconnectAttempt,
        delayMs: delay,
      })
  
      this._reconnectTimer = setTimeout(() => {
        this._openSocket()
      }, delay)
    }
  
  
    // ─────────────────────────────────────────────────────────────────────────
    // OUTBOUND MESSAGING
    // ─────────────────────────────────────────────────────────────────────────
  
    /**
     * Sends a frame, or queues it if the socket is not open.
     *
     * @param {{ type: string, payload: Object }} frame
     * @returns {boolean} — true if sent immediately, false if queued
     * @private
     */
    _send(frame) {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        try {
          this._ws.send(JSON.stringify(frame))
          return true
        } catch (err) {
          console.error('[AlindaWS] Send failed:', err)
          return false
        }
      }
      return false
    }
  
    /**
     * Sends a chat message.
     *
     * If connected: sends immediately.
     * If disconnected: adds to outbox with a client_id for dedup + ordering.
     *
     * The caller (sessionStore.js) shows the message optimistically in the UI
     * immediately, tagged with the client_id. When the server confirms the
     * message, the server's response contains the client_id in extra_data,
     * and the local optimistic version is replaced by the confirmed version.
     *
     * @param {string} content — the message text
     * @returns {{ clientId: number, queued: boolean }}
     */
    sendMessage(content) {
      const clientId = ++this._clientIdCounter
      const payload  = { content, client_id: clientId }
  
      const sent = this._send({ type: 'message', payload })
  
      if (!sent) {
        // Offline — queue for later delivery
        if (this._outbox.length < CONFIG.OUTBOX_MAX) {
          this._outbox.push({
            clientId,
            payload,
            timestamp: Date.now(),
          })
          this.emit('message_queued', { clientId, content })
        } else {
          console.error('[AlindaWS] Outbox full — message dropped:', content)
          this.emit('error', {
            type:    'OUTBOX_FULL',
            message: 'Too many unsent messages. Please check your connection.',
          })
        }
      }
  
      return { clientId, queued: !sent }
    }
  
    /**
     * Sends a typing indicator update.
     * Fire-and-forget — not queued in the outbox (typing indicators are ephemeral).
     *
     * @param {boolean} isTyping
     */
    sendTypingStatus(isTyping) {
      this._send({ type: 'typing_status', payload: { is_typing: isTyping } })
    }
  
    /**
     * Flushes the outbox in order once a connection is available.
     * Messages are sent in chronological order (the order the user typed them).
     * Each send is separated by one frame (via microtask queue) to prevent
     * flooding the server with a burst of queued messages.
     * @private
     */
    _flushOutbox() {
      if (this._outbox.length === 0) return
  
      const toSend = [...this._outbox]
      this._outbox = []   // optimistically clear; re-add if send fails
  
      toSend.forEach((item, index) => {
        setTimeout(() => {
          const sent = this._send({ type: 'message', payload: item.payload })
          if (!sent) {
            // Socket closed again before we finished flushing — re-queue
            this._outbox.unshift(item)
          } else {
            this.emit('message_delivered', { clientId: item.clientId })
          }
        }, index * 50)   // 50ms between each flushed message
      })
    }
  
    /**
     * Fallback flush via REST API when the WebSocket closes intentionally
     * and there are still queued messages (e.g., user ends session while offline).
     * Imported lazily to avoid circular dependency (api.js ↔ websocket.js).
     * @private
     */
    async _flushOutboxViaRest() {
      if (this._outbox.length === 0 || !this._roomId || !this._role) return
  
      const { api } = await import('./api.js')
      const toSend  = [...this._outbox]
      this._outbox  = []
  
      for (const item of toSend) {
        try {
          await api.sendMessage({
            room_id: this._roomId,
            sender:  this._role,
            content: item.payload.content,
        })
        this.emit('message_delivered', { clientId: item.clientId })
      } catch (err) {
        console.error('[AlindaWS] REST fallback send failed:', err)
        this.emit('message_lost', { clientId: item.clientId })
      }
    }
  }


  // ─────────────────────────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────────────────────────

  _setStatus(status) {
    if (this._status === status) return
    this._status = status
    this.emit('connection_status', status)
  }

  /** Current connection status — one of ConnectionStatus constants. */
  get status()      { return this._status }

  /** Whether the socket is currently open and messages can be sent immediately. */
  get isConnected() { return this._status === ConnectionStatus.CONNECTED }

  /** Number of messages waiting in the outbox. */
  get outboxCount() { return this._outbox.length }

  /** The room_id this client is connected to (null if not connected). */
  get roomId()      { return this._roomId }
}


// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The application WebSocket singleton.
 * One instance, one connection, one room at a time.
 *
 * Usage:
 *   import { alindaWS, ConnectionStatus } from 'lib/websocket'
 *
 *   alindaWS.connect(roomId, role)
 *
 *   const unsub = alindaWS.on('new_message', messages => {
 *     sessionStore.getState().appendMessages(messages)
 *   })
 *
 *   alindaWS.on('connection_status', status => {
 *     sessionStore.getState().setConnectionStatus(status)
 *   })
 *
 *   // On component unmount / session end:
 *   unsub()
 *   await alindaWS.close()
 */
export const alindaWS = new AlindaWebSocketClient()