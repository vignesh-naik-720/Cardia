import sys
import asyncio

# 🚀 WINDOWS ASYNC FIX: Must happen before any database pools are initialized!
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import date, datetime, timedelta
from food_pipeline import analyze_food_image
import shutil
import cv2
import numpy as np
import os
import traceback
import json
from celery.result import AsyncResult
from worker import process_scan_task, celery_app

# 🚀 Import the async getter function for the LangGraph agent
from agent import get_compiled_graph

from database import engine, get_db
import models
import auth

models.Base.metadata.create_all(bind=engine)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

class UserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    dob: str
    gender: str
    height: str
    weight: str
    goal: str 
    diet: str
    chronic_conditions: List[str]
    allergies: List[str]
    additional_info: str

class Token(BaseModel):
    access_token: str
    token_type: str

class ChatRequest(BaseModel):
    biometrics: Optional[dict] = None
    message: str
    image_data: Optional[str] = None 
    history: List[Dict[str, Any]] = []
    context_type: str = "scan"

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None: raise credentials_exception
    except auth.JWTError: raise credentials_exception
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None: raise credentials_exception
    return user

@app.post("/api/auth/signup", response_model=Token)
def signup(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == user.email).first(): raise HTTPException(status_code=400, detail="Email already registered")
    hashed_pwd = auth.get_password_hash(user.password)
    new_user = models.User(email=user.email, hashed_password=hashed_pwd, full_name=user.full_name, dob=user.dob, gender=user.gender, height=user.height, weight=user.weight, goal=user.goal, diet=user.diet, chronic_conditions=user.chronic_conditions, allergies=user.allergies, additional_info=user.additional_info)
    db.add(new_user)
    db.commit()
    access_token = auth.create_access_token(data={"sub": new_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/auth/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password): raise HTTPException(status_code=400, detail="Incorrect email or password")
    access_token = auth.create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/profile")
def get_profile(current_user: models.User = Depends(get_current_user)):
    return {
        "full_name": current_user.full_name, "email": current_user.email, "dob": current_user.dob, "gender": current_user.gender,
        "height": current_user.height, "weight": current_user.weight, "goal": current_user.goal, "diet": current_user.diet, "chronic_conditions": current_user.chronic_conditions,
        "allergies": current_user.allergies, "additional_info": current_user.additional_info
    }

@app.put("/api/auth/profile")
def update_profile(profile_data: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    for key, value in profile_data.items():
        if hasattr(current_user, key): setattr(current_user, key, value)
    db.commit()
    return {"status": "success", "message": "Profile updated securely."}

@app.get("/api/calendar")
def get_calendar_data(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    scans = db.query(models.DailyScan.scan_date).filter(models.DailyScan.user_id == current_user.id).all()
    scanned_dates = [scan[0].strftime("%Y-%m-%d") for scan in scans]
    return {"scanned_dates": scanned_dates}

@app.get("/api/scan/{target_date}")
def get_scan_context(target_date: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        date_obj = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
        
    scan = db.query(models.DailyScan).filter(models.DailyScan.user_id == current_user.id, models.DailyScan.scan_date == date_obj).first()
    if not scan: return {"status": "no_data"}
    return {"status": "success", "heuristics": scan.heuristics_text}

@app.get("/api/trends")
def get_trends(timeframe: str = "7_days", metric: str = "energy", db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    today = date.today()
    if timeframe == "7_days": start_date = today - timedelta(days=6)
    elif timeframe == "month": start_date = today - timedelta(days=29)
    else: start_date = today - timedelta(days=6)
        
    scans = db.query(models.DailyScan).filter(
        models.DailyScan.user_id == current_user.id,
        models.DailyScan.scan_date >= start_date
    ).order_by(models.DailyScan.scan_date).all()
    
    scan_dict = {}
    for scan in scans:
        if metric == "stress": score = scan.stress_score
        elif metric == "focus": score = scan.focus_score
        elif metric == "health": score = scan.health_score
        else: score = scan.energy_score 
            
        scan_dict[scan.scan_date] = score
        
    labels, data = [], []
    current_date = start_date
    
    while current_date <= today:
        if timeframe == "7_days":
            labels.append(current_date.strftime("%a")) 
        else:
            labels.append(current_date.strftime("%d %b") if current_date.day % 5 == 0 else "")
                
        data.append(scan_dict.get(current_date, 0)) 
        current_date += timedelta(days=1)
        
    return {"labels": labels, "datasets": [{"data": data}]}

@app.post("/api/scan")
async def process_finger_video(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    print(f"\n--- Extracting Scan for: {current_user.email} ---")
    temp_file_path = f"temp_{file.filename}"
    with open(temp_file_path, "wb") as buffer: shutil.copyfileobj(file.file, buffer)

    cap = cv2.VideoCapture(temp_file_path)
    times, raw_signal = [], []
    valid_frames = 0
    
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_skip = int(fps // 15) if fps > 30 else 1 
    
    frame_count = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        
        if frame_count % frame_skip == 0:
            height, width, _ = frame.shape
            cy, cx = height // 2, width // 2
            crop = min(height, width) // 5
            
            roi = frame[cy-crop:cy+crop, cx-crop:cx+crop, 1] 
            green_mean = roi.mean() 
            
            valid_frames += 1
            times.append(frame_count / fps)
            raw_signal.append(float(green_mean))
            
        frame_count += 1
        
    cap.release()
    os.remove(temp_file_path)

    if valid_frames < 50: return JSONResponse(content={"error": "File unreadable or too short."})
    
    task = process_scan_task.delay(times, raw_signal)
    return JSONResponse(content={"task_id": task.id, "status": "processing"})

@app.get("/api/scan/status/{task_id}")
def get_scan_status(task_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        task_result = AsyncResult(task_id, app=celery_app)
        if task_result.ready():
            if task_result.successful():
                result = task_result.result
                if isinstance(result, dict) and "error" not in result:
                    new_event = models.HealthEvent(
                        user_id=current_user.id,
                        event_type="cppg_scan_completed",
                        payload=result
                    )
                    db.add(new_event)
                    db.commit()
                    return {"status": "completed", "metrics": result.get("metrics", {}), "meta_scores": result.get("meta_scores", {})}
                else: 
                    return {"status": "failed", "error": result.get("error", "Math failed")}
            else:
                return {"status": "failed", "error": str(task_result.result)}
        return {"status": "processing"}
    except Exception as e:
        return {"status": "failed", "error": f"Broker error: {str(e)}"}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        print(f"\n--- Starting LangGraph Supervisor for: {current_user.email} [{req.context_type.upper()}] ---")
        conds = ", ".join(current_user.chronic_conditions) if current_user.chronic_conditions else "None"
        algs = ", ".join(current_user.allergies) if current_user.allergies else "None"
        addinfo = ", ".join(current_user.additional_info) if current_user.additional_info else "None"
        
        # 🚀 UPDATE 1: Cleanly format chat history without injecting the profile here.
        history_text = "\n".join([f"{msg['role']}: {msg['content']}" for msg in req.history[-4:]]) if req.history else ""
        current_message = f"Chat History:\n{history_text}\nUser Message: {req.message}" if history_text else req.message
        
        bio_data = req.biometrics or {}
        
        if req.context_type == "anytime" and not bio_data:
            latest_event = db.query(models.HealthEvent).filter(
                models.HealthEvent.user_id == current_user.id,
                models.HealthEvent.event_type == "cppg_scan_completed"
            ).order_by(models.HealthEvent.timestamp.desc()).first()
            
            if latest_event:
                bio_data = latest_event.payload

        metrics = bio_data.get("metrics", {})
        meta = bio_data.get("meta_scores", {})

        # 🚀 UPDATE 2: Create a dedicated, structured profile string.
        user_profile_data = f"""Age: {current_user.dob} | Gender: {current_user.gender}
Goal: {current_user.goal} | Diet: {current_user.diet}
Allergies/Aversions: {algs} | Medical Conditions: {conds} | Additional Info: {addinfo}"""

        # 🚀 UPDATE 3: Pass data cleanly into their respective state variables.
        initial_state = {
            "original_text": current_message,  # ONLY the chat message goes here
            "biometrics": bio_data,
            "user_profile": user_profile_data, # Explicitly pass the profile here!
            "clinical_insights": "",
            "anonymized_text": "",
            "pii_mapping": {},
            "routing_decision": "",
            "research_query": "",
            "raw_research_results": "",
            "research_results": "",
            "image_data": req.image_data or "",
            "draft_response": "",
            "retry_count": 0,
            "evaluation_feedback": "",
            "is_accurate": False,
            "response": ""
        }
        
        app_graph = await get_compiled_graph()
        config = {"configurable": {"thread_id": str(current_user.id)}}
        result = await app_graph.ainvoke(initial_state, config=config)
        final_answer = result["response"]
        
        chat_event = models.HealthEvent(
            user_id=current_user.id,
            event_type="chat_session",
            payload={"message": req.message, "agent_response": final_answer, "route": result.get("routing_decision")}
        )
        db.add(chat_event)
        
        if req.context_type == "scan" and req.message == "I just completed my scan.":
            today = date.today()
            existing_scan = db.query(models.DailyScan).filter(models.DailyScan.user_id == current_user.id, models.DailyScan.scan_date == today).first()
            
            hr = float(metrics.get("hr_bpm", 70))
            st = int(meta.get("stress", 0))
            en = int(meta.get("energy", 0))
            hl = int(meta.get("health", 0))
            fo = int(meta.get("focus", 0))
            
            if not existing_scan:
                new_scan = models.DailyScan(
                    user_id=current_user.id, scan_date=today, hr_bpm=hr,
                    stress_score=st, energy_score=en, health_score=hl, focus_score=fo,
                    # 🚀 UPDATE THIS LINE TO GRAB THE NEW UI STRING:
                    heuristics_text=result.get("user_facing_insights", "") 
                )
                db.add(new_scan)
            else:
                existing_scan.hr_bpm = hr
                existing_scan.stress_score = st
                existing_scan.energy_score = en
                existing_scan.health_score = hl
                existing_scan.focus_score = fo
                # 🚀 UPDATE THIS LINE TOO:
                existing_scan.heuristics_text = result.get("user_facing_insights", "")
                
        db.commit()
        return JSONResponse(content={"text": final_answer})
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/analyze_food")
async def analyze_food_endpoint(image: UploadFile = File(...), current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_profile = f"Goal: {current_user.goal}. Conditions: {', '.join(current_user.chronic_conditions)}. Allergies: {', '.join(current_user.allergies)}. Diet: {current_user.diet}."
    
    try:
        image_bytes = await image.read()
        results = analyze_food_image(image_bytes, user_profile, image.content_type)
        
        food_event = models.HealthEvent(
            user_id=current_user.id,
            event_type="food_analysis",
            payload=results
        )
        db.add(food_event)
        db.commit()
        
        return JSONResponse(content={"results": results})
        
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
    
# --- Bottom of main.py ---

# 🚀 The Ultimate Windows Async Fix
if __name__ == "__main__":
    import uvicorn
    import asyncio
    import sys
    
    # Force the correct event loop before Uvicorn starts
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        
    # Launch Uvicorn programmatically
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)