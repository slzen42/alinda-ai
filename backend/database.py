from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from dotenv import load_dotenv
#load env variables
load_dotenv()
#get database url from .env or deault tp SQLite file
DATABSE_URL = os.getenv("DATABASE_URL","sqlite:///./alinda.db")
#create db engine
engine = create_engine(DATABSE_URL, connect_args={"check_same_thread":False}) #needed for sqlite
#create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
#base class for models
Base = declarative_base()