"""Run from the project root:  python -m unittest discover -s tests -v"""
import random
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import main, news, tools  # noqa: E402
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


class ApiTests(unittest.TestCase):
    def setUp(self):
        main._hits.clear()
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


if __name__ == "__main__":
    unittest.main()
