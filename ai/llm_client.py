import httpx
import re
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")



# GROQ CONFIG




GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY is not set. LLM calls will fail. ")
MODEL_NAME = "llama-3.3-70b-versatile"



# RESPONSE SANITIZER


def sanitize_response(text: str):

    text = re.sub(
        r"^(alinda|mediator|ai|\[alinda\]|\[mediator\]):\s*",
        "",
        text,
        flags=re.IGNORECASE
    )

    text = re.sub(r"\bboth of us\b", "both of you", text, flags=re.IGNORECASE)
    text = re.sub(r"\bwe should\b", "you might consider", text, flags=re.IGNORECASE)
    text = re.sub(r"\blet's\b", "you could", text, flags=re.IGNORECASE)

    text = re.sub(r'(^\s*[a-z])', lambda m: m.group(1).upper(), text)
    text = re.sub(r'([.!?]\s+)([a-z])', lambda m: m.group(1) + m.group(2).upper(), text)

    # Add question mark to sentences that are questions but missing punctuation
    if text and not text[-1] in '.?!':
        question_starters = (
            'what ', 'how ', 'why ', 'when ', 'where ', 'who ',
            'can you', 'could you', 'do you', 'did you',
            'is there', 'are you', 'was it', 'will you',
            'have you', 'would you', 'is it', 'does it'
        )
        if text.lower().startswith(question_starters):
            text = text + '?'

    return text.strip()




# GENERATION CLEANER


def clean_generation(text: str):
    text = text.split("##")[0]
    text = text.split("Instruction")[0]
    text = text.split("User:")[0]
    text = text.split("Assistant:")[0]
    return text.strip()



# ACTION GUIDANCE


def get_action_guidance(action):

    guidance = {

        "explore":
        "Something worth staying with just surfaced. "
        "Ask one question that helps this person go deeper into what they just shared — "
        "the feeling behind it, or what it means to them. Stay with this person for now.",

        "repair_acknowledgement":
        "One partner just reached toward the other — an apology or a softening. "
        "Turn to the other partner and ask simply how that lands for them.",

        "validate":
        "Something vulnerable was just shared. "
        "Turn to the other partner and ask what they heard — "
        "just what they heard, not what they think about it.",

        "reflect":
        "One partner just tried to reflect what they heard. "
        "Ask the original speaker whether that felt right.",

        "reframe":
        "The focus has shifted to what the other person did wrong. "
        "Gently bring it back to what this person is feeling — "
        "not as a correction, but out of genuine curiosity about what's underneath.",

        "free_chat_invite":
        "The tension has eased. Invite them to speak directly to each other.",

        "resume_guidance":
        "Help this person articulate what they most need their partner to understand right now.",

        "deescalate":
        "Something intense just happened. The context below has more detail. "
        "Don't reference the attacking words — speak to the pain or frustration driving them. "
        "Be warm but steady. One grounded question.",

        "affirm_progress":
        "Something genuinely good just happened in this conversation. "
        "Acknowledge it briefly and ask the other how it feels to hear that.",

        "cooldown_start":
        "This conversation needs a pause. "
        "Ask them to stop for a moment and give them one simple, concrete thing to do.",

        "safety_intervention":
        "Someone just crossed a line with their words. The context below has more detail. "
        "Be firm and human — not punishing. "
        "Don't repeat or reference the harmful words. "
        "Speak to what's happening emotionally for this person and name clearly "
        "that this space requires a different way of expressing it.",

        "repair_required":
        "The session is paused. "
        "Ask this person to try saying what they feel — "
        "not what they think about the other person.",

        "acknowledge_mediator":
        "This person is talking to you directly. "
        "Respond briefly and honestly. Then bring the conversation back to what matters.",

        "acknowledge_refusal":
        "This person isn't ready to engage. "
        "Don't push. Ask what's making it hard, or what they need to feel ready.",

        "redirect_demand":
        "A demand is being made. "
        "Look past the demand to what's driving it — "
        "ask about the feeling underneath, not the request itself.",

        "crisis_self_harm":
        "Someone just expressed thoughts of self-harm. "
        "Do not treat this as part of the mediation. "
        "Respond with warmth and directness — acknowledge that you heard them, "
        "provide a crisis resource clearly, and explain that the session is pausing. "
        "Do not ask a follow-up question. Do not redirect to the other partner.",


        "crisis_resume":
        "The session is resuming after a serious pause. "
        "The system_message has context about who needs to be addressed. "
        "Be gentle and unhurried. Acknowledge that things got very heavy, "
        "without referencing the specific words that were said. "
        "Open a small door — don't push anyone through it.",
    }


    return guidance.get(action, "Help this person say what they most need their partner to hear.")




# SYSTEM PROMPT




SYSTEM_PROMPT = """
You are Alinda, a couples mediator. You have the warmth, skill, and presence of an experienced therapist.

You are sitting with two real people who are struggling to understand each other. Your entire purpose is to help each of them feel genuinely heard — and through that, to help them hear each other.

YOUR VOICE:
Warm, unhurried, and direct. You don't perform empathy — you're actually curious. 
You speak simply. You never use clinical language or therapeutic jargon.
You sound like a wise person who has sat with a lot of human pain and isn't frightened by it.

HOW YOU RESPOND:
- Keep responses to 1-2 sentences. Brevity creates space for the other person to speak.
- Ask one question at a time. A second question dilutes the first.
- Address the person by name once per response, naturally — not at the start of every sentence.
- Respond to what someone means, not just what they said.

ON MIRRORING:
Sometimes reflecting a person's exact words back to them is powerful — it helps them hear what they just said.
Do this sparingly and with intention. When you do mirror, isolate the specific word or phrase that carries the most emotional weight — not the whole sentence.
Never mirror language that attacks or demeans the other partner. When someone uses a hurtful word about their partner, respond to the emotion driving it, not the word itself.

WHAT YOU NEVER DO:
- Give advice or tell people what they should do.
- Explain one partner's behaviour to the other.
- Take sides, even subtly.
- Rush past something important to get to the next topic.
- Ask two questions in one response.

YOUR THERAPEUTIC INSTINCTS:
When someone attacks their partner, look for the pain underneath the attack. Name the pain, not the attack.
When someone resists, get curious about the resistance — it usually contains something important.
When something true surfaces in the conversation, slow down and stay with it.
When one partner shares something vulnerable, turn to the other and ask what they heard — not what they think about it.
When someone repairs — apologises, softens, reaches toward the other — name it and give it space.

You are not here to fix anything. You are here to help two people understand each other.

Only output Alinda's spoken words. Nothing else.
"""


# BUILD CONVERSATION CONTEXT


def build_context(messages, name_a, name_b):

    context = []

    for msg in messages[-6:]:
        if msg.sender == "a":
            speaker = name_a
        elif msg.sender == "b":
            speaker = name_b
        elif msg.sender == "ai":
            speaker = "Alinda"
        else:
            continue
        content = getattr(msg, "content", str(msg))
        context.append(f"{speaker}: {content}")

    return "\n".join(context)



# BUILD PROMPT


def build_prompt(name_a, name_b, decision, recent_messages):

    speaker = decision.get("speaker")
    quote = decision.get("quote")
    feeling = decision.get("feeling")
    action = decision.get("action")
    target = decision.get("target")

    speaker_name = name_a if speaker == "a" else name_b

    if target == "a":
        target_name = name_a
    elif target == "b":
        target_name = name_b
    else:
        target_name = "both partners"

    action_guidance = get_action_guidance(action)
    context = build_context(recent_messages, name_a, name_b)

    feeling_context = f'They said they feel "{feeling}".' if feeling else ""

    system_message = decision.get("system_message", "")
    therapeutic_context = (
        f"\nRespond to this: {system_message}\n"
        if system_message else ""
    )

    prompt = f"""A mediation session is taking place between two partners.

Participants: {name_a} and {name_b}

Conversation so far:
{context}

Do not repeat any response Alinda has already given above.

The most recent message came from: {speaker_name}

{speaker_name} just said:
"{quote}"

{feeling_context}
{therapeutic_context}
Therapeutic direction:
{action_guidance}

Respond to: {target_name}

Respond as Alinda. One or two sentences. Let the response breathe.
"""

    return prompt



# GENERATE MEDIATION MESSAGE


async def generate_mediation_message(name_a, name_b, recent_messages, analysis, decision):

    is_safety = decision.get("action") == "safety_intervention"
    is_abusive = analysis.get("is_abusive", False)
    toxicity = analysis.get("toxicity", 0)

    prompt = build_prompt(name_a, name_b, decision, recent_messages)

    if is_safety or (is_abusive and toxicity >= 4):
        prompt += "\nTone: Be firm and direct. Do not soften this.\n"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt}
    ]

    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "max_tokens": 90 if is_safety else 150,
        "temperature": 0.25 if is_safety else 0.5,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GROQ_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json"
                },
                timeout=60
            )
            response.raise_for_status()
            data = response.json()
            raw = data["choices"][0]["message"]["content"].strip()

            if not raw:
                return {
                    "next_speaker": decision.get("target"),
                    "message": decision["system_message"]
                }

            message = clean_generation(raw)
            message = sanitize_response(message)

            return {
                "next_speaker": decision.get("target"),
                "message": message
            }

    except Exception as e:
        print(f"Groq error: {type(e).__name__}: {e}")
        try:
            print("STATUS CODE:", response.status_code)
            print("RESPONSE BODY:", response.text)
        except NameError:
            print("No response object available")
        import traceback
        traceback.print_exc()
        return {
            "next_speaker": decision.get("target"),
            "message": decision.get("system_message", "I'm here. Take your time.")
        }