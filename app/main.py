import asyncio
import base64
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import telemetry as sim
from app.gemini import ask_gemini, load_telemetry
from app.news import get_news
from app.tools import NOMINAL
from app.voice import speak, transcribe


async def _run_simulation() -> None:
    while True:
        sim.tick()
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_run_simulation())
    yield
    task.cancel()


app = FastAPI(title="Astronaut Copilot", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


MAX_AUDIO_BYTES = 2_000_000  # about a minute of browser-recorded speech
RATE_LIMIT, RATE_WINDOW = 30, 60.0  # paid endpoints: requests per window, per client
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request) -> None:
    # shortcut: in memory, per process, keyed on the direct peer address. Behind a reverse proxy
    # every visitor shares one bucket; switch to the forwarded address when deploying behind one.
    now = time.monotonic()
    hits = _hits[request.client.host if request.client else "?"]
    while hits and now - hits[0] > RATE_WINDOW:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        raise HTTPException(429, "Too many requests. Wait a minute and try again.")
    hits.append(now)
    if len(_hits) > 1000:  # forget clients that have gone quiet
        for key in [k for k, v in _hits.items() if not v or now - v[-1] > RATE_WINDOW]:
            del _hits[key]


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    voice: Literal["copilot", "control"] = "copilot"  # "control" = Mission Control


class Fault(BaseModel):
    metric: str
    direction: int = 1  # 1 = spike up, -1 = drop


@app.get("/")
def index() -> FileResponse:
    return FileResponse("static/index.html")


@app.get("/api/telemetry")
def telemetry() -> dict:
    return load_telemetry()


@app.get("/api/history/{metric}")
def history(metric: str) -> list[dict]:
    try:
        return sim.history(metric)
    except KeyError:
        raise HTTPException(404, f"Unknown metric: {metric}")


@app.get("/api/news")
def news() -> dict:
    return get_news()


@app.get("/api/nominal")
def nominal() -> dict:
    return NOMINAL


@app.post("/api/sim/fault")
def fault(body: Fault) -> dict:
    """Demo helper: inject an anomaly into one metric."""
    try:
        sim.inject_fault(body.metric, 1 if body.direction >= 0 else -1)
    except KeyError:
        raise HTTPException(404, f"Unknown metric: {body.metric}")
    return {"injected": body.metric}


@app.post("/api/transcribe", dependencies=[Depends(rate_limit)])
async def transcribe_audio(request: Request):
    audio = bytearray()
    async for chunk in request.stream():  # stop reading as soon as the limit is passed
        audio += chunk
        if len(audio) > MAX_AUDIO_BYTES:
            return JSONResponse({"text": "", "error": "Recording is too long. Keep it under a minute."}, status_code=413)
    try:
        return {"text": transcribe(bytes(audio)), "error": None}
    except Exception as exc:
        return {"text": "", "error": f"Transcription failed: {exc}"}


@app.post("/api/ask", dependencies=[Depends(rate_limit)])
def ask(body: Question) -> dict:
    try:
        answer, tools = ask_gemini(body.question)
    except Exception as exc:
        return {"answer": "", "audio": None, "tools": [], "error": f"Gemini failed: {exc}"}
    try:
        audio = base64.b64encode(speak(answer, body.voice)).decode()
    except Exception:
        audio = None  # show text if audio fails
    return {"answer": answer, "audio": audio, "tools": tools, "error": None}
