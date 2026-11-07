/* Mission news: renders /api/news (NASA Artemis feed) as a featured story plus a grid. */
(() => {
  const $ = (id) => document.getElementById(id);
  const NASA_PAGE = "https://www.nasa.gov/missions/artemis/";
  const okLink = (u) => typeof u === "string" && u.startsWith("https://www.nasa.gov/");
  const okImage = (u) => typeof u === "string" && (u.startsWith("https://www.nasa.gov/") || u.startsWith("https://images-assets.nasa.gov/"));
  const fmtDate = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function story(item, feature) {
    const a = el("a", "story" + (feature ? " feature" : ""));
    a.href = item.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    const thumb = el("div", "thumb");
    if (okImage(item.image)) {
      const img = new Image();
      img.alt = ""; img.loading = feature ? "eager" : "lazy"; img.decoding = "async"; img.src = item.image;
      img.onerror = () => img.remove();
      thumb.appendChild(img);
    }
    const body = el("div", "body");
    const kick = el("div", "kicker", item.kind || "Feature");
    if (item.date) kick.append(" ", el("span", "when", "· " + fmtDate(item.date)));
    body.append(kick, el("h3", "", item.title), el("p", "", item.summary || ""));
    const hint = el("span", "sr", " (opens nasa.gov in a new tab)");
    a.append(thumb, body, hint);
    return a;
  }

  function render(data) {
    const grid = $("newsGrid"), meta = $("newsMeta");
    const items = (data.items || []).filter((i) => okLink(i.url) && i.title);
    grid.replaceChildren();
    if (!items.length) {
      const box = el("div", "news-empty");
      box.append("News is unavailable right now. ");
      const a = el("a", "", "Read the latest Artemis coverage on nasa.gov");
      a.href = NASA_PAGE; a.target = "_blank"; a.rel = "noopener noreferrer";
      box.append(a, ".");
      grid.appendChild(box);
      meta.textContent = "";
      return;
    }
    items.forEach((it, i) => grid.appendChild(story(it, i === 0)));
    const when = data.fetched ? new Date(data.fetched) : null;
    const stamp = when ? when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    meta.textContent = data.stale
      ? `Showing a saved copy${stamp ? " from " + stamp : ""}; the live feed could not be reached.`
      : `Source: NASA Artemis feed. Updated ${stamp}.`;
    const latest = $("latestLink");
    if (latest) { latest.textContent = items[0].title; latest.href = items[0].url; $("latest").hidden = false; }
    document.dispatchEvent(new CustomEvent("news-rendered"));
  }

  async function load() {
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error(res.status);
      render(await res.json());
    } catch (_) {
      render({ items: [] });
    }
  }
  load();
  setInterval(load, 15 * 60 * 1000);
})();
