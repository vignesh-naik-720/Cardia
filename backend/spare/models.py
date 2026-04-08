from sqlalchemy import Column, Integer, String, DateTime, Date, Float, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    
    # Clinical Baseline Fields
    dob = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    height = Column(String, nullable=True)
    weight = Column(String, nullable=True)
    diet = Column(String, nullable=True)
    chronic_conditions = Column(JSONB, default=[])
    allergies = Column(JSONB, default=[])
    additional_info = Column(String, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship to scans
    scans = relationship("DailyScan", back_populates="owner", cascade="all, delete-orphan")

# --- NEW: Daily Scan Table for Calendar & Trends ---
class DailyScan(Base):
    __tablename__ = "daily_scans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    scan_date = Column(Date, index=True, default=func.current_date())
    
    # Raw Metrics
    hr_bpm = Column(Float)
    
    # The 4 Meta-Heuristics from your rppg_core.py
    stress_score = Column(Integer)
    energy_score = Column(Integer)
    health_score = Column(Integer)
    focus_score = Column(Integer)
    
    # The exact clinical string extracted from LangGraph
    heuristics_text = Column(String)   
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship back to User
    owner = relationship("User", back_populates="scans")