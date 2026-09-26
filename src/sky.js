(() => {
  const TAU = Math.PI * 2;
  const root = document.documentElement;
  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const hudTime = document.getElementById('hudTime');
  const hudWx = document.getElementById('hudWx');
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = reduceMQ.matches;
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', e => { reduce = e.matches; });
  const coarse = matchMedia('(pointer: coarse)').matches;

  /* ---------- helpers ---------- */
  let seed = 20260925;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.round(clamp(a, 0, 1) * 100) / 100})`;
  const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const toHex = c => '#' + c.map(v => clamp(v | 0, 0, 255).toString(16).padStart(2, '0')).join('');

  const fmt = h => {
    const total = Math.round((((h % 24) + 24) % 24) * 60);
    const H24 = Math.floor(total / 60) % 24, mm = total % 60;
    return `${H24 % 12 || 12}:${String(mm).padStart(2, '0')} ${H24 < 12 ? 'am' : 'pm'}`;
  };

  /* ---------- the day ---------- */
  // hour: [zenith, middle, horizon]
  const SKY = [
    [4.5,  '#070b1f', '#141a3d', '#2a2c5c'],
    [5.4,  '#121a45', '#2d3170', '#6b4a82'],
    [6.1,  '#2a3a7e', '#7a5f9e', '#f19a78'],
    [6.8,  '#4a78c2', '#9fb6dd', '#ffd3a0'],
    [8.0,  '#3f8ad8', '#86bfe9', '#d6ecf5'],
    [12.0, '#2a7fdc', '#5ea8ea', '#b6e0f7'],
    [15.5, '#3486d4', '#6fb0e3', '#cfe6ef'],
    [17.3, '#4d7cc4', '#98aee0', '#ffd9a0'],
    [18.3, '#3d4a94', '#b0709a', '#ff9a62'],
    [18.9, '#2a2a6a', '#6a3f7c', '#ff6f5a'],
    [19.6, '#161a48', '#3a2a62', '#7a3f6a'],
    [20.6, '#0a0f2c', '#161c44', '#2a2550'],
    [23.6, '#04060f', '#0a0e22', '#141a36'],
  ].map(([h, a, b, c]) => ({ h, c: [hex(a), hex(b), hex(c)] }));

  function sampleSky(h) {
    if (h <= SKY[0].h) return SKY[0].c;
    for (let i = 1; i < SKY.length; i++) {
      if (h <= SKY[i].h) {
        const A = SKY[i - 1], B = SKY[i], t = smooth(A.h, B.h, h);
        return A.c.map((col, k) => mix(col, B.c[k], t));
      }
    }
    return SKY[SKY.length - 1].c;
  }

  // accent hue drifts through the day (values unwrap past 360 on purpose)
  const HUE = [[4.5, 255], [6, 335], [7.3, 380], [9.5, 520], [12, 570], [15, 545], [17.5, 385], [18.8, 345], [20, 275], [23.6, 225]];
  function sample1(arr, h) {
    if (h <= arr[0][0]) return arr[0][1];
    for (let i = 1; i < arr.length; i++) {
      if (h <= arr[i][0]) return lerp(arr[i - 1][1], arr[i][1], (h - arr[i - 1][0]) / (arr[i][0] - arr[i - 1][0]));
    }
    return arr[arr.length - 1][1];
  }

  const SUNRISE = 6.1, SUNSET = 18.9;
  const sunP = h => (h - SUNRISE) / (SUNSET - SUNRISE);
  const elevOf = h => Math.sin(Math.PI * sunP(h));

  /* ---------- scene pieces ---------- */
  let W = 0, H = 0, DPR = 1;

  const stars = Array.from({ length: 280 }, () => {
    const big = rnd() < 0.08;
    const tint = rnd();
    return {
      x: rnd(), y: Math.pow(rnd(), 1.3) * 0.82,
      r: big ? 1.3 + rnd() * 0.9 : 0.4 + rnd() * 0.8,
      tw: 0.6 + rnd() * 2.2, ph: rnd() * TAU,
      c: tint < 0.15 ? [255, 222, 190] : tint < 0.35 ? [195, 212, 255] : [255, 255, 255],
    };
  });
  let shooters = [];

  const hills = [0, 1, 2].map(i => {
    const base = [0.79, 0.845, 0.915][i], amp = [0.034, 0.027, 0.022][i];
    const waves = Array.from({ length: 4 }, (_, k) => ({ f: (1 + k * 1.6 + rnd()) * (1 + i * 0.6), p: rnd() * TAU, a: amp / (k + 1) }));
    const trees = [];
    if (i > 0) {
      const n = i === 1 ? 28 : 12;
      for (let k = 0; k < n; k++) trees.push({ x: rnd(), h: (i === 1 ? 0.02 : 0.032) * (0.6 + rnd() * 0.8) });
    }
    return { base, waves, trees };
  });
  const hillY = (hl, u) => { let y = hl.base; for (const w of hl.waves) y += Math.sin(u * w.f * Math.PI + w.p) * w.a; return y; };

  function makeCloud(i) {
    const puffs = [];
    const n = 5 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1), hump = Math.sin(t * Math.PI);
      puffs.push({ dx: ((t - 0.5) * 1.9 + (rnd() - 0.5) * 0.25) * 90, dy: (0.25 - hump * 0.55 + (rnd() - 0.5) * 0.2) * 90, r: 30 + hump * 38 + rnd() * 14 });
    }
    for (let k = 0; k < 3; k++) puffs.push({ dx: (rnd() - 0.5) * 150, dy: 22 + rnd() * 8, r: 30 + rnd() * 12 });
    puffs.sort((a, b) => b.dy - a.dy);
    return { x: rnd() * 1.6 - 0.3, y: 0.05 + rnd() * 0.5, s: 0.55 + rnd() * 0.9, puffs, v: 6 + rnd() * 10, th: i < 3 ? 0 : (i - 2) / 10 };
  }
  const clouds = Array.from({ length: 13 }, (_, i) => makeCloud(i));

  const flies = Array.from({ length: 28 }, () => ({ x: rnd(), y: 0.8 + rnd() * 0.18, a: rnd() * TAU, sp: 0.01 + rnd() * 0.02, ph: rnd() * TAU, f: 0.6 + rnd() * 1.2 }));
  const flySprite = document.createElement('canvas');
  flySprite.width = flySprite.height = 48;
  {
    const g = flySprite.getContext('2d');
    const r = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    r.addColorStop(0, 'rgba(250,255,190,1)');
    r.addColorStop(0.18, 'rgba(220,255,130,.85)');
    r.addColorStop(1, 'rgba(180,255,90,0)');
    g.fillStyle = r; g.fillRect(0, 0, 48, 48);
  }

  let moonSprite = null, moonR = 20;
  function buildMoon() {
    moonR = clamp(Math.min(W, H) * 0.03, 16, 32);
    const size = moonR * 2 + 4, px = Math.ceil(size * DPR);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.scale(px / size, px / size);
    const cx = moonR + 2;
    const grd = g.createRadialGradient(cx - moonR * 0.3, cx - moonR * 0.3, moonR * 0.1, cx, cx, moonR);
    grd.addColorStop(0, '#fffbea'); grd.addColorStop(1, '#e6dcbc');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cx, moonR, 0, TAU); g.fill();
    g.fillStyle = 'rgba(150,140,115,.2)';
    [[-0.3, -0.2, 0.28], [0.2, 0.15, 0.22], [-0.05, 0.42, 0.16], [0.35, -0.3, 0.12]].forEach(([dx, dy, r]) => {
      g.beginPath(); g.arc(cx + dx * moonR, cx + dy * moonR, r * moonR, 0, TAU); g.fill();
    });
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,.93)';
    g.beginPath(); g.arc(cx + moonR * 0.58, cx - moonR * 0.2, moonR * 0.88, 0, TAU); g.fill();
    moonSprite = c;
  }

  let drops = [];
  function newDrop(scatter) {
    const z = 0.35 + Math.random() * 0.65;
    return { x: Math.random() * (W + 300) - 150, y: scatter ? Math.random() * H : -Math.random() * 60, z, len: (10 + Math.random() * 16) * z, v: (650 + Math.random() * 450) * z };
  }
  function buildDrops() {
    const max = Math.round(520 * clamp(W / 1200, 0.45, 1.4));
    drops = Array.from({ length: max }, () => newDrop(true));
  }

  /* ---------- weather ---------- */
  const STATES = {
    clear:  { cover: 0.06, rain: 0,   storm: 0,   wind: 0.12, label: 'Clear',  dur: [16, 32] },
    cloudy: { cover: 0.52, rain: 0,   storm: 0,   wind: 0.3,  label: 'Cloudy', dur: [10, 20] },
    rain:   { cover: 0.8,  rain: 0.5, storm: 0.1, wind: 0.4,  label: 'Rain',   dur: [12, 24] },
    storm:  { cover: 1,    rain: 1,   storm: 1,   wind: 0.85, label: 'Storm',  dur: [9, 18] },
  };
  const NEXT = {
    clear:  { clear: 0.25, cloudy: 0.45, rain: 0.2, storm: 0.1 },
    cloudy: { clear: 0.35, cloudy: 0.15, rain: 0.32, storm: 0.18 },
    rain:   { clear: 0.15, cloudy: 0.3, rain: 0.2, storm: 0.35 },
    storm:  { clear: 0.15, cloudy: 0.3, rain: 0.55 },
  };
  const MODES = ['auto', 'clear', 'cloudy', 'rain', 'storm'];
  let mode = 'auto', autoState = 'clear', autoTimer = rand(9, 14);
  const wx = { cover: 0.06, rain: 0, storm: 0, wind: 0.12 };

  // weather carries across pages in the same tab
  const WX_KEY = 'daybook-weather';
  try {
    const saved = JSON.parse(sessionStorage.getItem(WX_KEY) || 'null');
    if (saved && MODES.includes(saved.mode) && STATES[saved.autoState]) {
      mode = saved.mode; autoState = saved.autoState;
      autoTimer = clamp(+saved.autoTimer || 10, 2, 40);
      for (const k in wx) if (Number.isFinite(saved.wx?.[k])) wx[k] = clamp(saved.wx[k], 0, 1);
    }
  } catch (e) { /* storage unavailable: start fresh */ }
  addEventListener('pagehide', () => {
    try { sessionStorage.setItem(WX_KEY, JSON.stringify({ mode, autoState, autoTimer, wx })); } catch (e) { /* ignore */ }
  });

  function pick(from) {
    const w = NEXT[from]; const r = Math.random(); let acc = 0;
    for (const k in w) { acc += w[k]; if (r <= acc) return k; }
    return 'clear';
  }
  function stepWeather(dt) {
    if (mode === 'auto') {
      autoTimer -= dt;
      if (autoTimer <= 0) { autoState = pick(autoState); autoTimer = rand(...STATES[autoState].dur); }
    }
    const s = STATES[mode === 'auto' ? autoState : mode];
    const k = 1 - Math.exp(-dt / 3.2);
    wx.cover += (s.cover - wx.cover) * k;
    wx.storm += (s.storm - wx.storm) * k;
    wx.wind += (s.wind - wx.wind) * k;
    const rainTarget = s.rain * smooth(0.55, 0.8, wx.cover); // rain only falls once the clouds are in
    wx.rain += (rainTarget - wx.rain) * (1 - Math.exp(-dt / (rainTarget > wx.rain ? 3 : 2)));
  }

  let flash = 0, flicker = 0, bolt = null, strikeT = rand(2, 5);
  function strike() {
    let x = rand(W * 0.15, W * 0.9), y = H * rand(0.04, 0.12);
    const pts = [[x, y]], yEnd = H * rand(0.55, 0.78);
    while (y < yEnd) { y += rand(12, 34); x += rand(-22, 22); pts.push([x, y]); }
    const branches = [];
    for (let b = 0; b < 2; b++) {
      const start = pts[Math.floor(rand(2, Math.max(3, pts.length * 0.6)))] || pts[0];
      let bx = start[0], by = start[1];
      const bp = [[bx, by]], dir = Math.random() < 0.5 ? -1 : 1, n = Math.floor(rand(4, 8));
      for (let k = 0; k < n; k++) { by += rand(10, 26); bx += dir * rand(6, 24); bp.push([bx, by]); }
      branches.push(bp);
    }
    bolt = { pts, branches, life: 0.22 };
    flash = 1;
    flicker = Math.random() < 0.55 ? 0.13 : 0; // at most two flashes per strike
  }
  function stepLightning(dt) {
    if (!reduce && wx.storm > 0.55) {
      strikeT -= dt;
      if (strikeT <= 0) { strike(); strikeT = rand(3.2, 9); }
    }
    flash = Math.max(0, flash - dt * 4.5);
    if (flicker > 0) { flicker -= dt; if (flicker <= 0) flash = 0.75; }
    if (bolt) { bolt.life -= dt; if (bolt.life <= 0) bolt = null; }
  }

  /* ---------- scroll → hour ---------- */
  let anchors = [];
  function measure() {
    const sy = scrollY;
    anchors = [...document.querySelectorAll('[data-hour]')].map(el => {
      const r = el.getBoundingClientRect();
      return { y: r.top + sy + r.height / 2, h: parseFloat(el.dataset.hour) };
    }).sort((a, b) => a.y - b.y);
  }
  function targetHour() {
    if (!anchors.length) return 12;
    const line = scrollY + innerHeight / 2;
    if (line <= anchors[0].y) return anchors[0].h;
    for (let i = 1; i < anchors.length; i++) {
      if (line <= anchors[i].y) {
        const A = anchors[i - 1], B = anchors[i];
        return lerp(A.h, B.h, (line - A.y) / (B.y - A.y));
      }
    }
    return anchors[anchors.length - 1].h;
  }

  /* ---------- theme ---------- */
  const cache = {};
  const setVar = (k, v) => { if (cache[k] !== v) { root.style.setProperty(k, v); cache[k] = v; } };
  let themeTick = 0;

  function applyTheme(h, sky, L, light, dt) {
    const Le = L * (1 - 0.4 * smooth(0.35, 1, wx.cover) - 0.15 * wx.storm);
    const d = smooth(0.34, 0.5, Le);
    const ink = mix([234, 236, 248], [20, 27, 44], d);
    const pane = mix(mix([11, 15, 36], [255, 255, 255], d), sky[1], 0.1);
    setVar('--ink', rgba(ink));
    setVar('--muted', rgba(ink, 0.7));
    setVar('--rule', rgba(ink, 0.14));
    setVar('--pane', rgba(pane, lerp(0.56, 0.64, d)));
    setVar('--pane-edge', rgba(mix([150, 165, 230], [255, 255, 255], d), lerp(0.16, 0.6, d)));
    const hue = ((sample1(HUE, h) % 360) + 360) % 360;
    setVar('--accent', `hsl(${hue | 0} ${Math.round(lerp(75, 64, d))}% ${Math.round(lerp(78, 34, d))}%)`);
    const sd = smooth(0.47, 0.53, lum(sky[1]));
    setVar('--sky-ink', rgba(mix([246, 244, 255], [14, 22, 42], sd)));
    setVar('--sky-halo', rgba(mix([4, 6, 18], [255, 255, 255], sd), lerp(0.62, 0.5, sd)));
    const st = smooth(0.47, 0.53, lum(sky[0])); // the top bar sits against the zenith, not the middle of the sky
    setVar('--sky-ink-top', rgba(mix([246, 244, 255], [14, 22, 42], st)));
    setVar('--sky-halo-top', rgba(mix([4, 6, 18], [255, 255, 255], st), lerp(0.62, 0.5, st)));
    setVar('--bg', rgba(sky[2]));
    setVar('--glow', light.c);
    setVar('--light-angle', Math.round(light.angle) + 'deg');
    themeTick += dt;
    if (themeTick > 0.4 && metaTheme) { themeTick = 0; const tc = toHex(sky[0]); if (metaTheme.content !== tc) metaTheme.content = tc; }
  }

  /* ---------- HUD ---------- */
  const CLOUD = '<path d="M6.5 19H17A4 4 0 0 0 17.6 11.05A5.5 5.5 0 0 0 7.3 9.6A4.75 4.75 0 0 0 6.5 19Z" fill="currentColor"/>';
  const ICON = {
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4A9 9 0 0 0 20 14.5Z" fill="currentColor"/></svg>',
    cloudy: `<svg viewBox="0 0 24 24" aria-hidden="true">${CLOUD}</svg>`,
    rain: `<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(0 -3)">${CLOUD}</g><path d="M9 18.5l-1 3M13 18.5l-1 3M17 18.5l-1 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    storm: `<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(0 -3)">${CLOUD}</g><path d="M12.8 16.5l-2.3 3.4h2.7l-1.7 3.1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  let lastLabel = '', lastTime = '', isNight = true;
  function updateHud(h) {
    const t = fmt(h);
    if (t !== lastTime) { hudTime.textContent = t; lastTime = t; }
    const st = mode === 'auto' ? autoState : mode;
    const icon = st === 'clear' ? (isNight ? ICON.moon : ICON.sun) : ICON[st];
    const text = STATES[st].label + (mode === 'auto' ? '' : ' (held)');
    const key = st + isNight + text;
    if (key === lastLabel) return;
    lastLabel = key;
    hudWx.innerHTML = icon + '<span>' + text + '</span>';
    hudWx.setAttribute('aria-label', mode === 'auto'
      ? `Weather: ${STATES[st].label}, changing on its own. Change the weather.`
      : `Weather held at ${STATES[st].label}. Change the weather.`);
  }
  hudWx.addEventListener('click', () => {
    const cur = mode === 'auto' ? autoState : mode;
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    if (mode === 'auto') { autoState = cur; autoTimer = rand(8, 14); }
    updateHud(hour);
  });

  /* ---------- drawing ---------- */
  function strokePts(pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  function render(h, dt, T) {
    const elev = elevOf(h);
    const L = smooth(-0.12, 0.3, elev);
    const N = 1 - smooth(-0.3, 0.02, elev);
    isNight = N > 0.6;
    const overcast = smooth(0.35, 1, wx.cover) * 0.72;
    const sky = sampleSky(h).map(c => { const y = lum(c) * 255 * 0.62; return mix(c, [y, y, y * 1.06], overcast); });
    const fl = reduce ? 0 : flash;
    const horizon = H * 0.83;

    // sky
    const sg = ctx.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, rgba(sky[0])); sg.addColorStop(0.55, rgba(sky[1])); sg.addColorStop(0.86, rgba(sky[2])); sg.addColorStop(1, rgba(sky[2]));
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);

    // stars
    const starVis = N * (1 - smooth(0.2, 0.85, wx.cover));
    if (starVis > 0.01) {
      for (const s of stars) {
        const tw = reduce ? 0.85 : 0.55 + 0.45 * Math.sin(T * s.tw + s.ph);
        ctx.fillStyle = rgba(s.c, starVis * tw * (s.r > 1.2 ? 1 : 0.8));
        const x = s.x * W, y = s.y * H;
        if (s.r < 1) ctx.fillRect(x, y, s.r * 1.6, s.r * 1.6);
        else { ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill(); }
      }
      if (!reduce && starVis > 0.7 && Math.random() < dt / 6) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        shooters.push({ x: rand(0.1, 0.9) * W, y: rand(0.05, 0.4) * H, vx: dir * rand(500, 800), vy: rand(180, 320), life: 0, max: rand(0.5, 0.9) });
      }
      for (let i = shooters.length - 1; i >= 0; i--) {
        const s = shooters[i];
        s.life += dt;
        if (s.life > s.max) { shooters.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        const a = Math.sin(Math.PI * s.life / s.max) * starVis;
        const sp = Math.hypot(s.vx, s.vy), tx = s.x - s.vx / sp * 90, ty = s.y - s.vy / sp * 90;
        const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
        g.addColorStop(0, `rgba(255,255,255,${a.toFixed(2)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
    }

    let light = { angle: 180, c: 'rgba(0,0,0,0)' };
    const hide = smooth(0.3, 0.95, wx.cover);

    // moon
    const mh = h < 12 ? h + 24 : h;
    const m = (mh - 19.3) / (29.2 - 19.3), me = Math.sin(Math.PI * m);
    if (m > -0.05 && m < 1.05 && me > -0.2 && moonSprite) {
      const mA = (1 - L * 0.85) * (1 - hide * 0.9);
      if (mA > 0.02) {
        const mx = W * (0.08 + 0.84 * m), my = horizon - me * (horizon - H * 0.16);
        const gR = moonR * 5;
        const g = ctx.createRadialGradient(mx, my, moonR * 0.8, mx, my, gR);
        g.addColorStop(0, `rgba(215,222,255,${(0.22 * mA).toFixed(2)})`); g.addColorStop(1, 'rgba(215,222,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, gR, 0, TAU); ctx.fill();
        ctx.globalAlpha = mA;
        ctx.drawImage(moonSprite, mx - moonR - 2, my - moonR - 2, moonR * 2 + 4, moonR * 2 + 4);
        ctx.globalAlpha = 1;
        if (L < 0.05) light = { angle: lerp(90, 270, clamp(mx / W, 0, 1)), c: rgba([205, 215, 255], 0.16 * mA * N) };
      }
    }

    // sun
    if (elev > -0.2) {
      const p = sunP(h);
      const sx = W * (0.06 + 0.88 * p), sy = horizon - elev * (horizon - H * 0.14);
      const R = clamp(Math.min(W, H) * 0.04, 20, 44);
      const hi = smooth(0, 0.45, elev);
      const core = mix([255, 146, 84], [255, 247, 222], hi);
      const vis = 1 - hide * 0.92;
      const gR = R * lerp(7, 4.5, hi);
      const g = ctx.createRadialGradient(sx, sy, R * 0.6, sx, sy, gR);
      g.addColorStop(0, rgba(core, 0.5 * vis)); g.addColorStop(0.35, rgba(core, 0.16 * vis)); g.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, gR, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(core, vis); ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
      if (L > 0.02) light = { angle: lerp(90, 270, clamp(sx / W, 0, 1)), c: rgba(core, 0.3 * L * vis) };
    }

    // overcast deck
    const deck = smooth(0.45, 1, wx.cover);
    const gray = clamp(smooth(0.4, 1, wx.cover) * 0.65 + wx.storm * 0.35, 0, 1);
    const stormC = mix([126, 134, 148], [28, 32, 44], N);
    if (deck > 0.01) {
      const dc = mix([96, 104, 120], [14, 16, 26], N);
      const dg = ctx.createLinearGradient(0, 0, 0, H * 0.7);
      dg.addColorStop(0, rgba(dc, 0.85 * deck)); dg.addColorStop(1, rgba(dc, 0));
      ctx.fillStyle = dg; ctx.fillRect(0, 0, W, H * 0.7);
    }

    // clouds
    const warm = clamp(1 - Math.abs(elev - 0.06) / 0.24, 0, 1) * (1 - N);
    let cLit = mix(mix([255, 255, 255], [255, 190, 160], warm), [70, 78, 112], N);
    cLit = mix(cLit, stormC, gray);
    let cShade = mix(cLit, mix(sky[1], [20, 24, 40], 0.55), 0.38);
    if (fl > 0) { cLit = mix(cLit, [235, 240, 255], fl * 0.6); cShade = mix(cShade, [200, 210, 240], fl * 0.5); }
    const cA = lerp(0.95, 0.8, N);
    const scaleBase = clamp(W / 1100, 0.55, 1.25);
    const coverVis = 0.22 + 0.78 * wx.cover;
    const drift = (1 + wx.wind * 3) * (reduce ? 0.4 : 1);
    for (const c of clouds) {
      c.x += c.v * drift * dt / W;
      if (c.x > 1.35) { c.x = -0.35 - Math.random() * 0.15; c.y = 0.05 + Math.random() * 0.5; }
      const vis = smooth(c.th - 0.08, c.th + 0.12, coverVis);
      if (vis < 0.01) continue;
      const s = c.s * scaleBase * (1 + wx.storm * 0.25);
      const cx = c.x * W, cy = c.y * H;
      for (const p of c.puffs) {
        const x = cx + p.dx * s, y = cy + p.dy * s, r = p.r * s;
        const col = mix(cLit, cShade, clamp((p.dy + 20) / 50, 0, 1));
        const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
        g.addColorStop(0, rgba(col, vis * cA)); g.addColorStop(0.55, rgba(col, vis * cA * 0.8)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }

    // lightning
    if (bolt && !reduce) {
      ctx.save();
      ctx.globalAlpha = clamp(bolt.life / 0.22, 0, 1);
      ctx.strokeStyle = '#f4f7ff'; ctx.shadowColor = 'rgba(170,190,255,.95)'; ctx.shadowBlur = 16;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 2.4; strokePts(bolt.pts);
      ctx.lineWidth = 1.2; bolt.branches.forEach(strokePts);
      ctx.restore();
    }
    if (fl > 0.01) { ctx.fillStyle = rgba([225, 232, 255], fl * 0.22); ctx.fillRect(0, 0, W, H); }

    // hills and pines
    let base = mix([4, 6, 14], [34, 58, 52], L * 0.95);
    base = mix(base, mix([40, 44, 52], [4, 5, 10], N), gray * 0.5);
    const unit = Math.min(W, H), step = Math.max(6, W / 160);
    [0.42, 0.66, 0.86].forEach((t, i) => {
      let col = mix(sky[2], base, t);
      if (fl > 0) col = mix(col, [150, 160, 190], fl * 0.25);
      const hl = hills[i];
      ctx.fillStyle = rgba(col);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, hillY(hl, x / W) * H);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      if (hl.trees.length) {
        ctx.beginPath();
        for (const tr of hl.trees) {
          const x = tr.x * W, y = hillY(hl, tr.x) * H + 2, th = tr.h * unit * 1.8, tw = th * 0.42;
          ctx.moveTo(x, y - th); ctx.lineTo(x + tw / 2, y - th * 0.35); ctx.lineTo(x - tw / 2, y - th * 0.35); ctx.closePath();
          ctx.moveTo(x, y - th * 0.7); ctx.lineTo(x + tw * 0.62, y); ctx.lineTo(x - tw * 0.62, y); ctx.closePath();
        }
        ctx.fill();
      }
    });

    // fireflies after dusk, only when it's dry
    const ff = smooth(0.35, 0.85, N) * (1 - smooth(0.02, 0.25, wx.rain));
    if (ff > 0.01) {
      for (const f of flies) {
        if (!reduce) {
          f.a += (Math.random() - 0.5) * dt * 2.5;
          f.x += Math.cos(f.a) * f.sp * dt; f.y += Math.sin(f.a) * f.sp * dt * 0.5;
          if (f.x < 0) f.x += 1; if (f.x > 1) f.x -= 1;
          if (f.y < 0.8 || f.y > 0.985) { f.a = -f.a; f.y = clamp(f.y, 0.8, 0.985); }
        }
        const a = ff * Math.pow(Math.max(0, Math.sin(T * f.f + f.ph)), 3);
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(flySprite, f.x * W - 12, f.y * H - 12, 24, 24);
      }
      ctx.globalAlpha = 1;
    }

    // rain
    const nDrops = Math.floor(drops.length * wx.rain * (reduce ? 0.5 : 1));
    if (nDrops > 0) {
      ctx.fillStyle = rgba(mix(sky[2], [128, 136, 150], 0.5), 0.1 * wx.rain);
      ctx.fillRect(0, 0, W, H);
      const slant = 0.1 + wx.wind * 0.28, sp = reduce ? 0.35 : 1, stretch = 1 + wx.storm * 0.5;
      const rc = mix([215, 228, 242], [165, 180, 210], N);
      const rA = 0.2 + 0.25 * wx.rain + fl * 0.3;
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < nDrops; i++) {
          const d = drops[i];
          if ((d.z > 0.7) !== (pass === 1)) continue;
          d.y += d.v * dt * sp; d.x += d.v * slant * dt * sp;
          const len = d.len * stretch;
          if (d.y - len > H) { d.y = -Math.random() * 60; d.x = Math.random() * (W + H * slant) - H * slant; }
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - len * slant, d.y - len);
        }
        ctx.strokeStyle = rgba(rc, pass ? rA : rA * 0.6);
        ctx.lineWidth = pass ? 1.3 : 0.8;
        ctx.stroke();
      }
    }

    applyTheme(h, sky, L, light, dt);
  }

  /* ---------- sizing + loop ---------- */
  function resize() {
    const w = canvas.clientWidth, hh = canvas.clientHeight;
    if (!w || !hh) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = w; H = hh;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildMoon(); buildDrops();
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(canvas);
    new ResizeObserver(measure).observe(document.body);
  }
  addEventListener('resize', () => { resize(); measure(); });
  addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  resize(); measure();

  let hour = targetHour(), last = performance.now(), T = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    if (coarse && dt < 0.026) return; // ~38fps on phones to save battery
    last = now; dt = Math.min(dt, 0.05); T += dt;
    hour += (targetHour() - hour) * (1 - Math.exp(-dt * (reduce ? 12 : 5)));
    stepWeather(dt);
    stepLightning(dt);
    if (W && H) render(hour, dt, T);
    updateHud(hour);
  }
  requestAnimationFrame(frame);
})();
