import json
import os
import base64
import time
from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Load API Keys
load_dotenv()

# --- INITIALIZE BOTH CLIENTS ---

# 1. Gemini (Primary)
from google import genai
from google.genai import types
gemini_api_key = os.getenv("GEMINI_API_KEY")
if not gemini_api_key:
    print("⚠️ WARNING: GEMINI_API_KEY not found in .env file!")
gemini_client = genai.Client(api_key=gemini_api_key) if gemini_api_key else None

# 2. Groq (Fallback)
from groq import Groq
groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    print("⚠️ WARNING: GROQ_API_KEY not found in .env file!")
groq_client = Groq(api_key=groq_api_key) if groq_api_key else None


# --- PYDANTIC SCHEMAS (Shared by both models) ---
class BoundingBox(BaseModel):
    ymin: int = Field(description="Top edge (0-1000)")
    xmin: int = Field(description="Left edge (0-1000)")
    ymax: int = Field(description="Bottom edge (0-1000)")
    xmax: int = Field(description="Right edge (0-1000)")

class FoodItem(BaseModel):
    name: str = Field(description="Brand and Product Name")
    verdict: str = Field(description="'safe', 'warning', or 'unsafe'")
    detailed_guideline: str = Field(description="A 2-3 sentence detailed clinical guideline tailored to the user profile.")
    macro_1_name: str = Field(description="Most relevant macro (e.g., Sugar, Protein)")
    macro_1_amount: str = Field(description="Amount/Level (e.g., 14g, High)")
    macro_2_name: str = Field(description="Second relevant macro (e.g., Net Carbs, Sodium)")
    macro_2_amount: str = Field(description="Amount/Level (e.g., 2g, Low)")
    box: BoundingBox

class FoodAnalysis(BaseModel):
    items: list[FoodItem]


# --- THE UNIFIED FAULT-TOLERANT FUNCTION ---
def analyze_food_image(image_bytes: bytes, user_profile: str, mime_type: str = "image/jpeg"):
    """
    Highly available spatial pipeline. Attempts Gemini 2.5 Flash first.
    If Gemini throws a 503 or fails, instantly falls back to Groq (Llama-4-Vision).
    """
    
    # ==========================================================
    # ATTEMPT 1: GEMINI 2.5 FLASH (PRIMARY)
    # ==========================================================
    if gemini_client:
        print("🚀 [PRIMARY] Routing to Gemini 2.5 Flash...")
        try:
            prompt = f"""
            You are an expert clinical dietary assistant and precise computer vision system. 
            Analyze this image and find ALL food products, beverages, snacks, and packaged goods.
            
            CRITICAL OCR INSTRUCTION: Do NOT guess the product based on packaging color or shape. You MUST physically read the exact printed text on the label.
            Fetch the nutritional information directly from the label. If the text is blurry or unclear, mark the item as 'warning' and note in the detailed guideline that the image quality needs improvement for a definitive analysis.
            Use the nutritional information to determine the verdict strictly based on the user's health profile. If uncertain, default to 'warning' and provide a detailed guideline on what specific information is needed to move it to 'safe' or 'unsafe'.
            User Profile: {user_profile}
            Evaluate safety based strictly on the User Profile.
            Coordinates must be integers between 0 and 1000 (0 is top/left, 1000 is bottom/right).
            """
            
            response = gemini_client.models.generate_content(
                model='gemini-3.1-flash-lite-preview',
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=FoodAnalysis, 
                    temperature=0.2 
                )
            )
            
            data = json.loads(response.text)
            analyzed_items = []
            
            for idx, item in enumerate(data.get("items", [])):
                box = item["box"]
                xmin, ymin = box["xmin"] / 1000.0, box["ymin"] / 1000.0
                xmax, ymax = box["xmax"] / 1000.0, box["ymax"] / 1000.0
                
                analyzed_items.append({
                    "id": str(idx),
                    "box": {"x": xmin, "y": ymin, "w": xmax - xmin, "h": ymax - ymin},
                    "name": item["name"],
                    "verdict": item["verdict"],
                    "detailed_guideline": item["detailed_guideline"],
                    "macro_1_name": item["macro_1_name"],
                    "macro_1_amount": item["macro_1_amount"],
                    "macro_2_name": item["macro_2_name"],
                    "macro_2_amount": item["macro_2_amount"]
                })
                
            print(f"✅ [SUCCESS] Mapped {len(analyzed_items)} items via Gemini!")
            return analyzed_items
            
        except Exception as e:
            print(f"⚠️ [PRIMARY FAILED] Gemini threw an error: {e}")
            print("🔄 [FALLBACK] Instantly rerouting to Groq Llama-4-Vision...")
            # Do NOT return here. Let the code naturally drop down to the Groq fallback block.
    
    # ==========================================================
    # ATTEMPT 2: GROQ LLAMA VISION (FALLBACK)
    # ==========================================================
    if groq_client:
        print("🚀 [FALLBACK] Encoding image and routing to Groq...")
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        image_url = f"data:{mime_type};base64,{base64_image}"
        
        # Groq requires an explicit JSON structure in the prompt
        groq_prompt = f"""
        You are an expert clinical dietary assistant and precise computer vision system. 
        Analyze this image and find ALL food products, beverages, snacks, and packaged goods.
        Fetch the nutritional information directly from the label. If the text is blurry or unclear, mark the item as 'warning' and note in the detailed guideline that the image quality needs improvement for a definitive analysis.
        Use the nutritional information to determine the verdict strictly based on the user's health profile. If uncertain, default to 'warning' and provide a detailed guideline on what specific information is needed to move it to 'safe' or 'unsafe'.
        User Profile: {user_profile}
        Evaluate safety based strictly on the User Profile.
        Coordinates MUST be integers between 0 and 1000 (0 is top/left, 1000 is bottom/right).
        
        You MUST output a raw, valid JSON object with the following exact structure and nothing else:
        {{
            "items": [
                {{
                    "name": "Brand and Product Name",
                    "verdict": "safe, warning, or unsafe",
                    "detailed_guideline": "A 2-3 sentence detailed clinical guideline regarding this food tailored to the user.",
                    "macro_1_name": "Most relevant macro (e.g., Sugar, Protein)",
                    "macro_1_amount": "Amount (e.g., 14g, High)",
                    "macro_2_name": "Second relevant macro (e.g., Net Carbs, Sodium)",
                    "macro_2_amount": "Amount (e.g., 2g, Low)",
                    "box": {{"ymin": 0, "xmin": 0, "ymax": 1000, "xmax": 1000}}
                }}
            ]
        }}
        """
        
        max_retries = 3
        base_delay = 2

        for attempt in range(max_retries):
            try:
                response = groq_client.chat.completions.create(
                    model="meta-llama/llama-4-scout-17b-16e-instruct",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": groq_prompt},
                                {"type": "image_url", "image_url": {"url": image_url}}
                            ]
                        }
                    ],
                    temperature=0.2,
                    response_format={"type": "json_object"} 
                )
                
                raw_json = response.choices[0].message.content
                data = json.loads(raw_json)
                validated_data = FoodAnalysis(**data) 
                
                analyzed_items = []
                for idx, item in enumerate(validated_data.items):
                    box = item.box
                    xmin, ymin = box.xmin / 1000.0, box.ymin / 1000.0
                    xmax, ymax = box.xmax / 1000.0, box.ymax / 1000.0
                    
                    analyzed_items.append({
                        "id": str(idx),
                        "box": {"x": xmin, "y": ymin, "w": xmax - xmin, "h": ymax - ymin},
                        "name": item.name,
                        "verdict": item.verdict,
                        "detailed_guideline": item.detailed_guideline,
                        "macro_1_name": item.macro_1_name,
                        "macro_1_amount": item.macro_1_amount,
                        "macro_2_name": item.macro_2_name,
                        "macro_2_amount": item.macro_2_amount
                    })
                    
                print(f"✅ [SUCCESS] Mapped {len(analyzed_items)} items via Groq Fallback!")
                return analyzed_items
                
            except Exception as e:
                print(f"⚠️ [FALLBACK ATTEMPT {attempt + 1} FAILED]: {e}")
                if attempt < max_retries - 1:
                    time.sleep(base_delay * (2 ** attempt))
                else:
                    print("❌ [CRITICAL] Both Gemini and Groq models failed. Could not analyze food.")
                    return []

    print("❌ [CRITICAL] No vision models available (API keys missing or both failed).")
    return []