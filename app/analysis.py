"""Statistics over the in-memory telemetry history (up to about 30 minutes)."""
import statistics
import time
from collections import Counter

from app import telemetry as sim

MAX_MINUTES = 30  # history length
CACHE_SECONDS = 5
MIN_SPAN_SECONDS = 5  # too little data to say anything about a trend
MAX_PROJECTION_MIN = 24 * 60  # ignore "reaches its limit in N minutes" beyond a day
_cache: dict[int, tuple[float, dict]] = {}

LABELS = {
    "cabin.pressure_kpa": ("Cabin pressure", "kPa"),
    "cabin.o2_percent": ("Cabin O2", "%"),
    "cabin.co2_ppm": ("Cabin CO2", "ppm"),
    "cabin.temp_c": ("Cabin temperature", "°C"),
    "power.battery_percent": ("Battery", "%"),
    "power.solar_output_kw": ("Solar output", "kW"),
    "power.load_kw": ("Power load", "kW"),
    "propulsion.fuel_percent": ("Fuel", "%"),
    "thermal.radiator_temp_c": ("Radiator temperature", "°C"),
}


def _excursions(out: list[bool]) -> int:
    """Number of separate times the reading left its nominal range."""
    return sum(1 for before, now in zip([False] + out, out) if now and not before)


def _projection(now: float, lo: float, hi: float, per_min: float) -> float | None:
    """Minutes until the nearest limit if the current drift continued; None if not heading to one."""
    if per_min == 0 or not lo <= now <= hi:
        return None
    minutes = (hi - now) / per_min if per_min > 0 else (now - lo) / -per_min
    return round(minutes, 1) if 0 <= minutes <= MAX_PROJECTION_MIN else None


def _row(path: str, pts: list[tuple[float, float]], now: float, active: bool, flagged: int) -> dict:
    lo, hi = sim.NOMINAL[path]
    label, unit = LABELS[path]
    row = {
        "metric": path, "label": label, "unit": unit, "now": round(now, 3), "nominal": [lo, hi],
        "anomalies": flagged,
        "status": "anomaly" if active else "out_of_range" if not lo <= now <= hi else "nominal",
    }
    if len(pts) < 2 or pts[-1][0] - pts[0][0] < MIN_SPAN_SECONDS:
        return {**row, "samples": len(pts), "trend": "unknown"}
    t0 = pts[0][0]
    ts, vs = [t - t0 for t, _ in pts], [v for _, v in pts]
    span, sd = ts[-1], statistics.stdev(vs)
    per_s = statistics.linear_regression(ts, vs).slope if span > 0 else 0.0
    drift = per_s * span
    # shortcut: "steady" means the fitted drift is within 2 sd of the noise; tune if real data is smoother
    trend = "steady" if abs(drift) <= 2 * sd else "rising" if drift > 0 else "falling"
    out = [not lo <= v <= hi for v in vs]
    return {
        **row,
        "samples": len(vs), "span_seconds": round(span),
        "min": round(min(vs), 3), "max": round(max(vs), 3), "mean": round(statistics.fmean(vs), 3), "std": round(sd, 3),
        "change_per_min": round(per_s * 60, 3), "trend": trend,
        "pct_nominal": round(100 * (1 - sum(out) / len(out)), 1),
        "excursions": _excursions(out),
        "minutes_to_limit": _projection(now, lo, hi, per_s * 60) if trend != "steady" else None,
    }


def _insights(rows: list[dict]) -> list[str]:
    found = []
    for r in rows:
        name = r["label"]
        if r["status"] == "anomaly":
            found.append((0, f"{name} is flagged as an anomaly right now."))
        elif r["status"] == "out_of_range":
            found.append((1, f"{name} is outside its nominal range now ({r['now']} {r['unit']})."))
        if r["anomalies"]:
            found.append((2, f"{name} was flagged {r['anomalies']} time(s) in this window."))
        if r.get("excursions"):
            found.append((3, f"{name} left its nominal range {r['excursions']} time(s); {r['pct_nominal']}% of the window was within limits."))
        if r["trend"] in ("rising", "falling"):
            reach = f", reaching a limit in about {r['minutes_to_limit']} min if that continues" if r.get("minutes_to_limit") else ""
            found.append((4, f"{name} is {r['trend']} by {abs(r['change_per_min'])} {r['unit']} per minute{reach}."))
    by = {r["metric"]: r for r in rows}
    solar, load = by["power.solar_output_kw"], by["power.load_kw"]
    if "mean" in solar and "mean" in load:
        margin = round(solar["mean"] - load["mean"], 2)
        found.append((5, f"Average power margin is {margin} kW ({'surplus' if margin >= 0 else 'deficit'})."))
    found.sort(key=lambda f: f[0])
    return [text for _, text in found[:8]] or ["No drift, excursions or anomalies in this window."]


def _summary(rows: list[dict]) -> dict:
    measured = [r for r in rows if "pct_nominal" in r]
    active = sum(r["status"] == "anomaly" for r in rows)
    pct = statistics.fmean(r["pct_nominal"] for r in measured) if measured else None
    return {
        "health": None if pct is None else max(0, round(pct - 10 * active)),  # time within limits, minus 10 per active anomaly
        "pct_nominal": None if pct is None else round(pct, 1),
        "anomalies_active": active,
        "anomalies_in_window": sum(r["anomalies"] for r in rows),
        "samples": sum(r["samples"] for r in rows),
        "covered_seconds": max((r.get("span_seconds", 0) for r in rows), default=0),
        "worst": min(measured, key=lambda r: r["pct_nominal"])["metric"] if measured and any(r["pct_nominal"] < 100 for r in measured) else None,
        "insights": _insights(rows),
    }


def _full(minutes: int) -> dict:
    hit = _cache.get(minutes)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    cutoff = time.time() - minutes * 60
    now_values = sim.values()
    active = {a["metric"] for a in sim.anomalies()}
    flagged = Counter(e["data"].get("metric") for e in sim.events(sim.EVENT_LEN) if e["kind"] == "anomaly" and e["t"] >= cutoff)
    rows = [_row(p, sim.samples(p, minutes * 60), now_values[p], p in active, flagged[p]) for p in sim.METRICS]
    result = {"window_minutes": minutes, "metrics": rows, "summary": _summary(rows)}
    _cache[minutes] = (time.time(), result)
    return result


def analyze(minutes: int = 10, metric: str = "") -> dict:
    """Per-reading statistics over the last `minutes` plus an overall summary. Raises KeyError for an unknown metric."""
    if metric and metric not in sim.METRICS:
        raise KeyError(metric)
    full = _full(max(1, min(int(minutes), MAX_MINUTES)))
    if not metric:
        return full
    return {**full, "metrics": [r for r in full["metrics"] if r["metric"] == metric]}
