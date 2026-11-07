/* Visual layer: starfield, hero, scroll-driven flight path, reveals, card tilt.
   Libraries are optional polish: Anime.js (global `anime`) and Motion (global `Motion`).
   If either is missing the page still works, just without that animation. */
(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const A = window.anime && window.anime.animate ? window.anime : null;
  const M = window.Motion && Motion.animate && Motion.scroll && Motion.inView ? Motion : null;
  const guard = (fn) => { try { return fn(); } catch (e) { console.warn("space.js:", e); } };

  /* ---------- 1. starfield: parallax + twinkle + scroll-velocity streaks ---------- */
  guard(() => {
    const cv = $("stars"), ctx = cv.getContext("2d");
    let W = 0, H = 0, dpr = 1, stars = [], vel = 0, lastY = scrollY;
    const seed = () => {
      stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 8000) }, () =>
        ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.9 + 0.1, p: Math.random() * 6.28 }));
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = Math.round(innerWidth * dpr); H = cv.height = Math.round(innerHeight * dpr);
      seed(); if (reduce) draw(0);
    };
    function draw(t) {
      const y = scrollY;
      vel += ((y - lastY) - vel) * 0.15; lastY = y;
      ctx.clearRect(0, 0, W, H);
      const streak = reduce ? 0 : Math.min(Math.abs(vel) * 0.9, 60);
      for (const s of stars) {
        const py = (((s.y * H - y * dpr * s.z * 0.25) % H) + H) % H, px = s.x * W;
        ctx.globalAlpha = (reduce ? 0.7 : 0.45 + 0.45 * Math.sin((t / 900) * s.z + s.p)) * (0.5 + s.z / 2);
        ctx.fillStyle = s.z > 0.8 ? "#cfe0ff" : "#ffffff";
        const r = s.z * 1.4 * dpr;
        if (streak > 2) ctx.fillRect(px, py, r, r + streak * s.z * dpr);
        else { ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill(); }
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    addEventListener("resize", resize);
    resize();
    if (!reduce) requestAnimationFrame(draw);
  });

  /* ---------- 2. hero: letter-by-letter title (Anime.js) + ring gauges ---------- */
  guard(() => {
    const title = $("title"), text = title.dataset.text || title.textContent.trim();
    title.setAttribute("aria-label", text);
    title.textContent = "";
    [...text].forEach((ch, i, all) => {
      const s = document.createElement("span");
      s.className = "ch"; s.setAttribute("aria-hidden", "true");
      s.textContent = ch === " " ? " " : ch;
      s.style.color = `hsl(${215 + (60 * i) / (all.length - 1)} 92% 84%)`;
      title.appendChild(s);
    });
    if (A && !reduce) A.animate("#title .ch", { translateY: [60, 0], rotate: [10, 0], opacity: [0, 1], delay: A.stagger(45), duration: 900, ease: "outExpo" });
  });

  const RINGS = [
    { id: "ring-o2", path: "cabin.o2_percent", frac: (v) => v / 25, dec: 1 },
    { id: "ring-battery", path: "power.battery_percent", frac: (v) => v / 100, dec: 0 },
    { id: "ring-fuel", path: "propulsion.fuel_percent", frac: (v) => v / 100, dec: 0 },
  ];
  let ringsDrawn = false;
  function updateRings(t) {
    for (const r of RINGS) {
      const el = $(r.id); if (!el) continue;
      const v = r.path.split(".").reduce((o, k) => o?.[k], t);
      if (typeof v !== "number") continue;
      const off = 1 - clamp(r.frac(v));
      const arc = el.querySelector(".val");
      el.querySelector(".num b").textContent = v.toFixed(r.dec);
      el.dataset.state = window.cockpit?.cards?.[r.path]?.state === "bad" ? "bad" : window.cockpit?.cards?.[r.path]?.state === "warn" ? "warn" : "ok";
      if (A && !reduce) A.animate(arc, { strokeDashoffset: off, duration: ringsDrawn ? 600 : 1500, delay: ringsDrawn ? 0 : 500, ease: "outQuad" });
      else arc.setAttribute("stroke-dashoffset", off);
    }
    ringsDrawn = true;
  }
  document.addEventListener("telemetry", (e) => guard(() => updateRings(e.detail)));

  /* ---------- 3. scroll progress bar (Motion scroll-linked animation) + nav spy ---------- */
  guard(() => {
    if (M) M.scroll(M.animate($("progress"), { scaleX: [0, 1] }));
    else addEventListener("scroll", () => { $("progress").style.transform = `scaleX(${scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)})`; }, { passive: true });
    const links = [...document.querySelectorAll(".links a")];
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.dataset.s === en.target.id));
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["hero", "flight", "telemetry", "console"].forEach((id) => $(id) && io.observe($(id)));
  });

  /* ---------- 4. scroll reveals (Motion inView) ---------- */
  guard(() => {
    if (!M || reduce) return;
    document.documentElement.classList.add("js-motion");
    M.inView(".reveal", (el) => {
      const cards = el.querySelectorAll(".card");
      M.animate(el, { opacity: [0, 1], y: [34, 0] }, { duration: 0.7, ease: "easeOut" });
      if (cards.length) M.animate(cards, { opacity: [0, 1], y: [26, 0], scale: [0.96, 1] }, { duration: 0.6, delay: M.stagger(0.07, { startDelay: 0.15 }), ease: "easeOut" });
    }, { amount: 0.15 });
    // Cards sit inside a .reveal group; keep them visible until the group animates them.
    document.querySelectorAll(".group .card").forEach((c) => { c.style.opacity = 0; });
    setTimeout(() => document.querySelectorAll(".reveal, .group .card").forEach((el) => { if (getComputedStyle(el).opacity === "0" && el.getBoundingClientRect().top < innerHeight) el.style.opacity = 1; }), 4000);
  });

  /* ---------- 5. card spotlight + tilt (pointer follows) ---------- */
  guard(() => {
    if (reduce) return;
    const root = $("telemetry");
    root.addEventListener("pointermove", (e) => {
      const card = e.target.closest(".card"); if (!card) return;
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", x * 100 + "%"); card.style.setProperty("--my", y * 100 + "%");
      card.style.setProperty("--rx", (0.5 - y) * 9 + "deg"); card.style.setProperty("--ry", (x - 0.5) * 11 + "deg");
    });
    root.addEventListener("pointerout", (e) => {
      const card = e.target.closest(".card"); if (!card || card.contains(e.relatedTarget)) return;
      card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg");
    });
  });

  /* ---------- 6. flight path: sticky stage that changes with scroll ---------- */
  const P0 = [150, 420], P1 = [350, 120], P2 = [640, 60], P3 = [860, 150]; // matches #track in the SVG
  const bez = (t, i) => { const u = 1 - t; return u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]; };
  const live = () => window.cockpit?.latest;
  const num = (path, d = 0) => { const v = path.split(".").reduce((o, k) => o?.[k], live()); return typeof v === "number" ? v.toFixed(d) : "--"; };
  const PHASES = [
    { color: "#3ddc97", title: "Nominal operations",
      text: "Nine telemetry streams are tracked at 1 Hz against nominal limits, so the crew sees one calm picture of the ship.",
      chip: () => `Battery ${num("power.battery_percent", 1)}% · O2 ${num("cabin.o2_percent", 1)}%` },
    { color: "#ff4d5e", title: "Anomaly detected",
      text: "A robust z-score (median and MAD) flags sudden deviations in about a second, even after earlier faults.",
      chip: () => { const a = live()?.anomalies?.[0]; return a ? `${a.metric.split(".")[1]} ${a.direction} · z=${a.z_score}` : "No active anomaly. Inject a fault in the console."; } },
    { color: "#5b86ff", title: "Copilot responds",
      text: "Gemini calls tools on live data, then Mission Control and the copilot speak the result in two different voices.",
      chip: () => { const c = [...document.querySelectorAll(".msg .steps code")].slice(-3).map((e) => e.textContent); return c.length ? "Last tools: " + c.join(" → ") : "Ask the copilot to see its tool calls."; } },
    { color: "#ffb020", title: "Alarm and recovery",
      text: "raise_alarm puts the problem on the dashboard; the injected fault then fades and the detector re-baselines.",
      chip: () => `${live()?.alerts?.length ?? 0} active alert(s)` },
  ];
  let phase = -1;
  function enterPhase(ph) {
    phase = ph;
    const stage = $("stage"), p = PHASES[ph];
    stage.dataset.phase = ph; stage.style.setProperty("--phase", p.color);
    $("phaseNum").textContent = ph + 1; $("phaseTitle").textContent = p.title; $("phaseText").textContent = p.text;
    $("phaseChip").textContent = p.chip();
    document.querySelectorAll(".dots span").forEach((d, i) => d.classList.toggle("on", i <= ph));
    if (A && !reduce) A.animate(["#phaseTitle", "#phaseText", "#phaseChip"], { opacity: [0, 1], translateY: [12, 0], delay: A.stagger(70), duration: 500, ease: "outQuad" });
  }
  function setProgress(p) {
    p = clamp(p);
    const track = $("track");
    let x, y, ang;
    if (track.getTotalLength && track.getPointAtLength) {
      const L = track.getTotalLength(), a = track.getPointAtLength(p * L), b = track.getPointAtLength(Math.min(L, p * L + 2));
      x = a.x; y = a.y; ang = Math.atan2(b.y - a.y, b.x - a.x);
    } else {
      x = bez(p, 0); y = bez(p, 1);
      ang = Math.atan2(bez(Math.min(1, p + 0.01), 1) - y, bez(Math.min(1, p + 0.01), 0) - x);
    }
    $("craft").setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((ang * 180) / Math.PI).toFixed(1)})`);
    $("trackDone").setAttribute("stroke-dashoffset", (1 - p).toFixed(4));
    const sig = $("signal"); sig.setAttribute("x1", x.toFixed(1)); sig.setAttribute("y1", y.toFixed(1));
    $("moon").style.transform = `scale(${(0.72 + 0.5 * p).toFixed(3)})`;
    $("earth").style.transform = `scale(${(1 - 0.22 * p).toFixed(3)})`;
    $("dist").textContent = Math.round(p * 384400).toLocaleString() + " km";
    const ph = Math.min(3, Math.floor(p * 4));
    if (ph !== phase) enterPhase(ph);
  }
  guard(() => {
    const flight = $("flight");
    setProgress(0);
    if (M) M.scroll((progress) => setProgress(progress), { target: flight, offset: ["start start", "end end"] });
    else addEventListener("scroll", () => { const r = flight.getBoundingClientRect(); setProgress(-r.top / Math.max(1, r.height - innerHeight)); }, { passive: true });
    setInterval(() => { if (phase >= 0) $("phaseChip").textContent = PHASES[phase].chip(); }, 500);
  });
  window.Flight = { setProgress, get phase() { return phase; } }; // exposed for tests

  /* ---------- 7. hero calls to action ---------- */
  guard(() => {
    const go = () => $("console").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    $("ctaDemo").addEventListener("click", () => { go(); setTimeout(() => window.runDemo && window.runDemo(), reduce ? 0 : 800); });
    $("ctaTalk").addEventListener("click", () => { go(); setTimeout(() => $("q").focus({ preventScroll: true }), reduce ? 0 : 800); });
  });
})();
