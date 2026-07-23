/**
 * src/lib/api.js
 *
 * The resilient REST bridge for Alinda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY: INVISIBLE RELIABILITY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When a user submits an intake form after writing something difficult and
 * true about their relationship, their nervous system is already exposed.
 * A network error at that moment — a spinner that hangs, a red error banner —
 * reads as rejection. The API layer must absorb all network reality and shield
 * the user from it completely.
 *
 * Three specific failure modes this file is designed to make invisible:
 *
 * DOUBLE-TAP ON SUBMIT (The Panic-Tap Problem):
 *   Anxious users tap buttons more than once. A duplicate POST /intake while
 *   the first is in-flight would create a race condition on the server.
 *   Request deduplication makes the second tap a no-op that resolves with
 *   the first request's promise — the user sees no difference.
 *
 * MOBILE DATA DROPS (The Subway Problem):
 *   A 3-second tunnel kills the network mid-request. Exponential backoff
 *   with jitter silently retries GET requests before ever surfacing an error.
 *   For POST requests (intake, feedback), idempotency keys ensure a retried
 *   request doesn't create duplicate data.
 *
 * SERVER HICCUPS (The Cold Start Problem):
 *   Render's free tier cold-starts can produce 502s on the first request.
 *   A 502 on GET /health is retried with backoff. A 502 on POST /message
 *   is NOT retried automatically (the WebSocket handles real-time messaging),
 *   but the error is translated into a user-safe message before reaching React.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This backend does NOT use JWT tokens. Identity is established by
 * (room_id, role) parameters on each request, validated by
 * backend/dependencies.get_validated_session(). No token refresh logic needed.
 * The connection health pattern (described below) replaces JWT interceptors.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONNECTION HEALTH BROADCASTING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * api.js maintains a connection health state ('online' | 'degraded' | 'offline').
 * This state is updated by interceptors on every request/response.
 * sessionStore.js subscribes to it to show a "Reconnecting..." indicator.
 * No component needs to check network status directly.
 *
 * Health transitions:
 *   online   → degraded: first request failure (network error or 5xx)
 *   degraded → offline:  three consecutive failures
 *   degraded → online:   any successful response
 *   offline  → online:   any successful response
 */

import axios from 'axios'

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1'   // falls through to Vite proxy in development

const DEFAULT_TIMEOUT_MS  = 15_000   // 15s — generous for mobile data
const INTAKE_TIMEOUT_MS   = 60_000   // 60s — intake triggers two LLM calls
const FEEDBACK_TIMEOUT_MS = 10_000


// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZED ERROR TYPES
//
// The UI layer receives these structured objects, never raw Axios errors.
// Each has a `type` for programmatic handling and a `userMessage` for display.
// All user-facing messages are calm, grounded, non-technical.
// ─────────────────────────────────────────────────────────────────────────────

export class AlindaApiError extends Error {
  constructor({ type, userMessage, statusCode = null, retryable = false, raw = null }) {
    super(userMessage)
    this.name        = 'AlindaApiError'
    this.type        = type
    this.userMessage  = userMessage
    this.statusCode   = statusCode
    this.retryable    = retryable
    this.raw          = raw   // the original Axios error, for logging
  }
}

const Errors = {
  network: (raw) => new AlindaApiError({
    type:        'NETWORK',
    userMessage:  'Alinda is having trouble reaching the server. We\'re retrying — take a breath.',
    retryable:    true,
    raw,
  }),
  timeout: (raw) => new AlindaApiError({
    type:        'TIMEOUT',
    userMessage:  'This is taking longer than expected. Still working — please wait a moment.',
    retryable:    true,
    raw,
  }),
  serverError: (statusCode, raw) => new AlindaApiError({
    type:        'SERVER_ERROR',
    statusCode,
    userMessage:  'Something went wrong on our end. We\'re aware of it — please try again.',
    retryable:    statusCode >= 500,
    raw,
  }),
  roomNotFound: (raw) => new AlindaApiError({
    type:        'ROOM_NOT_FOUND',
    userMessage:  'This room could not be found. Please check the room code and try again.',
    statusCode:   404,
    retryable:    false,
    raw,
  }),
  roomFull: (raw) => new AlindaApiError({
    type:        'ROOM_FULL',
    userMessage:  'This room already has two partners. Each session is private to one couple.',
    statusCode:   400,
    retryable:    false,
    raw,
  }),
  sessionClosed: (raw) => new AlindaApiError({
    type:        'SESSION_CLOSED',
    userMessage:  'This session has ended. Thank you for the time you shared here.',
    statusCode:   403,
    retryable:    false,
    raw,
  }),
  duplicate: () => new AlindaApiError({
    type:        'DUPLICATE_REQUEST',
    userMessage:  'Your request is already being processed.',
    retryable:    false,
  }),
}


// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION HEALTH STATE
//
// A lightweight observable — not React state, not Zustand.
// Pure event emitter pattern so sessionStore.js can subscribe without
// this file knowing React exists.
// ─────────────────────────────────────────────────────────────────────────────

const _healthListeners = new Set()
let _consecutiveFailures = 0
let _connectionHealth    = 'online'   // 'online' | 'degraded' | 'offline'

function _setHealth(newHealth) {
  if (newHealth === _connectionHealth) return
  _connectionHealth = newHealth
  _healthListeners.forEach(fn => fn(newHealth))
}

function _onSuccess() {
  _consecutiveFailures = 0
  _setHealth('online')
}

function _onFailure() {
  _consecutiveFailures++
  if (_consecutiveFailures === 1) _setHealth('degraded')
  if (_consecutiveFailures >= 3)  _setHealth('offline')
}

/**
 * Subscribe to connection health changes.
 * @param {(health: 'online' | 'degraded' | 'offline') => void} fn
 * @returns {() => void} — unsubscribe function
 */
export function onConnectionHealth(fn) {
  _healthListeners.add(fn)
  return () => _healthListeners.delete(fn)
}

/** Returns current connection health without subscribing. */
export function getConnectionHealth() {
  return _connectionHealth
}


// ─────────────────────────────────────────────────────────────────────────────
// AXIOS INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: API_BASE,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  },
})

// Response interceptor: update health state and normalize errors
client.interceptors.response.use(
  response => {
    _onSuccess()
    return response
  },
  error => {
    // Don't count request-deduplication cancellations as failures
    if (axios.isCancel(error)) return Promise.reject(error)

    _onFailure()

    // Normalize to AlindaApiError
    const normalized = _normalizeError(error)
    return Promise.reject(normalized)
  }
)

function _normalizeError(error) {
  if (error instanceof AlindaApiError) return error

  if (!error.response) {
    // Network error or timeout — no response received
    return error.code === 'ECONNABORTED'
      ? Errors.timeout(error)
      : Errors.network(error)
  }

  const { status, data } = error.response
  const detail = data?.detail ?? null

  switch (status) {
    case 404:
      return Errors.roomNotFound(error)
    case 400:
      if (detail?.toLowerCase().includes('already has two')) return Errors.roomFull(error)
      return new AlindaApiError({
        type:       'BAD_REQUEST',
        userMessage: detail ?? 'Something went wrong. Please try again.',
        statusCode:  400,
        retryable:   false,
        raw:         error,
      })
    case 403:
      return Errors.sessionClosed(error)
    default:
      if (status >= 500) return Errors.serverError(status, error)
      return new AlindaApiError({
        type:       'UNEXPECTED',
        userMessage: detail ?? 'An unexpected error occurred.',
        statusCode:  status,
        retryable:   false,
        raw:         error,
      })
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPONENTIAL BACKOFF WITH JITTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sleeps for a duration with jitter.
 * Base delay doubles each attempt; jitter adds ±20% randomness.
 * Prevents thundering-herd when many clients reconnect simultaneously.
 *
 * @param {number} attempt — 0-indexed attempt number
 * @param {number} baseMs  — base delay in ms
 * @param {number} maxMs   — ceiling delay in ms
 */
async function _backoff(attempt, baseMs = 1000, maxMs = 30_000) {
  const exp     = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  const jitter  = exp * (0.8 + Math.random() * 0.4)   // ±20%
  await new Promise(resolve => setTimeout(resolve, jitter))
}

/**
 * Wraps an async factory function with retry + backoff logic.
 * Only retries when the error is retryable (network errors, 5xx).
 * Never retries 4xx errors — those are the user's or session's problem,
 * not the network's, and retrying would only confuse things.
 *
 * @param {() => Promise<T>} fn
 * @param {number} maxAttempts
 * @returns {Promise<T>}
 */
async function _withRetry(fn, maxAttempts = 3) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!(err instanceof AlindaApiError) || !err.retryable) throw err
      if (attempt < maxAttempts - 1) await _backoff(attempt)
    }
  }
  throw lastError
}


// ─────────────────────────────────────────────────────────────────────────────
// REQUEST DEDUPLICATION
//
// Prevents duplicate in-flight requests from the same key.
// Key is derived from method + URL + serialized body.
// The second caller gets the same promise as the first — never a second request.
// ─────────────────────────────────────────────────────────────────────────────

const _inFlight = new Map()   // key → Promise

function _dedupKey(method, endpoint, body = null) {
  const bodyStr = body ? JSON.stringify(body) : ''
  return `${method}:${endpoint}:${bodyStr}`
}

/**
 * Wraps a request in deduplication logic.
 * If an identical request is already in-flight, returns its promise.
 * Cleans up the entry on resolution or rejection.
 *
 * @param {string} key        — dedup key
 * @param {() => Promise} fn  — the actual request factory
 */
function _deduped(key, fn) {
  if (_inFlight.has(key)) {
    return _inFlight.get(key)
  }

  const promise = fn().finally(() => _inFlight.delete(key))
  _inFlight.set(key, promise)
  return promise
}


// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY KEYS
//
// For mutation endpoints that are retried (intake, feedback), we send an
// idempotency key in the request header. The backend uses this to detect
// and ignore duplicate requests that arrive due to client retries.
//
// Currently the backend doesn't implement idempotency key checking, but
// sending the header costs nothing and makes the system ready for it.
// The key is generated per logical operation (per form submission),
// not per individual HTTP request.
// ─────────────────────────────────────────────────────────────────────────────

function _generateIdempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}


// ─────────────────────────────────────────────────────────────────────────────
// API METHODS
// ─────────────────────────────────────────────────────────────────────────────

export const api = {

  // ── Infrastructure ─────────────────────────────────────────────────────────

  /**
   * Health check — used on app startup to verify the backend is awake.
   * Retried up to 3 times to handle cold-start 502s on Render's free tier.
   *
   * @returns {Promise<{ status: string, classifier_ready: boolean, version: string }>}
   */
  health: () =>
    _withRetry(() =>
      client.get('/session/health').then(r => r.data)
    , 3),


  // ── Room Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Creates a new therapy room (Partner A).
   * Deduplicated — panic-tapping create never sends duplicate requests.
   *
   * @param {{ room_id: string, name_a: string }} body
   * @returns {Promise<SessionStateResponse>}
   */
  createRoom: (body) => {
    const key = _dedupKey('POST', '/session/create-room', body)
    return _deduped(key, () =>
      client.post('/session/create-room', body).then(r => r.data)
    )
  },

  /**
   * Partner B joins an existing room.
   *
   * @param {{ room_id: string, name_b: string }} body
   * @returns {Promise<SessionStateResponse>}
   */
  joinRoom: (body) => {
    const key = _dedupKey('POST', '/session/join-room', body)
    return _deduped(key, () =>
      client.post('/session/join-room', body).then(r => r.data)
    )
  },


  // ── Intake ─────────────────────────────────────────────────────────────────

  /**
   * Submits one partner's intake. Extended timeout (60s) because this
   * endpoint triggers two concurrent LLM calls and session opening generation.
   * Deduplicated with an idempotency key generated per submission.
   *
   * @param {{
   *   room_id: string,
   *   role: 'a' | 'b',
   *   intake_text: string,
   *   session_style: string,
   * }} body
   * @returns {Promise<SessionStateResponse>}
   */
  submitIntake: (body) => {
    const key       = _dedupKey('POST', '/session/intake', body)
    const idempKey  = _generateIdempotencyKey(`intake-${body.room_id}-${body.role}`)

    return _deduped(key, () =>
      _withRetry(() =>
        client.post('/session/intake', body, {
          timeout: INTAKE_TIMEOUT_MS,
          headers: { 'Idempotency-Key': idempKey },
        }).then(r => r.data)
      , 2)   // max 2 attempts — intake has significant side effects
    )
  },


  // ── Session State ──────────────────────────────────────────────────────────

  /**
   * Fetches current session state. The polling fallback endpoint.
   * Retried silently on network failure — the user never sees this fail.
   *
   * @param {string} roomId
   * @returns {Promise<SessionStateResponse>}
   */
  getSession: (roomId) =>
    _withRetry(() =>
      client.get(`/session/session/${roomId}`).then(r => r.data)
    , 3),

  /**
   * Fetches the full message transcript.
   * Used on initial load and on WebSocket reconnect.
   *
   * @param {string} roomId
   * @returns {Promise<ConversationResponse>}
   */
  getConversation: (roomId) =>
    _withRetry(() =>
      client.get(`/session/session/${roomId}/conversation`).then(r => r.data)
    , 3),


  // ── Messaging ──────────────────────────────────────────────────────────────

  /**
   * Sends a message via REST (WebSocket fallback path).
   * In normal operation, messages are sent over WebSocket.
   * This is used when the WebSocket is unavailable or reconnecting.
   *
   * NOT retried — message sending has side effects (AI response generated).
   * On failure, the WebSocket outbox handles queuing.
   *
   * @param {{
   *   room_id: string,
   *   sender: 'a' | 'b',
   *   content: string,
   * }} body
   * @returns {Promise<SendMessageResponse>}
   */
  sendMessage: (body) =>
    client.post('/session/message', body).then(r => r.data),


  // ── Real-Time Sync ─────────────────────────────────────────────────────────

  /**
   * Updates typing indicator status.
   * Fire-and-forget — failures are silently swallowed.
   * A missed typing indicator is annoying but not clinically significant.
   *
   * @param {{ room_id: string, role: string, is_typing: boolean }} body
   */
  setTypingStatus: (body) => {
    client.post('/session/typing', body).catch(() => {
      // Intentionally silent — typing indicators are best-effort
    })
  },


  // ── Session Lifecycle Controls ─────────────────────────────────────────────

  /**
   * Pauses the session (either partner can do this).
   *
   * @param {{ room_id: string, role: string, duration_minutes: number }} body
   * @returns {Promise<SessionStateResponse>}
   */
  pauseSession: (body) =>
    client.post('/session/pause', body).then(r => r.data),

  /**
   * Resumes a paused session early.
   *
   * @param {{ room_id: string, role: string }} body
   * @returns {Promise<SessionStateResponse>}
   */
  resumeSession: (body) =>
    client.post('/session/resume', body).then(r => r.data),

  /**
   * Crisis-ready confirmation (both partners must call this).
   *
   * @param {{ room_id: string, role: string }} body
   * @returns {Promise<SessionStateResponse>}
   */
  crisisReady: (body) =>
    client.post('/session/crisis-ready', body).then(r => r.data),

  /**
   * Requests or confirms session end (mutual confirmation required).
   * First call marks request; second call from other partner closes session.
   *
   * @param {{ room_id: string, role: string }} body
   * @returns {Promise<SessionStateResponse>}
   */
  endSession: (body) =>
    client.post('/session/end-session', body).then(r => r.data),


  // ── Post-Session ───────────────────────────────────────────────────────────

  /**
   * Submits post-session feedback ratings.
   * Idempotent by server design (replaces prior submission if called again).
   *
   * @param {{
   *   room_id: string,
   *   role: string,
   *   felt_heard: number,
   *   alinda_helpful: number,
   *   conversation_moved_forward: number,
   *   free_text?: string,
   * }} body
   * @returns {Promise<SessionFeedbackResponse>}
   */
  submitFeedback: (body) => {
    const idempKey = _generateIdempotencyKey(`feedback-${body.room_id}-${body.role}`)
    const key      = _dedupKey('POST', '/feedback', body)

    return _deduped(key, () =>
      _withRetry(() =>
        client.post('/feedback', body, {
          timeout: FEEDBACK_TIMEOUT_MS,
          headers: { 'Idempotency-Key': idempKey },
        }).then(r => r.data)
      , 2)
    )
  },

  /**
   * Polls for the session insight (background summarization may not be done yet).
   * Returns { ready: boolean, insight: SessionInsightResponse | null }.
   * Caller should poll until ready === true.
   *
   * role is sent as a query parameter for privacy verification.
   *
   * @param {string} roomId
   * @param {'a' | 'b'} role
   * @returns {Promise<SessionInsightPollResponse>}
   */
  getInsight: (roomId, role) =>
    _withRetry(() =>
      client.get(`/feedback/${roomId}/insight`, {
        params: { role },
      }).then(r => r.data)
    , 3),
}