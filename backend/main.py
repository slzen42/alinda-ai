"""
backend/main.py

The application entry point for Alinda.

Startup sequence, in order:
    1. Logging configuration — so every module's logger.info/warning/error
       calls (and there are many, across classifier, mediator_logic,
       conversation_state_controller, etc.) actually produce visible output
       on Render rather than vanishing silently.
    2. CORS — configured from environment, defaults to local dev.
    3. Classifier warmup — forces the DistilBERT singleton to load during
       server boot rather than on the first real user's first message.
    4. WebSocket connection manager activation — wires real-time dispatch
       into session_manager.py with zero coupling in the other direction.
    5. Router registration — session, feedback, and WebSocket surfaces.

Schema management:
    Alembic owns the database schema exclusively. Base.metadata.create_all()
    is intentionally NOT called here — calling it alongside Alembic risks
    the two falling out of sync with no warning. Every schema change must
    go through `alembic revision --autogenerate` and `alembic upgrade head`.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.feedback_routes import router as feedback_router
from backend.routes import router as session_router
from backend.websocket_manager import connection_manager
from backend.websocket_manager import router as websocket_router

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
#
# Configured before anything else imports. Every ai/ and backend/ module in
# this system calls logger.info / logger.warning / logger.error extensively —
# crisis detection, classifier load status, mediator decisions, guardrail
# fires. Without this, all of it is silently dropped on Render. Render
# captures stdout directly, so a simple StreamHandler is sufficient — no
# file rotation needed in a containerized environment.
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level  = logging.INFO,
    format = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# APPLICATION
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "Alinda Backend",
    description = "AI-mediated couples counselling backend service",
    version     = "2.0.0",
)


# ─────────────────────────────────────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────────────────────────────────────

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8501").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins     = allowed_origins,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL EXCEPTION HANDLER
#
# Every deliberate error path in this system already raises a clean
# HTTPException with a user-appropriate detail message — FastAPI handles
# those correctly on its own and this handler never sees them. This is
# the backstop for the unanticipated case: a genuine bug, an unexpected
# third-party exception. It guarantees the client always receives a
# calm, structured JSON error rather than a raw stack trace, while the
# full traceback is still captured in the server logs for debugging.
# ─────────────────────────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code = status.HTTP_500_INTERNAL_SERVER_ERROR,
        content     = {"detail": "Something went wrong on our end. Please try again."},
    )


# ─────────────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup() -> None:
    # Forces the classifier singleton to load now, during boot, rather than
    # lazily on the first request that happens to touch ai.analysis. Import
    # is deliberately local to this function — it must run after logging is
    # configured above, so the classifier's own load-status logging
    # (model directory found, device, label count, warm-up timing) is
    # actually visible in the startup logs.
    from ai.classifier import classifier

    if classifier.ready:
        logger.info(f"Classifier loaded successfully at startup — device: {classifier.device}")
    else:
        logger.error(
            "Classifier failed to load at startup. The server will run in "
            "FALLBACK MODE — all messages will receive neutral analysis scores "
            "until this is fixed. Check that ai/models/alinda-classifier/ "
            "exists and contains the expected files."
        )

    # Wires session_manager's HTTP-triggered state changes (pause, resume,
    # crisis-ready, end-session, every message) through to connected
    # WebSocket clients in real time. session_manager.py has no import of
    # or dependency on websocket_manager.py — this single call is the only
    # point of contact between the two.
    connection_manager.activate()

    logger.info("Alinda backend startup complete.")


# ─────────────────────────────────────────────────────────────────────────────
# ROUTERS
# ─────────────────────────────────────────────────────────────────────────────

app.include_router(session_router)
app.include_router(feedback_router)
app.include_router(websocket_router)


# ─────────────────────────────────────────────────────────────────────────────
# ROOT
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Infrastructure"])
def root() -> dict:
    return {"message": "Alinda backend is running", "version": "2.0.0"}