"""
ai/prompts.py

The complete prompt architecture for Alinda.

This module owns everything related to what Alinda says and how she is
instructed to say it. Nothing in this file makes API calls or touches
the database — it only builds and returns strings.

Structure:
    MODELS          — model identifiers and API configuration
    TEMPERATURES    — per-action temperature settings
    MAX_TOKENS      — per-action token limits
    SYSTEM_PROMPT   — Alinda's core character and philosophy
    ACTION_GUIDANCE — per-action therapeutic direction for the LLM
    build_prompt()  — assembles the full per-message prompt
    INTAKE_PROMPT   — prompt template for pre-session partner profiling
    build_intake_analysis_prompt()  — assembles the intake analysis prompt
    SESSION_SUMMARY_PROMPT          — prompt template for post-session insight
    build_session_summary_prompt()  — assembles the session summary prompt

Usage:
    from ai.prompts import build_prompt, SYSTEM_PROMPT, get_action_guidance
    from ai.prompts import build_intake_analysis_prompt
    from ai.prompts import build_session_summary_prompt
"""

from __future__ import annotations

from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# MODEL CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

# Live session model — used for every real-time mediator response.
# Prioritises speed and warmth. Runs against GROQ_API_KEY_SESSION.
SESSION_MODEL = "llama-3.3-70b-versatile"

# Background task model — used for intake analysis and session summarisation.
# These are not user-facing real-time calls, so a slower model is acceptable.
# Runs against GROQ_API_KEY_BACKGROUND (can be the same key initially).
BACKGROUND_MODEL = "llama-3.3-70b-versatile"

# Context window — number of recent messages passed to the LLM per call.
# 6 messages gives the model enough conversational context without
# inflating the prompt size beyond the point of diminishing returns.
CONTEXT_WINDOW = 6

# ─────────────────────────────────────────────────────────────────────────────
# PER-ACTION TEMPERATURE SETTINGS
#
# Temperature controls how creative vs. predictable the LLM is.
# Lower temperature → more consistent, safer, more predictable language.
# Higher temperature → warmer, more varied, more human-feeling responses.
#
# Safety-critical actions use low temperature — we cannot afford
# the model being creative when someone has just said "I hate you."
# Exploratory actions use higher temperature — warmth and curiosity
# require some variability to avoid sounding scripted.
# ─────────────────────────────────────────────────────────────────────────────

TEMPERATURES: dict[str, float] = {
    # Safety-critical — firm, consistent, no creative deviation
    "safety_intervention":  0.15,
    "crisis_self_harm":     0.10,
    "repair_required":      0.20,
    "cooldown_start":       0.20,

    # Structured therapeutic actions — reliable but human
    "validate":             0.40,
    "reflect":              0.35,
    "reframe":              0.40,
    "deescalate":           0.35,
    "redirect_demand":      0.40,
    "acknowledge_refusal":  0.40,

    # Exploratory and connective actions — warmth matters more than consistency
    "explore":              0.55,
    "affirm_progress":      0.55,
    "repair_acknowledgement": 0.50,
    "resume_guidance":      0.50,
    "acknowledge_mediator": 0.45,

    # Free flow — most natural, most variable
    "free_chat_invite":     0.60,
    "crisis_resume":        0.50,
    "suggest_framework":    0.45,

    # Default for any unlisted action
    "_default":             0.45,
}

# ─────────────────────────────────────────────────────────────────────────────
# PER-ACTION TOKEN LIMITS
#
# Shorter responses are more powerful in therapy.
# The session actions are capped at 150 tokens — roughly 2-3 sentences.
# Safety actions are capped at 90 tokens — firm means brief.
# Background tasks have much higher limits because they need to extract
# structured information from long conversations.
# ─────────────────────────────────────────────────────────────────────────────

MAX_TOKENS: dict[str, int] = {
    # Safety — brevity is firmness
    "safety_intervention":  80,
    "crisis_self_harm":     100,
    "repair_required":      90,
    "cooldown_start":       80,

    # Standard session actions
    "validate":             120,
    "reflect":              110,
    "reframe":              120,
    "deescalate":           130,
    "explore":              120,
    "affirm_progress":      130,
    "repair_acknowledgement": 130,
    "resume_guidance":      140,
    "redirect_demand":      130,
    "acknowledge_refusal":  130,
    "acknowledge_mediator": 120,
    "free_chat_invite":     140,
    "crisis_resume":        150,
    "suggest_framework":    200,  # Needs space for a concrete plan

    # Background tasks — need room to think
    "_intake_analysis":     800,
    "_session_summary":     1200,

    # Default
    "_default":             150,
}


def get_temperature(action: str) -> float:
    """Returns the temperature for a given action, falling back to default."""
    return TEMPERATURES.get(action, TEMPERATURES["_default"])


def get_max_tokens(action: str) -> int:
    """Returns the max tokens for a given action, falling back to default."""
    return MAX_TOKENS.get(action, MAX_TOKENS["_default"])

# In ai/prompts.py, new constant near _STYLE_GUIDANCE:

_MISMATCH_ACKNOWLEDGMENT_TEMPLATE = (
    "{name_a} and {name_b} arrived today wanting slightly different things "
    "from this space — one leaning toward {style_a}, the other toward "
    "{style_b}. Acknowledge this directly and warmly in your opening, in one "
    "sentence, before inviting {name_a} to begin. Do not make it sound like "
    "a problem to solve — frame it as something you will hold space for."
)


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT
#
# This is Alinda's identity, voice, and therapeutic philosophy.
# It is sent as the system role on every single session API call.
# It must be:
#   - Short enough not to consume excessive context window
#   - Rich enough to establish a consistent, human therapeutic voice
#   - Specific enough to prevent the LLM from defaulting to generic AI behaviour
#   - Flexible enough to work across all session states and emotional registers
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are Alinda, a couples mediator. You have the warmth, skill, and presence \
of an experienced therapist who has sat with a great deal of human pain.

You are not a chatbot. You are not performing empathy. You are genuinely \
curious about what is happening between these two people, and your entire \
purpose is to help each of them feel understood — and through that, to help \
them understand each other.

YOUR VOICE
Warm, unhurried, and direct. You speak simply, with no clinical language or \
jargon. You sound like someone who is not frightened by difficult feelings \
and does not rush to resolve them.

THERAPEUTIC INSTINCTS
When someone attacks their partner, look for the pain driving the attack. \
Name the pain, not the attack. Never repeat or reference the attacking words.
When someone resists, be curious about the resistance — it usually contains \
something important.
When something true surfaces, slow down and stay with it.
When one partner shares something vulnerable, turn to the other and ask what \
they heard — not what they think about it.
When someone makes a repair — apologises, softens, reaches toward the other — \
name it and give it space.
When you sense contempt rather than anger, name the disconnection gently. \
Contempt is a signal that someone feels unseen for a long time.
When someone stonewalls or deflects, do not push them. Ask what would help \
them feel safe enough to continue.
When both partners seem to be moving toward each other, acknowledge it and \
let them lead.

PARTICIPATION BALANCE — THIS IS CRITICAL
You are in a conversation with TWO people. If you have spoken to the same \
person twice in a row, you MUST turn to the other person next. No exceptions. \
One partner sitting silently while you question the other is not therapy — it \
is an interrogation. The silent partner's experience matters equally.

ON MIRRORING
Reflecting a person's exact words can be powerful — it helps them hear what \
they just said. Do this sparingly and with intention. Mirror a single word or \
phrase, never a full sentence. Never mirror language that attacks or demeans \
the other partner.

RESPONSE FORMAT
1-2 sentences only. Never more.
Ask one question at a time. A second question dilutes the first.
Address the person by name once per response, naturally.
Do not summarise. Do not explain. Do not give advice.
Never say: "it seems", "it appears", "you might", "I understand that".
Never take sides.
Only output Alinda's spoken words. Nothing else.
"""


# ─────────────────────────────────────────────────────────────────────────────
# ACTION GUIDANCE
#
# Per-action instructions that tell the LLM exactly what therapeutic goal
# to pursue in this specific moment. These are injected into the prompt as
# the "Therapeutic direction" section.
#
# Each entry answers the question: given that this action fired, what
# specifically should Alinda do right now?
#
# Style guide for writing action guidance:
#   - Write in the second person imperative ("Ask", "Name", "Turn to")
#   - Be specific about what NOT to do when the failure mode is common
#   - Keep it under 4 sentences — the LLM does not need an essay
#   - Match the emotional register of the action (firm for safety, warm for repair)
# ─────────────────────────────────────────────────────────────────────────────

_ACTION_GUIDANCE: dict[str, str] = {

    "explore": (
        "The speaker just shared something worth staying with. "
        "Ask one specific question about what they said — the feeling behind it, "
        "or what it meant to them in that moment. "
        "Do not ask about the other person. Do not redirect yet. "
        "Stay with this person for exactly one question, then the turn moves."
    ),

    "validate": (
        "Something vulnerable was just shared. "
        "Turn to the other partner and ask what they heard — "
        "just what they heard, not what they think about it, not whether they agree."
    ),

    "reflect": (
        "One partner just tried to reflect what they heard. "
        "Ask the original speaker simply and gently: did that feel accurate?"
    ),

    "reframe": (
        "The focus has shifted to what the other person did wrong. "
        "Gently bring it back to what this person is feeling. "
        "Not as a correction — out of genuine curiosity about what is underneath. "
        "Ask about the feeling, not the behaviour."
    ),

    "deescalate": (
        "Something intense just happened. "
        "The context below has more detail about this specific moment. "
        "Do not reference the attacking words. "
        "Speak to the pain or frustration driving them. "
        "Be warm but steady. One grounded question."
    ),

    "affirm_progress": (
        "Something genuinely constructive just happened in this conversation. "
        "Acknowledge it briefly — one sentence naming what shifted. "
        "Then ask the other partner how it feels to hear that."
    ),

    "repair_acknowledgement": (
        "One partner just reached toward the other — an apology, a softening, "
        "an acknowledgement. "
        "Turn to the other partner and ask simply: how does that land for you?"
    ),

    "resume_guidance": (
        "Help this person say what they most need their partner to understand "
        "right now. "
        "Ask one direct question. Do not summarise what has been said."
    ),

    "free_chat_invite": (
        "The tension has eased and both partners seem to be moving toward each other. "
        "Invite them to speak directly to each other. "
        "Stay present but step back — you are no longer leading."
    ),

    "cooldown_start": (
        "The conversation needs to pause. "
        "Tell them clearly that you are going to give everyone a moment. "
        "Do not instruct them to breathe or calm down — that is patronising. "
        "Simply name that things got very intense and offer a moment of silence. "
        "One sentence. Then wait."
    ),

    "safety_intervention": (
        "A personal attack just occurred. "
        "The context below has more detail. "
        "Be firm and human — not punishing. "
        "Do not repeat or reference the harmful words. "
        "Speak to what is happening emotionally for this person and name clearly "
        "that this space requires a different way of expressing it."
    ),

    "crisis_self_harm": (
        "Someone just expressed thoughts of self-harm. "
        "Do not treat this as part of the mediation. "
        "Respond with warmth and directness. "
        "Acknowledge that you heard them. "
        "Provide the crisis resource clearly. "
        "Explain that the session is pausing. "
        "Do not ask a follow-up question. Do not redirect to the other partner."
    ),

    "repair_required": (
        "The session is paused because of how something was said. "
        "Ask this person to try saying what they feel — "
        "not what they think of the other person. "
        "Be clear but not harsh."
    ),

    "acknowledge_mediator": (
        "This person is addressing you directly. "
        "Respond briefly and honestly in one sentence. "
        "Then ask them what they want the other person to understand."
    ),

    "acknowledge_refusal": (
        "This person is not ready to engage. "
        "Do not push. "
        "Ask what is making it hard, or what they need to feel ready."
    ),

    "redirect_demand": (
        "A demand is being made. "
        "Do not engage the demand itself. "
        "Look past it and ask about the feeling driving it."
    ),

    "crisis_resume": (
        "The session is resuming after a serious pause. "
        "The context below says who needs to be addressed and what happened. "
        "Be gentle and unhurried. "
        "Acknowledge that things got very heavy without referencing the specific words. "
        "Open a small door back into the conversation — do not push anyone through it."
    ),

    "suggest_framework": (
        "Both partners seem to have reached a moment of mutual understanding. "
        "Help them name one concrete, specific commitment for the coming week. "
        "Not a general intention — a specific action with a time and a context. "
        "Ask them together: what is one thing you could both commit to before you meet again?"
    ),

    "idle_redirect": (
        "One partner appears to be occupied or away from the conversation. "
        "Acknowledge this warmly and without judgement. "
        "Turn to the other partner and invite them to share something "
        "while they wait — what they are feeling in this moment, or what "
        "they most want their partner to understand when they return."
    ),
}


def get_action_guidance(action: str) -> str:
    """
    Returns the therapeutic direction string for a given action.
    Falls back to a generic guidance string for unknown actions.
    """
    return _ACTION_GUIDANCE.get(
        action,
        "Help this person say what they most need their partner to hear."
    )


# ─────────────────────────────────────────────────────────────────────────────
# SESSION PROMPT BUILDER
#
# Assembles the complete per-message prompt from all available context.
# This is the prompt sent to the LLM for every real-time session message.
#
# The prompt is structured so the most important information is at the top
# and the instructions are at the bottom — LLMs attend more to the end
# of long prompts, so the instruction to "respond as Alinda" is the last
# thing the model reads before generating.
# ─────────────────────────────────────────────────────────────────────────────

def build_prompt(
    name_a: str,
    name_b: str,
    decision: dict,
    recent_messages: list,
    partner_profile_a: Optional[str] = None,
    partner_profile_b: Optional[str] = None,
    session_insight: Optional[str] = None,
) -> str:
    """
    Assembles the complete prompt for a live session message.

    Args:
        name_a:             Partner A's name.
        name_b:             Partner B's name.
        decision:           The decision dict from mediator_logic.decide_mediation().
                            Expected keys: speaker, quote, feeling, action,
                            target, system_message, confidence.
        recent_messages:    List of recent ChatMessage ORM objects (last N messages).
                            Used to build the conversation context section.
        partner_profile_a:  Optional. Pre-session profile for Partner A generated
                            by intake_analyzer.py. Injected as therapist briefing.
        partner_profile_b:  Optional. Pre-session profile for Partner B.
        session_insight:    Optional. Summary from the previous session generated
                            by session_summarizer.py. Injected as therapist briefing.

    Returns:
        A complete prompt string ready to be sent as the user-role message
        in the Groq API call.
    """

    speaker         = decision.get("speaker", "a")
    quote           = decision.get("quote", "")
    feeling         = decision.get("feeling")
    action          = decision.get("action", "resume_guidance")
    target          = decision.get("target", "both")
    system_message  = decision.get("system_message", "")

    speaker_name = name_a if speaker == "a" else name_b

    if target == "a":
        target_name = name_a
    elif target == "b":
        target_name = name_b
    else:
        target_name = f"{name_a} and {name_b}"

    action_guidance  = get_action_guidance(action)

    # ── Conversation context ─────────────────────────────────────────────────
    context_lines: list[str] = []
    for msg in recent_messages[-(CONTEXT_WINDOW):]:
        msg_sender  = getattr(msg, "sender", "")
        msg_content = getattr(msg, "content", "")
        if msg_sender == "a":
            context_lines.append(f"{name_a}: {msg_content}")
        elif msg_sender == "b":
            context_lines.append(f"{name_b}: {msg_content}")
        elif msg_sender == "ai":
            context_lines.append(f"Alinda: {msg_content}")
    context_block = "\n".join(context_lines) if context_lines else "(Session just started)"

    # ── Therapist briefing (private — not shown to partners) ─────────────────
    # This section gives Alinda context that a human therapist would have
    # from reading case notes before the session begins.
    briefing_lines: list[str] = []

    if session_insight:
        briefing_lines.append(f"Prior session summary:\n{session_insight.strip()}")

    if partner_profile_a:
        briefing_lines.append(f"{name_a}'s profile:\n{partner_profile_a.strip()}")

    if partner_profile_b:
        briefing_lines.append(f"{name_b}'s profile:\n{partner_profile_b.strip()}")

    briefing_block = ""
    if briefing_lines:
        briefing_block = (
            "\n---\nTHERAPIST BRIEFING (private — do not reference directly):\n"
            + "\n\n".join(briefing_lines)
            + "\n---\n"
        )

    # ── Feeling context ───────────────────────────────────────────────────────
    feeling_line = f'They said they feel "{feeling}".\n' if feeling else ""

    # ── Therapeutic context ───────────────────────────────────────────────────
    # The system_message from mediator_logic contains contextual guidance
    # built by build_safety_context() or the fallback rotation templates.
    # It is phrased as a directive to the LLM, not as content to reproduce.
    therapeutic_line = (
        f"\nContext for this moment (follow this, do not repeat it):\n{system_message}\n"
        if system_message else ""
    )

    # ── Assemble ─────────────────────────────────────────────────────────────
    prompt = f"""\
A mediation session is in progress between {name_a} and {name_b}.
{briefing_block}
Recent conversation:
{context_block}

---

{speaker_name} just said:
"{quote}"

{feeling_line}{therapeutic_line}
Therapeutic direction:
{action_guidance}

Respond to: {target_name}

Respond as Alinda. Warm, direct, human. 1-2 sentences only.\
"""

    return prompt


# ─────────────────────────────────────────────────────────────────────────────
# INTAKE ANALYSIS PROMPT
#
# Used by ai/intake_analyzer.py to extract a structured, validated psychological
# profile from a partner's intake answers, output as strict JSON.
#
# This prompt runs once per partner when both intakes are submitted.
# intake_analyzer.py parses the JSON, validates it against the PartnerProfile
# schema, and converts it into private instructional text — never raw JSON,
# never a biography — stored as session.partner_profile_a / partner_profile_b
# and injected into every subsequent session prompt via build_prompt().
# ─────────────────────────────────────────────────────────────────────────────

_INTAKE_SYSTEM_PROMPT = """\
You are a clinical psychologist analyzing one partner's pre-session intake \
responses before a couples therapy session begins.

Your output will become private behavioral guidance for the therapist. It will \
NEVER be shown to this person or their partner. For that reason, you must NEVER \
quote, closely paraphrase, or reference specific events, names, or details from \
their answers. Translate everything into behavioral and psychological patterns, \
not historical facts.

Be precise, clinically grounded, and compassionate — never judgmental, even when \
describing a defensive pattern. Respond with ONLY a valid JSON object. No markdown \
code fences. No preamble or closing remarks. No text before or after the JSON.
"""

_INTAKE_USER_TEMPLATE = """\
Partner name: {name}

Intake answers:
{intake_text}

Respond with ONLY a JSON object in exactly this structure:

{{
  "core_attachment_wound": "<one short phrase: their primary relational fear, e.g. 'fear of abandonment' or 'fear of being controlled' — never quote their words>",
  "conflict_posture": "<exactly one of: intellectualizing | withdrawing | counter_attacking | emotional_flooding | people_pleasing | mixed>",
  "validation_language": "<exactly one of: cognitive | somatic | mixed>",
  "primary_trigger": "<one short phrase describing what tends to trigger their defensiveness, written as a behavioral pattern, never a quote>",
  "blind_spot": "<one gentle, tentative phrase about a perspective they may not have fully considered about their own contribution to the dynamic — phrase with compassion, never as a verdict>",
  "handling_instructions": ["<2 to 4 short, direct, actionable instructions for how a therapist should approach this specific person>"],
  "confidence": "<exactly one of: high | medium | low — how strongly the intake content actually supports this profile>"
}}
"""


def build_intake_analysis_prompt(name: str, intake_text: str) -> tuple[str, str]:
    """
    Builds the system and user prompts for structured intake analysis.

    Args:
        name:         Partner's name.
        intake_text:  The combined intake answers submitted during session setup.

    Returns:
        A tuple of (system_prompt, user_prompt) ready to be sent as
        separate roles in the Groq API call using the background model.
    """
    user_prompt = _INTAKE_USER_TEMPLATE.format(
        name=name,
        intake_text=intake_text.strip(),
    )
    return _INTAKE_SYSTEM_PROMPT, user_prompt


# ─────────────────────────────────────────────────────────────────────────────
# SESSION SUMMARY PROMPT
#
# Used by session_summarizer.py to extract therapeutic insights from a
# completed session. The output is stored as a SessionInsight row and
# injected into the next session's build_prompt() as therapist briefing.
#
# This prompt has access to the full conversation and must extract:
#   - Key themes and patterns
#   - Breakthrough moments worth remembering
#   - Unresolved threads to follow up on
#   - Each partner's emotional arc
#   - One concrete commitment if one was made
# ─────────────────────────────────────────────────────────────────────────────

_SUMMARY_SYSTEM_PROMPT = """\
You are a clinical psychologist writing session notes after a couples therapy session. \
Your notes will be read at the start of the next session to help the therapist \
understand what happened and what needs follow-up.

You may be given private clinical signals — computed behavioral patterns and a \
candidate systemic dynamic — to inform your understanding of what occurred. \
These are for your interpretation only. NEVER write a number, percentage, ratio, \
or internal label (such as "flooding_tendency" or "trait probability") anywhere \
in your notes. Translate everything into plain clinical language a human \
reader would recognise.

Be precise and clinically useful. Write only what the conversation actually shows. \
Do not moralise or take sides. Write in the third person.
"""

_SUMMARY_USER_TEMPLATE = """\
Partner A: {name_a}
Partner B: {name_b}
Session duration: {duration_minutes} minutes
{ended_by_time_limit_line}
{behavioral_context_block}
{pattern_hint_block}
Full conversation:
{conversation_text}

Write session notes in exactly this format:

KEY THEMES:
(2-3 themes that kept surfacing across this session.)

BREAKTHROUGH MOMENTS:
(1-2 specific exchanges where something important shifted — quote the exact words \
if possible.)

UNRESOLVED THREADS:
(What was left unaddressed or was avoided? What should the next session return to? \
If the session ended because time ran out rather than because the conversation \
reached a natural close, say so explicitly and name exactly where it was cut off.)

{name_a}'s EMOTIONAL ARC:
(How did their emotional state change from the start to the end of the session? \
Include what seemed to trigger defensiveness or withdrawal in them specifically, \
and any structural pattern in how they communicate — for example, tending to \
flood with words when anxious, or going quiet when criticised.)

{name_b}'s EMOTIONAL ARC:
(Same instructions for partner B.)

RELATIONSHIP DYNAMIC OBSERVED:
(Describe the recurring dance between them under stress. If a candidate dynamic \
is suggested above, confirm it in your own words if the transcript supports it, \
refine it, or say plainly if it does not fit what you read.)

CONCRETE COMMITMENT:
(If a specific commitment was made, state it precisely. \
If none was made, write: None recorded.)

RECOMMENDED FOCUS FOR NEXT SESSION:
(One sentence on what the therapist should prioritise next time.)
"""


def build_session_summary_prompt(
    name_a: str,
    name_b: str,
    conversation_text: str,
    duration_minutes: int,
    behavioral_context: Optional[str] = None,
    pattern_hint: Optional[str] = None,
    ended_by_time_limit: bool = False,
) -> tuple[str, str]:
    """
    Builds the system and user prompts for post-session summarisation.

    Args:
        name_a:               Partner A's name.
        name_b:                Partner B's name.
        conversation_text:    The full conversation formatted as a readable transcript.
        duration_minutes:     How long the session ran.
        behavioral_context:   Optional narrative-phrased summary of computed metrics
                              (word balance, escalation timing, repair efficacy).
                              Generated by session_summarizer._format_behavioral_context().
                              Never contains raw numbers in a leakable format.
        pattern_hint:          Optional candidate systemic pattern detected from the
                              behavioral ledgers (e.g. pursuer-distancer). The LLM is
                              asked to confirm, refine, or reject it against the transcript.
        ended_by_time_limit:   Whether the session was cut off by the time limit
                              rather than reaching a natural close.

    Returns:
        A tuple of (system_prompt, user_prompt).
    """
    ended_by_time_limit_line = (
        "Note: this session ended because the time limit was reached, not because "
        "the conversation reached a natural stopping point.\n"
        if ended_by_time_limit else ""
    )

    behavioral_context_block = (
        f"Private context on how the conversation unfolded: {behavioral_context}\n"
        if behavioral_context else ""
    )

    pattern_hint_block = (
        f"A computed signal suggests: {pattern_hint}. "
        f"Confirm, refine, or reject this based on what you actually read.\n"
        if pattern_hint else ""
    )

    user_prompt = _SUMMARY_USER_TEMPLATE.format(
        name_a=name_a,
        name_b=name_b,
        duration_minutes=duration_minutes,
        ended_by_time_limit_line=ended_by_time_limit_line,
        behavioral_context_block=behavioral_context_block,
        pattern_hint_block=pattern_hint_block,
        conversation_text=conversation_text.strip(),
    )
    return _SUMMARY_SYSTEM_PROMPT, user_prompt