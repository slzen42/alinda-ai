from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Float, Boolean
from datetime import datetime, timezone
from .database import Base


class Session(Base):

    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(String, unique=True, index=True)

    
    # PARTICIPANTS
    

    name_a = Column(String, nullable=True)
    name_b = Column(String, nullable=True)

    
    # SESSION STATE
    

    phase = Column(String, default="waiting_for_partner")

    # FIX: Changed default from "none" (string) to None (null).
    #
    # "none" was a synthetic string value with no corresponding user role.
    # Now that free_chat uses current_turn = None to mean "no enforced turn",
    # the column needs to be nullable so that state can be stored in the DB.
    # The String default is removed — None is the honest representation of
    # "no one has the floor yet" at session creation too.
    current_turn = Column(String, nullable=True)

    mode = Column(String, default="intake")

    
    # PRIVATE INTAKE
    

    intake_a = Column(Text, nullable=True)
    intake_b = Column(Text, nullable=True)

    
    # EMOTIONAL METRICS
    

    avg_escalation = Column(Float, default=0.0)
    avg_blame = Column(Float, default=0.0)
    avg_vulnerability = Column(Float, default=0.0)

    message_count = Column(Integer, default=0)

    
    # MEDIATOR LOGIC STATE
    #
    # FIX: Added resume_guidance_index and cooldown_exercise_index.
    #
    # These were initialized in session_manager.submit_intake and used
    # in mediator_logic.py via getattr() fallbacks, but had no DB columns.
    # Without columns, SQLAlchemy drops them after the first request —
    # the index resets to 0 on every message, so rotation never actually
    # happened. Adding them here makes rotation persistent across requests.
    

    # Tracks which fallback template to use next (cycles through 4)
    resume_guidance_index = Column(Integer, default=0)

    # Tracks which cooldown exercise to use next (cycles through 3)
    cooldown_exercise_index = Column(Integer, default=0)

    
    # CONVERSATION STATE CONTROLLER
    

    # Current dialogue stage
    dialogue_stage = Column(String, default="expression")

    # Last mediator action taken
    last_action = Column(String, nullable=True)

    # Last participant targeted by AI
    last_target = Column(String, nullable=True)

    # Prevents repeated AI behaviours
    action_streak = Column(Integer, default=0)

    # Prevents targeting same person repeatedly
    target_streak = Column(Integer, default=0)

    # Detects repeated short responses
    short_reply_streak = Column(Integer, default=0)

    
    # GUARDRAIL STATE
    

    last_skill = Column(String, nullable=True)

    skill_streak = Column(Integer, default=0)

    last_user_message = Column(Text, nullable=True)

    topic_repeat_count = Column(Integer, default=0)

    agreement_streak = Column(Integer, default=0)

    high_confidence_streak = Column(Integer, default=0)

    last_high_confidence_action = Column(String, nullable=True)

    # Crisis and turn tracking
    
    consecutive_turns = Column(Integer, default=0)
    last_speaker = Column(String, nullable=True)
    crisis_mode = Column(String, nullable=True)
    locked_until = Column(DateTime, nullable=True)

    crisis_ready_a = Column(Boolean, default=False)
    crisis_ready_b = Column(Boolean, default=False)

    partner_typing = Column(Boolean, default=False)
    typing_role = Column(String, nullable=True)

    # Escalation memory
    # Tracks history of escalation events for context-aware responses
    cooldown_count = Column(Integer, default=0)
    safety_count = Column(Integer, default=0)
    last_escalation_type = Column(String, nullable=True)
    escalation_unresolved = Column(Boolean, default=False)

    
    # RESERVED FOR FUTURE USE
    # Not yet wired into the AI pipeline.
    # repair_resolved: tracks whether a safety/repair event was resolved
    # turns_since_ai: tracks how many user turns have passed without AI response
    

    repair_resolved = Column(Integer, default=0)

    turns_since_ai = Column(Integer, default=0)

    
    # METADATA
    

    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )


class ChatMessage(Base):

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)

    room_id = Column(String, index=True)

    # "a", "b", "ai", "system"
    sender = Column(String)

    # "user", "ai", "system"
    message_type = Column(String, default="user")

    content = Column(Text)

    # Stores analysis scores, mediation actions, and tone metadata
    extra_data = Column(JSON, nullable=True)

    timestamp = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )