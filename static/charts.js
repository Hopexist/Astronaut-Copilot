/* Trend charts for the Telemetry section: multi-series canvas charts with limit lines, anomaly markers and a hover readout.
   They read the live series that index.html already collects (window.cockpit) and make no requests of their own. */
(() => {
  const $ = (id) => document.getElementById(id);
  const root = $("charts"), cockpit = window.cockpit;
  if (!root || !cockpit) return;
  const { series, flags, METRICS } = cockpit;
  const MAXPTS = 120; // two minutes at one reading a second, same as the cards
  const A = window.anime && window.anime.animate ? window.anime : null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "full";
  const FONT = "11px ui-monospace, Menlo, Consolas, monospace";

  const CHARTS = [
    { title: "Power balance", sub: "Solar output against load. Green fill is surplus, red is deficit.", span: "c-7", between: ["power.solar_output_kw", "power.load_kw"],
      series: [{ path: "power.solar_output_kw", label: "Solar", color: "#ffb020" }, { path: "power.load_kw", label: "Load", color: "#4f8de8" }] },
    { title: "Resources", sub: "Battery and fuel remaining. Dashed lines are the lower limits.", span: "c-5", fixed: [0, 100],
      series: [{ path: "power.battery_percent", label: "Battery", color: "#3ddc97", limits: "lo" }, { path: "propulsion.fuel_percent", label: "Fuel", color: "#b9a3ff", limits: "lo" }] },
    { title: "Cabin air", sub: "CO₂ on the left axis, O₂ on the right. Dashed lines are limits.", span: "c-5",
      series: [{ path: "cabin.co2_ppm", label: "CO₂", color: "#ff8a4c" }, { path: "cabin.o2_percent", label: "O₂", color: "#6fd0ff", axis: "r" }] },
    { title: "Temperatures", sub: "Cabin and radiator, in °C.", span: "c-7",
      series: [{ path: "cabin.temp_c", label: "Cabin", color: "#ff8a4c" }, { path: "thermal.radiator_temp_c", label: "Radiator", color: "#6fd0ff" }] },
  ];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const value = (path, v) => `${v.toFixed(METRICS[path][2])} ${METRICS[path][1]}`;

  const charts = CHARTS.map((cfg) => {
    const sec = el("section", "panel chart " + cfg.span);
    sec.setAttribute("aria-label", cfg.title);
    const titles = el("div");
    titles.append(el("h3", "ph", cfg.title), el("p", "chart-sub", cfg.sub));
    const legend = el("div", "legend");
    const items = cfg.series.map((s) => {
      const b = el("b", "", "–"), swatch = el("i"), li = el("span", "lg");
      swatch.style.background = s.color;
      li.append(swatch, s.label + " ", b);
      legend.appendChild(li);
      return b;
    });
    const head = el("div", "chart-head");
    head.append(titles, legend);
    const cv = el("canvas");
    cv.setAttribute("role", "img");
    sec.append(head, cv);
    root.appendChild(sec);
    return { cfg, sec, cv, items, reveal: reduce || !A ? 1 : 0, hoverX: null, geom: null, played: false };
  });

  const nominalOf = (path) => (cockpit.nominal && cockpit.nominal[path]) || [];

  function scaleFor(cfg, axis) {
    if (cfg.fixed && axis === "l") return { lo: cfg.fixed[0], hi: cfg.fixed[1] };
    const group = cfg.series.filter((s) => (s.axis || "l") === axis);
    const vals = group.flatMap((s) => series[s.path]);
    if (!vals.length) return { lo: 0, hi: 1 };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(hi - lo, Math.abs(hi) * 0.01, 1e-6);
    for (const s of group) for (const limit of nominalOf(s.path)) if (limit >= lo - span && limit <= hi + span) { lo = Math.min(lo, limit); hi = Math.max(hi, limit); } // pull in limits that are close
    const minSpan = Math.max(...group.map((s) => (nominalOf(s.path)[1] - nominalOf(s.path)[0]) * 0.2 || 0)); // do not blow tiny noise up to full height
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    const pad = (hi - lo) * 0.1 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }

  function draw(ch) {
    const { cfg, cv } = ch;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;

    const len = Math.max(...cfg.series.map((s) => series[s.path].length));
    if (len < 2) { ctx.fillStyle = "#a3a8b3"; ctx.fillText("Collecting data…", 14, h / 2); return; }
    const hasRight = cfg.series.some((s) => s.axis === "r");
    const L = 48, R = hasRight ? 48 : 14, T = 12, B = 24;
    const plotW = w - L - R, plotH = h - T - B;
    const X = (i, n) => L + ((i + MAXPTS - n) / (MAXPTS - 1)) * plotW;
    const sc = { l: scaleFor(cfg, "l"), r: hasRight ? scaleFor(cfg, "r") : null };
    const Y = (v, axis = "l") => T + (1 - (v - sc[axis].lo) / (sc[axis].hi - sc[axis].lo)) * plotH;

    // grid and axis labels
    const digits = (axis) => { const span = sc[axis].hi - sc[axis].lo; return span >= 100 ? 0 : span >= 10 ? 1 : 2; };
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const y = T + (plotH * k) / 4;
      ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      ctx.fillStyle = "#a3a8b3"; ctx.textAlign = "right";
      ctx.fillText((sc.l.hi - ((sc.l.hi - sc.l.lo) * k) / 4).toFixed(digits("l")), L - 6, y + 4);
      if (hasRight) {
        ctx.fillStyle = cfg.series.find((s) => s.axis === "r").color; ctx.textAlign = "left";
        ctx.fillText((sc.r.hi - ((sc.r.hi - sc.r.lo) * k) / 4).toFixed(digits("r")), w - R + 6, y + 4);
      }
    }
    ctx.fillStyle = "#a3a8b3"; ctx.textAlign = "left"; ctx.fillText("-2 min", L, h - 6);
    ctx.textAlign = "center"; ctx.fillText("-1 min", L + plotW / 2, h - 6);
    ctx.textAlign = "right"; ctx.fillText("now", w - R, h - 6);

    // everything below grows in from the left the first time the chart appears
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, L + (w - L) * ch.reveal, h); ctx.clip();

    if (cfg.between) {
      const [pa, pb] = cfg.between.map((p) => series[p]);
      const n = Math.min(pa.length, pb.length);
      for (let i = 0; i < n - 1; i++) {
        const surplus = pa[i] + pa[i + 1] >= pb[i] + pb[i + 1];
        ctx.fillStyle = surplus ? "rgba(61,220,151,.26)" : "rgba(255,90,74,.34)";
        ctx.beginPath();
        ctx.moveTo(X(i, n), Y(pa[i])); ctx.lineTo(X(i + 1, n), Y(pa[i + 1]));
        ctx.lineTo(X(i + 1, n), Y(pb[i + 1])); ctx.lineTo(X(i, n), Y(pb[i]));
        ctx.closePath(); ctx.fill();
      }
    }

    for (const s of cfg.series) {
      const d = series[s.path], f = flags[s.path], n = d.length, axis = s.axis || "l";
      if (n < 2) continue;
      for (const limit of nominalOf(s.path)) { // dashed limit lines that fall inside the view
        if (limit < sc[axis].lo || limit > sc[axis].hi) continue;
        if (s.limits === "lo" && limit !== nominalOf(s.path)[0]) continue;
        ctx.setLineDash([5, 4]); ctx.strokeStyle = s.color; ctx.globalAlpha = 0.45;
        ctx.beginPath(); ctx.moveTo(L, Y(limit, axis)); ctx.lineTo(w - R, Y(limit, axis)); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      d.forEach((v, i) => (i ? ctx.lineTo(X(i, n), Y(v, axis)) : ctx.moveTo(X(i, n), Y(v, axis))));
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
      if (!cfg.between) {
        const g = ctx.createLinearGradient(0, T, 0, T + plotH);
        g.addColorStop(0, s.color + "33"); g.addColorStop(1, s.color + "00");
        ctx.lineTo(X(n - 1, n), T + plotH); ctx.lineTo(X(0, n), T + plotH); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      }
      ctx.fillStyle = "#ff4d5e"; // anomaly markers
      f.forEach((flagged, i) => { if (flagged) { ctx.beginPath(); ctx.arc(X(i, n), Y(d[i], axis), 3.5, 0, 7); ctx.fill(); } });
      ctx.beginPath(); ctx.arc(X(n - 1, n), Y(d[n - 1], axis), 3, 0, 7); ctx.fillStyle = s.color; ctx.fill();
    }
    ctx.restore();

    // hover: crosshair, dots and a readout
    if (ch.hoverX != null) {
      const slot = Math.round(((ch.hoverX - L) / plotW) * (MAXPTS - 1)), i = slot - (MAXPTS - len);
      if (i >= 0 && i < len) {
        const x = X(i, len);
        ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + plotH); ctx.stroke();
        const when = len - 1 - i === 0 ? "now" : `${len - 1 - i} s ago`;
        const lines = cfg.series.map((s) => {
          const d = series[s.path];
          const idx = i - (len - d.length);
          if (idx < 0) return null;
          ctx.beginPath(); ctx.arc(x, Y(d[idx], s.axis || "l"), 4, 0, 7); ctx.fillStyle = s.color; ctx.fill();
          return { s, text: `${s.label}  ${value(s.path, d[idx])}` };
        }).filter(Boolean);
        const boxW = Math.max(...[when, ...lines.map((l) => l.text)].map((t) => ctx.measureText(t).width)) + 34, boxH = 12 + 16 * (lines.length + 1);
        const bx = x + 12 + boxW > w - 4 ? x - 12 - boxW : x + 12, by = T + 4;
        ctx.fillStyle = "rgba(8,10,16,.92)"; ctx.strokeStyle = "rgba(255,255,255,.2)";
        ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 8) : ctx.rect(bx, by, boxW, boxH)); ctx.fill(); ctx.stroke();
        ctx.textAlign = "left"; ctx.fillStyle = "#a3a8b3"; ctx.fillText(when, bx + 10, by + 17);
        lines.forEach((l, k) => {
          ctx.fillStyle = l.s.color; ctx.fillRect(bx + 10, by + 26 + 16 * k, 8, 8);
          ctx.fillStyle = "#f4f5f7"; ctx.fillText(l.text, bx + 24, by + 34 + 16 * k);
        });
      }
    }
  }

  function updateText(ch) {
    const parts = ch.cfg.series.map((s, k) => {
      const d = series[s.path];
      const text = d.length ? value(s.path, d[d.length - 1]) : "–";
      ch.items[k].textContent = text;
      return `${s.label} ${text}`;
    });
    ch.cv.setAttribute("aria-label", `${ch.cfg.title}, last two minutes. Now: ${parts.join(", ")}.`);
  }

  function play(ch) { // the line draws in from the left the first time the chart scrolls into view
    if (ch.played) return;
    ch.played = true;
    if (ch.reveal >= 1) return;
    const done = () => { ch.reveal = 1; draw(ch); };
    try { A.animate(ch, { reveal: [0, 1], duration: 1100, ease: "outCubic", onUpdate: () => draw(ch) }); } catch (_) { done(); }
    setTimeout(done, 1500); // if the animation library misbehaves, never leave a chart half drawn
  }

  const redraw = () => charts.forEach((ch) => { updateText(ch); draw(ch); });
  let visible = false;
  document.addEventListener("telemetry", () => { if (visible) redraw(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) redraw(); }, { rootMargin: "200px 0px" }).observe($("telemetry"));
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(root);

  charts.forEach((ch) => {
    new IntersectionObserver(([entry]) => { if (entry.isIntersecting) play(ch); }, { threshold: 0.3 }).observe(ch.sec);
    let queued = false;
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(ch); }); } };
    ch.cv.addEventListener("pointermove", (e) => { ch.hoverX = e.clientX - ch.cv.getBoundingClientRect().left; later(); });
    ch.cv.addEventListener("pointerleave", () => { ch.hoverX = null; later(); });
  });
})();
