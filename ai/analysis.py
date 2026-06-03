"""
ai/analysis.py

The message analysis pipeline for Alinda.

Role in the architecture:

    classifier.py           →   What emotion is present, and how intense?
    analysis.py  (this)     →   What does that emotion mean therapeutically?
    mediator_logic.py       →   What should Alinda do about it?

This file sits between the neural model and the decision engine.
Its job is to enrich the classifier's raw emotional scores with structural
signals the transformer cannot see, classify the direction of escalation,
and apply context-aware therapeutic dampening so downstream logic receives
the most accurate picture of what is actually happening in the conversation.

What this file does:
    - Strips quoted speech before analysis to prevent false positives
    - Detects structural signals: CAPS, punctuation intensity, message length
    - Classifies escalation intent: who or what is the emotion directed at?
    - Applies structural boosts the transformer is blind to
    - Applies therapeutic dampening: context reduces noise
    - Returns a complete, enriched analysis dict to mediator_logic.py

What this file does NOT do:
    - Load or manage the ML model (classifier.py owns that)
    - Match regex keyword patterns (archived in archive/keywords_archive.py)
    - Make any mediation decisions (mediator_logic.py owns that)
    - Talk to the database

Public interface:
    from ai.analysis import analyze_message
    result = analyze_message("I feel so ignored right now")
"""

from __future__ import annotations

import logging
import re

from ai.classifier import AlindaClassifier as _AlindaClassifier

_classifier = _AlindaClassifier()

logger = logging.getLogger(__name__)



# ESCALATION INTENT — SUBJECT DETECTION
#
# The transformer tells us WHAT emotion is present.
# This section tells us WHO or WHAT it is directed at.
#
# This is a subject-detection problem, not a semantic one — it requires
# reading the grammatical subject of the escalated language, which is
# something word-boundary pattern matching handles reliably and that
# the transformer does not expose directly.
#
# The distinction matters therapeutically:
#   situation_directed  → validate the frustration, do not treat as an attack
#   partner_directed    → deescalate, separate feeling from attack
#   character_attack    → safety intervention, this is harm
#   self_directed       → vulnerability, not escalation — respond with care
#   none                → no significant escalation detected


_SITUATION_SUBJECTS: list[str] = [
    "this", "it", "that", "everything", "nothing",
    "the conversation", "this conversation", "this session",
    "talking", "all of this", "any of this", "things",
]

_PARTNER_SUBJECTS: list[str] = [
    "you", "your", "they", "them", "their",
    "my partner", "he", "she", "him", "her",
]

# Pre-compile subject patterns with word boundaries.
# Using word boundaries prevents "them" matching inside "together",
# "she" matching inside "otherwise", etc.
_SITUATION_RE = [
    re.compile(rf"\b{re.escape(s)}\b", re.IGNORECASE)
    for s in _SITUATION_SUBJECTS
]
_PARTNER_RE = [
    re.compile(rf"\b{re.escape(s)}\b", re.IGNORECASE)
    for s in _PARTNER_SUBJECTS
]

# Self-directed frustration — someone turning the pain inward.
# Treated as vulnerability by mediator_logic.py, not as escalation.
_SELF_DIRECTED_RE = re.compile(
    r"\bi (can'?t|cannot|give up|hate (this|myself)|hate my life|can'?t do this)\b",
    re.IGNORECASE,
)


def _classify_escalation_intent(text_lower: str, scores: dict) -> str:
    """
    Determines the direction of any escalation present in the message.

    Uses a priority hierarchy:
        1. character_attack — contempt or confirmed toxicity toward a person.
           Always the highest priority because it determines safety routing.
        2. partner_directed — escalated language aimed at the other person.
           Triggers deescalation.
        3. situation_directed — frustration aimed at the situation or session.
           Triggers acknowledgement, not deescalation.
        4. self_directed — pain turned inward.
           Triggers vulnerability response, not escalation response.
        5. none — no meaningful escalation present.

    Args:
        text_lower:  Lowercased, quote-stripped message text.
        scores:      The dict returned by classifier.analyze() — used to
                     check contempt and toxicity rather than re-detecting.

    Returns:
        One of: 'character_attack', 'partner_directed',
                'situation_directed', 'self_directed', 'none'
    """
    # ── Character attack ─────────────────────────────────────────────────────
    # High contempt (disgust + disapproval toward a person) or confirmed toxicity
    # toward someone — this is the crisis tier, handled before everything else.
    contempt   = scores.get("contempt", 0)
    toxicity   = scores.get("toxicity", 0)
    is_abusive = scores.get("is_abusive", False)

    if contempt >= 4 or (toxicity >= 3 and is_abusive):
        return "character_attack"

    # Only classify direction if there is meaningful escalation to classify.
    escalation = scores.get("escalation", 0)
    if escalation < 2:
        return "none"

    # ── Partner-directed ─────────────────────────────────────────────────────
    for pattern in _PARTNER_RE:
        if pattern.search(text_lower):
            return "partner_directed"

    # ── Situation-directed ───────────────────────────────────────────────────
    for pattern in _SITUATION_RE:
        if pattern.search(text_lower):
            return "situation_directed"

    # ── Self-directed ────────────────────────────────────────────────────────
    if _SELF_DIRECTED_RE.search(text_lower):
        return "self_directed"

    # Escalation is present but direction is ambiguous — the LLM will read
    # the raw text and understand nuance. Leave routing to mediator_logic.
    return "none"



# QUOTED SPEECH STRIPPING
#
# Prevents false positives when a partner reports what was said to them.
# "Sky called me stupid" should not score toxicity for 'stupid'.
# "She said 'I hate you' to me" should not trigger crisis detection.
#
# The original text is preserved for display and for the LLM.
# Only the scoring copy is stripped.


_DOUBLE_QUOTED_RE = re.compile(r'"[^"]*"')


def _strip_quoted_speech(text: str) -> str:
    """
    Removes content inside quotation marks from the scoring copy of the text.
    Short single-quoted spans (< 4 chars) are left intact to preserve
    contractions like "can't", "I'm", "she'd".
    """
    text = _DOUBLE_QUOTED_RE.sub("", text)
    return text



# STRUCTURAL SIGNALS
#
# The transformer tokenises text into sub-word tokens.
# It never sees uppercase, punctuation density, or message length
# as distinct features — these are normalised away during tokenisation.
#
# These structural signals are legitimate therapeutic indicators:
#   - ALL CAPS words signal shouting — always an escalation boost
#   - Multiple exclamation marks signal intensity
#   - Very short messages (1-3 words) signal disengagement or shutdown
#
# Captured here, before the neural pass, so they can be applied as
# additive boosts on top of the semantic scores.


_CAPS_WORD_RE  = re.compile(r"\b[A-Z]{2,}\b")  # 2+ consecutive uppercase letters


def _detect_structural_signals(original_text: str) -> dict:
    """
    Extracts formatting signals from the original (unstripped) message text.

    Returns a dict of signal strengths used by _apply_structural_boosts().
    All values are non-negative integers.
    """
    words = original_text.split()
    caps_words = _CAPS_WORD_RE.findall(original_text)

    # Caps intensity:
    #   2+ all-caps words → moderate shout → +2 escalation
    #   5+ all-caps words (full caps rage) → strong shout → +3 escalation
    caps_boost = 0
    if len(caps_words) >= 5:
        caps_boost = 3
    elif len(caps_words) >= 2:
        caps_boost = 2

    # Punctuation intensity — multiple exclamation marks
    exclamation_count = original_text.count("!")
    exclamation_boost = 2 if exclamation_count >= 2 else 0

    # Message length — very short replies often signal resistance or shutdown
    word_count = len(words)

    return {
        "caps_boost":         caps_boost,
        "exclamation_boost":  exclamation_boost,
        "word_count":         word_count,
        "caps_word_count":    len(caps_words),
        "exclamation_count":  exclamation_count,
    }


def _apply_structural_boosts(scores: dict, signals: dict) -> dict:
    """
    Applies structural signal boosts to the neural classifier scores.
    Caps and punctuation intensity can only increase escalation — never
    create blame or vulnerability that the semantic content doesn't warrant.

    Caps intensity also boosts toxicity slightly: shouting an insult is
    more aggressive than typing it quietly.

    All scores are capped at 10 after boosting.
    """
    s = scores.copy()

    caps_boost        = signals["caps_boost"]
    exclamation_boost = signals["exclamation_boost"]

    if caps_boost > 0:
        s["escalation"] = min(10, s["escalation"] + caps_boost)
        # Only boost toxicity if there's already some toxicity signal
        if s["toxicity"] > 0:
            s["toxicity"] = min(10, s["toxicity"] + 1)

    if exclamation_boost > 0:
        s["escalation"] = min(10, s["escalation"] + exclamation_boost)

    # Recompute is_abusive with boosted values
    s["abuse_score"] = min(10, s["toxicity"] + (3 if s["contempt"] >= 4 else 0))
    s["is_abusive"]  = s["abuse_score"] >= 4 or s["crisis"] == "harm_to_other"

    return s



# THERAPEUTIC DAMPENING
#
# Certain emotional contexts naturally reduce the clinical weight of
# escalation and blame signals — not because the feelings aren't real,
# but because the therapeutic response should be different.
#
# Examples:
#   "I feel so scared and alone" — vulnerability present, no blame →
#       escalation dampened: respond with care, not de-escalation
#
#   "I'm sorry, I didn't mean to hurt you" — genuine repair →
#       escalation and blame dampened: acknowledge the repair
#
#   "I love you but I'm so frustrated" — positive + escalation →
#       mild dampening: the love is real, the frustration is real
#
# Dampening is NEVER applied when contempt or toxicity is present.
# Someone crying while insulting their partner is still insulting their partner.


def _apply_therapeutic_dampening(scores: dict) -> dict:
    """
    Applies context-aware reductions to escalation and blame scores.
    Never raises scores — only reduces. Never applies when toxicity or
    contempt is present.
    """
    s = scores.copy()

    # Do not dampen if there is genuine toxicity or contempt
    if s["toxicity"] > 0 or s["contempt"] > 0:
        return s

    # ── Vulnerability dampening ───────────────────────────────────────────────
    # Deep vulnerability with no blame → person is hurting, not attacking
    if s["vulnerability"] >= 4 and s["blame"] == 0:
        s["escalation"] = max(0, s["escalation"] - 2)

    # ── Repair dampening ─────────────────────────────────────────────────────
    # Genuine repair attempt → reduce escalation and blame
    if s["repair_attempt"] >= 4:
        s["escalation"] = max(0, s["escalation"] - 2)
        s["blame"]      = max(0, s["blame"] - 1)

    # ── Positive sentiment dampening ─────────────────────────────────────────
    # Warm, positive content → mild escalation reduction
    if s["sentiment"] >= 3:
        s["escalation"] = max(0, s["escalation"] - 1)

    return s



# PUBLIC INTERFACE


def analyze_message(text: str) -> dict:
    """
    The single public function of this module.

    Takes a raw message string and returns Alinda's complete therapeutic
    analysis — a drop-in replacement for the old regex-based analyze_message.

    Pipeline:
        1. Strip quoted speech from the scoring copy
        2. Detect structural signals (CAPS, punctuation) from original
        3. Run neural classifier on stripped text
        4. Classify escalation intent
        5. Apply structural boosts
        6. Apply therapeutic dampening
        7. Return enriched dict

    The original text is never modified — only the internal scoring copy
    is stripped and lowercased. The LLM always receives the original.

    Args:
        text: Raw message string from the user. Any length — will be
              internally truncated at the classifier's max_length (128 tokens).

    Returns:
        dict with keys:
            escalation      int  0-10  Intensity of escalatory language
            blame           int  0-10  Blame directed at partner
            vulnerability   int  0-10  Emotional openness and pain
            sentiment       int  -5–5  Overall emotional valence
            repair_attempt  int  0-10  Repair and reconciliation signals
            toxicity        int  0-10  Harmful or insulting language
            abuse_score     int  0-10  Combined toxicity + contempt
            is_abusive      bool       Crosses the harm threshold
            contempt        int  0-10  Disgust + disapproval toward partner
            engagement      int  0-10  Active participation vs withdrawal
            crisis          str        'self_harm' | 'harm_to_other' | 'none'
            confidence      str        'high' | 'medium' | 'low'
            escalation_intent str      'character_attack' | 'partner_directed' |
                                       'situation_directed' | 'self_directed' | 'none'
            top_emotions    dict       Top detected GoEmotions labels + confidence
    """
    # ── Guard ─────────────────────────────────────────────────────────────────
    if not text or not text.strip():
        logger.debug("analyze_message received empty text — returning neutral")
        return {
            "escalation":         0,
            "blame":              0,
            "vulnerability":      0,
            "sentiment":          0,
            "repair_attempt":     0,
            "toxicity":           0,
            "abuse_score":        0,
            "is_abusive":         False,
            "contempt":           0,
            "engagement":         0,
            "crisis":             "none",
            "confidence":         "low",
            "escalation_intent":  "none",
            "top_emotions":       {},
        }

    # ── Step 1 — Prepare scoring copy ────────────────────────────────────────
    scoring_text = _strip_quoted_speech(text)
    text_lower   = scoring_text.lower()

    # ── Step 2 — Structural signals from original text ────────────────────────
    # Must run on original (unstripped, case-preserved) text
    signals = _detect_structural_signals(text)

    # ── Step 3 — Neural classification ───────────────────────────────────────
    # classifier.analyze() is the singleton — model is already in RAM.
    # crisis detection already ran inside classify() as a safety net.
    scores = _classifier.analyze(scoring_text)

    # ── Step 4 — Escalation intent ───────────────────────────────────────────
    escalation_intent = _classify_escalation_intent(text_lower, scores)

    # ── Step 5 — Structural boosts ───────────────────────────────────────────
    scores = _apply_structural_boosts(scores, signals)

    # ── Step 6 — Therapeutic dampening ───────────────────────────────────────
    scores = _apply_therapeutic_dampening(scores)

    # ── Step 7 — Assemble final dict ─────────────────────────────────────────
    return {
        "escalation":        scores["escalation"],
        "blame":             scores["blame"],
        "vulnerability":     scores["vulnerability"],
        "sentiment":         scores["sentiment"],
        "repair_attempt":    scores["repair_attempt"],
        "toxicity":          scores["toxicity"],
        "abuse_score":       scores["abuse_score"],
        "is_abusive":        scores["is_abusive"],
        "contempt":          scores["contempt"],
        "engagement":        scores["engagement"],
        "crisis":            scores["crisis"],
        "confidence":        scores["confidence"],
        "escalation_intent": escalation_intent,
        "top_emotions":      scores["top_emotions"],
    }