"""
ai/mediator_logic.py

The clinical director of Alinda.

This module is the cognitive core of the system. It receives behavioral
telemetry from the analysis layer and produces a structured therapeutic
decision — a clinical blueprint that directs the LLM without speaking itself.

Prime directive:
    Structural insight must guide therapeutic gentleness.
    The engine knows more than it reveals.
    It uses what it knows to ask better questions, not to issue diagnoses.

Architecture position:
    analysis.py → mediator_logic.py → llm_client.py
                       ↑                    ↓
                  session state        decision dict

What this file does:
    - Maintains a probabilistic behavioral ledger per partner
    - Computes each partner's regulation state (flooding / window / withdrawing)
    - Detects resolution signals that should close the session
    - Runs a 4-level priority cascade to select therapeutic action
    - Controls turn assignment as a therapeutic intervention
    - Builds a rich clinical brief for the LLM

What this file does NOT do:
    - Make API calls
    - Touch the database
    - Generate language
    - Label users with clinical diagnoses

Public interface:
    from ai.mediator_logic import decide_mediation
    decision = decide_mediation(session, analysis, sender, speaker_name, other_name)
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# REGULATION STATES
# Based on Daniel Siegel's Window of Tolerance model.
# Every partner's regulatory state is computed from their most recent message
# and compared against their accumulated baseline.
# ─────────────────────────────────────────────────────────────────────────────

FLOODING    = "flooding"     # Hyper-arousal — overwhelmed, aggressive, unable to process
WINDOW      = "window"       # Optimal — present, reflective, available for therapy
WITHDRAWING = "withdrawing"  # Hypo-arousal — shutting down, monosyllabic, dissociated


# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIORAL LEDGER — DEFAULT STRUCTURE
#
# Each partner accumulates a behavioral profile over the session.
# This is stored as JSON in session.behavioral_ledger_a / _b.
# A single occurrence = State (temporary, reactive)
# Repeated pattern = Trait (persistent, structural)
#
# The engine uses the trait probability to modify its clinical strategy
# without ever revealing the assessment to the user.
# ─────────────────────────────────────────────────────────────────────────────

_SUSPICION_THRESHOLD    = 0.32   # Engine internally notes "suspected pattern"
_CONFIRMATION_THRESHOLD = 0.62   # Engine commits to altered therapeutic strategy

_DEFAULT_LEDGER = {
    # ── Event counters ────────────────────────────────────────────────────────
    "total_messages":           0,
    "flooding_events":          0,   # escalation >= 6 or confirmed toxic attack
    "withdrawing_events":       0,   # short message + low engagement
    "contempt_events":          0,   # contempt >= 4 (Gottman horseman — critical)
    "victim_posture_events":    0,   # blame high + vulnerability zero + partner-directed
    "repair_bids":              0,   # genuine repair attempts
    "vulnerability_moments":    0,   # vulnerability >= 4
    "explore_deflections":      0,   # short message after explore was directed at them
    "positive_exchanges":       0,   # sentiment >= 2, no escalation
    "resolution_bids":          0,   # resolution signal detected

    # ── Regulation baseline ───────────────────────────────────────────────────
    # Rolling averages — updated incrementally
    "avg_escalation":       0.0,
    "avg_vulnerability":    0.0,
    "avg_engagement":       0.0,
    "avg_repair":           0.0,
    "avg_message_length":   0.0,   # rolling word count average

    # ── Trait probability scores (0.0 – 1.0) ─────────────────────────────────
    # Computed from event counts relative to total_messages.
    # These modify the clinical strategy — they are NEVER shown to users.
    "trait_probabilities": {
        "flooding_tendency":        0.0,   # Chronic hyper-arousal
        "withdrawal_tendency":      0.0,   # Chronic hypo-arousal / stonewalling
        "contemptuous_pattern":     0.0,   # Gottman's highest-risk signal
        "victim_posture":           0.0,   # Persistent self-positioning as wronged
        "emotional_avoidance":      0.0,   # Consistent deflection of vulnerability
        "repair_capacity":          0.0,   # Positive — ability to reach toward partner
        "fragility":                0.0,   # Frequent vulnerability + low repair = needs care
    },

    # ── Confirmed traits ──────────────────────────────────────────────────────
    "confirmed_traits": {
        "flooding_tendency":        False,
        "withdrawal_tendency":      False,
        "contemptuous_pattern":     False,
        "victim_posture":           False,
        "emotional_avoidance":      False,
        "repair_capacity":          False,
        "fragility":                False,
    },

    # ── Therapeutic state ─────────────────────────────────────────────────────
    "last_explore_was_deflected": False,  # Was last explore answered substantively?
    "repair_cycle_stage":         None,   # None | "validate" | "reflect" | "complete"
    "breakthrough_registered":    False,  # Has a genuine breakthrough been acknowledged?
}


# ─────────────────────────────────────────────────────────────────────────────
# RESOLUTION SIGNALS
# When detected, the session phase should move toward closing rather than
# continuing exploratory work that risks undermining what was just achieved.
# ─────────────────────────────────────────────────────────────────────────────

_RESOLUTION_RE = re.compile(
    r"\b("
    r"i think we(?:'?re| are) okay|we(?:'?re| are) okay now|"
    r"i feel better|we understand each other|i feel heard|"
    r"this helped|thank you for this|i think we(?:'?ve| have) made progress|"
    r"i think we understand|i feel understood|things feel clearer|"
    r"that makes sense(?: now)?|i think we(?:'?re| are) good|"
    r"i feel like we(?:'?re| are) on the same page|i feel closer|"
    r"this was helpful|i think we can move forward|"
    r"we(?:'?re| are) better now|i think that helped"
    r")\b",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# ABANDONMENT LANGUAGE DETECTION
# A specific signal of anxious attachment — fear of the relationship ending.
# When detected alongside high vulnerability, the engine shifts to a deeper
# validation approach rather than a standard explore.
# ─────────────────────────────────────────────────────────────────────────────

_ABANDONMENT_RE = re.compile(
    r"\b("
    r"leav(?:e|ing)|break(?:ing)? up|break-up|"
    r"end(?:ing)? (?:this|the relationship|us|it)|"
    r"divorce|separation|leaving me|leave me|"
    r"never come back|going to lose you|losing you|"
    r"you(?:'?re| are) going to leave|you(?:'?ll| will) leave"
    r")\b",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# STAGE MAP
# Maps action → frontend dialogue_stage label (shown in the stage pill)
# ─────────────────────────────────────────────────────────────────────────────

_STAGE_FROM_ACTION: dict[str, str] = {
    "explore":                "Opening up",
    "validate":               "Hearing each other",
    "reflect":                "Reflecting",
    "reframe":                "Finding the feeling",
    "deescalate":             "Taking a breath",
    "affirm_progress":        "Moving forward",
    "repair_acknowledgement": "Coming back together",
    "resume_guidance":        "Listening",
    "free_chat_invite":       "Speaking freely",
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
    "observe":                "Speaking freely",
}


# ─────────────────────────────────────────────────────────────────────────────
# RESUME GUIDANCE TEMPLATES
# Rotated to prevent Alinda from repeating the same prompt verbatim.
# {speaker} and {other} are filled from session names.
# ─────────────────────────────────────────────────────────────────────────────

_RESUME_TEMPLATES: list[str] = [
    "What is the most important thing you want {other} to understand right now?",
    "What do you wish {other} could see from your perspective in this moment?",
    "If {other} could truly hear one thing about how you feel, what would it be?",
    "What has been hardest to say today?",
    "What would feel like real progress to you — not for the relationship, for you?",
    "What do you need from {other} that you haven't been able to ask for directly?",
    "What would help you feel safer in this conversation right now?",
    "What is still left unsaid that you feel {other} needs to know?",
]


# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIORAL LEDGER MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

def _load_ledger(session, sender: str) -> dict:
    """
    Loads the behavioral ledger for a given partner from the session object.
    Returns a fresh default ledger if no ledger has been stored yet.
    Handles both JSON strings (database storage) and raw dicts (in-memory).
    """
    key = f"behavioral_ledger_{sender}"
    raw = getattr(session, key, None)

    if raw is None:
        return dict(_DEFAULT_LEDGER)

    try:
        if isinstance(raw, str):
            ledger = json.loads(raw)
        elif isinstance(raw, dict):
            ledger = raw
        else:
            return dict(_DEFAULT_LEDGER)

        # Forward-compatibility: add any keys from the default that might be missing
        # (important when the schema changes between versions)
        for k, v in _DEFAULT_LEDGER.items():
            if k not in ledger:
                ledger[k] = v
        for trait in _DEFAULT_LEDGER["trait_probabilities"]:
            if trait not in ledger["trait_probabilities"]:
                ledger["trait_probabilities"][trait] = 0.0
        for trait in _DEFAULT_LEDGER["confirmed_traits"]:
            if trait not in ledger["confirmed_traits"]:
                ledger["confirmed_traits"][trait] = False

        return ledger

    except (json.JSONDecodeError, TypeError, KeyError):
        return dict(_DEFAULT_LEDGER)


def _update_ledger(
    ledger:       dict,
    analysis:     dict,
    text_lower:   str,
    word_count:   int,
    last_action_was_explore_at_them: bool,
) -> dict:
    """
    Updates the behavioral ledger with signals from the current message.

    This is a pure function — takes a ledger, returns an updated copy.
    The session_manager persists the result; this function has no side effects.

    Args:
        ledger:                         The current partner ledger.
        analysis:                       Analysis dict from analysis.py.
        text_lower:                     Lowercased message text.
        word_count:                     Number of words in the message.
        last_action_was_explore_at_them: Was the last AI action an explore directed at this person?
    """
    import copy
    L = copy.deepcopy(ledger)

    L["total_messages"] += 1
    n = L["total_messages"]

    escalation   = analysis.get("escalation", 0)
    vulnerability= analysis.get("vulnerability", 0)
    engagement   = analysis.get("engagement", 0)
    repair       = analysis.get("repair_attempt", 0)
    contempt     = analysis.get("contempt", 0)
    blame        = analysis.get("blame", 0)
    sentiment    = analysis.get("sentiment", 0)
    toxicity     = analysis.get("toxicity", 0)
    intent       = analysis.get("escalation_intent", "none")

    # ── Event detection ───────────────────────────────────────────────────────

    # Flooding event
    if escalation >= 6 or (toxicity >= 3 and analysis.get("is_abusive")):
        L["flooding_events"] += 1

    # Withdrawing event
    if word_count <= 4 and engagement <= 1:
        L["withdrawing_events"] += 1

    # Contempt event (Gottman's highest-risk signal)
    if contempt >= 4:
        L["contempt_events"] += 1

    # Victim posture event: blame high, vulnerability absent, attacking partner
    if blame >= 4 and vulnerability == 0 and intent == "partner_directed":
        L["victim_posture_events"] += 1

    # Repair bid
    if repair >= 4:
        L["repair_bids"] += 1

    # Vulnerability moment
    if vulnerability >= 4:
        L["vulnerability_moments"] += 1

    # Explore deflection: if last AI turn was an explore directed at this person
    # and they responded with a short, low-engagement message
    if last_action_was_explore_at_them and word_count <= 6 and engagement <= 2:
        L["explore_deflections"] += 1
        L["last_explore_was_deflected"] = True
    else:
        L["last_explore_was_deflected"] = False

    # Positive exchange
    if sentiment >= 2 and escalation <= 1:
        L["positive_exchanges"] += 1

    # Abandonment fear (marker of anxious attachment)
    if _ABANDONMENT_RE.search(text_lower) and vulnerability >= 2:
        L["vulnerability_moments"] += 1   # Weight this more heavily

    # ── Rolling averages (exponential moving average, alpha=0.3) ─────────────
    alpha = 0.30
    L["avg_escalation"]     = round((1 - alpha) * L["avg_escalation"]     + alpha * escalation,    3)
    L["avg_vulnerability"]  = round((1 - alpha) * L["avg_vulnerability"]  + alpha * vulnerability, 3)
    L["avg_engagement"]     = round((1 - alpha) * L["avg_engagement"]     + alpha * engagement,    3)
    L["avg_repair"]         = round((1 - alpha) * L["avg_repair"]         + alpha * repair,        3)
    L["avg_message_length"] = round((1 - alpha) * L["avg_message_length"] + alpha * word_count,    3)

    # ── Trait probability computation ─────────────────────────────────────────
    # Probabilities are event counts relative to total messages.
    # A trait is confirmed when its probability exceeds the confirmation threshold.

    if n > 0:
        P = L["trait_probabilities"]
        C = L["confirmed_traits"]

        P["flooding_tendency"]   = round(L["flooding_events"]       / n, 3)
        P["withdrawal_tendency"] = round(L["withdrawing_events"]     / n, 3)
        P["contemptuous_pattern"]= round(min(1.0,
                                    L["contempt_events"] / max(1, n * 0.3)), 3)
        # Contempt is so severe that even 2 events in 10 messages = suspicion
        if L["contempt_events"] >= 1:
            P["contemptuous_pattern"] = max(P["contemptuous_pattern"], _SUSPICION_THRESHOLD + 0.05)
        if L["contempt_events"] >= 3:
            P["contemptuous_pattern"] = max(P["contemptuous_pattern"], _CONFIRMATION_THRESHOLD + 0.05)

        P["victim_posture"]      = round(L["victim_posture_events"]  / max(1, n), 3)
        P["emotional_avoidance"] = round(L["explore_deflections"]   / max(1, n), 3)
        P["repair_capacity"]     = round(L["repair_bids"]           / max(1, n), 3)
        P["fragility"]           = round(
            (L["vulnerability_moments"] / max(1, n)) *
            (1 - P["repair_capacity"]),
            3
        )

        # Confirm traits that cross the threshold
        for trait, prob in P.items():
            C[trait] = prob >= _CONFIRMATION_THRESHOLD

    return L


def _detect_active_traits(ledger: dict) -> list[str]:
    """Returns a list of suspected or confirmed trait names for this partner."""
    traits = []
    P = ledger.get("trait_probabilities", {})
    C = ledger.get("confirmed_traits", {})

    for trait in P:
        if C.get(trait):
            traits.append(f"confirmed:{trait}")
        elif P.get(trait, 0.0) >= _SUSPICION_THRESHOLD:
            traits.append(f"suspected:{trait}")

    return traits


# ─────────────────────────────────────────────────────────────────────────────
# SESSION METRICS
# ─────────────────────────────────────────────────────────────────────────────

def _compute_regulation_state(analysis: dict, word_count: int) -> str:
    """
    Maps a single message's analysis to the Window of Tolerance model.

    FLOODING:    Hyper-aroused — the person is overwhelmed, cannot process.
                 Therapeutic response: slow down, do not explore.
    WINDOW:      Optimal regulation — present, available, able to reflect.
                 Therapeutic response: standard interventions.
    WITHDRAWING: Hypo-aroused — shutting down, monosyllabic.
                 Therapeutic response: low-stakes bridge, do not push.
    """
    escalation = analysis.get("escalation", 0)
    toxicity   = analysis.get("toxicity", 0)
    engagement = analysis.get("engagement", 0)
    is_abusive = analysis.get("is_abusive", False)

    if escalation >= 6 or (toxicity >= 3 and is_abusive) or analysis.get("contempt", 0) >= 5:
        return FLOODING

    if word_count <= 4 and engagement <= 1:
        return WITHDRAWING

    return WINDOW


def _compute_session_temperature(
    current_analysis: dict,
    ledger_a:         dict,
    ledger_b:         dict,
) -> float:
    """
    A real-time thermal metric measuring the overall session climate.

    Positive = session heating up (escalation dominating across both partners)
    Negative = session cooling (repair and vulnerability dominating)
    Near zero = balanced

    Uses rolling averages from both ledgers weighted toward the current message.
    """
    avg_esc   = (ledger_a.get("avg_escalation", 0) + ledger_b.get("avg_escalation", 0)) / 2
    avg_rep   = (ledger_a.get("avg_repair", 0)     + ledger_b.get("avg_repair", 0))     / 2
    avg_vuln  = (ledger_a.get("avg_vulnerability", 0) + ledger_b.get("avg_vulnerability", 0)) / 2

    # Current message nudge
    current_esc  = current_analysis.get("escalation", 0) * 0.3
    current_cool = (current_analysis.get("repair_attempt", 0) + current_analysis.get("vulnerability", 0)) * 0.15

    temperature = (avg_esc + current_esc) - ((avg_rep + avg_vuln) * 0.6 + current_cool)
    return round(float(temperature), 2)


def _detect_resolution(text_lower: str, analysis: dict) -> bool:
    """
    Returns True if this message contains a signal that the couple has
    reached a point of mutual understanding and the session should begin closing.
    """
    if not _RESOLUTION_RE.search(text_lower):
        return False

    # Confirm with sentiment — resolution language said in anger is not resolution
    sentiment   = analysis.get("sentiment", 0)
    escalation  = analysis.get("escalation", 0)

    return sentiment >= 0 and escalation <= 2


def _count_recent_explore_to_sender(session, sender: str, window: int = 4) -> int:
    """
    Returns how many of the last `window` AI actions were 'explore'
    directed at this sender. Used to prevent explore overuse.

    Requires session to have a recent_actions list or we default to 0.
    """
    recent = getattr(session, "recent_action_log", None)
    if not recent:
        return 0
    try:
        log = json.loads(recent) if isinstance(recent, str) else recent
        relevant = [
            entry for entry in log[-window:]
            if entry.get("action") == "explore"
            and entry.get("target") == sender
        ]
        return len(relevant)
    except (TypeError, KeyError, json.JSONDecodeError):
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# TURN CONTROL
# Turn assignment is a therapeutic intervention, not a mechanical toggle.
# ─────────────────────────────────────────────────────────────────────────────

def _determine_next_speaker(
    action:            str,
    target:            str,
    sender:            str,
    other:             str,
    analysis:          dict,
    session,
    ledger_sender:     dict,
    ledger_other:      dict,
    regulation_sender: str,
) -> str:
    """
    Determines who should have the floor after Alinda's response.

    This is distinct from `target` (who Alinda addresses in her message).
    The next speaker is set based on therapeutic reasoning:

    Rules (in priority order):
        1. Safety actions lock the speaker in place — they must respond.
        2. Validate actions: Alinda turns to partner, partner responds, then back.
        3. Repair acknowledgement: other partner must respond.
        4. After vulnerability is protected, let the speaker continue OR invite other.
        5. Explore overuse: if 2+ consecutive explores to same person, redirect.
        6. Withdrawal pattern: create opening for withdrawing partner.
        7. Observe (free chat): floor is open to both (return None → free turn).
        8. Default: follow the target.
    """
    safety_actions = {
        "safety_intervention", "crisis_self_harm", "repair_required",
        "cooldown_start", "crisis_resume", "idle_redirect"
    }

    # Safety — response required from the person being addressed
    if action in safety_actions:
        return target

    # Observe — floor is open, both can speak (session_manager handles as current_turn = None)
    if action == "observe":
        return "both"

    # Repair acknowledgement — other partner MUST respond
    if action == "repair_acknowledgement":
        return other

    # Validate — turn to other partner who now validates back
    if action == "validate":
        return other

    # Reflect — back to the original speaker to confirm
    if action == "reflect":
        return sender

    # Free chat invite — open floor
    if action == "free_chat_invite":
        return "both"

    # Explore overuse prevention
    # Count consecutive explores directed at sender
    consecutive_turns = getattr(session, "consecutive_turns", 0) or 0
    last_speaker = getattr(session, "last_speaker", None)

    if action == "explore" and last_speaker == sender and consecutive_turns >= 2:
        # Been asked too many consecutive times — redirect to other
        return other

    # Withdrawal pattern — if the other partner is in withdrawal tendency,
    # create explicit opening for them
    if (
        ledger_other.get("trait_probabilities", {}).get("withdrawal_tendency", 0)
        >= _SUSPICION_THRESHOLD
        and action in {"resume_guidance", "explore", "validate"}
    ):
        # Other partner needs a bridge — redirect to them
        return other

    # Flooding sender — after deescalate, keep turn with sender to follow through
    if action == "deescalate" and regulation_sender == FLOODING:
        return sender

    # Affirm progress — after affirmation, let the OTHER person respond
    if action == "affirm_progress":
        return other

    # Default: follow the addressed target
    return target


# ─────────────────────────────────────────────────────────────────────────────
# CLINICAL BRIEF BUILDER
# Constructs the system_message field — the clinical director's instructions
# to the LLM. This is the most therapeutically important string in the system.
#
# It contains:
#   - The psychological context for this specific moment
#   - What the LLM must avoid (tactical constraints)
#   - Any relevant pattern intelligence from the accumulator
#
# It is NEVER shown to users. It shapes how the LLM delivers the action,
# not what the action is.
# ─────────────────────────────────────────────────────────────────────────────

def _build_clinical_brief(
    action:            str,
    speaker_name:      str,
    other_name:        str,
    sender:            str,
    analysis:          dict,
    ledger_sender:     dict,
    ledger_other:      dict,
    regulation_sender: str,
    regulation_other:  str,
    session_temp:      float,
    traits_sender:     list[str],
    traits_other:      list[str],
    session,
) -> str:
    """
    Builds a rich clinical brief for the LLM.

    This brief tells Alinda not just what to do (the action guidance in prompts.py
    handles that), but the psychological texture of this specific moment —
    what's really happening, what to protect, and what to avoid.

    The brief is written as internal clinical notes, not as instructions.
    Alinda reads these notes the way a therapist reads case notes before
    speaking — she is informed by them but does not recite them.
    """

    lines: list[str] = []

    # ── Regulation context ────────────────────────────────────────────────────
    if regulation_sender == FLOODING:
        lines.append(
            f"{speaker_name} is in a flooded state right now — emotionally overwhelmed "
            f"and unable to process nuance. Keep the intervention brief and grounding. "
            f"Do not ask them to explain or justify."
        )
    elif regulation_sender == WITHDRAWING:
        lines.append(
            f"{speaker_name} appears to be withdrawing. The message was brief and low "
            f"in engagement. Create a very low-stakes, specific opening — avoid "
            f"open-ended questions that feel threatening when someone is shut down."
        )

    if regulation_other == FLOODING:
        lines.append(
            f"{other_name} is also in a flooded state. Do not redirect the floor to them "
            f"until the temperature drops."
        )
    elif regulation_other == WITHDRAWING:
        lines.append(
            f"{other_name} appears to be withdrawing from the conversation. "
            f"If you redirect to them, use a single, very specific, low-stakes question."
        )

    # ── Session temperature context ───────────────────────────────────────────
    if session_temp >= 5.0:
        lines.append(
            "The overall session temperature is high — both partners have been escalated "
            "for several turns. The priority is to lower the temperature before any "
            "exploratory work can be productive."
        )
    elif session_temp <= -3.0:
        lines.append(
            "The session is cooling significantly — this is a moment of softening. "
            "Protect this. Do not introduce new topics or return to earlier conflict points."
        )

    # ── Vulnerability context ─────────────────────────────────────────────────
    vulnerability = analysis.get("vulnerability", 0)
    if vulnerability >= 5:
        lines.append(
            f"{speaker_name} just shared something deeply vulnerable. "
            f"This is a therapeutic breakthrough bid. Protect it. "
            f"Do not rush past it to the other partner. Hold this moment fully."
        )
    elif vulnerability >= 3:
        lines.append(
            f"{speaker_name} is showing emotional openness. This is a good sign. "
            f"Acknowledge it before redirecting."
        )

    # ── Repair context ────────────────────────────────────────────────────────
    repair = analysis.get("repair_attempt", 0)
    if repair >= 4:
        lines.append(
            f"{speaker_name} just made a genuine repair bid — an apology or a softening. "
            f"This matters. Give it space. Do not undermine it by immediately "
            f"asking a follow-up question."
        )

    # ── Contempt context ──────────────────────────────────────────────────────
    contempt = analysis.get("contempt", 0)
    if contempt >= 4:
        lines.append(
            f"Contempt is present in {speaker_name}'s message. Contempt is qualitatively "
            f"different from anger — it signals long-accumulated feelings of superiority "
            f"or disgust toward {other_name}. Do not treat this as simple frustration. "
            f"Respond to the pain underneath it, not the contempt itself. "
            f"Do not repeat the contemptuous language."
        )

    # ── Accumulator-informed constraints (trait intelligence) ─────────────────
    # These are the most important constraints — based on observed patterns.
    # They modify strategy without making accusations.

    # Flooding tendency confirmed
    if any("flooding_tendency" in t and "confirmed" in t for t in traits_sender):
        lines.append(
            f"Pattern note: {speaker_name} has shown a consistent tendency toward "
            f"emotional flooding across this session. Therapeutic approach: "
            f"shorter, more structured interventions. Avoid open-ended exploration "
            f"when their escalation is elevated. Ground first, explore later."
        )

    # Withdrawal tendency confirmed
    if any("withdrawal_tendency" in t and "confirmed" in t for t in traits_sender):
        lines.append(
            f"Pattern note: {speaker_name} has repeatedly withdrawn from direct engagement. "
            f"This is protective, not dismissive — they may feel unsafe. "
            f"Use highly specific, concrete questions. Avoid anything that "
            f"requires sustained self-reflection."
        )

    # Victim posture suspected or confirmed
    if any("victim_posture" in t for t in traits_sender):
        level = "confirmed" if any("victim_posture" in t and "confirmed" in t for t in traits_sender) else "suspected"
        if level == "confirmed":
            lines.append(
                f"Pattern note ({level}): {speaker_name} has consistently positioned "
                f"themselves as wronged without showing self-reflection. "
                f"This is a protective pattern — underneath it is likely significant pain. "
                f"Do not challenge the pattern directly. Instead, ask them about "
                f"their experience from the inside: what they feel, not what {other_name} did."
                f"The goal is to help them locate themselves in the story, not just {other_name}."
            )
        else:
            lines.append(
                f"Observation: {speaker_name} has shown some tendency to focus entirely "
                f"on what {other_name} did wrong, without visible self-reflection. "
                f"Gently invite them toward their own experience rather than {other_name}'s actions."
            )

    # Contemptuous pattern confirmed
    if any("contemptuous_pattern" in t and "confirmed" in t for t in traits_sender):
        lines.append(
            f"Critical pattern note: {speaker_name} has shown a consistent pattern of "
            f"contempt across this session. This is the highest-risk signal in "
            f"couples dynamics. The clinical priority is to reach the pain underneath "
            f"the contempt — what long-standing hurt has made them feel this way? "
            f"Approach with extreme care. Do not challenge the contempt directly. "
            f"Ask about the disconnection they feel."
        )

    # Fragility confirmed
    if any("fragility" in t and "confirmed" in t for t in traits_sender):
        lines.append(
            f"Pattern note: {speaker_name} has shown repeated vulnerability without "
            f"many repair attempts, suggesting emotional fragility. "
            f"Be especially gentle. This person may be more at risk of shutting down "
            f"if they feel their vulnerability is not met carefully."
        )

    # Repair capacity (positive pattern)
    if any("repair_capacity" in t and "confirmed" in t for t in traits_sender):
        lines.append(
            f"Positive note: {speaker_name} has shown a real capacity for repair "
            f"across this session. This is a strength. When appropriate, name it."
        )

    # Explore deflection pattern
    if ledger_sender.get("last_explore_was_deflected"):
        lines.append(
            f"{speaker_name} deflected the last exploratory question with a brief, "
            f"low-engagement response. They may not be ready to go deeper on this topic. "
            f"Do not ask the same question in different words. "
            f"Either try a different angle or redirect to {other_name}."
        )

    # ── Abandonment fear ──────────────────────────────────────────────────────
    vulnerability = analysis.get("vulnerability", 0)
    escalation_intent = analysis.get("escalation_intent", "none")
    if _ABANDONMENT_RE.search(getattr(session, "_current_text_lower", "")) and vulnerability >= 2:
        lines.append(
            f"{speaker_name} has expressed fear related to the relationship ending. "
            f"This is likely underneath much of what they have said today. "
            f"Do not problem-solve. Stay with the fear."
        )

    # ── Default brief if nothing specific triggered ───────────────────────────
    if not lines:
        lines.append(
            f"The conversation is in a balanced state. "
            f"Trust the therapeutic direction and respond with genuine curiosity."
        )

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# PRIORITY LEVEL FUNCTIONS
# Each level returns a partial decision dict or None if it did not fire.
# The main function runs them in order and takes the first non-None result.
# ─────────────────────────────────────────────────────────────────────────────

def _level_1_safety(analysis: dict, sender: str) -> Optional[dict]:
    """
    Level 1: Safety and Crisis Control.

    Checks for self-harm ideation, threats of harm to others, and confirmed
    abusive patterns. If triggered, ALL standard relationship logic is locked out.

    This level is non-negotiable. It cannot be overridden by any other logic.
    """
    crisis = analysis.get("crisis", "none")

    if crisis == "self_harm":
        return {
            "action":  "crisis_self_harm",
            "target":  sender,
            "mode":    "crisis_pause",
            "_level":  1,
        }

    if crisis == "harm_to_other":
        return {
            "action": "safety_intervention",
            "target": sender,
            "mode":   "safety_lockdown",
            "_level": 1,
        }

    return None


def _level_2_toxicity(
    analysis:      dict,
    sender:        str,
    other:         str,
    session,
    ledger_sender: dict,
) -> Optional[dict]:
    """
    Level 2: Toxicity and Repair Barrier.

    Checks for active contempt, character attacks, or confirmed abusive patterns.
    If the session is already in safety lockdown and the new message does not
    constitute a genuine repair, keeps the lockdown active.

    No exploratory work is permitted when this level fires.
    """
    contempt        = analysis.get("contempt", 0)
    toxicity        = analysis.get("toxicity", 0)
    is_abusive      = analysis.get("is_abusive", False)
    escalation_int  = analysis.get("escalation_intent", "none")
    repair          = analysis.get("repair_attempt", 0)
    mode            = getattr(session, "mode", "guided")

    # Existing safety lockdown — check if repair was offered
    if mode == "safety_lockdown":
        if repair >= 3:
            # Repair offered — acknowledge it, cautiously resume
            return {
                "action": "repair_acknowledgement",
                "target": other,
                "mode":   "guided",
                "_level": 2,
            }
        else:
            # Lockdown continues — message didn't repair
            return {
                "action": "repair_required",
                "target": sender,
                "mode":   "safety_lockdown",
                "_level": 2,
            }

    # Character attack — contempt or confirmed abusive pattern
    if escalation_int == "character_attack" or (contempt >= 4 and is_abusive):
        return {
            "action": "safety_intervention",
            "target": sender,
            "mode":   "safety_lockdown",
            "_level": 2,
        }

    # High toxicity + partner-directed — not character attack level but still harmful
    if toxicity >= 3 and is_abusive and escalation_int == "partner_directed":
        return {
            "action": "deescalate",
            "target": sender,
            "mode":   "guided",
            "_level": 2,
        }

    # Contemptuous pattern confirmed — sustained contempt requires containment
    if (
        contempt >= 3
        and ledger_sender.get("confirmed_traits", {}).get("contemptuous_pattern")
    ):
        return {
            "action": "deescalate",
            "target": sender,
            "mode":   "guided",
            "_level": 2,
        }

    return None


def _level_3_vulnerability(
    analysis:          dict,
    sender:            str,
    other:             str,
    text_lower:        str,
    regulation_sender: str,
    ledger_sender:     dict,
    session,
) -> Optional[dict]:
    """
    Level 3: Vulnerability and Anchor Reaction.

    If the conversation is safe and a genuine moment of vulnerability or
    breakthrough has surfaced, the engine drops all other tracking to
    anchor and protect this moment.

    This level fires on vulnerability, repair bids, and resolution signals.
    """
    vulnerability   = analysis.get("vulnerability", 0)
    repair          = analysis.get("repair_attempt", 0)
    escalation      = analysis.get("escalation", 0)
    top_emotions    = analysis.get("top_emotions", {})
    last_action     = getattr(session, "last_action", None)

    # Resolution signal — begin closing the session
    if _detect_resolution(text_lower, analysis):
        return {
            "action": "affirm_progress",
            "target": sender,
            "mode":   "guided",
            "_level": 3,
        }

    # Deep vulnerability (>= 5) — profound emotional disclosure
    if vulnerability >= 5 and escalation <= 2:
        if regulation_sender != FLOODING:
            # If other partner has had the floor recently, validate now
            last_target = getattr(session, "last_target", None)
            if last_target == other:
                return {
                    "action": "validate",
                    "target": other,
                    "mode":   "guided",
                    "_level": 3,
                }
            # Otherwise stay with the speaker — they haven't finished
            return {
                "action": "explore",
                "target": sender,
                "mode":   "guided",
                "_level": 3,
            }

    # Significant vulnerability with repair — someone is opening and reaching
    if vulnerability >= 3 and repair >= 3 and escalation <= 2:
        return {
            "action": "repair_acknowledgement",
            "target": other,
            "mode":   "guided",
            "_level": 3,
        }

    # Genuine repair bid without accompanying vulnerability
    if repair >= 4 and escalation <= 2:
        if last_action not in {"repair_acknowledgement", "validate"}:
            return {
                "action": "repair_acknowledgement",
                "target": other,
                "mode":   "guided",
                "_level": 3,
            }

    # Abandonment fear expressed — stay with this
    if (
        _ABANDONMENT_RE.search(text_lower)
        and vulnerability >= 2
        and escalation <= 3
    ):
        return {
            "action": "explore",
            "target": sender,
            "mode":   "guided",
            "_level": 3,
        }

    # Grief or sadness dominant — sit with this before redirecting
    if (
        any(e in top_emotions for e in ["grief", "sadness"])
        and vulnerability >= 3
        and escalation <= 2
    ):
        return {
            "action": "validate",
            "target": other,
            "mode":   "guided",
            "_level": 3,
        }

    return None


def _level_4_dialectical(
    analysis:          dict,
    sender:            str,
    other:             str,
    text_lower:        str,
    regulation_sender: str,
    regulation_other:  str,
    ledger_sender:     dict,
    ledger_other:      dict,
    session_temp:      float,
    session,
    speaker_name:      str,
    other_name:        str,
    word_count:        int,
    message_count:     int,
) -> dict:
    """
    Level 4: Dialectical Stabilization — the standard therapeutic work.

    Only reached when the conversation is safe, no acute crisis, no active
    toxicity, no unanchored vulnerability. This is where most of the session
    lives — the exploratory, connective, generative work.

    This function always returns a decision — it is the final fallback.
    """
    escalation      = analysis.get("escalation", 0)
    blame           = analysis.get("blame", 0)
    vulnerability   = analysis.get("vulnerability", 0)
    engagement      = analysis.get("engagement", 0)
    repair          = analysis.get("repair_attempt", 0)
    sentiment       = analysis.get("sentiment", 0)
    confidence      = analysis.get("confidence", "medium")
    escalation_int  = analysis.get("escalation_intent", "none")
    last_action     = getattr(session, "last_action", None)
    last_target     = getattr(session, "last_target", None)
    consecutive     = getattr(session, "consecutive_turns", 0) or 0
    free_chat_eligible = message_count >= 8 and not getattr(session, "escalation_unresolved", False)

    # ── Mediator address ──────────────────────────────────────────────────────
    mediator_phrases = [
        "alinda", "what are you", "who are you", "stop repeating",
        "you're not helping", "you're not listening", "what do you mean",
    ]
    if any(phrase in text_lower for phrase in mediator_phrases):
        return {
            "action": "acknowledge_mediator",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Refusal to engage ─────────────────────────────────────────────────────
    refusal_phrases = [
        "i don't want to talk", "i can't do this", "i'm done", "forget it",
        "this is pointless", "i give up", "i'm leaving",
    ]
    if any(phrase in text_lower for phrase in refusal_phrases):
        return {
            "action": "acknowledge_refusal",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Demand detection ─────────────────────────────────────────────────────
    demand_phrases = [
        "you need to", "you have to", "you must", "you should",
        "i demand", "i need you to", "you are supposed to",
    ]
    if any(phrase in text_lower for phrase in demand_phrases) and blame >= 2:
        return {
            "action": "redirect_demand",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Deescalation needed (elevated but not toxic) ──────────────────────────
    if escalation >= 4 and escalation_int in {"partner_directed", "situation_directed"}:
        return {
            "action": "deescalate",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Blame reframe ────────────────────────────────────────────────────────
    if blame >= 4 and escalation_int == "partner_directed":
        return {
            "action": "reframe",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Withdrawal pattern — create bridge ───────────────────────────────────
    if regulation_sender == WITHDRAWING:
        return {
            "action": "acknowledge_refusal",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Explore — core exploratory work ──────────────────────────────────────
    # Explore fires when there's substantive content but no crisis, toxicity,
    # or vulnerability requiring higher-level handling.
    # Hard limit: max 1 consecutive explore to the same person.
    explore_count = _count_recent_explore_to_sender(session, sender, window=4)
    can_explore   = explore_count < 1 or consecutive < 2

    if can_explore and confidence != "low" and word_count >= 4:
        if escalation <= 3 and vulnerability <= 2 and sentiment <= 1:
            return {
                "action": "explore",
                "target": sender,
                "mode":   "guided",
                "_level": 4,
            }

    # ── Low confidence — open question ───────────────────────────────────────
    # Classifier is unsure — Alinda sits with the ambiguity rather than
    # routing to a specific action that might be wrong.
    if confidence == "low" and word_count <= 5:
        return {
            "action": "explore",
            "target": sender,
            "mode":   "guided",
            "_level": 4,
        }

    # ── Free chat eligibility ─────────────────────────────────────────────────
    if (
        free_chat_eligible
        and escalation <= 1
        and sentiment >= 1
        and session_temp <= 1.0
        and last_action != "free_chat_invite"
    ):
        return {
            "action": "free_chat_invite",
            "target": "both",
            "mode":   "free_chat",
            "_level": 4,
        }

    # ── Default: resume guidance ─────────────────────────────────────────────
    # Rotate through templates to prevent repetition.
    resume_index  = getattr(session, "resume_guidance_index", 0) or 0
    template      = _RESUME_TEMPLATES[resume_index % len(_RESUME_TEMPLATES)]

    return {
        "action":         "resume_guidance",
        "target":         other,    # Resume guidance is typically directed at the other partner
        "mode":           "guided",
        "_level":         4,
        "_resume_template": template.format(speaker=speaker_name, other=other_name),
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN FUNCTION — DECIDE MEDIATION
# ─────────────────────────────────────────────────────────────────────────────

def decide_mediation(
    session,
    analysis:     dict,
    sender:       str,
    speaker_name: str,
    other_name:   str,
) -> dict:
    """
    The central decision function of the Alinda system.

    Takes the current session state and message analysis, runs the 4-level
    priority cascade, and returns a complete clinical decision dict.

    This function is designed to be called once per user message by
    session_manager.py. It is synchronous, has no side effects, and
    does not touch the database — all persistence is handled by the caller
    via the `_behavioral_update` field in the return dict.

    Args:
        session:      SQLAlchemy Session ORM object. Read-only here.
        analysis:     Enriched analysis dict from ai/analysis.py.
        sender:       "a" or "b" — who sent the current message.
        speaker_name: Display name of the sender.
        other_name:   Display name of the other partner.

    Returns:
        Complete decision dict with keys:
            action              str    The therapeutic action to execute
            target              str    "a", "b", or "both" — who Alinda addresses
            next_speaker        str    Who gets the floor after Alinda's message
            mode                str    Session mode to persist (guided, cooldown, etc.)
            system_message      str    Clinical brief for the LLM
            speaker             str    "a" or "b" — who sent this message
            quote               str    The message content for the prompt
            feeling             str    Primary detected feeling for the prompt
            exercise            str|None  Cooldown exercise if applicable
            dialogue_stage      str    Frontend stage pill label
            _level              int    Which priority level fired (for logging)
            _behavioral_update  dict   {sender_key: ledger_dict, other_key: ledger_dict}
            _traits_sender      list   Detected trait strings for sender
            _traits_other       list   Detected trait strings for other
            _regulation_sender  str    Regulation state of sender
            _regulation_other   str    Regulation state of other partner
            _session_temp       float  Session temperature at this moment
    """

    other = "b" if sender == "a" else "a"

    # ── Read session state ────────────────────────────────────────────────────
    message_count   = getattr(session, "message_count", 0)     or 0
    current_text    = getattr(session, "last_user_message", "") or ""

    # Store text_lower on a pseudo-attribute so _build_clinical_brief can access it
    # without passing it through every function signature.
    # This is a minor convenience that keeps signatures clean.
    session._current_text_lower = current_text.lower()

    text_lower   = session._current_text_lower
    word_count   = len(current_text.split())

    # ── Load behavioral ledgers ───────────────────────────────────────────────
    ledger_sender = _load_ledger(session, sender)
    ledger_other  = _load_ledger(session, other)

    # Was the last AI action an explore directed at the sender?
    last_action  = getattr(session, "last_action", None)
    last_target  = getattr(session, "last_target", None)
    explore_was_directed_at_sender = (
        last_action == "explore" and last_target == sender
    )

    # ── Update sender ledger ──────────────────────────────────────────────────
    updated_ledger_sender = _update_ledger(
        ledger       = ledger_sender,
        analysis     = analysis,
        text_lower   = text_lower,
        word_count   = word_count,
        last_action_was_explore_at_them = explore_was_directed_at_sender,
    )

    # ── Detect active traits ──────────────────────────────────────────────────
    traits_sender = _detect_active_traits(updated_ledger_sender)
    traits_other  = _detect_active_traits(ledger_other)

    # ── Compute regulation states ─────────────────────────────────────────────
    regulation_sender = _compute_regulation_state(analysis, word_count)

    # We approximate the other partner's current regulation from their ledger.
    # The actual other-partner regulation is computed properly when they send.
    other_avg_esc  = ledger_other.get("avg_escalation", 0.0)
    other_avg_eng  = ledger_other.get("avg_engagement", 0.0)
    other_avg_len  = ledger_other.get("avg_message_length", 10.0)

    if other_avg_esc >= 5.0:
        regulation_other = FLOODING
    elif other_avg_len <= 4.0 and other_avg_eng <= 1.5:
        regulation_other = WITHDRAWING
    else:
        regulation_other = WINDOW

    # ── Session temperature ───────────────────────────────────────────────────
    session_temp = _compute_session_temperature(analysis, updated_ledger_sender, ledger_other)

    # ── Quote and feeling for prompt ──────────────────────────────────────────
    quote   = current_text
    top_em  = analysis.get("top_emotions", {})
    feeling: Optional[str] = None
    if top_em:
        top_emotion = next(iter(top_em))   # highest-confidence emotion
        if top_emotion not in {"neutral", "approval"}:
            feeling = top_emotion

    # ── Turn balance check — force redirect if dominant imbalance ─────────────
    consecutive    = getattr(session, "consecutive_turns", 0) or 0
    last_speaker   = getattr(session, "last_speaker", None)

    if last_speaker == sender:
        consecutive += 1
    else:
        consecutive = 1

    # ── 4-Level Priority Cascade ──────────────────────────────────────────────

    partial = None

    # Level 1 — Safety & Crisis (non-negotiable)
    partial = _level_1_safety(analysis, sender)

    # Level 2 — Toxicity & Repair Barrier
    if partial is None:
        partial = _level_2_toxicity(analysis, sender, other, session, updated_ledger_sender)

    # Level 3 — Vulnerability Anchor
    if partial is None:
        partial = _level_3_vulnerability(
            analysis          = analysis,
            sender            = sender,
            other             = other,
            text_lower        = text_lower,
            regulation_sender = regulation_sender,
            ledger_sender     = updated_ledger_sender,
            session           = session,
        )

    # Level 4 — Dialectical Stabilization
    if partial is None:
        partial = _level_4_dialectical(
            analysis          = analysis,
            sender            = sender,
            other             = other,
            text_lower        = text_lower,
            regulation_sender = regulation_sender,
            regulation_other  = regulation_other,
            ledger_sender     = updated_ledger_sender,
            ledger_other      = ledger_other,
            session_temp      = session_temp,
            session           = session,
            speaker_name      = speaker_name,
            other_name        = other_name,
            word_count        = word_count,
            message_count     = message_count,
        )

    action = partial["action"]
    target = partial.get("target", other)
    mode   = partial.get("mode", "guided")

    # ── Consecutive turn override — hard limit ────────────────────────────────
    # Even if the cascade selected an action targeting the sender again,
    # if consecutive turns have hit the limit, force a redirect.
    # Does not apply to safety actions — those must stay with the sender.
    safety_actions = {
        "safety_intervention", "crisis_self_harm", "repair_required",
        "cooldown_start", "crisis_resume"
    }
    if consecutive >= 3 and target == sender and action not in safety_actions:
        target = other
        action = "resume_guidance"
        logger.debug(
            f"Consecutive turn override: {speaker_name} has had {consecutive} "
            f"consecutive turns. Redirecting to {other_name}."
        )

    # ── Determine next speaker ────────────────────────────────────────────────
    next_speaker = _determine_next_speaker(
        action            = action,
        target            = target,
        sender            = sender,
        other             = other,
        analysis          = analysis,
        session           = session,
        ledger_sender     = updated_ledger_sender,
        ledger_other      = ledger_other,
        regulation_sender = regulation_sender,
    )

    # ── Build clinical brief ──────────────────────────────────────────────────
    system_message = _build_clinical_brief(
        action            = action,
        speaker_name      = speaker_name,
        other_name        = other_name,
        sender            = sender,
        analysis          = analysis,
        ledger_sender     = updated_ledger_sender,
        ledger_other      = ledger_other,
        regulation_sender = regulation_sender,
        regulation_other  = regulation_other,
        session_temp      = session_temp,
        traits_sender     = traits_sender,
        traits_other      = traits_other,
        session           = session,
    )

    # Override with resume template if set
    if action == "resume_guidance" and partial.get("_resume_template"):
        # Prepend the template as a specific directive
        system_message = partial["_resume_template"] + "\n\n" + system_message

    # ── Exercise (cooldown) ───────────────────────────────────────────────────
    exercise: Optional[str] = None
    if action == "cooldown_start":
        exercise = "pause"   # Frontend shows the pause card, not breathing animation

    # ── Dialogue stage ────────────────────────────────────────────────────────
    dialogue_stage = _STAGE_FROM_ACTION.get(action, "Listening")

    # ── Confidence ────────────────────────────────────────────────────────────
    # High confidence: clean action from level 1-3, or level 4 with high classifier confidence
    # Low confidence: fallback resume_guidance, or classifier was uncertain
    if partial.get("_level", 4) <= 3:
        decision_confidence = "high"
    elif analysis.get("confidence") == "high":
        decision_confidence = "high"
    else:
        decision_confidence = "low"

    # ── Log decision ──────────────────────────────────────────────────────────
    logger.info(
        f"[mediator] L{partial.get('_level',4)} | "
        f"{speaker_name}→{action} | "
        f"target={target} next={next_speaker} | "
        f"mode={mode} temp={session_temp:.1f} | "
        f"reg={regulation_sender} | "
        f"traits={traits_sender[:2] if traits_sender else 'none'}"
    )

    # ── Assemble final decision ───────────────────────────────────────────────
    return {
        # ── For llm_client.py ──────────────────────────────────────────────────
        "action":          action,
        "target":          target,
        "speaker":         sender,
        "quote":           quote,
        "feeling":         feeling,
        "system_message":  system_message,
        "confidence":      decision_confidence,
        "exercise":        exercise,

        # ── For session_manager.py ────────────────────────────────────────────
        "mode":            mode,
        "next_speaker":    next_speaker,
        "dialogue_stage":  dialogue_stage,

        # ── For session_manager.py to persist ─────────────────────────────────
        "_behavioral_update": {
            f"behavioral_ledger_{sender}": updated_ledger_sender,
        },

        # ── Internal metadata — for logging, testing, phase 2 analytics ───────
        "_level":             partial.get("_level", 4),
        "_traits_sender":     traits_sender,
        "_traits_other":      traits_other,
        "_regulation_sender": regulation_sender,
        "_regulation_other":  regulation_other,
        "_session_temp":      session_temp,
        "_consecutive_turns": consecutive,
    }