"""
backend/websocket_manager.py

The real-time traffic controller for Alinda.

This file is a pure transport layer. It contains zero clinical logic and
zero FSM rules — every incoming message is handed directly to
session_manager.process_user_message(), which already owns the entire
11-step pipeline. This file's only job is moving bytes between connected
sockets and the rest of the application, and keeping the in-memory
connection ledger consistent with reality.

Architecture:

    ConnectionManager (module-level singleton)
        rooms: dict[room_id, dict[role, ManagedConnection]]
            One nested dict per room. At most two entries per room ("a", "b").

    ManagedConnection
        Wraps a raw WebSocket plus its heartbeat task and last-pong timestamp.
        One per connected socket — disposed entirely on disconnect, never reused.

    Lifecycle, per the four pillars in the design brief:

        A. Heartbeat — _heartbeat_loop() runs as its own asyncio task per
           connection, pinging every 25s and disconnecting if no pong
           arrives within 5s.

        B. Eviction — connect() checks for an existing connection under the
           same (room_id, role) key and forcibly closes it before binding
           the new one, preventing ghost connections from a refresh or
           double-tap.

        C. Graceful degradation — this file is purely additive. Every HTTP
           route in backend/routes.py continues to work identically whether
           or not a WebSocket is connected. register_broadcaster() in
           session_manager.py is how this file plugs in without that file
           needing to know WebSockets exist at all.

Wiring (see exact placement notes after the code):
    main.py must call `connection_manager.activate()` once at startup,
    which registers this manager's broadcast method with session_manager.
    main.py must also include the router defined at the bottom of this file.

Event vocabulary (Server ↔ Client), all frames shaped as {"type": ..., "payload": ...}:
    typing_status   Client → Server → Server rebroadcasts to the other partner
    state_update     Server → Client   Full SessionStateResponse, sent on any state change
    new_message      Server → Client   One or more newly persisted ChatMessage frames
    error            Server → Client   Isolated error toast, connection stays alive
    pong             Client → Server   Heartbeat reply (handled internally, never surfaced to UI)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session as DBSession

from backend.database import SessionLocal
from backend.models import TherapySession
from backend.schemas import MessageResponse, SessionStateResponse
from backend import session_manager

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

_HEARTBEAT_INTERVAL_SECONDS = 25   # How often the server pings
_PONG_TIMEOUT_SECONDS       = 5    # How long to wait for a reply before declaring dead

# WebSocket close codes (RFC 6455 application-range, 4000-4999, reserved for us)
_CLOSE_INVALID_ROOM    = 4404
_CLOSE_FORBIDDEN_ROLE  = 4403
_CLOSE_EVICTED         = 4001
_CLOSE_HEARTBEAT_DEAD  = 4002


# ─────────────────────────────────────────────────────────────────────────────
# MANAGED CONNECTION
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ManagedConnection:
    """
    A single connected socket plus its lifecycle metadata.

    Owns its own heartbeat task — when the connection is disposed, the
    task is cancelled explicitly rather than left to die on its own,
    since an orphaned asyncio task pinging a closed socket is a real
    memory and error-log leak under sustained traffic.
    """
    websocket:    WebSocket
    room_id:      str
    role:         str
    awaiting_pong: bool = False
    heartbeat_task: Optional[asyncio.Task] = field(default=None, repr=False)

    async def dispose(self) -> None:
        if self.heartbeat_task is not None:
            self.heartbeat_task.cancel()
        try:
            await self.websocket.close()
        except Exception:
            pass   # Already closed — fine, this is best-effort cleanup


# ─────────────────────────────────────────────────────────────────────────────
# CONNECTION MANAGER — THE SINGLETON LEDGER
# ─────────────────────────────────────────────────────────────────────────────

class ConnectionManager:
    """
    The in-memory connection pool described in the design brief.

    rooms maps room_id -> {"a": ManagedConnection, "b": ManagedConnection}.
    A room entry only exists once at least one partner has connected, and
    is removed entirely once both partners have disconnected — an idle
    room with no live sockets costs nothing in memory.

    This is process-local state. On a single Render instance this is
    correct. If horizontal scaling is ever introduced (multiple backend
    processes), this in-memory pool would need to move to a shared store
    (Redis pub/sub is the standard choice) so a message arriving on
    process A can still reach a partner connected to process B. Flagging
    this now as a known scaling boundary — not a bug, a deliberate
    "good enough for the current single-instance deployment" choice.
    """

    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, ManagedConnection]] = {}
        self._lock = asyncio.Lock()

    def activate(self) -> None:
        """
        Call once at application startup. Registers this manager's
        broadcast method with session_manager so that HTTP-triggered
        state changes (process_user_message, pause, crisis-ready, etc.)
        reach connected WebSocket clients automatically, with zero
        WebSocket-awareness inside session_manager.py itself.
        """
        session_manager.register_broadcaster(self.broadcast_to_room)
        logger.info("WebSocket ConnectionManager activated and registered as broadcaster.")

    # ── Registration and eviction ────────────────────────────────────────────

    async def connect(self, websocket: WebSocket, room_id: str, role: str) -> ManagedConnection:
        """
        Registers a new connection, evicting any prior connection under
        the same (room_id, role) key first. The caller must have already
        called websocket.accept() before this is invoked.
        """
        async with self._lock:
            room = self.rooms.setdefault(room_id, {})

            existing = room.get(role)
            if existing is not None:
                logger.info(
                    f"Evicting stale connection for room={room_id!r} role={role!r} "
                    f"— a new connection has taken its place."
                )
                # Dispose outside the lock to avoid holding it during I/O —
                # schedule it and don't await here to keep connect() fast.
                asyncio.create_task(self._evict(existing))

            managed = ManagedConnection(websocket=websocket, room_id=room_id, role=role)
            managed.heartbeat_task = asyncio.create_task(self._heartbeat_loop(managed))
            room[role] = managed

        logger.info(f"Connected: room={room_id!r} role={role!r} (pool size: {len(room)})")
        return managed

    async def _evict(self, connection: ManagedConnection) -> None:
        try:
            await connection.websocket.close(code=_CLOSE_EVICTED, reason="Replaced by a newer connection")
        except Exception:
            pass
        if connection.heartbeat_task is not None:
            connection.heartbeat_task.cancel()

    async def disconnect(self, room_id: str, role: str) -> None:
        """
        Removes a connection from the pool and cleans up its heartbeat task.
        Safe to call multiple times for the same connection — idempotent.
        Removes the room entry entirely once empty, so memory doesn't
        accumulate for rooms nobody is connected to anymore.
        """
        async with self._lock:
            room = self.rooms.get(room_id)
            if room is None:
                return

            managed = room.pop(role, None)
            if managed is not None and managed.heartbeat_task is not None:
                managed.heartbeat_task.cancel()

            if not room:
                self.rooms.pop(room_id, None)

        logger.info(f"Disconnected: room={room_id!r} role={role!r}")

    # ── Heartbeat ─────────────────────────────────────────────────────────────

    async def _heartbeat_loop(self, connection: ManagedConnection) -> None:
        """
        Runs for the entire lifetime of one connection. Pings every
        _HEARTBEAT_INTERVAL_SECONDS; if the client hasn't replied with a
        pong (handled by _handle_incoming marking awaiting_pong=False)
        within _PONG_TIMEOUT_SECONDS of the ping being sent, declares the
        connection dead and tears it down — this is what catches a phone
        that silently dropped off cellular without a clean close frame.
        """
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL_SECONDS)

                connection.awaiting_pong = True
                try:
                    await connection.websocket.send_json({"type": "ping", "payload": {}})
                except Exception:
                    break   # Socket already gone — let the receive loop's except handle cleanup

                await asyncio.sleep(_PONG_TIMEOUT_SECONDS)

                if connection.awaiting_pong:
                    logger.warning(
                        f"Heartbeat timeout: room={connection.room_id!r} role={connection.role!r}. "
                        f"Closing connection."
                    )
                    try:
                        await connection.websocket.close(
                            code=_CLOSE_HEARTBEAT_DEAD, reason="Heartbeat timeout"
                        )
                    except Exception:
                        pass
                    break

        except asyncio.CancelledError:
            pass   # Normal — happens whenever dispose()/disconnect() cancels this task

    # ── Broadcasting ──────────────────────────────────────────────────────────

    async def broadcast_to_room(self, room_id: str, payload: dict) -> None:
        """
        Sends a frame to every connected socket in a room.

        This is the function registered with session_manager.register_broadcaster().
        It is deliberately tolerant of partial failure — if one socket in
        the room has gone stale and send_json raises, the other partner
        still receives the broadcast, and the failed socket is queued for
        disconnect rather than allowed to silently poison future broadcasts.
        """
        room = self.rooms.get(room_id)
        if not room:
            return   # No one connected — HTTP polling fallback covers this partner

        dead_roles: list[str] = []
        for role, connection in list(room.items()):
            try:
                await connection.websocket.send_json(payload)
            except Exception:
                logger.warning(f"Broadcast failed to room={room_id!r} role={role!r} — marking for cleanup.")
                dead_roles.append(role)

        for role in dead_roles:
            await self.disconnect(room_id, role)

    async def send_to_role(self, room_id: str, role: str, payload: dict) -> bool:
        """
        Sends a frame to exactly one partner, e.g. an isolated error toast
        that only the offending sender should see. Returns False (rather
        than raising) if that partner isn't currently connected — the
        caller decides whether that matters.
        """
        room = self.rooms.get(room_id)
        connection = room.get(role) if room else None
        if connection is None:
            return False
        try:
            await connection.websocket.send_json(payload)
            return True
        except Exception:
            await self.disconnect(room_id, role)
            return False


# Module-level singleton — imported by main.py and by the route below.
connection_manager = ConnectionManager()


# ─────────────────────────────────────────────────────────────────────────────
# HANDSHAKE VALIDATION
#
# WebSocket connections cannot be rejected with a clean HTTPException the
# way HTTP routes can — the standard pattern is to accept() first, then
# validate, then close with a specific code and reason if invalid. This
# means a momentary connection-then-immediate-close for bad requests,
# which is normal and expected WebSocket behavior, not a bug.
# ─────────────────────────────────────────────────────────────────────────────

async def _validate_handshake(
    websocket: WebSocket,
    room_id:   str,
    role:      str,
    db:        DBSession,
) -> Optional[TherapySession]:
    """
    Validates the room exists and the role belongs to it, using the exact
    same rules as the HTTP layer's dependencies.verify_partner_access —
    but invoked manually here, since Depends() injection that raises
    HTTPException does not translate to a clean WebSocket close.

    Returns the TherapySession on success, or None after having already
    closed the socket with an appropriate code on failure.
    """
    session = (
        db.query(TherapySession)
        .filter(TherapySession.room_id == room_id)
        .first()
    )
    if session is None:
        await websocket.close(code=_CLOSE_INVALID_ROOM, reason=f"No session found for room '{room_id}'")
        return None

    partner_name = session.name_a if role == "a" else session.name_b
    if not partner_name:
        await websocket.close(
            code=_CLOSE_FORBIDDEN_ROLE,
            reason=f"Partner {role!r} has not joined this session yet.",
        )
        return None

    return session


# ─────────────────────────────────────────────────────────────────────────────
# INCOMING FRAME HANDLING
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_incoming(
    connection: ManagedConnection,
    frame:      dict,
    db:         DBSession,
) -> None:
    """
    Dispatches one incoming client frame by its "type" field.

    Recognised types:
        pong            — heartbeat reply, clears awaiting_pong, never surfaced further
        typing_status   — relayed to the other partner, also recorded in the DB
                          via session_manager.set_typing_status so HTTP-polling
                          clients (graceful degradation) see the same state
        message         — the full clinical pipeline, via process_user_message

    Unrecognised types are logged and ignored rather than raising — a
    forward-compatibility courtesy for future frontend versions sending
    frame types this backend version doesn't yet know about.
    """
    frame_type = frame.get("type")
    payload    = frame.get("payload", {}) or {}
    room_id    = connection.room_id
    role       = connection.role

    if frame_type == "pong":
        connection.awaiting_pong = False
        return

    if frame_type == "typing_status":
        is_typing = bool(payload.get("is_typing", False))
        session_manager.set_typing_status(room_id, role, is_typing, db)
        await connection_manager.broadcast_to_room(
            room_id,
            {"type": "typing_status", "payload": {"role": role, "is_typing": is_typing}},
        )
        return

    if frame_type == "message":
        content = (payload.get("content") or "").strip()
        if not content:
            return

        from fastapi import BackgroundTasks
        background_tasks = BackgroundTasks()

        result = await session_manager.process_user_message(
            room_id, role, content, db, background_tasks,
        )

        # process_user_message's own internal _dispatch call (registered
        # via activate()) already broadcasts "message" frames for the
        # normal-flow case. This explicit broadcast here is the safety net
        # for no_op=False results reached through paths where _dispatch
        # might not have fired identically — harmless if it double-sends,
        # since the frontend keys messages by id and ignores duplicates.
        if not result["no_op"] and result["new_messages"]:
            await connection_manager.broadcast_to_room(
                room_id,
                {
                    "type": "new_message",
                    "payload": [
                        MessageResponse.model_validate(m).model_dump(mode="json")
                        for m in result["new_messages"]
                    ],
                },
            )
            await connection_manager.broadcast_to_room(
                room_id,
                {
                    "type": "state_update",
                    "payload": SessionStateResponse.model_validate(result["session"]).model_dump(mode="json"),
                },
            )

        # BackgroundTasks scheduled inside process_user_message (session
        # summarization on time-limit closure) won't run automatically here
        # the way they would behind an HTTP response — there is no
        # response cycle on a WebSocket to trigger them. Run them manually.
        for task in background_tasks.tasks:
            asyncio.create_task(task())

        return

    logger.debug(f"Unrecognised frame type {frame_type!r} from room={room_id!r} role={role!r}")


# ─────────────────────────────────────────────────────────────────────────────
# THE WEBSOCKET ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/{room_id}/{role}")
async def session_websocket(websocket: WebSocket, room_id: str, role: str) -> None:
    """
    The single WebSocket endpoint for the entire application.

    URL shape: wss://your-domain/ws/{room_id}/{role}
    role must be exactly "a" or "b".

    Lifecycle:
        1. Accept the connection (required before any close-with-reason is possible).
        2. Validate room and role against the database.
        3. Register with the ConnectionManager (evicting any stale prior connection).
        4. Broadcast a state_update so the other partner sees this partner arrive.
        5. Loop: receive_json, dispatch via _handle_incoming.
        6. On disconnect (clean or abrupt): unregister, clear typing status,
           broadcast a final state_update so the remaining partner's UI
           updates immediately rather than waiting for a stale poll.

    Each connection opens and owns its own database session for its entire
    lifetime — distinct from the per-request get_db() pattern used by HTTP
    routes, since a WebSocket connection is long-lived rather than
    request-scoped. The session is closed unconditionally in the finally
    block.
    """
    if role not in ("a", "b"):
        await websocket.close(code=_CLOSE_FORBIDDEN_ROLE, reason="role must be 'a' or 'b'")
        return

    await websocket.accept()

    db = SessionLocal()
    try:
        session = await _validate_handshake(websocket, room_id, role, db)
        if session is None:
            return   # _validate_handshake already closed the socket with a reason

        connection = await connection_manager.connect(websocket, room_id, role)

        await connection_manager.broadcast_to_room(
            room_id,
            {
                "type": "state_update",
                "payload": SessionStateResponse.model_validate(session).model_dump(mode="json"),
            },
        )

        while True:
            try:
                frame = await websocket.receive_json()
            except WebSocketDisconnect:
                break

            try:
                await _handle_incoming(connection, frame, db)
            except Exception as exc:
                logger.error(
                    f"Error handling frame in room={room_id!r} role={role!r}: {exc}",
                    exc_info=True,
                )
                try:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"detail": "Something went wrong processing that. Please try again."},
                    })
                except Exception:
                    break   # Socket is gone — exit the loop, finally block handles cleanup

    finally:
        await connection_manager.disconnect(room_id, role)

        # Clear typing status so the remaining partner never sees a
        # permanent "Partner is typing..." indicator from a dropped phone.
        try:
            fresh_session = (
                db.query(TherapySession)
                .filter(TherapySession.room_id == room_id)
                .first()
            )
            if fresh_session is not None and fresh_session.typing_role == role:
                fresh_session.partner_typing = False
                fresh_session.typing_role    = None
                db.commit()

                await connection_manager.broadcast_to_room(
                    room_id,
                    {
                        "type": "state_update",
                        "payload": SessionStateResponse.model_validate(fresh_session).model_dump(mode="json"),
                    },
                )
        except Exception:
            logger.error(f"Failed to clear typing status on disconnect for room={room_id!r}", exc_info=True)
        finally:
            db.close()