from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .database import SessionLocal

from .schemas import (
    CreateRoomRequest,
    JoinRoomRequest,
    IntakeSubmission,
    SessionStateResponse,
    SendMessageRequest,
    MessageResponse,
    ConversationResponse,
    CrisisReadyRequest
)

from .session_manager import SessionManager


router = APIRouter(prefix="/api/v1/session", tags=["Session"])

manager = SessionManager()



# DB Dependency

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



# CREATE ROOM

@router.post("/create-room", response_model=SessionStateResponse)
def create_room(request: CreateRoomRequest, db: Session = Depends(get_db)):

    try:
        session = manager.create_room(db, request.room_id, request.name_a)
        return session

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))



# JOIN ROOM

@router.post("/join-room", response_model=SessionStateResponse)
def join_room(request: JoinRoomRequest, db: Session = Depends(get_db)):

    try:
        session = manager.join_room(db, request.room_id, request.name_b)
        return session

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))



# SUBMIT INTAKE

@router.post("/submit-intake", response_model=SessionStateResponse)
def submit_intake(request: IntakeSubmission, db: Session = Depends(get_db)):

    try:
        session = manager.submit_intake(
            db,
            request.room_id,
            request.role,
            request.intake_text
        )

        return session

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))



# GET SESSION

@router.get("/session/{room_id}", response_model=SessionStateResponse)
def get_session(room_id: str, db: Session = Depends(get_db)):

    try:
        session = manager.get_session_state(db, room_id)
        return session

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))



# SEND MESSAGE (ASYNC)

@router.post("/message", response_model=MessageResponse)
async def send_message(request: SendMessageRequest, db: Session = Depends(get_db)):

    try:
        ai_message = await manager.send_message(
            db,
            request.room_id,
            request.sender,
            request.content
        )

        return ai_message

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))



# GET CONVERSATION

@router.get("/conversation/{room_id}", response_model=ConversationResponse)
def get_conversation(room_id: str, db: Session = Depends(get_db)):

    try:

        messages = manager.get_conversation(db, room_id)

        return {
            "room_id": room_id,
            "messages": messages
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    

# MARK CRISIS READY


@router.post("/crisis-ready", response_model=MessageResponse)
async def mark_crisis_ready(request: CrisisReadyRequest, db: Session = Depends(get_db)):
    try:
        message = await manager.mark_crisis_ready(db, request.room_id, request.role)
        return message
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))