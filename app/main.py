import base64

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.gemini import ask_gemini, load_telemetry
from app.voice import speak

app = FastAPI(title="Astronaut Copilot")
app.mount("/static", StaticFiles(directory="static"), name="static")


class Question(BaseModel):
    question: str


@app.get("/")
def index() -> FileResponse:
    return FileResponse("static/index.html")


@app.get("/api/telemetry")
def telemetry() -> dict:
    return load_telemetry()


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
