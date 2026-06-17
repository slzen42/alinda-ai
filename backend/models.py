"""
backend/models.py

The Clinical Record Database for Alinda.

This is not a chat room database. It is a structured clinical record system.
Every column exists to serve a specific layer of the therapeutic pipeline.
Columns are grouped into logical sections that mirror the architecture:

    TherapySession
        ├── Identity & Access
        ├── FSM State (conversation_state_controller.py)
        ├── Clinical Intelligence (mediator_logic.py)
        ├── Pre-Flight Gatekeeper (conversation_guardrails.py)
        ├── Intake Pipeline (intake_analyzer.py)
        ├── Crisis Management
        ├── Real-time Sync (WebSocket / typing indicators)
        ├── Session Lifecycle
        └── Metadata

    ChatMessage          — immutable transcript, one row per message
    SessionInsight       — post-session archival (session_summarizer.py)
    SessionFeedback      — user ratings and qualitative feedback
    CoupleProfile        — forward-compatible stub for returning couples (Phase 2 Block 8)

Cascade delete contract:
    Deleting a TherapySession cascades to:
        → all ChatMessage rows for that room_id
        → all SessionInsight rows for that room_id
        → all SessionFeedback rows for that room_id
    This ensures no orphaned therapy transcripts remain.
    CoupleProfile is NOT cascaded from a single session —
    the couple's profile persists across sessions.

JSON column policy:
    Columns that store AI-produced data (behavioral ledgers, action logs,
    analysis scores, session insights) use JSON rather than individual columns.
    Reason: these structures evolve as the model improves. A new trait in the
    ledger next month should not require an Alembic migration to store.
    Postgres uses JSONB internally for indexed JSON; SQLite uses TEXT.
    SQLAlchemy's JSON type handles both transparently.

Security note on room_id:
    Currently stored as a short user-defined string ("101", "session-abc").
    This is acceptable for prototype testing but is guessable in production.
    Before public launch: replace with UUID4 generated server-side.
    The column type (String) does not need to change — only the values.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


# ─────────────────────────────────────────────────────────────────────────────
# UTILITY
# ─────────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    """Returns the current UTC datetime. Used as a column default."""
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# TABLE 1 — THERAPYSESSION
# The core clinical record. One row per session.
# ─────────────────────────────────────────────────────────────────────────────

class TherapySession(Base):
    """
    The central record for a single couples therapy session.

    Alinda reads from this table at the start of every message handler
    and writes back to it at the end. It is the single source of truth
    for the entire therapeutic state of the session.
    """

    __tablename__ = "sessions"

    # ── Primary key ───────────────────────────────────────────────────────────
    id = Column(Integer, primary_key=True, index=True)

    # ── Identity & Access ─────────────────────────────────────────────────────
    # room_id: the shared code both partners use to join.
    # Production note: replace user-defined codes with server-generated UUID4.
    room_id = Column(String, unique=True, index=True, nullable=False)

    # Partner display names. Set at room creation (name_a) and join (name_b).
    name_a = Column(String, nullable=True)
    name_b = Column(String, nullable=True)

    # Optional passcode hashes for re-entry.
    # Allows a partner to reconnect after a browser crash without exposing plaintext.
    # Phase 2 Block 8: populate when user accounts are implemented.
    # Stored as a bcrypt hash, never plaintext.
    passcode_hash_a = Column(String, nullable=True)
    passcode_hash_b = Column(String, nullable=True)

    # ── Session Lifecycle State ───────────────────────────────────────────────
    # phase: the admin-level session lifecycle state.
    # Values: "waiting_for_partner" | "waiting_for_intake" | "ready_for_session" | "ended"
    # Distinct from `mode` (the FSM therapeutic state) — phase is the
    # outer shell, mode is the inner state machine.
    phase = Column(String, default="waiting_for_partner", nullable=False)

    # Who has the conversational floor.
    # None = no enforced turn (used during free_chat and session start).
    # "a" or "b" = that partner must speak next.
    current_turn = Column(String, nullable=True)

    # ── FSM Macro States (conversation_state_controller.py) ───────────────────
    # mode: the current FSM state.
    # Valid values declared in State class in conversation_state_controller.py:
    # intake | ready_for_session | guided | free_chat | cooldown |
    # safety_lockdown | crisis_pause | paused | wrapping_up | closed
    mode = Column(String, default="intake", nullable=False)

    # session_phase: where we are in the therapeutic arc within the session.
    # Values: opening | exploration | deepening | resolution | closing
    # Computed from elapsed time in conversation_state_controller._compute_session_phase()
    session_phase = Column(String, default="opening", nullable=True)

    # The human-readable label shown in the frontend stage pill.
    # Set by conversation_state_controller._commit_state() from STAGE_MAP.
    dialogue_stage = Column(String, default="Opening up", nullable=True)

    # ── Timekeepers ───────────────────────────────────────────────────────────
    # When the first message of the active session was sent.
    # Used by _compute_session_phase() to determine the current phase.
    # Set on the first message if NULL.
    session_started_at = Column(DateTime, nullable=True)

    # The agreed session length in minutes.
    # Default: 90 minutes. Adjustable by the session creator.
    session_duration_limit = Column(Integer, default=90, nullable=False)

    # When the session formally ended (both partners confirmed end).
    ended_at = Column(DateTime, nullable=True)

    # Who requested the session end ("a" or "b").
    end_requested_by = Column(String, nullable=True)

    # Whether both partners have confirmed the end.
    end_confirmed = Column(Boolean, default=False, nullable=False)

    # User-initiated pause expiry.
    # When mode == "paused", this holds the datetime the pause automatically expires.
    # None = indefinite pause (both partners must press resume).
    paused_until = Column(DateTime, nullable=True)

    # ── FSM Streak Trackers (conversation_state_controller.py) ────────────────
    # How many consecutive turns the same partner has spoken.
    # Used by _check_consecutive_turns() — hard limit at 3.
    consecutive_turns = Column(Integer, default=0, nullable=False)

    # How many times the same action has fired in a row.
    # Used by _check_action_streak() — variety required above 3.
    action_streak = Column(Integer, default=0, nullable=False)

    # How many times the same person has been addressed in a row.
    # Used by _check_target_lock().
    target_streak = Column(Integer, default=0, nullable=False)

    # How many consecutive messages from the same sender had low engagement.
    # Populated by _check_stagnation() from the classifier's engagement score.
    stagnation_streak = Column(Integer, default=0, nullable=False)

    # ── FSM Pointer Memory ────────────────────────────────────────────────────
    # These three track what Alinda just did so guardrails can compare.
    last_speaker = Column(String, nullable=True)     # "a" or "b"
    last_action  = Column(String, nullable=True)     # e.g. "explore", "validate"
    last_target  = Column(String, nullable=True)     # "a", "b", or "both"

    # ── Therapeutic Loop State ────────────────────────────────────────────────
    # repair_cycle_stage: tracks where we are in the validate→reflect→repair_acknowledgement cycle.
    # Values: None | "validate" | "reflect" | "complete"
    # Managed by _advance_repair_cycle() in conversation_state_controller.py
    repair_cycle_stage = Column(String, nullable=True)

    # Which resume_guidance template to use next.
    # Cycles through _RESUME_TEMPLATES in mediator_logic.py.
    resume_guidance_index = Column(Integer, default=0, nullable=False)

    # ── Clinical Intelligence (mediator_logic.py) ─────────────────────────────
    # Per-partner behavioral ledgers stored as JSON.
    # Structure defined by _DEFAULT_LEDGER in mediator_logic.py.
    # Contains: event counts, rolling averages, trait probabilities, confirmed traits.
    # Written by _update_ledger() via the _behavioral_update field in the decision dict.
    # Read by _load_ledger() at the start of each decide_mediation() call.
    # JSON is preferred over individual columns because the ledger structure
    # evolves as new traits are added — no migration needed for new trait keys.
    behavioral_ledger_a = Column(JSON, nullable=True)
    behavioral_ledger_b = Column(JSON, nullable=True)

    # Rolling action log — last 8 {action, target, timestamp} dicts.
    # Written by _write_action_log() in conversation_state_controller.py.
    # Read by _count_recent_explore_to_sender() in mediator_logic.py.
    recent_action_log = Column(JSON, nullable=True)

    # ── Pre-Flight Gatekeeper (conversation_guardrails.py) ────────────────────
    # Timestamps of the most recent message from each partner.
    # Used by _check_duplicate() (30-second window) and _check_rate() (3-second threshold).
    # Must persist across requests so the window works if the server restarts.
    last_message_at_a = Column(DateTime, nullable=True)
    last_message_at_b = Column(DateTime, nullable=True)

    # The raw text of the last message — used for broken-record similarity comparison.
    last_user_message = Column(Text, nullable=True)

    # ── Intake Pipeline (intake_analyzer.py) ──────────────────────────────────
    # Raw intake text submitted by each partner during the intake screen.
    intake_a = Column(Text, nullable=True)
    intake_b = Column(Text, nullable=True)

    # Booleans tracking whether each partner has submitted their intake.
    # Allows the session to detect the transition from waiting → ready.
    intake_a_submitted = Column(Boolean, default=False, nullable=False)
    intake_b_submitted = Column(Boolean, default=False, nullable=False)

    # Pre-session clinical profiles generated by intake_analyzer.py.
    # These are the LLM's structured extraction of personality signals from intake text.
    # Injected into build_prompt() via the therapist briefing section.
    # Never shown to users. Always private.
    partner_profile_a = Column(Text, nullable=True)
    partner_profile_b = Column(Text, nullable=True)

    # Session style selected by each partner during intake.
    # Values: "gentle" | "direct" | "practical" | "balanced"
    session_style_a = Column(String, nullable=True)
    session_style_b = Column(String, nullable=True)

    # Derived session style — resolved from both partners' preferences.
    # Set by session_manager when both intakes are submitted.
    session_style = Column(String, default="balanced", nullable=True)

    # ── Crisis Management ─────────────────────────────────────────────────────
    # When in crisis_pause mode, this holds the datetime the lock expires.
    # After expiry, both partners must press "I'm ready" to resume.
    locked_until = Column(DateTime, nullable=True)

    # Whether each partner has pressed "I'm ready" after a crisis pause.
    crisis_ready_a = Column(Boolean, default=False, nullable=False)
    crisis_ready_b = Column(Boolean, default=False, nullable=False)

    # ── Session History Context (session_summarizer.py) ───────────────────────
    # The insight summary from the previous session, if one exists.
    # Fetched from the most recent SessionInsight for this couple.
    # Injected into build_prompt() at session start.
    # Written by session_manager when it loads prior insights.
    prior_session_summary = Column(Text, nullable=True)

    # Which session number this is for this couple.
    # 1 for the first session. Incremented by session_manager.
    # Used to fetch the correct prior SessionInsight.
    session_number = Column(Integer, default=1, nullable=False)

    # Optional: foreign key link to the couple's persistent profile.
    # None until user accounts are implemented (Phase 2 Block 8).
    couple_profile_id = Column(
        Integer,
        ForeignKey("couple_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ── Real-time Sync ────────────────────────────────────────────────────────
    # Whether the other partner is currently typing.
    # Written by the /typing-status endpoint, read by the frontend poll.
    partner_typing = Column(Boolean, default=False, nullable=False)

    # Which role is typing ("a" or "b"). None if no one is typing.
    typing_role = Column(String, nullable=True)

    # ── Escalation Memory ─────────────────────────────────────────────────────
    # These fields provide historical context for the clinical brief
    # without requiring a full read of the behavioral ledger.

    # Count of cooldown events this session.
    cooldown_count = Column(Integer, default=0, nullable=False)

    # Count of safety intervention events this session.
    safety_count = Column(Integer, default=0, nullable=False)

    # The type of the most recent escalation event.
    last_escalation_type = Column(String, nullable=True)

    # Whether an escalation is currently unresolved.
    # Set True when safety_intervention fires, set False when repair is acknowledged.
    escalation_unresolved = Column(Boolean, default=False, nullable=False)

    # ── Post-Session Tracking ─────────────────────────────────────────────────
    # Whether each partner has submitted their session rating.
    feedback_submitted_a = Column(Boolean, default=False, nullable=False)
    feedback_submitted_b = Column(Boolean, default=False, nullable=False)

    # ── Rolling Averages (session-level) ──────────────────────────────────────
    # Session-level aggregate scores updated after each message.
    # Provide a quick read for session_manager without querying all ChatMessages.
    avg_escalation   = Column(Float, default=0.0, nullable=False)
    avg_blame        = Column(Float, default=0.0, nullable=False)
    avg_vulnerability= Column(Float, default=0.0, nullable=False)
    message_count    = Column(Integer, default=0, nullable=False)

    # ── Metadata ──────────────────────────────────────────────────────────────
    created_at = Column(DateTime, default=_now, nullable=False)
    last_activity_at = Column(DateTime, default=_now, nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    messages = relationship(
        "ChatMessage",
        back_populates  = "session",
        cascade         = "all, delete-orphan",
        passive_deletes = True,
        order_by        = "ChatMessage.timestamp",
    )

    insights = relationship(
        "SessionInsight",
        back_populates  = "session",
        cascade         = "all, delete-orphan",
        passive_deletes = True,
        order_by        = "SessionInsight.created_at",
    )

    feedback = relationship(
        "SessionFeedback",
        back_populates  = "session",
        cascade         = "all, delete-orphan",
        passive_deletes = True,
    )

    couple = relationship(
        "CoupleProfile",
        back_populates = "sessions",
    )

    def __repr__(self) -> str:
        return (
            f"<TherapySession room={self.room_id!r} "
            f"phase={self.phase!r} mode={self.mode!r} "
            f"partners={self.name_a!r}/{self.name_b!r}>"
        )


# ─────────────────────────────────────────────────────────────────────────────
# TABLE 2 — CHATMESSAGE
# Immutable transcript. One row per message.
# ─────────────────────────────────────────────────────────────────────────────

class ChatMessage(Base):
    """
    An immutable record of a single message in a therapy session.

    ChatMessage rows are never updated after creation. They are the ground truth
    of what was said. The extra_data column captures the analysis state at the
    moment of the message — invaluable for debugging and future model training.

    Cascade: deleting the parent TherapySession deletes all ChatMessages for it.
    """

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)

    # Foreign key to the parent session.
    # ON DELETE CASCADE ensures orphaned messages never accumulate.
    room_id = Column(
        String,
        ForeignKey("sessions.room_id", ondelete="CASCADE"),
        nullable = False,
        index    = True,
    )

    # Who sent this message.
    # "a"      → Partner A's message
    # "b"      → Partner B's message
    # "ai"     → Alinda's response
    # "system" → structural message (turn assignment, session events)
    sender = Column(String, nullable=False)

    # What kind of message this is.
    # "user"   → human partner message
    # "ai"     → Alinda's clinical response
    # "system" → structural event (not displayed as a chat bubble)
    message_type = Column(String, default="user", nullable=False)

    # The message content. Never modified after creation.
    content = Column(Text, nullable=False)

    # Structured metadata stored alongside the message.
    # For user messages: the full analysis dict (escalation, vulnerability,
    #   contempt, engagement, crisis, top_emotions, etc.)
    # For AI messages: {action, mode, llm, llm_suggested_target, exercise}
    # For system messages: {type: "turn_assignment" | "crisis_ready" | ...}
    # Stored as JSON — structure evolves as the AI pipeline grows.
    extra_data = Column(JSON, nullable=True)

    # Timestamp of message creation. Never modified.
    timestamp = Column(DateTime, default=_now, nullable=False)

    # ── Relationship ──────────────────────────────────────────────────────────
    session = relationship("TherapySession", back_populates="messages")

    def __repr__(self) -> str:
        preview = (self.content or "")[:40]
        return f"<ChatMessage {self.sender!r} room={self.room_id!r} '{preview}'>"


# ─────────────────────────────────────────────────────────────────────────────
# TABLE 3 — SESSIONINSIGHT
# Post-session archival generated by session_summarizer.py.
# ─────────────────────────────────────────────────────────────────────────────

class SessionInsight(Base):
    """
    The therapist's post-session case notes.

    Generated by session_summarizer.py when a session closes.
    Fetched by session_manager at the start of the next session for
    the same couple and injected into build_prompt() as therapist briefing.

    This table is what gives Alinda her longitudinal memory.
    "Welcome back. Last week we were exploring trust."

    Cascade: deleting the parent TherapySession deletes the SessionInsight.
    CoupleProfile retains its own summary separately.
    """

    __tablename__ = "session_insights"

    id = Column(Integer, primary_key=True, index=True)

    room_id = Column(
        String,
        ForeignKey("sessions.room_id", ondelete="CASCADE"),
        nullable = False,
        index    = True,
    )

    # Optional link to the couple's persistent profile.
    # Allows the next session to load insights even when the room_id changes.
    couple_profile_id = Column(
        Integer,
        ForeignKey("couple_profiles.id", ondelete="SET NULL"),
        nullable = True,
        index    = True,
    )

    # Session number at the time this insight was generated.
    session_number = Column(Integer, default=1, nullable=False)

    # ── Narrative fields from session_summarizer.py ───────────────────────────
    # These are stored as structured text in the format defined by
    # build_session_summary_prompt() in prompts.py.
    # The session_summarizer extracts them by header and stores individually.

    # The 2-3 recurring themes from this session.
    key_themes = Column(Text, nullable=True)

    # Significant exchanges where something genuinely shifted.
    # May include direct quotes from the transcript.
    breakthrough_moments = Column(Text, nullable=True)

    # Topics avoided or left incomplete — carry-forward for next session.
    unresolved_threads = Column(Text, nullable=True)

    # How Partner A's emotional state changed from start to end.
    emotional_arc_a = Column(Text, nullable=True)

    # How Partner B's emotional state changed from start to end.
    emotional_arc_b = Column(Text, nullable=True)

    # The recurring pattern between them observed this session.
    relationship_dynamic = Column(Text, nullable=True)

    # A specific commitment made during this session, if any.
    concrete_commitment = Column(Text, nullable=True)

    # What the next session should prioritise.
    recommended_focus = Column(Text, nullable=True)

    # Computed behavioral metrics — symmetry, latency, escalation velocity, repair
    # efficacy. Entirely deterministic, computed by session_summarizer.py from
    # ChatMessage rows and the session's behavioral ledgers. Distinct from
    # TherapySession.behavioral_ledger_a/b, which is the live in-session
    # per-partner trait tracker — this is the post-session summary snapshot.
    behavioral_metrics = Column(JSON, nullable=True)

    # ── Session metrics snapshot ──────────────────────────────────────────────
    # These provide a quick quantitative read without joining ChatMessage.
    total_messages          = Column(Integer, nullable=True)
    total_escalation_events = Column(Integer, nullable=True)
    total_repair_bids       = Column(Integer, nullable=True)
    resolution_reached      = Column(Boolean, default=False, nullable=False)
    session_duration_minutes= Column(Integer, nullable=True)

    # ── Full structured insight (fallback / raw LLM output) ──────────────────
    # The complete LLM output before structured extraction.
    # Preserved in case the structured fields need to be re-extracted later
    # without another API call.
    raw_summary = Column(Text, nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    session_started_at = Column(DateTime, nullable=True)
    session_ended_at   = Column(DateTime, nullable=True)
    created_at         = Column(DateTime, default=_now, nullable=False)

    # ── Relationships ─────────────────────────────────────────────────────────
    session = relationship("TherapySession", back_populates="insights")

    def __repr__(self) -> str:
        return (
            f"<SessionInsight room={self.room_id!r} "
            f"session_number={self.session_number} "
            f"resolved={self.resolution_reached}>"
        )


# ─────────────────────────────────────────────────────────────────────────────
# TABLE 4 — SESSIONFEEDBACK
# User ratings collected at session end.
# ─────────────────────────────────────────────────────────────────────────────

class SessionFeedback(Base):
    """
    Post-session qualitative and quantitative feedback from each partner.

    Collected via the session rating screen shown after both partners
    confirm session end. Each partner submits independently — this table
    can have 0, 1, or 2 rows per session.

    This is the primary training signal for future model improvements.
    A session that scored highly in all three metrics is evidence that
    the routing decisions made during that session were good decisions.

    Cascade: deleting the parent TherapySession deletes all feedback.
    """

    __tablename__ = "session_feedback"

    id = Column(Integer, primary_key=True, index=True)

    room_id = Column(
        String,
        ForeignKey("sessions.room_id", ondelete="CASCADE"),
        nullable = False,
        index    = True,
    )

    # "a" or "b" — which partner submitted this feedback
    role = Column(String, nullable=False)

    # ── Core rating metrics (1-5) ─────────────────────────────────────────────
    # Three orthogonal dimensions of therapeutic quality.

    # Did this person feel genuinely heard during the session?
    felt_heard = Column(Integer, nullable=True)

    # Did Alinda's contributions help the conversation?
    alinda_helpful = Column(Integer, nullable=True)

    # Did the conversation create meaningful movement in the relationship?
    conversation_moved_forward = Column(Integer, nullable=True)

    # ── Optional qualitative feedback ─────────────────────────────────────────
    # Free text from the rating screen — the most valuable signal of all.
    # Users say things in free text that Likert scales can't capture.
    free_text = Column(Text, nullable=True)

    # ── Metadata ──────────────────────────────────────────────────────────────
    submitted_at = Column(DateTime, default=_now, nullable=False)

    # ── Relationships ─────────────────────────────────────────────────────────
    session = relationship("TherapySession", back_populates="feedback")

    def __repr__(self) -> str:
        return (
            f"<SessionFeedback room={self.room_id!r} role={self.role!r} "
            f"heard={self.felt_heard} helpful={self.alinda_helpful}>"
        )


# ─────────────────────────────────────────────────────────────────────────────
# TABLE 5 — COUPLEPROFILE
# Forward-compatible stub for returning couples.
# Phase 2 Block 8: populated when user accounts are implemented.
# ─────────────────────────────────────────────────────────────────────────────

class CoupleProfile(Base):
    """
    The persistent identity of a returning couple.

    This table is the foundation of Alinda's longitudinal memory.
    When the same two people return for a second session, their CoupleProfile
    is loaded and all past SessionInsights for this couple are available.

    Phase 2 Block 8 status: the table is created and the foreign keys exist,
    but session_manager does not yet populate it. Users connect as anonymous
    partners identified only by their room_id.

    When user accounts are implemented:
        - Users will authenticate (email + password or social login)
        - A CoupleProfile is created the first time two users create a room
        - All subsequent sessions link to this profile
        - session_manager loads prior SessionInsights at session start
        - Alinda's opening message references what happened last time

    Privacy: if a couple requests data deletion, deleting the CoupleProfile
    sets the couple_profile_id on their sessions to NULL (SET NULL cascade)
    rather than deleting the sessions — preserving the transcript while
    severing the identity link. Sessions can also be deleted independently.
    """

    __tablename__ = "couple_profiles"

    id = Column(Integer, primary_key=True, index=True)

    # Optional display name for this couple's relationship.
    # e.g. "Sky & Cloud" — set by users if they choose.
    couple_name = Column(String, nullable=True)

    # Hashed identifiers for each partner.
    # Phase 2 Block 8: link to User table when implemented.
    # For now, stored as hashed email or device fingerprint.
    partner_identifier_a = Column(String, nullable=True, index=True)
    partner_identifier_b = Column(String, nullable=True, index=True)

    # Total number of sessions this couple has completed.
    # Incremented by session_manager when a session closes.
    total_sessions = Column(Integer, default=0, nullable=False)

    # Cumulative insight across all sessions.
    # Updated by session_summarizer after each session closes.
    # This is the text injected into the very first message of the next session
    # when a couple returns — Alinda's long-term memory of this relationship.
    cumulative_insight = Column(Text, nullable=True)

    # The most recent concrete commitment made across any session.
    last_commitment = Column(Text, nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at       = Column(DateTime, default=_now, nullable=False)
    last_session_at  = Column(DateTime, nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    sessions = relationship(
        "TherapySession",
        back_populates = "couple",
        # Do NOT cascade delete — deleting a couple profile should not
        # erase therapy transcripts. Sessions are SET NULL (see FK above).
    )

    insights = relationship(
        "SessionInsight",
        # Read-only access to all insights for this couple across all sessions.
        # No cascade — insights belong to sessions, not directly to the profile.
        primaryjoin = "CoupleProfile.id == foreign(SessionInsight.couple_profile_id)",
        viewonly    = True,
        order_by    = "SessionInsight.created_at",
    )

    def __repr__(self) -> str:
        return (
            f"<CoupleProfile id={self.id} "
            f"sessions={self.total_sessions}>"
        )


# ─────────────────────────────────────────────────────────────────────────────
# COMPOSITE INDEXES
# Additional indexes beyond the column-level ones above.
# These optimise the most common multi-column queries.
# ─────────────────────────────────────────────────────────────────────────────

Index(
    "ix_chat_messages_room_timestamp",
    ChatMessage.room_id,
    ChatMessage.timestamp,
    # Optimises: SELECT * FROM chat_messages WHERE room_id = ? ORDER BY timestamp
    # This is the most frequent query in the system — every message load.
)

Index(
    "ix_session_insights_couple_number",
    SessionInsight.couple_profile_id,
    SessionInsight.session_number,
    # Optimises: SELECT * FROM session_insights WHERE couple_profile_id = ?
    #            ORDER BY session_number DESC LIMIT 1
    # Used by session_manager to fetch the most recent insight for a couple.
)


Index(
    "ix_session_feedback_room_role",
    SessionFeedback.room_id,
    SessionFeedback.role,
    # Optimises: SELECT * FROM session_feedback WHERE room_id = ? AND role = ?
    # Used to check whether a specific partner has already submitted feedback.
)