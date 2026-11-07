"""Functions Gemini can call. Docstrings and type hints are the tool schema."""
import re
import time

from app import telemetry as sim
from app.analysis import analyze
from app.news import get_news

SYSTEMS = ("cabin", "power", "propulsion", "thermal", "navigation")

NOMINAL = sim.NOMINAL  # metric -> (min, max) nominal range


def get_telemetry(system: str = "all") -> dict:
    """Get the current spacecraft telemetry.

    Args:
        system: One of cabin, power, propulsion, thermal, navigation, or all.
    """
    data = sim.snapshot()
    if system in SYSTEMS:
        return {system: data[system], "anomalies": data["anomalies"]}
    return data


def get_trend(metric: str, seconds: int = 60) -> dict:
    """Get how one metric changed over the last N seconds.

    Args:
        metric: Dotted metric name, e.g. cabin.co2_ppm, cabin.o2_percent,
            cabin.pressure_kpa, cabin.temp_c, power.battery_percent,
            power.solar_output_kw, power.load_kw, propulsion.fuel_percent,
            thermal.radiator_temp_c.
        seconds: Look-back window in seconds (history holds about 120).
    """
    try:
        return sim.trend(metric, max(1, min(seconds, 120)))
    except KeyError:
        return {"error": f"unknown metric {metric}", "valid": list(sim.METRICS)}


def run_diagnostics(system: str = "all") -> dict:
    """Check metrics against nominal ranges and list statistical anomalies.

    Args:
        system: One of cabin, power, propulsion, thermal, or all.
    """
    data = sim.snapshot()
    findings = []
    for path, (lo, hi) in NOMINAL.items():
        if system in SYSTEMS and not path.startswith(system + "."):
            continue
        section, key = path.split(".")
        value = data[section][key]
        if not lo <= value <= hi:
            findings.append(
                {"metric": path, "value": value, "nominal_range": [lo, hi], "status": "out_of_range"}
            )
    power = data["power"]
    margin = round(power["solar_output_kw"] - power["load_kw"], 2)
    if system in ("all", "power") and margin < 0:
        findings.append({"metric": "power.margin_kw", "value": margin, "status": "load exceeds solar"})
    anomalies = [a for a in data["anomalies"] if system in ("all", a["metric"].split(".")[0])]
    return {
        "system": system,
        "result": "ISSUES_FOUND" if findings or anomalies else "ALL_NOMINAL",
        "out_of_range": findings,
        "anomalies": anomalies,
        "known_alerts": data["alerts"],
    }


def raise_alarm(system: str, message: str, level: str = "warning") -> dict:
    """Raise a visible alarm on the crew dashboard. Use only for real problems.

    Args:
        system: Affected subsystem (cabin, power, propulsion, thermal, navigation).
        message: Short description of the problem for the crew.
        level: warning or critical.
    """
    level = "critical" if level == "critical" else "warning"
    return {"raised": sim.add_alert(level, system, message)}


def get_mission_news(topic: str = "") -> dict:
    """Get recent NASA Artemis news headlines. Use for questions about real missions, not ship telemetry.

    Args:
        topic: Optional word to filter by, e.g. "Artemis III", "SLS", "crew". Empty returns the latest.
    """
    data = get_news()
    words = topic.lower().split()
    text = lambda i: i.get("detail") or i["summary"]
    # whole words only, so "Artemis II" does not also match "Artemis III"
    score = lambda i: sum(bool(re.search(rf"\b{re.escape(w)}\b", (i["title"] + " " + text(i)).lower())) for w in words)
    ranked = sorted(data["items"], key=score, reverse=True)  # stable: ties keep newest first
    return {
        "source": "NASA Artemis news feed",
        "possibly_outdated": data.get("stale", False),
        "items": [{"date": i["date"], "title": i["title"], "text": text(i)} for i in ranked[:5]],
    }


def get_analysis(minutes: int = 10, metric: str = "") -> dict:
    """Analyse how the spacecraft behaved over the last N minutes. Returns, per reading, the min, max,
    mean, trend, percent of time within nominal limits, anomaly count and projected minutes to a limit,
    plus an overall health score and plain-language insights. Use for questions about trends, history,
    stability, risk or overall health.

    Args:
        minutes: Look-back window, 1 to 30 (right after start-up there may be less history).
        metric: Optional dotted metric name to focus on, e.g. cabin.co2_ppm. Empty for all readings.
    """
    try:
        return analyze(minutes, metric)
    except KeyError:
        return {"error": f"unknown metric {metric}", "valid": list(sim.METRICS)}


def get_mission_log(limit: int = 10) -> dict:
    """Get the most recent mission log events, newest first: injected faults, detected anomalies,
    alarms raised, and questions answered. Use for "what happened" questions.

    Args:
        limit: How many events to return (1 to 30).
    """
    return {"events": [{"age_seconds": round(time.time() - e["t"]), "kind": e["kind"], "message": e["message"]} for e in sim.events(max(1, min(limit, 30)))]}


TOOLS = [get_telemetry, get_trend, run_diagnostics, raise_alarm, get_mission_news, get_analysis, get_mission_log]
