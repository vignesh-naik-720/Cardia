import os
import json
import redis
from celery import Celery
from rppg_core import process_rppg_signal

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("cardia_worker", broker=redis_url, backend=redis_url)

redis_client = redis.Redis.from_url(redis_url)

@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def process_scan_task(self, times, raw_signal):
    try:
       
        result = process_rppg_signal(times, raw_signal)
        
        if "error" in result:
            return {"error": result["error"]}

        return {
            "metrics": result["metrics"], 
            "meta_scores": result["meta_scores"]
        }
        
    except Exception as exc:
   
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            dlq_payload = {
                "task_id": self.request.id,
                "error": str(exc),
                "data_points": len(times)
            }
            redis_client.lpush("celery_dlq", json.dumps(dlq_payload))
            return {"error": "Processing failed after 3 attempts. Routed to DLQ."}