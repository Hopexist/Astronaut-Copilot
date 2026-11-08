/* Visual layer: starfield, hero, scroll-driven flight path, reveals, card tilt.
   Libraries are optional polish: Anime.js (global `anime`) and Motion (global `Motion`).
   If either is missing the page still works, just without that animation. */
(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const osReduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reduce = osReduce && document.documentElement.dataset.motion !== "full";
  const A = window.anime && window.anime.animate ? window.anime : null;
  const M = window.Motion && Motion.animate && Motion.scroll && Motion.inView ? Motion : null;
  const guard = (fn) => { try { return fn(); } catch (e) { console.warn("space.js:", e); } };
  const G = window.gsap && window.ScrollTrigger ? window.gsap : null;

  /* ---------- 0. smooth scrolling: Lenis moves the page, GSAP's ticker drives it ----------
     Skipped for reduced motion. Nested scrollers (chat log, table, dialog) keep native scrolling. */
  let lenis = null;
  guard(() => {
    if (reduce || !window.Lenis) return;
    lenis = new Lenis({ lerp: 0.1, stopInertiaOnNavigate: true, respectReducedMotion: false }); // we only get here when motion is allowed (page opt-in covers an OS reduce setting) // scrollers that must stay native carry data-lenis-prevent
    window.lenis = lenis;
    document.addEventListener("click", (e) => { // in-page links glide to their section, below the sticky nav
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      const target = a && document.getElementById(a.getAttribute("href").slice(1));
      if (!target || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -56 });
      history.replaceState(null, "", "#" + target.id);
      target.focus({ preventScroll: true }); // keyboard users land where the link points
    });
    if (G) {
      G.registerPlugin(ScrollTrigger);
      lenis.on("scroll", ScrollTrigger.update);
      G.ticker.add((t) => lenis.raf(t * 1000));
      G.ticker.lagSmoothing(0);
    } else {
      const loop = (t) => { lenis.raf(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  });
  if (G && !window.Lenis) G.registerPlugin(ScrollTrigger);

  /* ---------- 1. starfield: parallax + twinkle + scroll-velocity streaks ---------- */
  guard(() => {
    const cv = $("stars"), ctx = cv.getContext("2d");
    let W = 0, H = 0, dpr = 1, stars = [];
    const seed = () => {
      stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 6500) }, () =>
        ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.9 + 0.1, p: Math.random() * 6.28 }));
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = Math.round(innerWidth * dpr); H = cv.height = Math.round(innerHeight * dpr);
      seed(); if (reduce) draw(0);
    };
    function draw(t) {
      const y = scrollY;
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        const py = (((s.y * H - y * dpr * (0.05 + s.z * s.z * 0.8)) % H) + H) % H, px = s.x * W; // depth: far stars barely move, near ones fly past
        ctx.globalAlpha = (reduce ? 0.6 : 0.4 + 0.35 * Math.sin((t / 1400) * s.z + s.p)) * (0.5 + s.z / 1.6);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(px, py, (0.4 + s.z * s.z * 2.2) * dpr, 0, 6.283); ctx.fill();
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
    ["hero", "news", "flight", "spacecraft", "telemetry", "analysis", "console"].forEach((id) => $(id) && io.observe($(id)));
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

  /* ---------- 8. scroll-driven space backdrop ----------
     Nebula layers crossfade as each section comes to the middle of the screen, Earth recedes, the Moon
     approaches and a spacecraft crosses the sky. The ship fades out while the flight section (which has
     its own ship) is on screen. Only opacity and transforms change, so scrolling stays smooth. */
  guard(() => {
    const bd = $("backdrop");
    if (!bd) return;
    const ids = ["hero", "flight", "spacecraft", "telemetry", "analysis", "console", "news"];
    const secs = ids.map($);
    if (secs.some((s) => !s)) return;
    const layers = ids.map((id) => bd.querySelector(`[data-for="${id}"]`));
    const earth = bd.querySelector(".bd-earth"), moon = bd.querySelector(".bd-moon"), ship = bd.querySelector(".bd-ship");
    let tops = [], bottoms = [], dirty = true, queued = false, builtH = 0, builtVH = 0;
    // Depth layers behind the content, each moving at its own fraction of the scroll: slow debris, big rocks at the
    // screen edges, and fast soft glows that read as being close to the camera. All are behind the page, never over data.
    const LAYERS = [["debris", 0.2, 16], ["rocks", 0.45, 3], ["bokeh", 0.9, 3]].map(([kind, speed, per]) => ({ kind, speed, per, el: bd.querySelector(`.bd-par[data-kind="${kind}"]`) }));
    const GLOWS = ["rgba(95,130,255,.5)", "rgba(185,163,255,.45)", "rgba(255,138,76,.35)", "rgba(61,220,151,.28)"];
    function buildLayers() {
      const sh = document.documentElement.scrollHeight;
      builtH = sh; builtVH = innerHeight;
      const small = Math.min(1, innerWidth / 1000);
      LAYERS.forEach(({ kind, speed, per, el }) => {
        let a = kind.length * 977; // fixed seed: the same sky every time
        const rnd = () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296;
        const H = innerHeight + Math.max(0, sh - innerHeight) * speed;
        el.style.height = H + "px";
        el.replaceChildren(...Array.from({ length: Math.round((H / innerHeight) * per) }, () => {
          const i = document.createElement("i"), size = kind === "debris" ? 5 + rnd() * 9 : kind === "rocks" ? (50 + rnd() * 90) * small : (70 + rnd() * 120) * small;
          const edge = rnd() < 0.5 ? -size * 0.45 - rnd() * 20 : null; // rocks hug the left or right edge
          i.style.cssText = `top:${(rnd() * H).toFixed(0)}px;width:${size.toFixed(0)}px;height:${(size * (0.7 + rnd() * 0.5)).toFixed(0)}px;` +
            (kind === "rocks" ? (edge !== null ? `left:${edge.toFixed(0)}px;` : `right:${(-size * 0.45 - rnd() * 20).toFixed(0)}px;`) : `left:${(rnd() * 100).toFixed(1)}vw;`) +
            (kind === "bokeh" ? `background:${GLOWS[Math.floor(rnd() * GLOWS.length)]};` : "") +
            `animation-duration:${(30 + rnd() * 60).toFixed(0)}s;animation-delay:${(-rnd() * 60).toFixed(0)}s;`;
          return i;
        }));
      });
    }
    const smooth = (t) => t * t * (3 - 2 * t);
    const measure = () => {
      tops = secs.map((s) => s.getBoundingClientRect().top + scrollY);
      bottoms = secs.map((s) => s.getBoundingClientRect().bottom + scrollY);
      dirty = false;
    };
    const path = (q) => [6 + 84 * q, 66 + 16 * Math.sin(q * Math.PI * 3) - 38 * q]; // ship position in vw, vh

    function frame() {
      queued = false;
      if (dirty) {
        measure();
        const sh = document.documentElement.scrollHeight;
        if (!builtH || innerHeight !== builtVH || Math.abs(sh - builtH) > builtH * 0.1) buildLayers();
      }
      const p = clamp(scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
      const mid = scrollY + innerHeight * 0.5;
      let i = bottoms.findIndex((b) => mid < b);
      if (i < 0) i = secs.length - 1;
      const t = clamp((mid - tops[i]) / Math.max(1, bottoms[i] - tops[i]));
      const w = ids.map(() => 0);
      if (t > 0.65 && i < secs.length - 1) { const u = smooth((t - 0.65) / 0.35); w[i] = 1 - u; w[i + 1] = u; } else w[i] = 1;
      layers.forEach((el, k) => {
        el.style.opacity = w[k].toFixed(3);
        if (!reduce) el.style.transform = `translate3d(0, ${(-p * (60 + k * 25)).toFixed(1)}px, 0)`;
      });
      LAYERS.forEach(({ speed, el }) => { el.style.transform = reduce ? "none" : `translate3d(0, ${(-scrollY * speed).toFixed(1)}px, 0)`; });
      const q = reduce ? 0.3 : p; // reduced motion: a fixed, still scene instead of one that moves with the scroll
      earth.style.transform = `translate3d(${(-q * 8).toFixed(2)}vw, ${(q * 60).toFixed(1)}vh, 0) scale(${(1 - 0.45 * q).toFixed(3)})`;
      const hand = 1 - w[1]; // the flight section draws its own Earth, Moon and ship, so the backdrop ones fade out there
      earth.style.opacity = ((0.9 - 0.55 * q) * hand).toFixed(3);
      moon.style.transform = `translate3d(0, ${(-12 * (1 - q)).toFixed(1)}vh, 0) scale(${(0.35 + q).toFixed(3)})`;
      moon.style.opacity = ((0.15 + 0.75 * q) * hand).toFixed(3);
      const [x, y] = path(q), [x2, y2] = path(Math.min(1, q + 0.01));
      const ang = (Math.atan2(((y2 - y) * innerHeight) / 100, ((x2 - x) * innerWidth) / 100) * 180) / Math.PI;
      ship.style.transform = `translate3d(${x.toFixed(2)}vw, ${y.toFixed(2)}vh, 0) rotate(${ang.toFixed(1)}deg)`;
      ship.style.opacity = (0.95 * hand).toFixed(3);
    }
    const request = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
    const remeasure = () => { dirty = true; request(); };
    addEventListener("scroll", request, { passive: true });
    addEventListener("resize", remeasure);
    document.addEventListener("news-rendered", remeasure);
    if (window.ResizeObserver) new ResizeObserver(remeasure).observe(document.querySelector("main"));
    frame();

    if (A && !reduce) { // Anime.js: engine flame and a slow atmosphere pulse (inner elements, so they never fight the scroll transforms)
      A.animate(bd.querySelector(".bd-flame"), { scaleX: [1, 0.55], opacity: [0.95, 0.5], duration: 140, ease: "linear", loop: true, alternate: true });
      A.animate(earth.querySelector("i"), { opacity: [0.55, 1], duration: 3200, ease: "inOutSine", loop: true, alternate: true });
    }
  });

  /* ---------- 9. section titles reveal word by word (Skiper UI style) ---------- */
  guard(() => {
    document.querySelectorAll(".sec-head h2").forEach((h) => {
      const words = h.textContent.trim().split(/\s+/);
      h.replaceChildren(...words.flatMap((word, i) => {
        const s = document.createElement("span");
        s.className = "w"; s.textContent = word;
        return i ? [document.createTextNode(" "), s] : [s];
      }));
    });
    if (reduce) return;
    if (G) { // blur text: each word drops in out of a blur, one after another
      document.querySelectorAll(".sec-head h2").forEach((h) => ScrollTrigger.create({
        trigger: h, start: "top 88%", once: true,
        onEnter: () => G.fromTo(h.querySelectorAll(".w"), { opacity: 0, y: -22, filter: "blur(10px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.75, stagger: 0.09, ease: "power3.out", clearProps: "filter" }),
      }));
      document.addEventListener("news-rendered", () => ScrollTrigger.refresh());
    } else if (M) M.inView(".sec-head h2", (h) => {
      M.animate(h.querySelectorAll(".w"), { opacity: [0, 1], y: [28, 0] }, { duration: 0.6, delay: M.stagger(0.07), ease: "easeOut" });
    }, { amount: 0.6 });
    setTimeout(() => document.querySelectorAll(".sec-head h2 .w").forEach((w) => { if (getComputedStyle(w).opacity === "0" && w.getBoundingClientRect().top < innerHeight) w.style.opacity = 1; }), 4000);
  });

  /* ---------- 10. cursor spotlight on glass surfaces (Cult UI style) ---------- */
  guard(() => {
    if (reduce) return;
    const SEL = ".panel, .story, .card, .an-tile, .group";
    document.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || !e.target.closest) return;
      const els = [];
      for (let el = e.target.closest(SEL); el; el = el.parentElement && el.parentElement.closest(SEL)) els.push(el);
      const rects = els.map((el) => el.getBoundingClientRect()); // read everything, then write: no layout thrash
      els.forEach((el, i) => {
        el.style.setProperty("--mx", e.clientX - rects[i].left + "px");
        el.style.setProperty("--my", e.clientY - rects[i].top + "px");
      });
    }, { passive: true });
  });

  /* ---------- 12. scroll-velocity marquee (React Bits style) ----------
     The band drifts on its own, then speeds up, reverses and skews with how fast and which way you scroll. */
  guard(() => {
    const track = document.querySelector(".mq-track");
    if (!track || reduce || !G) return; // reduced motion: the text just sits there
    let x = 0, dir = -1;
    G.ticker.add(() => {
      const v = lenis ? lenis.velocity : 0, half = track.children[0].offsetWidth;
      if (Math.abs(v) > 0.2) dir = v > 0 ? -1 : 1;
      x += dir * (0.7 + Math.min(Math.abs(v), 50) * 0.6);
      if (x > 0) x -= half;
      if (x <= -half) x += half;
      track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0) skewX(${clamp(-v * 0.25, -10, 10).toFixed(2)}deg)`;
    });
  });

  /* ---------- 13. magnetic buttons (React Bits "Magnet"): the hero buttons lean toward the cursor ---------- */
  guard(() => {
    if (reduce || !G || !matchMedia("(pointer: fine)").matches) return;
    document.querySelectorAll(".ctas button").forEach((b) => {
      const mx = G.quickTo(b, "x", { duration: 0.4, ease: "power3.out" }), my = G.quickTo(b, "y", { duration: 0.4, ease: "power3.out" });
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.25); my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      b.addEventListener("pointerleave", () => { mx(0); my(0); });
    });
  });

  /* ---------- 11. motion switch: only shown when the OS asks for reduced motion ---------- */
  guard(() => {
    const btn = $("motionBtn");
    if (!btn || !osReduce) return;
    const full = document.documentElement.dataset.motion === "full";
    btn.hidden = false;
    btn.textContent = full ? "Reduce motion" : "Enable motion";
    btn.addEventListener("click", () => {
      try { full ? localStorage.removeItem("motion") : localStorage.setItem("motion", "full"); } catch (_) {}
      location.reload();
    });
  });

  /* ---------- 7. hero calls to action ---------- */
  guard(() => {
    const go = () => (lenis ? lenis.scrollTo($("console"), { offset: -56 }) : $("console").scrollIntoView({ behavior: reduce ? "auto" : "smooth" }));
    $("ctaDemo").addEventListener("click", () => { go(); setTimeout(() => window.runDemo && window.runDemo(), reduce ? 0 : 800); });
    $("ctaTalk").addEventListener("click", () => { go(); setTimeout(() => $("q").focus({ preventScroll: true }), reduce ? 0 : 800); });
  });
})();
