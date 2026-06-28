"""
ai/llm_client.py

The transport layer between Alinda's decision engine and the Groq LLM API.

Single responsibility: given a routing decision and all necessary context,
assemble a prompt, call the API, clean the response, and return it.

This file makes no therapeutic decisions.
All prompt logic lives in ai/prompts.py.
All routing decisions come from ai/mediator_logic.py.
All session context is assembled and passed in by backend/session_manager.py.

Public interface:
    generate_session_response()   — live session messages       (SESSION key)
    generate_background_response() — intake + session summary   (BACKGROUND key)
    generate_session_opening()    — dynamic personalised intro  (SESSION key)

Architecture:
    session_manager.py
        └── generate_session_response(names, messages, profiles, decision)
                ├── build_prompt()              [ai/prompts.py]
                ├── get_temperature(action)     [ai/prompts.py]
                ├── get_max_tokens(action)      [ai/prompts.py]
                ├── _call_groq()                [this file — async HTTP + retry]
                ├── _clean_response()           [this file — strip artifacts]
                └── _detect_addressed_partner() [this file — who did LLM address?]
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

from ai.prompts import (
    SESSION_MODEL,
    BACKGROUND_MODEL,
    SYSTEM_PROMPT,
    build_prompt,
    get_temperature,
    get_max_tokens,
)

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Two separate keys so background tasks never consume
# the session key's rate limit budget during live sessions.
GROQ_API_KEY_SESSION    = os.environ.get("GROQ_API_KEY_SESSION", "")
GROQ_API_KEY_BACKGROUND = os.environ.get("GROQ_API_KEY_BACKGROUND", "")

if not GROQ_API_KEY_SESSION:
    logger.error(
        "GROQ_API_KEY_SESSION is not set. "
        "All live session responses will use fallback messages."
    )

if not GROQ_API_KEY_BACKGROUND:
    logger.warning(
        "GROQ_API_KEY_BACKGROUND is not set. "
        "Defaulting to GROQ_API_KEY_SESSION for background tasks. "
        "Set a separate key to prevent rate limit contention."
    )
    GROQ_API_KEY_BACKGROUND = GROQ_API_KEY_SESSION

# HTTP timeouts — connect timeout is short, read timeout is generous
# because the first token from a large model can take several seconds.
_TIMEOUT = httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=5.0)

# Retry configuration
_MAX_RETRIES     = 3
_RETRY_CODES     = {429, 500, 502, 503, 504}
_RETRY_BASE_SECS = 1.0   # Doubles on each retry: 1s → 2s → 4s


# ─────────────────────────────────────────────────────────────────────────────
# FALLBACK MESSAGES
#
# These are returned when the Groq API fails after all retries.
# They must feel like Alinda is genuinely pausing — not like a system error.
# Per-action fallbacks ensure the response is contextually appropriate
# even when the API is unreachable.
#
# Safety fallbacks are kept firm, not soft — a session in crisis cannot
# afford a generic "I'm processing" message.
# ─────────────────────────────────────────────────────────────────────────────

_FALLBACKS: dict[str, str] = {
    # Safety-critical — firm and present
    "safety_intervention": "I need us to slow down. What just happened matters.",
    "crisis_self_harm":    "What you just said matters and I am not moving past it.",
    "repair_required":     "Let's try to find a different way to say that.",
    "cooldown_start":      "Let's pause here. There is no rush.",

    # Exploratory — warm and open
    "explore":             "I am sitting with what you just said. Tell me more.",
    "validate":            "What did you hear in that? I want to make sure nothing got lost.",
    "deescalate":          "What is really happening for you right now?",
    "resume_guidance":     "What is the most important thing you want the other person to understand?",
    "affirm_progress":     "Something just shifted here. Take a moment with that.",
    "free_chat_invite":    "I am going to step back for a moment. Speak directly to each other.",

    # Generic fallback — warm, buys time without alarming
    "_default": (
        "I am taking a moment with what you just shared. Give me a few seconds."
    ),
}


def _get_fallback(action: str, decision: dict) -> str:
    """
    Returns the most appropriate fallback message for a given action.

    Prefers the decision's own system_message if it is short enough
    to serve as a fallback (under 20 words) — this keeps the fallback
    contextually grounded in what mediator_logic.py decided.
    """
    system_message = decision.get("system_message", "")
    if system_message and len(system_message.split()) <= 20:
        return system_message
    return _FALLBACKS.get(action, _FALLBACKS["_default"])


# ─────────────────────────────────────────────────────────────────────────────
# RESPONSE CLEANING
#
# Raw LLM output regularly contains artifacts that must be stripped
# before the message is stored or sent:
#
#   Speaker labels:    "Alinda: ..."  → remove
#   Thinking blocks:   <think>...</think>  → remove entirely
#   Truncation marks:  ##, User:, Assistant:  → truncate at marker
#   Markdown:          **bold**, *italic*, `code`  → strip formatting
#   Pronoun drift:     "let's", "we should"  → replace with non-participant voice
#   Capitalisation:    ensure first character is uppercase
#   Punctuation:       ensure terminal punctuation is present
# ─────────────────────────────────────────────────────────────────────────────

_SPEAKER_LABEL_RE = re.compile(
    r"^(alinda|mediator|therapist|ai|assistant|\[alinda\]|\[mediator\])\s*[:\-]\s*",
    re.IGNORECASE,
)

_THINKING_TAG_RE = re.compile(
    r"<think>.*?</think>",
    re.DOTALL | re.IGNORECASE,
)

_MARKDOWN_BOLD_RE    = re.compile(r"\*\*(.*?)\*\*")
_MARKDOWN_ITALIC_RE  = re.compile(r"(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)")
_MARKDOWN_CODE_RE    = re.compile(r"`(.*?)`")

# Markers that indicate the model has started generating conversation history
# rather than the actual response — truncate at these.
_TRUNCATION_MARKERS = [
    "##", "\nUser:", "\nAssistant:", "\nHuman:", "\nSystem:",
    "\nPartner A:", "\nPartner B:",
]

# Pronoun corrections — prevent Alinda from positioning herself as a session participant.
# Each tuple is (compiled pattern, replacement string).
_PRONOUN_CORRECTIONS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\blet'?s\b",       re.IGNORECASE), "you could"),
    (re.compile(r"\bwe should\b",    re.IGNORECASE), "you might"),
    (re.compile(r"\bwe can\b",       re.IGNORECASE), "you can"),
    (re.compile(r"\bboth of us\b",   re.IGNORECASE), "both of you"),
]

# Words that, when a sentence ends with them and no punctuation follows,
# suggest the sentence is a question.
_QUESTION_ENDING_WORDS = frozenset({
    "you", "that", "now", "right", "there", "it", "moment", "here",
    "feeling", "hear", "mean", "understand", "happen", "feel", "said",
    "happening", "underneath", "driving", "behind",
})


def _clean_response(raw: str) -> str:
    """
    Strips all LLM artifacts from a raw response string.

    Returns clean, properly capitalised, punctuated therapeutic text.
    Guaranteed to return a string — returns empty string if input is empty.

    Pipeline:
        1. Strip thinking blocks
        2. Truncate at conversation-structure markers
        3. Strip speaker label prefix
        4. Strip markdown formatting
        5. Apply pronoun corrections
        6. Normalise whitespace
        7. Ensure first character is capitalised
        8. Ensure terminal punctuation
    """
    if not raw:
        return ""

    text = raw.strip()

    # 1. Remove <think>...</think> blocks
    text = _THINKING_TAG_RE.sub("", text).strip()

    # 2. Truncate at structural markers
    for marker in _TRUNCATION_MARKERS:
        if marker in text:
            text = text.split(marker)[0].strip()

    # 3. Strip speaker label at the start
    text = _SPEAKER_LABEL_RE.sub("", text).strip()

    # 4. Strip markdown
    text = _MARKDOWN_BOLD_RE.sub(r"\1", text)
    text = _MARKDOWN_ITALIC_RE.sub(r"\1", text)
    text = _MARKDOWN_CODE_RE.sub(r"\1", text)

    # 5. Pronoun corrections
    for pattern, replacement in _PRONOUN_CORRECTIONS:
        text = pattern.sub(replacement, text)

    # 6. Normalise whitespace
    text = re.sub(r" {2,}", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    text = text.strip()

    if not text:
        return ""

    # 7. Ensure first character is capitalised
    if text[0].islower():
        text = text[0].upper() + text[1:]

    # 8. Ensure terminal punctuation
    if text[-1] not in ".!?":
        words = text.split()
        last_word = words[-1].rstrip(".,!?;:").lower() if words else ""
        if last_word in _QUESTION_ENDING_WORDS:
            text += "?"
        else:
            text += "."

    return text


# ─────────────────────────────────────────────────────────────────────────────
# SPEAKER DETECTION
#
# mediator_logic.py sets decision["target"] based on routing rules.
# The LLM reads the full conversation and sometimes correctly addresses
# a different person — because it sees nuance the routing logic missed.
#
# This function reads the first sentence of the response and checks
# whether it leads with a partner name. If it does, the LLM's choice
# overrides the routing decision. If it is ambiguous, the routing decision wins.
#
# This solves the turn assignment bug where Alinda addresses Cloud but
# the floor is given to Sky.
# ─────────────────────────────────────────────────────────────────────────────

def _detect_addressed_partner(
    text:            str,
    name_a:          str,
    name_b:          str,
    decision_target: str,
) -> str:
    """
    Infers who the LLM actually addressed from the first sentence.

    Args:
        text:             Cleaned LLM response.
        name_a:           Partner A's display name.
        name_b:           Partner B's display name.
        decision_target:  The routing decision's intended target ("a", "b", or "both").

    Returns:
        "a", "b", or "both".
    """
    # Extract the first sentence
    end_pos = len(text)
    for ch in ".?!":
        idx = text.find(ch)
        if 0 < idx < end_pos:
            end_pos = idx
    first_sentence = text[:end_pos].lower()

    name_a_found = name_a.lower() in first_sentence
    name_b_found = name_b.lower() in first_sentence

    if name_a_found and not name_b_found:
        detected = "a"
    elif name_b_found and not name_a_found:
        detected = "b"
    else:
        detected = decision_target   # Ambiguous — trust the router

    if detected != decision_target:
        logger.debug(
            f"Speaker detection override: decision='{decision_target}' → "
            f"actual='{detected}' (LLM addressed {repr(name_a if detected == 'a' else name_b)})"
        )

    return detected

# ─────────────────────────────────────────────────────────────────────────────
# CORE HTTP CALL — ASYNC WITH EXPONENTIAL BACKOFF RETRY
# ─────────────────────────────────────────────────────────────────────────────

async def _call_groq(
    messages:    list[dict],
    model:       str,
    temperature: float,
    max_tokens:  int,
    api_key:     str,
    task_label:  str = "session",
) -> str:
    """
    Fires one async POST to the Groq chat completions endpoint.
    Retries on rate limits and transient server errors.

    Args:
        messages:    Full messages array — [{"role": ..., "content": ...}, ...]
        model:       Groq model string.
        temperature: Sampling temperature (0.0 – 1.0).
        max_tokens:  Maximum completion tokens.
        api_key:     Groq API key for this call.
        task_label:  Human-readable label for logs.

    Returns:
        Raw LLM response string — unstripped, uncleaned.

    Raises:
        RuntimeError: On authentication failure, invalid request,
                      or exhausted retries.
    """
    if not api_key:
        raise RuntimeError(
            f"No API key configured for task '{task_label}'. "
            f"Set GROQ_API_KEY_SESSION and GROQ_API_KEY_BACKGROUND in your .env file."
        )

    payload = {
        "model":       model,
        "messages":    messages,
        "max_tokens":  max_tokens,
        "temperature": temperature,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }

    last_error: Optional[Exception] = None

    for attempt in range(1, _MAX_RETRIES + 1):
        t0 = time.perf_counter()

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                response = await client.post(
                    GROQ_URL,
                    json=payload,
                    headers=headers,
                )

            elapsed_ms = (time.perf_counter() - t0) * 1000

            # ── 200 OK ───────────────────────────────────────────────────────
            if response.status_code == 200:
                data  = response.json()
                raw   = data["choices"][0]["message"]["content"].strip()
                usage = data.get("usage", {})
                logger.info(
                    f"Groq [{task_label}] 200 OK | "
                    f"model={model} temp={temperature} "
                    f"in={usage.get('prompt_tokens','?')} "
                    f"out={usage.get('completion_tokens','?')} tokens | "
                    f"{elapsed_ms:.0f}ms | attempt={attempt}"
                )
                return raw

            # ── Non-retryable: authentication ────────────────────────────────
            elif response.status_code == 401:
                logger.error(
                    f"Groq 401 Unauthorized [{task_label}]. "
                    f"API key is invalid or has been revoked. "
                    f"Update GROQ_API_KEY_SESSION / GROQ_API_KEY_BACKGROUND."
                )
                raise RuntimeError("Groq API key rejected — 401 Unauthorized")

            # ── Non-retryable: bad request ────────────────────────────────────
            elif response.status_code == 400:
                body = response.text[:400]
                logger.error(
                    f"Groq 400 Bad Request [{task_label}]: {body}"
                )
                raise RuntimeError(f"Groq rejected the request (400): {body}")

            # ── Retryable: rate limit or server error ─────────────────────────
            elif response.status_code in _RETRY_CODES:
                delay = _RETRY_BASE_SECS * (2 ** (attempt - 1))
                logger.warning(
                    f"Groq {response.status_code} [{task_label}] "
                    f"(attempt {attempt}/{_MAX_RETRIES}). "
                    f"Retrying in {delay:.1f}s."
                )
                last_error = RuntimeError(
                    f"Groq {response.status_code}: {response.text[:100]}"
                )
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(delay)

            # ── Unexpected status code ────────────────────────────────────────
            else:
                logger.error(
                    f"Groq unexpected {response.status_code} [{task_label}]: "
                    f"{response.text[:200]}"
                )
                raise RuntimeError(
                    f"Groq returned unexpected status {response.status_code}"
                )

        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            delay = _RETRY_BASE_SECS * (2 ** (attempt - 1))
            logger.warning(
                f"Groq network error [{task_label}] "
                f"(attempt {attempt}/{_MAX_RETRIES}): {type(exc).__name__}. "
                f"Retrying in {delay:.1f}s."
            )
            last_error = exc
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(delay)

        except RuntimeError:
            raise   # Non-retryable — surface immediately

    # All retries exhausted
    raise RuntimeError(
        f"Groq API failed after {_MAX_RETRIES} attempts [{task_label}]. "
        f"Last error: {last_error}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC FUNCTION 1 — LIVE SESSION RESPONSE
# ─────────────────────────────────────────────────────────────────────────────

async def generate_session_response(
    name_a:            str,
    name_b:            str,
    recent_messages:   list,
    analysis:          dict,
    decision:          dict,
    partner_profile_a: Optional[str] = None,
    partner_profile_b: Optional[str] = None,
    session_insight:   Optional[str] = None,
) -> dict:
    """
    The primary function called by session_manager.py on every user message.

    Takes the complete context assembled by the session manager, builds
    the prompt, calls the API with the correct parameters for this action,
    and returns a clean response dict.

    Args:
        name_a:             Partner A's display name.
        name_b:             Partner B's display name.
        recent_messages:    List of recent ChatMessage ORM objects.
                            Passed to build_prompt() for conversation context.
        analysis:           Enriched analysis dict from ai/analysis.py.
                            Used for safety temperature override.
        decision:           Routing decision dict from ai/mediator_logic.py.
                            Required keys: action, target, speaker, quote,
                            feeling, system_message, confidence.
        partner_profile_a:  Optional pre-session profile for Partner A.
                            Generated by intake_analyzer.py. Injected into
                            the therapist briefing section of the prompt.
        partner_profile_b:  Optional pre-session profile for Partner B.
        session_insight:    Optional summary from the previous session.
                            Generated by session_summarizer.py.

    Returns:
        {
            "next_speaker":         "a" | "b" | "both",
            "message":              str,   clean response text
            "llm":                  bool,  True if LLM was called, False if fallback
            "llm_suggested_target": str,   who the LLM actually addressed
        }
    """
    action          = decision.get("action", "resume_guidance")
    decision_target = decision.get("target", "a")

    # ── Assemble prompt ───────────────────────────────────────────────────────
    prompt = build_prompt(
        name_a            = name_a,
        name_b            = name_b,
        decision          = decision,
        recent_messages   = recent_messages,
        partner_profile_a = partner_profile_a,
        partner_profile_b = partner_profile_b,
        session_insight   = session_insight,
    )

    # ── Calibrate parameters ──────────────────────────────────────────────────
    temperature = get_temperature(action)
    max_tokens  = get_max_tokens(action)

    # Safety override: analysis independently confirms danger →
    # clamp temperature to ensure firm, predictable output
    is_confirmed_danger = (
        action in {"safety_intervention", "crisis_self_harm"}
        or (analysis.get("is_abusive") and analysis.get("toxicity", 0) >= 4)
        or analysis.get("crisis") in {"self_harm", "harm_to_other"}
    )
    if is_confirmed_danger:
        temperature = min(temperature, 0.20)

    # ── Build messages payload ────────────────────────────────────────────────
    messages_payload = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]

    # ── Call API ──────────────────────────────────────────────────────────────
    try:
        raw = await _call_groq(
            messages    = messages_payload,
            model       = SESSION_MODEL,
            temperature = temperature,
            max_tokens  = max_tokens,
            api_key     = GROQ_API_KEY_SESSION,
            task_label  = action,
        )

        cleaned = _clean_response(raw)

        if not cleaned:
            logger.warning(
                f"LLM returned empty or uncleanable response for action "
                f"'{action}'. Using fallback."
            )
            cleaned = _get_fallback(action, decision)
            return {
                "next_speaker":         decision_target,
                "message":              cleaned,
                "llm":                  False,
                "llm_suggested_target": decision_target,
            }

        # ── Detect who was actually addressed ─────────────────────────────────
        actual_target = _detect_addressed_partner(
            text            = cleaned,
            name_a          = name_a,
            name_b          = name_b,
            decision_target = decision_target,
        )

        return {
            "next_speaker":         actual_target,
            "message":              cleaned,
            "llm":                  True,
            "llm_suggested_target": actual_target,
        }

    except Exception as exc:
        logger.error(
            f"generate_session_response failed for action '{action}': {exc}",
            exc_info=True,
        )
        return {
            "next_speaker":         decision_target,
            "message":              _get_fallback(action, decision),
            "llm":                  False,
            "llm_suggested_target": decision_target,
        }


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC FUNCTION 2 — BACKGROUND TASK RESPONSE
#
# Used for intake analysis and session summarisation.
# Runs on GROQ_API_KEY_BACKGROUND so background work never consumes
# the session key's rate limit when live sessions are active.
#
# Background tasks failing must NEVER crash the session — both callers
# (intake_analyzer.py and session_summarizer.py) check for empty return.
# ─────────────────────────────────────────────────────────────────────────────

async def generate_background_response(
    system_prompt: str,
    user_prompt:   str,
    task_label:    str = "background",
) -> str:
    """
    Sends a background LLM task to Groq and returns the raw response text.

    Used by:
        ai/intake_analyzer.py      → generate pre-session partner profiles
        ai/session_summarizer.py   → generate post-session therapeutic insights

    Args:
        system_prompt: System role content — clinical context and instructions.
        user_prompt:   User role content — intake text or conversation transcript.
        task_label:    Descriptive label for logging.

    Returns:
        Raw LLM response string, unstripped.
        Returns empty string on failure — callers must handle this gracefully.
    """
    messages_payload = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_prompt},
    ]

    # Background tasks need consistency, not creativity
    temperature = 0.30
    max_tokens  = get_max_tokens("_intake_analysis")

    try:
        raw = await _call_groq(
            messages    = messages_payload,
            model       = BACKGROUND_MODEL,
            temperature = temperature,
            max_tokens  = max_tokens,
            api_key     = GROQ_API_KEY_BACKGROUND,
            task_label  = task_label,
        )
        return raw.strip()

    except Exception as exc:
        logger.error(
            f"generate_background_response failed [{task_label}]: {exc}",
            exc_info=True,
        )
        # Empty string signals failure to the caller — session continues
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC FUNCTION 3 — DYNAMIC SESSION OPENING
#
# Phase 1: Hardcoded intro string in session_manager.py
# Phase 2: AI-generated personalised opening using both partner names,
#          the session style, and the profiles from intake analysis.
#
# The opening message sets the entire tone of the session.
# It must feel warm, unhurried, and safe — not scripted.
#
# A static fallback is always available so session startup never hangs
# if the API is slow or unavailable.
# ─────────────────────────────────────────────────────────────────────────────

_OPENING_SYSTEM_PROMPT = """\
You are Alinda, a warm and experienced couples mediator opening a session.
Your opening message sets the tone for everything that follows.
It must feel genuine, unhurried, and safe.

Write no more than 3 sentences.
Use both partner names naturally.
Do not mention what they shared in their intake.
Do not explain the process or give instructions.
Simply acknowledge that they are here together and invite the first partner to begin.
End by asking the first partner — by name — to share what brought them here.
Only output the spoken words. Nothing else.
"""

_STYLE_GUIDANCE: dict[str, str] = {
    "gentle":    "They may be nervous or fragile. Be especially soft and unhurried.",
    "direct":    "They want to move forward. Be warm but efficient.",
    "practical": "They value clarity. Acknowledge the difficulty briefly and invite action.",
    "balanced":  "Trust them to set the pace. Be warm and open.",
}


async def generate_session_opening(
    name_a: str,
    name_b: str,
    intake_a: str,
    intake_b: str,
    session_style: str,
    style_a: Optional[str] = None,
    style_b: Optional[str] = None,
) -> str:
    """
    Generates a personalised, dynamic opening message for the session.

    Called by session_manager.py when both intakes are submitted and
    the session transitions to ready_for_session.

    Profiles are used to calibrate tone — never referenced directly.
    The opening never reveals what either partner said in their intake.

    Args:
        name_a:             Partner A's name. Alinda invites them to speak first.
        name_b:             Partner B's name.
        session_style:      "gentle", "direct", "practical", or "balanced".
        partner_profile_a:  Optional profile from intake_analyzer.py.
        partner_profile_b:  Optional profile for Partner B.

    Returns:
        Clean opening message string.
        Falls back to a warm static message on failure — session never hangs.
    """
    mismatch_block = ""
    if style_a and style_b and style_a != style_b:
        from ai.prompts import _MISMATCH_ACKNOWLEDGMENT_TEMPLATE
        mismatch_block = _MISMATCH_ACKNOWLEDGMENT_TEMPLATE.format(
            name_a=name_a,
            name_b=name_b,
            style_a=style_a,
            style_b=style_b
        )
    # Static fallback — always available, used if generation fails
    static_fallback = (
        f"Hello {name_a} and {name_b}.\n\n"
        f"Thank you both for being here. This space is yours — "
        f"meant for each of you to feel heard, without interruption or judgement.\n\n"
        f"{name_a}, would you like to begin by sharing what brought you both here today?"
    )

    style_note = _STYLE_GUIDANCE.get(session_style, _STYLE_GUIDANCE["balanced"])

    # Therapist briefing — tone calibration only, never content
    briefing_lines: list[str] = []
    if intake_a:
        briefing_lines.append(f"{name_a}: {intake_a.strip()}")
    if intake_b:
        briefing_lines.append(f"{name_b}: {intake_b.strip()}")

    briefing_block = ""
    if briefing_lines:
        briefing_block = (
            "\n\nTHERAPIST NOTE (use for tone calibration only — "
            "never reference or reveal this):\n"
            + "\n".join(briefing_lines)
        )

    user_prompt = (
        f"Open a session with {name_a} and {name_b}.\n"
        f"Style: {style_note}"
        f"{mismatch_block}\n"
        f"{briefing_block}\n\n"
        f"After welcoming them, invite {name_a} to begin by sharing "
        f"what brought them here today."
    )

    messages_payload = [
        {"role": "system", "content": _OPENING_SYSTEM_PROMPT},
        {"role": "user",   "content": user_prompt},
    ]

    try:
        raw = await _call_groq(
            messages    = messages_payload,
            model       = SESSION_MODEL,
            temperature = 0.65,  # Warmer than session — first impression matters
            max_tokens  = 160,
            api_key     = GROQ_API_KEY_SESSION,
            task_label  = "session_opening",
        )
        cleaned = _clean_response(raw)
        return cleaned if cleaned else static_fallback

    except Exception as exc:
        logger.error(f"generate_session_opening failed: {exc}", exc_info=True)
        return static_fallback