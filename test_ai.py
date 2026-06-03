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

# ─────────────────────────────────────────────────────────────────────────────
# COLOUR OUTPUT — works on all modern terminals including Windows 10+
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# RESULT TRACKER
# ─────────────────────────────────────────────────────────────────────────────

results: dict[str, bool] = {}

def phase(name: str):
    """Print a phase header."""
    print(f"\n{C.BOLD}{'─' * 50}{C.RESET}")
    print(f"{C.BOLD}  {name}{C.RESET}")
    print(f"{C.BOLD}{'─' * 50}{C.RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 0 — Environment and model directory check
# Run this before anything else so you know what files are present.
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Classifier singleton
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Analysis pipeline
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — PLACEHOLDER (add as you write each new file)
#
# When you finish prompts.py, add:
#
# phase("Phase 3 — ai.prompts")
# try:
#     from ai.prompts import (
#         build_prompt, SYSTEM_PROMPT, get_action_guidance,
#         build_intake_analysis_prompt, build_session_summary_prompt,
#         get_temperature, get_max_tokens
#     )
#     # ... tests here
#     results["Phase 3"] = True
# except Exception as e:
#     fail(f"Phase 3 crashed: {e}")
#     results["Phase 3"] = False
#
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

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