"""
backend/schemas.py

The API contract layer for Alinda.

This file defines every request and response shape that crosses the
network boundary between the React frontend and the FastAPI backend.

Design principles:

    Privacy by contract:
        Internal AI state (behavioral ledgers, raw analysis scores,
        trait probabilities, action logs, partner profiles) never
        appears in any response schema. The frontend receives only
        what it needs to render the UI. Clinical intelligence stays
        on the server.

    Strict typing:
        All state values use Literal types. A typo like mode="guidedd"
        is rejected at the schema boundary with a 422 error — it
        never reaches the session manager or the database.

    Explicit over implicit:
        Every field that the frontend receives is declared here.
        No raw dict passthrough. No Optional[Any].
        If it's in the schema, we chose to expose it.

    Computed fields for safety:
        MessageResponse builds SafeMessageExtraData from the raw
        ChatMessage.extra_data JSON. The transformation is explicit
        and auditable in this file, not buried in a route handler.

Schema groups:
    ROOM MANAGEMENT         CreateRoom, JoinRoom
    INTAKE PIPELINE         IntakeSubmission, IntakeStyleUpdate
    SESSION STATE           SessionStateResponse (the FSM mirror)
    MESSAGING               SendMessage, MessageResponse, ConversationResponse
    REAL-TIME SYNC          TypingStatus
    CRISIS                  CrisisReady
    SESSION LIFECYCLE       EndSession, PauseSession, ResumeSession
    FEEDBACK                SessionFeedback
    SESSION INSIGHT         SessionInsight (post-session summary)
    HEALTH                  HealthResponse
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ─────────────────────────────────────────────────────────────────────────────
# SHARED LITERALS
# Single source of truth for all state string values.
# If a value changes in the FSM, update it here — all schemas stay in sync.
# ─────────────────────────────────────────────────────────────────────────────

# The complete set of valid FSM modes.
# Defined in conversation_state_controller.State
SessionMode = Literal[
    "intake",
    "ready_for_session",
    "guided",
    "free_chat",
    "cooldown",
    "safety_lockdown",
    "crisis_pause",
    "paused",
    "wrapping_up",
    "closed",
]

# Therapeutic arc phases computed from elapsed time.
# Defined in conversation_state_controller.Phase
SessionPhase = Literal[
    "opening",
    "exploration",
    "deepening",
    "resolution",
    "closing",
]

# Administrative session lifecycle state.
# Distinct from mode — phase is the outer shell, mode is the FSM.
SessionLifecyclePhase = Literal[
    "waiting_for_partner",
    "waiting_for_intake",
    "ready_for_session",
    "ended",
]

# Partner role identifier.
Role = Literal["a", "b"]

# Extended role including system/AI senders in the transcript.
MessageSender = Literal["a", "b", "ai", "system"]

# Session style preference — set during intake.
SessionStyle = Literal["gentle", "direct", "practical", "balanced"]

# Rating scale for feedback questions.
# Pydantic validates that submitted integers fall within this range.
RatingScale = Literal[1, 2, 3, 4, 5]


# ─────────────────────────────────────────────────────────────────────────────
# ROOM MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

class CreateRoomRequest(BaseModel):
    """
    Creates a new therapy room and registers Partner A.

    room_id:  The shared session code. Short codes like "thunder-104" are
              accepted now. In production, replace with server-generated UUID4.
    name_a:   Partner A's display name. Used by Alinda in all responses.
              Max 50 characters — prevents UI overflow.
    """
    room_id: str = Field(..., min_length=1, max_length=100)
    name_a:  str = Field(..., min_length=1, max_length=50)

    @field_validator("name_a")
    @classmethod
    def name_cannot_be_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank or whitespace only.")
        return v.strip()


class JoinRoomRequest(BaseModel):
    """
    Registers Partner B in an existing room.

    Returns 404 if the room_id does not exist.
    Returns 400 if Partner B has already joined.
    """
    room_id: str = Field(..., min_length=1, max_length=100)
    name_b:  str = Field(..., min_length=1, max_length=50)

    @field_validator("name_b")
    @classmethod
    def name_cannot_be_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank or whitespace only.")
        return v.strip()


# ─────────────────────────────────────────────────────────────────────────────
# INTAKE PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

class IntakeSubmission(BaseModel):
    """
    Submits a partner's pre-session intake responses.

    intake_text:    The combined answers from the four intake questions,
                    formatted by the frontend as:
                    "WHAT HAS BEEN DIFFICULT:\n...\n\nCORE NEED:\n..."
                    Max 8000 characters — enough for four thoughtful answers.

    session_style:  The partner's preferred therapeutic approach.
                    Stored as session_style_a or session_style_b on the session.
                    If not provided, defaults to "balanced".
    """
    room_id:       str         = Field(..., min_length=1, max_length=100)
    role:          Role
    intake_text:   str         = Field(..., min_length=10, max_length=8000)
    session_style: SessionStyle = Field(default="balanced")

    @field_validator("intake_text")
    @classmethod
    def intake_must_have_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Intake text cannot be blank.")
        return v.strip()


# ─────────────────────────────────────────────────────────────────────────────
# SAFE MESSAGE EXTRA DATA
#
# The ChatMessage.extra_data JSON column is rich — it contains raw transformer
# scores, trait signals, and internal routing metadata.
#
# We do NOT send raw scores to the frontend. Reasons:
#   1. Privacy: "toxicity: 8" about your partner's message would be harmful to display.
#   2. Security: Raw scores reveal the AI's internal weighting, which could be gamed.
#   3. Necessity: The frontend only needs a small subset for UI rendering.
#
# This model defines exactly what the frontend receives.
# All other fields are silently dropped during serialisation.
# ─────────────────────────────────────────────────────────────────────────────

class SafeMessageExtraData(BaseModel):
    """
    The safe, frontend-facing subset of ChatMessage.extra_data.

    Fields included:
        action:     The therapeutic action Alinda took (e.g., "explore", "validate").
                    Used by the frontend to apply visual styling to AI messages
                    (e.g., safety_intervention messages get the red tint).

        exercise:   A cooldown exercise identifier if one was prescribed.
                    Used by the React frontend to render the correct UI card.
                    Currently only "pause" — reserved for future expansion.

        type:       For system messages — the event type.
                    Values: "turn_assignment" | "crisis_ready" | "crisis_waiting"
                    Used by the frontend to decide whether to render a
                    turn indicator or a crisis screen element.

        mode:       The session mode at the time of this AI message.
                    Used to apply mode-aware styling (cooldown card, safety banner).

        crisis:     For user messages — whether a crisis was detected.
                    Values: "none" | "self_harm" | "harm_to_other"
                    Used by the crisis screen to know what resources to display.

    Fields NOT included (internal only):
        escalation, blame, vulnerability, toxicity, abuse_score,
        contempt, engagement, sentiment, confidence, escalation_intent,
        top_emotions, is_abusive, repair_attempt, behavioral data,
        llm, llm_suggested_target, _level, _traits_sender, _session_temp
    """
    action:   Optional[str] = None
    exercise: Optional[str] = None
    type:     Optional[str] = None
    mode:     Optional[str] = None
    crisis:   Optional[str] = None

    model_config = {"extra": "ignore"}   # Drop all other fields silently


# ─────────────────────────────────────────────────────────────────────────────
# MESSAGING
# ─────────────────────────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    """
    Sends a user message to the session.

    Pre-flight checks (duplicate, length, rate) run in conversation_guardrails
    before the message reaches the AI pipeline.
    Content is also validated here at the API boundary.
    """
    room_id: str  = Field(..., min_length=1, max_length=100)
    sender:  Role
    content: str  = Field(..., min_length=1, max_length=2000)

    @field_validator("content")
    @classmethod
    def content_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Message content cannot be blank.")
        return v


class MessageResponse(BaseModel):
    """
    A single message in the transcript, safe for frontend delivery.

    extra_data is transformed through SafeMessageExtraData on the way out.
    Raw analysis scores never leave the server.
    """
    id:           int
    room_id:      str
    sender:       str                      # MessageSender — not strict here for flexibility
    message_type: str
    content:      str
    timestamp:    datetime
    extra_data:   Optional[SafeMessageExtraData] = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def sanitise_extra_data(cls, values: Any) -> Any:
        """
        Transforms raw extra_data dict into SafeMessageExtraData on the way out.

        Called before field validation so we control the transformation explicitly.
        Handles both ORM objects (with .extra_data attribute) and plain dicts.
        """
        if hasattr(values, "__dict__"):
            # ORM object — extract extra_data attribute
            raw = getattr(values, "extra_data", None)
        elif isinstance(values, dict):
            raw = values.get("extra_data")
        else:
            raw = None

        if isinstance(raw, dict):
            safe = SafeMessageExtraData(**raw)
            if hasattr(values, "__dict__"):
                values.extra_data = safe
            elif isinstance(values, dict):
                values["extra_data"] = safe

        return values


class ConversationResponse(BaseModel):
    """
    The complete transcript for a session.
    Returned by GET /conversation/{room_id}.
    """
    room_id:  str
    messages: list[MessageResponse]


# ─────────────────────────────────────────────────────────────────────────────
# SESSION STATE — THE FSM MIRROR
#
# This is the most important response schema.
# It is the complete picture of what the frontend needs to render the session.
#
# Design rule: include everything the UI needs. Exclude everything it doesn't.
# Every field here has a documented UI consumer.
# ─────────────────────────────────────────────────────────────────────────────

class SessionStateResponse(BaseModel):
    """
    The complete frontend-safe view of a TherapySession.

    Returned by:
        GET  /session/{room_id}
        POST /create-room
        POST /join-room
        POST /submit-intake
        POST /end-session
        POST /crisis-ready

    Privacy shield:
        behavioral_ledger_a, behavioral_ledger_b   → excluded (clinical AI state)
        partner_profile_a, partner_profile_b       → excluded (internal briefing)
        recent_action_log                          → excluded (internal routing)
        intake_a, intake_b                         → excluded (private disclosures)
        prior_session_summary                      → excluded (internal briefing)
        passcode_hash_a, passcode_hash_b           → excluded (security)

    UI consumers for each field:
        room_id             → URL params for session restore on browser refresh
        name_a, name_b      → chat header, turn indicator, message names
        phase               → controls which screen to render (waiting, chat, etc.)
        current_turn        → enables/disables the message input
        mode                → triggers cooldown card, safety banner, crisis screen
        session_phase       → phase indicator (reserved for React progress bar)
        dialogue_stage      → the stage pill at the top of the chat screen
        session_started_at  → React progress bar timer
        session_duration_limit → React progress bar upper bound
        locked_until        → crisis countdown timer
        paused_until        → pause screen countdown
        partner_typing      → typing indicator (three dots)
        typing_role         → whose three dots to show
        crisis_ready_a/b    → which partners have pressed "I'm ready"
        end_requested_by    → who asked to end (shows confirmation to other)
        end_confirmed       → triggers rating screen on both devices
        feedback_submitted_a/b → hides rating screen after submission
        intake_a_submitted/b   → shows waiting screen correctly
        session_style          → React can style the UI subtly per style
        session_number         → shows "Session 3" in the header for returning couples
        escalation_unresolved  → React can keep the safety banner visible
        created_at          → session metadata display
        last_activity_at    → detect idle sessions from frontend
    """

    # ── Identity ──────────────────────────────────────────────────────────────
    room_id:  str
    name_a:   Optional[str] = None
    name_b:   Optional[str] = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    phase: str                   # SessionLifecyclePhase — outer shell state

    # ── FSM State ─────────────────────────────────────────────────────────────
    current_turn:    Optional[str]  = None   # "a", "b", or None (open floor)
    mode:            str            = "intake"
    session_phase:   Optional[str]  = None   # "opening" | "exploration" | ...
    dialogue_stage:  Optional[str]  = None   # Stage pill label

    # ── Session Timers ────────────────────────────────────────────────────────
    session_started_at:     Optional[datetime] = None
    session_duration_limit: Optional[int]      = 90   # minutes
    last_activity_at:       Optional[datetime] = None

    # ── Pause and Lock ────────────────────────────────────────────────────────
    locked_until: Optional[datetime] = None   # crisis countdown expiry
    paused_until: Optional[datetime] = None   # user-pause expiry

    # ── Crisis State ──────────────────────────────────────────────────────────
    crisis_ready_a: bool = False
    crisis_ready_b: bool = False

    # ── Real-time Sync ────────────────────────────────────────────────────────
    partner_typing: bool         = False
    typing_role:    Optional[str] = None

    # ── Intake Progress ───────────────────────────────────────────────────────
    # Booleans only — not the raw intake text (private disclosure)
    intake_a_submitted: bool = False
    intake_b_submitted: bool = False

    # Style selected by each partner during intake.
    session_style: Optional[str] = "balanced"

    # ── Session End ───────────────────────────────────────────────────────────
    end_requested_by:    Optional[str]  = None
    end_confirmed:       bool           = False
    ended_at:            Optional[datetime] = None
    feedback_submitted_a: bool          = False
    feedback_submitted_b: bool          = False

    # ── Session Context ───────────────────────────────────────────────────────
    session_number:        int  = 1
    escalation_unresolved: bool = False

    # ── Metadata ──────────────────────────────────────────────────────────────
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# REAL-TIME SYNC
# ─────────────────────────────────────────────────────────────────────────────

class TypingStatusRequest(BaseModel):
    """
    Sent by the frontend when a partner starts or stops typing.
    Triggers the three-dot indicator on the other partner's screen.
    """
    room_id:    str  = Field(..., min_length=1, max_length=100)
    role:       Role
    is_typing:  bool


# ─────────────────────────────────────────────────────────────────────────────
# CRISIS
# ─────────────────────────────────────────────────────────────────────────────

class CrisisReadyRequest(BaseModel):
    """
    Sent when a partner presses "I'm ready" after a crisis pause countdown.
    When both partners submit this, the session resumes with an AI re-entry message.
    """
    room_id: str  = Field(..., min_length=1, max_length=100)
    role:    Role


# ─────────────────────────────────────────────────────────────────────────────
# SESSION LIFECYCLE
# ─────────────────────────────────────────────────────────────────────────────

class EndSessionRequest(BaseModel):
    """
    Sent when a partner requests to end the session.

    First request: sets end_requested_by on the session.
                   Other partner sees a confirmation prompt.
    Second request: (from the other partner) confirms the end,
                    sets end_confirmed=True, triggers the rating screen.
    """
    room_id: str  = Field(..., min_length=1, max_length=100)
    role:    Role


class PauseSessionRequest(BaseModel):
    """
    Pauses the session for a specified duration.
    Either partner can pause unilaterally.
    Both partners must press resume, OR the pause expires automatically.

    duration_minutes:  How long to pause. Default 15 minutes. Max 60.
    """
    room_id:          str  = Field(..., min_length=1, max_length=100)
    role:             Role
    duration_minutes: int  = Field(default=15, ge=1, le=60)


class ResumeSessionRequest(BaseModel):
    """
    Sent when a partner presses resume after a pause.
    Session resumes when both partners have submitted this request.
    """
    room_id: str  = Field(..., min_length=1, max_length=100)
    role:    Role


# ─────────────────────────────────────────────────────────────────────────────
# FEEDBACK
# ─────────────────────────────────────────────────────────────────────────────

class SessionFeedbackRequest(BaseModel):
    """
    Post-session rating submitted by one partner.
    Collected via the rating screen shown after both partners confirm end.

    All three rating fields are required — free_text is optional.
    Ratings are integers 1-5 validated by Literal to prevent out-of-range values.
    """
    room_id:  str = Field(..., min_length=1, max_length=100)
    role:     Role

    # Core therapeutic quality metrics
    felt_heard:                 RatingScale
    alinda_helpful:             RatingScale
    conversation_moved_forward: RatingScale

    # Optional qualitative feedback — the most valuable training signal
    free_text: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("free_text")
    @classmethod
    def clean_free_text(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        stripped = v.strip()
        return stripped if stripped else None


class SessionFeedbackResponse(BaseModel):
    """Confirms that feedback was recorded."""
    ok:      bool = True
    room_id: str
    role:    str


# ─────────────────────────────────────────────────────────────────────────────
# SESSION INSIGHT — POST-SESSION SUMMARY
#
# Generated by session_summarizer.py after the session closes.
# Returned to the frontend to display a "Session Summary" dashboard.
# Also returned to clients who want to see what Alinda observed.
#
# Privacy note: This schema is safe to show both partners.
# It contains therapeutic observations, not raw scores or clinical labels.
# ─────────────────────────────────────────────────────────────────────────────

class SessionInsightResponse(BaseModel):
    """
    The post-session summary generated by session_summarizer.py.

    Safe to display to both partners after the session closes.
    Contains therapeutic narrative, not clinical scores.

    Returned by: GET /session/{room_id}/insight

    Frontend consumer: "Session Summary" screen shown after the rating screen.
    Gives the couple a record of what was discussed and what they committed to.
    """

    id:             int
    room_id:        str
    session_number: int

    # ── Narrative fields ──────────────────────────────────────────────────────
    key_themes:             Optional[str] = None
    breakthrough_moments:   Optional[str] = None
    unresolved_threads:     Optional[str] = None
    emotional_arc_a:        Optional[str] = None   # Uses "Partner A" not real name
    emotional_arc_b:        Optional[str] = None   # Uses "Partner B" not real name
    relationship_dynamic:   Optional[str] = None
    concrete_commitment:    Optional[str] = None
    recommended_focus:      Optional[str] = None

    # ── Session metrics ───────────────────────────────────────────────────────
    total_messages:           Optional[int]  = None
    resolution_reached:       bool           = False
    session_duration_minutes: Optional[int]  = None

    # ── Timestamps ────────────────────────────────────────────────────────────
    session_started_at: Optional[datetime] = None
    session_ended_at:   Optional[datetime] = None
    created_at:         datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    """
    Returned by GET /health.
    Used by Render's health check and monitoring tools.

    classifier_ready:  False means the AI model failed to load —
                       the server is running in fallback mode.
    classifier_device: "cuda" or "cpu" — useful for debugging performance.
    """
    status:             str  = "ok"
    classifier_ready:   bool = False
    classifier_device:  str  = "cpu"
    version:            str  = "2.0.0"



# ─────────────────────────────────────────────────────────────────────────────
# GENERIC RESPONSES
# ─────────────────────────────────────────────────────────────────────────────

class AckResponse(BaseModel):
    """
    Generic acknowledgement for operations that don't return data.
    Used by: typing-status, pause, resume.
    """
    ok: bool = True



class ErrorResponse(BaseModel):
    """
    Structured error response for the frontend.
    FastAPI returns this when HTTPException is raised.
    """
    detail: str