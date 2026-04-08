from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Dict, Any
from datetime import date, datetime, timedelta
from food_pipeline import analyze_food_image
import shutil
import cv2
import numpy as np
import os
import traceback
import json
import traceback
from fastapi import UploadFile, File, Depends
from fastapi.responses import JSONResponse
from celery.result import AsyncResult
from worker import process_scan_task, celery_app
from agent import app_graph
from database import engine, get_db
import models
import auth

# Creates new tables automatically (like DailyScan)
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
    diet: str
    chronic_conditions: List[str]
    allergies: List[str]
    additional_info: str

class Token(BaseModel):
    access_token: str
    token_type: str

class ChatRequest(BaseModel):
    biometrics: dict
    message: str
    history: List[Dict[str, Any]] = []

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
    new_user = models.User(email=user.email, hashed_password=hashed_pwd, full_name=user.full_name, dob=user.dob, gender=user.gender, height=user.height, weight=user.weight, diet=user.diet, chronic_conditions=user.chronic_conditions, allergies=user.allergies, additional_info=user.additional_info)
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

# --- PROFILE MANAGEMENT ROUTES ---
@app.get("/api/auth/profile")
def get_profile(current_user: models.User = Depends(get_current_user)):
    return {
        "full_name": current_user.full_name, "email": current_user.email, "dob": current_user.dob, "gender": current_user.gender,
        "height": current_user.height, "weight": current_user.weight, "diet": current_user.diet, "chronic_conditions": current_user.chronic_conditions,
        "allergies": current_user.allergies, "additional_info": current_user.additional_info
    }

@app.put("/api/auth/profile")
def update_profile(profile_data: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    for key, value in profile_data.items():
        if hasattr(current_user, key): setattr(current_user, key, value)
    db.commit()
    return {"status": "success", "message": "Profile updated securely."}

# --- CALENDAR & TREND ROUTES ---
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
def get_trends(
    timeframe: str = "7_days", 
    metric: str = "energy", # 🚀 NEW: Added metric parameter
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    today = date.today()
    if timeframe == "7_days":
        start_date = today - timedelta(days=6)
    elif timeframe == "month":
        start_date = today - timedelta(days=29)
    else:
        start_date = today - timedelta(days=6)
        
    scans = db.query(models.DailyScan).filter(
        models.DailyScan.user_id == current_user.id,
        models.DailyScan.scan_date >= start_date
    ).order_by(models.DailyScan.scan_date).all()
    
    # 🚀 FIXED: Dynamically map the metric string to the database column
    scan_dict = {}
    for scan in scans:
        if metric == "stress":
            score = scan.stress_score
        elif metric == "focus":
            score = scan.focus_score
        elif metric == "health":
            score = scan.health_score
        else:
            score = scan.energy_score # Default fallback
            
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

# --- ASYNC CELERY SCAN ROUTES ---
@app.post("/api/scan")
async def process_finger_video(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    print(f"\n--- Extracting Scan for: {current_user.email} ---")
    temp_file_path = f"temp_{file.filename}"
    with open(temp_file_path, "wb") as buffer: shutil.copyfileobj(file.file, buffer)

    cap = cv2.VideoCapture(temp_file_path)
    times, raw_signal = [], []
    valid_frames = 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 30

    frame_count = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        height, width, _ = frame.shape
        cy, cx = height // 2, width // 2
        crop = min(height, width) // 5
        roi = frame[cy-crop:cy+crop, cx-crop:cx+crop]
        red_mean = np.mean(roi[:, :, 2])
        valid_frames += 1
        times.append(frame_count / fps)
        raw_signal.append(float(red_mean))
        frame_count += 1
    cap.release()
    os.remove(temp_file_path)

    if valid_frames < 50: return JSONResponse(content={"error": "File unreadable or too short."})
    
    task = process_scan_task.delay(times, raw_signal)
    return JSONResponse(content={"task_id": task.id, "status": "processing"})

@app.get("/api/scan/status/{task_id}")
def get_scan_status(task_id: str):
    try:
        task_result = AsyncResult(task_id, app=celery_app)
        if task_result.ready():
            if task_result.successful():
                result = task_result.result
                if isinstance(result, dict) and "error" not in result: 
                    return {"status": "completed", "metrics": result.get("metrics", {}), "meta_scores": result.get("meta_scores", {})}
                else: 
                    return {"status": "failed", "error": result.get("error", "Math failed")}
            else:
                return {"status": "failed", "error": str(task_result.result)}
        return {"status": "processing"}
    except Exception as e:
        return {"status": "failed", "error": f"Broker error: {str(e)}"}

# --- CHAT ROUTE WITH INVISIBLE AUTO-SAVE ---
@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        print(f"\n--- Starting LangGraph Agent for: {current_user.email} ---")
        conds = ", ".join(current_user.chronic_conditions) if current_user.chronic_conditions else "None"
        algs = ", ".join(current_user.allergies) if current_user.allergies else "None"
        history_text = "\n".join([f"{msg['role']}: {msg['content']}" for msg in req.history[-4:]]) if req.history else "None"
        
        # 🚀 ROBUST EXTRACTION LOGIC
        metrics = req.biometrics.get("metrics", req.biometrics)
        meta = req.biometrics.get("meta_scores", req.biometrics)

        clinical_context = f"""[SYSTEM CLINICAL STATE - DO NOT ACKNOWLEDGE TO USER]
Age/DOB: {current_user.dob} | Gender: {current_user.gender}
Height: {current_user.height} | Weight: {current_user.weight}
Dietary Routine: {current_user.diet}
Allergies: {algs}
Chronic Conditions: {conds}
Additional Context: {current_user.additional_info}
Current cPPG Scan Metrics: {metrics}
Worker Meta Scores: {meta}
Recent Chat History:
{history_text}
[END SYSTEM STATE]
User Message: {req.message}"""

        initial_state = {
            "original_text": clinical_context,
            "biometrics": req.biometrics,
            "clinical_insights": "",
            "anonymized_text": "",
            "pii_mapping": {},
            "needs_research": False,
            "research_query": "",
            "research_results": "",
            "draft_response": "",
            "retry_count": 0,
            "search_retry_count": 0,
            "is_accurate": False,
            "response": ""
        }
        
        result = app_graph.invoke(initial_state)
        final_answer = result["response"]
        
        heuristics_block = result.get("clinical_insights", "")
        
        if "[END SYSTEM STATE]" in final_answer:
            final_answer = final_answer.split("[END SYSTEM STATE]")[-1].strip()
            if final_answer.startswith("User Message:"):
                final_answer = final_answer.split("\n", 1)[-1].strip()

        # 🚀 INVISIBLE AUTO-SAVE
        if req.message == "I just completed my scan.":
            today = date.today()
            existing_scan = db.query(models.DailyScan).filter(models.DailyScan.user_id == current_user.id, models.DailyScan.scan_date == today).first()
            
            # Secure Fallback extraction ensuring ints/floats
            hr = float(metrics.get("hr_bpm", 70))
            st = int(meta.get("stress", 0))
            en = int(meta.get("energy", 0))
            hl = int(meta.get("health", 0))
            fo = int(meta.get("focus", 0))
            
            if not existing_scan:
                new_scan = models.DailyScan(
                    user_id=current_user.id, scan_date=today, hr_bpm=hr,
                    stress_score=st, energy_score=en, health_score=hl, focus_score=fo,
                    heuristics_text=heuristics_block
                )
                db.add(new_scan)
                db.commit()
            else:
                existing_scan.hr_bpm = hr
                existing_scan.stress_score = st
                existing_scan.energy_score = en
                existing_scan.health_score = hl
                existing_scan.focus_score = fo
                existing_scan.heuristics_text = heuristics_block
                db.commit()

        print("--- Agent Success ---")
        return JSONResponse(content={"text": final_answer})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
    

@app.post("/api/analyze_food")
async def analyze_food_endpoint(image: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    user_profile = f"Conditions: {', '.join(current_user.chronic_conditions)}. Allergies: {', '.join(current_user.allergies)}. Diet: {current_user.diet}."
    
    try:
        # 🚀 FIX: Read bytes entirely in memory. Zero disk I/O latency!
        image_bytes = await image.read()
        
        results = analyze_food_image(image_bytes, user_profile, image.content_type)
        return JSONResponse(content={"results": results})
        
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})