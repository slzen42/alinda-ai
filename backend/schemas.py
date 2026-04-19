from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
class CreateRoomRequest(BaseModel):
    room_id: str = Field(..., min_length=1)
    name_a: str = Field(..., min_length=1)
class JoinRoomRequest(BaseModel):
    room_id: str = Field(..., min_length=1)
    name_b: str = Field(..., min_length=1)
class IntakeSubmission(BaseModel):
    room_id: str = Field(..., min_length=1)
    role: Literal["a", "b"]
    intake_text: str = Field(..., min_length=1)
class SessionStateResponse(BaseModel):
    room_id: str
    name_a: Optional[str]
    name_b: Optional[str]
    phase: str
    current_turn: Optional[str] = None
    mode: str
    intake_a: Optional[str]
    intake_b: Optional[str]
    created_at: datetime
    locked_until: Optional[datetime] = None
    crisis_ready_a: Optional[bool] = False
    crisis_ready_b: Optional[bool] = False
    class Config:
        from_attributes = True #allows ORM compatibility
class SendMessageRequest(BaseModel):
    room_id: str = Field(..., min_length=1)
    sender: Literal["a", "b"]
    content: str = Field(..., min_length=1)
class MessageResponse(BaseModel):
    id: int
    room_id: str
    sender: str
    message_type: str
    content: str
    extra_data: Optional[dict]
    timestamp: datetime

    class Config:
        from_attributes = True
class ConversationResponse(BaseModel):
    room_id: str
    messages: list[MessageResponse]

class CrisisReadyRequest(BaseModel):
    room_id: str = Field(... , min_length=1)
    role: Literal["a", "b"]