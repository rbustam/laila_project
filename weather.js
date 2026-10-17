/* Laila — weather & time-of-day background.
   Asks the browser for your location once, reads the current weather from Open-Meteo (free, no key),
   and paints a soft blurred sky behind the app. If location or weather is unavailable it falls back to
   a time-of-day sky, and if that fails the normal background stays.
   Preview any scene: add ?wx=rain&phase=night to the address. wx: clear partly cloudy fog rain storm snow.
   phase: dawn day dusk night. */
(function () {
  const KEY_COORDS = "laila-coords";
  const KEY_WX = "laila-weather";
  const MIN = 60 * 1000;
  const root = document.createElement("div");
  root.id = "weatherBg";
  root.className = "weather-bg";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML =
    '<div class="wb-art"><div class="wb-sky"></div><div class="wb-orb"></div>' +
    '<div class="wb-clouds"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>' +
    '<div class="wb-stars"></div><div class="wb-precip"></div><div class="wb-flash"></div><div class="wb-scrim"></div>';
  document.body.prepend(root);

  let data = null; // { sky, sunrise, sunset, nextSunrise, offset } — times are "naive UTC" ms at the location

  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function skyFromCode(code, cloud) {
    if (code === 0 || code === 1) return cloud > 60 ? "partly" : "clear";
    if (code === 2) return "partly";
    if (code === 3) return "cloudy";
    if (code === 45 || code === 48) return "fog";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "cloudy";
  }

  function phaseAndProgress(d, nowNaive) {
    const { sunrise, sunset, nextSunrise } = d;
    const dayMs = 24 * 60 * MIN;
    if (!sunrise || !sunset) { // polar fallback: use clock hours
      const h = new Date(nowNaive).getUTCHours() + new Date(nowNaive).getUTCMinutes() / 60;
      const phase = h < 5.5 ? "night" : h < 7.5 ? "dawn" : h < 17.5 ? "day" : h < 19.5 ? "dusk" : "night";
      return { phase, progress: Math.min(1, Math.max(0, (h - 6) / 12)) };
    }
    let phase;
    if (nowNaive < sunrise - 45 * MIN) phase = "night";
    else if (nowNaive < sunrise + 60 * MIN) phase = "dawn";
    else if (nowNaive < sunset - 60 * MIN) phase = "day";
    else if (nowNaive < sunset + 45 * MIN) phase = "dusk";
    else phase = "night";
    let progress;
    if (nowNaive >= sunrise && nowNaive <= sunset) progress = (nowNaive - sunrise) / (sunset - sunrise);
    else if (nowNaive > sunset) progress = (nowNaive - sunset) / Math.max(1, (nextSunrise || sunrise + dayMs) - sunset);
    else progress = (nowNaive - (sunset - dayMs)) / Math.max(1, sunrise - (sunset - dayMs));
    return { phase, progress: Math.min(1, Math.max(0, progress)) };
  }


  /* ---- Auto contrast ----
     Works out how light/dark the current sky really is (including clouds and the sun/moon glow) and then
     picks (a) how strong the readability veil must be and (b) a text colour for small grey text, so words
     stay readable in every weather, time of day and theme. */
  const toRGB = (str) => {
    const m = String(str || "").trim().match(/#([0-9a-f]{6})|rgba?\(([^)]+)\)/i);
    if (!m) return [128, 128, 128, 1];
    if (m[1]) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
    const p = m[2].split(",").map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

  function adaptContrast() {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue(n).trim();
    const hazeO = parseFloat(v("--haze-o")) || 0;
    const orbO = parseFloat(v("--orb-o")) || 0;
    const haze = toRGB(v("--haze"));
    const stops = ["--sky-a", "--sky-b", "--sky-c"].map((n) => mix(toRGB(v(n)), haze, hazeO));
    const regions = stops.slice();
    const sky = root.dataset.sky;
    if (sky !== "clear") { // clouds: lighter by day, darker in rain/storm
      const c = toRGB(v("--cloud"));
      const dark = sky === "rain" || sky === "storm";
      stops.forEach((s) => { const m = mix(s, c, Math.min(1, c[3] * 0.9)); regions.push(dark ? m.map((x) => x * 0.62) : m); });
    }
    if (orbO > 0.15) { const core = toRGB(v("--orb-core")); regions.push(mix(stops[1], core, 0.55 * orbO)); }
    const lums = regions.map(lum);
    const dark = document.documentElement.dataset.theme === "dark";
    let veil, muted;
    if (dark) { // light text: veil must darken the brightest part of the sky
      const worst = regions[lums.indexOf(Math.max(...lums))];
      let a = 0.5;
      while (a < 0.9 && lum(mix(worst, [6, 8, 14], a)) > 0.07) a += 0.02;
      veil = "rgba(6,8,14," + a.toFixed(2) + ")";
      muted = "#d3d6dc";
    } else {    // dark text: veil must lighten the darkest part of the sky
      const worst = regions[lums.indexOf(Math.min(...lums))];
      let a = 0.4;
      while (a < 0.9 && lum(mix(worst, [255, 255, 255], a)) < 0.46) a += 0.02;
      veil = "rgba(255,255,255," + a.toFixed(2) + ")";
      muted = "#3b3f46";
    }
    document.documentElement.style.setProperty("--wb-scrim", veil);
    document.documentElement.style.setProperty("--wb-muted", muted);
  }
  new MutationObserver(adaptContrast).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function paint(sky, phase, progress) {
    root.dataset.sky = sky;
    root.dataset.phase = phase;
    const isNight = phase === "night";
    // orb travels in an arc: left → right, highest at the middle of its journey
    const x = 12 + progress * 76;
    const y = 62 - Math.sin(progress * Math.PI) * 44;
    root.style.setProperty("--orb-x", x.toFixed(1) + "%");
    root.style.setProperty("--orb-y", y.toFixed(1) + "%");
    root.classList.toggle("is-night", isNight);
    root.classList.add("ready");
    document.documentElement.classList.add("has-weather-bg");
    adaptContrast();
  }

  function render() {
    const params = new URLSearchParams(location.search);
    const wx = params.get("wx"), ph = params.get("phase");
    if (wx || ph) {
      const p = ph || "day";
      paint(wx || "clear", p, { dawn: .04, day: .5, dusk: .96, night: .5 }[p] ?? .5);
      return;
    }
    if (data) {
      const nowNaive = Date.now() + data.offset * 1000;
      const { phase, progress } = phaseAndProgress(data, nowNaive);
      paint(data.sky, phase, progress);
    } else { // no weather: sky from the local clock only
      const d = new Date();
      const h = d.getHours() + d.getMinutes() / 60;
      const phase = h < 5.5 ? "night" : h < 7.5 ? "dawn" : h < 17.5 ? "day" : h < 19.5 ? "dusk" : "night";
      paint("clear", phase, Math.min(1, Math.max(0, (h - 6) / 12)));
    }
  }

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 7000, maximumAge: 60 * MIN }
      );
    });
  }
  async function getIpPosition() {
    try {
      const res = await fetch("https://ipwho.is/");
      const j = await res.json();
      if (j && j.success !== false && typeof j.latitude === "number") return { lat: j.latitude, lon: j.longitude };
    } catch {}
    return null;
  }
  async function getCoords() {
    const cached = readJSON(KEY_COORDS);
    if (cached && Date.now() - cached.ts < 6 * 60 * MIN) return cached;
    const pos = (await getPosition()) || (await getIpPosition());
    if (pos) { const c = { ...pos, ts: Date.now() }; writeJSON(KEY_COORDS, c); return c; }
    return cached || null;
  }

  async function refresh() {
    try {
      const c = await getCoords();
      if (!c) return;
      const url = "https://api.open-meteo.com/v1/forecast?latitude=" + c.lat.toFixed(3) + "&longitude=" + c.lon.toFixed(3) +
        "&current=weather_code,cloud_cover&daily=sunrise,sunset&forecast_days=2&timezone=auto";
      const res = await fetch(url);
      if (!res.ok) throw new Error("weather " + res.status);
      const j = await res.json();
      const naive = (s) => (s ? Date.parse(s + ":00Z") || Date.parse(s + "Z") : null);
      data = {
        sky: skyFromCode(j.current.weather_code, j.current.cloud_cover),
        sunrise: naive(j.daily.sunrise[0]),
        sunset: naive(j.daily.sunset[0]),
        nextSunrise: naive(j.daily.sunrise[1]),
        offset: j.utc_offset_seconds || 0,
        savedAt: Date.now()
      };
      writeJSON(KEY_WX, data);
      render();
    } catch (e) { /* keep whatever is showing */ }
  }

  const saved = readJSON(KEY_WX);
  if (saved && Date.now() - saved.savedAt < 3 * 60 * MIN) data = saved;
  render();            // instant paint (cached weather, or the clock)
  refresh();           // then update from the live weather
  setInterval(render, 5 * MIN);
  setInterval(refresh, 20 * MIN);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { render(); if (!data || Date.now() - data.savedAt > 10 * MIN) refresh(); }
  });
  window.LailaWeather = { preview: (sky, phase, progress = .5) => paint(sky, phase, progress) };
})();
