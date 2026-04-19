# Alinda

An AI-mediated couples counselling system. Two partners join a shared session 
where an AI mediator guides structured therapeutic dialogue.

## Architecture

- **Backend**: FastAPI + SQLAlchemy + SQLite
- **AI Pipeline**: Groq API (Llama 3.3-70b)
- **Frontend**: Streamlit
- **Analysis**: Custom regex-based message scorer with escalation intent classifier

## Project Structure

\```
alinda-ai/
├── backend/
│   ├── main.py
│   ├── routes.py
│   ├── models.py
│   ├── schemas.py
│   ├── database.py
│   ├── session_manager.py
│   └── ai/
│       ├── analysis.py
│       ├── mediator_logic.py
│       ├── conversation_state_controller.py
│       ├── conversation_guardrails.py
│       ├── llm_client.py
│       └── keywords.py
└── frontend/
    └── app.py
\```

## Running locally

1. Install dependencies: `pip install -r requirements.txt`
2. Set environment variables in `.env`
3. Start backend: `uvicorn backend.main:app --reload`
4. Start frontend: `streamlit run frontend/app.py`

## Status

Prototype phase. Not for production use.