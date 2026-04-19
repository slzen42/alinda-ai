from statistics import mean
import re
import random



# LEVEL CLASSIFICATION


def classify_level(score, low=2, medium=5):

    if score <= low:
        return "low"
    elif score <= medium:
        return "medium"
    return "high"



# MOMENTUM CALCULATION


def calculate_momentum(messages):

    if len(messages) < 6:
        return 0

    prev = messages[-6:-3]
    curr = messages[-3:]

    prev_avg = mean([m.extra_data.get("escalation", 0) for m in prev])
    curr_avg = mean([m.extra_data.get("escalation", 0) for m in curr])

    return prev_avg - curr_avg



# FEELING PHRASE EXTRACTION


def extract_feeling_phrase(text):

    text_lower = text.lower()

    patterns = [
        r"i feel (.+)",
        r"i'm feeling (.+)",
        r"i am feeling (.+)",
        r"it feels (.+)",
        r"i feel like (.+)"
    ]

    for pattern in patterns:

        match = re.search(pattern, text_lower)

        if match:
            phrase = match.group(1)
            phrase = phrase.strip(" .!?")
            return phrase

    return None



# ADDRESSING MEDIATOR


def addressing_mediator(text):

    text = text.lower()

    correction_patterns = [
        r"you misunderstood",
        r"you got .* wrong",
        r"that('?s| is) not what i said",
        r"that('?s| is) not what i meant",
        r"i did not say that",
        r"you misinterpreted",
        r"you are misunderstanding"
    ]

    clarification_patterns = [
        r"what did you mean",
        r"why did you say",
        r"can you explain",
        r"what are you saying",
        r"what do you mean"
    ]

    criticism_patterns = [
    r"you are not helping",
    r"this is not helping",
    r"this advice is not useful",
    r"you are making this worse",
    r"offensive way",
    r"that was offensive",
    r"don't appreciate",
    r"i didn't like (the way|how) you",
    r"you shouldn't have said",
    r"that('?s| is) not fair to say",
    r"are you not going to",
    r"aren't you going to",
    r"why aren't you",
    r"why didn't you",
    r"did you not (hear|see|notice)",
    r"are you not (going to|gonna)",
    ]

    for pattern in correction_patterns:
        if re.search(pattern, text):
            return "correction"

    for pattern in clarification_patterns:
        if re.search(pattern, text):
            return "clarification"

    for pattern in criticism_patterns:
        if re.search(pattern, text):
            return "criticism"

    return None



# REFLECTION DETECTION


def is_reflection_attempt(text):

    text = text.lower()

    markers = [
        "you said",
        "you feel",
        "you felt",
        "you mentioned",
        "you told me",
        "i heard you say",
        "what i heard"
    ]

    return any(m in text for m in markers)



# DIRECT ADDRESS TO MEDIATOR


ALINDA_ADDRESS_PATTERNS = [
    r"\balinda\b",
    r"\btalking to you\b",
    r"\basking you\b",
    r"\bwhat do you think\b",
    r"\bhow would you feel\b",
    r"\bwould you feel\b",
    r"\bdo you think\b",
    r"\banswer (me|us)\b",
    r"\bwe want you to\b",
    r"\bjust you\b",
    r"\byou,? not (them|him|her)\b",
    r"\bi('m| am) (talking|speaking) to you\b"
]

def is_addressing_alinda_directly(text):
    text = text.lower()
    return any(re.search(p, text) for p in ALINDA_ADDRESS_PATTERNS)


# REFUSAL DETECTION


REFUSAL_PATTERNS = [
    r"\bi won't\b",
    r"\bi will not\b",
    r"\bi refuse\b",
    r"\bno,? i (won't|will not|don't want to)\b",
    r"\bi('m| am) not going to\b"
]

def is_refusal(text):
    text = text.lower()
    return any(re.search(p, text) for p in REFUSAL_PATTERNS)


# DEMAND DETECTION
# Detects when a partner is making demands rather than expressing feelings


DEMAND_PATTERNS = [
    r"\bi need (them|him|her|sky|cloud) to (apologise|apologize|admit|say|stop|acknowledge)\b",
    r"\bthey (must|have to|need to) (apologise|apologize|admit|say|stop)\b",
    r"\bi want (them|him|her) to (apologise|apologize|admit|say|stop)\b",
    r"\bright (now|this second|this instant|this minute)\b",
    r"\bapologise (now|immediately|right now|this second)\b",
    r"\bapologize (now|immediately|right now|this second)\b",
    r"\bi demand\b",
    r"\bthey owe me\b",
    r"\bi deserve (an apology|to know|an answer|a response)\b",
    r"\btell them to\b",
    r"\bmake them\b",
    r"\bforce them to\b"
]

def is_demand(text):
    text = text.lower()
    return any(re.search(p, text) for p in DEMAND_PATTERNS)



# SUBSTANTIVE MESSAGE DETECTION
# Returns True if message has enough content to explore
# Used by the explore action to avoid firing on one-word replies


def is_substantive_message(text: str) -> bool:
    words = text.strip().split()
    return len(words) >= 6


# COOLDOWN


COOLDOWN_EXERCISES = [
    {"type": "breathing", "message": "Take three slow breaths before continuing."},
    {"type": "reframe", "message": "Try: 'I feel ___ when ___ happens.'"},
    {"type": "reflection", "message": "Tell me what you heard your partner say."}
]

def cooldown_exercise(session):

    index = getattr(session, "cooldown_exercise_index", 0)
    ex = COOLDOWN_EXERCISES[index % len(COOLDOWN_EXERCISES)]
    session.cooldown_exercise_index = index + 1
    return ex



# FALLBACK ROTATION


RESUME_GUIDANCE_TEMPLATES = [
    "I hear what you're saying. {other_name}, how do you feel hearing that?",
    "Thank you for sharing that. {other_name}, what comes up for you?",
    "That's important. {other_name}, what did you understand from that?",
    "I want both of you to feel heard. {other_name}, what would you like them to understand?"
]

def get_resume_guidance_message(other_name, speaker_name, session):

    index = getattr(session, "resume_guidance_index", 0)
    template = RESUME_GUIDANCE_TEMPLATES[index % len(RESUME_GUIDANCE_TEMPLATES)]
    session.resume_guidance_index = index + 1
    return template.format(other_name=other_name, speaker_name=speaker_name)


# HIGH CONFIDENCE REPETITION GUARD
# Prevents the same high confidence action from firing 3+ times consecutively
# Guards run AFTER the decision is made, before returning


def apply_high_confidence_guard(decision, session, other_name, speaker_name):

    if decision.get("confidence") != "high":
        return decision

    action = decision.get("action")

    if session.last_high_confidence_action == action:
        session.high_confidence_streak = getattr(session, "high_confidence_streak", 0) + 1
    else:
        session.high_confidence_streak = 1
        session.last_high_confidence_action = action

    # Safety and refusal actions should never be interrupted
    exempt_actions = {
        "safety_intervention",
        "repair_required",
        "acknowledge_refusal",
        "redirect_demand"
    }

    if session.high_confidence_streak >= 3 and action not in exempt_actions:
        session.high_confidence_streak = 0
        decision["action"] = "resume_guidance"
        decision["confidence"] = "low"
        decision["system_message"] = get_resume_guidance_message(
            other_name, speaker_name, session
        )

        return decision
    
    return decision
    

def build_safety_context(session, sender, escalation_intent, speaker_name, other_name):

    safety_count = getattr(session, "safety_count", 0)
    cooldown_count = getattr(session, "cooldown_count", 0)
    unresolved = getattr(session, "escalation_unresolved", False)

    if escalation_intent == "character_attack":
        if safety_count == 0:
            return f"What feeling is underneath that attack, {speaker_name}?"
        else:
            return f"{speaker_name}, what keeps coming out as an attack on {other_name}?"

    elif escalation_intent == "partner_directed":
        if cooldown_count >= 2 and unresolved:
            return f"What makes it hard to say this without it becoming an attack, {speaker_name}?"
        else:
            return f"{speaker_name}, what did {other_name} do, and how did that make you feel?"

    elif escalation_intent == "situation_directed":
        return f"What feels most stuck for {speaker_name} right now?"

    else:
        return f"What are you feeling right now, {speaker_name}?"
    

# MAIN DECISION ENGINE


def decide_mediation(session, sender, message_text, analysis, recent_messages):

    escalation = classify_level(analysis["escalation"], low=1, medium=3)
    blame = classify_level(analysis["blame"], low=0, medium=2)
    vulnerability = classify_level(analysis["vulnerability"], low=1, medium=3)

    sentiment = analysis.get("sentiment", 0)
    repair_attempt = analysis.get("repair_attempt", 0)
    is_abusive = analysis.get("is_abusive", False)

    momentum = calculate_momentum(recent_messages)
    feeling_phrase = extract_feeling_phrase(message_text)

    other = "b" if sender == "a" else "a"
    other_name = session.name_b if sender == "a" else session.name_a
    speaker_name = session.name_a if sender == "a" else session.name_b

    decision = {
        "mode": session.mode,
        "action": None,
        "target": None,
        "exercise": None,
        "system_message": "",
        "confidence": "low",

        "speaker": sender,
        "quote": message_text,
        "feeling": feeling_phrase
    }

    #  CRISIS DETECTION 
    # Fires before everything else — no exceptions
    # Self-harm signals pause the session entirely
    # Threats of harm to others trigger immediate safety lockdown

    crisis = analysis.get("crisis", "none")

    if crisis == "self_harm":
        decision.update({
            "mode": "crisis_pause",
            "action": "crisis_self_harm",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"{speaker_name}, what you just said matters and I'm not moving past it. "
                f"If you're having thoughts of hurting yourself, please reach out — "
                f"iCall (India): 9152987821 | International Association for Suicide Prevention: https://www.iasp.info/resources/Crisis_Centres/. "
                f"This session is pausing now."
            )
        })
        return decision

    if crisis == "harm_to_other":
        decision.update({
            "mode": "safety_lockdown",
            "action": "safety_intervention",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"{speaker_name}, I need to stop everything right now. "
                f"What you just said is serious. Take a breath — "
                f"tell me what's actually happening for you underneath that."
            )
        })
        return decision

    #  ESCALATION INTENT (ALWAYS FIRST) 
    # Must be computed before any routing decision

    escalation_intent = analysis.get("escalation_intent", "none")

    last_action = getattr(session, "last_action", None)
    escalation_was_attempted = last_action in [
        "deescalate", "cooldown_start", "repair_required", "safety_intervention"
    ]

    if escalation_intent != "none":
        session.last_escalation_type = escalation_intent
        session.escalation_unresolved = True
    else:
        session.escalation_unresolved = False

        #  TURN BALANCE 
    # If one partner has had 4+ consecutive turns, redirect to the other
    # Prevents the explore loop from staying on one person too long

    consecutive_turns = getattr(session, "consecutive_turns", 0)
    last_speaker = getattr(session, "last_speaker", None)

    if last_speaker == sender:
        consecutive_turns += 1
    else:
        consecutive_turns = 1

    session.consecutive_turns = consecutive_turns
    session.last_speaker = sender

    if consecutive_turns >= 4:
        session.consecutive_turns = 0
        decision.update({
            "action": "resume_guidance",
            "target": other,
            "confidence": "low",
            "system_message": get_resume_guidance_message(other_name, speaker_name, session)
        })
        return decision


    #  CHARACTER ATTACK (SAFETY ALWAYS FIRST) 
    # Must fire before mediator addressing — safety overrides everything

    if escalation_intent == "character_attack":

        session.safety_count = getattr(session, "safety_count", 0) + 1

        safety_context = build_safety_context(
            session, sender, escalation_intent, speaker_name, other_name
        )

        decision.update({
            "mode": "safety_lockdown",
            "action": "safety_intervention",
            "target": sender,
            "confidence": "high",
            "system_message": safety_context
        })
        return decision


    #  MEDIATOR ADDRESS 

    intent = addressing_mediator(message_text)

    if intent:
        decision["target"] = sender
        decision["action"] = "acknowledge_mediator"
        decision["confidence"] = "high"

        if intent == "correction":
            decision["system_message"] = "Thank you for correcting me."
        elif intent == "clarification":
            decision["system_message"] = "Let me clarify that."
        else:
            decision["system_message"] = "I hear your concern."

        return decision


    #  DIRECT PERSONAL ADDRESS 

    if is_addressing_alinda_directly(message_text):
        decision.update({
            "action": "acknowledge_mediator",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"I'm here to help you both hear each other — not to share my own feelings. "
                f"Speak only to {speaker_name}. "
                f"Ask them: what were you hoping {other_name} would understand?"
            )
        })
        return decision


    #  REFUSAL TO ENGAGE 

    if is_refusal(message_text):
        decision.update({
            "action": "acknowledge_refusal",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"{speaker_name}, I hear that you're not ready to respond to that. "
                f"Can you tell me what you need right now?"
            )
        })
        return decision


    #  DEMAND DETECTION 

    if is_demand(message_text):
        decision.update({
            "action": "redirect_demand",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"{speaker_name}, I hear that you want something specific from {other_name}. "
                f"Before we get there — what are you feeling right now that's driving that need?"
            )
        })
        return decision


    #  COOLDOWN 
    # Situation-directed frustration or extreme escalation

    if session.mode not in ["cooldown", "safety_lockdown"] and (
        analysis["escalation"] >= 7
        or (escalation_intent == "situation_directed" and analysis["escalation"] >= 4)
    ):
        session.cooldown_count = getattr(session, "cooldown_count", 0) + 1

        ex = cooldown_exercise(session)
        decision.update({
            "mode": "cooldown",
            "action": "cooldown_start",
            "target": sender,
            "confidence": "high",
            "exercise": ex["type"],
            "system_message": ex["message"]
        })
        return decision


    #  DEESCALATE 
    # Partner-directed escalation that isn't a character attack
    # If prior deescalation failed, escalates to safety

    if escalation_intent == "partner_directed" or (
        escalation == "high" and escalation_intent != "none"
    ):
        safety_context = build_safety_context(
            session, sender, escalation_intent, speaker_name, other_name
        )

        if escalation_was_attempted and getattr(session, "escalation_unresolved", False):
            session.safety_count = getattr(session, "safety_count", 0) + 1
            decision.update({
                "mode": "safety_lockdown",
                "action": "safety_intervention",
                "target": sender,
                "confidence": "high",
                "system_message": safety_context
            })
        else:
            decision.update({
                "action": "deescalate",
                "target": sender,
                "confidence": "high",
                "system_message": safety_context
            })

        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  SAFETY LOCKDOWN REPAIR 

    if session.mode == "safety_lockdown":
        if analysis["escalation"] < 3 and escalation_intent == "none":
            decision["mode"] = "guided"
        else:
            safety_context = build_safety_context(
                session, sender, escalation_intent, speaker_name, other_name
            )
            decision.update({
                "action": "repair_required",
                "target": sender,
                "confidence": "high",
                "system_message": safety_context
            })
            return decision


    #  REPAIR 

    if repair_attempt >= 3:
        decision.update({
            "action": "repair_acknowledgement",
            "target": other,
            "confidence": "high",
            "system_message": f"{other_name}, how does it feel hearing that?"
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  REFLECTION (HIGH PRIORITY) 

    if is_reflection_attempt(message_text):
        decision.update({
            "action": "reflect",
            "target": other,
            "confidence": "high",
            "system_message": f"{other_name}, did they understand you correctly?"
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  BLAME 

    if blame in ["medium", "high"]:
        decision.update({
            "action": "reframe",
            "target": sender,
            "confidence": "high",
            "system_message": "Try expressing how you feel instead of blaming."
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  VULNERABILITY 

    if vulnerability == "high":
        decision.update({
            "action": "validate",
            "target": other,
            "confidence": "high",
            "system_message": f"{other_name}, what did you hear them express?"
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  POSITIVE 

    if sentiment >= 3:
        decision.update({
            "action": "affirm_progress",
            "target": other,
            "confidence": "high",
            "system_message": f"{other_name}, how do you feel hearing that?"
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)
    
    #  EXPLORE 
    # Fires for substantive messages with no significant scores
    # Replaces resume_guidance as the intelligent default for normal conversation
    # Keeps the speaker talking rather than immediately redirecting to their partner

    if (
        is_substantive_message(message_text)
        and analysis["escalation"] <= 1
        and analysis["blame"] == 0
        and analysis["vulnerability"] <= 1
        and analysis["toxicity"] == 0
        and repair_attempt == 0
        and escalation_intent == "none"
    ):
        decision.update({
            "action": "explore",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"What's underneath this for {speaker_name} right now? "
            )
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  LOW ESCALATION ACKNOWLEDGEMENT 
    # Catches frustration that scores toxicity but not high enough for cooldown
    # Prevents resume_guidance firing on clearly frustrated messages


    if analysis.get("toxicity", 0) >= 3 and escalation_intent in ["none", "situation_directed"]:
        decision.update({
            "action": "deescalate",
            "target": sender,
            "confidence": "high",
            "system_message": (
                f"Acknowledge {speaker_name}'s frustration without judgment. "
                f"Ask what's underneath it."
            )
        })
        return apply_high_confidence_guard(decision, session, other_name, speaker_name)


    #  FREE CHAT 

    if (
        session.mode == "guided"
        and session.avg_escalation < 3
        and momentum > 0
        and len(recent_messages) >= 4
        and session.message_count >= 8
        and session.last_action != "acknowledge_mediator"
        and not getattr(session, "escalation_unresolved", False)
    ):
        decision.update({
            "mode": "free_chat",
            "action": "free_chat_invite",
            "target": "both",
            "confidence": "low"
        })
        return decision




    #  DEFAULT 

    decision["action"] = "resume_guidance"
    decision["target"] = other
    decision["confidence"] = "low"
    decision["system_message"] = get_resume_guidance_message(other_name, speaker_name, session)

    return decision