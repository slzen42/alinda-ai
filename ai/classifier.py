"""
ai/classifier.py

The neural inference engine for Alinda.

Architecture:
    AlindaClassifier (Singleton)
        └── DistilBERT fine-tuned on GoEmotions (58k examples, 28 emotion labels)
            └── Per-dimension threshold mapping → Alinda's therapeutic scores

Performance contract:
    - Model loads exactly once per process at first import
    - All inference runs under torch.no_grad() — zero gradient memory
    - model.eval() is set permanently — no dropout, deterministic output
    - Single-message processing — no batching, minimises per-message latency
    - Typical latency: 15-40ms CPU, <5ms GPU
    - Never raises — fallback returns neutral scores if inference fails

Crisis detection:
    Regex safety net runs BEFORE the neural model on every message.
    Even if the model is miscalibrated or unavailable, crisis signals are caught.
    This is intentional. Never remove it.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

import torch
from transformers import DistilBertForSequenceClassification, DistilBertTokenizerFast


# LOGGING


logger = logging.getLogger(__name__)


# PATHS AND CONSTANTS


# Resolve relative to this file so the path works regardless of where
# uvicorn is launched from — on your laptop or on Render.
_MODEL_DIR = Path(__file__).parent / "models" / "alinda-classifier"

# Must match the max_length used during training (Cell 7 in Colab).
# Changing this post-training degrades accuracy.
_MAX_TOKENS = 128



# CRISIS DETECTION — HARD-CODED SAFETY NET
#
# These regex patterns run on every single message before the neural model.
# They are the last line of defence. They must be simple, exhaustive, and fast.
# The neural model is NOT reliable enough to be the sole crisis detector —
# a model trained on Reddit comments has never seen "I want to end it all"
# in the context of a couples therapy session with the weight that phrase carries.
#
# Belt and suspenders. Never remove this.


_SELF_HARM_PATTERNS: list[str] = [
    r"\bi want to kill myself\b",
    r"\bi want to die\b",
    r"\bi'?m going to kill myself\b",
    r"\bkill myself\b",
    r"\bend my life\b",
    r"\bsuicide\b",
    r"\bsuicidal\b",
    r"\bi can'?t go on\b",
    r"\bi don'?t want to be here( anymore)?\b",
    r"\bi wish i was dead\b",
    r"\bno reason to live\b",
    r"\bwant to end it( all)?\b",
    r"\bending it all\b",
    r"\btake my (own )?life\b",
    r"\bhurt myself\b",
]

_HARM_TO_OTHER_PATTERNS: list[str] = [
    r"\bi want to kill (him|her|them|you|everyone)\b",
    r"\bi'?m going to (kill|murder|hurt|destroy) (him|her|them|you)\b",
    r"\bi will (kill|murder|destroy|hurt) (him|her|them|you|everyone|everything)\b",
    r"\bi'?m going to hurt (him|her|them|you)\b",
    r"\bi'?ll murder\b",
]

# Pre-compile at import time — these run on every message, performance matters.
_SELF_HARM_RE = [re.compile(p, re.IGNORECASE) for p in _SELF_HARM_PATTERNS]
_HARM_OTHER_RE = [re.compile(p, re.IGNORECASE) for p in _HARM_TO_OTHER_PATTERNS]


def _detect_crisis(text: str) -> str:
    """
    Returns 'self_harm', 'harm_to_other', or 'none'.
    Called before neural inference on every message.
    O(n * k) where n = len(text) and k = number of patterns — fast.
    """
    for pattern in _SELF_HARM_RE:
        if pattern.search(text):
            return "self_harm"
    for pattern in _HARM_OTHER_RE:
        if pattern.search(text):
            return "harm_to_other"
    return "none"



# NEUTRAL FALLBACK
#
# Returned when the model is not loaded or inference throws unexpectedly.
# Crisis detection still runs — the session must continue and emergencies
# must still be caught even when the classifier is unavailable.


def _neutral_fallback(text: str) -> dict:
    return {
        "escalation":    0,
        "blame":         0,
        "vulnerability": 0,
        "sentiment":     0,
        "repair_attempt": 0,
        "toxicity":      0,
        "abuse_score":   0,
        "is_abusive":    False,
        "contempt":      0,
        "engagement":    0,
        "crisis":        _detect_crisis(text),
        "confidence":    "low",
        "top_emotions":  {},
        "_fallback":     True,   # internal flag — useful for debugging
    }



# SINGLETON CLASSIFIER


class AlindaClassifier:
    """
    Singleton wrapper around the fine-tuned DistilBERT emotion classifier.

    The Singleton pattern is enforced at two levels:
        1. __new__ returns the same instance on every call.
        2. __init__ is guarded by _initialized — the model loads exactly once.

    This means:
        AlindaClassifier() is AlindaClassifier()  → True
        Both calls return the same object with the same loaded model.

    FastAPI imports this module once per worker process. The model loads
    during that import and stays resident in RAM for the lifetime of the
    server — no per-request loading overhead.

    Public API:
        classifier = AlindaClassifier()
        result = classifier.analyze("I feel so ignored right now")
    """

    _instance: Optional[AlindaClassifier] = None
    _initialized: bool = False

    def __new__(cls) -> AlindaClassifier:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        # Guard: __init__ is called every time AlindaClassifier() is written,
        # but we only want to load the model on the very first call.
        if AlindaClassifier._initialized:
            return

        # Internal state — all None until _load() succeeds.
        self._model:      Optional[DistilBertForSequenceClassification] = None
        self._tokenizer:  Optional[DistilBertTokenizerFast] = None
        self._label_names: list[str] = []
        self._mapping:    dict = {}
        self._thresholds: dict = {}
        self._device:     torch.device = torch.device("cpu")
        self._ready:      bool = False

        self._load()
        AlindaClassifier._initialized = True

    
    # LOADING
    

    def _load(self) -> None:
        """
        Loads all model artefacts from _MODEL_DIR.
        Logs timing at each stage for observability.
        Sets self._ready = True only if every stage succeeds.
        A partial load leaves the classifier in fallback mode rather than
        crashing the server — the session continues with neutral scores.
        """
        t0 = time.perf_counter()

        if not _MODEL_DIR.exists():
            logger.error(
                f"\n{'='*60}\n"
                f"AlindaClassifier: model directory not found.\n"
                f"Expected: {_MODEL_DIR.resolve()}\n"
                f"Run the Colab notebook and place the output there.\n"
                f"Server will start in FALLBACK MODE — neutral scores only.\n"
                f"{'='*60}"
            )
            return

        try:
            # ── Device ──
            if torch.cuda.is_available():
                self._device = torch.device("cuda")
                gpu = torch.cuda.get_device_name(0)
                vram = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
                logger.info(f"GPU available: {gpu} ({vram:.1f} GB VRAM)")
            else:
                self._device = torch.device("cpu")
                logger.info("No GPU detected — using CPU for inference")

            # ── Tokenizer ───
            t_tok = time.perf_counter()
            self._tokenizer = DistilBertTokenizerFast.from_pretrained(
                str(_MODEL_DIR),
                local_files_only=True,   # Never call home to HuggingFace
            )
            logger.info(f"Tokenizer loaded ({time.perf_counter() - t_tok:.2f}s)")

            # ── Model 
            t_mdl = time.perf_counter()
            self._model = DistilBertForSequenceClassification.from_pretrained(
                str(_MODEL_DIR),
                local_files_only=True,
            )
            self._model.to(self._device)
            self._model.eval()           # Disable dropout permanently
            param_count = sum(p.numel() for p in self._model.parameters())
            logger.info(
                f"Model loaded ({time.perf_counter() - t_mdl:.2f}s) | "
                f"{param_count:,} parameters | device={self._device}"
            )

            # ── Label names ─────────────────────────────────────────────────
            label_path  = _MODEL_DIR / "label_names.json"
            config_path = _MODEL_DIR / "config.json"

            if label_path.exists():
                # Prefer the explicit override file if it was saved
                with open(label_path, encoding="utf-8") as f:
                    self._label_names = json.load(f)
                logger.info(
                    f"Label names loaded from label_names.json: "
                    f"{len(self._label_names)} categories"
                )
            elif config_path.exists():
                # Fall back to HuggingFace's built-in config.json
                with open(config_path, encoding="utf-8") as f:
                    model_config = json.load(f)
                id2label = model_config.get("id2label", {})
                if not id2label:
                    raise ValueError(
                        "config.json exists but contains no id2label mapping. "
                        "The model may not be a classification model."
                    )
                # Rebuild in correct numerical order — id2label keys are strings
                self._label_names = [
                    id2label[str(i)] for i in range(len(id2label))
                ]
                logger.info(
                    f"Label names loaded from config.json: "
                    f"{len(self._label_names)} categories"
                )
            else:
                raise FileNotFoundError(
                    f"No label source found. Expected one of:\n"
                    f"  {label_path}\n"
                    f"  {config_path}\n"
                    f"Check that the model was downloaded correctly."
                )

            # ── Alinda mapping ───
            mapping_path = _MODEL_DIR / "alinda_mapping.json"
            if not mapping_path.exists():
                raise FileNotFoundError(f"alinda_mapping.json not found in {_MODEL_DIR}")
            with open(mapping_path, encoding="utf-8") as f:
                full_mapping: dict = json.load(f)

            # Thresholds live under a "thresholds" key — pop them out separately
            self._thresholds = full_mapping.pop("thresholds", {})
            self._mapping = full_mapping
            logger.info(
                f"Dimension mapping loaded: {list(self._mapping.keys())} | "
                f"Per-dimension thresholds: {self._thresholds}"
            )

            # ── Warm-up ──
            # The first real inference call is always slower because CUDA kernels
            # need to compile. Run a dummy call now so the first real message
            # doesn't pay that cost.
            t_warm = time.perf_counter()
            self._warm_up()
            logger.info(f"Warm-up complete ({time.perf_counter() - t_warm:.3f}s)")

            # ── Done ─
            self._ready = True
            elapsed = time.perf_counter() - t0
            logger.info(
                f"\n{'='*60}\n"
                f"AlindaClassifier READY in {elapsed:.2f}s\n"
                f"Device:     {self._device}\n"
                f"Labels:     {len(self._label_names)}\n"
                f"Dimensions: {list(self._mapping.keys())}\n"
                f"{'='*60}"
            )

        except Exception as exc:
            logger.error(
                f"AlindaClassifier failed to load: {exc}\n"
                f"Server will start in FALLBACK MODE — neutral scores only.",
                exc_info=True
            )
            self._ready = False

    def _warm_up(self) -> None:
        """Runs one silent forward pass to initialise CUDA kernels."""
        dummy = self._tokenizer(
            "warmup",
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=_MAX_TOKENS,
        )
        dummy = {k: v.to(self._device) for k, v in dummy.items()}
        with torch.no_grad():
            self._model(**dummy)

    
    # INFERENCE — PRIVATE METHODS
    

    def _get_probabilities(self, text: str) -> dict[str, float]:
        """
        Tokenizes text and runs one forward pass.

        Returns a dict mapping every emotion label name to its sigmoid
        probability — a float in [0.0, 1.0].

        The entire computation runs under torch.no_grad():
            - No gradient tensors are created
            - No backward graph is allocated
            - Memory footprint is minimal and constant
        """
        inputs = self._tokenizer(
            text,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=_MAX_TOKENS,
        )
        # Move inputs to the same device as the model
        inputs = {k: v.to(self._device) for k, v in inputs.items()}

        with torch.no_grad():
            logits = self._model(**inputs).logits      # shape: (1, num_labels)
            probs  = torch.sigmoid(logits)[0]          # shape: (num_labels,)
            # Move to CPU and convert to plain Python floats for JSON serialisation
            probs_cpu = probs.cpu().tolist()

        return {
            label: probs_cpu[i]
            for i, label in enumerate(self._label_names)
        }

    def _score_dimension(
        self,
        dimension: str,
        probabilities: dict[str, float],
    ) -> int:
        """
        Converts per-label probabilities into a single Alinda score (0–10).

        Logic:
            1. Get the threshold for this dimension from alinda_mapping.json.
            2. For each emotion label in the dimension's weight map, check if
               its probability exceeds the threshold.
            3. Sum the weights of all detected emotions.
            4. Cap at 10.

        Using per-dimension thresholds (rather than one global threshold) means
        high-stakes dimensions like toxicity and crisis use a lower bar,
        while positive signals like repair require higher confidence before firing.
        """
        threshold  = self._thresholds.get(dimension, self._thresholds.get("default", 0.28))
        weight_map = self._mapping.get(dimension, {})

        raw_score = sum(
            weight
            for label, weight in weight_map.items()
            if probabilities.get(label, 0.0) >= threshold
        )

        return min(10, int(raw_score))

    def _compute_confidence(self, probabilities: dict[str, float]) -> str:
        """
        Measures how decisive the model is about this message.

        'high'   — model is confident about at least one emotion (>0.55)
        'medium' — model has a reasonable signal (>0.35)
        'low'    — model is uncertain across all labels

        mediator_logic.py uses this to default to 'explore' when confidence
        is low rather than routing to a specific action that may be wrong.
        """
        top_prob = max(probabilities.values()) if probabilities else 0.0
        if top_prob >= 0.55:
            return "high"
        elif top_prob >= 0.35:
            return "medium"
        return "low"

    def _top_emotions(
        self,
        probabilities: dict[str, float],
        n: int = 5,
        min_prob: float = 0.20,
    ) -> dict[str, float]:
        """
        Returns the top N detected emotions above min_prob, sorted by confidence.
        Stored in the message's extra_data for debugging and future training data labelling.
        """
        above_threshold = {
            label: round(prob, 4)
            for label, prob in probabilities.items()
            if prob >= min_prob
        }
        return dict(sorted(above_threshold.items(), key=lambda x: -x[1])[:n])

    
    # INFERENCE — PUBLIC METHOD
    

    def analyze(self, text: str) -> dict:
        """
        The only public method you need.

        Takes a raw message string (any characters, any length — will be truncated
        at _MAX_TOKENS). Returns Alinda's complete analysis dict.

        This is a drop-in replacement for the old analyze_message() function.
        All downstream code (mediator_logic, session_manager) works unchanged.

        Guaranteed to return a valid dict — never raises.
        """
        # Always run crisis detection — even in fallback mode
        crisis = _detect_crisis(text)

        if not self._ready:
            logger.warning("AlindaClassifier not ready — returning neutral fallback")
            result = _neutral_fallback(text)
            result["crisis"] = crisis   # Override with fresh detection
            return result

        try:
            # ── Neural inference ─
            probs = self._get_probabilities(text)

            # ── Score every therapeutic dimension ───
            escalation    = self._score_dimension("escalation",    probs)
            blame         = self._score_dimension("blame",         probs)
            vulnerability = self._score_dimension("vulnerability", probs)
            repair        = self._score_dimension("repair",        probs)
            toxicity      = self._score_dimension("toxicity",      probs)
            positive      = self._score_dimension("positive",      probs)
            contempt      = self._score_dimension("contempt",      probs)
            engagement    = self._score_dimension("engagement",    probs)

            # ── Derived scores ───
            # Sentiment: positive signals pull up, escalation pulls down
            sentiment = max(-5, min(5, positive - (escalation // 2)))

            # Abuse: direct toxicity plus contempt boost (contempt is qualitatively
            # different from anger — it signals the relationship is in danger)
            abuse_score = min(10, toxicity + (3 if contempt >= 4 else 0))

            # is_abusive: score threshold OR confirmed harm-to-other crisis signal
            is_abusive = abuse_score >= 4 or crisis == "harm_to_other"

            return {
                # Core dimensions — same keys as old analysis.py
                "escalation":    escalation,
                "blame":         blame,
                "vulnerability": vulnerability,
                "sentiment":     sentiment,
                "repair_attempt": repair,
                "toxicity":      toxicity,
                "abuse_score":   abuse_score,
                "is_abusive":    is_abusive,

                # New dimensions — used in mediator_logic.py phase 2
                "contempt":      contempt,
                "engagement":    engagement,

                # Meta fields — used for routing and future training
                "crisis":        crisis,
                "confidence":    self._compute_confidence(probs),
                "top_emotions":  self._top_emotions(probs),
            }

        except Exception as exc:
            logger.error(
                f"Inference failed on text='{text[:60]}...': {exc}",
                exc_info=True,
            )
            result = _neutral_fallback(text)
            result["crisis"] = crisis
            return result

    
    # DIAGNOSTICS
    

    @property
    def ready(self) -> bool:
        """True if the model loaded successfully and is ready for inference."""
        return self._ready

    @property
    def device(self) -> str:
        """Returns 'cuda' or 'cpu' — useful for health check endpoints."""
        return str(self._device)

    def health(self) -> dict:
        """
        Returns a health status dict — call this from your /health endpoint
        to verify the classifier is alive without triggering a full inference.
        """
        return {
            "ready":       self._ready,
            "device":      str(self._device),
            "labels":      len(self._label_names),
            "dimensions":  list(self._mapping.keys()),
            "model_dir":   str(_MODEL_DIR.resolve()),
        }


# ─────────────────────────────────────────────────────────────────────────────
# MODULE-LEVEL SINGLETON AND PUBLIC INTERFACE
#
# This runs exactly once — when the module is first imported by FastAPI.
# Every other import of this module gets the cached, already-loaded instance.
#
# Usage from any other file:
#     from ai.classifier import analyze_message
#     result = analyze_message("I feel so alone in this relationship")
#
# Or for health checks:
#     from ai.classifier import classifier
#     status = classifier.health()
# ─────────────────────────────────────────────────────────────────────────────

classifier = AlindaClassifier()


def analyze_message(text: str) -> dict:
    """
    Public function interface — backwards compatible with the old analysis.py.

    Any file that previously called:
        from ai.analysis import analyze_message

    Can switch to:
        from ai.classifier import analyze_message

    And everything works without any other changes.

    Args:
        text: Raw message string from the user.

    Returns:
        Analysis dict with all Alinda's therapeutic dimension scores.
    """
    return classifier.analyze(text)