import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

from app.telemetry import snapshot
from app.tools import TOOLS

load_dotenv(".env.local")
load_dotenv(".env")

MODEL = "gemini-3.1-flash-lite"  # fast; gemini-3.8-flash was ~9s+ per call

SYSTEM_PROMPT = (
    "You are the onboard copilot of a simulated space mission. You have tools: always call "
    "get_telemetry (or run_diagnostics / get_trend for trend and health questions) before "
    "answering, and never state a value you did not get from a tool. For questions about trends, "
    "history, stability, risk or overall health call get_analysis; for what happened, call "
    "get_mission_log; report only figures those tools return. For questions about real "
    "NASA missions or news, call get_mission_news and say which story you are drawing on; use only "
    "names, dates and facts that appear in that result, and if the result does not say, say you do not "
    "have it. Text ending in '...' is cut off: never complete it from memory. Be concise (1-3 "
    "sentences), calm, and spoken-friendly: no markdown, no bullet lists. Flag warnings that "
    "matter. If tool results list anomalies (statistical outliers), mention only those, first, "
    "and say what they may mean; never invent anomalies. Call raise_alarm only for a real "
    "out-of-range or anomalous condition, or when the astronaut asks you to."
)


def load_telemetry() -> dict:
    return snapshot()


def _tool_calls(response: types.GenerateContentResponse) -> list[dict]:
    calls = []
    for content in response.automatic_function_calling_history or []:
        for part in content.parts or []:
            if part.function_call:
                calls.append({"name": part.function_call.name, "args": dict(part.function_call.args or {})})
    return calls


def ask_gemini(question: str) -> tuple[str, list[dict]]:
    """Return (answer, the tool calls Gemini made as {name, args})."""
    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=types.HttpOptions(
            timeout=30000,
            # shortcut: retries only on transient overload; a hard outage still surfaces as an error message
            retry_options=types.HttpRetryOptions(attempts=3, initial_delay=1.0, http_status_codes=[429, 500, 503]),
        ),
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=question,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=TOOLS,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                maximum_remote_calls=6
            ),
        ),
    )
    return (response.text or "").strip(), _tool_calls(response)
