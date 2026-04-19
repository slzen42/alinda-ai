from fastapi import FastAPI
from .database import engine, Base
from .routes import router
app = FastAPI(title="Alinda Backend", description="AI-mediated conflict resolution backend service", version="1.0.0")
#create database tables
Base.metadata.create_all(bind=engine)
#Register API routes
app.include_router(router)
@app.get("/")
def root():
    return {"message": "Alinda backend is running"}