"""
ai/conversation_state_controller.py

The structural enforcement layer of Alinda.

This module is the final gate before the clinical decision reaches the LLM.
It sees the conversation as a structure — states, phases, sequences, streaks —
not as a human exchange. All content intelligence lives upstream.

Architecture position:
    mediator_logic.decide_mediation()
        └── conversation_state_controller.adjust_decision()
                └── llm_client.generate_session_response()

Role:
    Receives the clinical decision from mediator_logic.py and applies
    structural guardrails:
        1. FSM state validation — is this action valid in the current state?
        2. Phase validation — is this action appropriate for where we are in the session?
        3. Repair cycle protection — is a therapeutic sequence in progress?
        4. Consecutive turn enforcement — has one partner had the floor too long?
        5. Action streak prevention — is the same action firing in a loop?
        6. Target lock prevention — has the same person been addressed too many times?
        7. Stagnation detection — is the conversation structurally stuck?
        8. Action log maintenance — rolling history for mediator_logic's context window.
        9. State commit — write all structural updates back to the session object.

What this file does NOT do:
    - Analyze message content or emotion (analysis.py does this)
    - Make clinical or therapeutic decisions (mediator_logic.py does this)
    - Use regex to detect message patterns
    - Call the database or the LLM

Public interface:
    from ai.conversation_state_controller import adjust_decision
    decision = adjust_decision(session, sender, analysis, decision)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# SESSION STATES — THE FINITE STATE MACHINE
#
# These are the macro-level states the session can occupy.
# Each state restricts which actions are structurally valid.
# Transitions between states follow declared rules — no arbitrary jumps.
# ─────────────────────────────────────────────────────────────────────────────

class State:
    """
    Declared session states.
    Stored in session.mode — the single source of truth.
    """
    INTAKE          = "intake"           # Partners submitting intake forms
    READY           = "ready_for_session"# Both intakes done, session opening generated
    GUIDED          = "guided"           # Active — mediator is leading
    FREE_CHAT       = "free_chat"        # Both speaking directly, mediator observing
    COOLDOWN        = "cooldown"         # Temporary structural pause after heat
    SAFETY_LOCKDOWN = "safety_lockdown"  # Locked — harmful content, awaiting repair
    CRISIS_PAUSE    = "crisis_pause"     # Locked — crisis signal, countdown active
    PAUSED          = "paused"           # User-initiated pause, awaiting both ready
    WRAPPING_UP     = "wrapping_up"      # Session approaching time limit
    CLOSED          = "closed"           # Session ended


# ─────────────────────────────────────────────────────────────────────────────
# SESSION PHASES — THE THERAPEUTIC ARC
#
# Phases are time-based subdivisions of the active session.
# They run inside State.GUIDED and State.FREE_CHAT.
# Each phase has different structural permissions for what Alinda should do.
# ─────────────────────────────────────────────────────────────────────────────

class Phase:
    """
    Session phases based on elapsed time.
    """
    OPENING     = "opening"      # 0-15 min    — establish safety, hear initial perspectives
    EXPLORATION = "exploration"  # 15-45 min   — deep emotional work, primary explore phase
    DEEPENING   = "deepening"    # 45-65 min   — most sensitive material, protective
    RESOLUTION  = "resolution"   # 65-80 min   — consolidate understanding, optional framework
    CLOSING     = "closing"      # 80-90 min   — summary, commitment, close


# Phase timing thresholds in minutes
_PHASE_THRESHOLDS: list[tuple[int, str]] = [
    (15,  Phase.OPENING),
    (45,  Phase.EXPLORATION),
    (65,  Phase.DEEPENING),
    (80,  Phase.RESOLUTION),
    (999, Phase.CLOSING),      # 999 = no upper bound — session ends explicitly
]


# ─────────────────────────────────────────────────────────────────────────────
# STATE TRANSITION TABLE
#
# Declares which state transitions are structurally valid.
# A transition not in this table is rejected — the session stays in its
# current state and the action is converted to a safe fallback.
# ─────────────────────────────────────────────────────────────────────────────

# Format: source_state → set of valid destination states
_VALID_TRANSITIONS: dict[str, set[str]] = {
    State.INTAKE:           {State.READY},
    State.READY:            {State.GUIDED},
    State.GUIDED:           {
                                State.GUIDED,
                                State.FREE_CHAT,
                                State.COOLDOWN,
                                State.SAFETY_LOCKDOWN,
                                State.CRISIS_PAUSE,
                                State.PAUSED,
                                State.WRAPPING_UP,
                                State.CLOSED,
                            },
    State.FREE_CHAT:        {
                                State.GUIDED,
                                State.COOLDOWN,
                                State.SAFETY_LOCKDOWN,
                                State.CRISIS_PAUSE,
                                State.PAUSED,
                                State.WRAPPING_UP,
                                State.CLOSED,
                            },
    State.COOLDOWN:         {State.GUIDED, State.SAFETY_LOCKDOWN, State.CRISIS_PAUSE, State.PAUSED},
    State.SAFETY_LOCKDOWN:  {State.GUIDED, State.CRISIS_PAUSE, State.PAUSED, State.CLOSED},
    State.CRISIS_PAUSE:     {State.GUIDED, State.CLOSED},
    State.PAUSED:           {State.GUIDED, State.FREE_CHAT, State.CLOSED},
    State.WRAPPING_UP:      {State.GUIDED, State.FREE_CHAT, State.CLOSED},
    State.CLOSED:           set(),   # Terminal — no transitions out
}


# ─────────────────────────────────────────────────────────────────────────────
# ACTION → TARGET STATE MAPPING
#
# When the controller commits an action to the session, it needs to know
# which state that action puts the session in. This is the authoritative
# source of that mapping.
# ─────────────────────────────────────────────────────────────────────────────

_ACTION_TO_STATE: dict[str, str] = {
    # Safety actions
    "crisis_self_harm":       State.CRISIS_PAUSE,
    "safety_intervention":    State.SAFETY_LOCKDOWN,
    "repair_required":        State.SAFETY_LOCKDOWN,

    # Cooldown
    "cooldown_start":         State.COOLDOWN,

    # Recovery
    "crisis_resume":          State.GUIDED,
    "repair_acknowledgement": State.GUIDED,

    # Free chat
    "free_chat_invite":       State.FREE_CHAT,
    "observe":                State.FREE_CHAT,

    # Standard guided actions — all stay in GUIDED
    "explore":                State.GUIDED,
    "validate":               State.GUIDED,
    "reflect":                State.GUIDED,
    "reframe":                State.GUIDED,
    "deescalate":             State.GUIDED,
    "affirm_progress":        State.GUIDED,
    "resume_guidance":        State.GUIDED,
    "acknowledge_mediator":   State.GUIDED,
    "acknowledge_refusal":    State.GUIDED,
    "redirect_demand":        State.GUIDED,
    "suggest_framework":      State.GUIDED,
    "idle_redirect":          State.GUIDED,
}


# ─────────────────────────────────────────────────────────────────────────────
# STAGE MAP
# Action → the human-readable stage label shown in the frontend stage pill.
# ─────────────────────────────────────────────────────────────────────────────

STAGE_MAP: dict[str, str] = {
    "explore":                "Opening up",
    "validate":               "Hearing each other",
    "reflect":                "Reflecting",
    "reframe":                "Finding the feeling",
    "deescalate":             "Taking a breath",
    "affirm_progress":        "Moving forward",
    "repair_acknowledgement": "Coming back together",
    "resume_guidance":        "Listening",
    "free_chat_invite":       "Speaking freely",
    "observe":                "Speaking freely",
    "cooldown_start":         "Taking a moment",
    "safety_intervention":    "Paused",
    "crisis_self_harm":       "Paused",
    "repair_required":        "Paused",
    "acknowledge_mediator":   "Listening",
    "acknowledge_refusal":    "Listening",
    "redirect_demand":        "Finding the feeling",
    "crisis_resume":          "Returning",
    "suggest_framework":      "Understanding each other",
    "idle_redirect":          "Listening",
}


# ─────────────────────────────────────────────────────────────────────────────
# PHASE PERMISSIONS
#
# Declares which actions are blocked in each phase.
# An action in the BLOCKED set for the current phase will be downgraded
# to the FALLBACK_ACTION for that phase.
# ─────────────────────────────────────────────────────────────────────────────

_PHASE_BLOCKED_ACTIONS: dict[str, set[str]] = {
    Phase.OPENING: {
        "suggest_framework",    # Too early — no shared understanding yet
        "affirm_progress",      # Nothing to affirm yet
        "free_chat_invite",     # Too early — structure needed
        "crisis_resume",        # Can't resume something that hasn't started
    },
    Phase.EXPLORATION: {
        "suggest_framework",    # Too early — still in emotional work
        "crisis_resume",
    },
    Phase.DEEPENING: {
        "suggest_framework",    # Deepening is not the resolution phase
        "crisis_resume",
    },
    Phase.RESOLUTION: {
        "crisis_resume",
    },
    Phase.CLOSING: {
        "explore",              # Don't open new threads in closing
        "suggest_framework",    # Framework should be done by now or not at all
        "free_chat_invite",     # Closing needs structure
        "crisis_resume",
        "redirect_demand",
    },
}

# When a blocked action is downgraded, use this per-phase fallback
_PHASE_FALLBACK_ACTION: dict[str, str] = {
    Phase.OPENING:      "resume_guidance",
    Phase.EXPLORATION:  "resume_guidance",
    Phase.DEEPENING:    "validate",
    Phase.RESOLUTION:   "affirm_progress",
    Phase.CLOSING:      "resume_guidance",
}

# Safety actions that bypass ALL phase and state restrictions
_UNCONSTRAINED_ACTIONS: frozenset[str] = frozenset({
    "crisis_self_harm",
    "safety_intervention",
    "repair_required",
    "cooldown_start",
    "crisis_resume",
})

# Actions that indicate the FREE_CHAT state should remain active
# (Alinda is observing, not intervening)
_OBSERVE_COMPATIBLE_ACTIONS: frozenset[str] = frozenset({
    "observe",
    "safety_intervention",
    "crisis_self_harm",
    "cooldown_start",
})

# Structural limits
_MAX_CONSECUTIVE_TURNS    = 3     # Max turns for one partner before forced redirect
_MAX_ACTION_STREAK        = 3     # Max times same action fires before variety required
_MAX_TARGET_STREAK        = 3     # Max times same person is targeted before redirect
_MAX_LOW_ENGAGEMENT_TURNS = 4     # Stagnation threshold — consecutive low-engagement turns
_ACTION_LOG_WINDOW        = 8     # How many recent actions to keep in the log


# ─────────────────────────────────────────────────────────────────────────────
# PHASE COMPUTATION
# ─────────────────────────────────────────────────────────────────────────────

def _compute_session_phase(session) -> str:
    """
    Determines the current session phase from elapsed time.

    Reads session.session_started_at (set on the first message by session_manager).
    Falls back to Phase.OPENING if no start time is recorded.
    Falls back to Phase.CLOSING if the session has run past its duration limit.
    """
    started_at = getattr(session, "session_started_at", None)

    if started_at is None:
        return Phase.OPENING

    try:
        now = datetime.now(timezone.utc)

        # Ensure timezone awareness
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)

        elapsed_minutes = (now - started_at).total_seconds() / 60.0
        duration_limit  = getattr(session, "session_duration_limit", 90) or 90

        # Session is beyond its declared duration — force closing
        if elapsed_minutes >= duration_limit * 0.9:
            return Phase.CLOSING

        for threshold, phase in _PHASE_THRESHOLDS:
            if elapsed_minutes < threshold:
                return phase

        return Phase.CLOSING

    except (TypeError, AttributeError, OSError):
        return Phase.OPENING


# ─────────────────────────────────────────────────────────────────────────────
# ACTION LOG
# A rolling JSON array of recent {action, target, timestamp} dicts.
# Written to session.recent_action_log after every turn.
# Read by mediator_logic._count_recent_explore_to_sender().
# ─────────────────────────────────────────────────────────────────────────────

def _read_action_log(session) -> list[dict]:
    """Reads and deserialises the rolling action log from the session."""
    raw = getattr(session, "recent_action_log", None)
    if not raw:
        return []
    try:
        log = json.loads(raw) if isinstance(raw, str) else raw
        return log if isinstance(log, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _write_action_log(session, action: str, target: str) -> None:
    """
    Appends the current action to the rolling log and trims to window size.
    Persists to session.recent_action_log as a JSON string.
    """
    log = _read_action_log(session)

    log.append({
        "action":    action,
        "target":    target,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    # Keep only the last N entries
    trimmed = log[-_ACTION_LOG_WINDOW:]

    try:
        session.recent_action_log = json.dumps(trimmed)
    except (TypeError, ValueError):
        session.recent_action_log = "[]"


# ─────────────────────────────────────────────────────────────────────────────
# STATE VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

def _validate_state_transition(
    current_mode:  str,
    proposed_mode: str,
    action:        str,
) -> tuple[bool, str]:
    """
    Checks whether the proposed mode transition is structurally valid.

    Args:
        current_mode:  The session's current mode/state.
        proposed_mode: The mode the proposed action would put the session in.
        action:        The proposed action name (for logging).

    Returns:
        (is_valid, reason_string)
        is_valid = True  → transition is allowed, proceed
        is_valid = False → transition is blocked, caller should use fallback
    """
    # Safety actions bypass all state restrictions
    if action in _UNCONSTRAINED_ACTIONS:
        return True, "safety_bypass"

    valid_destinations = _VALID_TRANSITIONS.get(current_mode, set())

    # Same-state transitions (staying in GUIDED while in GUIDED) are always valid
    if proposed_mode == current_mode:
        return True, "same_state"

    if proposed_mode in valid_destinations:
        return True, f"{current_mode}→{proposed_mode}"

    return (
        False,
        f"Blocked: {current_mode}→{proposed_mode} for action '{action}' "
        f"is not in the valid transition table."
    )


def _action_blocked_by_state(action: str, current_mode: str) -> Optional[str]:
    """
    Returns a blocking reason string if the action is illegal in the current state,
    or None if the action is permitted.

    Some states completely lock down non-safety actions:
        CLOSED         → nothing is allowed
        SAFETY_LOCKDOWN → only repair_required or safety actions
        CRISIS_PAUSE   → only crisis_resume or safety actions
        PAUSED         → only the system handles resume (no user actions blocked;
                         but AI actions are restricted to idle messages)
    """
    if action in _UNCONSTRAINED_ACTIONS:
        return None   # Safety actions always allowed

    if current_mode == State.CLOSED:
        return f"Session is closed. Action '{action}' rejected."

    if current_mode == State.SAFETY_LOCKDOWN:
        if action not in {"repair_required", "repair_acknowledgement"}:
            return (
                f"Session is in safety lockdown. "
                f"Only repair actions are valid. '{action}' blocked."
            )

    if current_mode == State.CRISIS_PAUSE:
        if action not in {"crisis_resume", "safety_intervention"}:
            return (
                f"Session is in crisis pause. "
                f"Only crisis_resume is valid. '{action}' blocked."
            )

    return None   # Action is permitted


# ─────────────────────────────────────────────────────────────────────────────
# PHASE VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

def _validate_action_for_phase(action: str, phase: str) -> tuple[bool, str]:
    """
    Checks whether the proposed action is appropriate for the current session phase.

    Args:
        action: Proposed action.
        phase:  Current session phase.

    Returns:
        (is_valid, fallback_action_or_empty_string)
        is_valid = True  → action is fine for this phase
        is_valid = False → action is blocked; second value is the fallback to use
    """
    if action in _UNCONSTRAINED_ACTIONS:
        return True, ""

    blocked = _PHASE_BLOCKED_ACTIONS.get(phase, set())
    if action in blocked:
        fallback = _PHASE_FALLBACK_ACTION.get(phase, "resume_guidance")
        logger.debug(
            f"Phase validation blocked '{action}' in phase '{phase}'. "
            f"Fallback: '{fallback}'"
        )
        return False, fallback

    return True, ""


# ─────────────────────────────────────────────────────────────────────────────
# REPAIR CYCLE PROTECTION
#
# A repair cycle is a three-step therapeutic sequence:
#   Step 1: One partner makes a repair bid  → mediator validates (validate)
#   Step 2: Other partner reflects it       → mediator confirms (reflect)
#   Step 3: Original partner acknowledges   → mediator affirms (repair_acknowledgement)
#
# This sequence must not be interrupted. If the controller detects that a
# repair cycle is in progress, it locks the action to the next cycle step
# regardless of what mediator_logic proposed.
# ─────────────────────────────────────────────────────────────────────────────

# The sequence of actions in a repair cycle
_REPAIR_CYCLE_SEQUENCE: list[str] = ["validate", "reflect", "repair_acknowledgement"]


def _check_repair_cycle(
    session,
    proposed_action: str,
    proposed_target: str,
) -> Optional[dict]:
    """
    If a repair cycle is in progress, returns an override dict with the
    correct next cycle step. Returns None if no cycle is active.

    Repair cycle stage is stored in session.repair_cycle_stage:
        None                 → no cycle active
        'validate'           → just fired validate, waiting for reflect
        'reflect'            → just fired reflect, waiting for repair_acknowledgement
        'complete'           → cycle complete, clear the stage
    """
    stage = getattr(session, "repair_cycle_stage", None)

    if stage is None or stage == "complete":
        return None

    try:
        current_idx  = _REPAIR_CYCLE_SEQUENCE.index(stage)
        next_idx     = current_idx + 1

        if next_idx >= len(_REPAIR_CYCLE_SEQUENCE):
            # Cycle complete — clear it and let normal routing proceed
            session.repair_cycle_stage = "complete"
            return None

        next_action = _REPAIR_CYCLE_SEQUENCE[next_idx]

        # If mediator_logic already proposed the right next step, no override needed
        if proposed_action == next_action:
            return None

        # Protect the cycle — override to the correct next step
        # Target alternates: validate targets the other partner to ask what they heard,
        # reflect goes back to the original speaker, repair_acknowledgement to the other
        current_target = getattr(session, "last_target", "a")
        other          = "b" if current_target == "a" else "a"
        cycle_target   = other if next_idx % 2 == 0 else current_target

        logger.debug(
            f"Repair cycle protection: overriding '{proposed_action}' → "
            f"'{next_action}' (cycle stage: {stage} → {next_action})"
        )

        return {
            "action": next_action,
            "target": cycle_target,
            "_cycle_protected": True,
        }

    except ValueError:
        # stage value not in sequence — clear it
        session.repair_cycle_stage = None
        return None


def _advance_repair_cycle(session, action: str) -> None:
    """
    Updates the repair cycle stage after an action is committed.
    Called during state commit, not during guardrail evaluation.
    """
    if action == "validate":
        # Starting or advancing a repair cycle
        if getattr(session, "repair_cycle_stage", None) is None:
            session.repair_cycle_stage = "validate"
    elif action == "reflect":
        session.repair_cycle_stage = "reflect"
    elif action == "repair_acknowledgement":
        session.repair_cycle_stage = "complete"
    else:
        # Any other action outside the cycle — if cycle is not in progress, fine
        # If cycle was complete, clear it
        if getattr(session, "repair_cycle_stage", None) == "complete":
            session.repair_cycle_stage = None


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURAL GUARDRAILS
# ─────────────────────────────────────────────────────────────────────────────

def _check_consecutive_turns(
    session,
    sender:          str,
    proposed_action: str,
    proposed_target: str,
    clinical_confidence: str,
) -> Optional[dict]:
    """
    Guardrail: Prevents one partner from holding the floor too long.

    High-confidence decisions from mediator_logic bypass this guardrail —
    they already account for turn balance. The controller only fires when
    the clinical layer wasn't certain enough to make an intentional choice.

    Returns an override dict if the guardrail fires, else None.
    """
    if clinical_confidence == "high":
        return None

    if proposed_action in _UNCONSTRAINED_ACTIONS:
        return None

    consecutive = getattr(session, "consecutive_turns", 0) or 0
    last_speaker = getattr(session, "last_speaker", None)

    if last_speaker == sender:
        updated_consecutive = consecutive + 1
    else:
        updated_consecutive = 1

    if updated_consecutive > _MAX_CONSECUTIVE_TURNS:
        other = "b" if sender == "a" else "a"
        if proposed_target == sender:
            logger.debug(
                f"Consecutive turn guardrail: {sender} has had {updated_consecutive} "
                f"turns. Redirecting to {other}."
            )
            return {
                "action": "resume_guidance",
                "target": other,
                "_guardrail": "consecutive_turns",
            }

    return None


def _check_action_streak(
    proposed_action:     str,
    last_action:         str,
    action_streak:       int,
    clinical_confidence: str,
) -> Optional[dict]:
    """
    Guardrail: Prevents the same action from firing more than N consecutive times.

    High-confidence decisions bypass this. Some actions are exempt — safety
    actions should never be interrupted by an anti-loop guardrail.

    Returns an override dict if the guardrail fires, else None.
    """
    if clinical_confidence == "high":
        return None

    if proposed_action in _UNCONSTRAINED_ACTIONS:
        return None

    # Actions that are never interrupted by streak detection
    streak_exempt = {"repair_required", "cooldown_start", "safety_intervention"}
    if proposed_action in streak_exempt:
        return None

    if proposed_action == last_action and action_streak >= _MAX_ACTION_STREAK:
        # Force variety — different action required
        fallback = "affirm_progress" if proposed_action == "explore" else "resume_guidance"
        logger.debug(
            f"Action streak guardrail: '{proposed_action}' has fired {action_streak} "
            f"times in a row. Switching to '{fallback}'."
        )
        return {
            "action":     fallback,
            "_guardrail": "action_streak",
        }

    return None


def _check_target_lock(
    proposed_target:     str,
    last_target:         str,
    target_streak:       int,
    sender:              str,
    clinical_confidence: str,
) -> Optional[dict]:
    """
    Guardrail: Prevents the same person being addressed too many times in a row.

    Unlike the consecutive turns check (which looks at who SPOKE), this looks
    at who Alinda ADDRESSED — a separate and equally important balance.

    High-confidence decisions bypass this.
    Returns an override dict if the guardrail fires, else None.
    """
    if clinical_confidence == "high":
        return None

    if proposed_target == "both":
        return None

    if proposed_target == last_target and target_streak >= _MAX_TARGET_STREAK:
        other = "b" if proposed_target == "a" else "a"
        logger.debug(
            f"Target lock guardrail: '{proposed_target}' has been addressed "
            f"{target_streak} times. Redirecting to '{other}'."
        )
        return {
            "target":     other,
            "action":     "resume_guidance",
            "_guardrail": "target_lock",
        }

    return None


def _check_stagnation(
    session,
    analysis:            dict,
    proposed_action:     str,
    proposed_target:     str,
) -> Optional[dict]:
    """
    Guardrail: Detects and breaks structural stagnation.

    Stagnation is defined as: the same person has given consecutive
    low-engagement responses AND the session has not changed action type.

    Low engagement is determined by the analysis layer's `engagement` score
    (from the transformer), not by word count or regex.

    When stagnation is detected, the guardrail redirects to the other partner
    to create movement.

    Returns an override dict if the guardrail fires, else None.
    """
    if proposed_action in _UNCONSTRAINED_ACTIONS:
        return None

    engagement          = analysis.get("engagement", 5)
    low_engagement      = engagement <= 1
    stagnation_streak   = getattr(session, "stagnation_streak", 0) or 0

    if low_engagement:
        stagnation_streak += 1
    else:
        stagnation_streak = 0

    # Write the updated streak so state commit can persist it
    session._computed_stagnation_streak = stagnation_streak

    if stagnation_streak >= _MAX_LOW_ENGAGEMENT_TURNS:
        other = "b" if proposed_target == "a" else "a"
        logger.debug(
            f"Stagnation guardrail: {stagnation_streak} consecutive low-engagement "
            f"turns. Redirecting to '{other}'."
        )
        return {
            "action":     "resume_guidance",
            "target":     other,
            "_guardrail": "stagnation",
        }

    return None


# ─────────────────────────────────────────────────────────────────────────────
# PAUSE STATE HANDLING
# ─────────────────────────────────────────────────────────────────────────────

def _is_session_paused(session) -> bool:
    """
    Returns True if the session is in a user-initiated pause that hasn't expired.

    A pause has two components:
        session.mode == State.PAUSED
        session.paused_until — the expiry datetime

    If paused_until has passed, the pause is considered automatically expired
    and the session should resume. The actual mode update happens in state commit.
    """
    if getattr(session, "mode", None) != State.PAUSED:
        return False

    paused_until = getattr(session, "paused_until", None)
    if paused_until is None:
        # Indefinite pause — still paused
        return True

    try:
        now = datetime.now(timezone.utc)
        if paused_until.tzinfo is None:
            paused_until = paused_until.replace(tzinfo=timezone.utc)
        return now < paused_until
    except (TypeError, AttributeError):
        return True


# ─────────────────────────────────────────────────────────────────────────────
# STATE COMMIT
#
# After all guardrails have been evaluated and the final action is determined,
# commit all structural state changes to the session object.
# This is the single point of mutation in this module.
# ─────────────────────────────────────────────────────────────────────────────

def _commit_state(
    session,
    sender:       str,
    final_action: str,
    final_target: str,
    final_mode:   str,
    phase:        str,
) -> None:
    """
    Commits all structural state changes to the session object.

    This is the only place in this module where session attributes are written.
    All guardrails produce override dicts; this function applies them.

    Args:
        session:       The SQLAlchemy session object.
        sender:        "a" or "b" — who sent the current message.
        final_action:  The action that was committed after all guardrails.
        final_target:  Who Alinda addresses in her response.
        final_mode:    The new session mode.
        phase:         The current session phase.
    """

    # ── Counters ──────────────────────────────────────────────────────────────

    # Consecutive turn tracking
    last_speaker    = getattr(session, "last_speaker", None)
    consecutive     = getattr(session, "consecutive_turns", 0) or 0
    session.last_speaker      = sender
    session.consecutive_turns = (consecutive + 1) if last_speaker == sender else 1

    # Action streak
    last_action     = getattr(session, "last_action", None)
    action_streak   = getattr(session, "action_streak", 0) or 0
    session.action_streak = (action_streak + 1) if final_action == last_action else 1

    # Target streak
    last_target     = getattr(session, "last_target", None)
    target_streak   = getattr(session, "target_streak", 0) or 0
    session.target_streak = (target_streak + 1) if final_target == last_target else 1

    # Stagnation streak (computed during guardrail evaluation, stored temporarily)
    session.stagnation_streak = getattr(session, "_computed_stagnation_streak", 0) or 0

    # ── Action and target history ─────────────────────────────────────────────
    session.last_action = final_action
    session.last_target = final_target

    # ── Mode and phase ────────────────────────────────────────────────────────
    session.mode            = final_mode
    session.session_phase   = phase
    session.dialogue_stage  = STAGE_MAP.get(final_action, "Listening")

    # ── Resume guidance rotation ──────────────────────────────────────────────
    if final_action == "resume_guidance":
        idx = getattr(session, "resume_guidance_index", 0) or 0
        session.resume_guidance_index = idx + 1

    # ── Repair cycle state ────────────────────────────────────────────────────
    _advance_repair_cycle(session, final_action)

    # ── Pause state auto-expiry ───────────────────────────────────────────────
    # If the session was paused and the expiry has passed, clear the pause.
    if getattr(session, "mode", None) == State.PAUSED:
        if not _is_session_paused(session):
            session.mode         = State.GUIDED
            session.paused_until = None

    # ── Action log ────────────────────────────────────────────────────────────
    _write_action_log(session, final_action, final_target)

    # ── Session start time ────────────────────────────────────────────────────
    # Record the first message time for phase computation
    if getattr(session, "session_started_at", None) is None:
        session.session_started_at = datetime.now(timezone.utc)

    # ── Clean up temporary computation attributes ─────────────────────────────
    # These were written during guardrail evaluation for intra-function communication
    for attr in ["_computed_stagnation_streak", "_current_text_lower"]:
        if hasattr(session, attr):
            try:
                delattr(session, attr)
            except AttributeError:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PUBLIC FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def adjust_decision(
    session,
    sender:   str,
    analysis: dict,
    decision: dict,
) -> dict:
    """
    The public interface of the conversation state controller.

    Takes the clinical decision from mediator_logic.py, runs it through
    the structural enforcement pipeline, and returns the final adjusted decision.

    This function is the last stop before the decision reaches llm_client.py.

    Pipeline:
        1. Read current structural state from session
        2. Compute current session phase
        3. Check if session is in a locked or paused state
        4. Check repair cycle protection
        5. Run FSM state transition validation
        6. Run phase permission validation
        7. Run structural guardrails (in priority order):
               a. Consecutive turn limit
               b. Action streak limit
               c. Target lock prevention
               d. Stagnation detection
        8. Resolve final action and target
        9. Validate final state transition
       10. Commit state changes
       11. Return adjusted decision

    Args:
        session:  SQLAlchemy session ORM object. Both read and written.
        sender:   "a" or "b" — who sent the current message.
        analysis: Enriched analysis dict from ai/analysis.py.
                  Used for engagement score (stagnation) and confidence.
        decision: Clinical decision dict from ai/mediator_logic.py.
                  Modified in-place and returned.

    Returns:
        The final decision dict with all structural adjustments applied.
        Always returns a valid dict — never raises.
    """

    # ── 1. Read current state ─────────────────────────────────────────────────
    current_mode         = getattr(session, "mode", State.GUIDED) or State.GUIDED
    clinical_confidence  = decision.get("confidence", "low")
    proposed_action      = decision.get("action", "resume_guidance")
    proposed_target      = decision.get("target", "a")
    last_action          = getattr(session, "last_action", None)
    last_target          = getattr(session, "last_target", None)
    action_streak        = getattr(session, "action_streak", 0) or 0
    target_streak        = getattr(session, "target_streak", 0) or 0

    # ── 2. Compute session phase ──────────────────────────────────────────────
    phase = _compute_session_phase(session)

    # ── 3. Locked and paused state checks ────────────────────────────────────
    # These override everything. If the session is locked, non-safety actions
    # are blocked regardless of what mediator_logic decided.

    # Paused state — only idle message permitted, no clinical action
    if _is_session_paused(session):
        if proposed_action not in _UNCONSTRAINED_ACTIONS:
            # Session is paused — preserve the pause, don't fire clinical actions
            logger.debug(f"Session is paused. Action '{proposed_action}' suppressed.")
            decision["action"]         = "idle_redirect"
            decision["mode"]           = State.PAUSED
            decision["dialogue_stage"] = STAGE_MAP.get("idle_redirect", "Listening")
            # No state commit — the pause state should not be touched
            return decision

    # State-level block check
    block_reason = _action_blocked_by_state(proposed_action, current_mode)
    if block_reason:
        logger.debug(f"State block: {block_reason}")
        if current_mode == State.SAFETY_LOCKDOWN:
            decision["action"] = "repair_required"
        elif current_mode == State.CRISIS_PAUSE:
            decision["action"] = "idle_redirect"
        elif current_mode == State.CLOSED:
            # Return as-is — nothing should happen on a closed session
            return decision
        else:
            decision["action"] = "resume_guidance"
        proposed_action = decision["action"]

    # ── 4. Repair cycle protection ────────────────────────────────────────────
    # Check before anything else — the cycle must complete uninterrupted.
    cycle_override = _check_repair_cycle(session, proposed_action, proposed_target)
    if cycle_override:
        decision.update(cycle_override)
        proposed_action = decision["action"]
        proposed_target = decision["target"]

        # Cycle-protected decisions have high structural confidence
        # Commit and return — no further guardrails apply
        final_mode = _ACTION_TO_STATE.get(proposed_action, State.GUIDED)
        _commit_state(session, sender, proposed_action, proposed_target, final_mode, phase)
        decision["mode"]           = final_mode
        decision["dialogue_stage"] = STAGE_MAP.get(proposed_action, "Listening")
        return decision

    # ── 5. FSM state transition validation ───────────────────────────────────
    if proposed_action not in _UNCONSTRAINED_ACTIONS:
        proposed_mode = _ACTION_TO_STATE.get(proposed_action, State.GUIDED)
        is_valid, reason = _validate_state_transition(current_mode, proposed_mode, proposed_action)

        if not is_valid:
            logger.warning(f"Invalid state transition: {reason}")
            # Safe fallback — stay in current state with guidance
            decision["action"] = "resume_guidance"
            proposed_action    = "resume_guidance"

    # ── 6. Phase validation ───────────────────────────────────────────────────
    if proposed_action not in _UNCONSTRAINED_ACTIONS:
        phase_valid, phase_fallback = _validate_action_for_phase(proposed_action, phase)

        if not phase_valid:
            decision["action"] = phase_fallback
            proposed_action    = phase_fallback

    # ── 7. High confidence bypass ─────────────────────────────────────────────
    # High-confidence decisions from mediator_logic skip structural guardrails.
    # They represent an intentional clinical choice — the controller trusts it.
    # Safety actions always bypass, regardless of confidence.
    if clinical_confidence == "high" or proposed_action in _UNCONSTRAINED_ACTIONS:
        final_action = proposed_action
        final_target = proposed_target
        final_mode   = _ACTION_TO_STATE.get(final_action, State.GUIDED)

        _commit_state(session, sender, final_action, final_target, final_mode, phase)

        decision["action"]         = final_action
        decision["target"]         = final_target
        decision["mode"]           = final_mode
        decision["dialogue_stage"] = STAGE_MAP.get(final_action, "Listening")

        logger.debug(
            f"[controller] High-confidence bypass: {final_action}→{final_target} "
            f"(mode={final_mode}, phase={phase})"
        )

        return decision

    # ── 8. Structural guardrails (low/medium confidence only) ─────────────────
    # Guardrails are evaluated in priority order.
    # The first one that fires takes effect; subsequent guardrails are skipped.

    override: Optional[dict] = None

    # Guardrail A: Consecutive turns
    if override is None:
        override = _check_consecutive_turns(
            session              = session,
            sender               = sender,
            proposed_action      = proposed_action,
            proposed_target      = proposed_target,
            clinical_confidence  = clinical_confidence,
        )

    # Guardrail B: Action streak
    if override is None:
        override = _check_action_streak(
            proposed_action      = proposed_action,
            last_action          = last_action,
            action_streak        = action_streak,
            clinical_confidence  = clinical_confidence,
        )

    # Guardrail C: Target lock
    if override is None:
        override = _check_target_lock(
            proposed_target      = proposed_target,
            last_target          = last_target,
            target_streak        = target_streak,
            sender               = sender,
            clinical_confidence  = clinical_confidence,
        )

    # Guardrail D: Stagnation
    if override is None:
        override = _check_stagnation(
            session          = session,
            analysis         = analysis,
            proposed_action  = proposed_action,
            proposed_target  = proposed_target,
        )

    # Apply the first override that fired
    if override:
        if "action" in override:
            decision["action"] = override["action"]
        if "target" in override:
            decision["target"] = override["target"]
        logger.debug(
            f"[controller] Guardrail '{override.get('_guardrail','unknown')}' fired: "
            f"'{proposed_action}'→'{decision['action']}' "
            f"target: '{proposed_target}'→'{decision['target']}'"
        )
    else:
        # No guardrail fired — preserve mediator_logic's decision
        decision["action"] = proposed_action
        decision["target"] = proposed_target

    # ── 9. Validate final state transition ────────────────────────────────────
    final_action = decision["action"]
    final_target = decision["target"]
    final_mode   = _ACTION_TO_STATE.get(final_action, current_mode)

    is_valid, reason = _validate_state_transition(current_mode, final_mode, final_action)
    if not is_valid:
        logger.warning(f"Final state transition invalid after guardrails: {reason}. "
                       f"Clamping to guided/resume_guidance.")
        final_action = "resume_guidance"
        final_mode   = State.GUIDED
        decision["action"] = final_action

    # ── 10. Commit all structural state changes ───────────────────────────────
    _commit_state(session, sender, final_action, final_target, final_mode, phase)

    # ── 11. Annotate decision with structural metadata ────────────────────────
    decision["mode"]           = final_mode
    decision["dialogue_stage"] = STAGE_MAP.get(final_action, "Listening")
    decision["session_phase"]  = phase

    logger.info(
        f"[controller] {proposed_action}→{final_action} | "
        f"target: {proposed_target}→{final_target} | "
        f"mode: {current_mode}→{final_mode} | "
        f"phase={phase} | "
        f"confidence={clinical_confidence}"
    )

    return decision