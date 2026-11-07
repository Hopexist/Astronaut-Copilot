# Project: Astronaut Copilot
Voice assistant for a simulated space mission. Reads telemetry, answers
questions with Gemini, speaks answers with ElevenLabs.

## Goal and deadlines
- Demo path: type/speak question -> Gemini answer -> ElevenLabs audio
- Devpost draft due Sat 11 PM; final due Sun 12:30 PM
- Priority: working end-to-end demo > features. Cut scope before polish.

## Stack
- Python 3.11 + FastAPI backend, plain HTML/JS frontend (no heavy framework)
- google-genai SDK for Gemini, elevenlabs SDK for TTS
- Keys in .env (GEMINI_API_KEY, ELEVENLABS_API_KEY); never commit .env

## Commands
- Run: `uvicorn app.main:app --reload`
- Install: `pip install -r requirements.txt`

## Structure
- app/main.py (routes), app/gemini.py, app/voice.py, app/telemetry.py
  (live simulator + z-score anomaly detection), data/telemetry.json (baseline)
- app/tools.py: Gemini function-calling tools (get_telemetry, get_trend, run_diagnostics, raise_alarm)
- Demo: `POST /api/sim/fault {"metric": "cabin.co2_ppm"}` injects an anomaly
- static/ (frontend; static/vendor/anime.umd.min.js is vendored Anime.js 4.5.0, MIT, self-hosted so the demo needs no CDN)

## Conventions
- Small functions, type hints, minimal comments
- Handle API failures gracefully (show text if audio fails)
- Use fake telemetry from data/telemetry.json unless told otherwise

## Rules for Claude
- Plan briefly before multi-file changes; ask if the spec is unclear
- Don't add dependencies or new files without saying why
- Never print or hardcode API keys
- Keep answers short; don't re-explain code you just wrote
- Commit after each working milestone

## Compact instructions
When compacting, preserve: current goal, changed files, env var names,
open bugs, next step.
