"""Run from the project root:  python -m unittest discover -s tests -v"""
import asyncio
import copy
import random
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import analysis, gemini, main, news, tools  # noqa: E402
from app import telemetry as sim  # noqa: E402

RSS = """<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Good story</title><link>https://www.nasa.gov/news-release/good/</link>
 <pubDate>Wed, 04 Nov 2026 21:04:10 +0000</pubDate><description>Plain summary.</description>
 <content:encoded><![CDATA[<img src="https://images-assets.nasa.gov/image/a/a~large.jpg?w=1920&amp;h=10">]]></content:encoded></item>
<item><title>Script link</title><link>javascript:alert(1)</link></item>
<item><title>Lookalike host</title><link>https://www.nasa.gov.evil.example/x/</link></item>
<item><title>Evil image</title><link>https://www.nasa.gov/blogs/ok/</link>
 <content:encoded><![CDATA[<img src="https://evil.example/x.jpg">]]></content:encoded></item>
</channel></rss>"""


class NewsTests(unittest.TestCase):
    def setUp(self):
        news._cache.update(at=0.0, data=None)

    def test_parse_keeps_only_nasa_links_and_images(self):
        items = news.parse(RSS.encode())
        self.assertEqual([i["title"] for i in items], ["Good story", "Evil image"])
        self.assertEqual(items[0]["image"], "https://images-assets.nasa.gov/image/a/a~medium.jpg")
        self.assertEqual(items[0]["kind"], "News release")
        self.assertEqual(items[0]["date"], "2026-11-04")
        self.assertIsNone(items[1]["image"])  # image host is not allowed, story is kept without it

    def test_dead_feed_is_not_retried_on_every_request(self):
        with mock.patch.object(news.httpx, "get", side_effect=news.httpx.ConnectError("offline")) as get:
            results = [news.get_news() for _ in range(3)]
        self.assertEqual(get.call_count, 1)
        self.assertTrue(all(r["stale"] and r["items"] for r in results))  # saved copy is served

    def test_live_feed_replaces_saved_copy(self):
        ok = mock.Mock(content=RSS.encode(), raise_for_status=lambda: None)
        with mock.patch.object(news.httpx, "get", return_value=ok):
            data = news.get_news()
        self.assertFalse(data["stale"])
        self.assertEqual(data["items"][0]["title"], "Good story")


class ToolTests(unittest.TestCase):
    def test_topic_matches_whole_words(self):
        items = [
            {"title": "Artemis III crew named", "summary": "", "detail": "", "date": "2026-10-02"},
            {"title": "Artemis II commander named deputy", "summary": "", "detail": "", "date": "2026-10-01"},
        ]
        with mock.patch.object(tools, "get_news", return_value={"items": items, "stale": False}):
            top = tools.get_mission_news("Artemis II")["items"][0]["title"]
        self.assertEqual(top, "Artemis II commander named deputy")


def reset_limits() -> None:
    main._hits.clear()
    main._all_hits.clear()
    main._announced.clear()


class ApiTests(unittest.TestCase):
    def setUp(self):
        reset_limits()
        self.client = TestClient(main.app)

    def test_question_length_and_voice_are_validated(self):
        self.assertEqual(self.client.post("/api/ask", json={"question": "x" * 501}).status_code, 422)
        self.assertEqual(self.client.post("/api/ask", json={"question": "hi", "voice": "robot"}).status_code, 422)

    def test_oversize_recording_is_rejected(self):
        r = self.client.post("/api/transcribe", content=b"x" * (main.MAX_AUDIO_BYTES + 1))
        self.assertEqual(r.status_code, 413)
        self.assertIn("too long", r.json()["error"])

    def test_small_recording_is_transcribed(self):
        with mock.patch.object(main, "transcribe", return_value="hello"):
            r = self.client.post("/api/transcribe", content=b"audio")
        self.assertEqual(r.json(), {"text": "hello", "error": None})

    def test_paid_endpoints_are_rate_limited(self):
        with mock.patch.object(main, "ask_gemini", return_value=("ok", [])), mock.patch.object(main, "speak", return_value=b"x"):
            codes = [self.client.post("/api/ask", json={"question": "hi"}).status_code for _ in range(main.RATE_LIMIT + 1)]
        self.assertEqual(codes[:-1], [200] * main.RATE_LIMIT)
        self.assertEqual(codes[-1], 429)


class DetectorTests(unittest.TestCase):
    def test_injected_fault_is_flagged(self):
        random.seed(1)
        for _ in range(45):
            sim.tick()
        sim._active.clear()
        sim.inject_fault("cabin.co2_ppm")
        sim.tick()
        flagged = {a["metric"]: a for a in sim.anomalies()}
        self.assertIn("cabin.co2_ppm", flagged)
        self.assertEqual(flagged["cabin.co2_ppm"]["direction"], "high")
        sim._active.clear()
        sim._bias["cabin.co2_ppm"] = 0.0


class AnalysisTests(unittest.TestCase):
    """Five minutes of synthetic history at 1 Hz, mid-range and flat unless a test changes one metric."""

    def setUp(self):
        self.saved = ({m: list(h) for m, h in sim._history.items()}, copy.deepcopy(sim._state), list(sim._events))
        analysis._cache.clear()
        self.t0 = time.time() - 300
        for m, h in sim._history.items():
            lo, hi = sim.NOMINAL[m]
            h.clear()
            h.extend((self.t0 + i, (lo + hi) / 2) for i in range(300))

    def tearDown(self):
        for m, h in sim._history.items():
            h.clear()
            h.extend(self.saved[0][m])
        sim._state.clear()
        sim._state.update(self.saved[1])
        sim._events.clear()
        sim._events.extend(self.saved[2])
        analysis._cache.clear()

    def row(self, metric):
        return next(r for r in analysis.analyze(10)["metrics"] if r["metric"] == metric)

    def test_flat_history_is_steady_and_fully_nominal(self):
        for m in sim.METRICS:
            sim._state[m.split(".")[0]][m.split(".")[1]] = sum(sim.NOMINAL[m]) / 2
        r = self.row("cabin.co2_ppm")
        self.assertEqual((r["trend"], r["pct_nominal"], r["excursions"]), ("steady", 100.0, 0))
        self.assertEqual(analysis.analyze(10)["summary"]["health"], 100)

    def test_rising_reading_reports_drift_and_time_to_limit(self):
        sim._history["cabin.co2_ppm"].clear()
        sim._history["cabin.co2_ppm"].extend((self.t0 + i, 700 + 2.0 * i) for i in range(300))  # +2 ppm per second
        sim._state["cabin"]["co2_ppm"] = 1298.0
        r = self.row("cabin.co2_ppm")
        self.assertEqual(r["trend"], "rising")
        self.assertAlmostEqual(r["change_per_min"], 120.0, delta=1)
        self.assertAlmostEqual(r["minutes_to_limit"], (1500 - 1298) / 120, delta=0.1)

    def test_excursions_and_time_within_limits(self):
        series = [50.0] * 50 + [10.0] * 20 + [50.0] * 50 + [10.0] * 20 + [50.0] * 160  # battery limit is 20
        sim._history["power.battery_percent"].clear()
        sim._history["power.battery_percent"].extend((self.t0 + i, v) for i, v in enumerate(series))
        r = self.row("power.battery_percent")
        self.assertEqual(r["excursions"], 2)
        self.assertAlmostEqual(r["pct_nominal"], 100 * (1 - 40 / 300), places=1)

    def test_too_little_history_gives_unknown_trend(self):
        for h in sim._history.values():
            h.clear()
            h.extend([(time.time() - 1, 1.0), (time.time(), 1.0)])
        self.assertEqual(self.row("cabin.co2_ppm")["trend"], "unknown")

    def test_unknown_metric_is_rejected(self):
        with self.assertRaises(KeyError):
            analysis.analyze(10, "nope")
        self.assertIn("error", tools.get_analysis(10, "nope"))

    def test_events_are_logged_and_served(self):
        sim.inject_fault("cabin.temp_c")
        self.assertEqual(sim.events(1)[0]["kind"], "fault")
        reset_limits()
        client = TestClient(main.app)
        with mock.patch.object(main, "ask_gemini", return_value=("ok", [{"name": "get_analysis", "args": {}}])), mock.patch.object(main, "speak", return_value=b"x"):
            client.post("/api/ask", json={"question": "my secret question"})
        newest = client.get("/api/log?limit=1").json()[0]
        self.assertEqual(newest["kind"], "question")
        self.assertNotIn("secret", newest["message"])  # the log is public, so it must not echo questions
        self.assertEqual(client.get("/api/analysis?minutes=0").status_code, 422)
        self.assertEqual(len(client.get("/api/analysis?minutes=5").json()["metrics"]), 9)


class LoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_transcribing_does_not_block_the_event_loop(self):
        reset_limits()
        gaps, last = [], time.monotonic()

        async def ticker():  # stands in for the simulator, which shares the loop
            nonlocal last
            while True:
                await asyncio.sleep(0.02)
                now = time.monotonic()
                gaps.append(now - last)
                last = now

        slow = mock.patch.object(main, "transcribe", side_effect=lambda audio: time.sleep(0.5) or "hi")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            with slow:
                await client.post("/api/transcribe", content=b"warm up")  # one-time setup costs must not count
                gaps.clear()
                last = time.monotonic()
                task = asyncio.create_task(ticker())
                reply = await client.post("/api/transcribe", content=b"audio")
        await asyncio.sleep(0.1)  # let the ticker record the gap that the request caused, if any
        task.cancel()
        self.assertEqual(reply.json()["text"], "hi")
        self.assertLess(max(gaps), 0.3)  # a blocked loop would show a gap of about 0.5 s


class HardeningTests(unittest.TestCase):
    def setUp(self):
        reset_limits()
        self.client = TestClient(main.app)
        self.addCleanup(lambda: (sim._bias.update({m: 0.0 for m in sim._bias}), sim._active.clear(), sim._alerts.clear()))

    def test_errors_do_not_leak_provider_details(self):
        with mock.patch.object(main, "transcribe", side_effect=RuntimeError("x-trace-id abc123")):
            said = self.client.post("/api/transcribe", content=b"a").json()["error"]
        with mock.patch.object(main, "ask_gemini", side_effect=RuntimeError("secret-detail")):
            asked = self.client.post("/api/ask", json={"question": "hi"}).json()["error"]
        self.assertTrue(said and asked)
        self.assertNotIn("abc123", said)
        self.assertNotIn("secret", asked)

    def test_empty_answer_is_an_error_not_a_blank_message(self):
        with mock.patch.object(main, "ask_gemini", return_value=("", [])), mock.patch.object(main, "speak") as speak:
            reply = self.client.post("/api/ask", json={"question": "hi"}).json()
        self.assertTrue(reply["error"])
        speak.assert_not_called()

    def test_mission_control_announcements_are_shared_but_questions_are_not(self):
        with mock.patch.object(main, "ask_gemini", return_value=("ok", [])) as gem, mock.patch.object(main, "speak", return_value=b"x"):
            for _ in range(3):
                self.client.post("/api/ask", json={"question": "new anomaly", "voice": "control"})
            self.assertEqual(gem.call_count, 1)
            for _ in range(2):
                self.client.post("/api/ask", json={"question": "status", "voice": "copilot"})
            self.assertEqual(gem.call_count, 3)

    def test_fault_route_is_limited_and_overall_cap_applies(self):
        with mock.patch.object(main, "GLOBAL_LIMIT", 2):
            codes = [self.client.post("/api/sim/fault", json={"metric": "cabin.temp_c"}).status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_repeated_faults_do_not_stack(self):
        sim.inject_fault("cabin.temp_c")
        one = sim._bias["cabin.temp_c"]
        sim.inject_fault("cabin.temp_c")
        sim.inject_fault("cabin.temp_c")
        self.assertEqual(sim._bias["cabin.temp_c"], one)


class ToolLogicTests(unittest.TestCase):
    def snapshot(self, **changes):
        snap = copy.deepcopy(sim.snapshot())
        snap["anomalies"] = []
        for path, value in changes.items():
            section, key = path.split("__")
            snap[section][key] = value
        return snap

    def test_diagnostics_flags_out_of_range_and_power_deficit(self):
        with mock.patch.object(tools.sim, "snapshot", return_value=self.snapshot(cabin__co2_ppm=2000, power__solar_output_kw=1.0, power__load_kw=3.0)):
            found = {f["metric"] for f in tools.run_diagnostics("all")["out_of_range"]}
        self.assertEqual(found, {"cabin.co2_ppm", "power.margin_kw"})

    def test_diagnostics_is_nominal_for_the_baseline(self):
        with mock.patch.object(tools.sim, "snapshot", return_value=self.snapshot()):
            self.assertEqual(tools.run_diagnostics("all")["result"], "ALL_NOMINAL")

    def test_alarm_level_is_coerced(self):
        self.addCleanup(sim._alerts.clear)
        self.assertEqual(tools.raise_alarm("cabin", "x", "banana")["raised"]["level"], "warning")
        self.assertEqual(tools.raise_alarm("cabin", "x", "critical")["raised"]["level"], "critical")

    def test_tool_calls_are_read_from_the_history(self):
        call = SimpleNamespace(function_call=SimpleNamespace(name="get_trend", args={"metric": "cabin.co2_ppm"}))
        text = SimpleNamespace(function_call=None)
        response = SimpleNamespace(automatic_function_calling_history=[SimpleNamespace(parts=[text, call])])
        self.assertEqual(gemini._tool_calls(response), [{"name": "get_trend", "args": {"metric": "cabin.co2_ppm"}}])
        self.assertEqual(gemini._tool_calls(SimpleNamespace(automatic_function_calling_history=None)), [])


if __name__ == "__main__":
    unittest.main()
