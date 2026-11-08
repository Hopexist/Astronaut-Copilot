/* Mission analysis: renders /api/analysis (statistics per reading) and /api/log (mission events). */
(() => {
  const $ = (id) => document.getElementById(id);
  const ARROW = { rising: "↑", falling: "↓", steady: "→", unknown: "·" };
  const fmt = (v, d = 1) => (v == null ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
  const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });
  const span = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function tile(label, value, sub, state) {
    const t = el("div", "an-tile");
    if (state) t.dataset.state = state;
    t.append(el("div", "an-tile-label", label), el("div", "an-tile-value", value), el("div", "an-tile-sub", sub));
    return t;
  }

  function renderTiles(s, minutes, metrics) {
    const health = s.health;
    const worst = metrics.find((m) => m.metric === s.worst);
    const state = health == null ? "" : health >= 90 ? "ok" : health >= 70 ? "warn" : "bad";
    $("anTiles").replaceChildren(
      tile("Health score", health == null ? "–" : String(health), "Time within limits, minus 10 per active anomaly", state),
      tile("Within limits", s.pct_nominal == null ? "–" : fmt(s.pct_nominal) + "%", worst ? `Lowest: ${worst.label} (${fmt(worst.pct_nominal)}%)` : s.pct_nominal == null ? "No data yet" : "Every reading stayed within limits"),
      tile("Anomalies", `${s.anomalies_active} now`, `${s.anomalies_in_window} flagged in ${minutes} min`, s.anomalies_active ? "bad" : ""),
      tile("Data analysed", fmt(s.samples, 0), `${span(s.covered_seconds)} of history`),
    );
  }

  function row(r) {
    const tr = el("tr");
    tr.dataset.status = r.status;
    const name = el("th", "an-name");
    name.scope = "row";
    name.append(el("span", "an-dot"), r.label);
    const drift = el("td");
    if (r.trend === "unknown" || r.change_per_min == null) drift.textContent = "–";
    else {
      drift.append(el("span", "an-trend an-" + r.trend, `${ARROW[r.trend]} ${fmt(r.change_per_min, 2)}`));
      if (r.minutes_to_limit != null) drift.append(el("small", "an-limit", `limit in ~${fmt(r.minutes_to_limit)} min`));
    }
    const within = el("td");
    if (r.pct_nominal == null) within.textContent = "–";
    else {
      const bar = el("span", "an-bar-track");
      const fill = el("i");
      fill.style.width = r.pct_nominal + "%";
      bar.appendChild(fill);
      within.append(bar, el("span", "an-pct", fmt(r.pct_nominal) + "%"));
    }
    const flags = [r.anomalies ? `${r.anomalies} anomal${r.anomalies > 1 ? "ies" : "y"}` : "", r.excursions ? `${r.excursions} out of range` : ""].filter(Boolean).join(", ");
    tr.append(
      name,
      el("td", "num", `${fmt(r.now, 2)} ${r.unit}`),
      el("td", "num", r.min == null ? "–" : `${fmt(r.min, 2)} / ${fmt(r.max, 2)}`),
      el("td", "num", r.mean == null ? "–" : `${fmt(r.mean, 2)} ± ${fmt(r.std, 2)}`),
      drift, within, el("td", "", flags || "–"),
    );
    return tr;
  }

  function renderLog(events) {
    const log = $("anLog");
    log.replaceChildren();
    if (!events.length) { log.appendChild(el("li", "none", "No events yet. Inject a fault or run the demo scenario.")); return; }
    for (const e of events) {
      const li = el("li");
      li.append(el("time", "", clock(e.t)), el("span", "an-kind an-kind-" + e.kind, e.kind), el("span", "", e.message));
      log.appendChild(li);
    }
  }

  let visible = false; // poll only while the section is near the screen
  async function load() {
    if (document.hidden || !visible) return;
    const minutes = $("anWindow").value;
    try {
      const [a, l] = await Promise.all([fetch("/api/analysis?minutes=" + minutes), fetch("/api/log?limit=8")]);
      if (!a.ok || !l.ok) throw new Error(a.status + "/" + l.status);
      const data = await a.json();
      renderTiles(data.summary, data.window_minutes, data.metrics);
      $("anBody").replaceChildren(...data.metrics.map(row));
      $("anInsights").replaceChildren(...data.summary.insights.map((t) => el("li", "", t)));
      renderLog(await l.json());
      const short = data.summary.covered_seconds < data.window_minutes * 60 - 5;
      $("anNote").textContent = short ? `Only ${span(data.summary.covered_seconds)} of history so far. It builds up while the server runs and resets on restart.` : "";
    } catch (e) {
      $("anNote").textContent = "Analysis is unavailable right now. It will retry.";
    }
  }

  $("anWindow").addEventListener("change", load);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) load(); }, { rootMargin: "300px 0px" }).observe($("analysis"));
  setInterval(load, 5000);
})();
