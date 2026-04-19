import streamlit as st
import requests
import time


# CONFIG


BACKEND_URL = "http://localhost:8000"

st.set_page_config(
    page_title="Alinda",
    page_icon="◌",
    layout="centered",
    initial_sidebar_state="collapsed"
)


# STYLES


def inject_css():
    st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Lora:ital,wght@0,400;0,500;1,400&display=swap');

/* ── Hide Streamlit chrome ── */
#MainMenu, footer, header { visibility: hidden; }
.stDeployButton { display: none !important; }
div[data-testid="stToolbar"] { display: none !important; }
div[data-testid="stDecoration"] { display: none !important; }
div[data-testid="stStatusWidget"] { display: none !important; }

/* ── Page base ── */
html, body {
    background-color: #F5F0E8 !important;
    -webkit-font-smoothing: antialiased;
}

[data-testid="stAppViewContainer"],
[data-testid="stAppViewContainer"] > .main,
section.main {
    background-color: #F5F0E8 !important;
}

.block-container {
    max-width: 660px !important;
    padding-top: 2.5rem !important;
    padding-bottom: 5rem !important;
    padding-left: 1.5rem !important;
    padding-right: 1.5rem !important;
}

* { box-sizing: border-box; }

/* ── Typography base ── */
body, p, div, span, input, textarea, button, label {
    font-family: 'Lora', Georgia, serif !important;
}

/* ── Labels ── */
.stTextInput label,
.stTextArea label {
    font-size: 11px !important;
    letter-spacing: 0.10em !important;
    color: #B8A89C !important;
    text-transform: uppercase !important;
    font-family: 'Lora', Georgia, serif !important;
}

/* ── Text inputs ── */
.stTextInput > div > div > input {
    background: #FDFAF6 !important;
    border: 1px solid #E0D6CC !important;
    border-radius: 8px !important;
    font-family: 'Lora', Georgia, serif !important;
    font-size: 15px !important;
    color: #2C2420 !important;
    padding: 11px 14px !important;
    transition: border-color 0.25s ease, box-shadow 0.25s ease !important;
    height: auto !important;
}

.stTextInput > div > div > input:focus {
    border-color: #7B8C7C !important;
    box-shadow: 0 0 0 3px rgba(123,140,124,0.10) !important;
    outline: none !important;
}

.stTextInput > div > div > input::placeholder {
    color: #C8BAB0 !important;
    font-style: italic !important;
}

/* ── Textareas ── */
.stTextArea > div > div > textarea {
    background: #FDFAF6 !important;
    border: 1px solid #E0D6CC !important;
    border-radius: 8px !important;
    font-family: 'Lora', Georgia, serif !important;
    font-size: 15px !important;
    color: #2C2420 !important;
    padding: 12px 14px !important;
    line-height: 1.7 !important;
    transition: border-color 0.25s ease, box-shadow 0.25s ease !important;
    resize: vertical !important;
}

.stTextArea > div > div > textarea:focus {
    border-color: #7B8C7C !important;
    box-shadow: 0 0 0 3px rgba(123,140,124,0.10) !important;
    outline: none !important;
}

.stTextArea > div > div > textarea::placeholder {
    color: #C8BAB0 !important;
    font-style: italic !important;
}

/* ── Buttons ── */
.stButton > button {
    background: #2C2420 !important;
    color: #F5F0E8 !important;
    border: 1px solid #2C2420 !important;
    border-radius: 20px !important;
    font-family: 'Lora', Georgia, serif !important;
    font-size: 11px !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
    padding: 11px 28px !important;
    height: auto !important;
    transition: all 0.2s ease !important;
    cursor: pointer !important;
}

.stButton > button:hover {
    background: #4A3C38 !important;
    border-color: #4A3C38 !important;
    box-shadow: 0 3px 10px rgba(44,36,32,0.18) !important;
    transform: translateY(-1px) !important;
}

.stButton > button:active {
    transform: translateY(0) !important;
    box-shadow: none !important;
}

/* ── Spinner ── */
.stSpinner > div { border-top-color: #7B8C7C !important; }
[data-testid="stSpinner"] p {
    font-family: 'Lora', Georgia, serif !important;
    font-style: italic !important;
    color: #9C8C84 !important;
    font-size: 14px !important;
}

/* ── Error / Info / Warning ── */
.stAlert {
    border-radius: 3px !important;
    font-family: 'Lora', Georgia, serif !important;
    font-size: 14px !important;
}

/* ── Divider ── */
hr { border-color: #E8E0D2 !important; margin: 2rem 0 !important; }

/*
   CUSTOM COMPONENTS*/

/* Wordmark */
.wordmark {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 48px;
    font-weight: 300;
    letter-spacing: 0.16em;
    color: #2C2420;
    text-align: center;
    line-height: 1;
    margin-bottom: 6px;
}

.tagline {
    font-family: 'Lora', Georgia, serif;
    font-size: 14px;
    font-style: italic;
    color: #B8A89C;
    text-align: center;
    letter-spacing: 0.04em;
    margin-bottom: 44px;
}

/* Section label */
.section-label {
    font-family: 'Lora', Georgia, serif;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #B8A89C;
    text-align: center;
    margin-bottom: 28px;
    margin-top: 4px;
}

/* Progress dots */
.progress-dots {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 20px 0 32px;
}

.dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #DDD5CB;
    display: inline-block;
    transition: all 0.35s ease;
}

.dot-active {
    background: #7B8C7C;
    transform: scale(1.35);
}

.dot-done {
    background: #B8C8B9;
}

/* Intake */
.intake-question {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px;
    font-weight: 300;
    font-style: italic;
    color: #2C2420;
    line-height: 1.45;
    letter-spacing: 0.01em;
    margin-bottom: 20px;
    animation: gentleFade 0.5s ease;
}

.intake-note {
    font-family: 'Lora', Georgia, serif;
    font-size: 13px;
    color: #B8A89C;
    font-style: italic;
    margin-top: 10px;
    line-height: 1.6;
}

.intake-step-label {
    font-family: 'Lora', Georgia, serif;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #C8BAB0;
    text-align: center;
    margin-bottom: 4px;
}

/* Waiting screen */
.waiting-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 56px 24px 40px;
    gap: 22px;
}

.waiting-ring {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 1.5px solid rgba(123,140,124,0.35);
    background: radial-gradient(circle, rgba(123,140,124,0.12) 0%, transparent 68%);
    animation: waitBreath 3.5s ease-in-out infinite;
}

.waiting-text {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 22px;
    font-style: italic;
    font-weight: 300;
    color: #7B8C7C;
    text-align: center;
    letter-spacing: 0.03em;
}

.room-code-display {
    text-align: center;
    margin: 28px 0 8px;
}

.room-code-label {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #C8BAB0;
    margin-bottom: 8px;
}

.room-code-value {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 32px;
    font-weight: 300;
    letter-spacing: 0.22em;
    color: #5C504A;
}

/* Stage pill */
.stage-pill {
    display: inline-block;
    background: rgba(123,140,124,0.10);
    border: 1px solid rgba(123,140,124,0.22);
    border-radius: 20px;
    padding: 4px 14px;
    font-size: 11px;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #7B8C7C;
    font-family: 'Lora', Georgia, serif;
    transition: all 0.4s ease;
}

.stage-pill-cooldown {
    background: rgba(168,184,169,0.18);
    border-color: rgba(123,140,124,0.35);
    animation: pillBreath 3.5s ease-in-out infinite;
}

.stage-pill-safety {
    background: rgba(184,112,96,0.08);
    border-color: rgba(184,112,96,0.28);
    color: #B87060;
}

.stage-pill-free {
    background: rgba(180,160,140,0.12);
    border-color: rgba(180,160,140,0.25);
    color: #8C7C70;
}

/* Chat header */
.chat-header {
    text-align: center;
    padding-bottom: 20px;
    margin-bottom: 8px;
    border-bottom: 1px solid #EAE2D6;
}

.session-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 20px;
    font-weight: 300;
    letter-spacing: 0.08em;
    color: #5C504A;
    margin-bottom: 10px;
}

/* Message layout */
.msg-row {
    display: flex;
    margin-bottom: 14px;
    animation: msgRise 0.35s ease;
}

.msg-row-left  { justify-content: flex-start; }
.msg-row-right { justify-content: flex-end; }
.msg-row-center { justify-content: center; }

.msg-col { display: flex; flex-direction: column; }
.msg-col-left  { align-items: flex-start; }
.msg-col-right { align-items: flex-end; }

.msg-name {
    font-size: 11px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #C8B8AC;
    padding: 0 5px;
    margin-bottom: 4px;
    font-family: 'Lora', Georgia, serif;
}

.bubble {
    padding: 12px 17px;
    font-size: 15px;
    line-height: 1.68;
    max-width: 78%;
    word-break: break-word;
}

.bubble-a {
    background: #FFFFFF;
    border: 1px solid #EAE2D6;
    border-left: 4px solid #B8CEB9;
    border-radius: 0 16px 16px 0; /* Right corners rounded, left flat */
    color: #2C2420;
}

.bubble-b {
    background: #FFFFFF;
    border: 1px solid #EAE2D6;
    border-right: 4px solid #D0C0B0;
    border-radius: 16px 0 0 16px; /* Left corners rounded, right flat */
    color: #2C2420;
}

.bubble-ai {
    background: #EEF2EE;
    border: 1px solid #D0DCD0;
    border-radius: 16px; /* All corners rounded for Alinda */
    max-width: 88%;
    text-align: center;
    font-style: italic;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 19px;
    line-height: 1.72;
    color: #364836;
    letter-spacing: 0.01em;
    padding: 15px 22px;
}

.bubble-ai-safety {
    background: #FDF5F2;
    border: 1px solid #D8A898;
    color: #7C3828;
}

.bubble-ai-cooldown {
    background: #F2F5F2;
    border-color: #C0D0C0;
}

.bubble-system {
    font-size: 11px;
    color: #C8B8AC;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    font-family: 'Lora', Georgia, serif;
    padding: 2px 8px;
    text-align: center;
}

/* Cooldown card */
.cooldown-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 28px 20px;
    background: #F2F5F2;
    border: 1px solid #C8D8C9;
    border-radius: 3px;
    margin: 8px 0 20px;
    animation: gentleFade 0.5s ease;
}

.breathe-ring {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 1.5px solid rgba(123,140,124,0.45);
    background: radial-gradient(circle, rgba(123,140,124,0.18) 0%, transparent 65%);
    animation: breathe 4.5s ease-in-out infinite;
}

.cooldown-label {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 16px;
    font-style: italic;
    color: #7B8C7C;
    letter-spacing: 0.04em;
}

/* Safety banner */
.safety-banner {
    background: #FDF5F2;
    border: 1px solid #D8A898;
    border-radius: 3px;
    padding: 10px 18px;
    text-align: center;
    margin: 8px 0 16px;
    font-family: 'Lora', Georgia, serif;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #B87060;
}

/* Turn indicator */
.turn-banner {
    text-align: center;
    padding: 14px 0 6px;
    margin: 6px 0 12px;
}

.turn-your {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 16px;
    font-style: italic;
    color: #7B8C7C;
    letter-spacing: 0.04em;
    animation: gentleFade 0.4s ease;
}

.turn-waiting {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 15px;
    font-style: italic;
    color: #C8B8AC;
    letter-spacing: 0.04em;
}

/* Thinking indicator */
.thinking-row {
    display: flex;
    justify-content: center;
    padding: 16px 0;
}

.thinking-wrap {
    display: flex;
    align-items: center;
    gap: 9px;
    color: #B8A89C;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    font-size: 16px;
    letter-spacing: 0.03em;
}

.t-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #B8A89C;
    display: inline-block;
    animation: tDot 1.5s ease-in-out infinite;
}

.t-dot:nth-child(2) { animation-delay: 0.18s; }
.t-dot:nth-child(3) { animation-delay: 0.36s; }

/* Input area */
.input-area-divider {
    border-top: 1px solid #EAE2D6;
    margin-top: 20px;
    padding-top: 16px;
}

/* Footnote */
.session-footnote {
    text-align: center;
    font-family: 'Lora', Georgia, serif;
    font-size: 12px;
    color: #C8B8AC;
    font-style: italic;
    line-height: 1.8;
}

/* 
   KEYFRAME ANIMATIONS
    */

@keyframes breathe {
    0%, 100% { transform: scale(1);    opacity: 0.5; }
    50%       { transform: scale(1.2); opacity: 1;   }
}

@keyframes waitBreath {
    0%, 100% { transform: scale(1);    opacity: 0.38; }
    50%       { transform: scale(1.18); opacity: 0.9;  }
}

@keyframes pillBreath {
    0%, 100% { opacity: 0.7; }
    50%       { opacity: 1;   }
}

@keyframes msgRise {
    from { opacity: 0; transform: translateY(7px); }
    to   { opacity: 1; transform: translateY(0);   }
}

@keyframes gentleFade {
    from { opacity: 0; }
    to   { opacity: 1; }
}

@keyframes tDot {
    0%, 80%, 100% { transform: scale(0.55); opacity: 0.35; }
    40%           { transform: scale(1.05); opacity: 1;    }
}

/* 
   MOBILE RESPONSIVE
   */

@media (max-width: 768px) {

    /* Tighter container padding on small screens */
    .block-container {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
        padding-top: 1.5rem !important;
        padding-bottom: 6rem !important;
    }

    /* Wordmark scales down */
    .wordmark {
        font-size: 36px;
        letter-spacing: 0.10em;
    }

    .tagline {
        font-size: 13px;
    }

    /* Intake question smaller on mobile */
    .intake-question {
        font-size: 22px;
    }

    /* Bubbles go full width on mobile */
    .bubble {
        max-width: 92% !important;
        font-size: 14px !important;
    }

    .bubble-ai {
        max-width: 95% !important;
        font-size: 16px !important;
        padding: 13px 16px !important;
    }

    /* Larger tap targets for buttons */
    .stButton > button {
        padding: 14px 20px !important;
        font-size: 12px !important;
        min-height: 48px !important;
    }

    /* Input fields taller for easier mobile typing */
    .stTextInput > div > div > input {
        font-size: 16px !important; /* Prevents iOS auto-zoom */
        padding: 13px 14px !important;
        min-height: 48px !important;
    }

    .stTextArea > div > div > textarea {
        font-size: 16px !important;
        padding: 13px 14px !important;
    }

    /* Crisis digit smaller on mobile */
    .crisis-digit,
    [class^="dynamic-digit-"] {
        font-size: 88px !important;
    }

    /* Cooldown ring scales down */
    .cooldown-active-ring {
        width: 100px !important;
        height: 100px !important;
    }

    /* Turn banner text */
    .turn-your, .turn-waiting {
        font-size: 14px !important;
    }

    /* Stage pill */
    .stage-pill {
        font-size: 10px !important;
        padding: 3px 10px !important;
    }

    /* Session title */
    .session-title {
        font-size: 17px !important;
    }

    /* Room code display on waiting screen */
    .room-code-value {
        font-size: 24px !important;
        letter-spacing: 0.14em !important;
    }

    /* Progress dots on intake */
    .dot {
        width: 8px !important;
        height: 8px !important;
    }

    /* Columns collapse gracefully */
    [data-testid="column"] {
        min-width: 0 !important;
    }
}

/* iOS Safari specific fixes */
@supports (-webkit-touch-callout: none) {
    /* Prevents bounce scroll on iOS */
    .stApp {
        -webkit-overflow-scrolling: touch;
    }

                
    /* Font size 16px prevents iOS from zooming on input focus */
    input, textarea, select {
        font-size: 16px !important; 
 
                
    }
}
</style>
""", unsafe_allow_html=True)



# SESSION STATE


def init_state():
    # Read from URL params first — survives browser refresh
    params = st.query_params

    defaults = {
        "phase": "setup",
        "role": None,
        "room_id": None,
        "name": None,
        "partner_name": None,
        "intake_step": 1,
        "intake_answers": {},
        "msg_key": 0,
        "error": None,
    }

    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

    # Restore from URL if session state was wiped by refresh
    if params.get("room_id") and params.get("role"):
        if st.session_state.phase == "setup":
            st.session_state.room_id = params.get("room_id")
            st.session_state.role = params.get("role")
            st.session_state.name = params.get("name", "")
            st.session_state.phase = "restoring"



# API HELPERS


def api(method, endpoint, **kwargs):
    """Wrapper for all backend calls. Returns (data, error_string)."""
    try:
        url = f"{BACKEND_URL}{endpoint}"
        r = getattr(requests, method)(url, timeout=90, **kwargs)
        r.raise_for_status()
        return r.json(), None
    except requests.exceptions.ConnectionError:
        return None, "Cannot reach the backend. Make sure it's running on port 8000."
    except requests.exceptions.Timeout:
        return None, "The server took too long to respond. Please try again."
    except requests.exceptions.HTTPError as e:
        try:
            detail = e.response.json().get("detail", str(e))
        except Exception:
            detail = str(e)
        return None, detail
    except Exception as e:

        return None, str(e)


def create_room(room_id, name):
    return api("post", "/api/v1/session/create-room", json={"room_id": room_id, "name_a": name})

def join_room(room_id, name):
    return api("post", "/api/v1/session/join-room", json={"room_id": room_id, "name_b": name})

def submit_intake(room_id, role, text):
    return api("post", "/api/v1/session/submit-intake", json={"room_id": room_id, "role": role, "intake_text": text})

def send_message(room_id, sender, content):
    return api("post", "/api/v1/session/message", json={"room_id": room_id, "sender": sender, "content": content})

def get_conversation(room_id):
    return api("get", f"/api/v1/session/conversation/{room_id}")

def get_session(room_id):
    return api("get", f"/api/v1/session/session/{room_id}")

def mark_crisis_ready(room_id, role):
    return api("post", "/api/v1/session/crisis-ready", json={"room_id": room_id, "role": role})



# CONSTANTS


STAGE_LABELS = {
    "validation":     "Understanding",
    "acknowledgement":"Hearing each other",
    "guidance":       "Finding words",
    "exploration":    "Opening up",
    "cooldown":       "Taking a breath",
    "repair":         "Coming back together",
    "free_flow":      "Speaking freely",
    "demand_redirect":"Finding the feeling",
    "analysis":       "Listening",
    "expression":     "Beginning",
}

INTAKE_QUESTIONS = {
    1: (
        "What's been difficult lately between you two?",
        "There's no right way to say this. Describe it as it feels."
    ),
    2: (
        "What do you wish your partner understood about you?",
        "Think about something that often goes unsaid."
    ),
    3: (
        "What usually happens when you argue?",
        "Not just one fight — the pattern that tends to repeat."
    ),
    4: (
        "What are you most afraid of, if nothing changes?",
        "This can be hard to name. Take your time with it."
    ),
}


def build_intake_text(answers):
    labels = {
        1: "WHAT HAS BEEN DIFFICULT",
        2: "WHAT I NEED UNDERSTOOD",
        3: "WHAT USUALLY HAPPENS",
        4: "WHAT I FEAR"
    }
    parts = [
        f"{labels[k]}:\n{v.strip()}"
        for k, v in sorted(answers.items())
        if v and v.strip()
    ]
    return "\n\n".join(parts) if parts else "No intake provided."



# SCREEN 1 — SETUP


def render_setup():
    st.markdown('<div class="wordmark">Alinda</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="tagline">A quiet space to understand each other</div>',
        unsafe_allow_html=True
    )

    st.markdown("---")
    st.markdown('<div class="section-label">Begin a session</div>', unsafe_allow_html=True)

    name = st.text_input("Your name", placeholder="What should Alinda call you?")
    room_code = st.text_input(
        "Room code",
        placeholder="A shared code — both partners use the same one"
    )

    if st.session_state.error:
        st.error(st.session_state.error)
        st.session_state.error = None

    st.markdown("<br>", unsafe_allow_html=True)

    col_a, col_b = st.columns(2)

    with col_a:
        if st.button("Create room", use_container_width=True):
            if not name.strip() or not room_code.strip():
                st.session_state.error = "Please enter your name and a room code."
                st.rerun()
            else:
                data, err = create_room(room_code.strip(), name.strip())
                if err:
                    st.session_state.error = err
                    st.rerun()
                else:
                    st.session_state.update({
                        "role": "a",
                        "name": name.strip(),
                        "room_id": room_code.strip(),
                        "phase": "intake"
                    })
                    # After create room success:
                    st.query_params["room_id"] = room_code.strip()
                    st.query_params["role"] = "a"
                    st.query_params["name"] = name.strip()
                    st.rerun()

    with col_b:
        if st.button("Join room", use_container_width=True):
            if not name.strip() or not room_code.strip():
                st.session_state.error = "Please enter your name and a room code."
                st.rerun()
            else:
                data, err = join_room(room_code.strip(), name.strip())
                if err:
                    st.session_state.error = err
                    st.rerun()
                else:
                    st.session_state.update({
                        "role": "b",
                        "name": name.strip(),
                        "room_id": room_code.strip(),
                        "phase": "intake"
                    })
                    # After join room success:
                    st.query_params["room_id"] = room_code.strip()
                    st.query_params["role"] = "b"
                    st.query_params["name"] = name.strip()
                    st.rerun()
    st.markdown("<br>", unsafe_allow_html=True)
    st.markdown("""
    <div class="session-footnote">
        Both partners join from their own devices<br>
        using the same room code
    </div>
    """, unsafe_allow_html=True)



# SCREEN 2 — INTAKE


def render_intake():
    step  = st.session_state.intake_step
    name  = st.session_state.name or "you"
    total = 4

    st.markdown('<div class="wordmark">Alinda</div>', unsafe_allow_html=True)
    st.markdown(
        f'<div class="tagline">Before we begin, {name}</div>',
        unsafe_allow_html=True
    )

    # Progress dots
    dots = ""
    for i in range(1, total + 1):
        if i < step:
            dots += '<span class="dot dot-done"></span>'
        elif i == step:
            dots += '<span class="dot dot-active"></span>'
        else:
            dots += '<span class="dot"></span>'
    st.markdown(
        f'<div class="progress-dots">{dots}</div>',
        unsafe_allow_html=True
    )

    # Step label
    st.markdown(
        f'<div class="intake-step-label">Question {step} of {total}</div>',
        unsafe_allow_html=True
    )

    question, note = INTAKE_QUESTIONS[step]
    st.markdown(
        f'<div class="intake-question">{question}</div>',
        unsafe_allow_html=True
    )

    answer = st.text_area(
        "",
        height=140,
        placeholder="Take your time...",
        key=f"intake_{step}",
        label_visibility="collapsed"
    )

    st.markdown(
        f'<div class="intake-note">{note}</div>',
        unsafe_allow_html=True
    )

    if st.session_state.error:
        st.warning(st.session_state.error)
        st.session_state.error = None

    st.markdown("<br>", unsafe_allow_html=True)

    col_main, col_skip = st.columns([4, 1])

    with col_main:
        btn_label = "Continue" if step < total else "Begin the session"
        if st.button(btn_label, use_container_width=True):
            st.session_state.intake_answers[step] = answer.strip()

            if step < total:
                st.session_state.intake_step += 1
                st.rerun()
            else:
                intake_text = build_intake_text(st.session_state.intake_answers)
                _, err = submit_intake(
                    st.session_state.room_id,
                    st.session_state.role,
                    intake_text
                )
                if err:
                    st.session_state.error = f"Could not submit: {err}"
                    st.rerun()
                else:
                    st.session_state.phase = "waiting"
                    st.rerun()

    with col_skip:
        if st.button("Skip", use_container_width=True):
            st.session_state.intake_answers[step] = ""
            if step < total:
                st.session_state.intake_step += 1
                st.rerun()
            else:
                intake_text = build_intake_text(st.session_state.intake_answers)
                submit_intake(st.session_state.room_id, st.session_state.role, intake_text)
                st.session_state.phase = "waiting"
                st.rerun()



# SCREEN 3 — WAITING


def render_waiting():
    st.markdown("""
    <div class="waiting-container">
        <div class="waiting-ring"></div>
        <div class="waiting-text">Waiting for your partner to join...</div>
    </div>
    """, unsafe_allow_html=True)

    if st.session_state.room_id:
        st.markdown(f"""
        <div class="room-code-display">
            <div class="room-code-label">Room code</div>
            <div class="room-code-value">{st.session_state.room_id}</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("""
    <div class="session-footnote" style="margin-top:24px;">
        Share this code with your partner.<br>
        The session begins once you're both ready.
    </div>
    """, unsafe_allow_html=True)

    # Poll backend every 3 seconds
    session_data, err = get_session(st.session_state.room_id)
    if not err and session_data:
        phase = session_data.get("phase")
        
        # Check if our own intake was actually saved
        my_intake_key = "intake_a" if st.session_state.role == "a" else "intake_b"
        my_intake_submitted = session_data.get(my_intake_key) is not None

        if phase == "ready_for_session":
            st.session_state.partner_name = (
                session_data["name_b"] if st.session_state.role == "a"
                else session_data["name_a"]
            )
            st.session_state.phase = "chat"
            st.rerun()

        elif not my_intake_submitted and session_data.get("name_a") and session_data.get("name_b"):
            # Both partners joined but our intake didn't save — go back and resubmit
            st.session_state.intake_step = 1
            st.session_state.intake_answers = {}
            st.session_state.phase = "intake"
            st.rerun()

        else:
            time.sleep(3)
            st.rerun()



# CHAT — MESSAGE RENDERING


def render_message(msg, name_a, name_b):
    sender   = msg.get("sender", "")
    content  = msg.get("content", "")
    msg_type = msg.get("message_type", "")
    extra    = msg.get("extra_data") or {}

    # Skip turn-assignment system messages — we show turn state in the indicator
    if sender == "system" and extra.get("type") == "turn_assignment":
        return

    if sender == "a":
        st.markdown(f"""
        <div class="msg-row msg-row-left">
            <div class="msg-col msg-col-left">
                <div class="msg-name">{name_a}</div>
                <div class="bubble bubble-a">{content}</div>
            </div>
        </div>
        """, unsafe_allow_html=True)

    elif sender == "b":
        st.markdown(f"""
        <div class="msg-row msg-row-right">
            <div class="msg-col msg-col-right">
                <div class="msg-name">{name_b}</div>
                <div class="bubble bubble-b">{content}</div>
            </div>
        </div>
        """, unsafe_allow_html=True)

    elif sender == "ai":
        action = extra.get("action", "")
        mode   = extra.get("mode", "")

        # Mode-aware bubble style
        if mode == "safety_lockdown" and action == "safety_intervention":
            extra_class = "bubble-ai-safety"
        elif mode == "cooldown":
            extra_class = "bubble-ai-cooldown"
        else:
            extra_class = ""

        st.markdown(f"""
        <div class="msg-row msg-row-center">
            <div class="bubble bubble-ai {extra_class}">{content}</div>
        </div>
        """, unsafe_allow_html=True)

    elif sender == "system" and msg_type == "system":
        # Non-turn system messages (opening message etc.)
        st.markdown(f"""
        <div class="msg-row msg-row-center">
            <div class="bubble-system">— {content} —</div>
        </div>
        """, unsafe_allow_html=True)




# SCREEN 4 — CHAT



def render_chat():
    session_data, err = get_session(st.session_state.room_id)
    if err or not session_data:
        st.error(f"Could not load session: {err or 'Unknown error'}")
        return

    conversation_data, msg_err = get_conversation(st.session_state.room_id)

    if msg_err or conversation_data is None:
        st.error(f"Could not load messages: {msg_err or 'Unknown error'}")
        return
    
    messages_data = conversation_data.get("messages", [])

    name_a         = session_data.get("name_a", "Partner A")
    name_b         = session_data.get("name_b", "Partner B")
    current_turn   = session_data.get("current_turn")
    mode           = session_data.get("mode", "guided")
    dialogue_stage = session_data.get("dialogue_stage", "analysis")
    my_role        = st.session_state.role
    my_name        = st.session_state.name or "You"
    partner_name   = st.session_state.partner_name or "your partner"

    # ── Stage pill ──
    stage_label = STAGE_LABELS.get(dialogue_stage, "Listening")
    if mode == "cooldown":
        pill_class = "stage-pill stage-pill-cooldown"
    elif mode == "safety_lockdown":
        pill_class = "stage-pill stage-pill-safety"
        stage_label = "Paused"
    elif mode == "free_chat":
        pill_class = "stage-pill stage-pill-free"
        stage_label = "Speaking freely"
    else:
        pill_class = "stage-pill"

    st.markdown(f"""
    <div class="chat-header">
        <div class="session-title">{name_a} &amp; {name_b}</div>
        <span class="{pill_class}">{stage_label}</span>
    </div>
    """, unsafe_allow_html=True)


    # ── 1. RENDER CHAT MESSAGES FIRST ──
    for msg in messages_data:
        # THE FIX: Safely handle None values from the database
        extra = msg.get("extra_data") or {}
        
        # Prevent duplicating the crisis message since we use a custom red box below
        is_active_crisis_msg = (
            mode == "crisis_pause" and
            msg.get("sender") == "ai" and
            extra.get("action") == "crisis_self_harm"
        )
        if is_active_crisis_msg:
            continue
            
        render_message(msg, name_a, name_b)

    # ── 2. RENDER STATE INTERVENTIONS AT THE BOTTOM ──

    # ── Cooldown breathing card (Interactive 15s Lock) ──
    if mode == "cooldown":
        # Get the ID of the last message to uniquely identify this turn
        last_msg_id = messages_data[-1]["id"] if messages_data else None

        # Check if we have already served the 15-second cooldown for this specific turn
        if st.session_state.get("cooldown_cleared_for_msg") != last_msg_id:
            
            now_ts = time.time()
            if "cooldown_start_time" not in st.session_state:
                st.session_state.cooldown_start_time = now_ts

            elapsed = now_ts - st.session_state.cooldown_start_time

            # If less than 15 seconds have passed, render the active breathing lock
            if elapsed < 15.0:
                st.markdown("""
                <style>
                .cooldown-active-wrap {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 60px;
                    padding: 40px 20px 70px;
                    background: #F4F8FB; /* Soft, calming blue background */
                    border: 1px solid #D2E4F6;
                    border-radius: 3px;
                    margin: 8px 0 20px;
                }
                .cooldown-active-label {
                    font-family: 'Cormorant Garamond', Georgia, serif;
                    font-size: 20px;
                    font-style: italic;
                    color: #5B8AB5; /* Calming steel blue */
                    letter-spacing: 0.05em;
                }
                .cooldown-active-ring {
                    width: 140px;  /* Much larger base size */
                    height: 140px;
                    border-radius: 50%;
                    border: 2px solid rgba(91, 138, 181, 0.45);
                    background: radial-gradient(circle, rgba(91, 138, 181, 0.15) 0%, transparent 65%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: breatheCycle 8s ease-in-out infinite;
                    position: relative;
                }
                .breathe-text-in, .breathe-text-out {
                    font-family: 'Lora', Georgia, serif;
                    font-size: 24px;
                    font-style: italic;
                    color: #5B8AB5;
                    position: absolute;
                    letter-spacing: 0.08em;
                }
                
                /* Syncing the text fades with the 8-second expand/contract cycle */
                .breathe-text-in { animation: fadeInOut_In 8s ease-in-out infinite; }
                .breathe-text-out { animation: fadeInOut_Out 8s ease-in-out infinite; }

                /* 0 to 50% is the inhale (expand). 50 to 100% is the exhale (contract). */
                @keyframes breatheCycle {
                    0%, 100% { transform: scale(1); opacity: 0.6; }
                    50%      { transform: scale(1.6); opacity: 1; }
                }
                @keyframes fadeInOut_In {
                    0%   { opacity: 0; transform: scale(0.9); }
                    20%  { opacity: 1; transform: scale(1); }
                    40%  { opacity: 0; transform: scale(1.05); }
                    100% { opacity: 0; }
                }
                @keyframes fadeInOut_Out {
                    0%   { opacity: 0; }
                    50%  { opacity: 0; transform: scale(1.05); }
                    70%  { opacity: 1; transform: scale(1); }
                    90%  { opacity: 0; transform: scale(0.9); }
                    100% { opacity: 0; }
                }
                </style>
                
                <div class="cooldown-active-wrap">
                    <div class="cooldown-active-label">breathe with this circle</div>
                    <div class="cooldown-active-ring">
                        <span class="breathe-text-in">in</span>
                        <span class="breathe-text-out">out</span>
                    </div>
                </div>
                """, unsafe_allow_html=True)

                # Rerun twice a second to keep the timer checking smoothly
                time.sleep(0.5)
                st.rerun()
                return  # <--- CRITICAL: This return aborts the function, hiding the input box
            
            else:
                # 15 seconds are up! Mark this specific cooldown as served.
                st.session_state.cooldown_cleared_for_msg = last_msg_id
                del st.session_state["cooldown_start_time"]
                
                # We do NOT return here. The code continues downwards and renders the input box

    # ── Safety lockdown banner ──
    if mode == "safety_lockdown":
        st.markdown("""
        <div class="safety-banner">
            Please rephrase — respectful language only
        </div>
        """, unsafe_allow_html=True)

    # ── Crisis pause screen ──
    if mode == "crisis_pause":
        
        st.markdown("""
        <style>
        .crisis-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px 32px;
            gap: 0;
        }
        .crisis-message-box {
            background: #FDF5F2;
            border: 1px solid #D8A898;
            border-left: 4px solid #B87060;
            border-radius: 3px;
            padding: 20px 24px;
            margin-bottom: 28px;
            font-family: 'Lora', Georgia, serif;
            font-size: 15px;
            line-height: 1.75;
            color: #7C3828;
        }
        .crisis-resources {
            font-size: 13px;
            color: #B87060;
            margin-top: 12px;
            line-height: 1.9;
        }
        .crisis-waiting {
            font-family: 'Cormorant Garamond', Georgia, serif;
            font-size: 17px;
            font-style: italic;
            color: #C8A898;
            text-align: center;
            margin-top: 16px;
        }
        </style>
        """, unsafe_allow_html=True)

        # Find the crisis AI message to display
        crisis_ai_message = None
        for msg in reversed(messages_data):
            # THE FIX: Safely handle None values from the database
            extra = msg.get("extra_data") or {}
            
            if msg.get("sender") == "ai" and extra.get("action") == "crisis_self_harm":
                crisis_ai_message = msg.get("content", "")
                break

        if crisis_ai_message:
            st.markdown(f"""
            <div class="crisis-message-box">
                {crisis_ai_message}
                <div class="crisis-resources">
                    <strong>iCall (India):</strong> 9152987821<br>
                    <strong>Vandrevala Foundation:</strong> 1860-2662-345 (24/7)<br>
                    <strong>International resources:</strong> iasp.info/resources/Crisis_Centres
                </div>
            </div>
            """, unsafe_allow_html=True)

        # Countdown logic
        from datetime import datetime, timezone as tz
        locked_until_str = session_data.get("locked_until")
        countdown_active = False

        if locked_until_str:
            try:
                lock_time = datetime.fromisoformat(
                    locked_until_str.replace("Z", "+00:00")
                )
                now = datetime.now(tz.utc)
                if lock_time.tzinfo is None:
                    lock_time = lock_time.replace(tzinfo=tz.utc)
                remaining_seconds = max(0, int((lock_time - now).total_seconds()))
                countdown_active = remaining_seconds > 0
            except Exception:
                countdown_active = False

        if countdown_active:
            now_ts = time.time()

            if "crisis_digit" not in st.session_state:
                st.session_state.crisis_digit = 5
                st.session_state.crisis_digit_start = now_ts

            elapsed = now_ts - st.session_state.crisis_digit_start

            if elapsed >= 3.0 and st.session_state.crisis_digit > 1:
                st.session_state.crisis_digit -= 1
                st.session_state.crisis_digit_start = now_ts

            digit = st.session_state.crisis_digit

            # The Dynamic CSS Fix
            st.markdown(f"""
            <style>
            @keyframes fadeInOut_{digit} {{
                0%   {{ opacity: 0; transform: scale(0.85); }}
                15%  {{ opacity: 1; transform: scale(1); }}
                80%  {{ opacity: 1; transform: scale(1); }}
                100% {{ opacity: 0; transform: scale(0.9); }}
            }}
            .dynamic-digit-{digit} {{
                font-family: 'Cormorant Garamond', Georgia, serif;
                font-size: 120px;
                font-weight: 300;
                color: #B87060;
                line-height: 1;
                text-align: center;
                animation: fadeInOut_{digit} 3s ease-in-out forwards;
            }}
            </style>
            
            <div class="crisis-wrap">
                <div style="
                    font-family: 'Lora', Georgia, serif;
                    font-size: 12px;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    color: #C8A898;
                    margin-bottom: 20px;
                ">Breathe slowly with these numbers</div>
                <div class="dynamic-digit-{digit}">{digit}</div>
            </div>
            """, unsafe_allow_html=True)

            time.sleep(0.5)
            st.rerun()

        else:
            for k in ["crisis_digit", "crisis_digit_start"]:
                if k in st.session_state:
                    del st.session_state[k]
                    
            my_ready_key = "crisis_ready_a" if my_role == "a" else "crisis_ready_b"
            partner_ready_key = "crisis_ready_b" if my_role == "a" else "crisis_ready_a"
            i_am_ready = session_data.get(my_ready_key, False)
            partner_is_ready = session_data.get(partner_ready_key, False)

            st.markdown("""
            <div style="
                text-align: center;
                font-family: 'Cormorant Garamond', Georgia, serif;
                font-size: 19px;
                font-style: italic;
                color: #9C8C84;
                margin: 24px 0 20px;
                line-height: 1.7;
            ">
                When you're ready to continue,<br>press the button below.
            </div>
            """, unsafe_allow_html=True)

            if not i_am_ready:
                col_center, _, _ = st.columns([1, 1, 1])
                with col_center:
                    if st.button("I'm ready", use_container_width=True):
                        mark_crisis_ready(st.session_state.room_id, my_role)
                        st.rerun()
            else:
                if partner_is_ready:
                    st.markdown('<div class="crisis-waiting">Resuming the session...</div>', unsafe_allow_html=True)
                    time.sleep(1.5)
                    st.rerun()
                else:
                    st.markdown(f'<div class="crisis-waiting">Waiting for {partner_name} to be ready...</div>', unsafe_allow_html=True)
                    time.sleep(3)
                    st.rerun()

        return  # Don't render the rest of chat during crisis pause

    # Scroll anchor
    st.markdown(
        '<div id="chat-bottom" style="height:1px;"></div>',
        unsafe_allow_html=True
    )

    # ── Input area ──
    st.markdown('<div class="input-area-divider">', unsafe_allow_html=True)

    can_speak = (current_turn is None or current_turn == my_role)

    if can_speak:
        st.markdown(f"""
        <div class="turn-banner">
            <span class="turn-your">{my_name}, you have the floor</span>
        </div>
        """, unsafe_allow_html=True)

        user_input = st.text_input(
            "",
            placeholder="Say what feels important...",
            key=f"msg_{st.session_state.msg_key}",
            label_visibility="collapsed"
        )

        if st.button("Send", use_container_width=True):
            if user_input and user_input.strip():
                # Show thinking while API call is in progress
                with st.spinner("Alinda is listening..."):
                    time.sleep(0.5)   # slight pause — feels more human
                    _, send_err = send_message(
                        st.session_state.room_id,
                        my_role,
                        user_input.strip()
                    )

                if send_err:
                    st.error(f"Couldn't send: {send_err}")
                else:
                    st.session_state.msg_key += 1
                    st.rerun()
            else:
                st.warning("Please write something before sending.")

    else:
        st.markdown(f"""
        <div class="turn-banner">
            <span class="turn-waiting">{partner_name} is speaking...</span>
        </div>
        """, unsafe_allow_html=True)

        col_refresh, _ = st.columns([1, 3])
        with col_refresh:
            if st.button("↻ Refresh", use_container_width=True):
                st.rerun()

        st.markdown("""
        <div class="session-footnote" style="margin-top:8px;">
            Waiting for the conversation to continue
        </div>
        """, unsafe_allow_html=True)

    st.markdown('</div>', unsafe_allow_html=True)

#RESTORE CHAT
def render_restore():
    """
    Silently reconnects a user who refreshed the browser.
    Checks backend for session state and routes them to the right screen.
    """
    room_id = st.session_state.room_id
    role = st.session_state.role

    if not room_id or not role:
        st.session_state.phase = "setup"
        st.rerun()
        return

    with st.spinner("Reconnecting..."):
        session_data, err = get_session(room_id)

    if err or not session_data:
        st.session_state.phase = "setup"
        st.query_params.clear()
        st.rerun()
        return

    phase = session_data.get("phase")
    st.session_state.partner_name = (
        session_data.get("name_b") if role == "a"
        else session_data.get("name_a")
    )

    if phase == "ready_for_session":
        st.session_state.phase = "chat"
    elif phase == "waiting_for_intake":
        # Check if this user's intake was submitted
        intake_key = "intake_a" if role == "a" else "intake_b"
        if session_data.get(intake_key):
            st.session_state.phase = "waiting"
        else:
            st.session_state.intake_step = 1
            st.session_state.intake_answers = {}
            st.session_state.phase = "intake"
    else:
        st.session_state.phase = "waiting"

    st.rerun()


# ROUTER



init_state()
inject_css()

phase = st.session_state.phase

if phase == "setup":
    render_setup()
elif phase == "intake":
    render_intake()
elif phase == "waiting":
    render_waiting()
elif phase == "chat":
    render_chat()
elif phase == "restoring":
    render_restore()

else:
    st.error(f"Unknown phase: {phase}")
    if st.button("Reset"):
        st.query_params.clear()
        for key in list(st.session_state.keys()):

            del st.session_state[key]
        st.rerun()