# ai/conversation_state_controller.py

import re


# EMOTION SIGNALS


EMOTION_WORDS = {
    "hurt", "sad", "lonely", "angry", "upset", "frustrated",
    "overwhelmed", "ignored", "tired", "scared", "empty"
}


def contains_emotion(words):
    return any(word in EMOTION_WORDS for word in words)



# HEURISTICS ENGINE


def is_low_effort_response(text: str) -> bool:

    cleaned_text = re.sub(r"[^\w\s]", "", text.lower().strip())
    words = cleaned_text.split()

    if len(words) <= 3 and not contains_emotion(words):
        return True

    dismissive_phrases = [
        "i guess so",
        "sure whatever",
        "if you say so",
        "i dont know"
    ]

    if any(phrase in cleaned_text for phrase in dismissive_phrases):
        return True

    return False


def get_partner(speaker: str) -> str:
    if speaker == "a":
        return "b"
    if speaker == "b":
        return "a"
    return "both"



# STAGE MAPPING


STAGE_MAP = {
    "validate": "validation",
    "reflect": "acknowledgement",
    "prompt_partner": "response",
    "repair_acknowledgement": "repair",
    "cooldown_start": "cooldown",
    "resume_guidance": "guidance",
    "free_chat_invite": "free_flow",
    "redirect_demand": "demand_redirect",
    "explore": "exploration"
}



# CONTROLLER


def adjust_decision(session, sender, message_text, decision):

    proposed_action = decision.get("action")
    proposed_target = decision.get("target")
    confidence = decision.get("confidence", "low")  # NEW

    action_streak = getattr(session, "action_streak", 0)
    last_action = getattr(session, "last_action", None)

    target_streak = getattr(session, "target_streak", 0)
    last_target = getattr(session, "last_target", None)

    short_reply_streak = getattr(session, "short_reply_streak", 0)

    
    # RULE 1 — DO NOT TOUCH HIGH CONFIDENCE DECISIONS
    

    if confidence == "high":
        session.last_action = proposed_action
        session.last_target = proposed_target
        session.action_streak = 1 # reset - high confidence is intentional, not a loop
        session.target_streak = 1 # reset - targeting is intentional

        session.short_reply_streak = 0 # reset - high confidence breaks stagnation
        return decision


    
    # ACTION STREAK TRACKING
    

    if proposed_action == last_action:
        action_streak += 1
    else:
        action_streak = 1


    
    # LOW EFFORT DETECTION
    

    is_short = is_low_effort_response(message_text)

    if is_short:
        short_reply_streak += 1
    else:
        short_reply_streak = 0


    
    # GUARDRAIL 1: LOW-EFFORT PIVOT (SAFE ONLY)
    

    if is_short:

        if last_action == "reflect":
            decision["action"] = "prompt_partner"
            decision["target"] = get_partner(sender)

        elif last_action == "validate":
            decision["action"] = "resume_guidance"
            decision["target"] = sender


    
    # GUARDRAIL 2: ANTI-LOOP (LOW CONFIDENCE ONLY)
    

    if action_streak >= 4:

        if proposed_action in ["validate", "reflect"]:
            decision["action"] = "free_chat_invite"
            decision["target"] = "both"

        elif proposed_action == "repair_required":
            decision["action"] = "resume_guidance"
            decision["target"] = "both"


    
    # GUARDRAIL 3: TARGET LOCK PREVENTION (KEEP)
    

    if proposed_target == last_target and proposed_target in ["a", "b"]:
        target_streak += 1
    else:
        target_streak = 1

    if target_streak >= 4:

        decision["target"] = get_partner(proposed_target)

        if proposed_action not in ["validate", "resume_guidance"]:
            decision["action"] = "resume_guidance"


    
    # GUARDRAIL 4: STAGNATION
    

    if short_reply_streak >= 3:

        decision["action"] = "resume_guidance"
        decision["target"] = "both"
        short_reply_streak = 0


    
    # STATE COMMIT
    

    final_action = decision["action"]

    session.dialogue_stage = STAGE_MAP.get(final_action, "analysis")

    session.last_action = final_action
    session.last_target = decision["target"]

    session.action_streak = action_streak if final_action == proposed_action else 1
    session.target_streak = target_streak if decision["target"] == proposed_target else 1

    session.short_reply_streak = short_reply_streak

    return decision