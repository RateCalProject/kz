/* ===== 風の芽経済組：国土の地図 3D の建物（t65）― pub：役所・寺社・学校・病院・文化・遊び・スポーツ・公園 =====
   型の名前は p_…・質感の名前は p:…。組み立ての道具は M3A（m3arch.js）。乱数は P.rng だけ
   ・寺社・公園など 区画ぜんたいを つかうものは、道（P.front）に向けた枠（frm）の u（道から見て 左→右）・v（道ばた→奥）で ならべる
   ・遠く（lod -1）は 型の far(L, P)：箱のめやすだけ（形はない） */
(function () {
'use strict';
const A = window.M3A; if (!A || !A.arch) return;
const PT = A.paint, PI = Math.PI, W1 = [1, 1, 1];
const C = A.col, mul = A.mul, mix = A.mix;
const cl = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const rr = (R, a, b) => a + (b - a) * R();

/* ---------- 枠：長方形 r を 道（fr）に向ける ---------- */
function frm(r, fr) {
  const f = fr || [0, 1], sd = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 'E' : 'W') : (f[1] < 0 ? 'N' : 'S');
  const x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3], ns = sd === 'S' || sd === 'N';
  const p = sd === 'S' ? (u, v) => [x0 + u, z1 - v] : sd === 'N' ? (u, v) => [x1 - u, z0 + v] : sd === 'E' ? (u, v) => [x1 - v, z1 - u] : (u, v) => [x0 + v, z0 + u];
  const dv = sd === 'S' ? [0, -1] : sd === 'N' ? [0, 1] : sd === 'E' ? [-1, 0] : [1, 0], du = [-dv[1], dv[0]];
  return {
    sd, uX: ns, W: ns ? x1 - x0 : z1 - z0, D: ns ? z1 - z0 : x1 - x0, p, du, dv, r,
    R: (u0, v0, u1, v1) => { const a = p(u0, v0), b = p(u1, v1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; },
    aU: Math.atan2(du[1], du[0]), aV: Math.atan2(dv[1], dv[0]),
    ax: along => ((along === 'u') === ns ? 'x' : 'z'),   // 棟の向き（u・v）→ 'x'・'z'
    fe: sd === 'S' || sd === 'E' ? 'e1' : 'e0'           // 平入りの切妻で 道がわの軒（jroof の e0・e1）
  };
}
// 区画からの さがり：ななめ（P.tilt：区画の中の長方形に建てる）のときは 0.3 m まで
const SB = (P, d) => P.tilt ? Math.min(d, 0.3) : d;
// 長方形の形（F のかわり）
function rfoot(r) {
  const x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3], l = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], edges = []; let s = 0;
  for (let i = 0; i < 4; i++) { const a = l[i], b = l[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; edges.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / L, nz: -dx / L, L, u0: s, li: 0, out: true }); s += L; }
  return { loops: [l], edges, rects: [r], maxr: [r], bb: [x0, z0, x1, z1], w: x1 - x0, d: z1 - z0, area: (x1 - x0) * (z1 - z0), n: 1 };
}
// 区画の一部（cells は P.F.cells とおなじ 番号）→ P.F と同じ座標の 形
function subFoot(F0, cells) {
  if (!cells.length) return null;
  const F = A.foot(cells.map(c => [c[0] + F0.X0, c[1] + F0.Y0]), F0.cs), dx = (F.X0 - F0.X0) * F0.cs, dz = (F.Y0 - F0.Y0) * F0.cs;
  if (dx || dz) {
    F.loops = F.loops.map(l => l.map(q => [q[0] + dx, q[1] + dz]));
    for (const e of F.edges) { e.ax += dx; e.bx += dx; e.az += dz; e.bz += dz; }
    F.rects = F.rects.map(r => [r[0] + dx, r[1] + dz, r[2] + dx, r[3] + dz]);
    F.bb = [F.bb[0] + dx, F.bb[1] + dz, F.bb[2] + dx, F.bb[3] + dz];
    F.G = Object.assign({}, F.G, { xs: F.G.xs.map(x => x + dx), zs: F.G.zs.map(z => z + dz) });
  }
  F.X0 = F0.X0; F.Y0 = F0.Y0; F.cells = cells;
  return F;
}
// いちばん大きな長方形（道に面していると すこし ひいき）
function mainRect(F, fr) {
  const f = fr || [0, 1], bb = F.bb; let best = F.maxr[0] || F.bb, bs = -1;
  for (const r of F.maxr) {
    const a = (r[2] - r[0]) * (r[3] - r[1]);
    const touch = (f[1] > 0.5 && Math.abs(r[3] - bb[3]) < 0.1) || (f[1] < -0.5 && Math.abs(r[1] - bb[1]) < 0.1) || (f[0] > 0.5 && Math.abs(r[2] - bb[2]) < 0.1) || (f[0] < -0.5 && Math.abs(r[0] - bb[0]) < 0.1);
    const s = a * (touch ? 1.25 : 1); if (s > bs) { bs = s; best = r; }
  }
  return best;
}
// 道からの 深さ（列ごとに 道がわから 0, 1, 2…）。'x,y' → 深さ・列の長さ
function cellDepth(F, fr) {
  const f = fr || [0, 1], sd = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 'E' : 'W') : (f[1] < 0 ? 'N' : 'S');
  const col = new Map(), out = new Map();
  for (const c of F.cells) { const k = sd === 'S' || sd === 'N' ? c[0] : c[1]; let l = col.get(k); if (!l) col.set(k, l = []); l.push(c); }
  for (const l of col.values()) {
    l.sort((a, b) => sd === 'S' ? b[1] - a[1] : sd === 'N' ? a[1] - b[1] : sd === 'E' ? b[0] - a[0] : a[0] - b[0]);
    l.forEach((c, i) => out.set(c[0] + ',' + c[1], [i, l.length]));
  }
  return out;
}

/* ---------- 質感（p:）。はじめて つかうときに 描かれる ---------- */
const TX = (k, w, h, f, o) => A.tex('p:' + k, w, h, f, o);
const T = {};
const css = PT.css, fill = PT.fill;
const wrapDot = (g, w, h, x, y, rad, st) => { g.fillStyle = st; for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, PI * 2); g.fill(); } };
// 地面
T.jari = TX('g:jari', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#d3cec3'); PT.noise(g, 0, 0, w, h, 0.06, R);
  for (let i = 0; i < 1100; i++) { g.fillStyle = css(mix('#a7a196', '#f3efe7', R())); const s = (0.7 + R() * 1.6) * k; g.fillRect(R() * w, R() * h, s, s); } });
T.ishi = TX('g:ishi', 128, 128, (g, w, h, R) => { const k = w / 128, rows = 6, rh = h / rows; fill(g, 0, 0, w, h, '#86837d');
  for (let j = 0; j < rows; j++) { const off = R() * w; let x = 0; while (x < w - 1) { let sw = w * (0.16 + R() * 0.15); if (x + sw > w - w * 0.08) sw = w - x; const c2 = css(mix('#b0aca4', '#d4d0c8', R()));
      for (const ox of [0, -w]) { g.fillStyle = c2; g.fillRect(((x + off) % w) + ox + k, j * rh + k, sw - 2 * k, rh - 2 * k); } x += sw; } }
  PT.noise(g, 0, 0, w, h, 0.05, R); });
T.tsuchi = TX('g:tsuchi', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#b39c7b');
  for (let i = 0; i < 40; i++) wrapDot(g, w, h, R() * w, R() * h, (5 + R() * 16) * k, R() < 0.5 ? 'rgba(90,70,45,.07)' : 'rgba(255,245,225,.07)');
  PT.noise(g, 0, 0, w, h, 0.07, R); for (let i = 0; i < 160; i++) { g.fillStyle = css(mix('#8e7a5e', '#d8c8aa', R())); g.fillRect(R() * w, R() * h, 1.2 * k, 1.2 * k); } });
T.shiba = TX('g:shiba', 128, 128, (g, w, h, R) => { fill(g, 0, 0, w, h, '#6d8b4a'); fill(g, 0, 0, w / 2, h, '#739150');
  for (let i = 0; i < 30; i++) wrapDot(g, w, h, R() * w, R() * h, (4 + R() * 12) * w / 128, 'rgba(60,80,30,.06)'); PT.noise(g, 0, 0, w, h, 0.06, R); });
T.asph = TX('g:asph', 128, 128, (g, w, h, R) => { fill(g, 0, 0, w, h, '#5e6063'); for (let i = 0; i < 14; i++) wrapDot(g, w, h, R() * w, R() * h, (6 + R() * 14) * w / 128, 'rgba(30,30,30,.06)'); PT.noise(g, 0, 0, w, h, 0.07, R); });
T.mizu = TX('g:mizu', 128, 128, (g, w, h, R) => { const k = w / 128, gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#6a909a'); gr.addColorStop(1, '#557d88'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1.2 * k; for (let i = 0; i < 46; i++) { const x = R() * w, y = R() * h, l = (5 + R() * 12) * k; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 2 * k, x + l, y); g.stroke(); } PT.noise(g, 0, 0, w, h, 0.03, R); });
T.track = TX('g:track', 128, 128, (g, w, h, R) => { fill(g, 0, 0, w, h, '#a9563f'); PT.noise(g, 0, 0, w, h, 0.05, R); for (let j = 0; j <= 8; j++) fill(g, 0, Math.min(h - 2, j * h / 8), w, Math.max(1, w / 90), '#ece8e0'); });
T.court = TX('g:court', 128, 256, (g, w, h, R) => {   // テニスコート 1面（18 × 36 m）
  const mx = w / 18, my = h / 36, lw = Math.max(1, 0.09 * mx); fill(g, 0, 0, w, h, '#5c7f58'); PT.noise(g, 0, 0, w, h, 0.03, R);
  const cx0 = (18 - 10.97) / 2 * mx, cy0 = (36 - 23.77) / 2 * my, cw = 10.97 * mx, ch = 23.77 * my; fill(g, cx0, cy0, cw, ch, '#4b7a63');
  const L = (x, y, ww, hh) => fill(g, x, y, ww, hh, '#f0efe8');
  L(cx0, cy0, cw, lw); L(cx0, cy0 + ch - lw, cw, lw); L(cx0, cy0, lw, ch); L(cx0 + cw - lw, cy0, lw, ch);
  const sx = 1.37 * mx; L(cx0 + sx, cy0, lw, ch); L(cx0 + cw - sx - lw, cy0, lw, ch);
  const sy = (23.77 / 2 - 6.4) * my; L(cx0 + sx, cy0 + sy, cw - 2 * sx, lw); L(cx0 + sx, cy0 + ch - sy, cw - 2 * sx, lw); L(cx0 + cw / 2 - lw / 2, cy0 + sy, lw, ch - 2 * sy);
  fill(g, cx0 - mx * 0.5, cy0 + ch / 2 - lw, cw + mx, lw * 2, '#2e3338'); });
// 屋根
T.kawara = TX('r:kawara', 128, 128, (g, w, h, R) => PT.roofMat(g, w, h, { t: 'kawara', c: '#72777c', n: 0.035 }, R));
T.dou = TX('r:dou', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#6ea592');
  for (let i = 0; i < 26; i++) wrapDot(g, w, h, R() * w, R() * h, (4 + R() * 14) * k, R() < 0.6 ? 'rgba(40,80,70,.10)' : 'rgba(210,240,225,.10)');
  for (let j = 0; j < 16; j++) { g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, j * h / 16, w, Math.max(1, k)); g.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 8; i++) g.fillRect((i + (j % 2) * 0.5) * w / 8, j * h / 16, Math.max(1, k), h / 16); }
  PT.noise(g, 0, 0, w, h, 0.04, R); });
T.dou2 = TX('r:dou2', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#a8714c');   // 新しい銅（茶色）
  for (let i = 0; i < 22; i++) wrapDot(g, w, h, R() * w, R() * h, (4 + R() * 14) * k, R() < 0.5 ? 'rgba(60,30,15,.10)' : 'rgba(255,220,180,.10)');
  for (let j = 0; j < 16; j++) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, j * h / 16, w, Math.max(1, k)); for (let i = 0; i < 8; i++) g.fillRect((i + (j % 2) * 0.5) * w / 8, j * h / 16, Math.max(1, k), h / 16); }
  PT.noise(g, 0, 0, w, h, 0.04, R); });
T.hiwada = TX('r:hiwada', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#5f4636');
  for (let j = 0; j < 40; j++) { g.fillStyle = css(mix('#4a3428', '#7a5c48', R()), 1, 0.5); g.fillRect(0, j * h / 40, w, Math.max(1, h / 80)); }
  for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(20,10,5,.10)'; g.fillRect(R() * w, 0, (1 + R() * 3) * k, h); } PT.noise(g, 0, 0, w, h, 0.05, R); });
T.kaya = TX('r:kaya', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#8c7a58');
  for (let i = 0; i < 260; i++) { g.fillStyle = css(mix('#6e5e42', '#b4a27c', R()), 1, 0.55); g.fillRect(R() * w, R() * h, Math.max(1, k), (3 + R() * 9) * k); }
  for (let j = 0; j < 3; j++) { g.fillStyle = 'rgba(40,30,15,.08)'; g.fillRect(0, j * h / 3, w, 2 * k); } PT.noise(g, 0, 0, w, h, 0.05, R); });
T.kane = TX('r:kane', 128, 128, (g, w, h, R) => PT.roofMat(g, w, h, { t: 'seam', c: '#c3c6c8', n: 0.025 }, R));
T.flat = TX('r:flat', 128, 128, (g, w, h, R) => { fill(g, 0, 0, w, h, '#a9aaa7'); g.globalAlpha = 0.3; PT.hlines(g, 0, 0, w, h, h / 4, '#7c7e7c', 1); PT.vlines(g, 0, 0, w, h, w / 2, '#7c7e7c', 1); g.globalAlpha = 1;
  for (let i = 0; i < 12; i++) wrapDot(g, w, h, R() * w, R() * h, (6 + R() * 12) * w / 128, 'rgba(50,50,40,.05)'); PT.noise(g, 0, 0, w, h, 0.04, R); });
T.solar = TX('r:solar', 128, 128, (g, w, h, R) => PT.roofMat(g, w, h, { t: 'solar' }, R));
// 森（上から・ふち）：遠くの寺社・公園・植えこみ
T.mori = TX('g:mori', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#33492c');
  for (let i = 0; i < 90; i++) { const x = R() * w, y = R() * h, rad = (4 + R() * 9) * k; wrapDot(g, w, h, x, y, rad, css(mix('#3d5833', '#5f7c45', R()))); wrapDot(g, w, h, x - rad * 0.25, y - rad * 0.3, rad * 0.55, 'rgba(150,180,110,.16)'); }
  PT.noise(g, 0, 0, w, h, 0.05, R); });

/* ---------- 壁の質感（窓のならぶ面） ---------- */
const pillar = (g, x, y, w, h, c) => { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, css(c, 0.7)); gr.addColorStop(0.45, css(c, 1.08)); gr.addColorStop(1, css(c, 0.68)); g.fillStyle = gr; g.fillRect(x, y, w, h); };
const hbeam = (g, x, y, w, h, c) => { fill(g, x, y, w, h, c); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, Math.max(1, h * 0.25)); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + h, w, Math.max(1, h * 0.4)); };
const lattice = (g, x, y, w, h, nx, ny, c, bg, lw) => { fill(g, x, y, w, h, bg); g.fillStyle = css(c); for (let i = 0; i <= nx; i++) g.fillRect(x + w * i / nx - lw / 2, y, lw, h); for (let j = 0; j <= ny; j++) g.fillRect(x, y + h * j / ny - lw / 2, w, lw); };
const bellPath = (g, x, y, w, h) => { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + h * 0.38); g.bezierCurveTo(x, y + h * 0.1, x + w * 0.32, y + h * 0.2, x + w * 0.5, y); g.bezierCurveTo(x + w * 0.68, y + h * 0.2, x + w, y + h * 0.1, x + w, y + h * 0.38); g.lineTo(x + w, y + h); g.closePath(); g.fill(); };
// 社殿・お堂の壁（柱・長押・格子戸・板戸・白壁・花頭窓）：tb 4・1階ぶん
function paintSha(g, w, h, R, q) {
  const k = w / 256, mw = w / 4;
  fill(g, 0, 0, w, h, q.wall); PT.noise(g, 0, 0, w, h, 0.03, R);
  if (q.boards) { g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = 0; x < w; x += mw / 7) g.fillRect(x, 0, Math.max(1, k), h); }
  for (let i = 0; i < 4; i++) {
    const X = i * mw, pw = mw * 0.14, ix = X + pw, iw = mw - pw, y0 = h * 0.34, y1 = h * 0.92, t = q.bays[i];
    if (t === 'L') { lattice(g, ix, y0, iw, y1 - y0, 7, 11, q.lat, q.dark, Math.max(1, 2.2 * k)); fill(g, ix, y0, iw, 3 * k, q.lat); }
    else if (t === 'D' || t === 'S') {   // 板戸・桟唐戸
      fill(g, ix, y0, iw, y1 - y0, q.door); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(ix + iw / 2 - k, y0, 2 * k, y1 - y0);
      if (t === 'S') { g.fillStyle = 'rgba(0,0,0,.22)'; for (let b = 0; b < 2; b++) for (let a = 0; a < 4; a++) g.fillRect(ix + iw * (0.06 + b * 0.5), y0 + (y1 - y0) * (0.06 + a * 0.235), iw * 0.38, (y1 - y0) * 0.19); }
      else { g.fillStyle = 'rgba(0,0,0,.2)'; for (let b = 1; b < 5; b++) g.fillRect(ix, y0 + (y1 - y0) * b / 5, iw, Math.max(1, 1.5 * k)); }
      fill(g, ix + iw * 0.42, y0 + (y1 - y0) * 0.48, iw * 0.16, Math.max(2, 3 * k), q.metal || '#b89a4a');
    } else if (t === 'K') {   // 花頭窓
      fill(g, ix, y0, iw, y1 - y0, q.low); g.fillStyle = css(q.beam); bellPath(g, ix + iw * 0.2 - 2 * k, y0 + (y1 - y0) * 0.16 - 2 * k, iw * 0.6 + 4 * k, (y1 - y0) * 0.64 + 3 * k);
      g.fillStyle = css(q.dark); bellPath(g, ix + iw * 0.2, y0 + (y1 - y0) * 0.16, iw * 0.6, (y1 - y0) * 0.64);
      g.fillStyle = css(q.beam, 0.9); for (let a = 1; a < 6; a++) g.fillRect(ix + iw * 0.2 + iw * 0.6 * a / 6 - k, y0 + (y1 - y0) * 0.3, 1.6 * k, (y1 - y0) * 0.5);
    } else fill(g, ix, y0, iw, y1 - y0, q.low);
    pillar(g, X, 0, pw, h, q.pil);
  }
  hbeam(g, 0, 0, w, h * 0.06, q.beam); hbeam(g, 0, h * 0.28, w, h * 0.06, q.beam); fill(g, 0, h * 0.92, w, h * 0.08, q.beam);
}
T.shu = TX('f:shu', 256, 256, (g, w, h, R) => paintSha(g, w, h, R, { pil: '#b8452f', beam: '#b3432e', wall: '#f0ede5', low: '#f0ede5', lat: '#b8452f', dark: '#2a201c', door: '#ad422d', bays: ['L', 'W', 'D', 'W'] }));
T.ki = TX('f:ki', 256, 256, (g, w, h, R) => paintSha(g, w, h, R, { pil: '#c7a87e', beam: '#bf9f75', wall: '#c2a47c', low: '#b8986e', lat: '#c7a87e', dark: '#2c2420', door: '#b49568', bays: ['L', 'D', 'L', 'W'], boards: 1 }));
T.tera = TX('f:tera', 256, 256, (g, w, h, R) => paintSha(g, w, h, R, { pil: '#4e3b2d', beam: '#4b392c', wall: '#ece8de', low: '#ece8de', lat: '#5a4535', dark: '#1d1815', door: '#4e3a2b', bays: ['S', 'K', 'L', 'S'], metal: '#8a7a50' }));
T.ishigaki = TX('f:ishigaki', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#6f6b62');
  const rows = 5, rh = h / rows; for (let j = 0; j < rows; j++) { let x = -R() * 20 * k; while (x < w) { const sw = (18 + R() * 22) * k; for (const ox of [0, w, -w]) { g.fillStyle = css(mix('#8f8a7f', '#b9b4a8', R())); g.beginPath(); const x0 = x + ox + 1.5 * k, y0 = j * rh + 1.5 * k, x1 = x + ox + sw - 1.5 * k, y1 = (j + 1) * rh - 1.5 * k; g.moveTo(x0 + 3 * k, y0); g.lineTo(x1 - 2 * k, y0 + k); g.lineTo(x1, y1 - 3 * k); g.lineTo(x1 - 4 * k, y1); g.lineTo(x0, y1 - k); g.lineTo(x0 - k, y0 + 4 * k); g.closePath(); g.fill(); } x += sw; } }
  PT.noise(g, 0, 0, w, h, 0.06, R); });

/* ---------- 木 ---------- */
const TCOL = ['#4d6c3a', '#56743f', '#46633a', '#5c7a44', '#41603a'];
const trunk3 = (B, x, z, y0, y1, r, c) => { for (let i = 0; i < 3; i++) { const a = i / 3 * PI * 2 + 0.5, b = (i + 1) / 3 * PI * 2 + 0.5; B.wall('c', x + Math.cos(a) * r, z + Math.sin(a) * r, x + Math.cos(b) * r, z + Math.sin(b) * r, y0, y1, c); } };
// 葉のかたまり（まるい）：まん中 (x, yc, z)・よこ r・上 hu・下 hd
function blob(B, x, yc, z, r, hu, hd, c, R, n = 6) {
  const lc = C(c), ring = [], rot = R() * 2;
  for (let i = 0; i < n; i++) { const t = rot + i / n * PI * 2, k = 0.82 + 0.36 * R(); ring.push([x + Math.cos(t) * r * k, yc + (R() - 0.5) * (hu + hd) * 0.14, z + Math.sin(t) * r * k]); }
  const top = [x + (R() - 0.5) * r * 0.3, yc + hu, z + (R() - 0.5) * r * 0.3], bot = [x, yc - hd, z], dk = mul(lc, 0.68), lt = mul(lc, 1.06);
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; B.tri('c', a, top, b, null, lt, null, [0.95, 1.12, 0.95]); B.tri('c', b, bot, a, null, dk); }
}
// 葉のかたまり（2 段の輪：まるく見える）。下 yb・高さ h・よこ r
function crown(B, x, yb, z, r, h, c, R, n = 5) {
  const lc = C(c), rot = R() * 2, r1 = [], r2 = [];
  for (let i = 0; i < n; i++) { const t = rot + i / n * PI * 2, k = 0.84 + 0.32 * R(), t2 = t + PI / n;
    r1.push([x + Math.cos(t) * r * k, yb + h * (0.3 + 0.1 * (R() - 0.5)), z + Math.sin(t) * r * k]);
    r2.push([x + Math.cos(t2) * r * k * 0.74, yb + h * (0.7 + 0.1 * (R() - 0.5)), z + Math.sin(t2) * r * k * 0.74]); }
  const top = [x + (R() - 0.5) * r * 0.2, yb + h, z + (R() - 0.5) * r * 0.2], bot = [x, yb + h * 0.06, z], cT = mul(lc, 1.1), cB = mul(lc, 0.6);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n;
    B.tri('c', r2[i], top, r2[j], null, cT); B.tri('c', r1[i], r2[i], r1[j], null, lc, null, [0.88, 1.04, 0.88]); B.tri('c', r1[j], r2[i], r2[j], null, lc, null, [0.88, 1.04, 1.04]); B.tri('c', r1[j], bot, r1[i], null, cB); }
}
function treeB(B, x, z, y, h, r, c, R, lod) {   // 広葉樹
  const yT = y + h * 0.26;
  if (lod >= 2) trunk3(B, x, z, y, yT + 0.6, 0.14 + h * 0.01, '#55473a');
  if (lod >= 2) crown(B, x, yT, z, r, h - (yT - y), c, R, 5); else blob(B, x, yT + (h - (yT - y)) * 0.3, z, r, (h - (yT - y)) * 0.7, (h - (yT - y)) * 0.12, c, R, 5);
}
function cone(B, x, z, r, y0, y1, c, n = 6) { const lc = C(c); for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.tri('c', [x + Math.cos(t0) * r, y0, z + Math.sin(t0) * r], [x, y1, z], [x + Math.cos(t1) * r, y0, z + Math.sin(t1) * r], null, lc, null, [0.78, 1.1, 0.78]); } }
function treeN(B, x, z, y, h, r, c, lod) {      // 杉・檜
  if (lod >= 2) trunk3(B, x, z, y, y + h * 0.3, 0.13 + h * 0.007, '#5a4636');
  cone(B, x, z, r, y + h * 0.14, y + h * 0.78, c); if (lod >= 1) cone(B, x, z, r * 0.62, y + h * 0.5, y + h, mul(c, 1.05));
}
// ななめの柱（3角）：a → b
function pole(B, a, b, r, c, n = 3) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, e = [d[0] / L, d[1] / L, d[2] / L];
  let q = Math.abs(e[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1 = [e[1] * q[2] - e[2] * q[1], e[2] * q[0] - e[0] * q[2], e[0] * q[1] - e[1] * q[0]]; const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1);
  const e2 = [e[1] * e1[2] - e[2] * e1[1], e[2] * e1[0] - e[0] * e1[2], e[0] * e1[1] - e[1] * e1[0]];
  const ring = (p, t) => [p[0] + r * (Math.cos(t) * e1[0] + Math.sin(t) * e2[0]), p[1] + r * (Math.cos(t) * e1[1] + Math.sin(t) * e2[1]), p[2] + r * (Math.cos(t) * e1[2] + Math.sin(t) * e2[2])];
  for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.quad('c', ring(a, t0), ring(a, t1), ring(b, t1), ring(b, t0), null, c); }
}
function pine(B, x, z, y, h, r, R, lod) {       // 松（ななめの幹・上に 葉のかたまり）
  const ang = R() * PI * 2, lx = Math.cos(ang) * h * 0.2, lz = Math.sin(ang) * h * 0.2, m = [x + lx * 0.4, y + h * 0.42, z + lz * 0.4], t = [x + lx, y + h * 0.74, z + lz];
  if (lod >= 2) { pole(B, [x, y, z], m, 0.15 + h * 0.012, '#5e4b3c'); pole(B, m, t, 0.11 + h * 0.01, '#5e4b3c'); }
  const c = mix('#3f5a38', '#4f6a40', R());
  if (lod >= 2) { crown(B, t[0], t[1] - h * 0.08, t[2], r, h * 0.3, c, R, 5); if (h > 5) crown(B, m[0] - lx * 0.7 + lz * 0.3, y + h * 0.5, m[2] - lz * 0.7 - lx * 0.3, r * 0.62, h * 0.2, mul(c, 0.94), R, 5); }
  else blob(B, t[0], t[1], t[2], r, h * 0.2, h * 0.08, c, R, 5);
}
// 円板（上向きの 平らな多角形）
function disc(B, x, z, y, r, n, c, m) { for (let i = 0; i < n; i++) { const a0 = i / n * PI * 2, a1 = (i + 1) / n * PI * 2; B.tri(m || 'c', [x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [0, 1, 0], c); } }
// 木立・森：rects（[x0,z0,x1,z1]）に、out（よける長方形）を よけて 植える
//   o：{ sp（木の間 m）, k（数のめやす）, max, h: [低, 高], n（杉のわり）, p（松のわり）, c（色の列）, y }
function grove(B, P, rects, out, o) {
  const R = P.rng, lod = P.lod, y = o.y || 0, sp0 = o.sp || 6, nv0 = B.nv, vmax = o.vmax == null ? 1e9 : o.vmax;
  if (lod < 1 || vmax < 40) return 0;
  const cand = [];
  for (const r of rects) for (let zz = r[1] + sp0 * 0.5; zz < r[3]; zz += sp0) for (let xx = r[0] + sp0 * 0.5; xx < r[2]; xx += sp0) {
    const x = xx + (R() - 0.5) * sp0 * 0.7, z = zz + (R() - 0.5) * sp0 * 0.7;
    if (x < r[0] + 0.6 || x > r[2] - 0.6 || z < r[1] + 0.6 || z > r[3] - 0.6) continue;
    if (out && out.some(q => x > q[0] - 0.8 && x < q[2] + 0.8 && z > q[1] - 0.8 && z < q[3] + 0.8)) continue;
    cand.push([x, z, R()]);
  }
  if (!cand.length) return 0;
  let area = cand.length * sp0 * sp0;
  const cap = Math.max(1, Math.min(o.max || 70, Math.round((lod >= 2 ? 0.95 : 0.2) * Math.sqrt(area) * (o.k || 1))));
  let use = cand;
  if (cand.length > cap) { use = cand.slice().sort((a, b) => a[2] - b[2]).slice(0, cap); }
  const grow = Math.min(2.2, Math.sqrt(cand.length / use.length));
  const cs = o.c || TCOL;
  for (const [x, z] of use) {
    if (B.nv - nv0 > vmax - (lod >= 2 ? 80 : 30)) break;
    const h = lerp(o.h[0], o.h[1], R()) * (0.9 + 0.2 * Math.min(1, grow - 1)), r = Math.min(sp0 * 0.72 * grow, h * 0.42) * (0.8 + R() * 0.35), t = R();
    if (t < (o.p || 0)) pine(B, x, z, y, h * 0.7, r * 0.9, R, lod);
    else if (t < (o.p || 0) + (o.n || 0)) treeN(B, x, z, y, h * 1.15, r * 0.62, A.pick(R, ['#3c5838', '#42603c', '#3a5236']), lod);
    else treeB(B, x, z, y, h, r, A.pick(R, cs), R, lod);
  }
  return use.length;
}

// 1 つの建物の 頂点の めやす（大きい・特別な建物）：のこりを 木などに
const BUD = { 2: 5500, 1: 540, 0: 140 };
const left = (B, nv0, lod, k = 1) => BUD[lod >= 2 ? 2 : lod] * k - (B.nv - nv0);
/* ---------- 小物 ---------- */
// 4 面だけの箱（上は ほかでふさぐ・細い柱）
function post(B, x0, z0, x1, z1, y0, y1, c, m = 'c') { B.wall(m, x0, z0, x1, z0, y0, y1, c); B.wall(m, x1, z0, x1, z1, y0, y1, c); B.wall(m, x1, z1, x0, z1, y0, y1, c); B.wall(m, x0, z1, x0, z0, y0, y1, c); }
// 線にそった 角材（a → b の中心線。よこ wd・たて ht）。ends：はしの面
function beam(B, a, b, wd, ht, c, ends) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1, px = -dz / L * wd / 2, pz = dx / L * wd / 2, h0 = -ht / 2, h1 = ht / 2;
  const q = (p, s, t) => [p[0] + s * px, p[1] + t, p[2] + s * pz];
  const A0 = q(a, -1, h0), A1 = q(a, 1, h0), A2 = q(a, 1, h1), A3 = q(a, -1, h1), B0 = q(b, -1, h0), B1 = q(b, 1, h0), B2 = q(b, 1, h1), B3 = q(b, -1, h1);
  B.quad('c', A3, A2, B2, B3, null, c); B.quad('c', A1, B1, B2, A2, null, c); B.quad('c', A0, A3, B3, B0, null, c); B.quad('c', A0, B0, B1, A1, null, mul(c, 0.75));
  if (ends) { B.quad('c', A0, A1, A2, A3, null, c); B.quad('c', B1, B0, B3, B2, null, c); }
}
// 段（階段）：枠 fr のまん中 uc・はば sw・前 vf〜奥 vb、y0 → y1
function steps(B, fr, uc, sw, vf, vb, y0, y1, c, lod) {
  const n = lod >= 2 ? cl(Math.round((y1 - y0) / 0.25), 1, 5) : 1, dv = (vb - vf) / n;
  for (let i = 0; i < n; i++) { const r = fr.R(uc - sw / 2, vf + dv * i, uc + sw / 2, vb); B.box('c', r[0], r[1], r[2], r[3], y0, y0 + (y1 - y0) * (i + 1) / n, c); }
}
// 地面（形 F を 高さ y の面に。坂のときは まわりに 土台：wm（石垣など））
function pad(B, P, F, y, m, c, o = {}) {
  B.cap(m, F, y, c, { su: o.su || 8 });
  if (P.yb < y - 0.05 && (P.lod >= 1 || P.yb < -0.5)) { const wm = o.wm || 'c', s = o.wsu || 3;
    for (const e of F.edges) B.wallE(wm, e, P.yb, y, wm === 'c' ? (o.wc || [0.64, 0.63, 0.6]) : (o.wc || W1), { ao: 0.85, uv: wm === 'c' ? null : [e.u0 / s, (e.u0 + e.L) / s, P.yb / s, y / s] }); }
}
// 平らな面（枠の u, v で）
const flatU = (B, fr, m, u0, v0, u1, v1, y, c, su) => B.flat(m, fr.R(u0, v0, u1, v1), y, c, { su: su || 0 });
// 石灯籠（六角の笠）
function toro(B, x, z, y, h, c, lod) {
  const s = h / 2.1, k = mul(c, 0.82);
  B.box('c', x - 0.32 * s, z - 0.32 * s, x + 0.32 * s, z + 0.32 * s, y, y + 0.22 * s, k);
  if (lod >= 2) post(B, x - 0.1 * s, z - 0.1 * s, x + 0.1 * s, z + 0.1 * s, y + 0.22 * s, y + 1.0 * s, c);
  else post(B, x - 0.12 * s, z - 0.12 * s, x + 0.12 * s, z + 0.12 * s, y + 0.22 * s, y + 1.55 * s, c);
  if (lod >= 2) { B.box('c', x - 0.26 * s, z - 0.26 * s, x + 0.26 * s, z + 0.26 * s, y + 1.0 * s, y + 1.16 * s, c); post(B, x - 0.19 * s, z - 0.19 * s, x + 0.19 * s, z + 0.19 * s, y + 1.16 * s, y + 1.5 * s, mul(c, 0.7)); }
  cone(B, x, z, 0.5 * s, y + 1.5 * s, y + 1.86 * s, k);
  if (lod >= 2) B.box('c', x - 0.06 * s, z - 0.06 * s, x + 0.06 * s, z + 0.06 * s, y + 1.82 * s, y + 2.05 * s, c);
}
// 狛犬（台＋からだ）・きつね（白）
function komainu(B, x, z, y, ang, c, lod) {
  B.box('c', x - 0.4, z - 0.4, x + 0.4, z + 0.4, y, y + 0.9, '#a7a39a');
  if (lod >= 2) { B.obox('c', x, z, ang, 0.55, 0.4, y + 0.9, y + 1.35, c); B.obox('c', x + Math.cos(ang) * 0.12, z + Math.sin(ang) * 0.12, ang, 0.3, 0.36, y + 1.35, y + 1.7, c); }
}

/* ---------- 和風の屋根（そり・てり）----------
   o：{ r（壁の外の線 [x0,z0,x1,z1]）, y（軒桁の上）, t: 'iri' 入母屋 | 'yose' 寄棟 | 'kiri' 切妻 | 'hogyo' 宝形, ax（棟 'x' | 'z'）,
        oh（軒の出）, og（けらばの出：切妻）, e0, e1（切妻の 片がわの軒を のばす：流造）, p（勾配：壁から棟まで）, cv（てり 0〜0.6）, up（軒反り m）, k1（入母屋の妻 0.3〜0.7）,
        m, c, su（屋根の質感）, th（軒先の厚み）, fc（軒先の色）, uc（軒裏の色）, gc（妻の色）, hc（破風の色）,
        rh（大棟の高さ）, rw（大棟のはば）, rc（棟の色）, oni（鬼瓦）, sumi（隅棟）, chigi（千木の色）, katsuo（鰹木の数）, kc（鰹木の色）, cut（すそだけ：塔）, nd, ns, lod }
   返り値：いちばん高いところ（m） */
function jroof(B, o) {
  const lod = o.lod == null ? 2 : o.lod, r = o.r, w = r[2] - r[0], d = r[3] - r[1];
  if (w < 0.3 || d < 0.3) return o.y;
  const t = lod < 1 && (o.t || 'iri') === 'iri' ? 'yose' : (o.t || 'iri'), kiri = t === 'kiri';   // 遠くは 入母屋 → 寄棟
  let ax = o.ax || (w >= d ? 'x' : 'z');
  if (!kiri && (ax === 'x' ? w : d) < (ax === 'x' ? d : w) - 0.01) ax = ax === 'x' ? 'z' : 'x';   // 寄棟・入母屋は 長いほうに棟
  const aX = ax === 'x', S = aX ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];
  const u0 = aX ? r[0] : r[1], u1 = aX ? r[2] : r[3], v0 = aX ? r[1] : r[0], v1 = aX ? r[3] : r[2];
  const oh = o.oh == null ? 1.2 : o.oh, og = kiri ? (o.og == null ? Math.min(oh, 0.9) : o.og) : oh;
  const e0 = kiri ? (o.e0 || 0) : 0, e1 = kiri ? (o.e1 || 0) : 0;
  const U0 = u0 - og, U1 = u1 + og, V0 = v0 - oh - e0, V1 = v1 + oh + e1, vm = (v0 + v1) / 2, hw = (v1 - v0) / 2;
  const cv = lod >= 1 ? (o.cv == null ? 0.35 : o.cv) : 0, p = o.p == null ? 0.55 : o.p, y = o.y;
  const fq = x => (1 - cv) * x + cv * x * x, rise = p * hw, yr = y + 0.25 + rise;
  const prof = (dr, dw) => { const H = rise / Math.max(0.1, 1 - fq(Math.min(0.95, dw / dr))); return dd => yr - H * (1 - fq(cl(dd / dr, 0, 1))); };
  const drF = vm - V0, drB = V1 - vm, hF = prof(drF, oh + e0), hB = prof(drB, oh + e1);
  const dh = t === 'iri' ? cl((o.k1 || 0.4) * drF, Math.min(drF * 0.7, oh + 0.25), drF - 0.4) : drF;
  const e2 = t === 'iri' ? Math.min(0.7, (U1 - U0 - 2 * dh) * 0.1 + 0.25) : 0;
  const up = lod >= 1 ? (o.up || 0) : 0, Lc = Math.max(1, Math.min(U1 - U0, V1 - V0) * 0.42), dl = Math.min(t === 'iri' ? dh : drF * 0.85, oh * 1.7 + 0.4);
  const lift = (cd, dd) => up ? up * Math.pow(Math.max(0, 1 - cd / Lc), 2) * Math.pow(Math.max(0, 1 - dd / dl), 2) : 0;
  const m = o.m || 'c', c = o.c || W1, su = o.su || 4, slk = Math.sqrt(1 + p * p);
  const nd = lod >= 2 ? (o.nd || 3) : 1, ns = lod >= 2 ? (o.ns || 6) : lod >= 1 ? 2 : 1;
  const spc = (a, b, j, n) => n <= 1 ? (j ? b : a) : a + (b - a) * (0.5 - 0.5 * Math.cos(PI * j / n));
  const dpc = (a, b, i, n) => a + (b - a) * Math.pow(i / n, 1.2);
  // 面：d（軒からの距離）d0〜d1、各 d で s は sa(d)〜sb(d)。行ごとに [点, u, v, s]
  const face = (d0, d1, n1, n2, sa, sb, hf, pt, hip) => {
    const rows = [];
    for (let i = 0; i <= n1; i++) { const dd = dpc(d0, d1, i, n1), a = sa(dd), b = sb(dd), row = [];
      for (let j = 0; j <= n2; j++) { const s = spc(a, b, j, n2), cd = hip ? Math.min(s - a, b - s) : Math.min(s - U0, U1 - s); row.push([pt(s, dd, hf(dd) + lift(cd, dd)), s / su, dd * slk / su, s]); }
      rows.push(row); }
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) { const a = rows[i][j], b = rows[i][j + 1], q = rows[i + 1][j + 1], e = rows[i + 1][j];
      B.quad(m, a[0], b[0], q[0], e[0], null, c, [a[1], a[2], b[1], b[2], q[1], q[2], e[1], e[2]]); }
    return rows;
  };
  const PF = (s, dd, h) => S(s, h, V0 + dd), PB = (s, dd, h) => S(s, h, V1 - dd), PL = (s, dd, h) => S(U0 + dd, h, s), PR = (s, dd, h) => S(U1 - dd, h, s);
  const eaves = [], verges = [];
  let ridge = null, top = yr, gab = [];
  const nsE = Math.max(1, Math.round(ns * (V1 - V0) / Math.max(1, U1 - U0)));
  if (kiri) {
    const F1 = face(0, drF, nd, ns, () => U0, () => U1, hF, PF, false), F2 = face(0, drB, nd, ns, () => U0, () => U1, hB, PB, false);
    eaves.push([F1, 'F'], [F2, 'B']); verges.push([F1, 0], [F1, ns], [F2, 0], [F2, ns]);
    ridge = [U0, U1]; gab = [[u0, v0, v1, y, hF, hB]];
    gab.push([u1, v0, v1, y, hF, hB]);
  } else {
    const iri = t === 'iri', dT = iri ? dh : drF, cut = o.cut ? Math.min(o.cut, dT) : dT, n1 = iri ? Math.max(1, nd - 1) : nd;
    const F1 = face(0, cut, n1, ns, dd => U0 + dd, dd => U1 - dd, hF, PF, true), F2 = face(0, cut, n1, ns, dd => U0 + dd, dd => U1 - dd, hF, PB, true);
    const E1 = face(0, cut, n1, nsE, dd => V0 + dd, dd => V1 - dd, hF, PL, true), E2 = face(0, cut, n1, nsE, dd => V0 + dd, dd => V1 - dd, hF, PR, true);
    eaves.push([F1, 'F'], [F2, 'B'], [E1, 'L'], [E2, 'R']);
    if (lod >= 2 && o.sumi) for (const [Fq, j] of [[F1, 0], [F1, ns], [F2, 0], [F2, ns]]) for (let i = 0; i < n1; i++) beam(B, add(Fq[i][j][0], 0.1), add(Fq[i + 1][j][0], 0.1), 0.3, 0.22, o.rc || mul(c, 0.55));
    if (iri && !o.cut) { const n2 = Math.max(1, nd - 1);
      const G1 = face(dh, drF, n2, ns, () => U0 + dh - e2, () => U1 - dh + e2, hF, PF, false), G2 = face(dh, drF, n2, ns, () => U0 + dh - e2, () => U1 - dh + e2, hF, PB, false);
      verges.push([G1, 0], [G1, ns], [G2, 0], [G2, ns]);
      ridge = [U0 + dh - e2, U1 - dh + e2]; gab = [[U0 + dh, V0 + dh, V1 - dh, hF(dh), hF, hF], [U1 - dh, V0 + dh, V1 - dh, hF(dh), hF, hF]];
    } else if (!o.cut) ridge = U1 - U0 - 2 * drF > 0.1 ? [U0 + drF, U1 - drF] : null;
    if (o.cut) top = hF(cut);
  }
  // 軒先（あつみ）・軒裏（壁まで）
  const th = o.th == null ? 0.25 : o.th, fc = o.fc || mul(c, 0.5), uc = o.uc || [0.36, 0.3, 0.26];
  if (lod >= 2) for (const [rows, side] of eaves) {
    const r0 = rows[0], n = r0.length, sa = r0[0][3], sb = r0[n - 1][3];
    const wp = s => side === 'F' || side === 'B' ? S(kiri ? s : lerp(u0, u1, (s - sa) / (sb - sa || 1)), y, side === 'F' ? v0 : v1) : S(side === 'L' ? u0 : u1, y, lerp(v0, v1, (s - sa) / (sb - sa || 1)));
    for (let j = 0; j + 1 < n; j++) {
      const a = r0[j][0], b = r0[j + 1][0], a2 = [a[0], a[1] - th, a[2]], b2 = [b[0], b[1] - th, b[2]];
      if (th > 0) B.quad('c', a2, b2, b, a, null, fc);
      B.quad('c', a2, wp(r0[j][3]), wp(r0[j + 1][3]), b2, null, uc);
    }
  }
  // 破風（けらばの板）
  if (lod >= 2) { const hb = o.hb || Math.max(0.3, th * 1.4), hc = o.hc || fc;
    for (const [rows, j] of verges) for (let i = 0; i + 1 < rows.length; i++) { const a = rows[i][j][0], b = rows[i + 1][j][0]; B.quad('c', [a[0], a[1] - hb, a[2]], [b[0], b[1] - hb, b[2]], b, a, null, hc); } }
  // 妻（三角の壁）
  const gc = o.gc || [0.42, 0.34, 0.27], ng = lod >= 2 ? Math.max(2, nd) : 1;
  for (const [sg, va, vb, yb, h1, h2] of gab) {
    if (lod < 1) { B.tri('c', S(sg, yb, va), S(sg, Math.max(yb, h1(vm - V0)), vm), S(sg, yb, vb), null, gc); continue; }
    const pts = [[va, yb]];
    for (let i = 0; i <= ng; i++) { const v = lerp(va, vm, i / ng); pts.push([v, Math.max(yb, h1(v - V0) - 0.04)]); }
    for (let i = ng - 1; i >= 0; i--) { const v = lerp(vb, vm, i / ng); pts.push([v, Math.max(yb, h2(V1 - v) - 0.04)]); }
    pts.push([vb, yb]);
    const cp = S(sg, yb, vm);
    for (let i = 0; i + 1 < pts.length; i++) B.tri('c', cp, S(sg, pts[i][1], pts[i][0]), S(sg, pts[i + 1][1], pts[i + 1][0]), null, gc);
  }
  // 大棟・鬼瓦
  if (ridge && lod >= 1) {
    const rh = lod >= 1 ? (o.rh == null ? 0.45 : o.rh) : 0.15, rw = o.rw || 0.45, rc = o.rc || mul(c, 0.5);
    const a = S(ridge[0], 0, vm - rw / 2), b = S(ridge[1], 0, vm + rw / 2);
    if (lod >= 2) B.box('c', Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]), yr - 0.25, yr + rh, rc);
    else { const q = (s1, v1, h) => S(s1, h, v1); B.quad('c', q(ridge[0], vm - rw / 2, yr + rh), q(ridge[1], vm - rw / 2, yr + rh), q(ridge[1], vm + rw / 2, yr + rh), q(ridge[0], vm + rw / 2, yr + rh), null, rc);
      B.quad('c', q(ridge[0], vm - rw / 2, yr - 0.2), q(ridge[1], vm - rw / 2, yr - 0.2), q(ridge[1], vm - rw / 2, yr + rh), q(ridge[0], vm - rw / 2, yr + rh), null, rc);
      B.quad('c', q(ridge[1], vm + rw / 2, yr - 0.2), q(ridge[0], vm + rw / 2, yr - 0.2), q(ridge[0], vm + rw / 2, yr + rh), q(ridge[1], vm + rw / 2, yr + rh), null, rc); }
    top = Math.max(top, yr + rh);
    if (o.oni && lod >= 2) for (const sx of ridge) { const q0 = S(sx - 0.2, 0, vm - rw * 0.9), q1 = S(sx + 0.2, 0, vm + rw * 0.9); B.box('c', Math.min(q0[0], q1[0]), Math.min(q0[2], q1[2]), Math.max(q0[0], q1[0]), Math.max(q0[2], q1[2]), yr - 0.3, yr + rh + 0.35, o.oni === 1 ? rc : o.oni); }
    // 鰹木
    if (o.katsuo && lod >= 2) { const n = o.katsuo, kc = o.kc || [0.33, 0.27, 0.22];
      for (let i = 0; i < n; i++) { const s = lerp(ridge[0] + 0.9, ridge[1] - 0.9, (i + 0.5) / n), q0 = S(s - 0.16, 0, vm - rw / 2 - 0.4), q1 = S(s + 0.16, 0, vm + rw / 2 + 0.4);
        B.box('c', Math.min(q0[0], q1[0]), Math.min(q0[2], q1[2]), Math.max(q0[0], q1[0]), Math.max(q0[2], q1[2]), yr + rh, yr + rh + 0.3, kc); } }
    // 千木（棟の両はしで ×）
    if (o.chigi && lod >= 2) {
      const sR = (hF(drF) - hF(drF - 0.6)) / 0.6, ga = kiri ? [U0 + 0.06, U1 - 0.06] : [U0 + dh - e2 + 0.06, U1 - dh + e2 - 0.06], ch = C(o.chigi);
      for (const sg of ga) for (const sd of [-1, 1]) {
        const a1 = Math.min(1.4, hw * 0.4), b1 = 1.2 + rh, P1 = [vm - sd * a1, hF(drF - a1) + 0.05], P2 = [vm + sd * b1 * 0.7, yr + rh + b1 * Math.min(1.6, sR)];
        const dv = P2[0] - P1[0], dy = P2[1] - P1[1], L = Math.hypot(dv, dy), nv = -dy / L * 0.13, ny = dv / L * 0.13;
        B.quad('c', S(sg, P1[1] - ny, P1[0] - nv), S(sg, P2[1] - ny, P2[0] - nv), S(sg, P2[1] + ny, P2[0] + nv), S(sg, P1[1] + ny, P1[0] + nv), null, ch);
        top = Math.max(top, P2[1]);
      }
    }
  }
  if (t === 'hogyo' && !o.cut && lod >= 1) { const q = S((U0 + U1) / 2, 0, vm); B.cyl('c', q[0], q[2], 0.32, yr - 0.2, yr + 0.6, 6, o.rc || mul(c, 0.5)); if (lod >= 2) B.cyl('c', q[0], q[2], 0.2, yr + 0.6, yr + 1.1, 6, o.oni && o.oni !== 1 ? o.oni : [0.5, 0.45, 0.3]); top = Math.max(top, yr + 1.1); }
  return top;
}
const add = (p, dy) => [p[0], p[1] + dy, p[2]];
const bell = q => (1 + Math.cos(PI * q)) / 2;

/* 向拝（正面の ひさし）：枠 fr の 正面。uc まん中・kw 柱の間・vb 奥（本屋根の軒の下）・vf 前・yb 奥の高さ・dy 前で下がる
   o：{ m, c, su, th, fc, uc, kara（唐破風の むくり m）, gc, pc（柱の色）, y0（柱の下）, lod } */
function kohai(B, fr, uc, kw, vb, vf, yb, dy, o) {
  const lod = o.lod, n = lod >= 2 ? 3 : 1, kara = o.kara || 0, nu = kara && lod >= 1 ? (lod >= 2 ? 8 : 2) : 1;
  const ua = uc - kw / 2 - 0.6, ub = uc + kw / 2 + 0.6, th = o.th == null ? 0.22 : o.th, c = o.c || W1, m = o.m || 'c', su = o.su || 4;
  const H = (t, q) => yb - dy * (1 - (1 - t) * (1 - t)) + (kara ? kara * (bell(q) + 0.12 * Math.pow(Math.abs(q), 8)) * t * t : 0);
  const rows = [];
  for (let i = 0; i <= n; i++) { const tt = i / n, v = lerp(vb, vf, tt), row = []; for (let j = 0; j <= nu; j++) { const q = -1 + 2 * j / nu, u = lerp(ua, ub, j / nu), xz = fr.p(u, v); row.push([[xz[0], H(tt, q), xz[1]], u / su, (vb - v) / su]); } rows.push(row); }
  for (let i = 0; i < n; i++) for (let j = 0; j < nu; j++) { const a = rows[i][j], b = rows[i][j + 1], q = rows[i + 1][j + 1], e = rows[i + 1][j]; B.quad(m, a[0], b[0], q[0], e[0], null, c, [a[1], a[2], b[1], b[2], q[1], q[2], e[1], e[2]]); }
  const fr0 = rows[n], yl = yb - dy, fc = o.fc || mul(c, 0.5), ucol = o.uc || [0.36, 0.3, 0.26], pc = o.pc || [0.5, 0.4, 0.3];
  if (lod >= 2) for (let j = 0; j < nu; j++) { const a = fr0[j][0], b = fr0[j + 1][0], hb = kara ? 0.45 : th; B.quad('c', [a[0], a[1] - hb, a[2]], [b[0], b[1] - hb, b[2]], b, a, null, kara ? (o.hc || fc) : fc);
    const ia = fr.p(lerp(ua, ub, j / nu), vf + 0.7), ib = fr.p(lerp(ua, ub, (j + 1) / nu), vf + 0.7); B.quad('c', [a[0], a[1] - hb, a[2]], [ia[0], yl - 0.45, ia[1]], [ib[0], yl - 0.45, ib[1]], [b[0], b[1] - hb, b[2]], null, ucol); }
  // 柱と 虹梁
  const y0 = o.y0 || 0, pv = vf + 0.6, ps = lod >= 2 ? 0.17 : 0.2;
  for (const u of [uc - kw / 2, uc + kw / 2]) { const q = fr.p(u, pv); if (lod >= 2) post(B, q[0] - ps, q[1] - ps, q[0] + ps, q[1] + ps, y0, yl - 0.3, pc); else trunk3(B, q[0], q[1], y0, yl - 0.3, ps, pc); }
  if (lod >= 2) { const a = fr.p(uc - kw / 2, pv), b = fr.p(uc + kw / 2, pv); beam(B, [a[0], yl - 0.55, a[1]], [b[0], yl - 0.55, b[1]], 0.3, 0.45, pc); }
  if (kara && lod >= 2) {   // 唐破風の 妻（曲線の下）
    const gc = o.gc || pc, base = yl - 0.35;
    for (let j = 0; j < nu; j++) { const a = fr0[j][0], b = fr0[j + 1][0], qa = fr.p(lerp(ua, ub, j / nu), vf + 0.15), qb = fr.p(lerp(ua, ub, (j + 1) / nu), vf + 0.15);
      if (Math.abs(lerp(ua, ub, j / nu) - uc) > kw / 2 + 0.3 && Math.abs(lerp(ua, ub, (j + 1) / nu) - uc) > kw / 2 + 0.3) continue;
      B.quad('c', [qa[0], base, qa[1]], [qb[0], base, qb[1]], [qb[0], b[1] - 0.45, qb[1]], [qa[0], a[1] - 0.45, qa[1]], null, gc); }
  }
  return Math.max(yb, kara ? yl + kara : yb);
}

/* 社殿・お堂：枠 fr の (u0, v0)〜(u1, v1)（壁の線）・地面 y
   o：{ fm（壁の質感）, wc（色）, fl（床の高さ）, wh（壁の高さ）, en（縁のはば）, ec（縁の色）, rc2（高欄の色）, base（基壇）, bc, bm, bp（基壇の出）,
        roof（jroof の o）, rax: 'u' 平入 | 'v' 妻入, ko（向拝 { kw, kd, kara, dy }）, st（階段の色）, bw（柱間 m） } → 屋根のいちばん上 */
function shaden(B, P, fr, u0, v0, u1, v1, y, o) {
  const lod = P.lod, en = lod >= 2 ? (o.en || 0) : 0, base = o.base == null ? 0.3 : o.base, fl = Math.max(base + 0.1, o.fl == null ? 0.9 : o.fl), wh = o.wh || 3.4;
  const r = fr.R(u0, v0, u1, v1), uc = (u0 + u1) / 2, ro = o.roof || {};
  const bp = o.bp == null ? 0.7 : o.bp;
  if (base > 0.05 && lod >= 2) { const rb = fr.R(u0 - en - bp, v0 - en - bp, u1 + en + bp, v1 + en + bp); B.box(o.bm || 'c', rb[0], rb[1], rb[2], rb[3], y, y + base, o.bm ? W1 : (o.bc || '#aaa69d'), o.bm ? { su: 2 } : {}); }
  if (fl - base > 0.2 && lod >= 2) post(B, r[0] + 0.3, r[1] + 0.3, r[2] - 0.3, r[3] - 0.3, y + base, y + fl, [0.22, 0.2, 0.18]);
  if (en > 0) {
    const re = fr.R(u0 - en, v0 - en, u1 + en, v1 + en), ec = o.ec || '#7d6249';
    B.box('c', re[0], re[1], re[2], re[3], y + fl - 0.16, y + fl, ec);
    if (lod >= 2 && o.rail !== false) { const rc = o.rc2 || ec, rf = rfoot(re), hh = 0.7, gw = Math.min(3, (u1 - u0) * 0.3);
      for (const e of rf.edges) { const front = Math.abs(e.nx * -fr.dv[0] + e.nz * -fr.dv[1]) > 0.9 && (e.nx * -fr.dv[0] + e.nz * -fr.dv[1]) > 0;
        if (front) { const half = (e.L - gw) / 2; B.rail(T.rail, e, y + fl, hh, 0, rc, { to: half, su: 1.2, ends: false }); B.rail(T.rail, e, y + fl, hh, 0, rc, { from: half + gw, su: 1.2, ends: false }); }
        else B.rail(T.rail, e, y + fl, hh, 0, rc, { su: 1.2, ends: false }); } }
  }
  const yw = y + fl + wh, yf = lod >= 2 ? y + fl : y;
  B.facade(o.fm, rfoot(r), yf, yw, { bw: o.bw || 2.0, fh: yw - yf, tb: 4, tf: 1, vy: yf, c: o.wc || W1, ao: 0.9 });
  const roofO = Object.assign({ oh: 1.1 + en }, ro, { r, y: yw, ax: fr.ax(o.rax || 'u'), lod: o.rlod == null ? lod : o.rlod });
  let top = jroof(B, roofO);
  // 向拝と 階段
  const k = o.ko;
  if (k && lod >= 1) {
    const ohF = roofO.oh + (o.rax !== 'v' && ro[fr.fe] ? ro[fr.fe] : 0), kw = Math.min(k.kw || 3.6, (u1 - u0) * 0.8), kd = k.kd || 2.6;
    const yb = yw + 0.25 - ((ro.p || 0.55) * 0.55) * Math.min(ohF, 2.5) * 0.55;
    top = Math.max(top, kohai(B, fr, uc, kw, v0 - ohF + 0.5, v0 - ohF - kd + 0.4, yb, k.dy == null ? 0.55 : k.dy, Object.assign({}, ro, { kara: k.kara || 0, lod, y0: y + base, pc: o.kpc || o.ec || [0.45, 0.35, 0.27], gc: ro.gc, hc: ro.hc, fc: ro.fc, uc: ro.uc })));
  }
  if (o.st !== false && fl > 0.35 && lod >= 2) steps(B, fr, uc, Math.min(3.2, (u1 - u0) * 0.4), v0 - en - Math.min(2.4, fl * 1.6), v0 - en + 0.05, y, y + fl, o.st || o.ec || '#7d6249', lod);
  return top;
}

/* ---------- 鳥居 ----------
   まん中 (x, z)・柱を結ぶ向き ang・柱の間 w・高さ h。o：{ t: 'myo' 明神 | 'shin' 神明, c（柱）, kc（笠木）, lod, lite（千本鳥居の かんたん版）} */
function torii(B, x, z, y, ang, w, h, o) {
  const lod = o.lod, c = C(o.c || '#b8452f'), kc = C(o.kc || o.c || '#b8452f'), ca = Math.cos(ang), sa = Math.sin(ang);
  const at = (s, hh, q = 0) => [x + ca * s - sa * q, y + hh, z + sa * s + ca * q];
  const pr = cl(w * 0.05, 0.12, 0.55), shin = o.t === 'shin';
  if (lod < 1) { const kL0 = w / 2 + pr * 4, a0 = at(-kL0, h * 0.9, -pr), b0 = at(kL0, h * 0.9, -pr), a1 = at(-kL0, h, pr), b1 = at(kL0, h, pr);   // 笠木（前と上）と 柱 2 本
    B.quad('c', a0, b0, [b0[0], y + h, b0[2]], [a0[0], y + h, a0[2]], null, kc); B.quad('c', [a0[0], y + h, a0[2]], [b0[0], y + h, b0[2]], b1, a1, null, kc);
    for (const sg of [-1, 1]) { const q = at(sg * w / 2, 0); B.quad('c', [q[0] - ca * pr, y, q[2] - sa * pr], [q[0] + ca * pr, y, q[2] + sa * pr], [q[0] + ca * pr, y + h * 0.9, q[2] + sa * pr], [q[0] - ca * pr, y + h * 0.9, q[2] - sa * pr], null, c); } return y + h; }
  if (lod < 2 || o.lite) { for (const sg of [-1, 1]) { const q = at(sg * w / 2, 0); trunk3(B, q[0], q[2], y, y + h * 0.92, pr * 1.2, c); }
    const kL1 = w / 2 + pr * (shin ? 2.2 : 4.2); beam(B, at(-kL1, h * 0.94), at(kL1, h * 0.94), pr * 1.5, pr * 1.4, kc, true); if (!shin) beam(B, at(-w / 2 - pr * 2.4, h * 0.7), at(w / 2 + pr * 2.4, h * 0.7), pr, pr, c, false); return y + h; }
  for (const sg of [-1, 1]) { const q = at(sg * w / 2, 0);
    if (lod >= 2 && !o.lite) { B.cyl('c', q[0], q[2], pr, y, y + h * 0.9, 8, c, { notop: true }); if (!shin) B.cyl('c', q[0], q[2], pr * 1.22, y, y + Math.min(1, h * 0.12), 8, [0.16, 0.15, 0.15], { notop: true }); }
    else post(B, q[0] - pr, q[2] - pr, q[0] + pr, q[2] + pr, y, y + h * 0.92, c); }
  const nk = shin ? w / 2 + pr * 0.2 : w / 2 + pr * 2.6, kL = shin ? w / 2 + pr * 2.2 : w / 2 + pr * 4.2, ht = pr * 1.0, kh = pr * 1.25;
  beam(B, at(-nk, h * 0.7), at(nk, h * 0.7), pr * 1.1, ht, c, !o.lite);   // 貫
  if (shin) { beam(B, at(-kL, h * 0.95), at(kL, h * 0.95), pr * 1.8, kh * 1.1, kc, true); return y + h * 1.0; }
  beam(B, at(-w / 2 - pr * 2.8, h * 0.86), at(w / 2 + pr * 2.8, h * 0.86), pr * 1.3, ht * 1.05, c, !o.lite);   // 島木
  if (lod >= 2 && !o.lite) {   // 笠木（両はしが そる）
    const s0 = w / 2 + pr * 1.2, up = pr * 1.1;
    beam(B, at(-s0, h * 0.94), at(s0, h * 0.94), pr * 1.55, kh, kc, false);
    beam(B, at(s0, h * 0.94), at(kL, h * 0.94 + up), pr * 1.5, kh, kc, true); beam(B, at(-kL, h * 0.94 + up), at(-s0, h * 0.94), pr * 1.5, kh, kc, true);
    const g = at(0, h * 0.78); B.obox('c', g[0], g[2], ang, pr * 1.3, pr * 0.9, y + h * 0.73, y + h * 0.86, c);   // 額束
  } else beam(B, at(-kL, h * 0.95), at(kL, h * 0.95), pr * 1.5, kh, kc, true);
  return y + h + pr;
}
// 手水舎（4本柱の 小さな屋根）
function chozuya(B, P, fr, uc, vc, y, rm, rc, wc) {
  const lod = P.lod, w = 2.8, d = 2.2, r = fr.R(uc - w / 2, vc - d / 2, uc + w / 2, vc + d / 2);
  for (const [x, z] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) post(B, x - 0.12, z - 0.12, x + 0.12, z + 0.12, y, y + 2.4, wc);
  const bs = fr.R(uc - 0.9, vc - 0.45, uc + 0.9, vc + 0.45); B.box('c', bs[0], bs[1], bs[2], bs[3], y, y + 0.75, '#9e9a92');
  if (lod >= 2) B.flat('c', A.rin(bs, 0.1), y + 0.76, [0.35, 0.45, 0.48]);
  jroof(B, { r, y: y + 2.4, t: 'kiri', ax: fr.ax('u'), oh: 0.7, og: 0.5, p: 0.75, cv: 0.3, up: 0.15, m: rm, c: rc.c, su: rc.su, th: 0.15, uc: rc.uc, gc: wc, fc: rc.fc, rh: 0.25, rc: rc.rc, lod: Math.min(lod, 1) });
}
// 玉垣（すかしの 柵：枠の長方形のまわり。あける所 gap：正面のまん中）
function tamagaki(B, fr, u0, v0, u1, v1, y, h, c, gap) {
  const rf = rfoot(fr.R(u0, v0, u1, v1));
  for (const e of rf.edges) { const fd = e.nx * -fr.dv[0] + e.nz * -fr.dv[1];
    if (gap && fd > 0.9) { const half = (e.L - gap) / 2; B.wallE(T.tama, e, y, y + h, c, { to: half, uv: [0, half / 1.6, 0, 1] }); B.wallE(T.tama, e, y, y + h, c, { from: half + gap, uv: [0, half / 1.6, 0, 1] }); }
    else B.wallE(T.tama, e, y, y + h, c, { uv: [0, e.L / 1.6, 0, 1] }); }
}
T.rail = TX('a:rail', 64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); fill(g, 0, 0, w, h * 0.14, '#f2f0ea'); fill(g, 0, h * 0.5, w, h * 0.07, '#e6e3dc'); for (let i = 0; i < 4; i++) fill(g, i * w / 4, 0, Math.max(1, w / 24), h, '#e9e6df'); }, { alpha: true });
T.tama = TX('a:tama', 128, 64, (g, w, h) => { g.clearRect(0, 0, w, h); fill(g, 0, h * 0.08, w, h * 0.12, '#efede6'); fill(g, 0, h * 0.72, w, h * 0.1, '#efede6'); fill(g, 0, h * 0.9, w, h * 0.1, '#d9d6cf');
  for (let i = 0; i < 8; i++) { fill(g, i * w / 8 + w / 64, 0, w / 22, h, '#f3f1ea'); fill(g, i * w / 8 + w / 64, 0, w / 22, h * 0.05, '#c9c6bf'); } }, { alpha: true });

/* ---------- 遠く（lod -1）の めやす ---------- */
T.farJinja = TX('far:jinja', 128, 128, (g, w, h, R) => { const k = w / 128; fill(g, 0, 0, w, h, '#36502f');
  for (let i = 0; i < 70; i++) { const x = R() * w, y = R() * h * 0.75, rad = (5 + R() * 9) * k; g.fillStyle = css(mix('#3e5a34', '#5d7a44', R())); g.beginPath(); g.arc(x, y, rad, 0, PI * 2); g.fill(); }
  fill(g, 0, h * 0.78, w, h * 0.22, '#5a4f40'); for (let i = 0; i < 8; i++) fill(g, i * w / 8, h * 0.8, w / 40, h * 0.2, '#b8452f'); fill(g, 0, h * 0.8, w, h * 0.03, '#b8452f'); });

/* ================= 神社（shrine・taisha）================= */
// 屋根の材料ごとの めやす
const RM = {
  dou: { m: T.dou, c: W1, su: 4, p: 0.56, cv: 0.42, up: 0.42, th: 0.16, fc: '#4f7d6c', rc: '#5d8f7c', uc: [0.42, 0.33, 0.25] },
  dou2: { m: T.dou2, c: W1, su: 4, p: 0.56, cv: 0.42, up: 0.42, th: 0.16, fc: '#7d5236', rc: '#8f5f3e', uc: [0.48, 0.38, 0.28] },
  hiwada: { m: T.hiwada, c: W1, su: 3, p: 0.62, cv: 0.4, up: 0.38, th: 0.45, fc: '#3f2e24', rc: '#45342a', uc: [0.45, 0.36, 0.28] },
  kawara: { m: T.kawara, c: W1, su: 3.2, p: 0.62, cv: 0.38, up: 0.32, th: 0.32, fc: '#4a4d51', rc: '#55595e', uc: [0.33, 0.28, 0.24], oni: 1 },
  kaya: { m: T.kaya, c: W1, su: 3, p: 0.95, cv: 0.05, up: 0, th: 0.7, fc: '#5e5038', rc: '#4b3e2c', uc: [0.42, 0.36, 0.28] },
  kane: { m: T.kane, c: '#8f969c', su: 3, p: 0.5, cv: 0.2, up: 0.12, th: 0.12, fc: '#6e757a', rc: '#7c8388', uc: [0.4, 0.34, 0.28] }
};
const JL = [
  { n: '朱の社殿・緑の銅板', wall: 'shu', rm: 'dou', hr: 'iri', ko: 'shed', hon: 'nagare', tc: '#b5432e', kc: '#2b2725', fo: 0.85, tr: 'mix', base: '#e9e5db' },
  { n: '白木・檜皮ぶき', wall: 'ki', wc: '#f6ecda', rm: 'hiwada', hr: 'iri', ko: 'shed', hon: 'nagare', chigi: 1, tc: '#a68a68', kc: '#8f7658', fo: 1.0, tr: 'cedar' },
  { n: '神明造・かやの屋根', wall: 'ki', wc: '#f2e7d0', rm: 'kaya', hr: 'kiri', ko: 0, hon: 'shinmei', chigi: 1, tt: 'shin', tc: '#ab9370', kc: '#9c8464', fo: 1.1, tr: 'cedar' },
  { n: '石の鳥居・いぶし瓦', wall: 'ki', wc: '#b49f84', rm: 'kawara', hr: 'iri', ko: 'shed', hon: 'nagare', tc: '#b1ada4', kc: '#a29e95', fo: 0.7, tr: 'mix' },
  { n: '千本鳥居の稲荷', wall: 'shu', rm: 'dou', hr: 'kiri', ko: 'shed', hon: 'nagare', tc: '#c0462c', kc: '#2b2725', senbon: 1, fox: 1, fo: 0.9, tr: 'mix', base: '#e9e5db' },
  { n: '黒い社殿・銅板', wall: 'ki', wc: '#5d4d42', rm: 'dou', rt: '#c7d0ca', hr: 'iri', ko: 'kara', hon: 'nagare', tc: '#35302d', kc: '#262321', fo: 0.85, tr: 'cedar', ec: '#3a302a' },
  { n: '白い鳥居・新しい銅', wall: 'ki', wc: '#fff6e4', rm: 'dou2', hr: 'iri', ko: 'shed', hon: 'nagare', tc: '#d6d3cb', kc: '#c7c4bc', fo: 0.55, tr: 'broad' },
  { n: '森の小さな社・トタン', wall: 'ki', wc: '#9e8b74', rm: 'kane', hr: 'kiri', ko: 'shed', hon: 'kasuga', tc: '#8c7b65', kc: '#7b6b57', fo: 1.35, tr: 'mix', small: 1 },
  { n: '朱と白・唐破風', wall: 'shu', rm: 'kawara', hr: 'iri', ko: 'kara', hon: 'nagare', tc: '#bf452d', kc: '#bf452d', fo: 0.6, tr: 'broad', base: '#e9e5db' },
  { n: '青銅の鳥居・松林', wall: 'ki', wc: '#ead9bd', rm: 'dou', hr: 'iri', ko: 'shed', hon: 'nagare', tc: '#5f8d7d', kc: '#507b6d', fo: 0.75, tr: 'pine' }
];
const roofOf = (L, extra) => { const q = RM[L.rm] || RM.dou; return Object.assign({}, q, L.rt ? { c: L.rt } : {}, extra || {}); };
A.arch('p_jinja', {
  looks: JL,
  far(L, P) { const h = cl(7 + Math.sqrt(P.n || 4) * 1.2, 8, P.ko.big ? 18 : 14); return { H: h, base: 0, wall: T.farJinja, bw: 8, fh: h, tb: 1, tf: 1, roof: null, rt: 'flat', top: T.mori, tsu: 12, ct: L.fo < 0.7 ? [0.82, 0.86, 0.76] : W1, ins: 0.5 }; },   // 遠くは 鎮守の森（緑と 朱の玉垣）
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, big = !!P.ko.big, sc = big ? 1.5 : 1, nv0 = B.nv;
    const Y = 0.06, YG = Y + 0.05, YS = Y + 0.1;
    // 地面：近くは 土（木が立つ）・遠くは 森を上から見た質感
    if (lod >= 2) pad(B, P, F, Y, T.tsuchi, L.soil || '#6b6a52', { su: 8, wm: T.ishigaki, wsu: 4 });
    else pad(B, P, F, Y, T.mori, L.fo < 0.7 ? '#b8c0a8' : W1, { su: 10, wm: lod >= 1 ? T.ishigaki : 'c', wsu: 4 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 0.8)), fr = frm(r0, P.front), W = fr.W, D = fr.D, uc = W / 2;
    const fo = L.fo || 0.8, small = !!L.small || W < 24 || D < 24;
    const shu = L.wall === 'shu', fm = shu ? T.shu : T.ki, wc = L.wc || W1, rf = roofOf(L);
    const ec = L.ec || (shu ? '#a9432e' : mix(mul(C(L.wc || '#ffffff'), 0.62), '#6a5240', 0.4));
    const uc0 = shu ? [0.62, 0.27, 0.2] : mix(mul(C(L.wc || '#ffffff'), 0.5), '#3a2e26', 0.3);
    // 大きさ
    const sideF = W > 26 ? cl(W * 0.15 * fo, 2, 30) : 0, backF = D > 24 ? cl(D * 0.13 * fo, 2, 30) : 1.2, cw = W - 2 * sideF;
    let hw = cl(cw * (small ? 0.4 : 0.46), 3.2, (small ? 9 : 15) * sc), hd = cl(hw * 0.68, 3, 11 * sc);
    let bw = cl(hw * 0.52, 2, 8.5 * sc), bd = cl(bw * 0.95, 2, 8 * sc), gap = cl(hd * 0.22, 0.6, 3.5);
    const need = Math.max(6.5, D * 0.33), avail = D - backF - need;
    if (avail < hd + gap + bd) { const k = Math.max(0.5, avail / (hd + gap + bd)); hd *= k; bd *= k; gap *= k; bw = Math.min(bw, hw * 0.6); }
    const hon = avail > 3.5 + (hd + gap + bd) * 0.5;
    const vb1 = D - backF, vb0 = vb1 - bd, va1 = hon ? vb0 - gap : vb1, va0 = Math.max(need * 0.7, va1 - hd);
    if (!hon) hd = va1 - va0;
    const sw = cl(hw * 0.3, 1.8, 6 * sc), tw = cl(sw + 1.8, 2.6, 10 * sc), th = cl(tw * 1.15 + 0.9, 3.2, 14), tv = cl(va0 * 0.16, 1.4, 6);
    const kw = Math.min(cw, Math.max(hw + 10, 16) * sc), kv1 = Math.min(D, vb1 + 2);
    const core = fr.R(uc - kw / 2, 0, uc + kw / 2, kv1);
    // 境内の砂利・参道
    if (lod >= 1) { flatU(B, fr, T.jari, uc - kw / 2, 0, uc + kw / 2, kv1, YG, '#e4e0d6', 4); flatU(B, fr, T.ishi, uc - sw / 2, 0, uc + sw / 2, va0 - 0.2, YS, W1, 4); }
    else flatU(B, fr, 'c', uc - kw / 2, 0, uc + kw / 2, kv1, YG, '#c9c4b8');
    // 鳥居（二の鳥居・千本鳥居）
    const tr0 = fr.p(uc, tv);
    torii(B, tr0[0], tr0[1], YS, fr.aU, tw, th, { c: L.tc, kc: L.kc, t: L.tt, lod });
    if (lod >= 2 && va0 > 40) { const q = fr.p(uc, va0 * 0.55); torii(B, q[0], q[1], YS, fr.aU, tw * 0.9, th * 0.9, { c: L.tc, kc: L.kc, t: L.tt, lod }); }
    if (L.senbon && lod >= 1) { const v0s = tv + 3, v1s = va0 - 3.2, n = Math.max(0, Math.floor((v1s - v0s) / 1.5)), tw2 = Math.min(sw + 0.5, 3.2);
      if (lod >= 2) for (let i = 0; i < Math.min(n, 16); i++) { const q = fr.p(uc, v0s + (v1s - v0s) * (i + 0.5) / Math.min(n, 16)); torii(B, q[0], q[1], YS, fr.aU, tw2, 2.7, { c: L.tc, kc: L.kc, lod, lite: 1 }); }
      else if (n > 1) { for (const sg of [-1, 1]) { const a = fr.p(uc + sg * tw2 / 2, v0s), b = fr.p(uc + sg * tw2 / 2, v1s); B.wall('c', a[0], a[1], b[0], b[1], YS, YS + 2.5, L.tc); }
        flatU(B, fr, 'c', uc - tw2 / 2 - 0.4, v0s, uc + tw2 / 2 + 0.4, v1s, YS + 2.7, L.kc); } }
    // 拝殿
    const haiR = { t: L.hr === 'kiri' ? 'kiri' : 'iri', k1: 0.4, rh: lod >= 2 ? 0.5 : 0.3, oni: rf.oni, sumi: !small && L.rm === 'kawara', chigi: L.chigi && !hon ? '#6b4f3a' : 0, gc: shu ? '#f0ece2' : mul(C(L.wc || '#ffffff'), 0.55), hc: shu ? '#b8452f' : rf.fc, uc: uc0, nd: 3, ns: 6 };
    B.top = Math.max(B.top, shaden(B, P, fr, uc - hw / 2, va0, uc + hw / 2, va1, YG, {
      fm, wc, fl: small ? 0.7 : 1.0, wh: cl(hd * 0.48 + 1.2, 2.8, 5.5), en: 0.9, ec, base: 0.35, bc: L.base || '#b2aea4', bp: 0.6,
      roof: roofOf(L, haiR), rax: 'u', ko: L.ko ? { kw: Math.min(hw * 0.4, 6), kd: 2.4, kara: L.ko === 'kara' ? 0.8 : 0 } : null, kpc: shu ? '#b8452f' : ec }));
    if (lod < 1) return;
    // 幣殿・本殿・玉垣
    if (hon) {
      const pw2 = Math.min(bw * 0.7, hw * 0.4);
      if (gap > 0.8 && lod >= 2) { const rr0 = fr.R(uc - pw2 / 2, va1 - 0.3, uc + pw2 / 2, vb0 + 0.3); post(B, rr0[0], rr0[1], rr0[2], rr0[3], YG, YG + 3.0, mul(C(shu ? '#b8452f' : (L.wc || '#c7a87e')), shu ? 1 : 0.8));
        jroof(B, Object.assign(roofOf(L), { r: rr0, y: YG + 3.0, t: 'kiri', ax: fr.ax('v'), oh: 0.5, og: 0.3, p: 0.5, up: 0, th: 0.12, gc: haiR.gc, uc: uc0, lod: 1 })); }
      const hk = L.hon, fe = fr.fe;
      const honR = hk === 'shinmei' ? { t: 'kiri', cv: 0, up: 0, p: 0.9, chigi: '#7a5b40', katsuo: 6, kc: '#4b3a2e', rh: 0.45, og: 0.8, oh: 0.9 }
        : hk === 'kasuga' ? { t: 'kiri', p: 0.85, oh: 0.6, og: 0.5, chigi: L.chigi ? '#6b4f3a' : 0, katsuo: L.chigi ? 2 : 0 }
        : { t: 'kiri', p: 0.6, oh: 0.8, og: 0.6, [fe]: bd * 0.55, chigi: L.chigi ? '#6b4f3a' : 0, katsuo: L.chigi ? 3 : 0, kc: '#4b3a2e' };
      B.top = Math.max(B.top, shaden(B, P, fr, uc - bw / 2, vb0, uc + bw / 2, vb1, YG, {
        fm, wc, fl: hk === 'shinmei' ? 1.6 : 1.3, wh: cl(bd * 0.5 + 0.9, 1.9, 4), en: 0.7, ec, base: 0.4, bc: L.base || '#b2aea4', bp: 0.4, rail: true, rlod: lod >= 2 ? 2 : 0,
        roof: roofOf(L, Object.assign({ rh: 0.35, gc: haiR.gc, hc: haiR.hc, uc: uc0, nd: 2, ns: 4 }, honR)), rax: hk === 'kasuga' ? 'v' : 'u', st: ec }));
      tamagaki(B, fr, uc - bw / 2 - 1.6, vb0 - 1.2, uc + bw / 2 + 1.6, Math.min(D - 0.3, vb1 + 1.4), YG, lod >= 2 ? 1.2 : 1.0, shu ? '#c2492f' : '#c9c5bb', pw2 + 0.6);
    }
    const room = kw / 2 - sw / 2;
    if (lod >= 2) {
      // 灯籠・狛犬・手水舎
      const sc2 = small ? 0.85 : 1;
      if (va0 > 6) for (const sg of [-1, 1]) {
        const q = fr.p(uc + sg * (sw / 2 + 1.3), va0 - 3.4); toro(B, q[0], q[1], YS, 2.1 * sc2, C('#a8a49b'), lod);
        const q2 = fr.p(uc + sg * (sw / 2 + 0.8), va0 - 1.5); komainu(B, q2[0], q2[1], YS, fr.aV + PI + sg * 0.5, L.fox ? '#ecebe6' : '#9c988f', lod);
        if (va0 > 22) { const q3 = fr.p(uc + sg * (sw / 2 + 1.3), tv + 5); toro(B, q3[0], q3[1], YS, 2.1 * sc2, C('#a8a49b'), lod); }
      }
      if (room > 6 && va0 > 10) chozuya(B, P, fr, uc - sw / 2 - 3.2, cl(va0 * 0.5, 5, va0 - 4), YS, rf.m, rf, shu ? C('#b8452f') : mul(C(L.wc || '#ffffff'), 0.7));
      if (big && room > 14 && va0 > 18) {   // 神楽殿（舞台）
        const s1 = uc - hw / 2 - 3, s0 = Math.max(uc - kw / 2 + 1, s1 - 9);
        if (s1 - s0 > 6) shaden(B, P, fr, s0, va0 - 8, s1, va0 - 1, YG, { fm, wc, fl: 1.3, wh: 2.6, en: 0, base: 0.3, bc: '#b2aea4', roof: roofOf(L, { t: 'iri', rh: 0.3, uc: uc0, gc: haiR.gc, nd: 2, ns: 4 }), rax: 'u', st: false });
      }
    }
    if (!small && room > 12 && va0 > 14) {   // 社務所（和風の家）
      const s0 = uc + hw / 2 + 3, s1 = Math.min(uc + kw / 2 - 1, s0 + 11), v0s = Math.max(tv + 4, va0 - 6), v1s = Math.min(va1, v0s + 7);
      if (s1 - s0 > 6 && v1s - v0s > 5) { const rs = fr.R(s0, v0s, s1, v1s);
        B.facade(T.ki, rfoot(rs), YG, YG + 3.0, { bw: 1.9, fh: 3.0, tb: 4, tf: 1, vy: YG, c: mix(C(L.wc || '#ffffff'), [0.95, 0.93, 0.9], 0.4) });
        jroof(B, { r: rs, y: YG + 3.0, t: 'iri', ax: fr.ax('u'), oh: 0.9, p: 0.55, cv: 0.2, up: 0.1, m: T.kawara, c: W1, su: 3.2, th: 0.25, fc: '#4a4d51', rc: '#55595e', uc: [0.4, 0.34, 0.28], gc: [0.85, 0.82, 0.76], lod: lod >= 2 ? 1 : 0 }); }
    }
    // 御神木と 鎮守の森
    if (!small && hd > 4 && kw / 2 > hw / 2 + 5) { const q = fr.p(uc - hw / 2 - 3.5, va0 + 1.5); treeB(B, q[0], q[1], YG, 20 * sc, 6.5 * sc, '#4c6b38', R, lod); }
    const tr = L.tr, mixO = tr === 'cedar' ? { n: 0.65, p: 0 } : tr === 'pine' ? { n: 0.05, p: 0.7 } : tr === 'broad' ? { n: 0.1, p: 0.08 } : { n: 0.35, p: 0.05 };
    if (small && lod >= 2 && sideF < 1 && W > 12) grove(B, P, [fr.R(0, va0, Math.max(0.5, uc - kw / 2 + 2.5), D), fr.R(Math.min(W - 0.5, uc + kw / 2 - 2.5), va0, W, D)], [fr.R(uc - hw / 2 - 1, va0 - 1, uc + hw / 2 + 1, D)], Object.assign({ sp: 4.5, k: fo, h: [9, 16], y: Y, max: 10, vmax: left(B, nv0, lod) * 0.4 }, mixO));
    grove(B, P, F.rects.map(r => A.rin(r, 0.4)), [core], Object.assign({ sp: tr === 'pine' ? 6.5 : 5.5, k: fo, h: [12, 21], y: Y, max: lod >= 2 ? 60 : 4, vmax: left(B, nv0, lod) }, mixO));
  }
});
A.kinds({ shrine: 'p_jinja', taisha: ['p_jinja', { big: 1 }] });

/* ================= 寺（temple・bigtemple）================= */
T.tera2 = TX('f:tera2', 256, 256, (g, w, h, R) => paintSha(g, w, h, R, { pil: '#aeada6', beam: '#a7a69f', wall: '#dcdad3', low: '#dcdad3', lat: '#6d6e6c', dark: '#34383c', door: '#8c8e8e', bays: ['L', 'W', 'S', 'W'], metal: '#9a9a90' }));
T.boseki = TX('a:boseki', 256, 64, (g, w, h, R) => { g.clearRect(0, 0, w, h); const k = w / 256; let x = 2 * k;
  while (x < w - 14 * k) { const sw = (14 + R() * 9) * k, sh = h * (0.5 + R() * 0.42), c0 = R() < 0.28 ? C('#47484b') : mix('#9a9892', '#c6c4be', R());
    if (R() < 0.45) fill(g, x + sw * 0.78, h - sh * 1.08, Math.max(1, 1.6 * k), sh * 0.95, '#cbbd9e');   // 卒塔婆
    fill(g, x, h * 0.8, sw, h * 0.2, mul(c0, 0.85)); fill(g, x + sw * 0.2, h - sh, sw * 0.6, sh - h * 0.18, c0); fill(g, x + sw * 0.2, h - sh, sw * 0.6, Math.max(1, k), mul(c0, 1.15));
    if (R() < 0.6) { fill(g, x + sw * 0.04, h * 0.66, 2.5 * k, h * 0.14, '#4f7a3a'); fill(g, x + sw * 0.84, h * 0.66, 2.5 * k, h * 0.14, '#a8483e'); }
    x += sw + (4 + R() * 7) * k; } }, { alpha: true });
// 塀（築地塀・土塀）：枠の u0〜u1 を v に。かさは 瓦（cc）
function hei(B, fr, u0, u1, v, y, h, wc, cc, lod) {
  if (u1 - u0 < 0.6) return;
  const a = fr.p(u0, v), b = fr.p(u1, v), cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = u1 - u0;
  if (lod >= 2) B.obox('c', cx, cz, ang, L, 0.5, y, y + h, wc); else B.wall('c', a[0], a[1], b[0], b[1], y, y + h, wc);
  if (lod === 1) B.flat('c', [Math.min(a[0], b[0]) - 0.3, Math.min(a[1], b[1]) - 0.3, Math.max(a[0], b[0]) + 0.3, Math.max(a[1], b[1]) + 0.3], y + h, cc);
  if (lod >= 2) { const ca = Math.cos(ang), sa = Math.sin(ang), q = (s1, w1, hh) => [cx + ca * s1 - sa * w1, y + hh, cz + sa * s1 + ca * w1];
    B.quad('c', q(-L / 2 - 0.15, -0.5, h - 0.06), q(L / 2 + 0.15, -0.5, h - 0.06), q(L / 2 + 0.15, 0, h + 0.38), q(-L / 2 - 0.15, 0, h + 0.38), null, cc);
    B.quad('c', q(L / 2 + 0.15, 0.5, h - 0.06), q(-L / 2 - 0.15, 0.5, h - 0.06), q(-L / 2 - 0.15, 0, h + 0.38), q(L / 2 + 0.15, 0, h + 0.38), null, cc); }
}
// 山門：'yaku'（屋根つきの門）・'ro'（楼門：2階）・'2'（二重門）・'post'（門柱）。前のはし v0・奥行き d
function sanmon(B, P, fr, uc, v0, y, o) {
  const lod = P.lod, t = o.t, w = o.w, d = o.d, pc = o.pc, rm = o.rm;
  if (t === 'post') { for (const sg of [-1, 1]) { const q = fr.p(uc + sg * (w / 2), v0 + 0.5); B.box('c', q[0] - 0.4, q[1] - 0.4, q[0] + 0.4, q[1] + 0.4, y, y + 2.2, '#a9a59c'); } return y + 2.2; }
  const h1 = t === 'yaku' ? cl(w * 0.62, 3.4, 5.5) : cl(w * 0.5, 4, 7), r = fr.R(uc - w / 2, v0, uc + w / 2, v0 + d);
  const cols = t === 'yaku' ? [[-0.42, 0.25], [0.42, 0.25], [-0.42, 0.75], [0.42, 0.75]] : [[-0.45, 0.15], [0, 0.15], [0.45, 0.15], [-0.45, 0.85], [0, 0.85], [0.45, 0.85]];
  const ps = t === 'yaku' ? 0.2 : 0.26;
  for (const [a, b] of cols) { if (t !== 'yaku' && a === 0) continue; const q = fr.p(uc + a * w, v0 + b * d); if (lod >= 2) post(B, q[0] - ps, q[1] - ps, q[0] + ps, q[1] + ps, y, y + h1, pc); else if (lod >= 1 && b < 0.5) { const e = fr.p(uc + a * w + 0.5, v0 + b * d); B.wall('c', q[0], q[1], e[0], e[1], y, y + h1, pc); } }
  if (lod >= 2) { const a = fr.p(uc - w * 0.45, v0 + 0.25 * d), b = fr.p(uc + w * 0.45, v0 + 0.25 * d); beam(B, [a[0], y + h1 - 0.3, a[1]], [b[0], y + h1 - 0.3, b[1]], 0.35, 0.45, pc, true); }
  if (t === 'yaku') return jroof(B, Object.assign({}, rm, { r, y: y + h1, t: 'kiri', ax: fr.ax('u'), oh: 1.1, og: 0.8, p: 0.7, cv: 0.42, up: 0.25, rh: 0.4, nd: 2, ns: 4, lod: lod >= 2 ? 2 : 0 }));
  // 楼門・二重門：上の階
  const ri = fr.R(uc - w * 0.46, v0 + d * 0.1, uc + w * 0.46, v0 + d * 0.9);
  let y2 = y + h1;
  if (t === '2') y2 = jroof(B, Object.assign({}, rm, { r: ri, y: y + h1, t: 'yose', oh: 1.3, p: 0.5, cv: 0.4, up: 0.3, cut: 1.6, nd: 2, ns: 4, lod: lod >= 2 ? 1 : 0 })) + 0.1;
  else if (lod >= 1) { B.box('c', ri[0] - 0.6, ri[1] - 0.6, ri[2] + 0.6, ri[3] + 0.6, y2, y2 + 0.3, pc); if (lod >= 2) for (const e of rfoot(A.rin(ri, -0.6)).edges) B.rail(T.rail, e, y2 + 0.3, 0.7, 0, pc, { su: 1.2, ends: false }); }
  const ri2 = A.rin(ri, 0.3), h2 = cl(w * 0.32, 2.6, 4.5);
  B.facade(o.fm, rfoot(ri2), y2, y2 + h2, { bw: 1.9, fh: h2, tb: 4, tf: 1, vy: y2, c: o.wc });
  return jroof(B, Object.assign({}, rm, { r: ri2, y: y2 + h2, t: 'iri', ax: fr.ax('u'), oh: 1.6, p: 0.72, cv: 0.45, up: 0.45, k1: 0.42, rh: 0.5, nd: 2, ns: 5, lod: lod >= 2 ? 2 : 0 }));
}
// 鐘楼（石の基壇・4本柱・入母屋）
function shoro(B, P, fr, uc, vc, y, o) {
  const lod = P.lod, w = o.w || 4, h = o.h || 4.2, r = fr.R(uc - w / 2, vc - w / 2, uc + w / 2, vc + w / 2), y1 = y + 1.0, pc = o.pc;
  if (lod >= 2) B.box('c', r[0] - 0.9, r[1] - 0.9, r[2] + 0.9, r[3] + 0.9, y, y1, '#a9a49a');
  const cs = [[r[0] + 0.2, r[1] + 0.2], [r[2] - 0.2, r[1] + 0.2], [r[2] - 0.2, r[3] - 0.2], [r[0] + 0.2, r[3] - 0.2]];
  if (lod >= 2) { for (const [x, z] of cs) post(B, x - 0.17, z - 0.17, x + 0.17, z + 0.17, y1, y1 + h, pc);
    const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2; B.cyl('c', cx, cz, 0.62, y1 + h - 2.5, y1 + h - 0.7, 8, '#5d5546', { notop: true }); B.cone('c', cx, cz, 0.62, y1 + h - 0.7, y1 + h - 0.35, 8, '#5d5546'); }
  else if (lod >= 1) for (const [x, z] of [cs[0], cs[2]]) B.wall('c', x - 0.25, z - 0.25, x + 0.25, z + 0.25, y1, y1 + h, pc);
  return jroof(B, Object.assign({}, o.rm, { r, y: y1 + h, t: 'iri', ax: fr.ax('u'), oh: 1.3, p: 0.75, cv: 0.45, up: 0.42, k1: 0.42, rh: 0.35, nd: 2, ns: 4, lod: lod >= 2 ? 2 : 0 }));
}
// 塔（三重・五重）：まん中 (x, z)・初重のはば w・重の数 n
function pagoda(B, P, x, z, y, w, n, o) {
  const lod = P.lod; let yy = y + 0.9;
  if (lod >= 2) B.box('c', x - w * 0.78, z - w * 0.78, x + w * 0.78, z + w * 0.78, y, yy, '#a9a49a');
  const tier = i => i === 0 ? w * 0.72 : w * (0.5 - 0.015 * i);
  if (lod < 2) { let H = yy; for (let i = 0; i < n; i++) H += tier(i) + w * (1 - 0.08 * i) * 0.13; post(B, x - w * 0.35, z - w * 0.35, x + w * 0.35, z + w * 0.35, yy, H, o.wc ? mul(o.wc, 0.8) : [0.5, 0.3, 0.25]); }
  for (let i = 0; i < n; i++) {
    const wi = w * (1 - 0.08 * i), hi = tier(i), wn = w * (1 - 0.08 * (i + 1)), r = [x - wi / 2, z - wi / 2, x + wi / 2, z + wi / 2], last = i === n - 1, oh = wi * 0.44;
    if (lod >= 2) B.facade(o.fm, rfoot(r), yy, yy + hi, { bw: wi / 3, fh: hi, tb: 4, tf: 1, vy: yy, c: o.wc });
    const top = jroof(B, Object.assign({}, o.rm, { r, y: yy + hi, t: 'hogyo', oh, p: last ? 0.55 : 0.4, cv: 0.42, up: wi * 0.075, cut: last ? 0 : oh + (wi - wn) / 2 + 0.05, nd: last ? 2 : 1, ns: 3, rh: 0.3, th: 0.28, lod: lod >= 2 ? 2 : 0 }));
    yy = last ? top : top - 0.05;
  }
  const sh = w * 1.3;
  if (lod >= 1) { B.cyl('c', x, z, 0.16, yy - 0.3, yy + sh, lod >= 2 ? 6 : 3, '#5d564a', { notop: true }); if (lod >= 2) for (let k = 0; k < 5; k++) { const yk = yy + sh * (0.22 + k * 0.11); B.cyl('c', x, z, 0.42 - k * 0.025, yk, yk + 0.14, 6, '#6c6457', { notop: true }); } }
  return yy + sh;
}
// 墓地：長方形 r（世界）に 墓の列
function bochi(B, P, r, y) {
  const lod = P.lod; B.flat(lod >= 1 ? T.jari : 'c', r, y, lod >= 1 ? '#bdb9af' : '#b4b0a6', { su: 4 });
  if (lod < 1) return;
  const w = r[2] - r[0], d = r[3] - r[1], ax = w >= d, n = Math.floor((ax ? d : w) / 2.4);
  for (let i = 0; i < n; i++) { if (lod < 2 && i % 2) continue; const t = (ax ? r[1] : r[0]) + 1.2 + i * 2.4, L = (ax ? w : d) - 1.6, k = (i % 3) * 0.37;
    if (ax) B.wall(T.boseki, r[0] + 0.8, t, r[2] - 0.8, t, y, y + 1.45, W1, [k, k + L / 7, 0, 1]); else B.wall(T.boseki, t, r[3] - 0.8, t, r[1] + 0.8, y, y + 1.45, W1, [k, k + L / 7, 0, 1]);
    if (lod >= 2) { if (ax) B.wall(T.boseki, r[2] - 0.8, t + 0.45, r[0] + 0.8, t + 0.45, y, y + 1.3, W1, [k + 0.5, k + 0.5 + L / 7, 0, 1]); else B.wall(T.boseki, t + 0.45, r[1] + 0.8, t + 0.45, r[3] - 0.8, y, y + 1.3, W1, [k + 0.5, k + 0.5 + L / 7, 0, 1]); } }
}
// 枯山水：白い砂と 石
function karesansui(B, P, r, y, R) {
  B.flat(T.jari, r, y, '#f4f2ec', { su: 3 });
  if (P.lod < 2) return;
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) { const x = lerp(r[0] + 1, r[2] - 1, R()), z = lerp(r[1] + 1, r[3] - 1, R()), s = 0.5 + R() * 0.9; blob(B, x, y + s * 0.3, z, s, s * 0.6, s * 0.3, '#8a867c', R, 5); B.flat('c', [x - s * 1.3, z - s * 1.3, x + s * 1.3, z + s * 1.3], y + 0.02, '#5f7448'); }
}
const TL = [
  { n: 'いぶし瓦・白壁', rm: 'kawara', rt: 'iri', wall: 'tera', gate: 'yaku', hei: '#ebe7dd', bo: 1 },
  { n: '銅板屋根の本堂', rm: 'dou', rt: 'iri', wall: 'ki', wc: '#86705a', gate: 'ro', hei: '#ebe7dd', bo: 1 },
  { n: '朱塗りの堂', rm: 'kawara', rt: 'iri', wall: 'shu', gate: 'ro', hei: '#ebe7dd', pag: 3 },
  { n: 'コンクリートの本堂', rm: 'kawara', rt: 'iri', wall: 'tera2', gate: 'post', park: 1, bo: 1 },
  { n: '寄棟の大屋根', rm: 'kawara', rt: 'yose', wall: 'ki', wc: '#8c745c', gate: 'yaku', hei: '#ebe7dd', bo: 1, heavy: 1 },
  { n: '宝形の観音堂', rm: 'dou', rt: 'hogyo', wall: 'shu', gate: 'yaku', hei: '#ebe7dd' },
  { n: '禅寺・枯山水', rm: 'kawara', rt: 'iri', wall: 'tera', gate: '2', hei: '#ebe7dd', zen: 1 },
  { n: '茅葺きの古寺', rm: 'kaya', rt: 'yose', wall: 'ki', wc: '#8d7862', gate: 'none', forest: 1, bo: 1 },
  { n: '五重塔のある寺', rm: 'kawara', rt: 'iri', wall: 'tera', gate: 'ro', hei: '#ebe7dd', pag: 5, bo: 1 },
  { n: '黒瓦・土塀', rm: 'kawara', rtc: '#7d8287', rt: 'iri', wall: 'ki', wc: '#9c8166', gate: 'yaku', hei: '#b49873', bo: 1 }
];
const teraWall = L => L.wall === 'shu' ? T.shu : L.wall === 'ki' ? T.ki : L.wall === 'tera2' ? T.tera2 : T.tera;
A.arch('p_tera', {
  looks: TL,
  far(L, P) { const rm = L.rm === 'dou' ? T.dou : L.rm === 'kaya' ? T.kaya : T.kawara; return { H: P.ko.big ? 9 : 6.5, base: 0, wall: teraWall(L), bw: 2, fh: P.ko.big ? 9 : 6.5, tb: 4, tf: 1, roof: rm, rt: 'hip', p: 0.6, ins: 2, top: rm, ct: L.rtc ? C(L.rtc) : W1, wc: L.wc ? C(L.wc) : W1 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, big = !!P.ko.big, sc = big ? 1.4 : 1, nv0 = B.nv;
    const Y = 0.06, YG = Y + 0.05, YS = Y + 0.1;
    pad(B, P, F, Y, lod >= 2 ? T.tsuchi : T.mori, lod >= 2 ? '#77735e' : '#c9ceb9', { su: 8, wm: T.ishigaki, wsu: 4 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 0.6)), fr = frm(r0, P.front), W = fr.W, D = fr.D, uc = W / 2;
    const small = W < 30 || D < 24, fm = teraWall(L), wc = L.wc ? C(L.wc) : W1;
    const rm = Object.assign({}, RM[L.rm] || RM.kawara, L.rtc ? { c: L.rtc } : {});
    const pc = L.wall === 'shu' ? C('#b3432e') : L.wall === 'tera2' ? C('#a9a8a2') : L.wall === 'ki' ? mul(wc, 0.62) : C('#4e3b2d');
    const ucol = L.wall === 'shu' ? [0.6, 0.27, 0.2] : L.wall === 'tera2' ? [0.6, 0.6, 0.58] : [0.3, 0.25, 0.21];
    const gcol = L.wall === 'tera' || L.wall === 'tera2' ? [0.9, 0.88, 0.83] : L.wall === 'shu' ? [0.94, 0.92, 0.88] : mul(wc, 0.5);
    // 本堂の大きさ・場所
    let hw = cl(W * (small ? 0.5 : 0.42), 7, 28 * sc), hd = cl(hw * 0.8, 6, 22 * sc);
    const back = cl(D * 0.12, 1.5, 26);
    let va1 = D - back, va0 = va1 - hd;
    const front = Math.max(small ? 7 : 10, D * 0.36);
    if (va0 < front) { va0 = front; hd = Math.max(5.5, va1 - va0); va1 = Math.min(D - 0.8, va0 + hd); hw = Math.min(hw, hd * 1.5); }
    const pg = L.pag || (big ? 5 : 0), pagW = pg ? cl(Math.min(W, D) * 0.15, 5, 9) * (pg === 3 ? 0.88 : 1) : 0;
    // 地面：境内の砂利・参道
    const kw = Math.min(W - 1, hw + (small ? 6 : 16) * sc);
    flatU(B, fr, lod >= 1 ? T.jari : 'c', uc - kw / 2, 0, uc + kw / 2, Math.min(D, va1 + 2.5), YG, lod >= 1 ? '#e2ded4' : '#cac6bc', 4);
    const sw = cl(hw * 0.2, 2.2, 5);
    if (lod >= 1) flatU(B, fr, T.ishi, uc - sw / 2, 0, uc + sw / 2, va0, YS, W1, 4);
    // 本堂
    const oh = cl(hd * 0.2, 1.8, 3.6), heavy = L.heavy ? 1.15 : 1, fl = small ? 0.75 : 0.95, wh = cl(hd * 0.3 + 1.6, 3.4, 7.5);
    const hallRoof = Object.assign({}, rm, { t: L.rt, p: (L.rt === 'yose' ? 0.78 : L.rt === 'hogyo' ? 0.85 : 0.72) * heavy, cv: 0.45, up: cl(hw * 0.035, 0.35, 1.0), k1: 0.4, oh, rh: cl(hw * 0.05, 0.5, 1.3), rw: cl(hw * 0.04, 0.45, 1.0), sumi: L.rm === 'kawara', oni: rm.oni, uc: ucol, gc: gcol, hc: L.wall === 'shu' ? '#b3432e' : rm.fc, nd: 3, ns: 6 });
    const sq = L.rt === 'hogyo';
    const hw2 = sq ? Math.min(hw, hd) : hw, hd2 = sq ? hw2 : hd;
    const mid = (P.f >= 2 || big) && !sq && lod >= 1;
    const top = shaden(B, P, fr, uc - hw2 / 2, va1 - hd2, uc + hw2 / 2, va1, YG, { fm, wc, fl, wh: mid ? wh * 1.45 : wh, en: 1.2, ec: L.wall === 'shu' ? '#a9432e' : '#6f5845', base: 0.5, bc: '#a9a59c', bp: 0.9, roof: hallRoof, rax: 'u',
      ko: lod >= 2 ? { kw: Math.min(hw2 * 0.38, 8), kd: 3.0, kara: L.zen ? 0 : (L.rm === 'kawara' && R() < 0.5 ? 0.9 : 0) } : null, kpc: pc });
    B.top = Math.max(B.top, top);
    if (mid && lod >= 2) { const r = fr.R(uc - hw2 / 2, va1 - hd2, uc + hw2 / 2, va1); jroof(B, Object.assign({}, hallRoof, { r, y: YG + fl + wh * 0.62, t: 'yose', oh: 1.6, p: 0.45, cut: 1.7, up: 0.3, rh: 0, nd: 1, ns: 4, sumi: 0, lod })); }
    if (lod < 1) { if (pg) { const q = fr.p(W * 0.18 + 2, Math.max(pagW, va0 * 0.5)); B.box('c', q[0] - pagW / 2, q[1] - pagW / 2, q[0] + pagW / 2, q[1] + pagW / 2, YG, YG + pagW * (pg === 5 ? 4.2 : 3), pc); } return; }
    // 山門と 塀
    const gt = small && L.gate !== 'none' ? 'post' : L.gate, gw = cl(hw * 0.38, 4, 11 * sc), gd = gt === 'yaku' ? cl(gw * 0.5, 2.6, 4.5) : cl(gw * 0.55, 3.5, 7);
    if (gt !== 'none') B.top = Math.max(B.top, sanmon(B, P, fr, uc, 0.4, YS, { t: gt, w: gw, d: gd, pc, rm, fm, wc }));
    if (L.hei && !P.tilt) { const hh = 2.3; hei(B, fr, 0.3, uc - gw / 2 - (gt === 'post' ? 0.5 : 0), 0.9, YG, hh, C(L.hei), C(rm.rc || '#55595e'), lod); hei(B, fr, uc + gw / 2 + (gt === 'post' ? 0.5 : 0), W - 0.3, 0.9, YG, hh, C(L.hei), C(rm.rc || '#55595e'), lod); }
    // 左右の場所：左 = 塔 か 鐘楼・墓地、右 = 庫裏
    const sideL = uc - hw2 / 2 - 2, sideR = W - (uc + hw2 / 2 + 2);
    const outs = [fr.R(uc - kw / 2, 0, uc + kw / 2, Math.min(D, va1 + 2.5))];
    if (pg && sideL > pagW + 2) { const q = fr.p(cl(uc - hw2 / 2 - 2 - pagW, pagW * 0.9, sideL), cl(va0 * 0.55, pagW, va1 - pagW)); B.top = Math.max(B.top, pagoda(B, P, q[0], q[1], YG, pagW, pg, { fm: L.wall === 'shu' ? T.shu : T.ki, wc: L.wall === 'shu' ? W1 : C('#8c745c'), rm })); }
    const shU = pg ? uc + hw2 / 2 + Math.min(sideR * 0.5, 6) : Math.max(3.5, uc - hw2 / 2 - Math.min(sideL * 0.5, 7)), shV = cl(va0 * 0.5, 4.5, va0 - 3.5);
    if (!small && (pg ? sideR : sideL) > 6) B.top = Math.max(B.top, shoro(B, P, fr, shU, shV, YG, { pc, rm, w: cl(hw * 0.2, 3.2, 5.5) }));
    // 庫裏（右）
    if (sideR > 8 && (lod >= 2 || (lod >= 1 && !pg))) {
      const k0 = uc + hw2 / 2 + 3, k1 = Math.min(W - 1.5, k0 + 16), v0k = va1 - hd2 + 1.5, v1k = Math.min(D - 1, v0k + cl(hd2 * 0.8, 8, 14));
      if (k1 - k0 > 6) { const rk = fr.R(k0, v0k, k1, v1k), fk = L.wall === 'tera2' ? T.tera2 : T.tera;
        B.facade(fk, rfoot(rk), YG, YG + 3.4, { bw: 1.9, fh: 3.4, tb: 4, tf: 1, vy: YG, c: L.wall === 'ki' ? mix(wc, W1, 0.5) : W1 });
        jroof(B, Object.assign({}, rm, { r: rk, y: YG + 3.4, t: 'iri', oh: 1.1, p: 0.6, cv: 0.3, up: 0.18, k1: 0.42, rh: 0.4, uc: ucol, gc: gcol, nd: 2, ns: 4, lod: lod >= 2 ? 1 : 0 }));
        if (lod >= 2) kohai(B, fr, (k0 + k1) / 2, 2.6, v0k - 0.6, v0k - 2.6, YG + 3.25, 0.4, Object.assign({}, rm, { kara: 0.7, lod, y0: YG, pc, gc: gcol }));
        outs.push(A.rin(rk, -1.5)); if (L.zen) karesansui(B, P, fr.R(k0, Math.max(2, v0k - 9), k1, v0k - 3), YG + 0.03, R); }
    }
    // 墓地（うしろ か 左）
    const backRoom = D - va1 - 1.5;
    if (L.bo && backRoom > 7) { const rb = fr.R(1.5, va1 + 2, W - 1.5, D - 1); bochi(B, P, rb, YG + 0.02); outs.push(rb); }
    else if (L.bo && !pg && sideL > 12) { const rb = fr.R(1.5, va0 + 1, uc - hw2 / 2 - 3, D - 1.5); bochi(B, P, rb, YG + 0.02); outs.push(rb); }
    if (L.park && sideL > 10 && lod >= 1) { const rp = fr.R(1, 2, Math.min(uc - kw / 2 - 1, 16), Math.min(va0, 16)); B.flat(T.asph, rp, YG + 0.01, W1, { su: 8 }); outs.push(rp); }
    // 灯籠・手水舎・松
    if (lod >= 2) {
      for (const sg of [-1, 1]) { const q = fr.p(uc + sg * (sw / 2 + 1.6), va0 - 5.2); toro(B, q[0], q[1], YS, 2.4, C('#a6a299'), lod); }
      if (kw / 2 - sw / 2 > 5 && va0 > 12) chozuya(B, P, fr, uc + sw / 2 + 3.2, cl(va0 * 0.35, 5, va0 - 7), YS, rm.m, rm, pc);
      const np = Math.min(pg ? 2 : 4, Math.floor((kw - sw) / 6));
      for (let i = 0; i < np; i++) { const sg = i % 2 ? 1 : -1, q = fr.p(uc + sg * (sw / 2 + 2.5 + R() * 2), lerp(3.5, va0 - 3, (Math.floor(i / 2) + 0.5) / Math.ceil(np / 2))); pine(B, q[0], q[1], YG, 4.5 + R() * 2.5, 2.4, R, lod); }
    }
    // まわりの木
    grove(B, P, F.rects.map(r => A.rin(r, 0.5)), outs, { sp: 6, k: L.forest ? 1.2 : 0.6, h: [10, 18], y: Y, n: 0.35, p: 0.2, max: lod >= 2 ? 34 : 3, vmax: left(B, nv0, lod) });
  }
});
A.kinds({ temple: 'p_tera', bigtemple: ['p_tera', { big: 1 }] });

/* ================= 鉄筋コンクリートの建物（役所・郵便局・病院・学校…で つかう）================= */
const k256 = w => w / 256;
T.ribbon = TX('f:ribbon', 256, 128, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'panel', c: '#ebe9e3', pw: 64, ph: 64, sc: k256(w), n: 0.025, dirt: 0.07 }, tb: 4, tf: 2,
  win: { x: 0, w: 1, y: 0.3, h: 0.46, f: '#a9aeb2', fw: 2 * k256(w), div: [2, 1], bl: 0.45, cur: 0.1, g0: '#aebfcb', g1: '#4a5c6b' }, band: { h: 0.05, c: '#dcd9d2' } }, R));
T.tile = TX('f:tile', 256, 256, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'tile', c: '#ece7dd', sc: k256(w), n: 0.03 }, tb: 4, tf: 4,
  win: { x: 0.16, w: 0.68, y: 0.22, h: 0.5, f: '#8d9397', fw: 2 * k256(w), div: [2, 1], cur: 0.3, bl: 0.3, sill: '#d6d1c6' }, band: { h: 0.05, c: '#dcd6ca' } }, R));
T.curtain = TX('f:curtain', 256, 256, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'stucco', c: '#5b6873', n: 0.01 }, tb: 4, tf: 4,
  win: { x: 0.02, w: 0.96, y: 0.03, h: 0.8, f: '#c4c9cd', fw: 1.5 * k256(w), div: [1, 1], bl: 0.25, lit: 0.08, g0: '#b3c6d4', g1: '#3d5163' }, band: { h: 0.14, c: '#56636e' } }, R));
T.louver = TX('f:louver', 256, 128, (g, w, h, R) => { const k = k256(w), mw = w / 4, mh = h / 2;
  fill(g, 0, 0, w, h, '#e9e7e1');
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) PT.win(g, i * mw, j * mh, mw, mh * 0.82, { f: '#9aa1a6', fw: 1.5 * k, div: [2, 1], bl: 0.3, g0: '#b0c2cf', g1: '#43586a' }, R);
  for (let j = 0; j < 2; j++) { fill(g, 0, j * mh + mh * 0.82, w, mh * 0.18, '#ebe9e3'); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, j * mh + mh * 0.82, w, 2 * k); }
  const n = 16; for (let i = 0; i < n; i++) { const x = i * w / n, gr = g.createLinearGradient(x, 0, x + w / n * 0.42, 0); gr.addColorStop(0, css('#f3f0ea', 1.04)); gr.addColorStop(1, css('#f3f0ea', 0.8)); g.fillStyle = gr; g.fillRect(x, 0, w / n * 0.4, h); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + w / n * 0.4, 0, w / n * 0.1, h); } });
T.stone = TX('f:stone', 256, 128, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'stone', c: '#dbd5c9', sc: 2 * k256(w), n: 0.03 }, tb: 4, tf: 2,
  win: { x: 0.3, w: 0.4, y: 0.12, h: 0.68, f: '#4f5559', fw: 2 * k256(w), div: [1, 2], rec: 3 * k256(w), bl: 0.3, cur: 0.2 } }, R));
T.conc = TX('f:conc', 256, 256, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'concrete', c: '#c9c7c1', pw: 32, ph: 16, sc: k256(w), dirt: 0.16, n: 0.04 }, tb: 4, tf: 4,
  win: { x: 0.1, w: 0.8, y: 0.2, h: 0.55, f: '#5f6468', fw: 2 * k256(w), div: [3, 1], rec: 3 * k256(w), bl: 0.35, cur: 0.15 } }, R));
T.grid = TX('f:grid', 256, 256, (g, w, h, R) => { const k = k256(w), mw = w / 4, mh = h / 4;
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#dad7cf', n: 0.03, dirt: 0.1 }, R);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh, fx = mw * 0.12, fy = mh * 0.1;
    fill(g, X + fx, Y + fy, mw - 2 * fx, mh - 2 * fy, '#8f8d88'); g.fillStyle = 'rgba(0,0,0,.33)'; g.fillRect(X + fx, Y + fy, mw - 2 * fx, mh * 0.07); g.fillRect(X + fx, Y + fy, mw * 0.05, mh - 2 * fy);
    PT.win(g, X + fx + mw * 0.07, Y + fy + mh * 0.09, mw - 2 * fx - mw * 0.1, mh - 2 * fy - mh * 0.14, { f: '#6b6f72', fw: 1.5 * k, div: [2, 1], bl: 0.4, cur: 0.15 }, R); } });
T.brick = TX('f:brick', 256, 256, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'brick', c: '#96614f', c2: '#7c4b3d', sc: k256(w), n: 0.03 }, tb: 4, tf: 4,
  win: { x: 0.24, w: 0.52, y: 0.18, h: 0.58, f: '#ece8df', fw: 2.5 * k256(w), div: [2, 2], cur: 0.3, sill: '#e2dccf' }, band: { h: 0.04, c: '#8a5545' } }, R));
T.alc = TX('f:alc', 256, 256, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: 'panel', c: '#dfddd7', pw: 256, ph: 10.7, sc: k256(w), n: 0.025, dirt: 0.08 }, tb: 4, tf: 4,
  win: { x: 0.22, w: 0.56, y: 0.3, h: 0.4, f: '#b4b8ba', fw: 2 * k256(w), div: [2, 1], cur: 0.35, bl: 0.2 }, skip: (i, j) => (i + j * 3) % 4 === 3 }, R));
// 1 階（大きなガラス窓・腰は石）
T.g1 = TX('g1:win', 256, 128, (g, w, h, R) => { const k = k256(w), mw = w / 4; PT.wallMat(g, 0, 0, w, h, { t: 'stone', c: '#d0cbc1', sc: 2 * k, n: 0.03 }, R);
  for (let i = 0; i < 4; i++) PT.win(g, i * mw + mw * 0.06, h * 0.12, mw * 0.88, h * 0.74, { f: '#7d8387', fw: 2 * k, div: [2, 1], g0: '#bccad4', g1: '#4f5f6a', bl: 0.25, lit: 0.08 }, R);
  fill(g, 0, 0, w, h * 0.06, '#c3beb4'); });
// 看板などの アトラス（4 × 4）：文字なし
T.sign = TX('sign', 256, 256, (g, w, h, R) => { const c = w / 4, k = k256(w);
  const cell = (i, f) => { const x = (i % 4) * c, y = Math.floor(i / 4) * c; g.save(); g.beginPath(); g.rect(x, y, c, c); g.clip(); f(x, y); g.restore(); };
  cell(0, (x, y) => { fill(g, x, y, c, c, '#3b3f44'); g.fillStyle = '#f4f2ec'; g.beginPath(); g.arc(x + c / 2, y + c / 2, c * 0.42, 0, PI * 2); g.fill(); g.fillStyle = '#2f3236';   // 時計
    for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; g.fillRect(x + c / 2 + Math.cos(a) * c * 0.35 - k, y + c / 2 + Math.sin(a) * c * 0.35 - k, 2.5 * k, 2.5 * k); }
    g.strokeStyle = '#2f3236'; g.lineWidth = 3 * k; g.beginPath(); g.moveTo(x + c / 2, y + c / 2); g.lineTo(x + c / 2 - c * 0.18, y + c / 2 - c * 0.12); g.moveTo(x + c / 2, y + c / 2); g.lineTo(x + c / 2 + c * 0.2, y + c / 2 - c * 0.22); g.stroke(); });
  cell(1, (x, y) => { fill(g, x, y, c, c, '#55595c'); g.strokeStyle = '#e8e4d8'; g.lineWidth = 4 * k; g.beginPath(); g.arc(x + c / 2, y + c / 2, c * 0.4, 0, PI * 2); g.stroke();   // ヘリポート（H）
    fill(g, x + c * 0.33, y + c * 0.28, c * 0.08, c * 0.44, '#e8e4d8'); fill(g, x + c * 0.59, y + c * 0.28, c * 0.08, c * 0.44, '#e8e4d8'); fill(g, x + c * 0.33, y + c * 0.46, c * 0.34, c * 0.08, '#e8e4d8'); });
  cell(2, (x, y) => { fill(g, x, y, c, c, '#5b6064'); PT.door(g, x + c * 0.08, y + c * 0.06, c * 0.84, c * 0.94, { gl: true, n: 2, f: '#8b9196' }, R); });   // ガラスの とびら
  cell(3, (x, y) => { fill(g, x, y, c, c, '#f2f1ec'); g.strokeStyle = '#b9b8b2'; g.lineWidth = 3 * k; g.strokeRect(x + 3 * k, y + 3 * k, c - 6 * k, c - 6 * k); });
  cell(4, (x, y) => { fill(g, x, y, c, c, '#2f4a6a'); fill(g, x, y + c * 0.62, c, c * 0.14, '#f0eee8'); });
  cell(5, (x, y) => { fill(g, x, y, c, c, '#4d6b5a'); g.fillStyle = '#f0eee8'; g.beginPath(); g.arc(x + c * 0.3, y + c * 0.5, c * 0.16, 0, PI * 2); g.fill(); fill(g, x + c * 0.52, y + c * 0.44, c * 0.36, c * 0.12, '#f0eee8'); });
  cell(6, (x, y) => { fill(g, x, y, c, c, '#7a3b3b'); fill(g, x, y + c * 0.3, c, c * 0.07, '#efe3c8'); fill(g, x, y + c * 0.62, c, c * 0.07, '#efe3c8'); });
  cell(7, (x, y) => { fill(g, x, y, c, c, '#3f6f78'); g.strokeStyle = '#f0eee8'; g.lineWidth = 5 * k; g.beginPath(); for (let i = 0; i <= 8; i++) { const xx = x + c * i / 8, yy = y + c * 0.5 + Math.sin(i * 1.4) * c * 0.1; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.stroke(); });
  cell(8, (x, y) => { fill(g, x, y, c, c, '#a8643a'); g.fillStyle = '#f4ead6'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x + c * (0.25 + i * 0.25), y + c * 0.5, c * 0.08, 0, PI * 2); g.fill(); } });
  cell(9, (x, y) => { fill(g, x, y, c, c, '#2c2e31'); const gr = g.createLinearGradient(x, y, x + c, y + c); gr.addColorStop(0, '#d9a85b'); gr.addColorStop(0.5, '#6b8fb0'); gr.addColorStop(1, '#2f4f6e'); g.fillStyle = gr; g.fillRect(x + c * 0.1, y + c * 0.08, c * 0.8, c * 0.84); });
  cell(10, (x, y) => { const gr = g.createLinearGradient(x, y, x + c, y + c); gr.addColorStop(0, '#d0407a'); gr.addColorStop(0.5, '#f0c040'); gr.addColorStop(1, '#e06030'); g.fillStyle = gr; g.fillRect(x, y, c, c); g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 30; i++) g.fillRect(x + R() * c, y + R() * c, 2.5 * k, 2.5 * k); });
  cell(11, (x, y) => { const gr = g.createLinearGradient(x, y + c, x + c, y); gr.addColorStop(0, '#2050c0'); gr.addColorStop(1, '#40d0e0'); g.fillStyle = gr; g.fillRect(x, y, c, c); g.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 6; i++) { const cx = x + R() * c, cy = y + R() * c; g.beginPath(); for (let a = 0; a < 10; a++) { const rr2 = (a % 2 ? 0.4 : 1) * c * 0.07, t = a / 10 * PI * 2; g.lineTo(cx + Math.cos(t) * rr2, cy + Math.sin(t) * rr2); } g.fill(); } });
  cell(12, (x, y) => { fill(g, x, y, c, c, '#27365a'); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x + c * 0.5, y + c * 0.42, c * 0.15, 0, PI * 2); g.fill(); fill(g, x + c * 0.32, y, c * 0.03, c, '#1a2440'); fill(g, x + c * 0.65, y, c * 0.03, c, '#1a2440'); });
  cell(13, (x, y) => { fill(g, x, y, c, c, '#f2efe8'); const gr = g.createRadialGradient(x + c / 2, y + c / 2, 2 * k, x + c / 2, y + c / 2, c * 0.42); gr.addColorStop(0, '#ff7060'); gr.addColorStop(1, '#b0201c'); g.fillStyle = gr; g.beginPath(); g.arc(x + c / 2, y + c / 2, c * 0.4, 0, PI * 2); g.fill(); });
  cell(14, (x, y) => { PT.shutter(g, x, y, c, c, '#b4382e'); });
  cell(15, (x, y) => { fill(g, x, y, c, c, '#3a2a22'); g.strokeStyle = '#b8964a'; g.lineWidth = 4 * k; g.strokeRect(x + 6 * k, y + 6 * k, c - 12 * k, c - 12 * k); });
});
const SG = { clock: 0, heli: 1, door: 2, blank: 3, navy: 4, green: 5, maroon: 6, teal: 7, orange: 8, poster: 9, pachi: 10, star: 11, noren: 12, lamp: 13, shut: 14, plaque: 15 };
// 看板・とびら：辺 e の from〜to（m）・y0〜y1、外へ off。cell：アトラスの番号
function signE(B, e, from, to, y0, y1, cell, off = 0.1, c = W1) {
  const t0 = from / e.L, t1 = to / e.L, ax = e.ax + (e.bx - e.ax) * t0 + e.nx * off, az = e.az + (e.bz - e.az) * t0 + e.nz * off, bx = e.ax + (e.bx - e.ax) * t1 + e.nx * off, bz = e.az + (e.bz - e.az) * t1 + e.nz * off;
  const u0 = (cell % 4) / 4 + 0.004, u1 = (cell % 4 + 1) / 4 - 0.004, v1 = 1 - Math.floor(cell / 4) / 4 - 0.004, v0 = 1 - (Math.floor(cell / 4) + 1) / 4 + 0.004;
  B.wall(T.sign, ax, az, bx, bz, y0, y1, c, [u0, u1, v0, v1]);
}
// 平らな看板（上向き）：ヘリポートなど
function signFlat(B, r, y, cell) { const u0 = (cell % 4) / 4 + 0.004, u1 = (cell % 4 + 1) / 4 - 0.004, v1 = 1 - Math.floor(cell / 4) / 4 - 0.004, v0 = 1 - (Math.floor(cell / 4) + 1) / 4 + 0.004;
  B.quad(T.sign, [r[0], y, r[3]], [r[2], y, r[3]], [r[2], y, r[1]], [r[0], y, r[1]], [0, 1, 0], W1, [u0, v0, u1, v0, u1, v1, u0, v1]); }
// 辺の中の位置（m）→ 点
const onE = (e, t, off = 0) => [e.ax + (e.bx - e.ax) * t / e.L + e.nx * off, e.az + (e.bz - e.az) * t / e.L + e.nz * off];
// 入口のひさし（辺 e のまん中 at・はば w・出 dep・高さ y）。柱つき
function canopy(B, e, at, w, dep, y, c, o = {}) {
  const from = cl(at - w / 2, 0.2, e.L - 0.5), to = cl(at + w / 2, from + 0.5, e.L - 0.2);
  B.ledge(e, y, y + (o.th || 0.35), dep, C(c), { from, to, ct: o.ct });
  if (o.posts && (o.lod == null || o.lod >= 2)) for (const t of [from + 0.4, to - 0.4]) { const q = onE(e, t, dep - 0.4); post(B, q[0] - 0.15, q[1] - 0.15, q[0] + 0.15, q[1] + 0.15, o.y0 || 0, y, o.pc || [0.75, 0.75, 0.74]); }
}
// 旗ざお（旗なし）
function flagpoles(B, x, z, y, ang, n, h) { const ca = Math.cos(ang), sa = Math.sin(ang); for (let i = 0; i < n; i++) { const s = (i - (n - 1) / 2) * 2.2, px = x + ca * s, pz = z + sa * s;
  trunk3(B, px, pz, y, y + h, 0.07, [0.82, 0.82, 0.8]); B.box('c', px - 0.12, pz - 0.12, px + 0.12, pz + 0.12, y + h, y + h + 0.22, [0.85, 0.75, 0.4]); B.box('c', px - 0.45, pz - 0.45, px + 0.45, pz + 0.45, y, y + 0.3, [0.7, 0.7, 0.68]); } }
const CARC = ['#e9e9e6', '#e9e9e6', '#bfc2c4', '#2b2d30', '#8e9396', '#3d4a5c', '#7a2a2a', '#d8d2c0'];
// 駐車場：長方形 r（世界）・車の向き（列は 長いほう）。n 台まで車
function parking(B, P, r, y, R, o = {}) {
  const lod = P.lod; B.flat(lod >= 1 ? T.asph : 'c', r, y, lod >= 1 ? W1 : [0.42, 0.43, 0.44], { su: 8 });
  if (lod < 1) return;
  const w = r[2] - r[0], d = r[3] - r[1], ax = w >= d, L = ax ? w : d, D = ax ? d : w, rows = D >= 11 ? 2 : D >= 5 ? 1 : 0, ns = Math.floor(L / 2.5);
  if (!rows || !ns) return;
  const lc = [0.9, 0.9, 0.88], maxc = o.max == null ? 8 : o.max; let nc = 0;
  for (let rw = 0; rw < rows; rw++) {
    const c0 = rw === 0 ? (ax ? r[1] : r[0]) : (ax ? r[3] : r[2]) - 5, c1 = c0 + 5;
    const av = (t, c) => o.avoid && o.avoid.some(q => (ax ? t : c) > q[0] - 1.3 && (ax ? t : c) < q[2] + 1.3 && (ax ? c : t) > q[1] - 2.5 && (ax ? c : t) < q[3] + 2.5);
    for (let i = 0; i <= ns && lod >= 2; i++) { const t = (ax ? r[0] : r[1]) + (L - ns * 2.5) / 2 + i * 2.5; if (av(t, (c0 + c1) / 2)) continue; B.flat('c', ax ? [t - 0.06, c0, t + 0.06, c1] : [c0, t - 0.06, c1, t + 0.06], y + 0.02, lc); }
    if (lod >= 2) for (let i = 0; i < ns && nc < maxc; i++) { if (R() > (o.fill || 0.55)) continue; const t = (ax ? r[0] : r[1]) + (L - ns * 2.5) / 2 + i * 2.5 + 1.25, cm = (c0 + c1) / 2;
      B.car(ax ? t : cm, ax ? cm : t, ax ? PI / 2 : 0, A.pick(R, CARC), y); nc++; }
  }
}
// 自転車おき場（屋根つき）
function bikeShed(B, P, e, from, to, dep, y) { if (P.lod < 2 || to - from < 2) return; const q0 = onE(e, from, 0.2), q1 = onE(e, to, 0.2);
  B.ledge(e, y + 2.1, y + 2.2, dep, C('#c9cfd2'), { from, to }); for (const q of [q0, q1]) { const x = q[0] + e.nx * (dep - 0.3), z = q[1] + e.nz * (dep - 0.3); post(B, x - 0.05, z - 0.05, x + 0.05, z + 0.05, y, y + 2.1, [0.6, 0.62, 0.62]); } }
/* RC のかたまり：形 F・階 n。o：{ fm（窓の質感）, tb, tf, bw, fh（階高）, g1（1階の高さ）, g1m（1階の質感）, wc, g1c, base,
     par（パラペット m・0 で なし）, pc, roof（'flat' | 'hip' | 'gable' | 'iri'）, rm, rc, p, oh, ledge（各階の ひさし m）, lc, rt（屋上のもの）, tc（屋上の色）}
   返り値：壁の上の高さ */
function rcBlock(B, P, F, n, o) {
  const lod = P.lod, fh = o.fh || 3.8, g1 = o.g1 == null ? fh : o.g1, base = o.base == null ? 0.2 : o.base, bw = o.bw || 3.6;
  const H = base + g1 + Math.max(0, n - 1) * fh;
  if (!o.onpad && (lod >= 1 || P.yb < -0.5)) B.plinth(F, P.yb, base + 0.01);
  let y1 = base;
  const g1m = lod >= 2 ? o.g1m : null;
  if (g1m) { B.facade(g1m, F, base, base + g1, { bw, fh: g1, tb: 4, tf: 1, vy: base, c: o.g1c || W1, ao: 0.86 }); y1 = base + g1; }
  if (H > y1 + 0.1) B.facade(o.fm, F, y1, H, { bw, fh, tb: o.tb || 4, tf: o.tf || 4, vy: g1m ? y1 : base + g1 - fh, c: o.wc || W1, ao: g1m ? 1 : 0.86 });
  if (o.ledge && lod >= 2 && n <= 14) for (let j = 1; j < n; j++) { const yy = base + g1 + (j - 1) * fh; for (const e of F.edges) if (e.L > 2) B.ledge(e, yy - 0.18, yy + 0.06, o.ledge, C(o.lc || '#d8d6d0')); }
  const roof = o.roof || 'flat';
  if (roof === 'flat') {
    B.cap(lod >= 1 ? T.flat : 'c', F, H, lod >= 1 ? (o.tc || W1) : C(o.tc ? o.tc : '#a5a6a3'), { su: 8 });
    if (o.par !== 0 && lod >= 2) B.parapet(F, H, o.par || 0.9, 0.25, C(o.pc || mul(o.wc || W1, 0.95)));
    else if (o.par !== 0 && lod >= 1) for (const e of F.edges) B.wallE('c', e, H, H + (o.par || 0.9), C(o.pc || mul(o.wc || W1, 0.95)));
    if (lod >= 2 && o.rt !== false && n >= 2) B.rooftop(F, H, P.rng, { per: 90, tank: n >= 4, nmax: 10 });
    return H;
  }
  // 勾配屋根（形ごと：長方形が 多いときは 平ら）
  const rm = o.rm || T.kawara, rp = o.p || (roof === 'gable' ? 0.5 : 0.42);
  B.roofs(F, { t: roof === 'iri' ? (lod >= 1 ? 'irimoya' : 'hip') : roof, y: H, p: rp, oh: o.oh == null ? 0.8 : o.oh, m: rm, c: o.rc || W1, su: 3.2, mg: o.fm, cg: o.wc || W1, gsu: bw * (o.tb || 4), gsv: fh * (o.tf || 4), th: lod >= 1 ? 0.2 : 0, cf: mul(o.rc || [0.6, 0.6, 0.6], 0.6), hmax: 7, maxN: 6 });
  return H;
}

// ポスト（赤：まるい ポスト か 四角）
function postbox(B, x, z, y, ang, t, lod) {
  const red = [0.77, 0.2, 0.16];
  if (t === 'round') { B.cyl('c', x, z, 0.24, y, y + 1.15, lod >= 2 ? 8 : 4, red, { notop: lod < 2 }); if (lod >= 2) { B.cyl('c', x, z, 0.28, y + 1.15, y + 1.25, 8, red); B.box('c', x - 0.12, z - 0.12, x + 0.12, z + 0.12, y + 1.25, y + 1.33, red); } }
  else { B.box('c', x - 0.06, z - 0.06, x + 0.06, z + 0.06, y, y + 0.7, [0.4, 0.4, 0.42]); B.obox('c', x, z, ang, 0.5, 0.36, y + 0.7, y + 1.3, red); }
}
// 前の列を 前庭・駐車場に わける：{ fore（前の cells）, main（のこり） }
function splitFront(F, fr, minLen, rows = 1) {
  if (F.tilt) return { fore: [], main: F.cells.slice() };   // ななめ：長方形 1 つ（cells は ます目の番号なので つかわない）
  const dep = cellDepth(F, fr), fore = [], main = [];
  for (const c of F.cells) { const d = dep.get(c[0] + ',' + c[1]); if (d && d[1] >= minLen && d[0] < rows) fore.push(c); else main.push(c); }
  return main.length ? { fore, main } : { fore: [], main: F.cells.slice() };
}
// 区画の 道から見た u の位置（cells を 左→右に）
function cellU(F, fr, c) { const f = fr || [0, 1], sd = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 'E' : 'W') : (f[1] < 0 ? 'N' : 'S'); return sd === 'S' ? c[0] : sd === 'N' ? -c[0] : sd === 'E' ? -c[1] : c[1]; }

/* ================= 郵便局（gpost）================= */
const YL = [
  { n: '白いタイル・平屋根', fm: T.tile, wc: '#f4f2ee', g1c: '#ece9e2', pb: 'round', cn: '#e8e6e0' },
  { n: 'ベージュのタイル・連窓', fm: T.ribbon, wc: '#eedfc4', g1c: '#e5d8c2', pb: 'square', cn: '#e3d6bf' },
  { n: '茶色のタイル', fm: T.tile, wc: '#a5836a', g1c: '#b39a86', pc: '#86695a', pb: 'round', cn: '#8e7462' },
  { n: '打ちはなし', fm: T.conc, wc: W1, g1c: '#d5d3cd', pb: 'square', cn: '#c9c7c1', thin: 1 },
  { n: 'レンガ調タイル', fm: T.brick, wc: W1, g1c: '#c4a090', pb: 'round', cn: '#e9e4da' },
  { n: '瓦屋根の局舎', fm: T.tile, wc: '#efe6d4', g1c: '#e6dccb', roof: 'hip', rm: T.kawara, pb: 'round', cn: '#dcd2c0' },
  { n: '板金屋根の平屋', fm: T.alc, wc: '#efe8da', g1c: '#e6dfd1', roof: 'gable', rm: T.kane, rc: '#7d5d4a', pb: 'square', cn: '#d8d0c2' },
  { n: 'ガラスと金属', fm: T.curtain, wc: W1, g1c: '#c9cdd0', pb: 'square', cn: '#b9bec2', thin: 1 },
  { n: '木のルーバー', fm: T.louver, wc: '#d8b58c', g1c: '#e9e3d8', pb: 'square', cn: '#e9e6df', thin: 1 },
  { n: 'グレーの石張り', fm: T.stone, wc: '#c9c7c2', g1c: '#bdbab4', pb: 'round', cn: '#b4b1ab' }
];
// 質感の中の 柱間・階の数（2 階ぶん・1 階ぶんの 質感がある）
const fmDims = fm => fm === T.ribbon || fm === T.louver || fm === T.stone || fm === T.school || fm === T.siding ? { tb: 4, tf: 2 } : fm === T.wood || fm === T.gym ? { tb: 4, tf: 1 } : { tb: 4, tf: 4 };
A.arch('p_yubin', {
  looks: YL,
  far(L, P) { const n = Math.max(1, P.f), pit = L.roof && n <= 4, d = fmDims(L.fm); return { H: 0.2 + 4.2 + (n - 1) * 3.7, base: 0.2, wall: L.fm, bw: 3.6, fh: 3.7, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: pit ? L.rm : null, rc: pit ? (L.rc ? C(L.rc) : W1) : [0.6, 0.61, 0.6], rt: pit ? (L.roof === 'gable' ? 'gable' : 'hip') : 'flat', p: 0.4, ins: n > 4 ? 0.5 : 1.2 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), d = fmDims(L.fm);
    const urban = n >= 5, sp = (!urban && F0.n >= 3) ? splitFront(F0, P.front, 2) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) : F0, F = A.inset(Fm, SB(P, urban ? 0.5 : (sp.fore.length ? 0.6 : 1.2)));
    const pit = L.roof && n <= 4;
    const H = rcBlock(B, P, F, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 3.7, g1: 4.2, g1m: lod >= 1 ? T.g1 : null, wc: C(L.wc), g1c: C(L.g1c), pc: L.pc, roof: pit ? L.roof : 'flat', rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: L.roof === 'gable' ? 0.45 : 0.4, par: 0.8 });
    B.top = Math.max(B.top, H);
    // 前庭（駐車場）
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore); for (const r of Ff.rects) parking(B, P, A.rin(r, 0.4), 0.06, R, { max: 3 }); if (lod >= 1) B.plinth(Ff, P.yb, 0.06); }
    if (lod < 1) return;
    // 入口：ガラスのとびら・ひさし・看板・ATM・ポスト
    const e = A.frontEdge(F, P.front), mid = e.L / 2, dw = Math.min(3.2, e.L * 0.3), base = 0.2;
    signE(B, e, mid - dw / 2, mid + dw / 2, base, base + 2.6, SG.door, 0.08);
    canopy(B, e, mid, Math.min(e.L - 1, dw + 3), L.thin ? 1.8 : 1.4, base + 3.2, L.cn, { th: L.thin ? 0.18 : 0.35, lod });
    if (e.L > 9) { signE(B, e, mid - Math.min(5, e.L * 0.3), mid + Math.min(5, e.L * 0.3), base + 3.6, base + 4.15, SG.blank, 0.12);
      const at = e.L > 14 ? e.L - 3.2 : 1.0; signE(B, e, at, at + 1.6, base, base + 2.4, SG.door, 0.08); if (lod >= 2) signE(B, e, at - 0.1, at + 1.7, base + 2.55, base + 3.0, SG.blank, 0.12, [0.86, 0.9, 0.95]); }
    const pq = onE(e, Math.max(0.6, mid - dw / 2 - 1.4), 0.9); postbox(B, pq[0], pq[1], 0.06, Math.atan2(e.nz, e.nx) + PI / 2, L.pb, lod);
    if (lod >= 2 && n >= 2 && !pit) for (const e2 of F.edges) if (e2 !== e && e2.L > 6 && R() < 0.5) { const q = onE(e2, e2.L * (0.3 + 0.4 * R()), 0.35); B.acUnit(q[0], q[1], 0.25, Math.atan2(e2.nz, e2.nx) + PI / 2); }
  }
});
A.kinds({ gpost: 'p_yubin' });

/* ================= 役所（町村役場・市役所・区役所・官庁・府県庁・裁判所・司令部・税務署・保健所・警察署）================= */
const GL = [
  { n: '茶色のタイル・時計塔', fm: T.tile, wc: '#a07f65', g1c: '#a88f7a', pc: '#7a5f4c', clock: 1, cr: 'pyramid', crc: '#5a5048' },
  { n: '打ちはなし・水平ひさし', fm: T.conc, wc: W1, g1c: '#cfcdc7', ledge: 1.1, lc: '#cbc9c3', pil: 1, cr: 'flat' },
  { n: 'ガラスと白い柱', fm: T.curtain, wc: W1, g1c: '#d4d8da', fins: '#efefeb', cr: 'barrel', crc: '#c9ccce' },
  { n: '石張り・アトリウム', fm: T.stone, wc: '#ddd6c9', g1c: '#cfc8bb', atrium: 1, cr: 'flat' },
  { n: '白い壁・青い屋根', fm: T.ribbon, wc: '#f4f3ef', g1c: '#e6e5e0', roof: 'hip', rm: T.kane, rc: '#5f7487', cr: 'pyramid', crc: '#5f7487' },
  { n: '瓦屋根の庁舎', fm: T.tile, wc: '#eee4d0', g1c: '#e4d9c5', roof: 'iri', rm: T.kawara, cr: 'hip', crc: W1 },
  { n: '木のルーバー・太陽光', fm: T.louver, wc: '#cfa57a', g1c: '#e6e0d4', solar: 1, cr: 'barrel', crc: '#b9bcbd' },
  { n: 'ベージュのタイル・連窓', fm: T.ribbon, wc: '#e8d5b5', g1c: '#ddcbb0', cr: 'flat' },
  { n: 'レンガ色・中央の塔', fm: T.brick, wc: W1, g1c: '#bf9c8c', ctower: 1, cr: 'hip', crc: '#6c6f72' },
  { n: 'グレーの格子', fm: T.grid, wc: '#e2e0da', g1c: '#cfccc5', cr: 'flat' }
];
const gDims = fm => fmDims(fm);
function govBlock(B, P, F, n, L, o = {}) {   // 役所の 1 つの かたまり
  const d = gDims(L.fm), lod = P.lod, pit = L.roof && n <= 6 && !o.flat;
  return rcBlock(B, P, F, n, { fm: o.fm || L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: o.fh || 3.9, g1: o.g1 || 4.6, g1m: lod >= 1 && !o.nog1 ? T.g1 : null, wc: o.wc || C(L.wc), g1c: C(L.g1c), pc: L.pc, roof: pit ? L.roof : 'flat', rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: 0.38, oh: 1.0, par: o.par == null ? 1.0 : o.par, ledge: L.ledge, lc: L.lc, rt: o.rt });
}
A.arch('p_yakuba', {
  looks: GL,
  far(L, P) { const n = Math.max(1, P.f), pit = L.roof && n <= 6, d = gDims(L.fm); return { H: 0.2 + 4.6 + (n - 1) * 3.9, base: 0.2, wall: L.fm, bw: 3.6, fh: 3.9, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: pit ? L.rm : null, rc: pit ? (L.rc ? C(L.rc) : W1) : [0.6, 0.61, 0.6], rt: pit ? 'hip' : 'flat', p: 0.38, ins: 1 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), ko = P.ko;
    // 前庭（3 列以上のとき・広いと 2 列）
    const deep = P.tilt ? 1 : Math.max(...[...cellDepth(F0, P.front).values()].map(v => v[1]));
    const sp = F0.n >= 4 && deep >= 3 ? splitFront(F0, P.front, 3, deep >= 8 ? 2 : 1) : { fore: [], main: F0.cells };
    let mainC = sp.main, cC = [];
    // 議会棟（となりの列）
    if (ko.council && n >= 3 && mainC.length >= 6 && !P.tilt) {
      const us = [...new Set(mainC.map(c => cellU(F0, P.front, c)))].sort((a, b) => a - b);
      if (us.length >= 3) { const k = Math.max(1, Math.round(us.length / 3)), cut = us[us.length - k]; cC = mainC.filter(c => cellU(F0, P.front, c) >= cut); mainC = mainC.filter(c => cellU(F0, P.front, c) < cut); }
    }
    const Fm = sp.fore.length || cC.length ? subFoot(F0, mainC) || F0 : F0, F = A.inset(Fm, SB(P, n >= 8 ? 0.5 : 0.9));
    // 高層：下の 3 階は ぜんぶ・上は 内がわの塔
    let H, Hg, FT = F;   // H：いちばん上・Hg：地面からの かたまりの上（時計塔をのせる）
    if (n >= 9 && F.area > 900) {
      const FI = A.inset(F, Math.min(8, Math.sqrt(F.area) * 0.16));
      if (FI !== F && FI.area > F.area * 0.3) FT = FI;
      Hg = govBlock(B, P, F, 3, L, { flat: 1, rt: false, par: 1.1 });
      H = rcBlock(B, P, FT, n - 3, { fm: L.fm, tb: gDims(L.fm).tb, tf: gDims(L.fm).tf, bw: 3.6, fh: 3.9, g1: 3.9, wc: C(L.wc), pc: L.pc, base: Hg, roof: 'flat', par: 1.2 });
      if (lod >= 2 && n >= 12) { const rr = mainRect(FT, P.front), c = [(rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2], hs = Math.min(9, (rr[2] - rr[0]) * 0.3, (rr[3] - rr[1]) * 0.3);
        if (hs > 5) { B.box('c', c[0] - hs, c[1] - hs, c[0] + hs, c[1] + hs, H + 0.1, H + 0.6, [0.5, 0.52, 0.52]); signFlat(B, [c[0] - hs + 0.4, c[1] - hs + 0.4, c[0] + hs - 0.4, c[1] + hs - 0.4], H + 0.65, SG.heli); } }
    } else Hg = H = govBlock(B, P, F, n, L);
    const parts = FT === F ? [[F, 0.2, H]] : [[F, 0.2, Hg], [FT, Hg, H]];
    B.top = Math.max(B.top, H);
    // 議会棟
    if (cC.length) { const Fc = A.inset(subFoot(F0, cC), 0.9), nc = n <= 4 ? Math.max(1, n - 1) : 3, Hc = rcBlock(B, P, Fc, nc, { fm: L.fm === T.curtain ? T.curtain : T.stone, tb: 4, tf: 2, bw: 3.6, fh: 5.0, g1: 4.6, g1m: lod >= 1 ? T.g1 : null, wc: L.fm === T.curtain ? W1 : mix(C(L.wc), [0.92, 0.9, 0.86], 0.6), g1c: C(L.g1c), roof: 'flat', par: L.cr === 'flat' ? 1.1 : 0.4 });
      if (L.cr !== 'flat' && lod >= 1) B.roofs(Fc, { t: L.cr, y: Hc + 0.4, p: L.cr === 'barrel' ? 0.16 : 0.32, oh: 0.6, m: L.cr === 'hip' ? T.kawara : T.kane, c: C(L.crc || '#9aa0a5'), su: 3, mg: T.stone, cg: mix(C(L.wc), [0.92, 0.9, 0.86], 0.6), gsu: 14.4, gsv: 10.4, th: 0.2, hmax: 6, maxN: 4 });
      B.top = Math.max(B.top, Hc + 3); }
    // 前庭：舗装・駐車場・旗ざお・木
    const e = A.frontEdge(F, P.front), mid = e.L / 2;
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore), pw = Math.min(14, e.L * 0.5), q0 = onE(e, mid - pw / 2, 0), q1 = onE(e, mid + pw / 2, 0), dd = deep >= 8 ? 20 : 10;
      const pr = [Math.min(q0[0], q1[0], q0[0] + e.nx * dd), Math.min(q0[1], q1[1], q0[1] + e.nz * dd), Math.max(q0[0], q1[0], q1[0] + e.nx * dd), Math.max(q0[1], q1[1], q1[1] + e.nz * dd)];
      for (const r of Ff.rects) parking(B, P, A.rin(r, 0.3), 0.06, R, { avoid: [pr], max: 10 });
      if (lod >= 1) { B.plinth(Ff, P.yb, 0.06); const rp = [Math.max(pr[0], Ff.bb[0]), Math.max(pr[1], Ff.bb[1]), Math.min(pr[2], Ff.bb[2]), Math.min(pr[3], Ff.bb[3])]; if (rp[2] > rp[0] && rp[3] > rp[1]) B.flat(T.ishi, rp, 0.09, '#d8d2c6', { su: 4 }); }
      if (lod >= 2) { const fq = onE(e, Math.max(1.5, mid - pw / 2 + 1.2), 6); flagpoles(B, fq[0], fq[1], 0.09, Math.atan2(e.bz - e.az, e.bx - e.ax), 3, 10);
        for (const sg of [-1, 1]) { const tq = onE(e, mid + sg * (pw / 2 - 1), dd - 2.5); treeB(B, tq[0], tq[1], 0.09, 7, 2.6, A.pick(R, TCOL), R, lod); } }
    }
    if (lod < 1) return;
    // 入口
    const base = 0.2, dw = Math.min(4, e.L * 0.3);
    signE(B, e, mid - dw / 2, mid + dw / 2, base, base + 2.8, SG.door, 0.08);
    if (L.atrium && lod >= 1 && e.L > 16) {   // ガラスのアトリウム
      const q0 = onE(e, mid - 6, 0), q1 = onE(e, mid + 6, 5), ra = [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])];
      B.facade(T.curtain, rfoot(ra), base, base + 9, { bw: 3, fh: 4.5, tb: 4, tf: 4, vy: base, c: [0.92, 0.96, 1] }); B.roof({ t: 'pyramid', r: ra, y: base + 9, p: 0.35, oh: 0.2, m: T.curtain, c: [0.85, 0.9, 0.95], su: 3, th: 0 });
    } else canopy(B, e, mid, Math.min(e.L - 1, dw + 6), 4.2, base + 4.0, L.fm === T.curtain || L.fins ? '#e9eaea' : mix(C(L.g1c), [0.9, 0.9, 0.9], 0.4), { posts: 1, lod, th: 0.45, y0: 0.08 });
    if (lod >= 2) signE(B, e, mid + dw / 2 + 0.6, mid + dw / 2 + 2.2, base + 0.4, base + 2.0, SG.plaque, 0.12, [0.75, 0.75, 0.75]);
    if (ko.lamp) { const q = onE(e, mid + dw / 2 + 0.5, 0.25); B.box('c', q[0] - 0.25, q[1] - 0.25, q[0] + 0.25, q[1] + 0.25, base + 3.3, base + 3.8, [0.85, 0.12, 0.1]); }
    // 時計塔・中央の塔
    if ((L.clock || L.ctower) && e.L > 14) {
      const tw = L.clock ? 5 : 9, q0 = onE(e, mid - tw / 2, -0.4), q1 = onE(e, mid + tw / 2, tw * (L.clock ? 1 : 0.8) - 0.4), rt = [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])];
      const th2 = Hg + (L.clock ? 9 : 6), Ft = rfoot(rt);
      B.facade(L.fm, Ft, Hg - 0.2, th2, { bw: 3.6, fh: 3.9, tb: gDims(L.fm).tb, tf: gDims(L.fm).tf, vy: Hg, c: C(L.wc) });
      if (L.clock) { for (const e2 of Ft.edges) if (e2.nx * e.nx + e2.nz * e.nz > 0.5 || Math.abs(e2.nx * e.nx + e2.nz * e.nz) < 0.5) signE(B, e2, 0.8, e2.L - 0.8, th2 - 4.2, th2 - 0.8, SG.clock, 0.08); B.roof({ t: 'pyramid', r: rt, y: th2, p: 0.6, oh: 0.4, m: 'c', c: C(L.crc || '#5a5048'), th: 0.15 }); }
      else { B.cap(T.flat, Ft, th2, W1, { su: 8 }); if (lod >= 1) B.parapet(Ft, th2, 0.8, 0.25, C('#8a5545')); }
      B.top = Math.max(B.top, th2 + 3);
    }
    // 屋上：太陽光・アンテナ
    if (L.solar && lod >= 2 && !L.roof) { const rr = mainRect(FT, P.front), w = rr[2] - rr[0], d = rr[3] - rr[1], ax = w >= d, nr = Math.min(4, Math.floor((ax ? d : w) / 4.5));
      for (let i = 0; i < nr; i++) { const t = (ax ? rr[1] : rr[0]) + 2.5 + i * 4.5, a0 = (ax ? rr[0] : rr[1]) + 2, a1 = (ax ? rr[2] : rr[3]) - 2; if (a1 - a0 < 3) break;
        if (ax) B.quad(T.solar, [a0, H + 0.4, t + 2.4], [a1, H + 0.4, t + 2.4], [a1, H + 1.3, t], [a0, H + 1.3, t], null, W1, [0, 0, (a1 - a0) / 6, 1]); else B.quad(T.solar, [t + 2.4, H + 0.4, a1], [t + 2.4, H + 0.4, a0], [t, H + 1.3, a0], [t, H + 1.3, a1], null, W1, [0, 0, (a1 - a0) / 6, 1]); } }
    if (ko.mast && lod >= 1) { const rr = mainRect(FT, P.front), x = rr[0] + (rr[2] - rr[0]) * 0.7, z = rr[1] + (rr[3] - rr[1]) * 0.35; trunk3(B, x, z, H, H + 14, 0.25, [0.78, 0.78, 0.76]); if (lod >= 2) { B.box('c', x - 1.2, z - 0.05, x + 1.2, z + 0.05, H + 11, H + 11.15, [0.7, 0.7, 0.7]); B.cyl('c', x + 0.6, z, 0.5, H + 8, H + 8.1, 8, [0.9, 0.9, 0.88]); } B.top = Math.max(B.top, H + 14); }
    // ピロティの柱（打ちはなし）
    if (L.pil && lod >= 2) for (let t = 2.5; t < e.L - 1; t += 6) { if (Math.abs(t - mid) < dw) continue; const q = onE(e, t, 0.6); post(B, q[0] - 0.35, q[1] - 0.35, q[0] + 0.35, q[1] + 0.35, 0.2, 4.8, [0.78, 0.77, 0.74]); }
    // 白い たて柱（ガラス）
    if (L.fins && lod >= 2) for (const [Fp, y0, y1] of parts) for (const e2 of Fp.edges) { if (e2.L < 8) continue; const nf = Math.min(Fp === F && parts.length > 1 ? 5 : 9, Math.floor(e2.L / 3.6)); for (let i = 1; i < nf; i++) { const q = onE(e2, e2.L * i / nf, 0.3); B.obox('c', q[0], q[1], Math.atan2(e2.nz, e2.nx), 0.6, 0.35, y0 === 0.2 ? 4.8 : y0, y1, C(L.fins)); } }
  }
});
const GLsub = (...ix) => ix.map(i => GL[i - 1]);
A.kinds({
  townhall: ['p_yakuba', { council: 1 }], cityhall: ['p_yakuba', { council: 1 }], wardoffice: 'p_yakuba', govhall: 'p_yakuba', prefhall: ['p_yakuba', { council: 1 }],
  court: ['p_yakuba', { looks: GLsub(4, 1, 10, 2, 8) }], milhq: ['p_yakuba', { mast: 1, looks: GLsub(10, 2, 8, 4, 1) }],
  zeimusho: ['p_yakuba', { looks: GLsub(8, 10, 1, 3, 2) }], hokenjo: ['p_yakuba', { looks: GLsub(8, 5, 1, 7, 3) }],
  police: ['p_yakuba', { lamp: 1, mast: 1, looks: GLsub(1, 8, 10, 2, 3, 5) }]
});

/* ================= グランピング（glamping）================= */
T.wood = TX('f:wood', 256, 128, (g, w, h, R) => { const k = k256(w), mw = w / 4;   // たて板の 壁（窓 2 つ）
  fill(g, 0, 0, w, h, '#8c6a4c'); for (let x = 0; x < w; x += 6 * k) { g.fillStyle = css(mix('#7a5a3e', '#a07c5a', R()), 1); g.fillRect(x, 0, 5.2 * k, h); }
  PT.noise(g, 0, 0, w, h, 0.04, R);
  for (const i of [0, 2]) PT.win(g, i * mw + mw * 0.2, h * 0.24, mw * 0.6, h * 0.46, { f: '#3a3632', fw: 2.5 * k, div: [2, 1], cur: 0.4, cc: ['#efe6d2', '#e8dcc4'], g0: '#a9bccb', g1: '#40505c', sill: '#5a4636' }, R);
  fill(g, 0, h * 0.95, w, h * 0.05, '#4a3a2c'); });
const canvasC = { white: '#f1efe8', beige: '#e3d6bc', khaki: '#b9ad8a', green: '#8d9a78', gray: '#c7c8c4' };
// ウッドデッキ
function deck(B, x0, z0, x1, z1, y, h, c) { B.box('c', x0, z0, x1, z1, y, y + h, C(c || '#8a6b4e')); }
// 1 つの宿：t（dome・bell・safari・cabin・aframe・trailer・yurt・tree）・まん中 (x, z)・向き ang（正面）
function glampUnit(B, P, t, x, z, y, ang, L, R) {
  const lod = P.lod, cv = C(L.cc || '#f1efe8'), ca = Math.cos(ang), sa = Math.sin(ang), fx = (a, b) => [x + ca * a - sa * b, z + sa * a + ca * b];
  const front = (d, w0, w1, y0, y1, c2) => { const p0 = fx(w0, d), p1 = fx(w1, d); B.wall('c', p0[0], p0[1], p1[0], p1[1], y0, y1, c2); };
  if (t === 'dome') { const r = L.r || 3.3; if (lod >= 2) deck(B, x - r - 1.2, z - r - 1.2, x + r + 1.2, z + r + 1.2, y, 0.35);
    B.dome('c', x, z, r, r, y + (lod >= 2 ? 0.35 : 0), r * 0.95, lod >= 2 ? 10 : 5, cv, { rings: lod >= 2 ? 3 : 1 });
    if (lod >= 2) { front(r - 0.25, -0.6, 0.6, y + 0.35, y + 2.2, [0.25, 0.24, 0.23]); const q = fx(r * 0.62, r * 0.55); B.box('c', q[0] - 0.4, q[1] - 0.4, q[0] + 0.4, q[1] + 0.4, y + 1.6, y + 2.4, [0.55, 0.62, 0.68]); }
    return y + r; }
  if (t === 'bell' || t === 'yurt') { const r = t === 'yurt' ? 3.2 : 2.7, wh = t === 'yurt' ? 1.7 : 0.9, n = lod >= 2 ? 10 : 5;
    if (lod >= 2) deck(B, x - r - 0.8, z - r - 0.8, x + r + 0.8, z + r + 0.8, y, 0.3);
    const y0 = y + (lod >= 2 ? 0.3 : 0); if (lod >= 2 || t === 'yurt') B.cyl('c', x, z, r, y0, y0 + wh, n, mul(cv, 0.95), { notop: true });
    B.cone('c', x, z, r * (t === 'yurt' ? 1.05 : 1), y0 + wh, y0 + wh + (t === 'yurt' ? 1.2 : 2.6), n, cv);
    if (lod >= 2) { front(r * 0.98, -0.45, 0.45, y0, y0 + Math.min(1.8, wh + 0.8), [0.3, 0.28, 0.25]); if (t === 'bell') B.cyl('c', x, z, 0.06, y0 + wh + 2.4, y0 + wh + 3.0, 4, [0.4, 0.35, 0.3]); }
    return y0 + wh + 2.6; }
  if (t === 'safari' && lod < 1) { B.obox('c', x, z, ang + PI / 2, 6.4, 4.6, y, y + 2.8, cv); return y + 2.8; }
  if (t === 'safari') { const w = 4.6, d = 6.4; if (lod >= 2) { const q = fx(0, 0.8); B.obox('c', q[0], q[1], ang + PI / 2, d + 2.2, w + 1.2, y, y + 0.4, C('#8a6b4e')); }
    const y0 = y + (lod >= 2 ? 0.4 : 0); B.obox('c', x, z, ang + PI / 2, d, w, y0, y0 + 2.1, mul(cv, 0.96));
    // 切妻の 布の屋根（正面に 少し のびる）
    const rp = (a, b, hh) => { const q = fx(a, b); return [q[0], hh, q[1]]; }, yr = y0 + 3.4, ye = y0 + 2.0;
    B.quad('c', rp(-w / 2 - 0.3, -d / 2, ye), rp(-w / 2 - 0.3, d / 2 + 1.2, ye), rp(0, d / 2 + 1.2, yr), rp(0, -d / 2, yr), null, cv);
    B.quad('c', rp(w / 2 + 0.3, d / 2 + 1.2, ye), rp(w / 2 + 0.3, -d / 2, ye), rp(0, -d / 2, yr), rp(0, d / 2 + 1.2, yr), null, mul(cv, 0.92));
    if (lod >= 1) { B.tri('c', rp(-w / 2, -d / 2, y0 + 2.1), rp(0, -d / 2, yr), rp(w / 2, -d / 2, y0 + 2.1), null, mul(cv, 0.9)); B.tri('c', rp(w / 2, d / 2, y0 + 2.1), rp(0, d / 2, yr), rp(-w / 2, d / 2, y0 + 2.1), null, mul(cv, 0.9)); }
    if (lod >= 2) front(d / 2 + 0.02, -0.7, 0.7, y0, y0 + 2.0, [0.3, 0.27, 0.23]);
    return yr; }
  if (t === 'trailer') { const w = 2.5, d = 8; B.obox(lod >= 1 ? T.alc : 'c', x, z, ang + PI / 2, d, w, y + (lod >= 2 ? 0.5 : 0), y + 3.0, cv, { su: 3.6, sv: 3.6 }); if (lod >= 2) { const q = fx(1.8, 0); B.obox('c', q[0], q[1], ang, 2.6, 3.2, y, y + 0.35, C('#8a6b4e')); B.obox('c', x, z, ang + PI / 2, d * 0.9, w * 0.8, y, y + 0.5, [0.25, 0.25, 0.26]); } return y + 3; }
  // キャビン・A フレーム・ツリーハウス
  const w = t === 'aframe' ? 5.2 : 4.8, d = t === 'aframe' ? 6.5 : 5.6, lift = t === 'tree' ? 3.2 : 0.5;
  const q0 = fx(-w / 2, -d / 2), q1 = fx(w / 2, d / 2), r = [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])];
  if (lod >= 2) { const qd = fx(0, d / 2 + 1.0); B.obox('c', qd[0], qd[1], ang, w + 0.6, 2.2, y + lift - 0.25, y + lift, C('#8a6b4e')); if (t === 'tree') for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) { const q = fx(a, b); post(B, q[0] - 0.15, q[1] - 0.15, q[0] + 0.15, q[1] + 0.15, y, y + lift, [0.4, 0.32, 0.25]); } }
  const ax = Math.abs(sa) > 0.7 ? 'x' : 'z', ra = ax === 'x' ? 'x' : 'z';
  if (t === 'aframe') { B.roof({ t: 'gable', r, y: y + lift + 0.4, ax: ra, p: 1.7, oh: 0.4, m: lod >= 1 ? T.kane : 'c', c: C(L.rc || '#3f3a36'), su: 3, mg: lod >= 1 ? T.curtain : 'c', cg: lod >= 1 ? [0.95, 0.97, 1] : [0.4, 0.45, 0.5], gsu: 3, gsv: 3, th: lod >= 2 ? 0.15 : 0, cf: [0.3, 0.28, 0.27] }); if (lod >= 2) post(B, r[0] + 0.3, r[1] + 0.3, r[2] - 0.3, r[3] - 0.3, y, y + lift + 0.4, C('#6b5340')); return y + lift + w * 0.5 * 1.7; }
  const yb = lod >= 2 ? y + lift : y;
  B.facade(lod >= 1 ? T.wood : 'c', rfoot(r), yb, y + lift + 2.7, { bw: 2.4, fh: 2.7, tb: 4, tf: 1, vy: y + lift, c: C(L.wc || '#ffffff') });
  if (lod >= 2 && lift > 0.4) post(B, r[0] + 0.2, r[1] + 0.2, r[2] - 0.2, r[3] - 0.2, y, y + lift, [0.35, 0.3, 0.26]);
  return B.roof({ t: L.ut2 || 'gable', r, y: y + lift + 2.7, ax: ra, p: 0.55, oh: 0.5, m: lod >= 1 ? T.kane : 'c', c: C(L.rc || '#4a4540'), su: 3, mg: lod >= 1 ? T.wood : 'c', cg: C(L.wc || '#ffffff'), gsu: 9.6, gsv: 2.7, th: lod >= 2 ? 0.12 : 0, cf: [0.3, 0.28, 0.27] });
}
const GPL = [
  { n: '白いドームテント', ut: 'dome', cc: canvasC.white, g: 'lawn', fo: 0.25 },
  { n: 'ベージュのベルテント', ut: 'bell', cc: canvasC.beige, g: 'lawn', fo: 0.3 },
  { n: 'カーキのサファリテント', ut: 'safari', cc: canvasC.khaki, g: 'forest', fo: 0.7 },
  { n: '木のキャビン', ut: 'cabin', wc: '#ffffff', rc: '#4d4842', g: 'forest', fo: 0.8 },
  { n: '黒いキャビン', ut: 'cabin', wc: '#4a423c', rc: '#2e2c2b', g: 'lawn', fo: 0.35 },
  { n: 'トレーラーハウス', ut: 'trailer', cc: '#e9e9e6', g: 'gravel', fo: 0.3 },
  { n: '森のドーム', ut: 'dome', cc: canvasC.green, g: 'forest', fo: 1.0, r: 3.0 },
  { n: '湖畔のテント', ut: 'bell', cc: canvasC.white, g: 'lawn', fo: 0.45, pond: 1 },
  { n: 'Aフレームの小屋', ut: 'aframe', rc: '#38332f', g: 'forest', fo: 0.75 },
  { n: '白いゲル', ut: 'yurt', cc: '#f3f1ea', g: 'lawn', fo: 0.2 }
];
A.arch('p_glamp', {
  looks: GPL,
  far(L) { return { H: 0.4, base: 0, wall: L.g === 'forest' ? T.mori : 'c', wc: [0.42, 0.52, 0.34], bw: 8, fh: 0.4, tb: 1, tf: 1, top: L.g === 'forest' ? T.mori : T.shiba, ct: W1, ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, nv0 = B.nv, Y = 0.06;
    const gm = L.g === 'forest' ? (lod >= 2 ? T.tsuchi : T.mori) : L.g === 'gravel' ? T.jari : T.shiba;
    pad(B, P, F, Y, gm, L.g === 'forest' ? (lod >= 2 ? '#7a7a5c' : W1) : L.g === 'gravel' ? '#cfc8b8' : W1, { su: L.g === 'gravel' ? 4 : 10 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 1)), fr = frm(r0, P.front), W = fr.W, D = fr.D, uc = W / 2;
    // 受付の建物と 駐車場（道がわ）
    const lw = cl(W * 0.25, 9, 16), ld = cl(lw * 0.6, 6, 9), lu0 = Math.max(1, uc - lw - 2);
    const rl = fr.R(lu0, 2, lu0 + lw, 2 + ld);
    B.facade(lod >= 1 ? T.wood : 'c', rfoot(rl), Y, Y + 3.4, { bw: 2.4, fh: 3.4, tb: 4, tf: 1, vy: Y, c: C(L.wc || '#ffffff') });
    B.top = Math.max(B.top, B.roof({ t: 'gable', r: rl, y: Y + 3.4, ax: fr.ax('u'), p: 0.5, oh: 0.8, m: lod >= 1 ? T.kane : 'c', c: C(L.rc || '#4a4540'), su: 3, mg: lod >= 1 ? T.wood : 'c', cg: C(L.wc || '#ffffff'), gsu: 9.6, gsv: 3.4, th: lod >= 2 ? 0.15 : 0, cf: [0.3, 0.28, 0.27] }));
    const pk = fr.R(uc + 1, 1.5, Math.min(W - 1.5, uc + 1 + Math.max(12, lw)), Math.min(D * 0.3, 13.5));
    parking(B, P, pk, Y + 0.02, R, { max: 6, fill: 0.6 });
    const outs = [A.rin(rl, -2), A.rin(pk, -1)];
    // 池（湖畔）
    let pond = null;
    if (L.pond && D > 30) { pond = fr.R(W * 0.55, D * 0.5, W - 2, D - 2); B.flat(T.mizu, pond, Y + 0.03, [0.85, 0.95, 0.98], { su: 10 }); if (lod >= 1) { B.flat('c', A.rin(pond, -1.2), Y + 0.015, [0.6, 0.62, 0.5]); } outs.push(A.rin(pond, -2)); }
    // 道（受付 → 奥）
    if (lod >= 1) flatU(B, fr, T.jari, uc - 1.5, 2 + ld, uc + 1.5, D - 3, Y + 0.03, '#d6ccb6', 4);
    outs.push(fr.R(uc - 2.5, 0, uc + 2.5, D));
    // 宿をならべる
    const sp = L.ut === 'trailer' ? 15 : L.ut === 'safari' || L.ut === 'cabin' || L.ut === 'aframe' ? 15 : 13, v0 = 2 + ld + 6;
    const area = W * (D - v0), nmax = lod >= 2 ? cl(Math.round(Math.sqrt(Math.max(0, area)) / 7), 3, 16) : lod >= 1 ? 7 : 2;
    const spots = [];
    for (let v = v0; v < D - 5; v += sp) for (let u = 6; u < W - 5; u += sp) {
      const uu = u + (R() - 0.5) * sp * 0.3, vv = v + (R() - 0.5) * sp * 0.25, q = fr.p(uu, vv);
      if (Math.abs(uu - uc) < 6.5) continue;
      if (pond && q[0] > pond[0] - 4 && q[0] < pond[2] + 4 && q[1] > pond[1] - 4 && q[1] < pond[3] + 4) continue;
      spots.push([uu, vv, R()]);
    }
    spots.sort((a, b) => a[2] - b[2]);
    const sl = spots.filter(q => q[0] < uc), sr = spots.filter(q => q[0] >= uc), pick = [];
    for (let i = 0; pick.length < nmax && (i < sl.length || i < sr.length); i++) { if (i < sl.length) pick.push(sl[i]); if (i < sr.length && pick.length < nmax) pick.push(sr[i]); }
    for (const [uu, vv] of pick) {
      const q = fr.p(uu, vv), ang = Math.atan2(-fr.dv[1], -fr.dv[0]) + (uu < uc ? 0.5 : -0.5) + (R() - 0.5) * 0.5;
      const t = L.ut === 'bell' && L.pond && R() < 0.3 ? 'safari' : L.ut;
      B.top = Math.max(B.top, glampUnit(B, P, t, q[0], q[1], Y + 0.02, ang, L, R));
      outs.push([q[0] - 5.5, q[1] - 5.5, q[0] + 5.5, q[1] + 5.5]);
      if (lod >= 2) { const fp = [q[0] + Math.cos(ang) * 5.2, q[1] + Math.sin(ang) * 5.2]; B.cyl('c', fp[0], fp[1], 0.45, Y, Y + 0.3, 6, [0.25, 0.24, 0.23]);
        for (const sg of [-1, 1]) B.box('c', fp[0] + sg * 1.1 - 0.25, fp[1] - 0.25, fp[0] + sg * 1.1 + 0.25, fp[1] + 0.25, Y, Y + 0.45, [0.65, 0.5, 0.35]); }
    }
    grove(B, P, F.rects.map(r => A.rin(r, 0.8)), outs, { sp: L.g === 'forest' ? 6 : 9, k: L.fo * 1.4, h: [9, 17], y: Y, n: L.g === 'forest' ? 0.4 : 0.15, p: 0.05, max: lod >= 2 ? 50 : 4, vmax: left(B, nv0, lod) });
  }
});
A.kinds({ glamping: 'p_glamp' });

/* ---------- 学校・病院・福祉などの 質感 ---------- */
T.school = TX('f:school', 256, 128, (g, w, h, R) => { const k = k256(w), mw = w / 4, mh = h / 2;   // 教室の大きな窓（腰壁・欄間）
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#efece5', n: 0.025, dirt: 0.06 }, R);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
    PT.win(g, X + mw * 0.03, Y + mh * 0.1, mw * 0.94, mh * 0.6, { f: '#e9e9e6', fw: 2 * k, div: [4, 1], cur: 0.35, cc: ['#f3efe4', '#e7e0cc', '#dfe6ea'], g0: '#b2c3cf', g1: '#4c5e6c' }, R);
    fill(g, X + mw * 0.03, Y + mh * 0.18, mw * 0.94, 2 * k, '#e9e9e6'); fill(g, X, Y + mh * 0.74, mw, mh * 0.26, '#e6e2d9'); g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(X, Y + mh * 0.74, mw, 2 * k); } });
T.gym = TX('f:gym', 256, 128, (g, w, h, R) => { const k = k256(w), mw = w / 4;   // 体育館：下は壁・上に 窓の帯
  PT.wallMat(g, 0, 0, w, h, { t: 'panel', c: '#dcd9d1', pw: 64, ph: 128, sc: k, n: 0.03, dirt: 0.08 }, R);
  for (let i = 0; i < 4; i++) { PT.win(g, i * mw + mw * 0.06, h * 0.12, mw * 0.88, h * 0.26, { f: '#c9cccd', fw: 2 * k, div: [3, 1], g0: '#b4c4cf', g1: '#53636e' }, R);
    if (i % 2 === 0) { fill(g, i * mw + mw * 0.3, h * 0.7, mw * 0.4, h * 0.14, '#9fa3a3'); PT.hlines(g, i * mw + mw * 0.3, h * 0.7, mw * 0.4, h * 0.14, 3 * k, '#7f8383', 1); } }
  fill(g, 0, h * 0.44, w, h * 0.04, '#c8c4bb'); });
T.siding = TX('f:siding', 256, 128, (g, w, h, R) => { const k = k256(w), mw = w / 4, mh = h / 2;   // 窯業系サイディング（家のような建物）
  PT.wallMat(g, 0, 0, w, h, { t: 'siding', c: '#eeebe4', sc: k * 1.2, n: 0.02 }, R);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh, big = (i + j) % 3 !== 2;
    if (big) PT.win(g, X + mw * 0.14, Y + mh * 0.22, mw * 0.72, mh * 0.56, { f: '#e8e8e6', fw: 2 * k, div: [2, 1], cur: 0.45, bl: 0.2, sill: '#d9d6cf' }, R);
    else PT.win(g, X + mw * 0.32, Y + mh * 0.26, mw * 0.36, mh * 0.3, { f: '#e8e8e6', fw: 2 * k, div: [1, 1], g0: '#d8dde0', g1: '#b9c0c4', refl: false }, R); } });
T.g1s = TX('g1:shop', 256, 128, (g, w, h, R) => PT.ground(g, w, h, { wall: { t: 'panel', c: '#d6d3cc', pw: 64, ph: 32, sc: k256(w) }, t: 'shop', tb: 4, f: '#45494c' }, R));
T.fence = TX('a:fence', 64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); const st = w / 10; g.strokeStyle = '#e8e8e4'; g.lineWidth = Math.max(1, w / 40);
  for (let i = -10; i < 20; i++) { g.beginPath(); g.moveTo(i * st, 0); g.lineTo(i * st + h, h); g.stroke(); g.beginPath(); g.moveTo(i * st, h); g.lineTo(i * st + h, 0); g.stroke(); }
  fill(g, 0, 0, w, h * 0.06, '#eeeeea'); fill(g, 0, 0, w * 0.06, h, '#eeeeea'); }, { alpha: true });
T.net = TX('a:net', 64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(235,240,235,.9)'; const st = w / 8; for (let i = 0; i < 8; i++) { g.fillRect(i * st, 0, Math.max(1, w / 64), h); g.fillRect(0, i * st, w, Math.max(1, w / 64)); } fill(g, 0, 0, w, h / 32, '#eef0ec'); }, { tr: true, op: 0.55 });
// 柵：辺の列（rfoot など）にそって すかしの フェンス。gap：あける所（[辺の番号, from, to]）
function fenceF(B, Fx, y, h, c, m, gaps, su) { for (let i = 0; i < Fx.edges.length; i++) { const e = Fx.edges[i], gp = gaps && gaps.find(q => q[0] === e);
  if (gp) { if (gp[1] > 0.3) B.wallE(m || T.fence, e, y, y + h, c, { to: gp[1], uv: [0, gp[1] / (su || 2), 0, h / (su || 2)] }); if (e.L - gp[2] > 0.3) B.wallE(m || T.fence, e, y, y + h, c, { from: gp[2], uv: [0, (e.L - gp[2]) / (su || 2), 0, h / (su || 2)] }); }
  else B.wallE(m || T.fence, e, y, y + h, c, { uv: [0, e.L / (su || 2), 0, h / (su || 2)] }); } }
// 低い植えこみ（四角い緑）
function hedge(B, r, y, h, c) { B.box('c', r[0], r[1], r[2], r[3], y, y + h, C(c || '#4f6b3c')); }
// 看板（屋上・正面の上）：辺 e のまん中に 板
function roofSign(B, e, at, w, y0, y1, cell, c) { signE(B, e, at - w / 2, at + w / 2, y0, y1, cell, 0.15, c || W1); }
// 建物のまわりの 木（前の辺は よける）
function yardTrees(B, P, F0, Fb, n, R, o = {}) { if (P.lod < 2 || n <= 0) return; const rr = F0.rects; let k = 0;
  for (let t = 0; t < n * 6 && k < n; t++) { const r = A.pick(R, rr), x = lerp(r[0] + 1.5, r[2] - 1.5, R()), z = lerp(r[1] + 1.5, r[3] - 1.5, R());
    if (Fb.rects.some(q => x > q[0] - 2.5 && x < q[2] + 2.5 && z > q[1] - 2.5 && z < q[3] + 2.5)) continue; if (o.out && o.out.some(q => x > q[0] - 1 && x < q[2] + 1 && z > q[1] - 1 && z < q[3] + 1)) continue;
    treeB(B, x, z, o.y || 0.06, lerp(5, o.h || 9, R()), lerp(2, 3.4, R()), A.pick(R, o.c || TCOL), R, P.lod); k++; } }

/* ================= 診療所・歯科・小児科・眼科・動物病院・産婦人科 ================= */
const IL = [
  { n: '白いタイル・ガラスの入口', fm: T.tile, wc: '#f5f4f0', sg: SG.teal, cn: '#eeeeea' },
  { n: 'クリーム色・瓦屋根', fm: T.siding, wc: '#f1e6cf', roof: 'hip', rm: T.kawara, sg: SG.green, cn: '#e7dcc6' },
  { n: '木調ルーバー・白い壁', fm: T.louver, wc: '#d8b48a', sg: SG.blank, cn: '#c69c70' },
  { n: 'レンガ調・切妻屋根', fm: T.brick, wc: W1, roof: 'gable', rm: T.kane, rc: '#4c4a48', sg: SG.navy, cn: '#e8e3d9' },
  { n: '淡いグレー・連窓', fm: T.ribbon, wc: '#dcdedd', sg: SG.teal, cn: '#e9eaea' },
  { n: '白い箱・木のひさし', fm: T.alc, wc: '#f3f2ee', sg: SG.orange, cn: '#b8875c' }
];
A.arch('p_iin', {
  looks: IL,
  far(L, P) { const n = Math.max(1, P.f), pit = L.roof && n <= 3, d = fmDims(L.fm); return { H: 0.3 + 3.6 * n, base: 0.3, wall: L.fm, bw: 3.2, fh: 3.6, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: pit ? L.rm : null, rc: pit ? (L.rc ? C(L.rc) : W1) : [0.62, 0.62, 0.6], rt: pit ? L.roof : 'flat', p: 0.45, ins: 1.5 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), d = fmDims(L.fm);
    const sp = F0.n >= 2 ? splitFront(F0, P.front, 2) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) : F0, F = A.inset(Fm, SB(P, sp.fore.length ? 0.8 : 1.4)), pit = L.roof && n <= 3;
    const H = rcBlock(B, P, F, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.2, fh: 3.4, g1: 3.8, base: 0.3, g1m: lod >= 1 && L.fm !== T.siding ? T.g1 : null, wc: C(L.wc), g1c: mix(C(L.wc), W1, 0.4), roof: pit ? L.roof : 'flat', rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: L.roof === 'gable' ? 0.5 : 0.42, par: 0.7, oh: 0.6 });
    B.top = Math.max(B.top, H + (pit ? 3 : 0));
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore); for (const r of Ff.rects) parking(B, P, A.rin(r, 0.4), 0.06, R, { max: 4 }); if (lod >= 1) B.plinth(Ff, P.yb, 0.06); }
    else if (lod >= 1) pad(B, P, F0, 0.05, T.jari, '#cfcac0', { su: 4 });
    if (lod < 1) return;
    const e = A.frontEdge(F, P.front), mid = e.L * (0.35 + 0.3 * R()), dw = Math.min(2.4, e.L * 0.3);
    signE(B, e, mid - dw / 2, mid + dw / 2, 0.3, 2.6, SG.door, 0.08);
    canopy(B, e, mid, Math.min(e.L - 0.6, dw + 2), 1.3, 2.95, L.cn, { th: 0.2, lod });
    const sw = Math.min(e.L * 0.6, 7), at = cl(mid, sw / 2 + 0.3, e.L - sw / 2 - 0.3), ys = pit || n === 1 ? 3.35 : 0.3 + 3.8 + 0.3;
    if (!pit || n > 1) roofSign(B, e, at, sw, Math.min(H - 1.2, ys + 0.1), Math.min(H - 0.15, ys + 1.2), L.sg);
    else roofSign(B, e, at, sw, 3.3, 3.9, L.sg);
    if (lod >= 2) { const q = onE(e, mid + dw / 2 + 1.2, 0.8); hedge(B, [q[0] - 0.6, q[1] - 0.6, q[0] + 0.6, q[1] + 0.6], 0.06, 0.8, '#55703f');
      for (const e2 of F.edges) if (e2 !== e && e2.L > 5 && R() < 0.6) { const q2 = onE(e2, e2.L * (0.3 + 0.4 * R()), 0.35); B.acUnit(q2[0], q2[1], 0.3, Math.atan2(e2.nz, e2.nx) + PI / 2); } }
  }
});
A.kinds({ clinic: 'p_iin', dental: 'p_iin', pedi: 'p_iin', eye: 'p_iin', vet: 'p_iin', obgyn: 'p_iin' });

/* ================= 病院（総合・救急・大病院・市立・大学病院）================= */
const HL = [
  { n: '白いタイル・連窓', fm: T.ribbon, wc: '#f6f6f3', g1c: '#e9e8e4', cn: '#efefec' },
  { n: 'クリーム色のタイル', fm: T.tile, wc: '#f2e9d6', g1c: '#e6dcc8', cn: '#e9e2d4' },
  { n: 'ガラスと白い枠', fm: T.curtain, wc: W1, g1c: '#d9dcde', cn: '#f0f0ee', fins: '#f2f2ef' },
  { n: '茶色のタイル', fm: T.tile, wc: '#ad8c72', g1c: '#b8a08c', cn: '#d9d2c6', pc: '#86695a' },
  { n: '淡いグレー・バルコニー', fm: T.alc, wc: '#e4e5e3', g1c: '#dcdcd8', cn: '#ececea', ledge: 1.2, lc: '#efefec' },
  { n: 'ベージュの格子', fm: T.grid, wc: '#ece2cf', g1c: '#e0d6c4', cn: '#e4dccb' }
];
A.arch('p_byoin', {
  looks: HL,
  far(L, P) { const n = Math.max(1, P.f), d = fmDims(L.fm); return { H: 0.2 + 4.4 + (n - 1) * 3.6, base: 0.2, wall: L.fm, bw: 3.6, fh: 3.6, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: null, rc: [0.62, 0.62, 0.6], rt: 'flat', ins: 1 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), d = fmDims(L.fm), ko = P.ko;
    const deep = P.tilt ? 1 : Math.max(...[...cellDepth(F0, P.front).values()].map(v => v[1]));
    const sp = F0.n >= 4 && deep >= 3 ? splitFront(F0, P.front, 3, deep >= 8 ? 2 : 1) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) || F0 : F0, F = A.inset(Fm, SB(P, 0.8));
    const np = Math.min(n, n >= 6 ? 3 : n), hp = 0.2 + 4.4 + (np - 1) * 3.9;
    const blk = (Fx, k, base, g1, rt) => rcBlock(B, P, Fx, k, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 3.6, g1, base, g1m: base < 1 && lod >= 1 ? T.g1 : null, wc: C(L.wc), g1c: C(L.g1c), pc: L.pc, roof: 'flat', par: 1.0, ledge: base > 1 ? L.ledge : 0, lc: L.lc, rt });
    let H = blk(F, np, 0.2, 4.4, n <= np), FT = F;
    if (n > np) {   // 病棟（細長い棟）
      const rr = mainRect(F, P.front), w = rr[2] - rr[0], dd = rr[3] - rr[1], th = Math.min(18, Math.max(12, Math.min(w, dd) * 0.45), Math.min(w, dd) - 1);
      let rt = w >= dd ? [rr[0] + 2, (rr[1] + rr[3]) / 2 - th / 2, rr[2] - 2, (rr[1] + rr[3]) / 2 + th / 2] : [(rr[0] + rr[2]) / 2 - th / 2, rr[1] + 2, (rr[0] + rr[2]) / 2 + th / 2, rr[3] - 2];
      if (rt[2] - rt[0] < 8 || rt[3] - rt[1] < 8) rt = rr;
      FT = rfoot(rt); H = rcBlock(B, P, FT, n - np, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 3.6, g1: 3.6, base: hp, wc: C(L.wc), pc: L.pc, roof: 'flat', par: 1.1, ledge: L.ledge, lc: L.lc });
    }
    B.top = Math.max(B.top, H);
    // ヘリポート（大きい病院）
    if ((ko.heli || n >= 8) && lod >= 1) { const rr = mainRect(FT, P.front), c = [(rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2], hs = Math.min(10, (rr[2] - rr[0]) * 0.42, (rr[3] - rr[1]) * 0.42);
      if (hs > 5) { if (lod >= 2) B.box('c', c[0] - hs, c[1] - hs, c[0] + hs, c[1] + hs, H + 0.1, H + 0.7, [0.55, 0.56, 0.56]); signFlat(B, [c[0] - hs + 0.4, c[1] - hs + 0.4, c[0] + hs - 0.4, c[1] + hs - 0.4], H + (lod >= 2 ? 0.75 : 0.15), SG.heli); } }
    // 前庭：車寄せ・駐車場
    const e = A.frontEdge(F, P.front), mid = e.L / 2;
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore), q0 = onE(e, mid - 9, 0), q1 = onE(e, mid + 9, 9), rp = [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])];
      for (const r of Ff.rects) parking(B, P, A.rin(r, 0.3), 0.06, R, { avoid: [rp], max: 14, fill: 0.7 });
      if (lod >= 1) { B.plinth(Ff, P.yb, 0.06); const c = onE(e, mid, 6); B.cyl('c', c[0], c[1], 3, 0.06, 0.35, lod >= 2 ? 10 : 6, [0.62, 0.62, 0.6]); if (lod >= 2) { B.cyl('c', c[0], c[1], 2.7, 0.35, 0.45, 10, [0.36, 0.5, 0.3], { notop: false }); treeB(B, c[0], c[1], 0.45, 6, 2.4, '#4f6e3a', R, lod); } } }
    if (lod < 1) return;
    const dw = Math.min(5, e.L * 0.3);
    signE(B, e, mid - dw / 2, mid + dw / 2, 0.2, 2.8, SG.door, 0.08);
    canopy(B, e, mid, Math.min(e.L - 1, 14), 7, 4.4, L.cn, { posts: 1, lod, th: 0.5, y0: 0.06 });
    if (n >= 3) roofSign(B, e, e.L * 0.78, Math.min(9, e.L * 0.3), Math.min(H, hp) - 2.2, Math.min(H, hp) - 0.6, SG.green);
    if (ko.er && lod >= 1) { const e2 = F.edges.find(q => Math.abs(q.nx * e.nx + q.nz * e.nz) < 0.3 && q.L > 10) || e, m2 = e2 === e ? e.L * 0.15 : e2.L * 0.5;
      canopy(B, e2, m2, 8, 6, 4.2, '#dcdcd8', { posts: 1, lod, th: 0.45, y0: 0.06 }); signE(B, e2, m2 - 2, m2 + 2, 0.2, 2.8, SG.door, 0.08); if (lod >= 2) { const q = onE(e2, m2, 3.5); B.obox('c', q[0], q[1], Math.atan2(e2.nz, e2.nx), 5.4, 2.0, 0.3, 2.6, [0.95, 0.95, 0.94]); B.obox('c', q[0], q[1], Math.atan2(e2.nz, e2.nx), 5.42, 2.02, 1.2, 1.45, [0.55, 0.58, 0.6]); } }
    if (L.fins && lod >= 2) for (const e2 of FT.edges) { if (e2.L < 8) continue; const nf = Math.min(12, Math.floor(e2.L / 3.6)); for (let i = 1; i < nf; i++) { const q = onE(e2, e2.L * i / nf, 0.3); B.obox('c', q[0], q[1], Math.atan2(e2.nz, e2.nx), 0.5, 0.3, FT === F ? 4.6 : hp, H, C(L.fins)); } }
  }
});
A.kinds({ hospital: 'p_byoin', erhosp: ['p_byoin', { er: 1, heli: 1 }], bighosp: ['p_byoin', { heli: 1, er: 1 }], cityhosp: ['p_byoin', { er: 1 }], uhosp: ['p_byoin', { heli: 1 }] });

/* ================= 福祉（老人ホーム・介護施設・デイサービス）================= */
const WL = [
  { n: '白い外壁・バルコニー', fm: T.siding, wc: '#f4f2ec', bal: 1, sg: SG.green },
  { n: 'ベージュのタイル', fm: T.tile, wc: '#eadcc2', sg: SG.orange },
  { n: '木の外壁・瓦屋根', fm: T.wood, wc: '#e9d8bd', roof: 'hip', rm: T.kawara, sg: SG.blank },
  { n: 'れんが色・切妻屋根', fm: T.brick, wc: W1, roof: 'gable', rm: T.kane, rc: '#5d5450', sg: SG.teal },
  { n: '淡いグレー・大きな窓', fm: T.ribbon, wc: '#e2e3e1', sg: SG.navy }
];
A.arch('p_fukushi', {
  looks: WL,
  far(L, P) { const n = Math.max(1, P.f), pit = L.roof && n <= 3, d = fmDims(L.fm); return { H: 0.3 + 3.3 * n, base: 0.3, wall: L.fm, bw: 3.2, fh: 3.3, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: pit ? L.rm : null, rc: pit ? (L.rc ? C(L.rc) : W1) : [0.62, 0.62, 0.6], rt: pit ? L.roof : 'flat', p: 0.45, ins: 1.5 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), d = fmDims(L.fm);
    const sp = F0.n >= 3 ? splitFront(F0, P.front, 2) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) : F0, F = A.inset(Fm, SB(P, 1.0)), pit = L.roof && n <= 3;
    const H = rcBlock(B, P, F, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.2, fh: 3.2, g1: 3.6, base: 0.3, g1m: lod >= 1 && n >= 3 ? T.g1 : null, wc: C(L.wc), g1c: mix(C(L.wc), W1, 0.3), roof: pit ? L.roof : 'flat', rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: L.roof === 'gable' ? 0.5 : 0.42, par: 0.8, oh: 0.7, ledge: L.bal && n >= 2 ? 1.1 : 0, lc: '#e8e6e0' });
    B.top = Math.max(B.top, H + (pit ? 3 : 0));
    if (L.bal && n >= 2 && lod >= 2) { const e = A.frontEdge(F, P.front); for (let j = 1; j < n; j++) B.rail(T.rail, e, 0.3 + 3.6 + (j - 1) * 3.2 + 0.06, 1.0, 1.1, [0.95, 0.95, 0.93], { su: 1.2 }); }
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore); for (const r of Ff.rects) parking(B, P, A.rin(r, 0.4), 0.06, R, { max: 5 }); if (lod >= 1) B.plinth(Ff, P.yb, 0.06);
      if (lod >= 2) { const r = Ff.rects[0], x = r[0] + 3, z = (r[1] + r[3]) / 2; B.obox('c', x, z, 0, 4.6, 1.8, 0.3, 2.1, [0.96, 0.96, 0.95]); } }
    else if (lod >= 1) pad(B, P, F0, 0.05, T.shiba, W1, { su: 10 });
    if (lod < 1) return;
    const e = A.frontEdge(F, P.front), mid = e.L / 2;
    signE(B, e, mid - 1.4, mid + 1.4, 0.3, 2.6, SG.door, 0.08); canopy(B, e, mid, 6, 2.6, 3.0, '#ecebe6', { posts: 1, lod, th: 0.25, y0: 0.06 });
    roofSign(B, e, mid + Math.min(5, e.L * 0.3), Math.min(4, e.L * 0.2), 3.2, 3.8, L.sg);
    yardTrees(B, P, F0, F, 4, R);
  }
});
A.kinds({ nursing: 'p_fukushi', care: 'p_fukushi', dayserv: 'p_fukushi' });

/* ================= 学校（小・中・高・一貫校・工業・商業・附属・士官学校）================= */
// 体育館：長方形 r（世界）・高さ h。屋根 t（'barrel' | 'gable' | 'flat'）・色 rc
function gymHall(B, P, r, y, h, t, rc, wc, o = {}) {
  const lod = P.lod, Fg = rfoot(r);
  if (!o.onpad && (lod >= 1 || P.yb < -0.5)) B.plinth(Fg, P.yb, y + 0.2);
  if (lod < 1 && t === 'barrel') t = 'gable';
  B.facade(lod >= 1 ? (o.fm || T.gym) : 'c', Fg, y + 0.2, y + h, { bw: 4.5, fh: h - 0.2, tb: 4, tf: 1, vy: y + 0.2, c: wc || W1, ao: 0.88 });
  if (t === 'flat') { B.cap(lod >= 1 ? T.flat : 'c', Fg, y + h, lod >= 1 ? W1 : [0.62, 0.62, 0.6], { su: 8 }); if (lod >= 1) B.parapet(Fg, y + h, 0.7, 0.25, mul(wc || W1, 0.9)); return y + h + 0.7; }
  return B.roof({ t, r, y: y + h, p: t === 'barrel' ? 0.16 : 0.32, oh: 0.6, m: lod >= 1 ? T.kane : 'c', c: C(rc), su: 3, mg: lod >= 1 ? (o.fm || T.gym) : 'c', cg: wc || W1, gsu: 18, gsv: h, th: lod >= 2 ? 0.2 : 0, cf: mul(C(rc), 0.7), n: lod >= 2 ? 10 : 4 });
}
// プール（25 m）
function pool(B, P, r, y, o = {}) {
  const lod = P.lod; if (lod < 1) { B.flat('c', A.rin(r, 1.5), y + 0.05, [0.4, 0.65, 0.75]); return; } B.box('c', r[0], r[1], r[2], r[3], y, y + 0.5, [0.78, 0.78, 0.76]);
  const wr = A.rin(r, Math.min(2, (r[2] - r[0]) * 0.12)); B.flat(lod >= 1 ? T.mizu : 'c', wr, y + 0.52, lod >= 1 ? (o.wc || [0.55, 0.85, 0.95]) : [0.4, 0.65, 0.75], { su: 8 });
  if (lod >= 2) { const lanes = Math.floor((wr[3] - wr[1]) / 2.2); for (let i = 1; i < lanes; i++) { const z = wr[1] + (wr[3] - wr[1]) * i / lanes; B.flat('c', [wr[0] + 0.5, z - 0.05, wr[2] - 0.5, z + 0.05], y + 0.54, [0.95, 0.95, 0.9]); } if (o.fence !== false) fenceF(B, rfoot(r), y + 0.5, 1.8, [0.6, 0.72, 0.62]); }
}
// 校庭のトラック（白線の だ円）
function trackLines(B, P, r, y, c) {
  if (P.lod < 2) return; const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, w = r[2] - r[0], d = r[3] - r[1], ax = w >= d, L = (ax ? w : d) * 0.84, Rr = (ax ? d : w) * 0.36, st = Math.max(0, L / 2 - Rr), n = 14, pts = [];
  for (let i = 0; i < n; i++) { const a = -PI / 2 + PI * i / (n - 1); pts.push([st + Math.cos(a) * Rr, Math.sin(a) * Rr]); }
  for (let i = 0; i < n; i++) { const a = PI / 2 + PI * i / (n - 1); pts.push([-st + Math.cos(a) * Rr, Math.sin(a) * Rr]); }
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], P2 = q => ax ? [cx + q[0], cz + q[1]] : [cx + q[1], cz + q[0]], A2 = P2(a), B2 = P2(b), dx = B2[0] - A2[0], dz = B2[1] - A2[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.07, nz = dx / l * 0.07;
    B.quad('c', [A2[0] - nx, y, A2[1] - nz], [A2[0] + nx, y, A2[1] + nz], [B2[0] + nx, y, B2[1] + nz], [B2[0] - nx, y, B2[1] - nz], [0, 1, 0], c || [0.95, 0.95, 0.92]); }
}
// サッカーゴール・バックネット
function goal(B, x, z, y, ang) { const ca = Math.cos(ang), sa = Math.sin(ang), P2 = s => [x - sa * s, z + ca * s]; for (const s1 of [-3.6, 3.6]) { const q = P2(s1); B.box('c', q[0] - 0.06, q[1] - 0.06, q[0] + 0.06, q[1] + 0.06, y, y + 2.4, [0.95, 0.95, 0.95]); } const a = P2(-3.6), b = P2(3.6); B.wall(T.net, a[0], a[1], b[0], b[1], y, y + 2.4, W1, [0, 3, 0, 1]); }
const SCL = [
  { n: '白い校舎・時計', fm: T.school, wc: '#f6f5f1', gr: 'barrel', grc: '#a9aeb2', pc: '#cfd3d6' },
  { n: 'クリーム色の校舎', fm: T.school, wc: '#f1e5c9', gr: 'gable', grc: '#5f7f62', pc: '#e8dcc0' },
  { n: 'レンガ色のタイル', fm: T.brick, wc: W1, gr: 'barrel', grc: '#7d5a48', pc: '#8a5545' },
  { n: '打ちはなし', fm: T.conc, wc: W1, gr: 'flat', grc: '#a8a6a0', pc: '#c9c7c1' },
  { n: '木と白の新しい校舎', fm: T.louver, wc: '#d9b993', gr: 'gable', grc: '#6c5a4a', pc: '#ebe8e1' },
  { n: 'ベージュ・青い体育館', fm: T.school, wc: '#eadcc0', gr: 'barrel', grc: '#4f6d8a', pc: '#dfd2b8' }
];
A.arch('p_gakko', {
  looks: SCL,
  far(L, P) { const d = fmDims(L.fm); return { H: 4, base: 0.3, wall: L.fm, bw: 4, fh: 3.8, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: null, rc: [0.62, 0.62, 0.6], rt: 'flat', ins: 3, top: T.tsuchi, ct: [0.95, 0.9, 0.8] }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), ko = P.ko, Y = 0.06, nv0 = B.nv;
    pad(B, P, F, Y, lod >= 1 ? T.tsuchi : 'c', lod >= 1 ? '#d2c4a8' : '#b9a98a', { su: 10 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 1.2)), fr = frm(r0, P.front), W = fr.W, D = fr.D;
    // 校舎（奥）：はば いっぱい・奥行き 15 m
    const bd = Math.min(cl(D * 0.3, 10, 17), D - 0.5), sw2 = Math.min(W, Math.max(30, W * 0.85)), su0 = (W - sw2) / 2;
    const rs = fr.R(su0, D - bd, su0 + sw2, D);
    const Fs = rfoot(rs), d = fmDims(L.fm);
    const H = rcBlock(B, P, Fs, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 4, fh: 3.8, g1: 3.8, base: 0.3, wc: C(L.wc), pc: L.pc, roof: 'flat', par: 1.2, ledge: L.fm === T.school ? 0.9 : 0, lc: mix(C(L.wc), W1, 0.3), rt: false, onpad: 1 });
    B.top = Math.max(B.top, H);
    if (lod >= 2) { const e = rfoot(rs).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) { signE(B, e, e.L / 2 - 1.4, e.L / 2 + 1.4, H - 3.2, H - 0.4, SG.clock, 0.12); B.rail(T.fence, e, H + 1.2, 1.4, -0.2, [0.75, 0.8, 0.76], { su: 2 }); }
      const q = fr.p(su0 + sw2 * 0.8, D - bd * 0.5); B.box('c', q[0] - 1.6, q[1] - 1.6, q[0] + 1.6, q[1] + 1.6, H, H + 1.0, [0.55, 0.55, 0.55]); B.box('c', q[0] - 1.4, q[1] - 1.4, q[0] + 1.4, q[1] + 1.4, H + 1.0, H + 2.8, [0.86, 0.86, 0.83]); }
    // 体育館・プール（前の よこ）
    const field = [1.5, 1.5, W - 1.5, D - bd - 2];
    const gw = cl(W * 0.3, 18, 38), gd = cl(gw * 0.65, 14, 26), roomG = D - bd - 4 > gd + 6 && W > gw + 30;
    if (roomG) { const rg = fr.R(W - 1.5 - gw, D - bd - 2 - gd, W - 1.5, D - bd - 2); B.top = Math.max(B.top, gymHall(B, P, rg, Y, cl(gw * 0.36, 8, 12), L.gr, L.grc, C(L.wc), { onpad: 1 }));
      field[2] = W - 3 - gw;
      if (!ko.nopool && D - bd - gd - 4 > 16) { const pw = 25, pd = 13, rp = fr.R(W - 1.5 - Math.min(gw, pw + 4), D - bd - 4 - gd - pd - 4, W - 1.5, D - bd - 4 - gd); pool(B, P, rp, Y); } }
    else if (!ko.nopool && n >= 2 && lod >= 1) { const rr = A.rin(rs, 3); if (rr[2] - rr[0] > 28 && rr[3] - rr[1] > 10) { const c = [(rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2], hx = Math.min(13, (rr[2] - rr[0]) / 2 - 1), hz = Math.min(6, (rr[3] - rr[1]) / 2 - 1); pool(B, P, [c[0] - hx, c[1] - hz, c[0] + hx, c[1] + hz], H, { fence: true }); } }
    // 工業高校：実習棟（のこぎり屋根）
    if (ko.shop && lod >= 1 && W > 50) { const rw = fr.R(1.5, D - bd - 2 - 14, Math.min(28, W * 0.35), D - bd - 2); B.facade(T.alc, rfoot(rw), Y, Y + 5, { bw: 3.6, fh: 3.6, tb: 4, tf: 4, vy: Y, c: [0.92, 0.92, 0.9] }); B.roofs(rfoot(rw), { t: 'saw', y: Y + 5, p: 0.45, m: T.kane, c: C('#8d969b'), su: 3, mg: T.alc, cg: [0.92, 0.92, 0.9], k: T.g1, tw: 7, hmax: 3 }); field[0] = Math.min(28, W * 0.35) + 2; }
    // 校庭：トラック・ゴール・バックネット
    const fw = field[2] - field[0], fd = field[3] - field[1];
    if (fw > 20 && fd > 14) { const rf = fr.R(field[0], field[1], field[2], field[3]);
      trackLines(B, P, A.rin(rf, 2), Y + 0.02);
      if (lod >= 2) { const c = [(rf[0] + rf[2]) / 2, (rf[1] + rf[3]) / 2], ax = rf[2] - rf[0] >= rf[3] - rf[1]; for (const sg of [-1, 1]) { const L2 = (ax ? rf[2] - rf[0] : rf[3] - rf[1]) * 0.5 - 4; goal(B, ax ? c[0] + sg * L2 : c[0], ax ? c[1] : c[1] + sg * L2, Y, ax ? 0 : PI / 2); }
        const bq0 = fr.p(field[0] + 1, field[1] + 1), bq1 = fr.p(field[0] + 9, field[1] + 1); B.wall(T.net, bq0[0], bq0[1], bq1[0], bq1[1], Y, Y + 8, W1, [0, 4, 0, 4]); } }
    if (lod < 1) return;
    // 校門・フェンス・桜
    const Fr = rfoot(A.rin(r0, -1.0)), ef = Fr.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9);
    if (lod >= 2 && !P.tilt) { fenceF(B, Fr, Y, 2.2, [0.55, 0.66, 0.56], T.fence, ef ? [[ef, ef.L * 0.3, ef.L * 0.3 + 7]] : null);
      if (ef) for (const t of [ef.L * 0.3 - 0.5, ef.L * 0.3 + 7.5]) { const q = onE(ef, t, 0); B.box('c', q[0] - 0.5, q[1] - 0.5, q[0] + 0.5, q[1] + 0.5, Y, Y + 2.2, [0.7, 0.68, 0.64]); } }
    const nt = lod >= 2 ? Math.min(10, Math.floor(W / 9)) : 3;
    for (let i = 0; i < nt; i++) { const u = (i + 0.5) * W / nt; if (ef && Math.abs(u - ef.L * 0.3 - 3.5) < 6) continue; const q = fr.p(u, 0.4); if (B.nv - nv0 > BUD[lod >= 2 ? 2 : 1]) break; treeB(B, q[0], q[1], Y, 7.5 + R() * 2, 3.6, A.pick(R, ['#5f7d45', '#668449', '#58773f']), R, lod); }
    // 自転車おき場（中学・高校）
    if (ko.bike && lod >= 2) { const e = rfoot(rs).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) bikeShed(B, P, e, 2, Math.min(20, e.L * 0.25), 3, Y); }
  }
});
A.kinds({ es: 'p_gakko', jhs: ['p_gakko', { bike: 1 }], hs: ['p_gakko', { bike: 1 }], jhshs: ['p_gakko', { bike: 1 }], esjhs: 'p_gakko', techhs: ['p_gakko', { bike: 1, shop: 1 }], comhs: ['p_gakko', { bike: 1 }], uschool: 'p_gakko', milschool: ['p_gakko', { nopool: 1, looks: [SCL[2], SCL[3], SCL[1], SCL[5]] }] });

/* ================= 幼稚園・保育園 ================= */
function playset(B, P, x, z, y, ang, R) {   // すべり台・ジャングルジム・ブランコ・砂場
  if (P.lod < 2) return; const ca = Math.cos(ang), sa = Math.sin(ang), at = (a, b) => [x + ca * a - sa * b, z + sa * a + ca * b];
  const c1 = A.pick(R, [[0.85, 0.55, 0.3], [0.4, 0.6, 0.75], [0.85, 0.75, 0.35]]);
  { const q = at(0, 0); B.box('c', q[0] - 0.8, q[1] - 0.8, q[0] + 0.8, q[1] + 0.8, y + 1.6, y + 1.8, c1); post(B, q[0] - 0.8, q[1] - 0.8, q[0] - 0.65, q[1] - 0.65, y, y + 1.6, [0.7, 0.7, 0.7]); post(B, q[0] + 0.65, q[1] + 0.65, q[0] + 0.8, q[1] + 0.8, y, y + 1.6, [0.7, 0.7, 0.7]);
    const s0 = at(0.8, -0.4), s1 = at(3.6, -0.4), s2 = at(3.6, 0.4), s3 = at(0.8, 0.4); B.quad('c', [s0[0], y + 1.7, s0[1]], [s1[0], y + 0.2, s1[1]], [s2[0], y + 0.2, s2[1]], [s3[0], y + 1.7, s3[1]], null, [0.92, 0.92, 0.9]); }
  { const q = at(-4, 2); B.box(T.rail, q[0] - 1, q[1] - 1, q[0] + 1, q[1] + 1, y, y + 1.8, [0.85, 0.45, 0.35], { su: 0.7 }); }
  { const a = at(-1.5, -3), b = at(1.5, -3); post(B, a[0] - 0.06, a[1] - 0.06, a[0] + 0.06, a[1] + 0.06, y, y + 2.2, c1); post(B, b[0] - 0.06, b[1] - 0.06, b[0] + 0.06, b[1] + 0.06, y, y + 2.2, c1); beam(B, [a[0], y + 2.2, a[1]], [b[0], y + 2.2, b[1]], 0.12, 0.12, c1); }
  { const q = at(3.5, 3); B.box('c', q[0] - 1.5, q[1] - 1.5, q[0] + 1.5, q[1] + 1.5, y, y + 0.25, [0.8, 0.72, 0.55]); }
}
const KL = [
  { n: '白い壁・オレンジの屋根', fm: T.siding, wc: '#f6f4ee', roof: 'gable', rm: T.kane, rc: '#c27a52' },
  { n: '木の外壁・大きな屋根', fm: T.wood, wc: '#f1dfc2', roof: 'gable', rm: T.kane, rc: '#4c4a47' },
  { n: '淡い黄色・平屋根', fm: T.siding, wc: '#f3e6b8', roof: 'flat', pc: '#d9cc9e' },
  { n: 'れんが調・寄棟屋根', fm: T.brick, wc: W1, roof: 'hip', rm: T.kawara, rc: '#c9ced3' },
  { n: '白い箱・緑の屋根', fm: T.alc, wc: '#f4f4f0', roof: 'gable', rm: T.kane, rc: '#6d8b64' }
];
A.arch('p_youji', {
  looks: KL,
  far(L, P) { const n = Math.max(1, P.f), d = fmDims(L.fm), pit = L.roof !== 'flat'; return { H: 0.3 + 3.4 * n, base: 0.3, wall: L.fm, bw: 3.2, fh: 3.4, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: pit ? L.rm : null, rc: pit ? (L.rc ? C(L.rc) : W1) : [0.62, 0.62, 0.6], rt: pit ? (L.roof === 'hip' ? 'hip' : 'gable') : 'flat', p: 0.42, ins: 3 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), Y = 0.06;
    pad(B, P, F, Y, lod >= 1 ? T.tsuchi : 'c', lod >= 1 ? '#d6c9ae' : '#bcae92', { su: 8 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 1.2)), fr = frm(r0, P.front), W = fr.W, D = fr.D, bd = Math.min(cl(D * 0.42, 8, 14), D - 0.5);
    const rb = fr.R(1, D - bd, W - 1, D), Fb = rfoot(rb), d = fmDims(L.fm);
    const H = rcBlock(B, P, Fb, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.2, fh: 3.3, g1: 3.5, base: 0.3, wc: C(L.wc), pc: L.pc, roof: L.roof, rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: L.roof === 'gable' ? 0.42 : 0.4, oh: 1.0, par: 0.7, rt: false, onpad: 1 });
    B.top = Math.max(B.top, H + 3);
    if (lod >= 2) { const e = Fb.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) { B.ledge(e, 2.9, 3.1, 1.6, C('#e9e6df')); signE(B, e, e.L * 0.2, e.L * 0.2 + 1.8, 0.3, 2.5, SG.door, 1.7); } }
    if (D - bd > 9 && W > 12) { const q = fr.p(W * 0.4, (D - bd) * 0.5); playset(B, P, q[0], q[1], Y, fr.aU, R); }
    if (lod >= 2 && !P.tilt) fenceF(B, rfoot(A.rin(r0, -0.9)), Y, 1.6, [0.85, 0.85, 0.82], T.rail, null, 1.2);
    yardTrees(B, P, F, Fb, 3, R, { out: [fr.R(W * 0.2, 2, W * 0.75, D - bd - 1)] });
  }
});
A.kinds({ kinder: 'p_youji', nursery: 'p_youji' });

/* ================= 大学・短大・大学の建物 ================= */
const UL = [
  { n: '赤レンガ・時計塔', fm: T.brick, wc: W1, tower: 1, rf: 'hip', rm: T.kawara, rc: '#80868c' },
  { n: '白いタイル・連窓', fm: T.ribbon, wc: '#f3f2ee' },
  { n: 'ガラスと打ちはなし', fm: T.curtain, wc: W1, fm2: T.conc },
  { n: 'ベージュの石張り', fm: T.stone, wc: '#e2d8c6' },
  { n: '茶色のタイル', fm: T.tile, wc: '#a98a70', pc: '#86695a' },
  { n: '白い柱とガラス', fm: T.curtain, wc: W1, fins: '#f2f2ef', fm2: T.ribbon }
];
function uniBlock(B, P, r, n, L, alt, o = {}) {   // 大学の 1 棟（長方形 r）
  const fm = alt && L.fm2 ? L.fm2 : L.fm, d = fmDims(fm), Fx = rfoot(r);
  const H = rcBlock(B, P, Fx, n, { fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 3.9, g1: 4.4, base: 0.3, g1m: P.lod >= 1 && n >= 2 ? T.g1 : null, wc: C(L.wc), g1c: mix(C(L.wc), W1, 0.3), pc: L.pc, roof: L.rf && n <= 5 ? L.rf : 'flat', rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: 0.35, oh: 0.6, par: 1.0, onpad: 1, rt: o.rt });
  if (L.fins && P.lod >= 2 && n <= 12) for (const e2 of Fx.edges) { if (e2.L < 10) continue; const nf = Math.min(7, Math.floor(e2.L / 4)); for (let i = 1; i < nf; i++) { const q = onE(e2, e2.L * i / nf, 0.3); B.obox('c', q[0], q[1], Math.atan2(e2.nz, e2.nx), 0.5, 0.3, 4.7, H, C(L.fins)); } }
  return H;
}
function clockTower(B, P, e, at, y0, H, L, w = 6) {   // 辺 e の at に 時計塔（地面から）
  const q0 = onE(e, at - w / 2, -0.5), q1 = onE(e, at + w / 2, w - 0.5), rt = [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])], Ft = rfoot(rt), d = fmDims(L.fm);
  B.facade(L.fm, Ft, y0, H, { bw: 3.6, fh: 3.9, tb: d.tb, tf: d.tf, vy: y0, c: C(L.wc) });
  if (P.lod >= 1) for (const e2 of Ft.edges) signE(B, e2, 0.9, e2.L - 0.9, H - w + 1.2, H - 0.8, SG.clock, 0.1);
  return B.roof({ t: 'pyramid', r: rt, y: H, p: 0.9, oh: 0.4, m: P.lod >= 1 ? (L.rm || T.kane) : 'c', c: L.rc ? C(L.rc) : C('#6a6f74'), su: 3, th: 0.15 });
}
A.arch('p_daigaku', {
  looks: UL,
  far(L, P) { const n = Math.max(1, P.f), d = fmDims(L.fm), cp = !!P.ko.campus; return { H: cp ? 7 : 0.3 + 4.4 + (n - 1) * 3.9, base: 0.3, wall: L.fm, bw: 3.6, fh: 3.9, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: null, rc: [0.62, 0.62, 0.6], rt: 'flat', ins: cp ? 6 : 3, top: cp ? T.shiba : null, ct: cp ? W1 : [0.62, 0.62, 0.6] }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), ko = P.ko, Y = 0.06, nv0 = B.nv;
    pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.55, 0.36], { su: 10 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 2)), fr = frm(r0, P.front), W = fr.W, D = fr.D, uc = W / 2;
    if (ko.campus && W > 50 && D > 50) {
      // キャンパス：中庭のまわりに 棟
      const bd = 17, gap = 8, pw = 10, outs = [];
      flatU(B, fr, lod >= 1 ? T.ishi : 'c', uc - pw / 2, 0, uc + pw / 2, D - bd - 2, Y + 0.03, lod >= 1 ? '#d8d3c8' : '#c8c3b8', 4);
      const blocks = [[uc - Math.min(60, W * 0.4) / 2, D - bd, uc + Math.min(60, W * 0.4) / 2, D, n + 1, 'main'], [3, D * 0.3, 3 + bd, D - bd - gap, n, 'L'], [W - 3 - bd, D * 0.3, W - 3, D - bd - gap, n - 1, 'R'],
        [3, 4, Math.min(uc - pw, 3 + Math.min(45, W * 0.32)), 4 + bd, Math.max(1, n - 1), 'FL'], [Math.max(uc + pw, W - 3 - Math.min(45, W * 0.32)), 4, W - 3, 4 + bd, n, 'FR']];
      let k = 0;
      for (const [u0, v0, u1, v1, nn, tag] of blocks) {
        if (u1 - u0 < 10 || v1 - v0 < 10) continue; if (lod < 2 && k > (lod >= 1 ? 2 : 1)) break; if (B.nv - nv0 > BUD[lod >= 2 ? 2 : lod] * 0.85) break;
        const r = fr.R(u0, v0, u1, v1), H = uniBlock(B, P, r, Math.max(1, Math.min(nn, 20)), L, k % 2 === 1, { rt: lod >= 2 && k < 2 });
        B.top = Math.max(B.top, H); outs.push(A.rin(r, -2)); k++;
        if (tag === 'main' && L.tower && lod >= 1) { const e = rfoot(r).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) B.top = Math.max(B.top, clockTower(B, P, e, e.L / 2, 0.3, H + 10, L, 7)); }
      }
      // 並木と 中庭の木
      if (lod >= 1) { const nt = lod >= 2 ? Math.min(14, Math.floor((D - bd) / 9)) : 1; for (let i = 0; i < nt; i++) for (const sg of [-1, 1]) { const q = fr.p(uc + sg * (pw / 2 + 2), 5 + i * (D - bd - 10) / Math.max(1, nt - 1)); treeB(B, q[0], q[1], Y, 9, 3.2, '#7a9240', R, lod); } }
      outs.push(fr.R(uc - pw / 2 - 3, 0, uc + pw / 2 + 3, D));
      grove(B, P, F.rects.map(q => A.rin(q, 1)), outs, { sp: 9, k: 0.8, h: [8, 15], y: Y, n: 0.15, max: 30, vmax: left(B, nv0, lod) });
      return;
    }
    // 1 棟：芝生と 木・自転車おき場
    const Fb = A.inset(F, SB(P, n >= 8 ? 2 : 3)), H = rcBlock(B, P, Fb, n, { fm: L.fm, tb: fmDims(L.fm).tb, tf: fmDims(L.fm).tf, bw: 3.6, fh: 3.9, g1: 4.4, base: 0.3, g1m: lod >= 1 ? T.g1 : null, wc: C(L.wc), g1c: mix(C(L.wc), W1, 0.3), pc: L.pc, roof: L.rf && n <= 5 ? L.rf : 'flat', rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: 0.35, oh: 0.6, par: 1.0, onpad: 1 });
    B.top = Math.max(B.top, H);
    if (lod < 1) return;
    const e = A.frontEdge(Fb, P.front);
    signE(B, e, e.L / 2 - 2, e.L / 2 + 2, 0.3, 2.9, SG.door, 0.08); canopy(B, e, e.L / 2, Math.min(e.L - 1, 8), 3, 4.0, '#e6e4de', { lod, th: 0.3 });
    if ((ko.tower || L.tower) && e.L > 14 && n <= 8) B.top = Math.max(B.top, clockTower(B, P, e, e.L / 2, 0.3, H + 9, L, 6));
    if (ko.lab && lod >= 2) { const rr = mainRect(Fb, P.front); for (let i = 0; i < 4; i++) { const x = lerp(rr[0] + 3, rr[2] - 3, (i + 0.5) / 4), z = rr[1] + 3; B.cyl('c', x, z, 0.5, H, H + 4, 6, [0.75, 0.76, 0.76]); } }
    bikeShed(B, P, e, 1, Math.min(14, e.L * 0.3), 2.6, 0.06);
    yardTrees(B, P, F, Fb, 5, R);
  }
});
A.kinds({ univ: ['p_daigaku', { campus: 1 }], jc: ['p_daigaku', { campus: 1 }], ulab: ['p_daigaku', { lab: 1 }], ukan: 'p_daigaku', uhq: ['p_daigaku', { tower: 1 }], ulib: 'p_daigaku', umus: ['p_daigaku', { looks: [UL[3], UL[0], UL[2], UL[4]] }], uhall: 'p_daigaku', uunion: 'p_daigaku' });

/* ================= 学習塾・予備校・英会話・音楽学校・調理師学校・専門学校 ================= */
const JKL = [
  { n: '白いタイル・袖看板', fm: T.tile, wc: '#f4f3ef', sg: [SG.navy, SG.orange] },
  { n: 'ガラスのビル', fm: T.curtain, wc: W1, sg: [SG.teal, SG.blank] },
  { n: '茶色のタイル', fm: T.tile, wc: '#a68770', pc: '#86695a', sg: [SG.green, SG.maroon] },
  { n: 'グレーのパネル', fm: T.alc, wc: '#c9cbcb', sg: [SG.orange, SG.navy] },
  { n: '白い外壁・色の帯', fm: T.ribbon, wc: '#f5f5f2', sg: [SG.maroon, SG.teal], band: 1 }
];
A.arch('p_juku', {
  looks: JKL,
  far(L, P) { const n = Math.max(1, P.f), d = fmDims(L.fm); return { H: 0.2 + 4.2 + (n - 1) * 3.5, base: 0.2, wall: L.fm, bw: 3.2, fh: 3.5, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: null, rc: [0.6, 0.61, 0.6], rt: 'flat', ins: 0.5 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), d = fmDims(L.fm), F = A.inset(F0, SB(P, 0.5));
    const H = rcBlock(B, P, F, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.2, fh: 3.5, g1: 4.2, g1m: lod >= 1 ? T.g1s : null, wc: C(L.wc), g1c: mix(C(L.wc), W1, 0.3), pc: L.pc, roof: 'flat', par: 0.9 });
    B.top = Math.max(B.top, H);
    if (lod < 1) return;
    const e = A.frontEdge(F, P.front);
    signE(B, e, e.L * 0.5 - 1.2, e.L * 0.5 + 1.2, 0.2, 2.7, SG.door, 0.09);
    if (L.band && n >= 2) for (let j = 1; j < Math.min(n, 4); j++) signE(B, e, 0.3, e.L - 0.3, 4.2 + (j - 1) * 3.5 + 0.2, 4.2 + (j - 1) * 3.5 + 0.75, L.sg[j % 2], 0.1);
    else if (n >= 2) signE(B, e, 0.6, e.L - 0.6, 4.4, 5.1, L.sg[1], 0.1);
    // 袖看板（たて長・道に 直角）
    if (n >= 2 && lod >= 1) { const q = onE(e, Math.min(e.L - 0.4, e.L * 0.92), 0.7), ang = Math.atan2(e.nz, e.nx), hh = Math.min(H - 1, 3.5 * Math.min(n, 5)); B.obox('c', q[0], q[1], ang, 1.2, 0.3, H - hh, H - 0.4, [0.3, 0.3, 0.32]);
      if (lod >= 2) { const ca = Math.cos(ang), sa = Math.sin(ang); for (const sd of [-1, 1]) { const ex = { ax: q[0] - ca * 0.6 - sa * sd * 0.16, az: q[1] - sa * 0.6 + ca * sd * 0.16, bx: q[0] + ca * 0.6 - sa * sd * 0.16, bz: q[1] + sa * 0.6 + ca * sd * 0.16, L: 1.2, nx: -sa * sd, nz: ca * sd }; if (sd < 0) { [ex.ax, ex.bx] = [ex.bx, ex.ax]; [ex.az, ex.bz] = [ex.bz, ex.az]; }
        signE(B, ex, 0.05, 1.15, H - hh + 0.1, H - 0.5, L.sg[0], 0.02); } } }
    if (lod >= 2 && n >= 2) for (const e2 of F.edges) if (e2 !== e && e2.L > 5) { const q2 = onE(e2, e2.L * (0.3 + 0.4 * R()), 0.35); B.acUnit(q2[0], q2[1], 4.4 + 3.5 * Math.floor(R() * (n - 1)), Math.atan2(e2.nz, e2.nx) + PI / 2); }
  }
});
A.kinds({ cram: 'p_juku', prep: 'p_juku', eikaiwa: 'p_juku', music: 'p_juku', cook: 'p_juku', voc: 'p_juku' });

/* ================= 交番 ================= */
const KBL = [
  { n: '白いタイル・切妻屋根', fm: T.tile, wc: '#f4f3ef', roof: 'gable', rm: T.kawara, rc: W1 },
  { n: 'レンガ調・とんがり屋根', fm: T.brick, wc: W1, roof: 'pyramid', rm: T.kane, rc: '#4f5458' },
  { n: '打ちはなし・平屋根', fm: T.conc, wc: W1, roof: 'flat' },
  { n: 'ガラスの箱', fm: T.curtain, wc: W1, roof: 'flat' },
  { n: '和風・瓦屋根', fm: T.siding, wc: '#efe6d2', roof: 'iri', rm: T.kawara, rc: W1 }
];
A.arch('p_koban', {
  looks: KBL,
  far(L, P) { const n = Math.max(1, P.f); return { H: 0.3 + 3.4 * n, base: 0.3, wall: L.fm, bw: 3, fh: 3.4, tb: 4, tf: fmDims(L.fm).tf, wc: C(L.wc), roof: L.roof !== 'flat' ? L.rm : null, rc: L.rc ? C(L.rc) : [0.6, 0.6, 0.6], rt: L.roof === 'flat' ? 'flat' : 'hip', p: 0.5, ins: 2 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f);
    pad(B, P, F0, 0.05, lod >= 1 ? T.ishi : 'c', lod >= 1 ? '#cfcac0' : [0.72, 0.71, 0.68], { su: 4 });
    const r0 = mainRect(F0, P.front), fr = frm(r0, P.front), W = fr.W, bw = Math.min(W - 2, 7), bd = Math.min(fr.D - 2, 6);
    const rb = fr.R(W / 2 - bw / 2, 1.5, W / 2 + bw / 2, 1.5 + bd), Fb = rfoot(rb);
    const H = rcBlock(B, P, Fb, n, { fm: L.fm, tb: 4, tf: fmDims(L.fm).tf, bw: 3, fh: 3.2, g1: 3.4, base: 0.3, wc: C(L.wc), roof: L.roof, rm: L.rm, rc: L.rc ? C(L.rc) : W1, p: L.roof === 'pyramid' ? 0.7 : 0.5, oh: 0.6, par: 0.6, onpad: 1, rt: false });
    B.top = Math.max(B.top, H + 3);
    if (lod < 1) return;
    const e = Fb.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9) || Fb.edges[0];
    signE(B, e, e.L / 2 - 1.3, e.L / 2 + 1.3, 0.3, 2.6, SG.door, 0.08); canopy(B, e, e.L / 2, e.L - 0.5, 1.6, 2.9, '#e9e8e4', { th: 0.2, lod });
    signE(B, e, e.L / 2 - 0.35, e.L / 2 + 0.35, 3.15, 3.85, SG.lamp, 0.12); const q = onE(e, e.L / 2, 0.35); B.box('c', q[0] - 0.22, q[1] - 0.22, q[0] + 0.22, q[1] + 0.22, 3.2, 3.55, [0.86, 0.12, 0.1]);
    if (lod >= 2) { signE(B, e, 0.3, 1.3, 0.8, 2.0, SG.poster, 0.1); const q2 = onE(e, e.L + 1.2, 1.2); B.box('c', q2[0] - 0.1, q2[1] - 0.1, q2[0] + 0.1, q2[1] + 0.1, 0.05, 3.8, [0.7, 0.7, 0.7]); }
  }
});
A.kinds({ koban: 'p_koban' });

/* ================= 消防署 ================= */
const FL = [
  { n: '白タイル・赤いシャッター', fm: T.tile, wc: '#f4f3ef', tc: '#e9e7e2' },
  { n: 'ベージュのタイル', fm: T.tile, wc: '#e6d4b6', tc: '#dfd1b8' },
  { n: '打ちはなし', fm: T.conc, wc: W1, tc: '#cfcdc7' },
  { n: 'レンガ調', fm: T.brick, wc: W1, tc: '#b07a66' },
  { n: 'ガラスと白い壁', fm: T.ribbon, wc: '#f5f5f2', tc: '#ebebe8' }
];
function fireTruck(B, x, z, y, ang) { const ca = Math.cos(ang), sa = Math.sin(ang), red = [0.78, 0.14, 0.12];
  B.obox('c', x, z, ang, 7.6, 2.3, y + 0.5, y + 2.6, red); B.obox('c', x + ca * 3.2, z + sa * 3.2, ang, 1.4, 2.3, y + 1.6, y + 2.9, [0.25, 0.3, 0.35]); B.obox('c', x - ca * 0.6, z - sa * 0.6, ang, 5.6, 0.9, y + 2.6, y + 2.85, [0.8, 0.8, 0.82]); B.obox('c', x, z, ang, 6.8, 2.0, y, y + 0.5, [0.18, 0.18, 0.18]); }
A.arch('p_shobo', {
  looks: FL,
  far(L, P) { const n = Math.max(1, P.f), d = fmDims(L.fm); return { H: 0.2 + 5.5 + (n - 1) * 3.6, base: 0.2, wall: L.fm, bw: 3.6, fh: 3.6, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: null, rc: [0.62, 0.62, 0.6], rt: 'flat', ins: 1 }; },
  build(B, L, P) {
    const F0 = P.F, lod = P.lod, R = P.rng, n = Math.max(1, P.f), d = fmDims(L.fm);
    const sp = F0.n >= 3 ? splitFront(F0, P.front, 2) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) : F0, F = A.inset(Fm, SB(P, 0.6));
    const H = rcBlock(B, P, F, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 3.6, g1: 5.5, g1m: lod >= 1 ? T.g1 : null, wc: C(L.wc), g1c: C(L.tc), roof: 'flat', par: 0.9 });
    B.top = Math.max(B.top, H);
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore); for (const r of Ff.rects) B.flat(lod >= 1 ? T.asph : 'c', A.rin(r, 0.3), 0.07, lod >= 1 ? [0.9, 0.9, 0.9] : [0.45, 0.46, 0.47], { su: 8 }); if (lod >= 1) B.plinth(Ff, P.yb, 0.07); }
    if (lod < 1) return;
    // 車庫のシャッター（赤）
    const e = A.frontEdge(F, P.front), nb = cl(Math.floor((e.L - 6) / 4.8), 1, 6), x0 = e.L - nb * 4.8 - 1;
    for (let i = 0; i < nb; i++) { signE(B, e, x0 + i * 4.8, x0 + i * 4.8 + 4.2, 0.2, 4.7, SG.shut, 0.08); if (lod >= 2 && i < 2 && sp.fore.length) { const q = onE(e, x0 + i * 4.8 + 2.1, 5.2); fireTruck(B, q[0], q[1], 0.07, Math.atan2(e.nz, e.nx)); } }
    signE(B, e, 1, 3, 0.2, 2.6, SG.door, 0.08);
    // 訓練塔・望楼（うしろの かど）
    const rr = mainRect(F, P.front), bk = rfoot(rr).edges.find(q => q.nx * e.nx + q.nz * e.nz < -0.9) || e, q = onE(bk, 2.5, -2.5), ht = Math.max(H + 8, 22);
    const rt = [q[0] - 1.8, q[1] - 1.8, q[0] + 1.8, q[1] + 1.8];
    B.facade(T.alc, rfoot(rt), H - 0.5, ht, { bw: 3.6, fh: 3.6, tb: 4, tf: 4, vy: H, c: C(L.wc) }); B.box('c', rt[0] - 0.5, rt[1] - 0.5, rt[2] + 0.5, rt[3] + 0.5, ht, ht + 0.4, [0.7, 0.7, 0.68]);
    if (lod >= 2) { B.rail(T.rail, rfoot(A.rin(rt, -0.5)).edges[0], ht + 0.4, 1.0, 0, [0.85, 0.85, 0.82]); trunk3(B, q[0], q[1], ht + 0.4, ht + 8, 0.12, [0.8, 0.8, 0.78]); }
    B.top = Math.max(B.top, ht + 8);
  }
});
A.kinds({ firest: 'p_shobo' });

/* ---------- 窓のない 大きなパネルの壁（ホール・博物館・映画館など）---------- */
T.panelw = TX('f:panelw', 128, 128, (g, w, h, R) => { PT.wallMat(g, 0, 0, w, h, { t: 'panel', c: '#e6e3dc', pw: 32, ph: 32, sc: w / 128, n: 0.03, dirt: 0.1 }, R); });
const pw = { bw: 4, fh: 4, tb: 1, tf: 1 };   // T.panelw：4 m ごと
// 窓のない箱（形 F・y0〜y1・色 c）
function blankBox(B, P, F, y0, y1, c, o = {}) { if (!o.onpad && (P.lod >= 1 || P.yb < -0.5)) B.plinth(F, P.yb, y0 + 0.01);
  B.facade(P.lod >= 1 ? T.panelw : 'c', F, y0, y1, { bw: 4, fh: 4, tb: 1, tf: 1, vy: y0, c: C(c), ao: 0.86 });
  if (o.top !== false) { B.cap(P.lod >= 1 ? T.flat : 'c', F, y1, P.lod >= 1 ? W1 : [0.62, 0.62, 0.6], { su: 8 }); if (P.lod >= 2 && o.par !== 0) B.parapet(F, y1, o.par || 0.8, 0.25, mul(C(c), 0.92)); else if (P.lod >= 1 && o.par !== 0) for (const e of F.edges) B.wallE('c', e, y1, y1 + (o.par || 0.8), mul(C(c), 0.92)); }
  return y1; }
// 長方形を 枠の u・v で 切る
const cutV = (fr, r, v0, v1) => { const a = fr.R(0, v0, fr.W, v1); return [Math.max(a[0], r[0]), Math.max(a[1], r[1]), Math.min(a[2], r[2]), Math.min(a[3], r[3])]; };

/* ================= 体育館・屋内プール・スケートリンク・スポーツクラブ ================= */
const GYL = [
  { n: '銀色のかまぼこ屋根', rt: 'barrel', rc: '#b7bcc0', wc: '#ecebe6', fm: T.gym, lf: T.tile },
  { n: '青い切妻屋根', rt: 'gable', rc: '#4f6d8a', wc: '#efece6', fm: T.gym, lf: T.ribbon },
  { n: '緑の屋根・白い壁', rt: 'hip', rc: '#5f7f62', wc: '#f4f3ef', fm: T.gym, lf: T.siding },
  { n: '打ちはなし・平屋根', rt: 'flat', wc: W1, fm: T.conc, lf: T.conc },
  { n: 'ガラスと木', rt: 'barrel', rc: '#8c6a4c', wc: '#d9b993', fm: T.louver, lf: T.curtain },
  { n: '茶色のタイル・ドーム', rt: 'dome', rc: '#9aa0a5', wc: '#a98a70', fm: T.tile, lf: T.tile }
];
A.arch('p_gym', {
  looks: GYL,
  far(L, P) { const hh = Math.max(10, Math.max(1, P.f) * 4.2); return { H: hh, base: 0.2, wall: L.fm, bw: 4.5, fh: hh, tb: 4, tf: 1, wc: C(L.wc), roof: L.rt === 'flat' ? null : T.kane, rc: L.rc ? C(L.rc) : [0.62, 0.62, 0.6], rt: L.rt === 'flat' ? 'flat' : 'gable', p: 0.25, ins: 2 }; },
  build(B, L, P) {
    const F0 = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), ko = P.ko, Y = 0.06;
    const city = ko.t === 'club';
    if (city) {   // スポーツクラブ：まちの ガラスのビル
      const F = A.inset(F0, SB(P, 0.5)), H = rcBlock(B, P, F, n, { fm: T.curtain, tb: 4, tf: 4, bw: 3.6, fh: 4.2, g1: 4.5, g1m: T.g1s, wc: C(L.wc === W1 ? '#ffffff' : '#f2f2ef'), roof: 'flat', par: 1.0 });
      B.top = Math.max(B.top, H); if (lod >= 1) { const e = A.frontEdge(F, P.front); signE(B, e, 0.5, e.L - 0.5, 4.6, 5.6, SG.teal, 0.12); signE(B, e, e.L / 2 - 1.5, e.L / 2 + 1.5, 0.2, 2.7, SG.door, 0.08); }
      return;
    }
    pad(B, P, F0, Y, lod >= 1 ? T.asph : 'c', lod >= 1 ? [0.92, 0.92, 0.92] : [0.45, 0.46, 0.47], { su: 8 });
    const r0 = A.rin(mainRect(F0, P.front), SB(P, 2)), fr = frm(r0, P.front), W = fr.W, D = fr.D;
    const lob = D > 30 ? cl(D * 0.22, 8, 14) : 0, park = D > 45 ? cl(D * 0.2, 10, 20) : 0;
    const rh = fr.R(1, park + lob, W - 1, D - 1), hh = Math.max(10, n * 4.2), wc = C(L.wc);
    const glass = ko.t === 'pool' || ko.t === 'skate';
    const top = gymHall(B, P, rh, Y, hh, L.rt === 'dome' ? 'flat' : L.rt, L.rc || '#a8aeb2', wc, { onpad: 1, fm: glass && L.fm === T.gym ? T.curtain : L.fm });
    B.top = Math.max(B.top, top);
    if (L.rt === 'dome' && lod >= 1) B.top = Math.max(B.top, B.roof({ t: 'dome', r: A.rin(rh, 1), y: hh + Y + 0.7, p: 0.35, oh: 0, m: T.kane, c: C(L.rc), su: 4, n: lod >= 2 ? 16 : 8, rings: lod >= 2 ? 4 : 2 }));
    if (lob) { const rl = fr.R(W * 0.2, park, W * 0.8, park + lob + 1), Fl = rfoot(rl); B.top = Math.max(B.top, rcBlock(B, P, Fl, 2, { fm: L.lf, tb: 4, tf: fmDims(L.lf).tf, bw: 3.6, fh: 3.8, g1: 4.4, g1m: T.g1, wc: L.lf === T.curtain ? W1 : wc, roof: 'flat', par: 0.8, onpad: 1, rt: false }));
      if (lod >= 1) { const e = Fl.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) { signE(B, e, e.L / 2 - 2, e.L / 2 + 2, 0.2, 2.8, SG.door, 0.08); canopy(B, e, e.L / 2, Math.min(e.L, 10), 3, 4.0, '#e8e6e0', { lod, th: 0.35 }); } } }
    if (park) for (const r of [fr.R(1, 1, W - 1, park - 1)]) parking(B, P, r, Y + 0.02, R, { max: 10 });
    if (lod >= 2) yardTrees(B, P, F0, rfoot(A.rin(rh, -2)), 4, R, { out: [fr.R(0, 0, W, park)] });
  }
});
A.kinds({ pgym: 'p_gym', ugym: 'p_gym', sportsclub: ['p_gym', { t: 'club' }], pool: ['p_gym', { t: 'pool' }], skate: ['p_gym', { t: 'skate' }] });

/* ================= 市民会館・コンサートホール・劇場・国立劇場・展示場 ================= */
const HAL = [
  { n: '打ちはなし・大屋根', fm: T.conc, wc: W1, bc: '#cfcdc7', lob: T.curtain, over: 1 },
  { n: '石張り・ガラスのロビー', fm: T.stone, wc: '#ddd6c9', bc: '#d8d1c4', lob: T.curtain },
  { n: '茶色のタイル', fm: T.tile, wc: '#a5866d', bc: '#a88d78', lob: T.tile },
  { n: '白いパネル・曲面屋根', fm: T.alc, wc: '#f2f2ee', bc: '#eeeeea', lob: T.curtain, barrel: 1 },
  { n: 'レンガ色', fm: T.brick, wc: W1, bc: '#9c6a58', lob: T.brick },
  { n: 'ガラスの箱', fm: T.curtain, wc: W1, bc: '#8f9aa3', lob: T.curtain }
];
A.arch('p_hall', {
  looks: HAL,
  far(L, P) { const hh = P.ko.t === 'conv' ? 15 : 18; return { H: hh, base: 0.2, wall: T.panelw, bw: 4, fh: 4, tb: 1, tf: 1, wc: C(L.bc), roof: null, rc: [0.62, 0.62, 0.6], rt: 'flat', ins: 3 }; },
  build(B, L, P) {
    const F0 = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), ko = P.ko, Y = 0.06;
    pad(B, P, F0, Y, lod >= 1 ? T.ishi : 'c', lod >= 1 ? '#d6d0c4' : [0.75, 0.74, 0.7], { su: 4 });
    const r0 = A.rin(mainRect(F0, P.front), SB(P, 2)), fr = frm(r0, P.front), W = fr.W, D = fr.D, conv = ko.t === 'conv';
    const fore = D > 40 ? cl(D * 0.15, 6, 25) : 2;
    if (conv) {   // 展示場：大きな ホールが ならぶ
      const nh = lod >= 1 ? cl(Math.round(W / 70), 1, 4) : 1, hw = (W - 2) / nh, hh = 15;
      for (let i = 0; i < nh; i++) { const rh = fr.R(1 + i * hw + 1.5, fore + 14, 1 + (i + 1) * hw - 1.5, D - 1), Fh = rfoot(rh);
        blankBox(B, P, Fh, Y, Y + hh, L.bc, { onpad: 1, top: lod < 1 }); if (lod >= 1) B.top = Math.max(B.top, B.roofs(Fh, { t: lod >= 2 ? (L.barrel || i % 2 ? 'barrel' : 'saw') : 'gable', y: Y + hh, p: lod >= 2 ? 0.12 : 0.08, oh: 0.8, m: T.kane, c: C('#b4b9bd'), su: 3, mg: T.panelw, cg: C(L.bc), gsu: 4, gsv: 4, k: T.curtain, tw: 12, hmax: 5, th: lod >= 2 ? 0.25 : 0, n: 6 })); }
      const re = fr.R(W * 0.25, fore, W * 0.75, fore + 14); B.facade(lod >= 1 ? T.curtain : 'c', rfoot(re), Y, Y + 12, { bw: 3, fh: 4, tb: 4, tf: 4, vy: Y, c: lod >= 1 ? W1 : [0.4, 0.47, 0.53] }); B.cap(lod >= 1 ? T.flat : 'c', rfoot(re), Y + 12, lod >= 1 ? W1 : [0.62, 0.62, 0.6], { su: 8 });
      if (lod >= 2) { const e = rfoot(re).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) B.ledge(e, Y + 12, Y + 12.6, 6, C('#e9e9e6')); }
      if (fore > 8) parking(B, P, fr.R(1, 1, W * 0.24, fore - 1), Y + 0.02, R, { max: 10 }), parking(B, P, fr.R(W * 0.76, 1, W - 1, fore - 1), Y + 0.02, R, { max: 10 });
      return;
    }
    // ロビー（前）・客席（まん中）・舞台の塔（うしろ）
    const lobD = cl(D * 0.25, 8, 22), audD = D - fore - lobD - 1, flyD = cl(audD * 0.3, 8, 18), aw = cl(W * 0.75, 24, 90);
    const rl = fr.R(W / 2 - aw / 2 - 2, fore, W / 2 + aw / 2 + 2, fore + lobD + 0.5), ra = fr.R(W / 2 - aw / 2, fore + lobD, W / 2 + aw / 2, D - 1 - flyD + 0.5), rf = fr.R(W / 2 - aw * 0.33, D - 1 - flyD, W / 2 + aw * 0.33, D - 1);
    const nl = Math.min(n, 4), hl = 0.2 + 4.8 + (nl - 1) * 4.2, ha = Math.max(hl + 3, 18), hf = ha + 8;
    blankBox(B, P, rfoot(ra), Y, Y + ha, L.bc, { onpad: 1, top: !L.barrel });
    if (L.barrel && lod >= 1) B.roof({ t: 'barrel', r: ra, y: Y + ha, p: 0.12, oh: 0.6, m: T.kane, c: C('#c9ccce'), su: 3, mg: T.panelw, cg: C(L.bc), gsu: 4, gsv: 4, th: 0.2 });
    blankBox(B, P, rfoot(rf), Y, Y + hf, mul(C(L.bc), 0.96), { onpad: 1 });
    const Fl = rfoot(rl), Hl = rcBlock(B, P, Fl, nl, { fm: L.lob, tb: 4, tf: fmDims(L.lob).tf, bw: 3.6, fh: 4.2, g1: 4.8, g1m: T.g1, wc: L.lob === T.curtain ? W1 : C(L.wc), roof: 'flat', par: 0.9, onpad: 1, rt: false });
    B.top = Math.max(B.top, Y + hf, Hl);
    if (lod < 1) return;
    const e = Fl.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9);
    if (e) { signE(B, e, e.L / 2 - 3, e.L / 2 + 3, 0.2, 2.9, SG.door, 0.08); if (L.over && lod >= 1) B.ledge(e, Hl - 0.5, Hl + 0.3, 5, C('#cfcdc7')); else canopy(B, e, e.L / 2, Math.min(e.L, 16), 4, 4.6, '#e6e4de', { posts: 1, lod, th: 0.4, y0: Y }); }
    if (fore > 6 && lod >= 2) { for (const sg of [-1, 1]) for (let i = 0; i < 2; i++) { const q = fr.p(W / 2 + sg * (aw * 0.3 + i * 7), fore * 0.5); treeB(B, q[0], q[1], Y, 8, 3, A.pick(R, TCOL), R, lod); } }
  }
});
A.kinds({ civic: 'p_hall', hall: 'p_hall', theater: 'p_hall', nattheater: 'p_hall', convention: ['p_hall', { t: 'conv' }] });

/* ================= 博物館・美術館・科学館・図書館・水族館（国立も）================= */
const MSL = [
  { n: '石張りの箱', bc: '#ddd6c9', fm: T.stone, wc: '#ddd6c9', cols: 1 },
  { n: '打ちはなし', bc: '#cfcdc7', fm: T.conc, wc: W1 },
  { n: '白い曲面', bc: '#f2f2ee', fm: T.alc, wc: '#f4f4f0', barrel: 1 },
  { n: 'れんが色', bc: '#9e6b58', fm: T.brick, wc: W1 },
  { n: 'ガラスと木のルーバー', bc: '#d9b993', fm: T.louver, wc: '#d9b993', glass: 1 },
  { n: '和風の大屋根', bc: '#e8e3d8', fm: T.tera2, wc: W1, jr: 1 }
];
A.arch('p_museum', {
  looks: MSL,
  far(L, P) { const hh = 0.3 + Math.max(1, P.f) * 5; return { H: hh, base: 0.3, wall: T.panelw, bw: 4, fh: 4, tb: 1, tf: 1, wc: C(L.bc), roof: L.jr ? T.kawara : null, rc: [0.6, 0.6, 0.6], rt: L.jr ? 'hip' : 'flat', ins: 4, top: L.jr ? T.kawara : null, ct: L.jr ? W1 : C(L.bc) }; },
  build(B, L, P) {
    const F0 = P.F, R = P.rng, lod = P.lod, n = Math.max(1, Math.min(P.f, 8)), ko = P.ko, Y = 0.06;
    pad(B, P, F0, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.55, 0.36], { su: 10 });
    const r0 = A.rin(mainRect(F0, P.front), SB(P, 2)), fr = frm(r0, P.front), W = fr.W, D = fr.D;
    const fore = D > 30 ? cl(D * 0.25, 6, 30) : 2, rb = fr.R(W > 30 ? 3 : 1, fore, W - (W > 30 ? 3 : 1), D - (D > 30 ? 3 : 1)), Fb = rfoot(rb);
    const H = Y + 0.3 + n * (ko.lib ? 4.2 : 5);
    if (ko.lib || L.glass) rcBlock(B, P, Fb, n, { fm: L.fm, tb: 4, tf: fmDims(L.fm).tf, bw: 3.6, fh: ko.lib ? 4.2 : 5, g1: ko.lib ? 4.2 : 5, base: Y + 0.3, g1m: T.g1, wc: C(L.wc), roof: L.jr ? 'hip' : L.barrel ? 'flat' : 'flat', rm: T.kawara, par: 0.8, onpad: 1 });
    else blankBox(B, P, Fb, Y + 0.3, H, L.bc, { onpad: 1, top: !L.jr && !L.barrel });
    if (L.jr) B.top = Math.max(B.top, jroof(B, { r: rb, y: H, t: 'yose', oh: 2.2, p: 0.45, cv: 0.35, up: 0.4, m: T.kawara, c: W1, su: 3.2, th: 0.3, fc: '#4a4d51', rc: '#55595e', uc: [0.4, 0.36, 0.32], rh: 0.6, lod, nd: 3, ns: 6 }));
    else if (L.barrel && lod >= 1) B.top = Math.max(B.top, B.roof({ t: 'barrel', r: rb, y: H, p: 0.14, oh: 1.0, m: T.kane, c: C('#d9dcde'), su: 3, mg: T.panelw, cg: C(L.bc), gsu: 4, gsv: 4, th: 0.25 }));
    B.top = Math.max(B.top, H + 1);
    // 科学館：ドーム・水族館：波の屋根と 池
    if (ko.dome && lod >= 1) { const c = [(rb[0] + rb[2]) / 2, (rb[1] + rb[3]) / 2], rr2 = Math.min(10, (rb[2] - rb[0]) * 0.25, (rb[3] - rb[1]) * 0.3); B.cyl('c', c[0], c[1], rr2, H, H + 2.5, lod >= 2 ? 16 : 8, C(L.bc), { notop: true }); B.dome('c', c[0], c[1], rr2, rr2, H + 2.5, rr2 * 0.9, lod >= 2 ? 16 : 8, [0.92, 0.93, 0.94], { rings: lod >= 2 ? 4 : 2 }); B.top = Math.max(B.top, H + 2.5 + rr2); }
    if (ko.aqua && lod >= 1) { const rp = fr.R(2, 2, W * 0.45, Math.max(4, fore - 2)); if (rp[2] - rp[0] > 6 && rp[3] - rp[1] > 4) B.flat(T.mizu, rp, Y + 0.05, [0.6, 0.85, 0.95], { su: 8 }); }
    if (lod < 1) return;
    // 入口：ガラス・列柱
    const e = Fb.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9) || A.frontEdge(Fb, P.front), mid = e.L / 2, ew = Math.min(e.L * 0.4, 18);
    B.wallE(T.curtain, e, Y + 0.3, Y + 0.3 + Math.min(9, H - 1), W1, { from: mid - ew / 2, to: mid + ew / 2, off: 0.08, uv: [0, ew / 3.6, 0, Math.min(9, H - 1) / 4.6] });
    signE(B, e, mid - 2, mid + 2, Y + 0.3, Y + 3.1, SG.door, 0.12);
    if (L.cols && lod >= 2) { B.ledge(e, Math.min(H - 0.6, 9.5), Math.min(H, 10.2), 4, C(L.bc), { from: mid - ew / 2 - 2, to: mid + ew / 2 + 2 }); for (let i = 0; i <= 5; i++) { const q = onE(e, mid - ew / 2 - 1 + (ew + 2) * i / 5, 3.4); B.cyl('c', q[0], q[1], 0.45, Y + 0.3, Math.min(H - 0.6, 9.5), 8, C(L.bc), { notop: true }); } }
    else canopy(B, e, mid, ew, 3, Y + 4.4, '#e6e4de', { lod, th: 0.35 });
    if (fore > 8 && lod >= 2) { flatU(B, fr, T.ishi, W / 2 - 4, 0, W / 2 + 4, fore, Y + 0.03, '#d8d2c6', 4); const q = fr.p(W / 2 + 9, fore * 0.5); B.box('c', q[0] - 1, q[1] - 1, q[0] + 1, q[1] + 1, Y, Y + 0.8, [0.6, 0.6, 0.58]); B.obox('c', q[0], q[1], 0.6, 1.2, 0.5, Y + 0.8, Y + 3.6, [0.42, 0.36, 0.26]);
      yardTrees(B, P, F0, rfoot(A.rin(rb, -2)), 6, R, { out: [fr.R(W / 2 - 6, 0, W / 2 + 6, fore)] }); }
  }
});
A.kinds({ museum: 'p_museum', artmuseum: 'p_museum', natmus: 'p_museum', natart: 'p_museum', science: ['p_museum', { dome: 1 }], publib: ['p_museum', { lib: 1 }], natlib: ['p_museum', { lib: 1 }], aquarium: ['p_museum', { aqua: 1, looks: [MSL[2], MSL[4], MSL[1], MSL[0], MSL[3]] }] });

/* ================= 教会・結婚式場 ================= */
const CHL = [
  { n: '白い壁・とんがり屋根', fm: T.stone, wc: '#f5f4f0', rc: '#5d6268', rm: T.kane },
  { n: 'レンガの教会', fm: T.brick, wc: W1, rc: '#4a4c50', rm: T.kane },
  { n: '木の礼拝堂', fm: T.wood, wc: '#e8d8bf', rc: '#3f3b38', rm: T.kane },
  { n: '打ちはなしの教会', fm: T.conc, wc: W1, rc: '#9a9c9c', rm: T.flat },
  { n: '白い石・ガラス', fm: T.stone, wc: '#ece6da', rc: '#7f8f9a', rm: T.kane, glass: 1 }
];
function chapel(B, P, fr, u0, v0, u1, v1, y, L) {   // 礼拝堂（妻を 道に向ける）と 塔
  const lod = P.lod, r = fr.R(u0, v0, u1, v1), Fc = rfoot(r), hh = 6.5;
  B.facade(L.fm, Fc, y, y + hh, { bw: 3.2, fh: hh / 2, tb: 4, tf: 2, vy: y, c: C(L.wc) });
  B.roof({ t: 'gable', r, y: y + hh, ax: fr.ax('v'), p: 1.1, oh: 0.5, m: lod >= 1 ? L.rm : 'c', c: C(L.rc), su: 3, mg: L.fm, cg: C(L.wc), gsu: 12.8, gsv: hh, th: lod >= 1 ? 0.2 : 0 });
  const tw = Math.min(3.6, (u1 - u0) * 0.4), uc = (u0 + u1) / 2, rt = fr.R(uc - tw / 2, v0 - tw + 0.5, uc + tw / 2, v0 + 0.5), th = hh + 8;
  B.facade(L.fm, rfoot(rt), y, y + th, { bw: 3.2, fh: hh / 2, tb: 4, tf: 2, vy: y, c: C(L.wc) });
  B.roof({ t: 'pyramid', r: rt, y: y + th, p: 3.2, oh: 0.15, m: lod >= 1 ? L.rm : 'c', c: C(L.rc), su: 2, th: 0 });
  const sp = y + th + tw / 2 * 3.2;
  if (lod >= 1) { const q = fr.p(uc, v0 - tw / 2 + 0.5); B.box('c', q[0] - 0.08, q[1] - 0.08, q[0] + 0.08, q[1] + 0.08, sp - 0.3, sp + 2.2, [0.85, 0.82, 0.7]); const a = fr.p(uc - 0.6, v0 - tw / 2 + 0.5), b = fr.p(uc + 0.6, v0 - tw / 2 + 0.5); B.box('c', Math.min(a[0], b[0]) - 0.08, Math.min(a[1], b[1]) - 0.08, Math.max(a[0], b[0]) + 0.08, Math.max(a[1], b[1]) + 0.08, sp + 1.3, sp + 1.5, [0.85, 0.82, 0.7]); }
  if (lod >= 1) { const e = rfoot(rt).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) signE(B, e, e.L / 2 - 0.8, e.L / 2 + 0.8, y, y + 2.6, SG.door, 0.08); }
  return sp + 2.2;
}
A.arch('p_kyokai', {
  looks: CHL,
  far(L, P) { return { H: P.ko.wed ? 0.3 + Math.max(2, P.f) * 4 : 8, base: 0.3, wall: L.fm, bw: 3.2, fh: 3.25, tb: 4, tf: 2, wc: C(L.wc), roof: P.ko.wed ? null : L.rm, rc: C(L.rc), rt: P.ko.wed ? 'flat' : 'gable', p: 1, ins: 3 }; },
  build(B, L, P) {
    const F0 = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), Y = 0.06;
    pad(B, P, F0, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.55, 0.36], { su: 10 });
    const r0 = A.rin(mainRect(F0, P.front), SB(P, 1.5)), fr = frm(r0, P.front), W = fr.W, D = fr.D;
    if (P.ko.wed && W > 30) {   // 結婚式場：宴会場の棟 ＋ 礼拝堂 ＋ 庭
      const rb = fr.R(W * 0.42, 2, W - 1, D - 1), d = fmDims(L.fm === T.wood ? T.tile : L.fm);
      B.top = Math.max(B.top, rcBlock(B, P, rfoot(rb), n, { fm: L.fm === T.wood ? T.tile : L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 4.2, g1: 5, g1m: T.g1, wc: C(L.wc), roof: 'flat', par: 1.0, onpad: 1 }));
      const cw = Math.min(10, W * 0.3), cd = Math.min(18, D * 0.5); B.top = Math.max(B.top, chapel(B, P, fr, W * 0.2 - cw / 2, Math.max(5, D * 0.35), W * 0.2 + cw / 2, Math.max(5, D * 0.35) + cd, Y, L));
      if (lod >= 2) { const q = fr.p(W * 0.2, Math.max(2.5, D * 0.18)); B.cyl('c', q[0], q[1], 2.2, Y, Y + 0.5, 12, [0.85, 0.85, 0.82]); B.cyl('c', q[0], q[1], 1.9, Y + 0.5, Y + 0.52, 12, [0.55, 0.8, 0.9]); B.cyl('c', q[0], q[1], 0.25, Y + 0.5, Y + 1.8, 6, [0.85, 0.85, 0.82]); yardTrees(B, P, F0, rfoot(rb), 5, R, { out: [fr.R(W * 0.1, 0, W * 0.3, D)] }); }
      return;
    }
    const cw = cl(W * 0.45, 7, 12), cd = cl(D * 0.6, 12, 24), v0 = Math.max(4, (D - cd) * 0.4);
    B.top = Math.max(B.top, chapel(B, P, fr, W / 2 - cw / 2, v0, W / 2 + cw / 2, Math.min(D - 1, v0 + cd), Y, L));
    if (lod >= 1) flatU(B, fr, T.ishi, W / 2 - 1.2, 0, W / 2 + 1.2, v0 - 2.5, Y + 0.03, '#d8d2c6', 4);
    yardTrees(B, P, F0, rfoot(fr.R(W / 2 - cw / 2 - 1, v0 - 4, W / 2 + cw / 2 + 1, D)), 4, R);
  }
});
A.kinds({ church: 'p_kyokai', wedding: ['p_kyokai', { wed: 1 }] });

/* ================= 映画館・ボウリング・ゲームセンター・カラオケ・パチンコ・場外馬券売り場・ライブハウス ================= */
const ASL = [
  { n: '白いパネル', bc: '#f1f0ec', sg: [SG.navy, SG.orange] },
  { n: '黒いパネル・光る帯', bc: '#3a3a3e', sg: [SG.star, SG.pachi] },
  { n: '赤茶色の外壁', bc: '#9c5c48', sg: [SG.blank, SG.teal] },
  { n: 'ガラスと金属', bc: '#a9b0b6', sg: [SG.teal, SG.blank], glass: 1 },
  { n: 'ベージュのタイル', bc: '#e2d3b8', sg: [SG.maroon, SG.green] },
  { n: 'グレーのパネル・青い帯', bc: '#b9bcbe', sg: [SG.navy, SG.star] }
];
// ボウリングのピン（白・赤い帯）
function bigPin(B, x, z, y, h, lod) { const n = lod >= 2 ? 10 : 5, w = [0.95, 0.95, 0.93], r = h * 0.17;
  if (lod < 2) { B.cyl('c', x, z, r, y, y + h * 0.6, n, w, { notop: true }); B.cyl('c', x, z, r * 0.6, y + h * 0.6, y + h, n, w); return; }
  B.cyl('c', x, z, r * 0.75, y, y + h * 0.12, n, w, { notop: true }); B.cyl('c', x, z, r, y + h * 0.12, y + h * 0.42, n, w, { notop: true }); B.cyl('c', x, z, r * 0.55, y + h * 0.42, y + h * 0.62, n, w, { notop: true });
  B.cyl('c', x, z, r * 0.58, y + h * 0.62, y + h * 0.68, n, [0.8, 0.15, 0.12], { notop: true }); B.cyl('c', x, z, r * 0.62, y + h * 0.68, y + h * 0.86, n, w, { notop: true }); B.dome('c', x, z, r * 0.62, r * 0.62, y + h * 0.86, h * 0.14, n, w, { rings: lod >= 2 ? 3 : 1 }); }
A.arch('p_asobi', {
  looks: ASL,
  far(L, P) { const n = Math.max(1, P.f); return { H: 0.2 + n * 4.5, base: 0.2, wall: T.panelw, bw: 4, fh: 4, tb: 1, tf: 1, wc: C(L.bc), roof: null, rc: [0.6, 0.6, 0.6], rt: 'flat', ins: 0.8 }; },
  build(B, L, P) {
    const F0 = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), t = P.ko.t || 'box', Y = 0.06;
    const sp = (t === 'pachi' || t === 'bowl') && F0.n >= 4 ? splitFront(F0, P.front, 2, F0.n >= 12 ? 2 : 1) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) : F0, F = A.inset(Fm, SB(P, 0.6)), fh = t === 'kara' ? 3.4 : 4.5, H = 0.2 + n * fh;
    if (L.glass || t === 'kara') rcBlock(B, P, F, n, { fm: L.glass ? T.curtain : T.alc, tb: 4, tf: 4, bw: 3.2, fh, g1: fh, g1m: T.g1s, wc: L.glass ? W1 : C(L.bc), roof: 'flat', par: 0.9 });
    else blankBox(B, P, F, 0.2, H, L.bc, { par: 0.9 });
    B.top = Math.max(B.top, H + 1);
    if (sp.fore.length) { const Ff = subFoot(F0, sp.fore); for (const r of Ff.rects) parking(B, P, A.rin(r, 0.4), Y, R, { max: 12, fill: 0.7 }); if (lod >= 1) B.plinth(Ff, P.yb, Y); }
    if (lod < 1) return;
    const e = A.frontEdge(F, P.front), L2 = e.L;
    signE(B, e, L2 / 2 - 1.6, L2 / 2 + 1.6, 0.2, 2.8, SG.door, 0.09);
    if (t === 'pachi') { for (let i = 0; i < Math.floor(L2 / 4.5); i++) signE(B, e, 0.3 + i * 4.5, 0.3 + i * 4.5 + 4.2, 3.2, H - 0.3, i % 2 ? SG.pachi : SG.star, 0.12);   // 光るパネル
      if (lod >= 1) { const q = onE(e, 1.5, sp.fore.length ? 6 : 1.2); post(B, q[0] - 0.3, q[1] - 0.3, q[0] + 0.3, q[1] + 0.3, Y, Y + 12, [0.6, 0.6, 0.62]); B.box('c', q[0] - 1.4, q[1] - 0.4, q[0] + 1.4, q[1] + 0.4, Y + 12, Y + 18, [0.3, 0.3, 0.3]); const ex = { ax: q[0] - 1.4, az: q[1] + 0.4, bx: q[0] + 1.4, bz: q[1] + 0.4, L: 2.8, nx: 0, nz: 1 }; signE(B, ex, 0.05, 2.75, Y + 12.1, Y + 17.9, SG.pachi, 0.02); B.top = Math.max(B.top, Y + 18); } }
    else if (t === 'cine') { const np = Math.min(6, Math.floor(L2 / 4)); for (let i = 0; i < np; i++) { const at = L2 / 2 + (i - (np - 1) / 2) * 4; if (Math.abs(at - L2 / 2) < 2.5) continue; signE(B, e, at - 1.3, at + 1.3, 0.8, 3.6, SG.poster, 0.1); }
      signE(B, e, 0.5, L2 - 0.5, H - 3.4, H - 1.0, L.sg[0], 0.12); }
    else if (t === 'bowl') { signE(B, e, 0.5, L2 - 0.5, H - 2.8, H - 0.6, L.sg[0], 0.12); if (lod >= 1) { const q = onE(e, e.L * 0.75, -4); bigPin(B, q[0], q[1], H + 0.9, 12, lod); B.top = Math.max(B.top, H + 13); } }
    else if (t === 'kara') { for (let j = 0; j < Math.min(n, 6); j++) signE(B, e, 0.3, L2 * 0.6, fh * (j + 1) - 0.9 + 0.2, fh * (j + 1) - 0.25 + 0.2, L.sg[j % 2], 0.12);
      const q = onE(e, L2 - 0.6, 0.8), ang = Math.atan2(e.nz, e.nx); B.obox('c', q[0], q[1], ang, 1.4, 0.35, 0.2 + fh, H - 0.3, mul(C(L.bc), 0.6)); }
    else if (t === 'arc') { signE(B, e, 0.3, L2 - 0.3, 4.6, 6.0, SG.star, 0.12); if (n >= 2) signE(B, e, 0.3, L2 - 0.3, H - 2.2, H - 0.5, L.sg[1], 0.12); }
    else if (t === 'live') { signE(B, e, L2 * 0.2, L2 * 0.8, 3.4, 4.4, L.sg[0], 0.1); signE(B, e, L2 * 0.1, L2 * 0.1 + 1.4, 0.4, 2.2, SG.poster, 0.1); }
    else signE(B, e, 0.5, L2 - 0.5, H - 2.6, H - 0.8, SG.green, 0.12);
    if (lod >= 2) for (const e2 of F.edges) if (e2 !== e && e2.L > 6 && R() < 0.7) { const q2 = onE(e2, e2.L * (0.2 + 0.6 * R()), 0.35); B.acUnit(q2[0], q2[1], 0.3, Math.atan2(e2.nz, e2.nx) + PI / 2); }
  }
});
A.kinds({ cinema: ['p_asobi', { t: 'cine' }], bowling: ['p_asobi', { t: 'bowl' }], arcade: ['p_asobi', { t: 'arc' }], karaoke: ['p_asobi', { t: 'kara' }], pachinko: ['p_asobi', { t: 'pachi' }], kbshop: ['p_asobi', { t: 'kb', looks: [ASL[4], ASL[0], ASL[5], ASL[3]] }], livehouse: ['p_asobi', { t: 'live', looks: [ASL[1], ASL[2], ASL[5], ASL[0]] }] });

/* ================= 銭湯・スーパー銭湯 ================= */
const SNL = [
  { n: '宮造り・唐破風', fm: T.ki, wc: '#c8b190', rm: 'kawara', rt: 'iri', kara: 1 },
  { n: '瓦屋根・白壁', fm: T.tera, wc: W1, rm: 'kawara', rt: 'kiri' },
  { n: 'ビル型・タイル', fm: T.tile, wc: '#e9e4da', rt: 'flat' },
  { n: '黒い板張り', fm: T.wood, wc: '#5a4c42', rm: 'kane', rt: 'kiri' },
  { n: '和モダン・木の格子', fm: T.louver, wc: '#c9a27a', rt: 'flat', eave: 1 }
];
function chimney(B, x, z, y, h, lod) { if (lod < 2) { trunk3(B, x, z, y, y + h, 0.8, [0.62, 0.6, 0.57]); return; } B.cyl('c', x, z, 0.75, y, y + h, lod >= 2 ? 8 : 4, [0.62, 0.6, 0.57], { notop: true }); if (lod >= 2) { B.cyl('c', x, z, 0.8, y + h - 0.6, y + h, 8, [0.35, 0.33, 0.32], { notop: true }); for (let k = 1; k < 4; k++) B.cyl('c', x, z, 0.78, y + h * k / 4, y + h * k / 4 + 0.15, 8, [0.4, 0.38, 0.36], { notop: true }); } }
A.arch('p_sento', {
  looks: SNL,
  far(L, P) { return { H: 0.3 + 5.5 * Math.max(1, Math.min(P.f, 2)), base: 0.3, wall: L.fm, bw: 2, fh: 5.5, tb: 4, tf: 1, wc: C(L.wc), roof: L.rt === 'flat' ? null : (L.rm === 'kane' ? T.kane : T.kawara), rc: L.rm === 'kane' ? C('#4a4846') : W1, rt: L.rt === 'flat' ? 'flat' : 'hip', p: 0.55, ins: 1 }; },
  build(B, L, P) {
    const F0 = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), big = !!P.ko.big, Y = 0.06, nv0 = B.nv;
    const sp = big && F0.n >= 6 ? splitFront(F0, P.front, 3, 2) : { fore: [], main: F0.cells };
    const Fm = sp.fore.length ? subFoot(F0, sp.main) : F0;
    if (lod >= 1 || P.yb < -0.5) pad(B, P, Fm, Y, lod >= 1 ? T.ishi : 'c', '#cfcac0', { su: 4 });
    const r0 = A.rin(mainRect(Fm, P.front), SB(P, big ? 3 : 0.8)), fr = frm(r0, P.front), W = fr.W, D = fr.D;
    const rm = RM[L.rm] || RM.kawara, hh = big ? 5.5 : 5.2, fl = 0.4;
    // 浴場の建物（スーパー銭湯は 半分を 露天風呂に）
    const rb = big ? fr.R(0, 0, W, D * 0.6) : fr.R(0, 0, W, D), Fb = rfoot(rb);
    const fm = L.fm === T.ki || L.fm === T.tera || L.fm === T.wood ? L.fm : L.fm;
    B.facade(lod >= 1 ? fm : 'c', Fb, Y, Y + fl + hh, { bw: L.fm === T.ki || L.fm === T.tera ? 2 : 3.2, fh: fl + hh, tb: 4, tf: L.fm === T.tile ? 2 : 1, vy: Y, c: C(L.wc) });
    let top = Y + fl + hh;
    if (L.rt === 'flat') { B.cap(lod >= 1 ? T.flat : 'c', Fb, top, lod >= 1 ? W1 : [0.62, 0.62, 0.6], { su: 8 }); if (lod >= 2) B.parapet(Fb, top, 0.6, 0.25, mul(C(L.wc), 0.9)); if (L.eave && lod >= 2) for (const e of Fb.edges) B.ledge(e, top - 0.3, top, 1.6, C('#5a4c42')); }
    else if (lod < 1) top = B.roof({ t: 'gable', r: rb, y: top, ax: fr.ax('u'), p: 0.62, oh: 0.8, m: 'c', c: L.rm === 'kane' ? [0.3, 0.3, 0.3] : [0.42, 0.44, 0.46], th: 0, mg: 'c', cg: C(L.wc) });
    else top = jroof(B, Object.assign({}, rm, { r: rb, y: top, t: L.rt, ax: fr.ax('u'), oh: 1.0, og: 0.7, p: 0.62, cv: 0.35, up: 0.25, k1: 0.42, rh: 0.45, uc: [0.36, 0.3, 0.26], gc: [0.86, 0.82, 0.74], nd: 2, ns: 5, lod }));
    if (n >= 2 && !big && lod >= 1) { const r2 = fr.R(W * 0.1, D * 0.45, W * 0.9, D - 0.5); B.facade(lod >= 1 ? T.siding : 'c', rfoot(r2), top - 0.5, top + 3, { bw: 3, fh: 3, tb: 4, tf: 2, vy: top, c: [0.95, 0.94, 0.9] }); B.roof({ t: 'gable', r: r2, y: top + 3, p: 0.45, oh: 0.5, m: lod >= 1 ? T.kane : 'c', c: C('#5d5a57'), su: 3, mg: T.siding, cg: [0.95, 0.94, 0.9], gsu: 12, gsv: 6, th: 0 }); top += 5; }
    B.top = Math.max(B.top, top);
    // 煙突（うしろ）
    const cq = fr.p(W * 0.82, D * (big ? 0.55 : 0.85)); chimney(B, cq[0], cq[1], Y, big ? 16 : 20, lod); B.top = Math.max(B.top, Y + 20);
    if (lod >= 1) { const e = Fb.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9) || Fb.edges[0], mid = e.L / 2;
      signE(B, e, mid - 1.6, mid + 1.6, Y + fl, Y + fl + 2.2, SG.noren, 0.1);
      if (L.kara && lod >= 2) kohai(B, fr, W / 2, 3.6, 0.2, -2.0, Y + fl + hh - 0.2, 0.3, Object.assign({}, rm, { kara: 1.0, lod, y0: Y, pc: C('#6b5240'), gc: [0.8, 0.74, 0.62] }));
      else canopy(B, e, mid, 5, 1.4, Y + fl + 2.6, '#5a4c42', { lod, th: 0.25 }); }
    // スーパー銭湯：露天風呂（石・木の塀）・駐車場
    if (big) { const ro = fr.R(2, D * 0.62, W - 2, D - 1); if (lod >= 1) { B.flat(T.ishi, ro, Y + 0.04, '#bdb8ad', { su: 4 }); const n2 = lod >= 2 ? 3 : 1; for (let i = 0; i < n2; i++) { const r2 = fr.R(4 + i * (W - 8) / n2, D * 0.66, 4 + (i + 1) * (W - 8) / n2 - 3, D - 4); B.flat(T.mizu, r2, Y + 0.3, [0.75, 0.85, 0.82], { su: 6 }); if (lod >= 2) for (const e of rfoot(r2).edges) B.ledge(e, Y, Y + 0.35, 0.5, C('#8a857b')); } if (lod >= 2) fenceF(B, rfoot(ro), Y, 2.4, C('#6b5848'), T.wood, null, 2.4); }
      if (sp.fore.length) { const Ff = subFoot(F0, sp.fore); for (const r of Ff.rects) parking(B, P, A.rin(r, 0.4), Y, R, { max: 16, fill: 0.7 }); if (lod >= 1) B.plinth(Ff, P.yb, Y); }
      grove(B, P, [ro], [A.rin(ro, 3)], { sp: 6, k: 0.6, h: [6, 10], y: Y, p: 0.4, max: 12, vmax: left(B, nv0, lod, 0.6) }); }
  }
});
A.kinds({ sento: 'p_sento', superonsen: ['p_sento', { big: 1 }] });

/* ================= 競技場（野球場・サッカー場・陸上競技場・アリーナ・ドーム・競馬場）================= */
T.seats = TX('f:seats', 128, 128, (g, w, h, R) => { const k = w / 128, rows = 8, rh = h / rows; fill(g, 0, 0, w, h, '#a9a8a3');
  for (let j = 0; j < rows; j++) { const y = j * rh; fill(g, 0, y + rh * 0.62, w, rh * 0.38, '#bdbcb7'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y + rh * 0.6, w, Math.max(1, k));
    for (let i = 0; i < 12; i++) { const x = i * w / 12; fill(g, x + w / 120, y + rh * 0.12, w / 12 - w / 60, rh * 0.48, '#e8e8e6'); } }
  PT.noise(g, 0, 0, w, h, 0.03, R); });
// 直線 ＋ 半円 の形（だ円の競技場）：まん中・直線の半分 st・半径 b。off（外へ）で 同じ点の数
function stadRing(cx, cz, st, b, alongX, n1, n2) { return off => { const o = [], r = b + off;
  for (let i = 0; i < n1; i++) o.push([-st + 2 * st * i / n1, -r]);
  for (let i = 0; i < n2; i++) { const a = -PI / 2 + PI * i / n2; o.push([st + Math.cos(a) * r, Math.sin(a) * r]); }
  for (let i = 0; i < n1; i++) o.push([st - 2 * st * i / n1, r]);
  for (let i = 0; i < n2; i++) { const a = PI / 2 + PI * i / n2; o.push([-st + Math.cos(a) * r, Math.sin(a) * r]); }
  return o.map(q => alongX ? [cx + q[0], cz + q[1]] : [cx + q[1], cz + q[0]]); }; }
// 輪のあいだの面（m, c）：内 p0（高さ h0）・外 p1（h1）。uv：u は まわりの長さ / su・v は 0〜vv
function ringStrip(B, m, p0, p1, h0, h1, c, su, vv, skip) { let s = 0; const n = p0.length;
  for (let i = 0; i < n; i++) { if (skip && skip(i)) continue; const j = (i + 1) % n, l = Math.hypot(p0[j][0] - p0[i][0], p0[j][1] - p0[i][1]);
    B.quad(m, [p0[i][0], h0, p0[i][1]], [p0[j][0], h0, p0[j][1]], [p1[j][0], h1, p1[j][1]], [p1[i][0], h1, p1[i][1]], null, c, su ? [s / su, 0, (s + l) / su, 0, (s + l) / su, vv, s / su, vv] : null); s += l; } }
function ringWall(B, m, p, y0, y1, c, su, sv) { let s = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length, l = Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1]); B.wall(m, p[j][0], p[j][1], p[i][0], p[i][1], y0, y1, c, su ? [s / su, (s + l) / su, y0 / sv, y1 / sv] : null); s += l; } }
// 照明塔
function lightTower(B, x, z, y, h, lod) { trunk3(B, x, z, y, y + h, 0.35, [0.72, 0.72, 0.7]); if (lod >= 2) B.box('c', x - 2, z - 0.3, x + 2, z + 0.3, y + h, y + h + 2.4, [0.85, 0.86, 0.84]); else B.wall('c', x - 2, z, x + 2, z, y + h, y + h + 2.4, [0.85, 0.86, 0.84]); }
// 白線（a → b）
const line = (B, a, b, y, wd, c) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * wd / 2, nz = dx / l * wd / 2; B.quad('c', [a[0] - nx, y, a[1] - nz], [a[0] + nx, y, a[1] + nz], [b[0] + nx, y, b[1] + nz], [b[0] - nx, y, b[1] - nz], [0, 1, 0], c || [0.95, 0.95, 0.92]); };
const STL = [
  { n: '青い座席・白い屋根', sc: '#5f86b4', rf: '#f2f2ef', wc: '#e3e1db' },
  { n: '緑の座席・コンクリート', sc: '#5f8a64', rf: 0, wc: '#cfcdc7' },
  { n: '赤い座席・銀の屋根', sc: '#b4564a', rf: '#b9bec2', wc: '#d6d4ce' },
  { n: 'グレーの座席・ガラス', sc: '#a3a6a8', rf: '#9fb2c0', wc: '#c5ccd1' },
  { n: 'オレンジの座席・木の屋根', sc: '#d08a48', rf: '#a5825c', wc: '#e2dacd' }
];
A.arch('p_stadium', {
  looks: STL,
  far(L, P) { const t = P.ko.t, dome = t === 'dome' || t === 'arena'; return { H: dome ? 25 : (t === 'track' || t === 'keiba' ? 0.3 : 14), base: 0, wall: dome ? T.panelw : T.seats, bw: 4, fh: 4, tb: 1, tf: 1, wc: C(dome ? '#e6e4de' : L.sc), roof: null, rc: [0.92, 0.92, 0.9], ct: dome ? [0.93, 0.93, 0.92] : null, rt: 'flat', top: dome ? null : T.shiba, ins: 2 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, t = P.ko.t || 'soccer', n = Math.max(1, P.f), Y = 0.06, nv0 = B.nv;
    const hole = F.loops.length > 1, rb = hole ? F.bb : mainRect(F, P.front), r0 = A.rin(rb, 2);
    if (t === 'keiba') pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? [0.92, 0.95, 0.88] : [0.45, 0.58, 0.36], { su: 10 });
    else pad(B, P, F, Y, lod >= 1 ? T.asph : 'c', lod >= 1 ? [0.9, 0.9, 0.9] : [0.45, 0.46, 0.47], { su: 8 });
    const W = r0[2] - r0[0], D = r0[3] - r0[1], alongX = W >= D, cx = (r0[0] + r0[2]) / 2, cz = (r0[1] + r0[3]) / 2, La = Math.max(W, D) / 2, Lb = Math.min(W, D) / 2;
    const N1 = lod >= 2 ? 3 : 1, N2 = lod >= 2 ? 12 : lod >= 1 ? 6 : 3;
    // 屋内（アリーナ・ドーム）
    if (t === 'arena' || t === 'dome') {
      const b = Lb * 0.92, st = Math.max(0, La * 0.92 - b), ring = stadRing(cx, cz, st, b, alongX, N1, N2), hh = t === 'dome' ? 14 : 4 + n * 4;
      ringWall(B, lod >= 1 ? T.panelw : 'c', ring(0), Y, Y + hh, C(L.wc), 4, 4);
      if (t === 'dome') { B.dome('c', cx, cz, alongX ? La * 0.92 : b, alongX ? b : La * 0.92, Y + hh, Math.min(La, Lb) * 0.55, lod >= 2 ? 24 : lod >= 1 ? 12 : 6, [0.93, 0.93, 0.92], { rings: lod >= 2 ? 5 : 2 }); B.top = Math.max(B.top, Y + hh + Math.min(La, Lb) * 0.55); }
      else { B.dome('c', cx, cz, alongX ? La * 0.92 + 1 : b + 1, alongX ? b + 1 : La * 0.92 + 1, Y + hh, Math.min(10, Lb * 0.25), lod >= 2 ? 20 : 10, C(L.rf || '#b9bec2'), { rings: lod >= 2 ? 3 : 1 }); B.top = Math.max(B.top, Y + hh + 10); }
      if (lod >= 1) { const e = rfoot(r0).edges.find(q => q.nz * (P.front || [0, 1])[1] + q.nx * (P.front || [0, 1])[0] > 0.9) || rfoot(r0).edges[2]; const q = onE(e, e.L / 2, 0); const ee = { ax: q[0] - e.nz * 0 - (e.bx - e.ax) / e.L * 8, az: q[1] - (e.bz - e.az) / e.L * 8, bx: q[0] + (e.bx - e.ax) / e.L * 8, bz: q[1] + (e.bz - e.az) / e.L * 8, L: 16, nx: e.nx, nz: e.nz };
        canopy(B, { ax: ee.ax - e.nx * (Lb * 0.08 + 2), az: ee.az - e.nz * (Lb * 0.08 + 2), bx: ee.bx - e.nx * (Lb * 0.08 + 2), bz: ee.bz - e.nz * (Lb * 0.08 + 2), L: 16, nx: e.nx, nz: e.nz }, 8, 16, 6, Y + 5, '#e4e3df', { posts: 1, lod, th: 0.4, y0: Y }); }
      if (lod >= 1) for (const r of F.rects) { const rr = A.rin(r, 1); if ((rr[2] - rr[0]) * (rr[3] - rr[1]) > 300) parking(B, P, rr, Y + 0.01, R, { avoid: [[cx - La, cz - Lb, cx + La, cz + Lb]], max: 16 }); }
      return;
    }
    // 外の競技場：グラウンド・スタンド
    const sd = cl(Lb * 0.28, 8, 34) * (t === 'track' || t === 'keiba' ? 0.75 : 1), gap = 2.5;
    const fb = Lb - sd - gap, fst = Math.max(0, La - sd - gap - fb), ring = stadRing(cx, cz, fst, fb, alongX, N1, N2);
    if (t === 'keiba') {   // 競馬場：芝・ダート・内の 芝生・スタンドは 正面だけ
      const bw = cl(Lb * 0.12, 12, 30), b0 = Lb - bw - 8, st0 = Math.max(0, La - bw - 8 - b0), rk = stadRing(cx, cz, st0, b0, alongX, N1, lod >= 2 ? N2 * 2 : N2);
      const tw = cl(b0 * 0.16, 10, 28);
      ringStrip(B, lod >= 1 ? T.shiba : 'c', rk(-tw), rk(0), Y + 0.03, Y + 0.03, lod >= 1 ? [0.82, 0.95, 0.72] : [0.45, 0.6, 0.35], 20, 1);
      if (lod >= 1) ringStrip(B, T.tsuchi, rk(-tw * 1.8), rk(-tw), Y + 0.04, Y + 0.04, [0.86, 0.76, 0.6], 12, 1);
      if (lod >= 2) { ringWall(B, 'c', rk(0.2), Y, Y + 1.0, [0.95, 0.95, 0.94]); ringWall(B, 'c', rk(-tw - 0.2), Y, Y + 1.0, [0.95, 0.95, 0.94]); }
      const sg = alongX ? [r0[0] + 10, r0[3] - bw, r0[2] - 10, r0[3]] : [r0[2] - bw, r0[1] + 10, r0[2], r0[3] - 10], Fs = rfoot(sg), ns = Math.max(3, n + 4);
      const H = rcBlock(B, P, Fs, ns, { fm: T.curtain, tb: 4, tf: 4, bw: 3.6, fh: 4.2, g1: 5, wc: C(L.wc), roof: 'flat', par: 0.8, onpad: 1 }); B.top = Math.max(B.top, H);
      if (lod >= 1) { const e = Fs.edges.find(q => (alongX ? -q.nz : -q.nx) > 0.9); if (e) { B.quad(T.seats, onE3(e, 0, 0, Y + 1), onE3(e, e.L, 0, Y + 1), onE3(e, e.L, -bw * 0.35, H * 0.55), onE3(e, 0, -bw * 0.35, H * 0.55), null, C(L.sc), [0, 0, e.L / 6, bw * 0.35 / 6]);
        if (L.rf) B.ledge(e, H - 0.4, H, bw * 0.4, C(L.rf)); } }
      grove(B, P, [[cx - La * 0.5, cz - Lb * 0.3, cx + La * 0.5, cz + Lb * 0.3]], [], { sp: 14, k: 0.5, h: [8, 12], y: Y, max: 12, vmax: left(B, nv0, lod, 0.5) });
      return;
    }
    // グラウンド
    if (t === 'track') { ringStrip(B, lod >= 1 ? T.track : 'c', ring(-cl(fb * 0.2, 6, 12)), ring(0), Y + 0.04, Y + 0.04, lod >= 1 ? W1 : [0.66, 0.36, 0.28], 16, 1); }
    const pf = ring(t === 'track' ? -cl(fb * 0.2, 6, 12) : 0);
    { const c0 = [cx, cz]; for (let i = 0; i < pf.length; i++) { const j = (i + 1) % pf.length; B.tri(lod >= 1 ? T.shiba : 'c', [c0[0], Y + 0.05, c0[1]], [pf[j][0], Y + 0.05, pf[j][1]], [pf[i][0], Y + 0.05, pf[i][1]], [0, 1, 0], lod >= 1 ? W1 : [0.45, 0.6, 0.35], [c0[0] / 10, c0[1] / 10, pf[j][0] / 10, pf[j][1] / 10, pf[i][0] / 10, pf[i][1] / 10]); } }
    if (lod >= 2) {   // 線
      if (t === 'soccer') { const hl = Math.min(fst + fb * 0.9, (fb * 0.95) * 1.55), hw = Math.min(fb * 0.85, hl / 1.55), P2 = (a, b) => alongX ? [cx + a, cz + b] : [cx + b, cz + a];
        for (const [a, b, c2, d2] of [[-hl, -hw, hl, -hw], [-hl, hw, hl, hw], [-hl, -hw, -hl, hw], [hl, -hw, hl, hw], [0, -hw, 0, hw], [-hl, -hw * 0.6, -hl + hw * 0.5, -hw * 0.6], [-hl, hw * 0.6, -hl + hw * 0.5, hw * 0.6], [-hl + hw * 0.5, -hw * 0.6, -hl + hw * 0.5, hw * 0.6], [hl, -hw * 0.6, hl - hw * 0.5, -hw * 0.6], [hl, hw * 0.6, hl - hw * 0.5, hw * 0.6], [hl - hw * 0.5, -hw * 0.6, hl - hw * 0.5, hw * 0.6]]) line(B, P2(a, b), P2(c2, d2), Y + 0.08, 0.15);
        for (let i = 0; i < 12; i++) { const a0 = i / 12 * PI * 2, a1 = (i + 1) / 12 * PI * 2, rc2 = hw * 0.27; line(B, P2(Math.cos(a0) * rc2, Math.sin(a0) * rc2), P2(Math.cos(a1) * rc2, Math.sin(a1) * rc2), Y + 0.08, 0.15); }
        for (const sg of [-1, 1]) goal(B, ...P2(sg * hl, 0), Y + 0.05, alongX ? 0 : PI / 2); }
      if (t === 'base') {   // 内野（土）と ファウルライン
        const hx = alongX ? cx - (fst + fb) * 0.62 : cx, hz = alongX ? cz : cz - (fst + fb) * 0.62, dir = alongX ? [1, 0] : [0, 1], s = Math.min(fb, fst + fb) * 0.45, q = (a, b) => [hx + dir[0] * a - dir[1] * b, hz + dir[1] * a + dir[0] * b];
        const inf = [q(0, 0), q(s * 0.7, -s * 0.7), q(s * 1.4, 0), q(s * 0.7, s * 0.7)]; B.quad(T.tsuchi, [inf[0][0], Y + 0.07, inf[0][1]], [inf[3][0], Y + 0.07, inf[3][1]], [inf[2][0], Y + 0.07, inf[2][1]], [inf[1][0], Y + 0.07, inf[1][1]], [0, 1, 0], [0.9, 0.8, 0.65], [0, 0, 2, 0, 2, 2, 0, 2]);
        const gr = [q(s * 0.18, 0), q(s * 0.7, -s * 0.5), q(s * 1.22, 0), q(s * 0.7, s * 0.5)]; B.quad(T.shiba, [gr[0][0], Y + 0.09, gr[0][1]], [gr[3][0], Y + 0.09, gr[3][1]], [gr[2][0], Y + 0.09, gr[2][1]], [gr[1][0], Y + 0.09, gr[1][1]], [0, 1, 0], [1.05, 1.08, 1], [0, 0, 2, 0, 2, 2, 0, 2]);
        line(B, q(0, 0), q(fb * 1.5, -fb * 1.5), Y + 0.1, 0.2); line(B, q(0, 0), q(fb * 1.5, fb * 1.5), Y + 0.1, 0.2); }
    }
    // スタンド（輪）：内 → 外へ 上がる
    const sh = (t === 'track' ? 0.42 : 0.55) * sd * (n >= 2 ? 1.15 : 1), h0 = Y + 1.2, h1 = h0 + sh, rin = ring(gap), rout = ring(gap + sd);
    const skip = null, bank = !!P.ko.bank;
    if (bank) {   // 陸上競技場：まわりは 芝の土手・正面に 屋根つきの スタンド
      if (lod >= 1) ringStrip(B, T.shiba, rin, rout, Y + 0.3, Y + sd * 0.3, [0.92, 0.95, 0.88], 12, 1);
      const sw0 = Math.min(La * 1.1, 90), q0 = alongX ? [cx - sw0 / 2, r0[3] - sd, cx + sw0 / 2, r0[3]] : [r0[2] - sd, cz - sw0 / 2, r0[2], cz + sw0 / 2], Fs = rfoot(q0), e = Fs.edges.find(q => (alongX ? -q.nz : -q.nx) > 0.9);
      if (lod >= 1) B.facade(T.panelw, Fs, Y, Y + sh + 1, { bw: 4, fh: 4, tb: 1, tf: 1, vy: Y, c: C(L.wc) }); else B.box('c', q0[0], q0[1], q0[2], q0[3], Y, Y + sh, C(L.wc));
      if (e && lod >= 1) { B.quad(T.seats, onE3(e, 0, 0, Y + 1.2), onE3(e, e.L, 0, Y + 1.2), onE3(e, e.L, -sd, Y + sh), onE3(e, 0, -sd, Y + sh), null, C(L.sc), [0, 0, e.L / 6, sd / 6.4]); if (L.rf) { B.ledge(e, Y + sh + 7, Y + sh + 7.8, -sd * 0.2, C(L.rf)); const e2 = { ax: e.ax - e.nx * sd * 0.45, az: e.az - e.nz * sd * 0.45, bx: e.bx - e.nx * sd * 0.45, bz: e.bz - e.nz * sd * 0.45, L: e.L, nx: e.nx, nz: e.nz }; B.ledge(e2, Y + sh + 7, Y + sh + 7.8, sd * 0.45 + sd * 0.1, C(L.rf)); } }
      B.top = Math.max(B.top, Y + sh + 8);
      if (lod >= 2) { const qs = alongX ? [cx, r0[1] + sd * 0.4] : [r0[0] + sd * 0.4, cz]; B.obox('c', qs[0], qs[1], alongX ? 0 : PI / 2, Math.min(22, La * 0.3), 1.2, Y + sd * 0.3, Y + sd * 0.3 + 8, [0.2, 0.22, 0.24]); }
      return;
    }
    ringStrip(B, lod >= 1 ? T.seats : 'c', rin, rout, h0, h1, lod >= 1 ? C(L.sc) : mul(C(L.sc), 0.9), 6, sd / 6.4, skip);
    if (lod >= 1) ringWall(B, T.panelw, rout, Y, h1 + 1, C(L.wc), 4, 4);
    if (lod >= 1) ringWall(B, 'c', rin, Y, h0, mul(C(L.wc), 0.85));
    if (L.rf && lod >= 1) { const ra = ring(gap + sd * 0.45), rz = ring(gap + sd + 0.6); ringStrip(B, 'c', ra, rz, h1 + 7, h1 + 8.5, C(L.rf), 0, 0, skip); B.top = Math.max(B.top, h1 + 8.5); if (lod >= 2) for (let i = 0; i < rz.length; i += 3) { if (skip && skip(i)) continue; post(B, rz[i][0] - 0.25, rz[i][1] - 0.25, rz[i][0] + 0.25, rz[i][1] + 0.25, h1, h1 + 8.5, [0.8, 0.8, 0.8]); } }
    B.top = Math.max(B.top, h1 + 1);
    if (lod >= 1 && t !== 'track') { const ro = ring(gap + sd + 4); for (let k = 0; k < 4; k++) { const i = Math.floor((k + 0.5) / 4 * ro.length) % ro.length; lightTower(B, ro[i][0], ro[i][1], Y, h1 + 22, lod); } B.top = Math.max(B.top, h1 + 25); }
    if (lod >= 2) { const q = alongX ? [r0[2] - 2, cz] : [cx, r0[3] - 2], ang = alongX ? PI / 2 : 0; B.obox('c', q[0], q[1], ang, Math.min(24, Lb * 0.5), 1.2, h1 - 2, h1 + 8, [0.2, 0.22, 0.24]); }
  }
});
const onE3 = (e, t, off, y) => { const q = onE(e, t, off); return [q[0], y, q[1]]; };
A.kinds({ baseball: ['p_stadium', { t: 'base' }], soccer: ['p_stadium', { t: 'soccer' }], natstad: ['p_stadium', { t: 'track' }], athletics: ['p_stadium', { t: 'track', bank: 1 }], arena: ['p_stadium', { t: 'arena' }], domestadium: ['p_stadium', { t: 'dome' }], keiba: ['p_stadium', { t: 'keiba' }] });

/* ================= 公園・広場・庭園・霊園・遊び場など（だいたい 平らな 土地）================= */
T.green = TX('f:green', 128, 128, (g, w, h, R) => { const k = w / 128; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#d9e8ee'); gr.addColorStop(1, '#a9c4c8'); g.fillStyle = gr; g.fillRect(0, 0, w, h);   // 温室のガラス
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(80,120,70,.18)'; g.beginPath(); g.arc(R() * w, h * (0.55 + R() * 0.45), (4 + R() * 9) * k, 0, PI * 2); g.fill(); }
  g.fillStyle = '#f4f5f2'; for (let i = 0; i <= 8; i++) g.fillRect(i * w / 8 - k, 0, 2 * k, h); for (let j = 0; j <= 4; j++) g.fillRect(0, j * h / 4 - k, w, 2 * k); });
// 池（ゆがんだ 輪）
function pondP(B, P, cx, cz, rx, rz, y, R, c, rim) {
  const lod = P.lod, n = lod >= 2 ? 14 : lod >= 1 ? 8 : 6, pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * PI * 2, k = 0.82 + 0.3 * R(); pts.push([cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k]); }
  if (lod >= 1 && rim !== 0) for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = pts[i], b = pts[j], oa = [cx + (a[0] - cx) * 1.1, cz + (a[1] - cz) * 1.1], ob = [cx + (b[0] - cx) * 1.1, cz + (b[1] - cz) * 1.1];
    B.quad('c', [a[0], y + 0.015, a[1]], [oa[0], y + 0.015, oa[1]], [ob[0], y + 0.015, ob[1]], [b[0], y + 0.015, b[1]], null, rim || [0.62, 0.6, 0.55]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.tri(lod >= 1 ? T.mizu : 'c', [cx, y + 0.03, cz], [pts[j][0], y + 0.03, pts[j][1]], [pts[i][0], y + 0.03, pts[i][1]], null, lod >= 1 ? (c || [0.75, 0.85, 0.8]) : [0.38, 0.52, 0.55], [cx / 10, cz / 10, pts[j][0] / 10, pts[j][1] / 10, pts[i][0] / 10, pts[i][1] / 10]); }
  return pts;
}
// 道（枠の u, v で）
const pathU = (B, P, fr, u0, v0, u1, v1, y, c) => flatU(B, fr, P.lod >= 1 ? T.jari : 'c', u0, v0, u1, v1, y, P.lod >= 1 ? (c || '#ddd4c2') : '#c8bfac', 4);
// ベンチ・街灯
const bench = (B, x, z, y, ang) => { B.obox('c', x, z, ang, 1.8, 0.5, y + 0.4, y + 0.5, [0.55, 0.42, 0.3]); B.obox('c', x, z, ang, 1.6, 0.4, y, y + 0.4, [0.35, 0.35, 0.36]); };
const lamp = (B, x, z, y) => { trunk3(B, x, z, y, y + 4.5, 0.07, [0.3, 0.32, 0.33]); B.box('c', x - 0.25, z - 0.25, x + 0.25, z + 0.25, y + 4.5, y + 4.8, [0.9, 0.9, 0.85]); };
// 花壇（色の帯）
const FLC = [[0.82, 0.38, 0.45], [0.88, 0.72, 0.28], [0.56, 0.42, 0.68], [0.9, 0.55, 0.32], [0.95, 0.94, 0.9]];
function flowers(B, P, r, y, R, n) { const w = r[2] - r[0], d = r[3] - r[1], ax = w >= d, k = Math.max(1, Math.min(n || 8, Math.floor((ax ? d : w) / 2.2)));
  for (let i = 0; i < k; i++) { const t0 = (ax ? r[1] : r[0]) + (i + 0.15) * (ax ? d : w) / k, t1 = t0 + (ax ? d : w) / k * 0.7, c = FLC[(i + Math.floor(R() * 5)) % 5]; B.flat('c', ax ? [r[0], t0, r[2], t1] : [t0, r[1], t1, r[3]], y, c); } }
// テント（三角）
function tent(B, x, z, y, ang, c, sz = 1) { const ca = Math.cos(ang), sa = Math.sin(ang), L = 2.4 * sz, Wd = 1.1 * sz, H = 1.3 * sz, P2 = (a, b, h) => [x + ca * a - sa * b, y + h, z + sa * a + ca * b];
  B.quad('c', P2(-L / 2, -Wd, 0), P2(L / 2, -Wd, 0), P2(L / 2, 0, H), P2(-L / 2, 0, H), null, C(c)); B.quad('c', P2(L / 2, Wd, 0), P2(-L / 2, Wd, 0), P2(-L / 2, 0, H), P2(L / 2, 0, H), null, mul(C(c), 0.85));
  B.tri('c', P2(-L / 2, -Wd, 0), P2(-L / 2, 0, H), P2(-L / 2, Wd, 0), null, mul(C(c), 0.92)); B.tri('c', P2(L / 2, Wd, 0), P2(L / 2, 0, H), P2(L / 2, -Wd, 0), null, mul(C(c), 0.7)); }
// 小屋（管理棟など）
function hut(B, P, r, y, h, fm, wc, rc, rt) { const lod = P.lod; B.facade(lod >= 1 ? (fm || T.wood) : 'c', rfoot(r), y, y + h, { bw: 2.4, fh: h, tb: 4, tf: 1, vy: y, c: C(wc || '#ffffff') });
  return B.roof({ t: rt || 'gable', r, y: y + h, p: 0.5, oh: 0.6, m: lod >= 1 ? T.kane : 'c', c: C(rc || '#4d4a46'), su: 3, mg: lod >= 1 ? (fm || T.wood) : 'c', cg: C(wc || '#ffffff'), gsu: 9.6, gsv: h, th: lod >= 2 ? 0.12 : 0 }); }
// 観覧車（向き ang の 面）
function wheel(B, P, x, z, y, r, ang, cs) { const lod = P.lod, ca = Math.cos(ang), sa = Math.sin(ang), cy = y + r + 4, n = lod >= 2 ? 18 : lod >= 1 ? 8 : 6, Q = (t, rr, off = 0) => [x + ca * Math.cos(t) * rr - sa * off, cy + Math.sin(t) * rr, z + sa * Math.cos(t) * rr + ca * off];
  for (const sg of lod >= 1 ? [-1, 1] : [1]) { const f0 = [x - ca * r * 0.55 + sg * -sa * 2, y, z - sa * r * 0.55 + sg * ca * 2], f1 = [x + ca * r * 0.55 + sg * -sa * 2, y, z + sa * r * 0.55 + sg * ca * 2], tp = [x + sg * -sa * 0.8, cy, z + sg * ca * 0.8]; pole(B, f0, tp, 0.3, [0.9, 0.9, 0.88]); pole(B, f1, tp, 0.3, [0.9, 0.9, 0.88]); }
  for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.quad('c', Q(t0, r - 0.5), Q(t1, r - 0.5), Q(t1, r), Q(t0, r), null, [0.95, 0.95, 0.93]);
    if (lod >= 2 && i % 2 === 0) { const q = Q(t0, 0), e2 = Q(t0, r); beam(B, q, e2, 0.15, 0.15, [0.85, 0.85, 0.85]); const g = Q(t0, r + 0.2); B.box('c', g[0] - 0.8, g[2] - 0.8, g[0] + 0.8, g[2] + 0.8, g[1] - 2.2, g[1] - 0.4, A.pick(P.rng, cs)); } }
  return cy + r; }
// ジェットコースター（輪の道・上下）
function coaster(B, P, ring, y, c, hmax) { const lod = P.lod, pts = ring(0), p2 = ring(1.4), n = pts.length, H = i => y + 3 + hmax * Math.pow(Math.abs(Math.sin(i / n * PI * 3)), 1.5);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.quad('c', [pts[i][0], H(i), pts[i][1]], [pts[j][0], H(j), pts[j][1]], [p2[j][0], H(j), p2[j][1]], [p2[i][0], H(i), p2[i][1]], null, C(c)); if (lod >= 2 && i % 2 === 0) trunk3(B, pts[i][0], pts[i][1], y, H(i), 0.18, [0.8, 0.8, 0.8]); else if (lod >= 1 && i % 4 === 0) trunk3(B, pts[i][0], pts[i][1], y, H(i), 0.2, [0.8, 0.8, 0.8]); }
  return y + 3 + hmax; }
// メリーゴーラウンド
function carousel(B, P, x, z, y, r, c) { B.cyl('c', x, z, r, y, y + 0.6, P.lod >= 2 ? 12 : 6, [0.85, 0.82, 0.75]); if (P.lod >= 2) B.cyl('c', x, z, 0.4, y + 0.6, y + 3.4, 6, [0.9, 0.85, 0.5], { notop: true }); B.cone('c', x, z, r * 1.1, y + 3.4, y + 5.2, P.lod >= 2 ? 12 : 6, C(c)); return y + 5.2; }
// 背の高いネット（ゴルフ練習場・バッティング）
function tallNet(B, P, Fx, y, h, c) { for (const e of Fx.edges) { B.wallE(T.net, e, y, y + h, c || W1, { uv: [0, e.L / 8, 0, h / 8] }); if (P.lod >= 1) for (let t = 0; t <= e.L; t += Math.max(15, e.L / 6)) { const q = onE(e, t, 0); trunk3(B, q[0], q[1], y, y + h + 0.5, 0.25, [0.78, 0.78, 0.76]); } } }

const KO = {};
// 広場
KO.plaza = { looks: [{ n: '石だたみの広場', gc: '#d3cec4', tr: 9 }, { n: 'れんがの舗装', gc: '#c99b86', tr: 10 }, { n: '芝生と木のデッキ', gc: '#d3cec4', lawn: 1, tr: 8 }, { n: '噴水のある広場', gc: '#dcd6ca', fount: 1, tr: 12 }],
  far: L => ({ top: L.lawn ? T.shiba : T.ishi, ct: C(L.gc) }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod; pad(B, P, F, Y, lod >= 1 ? (L.lawn ? T.shiba : T.ishi) : 'c', lod >= 1 ? (L.lawn ? W1 : C(L.gc)) : (L.lawn ? [0.45, 0.58, 0.36] : mul(C(L.gc), 0.9)), { su: L.lawn ? 10 : 4 });
    const W = fr.W, D = fr.D; if (L.lawn && lod >= 1) flatU(B, fr, 'c', W * 0.3, 1, W * 0.7, D - 1, Y + 0.03, [0.62, 0.48, 0.34]);
    if (lod >= 1 && (L.fount || W * D > 900)) { const q = fr.p(W / 2, D / 2), rr2 = cl(Math.min(W, D) * 0.12, 2.5, 9); B.cyl('c', q[0], q[1], rr2, Y, Y + 0.5, lod >= 2 ? 14 : 6, [0.82, 0.8, 0.76]); B.cyl('c', q[0], q[1], rr2 * 0.9, Y + 0.5, Y + 0.52, lod >= 2 ? 14 : 6, [0.55, 0.78, 0.88]); if (lod >= 2) { B.cyl('c', q[0], q[1], 0.5, Y + 0.5, Y + 2.2, 6, [0.82, 0.8, 0.76]); B.cone('c', q[0], q[1], rr2 * 0.3, Y + 2.2, Y + 3.4, 8, [0.85, 0.92, 0.96]); } }
    if (lod >= 2) { const nt = Math.min(24, Math.floor(Math.sqrt(W * D) / L.tr * 2)); for (let i = 0; i < nt; i++) { const t = (i + 0.5) / nt, per = 2 * (W + D) - 8, sp2 = t * per; let u, v; if (sp2 < W - 4) { u = 2 + sp2; v = 2; } else if (sp2 < W - 4 + D - 4) { u = W - 2; v = 2 + sp2 - (W - 4); } else if (sp2 < 2 * (W - 4) + D - 4) { u = W - 2 - (sp2 - (W - 4) - (D - 4)); v = D - 2; } else { u = 2; v = D - 2 - (sp2 - 2 * (W - 4) - (D - 4)); }
        const q = fr.p(u, v); if (B.nv - nv0 > BUD[2]) break; treeB(B, q[0], q[1], Y, 7, 2.8, A.pick(R, TCOL), R, lod); if (i % 3 === 0) { const q2 = fr.p(cl(u, 4, W - 4), cl(v, 4, D - 4)); bench(B, q2[0], q2[1], Y, fr.aU); lamp(B, q2[0] + 1.5, q2[1] + 1.5, Y); } } }
    else if (lod >= 1) grove(B, P, [A.rin(fr.r, 1)], [A.rin(fr.r, 6)], { sp: 10, h: [6, 9], y: Y, max: 4 }); } };
// 緑地
KO.ugreen = { looks: [{ n: '芝生と雑木林', fo: 0.8 }, { n: '池のある緑地', fo: 0.6, pond: 1 }, { n: '桜の並木', fo: 0.5, sak: 1 }, { n: '松林', fo: 0.9, pine: 1 }],
  far: () => ({ top: T.mori, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 }); const W = fr.W, D = fr.D, outs = [];
    if (L.pond && W > 25 && D > 25) { const q = fr.p(W * 0.55, D * 0.55); pondP(B, P, q[0], q[1], W * 0.22, D * 0.2, Y, R); outs.push([q[0] - W * 0.26, q[1] - D * 0.24, q[0] + W * 0.26, q[1] + D * 0.24]); }
    if (lod >= 1 && W > 15) { pathU(B, P, fr, W * 0.45, 0, W * 0.45 + 2.5, D, Y + 0.03); outs.push(fr.R(W * 0.45 - 1, 0, W * 0.45 + 3.5, D)); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: L.pine ? 6 : 7.5, k: L.fo * 1.3, h: [8, 15], y: Y, n: 0.15, p: L.pine ? 0.8 : 0.05, c: L.sak ? ['#e9b9c4', '#efc6cf', '#e3aebb'] : TCOL, max: 60, vmax: left(B, nv0, lod) }); } };
// 並木道
KO.uave = { looks: [{ n: 'いちょう並木', tc: ['#c9b648', '#bfae42', '#d1bd52'] }, { n: 'けやき並木', tc: ['#5f7d45', '#56743f', '#668449'] }, { n: '桜並木', tc: ['#e9b9c4', '#efc6cf', '#e3aebb'] }, { n: '松並木', pine: 1 }],
  far: () => ({ top: T.ishi, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    for (const r of F.rects) { const w = r[2] - r[0], d = r[3] - r[1], ax = w >= d, c = ax ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2, pw2 = Math.min(6, (ax ? d : w) * 0.35);
      B.flat(lod >= 1 ? T.ishi : 'c', ax ? [r[0], c - pw2 / 2, r[2], c + pw2 / 2] : [c - pw2 / 2, r[1], c + pw2 / 2, r[3]], Y + 0.03, lod >= 1 ? C('#d9d3c7') : [0.78, 0.76, 0.72], { su: 4 });
      if (lod < 1) continue; const L2 = ax ? w : d, nt = Math.max(1, Math.floor(L2 / (lod >= 2 ? 8 : 20)));
      for (let i = 0; i < nt; i++) for (const sg of [-1, 1]) { if (B.nv - nv0 > BUD[lod >= 2 ? 2 : 1]) break; const t = (ax ? r[0] : r[1]) + (i + 0.5) * L2 / nt, o = c + sg * (pw2 / 2 + 1.8), x = ax ? t : o, z = ax ? o : t;
        if (L.pine) pine(B, x, z, Y, 7, 3, R, lod); else treeB(B, x, z, Y, 11, 3.6, A.pick(R, L.tc), R, lod); if (lod >= 2 && i % 2 === 0) bench(B, ax ? t + 4 : c + sg * (pw2 / 2 - 0.4), ax ? c + sg * (pw2 / 2 - 0.4) : t + 4, Y, ax ? 0 : PI / 2); } } } };
// 日本庭園
KO.garden = { looks: [{ n: '池泉回遊式', pond: 1, br: 'red' }, { n: '枯山水', dry: 1 }, { n: '苔の庭', moss: 1, pond: 1, br: 'stone', momiji: 1 }, { n: '茶庭', tea: 1, pond: 1, br: 'stone' }],
  far: L => ({ top: L.dry ? T.jari : T.mori, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D;
    pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? (L.moss ? [0.62, 0.74, 0.5] : [0.78, 0.86, 0.68]) : [0.42, 0.52, 0.34], { su: 8, wm: T.ishigaki, wsu: 4 });
    const outs = [], q = fr.p(W * 0.5, D * 0.52);
    if (lod >= 1) { pathU(B, P, fr, W * 0.5 - 1.2, 0, W * 0.5 + 1.2, D * 0.2, Y + 0.03, '#d9d2c2'); pathU(B, P, fr, W * 0.12, D * 0.18, W * 0.88, D * 0.2 + 2.2, Y + 0.03, '#d9d2c2'); }
    if (L.dry) { const rd = A.rin(fr.R(0, D * 0.25, W, D), Math.min(W, D) * 0.12); karesansui(B, P, rd, Y + 0.03, R); outs.push(rd); if (lod >= 1) { const rh = fr.R(W * 0.25, D * 0.06, W * 0.75, Math.min(D * 0.16, 9)); B.top = Math.max(B.top, hut(B, P, rh, Y + 0.5, 3.2, T.tera, W1, '#5a5e62', 'hip')); } }
    let pts = null;
    if (L.pond) { pts = pondP(B, P, q[0], q[1], W * 0.26, D * 0.22, Y, R, [0.66, 0.82, 0.74], [0.55, 0.53, 0.48]); outs.push([q[0] - W * 0.3, q[1] - D * 0.26, q[0] + W * 0.3, q[1] + D * 0.26]);
      if (lod >= 1) { const a = pts[0], b = [q[0] + (q[0] - a[0]) * 0.1, q[1] + (q[1] - a[1]) * 0.1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L2 = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.6;
        if (L.br === 'red') { const ca = Math.cos(ang), sa = Math.sin(ang), pA = [mid[0] - ca * L2 / 2, Y + 0.4, mid[1] - sa * L2 / 2], pM = [mid[0], Y + 1.8, mid[1]], pB = [mid[0] + ca * L2 / 2, Y + 0.4, mid[1] + sa * L2 / 2]; beam(B, pA, pM, 2.2, 0.35, [0.72, 0.25, 0.18]); beam(B, pM, pB, 2.2, 0.35, [0.72, 0.25, 0.18]); }
        else B.obox('c', mid[0], mid[1], ang, L2, 1.4, Y, Y + 0.35, [0.62, 0.6, 0.56]); }
      if (lod >= 2) for (let i = 0; i < pts.length; i++) { if (i % 2 && R() < 0.5) continue; const p0 = pts[i], k = 1.18 + R() * 0.12, x = q[0] + (p0[0] - q[0]) * k, z = q[1] + (p0[1] - q[1]) * k;   // 刈りこみ（まるい低木）・石
        if (i % 3 === 0) blob(B, x, Y + 0.35, z, 0.8, 0.6, 0.3, '#8a867c', R, 5); else blob(B, x, Y + 0.7, z, 1.3 + R() * 0.6, 0.9, 0.6, A.pick(R, ['#4a6838', '#56743f', '#3f5f35']), R, 6); } }
    if (L.tea && lod >= 1) { const rt = fr.R(W * 0.72, D * 0.7, Math.min(W - 1.5, W * 0.72 + 6), Math.min(D - 1.5, D * 0.7 + 5)); B.top = Math.max(B.top, hut(B, P, rt, Y + 0.4, 2.5, T.ki, '#d8c29c', '#8c7a58', 'hip')); outs.push(A.rin(rt, -2)); if (lod >= 2) for (let i = 0; i < 8; i++) { const sq = fr.p(lerp(W * 0.5, W * 0.72, i / 8), lerp(D * 0.2, D * 0.7, i / 8)); B.cyl('c', sq[0], sq[1], 0.35, Y, Y + 0.12, 5, [0.6, 0.58, 0.54]); } }
    if (lod >= 2) { for (let i = 0; i < 4; i++) { const tq = fr.p(lerp(W * 0.15, W * 0.85, (i + 0.5) / 4), D * (i % 2 ? 0.26 : 0.84)); toro(B, tq[0], tq[1], Y, 1.8, C('#9e9a90'), lod); }
      const np = Math.min(6, Math.floor(Math.sqrt(W * D) / 8)); for (let i = 0; i < np; i++) { const tq = pts ? pts[(i * 3 + 1) % pts.length] : fr.p(W * (0.2 + 0.6 * R()), D * (0.3 + 0.6 * R())), x = pts ? q[0] + (tq[0] - q[0]) * 1.35 : tq[0], z = pts ? q[1] + (tq[1] - q[1]) * 1.35 : tq[1]; pine(B, x, z, Y, 5 + R() * 2.5, 2.6, R, lod); }
      if (L.momiji) for (let i = 0; i < 3; i++) { const tq = fr.p(W * (0.15 + 0.7 * R()), D * (0.75 + 0.2 * R())); treeB(B, tq[0], tq[1], Y, 6, 3, i ? '#8f6a3c' : '#9a4e36', R, lod); }
      for (const e of rfoot(A.rin(fr.r, 0.3)).edges) { if (e.L < 3) continue; const fd = e.nx * -fr.dv[0] + e.nz * -fr.dv[1]; if (fd > 0.9) { hedge(B, wallRect(e, 0, e.L / 2 - 2.5), Y, 1.6, '#4a6838'); hedge(B, wallRect(e, e.L / 2 + 2.5, e.L), Y, 1.6, '#4a6838'); } else hedge(B, wallRect(e, 0, e.L), Y, 1.6, '#4a6838'); } }
    grove(B, P, F.rects.map(r => A.rin(r, 2)), outs.concat([A.rin(fr.r, Math.min(W, D) * 0.2)]), { sp: 6, k: 1.3, h: [6, 11], y: Y, p: 0.3, n: 0.15, c: ['#5d7a40', '#6a8040', '#4d6c3a', '#587a3e'], max: 34, vmax: left(B, nv0, lod) }); } };
// 辺 e の from〜to の 内がわ 0.8 m の 長方形（生け垣など）
function wallRect(e, from, to) { const a = onE(e, from, 0), b = onE(e, to, 0), c = onE(e, to, -0.8); return [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])]; }
// 霊園
KO.cemetery = { looks: [{ n: '和型の墓石', g: 'jari' }, { n: '芝生の霊園', g: 'lawn' }, { n: '森の霊園', g: 'jari', fo: 1 }, { n: '石垣と墓地', g: 'jari', wall: 1 }],
  far: () => ({ top: T.jari, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? (L.g === 'lawn' ? T.shiba : T.tsuchi) : 'c', lod >= 1 ? (L.g === 'lawn' ? W1 : [0.82, 0.8, 0.72]) : [0.62, 0.62, 0.56], { su: 8, wm: T.ishigaki, wsu: 4 });
    const bw = 16, gap = 4, nb = Math.max(1, Math.floor((W - 4) / (bw + gap))), nd2 = Math.max(1, Math.floor((D - 6) / (bw + gap))), outs = [];
    for (let i = 0; i < nb; i++) for (let j = 0; j < nd2; j++) { if (B.nv - nv0 > BUD[lod >= 2 ? 2 : lod] * 0.75) break; const rb2 = fr.R(2 + i * (bw + gap), 4 + j * (bw + gap), 2 + i * (bw + gap) + bw, 4 + j * (bw + gap) + bw); if (L.g === 'lawn' && lod >= 1) { B.flat('c', A.rin(rb2, 0.5), Y + 0.01, [0.5, 0.62, 0.4]); } bochi(B, P, rb2, Y + 0.02); outs.push(rb2); }
    if (lod >= 1) { const rh = fr.R(W - 12, 0.5, W - 1, 7); hut(B, P, rh, Y, 3, T.tera, W1, '#5a5e62', 'hip'); outs.push(A.rin(rh, -2)); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: L.fo ? 6 : 10, k: L.fo ? 1.2 : 0.5, h: [8, 14], y: Y, n: 0.5, max: 30, vmax: left(B, nv0, lod) });
    if (L.wall && lod >= 2) for (const e of rfoot(A.rin(fr.r, -0.4)).edges) B.wallE(T.ishigaki, e, Y, Y + 1.4, W1, { uv: [0, e.L / 4, 0, 0.35] }); } };
// キャンプ場
KO.camp = { looks: [{ n: '林間サイト', g: 'forest', fo: 1.0 }, { n: '芝生のオートキャンプ', g: 'lawn', fo: 0.35, cars: 1 }, { n: '河原のサイト', g: 'gravel', fo: 0.4, river: 1 }, { n: 'バンガローの森', g: 'forest', fo: 0.9, cab: 1 }],
  far: L => ({ top: L.g === 'lawn' ? T.shiba : L.g === 'gravel' ? T.jari : T.mori, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? (L.g === 'lawn' ? T.shiba : L.g === 'gravel' ? T.jari : T.tsuchi) : (L.g === 'forest' ? T.mori : 'c'), lod >= 1 ? (L.g === 'forest' ? [0.72, 0.72, 0.56] : L.g === 'gravel' ? [0.86, 0.84, 0.78] : W1) : (L.g === 'forest' ? W1 : [0.5, 0.58, 0.4]), { su: 8 });
    const outs = [], rh = fr.R(2, 2, Math.min(W - 2, 16), Math.min(D - 2, 10)); B.top = Math.max(B.top, hut(B, P, rh, Y, 3.2, T.wood, '#ffffff', '#4a4642')); outs.push(A.rin(rh, -3));
    const rp = fr.R(18, 1.5, Math.min(W - 2, 40), Math.min(D - 2, 13)); if (rp[2] - rp[0] > 8) { parking(B, P, rp, Y + 0.01, R, { max: 6 }); outs.push(rp); }
    if (L.river && D > 30) { const rr2 = fr.R(0, D - 9, W, D - 2); B.flat(lod >= 1 ? T.mizu : 'c', rr2, Y + 0.03, lod >= 1 ? [0.8, 0.9, 0.9] : [0.4, 0.55, 0.6], { su: 10 }); outs.push(rr2); }
    if (lod >= 1) { const ns = lod >= 2 ? cl(Math.floor(W * D / 300), 4, 24) : 6, tc = ['#3d6d9a', '#d07a3a', '#5f8a4a', '#c9b24a', '#8a4a4a', '#e8e6e0']; let k = 0;
      for (let v = 16; v < D - 6 && k < ns; v += 11) for (let u = 6; u < W - 4 && k < ns; u += 12) { const q = fr.p(u + (R() - 0.5) * 3, v + (R() - 0.5) * 3); if (outs.some(o => q[0] > o[0] && q[0] < o[2] && q[1] > o[1] && q[1] < o[3])) continue;
        if (L.cab) hut(B, P, [q[0] - 2.2, q[1] - 2, q[0] + 2.2, q[1] + 2], Y + 0.3, 2.4, T.wood, '#ffffff', '#4a4642'); else tent(B, q[0], q[1], Y, fr.aU + R() * 0.6, A.pick(R, tc), 1 + R() * 0.3);
        if (lod >= 2 && L.cars) B.car(q[0] + 3.2, q[1] + 1, fr.aV, A.pick(R, CARC), Y); outs.push([q[0] - 3, q[1] - 3, q[0] + 3, q[1] + 3]); k++; } }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: L.g === 'forest' ? 6 : 10, k: L.fo * 1.3, h: [10, 18], y: Y, n: 0.45, max: 50, vmax: left(B, nv0, lod) }); } };
// 釣り堀
KO.fishing = { looks: [{ n: '屋根つきの釣り堀', roof: 1, rc: '#5a6a7a' }, { n: '池の釣り堀', np: 2 }, { n: '管理棟と 2 つの池', np: 2, roof: 1, rc: '#7a5a48' }, { n: '木かげの釣り堀', np: 1, fo: 1 }],
  far: () => ({ top: T.mizu, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.asph : 'c', lod >= 1 ? [0.85, 0.85, 0.85] : [0.5, 0.5, 0.5], { su: 8 });
    const np = L.np || 1, pw2 = (W - 6) / np, outs = [];
    for (let i = 0; i < np; i++) { const rr2 = fr.R(3 + i * pw2 + 1, 8, 3 + (i + 1) * pw2 - 1, D - 3); B.box('c', rr2[0], rr2[1], rr2[2], rr2[3], Y, Y + 0.4, [0.75, 0.74, 0.7]); B.flat(lod >= 1 ? T.mizu : 'c', A.rin(rr2, 0.6), Y + 0.42, lod >= 1 ? [0.65, 0.78, 0.7] : [0.38, 0.5, 0.48], { su: 10 }); outs.push(A.rin(rr2, -1));
      if (L.roof && lod >= 1) { const e = rfoot(rr2).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) { B.ledge(e, Y + 2.6, Y + 2.8, -3, C(L.rc)); if (lod >= 2) for (let t = 1; t < e.L; t += 4) { const q = onE(e, t, -2.8); post(B, q[0] - 0.08, q[1] - 0.08, q[0] + 0.08, q[1] + 0.08, Y + 0.4, Y + 2.6, [0.6, 0.6, 0.6]); } } } }
    if (lod >= 1) { B.top = Math.max(B.top, hut(B, P, fr.R(2, 1, Math.min(W - 2, 12), 6.5), Y, 3, T.siding, '#f0ede6', '#5a5e62')); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: 8, k: L.fo ? 1 : 0.4, h: [7, 12], y: Y, max: 16, vmax: left(B, nv0, lod, 0.6) }); } };
// 動物園
KO.zoo = { looks: [{ n: '緑の多い動物園', fo: 1 }, { n: '岩山のある園', rock: 1, fo: 0.6 }, { n: '水辺の動物園', water: 1, fo: 0.7 }, { n: '屋根の多い園', houses: 1, fo: 0.6 }],
  far: () => ({ top: T.mori, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    const outs = []; if (lod >= 1) { pathU(B, P, fr, W / 2 - 2.5, 0, W / 2 + 2.5, D - 2, Y + 0.03); pathU(B, P, fr, 3, D * 0.5 - 2, W - 3, D * 0.5 + 2, Y + 0.03); }
    outs.push(fr.R(W / 2 - 3.5, 0, W / 2 + 3.5, D), fr.R(0, D * 0.5 - 3, W, D * 0.5 + 3));
    const gu = [[4, W / 2 - 5], [W / 2 + 5, W - 4]], gv = [[6, D * 0.5 - 5], [D * 0.5 + 5, D - 4]]; let k = 0;
    for (const [u0, u1] of gu) for (const [v0, v1] of gv) { if (u1 - u0 < 8 || v1 - v0 < 8) continue; const re = fr.R(u0, v0, u1, v1), kind = (k + (L.rock ? 1 : 0)) % 4;
      B.flat(lod >= 1 ? (kind === 1 ? T.tsuchi : kind === 2 ? T.jari : T.shiba) : 'c', A.rin(re, 0.5), Y + 0.02, lod >= 1 ? (kind === 0 ? [0.85, 0.95, 0.75] : W1) : [0.55, 0.55, 0.42], { su: 8 });
      if (lod >= 2) fenceF(B, rfoot(re), Y, 1.8, [0.45, 0.5, 0.45], T.fence);
      const c = [(re[0] + re[2]) / 2, (re[1] + re[3]) / 2];
      if ((kind === 2 || L.water) && lod >= 1) pondP(B, P, c[0], c[1], (re[2] - re[0]) * 0.25, (re[3] - re[1]) * 0.22, Y + 0.02, R);
      if ((kind === 1 || L.rock) && lod >= 1) blob(B, c[0] + 3, Y + 1.5, c[1] - 2, Math.min(5, (re[2] - re[0]) * 0.2), 3.2, 1.5, '#8f8a7e', R, 6);
      if ((L.houses || k % 2 === 0) && lod >= 1) hut(B, P, [re[2] - 8, re[1] + 1, re[2] - 1, re[1] + 6], Y, 3.4, T.wood, '#e8dcc6', '#5a6a5a');
      outs.push(A.rin(re, 2)); k++; }
    if (lod >= 1) { const rg = fr.R(W / 2 - 9, 0.5, W / 2 + 9, 5); B.top = Math.max(B.top, hut(B, P, rg, Y, 3.6, T.wood, '#ffffff', '#4f6a5a')); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: 7, k: L.fo * 1.2, h: [8, 15], y: Y, max: 40, vmax: left(B, nv0, lod) }); } };
// 植物園
KO.botanical = { looks: [{ n: 'ドームの温室', gh: 'dome' }, { n: '長い温室', gh: 'barrel' }, { n: '花畑と温室', gh: 'gable', fl: 1 }, { n: '池と温室', gh: 'dome', pond: 1 }],
  far: () => ({ top: T.shiba, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    const outs = [], gw = cl(W * 0.35, 16, 50), gd = cl(D * 0.3, 12, 36), rg = fr.R(W / 2 - gw / 2, D * 0.55, W / 2 + gw / 2, D * 0.55 + gd);
    B.facade(lod >= 1 ? T.green : 'c', rfoot(rg), Y, Y + 5, { bw: 3, fh: 2.5, tb: 8, tf: 4, vy: Y, c: lod >= 1 ? W1 : [0.7, 0.82, 0.85] });
    if (L.gh === 'dome') { B.dome(lod >= 1 ? T.green : 'c', (rg[0] + rg[2]) / 2, (rg[1] + rg[3]) / 2, (rg[2] - rg[0]) / 2, (rg[3] - rg[1]) / 2, Y + 5, Math.min(gw, gd) * 0.45, lod >= 2 ? 16 : 8, lod >= 1 ? W1 : [0.75, 0.85, 0.88], { rings: lod >= 2 ? 4 : 2, su: 6 }); B.top = Math.max(B.top, Y + 5 + Math.min(gw, gd) * 0.45); }
    else B.top = Math.max(B.top, B.roof({ t: lod >= 1 ? L.gh : 'gable', r: rg, y: Y + 5, p: L.gh === 'barrel' && lod >= 1 ? 0.25 : 0.5, oh: 0.2, m: lod >= 1 ? T.green : 'c', c: lod >= 1 ? W1 : [0.75, 0.85, 0.88], su: 4, mg: lod >= 1 ? T.green : 'c', cg: W1, gsu: 3, gsv: 2.5, th: 0 }));
    outs.push(A.rin(rg, -3));
    if (lod >= 1) { pathU(B, P, fr, W / 2 - 2, 0, W / 2 + 2, D * 0.55, Y + 0.03); outs.push(fr.R(W / 2 - 3, 0, W / 2 + 3, D * 0.55)); }
    if (lod >= 1) { const nb = L.fl ? 6 : 3; for (let i = 0; i < nb; i++) { const sg = i % 2 ? 1 : -1, rf2 = fr.R(sg < 0 ? Math.max(3, W / 2 - 5 - (W * 0.3)) : W / 2 + 5, 4 + Math.floor(i / 2) * (D * 0.5 / Math.ceil(nb / 2)), sg < 0 ? W / 2 - 5 : Math.min(W - 3, W / 2 + 5 + W * 0.3), 4 + (Math.floor(i / 2) + 0.7) * (D * 0.5 / Math.ceil(nb / 2))); flowers(B, P, rf2, Y + 0.03, R, lod >= 2 ? 8 : 3); outs.push(rf2); } }
    if (L.pond && D > 40) { const q = fr.p(W * 0.8, D * 0.3); pondP(B, P, q[0], q[1], W * 0.12, D * 0.12, Y, R); outs.push([q[0] - W * 0.15, q[1] - D * 0.15, q[0] + W * 0.15, q[1] + D * 0.15]); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: 9, k: 0.8, h: [7, 14], y: Y, max: 30, vmax: left(B, nv0, lod) }); } };
// ゴルフ場
KO.golf = { looks: [{ n: '林間コース', fo: 1.1 }, { n: '丘陵コース', fo: 0.7 }, { n: '池の多いコース', fo: 0.7, ponds: 3 }, { n: '海辺のリンクス', fo: 0.25, pine: 1 }],
  far: () => ({ top: T.shiba, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? [0.82, 0.9, 0.74] : [0.42, 0.55, 0.33], { su: 12 });
    const outs = [], nh = cl(Math.round(Math.sqrt(W * D) / 90), 2, 9);
    for (let i = 0; i < nh; i++) { const u = lerp(W * 0.12, W * 0.88, (i % 3 + 0.5) / 3), v0 = lerp(D * 0.1, D * 0.85, Math.floor(i / 3) / Math.max(1, Math.ceil(nh / 3))), v1 = Math.min(D - 8, v0 + D * 0.7 / Math.max(1, Math.ceil(nh / 3)));
      const wf = cl(W * 0.08, 18, 32), rf2 = fr.R(u - wf / 2, v0, u + wf / 2, v1); B.flat(lod >= 1 ? T.shiba : 'c', rf2, Y + 0.02, lod >= 1 ? [1.05, 1.12, 0.95] : [0.5, 0.66, 0.4], { su: 10 }); outs.push(A.rin(rf2, -4));
      const g = fr.p(u, v1 - 6); if (lod >= 1) { disc(B, g[0], g[1], Y + 0.05, 7, lod >= 2 ? 10 : 6, [0.5, 0.7, 0.42]); disc(B, g[0] + 8, g[1] + 3, Y + 0.06, 3, 6, [0.92, 0.86, 0.68]); if (lod >= 2) { trunk3(B, g[0], g[1], Y, Y + 2.2, 0.03, [0.95, 0.95, 0.95]); B.wall('c', g[0], g[1], g[0] + 0.5, g[1], Y + 1.8, Y + 2.2, [0.85, 0.25, 0.2]); } } }
    for (let k = 0; k < (L.ponds || 1); k++) { const q = fr.p(W * (0.3 + 0.4 * R()), D * (0.3 + 0.4 * R())); pondP(B, P, q[0], q[1], W * 0.06, D * 0.05, Y, R); }
    if (lod >= 1) { const rc2 = fr.R(W / 2 - 15, 2, W / 2 + 15, 14); B.top = Math.max(B.top, rcBlock(B, P, rfoot(rc2), 2, { fm: T.ribbon, tb: 4, tf: 2, bw: 3.6, fh: 3.8, g1: 4.2, base: Y, wc: C('#f1efe9'), roof: 'hip', rm: T.kawara, p: 0.32, oh: 1.2, onpad: 1 })); outs.push(A.rin(rc2, -6)); parking(B, P, fr.R(W / 2 + 18, 2, Math.min(W - 2, W / 2 + 50), 16), Y + 0.02, R, { max: 10 }); }
    grove(B, P, F.rects.map(r => A.rin(r, 2)), outs, { sp: 8, k: L.fo * 1.4, h: [10, 17], y: Y, n: 0.4, p: L.pine ? 0.7 : 0.05, max: 70, vmax: left(B, nv0, lod) }); } };
// ゴルフ練習場
KO.golfrange = { looks: [{ n: '緑のネット', nc: [0.55, 0.72, 0.55] }, { n: '白いネット', nc: W1 }, { n: '2 階打席・青い屋根', nc: [0.6, 0.72, 0.7], two: 1, rc: '#4f6d8a' }, { n: '屋根つき打席', nc: [0.7, 0.75, 0.72], rc: '#7a5a48' }],
  far: () => ({ top: T.shiba, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    const bd = 10, rb = fr.R(2, 1, W - 2, 1 + bd), Fb = rfoot(rb), nf = L.two ? 2 : 1, hb = nf * 3.6;
    B.facade(lod >= 1 ? T.alc : 'c', Fb, Y, Y + hb, { bw: 3.6, fh: 3.6, tb: 4, tf: 4, vy: Y, c: [0.94, 0.94, 0.92] }); B.top = Math.max(B.top, B.roof({ t: 'shed', r: rb, y: Y + hb, ax: fr.ax('u'), p: 0.12, oh: 1.2, m: lod >= 1 ? T.kane : 'c', c: C(L.rc || '#5f7487'), su: 3, mg: T.alc, cg: [0.94, 0.94, 0.92], gsu: 14, gsv: 14, th: 0, hi: fr.sd === 'S' || fr.sd === 'E' ? '+' : '-' }));
    if (lod >= 1) { const Fn = rfoot(fr.R(2, 1 + bd, W - 2, D - 2)); tallNet(B, P, Fn, Y, cl(D * 0.12, 18, 40), L.nc); B.top = Math.max(B.top, Y + cl(D * 0.12, 18, 40)); }
    if (lod >= 2) for (let i = 1; i < 5; i++) { const q = fr.p(W * (0.3 + 0.4 * R()), 1 + bd + (D - bd) * i / 5); disc(B, q[0], q[1], Y + 0.04, 3, 8, [0.9, 0.9, 0.86]); } } };
// テニスコート
KO.tennis = { looks: [{ n: '緑の人工芝', cc: W1 }, { n: '青いハードコート', cc: [0.62, 0.78, 1.15] }, { n: '赤土のクレー', cc: [1.45, 0.95, 0.7] }, { n: '夜間照明つき', cc: W1, lights: 1 }],
  far: () => ({ top: T.court, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod; pad(B, P, F, Y, lod >= 1 ? T.asph : 'c', lod >= 1 ? [0.8, 0.85, 0.8] : [0.4, 0.5, 0.42], { su: 8 });
    for (const r of F.rects) { const rr2 = A.rin(r, 1), w = rr2[2] - rr2[0], d = rr2[3] - rr2[1], ax = w < d, cw = 18, cd = 36, nx = Math.max(1, Math.floor((ax ? w : d) / cw)), nz = Math.max(1, Math.floor((ax ? d : w) / cd));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { if (B.nv - nv0 > BUD[lod >= 2 ? 2 : lod]) break; const u0 = (ax ? rr2[0] : rr2[1]) + i * cw, v0 = (ax ? rr2[1] : rr2[0]) + j * cd, rc2 = ax ? [u0, v0, u0 + cw, v0 + cd] : [v0, u0, v0 + cd, u0 + cw];
        if (ax) B.flat(lod >= 1 ? T.court : 'c', rc2, Y + 0.02, lod >= 1 ? L.cc : [0.35, 0.5, 0.4], { su: 0 }); else B.quad(lod >= 1 ? T.court : 'c', [rc2[0], Y + 0.02, rc2[3]], [rc2[2], Y + 0.02, rc2[3]], [rc2[2], Y + 0.02, rc2[1]], [rc2[0], Y + 0.02, rc2[1]], [0, 1, 0], lod >= 1 ? L.cc : [0.35, 0.5, 0.4], [0, 0, 0, 1, 1, 1, 1, 0]);
        if (ax && lod >= 1) B.quad(T.court, [rc2[0], Y + 0.02, rc2[3]], [rc2[2], Y + 0.02, rc2[3]], [rc2[2], Y + 0.02, rc2[1]], [rc2[0], Y + 0.02, rc2[1]], [0, 1, 0], L.cc, [0, 0, 1, 0, 1, 1, 0, 1]);
        if (lod >= 2) fenceF(B, rfoot(rc2), Y, 3.2, [0.4, 0.55, 0.45]); if (L.lights && lod >= 1) { lightTower(B, rc2[0] + 0.5, rc2[1] + 0.5, Y, 10, lod); lightTower(B, rc2[2] - 0.5, rc2[3] - 0.5, Y, 10, lod); } } } } };
// グラウンド
KO.ufield = { looks: [{ n: '土のグラウンド', g: 'dirt' }, { n: '芝のグラウンド', g: 'lawn' }, { n: '野球のグラウンド', g: 'dirt', base: 1 }, { n: '多目的グラウンド', g: 'dirt', goals: 1 }],
  far: L => ({ top: L.g === 'lawn' ? T.shiba : T.tsuchi, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? (L.g === 'lawn' ? T.shiba : T.tsuchi) : 'c', lod >= 1 ? (L.g === 'lawn' ? W1 : [0.95, 0.9, 0.8]) : (L.g === 'lawn' ? [0.45, 0.58, 0.36] : [0.7, 0.62, 0.5]), { su: 10 });
    if (lod >= 2) { if (L.base) { const q0 = fr.p(2, D - 2), q1 = fr.p(12, D - 2); B.wall(T.net, q0[0], q0[1], q1[0], q1[1], Y, Y + 8, W1, [0, 4, 0, 4]); const a = fr.p(6, D - 6), b = fr.p(6 + Math.min(W, D) * 0.6, D - 6), c2 = fr.p(6, D - 6 - Math.min(W, D) * 0.6); line(B, a, b, Y + 0.04, 0.15); line(B, a, c2, Y + 0.04, 0.15); }
      if (L.goals || !L.base) { const q = fr.p(W / 2, 3), q2 = fr.p(W / 2, D - 3); goal(B, q[0], q[1], Y, fr.aU); goal(B, q2[0], q2[1], Y, fr.aU); trackLines(B, P, A.rin(fr.r, 4), Y + 0.04); }
      fenceF(B, rfoot(A.rin(fr.r, -0.6)), Y, 2.4, [0.5, 0.62, 0.52]); for (let i = 0; i < 4; i++) { const q = fr.p(1.5, 4 + i * 3); bench(B, q[0], q[1], Y, fr.aV); } }
    grove(B, P, [fr.R(0, 0, 3, D), fr.R(W - 3, 0, W, D)], [], { sp: 7, k: 0.6, h: [7, 11], y: Y, max: 10, vmax: left(B, nv0, lod, 0.5) }); } };
// 自動車教習所
KO.driving = { looks: [{ n: '白い校舎', wc: '#f3f2ee' }, { n: 'ベージュの校舎', wc: '#e6d6ba' }, { n: 'ガラスの校舎', wc: '#d5dade', glass: 1 }, { n: 'れんが色の校舎', wc: '#b88470' }],
  far: () => ({ top: T.asph, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    const rb = fr.R(2, 1, Math.min(W - 2, 30), 13); B.top = Math.max(B.top, rcBlock(B, P, rfoot(rb), 3, { fm: L.glass ? T.curtain : T.ribbon, tb: 4, tf: L.glass ? 4 : 2, bw: 3.6, fh: 3.6, g1: 4, base: Y, wc: C(L.wc), roof: 'flat', par: 0.8, onpad: 1 }));
    // コース：外まわり・十字路・S字
    const rw = 7, cr = A.rin(fr.R(2, 16, W - 2, D - 2), 1), m = lod >= 1 ? T.asph : 'c', ac = lod >= 1 ? W1 : [0.42, 0.43, 0.44];
    const fl2 = (r) => B.flat(m, r, Y + 0.03, ac, { su: 8 });
    fl2([cr[0], cr[1], cr[2], cr[1] + rw]); fl2([cr[0], cr[3] - rw, cr[2], cr[3]]); fl2([cr[0], cr[1], cr[0] + rw, cr[3]]); fl2([cr[2] - rw, cr[1], cr[2], cr[3]]);
    const cx = (cr[0] + cr[2]) / 2, cz = (cr[1] + cr[3]) / 2; fl2([cx - rw / 2, cr[1], cx + rw / 2, cr[3]]); fl2([cr[0], cz - rw / 2, cr[2], cz + rw / 2]);
    if (lod >= 2) { for (const [a, b] of [[[cr[0] + rw / 2, cr[1] + rw / 2], [cr[2] - rw / 2, cr[1] + rw / 2]], [[cr[0] + rw / 2, cr[3] - rw / 2], [cr[2] - rw / 2, cr[3] - rw / 2]], [[cx, cr[1] + rw], [cx, cz - rw / 2]], [[cx, cz + rw / 2], [cx, cr[3] - rw]]]) line(B, a, b, Y + 0.05, 0.15);
      for (let i = 0; i < 5; i++) { const t = R(), q = [lerp(cr[0] + 3, cr[2] - 3, t), R() < 0.5 ? cr[1] + rw / 2 : cr[3] - rw / 2]; B.car(q[0], q[1], 0, A.pick(R, ['#e9e9e6', '#e9e9e6', '#d8d2c0']), Y + 0.03); }
      for (const q of [[cx - rw / 2 - 0.6, cz - rw / 2 - 0.6], [cx + rw / 2 + 0.6, cz + rw / 2 + 0.6]]) { trunk3(B, q[0], q[1], Y, Y + 4.2, 0.08, [0.5, 0.5, 0.5]); B.box('c', q[0] - 0.2, q[1] - 0.5, q[0] + 0.2, q[1] + 0.5, Y + 4.2, Y + 4.6, [0.25, 0.27, 0.28]); } }
    grove(B, P, [fr.R(0, 0, W, 1.5), fr.R(0, D - 1.5, W, D)], [], { sp: 8, k: 0.5, h: [6, 9], y: Y, max: 12, vmax: left(B, nv0, lod, 0.4) }); } };
// バッティングセンター（建物あり）
KO.batting = { looks: [{ n: '緑のネット', nc: [0.55, 0.72, 0.55], rc: '#5f7487' }, { n: '白いネット', nc: W1, rc: '#7a5a48' }, { n: '屋根つきの打席', nc: [0.65, 0.72, 0.7], rc: '#4f5458', roof: 1 }, { n: '青い屋根の建物', nc: [0.7, 0.74, 0.72], rc: '#4f6d8a' }],
  far: () => ({ H: 4, base: 0.1, wall: T.alc, bw: 3.6, fh: 3.6, tb: 4, tf: 4, top: T.shiba }),
  build(B, L, P, F, fr, R, Y) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, lod >= 1 ? T.asph : 'c', lod >= 1 ? [0.85, 0.88, 0.85] : [0.45, 0.5, 0.45], { su: 8 });
    const rb = fr.R(1, 1, W - 1, 9); B.facade(lod >= 1 ? T.g1s : 'c', rfoot(rb), Y, Y + 4.2, { bw: 3.6, fh: 4.2, tb: 4, tf: 1, vy: Y, c: [0.95, 0.95, 0.93] });
    B.cap(lod >= 1 ? T.flat : 'c', rfoot(rb), Y + 4.2, W1, { su: 8 }); if (lod >= 1) { const e = rfoot(rb).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9); if (e) signE(B, e, 1, e.L - 1, 3.0, 4.0, SG.green, 0.12); }
    const rn = fr.R(1, 9, W - 1, D - 1); if (lod >= 1) { tallNet(B, P, rfoot(rn), Y, 12, L.nc); const nb = Math.min(12, Math.floor((W - 2) / 3.2)); for (let i = 0; i < nb && lod >= 2; i++) { const a = fr.p(1 + i * (W - 2) / nb, 9), b = fr.p(1 + i * (W - 2) / nb, 13); B.wall(T.net, a[0], a[1], b[0], b[1], Y, Y + 3, W1, [0, 0.5, 0, 0.4]); } if (L.roof) { const rr2 = fr.R(1, 9, W - 1, 14); B.flat('c', rr2, Y + 3.4, C(L.rc)); } }
    B.top = Math.max(B.top, Y + 12); } };
// スキー場
KO.ski = { looks: [{ n: '林の中のゲレンデ', fo: 1.1 }, { n: '広いゲレンデ', fo: 0.4 }, { n: '赤い屋根のロッジ', fo: 0.8, rc: '#9a4a3a' }, { n: 'リフトの多い山', fo: 0.7, lifts: 3 }],
  far: () => ({ top: null, ct: [0.94, 0.95, 0.97] }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D; pad(B, P, F, Y, 'c', [0.93, 0.94, 0.96], {});
    const outs = [], nr = cl(Math.round(W / 60), 1, 5);
    for (let i = 0; i < nr; i++) { const u = (i + 0.5) * W / nr, rw2 = cl(W / nr * 0.45, 12, 40); flatU(B, fr, 'c', u - rw2 / 2, 14, u + rw2 / 2, D - 3, Y + 0.02, [0.98, 0.98, 0.99]); outs.push(fr.R(u - rw2 / 2, 0, u + rw2 / 2, D)); }
    const rl = fr.R(W / 2 - 12, 2, W / 2 + 12, 12); B.top = Math.max(B.top, hut(B, P, rl, Y, 6, T.wood, '#ffffff', L.rc || '#4a4642')); outs.push(A.rin(rl, -2));
    if (lod >= 1) { parking(B, P, fr.R(W / 2 + 15, 1, Math.min(W - 1, W / 2 + 45), 13), Y + 0.01, R, { max: 8 }); const nl = L.lifts || 1;
      for (let k = 0; k < nl; k++) { const u = (k + 0.5) * W / nl + 6, a = fr.p(u, 14), b = fr.p(u, D - 4), ns = lod >= 2 ? 6 : 3; for (let i = 0; i <= ns; i++) { const q = [lerp(a[0], b[0], i / ns), lerp(a[1], b[1], i / ns)]; trunk3(B, q[0], q[1], Y, Y + 9, 0.25, [0.55, 0.56, 0.58]); if (lod >= 2) B.obox('c', q[0], q[1], fr.aU, 3, 0.3, Y + 9, Y + 9.3, [0.55, 0.56, 0.58]); }
        if (lod >= 2) for (const sg of [-1, 1]) { const du = [fr.du[0] * 1.4 * sg, fr.du[1] * 1.4 * sg]; line3(B, [a[0] + du[0], Y + 8.9, a[1] + du[1]], [b[0] + du[0], Y + 8.9, b[1] + du[1]], 0.08, [0.2, 0.2, 0.2]); } } }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: 7, k: L.fo * 1.4, h: [9, 16], y: Y, n: 0.9, c: ['#3c5838'], max: 60, vmax: left(B, nv0, lod) }); } };
const line3 = (B, a, b, wd, c) => { B.quad('c', [a[0], a[1] - wd, a[2]], [b[0], b[1] - wd, b[2]], [b[0], b[1] + wd, b[2]], [a[0], a[1] + wd, a[2]], null, c); };
// 遊園地・テーマパーク
const amuseC = [['#d9a7a0', '#a9c8d9', '#e6d39a', '#b7d4a6'], ['#c0504a', '#4a78a8', '#e0b040', '#5a9a5a'], ['#f2f2ee', '#6a90b8', '#b9d0e0', '#e8e4da'], ['#a8443a', '#e8e0cc', '#3f6a5a', '#d9b066']];
KO.amuse = { looks: [{ n: 'パステルの遊園地', cs: 0 }, { n: 'あざやかな遊園地', cs: 1 }, { n: '白と青の遊園地', cs: 2 }, { n: 'レトロな遊園地', cs: 3 }],
  far: () => ({ top: T.ishi, ct: null }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D, cs = amuseC[L.cs], big = !!P.ko.big; pad(B, P, F, Y, lod >= 1 ? T.ishi : 'c', lod >= 1 ? [0.9, 0.86, 0.8] : [0.72, 0.7, 0.66], { su: 4 });
    const outs = [];
    if (big && W > 150) { const q = fr.p(W * 0.5, D * 0.55); pondP(B, P, q[0], q[1], W * 0.16, D * 0.14, Y, R, [0.7, 0.88, 0.95]); outs.push([q[0] - W * 0.18, q[1] - D * 0.16, q[0] + W * 0.18, q[1] + D * 0.16]); }
    // 観覧車・コースター・メリーゴーラウンド
    const wr = cl(Math.min(W, D) * 0.12, 15, 45), wq = fr.p(W * 0.78, D * 0.3); B.top = Math.max(B.top, wheel(B, P, wq[0], wq[1], Y, wr, fr.aU + 0.3, cs)); outs.push([wq[0] - wr, wq[1] - wr * 0.4, wq[0] + wr, wq[1] + wr * 0.4]);
    if (lod >= 1) { const cc = [(fr.p(W * 0.3, D * 0.6))[0], (fr.p(W * 0.3, D * 0.6))[1]], rg = stadRing(cc[0], cc[1], Math.min(W, D) * 0.14, Math.min(W, D) * 0.1, fr.uX, lod >= 2 ? 6 : 3, lod >= 2 ? 10 : 5); B.top = Math.max(B.top, coaster(B, P, rg, Y, cs[1], cl(Math.min(W, D) * 0.12, 10, 40))); }
    const n2 = lod >= 2 ? (big ? 6 : 3) : lod >= 1 ? 1 : 0; for (let i = 0; i < n2; i++) { const q = fr.p(W * (0.2 + 0.6 * R()), D * (0.15 + 0.7 * R())); B.top = Math.max(B.top, carousel(B, P, q[0], q[1], Y, 5 + R() * 3, A.pick(R, cs))); }
    // 売店・建物
    if (lod >= 1) { const nk = lod >= 2 ? (big ? 14 : 7) : 3; for (let i = 0; i < nk; i++) { if (B.nv - nv0 > BUD[lod >= 2 ? 2 : 1] * 0.85) break; const q = fr.p(W * (0.08 + 0.84 * R()), D * (0.08 + 0.84 * R())), s2 = 3 + R() * (big ? 9 : 4), rh = [q[0] - s2, q[1] - s2 * 0.7, q[0] + s2, q[1] + s2 * 0.7];
      if (outs.some(o => q[0] > o[0] && q[0] < o[2] && q[1] > o[1] && q[1] < o[3])) continue; hut(B, P, rh, Y, 3 + R() * (big ? 6 : 2), T.siding, A.pick(R, cs), A.pick(R, cs), R() < 0.5 ? 'gable' : 'pyramid'); } }
    if (big && lod >= 1) { const q = fr.p(W * 0.5, D * 0.85), tw = 8; B.facade(T.stone, rfoot([q[0] - tw, q[1] - tw, q[0] + tw, q[1] + tw]), Y, Y + 30, { bw: 3.6, fh: 3.6, tb: 4, tf: 2, vy: Y, c: C(cs[2]) }); B.roof({ t: 'pyramid', r: [q[0] - tw, q[1] - tw, q[0] + tw, q[1] + tw], y: Y + 30, p: 2, oh: 0.5, m: T.kane, c: C(cs[1]), su: 3, th: 0 }); B.top = Math.max(B.top, Y + 46); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: 10, k: 0.5, h: [6, 10], y: Y, max: 24, vmax: left(B, nv0, lod) }); } };
// ウォーターパーク・ビーチクラブ
KO.aquapark = { looks: [{ n: '青いプールと滑り台', sl: ['#d0503a', '#e0b040', '#4a78a8'] }, { n: '白い建物と流れるプール', sl: ['#4a9ab0', '#e8e4da', '#5aaa7a'] }, { n: '南国風', sl: ['#e07a3a', '#5aaa7a', '#e0c040'], palm: 1 }, { n: '屋根つきの大きなプール', sl: ['#8a6aa8', '#4a78a8', '#e0e0d8'], roof: 1 }],
  far: () => ({ H: 2, base: 0.1, wall: 'c', top: T.mizu }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D, n = Math.max(1, P.f); pad(B, P, F, Y, lod >= 1 ? T.ishi : 'c', lod >= 1 ? [0.92, 0.9, 0.86] : [0.75, 0.74, 0.7], { su: 4 });
    const rb = fr.R(2, 1, Math.min(W - 2, W * 0.4 + 10), 14); B.top = Math.max(B.top, rcBlock(B, P, rfoot(rb), n, { fm: T.ribbon, tb: 4, tf: 2, bw: 3.6, fh: 4, g1: 4.5, base: Y, wc: C('#f4f3ef'), roof: 'flat', par: 0.8, onpad: 1 }));
    const np = lod >= 2 ? 4 : 2, outs = [A.rin(rb, -2)];
    for (let i = 0; i < np; i++) { const q = fr.p(W * (0.25 + 0.5 * (i % 2)), D * (0.35 + 0.35 * Math.floor(i / 2))), rx = W * 0.16, rz = D * 0.12; pondP(B, P, q[0], q[1], rx, rz, Y, R, [0.55, 0.85, 0.98], [0.9, 0.9, 0.86]); outs.push([q[0] - rx, q[1] - rz, q[0] + rx, q[1] + rz]); }
    if (lod >= 1) { const ns = lod >= 2 ? 3 : 1, nseg = lod >= 2 ? 6 : 3; for (let k = 0; k < ns; k++) { const a = fr.p(W * (0.7 + 0.08 * k), D * 0.25), h0 = 14 - k * 3; trunk3(B, a[0], a[1], Y, Y + h0, 0.6, [0.8, 0.8, 0.78]); let pr = [a[0], Y + h0, a[1]];
      for (let i = 1; i <= nseg; i++) { const t = i / nseg, ang = t * PI * 1.4 + k, rr3 = 6 + k * 2, q = [a[0] + Math.cos(ang) * rr3 * t - fr.dv[0] * t * 14, Y + h0 * (1 - t) + 0.5, a[1] + Math.sin(ang) * rr3 * t - fr.dv[1] * t * 14]; beam(B, pr, q, 1.3, 0.5, C(L.sl[k % 3])); pr = q; } } B.top = Math.max(B.top, Y + 15); }
    if (L.roof && lod >= 1) { const r2 = fr.R(W * 0.1, D * 0.55, W * 0.6, D * 0.95); B.facade(T.green, rfoot(r2), Y, Y + 6, { bw: 3, fh: 3, tb: 8, tf: 4, vy: Y, c: W1 }); B.roof({ t: 'barrel', r: r2, y: Y + 6, p: 0.2, oh: 0.3, m: T.green, c: W1, su: 4, mg: T.green, cg: W1, gsu: 6, gsv: 3, th: 0 }); outs.push(r2); }
    if (lod >= 2) for (let i = 0; i < 8; i++) { const q = fr.p(W * (0.1 + 0.8 * R()), D * (0.2 + 0.7 * R())); if (outs.some(o => q[0] > o[0] && q[0] < o[2] && q[1] > o[1] && q[1] < o[3])) continue; trunk3(B, q[0], q[1], Y, Y + 2.3, 0.04, [0.8, 0.8, 0.78]); B.cone('c', q[0], q[1], 1.4, Y + 2.0, Y + 2.6, 6, C(A.pick(R, L.sl))); }
    grove(B, P, F.rects.map(r => A.rin(r, 1)), outs, { sp: 9, k: 0.4, h: [6, 9], y: Y, p: L.palm ? 0.5 : 0, max: 16, vmax: left(B, nv0, lod, 0.7) }); } };
KO.beachclub = { looks: [{ n: '白い建物・テラス', wc: '#f6f5f1', pc: ['#e8e4da', '#4a78a8'] }, { n: '木のデッキ・ヤシ', wc: '#e2c9a2', pc: ['#d0703a', '#e8e4da'], palm: 1 }, { n: '青い屋根・プール', wc: '#f2f2ee', pc: ['#4a90b8', '#e8e4da'], pool: 1, rc: '#4f6d8a' }, { n: 'ガラスのラウンジ', wc: W1, pc: ['#e0e0d8', '#5a5a5a'], glass: 1 }],
  far: L => ({ H: 7, base: 0.2, wall: L.glass ? T.curtain : T.ribbon, bw: 3.6, fh: 3.6, tb: 4, tf: L.glass ? 4 : 2, wc: C(L.wc), top: null, ct: [0.86, 0.82, 0.72] }),
  build(B, L, P, F, fr, R, Y, nv0) { const lod = P.lod, W = fr.W, D = fr.D, n = Math.max(1, P.f); pad(B, P, F, Y, lod >= 1 ? T.tsuchi : 'c', lod >= 1 ? [1.25, 1.2, 1.1] : [0.86, 0.82, 0.72], { su: 8 });
    const rb = fr.R(1.5, 1, W - 1.5, Math.min(D * 0.45, 16)), Fb = rfoot(rb);
    B.top = Math.max(B.top, rcBlock(B, P, Fb, n, { fm: L.glass ? T.curtain : T.ribbon, tb: 4, tf: L.glass ? 4 : 2, bw: 3.6, fh: 3.6, g1: 4.2, base: Y, wc: C(L.wc), roof: L.rc ? 'hip' : 'flat', rm: T.kane, rc: L.rc ? C(L.rc) : W1, p: 0.3, oh: 1.5, par: 0.8, onpad: 1 }));
    if (lod >= 1) { const e = Fb.edges.find(q => q.nx * fr.dv[0] + q.nz * fr.dv[1] > 0.9); if (e) { B.ledge(e, Y, Y + 0.5, 5, C('#a8865c')); if (lod >= 2) B.rail(T.rail, e, Y + 0.5, 1.0, 5, [0.95, 0.95, 0.93], { su: 1.2 }); } }
    if (L.pool && lod >= 1) { const rp = fr.R(W * 0.2, Math.min(D * 0.45, 16) + 6, W * 0.8, Math.min(D - 2, Math.min(D * 0.45, 16) + 16)); if (rp[3] > rp[1] + 3) pool(B, P, rp, Y, { fence: false }); }
    if (lod >= 2) for (let i = 0; i < 10; i++) { const q = fr.p(W * (0.08 + 0.84 * R()), lerp(Math.min(D * 0.45, 16) + 3, D - 2, R())); trunk3(B, q[0], q[1], Y, Y + 2.3, 0.04, [0.8, 0.8, 0.78]); B.cone('c', q[0], q[1], 1.3, Y + 2.0, Y + 2.6, 6, C(A.pick(R, L.pc))); }
    if (L.palm) grove(B, P, [fr.R(0, D * 0.5, W, D)], [], { sp: 9, k: 0.5, h: [7, 10], y: Y, p: 1, max: 8, vmax: left(B, nv0, lod, 0.5) }); } };
A.arch('p_koen', {
  looks: KO.plaza.looks,
  far(L, P) { const t = P.ko.t || 'plaza', k = KO[t], f = k.far(L, P) || {}; if (f.ct == null) delete f.ct; return Object.assign({ H: 0.3, base: 0.05, wall: 'c', wc: [0.6, 0.6, 0.58], bw: 4, fh: 4, tb: 1, tf: 1, ins: 0, rt: 'flat', ct: [0.97, 0.97, 0.97] }, f); },
  build(B, L, P) { const t = P.ko.t || 'plaza', F = P.F, fr = frm(A.rin(mainRect(F, P.front), 0.5), P.front); KO[t].build(B, L, P, F, fr, P.rng, 0.06, B.nv); }
});
const kk = (t, o) => ['p_koen', Object.assign({ t, looks: KO[t].looks }, o || {})];
A.kinds({ plaza: kk('plaza'), ugreen: kk('ugreen'), uave: kk('uave'), garden: kk('garden'), cemetery: kk('cemetery'), camp: kk('camp'), fishing: kk('fishing'), zoo: kk('zoo'), botanical: kk('botanical'),
  golf: kk('golf'), golfrange: kk('golfrange'), tennis: kk('tennis'), ufield: kk('ufield'), driving: kk('driving'), batting: kk('batting'), ski: kk('ski'), amuse: kk('amuse'), tpark: kk('amuse', { big: 1 }), aquapark: kk('aquapark'), beachclub: kk('beachclub') });

/* ================= 城（天守）================= */
T.shiro = TX('f:shiro', 256, 256, (g, w, h, R) => { const k = k256(w), mw = w / 4;   // 白い漆喰・下は 黒い下見板・小さな窓
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#f2f0ea', n: 0.02 }, R);
  fill(g, 0, h * 0.62, w, h * 0.38, '#2c2a28'); for (let y = h * 0.62; y < h; y += 5 * k) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y, w, Math.max(1, k)); }
  for (let i = 0; i < 4; i++) { if (i % 2) continue; const x = i * mw + mw * 0.3; fill(g, x - 2 * k, h * 0.24 - 2 * k, mw * 0.4 + 4 * k, h * 0.22 + 4 * k, '#5a5450'); fill(g, x, h * 0.24, mw * 0.4, h * 0.22, '#1e1c1b'); g.fillStyle = '#d8d4ca'; for (let a = 1; a < 5; a++) g.fillRect(x + mw * 0.4 * a / 5 - k, h * 0.24, 2 * k, h * 0.22); }
  fill(g, 0, h * 0.6, w, h * 0.025, '#e2ded5'); fill(g, 0, 0, w, h * 0.04, '#d9d5cc'); });
// 石垣の 台（すそが ひろい 台形）：長方形 r（上）・ひろがり k・高さ h
function ishidai(B, P, r, y, h, k) {
  const lod = P.lod, b = [r[0] - k, r[1] - k, r[2] + k, r[3] + k], T0 = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], B0 = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, L = Math.hypot(B0[j][0] - B0[i][0], B0[j][1] - B0[i][1]), sl = Math.hypot(h, k);
    B.quad(lod >= 1 ? T.ishigaki : 'c', [B0[i][0], y, B0[i][1]], [B0[j][0], y, B0[j][1]], [T0[j][0], y + h, T0[j][1]], [T0[i][0], y + h, T0[i][1]], null, lod >= 1 ? W1 : [0.6, 0.58, 0.54], [0, 0, L / 4, 0, L / 4, sl / 4, 0, sl / 4]); }
  B.flat(lod >= 1 ? T.jari : 'c', r, y + h, lod >= 1 ? '#cfc9bc' : '#b9b4a8', { su: 4 });
}
const SHL = [
  { n: '白い天守・いぶし瓦', wc: W1, rm: 'kawara' },
  { n: '黒い天守・下見板', wc: '#6a6764', rm: 'kawara', rtc: '#8a8e92' },
  { n: '白壁・緑の銅瓦', wc: W1, rm: 'dou' },
  { n: '白と黒・お堀', wc: W1, rm: 'kawara', moat: 1 },
  { n: '赤瓦の城', wc: W1, rm: 'kawara', rtc: '#c08068' }
];
A.arch('p_shiro', {
  looks: SHL,
  far(L, P) { const n = Math.max(3, P.f); return { H: 10 + n * 4.5, base: 0, wall: T.shiro, bw: 4, fh: 4.5, tb: 4, tf: 1, wc: C(L.wc), roof: L.rm === 'dou' ? T.dou : T.kawara, rc: L.rtc ? C(L.rtc) : W1, rt: 'hip', p: 0.55, ins: 8, top: T.jari, ct: W1 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, n = cl(P.f, 3, 6), Y = 0.06, nv0 = B.nv;
    pad(B, P, F, Y, lod >= 1 ? T.jari : 'c', lod >= 1 ? '#d6d0c2' : [0.74, 0.72, 0.66], { su: 4, wm: T.ishigaki, wsu: 4 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 1)), fr = frm(r0, P.front), W = fr.W, D = fr.D, outs = [];
    // お堀（まわり）
    let ri = r0;
    if ((L.moat || Math.min(W, D) > 90) && Math.min(W, D) > 50 && !P.tilt) { const mw = cl(Math.min(W, D) * 0.1, 6, 20); for (const e of rfoot(r0).edges) { const a = onE(e, 0, 0), b = onE(e, e.L, -mw); B.flat(lod >= 1 ? T.mizu : 'c', [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], Y + 0.02, lod >= 1 ? [0.6, 0.75, 0.7] : [0.38, 0.5, 0.48], { su: 10 }); }
      ri = A.rin(r0, mw); if (lod >= 2) for (const e of rfoot(ri).edges) B.wallE(T.ishigaki, e, Y - 1.5, Y + 1.2, W1, { uv: [0, e.L / 4, 0, 0.7] }); }
    // 天守台と 天守
    const wi = Math.min(ri[2] - ri[0], ri[3] - ri[1]), tw = cl(wi * 0.42, 14, 34), td = tw * 0.82, hb = cl(tw * 0.42, 6, 13), c = [(ri[0] + ri[2]) / 2, (ri[1] + ri[3]) / 2];
    const cq = fr.p(W / 2, D * 0.55), cx = (cq[0] + c[0]) / 2, cz = (cq[1] + c[1]) / 2, ax = fr.uX;
    const top = ax ? [cx - tw / 2, cz - td / 2, cx + tw / 2, cz + td / 2] : [cx - td / 2, cz - tw / 2, cx + td / 2, cz + tw / 2];
    ishidai(B, P, top, Y, hb, hb * 0.32); outs.push(A.rin(top, -hb * 0.32 - 3));
    const rm = Object.assign({}, RM[L.rm], L.rtc ? { c: L.rtc } : {}, { uc: [0.92, 0.9, 0.86], gc: [0.94, 0.92, 0.88], hc: '#efece5' });
    let y = Y + hb;
    if (lod < 1) { const rr2 = A.rin(top, 0.8), hk = n * 4.4; B.facade('c', rfoot(rr2), y, y + hk, { c: mul(C(L.wc), 0.88) }); B.top = Math.max(B.top, jroof(B, Object.assign({}, rm, { r: A.rin(rr2, (rr2[2] - rr2[0]) * 0.12), y: y + hk, t: 'iri', oh: 1.4, p: 0.7, lod: 0 }))); return; }
    const nt = lod >= 2 ? n : Math.min(n, 4);
    for (let i = 0; i < nt; i++) {
      const s2 = 1 - i * (0.5 / nt), rr2 = [cx - (top[2] - top[0]) * s2 / 2 + 0.6, cz - (top[3] - top[1]) * s2 / 2 + 0.6, cx + (top[2] - top[0]) * s2 / 2 - 0.6, cz + (top[3] - top[1]) * s2 / 2 - 0.6], wh = (i === 0 ? 5 : 4.2) * (n / nt), last = i === nt - 1;
      B.facade(lod >= 1 ? T.shiro : 'c', rfoot(rr2), y, y + wh, { bw: 4, fh: wh, tb: 4, tf: 1, vy: y, c: lod >= 1 ? C(L.wc) : mul(C(L.wc), 0.9) });
      const nx = 1 - (i + 1) * (0.5 / nt), nw = (top[2] - top[0]) * nx - 1.2, inset2 = ((rr2[2] - rr2[0]) - nw) / 2;
      const ro = Object.assign({}, rm, { r: rr2, y: y + wh, t: last ? 'iri' : 'yose', oh: 1.4, p: last ? 0.7 : 0.55, cv: 0.42, up: 0.5, k1: 0.45, rh: last ? 0.7 : 0, oni: last ? '#c9a640' : 0, cut: last ? 0 : 1.4 + inset2 + 0.1, nd: last ? 3 : 2, ns: lod >= 2 ? 6 : 2, lod: lod >= 2 || last ? lod : 0 });
      const yt = jroof(B, ro);
      if (!last && lod >= 2 && i % 2 === 0) { const ang = ax ? 'x' : 'z', sz = Math.min(5, (rr2[2] - rr2[0]) * 0.25); for (const sg of [-1, 1]) { const pz = ax ? [cx, rr2[sg < 0 ? 1 : 3] + sg * 0.3] : [rr2[sg < 0 ? 0 : 2] + sg * 0.3, cz], rk = ax ? [pz[0] - sz / 2, Math.min(pz[1], pz[1] + sg * 1.2), pz[0] + sz / 2, Math.max(pz[1], pz[1] + sg * 1.2)] : [Math.min(pz[0], pz[0] + sg * 1.2), pz[1] - sz / 2, Math.max(pz[0], pz[0] + sg * 1.2), pz[1] + sz / 2];
          jroof(B, Object.assign({}, rm, { r: rk, y: y + wh - 0.4, t: 'kiri', ax: ang === 'x' ? 'z' : 'x', oh: 0.4, og: 0.4, p: 0.9, cv: 0.2, up: 0, rh: 0.25, th: 0.2, lod: 1 })); } }
      y = last ? yt : yt - 0.05;
    }
    B.top = Math.max(B.top, y + 1);
    if (lod < 1) return;
    // 塀・門・松
    const Fw = rfoot(A.rin(ri, 1.5)), ef = Fw.edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9);
    if (!P.tilt) for (const e of Fw.edges) { if (e === ef) { hei2(B, e, 0, e.L / 2 - 5, Y, 2.6, lod); hei2(B, e, e.L / 2 + 5, e.L, Y, 2.6, lod); } else hei2(B, e, 0, e.L, Y, 2.6, lod); }
    if (ef && lod >= 2) { const q0 = onE(ef, ef.L / 2 - 5, -1.5), q1 = onE(ef, ef.L / 2 + 5, 1.5), rg = [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])]; B.facade(T.shiro, rfoot(rg), Y + 4.2, Y + 8, { bw: 4, fh: 3.8, tb: 4, tf: 1, vy: Y + 4.2, c: C(L.wc) }); post(B, rg[0], rg[1], rg[0] + 1, rg[3], Y, Y + 4.2, [0.3, 0.28, 0.26]); post(B, rg[2] - 1, rg[1], rg[2], rg[3], Y, Y + 4.2, [0.3, 0.28, 0.26]);
      jroof(B, Object.assign({}, rm, { r: rg, y: Y + 8, t: 'iri', ax: fr.ax('u'), oh: 1.0, p: 0.65, cv: 0.4, up: 0.3, rh: 0.4, nd: 2, ns: 3, lod })); outs.push(A.rin(rg, -3)); }
    grove(B, P, [A.rin(ri, 3)], outs, { sp: 9, k: 0.7, h: [6, 9], y: Y, p: 0.7, max: 16, vmax: left(B, nv0, lod) });
  }
});
// 塀（城：白壁と 瓦）辺 e の from〜to
function hei2(B, e, from, to, y, h, lod) { if (to - from < 0.6) return; const a = onE(e, from, 0), b = onE(e, to, 0); B.wall('c', a[0], a[1], b[0], b[1], y, y + h, [0.95, 0.94, 0.9]); if (lod >= 2) B.wall('c', b[0], b[1], a[0], a[1], y, y + h, [0.9, 0.89, 0.85]); if (lod >= 1) B.flat('c', [Math.min(a[0], b[0]) - 0.35, Math.min(a[1], b[1]) - 0.35, Math.max(a[0], b[0]) + 0.35, Math.max(a[1], b[1]) + 0.35], y + h, [0.36, 0.37, 0.39]); }
A.kinds({ castle: 'p_shiro' });

/* ================= 展望タワー ================= */
const TWL = [
  { n: '白いコンクリートの塔', t: 'conc', c: '#efeeea' },
  { n: '鉄骨の塔・銀色', t: 'lat', c: '#b9bec2' },
  { n: 'ガラスの展望塔', t: 'glass', c: '#dfe4e8' },
  { n: '白い鉄骨の塔', t: 'lat', c: '#eeeeea' }
];
A.arch('p_tower', {
  looks: TWL,
  far(L, P) { const H = Math.max(20, P.f) * 3.5; return { H: H * 0.75, base: 0, wall: L.t === 'glass' ? T.curtain : T.panelw, bw: 4, fh: 4, tb: L.t === 'glass' ? 4 : 1, tf: L.t === 'glass' ? 4 : 1, wc: C(L.c), roof: null, rc: [0.7, 0.7, 0.7], rt: 'flat', ins: Math.max(2, 0) }; },
  build(B, L, P) {
    const F = P.F, lod = P.lod, H = Math.max(20, P.f) * 3.5, Y = 0.06;
    pad(B, P, F, Y, lod >= 1 ? T.ishi : 'c', lod >= 1 ? '#d6d0c4' : [0.75, 0.74, 0.7], { su: 4 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 1.5)), cx = (r0[0] + r0[2]) / 2, cz = (r0[1] + r0[3]) / 2, wb = Math.min(r0[2] - r0[0], r0[3] - r0[1]), col = C(L.c), dk = H * 0.72, dr = Math.min(wb * 0.45, 7 + H * 0.02);
    // 下の建物
    const rp = A.rin(r0, Math.max(0.5, wb * 0.05)); B.facade(lod >= 1 ? T.curtain : 'c', rfoot(rp), Y, Y + 8, { bw: 3.6, fh: 4, tb: 4, tf: 4, vy: Y, c: lod >= 1 ? W1 : [0.45, 0.52, 0.58] }); B.cap(lod >= 1 ? T.flat : 'c', rfoot(rp), Y + 8, lod >= 1 ? W1 : [0.62, 0.62, 0.6], { su: 8 });
    if (lod < 1) { const s2 = L.t === 'lat' ? wb * 0.3 : Math.max(2.5, wb * 0.14); B.quad('c', [cx - s2, Y + 8, cz], [cx + s2, Y + 8, cz], [cx + s2 * 0.3, dk, cz], [cx - s2 * 0.3, dk, cz], null, col); B.quad('c', [cx, Y + 8, cz - s2], [cx, Y + 8, cz + s2], [cx, dk, cz + s2 * 0.3], [cx, dk, cz - s2 * 0.3], null, mul(col, 0.9));
      B.cyl('c', cx, cz, dr, dk, dk + 10, 5, [0.55, 0.6, 0.66]); B.quad('c', [cx - 0.6, dk + 10, cz], [cx + 0.6, dk + 10, cz], [cx + 0.3, H, cz], [cx - 0.3, H, cz], null, [0.85, 0.85, 0.83]); B.top = Math.max(B.top, H); return; }
    if (L.t === 'lat') {   // 4 本足の 鉄骨
      const b0 = wb * 0.46, t0 = Math.max(2.5, dr * 0.35), lg = lod >= 2 ? 4 : 4, legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]], P3 = (s, h) => [cx + s[0] * lerp(b0, t0, Math.pow(h / H, 0.6)), Y + h, cz + s[1] * lerp(b0, t0, Math.pow(h / H, 0.6))];
      for (const sg of legs.slice(0, lg)) { const ns = lod >= 2 ? 5 : 2; for (let i = 0; i < ns; i++) pole(B, P3(sg, H * 0.85 * i / ns), P3(sg, H * 0.85 * (i + 1) / ns), 0.6 - 0.4 * i / ns, col, lod >= 2 ? 4 : 3); }
      if (lod >= 2) for (let k = 1; k <= 8; k++) { const h = H * 0.85 * k / 9; for (let i = 0; i < 4; i++) beam(B, P3(legs[i], h), P3(legs[(i + 1) % 4], h), 0.25, 0.25, col);
        for (let i = 0; i < 4; i++) beam(B, P3(legs[i], h), P3(legs[(i + 1) % 4], h - H * 0.85 / 9), 0.15, 0.15, mul(col, 0.9)); }
    } else if (L.t === 'glass') { const s2 = Math.max(3, wb * 0.18); B.facade(T.curtain, rfoot([cx - s2, cz - s2, cx + s2, cz + s2]), Y, dk, { bw: 3, fh: 4, tb: 4, tf: 4, vy: Y, c: col }); }
    else B.cyl(lod >= 1 ? T.panelw : 'c', cx, cz, Math.max(2.5, wb * 0.14), Y, dk, lod >= 2 ? 16 : 8, col, { su: 4, sv: 4, notop: true });
    // 展望台（ガラスの 輪）と アンテナ
    const nn = lod >= 2 ? 16 : 8; B.cyl(lod >= 1 ? T.curtain : 'c', cx, cz, dr, dk, dk + 9, nn, lod >= 1 ? W1 : [0.5, 0.58, 0.65], { su: 3.6, sv: 4.5 }); B.cyl('c', cx, cz, dr * 1.06, dk - 0.6, dk, nn, mul(col, 0.95)); B.cyl('c', cx, cz, dr * 1.04, dk + 9, dk + 10.2, nn, col);
    B.cyl('c', cx, cz, Math.max(0.6, dr * 0.12), dk + 10.2, H, lod >= 1 ? 6 : 3, [0.85, 0.85, 0.83], { notop: true });
    B.top = Math.max(B.top, H);
  }
});
A.kinds({ obstower: 'p_tower' });

/* ================= 天文台・気象台 ================= */
const OBL = [
  { n: '白いタイルと白いドーム', fm: T.tile, wc: '#f4f3ef', dc: '#f4f4f2' },
  { n: '打ちはなし・銀のドーム', fm: T.conc, wc: W1, dc: '#c2c7cb' },
  { n: 'れんが色・白いドーム', fm: T.brick, wc: W1, dc: '#f0f0ee' },
  { n: 'グレー・2つのドーム', fm: T.alc, wc: '#cfd1d1', dc: '#e9eaea', two: 1 }
];
A.arch('p_tenmon', {
  looks: OBL,
  far(L, P) { const n = Math.max(1, P.f), d = fmDims(L.fm); return { H: 0.3 + 4 * n, base: 0.3, wall: L.fm, bw: 3.6, fh: 4, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: null, rc: C(L.dc), rt: 'flat', ins: 3 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, n = Math.max(1, P.f), wx = !!P.ko.wx, Y = 0.06;
    pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    const Fb = A.inset(F, SB(P, F.n >= 4 ? 4 : 2)), d = fmDims(L.fm), H = rcBlock(B, P, Fb, n, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 4, g1: 4.2, base: 0.3, g1m: T.g1, wc: C(L.wc), roof: 'flat', par: 0.8, onpad: 1, rt: false });
    B.top = Math.max(B.top, H);
    const rr = mainRect(Fb, P.front), w = rr[2] - rr[0], dd = rr[3] - rr[1], ax = w >= dd, nd = (L.two && Math.max(w, dd) > 16) ? 2 : 1, nn = lod >= 2 ? 16 : lod >= 1 ? 8 : 6;
    for (let i = 0; i < nd; i++) { const c = ax ? [rr[0] + w * (i + 0.5) / nd, (rr[1] + rr[3]) / 2] : [(rr[0] + rr[2]) / 2, rr[1] + dd * (i + 0.5) / nd], rd = Math.min(7, Math.min(w / nd, dd) * 0.38);
      if (wx) { trunk3(B, c[0], c[1], H, H + 6, 0.5, [0.85, 0.85, 0.83]); B.dome('c', c[0], c[1], rd * 0.6, rd * 0.6, H + 6, rd * 0.6, nn, C(L.dc), { rings: lod >= 2 ? 4 : lod >= 1 ? 2 : 1 }); if (lod >= 1) B.dome('c', c[0], c[1], rd * 0.6, rd * 0.6, H + 6, -rd * 0.3, nn, mul(C(L.dc), 0.9), { rings: 1 }); B.top = Math.max(B.top, H + 6 + rd * 0.6); }
      else { if (lod >= 1) B.cyl('c', c[0], c[1], rd, H, H + 2.5, nn, C(L.wc === W1 ? '#e6e4de' : L.wc), { notop: true }); B.dome('c', c[0], c[1], rd, rd, H + (lod >= 1 ? 2.5 : 0), rd, nn, C(L.dc), { rings: lod >= 2 ? 4 : lod >= 1 ? 2 : 1 }); if (lod >= 2) { const q = [c[0], c[1] - rd * 0.98]; B.quad('c', [q[0] - 0.6, H + 2.6, q[1]], [q[0] + 0.6, H + 2.6, q[1]], [q[0] + 0.6, H + 2.5 + rd * 0.9, q[1] + rd * 0.3], [q[0] - 0.6, H + 2.5 + rd * 0.9, q[1] + rd * 0.3], null, [0.3, 0.32, 0.34]); } B.top = Math.max(B.top, H + 2.5 + rd); } }
    if (lod < 1) return;
    const e = A.frontEdge(Fb, P.front); signE(B, e, e.L / 2 - 1.5, e.L / 2 + 1.5, 0.3, 2.8, SG.door, 0.08); canopy(B, e, e.L / 2, 6, 2.2, 3.6, '#e9e8e4', { lod, th: 0.3 });
    if (wx && lod >= 2) { const q = onE(e, e.L + 4, 6); B.box('c', q[0] - 0.6, q[1] - 0.5, q[0] + 0.6, q[1] + 0.5, 0.06 + 0.8, 0.06 + 1.8, [0.96, 0.96, 0.95]); post(B, q[0] - 0.05, q[1] - 0.05, q[0] + 0.05, q[1] + 0.05, 0.06, 0.9, [0.9, 0.9, 0.9]); trunk3(B, q[0] + 4, q[1], 0.06, 10, 0.08, [0.8, 0.8, 0.8]); B.box('c', q[0] + 3.7, q[1] - 0.3, q[0] + 4.3, q[1] + 0.3, 10, 10.3, [0.85, 0.85, 0.85]); }
    yardTrees(B, P, F, A.inset(Fb, -2), 4, R);
  }
});
A.kinds({ observatory: 'p_tenmon', kishodai: ['p_tenmon', { wx: 1 }] });

/* ================= 国の建物（議事堂・官邸・迎賓館）：本物には 似せない ================= */
const KKL = [
  { n: '白い石・中央のドーム', fm: T.stone, wc: '#f0ede6', dome: 1, rc: '#9fb8ae' },
  { n: '灰色の石・列柱', fm: T.stone, wc: '#c9c6bf', cols: 1 },
  { n: 'ガラスと石・大きなひさし', fm: T.curtain, wc: W1, eave: 1 },
  { n: '緑の銅屋根', fm: T.stone, wc: '#e6dfd2', copper: 1 }
];
A.arch('p_kokka', {
  looks: KKL,
  far(L, P) { const n = Math.max(2, P.f), d = fmDims(L.fm); return { H: 0.5 + n * 4.8, base: 0.5, wall: L.fm, bw: 3.6, fh: 4.8, tb: d.tb, tf: d.tf, wc: C(L.wc), roof: L.copper ? T.dou : null, rc: [0.62, 0.62, 0.6], rt: L.copper ? 'hip' : 'flat', ins: 8, top: L.copper ? T.dou : null, ct: L.copper ? W1 : [0.66, 0.66, 0.64] }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, n = cl(P.f, 2, 10), Y = 0.06, nv0 = B.nv;
    pad(B, P, F, Y, lod >= 1 ? T.shiba : 'c', lod >= 1 ? W1 : [0.45, 0.58, 0.36], { su: 10 });
    const r0 = A.rin(mainRect(F, P.front), SB(P, 2)), fr = frm(r0, P.front), W = fr.W, D = fr.D, fore = cl(D * 0.3, 4, 60), bd = Math.max(10, Math.min(D - fore - 2, cl(D * 0.4, 14, 40)));
    const d = fmDims(L.fm), wing = P.ko.u && W > 60;   // 迎賓館：コの字
    const blk = (u0, v0, u1, v1, k, roof) => { const r = fr.R(u0, v0, u1, v1); const H = rcBlock(B, P, rfoot(r), k, { fm: L.fm, tb: d.tb, tf: d.tf, bw: 3.6, fh: 4.8, g1: 5.2, base: Y + 0.5, g1m: T.g1, wc: C(L.wc), roof: roof || 'flat', rm: T.dou, rc: W1, p: 0.3, oh: 1.0, par: 1.2, onpad: 1, rt: false }); B.top = Math.max(B.top, H); return [r, H]; };
    const cw = Math.min(W * 0.3, 50), roofT = L.copper ? 'hip' : 'flat';
    if (lod < 1) { blk(Math.max(2, W * 0.08), fore + 3, Math.min(W - 2, W * 0.92), fore + bd - 3, n, 'flat'); blk(W / 2 - cw / 2, fore, W / 2 + cw / 2, fore + bd, n + 1, 'flat'); return; }
    const [rc2, Hc] = blk(W / 2 - cw / 2, fore, W / 2 + cw / 2, fore + bd, n + 1, roofT);
    blk(Math.max(2, W * 0.08), fore + 3, W / 2 - cw / 2 + 0.5, fore + bd - 3, n, roofT); blk(W / 2 + cw / 2 - 0.5, fore + 3, Math.min(W - 2, W * 0.92), fore + bd - 3, n, roofT);
    if (wing && D - fore - bd > 0) { blk(Math.max(2, W * 0.08), fore - Math.min(fore * 0.7, 30), Math.max(2, W * 0.08) + 16, fore + 3, n, roofT); blk(Math.min(W - 2, W * 0.92) - 16, fore - Math.min(fore * 0.7, 30), Math.min(W - 2, W * 0.92), fore + 3, n, roofT); }
    if (L.dome && lod >= 1) { const c = [(rc2[0] + rc2[2]) / 2, (rc2[1] + rc2[3]) / 2], rd = Math.min(cw, bd) * 0.3; B.cyl('c', c[0], c[1], rd, Hc, Hc + 4, lod >= 2 ? 16 : 8, C(L.wc), { notop: true }); B.dome(lod >= 1 ? T.dou : 'c', c[0], c[1], rd, rd, Hc + 4, rd * 0.55, lod >= 2 ? 16 : 8, W1, { rings: lod >= 2 ? 4 : 2, su: 3 }); B.top = Math.max(B.top, Hc + 4 + rd * 0.55); }
    if (lod < 1) return;
    const e = rfoot(rc2).edges.find(q => q.nx * -fr.dv[0] + q.nz * -fr.dv[1] > 0.9);
    if (e) { signE(B, e, e.L / 2 - 3, e.L / 2 + 3, Y + 0.5, Y + 4, SG.door, 0.12);
      if (L.cols || L.dome) { B.ledge(e, Y + 9.4, Y + 10.4, 5, C(L.wc), { from: e.L * 0.2, to: e.L * 0.8 }); if (lod >= 2) for (let i = 0; i <= 7; i++) { const q = onE(e, e.L * 0.2 + e.L * 0.6 * i / 7, 4.4); B.cyl('c', q[0], q[1], 0.6, Y + 0.5, Y + 9.4, 8, C(L.wc), { notop: true }); } }
      else if (L.eave) B.ledge(e, Hc - 0.4, Hc + 0.4, 7, C('#d6d3cc'));
      else canopy(B, e, e.L / 2, e.L * 0.5, 4, Y + 5.2, '#e6e2d8', { posts: 1, lod, th: 0.5, y0: Y }); }
    // 前庭：噴水・道・木
    if (fore > 10) { flatU(B, fr, T.ishi, W / 2 - 5, 0, W / 2 + 5, fore, Y + 0.03, '#ddd7cb', 4); const q = fr.p(W / 2, fore * 0.5), rf2 = cl(fore * 0.2, 3, 12); B.cyl('c', q[0], q[1], rf2, Y, Y + 0.6, lod >= 2 ? 16 : 8, [0.85, 0.84, 0.8]); B.cyl('c', q[0], q[1], rf2 * 0.9, Y + 0.6, Y + 0.62, lod >= 2 ? 16 : 8, [0.55, 0.8, 0.9]); if (lod >= 2) B.cyl('c', q[0], q[1], 0.6, Y + 0.6, Y + 3, 8, [0.85, 0.84, 0.8]); }
    grove(B, P, F.rects.map(r => A.rin(r, 2)), [fr.R(W * 0.05, fore - 1, W * 0.95, fore + bd + 1), fr.R(W / 2 - 8, 0, W / 2 + 8, fore)], { sp: 10, k: 0.8, h: [8, 14], y: Y, n: 0.3, p: 0.2, max: 40, vmax: left(B, nv0, lod) });
    if (lod >= 2 && !P.tilt) fenceF(B, rfoot(A.rin(r0, -1.2)), Y, 2.2, [0.3, 0.3, 0.32], T.rail, null, 1.5);
  }
});
A.kinds({ diet: 'p_kokka', kantei: ['p_kokka', { looks: [KKL[2], KKL[1], KKL[3], KKL[0]] }], geihinkan: ['p_kokka', { u: 1, looks: [KKL[3], KKL[0], KKL[1], KKL[2]] }] });
})();
