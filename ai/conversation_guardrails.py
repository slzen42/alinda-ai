"""
ai/conversation_guardrails.py

The pre-flight gatekeeper for Alinda's message pipeline.

Architecture position:
    [User sends message]
            ↓
    conversation_guardrails.pre_flight_check()    ← THIS FILE
            │
            ├── allowed=False  →  early_response returned directly
            │                     (no analysis, no LLM call, no API cost)
            │
            └── allowed=True   →  cleaned_text + flags proceed to:
                    ↓
            ai/analysis.analyze_message()
                    ↓
            ai/mediator_logic.decide_mediation()
                    ↓
            ai/conversation_state_controller.adjust_decision()
                    ↓
            ai/llm_client.generate_session_response()

This file has exactly one responsibility: protect the downstream pipeline
from raw input that would corrupt it, waste API quota, or produce a
clinically incoherent response.

It does NOT:
    - Analyse emotion or meaning        (analysis.py)
    - Detect agreement or resolution    (mediator_logic.py)
    - Track action or skill streaks     (conversation_state_controller.py)
    - Make clinical decisions           (mediator_logic.py)
    - Override the LLM's action choice  (that era is over)
    - Touch the database directly

Flags produced by this file are attached to the PreFlightResult and
passed into the analysis and mediator layers as additional context.
They inform clinical decisions without making them.

Connection points for downstream handlers:
    flags["user_is_looping"] → mediator_logic._build_clinical_brief()
        When True, the brief should include:
        "This person has said essentially the same thing multiple times.
         They feel fundamentally unheard. Before asking anything, name
         exactly what you heard them say."

    flags["message_rate_high"] → mediator_logic._build_clinical_brief()
        When True, the brief should note urgency:
        "Messages are arriving very quickly. This person may be in
         acute distress. Match their urgency with calm, not speed."

Public interface:
    from ai.conversation_guardrails import pre_flight_check, PreFlightResult
    result = pre_flight_check(session, sender, text, recent_messages)
    if not result.allowed:
        return result.early_response   # Return to user, skip pipeline
    # result.cleaned_text → pass to analyze_message()
    # result.flags        → pass to decide_mediation() via session_manager
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Maximum message length in characters before the context window guardrail fires.
# ~2000 characters ≈ 350-400 words — more than enough for any therapy utterance.
# Intentionally conservative: a pasted wall of text is almost never a
# coherent therapeutic contribution.
MAX_MESSAGE_CHARS = 2000

# Minimum message length — below this, even a word boundary check is pointless.
# 1-character messages ("k", "?", "…") are handled but not blocked.
MIN_ANALYSIS_LENGTH = 1

# Time window for duplicate detection in seconds.
# If the same message arrives within this window from the same sender,
# it is treated as a technical duplicate (double-click, network retry).
DUPLICATE_WINDOW_SECONDS = 30

# Similarity threshold above which a message is considered a structural duplicate.
# 0.97 allows for minor typo corrections ("I feel hurt" → "I feel hurt.")
# while catching genuine exact-or-near-exact re-sends.
DUPLICATE_SIMILARITY_THRESHOLD = 0.97

# Similarity threshold for broken-record detection.
# Lower than duplicate — catches "same idea, different words" repetition.
# 0.75 is deliberately conservative: we only flag genuinely circular statements,
# not the natural thematic repetition of someone working through a hard feeling.
BROKEN_RECORD_SIMILARITY_THRESHOLD = 0.75

# How many consecutive similar messages from the same sender trigger the
# broken-record flag. 3 is a considered choice:
#   1st time → might be emphasis
#   2nd time → might be persistence
#   3rd time → they feel fundamentally unheard
BROKEN_RECORD_COUNT = 3

# Minimum word count for similarity comparisons.
# Short messages ("okay", "fine", "no") are not compared — the words are too
# few for SequenceMatcher to produce a meaningful ratio.
MIN_WORDS_FOR_SIMILARITY = 5

# Rate limit threshold: minimum seconds between messages from the same sender
# before the rate flag is attached.
# Under 3 seconds is faster than comfortable typing → suggests distress or
# a technical issue. We flag it but never block it.
RATE_THRESHOLD_SECONDS = 3.0

# Maximum number of recent messages to inspect for broken-record detection.
# Looking back more than this adds complexity without clinical value.
BROKEN_RECORD_LOOKBACK = 6


# ─────────────────────────────────────────────────────────────────────────────
# EARLY RESPONSE MESSAGES
#
# These are the only messages this file ever produces for the user.
# They must feel like Alinda's voice — not system errors, not form validation.
# They are warm, brief, and non-judgmental.
#
# They are stored here, not in prompts.py, because they are structural
# responses (not clinical ones) and do not go through the LLM.
# ─────────────────────────────────────────────────────────────────────────────

_RESPONSE_TOO_LONG = (
    "You have shared a lot here, and I want to give it the attention it deserves. "
    "Could you start with the part that feels most important right now?"
)

# Duplicate messages are silently dropped — no user-facing response.
# The frontend already shows their message; a response saying "you already sent this"
# is more confusing than helpful.
_RESPONSE_DUPLICATE = None   # Silent drop

# Empty message — also silent. No error message needed.
_RESPONSE_EMPTY = None


# ─────────────────────────────────────────────────────────────────────────────
# RESULT CONTAINER
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PreFlightResult:
    """
    The return value of pre_flight_check().

    Every field has a clear contract. Callers should check `allowed` first
    and never access `cleaned_text` or `flags` when allowed is False.

    Attributes:
        allowed:            True  → proceed with the clinical pipeline
                            False → return early_response to the user

        cleaned_text:       The normalised, length-safe version of the message.
                            Always populated when allowed=True.
                            Empty string when allowed=False.

        flags:              Dict of boolean and numeric signals for downstream
                            layers. Always present, may be empty.

                            Keys:
                                user_is_looping:     bool   — repeated similar content
                                message_rate_high:   bool   — sent unusually fast
                                original_length:     int    — chars before cleaning
                                was_trimmed:         bool   — text was shortened

        early_response:     The string to return to the user when allowed=False.
                            May be None (silent drop — no response needed).

        rejection_reason:   Internal log string. Never shown to users.
                            Explains why the message was rejected.
    """

    allowed:          bool
    cleaned_text:     str              = ""
    flags:            dict             = field(default_factory=dict)
    early_response:   Optional[str]    = None
    rejection_reason: str              = ""


# ─────────────────────────────────────────────────────────────────────────────
# TEXT NORMALISATION
# ─────────────────────────────────────────────────────────────────────────────

# Invisible characters that can slip in from mobile keyboards, copy-paste,
# and certain emoji keyboards — they appear blank but occupy bytes.
_INVISIBLE_CHAR_RE = re.compile(
    r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u00ad\u034f\u1160"
    r"\u115f\u17b4\u17b5\u180b-\u180d\ufe0f]"
)

# Normalise multiple consecutive spaces, tabs, and linebreaks to a single space.
_WHITESPACE_RE = re.compile(r"\s+")


def _normalise_text(text: str) -> str:
    """
    Cleans raw input text for consistent downstream processing.

    Steps:
        1. Strip invisible characters that have no linguistic content
        2. Apply Unicode NFKC normalisation (standardise ligatures, full-width chars)
        3. Collapse multiple whitespace into single spaces
        4. Strip leading and trailing whitespace
    """
    if not text:
        return ""

    # Remove invisible characters
    text = _INVISIBLE_CHAR_RE.sub("", text)

    # Unicode normalisation
    text = unicodedata.normalize("NFKC", text)

    # Collapse whitespace
    text = _WHITESPACE_RE.sub(" ", text)

    return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# SIMILARITY COMPUTATION
# ─────────────────────────────────────────────────────────────────────────────

def _similarity(text_a: str, text_b: str) -> float:
    """
    Returns a similarity ratio between two strings in the range [0.0, 1.0].

    1.0 = identical
    0.0 = completely different (or one string is too short to compare)

    Uses SequenceMatcher on lowercased strings.
    Returns 0.0 for strings shorter than MIN_WORDS_FOR_SIMILARITY — too few
    words make the ratio meaningless (short words score falsely high).
    """
    if not text_a or not text_b:
        return 0.0

    a_words = text_a.split()
    b_words = text_b.split()

    if len(a_words) < MIN_WORDS_FOR_SIMILARITY or len(b_words) < MIN_WORDS_FOR_SIMILARITY:
        return 0.0

    return SequenceMatcher(None, text_a.lower(), text_b.lower()).ratio()


# ─────────────────────────────────────────────────────────────────────────────
# INDIVIDUAL CHECKS
# Each check returns (is_blocked: bool, reason: str, flag: Optional[tuple])
# ─────────────────────────────────────────────────────────────────────────────

def _check_empty(text: str) -> Optional[PreFlightResult]:
    """
    Rejects silently if the message has no meaningful content after normalisation.
    """
    if not text or len(text.strip()) < MIN_ANALYSIS_LENGTH:
        logger.debug("Pre-flight: empty message rejected")
        return PreFlightResult(
            allowed          = False,
            early_response   = _RESPONSE_EMPTY,
            rejection_reason = "empty_message",
        )
    return None


def _check_length(text: str) -> Optional[PreFlightResult]:
    """
    Rejects messages exceeding MAX_MESSAGE_CHARS.

    Long messages are not evil — they often signal someone who needs to
    express a lot. But LLMs have token limits and extremely long messages
    produce incoherent therapeutic responses.

    The early response invites the person to share the most important part
    first — a therapeutic intervention in itself.
    """
    if len(text) > MAX_MESSAGE_CHARS:
        logger.info(
            f"Pre-flight: message too long ({len(text)} chars > {MAX_MESSAGE_CHARS}). "
            f"Returning length guardrail response."
        )
        return PreFlightResult(
            allowed          = False,
            early_response   = _RESPONSE_TOO_LONG,
            rejection_reason = f"message_too_long:{len(text)}_chars",
        )
    return None


def _check_duplicate(
    text:    str,
    session,
    sender:  str,
) -> Optional[PreFlightResult]:
    """
    Detects technical duplicate sends — same message arriving twice within
    the duplicate window.

    This is a structural problem (network retry, double-click, flaky mobile
    connection), not a clinical one. It is silently dropped.

    Criteria for duplicate:
        1. Similarity ≥ DUPLICATE_SIMILARITY_THRESHOLD
        2. Sent within DUPLICATE_WINDOW_SECONDS of the last message from this sender

    The time check is critical: the same message sent five minutes apart is a
    person returning to an important point (clinical significance).
    The same message sent four seconds apart is a double-click (glitch).
    """
    last_text = getattr(session, "last_user_message", "") or ""
    if not last_text:
        return None

    sim = _similarity(text, last_text)
    if sim < DUPLICATE_SIMILARITY_THRESHOLD:
        return None

    # Similarity threshold crossed — now check time
    last_at_attr = f"last_message_at_{sender}"
    last_at = getattr(session, last_at_attr, None)

    if last_at is None:
        return None

    try:
        now = datetime.now(timezone.utc)
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        elapsed = (now - last_at).total_seconds()

        if elapsed <= DUPLICATE_WINDOW_SECONDS:
            logger.info(
                f"Pre-flight: duplicate message detected from '{sender}' "
                f"(similarity={sim:.2f}, elapsed={elapsed:.1f}s). Silent drop."
            )
            return PreFlightResult(
                allowed          = False,
                early_response   = _RESPONSE_DUPLICATE,
                rejection_reason = f"duplicate:{sim:.2f}:{elapsed:.0f}s",
            )
    except (TypeError, AttributeError, OSError):
        pass

    return None


def _check_broken_record(
    text:             str,
    sender:           str,
    recent_messages:  list,
) -> dict:
    """
    Detects when a user has made the same core statement multiple times in a row.

    This is NOT a block. It returns a flags dict that is passed downstream.
    When `user_is_looping=True`, the clinical brief tells Alinda to
    validate explicitly before asking anything new.

    Broken record ≠ duplicate:
        Duplicate: sent within 30 seconds, structural glitch
        Broken record: sent across multiple turns, clinical signal
            → they feel fundamentally unheard

    Args:
        text:             Current normalised message.
        sender:           "a" or "b".
        recent_messages:  List of ChatMessage ORM objects — last N messages.
                          Filtered for this sender before comparison.

    Returns:
        Dict of flags. May be empty if no loop detected.
    """
    flags: dict = {"user_is_looping": False}

    if len(text.split()) < MIN_WORDS_FOR_SIMILARITY:
        return flags

    if not recent_messages:
        return flags

    # Filter for messages from this sender only, in reverse chronological order
    sender_messages = [
        getattr(msg, "content", "") or ""
        for msg in reversed(recent_messages[-BROKEN_RECORD_LOOKBACK:])
        if getattr(msg, "sender", "") == sender
    ]

    # Compare current message against recent sender messages
    similar_count = 0
    for past_text in sender_messages:
        if not past_text:
            continue
        sim = _similarity(text, past_text)
        if sim >= BROKEN_RECORD_SIMILARITY_THRESHOLD:
            similar_count += 1
        else:
            # Non-similar message in their history breaks the streak
            # We only count consecutive similarity from the most recent backwards
            break

    if similar_count >= BROKEN_RECORD_COUNT - 1:
        # -1 because the current message is the Nth occurrence
        flags["user_is_looping"] = True
        flags["loop_count"]      = similar_count + 1   # Including current message
        logger.info(
            f"Pre-flight: broken record detected for sender '{sender}' "
            f"(similarity streak: {similar_count + 1} messages). "
            f"user_is_looping flag attached."
        )
    else:
        flags["user_is_looping"] = False

    return flags


def _check_rate(
    sender:  str,
    session,
) -> dict:
    """
    Detects unusually fast message submission from a sender.

    A message sent faster than RATE_THRESHOLD_SECONDS after the previous one
    is not blocked — it may be someone in acute distress who needs to be heard
    urgently. Blocking them would be clinically harmful.

    Instead, `message_rate_high=True` is attached as a flag. The clinical brief
    then notes the urgency so Alinda can match the person's emotional register
    with grounded calm.

    Args:
        sender:  "a" or "b".
        session: ORM session object.

    Returns:
        Dict of flags.
    """
    flags: dict = {"message_rate_high": False}

    last_at_attr = f"last_message_at_{sender}"
    last_at      = getattr(session, last_at_attr, None)

    if last_at is None:
        return flags

    try:
        now = datetime.now(timezone.utc)
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        elapsed = (now - last_at).total_seconds()

        if 0 < elapsed < RATE_THRESHOLD_SECONDS:
            flags["message_rate_high"] = True
            logger.debug(
                f"Pre-flight: high message rate from '{sender}' "
                f"(elapsed={elapsed:.1f}s < {RATE_THRESHOLD_SECONDS}s). "
                f"Flag attached — not blocked."
            )
    except (TypeError, AttributeError, OSError):
        pass

    return flags


# ─────────────────────────────────────────────────────────────────────────────
# SESSION TIMESTAMP UPDATE
#
# The only session mutation this file performs.
# Records the time of the most recent message per sender.
# Used by _check_duplicate() and _check_rate() on subsequent messages.
# ─────────────────────────────────────────────────────────────────────────────

def _record_message_timestamp(session, sender: str) -> None:
    """
    Writes the current UTC timestamp to session.last_message_at_{sender}.
    Called after a message passes pre-flight — only on allowed messages.
    """
    attr = f"last_message_at_{sender}"
    try:
        setattr(session, attr, datetime.now(timezone.utc))
    except (AttributeError, TypeError):
        pass


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PUBLIC FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def pre_flight_check(
    session:         object,
    sender:          str,
    text:            str,
    recent_messages: Optional[list] = None,
) -> PreFlightResult:
    """
    The sole public function of this module.

    Runs raw user input through the gatekeeper pipeline and returns a
    PreFlightResult that tells session_manager.py whether to proceed.

    Pipeline (in order):
        1. Normalise text (whitespace, invisible chars, unicode)
        2. Reject empty messages
        3. Reject messages that exceed the length limit
        4. Detect and drop technical duplicates
        5. Detect broken-record loops → attach flag (never block)
        6. Detect high message rate  → attach flag (never block)

    Args:
        session:          ORM session object. Only reads timestamps per sender.
                          Writes last_message_at_{sender} on allowed messages.
        sender:           "a" or "b".
        text:             Raw message text from the user.
        recent_messages:  Optional list of recent ChatMessage ORM objects.
                          Passed to the broken-record detector.
                          If None, broken-record detection is skipped.

    Returns:
        PreFlightResult
            allowed=True  → proceed with pipeline, use cleaned_text and flags
            allowed=False → return early_response (may be None for silent drop)

    Guaranteed to return a PreFlightResult — never raises.
    """

    try:

        # ── Step 1: Normalise ─────────────────────────────────────────────────
        cleaned = _normalise_text(text)
        original_length = len(text)

        # ── Step 2: Empty check ───────────────────────────────────────────────
        result = _check_empty(cleaned)
        if result is not None:
            return result

        # ── Step 3: Length check ──────────────────────────────────────────────
        result = _check_length(cleaned)
        if result is not None:
            return result

        # ── Step 4: Duplicate detection ───────────────────────────────────────
        result = _check_duplicate(cleaned, session, sender)
        if result is not None:
            return result

        # ── Steps 5 & 6: Flag detection (never block) ─────────────────────────
        flags: dict = {
            "original_length": original_length,
            "was_trimmed":     len(cleaned) < original_length,
        }

        # Broken record
        loop_flags = _check_broken_record(
            text            = cleaned,
            sender          = sender,
            recent_messages = recent_messages or [],
        )
        flags.update(loop_flags)

        # Rate check
        rate_flags = _check_rate(sender=sender, session=session)
        flags.update(rate_flags)

        # ── Record timestamp (only on allowed messages) ───────────────────────
        _record_message_timestamp(session, sender)

        # ── All checks passed ─────────────────────────────────────────────────
        logger.debug(
            f"Pre-flight PASSED | sender={sender} | "
            f"length={len(cleaned)} | "
            f"looping={flags.get('user_is_looping', False)} | "
            f"rate_high={flags.get('message_rate_high', False)}"
        )

        return PreFlightResult(
            allowed      = True,
            cleaned_text = cleaned,
            flags        = flags,
        )

    except Exception as exc:
        # The gatekeeper must never crash the pipeline.
        # On any unexpected error, allow the message through with a warning.
        logger.error(
            f"pre_flight_check raised unexpectedly: {exc}. "
            f"Allowing message through to prevent session disruption.",
            exc_info=True,
        )
        return PreFlightResult(
            allowed      = True,
            cleaned_text = _normalise_text(text) if text else "",
            flags        = {"pre_flight_error": True},
        )