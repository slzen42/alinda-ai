"""
ai/session_summarizer.py

Alinda's longitudinal psychodynamic memory layer.

This module transforms a completed session's raw transcript into structured
clinical insight, persisted to the SessionInsight table, so that when the
couple returns for their next session, Alinda is informed by their history
rather than starting from nothing.

Three-stage pipeline (a deliberate restructuring of a "double-pass" design):

    Stage 1 — Computational extraction (no LLM, fully deterministic):
        Pulls word counts, response latencies, escalation timing, and repair
        efficacy directly from ChatMessage rows and the session's behavioral
        ledgers (already maintained live by mediator_logic.py throughout the
        session). LLMs are unreliable at precise counting over long context;
        this data already exists computationally, so it is used directly
        rather than re-derived through a model call.

    Stage 2 — Narrative synthesis (one LLM call):
        The computed metrics are translated into narrative-friendly private
        context (never raw numbers) and handed to the LLM alongside a
        candidate systemic pattern (e.g. "possible pursuer-distancer dynamic")
        detected from the trait probabilities in the ledgers. The LLM
        produces the structured clinical narrative — themes, breakthroughs,
        emotional arcs, relationship dynamic, commitments.

    Stage 3 — Deterministic sanitisation:
        A regex sentence-scanner checks the LLM's output for any leaked
        internal terminology or raw scores before persistence. This is a
        rule-based backstop, not a second model call — cheaper and more
        reliable than asking an LLM to police its own output.

Architecture position:
    backend/session_manager.py (when a session closes)
        └── ai/session_summarizer.summarize_session(session, messages, db)
                ├── _compute_behavioral_metrics()   [Stage 1 — deterministic]
                ├── _detect_candidate_pattern()     [Stage 1 — deterministic]
                ├── ai/prompts.build_session_summary_prompt()
                ├── ai/llm_client.generate_background_response()  [Stage 2]
                ├── _sanitize_output()              [Stage 3 — deterministic]
                ├── _parse_summary_sections()
                └── ORM write to SessionInsight (+ CoupleProfile if linked)

What this file does NOT do:
    - Make live session decisions (mediator_logic.py)
    - Touch ChatMessage rows (read-only here)
    - Decide when a session has ended (session_manager.py's responsibility —
      this module is called once that decision has already been made)

Public interface:
    from ai.session_summarizer import summarize_session
    insight = await summarize_session(session, messages, db)
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session as DBSession

from ai.llm_client import generate_background_response
from ai.prompts import build_session_summary_prompt
from backend.models import CoupleProfile, SessionInsight, TherapySession

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Matches mediator_logic._compute_regulation_state's FLOODING cutoff.
# Kept as a local constant rather than imported to avoid tight coupling —
# update both locations together if the clinical threshold changes.
_FLOODING_ESCALATION_THRESHOLD = 6

# Matches mediator_logic._SUSPICION_THRESHOLD.
# Used here only for the lightweight candidate-pattern heuristic below.
_PATTERN_SUSPICION_THRESHOLD = 0.32

# Response-latency outliers beyond this are treated as structural pauses
# (cooldown, bathroom break, distraction) rather than genuine response time,
# and excluded from the average so they don't skew the metric.
_LATENCY_OUTLIER_SECONDS = 1200   # 20 minutes

# Maximum transcript length sent to the LLM. Sessions longer than this are
# truncated, preserving the opening (sets context) and the most recent
# exchanges (most relevant to where the session ended).
# Future improvement: rolling/chunked summarisation for very long sessions
# rather than single-pass truncation.
_MAX_TRANSCRIPT_CHARS = 14000
_TRANSCRIPT_HEAD_CHARS = 3000

# Minimum number of messages required to attempt summarisation.
# A session with almost no content has nothing meaningful to extract.
_MIN_MESSAGES_FOR_SUMMARY = 4


# ─────────────────────────────────────────────────────────────────────────────
# LEAK DETECTION PATTERNS — STAGE 3
#
# Catches internal terminology or raw scores that should never appear in
# a narrative clinical note. Applied sentence-by-sentence; any sentence
# matching is dropped entirely rather than partially edited, since a
# leaked number is usually load-bearing to the sentence around it.
# ─────────────────────────────────────────────────────────────────────────────

_LEAK_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b\d+(\.\d+)?\s*(/|out of)\s*10\b", re.IGNORECASE),
    re.compile(
        r"\b(escalation|toxicity|contempt|vulnerability|engagement|blame|"
        r"repair_attempt|sentiment)\s*[:=]\s*\d",
        re.IGNORECASE,
    ),
    re.compile(r"\btrait[_ ]probabilit\w*\b", re.IGNORECASE),
    re.compile(r"\bconfirmed[_ ]trait\w*\b", re.IGNORECASE),
    re.compile(r"\bbehavioral[_ ]ledger\b", re.IGNORECASE),
    re.compile(
        r"\b(flooding_tendency|withdrawal_tendency|victim_posture|"
        r"emotional_avoidance|repair_capacity|contemptuous_pattern|fragility)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b0\.\d{2}\b"),   # Bare decimal probabilities like 0.62
]


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1 — DETERMINISTIC BEHAVIORAL METRICS
# ─────────────────────────────────────────────────────────────────────────────

def _coerce_ledger(raw) -> dict:
    """
    Safely coerces a behavioral ledger (JSON string or dict) into a dict.
    Returns an empty dict on any malformed input — never raises.
    """
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


def _compute_behavioral_metrics(
    messages:  list,
    ledger_a:  dict,
    ledger_b:  dict,
) -> dict:
    """
    Computes the full Behavioral Ledger lens from existing data sources.

    Entirely deterministic — no LLM involved. Pulls from:
        - ChatMessage.content, .timestamp, .extra_data (per message)
        - session.behavioral_ledger_a/b (accumulated live during the session
          by mediator_logic._update_ledger())

    Returns a flat dict suitable for JSON storage in
    SessionInsight.behavioral_metrics and for narrative formatting via
    _format_behavioral_context().
    """
    word_counts    = {"a": 0, "b": 0}
    message_counts = {"a": 0, "b": 0}
    latencies      = {"a": [], "b": []}

    escalation_events    = 0
    peak_escalation       = 0
    turns_to_first_flood  = None
    user_turn_index       = 0
    repair_acknowledgements    = 0
    affirm_or_framework_count  = 0

    previous_msg = None

    for msg in messages:
        sender  = getattr(msg, "sender", None)
        content = getattr(msg, "content", "") or ""
        extra   = getattr(msg, "extra_data", None) or {}
        ts      = getattr(msg, "timestamp", None)

        if sender in ("a", "b"):
            user_turn_index += 1
            words = len(content.split())
            word_counts[sender]    += words
            message_counts[sender] += 1

            escalation = extra.get("escalation", 0) or 0
            is_abusive = extra.get("is_abusive", False)

            if escalation > peak_escalation:
                peak_escalation = escalation

            if escalation >= _FLOODING_ESCALATION_THRESHOLD or is_abusive:
                escalation_events += 1
                if turns_to_first_flood is None:
                    turns_to_first_flood = user_turn_index

            # Response latency: time since the previous message, only when
            # the previous message was from a different sender (a genuine
            # response, not a follow-up to oneself), and excluding long
            # structural pauses that would otherwise skew the average.
            if (
                previous_msg is not None
                and getattr(previous_msg, "sender", None) != sender
                and ts is not None
            ):
                prev_ts = getattr(previous_msg, "timestamp", None)
                if prev_ts is not None:
                    try:
                        delta = (ts - prev_ts).total_seconds()
                        if 0 < delta <= _LATENCY_OUTLIER_SECONDS:
                            latencies[sender].append(delta)
                    except TypeError:
                        pass

        elif sender == "ai":
            action = extra.get("action")
            if action == "repair_acknowledgement":
                repair_acknowledgements += 1
            if action in {"affirm_progress", "suggest_framework"}:
                affirm_or_framework_count += 1

        previous_msg = msg

    # ── Symmetry / balance score ──────────────────────────────────────────────
    max_words = max(word_counts["a"], word_counts["b"])
    balance_score = (
        min(word_counts["a"], word_counts["b"]) / max_words
        if max_words > 0 else 1.0
    )

    # ── Repair efficacy ────────────────────────────────────────────────────────
    total_repair_bids = ledger_a.get("repair_bids", 0) + ledger_b.get("repair_bids", 0)
    repair_efficacy = (
        min(1.0, repair_acknowledgements / total_repair_bids)
        if total_repair_bids > 0 else None
    )

    # ── Average latencies ─────────────────────────────────────────────────────
    avg_latency_a = sum(latencies["a"]) / len(latencies["a"]) if latencies["a"] else None
    avg_latency_b = sum(latencies["b"]) / len(latencies["b"]) if latencies["b"] else None

    return {
        "word_count_a":                   word_counts["a"],
        "word_count_b":                   word_counts["b"],
        "message_count_a":                message_counts["a"],
        "message_count_b":                message_counts["b"],
        "balance_score":                  round(balance_score, 3),
        "avg_response_latency_a_seconds": round(avg_latency_a, 1) if avg_latency_a else None,
        "avg_response_latency_b_seconds": round(avg_latency_b, 1) if avg_latency_b else None,
        "turns_to_first_flood":           turns_to_first_flood,
        "peak_escalation_score":          peak_escalation,
        "total_escalation_events":        escalation_events,
        "total_repair_bids":              total_repair_bids,
        "repair_acknowledgements":        repair_acknowledgements,
        "repair_efficacy_ratio":          round(repair_efficacy, 3) if repair_efficacy is not None else None,
        "resolution_signal_present":      affirm_or_framework_count > 0,
    }


def _detect_candidate_pattern(
    ledger_a: dict,
    ledger_b: dict,
    name_a:   str,
    name_b:   str,
) -> Optional[str]:
    """
    Detects a candidate systemic relational pattern from the accumulated
    trait probabilities in both partners' behavioral ledgers.

    This is a HINT, not a conclusion — it is fed to the LLM in
    build_session_summary_prompt() as something to confirm, refine, or
    reject against what it actually reads in the transcript. The clinical
    judgment about whether the pattern genuinely fits remains with the LLM,
    grounded in the actual conversation rather than purely in the numbers.

    Returns None if no clear candidate pattern is suggested by the data —
    this is the common case and is not a failure.
    """
    pa = ledger_a.get("trait_probabilities", {}) or {}
    pb = ledger_b.get("trait_probabilities", {}) or {}

    def above(probs: dict, *keys: str) -> bool:
        return any(probs.get(k, 0) >= _PATTERN_SUSPICION_THRESHOLD for k in keys)

    a_pursues   = above(pa, "flooding_tendency", "victim_posture")
    b_pursues   = above(pb, "flooding_tendency", "victim_posture")
    a_distances = above(pa, "withdrawal_tendency", "emotional_avoidance")
    b_distances = above(pb, "withdrawal_tendency", "emotional_avoidance")
    a_contempt  = above(pa, "contemptuous_pattern")
    b_contempt  = above(pb, "contemptuous_pattern")

    if a_pursues and b_distances and not (b_pursues and a_distances):
        return (
            f"possible pursuer-distancer dynamic, with {name_a} in the "
            f"pursuing role and {name_b} tending to withdraw"
        )
    if b_pursues and a_distances and not (a_pursues and b_distances):
        return (
            f"possible pursuer-distancer dynamic, with {name_b} in the "
            f"pursuing role and {name_a} tending to withdraw"
        )
    if a_contempt and b_contempt:
        return "possible mutual attack-defend dynamic, with contempt patterns showing on both sides"
    if a_distances and b_distances:
        return "possible mutual withdrawal dynamic, with both partners tending to shut down under stress"

    return None


def _format_behavioral_context(metrics: dict, name_a: str, name_b: str) -> str:
    """
    Formats computed metrics as narrative-friendly private context for the LLM.

    Deliberately avoids notation like "escalation: 8" even in the input —
    reducing leak risk at the source, since an LLM is less likely to echo
    a notation style it was never shown.
    """
    lines = [
        f"{name_a} contributed {metrics.get('word_count_a', 0)} words across "
        f"{metrics.get('message_count_a', 0)} messages; "
        f"{name_b} contributed {metrics.get('word_count_b', 0)} words across "
        f"{metrics.get('message_count_b', 0)} messages."
    ]

    if metrics.get("turns_to_first_flood") is not None:
        lines.append(
            f"The conversation reached a high-conflict moment at turn "
            f"{metrics['turns_to_first_flood']}."
        )
    else:
        lines.append("No high-conflict moment was detected — escalation stayed contained throughout.")

    if metrics.get("repair_efficacy_ratio") is not None:
        pct = int(metrics["repair_efficacy_ratio"] * 100)
        lines.append(f"Repair attempts were acknowledged and accepted roughly {pct}% of the time.")

    return " ".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# TRANSCRIPT CONSTRUCTION
# ─────────────────────────────────────────────────────────────────────────────

def _build_transcript_text(messages: list, name_a: str, name_b: str) -> str:
    """
    Stitches the full message history into a readable "Name: message" transcript.

    Truncates long sessions, preserving the opening (sets context) and the
    most recent exchanges (most relevant to how the session ended).
    """
    lines: list[str] = []
    for msg in messages:
        sender  = getattr(msg, "sender", "")
        content = getattr(msg, "content", "") or ""
        if not content:
            continue
        if sender == "a":
            lines.append(f"{name_a}: {content}")
        elif sender == "b":
            lines.append(f"{name_b}: {content}")
        elif sender == "ai":
            lines.append(f"Alinda: {content}")
        # System messages are skipped — not part of the clinical narrative.

    full_text = "\n".join(lines)

    if len(full_text) <= _MAX_TRANSCRIPT_CHARS:
        return full_text

    tail_chars = _MAX_TRANSCRIPT_CHARS - _TRANSCRIPT_HEAD_CHARS - 100
    head = full_text[:_TRANSCRIPT_HEAD_CHARS]
    tail = full_text[-tail_chars:]
    return f"{head}\n\n[... conversation continues ...]\n\n{tail}"


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 3 — DETERMINISTIC SANITISATION
# ─────────────────────────────────────────────────────────────────────────────

def _sanitize_output(text: str) -> tuple[str, bool]:
    """
    Scans LLM output sentence-by-sentence for leaked internal terminology
    or raw scores. Any matching sentence is dropped entirely.

    Returns:
        (cleaned_text, leak_detected)
        leak_detected is True if any sentence was removed — used for logging.
    """
    if not text:
        return text, False

    sentences = re.split(r"(?<=[.!?])\s+", text)
    leaked = False
    clean_sentences: list[str] = []

    for sentence in sentences:
        if any(pattern.search(sentence) for pattern in _LEAK_PATTERNS):
            leaked = True
            logger.warning(f"session_summarizer: redacted leaked-metric sentence: {sentence!r}")
            continue
        clean_sentences.append(sentence)

    return " ".join(clean_sentences).strip(), leaked


# ─────────────────────────────────────────────────────────────────────────────
# SECTION PARSING
# ─────────────────────────────────────────────────────────────────────────────

def _parse_summary_sections(raw: str, name_a: str, name_b: str) -> dict:
    """
    Parses the LLM's structured output by header into individual fields.

    Headers must match exactly what build_session_summary_prompt() asks for.
    Robust to headers appearing out of order or being occasionally omitted —
    any header not found in the output simply results in that field being None.
    """
    headers = [
        ("key_themes",            "KEY THEMES:"),
        ("breakthrough_moments",  "BREAKTHROUGH MOMENTS:"),
        ("unresolved_threads",    "UNRESOLVED THREADS:"),
        ("emotional_arc_a",       f"{name_a}'s EMOTIONAL ARC:"),
        ("emotional_arc_b",       f"{name_b}'s EMOTIONAL ARC:"),
        ("relationship_dynamic",  "RELATIONSHIP DYNAMIC OBSERVED:"),
        ("concrete_commitment",   "CONCRETE COMMITMENT:"),
        ("recommended_focus",     "RECOMMENDED FOCUS FOR NEXT SESSION:"),
    ]

    result = {key: None for key, _ in headers}

    positions: list[tuple[int, str, str]] = []
    for key, header_text in headers:
        idx = raw.find(header_text)
        if idx != -1:
            positions.append((idx, key, header_text))
    positions.sort()

    for i, (idx, key, header_text) in enumerate(positions):
        start   = idx + len(header_text)
        end     = positions[i + 1][0] if i + 1 < len(positions) else len(raw)
        content = raw[start:end].strip()
        result[key] = content if content else None

    return result


# ─────────────────────────────────────────────────────────────────────────────
# COUPLE PROFILE HANDOFF — PHASE 2 BLOCK 8 FORWARD COMPATIBILITY
# ─────────────────────────────────────────────────────────────────────────────

def _update_couple_profile(
    session: TherapySession,
    insight: SessionInsight,
    db:      DBSession,
) -> None:
    """
    Rolls this session's insight into the couple's persistent cross-session
    memory, if this session is linked to a CoupleProfile.

    No-ops cleanly when couple_profile_id is None — which is the case for
    every session until Phase 2 Block 8 (user accounts) is implemented.
    This function exists now so that when that block lands, no changes
    are needed here at all.
    """
    if not session.couple_profile_id:
        return

    couple = (
        db.query(CoupleProfile)
        .filter(CoupleProfile.id == session.couple_profile_id)
        .first()
    )
    if couple is None:
        logger.warning(
            f"couple_profile_id={session.couple_profile_id} set on session "
            f"{session.room_id!r} but not found in database."
        )
        return

    couple.total_sessions  = (couple.total_sessions or 0) + 1
    couple.last_session_at = datetime.now(timezone.utc)

    if insight.recommended_focus:
        existing = couple.cumulative_insight or ""
        couple.cumulative_insight = (
            f"{existing}\n\nSession {session.session_number}: {insight.recommended_focus}"
        ).strip()

    if insight.concrete_commitment and "none recorded" not in insight.concrete_commitment.lower():
        couple.last_commitment = insight.concrete_commitment

    db.add(couple)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PUBLIC FUNCTION
# ─────────────────────────────────────────────────────────────────────────────


async def summarize_session(
    session:  TherapySession,
    messages: list,
    db:       DBSession,
) -> Optional[SessionInsight]:
    """
    The single public function of this module.

    Called by session_manager.py once a session has been determined to be
    closed — either by time limit or explicit end confirmation by both
    partners. Performs the full three-stage pipeline and writes the result
    directly to the SessionInsight table, plus rolling it into the couple's
    CoupleProfile if one is linked.

    Never raises. On any failure, logs the error, rolls back the database
    transaction, and returns None — session_manager should treat a None
    return as "summarization failed, the session is still closed correctly,
    but no insight was recorded" rather than as a reason to fail the close.

    Args:
        session:  The TherapySession that has just concluded.
        messages: Chronologically ordered list of ChatMessage ORM rows for
                  this session. Should include all messages — user, ai,
                  and system — the function filters internally.
        db:       An active database session. This function adds and
                  commits to it but does not close it — the caller owns
                  the connection lifecycle (typically via Depends(get_db)).

    Returns:
        The created SessionInsight on success, or None on failure or if
        there was insufficient content to summarise.
    """
    room_id = getattr(session, "room_id", "?")

    if not messages or len(messages) < _MIN_MESSAGES_FOR_SUMMARY:
        logger.info(
            f"session_summarizer: room {room_id!r} has only {len(messages or [])} "
            f"messages — not enough content to summarise. Skipping."
        )
        return None

    try:
        name_a = session.name_a or "Partner A"
        name_b = session.name_b or "Partner B"

        # ── Stage 1: Deterministic computation ────────────────────────────────
        ledger_a = _coerce_ledger(session.behavioral_ledger_a)
        ledger_b = _coerce_ledger(session.behavioral_ledger_b)

        metrics      = _compute_behavioral_metrics(messages, ledger_a, ledger_b)
        pattern_hint = _detect_candidate_pattern(ledger_a, ledger_b, name_a, name_b)

        started_at = session.session_started_at
        ended_at   = session.ended_at or datetime.now(timezone.utc)

        duration_minutes = 0
        if started_at:
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            if ended_at.tzinfo is None:
                ended_at = ended_at.replace(tzinfo=timezone.utc)
            duration_minutes = max(0, int((ended_at - started_at).total_seconds() / 60))

        duration_limit      = session.session_duration_limit or 90
        ended_by_time_limit = duration_minutes >= (duration_limit - 2)

        transcript           = _build_transcript_text(messages, name_a, name_b)
        behavioral_context   = _format_behavioral_context(metrics, name_a, name_b)

        # ── Stage 2: LLM narrative synthesis ──────────────────────────────────
        system_prompt, user_prompt = build_session_summary_prompt(
            name_a              = name_a,
            name_b              = name_b,
            conversation_text   = transcript,
            duration_minutes    = duration_minutes,
            behavioral_context  = behavioral_context,
            pattern_hint        = pattern_hint,
            ended_by_time_limit = ended_by_time_limit,
        )

        raw_response = await generate_background_response(
            system_prompt = system_prompt,
            user_prompt   = user_prompt,
            task_label    = "session_summary",
        )

        parsed: dict = {}
        sanitized_raw: Optional[str] = None

        if raw_response:
            sanitized_raw, leaked = _sanitize_output(raw_response)
            if leaked:
                logger.warning(f"session_summarizer: leak redacted for room {room_id!r}")

            parsed = _parse_summary_sections(sanitized_raw, name_a, name_b)

            # Sanitise each parsed section individually as well — a leak could
            # be internal to a section in a way the full-text scan still catches,
            # but this is a deliberate belt-and-suspenders second pass.
            for key, value in list(parsed.items()):
                if value:
                    clean_value, _ = _sanitize_output(value)
                    parsed[key] = clean_value
        else:
            logger.warning(
                f"session_summarizer: LLM returned empty response for room "
                f"{room_id!r}. Persisting computed metrics only, narrative "
                f"fields will be null."
            )

        resolution_reached = metrics.get("resolution_signal_present", False)

        # ── ORM Hydration ──────────────────────────────────────────────────────
        insight = SessionInsight(
            room_id               = session.room_id,
            couple_profile_id     = session.couple_profile_id,
            session_number        = session.session_number or 1,
            key_themes            = parsed.get("key_themes"),
            breakthrough_moments  = parsed.get("breakthrough_moments"),
            unresolved_threads    = parsed.get("unresolved_threads"),
            emotional_arc_a       = parsed.get("emotional_arc_a"),
            emotional_arc_b       = parsed.get("emotional_arc_b"),
            relationship_dynamic  = parsed.get("relationship_dynamic"),
            concrete_commitment   = parsed.get("concrete_commitment"),
            recommended_focus     = parsed.get("recommended_focus"),
            total_messages           = len(messages),
            total_escalation_events  = metrics.get("total_escalation_events"),
            total_repair_bids        = metrics.get("total_repair_bids"),
            resolution_reached       = resolution_reached,
            session_duration_minutes = duration_minutes,
            behavioral_metrics       = metrics,
            raw_summary              = sanitized_raw,
            session_started_at       = session.session_started_at,
            session_ended_at         = ended_at,
        )

        db.add(insight)
        db.flush()   # Assigns insight.id without committing yet

        _update_couple_profile(session, insight, db)

        db.commit()

        logger.info(
            f"session_summarizer: SessionInsight #{insight.id} created for "
            f"room {room_id!r} (session_number={insight.session_number}, "
            f"resolution_reached={resolution_reached})"
        )

        return insight


    except Exception as exc:
        logger.error(
            f"summarize_session failed for room {room_id!r}: {exc}",
            exc_info=True,
        )
        try:
            db.rollback()
        except Exception:
            pass
        return None