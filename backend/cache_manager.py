# cache_manager.py
import asyncio
from datetime import datetime
from database import SessionLocal
import models

MAX_CACHE_ROWS = 5000  # Approx 15MB of text

def _get_cached_search_sync(query: str):
    """Synchronous core logic for fetching cache."""
    with SessionLocal() as db:
        cached_item = db.query(models.SearchCache).filter(models.SearchCache.query == query.lower()).first()
        if cached_item:
            cached_item.last_accessed = datetime.utcnow()
            db.commit()
            return cached_item.result_text
    return None

def _save_to_cache_sync(query: str, result_text: str, source: str):
    """Synchronous core logic for saving to cache."""
    with SessionLocal() as db:
        count = db.query(models.SearchCache).count()
        
        if count >= MAX_CACHE_ROWS:
            oldest = db.query(models.SearchCache).order_by(models.SearchCache.last_accessed.asc()).first()
            if oldest:
                db.delete(oldest)
                db.commit()
                
        new_cache = models.SearchCache(
            query=query.lower(),
            result_text=result_text,
            source=source,
            last_accessed=datetime.utcnow()
        )
        db.add(new_cache)
        db.commit()

# --- ASYNC WRAPPERS FOR AGENT.PY ---

async def get_cached_search(query: str):
    """Safely runs the sync DB fetch in a background thread."""
    return await asyncio.to_thread(_get_cached_search_sync, query)

async def save_to_cache(query: str, result_text: str, source: str):
    """Safely runs the sync DB save in a background thread."""
    await asyncio.to_thread(_save_to_cache_sync, query, result_text, source)