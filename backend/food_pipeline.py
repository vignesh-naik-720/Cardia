# import json
# import os
# import base64
# import time
# from dotenv import load_dotenv
# from pydantic import BaseModel, Field

# load_dotenv()

# # ==============================================================================
# # 🟢 GEMINI VISION PIPELINE (Toggle by commenting/uncommenting this section)
# # ==============================================================================

# from google import genai
# from google.genai import types

# api_key = os.getenv("GEMINI_API_KEY")
# if not api_key:
#     print("⚠️ WARNING: GEMINI_API_KEY not found in .env file!")
# gemini_client = genai.Client(api_key=api_key)

# # --- PYDANTIC SCHEMAS ---
# class BoundingBox(BaseModel):
#     ymin: int = Field(description="Top edge (0-1000)")
#     xmin: int = Field(description="Left edge (0-1000)")
#     ymax: int = Field(description="Bottom edge (0-1000)")
#     xmax: int = Field(description="Right edge (0-1000)")

# class FoodItem(BaseModel):
#     name: str = Field(description="Brand and Product Name")
#     verdict: str = Field(description="'safe', 'warning', or 'unsafe'")
#     detailed_guideline: str = Field(description="A 2-3 sentence detailed clinical guideline tailored to the user profile.")
#     macro_1_name: str = Field(description="Most relevant macro (e.g., Sugar, Protein)")
#     macro_1_amount: str = Field(description="Amount/Level (e.g., 14g, High)")
#     macro_2_name: str = Field(description="Second relevant macro (e.g., Net Carbs, Sodium)")
#     macro_2_amount: str = Field(description="Amount/Level (e.g., 2g, Low)")
#     box: BoundingBox

# class FoodAnalysis(BaseModel):
#     items: list[FoodItem]

# def analyze_food_image(image_bytes: bytes, user_profile: str, mime_type: str = "image/jpeg"):
#     """
#     Ultra-Low Latency Spatial Pipeline using Gemini. Reads directly from memory.
#     """
#     print("🚀 Sending in-memory bytes to Gemini 2.5 Flash...")
    
#     prompt = f"""
#     You are an expert clinical dietary assistant and precise computer vision system. 
#     Analyze this image and find ALL food products, beverages, snacks, and packaged goods.
    
#     CRITICAL OCR INSTRUCTION: Do NOT guess the product based on packaging color or shape. You MUST physically read the exact printed text on the label (e.g., if the bottle says 'Hajmola', you must output 'Hajmola').
    
#     User Profile: {user_profile}
#     Evaluate safety based strictly on the User Profile.
#     Coordinates must be integers between 0 and 1000 (0 is top/left, 1000 is bottom/right).
#     """
    
#     try:
#         response = gemini_client.models.generate_content(
#             model='gemini-2.5-flash', # Updated to 2.5 flash
#             contents=[
#                 prompt,
#                 types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
#             ],
#             config=types.GenerateContentConfig(
#                 response_mime_type="application/json",
#                 response_schema=FoodAnalysis, # Forces Gemini to output exactly our new fields
#                 temperature=0.2 
#             )
#         )
        
#         data = json.loads(response.text)
        
#         analyzed_items = []
#         for idx, item in enumerate(data.get("items", [])):
#             box = item["box"]
#             xmin = box["xmin"] / 1000.0
#             ymin = box["ymin"] / 1000.0
#             xmax = box["xmax"] / 1000.0
#             ymax = box["ymax"] / 1000.0
            
#             analyzed_items.append({
#                 "id": str(idx),
#                 "box": {"x": xmin, "y": ymin, "w": xmax - xmin, "h": ymax - ymin},
#                 "name": item["name"],
#                 "verdict": item["verdict"],
#                 "detailed_guideline": item["detailed_guideline"],
#                 "macro_1_name": item["macro_1_name"],
#                 "macro_1_amount": item["macro_1_amount"],
#                 "macro_2_name": item["macro_2_name"],
#                 "macro_2_amount": item["macro_2_amount"]
#             })
            
#         print(f"✅ Successfully mapped {len(analyzed_items)} items via Gemini!")
#         return analyzed_items
        
#     except Exception as e:
#         print(f"❌ Spatial Vision Error: {e}")
#         return []
    

#***********************************************************************************#
import json
import os
import base64
import time
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from groq import Groq

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    print("⚠️ WARNING: GROQ_API_KEY not found in .env file!")
groq_client = Groq(api_key=api_key)

# --- PYDANTIC SCHEMAS ---
class BoundingBox(BaseModel):
    ymin: int = Field(description="Top edge (0-1000)")
    xmin: int = Field(description="Left edge (0-1000)")
    ymax: int = Field(description="Bottom edge (0-1000)")
    xmax: int = Field(description="Right edge (0-1000)")

class FoodItem(BaseModel):
    name: str = Field(description="Brand and Product Name")
    verdict: str = Field(description="'safe', 'warning', or 'unsafe'")
    
    # 🚀 NEW: Detailed textual guideline and dynamic macro grid fields
    detailed_guideline: str = Field(description="A 2-3 sentence detailed clinical guideline tailored to the user profile.")
    macro_1_name: str = Field(description="Most relevant macro (e.g., Sugar, Protein)")
    macro_1_amount: str = Field(description="Amount/Level (e.g., 14g, High)")
    macro_2_name: str = Field(description="Second relevant macro (e.g., Net Carbs, Sodium)")
    macro_2_amount: str = Field(description="Amount/Level (e.g., 2g, Low)")
    
    box: BoundingBox

class FoodAnalysis(BaseModel):
    items: list[FoodItem]

def analyze_food_image(image_bytes: bytes, user_profile: str, mime_type: str = "image/jpeg"):
    """
    Ultra-Low Latency Spatial Pipeline using Groq (Llama Vision).
    """
    print("🚀 Encoding image and routing to Groq Vision...")
    
    base64_image = base64.b64encode(image_bytes).decode('utf-8')
    image_url = f"data:{mime_type};base64,{base64_image}"
    
    # 🚀 UPDATED: Forced JSON schema reflects our new dynamic macro grids
    prompt = f"""
    You are an expert clinical dietary assistant and precise computer vision system. 
    Analyze this image and find ALL food products, beverages, snacks, and packaged goods.
    
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
                            {"type": "text", "text": prompt},
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
                xmin = box.xmin / 1000.0
                ymin = box.ymin / 1000.0
                xmax = box.xmax / 1000.0
                ymax = box.ymax / 1000.0
                
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
                
            print(f"✅ Successfully mapped {len(analyzed_items)} items with advanced nutrition via Groq!")
            return analyzed_items
            
        except Exception as e:
            print(f"⚠️ Groq Attempt {attempt + 1} Failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(base_delay * (2 ** attempt))
            else:
                print("❌ Critical Vision Error. Could not analyze food.")
                return []