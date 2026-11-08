/* Exploded 3D wireframe of the craft with live component status.
   A tiny renderer on a 2D canvas (rotation + perspective): no WebGL or 3D library needed. */
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $("craftCanvas");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const reduce = document.documentElement.dataset.motion === "reduced";
  const A = window.anime && window.anime.animate ? window.anime : null;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const TAU = Math.PI * 2;
  const COLORS = { ok: "#3ddc97", warn: "#ffb020", bad: "#ff5a4a" };
  const RANK = { ok: 0, warn: 1, bad: 2 };

  /* ---------- geometry: lists of line segments [[x,y,z],[x,y,z]] ---------- */
  const ring = (y, r, n = 28, cx = 0, cz = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * TAU), y, cz + r * Math.sin((i / n) * TAU)]);
  const loop = (pts) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
  function cyl(y0, y1, r0, r1, rings = 4, spokes = 12, cx = 0, cz = 0) {
    const s = [];
    for (let k = 0; k <= rings; k++) s.push(...loop(ring(y0 + ((y1 - y0) * k) / rings, r0 + ((r1 - r0) * k) / rings, 28, cx, cz)));
    for (let j = 0; j < spokes; j++) {
      const a = (j / spokes) * TAU;
      s.push([[cx + r0 * Math.cos(a), y0, cz + r0 * Math.sin(a)], [cx + r1 * Math.cos(a), y1, cz + r1 * Math.sin(a)]]);
    }
    return s;
  }
  function box(cx, cy, cz, sx, sy, sz) {
    const c = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) c.push([cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2]);
    const s = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const d = (i ^ j);
      if (d === 1 || d === 2 || d === 4) s.push([c[i], c[j]]);
    }
    return s;
  }
  const map = (segs, f) => segs.map(([a, b]) => [f(a), f(b)]);
  const rotY = (a) => ([x, y, z]) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
  const rotZ = (a) => ([x, y, z]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
  const move = (dx, dy, dz) => ([x, y, z]) => [x + dx, y + dy, z + dz];

  // crew module: capsule, docking cap, heat shield
  const crew = [
    ...cyl(1.9, 3.1, 1.25, 0.55, 5, 12),
    ...cyl(3.1, 3.38, 0.28, 0.28, 2, 8),
    ...loop(ring(1.78, 1.3)),
    [[-1.3, 1.78, 0], [1.3, 1.78, 0]], [[0, 1.78, -1.3], [0, 1.78, 1.3]],
  ];
  // service module: shell + four small thrusters
  const service = [...cyl(-0.8, 1.6, 1.2, 1.2, 6, 16), ...loop(ring(1.68, 1.24)), ...loop(ring(-0.88, 1.24))];
  for (let k = 0; k < 4; k++) service.push(...map(box(1.3, -0.5, 0, 0.2, 0.2, 0.2), rotY(Math.PI / 4 + (k * Math.PI) / 2)));
  // one solar wing along +x: three panels with grid lines
  const wing = [];
  for (let i = 0; i < 3; i++) {
    const x0 = 1.35 + i * 0.9, cx = x0 + 0.425;
    wing.push(...box(cx, 0.4, 0, 0.85, 1.4, 0.04), [[cx, -0.3, 0], [cx, 1.1, 0]], [[x0, 0.4, 0], [x0 + 0.85, 0.4, 0]]);
  }
  // one radiator panel on a diagonal
  const radiator = [...box(1.65, 0.4, 0, 0.8, 1.8, 0.04)];
  for (let i = 1; i < 5; i++) radiator.push([[1.25 + i * 0.16, -0.5, 0], [1.25 + i * 0.16, 1.3, 0]]);
  // propellant tanks
  const tanks = [];
  for (const cx of [-0.55, 0.55]) {
    tanks.push(...cyl(-2.4, -1.1, 0.5, 0.5, 5, 8, cx, 0));
    for (const [y, r] of [[-1.0, 0.36], [-0.93, 0.2], [-2.5, 0.36], [-2.57, 0.2]]) tanks.push(...loop(ring(y, r, 20, cx, 0)));
  }
  // main engine bell
  const engine = [...cyl(-3.7, -2.5, 0.85, 0.3, 6, 14), ...loop(ring(-2.4, 0.45)), ...loop(ring(-2.3, 0.45))];
  // antenna dish on a boom
  const dishLocal = [];
  for (const r of [0.25, 0.5, 0.75]) dishLocal.push(...loop(ring(r * r * 0.8, r, 20)));
  for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU; dishLocal.push([[0, 0, 0], [0.75 * Math.cos(a), 0.45, 0.75 * Math.sin(a)]]); }
  dishLocal.push([[0, 0, 0], [0, 0.6, 0]]);
  const antenna = [...map(dishLocal, (p) => move(2.05, -1.1, 0)(rotZ(-0.8)(p))), [[1.0, -0.6, 0], [2.0, -1.05, 0]]];

  const radial = (a, d) => [Math.cos(a) * d, 0, -Math.sin(a) * d];
  const wingGroups = [0, 1, 2, 3].map((k) => ({ segs: map(wing, rotY((k * Math.PI) / 2)), dir: radial((k * Math.PI) / 2, 1.1) }));
  const radGroups = [0, 1, 2, 3].map((k) => { const a = Math.PI / 4 + (k * Math.PI) / 2; return { segs: map(radiator, rotY(a)), dir: radial(a, 0.9) }; });

  /* ---------- parts, tied to telemetry ---------- */
  const fmt = (v, d = 1) => (typeof v === "number" ? v.toFixed(d) : "--");
  const live = () => (window.cockpit && window.cockpit.latest) || null;
  const get = (t, path) => path.split(".").reduce((o, k) => o?.[k], t);
  const num = (label, path, unit, dec) => ({ label, path, unit, dec });
  const txt = (label, fn, okFn) => ({ label, text: fn, ok: okFn });
  const PARTS = [
    { id: "crew", name: "Crew module", sys: "Cabin", groups: [{ segs: crew, dir: [0, 1.5, 0] }],
      metrics: [num("Oxygen", "cabin.o2_percent", "%", 2), num("Carbon dioxide", "cabin.co2_ppm", "ppm", 0), num("Pressure", "cabin.pressure_kpa", "kPa", 1), num("Temperature", "cabin.temp_c", "°C", 1)],
      head: (t) => `${fmt(get(t, "cabin.o2_percent"))}% O2` },
    { id: "service", name: "Service module", sys: "Power", groups: [{ segs: service, dir: [0, 0.15, 0] }],
      metrics: [num("Battery", "power.battery_percent", "%", 1), num("Power load", "power.load_kw", "kW", 2)],
      head: (t) => `${fmt(get(t, "power.battery_percent"), 0)}% battery` },
    { id: "solar", name: "Solar arrays", sys: "Power", groups: wingGroups,
      metrics: [num("Solar output", "power.solar_output_kw", "kW", 2)],
      head: (t) => `${fmt(get(t, "power.solar_output_kw"), 1)} kW solar` },
    { id: "tanks", name: "Propellant tanks", sys: "Propulsion", groups: [{ segs: tanks, dir: [0, -0.8, 0] }],
      metrics: [num("Fuel", "propulsion.fuel_percent", "%", 2)],
      head: (t) => `${fmt(get(t, "propulsion.fuel_percent"), 0)}% fuel` },
    { id: "engine", name: "Main engine", sys: "Propulsion", groups: [{ segs: engine, dir: [0, -1.6, 0] }],
      metrics: [txt("Engine", (t) => t.propulsion?.engine_status ?? "--", (v) => ["idle", "nominal", "standby", "burning"].includes(v)), txt("Next burn in", (t) => t.navigation?.next_burn_in ?? "--")],
      head: (t) => `engine ${t.propulsion?.engine_status ?? "--"}` },
    { id: "radiators", name: "Radiators", sys: "Thermal", groups: radGroups,
      metrics: [num("Radiator temperature", "thermal.radiator_temp_c", "°C", 1), txt("Coolant loop", (t) => t.thermal?.coolant_loop_status ?? "--", (v) => v === "nominal")],
      head: (t) => `${fmt(get(t, "thermal.radiator_temp_c"))} °C` },
    { id: "antenna", name: "Antenna", sys: "Navigation", groups: [{ segs: antenna, dir: [1.4, -0.4, 0] }],
      metrics: [txt("Distance from Earth", (t) => Math.round(t.navigation?.altitude_km ?? 0).toLocaleString() + " km"), txt("Velocity", (t) => (t.navigation?.velocity_kms ?? "--") + " km/s")],
      head: (t) => `${Math.round(t.navigation?.altitude_km ?? 0).toLocaleString()} km` },
  ];
  const byId = Object.fromEntries(PARTS.map((p) => [p.id, p]));

  function metricState(m) {
    if (m.path) return window.cockpit?.cards?.[m.path]?.state || "ok";
    const t = live();
    return m.ok && t && !m.ok(m.text(t)) ? "warn" : "ok";
  }
  function metricValue(m) {
    const t = live();
    if (!t) return "--";
    return m.path ? `${fmt(get(t, m.path), m.dec)} ${m.unit}` : m.text(t);
  }
  const stateOf = (p) => p.metrics.reduce((w, m) => (RANK[metricState(m)] > RANK[w] ? metricState(m) : w), "ok");

  /* ---------- view state ---------- */
  const S = { yaw: -0.55, pitch: 0.2, vyaw: 0, explode: 0, target: 0, hover: null, sel: null, drag: null, running: false, W: 0, H: 0, pp: {}, bounds: {} };
  const h = Object.fromEntries(PARTS.map((p) => [p.id, 0])); // eased hover amount per part
  const CAM = 14;
  const unit = () => Math.min(S.H * 0.085, S.W * 0.075);

  function project(p) {
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
    const f = CAM / (CAM - z2), u = unit();
    return [S.W / 2 + x1 * f * u, S.H / 2 - y2 * f * u, z2];
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.W = cv.clientWidth; S.H = cv.clientHeight;
    if (!S.W || !S.H) return;
    cv.width = Math.round(S.W * dpr); cv.height = Math.round(S.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!S.W || !S.H) resize();
    if (!S.W || !S.H) return;
    ctx.clearRect(0, 0, S.W, S.H);
    const focus = S.hover || S.sel;
    const dim = Math.max(...PARTS.map((p) => h[p.id]));
    const order = [];
    for (const p of PARTS) {
      const lift = h[p.id] * 0.3, pts = [], lines = [];
      let zsum = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const g of p.groups) {
        const ox = g.dir[0] * S.explode, oy = g.dir[1] * S.explode + lift, oz = g.dir[2] * S.explode;
        for (const [a, b] of g.segs) {
          const pa = project([a[0] + ox, a[1] + oy, a[2] + oz]), pb = project([b[0] + ox, b[1] + oy, b[2] + oz]);
          lines.push(pa, pb); pts.push(pa, pb); zsum += pa[2];
          for (const q of [pa, pb]) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
        }
      }
      S.pp[p.id] = pts;
      S.bounds[p.id] = { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
      order.push({ p, lines, z: zsum / Math.max(1, pts.length / 2) });
    }
    order.sort((a, b) => a.z - b.z); // far parts first
    const t = live();
    for (const { p, lines } of order) {
      const st = stateOf(p), hv = h[p.id], sel = S.sel === p.id;
      const base = focus ? 0.5 - 0.3 * dim * (1 - hv) : 0.85;
      ctx.beginPath();
      for (let i = 0; i < lines.length; i += 2) { ctx.moveTo(lines[i][0], lines[i][1]); ctx.lineTo(lines[i + 1][0], lines[i + 1][1]); }
      ctx.lineWidth = 1 + hv * 0.9 + (st === "bad" ? 0.8 : 0) + (sel ? 0.6 : 0);
      ctx.globalAlpha = clamp(base + hv * 0.5 + (st !== "ok" ? 0.25 : 0), 0.15, 1);
      ctx.strokeStyle = st === "bad" ? COLORS.bad : st === "warn" ? COLORS.warn : hv > 0.05 || sel ? "#ffffff" : "#b4bac6";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (!t) return;
    const labelAlpha = clamp((S.explode - 0.12) / 0.25);
    ctx.textBaseline = "middle";
    for (const p of PARTS) {
      const b = S.bounds[p.id], hv = h[p.id], a = Math.max(labelAlpha, hv, S.sel === p.id ? 1 : 0);
      if (a < 0.05) continue;
      const right = b.cx >= S.W / 2, ax = right ? b.maxX + 4 : b.minX - 4, ay = b.cy;
      ctx.globalAlpha = a * (focus && focus !== p.id ? 0.55 : 1);
      ctx.fillStyle = COLORS[stateOf(p)];
      ctx.beginPath(); ctx.arc(ax, ay, 4 + hv * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#e8eaee"; ctx.textAlign = right ? "left" : "right";
      ctx.font = `${hv > 0.4 ? 600 : 400} ${13 + hv * 1.5}px ui-monospace, Menlo, Consolas, monospace`;
      const tx = ax + (right ? 12 : -12);
      ctx.fillText(p.head(t), tx, ay);
      if (hv > 0.2 || S.sel === p.id) {
        ctx.globalAlpha = Math.max(hv, S.sel === p.id ? 1 : 0) * 0.9;
        ctx.fillStyle = "#a3a8b3"; ctx.font = "700 10.5px system-ui, sans-serif";
        ctx.fillText(p.name.toUpperCase(), tx, ay - 16);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- picking: smallest projected hull under the pointer wins ---------- */
  function hull(points) {
    const ps = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const build = (arr) => { const out = []; for (const q of arr) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop(); out.push(q); } out.pop(); return out; };
    return build(ps).concat(build(ps.slice().reverse()));
  }
  const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // A part is a candidate if the pointer is inside its outline or within 8 px of one of its lines;
  // the part whose lines are closest wins, so overlapping outlines still resolve to the nearer part.
  function pick(x, y) {
    let best = null, bestDist = Infinity;
    const dists = {};
    for (const p of PARTS) {
      const pts = S.pp[p.id]; if (!pts || pts.length < 6) continue;
      let d = Infinity;
      for (let i = 0; i < pts.length; i += 2) d = Math.min(d, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      if (d > 8 && !(d < 80 && inside(hull(pts), x, y))) continue;
      dists[p.id] = d;
      if (d < bestDist) { best = p.id; bestDist = d; }
    }
    // hysteresis: the part already under the pointer keeps it unless another is clearly closer
    if (S.hover && dists[S.hover] !== undefined && dists[S.hover] <= bestDist + 4) return S.hover;
    return best;
  }

  /* ---------- side panel: health bar, component list, details ---------- */
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const bar = $("craftBar"), legend = $("craftLegend"), detail = $("craftDetail"), summary = $("craftSummary");
  let shownDetail = null;

  function setHover(id) { S.hover = id; cv.style.cursor = id ? "pointer" : "grab"; refreshDetail(); }
  function select(id) { S.sel = S.sel === id ? null : id; refreshDetail(); refreshPanel(); }

  function buildPanel() {
    for (const p of PARTS) {
      const seg = el("button", "seg"); seg.type = "button"; seg.dataset.part = p.id; seg.setAttribute("aria-label", p.name);
      const btn = el("button", "part-btn"); btn.type = "button"; btn.dataset.part = p.id;
      btn.append(el("span", "dot"), el("span", "nm", p.name), el("span", "pv"));
      for (const n of [seg, btn]) {
        n.addEventListener("mouseenter", () => setHover(p.id)); n.addEventListener("mouseleave", () => setHover(null));
        n.addEventListener("focus", () => setHover(p.id)); n.addEventListener("blur", () => setHover(null));
        n.addEventListener("click", () => select(p.id));
      }
      bar.appendChild(seg); legend.appendChild(btn);
    }
  }

  function refreshPanel() {
    const t = live();
    let issues = 0;
    for (const p of PARTS) {
      const st = stateOf(p); if (st !== "ok") issues++;
      const seg = bar.querySelector(`[data-part="${p.id}"]`), btn = legend.querySelector(`[data-part="${p.id}"]`);
      seg.style.background = COLORS[st]; seg.dataset.state = st; seg.title = `${p.name}: ${st === "ok" ? "normal" : st === "warn" ? "out of range" : "anomaly"}`;
      btn.dataset.state = st; btn.setAttribute("aria-pressed", S.sel === p.id);
      btn.querySelector(".dot").style.background = COLORS[st];
      btn.querySelector(".pv").textContent = t ? p.head(t) : "";
    }
    summary.textContent = issues ? `${issues} of ${PARTS.length} need attention` : `All ${PARTS.length} normal`;
    summary.dataset.state = issues ? "warn" : "ok";
    refreshDetail(true);
  }

  function refreshDetail(force) {
    const id = S.hover || S.sel, key = id;
    const changed = key !== shownDetail;
    if (!force && !changed) return;
    shownDetail = key;
    detail.replaceChildren();
    if (!id) { detail.appendChild(el("p", "craft-empty", "Hover or select a component to see its readings.")); return; }
    const p = byId[id], st = stateOf(p);
    const head = el("div", "d-head");
    head.append(el("h3", "", p.name), el("span", "d-state", st === "ok" ? "Normal" : st === "warn" ? "Out of range" : "Anomaly"));
    head.lastChild.dataset.state = st;
    detail.append(head, el("p", "d-sys", p.sys + " system"));
    for (const m of p.metrics) {
      const row = el("div", "d-row"), ms = metricState(m);
      row.append(el("span", "d-label", m.label), el("b", "d-val", metricValue(m)));
      const tag = el("span", "d-tag", ms === "ok" ? "" : ms === "warn" ? "OUT OF RANGE" : "ANOMALY"); tag.dataset.state = ms;
      row.appendChild(tag);
      if (m.path && typeof window.openDetail === "function") {
        const b = el("button", "ghost mini", "Chart"); b.type = "button"; b.setAttribute("aria-label", `Open ${m.label} chart`);
        b.addEventListener("click", () => window.openDetail(m.path)); row.appendChild(b);
      }
      detail.appendChild(row);
    }
    if (changed && A && !reduce) A.animate(detail.querySelectorAll(".d-row"), { opacity: [0, 1], translateX: [-8, 0], delay: A.stagger(50), duration: 300, ease: "outQuad" });
  }

  /* ---------- input ---------- */
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    S.drag = { x, y, yaw: S.yaw, pitch: S.pitch, moved: false, touch: e.pointerType === "touch", lx: x };
    cv.style.cursor = "grabbing";
  });
  cv.addEventListener("pointermove", (e) => {
    const [x, y] = local(e), d = S.drag;
    if (d) {
      const dx = x - d.x, dy = y - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        S.yaw = d.yaw + dx * 0.008;
        if (!d.touch) S.pitch = clamp(d.pitch + dy * 0.006, -0.6, 0.9);
        S.vyaw = (x - d.lx) * 0.008; d.lx = x;
      }
    } else {
      const id = pick(x, y);
      if (id !== S.hover) setHover(id);
    }
  });
  cv.addEventListener("pointerup", (e) => {
    const d = S.drag; S.drag = null;
    cv.style.cursor = S.hover ? "pointer" : "grab";
    if (d && !d.moved) { const [x, y] = local(e); const id = pick(x, y); if (id) select(id); else if (S.sel) select(S.sel); }
  });
  cv.addEventListener("pointercancel", () => { S.drag = null; });
  cv.addEventListener("pointerleave", () => { if (!S.drag) setHover(null); });
  cv.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") S.yaw -= 0.15; else if (k === "ArrowRight") S.yaw += 0.15;
    else if (k === "ArrowUp") S.pitch = clamp(S.pitch + 0.1, -0.6, 0.9); else if (k === "ArrowDown") S.pitch = clamp(S.pitch - 0.1, -0.6, 0.9);
    else if (k === "+" || k === "=") setExplode(S.target + 0.1); else if (k === "-") setExplode(S.target - 0.1);
    else if (k === "Escape") { S.sel = null; refreshPanel(); } else return;
    e.preventDefault();
  });

  const slider = $("explode");
  function setExplode(v, instant) {
    S.target = clamp(v);
    if (slider) slider.value = Math.round(S.target * 100);
    if (instant || reduce) S.explode = S.target;
  }
  if (slider) slider.addEventListener("input", () => setExplode(slider.value / 100));

  /* ---------- loop: runs only while the section is on screen ---------- */
  function step() {
    const k = reduce ? 1 : 0.16;
    S.explode += (S.target - S.explode) * (reduce ? 1 : 0.09);
    for (const p of PARTS) h[p.id] += ((S.hover === p.id || S.sel === p.id ? 1 : 0) - h[p.id]) * k;
    if (!S.drag) {
      S.yaw += S.vyaw; S.vyaw *= 0.94;
      if (!reduce && !S.hover && !S.sel && Math.abs(S.vyaw) < 0.0005) S.yaw += 0.0025;
    }
  }
  function frame() { if (!S.running) return; step(); draw(); requestAnimationFrame(frame); }
  function start() { if (S.running) return; S.running = true; requestAnimationFrame(frame); }

  buildPanel();
  refreshPanel();
  setHover(null);
  if ("IntersectionObserver" in window) {
    let seen = false;
    new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { start(); if (!seen) { seen = true; setTimeout(() => setExplode(0.7), reduce ? 0 : 350); } } else S.running = false;
      }
    }, { threshold: 0.15 }).observe($("spacecraft"));
  } else { start(); setExplode(0.7, true); }
  addEventListener("resize", () => { resize(); if (!S.running) draw(); });
  document.addEventListener("telemetry", () => { refreshPanel(); if (!S.running) draw(); });

  window.Craft = { // exposed for tests
    parts: PARTS.map((p) => p.id), pick, select, setHover, setExplode, stateOf: (id) => stateOf(byId[id]),
    render() { step(); draw(); }, center: (id) => (S.bounds[id] ? [S.bounds[id].cx, S.bounds[id].cy] : null),
    points: (id) => S.pp[id], size: () => [S.W, S.H],
    view(yaw, pitch) { S.yaw = yaw; S.pitch = pitch; S.vyaw = 0; },
    get selected() { return S.sel; }, get hovered() { return S.hover; }, get explode() { return S.explode; },
  };
})();
