import os
import time
import json
import asyncio
import httpx
import urllib.parse
from dotenv import load_dotenv
from typing import TypedDict, Literal
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END

# 🚀 PostgreSQL Saver and Connection Pool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool

from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_tavily import TavilySearch

# 🚀 Unified LRU Cache Manager
from cache_manager import get_cached_search, save_to_cache

load_dotenv()

# --- MODEL DEFINITIONS ---
TEXT_MODEL = "llama-3.3-70b-versatile" 
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
SUPERVISOR_MODEL = "llama-3.3-70b-versatile"  

# --- TOOL INITIALIZATION ---
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

tavily_tool = TavilySearch(
    max_results=2,
    include_domains=[
        "mayoclinic.org", "clevelandclinic.org", "heart.org", 
        "who.int", "cdc.gov", "hsph.harvard.edu"
    ]
)

# --- STATE & SCHEMAS ---
class AgentState(TypedDict):
    original_text: str
    biometrics: dict
    user_profile: str  # 🚀 ADDED: Now the graph can hold your medical/dietary profile
    clinical_insights: str
    user_facing_insights: str
    anonymized_text: str
    pii_mapping: dict
    routing_decision: str 
    research_query: str
    raw_research_results: str 
    research_results: str
    image_data: str 
    draft_response: str
    retry_count: int
    evaluation_feedback: str
    is_accurate: bool
    response: str

class SupervisorDecision(BaseModel):
    route: Literal["clinical", "diet", "lifestyle", "general"] = Field(description="Clinical for biometrics/symptoms. Diet for food/nutrition. Lifestyle for habits. General for greetings/chit-chat.")
    search_query: str = Field(description="2-3 word search query based on context. Leave blank if general chat.")

class EvaluatorDecision(BaseModel):
    is_accurate: bool = Field(description="True ONLY if draft is safe, helpful, and perfectly grounded in research.")
    feedback: str = Field(description="Instructions to fix hallucinations or tone issues.")

# --- GRAPH NODES ---

async def safety_gate_node(state: AgentState):
    print(f"\n🛡️ [NODE 1: ASYNC SAFETY & PII GATE]")
    text = state["original_text"]
    
    all_supported_entities = analyzer.get_supported_entities(language='en')
    ENTITIES_TO_KEEP = ["LOCATION", "DATE_TIME", "NRP", "URL"]
    TARGET_ENTITIES = [e for e in all_supported_entities if e not in ENTITIES_TO_KEEP]
    
    results = analyzer.analyze(text=text, entities=TARGET_ENTITIES, language='en')
    mapping = {f"<{res.entity_type}>": text[res.start:res.end] for res in results}
    anonymized_result = anonymizer.anonymize(text=text, analyzer_results=results)
    
    lower_text = anonymized_result.text.lower()
    crisis_keywords = ["suicide", "kill myself", "heart attack right now", "chest pain crushing", "stroke"]
    if any(keyword in lower_text for keyword in crisis_keywords):
        return {"anonymized_text": anonymized_result.text, "pii_mapping": mapping, "routing_decision": "safe_escalate"}
        
    return {"anonymized_text": anonymized_result.text, "pii_mapping": mapping}

async def clinical_heuristics_node(state: AgentState):
    print(f"\n🩺 [NODE 2: QUALITATIVE CLINICAL HEURISTICS ENGINE]")
    bio = state.get("biometrics", {})
    if not bio: 
        return {
            "clinical_insights": "No real-time biometrics provided. Rely strictly on the user's text.",
            "user_facing_insights": "No biometric scan recorded for this session."
        }

    metrics = bio.get("metrics", {}) 
    meta = bio.get("meta_scores", {})

    hr = metrics.get("hr_bpm", 0)
    stress = metrics.get("raw_stress_index", 0)
    rmssd = metrics.get("rmssd_ms", 0)
    sdnn = metrics.get("sdnn_ms", 0)
    
    energy = meta.get("energy", 0)
    focus = meta.get("focus", 0)

    insights = []
    ui_insights = [] # 🚀 NEW: The UI-formatted list

    if hr > 0:
        if hr < 50: 
            hr_context = "unusually low (bradycardia)"
            ui_context = "unusually low"
        elif 50 <= hr <= 85: 
            hr_context = "in an optimal resting range"
            ui_context = "in an optimal resting range"
        elif 85 < hr <= 100: 
            hr_context = "slightly elevated"
            ui_context = "slightly elevated"
        else: 
            hr_context = "highly elevated (tachycardia)"
            ui_context = "highly elevated"
            
        insights.append(f"The user's heart rate is currently {hr_context}.")
        ui_insights.append(f"❤️ **Heart Rate:** Your heart rate is currently {ui_context} at {int(hr)} bpm.")

    if rmssd > 0:
        if rmssd < 20: 
            hrv_context = "very low parasympathetic activity, suggesting physical or mental exhaustion."
            ui_hrv = "very low, suggesting you might be physically or mentally exhausted right now."
        elif 20 <= rmssd <= 50: 
            hrv_context = "moderate recovery and a balanced autonomic tone."
            ui_hrv = "showing moderate recovery and a healthy balance."
        else: 
            hrv_context = "excellent vagal tone, high readiness, and deep relaxation."
            ui_hrv = "showing excellent recovery, high readiness, and deep relaxation."
            
        insights.append(f"Their Heart Rate Variability indicates {hrv_context}")
        ui_insights.append(f"🔋 **Recovery (HRV):** Your variability is {ui_hrv}")

    if stress > 0:
        if stress < 50: 
            stress_context = "deep relaxation and minimal central nervous system load."
            ui_stress = "deep relaxation with minimal nervous system load."
        elif 50 <= stress <= 150: 
            stress_context = "a normal, highly adaptive stress response."
            ui_stress = "a normal, highly adaptive response to your day."
        else: 
            stress_context = "significant autonomic tension and high sympathetic dominance."
            ui_stress = "significant tension. Take a moment to breathe and reset."
            
        insights.append(f"The Baevsky Stress Index reflects {stress_context}")
        ui_insights.append(f"🧘 **Stress Index:** Your stress levels reflect {ui_stress}")
        
    if sdnn > 0:
        if sdnn < 30: 
            sdnn_context = "restricted overall autonomic regulation."
            ui_sdnn = "restricted overall regulation."
        elif 30 <= sdnn <= 100: 
            sdnn_context = "healthy, stable overall autonomic regulation."
            ui_sdnn = "healthy, stable overall regulation."
        else: 
            sdnn_context = "highly flexible overall autonomic regulation."
            ui_sdnn = "highly flexible overall regulation."
            
        insights.append(f"They are showing {sdnn_context}")
        ui_insights.append(f"⚖️ **Autonomic Balance:** You are showing {ui_sdnn}")

    if energy > 0 or focus > 0:
        energy_level = "high" if energy > 70 else "moderate" if energy > 40 else "depleted"
        focus_level = "sharp" if focus > 70 else "moderate" if focus > 40 else "scattered"
        
        insights.append(f"System meta-analysis indicates {energy_level} energy readiness and {focus_level} cognitive focus.")
        ui_insights.append(f"⚡ **System State:** You have {energy_level} energy readiness and {focus_level} cognitive focus.")

    if not insights:
        return {
            "clinical_insights": "Biometric data was received but lacked recognizable markers.",
            "user_facing_insights": "Your scan was completed, but we couldn't extract clear markers today."
        }

    clinical_paragraph = "QUALITATIVE TELEMETRY SUMMARY: " + " ".join(insights) + " Do not invent or estimate any numerical values."
    
    # 🚀 NEW: Join with double line breaks so it formats beautifully in React Native Text components
    ui_paragraph = "\n\n".join(ui_insights)
    
    print(f"  -> Generated Context: {clinical_paragraph}")
    
    return {
        "clinical_insights": clinical_paragraph,
        "user_facing_insights": ui_paragraph # Return the aesthetic version to the graph state
    }

async def supervisor_node(state: AgentState):
    print(f"\n🧠 [NODE 3: HEAVY SUPERVISOR ORCHESTRATOR]")
    if state.get("routing_decision") == "safe_escalate": return {} 
        
    llm = ChatGroq(model=SUPERVISOR_MODEL, temperature=0).with_structured_output(SupervisorDecision)
    
    # 🚀 THE FIX: Explicitly tell the Supervisor to route personal data requests to 'general'
    prompt = f"""You are the Cardia Supervisor. Route the following query to the correct specialist.
    - 'clinical' -> interpreting heart rate, stress, symptoms, medical conditions requiring internet research.
    - 'diet' -> food, recipes, macros, analyzing AR food scans requiring internet research.
    - 'lifestyle' -> exercise, sleep hygiene, general wellness requiring internet research.
    - 'general' -> questions about the user's OWN profile (e.g., "what are my allergies?", "what is my goal?"), past chat history, simple greetings, or casual chat.
    
    User Query: {state['anonymized_text']}
    Real-Time Biometrics Context: {state.get('clinical_insights', 'None')}"""
    
    decision = await llm.ainvoke([HumanMessage(content=prompt)])
    
    # 🚀 THE FAILSAFE: Force the search_query to be completely empty for general routing. 
    # This guarantees the Walled Garden API calls in downstream nodes are skipped.
    search_query = "" if decision.route == "general" else decision.search_query
    
    print(f"  -> Routed to: [{decision.route.upper()}] with query: '{search_query}'")
    
    return {"routing_decision": decision.route, "research_query": search_query}

async def clinical_specialist_node(state: AgentState):
    print(f"\n👨‍⚕️ [NODE 4A: ASYNC CLINICAL (PUBMED & CACHE)]")
    query = state["research_query"]
    
    cached_data = await get_cached_search(query) 
    if cached_data:
        final_research = cached_data
        print(f"  -> 🟢 CACHE HIT (PUBMED) FOR '{query}'")
    else:
        try:
            print(f"  -> 🔴 CACHE MISS. Fetching fresh data from PubMed for '{query}'...")
            async with httpx.AsyncClient(timeout=15.0) as client:
                search_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
                search_res = await client.get(search_url, params={"db": "pubmed", "term": query, "retmode": "json", "retmax": 3})
                pmids = search_res.json().get("esearchresult", {}).get("idlist", [])
                
                if pmids:
                    fetch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
                    fetch_res = await client.get(fetch_url, params={"db": "pubmed", "id": ",".join(pmids), "retmode": "text", "rettype": "abstract"})
                    final_research = fetch_res.text[:2000] 
                    await save_to_cache(query, final_research, "pubmed")
                else:
                    final_research = "No clinical studies found."
        except Exception as e:
            print(f"  -> HTTPX Error: {e}")
            final_research = "Clinical database temporarily unavailable."

    llm = ChatGroq(model=TEXT_MODEL, temperature=0.2)
    
    # 🚀 UPDATED: Strict Invisible Tone & Profile Rules
    prompt = f"""You are Cardia's Clinical AI Specialist. 
    User Biometric State: {state.get('clinical_insights', 'None')}
    User Medical Profile: {state.get('user_profile', 'None')}
    
    CRITICAL RULE 1 (INVISIBLE CONTEXT): Use the Biometric State ONLY to adjust your conversational empathy. DO NOT explicitly mention terms like "vagal tone", "Baevsky index", "readiness", or "energy" unless the user explicitly asks about their data. Speak like a normal, caring human.
    CRITICAL RULE 2 (SAFETY): You MUST check the User Medical Profile. If they ask for advice that conflicts with their profile, warn them immediately.
    
    Medical Evidence: {final_research}
    
    Draft a warm, empathetic response without using formal citations."""
    
    res = await llm.ainvoke([SystemMessage(content=prompt), HumanMessage(content=state['anonymized_text'])])
    return {"draft_response": res.content, "research_results": final_research}

async def diet_lifestyle_specialist_node(state: AgentState):
    route = state["routing_decision"]
    print(f"\n🥗 [NODE 4B: ASYNC {route.upper()} (WALLED GARDEN & CACHE)]")
    
    query = state.get("research_query", "healthy habits")
    has_image = bool(state.get("image_data"))
    
    try:
        cached_result = await get_cached_search(query)
        if cached_result:
            print(f"  -> 🟢 CACHE HIT (TAVILY) FOR '{query}'")
            research_data = cached_result
        else:
            print(f"  -> 🔴 CACHE MISS. Fetching fresh data from Tavily for '{query}'...")
            search_output = await tavily_tool.ainvoke({"query": query})
            
            # 🚀 THE FIX: Bulletproof parsing that handles strings, lists, or dicts safely
            if isinstance(search_output, str):
                research_data = search_output
            elif isinstance(search_output, list):
                research_data = "\n".join([f"Source: {item.get('content', str(item))}" if isinstance(item, dict) else str(item) for item in search_output])
            elif isinstance(search_output, dict) and "results" in search_output:
                research_data = "\n".join([f"Source: {item.get('content', str(item))}" for item in search_output["results"]])
            else:
                research_data = str(search_output)
                
            await save_to_cache(query, research_data, "tavily")
            
    except Exception as e:
        print(f"   -> Walled Garden Error: {e}")
        research_data = "Verified search unavailable."

    # 🚀 UPDATED: Strict Invisible Tone & ALLERGY Rules
    base_prompt_rules = f"""User Biometric State: {state.get('clinical_insights', 'None')}
    User Medical Profile & Allergies: {state.get('user_profile', 'None')}
    
    CRITICAL DIETARY RULE: You MUST cross-reference all food requests against the User Medical Profile. If they ask for something they are allergic to or avoid (like eggs, nuts, etc.), immediately flag the conflict and suggest safe alternatives!
    CRITICAL TONE RULE (INVISIBLE CONTEXT): Use the Biometric State to adjust your mood, but DO NOT robotically recite their "vagal tone", "stress index", or "energy readiness" back to them. Sound like a natural human dietitian."""

    if has_image:
        print(f"  -> 📸 Image detected. Using Advanced Vision Prompting.")
        llm = ChatGroq(model=VISION_MODEL, temperature=0)
        system_prompt = f"""You are Cardia's Vision-Dietitian. 
        {base_prompt_rules}
        
        CRITICAL TASK: explicitly identify the exact contents of the image. Then, estimate nutritional impact based on their profile."""
        
        human_msg = HumanMessage(content=[
            {"type": "text", "text": state['anonymized_text']},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{state['image_data']}"}}
        ])
    else:
        llm = ChatGroq(model=TEXT_MODEL, temperature=0.2)
        system_prompt = f"""You are Cardia's {route.capitalize()} Specialist.
        {base_prompt_rules}
        
        Base your advice seamlessly on this research: {research_data}"""
        human_msg = HumanMessage(content=state['anonymized_text'])
    
    res = await llm.ainvoke([SystemMessage(content=system_prompt), human_msg])
    return {"draft_response": res.content, "research_results": research_data}

async def safe_escalate_node(state: AgentState):
    print(f"\n🚨 [NODE 4C: CRISIS ESCALATION]")
    msg = "I'm detecting that you might be experiencing a medical or emotional crisis. Cardia is an AI and cannot provide emergency care. Please immediately contact emergency services or visit the nearest hospital."
    return {"draft_response": msg, "is_accurate": True} 

async def general_chat_node(state: AgentState):
    print(f"\n💬 [NODE 4D: ASYNC GENERAL CHAT (BYPASS)]")
    llm = ChatGroq(model=TEXT_MODEL, temperature=0.5)
    
    # 🚀 UPDATED: Ensuring normal conversation doesn't sound robotic
    system_prompt = f"""You are Cardia, a friendly AI health assistant.
    User Biometric State: {state.get('clinical_insights', 'None')}
    User Medical Profile: {state.get('user_profile', 'None')}
    
    CRITICAL TONE RULE: Respond naturally and concisely. DO NOT quote their biometrics (like "vagal tone" or "stress") back to them. Just use the data internally to be more empathetic. Do not give medical advice."""
    
    res = await llm.ainvoke([SystemMessage(content=system_prompt), HumanMessage(content=state['anonymized_text'])])
    return {"draft_response": res.content, "is_accurate": True}

async def evaluate_response_node(state: AgentState):
    print(f"\n🔬 [NODE 5: ASYNC CRITIC REVIEW]")
    if state.get("routing_decision") == "safe_escalate": return {} 
        
    llm = ChatGroq(model=TEXT_MODEL, temperature=0).with_structured_output(EvaluatorDecision)
    
    # 🚀 UPDATED: Critic now enforces the allergy check and the tone rules.
    prompt = f"""You are the Cardia Medical Critic. Verify this draft against the research and the user's profile. 
    User Medical Profile: {state.get('user_profile', 'None')}
    
    CRITICAL RULE 1: Ensure the draft DOES NOT recommend a food or habit that conflicts with the User Medical Profile (e.g., if they avoid eggs, the draft cannot recommend pancakes without addressing the eggs).
    CRITICAL RULE 2: Ensure the tone is natural and does not robotically repeat terms like "vagal tone", "Baevsky Stress Index", or "energy readiness" unless it's a direct answer to a data question. 
    CRITICAL RULE 3: Do NOT flag biometric hardware terms as hallucinations.
    
    Draft: {state['draft_response']} 
    Research: {state.get('research_results', 'None')}"""
    
    evaluation = await llm.ainvoke([HumanMessage(content=prompt)])
    if not evaluation.is_accurate: 
        print(f"  -> 🛑 Reject: {evaluation.feedback}")
        
    return {"is_accurate": evaluation.is_accurate, "evaluation_feedback": evaluation.feedback, "retry_count": state.get("retry_count", 0) + 1}

async def deanonymize_node(state: AgentState):
    print(f"\n🔄 [NODE 6: DEANONYMIZE & FINALIZE]")
    final_output = state["draft_response"]
    for placeholder, original in state.get("pii_mapping", {}).items():
        final_output = final_output.replace(placeholder, original)
    return {"response": final_output}

# --- GRAPH ORCHESTRATION ---
def route_specialist(state: AgentState): return state["routing_decision"]
def route_evaluator(state: AgentState):
    if state["is_accurate"] or state.get("retry_count", 0) >= 2: return "deanonymize"
    return state["routing_decision"] 

workflow = StateGraph(AgentState)

workflow.add_node("safety_gate", safety_gate_node)
workflow.add_node("clinical_heuristics", clinical_heuristics_node)
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("clinical", clinical_specialist_node)
workflow.add_node("diet", diet_lifestyle_specialist_node)
workflow.add_node("lifestyle", diet_lifestyle_specialist_node)
workflow.add_node("safe_escalate", safe_escalate_node)
workflow.add_node("general", general_chat_node) 
workflow.add_node("evaluate_response", evaluate_response_node)
workflow.add_node("deanonymize", deanonymize_node)

workflow.add_edge(START, "safety_gate")
workflow.add_edge("safety_gate", "clinical_heuristics")
workflow.add_edge("clinical_heuristics", "supervisor")

workflow.add_conditional_edges("supervisor", route_specialist)

workflow.add_edge("clinical", "evaluate_response")
workflow.add_edge("diet", "evaluate_response")
workflow.add_edge("lifestyle", "evaluate_response")
workflow.add_edge("safe_escalate", "deanonymize") 
workflow.add_edge("general", "deanonymize") 

workflow.add_conditional_edges("evaluate_response", route_evaluator)
workflow.add_edge("deanonymize", END)

# --- POSTGRES GRAPH COMPILATION ---
DB_URI = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/postgres")

pool = None
_app_graph = None

async def get_compiled_graph():
    global _app_graph, pool
    
    if pool is None:
        pool = AsyncConnectionPool(
            conninfo=DB_URI,
            max_size=20,
            kwargs={"autocommit": True},
            open=False 
        )
        await pool.open() 
        
    if _app_graph is None:
        memory = AsyncPostgresSaver(pool)
        await memory.setup()
        _app_graph = workflow.compile(checkpointer=memory)
        
    return _app_graph