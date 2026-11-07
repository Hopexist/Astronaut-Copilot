import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

from app.telemetry import snapshot

load_dotenv(".env.local")
load_dotenv(".env")

MODEL = "gemini-3.1-flash-lite"  # fast; gemini-3.8-flash was ~9s+ per call

SYSTEM_PROMPT = (
    "You are the onboard copilot of a simulated space mission. Answer the astronaut's "
    "question using only the telemetry provided. Be concise (1-3 sentences), calm, and "
    "spoken-friendly: no markdown, no bullet lists. Flag any warnings that matter. "
    "If the telemetry lists anomalies (statistical outliers), mention only those, first, and say what they may mean. "
    "Never invent anomalies that are not in the list."
)


def load_telemetry() -> dict:
    return snapshot()


def ask_gemini(question: str) -> str:
    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=types.HttpOptions(timeout=30000),
    )
    prompt = f"Telemetry:\n{json.dumps(load_telemetry())}\n\nQuestion: {question}"
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config={"system_instruction": SYSTEM_PROMPT},
    )
    return (response.text or "").strip()
