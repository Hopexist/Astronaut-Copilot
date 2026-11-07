"""Mission news from NASA's public Artemis RSS feed, cached, with a saved copy as fallback."""
import html
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

FEED = "https://www.nasa.gov/missions/artemis/feed/"
FALLBACK = Path(__file__).resolve().parent.parent / "data" / "news_fallback.json"
TTL = 900  # seconds between live fetches
MAX_ITEMS = 9
NS = {"content": "http://purl.org/rss/1.0/modules/content/"}
KINDS = {"news-release": "News release", "image-article": "Image", "blogs": "Blog", "missions": "Mission"}
SAFE_HOSTS = ("https://www.nasa.gov/", "https://images-assets.nasa.gov/")  # only these reach the page

_cache: dict = {"at": 0.0, "data": None}


def _image(item: ET.Element) -> str | None:
    match = re.search(r'<img[^>]+src="([^"]+)"', item.findtext("content:encoded", namespaces=NS) or "")
    if not match:
        return None
    url = html.unescape(match.group(1))
    if not url.startswith(SAFE_HOSTS):
        return None
    if "images-assets.nasa.gov" in url:
        return re.sub(r"~(large|orig)\.", "~medium.", url.split("?")[0])
    return url.split("?")[0] + "?w=800"


def _summary(item: ET.Element, limit: int = 240) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", "", item.findtext("description") or ""))
    text = re.sub(r"\s*The post .* appeared first on .*$", "", re.sub(r"\s+", " ", text)).strip()
    return text[:limit].rsplit(" ", 1)[0] + "..." if len(text) > limit else text


def parse(xml_bytes: bytes) -> list[dict]:
    items = []
    for it in ET.fromstring(xml_bytes).findall("./channel/item"):
        link = (it.findtext("link") or "").strip()
        title = html.unescape((it.findtext("title") or "").strip())
        if not link.startswith("https://www.nasa.gov/") or not title:
            continue
        try:
            date = parsedate_to_datetime(it.findtext("pubDate") or "").date().isoformat()
        except (TypeError, ValueError):
            date = ""
        section = link.removeprefix("https://www.nasa.gov/").split("/")[0]
        items.append({"title": title, "url": link, "date": date, "kind": KINDS.get(section, "Feature"),
                      "summary": _summary(it), "detail": _summary(it, 700), "image": _image(it)})
    return items[:MAX_ITEMS]


def get_news() -> dict:
    now = time.time()
    if _cache["data"] and now - _cache["at"] < TTL:
        return _cache["data"]
    try:
        resp = httpx.get(FEED, timeout=8, follow_redirects=True, headers={"User-Agent": "AstronautCopilot-student-project"})
        resp.raise_for_status()
        items = parse(resp.content)
        if items:
            data = {"items": items, "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"), "stale": False}
            _cache.update(at=now, data=data)
            return data
    except Exception:
        pass  # fall through to the last good copy
    if _cache["data"]:
        return {**_cache["data"], "stale": True}
    try:
        return {**json.loads(FALLBACK.read_text(encoding="utf-8")), "stale": True}
    except (OSError, ValueError):
        return {"items": [], "fetched": None, "stale": True}
