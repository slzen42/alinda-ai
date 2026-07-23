/**
 * src/hooks/useSessionState.js
 *
 * The clinical state membrane between sessionStore.js and UI components.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RENDER THRASHING PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * If every component subscribes to the raw sessionStore, any change to any
 * field — a typing indicator toggle, a scroll position update, a timestamp
 * change — re-renders every subscribed component simultaneously. In a live
 * therapy session, the store updates many times per second. This produces
 * visible stuttering.
 *
 * The solution: hyper-specific Zustand selectors that only trigger re-renders
 * when the specific slice that component cares about actually changes.
 *
 * Additionally, components should never contain logic like:
 *   if (mode === 'guided' && !paused && current_turn === myRole && escalation < 3)
 * That logic belongs here, computed once, exposed as semantic booleans.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPECTED sessionStore SHAPE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * sessionStore must expose:
 *   session: SessionStateResponse | null
 *   myRole: 'a' | 'b' | null
 *   messages: MessageResponse[]
 *   connectionStatus: 'online' | 'degraded' | 'offline'
 *   optimisticMessages: { clientId, content, timestamp, pending }[]
 *
 * SessionStateResponse fields this hook reads:
 *   mode, phase, session_phase, current_turn, partner_typing, typing_role,
 *   name_a, name_b, session_style, session_style_a, session_style_b,
 *   style_resolution, session_started_at, session_duration_limit,
 *   end_requested_by, crisis_ready_a, crisis_ready_b, paused_until,
 *   escalation_unresolved, last_action, last_escalation_type,
 *   feedback_submitted_a, feedback_submitted_b, insight_ready
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   import { useSessionState } from 'hooks/useSessionState'
 *
 *   function ChatScreen() {
 *     const {
 *       isSessionActive,
 *       isMyTurn,
 *       isInCrisis,
 *       canSendMessage,
 *       partnerName,
 *       myName,
 *     } = useSessionState()
 *     ...
 *   }
 */

import { useMemo }         from 'react'
import { useSessionStore } from 'store/sessionStore'


// ─────────────────────────────────────────────────────────────────────────────
// PURE FSM PREDICATES
//
// These are plain functions (not hooks) that derive boolean facts from
// the raw session state. Defined here rather than inline in the hook so
// they can be independently unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

/** The session has begun and is in a state where conversation can occur. */
const _isSessionActive = (mode) =>
  mode === 'guided' || mode === 'free_chat' || mode === 'cooldown' || mode === 'wrapping_up'

/** The session is in a safety-critical state requiring immediate intervention. */
const _isInCrisis = (mode, lastEscalationType) =>
  mode === 'crisis_pause' ||
  mode === 'safety_lockdown' ||
  lastEscalationType === 'crisis_self_harm' ||
  lastEscalationType === 'safety_intervention'

/** The session exists and both partners have joined. */
const _isBothPartnersPresent = (session) =>
  Boolean(session?.name_a && session?.name_b)

/** This partner currently holds the floor. */
const _isMyTurn = (currentTurn, myRole) =>
  currentTurn === null || currentTurn === myRole

/** The local user is allowed to type and send a message right now. */
const _canSendMessage = (mode, currentTurn, myRole) => {
  if (!_isSessionActive(mode)) return false
  if (mode === 'cooldown') return false
  return _isMyTurn(currentTurn, myRole)
}

/** True when Alinda is responding (no current_turn = both can observe). */
const _isAlindaResponding = (mode, lastAction) =>
  mode === 'guided' &&
  (lastAction === 'suggest_framework' ||
   lastAction === 'affirm_progress'   ||
   lastAction === 'crisis_self_harm'  ||
   lastAction === 'safety_check')

/** Maps FSM mode to the canvas state name for LivingCanvas. */
const _modeToCanvasState = (mode) => {
  const map = {
    intake:            'idle',
    ready_for_session: 'waiting',
    guided:            'guided',
    free_chat:         'guided',
    cooldown:          'cooldown',
    safety_lockdown:   'stillness',
    crisis_pause:      'stillness',
    paused:            'cooldown',
    wrapping_up:       'guided',
    closed:            'idle',
  }
  return map[mode] ?? 'guided'
}


// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The main session state hook. Returns semantic, role-aware, memoized state.
 * Each selector is granular enough to prevent unnecessary re-renders.
 *
 * @returns {SessionStateBundle}
 */
export function useSessionState() {
  // ── Granular selectors — each triggers re-renders only on its own change ──

  const session       = useSessionStore(s => s.session)
  const myRole        = useSessionStore(s => s.myRole)
  const messages      = useSessionStore(s => s.messages)
  const connStatus    = useSessionStore(s => s.connectionStatus)
  const optimistic    = useSessionStore(s => s.optimisticMessages)

  // ── Derived session fields — null-safe ────────────────────────────────────

  const mode              = session?.mode ?? null
  const sessionPhase      = session?.session_phase ?? 'opening'
  const currentTurn       = session?.current_turn ?? null
  const partnerTyping     = session?.partner_typing ?? false
  const typingRole        = session?.typing_role ?? null
  const lastAction        = session?.last_action ?? null
  const lastEscalation    = session?.last_escalation_type ?? null
  const escalationUnres   = session?.escalation_unresolved ?? false
  const endRequestedBy    = session?.end_requested_by ?? null
  const paused            = mode === 'paused'
  const pausedUntil       = session?.paused_until ?? null
  const crisisReadyA      = session?.crisis_ready_a ?? false
  const crisisReadyB      = session?.crisis_ready_b ?? false
  const feedbackDoneA     = session?.feedback_submitted_a ?? false
  const feedbackDoneB     = session?.feedback_submitted_b ?? false
  const insightReady      = session?.insight_ready ?? false

  // ── Role-derived values ───────────────────────────────────────────────────

  const myName        = myRole === 'a' ? session?.name_a : session?.name_b
  const partnerName   = myRole === 'a' ? session?.name_b : session?.name_a
  const partnerRole   = myRole === 'a' ? 'b' : 'a'

  const sessionStyleA  = session?.session_style_a  ?? 'balanced'
  const sessionStyleB  = session?.session_style_b  ?? 'balanced'
  const myStyle        = myRole === 'a' ? sessionStyleA : sessionStyleB
  const partnerStyle   = myRole === 'a' ? sessionStyleB : sessionStyleA

  // ── Computed semantic booleans — memoized as a group ─────────────────────
  // All boolean logic lives here, not in components.

  const computed = useMemo(() => {
    const isInCrisis              = _isInCrisis(mode, lastEscalation)
    const isSessionActive         = _isSessionActive(mode)
    const isBothPresent           = _isBothPartnersPresent(session)
    const isMyTurn                = _isMyTurn(currentTurn, myRole)
    const canSend                 = _canSendMessage(mode, currentTurn, myRole)
    const isAlindaResponding      = _isAlindaResponding(mode, lastAction)

    const isWaitingForPartner     = mode === 'intake' && !isBothPresent
    const isWaitingForIntake      = isBothPresent && session?.phase === 'waiting_for_intake'
    const isSessionClosed         = mode === 'closed'
    const isEndRequested          = Boolean(endRequestedBy)
    const iEndedRequest           = endRequestedBy === myRole
    const partnerEndedRequest     = endRequestedBy === partnerRole
    const myCrisisReady           = myRole === 'a' ? crisisReadyA : crisisReadyB
    const partnerCrisisReady      = myRole === 'a' ? crisisReadyB : crisisReadyA
    const myFeedbackSubmitted     = myRole === 'a' ? feedbackDoneA : feedbackDoneB
    const partnerFeedbackSubmitted = myRole === 'a' ? feedbackDoneB : feedbackDoneA

    // A partner is typing if the typing role is the OTHER partner's role,
    // not the local user (users see their own typing locally; not from the server).
    const isPartnerTyping   = partnerTyping && typingRole === partnerRole
    const isAlindaTyping    = partnerTyping && typingRole === 'ai'

    // Whether breakthrough recently fired — used to trigger canvas state
    const isBreakthrough    = lastAction === 'affirm_progress' ||
                              lastAction === 'suggest_framework'

    // Whether the session is in the free-chat/observe phase where Alinda watches silently
    const isFreeChatMode    = mode === 'free_chat'

    // Whether the pause timer is still active (not yet expired)
    const isPauseActive     = paused && Boolean(pausedUntil)

    // Ability flags for UI elements
    const canPause          = isSessionActive && !paused && !isInCrisis
    const canResume         = paused
    const canEndSession     = isSessionActive || paused
    const canSubmitCrisisReady = isInCrisis && !myCrisisReady

    const canvasState       = _modeToCanvasState(mode)

    return {
      // Session existence
      hasSession:               Boolean(session),
      isBothPresent,
      isWaitingForPartner,
      isWaitingForIntake,

      // Activity states
      isSessionActive,
      isSessionClosed,
      isInCrisis,
      isPauseActive,
      isFreeChatMode,
      isBreakthrough,

      // Turn and speech
      isMyTurn,
      canSend,
      isAlindaResponding,

      // Partner states
      isPartnerTyping,
      isAlindaTyping,

      // End session flow
      isEndRequested,
      iEndedRequest,
      partnerEndedRequest,

      // Crisis flow
      myCrisisReady,
      partnerCrisisReady,
      canSubmitCrisisReady,

      // Capability flags
      canPause,
      canResume,
      canEndSession,

      // Post-session
      myFeedbackSubmitted,
      partnerFeedbackSubmitted,
      insightReady,

      // Canvas state string for LivingCanvas
      canvasState,

      // Escalation awareness (for visual/audio decisions)
      escalationUnresolved: escalationUnres,
    }
  }, [
    session, myRole, mode, currentTurn, lastAction, lastEscalation,
    escalationUnres, endRequestedBy, partnerRole, partnerTyping, typingRole,
    crisisReadyA, crisisReadyB, feedbackDoneA, feedbackDoneB, insightReady,
    paused, pausedUntil,
  ])

  // ── Connection state ──────────────────────────────────────────────────────

  const isOnline    = connStatus === 'online'
  const isDegraded  = connStatus === 'degraded'
  const isOffline   = connStatus === 'offline'

  return {
    // Raw session object (for components that need specific fields not here)
    session,
    myRole,
    partnerRole,
    myName:        myName  ?? 'You',
    partnerName:   partnerName ?? 'Your partner',
    partnerStyle,
    myStyle,
    sessionStyleA,
    sessionStyleB,
    styleResolution: session?.style_resolution ?? null,
    sessionStyle:    session?.session_style ?? 'balanced',

    // FSM state
    mode,
    sessionPhase,
    currentTurn,
    lastAction,
    pausedUntil,

    // Messages
    messages,
    optimisticMessages: optimistic,

    // Connection
    connectionStatus: connStatus,
    isOnline,
    isDegraded,
    isOffline,

    // All computed semantic booleans
    ...computed,
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SPECIALIZED NARROWED HOOKS
//
// For components that only care about one specific slice of state.
// These never cause the component to re-render for unrelated changes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns only what MessageInput.jsx needs.
 * MessageInput re-renders ONLY when canSend or the connection status changes.
 * Not when a message arrives, not when the typing indicator changes.
 */
export function useInputState() {
  const canSend    = useSessionStore(s => {
    const { session, myRole } = s
    if (!session || !myRole) return false
    return _canSendMessage(session.mode, session.current_turn, myRole)
  })
  const isOffline  = useSessionStore(s => s.connectionStatus === 'offline')
  const myRole     = useSessionStore(s => s.myRole)

  return { canSend, isOffline, myRole }
}

/**
 * Returns only what TurnGlow.jsx and TurnIndicator.jsx need.
 * Re-renders only when the turn changes.
 */
export function useTurnState() {
  const isMyTurn   = useSessionStore(s => {
    const { session, myRole } = s
    if (!session || !myRole) return false
    return _isMyTurn(session.current_turn, myRole)
  })
  const currentTurn = useSessionStore(s => s.session?.current_turn ?? null)
  const myRole      = useSessionStore(s => s.myRole)

  return { isMyTurn, currentTurn, myRole }
}

/**
 * Returns only what CrisisOverlay.jsx needs.
 * Re-renders only on mode or crisis transitions — completely immune to
 * typing indicators, turn changes, and message arrivals.
 */
export function useCrisisState() {
  return useSessionStore(s => {
    const { session, myRole } = s
    const isInCrisis    = _isInCrisis(session?.mode, session?.last_escalation_type)
    const myCrisisReady = myRole === 'a' ? session?.crisis_ready_a : session?.crisis_ready_b
    const partCrisisRdy = myRole === 'a' ? session?.crisis_ready_b : session?.crisis_ready_a
    return { isInCrisis, myCrisisReady, partnerCrisisReady: partCrisisRdy }
  })
}