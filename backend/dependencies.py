"""
backend/dependencies.py

Reusable FastAPI dependencies for Alinda.

This file isolates four concerns that would otherwise be duplicated across
every route handler in backend/routes.py:

    1. Database lifecycle      — get_db()
    2. Room lookup (404)       — get_therapy_session_by_path() / get_session_or_404()
    3. Active session guard    — get_active_session() / ensure_session_active()
    4. Partner identity check  — verify_partner_access()  (auth stub for Phase 2 Block 8)

Design note on path params vs. body params:
    FastAPI dependencies declared with Depends() can request a Pydantic body
    model as a parameter, but if the route handler ALSO requests that same
    body model, FastAPI parses and validates the JSON body twice per request.
    Functionally correct, but wasteful.

    To avoid this, two patterns are provided for each lookup:

        Path-based routes (GET /session/{room_id}):
            Use the Depends()-compatible version directly:
                session: TherapySession = Depends(get_therapy_session_by_path)

        Body-based routes (POST with room_id in the request body):
            Call the plain helper function after the route already has
            the parsed payload:
                session = get_session_or_404(payload.room_id, db)

    Both versions share the same underlying query logic — there is exactly
    one implementation of "find session or 404", just two ways to invoke it.

Connection pool note (Neon):
    Neon's free tier serverless Postgres can suspend idle connections.
    get_db() opens and closes a connection per request, which is correct,
    but the underlying engine in database.py should be configured with
    pool_pre_ping=True so SQLAlchemy detects and replaces stale connections
    automatically rather than raising on a suspended endpoint. If you see
    intermittent "SSL connection has been closed unexpectedly" errors under
    low traffic, that setting is the fix — check database.py's create_engine() call.

WebSocket compatibility:
    FastAPI WebSocket route handlers support Depends() identically to HTTP
    routes, including generator-based dependencies like get_db(). When
    backend/websocket_manager.py is built in Block 6, get_db() can be reused
    without modification. Authentication for WebSocket connections (which
    cannot use standard HTTP headers easily) is the eventual home for a
    token-in-query-string variant of verify_partner_access — flagged here,
    not yet implemented.
"""

from __future__ import annotations

import logging
from typing import Generator, Optional

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import TherapySession

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# 1. THE DATABASE LIFELINE
# ─────────────────────────────────────────────────────────────────────────────

def get_db() -> Generator[Session, None, None]:
    """
    Yields a database session for the duration of a single request, then
    closes it unconditionally — including when the route raises an exception.

    
    This is the single most important dependency in the application. Without
    the guaranteed close() in the finally block, every request that errors
    partway through (a malformed body, an unexpected exception in the AI
    pipeline) would leak a connection. Under any real traffic, Neon's
    connection pool would exhaust within minutes and the entire backend
    would start returning 500s for every user, not just the one whose
    request failed.

    
    Usage:
        @router.post("/send-message")
        async def send_message(payload: SendMessageRequest, db: Session = Depends(get_db)):
            ...

    The try/finally pattern here is intentional over a context manager
    decorator — FastAPI's dependency injection system specifically
    recognises generator functions used with Depends() and handles the
    yield/cleanup lifecycle correctly across both success and exception paths.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# 2. THE 404 ELIMINATOR — ROOM LOOKUP
# ─────────────────────────────────────────────────────────────────────────────

def get_session_or_404(room_id: str, db: Session) -> TherapySession:
    """
    The single source of truth for "find a session by room_id or fail cleanly."

    This is a PLAIN function, not a Depends()-wrapped dependency. Use this
    directly inside route handlers that receive room_id from a request body
    (the majority of POST routes in this application):

        @router.post("/send-message")
        async def send_message(
            payload: SendMessageRequest,
            db: Session = Depends(get_db),
        ):
            session = get_session_or_404(payload.room_id, db)
            # session is now guaranteed to exist — no None checks needed below

    Args:
        room_id: The room code submitted by the client.
        db:      An active database session (typically from Depends(get_db)).

    Returns:
        The TherapySession ORM object.

    Raises:
        HTTPException(404): If no session exists for this room_id.
    """
    session = (
        db.query(TherapySession)
        .filter(TherapySession.room_id == room_id)
        .first()
    )


    if session is None:
        logger.info(f"Room lookup failed — no session for room_id={room_id!r}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No session found for room '{room_id}'. Check the code and try again.",
        )

    return session


async def get_therapy_session_by_path(
    room_id: str = Path(..., min_length=1, max_length=100),
    db: Session = Depends(get_db),
) -> TherapySession:
    """
    The Depends()-compatible version of get_session_or_404().

    Use this for routes where room_id arrives as a URL path parameter —
    typically GET requests:

        @router.get("/session/{room_id}")
        async def get_session_state(
            session: TherapySession = Depends(get_therapy_session_by_path),
        ):
            return session   # already fetched, already validated to exist

    This is the version that fulfils your original "404 eliminator" vision
    most directly — the route signature alone guarantees a valid session,
    with zero lookup code inside the function body.
    """
    return get_session_or_404(room_id, db)


# ─────────────────────────────────────────────────────────────────────────────
# 3. THE GHOST BUSTER — ACTIVE SESSION GUARD
# ─────────────────────────────────────────────────────────────────────────────

# Terminal states — a session in either of these will never produce a new
# clinical response. Any route that tries to act on it should be rejected.
_TERMINAL_MODE  = "closed"
_TERMINAL_PHASE = "ended"


def ensure_session_active(session: TherapySession) -> None:
    """
    Raises if the session has concluded. Otherwise does nothing.

    PLAIN function — call directly after get_session_or_404() in body-based
    routes:

        session = get_session_or_404(payload.room_id, db)
        ensure_session_active(session)
        # proceed with the AI pipeline

    Deliberately permissive about everything except true termination.
    A session in cooldown, safety_lockdown, crisis_pause, or paused is
    still "active" in the sense that matters here — those states represent
    Alinda doing her job, not the session being over. Only mode == "closed"
    or phase == "ended" represent a genuinely concluded session where no
    further clinical processing should occur.

    This deliberately does NOT block feedback submission or insight
    retrieval — those routes are MEANT to be called after a session ends.
    They should call get_session_or_404() alone, without this guard.

    Args:
        session: The TherapySession to check.

    Raises:
        HTTPException(403): If the session has concluded.
    """
    if session.mode == _TERMINAL_MODE or session.phase == _TERMINAL_PHASE:
        logger.info(
            f"Blocked action on concluded session room_id={session.room_id!r} "
            f"(mode={session.mode!r}, phase={session.phase!r})"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This session has concluded. Start a new session to continue.",
        )


async def get_active_session(
    session: TherapySession = Depends(get_therapy_session_by_path),
) -> TherapySession:
    """
    The Depends()-compatible combination of lookup + active check, for
    path-parameter routes.

        @router.get("/session/{room_id}/live-status")
        async def live_status(
            session: TherapySession = Depends(get_active_session),
        ):
            ...   # guaranteed to exist AND guaranteed to still be active

    For body-based routes, chain the two plain functions manually:

        session = get_session_or_404(payload.room_id, db)
        ensure_session_active(session)
    """
    ensure_session_active(session)
    return session


# ─────────────────────────────────────────────────────────────────────────────
# 4. THE IDENTITY VERIFIER — PARTNER ACCESS CHECK
# ─────────────────────────────────────────────────────────────────────────────

def verify_partner_access(role: str, session: TherapySession) -> None:
    """
    Confirms the claimed role actually corresponds to a partner who has
    joined this session.

    This is not an empty placeholder — it closes a real gap that exists
    right now without it. Without this check, a request claiming
    role="b" would be processed by session_manager even if Partner B has
    never joined the room, potentially creating messages and AI responses
    attributed to a partner who doesn't exist yet.

    PHASE 2 BLOCK 8 — FUTURE EXPANSION POINT:
        When user accounts are implemented, this function becomes the
        single place where authentication is enforced across the entire
        application. The expansion will look like:

            def verify_partner_access(
                role: str,
                session: TherapySession,
                token: str = Depends(oauth2_scheme),   # JWT from Authorization header
            ) -> None:
                payload = decode_jwt(token)              # raises 401 if invalid/expired
                authenticated_user_id = payload["sub"]

                expected_identifier = (
                    session.partner_identifier_a if role == "a"
                    else session.partner_identifier_b
                )
                if authenticated_user_id != expected_identifier:
                    raise HTTPException(403, "This session does not belong to you.")

        Every route handler that currently calls verify_partner_access(role, session)
        will not need to change at all — only this function's body changes.
        That is the entire point of isolating this here.

    Args:
        role:    "a" or "b" — the role making the request.
        session: The session being acted upon.

    Raises:
        HTTPException(403): If the claimed partner has not joined the session.
    """
    if role == "a" and not session.name_a:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Partner A has not joined this session yet.",
        )

    if role == "b" and not session.name_b:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Partner B has not joined this session yet.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# CONVENIENCE COMBINATOR
#
# Most body-based routes need all three checks in sequence: lookup, active
# guard, partner verification. Rather than three separate lines repeated in
# every route, this combinator does all three and returns the validated session.
# ─────────────────────────────────────────────────────────────────────────────

def get_validated_session(
    room_id: str,
    role:    str,
    db:      Session,
    require_active: bool = True,
) -> TherapySession:
    """
    The complete validation pipeline for body-based routes, in one call.

    Usage in a typical route:

        @router.post("/send-message")
        async def send_message(payload: SendMessageRequest, db: Session = Depends(get_db)):
            session = get_validated_session(payload.room_id, payload.sender, db)
            # session is guaranteed to exist, be active, and the sender role
            # is guaranteed to correspond to a joined partner

    Set require_active=False for routes that should work on concluded
    sessions — feedback submission and insight retrieval, specifically:

        session = get_validated_session(
            payload.room_id, payload.role, db, require_active=False
        )

    Args:
        room_id:        The room code from the request.
        role:           "a" or "b" — claimed by the request.
        db:             Active database session.
        require_active: If True (default), rejects concluded sessions.
                        Set False for post-session routes (feedback, insight).

    Returns:
        The fully validated TherapySession.

    Raises:
        HTTPException(404): Room does not exist.
        HTTPException(403): Session concluded (if require_active=True) or
                            claimed partner has not joined.
    """
    session = get_session_or_404(room_id, db)

    if require_active:
        ensure_session_active(session)

    verify_partner_access(role, session)

    return session