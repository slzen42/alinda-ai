"""
backend/database.py

Database engine and session factory for Alinda.

Supports both local SQLite (development) and Postgres/Neon (production)
transparently via DATABASE_URL. Two environment-specific behaviors are
handled here rather than left as silent inconsistencies:

    SQLite:   Foreign key enforcement is OFF by default per-connection.
              Without explicitly turning it on, every cascade delete
              designed into models.py (TherapySession → ChatMessage,
              SessionInsight, SessionFeedback) silently does nothing
              locally, while working correctly in production against
              Postgres. This is exactly the kind of dev/prod divergence
              that causes "works on my machine, breaks in prod" — or
              worse here, the reverse: "works in prod, silently fails
              locally, never gets tested."

    Postgres: pool_pre_ping avoids errors from Neon suspending idle
              connections on its serverless tier. pool_size and
              max_overflow are set conservatively since Neon's free tier
              has a real, fairly low connection ceiling — defaults
              tuned for traditional always-on Postgres are too generous here.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./alinda.db")

# Cloud providers (Neon included) sometimes still hand out the legacy
# 'postgres://' scheme; SQLAlchemy 1.4+ requires 'postgresql://'.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        """
        Turns on foreign key enforcement for every new SQLite connection.
        Without this, ondelete='CASCADE' in models.py is silently ignored
        locally — deletes would "work" but leave orphaned rows, exactly
        the failure mode the cascade design was meant to prevent.
        """
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping = True,   # Detects and replaces Neon's suspended idle connections
        pool_recycle  = 1800,   # Proactively recycle connections every 30 minutes
        pool_size     = 5,      # Conservative — matches Neon free tier's connection ceiling
        max_overflow  = 5,      # Allows short bursts without exhausting the pool
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()