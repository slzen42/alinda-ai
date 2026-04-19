import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routes import router

app = FastAPI(title="Alinda Backend", description="AI-mediated conflict resolution backend service", version="1.0.0")

# --- CORS SETUP FOR DEPLOYMENT ---
# Defaults to localhost for testing, will use Render environment variable in production
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8501").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create database tables
Base.metadata.create_all(bind=engine)

# Register API routes
app.include_router(router)

@app.get("/")
def root():
    return {"message": "Alinda backend is running"}