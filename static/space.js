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
      for (const s of stars) {
        const py = (((s.y * H - y * dpr * s.z * 0.25) % H) + H) % H, px = s.x * W;
        ctx.globalAlpha = (reduce ? 0.6 : 0.4 + 0.35 * Math.sin((t / 1400) * s.z + s.p)) * (0.4 + s.z / 2);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(px, py, s.z * 1.2 * dpr, 0, 6.283); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    addEventListener("resize", resize);
    resize();
    if (!reduce) requestAnimationFrame(draw);
  });

  /* ---------- 2. hero: plain fade-in (Anime.js) + ring gauges ---------- */
  guard(() => {
    if (A && !reduce) A.animate(["#hero .eyebrow", "#title", "#hero .tagline", "#hero .rings", "#hero .ctas"], { opacity: [0, 1], translateY: [14, 0], delay: A.stagger(90), duration: 600, ease: "outQuad" });
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
    ["hero", "news", "flight", "telemetry", "console"].forEach((id) => $(id) && io.observe($(id)));
  });

  /* ---------- 4. scroll reveals (Motion inView) ---------- */
  guard(() => {
    if (!M || reduce) return;
    document.documentElement.classList.add("js-motion");
    M.inView(".reveal", (el) => {
      const cards = el.querySelectorAll(".card");
      M.animate(el, { opacity: [0, 1], y: [16, 0] }, { duration: 0.5, ease: "easeOut" });
      if (cards.length) M.animate(cards, { opacity: [0, 1], y: [12, 0] }, { duration: 0.4, delay: M.stagger(0.05, { startDelay: 0.1 }), ease: "easeOut" });
    }, { amount: 0.15 });
    // Cards sit inside a .reveal group; keep them visible until the group animates them.
    document.querySelectorAll(".group .card").forEach((c) => { c.style.opacity = 0; });
    setTimeout(() => document.querySelectorAll(".reveal, .group .card").forEach((el) => { if (getComputedStyle(el).opacity === "0" && el.getBoundingClientRect().top < innerHeight) el.style.opacity = 1; }), 4000);
  });

  /* ---------- 6. flight path: sticky stage that changes with scroll ---------- */
  const P0 = [150, 420], P1 = [350, 120], P2 = [640, 60], P3 = [860, 150]; // matches #track in the SVG
  const bez = (t, i) => { const u = 1 - t; return u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]; };
  const live = () => window.cockpit?.latest;
  const num = (path, d = 0) => { const v = path.split(".").reduce((o, k) => o?.[k], live()); return typeof v === "number" ? v.toFixed(d) : "--"; };
  const PHASES = [
    { color: "#3ddc97", title: "Normal operations",
      text: "Nine readings are checked every second against their limits.",
      chip: () => `Battery ${num("power.battery_percent", 1)}% · Cabin O2 ${num("cabin.o2_percent", 1)}%` },
    { color: "#ff5a4a", title: "A problem is detected",
      text: "A reading that jumps away from its recent pattern is flagged within about a second.",
      chip: () => { const a = live()?.anomalies?.[0]; return a ? `${a.metric.split(".")[1]} is ${a.direction} · z = ${a.z_score}` : "No active problem. Use Inject fault in the Assistant section."; } },
    { color: "#4f8de8", title: "The assistant answers",
      text: "The assistant reads the live data before it replies. Mission Control announces new problems in a separate voice.",
      chip: () => { const c = [...document.querySelectorAll(".msg .steps code")].slice(-3).map((e) => e.textContent); return c.length ? "Last data checks: " + c.join(", ") : "Ask the assistant a question to see its data checks."; } },
    { color: "#ffb020", title: "Alert and recovery",
      text: "The assistant can post an alert to the dashboard. The simulated fault then fades and monitoring resets.",
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
