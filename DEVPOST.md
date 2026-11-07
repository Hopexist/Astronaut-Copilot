# Astronaut Copilot

*Tagline: Live spacecraft telemetry with a voice assistant for the crew, and the latest Artemis news beside it.*

## Inspiration
On a long mission nobody can watch nine gauges at once, and a crew member with full hands can't type a query. We wanted an assistant you can simply ask, "How is the cabin air?", that checks the real readings before it answers, tells you when something drifts, and can also say what is happening on the actual Artemis program.

## What it does
Astronaut Copilot is a mission console for a simulated Artemis spacecraft (Artemis Sim-7).

- **Live telemetry:** nine readings (cabin O2, CO2, pressure and temperature; battery, solar output and load; fuel; radiator temperature) update every second with charts and nominal limits.
- **Problem detection:** each reading is watched for sudden jumps away from its recent pattern. A flagged reading turns red, and Mission Control announces it in a separate voice.
- **Ask by typing or voice:** the question is transcribed, answered, and spoken back. The assistant calls tools (`get_telemetry`, `get_trend`, `run_diagnostics`, `raise_alarm`, `get_mission_news`) so its answers come from live data, and the page shows which tools each answer used.
- **Mission news:** a news section built from NASA's public Artemis feed. The assistant can answer questions about it ("Who is on the Artemis III crew?") using only the story text it was given.
- **Spacecraft view:** an exploded 3D model of the craft (crew module, service module, solar arrays, tanks, engine, radiators, antenna). Drag to rotate, scrub to explode it, hover or select a part to see its readings. A part turns amber or red when one of its readings does.
- **How it works:** a scroll-driven section where a spacecraft travels from Earth toward the Moon through four steps (normal operations, a problem is detected, the assistant answers, alert and recovery), tied to the live data.
- **Demo scenario:** one button runs a repeatable sequence: inject a fault, hear the announcement, ask what to do, run diagnostics and raise an alert.

## How we built it
- **Backend:** Python and FastAPI. A 1 Hz simulator drives the telemetry; a fault can be injected on demand for demos.
- **Detection:** a rolling median and MAD (median absolute deviation) z-score, flagging |z| of 5 or more. A plain mean and standard deviation let one fault hide the next, so we use the robust version.
- **Assistant:** Google Gemini with function calling and an automatic retry on temporary overload.
- **Voice:** ElevenLabs for speech (two voices: Mission Control and the onboard assistant) and for transcription.
- **News:** NASA's public Artemis RSS feed, cached for 15 minutes, with a saved copy used if the feed is unreachable. Only nasa.gov links and image hosts are allowed through to the page.
- **Frontend:** plain HTML, CSS and JavaScript. The 3D spacecraft is drawn by a small renderer we wrote on a 2D canvas (no 3D library). Animations use Anime.js and Motion, both self-hosted so the demo does not depend on a CDN.
- **Safety limits:** the paid endpoints cap recording size and question length and are rate-limited per client.
- **Tests:** 9 automated tests (`python -m unittest discover -s tests`) cover the news filtering, offline behavior, the limits and the detector.

## Challenges we ran into
- **Browser speech recognition failed** in Brave and in embedded browsers, because it depends on a Google service. We replaced it with recording in the browser and transcribing on the server.
- **Tuning the detector.** An early simulation drifted so slowly that a short window held only a few independent readings, giving both false alarms and missed faults. Faster reversion plus the robust baseline fixed it: in testing, all 18 injected faults (9 readings, up and down) were caught within one tick, with about one false alarm per 21 simulated minutes.
- **Keeping the assistant honest.** Early versions invented anomalies. Later, a news answer listed a crew member the model had not been shown, because our summary was cut off mid-sentence and the model finished the list from memory. We now give it longer source text and tell it never to complete cut-off text.
- **Offline resilience.** A dead news feed first made every request wait for a timeout. We now remember the failure and fall back to a saved copy.
- **Not looking like a template.** We stripped glow effects and letter animations for a flat, plain-language design in the spirit of a space agency website.

## Accomplishments we're proud of
- A complete voice loop that works end to end: speak, transcribe, check live data, answer, speak back.
- Detection we measured instead of eyeballed, with tests that fail if the safeguards are removed.
- A 3D component view and a news section that stay tied to live data and a live source.

## What we learned
Grounding matters more than model size: most of our bugs were the assistant filling a gap with something plausible. Giving it complete source text and tests for the edge cases fixed more than prompt wording did.

## How we would have used Vultr
We planned to host the whole app on a Vultr Cloud Compute instance so judges could open a live link instead of watching a local demo. Vultr's credit activation failed for our promo code (a known issue at events this weekend), so we never created the server and **the app is not deployed**. The deployment is written and committed (`deploy/setup.sh`, with the steps in `CLAUDE.md`), but we have not run it on a real server, so treat it as a plan we prepared, not something we verified.

What it would have done on one small Ubuntu 24.04 instance (1 vCPU, 1 GB):
- Run the FastAPI app as a system service under its own unprivileged user, restarted automatically if it crashes.
- Put Caddy in front of it for free automatic HTTPS. This matters because browsers only allow the microphone on secure pages, so a plain `http://` link would have broken the voice demo.
- Open only ports 22, 80 and 443 in the firewall.
- Keep the Gemini and ElevenLabs keys in a root-readable file on the server only, never in the repository.
- Run a single worker on purpose, because the telemetry simulator and the rate limiter live in the process. A proxy setting keeps the rate limit per visitor, so one judge cannot use up the quota for everyone.

With working credits, the next steps on Vultr would have been a managed database for telemetry history and a spend cap on both API keys before sharing the link publicly.

## What's next
Real telemetry sources, a time-series database for longer history, vibration analysis for mechanical faults, and running the prepared Vultr deployment as a public link.

## Known limitations
- Telemetry is simulated.
- There is no live link: the Vultr deployment could not be created (see above), so the app runs locally and the demo video shows it.
- Answers that use tools take about 3 to 9 seconds.
- Re-injecting a fault while the previous one is still fading can go unflagged, because the baseline has already shifted.
- The rate limit is per process and keyed on the direct client address, so behind a reverse proxy all visitors would share one bucket.
- We have not verified the page on phones or in browsers other than Chrome-based ones.

## Built with
Python, FastAPI, Google Gemini (function calling), ElevenLabs (text to speech and speech to text), NASA public Artemis RSS feed, Anime.js, Motion, HTML canvas, JavaScript

## Credits and notice
This is an unofficial student project. It is not affiliated with or endorsed by NASA. News stories and images come from NASA's public feed and belong to NASA. Anime.js and Motion are MIT licensed.

## Try it
- Code: `<GitHub URL>`
- Demo video: `<video URL>`
- Team: `<names>`
