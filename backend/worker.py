import os
from celery import Celery
import numpy as np
from rppg_core import process_rppg_signal

# Initialize Celery with Redis as the message broker and result backend
celery_app = Celery(
    "cardia_worker",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0"
)

@celery_app.task(name="process_scan_task")
def process_scan_task(times_list, raw_signal_list):
    """
    Runs completely decoupled from the FastAPI web server.
    Takes the extracted optical arrays, converts them back to numpy, and runs the math.
    """
    times = np.array(times_list)
    raw_signal = np.array(raw_signal_list)
    
    # Run the heavy SciPy DSP math
    metrics = process_rppg_signal(times, raw_signal)
    return metrics