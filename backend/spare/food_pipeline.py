import json
import os
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("⚠️ WARNING: GEMINI_API_KEY not found in .env file!")
gemini_client = genai.Client(api_key=api_key)

# 🚀 NEW: Pydantic schemas force Gemini to output raw JSON natively (Zero latency overhead)
class BoundingBox(BaseModel):
    ymin: int = Field(description="Top edge (0-1000)")
    xmin: int = Field(description="Left edge (0-1000)")
    ymax: int = Field(description="Bottom edge (0-1000)")
    xmax: int = Field(description="Right edge (0-1000)")

class FoodItem(BaseModel):
    name: str = Field(description="Brand and Product Name")
    verdict: str = Field(description="'safe', 'warning', or 'unsafe'")
    justification: str = Field(description="Max 10 words explaining verdict.")
    box: BoundingBox

class FoodAnalysis(BaseModel):
    items: list[FoodItem]

def analyze_food_image(image_bytes: bytes, user_profile: str, mime_type: str = "image/jpeg"):
    """
    Ultra-Low Latency Spatial Pipeline. Reads directly from memory.
    """
    print("🚀 Sending in-memory bytes to Gemini 2.5 Flash...")
    
    prompt = f"""
    You are an expert clinical dietary assistant and precise computer vision system. 
    Analyze this image and find ALL food products, beverages, snacks, and packaged goods.
    User Profile: {user_profile}
    Evaluate safety based strictly on the User Profile.
    Coordinates must be integers between 0 and 1000 (0 is top/left, 1000 is bottom/right).
    """
    
    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[
                prompt,
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=FoodAnalysis,
                temperature=0.2 # 🚀 Lower temperature = faster, deterministic output
            )
        )
        
        # We can trust this because of response_schema
        data = json.loads(response.text)
        
        analyzed_items = []
        for idx, item in enumerate(data.get("items", [])):
            box = item["box"]
            xmin = box["xmin"] / 1000.0
            ymin = box["ymin"] / 1000.0
            xmax = box["xmax"] / 1000.0
            ymax = box["ymax"] / 1000.0
            
            analyzed_items.append({
                "id": str(idx),
                "box": {
                    "x": xmin, 
                    "y": ymin, 
                    "w": xmax - xmin, 
                    "h": ymax - ymin
                },
                "name": item["name"],
                "verdict": item["verdict"],
                "justification": item["justification"]
            })
            
        print(f"✅ Successfully mapped {len(analyzed_items)} items!")
        return analyzed_items
        
    except Exception as e:
        print(f"❌ Spatial Vision Error: {e}")
        return []