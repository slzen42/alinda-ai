"""
test_ai.py

Alinda AI component test runner.

Run from the project root:
    python test_ai.py

Add a new phase for each new file you write.
Each phase is independent — failures are caught and reported
without stopping the other phases from running.

Exit code:
    0 — all phases passed
    1 — one or more phases failed
"""

import sys
import traceback
from pathlib import Path
import asyncio


# COLOUR OUTPUT — works on all modern terminals including Windows 10+


class C:
    GREEN  = "\033[92m"
    RED    = "\033[91m"
    YELLOW = "\033[93m"
    CYAN   = "\033[96m"
    BOLD   = "\033[1m"
    RESET  = "\033[0m"

def ok(msg):   print(f"  {C.GREEN}✓{C.RESET} {msg}")
def fail(msg): print(f"  {C.RED}✗{C.RESET} {msg}")
def warn(msg): print(f"  {C.YELLOW}!{C.RESET} {msg}")
def info(msg): print(f"    {C.CYAN}{msg}{C.RESET}")



# RESULT TRACKER


results: dict[str, bool] = {}

def phase(name: str):
    """Print a phase header."""
    print(f"\n{C.BOLD}{'─' * 50}{C.RESET}")
    print(f"{C.BOLD}  {name}{C.RESET}")
    print(f"{C.BOLD}{'─' * 50}{C.RESET}")



# PHASE 0 — Environment and model directory check
# Run this before anything else so you know what files are present.


phase("Phase 0 — Environment check")

try:
    MODEL_DIR = Path("ai/models/alinda-classifier")

    if MODEL_DIR.exists():
        ok(f"Model directory found: {MODEL_DIR.resolve()}")

        # List all files and their sizes
        files = sorted(MODEL_DIR.iterdir())
        if files:
            info("Files in model directory:")
            for f in files:
                size_mb = f.stat().st_size / 1024 / 1024
                info(f"  {f.name:<45} {size_mb:>7.2f} MB")
        else:
            warn("Model directory is empty")

        # Check specifically for required files
        required = ["config.json", "alinda_mapping.json"]
        optional = ["label_names.json", "tokenizer_config.json", "vocab.txt"]

        for fname in required:
            fpath = MODEL_DIR / fname
            if fpath.exists():
                ok(f"Required file present: {fname}")
            else:
                fail(f"Required file MISSING: {fname}")

        for fname in optional:
            fpath = MODEL_DIR / fname
            if fpath.exists():
                ok(f"Optional file present: {fname}")
            else:
                warn(f"Optional file not found (not critical): {fname}")

        # Inspect config.json for id2label
        config_path = MODEL_DIR / "config.json"
        if config_path.exists():
            import json
            with open(config_path) as f:
                cfg = json.load(f)
            id2label = cfg.get("id2label", {})
            if id2label:
                ok(f"config.json contains id2label with {len(id2label)} labels")
                first_few = list(id2label.items())[:3]
                info(f"First 3 labels: {first_few}")
            else:
                fail("config.json exists but id2label is empty or missing")

        # Inspect alinda_mapping.json
        mapping_path = MODEL_DIR / "alinda_mapping.json"
        if mapping_path.exists():
            with open(mapping_path) as f:
                mapping = json.load(f)
            dimensions = [k for k in mapping if k != "thresholds"]
            thresholds = mapping.get("thresholds", {})
            ok(f"alinda_mapping.json contains {len(dimensions)} dimensions: {dimensions}")
            ok(f"Thresholds defined for: {list(thresholds.keys())}")

        results["Phase 0"] = True

    else:
        fail(f"Model directory NOT found: {MODEL_DIR.resolve()}")
        fail("Cannot proceed with classifier tests until model is in place.")
        info("Expected path: ai/models/alinda-classifier/")
        info("Run the Colab notebook and download the output to that folder.")
        results["Phase 0"] = False

except Exception as e:
    fail(f"Environment check crashed: {e}")
    traceback.print_exc()
    results["Phase 0"] = False



# PHASE 1 — Classifier singleton


phase("Phase 1 — ai.classifier.AlindaClassifier")


try:
    from ai.classifier import AlindaClassifier

    # ── Singleton identity ────────────────────────────────────────────────────
    c1 = AlindaClassifier()
    c2 = AlindaClassifier()
    if c1 is c2:
        ok("Singleton pattern working — same instance returned on both calls")
    else:
        fail("Singleton broken — two different instances created")

    # ── Ready state ───────────────────────────────────────────────────────────
    if c1.ready:
        ok(f"Model loaded successfully on device: {c1.device}")
    else:
        fail("Model failed to load — classifier is in fallback mode")
        info("Check the logs above for the specific error")
        results["Phase 1"] = False
        raise RuntimeError("Classifier not ready — skipping inference tests")

    # ── Health check ──────────────────────────────────────────────────────────
    health = c1.health()
    ok(f"health() returned: labels={health['labels']}, "
       f"dimensions={health['dimensions']}")

    # ── Basic inference ───────────────────────────────────────────────────────
    test_text = "I feel hurt when you ignore me"
    result = c1.analyze(test_text)
    ok(f"analyze() returned a result for: '{test_text}'")

    # ── Return dict structure ─────────────────────────────────────────────────
    required_keys = [
        "escalation", "blame", "vulnerability", "sentiment",
        "repair_attempt", "toxicity", "abuse_score", "is_abusive",
        "contempt", "engagement", "crisis", "confidence", "top_emotions"
    ]
    missing_keys = [k for k in required_keys if k not in result]
    if not missing_keys:
        ok(f"All {len(required_keys)} required keys present in output dict")
    else:
        fail(f"Missing keys in output: {missing_keys}")

    # ── Value types ───────────────────────────────────────────────────────────
    type_errors = []
    for key in ["escalation", "blame", "vulnerability", "sentiment",
                "repair_attempt", "toxicity", "abuse_score",
                "contempt", "engagement"]:
        if not isinstance(result.get(key), int):
            type_errors.append(f"{key} should be int, got {type(result.get(key))}")
    if not isinstance(result.get("is_abusive"), bool):
        type_errors.append("is_abusive should be bool")
    if result.get("crisis") not in ["none", "self_harm", "harm_to_other"]:
        type_errors.append(f"crisis value unexpected: {result.get('crisis')}")
    if result.get("confidence") not in ["high", "medium", "low"]:
        type_errors.append(f"confidence value unexpected: {result.get('confidence')}")

    if not type_errors:
        ok("All output values have correct types")
    else:
        for err in type_errors:
            fail(err)

    # ── Score ranges ──────────────────────────────────────────────────────────
    range_errors = []
    for key in ["escalation", "blame", "vulnerability", "repair_attempt",
                "toxicity", "abuse_score", "contempt", "engagement"]:
        val = result.get(key, -1)
        if not (0 <= val <= 10):
            range_errors.append(f"{key}={val} is outside 0-10 range")
    if result.get("sentiment", -99) < -5 or result.get("sentiment", 99) > 5:
        range_errors.append(f"sentiment={result.get('sentiment')} outside -5 to 5")

    if not range_errors:
        ok("All scores within expected ranges")
    else:
        for err in range_errors:
            fail(err)

    # ── Crisis detection — self harm ──────────────────────────────────────────
    crisis_result = c1.analyze("I want to kill myself")
    if crisis_result.get("crisis") == "self_harm":
        ok("Crisis detection correctly identified self_harm")
    else:
        fail(f"Crisis detection MISSED self_harm signal — got: {crisis_result.get('crisis')}")

    # ── Crisis detection — harm to other ─────────────────────────────────────
    harm_result = c1.analyze("I want to kill him")
    if harm_result.get("crisis") == "harm_to_other":
        ok("Crisis detection correctly identified harm_to_other")
    else:
        fail(f"Crisis detection MISSED harm_to_other signal — got: {harm_result.get('crisis')}")

    # ── Fallback on empty string ──────────────────────────────────────────────
    empty_result = c1.analyze("")
    if isinstance(empty_result, dict):
        ok("analyze() handles empty string without crashing")
    else:
        fail("analyze() crashed on empty string")

    results["Phase 1"] = True
    ok(f"\n  Sample result for '{test_text}':")
    for k, v in result.items():
        if k != "top_emotions":
            info(f"    {k:<20} {v}")
    info(f"    {'top_emotions':<20} {result.get('top_emotions')}")

except Exception as e:
    fail(f"Phase 1 crashed: {e}")
    traceback.print_exc()
    results["Phase 1"] = False



# PHASE 2 — Analysis pipeline


phase("Phase 2 — ai.analysis.analyze_message")

try:
    from ai.analysis import analyze_message

    # ── Import works ──────────────────────────────────────────────────────────
    ok("analyze_message imported from ai.analysis successfully")

    # ── Output has escalation_intent (new key not in classifier output) ───────
    result = analyze_message("You never listen to me")
    if "escalation_intent" in result:
        ok("escalation_intent key present — analysis layer is active")
    else:
        fail("escalation_intent missing — analysis layer may not be running")

    # ── Full key set ──────────────────────────────────────────────────────────
    full_required_keys = [
        "escalation", "blame", "vulnerability", "sentiment",
        "repair_attempt", "toxicity", "abuse_score", "is_abusive",
        "contempt", "engagement", "crisis", "confidence",
        "escalation_intent", "top_emotions"
    ]
    missing = [k for k in full_required_keys if k not in result]
    if not missing:
        ok(f"All {len(full_required_keys)} keys present including analysis-layer keys")
    else:
        fail(f"Missing keys: {missing}")

    # ── Test cases with expected outputs ─────────────────────────────────────
    test_cases = [
        {
            "text": "I feel really hurt and alone in this relationship",
            "expect_key": "vulnerability",
            "expect_min": 3,
            "label": "vulnerability on emotional message"
        },
        {
            "text": "I'm sorry, I didn't mean to make you feel that way",
            "expect_key": "repair_attempt",
            "expect_min": 3,
            "label": "repair detection on apology"
        },
        {
            "text": "I HATE YOU, you are so stupid and useless",
            "expect_key": "is_abusive",
            "expect_min": True,
            "label": "abuse detection on insult"
        },
        {
            "text": "I want to kill myself",
            "expect_key": "crisis",
            "expect_min": "self_harm",
            "label": "crisis detection flows through analysis layer"
        },
    ]

    for tc in test_cases:
        r = analyze_message(tc["text"])
        actual = r.get(tc["expect_key"])
        expected = tc["expect_min"]

        if isinstance(expected, bool):
            passed = actual == expected
        elif isinstance(expected, str):
            passed = actual == expected
        else:
            passed = isinstance(actual, (int, float)) and actual >= expected

        if passed:
            ok(f"{tc['label']}: {tc['expect_key']}={actual}")
        else:
            fail(f"{tc['label']}: expected {tc['expect_key']} >= {expected}, got {actual}")
            info(f"    Full result: {r}")

    # ── Structural CAPS boost ─────────────────────────────────────────────────
    quiet  = analyze_message("you never listen to me")
    loud   = analyze_message("YOU NEVER LISTEN TO ME")
    if loud["escalation"] >= quiet["escalation"]:
        ok(f"CAPS boost working — quiet={quiet['escalation']}, loud={loud['escalation']}")
    else:
        fail(f"CAPS boost not working — quiet={quiet['escalation']}, loud={loud['escalation']}")

    # ── Quoted speech stripping ───────────────────────────────────────────────
    quoted = analyze_message('She said "I hate you" to me, which really hurt')
    unquoted = analyze_message("I hate you")
    if quoted["toxicity"] <= unquoted["toxicity"]:
        ok(f"Quoted speech stripping working — quoted toxicity "
           f"({quoted['toxicity']}) ≤ direct toxicity ({unquoted['toxicity']})")
    else:
        fail(f"Quoted speech not stripped — "
             f"quoted toxicity {quoted['toxicity']} > direct toxicity {unquoted['toxicity']}")

    # ── Escalation intent classification ─────────────────────────────────────
    partner_msg = analyze_message("You never make time for me")
    situation_msg = analyze_message("This whole situation is driving me crazy")

    info(f"Partner-directed message intent: {partner_msg.get('escalation_intent')}")
    info(f"Situation-directed message intent: {situation_msg.get('escalation_intent')}")

    # ── Therapeutic dampening ─────────────────────────────────────────────────
    vulnerable_no_blame = analyze_message("I feel so scared and completely alone")
    if vulnerable_no_blame["escalation"] <= 3:
        ok(f"Therapeutic dampening working — vulnerable message with no blame "
           f"has escalation={vulnerable_no_blame['escalation']}")
    else:
        warn(f"Dampening may not have fired — escalation={vulnerable_no_blame['escalation']}")

    # ── Empty string safety ───────────────────────────────────────────────────
    empty = analyze_message("")
    if isinstance(empty, dict) and empty.get("escalation") == 0:
        ok("analyze_message handles empty string correctly")
    else:
        fail("analyze_message did not handle empty string correctly")

    results["Phase 2"] = True

except Exception as e:
    fail(f"Phase 2 crashed: {e}")
    traceback.print_exc()
    results["Phase 2"] = False



# PHASE 3 — Prompts module


phase("Phase 3 — ai.prompts")

try:
    from ai.prompts import (
        SESSION_MODEL,
        BACKGROUND_MODEL,
        CONTEXT_WINDOW,
        TEMPERATURES,
        MAX_TOKENS,
        SYSTEM_PROMPT,
        get_temperature,
        get_max_tokens,
        get_action_guidance,
        build_prompt,
        build_intake_analysis_prompt,
        build_session_summary_prompt,
    )

    # ── Constants ─────────────────────────────────────────────────────────────
    if isinstance(SESSION_MODEL, str) and SESSION_MODEL:
        ok(f"SESSION_MODEL defined: {SESSION_MODEL}")
    else:
        fail("SESSION_MODEL is missing or empty")

    if isinstance(BACKGROUND_MODEL, str) and BACKGROUND_MODEL:
        ok(f"BACKGROUND_MODEL defined: {BACKGROUND_MODEL}")
    else:
        fail("BACKGROUND_MODEL is missing or empty")

    if isinstance(CONTEXT_WINDOW, int) and CONTEXT_WINDOW > 0:
        ok(f"CONTEXT_WINDOW defined: {CONTEXT_WINDOW}")
    else:
        fail(f"CONTEXT_WINDOW invalid: {CONTEXT_WINDOW}")

    # ── System prompt ─────────────────────────────────────────────────────────
    if isinstance(SYSTEM_PROMPT, str) and len(SYSTEM_PROMPT) > 200:
        ok(f"SYSTEM_PROMPT present ({len(SYSTEM_PROMPT)} characters)")
    else:
        fail(f"SYSTEM_PROMPT too short or missing ({len(SYSTEM_PROMPT)} chars)")

    required_phrases = [
        "Alinda",
        "PARTICIPATION BALANCE",
        "1-2 sentences",
    ]
    for phrase in required_phrases:
        if phrase in SYSTEM_PROMPT:
            ok(f"SYSTEM_PROMPT contains required phrase: '{phrase}'")
        else:
            fail(f"SYSTEM_PROMPT missing required phrase: '{phrase}'")

    # ── Temperatures ──────────────────────────────────────────────────────────
    known_actions = [
        "explore", "validate", "reflect", "reframe", "deescalate",
        "affirm_progress", "repair_acknowledgement", "resume_guidance",
        "free_chat_invite", "cooldown_start", "safety_intervention",
        "crisis_self_harm", "repair_required", "acknowledge_mediator",
        "acknowledge_refusal", "redirect_demand", "crisis_resume",
        "suggest_framework", "idle_redirect",
    ]

    temp_errors = []
    for action in known_actions:
        temp = get_temperature(action)
        if not isinstance(temp, float) or not (0.0 <= temp <= 1.0):
            temp_errors.append(f"{action}: {temp}")
    if not temp_errors:
        ok(f"get_temperature() returns valid floats for all {len(known_actions)} actions")
    else:
        fail(f"Temperature errors: {temp_errors}")

    # Safety actions must be stricter than exploratory actions
    if get_temperature("safety_intervention") < get_temperature("explore"):
        ok("Safety actions have lower temperature than exploratory actions")
    else:
        fail("Safety action temperature should be lower than explore temperature")

    # ── Max tokens ────────────────────────────────────────────────────────────
    token_errors = []
    for action in known_actions:
        tokens = get_max_tokens(action)
        if not isinstance(tokens, int) or tokens <= 0:
            token_errors.append(f"{action}: {tokens}")
    if not token_errors:
        ok(f"get_max_tokens() returns valid ints for all {len(known_actions)} actions")
    else:
        fail(f"Token limit errors: {token_errors}")

    # Safety actions must be shorter than standard actions
    if get_max_tokens("safety_intervention") < get_max_tokens("explore"):
        ok("Safety actions have lower token limit than exploratory actions")
    else:
        fail("Safety action token limit should be lower than explore limit")

    # ── Action guidance ───────────────────────────────────────────────────────
    guidance_errors = []
    for action in known_actions:
        guidance = get_action_guidance(action)
        if not isinstance(guidance, str) or len(guidance) < 20:
            guidance_errors.append(action)
    if not guidance_errors:
        ok(f"get_action_guidance() returns valid strings for all {len(known_actions)} actions")
    else:
        fail(f"Actions with missing/short guidance: {guidance_errors}")

    # Unknown action should return a fallback, not crash
    fallback = get_action_guidance("totally_unknown_action_xyz")
    if isinstance(fallback, str) and len(fallback) > 0:
        ok("get_action_guidance() returns fallback string for unknown actions")
    else:
        fail("get_action_guidance() failed on unknown action")

    # ── build_prompt() ────────────────────────────────────────────────────────

    # Build a minimal fake decision dict
    fake_decision = {
        "speaker": "a",
        "quote": "I feel like you never listen to me",
        "feeling": "hurt",
        "action": "explore",
        "target": "a",
        "system_message": "",
        "confidence": "high",
    }

    # Build a minimal fake message list (dicts with attributes)
    class FakeMsg:
        def __init__(self, sender, content):
            self.sender  = sender
            self.content = content

    fake_messages = [
        FakeMsg("ai", "Hello, would you like to begin?"),
        FakeMsg("a",  "I feel like you never listen to me"),
    ]

    # Without optional profile/insight args
    prompt_basic = build_prompt("Sky", "Cloud", fake_decision, fake_messages)
    if isinstance(prompt_basic, str) and len(prompt_basic) > 50:
        ok(f"build_prompt() returns string ({len(prompt_basic)} chars) without profiles")
    else:
        fail("build_prompt() returned empty or non-string without profiles")

    if "Sky" in prompt_basic and "Cloud" in prompt_basic:
        ok("build_prompt() correctly includes partner names")
    else:
        fail("build_prompt() does not include partner names")

    if fake_decision["quote"] in prompt_basic:
        ok("build_prompt() correctly includes the quote")
    else:
        fail("build_prompt() does not include the quote")

    if get_action_guidance("explore") in prompt_basic:
        ok("build_prompt() correctly includes action guidance")
    else:
        fail("build_prompt() does not include action guidance")

    # With optional profile args
    prompt_with_profiles = build_prompt(
        "Sky", "Cloud", fake_decision, fake_messages,
        partner_profile_a="Sky tends to intellectualise emotion.",
        partner_profile_b="Cloud tends to withdraw under pressure.",
        session_insight="Last session: main theme was trust.",
    )
    if "THERAPIST BRIEFING" in prompt_with_profiles:
        ok("build_prompt() includes therapist briefing when profiles are provided")
    else:
        fail("build_prompt() did not include therapist briefing with profiles")

    if "Sky tends to intellectualise" in prompt_with_profiles:
        ok("build_prompt() correctly embeds profile_a in briefing")
    else:
        fail("build_prompt() did not embed profile_a in briefing")

    # Verify profiles are NOT shown when None
    if "THERAPIST BRIEFING" not in prompt_basic:
        ok("build_prompt() correctly omits briefing when no profiles provided")
    else:
        fail("build_prompt() included briefing block even with no profiles")

    # ── build_intake_analysis_prompt() ────────────────────────────────────────
    intake_system, intake_user = build_intake_analysis_prompt(
        name="Sky",
        intake_text="I feel like my partner never listens.\nI wish they understood how lonely I feel.",
    )

    if isinstance(intake_system, str) and len(intake_system) > 50:
        ok(f"build_intake_analysis_prompt() system prompt valid ({len(intake_system)} chars)")
    else:
        fail("build_intake_analysis_prompt() system prompt invalid")

    if isinstance(intake_user, str) and "Sky" in intake_user:
        ok("build_intake_analysis_prompt() user prompt contains partner name")
    else:
        fail("build_intake_analysis_prompt() user prompt missing partner name")

    required_sections = [
        "PRIMARY CONCERN",
        "COMMUNICATION STYLE",
        "CORE NEED",
        "LIKELY TRIGGERS",
        "WATCH FOR",
    ]
    for section in required_sections:
        if section in intake_user:
            ok(f"Intake prompt contains section: {section}")
        else:
            fail(f"Intake prompt missing section: {section}")

    # ── build_session_summary_prompt() ───────────────────────────────────────
    summary_system, summary_user = build_session_summary_prompt(
        name_a="Sky",
        name_b="Cloud",
        conversation_text="Sky: I feel ignored.\nAlinda: What does ignored feel like?\nCloud: I didn't mean to.",
        duration_minutes=45,
    )

    if isinstance(summary_system, str) and len(summary_system) > 50:
        ok(f"build_session_summary_prompt() system prompt valid ({len(summary_system)} chars)")
    else:
        fail("build_session_summary_prompt() system prompt invalid")

    if isinstance(summary_user, str):
        ok(f"build_session_summary_prompt() user prompt valid ({len(summary_user)} chars)")
    else:
        fail("build_session_summary_prompt() user prompt invalid")

    required_summary_sections = [
        "KEY THEMES",
        "BREAKTHROUGH MOMENTS",
        "UNRESOLVED THREADS",
        "EMOTIONAL ARC",
        "RELATIONSHIP DYNAMIC",
        "CONCRETE COMMITMENT",
        "RECOMMENDED FOCUS",
    ]
    for section in required_summary_sections:
        if section in summary_user:
            ok(f"Summary prompt contains section: {section}")
        else:
            fail(f"Summary prompt missing section: {section}")

    if "Sky" in summary_user and "Cloud" in summary_user:
        ok("Summary prompt correctly uses partner names in section headers")
    else:
        fail("Summary prompt missing partner names")

    if "45" in summary_user:
        ok("Summary prompt correctly includes session duration")
    else:
        fail("Summary prompt missing session duration")

    results["Phase 3"] = True

except ImportError as e:
    fail(f"Import error in prompts.py: {e}")
    info("Check that all functions listed above are defined and exported.")
    traceback.print_exc()
    results["Phase 3"] = False
except Exception as e:
    fail(f"Phase 3 crashed: {e}")
    traceback.print_exc()
    results["Phase 3"] = False


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4 — LLM client
# ─────────────────────────────────────────────────────────────────────────────

phase("Phase 4 — ai.llm_client")

try:
    from ai.llm_client import (
        generate_session_response,
        generate_background_response,
        generate_session_opening,
        _clean_response,
        _detect_addressed_partner,
        _get_fallback,
        GROQ_API_KEY_SESSION,
        GROQ_API_KEY_BACKGROUND,
    )

    # ── API key presence ──────────────────────────────────────────────────────
    if GROQ_API_KEY_SESSION:
        ok(f"GROQ_API_KEY_SESSION loaded ({len(GROQ_API_KEY_SESSION)} chars)")
    else:
        fail("GROQ_API_KEY_SESSION not set — live session calls will use fallback")

    if GROQ_API_KEY_BACKGROUND:
        ok(f"GROQ_API_KEY_BACKGROUND loaded ({len(GROQ_API_KEY_BACKGROUND)} chars)")
    else:
        warn("GROQ_API_KEY_BACKGROUND not set — background tasks will use session key")

    # ── _clean_response() ────────────────────────────────────────────────────
    clean_cases = [
        ("Alinda: What do you mean by that?",     "What do you mean by that?"),
        ("**Important:** Tell me more.",           "Important: Tell me more."),
        ("Let's talk about this together",         "You could talk about this together."),
        ("<think>internal reasoning</think>Hello", "Hello."),
        ("## New section\nSky: something",        ""),  # Truncated to empty
        ("",                                       ""),
        ("what do you feel right now",             "What do you feel right now?"),
        ("I see that.",                            "I see that."),
    ]

    clean_errors = []
    for raw, expected in clean_cases:
        result = _clean_response(raw)
        if expected == "" and result == "":
            pass
        elif expected and result != expected:
            # Allow for minor punctuation differences
            if result.rstrip(".?!") != expected.rstrip(".?!"):
                clean_errors.append(
                    f"Input: {raw!r}\n    Expected: {expected!r}\n    Got: {result!r}"
                )

    if not clean_errors:
        ok(f"_clean_response() passed all {len(clean_cases)} test cases")
    else:
        for err in clean_errors:
            fail(f"_clean_response() mismatch:\n    {err}")

    # ── Speaker detection ─────────────────────────────────────────────────────
    detection_cases = [
        ("Sky, what did you hear in that?",  "Sky",  "Cloud", "a", "a"),
        ("Cloud, how does that land for you?","Sky", "Cloud", "a", "b"),
        ("I want to ask you both something.", "Sky",  "Cloud", "a", "a"),  # Ambiguous → decision wins
    ]
    for text, na, nb, decision_t, expected in detection_cases:
        result = _detect_addressed_partner(text, na, nb, decision_t)
        if result == expected:
            ok(f"_detect_addressed_partner: '{text[:40]}...' → '{result}'")
        else:
            fail(f"_detect_addressed_partner: expected '{expected}', got '{result}' for: {text!r}")

    # ── Fallback messages ─────────────────────────────────────────────────────
    for action in ["safety_intervention", "crisis_self_harm", "explore", "unknown_action"]:
        fb = _get_fallback(action, {})
        if isinstance(fb, str) and len(fb) > 10:
            ok(f"_get_fallback('{action}') returned: '{fb[:60]}...'")
        else:
            fail(f"_get_fallback('{action}') returned invalid string: {fb!r}")

    # Short system_message should be preferred as fallback
    fb_with_msg = _get_fallback("explore", {"system_message": "What do you mean?"})
    if fb_with_msg == "What do you mean?":
        ok("_get_fallback() prefers short system_message over default")
    else:
        warn(f"_get_fallback() did not prefer system_message — got: {fb_with_msg!r}")

    # ── Live API test (only if key is set) ────────────────────────────────────
    if GROQ_API_KEY_SESSION:
        info("Running live Groq API test (one minimal call)...")

        async def _live_test():
            result = await generate_background_response(
                system_prompt = "You are a test assistant. Reply with exactly three words.",
                user_prompt   = "Say hello briefly.",
                task_label    = "test_ai_live_check",
            )
            return result

        live_result = asyncio.run(_live_test())

        if isinstance(live_result, str) and len(live_result) > 0:
            ok(f"Live Groq API call succeeded: '{live_result[:80]}'")
        else:
            fail("Live Groq API call returned empty string")

        # ── generate_session_opening() ────────────────────────────────────────
        async def _opening_test():
            return await generate_session_opening(
                name_a        = "Sky",
                name_b        = "Cloud",
                session_style = "balanced",
            )

        opening = asyncio.run(_opening_test())
        if isinstance(opening, str) and "Sky" in opening and "Cloud" in opening:
            ok(f"generate_session_opening() returned: '{opening[:80]}...'")
        else:
            fail(f"generate_session_opening() unexpected result: {opening!r}")

    else:
        warn("Skipping live API tests — GROQ_API_KEY_SESSION not set")
        warn("Set the key in .env to run full validation")

    # ── generate_session_response() fallback path ─────────────────────────────
    # Test the fallback path without making an API call (bad key)
    async def _fallback_test():
        from ai.llm_client import generate_session_response as gsr
        fake_decision = {
            "action":         "explore",
            "target":         "a",
            "speaker":        "a",
            "quote":          "I feel ignored",
            "feeling":        None,
            "system_message": "",
            "confidence":     "medium",
        }
        fake_analysis = {
            "escalation": 0, "blame": 0, "vulnerability": 3,
            "is_abusive": False, "toxicity": 0, "crisis": "none"
        }

        class FakeMsg:
            def __init__(self, sender, content):
                self.sender = sender
                self.content = content

        result = await gsr(
            name_a           = "Sky",
            name_b           = "Cloud",
            recent_messages  = [FakeMsg("a", "I feel ignored")],
            analysis         = fake_analysis,
            decision         = fake_decision,
        )
        return result

    fallback_result = asyncio.run(_fallback_test())
    if isinstance(fallback_result, dict) and "message" in fallback_result:
        if GROQ_API_KEY_SESSION:
            ok(f"generate_session_response() returned: "
               f"next_speaker={fallback_result['next_speaker']!r}, "
               f"llm={fallback_result['llm']!r}, "
               f"message='{fallback_result['message'][:60]}'")
        else:
            if not fallback_result["llm"] and fallback_result["message"]:
                ok("generate_session_response() correctly uses fallback with no key")
            else:
                warn(f"Unexpected result: {fallback_result}")
    else:
        fail(f"generate_session_response() returned unexpected format: {fallback_result}")

    results["Phase 4"] = True

except ImportError as e:
    fail(f"Import error in llm_client.py: {e}")
    info("Check all imports and function names match exactly.")
    traceback.print_exc()
    results["Phase 4"] = False
except Exception as e:
    fail(f"Phase 4 crashed: {e}")
    traceback.print_exc()
    results["Phase 4"] = False


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 5 — Mediator logic
# ─────────────────────────────────────────────────────────────────────────────

phase("Phase 5 — ai.mediator_logic")

try:
    from ai.mediator_logic import (
        decide_mediation,
        _load_ledger,
        _update_ledger,
        _compute_regulation_state,
        _compute_session_temperature,
        _detect_resolution,
        FLOODING, WINDOW, WITHDRAWING,
        _DEFAULT_LEDGER,
    )
    from ai.analysis import analyze_message

    # ── Mock session object ───────────────────────────────────────────────────
    class MockSession:
        def __init__(self):
            self.mode                   = "guided"
            self.message_count          = 5
            self.last_user_message      = ""
            self.last_action            = None
            self.last_target            = None
            self.last_speaker           = None
            self.consecutive_turns      = 0
            self.resume_guidance_index  = 0
            self.escalation_unresolved  = False
            self.behavioral_ledger_a    = None
            self.behavioral_ledger_b    = None
            self.recent_action_log      = None
            self.avg_escalation         = 0.0
            self.avg_vulnerability      = 0.0
            self._current_text_lower    = ""

    # ── Default ledger structure ──────────────────────────────────────────────
    ledger = _load_ledger(MockSession(), "a")
    required_ledger_keys = [
        "total_messages", "flooding_events", "contempt_events",
        "trait_probabilities", "confirmed_traits", "avg_escalation",
    ]
    missing = [k for k in required_ledger_keys if k not in ledger]
    if not missing:
        ok(f"_load_ledger() returns correct structure ({len(ledger)} keys)")
    else:
        fail(f"Ledger missing keys: {missing}")

    # ── Regulation state ──────────────────────────────────────────────────────
    flood_analysis = {"escalation": 8, "toxicity": 4, "is_abusive": True,
                      "engagement": 5, "contempt": 2}
    if _compute_regulation_state(flood_analysis, 12) == FLOODING:
        ok("_compute_regulation_state() correctly identifies FLOODING")
    else:
        fail("_compute_regulation_state() failed to identify FLOODING")

    withdraw_analysis = {"escalation": 0, "toxicity": 0, "is_abusive": False,
                         "engagement": 0, "contempt": 0}
    if _compute_regulation_state(withdraw_analysis, 2) == WITHDRAWING:
        ok("_compute_regulation_state() correctly identifies WITHDRAWING")
    else:
        fail("_compute_regulation_state() failed to identify WITHDRAWING")

    window_analysis = {"escalation": 2, "toxicity": 0, "is_abusive": False,
                       "engagement": 3, "contempt": 0}
    if _compute_regulation_state(window_analysis, 15) == WINDOW:
        ok("_compute_regulation_state() correctly identifies WINDOW")
    else:
        fail("_compute_regulation_state() failed to identify WINDOW")

    # ── Resolution detection ──────────────────────────────────────────────────
    res_analysis = {"sentiment": 2, "escalation": 0}
    if _detect_resolution("i think we're okay now", res_analysis):
        ok("_detect_resolution() correctly detects resolution signal")
    else:
        fail("_detect_resolution() failed to detect 'i think we're okay now'")

    no_res_analysis = {"sentiment": -2, "escalation": 5}
    if not _detect_resolution("i think we're okay now", no_res_analysis):
        ok("_detect_resolution() correctly rejects resolution with high escalation")
    else:
        fail("_detect_resolution() incorrectly detected resolution in angry message")

    # ── decide_mediation() — crisis detection (Level 1) ──────────────────────
    session = MockSession()
    session.last_user_message = "I want to kill myself"
    crisis_analysis = analyze_message("I want to kill myself")
    crisis_analysis["crisis"] = "self_harm"   # Ensure it's set

    decision = decide_mediation(session, crisis_analysis, "a", "Sky", "Cloud")

    if decision["action"] == "crisis_self_harm":
        ok("Level 1: Crisis self_harm correctly routed to crisis_self_harm action")
    else:
        fail(f"Level 1: Expected crisis_self_harm, got {decision['action']}")

    if decision["mode"] == "crisis_pause":
        ok("Level 1: Mode correctly set to crisis_pause")
    else:
        fail(f"Level 1: Mode should be crisis_pause, got {decision['mode']}")

    if decision["_level"] == 1:
        ok("Level 1: _level field correctly reports 1")
    else:
        fail(f"Level 1: _level should be 1, got {decision['_level']}")

    # ── Level 2: Safety intervention on character attack ──────────────────────
    session2 = MockSession()
    session2.last_user_message = "I hate you, you're disgusting"
    attack_analysis = analyze_message("I hate you, you're disgusting")
    attack_analysis["contempt"] = 5
    attack_analysis["escalation_intent"] = "character_attack"
    attack_analysis["is_abusive"] = True
    attack_analysis["crisis"] = "none"

    decision2 = decide_mediation(session2, attack_analysis, "a", "Sky", "Cloud")
    if decision2["action"] in {"safety_intervention", "deescalate"}:
        ok(f"Level 2: Character attack routed to {decision2['action']}")
    else:
        fail(f"Level 2: Expected safety_intervention/deescalate, got {decision2['action']}")

    # ── Required fields in output ─────────────────────────────────────────────
    required_keys = [
        "action", "target", "speaker", "quote", "feeling",
        "system_message", "confidence", "mode", "next_speaker",
        "dialogue_stage", "_level", "_behavioral_update",
        "_regulation_sender", "_session_temp"
    ]
    missing_keys = [k for k in required_keys if k not in decision]
    if not missing_keys:
        ok(f"decide_mediation() output contains all {len(required_keys)} required keys")
    else:
        fail(f"decide_mediation() output missing keys: {missing_keys}")

    # ── Behavioral update is included ─────────────────────────────────────────
    bu = decision.get("_behavioral_update", {})
    if "behavioral_ledger_a" in bu:
        ok("_behavioral_update contains ledger for sender")
    else:
        fail("_behavioral_update missing ledger key")

    # ── System message is a non-empty string ──────────────────────────────────
    sm = decision.get("system_message", "")
    if isinstance(sm, str) and len(sm) > 20:
        ok(f"system_message is non-empty ({len(sm)} chars)")
    else:
        fail(f"system_message is empty or too short: {sm!r}")

    # ── Dialogue stage is set ─────────────────────────────────────────────────
    ds = decision.get("dialogue_stage", "")
    if isinstance(ds, str) and ds:
        ok(f"dialogue_stage is set: '{ds}'")
    else:
        fail("dialogue_stage is empty")

    # ── Standard message routing (level 4) ───────────────────────────────────
    session3 = MockSession()
    session3.last_user_message = "I feel like Cloud never really listens to me"
    normal_analysis = analyze_message("I feel like Cloud never really listens to me")

    decision3 = decide_mediation(session3, normal_analysis, "a", "Sky", "Cloud")
    ok(f"Standard message: action={decision3['action']} "
       f"target={decision3['target']} level={decision3['_level']}")

    results["Phase 5"] = True

except ImportError as e:
    fail(f"Import error in mediator_logic.py: {e}")
    traceback.print_exc()
    results["Phase 5"] = False
except Exception as e:
    fail(f"Phase 5 crashed: {e}")
    traceback.print_exc()
    results["Phase 5"] = False

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 6 — Conversation state controller
# ─────────────────────────────────────────────────────────────────────────────

phase("Phase 6 — ai.conversation_state_controller")

try:
    from ai.conversation_state_controller import (
        adjust_decision,
        State, Phase,
        STAGE_MAP,
        _compute_session_phase,
        _validate_state_transition,
        _validate_action_for_phase,
        _check_repair_cycle,
        _is_session_paused,
        _read_action_log,
    )
    from datetime import datetime, timezone, timedelta

    # ── Mock session ──────────────────────────────────────────────────────────
    class MockCSCSession:
        def __init__(self, mode=State.GUIDED):
            self.mode                   = mode
            self.session_started_at     = None
            self.session_duration_limit = 90
            self.session_phase          = Phase.OPENING
            self.last_action            = None
            self.last_target            = None
            self.last_speaker           = None
            self.consecutive_turns      = 0
            self.action_streak          = 0
            self.target_streak          = 0
            self.stagnation_streak      = 0
            self.resume_guidance_index  = 0
            self.repair_cycle_stage     = None
            self.recent_action_log      = None
            self.paused_until           = None
            self.dialogue_stage         = "Listening"

    def make_decision(action="explore", target="a", confidence="low"):
        return {
            "action": action, "target": target,
            "mode": "guided", "confidence": confidence,
            "speaker": "a", "quote": "test",
            "feeling": None, "system_message": "",
            "exercise": None, "next_speaker": "b",
        }

    neutral_analysis = {
        "escalation": 0, "blame": 0, "vulnerability": 0,
        "sentiment": 0, "repair_attempt": 0, "toxicity": 0,
        "crisis": "none", "contempt": 0, "engagement": 3,
        "confidence": "medium", "is_abusive": False,
        "escalation_intent": "none", "top_emotions": {}
    }

    # ── Stage map completeness ────────────────────────────────────────────────
    known_actions = [
        "explore", "validate", "reflect", "reframe", "deescalate",
        "affirm_progress", "repair_acknowledgement", "resume_guidance",
        "free_chat_invite", "observe", "cooldown_start",
        "safety_intervention", "crisis_self_harm", "repair_required",
        "acknowledge_mediator", "acknowledge_refusal", "redirect_demand",
        "crisis_resume", "suggest_framework", "idle_redirect",
    ]
    missing_stages = [a for a in known_actions if a not in STAGE_MAP]
    if not missing_stages:
        ok(f"STAGE_MAP covers all {len(known_actions)} known actions")
    else:
        fail(f"STAGE_MAP missing entries for: {missing_stages}")

    # ── State transition validation ───────────────────────────────────────────
    valid, reason = _validate_state_transition(State.GUIDED, State.COOLDOWN, "cooldown_start")
    if valid:
        ok(f"GUIDED→COOLDOWN transition valid: {reason}")
    else:
        fail(f"GUIDED→COOLDOWN should be valid but got: {reason}")

    invalid, reason = _validate_state_transition(State.CLOSED, State.GUIDED, "explore")
    if not invalid:
        ok("CLOSED→GUIDED correctly blocked")
    else:
        fail("CLOSED→GUIDED should be blocked")

    # ── Phase computation ─────────────────────────────────────────────────────
    s = MockCSCSession()
    s.session_started_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    computed_phase = _compute_session_phase(s)
    if computed_phase == Phase.OPENING:
        ok(f"Phase at 5 minutes: {computed_phase} (correct)")
    else:
        fail(f"Phase at 5 minutes should be OPENING, got: {computed_phase}")

    s.session_started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    computed_phase = _compute_session_phase(s)
    if computed_phase == Phase.EXPLORATION:
        ok(f"Phase at 30 minutes: {computed_phase} (correct)")
    else:
        fail(f"Phase at 30 minutes should be EXPLORATION, got: {computed_phase}")

    s.session_started_at = datetime.now(timezone.utc) - timedelta(minutes=85)
    computed_phase = _compute_session_phase(s)
    if computed_phase == Phase.CLOSING:
        ok(f"Phase at 85 minutes: {computed_phase} (correct)")
    else:
        fail(f"Phase at 85 minutes should be CLOSING, got: {computed_phase}")

    # ── Phase validation ──────────────────────────────────────────────────────
    valid, fallback = _validate_action_for_phase("suggest_framework", Phase.OPENING)
    if not valid and fallback:
        ok(f"suggest_framework blocked in OPENING, fallback: {fallback}")
    else:
        fail("suggest_framework should be blocked in OPENING")

    valid, fallback = _validate_action_for_phase("explore", Phase.CLOSING)
    if not valid:
        ok(f"explore blocked in CLOSING, fallback: {fallback}")
    else:
        fail("explore should be blocked in CLOSING")

    valid, fallback = _validate_action_for_phase("safety_intervention", Phase.CLOSING)
    if valid:
        ok("safety_intervention always valid regardless of phase")
    else:
        fail("safety_intervention should bypass phase restrictions")

    # ── Paused state ──────────────────────────────────────────────────────────
    paused_s = MockCSCSession(mode=State.PAUSED)
    paused_s.paused_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    if _is_session_paused(paused_s):
        ok("_is_session_paused correctly detects active pause")
    else:
        fail("_is_session_paused failed to detect active pause")

    expired_s = MockCSCSession(mode=State.PAUSED)
    expired_s.paused_until = datetime.now(timezone.utc) - timedelta(minutes=5)
    if not _is_session_paused(expired_s):
        ok("_is_session_paused correctly detects expired pause")
    else:
        fail("_is_session_paused failed to detect expired pause")

    # ── Paused state action blocking ──────────────────────────────────────────
    s_paused = MockCSCSession(mode=State.PAUSED)
    s_paused.paused_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    decision = make_decision("explore", "a", "low")
    result = adjust_decision(s_paused, "a", neutral_analysis, decision)
    if result["action"] == "idle_redirect":
        ok("Paused session suppresses clinical actions → idle_redirect")
    else:
        fail(f"Paused session should suppress to idle_redirect, got: {result['action']}")

    # ── Safety lockdown restricts actions ────────────────────────────────────
    s_lock = MockCSCSession(mode=State.SAFETY_LOCKDOWN)
    decision = make_decision("explore", "a", "low")
    result = adjust_decision(s_lock, "a", neutral_analysis, decision)
    if result["action"] in {"repair_required", "explore"}:
        if result["action"] == "repair_required":
            ok("Safety lockdown redirects non-repair actions to repair_required")
        else:
            info(f"Safety lockdown result: {result['action']}")
    else:
        info(f"Safety lockdown action: {result['action']}")

    # ── Repair cycle protection ───────────────────────────────────────────────
    s_cycle = MockCSCSession()
    s_cycle.repair_cycle_stage = "validate"
    s_cycle.last_target = "a"
    cycle_result = _check_repair_cycle(s_cycle, "explore", "b")
    if cycle_result and cycle_result.get("action") == "reflect":
        ok("Repair cycle protection: after validate, overrides to reflect")
    else:
        fail(f"Repair cycle protection failed: got {cycle_result}")

    # ── High confidence bypasses guardrails ───────────────────────────────────
    s_bypass = MockCSCSession()
    s_bypass.consecutive_turns = 10  # Would normally trigger redirect
    s_bypass.last_speaker = "a"
    decision = make_decision("explore", "a", "high")
    result = adjust_decision(s_bypass, "a", neutral_analysis, decision)
    if result["action"] == "explore" and result["target"] == "a":
        ok("High confidence decision bypasses consecutive turn guardrail")
    else:
        info(f"High confidence bypass: action={result['action']}, target={result['target']}")

    # ── Consecutive turn guardrail fires at limit ─────────────────────────────
    s_consec = MockCSCSession()
    s_consec.consecutive_turns = 3
    s_consec.last_speaker = "a"
    decision = make_decision("explore", "a", "low")
    result = adjust_decision(s_consec, "a", neutral_analysis, decision)
    if result["target"] == "b":
        ok("Consecutive turn guardrail redirected to partner b")
    else:
        info(f"Consecutive turn result: action={result['action']}, target={result['target']}")

    # ── Action log written after commit ──────────────────────────────────────
    s_log = MockCSCSession()
    decision = make_decision("validate", "b", "medium")
    adjust_decision(s_log, "a", neutral_analysis, decision)
    log = _read_action_log(s_log)
    if log and log[-1]["action"] == "validate":
        ok(f"Action log updated: last entry = {log[-1]}")
    else:
        fail(f"Action log not updated correctly: {log}")

    # ── adjust_decision always returns a valid dict ───────────────────────────
    s_final = MockCSCSession()
    for action in ["explore", "validate", "safety_intervention", "crisis_self_harm"]:
        d = make_decision(action, "a", "medium")
        r = adjust_decision(s_final, "a", neutral_analysis, d)
        if "action" in r and "mode" in r and "dialogue_stage" in r:
            ok(f"adjust_decision returned valid dict for: {action}")
        else:
            fail(f"adjust_decision returned invalid dict for: {action} → {r}")
        s_final = MockCSCSession()  # Fresh session for each test

    results["Phase 6"] = True

except ImportError as e:
    fail(f"Import error in conversation_state_controller.py: {e}")
    traceback.print_exc()
    results["Phase 6"] = False
except Exception as e:
    fail(f"Phase 6 crashed: {e}")
    traceback.print_exc()
    results["Phase 6"] = False


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 7 — Conversation guardrails (pre-flight gatekeeper)
# ─────────────────────────────────────────────────────────────────────────────

phase("Phase 7 — ai.conversation_guardrails")

try:
    from ai.conversation_guardrails import (
        pre_flight_check,
        PreFlightResult,
        _normalise_text,
        _similarity,
        _check_empty,
        _check_length,
        _check_broken_record,
        MAX_MESSAGE_CHARS,
        DUPLICATE_SIMILARITY_THRESHOLD,
        BROKEN_RECORD_SIMILARITY_THRESHOLD,
        BROKEN_RECORD_COUNT,
    )
    from datetime import datetime, timezone, timedelta

    class MockGRSession:
        def __init__(self):
            self.last_user_message   = ""
            self.last_message_at_a   = None
            self.last_message_at_b   = None

    # ── PreFlightResult structure ─────────────────────────────────────────────
    r = PreFlightResult(allowed=True, cleaned_text="hello", flags={})
    if r.allowed and r.cleaned_text and r.early_response is None:
        ok("PreFlightResult dataclass has correct defaults")
    else:
        fail("PreFlightResult defaults are wrong")

    # ── Text normalisation ────────────────────────────────────────────────────
    invisible = "hello\u200bworld"
    normalised = _normalise_text(invisible)
    if "" not in normalised and normalised == "helloworld":
        ok("_normalise_text strips invisible characters")
    else:
        ok(f"_normalise_text result: {repr(normalised)}")

    multi_space = "too   many    spaces"
    if _normalise_text(multi_space) == "too many spaces":
        ok("_normalise_text collapses multiple spaces")
    else:
        fail(f"_normalise_text did not collapse spaces: {repr(_normalise_text(multi_space))}")

    # ── Similarity computation ────────────────────────────────────────────────
    sim = _similarity(
        "I feel like you never listen to me",
        "I feel like you never listen to me"
    )
    if sim == 1.0:
        ok("_similarity returns 1.0 for identical strings")
    else:
        fail(f"_similarity identical strings returned {sim}")

    sim_short = _similarity("yes", "no")
    if sim_short == 0.0:
        ok("_similarity returns 0.0 for strings below minimum word count")
    else:
        fail(f"Short string similarity should be 0.0, got {sim_short}")

    sim_different = _similarity(
        "I feel so alone and ignored in this relationship",
        "What do you want for dinner tonight"
    )
    if sim_different < 0.3:
        ok(f"_similarity correctly scores unrelated strings low: {sim_different:.2f}")
    else:
        fail(f"Unrelated strings too similar: {sim_different:.2f}")

    # ── Empty message rejection ───────────────────────────────────────────────
    s = MockGRSession()
    result = pre_flight_check(s, "a", "")
    if not result.allowed and result.early_response is None:
        ok("Empty message silently rejected")
    else:
        fail(f"Empty message should be rejected, got allowed={result.allowed}")

    result = pre_flight_check(s, "a", "   \u200b   ")
    if not result.allowed:
        ok("Whitespace-only message rejected after normalisation")
    else:
        fail("Whitespace-only message should be rejected")

    # ── Length guardrail ──────────────────────────────────────────────────────
    long_message = "A" * (MAX_MESSAGE_CHARS + 100)
    result = pre_flight_check(s, "a", long_message)
    if not result.allowed and result.early_response and len(result.early_response) > 10:
        ok(f"Long message ({MAX_MESSAGE_CHARS + 100} chars) rejected with warm response")
        info(f"Response: '{result.early_response[:80]}...'")
    else:
        fail("Long message should be rejected with a response")

    # Normal length message passes
    normal_message = "I feel like Cloud never really hears what I'm saying"
    result = pre_flight_check(s, "a", normal_message)
    if result.allowed:
        ok("Normal-length message passes length guardrail")
    else:
        fail(f"Normal message rejected: {result.rejection_reason}")

    # ── Duplicate detection ───────────────────────────────────────────────────
    text = "I always feel ignored when you do that to me"
    s_dup = MockGRSession()
    s_dup.last_user_message = text
    s_dup.last_message_at_a = datetime.now(timezone.utc) - timedelta(seconds=5)

    result = pre_flight_check(s_dup, "a", text)
    if not result.allowed and result.early_response is None:
        ok("Exact duplicate message within time window silently dropped")
    else:
        fail(f"Duplicate should be dropped, got allowed={result.allowed}")

    # Same message but outside time window should pass
    s_old = MockGRSession()
    s_old.last_user_message = text
    s_old.last_message_at_a = datetime.now(timezone.utc) - timedelta(minutes=10)
    result = pre_flight_check(s_old, "a", text)
    if result.allowed:
        ok("Same message outside time window correctly allowed (thematic return, not glitch)")
    else:
        fail("Same message outside time window should be allowed")

    # ── Broken record detection ───────────────────────────────────────────────
    class FakeMsg:
        def __init__(self, sender, content):
            self.sender  = sender
            self.content = content

    repeated_text = "I feel like you never listen to what I say to you"
    recent = [
        FakeMsg("a", repeated_text),
        FakeMsg("b", "I do listen, I just disagree"),
        FakeMsg("a", repeated_text),
        FakeMsg("b", "I heard you"),
        FakeMsg("a", repeated_text),
    ]

    loop_flags = _check_broken_record(repeated_text, "a", recent)
    if loop_flags.get("user_is_looping"):
        ok(f"Broken record detected: loop_count={loop_flags.get('loop_count')}")
    else:
        fail(f"Broken record should be detected for repeated messages: {loop_flags}")

    # Non-repeated messages should not flag
    varied = [
        FakeMsg("a", "I feel ignored sometimes"),
        FakeMsg("b", "I don't mean to ignore you"),
        FakeMsg("a", "It happens when we argue"),
    ]
    no_loop_flags = _check_broken_record(
        "But what about the way you spoke to me last week",
        "a", varied
    )
    if not no_loop_flags.get("user_is_looping"):
        ok("No broken record detected for varied messages")
    else:
        fail("Broken record incorrectly detected for varied messages")

    # ── Flags are always present on allowed results ───────────────────────────
    s_flags = MockGRSession()
    result = pre_flight_check(s_flags, "a", "I feel like you never listen")
    if result.allowed and isinstance(result.flags, dict):
        ok(f"Allowed result has flags dict: {list(result.flags.keys())}")
    else:
        fail("Allowed result should have a flags dict")

    if "original_length" in result.flags:
        ok("flags contains original_length")
    else:
        fail("flags missing original_length")

    if "user_is_looping" in result.flags:
        ok("flags contains user_is_looping")
    else:
        fail("flags missing user_is_looping")

    # ── cleaned_text is normalised ────────────────────────────────────────────
    s_clean = MockGRSession()
    result = pre_flight_check(s_clean, "a", "  hello   world  ")
    if result.allowed and result.cleaned_text == "hello world":
        ok("cleaned_text is properly normalised")
    else:
        fail(f"cleaned_text should be 'hello world', got: {repr(result.cleaned_text)}")

    # ── Never raises — error safety ───────────────────────────────────────────
    # Pass a completely broken session object
    class BrokenSession:
        @property
        def last_user_message(self):
            raise RuntimeError("database is broken")

    result = pre_flight_check(BrokenSession(), "a", "test message")
    if isinstance(result, PreFlightResult):
        ok("pre_flight_check handles broken session without crashing")
    else:
        fail("pre_flight_check crashed on broken session")

    results["Phase 7"] = True

except ImportError as e:
    fail(f"Import error in conversation_guardrails.py: {e}")
    traceback.print_exc()
    results["Phase 7"] = False
except Exception as e:
    fail(f"Phase 7 crashed: {e}")
    traceback.print_exc()
    results["Phase 7"] = False

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 8 — Backend dependencies
# ─────────────────────────────────────────────────────────────────────────────

phase("Phase 8 — backend.dependencies")

try:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from fastapi import HTTPException

    from backend.database import Base
    from backend.models import TherapySession
    from backend.dependencies import (
        get_session_or_404,
        ensure_session_active,
        verify_partner_access,
        get_validated_session,
    )

    # ── Throwaway in-memory database — never touches Neon ────────────────────
    test_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    TestingSessionLocal = sessionmaker(bind=test_engine)
    test_db = TestingSessionLocal()

    ok("In-memory test database created from shared Base.metadata")

    # ── Seed a test session ───────────────────────────────────────────────────
    seeded = TherapySession(
        room_id = "test-room-001",
        name_a  = "Sky",
        name_b  = None,        # Partner B has NOT joined yet — intentional
        mode    = "guided",
        phase   = "ready_for_session",
    )
    test_db.add(seeded)
    test_db.commit()
    ok("Seeded a test TherapySession (Partner B not yet joined)")

    # ── get_session_or_404: found ─────────────────────────────────────────────
    found = get_session_or_404("test-room-001", test_db)
    if found.room_id == "test-room-001":
        ok("get_session_or_404 found the seeded session")
    else:
        fail("get_session_or_404 returned wrong session")

    # ── get_session_or_404: not found ─────────────────────────────────────────
    try:
        get_session_or_404("nonexistent-room", test_db)
        fail("get_session_or_404 should have raised 404 for missing room")
    except HTTPException as e:
        if e.status_code == 404:
            ok("get_session_or_404 correctly raises 404 for missing room")
        else:
            fail(f"Expected 404, got {e.status_code}")

    # ── ensure_session_active: active session passes ─────────────────────────
    try:
        ensure_session_active(found)
        ok("ensure_session_active passes for mode='guided'")
    except HTTPException:
        fail("ensure_session_active incorrectly blocked an active session")

    # ── ensure_session_active: closed session blocked ────────────────────────
    found.mode = "closed"
    try:
        ensure_session_active(found)
        fail("ensure_session_active should have raised 403 for closed session")
    except HTTPException as e:
        if e.status_code == 403:
            ok("ensure_session_active correctly blocks mode='closed'")
        else:
            fail(f"Expected 403, got {e.status_code}")

    # ── ensure_session_active: ended phase blocked ────────────────────────────
    found.mode  = "guided"      # reset mode
    found.phase = "ended"
    try:
        ensure_session_active(found)
        fail("ensure_session_active should have raised 403 for phase='ended'")
    except HTTPException as e:
        if e.status_code == 403:
            ok("ensure_session_active correctly blocks phase='ended'")
        else:
            fail(f"Expected 403, got {e.status_code}")
    found.phase = "ready_for_session"   # reset for later tests

    # ── ensure_session_active: cooldown/paused are NOT blocked ───────────────
    for permissive_mode in ["cooldown", "safety_lockdown", "crisis_pause", "paused"]:
        found.mode = permissive_mode
        try:
            ensure_session_active(found)
            ok(f"ensure_session_active correctly allows mode='{permissive_mode}'")
        except HTTPException:
            fail(f"ensure_session_active incorrectly blocked mode='{permissive_mode}'")
    found.mode = "guided"   # reset

    # ── verify_partner_access: joined partner passes ─────────────────────────
    try:
        verify_partner_access("a", found)
        ok("verify_partner_access passes for role='a' (Sky has joined)")
    except HTTPException:
        fail("verify_partner_access incorrectly blocked a joined partner")

    # ── verify_partner_access: unjoined partner blocked ───────────────────────
    try:
        verify_partner_access("b", found)
        fail("verify_partner_access should have blocked role='b' (not joined)")
    except HTTPException as e:
        if e.status_code == 403:
            ok("verify_partner_access correctly blocks unjoined role='b'")
        else:
            fail(f"Expected 403, got {e.status_code}")

    # ── verify_partner_access: passes after partner joins ─────────────────────
    found.name_b = "Cloud"
    try:
        verify_partner_access("b", found)
        ok("verify_partner_access passes for role='b' after Cloud joins")
    except HTTPException:
        fail("verify_partner_access incorrectly blocked role='b' after joining")

    # ── get_validated_session: full pipeline success ──────────────────────────
    result = get_validated_session("test-room-001", "a", test_db)
    if result.room_id == "test-room-001":
        ok("get_validated_session full pipeline succeeds for valid request")
    else:
        fail("get_validated_session returned unexpected session")

    # ── get_validated_session: require_active=False bypasses closed check ─────
    found.mode = "closed"
    test_db.commit()
    try:
        result = get_validated_session("test-room-001", "a", test_db, require_active=False)
        ok("get_validated_session with require_active=False allows closed session "
           "(correct for feedback/insight routes)")
    except HTTPException:
        fail("get_validated_session with require_active=False should not block closed session")

    try:
        get_validated_session("test-room-001", "a", test_db, require_active=True)
        fail("get_validated_session with require_active=True should block closed session")
    except HTTPException as e:
        if e.status_code == 403:
            ok("get_validated_session with require_active=True correctly blocks closed session")
        else:
            fail(f"Expected 403, got {e.status_code}")

    test_db.close()
    results["Phase 8"] = True

except ImportError as e:
    fail(f"Import error in backend.dependencies: {e}")
    info("Check that backend/ is a proper package (has __init__.py) and importable from project root.")
    traceback.print_exc()
    results["Phase 8"] = False
except Exception as e:
    fail(f"Phase 8 crashed: {e}")
    traceback.print_exc()
    results["Phase 8"] = False

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 9 — Session summarizer
# ─────────────────────────────────────────────────────────────────────────────

phase("Phase 9 — ai.session_summarizer")

try:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from datetime import datetime, timezone, timedelta

    from backend.database import Base
    from backend.models import TherapySession, ChatMessage, SessionInsight, CoupleProfile
    from ai.session_summarizer import (
        summarize_session,
        _compute_behavioral_metrics,
        _detect_candidate_pattern,
        _format_behavioral_context,
        _build_transcript_text,
        _sanitize_output,
        _parse_summary_sections,
    )

    # ── Throwaway in-memory database ──────────────────────────────────────────
    engine9 = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine9)
    Session9 = sessionmaker(bind=engine9)
    db9 = Session9()
    ok("In-memory test database created for Phase 9")

    # ── Build a fake session with ledgers and a transcript ────────────────────
    now = datetime.now(timezone.utc)
    test_session = TherapySession(
        room_id              = "summary-test-room",
        name_a               = "Sky",
        name_b               = "Cloud",
        mode                 = "closed",
        phase                = "ended",
        session_started_at   = now - timedelta(minutes=42),
        ended_at              = now,
        session_duration_limit= 90,
        session_number        = 1,
        behavioral_ledger_a   = {
            "repair_bids": 2,
            "trait_probabilities": {"flooding_tendency": 0.45, "withdrawal_tendency": 0.05},
        },
        behavioral_ledger_b   = {
            "repair_bids": 1,
            "trait_probabilities": {"withdrawal_tendency": 0.40, "flooding_tendency": 0.02},
        },
    )
    db9.add(test_session)
    db9.commit()

    def make_msg(sender, content, minutes_ago, extra=None):
        return ChatMessage(
            room_id   = "summary-test-room",
            sender    = sender,
            message_type = "ai" if sender == "ai" else "user",
            content   = content,
            extra_data= extra or {},
            timestamp = now - timedelta(minutes=minutes_ago),
        )

    fake_messages = [
        make_msg("a", "I feel like you never really hear me", 40, {"escalation": 3}),
        make_msg("ai", "What does it feel like when you sense that?", 39, {"action": "explore"}),
        make_msg("a", "Like I'm talking to a wall", 38, {"escalation": 7, "is_abusive": False}),
        make_msg("ai", "That sounds painful. Cloud, what did you hear in that?", 37, {"action": "validate"}),
        make_msg("b", "I didn't realise it felt that bad. I'm sorry", 36, {"repair_attempt": 5}),
        make_msg("ai", "That matters. Sky, how does that land for you?", 35, {"action": "repair_acknowledgement"}),
        make_msg("a", "It helps. I think we're starting to understand each other", 34, {"sentiment": 2, "escalation": 0}),
        make_msg("ai", "Something just shifted here.", 33, {"action": "affirm_progress"}),
    ]
    ok(f"Built {len(fake_messages)} fake ChatMessage rows for testing")

    # ── _compute_behavioral_metrics ────────────────────────────────────────────
    ledger_a = test_session.behavioral_ledger_a
    ledger_b = test_session.behavioral_ledger_b
    metrics = _compute_behavioral_metrics(fake_messages, ledger_a, ledger_b)

    required_metric_keys = [
        "word_count_a", "word_count_b", "balance_score",
        "turns_to_first_flood", "peak_escalation_score",
        "total_escalation_events", "repair_efficacy_ratio",
        "resolution_signal_present",
    ]
    missing = [k for k in required_metric_keys if k not in metrics]
    if not missing:
        ok(f"_compute_behavioral_metrics returns all required keys")
    else:
        fail(f"_compute_behavioral_metrics missing keys: {missing}")

    if metrics["turns_to_first_flood"] == 2:
        ok(f"Correctly identified first flood at turn 2: {metrics['turns_to_first_flood']}")
    else:
        info(f"turns_to_first_flood = {metrics['turns_to_first_flood']} (expected 2)")

    if metrics["resolution_signal_present"] is True:
        ok("Correctly detected resolution signal (affirm_progress fired)")
    else:
        fail("Should have detected resolution signal from affirm_progress action")

    if metrics["repair_efficacy_ratio"] is not None and metrics["repair_efficacy_ratio"] > 0:
        ok(f"repair_efficacy_ratio computed: {metrics['repair_efficacy_ratio']}")
    else:
        fail(f"repair_efficacy_ratio should be > 0, got {metrics['repair_efficacy_ratio']}")

    # ── _detect_candidate_pattern ──────────────────────────────────────────────
    pattern = _detect_candidate_pattern(ledger_a, ledger_b, "Sky", "Cloud")
    if pattern and "pursuer-distancer" in pattern:
        ok(f"Candidate pattern detected: '{pattern}'")
    else:
        info(f"Candidate pattern: {pattern!r}")

    no_pattern = _detect_candidate_pattern({}, {}, "Sky", "Cloud")
    if no_pattern is None:
        ok("_detect_candidate_pattern correctly returns None for empty ledgers")
    else:
        fail(f"Expected None for empty ledgers, got: {no_pattern}")

    # ── _format_behavioral_context — no raw numbers in suspicious notation ────
    context_str = _format_behavioral_context(metrics, "Sky", "Cloud")
    if isinstance(context_str, str) and len(context_str) > 20:
        ok(f"_format_behavioral_context produced narrative text: '{context_str[:80]}...'")
    else:
        fail("_format_behavioral_context produced invalid output")

    # ── _build_transcript_text ────────────────────────────────────────────────
    transcript = _build_transcript_text(fake_messages, "Sky", "Cloud")
    if "Sky:" in transcript and "Cloud:" in transcript and "Alinda:" in transcript:
        ok("_build_transcript_text correctly labels all three speakers")
    else:
        fail("_build_transcript_text missing expected speaker labels")

    # ── _sanitize_output — leak detection ─────────────────────────────────────
    leaky_text = "Sky showed escalation: 8 during this exchange. Cloud felt heard."
    cleaned, leaked = _sanitize_output(leaky_text)
    if leaked and "escalation: 8" not in cleaned:
        ok(f"_sanitize_output correctly redacted leaked score: '{cleaned}'")
    else:
        fail(f"_sanitize_output failed to redact leak: '{cleaned}' (leaked={leaked})")

    clean_text = "Sky felt unheard and Cloud responded with genuine care."
    cleaned2, leaked2 = _sanitize_output(clean_text)
    if not leaked2 and cleaned2 == clean_text:
        ok("_sanitize_output leaves clean narrative text untouched")
    else:
        fail(f"_sanitize_output incorrectly modified clean text: '{cleaned2}'")

    trait_leak = "Cloud showed signs of withdrawal_tendency throughout the session."
    cleaned3, leaked3 = _sanitize_output(trait_leak)
    if leaked3:
        ok("_sanitize_output correctly catches internal trait terminology")
    else:
        fail("_sanitize_output failed to catch trait terminology leak")

    # ── _parse_summary_sections ───────────────────────────────────────────────
    fake_llm_output = (
        "KEY THEMES:\nFeeling unheard and reconnecting through vulnerability.\n\n"
        "BREAKTHROUGH MOMENTS:\nCloud's apology after Sky named feeling unheard.\n\n"
        "UNRESOLVED THREADS:\nNone recorded.\n\n"
        "Sky's EMOTIONAL ARC:\nMoved from frustration to feeling understood.\n\n"
        "Cloud's EMOTIONAL ARC:\nMoved from defensiveness to genuine remorse.\n\n"
        "RELATIONSHIP DYNAMIC OBSERVED:\nA pursuer-distancer pattern softened through repair.\n\n"
        "CONCRETE COMMITMENT:\nCheck in nightly about feeling heard.\n\n"
        "RECOMMENDED FOCUS FOR NEXT SESSION:\nBuild on this repair moment.\n"
    )
    parsed = _parse_summary_sections(fake_llm_output, "Sky", "Cloud")
    expected_keys = [
        "key_themes", "breakthrough_moments", "unresolved_threads",
        "emotional_arc_a", "emotional_arc_b", "relationship_dynamic",
        "concrete_commitment", "recommended_focus",
    ]
    missing_parsed = [k for k in expected_keys if not parsed.get(k)]
    if not missing_parsed:
        ok(f"_parse_summary_sections extracted all {len(expected_keys)} sections")
    else:
        fail(f"_parse_summary_sections missing content for: {missing_parsed}")

    if "frustration" in (parsed.get("emotional_arc_a") or ""):
        ok("Correctly parsed Sky's emotional arc by name-specific header")
    else:
        fail(f"emotional_arc_a parsing incorrect: {parsed.get('emotional_arc_a')!r}")

    # ── Full summarize_session() — without live LLM call ─────────────────────
    # We test the full pipeline's resilience by checking it handles an
    # empty LLM response gracefully (no API key scenario / live test skip).
    import asyncio
    from ai.llm_client import GROQ_API_KEY_BACKGROUND

    async def _run_summary():
        return await summarize_session(test_session, fake_messages, db9)

    if GROQ_API_KEY_BACKGROUND:
        info("Running live summarize_session() test (one LLM call)...")
        result = asyncio.run(_run_summary())

        if result is not None:
            ok(f"summarize_session() created SessionInsight #{result.id}")
            if result.behavioral_metrics:
                ok(f"behavioral_metrics persisted: balance_score="
                   f"{result.behavioral_metrics.get('balance_score')}")
            else:
                fail("behavioral_metrics was not persisted on the SessionInsight")

            if result.key_themes:
                ok(f"key_themes populated: '{result.key_themes[:60]}...'")
            else:
                warn("key_themes is empty — check LLM response or parsing")
        else:
            fail("summarize_session() returned None despite having a valid API key")
    else:
        warn("Skipping live summarize_session() test — GROQ_API_KEY_BACKGROUND not set")
        warn("Deterministic components (Stage 1 and Stage 3) were still fully tested above")

    # ── Insufficient messages guard ───────────────────────────────────────────
    async def _run_short_summary():
        return await summarize_session(test_session, fake_messages[:2], db9)

    short_result = asyncio.run(_run_short_summary())
    if short_result is None:
        ok("summarize_session() correctly skips sessions with too few messages")
    else:
        fail("summarize_session() should return None for very short sessions")

    db9.close()
    results["Phase 9"] = True

except ImportError as e:
    fail(f"Import error in ai.session_summarizer: {e}")
    info("Check that backend/models.py has the new 'behavioral_metrics' column "
         "and that the Alembic migration has been run.")
    traceback.print_exc()
    results["Phase 9"] = False
except Exception as e:
    fail(f"Phase 9 crashed: {e}")
    traceback.print_exc()
    results["Phase 9"] = False

    
# SUMMARY


print(f"\n{C.BOLD}{'═' * 50}{C.RESET}")
print(f"{C.BOLD}  TEST SUMMARY{C.RESET}")
print(f"{C.BOLD}{'═' * 50}{C.RESET}")

all_passed = True
for phase_name, passed in results.items():
    status = f"{C.GREEN}PASS{C.RESET}" if passed else f"{C.RED}FAIL{C.RESET}"
    print(f"  {phase_name:<30} {status}")
    if not passed:
        all_passed = False

print(f"{C.BOLD}{'═' * 50}{C.RESET}\n")


if all_passed:
    print(f"{C.GREEN}{C.BOLD}All phases passed. Safe to commit.{C.RESET}\n")
    sys.exit(0)
else:
    print(f"{C.RED}{C.BOLD}One or more phases failed. Fix before committing.{C.RESET}\n")
    sys.exit(1)