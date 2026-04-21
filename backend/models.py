from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    full_name = Column(String)
    dob = Column(String)
    gender = Column(String)
    height = Column(String)
    weight = Column(String)
    goal = Column(String)
    diet = Column(String)
    chronic_conditions = Column(JSON)
    allergies = Column(JSON)
    additional_info = Column(String)

class DailyScan(Base):
    __tablename__ = "daily_scans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    scan_date = Column(Date)
    hr_bpm = Column(Float)
    stress_score = Column(Integer)
    energy_score = Column(Integer)
    health_score = Column(Integer)
    focus_score = Column(Integer)
    heuristics_text = Column(String)

class HealthEvent(Base):
    __tablename__ = "health_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    event_type = Column(String, index=True) 
    timestamp = Column(DateTime, default=datetime.utcnow)
    payload = Column(JSON)
    
    user = relationship("User")

# Add to models.py
class SearchCache(Base):
    __tablename__ = "search_cache"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(String, unique=True, index=True) # The exact search term
    result_text = Column(String) # The PubMed or Tavily payload
    source = Column(String) # 'pubmed' or 'tavily'
    last_accessed = Column(DateTime, default=datetime.utcnow) # For LRU sorting