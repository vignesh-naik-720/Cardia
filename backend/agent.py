import os
import time
import urllib.request
import urllib.parse
import json
from dotenv import load_dotenv
from typing import TypedDict, Literal
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

# 1. State Definition
class AgentState(TypedDict):
    original_text: str
    biometrics: dict
    clinical_insights: str
    anonymized_text: str
    pii_mapping: dict
    needs_research: bool
    reasoning: str
    research_query: str
    research_results: str
    draft_response: str
    retry_count: int
    search_retry_count: int
    evaluation_feedback: str
    is_accurate: bool
    response: str
    latency: dict 
    tokens: dict

# 2. Pydantic Models for Structured Output
class RouterDecision(BaseModel):
    needs_research: bool = Field(description="True ONLY if the query requires medical facts. False for casual chat.")
    reasoning: str = Field(description="Short explanation of decision.")
    search_query: str = Field(description="Specific PubMed search query if needs_research is True.")

class QueryReformulation(BaseModel):
    new_query: str = Field(description="A broader medical search query using standard MeSH terms.")

class EvaluatorDecision(BaseModel):
    is_accurate: bool = Field(description="True ONLY if draft is safe and perfectly grounded in research.")
    feedback: str = Field(description="Instructions to fix hallucinations.")

# --- NODES ---

def clinical_heuristics_node(state: AgentState):
    """
    Translates raw math from the cPPG scan into strict English clinical context.
    Covers all numerical bands to absolutely prevent LLM hallucination.
    """
    print(f"\n{'='*70}\n🩺 [NODE 0: CLINICAL HEURISTICS ENGINE]")
    bio = state.get("biometrics", {})
    if not bio:
        print("   -> No real-time biometrics provided.")
        return {"clinical_insights": "No real-time biometrics provided."}

    insights = []
    
    metrics = bio.get("metrics", bio) 
    meta_scores = bio.get("meta_scores", {})
    
    hr = metrics.get("hr_bpm", metrics.get("hr", 0))
    sdnn = metrics.get("sdnn_ms", metrics.get("sdnn", 0))
    rmssd = metrics.get("rmssd_ms", metrics.get("rmssd", 0))
    stress = metrics.get("raw_stress_index", metrics.get("stress_index", 0))

    # --- 1. HEART RATE (BPM) ---
    if hr > 0:
        if hr < 50: insights.append(f"Heart Rate is unusually low ({hr} BPM), indicating either high athletic conditioning or bradycardia.")
        elif 50 <= hr <= 85: insights.append(f"Heart Rate is in an optimal resting range ({hr} BPM).")
        elif 85 < hr <= 100: insights.append(f"Heart Rate is high-normal ({hr} BPM), suggesting mild arousal, caffeine, or recent movement.")
        else: insights.append(f"Heart Rate is elevated ({hr} BPM), indicating acute physical or psychological stress.")

    # --- 2. SDNN (Overall Autonomic Adaptability) ---
    if sdnn > 0:
        if sdnn < 30: insights.append("SDNN is critically low, indicating severely compromised autonomic function or systemic fatigue.")
        elif 30 <= sdnn <= 50: insights.append("SDNN is below average, showing reduced ability to cope with immediate stressors.")
        elif 50 < sdnn <= 100: insights.append("SDNN is normal, indicating a healthy, adaptable autonomic nervous system.")
        else: insights.append("SDNN is high, indicating excellent autonomic adaptability and cardiovascular health.")

    # --- 3. RMSSD (Vagal Tone / Parasympathetic Rest) ---
    if rmssd > 0:
        if rmssd < 20: insights.append("RMSSD is critically low. The parasympathetic system is suppressed, indicating 'fight-or-flight' dominance.")
        elif 20 <= rmssd <= 40: insights.append("RMSSD is sub-optimal, showing mild sympathetic dominance and lower recovery state.")
        elif 40 < rmssd <= 70: insights.append("RMSSD is good, indicating active parasympathetic recovery and a well-rested state.")
        else: insights.append("RMSSD is highly robust. The user is in a state of deep recovery with excellent vagal tone.")

    # --- 4. BAEVSKY STRESS INDEX ---
    if stress > 0:
        if stress < 50: insights.append("Baevsky Stress Index is very low (<50). The user is deeply relaxed.")
        elif 50 <= stress <= 150: insights.append("Baevsky Stress Index is normal (50-150). The user is experiencing standard waking physiological tone.")
        elif 150 < stress <= 500: insights.append("Baevsky Stress Index is high (150-500). The user is under significant autonomic tension.")
        else: insights.append("Baevsky Stress Index is dangerously high (>500). The user is experiencing severe acute stress or physical exhaustion.")

    # --- 5. META SCORES (Focus & Energy) ---
    focus = meta_scores.get("focus")
    if focus is not None:
        if focus < 30: insights.append("Cognitive focus state is severely depleted. The user is likely highly distracted or experiencing brain fog.")
        elif 30 <= focus <= 60: insights.append("Cognitive focus state is sub-optimal. The user's attention is drifting.")
        elif 60 < focus <= 80: insights.append("Cognitive focus state is good. The user is engaged and present.")
        else: insights.append("Cognitive focus state is excellent. The user is hyper-focused and highly alert.")
        
    energy = meta_scores.get("energy")
    if energy is not None:
        if energy < 30: insights.append("Physical energy capacity is critically low. The user requires rest.")
        elif 30 <= energy <= 60: insights.append("Physical energy capacity is moderate. The user is mildly fatigued.")
        elif 60 < energy <= 80: insights.append("Physical energy capacity is solid. The user is capable of normal daily exertion.")
        else: insights.append("Physical energy capacity is peaked. The user is fully recovered and energized.")

    final_insight = " ".join(insights)
    print(f"   -> Extracted State: {final_insight}")
    
    return {"clinical_insights": final_insight}

def scrub_pii_node(state: AgentState):
    start_time = time.time()
    text = state["original_text"]
    
    print(f"\n🛡️ [NODE 1: PII SCRUBBER]")
    
    all_supported_entities = analyzer.get_supported_entities(language='en')
    ENTITIES_TO_KEEP = ["LOCATION", "DATE_TIME", "NRP", "URL"]
    TARGET_ENTITIES = [e for e in all_supported_entities if e not in ENTITIES_TO_KEEP]
    
    results = analyzer.analyze(text=text, entities=TARGET_ENTITIES, language='en')
    mapping = {f"<{res.entity_type}>": text[res.start:res.end] for res in results}
        
    anonymized_result = anonymizer.anonymize(text=text, analyzer_results=results)
    latency = round(time.time() - start_time, 3)
    
    return {
        "anonymized_text": anonymized_result.text, 
        "pii_mapping": mapping,
        "retry_count": 0,            
        "search_retry_count": 0,
        "evaluation_feedback": "",    
        "latency": {"scrub_node": latency},
        "tokens": {"total": 0} 
    }

def reason_and_route_node(state: AgentState):
    print(f"\n🧠 [NODE 2: REASON & ROUTE]")
    llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
    structured_llm = llm.with_structured_output(RouterDecision)
    
    prompt = f"""Analyze the user input. You MUST trigger 'needs_research: True' for ANY question involving:
    1. Medical symptoms or conditions.
    2. Dietary choices, food interactions, or digestion.
    3. Exercise, sleep, or physical physiology.
    
    If True, provide a 2-3 word PubMed query. 
    User Input: {state['anonymized_text']}
    
    Examples:
    - User: 'chest pain after coffee' -> True (Query: 'caffeine dyspepsia')
    - User: 'milk coffee after heavy chicken' -> True (Query: 'dairy protein digestion' or 'caffeine iron absorption')
    - User: 'hello how are you' -> False
    """
    
    decision = structured_llm.invoke([HumanMessage(content=prompt)])
    print(f"   -> Needs Research?: {decision.needs_research}")
    if decision.needs_research:
        print(f"   -> Query: '{decision.search_query}'")
    
    return {
        "needs_research": decision.needs_research,
        "reasoning": decision.reasoning,
        "research_query": decision.search_query
    }

def pubmed_research_node(state: AgentState):
    start_time = time.time()
    query = state["research_query"]
    attempt_num = state.get("search_retry_count", 0) + 1
    print(f"\n📚 [NODE 3: NATIVE PUBMED API (Attempt {attempt_num})]")
    
    try:
        search_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        params = urllib.parse.urlencode({"db": "pubmed", "term": query, "retmode": "json", "retmax": 3})
        
        with urllib.request.urlopen(f"{search_url}?{params}", timeout=10) as response:
            search_data = json.loads(response.read().decode())
            pmids = search_data.get("esearchresult", {}).get("idlist", [])
        
        if not pmids:
            research_data = "**Total Found:** 0"
        else:
            fetch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
            fetch_params = urllib.parse.urlencode({
                "db": "pubmed", "id": ",".join(pmids), "retmode": "text", "rettype": "abstract"
            })
            
            with urllib.request.urlopen(f"{fetch_url}?{fetch_params}", timeout=15) as fetch_response:
                research_data = fetch_response.read().decode('utf-8')
                
    except Exception as e:
        print(f"   -> 🚨 NATIVE API CRASH DETAILS: {e}")
        research_data = "**Total Found:** 0"

    if "**Total Found:** 0" not in research_data:
        print(f"   -> ✅ Research successfully retrieved.")
        
        print("\n" + "="*70)
        print("📑 [GROUND TRUTH: PUBMED PAPERS EXTRACTED]")
        print("="*70)
        print(f"{str(research_data)[:1500]}\n... [TRUNCATED FOR TERMINAL] ...") 
        print("="*70 + "\n")
    
    current_latency = state.get("latency", {})
    current_latency["pubmed_node"] = current_latency.get("pubmed_node", 0) + (time.time() - start_time)
    
    return {"research_results": research_data, "latency": current_latency}

def rephrase_query_node(state: AgentState):
    print(f"\n💡 [NODE 3b: QUERY REFORMULATION]")
    llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
    structured_llm = llm.with_structured_output(QueryReformulation)
    
    prompt = f"""The previous PubMed query '{state['research_query']}' returned 0 results. 
    User is asking about: {state['anonymized_text']}
    Generate a DIFFERENT, BROADER 2-3 word medical query."""
    
    decision = structured_llm.invoke([HumanMessage(content=prompt)])
    print(f"   -> New Query: '{decision.new_query}'")
    
    return {"research_query": decision.new_query, "search_retry_count": state.get("search_retry_count", 0) + 1}

def generate_response_node(state: AgentState):
    """
    The core generation node. Uses Invisible Grounding to absorb user context 
    without sounding like a robotic medical chart.
    """
    attempt_num = state.get("retry_count", 0) + 1
    print(f"\n✍️ [NODE 4: LLM GENERATOR (Attempt {attempt_num})]")
    llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0) 
    
    has_research = state.get("needs_research") and "**Total Found:** 0" not in state.get("research_results", "")
    
    # 1. INVISIBLE GROUNDING CONTEXT ENGINEERING
    heuristics = f"""
    BACKGROUND LATENT KNOWLEDGE:
    {state.get('clinical_insights', 'None')}
    
    CRITICAL TONE DIRECTIVE:
    You are Cardia, a warm, empathetic health companion. 
    1. DO NOT explicitly list the user's demographic or profile data back to them (e.g., NEVER say "Since you have hypertension..." or "Because of your peanut allergy...").
    2. Keep their profile in mind ONLY to guide context invisibly and avoid giving dangerous advice.
    3. Speak naturally, conversationally, and warmly. Focus on answering their actual prompt.
    """
    
    # 2. Inject PubMed (Hide formatting from user)
    if has_research:
        context = f"""
        Base any medical claims strictly on this research:
        {state['research_results']}
        
        CRITICAL RULES FOR RESPONSE:
        1. DO NOT include bracketed citations (e.g., [1], [2]).
        2. DO NOT include a "Sources", "References", or "PMID" section at the end.
        3. Integrate the knowledge smoothly as if you are a knowledgeable doctor speaking directly to a patient.
        """
    else:
        context = "No PubMed data found. DO NOT invent facts or citations. Suggest consulting a professional."

    # 3. Inject Critic Feedback
    correction = f"\nCRITICAL FEEDBACK FROM EVALUATOR - FIX THIS: {state['evaluation_feedback']}" if state.get("evaluation_feedback") else ""

    system_prompt = f"{heuristics}\n\n{context} {correction}"
    res = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=state['anonymized_text'])])
    
    return {"draft_response": res.content}

def evaluate_response_node(state: AgentState):
    print(f"\n🔬 [NODE 5: CRITIC REVIEW]")
    llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)
    structured_llm = llm.with_structured_output(EvaluatorDecision)
    
    prompt = f"Verify response against research. Ensure no hallucinations. \nDraft: {state['draft_response']} \nResearch: {state.get('research_results', 'None')}"
    
    evaluation = structured_llm.invoke([HumanMessage(content=prompt)])
    if not evaluation.is_accurate: print(f"   -> 🛑 Reject: {evaluation.feedback}")
        
    return {"is_accurate": evaluation.is_accurate, "evaluation_feedback": evaluation.feedback, "retry_count": state.get("retry_count", 0) + 1}

def deanonymize_node(state: AgentState):
    print(f"\n🔄 [NODE 6: DEANONYMIZE]")
    final_output = state["draft_response"]
    for placeholder, original in state["pii_mapping"].items():
        final_output = final_output.replace(placeholder, original)
            
    print(f"   -> Output Ready.\n{'='*70}\n")
    return {"response": final_output}

# --- GRAPH ORCHESTRATION ---
workflow = StateGraph(AgentState)

workflow.add_node("clinical_heuristics", clinical_heuristics_node)
workflow.add_node("scrub_pii", scrub_pii_node)
workflow.add_node("reason_and_route", reason_and_route_node)
workflow.add_node("pubmed_research", pubmed_research_node)
workflow.add_node("rephrase_query", rephrase_query_node)
workflow.add_node("generate_response", generate_response_node)
workflow.add_node("evaluate_response", evaluate_response_node)
workflow.add_node("deanonymize", deanonymize_node)

workflow.add_edge(START, "clinical_heuristics")
workflow.add_edge("clinical_heuristics", "scrub_pii")
workflow.add_edge("scrub_pii", "reason_and_route")
workflow.add_conditional_edges("reason_and_route", lambda x: "pubmed_research" if x["needs_research"] else "generate_response")
workflow.add_conditional_edges("pubmed_research", lambda x: "rephrase_query" if "**Total Found:** 0" in x["research_results"] and x["search_retry_count"] < 2 else "generate_response")
workflow.add_edge("rephrase_query", "pubmed_research")
workflow.add_edge("generate_response", "evaluate_response")
workflow.add_conditional_edges("evaluate_response", lambda x: "deanonymize" if x["is_accurate"] or x["retry_count"] >= 2 else "generate_response")
workflow.add_edge("deanonymize", END)

app_graph = workflow.compile()