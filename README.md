# Cardia: Hybrid-AI Wellness & Health Platform

<div align="center">
  <img src="./mobile-app/assets/images/cardia_heart.png" alt="Cardia Logo" width="120" />
  <br/>
  <p><b>Zero-Effort. Privacy-First. Edge-Compute Intelligence.</b></p>
  
  [![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](#)
  [![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](#)
  [![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](#)
  [![Celery](https://img.shields.io/badge/celery-%2337814A.svg?style=for-the-badge&logo=celery&logoColor=white)](#)
  [![Postgres](https://img.shields.io/badge/postgresql-4169e1?style=for-the-badge&logo=postgresql&logoColor=white)](#)
</div>

---

## Overview
**Cardia** is a next-generation health assistant that bridges the gap between local privacy and cloud-scale reasoning. By combining **on-device Small Language Models (SLMs)** for zero-trust conversations with **cloud-based Multimodal LLMs** for high-latency spatial reasoning, Cardia delivers real-time dietary analysis, biometric tracking, and proactive cognitive behavioral therapy (CBT)—all entirely personalized to the user's clinical baseline.

---

## ✨ Core Architectures & Features

### 1. Melio: Zero-Trust On-Device SLM
Mental health data is highly sensitive. Melio is an empathetic AI chatbot that runs **100% offline** on the user's device.
* **Technology:** Uses `llama.rn` to execute a quantized Qwen 1.5B (`.gguf`) model directly on the phone's native C++ engine.
* **State-Injected Prompting:** Dynamically injects biometric stress scores and local context into the system prompt to guide the SLM's personality without network calls.

### 2. Dietary Vision Pipeline
A low-latency, spatial reasoning engine that analyzes food and validates it against the user's medical profile (allergies, chronic conditions, and custom goals).
* **Technology:** Gemini 2.5 Flash via FastAPI.
* **Optimization:** Bypasses disk I/O latency entirely by streaming raw image bytes in-memory.
* **Strict Parsing:** Utilizes Pydantic schemas to mathematically force the LLM into returning strict JSON arrays for fluid AR bounding box rendering on the frontend.

### 3. Fingertip rPPG & Agentic Orchestration
Users capture their vitals (Heart Rate) by placing their fingertip over the smartphone camera lens.
* **Technology:** OpenCV frame extraction routed to background **Celery workers** (backed by Memurai/Redis).
* **LangGraph Analytics:** Biometric signals are parsed through a LangGraph agentic workflow to extract heuristics (Stress, Energy, Health, Focus) which are automatically synced to the user's daily dashboard.

---

<details>
<summary><b>🛠️ Full Tech Stack Breakdown (Click to Expand)</b></summary>
<br>

| Layer | Technologies Used | Purpose |
| :--- | :--- | :--- |
| **Frontend UI** | React Native, Expo, React Native Reanimated | Cross-platform mobile architecture |
| **Edge AI** | `llama.rn`, Qwen 1.5B (GGUF) | On-device, offline mental health chatbot |
| **Camera/AR** | React Native Vision Camera, Expo Image Picker | Viewfinder and coordinate mapping |
| **Backend Core** | Python, FastAPI, Uvicorn | High-performance, asynchronous REST API |
| **Cloud AI** | Google GenAI SDK (Gemini 2.5 Flash) | Multimodal visual dietary reasoning |
| **Task Queue** | Celery, Redis (Memurai for Windows) | Background processing for video/rPPG data |
| **Database** | PostgreSQL, SQLAlchemy, Pydantic | Relational storage and strict schema validation |
| **Auth** | JWT (JSON Web Tokens), bcrypt | Secure, stateless user authentication |

</details>

---

## Local Installation & Setup

### Prerequisites
* **Node.js** (LTS) & **npm**
* **Python 3.10+**
* **Memurai** (Native Redis for Windows) or **Docker**
* **PostgreSQL** installed and running locally

### 1. Clone the Repository
```bash
git clone [https://github.com/YourUsername/Cardia.git](https://github.com/YourUsername/Cardia.git)
cd Cardia
````

### 2\. Backend Setup (FastAPI & Celery)

Open a terminal in the `/backend` directory.

```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Setup Environment Variables
# Create a .env file in the backend root and add:
GEMINI_API_KEY=your_api_key_here
```

**Start the Backend Services (Requires 2 Terminals):**

```bash
# Terminal 1: Start the Celery Worker (Ensure Memurai/Redis is running)
celery -A worker worker --loglevel=info --pool=solo

# Terminal 2: Start the FastAPI Server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3\. Frontend Setup (React Native / Expo)

Open a new terminal in the `/mobile-app` directory.

```bash
# Install dependencies and C++ bindings for llama.rn
npm install

# Start the Expo development server
npx expo start -c
```

> **⚠️ Critical Note on IP Addresses:** \> If testing on a physical device, ensure the `IP_ADDRESS` variable in your frontend `.tsx` files (e.g., `FoodScanner.tsx`, `auth.tsx`) matches your computer's local Wi-Fi IPv4 address.

-----

## Privacy & Architecture Decisions

## Privacy & Architecture Decisions

<details>
<summary><b>Why not run the chatbot in the cloud?</b></summary>
<br>
To adhere to a strictly zero-trust privacy policy. By downloading a quantized 970MB model to the local filesystem during initial boot, all intimate CBT and health journaling data never leaves the user's phone RAM.
</details>

<details>
<summary><b>Why use Celery for the camera scans?</b></summary>
<br>
Extracting raw RGB signal arrays from 60 frames of video per second is computationally heavy. Offloading this to a Celery worker prevents the FastAPI main event loop from blocking, allowing concurrent users to continue utilizing the API without timeout errors.
</details>

-----

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
