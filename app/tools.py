"""Functions Gemini can call. Docstrings and type hints are the tool schema."""
from app import telemetry as sim

SYSTEMS = ("cabin", "power", "propulsion", "thermal", "navigation")

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


TOOLS = [get_telemetry, get_trend, run_diagnostics, raise_alarm]
