"""
ai/intake_analyzer.py

Alinda's pre-session psychological diagnostician.

Translates a partner's raw intake answers into a structured, validated
behavioral profile — then into private instructional guidance for Alinda.
The profile is never a biography. It is never quoted back to the user.
It exists purely to make Alinda's approach to this specific person more
accurate from the very first message of the session.

Architecture position:
    backend/session_manager.py (when both intakes are submitted)
        └── ai/intake_analyzer.analyze_both_partners(name_a, intake_a, name_b, intake_b)
                ├── ai/prompts.build_intake_analysis_prompt()   [per partner]
                ├── ai/llm_client.generate_background_response() [per partner, concurrent]
                ├── _extract_json_object()      — robust JSON parsing
                ├── PartnerProfile(**parsed)    — Pydantic validation, with one retry
                ├── _redact_leaked_fields()     — privacy verification, not just instruction
                └── _format_instructional_text() — converts profile → ghost prompt

This file does NOT:
    - Touch the database
    - Flip any FSM state
    - Write to TherapySession columns

That orchestration belongs to backend/session_manager.py, which is the layer
that already owns every other FSM transition in this system. Keeping this
file pure means it requires no database to test — see test_ai.py Phase 10,
which exercises every function here without a throwaway connection.

Integration point (for session_manager.py, when built):

    from ai.intake_analyzer import analyze_both_partners

    result_a, result_b = await analyze_both_partners(
        session.name_a, session.intake_a,
        session.name_b, session.intake_b,
    )
    session.partner_profile_a = result_a.instructional_text
    session.partner_profile_b = result_b.instructional_text
    session.phase = "ready_for_session"
    db.commit()

Relationship to mediator_logic.py's behavioral ledger:
    The profile produced here is a PRE-session hypothesis based on one-sided
    self-report — inherently the weakest evidence in the system. The
    behavioral ledger in mediator_logic.py accumulates evidence from actual
    observed behavior throughout the live session. When the two disagree,
    the ledger should win — this file's output explicitly instructs Alinda
    to hold its conclusions loosely and revise based on what she actually
    observes. No code change to mediator_logic.py is required for this —
    the instructional text itself carries the hedge, and the LLM reading
    both the profile and the live clinical brief is capable of weighing
    recency over a session-start guess.

Public interface:
    from ai.intake_analyzer import generate_partner_profile, analyze_both_partners
    result = await generate_partner_profile(name, intake_text)
    result_a, result_b = await analyze_both_partners(name_a, intake_a, name_b, intake_b)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from enum import Enum
from typing import Annotated, Optional

from pydantic import BaseModel, Field, ValidationError, model_validator

from ai.llm_client import generate_background_response
from ai.prompts import build_intake_analysis_prompt

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Below this length, the intake has essentially no signal — skip the LLM
# call entirely and go straight to the neutral default profile.
_MIN_INTAKE_LENGTH_FOR_LLM = 20

# Free-text fields shorter than this word count are not leak-checked —
# too short for SequenceMatcher to produce a meaningful ratio, and short
# enum-adjacent phrases would otherwise produce false positives.
_MIN_LEAK_CHECK_WORDS = 4

# Similarity ratio above which an extracted field is considered a probable
# leak of the user's actual words rather than a genuine abstraction.
_LEAK_SIMILARITY_THRESHOLD = 0.60


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURED PROFILE SCHEMA
# ─────────────────────────────────────────────────────────────────────────────

class ConflictPosture(str, Enum):
    INTELLECTUALIZING  = "intellectualizing"
    WITHDRAWING         = "withdrawing"
    COUNTER_ATTACKING   = "counter_attacking"
    EMOTIONAL_FLOODING  = "emotional_flooding"
    PEOPLE_PLEASING     = "people_pleasing"
    MIXED               = "mixed"


class ValidationLanguage(str, Enum):
    COGNITIVE = "cognitive"
    SOMATIC   = "somatic"
    MIXED     = "mixed"


class ProfileConfidence(str, Enum):
    HIGH   = "high"
    MEDIUM = "medium"
    LOW    = "low"


class PartnerProfile(BaseModel):
    """
    The validated structured output of intake analysis.

    Every free-text field is bounded in length to keep the eventual
    instructional text concise and to prevent a runaway LLM response from
    bloating every subsequent session prompt for the rest of the conversation.

    The before-validator normalises common LLM formatting variance
    (capitalisation, stray spaces, spaces instead of underscores) before
    the strict enum match — this materially improves first-attempt
    validation success without loosening the schema itself.
    """

    core_attachment_wound: str = Field(..., min_length=2, max_length=200)
    conflict_posture:      ConflictPosture
    validation_language:   ValidationLanguage
    primary_trigger:        str = Field(..., min_length=2, max_length=200)
    blind_spot:             str = Field(..., min_length=2, max_length=300)
    handling_instructions:  list[Annotated[str, Field(max_length=150)]] = Field(
        default_factory=list
    )
    confidence: ProfileConfidence

    model_config = {"extra": "ignore"}   # Ignore any hallucinated extra keys

    @model_validator(mode="before")
    @classmethod
    def _normalise_enum_strings(cls, data):
        """Smooths over common LLM formatting variance before enum matching."""
        if isinstance(data, dict):
            for key in ("conflict_posture", "validation_language", "confidence"):
                if key in data and isinstance(data[key], str):
                    data[key] = data[key].strip().lower().replace(" ", "_")
        return data

    @model_validator(mode="after")
    def _cap_instructions(self):
        """Defensive bound — even if the LLM ignores the '2 to 4' instruction."""
        if len(self.handling_instructions) > 5:
            self.handling_instructions = self.handling_instructions[:5]
        return self


# ─────────────────────────────────────────────────────────────────────────────
# RESULT CONTAINER
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class IntakeAnalysisResult:
    """
    The complete return value of generate_partner_profile().

    Attributes:
        profile:             The validated structured profile. Useful for
                             logging, testing, and any future structured use.
        instructional_text:  The final "ghost prompt" — private clinical
                             guidance ready to be stored in
                             session.partner_profile_a/b and injected into
                             build_prompt()'s therapist briefing section.
                             This is the only thing that should ever be
                             persisted or injected — never the raw profile,
                             never raw JSON.
        used_fallback:        True if the LLM failed (network error, malformed
                             output after retry) and a neutral default profile
                             was used instead. Session start is never blocked
                             by this — a low-confidence neutral profile is
                             always available within bounded time.
        privacy_redactions:   List of field names that were redacted because
                             their content was suspiciously similar to the
                             user's actual intake text. Empty in the common case.
    """
    profile:             PartnerProfile
    instructional_text:  str
    used_fallback:        bool
    privacy_redactions:   list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# DEFAULT PROFILE — USED ON TOTAL FAILURE
# ─────────────────────────────────────────────────────────────────────────────

def _default_profile() -> PartnerProfile:
    """
    A safe, neutral profile used when the LLM is unreachable or its output
    cannot be validated after one retry. Confidence is explicitly LOW so
    the formatted instructional text tells Alinda to lean on observed
    session behavior rather than this placeholder.
    """
    return PartnerProfile(
        core_attachment_wound = "not yet determined",
        conflict_posture      = ConflictPosture.MIXED,
        validation_language   = ValidationLanguage.MIXED,
        primary_trigger        = "not yet determined",
        blind_spot              = "not yet determined",
        handling_instructions   = [
            "No reliable pre-session profile is available. "
            "Approach with openness and let early session behavior guide understanding."
        ],
        confidence = ProfileConfidence.LOW,
    )


# ─────────────────────────────────────────────────────────────────────────────
# JSON EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def _extract_json_object(raw: str) -> Optional[dict]:
    """
    Robustly extracts a JSON object from raw LLM output.

    Handles the common failure modes: markdown code fences, a stray
    preamble sentence before the object, trailing commentary after it.
    Returns None if no valid JSON object can be recovered — the caller
    treats this as a failed attempt and proceeds to retry or fallback.
    """
    if not raw:
        return None

    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    start = text.find("{")
    end   = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    candidate = text[start : end + 1]
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _validate_or_none(parsed_dict: Optional[dict]) -> Optional[PartnerProfile]:
    """Attempts Pydantic validation. Returns None on any failure rather than raising."""
    if not parsed_dict:
        return None
    try:
        return PartnerProfile(**parsed_dict)
    except ValidationError as exc:
        logger.debug(f"intake_analyzer: profile validation failed: {exc}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# PRIVACY VERIFICATION — THE ONE-WAY FIREWALL, ENFORCED NOT JUST REQUESTED
#
# Instructing the LLM not to quote is necessary but not sufficient — it's a
# request, not a guarantee. This pass checks every extracted field against
# the user's actual intake text and redacts anything suspiciously close to
# their literal words before it can ever be stored or injected into a prompt.
# ─────────────────────────────────────────────────────────────────────────────

def _similarity(a: str, b: str) -> float:
    """Same SequenceMatcher pattern used in conversation_guardrails.py."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _is_probable_leak(value: str, intake_text_lower: str, sentences: list[str]) -> bool:
    """
    Two-tier leak detection:
        1. Exact substring containment — a hard, high-confidence leak.
        2. Fuzzy similarity against each sentence — catches close paraphrase.

    Skipped entirely for short values, where similarity ratios are
    statistically meaningless and false positives would be common.
    """
    if not value or len(value.split()) < _MIN_LEAK_CHECK_WORDS:
        return False

    if value.lower() in intake_text_lower:
        return True

    for sentence in sentences:
        if len(sentence.split()) < _MIN_LEAK_CHECK_WORDS:
            continue
        if _similarity(value, sentence) >= _LEAK_SIMILARITY_THRESHOLD:
            return True

    return False


def _redact_leaked_fields(
    profile:      PartnerProfile,
    intake_text:  str,
) -> tuple[PartnerProfile, list[str]]:
    """
    Scans every free-text field in the profile against the raw intake text.
    Any field found to be a probable leak is replaced with a safe generic
    value rather than failing the whole profile — one compromised field
    should not discard an otherwise-good profile.

    Returns:
        (cleaned_profile, list_of_redacted_field_names)
    """
    intake_lower = intake_text.lower()
    sentences    = [s.strip() for s in re.split(r"(?<=[.!?])\s+", intake_text) if s.strip()]

    data = profile.model_dump()
    redacted: list[str] = []

    for field_name in ("core_attachment_wound", "primary_trigger", "blind_spot"):
        if _is_probable_leak(data[field_name], intake_lower, sentences):
            redacted.append(field_name)
            data[field_name] = "not specified"

    clean_instructions = []
    for instruction in data["handling_instructions"]:
        if _is_probable_leak(instruction, intake_lower, sentences):
            redacted.append("handling_instructions")
            continue
        clean_instructions.append(instruction)

    data["handling_instructions"] = clean_instructions or [
        "Approach with openness; let session behavior guide understanding."
    ]

    return PartnerProfile(**data), redacted


# ─────────────────────────────────────────────────────────────────────────────
# THE GHOST PROMPT — INSTRUCTIONAL TEXT FORMATTING
#
# Converts a validated PartnerProfile into the private clinical guidance
# that is actually stored and injected. This is the only output of this
# module that ever reaches a prompt or the database — never the raw
# profile object, never raw JSON.
# ─────────────────────────────────────────────────────────────────────────────

_POSTURE_PHRASING: dict[ConflictPosture, str] = {
    ConflictPosture.INTELLECTUALIZING: (
        "tends to intellectualize under conflict, reaching for logic and "
        "explanation before feeling"
    ),
    ConflictPosture.WITHDRAWING: (
        "tends to withdraw under conflict, going quiet rather than engaging directly"
    ),
    ConflictPosture.COUNTER_ATTACKING: (
        "tends to counter-attack under conflict, redirecting toward the other "
        "partner's faults when feeling criticized"
    ),
    ConflictPosture.EMOTIONAL_FLOODING: (
        "tends to become emotionally flooded under conflict, with feeling "
        "arriving faster than it can be organized into words"
    ),
    ConflictPosture.PEOPLE_PLEASING: (
        "tends to over-accommodate under conflict, agreeing or softening before "
        "fully processing their own position"
    ),
    ConflictPosture.MIXED: (
        "does not show one dominant conflict posture from the intake alone — "
        "multiple styles may be present"
    ),
}


def _validation_phrasing(name: str, lang: ValidationLanguage) -> str:
    if lang == ValidationLanguage.COGNITIVE:
        return (
            f"{name} processes most easily through logical structure — offer "
            f"reasoning and clear cause-and-effect before asking them to sit "
            f"with emotion."
        )
    if lang == ValidationLanguage.SOMATIC:
        return (
            f"{name} processes most easily through emotional mirroring — lead "
            f"with feeling language rather than explanation."
        )
    return (
        f"{name} responds to both logical structure and emotional mirroring — "
        f"let their language in the moment guide which to lead with."
    )


def _format_instructional_text(name: str, profile: PartnerProfile) -> str:
    """
    Builds the final clinical guidance string injected into build_prompt()'s
    therapist briefing section, exactly as a human therapist's case notes
    would read — never a transcript, never a quote, always translated.
    """
    lines: list[str] = []

    lines.append(f"{name} {_POSTURE_PHRASING[profile.conflict_posture]}.")
    lines.append(_validation_phrasing(name, profile.validation_language))

    if profile.core_attachment_wound != "not yet determined":
        lines.append(
            f"Their core relational fear appears to centre on "
            f"{profile.core_attachment_wound}. Do not name this directly — "
            f"let it inform tone, not content."
        )

    if profile.primary_trigger != "not yet determined":
        lines.append(f"Defensiveness is most likely triggered by {profile.primary_trigger}.")

    if profile.blind_spot != "not yet determined":
        lines.append(
            f"A tentative observation, held loosely: {profile.blind_spot}. "
            f"Treat this as a hypothesis only — if what you observe in the "
            f"session contradicts it, trust the session over this initial impression."
        )

    if profile.handling_instructions:
        lines.append("Specific guidance:")
        for instruction in profile.handling_instructions:
            lines.append(f"- {instruction}")

    if profile.confidence == ProfileConfidence.LOW:
        lines.append(
            "Note: this initial impression is based on limited intake content. "
            "Weight observed session behavior more heavily than this profile."
        )

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# LLM CALL WRAPPER
# ─────────────────────────────────────────────────────────────────────────────

async def _call_llm_for_profile(name: str, intake_text: str, retry_note: str = "") -> str:
    """One round trip to the background LLM for profile extraction."""
    system_prompt, user_prompt = build_intake_analysis_prompt(name, intake_text)
    if retry_note:
        user_prompt = f"{user_prompt}\n\n{retry_note}"

    return await generate_background_response(
        system_prompt = system_prompt,
        user_prompt    = user_prompt,
        task_label      = f"intake_analysis:{name}",
    )


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PUBLIC FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

async def generate_partner_profile(name: str, intake_text: str) -> IntakeAnalysisResult:
    """
    The primary entry point of this module.

    Pipeline:
        1. Skip the LLM entirely if intake content is too thin to analyze.
        2. Call the LLM, extract and validate JSON. One retry on failure.
        3. On total failure, use a safe neutral default — never blocks session start.
        4. Run the privacy verification pass over every free-text field.
        5. Format the final instructional text.

    Never raises. Always returns a usable IntakeAnalysisResult within bounded
    time and at most two LLM calls.

    Args:
        name:         The partner's display name.
        intake_text:  Their raw intake answers (already validated by
                      schemas.IntakeSubmission at the API boundary — at
                      least 10 characters, at most 8000).

    Returns:
        IntakeAnalysisResult — see dataclass docstring above.
    """
    
    intake_text = (intake_text or "").strip()

    if len(intake_text) < _MIN_INTAKE_LENGTH_FOR_LLM:
        logger.info(
            f"intake_analyzer: intake for '{name}' too short "
            f"({len(intake_text)} chars) — using default profile."
            )
        profile = _default_profile()
        return IntakeAnalysisResult(
            profile             = profile,
            instructional_text  = _format_instructional_text(name, profile),
            used_fallback        = True,
        )

    try:
        raw          = await _call_llm_for_profile(name, intake_text)
        profile       = _validate_or_none(_extract_json_object(raw))

        if profile is None:
            logger.warning(
                f"intake_analyzer: first attempt for '{name}' failed to "
                f"parse/validate. Retrying with stricter instruction."
            )
            raw_retry = await _call_llm_for_profile(
                name, intake_text,
                retry_note=(
                    "Your previous response was not valid JSON. Respond with "
                    "ONLY the JSON object and nothing else — no markdown, no preamble."
                ),
            )
            profile = _validate_or_none(_extract_json_object(raw_retry))

        used_fallback = profile is None
        if profile is None:
            logger.error(
                f"intake_analyzer: both attempts failed for '{name}'. "
                f"Using default neutral profile."
            )
            profile = _default_profile()

        profile, redactions = _redact_leaked_fields(profile, intake_text)
        if redactions:
            logger.warning(
                f"intake_analyzer: redacted {len(redactions)} leaked "
                f"field(s) for '{name}': {redactions}"
            )

        return IntakeAnalysisResult(
            profile             = profile,
            instructional_text  = _format_instructional_text(name, profile),
            used_fallback        = used_fallback,
            privacy_redactions   = redactions,
        )

    except Exception as exc:
        logger.error(
            f"generate_partner_profile crashed unexpectedly for '{name}': {exc}",
            exc_info=True,
        )
        profile = _default_profile()
        return IntakeAnalysisResult(
            profile             = profile,
            instructional_text  = _format_instructional_text(name, profile),
            used_fallback        = True,
        )



async def analyze_both_partners(
    name_a:   str,
    intake_a: str,
    name_b:   str,
    intake_b: str,
) -> tuple[IntakeAnalysisResult, IntakeAnalysisResult]:
    """
    Convenience function for the common case: both partners' intakes are
    ready and need profiling at the same time.

    Runs both profile generations concurrently via asyncio.gather rather
    than sequentially — since the two are entirely independent, this
    roughly halves the wait time the user sees on the "Processing your
    responses..." screen.

    Returns:
        (result_for_partner_a, result_for_partner_b)
    """
    result_a, result_b = await asyncio.gather(
        generate_partner_profile(name_a, intake_a),
        generate_partner_profile(name_b, intake_b),
    )
    return result_a, result_b