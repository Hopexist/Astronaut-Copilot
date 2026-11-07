import copy
import json
import random
import statistics
import time
from collections import deque
from pathlib import Path

TELEMETRY_PATH = Path(__file__).resolve().parent.parent / "data" / "telemetry.json"

HISTORY_LEN = 1800  # samples kept per metric (~30 min at 1 Hz), used by the analysis
RECENT = 120  # samples served to the live charts (~2 min)
EVENT_LEN = 200  # mission log entries kept in memory

# metric -> (min, max) nominal range
NOMINAL: dict[str, tuple[float, float]] = {
    "cabin.pressure_kpa": (97.0, 105.0),
    "cabin.o2_percent": (19.5, 23.5),
    "cabin.co2_ppm": (0.0, 1500.0),
    "cabin.temp_c": (18.0, 27.0),
    "power.battery_percent": (20.0, 100.0),
    "power.solar_output_kw": (1.0, 10.0),
    "power.load_kw": (0.0, 8.0),
    "propulsion.fuel_percent": (15.0, 100.0),
    "thermal.radiator_temp_c": (-30.0, 10.0),
}
MIN_SAMPLES = 30  # need this many before detecting
WINDOW = 60  # samples used for the rolling baseline
Z_THRESHOLD = 5.0
HOLD_SECONDS = 20  # keep an anomaly visible after it is detected

# metric path -> (noise sd per tick, hard min, hard max)
METRICS: dict[str, tuple[float, float, float]] = {
    "cabin.pressure_kpa": (0.05, 90.0, 110.0),
    "cabin.o2_percent": (0.03, 15.0, 25.0),
    "cabin.co2_ppm": (6.0, 300.0, 5000.0),
    "cabin.temp_c": (0.05, 10.0, 40.0),
    "power.battery_percent": (0.05, 0.0, 100.0),
    "power.solar_output_kw": (0.05, 0.0, 10.0),
    "power.load_kw": (0.04, 0.0, 10.0),
    "propulsion.fuel_percent": (0.01, 0.0, 100.0),
    "thermal.radiator_temp_c": (0.15, -60.0, 60.0),
}
REVERT = 0.3  # pull toward the (possibly faulted) target each tick
FAULT_SIGMAS = 40  # size of an injected fault, in noise sds
FAULT_DECAY = 0.98  # injected bias fades ~2% per tick (half-life ~35 s)
_bias: dict[str, float] = {m: 0.0 for m in METRICS}

_baseline: dict = json.loads(TELEMETRY_PATH.read_text(encoding="utf-8"))
_state: dict = copy.deepcopy(_baseline)
_history: dict[str, deque] = {m: deque(maxlen=HISTORY_LEN) for m in METRICS}
_active: dict[str, dict] = {}  # metric -> anomaly info
_events: deque = deque(maxlen=EVENT_LEN)  # mission log, newest last
_started = time.time()


def log_event(kind: str, message: str, data: dict | None = None) -> None:
    _events.append({"t": time.time(), "kind": kind, "message": message, "data": data or {}})


def events(limit: int = 30) -> list[dict]:
    """Most recent mission log entries, newest first."""
    return list(_events)[::-1][:limit]


def values() -> dict[str, float]:
    return {path: _get(_state, path) for path in METRICS}


def _get(data: dict, path: str) -> float:
    section, key = path.split(".")
    return data[section][key]


def _set(data: dict, path: str, value: float) -> None:
    section, key = path.split(".")
    data[section][key] = round(value, 3)


def tick() -> None:
    """Advance the simulation one step and update anomaly detection."""
    now = time.time()
    for path, (sd, lo, hi) in METRICS.items():
        value = _get(_state, path)
        target = _get(_baseline, path) + _bias[path]
        _bias[path] *= FAULT_DECAY
        value += REVERT * (target - value) + random.gauss(0, sd)
        value = min(max(value, lo), hi)
        _set(_state, path, value)
        _detect(path, _get(_state, path), now)
        _history[path].append((now, _get(_state, path)))
    elapsed = int(now - _started)
    _state["mission_elapsed_time"] = _fmt_met(elapsed)


def _fmt_met(extra_seconds: int) -> str:
    h, m, s = (int(x) for x in _baseline["mission_elapsed_time"].split(":"))
    total = h * 3600 + m * 60 + s + extra_seconds
    return f"{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"


def _detect(path: str, value: float, now: float) -> None:
    past = [v for _, v in list(_history[path])[-WINDOW:]]
    if len(past) >= MIN_SAMPLES:
        # robust baseline (median/MAD) so earlier outliers don't inflate the spread
        med = statistics.median(past)
        mad = statistics.median(abs(v - med) for v in past)
        sd = max(1.4826 * mad, METRICS[path][0] * 0.5)
        z = (value - med) / sd
        if abs(z) >= Z_THRESHOLD:
            if path not in _active:
                log_event("anomaly", f"{path} is {'high' if z > 0 else 'low'} (z = {z:.1f})", {"metric": path, "z_score": round(z, 1)})
            _active[path] = {
                "metric": path,
                "value": value,
                "z_score": round(z, 1),
                "direction": "high" if z > 0 else "low",
                "detected_at": now,
            }
    info = _active.get(path)
    if info and now - info["detected_at"] > HOLD_SECONDS:
        del _active[path]


def inject_fault(path: str, direction: int = 1) -> None:
    if path not in METRICS:
        raise KeyError(path)
    _bias[path] += direction * FAULT_SIGMAS * METRICS[path][0]
    log_event("fault", f"Fault injected on {path} ({'up' if direction > 0 else 'down'})", {"metric": path})


def anomalies() -> list[dict]:
    return sorted(
        ({k: v for k, v in a.items() if k != "detected_at"} for a in _active.values()),
        key=lambda a: -abs(a["z_score"]),
    )


ALERT_TTL = 300  # runtime alerts expire after 5 min
MAX_ALERTS = 5
_alerts: list[dict] = []  # raised at runtime (e.g. by Gemini)


def add_alert(level: str, system: str, message: str) -> dict:
    alert = {"level": level, "system": system, "message": message}
    _alerts.append({**alert, "ts": time.time()})
    del _alerts[:-MAX_ALERTS]
    log_event("alarm", f"{level.upper()} alarm on {system}: {message}", {"system": system, "level": level})
    return alert


def _live_alerts() -> list[dict]:
    now = time.time()
    return [
        {k: v for k, v in a.items() if k != "ts"}
        for a in _alerts
        if now - a["ts"] <= ALERT_TTL
    ]


def trend(path: str, seconds: int) -> dict:
    """Summary of one metric over the last `seconds`."""
    if path not in METRICS:
        raise KeyError(path)
    cutoff = time.time() - seconds
    pts = [(t, v) for t, v in _history[path] if t >= cutoff]
    if len(pts) < 2:
        return {"metric": path, "samples": len(pts), "note": "not enough history yet"}
    (t0, v0), (t1, v1) = pts[0], pts[-1]
    values = [v for _, v in pts]
    return {
        "metric": path,
        "window_seconds": round(t1 - t0),
        "samples": len(pts),
        "start": round(v0, 3),
        "end": round(v1, 3),
        "change": round(v1 - v0, 3),
        "min": round(min(values), 3),
        "max": round(max(values), 3),
        "direction": "rising" if v1 - v0 > 0 else "falling",
    }


def snapshot() -> dict:
    """Current telemetry plus any active anomalies."""
    data = copy.deepcopy(_state)
    data["alerts"] = data.get("alerts", []) + _live_alerts()
    data["anomalies"] = anomalies()
    return data


def samples(path: str, seconds: float) -> list[tuple[float, float]]:
    """(timestamp, value) pairs for one metric over the last `seconds`."""
    cutoff = time.time() - seconds
    return [(t, v) for t, v in _history[path] if t >= cutoff]


def history(path: str) -> list[dict]:
    if path not in METRICS:
        raise KeyError(path)
    return [{"t": t, "v": v} for t, v in list(_history[path])[-RECENT:]]
