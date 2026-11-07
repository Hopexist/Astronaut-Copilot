# Astronaut Copilot

A mission console for a **simulated** Artemis spacecraft. It shows live telemetry, flags anomalies, and has a voice assistant (Google Gemini for answers, ElevenLabs for speech) that checks the live data before it replies. It also shows real news from NASA's public Artemis feed.

Unofficial student project. Not affiliated with or endorsed by NASA.

## Run it

You need Python 3.11 or newer and two API keys (Google Gemini, ElevenLabs).

```
pip install -r requirements.txt
```

Create a file named `.env` in this folder:

```
GEMINI_API_KEY=your-gemini-key
ELEVENLABS_API_KEY=your-elevenlabs-key
```

Start it from this folder, then open http://127.0.0.1:8000

```
python -m uvicorn app.main:app
```

The microphone only works on `localhost` or HTTPS, so use `127.0.0.1` or `localhost`. Chrome or Edge is the safest browser for it.

## Try it in 60 seconds

1. Click **Run demo scenario** at the top (or **Run scenario** in the Assistant section). It injects a fault, Mission Control announces it in a second voice, then it asks the assistant what to do and runs diagnostics.
2. Or press a suggested question ("What's our status?", "Any anomalies?"), type your own, or press **Mic** (or the M key), speak, and press it again to send.
3. Open **Spacecraft** to rotate the exploded 3D model. Parts turn amber or red with their readings.
4. Open **Telemetry**, select any card for its chart and limits. **Inject fault** makes any reading go wrong.

## What works

- Live telemetry for nine readings, updated every second, with charts and status lights (green, amber, red).
- Anomaly detection (rolling median and MAD z-score). Detected anomalies are announced by voice without being asked.
- Gemini function calling: the assistant calls `get_telemetry`, `get_trend`, `run_diagnostics`, `raise_alarm` and `get_mission_news`, and the page lists which tools each answer used.
- Voice in (record, then transcribe with ElevenLabs) and voice out in two voices (Mission Control and the onboard assistant), with a waveform that moves while it speaks and a text transcript beside it.
- Real Artemis news from NASA's RSS feed, with a saved copy used if the feed is unreachable.
- If Gemini or ElevenLabs fails, the page shows the text (or an error with a Retry button) instead of breaking.
- Paid endpoints are capped (500-character questions, 2 MB recordings) and rate-limited per visitor.

Tests: `python -m unittest discover -s tests -v` (9 tests, no extra packages).

## What does not work, or is not done

- **Telemetry is simulated.** No real spacecraft data.
- **Not deployed.** We planned a Vultr deployment (`deploy/setup.sh`) but Vultr's credit activation failed for our code, so there is no live link. The script is written but has never been run on a real server.
- **No Tiger Data / database.** Telemetry history is kept in memory and resets when the server restarts. There is no persistent mission log.
- Answers that use tools take about 3 to 9 seconds.
- Re-injecting a fault while the previous one is still fading can go unflagged.
- Checked in Chrome-based browsers only (desktop width and a 390 px viewport). Not tried on real phones, Safari or Firefox.
- If the browser blocks the microphone, the page says so in the conversation and you can type instead.

## Layout

- `app/main.py` routes, `app/gemini.py` assistant, `app/tools.py` function-calling tools, `app/telemetry.py` simulator and detector, `app/voice.py` ElevenLabs, `app/news.py` NASA feed.
- `static/` plain HTML, CSS and JavaScript (no build step). Anime.js and Motion are included under `static/vendor/` (MIT).
- `data/` baseline telemetry and the saved news copy.
- `deploy/setup.sh` the prepared Vultr setup.

News stories and images belong to NASA. Anime.js and Motion are MIT licensed.
