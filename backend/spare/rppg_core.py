import numpy as np
from scipy.signal import butter, filtfilt, find_peaks, savgol_filter
from scipy.interpolate import CubicSpline

def process_rppg_signal(times, raw_signal):
    """
    Advanced cPPG processing pipeline.
    Extracts time-domain HRV metrics and derives 0-100 heuristic scores 
    for Stress, Energy, Health, and Focus using established clinical bounds.
    """
    if len(times) < 50:
        return {"error": "Signal too short"}

    # 1. Advanced Interpolation (Standardize to 30 FPS)
    fps = 30
    new_times = np.arange(times[0], times[-1], 1.0 / fps)
    cs = CubicSpline(times, raw_signal)
    interpolated_signal = cs(new_times)

    # 2. Detrending (Remove baseline wander from finger pressure)
    window_length = int(fps * 1.5)
    if window_length % 2 == 0: window_length += 1
    trend = savgol_filter(interpolated_signal, window_length, 2)
    detrended_signal = interpolated_signal - trend

    # 3. Bandpass Filtering (Strict Human Range: 45 to 180 BPM)
    nyquist = 0.5 * fps
    b, a = butter(4, [0.75 / nyquist, 3.0 / nyquist], btype='band')
    filtered_signal = filtfilt(b, a, detrended_signal)

    # 4. Physics Inversion (Optical dips become mathematical peaks)
    filtered_signal = -filtered_signal

    # 5. STRICT Smart Peak Detection
    # Increased prominence to ignore tiny noise spikes
    dynamic_prominence = np.std(filtered_signal) * 0.75 
    
    # Increased distance to prevent "double counting" a single heartbeat.
    # fps / 2.2 enforces a hard physical limit: it will ignore beats faster than 135 BPM.
    peaks, _ = find_peaks(filtered_signal, distance=int(fps / 2.2), prominence=dynamic_prominence)
    
    if len(peaks) < 3:
        return {"error": "Could not detect clear pulse. Please hold still."}

    # 6. Artifact Rejection (Ectopic Beat Removal)
    peak_times = new_times[peaks]
    rr_intervals_sec = np.diff(peak_times)
    median_rr = np.median(rr_intervals_sec)
    valid_rr_sec = rr_intervals_sec[np.abs(rr_intervals_sec - median_rr) < (0.25 * median_rr)]
    
    if len(valid_rr_sec) < 2:
        return {"error": "Too much motion artifact. Scan ruined by movement."}

    # Convert to milliseconds for standard HRV math
    valid_rr_ms = valid_rr_sec * 1000

    # ==========================================
    # 7. CALCULATE CORE HRV METRICS
    # ==========================================
    mean_rr = np.mean(valid_rr_ms)
    hr = 60000.0 / mean_rr
    
    sdnn = np.std(valid_rr_ms)
    
    successive_diffs = np.diff(valid_rr_ms)
    rmssd = np.sqrt(np.mean(successive_diffs ** 2)) if len(successive_diffs) > 0 else 0
    pnn50 = (np.sum(np.abs(successive_diffs) > 50) / len(successive_diffs)) * 100 if len(successive_diffs) > 0 else 0
    
    cv = (sdnn / mean_rr) * 100

    # Baevsky Histogram Metrics (50ms bins)
    mxdmn_ms = np.max(valid_rr_ms) - np.min(valid_rr_ms)
    bins = np.arange(min(valid_rr_ms), max(valid_rr_ms) + 50, 50)
    
    if len(bins) > 1:
        hist, bin_edges = np.histogram(valid_rr_ms, bins=bins)
        max_bin_idx = np.argmax(hist)
        moda_ms = (bin_edges[max_bin_idx] + bin_edges[max_bin_idx + 1]) / 2
        amo50 = (hist[max_bin_idx] / len(valid_rr_ms)) * 100
    else:
        moda_ms = mean_rr
        amo50 = 100

    # Raw Baevsky Stress Index (SI)
    moda_sec = moda_ms / 1000.0
    mxdmn_sec = mxdmn_ms / 1000.0
    raw_stress_index = (amo50 / (2 * moda_sec * mxdmn_sec)) if (moda_sec > 0 and mxdmn_sec > 0) else 0

    # ==========================================
    # 8. HEURISTIC META-METRICS (0-100 Scales)
    # ==========================================
    
    # STRESS (0-100): Based on Baevsky SI. 
    # Normal SI is 50-150. > 500 is extreme sympathetic stress.
    calc_stress = (raw_stress_index / 500.0) * 100
    stress_score = max(0, min(100, calc_stress))
    
    # ENERGY / READINESS (0-100): Natural log of RMSSD (Gold standard for vagal tone).
    # ln(150) ~ 5.0. 
    if rmssd > 0:
        ln_rmssd = np.log(rmssd)
        calc_energy = (ln_rmssd / 5.2) * 100
    else:
        calc_energy = 0
        
    # Penalize if resting HR is unusually high (>90 BPM)
    if hr > 90:
        calc_energy -= (hr - 90) * 0.5
    energy_score = max(0, min(100, calc_energy))
    
    # HEALTH (0-100): SDNN normalizes around 120ms for absolute peak athletic health.
    calc_health = (sdnn / 120.0) * 100
    health_score = max(0, min(100, calc_health))
    
    # FOCUS (0-100): Yerkes-Dodson Law (Inverted-U)
    # Peak cognitive focus occurs at optimal autonomic tone (Baevsky SI ~ 100).
    # Drops if too lethargic (SI < 50) or too stressed (SI > 150).
    calc_focus = 100 - (abs(raw_stress_index - 100) / 3.0)
    focus_score = max(0, min(100, calc_focus))

    # ==========================================
    # 9. RETURN FINAL PAYLOAD
    # ==========================================
    return {
        "status": "success",
        "metrics": {
            "hr_bpm": round(hr, 1),
            "mean_rr_ms": round(mean_rr, 1),
            "sdnn_ms": round(sdnn, 1),
            "rmssd_ms": round(rmssd, 1),
            "pnn50_percent": round(pnn50, 1),
            "mxdmn_ms": round(mxdmn_ms, 1),
            "moda_ms": round(moda_ms, 1),
            "amo50_percent": round(amo50, 1),
            "cv_percent": round(cv, 1),
            "raw_stress_index": round(raw_stress_index, 1)
        },
        "meta_scores": {
            "stress": round(stress_score),
            "energy": round(energy_score),
            "health": round(health_score),
            "focus": round(focus_score)
        }
    }