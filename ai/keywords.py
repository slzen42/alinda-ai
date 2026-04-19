ESCALATION_KEYWORDS = {
    # Absolutes
    "always": 2,
    "never": 2,
    "every time": 2,
    "not once": 2,
    "not ever": 2,

    # Dismissive
    "overreact": 3,
    "dramatic": 3,
    "ridiculous": 3,
    "whatever": 1,
    "fine.": 1,
    "typical": 2,
    "of course you": 2,
    "obviously": 1,
    "clearly you": 2,
    "as usual": 2,
    "like always": 2,
    "same as always": 2,

    # Hostile
    "shut up": 4,
    "stop it": 2,
    "this is stupid": 3,
    "i'm done": 3,
    "i am done": 3,
    "pointless": 2,
    "useless": 2,
    "forget it": 2,
    "drop it": 2,
    "leave me alone": 3,
    "get away from me": 4,
    "i don't care": 2,
    "i couldn't care less": 3,

    # Frustration
    "exhausting": 2,
    "annoying": 2,
    "unbelievable": 2,
    "why do we": 2,
    "i can't anymore": 3,
    "i give up": 3,
    "i give in": 2,
    "i'm fed up": 3,
    "i am fed up": 3,
    "sick of this": 3,
    "sick of you": 4,
    "tired of this": 2,
    "tired of you": 3,
    "can't stand": 3,
    "can't deal": 3,
    "this is pointless": 3,
    "what's the point": 2,
    "waste of time": 3,


    # Hate and hostile commands
    "i hate you": 6,
    "i hate this": 4,
    "i hate when": 3,
    "hate you": 5,
    "stop calling": 3,
    "stop saying": 3,
    "how dare you": 4,
    "how dare": 3,
    "don't call me": 3,

    # Contempt signals
    "you don't get it": 2,
    "you never get it": 3,
    "you never understand": 3,
    "you wouldn't understand": 2,
    "it's not that hard": 2,
    "how hard is it": 2,
    "why can't you just": 3
}


BLAME_PATTERNS = [
    r"\byou always\b",
    r"\byou never\b",
    r"\byou made me\b",
    r"\bbecause of you\b",
    r"\bit's your fault\b",
    r"\bits your fault\b",
    r"\byou don't care\b",
    r"\byou should\b",
    r"\byou ruined\b",
    r"\byou don't listen\b",
    r"\byou never listen\b",

    # Responsibility blame
    r"\bthis is on you\b",
    r"\byou caused this\b",
    r"\byou started this\b",
    r"\byou did this\b",
    r"\bif it weren't for you\b",
    r"\bif it wasn't for you\b",
    r"\byou brought this on\b",

    # Behaviour blame
    r"\byou keep (doing|saying|acting|behaving)\b",
    r"\byou always (do|say|act|behave|ignore|dismiss|interrupt)\b",
    r"\byou never (listen|care|try|help|show up|support)\b",
    r"\byou don't (care|try|listen|help|support|respect)\b",
    r"\byou only (care|think|worry) about yourself\b",

    # Character blame
    r"\byou are so (selfish|lazy|cold|distant|mean|cruel|difficult)\b",
    r"\byou're so (selfish|lazy|cold|distant|mean|cruel|difficult)\b",
    r"\byou act like\b",
    r"\byou treat me like\b",
    r"\byou make me feel (like)?\b"

    # Character sensitivity blame
    r"\bnot my fault\b",
    r"\bit's not my fault\b",
    r"\bits not my fault\b",
    r"\bso sensitive\b",
    r"\bso dramatic\b",
    r"\bso difficult\b",
    r"\bso annoying\b",
    r"\bso impossible\b",
    r"\btoo sensitive\b",
    r"\btoo dramatic\b",
    r"\btoo difficult\b",


    # Third-person blame — partner referred to as "they" or "my partner"
    r"\bthey always\b",
    r"\bthey never\b",
    r"\bthey don't\b",
    r"\bthey keep\b",
    r"\bthey won't\b",
    r"\bthey can't (even|just|ever)\b",
    r"\bmy partner always\b",
    r"\bmy partner never\b",
    r"\bmy partner won't\b",
    r"\bmy partner keeps\b"
]


VULNERABILITY_KEYWORDS = {
    # Core emotional exposure
    "i feel": 3,
    "it hurts": 3,
    "i feel hurt": 3,
    "i feel small": 4,
    "i feel alone": 4,
    "i feel ignored": 4,
    "i feel unheard": 4,
    "i feel misunderstood": 4,
    "i feel distant": 3,
    "i feel disconnected": 3,
    "i feel invisible": 4,
    "i feel worthless": 5,
    "i feel unwanted": 4,
    "i feel unloved": 5,
    "i feel rejected": 4,
    "i feel abandoned": 5,
    "i feel trapped": 4,
    "i feel hopeless": 4,
    "i feel empty": 4,
    "i feel numb": 3,
    "i feel broken": 4,
    "i feel lost": 3,

    # Needs not being met
    "i need you to": 3,
    "i just need": 3,
    "i needed you": 4,
    "i needed": 3,
    "all i want": 3,
    "all i wanted": 3,
    "i just wanted": 3,
    "i just want": 3,
    "i wish you": 3,
    "i wish we": 2,

    # Exhaustion
    "i'm tired": 2,
    "i am tired": 2,
    "i'm tired of": 3,
    "i am tired of": 3,
    "i'm overwhelmed": 3,
    "i am overwhelmed": 3,
    "i can't keep": 3,
    "i can't do this": 3,
    "i'm exhausted": 3,
    "i am exhausted": 3,
    "i'm drained": 3,
    "i am drained": 3,
    "i'm burning out": 3,

    # Fear and insecurity
    "i'm scared": 4,
    "i am scared": 4,
    "i feel lost": 3,
    "i don't know anymore": 4,
    "i'm afraid": 4,
    "i am afraid": 4,
    "i'm worried": 2,
    "i am worried": 2,
    "i don't feel safe": 5,
    "i feel unsafe": 5,
    "i'm not sure you": 3,

    # Longing and grief
    "i miss you": 4,
    "i miss us": 4,
    "i miss how": 3,
    "i miss when": 3,
    "i used to feel": 3,
    "we used to": 2,
    "things used to be": 2,
    "i remember when": 2,

    # Self-doubt triggered by relationship
    "maybe i'm the problem": 4,
    "maybe it's me": 3,
    "i don't know what i did": 3,
    "i don't know what to do": 3,
    "i don't know how to": 2,
    "i try so hard": 3,
    "i don't know if i can": 3
}


NEGATIVE_WORDS = [
    "angry",
    "hurt",
    "ignored",
    "alone",
    "exhausted",
    "upset",
    "frustrated",
    "disappointed",
    "sad",
    "annoyed",
    "pointless",
    "hopeless",
    "drained",
    "fighting",
    "broken",
    "tired",
    "overwhelmed",
    "empty",
    "numb",
    "distant",
    "disconnected",
    "invisible",
    "worthless",
    "unloved",
    "unwanted",
    "rejected",
    "abandoned",
    "trapped",
    "scared",
    "afraid",
    "worried",
    "unsafe",
    "bitter",
    "resentful",
    "defeated",
    "lost",
    "stuck",
    "misunderstood",
    "unheard",
    "unseen",
    "unsupported",
    "neglected"
]


POSITIVE_WORDS = [
    "calm",
    "safe",
    "understood",
    "heard",
    "grateful",
    "appreciate",
    "happy",
    "relieved",
    "thankful",
    "better",
    "connected",
    "closer",
    "love",
    "care",
    "supported",
    "seen",
    "valued",
    "respected",
    "hopeful",
    "proud",
    "comfortable",
    "secure",
    "trust",
    "open",
    "honest",
    "together",
    "forgive",
    "forgiven",
    "sorry",
    "apologize",
    "trying",
    "improving",
    "growing",
    "healing"
]


# TOXICITY / INSULT WORDS
TOXICITY_WORDS = {
    # Direct insults
    "stupid": 4,
    "idiot": 4,
    "dumb": 4,
    "moron": 4,
    "imbecile": 4,
    "dimwit": 4,
    "halfwit": 4,

    # Character attacks
    "liar": 4,
    "lying": 3,
    "manipulative": 4,
    "manipulator": 4,
    "narcissist": 4,
    "narcissistic": 4,
    "toxic": 3,
    "abusive": 5,
    "controlling": 3,

    # Contempt
    "pathetic": 4,
    "useless": 4,
    "worthless": 4,
    "disgusting": 4,
    "repulsive": 4,
    "ridiculous": 2,
    "crazy": 2,
    "insane": 3,
    "delusional": 4,
    "paranoid": 3,
    "psycho": 4,

    # Dismissive attacks
    "shut": 3,
    "annoying": 2,
    "unbearable": 3,
    "insufferable": 4,
    "exhausting": 2,
    "dramatic": 2,
    "oversensitive": 3,
    "too sensitive": 3,
    "overreacting": 3,

    # Name calling
    "jerk": 3,
    "selfish": 3,
    "coward": 3,
    "bully": 4,
    "monster": 5,
    "terrible": 3,
    "horrible": 3,
    "awful": 3,
    "nasty": 3,
    "cruel": 4,
    "heartless": 4,
    "cold": 2,
    "hate": 4
}


# DIRECT ATTACK PATTERNS
DIRECT_ATTACK_PATTERNS = [

    # Identity attacks
    r"\byou are (a )?(liar|stupid|idiot|moron|pathetic|useless|worthless|disgusting|crazy|psycho|bully|monster|coward|jerk)\b",
    r"\byou're (a )?(liar|stupid|idiot|moron|pathetic|useless|worthless|disgusting|crazy|psycho|bully|monster|coward|jerk)\b",
    r"\byoure (a )?(liar|stupid|idiot|moron|pathetic|useless|worthless|disgusting|crazy|psycho|bully|monster|coward|jerk)\b",

    # Hostile commands
    r"\bshut up\b",
    r"\bget out\b",
    r"\bgo away\b",
    r"\bleave me alone\b",
    r"\bstay away from me\b",

    # Absolute blame
    r"\byou ruined\b",
    r"\byou ruin everything\b",
    r"\byou destroyed\b",
    r"\byou broke (this|us|everything|me)\b",


    # Gaslighting patterns
    r"\byou're (imagining|making up|fabricating|inventing)\b",
    r"\bthat never happened\b",
    r"\byou're (too sensitive|overreacting|being dramatic)\b",
    r"\bno one (else )?(would|will|does)\b",
    r"\beveryone (thinks|knows|agrees|can see) you\b",


    # Threatening language
    r"\bi('m| am) (done|finished|leaving|out)\b",
    r"\bdon't (bother|come back|talk to me)\b",
    r"\byou'll (regret|be sorry)\b",


    #hate directed at partner
    r"\bi hate you\b",
    r"\bi hate (both of )?you\b",
    r"\bstop calling me\b",
    r"\bdon't call me\b",


    # Third-person insults — "Sky is stupid", "he is useless"
    r"\b\w+ is (so\s+)?(stupid|dumb|idiot|moron|useless|pathetic|worthless|psycho|horrible|awful)\b",
    r"\bhe is (so\s+)?(stupid|dumb|idiot|useless|pathetic|worthless)\b",
    r"\bshe is (so\s+)?(stupid|dumb|idiot|useless|pathetic|worthless)\b",

]