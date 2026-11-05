/* ===== 風の芽経済組：国土の地図 3D の建物（t65）— お店・オフィス・ホテル（b_）=====
   ・質感の名前は b: から。看板は 文字なし（色の板・かんたんな形だけ）。実在のお店・会社の 色の組み合わせ や 形 は まねしない
   ・乱数は P.rng() だけ。座標は m（区画の北西のかどが原点・x 東・z 南・y 上） */
(function () {
'use strict';
const A = window.M3A, PT = A.paint, col = A.col, mul = A.mul, mix = A.mix, css = PT.css;
const PI = Math.PI, WH = [1, 1, 1];
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const T = (k, w, h, f, o) => A.tex('b:' + k, w, h, f, o);

/* ---------- 形の道具 ---------- */
// 長方形の形（F とおなじ つかいかた）
function rf(x0, z0, x1, z1) {
  const l = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], es = []; let s = 0;
  for (let i = 0; i < 4; i++) { const a = l[i], b = l[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-6; es.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / L, nz: -dx / L, L, u0: s, li: 0, out: true }); s += L; }
  const r = [x0, z0, x1, z1];
  return { loops: [l], edges: es, rects: [r], maxr: [r], bb: r, w: x1 - x0, d: z1 - z0, area: (x1 - x0) * (z1 - z0), n: 1 };
}
// 形を ずらす
function fsh(F, dx, dz) {
  if (!dx && !dz) return F;
  const sr = r => [r[0] + dx, r[1] + dz, r[2] + dx, r[3] + dz];
  return { loops: F.loops.map(l => l.map(p => [p[0] + dx, p[1] + dz])), edges: F.edges.map(e => Object.assign({}, e, { ax: e.ax + dx, az: e.az + dz, bx: e.bx + dx, bz: e.bz + dz })),
    rects: F.rects.map(sr), maxr: F.maxr.map(sr), bb: sr(F.bb), w: F.w, d: F.d, area: F.area, n: F.n };
}
// 区画の一部（もとの F の cells の一部）→ F（もとの座標のまま）
function subF(F0, cells) { const cs = F0.cs || 10, F = A.foot(cells, cs); return fsh(F, F.X0 * cs, F.Y0 * cs); }
// 辺（a→b。外向きは (dz, -dx)）
function mkE(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-6; return { ax, az, bx, bz, nx: dz / L, nz: -dx / L, L, u0: 0, out: true }; }
// 辺の上の点（はじめから t m・外へ o m）
const ept = (e, t, o = 0) => [e.ax + (e.bx - e.ax) * t / e.L + e.nx * o, e.az + (e.bz - e.az) * t / e.L + e.nz * o];
// 辺の一部（t0〜t1 m）を 新しい辺に
const esub = (e, t0, t1, o = 0) => { const a = ept(e, t0, o), b = ept(e, t1, o); return mkE(a[0], a[1], b[0], b[1]); };
const area = r => (r[2] - r[0]) * (r[3] - r[1]);
const bigR = F => (F.maxr || F.rects).reduce((a, r) => area(r) > area(a) ? r : a);
// 長方形 r から q を のぞいた のこり（0〜4 こ）
function rsub(r, q) {
  const x0 = Math.max(r[0], q[0]), z0 = Math.max(r[1], q[1]), x1 = Math.min(r[2], q[2]), z1 = Math.min(r[3], q[3]);
  if (x1 <= x0 + 0.01 || z1 <= z0 + 0.01) return [r];
  const o = [];
  if (z0 > r[1] + 0.01) o.push([r[0], r[1], r[2], z0]);
  if (z1 < r[3] - 0.01) o.push([r[0], z1, r[2], r[3]]);
  if (x0 > r[0] + 0.01) o.push([r[0], z0, x0, z1]);
  if (x1 < r[2] - 0.01) o.push([x1, z0, r[2], z1]);
  return o;
}
// 形 F のうち 長方形 q の外の部分（せまいのは のぞく）
const rest = (F, q, m = 2) => F.rects.flatMap(r => rsub(r, q)).filter(r => r[2] - r[0] > m && r[3] - r[1] > m);
// 道のがわ（東西南北）
// 区画から d m さがる（ななめに建てるときは 区画の中の長方形なので 0.3m まで）
const insP = (P, d) => A.inset(P.F, P.tilt ? Math.min(d, 0.3) : d);
const fnOf = (F, P) => { const e = A.frontEdge(F, P.front); return [Math.round(e.nx), Math.round(e.nz)]; };
// 長方形 r を 正面（fn）から見た座標に：u（正面にそって）・v（奥へ）。rect(u0, v0, u1, v1) → [x0, z0, x1, z1]
function frame(r, fn) {
  const [x0, z0, x1, z1] = r; let p, W, D;
  if (fn[1] > 0.5) { W = x1 - x0; D = z1 - z0; p = (u, v) => [x0 + u, z1 - v]; }
  else if (fn[1] < -0.5) { W = x1 - x0; D = z1 - z0; p = (u, v) => [x1 - u, z0 + v]; }
  else if (fn[0] > 0.5) { W = z1 - z0; D = x1 - x0; p = (u, v) => [x1 - v, z1 - u]; }
  else { W = z1 - z0; D = x1 - x0; p = (u, v) => [x0 + v, z0 + u]; }
  const rect = (u0, v0, u1, v1) => { const a = p(u0, v0), b = p(u1, v1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
  // 正面の辺（u0〜u1・奥 v のところ。外向き = 道のがわ）
  const edge = (u0, u1, v = 0) => { const a = p(u1, v), b = p(u0, v); return mkE(a[0], a[1], b[0], b[1]); };
  return { W, D, p, rect, edge, n: fn };
}
// 区画の中の点か
const inF = (F, x, z) => F.rects.some(r => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]);
// 質感の ます（n × n）の uv（B.wall 用 [u0, u1, v0, v1]）。fl：左右を もどす（B.wall は 外から見て 左右が逆）
const cellUV = (i, j, n = 4, fl = true) => { const e = 0.6 / 256; const u0 = i / n + e, u1 = (i + 1) / n - e, v1 = 1 - j / n - e, v0 = 1 - (j + 1) / n + e; return fl ? [u1, u0, v0, v1] : [u0, u1, v0, v1]; };
// 行（n 行のうち r 行め）の v
const rowV = (r, n) => { const e = 0.7 / (n * 64); return [1 - (r + 1) / n + e, 1 - r / n - e]; };

/* ---------- 描く道具 ---------- */
// 色 → css（'rgba(…)' の文字は そのまま）
const cs = (c, k = 1, a = 1) => typeof c === 'string' && c[0] !== '#' ? c : css(c, k, a);
// ガラス（空のうつりこみ・ブラインド・カーテン・明かり）。x, y, w, h は px
function glass(g, x, y, w, h, R, o = {}) {
  if (w < 1 || h < 1) return;
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, cs(o.g0 || '#a9bccb')); gr.addColorStop(0.6, cs(o.g1 || '#465666')); gr.addColorStop(1, cs(o.g1 || '#465666', 0.8));
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  const r = R(), bl = o.bl || 0, cu = o.cur || 0, li = o.lit || 0;
  if (r < bl) {   // ブラインド（上から）
    const bh = h * (0.2 + 0.8 * R()); g.fillStyle = css(o.blc || '#e2e4e2', 1, 0.86); g.fillRect(x, y, w, bh);
    const st = Math.max(1.5, h / 12); g.fillStyle = 'rgba(40,40,40,.1)'; for (let v = y + st * 0.6; v < y + bh; v += st) g.fillRect(x, v, w, Math.max(0.6, st * 0.25));
  } else if (r < bl + cu) {   // カーテン
    const cc = o.cc ? A.pick(R, o.cc) : '#ece4d4', k = R(); g.fillStyle = css(cc, 1, 0.92);
    if (k < 0.45) { const cw = w * (0.18 + 0.25 * R()); g.fillRect(x, y, cw, h); g.fillRect(x + w - cw * 0.9, y, cw * 0.9, h); }
    else if (k < 0.75) g.fillRect(x, y, w, h); else g.fillRect(x + w * 0.5 * R(), y, w * 0.5, h);
    g.fillStyle = 'rgba(0,0,0,.07)'; for (let u = x; u < x + w; u += Math.max(2, w / 9)) g.fillRect(u, y, 1, h);
  } else if (r < bl + cu + li) {   // 明かり
    const lg = g.createLinearGradient(0, y, 0, y + h); lg.addColorStop(0, 'rgba(255,246,222,.8)'); lg.addColorStop(1, 'rgba(232,214,178,.5)'); g.fillStyle = lg; g.fillRect(x, y, w, h);
  }
  if (o.refl !== false) {   // ななめの光
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = 'rgba(255,255,255,' + (o.ra || 0.1) + ')'; g.beginPath(); g.moveTo(x + w * 0.2, y); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.15, y + h); g.lineTo(x - w * 0.2, y + h); g.closePath(); g.fill();
    g.restore();
  }
}
// わく：x, y, w, h（外の線）・fw（はば）・dv（たてに わける数）・dh（よこ）
function wframe(g, x, y, w, h, fw, c, dv, dh) {
  g.fillStyle = css(c);
  g.fillRect(x, y, w, fw); g.fillRect(x, y + h - fw, w, fw); g.fillRect(x, y, fw, h); g.fillRect(x + w - fw, y, fw, h);
  for (let i = 1; i < (dv || 1); i++) g.fillRect(x + w * i / dv - fw * 0.4, y, fw * 0.8, h);
  for (let i = 1; i < (dh || 1); i++) g.fillRect(x, y + h * i / dh - fw * 0.4, w, fw * 0.8);
}
// 窓（くぼみの影・ガラス・わく・窓台）。o：glass の o ＋ { u（1px）, fw, f（わくの色）, dv, dh, rev（くぼみの濃さ）, sill }
function pwin(g, x, y, w, h, R, o = {}) {
  const u = o.u || 1, fw = o.fw || Math.max(1, 1.6 * u);
  if (o.rev) { g.fillStyle = 'rgba(0,0,0,' + o.rev + ')'; g.fillRect(x - u, y - u * 1.5, w + 2 * u, h + 2.5 * u); }
  glass(g, x + fw, y + fw, w - 2 * fw, h - 2 * fw, R, o);
  if (o.rev) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x + fw, y + fw, w - 2 * fw, Math.max(1, h * 0.09)); }
  wframe(g, x, y, w, h, fw, o.f || '#c3c6c8', o.dv == null ? 2 : o.dv, o.dh || 1);
  if (o.sill) PT.fill(g, x - u, y + h, w + 2 * u, Math.max(1, 1.4 * u), o.sill);
}
const lin = (g, x0, y0, x1, y1, c0, c1, horiz) => { const gr = horiz ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, y1 - y0); };

/* ---------- 共通の質感 ---------- */
// 屋上（押えコンクリート・目地 3m）。su 12
const tFlat = () => T('r:flat', 128, 128, (g, w, h, R) => {
  PT.fill(g, 0, 0, w, h, '#a9a9a4'); PT.noise(g, 0, 0, w, h, 0.045, R, 2);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = 'rgba(' + (R() < 0.5 ? '255,255,250' : '60,62,58') + ',' + (0.03 + R() * 0.05) + ')'; g.fillRect(i * w / 4, j * h / 4, w / 4, h / 4); }   // 板ごとの ちがい
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(70,72,66,' + (0.05 + R() * 0.07) + ')'; g.beginPath(); g.ellipse(R() * w, R() * h, w * (0.05 + R() * 0.12), h * (0.04 + R() * 0.1), 0, 0, PI * 2); g.fill(); }
  g.fillStyle = 'rgba(55,55,52,.38)'; for (let i = 0; i < 4; i++) { g.fillRect(i * w / 4, 0, Math.max(1, w / 128), h); g.fillRect(0, i * h / 4, w, Math.max(1, h / 128)); }
});
// 無地の壁（モルタル・コンクリート。白っぽいので 色をかける）。su 4
const tWC = () => T('wc', 128, 128, (g, w, h, R) => {
  PT.fill(g, 0, 0, w, h, '#ecebe6'); PT.noise(g, 0, 0, w, h, 0.03, R, 1);
  g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, h / 2, w, Math.max(1, h / 128)); g.fillRect(0, 0, w, Math.max(1, h / 128)); g.fillRect(0, 0, Math.max(1, w / 128), h);
  PT.streaks(g, 0, 0, w, h, 7, 0.05, R);
});
// 小物の ます（4×4）：0 行 室外機・ガラリ・鉄のとびら・キュービクル／1 行 自動販売機 ×3・ATM／2 行 たな・野菜・花・給湯器／3 行 木のとびら・ガラスのとびら・ポスト・魚
const tEQ = () => T('eq', 256, 256, (g, w, h, R) => {
  const c = w / 4, u = w / 256, at = (i, j, f) => { g.save(); g.translate(i * c, j * c); g.beginPath(); g.rect(0, 0, c, c); g.clip(); f(c); g.restore(); };
  at(0, 0, s => { PT.fill(g, 0, 0, s, s, '#e3e3df'); g.fillStyle = '#6d7072'; g.beginPath(); g.arc(s * 0.36, s * 0.5, s * 0.27, 0, PI * 2); g.fill(); g.strokeStyle = '#c9cac6'; g.lineWidth = u * 1.2; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(s * 0.36, s * 0.5, s * (0.07 + k * 0.06), 0, PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 6; k++) g.fillRect(s * 0.72, s * (0.25 + k * 0.08), s * 0.2, u * 1.2); PT.fill(g, 0, s * 0.94, s, s * 0.06, '#9a9b97'); });
  at(1, 0, s => { PT.fill(g, 0, 0, s, s, '#a7aaa9'); for (let k = 0; k < 10; k++) { lin(g, 0, k * s / 10, s, (k + 1) * s / 10, '#c6c9c8', '#6e7270'); } });
  at(2, 0, s => { PT.fill(g, 0, 0, s, s, '#9ea2a3'); PT.fill(g, s * 0.15, s * 0.08, s * 0.7, s * 0.92, '#878c8e'); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(s * 0.15, s * 0.08, s * 0.7, u * 1.5); PT.fill(g, s * 0.7, s * 0.55, s * 0.08, s * 0.04, '#d6d6d0'); for (let k = 0; k < 4; k++) PT.fill(g, s * 0.25, s * (0.8 + k * 0.035), s * 0.5, u, '#5d6264'); });
  at(3, 0, s => { PT.fill(g, 0, 0, s, s, '#cfcdc2'); for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(k * s / 3, 0, u, s); for (let q = 0; q < 6; q++) g.fillRect(k * s / 3 + s * 0.06, s * (0.1 + q * 0.06), s * 0.2, u); } PT.fill(g, 0, s * 0.92, s, s * 0.08, '#8e8c83'); });
  const vend = (body, dark) => s => { PT.fill(g, 0, 0, s, s, body); PT.fill(g, s * 0.08, s * 0.06, s * 0.84, s * 0.5, '#d9dfe2');
    const cs = ['#c9493e', '#e0b03a', '#4f87c4', '#59a35b', '#e5e3dc', '#8a5a3c', '#d4733a'];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { PT.fill(g, s * (0.12 + k * 0.13), s * (0.1 + r * 0.15), s * 0.09, s * 0.1, cs[(r * 3 + k * 5 + (R() * 7 | 0)) % cs.length]); PT.fill(g, s * (0.12 + k * 0.13), s * (0.21 + r * 0.15), s * 0.09, s * 0.02, '#e04a3a'); }
    PT.fill(g, s * 0.08, s * 0.62, s * 0.84, s * 0.12, dark); PT.fill(g, s * 0.2, s * 0.8, s * 0.6, s * 0.1, '#2a2c2e'); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(s * 0.08, s * 0.06, s * 0.84, s * 0.08); };
  at(0, 1, vend('#eeeeea', '#b8bcbf')); at(1, 1, vend('#3d6fae', '#2b4f80')); at(2, 1, vend('#c9cdcf', '#8c9396'));
  at(3, 1, s => { PT.fill(g, 0, 0, s, s, '#b3b7b9'); PT.fill(g, s * 0.2, s * 0.12, s * 0.6, s * 0.32, '#2b3a46'); PT.fill(g, s * 0.25, s * 0.16, s * 0.5, s * 0.24, '#5b8bb0'); PT.fill(g, s * 0.2, s * 0.5, s * 0.6, s * 0.14, '#8e9396');
    for (let k = 0; k < 9; k++) PT.fill(g, s * (0.3 + (k % 3) * 0.12), s * (0.52 + Math.floor(k / 3) * 0.04), s * 0.08, s * 0.025, '#e3e3df'); PT.fill(g, 0, s * 0.7, s, s * 0.3, '#9a9fa1'); });
  at(0, 2, s => { PT.fill(g, 0, 0, s, s, '#f1f0ea'); for (let r = 0; r < 5; r++) { PT.fill(g, 0, s * (0.18 + r * 0.17), s, s * 0.02, '#b9bab5'); for (let k = 0; k < 9; k++) PT.fill(g, s * (0.02 + k * 0.11), s * (0.06 + r * 0.17), s * 0.09, s * 0.11, A.pick(R, ['#d2503f', '#e9c04a', '#4c8ac9', '#6aaa5a', '#f0eee6', '#a46b42', '#e08a3c', '#8a6db0'])); } });
  at(1, 2, s => { PT.fill(g, 0, 0, s, s, '#7d6247'); for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) { const X = k * s / 3, Y = r * s / 3, cc = A.pick(R, ['#c9452f', '#5f9a3a', '#e3a33a', '#e8d046', '#7b3f6a', '#3e7a33', '#d97a2a']); PT.fill(g, X + s * 0.02, Y + s * 0.03, s / 3 - s * 0.04, s / 3 - s * 0.05, '#a9875f');
    for (let q = 0; q < 6; q++) { g.fillStyle = css(cc, 0.85 + R() * 0.3); g.beginPath(); g.arc(X + s * (0.07 + (q % 3) * 0.09), Y + s * (0.1 + Math.floor(q / 3) * 0.1), s * 0.05, 0, PI * 2); g.fill(); } } });
  at(2, 2, s => { PT.fill(g, 0, 0, s, s, '#5d6b55'); for (let k = 0; k < 18; k++) { const x = R() * s, y = s * 0.15 + R() * s * 0.55; g.fillStyle = css(A.pick(R, ['#e2577a', '#f2d24b', '#f4f1ea', '#c94a4a', '#a36ad0', '#ef9a3c', '#f0a8c0']), 1); g.beginPath(); g.arc(x, y, s * (0.04 + R() * 0.04), 0, PI * 2); g.fill(); }
    for (let k = 0; k < 4; k++) PT.fill(g, s * (0.03 + k * 0.25), s * 0.68, s * 0.2, s * 0.3, A.pick(R, ['#8a8f93', '#3f5d7a', '#b4b7b5'])); });
  at(3, 2, s => { PT.fill(g, 0, 0, s, s, '#efefea'); PT.fill(g, s * 0.1, s * 0.1, s * 0.8, s * 0.55, '#e6e6e1'); for (let k = 0; k < 7; k++) PT.fill(g, s * 0.18, s * (0.18 + k * 0.06), s * 0.64, u * 1.2, '#a9aaa6'); PT.fill(g, s * 0.3, s * 0.75, s * 0.4, s * 0.1, '#7c7f80'); });
  at(0, 3, s => { PT.fill(g, 0, 0, s, s, '#6a4c36'); for (let k = 0; k < 8; k++) PT.fill(g, s * k / 8, 0, u, s, '#5a3f2c'); PT.fill(g, s * 0.3, s * 0.12, s * 0.4, s * 0.18, '#a9b7c0'); PT.fill(g, s * 0.8, s * 0.5, s * 0.06, s * 0.08, '#d8cfa6'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, s, u * 2); });
  at(1, 3, s => { PT.fill(g, 0, 0, s, s, '#9ba1a5'); glass(g, s * 0.08, s * 0.06, s * 0.4, s * 0.92, R, { g0: '#b5c5cf', g1: '#3c4b57', lit: 0.6 }); glass(g, s * 0.52, s * 0.06, s * 0.4, s * 0.92, R, { g0: '#b5c5cf', g1: '#3c4b57', lit: 0.6 }); PT.fill(g, s * 0.47, s * 0.06, s * 0.06, s * 0.92, '#8a9094'); });
  at(2, 3, s => { PT.fill(g, 0, 0, s, s, '#c73a2e'); PT.fill(g, s * 0.15, s * 0.3, s * 0.7, s * 0.07, '#2a1a18'); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, s * 0.2, s); PT.fill(g, s * 0.2, s * 0.62, s * 0.6, s * 0.24, '#b02f25'); });
  at(3, 3, s => { PT.fill(g, 0, 0, s, s, '#dfe6ea'); for (let k = 0; k < 14; k++) { g.fillStyle = css(A.pick(R, ['#8f9aa3', '#c46a5a', '#d7a08a', '#6b7c88', '#e9e2d6'])); g.beginPath(); g.ellipse(R() * s, s * 0.2 + R() * s * 0.6, s * 0.12, s * 0.04, R() * 0.6 - 0.3, 0, PI * 2); g.fill(); } });
});
// 1階の行（4 行 × 4 柱間）：0 ロビーのガラス・1 ロビーの入口・2 お店のガラス・3 シャッターと裏口
const tGF = () => T('gf', 256, 256, (g, w, h, R) => {
  const rh = h / 4, mw = w / 4, u = w / 256;
  for (let r = 0; r < 4; r++) {
    const Y = r * rh;
    if (r < 2) {   // ロビー：石の柱・高いガラス・中の明かり
      PT.wallMat(g, 0, Y, w, rh, { t: 'stone', c: '#8c8883', sc: u * 0.8, n: 0.04 }, R);
      for (let i = 0; i < 4; i++) {
        const X = i * mw, gx = X + mw * 0.07, gw = mw * 0.86, gy = Y + rh * 0.06, gh = rh * 0.9;
        lin(g, gx, gy, gx + gw, gy + gh * 0.55, '#fbf4e2', '#d8ccb0'); lin(g, gx, gy + gh * 0.55, gx + gw, gy + gh, '#9a9084', '#6a635a');
        g.fillStyle = 'rgba(255,250,230,.5)'; for (let k = 0; k < 3; k++) g.fillRect(gx + gw * (0.12 + k * 0.3), gy + gh * 0.08, gw * 0.14, u * 1.5);
        if (R() < 0.4) { g.fillStyle = '#3f5a37'; g.beginPath(); g.arc(gx + gw * 0.8, gy + gh * 0.72, gw * 0.1, 0, PI * 2); g.fill(); }
        glass(g, gx, gy, gw, gh, R, { g0: 'rgba(160,185,200,.45)', g1: 'rgba(40,55,70,.35)', refl: true, ra: 0.12 });
        PT.fill(g, gx, gy + gh * 0.7, gw, u * 1.5, '#2f3234');
        if (r === 1) { const dx = gx + gw * 0.18, dw = gw * 0.64; PT.fill(g, dx - u, gy + gh * 0.28, dw + 2 * u, gh * 0.72, '#2c2f31'); glass(g, dx, gy + gh * 0.3, dw / 2 - u * 0.5, gh * 0.7, R, { g0: '#c3cbd0', g1: '#5a646b', lit: 1 }); glass(g, dx + dw / 2 + u * 0.5, gy + gh * 0.3, dw / 2 - u * 0.5, gh * 0.7, R, { g0: '#c3cbd0', g1: '#5a646b', lit: 1 }); }
        else PT.fill(g, gx + gw / 2 - u * 0.6, gy, u * 1.2, gh, '#2f3234');
        wframe(g, gx, gy, gw, gh, u * 1.4, '#2f3234', 1, 1);
      }
      PT.fill(g, 0, Y + rh - 2 * u, w, 2 * u, '#5b5853');
    } else if (r === 2) {   // お店のガラス（上は看板の帯）
      PT.fill(g, 0, Y, w, rh, '#d8d6d0'); PT.noise(g, 0, Y, w, rh, 0.03, R);
      for (let i = 0; i < 4; i++) {
        const X = i * mw, gx = X + mw * 0.05, gw = mw * 0.9, gy = Y + rh * 0.24, gh = rh * 0.72;
        PT.fill(g, gx, gy, gw, gh, '#f4efe2');
        for (let k = 0; k < 3; k++) for (let q = 0; q < 5; q++) PT.fill(g, gx + gw * (0.05 + q * 0.19), gy + gh * (0.22 + k * 0.2), gw * 0.15, gh * 0.12, A.pick(R, ['#c9b79a', '#9fb3c0', '#d7c7b8', '#b9a48b', '#e6d2c8', '#8fa092']));
        lin(g, gx, gy + gh * 0.8, gx + gw, gy + gh, 'rgba(120,110,95,.4)', 'rgba(80,70,60,.6)');
        glass(g, gx, gy, gw, gh, R, { g0: 'rgba(170,190,205,.35)', g1: 'rgba(50,60,70,.25)', ra: 0.14 });
        wframe(g, gx, gy, gw, gh, u * 1.3, '#3b3e40', i % 2 ? 2 : 3, 1);
        if (i === 1) { g.fillStyle = 'rgba(90,94,96,.45)'; g.fillRect(gx + gw * 0.36, gy + gh * 0.1, gw * 0.28, gh * 0.9); wframe(g, gx + gw * 0.36, gy + gh * 0.1, gw * 0.28, gh * 0.9, u, '#3b3e40', 1, 1); }
      }
      PT.fill(g, 0, Y + rh * 0.2, w, rh * 0.04, '#9a9893');
      PT.fill(g, 0, Y + rh - 1.5 * u, w, 1.5 * u, '#6a6864');
    } else {   // シャッター・鉄のとびら・ガラリ
      PT.wallMat(g, 0, Y, w, rh, { t: 'tile', c: '#bdbab3', sc: u }, R);
      for (let i = 0; i < 4; i++) {
        const X = i * mw;
        if (i === 1) { PT.fill(g, X + mw * 0.3, Y + rh * 0.38, mw * 0.4, rh * 0.62, '#8f9496'); PT.fill(g, X + mw * 0.6, Y + rh * 0.68, mw * 0.05, rh * 0.04, '#d6d6d0'); for (let k = 0; k < 6; k++) PT.fill(g, X + mw * 0.32, Y + rh * (0.12 + k * 0.035), mw * 0.36, u, '#6d7173'); }
        else if (i === 3) { PT.fill(g, X + mw * 0.15, Y + rh * 0.3, mw * 0.7, rh * 0.4, '#a2a6a6'); for (let k = 0; k < 8; k++) PT.fill(g, X + mw * 0.15, Y + rh * (0.31 + k * 0.05), mw * 0.7, u * 1.2, '#6a6e6f'); }
        else { PT.fill(g, X + mw * 0.06, Y + rh * 0.12, mw * 0.88, rh * 0.06, '#7f8486'); PT.shutter(g, X + mw * 0.08, Y + rh * 0.18, mw * 0.84, rh * 0.82, R() < 0.5 ? '#b3b7b9' : '#a5a9aa'); }
      }
      PT.fill(g, 0, Y + rh - 1.5 * u, w, 1.5 * u, '#77756f');
    }
  }
});
// 手すり（たて格子・すかし。色をかける）
const tRail = () => T('rail', 64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); PT.fill(g, 0, 0, w, h * 0.1, '#f0f0ee'); PT.fill(g, 0, h * 0.92, w, h * 0.08, '#e4e4e0'); for (let u = 0; u < w; u += w / 8) PT.fill(g, u, 0, Math.max(1, w / 40), h, '#e8e8e5'); }, { alpha: true });
// ガラリ（くりかえし。屋上の目かくし・機械室。色をかける）。su 2
const tLouv = () => T('louv', 64, 64, (g, w, h) => { for (let k = 0; k < 8; k++) lin(g, 0, k * h / 8, w, (k + 1) * h / 8, '#eceeed', '#8b8f8e'); PT.fill(g, 0, 0, Math.max(1, w / 32), h, '#7b7f7e'); });

/* ---------- 共通の部品 ---------- */
// 箱の小物：正面 (fx, fz) に 質感のます uvF。ほかの面は 色 cs（uvS があれば 質感）
function pbox(B, m, cx, cz, fx, fz, w, d, y0, y1, uvF, cs, uvS) {
  const tx = -fz, tz = fx, hw = w / 2, hd = d / 2, p = (s, t) => [cx + tx * s + fx * t, cz + tz * s + fz * t];
  const a = p(-hw, hd), b = p(hw, hd), c = p(hw, -hd), d2 = p(-hw, -hd), ms = uvS ? m : 'c', cc = uvS ? WH : (cs || [0.8, 0.8, 0.78]);
  B.wall(m, a[0], a[1], b[0], b[1], y0, y1, WH, uvF);
  B.wall(ms, b[0], b[1], c[0], c[1], y0, y1, cc, uvS); B.wall(ms, c[0], c[1], d2[0], d2[1], y0, y1, cc, uvS); B.wall(ms, d2[0], d2[1], a[0], a[1], y0, y1, cc, uvS);
  B.quad(ms, [d2[0], y1, d2[1]], [c[0], y1, c[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [0, 1, 0], cc, uvS ? [uvS[0], uvS[2], uvS[1], uvS[3]] : null);
}
// 室外機（atlas）
function acu(B, x, z, fx, fz, y, s = 1) { pbox(B, tEQ(), x, z, fx, fz, 0.82 * s, 0.32 * s, y, y + 0.66 * s, cellUV(0, 0), [0.84, 0.84, 0.81]); }
// 自動販売機（k：0〜2）
function vend(B, x, z, fx, fz, k, y = 0) { pbox(B, tEQ(), x, z, fx, fz, 0.98, 0.72, y, y + 1.83, cellUV(k % 3, 1), [[0.9, 0.9, 0.88], [0.25, 0.42, 0.66], [0.75, 0.77, 0.78]][k % 3]); }
// 平らな ふた（向きのある 4つの点。上向き）
const quadUp = (B, m, p0, p1, p2, p3, y, c, uv) => B.quad(m, [p0[0], y, p0[1]], [p1[0], y, p1[1]], [p2[0], y, p2[1]], [p3[0], y, p3[1]], [0, 1, 0], c, uv);
// 板（看板など）：辺 e の from〜to・y0〜y1・外へ off（裏も 同じ色）
function panel(B, e, t0, t1, y0, y1, off, c, m, uv) { B.wallE(m || 'c', e, y0, y1, c, { from: t0, to: t1, off, uv }); }
// 看板の箱（辺 e の外 off に あつみ th の 板）
function signBox(B, e, t0, t1, y0, y1, off, th, c, cf) {
  const a = ept(e, t0, off), b = ept(e, t1, off), a2 = ept(e, t0, off + th), b2 = ept(e, t1, off + th);
  B.wall('c', a2[0], a2[1], b2[0], b2[1], y0, y1, cf || c);
  B.wall('c', a[0], a[1], a2[0], a2[1], y0, y1, mul(c, 0.85)); B.wall('c', b2[0], b2[1], b[0], b[1], y0, y1, mul(c, 0.85));
  quadUp(B, 'c', a, b, b2, a2, y1, mul(c, 0.9));
}
/* 1階の お店の 色（持ち主・借りている会社が えらぶ）：P.sc = [[c1, c2, c3] か null, …]（部屋ごと）。なければ 見た目の色 def */
const unitCols = (P, def) => (P && P.sc && P.sc.length ? P.sc : [null]).map(u => u && u.length ? [u[0] || def[0], u[1] || def[1], u[2] || def[2]] : def);
// 部屋を いくつかの 区間（[[from, to], …]）に 長さで わける → 区間ごとの P のかわり（{ sc, lod }）
function unitSplit(P, segs) {
  const sc = P.sc && P.sc.length ? P.sc : null, tot = segs.reduce((a, q) => a + Math.max(0, q[1] - q[0]), 0) || 1; let i0 = 0;
  return segs.map((q, j) => { if (!sc) return { sc: null, lod: P.lod }; const n = j === segs.length - 1 ? sc.length - i0 : Math.round(sc.length * Math.max(0, q[1] - q[0]) / tot), part = sc.slice(i0, i0 + Math.max(0, n)); i0 += Math.max(0, n); return { sc: part.length ? part : null, lod: P.lod }; });
}
// 部屋の色を 入れかえる（例：[1, 2, 2] → 帯は 2 番めの色）
const unitMap = (Q, def, ix) => ({ sc: Q.sc ? Q.sc.map(u => u && u.length ? ix.map(i => u[i] || def[i]) : null) : null, lod: Q.lod, def: ix.map(i => def[i]) });
// 看板の帯（A.shopBand）：lod 2 は うしろに 板（あつみ o.th）・lod 1 は 壁に 平らに・lod 0 は 1 色。o：{ from, to, def, pat, base, th, bc（板の色）, sub（P のかわり）}
function band(B, P, e, y0, y1, o) {
  const lod = P.lod, Q = o.sub || P, f0 = o.from || 0, f1 = o.to == null ? e.L : o.to;
  if (f1 - f0 < 0.3) return;
  if (lod <= 0) { const c = unitCols(Q, o.def)[0]; B.wallE('c', e, y0, y1, o.pat === 'stripes' ? (o.base || '#f4f4f2') : o.pat === 'awning' ? c[1] : c[0], { from: f0, to: f1, off: 0.1 }); return; }
  let off = 0.08;
  if (lod >= 2 && o.th) { signBox(B, e, f0, f1, y0 - 0.05, y1 + 0.05, 0.02, o.th, o.bc || [0.9, 0.9, 0.88]); off = 0.02 + o.th + 0.06; }
  A.shopBand(B, Q, e, y0, y1, { from: f0, to: f1, def: o.def, pat: o.pat || 'solid', base: o.base, off });
}
// 日よけ（色の 板。部屋の色 c0・しま c2）：辺 e の t0〜t1・下のはし y・出 dep
function awningC(B, e, t0, t1, y, dep, c0, c2, st) {
  const a = ept(e, t0, 0.04), b = ept(e, t1, 0.04), a2 = ept(e, t0, dep), b2 = ept(e, t1, dep), yt = y + dep * 0.5, L = t1 - t0;
  B.quad('c', [a[0], yt, a[1]], [b[0], yt, b[1]], [b2[0], y, b2[1]], [a2[0], y, a2[1]], null, c0);
  B.wall('c', a2[0], a2[1], b2[0], b2[1], y - 0.26, y, c0); B.wall('c', a2[0], a2[1], b2[0], b2[1], y - 0.26, y - 0.2, c2);
  if (!st) return;
  const n = Math.min(16, Math.floor(L / 0.5)), w = L / Math.max(1, n);
  for (let k = 0; k < n; k++) { const u0 = t0 + k * w + w * 0.5, u1 = u0 + w * 0.5, p = ept(e, u0, 0.05), q = ept(e, u1, 0.05), p2 = ept(e, u0, dep), q2 = ept(e, u1, dep);
    B.quad('cp', [p[0], yt + 0.01, p[1]], [q[0], yt + 0.01, q[1]], [q2[0], y + 0.01, q2[1]], [p2[0], y + 0.01, p2[1]], null, c2); B.wall('cp', p2[0] + e.nx * 0.01, p2[1] + e.nz * 0.01, q2[0] + e.nx * 0.01, q2[1] + e.nz * 0.01, y - 0.2, y, c2); }
}
// 日よけの 質感の行 → 色（[c0, c2, しま]）。古い 見た目の 色を そのまま
const AWC = [['#b9473c', '#f1ede4', 1], ['#3f7a4f', '#f1ede4', 1], ['#2f3f66', '#f1ede4', 1], ['#7a5236', '#eadfc8', 1], ['#2f5a3e', '#e9e4d8', 0], ['#7a2c2e', '#e9e4d8', 0], ['#36383b', '#e9e4d8', 0], ['#c99a3a', '#f0e7d2', 1]];
// 屋上の H（ヘリのしるし。円と H）
function heli(B, cx, cz, y, r, n = 20) {
  const c1 = [0.86, 0.86, 0.82], c2 = [0.42, 0.43, 0.42];
  for (let i = 0; i < n; i++) { const a0 = i / n * PI * 2, a1 = (i + 1) / n * PI * 2, P = (a, rr) => [cx + Math.cos(a) * rr, cz + Math.sin(a) * rr];
    const p0 = P(a0, r), p1 = P(a1, r), q0 = P(a0, r * 0.86), q1 = P(a1, r * 0.86);
    B.quad('c', [q0[0], y, q0[1]], [q1[0], y, q1[1]], [p1[0], y, p1[1]], [p0[0], y, p0[1]], [0, 1, 0], c1);
    B.tri('c', [cx, y - 0.01, cz], [q1[0], y - 0.01, q1[1]], [q0[0], y - 0.01, q0[1]], [0, 1, 0], c2); }
  const s = r * 0.42, t = r * 0.09;
  B.flat('c', [cx - s, cz - s, cx - s + 2 * t, cz + s], y + 0.01, c1); B.flat('c', [cx + s - 2 * t, cz - s, cx + s, cz + s], y + 0.01, c1); B.flat('c', [cx - s + 2 * t, cz - t, cx + s - 2 * t, cz + t], y + 0.01, c1);
}
// 外の壁（質感 m を m 単位で：su・sv）。辺ごと
function wallsM(B, m, F, y0, y1, c, su = 4, sv = 4, o = {}) { for (const e of F.edges) { if (o.only && !o.only(e)) continue; B.wallE(m, e, y0, y1, c, { uv: [e.u0 / su, (e.u0 + e.L) / su, y0 / sv, y1 / sv], ao: o.ao, off: o.off }); } }
// パラペット（外は 無地の壁の質感 tWC に色 c）。lod 0 は なし・lod 1 は 外の壁だけ（裏から見えるので 中の壁のかわり）
function para(B, F, y, h, c, lod, t = 0.3) {
  if (lod <= 0) return F;
  wallsM(B, tWC(), F, y, y + h, c);
  if (lod === 1) return F;
  return B.parapet(F, y, h, t, mul(c, 0.92), { noOuter: true });
}
// 屋上（押えコンクリート）
const roofFlat = (B, F, y, k = 1) => B.cap(tFlat(), F, y, [k, k, k * 0.99], { su: 12 });
// 屋上の しあげ（L.rfin：['j'（目地のある コンクリート）| 'u'（防水の ぬり：緑や灰色）, 色]）
const roofFin = (B, F, y, L) => { const r = L && L.rfin; if (r && r[0] === 'u') B.cap(tWC(), F, y, col(r[1]), { su: 4 }); else B.cap(tFlat(), F, y, r ? col(r[1]) : [1, 1, 0.99], { su: 12 }); };

/* ---------- 屋上の設備 ---------- */
// 塔屋（階段・エレベーター）・室外機・キュービクル・避雷針・アンテナ。r：いちばん大きい長方形。o：{ c（塔屋の色）, sign（看板の色 → 正面に）, fn, tank, n（室外機の数のめやす）}
function roofKit(B, r, y, P, o = {}) {
  const R = P.rng, lod = P.lod, w = r[2] - r[0], d = r[3] - r[1]; if (w < 5 || d < 5) return y;
  const fn = o.fn || [0, 1], fr = frame(r, fn), c = o.c || [0.86, 0.85, 0.82];
  let top = y;
  // 塔屋
  if (o.ph !== false && fr.W > 8 && fr.D > 7) {
    const pw = cl(fr.W * 0.28, 4, 9), pd = cl(fr.D * 0.32, 3.5, 7), pu = fr.W * (0.15 + 0.5 * R()), pv = fr.D * (0.3 + 0.25 * R());
    const pr = fr.rect(pu, pv, pu + pw, pv + pd), ph = 3.4;
    B.box(tWC(), pr[0], pr[1], pr[2], pr[3], y, y + ph, c, { su: 4, sv: 4, mt: 'c', ct: mul(c, 0.82) });
    B.box('c', pr[0] - 0.15, pr[1] - 0.15, pr[2] + 0.15, pr[3] + 0.15, y + ph, y + ph + 0.25, mul(c, 0.9));
    // エレベーターの機械室（少し高い）
    const er = fr.rect(pu + pw * 0.55, pv + pd * 0.15, pu + pw * 0.95, pv + pd * 0.7);
    B.box(tWC(), er[0], er[1], er[2], er[3], y + ph + 0.25, y + ph + 1.9, c, { su: 4, sv: 4, mt: 'c', ct: mul(c, 0.8) });
    top = y + ph + 1.9;
    if (lod >= 2) { const e = fr.edge(pu, pu + pw, pv); const pd2 = ept(e, pw * 0.3, 0.02); pbox(B, tEQ(), pd2[0], pd2[1], fn[0], fn[1], 0.95, 0.06, y, y + 2.1, cellUV(2, 0), c);
      const lr = fr.p(pu + pw * 0.8, pv + pd * 0.4); B.box('c', lr[0] - 0.04, lr[1] - 0.04, lr[0] + 0.04, lr[1] + 0.04, top, top + 3.5, [0.5, 0.5, 0.5]); }
    if (o.sign && lod >= 1) { const e = fr.edge(pu, pu + pw, pv); signBox(B, e, pw * 0.08, pw * 0.92, y + 0.8, y + ph - 0.3, 0.08, 0.25, o.sign, o.sign2); }
  }
  // 高置水槽（古いビル）
  if (o.tank && fr.W > 10 && fr.D > 10) { const p = fr.p(fr.W * 0.75, fr.D * 0.7); B.box('c', p[0] - 1.6, p[1] - 1.2, p[0] + 1.6, p[1] + 1.2, y, y + 1.6, [0.45, 0.46, 0.46]); B.box(tLouv(), p[0] - 1.5, p[1] - 1.1, p[0] + 1.5, p[1] + 1.1, y + 1.6, y + 3.6, [0.82, 0.86, 0.84], { su: 1.5, sv: 2, mt: 'c', ct: [0.74, 0.77, 0.76] }); top = Math.max(top, y + 3.6); }
  if (lod < 2) return top;
  // 室外機（列）・キュービクル
  const nAC = Math.min(o.nmax || 18, Math.round(Math.sqrt(w * d) / 3 * (o.n || 1)));
  for (let k = 0, placed = 0; k < 6 && placed < nAC; k++) {
    const ru = fr.W * (0.1 + 0.75 * R()), rv = fr.D * (0.1 + 0.75 * R()), n = Math.min(nAC - placed, 2 + (R() * 4 | 0));
    for (let q = 0; q < n; q++) { const p = fr.p(ru + q * 0.95, rv); if (!(p[0] > r[0] + 0.8 && p[0] < r[2] - 0.8 && p[1] > r[1] + 0.8 && p[1] < r[3] - 0.8)) continue; acu(B, p[0], p[1], fn[0], fn[1], y + 0.15); placed++; }
    const p0 = fr.p(ru - 0.5, rv), p1 = fr.p(ru + n * 0.95 - 0.45, rv); B.box('c', Math.min(p0[0], p1[0]) - 0.2, Math.min(p0[1], p1[1]) - 0.3, Math.max(p0[0], p1[0]) + 0.2, Math.max(p0[1], p1[1]) + 0.3, y, y + 0.15, [0.55, 0.55, 0.53]);
  }
  if (w * d > 300) { const p = fr.p(fr.W * (0.6 + 0.25 * R()), fr.D * 0.15 + 1.5); pbox(B, tEQ(), p[0], p[1], fn[0], fn[1], 3.2, 1.6, y, y + 2.2, cellUV(3, 0), [0.8, 0.79, 0.74]); }
  if (w * d > 600 && o.ct !== false) {   // 冷却塔・配管
    const p = fr.p(fr.W * (0.12 + 0.2 * R()), fr.D * (0.62 + 0.2 * R())); B.box('c', p[0] - 1.9, p[1] - 1.9, p[0] + 1.9, p[1] + 1.9, y, y + 0.3, [0.5, 0.5, 0.48]); B.box(tLouv(), p[0] - 1.7, p[1] - 1.7, p[0] + 1.7, p[1] + 1.7, y + 0.3, y + 3.4, [0.88, 0.9, 0.9], { su: 1.7, sv: 1.55, mt: 'c', ct: [0.45, 0.47, 0.48] }); B.cyl('c', p[0], p[1], 1.25, y + 3.4, y + 4.1, 10, [0.78, 0.8, 0.81], { ct: [0.28, 0.29, 0.3] });
    const q = fr.p(fr.W * 0.5, fr.D * 0.45); B.box('c', Math.min(p[0], q[0]) - 0.2, p[1] - 0.2, Math.max(p[0], q[0]) + 0.2, p[1] + 0.2, y + 0.5, y + 0.85, [0.62, 0.63, 0.62]); B.box('c', q[0] - 0.2, Math.min(p[1], q[1]) - 0.2, q[0] + 0.2, Math.max(p[1], q[1]) + 0.2, y + 0.5, y + 0.85, [0.62, 0.63, 0.62]); top = Math.max(top, y + 4.1); }
  if (o.ant) { const p = fr.p(fr.W * 0.85, fr.D * 0.85); B.box('c', p[0] - 0.08, p[1] - 0.08, p[0] + 0.08, p[1] + 0.08, y, y + 6, [0.55, 0.56, 0.57]); B.box('c', p[0] - 0.9, p[1] - 0.03, p[0] + 0.9, p[1] + 0.03, y + 5.2, y + 5.3, [0.55, 0.56, 0.57]); }
  return top;
}

/* ---------- オフィス（白いPCa・タイル・ガラス・石・アルミ・ルーバー・打ちはなし…） ---------- */
// 外壁の質感：4 柱間 × 4 階
const OFD = [
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 1 白いPCa・横連窓
    PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#e7e5df', n: 0.02 }, R);
    for (let j = 0; j < 4; j++) { const Y = j * mh, wy = Y + mh * 0.28, wh = mh * 0.46;
      PT.streaks(g, 0, wy + wh, w, mh * 0.5, 10, 0.05, R);
      for (let i = 0; i < 8; i++) glass(g, i * mw / 2, wy, mw / 2, wh, R, { bl: 0.5, lit: 0.06, g0: '#b1c3d0', g1: '#4a5a68' });
      for (let i = 0; i <= 8; i++) PT.fill(g, i * mw / 2 - u, wy, i % 2 ? 1.5 * u : 2.5 * u, wh, '#b5b9bb');
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, wy, w, 2 * u);
      PT.fill(g, 0, wy + wh - u, w, 1.6 * u, '#d2d4d3');
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, Y + mh - u, w, u); for (let i = 0; i < 4; i++) { g.fillRect(i * mw, Y, u, wy - Y); g.fillRect(i * mw, wy + wh, u, Y + mh - wy - wh); }
    } },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 2 ベージュのタイル・ポツ窓
    PT.wallMat(g, 0, 0, w, h, { t: 'tile', c: '#d6c5a6', sc: u, j: '#9a8e7b' }, R);
    for (let j = 0; j < 4; j++) PT.fill(g, 0, j * mh + mh - 3 * u, w, 3 * u, '#c3b294');
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) pwin(g, i * mw + mw * 0.15, j * mh + mh * 0.24, mw * 0.7, mh * 0.48, R, { u, rev: 0.32, f: '#b8bbbc', dv: 2, bl: 0.45, cur: 0.08, lit: 0.06, sill: '#cbc4b4' });
    PT.streaks(g, 0, 0, w, h, 16, 0.045, R); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 3 ブルーのガラス
    const bg = g.createLinearGradient(0, 0, w * 0.6, h); bg.addColorStop(0, '#7f9db6'); bg.addColorStop(0.45, '#3f5e7a'); bg.addColorStop(0.7, '#5a7b98'); bg.addColorStop(1, '#3a5672'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) { const X = i * mw / 2, Y = j * mh; g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,' + (0.03 + R() * 0.07) + ')' : 'rgba(0,10,30,' + (0.04 + R() * 0.08) + ')'; g.fillRect(X, Y, mw / 2, mh);
      if (R() < 0.3) { g.fillStyle = 'rgba(215,218,214,.22)'; g.fillRect(X, Y + mh * 0.04, mw / 2, mh * (0.2 + 0.45 * R())); } }
    for (let j = 0; j < 4; j++) { const Y = j * mh; lin(g, 0, Y + mh * 0.78, w, Y + mh, '#2c4258', '#22364a'); PT.fill(g, 0, Y + mh * 0.78, w, 1.5 * u, '#9fb0bd'); }
    for (let i = 0; i <= 8; i++) PT.fill(g, i * mw / 2 - u * 0.8, 0, i % 2 ? 1.2 * u : 2 * u, h, '#a9b6c0');
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(w * 0.1, 0); g.lineTo(w * 0.35, 0); g.lineTo(w * 0.05, h); g.lineTo(-w * 0.2, h); g.closePath(); g.fill(); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 4 グレーの石張り・縦長窓
    PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#a3a19c', n: 0.06 }, R);
    for (let k = 0; k < w * h / 60; k++) { g.fillStyle = R() < 0.5 ? 'rgba(40,40,40,.25)' : 'rgba(255,255,255,.22)'; g.fillRect(R() * w, R() * h, u, u); }
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let j = 0; j < 8; j++) g.fillRect(0, j * mh / 2, w, u * 0.8); for (let i = 0; i < 8; i++) g.fillRect(i * mw / 2, 0, u * 0.8, h);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) pwin(g, i * mw + mw * (0.12 + k * 0.42), j * mh + mh * 0.14, mw * 0.34, mh * 0.66, R, { u, rev: 0.45, f: '#55595c', dv: 1, dh: 1, bl: 0.4, lit: 0.07, g0: '#9fb0bd', g1: '#36434e' });
    PT.streaks(g, 0, 0, w, h, 14, 0.05, R); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 5 銀色のアルミパネル
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) lin(g, i * mw / 2, j * mh / 2, (i + 1) * mw / 2, (j + 1) * mh / 2, '#d3d7da', '#b2b7bb', true);
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let j = 0; j < 8; j++) g.fillRect(0, j * mh / 2, w, u); for (let i = 0; i < 8; i++) g.fillRect(i * mw / 2, 0, u, h);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) pwin(g, i * mw + mw * 0.04, j * mh + mh * 0.34, mw * 0.92, mh * 0.36, R, { u, rev: 0.2, f: '#7f858a', dv: 3, bl: 0.5, lit: 0.06, g0: '#a7b8c4', g1: '#3f4d59' });
    PT.noise(g, 0, 0, w, h, 0.015, R); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 6 白い縦ルーバー
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) glass(g, i * mw / 2, j * mh, mw / 2, mh, R, { bl: 0.4, lit: 0.08, g0: '#9fb2c0', g1: '#3d4b57', ra: 0.06 });
    for (let j = 0; j < 4; j++) { const Y = j * mh; PT.fill(g, 0, Y + mh * 0.84, w, mh * 0.16, '#e9e8e3'); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, Y + mh * 0.84 - u, w, u); }
    for (let i = 0; i < 12; i++) { const X = i * mw / 3; PT.fill(g, X, 0, 3.5 * u, h, '#eeede8'); PT.fill(g, X + 3.5 * u, 0, 2 * u, h, '#a9aba8'); g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(X + 5.5 * u, 0, 3 * u, h); } },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 7 茶色のタイル・格子窓
    PT.wallMat(g, 0, 0, w, h, { t: 'brick', c: '#86654f', c2: '#6f513e', sc: u * 0.8 }, R);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(X, Y, 3 * u, mh); g.fillRect(X, Y + mh - 3 * u, mw, 3 * u);
      pwin(g, X + mw * 0.13, Y + mh * 0.2, mw * 0.74, mh * 0.52, R, { u, rev: 0.45, f: '#cfd0cd', dv: 2, dh: 2, bl: 0.4, cur: 0.1, lit: 0.06, sill: '#b7aa9c' }); }
    PT.streaks(g, 0, 0, w, h, 14, 0.05, R); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 8 打ちはなし・大きな窓
    PT.wallMat(g, 0, 0, w, h, { t: 'concrete', c: '#b6b4ad', pw: 18, ph: 32, sc: u, n: 0.04 }, R);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) pwin(g, i * mw + mw * 0.08, j * mh + mh * 0.18, mw * 0.84, mh * 0.58, R, { u, fw: 1.3 * u, rev: 0.3, f: '#2f3133', dv: 3, bl: 0.35, lit: 0.08, g0: '#9db0bf', g1: '#38444f' });
    PT.streaks(g, 0, 0, w, h, 26, 0.08, R); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 9 黒いガラス張り
    const bg = g.createLinearGradient(0, 0, w * 0.5, h); bg.addColorStop(0, '#59646f'); bg.addColorStop(0.5, '#262c33'); bg.addColorStop(1, '#3c4550'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) { const X = i * mw / 2, Y = j * mh; if (R() < 0.18) { g.fillStyle = 'rgba(255,240,210,.12)'; g.fillRect(X, Y, mw / 2, mh * 0.8); } }
    for (let j = 0; j < 4; j++) PT.fill(g, 0, j * mh + mh * 0.84, w, mh * 0.16, '#1c1f23');
    for (let i = 0; i <= 8; i++) PT.fill(g, i * mw / 2 - u * 0.6, 0, 1.2 * u, h, '#15171a');
    g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(w * 0.5, 0); g.lineTo(w * 0.8, 0); g.lineTo(w * 0.45, h); g.lineTo(w * 0.15, h); g.closePath(); g.fill(); },
  (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;   // 10 レンガ色のタイル・白い窓
    PT.wallMat(g, 0, 0, w, h, { t: 'brick', c: '#9a5a44', c2: '#7f4535', sc: u * 0.8 }, R);
    for (let j = 0; j < 4; j++) { PT.fill(g, 0, j * mh + mh - 4 * u, w, 4 * u, '#d9d2c3'); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, j * mh + mh, w, u); }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) pwin(g, i * mw + mw * 0.2, j * mh + mh * 0.2, mw * 0.6, mh * 0.55, R, { u, rev: 0.35, f: '#eceae4', dv: 2, dh: 1, bl: 0.35, cur: 0.15, lit: 0.06, sill: '#e3ddcf' });
    PT.streaks(g, 0, 0, w, h, 12, 0.05, R); },
];
const OFO = [{}, {}, { shiny: '#6a7480', sh: 30 }, {}, { shiny: '#50565c', sh: 20 }, {}, {}, {}, { shiny: '#707880', sh: 40 }, {}];
const tOF = k => T('of' + k, 256, 256, OFD[k - 1], OFO[k - 1]);
// 見た目：tx（質感）・top（屋上：pent 塔屋と看板・tank 水槽・glass ガラスの目かくし・cornice 軒・screen ガラリ・frame 高いパラペット・step 段）・pc（パラペットの色）
const OFL = [
  { n: '白いPCa・横連窓', tx: 1, top: 'pent', rfin: ['j', '#ffffff'], pc: '#e3e1db', sg: '#e9ecef', sg2: '#2f5f8a' },
  { n: 'ベージュのタイル', tx: 2, top: 'tank', rfin: ['u', '#a7b9a2'], pc: '#d1c1a2', sg: '#f0efe9' },
  { n: 'ブルーのガラス張り', tx: 3, top: 'glass', rfin: ['j', '#dfe1e2'], pc: '#7d93a6', fh: 4.0 },
  { n: 'グレーの石張り', tx: 4, top: 'cornice', rfin: ['j', '#c9c9c4'], pc: '#a5a39e' },
  { n: '銀色のアルミパネル', tx: 5, top: 'screen', rfin: ['u', '#c2c5c4'], pc: '#c6cacd' },
  { n: '白い縦ルーバー', tx: 6, top: 'frame', rfin: ['j', '#f2f2ee'], pc: '#e9e8e3', fh: 4.0 },
  { n: '茶色のタイル', tx: 7, top: 'pent', rfin: ['u', '#9db19a'], pc: '#80614c', sg: '#ece9e2', sg2: '#7a2f2a' },
  { n: '打ちはなし', tx: 8, top: 'frame', rfin: ['j', '#e2e0da'], pc: '#b4b2ab' },
  { n: '黒いガラス張り', tx: 9, top: 'screen', rfin: ['u', '#8a8c8d'], pc: '#2f3338', fh: 4.0 },
  { n: 'レンガ色のタイル', tx: 10, top: 'step', rfin: ['u', '#aab3a3'], pc: '#93553f', sg: '#efece4' },
];
// ロビー（辺 e の 1階。入口はまん中）。返り値：入口の範囲 [t0, t1]
function lobby(B, e, y0, y1, bw, o = {}) {
  const m = tGF(), nb = Math.max(1, Math.round(e.L / bw)), b = e.L / nb, nd = nb >= 6 ? 2 : 1, d0 = Math.floor((nb - nd) / 2);
  const rA = o.r0 == null ? 0 : o.r0, rB = o.r1 == null ? 1 : o.r1;
  const seg = (k0, k1, r) => { if (k1 <= k0) return; const [v0, v1] = rowV(r, 4); B.wallE(m, e, y0, y1, WH, { from: k0 * b, to: k1 * b, uv: [k0 / 4, k1 / 4, v0, v1], ao: 0.9 }); };
  seg(0, d0, rA); seg(d0, d0 + nd, rB); seg(d0 + nd, nb, rA);
  return [d0 * b, (d0 + nd) * b];
}
// 1階の お店の 帯の色（見た目の 標準）
const GSH = [['#2f4a6e', '#f2f2ee', '#c9a54a'], ['#6a3a3a', '#f2f2ee', '#6a3a3a'], ['#2e5a3c', '#efe8d6', '#2e5a3c'], ['#3b3d41', '#e8e4da', '#b9a77c']];
// 入口のひさし（辺 e の t0〜t1）
function canopy(B, e, t0, t1, y, dep, c, lod, cols) {
  B.ledge(e, y, y + 0.35, dep, c, { from: Math.max(0, t0), to: Math.min(e.L, t1) });
  if (lod >= 2 && cols) for (const t of [t0 + 0.3, t1 - 0.3]) { const p = ept(e, cl(t, 0.2, e.L - 0.2), dep - 0.35); B.box('c', p[0] - 0.12, p[1] - 0.12, p[0] + 0.12, p[1] + 0.12, 0, y, [0.55, 0.56, 0.57]); }
}
// 植えこみ（辺 e の前。lod 2）
function planters(B, e, t0, t1, P, c) {
  if (P.lod < 2) return; const R = P.rng;
  const st = Math.max(3, (t1 - t0) / 12);
  for (let t = t0; t < t1 - 1.2; t += st + R() * 3) { const p = ept(e, t + 0.6, 1.0); B.box('c', p[0] - 0.6, p[1] - 0.45, p[0] + 0.6, p[1] + 0.45, 0, 0.5, c || [0.62, 0.6, 0.56]); B.box('c', p[0] - 0.5, p[1] - 0.35, p[0] + 0.5, p[1] + 0.35, 0.5, 0.85, [0.3, 0.42, 0.24]); }
}
// 広場（f = 0 のとき。舗装と木）
function plaza(B, P) {
  const F = P.F; B.plinth(F, P.yb, 0.06, [0.6, 0.6, 0.58]); B.cap('c', F, 0.06, [0.72, 0.71, 0.68]);
  if (P.lod >= 1) { const R = P.rng, n = Math.min(P.lod >= 2 ? 12 : 5, Math.round(Math.sqrt(F.area) / 6)); for (let i = 0; i < n; i++) { const r = A.pick(R, F.rects), x = r[0] + 2 + (r[2] - r[0] - 4) * R(), z = r[1] + 2 + (r[3] - r[1] - 4) * R(); treeL(B, x, z, 0.06, 5 + 3 * R(), 1.8 + R(), P.lod); } }
}
// 箱の階（facade）を 1階・上の階で：o：{ m（上の質感）, gh, fh, bw, top（壁の上）, fe（正面の辺。ロビー）, lob（ロビーにする）}
function offMass(B, F, P, o) {
  const m = o.m, gh = o.gh, fh = o.fh, bw = o.bw, H = o.top, bl = o.blank;
  if (o.y0 == null || o.y0 <= 0) {
    const fe = o.fe;
    B.facade(m, F, 0, gh, { bw, fh: gh, tb: 4, tf: 4, vy: 0, ao: 0.82, only: e => (!fe || e !== fe) && !(bl && bl(e)) });
    let ent = null;
    const shops = fe && P.lod >= 1 && (P.pr.g1 === 'shop' || (P.sc && P.sc.length) || P.shop1);
    if (fe) ent = lobby(B, fe, 0, gh, bw, shops ? Object.assign({}, o, { r0: 2 }) : o);
    if (shops) {   // 入口の 両がわは お店（ショーウィンドウと 看板の帯。色は 部屋ごと）
      const segs = [[0.3, ent[0] - 0.3], [ent[1] + 0.3, fe.L - 0.3]].filter(q => q[1] - q[0] > 1.5), subs = unitSplit(P, segs), def = GSH[P.id % GSH.length];
      segs.forEach((q, j) => band(B, P, fe, gh * 0.8, gh * 0.96, { from: q[0], to: q[1], def, pat: 'solid', th: 0.15, bc: [0.85, 0.85, 0.83], sub: subs[j] }));
    }
    if (H > gh) B.facade(m, F, gh, H, { bw, fh, tb: 4, tf: 4, vy: gh, only: e => !(bl && bl(e)) });
    if (bl) for (const e of F.edges) if (bl(e)) B.wallE(tWT(), e, 0, H, o.bc || WH, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, H / 4], ao: 0.85 });   // 窓のない 横の壁（となりと くっつく）
    return ent;
  }
  B.facade(m, F, o.y0, H, { bw, fh, tb: 4, tf: 4, vy: gh });
  return null;
}
// 屋上のしあげ（見た目ごと）
function offTop(B, F, H, L, P, fn, o = {}) {
  const lod = P.lod, pc = col(L.pc), R = P.rng;
  let ph = L.top === 'frame' ? 1.6 : 1.0;
  if (L.top === 'cornice' && lod >= 1) for (const e of F.edges) B.ledge(e, H - 0.6, H, 0.55, mul(pc, 1.02), { ct: mul(pc, 1.05) });
  if (L.top === 'glass') { ph = 1.8; B.facade(tOF(3), F, H, H + ph, { bw: 3.2, fh: 4, tb: 4, tf: 4, vy: H - 3.2 }); if (lod >= 1) B.parapet(F, H, ph, 0.2, [0.55, 0.6, 0.66], { noOuter: true }); else B.cap('c', F, H + ph - 0.05, [0.5, 0.55, 0.6]); }
  else para(B, F, H, ph, pc, lod);
  roofFin(B, F, H + 0.02, L);
  if (lod <= 0) return H + ph;
  const r = bigR(F), RW = r[2] - r[0], RD = r[3] - r[1];
  let top = H + ph;
  if (o.heli && RW > 22 && RD > 22) { heli(B, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, H + 0.08, Math.min(RW, RD) * 0.3, lod >= 2 ? 20 : 10); return top; }
  if (L.top === 'screen' && RW > 10 && RD > 10) {   // 設備の目かくし（ガラリ）
    const fr = frame(r, fn), sr = A.rin(fr.rect(fr.W * 0.2, fr.D * 0.25, fr.W * 0.8, fr.D * 0.8), 0), Fs = rf(sr[0], sr[1], sr[2], sr[3]);
    wallsM(B, tLouv(), Fs, H, H + 2.6, mul(pc, 1.05), 2, 2.6); for (const e of Fs.edges) B.wall(tLouv(), e.bx, e.bz, e.ax, e.az, H, H + 2.6, mul(pc, 0.8), [0, e.L / 2, 0, 1]);
    top = Math.max(top, H + 2.6);
    if (lod >= 2) { const n = Math.min(10, Math.round((sr[2] - sr[0]) / 1.2)); for (let i = 0; i < n; i++) acu(B, sr[0] + 0.8 + i * 1.1, (sr[1] + sr[3]) / 2, 0, 1, H + 0.1); }
    roofKit(B, r, H, P, { fn, c: mul(pc, 1.0), ph: RW > 25 && RD > 25, n: 0.5 });
    return top;
  }
  top = Math.max(top, roofKit(B, r, H, P, { fn, c: L.top === 'pent' || L.top === 'tank' ? mul(pc, 1.0) : [0.84, 0.83, 0.8], sign: L.sg && L.top === 'pent' ? col(L.sg) : null, sign2: L.sg2 ? col(L.sg2) : null, tank: L.top === 'tank', ant: o.ant }));
  return top;
}
// オフィスを建てる
function office(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng;
  if (P.f <= 0) { plaza(B, P); return; }
  const f = P.f, F0 = insP(P, ko.set != null ? ko.set : (P.F.area > 4000 ? 2.5 : 0.5)), fn = fnOf(F0, P);
  const gh = ko.gh || 4.8, fh = L.fh || 3.9, bw = 3.2, m = tOF(L.tx), H = gh + (f - 1) * fh;
  if (lod >= 1 || P.yb < -0.5) B.plinth(F0, P.yb, 0.12, [0.6, 0.59, 0.56]);
  const fe = A.frontEdge(F0, P.front);
  if (ko.lab && F0.area > 3000) { campus(B, L, P, F0, fn); return; }
  if (ko.emb) embassyYard(B, P, fn);
  if (lod <= 0) {   // 遠く：箱と屋上だけ
    offMass(B, F0, P, { m, gh, fh, bw, top: H, fe }); roofFin(B, F0, H, L);
    return;
  }
  if (ko.tv || ko.press) { const ok = office2(B, L, P, F0, fn, fe, m, gh, fh, bw, H); if (ok) return; }
  // 大きな区画で 高いときは 低層部＋塔
  const big = F0.area > 2600 && f >= 9;
  if (big) {
    const np = cl(Math.round(f * 0.16), 2, 4), Hp = gh + (np - 1) * fh, r0 = bigR(F0), fr = frame(r0, fn);
    const TW = Math.min(fr.W - 8, 58), TD = Math.min(fr.D - 8, 42);
    const ent = offMass(B, F0, P, { m, gh, fh, bw, top: Hp, fe });
    para(B, F0, Hp, 1.0, col(L.pc), lod); roofFin(B, F0, Hp + 0.02, L);
    if (ent && lod >= 1) canopy(B, fe, ent[0] - 1, ent[1] + 1, 3.6, 3.0, [0.55, 0.56, 0.58], lod, true);
    if (TW >= 12 && TD >= 12) {
      const two = fr.W - 8 > 2.3 * TW && ko.twin !== false, ws = two ? [[fr.W * 0.25 - TW / 2, TW], [fr.W * 0.75 - TW / 2, TW]] : [[(fr.W - TW) / 2, TW]];
      for (const [u0, tw] of ws) {
        const tr = fr.rect(u0, Math.max(4, (fr.D - TD) * 0.45), u0 + tw, Math.max(4, (fr.D - TD) * 0.45) + TD), Ft = rf(tr[0], tr[1], tr[2], tr[3]);
        let Ht = H;
        if (L.top === 'step' && f >= 12) { Ht = H - 2 * fh; B.facade(m, Ft, Hp, Ht, { bw, fh, tb: 4, tf: 4, vy: gh }); para(B, Ft, Ht, 1.1, col(L.pc), lod); roofFin(B, Ft, Ht + 0.02, L); const Fs = A.inset(Ft, 3); B.facade(m, Fs, Ht, H, { bw, fh, tb: 4, tf: 4, vy: gh }); offTop(B, Fs, H, Object.assign({}, L, { top: 'pent' }), P, fn, { heli: f >= 25 }); }
        else { B.facade(m, Ft, Hp, H, { bw, fh, tb: 4, tf: 4, vy: gh }); offTop(B, Ft, H, L, P, fn, { heli: f >= 25 && !ko.tv }); }
        if (ko.tv && u0 === ws[0][0]) tvKit(B, tr, fn, H + 1, P);
        void Ht;
      }
    } else { B.facade(m, F0, Hp, H, { bw, fh, tb: 4, tf: 4, vy: gh }); offTop(B, F0, H, L, P, fn, {}); }
    if (lod >= 2) planters(B, fe, 1, fe.L - 1, P);
    return;
  }
  // ふつうの箱（せまい区画は 横の壁に 窓なし・外階段）
  let Hm = H, Fs = null;
  if (L.top === 'step' && f >= 6) { Hm = H - (f >= 12 ? 2 : 1) * fh; Fs = A.inset(F0, 2.5); if (Fs === F0 || Fs.area < 60) { Fs = null; Hm = H; } }
  const narrow = F0.rects.length === 1 && fe.L <= 15 && F0.area / fe.L >= fe.L * 0.9 && !ko.emb, side = e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5;
  const ent = offMass(B, F0, P, { m, gh, fh, bw, top: Hm, fe, blank: narrow ? side : null, bc: mix(L.pc, '#ffffff', 0.15) });
  if (narrow && lod >= 2 && f >= 3) { const se = F0.edges.find(side); if (se && se.L > 7) { const t0 = se.L - 3.6, e2 = esub(se, t0, t0 + 2.8, 0); for (let k = 1; k < f; k++) { const y = gh + (k - 1) * fh; B.ledge(e2, y - 0.12, y, 1.3, [0.44, 0.45, 0.46]); B.rail(tRail(), e2, y, 1.1, 1.3, [0.5, 0.51, 0.52], { su: 0.8 }); } }
    for (const e of F0.edges) if (side(e)) for (let k = 1; k < f; k += 2) { const p = ept(e, e.L * (0.25 + 0.15 * (k % 3)), 0.18); acu(B, p[0], p[1], e.nx, e.nz, gh + (k - 1) * fh + 0.4); } }
  if (Fs) { para(B, F0, Hm, 1.1, col(L.pc), lod); roofFin(B, F0, Hm + 0.02, L); B.facade(m, Fs, Hm, H, { bw, fh, tb: 4, tf: 4, vy: gh }); offTop(B, Fs, H, Object.assign({}, L, { top: 'pent' }), P, fn, { heli: f >= 25, ant: ko.ant }); }
  else offTop(B, F0, H, L, P, fn, { heli: f >= 25, ant: ko.ant });
  if (ent && lod >= 1) canopy(B, fe, ent[0] - 0.8, ent[1] + 0.8, 3.5, f >= 8 ? 2.6 : 1.6, [0.58, 0.59, 0.6], lod, f >= 8);
  if (lod >= 2) planters(B, fe, 0.8, fe.L - 0.8, P);
  void R;
}
// 放送局・新聞社：ふつうの箱＋屋上の アンテナ塔・パラボラ・ヘリのしるし
function office2(B, L, P, F0, fn, fe, m, gh, fh, bw, H) {
  const ko = P.ko, lod = P.lod, R = P.rng;
  if (F0.area > 2600 && P.f >= 9) return false;   // 大きいときは ふつうの 低層部＋塔（塔の上に しるし）
  const ent = offMass(B, F0, P, { m, gh, fh, bw, top: H, fe });
  para(B, F0, H, 1.0, col(L.pc), lod, 0.3); roofFin(B, F0, H + 0.02, L);
  if (ent) canopy(B, fe, ent[0] - 0.8, ent[1] + 0.8, 3.5, 2.6, [0.58, 0.59, 0.6], lod, true);
  const r = bigR(F0), fr = frame(r, fn), w = r[2] - r[0], d = r[3] - r[1];
  if (w > 24 && d > 24) heli(B, ...fr.p(fr.W * 0.35, fr.D * 0.5), H + 0.08, Math.min(w, d) * 0.22, lod >= 2 ? 20 : 10);
  roofKit(B, fr.rect(fr.W * 0.62, 0, fr.W, fr.D), H, P, { fn, c: col(L.pc), ant: true });
  if (ko.tv) tvKit(B, r, fn, H, P);
  if (lod >= 2) planters(B, fe, 0.8, fe.L - 0.8, P);
  void R;
  return true;
}
// 放送局の 鉄塔（赤白）とパラボラ（屋上の 長方形 r・高さ H）
function tvKit(B, r, fn, H, P) {
  const lod = P.lod, fr = frame(r, fn);
  {
    const p = fr.p(fr.W * 0.82, fr.D * 0.75), th = Math.min(60, 20 + P.f * 1.5), seg = 4;
    for (let k = 0; k < seg; k++) { const y0 = H + k * th / seg, y1 = y0 + th / seg, s0 = 2.6 * (1 - k / seg * 0.75), c = k % 2 ? [0.92, 0.92, 0.9] : [0.82, 0.22, 0.16];
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('c', p[0] + dx * s0 - 0.12, p[1] + dz * s0 - 0.12, p[0] + dx * s0 + 0.12, p[1] + dz * s0 + 0.12, y0, y1, c);
      if (lod >= 2) B.box('c', p[0] - s0, p[1] - s0, p[0] + s0, p[1] + s0, y1 - 0.2, y1, c); }
    B.box('c', p[0] - 0.15, p[1] - 0.15, p[0] + 0.15, p[1] + 0.15, H + th, H + th + 6, [0.85, 0.85, 0.85]);
    for (let k = 0; k < 3; k++) { const q = fr.p(fr.W * (0.2 + 0.14 * k), fr.D * 0.85); B.box('c', q[0] - 0.2, q[1] - 0.2, q[0] + 0.2, q[1] + 0.2, H, H + 1.6, [0.5, 0.5, 0.5]); B.cyl('c', q[0], q[1], 1.6 + k * 0.3, H + 1.6, H + 2.0, lod >= 2 ? 12 : 8, [0.94, 0.94, 0.92]); }
  }
}
// 研究所のキャンパス：低い棟を ならべる・芝生・道・駐車場
function campus(B, L, P, F0, fn) {
  const lod = P.lod, R = P.rng, r0 = bigR(F0), fr = frame(r0, fn), gh = 4.6, fh = L.fh || 3.9, m = tOF(L.tx);
  B.cap('c', F0, 0.04, [0.46, 0.54, 0.37]);
  const nu = cl(Math.floor((fr.W - 6) / 56), 1, 3), nv = cl(Math.floor((fr.D - 16) / 46), 1, 2), BU = (fr.W - 6) / nu, BV = (fr.D - 16) / nv, keep = [];
  parking(B, fr.rect(4, 2, Math.min(fr.W - 4, 60), 14), fn, P, { cars: 10 });
  const nmax = 4; let nb = 0;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { if (nb++ >= nmax) continue;
    const u0 = 3 + i * BU, v0 = 16 + j * BV, w = Math.min(BU - 10, 34 + R() * 10 + BU * 0.1), d = Math.min(BV - 14, 15 + R() * 5), br = fr.rect(u0 + (BU - w) / 2, v0 + (BV - d) / 2, u0 + (BU + w) / 2, v0 + (BV + d) / 2);
    const Fb = rf(br[0], br[1], br[2], br[3]), fe = A.frontEdge(Fb, fn), nf = Math.max(2, P.f - (i + j) % 3), H = gh + (nf - 1) * fh; keep.push(br);
    if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.12, [0.6, 0.59, 0.56]);
    offMass(B, Fb, P, { m, gh, fh, bw: 3.2, top: H, fe });
    if (lod <= 0) { roofFin(B, Fb, H, L); continue; }
    para(B, Fb, H, 1.0, col(L.pc), lod, 0.3); roofFin(B, Fb, H + 0.02, L);
    roofKit(B, br, H, P, { fn, c: col(L.pc), ph: true, n: 0.6 });
    if (lod >= 2) for (let k = 0; k < 3; k++) { const p = [br[0] + (br[2] - br[0]) * (0.2 + 0.3 * k), br[1] + (br[3] - br[1]) * 0.75]; B.cyl('c', p[0], p[1], 0.35, H, H + 3.5, 8, [0.75, 0.76, 0.77]); }
    if (lod >= 1) B.flat(tPave(), frame(br, fn).rect(-2, -6, Math.min(8, w), 0), 0.05, [0.95, 0.94, 0.92], { su: 4 });
  }
  grounds(B, F0, keep.map(r => A.rin(r, -3)), P, { max: lod >= 2 ? 24 : 10, per: 9, th: 7 });
}
// 大使館：まわりに 鉄のさく・芝生と木・門（さくの 正面のまん中を あける）
function embassyYard(B, P, fn) {
  const lod = P.lod, F = insP(P, 0.4); B.cap('c', P.F, 0.03, [0.45, 0.53, 0.36]);
  if (lod < 1 || P.tilt) return;
  const fe = A.frontEdge(F, fn);
  for (const e of F.edges) { if (e === fe) { B.rail(tRail(), e, 0, 2.2, 0, [0.22, 0.23, 0.24], { to: e.L / 2 - 3, su: 1, ends: false }); B.rail(tRail(), e, 0, 2.2, 0, [0.22, 0.23, 0.24], { from: e.L / 2 + 3, su: 1, ends: false }); for (const t of [e.L / 2 - 3, e.L / 2 + 3]) { const p = ept(e, t, 0); B.box('c', p[0] - 0.35, p[1] - 0.35, p[0] + 0.35, p[1] + 0.35, 0, 2.6, [0.85, 0.83, 0.78]); } }
    else B.rail(tRail(), e, 0, 2.2, 0, [0.22, 0.23, 0.24], { su: 1, ends: false }); }
  if (lod >= 2) { const p = ept(fe, fe.L * 0.25, -2.5); B.box('c', p[0] - 0.08, p[1] - 0.08, p[0] + 0.08, p[1] + 0.08, 0, 9, [0.85, 0.85, 0.85]); grounds(B, P.F, [insP(P, 5).bb], P, { max: 10, per: 6 }); }
}
A.arch('b_office', { looks: OFL, build: office,
  far(L, P) { const fh = L.fh || 3.9, u = L.rfin[0] === 'u'; return { H: 4.8 + (Math.max(1, P.f) - 1) * fh, base: 0, wall: tOF(L.tx), bw: 3.2, fh, tb: 4, tf: 4, rt: 'flat', top: u ? tWC() : tFlat(), ct: mul(L.rfin[1], u ? 1 : 0.92), ins: 0.5 }; } });

/* ---------- 屋根・地面・無地の壁 ---------- */
// いぶし瓦（色をかける）。su 3
const tKawara = () => T('r:kawara', 128, 128, (g, w, h, R) => {
  const nc = 10, nr = 8, tw = w / nc, th = h / nr;
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) { const x = i * tw, y = j * th, k = 0.93 + R() * 0.14; const gr = g.createLinearGradient(x, 0, x + tw, 0); gr.addColorStop(0, css('#6e7379', k)); gr.addColorStop(0.5, css('#a7acb2', k)); gr.addColorStop(1, css('#73787e', k)); g.fillStyle = gr; g.fillRect(x, y, tw, th); }
  for (let j = 0; j < nr; j++) { g.fillStyle = 'rgba(0,0,0,.42)'; g.fillRect(0, j * th, w, Math.max(1, th * 0.14)); }
  PT.noise(g, 0, 0, w, h, 0.04, R);
});
// スレート（色をかける）。su 3
const tSlate = () => T('r:slate', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#7d8186'); const nc = 8, nr = 12, tw = w / nc, th = h / nr;
  for (let j = 0; j < nr; j++) for (let i = -1; i <= nc; i++) { g.fillStyle = css('#868a8f', 0.86 + R() * 0.24); g.fillRect(i * tw + (j % 2) * tw / 2 + 0.5, j * th, tw - 1, th - 0.5); }
  g.fillStyle = 'rgba(0,0,0,.3)'; for (let j = 0; j < nr; j++) g.fillRect(0, j * th + th - 1, w, 1); PT.noise(g, 0, 0, w, h, 0.03, R); });
// 金属の屋根（たてはぜ・折板。色をかける）。su 4
const tSeam = () => T('r:seam', 128, 128, (g, w, h, R) => { const n = 12, st = w / n; for (let i = 0; i < n; i++) { lin(g, i * st, 0, (i + 1) * st, h, '#d6d9db', '#b1b5b8', true); PT.fill(g, i * st, 0, Math.max(1, st * 0.14), h, '#eceeef'); PT.fill(g, i * st + st * 0.14, 0, Math.max(1, st * 0.07), h, '#8f9396'); } PT.noise(g, 0, 0, w, h, 0.02, R); });
// 洋瓦（S 形。色をかける）。su 3
const tYoga = () => T('r:yoga', 128, 128, (g, w, h, R) => { const nc = 8, nr = 7, tw = w / nc, th = h / nr;
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) { const x = i * tw, y = j * th, k = 0.88 + R() * 0.24, gr = g.createLinearGradient(x, 0, x + tw, 0); gr.addColorStop(0, css('#8e4a33', k)); gr.addColorStop(0.35, css('#d58a63', k)); gr.addColorStop(0.7, css('#b5603f', k)); gr.addColorStop(1, css('#7a3d2a', k)); g.fillStyle = gr; g.fillRect(x, y, tw, th); }
  for (let j = 0; j < nr; j++) { g.fillStyle = 'rgba(40,10,0,.35)'; g.fillRect(0, j * th, w, Math.max(1, th * 0.12)); } PT.noise(g, 0, 0, w, h, 0.04, R); });
// 駐車場（1 列 4 台・白い線）：u 10m・v 5.5m（v 1 が おく）
const tPark = () => T('g:park', 128, 64, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#5f6163'); PT.noise(g, 0, 0, w, h, 0.05, R, 2);
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(25,25,25,.22)'; g.fillRect(i * w / 4 + w / 18, h * 0.3, w / 9, h * 0.45); }
  for (let i = 0; i < 4; i++) PT.fill(g, i * w / 4, h * 0.05, Math.max(1, w / 90), h * 0.85, '#e8e8e2');
  PT.fill(g, 0, h * 0.05, w, Math.max(1, h / 40), '#e8e8e2'); for (let i = 0; i < 4; i++) PT.fill(g, i * w / 4 + w * 0.07, h * 0.12, w * 0.11, h * 0.06, '#bdbdb6'); });
// 舗装（ブロック。色をかける）。su 4
const tPave = () => T('g:pave', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#d6d3cc'); const n = 8, s = w / n; for (let j = 0; j < n; j++) for (let i = 0; i < n * 2; i++) { g.fillStyle = css('#d6d3cc', 0.9 + R() * 0.14); g.fillRect(i * s / 2 + (j % 2) * s / 4, j * s, s / 2 - 1, s - 1); } PT.noise(g, 0, 0, w, h, 0.03, R); });
// 金属パネルの壁（郊外のお店。色をかける）。su 4
const tWP = () => T('wp', 128, 128, (g, w, h, R) => { for (let j = 0; j < 4; j++) { lin(g, 0, j * h / 4, w, (j + 1) * h / 4, '#f4f5f5', '#dcdfdf'); PT.fill(g, 0, j * h / 4, w, Math.max(1, h / 128), '#a5a9aa'); } PT.noise(g, 0, 0, w, h, 0.02, R); PT.streaks(g, 0, 0, w, h, 5, 0.04, R); });
// 木の板の壁（横張り。色をかける）。su 4
const tWD = () => T('wd', 128, 128, (g, w, h, R) => { const n = 16, st = h / n; for (let j = 0; j < n; j++) { g.fillStyle = css('#efe6d8', 0.86 + R() * 0.2); g.fillRect(0, j * st, w, st); g.fillStyle = 'rgba(60,40,20,.28)'; g.fillRect(0, j * st + st - 1, w, 1); for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(90,60,30,.12)'; g.fillRect(R() * w, j * st + st * 0.3, w * 0.2, 1); } if (j % 4 === 0) { g.fillStyle = 'rgba(60,40,20,.2)'; g.fillRect(R() * w, j * st, 1, st * 4); } } PT.noise(g, 0, 0, w, h, 0.025, R); });
const WMT = { wp: () => tWP(), wt: () => tWT(), wc: () => tWC(), wd: () => tWD() };
// タイルの壁（無地。色をかける）。su 4
const tWT = () => T('wt', 128, 128, (g, w, h, R) => { PT.wallMat(g, 0, 0, w, h, { t: 'tile', c: '#efede8', sc: w / 200, j: '#a7a49d' }, R); PT.streaks(g, 0, 0, w, h, 6, 0.04, R); });
// 遠くの低い建物の壁（2 柱間 × 2 階。色をかける）：bw 3.6・fh 2.9
const tFarLo = () => T('far:lo', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#ecebe6'); PT.noise(g, 0, 0, w, h, 0.025, R); for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) pwin(g, i * w / 2 + w * 0.1, j * h / 2 + h * 0.15, w * 0.3, h * 0.2, R, { u: w / 128, f: '#d4d6d6', dv: 2, cur: 0.5, g0: '#a9b9c4', g1: '#4b5966' }); });

/* ---------- 1階の店先・低い建物の壁（行の質感） ---------- */
// その2：0 明るいお店（たな）・1 自動ドア・2 レストランの窓・3 ショールーム
const tGF2 = () => T('gf2', 256, 256, (g, w, h, R) => {
  const rh = h / 4, mw = w / 4, u = w / 256, goods = ['#d2503f', '#e9c04a', '#4c8ac9', '#6aaa5a', '#f0eee6', '#a46b42', '#e08a3c', '#8a6db0', '#e7e1d0'];
  for (let r = 0; r < 4; r++) {
    const Y = r * rh; PT.fill(g, 0, Y, w, rh, '#d6d6d2'); PT.noise(g, 0, Y, w, rh, 0.02, R);
    for (let i = 0; i < 4; i++) {
      const X = i * mw;
      if (r <= 1) {
        const gx = X + mw * 0.02, gw = mw * 0.96, gy = Y + rh * 0.06, gh = rh * 0.92;
        PT.fill(g, gx, gy, gw, gh, '#fbfaf5'); for (let k = 0; k < 3; k++) PT.fill(g, gx, gy + gh * (0.04 + k * 0.06), gw, u * 1.2, '#ffffff');
        const sy = gy + gh * 0.38;
        for (let s = 0; s < 3; s++) for (let q = 0; q < 10; q++) PT.fill(g, gx + gw * (0.02 + q * 0.098), sy + s * gh * 0.17, gw * 0.08, gh * 0.12, A.pick(R, goods));
        for (let s = 0; s < 4; s++) PT.fill(g, gx, sy - gh * 0.02 + s * gh * 0.17, gw, u, '#b5b6b2');
        PT.fill(g, gx, gy + gh * 0.88, gw, gh * 0.12, '#cfcfca');
        if (r === 1) { g.fillStyle = 'rgba(244,246,244,.72)'; g.fillRect(gx + gw * 0.08, gy, gw * 0.84, gh); PT.fill(g, gx + gw * 0.15, gy + gh * 0.93, gw * 0.7, gh * 0.07, '#5d6266'); wframe(g, gx + gw * 0.08, gy + gh * 0.04, gw * 0.84, gh * 0.96, u * 1.6, '#8c9296', 2, 1); }
        glass(g, gx, gy, gw, gh, R, { g0: 'rgba(190,205,215,.3)', g1: 'rgba(60,70,80,.2)', ra: 0.16 });
        wframe(g, gx, gy, gw, gh, u * 1.4, '#9aa0a4', r === 1 ? 1 : 2, 1);
      } else if (r === 2) {
        const gx = X + mw * 0.06, gw = mw * 0.88, gy = Y + rh * 0.14, gh = rh * 0.6;
        lin(g, gx, gy, gx + gw, gy + gh, '#f4e3c2', '#b89870');
        for (let k = 0; k < 2; k++) { g.fillStyle = 'rgba(255,240,200,.95)'; g.beginPath(); g.arc(gx + gw * (0.28 + k * 0.44), gy + gh * 0.18, gw * 0.05, 0, PI * 2); g.fill(); }
        for (let k = 0; k < 2; k++) { PT.fill(g, gx + gw * (0.1 + k * 0.46), gy + gh * 0.64, gw * 0.32, gh * 0.06, '#6b4a33'); PT.fill(g, gx + gw * (0.1 + k * 0.46), gy + gh * 0.48, gw * 0.05, gh * 0.42, '#5a3d2a'); PT.fill(g, gx + gw * (0.37 + k * 0.46), gy + gh * 0.48, gw * 0.05, gh * 0.42, '#5a3d2a'); }
        glass(g, gx, gy, gw, gh, R, { g0: 'rgba(180,195,205,.35)', g1: 'rgba(50,60,70,.25)', ra: 0.14 });
        wframe(g, gx, gy, gw, gh, u * 1.4, '#6b5a4a', 2, 1);
        PT.fill(g, X, gy + gh, mw, Y + rh - gy - gh, '#b8ad9c'); PT.fill(g, gx - u, gy + gh, gw + 2 * u, u * 2, '#e4ddd0');
      } else {
        const gx = X + mw * 0.015, gw = mw * 0.97, gy = Y + rh * 0.04, gh = rh * 0.94;
        lin(g, gx, gy, gx + gw, gy + gh * 0.7, '#f6f6f2', '#e2e2dc'); PT.fill(g, gx, gy + gh * 0.7, gw, gh * 0.3, '#c8c9c5');
        for (let k = 0; k < 3; k++) PT.fill(g, gx + gw * (0.1 + k * 0.32), gy + gh * 0.06, gw * 0.15, u * 1.5, '#ffffff');
        glass(g, gx, gy, gw, gh, R, { g0: 'rgba(190,205,215,.3)', g1: 'rgba(60,70,80,.15)', ra: 0.18 });
        wframe(g, gx, gy, gw, gh, u * 1.1, '#c5c9cb', 1, 1);
      }
    }
    PT.fill(g, 0, Y + rh - 1.5 * u, w, 1.5 * u, '#8a8984');
  }
});
// その3：0 格子（町家）・1 のれんの入口（引き戸）・2 開いた店先（品物）・3 カフェ（木のわく）
const tGFW = () => T('gfw', 256, 256, (g, w, h, R) => {
  const rh = h / 4, mw = w / 4, u = w / 256;
  const lattice = (X, Y) => { lin(g, X + mw * 0.05, Y + rh * 0.12, X + mw * 0.95, Y + rh * 0.8, '#e8dcc2', '#b39f80'); for (let k = 0; k < 14; k++) PT.fill(g, X + mw * (0.05 + k * 0.0645), Y + rh * 0.12, Math.max(1, mw * 0.03), rh * 0.68, '#3b2d22');
    PT.fill(g, X + mw * 0.05, Y + rh * 0.12, mw * 0.9, u * 1.5, '#3b2d22'); PT.fill(g, X + mw * 0.05, Y + rh * 0.46, mw * 0.9, u, '#3b2d22'); PT.fill(g, X, Y + rh * 0.8, mw, rh * 0.2, '#3d3026'); PT.fill(g, X, Y, mw * 0.05, rh, '#3a2c21'); };
  for (let r = 0; r < 4; r++) {
    const Y = r * rh;
    if (r === 0) { PT.fill(g, 0, Y, w, rh, '#4b3a2c'); for (let i = 0; i < 4; i++) lattice(i * mw, Y); PT.fill(g, 0, Y, w, rh * 0.1, '#33281f'); }
    else if (r === 1) { PT.fill(g, 0, Y, w, rh, '#55412f');
      for (let i = 0; i < 4; i++) { const X = i * mw;
        lin(g, X + mw * 0.06, Y + rh * 0.14, X + mw * 0.94, Y + rh * 0.98, '#efe2c5', '#c3ab84');
        for (let k = 0; k < 6; k++) PT.fill(g, X + mw * (0.06 + k * 0.176), Y + rh * 0.14, Math.max(1, mw * 0.025), rh * 0.84, '#3a2c21');
        for (let k = 0; k < 4; k++) PT.fill(g, X + mw * 0.06, Y + rh * (0.14 + k * 0.21), mw * 0.88, Math.max(1, u * 0.8), '#3a2c21');
        PT.fill(g, X + mw * 0.47, Y + rh * 0.14, mw * 0.06, rh * 0.84, '#2e231a'); PT.fill(g, X, Y, mw * 0.05, rh, '#3a2c21'); }
      PT.fill(g, 0, Y, w, rh * 0.1, '#33281f'); }
    else if (r === 2) { PT.fill(g, 0, Y, w, rh, '#cfcac0');
      for (let i = 0; i < 4; i++) { const X = i * mw;
        PT.fill(g, X + mw * 0.02, Y + rh * 0.08, mw * 0.96, rh * 0.07, '#9ea3a5');
        lin(g, X + mw * 0.02, Y + rh * 0.15, X + mw * 0.98, Y + rh, '#ece6d4', '#8e8370');
        for (let s = 0; s < 3; s++) for (let q = 0; q < 6; q++) PT.fill(g, X + mw * (0.06 + q * 0.15), Y + rh * (0.3 + s * 0.18), mw * 0.11, rh * 0.11, A.pick(R, ['#c9452f', '#5f9a3a', '#e3a33a', '#e8d046', '#d9d2c4', '#7b3f6a', '#3e7a33', '#f0efe8']));
        PT.fill(g, X + mw * 0.02, Y + rh * 0.92, mw * 0.96, rh * 0.08, '#6f6a62'); PT.fill(g, X, Y, mw * 0.02, rh, '#8f8a80'); } }
    else { PT.fill(g, 0, Y, w, rh, '#6b4f39');
      for (let i = 0; i < 4; i++) { const X = i * mw, dr = i === 1, gx = X + mw * 0.08, gw = mw * 0.84, gy = Y + rh * 0.12, gh = rh * (dr ? 0.86 : 0.6);
        lin(g, gx, gy, gx + gw, gy + gh, '#f6dfb4', '#a87d52');
        if (!dr) { PT.fill(g, gx + gw * 0.1, gy + gh * 0.62, gw * 0.35, gh * 0.06, '#4e3524'); PT.fill(g, gx + gw * 0.55, gy + gh * 0.55, gw * 0.3, gh * 0.06, '#4e3524'); g.fillStyle = 'rgba(255,236,190,.95)'; g.beginPath(); g.arc(gx + gw * 0.5, gy + gh * 0.15, gw * 0.06, 0, PI * 2); g.fill(); }
        glass(g, gx, gy, gw, gh, R, { g0: 'rgba(180,195,205,.3)', g1: 'rgba(50,60,70,.2)', ra: 0.14 });
        wframe(g, gx, gy, gw, gh, u * 1.6, '#4a3424', dr ? 1 : 3, 2);
        if (!dr) PT.fill(g, X, Y + rh * 0.74, mw, rh * 0.26, '#5a4130'); } }
    PT.fill(g, 0, Y + rh - 1.5 * u, w, 1.5 * u, '#3a3029');
  }
});
// 低い建物の壁（8 行 × 4 柱間。1 行 = 1 階 2.9m・柱間 3.6m。柱間は ふつう [窓, 無地, 窓, 小窓]）。白っぽい行は 色をかける
//   0 サイディング・1 モルタル・2 たて板・3 丸太・4 洋風（よろい戸）・5 ハーフティンバー・6 和風（板張り）・7 和風（しっくいと格子）
const tLW = () => T('lw', 256, 512, (g, w, h, R) => {
  const rh = h / 8, mw = w / 4, u = w / 256;
  const cc = ['#efe9dc', '#e6efe9', '#f0e2e2', '#dfe5ee', '#f3ecd8'];
  const win = (X, Y, ww, wh, o) => pwin(g, X, Y, ww, wh, R, Object.assign({ u, fw: 1.4 * u, f: '#dcdedd', dv: 2, cur: 0.5, bl: 0.05, cc, g0: '#aebfcb', g1: '#4b5b68' }, o));
  const small = (X, Y, o) => { pwin(g, X + mw * 0.32, Y + rh * 0.3, mw * 0.36, rh * 0.24, R, Object.assign({ u, fw: 1.2 * u, f: '#dcdedd', dv: 2, g0: '#d3d8d9', g1: '#a9b0b3', refl: false }, o)); for (let k = 0; k < 5; k++) PT.fill(g, X + mw * (0.34 + k * 0.075), Y + rh * 0.29, Math.max(1, u * 0.9), rh * 0.27, '#babdbe'); };
  for (let r = 0; r < 8; r++) {
    const Y = r * rh;
    if (r === 0 || r === 1) {
      PT.wallMat(g, 0, Y, w, rh, r ? { t: 'stucco', c: '#ecebe6', n: 0.03 } : { t: 'siding', c: '#ecebe6', sc: u * 0.85 }, R);
      win(0 * mw + mw * 0.14, Y + rh * 0.3, mw * 0.72, rh * 0.42); win(2 * mw + mw * 0.1, Y + rh * 0.3, mw * 0.8, rh * 0.42, { dv: 2 }); small(3 * mw, Y);
      if (r) PT.streaks(g, 0, Y + rh * 0.72, w, rh * 0.28, 8, 0.05, R);
    } else if (r === 2) {
      PT.wallMat(g, 0, Y, w, rh, { t: 'vsiding', c: '#ebe7e0', sc: u }, R);
      for (const i of [0, 2]) win(i * mw + mw * 0.16, Y + rh * 0.28, mw * 0.68, rh * 0.46, { f: '#8d7f70', dv: i ? 1 : 2, cur: 0.3 });
      win(3 * mw + mw * 0.3, Y + rh * 0.28, mw * 0.4, rh * 0.3, { f: '#8d7f70', dv: 1, cur: 0 });
    } else if (r === 3) {
      PT.fill(g, 0, Y, w, rh, '#a77c52');
      for (let k = 0; k < 6; k++) { const ly = Y + k * rh / 6; lin(g, 0, ly, w, ly + rh / 6, '#d1a574', '#7d5634'); g.fillStyle = 'rgba(40,20,5,.35)'; g.fillRect(0, ly + rh / 6 - u, w, u); }
      for (let i = 0; i < 4; i++) { if (i === 1) continue; win(i * mw + mw * 0.2, Y + rh * 0.26, mw * 0.6, rh * 0.46, { f: '#5d4230', fw: 2 * u, dv: 2, dh: 2, cur: 0.35, cc: ['#efe3cc', '#e9e0d0'] }); }
      PT.fill(g, 0, Y, u * 2, rh, '#6a4a30');
    } else if (r === 4) {
      PT.wallMat(g, 0, Y, w, rh, { t: 'stucco', c: '#f1ece1', n: 0.03 }, R);
      for (const i of [0, 2, 3]) { const X = i * mw + mw * 0.28, ww = mw * 0.44; win(X, Y + rh * 0.24, ww, rh * 0.5, { f: '#f4f2ec', fw: 1.6 * u, dv: 2, dh: 3, cur: 0.4 });
        for (const sx of [X - mw * 0.2, X + ww + u]) { PT.fill(g, sx, Y + rh * 0.24, mw * 0.19, rh * 0.5, '#5a7563'); for (let k = 0; k < 7; k++) PT.fill(g, sx, Y + rh * (0.26 + k * 0.067), mw * 0.19, u * 0.9, '#3f5647'); }
        if (i === 0) { PT.fill(g, X - u, Y + rh * 0.75, ww + 2 * u, rh * 0.06, '#7a5a3a'); for (let k = 0; k < 7; k++) { g.fillStyle = css(A.pick(R, ['#d8485a', '#f2c94b', '#f4f1ea', '#e07aa0'])); g.beginPath(); g.arc(X + ww * (0.08 + k * 0.14), Y + rh * 0.74, u * 1.6, 0, PI * 2); g.fill(); } } }
    } else if (r === 5) {
      PT.wallMat(g, 0, Y, w, rh, { t: 'stucco', c: '#efebe2', n: 0.025 }, R);
      const tc = '#4f3c2d';
      for (let i = 0; i < 4; i++) { const X = i * mw; PT.fill(g, X, Y, u * 3, rh, tc); PT.fill(g, X, Y + rh * 0.04, mw, u * 3, tc); PT.fill(g, X, Y + rh * 0.86, mw, u * 3, tc);
        if (i === 1) { g.strokeStyle = tc; g.lineWidth = u * 2.5; g.beginPath(); g.moveTo(X, Y + rh * 0.86); g.lineTo(X + mw, Y + rh * 0.06); g.moveTo(X, Y + rh * 0.06); g.lineTo(X + mw, Y + rh * 0.86); g.stroke(); }
        else { win(X + mw * 0.24, Y + rh * 0.22, mw * 0.52, rh * 0.48, { f: '#f2f0ea', dv: 2, dh: 3 }); PT.fill(g, X + mw * 0.2, Y + rh * 0.72, mw * 0.6, u * 2.5, tc); } }
    } else if (r === 6) {
      PT.wallMat(g, 0, Y, w, rh * 0.42, { t: 'stucco', c: '#e8e2d4', n: 0.03 }, R);
      PT.wallMat(g, 0, Y + rh * 0.42, w, rh * 0.58, { t: 'wood', c: '#4c3b2e', sc: u * 1.2 }, R); for (let x = 0; x < w; x += mw / 6) PT.fill(g, x, Y + rh * 0.42, u * 1.2, rh * 0.58, '#5e4a3a');
      for (const i of [0, 2]) { win(i * mw + mw * 0.1, Y + rh * 0.28, mw * 0.8, rh * 0.42, { f: '#6a5a4a', dv: 2, cur: 0.65, cc: ['#f2efe6'] }); }
      small(3 * mw, Y, { f: '#6a5a4a' }); PT.fill(g, 0, Y, w, u * 2, '#3a2d22');
    } else {
      PT.wallMat(g, 0, Y, w, rh, { t: 'stucco', c: '#efeadf', n: 0.025 }, R); PT.fill(g, 0, Y + rh * 0.8, w, rh * 0.2, '#4a3a2c');
      for (let i = 0; i < 4; i++) PT.fill(g, i * mw, Y, u * 2.5, rh, '#5a4331');
      const X0 = mw * 0.12; lin(g, X0, Y + rh * 0.26, X0 + mw * 0.76, Y + rh * 0.74, '#e9dfc8', '#b9a684'); for (let k = 0; k < 12; k++) PT.fill(g, X0 + k * mw * 0.0633, Y + rh * 0.26, Math.max(1, u * 1.6), rh * 0.48, '#4a3626'); PT.fill(g, X0 - u, Y + rh * 0.24, mw * 0.78, u * 2, '#4a3626');
      const X2 = 2 * mw + mw * 0.14; PT.fill(g, X2, Y + rh * 0.26, mw * 0.72, rh * 0.46, '#f3efe4'); for (let k = 1; k < 4; k++) PT.fill(g, X2 + k * mw * 0.18, Y + rh * 0.26, u, rh * 0.46, '#7a6450'); for (let k = 1; k < 4; k++) PT.fill(g, X2, Y + rh * (0.26 + k * 0.115), mw * 0.72, u, '#7a6450'); wframe(g, X2, Y + rh * 0.26, mw * 0.72, rh * 0.46, u * 1.6, '#5a4331', 1, 1);
      const X3 = 3 * mw + mw * 0.3; PT.fill(g, X3, Y + rh * 0.3, mw * 0.4, rh * 0.28, '#d9cfb8'); for (let k = 0; k < 6; k++) PT.fill(g, X3 + k * mw * 0.07, Y + rh * 0.3, Math.max(1, u * 1.4), rh * 0.28, '#4a3626');
    }
  }
});
// 低い建物の壁 その2（町の小さなビル）：0 ベージュのタイル・1 レンガ調・2 黒い外壁・3 打ちはなし・4 白いタイルの横長窓・5 銅板（看板建築）・6 モルタルの飾り（看板建築）・7 木のルーバー
const tLW2 = () => T('lw2', 256, 512, (g, w, h, R) => {
  const rh = h / 8, mw = w / 4, u = w / 256;
  const win = (X, Y, ww, wh, o) => pwin(g, X, Y, ww, wh, R, Object.assign({ u, fw: 1.4 * u, f: '#c4c7c8', dv: 2, cur: 0.25, bl: 0.35, g0: '#aebfcb', g1: '#46566a' }, o));
  for (let r = 0; r < 8; r++) {
    const Y = r * rh;
    if (r === 0) { PT.wallMat(g, 0, Y, w, rh, { t: 'tile', c: '#d6c7aa', sc: u, j: '#9c907c' }, R); for (let i = 0; i < 4; i++) win(i * mw + mw * 0.12, Y + rh * 0.28, mw * 0.76, rh * 0.44, { rev: 0.3, sill: '#cdc4b2' }); }
    else if (r === 1) { PT.wallMat(g, 0, Y, w, rh, { t: 'brick', c: '#9a5a44', c2: '#7f4535', sc: u * 0.8 }, R); for (const i of [0, 1, 3]) win(i * mw + mw * 0.2, Y + rh * 0.26, mw * 0.6, rh * 0.48, { f: '#eceae4', rev: 0.3, sill: '#e3ddcf', cur: 0.35 }); }
    else if (r === 2) { PT.fill(g, 0, Y, w, rh, '#34373b'); PT.noise(g, 0, Y, w, rh, 0.03, R); for (let i = 0; i < 4; i++) { PT.fill(g, i * mw, Y, u, rh, '#26292c'); win(i * mw + mw * 0.06, Y + rh * 0.16, mw * 0.88, rh * 0.66, { f: '#1d1f21', fw: 1.2 * u, dv: 1, bl: 0.3, lit: 0.12 }); } }
    else if (r === 3) { PT.wallMat(g, 0, Y, w, rh, { t: 'concrete', c: '#b8b6af', pw: 20, ph: 32, sc: u }, R); for (const i of [0, 2, 3]) win(i * mw + mw * 0.08, Y + rh * 0.16, mw * 0.84, rh * 0.62, { f: '#2c2e30', fw: 1.2 * u, dv: i === 2 ? 1 : 2, bl: 0.2, lit: 0.1 }); PT.streaks(g, 0, Y, w, rh, 10, 0.07, R); }
    else if (r === 4) { PT.wallMat(g, 0, Y, w, rh, { t: 'tile', c: '#eeece6', sc: u, j: '#aaa79f' }, R); for (let i = 0; i < 4; i++) win(i * mw, Y + rh * 0.32, mw, rh * 0.36, { f: '#b9bcbd', dv: 2, rev: 0.25 }); PT.fill(g, 0, Y + rh * 0.68, w, u * 2, '#d8d6d0'); }
    else if (r === 5) { PT.fill(g, 0, Y, w, rh, '#6e9c88');
      for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) { g.fillStyle = css('#6e9c88', 0.85 + R() * 0.25); g.beginPath(); const cx = i * w / 16 + (j % 2) * w / 32, cy = Y + j * rh / 8 + rh / 16; g.moveTo(cx, cy - rh / 16); g.lineTo(cx + w / 32, cy); g.lineTo(cx, cy + rh / 16); g.lineTo(cx - w / 32, cy); g.closePath(); g.fill(); }
      for (const i of [1, 2]) win(i * mw + mw * 0.18, Y + rh * 0.28, mw * 0.64, rh * 0.44, { f: '#3f5a4e', dv: 2, dh: 2, cur: 0.3 }); PT.fill(g, 0, Y + rh * 0.04, w, u * 3, '#4f7a68'); PT.fill(g, 0, Y + rh * 0.9, w, u * 3, '#4f7a68'); }
    else if (r === 6) { PT.wallMat(g, 0, Y, w, rh, { t: 'stucco', c: '#dbd4c3', n: 0.035 }, R); PT.fill(g, 0, Y + rh * 0.06, w, u * 3, '#c4bca9'); PT.fill(g, 0, Y + rh * 0.86, w, u * 4, '#c4bca9');
      for (let i = 0; i < 4; i++) { const X = i * mw + mw * 0.22; win(X, Y + rh * 0.3, mw * 0.56, rh * 0.42, { f: '#d9d6cc', dv: 2, cur: 0.3 }); g.fillStyle = css('#c4bca9'); g.beginPath(); g.arc(X + mw * 0.28, Y + rh * 0.3, mw * 0.3, PI, 0); g.lineTo(X + mw * 0.56, Y + rh * 0.3); g.closePath(); g.fill(); }
      PT.streaks(g, 0, Y, w, rh, 8, 0.06, R); }
    else { PT.fill(g, 0, Y, w, rh, '#3b3a38'); PT.noise(g, 0, Y, w, rh, 0.03, R);
      for (const i of [0, 1, 3]) { const X = i * mw + mw * 0.08; win(X, Y + rh * 0.18, mw * 0.84, rh * 0.62, { f: '#222', dv: 1, cur: 0.3 }); for (let k = 0; k < 9; k++) lin(g, X + k * mw * 0.094, Y + rh * 0.16, X + k * mw * 0.094 + mw * 0.05, Y + rh * 0.82, '#b08a60', '#7c5c3c', true); } }
  }
});
// 日よけ（8 行 × 16px）：0 赤白・1 緑白・2 紺白・3 茶クリーム・4 深緑・5 えんじ・6 黒・7 からし色。u 2m
const tAwn = () => T('awn', 128, 128, (g, w, h, R) => {
  const rh = h / 8, sp = [['#b9473c', '#f1ede4'], ['#3f7a4f', '#f1ede4'], ['#2f3f66', '#f1ede4'], ['#7a5236', '#eadfc8'], ['#2f5a3e'], ['#7a2c2e'], ['#36383b'], ['#c99a3a', '#f0e7d2']];
  for (let r = 0; r < 8; r++) { const Y = r * rh, s = sp[r];
    if (s.length > 1) for (let k = 0; k < 8; k++) PT.fill(g, k * w / 8, Y, w / 8, rh, s[k % 2]); else { PT.fill(g, 0, Y, w, rh, s[0]); PT.fill(g, 0, Y + rh * 0.82, w, rh * 0.1, '#e9e4d8'); }
    lin(g, 0, Y, w, Y + rh, 'rgba(255,255,255,.12)', 'rgba(0,0,0,.18)'); }
});

/* ---------- 低い建物・お店の部品 ---------- */
// 辺 e にそった 箱（t0〜t1・外へ o0〜o1）
const ebox = (B, e, t0, t1, o0, o1, y0, y1, c, o) => { const a = ept(e, t0, o0), b = ept(e, t1, o1); B.box((o && o.m) || 'c', Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), y0, y1, c, o || {}); };
// 低い建物の壁（階ごとに 1 枚・行の質感 m の row 行め / n 行）。o：{ bw, skip(e, k), ao }
function lowWalls(B, m, row, n, F, y0, nf, fh, c, o = {}) {
  const bw = o.bw || 3.6, [v0, v1] = rowV(row, n);
  for (let k = 0; k < nf; k++) for (const e of F.edges) {
    if (o.skip && o.skip(e, k)) continue;
    const nb = Math.max(1, Math.round(e.L / bw));
    B.wallE(m, e, y0 + k * fh, y0 + (k + 1) * fh, c, { uv: [0, nb / 4, v0, v1], ao: k === 0 ? (o.ao || 0.86) : 1 });
  }
}
// 1 行の店先（辺 e の y0〜y1）：入口（行 rB）を 柱間 di から nd 本、のこりは 行 rA
function frontRow(B, m, e, y0, y1, bw, rA, rB, n = 4, di = null, nd = 1) {
  const nb = Math.max(1, Math.round(e.L / bw)), b = e.L / nb; if (di == null) di = Math.floor((nb - nd) / 2); di = cl(di, 0, Math.max(0, nb - nd));
  const seg = (k0, k1, r) => { if (k1 <= k0) return; const [v0, v1] = rowV(r, n); B.wallE(m, e, y0, y1, WH, { from: k0 * b, to: k1 * b, uv: [k0 / 4, k1 / 4, v0, v1], ao: 0.9 }); };
  if (rB == null || rB === rA) { seg(0, nb, rA); return [0, 0]; }
  seg(0, di, rA); seg(di, di + nd, rB); seg(di + nd, nb, rA);
  return [di * b, (di + nd) * b];
}
// 日よけ（辺 e の t0〜t1・下のはし y・出 dep・行 row）
function awning(B, e, t0, t1, y, dep, row) {
  const m = tAwn(), ev = 0.7 / 128, v0 = 1 - (row + 1) / 8 + ev, v1 = 1 - row / 8 - ev, L = t1 - t0, su = 2;
  const a = ept(e, t0, 0.04), b = ept(e, t1, 0.04), a2 = ept(e, t0, dep), b2 = ept(e, t1, dep), yt = y + dep * 0.5;
  B.quad(m, [a[0], yt, a[1]], [b[0], yt, b[1]], [b2[0], y, b2[1]], [a2[0], y, a2[1]], null, WH, [0, v1, L / su, v0]);
  B.wall(m, a2[0], a2[1], b2[0], b2[1], y - 0.26, y, WH, [0, L / su, v0, v1]);
}
// 小さな ひさし（板金。辺 e の t0〜t1）
const hisashi = (B, e, t0, t1, y, dep, c) => B.ledge(e, y, y + 0.12, dep, c, { from: t0, to: t1 });
// 袖看板（辺 e の t に たての板。外へ 出る）。色の板は lod 2 だけ（3 まい まで）
function sode(B, e, t, y0, y1, c, c2, lod = 2) {
  ebox(B, e, t - 0.08, t + 0.08, 0.12, 0.95, y0, y1, c);
  if (c2 && lod >= 2) { const n = cl(Math.floor((y1 - y0) / 3), 1, 3), st = (y1 - y0) / n; for (let k = 0; k < n; k++) { const ya = y0 + st * (k + 0.2); ebox(B, e, t - 0.1, t + 0.1, 0.2, 0.87, ya, ya + st * 0.6, k % 2 ? c2 : mul(c2, 0.85)); } }
}
// 木（lod 2 は ふつうの木・lod 1 は 5 角の すい だけ）
function treeL(B, x, z, y, h, r, lod, c) { if (lod >= 2) B.tree(x, z, y, h, r, c); else B.cone('c', x, z, r, y + h * 0.3, y + h, 5, c || [0.27, 0.42, 0.22]); }
// のぼり旗（x, z・正面 fx, fz）
function nobori(B, x, z, fx, fz, c) { B.box('c', x - 0.025, z - 0.025, x + 0.025, z + 0.025, 0, 2.9, [0.86, 0.86, 0.85]); const tx = -fz, tz = fx; B.wall('c', x + tx * 0.03, z + tz * 0.03, x + tx * 0.52, z + tz * 0.52, 0.95, 2.75, c); B.wall('c', x + tx * 0.03, z + tz * 0.03, x + tx * 0.52, z + tz * 0.52, 2.62, 2.75, mul(c, 0.6)); }
// 自転車（かんたんな 1 台）
function bike(B, x, z, fx, fz, c) { const a = Math.atan2(fz, fx); B.obox('c', x, z, a, 0.1, 1.65, 0.05, 0.75, [0.18, 0.18, 0.19]); B.obox('c', x, z, a, 0.5, 0.08, 0.85, 0.92, c || [0.55, 0.56, 0.58]); }
// 植木鉢
function pot(B, x, z, s = 1, c) { B.box('c', x - 0.25 * s, z - 0.25 * s, x + 0.25 * s, z + 0.25 * s, 0, 0.45 * s, c || [0.62, 0.45, 0.33]); B.cone('c', x, z, 0.4 * s, 0.4 * s, 1.1 * s, 5, [0.3, 0.45, 0.25]); }
// ポール看板（x, z・正面 fx, fz・高さ h・看板 w × hh・色）
function poleSign(B, x, z, fx, fz, h, w, hh, c1, c2, c3) {
  B.box('c', x - 0.16, z - 0.16, x + 0.16, z + 0.16, 0, h - hh, [0.62, 0.63, 0.64]);
  const tx = -fz, tz = fx, d = 0.45, ax = Math.abs(tx) > 0.5;
  const x0 = x - (ax ? w / 2 : d / 2), x1 = x + (ax ? w / 2 : d / 2), z0 = z - (ax ? d / 2 : w / 2), z1 = z + (ax ? d / 2 : w / 2);
  B.box('c', x0, z0, x1, z1, h - hh, h, c1);
  if (c2) { const e = ax ? 0.04 : 0, f = ax ? 0 : 0.04; B.box('c', x0 - f, z0 - e, x1 + f, z1 + e, h - hh * 0.42, h - hh * 0.28, c2); }
  if (c3) B.box('c', x0 - (ax ? 0 : 0.05), z0 - (ax ? 0.05 : 0), x1 + (ax ? 0 : 0.05), z1 + (ax ? 0.05 : 0), h - hh * 0.2, h - hh * 0.1, c3);
}
// 上向きの四角（uv：u を 長さ nu・v 0〜1。ax：u を x にそって。fl：v を 逆に）
function flatUV(B, m, r, y, c, ax, nu, fl) {
  const [x0, z0, x1, z1] = r; let uv;
  if (ax) uv = fl ? [0, 1, nu, 1, nu, 0, 0, 0] : [0, 0, nu, 0, nu, 1, 0, 1];
  else uv = fl ? [nu, 1, nu, 0, 0, 0, 0, 1] : [nu, 0, nu, 1, 0, 1, 0, 0];
  B.quad(m, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], c, uv);
}
// 駐車ますの 帯（フレーム fr の u0〜u1・va〜vb。cb：vb がわが 閉じた がわ（白い線・車止め）。nu：質感（4 ます）の くりかえし）
function stallStrip(B, fr, u0, u1, va, vb, cb, nu, y = 0.05) {
  const a = fr.p(u0, va), b = fr.p(u1, va), c = fr.p(u1, vb), d = fr.p(u0, vb), v0 = cb ? 0 : 1, v1 = cb ? 1 : 0;
  B.quad(tPark(), [a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [d[0], y, d[1]], [0, 1, 0], WH, [0, v0, nu, v0, nu, v1, 0, v1]);
}
// 駐車場（長方形 r・道の向き fn。v0 がわ（道）から 列を ならべる。建物は v1 がわ）。o：{ cars（台数の上限）}
function parking(B, r, fn, P, o = {}) {
  const fr = frame(r, fn), W = fr.W, D = fr.D, lod = P.lod, R = P.rng;
  B.flat('c', r, 0.03, [0.37, 0.38, 0.39]);
  if (D < 5 || W < 5 || lod <= 0) return;
  const ax = Math.abs(fn[1]) > 0.5, rows = [];
  // 建物がわから：列（5.5）・通路（6.5）・列 …
  let v = D;
  while (v - 5.5 >= 0) { rows.push([v - 5.5, v, true]); v -= 5.5; if (v - 6.5 - 5.5 >= 0) { v -= 6.5; rows.push([v - 5.5, v, false]); v -= 5.5; if (v - 1 > 6.5) v -= 0.6; else break; } else break; }
  const n4 = Math.max(1, Math.floor(W / 2.5) / 4);
  for (const [va, vb, nose] of rows) stallStrip(B, fr, 0.5, 0.5 + n4 * 10, va, vb, nose, n4);
  if (lod < 2) return;
  const nc = Math.min(o.cars == null ? 8 : o.cars, Math.round(Math.sqrt(W * D) / 4));
  const cc = [[0.92, 0.92, 0.9], [0.18, 0.19, 0.2], [0.62, 0.64, 0.66], [0.55, 0.12, 0.12], [0.2, 0.28, 0.45], [0.85, 0.83, 0.78], [0.42, 0.45, 0.4]];
  for (let k = 0; k < nc; k++) { const rw = A.pick(R, rows), slot = Math.floor(R() * Math.floor(W / 2.5)), u = 0.5 + slot * 2.5 + 1.25, vm = (rw[0] + rw[1]) / 2, p = fr.p(u, vm); const ang = ax ? PI / 2 : 0; B.car(p[0], p[1], ang, A.pick(R, cc), 0.05); }
}
// 木の列（辺 e にそって）
function treeRow(B, e, t0, t1, off, P, n) { const R = P.rng; for (let k = 0; k < n; k++) { const t = t0 + (t1 - t0) * (k + 0.5) / n, p = ept(e, t, off); treeL(B, p[0], p[1], 0, 4 + R() * 2.5, 1.4 + R() * 0.8, P.lod); } }

/* ---------- 小さなお店 ---------- */
// 見た目：bt（形：box 小さなビル・house 住宅つき・kanban 看板建築）・up（上の階：[lw か lw2, 行]）・uc（色）・rf・rm・rc（屋根）・aw（日よけの行）・sg（看板の色）・gf（店先の上書き）
const SHL = [
  { n: '白いタイルの店ビル', bt: 'box', up: ['lw2', 4], uc: '#ffffff', pc: '#e9e7e1', aw: 2, sg: '#2f4a6e', sg2: '#e9e7e1' },
  { n: '木の店先・瓦屋根', bt: 'house', up: ['lw', 6], uc: '#ffffff', rf: 'gable', rm: 'kawara', rc: '#a3a9b0', aw: null, sg: '#4e3524', gf: 'wood' },
  { n: '看板建築・銅板', bt: 'kanban', up: ['lw2', 5], uc: '#ffffff', sc: '#ddd8cc', rf: 'gable', rm: 'kawara', rc: '#959ba2', aw: 3, sg: '#40604f' },
  { n: 'レンガ調・緑の日よけ', bt: 'box', up: ['lw2', 1], uc: '#ffffff', pc: '#8e5644', aw: 1, sg: '#2e5a3c', sg2: '#e9e3d3' },
  { n: 'サイディング・住宅つき', bt: 'house', up: ['lw', 0], uc: '#e6e0d2', rf: 'hip', rm: 'slate', rc: '#6a6f76', aw: 0, sg: '#7a2f2a' },
  { n: '黒い外壁・ガラス', bt: 'box', up: ['lw2', 2], uc: '#ffffff', pc: '#35383c', aw: 6, sg: '#232528', sg2: '#b9a77c', gf: 'glass' },
  { n: 'モルタル・昭和の店', bt: 'box', up: ['lw', 1], uc: '#d8d1c0', pc: '#cdc5b3', aw: 5, sg: '#d9c9a2', sg2: '#8a3a2e', gf: 'shut' },
  { n: '町家・格子', bt: 'house', up: ['lw', 7], uc: '#ffffff', rf: 'gable', rm: 'kawara', rc: '#8a9097', aw: null, sg: '#3b2d22', gf: 'wa' },
  { n: 'しっくい白壁・木の窓', bt: 'house', up: ['lw', 4], uc: '#ffffff', rf: 'gable', rm: 'seam', rc: '#6f7d74', aw: 4, sg: '#55654a', gf: 'cafe' },
  { n: '打ちはなし・大きな窓', bt: 'box', up: ['lw2', 3], uc: '#ffffff', pc: '#b5b3ac', aw: null, sg: '#3d3f42', sg2: '#d9d6cf', gf: 'glass' },
];
const lwTex = k => k === 'lw2' ? tLW2() : tLW();
// 店先の種類 → [質感, 行, 入口の行]
const FRONT = { glass: () => [tGF(), 2, null], shut: () => [tGF(), 2, 3], bright: () => [tGF2(), 0, 1], rest: () => [tGF2(), 2, 1], cafe: () => [tGFW(), 3, null], wa: () => [tGFW(), 0, 1], wood: () => [tGFW(), 1, null], open: () => [tGFW(), 2, null], show: () => [tGF2(), 3, 1] };
const NOB = ['#b8443a', '#e2b53c', '#3d6aa8', '#e8e4da', '#3f8a5a', '#d8734a'];
function shop(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng;
  if (P.f <= 0) { plaza(B, P); return; }
  if (P.F.area > 950 && !ko.small) { bigbox(B, BBL[(P.look - 1) % BBL.length], P); return; }
  const f = cl(P.f, 1, 3), fn0 = fnOf(P.F, P);
  // 区画が 長方形なら 前に 1m あける（自動販売機など）
  let F, strip = null;
  if (P.F.rects.length === 1) { const fs = P.tilt ? 0.3 : 1.1, ss = P.tilt ? 0.1 : 0.3, fr0 = frame(P.F.rects[0], fn0), D = Math.min(fr0.D - ss, fs + 16); const r = fr0.rect(ss, fs, fr0.W - ss, D); F = rf(r[0], r[1], r[2], r[3]); strip = fr0;
    if (fr0.D - D > 3) { const yr = fr0.rect(0.3, D, fr0.W - 0.3, fr0.D - 0.3); B.flat('c', yr, 0.04, [0.6, 0.59, 0.55]); if (lod >= 2 && fr0.D - D > 7) { const p = fr0.p(fr0.W * 0.5, (D + fr0.D) / 2); B.car(p[0], p[1], Math.abs(fn0[1]) > 0.5 ? PI / 2 : 0, A.pick(R, [[0.9, 0.9, 0.88], [0.3, 0.32, 0.36], [0.6, 0.62, 0.64]]), 0.04); } } }
  else F = insP(P, 0.6);
  const fe = A.frontEdge(F, P.front), fn = [Math.round(fe.nx), Math.round(fe.nz)];
  const gh = 3.6, fh = 2.9, H = gh + (f - 1) * fh, uc = col(L.uc), bt = L.bt;
  const ft = (!ko.fix && L.gf) || ko.front || 'glass', [fm, fr1, fr2] = FRONT[ft]();
  const [um, ur] = L.up, umt = lwTex(um);
  if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.08, [0.6, 0.59, 0.56]);
  // 1階
  if (lod <= 0) { frontRow(B, fm, fe, 0, gh, 3.2, fr1, null); for (const e of F.edges) if (e !== fe) B.wallE(umt, e, 0, H, uc, { uv: [0, Math.max(1, Math.round(e.L / 3.6)) / 4, ...rowV(ur, 8)] }); if (f > 1) B.wallE(umt, fe, gh, H, uc, { uv: [0, Math.max(1, Math.round(fe.L / 3.6)) / 4, ...rowV(ur, 8)] }); }
  else {
    const ent = frontRow(B, fm, fe, 0, gh, 3.2, fr1, fr2, 4, ft === 'shut' ? 0 : null);
    const side = e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5;
    for (const e of F.edges) { if (e === fe) continue;
      if (bt === 'box' && side(e)) B.wallE(tWT(), e, 0, gh, mul(uc, 0.92), { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, gh / 4], ao: 0.86 });
      else lowWalls(B, umt, ur, 8, { edges: [e] }, 0, 1, gh, uc, {}); }
    // 上の階
    if (f > 1) lowWalls(B, umt, ur, 8, F, gh, f - 1, fh, uc, {});
  }
  // 屋根
  let top = H;
  if (bt === 'box') { if (lod >= 1 || P.yb < -0.5) para(B, F, H, 0.8, col(L.pc), lod, 0.2); else B.cap('c', F, H + 0.6, mul(L.pc, 0.85)); if (lod >= 0) roofFlat(B, F, H + 0.02); top = H + 0.8; }
  else {
    const rm = L.rm === 'kawara' ? tKawara() : L.rm === 'slate' ? tSlate() : tSeam(), oh = lod >= 1 ? 0.55 : 0.4;
    if (bt === 'kanban') {   // 看板建築：正面の壁を 屋根より高く・うしろに 切妻（棟は 奥へ）
      const Hf = H + 1.7, [rv0, rv1] = rowV(ur, 8);
      B.wallE(umt, fe, H, Hf, WH, { uv: [0, Math.max(1, Math.round(fe.L / 3.6)) / 4, rv1 - (rv1 - rv0) * 0.27, rv1] });
      if (lod >= 1) { ebox(B, fe, -0.05, fe.L + 0.05, -0.22, 0.3, Hf - 0.25, Hf, mul(L.sc, 0.95)); B.wallE('c', mkE(fe.bx - fe.nx * 0.22, fe.bz - fe.nz * 0.22, fe.ax - fe.nx * 0.22, fe.az - fe.nz * 0.22), H, Hf - 0.25, mul(L.sc, 0.78)); }
      top = Math.max(Hf, B.roofs(F, { t: 'gable', y: H, p: 0.42, hmax: 1.3, oh: 0.3, m: rm, c: col(L.rc), su: 3, mg: tWC(), gsu: 4, cg: uc, th: lod >= 1 ? 0.12 : 0, axF: () => (Math.abs(fn[1]) > 0.5 ? 'z' : 'x') }));
    } else top = B.roofs(F, { t: L.rf, y: H, p: 0.45, oh, m: rm, c: col(L.rc), su: 3, mg: tWC(), gsu: 4, cg: uc, th: lod >= 2 ? 0.15 : 0, cf: [0.3, 0.3, 0.3] });
  }
  if (lod <= 0) return;
  // 看板・日よけ・袖看板
  // 看板の帯・日よけ（色は 部屋ごとに かえられる：[日よけ, 看板, しま・線]）
  const L2 = fe.L, sgc = col(ko.sg || L.sg), awr = ko.aw === false || ft === 'wa' ? null : (ko.awr != null ? ko.awr : L.aw);
  if (ft === 'wa' || ft === 'wood') {   // 和風：木の看板（板）・ひさし
    band(B, P, fe, gh + 0.1, gh + 0.7, { from: L2 * 0.3, to: L2 * 0.7, def: ['#3e2f24', '#6a5440', '#6a5440'], pat: 'solid', th: 0.1, bc: [0.3, 0.23, 0.17] });
    if (lod >= 2) hisashi(B, fe, 0, L2, gh - 0.1, 0.9, [0.3, 0.31, 0.33]);
  } else {
    const aw = awr == null ? null : AWC[awr], def = aw ? [aw[0], sgc, aw[1]] : [sgc, L.sg2 || mul(sgc, 0.75), L.sg2 || mul(sgc, 0.75)];
    if (aw && lod >= 2) {   // 3D の 日よけ（部屋ごと）＋ 看板の帯（2 番めの色）
      const k = unitCols(P, def).length, cs = unitCols(P, def);
      for (let i = 0; i < k; i++) { const t0 = 0.2 + (L2 - 0.4) * i / k, t1 = 0.2 + (L2 - 0.4) * (i + 1) / k - (k > 1 ? 0.1 : 0); awningC(B, fe, t0, t1, gh - 0.95, 1.1, col(cs[i][0]), col(cs[i][2]), aw[2]); }
      const m = unitMap(P, def, [1, 2, 2]); band(B, P, fe, gh - 0.72, gh - 0.06, { from: 0.15, to: L2 - 0.15, def: m.def, pat: 'solid', th: 0.18, sub: m });
    } else band(B, P, fe, aw ? gh - 1.25 : gh - 0.72, gh - 0.06, { from: 0.15, to: L2 - 0.15, def, pat: aw ? 'awning' : 'solid', th: 0.18 });
  }
  const uc0 = unitCols(P, [sgc, sgc, sgc])[0];
  if (bt !== 'house' && f >= 2 && L2 > 5) sode(B, fe, L2 - 0.6, gh + 0.3, H - 0.2, [0.93, 0.93, 0.9], ko.sode ? col(ko.sode) : col(uc0[awr != null && ft !== 'wa' && ft !== 'wood' ? 1 : 0]), lod);
  if (lod < 2) return;
  // 店先の小物
  const n = fe.L, pt = (t, o) => ept(fe, t, o);
  if (ko.noren) { const a = pt(n / 2 - 0.9, 0.1), b = pt(n / 2 + 0.9, 0.1); B.wall('c', a[0], a[1], b[0], b[1], gh - 1.3, gh - 0.35, col(ko.noren)); }
  if (ko.lantern) for (const t of [n / 2 - 1.3, n / 2 + 1.3]) { const p = pt(t, 0.35); B.cyl('c', p[0], p[1], 0.22, gh - 1.6, gh - 0.9, 8, [0.85, 0.2, 0.15]); }
  const vm = ko.vm == null ? (R() < 0.6 ? 1 : 0) : ko.vm;
  for (let k = 0; k < vm; k++) { const p = pt(0.6 + k * 1.05, -0.5); vend(B, p[0], p[1], fn[0], fn[1], (P.id + k) % 3); }
  if (ko.disp) { const cell = { veg: [1, 2], flower: [2, 2], fish: [3, 3], books: [0, 2] }[ko.disp]; for (let k = 0; k < 2; k++) { const t = n * (0.3 + k * 0.4), p = pt(t, -0.45); pbox(B, tEQ(), p[0], p[1], fn[0], fn[1], Math.min(2.2, n * 0.3), 0.8, 0, 0.9, cellUV(cell[0], cell[1]), [0.5, 0.4, 0.3]); } }
  if (ko.bikes) for (let k = 0; k < ko.bikes; k++) { const p = pt(1 + k * 0.7, -0.6); bike(B, p[0], p[1], fe.nx, fe.nz, A.pick(R, [[0.7, 0.2, 0.2], [0.25, 0.35, 0.6], [0.8, 0.8, 0.78], [0.2, 0.2, 0.2]])); }
  if (ko.pole) { const p = pt(0.35, -0.3); B.cyl('c', p[0], p[1], 0.12, 1.2, 2.3, 8, [0.9, 0.9, 0.9]); B.cyl('c', p[0], p[1], 0.13, 1.45, 1.6, 8, [0.8, 0.15, 0.15]); B.cyl('c', p[0], p[1], 0.13, 1.8, 1.95, 8, [0.15, 0.25, 0.6]); }
  if (ko.nob) for (let k = 0; k < ko.nob; k++) { const p = pt(n - 0.5 - k * 1.2, -0.7); nobori(B, p[0], p[1], fn[0], fn[1], col(NOB[(P.id + k * 2) % NOB.length])); }
  if (ko.terrace && strip) { for (let k = 0; k < 2; k++) { const p = pt(n * (0.25 + 0.5 * k), -0.55); B.box('c', p[0] - 0.3, p[1] - 0.3, p[0] + 0.3, p[1] + 0.3, 0.68, 0.72, [0.4, 0.3, 0.22]); B.box('c', p[0] - 0.04, p[1] - 0.04, p[0] + 0.04, p[1] + 0.04, 0, 0.7, [0.25, 0.25, 0.25]); } }
  if (!ko.disp && !ko.bikes && R() < 0.7) { const p = pt(n - 0.6, -0.4); pot(B, p[0], p[1], 0.9); const q = pt(n - 1.3, -0.4); pot(B, q[0], q[1], 0.7, [0.55, 0.55, 0.52]); }
  if (ko.duct) { const e2 = F.edges.find(e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5) || fe; const p = ept(e2, e2.L * 0.7, 0.3); B.box('c', p[0] - 0.25, p[1] - 0.25, p[0] + 0.25, p[1] + 0.25, 1, top + 1.2, [0.7, 0.7, 0.68]); }
}
A.arch('b_shop', { looks: SHL, build: shop,
  far(L, P) { const f = cl(P.f, 1, 3); return { H: 3.6 + (f - 1) * 2.9, base: 0, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: L.bt === 'box' ? col(L.pc) : mix(L.uc, '#d8cfc0', 0.4), rt: L.bt === 'box' ? 'flat' : 'gable', roof: null, rc: L.bt === 'box' ? [0.6, 0.6, 0.58] : farRC(L.rm, L.rc), top: tFlat(), ct: [0.9, 0.9, 0.88], ins: 0.5 }; } });

/* ---------- コンビニ ---------- */
// 見た目：wc（壁）・b1（看板の帯）・b2・b3（細い線）・mk（まるい しるし）。実在のお店の色の組み合わせは 使わない
const KBL = [
  { n: 'ライムとグレー', wc: '#e9eae6', b1: '#5a5f65', b2: '#9cc33b', st: ['#9cc33b', '#5a5f65', '#c6dc8c'] },
  { n: '白とむらさきの線', wc: '#efefec', b1: '#f3f3f0', b2: '#6f4a9a', st: ['#6f4a9a', '#a58cc8', '#6f4a9a'] },
  { n: '木の壁・スレート色', wc: '#c99f72', wm: 'wd', b1: '#4f555b', b2: '#efece4', roof: true, st: ['#4f555b', '#9a8064', '#4f555b'] },
  { n: 'オリーブとベージュ', wc: '#ecebe6', b1: '#6b6f3a', b2: '#e3d6b5', st: ['#6b6f3a', '#c9b98a', '#6b6f3a'] },
  { n: 'ターコイズとグレー', wc: '#f0f1ee', b1: '#2a9d96', b2: '#5d6166', st: ['#2a9d96', '#5d6166', '#2a9d96'] },
  { n: 'こげ茶の壁・からし色', wc: '#6b5444', wm: 'wd', b1: '#c99a2e', b2: '#3a2a20', st: ['#c99a2e', '#3a2a20', '#c99a2e'] },
  { n: 'ピンクとグレー', wc: '#eeedea', b1: '#d9879a', b2: '#6d7076', st: ['#d9879a', '#6d7076', '#e9b7c3'] },
  { n: '白いタイル・深緑の屋根', wc: '#f2f1ec', wm: 'wt', b1: '#2f5a3d', b2: '#f2f2ee', roof: true, st: ['#2f5a3d', '#8fb59a', '#2f5a3d'] },
  { n: 'チャコールと赤い線', wc: '#e7e7e4', b1: '#3b3d41', b2: '#c4473a', st: ['#3b3d41', '#c4473a', '#3b3d41'] },
  { n: 'ラベンダーと白', wc: '#f1efea', b1: '#9c8ec4', b2: '#ffffff', st: ['#9c8ec4', '#c9c0e0', '#9c8ec4'] },
];
function konbini(B, L, P) {
  const lod = P.lod, R = P.rng;
  if (P.f <= 0) { plaza(B, P); return; }
  const F = insP(P, 0.5), fn = fnOf(F, P), r0 = bigR(F), fr = frame(r0, fn);
  const bd = fr.D < 16.5 ? fr.D : fr.D < 24 ? fr.D - 6.2 : cl(fr.D * 0.45, 13, 17), bwd = Math.min(fr.W, 30), u0 = fr.W > bwd ? (fr.W - bwd) * 0.5 : 0;
  const br = fr.rect(u0, fr.D - bd, u0 + bwd, fr.D), Fb = rf(br[0], br[1], br[2], br[3]), fe = Fb.edges.reduce((a, e) => (e.nx * fn[0] + e.nz * fn[1]) > (a.nx * fn[0] + a.nz * fn[1]) ? e : a);
  const H = 4.6, wc = col(L.wc), b1 = col(L.b1), b2 = col(L.b2);
  if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.12, [0.62, 0.61, 0.58]);
  // 店（正面ガラス・入口は はし）
  const m2 = tGF2(), nb = Math.max(1, Math.round(fe.L / 3.2)), ent = frontRow(B, m2, fe, 0, 3.4, 3.2, 0, 1, 4, nb > 3 ? 1 : 0, 1);
  const wmK = WMT[L.wm || 'wp']();
  B.wallE(wmK, fe, 3.4, H, wc, { uv: [0, fe.L / 4, 3.4 / 4, H / 4] });
  for (const e of Fb.edges) if (e !== fe) B.wallE(wmK, e, 0, H, wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, H / 4], ao: 0.86 });
  roofFlat(B, Fb, H);
  // 看板の帯（正面と 横）
  const side = Fb.edges.filter(e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5);
  // 白い帯に 横線 3 本（色は 部屋ごとに かえられる）
  band(B, P, fe, 3.45, H + 0.35, { from: -0.12, to: fe.L + 0.12, def: L.st, pat: 'stripes', th: 0.3, bc: [0.93, 0.93, 0.91] });
  for (const e of lod >= 1 ? side : []) { if (lod >= 2) band(B, P, e, 3.45, H + 0.35, { from: 0.2, to: e.L - 0.2, def: L.st, pat: 'stripes' }); else B.wallE('c', e, 3.45, H + 0.35, [0.95, 0.95, 0.93], { off: 0.1 }); }
  if (lod >= 1) { const bk = Fb.edges.filter(e => e !== fe && !side.includes(e)); for (const e of bk) B.wallE(tWC(), e, H, H + 0.35, mul(wc, 0.95)); }
  if (L.roof && lod >= 2) { for (const e of [fe, ...side]) { const a = ept(e, -0.12, 0.32), b = ept(e, e.L + 0.12, 0.32), a2 = ept(e, -0.12, -0.6), b2 = ept(e, e.L + 0.12, -0.6); B.quad(tSeam(), [a[0], H + 0.35, a[1]], [b[0], H + 0.35, b[1]], [b2[0], H + 1.1, b2[1]], [a2[0], H + 1.1, a2[1]], null, mul(b1, 1.0), [0, 0, e.L / 4, 0.25]); } }
  // 入口のひさし
  if (lod >= 1) hisashi(B, fe, ent[0] - 0.4, ent[1] + 0.4, 3.3, 1.2, mul(b1, 0.9));
  // 駐車場
  const pr = fr.rect(0, 0, fr.W, fr.D - bd);
  if (fr.D - bd > 5) parking(B, pr, fn, P, { cars: 4 });
  if (lod >= 1) for (const r of rest(F, r0, 4)) parking(B, r, fn, P, { cars: 2 });
  if (lod < 1) return;
  // ポール看板
  if (fr.D - bd > 6) { const p = fr.p(fr.W - 0.8, 0.8); const uc = unitCols(P, L.st)[0]; poleSign(B, p[0], p[1], fn[0], fn[1], 7.5, 2.2, 1.6, [0.95, 0.95, 0.93], col(uc[0]), lod >= 2 ? col(uc[1]) : null); }
  if (lod < 2) return;
  // ごみ箱・室外機
  { const t = ent[1] + 0.9, p = ept(fe, t, 0.5); B.box('c', p[0] - 0.7, p[1] - 0.3, p[0] + 0.7, p[1] + 0.3, 0, 1.0, [0.72, 0.74, 0.74]); }
  { const bk = Fb.edges.find(e => e.nx * fn[0] + e.nz * fn[1] < -0.5) || side[0]; if (bk) for (let k = 0; k < 4; k++) { const p = ept(bk, 2 + k * 1.0, 0.25); acu(B, p[0], p[1], bk.nx, bk.nz, 0.1, 1.2); } }
  for (let k = 0; k < 3; k++) { const p = fr.p(u0 + bwd * (0.25 + 0.22 * k), fr.D - bd * 0.5); acu(B, p[0], p[1], fn[0], fn[1], H + 0.1); }
}
A.arch('b_konbini', { looks: KBL, build: konbini,
  far(L) { return { H: 4.9, base: 0, wall: WMT[L.wm || 'wp'](), bw: 4, fh: 4, tb: 1, tf: 1, wc: mix(L.wc, L.b1, 0.25), rt: 'flat', top: tFlat(), ct: [0.92, 0.92, 0.9], ins: 1.5 }; } });

/* ---------- 郊外のお店（ドラッグストア・スーパー・ホームセンター・家電・ディーラー…） ---------- */
// 見た目：wc（壁）・sg（看板の帯）・s2（線）・mk（しるし）
const BBL = [
  { n: 'クリームとこげ茶の帯', wc: '#efe7d6', sg: '#5a3e2a', s2: '#d9b77a' },
  { n: 'グレーと青緑の帯', wc: '#d9dcdc', sg: '#257d78', s2: '#f2f2ee' },
  { n: '白いタイル・すみれ色', wc: '#f1f1ee', wm: 'wt', sg: '#6a4f8f', s2: '#f1f1ee', mk: '#f1f1ee' },
  { n: '木の壁・深緑の帯', wc: '#c49a6c', wm: 'wd', sg: '#2f5a3d', s2: '#e3d8c3' },
  { n: 'チャコールと銀の帯', wc: '#5d6064', sg: '#b9bcbe', s2: '#f0f0ee' },
  { n: '白いぬり壁・えんじ', wc: '#f0efea', wm: 'wc', sg: '#7a2c32', s2: '#efe5d8', mk: '#efe5d8' },
];
function bigbox(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = cl(P.f, 1, 6);
  if (P.f <= 0) { plaza(B, P); return; }
  const F = insP(P, 0.8), fn = fnOf(F, P), r0 = bigR(F), fr = frame(r0, fn);
  const small = F.area < 1100 || fr.D < 26, pk = small ? 0 : cl(fr.D * (ko.pk || 0.4), 9, 46);
  let br = small ? r0 : fr.rect(0, pk, fr.W, fr.D), Fb = small ? F : rf(br[0], br[1], br[2], br[3]);
  if (ko.show && !small) {   // ディーラー：ショールームは 小さめ（はば 40m・おく 24m まで）。のこりは 展示と駐車場
    const sw = Math.min(fr.W - 4, 40), sd = Math.min(fr.D - pk - 2, 24), u0 = (fr.W - sw) / 2; br = fr.rect(u0, pk, u0 + sw, pk + sd); Fb = rf(br[0], br[1], br[2], br[3]);
    for (const q of rest(rf(...fr.rect(0, pk, fr.W, fr.D)), br, 6)) parking(B, q, fn, P, { cars: 8 }); }
  const fe = A.frontEdge(Fb, fn), gh = ko.show ? 6 : (f === 1 ? 6.5 : 5), fh = 4.6, H = gh + (f - 1) * fh, wc = col(L.wc), sg = col(L.sg), s2 = col(L.s2);
  if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.15, [0.62, 0.61, 0.58]);
  // 正面：ガラスと入口（まん中）・のこりは パネル
  const wmB = WMT[L.wm || 'wp'](), L0 = fe.L, gw = ko.show ? L0 : Math.min(L0, cl(L0 * 0.45, 9.6, 32)), g0 = (L0 - gw) / 2, gy = Math.min(gh - 1.6, 4.0);
  const ge = esub(fe, g0, g0 + gw);
  if (ko.show) frontRow(B, tGF2(), ge, 0, gh - 0.8, 3.2, 3, null);
  else frontRow(B, tGF2(), ge, 0, gy, 3.2, 0, lod >= 1 ? 1 : null, 4, null, gw > 15 ? 2 : 1);
  if (g0 > 0.05) { B.wallE(wmB, fe, 0, gy, wc, { from: 0, to: g0, uv: [0, g0 / 4, 0, gy / 4], ao: 0.86 }); B.wallE(wmB, fe, 0, gy, wc, { from: g0 + gw, to: L0, uv: [0, (L0 - g0 - gw) / 4, 0, gy / 4], ao: 0.86 }); }
  B.wallE(wmB, fe, ko.show ? gh - 0.8 : gy, H, wc, { uv: [0, L0 / 4, gy / 4, H / 4] });
  for (const e of Fb.edges) if (e !== fe) B.wallE(wmB, e, 0, H, wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, H / 4], ao: 0.86 });
  B.cap(tSeam(), Fb, H, [0.92, 0.92, 0.92], { su: 4 });
  // 看板の帯
  const sw = Math.min(L0 - 1, Math.max(8, L0 * 0.55));
  const bdef = [L.sg, L.s2, L.mk || L.s2], ucB = unitCols(P, bdef)[0];
  band(B, P, fe, H - 2.1, H - 0.2, { from: (L0 - sw) / 2, to: (L0 + sw) / 2, def: bdef, pat: 'solid', th: 0.25, bc: mul(wc, 0.92) });
  if (lod >= 1) {
    para(B, Fb, H, 0.9, mul(wc, 0.96), lod, 0.2);
    if (!ko.show) hisashi(B, fe, g0 - 0.3, g0 + gw + 0.3, gy, 2.4, mul(ucB[0], 0.85)); }
  // 屋上の駐車場（2 階より上の 大きな お店）
  if (ko.deck && f >= 2 && lod >= 1 && fr.W > 25) parking(B, A.rin(br, 2.5), fn, Object.assign({}, P, { lod: 0 }), {});
  // 裏の荷さばき
  if (lod >= 1) { const bk = Fb.edges.find(e => e.nx * fn[0] + e.nz * fn[1] < -0.5); if (bk && bk.L > 10) { const t0 = bk.L * 0.2; frontRow(B, tGF(), esub(bk, t0, t0 + 9.6, 0.02), 0, 4.2, 3.2, 3, null); if (lod >= 2) { const p = ept(bk, t0 + 4.8, 4); B.obox('c', p[0], p[1], Math.atan2(bk.nz, bk.nx), 8, 2.4, 0.4, 3.6, [0.9, 0.9, 0.88]); B.obox('c', p[0] + bk.nx * 4.8, p[1] + bk.nz * 4.8, Math.atan2(bk.nz, bk.nx), 1.8, 2.3, 0.4, 2.8, [0.85, 0.85, 0.83]); } } }
  // 駐車場・ポール看板・小物
  if (!small) { parking(B, fr.rect(0, 0, fr.W, pk - 0.5), fn, P, { cars: 10 }); if (lod >= 1) { const p = fr.p(fr.W - 1.2, 1.2); poleSign(B, p[0], p[1], fn[0], fn[1], 10, 3, 3, col(ucB[0]), col(ucB[1]), null); } }
  for (const r of rest(F, r0, 4)) parking(B, r, fn, P, { cars: 4 });
  if (lod < 2) return;
  if (ko.show) for (let k = 0; k < Math.min(6, Math.floor(L0 / 6)); k++) { const p = ept(fe, 3 + k * 6, 3.4); B.car(p[0], p[1], Math.atan2(fe.nz, fe.nx) + 0.5, A.pick(R, [[0.85, 0.1, 0.1], [0.95, 0.95, 0.94], [0.15, 0.2, 0.35], [0.3, 0.3, 0.32], [0.75, 0.76, 0.78]]), 0.05); }
  if (ko.bikes) for (let k = 0; k < ko.bikes; k++) { const p = ept(fe, g0 - 1 - k * 0.7, 1.4); if (g0 - 1 - k * 0.7 > 0.5) bike(B, p[0], p[1], fe.nx, fe.nz); }
  if (ko.garden) { const t = L0 - 10; if (t > 4) { ebox(B, fe, t, L0 - 0.5, 0.2, 6, 0, 1.6, [0.45, 0.47, 0.45]); for (let k = 0; k < 4; k++) { const p = ept(fe, t + 1 + k * 2.2, 3); B.box('c', p[0] - 0.8, p[1] - 0.8, p[0] + 0.8, p[1] + 0.8, 1.6, 2.2, [0.33, 0.48, 0.28]); } } }
  for (let k = 0; k < Math.min(10, Math.round(Fb.area / 300)); k++) { const p = fr.p(fr.W * (0.15 + 0.7 * R()), pk + (fr.D - pk) * (0.25 + 0.6 * R())); acu(B, p[0], p[1], fn[0], fn[1], H + 0.05, 1.3); }
}
A.arch('b_bigbox', { looks: BBL, build: bigbox,
  far(L, P) { const f = cl(P.f, 1, 6); return { H: (f === 1 ? 6.5 : 5 + (f - 1) * 4.6) + 0.9, base: 0, wall: WMT[L.wm || 'wp'](), bw: 4, fh: 4, tb: 1, tf: 1, wc: mix(L.wc, L.sg, 0.15), rt: 'flat', top: tSeam(), ct: [0.9, 0.9, 0.9], ins: 3 }; } });

/* ---------- ファミレス・回転寿司・ファストフード・焼肉 ---------- */
// 見た目：wc（壁）・rf（屋根）・rm・rc・sg（看板）・s2
const FML = [
  { n: 'オレンジの瓦・クリーム', wc: '#f0e6d2', rf: 'hip', rm: 'yoga', rc: '#ffffff', sg: '#7a5236', s2: '#f3ead8' },
  { n: 'こげ茶の切妻・板張り', wc: '#b48a62', wm: 'wd', rf: 'gable', rm: 'slate', rc: '#6b4a36', sg: '#4b3527', s2: '#e3c58a' },
  { n: '平らな屋根・ガラス', wc: '#e9e9e6', rf: 'flat', sg: '#2f6f6a', s2: '#f0f0ec' },
  { n: '緑の金属屋根', wc: '#ece8dd', rf: 'gable', rm: 'seam', rc: '#5f8a6a', sg: '#3d6b4d', s2: '#f0ead8' },
  { n: '白い壁・こげ茶の帯', wc: '#f3f2ee', rf: 'flat', sg: '#4b3527', s2: '#f3f2ee', band: true },
];
function famires(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = cl(P.f, 1, 2);
  if (P.f <= 0) { plaza(B, P); return; }
  const F = insP(P, 0.6), fn = fnOf(F, P), r0 = bigR(F), fr = frame(r0, fn);
  const small = fr.D < 22 || fr.W < 14;
  const bwd = small ? fr.W : Math.min(fr.W * 0.7, ko.wide ? 34 : 24), bd = small ? fr.D : Math.min(fr.D * 0.55, ko.wide ? 26 : 18);
  const u0 = small ? 0 : (ko.drive ? fr.W - bwd - 0.5 : (fr.W - bwd) * 0.3), br = fr.rect(u0, fr.D - bd, u0 + bwd, fr.D), Fb = rf(br[0], br[1], br[2], br[3]);
  const fe = A.frontEdge(Fb, fn), gh = 4.2, H = gh + (f - 1) * 3.6, wc = col(L.wc), sg = col(L.sg);
  if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.3, [0.6, 0.59, 0.56]);
  // 客席の窓（正面と 横 1つ）・のこりは 壁
  const sideE = Fb.edges.find(e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5 && (e.nx + e.nz) * (fn[1] - fn[0]) >= 0) || Fb.edges.find(e => e !== fe);
  const ent = frontRow(B, tGF2(), fe, 0.3, gh, 3.2, 2, lod >= 1 ? 1 : null, 4, 0, 1);
  frontRow(B, tGF2(), sideE, 0.3, gh, 3.2, 2, null);
  const wmF = ko.dark ? tWP() : WMT[L.wm || 'wc']();
  for (const e of Fb.edges) if (e !== fe && e !== sideE) B.wallE(wmF, e, 0.3, H, ko.dark ? mul(wc, 0.5) : wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0.3 / 4, H / 4], ao: 0.86 });
  if (f > 1) for (const e of [fe, sideE]) B.wallE(wmF, e, gh, H, ko.dark ? mul(wc, 0.5) : wc, { uv: [0, e.L / 4, gh / 4, H / 4] });
  let top = H;
  if (L.rf === 'flat' || lod <= 0 && L.rf === 'flat') { if (lod >= 1) para(B, Fb, H, 1.0, mul(wc, 0.95), lod, 0.2); roofFlat(B, Fb, H + 0.02); top = H + 1; if (L.band) band(B, P, fe, H - 0.2, H + 1.0, { def: [L.sg, L.s2, L.sg], pat: 'solid', th: 0.2, bc: mul(wc, 0.92) }); }
  else top = B.roofs(Fb, { t: L.rf, y: H, p: 0.38, oh: 0.8, m: L.rm === 'yoga' ? tYoga() : L.rm === 'seam' ? tSeam() : tSlate(), c: col(L.rc), su: 3, mg: tWC(), gsu: 4, cg: wc, th: lod >= 1 ? 0.2 : 0, cf: mul(sg, 0.8) });
  if (lod <= 0) return;
  // 入口の ポーチ（切妻の ひさし）
  { const t0 = ent[0] - 0.5, t1 = ent[1] + 0.5, a = ept(fe, t0, 0), b = ept(fe, t1, 0), a2 = ept(fe, t0, 2.4), b2 = ept(fe, t1, 2.4); B.box('c', Math.min(a[0], b2[0]), Math.min(a[1], b2[1]), Math.max(a[0], b2[0]), Math.max(a[1], b2[1]), 3.2, 3.5, mul(unitCols(P, [L.sg, L.s2, L.sg])[0][0], 0.9)); void b; void a2; }
  // 看板
  if (L.rf !== 'flat') band(B, P, fe, gh - 0.9, gh - 0.1, { from: fe.L * 0.55, to: fe.L * 0.95, def: [L.sg, L.s2, L.sg], pat: 'solid', th: 0.15, bc: mul(wc, 0.92) });
  parking(B, fr.rect(0, 0, fr.W, fr.D - bd - 0.3), fn, P, { cars: 8 });
  if (!small && u0 > 6) parking(B, fr.rect(0, fr.D - bd, u0 - 0.3, fr.D), fn, P, { cars: 3 });
  for (const r of rest(F, r0, 4)) parking(B, r, fn, P, { cars: 3 });
  { const p = fr.p(fr.W - 1, 1), uc = unitCols(P, [L.sg, L.s2, L.sg])[0]; poleSign(B, p[0], p[1], fn[0], fn[1], ko.tall ? 11 : 8, 2.6, 2.2, col(uc[0]), col(uc[1]), null); }
  if (ko.drive && lod >= 1) {   // ドライブスルー（建物の横に 道）
    const lr = fr.rect(Math.max(0, u0 - 4.2), fr.D - bd - 2, Math.max(0.1, u0 - 0.6), fr.D - 0.5); B.flat('c', lr, 0.06, [0.42, 0.42, 0.43]);
    if (lod >= 2) { const p = fr.p(Math.max(0.6, u0 - 4.8), fr.D - bd * 0.55); B.box('c', p[0] - 0.4, p[1] - 0.4, p[0] + 0.4, p[1] + 0.4, 0, 2.2, mul(sg, 0.9)); } }
  if (lod < 2) return;
  if (ko.duct) for (let k = 0; k < 3; k++) { const p = fr.p(u0 + bwd * (0.25 + 0.25 * k), fr.D - bd * 0.3); B.box('c', p[0] - 0.3, p[1] - 0.3, p[0] + 0.3, p[1] + 0.3, H, top + 1.5, [0.68, 0.68, 0.66]); }
  for (let k = 0; k < 3; k++) { const bk = Fb.edges.find(e => e.nx * fn[0] + e.nz * fn[1] < -0.5); if (bk) { const p = ept(bk, 1.5 + k * 1.1, 0.3); acu(B, p[0], p[1], bk.nx, bk.nz, 0.3, 1.2); } }
  void R;
}
A.arch('b_famires', { looks: FML, build: famires,
  far(L, P) { const f = cl(P.f, 1, 2); return { H: 4.2 + (f - 1) * 3.6, base: 0, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: col(L.wc), rt: L.rf === 'flat' ? 'flat' : 'hip', roof: null, rc: L.rf === 'flat' ? [0.6, 0.6, 0.58] : farRC(L.rm, L.rc), top: tFlat(), ct: [0.9, 0.9, 0.88], ins: 3, p: 0.38 }; } });

/* ---------- ガソリンスタンド ---------- */
const GSL = [
  { n: '白い屋根・青緑の帯', c1: '#f2f2ef', c2: '#257d78', c3: '#f2f2ef' },
  { n: '銀の屋根・すみれ色', c1: '#c9cdd0', c2: '#6a4f8f', c3: '#e9e9e6' },
  { n: '白い屋根・からし色', c1: '#f1f0eb', c2: '#c99a2e', c3: '#4a4c50' },
  { n: 'グレーの屋根・こげ茶', c1: '#8d9196', c2: '#5a3e2a', c3: '#e8dcc0' },
];
function gas(B, L, P) {
  const lod = P.lod, R = P.rng;
  const F = insP(P, 0.4), fn = fnOf(F, P), r0 = bigR(F), fr = frame(r0, fn), c1 = col(L.c1), c2 = col(L.c2);
  B.cap('c', F, 0.06, [0.7, 0.7, 0.68]); if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.06, [0.6, 0.6, 0.58]);
  // 店（うしろ）
  const sw = Math.min(fr.W * 0.45, 12), sd = Math.min(fr.D * 0.3, 8), sr = fr.rect(fr.W - sw - 0.3, fr.D - sd - 0.3, fr.W - 0.3, fr.D - 0.3), Fs = rf(sr[0], sr[1], sr[2], sr[3]), fe = A.frontEdge(Fs, fn);
  frontRow(B, tGF2(), fe, 0.06, 3.2, 3.2, 0, lod >= 1 ? 1 : null, 4, 0, 1);
  for (const e of Fs.edges) if (e !== fe) B.wallE(tWP(), e, 0.06, 3.6, c1, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, 0.9] });
  B.wallE(tWP(), fe, 3.2, 3.6, c1, { uv: [0, fe.L / 4, 0.8, 0.9] }); B.cap(lod >= 1 ? tFlat() : 'c', Fs, 3.6, lod >= 1 ? WH : [0.62, 0.62, 0.6], { su: 12 });
  const gdef = [L.c2, L.c1, L.c3], ug = unitCols(P, gdef)[0];
  band(B, P, fe, 3.0, 3.9, { def: gdef, pat: 'solid', th: 0.15, bc: c1 });
  // 屋根（キャノピー）と 柱
  const cw = Math.min(fr.W - 1, 26), cd = Math.min(fr.D - sd - 1.5, 16);
  if (cd > 5) {
    const cr = fr.rect((fr.W - cw) / 2, 1, (fr.W + cw) / 2, 1 + cd), Fc = rf(cr[0], cr[1], cr[2], cr[3]), y0 = 5.2, y1 = 6.2;
    B.box('c', cr[0], cr[1], cr[2], cr[3], y0, y1, c1, { bottom: lod >= 1 });
    if (lod >= 1) { for (const e of Fc.edges) A.shopBand(B, P, e, y0 + 0.2, y0 + 0.7, { def: gdef, pat: 'solid', off: 0.03 }); B.flat('c', A.rin(cr, 0.4), y0 - 0.02, [0.97, 0.97, 0.95], { down: true }); }
    const ni = lod <= 0 ? 0 : cw > 18 ? 3 : 2;
    if (lod <= 0) for (const u of [(fr.W - cw) / 2 + cw * 0.3, (fr.W - cw) / 2 + cw * 0.7]) { const p = fr.p(u, 1 + cd / 2); B.box('c', p[0] - 0.25, p[1] - 0.25, p[0] + 0.25, p[1] + 0.25, 0.06, y0, [0.85, 0.85, 0.83]); }
    for (let i = 0; i < ni; i++) {
      const u = (fr.W - cw) / 2 + cw * (i + 0.5) / ni, p = fr.p(u, 1 + cd / 2), ax = Math.abs(fn[1]) > 0.5;
      const iw = ax ? 1.0 : 5.5, id = ax ? 5.5 : 1.0;
      B.box('c', p[0] - iw / 2, p[1] - id / 2, p[0] + iw / 2, p[1] + id / 2, 0.06, 0.3, [0.78, 0.78, 0.76]);
      for (const s of [-1, 1]) { const q = [p[0] + (ax ? 0 : s * 1.4), p[1] + (ax ? s * 1.4 : 0)]; if (lod >= 2 || s > 0) B.box('c', q[0] - 0.18, q[1] - 0.18, q[0] + 0.18, q[1] + 0.18, 0.3, y0, [0.85, 0.85, 0.83]);
        const d = [p[0] - (ax ? 0 : s * 2.1), p[1] - (ax ? s * 2.1 : 0)]; B.box('c', d[0] - (ax ? 0.4 : 0.35), d[1] - (ax ? 0.35 : 0.4), d[0] + (ax ? 0.4 : 0.35), d[1] + (ax ? 0.35 : 0.4), 0.3, 2.1, [0.94, 0.94, 0.92]); if (lod >= 2) B.box('c', d[0] - (ax ? 0.42 : 0.37), d[1] - (ax ? 0.37 : 0.42), d[0] + (ax ? 0.42 : 0.37), d[1] + (ax ? 0.37 : 0.42), 1.5, 1.9, col(ug[0])); }
      if (lod >= 2 && R() < 0.6) B.car(p[0] + (ax ? 2 : 0), p[1] + (ax ? 0 : 2), ax ? PI / 2 : 0, A.pick(R, [[0.9, 0.9, 0.88], [0.2, 0.2, 0.22], [0.55, 0.6, 0.65], [0.6, 0.12, 0.1]]), 0.06);
    }
  }
  if (lod >= 1) { const p = fr.p(0.9, 0.9); poleSign(B, p[0], p[1], fn[0], fn[1], 7, 1.8, 3.4, c1, col(ug[0]), lod >= 2 ? col(ug[2]) : null); }
  // 洗車機（広いとき）
  if (lod >= 1 && fr.W > 24 && fr.D > 24) { const wr = fr.rect(0.5, fr.D - 9, 5.5, fr.D - 0.5); B.box('c', wr[0], wr[1], wr[2], wr[3], 0.06, 3.4, mul(c1, 0.95)); B.box('c', wr[0] + 0.3, wr[1] + 0.3, wr[2] - 0.3, wr[3] - 0.3, 3.4, 3.6, c2); }
}
A.arch('b_gas', { looks: GSL, build: gas,
  far(L) { return { H: 6.2, base: 0, wall: tWP(), bw: 4, fh: 4, tb: 1, tf: 1, wc: col(L.c1), rt: 'flat', top: null, ct: col(L.c1), ins: 3 }; } });

/* ---------- ホテルの外壁（色をかける） ---------- */
const HCC = ['#f1ece1', '#ebe4d6', '#f3f0ea', '#e7dfcf', '#efe9df'];
// 1 ホテルの窓（部屋ごと・カーテン）：柱間 3.6・階 3.1
const tHT1 = () => T('ht1', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'tile', c: '#efede8', sc: u, j: '#aaa79f' }, R);
  for (let j = 0; j < 4; j++) { PT.fill(g, 0, j * mh + mh - 3 * u, w, 3 * u, '#dedbd3'); for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(i * mw, j * mh, 2 * u, mh);
    pwin(g, i * mw + mw * 0.2, j * mh + mh * 0.16, mw * 0.6, mh * 0.62, R, { u, rev: 0.3, f: '#cfd2d2', dv: 2, cur: 0.75, bl: 0, lit: 0.05, cc: HCC, sill: '#e2dfd8' }); } }
  PT.streaks(g, 0, 0, w, h, 14, 0.04, R); });
// 2 たての柱と 窓（窓の下は 色の板）
const tHT2 = () => T('ht2', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#eeece7', n: 0.025 }, R);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
    PT.fill(g, X + mw * 0.16, Y + mh * 0.68, mw * 0.68, mh * 0.32, '#c9c5bc'); g.fillStyle = 'rgba(0,0,0,.08)'; for (let k = 0; k < 3; k++) g.fillRect(X + mw * 0.16, Y + mh * (0.72 + k * 0.09), mw * 0.68, u);
    pwin(g, X + mw * 0.16, Y + mh * 0.06, mw * 0.68, mh * 0.62, R, { u, f: '#b9bcbd', dv: 2, cur: 0.7, cc: HCC, lit: 0.05 });
    PT.fill(g, X, Y, mw * 0.16, mh, '#f3f2ee'); PT.fill(g, X + mw * 0.12, Y, mw * 0.04, mh, '#cfccc4'); g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(X + mw * 0.16, Y, 2 * u, mh); } });
// 3 ベランダ（リゾート・コンドミニアム：手すり・隔て板・掃き出し窓）
const tHT3 = () => T('ht3', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#efede8', n: 0.02 }, R);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
    PT.fill(g, X, Y, mw, mh * 0.12, '#d9d6cf'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(X, Y + mh * 0.12, mw, mh * 0.05);   // 上のベランダの影
    glass(g, X + mw * 0.1, Y + mh * 0.17, mw * 0.8, mh * 0.6, R, { cur: 0.7, cc: HCC, g0: '#a9bccb', g1: '#40505e' }); wframe(g, X + mw * 0.1, Y + mh * 0.17, mw * 0.8, mh * 0.6, u * 1.3, '#c8cbcb', 4, 1);
    PT.fill(g, X + mw * 0.02, Y + mh * 0.6, mw * 0.96, mh * 0.3, '#e6e9ea'); g.fillStyle = 'rgba(160,190,205,.35)'; g.fillRect(X + mw * 0.02, Y + mh * 0.62, mw * 0.96, mh * 0.26); PT.fill(g, X + mw * 0.02, Y + mh * 0.6, mw * 0.96, u * 2, '#f6f6f3');
    PT.fill(g, X, Y + mh * 0.17, mw * 0.04, mh * 0.73, '#dcdad4'); PT.fill(g, X, Y + mh * 0.88, mw, mh * 0.12, '#e5e2db'); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(X, Y + mh - u, mw, u);
    if (R() < 0.35) PT.fill(g, X + mw * (0.15 + 0.5 * R()), Y + mh * 0.7, mw * 0.13, mh * 0.12, '#e2e2de'); } });
// ビジネスホテル 1：小さな窓（下に 空調のガラリ）・柱間 2.7・階 2.9
const tBH1 = () => T('bh1', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'tile', c: '#efede8', sc: u, j: '#a9a69e' }, R);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
    pwin(g, X + mw * 0.26, Y + mh * 0.22, mw * 0.48, mh * 0.46, R, { u, rev: 0.3, f: '#c6c9ca', dv: 1, cur: 0.8, cc: ['#f2efe8', '#eae6dc', '#f4f2ee'], lit: 0.04 });
    PT.fill(g, X + mw * 0.32, Y + mh * 0.74, mw * 0.36, mh * 0.08, '#cfd0ce'); for (let k = 0; k < 3; k++) PT.fill(g, X + mw * 0.33, Y + mh * (0.75 + k * 0.022), mw * 0.34, u * 0.8, '#8f9291'); }
  PT.streaks(g, 0, 0, w, h, 16, 0.045, R); });
// ビジネスホテル 2：たての窓の列（窓のあいだは 色の板）
const tBH2 = () => T('bh2', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#f0eee9', n: 0.025 }, R);
  for (let i = 0; i < 4; i++) { const X = i * mw; PT.fill(g, X + mw * 0.22, 0, mw * 0.56, h, '#bdb9b0'); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(X + mw * 0.22, 0, 2 * u, h);
    for (let j = 0; j < 4; j++) pwin(g, X + mw * 0.26, j * mh + mh * 0.12, mw * 0.48, mh * 0.56, R, { u, f: '#d2d4d4', dv: 1, cur: 0.8, cc: ['#f2efe8', '#eae6dc'], lit: 0.04 }); } });
// 旅館（鉄筋）：広縁の ガラスと 障子・木の手すり
const tRY = () => T('ry', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#ebe6db', n: 0.025 }, R);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
    PT.fill(g, X + mw * 0.06, Y + mh * 0.14, mw * 0.88, mh * 0.62, '#f2ede0'); for (let k = 1; k < 4; k++) PT.fill(g, X + mw * (0.06 + k * 0.22), Y + mh * 0.14, u, mh * 0.62, '#8a7258'); for (let k = 1; k < 5; k++) PT.fill(g, X + mw * 0.06, Y + mh * (0.14 + k * 0.124), mw * 0.88, u * 0.8, '#8a7258');
    if (R() < 0.4) { g.fillStyle = 'rgba(70,85,95,.5)'; g.fillRect(X + mw * 0.06, Y + mh * 0.14, mw * 0.44, mh * 0.62); }
    wframe(g, X + mw * 0.06, Y + mh * 0.14, mw * 0.88, mh * 0.62, u * 1.6, '#5a4634', 2, 1);
    PT.fill(g, X, Y + mh * 0.62, mw, mh * 0.04, '#6b4f38'); for (let k = 0; k < 10; k++) PT.fill(g, X + k * mw / 10, Y + mh * 0.62, u * 1.4, mh * 0.2, '#6b4f38'); PT.fill(g, X, Y + mh * 0.82, mw, mh * 0.18, '#d8d1c3'); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(X, Y + mh * 0.82, mw, u * 1.5); }
  PT.streaks(g, 0, 0, w, h, 10, 0.04, R); });
// ガラスの手すり・木の手すり など（ベランダの geometry 用）
const railC = { white: [0.95, 0.95, 0.93], glass: [0.72, 0.8, 0.84], dark: [0.25, 0.26, 0.27], wood: [0.45, 0.33, 0.23], blue: [0.35, 0.52, 0.68] };
// 正面の辺にそって ベランダ（各階の床と手すり。lod 2）
function balconies(B, e, y0, nf, fh, dep, rc, t0, t1) {
  const a = t0 || 0.3, b = t1 == null ? e.L - 0.3 : t1;
  for (let k = 0; k < nf; k++) { const y = y0 + k * fh; B.ledge(e, y - 0.18, y, dep, [0.86, 0.85, 0.82], { from: a, to: b }); B.rail(tRail(), e, y, 1.1, dep, rc, { from: a, to: b, su: 1.2 }); }
}

/* ---------- ビジネスホテル・駅前ホテル・カプセルホテル ---------- */
// 見た目：t（1・2：外壁）・wc（壁の色）・ac（帯の色）・vs（たて看板）・rs（屋上の看板）・cap（入口のひさしの色）
const BHL = [
  { n: '白いタイル・紺の帯', t: 1, wc: '#f2f1ec', ac: '#2b3f66', vs: '#2b3f66', rs: '#f4f4f0' },
  { n: 'ベージュ・茶の看板', t: 1, wc: '#e2d4b8', ac: '#6a4a33', vs: '#6a4a33', rs: '#efe6d3' },
  { n: '茶色のタイル・縦の窓', t: 2, wc: '#a07c62', ac: '#efe7d6', vs: '#efe7d6', rs: '#5a3e2c' },
  { n: 'グレー・赤い線', t: 1, wc: '#bfc1c2', ac: '#a8423a', vs: '#e9e9e6', rs: '#a8423a' },
  { n: '薄緑のタイル', t: 2, wc: '#cfdccf', ac: '#2f5a43', vs: '#2f5a43', rs: '#f0f2ee' },
  { n: 'ダークグレー・白い窓', t: 2, wc: '#6a6d71', ac: '#e9e8e4', vs: '#e9e8e4', rs: '#2d2f32' },
  { n: 'レンガ色・角の看板', t: 1, wc: '#b27a62', ac: '#3a2e28', vs: '#e8e0cf', rs: '#3a2e28' },
  { n: '白とグレーの二色', t: 2, wc: '#f2f2ef', ac: '#77797c', vs: '#77797c', rs: '#77797c', two: '#a9abad' },
  { n: 'クリーム・青い看板', t: 1, wc: '#efe6cc', ac: '#3d6a9c', vs: '#3d6a9c', rs: '#3d6a9c' },
  { n: '薄ピンク・こげ茶の帯', t: 2, wc: '#e9d5cf', ac: '#5a3c30', vs: '#f3eee8', rs: '#5a3c30' },
];
function bizhotel(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = Math.max(1, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 0.5), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn);
  let Fb = F0;
  if (F0.rects.length === 1 && (fr.D > 24 || fr.W > 48)) { const bw2 = Math.min(fr.W, 46), bd = Math.min(fr.D, 17.5), u0 = (fr.W - bw2) * 0.5, r = fr.rect(u0, 0, u0 + bw2, bd); Fb = rf(r[0], r[1], r[2], r[3]);
    for (const q of rest(F0, r, 4)) parking(B, q, fn, P, { cars: 3 }); }
  const fe = A.frontEdge(Fb, fn), gh = 4.4, fh = ko.cap ? 3.1 : 2.95, H = gh + (f - 1) * fh, wc = col(L.wc), ac = col(L.ac);
  const m = L.t === 2 ? tBH2() : tBH1();
  if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.12, [0.6, 0.59, 0.56]);
  // 1階：正面はロビー・ほかは タイル
  const ent = lod >= 1 ? lobby(B, fe, 0, gh, 3.2, {}) : (frontRow(B, tGF(), fe, 0, gh, 3.2, 0, null), [fe.L / 2 - 1.6, fe.L / 2 + 1.6]);
  for (const e of Fb.edges) if (e !== fe) B.wallE(tWT(), e, 0, gh, mul(wc, 0.9), { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, gh / 4], ao: 0.86 });
  // 上の階：長い辺は 窓・短い はしは 窓なし（階段）
  const isEnd = e => e.L < 13 && Fb.edges.some(o => o.L > e.L * 1.6);
  const cw = L.two ? col(L.two) : wc;
  if (ko.cap && lod >= 0) { B.facade(m, Fb, gh, H, { bw: 2.7, fh, tb: 4, tf: 4, vy: gh, c: wc, only: e => e === fe }); for (const e of Fb.edges) if (e !== fe) B.wallE(tWT(), e, gh, H, wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, gh / 4, H / 4] }); }
  else { B.facade(m, Fb, gh, H, { bw: 2.7, fh, tb: 4, tf: 4, vy: gh, c: wc, only: e => !isEnd(e) }); for (const e of Fb.edges) if (isEnd(e)) B.wallE(tWT(), e, gh, H, cw, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, gh / 4, H / 4] }); }
  if (lod <= 0) { roofFlat(B, Fb, H); return; }
  // 帯・屋上
  for (const e of Fb.edges) B.wallE(tWC(), e, H, H + 1.2, ac, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, 0.3] });
  B.parapet(Fb, H, 1.2, 0.25, mul(ac, 0.9), { noOuter: true }); roofFlat(B, Fb, H + 0.02);
  if (L.two && f > 4) for (const e of Fb.edges) ebox(B, e, 0, e.L, 0, 0.15, gh + fh - 0.3, gh + fh, cw);
  // 入口のひさし
  canopy(B, fe, ent[0] - 1.2, ent[1] + 1.2, 3.4, 2.2, ac, lod, false);
  // たて看板（正面の はし）・屋上の看板
  const vsT = (P.id % 2) ? 1.0 : fe.L - 1.0;
  if (f >= 4) sode(B, fe, vsT, gh + 0.8, H - 0.4, col(L.vs), mix(L.vs, '#ffffff', 0.55), lod);
  const rr = bigR(Fb), frr = frame(rr, fn);
  if (frr.W > 9) { const e = frr.edge(frr.W * 0.15, frr.W * 0.85, 1.2); const y = H + 1.2; signBox(B, e, 0, e.L, y + 0.2, y + 2.6, -0.2, 0.3, col(L.rs), col(L.rs)); for (const t of [0.6, e.L - 0.6]) { const p = ept(e, t, -0.5); B.box('c', p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, H, y + 0.2, [0.4, 0.4, 0.4]); } }
  roofKit(B, rr, H, P, { fn, c: mul(wc, 0.95), tank: f >= 6, ph: frr.W > 9 && frr.D > 9 });
  if (lod < 2) return;
  // 非常階段（横の はし）
  const se = Fb.edges.find(e => isEnd(e)) || Fb.edges.find(e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5);
  if (se && se.L > 4) { const t = se.L * 0.5; ebox(B, se, t - 1.4, t + 1.4, 0, 1.3, 0, 0.1, [0.4, 0.4, 0.4]); const e2 = esub(se, t - 1.4, t + 1.4, 0); for (let k = 1; k < f; k++) { const y = gh + (k - 1) * fh; B.ledge(e2, y - 0.12, y, 1.3, [0.45, 0.46, 0.46]); B.rail(tRail(), e2, y, 1.1, 1.3, [0.5, 0.5, 0.5], { su: 0.8 }); } }
  planters(B, fe, 0.6, ent[0] - 1.5, P);
}
A.arch('b_bizhotel', { looks: BHL, build: bizhotel,
  far(L, P) { const fh = P.ko.cap ? 3.1 : 2.95; return { H: 4.4 + (Math.max(1, P.f) - 1) * fh + 1.2, base: 0, wall: L.t === 2 ? tBH2() : tBH1(), bw: 2.7, fh, tb: 4, tf: 4, wc: col(L.wc), rt: 'flat', top: tFlat(), ct: [0.9, 0.9, 0.88], ins: 0.5 }; } });

/* ---------- シティホテル・高級ホテル ---------- */
// 見た目：tx（外壁の質感：ht1・ht2・ht4（ガラス）・of3…）・wc・crown（頭：glass・hip・step・flat・cornice・copper・barrel）・pd（低層部の色）
const tHT4 = () => T('ht4', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  const bg = g.createLinearGradient(0, 0, w * 0.5, h); bg.addColorStop(0, '#7d8f9c'); bg.addColorStop(0.6, '#3e4b56'); bg.addColorStop(1, '#55636e'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh, k = R(); g.fillStyle = css(A.pick(R, HCC), 1, 0.85);
    if (k < 0.5) { g.fillRect(X + mw * 0.06, Y + mh * 0.06, mw * 0.22, mh * 0.72); g.fillRect(X + mw * 0.72, Y + mh * 0.06, mw * 0.22, mh * 0.72); } else if (k < 0.75) g.fillRect(X + mw * 0.06, Y + mh * 0.06, mw * 0.88, mh * 0.72); else if (k < 0.85) { g.fillStyle = 'rgba(255,240,205,.55)'; g.fillRect(X + mw * 0.06, Y + mh * 0.06, mw * 0.88, mh * 0.72); } }
  for (let j = 0; j < 4; j++) PT.fill(g, 0, j * mh + mh * 0.8, w, mh * 0.2, '#e8e6e0');
  for (let i = 0; i <= 4; i++) PT.fill(g, i * mw - 2 * u, 0, 4 * u, h, '#ecebe6');
  g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(w * 0.2, 0); g.lineTo(w * 0.45, 0); g.lineTo(w * 0.1, h); g.lineTo(-w * 0.15, h); g.closePath(); g.fill(); }, { shiny: '#5a6068', sh: 30 });
const HTX = { ht1: tHT1, ht2: tHT2, ht4: tHT4, of3: () => tOF(3), of4: () => tOF(4), of9: () => tOF(9) };
const CHL = [
  { n: '白い外壁・ガラスの頭', tx: 'ht1', wc: '#f4f3ef', crown: 'glass', pd: '#d9d6cf' },
  { n: 'ベージュ・四角い屋根', tx: 'ht1', wc: '#e4d5b9', crown: 'hip', rc: '#6d7277', pd: '#cdbb9c' },
  { n: '茶色のタイル・段々', tx: 'ht2', wc: '#a8846a', crown: 'step', pd: '#8e6e57' },
  { n: 'ブルーのガラスの塔', tx: 'of3', wc: '#ffffff', crown: 'flat', pd: '#9aa4ab' },
  { n: '石張り・クラシック', tx: 'of4', wc: '#ffffff', crown: 'cornice', pd: '#a19e98' },
  { n: '白と金の縦線', tx: 'ht2', wc: '#f1e8d0', crown: 'flat', band: '#b8964e', pd: '#e3d7bb' },
  { n: 'グレー・縦の線', tx: 'ht2', wc: '#c3c5c6', crown: 'flat', pd: '#8f9295' },
  { n: '緑の銅板屋根', tx: 'ht1', wc: '#eee6d2', crown: 'copper', rc: '#6f9e88', pd: '#d7cbb0' },
  { n: '赤茶のタイル・弓形', tx: 'ht1', wc: '#b5806a', crown: 'barrel', rc: '#c2c5c7', pd: '#94634f' },
  { n: 'ガラスと白い枠', tx: 'ht4', wc: '#ffffff', crown: 'flat', pd: '#d8d8d4' },
];
// 塔の頭（見た目ごと）。Ft：塔の形・H：壁の上
function crown(B, Ft, H, L, P, fn, m, fh, vy, c) {
  const lod = P.lod, r = bigR(Ft), w = r[2] - r[0], d = r[3] - r[1], cr = L.crown, pc = c || WH;
  if (cr === 'hip' || cr === 'copper') { para(B, Ft, H, 0.6, mul(pc, 0.95), lod, 0.2); return B.roof({ t: cr === 'copper' ? 'hip' : 'pyramid', r: A.rin(r, 0.4), y: H + 0.4, p: 0.55, hmax: Math.min(w, d) * 0.35, oh: 0.2, m: tSeam(), c: col(L.rc), su: 4, th: 0.3 }); }
  if (cr === 'barrel') { para(B, Ft, H, 0.6, mul(pc, 0.95), lod, 0.2); return B.roof({ t: 'barrel', r: A.rin(r, 0.6), y: H + 0.6, p: 0.25, oh: 0, n: lod >= 2 ? 10 : lod >= 1 ? 6 : 3, m: tSeam(), c: col(L.rc), su: 4, mg: tWC(), cg: mul(pc, 0.95), gsu: 4 }); }
  if (cr === 'glass') { const Fg = A.inset(Ft, 1.2); B.facade(tOF(3), Fg, H, H + 4.2, { bw: 3.2, fh: 4.2, tb: 4, tf: 4, vy: H }); if (lod >= 1) for (const e of Ft.edges) B.ledge(e, H - 0.1, H + 0.25, 0.8, [0.9, 0.9, 0.88]); B.cap('c', Fg, H + 4.2, [0.75, 0.76, 0.76]); para(B, Fg, H + 4.2, 0.8, [0.85, 0.85, 0.83], lod, 0.2); roofFlat(B, Fg, H + 4.22); return H + 5; }
  if (cr === 'cornice' && lod >= 1) for (const e of Ft.edges) B.ledge(e, H - 0.8, H, 0.7, mul(pc, 0.98));
  para(B, Ft, H, 1.2, mul(L.band ? col(L.band) : pc, 0.96), lod, 0.25); roofFlat(B, Ft, H + 0.02);
  if (lod <= 0) return H + 1.2;
  if (P.f >= 25 && w > 22 && d > 22) { heli(B, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, H + 0.08, Math.min(w, d) * 0.3, lod >= 2 ? 20 : 10); return H + 1.2; }
  return Math.max(H + 1.2, roofKit(B, r, H, P, { fn, c: mul(pc, 0.95) }));
}
function cityhotel(B, L, P) {
  const ko = P.ko, lod = P.lod, f = Math.max(2, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 1.0), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn), wc = col(L.wc), pd = col(L.pd);
  const np = cl(Math.round(f * 0.15), 2, 4), pfh = 5, Hp = np * pfh, fh = 3.2, H = Hp + (f - np) * fh, m = HTX[L.tx]();
  if (lod >= 1 || P.yb < -0.5) B.plinth(F0, P.yb, 0.2, [0.6, 0.59, 0.56]);
  // 低層部（宴会場・ロビー）：正面はガラス・ほかは タイル
  const fe = A.frontEdge(F0, fn);
  frontRow(B, tGF(), fe, 0, pfh, 3.6, 0, lod >= 1 ? 1 : null, 4, null, 2);
  for (const e of F0.edges) if (e !== fe) B.wallE(tWT(), e, 0, Hp, pd, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, Hp / 4], ao: 0.86 });
  B.facade(m, { edges: [fe] }, pfh, Hp, { bw: 3.6, fh: pfh, tb: 4, tf: 4, vy: 0, c: wc });
  if (lod >= 1) para(B, F0, Hp, 1.0, mul(pd, 0.95), lod, 0.25); roofFlat(B, F0, Hp + 0.02, 0.96);
  // 塔（客室）：板状（奥行き 20m）か 四角
  const lux = ko.lux, TW = Math.min(fr.W - 6, lux ? 44 : 64), TD = Math.min(fr.D - 6, lux ? 40 : 21);
  let top = Hp;
  if (TW >= 12 && TD >= 10) {
    const v0 = Math.max(3, (fr.D - TD) * 0.55), u0 = (fr.W - TW) / 2, tr = fr.rect(u0, v0, u0 + TW, v0 + TD), Ft = rf(tr[0], tr[1], tr[2], tr[3]);
    let Ht = H;
    if (L.crown === 'step' && f - np > 8) { Ht = H - 3 * fh; B.facade(m, Ft, Hp, Ht, { bw: 3.6, fh, tb: 4, tf: 4, vy: Hp, c: wc }); para(B, Ft, Ht, 1.0, mul(wc, 0.95), lod, 0.25); roofFlat(B, Ft, Ht + 0.02);
      const Fs = A.inset(Ft, 3.6); B.facade(m, Fs, Ht, H, { bw: 3.6, fh, tb: 4, tf: 4, vy: Hp, c: wc }); top = crown(B, Fs, H, Object.assign({}, L, { crown: 'flat' }), P, fn, m, fh, Hp, wc); }
    else { B.facade(m, Ft, Hp, H, { bw: 3.6, fh, tb: 4, tf: 4, vy: Hp, c: wc }); top = crown(B, Ft, H, L, P, fn, m, fh, Hp, wc); }
    if (L.band && lod >= 1) for (const e of Ft.edges) ebox(B, e, 0, e.L, 0, 0.12, Hp + 2 * fh - 0.3, Hp + 2 * fh, col(L.band));
  } else { B.facade(m, F0, Hp, H, { bw: 3.6, fh, tb: 4, tf: 4, vy: Hp, c: wc }); top = crown(B, F0, H, L, P, fn, m, fh, Hp, wc); }
  if (lod <= 0) return;
  // 車寄せ（大きな ひさし）・植えこみ
  const mid = fe.L / 2; canopy(B, fe, mid - 7, mid + 7, 4.6, 6.5, mul(pd, 0.9), lod, true);
  if (lod >= 2) { planters(B, fe, 1, mid - 8, P); planters(B, fe, mid + 8, fe.L - 1, P); for (const t of [mid - 9, mid + 9]) { const p = ept(fe, t, 3.5); if (t > 1 && t < fe.L - 1) B.tree(p[0], p[1], 0, 6, 2.2); } }
  void top;
}
A.arch('b_cityhotel', { looks: CHL, build: cityhotel,
  far(L, P) { const f = Math.max(2, P.f), np = cl(Math.round(f * 0.15), 2, 4); return { H: np * 5 + (f - np) * 3.2 + 1.2, base: 0, wall: HTX[L.tx](), bw: 3.6, fh: 3.2, tb: 4, tf: 4, wc: col(L.wc), rt: 'flat', top: tFlat(), ct: [0.9, 0.9, 0.88], ins: 2 }; } });

/* ---------- リゾートホテル・オーシャンビュー・コンドミニアム ---------- */
// 見た目：wc・rail（手すりの色）・roof（flat・hip・yoga）・rc・terr（段々）・tower
const RSL = [
  { n: '白い壁・青い手すり', wc: '#f4f3ef', rail: 'blue', roof: 'flat' },
  { n: 'ベージュ・オレンジの瓦', wc: '#e8dcc4', rail: 'white', roof: 'yoga', rc: '#ffffff' },
  { n: '白・ガラスの手すり', wc: '#f1f2f0', rail: 'glass', roof: 'flat' },
  { n: '茶色のタイル', wc: '#a98468', rail: 'dark', roof: 'flat' },
  { n: '段々のテラス', wc: '#efeae0', rail: 'white', roof: 'flat', terr: true },
  { n: '白い壁・緑の屋根', wc: '#f2f1ec', rail: 'white', roof: 'hip', rm: 'slate', rc: '#5f8a6a' },
  { n: 'コンクリート・木の手すり', wc: '#c2bfb7', rail: 'wood', roof: 'flat' },
  { n: '淡いピンクの壁', wc: '#efd9d2', rail: 'white', roof: 'yoga', rc: '#e6d6cc' },
  { n: '和モダン・こげ茶', wc: '#6b5a4c', rail: 'wood', roof: 'hip', rm: 'kawara', rc: '#9aa0a6' },
  { n: '高層・ガラスの手すり', wc: '#e9eaea', rail: 'glass', roof: 'flat', tower: true },
];
// 板状の棟（長方形 r・正面 fn）：海がわ（正面）は ベランダ、うしろは 廊下の窓
function slabWing(B, r, fn, y0, nf, fh, L, P, o = {}) {
  const lod = P.lod, F = rf(r[0], r[1], r[2], r[3]), wc = col(L.wc), fe = A.frontEdge(F, fn), H = y0 + nf * fh;
  B.facade(tHT3(), F, y0, H, { bw: 3.8, fh, tb: 4, tf: 4, vy: y0, c: wc, only: e => e.nx * fn[0] + e.nz * fn[1] > -0.5 && e.L > 10 });
  B.facade(tHT1(), F, y0, H, { bw: 3.6, fh, tb: 4, tf: 4, vy: y0, c: wc, only: e => !(e.nx * fn[0] + e.nz * fn[1] > -0.5 && e.L > 10) });
  if (o.ground) frontRow(B, tGF(), fe, 0, y0, 3.6, 0, null);
  if (lod >= 2 && nf <= 16 && (P.bal = (P.bal || 0) + nf) <= 40) balconies(B, fe, y0 + fh, nf - 1, fh, 1.4, railC[L.rail], 0.4, fe.L - 0.4);
  if (L.roof === 'flat' || lod <= 0) { if (lod >= 1) para(B, F, H, 1.0, mul(wc, 0.97), lod, 0.25); roofFlat(B, F, H + 0.02); return H + 1; }
  return B.roof({ t: 'hip', r: A.rin(r, -0.2), y: H, p: 0.4, oh: 0.7, m: L.roof === 'yoga' ? tYoga() : L.rm === 'kawara' ? tKawara() : tSlate(), c: col(L.rc), su: 3, th: 0.25 });
}
function resort(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = Math.max(1, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 1.5), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn), wc = col(L.wc);
  const gh = 4.5, fh = 3.2, nf = f - 1, H = gh + nf * fh;
  B.cap('c', F0, 0.04, [0.47, 0.56, 0.38]);
  // 建物の位置：うしろ（道の反対）に 板状の棟。広いときは 両はしに 翼。とても深いときは 2 列
  const DD = 17, nRow = fr.D > 160 ? 2 : 1, L0 = Math.min(fr.W - 8, 150), wings = [];
  for (let k = 0; k < nRow; k++) {
    const vb = fr.D - 4 - k * (fr.D * 0.5), u0 = (fr.W - L0) / 2;
    if (L.tower || ko.condo) { const tw = Math.min(L0, 48), u1 = (fr.W - tw) / 2; wings.push([fr.rect(u1, vb - 22, u1 + tw, vb), H, 'main']); }
    else if (L.terr && f >= 5) { for (let s = 0; s < 3; s++) { const ns = Math.max(1, Math.round(nf * (1 - s * 0.33))); wings.push([fr.rect(u0, vb - DD - s * 6, u0 + L0, vb - s * 6), gh + ns * fh, s ? 'terr' : 'main']); } }
    else { wings.push([fr.rect(u0, vb - DD, u0 + L0, vb), H, 'main']); if (fr.W > 70 && fr.D > 55) { const wl = Math.min(fr.D * 0.45, 46); wings.push([fr.rect(u0, vb - DD - wl, u0 + DD, vb - DD), H - 2 * fh, 'wing']); wings.push([fr.rect(u0 + L0 - DD, vb - DD - wl, u0 + L0, vb - DD), H - 2 * fh, 'wing']); } }
  }
  if (lod >= 1 || P.yb < -0.5) for (const [r] of wings) B.plinth(rf(r[0], r[1], r[2], r[3]), P.yb, 0.15, [0.6, 0.59, 0.56]);
  for (const [r, Hw, kind] of wings) {
    const F = rf(r[0], r[1], r[2], r[3]), fe = A.frontEdge(F, fn);
    if (lod <= 0) { B.facade(tHT3(), F, 0, Hw, { bw: 3.8, fh, tb: 4, tf: 4, vy: gh - fh, c: wc }); if (L.roof === 'flat') roofFlat(B, F, Hw); else B.roof({ t: 'hip', r, y: Hw, p: 0.4, oh: 0.5, m: L.roof === 'yoga' ? tYoga() : L.rm === 'kawara' ? tKawara() : tSlate(), c: col(L.rc), su: 3, th: 0 }); continue; }
    frontRow(B, tGF(), fe, 0, gh, 3.6, 0, kind === 'main' && lod >= 1 ? 1 : null, 4, null, 2);
    for (const e of F.edges) if (e !== fe) lowWalls(B, tLW(), 1, 8, { edges: [e] }, 0, 1, gh, wc, { bw: 3.6 });
    const nfw = Math.max(1, Math.round((Hw - gh) / fh));
    slabWing(B, r, fn, gh, nfw, fh, L, P, {});
    if (kind === 'main' && lod >= 1) { const mid = fe.L / 2; canopy(B, fe, mid - 5, mid + 5, 4.0, 5, mul(wc, 0.85), lod, true); }
  }
  if (lod <= 0) return;
  // プール・デッキ・庭・駐車場
  const vf = fr.D - 4 - DD - (L.terr ? 12 : 0) - 2;
  if (vf > 16 && fr.W > 30) {
    const pw = Math.min(fr.W * 0.4, 40), pdp = Math.min(vf * 0.35, 16), u0 = (fr.W - pw) / 2, v0 = vf - pdp - 4;
    const deck = fr.rect(u0 - 4, v0 - 3, u0 + pw + 4, v0 + pdp + 3); B.flat(tPave(), deck, 0.08, [0.95, 0.92, 0.86], { su: 4 });
    const pool = fr.rect(u0, v0, u0 + pw, v0 + pdp); B.flat('c', pool, 0.1, [0.35, 0.68, 0.8]); B.flat('c', A.rin(pool, 0.8), 0.11, [0.42, 0.76, 0.86]);
    if (lod >= 2) for (let k = 0; k < Math.min(10, Math.round(pw / 4)); k++) { const p = fr.p(u0 + 2 + k * 4, v0 - 1.8); B.box('c', p[0] - 0.35, p[1] - 0.9, p[0] + 0.35, p[1] + 0.9, 0.08, 0.45, [0.95, 0.95, 0.93]); if (k % 2 === 0) { B.box('c', p[0] - 0.04, p[1] - 0.04, p[0] + 0.04, p[1] + 0.04, 0.08, 2.3, [0.5, 0.5, 0.5]); B.cone('c', p[0], p[1], 1.4, 2.0, 2.6, 8, A.pick(R, [[0.9, 0.9, 0.86], [0.25, 0.45, 0.65], [0.85, 0.45, 0.3]])); } }
    const pk = fr.rect(2, 2, Math.min(fr.W - 2, 40), Math.min(v0 - 6, 20)); if (pk[2] - pk[0] > 8 && pk[3] - pk[1] > 8) parking(B, pk, fn, P, { cars: 6 });
  }
  const nt = Math.min(lod >= 2 ? 20 : 10, Math.round(Math.sqrt(F0.area) / 6));
  for (let k = 0; k < nt; k++) { const r = A.pick(R, F0.rects), x = r[0] + 2 + (r[2] - r[0] - 4) * R(), z = r[1] + 2 + (r[3] - r[1] - 4) * R(); if (wings.some(([q]) => x > q[0] - 3 && x < q[2] + 3 && z > q[1] - 3 && z < q[3] + 3)) continue; treeL(B, x, z, 0.04, 5 + 4 * R(), 1.8 + 1.2 * R(), lod); }
}
A.arch('b_resort', { looks: RSL, build: resort,
  far(L, P) { const f = Math.max(1, P.f); return { H: 4.5 + (f - 1) * 3.2 + 1, base: 0, wall: tHT3(), bw: 3.8, fh: 3.2, tb: 4, tf: 4, wc: col(L.wc), rt: 'flat', top: tFlat(), ct: [0.86, 0.86, 0.84], ins: 6 }; } });

/* ---------- 宿（民宿・ペンション・旅館・コテージ・海の家） ---------- */
// 行の質感の だいたいの色（遠くの壁の色に）
const RAVG = { lw: ['#e6e3dc', '#e8e6e0', '#ddd8cf', '#a77c52', '#e9e3d6', '#cfc6b8', '#7d6d5d', '#d6cdbd'], lw2: ['#cfc0a2', '#93604c', '#3d4044', '#b0aea7', '#e6e3dc', '#6f9a86', '#d5cdbb', '#4a4643'] };
const rowAvg = (up, uc) => { const a = col(RAVG[up[0]][up[1]]), c = col(uc || '#ffffff'); return [a[0] * c[0], a[1] * c[1], a[2] * c[2]]; };
const roofTex = k => k === 'kawara' ? tKawara() : k === 'slate' ? tSlate() : k === 'yoga' ? tYoga() : tSeam();
// 遠く（far）の屋根の色（質感は 色をかけられないので、質感の だいたいの色 × 色）
const RTA = { kawara: [0.55, 0.57, 0.6], slate: [0.51, 0.53, 0.56], seam: [0.77, 0.78, 0.79], yoga: [0.7, 0.4, 0.28] };
const farRC = (rm, rc) => { const a = RTA[rm] || RTA.seam, c = col(rc || '#ffffff'); return [a[0] * c[0], a[1] * c[1], a[2] * c[2]]; };
// 区画の中に 建物の長方形（正面よりに。W・D の上限）。のこりは rest で
function placeR(F, fn, mw, md, fs = 1.5, ss = 1.2) { const r0 = bigR(F), fr = frame(r0, fn), W = Math.min(fr.W - 2 * ss, mw), D = Math.min(fr.D - fs - ss, md), u0 = (fr.W - W) / 2; return { r: fr.rect(u0, fs, u0 + W, fs + D), fr, r0, W, D }; }
// 玄関（小さな ポーチと とびら・ひさし）：辺 e の t・とびらの ます（eq の 3 行め）
function porch(B, e, t, c, P, o = {}) {
  const w = o.w || 1.9, d = o.d || 0.9, h = o.h || 2.5, p = ept(e, t, d / 2 - 0.02);
  if (P.lod < 2) { B.wallE(tEQ(), e, (o.y || 0), (o.y || 0) + 2.15, WH, { from: t - w * 0.31, to: t + w * 0.31, off: 0.08, uv: cellUV(o.cell == null ? 0 : o.cell, 3) }); if (P.lod >= 1) { const a = ept(e, t - w / 2 - 0.3, 0), b = ept(e, t + w / 2 + 0.3, 0), a2 = ept(e, t - w / 2 - 0.3, d + 0.5), b2 = ept(e, t + w / 2 + 0.3, d + 0.5), y = (o.y || 0) + h; B.quad('c', [a[0], y, a[1]], [b[0], y, b[1]], [b2[0], y - 0.1, b2[1]], [a2[0], y - 0.1, a2[1]], null, o.hc || [0.32, 0.33, 0.35]); } return; }
  pbox(B, tEQ(), p[0], p[1], e.nx, e.nz, w * 0.62, d, o.y || 0, (o.y || 0) + 2.15, cellUV(o.cell == null ? 0 : o.cell, 3), mul(c, 0.95));
  ebox(B, e, t - w / 2, t + w / 2, -0.02, d, (o.y || 0) + 2.15, (o.y || 0) + h, mul(c, 0.97));
  if (P.lod >= 1) hisashi(B, e, t - w / 2 - 0.3, t + w / 2 + 0.3, (o.y || 0) + h, d + 0.5, o.hc || [0.32, 0.33, 0.35]);
}
// 家のような 建物：F・階 nf・見た目 L（up・uc・rf・rm・rc・p）。返り値：屋根のいちばん上
function houseBld(B, F, P, L, nf, o = {}) {
  const lod = P.lod, fh = o.fh || 2.9, base = o.base == null ? 0.45 : o.base, H = base + nf * fh, uc = col(L.uc || '#ffffff'), m = lwTex(L.up[0]), row = L.up[1];
  if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, base, o.pc || [0.64, 0.63, 0.6]);
  if (lod <= 0) B.facade(tFarLo(), F, base, H, { bw: 3.6, fh: 2.9, tb: 2, tf: 2, vy: base, c: rowAvg(L.up, L.uc) });
  else lowWalls(B, m, row, 8, F, base, nf, fh, uc, {});
  if (L.rf === 'flat') { if (lod >= 1) para(B, F, H, 0.7, mul(rowAvg(L.up, L.uc), 1.05), lod, 0.2); roofFlat(B, F, H + 0.02); return H + 0.7; }
  return B.roofs(F, { t: L.rf, y: H, p: L.p || 0.5, oh: lod >= 1 ? (L.oh || 0.6) : 0.45, m: roofTex(L.rm), c: col(L.rc || '#ffffff'), su: 3, mg: tWC(), gsu: 4, cg: rowAvg(L.up, L.uc), th: lod >= 2 ? 0.15 : 0, cf: o.cf || [0.32, 0.3, 0.28], hi: L.hi, k1: 0.5 });
}
// 2 階の ベランダ（物干し・ふとん）
function veranda(B, e, y, P, o = {}) {
  const R = P.rng, L = e.L, t0 = L * 0.15, t1 = Math.min(L - 0.5, t0 + Math.max(3, L * 0.55)), dep = o.dep || 1.0;
  B.ledge(e, y - 0.15, y, dep, [0.8, 0.79, 0.76], { from: t0, to: t1 });
  B.rail(tRail(), e, y, 1.0, dep, o.rc || [0.75, 0.76, 0.76], { from: t0, to: t1, su: 1 });
  if (o.futon) { for (let k = 0; k < 2; k++) { const a = ept(e, t0 + 0.4 + k * 1.3, dep + 0.03), b = ept(e, t0 + 1.4 + k * 1.3, dep + 0.03); B.wall('c', a[0], a[1], b[0], b[1], y + 0.1, y + 1.05, A.pick(R, [[0.95, 0.93, 0.88], [0.85, 0.75, 0.8], [0.75, 0.82, 0.9], [0.92, 0.85, 0.7]])); } }
  else if (R() < 0.7) { for (let k = 0; k < 4; k++) { const a = ept(e, t0 + 0.3 + k * 0.6, dep * 0.5), b = ept(e, t0 + 0.75 + k * 0.6, dep * 0.5); B.wall('c', a[0], a[1], b[0], b[1], y + 1.15 - 0.6 * R(), y + 1.7, A.pick(R, [[0.95, 0.95, 0.93], [0.6, 0.7, 0.85], [0.85, 0.6, 0.6], [0.4, 0.42, 0.45]])); } const a = ept(e, t0 + 0.1, dep * 0.5), b = ept(e, t0 + 2.8, dep * 0.5); B.box('c', Math.min(a[0], b[0]) - 0.02, Math.min(a[1], b[1]) - 0.02, Math.max(a[0], b[0]) + 0.02, Math.max(a[1], b[1]) + 0.02, y + 1.7, y + 1.74, [0.7, 0.7, 0.7]); }
}
// 看板の柱（民宿・ペンションの 木の看板。文字なし）
function postSign(B, x, z, fx, fz, c, h = 2.2) { const tx = -fz, tz = fx; B.box('c', x - 0.06, z - 0.06, x + 0.06, z + 0.06, 0, h - 0.9, [0.35, 0.27, 0.2]); const a = [x - tx * 0.65, z - tz * 0.65], b = [x + tx * 0.65, z + tz * 0.65]; B.box('c', Math.min(a[0], b[0]) - Math.abs(fx) * 0.04, Math.min(a[1], b[1]) - Math.abs(fz) * 0.04, Math.max(a[0], b[0]) + Math.abs(fx) * 0.04, Math.max(a[1], b[1]) + Math.abs(fz) * 0.04, h - 0.9, h - 0.1, c); }
// 庭の木・砂利・車（区画のあいたところ）
function grounds(B, F, keep, P, o = {}) {
  const R = P.rng, lod = P.lod; if (lod < 1) return;
  const n = Math.min(o.max || 10, Math.round(Math.sqrt(F.area) / (o.per || 7)));
  for (let k = 0, t = 0; k < n && t < n * 3; t++) { const r = A.pick(R, F.rects), x = r[0] + 1.5 + (r[2] - r[0] - 3) * R(), z = r[1] + 1.5 + (r[3] - r[1] - 3) * R();
    if (keep.some(q => x > q[0] - 1.8 && x < q[2] + 1.8 && z > q[1] - 1.8 && z < q[3] + 1.8)) continue; k++;
    if (lod >= 2 || k % 2 === 0) treeL(B, x, z, 0, (o.th || 5) + 3 * R(), (o.tr || 1.6) + R(), lod, o.tc ? A.pick(R, o.tc) : null); }
}

/* 民宿：和風の 2〜3 階の家（瓦・板張り・モルタル）、駐車場、ふとんを干すベランダ */
const MSL = [
  { n: '黒い板張り・いぶし瓦', up: ['lw', 6], uc: '#ffffff', rf: 'gable', rm: 'kawara', rc: '#a3a9af' },
  { n: '白いモルタル・寄棟の瓦', up: ['lw', 1], uc: '#f2efe8', rf: 'hip', rm: 'kawara', rc: '#9aa0a6' },
  { n: 'しっくい・入母屋', up: ['lw', 7], uc: '#ffffff', rf: 'irimoya', rm: 'kawara', rc: '#8e949a' },
  { n: 'ベージュのサイディング', up: ['lw', 0], uc: '#e5d9c2', rf: 'gable', rm: 'slate', rc: '#6a6f76' },
  { n: '茶色の板・赤いトタン', up: ['lw', 2], uc: '#9b7f66', rf: 'gable', rm: 'seam', rc: '#9a4a3a', p: 0.4 },
  { n: '白い壁・青い屋根', up: ['lw', 1], uc: '#f4f3ee', rf: 'gable', rm: 'seam', rc: '#5f7fa6', p: 0.45 },
  { n: 'ベランダつき・スレート', up: ['lw', 0], uc: '#f1f0ea', rf: 'hip', rm: 'slate', rc: '#7d6a5a', big: true },
  { n: '古民家・大きな瓦屋根', up: ['lw', 7], uc: '#f3eee2', rf: 'irimoya', rm: 'kawara', rc: '#7d838a', p: 0.6, oh: 0.9 },
  { n: '灰色の板・緑の屋根', up: ['lw', 2], uc: '#b9b6ad', rf: 'gable', rm: 'seam', rc: '#6f9a80', p: 0.42 },
  { n: '三階建て・鉄筋', up: ['lw2', 0], uc: '#ffffff', rf: 'flat', sign: true },
];
function minshuku(B, L, P) {
  const lod = P.lod, R = P.rng, f = cl(P.f, 1, 3);
  if (P.f <= 0) { plaza(B, P); return; }
  const fn = fnOf(P.F, P), small = P.F.area <= 300;
  let F, keep = [];
  if (small) F = insP(P, 1.0);
  else { const pl = placeR(P.F, fn, 20, 12, P.tilt ? 0.3 : P.F.area > 900 ? 6.5 : 3, P.tilt ? 0.3 : 1.5); F = rf(pl.r[0], pl.r[1], pl.r[2], pl.r[3]); keep.push(pl.r);
    // 奥に 別館（広いとき）
    const back = pl.fr.D - 6.5 - pl.D - 2; if (back > 10 && pl.fr.W > 16) { const br = pl.fr.rect(pl.fr.W * 0.45, pl.fr.D - Math.min(back, 10) - 1, pl.fr.W - 1.5, pl.fr.D - 1.2); const Fa = rf(br[0], br[1], br[2], br[3]); houseBld(B, Fa, P, L, Math.max(1, f - 1)); keep.push(br); }
    const pk = pl.fr.rect(1, 0.3, Math.min(pl.fr.W - 1, 16), Math.min(6, pl.fr.D * 0.3)); if (P.F.area > 900 && lod >= 1) { B.flat('c', pk, 0.03, [0.62, 0.6, 0.56]); if (lod >= 2) for (let k = 0; k < 2; k++) { const p = pl.fr.p(3 + k * 3, 3); B.car(p[0], p[1], Math.abs(fn[1]) > 0.5 ? PI / 2 : 0, A.pick(R, [[0.92, 0.92, 0.9], [0.25, 0.26, 0.3], [0.62, 0.64, 0.66], [0.5, 0.15, 0.12]]), 0.03); } } }
  const fe = A.frontEdge(F, fn), uc = col(L.uc);
  const top = houseBld(B, F, P, L, f);
  if (lod <= 0) return;
  // 玄関・ひさし・看板
  const t = fe.L * 0.3; porch(B, fe, t, rowAvg(L.up, L.uc), P, { cell: 0 });
  if (L.sign) { const e = fe; signBox(B, e, e.L * 0.2, e.L * 0.8, 0.45 + f * 2.9 + 0.1, 0.45 + f * 2.9 + 1.4, 0.0, 0.2, [0.95, 0.94, 0.9]); }
  if (lod < 2) return;
  if (L.rf !== 'flat') hisashi(B, fe, 0.3, fe.L - 0.3, 0.45 + 2.6, 0.6, [0.35, 0.36, 0.38]);
  if (!L.sign) { const p = ept(fe, fe.L * 0.75, 1.3); postSign(B, p[0], p[1], fe.nx, fe.nz, [0.55, 0.42, 0.3], 2.4); }
  if (f >= 2) veranda(B, fe, 0.45 + 2.9, P, { futon: true, dep: L.big ? 1.4 : 0.9 });
  { const p = ept(fe, fe.L * 0.3 + 1.6, -0.5); vend(B, p[0] + fe.nx * 1.0, p[1] + fe.nz * 1.0, fe.nx, fe.nz, P.id % 3); }
  for (let k = 0; k < 2; k++) { const e = F.edges[(k * 2 + 1) % F.edges.length]; const p = ept(e, e.L * 0.6, 0.25); acu(B, p[0], p[1], e.nx, e.nz, 0.5); }
  grounds(B, P.F, keep.concat([F.bb]), P, { max: 6, per: 9 });
  void top; void uc;
}
A.arch('b_minshuku', { looks: MSL, build: minshuku,
  far(L, P) { const f = cl(P.f, 1, 3); return { H: 0.45 + f * 2.9, base: 0.45, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: rowAvg(L.up, L.uc), rt: L.rf === 'flat' ? 'flat' : L.rf === 'hip' ? 'hip' : 'gable', roof: null, rc: farRC(L.rm, L.rc), top: tFlat(), ct: [0.9, 0.9, 0.88], p: L.p || 0.5, ins: 2.5 }; } });

/* ペンション：洋風の 2〜3 階（白い壁・よろい戸・急な屋根・えんとつ）、庭と 駐車場 */
const PNL = [
  { n: '白い壁・赤い屋根', up: ['lw', 4], uc: '#ffffff', rf: 'gable', rm: 'slate', rc: '#b5584a', p: 0.75 },
  { n: 'ハーフティンバー', up: ['lw', 5], uc: '#ffffff', rf: 'gable', rm: 'slate', rc: '#6a4b3a', p: 0.85 },
  { n: '水色の板張り', up: ['lw', 0], uc: '#cfe0ea', rf: 'gable', rm: 'slate', rc: '#6c7177', p: 0.6 },
  { n: 'クリーム・緑の屋根', up: ['lw', 4], uc: '#f3ead2', rf: 'hip', rm: 'slate', rc: '#5f8a6a', p: 0.7 },
  { n: 'ログハウス風', up: ['lw', 3], uc: '#ffffff', rf: 'gable', rm: 'seam', rc: '#5a6e58', p: 0.55 },
  { n: '白い壁・オレンジの瓦', up: ['lw', 1], uc: '#f6f3ea', rf: 'hip', rm: 'yoga', rc: '#ffffff', p: 0.42 },
  { n: '黄色い壁・こげ茶の屋根', up: ['lw', 0], uc: '#f2e2a8', rf: 'gable', rm: 'slate', rc: '#5a4334', p: 0.7 },
  { n: '黒い板張り・片流れ', up: ['lw', 2], uc: '#55524e', rf: 'shed', rm: 'seam', rc: '#4a4d50', p: 0.3 },
  { n: '白いたて板・青い屋根', up: ['lw', 2], uc: '#f4f4f1', rf: 'gable', rm: 'slate', rc: '#5a7396', p: 0.8 },
  { n: 'レンガ風・グレーの屋根', up: ['lw2', 1], uc: '#ffffff', rf: 'hip', rm: 'slate', rc: '#6d7177', p: 0.6 },
];
function pension(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = cl(P.f, 1, ko.sea ? 2 : 4);
  if (P.f <= 0) { plaza(B, P); return; }
  const fn = fnOf(P.F, P), small = P.F.area <= 260;
  let F, keep = [], fr = null;
  if (small) F = insP(P, 1.0);
  else { const pl = placeR(P.F, fn, ko.sea ? 15 : 18, ko.sea ? 10 : 12, P.tilt ? 0.3 : P.F.area > 900 ? 7 : 3.5, P.tilt ? 0.3 : 2); fr = pl.fr; F = rf(pl.r[0], pl.r[1], pl.r[2], pl.r[3]); keep.push(pl.r);
    if (P.F.area > 900 && lod >= 1) { const pk = fr.rect(1, 0.5, Math.min(fr.W - 1, 14), 5.8); B.flat('c', pk, 0.03, [0.58, 0.56, 0.52]); if (lod >= 2) { const p = fr.p(3.5, 3); B.car(p[0], p[1], Math.abs(fn[1]) > 0.5 ? PI / 2 : 0, A.pick(R, [[0.92, 0.92, 0.9], [0.3, 0.45, 0.35], [0.62, 0.64, 0.66]]), 0.03); } } }
  const fe = A.frontEdge(F, fn);
  const top = houseBld(B, F, P, L, f, { cf: [0.92, 0.92, 0.9] });
  if (lod <= 0) return;
  const wc = rowAvg(L.up, L.uc);
  porch(B, fe, fe.L * 0.5, wc, P, { cell: 0, hc: col(L.rc) });
  // えんとつ・屋根窓
  const r = bigR(F), H = 0.45 + f * 2.9;
  if (L.rf !== 'shed' && L.rf !== 'flat') { const p = [r[0] + (r[2] - r[0]) * 0.78, r[1] + (r[3] - r[1]) * 0.35]; B.box('c', p[0] - 0.35, p[1] - 0.35, p[0] + 0.35, p[1] + 0.35, H, top + 0.8, [0.55, 0.42, 0.36]); B.box('c', p[0] - 0.42, p[1] - 0.42, p[0] + 0.42, p[1] + 0.42, top + 0.8, top + 0.95, [0.4, 0.38, 0.36]); }
  if (lod >= 2 && L.rf === 'gable' && f <= 3) { // 屋根窓（ドーマー）
    const fr2 = frame(r, fn); if (fr2.W > 7 && (r[2] - r[0] >= r[3] - r[1]) === (Math.abs(fn[1]) > 0.5)) for (const u of [fr2.W * 0.3, fr2.W * 0.7]) { const p = fr2.p(u, fr2.D * 0.28), dw = 1.6;
      const dr = Math.abs(fn[1]) > 0.5 ? [p[0] - dw / 2, p[1] - 1.2, p[0] + dw / 2, p[1] + 1.2] : [p[0] - 1.2, p[1] - dw / 2, p[0] + 1.2, p[1] + dw / 2];
      B.box('c', dr[0], dr[1], dr[2], dr[3], H + 0.3, H + 1.9, wc); B.roof({ t: 'gable', r: dr, y: H + 1.9, p: 0.9, oh: 0.15, ax: Math.abs(fn[1]) > 0.5 ? 'z' : 'x', m: roofTex(L.rm), c: col(L.rc), su: 3, th: 0, cg: wc }); const de = A.frontEdge(rf(dr[0], dr[1], dr[2], dr[3]), fn); B.wallE(tEQ(), de, H + 0.6, H + 1.7, WH, { from: de.L / 2 - 0.45, to: de.L / 2 + 0.45, off: 0.06, uv: cellUV(1, 3) }); } }
  if (lod < 2) return;
  if (f >= 2) veranda(B, fe, 0.45 + 2.9, P, { dep: ko.sea ? 2.0 : 1.1, rc: [0.92, 0.92, 0.9] });
  if (ko.sea) { B.ledge(fe, 0.25, 0.45, 3.0, [0.62, 0.5, 0.38], { from: 0.5, to: fe.L - 0.5 }); B.rail(tRail(), fe, 0.45, 0.95, 3.0, [0.95, 0.95, 0.93], { from: 0.5, to: fe.L - 0.5, su: 1 }); }
  { const q = fr ? fr.p(fr.W - 2.5, 1.2) : ept(fe, fe.L - 0.5, 0.6); postSign(B, q[0], q[1], fn[0], fn[1], [0.95, 0.93, 0.88], 2.0); }
  grounds(B, P.F, keep.concat([F.bb]), P, { max: 4, per: 9 });
  for (let k = 0; k < 2; k++) { const p = ept(fe, 1 + k * 1.2, 0.9); if (1 + k * 1.2 < fe.L * 0.5 - 1.2) pot(B, p[0], p[1], 0.7, [0.7, 0.4, 0.3]); }
}
A.arch('b_pension', { looks: PNL, build: pension,
  far(L, P) { const f = cl(P.f, 1, 4); return { H: 0.45 + f * 2.9, base: 0.45, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: rowAvg(L.up, L.uc), rt: L.rf === 'hip' ? 'hip' : 'gable', roof: null, rc: farRC(L.rm, L.rc), p: Math.min(0.8, L.p || 0.6), ins: 3 }; } });

/* 旅館・温泉旅館：木造（板張り・しっくい・瓦）か 鉄筋（広縁の窓）、庭・塀・玄関の 大きな ひさし */
const RYL = [
  { n: '黒い板と白壁・入母屋', up: ['lw', 6], uc: '#ffffff', rf: 'irimoya', rm: 'kawara', rc: '#9aa0a6', p: 0.55 },
  { n: 'しっくいと格子・切妻', up: ['lw', 7], uc: '#ffffff', rf: 'gable', rm: 'kawara', rc: '#8e949a', p: 0.5 },
  { n: '鉄筋・瓦の屋根', rc_: true, wc: '#e9e1cf', rf: 'hip', rm: 'kawara', rc: '#9aa0a6' },
  { n: '鉄筋・白い壁', rc_: true, wc: '#f2f0ea', rf: 'flat', rc: '#8e949a' },
  { n: '数寄屋風・銅板屋根', up: ['lw', 7], uc: '#f4efe2', rf: 'hip', rm: 'seam', rc: '#6f9e88', p: 0.45 },
  { n: '茶色の壁・大きな屋根', up: ['lw', 6], uc: '#c9b8a2', rf: 'hip', rm: 'kawara', rc: '#7d838a', p: 0.6, oh: 1.0 },
];
function ryokan(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = cl(P.f, 1, 8);
  if (P.f <= 0) { plaza(B, P); return; }
  const fn = fnOf(P.F, P), F0 = insP(P, 1.2);
  // 区画の まわり 1 区画ぶんに 建物（中は 庭）。小さいときは 全部
  const cs = P.F.cs || 10, cells = P.F.cells || [], set = new Set(cells.map(c => c[0] + ',' + c[1]));
  let ring = cells;
  if (cells.length >= 9) { const inner = cells.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dx, dy]) => set.has((x + dx) + ',' + (y + dy)))); if (inner.length >= 1) { const iset = new Set(inner.map(c => c[0] + ',' + c[1])); ring = cells.filter(c => !iset.has(c[0] + ',' + c[1])); if (lod >= 1) { const Fi = A.inset(subF(P.F, inner), -0.5); B.cap('c', Fi, 0.05, [0.42, 0.52, 0.34]); grounds(B, Fi, [], P, { max: 8, per: 5, th: 4, tc: [[0.24, 0.38, 0.2], [0.3, 0.42, 0.24], [0.5, 0.35, 0.25]] }); if (lod >= 2) { const r = bigR(Fi), cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2; B.flat('c', [cx - 2.5, cz - 1.6, cx + 2.5, cz + 1.6], 0.07, [0.36, 0.5, 0.56]); for (let k = 0; k < 5; k++) { const x = cx + (R() - 0.5) * 8, z = cz + (R() - 0.5) * 6; B.box('c', x - 0.4, z - 0.3, x + 0.4, z + 0.3, 0, 0.5, [0.55, 0.55, 0.52]); } } } } }
  const F = ring === cells ? F0 : A.inset(subF(P.F, ring), 1.2), fe = A.frontEdge(F, fn);
  let top;
  if (L.rc_) {   // 鉄筋の 温泉旅館
    const gh = 4.2, fh = 3.3, H = gh + (f - 1) * fh, wc = col(L.wc);
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.2, [0.6, 0.59, 0.56]);
    frontRow(B, tGFW(), fe, 0, gh, 3.6, 0, lod >= 1 ? 1 : null, 4, null, 2);
    for (const e of F.edges) if (e !== fe) lowWalls(B, tLW(), 6, 8, { edges: [e] }, 0, 1, gh, WH, {});
    if (f > 1) B.facade(tRY(), F, gh, H, { bw: 3.6, fh, tb: 4, tf: 4, vy: gh, c: wc });
    if (L.rf === 'flat' || lod <= 0) { if (lod >= 1) { para(B, F, H, 0.9, mul(wc, 0.95), lod, 0.25); for (const e of F.edges) B.ledge(e, H - 0.4, H, 0.6, [0.5, 0.52, 0.55]); } roofFlat(B, F, H + 0.02); top = H + 0.9; }
    else { const Fr = F.maxr.length <= 6 ? F : { maxr: [bigR(F)], rects: [bigR(F)] }; top = B.roofs(Fr, { t: 'hip', y: H, p: 0.45, oh: 0.9, m: tKawara(), c: col(L.rc), su: 3, th: 0.3, hmax: 5 }); }
    if (lod >= 1) for (const e of F.edges) B.ledge(e, gh - 0.3, gh, 0.9, [0.38, 0.39, 0.41]);
  } else top = houseBld(B, F, P, L, Math.min(f, 4), { fh: 3.0, base: 0.5, pc: [0.5, 0.5, 0.48] });
  if (lod <= 0) return;
  // 玄関の 大きな 切妻の ひさし（唐破風のかわり）
  { const t = fe.L * 0.5, d = 3.2, w = 5.2, a = ept(fe, t - w / 2, 0), b = ept(fe, t + w / 2, d), r = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    if (lod >= 2) for (const s of [[t - w / 2 + 0.3, d - 0.3], [t + w / 2 - 0.3, d - 0.3]]) { const p = ept(fe, s[0], s[1]); B.box('c', p[0] - 0.14, p[1] - 0.14, p[0] + 0.14, p[1] + 0.14, 0, 3.0, [0.36, 0.26, 0.18]); }
    B.roof({ t: 'gable', r, y: 3.0, p: 0.55, oh: 0.4, ax: Math.abs(fe.nz) > 0.5 ? 'z' : 'x', m: tKawara(), c: col(L.rc || '#9aa0a6'), su: 3, th: lod >= 2 ? 0.2 : 0, cg: [0.45, 0.34, 0.24] }); }
  // 塀（正面。入口は あける）
  if (lod >= 1 && P.F.rects.length && !P.tilt) { const fe0 = A.frontEdge(P.F, fn); const mid = fe0.L / 2; for (const [t0, t1] of [[0.4, mid - 4], [mid + 4, fe0.L - 0.4]]) if (t1 - t0 > 1) { if (lod >= 2) { ebox(B, fe0, t0, t1, -0.5, -0.25, 0, 1.6, [0.9, 0.88, 0.84]); ebox(B, fe0, t0 - 0.05, t1 + 0.05, -0.55, -0.2, 1.6, 1.8, [0.4, 0.42, 0.45]); } else B.wallE('c', fe0, 0, 1.8, [0.86, 0.84, 0.8], { from: t0, to: t1, off: -0.35 }); } }
  if (lod < 2) return;
  if (ko.onsen) { const r = bigR(F), p = [r[2] - 2.5, r[1] + 2.5]; B.cyl('c', p[0], p[1], 0.5, 0, top + 4, 8, [0.62, 0.6, 0.58]); }
  void top;
}
A.arch('b_ryokan', { looks: RYL, build: ryokan,
  far(L, P) { const f = cl(P.f, 1, 8); return L.rc_ ? { H: 4.2 + (f - 1) * 3.3 + 0.9, base: 0, wall: tRY(), bw: 3.6, fh: 3.3, tb: 4, tf: 4, wc: col(L.wc), rt: 'flat', top: tFlat(), ct: [0.86, 0.86, 0.84], ins: 1.5 } : { H: 0.5 + Math.min(f, 4) * 3.0, base: 0.5, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: rowAvg(L.up, L.uc), rt: 'hip', roof: null, rc: farRC(L.rm, L.rc), p: 0.5, ins: 1.5 }; } });

/* コテージ：区画に 小さな 木の小屋を いくつか（デッキ・えんとつ・木・車）*/
// 見た目：up（壁）・uc・ty（形：gable・aframe・shed・dome・loft）・rm・rc
const CTL = [
  { n: 'ログハウス・緑の屋根', up: ['lw', 3], uc: '#ffffff', ty: 'gable', rm: 'seam', rc: '#5f7f5e' },
  { n: 'ログハウス・赤い屋根', up: ['lw', 3], uc: '#f0e6dc', ty: 'gable', rm: 'seam', rc: '#9a4a3c' },
  { n: '黒い板張り・切妻', up: ['lw', 2], uc: '#4a4846', ty: 'gable', rm: 'seam', rc: '#c9ccce', p: 0.7 },
  { n: '白い板張り・急な屋根', up: ['lw', 2], uc: '#f5f5f2', ty: 'gable', rm: 'slate', rc: '#4d5257', p: 1.0 },
  { n: '三角屋根（Aフレーム）', up: ['lw', 2], uc: '#c79a6a', ty: 'aframe', rm: 'slate', rc: '#4f4842' },
  { n: '片流れ・杉板', up: ['lw', 2], uc: '#c8976a', ty: 'shed', rm: 'seam', rc: '#55585b' },
  { n: '白いドームテント', ty: 'dome', uc: '#f2f1ec' },
  { n: '丸太と石の土台', up: ['lw', 3], uc: '#d8c8b8', ty: 'gable', rm: 'slate', rc: '#5c6066', stone: true },
  { n: '二階建て・バルコニー', up: ['lw', 2], uc: '#d6b58e', ty: 'loft', rm: 'seam', rc: '#6a4c3a', p: 0.65 },
  { n: '赤い板張り・白い窓', up: ['lw', 2], uc: '#9a4a3c', ty: 'gable', rm: 'slate', rc: '#3a3c3f', p: 0.75 },
];
function cabin(B, r, fn, L, P, big) {
  const lod = P.lod, R = P.rng, F = rf(r[0], r[1], r[2], r[3]), fe = A.frontEdge(F, fn), w = r[2] - r[0], d = r[3] - r[1];
  const wc = L.up ? rowAvg(L.up, L.uc) : col(L.uc), base = L.stone ? 0.9 : 0.6, ty = L.ty, axr = Math.abs(fn[1]) > 0.5 ? 'z' : 'x';
  // デッキ（正面）
  if (lod >= 2) { B.ledge(fe, base - 0.2, base, 2.2, [0.6, 0.47, 0.34], { from: 0.2, to: fe.L - 0.2 }); B.rail(tRail(), fe, base, 0.9, 2.2, [0.55, 0.42, 0.3], { from: 0.2, to: fe.L - 0.2, su: 0.8 }); }
  else if (lod >= 1) { const a = ept(fe, 0.2, 0), b = ept(fe, fe.L - 0.2, 2.2); B.flat('c', [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], base, [0.6, 0.47, 0.34]); }
  if (ty === 'dome') { const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, rr = Math.min(w, d) / 2; if (lod >= 2) B.box('c', r[0], r[1], r[2], r[3], 0, base, [0.6, 0.47, 0.34]); B.dome('c', cx, cz, rr, rr, base, rr * 0.95, lod >= 2 ? 8 : 6, wc, { rings: lod >= 2 ? 3 : 2 });
    if (lod >= 2) { const p = ept(fe, fe.L / 2, -rr * 0.12); pbox(B, tEQ(), p[0], p[1], fe.nx, fe.nz, 1.6, 0.6, base, base + 2.0, cellUV(1, 3), wc); } return base + rr; }
  if (lod >= 2 || P.yb < -0.5) B.plinth(F, P.yb, base, L.stone ? [0.55, 0.54, 0.52] : [0.4, 0.33, 0.27]);
  if (ty === 'aframe') { const ar = A.rin(r, -0.2), top = B.roof({ t: 'gable', r: ar, y: base + 0.5, p: 1.7, oh: 0.15, ax: axr, m: roofTex(L.rm), c: col(L.rc), su: 3, mg: tWC(), cg: wc, gsu: 4, th: lod >= 2 ? 0.15 : 0 });
    B.box('c', r[0] + 0.3, r[1] + 0.3, r[2] - 0.3, r[3] - 0.3, lod >= 2 ? base : 0, base + 0.5, wc);
    if (lod >= 1) { const p = ept(fe, fe.L / 2, 0.3); pbox(B, tEQ(), p[0], p[1], fe.nx, fe.nz, Math.min(2.6, fe.L * 0.45), 0.05, base + 0.5, base + 2.8, cellUV(1, 3), wc); } return top; }
  const nf = ty === 'loft' || big ? 2 : 1, H = base + nf * 2.7;
  if (lod <= 1) B.facade(tFarLo(), F, lod >= 2 ? base : 0, H, { bw: 3.6, fh: 2.9, tb: 2, tf: 2, vy: base, c: wc });
  else lowWalls(B, tLW(), L.up[1], 8, F, base, nf, 2.7, col(L.uc), {});
  const top = ty === 'shed' ? B.roof({ t: 'shed', r: A.rin(r, 0), y: H, p: 0.22, oh: 0.5, hi: (fn[1] > 0 || fn[0] > 0) ? '+' : '-', ax: axr === 'z' ? 'x' : 'z', m: roofTex(L.rm), c: col(L.rc), su: 3, mg: tWC(), cg: wc, gsu: 4, th: lod >= 2 ? 0.12 : 0 })
    : B.roof({ t: 'gable', r: A.rin(r, 0), y: H, p: L.p || 0.6, oh: 0.5, ax: axr, m: roofTex(L.rm), c: col(L.rc), su: 3, mg: tWC(), cg: wc, gsu: 4, th: lod >= 2 ? 0.14 : 0, cf: [0.9, 0.9, 0.88] });
  if (lod >= 2) { const p = ept(fe, fe.L * 0.62, 0.04); pbox(B, tEQ(), p[0], p[1], fe.nx, fe.nz, 0.95, 0.05, base, base + 2.05, cellUV(0, 3), wc); }
  if (lod >= 2) { if (L.stone || ty === 'gable') { const p = [r[0] + w * 0.8, r[1] + d * 0.5]; B.box('c', p[0] - 0.3, p[1] - 0.3, p[0] + 0.3, p[1] + 0.3, H - 0.5, top + 0.7, L.stone ? [0.55, 0.54, 0.52] : [0.3, 0.3, 0.31]); }
    if (ty === 'loft') { B.ledge(fe, base + 2.7 - 0.15, base + 2.7, 1.2, [0.6, 0.47, 0.34], { from: 0.6, to: fe.L - 0.6 }); B.rail(tRail(), fe, base + 2.7, 0.95, 1.2, [0.55, 0.42, 0.3], { from: 0.6, to: fe.L - 0.6, su: 0.8 }); } }
  return top;
}
function cottage(B, L, P) {
  const lod = P.lod, R = P.rng, F = P.F, fn = fnOf(F, P);
  if (P.f <= 0) { plaza(B, P); return; }
  if (lod >= 1) B.cap('c', F, 0.03, [0.45, 0.53, 0.36]);
  // 小屋の数：区画の広さで（1〜5）。1つの小屋は 7×6m（2階なら 8×7）
  const big = P.f >= 2, cw = L.ty === 'dome' ? 6 : big ? 8 : 7, cd = L.ty === 'dome' ? 6 : big ? 7 : 6.2, gu = 2.4, gv = 2.0 + 0.9;   // gv：デッキ＋すきま
  const spots = [];
  for (const r of F.rects) { const fr = frame(r, fn), nu = Math.max(0, Math.floor((fr.W - 0.6) / (cw + gu))), nv = Math.max(0, Math.floor((fr.D - 0.6) / (cd + gv)));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const su = (fr.W - nu * (cw + gu)) / 2 + i * (cw + gu) + gu / 2 + (R() - 0.5) * 0.8, sv = (fr.D - nv * (cd + gv)) / 2 + j * (cd + gv) + 2.1; spots.push(fr.rect(su, sv, su + cw, sv + cd)); } }
  if (!spots.length) { const r = bigR(F), fr = frame(r, fn), w = Math.min(cw, fr.W - 1.2), d = Math.min(cd, fr.D - 2.8); spots.push(fr.rect((fr.W - w) / 2, 2.2, (fr.W + w) / 2, 2.2 + d)); }
  // 小屋の数の上限（lod ごと）。多いときは 区画全体から 等間隔に えらぶ
  const nmax = lod >= 2 ? 4 : lod >= 1 ? 3 : 2, sp = spots.length <= nmax ? spots : Array.from({ length: nmax }, (_, k) => spots[Math.round(k * (spots.length - 1) / Math.max(1, nmax - 1))]);
  for (const r of sp) cabin(B, r, fn, L, P, big);
  if (lod <= 0) return;
  // 小道（砂利）・木・車
  for (const r of sp) { const fr = frame(r, fn); const pr = fr.rect(fr.W * 0.4, -3.5, fr.W * 0.6, 0); if (lod >= 1) B.flat('c', [Math.max(pr[0], F.bb[0]), Math.max(pr[1], F.bb[1]), Math.min(pr[2], F.bb[2]), Math.min(pr[3], F.bb[3])], 0.05, [0.66, 0.63, 0.57]); }
  grounds(B, F, sp.map(r => A.rin(r, -2.6)), P, { max: lod >= 2 ? 7 : 4, per: 6, th: 6, tr: 1.8, tc: [[0.24, 0.38, 0.2], [0.28, 0.42, 0.22], [0.2, 0.33, 0.2]] });
  if (lod >= 2) for (const r of sp) if (R() < 0.6) { const fr = frame(r, fn), p = fr.p(-1.2, -2.2); if (inF(F, p[0], p[1])) B.car(p[0], p[1], Math.abs(fn[1]) > 0.5 ? 0 : PI / 2, A.pick(R, [[0.92, 0.92, 0.9], [0.25, 0.3, 0.32], [0.55, 0.6, 0.5], [0.6, 0.15, 0.12]]), 0.03); }
}
A.arch('b_cottage', { looks: CTL, build: cottage,
  far(L, P) { const wc = L.up ? rowAvg(L.up, L.uc) : col(L.uc); return { H: 3.3, base: 0.6, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc, rt: 'hip', roof: null, rc: L.ty === 'dome' ? col(L.uc) : farRC(L.rm, L.rc), p: 0.28, ins: 3 }; } });

/* 海の家：砂浜の 木の小屋・大きな日よけ・テーブル・パラソル */
const UML = [
  { n: '木の小屋・すだれ', wc: '#a88a66', rc: '#8a7a62', aw: 3 },
  { n: '白い小屋・青い屋根', wc: '#f2f1ec', rc: '#4f79a8', aw: 2 },
  { n: 'トタン屋根・赤い旗', wc: '#c9c3b6', rc: '#9fa3a6', aw: 0, flag: true },
  { n: 'カラフルなテント', wc: '#e9e2d0', rc: '#d98a3a', aw: 7, tent: true },
];
function uminoie(B, L, P) {
  const lod = P.lod, R = P.rng, F = insP(P, 0.3), fn = fnOf(F, P), r0 = bigR(F), fr = frame(r0, fn), wc = col(L.wc);
  B.cap('c', P.F, 0.03, [0.86, 0.8, 0.66]);
  const bd = Math.min(fr.D * 0.5, 7), br = fr.rect(0.5, fr.D - bd, fr.W - 0.5, fr.D - 0.3), Fb = rf(br[0], br[1], br[2], br[3]), fe = A.frontEdge(Fb, fn);
  B.plinth(Fb, P.yb, 0.4, [0.5, 0.42, 0.32]);
  for (const e of Fb.edges) if (e !== fe) lowWalls(B, tLW(), 2, 8, { edges: [e] }, 0.4, 1, 2.8, wc, {});
  frontRow(B, tGFW(), fe, 0.4, 3.2, 3.2, 2, null);
  // 日よけの 屋根（前に 大きく）
  const dr = fr.rect(0.2, Math.max(0.3, fr.D - bd - 6), fr.W - 0.2, fr.D - 0.1);
  if (L.tent) { B.roof({ t: 'gable', r: dr, y: 2.9, p: 0.25, oh: 0.1, m: tAwn(), c: WH, su: 2, th: 0 }); }
  else B.roof({ t: 'shed', r: dr, y: 3.0, p: 0.08, oh: 0.2, hi: (fn[1] > 0 || fn[0] > 0) ? '-' : '+', ax: Math.abs(fn[1]) > 0.5 ? 'x' : 'z', m: tSeam(), c: col(L.rc), su: 3, mg: 'c', cg: mul(wc, 0.9), th: 0.1 });
  if (lod >= 1) for (const u of [0.4, fr.W - 0.4]) for (const v of [Math.max(0.5, fr.D - bd - 5.8)]) { const p = fr.p(u, v); B.box('c', p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, 0, 3.0, [0.5, 0.4, 0.3]); }
  { const aw = AWC[L.aw], def = [aw[0], '#f2f2ee', aw[1]];   // 日よけ（色は 部屋ごとに かえられる）
    if (lod >= 2) { const cs = unitCols(P, def), k = cs.length; for (let i = 0; i < k; i++) awningC(B, fe, 0.3 + (fe.L - 0.6) * i / k, 0.3 + (fe.L - 0.6) * (i + 1) / k, 2.9, 0.9, col(cs[i][0]), col(cs[i][2]), aw[2]); }
    else if (lod >= 1) band(B, P, fe, 2.4, 3.4, { from: 0.3, to: fe.L - 0.3, def, pat: 'awning' }); }
  if (lod < 2) return;
  for (let k = 0; k < Math.min(4, Math.floor(fr.W / 3)); k++) { const p = fr.p(1.5 + k * 3, Math.max(1, fr.D - bd - 3)); B.box('c', p[0] - 0.5, p[1] - 0.4, p[0] + 0.5, p[1] + 0.4, 0.6, 0.66, [0.55, 0.42, 0.3]); B.box('c', p[0] - 0.05, p[1] - 0.05, p[0] + 0.05, p[1] + 0.05, 0, 0.6, [0.4, 0.3, 0.2]); }
  for (let k = 0; k < Math.min(4, Math.floor(fr.W / 4)); k++) { const p = fr.p(2 + k * 4, 1.2); B.box('c', p[0] - 0.03, p[1] - 0.03, p[0] + 0.03, p[1] + 0.03, 0, 2.2, [0.85, 0.85, 0.85]); B.cone('c', p[0], p[1], 1.2, 1.9, 2.4, 6, A.pick(R, [[0.9, 0.3, 0.25], [0.95, 0.85, 0.3], [0.25, 0.5, 0.8], [0.95, 0.95, 0.92]])); }
  if (L.flag) for (let k = 0; k < 3; k++) { const p = fr.p(fr.W - 0.8 - k * 1.3, fr.D - bd - 6.3); nobori(B, p[0], p[1], fn[0], fn[1], col(['#c43b30', '#e8e4da', '#2f5fa0'][k])); }
  { const p = ept(fe, 0.8, 0.5); vend(B, p[0], p[1], fe.nx, fe.nz, P.id % 3, 0.4); }
}
A.arch('b_uminoie', { looks: UML, build: uminoie,
  far(L) { return { H: 3.4, base: 0.4, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: col(L.wc), rt: 'flat', top: null, ct: col(L.rc), ins: 0.5 }; } });

/* ---------- 超高層（低層部＋塔・頭・ヘリのしるし） ---------- */
const SKL = [
  { n: 'ブルーのガラスの塔', tx: 3, pod: 4, crown: 'heli', pc: '#8197aa' },
  { n: '黒いガラスの塔', tx: 9, pod: 9, crown: 'step', pc: '#30343a' },
  { n: '白い縦ルーバーの塔', tx: 6, pod: 1, crown: 'frame', pc: '#e9e8e3' },
  { n: '銀色のアルミの塔', tx: 5, pod: 5, crown: 'slant', pc: '#c6cacd' },
  { n: '石とガラスの塔', tx: 3, pod: 4, crown: 'pyramid', pc: '#a5a39e' },
];
function sky(B, L, P) {
  const ko = P.ko, lod = P.lod, f = Math.max(10, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 1.5), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn), gh = 6.5, pfh = 4.5, fh = 4.0;
  const np = cl(Math.round(f * 0.08), 2, 6), Hp = gh + (np - 1) * pfh, H = Hp + (f - np) * fh, mp = tOF(L.pod), mt = tOF(L.tx), pc = col(L.pc);
  if (lod >= 1 || P.yb < -0.5) B.plinth(F0, P.yb, 0.2, [0.6, 0.59, 0.56]);
  // 低層部（全体か 前の 広場をのこして）
  const fe = A.frontEdge(F0, fn), Fp = fr.D > 40 && F0.rects.length === 1 ? rf(...fr.rect(0, 8, fr.W, fr.D)) : F0, fep = A.frontEdge(Fp, fn);
  if (Fp !== F0) { B.flat(tPave(), fr.rect(0, 0, fr.W, 8), 0.06, [1, 1, 1], { su: 4 }); if (lod >= 1) treeRow(B, fe, 3, fe.L - 3, -3.5, P, Math.min(8, Math.round(fe.L / 9))); }
  const ent = offMass(B, Fp, P, { m: mp, gh, fh: pfh, bw: 3.2, top: Hp, fe: fep });
  para(B, Fp, Hp, 1.1, mul(pc, 1.0), lod, 0.3); roofFlat(B, Fp, Hp + 0.02, 0.95);
  // 塔（ツインは 2 本）
  const twin = ko.twin, TW = Math.min((fr.W - 10) / (twin ? 2.4 : 1), 56), TD = Math.min(fr.D - 14, 52);
  if (TW < 14 || TD < 14) { B.facade(mt, Fp, Hp, H, { bw: 3.2, fh, tb: 4, tf: 4, vy: gh }); offTop(B, Fp, H, OFL[L.tx - 1], P, fn, { heli: true }); return; }
  const us = twin ? [fr.W * 0.27 - TW / 2, fr.W * 0.73 - TW / 2] : [(fr.W - TW) / 2];
  for (const u0 of us) {
    const v0 = Math.max(10, (fr.D - TD) * 0.55), tr = fr.rect(u0, v0, u0 + TW, v0 + TD), Ft = rf(tr[0], tr[1], tr[2], tr[3]);
    let Ht = H, Fc = Ft;
    if (L.crown === 'step' && lod >= 1) { const H1 = H - Math.round((f - np) * 0.18) * fh, H2 = H - Math.round((f - np) * 0.08) * fh; B.facade(mt, Ft, Hp, H1, { bw: 3.2, fh, tb: 4, tf: 4, vy: gh }); para(B, Ft, H1, 1.0, pc, lod, 0.3); roofFlat(B, Ft, H1 + 0.02);
      const F2 = A.inset(Ft, 4); B.facade(mt, F2, H1, H2, { bw: 3.2, fh, tb: 4, tf: 4, vy: gh }); para(B, F2, H2, 1.0, pc, lod, 0.3); roofFlat(B, F2, H2 + 0.02); Fc = A.inset(F2, 4); Ht = H; B.facade(mt, Fc, H2, Ht, { bw: 3.2, fh, tb: 4, tf: 4, vy: gh }); }
    else B.facade(mt, Ft, Hp, Ht, { bw: 3.2, fh, tb: 4, tf: 4, vy: gh });
    if (lod <= 0) { roofFlat(B, Fc, Ht); continue; }
    const rc = bigR(Fc), cx = (rc[0] + rc[2]) / 2, cz = (rc[1] + rc[3]) / 2, cw = rc[2] - rc[0], cd = rc[3] - rc[1];
    if (L.crown === 'pyramid') { para(B, Fc, Ht, 0.8, pc, lod, 0.3); B.roof({ t: 'pyramid', r: A.rin(rc, 0.5), y: Ht + 0.6, p: 0.7, oh: 0, m: tSeam(), c: [0.8, 0.82, 0.84], su: 4, th: 0 }); }
    else if (L.crown === 'slant') { B.roof({ t: 'shed', r: A.rin(rc, 0), y: Ht, p: 0.35, oh: 0, hi: fn[1] < 0 || fn[0] < 0 ? '+' : '-', ax: Math.abs(fn[1]) > 0.5 ? 'x' : 'z', m: tOF(3), c: WH, su: 3.2, mg: mt, gsu: 3.2 * 4, gsv: fh * 4, th: 0 }); }
    else if (L.crown === 'frame') { wallsM(B, tLouv(), Fc, Ht, Ht + 5, mul(pc, 1.02), 2, 2.5); for (const e of Fc.edges) B.wall(tLouv(), e.bx, e.bz, e.ax, e.az, Ht, Ht + 5, mul(pc, 0.8), [0, e.L / 2, 0, 2]); roofFlat(B, Fc, Ht + 0.02); if (cw > 22 && cd > 22) { const Fi = A.inset(Fc, 6); B.ext(tWC(), Fi, Ht, Ht + 4, mul(pc, 0.95), { mt: 'c', ct: [0.6, 0.6, 0.6] }); heli(B, cx, cz, Ht + 4.06, Math.min(cw, cd) * 0.3 - 4, lod >= 2 ? 20 : 10); } }
    else { B.facade(mt, Fc, Ht, Ht + 3, { bw: 3.2, fh, tb: 4, tf: 4, vy: Ht - 4 * fh }); B.parapet(Fc, Ht, 3, 0.25, [0.5, 0.55, 0.6], { noOuter: true }); roofFlat(B, Fc, Ht + 0.02); if (cw > 22 && cd > 22) heli(B, cx, cz, Ht + 0.08, Math.min(cw, cd) * 0.32, lod >= 2 ? 20 : 10); }
    if (lod >= 2) { const e = Fc.edges[0]; for (const t of [e.L * 0.2, e.L * 0.8]) { const p = ept(e, t, -2); B.box('c', p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, Ht, Ht + 8, [0.6, 0.6, 0.62]); } }
  }
  if (ent && lod >= 1) canopy(B, fep, ent[0] - 2, ent[1] + 2, 5.5, 4, [0.55, 0.57, 0.6], lod, true);
}
A.arch('b_sky', { looks: SKL, build: sky,
  far(L, P) { const f = Math.max(10, P.f), np = cl(Math.round(f * 0.08), 2, 6); return { H: 6.5 + (np - 1) * 4.5 + (f - np) * 4.0, base: 0, wall: tOF(L.tx), bw: 3.2, fh: 4.0, tb: 4, tf: 4, rt: 'flat', top: tFlat(), ct: [0.85, 0.86, 0.86], ins: 6 }; } });

/* ---------- 雑居ビル・ペンシルビル ---------- */
// 外壁（色をかける）：窓ごとに テナントの色の板・ブラインド
const tZK = () => T('zk', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256, sc = ['#c9452f', '#e9c04a', '#2f6fa8', '#3f8a5a', '#e8e4da', '#7a3a6a', '#d8734a', '#2f2f33'];
  PT.wallMat(g, 0, 0, w, h, { t: 'tile', c: '#efede8', sc: u, j: '#a9a69e' }, R);
  for (let j = 0; j < 4; j++) { PT.fill(g, 0, j * mh + mh - 3 * u, w, 3 * u, '#d9d6cf');
    for (let i = 0; i < 4; i++) { const X = i * mw, Y = j * mh;
      pwin(g, X + mw * 0.1, Y + mh * 0.2, mw * 0.8, mh * 0.56, R, { u, rev: 0.25, f: '#c4c7c8', dv: 2, bl: 0.4, cur: 0.15, lit: 0.12 });
      const k = R(); if (k < 0.45) { const c = A.pick(R, sc), y0 = Y + mh * (0.24 + 0.2 * R()); g.fillStyle = css(c, 1, 0.92); g.fillRect(X + mw * 0.14, y0, mw * 0.72, mh * 0.14); g.fillStyle = css(A.pick(R, sc), 1, 0.9); g.fillRect(X + mw * 0.18, y0 + mh * 0.03, mw * 0.12, mh * 0.08); }
      if (R() < 0.3) PT.fill(g, X + mw * 0.6, Y + mh * 0.8, mw * 0.25, mh * 0.13, '#e2e2de'); } }
  PT.streaks(g, 0, 0, w, h, 18, 0.06, R); });
const ZKL = [
  { n: 'ベージュのタイル', wc: '#e2d4ba', sg: ['#c9452f', '#e9c04a', '#2f6fa8', '#f1efe8'] },
  { n: '白いタイル・赤い看板', wc: '#f2f1ed', sg: ['#b8443a', '#f2f2ee', '#3a3a3e', '#b8443a'] },
  { n: 'グレーのタイル', wc: '#b5b7b9', sg: ['#e2b53c', '#2f2f33', '#e8e4da', '#3f8a5a'] },
  { n: '茶色のタイル', wc: '#a07e66', sg: ['#e8e4da', '#3f8a5a', '#d8734a', '#2f6fa8'] },
  { n: 'ガラスと白いわく', wc: '#ffffff', glass: true, sg: ['#6a4f8f', '#e9c04a', '#2a9d96', '#f2f2ee'] },
];
function zakkyo(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = Math.max(2, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F = insP(P, 0.25), fn = fnOf(F, P), fe = A.frontEdge(F, fn), gh = 3.9, fh = 3.25, H = gh + (f - 1) * fh, wc = col(L.wc);
  if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.1, [0.6, 0.59, 0.56]);
  const nb = Math.max(1, Math.round(fe.L / 3.2));
  frontRow(B, tGF(), fe, 0, gh, 3.2, 2, lod >= 1 ? 3 : null, 4, nb - 1, 1);
  const side = e => e !== fe && Math.abs(e.nx * fe.nx + e.nz * fe.nz) < 0.5;
  for (const e of F.edges) if (e !== fe) B.wallE(tWT(), e, 0, H, mul(wc, side(e) ? 0.92 : 1), { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, H / 4], ao: 0.86 });
  B.facade(L.glass ? tOF(3) : tZK(), { edges: [fe] }, gh, H, { bw: L.glass ? 3.2 : 2.9, fh, tb: 4, tf: 4, vy: gh, c: L.glass ? WH : wc });
  const back = F.edges.find(e => e.nx * fn[0] + e.nz * fn[1] < -0.5);
  if (back && lod >= 1) B.facade(tZK(), { edges: [back] }, gh, H, { bw: 2.9, fh, tb: 4, tf: 4, vy: gh, c: wc, off: 0.02 });
  if (lod <= 0) { roofFlat(B, F, H); return; }
  para(B, F, H, 1.0, mul(wc, 0.95), lod, 0.2); roofFlat(B, F, H + 0.02);
  // 袖看板の 柱（階ごとに 色の板）・1階の看板
  const sgs = L.sg.map(col), t = fe.L > 6 ? fe.L - 0.7 : fe.L * 0.85;
  ebox(B, fe, t - 0.07, t + 0.07, 0.1, 1.05, gh, H - 0.3, [0.9, 0.9, 0.88]);
  for (let k = 0; k < f - 1; k++) { const y = gh + k * fh + 0.25; ebox(B, fe, t - 0.11, t + 0.11, 0.16, 1.0, y, y + fh - 0.5, sgs[(k + P.id) % sgs.length]); }
  band(B, P, fe, gh - 0.8, gh - 0.1, { from: 0.2, to: fe.L - 0.2, def: [L.sg[P.id % 4], L.sg[(P.id + 1) % 4], L.sg[(P.id + 2) % 4]], pat: 'solid', th: 0.16, bc: [0.85, 0.85, 0.83] });
  // 屋上：水槽（足つき）・看板のわく
  const r = bigR(F), cx = r[0] + (r[2] - r[0]) * 0.65, cz = r[1] + (r[3] - r[1]) * 0.6;
  if (r[2] - r[0] > 4 && r[3] - r[1] > 4) { for (const [dx, dz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) B.box('c', cx + dx - 0.06, cz + dz - 0.06, cx + dx + 0.06, cz + dz + 0.06, H, H + 1.6, [0.45, 0.45, 0.45]); B.box(tLouv(), cx - 1.2, cz - 1.0, cx + 1.2, cz + 1.0, H + 1.6, H + 3.2, [0.82, 0.86, 0.84], { su: 1.5, sv: 1.6, mt: 'c', ct: [0.75, 0.78, 0.77] }); }
  if (lod < 2) return;
  for (const e of F.edges) if (side(e)) for (let k = 1; k < f; k++) if (R() < 0.6) { const p = ept(e, 0.8 + R() * Math.max(0.1, e.L - 1.6), 0.18); acu(B, p[0], p[1], e.nx, e.nz, gh + (k - 1) * fh + 0.3); }
  const se = F.edges.find(side); if (se && se.L > 6 && f >= 3) { const t0 = se.L - 3.2; const e2 = esub(se, t0, t0 + 2.6, 0); for (let k = 1; k < f; k++) { const y = gh + (k - 1) * fh; B.ledge(e2, y - 0.12, y, 1.2, [0.42, 0.43, 0.44]); B.rail(tRail(), e2, y, 1.1, 1.2, [0.45, 0.46, 0.47], { su: 0.8 }); } }
  void ko;
}
A.arch('b_zakkyo', { looks: ZKL, build: zakkyo,
  far(L, P) { const f = Math.max(2, P.f); return { H: 3.9 + (f - 1) * 3.25 + 1, base: 0, wall: L.glass ? tOF(3) : tZK(), bw: 2.9, fh: 3.25, tb: 4, tf: 4, wc: L.glass ? WH : col(L.wc), rt: 'flat', top: tFlat(), ct: [0.88, 0.88, 0.86], ins: 0.3 }; } });

/* ---------- 百貨店・駅ビル・ファッションビル・複合商業ビル ---------- */
// 外壁（色をかける）：石のパネル・たての細い窓は 4 柱間に 1 つ
const tDP = () => T('dp', 256, 256, (g, w, h, R) => { const mw = w / 4, mh = h / 4, u = w / 256;
  PT.wallMat(g, 0, 0, w, h, { t: 'stucco', c: '#eeebe4', n: 0.03 }, R);
  g.fillStyle = 'rgba(0,0,0,.12)'; for (let j = 0; j < 8; j++) g.fillRect(0, j * mh / 2, w, u); for (let i = 0; i < 8; i++) g.fillRect(i * mw / 2, 0, u, h);
  for (let j = 0; j < 4; j++) { PT.fill(g, 0, j * mh + mh - 4 * u, w, 4 * u, '#d8d3c8'); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, j * mh + mh, w, u); }
  for (let j = 0; j < 4; j++) pwin(g, 2 * mw + mw * 0.35, j * mh + mh * 0.12, mw * 0.3, mh * 0.72, R, { u, rev: 0.4, f: '#9a9890', dv: 1, bl: 0.3, lit: 0.2 });
  PT.streaks(g, 0, 0, w, h, 14, 0.05, R); });
const DPL = [
  { n: '石張り・大きな看板', tx: 'dp', wc: '#e3d8c4', sg: '#7a2c32' },
  { n: '白いパネル・ガラスの角', tx: 'dp', wc: '#f2f2ef', sg: '#2f4a6e', corner: true },
  { n: '茶色のタイル', tx: 'dp', wc: '#ab8a70', sg: '#efe7d6' },
  { n: 'ガラス張り・色の看板', tx: 'of3', wc: '#ffffff', sg: '#e9c04a', panels: true },
  { n: '黒いガラス・光る帯', tx: 'of9', wc: '#ffffff', sg: '#e8e4da', bands: true },
];
function depart(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = Math.max(2, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 0.6), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn), fe = A.frontEdge(F0, fn), wc = col(L.wc), sg = col(L.sg);
  const mx = ko.mix, gh = 5.5, fh = mx ? 4.2 : 4.6, nP = mx ? Math.min(3, f) : f, Hp = gh + (nP - 1) * fh, m = L.tx === 'dp' ? tDP() : tOF(L.tx === 'of3' ? 3 : 9);
  if (lod >= 1 || P.yb < -0.5) B.plinth(F0, P.yb, 0.15, [0.6, 0.59, 0.56]);
  // 1階：通りがわは ショーウィンドウ・入口
  for (const e of F0.edges) { if (!e.out) continue; const st = e.nx * fn[0] + e.nz * fn[1] > -0.5; if (st) frontRow(B, e === fe ? tGF2() : tGF(), e, 0, gh, 3.6, e === fe ? 3 : 2, e === fe && lod >= 1 ? 1 : null, 4, null, 2); else B.wallE(tWT(), e, 0, gh, mul(wc, 0.9), { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, gh / 4], ao: 0.86 }); }
  for (const e of F0.edges) if (!e.out) B.wallE(tWT(), e, 0, gh, mul(wc, 0.9), { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, gh / 4] });
  B.facade(m, F0, gh, Hp, { bw: 3.6, fh, tb: 4, tf: 4, vy: gh, c: wc });
  if (L.corner && lod >= 1) { const e = fe; B.facade(tOF(3), { edges: [esub(e, 0, Math.min(10, e.L * 0.3), 0.05)] }, gh, Hp, { bw: 3.2, fh: 4, tb: 4, tf: 4, vy: gh }); }
  if (lod <= 0) { roofFlat(B, F0, Hp); if (mx) { const tr = fr.rect(fr.W * 0.15, fr.D * 0.3, fr.W * 0.85, fr.D * 0.3 + Math.min(16, fr.D * 0.6)); const Ft = rf(tr[0], tr[1], tr[2], tr[3]); B.facade(tHT3(), Ft, Hp, Hp + (f - nP) * 3.0, { bw: 3.8, fh: 3.0, tb: 4, tf: 4, vy: Hp, c: [0.95, 0.94, 0.9] }); roofFlat(B, Ft, Hp + (f - nP) * 3.0); } return; }
  para(B, F0, Hp, 1.2, mul(wc, 0.95), lod, 0.3); roofFlat(B, F0, Hp + 0.02);
  // 看板：かどの たて看板・正面の上
  band(B, P, fe, gh - 1.25, gh - 0.55, { from: 0.6, to: fe.L - 0.6, def: [L.sg, '#f2f2ee', L.sg], pat: 'solid', th: 0.15, bc: mul(L.wc, 0.9) });
  for (const t of [1.2, fe.L - 1.2]) sode(B, fe, t, gh + 1, Hp - 1, sg, null);
  signBox(B, fe, fe.L * 0.3, fe.L * 0.7, Hp - 3.2, Hp - 0.6, 0.06, 0.3, sg);
  if (L.panels) for (let k = 0; k < 2; k++) { const t0 = fe.L * (0.15 + k * 0.45), y0 = gh + 2 + k * fh * 2; if (y0 + 6 < Hp) signBox(B, fe, t0, t0 + Math.min(12, fe.L * 0.3), y0, y0 + 6, 0.06, 0.2, col(A.pick(R, ['#e9c04a', '#d8734a', '#2a9d96', '#e8e4da', '#6a4f8f']))); }
  if (L.bands) for (let k = 1; k < nP; k += 2) for (const e of F0.edges) if (e.out) ebox(B, e, 0, e.L, 0, 0.1, gh + k * fh - 0.25, gh + k * fh, [0.96, 0.94, 0.86]);
  // 駅ビル：前に 歩道橋のような デッキ（屋根）
  if (ko.deck && fr.D > 20) { canopy(B, fe, 2, fe.L - 2, 7.5, 9, [0.75, 0.76, 0.77], lod, true); }
  else { const mid = fe.L / 2; canopy(B, fe, mid - 4, mid + 4, 4.2, 2.5, mul(sg, 0.9), lod, false); }
  // 上：複合ビルは 住まいの塔・ほかは 屋上庭園
  if (mx && f > nP) { const tr = fr.rect(fr.W * 0.15, fr.D * 0.3, fr.W * 0.85, fr.D * 0.3 + Math.min(16, fr.D * 0.6)); const Ft = rf(tr[0], tr[1], tr[2], tr[3]), Ht = Hp + (f - nP) * 3.0; B.facade(tHT3(), Ft, Hp, Ht, { bw: 3.8, fh: 3.0, tb: 4, tf: 4, vy: Hp, c: [0.95, 0.94, 0.9] }); para(B, Ft, Ht, 1.1, [0.9, 0.89, 0.86], lod, 0.25); roofFlat(B, Ft, Ht + 0.02); roofKit(B, tr, Ht, P, { fn, tank: false }); }
  else { const rr = A.rin(r0, 4); if (rr[2] - rr[0] > 10 && rr[3] - rr[1] > 10) { const fr2 = frame(rr, fn), g0 = fr2.rect(0, 0, fr2.W * 0.55, fr2.D * 0.6); B.flat('c', g0, Hp + 0.06, [0.4, 0.5, 0.33]); if (lod >= 2) for (let k = 0; k < 5; k++) { const p = fr2.p(fr2.W * 0.55 * R(), fr2.D * 0.6 * R()); B.tree(p[0], p[1], Hp, 3 + R() * 2, 1.2); } roofKit(B, fr2.rect(fr2.W * 0.6, 0, fr2.W, fr2.D), Hp, P, { fn, tank: false }); } }
}
A.arch('b_depart', { looks: DPL, build: depart,
  far(L, P) { const f = Math.max(2, P.f), mx = P.ko.mix, nP = mx ? Math.min(3, f) : f, fh = mx ? 4.2 : 4.6; return { H: 5.5 + (nP - 1) * fh + 1.2, base: 0, wall: L.tx === 'dp' ? tDP() : tOF(L.tx === 'of3' ? 3 : 9), bw: 3.6, fh, tb: 4, tf: 4, wc: col(L.wc), rt: 'flat', top: tFlat(), ct: [0.88, 0.88, 0.86], ins: 0.6 }; } });

/* ---------- ショッピングセンター・アウトレット・道の駅 ---------- */
const MLL = [
  { n: '白い壁・ガラスの入口', wc: '#f0f0ec', sg: '#2f6f6a', rc: '#c9ccce' },
  { n: 'ベージュ・赤茶の屋根', wc: '#e5d8bf', sg: '#7a3a2e', rc: '#9a5a44', acc: true },
  { n: 'グレー・青緑の帯', wc: '#c9cbcc', sg: '#257d78', rc: '#a9adb0' },
  { n: '木の壁・大きな屋根', wc: '#b08a62', sg: '#4b3527', rc: '#6a5040', wood: true, acc: true },
  { n: 'レンガ調・時計塔', wc: '#ad6a50', sg: '#efe7d6', rc: '#5a5d61', tower: true, acc: true },
];
// 大きな箱（ショッピングセンター）
function mallBox(B, Fb, fn, H, L, P, o = {}) {
  const lod = P.lod, wc = col(L.wc), sg = col(L.sg), fe = A.frontEdge(Fb, fn), wm = L.wood ? tLW() : tWP();
  for (const e of Fb.edges) { if (L.wood) lowWalls(B, wm, 2, 8, { edges: [e] }, 0, Math.max(1, Math.round(H / 2.9)), H / Math.max(1, Math.round(H / 2.9)), wc, {}); else B.wallE(wm, e, 0, H, wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, H / 4], ao: 0.86 }); }
  B.cap(tSeam(), Fb, H, mul(L.rc, 1.0), { su: 4 });
  if (lod >= 1) para(B, Fb, H, 1.0, mul(wc, 0.95), lod, 0.25);
  // 入口（ガラスの吹き抜け。正面と 横）
  const ents = lod <= 0 ? [] : [fe, ...Fb.edges.filter(e => e !== fe && e.out && e.L > 40)].slice(0, 3);
  for (const e of ents) { const t = e.L / 2, w = Math.min(18, e.L * 0.35), a = ept(e, t - w / 2, 0), b = ept(e, t + w / 2, 4), r = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], Fe = rf(r[0], r[1], r[2], r[3]), ee = A.frontEdge(Fe, [Math.round(e.nx), Math.round(e.nz)]);
    for (const q of Fe.edges) if (q !== ee) B.facade(tOF(3), { edges: [q] }, 0, H + 2, { bw: 3.2, fh: 4, tb: 4, tf: 4, vy: 0 });
    frontRow(B, tGF2(), ee, 0, 4.2, 3.2, 0, 1, 4, null, 2); B.facade(tOF(3), { edges: [ee] }, 4.2, H + 2, { bw: 3.2, fh: 4, tb: 4, tf: 4, vy: 0.2 });
    if (L.acc && lod >= 1) B.roof({ t: 'gable', r, y: H + 2, p: 0.45, oh: 0.4, ax: Math.abs(e.nz) > 0.5 ? 'z' : 'x', m: tSeam(), c: col(L.rc), su: 4, mg: tOF(3), gsu: 12.8, gsv: 16, th: 0.2 }); else B.cap('c', Fe, H + 2, [0.75, 0.76, 0.78]);
    if (lod >= 1) { signBox(B, ee, 1, ee.L - 1, H + 2.3, H + 4.2, -0.3, 0.3, mul(L.wc, 0.92)); A.shopBand(B, P, ee, H + 2.4, H + 4.1, { from: 1.1, to: ee.L - 1.1, def: [L.sg, '#f2f2ee', L.sg], pat: 'solid', off: 0.06 }); } }
  if (L.tower && lod >= 1) { const t = fe.L * 0.8, p = ept(fe, t, -3); B.box(tWT(), p[0] - 2.2, p[1] - 2.2, p[0] + 2.2, p[1] + 2.2, 0, H + 12, wc, { su: 4, sv: 4, mt: 'c', ct: mul(wc, 0.9) }); B.roof({ t: 'pyramid', r: [p[0] - 2.6, p[1] - 2.6, p[0] + 2.6, p[1] + 2.6], y: H + 12, p: 1.0, oh: 0, m: tSlate(), c: col(L.rc), su: 3 });
    const fx = Math.round(fe.nx), fz = Math.round(fe.nz); for (let i = 0; i < 12; i++) { const a0 = i / 12 * PI * 2, a1 = (i + 1) / 12 * PI * 2, rr = 1.5, yc = H + 9.5, q = [p[0] + fx * 2.25, p[1] + fz * 2.25], tx = -fz, tz = fx; B.tri('c', [q[0], yc, q[1]], [q[0] + tx * Math.cos(a0) * rr, yc + Math.sin(a0) * rr, q[1] + tz * Math.cos(a0) * rr], [q[0] + tx * Math.cos(a1) * rr, yc + Math.sin(a1) * rr, q[1] + tz * Math.cos(a1) * rr], [fx, 0, fz], [0.95, 0.94, 0.9]); } }
  if (lod >= 2) { const r = bigR(Fb), n = Math.min(16, Math.round(Math.sqrt(Fb.area) / 6)); for (let k = 0; k < n; k++) { const x = r[0] + 3 + (r[2] - r[0] - 6) * P.rng(), z = r[1] + 3 + (r[3] - r[1] - 6) * P.rng(); acu(B, x, z, fn[0], fn[1], H + 0.05, 1.4); } }
}
function mall(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = cl(P.f, 1, 4);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 1.0), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn);
  if (ko.outlet) { outlet(B, L, P, F0, fn, fr); return; }
  if (ko.eki) { michi(B, L, P, F0, fn, fr); return; }
  const gh = 6.5, H = gh + (f - 1) * 5;
  // 穴（中庭）のある形は そのまま。ほかは 奥に 箱・前は 駐車場
  const holed = F0.loops.length > 1;
  let Fb = F0;
  if (!holed && fr.D > 50) { const br = fr.rect(Math.min(10, fr.W * 0.08), fr.D * 0.38, fr.W - Math.min(10, fr.W * 0.08), fr.D - 4); Fb = rf(br[0], br[1], br[2], br[3]); parking(B, fr.rect(0, 0, fr.W, fr.D * 0.38 - 2), fn, P, { cars: 18 }); for (const q of rest(F0, br, 6)) if (!(q[3] - q[1] < 5 || q[2] - q[0] < 5)) parking(B, q, fn, P, { cars: 6 }); }
  if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.2, [0.6, 0.59, 0.56]);
  mallBox(B, Fb, fn, H, L, P);
  if (holed && lod >= 1) { for (const l of F0.loops.slice(1)) { const xs = l.map(p => p[0]), zs = l.map(p => p[1]); B.flat(tPave(), [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], 0.06, [1, 1, 1], { su: 4 }); } }
  // 立体駐車場（2 階より上）
  if (f >= 2 && lod >= 1 && !holed && fr.W > 60) { const pr = fr.rect(fr.W - 30, fr.D * 0.45, fr.W - 4, fr.D * 0.45 + Math.min(40, fr.D * 0.5)); const nlev = f; for (let k = 1; k <= nlev; k++) { const y = k * 3.2; B.box('c', pr[0], pr[1], pr[2], pr[3], y - 0.35, y, [0.72, 0.72, 0.7]); } for (const [x, z] of [[pr[0] + 1, pr[1] + 1], [pr[2] - 1, pr[1] + 1], [pr[0] + 1, pr[3] - 1], [pr[2] - 1, pr[3] - 1]]) B.box('c', x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0, nlev * 3.2, [0.7, 0.7, 0.68]); }
  void R;
}
// アウトレット：中の 歩く道ぞいに 小さな お店の棟（切妻）・まわりは 駐車場
// アウトレットの 見た目：cols（棟の壁）・rcs（屋根の色）・rm（屋根）・wm（壁の材料）
const OTL = [
  { n: '南欧風・オレンジの瓦', cols: ['#f1e7d3', '#efdcc4', '#f4eee2', '#e9d6bd', '#f2e4cf'], rcs: ['#ffffff', '#f0e6dc', '#ffffff', '#e8ddd2', '#ffffff'], rm: 'yoga' },
  { n: '白い板張り・グレーの屋根', cols: ['#f3f3f0', '#e9eef0', '#f1efe9', '#e6ebe8', '#f4f2ee'], rcs: ['#5d6a72', '#6a6f76', '#4f5459', '#626a70', '#575c61'], rm: 'slate', wm: 'wd' },
  { n: '木の壁・緑の金属屋根', cols: ['#c49a6c', '#b88d62', '#cfa77a', '#a98058', '#c09468'], rcs: ['#5f7a64', '#4f6b55', '#6a866e', '#587460', '#5f7a64'], rm: 'seam', wm: 'wd' },
  { n: 'レンガ色・こげ茶の屋根', cols: ['#b27a62', '#a86d56', '#bd8670', '#9e6650', '#b4806a'], rcs: ['#5a4334', '#4f3a2d', '#634a3a', '#5a4334', '#4a372b'], rm: 'slate', wm: 'wt' },
  { n: '色とりどりの壁', cols: ['#efe6d2', '#d9e4ea', '#efd9d2', '#dfe8d6', '#f2e8c4'], rcs: ['#7a5a48', '#5d6a72', '#8a4a3a', '#6a6f76', '#5f7a64'], rm: 'slate' },
];
function outlet(B, L, P, F0, fn, fr) {
  const lod = P.lod, R = P.rng, wc = col(L.cols[0]), rmO = roofTex(L.rm), wmO = WMT[L.wm || 'wc']();
  const sw = 10, bd = 13, cols = L.cols, rcs = L.rcs;
  const Dz = Math.min(fr.D - 20, 120), v0 = (fr.D - Dz) / 2, W = fr.W - 20, u0 = 10;
  parking(B, fr.rect(0, 0, fr.W, v0 - 1), fn, P, { cars: 14 }); if (fr.D - v0 - Dz > 10) parking(B, fr.rect(0, v0 + Dz + 1, fr.W, fr.D), fn, P, { cars: 6 });
  const rows = cl(Math.floor(Dz / (2 * bd + sw + 6)), 1, 2);
  for (let k = 0; k < rows; k++) {
    const vs = v0 + k * (2 * bd + sw + 6) + bd, st = fr.rect(u0, vs, u0 + W, vs + sw); B.flat(lod >= 1 ? tPave() : 'c', st, 0.07, lod >= 1 ? [1, 0.98, 0.95] : [0.75, 0.73, 0.7], { su: 4 });
    if (lod <= 1) { for (const side of [0, 1]) { const vv = side ? vs + sw : vs - bd, br = fr.rect(u0, vv, u0 + W, vv + bd), Fb = rf(br[0], br[1], br[2], br[3]); B.facade(tFarLo(), Fb, 0, 4.6, { bw: 3.6, fh: 2.9, tb: 2, tf: 2, vy: 0.4, c: col(cols[(P.id + k + side) % 5]) }); B.roof({ t: 'gable', r: br, y: 4.6, p: 0.3, oh: 0.3, ax: Math.abs(fn[1]) > 0.5 ? 'x' : 'z', m: rmO, c: col(rcs[(P.id + side) % 5]), su: 3, th: 0, cg: [0.85, 0.82, 0.78] }); if (lod === 1) frontRow(B, tGF(), A.frontEdge(Fb, side ? [-fn[0], -fn[1]] : fn), 0, 3.8, 3.2, 2, null); } continue; }
    for (const side of [0, 1]) { let u = u0;
      while (u < u0 + W - 10) { const bw2 = Math.min(u0 + W - u, Math.max(14 + R() * 10, W / 8)), vv = side ? vs + sw : vs - bd, br = fr.rect(u, vv, u + bw2 - 1.5, vv + bd), Fb = rf(br[0], br[1], br[2], br[3]), fe = A.frontEdge(Fb, side ? [-fn[0], -fn[1]] : fn);
        const ci = (P.id + Math.round(u)) % 5, c = col(cols[ci]);
        frontRow(B, tGF(), fe, 0, 4.2, 3.2, 2, null); for (const e of Fb.edges) if (e !== fe) B.wallE(wmO, e, 0, 4.2, c, { uv: [0, e.L / 4, 0, 1] }); B.wallE(wmO, fe, 4.2, 5.4, c, { uv: [0, fe.L / 4, 0, 0.3] });
        B.roof({ t: 'gable', r: br, y: 5.4, p: 0.5, oh: 0.5, m: rmO, c: col(rcs[ci]), su: 3, mg: wmO, cg: c, gsu: 4, th: lod >= 2 ? 0.15 : 0 });
        if (lod >= 2) { const aw = AWC[(ci * 3 + side) % 8], ucs = unitCols(P, [aw[0], '#f2f2ee', aw[1]]), uc = P.sc && P.sc.length ? ucs[(P.ui = (P.ui || 0) + 1) % ucs.length] : ucs[0]; awningC(B, fe, 0.4, fe.L - 0.4, 3.1, 1.2, col(uc[0]), col(uc[2]), aw[2]); }
        u += bw2; }
    }
    if (lod >= 2) treeRow(B, frame(st, fn).edge(0, frame(st, fn).W, 0), 2, W - 2, -sw / 2, P, Math.min(10, Math.round(W / 14)));
  }
  void wc;
}
// 道の駅：大きな 屋根の 木の建物・トイレ・広い駐車場
const MCL = [
  { n: '木の壁・いぶし瓦', wc: '#c8a27a', wm: 'wd', rm: 'kawara', rc: '#ffffff' },
  { n: '木の壁・赤茶の屋根', wc: '#b48a62', wm: 'wd', rm: 'seam', rc: '#9a5a44' },
  { n: '白い壁・銀の屋根', wc: '#f0efea', wm: 'wc', rm: 'seam', rc: '#d6d9db' },
  { n: 'こげ茶の板・緑の屋根', wc: '#7a5a42', wm: 'wd', rm: 'seam', rc: '#5f7f5e' },
];
function michi(B, L, P, F0, fn, fr) {
  const lod = P.lod, wc = col(L.wc), wmM = WMT[L.wm]();
  const bw2 = Math.min(fr.W - 8, 60), bd = Math.min(fr.D * 0.35, 18), u0 = (fr.W - bw2) / 2, br = fr.rect(u0, fr.D - bd - 3, u0 + bw2, fr.D - 3), Fb = rf(br[0], br[1], br[2], br[3]), fe = A.frontEdge(Fb, fn);
  B.plinth(Fb, P.yb, 0.3, [0.6, 0.59, 0.56]);
  frontRow(B, tGFW(), fe, 0.3, 4.0, 3.6, 3, null); for (const e of Fb.edges) if (e !== fe) B.wallE(wmM, e, 0, 4.0, wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, 1], ao: 0.86 });
  B.roof({ t: 'gable', r: A.rin(br, -0.2), y: 4.0, p: 0.5, oh: 1.6, m: roofTex(L.rm), c: col(L.rc), su: 3, mg: wmM, cg: wc, gsu: 4, th: lod >= 2 ? 0.3 : 0 });
  parking(B, fr.rect(0, 0, fr.W, fr.D - bd - 6), fn, P, { cars: 16 });
  if (lod >= 1) { const tr = fr.rect(u0 + bw2 + 2, fr.D - 12, Math.min(fr.W - 1, u0 + bw2 + 10), fr.D - 4); if (tr[2] - tr[0] > 4) { const Ft = rf(tr[0], tr[1], tr[2], tr[3]); B.ext(tWT(), Ft, 0, 3.2, mul(wc, 0.95), { mt: 'c', ct: [0.6, 0.6, 0.6] }); } }
  if (lod >= 1) { const p = fr.p(fr.W - 2, 2); poleSign(B, p[0], p[1], fn[0], fn[1], 7, 3, 2.2, [0.45, 0.33, 0.24], [0.9, 0.86, 0.76], null); }
  void wc;
}
A.arch('b_mall', { looks: MLL, build: mall,
  far(L, P) { const f = cl(P.f, 1, 4), k = P.ko; if (k.outlet) return { H: 5.4, base: 0, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: col(L.cols[0]), rt: 'flat', top: null, ct: farRC(L.rm, L.rcs[0]), ins: 12 };
    if (k.eki) return { H: 4.5, base: 0, wall: WMT[L.wm](), bw: 4, fh: 4, tb: 1, tf: 1, wc: col(L.wc), rt: 'flat', top: null, ct: farRC(L.rm, L.rc), ins: 12 };
    return { H: 6.5 + (f - 1) * 5 + 1, base: 0, wall: L.wood ? tFarLo() : tWP(), bw: 4, fh: 4, tb: L.wood ? 2 : 1, tf: L.wood ? 2 : 1, wc: col(L.wc), rt: 'flat', top: tSeam(), ct: col(L.rc), ins: 8 }; } });

/* ---------- 商店街（アーケード）・市場・屋台村 ---------- */
const tAR = () => T('ar', 128, 128, (g, w, h) => { PT.fill(g, 0, 0, w, h, '#eef1f2'); for (let i = 0; i < 4; i++) { PT.fill(g, i * w / 4, 0, Math.max(1, w / 64), h, '#9aa2a6'); } for (let j = 0; j < 2; j++) PT.fill(g, 0, j * h / 2, w, Math.max(1, h / 64), '#9aa2a6'); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(0, 0, w / 2, h); }, { tr: true, op: 0.6 });
const ARL = [
  { n: '半透明の屋根・赤い柱', fc: '#9a3a32', up: ['lw2', 0] },
  { n: '白い屋根・銀の骨組み', fc: '#c9ccce', up: ['lw2', 4] },
  { n: '古い木造・瓦の店', fc: '#5a4a3a', up: ['lw', 6], old: true },
  { n: '色とりどりの店先', fc: '#2f5a8a', up: ['lw', 1], colorful: true },
];
function arcade(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng;
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 0.3), r0 = bigR(F0), alongX = r0[2] - r0[0] >= r0[3] - r0[1], fn = alongX ? [0, 1] : [1, 0], fr = frame(r0, fn);
  if (ko.ichiba) { ichiba(B, L, P, F0, r0, fr, fn); return; }
  if (ko.yatai) { yatai(B, L, P, F0, r0, fr, fn); return; }
  // 長いほうに 道（はば 6m）。両がわに 2 階の お店
  const sw = 6, bd = Math.max(5, (fr.D - sw) / 2), vs = (fr.D - sw) / 2, fc = col(L.fc), f = cl(P.f, 1, 2) + 1;
  B.flat(lod >= 1 ? tPave() : 'c', fr.rect(0, vs, fr.W, vs + sw), 0.06, lod >= 1 ? [0.95, 0.93, 0.9] : [0.7, 0.68, 0.65], { su: 4 });
  if (lod <= 0 || (lod === 1 && fr.W > 60)) { const Hs = 3.6 + (f - 1) * 2.9; for (const side of [0, 1]) { const br = side ? fr.rect(0, vs + sw, fr.W, fr.D) : fr.rect(0, 0, fr.W, vs), Fb = rf(br[0], br[1], br[2], br[3]), fe = A.frontEdge(Fb, side ? [-fn[0], -fn[1]] : fn); B.facade(tFarLo(), Fb, 0, Hs, { bw: 3.6, fh: 2.9, tb: 2, tf: 2, vy: 0.7, c: [0.86, 0.84, 0.8] }); B.cap('c', Fb, Hs, [0.55, 0.55, 0.54]); if (lod === 1) { frontRow(B, tGF2(), fe, 0, 3.6, 3.2, 0, null); B.wallE('c', fe, 2.9, 3.5, col(L.fc), { off: 0.1 }); } }
    B.roof({ t: 'barrel', r: fr.rect(0, vs - 0.3, fr.W, vs + sw + 0.3), y: Hs + 1.2, p: 0.3, oh: 0, n: 3, ax: alongX ? 'x' : 'z', m: tAR(), c: WH, su: 4, mg: 'c', cg: fc, th: 0 }); return; }
  for (const side of [0, 1]) {
    let u = 0; const vv = side ? vs + sw : vs - bd;
    while (u < fr.W - 2) { const w2 = Math.min(fr.W - u, 6 + R() * 5), br = fr.rect(u + 0.15, side ? vv : Math.max(0, vv), u + w2 - 0.15, side ? Math.min(fr.D, vv + bd) : vs), Fb = rf(br[0], br[1], br[2], br[3]), fe = A.frontEdge(Fb, side ? [-fn[0], -fn[1]] : fn);
      const up = L.colorful ? ['lw', [0, 1, 4, 2][Math.floor(R() * 4)]] : L.up, uc = L.colorful ? col(A.pick(R, ['#f1ece1', '#dfe7ea', '#efe0d2', '#e6e8dc'])) : WH, nf = f - 1;
      const ft = A.pick(R, L.old ? ['wood', 'wa', 'open', 'shut'] : ['glass', 'bright', 'open', 'shut', 'glass']), [fm, r1, r2] = FRONT[ft]();
      frontRow(B, fm, fe, 0, 3.6, 3.2, r1, lod >= 2 ? r2 : null, 4, null, 1);
      for (const e of Fb.edges) if (e !== fe) B.wallE(tWT(), e, 0, 3.6 + nf * 2.9, [0.85, 0.84, 0.8], { uv: [0, e.L / 4, 0, 1] });
      lowWalls(B, lwTex(up[0]), up[1], 8, { edges: [fe] }, 3.6, nf, 2.9, uc, {});
      const H = 3.6 + nf * 2.9; if (L.old) B.roof({ t: 'gable', r: br, y: H, p: 0.45, oh: 0.4, ax: alongX ? 'x' : 'z', m: tKawara(), c: [0.95, 0.95, 0.95], su: 3, mg: tWC(), cg: [0.85, 0.82, 0.76], gsu: 4, th: lod >= 1 ? 0.12 : 0 }); else { B.cap('c', Fb, H, [0.6, 0.6, 0.58]); if (lod >= 1) B.wallE(tWC(), fe, H, H + 0.8, uc, { uv: [0, fe.L / 4, 0, 0.2] }); }
      { const c0 = A.pick(R, ['#c9452f', '#e9c04a', '#2f6fa8', '#3f8a5a', '#e8e4da', '#7a3a6a', '#d8734a']), ui = (P.ui = (P.ui || 0) + 1) - 1, sub = { sc: P.sc && P.sc.length ? [P.sc[ui % P.sc.length]] : null, lod };
        band(B, P, fe, 2.9, 3.5, { from: 0.2, to: fe.L - 0.2, def: [c0, '#f2f2ee', c0], pat: 'solid', th: 0.12, bc: [0.85, 0.85, 0.83], sub }); }
      u += w2; }
  }
  // アーケードの屋根（半透明のかまぼこ）と 柱
  const ar = fr.rect(0, vs - 0.3, fr.W, vs + sw + 0.3), yA = 3.6 + (f - 1) * 2.9 + 1.2;
  B.roof({ t: 'barrel', r: ar, y: yA, p: 0.3, oh: 0, n: lod >= 2 ? 10 : 5, ax: alongX ? 'x' : 'z', m: tAR(), c: WH, su: 4, mg: 'c', cg: fc, th: 0 });
  if (lod >= 2) { const n = Math.max(2, Math.round(fr.W / 6)); for (let k = 0; k <= n; k++) { const u = fr.W * k / n; for (const v of [vs + 0.2, vs + sw - 0.2]) { const p = fr.p(cl(u, 0.2, fr.W - 0.2), v); B.box('c', p[0] - 0.12, p[1] - 0.12, p[0] + 0.12, p[1] + 0.12, 0, yA, fc); } const a = fr.p(cl(u, 0.2, fr.W - 0.2), vs), b = fr.p(cl(u, 0.2, fr.W - 0.2), vs + sw); B.box('c', Math.min(a[0], b[0]) - 0.1, Math.min(a[1], b[1]) - 0.1, Math.max(a[0], b[0]) + 0.1, Math.max(a[1], b[1]) + 0.1, yA - 0.25, yA, fc); }
    for (const u of [0.3, fr.W - 0.3]) { const a = fr.p(u, vs - 0.3), b = fr.p(u, vs + sw + 0.3); B.box('c', Math.min(a[0], b[0]) - 0.15, Math.min(a[1], b[1]) - 0.15, Math.max(a[0], b[0]) + 0.15, Math.max(a[1], b[1]) + 0.15, yA + 0.2, yA + 1.6, fc); } }
}
const ICL = [
  { n: '銀の屋根・赤い柱', fc: '#9a3a32', rc: '#d9dcdd' },
  { n: '銀の屋根・白い柱', fc: '#e9e9e6', rc: '#cfd2d3' },
  { n: '青い屋根・グレーの柱', fc: '#7d8286', rc: '#6f8fb0' },
  { n: '緑の屋根・こげ茶の柱', fc: '#4a3a2c', rc: '#6f9a80' },
];
const YTL = [
  { n: '赤と白の日よけ', ar: [0, 5, 0, 7], pv: '#d9d6cf' },
  { n: '緑と紺の日よけ', ar: [1, 2, 4, 1], pv: '#cfcac0' },
  { n: '茶色の日よけ・木の床', ar: [3, 6, 3, 5], pv: '#b89c78' },
  { n: '色とりどりの日よけ', ar: [0, 1, 2, 3, 4, 5, 6, 7], pv: '#d6d3cc' },
];
// 市場：大きな 切妻の屋根（柱だけ）・中に 店の台
function ichiba(B, L, P, F0, r0, fr, fn) {
  const lod = P.lod, R = P.rng, fc = col(L.fc), H = 6.5;
  B.cap('c', F0, 0.05, [0.62, 0.62, 0.6]);
  const rr = A.rin(r0, 0.5); B.roof({ t: 'gable', r: rr, y: H, p: 0.3, oh: 1.0, m: tSeam(), c: col(L.rc), su: 4, mg: tWP(), cg: [0.9, 0.9, 0.88], gsu: 4, th: lod >= 2 ? 0.2 : 0 });
  const nu = Math.min(10, Math.max(2, Math.round(fr.W / 8))), nv = Math.min(6, Math.max(1, Math.round(fr.D / 10)));
  if (lod <= 0) { for (const e of rf(rr[0], rr[1], rr[2], rr[3]).edges) B.wallE('c', e, 0, 1.4, [0.5, 0.5, 0.48]); return; }
  for (let i = 0; i <= nu; i++) for (const v of [0.8, fr.D - 0.8]) { const p = fr.p(cl(fr.W * i / nu, 0.8, fr.W - 0.8), v); B.box('c', p[0] - 0.18, p[1] - 0.18, p[0] + 0.18, p[1] + 0.18, 0, H, fc); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const u = fr.W * (i + 0.5) / nu, v = fr.D * (j + 0.5) / nv, p = fr.p(u, v);
    if (lod < 2) { const r = fr.rect(u - Math.min(2.5, fr.W / nu / 2 - 1), v - 1, u + Math.min(2.5, fr.W / nu / 2 - 1), v + 1); B.flat('c', r, 0.9, A.pick(R, [[0.75, 0.45, 0.3], [0.5, 0.65, 0.4], [0.8, 0.7, 0.4], [0.6, 0.62, 0.65]])); continue; }
    pbox(B, tEQ(), p[0], p[1], fn[0], fn[1], Math.min(5, fr.W / nu - 2), 2, 0, 0.95, cellUV(A.pick(R, [1, 3]), A.pick(R, [2, 3])), [0.55, 0.45, 0.35]);
    awning(B, mkE(...fr.p(u + 2.5, v - 1.1), ...fr.p(u - 2.5, v - 1.1)), 0, 5, 2.4, 0.8, (i + j) % 8); }
}
// 屋台村：小さな 屋台の列・ちょうちん・テーブル
function yatai(B, L, P, F0, r0, fr, fn) {
  const lod = P.lod, R = P.rng;
  B.cap(lod >= 1 ? tPave() : 'c', F0, 0.05, lod >= 1 ? col(L.pv) : mul(L.pv, 0.75), { su: 4 });
  const n = Math.min(14, Math.max(1, Math.floor((fr.W - 1) / 3.2))), rows = fr.D > 14 ? 2 : 1;
  if (lod <= 0) { for (let k = 0; k < rows; k++) { const v = k ? fr.D - 1.4 : 1.4, r = fr.rect(0.6, v - 0.9, 0.6 + n * 3.2, v + 0.9); B.box('c', r[0], r[1], r[2], r[3], 0, 2.3, [0.5, 0.38, 0.28]); } return; }
  for (let k = 0; k < rows; k++) for (let i = 0; i < n; i++) {
    const v = k ? fr.D - 1.4 : 1.4, u = 1.8 + i * 3.2, p = fr.p(u, v), fx = k ? fn[0] : -fn[0], fz = k ? fn[1] : -fn[1];   // 広場のほうを 向く
    if (lod < 2) { const r = fr.rect(u - 1.2, v - 0.9, u + 1.2, v + 0.9); B.box('c', r[0], r[1], r[2], r[3], 0, 2.3, [0.5, 0.38, 0.28]); B.flat(tAwn(), A.rin(r, -0.4), 2.32, WH, { su: 2 }); continue; }
    pbox(B, tEQ(), p[0], p[1], fx, fz, 2.4, 1.8, 0, 1.0, cellUV(0, 2), [0.5, 0.36, 0.25]);
    const back = [p[0] - fx * 0.9, p[1] - fz * 0.9]; B.box('c', back[0] - (Math.abs(fz) > 0.5 ? 1.2 : 0.06), back[1] - (Math.abs(fx) > 0.5 ? 1.2 : 0.06), back[0] + (Math.abs(fz) > 0.5 ? 1.2 : 0.06), back[1] + (Math.abs(fx) > 0.5 ? 1.2 : 0.06), 1.0, 2.3, [0.45, 0.34, 0.25]);
    const e = mkE(p[0] + fz * 1.2 - fx * 0.9, p[1] - fx * 1.2 - fz * 0.9, p[0] - fz * 1.2 - fx * 0.9, p[1] + fx * 1.2 - fz * 0.9);
    awning(B, e, 0, 2.4, 2.1, 2.0, L.ar[(i * 3 + k + P.id) % L.ar.length]);
    if (lod >= 2) { const q = [p[0] + fx * 1.1, p[1] + fz * 1.1]; B.cyl('c', q[0], q[1], 0.18, 1.7, 2.2, 8, [0.86, 0.2, 0.15]); }
  }
  if (lod >= 2) for (let i = 0; i < Math.min(8, n); i++) { const p = fr.p(1.8 + i * 3.2, fr.D / 2); B.box('c', p[0] - 0.5, p[1] - 0.5, p[0] + 0.5, p[1] + 0.5, 0.7, 0.75, [0.5, 0.38, 0.28]); B.box('c', p[0] - 0.06, p[1] - 0.06, p[0] + 0.06, p[1] + 0.06, 0, 0.7, [0.3, 0.3, 0.3]); }
  void R;
}
A.arch('b_arcade', { looks: ARL, build: arcade,
  far(L, P) { const k = P.ko; return { H: k.ichiba ? 6.5 : k.yatai ? 2.4 : 3.6 + cl(P.f, 1, 2) * 2.9, base: 0, wall: tFarLo(), bw: 3.6, fh: 2.9, tb: 2, tf: 2, wc: [0.82, 0.8, 0.76], rt: 'flat', top: k.yatai ? tPave() : k.ichiba ? tSeam() : tAR(), ct: k.yatai ? col(L.pv) : k.ichiba ? col(L.rc) : [0.9, 0.9, 0.9], ins: 0.5 }; } });

/* ---------- 銀行の支店・信用金庫・郵便局 ---------- */
const BKL = [
  { n: 'ベージュのタイル・紺', tx: 2, sg: '#2b3f66', pc: '#d1c1a2' },
  { n: 'グレーの石張り・深緑', tx: 4, sg: '#2f5a43', pc: '#a5a39e' },
  { n: '白いPCa・えんじ', tx: 1, sg: '#7a2a32', pc: '#e3e1db' },
  { n: 'レンガ色のタイル', tx: 10, sg: '#efe7d6', pc: '#93553f' },
  { n: '打ちはなし・ガラス', tx: 8, sg: '#3b3d41', pc: '#b4b2ab' },
];
function bank(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, f = Math.max(1, P.f);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, 0.5), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn), sg = col(L.sg);
  let Fb = F0;
  if (F0.rects.length === 1 && fr.D > 24) { const br = fr.rect(0, Math.min(11.5, fr.D - 14), fr.W, fr.D); Fb = rf(br[0], br[1], br[2], br[3]); parking(B, fr.rect(0, 0, fr.W, Math.min(11.5, fr.D - 14) - 0.5), fn, P, { cars: 3 }); }
  const fe = A.frontEdge(Fb, fn), gh = 4.6, fh = 3.7, H = gh + (f - 1) * fh, m = tOF(L.tx);
  if (lod >= 1 || P.yb < -0.5) B.plinth(Fb, P.yb, 0.15, [0.6, 0.59, 0.56]);
  // 1階：ATM コーナー（はし）・入口・ロビー
  const nb = Math.max(2, Math.round(fe.L / 3.2)), b = fe.L / nb, na = Math.min(2, nb - 1);
  B.wallE(tGF(), fe, 0, gh, WH, { from: 0, to: na * b, uv: [0, na / 4, ...rowV(1, 4)], ao: 0.9 });
  frontRow(B, tGF(), esub(fe, na * b, fe.L), 0, gh, 3.2, 0, lod >= 1 ? 1 : null, 4, null, 1);
  for (const e of Fb.edges) if (e !== fe) B.facade(m, { edges: [e] }, 0, gh, { bw: 3.2, fh: gh, tb: 4, tf: 4, vy: 0, ao: 0.85 });
  if (f > 1) B.facade(m, Fb, gh, H, { bw: 3.2, fh, tb: 4, tf: 4, vy: gh });
  if (lod <= 0) { roofFlat(B, Fb, H); return; }
  para(B, Fb, H, 0.9, col(L.pc), lod, 0.25); roofFlat(B, Fb, H + 0.02);
  // 看板の帯（1階の上）・ATM の上の 小さな看板・たて看板
  signBox(B, fe, na * b + 0.2, fe.L - 0.2, gh - 0.85, gh - 0.1, 0.06, 0.2, sg);
  signBox(B, fe, 0.15, na * b - 0.15, gh - 0.85, gh - 0.1, 0.06, 0.2, [0.95, 0.95, 0.93]);
  if (f >= 2) sode(B, fe, fe.L - 0.6, gh + 0.4, H - 0.3, sg, [0.95, 0.95, 0.93], lod);
  hisashi(B, fe, na * b, fe.L, gh - 0.95, 1.3, [0.5, 0.52, 0.54]);
  roofKit(B, bigR(Fb), H, P, { fn, c: col(L.pc), ph: f >= 3 });
  if (lod < 2) return;
  if (ko.post) { const p = ept(fe, fe.L - 1.2, 1.4); B.box('c', p[0] - 0.08, p[1] - 0.08, p[0] + 0.08, p[1] + 0.08, 0, 0.6, [0.3, 0.3, 0.3]); pbox(B, tEQ(), p[0], p[1], fe.nx, fe.nz, 0.5, 0.42, 0.6, 1.55, cellUV(2, 3), [0.78, 0.2, 0.16]); B.cyl('c', p[0], p[1], 0.27, 1.55, 1.7, 8, [0.72, 0.18, 0.14]); }
  planters(B, fe, na * b + 1, fe.L - 1, P);
  void R;
}
A.arch('b_bank', { looks: BKL, build: bank,
  far(L, P) { return { H: 4.6 + (Math.max(1, P.f) - 1) * 3.7 + 0.9, base: 0, wall: tOF(L.tx), bw: 3.2, fh: 3.7, tb: 4, tf: 4, rt: 'flat', top: tFlat(), ct: [0.9, 0.9, 0.88], ins: 0.5 }; } });

/* ---------- データセンター（窓なし・ガラリ・屋上の冷却機・発電機・フェンス） ---------- */
const DCL = [
  { n: '白いパネル・ガラリ', wc: '#efefec', lc: '#c9cccd' },
  { n: 'グレーのパネル', wc: '#b9bdbf', lc: '#8d9294' },
  { n: 'ダークグレー・縦の線', wc: '#5b5f63', lc: '#3f4346' },
  { n: 'ベージュのコンクリート', wc: '#d8cfbf', lc: '#a9a194' },
];
function dc(B, L, P) {
  const lod = P.lod, R = P.rng, f = cl(P.f, 1, 6);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, P.F.area > 2000 ? 6 : 2), fn = fnOf(F0, P), wc = col(L.wc), lc = col(L.lc), fh = 5.5, H = f * fh;
  if (lod >= 1 || P.yb < -0.5) B.plinth(F0, P.yb, 0.2, [0.6, 0.59, 0.56]);
  for (const e of F0.edges) B.wallE(tWP(), e, 0, H, wc, { uv: [e.u0 / 4, (e.u0 + e.L) / 4, 0, H / 4], ao: 0.86 });
  if (lod >= 1) for (let k = 0; k < f; k++) for (const e of F0.edges) B.wallE(tLouv(), e, k * fh + fh - 1.4, k * fh + fh - 0.3, lc, { uv: [0, e.L / 2, 0, 1], off: 0.08 });
  B.cap(tFlat(), F0, H, [0.95, 0.95, 0.94], { su: 12 });
  const fe = A.frontEdge(F0, fn);
  frontRow(B, tGF(), esub(fe, fe.L / 2 - 3.2, fe.L / 2 + 3.2, 0.03), 0, 4.2, 3.2, 0, 1, 4, 0, 1);
  if (lod <= 0) return;
  para(B, F0, H, 1.2, mul(wc, 0.95), lod, 0.25);
  // 屋上の 冷却機（列）
  const r = bigR(F0), fr = frame(r, fn), nr = Math.min(4, Math.floor(fr.D / 8)), nc = Math.min(12, Math.floor(fr.W / 5));
  // 1 列 = 長い箱 1 つ ＋ 上に ファン（室外機の ます を 上向きに）
  const fan = cellUV(0, 0, 4, false);
  for (let i = 0; i < Math.min(nr, 3); i++) { const a = fr.p(3, 4 + i * 7), b = fr.p(fr.W - 3, 4 + i * 7), ax = Math.abs(fn[1]) > 0.5, r2 = ax ? [Math.min(a[0], b[0]), a[1] - 1.1, Math.max(a[0], b[0]), a[1] + 1.1] : [a[0] - 1.1, Math.min(a[1], b[1]), a[0] + 1.1, Math.max(a[1], b[1])];
    B.box('c', r2[0], r2[1], r2[2], r2[3], H, H + 2.2, [0.85, 0.86, 0.86]);
    if (lod >= 2) for (let j = 0; j < Math.min(nc, 10); j++) { const t = (j + 0.5) / Math.min(nc, 10), cx = ax ? r2[0] + (r2[2] - r2[0]) * t : (r2[0] + r2[2]) / 2, cz = ax ? (r2[1] + r2[3]) / 2 : r2[1] + (r2[3] - r2[1]) * t; B.quad(tEQ(), [cx - 1, H + 2.23, cz + 1], [cx + 1, H + 2.23, cz + 1], [cx + 1, H + 2.23, cz - 1], [cx - 1, H + 2.23, cz - 1], [0, 1, 0], WH, [fan[0] + 0.02, fan[2] + 0.03, fan[0] + 0.14, fan[3] - 0.03]); } }
  if (lod < 2) return;
  // 発電機（コンテナ）・フェンス
  const be = F0.edges.find(e => e.nx * fn[0] + e.nz * fn[1] < -0.5) || F0.edges[0];
  for (let k = 0; k < Math.min(5, Math.floor(be.L / 8)); k++) { const p = ept(be, 3 + k * 7, 2.5); B.obox('c', p[0], p[1], Math.atan2(be.bz - be.az, be.bx - be.ax), 6, 2.4, 0, 2.6, [0.9, 0.9, 0.88]); }
  if (!P.tilt) for (const e of insP(P, 0.5).edges) B.rail(tRail(), e, 0, 2.4, 0, [0.55, 0.57, 0.58], { su: 2, ends: false });
  void R;
}
A.arch('b_dc', { looks: DCL, build: dc,
  far(L, P) { return { H: cl(P.f, 1, 6) * 5.5 + 1.2, base: 0, wall: tWP(), bw: 4, fh: 4, tb: 1, tf: 1, wc: col(L.wc), rt: 'flat', top: tFlat(), ct: [0.92, 0.92, 0.9], ins: 4 }; } });

/* ---------- サービスエリア・パーキングエリア（高速道路の休憩所） ----------
   区画の奥に 本館（フードコート・お店）と トイレ棟、前（高速道路がわ）は 駐車場（大型車と 小型車を わける）。SA は ガソリンスタンドつき */
// 石張りの壁（色をかける）。su 4
const tST = () => T('st', 128, 128, (g, w, h, R) => { PT.wallMat(g, 0, 0, w, h, { t: 'stone', c: '#ebe8e1', sc: w / 64, n: 0.04 }, R); });
// 見た目：wm（壁：wd 板・wc ぬり・wt タイル・st 石・gl ガラス）・wc（壁の色）・rf（屋根の形）・rc（屋根の色）・ac（差し色：看板の板・柱）・ev（本館の 軒の出 m）
const SAL = [
  { n: 'モダンな大屋根', wm: 'wc', wc: '#e8e7e2', rf: 'flat', rc: '#55595e', ac: '#2f5f7a', ev: 5 },
  { n: '和風の大屋根', wm: 'wd', wc: '#8f6e50', rf: 'irimoya', rc: '#ffffff', ac: '#4a3424', ev: 2.6 },
  { n: 'ガラスの箱', wm: 'gl', wc: '#ffffff', rf: 'flat', rc: '#c9cccd', ac: '#3b3d41', ev: 1.5 },
  { n: '木のルーバー・片流れ', wm: 'wd', wc: '#c49a6c', rf: 'shed', rc: '#4f5459', ac: '#5a3e2a', ev: 3.5, lv: true },
  { n: '地元の石張り・切妻', wm: 'st', wc: '#cdc4b3', rf: 'gable', rc: '#5f6f66', ac: '#6a5a48', ev: 2.4 },
  { n: '白いかまぼこ屋根', wm: 'wt', wc: '#f2f1ec', rf: 'barrel', rc: '#eef0f0', ac: '#2f6f6a', ev: 2 },
];
const ASPH = [0.37, 0.38, 0.39], CARC = [[0.92, 0.92, 0.9], [0.18, 0.19, 0.2], [0.62, 0.64, 0.66], [0.55, 0.12, 0.12], [0.2, 0.28, 0.45], [0.85, 0.83, 0.78], [0.42, 0.45, 0.4]];
const saWT = L => L.wm === 'gl' ? tOF(3) : L.wm === 'st' ? tST() : WMT[L.wm]();
// トラック（運転席が ang のがわ）・バス
function truck(B, x, z, ang, c, y = 0.05) { const ca = Math.cos(ang), sn = Math.sin(ang); B.obox('c', x + ca * 5.4, z + sn * 5.4, ang, 2.2, 2.45, y + 0.45, y + 3.1, c); B.obox('c', x - ca * 1.2, z - sn * 1.2, ang, 10.6, 2.5, y + 0.55, y + 3.8, mix(c, '#e8e8e4', 0.75)); }
function bus(B, x, z, ang, c, y = 0.05) { B.obox('c', x, z, ang, 12, 2.5, y + 0.35, y + 3.3, c); B.obox('c', x, z, ang, 11.8, 2.56, y + 1.75, y + 2.75, [0.16, 0.18, 0.22]); }
// 駐車場の 区画（フレームの u0〜u1・v0〜v1）：ます sw × sd・通路 ai。奥から 列（奥が閉じた列・通路・手前が閉じた列・植えこみの島 …）
//   nv：置く車の数（lod 2）・big：トラックとバス。返り値：{ isl（島の [va, vb]）, uS, uE }
function stallZone(B, fr, u0, u1, v0, v1, sw, sd, ai, P, nv, big) {
  const lod = P.lod, R = P.rng, W = u1 - u0;
  if (W < 3 || v1 - v0 < 2) return { isl: [], uS: u0, uE: u0 };
  B.flat('c', fr.rect(u0, v0, u1, v1), 0.03, ASPH);
  const rows = [], isl = []; let v = v1 - 0.4;
  for (let g = 0; g < 10; g++) {
    if (v - sd < v0) break; rows.push([v - sd, v, true]); v -= sd;
    if (v - ai - sd < v0) break; v -= ai; rows.push([v - sd, v, false]); v -= sd;
    if (v - 1.8 - ai - sd < v0) break; isl.push([v - 1.8, v]); v -= 1.8;
  }
  const ns = Math.max(0, Math.floor((W - 1) / sw)), uS = u0 + (W - ns * sw) / 2, uE = uS + ns * sw;
  if (lod <= 0 || !ns) return { isl, uS, uE };
  for (const [va, vb, cb] of rows) stallStrip(B, fr, uS, uE, va, vb, cb, ns / 4);
  for (const [va, vb] of isl) { const r = fr.rect(uS, va, uE, vb); if (lod >= 2) B.box('c', r[0], r[1], r[2], r[3], 0.03, 0.18, [0.7, 0.7, 0.68], { ct: [0.4, 0.5, 0.33] }); else B.flat('c', r, 0.06, [0.42, 0.52, 0.35]); }
  if (lod < 2 || !rows.length) return { isl, uS, uE };
  const p0 = fr.p(0, 0), p1 = fr.p(0, 1), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), used = new Set();
  for (let k = 0; k < nv * 2 && used.size < nv; k++) {
    const ri = Math.floor(R() * rows.length), s = Math.floor(R() * ns), key = ri * 4096 + s; if (used.has(key)) continue; used.add(key);
    const [va, vb, cb] = rows[ri], p = fr.p(uS + (s + 0.5) * sw, (va + vb) / 2), a = cb ? ang + PI : ang;   // 前は 通路がわ
    if (!big) B.car(p[0], p[1], a, A.pick(R, CARC), 0.05);
    else if (R() < 0.3) bus(B, p[0], p[1], a, A.pick(R, [[0.92, 0.9, 0.84], [0.3, 0.45, 0.62], [0.75, 0.3, 0.25], [0.35, 0.55, 0.42]]));
    else truck(B, p[0], p[1], a, A.pick(R, [[0.85, 0.85, 0.83], [0.3, 0.42, 0.6], [0.62, 0.15, 0.12], [0.2, 0.22, 0.24], [0.4, 0.55, 0.35]]));
  }
  return { isl, uS, uE };
}
// 壁（見た目の材料。ガラスは カーテンウォール）
function saWall(B, L, e, y0, y1, ao) {
  if (L.wm === 'gl') B.facade(tOF(3), { edges: [e] }, y0, y1, { bw: 3.2, fh: 4, tb: 4, tf: 4, vy: 0, ao });
  else B.wallE(saWT(L), e, y0, y1, col(L.wc), { uv: [0, e.L / 4, y0 / 4, y1 / 4], ao });
}
// 屋根（見た目ごと）。r：壁の外の線・H：壁の上・ev：軒の出（平らな屋根は 正面へ 大きく出る）。返り値：いちばん上
function saRoof(B, L, r, H, fn, P, ev) {
  const lod = P.lod, rc = col(L.rc), th = lod >= 2 ? 0.25 : 0, wt = L.wm === 'gl' ? tWC() : saWT(L), wc = col(L.wc), axF = Math.abs(fn[1]) > 0.5 ? 'x' : 'z';
  if (L.rf === 'flat') { const fr = frame(r, fn), e2 = Math.min(ev, 1.5), rr = fr.rect(-e2, -ev, fr.W + e2, fr.D + 0.8);
    B.box('c', rr[0], rr[1], rr[2], rr[3], H, H + 0.6, mul(rc, 1.05), { mt: tSeam(), ct: mix(rc, '#ffffff', 0.45), tsu: 4, bottom: lod >= 1 }); return H + 0.6; }
  if (L.rf === 'irimoya') return B.roof({ t: 'irimoya', r, y: H, p: 0.5, oh: ev, hmax: 7, ax: axF, m: tKawara(), c: rc, su: 3, mg: wt, cg: wc, gsu: 4, th, cf: [0.32, 0.3, 0.28] });
  if (L.rf === 'shed') return B.roof({ t: 'shed', r, y: H, p: 0.14, oh: ev, ax: axF, hi: (fn[1] > 0 || fn[0] > 0) ? '+' : '-', m: tSeam(), c: rc, su: 4, mg: wt, cg: wc, gsu: 4, th });
  if (L.rf === 'gable') return B.roof({ t: 'gable', r, y: H, p: 0.36, oh: ev, hmax: 6, ax: axF, m: tSeam(), c: rc, su: 4, mg: wt, cg: wc, gsu: 4, th });
  return B.roof({ t: 'barrel', r, y: H, p: 0.24, oh: ev, hmax: 6, ax: axF, n: lod >= 2 ? 12 : lod >= 1 ? 8 : 4, m: tSeam(), c: rc, su: 4, mg: wt, cg: wc, gsu: 4, th: 0 });
}
// 建物：r・正面 fn・kind（'main' フードコートとお店・'wc' トイレ棟・'shop' 小さな売店）・階 nf。返り値：{ H, top, fe }
function saBld(B, L, r, fn, P, kind, nf) {
  const lod = P.lod, F = rf(r[0], r[1], r[2], r[3]), fe = A.frontEdge(F, fn), gh = kind === 'main' ? 5.4 : 4.2, H = gh + (nf - 1) * 4.2, gy = Math.min(gh - 0.9, 4.2), ac = col(L.ac);
  if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.15, [0.6, 0.59, 0.56]);
  for (const e of F.edges) if (e !== fe) saWall(B, L, e, 0, H, 0.86);
  if (lod <= 0) saWall(B, L, fe, 0, H, 0.9);
  else if (kind === 'wc') {   // トイレ棟：高い窓の帯・入口 2 つ
    saWall(B, L, fe, 0, H, 0.9);
    const [w0, w1] = rowV(4, 8), nb = Math.max(1, Math.round((fe.L - 1.2) / 3.6));
    B.wallE(tLW2(), fe, 2.5, 3.4, WH, { from: 0.6, to: fe.L - 0.6, off: 0.05, uv: [0, nb / 4, w1 - (w1 - w0) * 0.68, w1 - (w1 - w0) * 0.32] });
    for (const t of [fe.L * 0.28, fe.L * 0.72]) B.wallE(tGF2(), fe, 0, 2.4, WH, { from: t - 1.0, to: t + 1.0, off: 0.07, uv: [0, 0.25, ...rowV(1, 4)] });
  } else {
    if (kind === 'shop') frontRow(B, tGF2(), fe, 0, gy, 3.2, 0, 1, 4, null, 1);
    else { const h = fe.L / 2; frontRow(B, tGF2(), esub(fe, 0, h), 0, gy, 3.2, 2, 1, 4, null, 1); frontRow(B, tGF2(), esub(fe, h, fe.L), 0, gy, 3.2, 0, 1, 4, null, 1); }
    if (L.lv && kind === 'main') B.wallE(tLW2(), fe, gy, H, WH, { uv: [0, Math.max(1, Math.round(fe.L / 3.6)) / 4, ...rowV(7, 8)] });   // 木のルーバー
    else saWall(B, L, fe, gy, H);
  }
  const top = lod <= 0 && kind !== 'main' ? (B.cap('c', F, H, mul(saFarC(L), 1.1)), H) : saRoof(B, L, r, H, fn, P, kind === 'main' ? L.ev : Math.min(L.ev, 1.5));
  if (lod >= 1 && kind !== 'wc') {   // 看板（文字なしの 色の板）・平らな大屋根の柱
    band(B, P, fe, gy + 0.2, Math.min(H - 0.2, gy + 1.1), { from: 0.3, to: fe.L - 0.3, def: [L.ac, '#f2f2ee', L.ac], pat: 'solid', th: 0.2, bc: mul(L.wc, 0.9) });
    if (L.rf === 'flat' && kind === 'main' && L.ev >= 3) { const n = lod >= 2 ? Math.max(2, Math.round(fe.L / 8)) : Math.min(4, Math.max(2, Math.round(fe.L / 16)));
      for (let k = 0; k <= n; k++) { const p = ept(fe, cl(fe.L * k / n, 0.4, fe.L - 0.4), L.ev - 0.7); B.box('c', p[0] - 0.18, p[1] - 0.18, p[0] + 0.18, p[1] + 0.18, 0, H, mul(L.rc, 1.1)); } }
  }
  return { H, top, fe };
}
// SA の ガソリンスタンド（フレームの u0〜u1・v0〜v1。屋根は 正面がわ・売店は 奥）
function saGas(B, fr, u0, u1, v0, v1, L, P0) {
  const P = Object.assign({}, P0, { sc: P0.sc && P0.sc.length ? [P0.sc[P0.sc.length - 1]] : null }), lod = P.lod, R = P.rng, ac = col(L.ac), c1 = [0.95, 0.95, 0.93], cw = Math.min(u1 - u0 - 2, 26), cd = Math.min(v1 - v0 - 9, 14);
  B.flat('c', fr.rect(u0, v0, u1, v1), 0.04, [0.68, 0.68, 0.66]);
  if (cw < 10 || cd < 6) return;
  const cu = u0 + (u1 - u0 - cw) / 2, cr = fr.rect(cu, v0 + 1, cu + cw, v0 + 1 + cd);
  B.box('c', cr[0], cr[1], cr[2], cr[3], 5.0, 5.9, c1, { bottom: lod >= 1 });
  if (lod >= 1) for (const e of rf(cr[0], cr[1], cr[2], cr[3]).edges) A.shopBand(B, P, e, 5.15, 5.7, { def: [L.ac, '#f2f2ee', L.ac], pat: 'solid', off: 0.03 });
  for (let i = 0; i < 2; i++) {   // 給油の島（2 列）と 柱
    const u = cu + cw * (0.25 + 0.5 * i), ir = fr.rect(u - 0.5, v0 + 1 + cd * 0.2, u + 0.5, v0 + 1 + cd * 0.8), pc = fr.p(u, v0 + 1 + cd / 2);
    if (lod < 1) continue;
    B.box('c', pc[0] - 0.22, pc[1] - 0.22, pc[0] + 0.22, pc[1] + 0.22, 0.04, 5.0, [0.85, 0.85, 0.83]);
    B.box('c', ir[0], ir[1], ir[2], ir[3], 0.04, 0.3, [0.78, 0.78, 0.76]);
    for (const s of [0.3, 0.7]) { const q = fr.p(u, v0 + 1 + cd * s); B.box('c', q[0] - 0.35, q[1] - 0.35, q[0] + 0.35, q[1] + 0.35, 0.3, 2.0, [0.94, 0.94, 0.92]); }
    if (lod >= 2 && R() < 0.7) { const q = fr.p(u + 2.2, v0 + 1 + cd / 2), a = fr.p(u + 2.2, v0 + 2 + cd / 2); B.car(q[0], q[1], Math.atan2(a[1] - q[1], a[0] - q[0]), A.pick(R, CARC), 0.06); }
  }
  // 売店
  const kr = fr.rect(cu + cw * 0.25, v0 + 2.5 + cd, cu + cw * 0.75, Math.min(v1 - 0.5, v0 + 2.5 + cd + 6));
  if (lod >= 1 && kr[2] - kr[0] > 3 && kr[3] - kr[1] > 3) { const Fk = rf(kr[0], kr[1], kr[2], kr[3]), fe = A.frontEdge(Fk, fr.n);
    if (lod >= 1) frontRow(B, tGF2(), fe, 0.04, 3.0, 3.2, 0, null); else B.wallE(tWP(), fe, 0, 3.4, c1, { uv: [0, fe.L / 4, 0, 0.85] });
    for (const e of Fk.edges) if (e !== fe) B.wallE(tWP(), e, 0.04, 3.4, c1, { uv: [0, e.L / 4, 0, 0.85] });
    if (lod >= 1) B.wallE(tWP(), fe, 3.0, 3.4, c1, { uv: [0, fe.L / 4, 0.75, 0.85] });
    B.cap('c', Fk, 3.4, [0.7, 0.7, 0.68]); band(B, P, fe, 2.9, 3.6, { def: [L.ac, '#f2f2ee', L.ac], pat: 'solid', th: 0.12, bc: c1 }); }
}
function sarea(B, L, P) {
  const ko = P.ko, lod = P.lod, R = P.rng, pa = !!ko.pa, f = pa ? 1 : cl(P.f, 1, 2);
  if (P.f <= 0) { plaza(B, P); return; }
  const F0 = insP(P, P.tilt ? 0.2 : 0.5), fn = fnOf(F0, P), r0 = bigR(F0), fr = frame(r0, fn), W = fr.W, D = fr.D, ac = col(L.ac);
  if (lod >= 1 || P.yb < -0.5) B.plinth(F0, P.yb, 0.03, [0.6, 0.6, 0.58]);
  B.cap('c', F0, 0.02, [0.6, 0.6, 0.58]);
  // 奥の 建物の帯・建物の前の 広場・車道・駐車場（道がわ）
  const back = D > 40 ? 3 : 0.5, dm = Math.min(pa ? cl(D * 0.3, 9, 14) : cl(D * 0.22, 14, 26), D * 0.5), vB = D - back - dm, pz = Math.max(0, Math.min(pa ? 4 : 6, vB - 2));
  if (lod >= 1) B.flat('c', fr.rect(0, vB - pz, W, D), 0.035, [0.45, 0.53, 0.37]);
  const one = W < 16, ww = one ? 0 : Math.min(pa ? cl(W * 0.22, 9, 16) : cl(W * 0.13, 12, 22), W * 0.4), mw = one ? W - 1 : Math.min(pa ? cl(W * 0.22, 8, 18) : cl(W * 0.42, 24, 96), W * 0.45);
  const gap = one ? 0 : Math.min(pa ? 5 : 9, W * 0.1), uW = Math.max(0.5, (W - ww - gap - mw) / 2), uM = uW + ww + gap;
  const rM = fr.rect(uM, vB, uM + mw, vB + dm), bM = saBld(B, L, rM, fn, P, pa ? 'shop' : 'main', f);
  if (!one) saBld(B, L, fr.rect(uW, vB, uW + ww, vB + Math.min(dm, pa ? 10 : 12)), fn, P, 'wc', 1);
  // 広場（建物の前）・屋根つきの 通路
  const u0p = Math.max(0, uW - 3), u1p = Math.min(W, uM + mw + 3);
  if (pz > 0.5) B.flat(lod >= 1 ? tPave() : 'c', fr.rect(u0p, vB - pz, u1p, vB), 0.12, lod >= 1 ? [0.97, 0.95, 0.92] : [0.78, 0.77, 0.74], { su: 4 });
  if (lod >= 1 && !one) {
    const wr = fr.rect(uW + 0.2, vB - Math.min(3, pz), uM + 0.2, vB + Math.min(4, dm * 0.4)); B.box('c', wr[0], wr[1], wr[2], wr[3], 3.0, 3.25, mix(L.rc, '#9a9c9e', 0.5), { bottom: true });
    if (lod >= 2) { const n = cl(Math.round((uM - uW) / 6), 1, 8); for (let k = 0; k <= n; k++) { const p = fr.p(uW + 0.6 + (uM - uW - 0.4) * k / n, vB - Math.min(3, pz) + 0.3); B.box('c', p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, 0.12, 3.0, [0.55, 0.56, 0.57]); } }
  }
  // 駐車場：車道（建物の前 7m）・ガソリンスタンド（SA・出口がわ）・大型車（入口がわ）・小型車
  const vP = vB - pz - (vB - pz - 2 >= 30 ? 7 : 0);
  if (vP < vB - pz) B.flat('c', fr.rect(0, vP, W, vB - pz), 0.03, ASPH);
  let uc0 = 1, uc1 = W - 1; const isl = [];
  if (!pa && W >= 110 && vP >= 26) { saGas(B, fr, W - 37, W - 1, 1, Math.min(vP - 1, 30), L, P); if (vP > 32) stallZone(B, fr, W - 37, W - 1, 31, vP, 2.5, 5.5, 6.5, P, 2, false); uc1 = W - 41; }
  if (W >= (pa ? 70 : 80) && vP - 1 >= 17) { const ut = cl((uc1 - uc0) * (pa ? 0.3 : 0.36), 24, 110), z = stallZone(B, fr, uc0, uc0 + ut, 1, vP, 4, 17, 13, P, pa ? 2 : 6, true); isl.push(...z.isl.map(q => [z.uS, z.uE, q[0], q[1]]));
    const sr = fr.rect(uc0 + ut, 1, uc0 + ut + 4, vP); if (lod >= 1) B.flat('c', sr, 0.06, [0.42, 0.52, 0.35]); isl.push([uc0 + ut + 0.5, uc0 + ut + 3.5, 1, vP]); uc0 += ut + 4; }
  { const z = stallZone(B, fr, uc0, uc1, 1, vP, 2.5, 5.5, 6.5, P, pa ? 6 : 14, false); isl.push(...z.isl.map(q => [z.uS, z.uE, q[0], q[1]])); }
  if (lod <= 0) return;
  // 案内の 柱（色の板だけ・文字なし）
  { const p = fr.p(Math.min(4, W * 0.1), 1.2), uc = unitCols(P, [L.ac, '#f2f2ee', L.ac])[0]; poleSign(B, p[0], p[1], fn[0], fn[1], pa ? 9 : 14, 3.2, pa ? 3 : 4.5, col(uc[0]), lod >= 2 ? col(uc[1]) : null, null); }
  // 木（島と 建物の まわり）
  const nt = lod >= 2 ? 12 : 6, spots = [];
  for (const [a, b, va, vb] of isl) { const L2 = Math.abs(b - a) > Math.abs(vb - va) ? 'u' : 'v'; for (let k = 0; k < 2; k++) spots.push(L2 === 'u' ? fr.p(a + (b - a) * (0.25 + 0.5 * k), (va + vb) / 2) : fr.p((a + b) / 2, va + (vb - va) * (0.25 + 0.5 * k))); }
  for (const u of [u0p * 0.5, (u1p + W) / 2]) if ((u < u0p - 3 || u > u1p + 3) && u > 2 && u < W - 2) for (let k = 0; k < 2; k++) spots.push(fr.p(u, vB - pz + 3 + (D - vB + pz - 5) * (0.2 + 0.6 * k)));
  for (let k = 0; k < Math.min(nt, spots.length); k++) { const p = spots[(k * 7 + P.id) % spots.length]; treeL(B, p[0], p[1], 0.06, 6 + R() * 2, 2 + R() * 0.6, lod); }
  if (lod < 2) return;
  // 自動販売機の コーナー（トイレ棟の前）・喫煙所・照明
  if (!one) for (let k = 0; k < 4; k++) { const p = fr.p(uW + ww - 1 - k * 1.05, vB - 0.6); vend(B, p[0], p[1], fn[0], fn[1], (k + P.id) % 3, 0.12); }
  if (pz >= 4) { const p = fr.p(u0p + 2.2, vB - pz + 1.6), q = frame(fr.rect(u0p + 0.7, vB - pz + 0.4, u0p + 3.7, vB - pz + 2.8), fn); const r = q.rect(0, 0, q.W, q.D);
    B.box('c', r[0], r[1], r[2], r[3], 0.12, 2.4, [0.74, 0.8, 0.82], { ct: [0.4, 0.42, 0.44] }); B.box('c', r[0] - 0.15, r[1] - 0.15, r[2] + 0.15, r[3] + 0.15, 2.4, 2.55, [0.42, 0.44, 0.46]); void p; }
  for (let k = 0; k < Math.min(6, isl.length * 2); k++) { const [a, b, va, vb] = isl[k % isl.length], p = fr.p((a + b) / 2 + (k > 2 ? 3 : -3), (va + vb) / 2); B.box('c', p[0] - 0.09, p[1] - 0.09, p[0] + 0.09, p[1] + 0.09, 0.06, 10, [0.6, 0.61, 0.62]); B.box('c', p[0] - 0.5, p[1] - 0.2, p[0] + 0.5, p[1] + 0.2, 9.8, 10.1, [0.5, 0.51, 0.52]); }
  void bM; void ac;
}
// 遠く：ほとんど 駐車場なので 低い舗装（屋根の色を 少し まぜる）
const saFarC = L => { const a = L.rf === 'irimoya' ? farRC('kawara', L.rc) : L.rf === 'flat' ? mul(mix(L.rc, '#ffffff', 0.45), 0.78) : farRC('seam', L.rc); return mix([0.45, 0.46, 0.47], a, 0.18); };
A.arch('b_sa', { looks: SAL, build: sarea,
  far(L) { return { H: 0.5, base: 0, wall: tWC(), bw: 4, fh: 4, tb: 1, tf: 1, wc: [0.62, 0.62, 0.6], rt: 'flat', top: null, ct: saFarC(L), ins: 0.5 }; } });

/* ---------- プリセット → 型 ---------- */
A.kinds({
  sa: 'b_sa', pa: ['b_sa', { pa: true, looks: [1, 2, 4, 5].map(i => SAL[i - 1]) }],
  smalloffice: 'b_office', office: 'b_office', midoffice: 'b_office', bigoffice: 'b_office', it: 'b_office', insurance: 'b_office', securities: 'b_office',
  travel: 'b_office', ad: 'b_office', hq: 'b_office', lawoffice: 'b_office', rentalmtg: 'b_office', publisher: 'b_office',
  callcenter: 'b_office', complex: 'b_office', newspaper: ['b_office', { press: true }],
  bankhq: ['b_office', { looks: [4, 2, 10, 1, 7].map(i => OFL[i - 1]) }],
  startup: ['b_office', { looks: [8, 6, 9, 5, 3].map(i => OFL[i - 1]) }], coworking: ['b_office', { looks: [8, 6, 10, 1, 9].map(i => OFL[i - 1]) }],
  intelligent: ['b_office', { looks: [3, 9, 6, 5, 1].map(i => OFL[i - 1]) }], glassoffice: ['b_office', { looks: [3, 9, 6, 5].map(i => OFL[i - 1]) }],
  tvstation: ['b_office', { tv: true, looks: [3, 1, 5, 9, 6].map(i => OFL[i - 1]) }], lab: ['b_office', { lab: true, looks: [1, 5, 8, 6, 2].map(i => OFL[i - 1]) }],
  embassy: ['b_office', { emb: true, set: 6, looks: [4, 1, 10, 8, 2].map(i => OFL[i - 1]) }],
  sky: 'b_sky', skyoffice: 'b_sky', twintower: ['b_sky', { twin: true }],
  zakkyo: 'b_zakkyo', pencil: 'b_zakkyo',
  depart: 'b_depart', ekibiru: ['b_depart', { deck: true }], fashionbldg: ['b_depart', { looks: [4, 5, 2, 1].map(i => DPL[i - 1]) }], mixeduse: ['b_depart', { mix: true }],
  mall: 'b_mall', outlet: ['b_mall', { outlet: true, looks: OTL }], michinoeki: ['b_mall', { eki: true, looks: MCL }],
  arcadeshop: 'b_arcade', ichiba: ['b_arcade', { ichiba: true, looks: ICL }], yatai: ['b_arcade', { yatai: true, looks: YTL }],
  bankbranch: 'b_bank', shinkin: 'b_bank', postoffice: ['b_bank', { post: true, looks: [3, 1, 2, 5].map(i => BKL[i - 1]) }],
  datacenter: 'b_dc',
});
// 小さなお店：店先（front）・小物
const SH = (o, ls) => ['b_shop', ls ? Object.assign({ looks: ls.map(i => SHL[i - 1]) }, o) : o];
A.kinds({
  cafe: SH({ front: 'cafe', vm: 0, terrace: true }),
  bakery: SH({ front: 'cafe', vm: 0 }, [9, 1, 4, 5, 6, 3]),
  books: SH({ front: 'glass' }, [1, 7, 4, 10, 5]),
  cake: SH({ front: 'glass', vm: 0 }, [9, 4, 1, 6, 5]),
  pharmacy: SH({ front: 'bright', vm: 1 }, [1, 5, 7, 10]),
  megane: SH({ front: 'glass', vm: 0 }, [1, 6, 10, 4]),
  biyou: SH({ front: 'glass', vm: 0 }, [6, 9, 10, 1, 5]),
  riyou: SH({ front: 'glass', pole: true, vm: 1 }, [7, 1, 5, 3]),
  kissa: SH({ front: 'cafe', vm: 0 }, [3, 7, 2, 4, 8]),
  soba: SH({ front: 'wa', fix: true, noren: '#2f3f5c', vm: 0 }, [2, 8, 3, 7, 9]),
  ramen: SH({ front: 'wa', fix: true, noren: '#8c2f25', duct: true, nob: 2 }, [7, 2, 1, 6]),
  sushi: SH({ front: 'wa', fix: true, noren: '#2a3550', vm: 0 }, [8, 2, 6, 10]),
  izakaya: SH({ front: 'wa', fix: true, noren: '#3a2c22', lantern: true, nob: 1 }, [2, 7, 8, 3, 6]),
  wagashi: SH({ front: 'wa', fix: true, noren: '#5c3a5a', vm: 0 }, [8, 2, 3, 9]),
  flower: SH({ front: 'open', fix: true, disp: 'flower', vm: 0 }, [5, 9, 1, 7]),
  yaoya: SH({ front: 'open', fix: true, disp: 'veg' }, [7, 2, 5, 3]),
  sakanaya: SH({ front: 'open', fix: true, disp: 'fish' }, [7, 2, 5, 1]),
  nikuya: SH({ front: 'glass', fix: true }, [7, 1, 5, 4]),
  sakaya: SH({ front: 'wood', vm: 2 }, [2, 7, 3, 8]),
  stationery: SH({ front: 'glass' }, [1, 7, 5, 4]),
  toy: SH({ front: 'glass', nob: 1 }, [1, 4, 7, 5]),
  bicycle: SH({ front: 'open', fix: true, bikes: 6, vm: 0 }, [7, 1, 5, 4]),
  furuhon: SH({ front: 'wood', disp: 'books', vm: 0 }, [7, 2, 3, 8]),
  shichiya: SH({ front: 'wood', vm: 0, aw: false }, [8, 2, 7, 1]),
  cleaning: SH({ front: 'glass', nob: 1 }, [1, 7, 5, 4]),
  zakka: SH({ front: 'glass', vm: 0 }, [9, 6, 4, 10, 5]),
  fashion: SH({ front: 'glass', vm: 0 }, [6, 1, 10, 4, 9]),
  konbini: 'b_konbini',
  drug: ['b_bigbox', { bikes: 4 }], dollar: ['b_bigbox', { bikes: 4 }], super: ['b_bigbox', { bikes: 8 }], bigsuper: ['b_bigbox', { deck: true, bikes: 8 }],
  kaden: ['b_bigbox', { deck: true }], homecenter: ['b_bigbox', { garden: true, pk: 0.35 }], dealer: ['b_bigbox', { show: true, pk: 0.3 }],
  famires: 'b_famires', kaitenzushi: ['b_famires', { wide: true, tall: true }], fastfood: ['b_famires', { drive: true }], yakiniku: ['b_famires', { duct: true, dark: true }],
  gas: 'b_gas',
  bizhotel: 'b_bizhotel', stahotel: 'b_bizhotel', capsule: ['b_bizhotel', { cap: true }],
  cityhotel: 'b_cityhotel', luxhotel: ['b_cityhotel', { lux: true }],
  resort: 'b_resort', oceanview: 'b_resort', condo: ['b_resort', { condo: true }],
  minshuku: 'b_minshuku', pension: 'b_pension', seaside: ['b_pension', { sea: true, looks: [3, 9, 1, 6, 4].map(i => PNL[i - 1]) }],
  guesthouse: ['b_minshuku', { looks: [10, 4, 1, 6, 9].map(i => MSL[i - 1]) }],
  ryokan: 'b_ryokan', onsenryokan: ['b_ryokan', { onsen: true }],
  cottage: 'b_cottage', uminoie: 'b_uminoie',
});
})();
