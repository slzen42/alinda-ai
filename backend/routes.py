"""
backend/routes.py

The API surface layer for Alinda.

This file is deliberately and intentionally "dumb." It contains:
    - Route declarations
    - Pydantic payload parsing (via FastAPI's body injection)
    - Dependency injection (db, background_tasks)
    - One line of business logic per handler: the session_manager call

It does NOT contain:
    - try/except blocks for business logic errors
    - Direct database queries
    - FSM state checks
    - Prompt text
    - Any import from ai/

How errors reach the client:
    session_manager.py and dependencies.py raise HTTPException (4xx/5xx)
    directly. FastAPI catches these automatically and converts them into the
    correct HTTP response with the structured detail field. There is nothing
    for this file to catch or rewrap.

How serialisation works:
    Every route declares a response_model from schemas.py. FastAPI calls
    model_validate() on the return value automatically. Because every
    schema uses model_config = {"from_attributes": True}, ORM objects
    returned by session_manager are serialised correctly — including the
    SafeMessageExtraData transformation defined in MessageResponse, which
    strips raw AI scores before they ever leave the server.

WebSocket forward-compatibility:
    GET /session/{room_id} will eventually be supplemented (not replaced)
    by a WebSocket connection from websocket_manager.py. The polling
    endpoint stays in place as a guaranteed fallback for reconnections
    and for clients that cannot maintain a WebSocket (e.g., some mobile
    network conditions). Both can coexist on the same router prefix without
    any structural changes to this file.

Feedback routes live in a separate file:
    backend/feedback_routes.py handles POST /feedback and
    GET /session/{room_id}/insight. Separating them keeps this file
    focused on the live-session surface and makes it easy to apply
    different rate limits or authentication middleware to post-session
    routes in the future.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session as DBSession

from backend.database import SessionLocal
from backend.dependencies import get_db
from backend import session_manager
from backend.schemas import (
    AckResponse,
    ConversationResponse,
    CreateRoomRequest,
    CrisisReadyRequest,
    EndSessionRequest,
    HealthResponse,
    IntakeSubmission,
    JoinRoomRequest,
    MessageResponse,
    PauseSessionRequest,
    ResumeSessionRequest,
    SendMessageRequest,
    SendMessageResponse,
    SessionStateResponse,
    TypingStatusRequest,
)
from ai.classifier import classifier as _classifier


# ─────────────────────────────────────────────────────────────────────────────
# ROUTER
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter(
    prefix = "/api/v1/session",
    tags   = ["Session"],
)


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH CHECK
#
# Called by Render's health check system every 30 seconds, and by any
# monitoring tooling you add later. Not user-facing.
#
# Why this endpoint exposes classifier_ready:
#   On a Render cold start, the DistilBERT model loads from disk during the
#   first import of ai.classifier. If the model directory is missing or
#   corrupt, the classifier enters fallback mode — every message gets neutral
#   scores, Alinda's clinical decision-making is severely degraded, and no
#   error is visible in the HTTP response to the user. This endpoint makes
#   that failure mode immediately visible in monitoring without any user
#   impact.
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/health",
    response_model = HealthResponse,
    summary        = "Server and classifier health check",
    tags           = ["Infrastructure"],
)
def health_check() -> HealthResponse:
    return HealthResponse(
        status            = "ok",
        classifier_ready  = _classifier.ready,
        classifier_device = _classifier.device,
        version           = "2.0.0",
    )


# ─────────────────────────────────────────────────────────────────────────────
# ROOM LIFECYCLE
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/create-room",
    response_model = SessionStateResponse,
    summary        = "Create a new therapy room (Partner A)",
    status_code    = 201,
)
def create_room(
    payload: CreateRoomRequest,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Creates a new room and registers Partner A.
    Returns the room state — frontend uses this to navigate
    Partner A to the waiting screen.

    Raises 400 if the room_id is already taken.
    """
    session = session_manager.create_room(payload.room_id, payload.name_a, db)
    return SessionStateResponse.model_validate(session)


@router.post(
    "/join-room",
    response_model = SessionStateResponse,
    summary        = "Join an existing room (Partner B)",
)
def join_room(
    payload: JoinRoomRequest,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Registers Partner B in an existing room.
    Returns the updated room state — frontend uses this to navigate
    Partner B to their intake screen.

    Raises 404 if the room doesn't exist.
    Raises 403 if the session has concluded.
    Raises 400 if a second partner has already joined.
    """
    session = session_manager.join_room(payload.room_id, payload.name_b, db)
    return SessionStateResponse.model_validate(session)


# ─────────────────────────────────────────────────────────────────────────────
# INTAKE PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/intake",
    response_model = SessionStateResponse,
    summary        = "Submit pre-session intake (one partner)",
)
async def submit_intake(
    payload: IntakeSubmission,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Submits one partner's intake answers and style preference.

    When both partners have submitted, this call is intentionally slow —
    it runs concurrent partner profiling and opening-message generation
    before returning. The frontend should show a "Processing your
    responses..." screen and wait for this response rather than polling.
    The returned session will have mode="guided" when everything is ready.

    When only one partner has submitted, returns immediately with the
    updated intake_a_submitted / intake_b_submitted flags so the frontend
    can show the correct waiting state.

    Raises 404 if the room doesn't exist.
    Raises 403 if the session has concluded or the partner hasn't joined.
    Raises 500 (with friendly message) if the session-start pipeline fails.
    """
    session = await session_manager.submit_intake(
        room_id       = payload.room_id,
        role          = payload.role,
        intake_text   = payload.intake_text,
        session_style = payload.session_style,
        db            = db,
    )
    return SessionStateResponse.model_validate(session)


# ─────────────────────────────────────────────────────────────────────────────
# SESSION STATE
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/session/{room_id}",
    response_model = SessionStateResponse,
    summary        = "Get current session state (poll endpoint)",
)
async def get_session_state(
    room_id: str,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    The frontend polls this endpoint every few seconds to detect:
        - The other partner joining the room
        - The other partner finishing their intake
        - New AI messages (pre-WebSocket architecture)
        - Mode changes (cooldown, crisis, pause)
        - Typing indicator updates
        - Idle-partner redirects

    refresh_session_state performs two passive corrections on every call:
        1. Expired user-initiated pauses auto-clear back to "guided".
        2. If the floor has been held by one partner for over 90 seconds
           with no activity, an idle_redirect fires and switches the turn.

    Both of these corrections happen transparently — the frontend sees
    the corrected state in the same response that triggered them.

    Raises 404 if the room doesn't exist.
    """
    session = await session_manager.refresh_session_state(room_id, db)
    return SessionStateResponse.model_validate(session)


# ─────────────────────────────────────────────────────────────────────────────
# MESSAGING
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/message",
    response_model = SendMessageResponse,
    summary        = "Send a user message (triggers full AI pipeline)",
)
async def send_message(
    payload:          SendMessageRequest,
    background_tasks: BackgroundTasks,
    db:               DBSession = Depends(get_db),
) -> SendMessageResponse:
    """
    The primary endpoint of the application. Every user message flows through
    the full 11-step pipeline in process_user_message:

        pre-flight → analysis → mediation → FSM enforcement →
        LLM generation → turn resolution → persistence →
        real-time dispatch → time-limit check

    Returns the updated session state and all new messages produced this
    turn. The "no_op" flag in the response is True when the message was
    silently dropped (duplicate send, empty content) — the frontend should
    silently ignore no_op=True responses.

    The background_tasks handle post-session summarization if this message
    happens to push the session past its time limit. The response returns
    immediately; summarization runs behind the scenes.

    Raises 400 if the session is still in intake mode.
    Raises 403 if the session has concluded or the partner hasn't joined.
    Raises 404 if the room doesn't exist.
    """
    result = await session_manager.process_user_message(
        room_id          = payload.room_id,
        sender            = payload.sender,
        raw_text          = payload.content,
        db                = db,
        background_tasks  = background_tasks,
    )
    return SendMessageResponse(
        session      = SessionStateResponse.model_validate(result["session"]),
        new_messages = [MessageResponse.model_validate(m) for m in result["new_messages"]],
        no_op        = result["no_op"],
    )


@router.get(
    "/session/{room_id}/conversation",
    response_model = ConversationResponse,
    summary        = "Fetch the full transcript for a session",
)
def get_conversation(
    room_id: str,
    db:      DBSession = Depends(get_db),
) -> ConversationResponse:
    """
    Returns the complete chronological message history for a room.
    Used on initial load to hydrate the React chat screen, and optionally
    on reconnect to restore lost messages after a network drop.

    Extra_data in each message is transformed through SafeMessageExtraData —
    raw AI scores never leave the server.

    Raises 404 if the room doesn't exist.
    """
    from backend.models import ChatMessage

    # This is the one direct query in this file — it is read-only and
    # requires no session_manager involvement because it has no side
    # effects and no FSM interaction. Fetching a transcript is structurally
    # equivalent to fetching a static resource.
    from backend.dependencies import get_session_or_404
    get_session_or_404(room_id, db)   # Confirms room exists before the query

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id == room_id)
        .order_by(ChatMessage.timestamp)
        .all()
    )
    return ConversationResponse(
        room_id  = room_id,
        messages = [MessageResponse.model_validate(m) for m in messages],
    )


# ─────────────────────────────────────────────────────────────────────────────
# REAL-TIME SYNC
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/typing",
    response_model = AckResponse,
    summary        = "Update typing indicator status",
)
def update_typing_status(
    payload: TypingStatusRequest,
    db:      DBSession = Depends(get_db),
) -> AckResponse:
    """
    Updates the typing indicator for one partner. The other partner's
    frontend sees this on the next session state poll.

    When payload.is_typing=True, also updates last_activity_at, which
    resets the idle-partner detection clock — someone visibly typing
    should never be flagged as idle.

    Raises 404 if the room doesn't exist.
    Raises 403 if the partner hasn't joined.
    """
    session_manager.set_typing_status(payload.room_id, payload.role, payload.is_typing, db)
    return AckResponse(ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# CRISIS MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/crisis-ready",
    response_model = SessionStateResponse,
    summary        = "Signal that a partner is ready to resume after crisis pause",
)
def crisis_ready(
    payload: CrisisReadyRequest,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Records that one partner has pressed "I'm ready" after a crisis pause
    countdown has completed.

    This is the only pause-like state that never auto-resumes on timer
    expiry. Both partners must explicitly confirm before the session
    resumes. The returned session state reflects whether one or both
    partners have confirmed — the frontend uses crisis_ready_a and
    crisis_ready_b to render the appropriate waiting screen.

    Raises 404 if the room doesn't exist.
    Raises 403 if the partner hasn't joined.
    """
    session = session_manager.submit_crisis_ready(payload.room_id, payload.role, db)
    return SessionStateResponse.model_validate(session)


# ─────────────────────────────────────────────────────────────────────────────
# SESSION LIFECYCLE — PAUSE / RESUME
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/pause",
    response_model = SessionStateResponse,
    summary        = "Pause the session (either partner)",
)
def pause_session(
    payload: PauseSessionRequest,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Either partner can pause unilaterally. The session enters the "paused"
    FSM state and the mode will not return to "guided" until either:
        a) Either partner calls /resume, or
        b) The paused_until timer expires (detected lazily on the next
           GET /session or next /message call).

    The response includes paused_until so the frontend can render a
    live countdown for the other partner.

    Raises 404 if the room doesn't exist.
    Raises 403 if the session has concluded or the partner hasn't joined.
    """
    session = session_manager.toggle_pause(
        payload.room_id,
        payload.role,
        payload.duration_minutes,
        db,
    )
    return SessionStateResponse.model_validate(session)


@router.post(
    "/resume",
    response_model = SessionStateResponse,
    summary        = "Resume a paused session (either partner)",
)
def resume_session(
    payload: ResumeSessionRequest,
    db:      DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Ends a user-initiated pause early. Either partner can resume.

    Idempotent — calling this when the session isn't paused returns the
    current state unchanged rather than raising an error.

    Raises 404 if the room doesn't exist.
    Raises 403 if the session has concluded or the partner hasn't joined.
    """
    session = session_manager.resume_session(payload.room_id, payload.role, db)
    return SessionStateResponse.model_validate(session)


# ─────────────────────────────────────────────────────────────────────────────
# SESSION LIFECYCLE — MUTUAL END
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/end-session",
    response_model = SessionStateResponse,
    summary        = "Request or confirm session end (requires both partners)",
)
def end_session(
    payload:          EndSessionRequest,
    background_tasks: BackgroundTasks,
    db:               DBSession = Depends(get_db),
) -> SessionStateResponse:
    """
    Two-step mutual end process. Therapy shouldn't end because one person
    rage-quits.

    First call (from either partner):
        Sets end_requested_by. Other partner sees the confirmation prompt.
        Session remains active.

    Second call (from the OTHER partner):
        Confirms the end. Session transitions to mode="closed", phase="ended".
        Session summarization starts in the background — the response returns
        immediately so both partners can proceed to the rating screen.

    Subsequent calls (from either partner, once closed):
        Idempotent — returns the closed state without raising an error.

    The background_tasks argument is passed through to session_manager,
    which uses it to schedule _run_summarizer_background after a confirmed
    end. FastAPI executes BackgroundTasks after the response has been sent.

    Raises 404 if the room doesn't exist.
    Raises 403 if the partner hasn't joined.
    """
    session = session_manager.request_end_session(
        payload.room_id,
        payload.role,
        db,
        background_tasks,
    )
    return SessionStateResponse.model_validate(session)