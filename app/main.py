import asyncio
import base64
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import telemetry as sim
from app.gemini import ask_gemini, load_telemetry
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


class Question(BaseModel):
    question: str


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


@app.post("/api/sim/fault")
def fault(body: Fault) -> dict:
    """Demo helper: inject an anomaly into one metric."""
    try:
        sim.inject_fault(body.metric, 1 if body.direction >= 0 else -1)
    except KeyError:
        raise HTTPException(404, f"Unknown metric: {body.metric}")
    return {"injected": body.metric}


@app.post("/api/transcribe")
async def transcribe_audio(request: Request) -> dict:
    try:
        return {"text": transcribe(await request.body()), "error": None}
    except Exception as exc:
        return {"text": "", "error": f"Transcription failed: {exc}"}


@app.post("/api/ask")
def ask(body: Question) -> dict:
    try:
        answer = ask_gemini(body.question)
    except Exception as exc:
        return {"answer": "", "audio": None, "error": f"Gemini failed: {exc}"}
    try:
        audio = base64.b64encode(speak(answer)).decode()
    except Exception:
        audio = None  # show text if audio fails
    return {"answer": answer, "audio": audio, "error": None}
