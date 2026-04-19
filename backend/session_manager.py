from sqlalchemy.orm import Session as DBSession
from . import models

from ai.analysis import analyze_message
from ai.mediator_logic import decide_mediation
from ai.conversation_state_controller import adjust_decision
from ai.llm_client import generate_mediation_message
from ai.conversation_guardrails import stabilize_decision


class SessionManager:


    
    # CREATE ROOM
    
    def create_room(self, db: DBSession, room_id: str, name_a: str):

        existing = db.query(models.Session).filter_by(room_id=room_id).first()

        if existing:
            raise ValueError("Room already exists")

        session = models.Session(
            room_id=room_id,
            name_a=name_a,
            phase="waiting_for_partner",
            current_turn=None,
            mode="intake"
        )

        db.add(session)
        db.commit()
        db.refresh(session)

        return session


    
    # JOIN ROOM
    
    def join_room(self, db: DBSession, room_id: str, name_b: str):

        session = db.query(models.Session).filter_by(room_id=room_id).first()

        if not session:
            raise ValueError("Room not found")

        if session.name_b is not None:
            raise ValueError("Room already full")

        if session.phase not in ["waiting_for_partner", "waiting_for_intake"]:
            raise ValueError("Cannot join - session already in progress")

        session.name_b = name_b
        session.phase = "waiting_for_intake"

        db.commit()
        db.refresh(session)

        return session


    
    # SUBMIT INTAKE
    
    def submit_intake(self, db: DBSession, room_id: str, role: str, intake_text: str):

        session = db.query(models.Session).filter_by(room_id=room_id).first()

        if not session:
            raise ValueError("Session not found")

        if not session.name_a or not session.name_b:
            raise ValueError("Both participants must join before submitting intake")

        if role == "a":

            if session.intake_a is not None:
                raise ValueError("Partner A has already submitted intake")

            session.intake_a = intake_text

        elif role == "b":

            if session.intake_b is not None:
                raise ValueError("Partner B has already submitted intake")

            session.intake_b = intake_text

        else:
            raise ValueError("Invalid role")

        # Start session when both intakes complete
        if session.intake_a and session.intake_b:

            session.phase = "ready_for_session"
            session.mode = "guided"
            session.current_turn = "a"

            
            # FIX: Initialize all session state attributes here explicitly.
            #
            # Previously these were read via getattr() fallbacks scattered
            # across mediator_logic, conversation_state_controller, and
            # conversation_guardrails. This meant they were invisible when
            # inspecting session state in Swagger or the DB, and any
            # serialization of the session object would silently drop them.
            #
            # Initializing them here makes the full session state visible,
            # debuggable, and consistent from the first message onward.
            

            # mediator_logic.py state
            session.resume_guidance_index = 0
            session.cooldown_exercise_index = 0

            # conversation_state_controller.py state
            session.last_action = None
            session.last_target = None
            session.action_streak = 0
            session.target_streak = 0
            session.short_reply_streak = 0
            session.dialogue_stage = "analysis"
            session.high_confidence_streak = 0
            session.last_high_confidence_action = None
            #Escalation
            session.cooldown_count = 0
            session.safety_count = 0

            session.last_escalation_type = None
            session.escalation_unresolved = False

            # conversation_guardrails.py state
            session.last_skill = None
            session.skill_streak = 0
            session.topic_repeat_count = 0
            session.agreement_streak = 0

            session.last_user_message = None

            #consecutive turns
            session.consecutive_turns = 0
            session.last_speaker = None
            session.crisis_mode = None
            session.locked_until = None
            session.crisis_ready_a = False

            session.crisis_ready_b = False

            opening_message = (
                f"Hello {session.name_a} and {session.name_b}.\n\n"
                "Thank you both for being here. "
                "This space is meant to help each of you feel heard, "
                "without interruption or judgement.\n\n"
                f"{session.name_a}, would you like to begin by sharing "
                "how you experienced your most recent disagreement?"
            )

            ai_message = models.ChatMessage(
                room_id=room_id,
                sender="ai",
                message_type="system",
                content=opening_message
            )

            db.add(ai_message)

        db.commit()
        db.refresh(session)

        return session


    
    # SEND MESSAGE (CORE ENGINE)
    
    async def send_message(self, db: DBSession, room_id: str, sender: str, content: str):

        session = db.query(models.Session).filter_by(room_id=room_id).first()

        if not session:
            raise ValueError("Session not found")

        if session.phase != "ready_for_session":
            raise ValueError("Conversation has not started yet")
        
        # Crisis lock check — block all messages during forced pause
        if session.locked_until:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            locked = session.locked_until
            # Make both timezone-aware for comparison
            if locked.tzinfo is None:
                from datetime import timezone as tz
                locked = locked.replace(tzinfo=tz.utc)
            if now < locked:
                remaining = int((locked - now).total_seconds())
                raise ValueError(f"Session is paused. {remaining} seconds remaining.")


        
        # TURN ENFORCEMENT
        
        if session.mode != "free_chat":

            if session.current_turn != sender:
                raise ValueError("Not your turn to speak")


        
        # ANALYZE MESSAGE
        
        analysis = analyze_message(content)

        user_message = models.ChatMessage(
            room_id=room_id,
            sender=sender,
            message_type="user",
            content=content,
            extra_data=analysis
        )

        db.add(user_message)

        # Ensure the message appears in the query immediately
        db.flush()


        
        # UPDATE EMOTIONAL METRICS
        
        session.message_count += 1

        session.avg_escalation = (
            (session.avg_escalation * (session.message_count - 1) + analysis["escalation"])
            / session.message_count
        )

        session.avg_blame = (
            (session.avg_blame * (session.message_count - 1) + analysis["blame"])
            / session.message_count
        )

        session.avg_vulnerability = (
            (session.avg_vulnerability * (session.message_count - 1) + analysis["vulnerability"])
            / session.message_count
        )


        
        # FETCH RECENT HISTORY
        #
        # FIX: Previously used .order_by(timestamp.asc()).limit(12)
        # which returned the OLDEST 12 messages, not the most recent 12.
        # At the start of a session this happens to work, but mid-session
        # the LLM would be reading stale early messages instead of the
        # live conversation. This also broke build_context() in ollama_client
        # which expected recent messages in chronological order.
        #
        # Fix: fetch all messages in chronological order, slice the last 12.
        # This is efficient enough for SQLite at prototype scale.
        
        all_messages = (
            db.query(models.ChatMessage)
            .filter_by(room_id=room_id)
            .order_by(models.ChatMessage.timestamp.asc())
            .all()
        )

        recent_messages = all_messages[-12:]


        
        # AI TURN
        
        session.current_turn = "ai"


        # Core mediation decision
        decision = decide_mediation(
            session,
            sender,
            content,
            analysis,
            recent_messages
        )


        
        # FIX: Guardrail order swapped.
        #
        # Previously: adjust_decision ran before stabilize_decision.
        # Problem: both functions independently override decision["action"],
        # so whichever ran second would silently undo the first.
        #
        # Correct order:
        #   1. stabilize_decision — evaluates content-level signals:
        #      topic repetition, skill repetition, agreement detection.
        #      These are about WHAT is being said.
        #
        #   2. adjust_decision — evaluates structural signals:
        #      action streaks, target locks, stagnation.
        #      These are about HOW the conversation is flowing.
        #
        # Content should be evaluated before structure.
        

        decision = stabilize_decision(
            session,
            decision,
            sender,
            content,
            analysis,
            recent_messages
        )

        decision = adjust_decision(
            session,
            sender,
            content,
            decision
        )


        # Update session mode if needed
        if decision.get("mode"):
            session.mode = decision["mode"]

        # Set timed lock for crisis and severe safety events
        if decision.get("mode") == "crisis_pause" or (
            decision.get("action") == "crisis_self_harm"
        ):
            from datetime import datetime, timezone, timedelta
            session.locked_until = datetime.now(timezone.utc) + timedelta(seconds=15)


        
        # GENERATE AI MESSAGE
        
        llm_output = await generate_mediation_message(
            session.name_a,
            session.name_b,
            recent_messages,
            analysis,
            decision
        )

        final_content = llm_output["message"]
        llm_suggested_target = llm_output.get("next_speaker")

        ai_message = models.ChatMessage(
            room_id=room_id,
            sender="ai",
            message_type="ai",
            content=final_content,
            extra_data={
                "action": decision.get("action"),
                "exercise": decision.get("exercise"),
                "mode": decision.get("mode"),
                "llm": True,
                "llm_suggested_target": llm_suggested_target
            }
        )

        db.add(ai_message)


        
        # DETERMINE NEXT SPEAKER
        
        action = decision.get("action")

        if action in ["cooldown_start", "safety_intervention", "repair_required"]:

            # Same person retries
            next_speaker = sender

        elif decision.get("target") in ["a", "b"]:

            next_speaker = decision["target"]

        elif session.mode == "free_chat":

            next_speaker = None

        else:

            next_speaker = "b" if sender == "a" else "a"

        session.current_turn = next_speaker


        
        # FLOOR ASSIGNMENT MESSAGE
        #
        # FIX: Previously used a single ternary:
        #   floor_name = session.name_a if next_speaker == "a" else session.name_b
        # This silently evaluated to session.name_b whenever next_speaker == "both",
        # which is wrong — it would tell the wrong person they have the floor
        # every time free_chat activated.
        #
        # Fix: explicit three-way branch handles "a", "b", and "both" correctly.
        

        if next_speaker == None:
            floor_content = (
                f"{session.name_a} and {session.name_b}, "
                "you may both speak freely."
            )
        elif next_speaker == "a":
            floor_content = f"{session.name_a}, you have the floor."
        else:
            floor_content = f"{session.name_b}, you have the floor."

        floor_message = models.ChatMessage(
            room_id=room_id,
            sender="system",
            message_type="system",
            content=floor_content,
            extra_data={"type": "turn_assignment"}
        )

        db.add(floor_message)

        db.commit()
        db.refresh(ai_message)

        return ai_message
    
    
    # MARK CRISIS READY
    
    async def mark_crisis_ready(self, db: DBSession, room_id: str, role: str):

        session = db.query(models.Session).filter_by(room_id=room_id).first()

        if not session:
            raise ValueError("Session not found")

        if session.mode != "crisis_pause":
            raise ValueError("Session is not in crisis pause")

        # Mark this partner as ready
        if role == "a":
            session.crisis_ready_a = True
        elif role == "b":
            session.crisis_ready_b = True

        db.commit()

        # Check if countdown has finished
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        locked = session.locked_until

        if locked:
            if locked.tzinfo is None:
                locked = locked.replace(tzinfo=timezone.utc)
            if now < locked:
                # Countdown still running — save the ready state but don't resume yet
                db.refresh(session)
                # Return a placeholder — frontend will poll and show waiting state
                placeholder = models.ChatMessage(
                    room_id=room_id,
                    sender="system",
                    message_type="system",
                    content=f"{'Partner A' if role == 'a' else 'Partner B'} is ready.",
                    extra_data={"type": "crisis_ready", "role": role}
                )
                db.add(placeholder)
                db.commit()
                db.refresh(placeholder)
                return placeholder

        # Both ready — resume session
        if session.crisis_ready_a and session.crisis_ready_b:

            session.mode = "guided"
            session.locked_until = None
            session.crisis_ready_a = False
            session.crisis_ready_b = False
            session.current_turn = "a"

            # Generate re-entry AI message
            # Find which partner expressed the crisis from recent messages
            recent = (
                db.query(models.ChatMessage)
                .filter_by(room_id=room_id)
                .order_by(models.ChatMessage.timestamp.desc())
                .limit(20)
                .all()
            )

            crisis_sender = None
            crisis_speaker_name = None
            for msg in recent:
                if msg.extra_data and msg.extra_data.get("crisis") in ["self_harm", "harm_to_other"]:
                    crisis_sender = msg.sender
                    crisis_speaker_name = session.name_a if msg.sender == "a" else session.name_b
                    break

            if not crisis_speaker_name:
                crisis_speaker_name = session.name_a

            other_name = session.name_b if crisis_sender == "a" else session.name_a

            # Build a minimal decision for the LLM
            decision = {
                "action": "crisis_resume",
                "target": crisis_sender or "a",
                "speaker": crisis_sender or "a",
                "quote": "I'm ready to continue",
                "feeling": None,
                "system_message": (
                    f"The session is resuming after a pause. "
                    f"Address {crisis_speaker_name} gently — acknowledge that things got very intense, "
                    f"and open a small door back into the conversation without pressure."
                ),
                "confidence": "high",
                "mode": "guided"
            }

            all_messages = (
                db.query(models.ChatMessage)
                .filter_by(room_id=room_id)
                .order_by(models.ChatMessage.timestamp.asc())
                .all()
            )
            recent_messages = all_messages[-12:]

            analysis = {
                "escalation": 0, "blame": 0, "vulnerability": 0,
                "sentiment": 0, "repair_attempt": 0, "toxicity": 0,
                "abuse_score": 0, "is_abusive": False,
                "escalation_intent": "none", "crisis": "none"
            }

            from ai.llm_client import generate_mediation_message
            llm_output = await generate_mediation_message(
                session.name_a,
                session.name_b,
                recent_messages,
                analysis,
                decision
            )

            reentry_message = models.ChatMessage(
                room_id=room_id,
                sender="ai",
                message_type="ai",
                content=llm_output["message"],
                extra_data={
                    "action": "crisis_resume",
                    "mode": "guided",
                    "llm": True
                }
            )

            db.add(reentry_message)

            floor_message = models.ChatMessage(
                room_id=room_id,
                sender="system",
                message_type="system",
                content=f"{session.name_a}, you have the floor.",
                extra_data={"type": "turn_assignment"}
            )

            db.add(floor_message)
            db.commit()
            db.refresh(reentry_message)
            return reentry_message

        # Only one partner ready so far
        db.commit()
        db.refresh(session)

        waiting_message = models.ChatMessage(
            room_id=room_id,
            sender="system",
            message_type="system",
            content=f"Waiting for both partners to be ready.",
            extra_data={"type": "crisis_waiting"}
        )
        db.add(waiting_message)
        db.commit()
        db.refresh(waiting_message)
        return waiting_message


    
    # GET CONVERSATION
    
    def get_conversation(self, db: DBSession, room_id: str):

        session = db.query(models.Session).filter_by(room_id=room_id).first()

        if not session:
            raise ValueError("Session not found")

        messages = (
            db.query(models.ChatMessage)
            .filter_by(room_id=room_id)
            .order_by(models.ChatMessage.timestamp.asc())
            .all()
        )

        return messages


    
    # GET SESSION STATE
    
    def get_session_state(self, db: DBSession, room_id: str):

        session = db.query(models.Session).filter_by(room_id=room_id).first()

        if not session:
            raise ValueError("Session not found")

        return session