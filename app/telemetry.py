import copy
import json
import random
import statistics
import time
from collections import deque
from pathlib import Path

TELEMETRY_PATH = Path(__file__).resolve().parent.parent / "data" / "telemetry.json"

HISTORY_LEN = 120  # samples kept per metric (~2 min at 1 Hz)
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
_started = time.time()


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


def anomalies() -> list[dict]:
    return sorted(
        ({k: v for k, v in a.items() if k != "detected_at"} for a in _active.values()),
        key=lambda a: -abs(a["z_score"]),
    )


def snapshot() -> dict:
    """Current telemetry plus any active anomalies."""
    data = copy.deepcopy(_state)
    data["anomalies"] = anomalies()
    return data


def history(path: str) -> list[dict]:
    if path not in METRICS:
        raise KeyError(path)
    return [{"t": t, "v": v} for t, v in _history[path]]
