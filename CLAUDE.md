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
- Test: `python -m unittest discover -s tests -v` (run from the project root; stdlib only, no pytest)
- Paid endpoints (/api/ask, /api/transcribe) are capped (500-char question, 2 MB audio) and rate-limited per client in app/main.py

## Structure
- app/main.py (routes), app/gemini.py, app/voice.py, app/telemetry.py
  (live simulator + z-score anomaly detection), data/telemetry.json (baseline)
- app/tools.py: Gemini function-calling tools (get_telemetry, get_trend, run_diagnostics, raise_alarm, get_mission_news, get_analysis, get_mission_log)
- app/analysis.py: stats over the 30 min in-memory history -> /api/analysis (5 s cache); mission log lives in app/telemetry.py (log_event/events) -> /api/log; static/analysis.js renders both. No database on purpose (Tiger Data dropped).
- static/craft.js: exploded 3D spacecraft on a plain 2D canvas (own rotation/perspective, no 3D library); each part maps to telemetry paths and takes its colour from the card state
- app/news.py: NASA Artemis RSS feed -> /api/news (15 min cache; falls back to data/news_fallback.json when offline)
- Look and wording: plain mission-control tone, nasa.gov-style flat design, no NASA logo/branding; keep the "unofficial, not affiliated" notices
- Demo: `POST /api/sim/fault {"metric": "cabin.co2_ppm"}` injects an anomaly
- static/ (frontend): index.html = markup + app logic; space.css = theme; space.js = visual layer (starfield, hero, scroll-driven flight path, reveals)
- Backdrop: `#backdrop` in index.html (nebula layers per section, Earth, Moon, ship), driven by space.js section 8 with transforms/opacity only. Watermelon/Cult/Skiper UI are React+Tailwind (not installable here, Skiper partly paid): only their patterns are re-implemented in vanilla with Anime.js and Motion. OS reduce-motion shows a still scene; `localStorage motion=full` (nav button) opts back in
- static/vendor/: Anime.js 4.5.0 and Motion 14.10.1 (both MIT), self-hosted so the demo needs no CDN

## Deploy (Vultr, Ubuntu 22.04/24.04, deploy/setup.sh)
- Pack (from project root): `tar czf copilot.tgz --exclude=.env --exclude=.env.local --exclude=__pycache__ app static data requirements.txt deploy`
- Copy: `scp copilot.tgz root@<ip>:/tmp/` then on the server `mkdir -p /opt/copilot && tar xzf /tmp/copilot.tgz -C /opt/copilot`
- Create `/opt/copilot/.env` on the server with GEMINI_API_KEY and ELEVENLABS_API_KEY, then `bash /opt/copilot/deploy/setup.sh [hostname]`
- Needs HTTPS (mic requires a secure origin); default host is `<ip-with-dashes>.sslip.io`, or pass a real domain pointed at the server
- One uvicorn worker on purpose (simulator and rate limiter are in-process); `--proxy-headers` keeps the rate limit per visitor behind Caddy

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
