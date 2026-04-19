from difflib import SequenceMatcher



# MESSAGE SIMILARITY


def message_similarity(a, b):

    if not a or not b:
        return 0

    # Ignore very short messages (prevents false positives)
    if len(a.split()) < 4 or len(b.split()) < 4:
        return 0

    return SequenceMatcher(None, a.lower(), b.lower()).ratio()



# AGREEMENT DETECTION


AGREEMENT_PHRASES = [
    "me too",
    "i agree",
    "you're right",
    "that makes sense",
    "i understand",
    "i want that too",
    "same here",
    "exactly",
    "that's true"
]


def detect_agreement(text):

    text = text.lower()

    return any(p in text for p in AGREEMENT_PHRASES)



# MAIN GUARDRAIL ENGINE


def stabilize_decision(session, decision, sender, message_text, analysis, recent_messages):

    action = decision.get("action")
    confidence = decision.get("confidence", "low")

    # Agreement detection always runs — strong signal regardless of confidence
    agreement = detect_agreement(message_text)

    if agreement and analysis.get("sentiment", 0) >= 1:
        session.agreement_streak += 1
    else:
        session.agreement_streak = 0

    if session.agreement_streak >= 2:
        decision["action"] = "free_chat_invite"
        decision["mode"] = "free_chat"
        decision["confidence"] = "high"
        session.agreement_streak = 0
        session.last_user_message = message_text
        session.last_skill = "free_chat_invite"
        return decision

    # High confidence decisions pass through untouched
    if confidence == "high":
        session.last_user_message = message_text
        if action:
            session.last_skill = action
        return decision

    
    # GUARDRAIL 2 — SKILL REPETITION (SOFTENED)
    

    if session.last_skill == action:
        session.skill_streak += 1
    else:
        session.skill_streak = 1

    # Only intervene if it's low-confidence AND excessive repetition
    if session.skill_streak >= 3:
        decision["action"] = "resume_guidance"
        decision["confidence"] = "low"
        session.skill_streak = 0


    
    # GUARDRAIL 3 — TOPIC REPETITION (IMPROVED)
    

    similarity = message_similarity(session.last_user_message, message_text)

    if similarity > 0.90:  # stricter threshold
        session.topic_repeat_count += 1
    else:
        session.topic_repeat_count = 0

    if session.topic_repeat_count >= 2:
        decision["action"] = "resume_guidance"
        decision["confidence"] = "low"
        session.topic_repeat_count = 0


    
    # SAVE STATE
    

    session.last_user_message = message_text

    if decision.get("action"):
        session.last_skill = decision.get("action")

    return decision