import asyncio
import base64
import logging
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import telemetry as sim
from app.analysis import MAX_MINUTES, analyze
from app.gemini import ask_gemini
from app.news import get_news
from app.tools import NOMINAL
from app.voice import speak, transcribe

load_dotenv(".env.local")  # API keys; read when a request needs them
load_dotenv(".env")
log = logging.getLogger("copilot")


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
GLOBAL_LIMIT, GLOBAL_WINDOW = 300, 600.0  # and across all clients, a spending ceiling for a public link
ANNOUNCE_TTL = 30.0  # identical Mission Control announcements inside this window share one answer
_hits: dict[str, deque] = defaultdict(deque)
_all_hits: deque = deque()
_announced: dict[str, tuple[float, dict]] = {}
_announce_lock = threading.Lock()


def rate_limit(request: Request) -> None:
    # shortcut: in memory, per process, no lock (a burst can overshoot by a few). Keyed on request.client,
    # which is the real visitor only when uvicorn runs with --proxy-headers behind Caddy (deploy/setup.sh does).
    now = time.monotonic()
    hits = _hits[request.client.host if request.client else "?"]
    while hits and now - hits[0] > RATE_WINDOW:
        hits.popleft()
    while _all_hits and now - _all_hits[0] > GLOBAL_WINDOW:
        _all_hits.popleft()
    if len(hits) >= RATE_LIMIT:
        raise HTTPException(429, "Too many requests. Wait a minute and try again.")
    if len(_all_hits) >= GLOBAL_LIMIT:
        raise HTTPException(429, "The demo is busy right now. Try again in a few minutes.")
    hits.append(now)
    _all_hits.append(now)
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
    return sim.snapshot()


@app.get("/api/history/{metric}")
def history(metric: str) -> list[dict]:
    try:
        return sim.history(metric)
    except KeyError:
        raise HTTPException(404, f"Unknown metric: {metric}")


@app.get("/api/news")
def news() -> dict:
    return get_news()


@app.get("/api/analysis")
def analysis_report(minutes: int = Query(10, ge=1, le=MAX_MINUTES)) -> dict:
    return analyze(minutes)


@app.get("/api/log")
def mission_log(limit: int = Query(30, ge=1, le=100)) -> list[dict]:
    return sim.events(limit)


@app.get("/api/nominal")
def nominal() -> dict:
    return NOMINAL


@app.post("/api/sim/fault", dependencies=[Depends(rate_limit)])
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
        # in a worker thread: the call blocks for seconds and must not stall the simulator and other requests
        return {"text": await asyncio.to_thread(transcribe, bytes(audio)), "error": None}
    except Exception as exc:
        log.warning("transcription failed: %s", exc)  # provider details stay in the server log
        return {"text": "", "error": "Transcription failed. Try again, or type your question."}


def _answer(body: Question) -> dict:
    fail = lambda msg: {"answer": "", "audio": None, "tools": [], "error": msg}
    try:
        answer, tools = ask_gemini(body.question)
    except Exception as exc:
        log.warning("gemini failed: %s", exc)
        return fail("The assistant could not answer right now. Try again.")
    if not answer:  # for example a blocked reply: do not show an empty bubble
        return fail("No answer was produced. Try rephrasing the question.")
    # the question text is not logged: the log is public on this page
    sim.log_event("question", "Assistant answered a question" + (f" using {', '.join(dict.fromkeys(t['name'] for t in tools))}" if tools else ""))
    try:
        audio = base64.b64encode(speak(answer, body.voice)).decode()
    except Exception as exc:
        log.warning("speech failed: %s", exc)
        audio = None  # show text if audio fails
    return {"answer": answer, "audio": audio, "tools": tools, "error": None}


@app.post("/api/ask", dependencies=[Depends(rate_limit)])
def ask(body: Question) -> dict:
    if body.voice != "control":
        return _answer(body)
    # Every open page asks for the same Mission Control announcement when an anomaly appears.
    # Answer it once and share it, instead of one paid Gemini and voice call per page.
    with _announce_lock:
        now = time.monotonic()
        for key in [k for k, (at, _) in _announced.items() if now - at > ANNOUNCE_TTL]:
            del _announced[key]
        if body.question in _announced:
            return _announced[body.question][1]
        result = _answer(body)
        if not result["error"]:
            _announced[body.question] = (now, result)
        return result
