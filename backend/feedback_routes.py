"""
backend/feedback_routes.py

The post-session API surface for Alinda.

Isolated from backend/routes.py deliberately, per the architectural
principle that live-session traffic and post-session traffic have
fundamentally different operational needs:

    Live session (/api/v1/session/*):
        Latency-sensitive. Every millisecond of delay on /message is felt
        directly by two people mid-conversation. No meaningful incentive
        for abuse beyond normal usage.

    Post-session (/api/v1/feedback/*):
        Latency-tolerant. A few hundred extra milliseconds on a rating
        submission is invisible to a user who has already finished their
        session. Real incentive for abuse exists here — a malicious actor
        could script repeated 1-star submissions or scrape generated
        insights by guessing room_ids. Separating the router means rate
        limiting, caching headers, or stricter request logging can be
        applied here independently, without touching the live-session
        router at all.

This file follows the same "Dumb Route" principle as backend/routes.py:
no try/except for business logic, no direct database queries, no FSM
awareness. Every error-worthy condition is already raised as a clean
HTTPException by session_manager.py and dependencies.py before it
reaches this file.

The two routes here close the loop opened when a session ends in
backend/routes.py's end_session handler, which schedules
_run_summarizer_background as a FastAPI BackgroundTask. That task runs
after the HTTP response has already been returned to the client — so by
the time a user reaches the rating screen, summarization may or may not
have finished. These two routes are designed around that uncertainty:

    POST /feedback             — always available the instant the session
                                  closes, regardless of summarization status
    GET  /insight/{room_id}     — gracefully reports "still processing"
                                  rather than 404ing while the background
                                  task is in flight

Public surface:
    POST /api/v1/feedback                    — submit_feedback
    GET  /api/v1/feedback/{room_id}/insight   — poll_insight
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session as DBSession

from backend.dependencies import get_db
from backend import session_manager
from backend.models import SessionFeedback
from backend.schemas import (
    SessionFeedbackRequest,
    SessionFeedbackResponse,
    SessionInsightPollResponse,
    SessionInsightResponse,
)


router = APIRouter(
    prefix = "/api/v1/feedback",
    tags   = ["Post-Session"],
)


# ─────────────────────────────────────────────────────────────────────────────
# FEEDBACK SUBMISSION
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "",
    response_model = SessionFeedbackResponse,
    status_code    = status.HTTP_201_CREATED,
    summary        = "Submit post-session feedback (one partner)",
)
def submit_feedback(
    payload: SessionFeedbackRequest,
    db:      DBSession = Depends(get_db),
) -> SessionFeedbackResponse:
    """
    Records one partner's session rating and qualitative feedback.

    Deliberately bypasses the standard active-session guard — this route
    is only ever called AFTER a session has closed. session_manager.submit_feedback
    internally calls get_validated_session(..., require_active=False), which
    still enforces that the room exists (404) and that the submitting role
    actually joined it (403) — only the "must still be active" check is lifted.

    Idempotent by replacement: if this partner has already submitted
    feedback for this room, the prior submission is deleted and replaced
    rather than creating a duplicate row. This handles the common case of
    a partner double-tapping submit or refreshing the rating screen after
    a slow network response, without polluting the feedback table with
    near-duplicate rows for the same person.

    Raises 404 if the room doesn't exist.
    Raises 403 if the submitting role never joined this room.
    """
    # Idempotency guard — presentation-layer concern (preventing duplicate
    # rows on resubmission), kept here rather than in session_manager since
    # it's about HTTP retry behavior, not session orchestration.
    existing = (
        db.query(SessionFeedback)
        .filter(
            SessionFeedback.room_id == payload.room_id,
            SessionFeedback.role    == payload.role,
        )
        .first()
    )
    if existing is not None:
        db.delete(existing)
        db.flush()

    feedback = session_manager.submit_feedback(
        room_id                     = payload.room_id,
        role                         = payload.role,
        felt_heard                   = payload.felt_heard,
        alinda_helpful                = payload.alinda_helpful,
        conversation_moved_forward    = payload.conversation_moved_forward,
        free_text                     = payload.free_text,
        db                             = db,
    )

    return SessionFeedbackResponse(
        ok      = True,
        room_id = feedback.room_id,
        role    = feedback.role,
    )


# ─────────────────────────────────────────────────────────────────────────────
# INSIGHT POLLING
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{room_id}/insight",
    response_model = SessionInsightPollResponse,
    summary        = "Poll for the post-session insight summary",
)
def poll_insight(
    room_id: str,
    role:    str = Query(..., pattern="^[ab]$", description="The requesting partner's role: 'a' or 'b'"),
    db:      DBSession = Depends(get_db),
) -> SessionInsightPollResponse:
    """
    Gracefully reports whether session_summarizer.py has finished its
    background work for this room.

    This route is designed to be polled every 1-2 seconds by the frontend
    immediately after a session closes. summarize_session() typically
    completes within a few seconds of the background task starting, but
    that work happens entirely independently of the HTTP request/response
    cycle — there is no way to know in advance exactly when it will land.

    ready=False (no insight row exists yet):
        This is NOT an error condition. It does not raise 404. The frontend
        should render a loading skeleton and continue polling.

    ready=True:
        The insight is fully populated. The frontend should stop polling
        and render the summary dashboard.

    role is required as a query parameter (not just for show — it is
    enforced) specifically to prevent the "curious onlooker guesses a
    room_id" scenario described in the architectural blueprint: a user
    cannot read another couple's psychological summary by guessing or
    scraping room_ids, because the role must correspond to a partner who
    actually joined that specific room.

    Raises 404 if the room doesn't exist.
    Raises 403 if the requesting role never joined this room.
    """
    insight = session_manager.get_latest_insight(room_id, role, db)

    if insight is None:
        return SessionInsightPollResponse(ready=False, insight=None)

    return SessionInsightPollResponse(
        ready   = True,
        insight = SessionInsightResponse.model_validate(insight),
    )