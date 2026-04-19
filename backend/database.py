import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from dotenv import load_dotenv

# Load env variables
load_dotenv()

# Get database url from .env or default to SQLite file
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./alinda.db")

# Fix for cloud providers (like Neon) that provide outdated 'postgres://' prefixes
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite requires a special thread argument, Postgres does NOT
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # THE FIX: Tell SQLAlchemy to test connections before using them
    # and to recycle them every 30 minutes (1800 seconds)
    engine = create_engine(
        DATABASE_URL, 
        pool_pre_ping=True, 
        pool_recycle=1800
    )

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()