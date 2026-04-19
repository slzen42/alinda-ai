import re
import difflib
import string
from collections import Counter

from .keywords import (
    ESCALATION_KEYWORDS,
    BLAME_PATTERNS,
    VULNERABILITY_KEYWORDS,
    NEGATIVE_WORDS,
    POSITIVE_WORDS,
    TOXICITY_WORDS,
    DIRECT_ATTACK_PATTERNS
)


# CONFIGURATION


ABUSE_THRESHOLD = 4



# NEGATION WORDS


NEGATION_WORDS = [
    "not", "never", "no", "dont", "don't", "cant", "can't"
]


# QUOTED SPEECH STRIPPING
# Prevents false positives when partners report what was said to them
# e.g. "Sky called me a liar" should not score toxicity for "liar"


def strip_quoted_speech(text: str) -> str:
    # Remove content inside standard quotes
    text = re.sub(r'"[^"]*"', '', text)
    # Remove content inside single quotes (but not contractions)
    text = re.sub(r"'[^']{4,}'", '', text)
    return text



# REPAIR ATTEMPTS


REPAIR_PHRASES = [
    "i'm sorry",
    "i am sorry",
    "i didn't mean",
    "i did not mean",
    "thank you",
    "i appreciate",
    "i understand",
    "you're right",
    "you are right",
    "that makes sense",
    "i get it",
    "i hear you"
]



# TEXT CLEANING


def clean_and_tokenize(text):

    text = text.lower()

    text = text.translate(str.maketrans("", "", string.punctuation))

    tokens = text.split()

    return tokens



# SAFE STEMMING


def simple_stem(word):

    if len(word) < 5:
        return word

    suffixes = ["ing", "ed", "ly", "s"]

    for suffix in suffixes:

        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            return word[:-len(suffix)]

    return word



# FUZZY MATCH


def fuzzy_match(word, keyword, threshold=0.88):

    if len(word) < 5:
        return False

    return difflib.SequenceMatcher(None, word, keyword).ratio() >= threshold


# STRUCTURAL BLAME DETECTION


def detect_structural_blame(text_lower):

    blame_score = 0

    partner_refs = [
        "you",
        "your",
        "my partner",
        "they",
        "them"
    ]

    negative_behaviors = [
        "complain",
        "complains",
        "complaining",
        "ignore",
        "interrupt",
        "blame",
        "yell",
        "shout",
        "criticize",
        "control",
        "dismiss"
    ]

    negative_traits = [
        "selfish",
        "lazy",
        "inconsiderate",
        "impossible",
        "dramatic",
        "self centered"
    ]

    # Pattern 1: always/never + negative behaviour
    for ref in partner_refs:
        for verb in negative_behaviors:
            if f"{ref} always {verb}" in text_lower:
                blame_score += 3
            if f"{ref} never {verb}" in text_lower:
                blame_score += 3

    # Pattern 2: character blame
    for trait in negative_traits:
        if f"you are {trait}" in text_lower:
            blame_score += 4

    # Pattern 3: responsibility blame
    responsibility_patterns = [
        "this is your fault",
        "because of you",
        "you made this happen",
        "you caused this"
    ]

    for pattern in responsibility_patterns:
        if pattern in text_lower:
            blame_score += 3

    # Pattern 4: repeated behaviour blame
    for verb in negative_behaviors:
        if f"you keep {verb}" in text_lower:
            blame_score += 3

    return blame_score


# ESCALATION INTENT CLASSIFIER
# Distinguishes who or what the negative language targets


SITUATION_SUBJECTS = [
    "this", "it", "that", "everything", "nothing",
    "the conversation", "this conversation", "this session",
    "talking", "all of this", "any of this"
]

PARTNER_SUBJECTS = [
    "you", "your", "they", "them", "their",
    "my partner", "he", "she", "him", "her"
]


# CRISIS DETECTION
# Detects self-harm ideation and threats of harm to others
# Must be checked before all other scoring


CRISIS_PATTERNS_SELF = [
    r"\bi want to kill myself\b",
    r"\bi want to die\b",
    r"\bi('m| am) going to kill myself\b",
    r"\bkill myself\b",
    r"\bend my life\b",
    r"\bsuicide\b",
    r"\bi can't go on\b",
    r"\bi don't want to be here anymore\b",
    r"\bi wish i was dead\b",
    r"\bno reason to live\b",
]

CRISIS_PATTERNS_OTHER = [
    r"\bi want to kill (him|her|them|you)\b",
    r"\bi('m| am) going to kill (him|her|them|you)\b",
    r"\bi('m| am) going to hurt (him|her|them|you)\b",
    r"\bi will destroy (him|her|them|you|everything)\b",
    r"\bi will hurt (him|her|them|you)\b",
    r"\bi will murder\b",
]

def detect_crisis(text: str) -> str:
    text_lower = text.lower()
    for pattern in CRISIS_PATTERNS_SELF:
        if re.search(pattern, text_lower):
            return "self_harm"
    for pattern in CRISIS_PATTERNS_OTHER:
        if re.search(pattern, text_lower):
            return "harm_to_other"
    return "none"

def classify_escalation_intent(text: str, escalation_score: int, toxicity_score: int) -> str:

    if escalation_score == 0 and toxicity_score == 0:
        return "none"

    text_lower = text.lower()

    character_attack_patterns = [
        r"\b(you'?re?|they'?re?|he'?s?|she'?s?)\s+(so\s+)?(stupid|dumb|idiot|moron|useless|pathetic|worthless|disgusting|psycho|horrible|awful|terrible|a liar|manipulative)\b",
        r"\b(shut up)\b",
        r"\byou (are|were) (a )?(liar|idiot|moron|narcissist|manipulator)\b",
    ]

    for pattern in character_attack_patterns:
        if re.search(pattern, text_lower):
            return "character_attack"

    for subject in PARTNER_SUBJECTS:
        if re.search(rf"\b{re.escape(subject)}\b", text_lower) and (escalation_score >= 3 or toxicity_score >= 2):
            return "partner_directed"

    for subject in SITUATION_SUBJECTS:
        if re.search(rf"\b{re.escape(subject)}\b", text_lower) and (escalation_score >= 2 or toxicity_score >= 3):
            return "situation_directed"

    if re.search(r"\bi (can't|cannot|give up|hate this|hate myself)\b", text_lower):
        return "self_directed"

    return "none"



# MAIN ANALYZER


def analyze_message(text: str):

    original_text = text

    #strip quoted speech before scoring to avoid false positives
    #original text is preserved for display - only scoring using stripped version
    text = strip_quoted_speech(text)

    tokens = clean_and_tokenize(text)

    stemmed_tokens = [simple_stem(t) for t in tokens]

    token_counts = Counter(stemmed_tokens)

    text_lower = " ".join(tokens)

    escalation_score = 0
    blame_score = 0
    vulnerability_score = 0
    sentiment_score = 0
    repair_score = 0
    toxicity_score = 0
    abuse_score = 0
    is_abusive = False


    
    # REPAIR ATTEMPTS
    

    for phrase in REPAIR_PHRASES:

        if phrase in original_text.lower():

            repair_score += 3
            escalation_score = max(0, escalation_score - 2)


    
    # VULNERABILITY
    

    if re.search(r"\bi feel\b", text_lower):

        vulnerability_score += 3
        escalation_score = max(0, escalation_score - 2)


    for phrase, weight in VULNERABILITY_KEYWORDS.items():

        if phrase in text_lower:

            vulnerability_score += weight


    
    # ESCALATION PHRASES
    

    for phrase, weight in ESCALATION_KEYWORDS.items():

        if phrase in text_lower:

            escalation_score += weight

    FRUSTRATION_PHRASES = [
        "This is stupid",
        "This conversation is stupid",
        "This is pointless",
        "This is ridiculous"
    ]

    for phrase in FRUSTRATION_PHRASES:
        if phrase in text_lower:
            escalation_score += 3

    
    # BLAME PATTERNS
    

    for pattern in BLAME_PATTERNS:

        if re.search(pattern, text_lower):

            blame_score += 2
            escalation_score += 1

    structural_blame = detect_structural_blame(text_lower)
    blame_score += structural_blame

    if structural_blame > 0:
        escalation_score += 1

    
    # ABSOLUTE BLAME LANGUAGE
    

    absolute_markers = ["always", "never"]

    for marker in absolute_markers:

        if marker in tokens:

            blame_score += 2
            escalation_score += 1


    
    # BLAME ESCALATION BOOST
    

    if blame_score >= 3:

        escalation_score += 2


    
    # SENTIMENT (NEGATION AWARE)
    

    for i, token in enumerate(tokens):

        token_stem = simple_stem(token)

        if token_stem in NEGATIVE_WORDS:

            negated = False

            if i > 0 and tokens[i-1] in NEGATION_WORDS:
                negated = True

            if i > 1 and tokens[i-2] in NEGATION_WORDS:
                negated = True

            if negated:

                sentiment_score += 1
                escalation_score = max(0, escalation_score - 1)

            else:

                sentiment_score -= 1


        if token_stem in POSITIVE_WORDS:

            sentiment_score += 1


    
    # TOXICITY DETECTION
    

    for word, weight in TOXICITY_WORDS.items():

        if word in token_counts:

            toxicity_score += weight * token_counts[word]
            escalation_score += 1


    
    # DIRECT ATTACK DETECTION
    

    for pattern in DIRECT_ATTACK_PATTERNS:

        if re.search(pattern, text_lower):

            abuse_score += 5
            escalation_score += 2


    
    # PERSONAL INSULT DETECTION
    

    personal_insult_patterns = [
        r"\byou are (an )?\w+\b",
        r"\byoure (an )?\w+\b"
    ]

    for pattern in personal_insult_patterns:

        if re.search(pattern, text_lower):

            abuse_score += 3
            escalation_score += 2


    
    # COMBINE TOXICITY INTO ABUSE
    

    abuse_score += toxicity_score

    if abuse_score >= ABUSE_THRESHOLD:

        is_abusive = True


    
    # EXTRA ESCALATION SIGNALS
    

    exclamation_count = original_text.count("!")

    if exclamation_count >= 2:

        escalation_score += 2


    
    # CAPS SHOUTING
    

    upper_words = [
        w for w in original_text.split()
        if w.isupper() and len(w) > 2
    ]

    if len(upper_words) >= 2:

        escalation_score += 2


    
    # TOXICITY OVERRIDES VULNERABILITY
    

    if vulnerability_score > 0 and toxicity_score > 0:

        vulnerability_score = max(0, vulnerability_score - 3)


    
    # CATEGORY DAMPENING
    

    if vulnerability_score >= 3 and blame_score == 0:

        escalation_score = max(0, escalation_score - 2)


    if repair_score > 0:

        escalation_score = max(0, escalation_score - 2)
        blame_score = max(0, blame_score - 1)


    if sentiment_score > 2:

        escalation_score = max(0, escalation_score - 2)


    
    # CAP VALUES
    

    escalation_score = min(escalation_score, 10)
    blame_score = min(blame_score, 10)
    vulnerability_score = min(vulnerability_score, 10)
    repair_score = min(repair_score, 10)
    toxicity_score = min(toxicity_score, 10)
    abuse_score = min(abuse_score, 10)

    sentiment_score = max(min(sentiment_score, 5), -5)
    crisis = detect_crisis(original_text)


    escalation_intent = classify_escalation_intent(
        original_text, escalation_score, toxicity_score
    )

    return {
        "escalation": escalation_score,
        "blame": blame_score,
        "vulnerability": vulnerability_score,
        "sentiment": sentiment_score,
        "repair_attempt": repair_score,
        "toxicity": toxicity_score,
        "abuse_score": abuse_score,
        "is_abusive": is_abusive,
        "escalation_intent": escalation_intent,
        "crisis": crisis,
    }