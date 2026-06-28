"""
backend/session_manager.py

The central nervous system of Alinda.

Every previous AI and structural file in this system is a pure, isolated
engine: the classifier infers emotion, mediator_logic makes clinical
decisions, conversation_state_controller enforces the FSM, conversation_guardrails
filters input, intake_analyzer profiles partners, session_summarizer archives
history. None of them touch the database. None of them know about HTTP.

This file is the only place where all of that meets the database and the
outside world. Its job is orchestration, not intelligence — it does not
contain prompt text, FSM transition rules, or clinical logic. It moves data
safely between perfectly designed boxes.

Design principle — "Dumb Routes, Smart Manager":
    backend/routes.py (not yet written) will do nothing but parse the
    incoming Pydantic body and call a function in this file. Every public
    function here therefore accepts room_id and primitive values, not a
    pre-fetched ORM object — it performs its own lookup and validation via
    backend.dependencies. This keeps 100% of business logic in one place.

Design principle — Atomic Transactions:
    The master pipeline (process_user_message) wraps its entire body in a
    try/except that rolls back the database session on any unexpected
    failure and returns a graceful fallback message rather than a 500.
    A user's connection dropping mid-pipeline should never leave the room
    in a half-updated, corrupted state — and should never leave them
    unable to resend the message that failed.

Two integration gaps closed here that could not be closed in earlier files
without reopening already-finished work:

    1. conversation_guardrails.py documents that its `user_is_looping` and
       `message_rate_high` flags should reach mediator_logic's clinical
       brief, but mediator_logic._build_clinical_brief() has no flags
       parameter. This file appends the promised clinical language to
       decision["system_message"] directly — see _apply_preflight_flags().

    2. mediator_logic's decision["next_speaker"] (floor control) and
       llm_client's returned "next_speaker" key (who was actually addressed,
       from _detect_addressed_partner) are two different concepts that
       happen to share a name. This file reconciles them explicitly — see
       _resolve_current_turn(). The LLM's actual words win over the
       clinical prediction, which is the entire point of having
       _detect_addressed_partner in the first place.

Idle-partner detection (the "eating user" review) has no natural home in
any earlier file — both mediator_logic and conversation_state_controller
only run in response to a message arriving. This file adds it as a
check-on-read inside refresh_session_state(), fired whenever the frontend
polls session state. This is intentionally poll-based, not a true
background scheduler, to match the current architecture — Block 6's
WebSocket layer can later replace the polling trigger without touching
the detection logic itself.

WebSocket forward-compatibility:
    register_broadcaster() lets Block 6 hook in a real-time dispatch
    function with zero changes to this file. Until that's registered,
    the broadcast call is a silent no-op.

Public interface (the complete surface routes.py will call):
    create_room(room_id, name_a, db)
    join_room(room_id, name_b, db)
    submit_intake(room_id, role, intake_text, session_style, db)
    set_typing_status(room_id, role, is_typing, db)
    submit_crisis_ready(room_id, role, db)
    toggle_pause(room_id, role, duration_minutes, db)
    resume_session(room_id, role, db)
    request_end_session(room_id, role, db, background_tasks)
    submit_feedback(room_id, role, felt_heard, alinda_helpful, conversation_moved_forward, free_text, db)
    get_latest_insight(room_id, db)
    refresh_session_state(room_id, db)
    process_user_message(room_id, sender, raw_text, db, background_tasks)
    register_broadcaster(fn)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Awaitable, Callable, Optional

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from backend.database import SessionLocal
from backend.dependencies import (
    ensure_session_active,
    get_session_or_404,
    get_validated_session,
    verify_partner_access,
)
from backend.models import ChatMessage, CoupleProfile, SessionFeedback, SessionInsight, TherapySession

from ai.analysis import analyze_message
from ai.conversation_guardrails import pre_flight_check
from ai.conversation_state_controller import adjust_decision
from ai.intake_analyzer import analyze_both_partners
from ai.llm_client import generate_session_opening, generate_session_response
from ai.mediator_logic import decide_mediation
from ai.session_summarizer import summarize_session
from ai.intake_analyzer import IntakeAnalysisResult

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Floor for the crisis-pause countdown before the "I'm ready" buttons even
# appear. This is NOT the safety mechanism itself — the real gate is the
# requirement that BOTH partners explicitly click ready (see
# submit_crisis_ready). 15 seconds prevents a reflexive click-through in
# under a second; it does not, by itself, certify anyone is actually ready.
_CRISIS_COUNTDOWN_SECONDS = 15

# How long a partner can hold the floor with no activity before Alinda
# gently redirects to the other partner. Long enough to allow normal
# typing pauses; short enough that the waiting partner doesn't feel
# abandoned mid-session.
_IDLE_TIMEOUT_SECONDS = 90

# Context window fetched per message-processing call. Larger than
# prompts.CONTEXT_WINDOW (6) because conversation_guardrails' broken-record
# lookback and build_prompt() each independently slice down to what they
# need — fetching once and letting each consumer trim avoids a second query.
_RECENT_MESSAGES_FETCH_LIMIT = 12


# ─────────────────────────────────────────────────────────────────────────────
# WEBSOCKET FORWARD-COMPATIBILITY HOOK
#
# Block 6 will register a real broadcaster here at application startup.
# Until then, this is a silent no-op — "Real-Time Dispatch" exists
# structurally now without requiring websocket_manager.py to exist yet.
# ─────────────────────────────────────────────────────────────────────────────

_broadcaster: Optional[Callable[[str, dict], Awaitable[None]]] = None

def _serialize_message(msg: ChatMessage) -> dict:
    """
    Converts a ChatMessage ORM object into a plain JSON-safe dict for
    WebSocket dispatch. Required because websocket_manager.broadcast_to_room
    calls websocket.send_json() directly, which cannot serialize ORM
    objects on its own.
    """
    from backend.schemas import MessageResponse
    return MessageResponse.model_validate(msg).model_dump(mode="json")


def register_broadcaster(fn: Callable[[str, dict], Awaitable[None]]) -> None:
    """
    Called once at application startup by backend/websocket_manager.py
    (Block 6) to wire in real-time dispatch. fn receives (room_id, payload)
    and should push the payload to all connected clients in that room.
    """
    global _broadcaster
    _broadcaster = fn
    logger.info("session_manager: WebSocket broadcaster registered.")


async def _dispatch(room_id: str, payload: dict) -> None:
    """
    Fires the registered broadcaster if one exists. Wrapped in try/except
    so a future broadcaster bug can never break the underlying HTTP
    response path — real-time dispatch is additive, never load-bearing.
    """
    if _broadcaster is None:
        return
    try:
        await _broadcaster(room_id, payload)
    except Exception:
        logger.error(f"Broadcaster failed for room {room_id!r}", exc_info=True)


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER — SESSION STYLE RESOLUTION
# ─────────────────────────────────────────────────────────────────────────────

# Replace _resolve_session_style with a version that takes the two
# IntakeAnalysisResult objects (already available in submit_intake at
# the exact point _resolve_session_style is currently called) rather
# than just the two style strings, so it can read profile.confidence
# and the fragility signal already computed in mediator_logic's trait
# vocabulary.

def _resolve_session_style(
    style_a: Optional[str],
    style_b: Optional[str],
    result_a: "IntakeAnalysisResult",
    result_b: "IntakeAnalysisResult",
) -> tuple[str, str]:
    """
    Returns (resolved_session_style, style_resolution_tag).

    Tier 1 — Safety override: if either partner's intake profile signals
    high fragility (low confidence + a blind_spot/attachment_wound
    centered on acute distress is a weak signal on its own — the
    deliberately conservative check here is profile.confidence == "low"
    combined with that partner having chosen "gentle" themselves; we do
    NOT override a partner INTO gentle against their own stated choice,
    only honor it more strongly when they asked for it while fragile).

    Tier 2 — styles differ, neither flagged fragile: no shared style is
    forced. session_style becomes a neutral tone-calibration default
    ("balanced") for Alinda's overall voice; the canvas itself goes
    asymmetric client-side using style_a / style_b directly.

    Tier 3 — styles match: trivial case, return the shared style.
    """
    a = style_a or "balanced"
    b = style_b or "balanced"

    if a == b:
        return a, "matched"

    a_fragile = result_a.profile.confidence == "low" and a == "gentle"
    b_fragile = result_b.profile.confidence == "low" and b == "gentle"

    if a_fragile or b_fragile:
        return "gentle", "safety_override"

    return "balanced", "asymmetric"


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER — PRE-FLIGHT FLAG INJECTION
#
# Closes the documented gap: conversation_guardrails.py's flags need to
# reach the clinical brief, but mediator_logic._build_clinical_brief() has
# no flags parameter. This appends the exact language promised in that
# file's docstring directly onto the decision's system_message.
# ─────────────────────────────────────────────────────────────────────────────

def _apply_preflight_flags(decision: dict, flags: dict, speaker_name: str) -> dict:
    """
    Mutates decision["system_message"] in place to include guidance for
    any pre-flight flags raised on this message. Called after
    decide_mediation() returns and before the controller/LLM consume it.
    """
    notes: list[str] = []

    if flags.get("user_is_looping"):
        notes.append(
            f"{speaker_name} has said essentially the same thing multiple times now. "
            f"They feel fundamentally unheard. Before asking anything new, name "
            f"exactly what you heard them say."
        )

    if flags.get("message_rate_high"):
        notes.append(
            f"Messages are arriving very quickly from {speaker_name}. They may be "
            f"in acute distress. Match their urgency with calm, not speed."
        )

    if notes:
        existing = decision.get("system_message", "")
        decision["system_message"] = (
            "\n".join(notes) + ("\n\n" + existing if existing else "")
        ).strip()

    return decision


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER — TURN RESOLUTION
#
# Reconciles the naming collision between mediator_logic's next_speaker
# (floor control, a clinical decision) and llm_client's next_speaker
# (who was actually addressed, from _detect_addressed_partner). The LLM's
# actual words win over the clinical prediction — that is the entire point
# of having _detect_addressed_partner.
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_current_turn(decision: dict, llm_result: dict) -> Optional[str]:
    """
    Returns the value to write to session.current_turn.

    None  → open floor (free chat / observe — both partners may speak)
    "a"/"b" → that partner specifically has the floor
    """
    floor_control = decision.get("next_speaker", "both")

    if floor_control == "both":
        return None

    llm_addressed = llm_result.get("llm_suggested_target")
    if llm_addressed in ("a", "b"):
        return llm_addressed

    return floor_control if floor_control in ("a", "b") else None


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER — ESCALATION MEMORY UPDATE
# ─────────────────────────────────────────────────────────────────────────────

def _update_escalation_memory(session: TherapySession, final_action: str) -> None:
    """
    Updates session-level escalation counters based on the action that
    actually fired this turn (after conversation_state_controller may have
    overridden mediator_logic's original proposal).
    """
    if final_action == "cooldown_start":
        session.cooldown_count = (session.cooldown_count or 0) + 1

    if final_action in {"safety_intervention", "crisis_self_harm"}:
        session.safety_count = (session.safety_count or 0) + 1
        session.escalation_unresolved = True
        session.last_escalation_type = final_action

    if final_action == "repair_acknowledgement":
        session.escalation_unresolved = False


def _update_rolling_averages(session: TherapySession, analysis: dict) -> None:
    """
    Updates the session-level rolling averages (distinct from mediator_logic's
    per-partner behavioral ledger averages — these are simple session-wide
    means used for quick dashboard-style reads without querying every
    ChatMessage). Only called for user messages, not AI messages.
    """
    n = session.message_count or 0
    new_n = n + 1

    session.avg_escalation    = ((session.avg_escalation or 0.0) * n + analysis.get("escalation", 0)) / new_n
    session.avg_blame         = ((session.avg_blame or 0.0) * n + analysis.get("blame", 0)) / new_n
    session.avg_vulnerability = ((session.avg_vulnerability or 0.0) * n + analysis.get("vulnerability", 0)) / new_n
    session.message_count     = new_n


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER — SESSION CLOSURE
# ─────────────────────────────────────────────────────────────────────────────

def _mark_session_closed(session: TherapySession, closed_by: str) -> None:
    """
    The single point where a session transitions to its terminal state.
    Called both by the mutual-end-confirmation path and the time-limit
    auto-close path, so both routes produce an identical, consistent
    closed state.

    closed_by: "a", "b" (mutual confirmation) or "system" (time limit reached).
    """
    session.mode             = "closed"
    session.phase            = "ended"
    session.ended_at         = datetime.now(timezone.utc)
    session.end_confirmed    = True
    session.dialogue_stage   = "Session complete"
    if not session.end_requested_by:
        session.end_requested_by = closed_by


async def _run_summarizer_background(room_id: str) -> None:
    """
    Runs as a FastAPI BackgroundTask AFTER the HTTP response has already
    been sent to the client. Must open its own database session — the
    request-scoped session from Depends(get_db) is closed by the time
    this executes, since BackgroundTasks run after the response lifecycle
    completes.

    This is the "Zero UI Freezing" requirement: the user sees their rating
    screen immediately, while this silently does the heavy LLM work behind
    the scenes.
    """
    db = SessionLocal()
    try:
        session = (
            db.query(TherapySession)
            .filter(TherapySession.room_id == room_id)
            .first()
        )
        if session is None:
            logger.error(f"_run_summarizer_background: no session found for room {room_id!r}")
            return

        messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.room_id == room_id)
            .order_by(ChatMessage.timestamp)
            .all()
        )

        await summarize_session(session, messages, db)

    except Exception:
        logger.error(f"_run_summarizer_background failed for room {room_id!r}", exc_info=True)
    finally:
        db.close()


def _check_and_close_if_time_expired(session: TherapySession, background_tasks: BackgroundTasks) -> bool:
    """
    Checks whether the session has run past its declared duration limit and,
    if so, closes it. Called at the end of process_user_message, after the
    final message of this turn has already been saved — so the closure
    never cuts off mid-exchange; the user always sees one last graceful
    message before the room locks.

    Returns True if the session was just closed.
    """
    if session.mode == "closed":
        return False
    if not session.session_started_at:
        return False

    started = session.session_started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)

    elapsed_minutes = (datetime.now(timezone.utc) - started).total_seconds() / 60.0
    duration_limit  = session.session_duration_limit or 90

    if elapsed_minutes < duration_limit:
        return False

    _mark_session_closed(session, closed_by="system")
    background_tasks.add_task(_run_summarizer_background, session.room_id)
    logger.info(f"Session {session.room_id!r} auto-closed at time limit ({duration_limit} min).")
    return True


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — ROOM CREATION AND JOINING
# ─────────────────────────────────────────────────────────────────────────────

def create_room(room_id: str, name_a: str, db: DBSession) -> TherapySession:
    """
    Creates a new therapy room and registers Partner A.
    Raises 400 if room_id is already taken.
    """
    existing = db.query(TherapySession).filter(TherapySession.room_id == room_id).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Room '{room_id}' already exists. Choose a different code.",
        )

    session = TherapySession(
        room_id = room_id,
        name_a  = name_a,
        phase   = "waiting_for_partner",
        mode    = "intake",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    logger.info(f"Room created: {room_id!r} by '{name_a}'")
    return session


def join_room(room_id: str, name_b: str, db: DBSession) -> TherapySession:
    """
    Registers Partner B in an existing room.
    Raises 404 if the room doesn't exist, 403 if it has concluded,
    400 if a second partner has already joined.
    """
    session = get_session_or_404(room_id, db)
    ensure_session_active(session)

    if session.name_b:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This room already has two partners.",
        )

    session.name_b = name_b
    session.phase  = "waiting_for_intake"
    db.commit()
    db.refresh(session)

    logger.info(f"'{name_b}' joined room {room_id!r}")
    return session


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — INTAKE HANDSHAKE
# ─────────────────────────────────────────────────────────────────────────────

async def submit_intake(
    room_id:       str,
    role:          str,
    intake_text:   str,
    session_style: str,
    db:            DBSession,
) -> TherapySession:
    """
    Submits one partner's intake. When BOTH partners have submitted, this
    function synchronously runs the full session-start pipeline: profiling
    both partners, resolving the merged session style, generating a
    personalised opening message, and flipping the FSM to guided.

    This is intentionally synchronous (not a BackgroundTask) — the frontend
    is expected to show a "Processing your responses..." loading screen and
    wait for this call to complete, per the original design intent. Unlike
    session closure, there is no later screen this could quietly populate
    in the background; the user is staring at a loading state either way.

    Wrapped in try/except/rollback because this touches two concurrent LLM
    calls plus opening generation — a defensive net against an unexpected
    failure leaving one partner profiled and the other not, even though
    every underlying function is individually designed to never raise.
    """
    session = get_validated_session(room_id, role, db, require_active=True)

    if role == "a":
        session.intake_a            = intake_text
        session.intake_a_submitted  = True
        session.session_style_a     = session_style
    else:
        session.intake_b            = intake_text
        session.intake_b_submitted  = True
        session.session_style_b     = session_style

    db.commit()

    if not (session.intake_a_submitted and session.intake_b_submitted):
        # Waiting on the other partner — nothing more to do yet.
        db.refresh(session)
        return session

    # ── Both intakes are in — run the full session-start pipeline ───────────
    try:
        result_a, result_b = await analyze_both_partners(
            session.name_a, session.intake_a,
            session.name_b, session.intake_b,
        )
        session.partner_profile_a = result_a.instructional_text
        session.partner_profile_b = result_b.instructional_text

        resolved_style, resolution_tag = _resolve_session_style(
            session.session_style_a, session.session_style_b, result_a, result_b
        )
        session.session_style = resolved_style
        session.style_resolution = resolution_tag

        # Forward-compatible lookup for a returning couple's prior insight.
        # couple_profile_id is never populated until Phase 2 Block 8 (user
        # accounts), so this resolves to None for every session today —
        # the plumbing exists now so nothing needs to change when that
        # block lands.
        prior_summary: Optional[str] = None
        if session.couple_profile_id:
            latest_insight = (
                db.query(SessionInsight)
                .filter(SessionInsight.couple_profile_id == session.couple_profile_id)
                .order_by(SessionInsight.session_number.desc())
                .first()
            )
            if latest_insight and latest_insight.recommended_focus:
                prior_summary = latest_insight.recommended_focus
        session.prior_session_summary = prior_summary

        opening_text = await generate_session_opening(
            name_a            = session.name_a,
            name_b            = session.name_b,
            session_style      = resolved_style,
            partner_profile_a  = session.partner_profile_a,
            partner_profile_b  = session.partner_profile_b,
        )

        opening_message = ChatMessage(
            room_id      = session.room_id,
            sender       = "ai",
            message_type = "ai",
            content      = opening_text,
            extra_data   = {"action": "session_opening", "mode": "guided"},
        )
        db.add(opening_message)

        session.phase               = "ready_for_session"
        session.mode                = "guided"
        session.session_phase       = "opening"
        session.dialogue_stage      = "Opening up"
        session.session_started_at  = datetime.now(timezone.utc)
        session.last_activity_at    = datetime.now(timezone.utc)

        db.commit()
        db.refresh(session)

        logger.info(f"Session start pipeline complete for room {room_id!r} (style={resolved_style})")
        return session

    except Exception as exc:
        logger.error(f"submit_intake pipeline failed for room {room_id!r}: {exc}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Something went wrong setting up your session. Please try submitting again.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — REAL-TIME SYNC
# ─────────────────────────────────────────────────────────────────────────────

def set_typing_status(room_id: str, role: str, is_typing: bool, db: DBSession) -> TherapySession:
    """
    Updates the typing indicator. Also counts as activity for idle-timeout
    purposes — someone visibly typing should never be flagged as idle.
    """
    session = get_validated_session(room_id, role, db, require_active=True)

    session.partner_typing = is_typing
    session.typing_role    = role if is_typing else None
    if is_typing:
        session.last_activity_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(session)
    return session


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — CRISIS MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────


async def submit_crisis_ready(room_id: str, role: str, db: DBSession) -> TherapySession:
    """
    Records that one partner has pressed "I'm ready" after a crisis pause.

    Deliberately requires BOTH partners to explicitly confirm — this does
    NOT auto-resume on timer expiry. Auto-resuming someone out of a
    self-harm or harm-to-other crisis pause just because a clock ran out
    would be a serious safety failure. This is the one pause-like state in
    the system that never expires passively; contrast with toggle_pause
    below, which is allowed to auto-resume.
    """
    session = get_validated_session(room_id, role, db, require_active=True)

    if role == "a":
        session.crisis_ready_a = True
    else:
        session.crisis_ready_b = True

    if session.crisis_ready_a and session.crisis_ready_b:
        session.mode            = "guided"
        session.locked_until    = None
        session.crisis_ready_a  = False
        session.crisis_ready_b  = False
        session.last_activity_at = datetime.now(timezone.utc)
        logger.info(f"Crisis pause resolved for room {room_id!r} — both partners ready.")

    db.commit()
    db.refresh(session)
    await _dispatch(room_id, {"type": "state_update", "session_changed": True})
    
    return session


def _ensure_crisis_lock(session: TherapySession) -> None:
    """
    Sets the crisis countdown lock the first time a crisis_pause is entered.
    Called from process_user_message right after a turn that produced a
    crisis_self_harm action.
    """
    if session.mode == "crisis_pause" and session.locked_until is None:
        session.locked_until   = datetime.now(timezone.utc) + timedelta(seconds=_CRISIS_COUNTDOWN_SECONDS)
        session.crisis_ready_a = False
        session.crisis_ready_b = False


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — USER-INITIATED PAUSE
# ─────────────────────────────────────────────────────────────────────────────


async def toggle_pause(room_id: str, role: str, duration_minutes: int, db: DBSession) -> TherapySession:
    """
    Either partner can pause unilaterally — unlike crisis pause, this is
    symmetric and does not require the other partner's agreement to start.
    The session resumes automatically when paused_until passes (checked
    lazily in refresh_session_state and in conversation_state_controller's
    per-message auto-clear), or earlier if either partner calls resume_session.

    Known simplification: the mode the session was in before pausing is not
    preserved — resuming always returns to "guided" rather than restoring,
    say, free_chat. This is an acceptable trade-off given free_chat is a
    rare state mediator_logic will naturally re-enter when conditions
    warrant it again; adding a dedicated column purely to preserve it
    wasn't judged worth the schema complexity.
    """
    session = get_validated_session(room_id, role, db, require_active=True)

    session.mode         = "paused"
    session.paused_until = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)

    db.commit()
    db.refresh(session)

    await _dispatch(room_id, {"type": "state_update", "session_changed": True})

    logger.info(f"Room {room_id!r} paused by '{role}' for {duration_minutes} minutes.")
    return session


async def resume_session(room_id: str, role: str, db: DBSession) -> TherapySession:
    """
    Ends a user-initiated pause early. No-op (idempotent) if the session
    isn't currently paused.
    """
    session = get_validated_session(room_id, role, db, require_active=True)

    if session.mode == "paused":
        session.mode         = "guided"
        session.paused_until = None
        session.last_activity_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)
        await _dispatch(room_id, {"type": "state_update", "session_changed": True})
        logger.info(f"Room {room_id!r} resumed early by '{role}'.")

    return session


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — MUTUAL SESSION END
# ─────────────────────────────────────────────────────────────────────────────

async def request_end_session(
    room_id:          str,
    role:             str,
    db:               DBSession,
    background_tasks: BackgroundTasks,
) -> TherapySession:
    """
    Therapy shouldn't end because one person rage-quits. First request from
    a partner marks end_requested_by; the OTHER partner's subsequent request
    confirms the end. A repeated request from the SAME partner, or any
    request once the session is already closed, is a harmless no-op —
    this function is fully idempotent.
    """
    session = get_session_or_404(room_id, db)
    verify_partner_access(role, session)

    if session.mode == "closed":
        return session   # Already ended — idempotent

    if not session.end_requested_by:
        session.end_requested_by = role
        db.commit()
        db.refresh(session)
        await _dispatch(room_id, {"type": "state_update", "session_changed": True})
        logger.info(f"'{role}' requested to end session {room_id!r}. Awaiting confirmation.")
        return session

    if session.end_requested_by == role:
        return session   # Same partner asking again — idempotent, just waiting

    # The OTHER partner has now confirmed — close the session.
    _mark_session_closed(session, closed_by=role)
    db.commit()
    db.refresh(session)

    background_tasks.add_task(_run_summarizer_background, session.room_id)
    logger.info(f"Session {room_id!r} ended by mutual confirmation ('{role}' confirmed).")

    return session


# ─────────────────────────────────────────────────────────────────────────────
# LIFECYCLE — POST-SESSION
# ─────────────────────────────────────────────────────────────────────────────

def submit_feedback(
    room_id:                     str,
    role:                        str,
    felt_heard:                  int,
    alinda_helpful:               int,
    conversation_moved_forward:   int,
    free_text:                    Optional[str],
    db:                           DBSession,
) -> SessionFeedback:
    """
    Records one partner's post-session rating. require_active=False because
    this is explicitly meant to run AFTER a session has closed — feedback_routes.py
    (the next file) will call this directly.
    """
    session = get_validated_session(room_id, role, db, require_active=False)

    feedback = SessionFeedback(
        room_id                    = room_id,
        role                       = role,
        felt_heard                 = felt_heard,
        alinda_helpful              = alinda_helpful,
        conversation_moved_forward  = conversation_moved_forward,
        free_text                   = free_text,
    )
    db.add(feedback)

    if role == "a":
        session.feedback_submitted_a = True
    else:
        session.feedback_submitted_b = True

    db.commit()
    db.refresh(feedback)
    return feedback


def get_latest_insight(room_id: str, role: str, db: DBSession) -> Optional[SessionInsight]:
    """
    Returns the most recent SessionInsight for a room, or None if
    summarization hasn't completed yet (it runs in the background after
    closure — the frontend should poll this gently rather than expect it
    immediately).

    require_active=False because this is explicitly meant to run after a
    session has closed. verify_partner_access still applies — a partner
    cannot fetch insight for a room they never joined, even though the
    room itself has concluded.
    """
    session = get_validated_session(room_id, role, db, require_active=False)
    return (
        db.query(SessionInsight)
        .filter(SessionInsight.room_id == session.room_id)
        .order_by(SessionInsight.created_at.desc())
        .first()
    )


# ─────────────────────────────────────────────────────────────────────────────
# STATE REFRESH — IDLE DETECTION AND LAZY PAUSE EXPIRY
#
# Called whenever the frontend polls GET /session/{room_id}. Two passive
# checks happen here that have no other natural trigger point in this
# architecture:
#
#   1. Pause auto-expiry: conversation_state_controller already auto-clears
#      an expired pause when the NEXT message arrives, but if no one sends
#      a message during or after the pause, only a state read will ever
#      notice. This covers that gap.
#
#   2. Idle-partner redirect: if the floor has sat with one partner for too
#      long with zero activity, Alinda gently invites the other partner in
#      rather than letting the room go silent.
# ─────────────────────────────────────────────────────────────────────────────

async def refresh_session_state(room_id: str, db: DBSession) -> TherapySession:
    """
    Read-path state refresh. Performs passive auto-corrections (pause
    expiry, idle redirect) as side effects of a routine state check, then
    returns the current (possibly just-updated) session.
    """
    session = get_session_or_404(room_id, db)

    # ── Lazy pause expiry ──────────────────────────────────────────────────
    if session.mode == "paused" and session.paused_until:
        expiry = session.paused_until
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= expiry:
            session.mode         = "guided"
            session.paused_until = None
            db.commit()
            db.refresh(session)
            logger.info(f"Room {room_id!r} pause auto-expired.")
            return session

    # ── Idle-partner redirect ─────────────────────────────────────────────
    await _maybe_redirect_idle_partner(session, db)

    return session


async def _maybe_redirect_idle_partner(session: TherapySession, db: DBSession) -> None:
    """
    If one partner has held the floor for longer than the idle timeout with
    no activity, posts a neutral system note and switches the floor to the
    other partner.

    Deliberately NOT an LLM-generated clinical message. Three reasons:
        1. There is no reliable way to actually confirm a partner is "gone"
           versus just thinking — manufacturing a confident-sounding clinical
           observation about an unverified state risks sounding presumptuous
           or judgmental exactly when warmth matters most.
        2. The previous design addressed the OTHER partner about the idle
           one ("invite Cloud to share while Sky is away") — this frames the
           idle partner as a topic of discussion rather than someone taking
           a normal pause, which is the opposite of what this moment needs.
        3. It's free and instant. No LLM round trip, no risk of an awkward
           generated phrasing, no token cost for something that should be
           a simple, calm, factual statement.

    The message is stored with sender="system", not sender="ai" — it is
    Alinda's room narrating a structural fact, not Alinda speaking
    clinically. Both partners see it identically in the shared transcript;
    there is no special re-entry handling when the idle partner returns —
    they simply see the message and what followed, like anyone catching
    up on a conversation.
    """
    if session.mode != "guided":
        return
    if session.current_turn not in ("a", "b"):
        return
    if session.last_action == "idle_redirect":
        return   # Already fired for this idle period — don't repeat on every poll

    last_activity = session.last_activity_at or session.session_started_at
    if last_activity is None:
        return
    if last_activity.tzinfo is None:
        last_activity = last_activity.replace(tzinfo=timezone.utc)

    elapsed = (datetime.now(timezone.utc) - last_activity).total_seconds()
    if elapsed < _IDLE_TIMEOUT_SECONDS:
        return

    idle_role  = session.current_turn
    other_role = "b" if idle_role == "a" else "a"
    idle_name  = session.name_a if idle_role == "a" else session.name_b
    other_name = session.name_b if idle_role == "a" else session.name_a

    note_text = (
        f"It looks like {idle_name} has taken a little break. "
        f"{other_name} can continue for now — we'll pick back up together when ready."
    )

    system_msg = ChatMessage(
        room_id      = session.room_id,
        sender       = "system",
        message_type = "system",
        content      = note_text,
        extra_data   = {"type": "idle_redirect", "mode": session.mode},
    )
    db.add(system_msg)

    session.current_turn = other_role
    session.last_action  = "idle_redirect"
    session.last_target  = other_role

    db.commit()

    await _dispatch(session.room_id, {"type": "new_message", "payload": [_serialize_message(system_msg)]})

    logger.info(f"Idle note posted in room {session.room_id!r}: {idle_role} → {other_role}")



# ─────────────────────────────────────────────────────────────────────────────
# THE MASTER PIPELINE
# ─────────────────────────────────────────────────────────────────────────────


async def process_user_message(
    room_id:           str,
    sender:             str,
    raw_text:           str,
    db:                 DBSession,
    background_tasks:   BackgroundTasks,
) -> dict:
    """
    The beating heart of the live session. Every user message flows through
    this single function. The full choreography:

        0. Refresh state first — clears a stale pause that may have expired
           since the last poll, before deciding whether this message can
           even be processed.
        1. The Shield — conversation_guardrails.pre_flight_check(). Crisis-
           irrelevant spam, duplicates, and oversized messages are
           intercepted before they ever reach analysis or the LLM.
        2. Analysis — ai.analysis.analyze_message() on the cleaned text.
        3. The Clinical Call — mediator_logic.decide_mediation().
        4. Flag injection — closes the documented guardrails→mediator gap.
        5. FSM enforcement — conversation_state_controller.adjust_decision(),
           which also commits all structural state (streaks, phase, mode)
           directly onto the session object.
        6. Expression — llm_client.generate_session_response().
        7. Turn resolution — reconciling the next_speaker naming collision.
        8. Persistence — both ChatMessage rows, the behavioral ledger
           update, escalation memory, and rolling averages, all in one
           transaction.
        9. Real-time dispatch (no-op until Block 6 registers a broadcaster).
       10. Time-limit check — closes the session gracefully if this turn
           pushed it past its duration limit.

    The entire body (steps 1-10) is wrapped in try/except/rollback for
    atomicity: if anything fails unexpectedly partway through, the database
    transaction is rolled back in full and a graceful fallback message is
    returned rather than a 500. The user's original message is never lost
    in a half-committed state — worst case, they simply resend it.

    Returns a dict:
        {
            "session":      TherapySession,        — the updated ORM object
            "new_messages": list[ChatMessage],      — [] for silent drops
            "no_op":        bool,                   — True for silent drops
        }
    routes.py serializes "session" via SessionStateResponse.model_validate()
    and each entry in "new_messages" via MessageResponse.model_validate().
    """
    session = await refresh_session_state(room_id, db)
    verify_partner_access(sender, session)
    ensure_session_active(session)

    if session.mode == "intake":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Waiting for both partners to complete intake before the session can begin.",
        )

    try:
        # ── Step 1: The Shield ────────────────────────────────────────────────
        recent_messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.room_id == room_id)
            .order_by(ChatMessage.timestamp.desc())
            .limit(_RECENT_MESSAGES_FETCH_LIMIT)
            .all()
        )
        recent_messages.reverse()

        preflight = pre_flight_check(session, sender, raw_text, recent_messages)

        if not preflight.allowed:
            if preflight.early_response is None:
                # Silent drop — duplicate or empty. Pretend nothing happened.
                db.commit()
                return {"session": session, "new_messages": [], "no_op": True}

            # Length guardrail — persist the user's full original message
            # (so it doesn't feel like it vanished) followed by Alinda's
            # gentle structural response, in her normal voice/bubble.
            user_msg = ChatMessage(
                room_id      = room_id,
                sender        = sender,
                message_type  = "user",
                content        = raw_text,
                extra_data     = {"guardrail_blocked": True, "reason": preflight.rejection_reason},
            )
            ai_msg = ChatMessage(
                room_id       = room_id,
                sender         = "ai",
                message_type    = "ai",
                content          = preflight.early_response,
                extra_data       = {"action": "length_guardrail", "mode": session.mode},
            )
            db.add(user_msg)
            db.add(ai_msg)
            db.commit()

            await _dispatch(room_id, {

                "type": "new_message",
                "messages": [_serialize_message(user_msg), _serialize_message(ai_msg)],
            })

            return {"session": session, "new_messages": [user_msg, ai_msg], "no_op": False}

        cleaned_text = preflight.cleaned_text
        flags        = preflight.flags

        # ── Step 2: Analysis ──────────────────────────────────────────────────
        analysis = analyze_message(cleaned_text)
        _update_rolling_averages(session, analysis)

        # mediator_logic reads session.last_user_message as the CURRENT
        # message's text — this write must happen here, after pre-flight's
        # duplicate check (which compared against the PREVIOUS value) has
        # already run, and before decide_mediation reads it.
        session.last_user_message = cleaned_text

        speaker_name = session.name_a if sender == "a" else session.name_b
        other_name   = session.name_b if sender == "a" else session.name_a

        # ── Step 3: The Clinical Call ────────────────────────────────────────
        decision = decide_mediation(session, analysis, sender, speaker_name, other_name)

        # ── Step 4: Flag injection (closes the documented gap) ──────────────
        decision = _apply_preflight_flags(decision, flags, speaker_name)

        # ── Step 5: FSM enforcement (mutates session in place) ───────────────
        decision = adjust_decision(session, sender, analysis, decision)

        # ── Step 6: Expression ────────────────────────────────────────────────
        llm_result = await generate_session_response(
            name_a            = session.name_a,
            name_b            = session.name_b,
            recent_messages   = recent_messages,
            analysis          = analysis,
            decision          = decision,
            partner_profile_a = session.partner_profile_a,
            partner_profile_b = session.partner_profile_b,
            session_insight    = session.prior_session_summary,
        )

        # ── Step 7: Turn resolution ───────────────────────────────────────────
        session.current_turn = _resolve_current_turn(decision, llm_result)

        # ── Step 8: Persistence ───────────────────────────────────────────────
        user_msg = ChatMessage(
            room_id       = room_id,
            sender         = sender,
            message_type    = "user",
            content          = cleaned_text,
            extra_data       = {**analysis, **flags},
        )
        ai_msg = ChatMessage(
            room_id       = room_id,
            sender         = "ai",
            message_type    = "ai",
            content          = llm_result["message"],
            extra_data       = {
                "action":    decision["action"],
                "mode":      decision["mode"],
                "exercise":  decision.get("exercise"),
                "llm":       llm_result["llm"],
                "target":    session.current_turn,
            },
        )
        db.add(user_msg)
        db.add(ai_msg)

        ledger_update = decision.get("_behavioral_update", {})
        for key, value in ledger_update.items():
            setattr(session, key, value)

        final_action = decision["action"]
        _update_escalation_memory(session, final_action)
        _ensure_crisis_lock(session)

        session.last_activity_at = datetime.now(timezone.utc)

        # ── Step 10: Time-limit check (before final commit) ──────────────────
        _check_and_close_if_time_expired(session, background_tasks)

        db.commit()
        db.refresh(session)
        db.refresh(user_msg)
        db.refresh(ai_msg)

        # ── Step 9: Real-time dispatch ─────────────────────────────────────────

        await _dispatch(room_id, {
            "type": "new_message",
            "messages": [_serialize_message(user_msg), _serialize_message(ai_msg)],
        })

        return {"session": session, "new_messages": [user_msg, ai_msg], "no_op": False}

    except HTTPException:
        raise   # Genuine client errors (4xx) pass through unchanged

    except Exception as exc:
        logger.error(f"process_user_message failed for room {room_id!r}: {exc}", exc_info=True)
        db.rollback()

        fallback_msg = ChatMessage(
            room_id      = room_id,
            sender        = "ai",
            message_type   = "ai",
            content         = "Something went wrong on my end — could you try sending that again?",
            extra_data      = {"action": "pipeline_error"},
        )
        
        db.add(fallback_msg)
        db.commit()
        db.refresh(session)
        db.refresh(fallback_msg)

        return {"session": session, "new_messages": [fallback_msg], "no_op": False}