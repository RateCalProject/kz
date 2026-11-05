(function () {
'use strict';
/* ===== t64c 道路のファイル（map3d.js の m3Roads のかわり。window.M3ROAD）=====
   - 高速は高架（RC の橋脚・箱桁・高欄・町なかは防音壁・つぎめ）。縦断（pf・st）があれば それにしたがう（トンネルは描かない）
   - IC：トランペット型（ループ・料金所）／ダイヤモンド型（ランプに料金所）。となりの IC・JCT が近いときは 片がわだけ（ハーフ）
   - JCT：トランペット型（渡り線は 2階）・十字は クローバー型（ループ 4つ・外まわり 4つ。2つの高速は 1階と 2階）。
     高速の下は ふつうの道が通る（同じ高さで まじわらない）。Y 字の合流は 床をひとつに
   - 交差点：重なった道・近い交差点をまとめて 1つの面に（いびつな形にしない）
   - 地面の駅をよこぎる道は 跨線橋に（坂・擁壁・桁・高欄）。線路のファイル（M3RAIL）の grade：駅の中は レールの上から 6.5m あける。
     高速は 線路の上で 桁の下を 6.5m あける（足りなければ そこを高く）。踏切（xings）は 地面のまま（まわりに 電柱・街灯を立てない）
   - SA・PA の建物（kind が sa・pa）が高速のとなりにあれば、出入りのランプ
   バス：runY（高架の上を走る）・off（左の車線）
   X：map3d の m3X() ＋ { grp, segs, roads, sts, v, it, m3Roads, m3Props, m3RoadProf, m3RoadTex, m3SigTick } */
const U = 1 / 50;                 // 1m（マス）
const VIA_H = 10.5;               // 高速の高架：地面から路面まで（m）。2D の「地面から 10m（高架）」に合わせる
const VIA_MIN = 8.5;              // 高架の下の あきの最小（m。路面から地面まで）
const LV2 = 9.5;                  // JCT の渡り線：高速の路面から さらに上（m）
const RANK = { exp: 6, nat: 5, pref: 4, city: 3, priv: 2, lane: 1 };
let X, T3, M3, MQ, m3Surf, tileAt, pfZ, VEX, LIFT;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, sst = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hyp = Math.hypot;
const PROF = new Map();     // 線の id → 路面の高さの表（バスの runY 用。build のたびに）
const MAT = {};             // 使いまわす質感（keep）
const CHOICE = new Map();   // IC・JCT の形のえらび（node id → 形。カメラを動かしても かわらないように）
const M3_CURB = 0.15 * U, M3_MARK = 0.03 * U;
// 色
const C_SW = [0.74, 0.72, 0.68], C_CURB = [0.84, 0.84, 0.82], C_ASPH = [0.335, 0.347, 0.362], C_EMB = [0.50, 0.47, 0.42], C_WHITE = [0.95, 0.95, 0.93];
const C_RAIL = [0.86, 0.87, 0.87], C_PAR = [0.80, 0.80, 0.78], C_SOF = [0.60, 0.60, 0.60], C_GIR = [0.66, 0.66, 0.65], C_PIER = [0.70, 0.70, 0.69];
const C_NOISE = [0.66, 0.74, 0.76], C_MED = [0.82, 0.82, 0.80], C_GORE = [0.36, 0.37, 0.39], C_YEL = [0.93, 0.76, 0.18], C_DARK = [0.20, 0.21, 0.22];
const C_ISL = [0.80, 0.79, 0.75], C_CANOPY = [0.93, 0.93, 0.91], C_FASC = [0.27, 0.36, 0.48], C_BOOTH = [0.90, 0.90, 0.88], C_GLASS = [0.55, 0.66, 0.74];

/* ---------- 入れもの（まとめて 1つのメッシュに） ---------- */
function newG() { return { col: { P: [], C: [] }, colLo: { P: [], C: [] }, mark: { P: [], C: [] }, tex: new Map(), box: [], cyl: [], wire: [] }; }
const q4 = (B, a, b, c, d, col) => { B.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); for (let k = 0; k < 6; k++) B.C.push(col[0], col[1], col[2]); };
const t3 = (B, a, b, c, col) => { B.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (let k = 0; k < 3; k++) B.C.push(col[0], col[1], col[2]); };
// 路面の絵の帯：tx（{tex, W, P}）ごとに 位置と UV
function texBuf(G, tx, off) { const k = tx.key + '|' + (off || 0); let b = G.tex.get(k); if (!b) G.tex.set(k, b = { tx, off: off || -2, P: [], UV: [] }); return b; }
const tq = (B, a, b, c, d, ua, va, ub, vb, uc, vc, ud, vd) => { B.P.push(...a, ...b, ...c, ...a, ...c, ...d); B.UV.push(ua, va, ub, vb, uc, vc, ua, va, uc, vc, ud, vd); };
// 箱（InstancedMesh）：中心・大きさ・向き（y まわり）・色
const box = (G, x, y, z, sx, sy, sz, ry, col) => G.box.push(x, y, z, sx, sy, sz, ry, col[0], col[1], col[2]);
const cyl = (G, x, y, z, r, h, col) => G.cyl.push(x, y, z, r, h, col[0], col[1], col[2]);

/* ---------- 絵（路面）：高速・ランプ・取付道路。断面ごとに 1枚 ---------- */
const TEXC = new Map();
function texOf(key, W, P, draw) {
  let t = TEXC.get(key); if (t) return t;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const Xm = m => m / W * 512, Ym = m => m / P * 256;
  g.fillStyle = '#4d5054'; g.fillRect(0, 0, 512, 256);
  let r = 4242; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;   // アスファルトの つぶつぶ（いつも同じ）
  for (let i = 0; i < 3800; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.09)'; g.fillRect(rnd() * 512, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2); }
  const line = (x, w, col, d0, d1) => { g.fillStyle = col; g.fillRect(Xm(x - w / 2), d0 == null ? 0 : Ym(d0), Math.max(1.5, Xm(w)), d0 == null ? 256 : Ym(d1 - d0)); };
  draw(g, Xm, Ym, line);
  const tx = new T3.CanvasTexture(c); tx.wrapS = T3.ClampToEdgeWrapping; tx.wrapT = T3.RepeatWrapping;
  tx.anisotropy = Math.min(8, M3.r && M3.r.capabilities.getMaxAnisotropy ? M3.r.capabilities.getMaxAnisotropy() : 4);
  t = { key, tex: tx, W, P }; TEXC.set(key, t); return t;
}
const WL = 'rgba(244,244,240,.95)', YL = 'rgba(236,184,52,.95)';
// 高速の路面（はば Ws m・片がわ ln 車線）：中央分離帯 3m・右の路肩 0.75m・車線 3.5m・左の路肩（のこり）。車線の境は 8m の線・12m あける
function texExp(ln, Ws) {
  const med = 3;
  return texOf('E' + ln + ':' + Math.round(Ws), Ws, 20, (g, Xm, Ym, line) => {
    const cx = Ws / 2; g.fillStyle = '#8b8d8a'; g.fillRect(Xm(cx - med / 2), 0, Xm(med), 256);
    for (const sd of [-1, 1]) {
      const i0 = cx + sd * (med / 2 + 0.75); line(i0, 0.15, WL);
      for (let k = 1; k < ln; k++) line(i0 + sd * k * 3.5, 0.15, WL, 0, 8);
      line(i0 + sd * ln * 3.5, 0.2, WL);
    }
  });
}
// ランプ（1車線・はば 6.5m）・取付道路（2車線 9m・4車線 22m）
const texRamp = () => texOf('R1', 6.5, 10, (g, Xm, Ym, line) => { line(1.5, 0.15, WL); line(5.0, 0.15, WL); });
const texRamp2 = () => texOf('R2', 9.5, 10, (g, Xm, Ym, line) => { line(1.25, 0.15, WL); line(8.25, 0.15, WL); line(4.75, 0.15, WL, 0, 5); });
const texStem2 = () => texOf('S2', 9, 10, (g, Xm, Ym, line) => { line(4.3, 0.15, YL); line(4.7, 0.15, YL); line(1.0, 0.15, WL); line(8.0, 0.15, WL); });
const texStem4 = () => texOf('S4', 22, 10, (g, Xm, Ym, line) => { line(10.8, 0.15, YL); line(11.2, 0.15, YL); for (const sd of [-1, 1]) { line(11 + sd * 3.75, 0.15, WL, 0, 5); line(11 + sd * 7.4, 0.15, WL); } });
const texPlaza = () => texOf('PZ', 10, 10, (g) => {});

/* ---------- 質感（使いまわす） ---------- */
function lam(key, o) { let m = MAT[key]; if (!m) { m = MAT[key] = new T3.MeshLambertMaterial(o); m.keep = true; } return m; }
const offO = f => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });

/* ---------- 線の道具 ---------- */
// 実の線（道路）の長さの表
function qOf(s) {
  if (s._q && s._q.P === s.P) return s._q;
  const n = s.np, L = new Float32Array(n); for (let i = 1; i < n; i++) L[i] = L[i - 1] + hyp(s.P[2 * i] - s.P[2 * i - 2], s.P[2 * i + 1] - s.P[2 * i - 1]);
  return (s._q = { P: s.P, L, len: n > 1 ? L[n - 1] : 0 });
}
// 点の列（x,y,x,y…）と長さの表 → 線の上の sv の点 [x, y, tx, ty]
function ptAt(P, L, n, sv, o) {
  o = o || [0, 0, 0, 0];
  if (n < 2) { o[0] = P[0]; o[1] = P[1]; o[2] = 1; o[3] = 0; return o; }
  sv = clamp(sv, 0, L[n - 1]);
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= sv) lo = m; else hi = m; }
  let d = L[hi] - L[lo], dx = P[2 * hi] - P[2 * lo], dy = P[2 * hi + 1] - P[2 * lo + 1];
  const t = d > 1e-9 ? (sv - L[lo]) / d : 0; o[0] = P[2 * lo] + dx * t; o[1] = P[2 * lo + 1] + dy * t;
  if (d < 1e-9) { d = 1; dx = 1; dy = 0; }
  o[2] = dx / d; o[3] = dy / d; return o;
}
// 線（ランプ・取付道路など自分で作るもの）
let VID = 0;
function mkLine(pts, o) {
  const n = pts.length / 2, P = Float32Array.from(pts), L = new Float32Array(n);
  for (let i = 1; i < n; i++) L[i] = L[i - 1] + hyp(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
  const ln = Object.assign({ id: 'v' + (++VID), P, np: n, L, k: 'road', vir: true }, o);
  ln._q = { P, L, len: n > 1 ? L[n - 1] : 0 }; ln.len = ln._q.len;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P[2 * i], y = P[2 * i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  ln.bb = [x0, y0, x1, y1];
  return ln;
}
// 点をつないで道の形に（同じ点をのぞく）
function Path() { this.a = []; }
Path.prototype.add = function (x, y) { const a = this.a, n = a.length; if (n && hyp(a[n - 2] - x, a[n - 1] - y) < 1e-4) return this; a.push(x, y); return this; };
// 3次のベジェ：(x0,y0) を d0 の向きに出て、(x1,y1) へ d1 の向きで入る。k0・k1：取っ手の長さ（2点のあいだの何倍か）
Path.prototype.bez = function (x0, y0, dx0, dy0, x1, y1, dx1, dy1, k0, k1, st) {
  const L = hyp(x1 - x0, y1 - y0), a = (k0 == null ? 0.42 : k0) * L, b = (k1 == null ? 0.42 : k1) * L;
  const c1x = x0 + dx0 * a, c1y = y0 + dy0 * a, c2x = x1 - dx1 * b, c2y = y1 - dy1 * b, n = Math.max(2, Math.ceil(L * 1.5 / (st || 0.08)));
  for (let k = 0; k <= n; k++) { const t = k / n, u = 1 - t; this.add(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1); }
  return this;
};
// 円の弧（ワールドの中心・半径・角度 a0 → a1）
Path.prototype.arc = function (cx, cy, r, a0, a1, st) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / (st || 0.08)));
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; this.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  return this;
};
Path.prototype.pts = function (arr) { for (let i = 0; i < arr.length; i += 2) this.add(arr[i], arr[i + 1]); return this; };
// 点の列の向き（はじめ・おわり）
const headOf = (a, end) => { const n = a.length / 2; let i = end ? n - 1 : 0, j = end ? n - 2 : 1; while (j > 0 && j < n - 1 && hyp(a[2 * j] - a[2 * i], a[2 * j + 1] - a[2 * i + 1]) < 0.02) j += end ? -1 : 1; const dx = (a[2 * i] - a[2 * j]) * (end ? 1 : -1), dy = (a[2 * i + 1] - a[2 * j + 1]) * (end ? 1 : -1), L = hyp(dx, dy) || 1; return [dx / L, dy / L]; };
// 線の一部（s0..s1）の点の列。off：+横（右）へずらす（はじめ・おわりで ちがう値なら なめらかに）
function subPts(P, L, n, s0, s1, off0, off1, st, outS) {
  const out = [], o = [0, 0, 0, 0], len = L[n - 1]; s0 = clamp(s0, 0, len); s1 = clamp(s1, 0, len);
  const dir = s1 >= s0 ? 1 : -1, D = Math.abs(s1 - s0), m = Math.max(1, Math.ceil(D / (st || 0.1)));
  const ss = [];
  for (let k = 0; k <= m; k++) ss.push(s0 + (s1 - s0) * k / m);
  for (let i = 1; i < n - 1; i++) if ((L[i] - s0) * (L[i] - s1) < 0) ss.push(L[i]);
  ss.sort((a, b) => (a - b) * dir);
  for (const sv of ss) {
    ptAt(P, L, n, sv, o);
    // 角の点では、前後の向きの まん中（ずらしたときに ふくらまない）
    const f = D > 1e-9 ? Math.abs(sv - s0) / D : 0, off = off0 + (off1 - off0) * f;
    let tx = o[2], ty = o[3];
    const a = ptAt(P, L, n, sv - 0.05, [0, 0, 0, 0]), b = ptAt(P, L, n, sv + 0.05, [0, 0, 0, 0]);
    tx = a[2] + b[2]; ty = a[3] + b[3]; const tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl;
    out.push(o[0] - ty * off, o[1] + tx * off); if (outS) outS.push(sv);
  }
  return out;
}

/* ---------- 耳切り（多角形 → 三角） ---------- */
function earClip(pts) {
  const n = pts.length; if (n < 3) return [];
  let ar = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; ar += a[0] * b[1] - b[0] * a[1]; }
  const idx = []; for (let i = 0; i < n; i++) idx.push(i); if (ar < 0) idx.reverse();
  const out = [], inTri = (p, a, b, c) => { const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]), d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]), d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length], a = pts[i0], b = pts[i1], c = pts[i2];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-10) continue;
      let ok = true; for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inTri(pts[j], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      out.push(i0, i1, i2); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) return null;   // うまく切れない（ねじれた形）
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/* ---------- 高速の高さ（路面。ワールドの y）：縦断があれば それ、なければ 高架（地面から VIA_H m。なだらかに） ---------- */
const NODEH = new Map();   // 交点の高さ（となりあう線で同じに）
function nodeH(nid, x, y) {
  let h = NODEH.get(nid); if (h != null) return h;
  let m = 0, k = 0, g0 = m3Surf(x, y);
  for (const r of [0, 1.5, 3]) for (let a = 0; a < 8; a++) { if (!r && a) continue; const g = m3Surf(x + Math.cos(a * 0.785) * r, y + Math.sin(a * 0.785) * r); m += g; k++; }
  h = Math.max(m / k + VIA_H * U, g0 + VIA_MIN * U); NODEH.set(nid, h); return h;
}
const BUMP = new Map();   // build ごと：高速の線の id → [{ e（交点のがわ 0・1）, d0（交点からの長さ）, H（ワールド） }]（立体の交差：交点のまわりを 2階に）
const bumpShape = d => d <= 1.6 ? 1 : d >= 5.6 ? 0 : 1 - sst((d - 1.6) / 4);
function expProf(s) {
  if (s._ep && s._ep.tg === M3.tg && s._ep.P === s.P && s._ep.b === BUILD) return s._ep;
  const q = qOf(s), len = q.len, ds = 0.5, n = Math.max(2, Math.ceil(len / ds) + 1), Z = new Float32Array(n), C = new Uint8Array(n), G = new Float32Array(n);
  const o = [0, 0, 0, 0], hw = Math.max(0.2, (s.w || 0.56) / 2);
  for (let i = 0; i < n; i++) {
    const sv = Math.min(len, i * ds); ptAt(s.P, q.L, s.np, sv, o);
    G[i] = Math.max(m3Surf(o[0], o[1]), m3Surf(o[0] - o[3] * hw, o[1] + o[2] * hw), m3Surf(o[0] + o[3] * hw, o[1] - o[2] * hw));
  }
  if (s.pf && s.L) {
    const st = s.st || '';
    for (let i = 0; i < n; i++) {
      const sv = Math.min(len, i * ds), c = st[Math.min(st.length - 1, Math.max(0, Math.round(sv)))] || 'G', z = pfZ(s.pf, sv) * U * VEX;
      C[i] = c === 'V' ? 1 : c === 'B' ? 2 : c === 'T' ? 3 : 0; Z[i] = C[i] === 1 || C[i] === 2 ? z : C[i] === 3 ? z : Math.max(z, G[i]);
    }
  } else {
    // 地面の高いところ（±1マス）→ ならす（±4マス）→ 地面から VIA_H。どこでも VIA_MIN より下にしない
    const M = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = -Infinity; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) m = Math.max(m, G[j]); M[i] = m; }
    const K = 8; let acc = 0, cnt = 0; const A = new Float32Array(n);
    for (let j = 0; j <= Math.min(n - 1, K); j++) { acc += M[j]; cnt++; }
    for (let i = 0; i < n; i++) { A[i] = acc / cnt; const a = i - K, b = i + K + 1; if (a >= 0) { acc -= M[a]; cnt--; } if (b < n) { acc += M[b]; cnt++; } }
    for (let i = 0; i < n; i++) { Z[i] = Math.max(A[i] + VIA_H * U, G[i] + VIA_MIN * U); C[i] = 1; }
    // はしは 交点の高さに（となりの線と つながるように）
    const e0 = s.n0 != null ? nodeH(s.n0, s.P[0], s.P[1]) : null, e1 = s.n1 != null ? nodeH(s.n1, s.P[2 * s.np - 2], s.P[2 * s.np - 1]) : null;
    const z0 = Z[0], z1 = Z[n - 1], BL = Math.min(3, len * 0.45);
    for (let i = 0; i < n; i++) {
      const sv = Math.min(len, i * ds);
      if (e0 != null) Z[i] += (e0 - z0) * (1 - sst(sv / BL));
      if (e1 != null) Z[i] += (e1 - z1) * (1 - sst((len - sv) / BL));
      Z[i] = Math.max(Z[i], G[i] + (VIA_MIN - 1) * U);
    }
  }
  const bm = BUMP.get(s.id);
  if (bm) for (const k of bm) for (let i = 0; i < n; i++) { const sv = Math.min(len, i * ds), d = k.c != null ? Math.abs(sv - k.c) : k.d0 + (k.e ? len - sv : sv); Z[i] += k.H * (k.flat ? (d < 3 ? 1 - sst((d - 1) / 2) : 0) : bumpShape(d)); }
  return (s._ep = { tg: M3.tg, P: s.P, ds, n, Z, C, G, len, b: BUILD });
}
const epZ = (ep, sv) => { const f = clamp(sv / ep.ds, 0, ep.n - 1), i = Math.min(ep.n - 2, Math.floor(f)), t = f - i; return ep.Z[i] + (ep.Z[i + 1] - ep.Z[i]) * t; };
const epC = (ep, sv) => ep.C[clamp(Math.round(sv / ep.ds), 0, ep.n - 1)];

/* ---------- 構造物の帯（高速・ランプ・取付道路）：路面・高欄・防音壁・桁・擁壁・中央分離帯・橋脚 ----------
   ln：線（P・L・np）。a..b：描くところ（マス）。o：
     hw(s) → [+横の半はば, −横の半はば]（路面のはし。マス）・z(s) → 路面の高さ（ワールド）・c(s) → 0 地面 1 高架 2 橋 3 トンネル
     tx：路面の絵（{tex, W, P}。W は 絵の はば m）・cut(s, side) → true なら その がわの高欄を切る（ランプがつく）
     noise(s)：防音壁・med：中央分離帯・gd：桁の高さ（m）・pier：橋脚の間（マス）・pw：橋脚の型（'t' T型・'c' 丸柱）・step：分けかた（マス）
     gnd：地面の近くは 地形にそわせる（取付道路）・lo：遠いとき（あらく） */
function deck(G, ln, a, b, o) {
  const P = ln.P, L = ln.L || qOf(ln).L, n = ln.np, len = L[n - 1];
  a = clamp(a, 0, len); b = clamp(b, 0, len); if (b - a < 0.01) return;
  const step = o.step || 1, ss = [a];
  for (let i = 1; i < n - 1; i++) if (L[i] > a + 0.02 && L[i] < b - 0.02) ss.push(L[i]);
  if (o.brk) for (const v of o.brk) if (v > a + 0.02 && v < b - 0.02) ss.push(v);
  ss.push(b); ss.sort((p, q) => p - q);
  const S2 = [ss[0]];
  for (let i = 1; i < ss.length; i++) { const d = ss[i] - S2[S2.length - 1]; if (d < 0.01) continue; const m = Math.ceil(d / step); for (let k = 1; k <= m; k++) S2.push(S2[S2.length - 1] + (ss[i] - S2[S2.length - 1]) / (m - k + 1)); }
  const N = S2.length, pt = [0, 0, 0, 0], pa = [0, 0, 0, 0], pb = [0, 0, 0, 0];
  const R = [];
  for (let k = 0; k < N; k++) {
    const sv = S2[k]; ptAt(P, L, n, sv, pt); ptAt(P, L, n, sv - 0.04, pa); ptAt(P, L, n, sv + 0.04, pb);
    let tx = pa[2] + pb[2], ty = pa[3] + pb[3]; const tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, [hp, hm] = o.hw(sv), z = o.z(sv), c = o.c ? o.c(sv) : 1;
    const gP = m3Surf(pt[0] + nx * hp, pt[1] + ny * hp), gM = m3Surf(pt[0] - nx * hm, pt[1] - ny * hm), gC = m3Surf(pt[0], pt[1]);
    let zP = z, zM = z;
    if (o.gnd || c === 0) { zP = Math.max(z, gP + LIFT); zM = Math.max(z, gM + LIFT); }
    R.push({ sv, x: pt[0], y: pt[1], nx, ny, hp, hm, z, zP, zM, gP, gM, gC, c });
  }
  const tb = o.tx ? texBuf(G, o.tx, o.toff) : null, B = o.lo ? G.colLo : G.col, gd = (o.gd || 2.2) * U, ge = 0.5 * U, pw = 0.5 * U, ph = 1.1 * U;
  for (let k = 0; k < N - 1; k++) {
    const A = R[k], Bq = R[k + 1];
    if (A.c === 3 && Bq.c === 3) continue;   // トンネル
    const sm = (A.sv + Bq.sv) / 2;
    const AP = [A.x + A.nx * A.hp, A.zP, A.y + A.ny * A.hp], AM = [A.x - A.nx * A.hm, A.zM, A.y - A.ny * A.hm], BP = [Bq.x + Bq.nx * Bq.hp, Bq.zP, Bq.y + Bq.ny * Bq.hp], BM = [Bq.x - Bq.nx * Bq.hm, Bq.zM, Bq.y - Bq.ny * Bq.hm];
    // 路面
    if (tb) {
      const tw = o.tx.W * U, va = A.sv * 50 / o.tx.P, vb = Bq.sv * 50 / o.tx.P;
      const uP = (h) => 0.5 - h / tw, uM = (h) => 0.5 + h / tw;   // 絵のまん中が 線のまん中（はばが絵とちがうときは はしを切る・のばす）
      tq(tb, AP, BP, BM, AM, clamp(uP(A.hp), 0, 1), va, clamp(uP(Bq.hp), 0, 1), vb, clamp(uM(Bq.hm), 0, 1), vb, clamp(uM(A.hm), 0, 1), va);
    } else q4(B, AP, BP, BM, AM, o.sc || C_ASPH);
    // 中央分離帯（はば 60cm・高さ 90cm）
    if (o.med) {
      const w = 0.3 * U, h = 0.9 * U, mA = (A.zP + A.zM) / 2, mB = (Bq.zP + Bq.zM) / 2;
      const pA = [A.x + A.nx * w, mA, A.y + A.ny * w], mA2 = [A.x - A.nx * w, mA, A.y - A.ny * w], pB = [Bq.x + Bq.nx * w, mB, Bq.y + Bq.ny * w], mB2 = [Bq.x - Bq.nx * w, mB, Bq.y - Bq.ny * w];
      const up = (p, d) => [p[0], p[1] + d, p[2]];
      q4(B, pA, pB, up(pB, h), up(pA, h), C_MED); q4(B, mA2, mB2, up(mB2, h), up(mA2, h), C_MED); q4(B, up(pA, h), up(pB, h), up(mB2, h), up(mA2, h), C_MED);
    }
    // 両がわ：高欄（1.1m）・防音壁・外がわの面（桁のはし。低いところは 地面まで＝擁壁）
    for (const sd of [1, -1]) {
      const hA = sd > 0 ? A.hp : A.hm, hB = sd > 0 ? Bq.hp : Bq.hm, zA = sd > 0 ? A.zP : A.zM, zB = sd > 0 ? Bq.zP : Bq.zM, gA = sd > 0 ? A.gP : A.gM, gB = sd > 0 ? Bq.gP : Bq.gM;
      const cut = o.cut && o.cut(sm, sd), hi = Math.min(zA - gA, zB - gB), hiM = Math.max(zA - gA, zB - gB);
      const P0 = (h2, y2, R2) => [R2.x + sd * R2.nx * h2, y2, R2.y + sd * R2.ny * h2];
      if (hiM < 0.3 * U && (o.gnd || A.c === 0)) { if (o.rail) { q4(B, P0(hA - 0.2 * U, zA + 0.55 * U, A), P0(hB - 0.2 * U, zB + 0.55 * U, Bq), P0(hB - 0.2 * U, zB + 0.85 * U, Bq), P0(hA - 0.2 * U, zA + 0.85 * U, A), C_RAIL); } continue; }   // 地面：ガードレールだけ
      if (!cut) {
        // 高欄：内がわ・上・外がわ（外がわは 下の 外の面と 一続き）
        q4(B, P0(hA, zA, A), P0(hB, zB, Bq), P0(hB, zB + ph, Bq), P0(hA, zA + ph, A), C_PAR);
        q4(B, P0(hA, zA + ph, A), P0(hB, zB + ph, Bq), P0(hB + pw, zB + ph, Bq), P0(hA + pw, zA + ph, A), C_PAR);
        const nzA = o.noise && o.noise(A.sv), nzB = o.noise && o.noise(Bq.sv);
        if (nzA && nzB && !o.lo) q4(B, P0(hA + pw * 0.5, zA + ph, A), P0(hB + pw * 0.5, zB + ph, Bq), P0(hB + pw * 0.5, zB + ph + 3 * U, Bq), P0(hA + pw * 0.5, zA + ph + 3 * U, A), C_NOISE);
      }
      // 外がわの面：桁のはし（高いところ）・擁壁（低いところは 地面まで）
      const top = cut ? 0 : ph, yA = Math.max(gA - 0.02, zA - ge), yB = Math.max(gB - 0.02, zB - ge);
      if (zA + top > yA || zB + top > yB) q4(B, P0(hA + pw, yA, A), P0(hB + pw, yB, Bq), P0(hB + pw, zB + top, Bq), P0(hA + pw, zA + top, A), cut ? C_GIR : C_PAR);
      if (cut) continue;
      if (hi > ge + 0.3 * U) {
        // 床版の下（はしから 桁へ）
        const gw = o.gw != null ? o.gw : Math.max(0.3 * (hA + hB) / 2, Math.min((hA + hB) / 2 - 2.6 * U, (hA + hB) / 2 * 0.72));
        const gA2 = Math.max(gA, zA - gd), gB2 = Math.max(gB, zB - gd);
        q4(B, P0(gw, gA2 + 0.3 * U, A), P0(gw, gB2 + 0.3 * U, Bq), P0(hB + pw, zB - ge, Bq), P0(hA + pw, zA - ge, A), C_SOF);
        q4(B, P0(gw * 0.86, gA2, A), P0(gw * 0.86, gB2, Bq), P0(gw, gB2 + 0.3 * U, Bq), P0(gw, gA2 + 0.3 * U, A), C_GIR);
      }
    }
    // 桁の下の面
    const hiC = Math.min(A.z - A.gC, Bq.z - Bq.gC);
    if (hiC > gd + 0.3 * U && !o.noBot) {
      const gwA = o.gw != null ? o.gw : Math.max(0.3 * (A.hp + A.hm) / 2, Math.min((A.hp + A.hm) / 2 - 2.6 * U, (A.hp + A.hm) / 2 * 0.72)), gwB = o.gw != null ? o.gw : Math.max(0.3 * (Bq.hp + Bq.hm) / 2, Math.min((Bq.hp + Bq.hm) / 2 - 2.6 * U, (Bq.hp + Bq.hm) / 2 * 0.72));
      const P1 = (R2, sd, w) => [R2.x + sd * R2.nx * w, R2.z - gd, R2.y + sd * R2.ny * w];
      q4(B, P1(A, 1, gwA * 0.86), P1(Bq, 1, gwB * 0.86), P1(Bq, -1, gwB * 0.86), P1(A, -1, gwA * 0.86), C_SOF);
    }
  }
  // 橋脚（高いところ。pier マスごと。道・線路・建物の上はさける）
  if (o.pier && !o.noPier) {
    const sp = o.pier, k0 = Math.ceil((a + 0.2) / sp), k1 = Math.floor((b - 0.2) / sp);
    for (let k = k0; k <= k1; k++) {
      let sv = k * sp;
      if (o.cutPier && o.cutPier(sv)) continue;
      let r = pierAt(ln, sv, o); if (!r) { for (const dd of [0.25, -0.25, 0.45, -0.45]) { r = pierAt(ln, sv + dd, o); if (r) break; } }
      if (r) pierDraw(G, r, o);
      // つぎめ（伸縮継手）：路面を横ぎる黒い線
      if (r && o.joint) { const W2 = (r.hp + r.hm); mk4(G, r, -r.hm + 0.6 * U, r.hp - 0.6 * U, 0.25 * U, C_DARK); }
    }
  }
}
// 橋脚の場所（地面からの高さが足りる・下に 道・線路がない）
function pierAt(ln, sv, o) {
  const L = ln.L || qOf(ln).L, len = L[ln.np - 1]; if (sv < 0.05 || sv > len - 0.05) return null;
  const pt = ptAt(ln.P, L, ln.np, sv, [0, 0, 0, 0]), pa = ptAt(ln.P, L, ln.np, sv - 0.04, [0, 0, 0, 0]), pb = ptAt(ln.P, L, ln.np, sv + 0.04, [0, 0, 0, 0]);
  let tx = pa[2] + pb[2], ty = pa[3] + pb[3]; const tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl;
  const [hp, hm] = o.hw(sv), z = o.z(sv), c = o.c ? o.c(sv) : 1; if (c === 3 || c === 0) return null;
  const gC = m3Surf(pt[0], pt[1]); if (z - gC < (o.gd || 2.2) * U + 2.2 * U) return null;
  const gd = (o.gd || 2.2) * U, x = pt[0], y = pt[1], nx = -ty, ny = tx;
  // 柱のところに 道・線路があれば、門型（はしの 2本の柱）。それも だめなら やめる
  const W = hp + hm, wide = W > 0.5;
  let cols = W < 0.2 ? [0] : wide ? [-(W / 2) * 0.55, (W / 2) * 0.55] : [0];
  const mid = (hp - hm) / 2;
  cols = cols.map(c2 => c2 + mid);
  let type = 't';
  if (cols.some(c2 => OBS.hit(x + nx * c2, y + ny * c2, 0.05, ln.id))) {
    cols = [hp + 0.06, -hm - 0.06]; type = 'g';
    if (cols.some(c2 => OBS.hit(x + nx * c2, y + ny * c2, 0.04, ln.id))) return null;
  }
  const gs = cols.map(c2 => m3Surf(x + nx * c2, y + ny * c2));
  return { x, y, nx, ny, tx, ty, hp, hm, z, gd, cols, gs, type, sv };
}
function pierDraw(G, r, o) {
  const ang = Math.atan2(r.ty, r.tx), capH = 1.8 * U, capY = r.z - r.gd - capH / 2, W = r.hp + r.hm, mid = (r.hp - r.hm) / 2;
  const capL = r.type === 'g' ? W + 0.16 : Math.max(0.06, Math.min(W * 0.8, W - 0.06)), cw = W < 0.2 ? 1.6 * U : 2.4 * U, cd = W < 0.2 ? 1.6 * U : 2.2 * U;
  if (W >= 0.2 || r.type === 'g') box(G, r.x + r.nx * mid, capY, r.y + r.ny * mid, cd * 1.15, capH, capL, -ang, C_PIER);
  r.cols.forEach((c2, i) => {
    const g = r.gs[i], top = r.z - r.gd - (W >= 0.2 || r.type === 'g' ? capH : 0); if (top - g < 0.02) return;
    if (W < 0.2 && r.type !== 'g') cyl(G, r.x + r.nx * c2, (g + top) / 2 - 0.01, r.y + r.ny * c2, 1.0 * U, top - g + 0.02, C_PIER);
    else box(G, r.x + r.nx * c2, (g + top) / 2 - 0.01, r.y + r.ny * c2, cd, top - g + 0.02, cw * (r.type === 'g' ? 0.75 : 1), -ang, C_PIER);
  });
}
// 路面を横ぎる帯（つぎめ・停止線など）：r の点で、−hm..+hp、はば w（マス）
function mk4(G, r, h0, h1, w, col) {
  const y = r.z + M3_MARK * 0.5, P1 = (h, d) => [r.x + r.nx * h + r.tx * d, y, r.y + r.ny * h + r.ty * d];
  q4(G.mark, P1(h1, -w / 2), P1(h1, w / 2), P1(h0, w / 2), P1(h0, -w / 2), col);
}

/* ---------- じゃまもの（橋脚をよける）：地面の道・線路の帯。1マスの目 ---------- */
const OBS = {
  m: new Map(),
  clear() { this.m = new Map(); },
  add(P, n, hw, id) {   // 点の列（x,y…）・半はば・線の id（自分の橋脚は 自分をよけない）
    for (let i = 0; i < n - 1; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3];
      const x0 = Math.floor(Math.min(ax, bx) - hw), x1 = Math.floor(Math.max(ax, bx) + hw), y0 = Math.floor(Math.min(ay, by) - hw), y1 = Math.floor(Math.max(ay, by) + hw);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue;
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const k = gx * 73856093 ^ gy * 19349663; let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(ax, ay, bx, by, hw, id); }
    }
  },
  hit(x, y, r, id) {
    const a = this.m.get(Math.floor(x) * 73856093 ^ Math.floor(y) * 19349663); if (!a) return false;
    for (let i = 0; i < a.length; i += 6) {
      if (id != null && (a[i + 5] === id || (id instanceof Set && id.has(a[i + 5])))) continue;
      const ax = a[i], ay = a[i + 1], bx = a[i + 2], by = a[i + 3], hw = a[i + 4], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 > 1e-12 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
      if (hyp(x - ax - dx * t, y - ay - dy * t) < hw + r) return true;
    }
    return false;
  }
};
// 建物の区画（10m）のあるところ（IC の形をえらぶ）
function bldCells(it, x0, y0, x1, y1) {
  const out = new Set();
  for (const b of it.blds.values()) {
    if (!b.bb || b.bb[2] < x0 || b.bb[0] > x1 || b.bb[3] < y0 || b.bb[1] > y1) continue;
    if (b.kind === 'sa' || b.kind === 'pa') continue;
    for (const k of b.set) out.add(k);
  }
  return out;
}

/* ---------- 重なった線（同じ交点の あいだの 同じ形の道）：強いほうだけ ---------- */
const DUP = new Set();
function dedupe(roads) {
  DUP.clear();
  const by = new Map(), out = [];
  for (const s of roads) {
    if (s.n0 == null || s.n1 == null || s.c === 'exp') { out.push(s); continue; }
    const k = Math.min(s.n0, s.n1) + ':' + Math.max(s.n0, s.n1); let a = by.get(k); if (!a) by.set(k, a = []); a.push(s);
  }
  const mid = s => ptAt(s.P, qOf(s).L, s.np, qOf(s).len / 2, [0, 0, 0, 0]);
  for (const a of by.values()) {
    if (a.length === 1) { out.push(a[0]); continue; }
    a.sort((p, q) => (RANK[q.c] || 2) - (RANK[p.c] || 2) || (q.w || 0) - (p.w || 0) || p.id - q.id);
    const kept = [];
    for (const s of a) {
      const m = mid(s);
      if (kept.some(k => Math.abs(qOf(k).len - qOf(s).len) < 0.25 && hyp(mid(k)[0] - m[0], mid(k)[1] - m[1]) < 0.12)) { DUP.add(s.id); continue; }
      kept.push(s);
    }
    out.push(...kept);
  }
  return out;
}

/* ---------- ふつうの道（地面）：t64b の m3Roads をもとに。交差点は 近いものを まとめて 1つの面に（t64c） ---------- */
const HUMP = new Map();   // 跨線橋にする線（id → { zf(s), cf(s) }）
// 線の高さ：自分で作った線（zf）・跨線橋・縦断（pf）→ [z（なければ null）, つくり（G・V・B・T）]
function lnZ(s, sv) {
  const h = s.zf ? s : HUMP.get(s.id);
  if (h) return [h.zf(sv), h.cf ? h.cf(sv) : 'G'];
  if (s.pf && s.L) { const st = s.st || '', c = st[Math.min(st.length - 1, Math.max(0, Math.round(sv)))] || 'G'; return [pfZ(s.pf, sv) * U * VEX, c]; }
  return [null, 'G'];
}
// q の帯（はじめの 3.6 マス）を まっすぐな 3つの帯に
function bandOf(o) {
  if (o.band) return o.band;
  const q = qOf(o.s), len = q.len, P = o.s.P, n = o.s.np, out = [], at = d => ptAt(P, q.L, n, o.e ? len - d : d, [0, 0, 0, 0]);
  const ss = [0, 0.6, 1.6, 3.6].filter(d => d <= len + 1e-6); if (ss[ss.length - 1] < Math.min(3.6, len) - 0.05) ss.push(Math.min(3.6, len));
  let a = at(ss[0]);
  for (let i = 1; i < ss.length; i++) { const b = at(ss[i]), dx = b[0] - a[0], dy = b[1] - a[1], L = hyp(dx, dy); if (L > 1e-6) out.push({ ax: a[0], ay: a[1], dx: dx / L, dy: dy / L, L }); a = b; }
  return (o.band = out);
}
// 断面（中心 c・横 n・半はば h）が 帯（半はば hq）に かかるか
function hitBand(cx, cy, nx, ny, h, B, hq) {
  for (const k of B) {
    const pxA = cx + nx * h - k.ax, pyA = cy + ny * h - k.ay, pxB = cx - nx * h - k.ax, pyB = cy - ny * h - k.ay;
    const tA = pxA * k.dx + pyA * k.dy, wA = -pxA * k.dy + pyA * k.dx, tB = pxB * k.dx + pyB * k.dy, wB = -pxB * k.dy + pyB * k.dx;
    let lo = 0, hi = 1;
    if (Math.abs(wB - wA) < 1e-9) { if (Math.abs(wA) > hq) continue; }
    else { const l1 = (-hq - wA) / (wB - wA), l2 = (hq - wA) / (wB - wA); lo = Math.max(0, Math.min(l1, l2)); hi = Math.min(1, Math.max(l1, l2)); if (lo > hi) continue; }
    const t1 = tA + (tB - tA) * lo, t2 = tA + (tB - tA) * hi;
    if (Math.max(t1, t2) >= -0.005 && Math.min(t1, t2) <= k.L + 0.005) return true;
  }
  return false;
}
function ordinary(G, segs, F) {
  const { far, props, curbs, marks, wide, pnear, LIGHT, SIG, POLES } = F;
  const quad = (a, b, c, d, col) => q4(G.col, a, b, c, d, col), mark = (a, b, c, d, col) => q4(G.mark, a, b, c, d, col), tri = (a, b, c, col) => t3(G.col, a, b, c, col);
  const lenOf = s => qOf(s).len, codeAt = (s, sv) => lnZ(s, sv)[1];
  // 踏切（線路のファイルが描く）：まわりに 電柱・街灯を立てない
  const XGs = window.M3RAIL && !window.M3RAIL.fail && Array.isArray(window.M3RAIL.xings) ? window.M3RAIL.xings : [], XG = new Map();
  for (const h of XGs) { const k = Math.floor(h.x) * 7919 + Math.floor(h.y); let a = XG.get(k); if (!a) XG.set(k, a = []); a.push(h); }
  const nearX = (x, y) => { if (!XG.size) return false; for (let gx = Math.floor(x - 0.5); gx <= Math.floor(x + 0.5); gx++) for (let gy = Math.floor(y - 0.5); gy <= Math.floor(y + 0.5); gy++) { const a = XG.get(gx * 7919 + gy); if (a) for (const h of a) if (hyp(h.x - x, h.y - y) < 0.45) return true; } return false; };
  // 断面の高さ：点 (x, y)・線の上の sv・横向き (ux, uy)・つくり c・車道の半分 a・全体の半分 b（マス）
  //   → [車道の+横, 車道の−横, 歩道の外の+横, 歩道の外の−横, 地面（+横の外）, 地面（−横の外）, 地面（まん中）]
  const sect = (s, x, y, sv, ux, uy, c, a, b) => {
    const z = lnZ(s, sv)[0], up = c === 'V' || c === 'B';
    const at = o => { const g = m3Surf(x + ux * o, y + uy * o); return [(up ? z : z == null ? g : Math.max(z, g)) + LIFT, g]; };
    const L = at(a), R = at(-a), gC = m3Surf(x, y);
    if (b <= a + 1e-6) return [L[0], R[0], L[0], R[0], L[1], R[1], gC];
    const LO = at(b), RO = at(-b), cl = L[0] + M3_CURB, cr = R[0] + M3_CURB;
    return [L[0], R[0], up ? cl : Math.max(cl, LO[0]), up ? cr : Math.max(cr, RO[0]), LO[1], RO[1], gC];
  };
  const normals = s => {
    if (s._U && s._Ub === BUILD) return s._U;
    const P = s.P, n = s.np, U2 = new Float32Array(2 * n), dir = k => { const dx = P[2 * k + 2] - P[2 * k], dy = P[2 * k + 3] - P[2 * k + 1], L = hyp(dx, dy); return L < 1e-6 ? null : [-dy / L, dx / L]; };
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? dir(i - 1) : null, b = i < n - 1 ? dir(i) : null, u = a && b ? [a[0] + b[0], a[1] + b[1]] : (a || b); if (!u) continue;
      const L = hyp(u[0], u[1]); if (L < 1e-6) { const v = b || a; U2[2 * i] = v[0]; U2[2 * i + 1] = v[1]; continue; }
      const ux = u[0] / L, uy = u[1] / L, v = b || a, cs = Math.max(0.5, ux * v[0] + uy * v[1]); U2[2 * i] = ux / cs; U2[2 * i + 1] = uy / cs;
    }
    s._Ub = BUILD; return (s._U = U2);
  };
  const segAt = (s, sv) => {   // 線の上の sv（マス）の点と横向き
    const P = s.P, n = s.np, U2 = normals(s), L = qOf(s).L; sv = clamp(sv, 0, L[n - 1]);
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= sv) lo = m; else hi = m; }
    const D = L[hi] - L[lo], t = D > 1e-9 ? (sv - L[lo]) / D : 0;
    return { x: P[2 * lo] + (P[2 * hi] - P[2 * lo]) * t, y: P[2 * lo + 1] + (P[2 * hi + 1] - P[2 * lo + 1]) * t, ux: U2[2 * lo] + (U2[2 * hi] - U2[2 * lo]) * t, uy: U2[2 * lo + 1] + (U2[2 * hi + 1] - U2[2 * lo + 1]) * t };
  };
  // はし（交差点・つぎめ）
  const ends = new Map();
  for (const s of segs) {
    if (s.np < 2) continue;
    s._prof = s.prof0 || X.m3RoadProf(s);
    const q = qOf(s), len = q.len;
    for (const e of [0, 1]) {
      const nid = e ? s.n1 : s.n0; if (nid == null) continue;
      const P = s.P, n = s.np, i0 = e ? n - 1 : 0, dd = Math.min(0.4, len * 0.3), pt = ptAt(P, q.L, n, e ? len - dd : dd, [0, 0, 0, 0]);
      const dx = pt[0] - P[2 * i0], dy = pt[1] - P[2 * i0 + 1], L = hyp(dx, dy); if (L < 1e-6) continue;
      let a = ends.get(nid); if (!a) ends.set(nid, a = []);
      a.push({ s, e, d: [dx / L, dy / L], x: P[2 * i0], y: P[2 * i0 + 1], c: codeAt(s, e ? len : 0), p: s._prof, len, nid, pri: (RANK[s.c] || 2) * 100 + s._prof.W + (s.ow ? -50 : 0) });
    }
  }
  const trim = new Map(), inner = new Set(), INT = [];
  // 近い交差点（短い道でつながる）をまとめる
  const jn = [...ends.entries()].filter(([, a]) => a.length >= 3 && a.every(o => o.c === 'G'));
  const par = new Map(), box2 = new Map(), rad = new Map();
  const find = k => { let r = k; while (par.get(r) !== r) r = par.get(r); return r; };
  for (const [nid, a] of jn) { par.set(nid, nid); box2.set(nid, [a[0].x, a[0].y, a[0].x, a[0].y]); let m = 0; for (const o of a) m = Math.max(m, o.p.W / 100); rad.set(nid, m * 1.5 + 0.12); }
  if (!far) for (const s of segs) {   // 遠いときは まとめない（見えない。速く）
    if (s.n0 == null || s.n1 == null || s.n0 === s.n1 || !par.has(s.n0) || !par.has(s.n1)) continue;
    if (lenOf(s) > rad.get(s.n0) + rad.get(s.n1)) continue;
    const ra = find(s.n0), rb = find(s.n1); if (ra === rb) { inner.add(s); continue; }
    const A = box2.get(ra), B = box2.get(rb), C = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
    if (hyp(C[2] - C[0], C[3] - C[1]) > 2.5) continue;   // まとめすぎない
    par.set(rb, ra); box2.set(ra, C); inner.add(s);
  }
  // 同じまとまりの 2つの交点を むすぶ線（まわり道でつながる 短い線）も 中に
  if (!far) for (const s of segs) if (s.n0 != null && s.n1 != null && par.has(s.n0) && par.has(s.n1) && find(s.n0) === find(s.n1) && s.n0 !== s.n1 && lenOf(s) < 3) inner.add(s);
  const CL = new Map();
  for (const [nid, a] of jn) { const r = find(nid); let c = CL.get(r); if (!c) CL.set(r, c = { nodes: [], ends: [] }); c.nodes.push(a[0]); for (const o of a) if (!inner.has(o.s)) c.ends.push(o); }
  const isJ = nid => par.has(nid);
  // つぎめ（2本）：となりの線と横向きを そろえる
  for (const [nid, a] of ends) {
    if (a.length !== 2 || isJ(nid) || a[0].c !== 'G' || a[1].c !== 'G') continue;
    const tA = [-a[0].d[0], -a[0].d[1]], tB = a[1].d, rA = [-tA[1], tA[0]], rB = [-tB[1], tB[0]], m = [rA[0] + rB[0], rA[1] + rB[1]], L = hyp(m[0], m[1]);
    if (L > 1e-6) {
      const ux = m[0] / L, uy = m[1] / L, cs = Math.max(0.5, ux * rA[0] + uy * rA[1]), M = [ux / cs, uy / cs];
      for (const [o, f] of [[a[0], a[0].e ? 1 : -1], [a[1], a[1].e ? -1 : 1]]) { const U2 = normals(o.s), i = o.e ? o.s.np - 1 : 0; U2[2 * i] = M[0] * f; U2[2 * i + 1] = M[1] * f; }
    }
  }
  // 交差点：まとめた交点ごと。切り口は ほかの道の帯と重ならなくなるところ
  for (const c of CL.values()) {
    const E = c.ends; if (E.length < 3 && !(E.length === 2 && c.nodes.length > 1)) continue;
    let cx = 0, cy = 0; for (const o of c.nodes) { cx += o.x; cy += o.y; } cx /= c.nodes.length; cy /= c.nodes.length;
    for (const o of E) { o.band = null; o.sub = null; o.hb = o.p.W / 100 + 0.01; }
    // 重なって出ていく道（18° より小さい）：弱いほうは 強いほうの わきから（交差点の面に入れない）
    for (const o of E) for (const q of E) { if (o === q || q.sub === o) continue; if (o.d[0] * q.d[0] + o.d[1] * q.d[1] > 0.95 && (q.pri > o.pri || (q.pri === o.pri && String(q.s.id) < String(o.s.id)))) o.sub = q; }
    if (far && c.nodes.length === 1) {   // 遠い・1つの交点：前と同じ かんたんな式（速い）
      for (const o of E) {
        let r = o.p.W / 100;
        for (const q of E) { if (q === o) continue; const sn = Math.abs(o.d[0] * q.d[1] - o.d[1] * q.d[0]), cs = Math.abs(o.d[0] * q.d[0] + o.d[1] * q.d[1]); if (sn < 0.25) continue; r = Math.max(r, (q.p.W / 100 + o.p.W / 100 * cs) / sn); }
        o.r = Math.min(r + 0.01, o.len * 0.45); o.sub = null;
        const t = trim.get(o.s) || [0, 0]; t[o.e] = Math.max(t[o.e], o.r); trim.set(o.s, t);
      }
      INT.push({ a: E, cx, cy, n: E.length }); continue;
    }
    for (const o of E) {
      const oth = o.e ? o.s.n0 : o.s.n1, smax = Math.min(3.5, o.len * (oth != null && isJ(oth) ? 0.48 : 0.85));
      let r = 0;
      for (const q of E) {
        if (q === o || (q.sub && q.sub !== o && !o.sub) || q.sub === o) continue;
        const B = bandOf(q), f = o.e ? -1 : 1;
        const hit = sv => { const E2 = segAt(o.s, o.e ? o.len - sv : sv), nl = hyp(E2.ux, E2.uy) || 1; return hitBand(E2.x, E2.y, E2.ux / nl * f, E2.uy / nl * f, o.hb, B, q.hb); };
        // うしろから あらく（0.25）→ 重なるところの先を こまかく（0.05）
        for (let sv = smax; sv >= r - 1e-6; sv -= 0.25) {
          if (!hit(sv)) continue;
          let top = Math.min(smax, sv + 0.25); for (let t = sv + 0.05; t < top; t += 0.05) if (!hit(t)) { top = t; break; }
          r = Math.max(r, Math.min(top, smax)); break;
        }
      }
      o.r = Math.min(r + 0.01, smax, o.s.ramp ? 1.1 : Infinity);
      if (o.sub && o.r >= smax - 0.01) o.r = Math.min(o.len * 0.98, Math.max(o.r, 0));
      const t = trim.get(o.s) || [0, 0]; t[o.e] = Math.max(t[o.e], o.r); trim.set(o.s, t);
    }
    const R = E.filter(o => !o.sub);
    if (R.length >= 2) INT.push({ a: R, cx, cy, n: E.length });
  }
  // 道の帯（車道・歩道・縁石・盛土・高欄・橋脚・街灯・電柱）
  const piece = (s, p, x0, y0, s0, ux0, uy0, x1, y1, s1, ux1, uy1, c, A, B, dep, tx, a, b) => {
    if (dep < 3 && c !== 'V' && c !== 'B' && hyp(x1 - x0, y1 - y0) > 0.12) {
      const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, sm = (s0 + s1) / 2, uxm = (ux0 + ux1) / 2, uym = (uy0 + uy1) / 2, Mh = sect(s, xm, ym, sm, uxm, uym, c, a, b);
      if ([0, 1, 2, 3].some(k => Math.abs(Mh[k] - (A[k] + B[k]) / 2) > 0.006)) {
        piece(s, p, x0, y0, s0, ux0, uy0, xm, ym, sm, uxm, uym, c, A, Mh, dep + 1, tx, a, b); piece(s, p, xm, ym, sm, uxm, uym, x1, y1, s1, ux1, uy1, c, Mh, B, dep + 1, tx, a, b); return;
      }
    }
    const v0 = s0 * 50 / p.P, v1 = s1 * 50 / p.P;
    const L0 = [x0 + ux0 * a, A[0], y0 + uy0 * a], L1 = [x1 + ux1 * a, B[0], y1 + uy1 * a], R1 = [x1 - ux1 * a, B[1], y1 - uy1 * a], R0 = [x0 - ux0 * a, A[1], y0 - uy0 * a];
    tq(tx, L0, L1, R1, R0, 0, v0, 0, v1, 1, v1, 1, v0);   // 車道（路面の絵）
    if (b > a) {   // 歩道と縁石
      quad([x0 + ux0 * b, A[2], y0 + uy0 * b], [x1 + ux1 * b, B[2], y1 + uy1 * b], [L1[0], B[0] + M3_CURB, L1[2]], [L0[0], A[0] + M3_CURB, L0[2]], C_SW);
      quad([R0[0], A[1] + M3_CURB, R0[2]], [R1[0], B[1] + M3_CURB, R1[2]], [x1 - ux1 * b, B[3], y1 - uy1 * b], [x0 - ux0 * b, A[3], y0 - uy0 * b], C_SW);
      if (curbs) { quad(L0, L1, [L1[0], B[0] + M3_CURB, L1[2]], [L0[0], A[0] + M3_CURB, L0[2]], C_CURB); quad(R0, R1, [R1[0], B[1] + M3_CURB, R1[2]], [R0[0], A[1] + M3_CURB, R0[2]], C_CURB); }
    }
    const oL = b > a ? 2 : 0, oR = b > a ? 3 : 1, up = c === 'V' || c === 'B';
    const eL0 = [x0 + ux0 * b, A[oL], y0 + uy0 * b], eL1 = [x1 + ux1 * b, B[oL], y1 + uy1 * b], eR0 = [x0 - ux0 * b, A[oR], y0 - uy0 * b], eR1 = [x1 - ux1 * b, B[oR], y1 - uy1 * b];
    const lift = (e, h) => [e[0], e[1] + h, e[2]], wall = (e0, e1, h0, h1, col) => quad(lift(e0, h0), lift(e1, h0), lift(e1, h1), lift(e0, h1), col);
    const m = U, hump = HUMP.has(s.id) || s.zf;
    if (!up) {   // 盛土（地面の区間で、まわりより 1m 以上 高い）：いちばん外のはしから地面まで（跨線橋の坂は コンクリートの擁壁）
      const ec = hump ? C_PAR : C_EMB;
      if (A[oL] - LIFT - A[4] > 0.02 || B[oL] - LIFT - B[4] > 0.02) quad([eL0[0], A[4] - 0.006, eL0[2]], [eL1[0], B[4] - 0.006, eL1[2]], eL1, eL0, ec);
      if (A[oR] - LIFT - A[5] > 0.02 || B[oR] - LIFT - B[5] > 0.02) quad([eR0[0], A[5] - 0.006, eR0[2]], [eR1[0], B[5] - 0.006, eR1[2]], eR1, eR0, ec);
      if (hump && wide && (A[oL] - LIFT - A[4] > 0.03 || B[oL] - LIFT - B[4] > 0.03)) { wall(eL0, eL1, 0, 1.1 * m, C_PAR); wall(eR0, eR1, 0, 1.1 * m, C_PAR); }
    } else {   // 高架・橋：床版の下（桁）
      const zb0 = Math.min(A[oL], A[oR]) - 1.6 * m, zb1 = Math.min(B[oL], B[oR]) - 1.6 * m;
      if (zb0 > A[6] + 0.01 && zb1 > B[6] + 0.01) {
        quad([eL0[0], zb0, eL0[2]], [eL1[0], zb1, eL1[2]], [eR1[0], zb1, eR1[2]], [eR0[0], zb0, eR0[2]], C_SOF);
        quad([eL0[0], zb0, eL0[2]], [eL1[0], zb1, eL1[2]], eL1, eL0, C_PAR); quad([eR0[0], zb0, eR0[2]], [eR1[0], zb1, eR1[2]], eR1, eR0, C_PAR);
      }
    }
    if (!wide) return;
    if (up) { wall(eL0, eL1, 0, 1.1 * m, C_PAR); wall(eR0, eR1, 0, 1.1 * m, C_PAR); }   // 高架・橋の高欄（コンクリートのかべ）
    else if (!hump && A[oL] - LIFT - A[4] > 0.04) {   // 高い盛土：ガードレール
      const gi = (e0, e1, sd) => [[e0[0] - sd * ux0 * 0.4 * m, e0[1], e0[2] - sd * uy0 * 0.4 * m], [e1[0] - sd * ux1 * 0.4 * m, e1[1], e1[2] - sd * uy1 * 0.4 * m]];
      for (const [e0, e1, sd] of [[eL0, eL1, 1], [eR0, eR1, -1]]) { const [g0, g1] = gi(e0, e1, sd); wall(g0, g1, 0.55 * m, 0.85 * m, C_RAIL); }
    }
  };
  for (const s of segs) {
    if (s.np < 2 || inner.has(s) || s.deckDraw) continue;
    const p = s._prof, b = p.W / 100, a = far ? b : p.cw / 100, tr = trim.get(s) || [0, 0], len = lenOf(s), lo = tr[0] + (s.cut0 || 0), hi = len - tr[1] - (s.cut1 || 0);
    if (hi - lo < 0.01) continue;
    const tx = texBuf(G, s.texq ? s.texq() : ordTex(p, far), s.c === 'exp' ? -1 : -3);
    const P = s.P, U2 = normals(s), L = qOf(s).L, PL = []; let nextPier = lo + 0.4, nextLight = lo + 0.3, side = 1, nextPole = lo + 0.25;
    for (let i = 0; i < s.np - 1; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], D = hyp(bx - ax, by - ay); if (D < 1e-6) continue;
      const L0 = L[i];
      if (L0 + D <= lo || L0 >= hi) continue;
      const m = Math.max(1, Math.ceil(D));
      for (let q = 0; q < m; q++) {
        let t0 = q / m, t1 = (q + 1) / m; const sa = L0 + D * t0, sb = L0 + D * t1;
        if (sb <= lo || sa >= hi) continue;
        if (sa < lo) t0 = (lo - L0) / D; if (sb > hi) t1 = (hi - L0) / D;
        const s0 = L0 + D * t0, s1 = L0 + D * t1, c = codeAt(s, (s0 + s1) / 2); if (c === 'T') continue;
        const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
        const ux0 = U2[2 * i] + (U2[2 * i + 2] - U2[2 * i]) * t0, uy0 = U2[2 * i + 1] + (U2[2 * i + 3] - U2[2 * i + 1]) * t0, ux1 = U2[2 * i] + (U2[2 * i + 2] - U2[2 * i]) * t1, uy1 = U2[2 * i + 1] + (U2[2 * i + 3] - U2[2 * i + 1]) * t1;
        const A = sect(s, x0, y0, s0, ux0, uy0, c, a, b), B = sect(s, x1, y1, s1, ux1, uy1, c, a, b);
        piece(s, p, x0, y0, s0, ux0, uy0, x1, y1, s1, ux1, uy1, c, A, B, 0, tx, a, b);
        if ((c === 'V' || c === 'B') && s0 >= nextPier && Math.min(A[0], A[1]) - LIFT > A[6] + 4 * U) {   // 高架・橋の 橋脚（線路・道の上は さける）
          const top = Math.min(A[0], A[1]) - LIFT - 1.6 * U, g = A[6], ang = Math.atan2(uy0, ux0), wd = b * 2;
          if (!OBS.hit(x0, y0, 0.03, s.id)) { box(G, x0, (g + top) / 2, y0, 1.6 * U, top - g, Math.min(wd * 0.5, 6 * U), -ang + Math.PI / 2, C_PIER); nextPier = s0 + 0.7; }
        }
        // 街灯（歩道のある道。30m ごと・左右かわりばんこ。アームは道のまん中へ）
        while (props && p.sw > 0 && c === 'G' && nextLight < s1) {
          if (nextLight >= s0 && pnear(x0, y0) && !nearX(x0, y0)) {
            const f = (nextLight - s0) / Math.max(1e-6, s1 - s0), x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, ux = ux0 + (ux1 - ux0) * f, uy = uy0 + (uy1 - uy0) * f;
            const o = side * (b - 0.6 / 50), h = (side > 0 ? A[2] + (B[2] - A[2]) * f : A[3] + (B[3] - A[3]) * f);
            LIGHT.push([x + ux * o, h, y + uy * o, Math.atan2(-side * uy, -side * ux)]);
          }
          nextLight += 0.6; side = -side;
        }
        // 電柱（t65）：高速と 大きい道（片がわ2車線以上）をのぞく 地面の道。35m ごと・片がわ（+横）。電線で となりと つなぐ
        while (props && !p.exp && !s.vir && (p.ln || 0) <= 1 && c === 'G' && A[0] - LIFT - A[6] < 0.6 * U && nextPole < s1) {
          if (nextPole >= s0 && pnear(x0, y0) && !nearX(x0, y0)) {
            const f = (nextPole - s0) / Math.max(1e-6, s1 - s0), x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, ux = ux0 + (ux1 - ux0) * f, uy = uy0 + (uy1 - uy0) * f;
            const o = b - (p.sw > 0 ? 0.45 : 0.3) / 50, h = A[2] + (B[2] - A[2]) * f;
            PL.push([x + ux * o, h, y + uy * o, ux, uy]);
          } else PL.push(null);
          nextPole += 0.7;
        }
      }
    }
    if (PL.some(Boolean)) POLES.push(PL);
  }
  // 交差点：路面（白線なし）・歩道の角（まるい縁石）・横断歩道・停止線・信号
  const bez = (A, C, B, t) => [(1 - t) * (1 - t) * A[0] + 2 * t * (1 - t) * C[0] + t * t * B[0], (1 - t) * (1 - t) * A[1] + 2 * t * (1 - t) * C[1] + t * t * B[1]];
  const meet = (P1, d1, P2, d2) => { const cr = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(cr) < 0.15) return null; const t = ((P2[0] - P1[0]) * d2[1] - (P2[1] - P1[1]) * d2[0]) / cr; return t < 0.02 && t > -3 ? [P1[0] + d1[0] * t, P1[1] + d1[1] * t] : null; };
  for (const J of INT) {
    const a = J.a, big = a.filter(o => o.p.ln >= 1).length, sig = big >= 2 && J.n >= 3 && !a.some(o => o.s.noSig), mx = Math.max(...a.map(o => o.p.ln));
    for (const o of a) {
      const len = o.len, sv = o.e ? len - o.r : o.r, E = segAt(o.s, sv), f = o.e ? -1 : 1, A = sect(o.s, E.x, E.y, sv, E.ux, E.uy, 'G', far ? o.p.W / 100 : o.p.cw / 100, o.p.W / 100);
      const cb = o.p.W / 100, ca = far ? cb : o.p.cw / 100, ux = E.ux * f, uy = E.uy * f;
      o.L = [E.x + ux * ca, E.y + uy * ca, f > 0 ? A[0] : A[1]]; o.R = [E.x - ux * ca, E.y - uy * ca, f > 0 ? A[1] : A[0]];
      o.LO = [E.x + ux * cb, E.y + uy * cb, f > 0 ? A[2] : A[3]]; o.RO = [E.x - ux * cb, E.y - uy * cb, f > 0 ? A[3] : A[2]];
      o.sv = sv; o.f = f; o.ang = Math.atan2(E.y - J.cy, E.x - J.cx);
      // 出ていく向き（切り口のところ）
      const nl = hyp(E.ux, E.uy) || 1; o.dd = [uy / nl, -ux / nl];
      if (o.dd[0] * o.d[0] + o.dd[1] * o.d[1] < 0) o.dd = [-o.dd[0], -o.dd[1]];
    }
    a.sort((p, q) => p.ang - q.ang);
    const ring = [];   // 交差点の路面のふち（外向きの角の順）
    for (let k = 0; k < a.length; k++) {
      const o = a[k], q = a[(k + 1) % a.length];
      ring.push(o.R, o.L);
      const C = !far && o.p.sw > 0 && q.p.sw > 0 && a.length >= 2 ? meet(o.L, o.dd, q.R, q.dd) : null;
      if (C) {   // まるい縁石：o の左のはし → q の右のはし
        const CO = meet(o.LO, o.dd, q.RO, q.dd) || C, N = 6, inr = [], out = [];
        for (let i = 0; i <= N; i++) { const t = i / N, P2 = bez(o.L, C, q.R, t), Q2 = bez(o.LO, CO, q.RO, t), h = o.L[2] + (q.R[2] - o.L[2]) * t; inr.push([P2[0], h, P2[1]]); out.push([Q2[0], Math.max(h + M3_CURB, m3Surf(Q2[0], Q2[1]) + LIFT), Q2[1]]); }
        for (let i = 1; i < N; i++) ring.push([inr[i][0], inr[i][2], inr[i][1]]);
        for (let i = 0; i < N; i++) {
          const i0 = inr[i], i1 = inr[i + 1];
          quad(out[i], out[i + 1], [i1[0], i1[1] + M3_CURB, i1[2]], [i0[0], i0[1] + M3_CURB, i0[2]], C_SW);
          if (curbs) quad(i0, i1, [i1[0], i1[1] + M3_CURB, i1[2]], [i0[0], i0[1] + M3_CURB, i0[2]], C_CURB);
        }
      }
    }
    // 路面：耳切りで三角に（うまくいかなければ まん中から扇に）
    const tris = earClip(ring.map(r => [r[0], r[1]]));
    if (tris) for (let k = 0; k < tris.length; k += 3) { const p0 = ring[tris[k]], p1 = ring[tris[k + 1]], p2 = ring[tris[k + 2]]; tri([p0[0], p0[2], p0[1]], [p2[0], p2[2], p2[1]], [p1[0], p1[2], p1[1]], C_ASPH); }
    else {
      const hc = ring.reduce((u, r) => u + r[2], 0) / ring.length, cx = ring.reduce((u, r) => u + r[0], 0) / ring.length, cy = ring.reduce((u, r) => u + r[1], 0) / ring.length;
      for (let k = 0; k < ring.length; k++) { const r0 = ring[k], r1 = ring[(k + 1) % ring.length]; tri([cx, hc, cy], [r1[0], r1[2], r1[1]], [r0[0], r0[2], r0[1]], C_ASPH); }
    }
    // 横断歩道（信号のある交差点の、歩道のある道）・停止線（入ってくる車線：外向き d の +横）
    for (const o of a) {
      const ca = o.p.cw / 100, len = o.len, cw = o.p.sw > 0 && sig, at = dist => {
        const sv = o.e ? len - dist : dist; if (sv < 0 || sv > len) return null;
        const E = segAt(o.s, sv), A = sect(o.s, E.x, E.y, sv, E.ux, E.uy, 'G', ca, ca);
        return { x: E.x, y: E.y, ux: E.ux * o.f, uy: E.uy * o.f, hl: o.f > 0 ? A[0] : A[1], hr: o.f > 0 ? A[1] : A[0] };
      };
      const pt = (E, off) => { const f = (off + ca) / (2 * ca); return [E.x + E.ux * off, E.hr + (E.hl - E.hr) * f + M3_MARK, E.y + E.uy * off]; };
      const r = o.r, m = U, inc = o.s.ow ? ((o.s.ow > 0) === (o.e === 1)) : true;   // 一方通行（ランプ）：入ってくるほうだけ
      if (marks && cw && r + 5 * m < len * 0.6) {   // しま（はば 45cm・あいだ 45cm・長さ 4m）
        const E0 = at(r + 0.5 * m), E1 = at(r + 4.5 * m);
        if (E0 && E1) for (let off = -ca + 0.3 * m; off + 0.45 * m <= ca - 0.3 * m; off += 0.9 * m) mark(pt(E0, off), pt(E1, off), pt(E1, off + 0.45 * m), pt(E0, off + 0.45 * m), C_WHITE);
      }
      if (marks && o.p.ln >= 1 && inc && (sig || o.p.ln < mx)) {   // 停止線（信号のある交差点・せまいほうの道）
        const d0 = r + (cw ? 5.7 : 1.2) * m, w0 = o.s.ow ? -ca + 0.5 * m : 0.3 * m;
        if (d0 + m < len * 0.6) { const E0 = at(d0), E1 = at(d0 + 0.45 * m); if (E0 && E1) mark(pt(E0, w0), pt(E1, w0), pt(E1, ca - 0.5 * m), pt(E0, ca - 0.5 * m), C_WHITE); }
      }
      // 信号（入ってくる車の左の角。アームは車線の上へ・灯は外を向く）
      if (props && sig && o.p.ln >= 1 && inc && pnear(o.x, o.y)) {
        const E = at(r + 1.0 * m); if (E) {
          const off = ca + Math.max(0.5, o.p.sw * 0.5) * m, base = pt(E, Math.min(off, ca))[1] + M3_CURB;
          SIG.push({ x: E.x + E.ux * off, y: E.y + E.uy * off, h: base, ux: E.ux, uy: E.uy, d: o.d, arm: Math.max(2.5, o.p.ln * o.p.lw * 0.8 + o.p.sw * 0.5) * m, grp: Math.abs(Math.sin(o.ang - a[0].ang)) > 0.7 ? 1 : 0 });
        }
      }
    }
  }
  return { trim, inner };
}
const ordTex = (p, far) => { const t = X.m3RoadTex(T3, p, far); return { key: 'o:' + p.key + (far ? ':f' : ''), tex: t, W: p.W, P: p.P }; };

/* ---------- 高速（高架の帯） ---------- */
const CUTS = new Map();   // 線の id → [[s0, s1, 横（+1・−1）]]（高欄を切る：ランプがつく）
const cutAt = (s, sv, sd) => { const a = CUTS.get(s.id); if (!a) return false; for (const c of a) if (c[2] === sd && sv >= c[0] && sv <= c[1]) return true; return false; };
function noiseAt(x, y, nx, ny, hw) {   // 防音壁：わきが 住宅の用途地域
  for (const sd of [1, -1]) { const t = tileAt(Math.floor(x + nx * sd * (hw + 0.6)), Math.floor(y + ny * sd * (hw + 0.6))); if (t && 'abcdk'.includes(t.z || '-')) return true; }
  return false;
}
function drawExp(G, s, R2) {
  const ep = expProf(s), q = qOf(s), len = q.len, W = Math.max(0.4, s.w || 0.56), ln = Math.max(1, s.l || 2), hwS = W / 2 - 0.5 * U;
  const tx = texExp(ln, hwS * 2 * 50), v = X.v, mg = 10, lv = Number(MQ.d3) || 0;
  PROF.set(s.id, { ep, ln, W });
  const inD = (x, y) => x >= v.x0 - mg && x <= v.x1 + mg && y >= v.y0 - mg && y <= v.y1 + mg, inR = (x, y) => hyp(x - M3.tx, y - M3.ty) < R2;
  // 1マスごとに：くわしく（近いはんい）・あらく（遠い）・描かない
  const runs = [], o = [0, 0, 0, 0], et = ETRIM.get(s.id) || [0, 0], e0 = et[0], e1 = len - et[1];
  if (e1 - e0 < 0.05) return;
  let cur = null;
  for (let sv = e0; sv < e1; sv += 1) {
    const s1 = Math.min(e1, sv + 1); ptAt(s.P, q.L, s.np, (sv + s1) / 2, o);
    const m = inD(o[0], o[1]) ? 2 : inR(o[0], o[1]) ? 1 : 0;
    if (cur && cur.m === m) cur.b = s1; else runs.push(cur = { m, a: sv, b: s1 });
  }
  const nz = new Map();
  const noise = sv => { const k = Math.round(sv * 2); let r = nz.get(k); if (r == null) { ptAt(s.P, q.L, s.np, sv, o); r = noiseAt(o[0], o[1], -o[3], o[2], W / 2); nz.set(k, r); } return r; };
  const L = { P: s.P, L: q.L, np: s.np, id: s.id };
  for (const r of runs) {
    if (!r.m) continue;
    const det = r.m === 2, mid = det && M3.d >= 70;   // 近いはんいでも 引いたときは 少しあらく
    deck(G, L, r.a, r.b, { hw: () => [hwS, hwS], z: sv => epZ(ep, sv), c: sv => epC(ep, sv), tx, med: true, noise: det && M3.d < 220 ? noise : null, cut: (sv, sd) => cutAt(s, sv, sd),
      pier: det ? (mid ? 1.35 : 0.9) : (lv >= 2 ? 1.8 : 2.7), joint: det && M3.d < 60, step: det ? (mid ? 1.6 : 1) : 3, lo: !det, gd: 2.6, brk: CUTS.has(s.id) ? CUTS.get(s.id).flatMap(c => [c[0], c[1]]) : null, rail: true });
  }
}

/* ---------- メッシュにする ---------- */
let BOXG = null, CYLG = null;
function flush(G) {
  const grp = X.grp;
  for (const b of G.tex.values()) {
    if (!b.P.length) continue;
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute(b.P, 3)); g.setAttribute('uv', new T3.Float32BufferAttribute(b.UV, 2)); g.computeVertexNormals();
    grp.add(new T3.Mesh(g, lam('t:' + b.tx.key + ':' + b.off, Object.assign({ map: b.tx.tex }, offO(b.off)))));
  }
  for (const [B, key, off] of [[G.col, 'c', -2], [G.colLo, 'cl', -1], [G.mark, 'm', -5]]) {
    if (!B.P.length) continue;
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute(B.P, 3)); g.setAttribute('color', new T3.Float32BufferAttribute(B.C, 3)); g.computeVertexNormals();
    grp.add(new T3.Mesh(g, lam(key, Object.assign({ vertexColors: true, side: T3.DoubleSide }, offO(off)))));
  }
  const mtx = new T3.Matrix4(), qt = new T3.Quaternion(), pos = new T3.Vector3(), sc = new T3.Vector3(), up = new T3.Vector3(0, 1, 0), col = new T3.Color();
  if (G.box.length) {
    const n = G.box.length / 10, im = new T3.InstancedMesh(new T3.BoxGeometry(1, 1, 1), lam('box', { color: '#ffffff' }), n);
    for (let i = 0; i < n; i++) { const o = i * 10; pos.set(G.box[o], G.box[o + 1], G.box[o + 2]); qt.setFromAxisAngle(up, G.box[o + 6]); sc.set(G.box[o + 3], G.box[o + 4], G.box[o + 5]); mtx.compose(pos, qt, sc); im.setMatrixAt(i, mtx); col.setRGB(G.box[o + 7], G.box[o + 8], G.box[o + 9]); im.setColorAt(i, col); }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; grp.add(im);
  }
  if (G.cyl.length) {
    const n = G.cyl.length / 8, im = new T3.InstancedMesh(new T3.CylinderGeometry(1, 1, 1, 10), lam('box', { color: '#ffffff' }), n);
    qt.identity();
    for (let i = 0; i < n; i++) { const o = i * 8; pos.set(G.cyl[o], G.cyl[o + 1], G.cyl[o + 2]); sc.set(G.cyl[o + 3], G.cyl[o + 4], G.cyl[o + 3]); mtx.compose(pos, qt, sc); im.setMatrixAt(i, mtx); col.setRGB(G.cyl[o + 5], G.cyl[o + 6], G.cyl[o + 7]); im.setColorAt(i, col); }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; grp.add(im);
  }
  if (G.wire.length) { const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute(G.wire, 3)); grp.add(new T3.LineSegments(g, (MAT.wire || (MAT.wire = Object.assign(new T3.LineBasicMaterial({ color: '#2b2d2f' }), { keep: true }))))); }
}

/* ---------- 組み立て ---------- */
let BUILD = 0;
function build(X0) {
  const t0 = performance.now();
  X = X0; T3 = X.T3; M3 = X.M3; MQ = X.MQ; m3Surf = X.m3Surf; tileAt = X.tileAt; pfZ = X.pfZ; VEX = X.M3_VEX; LIFT = X.M3_LIFT; BUILD++;
  NODEH.clear(); HUMP.clear(); CUTS.clear(); PROF.clear();
  const G = newG();
  const roads = dedupe(X.roads.filter(s => s.k === 'road' && s.np >= 2));
  const exps = roads.filter(s => s.c === 'exp');
  let ords = roads.filter(s => s.c !== 'exp');
  // 橋脚をよける：地面の道・線路
  OBS.clear();
  for (const s of ords) OBS.add(s.P, s.np, (s.w || 0.2) / 2 + 0.02, s.id);
  for (const s of X.segs) if (s.k === 'rail') OBS.add(s.P, s.np, (s.q ? 0.26 : s.dbl ? 0.17 : 0.11), s.id);
  // 遠さで出すもの（t64b と同じ）
  const props = M3.d < 30, curbs = M3.d < 12, marks = M3.d < 80, wide = M3.d < 150, far = M3.d >= 40, nr = M3.nearQ || { cx: M3.tx, cy: M3.ty };
  const RO = Math.max(12, M3.d * 1.2), pnear = (x, y) => Math.abs(x - nr.cx) < RO && Math.abs(y - nr.cy) < RO;
  const LIGHT = [], SIG = [], POLES = [];
  // IC・JCT・跨線橋・SA（あとで）
  const D = { hide: new Set(), add: [], ramps: [] }, tb = [performance.now()];
  try { design(G, D, roads, exps, ords); } catch (e) { console.error(e); }
  for (const s of D.add) if (!s.deckDraw) OBS.add(s.P, s.np, (s.w || 0.2) / 2 + 0.02, s.id);
  ords = ords.filter(s => !D.hide.has(s.id)).concat(D.add);
  tb.push(performance.now());
  const OR = ordinary(G, ords, { far, props, curbs, marks, wide, pnear, LIGHT, SIG, POLES });
  tb.push(performance.now());
  try { after(G, D, OR.trim); } catch (e) { console.error(e); }
  const R2 = M3.d * 1.6 + Math.max(260, M3.d * 6) + 20;
  tb.push(performance.now());
  for (const s of exps) drawExp(G, s, R2);
  tb.push(performance.now());
  flush(G);
  X.m3Props(T3, LIGHT, SIG, POLES);
  tb.push(performance.now());
  M3.tRoad = performance.now() - t0;
  M3.tRoadB = { pre: Math.round(tb[0] - t0), design: Math.round(tb[1] - tb[0]), ord: Math.round(tb[2] - tb[1]), ramps: Math.round(tb[3] - tb[2]), exp: Math.round(tb[4] - tb[3]), flush: Math.round(tb[5] - tb[4]), n: ords.length, e: exps.length };
}
// バス：高架の上（高速）・跨線橋の上
function runY(sg, s, x, y, k) {
  if (k !== 'bus' || !sg) return null;
  const p = PROF.get(sg.id); if (!p) return null;
  if (p.ep) { const c = epC(p.ep, s); return { y: epZ(p.ep, s) + 0.1 * U, hide: c === 3 }; }
  if (p.zf) { const z = p.zf(s); return z == null ? null : { y: Math.max(z, m3Surf(x, y)) + LIFT + 0.1 * U, hide: false }; }
  return null;
}
// バス：左の車線のまん中（マス）
function off(sg, k) {
  const d = 2.8 * U; if (!sg || sg.k !== 'road') return d;
  const ln = Math.max(0, sg.l || 0);
  if (sg.c === 'exp') return (1.5 + 0.75 + (Math.max(1, ln) - 0.5) * 3.5) * U;
  if (ln >= 2) return (0.2 + (ln - 0.5) * 3.25) * U;
  return d;
}
/* ---------- IC・JCT（t64c）：高速の交点に、本物の形をまねた立体の道 ----------
   交点のまわりに 地元の座標 (a, b)：a は高速にそう向き・b は 取付道路（IC）・わかれる高速（JCT）のがわ。
   左側通行：b > 0 がわの車線は −a へ・b < 0 がわの車線は +a へ進む。ランプは 車線の左（外がわ）から出入りする */
const RAMPW = 6.5 * U;            // ランプの路面のはば（1車線＋路肩）
const RAMPS = [];                 // build ごと：ランプ（deck で描く）
const RES = new Map();            // build ごと：高速の線の id → 使った区間 [[sv0, sv1]]（IC・JCT が重ならないように）
const ETRIM = new Map();          // build ごと：高速の線の id → [はじめを切る, おわりを切る]（JCT で わかれる高速）
// 交点からの 外向き
const outDir = o => { const q = qOf(o.s), d = Math.min(0.6, q.len * 0.5), p = ptAt(o.s.P, q.L, o.s.np, o.e ? q.len - d : d, [0, 0, 0, 0]), x0 = o.s.P[o.e ? 2 * o.s.np - 2 : 0], y0 = o.s.P[o.e ? 2 * o.s.np - 1 : 1], L = hyp(p[0] - x0, p[1] - y0) || 1; return [(p[0] - x0) / L, (p[1] - y0) / L]; };
// 高速の線を 交点から たどる（まっすぐ つづく高速へ。JCT・終わりで とまる）
function walkExp(adj, nid, s, e, maxL) {
  const P = [], pcs = []; let acc = 0, guard = 0, first = true;
  while (s && guard++ < 10) {
    const q = qOf(s), n = s.np, len = q.len;
    for (let k = first ? 0 : 1; k < n; k++) { const i = e ? n - 1 - k : k; P.push(s.P[2 * i], s.P[2 * i + 1]); }
    pcs.push({ s, e, d0: acc, len }); acc += len; first = false;
    if (acc >= maxL) break;
    const far = e ? s.n0 : s.n1; if (far == null) break;
    const nb = (adj.get(far) || []).filter(o => o.s.c === 'exp' && o.s !== s);
    if (nb.length !== 1) break;
    const d1 = headOf(P, true), d2 = outDir(nb[0]);
    if (d1[0] * d2[0] + d1[1] * d2[1] < 0.6) break;
    s = nb[0].s; e = nb[0].e;
  }
  return { P, pcs, len: acc };
}
// 交点をはさむ 高速の線（T）：A の先 → 交点 → B の先。T の上の長さ sT → [実の線, その線の上の長さ, 向き（同じ 1・反対 −1）]
function mkThrough(n, A, B, adj) {
  const wA = walkExp(adj, n.id, A.s, A.e, 16), wB = walkExp(adj, n.id, B.s, B.e, 16);
  const pts = []; for (let i = wA.P.length / 2 - 1; i >= 1; i--) pts.push(wA.P[2 * i], wA.P[2 * i + 1]); for (let i = 0; i < wB.P.length / 2; i++) pts.push(wB.P[2 * i], wB.P[2 * i + 1]);
  const T = mkLine(pts, {}), sN = T.L[wA.P.length / 2 - 1];
  const map = sT => {
    const b2 = sT >= sN, w = b2 ? wB : wA, d = b2 ? sT - sN : sN - sT;
    let pc = w.pcs[w.pcs.length - 1]; for (const p of w.pcs) if (d <= p.d0 + p.len) { pc = p; break; }
    const dd = clamp(d - pc.d0, 0, pc.len);
    return [pc.s, pc.e ? pc.len - dd : dd, b2 ? (pc.e ? -1 : 1) : (pc.e ? 1 : -1)];
  };
  T.sN = sN; T.map = map; T.wA = wA; T.wB = wB;
  T.z = sT => { const m = map(sT); return epZ(expProf(m[0]), m[1]); };
  T.hw = sT => Math.max(0.2, (map(sT)[0].w || 0.56) / 2);
  // 高欄を切る：T の a0..a1、T の +横 から見て sd のがわ
  T.cut = (a0, a1, sd) => {
    if (a1 < a0) { const t = a0; a0 = a1; a1 = t; }
    const acc = new Map();
    for (let t = a0; ; t += 0.1) { const tt = Math.min(t, a1), m = map(tt), k = m[0].id + ':' + (sd * m[2]); let r = acc.get(k); if (!r) acc.set(k, r = [m[0], Infinity, -Infinity, sd * m[2]]); r[1] = Math.min(r[1], m[1]); r[2] = Math.max(r[2], m[1]); if (tt >= a1) break; }
    for (const r of acc.values()) { let a = CUTS.get(r[0].id); if (!a) CUTS.set(r[0].id, a = []); a.push([r[1] - 0.03, r[2] + 0.03, r[3]]); }
  };
  // 使う区間をおぼえる（ほかの IC・JCT が 重ならないように）
  T.reserve = (a0, a1) => {
    for (let t = Math.min(a0, a1); t <= Math.max(a0, a1) + 1e-6; t += 0.25) { const m = map(t); let a = RES.get(m[0].id); if (!a) RES.set(m[0].id, a = []); a.push([m[1] - 0.15, m[1] + 0.15]); }
  };
  T.free = (dir, others) => {   // 交点から dir（T の向き ±1）へ、あいている長さ
    const lim = dir > 0 ? T.len - sN : sN;
    for (let d = 0.25; d < lim; d += 0.25) {
      const m = map(sN + dir * d), a = RES.get(m[0].id);
      if (a && a.some(r => m[1] >= r[0] && m[1] <= r[1])) return Math.max(0, d - 0.4);
    }
    let f = lim - 0.3;
    for (const o of others) { const pr = projT(T, o.fx, o.fy); if (pr[1] < 0.08 && (pr[0] - sN) * dir > 0.05) f = Math.min(f, Math.abs(pr[0] - sN) / 2); }
    return f;
  };
  return T;
}
// 点を T に うつす → [T の上の長さ, はなれ]
function projT(T, x, y) {
  let best = Infinity, bs = 0;
  for (let i = 0; i < T.np - 1; i++) {
    const ax = T.P[2 * i], ay = T.P[2 * i + 1], dx = T.P[2 * i + 2] - ax, dy = T.P[2 * i + 3] - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 1e-12 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0, d = hyp(x - ax - dx * t, y - ay - dy * t);
    if (d < best) { best = d; bs = T.L[i] + Math.sqrt(L2) * t; }
  }
  return [bs, best];
}
// 地元の座標
function frameOf(n, T, dMain) {
  const a = ptAt(T.P, T.L, T.np, T.sN - 0.3, [0, 0, 0, 0]), b = ptAt(T.P, T.L, T.np, T.sN + 0.3, [0, 0, 0, 0]);
  let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl;
  const sgn = (dMain[0] * -ty + dMain[1] * tx) >= 0 ? 1 : -1, Ux = sgn * tx, Uy = sgn * ty, Vx = -Uy, Vy = Ux, O = [n.fx, n.fy];
  return { T, sgn, O, Ux, Uy, Vx, Vy, W: (a2, b2) => [O[0] + Ux * a2 + Vx * b2, O[1] + Uy * a2 + Vy * b2], loc: (x, y) => [(x - O[0]) * Ux + (y - O[1]) * Uy, (x - O[0]) * Vx + (y - O[1]) * Vy],
    dir: (du, dv) => [Ux * du + Vx * dv, Uy * du + Vy * dv], sT: a2 => T.sN + sgn * a2 };
}
// うらがえして（a → −a）、進む向きも反対に
function mirRev(sp) {
  const parts = sp.parts.slice().reverse().map(p => {
    if (p.k === 'att') return { k: 'att', side: p.side, a0: -p.a1, a1: -p.a0, w0: p.w1, w1: p.w0 };
    if (p.k === 'arc') return { k: 'arc', uc: -p.uc, vc: p.vc, R: p.R, f0: Math.PI - p.f1, f1: Math.PI - p.f0, w0: p.w1, w1: p.w0 };
    return Object.assign({}, p, { a: -p.a, h: [p.h[0], -p.h[1]] });
  });
  return Object.assign({}, sp, { parts, z0: sp.z1, z1: sp.z0 });
}
// ランプの形（進む順の部分）→ 線（点・はば・高さ）。z0・z1：はじめ・おわりの高さ（'deck' 高速の高さ・'gnd' 地面・数）
//   部分：{k:'att', side, a0, a1, w0, w1}（高速のはしに そう。side：+1 は b > 0 がわ）・{k:'arc', uc, vc, R, f0, f1, w0, w1}・{k:'wp', a, b, h, w, z}（点と向き）・{k:'wpw', x, y, h, w, z}（ワールドの点）
function realize(F, sp, os) {
  const PX = [], PW = [], PZ = [], PA = [], PF = [];
  const add = (x, y, w, z, at, fr) => { const n = PX.length / 2; if (n && hyp(PX[2 * n - 2] - x, PX[2 * n - 1] - y) < 0.006) { PW[n - 1] = w; if (!isNaN(z)) PZ[n - 1] = z; if (at) { PA[n - 1] = at; PF[n - 1] = fr; } return; } PX.push(x, y); PW.push(w); PZ.push(z); PA.push(at); PF.push(fr || null); };
  const T = F.T, gz = (x, y) => m3Surf(x, y) + LIFT;
  const lvl = (z, x, y) => z === 'gnd' ? gz(x, y) : z === 'deck' ? NaN : typeof z === 'number' ? z : NaN;
  const head = () => { const n = PX.length / 2; return n >= 2 ? headOf(PX, true) : null; };
  const link = (x1, y1, d1, w1, k) => {   // いまの はしから (x1, y1)・向き d1 へ ベジェ（k：取っ手の長さ）
    const n = PX.length / 2; if (!n) { add(x1, y1, w1, NaN, 0); return; }
    const x0 = PX[2 * n - 2], y0 = PX[2 * n - 1], w0 = PW[n - 1], d0 = head() || d1, L = hyp(x1 - x0, y1 - y0);
    if (L < 0.006) return;
    const pa = new Path(); pa.bez(x0, y0, d0[0], d0[1], x1, y1, d1[0], d1[1], k || 0.42, k || 0.42, 0.06);
    const a = pa.a, m = a.length / 2; for (let k = 1; k < m; k++) add(a[2 * k], a[2 * k + 1], lerp(w0, w1, k / (m - 1)), NaN, 0);
  };
  for (const p of sp.parts) {
    if (p.k === 'att') {
      const Fp = p.F || F, Tp = Fp.T, sT0 = Fp.sT(p.a0), sT1 = Fp.sT(p.a1), Ss = [], o0 = Tp.hw(sT0) - 0.5 * U;
      const P = subPts(Tp.P, Tp.L, Tp.np, sT0, sT1, Fp.sgn * p.side * (o0 + p.w0 / 2), Fp.sgn * p.side * (o0 + p.w1 / 2), 0.1, Ss), m = P.length / 2;
      const d1 = m >= 2 ? [(P[2] - P[0]) / (hyp(P[2] - P[0], P[3] - P[1]) || 1), (P[3] - P[1]) / (hyp(P[2] - P[0], P[3] - P[1]) || 1)] : [1, 0];
      if (PX.length) link(P[0], P[1], d1, p.w0, p.lk);
      for (let k = 0; k < m; k++) add(P[2 * k], P[2 * k + 1], lerp(p.w0, p.w1, Math.abs(Ss[k] - sT0) / (Math.abs(sT1 - sT0) || 1)), Tp.z(Ss[k]), p.side > 0 ? 1 : 2, Fp);
    } else if (p.k === 'arc') {
      const N = Math.max(3, Math.ceil(Math.abs(p.f1 - p.f0) * p.R / 0.06)), pt = f => F.W(p.uc + p.R * Math.cos(f), p.vc + p.R * Math.sin(f));
      const s0 = pt(p.f0), sg = p.f1 > p.f0 ? 1 : -1, td = F.dir(-Math.sin(p.f0) * sg, Math.cos(p.f0) * sg);
      if (PX.length) link(s0[0], s0[1], td, p.w0);
      for (let k = 0; k <= N; k++) { const f = p.f0 + (p.f1 - p.f0) * k / N, q = pt(f); add(q[0], q[1], lerp(p.w0, p.w1, k / N), NaN, 0); }
    } else {
      const q = p.k === 'wpw' ? [p.x, p.y] : F.W(p.a, p.b), d = p.k === 'wpw' ? p.h : F.dir(p.h[0], p.h[1]);
      link(q[0], q[1], d, p.w);
      add(q[0], q[1], p.w, p.z != null ? lvl(p.z, q[0], q[1]) : NaN, 0);
    }
  }
  const n = PX.length / 2; if (n < 2) return null;
  // 高さ：はし（z0・z1）と わかっている点のあいだを なめらかに
  if (isNaN(PZ[0])) PZ[0] = sp.z0 === 'deck' ? T.z(projT(T, PX[0], PX[1])[0]) : lvl(sp.z0, PX[0], PX[1]);
  if (isNaN(PZ[n - 1])) PZ[n - 1] = sp.z1 === 'deck' ? T.z(projT(T, PX[2 * n - 2], PX[2 * n - 1])[0]) : lvl(sp.z1, PX[2 * n - 2], PX[2 * n - 1]);
  const ln = mkLine(PX, { ow: 1, ramp: true, kind: sp.kind, c: 'city', l: 1, w: RAMPW + 0.02 });
  const L = ln.L;
  for (let i = 0; i < n;) {
    if (!isNaN(PZ[i])) { i++; continue; }
    let j = i; while (j < n && isNaN(PZ[j])) j++;
    const za = PZ[i - 1], zb = PZ[j], la = L[i - 1], lb = L[j];
    for (let k = i; k < j; k++) { const f = (L[k] - la) / ((lb - la) || 1); PZ[k] = za + (zb - za) * f * f * (3 - 2 * f); }
    i = j;
  }
  for (let i = 0; i < n; i++) PZ[i] = Math.max(PZ[i], gz(PX[2 * i], PX[2 * i + 1]));
  ln.W = Float32Array.from(PW); ln.Z = Float32Array.from(PZ); ln.AT = Uint8Array.from(PA); ln.FR = PF;
  const at = (A2, sv) => { sv = clamp(sv, 0, ln.len); let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= sv) lo = m; else hi = m; } const t = (sv - L[lo]) / ((L[hi] - L[lo]) || 1); return A2[lo] + (A2[hi] - A2[lo]) * t; };
  ln.zAt = sv => at(ln.Z, sv); ln.wAt = sv => at(ln.W, sv);
  ln.zf = sv => ln.zAt(sv) - LIFT;
  ln.cf = sv => { const p = ptAt(ln.P, L, n, sv, [0, 0, 0, 0]); return ln.zAt(sv) - m3Surf(p[0], p[1]) - LIFT > 0.5 * U ? 'V' : 'G'; };
  ln.prof0 = { key: 'qR1', W: 6.5, cw: 6.5, sw: 0, ln: 1, lw: 3.5, P: 10, dash: 0, ow: true };
  ln.texq = texRamp;
  return ln;
}
// ランプが高速にそうところ：T の高欄・ランプの内がわ（右）の高欄を切る。はなれるところ（はな）まで。三角の導流帯（しま）
function attachCuts(G, F0, ln, os, sideB0) {
  const n = ln.np, A = ln.AT, cuts = [];
  for (let i = 0; i < n;) {
    if (!A[i]) { i++; continue; }
    const F = ln.FR && ln.FR[i] || F0, sideB = A[i] === 2 ? -1 : 1, T = F.T, sideT = F.sgn * sideB;
    let j = i; while (j < n && A[j] && (ln.FR ? ln.FR[j] === ln.FR[i] : true)) j++;   // i..j-1 が そう（同じ高速に）
    const runs = [];
    if (j < n) runs.push([j - 1, 1]);       // 前から そって、あとで はなれる（出口）
    if (i > 0) runs.push([i, -1]);          // あとで そう（入口）
    let sT0 = projT(T, ln.P[2 * i], ln.P[2 * i + 1])[0], sT1 = projT(T, ln.P[2 * (j - 1)], ln.P[2 * (j - 1) + 1])[0], r0 = ln.L[i], r1 = ln.L[j - 1];
    for (const [k0, dk] of runs) {
      // はな：ランプの内がわのはしが 高速の路面のはしから 2.5m はなれるところ
      let k = k0, nose = null;
      for (; k >= 0 && k < n; k += dk) {
        const pr = projT(T, ln.P[2 * k], ln.P[2 * k + 1]), gap = pr[1] - (T.hw(pr[0]) - 0.5 * U) - ln.W[k] / 2;
        if (gap > 0.05) { nose = k; break; }
      }
      if (nose == null) nose = dk > 0 ? n - 1 : 0;
      const prn = projT(T, ln.P[2 * nose], ln.P[2 * nose + 1]);
      sT0 = Math.min(sT0, prn[0]); sT1 = Math.max(sT1, prn[0]); r0 = Math.min(r0, ln.L[nose]); r1 = Math.max(r1, ln.L[nose]);
      // 導流帯：そう点 → はな の あいだの 三角（高速のはし と ランプの内がわ）
      const k1 = dk > 0 ? k0 : nose, k2 = dk > 0 ? nose : k0;
      for (let q = k1; q < k2; q++) {
        const e0 = edgeIn(ln, q), e1 = edgeIn(ln, q + 1), f0 = edgeT(T, e0, sideT), f1 = edgeT(T, e1, sideT);
        const stripe = Math.floor(ln.L[q] / 0.07) % 2 === 0;
        q4(G.mark, [f0[0], f0[2] + M3_MARK * 0.3, f0[1]], [f1[0], f1[2] + M3_MARK * 0.3, f1[1]], [e1[0], e1[2] + M3_MARK * 0.3, e1[1]], [e0[0], e0[2] + M3_MARK * 0.3, e0[1]], stripe ? C_WHITE : C_GORE);
      }
      // はなの クッション（黄色）
      if (Math.abs(nose - k0) > 1) { const e = edgeIn(ln, nose), f = edgeT(T, e, sideT); cyl(G, (e[0] + f[0]) / 2, (e[2] + f[2]) / 2 + 0.45 * U, (e[1] + f[1]) / 2, 0.55 * U, 0.9 * U, C_YEL); }
    }
    T.cut(sT0, sT1, sideT);
    cuts.push([r0 - 0.02, r1 + 0.02]);
    i = j;
  }
  ln.cutR = cuts;
}
const edgeIn = (ln, k) => { const n = ln.np, a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), dx = ln.P[2 * b] - ln.P[2 * a], dy = ln.P[2 * b + 1] - ln.P[2 * a + 1], L = hyp(dx, dy) || 1, h = ln.W[k] / 2; return [ln.P[2 * k] - dy / L * h, ln.P[2 * k + 1] + dx / L * h, ln.Z[k]]; };
const edgeT = (T, e, sideT) => { const pr = projT(T, e[0], e[1]), p = ptAt(T.P, T.L, T.np, pr[0], [0, 0, 0, 0]), o = T.hw(pr[0]) - 0.5 * U; return [p[0] - p[3] * o * sideT, p[1] + p[2] * o * sideT, T.z(pr[0])]; };
// ランプを描く（構造物の帯）
function drawRamp(G, ln, tr) {
  const t0 = tr ? tr[0] : 0, t1 = tr ? tr[1] : 0;
  OBS.add(ln.P, ln.np, ln.wAt(ln.len / 2) / 2 + 0.03, ln.id);
  const far = M3.d > 60;   // 遠い：あらく（形は同じ）
  return () => deck(G, ln, t0, ln.len - t1, { hw: sv => { const w = ln.wAt(sv) / 2; return [w, w]; }, z: ln.zAt, c: sv => ln.cf(sv) === 'V' ? 1 : 0, gnd: true, tx: texRamp(),
    cut: (sv, sd) => sd > 0 && ln.cutR && ln.cutR.some(c => sv >= c[0] && sv <= c[1]), pier: far ? 1.0 : 0.62, gd: 1.7, gw: 0.06, step: far ? 0.5 : 0.25, rail: false, joint: M3.d < 40 });
}
// トランペット型（JCT も）：地元の座標の ランプの形。variant 'W'：ループが 向こうの車線への入口（ループは −a がわ）・'E'：ループが出口（+a がわ）
function trumpetSpec(q, variant, c) {
  c = c || 1;   // 加速・減速車線の長さ（せまいところは 短く）
  const { os, oa, Rl, lc, hs2, vJ, zB, zJ } = q, wr = RAMPW, uc = -lc - Rl, vc = -oa - Rl, Ro = Rl + 0.42, asep = uc - Rl - 0.62;
  const aN = hs2 + wr / 2 + (vJ - oa - 0.16) + 0.8;
  let loop = { kind: 'loop', z0: zB, z1: 'deck', parts: [
    { k: 'arc', uc, vc, R: Rl, f0: 0, f1: -0.47, w0: 2 * lc, w1: wr },
    { k: 'arc', uc, vc, R: Rl, f0: -0.47, f1: -1.5 * Math.PI + 0.34, w0: wr, w1: wr },
    { k: 'att', side: -1, a0: uc + 0.3, a1: uc + 0.3 + 1.8 * c, w0: wr, w1: wr },
    { k: 'att', side: -1, a0: uc + 0.3 + 1.8 * c, a1: uc + 0.3 + 2.7 * c, w0: wr, w1: 0.004 }] };
  let outer = { kind: 'outer', z0: 'deck', z1: zB, parts: [
    { k: 'att', side: -1, a0: asep - 2.3 * c, a1: asep - 1.4 * c, w0: 0.004, w1: wr },
    { k: 'att', side: -1, a0: asep - 1.4 * c, a1: asep, w0: wr, w1: wr },
    { k: 'arc', uc, vc, R: Ro, f0: Math.PI, f1: 1.5 * Math.PI, w0: wr, w1: wr },
    { k: 'wp', a: lc, b: vc - 0.45, h: [0, 1], w: wr },
    { k: 'wp', a: lc, b: vc, h: [0, 1], w: 2 * lc }] };
  if (variant === 'E') { const l2 = mirRev(outer), o2 = mirRev(loop); loop = Object.assign(l2, { kind: 'outer' }); outer = Object.assign(o2, { kind: 'loop' }); }
  const noff = { kind: 'noff', z0: 'deck', z1: zJ, parts: [
    { k: 'att', side: 1, a0: aN + 2.3 * c, a1: aN + 1.4 * c, w0: 0.004, w1: wr },
    { k: 'att', side: 1, a0: aN + 1.4 * c, a1: aN, w0: wr, w1: wr },
    { k: 'wp', a: aN - 0.8, b: oa + 0.16, h: [-1, 0], w: wr },
    { k: 'wp', a: hs2 + wr / 2, b: vJ, h: [0, 1], w: wr, z: zJ }] };
  const non = { kind: 'non', z0: zJ, z1: 'deck', parts: [
    { k: 'wp', a: -hs2 - wr / 2, b: vJ, h: [0, -1], w: wr, z: zJ },
    { k: 'wp', a: -aN + 0.8, b: oa + 0.16, h: [-1, 0], w: wr },
    { k: 'att', side: 1, a0: -aN, a1: -aN - 1.8 * c, w0: wr, w1: wr },
    { k: 'att', side: 1, a0: -aN - 1.8 * c, a1: -aN - 2.7 * c, w0: wr, w1: 0.004 }] };
  const far = -(asep - 2.3 * c) + 0.2;   // 向こうがわ（外まわり）の はし
  const needM = Math.max(aN + 2.7 * c + 0.2, variant === 'E' ? 0 : far), needP = Math.max(aN + 2.3 * c + 0.2, variant === 'E' ? far : 0);
  return { ramps: [loop, outer, noff, non], needM, needP, vc, uc };
}
// ふつうの道を 交点から たどる（2本のつぎめは 先へ）。inside(a, b) が false になる点（出口）か、交差点・おわりまで
function walkRoad(adj, F, nid, o, inside, maxL, thru) {
  const pcs = []; let s = o.s, e = o.e, node = nid, acc = 0, guard = 0;
  const pt = [0, 0, 0, 0];
  while (s && guard++ < 30) {
    const q = qOf(s), len = q.len;
    for (let d = 0; d <= len + 1e-6; d += 0.1) {
      const dd = Math.min(d, len); ptAt(s.P, q.L, s.np, e ? len - dd : dd, pt); const l = F.loc(pt[0], pt[1]);
      if (!inside(l[0], l[1])) { pcs.push({ s, e, node, len, cut: dd }); return { pcs, exit: true, d: acc + dd, x: pt[0], y: pt[1], dir: e ? [-pt[2], -pt[3]] : [pt[2], pt[3]] }; }
    }
    pcs.push({ s, e, node, len }); acc += len;
    if (acc > maxL) return { pcs, exit: false, d: acc };
    const far = e ? s.n0 : s.n1; if (far == null) return { pcs, exit: false, end: true, d: acc };
    const nb = (adj.get(far) || []).filter(x => x.s !== s);
    if (nb.length !== 1 || nb[0].s.c === 'exp') {
      // 交差点：thru（向き）があれば、いちばん その向きの道へ すすむ（ダイヤモンド型のランプは 高速から はなれる道に）
      if (!thru) return { pcs, exit: false, jn: far, d: acc };
      let bst = null, bv = 0.5;
      for (const x of nb) { if (x.s.c === 'exp') continue; const d = outDir(x), v2 = (d[0] * F.Vx + d[1] * F.Vy) * thru; if (v2 > bv) { bv = v2; bst = x; } }
      if (!bst) return { pcs, exit: false, jn: far, d: acc };
      s = bst.s; e = bst.e; node = far; continue;
    }
    s = nb[0].s; e = nb[0].e; node = far;
  }
  return { pcs, exit: false, d: acc };
}
// 線の一部を ワールドの点の列で（たどった向きに）。from..to（線のはしからの長さ。たどった向き）
function piecePts(pc, d0, d1) {
  const q = qOf(pc.s), len = q.len, a = pc.e ? len - d0 : d0, b = pc.e ? len - d1 : d1;
  return subPts(pc.s.P, q.L, pc.s.np, a, b, 0, 0, 0.25);
}
// 線をわける：たどった線 pc の d（たどった向き）のところに 新しい交点 nid。→ [手前の線, 先の線]
function splitAt(pc, d, nid) {
  const q = qOf(pc.s), len = q.len, base = { c: pc.s.c, l: pc.s.l, w: pc.s.w, art: pc.s.art, k: 'road', src: pc.s.id };
  const near = pc.node, far = pc.e ? pc.s.n0 : pc.s.n1;
  const A = d > 0.02 ? mkLine(piecePts(pc, 0, d), Object.assign({ n0: near, n1: nid }, base)) : null;
  const B = d < len - 0.02 ? mkLine(piecePts(pc, d, len), Object.assign({ n0: nid, n1: far }, base)) : null;
  return [A, B];
}
// 建物・道に かかる多さ（形をえらぶ）
function scoreLines(lines, cells, hide) {
  let sc = 0;
  for (const ln of lines) {
    const n = ln.np, L = ln.L, w = ln.wAt ? null : (ln.hw0 || 0.1), pt = [0, 0, 0, 0];
    for (let sv = 0; sv <= ln.len; sv += 0.12) {
      ptAt(ln.P, L, n, sv, pt);
      const hh = ln.zAt ? ln.zAt(sv) - m3Surf(pt[0], pt[1]) : 0, h = (ln.wAt ? ln.wAt(sv) : w * 2) / 2;
      const wt = hh < 7 * U ? 1 : 0.35;
      for (const o of [-h, 0, h]) { const x = pt[0] - pt[3] * o, y = pt[1] + pt[2] * o; if (cells.has(Math.floor(x * 5) + ',' + Math.floor(y * 5))) sc += wt; if (hh < 2 * U && OBS.hit(x, y, 0.02, hide)) sc += 0.4; }
    }
  }
  return sc;
}
// ランプどうしが 同じぐらいの高さで 重なるところの数（はし 0.7 マス・高速にそうところは のぞく）。形をえらぶ（ぶつかる形は やめる）
function clashes(lines) {
  const pts = [], grid = new Map(), pt = [0, 0, 0, 0];
  lines.forEach((ln, li) => {
    if (!ln.zAt) return;
    for (let sv = 0; sv <= ln.len; sv += 0.15) {
      ptAt(ln.P, ln.L, ln.np, sv, pt);
      let lo = 0, hi = ln.np - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ln.L[m] <= sv) lo = m; else hi = m; }
      if (ln.AT && (ln.AT[lo] || ln.AT[hi])) continue;
      if (sv < 0.7 || sv > ln.len - 0.7) continue;
      const o = [pt[0], pt[1], ln.zAt(sv), ln.wAt(sv) / 2, li, sv], k = Math.floor(pt[0] * 2) * 92821 + Math.floor(pt[1] * 2);
      pts.push(o); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(o);
    }
  });
  let n = 0;
  for (const o of pts) for (let gx = Math.floor(o[0] * 2) - 1; gx <= Math.floor(o[0] * 2) + 1; gx++) for (let gy = Math.floor(o[1] * 2) - 1; gy <= Math.floor(o[1] * 2) + 1; gy++) {
    const a = grid.get(gx * 92821 + gy); if (!a) continue;
    for (const q of a) { if (q === o || (q[4] === o[4] && Math.abs(q[5] - o[5]) < 1.5) || q[4] < o[4]) continue; if (hyp(q[0] - o[0], q[1] - o[1]) < q[3] + o[3] + 0.02 && Math.abs(q[2] - o[2]) < 5.5 * U) n++; }
  }
  return n;
}
// 料金所（本線料金所の小さいもの）：取付道路の上。ブース・島・屋根・事務所
function plazaDraw(G, F, v0, v1, nb, hw0) {
  const pa = F.W(0, v0), pb = F.W(0, v1), ln = mkLine([pa[0], pa[1], pb[0], pb[1]], {}), L = ln.len, lane = 3.3 * U, isl = 2.2 * U;
  const hp = (nb * lane + (nb - 1) * isl) / 2 + 0.6 * U, t1 = 0.4, t2 = L - 0.4, ang = Math.atan2(F.Vy, F.Vx);
  const hwf = sv => { const w = sv < t1 ? lerp(hw0, hp, sst(sv / t1)) : sv > t2 ? lerp(hp, hw0, sst((sv - t2) / (L - t2))) : hp; return [w, w]; };
  const zf = sv => { const p = ptAt(ln.P, ln.L, 2, sv, [0, 0, 0, 0]); return m3Surf(p[0], p[1]) + LIFT; };
  deck(G, ln, 0, L, { hw: hwf, z: zf, c: () => 0, gnd: true, sc: C_ASPH, step: 0.08 });
  OBS.add(ln.P, 2, hp, ln.id);
  const sb = L / 2, zc = zf(sb), at = (x, d) => F.W(x, v0 + sb + d);
  for (let k = 0; k <= nb; k++) {
    const x = -hp + 0.6 * U + k * (lane + isl) - isl / 2;
    if (k > 0 && k < nb) {
      const p = at(x, 0); box(G, p[0], zc + 0.12 * U, p[1], 0.42, 0.25 * U, isl, -ang, C_ISL);
      for (const dd of [-0.215, 0.215]) { const q = at(x, dd); box(G, q[0], zc + 0.3 * U, q[1], 0.02, 0.6 * U, isl * 0.9, -ang, C_YEL); }
      box(G, p[0], zc + 1.55 * U, p[1], 3.8 * U, 2.6 * U, 1.7 * U, -ang, C_GLASS);   // ブース
      if (k % 2) for (const dd of [-0.09, 0.09]) { const q = at(x, dd); box(G, q[0], zc + 3.6 * U, q[1], 0.7 * U, 6.6 * U, 0.7 * U, -ang, C_PAR); }
    }
    // レーンの線（ブースの前後）
    if (k > 0 && k < nb) for (const sg of [-1, 1]) { const p0 = at(x, sg * 0.21), p1 = at(x, sg * 0.36); q4(G.mark, [p0[0] - F.Vy * 0, zc + M3_MARK, p0[1]], [p1[0], zc + M3_MARK, p1[1]], [p1[0] + F.Ux * 0.15 * U, zc + M3_MARK, p1[1] + F.Uy * 0.15 * U], [p0[0] + F.Ux * 0.15 * U, zc + M3_MARK, p0[1] + F.Uy * 0.15 * U], C_WHITE); }
  }
  const c = at(0, 0);
  box(G, c[0], zc + 7.2 * U, c[1], 0.26, 0.9 * U, hp * 2 + 0.04, -ang, C_CANOPY);   // 屋根
  for (const dd of [-0.13, 0.13]) { const q = at(0, dd); box(G, q[0], zc + 7.1 * U, q[1], 0.012, 1.4 * U, hp * 2 + 0.05, -ang, C_FASC); }
  const o = at(hp + 0.2, 0.05); box(G, o[0], zc + 3.6 * U, o[1], 0.36, 7.2 * U, 0.2, -ang, C_BOOTH);   // 事務所
  const o2 = at(hp + 0.2, 0.05); box(G, o2[0], zc + 7.35 * U, o2[1], 0.37, 0.3 * U, 0.21, -ang, C_SOF);
}
// ランプの料金所（ダイヤモンド型）：ランプの上に 小さな屋根とブース
function rampBooth(G, ln, sv) {
  const p = ptAt(ln.P, ln.L, ln.np, sv, [0, 0, 0, 0]), ang = Math.atan2(p[3], p[2]), z = ln.zAt(sv), w = ln.wAt(sv);
  box(G, p[0], z + 6.6 * U, p[1], 0.2, 0.7 * U, w + 0.08, -ang, C_CANOPY);
  for (const sd of [-1, 1]) { const x = p[0] - p[3] * sd * (w / 2 + 0.025), y = p[1] + p[2] * sd * (w / 2 + 0.025); box(G, x, z + 3.3 * U, y, 0.7 * U, 6.4 * U, 0.7 * U, -ang, C_PAR); }
  const bx = p[0] + p[3] * (w / 2 + 0.02), by = p[1] - p[2] * (w / 2 + 0.02); box(G, bx, z + 1.4 * U, by, 3.5 * U, 2.6 * U, 1.8 * U, -ang, C_GLASS);
}
// 取付道路の断面（歩道なし）
const PROF_S2 = { key: 'qS2', W: 9, cw: 9, sw: 0, ln: 1, lw: 3.5, P: 10, dash: 0, ctr: 'y' }, PROF_S4 = { key: 'qS4', W: 22, cw: 22, sw: 0, ln: 2, lw: 3.5, P: 10, dash: 5, ctr: 'y2' };
function design(G, D, roads, exps, ords) {
  const it = X.it, v = X.v, adj = new Map();
  RAMPS.length = 0; RES.clear(); ETRIM.clear(); BUMP.clear();
  for (const s of it.segs.values()) {
    if (s.k !== 'road' || s.np < 2 || DUP.has(s.id)) continue;
    for (const e of [0, 1]) { const nid = e ? s.n1 : s.n0; if (nid == null) continue; let a = adj.get(nid); if (!a) adj.set(nid, a = []); a.push({ s, e }); }
  }
  const expIds = new Set(exps.map(s => s.id));
  const all = [...it.nodes.values()].filter(n => n.nk === 'ic' || n.nk === 'jct');
  const nodes = all.filter(n => n.fx >= v.x0 - 1 && n.fx <= v.x1 + 1 && n.fy >= v.y0 - 1 && n.fy <= v.y1 + 1);
  nodes.sort((a, b) => (a.nk === 'jct' ? 0 : 1) - (b.nk === 'jct' ? 0 : 1) || a.id - b.id);
  // 高速が 4本以上 あつまる交点：まっすぐの組を 1階、のこりを 2階に（同じ高さで まじわらない）
  const XN = [];
  for (const n of all) {
    if (n.fx < v.x0 - 12 || n.fx > v.x1 + 12 || n.fy < v.y0 - 12 || n.fy > v.y1 + 12) continue;
    const ex = (adj.get(n.id) || []).filter(o => o.s.c === 'exp'); if (ex.length < 3) continue;
    const dirs = ex.map(outDir); let bi = -1, bj = -1, bd = -0.6;
    for (let i = 0; i < ex.length; i++) for (let j = i + 1; j < ex.length; j++) { const d = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]; if (d < bd) { bd = d; bi = i; bj = j; } }
    if (ex.length >= 4 && bi >= 0) {
      for (let k = 0; k < ex.length; k++) { if (k === bi || k === bj) continue; const w = walkExp(adj, n.id, ex[k].s, ex[k].e, 7); for (const pc of w.pcs) { let a = BUMP.get(pc.s.id); if (!a) BUMP.set(pc.s.id, a = []); a.push({ e: pc.e, d0: pc.d0, H: LV2 * U }); } }
      XN.push({ n, ex, bi, bj, adj });
    } else if (ex.length === 3 && (bi < 0 || n.nk !== 'jct')) XN.push({ n, ex, y: true });
  }
  for (const x of XN) try { crossFix(x, adj); } catch (e) { console.error(e); }
  for (const x of XN) if (!x.y && x.ex.length === 4) try { cloverDesign(G, x, adj, all, v); } catch (e) { console.error(e); }
  try { railClear(exps, adj); } catch (e) { console.error(e); }
  const lv = Number(MQ.d3) || 0;
  for (const n of nodes) {
    const a = adj.get(n.id) || [], ex = a.filter(o => o.s.c === 'exp'), od = a.filter(o => o.s.c !== 'exp');
    if (ex.some(o => !expIds.has(o.s.id))) continue;   // 高速が 描くはんいに ない
    try {
      if (n.nk === 'jct' && ex.length === 3) jctDesign(G, D, n, ex, adj, all);
      else if (n.nk === 'ic' && ex.length === 2 && od.length) icDesign(G, D, n, ex, od, adj, all, v);
    } catch (e) { console.error(e); }
  }
  try { saDesign(G, D, exps); } catch (e) { console.error(e); }
  try { humps(ords.filter(s => !D.hide.has(s.id)), adj); } catch (e) { console.error(e); }
}
// 高速の立体交差・Y 字の合流：重なるところの 内がわの高欄を切る（ひとつの床に）。2階は 1階の床に 橋脚を立てない
function crossFix(x, adj) {
  const { n, ex } = x;
  const W = ex.map(o => { const w = walkExp(adj, n.id, o.s, o.e, 7); return { o, w, P: mkLine(w.P, {}), hw: Math.max(0.2, (o.s.w || 0.56) / 2), up: BUMP.has(o.s.id) }; });
  if (!x.y) { for (const a of W) if (!a.up) OBS.add(a.P.P, a.P.np, a.hw + 0.05, a.o.s.id); return; }
  // Y 字：重なるところ（交点から）。ひくい格の線は 4cm 下げる（路面が ちらつかない）
  W.sort((p, q) => (q.o.s.l || 2) - (p.o.s.l || 2) || (q.o.s.w || 0) - (p.o.s.w || 0));
  for (let i = 1; i < W.length; i++) for (const pc of W[i].w.pcs) { let a = BUMP.get(pc.s.id); if (!a) BUMP.set(pc.s.id, a = []); a.push({ e: pc.e, d0: pc.d0, H: -0.04 * U * i, flat: true }); }
  for (const a of W) for (const b of W) {
    if (a === b) continue;
    let dmax = -1, side = 0; const pt = [0, 0, 0, 0];
    for (let d = 0; d <= Math.min(6, a.P.len); d += 0.1) {
      ptAt(a.P.P, a.P.L, a.P.np, d, pt); const pr = projT(b.P, pt[0], pt[1]);
      if (pr[1] < a.hw + b.hw) { dmax = d; const q = ptAt(b.P.P, b.P.L, b.P.np, pr[0], [0, 0, 0, 0]); side = Math.sign(-pt[3] * (q[0] - pt[0]) + pt[2] * (q[1] - pt[1])) || side; }
    }
    if (dmax < 0 || !side) continue;
    // a の 交点から dmax までの side がわ（a の進む向き＝交点から外 の +横 が side）
    for (const pc of a.w.pcs) {
      if (pc.d0 > dmax) break;
      const L1 = Math.min(pc.len, dmax + 0.3 - pc.d0), sv0 = pc.e ? pc.len - L1 : 0, sv1 = pc.e ? pc.len : L1, sd = pc.e ? -side : side;
      let c = CUTS.get(pc.s.id); if (!c) CUTS.set(pc.s.id, c = []); c.push([sv0, sv1, sd]);
    }
  }
}
// クローバー型 JCT（高速が十字に まじわる）：まっすぐの組 T1 は 1階・T2 は 2階。
//   どの四分円にも ループ（右折：270°）1つと 外まわり（左折）1つ。左側通行なので ループも外まわりも 時計まわり（左へ）に まがる
function cloverDesign(G, x, adj, all, v) {
  const { n, ex, bi, bj } = x, rest = [0, 1, 2, 3].filter(k => k !== bi && k !== bj);
  if (n.fx < v.x0 - 1 || n.fx > v.x1 + 1 || n.fy < v.y0 - 1 || n.fy > v.y1 + 1) return;
  const d0 = outDir(ex[rest[0]]), d1 = outDir(ex[rest[1]]);
  if (d0[0] * d1[0] + d0[1] * d1[1] > -0.6) return;
  const T1 = mkThrough(n, ex[bi], ex[bj], adj), F1 = frameOf(n, T1, d0);
  const C = d0[0] * F1.Vx + d0[1] * F1.Vy > 0 ? ex[rest[0]] : ex[rest[1]], Dl = C === ex[rest[0]] ? ex[rest[1]] : ex[rest[0]];
  const T2 = mkThrough(n, Dl, C, adj), F2 = frameOf(n, T2, [-F1.Ux, -F1.Uy]);
  const need = 7.2;
  if (T1.sN < need || T1.len - T1.sN < need || T2.sN < need || T2.len - T2.sN < need) return;
  if (Math.abs(F2.Ux * F1.Vx + F2.Uy * F1.Vy) < 0.8) return;   // ほぼ 直角のときだけ
  const os1 = T1.hw(T1.sN) - 0.5 * U, os2 = T2.hw(T2.sN) - 0.5 * U, wr = RAMPW, oa1 = os1 + wr / 2, oa2 = os2 + wr / 2, R = 0.85, Ld = 1.4, Lt = 0.6, Lt2 = 0.4;
  const pt = [0, 0, 0, 0];
  // 高速のへりの点（地元の座標 a・横 b）：線の上で（まがっていても）
  const edge = (F, a, b) => { ptAt(F.T.P, F.T.L, F.T.np, F.sT(a), pt); return [pt[0] - pt[3] * F.sgn * b, pt[1] + pt[2] * F.sgn * b]; };
  const locA = (F, x, y) => (projT(F.T, x, y)[0] - F.T.sN) * F.sgn;
  const make = Ro => {   // 外まわりの大きさ Ro で 形を作る（ぶつかれば 大きくして やりなおす）
  const specs = [];
  for (const su of [1, -1]) for (const sv of [1, -1]) {
    // 四分円の かど：T1 のへり（b = sv·oa1）と T2 の その脚のへり（F2 で b2 = −su·oa2）の まじわり。かどの角 θ に合わせた ループ
    const a1 = edge(F1, su * 0.5, sv * oa1), a2 = edge(F1, su * 2.5, sv * oa1), b1 = edge(F2, sv * 0.5, -su * oa2), b2 = edge(F2, sv * 2.5, -su * oa2);
    let e1x = a2[0] - a1[0], e1y = a2[1] - a1[1], e2x = b2[0] - b1[0], e2y = b2[1] - b1[1]; const l1 = hyp(e1x, e1y), l2 = hyp(e2x, e2y); e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    const den = e1x * e2y - e1y * e2x; if (Math.abs(den) < 0.3) return null;
    const tk = ((b1[0] - a1[0]) * e2y - (b1[1] - a1[1]) * e2x) / den, K = [a1[0] + e1x * tk, a1[1] + e1y * tk];
    const th = Math.acos(clamp(e1x * e2x + e1y * e2y, -1, 1)); if (th < 0.9 || th > 2.3) return null;
    let bx = e1x + e2x, by = e1y + e2y; const bl = hyp(bx, by); bx /= bl; by /= bl;
    const dc = R / Math.sin(th / 2), dt = R / Math.tan(th / 2), Cw = [K[0] + bx * dc, K[1] + by * dc], t1 = [K[0] + e1x * dt, K[1] + e1y * dt], t2 = [K[0] + e2x * dt, K[1] + e2y * dt];
    const Cl = F1.loc(Cw[0], Cw[1]), t1l = F1.loc(t1[0], t1[1]), t2l = F1.loc(t2[0], t2[1]);
    const ph1 = Math.atan2(t1l[1] - Cl[1], t1l[0] - Cl[0]), ph2 = Math.atan2(t2l[1] - Cl[1], t2l[0] - Cl[0]), sw = Math.PI + th;
    const P1a = locA(F1, t1[0], t1[1]), P2a = locA(F2, t2[0], t2[1]), sd1 = sv, sd2 = -su, dir1 = -sv, dir2 = su;
    const av1 = Math.abs(P1a) - 0.35, av2 = Math.abs(P2a) - 0.35;   // 交点までの 車線の長さ（となりの ループと 交点で つなぐ）
    if (av1 < 0.15 || av2 < 0.15) return null;
    const q1 = Math.min(Lt2, av1 * 0.5), q2 = Math.min(Lt2, av2 * 0.5);   // 交点がわの すぼまり
    if (su * sv < 0) {   // ループ T1 → T2
      specs.push({ kind: 'cl', z0: 'deck', z1: 'deck', parts: [
        { k: 'att', F: F1, side: sd1, a0: P1a - dir1 * (av1 + 0.35), a1: P1a - dir1 * (av1 - q1 + 0.35), w0: 0.004, w1: wr }, { k: 'att', F: F1, side: sd1, a0: P1a - dir1 * (av1 - q1 + 0.35), a1: P1a - dir1 * 0.35, w0: wr, w1: wr },
        { k: 'arc', uc: Cl[0], vc: Cl[1], R, f0: ph1 - 0.42, f1: ph1 - sw + 0.42, w0: wr, w1: wr },
        { k: 'att', F: F2, side: sd2, a0: P2a + dir2 * 0.35, a1: P2a + dir2 * (av2 - q2 + 0.35), w0: wr, w1: wr }, { k: 'att', F: F2, side: sd2, a0: P2a + dir2 * (av2 - q2 + 0.35), a1: P2a + dir2 * (av2 + 0.35), w0: wr, w1: 0.004 }] });
      // 外まわり T2 → T1
      const P2o = sv * (oa1 + Ro), P1o = su * (oa2 + Ro);
      specs.push({ kind: 'co', z0: 'deck', z1: 'deck', parts: [
        { k: 'att', F: F2, side: sd2, a0: P2o - dir2 * (Ld + Lt), a1: P2o - dir2 * Ld, w0: 0.004, w1: wr }, { k: 'att', F: F2, side: sd2, a0: P2o - dir2 * Ld, a1: P2o, w0: wr, w1: wr },
        { k: 'att', F: F1, side: sd1, a0: P1o, a1: P1o + dir1 * Ld, w0: wr, w1: wr, lk: 0.22 }, { k: 'att', F: F1, side: sd1, a0: P1o + dir1 * Ld, a1: P1o + dir1 * (Ld + Lt), w0: wr, w1: 0.004 }] });
    } else {             // ループ T2 → T1
      specs.push({ kind: 'cl', z0: 'deck', z1: 'deck', parts: [
        { k: 'att', F: F2, side: sd2, a0: P2a - dir2 * (av2 + 0.35), a1: P2a - dir2 * (av2 - q2 + 0.35), w0: 0.004, w1: wr }, { k: 'att', F: F2, side: sd2, a0: P2a - dir2 * (av2 - q2 + 0.35), a1: P2a - dir2 * 0.35, w0: wr, w1: wr },
        { k: 'arc', uc: Cl[0], vc: Cl[1], R, f0: ph2 - 0.42, f1: ph2 - sw + 0.42, w0: wr, w1: wr },
        { k: 'att', F: F1, side: sd1, a0: P1a + dir1 * 0.35, a1: P1a + dir1 * (av1 - q1 + 0.35), w0: wr, w1: wr }, { k: 'att', F: F1, side: sd1, a0: P1a + dir1 * (av1 - q1 + 0.35), a1: P1a + dir1 * (av1 + 0.35), w0: wr, w1: 0.004 }] });
      // 外まわり T1 → T2
      const P1o = su * (oa2 + Ro), P2o = sv * (oa1 + Ro);
      specs.push({ kind: 'co', z0: 'deck', z1: 'deck', parts: [
        { k: 'att', F: F1, side: sd1, a0: P1o - dir1 * (Ld + Lt), a1: P1o - dir1 * Ld, w0: 0.004, w1: wr }, { k: 'att', F: F1, side: sd1, a0: P1o - dir1 * Ld, a1: P1o, w0: wr, w1: wr },
        { k: 'att', F: F2, side: sd2, a0: P2o, a1: P2o + dir2 * Ld, w0: wr, w1: wr, lk: 0.22 }, { k: 'att', F: F2, side: sd2, a0: P2o + dir2 * Ld, a1: P2o + dir2 * (Ld + Lt), w0: wr, w1: 0.004 }] });
    }
  }
  return specs;
  };
  let lines = null, ncl = 0, used = 0;
  for (const Ro of [4.4, 5.3, 6.2]) {
    const nd = Math.max(oa1, oa2) + Ro + Ld + Lt + 0.3; if (T1.sN < nd || T1.len - T1.sN < nd || T2.sN < nd || T2.len - T2.sN < nd) break;
    const specs = make(Ro); if (!specs) return;
    const ls = specs.map(sp => realize(F1, sp, os1)).filter(Boolean); if (ls.length < 8) return;
    ncl = clashes(ls); if (ncl <= 2) { lines = ls; used = nd; break; }
  }
  if (!lines) return;
  T1.reserve(T1.sN - used, T1.sN + used); T2.reserve(T2.sN - used, T2.sN + used);
  for (const ln of lines) { attachCuts(G, F1, ln, os1, 1); RAMPS.push({ ln }); }
}
// IC
function icDesign(G, D, n, ex, od, adj, all, v) {
  const T = mkThrough(n, ex[0], ex[1], adj);
  if (Math.abs(T.sN) < 1 || T.len - T.sN < 1) return;
  od.sort((p, q) => (RANK[q.s.c] || 2) - (RANK[p.s.c] || 2) || (q.s.w || 0) - (p.s.w || 0) || p.s.id - q.s.id);
  const main = od[0], dMain = outDir(main), F = frameOf(n, T, dMain);
  const hw = Math.max(T.hw(T.sN - 0.5), T.hw(T.sN + 0.5)), os = hw - 0.5 * U, oa = os + RAMPW / 2, zN = T.z(T.sN);
  const others = all.filter(o => o.id !== n.id);
  const spP = T.free(F.sgn, others), spM = T.free(-F.sgn, others);   // +a がわ・−a がわ
  const urban = /出入口/.test(n.n || '');
  const hide = new Set([main.s.id]);
  const inner = Math.abs(n.fx - (v.x0 + v.x1) / 2) < (v.x1 - v.x0) / 2 - 10 && Math.abs(n.fy - (v.y0 + v.y1) / 2) < (v.y1 - v.y0) / 2 - 10;
  // トランペット型の案
  let best = null;
  const vJ = hw + 1.9, vP0 = vJ + 0.25, vP3 = vP0 + 1.25;
  if (!urban && od.length === 1 && Math.min(spP, spM) >= 3.9 && CHOICE.get(n.id) !== 'D') {
    const w = walkRoad(adj, F, n.id, main, (a, b) => Math.abs(a) <= 6.4 && b >= -3.2 && b <= vP3 + 0.3, 14);
    if (w.exit) {
      const q = { os, oa, Rl: 0.95, lc: 0.045, hs2: 0.09, vJ, zB: 'gnd', zJ: 'gnd' };
      for (const vr of ['W', 'E']) {
        const ch = CHOICE.get(n.id); if (ch && ch !== vr) continue;
        let sp = trumpetSpec(q, vr, 1); if (spP < sp.needP || spM < sp.needM) sp = trumpetSpec(q, vr, 0.62);   // せまい：短い車線で
        if (spP < sp.needP || spM < sp.needM) continue;
        const lines = sp.ramps.map(r => realize(F, r, os)).filter(Boolean);
        if (lines.length < 4) continue;
        const stem = mkLine([...F.W(0, sp.vc), ...F.W(0, vP3)], {}); stem.hw0 = 0.2;
        const sc = scoreLines(lines.concat([stem]), bldCells(X.it, n.fx - 8, n.fy - 8, n.fx + 8, n.fy + 8), hide) + clashes(lines) * 40;
        if (!best || sc < best.sc) best = { vr, sp, lines, sc, w };
      }
    }
  }
  if (best && (best.sc < 60 || CHOICE.get(n.id) === best.vr)) {
    if (inner) CHOICE.set(n.id, best.vr);
    const { sp, lines, w } = best, id = 'v' + n.id + ':';
    T.reserve(F.sT(-sp.needM), F.sT(sp.needP));
    for (const ln of lines) { attachCuts(G, F, ln, os, ln.kind === 'noff' || ln.kind === 'non' ? 1 : -1); RAMPS.push({ ln }); }
    // 取付道路：B → J（2車線）・J → 料金所（4車線）・料金所 → 道
    const st2 = mkLine([...F.W(0, sp.vc), ...F.W(0, vJ)], { c: 'city', l: 1, w: 0.18, n0: id + 'B', n1: id + 'J', prof0: PROF_S2, texq: texStem2, noSig: true });
    const st4 = mkLine([...F.W(0, vJ), ...F.W(0, vP0)], { c: 'pref', l: 2, w: 0.44, n0: id + 'J', n1: id + 'P', prof0: PROF_S4, texq: texStem4, noSig: true });
    D.add.push(st2, st4);
    plazaDraw(G, F, vP0, vP3, 7, 11 * U);
    // 道へ：出口の点まで かくして、つなぎの道
    for (const pc of w.pcs) D.hide.add(pc.s.id);
    const last = w.pcs[w.pcs.length - 1], ex2 = id + 'X', [, rest] = splitAt(last, last.cut, ex2);
    if (rest) D.add.push(rest);
    const p0 = F.W(0, vP3), pa = new Path(); pa.bez(p0[0], p0[1], F.Vx, F.Vy, w.x, w.y, w.dir[0], w.dir[1], 0.4, 0.4, 0.08);
    const con = mkLine(pa.a, { c: main.s.c, l: main.s.l, w: main.s.w, art: main.s.art, n0: id + 'Q', n1: rest ? ex2 : (last.e ? last.s.n0 : last.s.n1), src: main.s.id });
    D.add.push(con);
    return;
  }
  // ダイヤモンド型（町なかの出入口・せまいところ・道が交差点まで近い）：ランプは 高速にそって、取付道路の 交差点へ
  if (inner) CHOICE.set(n.id, 'D');
  const vT = oa + 0.21, Ls = 3.0, Lg = 0.45, Ld = 1.4, Lt = 0.9, need = Lg + Ls + 0.6 + Ld + Lt + 0.3;
  const term = (o, sgnB) => {   // 道を たどって b = ±vT のところ（交差点が先なら そこ）
    const w = walkRoad(adj, F, n.id, o, (a, b) => b * sgnB < vT && Math.abs(a) < 3, 6, sgnB);
    const id = 'v' + n.id + (sgnB > 0 ? ':T1' : ':T2');
    if (w.exit) {
      const last = w.pcs[w.pcs.length - 1], [A2, B2] = splitAt(last, last.cut, id);
      D.hide.add(last.s.id); if (A2) D.add.push(A2); if (B2) D.add.push(B2);
      return { id, x: w.x, y: w.y, dirs: [w.dir, [-w.dir[0], -w.dir[1]]] };
    }
    if (w.jn != null) {
      const p = (X.it.nodes.get(w.jn)) || null, last = w.pcs[w.pcs.length - 1], x = last.s.P[last.e ? 0 : 2 * last.s.np - 2], y = last.s.P[last.e ? 1 : 2 * last.s.np - 1];
      return { id: w.jn, x: p ? p.fx : x, y: p ? p.fy : y, dirs: (adj.get(w.jn) || []).filter(o => o.s.c !== 'exp' && !D.hide.has(o.s.id)).map(outDir) };
    }
    return null;
  };
  // ランプの向き（交差点から外へ）が、ほかの道と 30° より近いときは そのランプを やめる（重なって いびつになる）
  const clash = (t, du) => { const d = F.dir(du, 0); return (t.dirs || []).some(e => e[0] * d[0] + e[1] * d[1] > 0.866); };
  const near = term(main, 1);
  const farO = od.find(o => o !== main && F.loc(...outDir(o).map((d, i) => [n.fx, n.fy][i] + d))[1] < 0);
  let far = farO ? term(farO, -1) : null;
  if (!far) {   // 向こうがわに道がなければ、高架の下を 少し のばす
    const dl = F.loc(n.fx + dMain[0], n.fy + dMain[1]); let du = -dl[0], dv = -dl[1]; if (dv > -0.35) { du = 0; dv = -1; } const k = hyp(du, dv); du /= k; dv /= k;
    const L2 = Math.min(2.2, vT / -dv), p1 = F.W(du * L2, dv * L2);
    const ext = mkLine([n.fx, n.fy, p1[0], p1[1]], { c: main.s.c === 'nat' ? 'pref' : main.s.c, l: Math.min(2, main.s.l || 1), w: Math.min(main.s.w || 0.3, 0.44), n0: n.id, n1: 'v' + n.id + ':T2' });
    D.add.push(ext); far = { id: 'v' + n.id + ':T2', x: p1[0], y: p1[1] };
  }
  if (!near) return;
  const aT1 = F.loc(near.x, near.y)[0], aT2 = F.loc(far.x, far.y)[0];
  const okP = spP >= Math.max(aT1, aT2) + need, okM = spM >= -Math.min(aT1, aT2) + need;
  if (!okP && !okM) return;
  const sides = { P: okP, M: okM }, wr = RAMPW, specs = [];
  const wpT = (t, d) => ({ k: 'wpw', x: t.x, y: t.y, h: F.dir(d[0], d[1]), w: wr, z: 'gnd' });
  const use = { noff: okP && !clash(near, 1), fon: okP && !clash(far, 1), non: okM && !clash(near, -1), foff: okM && !clash(far, -1) };
  if (!use.noff && !use.fon && !use.non && !use.foff) return;
  if (sides.P) {
    const a0 = aT1 + Lg + Ls + 0.6;
    specs.push({ kind: 'noff', side: 1, end: near, z0: 'deck', z1: 'gnd', parts: [{ k: 'att', side: 1, a0: a0 + Ld + Lt, a1: a0 + Ld, w0: 0.004, w1: wr }, { k: 'att', side: 1, a0: a0 + Ld, a1: a0, w0: wr, w1: wr },
      { k: 'wp', a: aT1 + Lg + Ls, b: vT, h: [-1, 0], w: wr }, { k: 'wp', a: aT1 + Lg, b: vT, h: [-1, 0], w: wr, z: 'gnd' }, wpT(near, [-1, 0])] });
    const b0 = aT2 + Lg + Ls + 0.6;
    specs.push({ kind: 'fon', side: -1, start: far, z0: 'gnd', z1: 'deck', parts: [wpT(far, [1, 0]), { k: 'wp', a: aT2 + Lg, b: -vT, h: [1, 0], w: wr, z: 'gnd' }, { k: 'wp', a: aT2 + Lg + Ls, b: -vT, h: [1, 0], w: wr },
      { k: 'att', side: -1, a0: b0, a1: b0 + Ld, w0: wr, w1: wr }, { k: 'att', side: -1, a0: b0 + Ld, a1: b0 + Ld + Lt, w0: wr, w1: 0.004 }] });
  }
  if (sides.M) {
    const a0 = aT1 - Lg - Ls - 0.6;
    specs.push({ kind: 'non', side: 1, start: near, z0: 'gnd', z1: 'deck', parts: [wpT(near, [-1, 0]), { k: 'wp', a: aT1 - Lg, b: vT, h: [-1, 0], w: wr, z: 'gnd' }, { k: 'wp', a: aT1 - Lg - Ls, b: vT, h: [-1, 0], w: wr },
      { k: 'att', side: 1, a0: a0, a1: a0 - Ld, w0: wr, w1: wr }, { k: 'att', side: 1, a0: a0 - Ld, a1: a0 - Ld - Lt, w0: wr, w1: 0.004 }] });
    const b0 = aT2 - Lg - Ls - 0.6;
    specs.push({ kind: 'foff', side: -1, end: far, z0: 'deck', z1: 'gnd', parts: [{ k: 'att', side: -1, a0: b0 - Ld - Lt, a1: b0 - Ld, w0: 0.004, w1: wr }, { k: 'att', side: -1, a0: b0 - Ld, a1: b0, w0: wr, w1: wr },
      { k: 'wp', a: aT2 - Lg - Ls, b: -vT, h: [1, 0], w: wr }, { k: 'wp', a: aT2 - Lg, b: -vT, h: [1, 0], w: wr, z: 'gnd' }, wpT(far, [1, 0])] });
  }
  T.reserve(F.sT(use.non || use.foff ? Math.min(aT1, aT2) - need : -0.5), F.sT(use.noff || use.fon ? Math.max(aT1, aT2) + need : 0.5));
  for (const sp of specs) {
    if (!use[sp.kind]) continue;
    const ln = realize(F, sp, os); if (!ln) continue;
    attachCuts(G, F, ln, os, sp.side);
    // 地面のはし：交差点に入れる（ふつうの道といっしょに 切り口を決める）
    if (sp.end) { ln.n1 = sp.end.id; ln.n0 = null; } else { ln.n0 = sp.start.id; ln.n1 = null; }
    ln.deckDraw = true; ln.ow = 1;
    D.add.push(ln); RAMPS.push({ ln, booth: sp.end ? ln.len - 0.32 : 0.32 });
  }
}
// JCT（3本）：トランペット型。わかれる高速（C）は J で 4つにわかれ、渡り線は 2階で 本線をこえる
function jctDesign(G, D, n, ex, adj, all) {
  const dirs = ex.map(outDir); let bi = 0, bj = 1, bd = Infinity;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const d = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]; if (d < bd) { bd = d; bi = i; bj = j; } }
  if (bd > -0.6) return;   // Y 字（まっすぐの組がない）：そのまま
  const C = ex[3 - bi - bj], T = mkThrough(n, ex[bi], ex[bj], adj);
  if (T.sN < 1 || T.len - T.sN < 1) return;
  const F = frameOf(n, T, outDir(C)), hw = Math.max(T.hw(T.sN - 0.5), T.hw(T.sN + 0.5)), os = hw - 0.5 * U, oa = os + RAMPW / 2, zN = T.z(T.sN);
  const others = all.filter(o => o.id !== n.id && o.nk === 'jct'), spP = T.free(F.sgn, others), spM = T.free(-F.sgn, others);   // IC は JCT のあとで あいているところに
  const vJ = hw + 3.4, zB = zN + LV2 * U;
  const q = { os, oa, Rl: 0.95, lc: 0.05, hs2: 0.1, vJ, zB, zJ: zN };
  let best = null;
  for (const vr of ['W', 'E']) {
    const ch = CHOICE.get(n.id); if (ch && ch !== vr) continue;
    let sp = trumpetSpec(q, vr, 1); if (spP < sp.needP || spM < sp.needM) sp = trumpetSpec(q, vr, 0.62);
    if (spP < sp.needP || spM < sp.needM) continue;
    const lines = sp.ramps.map(r => realize(F, r, os)).filter(Boolean); if (lines.length < 4) continue;
    const cl = clashes(lines); if (cl > 2) continue;   // ランプが ぶつかる形は やめる
    const sc = scoreLines(lines, bldCells(X.it, n.fx - 8, n.fy - 8, n.fx + 8, n.fy + 8), null) + cl * 40;
    if (!best || sc < best.sc) best = { vr, sp, lines, sc };
  }
  if (!best) return;
  CHOICE.set(n.id, best.vr);
  const { sp, lines } = best;
  // C を J の先まで かくす（切る）→ J からの つなぎ（高速の帯）
  const wC = walkExp(adj, n.id, C.s, C.e, 14), PC = mkLine(wC.P, {}), o = [0, 0, 0, 0];
  let dc = null; for (let d = 0; d <= PC.len; d += 0.1) { ptAt(PC.P, PC.L, PC.np, d, o); if (F.loc(o[0], o[1])[1] >= vJ + 0.9) { dc = d; break; } }
  if (dc == null) return;
  T.reserve(F.sT(-sp.needM), F.sT(sp.needP));
  for (const pc of wC.pcs) {
    if (pc.d0 >= dc) break;
    const cut = Math.min(pc.len, dc - pc.d0), t = ETRIM.get(pc.s.id) || [0, 0]; t[pc.e] = Math.max(t[pc.e], cut); ETRIM.set(pc.s.id, t);
  }
  ptAt(PC.P, PC.L, PC.np, dc, o); const dC = [o[2], o[3]], pJ = F.W(0, vJ), Wc = Math.max(0.4, C.s.w || 0.56), ep = expProf(wC.pcs[0].s);
  const pa = new Path(); pa.bez(o[0], o[1], -dC[0], -dC[1], pJ[0], pJ[1], -F.Vx, -F.Vy, 0.4, 0.4, 0.08);
  const zc = (() => { let acc = 0; for (const pc of wC.pcs) { if (dc <= acc + pc.len) { const sv = pc.e ? pc.len - (dc - acc) : dc - acc; return epZ(expProf(pc.s), sv); } acc += pc.len; } return zN; })();
  const con = mkLine(pa.a, {}), Lc = con.len, hsJ = 0.1 + RAMPW, hsC = Wc / 2 - 0.5 * U;
  const conDraw = () => deck(G, con, 0, Lc, { hw: sv => { const h = lerp(hsC, hsJ, sst((sv - Lc + 0.8) / 0.8)); return [h, h]; }, z: sv => lerp(zc, zN, sst(sv / Lc)), c: () => 1,
    tx: texExp(Math.max(1, C.s.l || 2), hsC * 100), med: true, pier: 0.9, gd: 2.4, step: 0.3, joint: M3.d < 60, rail: true });
  OBS.add(con.P, con.np, hsC, con.id);
  // 渡り線（J → B）：2車線・中央に分離帯。J の高さ → 本線の手前で 2階 → B
  const st = mkLine([...F.W(0, vJ), ...F.W(0, sp.vc)], {}), Ls2 = st.len, up = vJ - hw - 0.4;
  const stDraw = () => deck(G, st, 0, Ls2, { hw: () => [0.1, 0.1], z: sv => lerp(zN, zB, sst(sv / up)), c: () => 1, tx: texRamp2(), med: true, pier: 0.62, gd: 1.8, step: 0.25, joint: M3.d < 40, rail: true });
  OBS.add(st.P, st.np, 0.1, st.id);
  for (const ln of lines) { attachCuts(G, F, ln, os, ln.kind === 'noff' || ln.kind === 'non' ? 1 : -1); RAMPS.push({ ln }); }
  RAMPS.push({ draw: conDraw }, { draw: stDraw });
}
/* ---------- 駅をよこぎる道（t64c）：地面の駅（ホーム・線路）の上を 跨線橋で こえる ----------
   坂（7%）→ 橋（線路の上は 8m・駅の橋上駅舎のところは 13.5m）→ 坂。坂は 擁壁、高いところは 桁と橋脚（線路・ホームをよける） */
function stationRects() {
  const out = [], it = X.it;
  for (const t of X.sts || []) {
    if (t.k !== 'rail' || t.zl === 'U' || t.zl === 'E') continue;
    const sg = t.seg != null ? it.segs.get(t.seg) : null;
    if (sg && sg.pf && sg.L && sg.st) { const c = sg.st[Math.min(sg.st.length - 1, Math.max(0, Math.round(t.at || 0)))] || 'G'; if (c === 'V' || c === 'B' || c === 'T') continue; }
    const L = Math.max(0.4, (t.pl || 120) / 50), Wd = 0.22 * Math.max(1, t.tr || 1) + 0.18, a = t.a || 0;
    out.push({ t, x: t.fx, y: t.fy, c: Math.cos(a), s: Math.sin(a), hl: L / 2 + 0.25, hw: Wd / 2 + 0.2, hall: Math.min(0.6, L * 0.16 + 0.12) / 2 + 0.2 });
  }
  return out;
}
// 線路のファイル（M3RAIL）の しらべ：grade（駅の中・高速道路との 立体交差にする交わり）。遠いとき（しらべない）は null
const railGrade = () => { const RL = window.M3RAIL; return RL && !RL.fail && Array.isArray(RL.grade) && M3.d <= 40 ? RL.grade : null; };
const HUMPC = new Map();   // 道の id → 跨線橋の高さ（地面から。近くで しらべたとき おぼえる：遠くても 同じ形に）
function humps(ords, adj) {
  const R = stationRects(), GR = railGrade(), RL = window.M3RAIL && !window.M3RAIL.fail;
  for (const r of R) { const P = [r.x - r.c * r.hl, r.y - r.s * r.hl, r.x + r.c * r.hl, r.y + r.s * r.hl]; OBS.add(P, 2, r.hw, 'st' + r.t.id); }
  // 線路のファイルの しらべ：道の id → [レールの上の高さ（いちばん高い）, 交わる点…]
  const want = new Map();
  if (GR) for (const g of GR) if (g.k === 'sta' || g.k === 'ovp') { let w = want.get(g.road);   // ovp（t66）：斜め・都心の大きな道・線路と重なる道も 跨線橋に
     if (!w) want.set(g.road, w = { h: -Infinity, pts: [] }); w.h = Math.max(w.h, g.h); w.pts.push([g.x, g.y]); }
  if (!R.length && !want.size) return;
  const deg = nid => nid == null ? 0 : (adj.get(nid) || []).length;
  for (const s of ords) {
    if (s.vir || s.pf || !s.bb) continue;
    const w = want.get(s.id); if (GR && !w) continue;   // しらべがあれば それだけ（駅舎は 道をよけて置かれている）
    const near = R.filter(r => s.bb[0] <= r.x + r.hl + 0.3 && s.bb[2] >= r.x - r.hl - 0.3 && s.bb[1] <= r.y + r.hl + 0.3 && s.bb[3] >= r.y - r.hl - 0.3);
    if (!near.length && !w) continue;
    const q = qOf(s), len = q.len, hw = (s.w || 0.2) / 2, pt = [0, 0, 0, 0];
    let a = Infinity, b = -Infinity, hall = false, par = false;
    for (let sv = 0; sv <= len; sv += 0.05) {
      ptAt(s.P, q.L, s.np, sv, pt);
      for (const r of near) {
        const dx = pt[0] - r.x, dy = pt[1] - r.y, u = dx * r.c + dy * r.s, v2 = -dx * r.s + dy * r.c;
        if (Math.abs(u) <= r.hl + hw && Math.abs(v2) <= r.hw + hw) {
          if (Math.abs(pt[2] * r.s - pt[3] * r.c) < 0.5) par = true;   // 駅にそって走る道（よこぎらない）
          a = Math.min(a, sv); b = Math.max(b, sv); if (Math.abs(u) < r.hall + hw) hall = true;
        }
      }
    }
    if (w) for (const p2 of w.pts) { let bs = 0, bd = Infinity; for (let sv = 0; sv <= len; sv += 0.05) { ptAt(s.P, q.L, s.np, sv, pt); const d = hyp(pt[0] - p2[0], pt[1] - p2[1]); if (d < bd) { bd = d; bs = sv; } } a = Math.min(a, bs - 0.3); b = Math.max(b, bs + 0.3); }
    else if (par) continue;
    if (a > b) continue;
    a = Math.max(0.05, a); b = Math.min(len - 0.05, b); if (a > b) continue;
    // 高さ：レールの上から 6.5m あけて 桁（1.6m）→ 路面は レールの上から 8.3m（しらべがないときは 地面から。前に しらべた高さが あれば それ）
    let gmax = -Infinity; for (let sv = Math.max(0, a - 0.1); sv <= Math.min(len, b + 0.1); sv += 0.1) { ptAt(s.P, q.L, s.np, sv, pt); gmax = Math.max(gmax, m3Surf(pt[0], pt[1])); }
    let top;
    if (w) { top = Math.max(w.h + 8.3 * U, gmax + 8.5 * U); HUMPC.set(s.id, top - gmax); }
    else top = gmax + (HUMPC.get(s.id) || (RL ? 9.3 : hall ? 13.5 : 9.3) * U);
    const Hc = (top - gmax) / U;
    // 坂の長さ（7%）：はしの交差点から 0.8 マスは 地面のまま
    const m0 = deg(s.n0) >= 3 ? 0.8 : 0.25, m1 = deg(s.n1) >= 3 ? 0.8 : 0.25, wantL = Hc / 0.07 * U;
    const L0 = clamp(a - m0, 0.4, wantL), L1 = clamp(len - m1 - b, 0.4, wantL), s0 = a - L0, s1 = b + L1;
    const g = sv => { ptAt(s.P, q.L, s.np, sv, pt); return m3Surf(pt[0], pt[1]); };
    const zf = sv => sv <= s0 || sv >= s1 ? null : sv < a ? lerp(g(sv), top, sst((sv - s0) / L0)) : sv > b ? lerp(top, g(sv), sst((sv - b) / L1)) : top;
    const cf = sv => { const z = zf(sv); return z != null && z - g(sv) > 4.5 * U ? 'V' : 'G'; };
    HUMP.set(s.id, { zf, cf });
    PROF.set(s.id, { zf });
  }
}
// 高速と線路の交わり：高架の桁の下を レールの上から 6.5m あける（足りなければ そこを高く。高架の線路の上も こえる）
function railClear(exps, adj) {
  const GR = railGrade(), rails = []; for (const s of X.segs) if (s.k === 'rail' && s.np >= 2) rails.push(s);
  if (!rails.length) return;
  const grid = new Map(), key = (x, y) => Math.floor(x) * 73856093 ^ Math.floor(y) * 19349663;
  for (const r of rails) for (let i = 0; i < r.np - 1; i++) {
    const ax = r.P[2 * i], ay = r.P[2 * i + 1], bx = r.P[2 * i + 2], by = r.P[2 * i + 3];
    for (let gy = Math.floor(Math.min(ay, by)); gy <= Math.floor(Math.max(ay, by)); gy++) for (let gx = Math.floor(Math.min(ax, bx)); gx <= Math.floor(Math.max(ax, bx)); gx++) { const k = key(gx, gy); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(r, i); }
  }
  for (const s of exps) {
    if (s.pf && s.st && !/[GV]/.test(s.st)) continue;
    const q = qOf(s), P = s.P, hits = [];
    for (let i = 0; i < s.np - 1; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], seen = new Set();
      for (let gy = Math.floor(Math.min(ay, by)); gy <= Math.floor(Math.max(ay, by)); gy++) for (let gx = Math.floor(Math.min(ax, bx)); gx <= Math.floor(Math.max(ax, bx)); gx++) {
        const a = grid.get(key(gx, gy)); if (!a) continue;
        for (let k = 0; k < a.length; k += 2) {
          const r = a[k], j = a[k + 1], tag = r.id + ':' + j; if (seen.has(tag)) continue; seen.add(tag);
          const cx = r.P[2 * j], cy = r.P[2 * j + 1], dx = r.P[2 * j + 2], dy = r.P[2 * j + 3], den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(den) < 1e-12) continue;
          const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den; if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, sv = q.L[i] + (q.L[i + 1] - q.L[i]) * t;
          // レールの上の高さ：線路のファイルの しらべ → 線路の縦断（高架・橋）→ 地面
          let h = null; if (GR) for (const g of GR) if (g.road === s.id && hyp(g.x - x, g.y - y) < 0.3) h = Math.max(h == null ? -Infinity : h, g.h);
          if (h == null) { let rs = 0; for (let m = 0; m < j; m++) rs += hyp(r.P[2 * m + 2] - r.P[2 * m], r.P[2 * m + 3] - r.P[2 * m + 1]); rs += hyp(dx - cx, dy - cy) * u;
            const c = r.pf && r.L && r.st ? (r.st[Math.min(r.st.length - 1, Math.max(0, Math.round(rs)))] || 'G') : 'G';
            if (c === 'T') continue; h = (c === 'V' || c === 'B') && r.pf ? pfZ(r.pf, rs) * U * VEX + 0.6 * U : m3Surf(x, y) + LIFT + 0.5 * U; }
          hits.push([sv, h + (6.5 + 2.6 + 0.4) * U]);
        }
      }
    }
    if (!hits.length) continue;
    const ep = expProf(s);
    for (const [sv, need] of hits) {
      const z0 = epZ(ep, sv); if (z0 >= need) continue;
      const H = need - z0; let a = BUMP.get(s.id); if (!a) BUMP.set(s.id, a = []); a.push({ c: sv, H });
      // はしの近く：つづく高速にも（段にならないように）
      for (const e of [0, 1]) {
        const d = e ? q.len - sv : sv, nid = e ? s.n1 : s.n0; if (d > 5.6 || nid == null) continue;
        for (const o of (adj.get(nid) || [])) { if (o.s === s || o.s.c !== 'exp') continue; const w = walkExp(adj, nid, o.s, o.e, 6); for (const pc of w.pcs) { let b2 = BUMP.get(pc.s.id); if (!b2) BUMP.set(pc.s.id, b2 = []); b2.push({ e: pc.e, d0: pc.d0 + d, H }); } }
      }
    }
    s._ep = null;
  }
  for (const s of exps) s._ep = null;
}

/* ---------- SA・PA（t64c）：高速のとなりの 建物（kind が sa・pa）へ 出入りのランプ ---------- */
function mkThroughSeg(s, sv0) {
  const q = qOf(s), a = Math.max(0, sv0 - 13), b = Math.min(q.len, sv0 + 13), pts = subPts(s.P, q.L, s.np, a, b, 0, 0, 0.3);
  const T = mkLine(pts, {}); T.sN = sv0 - a;
  const map = sT => [s, clamp(a + sT, 0, q.len), 1];
  T.map = map; T.z = sT => epZ(expProf(s), map(sT)[1]); T.hw = () => Math.max(0.2, (s.w || 0.56) / 2);
  T.cut = (a0, a1, sd) => { let c = CUTS.get(s.id); if (!c) CUTS.set(s.id, c = []); c.push([Math.min(a0, a1) + a - 0.03, Math.max(a0, a1) + a + 0.03, sd]); };
  T.reserve = (a0, a1) => { let r = RES.get(s.id); if (!r) RES.set(s.id, r = []); r.push([Math.min(a0, a1) + a, Math.max(a0, a1) + a]); };
  T.free = dir => { const r = RES.get(s.id) || [], lim = dir > 0 ? T.len - T.sN : T.sN; for (let d = 0.25; d < lim; d += 0.25) { const sv = a + T.sN + dir * d; if (r.some(x => sv >= x[0] && sv <= x[1])) return Math.max(0, d - 0.4); } return lim - 0.3; };
  return T;
}
function saDesign(G, D, exps) {
  const it = X.it, v = X.v;
  for (const b of it.blds.values()) {
    if ((b.kind !== 'sa' && b.kind !== 'pa') || !b.bb || b.bb[2] < v.x0 || b.bb[0] > v.x1 || b.bb[3] < v.y0 || b.bb[1] > v.y1) continue;
    // いちばん近い 高速
    let best = null;
    for (const s of exps) {
      if (s.bb[2] < b.bb[0] - 4 || s.bb[0] > b.bb[2] + 4 || s.bb[3] < b.bb[1] - 4 || s.bb[1] > b.bb[3] + 4) continue;
      const q = qOf(s), pt = [0, 0, 0, 0];
      for (let sv = 0; sv <= q.len; sv += 0.25) { ptAt(s.P, q.L, s.np, sv, pt); const d = hyp(pt[0] - b.cx, pt[1] - b.cy); if (!best || d < best.d) best = { s, sv, d, x: pt[0], y: pt[1] }; }
    }
    if (!best || best.d > hyp(b.bb[2] - b.bb[0], b.bb[3] - b.bb[1]) / 2 + 3) continue;
    const T = mkThroughSeg(best.s, best.sv), F = frameOf({ fx: best.x, fy: best.y }, T, [b.cx - best.x, b.cy - best.y]);
    const hw = T.hw(), os = hw - 0.5 * U, wr = RAMPW;
    // 敷地の はし（高速にそう向き a の はんい・高速に近いがわ b）
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity;
    for (const k of b.set) { const i = k.indexOf(','), x = (+k.slice(0, i) + 0.5) / 5, y = (+k.slice(i + 1) + 0.5) / 5, l = F.loc(x, y); a0 = Math.min(a0, l[0]); a1 = Math.max(a1, l[0]); b0 = Math.min(b0, l[1]); }
    if (b0 < hw + 0.1) b0 = hw + 0.1;
    const Ls = 3.0, Ld = 1.4, Lt = 0.9, bE = Math.max(b0 + 0.15, os + wr + 0.25), aE = a1 - 0.3, aX = a0 + 0.3;
    if (T.free(F.sgn) < aE + Ls + 0.6 + Ld + Lt + 0.2 - 0 || T.free(-F.sgn) < -(aX - Ls - 0.6 - Ld - Lt) + 0.2) continue;
    const spOff = { kind: 'noff', z0: 'deck', z1: 'gnd', parts: [{ k: 'att', side: 1, a0: aE + Ls + 0.6 + Ld + Lt, a1: aE + Ls + 0.6 + Ld, w0: 0.004, w1: wr }, { k: 'att', side: 1, a0: aE + Ls + 0.6 + Ld, a1: aE + Ls + 0.6, w0: wr, w1: wr },
      { k: 'wp', a: aE + 0.8, b: bE, h: [-1, 0], w: wr }, { k: 'wp', a: aE, b: bE + 0.12, h: [-0.7, 0.7], w: wr, z: 'gnd' }] };
    const spOn = { kind: 'non', z0: 'gnd', z1: 'deck', parts: [{ k: 'wp', a: aX, b: bE + 0.12, h: [-0.7, -0.7], w: wr, z: 'gnd' }, { k: 'wp', a: aX - 0.8, b: bE, h: [-1, 0], w: wr },
      { k: 'att', side: 1, a0: aX - Ls - 0.6, a1: aX - Ls - 0.6 - Ld, w0: wr, w1: wr }, { k: 'att', side: 1, a0: aX - Ls - 0.6 - Ld, a1: aX - Ls - 0.6 - Ld - Lt, w0: wr, w1: 0.004 }] };
    T.reserve(F.sT(aX - Ls - 2.6), F.sT(aE + Ls + 2.6));
    for (const sp of [spOff, spOn]) { const ln = realize(F, sp, os); if (!ln) continue; attachCuts(G, F, ln, os, 1); RAMPS.push({ ln }); }
  }
}
// 設計のあと（ふつうの道の切り口が決まってから）：ランプ・料金所を描く
function after(G, D, trim) {
  const fs = [];
  for (const r of RAMPS) { if (r.draw) { fs.push(r.draw); continue; } const tr = trim && trim.get(r.ln); fs.push(drawRamp(G, r.ln, tr ? [tr[0], tr[1]] : null)); if (r.booth != null) fs.push(() => rampBooth(G, r.ln, r.booth)); }
  for (const f of fs) f();   // じゃまもの（橋脚をよける）に 先に みんな入れてから
}
const M3ROAD = { build, runY, off };
window.M3ROAD = M3ROAD;
})();
