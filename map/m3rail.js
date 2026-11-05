(function () {
'use strict';
/* ===== 線路の 3D（t64c）：map3d.js が 3D をひらくときに読む（window.M3RAIL）=====
   build(X)：建物・道路を作りなおすたびに、近くの線路・駅・踏切を X.grp に足す。off・runY：列車をレールの上に。car：車両の大きさ（m）
   ・道床（バラスト）と枕木・レール（絵。近くはレールの形も）・路盤・盛土・線路わきの柵（まち）
   ・架線（電柱・ビーム・ちょう架線・トロリ線・き電線。架線の種類で）・第三軌条・防音壁・雪よけ
   ・高架橋（ラーメン高架：柱・はり・高欄。道路の上には柱を立てない）・橋（ガーダー橋・トラス橋・橋脚）・トンネルの入口・車止め
   ・踏切（遮断機・警報機・止まれの線。列車が近づくと 赤い灯が かわりばんこに ついて しまる）
   ・駅（ホーム・点字ブロック・屋根・橋上駅舎／駅舎と跨線橋・高架駅・地下駅の出入口・待避線と分かれ目）
   遠いほど かんたんに（レール・架線は近くだけ・遠くは 道床と枕木の絵だけ）
   道路とかさなるところ：地面どうしは踏切（駅の中・高速道路はのぞく）。高架・橋の下の道路には柱を立てない。高い盛土の下の道路は 短い橋で */
const U = 1 / 50;   // 1m（マス）
let X = null, T3 = null, M3 = null, GEN = 0, LIFT = 0.02, VEX = 1.15, UG = false;   // UG：地下ビュー（DB の更新109）
let LQ = [4, 8, 15], CEN = { x: 0, y: 0, h: 0 }, NODES = new Map(), RIDX = null;

// ---- 寸法（m） ----
const GAUGE = { 762: [1.5, 3.2], 1067: [2.0, 3.8], 1372: [2.2, 3.8], 1435: [2.4, 4.0] };   // 軌間（mm）：[枕木の長さ, 複線の線路の間]
const ZT = -0.16, ZF = -0.62;            // 道床の上（枕木の上）・路盤（レールの上から m）
const PH = 1.1, PE = 1.55;               // ホームの高さ（レールの上から）・線路のまん中から ホームのはしまで
const CWH = 5.1, MWH = 6.05;             // トロリ線・ちょう架線の高さ（レールの上から。電柱のところ）
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const isW = ch => ch === 'R' || ch === 'L' || ch === 'S' || ch === 'D';
const DECK = { V: 1, B: 1, W: 1, O: 1 };   // 高架・橋（W：水の上の地面の線・O：道路をまたぐ盛土の線）

// ---- 色（0〜1） ----
const CL = {
  bal: [0.50, 0.48, 0.45], balS: [0.44, 0.42, 0.39], form: [0.56, 0.53, 0.48], emb: [0.47, 0.52, 0.37], wallR: [0.70, 0.69, 0.65], trough: [0.74, 0.74, 0.71],
  fence: [0.62, 0.63, 0.61], fenceT: [0.70, 0.71, 0.69],
  conc: [0.73, 0.72, 0.69], concD: [0.64, 0.63, 0.60], concB: [0.58, 0.58, 0.56], slab: [0.68, 0.68, 0.66],
  railT: [0.82, 0.83, 0.85], railS: [0.36, 0.30, 0.26], steel: [0.62, 0.64, 0.66], steelD: [0.45, 0.47, 0.50], poleC: [0.78, 0.78, 0.75],
  plat: [0.79, 0.78, 0.75], platS: [0.64, 0.63, 0.60], edge: [0.93, 0.93, 0.91], tact: [0.94, 0.79, 0.16],
  roofT: [0.56, 0.59, 0.62], roofB: [0.87, 0.87, 0.85], col: [0.86, 0.86, 0.86],
  bldW: [0.91, 0.90, 0.87], glass: [0.40, 0.50, 0.58], bldR: [0.56, 0.58, 0.61], bldB: [0.80, 0.79, 0.76],
  nw: [0.66, 0.73, 0.76], nwT: [0.56, 0.62, 0.66],
  xpan: [0.25, 0.25, 0.26], yel: [0.96, 0.80, 0.12], blk: [0.10, 0.10, 0.11], white: [0.96, 0.96, 0.94], post: [0.88, 0.88, 0.86],
  dark: [0.05, 0.05, 0.06], buf: [0.85, 0.20, 0.16],
  snow: [0.55, 0.57, 0.60], bus: [0.26, 0.45, 0.78], busR: [0.80, 0.82, 0.84]
};
const PAINT = [[0.40, 0.50, 0.48], [0.56, 0.30, 0.25], [0.55, 0.62, 0.68], [0.62, 0.60, 0.42]];   // 鉄の橋の色（緑がかった灰・赤さび色・水色がかった灰・黄土）

/* ---------- 線ごとの規格 ---------- */
function spec(sg) {
  const ga = GAUGE[sg.ga] ? sg.ga : 1067, g2 = sg.g2 && GAUGE[sg.g2] && sg.g2 !== ga ? sg.g2 : 0;
  const hs = ga === 1435 && (sg.v || 0) >= 200;   // 高速の標準軌の線：線路の間を広く
  const sp = hs ? 4.3 : GAUGE[ga][1], n = sg.q ? 4 : sg.dbl ? 2 : 1;
  const offs = n === 4 ? [sp * 1.5 + 0.7, sp / 2, -sp / 2, -sp * 1.5 - 0.7] : n === 2 ? [sp / 2, -sp / 2] : [0];
  const sl = sg.sl === 1 || sg.sl === 2 || sg.sl === 3 ? sg.sl : 0;
  const slen = Math.max(GAUGE[ga][0], g2 ? GAUGE[g2][0] : 0) + (g2 ? 0.15 : 0);
  const r1 = -(ga / 2000 + 0.0325), rails = [r1, ga / 2000 + 0.0325];
  if (g2) rails.push(r1 + g2 / 1000 + 0.065);   // 三線軌条（片がわのレールは共通）
  const el = !!sg.el, ct0 = el ? (sg.ct >= 0 && sg.ct <= 6 ? sg.ct : 0) : -1, third = el && (ct0 === 6 || sg.ps === 3);
  return { ga, g2, n, sp, offs, sl, slab: sl === 3, slen, wt: slen + 0.9, rails, el, ct: third ? 6 : ct0, third, nw: sg.nw === 1 || sg.nw === 2 ? sg.nw : 0,
           snow: sg.sp === 1 || sg.sp === 2 ? sg.sp : 0, key: ga + ':' + g2 + ':' + sl, row: Math.max(0, (sg.w || 0) * 25), hs };
}

/* ---------- 線ごとの おぼえ（点までの長さ・高さを出す こまかい点・法線・電柱の位置） ---------- */
const SC = new WeakMap();
function segC(sg) {
  let C = SC.get(sg);
  if (C && C.P === sg.P && C.np === sg.np) return C;
  const P = sg.P, n = sg.np, cl = new Float32Array(n);
  for (let i = 1; i < n; i++) cl[i] = cl[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
  const ds = [];   // こまかい点：もとの点と、0.3マスより長い区間は等分（高さは ここで出して、あいだは まっすぐ）
  for (let i = 0; i < n; i++) { ds.push(cl[i]); if (i < n - 1) { const D = cl[i + 1] - cl[i], m = Math.ceil(D / 0.3 - 1e-6); for (let k = 1; k < m; k++) ds.push(cl[i] + D * k / m); } }
  C = { sg, P, np: n, cl, len: n ? cl[n - 1] : 0, ds: Float32Array.from(ds), rt: new Float32Array(ds.length), wf: new Uint8Array(ds.length), gen: -1,
        nrm: new Float32Array(2 * n), poles: null, sp: spec(sg), sta: [], xr: [], cv: [null, null], cuts: [] };
  SC.set(sg, C); return C;
}
// 線の上の s（マス）の区間の番号
function loc(C, s) {
  const cl = C.cl; let lo = 0, hi = C.np - 1;
  if (hi < 1 || s <= 0) return 0;
  if (s >= cl[hi]) return hi - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cl[m] <= s) lo = m; else hi = m; }
  return lo;
}
// 線の上の s の点・向き（t）・左向き（n：つぎめで となりとそろえた法線。曲がりで少し長い）
function at(C, s, o) {
  const P = C.P, i = loc(C, s), j = Math.min(C.np - 1, i + 1), D = C.cl[j] - C.cl[i], f = D > 1e-9 ? Math.max(0, Math.min(1, (s - C.cl[i]) / D)) : 0;
  const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * j], by = P[2 * j + 1], L = Math.hypot(bx - ax, by - ay);
  o.x = ax + (bx - ax) * f; o.y = ay + (by - ay) * f;
  if (L > 1e-9) { o.tx = (bx - ax) / L; o.ty = (by - ay) / L; } else { o.tx = -C.nrm[2 * i + 1]; o.ty = C.nrm[2 * i]; }
  const N = C.nrm; o.nx = N[2 * i] + (N[2 * j] - N[2 * i]) * f; o.ny = N[2 * i + 1] + (N[2 * j + 1] - N[2 * i + 1]) * f;
  o.s = s; return o;
}
const codeS = (sg, s) => sg.pf && sg.L && sg.st ? (sg.st[Math.min(sg.st.length - 1, Math.max(0, Math.round(s)))] || 'G') : 'G';
// こまかい点 k のレールの上の高さ（マス）：地面の線は 地形の面＋1m（縦断があれば その高さより下にしない）・高架・橋・トンネルは 縦断の高さ
const TP = {};
function rtK(C, k) {
  if (C.gen !== GEN) { C.rt.fill(NaN); C.wf.fill(0); C.gen = GEN; }
  const v = C.rt[k]; if (v === v) return v;
  const s = C.ds[k]; at(C, s, TP);
  const g = X.m3Surf(TP.x, TP.y), sg = C.sg; let r = g;
  if (sg.pf && sg.L) { const z = X.pfZ(sg.pf, s) * U * VEX, c = codeS(sg, s); r = c === 'V' || c === 'B' || c === 'T' ? z : Math.max(z, g); }
  return (C.rt[k] = r + LIFT);
}
// s のところの高さを、つくり c として（トンネルの入口：外がわの高さ）
function rtAt(C, s, c) {
  at(C, s, TP); const g = X.m3Surf(TP.x, TP.y), sg = C.sg;
  if (!(sg.pf && sg.L)) return g + LIFT;
  const z = X.pfZ(sg.pf, s) * U * VEX; return (c === 'V' || c === 'B' ? z : Math.max(z, g)) + LIFT;
}
function dloc(C, s) {
  const d = C.ds; let lo = 0, hi = d.length - 1;
  if (hi < 1 || s <= 0) return 0;
  if (s >= d[hi]) return hi - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= s) lo = m; else hi = m; }
  return lo;
}
function rtS(C, s) {
  const k = dloc(C, s), d = C.ds; if (d.length < 2) return rtK(C, 0);
  const a = rtK(C, k), b = rtK(C, k + 1), D = d[k + 1] - d[k];
  return D > 1e-9 ? a + (b - a) * Math.max(0, Math.min(1, (s - d[k]) / D)) : a;
}
// 線のはしの向き（はしの点から 線の中へ）
function endDir(C, e) {
  const P = C.P, n = C.np, i0 = e ? n - 1 : 0;
  for (let k = 1; k < n; k++) { const j = e ? n - 1 - k : k, dx = P[2 * j] - P[2 * i0], dy = P[2 * j + 1] - P[2 * i0 + 1], L = Math.hypot(dx, dy); if (L > 0.01) return [dx / L, dy / L]; }
  return [1, 0];
}
// 点ごとの左向き（前後の区間の向きの まん中。するどい曲がりは 2倍まで）
function normals(C) {
  const P = C.P, n = C.np, N = C.nrm; let px = 0, py = 0, has = false;
  for (let i = 0; i < n; i++) {
    let qx = 0, qy = 0, hq = false;
    if (i < n - 1) { const dx = P[2 * i + 2] - P[2 * i], dy = P[2 * i + 3] - P[2 * i + 1], L = Math.hypot(dx, dy); if (L > 1e-9) { qx = dy / L; qy = -dx / L; hq = true; } }
    let ux, uy;
    if (has && hq) { ux = px + qx; uy = py + qy; const L = Math.hypot(ux, uy); if (L < 1e-6) { ux = qx; uy = qy; } else { ux /= L; uy /= L; const cs = Math.max(0.5, ux * qx + uy * qy); ux /= cs; uy /= cs; } }
    else if (hq) { ux = qx; uy = qy; } else if (has) { ux = px; uy = py; } else { ux = 0; uy = 1; }
    N[2 * i] = ux; N[2 * i + 1] = uy;
    if (hq) { px = qx; py = qy; has = true; }
  }
}
// つぎめ：2本の線（分かれ目は いちばん まっすぐ つづく2本）の はしの左向きを そろえる。線路の数が へるところは よせる
function joins() {
  for (const L of NODES.values()) {
    if (L.length < 2) continue;
    let pair = null;
    if (L.length === 2) pair = [L[0], L[1]];
    else { let best = -0.6; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = endDir(L[i].C, L[i].e), b = endDir(L[j].C, L[j].e), d = a[0] * b[0] + a[1] * b[1]; if (d < best) { best = d; pair = [L[i], L[j]]; } } }
    if (!pair) continue;
    const [A, B] = pair, da = endDir(A.C, A.e), db = endDir(B.C, B.e);
    if (da[0] * db[0] + da[1] * db[1] > -0.3) continue;   // 折れすぎ
    // A から節点へ入る向き ta = −da、B へ出る向き = db
    const n1x = -da[1], n1y = da[0], n2x = db[1], n2y = -db[0];
    let mx = n1x + n2x, my = n1y + n2y; const ML = Math.hypot(mx, my); if (ML < 1e-6) continue;
    mx /= ML; my /= ML; const cs = Math.max(0.5, mx * n1x + my * n1y); mx /= cs; my /= cs;
    const set = (o, f) => { const i = o.e ? o.C.np - 1 : 0; o.C.nrm[2 * i] = mx * f; o.C.nrm[2 * i + 1] = my * f; };
    set(A, A.e ? 1 : -1); set(B, B.e ? -1 : 1);
    // 線路の数が へる（複線 → 単線など）：多いほうの線を、はしの 40m で よせる
    const sa = A.C.sp, sb = B.C.sp, same = A.e !== B.e;   // same：線の向きが同じ（左が左）
    if (sa.n > sb.n) A.C.cv[A.e] = { offs: sb.offs.map(o => same ? o : -o), L: 0.8 };
    if (sb.n > sa.n) B.C.cv[B.e] = { offs: sa.offs.map(o => same ? o : -o), L: 0.8 };
  }
}
function conv(C, s, o) {
  for (let e = 0; e < 2; e++) {
    const v = C.cv[e]; if (!v) continue;
    const dd = e ? C.len - s : s; if (dd >= v.L) continue;
    let tg = v.offs[0]; for (const q of v.offs) if (Math.abs(q - o) < Math.abs(tg - o)) tg = q;
    o = tg + (o - tg) * smooth(Math.max(0, dd / v.L));
  }
  return o;
}
// 節点で つづく線（いちばん まっすぐ）：{ C, e }
function nextSeg(C, e, node) {
  const L = node != null ? NODES.get(node) : null; if (!L) return null;
  const d0 = endDir(C, e); let best = 0.5, r = null;   // 進む向き（はしから外へ）= −d0
  for (const o of L) { if (o.C === C) continue; const d = endDir(o.C, o.e), dt = -(d0[0] * d[0] + d0[1] * d[1]); if (dt > best) { best = dt; r = o; } }
  return r;
}

/* ---------- 形の入れもの（位置・法線・色・絵の位置。四角ごとに 4 点） ---------- */
function GB(uv) { this.cap = 4096; this.P = new Float32Array(this.cap * 3); this.N = new Float32Array(this.cap * 3); this.C = new Float32Array(this.cap * 3); this.T = uv ? new Float32Array(this.cap * 2) : null; this.I = new Uint32Array(this.cap * 2); this.nv = 0; this.ni = 0; }
GB.prototype.grow = function (nv, ni) {
  if (this.nv + nv > this.cap) {
    let c = this.cap; while (this.nv + nv > c) c *= 2;
    const r = (a, k) => { const b = new Float32Array(c * k); b.set(a.subarray(0, this.nv * k)); return b; };
    this.P = r(this.P, 3); this.N = r(this.N, 3); this.C = r(this.C, 3); if (this.T) this.T = r(this.T, 2); this.cap = c;
  }
  if (this.ni + ni > this.I.length) { let c = this.I.length; while (this.ni + ni > c) c *= 2; const b = new Uint32Array(c); b.set(this.I.subarray(0, this.ni)); this.I = b; }
};
GB.prototype.v = function (p, nx, ny, nz, col) {
  const i = this.nv++, o = i * 3; this.P[o] = p[0]; this.P[o + 1] = p[1]; this.P[o + 2] = p[2]; this.N[o] = nx; this.N[o + 1] = ny; this.N[o + 2] = nz;
  this.C[o] = col[0]; this.C[o + 1] = col[1]; this.C[o + 2] = col[2]; return i;
};
// 四角（a b c d の順）。法線は 対角線の外積から（両面の質感なので、向きと面の表裏が いつも合う）
GB.prototype.q = function (a, b, c, d, col, uv) {
  this.grow(4, 6);
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
  const i = this.v(a, nx, ny, nz, col); this.v(b, nx, ny, nz, col); this.v(c, nx, ny, nz, col); this.v(d, nx, ny, nz, col);
  if (uv && this.T) { const T = this.T, o = i * 2; for (let k = 0; k < 8; k++) T[o + k] = uv[k]; }
  const I = this.I, n = this.ni; I[n] = i; I[n + 1] = i + 1; I[n + 2] = i + 2; I[n + 3] = i; I[n + 4] = i + 2; I[n + 5] = i + 3; this.ni += 6;
};
GB.prototype.t = function (a, b, c, col) {
  this.grow(3, 3);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
  const i = this.v(a, nx, ny, nz, col); this.v(b, nx, ny, nz, col); this.v(c, nx, ny, nz, col);
  const I = this.I, n = this.ni; I[n] = i; I[n + 1] = i + 1; I[n + 2] = i + 2; this.ni += 3;
};
// 箱：まん中 (x, z)・長さの向き (ux, uz)（単位）・半分の長さ hl・半分のはば hw（マス）・高さ y0〜y1
GB.prototype.box = function (x, z, ux, uz, hl, hw, y0, y1, col, bot) {
  const vx = -uz, vz = ux, c = (a, b, y) => [x + ux * a + vx * b, y, z + uz * a + vz * b];
  const a0 = c(-hl, -hw, y0), b0 = c(hl, -hw, y0), c0 = c(hl, hw, y0), d0 = c(-hl, hw, y0), a1 = c(-hl, -hw, y1), b1 = c(hl, -hw, y1), c1 = c(hl, hw, y1), d1 = c(-hl, hw, y1);
  this.q(a1, b1, c1, d1, col); this.q(a0, b0, b1, a1, col); this.q(b0, c0, c1, b1, col); this.q(c0, d0, d1, c1, col); this.q(d0, a0, a1, d1, col);
  if (bot) this.q(a0, d0, c0, b0, col);
};
// 2点のあいだの棒（はば w・高さ h：マス）
GB.prototype.bar = function (p, q, w, h, col) {
  const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2], L = Math.hypot(ax, ay, az); if (L < 1e-7) return;
  let sx = az, sy = 0, sz = -ax; let sl = Math.hypot(sx, sz); if (sl < 1e-6 * L) { sx = 1; sz = 0; sl = 1; }
  sx /= sl; sz /= sl;   // 横（水平）
  let ux = sy * az - sz * ay, uy = sz * ax - sx * az, uz = sx * ay - sy * ax; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;   // 上
  if (uy < 0) { ux = -ux; uy = -uy; uz = -uz; }
  const c = (P, a, b) => [P[0] + sx * a + ux * b, P[1] + sy * a + uy * b, P[2] + sz * a + uz * b], hw = w / 2, hh = h / 2;
  const p1 = c(p, -hw, -hh), p2 = c(p, hw, -hh), p3 = c(p, hw, hh), p4 = c(p, -hw, hh), q1 = c(q, -hw, -hh), q2 = c(q, hw, -hh), q3 = c(q, hw, hh), q4 = c(q, -hw, hh);
  this.q(p4, p3, q3, q4, col); this.q(p1, p2, q2, q1, col); this.q(p2, p3, q3, q2, col); this.q(p1, p4, q4, q1, col);
};
GB.prototype.mesh = function (mat) {
  const g = new T3.BufferGeometry(), n = this.nv;
  g.setAttribute('position', new T3.BufferAttribute(this.P.subarray(0, n * 3), 3));
  g.setAttribute('normal', new T3.BufferAttribute(this.N.subarray(0, n * 3), 3));
  g.setAttribute('color', new T3.BufferAttribute(this.C.subarray(0, n * 3), 3));
  if (this.T) g.setAttribute('uv', new T3.BufferAttribute(this.T.subarray(0, n * 2), 2));
  g.setIndex(new T3.BufferAttribute(n > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni)), 1));
  return new T3.Mesh(g, mat);
};
// 線（電線）
function LB() { this.a = []; }
LB.prototype.l = function (p, q) { this.a.push(p[0], p[1], p[2], q[0], q[1], q[2]); };

/* ---------- 質感（おぼえておく。keep：場面を片づけても すてない） ---------- */
const MAT = {}, TEX = new Map();
const keep = m => { m.keep = true; return m; };
function matV() { return MAT.v || (MAT.v = keep(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }))); }
function matU() { return MAT.u || (MAT.u = keep(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }))); }   // 地下ビューの トンネルの中（DB の更新109）
function matX() { return MAT.x || (MAT.x = keep(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }))); }
function matL(k) { return MAT['l' + k] || (MAT['l' + k] = keep(new T3.LineBasicMaterial({ color: k === 1 ? '#3a3632' : '#2a2c2e' }))); }
function matT(sp) {
  const k = 't' + sp.key; if (MAT[k]) return MAT[k];
  return (MAT[k] = keep(new T3.MeshLambertMaterial({ map: trackTex(sp), side: T3.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
}
// 枕木とレールの絵（1本の線路ぶん。横：枕木の長さ＋0.9m・たて：枕木 4本ぶん 2.4m（スラブは 4.8m））
function trackTex(sp) {
  let t = TEX.get(sp.key); if (t) return t;
  const W = 256, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const wt = sp.wt, rep = sp.slab ? 4.8 : 2.4, Xm = m => (m + wt / 2) / wt * W, Ym = m => m / rep * H;
  let r = 9301 + sp.ga + sp.sl * 77; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  if (sp.slab) {   // スラブ：コンクリートの路盤・板（2.34m）・板のつぎめ・締結装置
    g.fillStyle = '#9d9c97'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1500; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)'; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
    g.fillStyle = '#b4b3ae'; g.fillRect(Xm(-1.17), 0, Xm(1.17) - Xm(-1.17), H);
    g.fillStyle = '#77756f'; g.fillRect(Xm(-1.17), H - 3, Xm(1.17) - Xm(-1.17), 3);
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(Xm(1.17), 0, 3, H);
    for (let k = 0; k < 8; k++) for (const rr of sp.rails) { g.fillStyle = '#4a4744'; g.fillRect(Xm(rr - 0.12), Ym(k * 0.6 + 0.24), Xm(0.24) - Xm(0), Ym(0.12)); }
  } else {
    // バラスト（灰色の石。レールの近くは さびで茶色っぽく）
    g.fillStyle = '#76716a'; g.fillRect(0, 0, W, H);
    const pal = ['#8a857d', '#6a655e', '#9b968e', '#5d5953', '#7f786d', '#8f877a'];
    for (let i = 0; i < 5200; i++) { g.fillStyle = pal[Math.floor(rnd() * pal.length)]; const x = rnd() * W, y = rnd() * H, s2 = 1.2 + rnd() * 2.6; g.beginPath(); g.ellipse(x, y, s2, s2 * (0.6 + rnd() * 0.5), rnd() * 3, 0, 6.3); g.fill(); }
    for (const rr of sp.rails) { const gr = g.createLinearGradient(Xm(rr - 0.3), 0, Xm(rr + 0.3), 0); gr.addColorStop(0, 'rgba(96,66,44,0)'); gr.addColorStop(0.5, 'rgba(96,66,44,.32)'); gr.addColorStop(1, 'rgba(96,66,44,0)'); g.fillStyle = gr; g.fillRect(Xm(rr - 0.3), 0, Xm(rr + 0.3) - Xm(rr - 0.3), H); }
    // 枕木（PC：灰白・木：茶色・RC：濃い灰）
    const sw = sp.sl === 1 ? 0.2 : sp.sl === 2 ? 0.26 : 0.24, sc = sp.sl === 1 ? '#6e5644' : sp.sl === 2 ? '#8c8a85' : '#b7b4ac';
    for (let k = 0; k < 4; k++) {
      const y0 = Ym(k * 0.6 + 0.3 - sw / 2), hh = Ym(sw);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(Xm(-sp.slen / 2) - 1, y0 + 2, Xm(sp.slen / 2) - Xm(-sp.slen / 2) + 2, hh);   // かげ
      g.fillStyle = sc; g.fillRect(Xm(-sp.slen / 2), y0, Xm(sp.slen / 2) - Xm(-sp.slen / 2), hh);
      if (sp.sl === 1) { g.strokeStyle = 'rgba(40,28,20,.35)'; g.lineWidth = 1; for (let q = 0; q < 3; q++) { const yy = y0 + hh * (0.25 + q * 0.25); g.beginPath(); g.moveTo(Xm(-sp.slen / 2), yy); g.lineTo(Xm(sp.slen / 2), yy + (rnd() - 0.5) * 2); g.stroke(); } }
      else { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(Xm(-sp.slen / 2), y0, Xm(sp.slen / 2) - Xm(-sp.slen / 2), hh * 0.3); }
      for (const rr of sp.rails) { g.fillStyle = '#3f3c3a'; g.fillRect(Xm(rr - 0.11), y0 + hh * 0.2, Xm(0.22) - Xm(0), hh * 0.6); }   // 締結装置
    }
  }
  // レール（足もとのかげ・さび色の側面・光る頭）
  for (const rr of sp.rails) {
    g.fillStyle = 'rgba(30,24,20,.55)'; g.fillRect(Xm(rr - 0.075), 0, Xm(0.15) - Xm(0), H);
    g.fillStyle = '#5b4a3e'; g.fillRect(Xm(rr - 0.045), 0, Xm(0.09) - Xm(0), H);
    g.fillStyle = '#c9cccf'; g.fillRect(Xm(rr - 0.028), 0, Math.max(2, Xm(0.056) - Xm(0)), H);
  }
  t = new T3.CanvasTexture(cv); t.wrapS = T3.ClampToEdgeWrapping; t.wrapT = T3.RepeatWrapping;
  t.anisotropy = Math.min(8, M3.r && M3.r.capabilities.getMaxAnisotropy ? M3.r.capabilities.getMaxAnisotropy() : 4);
  t.rep = rep; TEX.set(sp.key, t); return t;
}

/* ---------- 駅：線路と ホームのならべかた（駅の向き＝駅の線の向き。o：左＋（m）） ----------
   本線は まっすぐ通す（列車は本線の上）。待避線は 本線の外に（分かれ目で ゆるく よせる）。ホームは 外へ外へ：
   2本なら 島式（あいだ）、1本なら 相対式（外）。本線に ホームがない（通過線）ときは そのとなりの待避線の外 */
function staLayout(t, C, flip) {
  if (t.pf) { const L = staLayoutPf(t, C, flip, String(t.pf)); if (L) return L; }   // ホームの形を決めた駅（DB の更新107）
  const sp = C.sp, M = sp.offs.slice().sort((a, b) => b - a), nM = M.length;
  const pl = Math.max(40, t.pl || 120), Lh = pl / 2, tk = Array.isArray(t.tk) ? t.tk : [];
  const mk = tk.filter(x => x && x.m !== 'side'), sk = tk.filter(x => x && x.m === 'side');
  const tr = Math.max(nM, t.tr || nM), ex = Math.min(8, tr - nM);
  const mainPl = M.map((o, j) => !(mk.length >= nM && mk[j] && mk[j].m === 'pass') && (nM < 4 || j === 0 || j === nM - 1));
  const side = { 1: [], '-1': [] }; let alt = 1;
  for (let k = 0; k < ex; k++) {
    const x = sk[k] || {}; let sd;
    if (x.d === 'down') sd = flip; else if (x.d === 'up') sd = -flip; else { sd = alt; alt = -alt; }
    side[sd].push({ plat: x.m !== 'pass' });
  }
  const Wi = Math.min(10, 6 + pl / 75), Ws = Math.min(6, 3 + pl / 100);
  const sids = [], plats = []; let Wl = 0, Wr = 0;
  for (const sg of [1, -1]) {
    const items = []; let om = 0;
    if (nM >= 2 || sg === 1) { const j = sg > 0 ? 0 : nM - 1; om = M[j]; items.push({ main: true, plat: mainPl[j], u: Math.abs(M[j]) }); }
    for (const x of side[sg]) items.push({ main: false, plat: x.plat, u: 0 });
    let i = 0, cur = items.length && items[0].main ? items[0].u : 4.2;
    while (i < items.length) {
      const T = items[i]; if (!T.main) T.u = cur;
      if (T.plat && i + 1 < items.length && items[i + 1].plat) {
        const a = T.u + PE, b = a + Wi; plats.push(sg > 0 ? { lo: a, hi: b, flo: true, fhi: true, isl: true } : { lo: -b, hi: -a, flo: true, fhi: true, isl: true });
        items[i + 1].u = b + PE; cur = items[i + 1].u + 4.2; i += 2;
      } else if (T.plat) {
        const a = T.u + PE, b = a + Ws; plats.push(sg > 0 ? { lo: a, hi: b, flo: true, fhi: false, isl: false } : { lo: -b, hi: -a, flo: false, fhi: true, isl: false });
        cur = b + PE; i += 1;
      } else { cur = T.u + 4.2; i += 1; }
    }
    for (const T of items) {
      if (!T.main) { const d = Math.abs(T.u - Math.abs(om)); sids.push({ of: sg * T.u, om, R: Math.max(30, Math.min(90, 20 + d * 5)) }); }
      const w = T.u + sp.wt / 2 + 0.3; if (sg > 0) Wl = Math.max(Wl, w); else Wr = Math.max(Wr, w);
    }
  }
  for (const p of plats) { Wl = Math.max(Wl, p.hi + 0.3); Wr = Math.max(Wr, -p.lo + 0.3); }
  let Rmax = 0; for (const q of sids) Rmax = Math.max(Rmax, q.R);
  return { pl, Lh, sids, plats, Wl, Wr, Rmax, nM };
}
/* ---------- 駅：ホームの形を決めた駅（DB の更新107・t66）----------
   番線は 駅の向きの左から 1番線・2番線…（2D と同じ）。pf：番線のあいだ（両はしも）ごとに 'P'（ホーム）か '-'（なし）を 番線の数＋1 文字。
   はじめの 'T' は 頭端式（行き止まり）。線の本線（複線なら 下りは左・上りは右）は 本線・通過線の番線へ（その向きに 通過線があれば 通過線）。
   ほかの番線は その向きの本線から分かれる。本線の番線が 線の本線とずれるとき（島式など）は 本線も ゆるく ひろげる（mo）。slot：番線ごとの o */
function staLayoutPf(t, C, flip, pf) {
  const sp = C.sp, nM = sp.offs.length, tk = Array.isArray(t.tk) ? t.tk : [], n = Math.max(1, t.tr || 1);
  const term = pf[0] === 'T', g = term ? pf.slice(1) : pf;
  if (g.length !== n + 1 || tk.length !== n || nM === 4 || /[^P-]/.test(g)) return null;   // あわない・複々線：いままでの形
  const pl = Math.max(40, t.pl || 120), Lh = pl / 2, Wi = Math.min(10, 6 + pl / 75), Ws = Math.min(6, 3 + pl / 100);
  // 1. 番線のまん中（駅の左が＋。左のはしから 右へ）
  const c = new Array(n);
  c[0] = g[0] === 'P' ? -Ws - PE : -(sp.wt / 2 + 0.3);
  for (let k = 1; k < n; k++) c[k] = g[k] === 'P' ? c[k - 1] - 2 * PE - Wi : c[k - 1] - sp.sp;
  // 2. 線の本線 → 番線（下りは左の本線・上りは右の本線）
  const isM = x => !!x && (x.m === 'main' || x.m === 'pass');
  const pick = d => { let r = -1; for (let k = 0; k < n; k++) { const x = tk[k]; if (!x || (x.d !== d && x.d !== 'both')) continue; if (x.m === 'pass' && x.d === d) return k; if (r < 0 && isM(x)) r = k; } return r; };
  let ms;
  if (nM === 1) { let k = tk.findIndex(x => x && x.m === 'pass'); if (k < 0) k = tk.findIndex(isM); ms = [Math.max(0, k)]; }
  else { const a = pick('down'), b = pick('up'); if (a < 0 || b < 0 || a >= b) return null; ms = [a, b]; }
  // 3. よせる：本線の番線のまん中を 線の本線のまん中に
  const LO = sp.offs.map(v => flip * v).sort((x, y) => y - x);   // 線の本線（駅の左が＋。左から）
  let sh = 0; ms.forEach((k, j) => { sh += LO[j] - c[k]; }); sh /= ms.length;
  for (let k = 0; k < n; k++) c[k] += sh;
  const Rof = d => Math.max(30, Math.min(90, 20 + Math.abs(d) * 5));
  // 4. 本線：駅の中の o（線の座標）・もとの o・ひろげる長さ
  const mo = sp.offs.map(v => { const j = LO.indexOf(flip * v), of = flip * c[ms[j]], d = of - v; return { of, om: v, R: Math.abs(d) > 0.05 ? Rof(d) : 0, slot: ms[j] }; });
  // 5. ほかの番線：その向きの本線から分かれる（両方の向きは 近い本線から）
  const sids = [];
  for (let k = 0; k < n; k++) {
    if (ms.includes(k)) continue;
    const x = tk[k] || {};
    const j = nM === 1 ? 0 : x.d === 'down' ? 0 : x.d === 'up' ? 1 : Math.abs(c[k] - c[ms[0]]) <= Math.abs(c[k] - c[ms[1]]) ? 0 : 1;
    const of = flip * c[k], om = flip * LO[j];
    sids.push({ of, om, R: Rof(of - om), slot: k });
  }
  // 6. ホーム（駅の座標で hi が左のはし・lo が右のはし → 線の座標）
  const plats = [];
  const add = (hi, lo, fhi, flo, isl) => plats.push(flip > 0 ? { lo, hi, flo, fhi, isl } : { lo: -hi, hi: -lo, flo: fhi, fhi: flo, isl });
  if (g[0] === 'P') add(c[0] + PE + Ws, c[0] + PE, false, true, false);
  for (let k = 1; k < n; k++) if (g[k] === 'P') add(c[k - 1] - PE, c[k] + PE, true, true, true);
  if (g[n] === 'P') add(c[n - 1] - PE, c[n - 1] - PE - Ws, true, false, false);
  // 7. はば・分かれ目の長さ
  let Wl = 0, Wr = 0, Rmax = 0;
  for (const q of mo.concat(sids)) { Wl = Math.max(Wl, q.of + sp.wt / 2 + 0.3); Wr = Math.max(Wr, -q.of + sp.wt / 2 + 0.3); Rmax = Math.max(Rmax, q.R); }
  for (const q of mo) { Wl = Math.max(Wl, q.om + sp.wt / 2 + 0.3); Wr = Math.max(Wr, -q.om + sp.wt / 2 + 0.3); }
  for (const p of plats) { Wl = Math.max(Wl, p.hi + 0.3); Wr = Math.max(Wr, -p.lo + 0.3); }
  return { pl, Lh, sids, plats, Wl, Wr, Rmax, nM, mo, slot: c.map(v => flip * v), ms, term, pf: true };
}
// 本線 j の o（線 C の s）：ホームの形を決めた駅では 駅の中で ひろげる（DB の更新107）
function mainOff(C, s, j) {
  const v = C.sp.offs[j];
  for (const e of C.sta) {
    const L = e.t._L; if (!L || !L.mo) continue;
    const a = Math.abs(e.dir * (s - e.sRef) * 50);
    let q = null; for (const m of L.mo) if (Math.abs(m.om - e.dir * v) < 0.05) q = m;
    if (!q || !q.R) continue;
    if (L.stub && Math.sign(e.dir * (s - e.sRef)) === L.stub) return e.dir * q.of;   // 頭端式の行き止まりのがわ
    if (a >= L.Lh + q.R) continue;
    return e.dir * (a <= L.Lh ? q.of : q.om + (q.of - q.om) * (1 - smooth((a - L.Lh) / q.R)));
  }
  return v;
}
// 待避線の o（駅の d（m）のところ。分かれ目より外は null）
function sidO(q, Lh, dm, L) {
  const a = Math.abs(dm); if (a <= Lh) return q.of;
  if (L && L.stub && Math.sign(dm) === L.stub) return a <= L.stubL + 1 ? q.of : null;   // 頭端式の行き止まりのがわ
  if (a >= Lh + q.R) return null;
  return q.om + (q.of - q.om) * (1 - smooth((a - Lh) / q.R));
}
// 駅の線を たどる：駅の線の s = at から前後へ（節点で まっすぐ つづく線へ）。{ C, dir, sRef }：d（マス）= dir × (s − sRef)
function staCover(C0, at, need) {
  const out = [{ C: C0, dir: 1, sRef: at }];
  for (const sign of [1, -1]) {
    let C = C0, dir = 1, sRef = at;
    for (let hop = 0; hop < 4; hop++) {
      const fwd = dir * sign > 0, sE = fwd ? C.len : 0, dE = dir * (sE - sRef), e = fwd ? 1 : 0, node = e ? C.sg.n1 : C.sg.n0;
      if (sign * dE >= need) break;
      const nx = nextSeg(C, e, node); if (!nx || out.some(o => o.C === nx.C)) break;
      const C2 = nx.C, dir2 = nx.e === 0 ? sign : -sign, sRef2 = nx.e === 0 ? -dE * sign : C2.len + dE * sign;
      out.push({ C: C2, dir: dir2, sRef: sRef2 }); C = C2; dir = dir2; sRef = sRef2;
    }
  }
  return out;
}
// 駅の d（m）の点：{ x, y, tx, ty, nx, ny（駅の左）, rt, C, s }
function staAt(t, dm, o) {
  o = o || {};
  for (const e of t._cov) {
    const s = e.sRef + e.dir * dm * U; if (s < -1e-6 || s > e.C.len + 1e-6) continue;
    at(e.C, Math.max(0, Math.min(e.C.len, s)), o); o.tx *= e.dir; o.ty *= e.dir; o.nx *= e.dir; o.ny *= e.dir; o.rt = rtS(e.C, s); o.C = e.C; o.cs = s; o.code = codeS(e.C.sg, s); return o;
  }
  return null;
}

/* ---------- いまの線の上の線路・ホーム（線 C の s のところ。o：線の左＋ m） ---------- */
function tracksAt(C, s) {
  const out = [], sp = C.sp;
  for (let j = 0; j < sp.offs.length; j++) out.push({ id: j, o: conv(C, s, C.sta.length ? mainOff(C, s, j) : sp.offs[j]), m: true });
  for (const e of C.sta) {
    const L = e.t._L, dm = e.dir * (s - e.sRef) * 50; if (Math.abs(dm) > (L.stub && Math.sign(dm) === L.stub ? L.stubL + 1 : L.Lh + L.Rmax)) continue;
    L.sids.forEach((q, k) => { const o = sidO(q, L.Lh, dm, L); if (o != null) out.push({ id: 100 + e.t._i * 16 + k, o: e.dir * o, m: false }); });
  }
  return out;
}
function platsAt(C, s) {
  const out = [];
  for (const e of C.sta) {
    const L = e.t._L, dm = e.dir * (s - e.sRef) * 50; if (Math.abs(dm) > (L.stub && Math.sign(dm) === L.stub ? Math.max(L.Lh, L.stubL - 0.3) : L.Lh) + 1e-3) continue;
    const cn = L.cn && L.cn.some(r => dm >= r[0] - 1e-3 && dm <= r[1] + 1e-3);
    L.plats.forEach((p, k) => out.push(e.dir > 0 ? { id: 1000 + e.t._i * 16 + k, a: p.lo, b: p.hi, fa: p.flo, fb: p.fhi, isl: p.isl, cn } : { id: 1000 + e.t._i * 16 + k, a: -p.hi, b: -p.lo, fa: p.fhi, fb: p.flo, isl: p.isl, cn }));
  }
  return out;
}
const inZone = (C, s) => { for (const e of C.sta) { const L = e.t._L, dm = e.dir * (s - e.sRef) * 50; if (Math.abs(dm) <= (L.stub && Math.sign(dm) === L.stub ? L.stubL + 1 : L.Lh + L.Rmax)) return true; } return false; };
const inXr = (C, s, k) => { for (const r of C.xr) if ((!k || r.k === k) && s >= r.s0 - 1e-6 && s <= r.s1 + 1e-6) return r; return null; };

/* ---------- 道路のさがしもの（線路の近くだけ。1マスの目） ---------- */
const cellKey = (x, y) => (Math.floor(x) + 50000) * 100003 + (Math.floor(y) + 50000);
// 区間 (a → b) の 箱にかかる 1マスの目（pad マス広く）
function cellsOf(ax, ay, bx, by, pad, fn) {
  const x0 = Math.floor(Math.min(ax, bx) - pad), x1 = Math.floor(Math.max(ax, bx) + pad), y0 = Math.floor(Math.min(ay, by) - pad), y1 = Math.floor(Math.max(ay, by) + pad);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fn(cellKey(x, y));
}
function roadIdx(segs, rails, v) {
  // 線路の近くの目（1マス）を しるす（はやく しらべるため 配列で）
  const gx0 = Math.floor(v.x0) - 4, gy0 = Math.floor(v.y0) - 4, GW = Math.ceil(v.x1) + 5 - gx0, GH = Math.ceil(v.y1) + 5 - gy0, near = new Uint8Array(GW * GH);
  for (const C of rails) { const P = C.P; for (let i = 0; i + 1 < C.np; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3];
    const a0 = Math.max(0, Math.floor(Math.min(ax, bx)) - 1 - gx0), a1 = Math.min(GW - 1, Math.floor(Math.max(ax, bx)) + 1 - gx0), b0 = Math.max(0, Math.floor(Math.min(ay, by)) - 1 - gy0), b1 = Math.min(GH - 1, Math.floor(Math.max(ay, by)) + 1 - gy0);
    if (a1 - a0 > 20 || b1 - b0 > 20) continue;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) near[a * GH + b] = 1;
  } }
  const map = new Map(), roads = [];
  for (const s of segs) {
    if (s.k !== 'road' || !(s.np >= 2)) continue;
    const bb = s.bb; if (bb && (bb[2] < gx0 || bb[0] > gx0 + GW || bb[3] < gy0 || bb[1] > gy0 + GH)) continue;
    const P = s.P; let ri = -1;
    for (let i = 0; i + 1 < s.np; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3];
      const a0 = Math.floor(Math.min(ax, bx)), a1 = Math.floor(Math.max(ax, bx)), b0 = Math.floor(Math.min(ay, by)), b1 = Math.floor(Math.max(ay, by));
      if (a1 - a0 > 20 || b1 - b0 > 20) continue;
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
        const ia = a - gx0, ib = b - gy0; if (ia < 0 || ib < 0 || ia >= GW || ib >= GH || !near[ia * GH + ib]) continue;
        if (ri < 0) { ri = roads.length; roads.push(s); }
        const k = cellKey(a, b); let L = map.get(k); if (!L) map.set(k, L = []); L.push(ri, i);
      }
    }
  }
  return { map, roads, key: cellKey };
}
const roadW = s => Math.max(6, (s.w || 0.2) * 50);   // 道路のはば（m）
// 点 (x, y) から r マス以内の道路があるか（高架の柱を立てない）
function roadNear(x, y, pad) {
  if (!RIDX) return false;
  const { map, roads, key } = RIDX;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const L = map.get(key(x + a, y + b)); if (!L) continue;
    for (let k = 0; k < L.length; k += 2) {
      const s = roads[L[k]], i = L[k + 1], P = s.P, ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0, d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (d < (roadW(s) / 2 + pad) * U) return true;
    }
  }
  return false;
}

// 線路の目（1マス）：ほかの線の道床の上か（分かれ目の 電柱・柵）
let RG = null;
function railIdx(rails, v) {
  const map = new Map(), x0 = v.x0 - 3, x1 = v.x1 + 3, y0 = v.y0 - 3, y1 = v.y1 + 3;
  for (const C of rails) { const P = C.P; for (let i = 0; i + 1 < C.np; i++) { const ax = P[2 * i], ay = P[2 * i + 1]; if (ax < x0 || ax > x1 || ay < y0 || ay > y1) continue; cellsOf(ax, ay, P[2 * i + 2], P[2 * i + 3], 0, k => { let a = map.get(k); if (!a) map.set(k, a = []); a.push(C, i); }); } }
  return map;
}
function onRail(C0, x, y, pad) {
  if (!RG) return false;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const L = RG.get(cellKey(x + a, y + b)); if (!L) continue;
    for (let k = 0; k < L.length; k += 2) {
      const C = L[k]; if (C === C0) continue;
      const i = L[k + 1], P = C.P, ax = P[2 * i], ay = P[2 * i + 1], dx = P[2 * i + 2] - ax, dy = P[2 * i + 3] - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0, d = Math.hypot(ax + dx * t - x, ay + dy * t - y) / U;
      const hw = Math.max(Math.abs(C.sp.offs[0]), Math.abs(C.sp.offs[C.sp.offs.length - 1])) + C.sp.wt / 2 + 1.0;
      if (d < hw + pad) return true;
    }
  }
  return false;
}

/* ---------- 線路と道路の交わり：踏切（地面どうし）・駅の中（道路のファイルが 上か下へ）・高い盛土の下（短い橋） ---------- */
function crossings(rails, sts) {
  const XS = [], seen = new Set(), { map, roads, key } = RIDX;
  RNODE = new Map();   // 道の交点 → [{ s, e }]（交差点をこえる 跨線橋。t67）
  for (const s of (X.segs || [])) { if (s.k !== 'road' || !(s.np >= 2)) continue; for (const e of [0, 1]) { const nid = e ? s.n1 : s.n0; if (nid == null) continue; let a = RNODE.get(nid); if (!a) RNODE.set(nid, a = []); a.push({ s, e }); } }
  const inSta = (x, y) => { for (const t of sts) { if (t.k !== 'rail') continue; const a = t.a || 0, c = Math.cos(a), s = Math.sin(a), dx = x - t.fx, dy = y - t.fy, L = (t.pl || 120) / 50, Wd = 0.22 * Math.max(1, t.tr || 1) + 0.18;
    if (Math.abs(dx * c + dy * s) <= L / 2 && Math.abs(-dx * s + dy * c) <= Wd / 2) return t; } return null; };
  for (const C of rails) {
    const P = C.P;
    for (let i = 0; i + 1 < C.np; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3];
      const ks = []; cellsOf(ax, ay, bx, by, 0, k => ks.push(k));
      for (const k of ks) {
        const L = map.get(k); if (!L) continue;
        for (let q = 0; q < L.length; q += 2) {
          const rs = roads[L[q]], j = L[q + 1], R = rs.P, cx = R[2 * j], cy = R[2 * j + 1], dx = R[2 * j + 2], dy = R[2 * j + 3];
          const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(den) < 1e-12) continue;
          const tt = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, uu = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
          if (tt < 0 || tt > 1 || uu < 0 || uu > 1) continue;
          const s = C.cl[i] + (C.cl[i + 1] - C.cl[i]) * tt, pk = C.sg.id + ':' + rs.id + ':' + Math.round(s * 4);
          if (seen.has(pk)) continue; seen.add(pk);
          const x = ax + (bx - ax) * tt, y = ay + (by - ay) * tt, rl = Math.hypot(dx - cx, dy - cy) || 1;
          XS.push({ C, s, x, y, rs, rx: (dx - cx) / rl, ry: (dy - cy) / rl, rsv: (() => { let a = 0; for (let m = 0; m < j; m++) a += Math.hypot(R[2 * m + 2] - R[2 * m], R[2 * m + 3] - R[2 * m + 1]); return a + rl * uu; })() });
        }
      }
    }
  }
  // 同じ線路と道路の 近いものは 1つに
  const out = [];
  for (const h of XS) {
    if (out.some(o => o.C === h.C && o.rs === h.rs && Math.abs(o.s - h.s) < 0.3)) continue;
    const cR = codeS(h.C.sg, h.s);
    h.hw = roadW(h.rs) / 2; h.cls = h.rs.c || 'city';
    at(h.C, h.s, TP); h.tx = TP.tx; h.ty = TP.ty; h.sn = Math.max(0.25, Math.abs(h.rx * TP.ty - h.ry * TP.tx));
    if (cR !== 'G') { h.k = 'grade'; out.push(h); continue; }   // 高架・橋・トンネル：道路は下（上）を通る（駅舎の場所をきめるのに使う）
    if (h.rs.pf && h.rs.st) { const c2 = h.rs.st[Math.min(h.rs.st.length - 1, Math.max(0, Math.round(h.rsv)))] || 'G'; if (c2 !== 'G') continue; }
    const t = X.tileAt(Math.floor(h.x), Math.floor(h.y)); if (t && isW(t.t)) continue;   // 水の上（橋）
    if (h.cls === 'exp') { h.k = 'exp'; out.push(h); continue; }   // 高速道路：踏切にしない（道路のファイルが 上へ）
    const st = inSta(h.x, h.y); if (st) { h.k = 'sta'; h.t = st; out.push(h); continue; }
    const dz = rtS(h.C, h.s) - (X.m3Surf(h.x, h.y) + LIFT);
    if (dz > 2.5 * U * VEX) { h.k = 'over'; out.push(h); continue; }
    // 踏切にしない（t66）：斜めの交わり（45° より浅い）→ 道路を 跨線橋に（道路のファイルが 上へ）
    //   都心（商業地 c・d。t67）：道は ぜんぶ 跨線橋に（坂は 交差点から 15m で はじめる）。坂が入らない 短い道だけ 踏切のまま
    const tl = X.tileAt(Math.floor(h.x), Math.floor(h.y)), zc = (tl && tl.z) || '';
    h.cbd = zc === 'c' || zc === 'd';
    h.k = (h.sn < 0.7 && rampOK(h.rs, h.rsv, h.rsv)) || (h.cbd && rampOK(h.rs, h.rsv, h.rsv, true)) ? 'ovp' : 'level';
    if (h.k === 'level' && h.cbd) { const ps = passOver(h.rs, h.rsv, h.rsv); if (ps) { h.k = 'ovp'; h.pass = ps; } }   // 交差点をこえる 跨線橋（都心。t67）
    out.push(h);
  }
  // 同じ線路と道路が 2マス以内で なんども交わる（重なるように走る）：みな 跨線橋に
  for (const h of out) if (h.k === 'level' && out.some(o => o !== h && o.C === h.C && o.rs === h.rs && Math.abs(o.s - h.s) < 2 && (o.k === 'level' || o.k === 'ovp'))) {
    const mates = out.filter(o => o.C === h.C && o.rs === h.rs && Math.abs(o.s - h.s) < 2 && (o.k === 'level' || o.k === 'ovp'));
    if (rampOK(h.rs, Math.min(...mates.map(o => o.rsv)), Math.max(...mates.map(o => o.rsv)), mates.every(o => o.cbd))) for (const o of mates) o.k = 'ovp';
  }
  // 交わらないが 線路と重なって走る道（線路にそって、帯が かさなる）：その あいだを 跨線橋に（t66）
  for (const o of overlaps(rails, sts, inSta)) out.push(o);
  return out;
}
// 道の線の長さ（マス）・交点から 線の中への向き（0.25マス先まで）
function segLen(s) { const P = s.P; let len = 0; for (let i = 0; i + 1 < s.np; i++) len += Math.hypot(P[2 * i + 2] - P[2 * i], P[2 * i + 3] - P[2 * i + 1]); return len; }
function outDir(s, e) {
  const P = s.P, n = s.np, i0 = e ? n - 1 : 0, st = e ? -1 : 1, x0 = P[2 * i0], y0 = P[2 * i0 + 1];
  let k = i0 + st, dx = 0, dy = 0;
  while (k >= 0 && k < n) { dx = P[2 * k] - x0; dy = P[2 * k + 1] - y0; if (Math.hypot(dx, dy) >= 0.25) break; k += st; }
  const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L];
}
// 交差点をこえる 跨線橋（都心。t67）：坂が入らない側（交差点まで 1.5マスより短い）は、交差点をこえて まっすぐ（30° まで）つづく道（1.6マス以上）に 坂を入れる。
//   跨線橋が 交差点の上を わたり、線路ぞいの道は 下をくぐる。どちらの側も 坂が入れば [{ e（rs のはし 0・1）, s（つづく道の id）, pe（その道の 交差点がわのはし）}]、だめなら null
let RNODE = new Map();
function passOver(rs, a, b) {
  const len = segLen(rs), out = [];
  for (const [e, d] of [[0, a], [1, len - b]]) {
    if (d >= 1.5) continue;
    const nid = e ? rs.n1 : rs.n0, arms = nid == null ? null : RNODE.get(nid); if (!arms || arms.length < 3) return null;   // 交差点でない（行き止まり・つぎめ）
    const d0 = outDir(rs, e); let best = null;
    for (const o of arms) {
      if (o.s === rs || o.s.c === 'exp' || o.s.pf || o.s.id === rs.id || segLen(o.s) < 1.6) continue;
      const d1 = outDir(o.s, o.e), dot = d0[0] * d1[0] + d0[1] * d1[1];
      if (dot < -0.87 && (!best || dot < best.dot)) best = { s: o.s.id, pe: o.e, dot };
    }
    if (!best) return null;
    out.push({ e, s: best.s, pe: best.pe });
  }
  return out.length ? out : null;
}
// 跨線橋の坂が入るか（t66）：道の線の a〜b（はしからのマス）が 跨線橋。両がわに 2マス（坂と はしの あき）
//   cbd（都心。t67）：両がわに 1.5マス（交差点から 0.3マスで 坂を はじめる → 坂は 1.2マス）
function rampOK(rs, a, b, cbd) {
  const P = rs.P; let len = 0; for (let i = 0; i + 1 < rs.np; i++) len += Math.hypot(P[2 * i + 2] - P[2 * i], P[2 * i + 3] - P[2 * i + 1]);
  const m = cbd ? 1.5 : 2;
  return a >= m && len - b >= m;   // はしが交差点なら 0.8マス（都心は 0.3マス）は 地面のまま → 坂は 1.2マス（15%）より長く
}
// 線路と重なって走る道（t66）：地面の線路の帯（線路のはしから 1m）と 道の帯が かさなり、ほぼ平行で、交わらないところ。
//   道ごと・線ごとに［x, y（線路の上）, s］のならび → 跨線橋の しらべ（k：ovp か 駅の中は sta）
function overlaps(rails, sts, inSta) {
  const out = [], { map, roads } = RIDX, got = new Map();
  for (const C of rails) {
    const P = C.P, hwR = (C.sp.n === 4 ? 2 * C.sp.sp + 0.7 : C.sp.n === 2 ? C.sp.sp : 0) / 2 + C.sp.wt / 2 + 1;   // 線路の帯の はば の半分（m）
    for (let i = 0; i + 1 < C.np; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey); if (el < 1e-6) continue;
      const ux = ex / el, uy = ey / el, ks = []; cellsOf(ax, ay, bx, by, 1, k => ks.push(k));
      for (const k of ks) {
        const L = map.get(k); if (!L) continue;
        for (let q = 0; q < L.length; q += 2) {
          const rs = roads[L[q]], j = L[q + 1], R = rs.P; if (rs.c === 'exp' || (rs.pf && rs.st && !/G/.test(rs.st))) continue;
          const cx = R[2 * j], cy = R[2 * j + 1], dx = R[2 * j + 2], dy = R[2 * j + 3], rl = Math.hypot(dx - cx, dy - cy); if (rl < 1e-6) continue;
          if (Math.abs(((dx - cx) * ux + (dy - cy) * uy) / rl) < 0.94) continue;   // 平行でない（20° より大きい）：交わり（踏切・跨線橋）のほう
          const lim = (hwR + roadW(rs) / 2) * U;
          // 道の小区間を 0.2マスごとに：線路の区間との きょり
          const n = Math.max(1, Math.ceil(rl / 0.2));
          for (let m = 0; m <= n; m++) {
            const px = cx + (dx - cx) * m / n, py = cy + (dy - cy) * m / n, t = (px - ax) * ux + (py - ay) * uy; if (t < 0 || t > el) continue;
            const qx = ax + ux * t, qy = ay + uy * t, d = Math.hypot(px - qx, py - qy); if (d > lim) continue;
            const sR = C.cl[i] + t, cR = codeS(C.sg, sR); if (cR !== 'G') continue;   // 高架・橋・トンネルの線路：道は 下（上）を通る
            const tag = rs.id + ':' + C.sg.id; let g = got.get(tag); if (!g) got.set(tag, g = { C, rs, pts: [] });
            let rv = 0; for (let mm = 0; mm < j; mm++) rv += Math.hypot(R[2 * mm + 2] - R[2 * mm], R[2 * mm + 3] - R[2 * mm + 1]);
            g.pts.push([qx, qy, sR, rv + rl * m / n]);
          }
        }
      }
    }
  }
  for (const g of got.values()) {
    if (g.pts.length < 2) continue;   // 1点だけ：はしが ふれるだけ
    const tl = X.tileAt(Math.floor(g.pts[0][0]), Math.floor(g.pts[0][1])), cbd = !!(tl && (tl.z === 'c' || tl.z === 'd'));   // 都心（t67）
    if (!rampOK(g.rs, Math.min(...g.pts.map(p => p[3])), Math.max(...g.pts.map(p => p[3])), cbd)) continue;   // 坂が入らない（短い道）：そのまま
    for (const [x, y, sR] of g.pts.filter((p, i) => i % 3 === 0 || i === g.pts.length - 1)) {
      const st = inSta(x, y), h = { C: g.C, s: sR, x, y, rs: g.rs, rx: 0, ry: 0, rsv: 0, hw: roadW(g.rs) / 2, cls: g.rs.c || 'city', sn: 0.25, k: st ? 'sta' : 'ovp', ovl: true, cbd };
      if (st) h.t = st;
      at(g.C, sR, TP); h.tx = TP.tx; h.ty = TP.ty; h.rx = TP.tx; h.ry = TP.ty;
      out.push(h);
    }
  }
  return out;
}

/* ---------- ここから：作る ---------- */
let G = null;   // この作りなおしの 入れもの
function build(cx) {
  const t0 = performance.now(), tm = R.tm = {};
  X = cx; T3 = cx.T3; M3 = cx.M3; LIFT = cx.M3_LIFT; VEX = cx.M3_VEX; GEN++; UG = !!cx.ug;
  const MQ = cx.MQ || {}, lv = Math.max(0, Math.min(3, Number(MQ.d3) || 0)), kq = lv <= 0 ? 0.6 : lv >= 3 ? 1.5 : lv >= 2 ? 1.2 : 1;
  LQ = [4 * kq, 8 * kq, 15 * kq];
  const v = cx.v; CEN = { x: v.cx != null ? v.cx : M3.tx, y: v.cy != null ? v.cy : M3.ty, h: Math.max(4, Math.round((v.x1 - v.x0) / 10)) * 0.5 };
  G = { v: new GB(false), x: new GB(false), u: new GB(false), trk: new Map(), w: new LB(), f: new LB(), arms: [], lamps: [], xs: [], q: lv, eco: lv <= 0 };
  // 1. 線路（読んであるもの全部：つぎめ・駅の線をたどるため）
  NODES = new Map(); const all = [];
  for (const sg of (cx.it && cx.it.segs ? cx.it.segs.values() : cx.segs)) {
    if (sg.k !== 'rail' || !(sg.np >= 2)) continue;
    const C = segC(sg); C.sp = spec(sg); C.sta = []; C.xr = []; C.cv = [null, null]; C.cuts = []; normals(C); all.push(C);
    for (const e of [0, 1]) { const nd = e ? sg.n1 : sg.n0; if (nd == null) continue; let a = NODES.get(nd); if (!a) NODES.set(nd, a = []); a.push({ C, e }); }
  }
  joins();
  const rails = []; for (const sg of cx.segs) if (sg.k === 'rail' && sg.np >= 2) rails.push(segC(sg));
  // 2. 駅：ならべかたと、駅の線（前後の線も）
  const sts = cx.sts || [], rsts = [];
  sts.forEach((t, i) => {
    t._L = null; t._cov = null; t._i = i;
    if (t.k !== 'rail' || t.seg == null) return;
    const sg = cx.it && cx.it.segs ? cx.it.segs.get(t.seg) : null; if (!sg || sg.k !== 'rail' || !(sg.np >= 2)) return;
    const C = segC(sg), at0 = Math.max(0, Math.min(C.len, t.at || 0)); at(C, at0, TP);
    const flip = TP.tx * Math.cos(t.a || 0) + TP.ty * Math.sin(t.a || 0) >= 0 ? 1 : -1;
    const L = staLayout(t, C, flip); t._L = L; L.flip = flip;
    if (L.term) {   // 頭端式（DB の更新107）：駅の線のはしが 行き止まり（つづく線がない）で、ホームのはしから 60m までなら そのがわ（stub：線の s の向き ±1）
      L.stub = 0;
      for (const e of [1, 0]) {
        const nd = e ? sg.n1 : sg.n0, dEnd = (e ? C.len - at0 : at0) * 50;
        if (dEnd <= L.Lh + 60 && !(nd != null && nextSeg(C, e, nd))) { L.stub = e ? 1 : -1; L.stubL = dEnd; break; }
      }
    }
    t._cov = staCover(C, at0, (L.Lh + L.Rmax + 30) * U);
    for (const e of t._cov) e.C.sta.push({ t, dir: e.dir, sRef: e.sRef });
    const c0 = codeS(sg, at0); L.under = t.zl === 'U' || c0 === 'T'; L.elev = !L.under && (t.zl === 'E' || c0 === 'V' || c0 === 'B');
    rsts.push(t);
  });
  // 3. 道路との交わり
  let tq = performance.now();
  const farV = M3.d > 40;   // 遠い：道路との交わりは見えないので しらべない（踏切・柱よけ・駅舎の場所）
  RIDX = farV ? null : roadIdx(cx.segs, rails, v); RG = railIdx(rails, v);
  tq = TM('p_ridx', tq);
  const XS = farV ? [] : crossings(rails, sts);
  tq = TM('p_xs', tq);
  for (const h of XS) {
    const ext = (h.hw / h.sn + 6 * Math.sqrt(Math.max(0, 1 - h.sn * h.sn)) / h.sn + 1.2) * U;
    if (h.k === 'level') { h.C.xr.push({ s0: h.s - ext, s1: h.s + ext, k: 'x', h }); G.xs.push(h); }
    else if (h.k === 'over') h.C.xr.push({ s0: h.s - ext - 2 * U, s1: h.s + ext + 2 * U, k: 'o', h });
    else if (h.k === 'sta' || h.k === 'exp' || h.k === 'ovp') h.C.xr.push({ s0: h.s - ext - 3 * U, s1: h.s + ext + 3 * U, k: 'g', h });   // 立体交差の道路の下：電柱を立てない
  }
  // 道路のファイル（あとで作る）に わたす：踏切（地面どうし）と 立体交差にしてほしい交わり（駅の中・高速道路）
  R.xings = G.xs.map(h => ({ x: h.x, y: h.y, seg: h.C.sg.id, s: h.s, road: h.rs.id, rx: h.rx, ry: h.ry, hw: h.hw, h: rtS(h.C, h.s) }));
  R.grade = XS.filter(h => h.k === 'sta' || h.k === 'exp' || h.k === 'ovp').map(h => ({ x: h.x, y: h.y, seg: h.C.sg.id, s: h.s, road: h.rs.id, k: h.k, h: rtS(h.C, h.s), cbd: !!h.cbd, pass: h.pass || null }));
  // 4. 駅：道路をよけて 駅舎・屋根の場所。車庫
  for (const t of rsts) staPlan(t, XS);
  depPrep(cx.it && cx.it.deps ? [...cx.it.deps.values()] : [], v);
  tm.prep = performance.now() - t0;
  // 5. 線ごとに（近いはんいの点の つづき）
  const pad = 2;
  for (const C of rails) {
    for (const e of C.sta) { const L = e.t._L, cuts = [-L.Lh, L.Lh]; for (const q of L.sids.concat(L.mo || [])) if (q.R) for (const f of [0, 0.25, 0.5, 0.75, 1]) cuts.push(-(L.Lh + q.R * f), L.Lh + q.R * f); for (const r of (L.cn || [])) cuts.push(r[0], r[1]); for (const dm of cuts) { const s = e.sRef + e.dir * dm * U; if (s > 0 && s < C.len) C.cuts.push(s); } }
    for (const r of C.xr) for (const s of [r.s0, r.s1]) if (s > 0 && s < C.len) C.cuts.push(s);
    const st = C.sg.pf && C.sg.L && C.sg.st ? C.sg.st : ''; for (let k = 0; k + 1 < st.length; k++) if (st[k] !== st[k + 1] && k + 0.5 < C.len) C.cuts.push(k + 0.5);
    C.cuts.sort((a, b) => a - b);
    const P = C.P, x0 = v.x0 - pad, x1 = v.x1 + pad, y0 = v.y0 - pad, y1 = v.y1 + pad; let a = -1;
    for (let i = 0; i < C.np; i++) {
      const inn = P[2 * i] >= x0 && P[2 * i] <= x1 && P[2 * i + 1] >= y0 && P[2 * i + 1] <= y1;
      if (inn) { if (a < 0) a = Math.max(0, i - 1); }
      else if (a >= 0) { runSafe(C, a, i); a = -1; }
    }
    if (a >= 0) runSafe(C, a, C.np - 1);
  }
  tm.segs = performance.now() - t0 - tm.prep;
  // 6. 駅・踏切・バス停
  tq = performance.now();
  for (const t of sts) { try { staBuild(t); } catch (e) { console.error(e); } }
  tq = TM('g_sta', tq);
  try { depBuild(); } catch (e) { console.error(e); }
  tq = TM('h_dep', tq);
  try { xBuild(); } catch (e) { console.error(e); }
  tm.rest = performance.now() - t0 - tm.prep - tm.segs;
  flush();
  R.ms = performance.now() - t0;
}

/* ---------- 線の 1つづき（近いはんいの点 ia〜ib） ---------- */
function runSafe(C, a, b) { try { segRun(C, a, b); } catch (e) { console.error(e); } }   // 1本の線で こわれても、ほかは描く
function lodAt(x, y) { const dd = Math.max(0, Math.hypot(x - CEN.x, y - CEN.y) - CEN.h), dc = Math.hypot(M3.d, dd); return dc < LQ[0] ? 3 : dc < LQ[1] ? 2 : dc < LQ[2] ? 1 : 0; }
function mkS(C, s, full) {
  const S = at(C, s, {}); S.rt = rtS(C, s); S.lod = lodAt(S.x, S.y);
  S.tr = tracksAt(C, s); S.pl = platsAt(C, s); S.zone = C.sta.length ? inZone(C, s) : false; S.xg = C.xr.length ? !!inXr(C, s, 'x') : false;
  const hw = C.sp.wt / 2 + 0.3; let eL = 0, eR = 0;
  for (const t of S.tr) { eL = Math.max(eL, t.o + hw); eR = Math.max(eR, -t.o + hw); }
  for (const p of S.pl) { eL = Math.max(eL, p.b + 0.3); eR = Math.max(eR, -p.a + 0.3); }
  S.eL = eL; S.eR = eR; S.inPl = S.pl.length > 0;
  S.fL = eL + 0.74 + (S.zone ? 0.5 : 0.9); S.fR = eR + 0.74 + (S.zone ? 0.5 : 0.9);
  return S;
}
const TM = (k, t) => { const tm = R.tm; if (tm) tm[k] = (tm[k] || 0) + performance.now() - t; return performance.now(); };
function segRun(C, ia, ib) {
  const sg = C.sg, sA = C.cl[ia], sB = C.cl[ib]; if (sB - sA < 1e-4) return;
  let tq = performance.now();
  // こまかい点の高さと 水の上（地面の線が 川・湖・海をわたる：岸と岸のあいだは まっすぐ（橋））
  const ka = dloc(C, sA), kb = Math.min(C.ds.length - 1, dloc(C, sB) + 1);
  rtK(C, ka);
  for (let k = ka; k <= kb; k++) {
    rtK(C, k); at(C, C.ds[k], TP);
    const tl = X.tileAt(Math.floor(TP.x), Math.floor(TP.y)); C.wf[k] = tl && isW(tl.t) && codeS(sg, C.ds[k]) === 'G' ? 1 : 0;
  }
  for (let k = ka; k <= kb; k++) {
    if (!C.wf[k] || (k > ka && C.wf[k - 1])) continue;
    let k1 = k; while (k1 + 1 <= kb && C.wf[k1 + 1]) k1++;
    let L0 = k - 1, L1 = k1 + 1;
    const land = j => { if (j < 0 || j >= C.ds.length) return false; at(C, C.ds[j], TP); const tl = X.tileAt(Math.floor(TP.x), Math.floor(TP.y)); return !(tl && isW(tl.t)); };
    while (L0 >= 0 && L0 > k - 60 && !land(L0)) L0--; while (L1 < C.ds.length && L1 < k1 + 60 && !land(L1)) L1++;
    const h0 = L0 >= 0 && L0 > k - 60 ? rtK(C, L0) : null, h1 = L1 < C.ds.length && L1 < k1 + 60 ? rtK(C, L1) : null;
    for (let j = k; j <= k1; j++) {
      const g = C.rt[j], f = h0 != null && h1 != null ? (C.ds[j] - C.ds[L0]) / Math.max(1e-6, C.ds[L1] - C.ds[L0]) : 0;
      const h = h0 != null && h1 != null ? h0 + (h1 - h0) * f : h0 != null ? h0 : h1 != null ? h1 : g;
      C.rt[j] = Math.max(h, g + 1.5 * U * VEX);
    }
  }
  // 点：こまかい点（遠いところは間引く）と 切れ目
  const ss = [], step = M3.d > 30 ? Math.min(1.5, Math.max(1, M3.d / 60)) : 1.0; let last = -1e9;   // 遠いところ（いちばん かんたん）は 50m ごと
  for (let k = ka; k <= kb; k++) {
    const s = Math.max(sA, Math.min(sB, C.ds[k])); at(C, s, TP);
    const keepIt = k === ka || k === kb || lodAt(TP.x, TP.y) >= 1 || s - last >= step || C.wf[k] !== C.wf[Math.max(ka, k - 1)] || (k < kb && C.wf[k] !== C.wf[k + 1]);
    if (keepIt) { ss.push(s); last = s; }
  }
  for (const s of C.cuts) if (s > sA && s < sB) ss.push(s);
  ss.sort((a, b) => a - b);
  tq = TM('a_dense', tq);
  const SA = []; for (const s of ss) if (!SA.length || s - SA[SA.length - 1].s > 1e-4) SA.push(mkS(C, s));
  tq = TM('b_samp', tq);
  if (SA.length < 2) return;
  // 区間のつくり：G 地面・V 高架・B 橋・T トンネル・W 水の上（地面の線の橋）・O 道路をまたぐ（高い盛土）
  const PC = []; for (let j = 0; j + 1 < SA.length; j++) {
    const sm = (SA[j].s + SA[j + 1].s) / 2; let c = codeS(sg, sm);
    if (c === 'G') { at(C, sm, TP); const tl = X.tileAt(Math.floor(TP.x), Math.floor(TP.y)); if (tl && isW(tl.t)) c = 'W'; else if (C.xr.length && inXr(C, sm, 'o')) c = 'O'; }
    PC.push(c);
  }
  // トンネルの入口のところの点は、外がわの高さに（中は深い）
  for (let j = 1; j < PC.length; j++) { const a = PC[j - 1][0], b = PC[j][0]; if ((a === 'T') !== (b === 'T')) SA[j].rt = rtAt(C, SA[j].s, a === 'T' ? b : a); }
  // 地面（路盤のはし）の高さ：盛土のすそ
  for (const S of SA) {
    if (S.lod >= 1) { const fl = S.eL + 0.74 + (S.zone ? 0.5 : 0.9), fr = S.eR + 0.74 + (S.zone ? 0.5 : 0.9); S.fL = fl; S.fR = fr; S.gL = X.m3Surf(S.x + S.nx * fl * U, S.y + S.ny * fl * U); S.gR = X.m3Surf(S.x - S.nx * fr * U, S.y - S.ny * fr * U); }
    else { const g = X.m3Surf(S.x, S.y); S.fL = S.eL + 1.2; S.fR = S.eR + 1.2; S.gL = S.gR = g; }
  }
  tq = TM('c_ground', tq);
  // 橋のつづき（ガーダー橋・トラス橋をきめる）
  const runs = []; for (let j = 0; j < PC.length; j++) { const c = PC[j]; if (!DECK[c]) continue; const r = runs.length ? runs[runs.length - 1] : null; if (r && r.j1 === j - 1 && r.c === c) r.j1 = j; else runs.push({ c, j0: j, j1: j }); }
  for (const r of runs) { r.s0 = SA[r.j0].s; r.s1 = SA[r.j1 + 1].s; const Lb = (r.s1 - r.s0) * 50; r.truss = (r.c === 'B' || r.c === 'W') && Lb >= 110; r.n = Math.max(1, Math.round(Lb / (r.truss ? 55 : r.c === 'V' ? 1e9 : 25))); r.col = PAINT[Math.floor(X.m3Hash(sg.id, Math.round(r.s0 * 10)) * PAINT.length)]; for (let j = r.j0; j <= r.j1; j++) PC[j] = PC[j] + (r.truss ? 't' : ''); }
  const urban = S => { const t = X.tileAt(Math.floor(S.x), Math.floor(S.y)); return !!(t && t.z && 'abcdefgk'.includes(t.z)); };
  for (let j = 0; j + 1 < SA.length; j++) {
    const A = SA[j], B = SA[j + 1], c = PC[j][0], tr = PC[j].length > 1, lod = Math.max(A.lod, B.lod);
    if (c === 'T') { if (UG) tunPiece(C, A, B); continue; }   // トンネルの中は 地下ビューのときだけ（DB の更新109）
    if (DECK[c]) deckPiece(C, A, B, c, tr, lod, runs.find(r => j >= r.j0 && j <= r.j1)); else bedPiece(C, A, B, lod, lod >= 1 && !G.eco && urban(A));
    trackPiece(C, A, B, lod);
    platPiece(C, A, B, lod, SA[j - 1], SA[j + 2], c);
  }
  tq = TM('d_pieces', tq);
  // つくりの さかい：トンネルの入口・橋台
  for (let j = 1; j < PC.length; j++) {
    const a = PC[j - 1][0], b = PC[j][0]; if (a === b) continue;
    const S = SA[j];
    if (a === 'T' || b === 'T') portal(C, S, a === 'T' ? 1 : -1, b === 'T' ? PC[j - 1][0] : b);
    else if (DECK[a] !== DECK[b]) abut(C, S, DECK[a] ? 1 : -1);
  }
  // 高架の柱・橋脚・トラス
  for (const r of runs) structRun(C, r, SA);
  tq = TM('e_struct', tq);
  // 架線
  if (C.sp.el) catenary(C, SA, PC, sA, sB);
  tq = TM('f_cat', tq);
  // 線路のはし（つづく線がない）：車止め
  for (const e of [0, 1]) {
    const i = e ? C.np - 1 : 0; if ((e ? ib : ia) !== i) continue;
    const nd = e ? sg.n1 : sg.n0, L = nd != null ? NODES.get(nd) : null; if (L && L.length > 1) continue;
    const S = e ? SA[SA.length - 1] : SA[0]; if (S.lod < 2 || PC[e ? PC.length - 1 : 0][0] === 'T') continue;
    const tx = S.tx * (e ? 1 : -1), ty = S.ty * (e ? 1 : -1);
    for (const t of S.tr) { const x = S.x + S.nx * t.o * U - tx * 0.6 * U, y = S.y + S.ny * t.o * U - ty * 0.6 * U; G.v.box(x, y, tx, ty, 0.25 * U, 1.1 * U, S.rt - 0.16 * U, S.rt + 0.9 * U, CL.buf); G.v.box(x - tx * 0.3 * U, y - ty * 0.3 * U, tx, ty, 0.08 * U, 1.0 * U, S.rt + 0.3 * U, S.rt + 0.75 * U, CL.white); }
  }
}
// 点 S の 左右 o（m）・高さ h（マス）。入れものは 64 個を まわして使う（すぐ写すので。小さい配列を作らない）
const RING = Array.from({ length: 64 }, () => [0, 0, 0]); let RI = 0;
const PT = (S, o, h) => { const p = RING[RI = (RI + 1) & 63]; p[0] = S.x + S.nx * o * U; p[1] = h; p[2] = S.y + S.ny * o * U; return p; };

/* ---------- 地面の線：道床・路盤・盛土・線路わき ---------- */
function bedPiece(C, A, B, lod, urb) {
  const g = G.v, ta = A.rt + ZT * U, tb = B.rt + ZT * U, fa = A.rt + ZF * U, fb = B.rt + ZF * U;
  g.q(PT(A, -A.eR, ta), PT(B, -B.eR, tb), PT(B, B.eL, tb), PT(A, A.eL, ta), C.sp.slab ? CL.slab : CL.bal);   // 道床の上
  if (lod === 0) {   // 遠い：道床のはしから 地面まで
    for (const sd of [1, -1]) { const ea = sd > 0 ? A.eL : -A.eR, eb = sd > 0 ? B.eL : -B.eR, ga = (sd > 0 ? A.gL : A.gR) - 0.3 * U, gb = (sd > 0 ? B.gL : B.gR) - 0.3 * U;
      g.q(PT(A, ea, ta), PT(B, eb, tb), PT(B, eb + sd * 1.6, Math.min(gb, fb)), PT(A, ea + sd * 1.6, Math.min(ga, fa)), CL.balS); }
    return;
  }
  const xr = A.xg && B.xg;   // 踏切の中：柵・溝・防音壁なし
  for (const sd of [1, -1]) {
    const ea = sd > 0 ? A.eL : -A.eR, eb = sd > 0 ? B.eL : -B.eR, oa = ea + sd * 0.74, ob = eb + sd * 0.74, Fa = sd * (sd > 0 ? A.fL : A.fR), Fb = sd * (sd > 0 ? B.fL : B.fR);
    g.q(PT(A, ea, ta), PT(B, eb, tb), PT(B, ob, fb), PT(A, oa, fa), C.sp.slab ? CL.concD : CL.balS);   // 道床の肩
    g.q(PT(A, oa, fa), PT(B, ob, fb), PT(B, Fb, fb), PT(A, Fa, fa), CL.form);   // 路盤（保守用の通路）
    if (lod >= 3 && !A.zone && !xr) { const ca = oa + sd * 0.25, cb = ob + sd * 0.25; g.q(PT(A, ca, fa + 0.12 * U), PT(B, cb, fb + 0.12 * U), PT(B, cb + sd * 0.4, fb + 0.12 * U), PT(A, ca + sd * 0.4, fa + 0.12 * U), CL.trough); }   // ケーブルの溝（トラフ）
    // 盛土（路盤のはしの地面が 路盤より低い）：のり面（1:1.5）
    const ga = sd > 0 ? A.gL : A.gR, gb = sd > 0 ? B.gL : B.gR, ha = Math.max(0, fa - ga) / U, hb = Math.max(0, fb - gb) / U;
    let toeA = Fa, toeB = Fb, gta = ga, gtb = gb;
    if ((ha > 1.5 || hb > 1.5) && urb) {   // まちの高い盛土：擁壁（コンクリートの かべ）
      g.q(PT(A, Fa, fa), PT(B, Fb, fb), PT(B, Fb, gb - 0.3 * U), PT(A, Fa, ga - 0.3 * U), CL.wallR);
      g.q(PT(A, Fa, fa), PT(B, Fb, fb), PT(B, Fb + sd * 0.3, fb + 0.4 * U), PT(A, Fa + sd * 0.3, fa + 0.4 * U), CL.conc);
    } else if (ha > 0.05 || hb > 0.05) {
      toeA = Fa + sd * Math.min(18, ha * 1.5 + 0.2); toeB = Fb + sd * Math.min(18, hb * 1.5 + 0.2);
      gta = Math.min(ga, X.m3Surf(A.x + A.nx * toeA * U, A.y + A.ny * toeA * U)) - 0.04 * U; gtb = Math.min(gb, X.m3Surf(B.x + B.nx * toeB * U, B.y + B.ny * toeB * U)) - 0.04 * U;
      g.q(PT(A, Fa, fa), PT(B, Fb, fb), PT(B, toeB, gtb), PT(A, toeA, gta), CL.emb);
    } else { g.q(PT(A, Fa, fa), PT(B, Fb, fb), PT(B, Fb, Math.min(fb, gb) - 0.3 * U), PT(A, Fa, Math.min(fa, ga) - 0.3 * U), CL.form); }
    // 防音壁（路盤のはし）
    if (C.sp.nw && !A.zone && !xr) { const h = (C.sp.nw === 2 ? 3.2 : 2.0) * U, wa = Fa - sd * 0.2, wb = Fb - sd * 0.2; nwall(PT(A, wa, Math.min(fa, ga)), PT(B, wb, Math.min(fb, gb)), A.rt + h, B.rt + h, A, B, sd); }
    // 線路の柵（まち。路盤・のり面の すそから 2m・線路の土地の はしまで）
    if (urb && lod >= 2 && !A.zone && !xr) {
      const ra = sd * Math.min(Math.max(C.sp.row - 0.3, Math.abs(Fa) + 1), Math.abs(toeA) + 2), rb = sd * Math.min(Math.max(C.sp.row - 0.3, Math.abs(Fb) + 1), Math.abs(toeB) + 2);
      const xa = A.x + A.nx * ra * U, ya = A.y + A.ny * ra * U, xb = B.x + B.nx * rb * U, yb = B.y + B.ny * rb * U;
      const gra = X.m3Surf(xa, ya) + 0.02 * U, grb = X.m3Surf(xb, yb) + 0.02 * U;
      if (!onRail(C, (xa + xb) / 2, (ya + yb) / 2, 0.5) && !(DEPR.length && inDep((xa + xb) / 2, (ya + yb) / 2, 0.3))) { g.q(PT(A, ra, gra - 0.1 * U), PT(B, rb, grb - 0.1 * U), PT(B, rb, grb + 1.6 * U), PT(A, ra, gra + 1.6 * U), CL.fence); g.q(PT(A, ra, gra + 1.6 * U), PT(B, rb, grb + 1.6 * U), PT(B, rb - sd * 0.08, grb + 1.6 * U), PT(A, ra - sd * 0.08, gra + 1.6 * U), CL.fenceT); }
    }
    // 雪よけ：防雪柵（線路から 8m）
    if (C.sp.snow === 1 && lod >= 2 && !A.zone && !xr) { const fa2 = Fa + sd * 6, fb2 = Fb + sd * 6, g1 = X.m3Surf(A.x + A.nx * fa2 * U, A.y + A.ny * fa2 * U), g2 = X.m3Surf(B.x + B.nx * fb2 * U, B.y + B.ny * fb2 * U); g.q(PT(A, fa2, g1), PT(B, fb2, g2), PT(B, fb2, g2 + 3 * U), PT(A, fa2, g1 + 3 * U), [0.42, 0.33, 0.25]); }
  }
  if (C.sp.snow === 2 && lod >= 1 && !A.zone) snowShed(A, B, C);
}
// 防音壁（下の点 a・b、上の高さ ya・yb、外向き sd）
function nwall(a, b, ya, yb, A, B, sd) {
  const g = G.v, t = 0.2 * U;
  const a2 = [a[0], ya, a[2]], b2 = [b[0], yb, b[2]], ao = [a[0] + A.nx * sd * t, ya, a[2] + A.ny * sd * t], bo = [b[0] + B.nx * sd * t, yb, b[2] + B.ny * sd * t];
  g.q(a, b, b2, a2, CL.nw); g.q(a2, b2, bo, ao, CL.nwT); g.q([ao[0], a[1], ao[2]], [bo[0], b[1], bo[2]], bo, ao, CL.nw);
}
// スノーシェッド：線路の上の屋根（片がわは柱・片がわは壁）
function snowShed(A, B, C) {
  const g = G.v, ya = A.rt + 6.6 * U, yb = B.rt + 6.6 * U, la = A.eL + 1.2, lb = B.eL + 1.2, ra = -A.eR - 1.2, rb = -B.eR - 1.2;
  g.q(PT(A, ra, ya), PT(B, rb, yb), PT(B, lb, yb), PT(A, la, ya), CL.snow); g.q(PT(A, ra, ya + 0.5 * U), PT(B, rb, yb + 0.5 * U), PT(B, lb, yb + 0.5 * U), PT(A, la, ya + 0.5 * U), CL.concD);
  g.q(PT(A, la, A.rt + ZF * U), PT(B, lb, B.rt + ZF * U), PT(B, lb, yb), PT(A, la, ya), CL.concD);
  const n = Math.max(1, Math.round((B.s - A.s) * 50 / 5));
  for (let k = 0; k < n; k++) { const f = k / n, x = A.x + (B.x - A.x) * f - A.nx * (-ra) * U, y = A.y + (B.y - A.y) * f - A.ny * (-ra) * U, rt = A.rt + (B.rt - A.rt) * f; g.box(x, y, A.tx, A.ty, 0.2 * U, 0.25 * U, rt + ZF * U, rt + 6.6 * U, CL.conc); }
}

/* ---------- 高架・橋：床・高欄・はり・桁 ---------- */
function deckPiece(C, A, B, c, truss, lod, run) {
  const g = G.v, ta = A.rt + ZT * U, tb = B.rt + ZT * U, da = A.rt + ZF * U, db = B.rt + ZF * U, steel = (c === 'B' || c === 'W');
  const thick = truss ? 0.9 : steel ? 0.7 : 0.75, ba = da - thick * U, bb = db - thick * U;
  const DLa = A.eL + (A.inPl ? 0.25 : 1.6), DLb = B.eL + (B.inPl ? 0.25 : 1.6), DRa = A.eR + (A.inPl ? 0.25 : 1.6), DRb = B.eR + (B.inPl ? 0.25 : 1.6);
  const cc = steel ? run.col : CL.conc, cs = steel ? run.col.map(v => v * 0.82) : CL.concD;
  g.q(PT(A, -A.eR, ta), PT(B, -B.eR, tb), PT(B, B.eL, tb), PT(A, A.eL, ta), C.sp.slab ? CL.slab : CL.bal);   // 道床
  for (const sd of [1, -1]) {
    const ea = sd > 0 ? A.eL : -A.eR, eb = sd > 0 ? B.eL : -B.eR, Da = sd * (sd > 0 ? DLa : DRa), Db = sd * (sd > 0 ? DLb : DRb);
    g.q(PT(A, ea, ta), PT(B, eb, tb), PT(B, eb + sd * 0.4, db), PT(A, ea + sd * 0.4, da), C.sp.slab ? CL.concD : CL.balS);
    g.q(PT(A, ea + sd * 0.4, da), PT(B, eb + sd * 0.4, db), PT(B, Db - sd * 0.3, db), PT(A, Da - sd * 0.3, da), CL.concB);   // 床（通路）
    const ph = truss ? 1.0 : 1.25, pa = da + ph * U, pb = db + ph * U, ia = Da - sd * 0.3, ib = Db - sd * 0.3;
    if (truss || (steel && lod >= 2)) {   // 鉄の橋：手すり（低い）
      g.q(PT(A, ia, da), PT(B, ib, db), PT(B, ib, pa - 0.2 * U), PT(A, ia, pb - 0.2 * U), cc);
    } else {   // 高欄（コンクリートの壁）
      g.q(PT(A, ia, da), PT(B, ib, db), PT(B, ib, pb), PT(A, ia, pa), CL.conc);
      g.q(PT(A, ia, pa), PT(B, ib, pb), PT(B, Db, pb), PT(A, Da, pa), CL.concD);
    }
    g.q(PT(A, Da, truss ? da : pa), PT(B, Db, truss ? db : pb), PT(B, Db, bb), PT(A, Da, ba), cc);   // 外がわの面
    if (C.sp.nw && !A.zone) { const h = (C.sp.nw === 2 ? 3.2 : 2.0) * U; nwall(PT(A, Da - sd * 0.25, pa), PT(B, Db - sd * 0.25, pb), A.rt + h, B.rt + h, A, B, sd); }
    // 下のはり（高架：柱の上の 縦ばり）・桁（ガーダー橋：深い鉄の桁）
    if (lod >= 1 || steel) {
      const isG = steel && !truss, o1 = isG ? 1.4 : 1.0, w = isG ? 0.45 : 0.9, dep = (isG ? 2.0 : c === 'O' ? 0.6 : 1.0) * U;
      const ma = Da - sd * o1, mb = Db - sd * o1;
      if (c !== 'O' || lod >= 1) {
        g.q(PT(A, ma - w / 2, ba), PT(B, mb - w / 2, bb), PT(B, mb - w / 2, bb - dep), PT(A, ma - w / 2, ba - dep), isG ? cc : CL.concD);
        g.q(PT(A, ma + w / 2, ba), PT(B, mb + w / 2, bb), PT(B, mb + w / 2, bb - dep), PT(A, ma + w / 2, ba - dep), isG ? cc : CL.concD);
        g.q(PT(A, ma - w / 2, ba - dep), PT(B, mb - w / 2, bb - dep), PT(B, mb + w / 2, bb - dep), PT(A, ma + w / 2, ba - dep), isG ? cs : CL.concB);
      }
    }
  }
  g.q(PT(A, -DRa, ba), PT(B, -DRb, bb), PT(B, DLb, bb), PT(A, DLa, ba), cs);   // 床の下
  if (C.sp.snow === 2 && lod >= 1 && !A.zone) snowShed(A, B, C);
}

/* ---------- 線路（枕木とレールの絵・近くはレールの形）・第三軌条 ---------- */
function trackPiece(C, A, B, lod) {
  const sp = C.sp; let tb = G.trk.get(sp.key); if (!tb) G.trk.set(sp.key, tb = { g: new GB(true), sp });
  const tex = trackTex(sp), rep = tex.rep, va = A.s * 50 / rep, vb = B.s * 50 / rep, w = sp.wt / 2;
  for (const t of A.tr) {
    let t2 = null; for (const q of B.tr) if (q.id === t.id) { t2 = q; break; } if (!t2) continue;
    const lift = (t.m ? 0.015 : 0.035) * U, za = A.rt + ZT * U + lift, zb = B.rt + ZT * U + lift;
    tb.g.q(PT(A, t.o - w, za), PT(B, t2.o - w, zb), PT(B, t2.o + w, zb), PT(A, t.o + w, za), CL.white, [0, va, 0, vb, 1, vb, 1, va]);
    if (lod >= 3 && !(A.xg && B.xg)) {   // レール（頭は光る・横は さび色）
      for (const r of sp.rails) {
        const a0 = t.o + r - 0.036, a1 = t.o + r + 0.036, b0 = t2.o + r - 0.036, b1 = t2.o + r + 0.036, ya = A.rt, yb = B.rt;
        G.v.q(PT(A, a0, ya), PT(B, b0, yb), PT(B, b1, yb), PT(A, a1, ya), CL.railT);
        G.v.q(PT(A, a0, za), PT(B, b0, zb), PT(B, b0, yb), PT(A, a0, ya), CL.railS);
        G.v.q(PT(A, a1, za), PT(B, b1, zb), PT(B, b1, yb), PT(A, a1, ya), CL.railS);
      }
    }
    if (sp.third && lod >= 2) {   // 第三軌条（外がわ。上に おおい）
      const sd = t.o >= 0 ? 1 : -1, o1 = t.o + sd * (sp.ga / 2000 + 0.75), o2 = t2.o + sd * (sp.ga / 2000 + 0.75);
      G.v.q(PT(A, o1 - 0.2, A.rt + 0.3 * U), PT(B, o2 - 0.2, B.rt + 0.3 * U), PT(B, o2 + 0.2, B.rt + 0.3 * U), PT(A, o1 + 0.2, A.rt + 0.3 * U), [0.86, 0.86, 0.82]);
      G.v.q(PT(A, o1 + 0.2, za), PT(B, o2 + 0.2, zb), PT(B, o2 + 0.2, B.rt + 0.3 * U), PT(A, o1 + 0.2, A.rt + 0.3 * U), CL.concD);
    }
  }
}

/* ---------- ホーム（上・ふち・点字ブロック・柵）と 屋根 ---------- */
function platPiece(C, A, B, lod, Ap, Bn, c) {
  if (!A.pl.length) return;
  const g = G.v, deck = DECK[c];
  for (const p of A.pl) {
    let q = null; for (const x of B.pl) if (x.id === p.id) { q = x; break; } if (!q) continue;
    const ya = A.rt + PH * U, yb = B.rt + PH * U, za = A.rt + (deck ? ZF : ZT) * U, zb = B.rt + (deck ? ZF : ZT) * U;
    g.q(PT(A, p.a, ya), PT(B, q.a, yb), PT(B, q.b, yb), PT(A, p.b, ya), CL.plat);
    g.q(PT(A, p.a, za), PT(B, q.a, zb), PT(B, q.a, yb), PT(A, p.a, ya), CL.platS);
    g.q(PT(A, p.b, za), PT(B, q.b, zb), PT(B, q.b, yb), PT(A, p.b, ya), CL.platS);
    // はし（つづきがない）：ホームの はしの面
    const has = (S, id) => S && S.pl.some(x => x.id === id);
    if (!has(Ap, p.id)) g.q(PT(A, p.a, za), PT(A, p.b, za), PT(A, p.b, ya), PT(A, p.a, ya), CL.platS);
    if (!has(Bn, p.id)) g.q(PT(B, q.a, zb), PT(B, q.b, zb), PT(B, q.b, yb), PT(B, q.a, yb), CL.platS);
    if (lod >= 1) for (const [e, fe, sd] of [[p.a, p.fa, 1], [p.b, p.fb, -1]]) {
      const e2 = e === p.a ? q.a : q.b;
      if (fe) {   // 線路がわ：白いふち・点字ブロック（ふちから 80cm）
        g.q(PT(A, e, ya + 0.004 * U), PT(B, e2, yb + 0.004 * U), PT(B, e2 + sd * 0.3, yb + 0.004 * U), PT(A, e + sd * 0.3, ya + 0.004 * U), CL.edge);
        if (lod >= 2) g.q(PT(A, e + sd * 0.8, ya + 0.008 * U), PT(B, e2 + sd * 0.8, yb + 0.008 * U), PT(B, e2 + sd * 1.1, yb + 0.008 * U), PT(A, e + sd * 1.1, ya + 0.008 * U), CL.tact);
      } else if (lod >= 2) {   // 外がわ：柵
        g.q(PT(A, e + sd * 0.1, ya), PT(B, e2 + sd * 0.1, yb), PT(B, e2 + sd * 0.1, yb + 1.3 * U), PT(A, e + sd * 0.1, ya + 1.3 * U), CL.fence);
      }
    }
    // 屋根（上屋）：線路がわは ふちから 0.7m 下げる
    if (p.cn && q.cn) {
      const ia = p.fa ? 0.7 : 0.15, ib = p.fb ? 0.7 : 0.15, h0 = 3.3 * U, h1 = 3.62 * U;
      const r = (S, P2, o, h) => PT(S, o, S.rt + PH * U + h), a1 = p.a + ia, b1 = p.b - ib, a2 = q.a + ia, b2 = q.b - ib;
      g.q(r(A, p, a1, h0), r(B, q, a2, h0), r(B, q, b2, h0), r(A, p, b1, h0), CL.roofB);
      const mid = (a1 + b1) / 2, mid2 = (a2 + b2) / 2, crown = p.isl ? 0.12 * U : 0;
      g.q(r(A, p, a1, h1), r(B, q, a2, h1), r(B, q, mid2, h1 + crown), r(A, p, mid, h1 + crown), CL.roofT);
      g.q(r(A, p, mid, h1 + crown), r(B, q, mid2, h1 + crown), r(B, q, b2, h1), r(A, p, b1, h1), CL.roofT);
      g.q(r(A, p, a1, h0), r(B, q, a2, h0), r(B, q, a2, h1), r(A, p, a1, h1), CL.roofT);
      g.q(r(A, p, b1, h0), r(B, q, b2, h0), r(B, q, b2, h1), r(A, p, b1, h1), CL.roofT);
      const hasC = (S, id) => S && S.pl.some(x => x.id === id && x.cn);
      if (!hasC(Ap, p.id)) g.q(r(A, p, a1, h0), r(A, p, b1, h0), r(A, p, b1, h1), r(A, p, a1, h1), CL.roofT);
      if (!hasC(Bn, p.id)) g.q(r(B, q, a2, h0), r(B, q, b2, h0), r(B, q, b2, h1), r(B, q, a2, h1), CL.roofT);
    }
  }
}

/* ---------- 高架の柱（10m ごと。道路の上は とばす）・橋脚・トラス ---------- */
function sampleAt(C, s) { return mkS(C, s); }
function structRun(C, r, SA) {
  const g = G.v, sg = C.sg;
  if (r.c === 'V' || r.c === 'O') {
    if (r.c === 'O') return;   // 道路をまたぐ短い橋：橋台だけ（abut）
    const k0 = Math.ceil((r.s0 + 0.12) / 0.2), k1 = Math.floor((r.s1 - 0.12) / 0.2);
    for (let k = k0; k <= k1; k++) {
      const s = k * 0.2, S = sampleAt(C, s); if (S.lod === 0 && k % 2) continue;
      const DL = S.eL + (S.inPl ? 0.25 : 1.6), DR = S.eR + (S.inPl ? 0.25 : 1.6), W = DL + DR, nC = W < 7.5 ? 1 : Math.max(2, Math.round(W / 7) + (W > 16 ? 1 : 0));
      const os = []; if (nC === 1) os.push((DL - DR) / 2); else for (let i = 0; i < nC; i++) os.push(-DR + 1.4 + i * (W - 2.8) / (nC - 1));
      if (os.some(o => roadNear(S.x + S.nx * o * U, S.y + S.ny * o * U, 1.2) || onRail(C, S.x + S.nx * o * U, S.y + S.ny * o * U, 0.8))) continue;   // 道路・下の線路の上には柱を立てない（はしらの間を広く）
      const bt = S.rt + (ZF - 0.75) * U, by = bt - 1.0 * U;
      for (const o of os) {
        const x = S.x + S.nx * o * U, y = S.y + S.ny * o * U, gz = X.m3Surf(x, y) - 0.3 * U;
        if (by - gz < 0.6 * U) continue;
        g.box(x, y, S.tx, S.ty, 0.45 * U, (nC === 1 ? 1.6 : 0.45) * U, gz, S.lod >= 1 ? by : bt, CL.conc);
      }
      if (S.lod >= 1) { const x = S.x + S.nx * ((DL - DR) / 2) * U, y = S.y + S.ny * ((DL - DR) / 2) * U; g.box(x, y, S.tx, S.ty, 0.5 * U, (W / 2 - 0.6) * U, by, bt, CL.concD, true); }   // 横ばり
    }
    return;
  }
  // 橋：橋脚（水の中まで）。トラスは 横の三角の組みと 上の つなぎ
  const n = r.n, Lb = r.s1 - r.s0;
  for (let k = 1; k < n; k++) {
    const s = r.s0 + Lb * k / n, S = sampleAt(C, s), DL = S.eL + 1.6, DR = S.eR + 1.6, W = DL + DR;
    const bt = S.rt + (ZF - (r.truss ? 0.9 : 0.7) - (r.truss ? 0 : 2.0)) * U, gz = X.m3Surf(S.x, S.y) - 4 * U, cx = S.x + S.nx * ((DL - DR) / 2) * U, cy = S.y + S.ny * ((DL - DR) / 2) * U;
    g.box(cx, cy, S.tx, S.ty, 1.4 * U, (W * 0.36) * U, gz, bt - 0.8 * U, CL.conc);
    g.box(cx, cy, S.tx, S.ty, 1.7 * U, (W * 0.44) * U, bt - 0.8 * U, bt, CL.concD, true);
  }
  if (!r.truss) return;
  const col = r.col, H = 8.0;
  for (let k = 0; k < n; k++) {
    const sa = r.s0 + Lb * k / n, sb = r.s0 + Lb * (k + 1) / n, np = Math.max(4, Math.round((sb - sa) * 50 / 6.5)), pts = [];
    for (let i = 0; i <= 2 * np; i++) pts.push(sampleAt(C, sa + (sb - sa) * i / (2 * np)));
    for (const sd of [1, -1]) {
      const P = (S, h) => PT(S, sd * ((sd > 0 ? S.eL : S.eR) + 1.25), S.rt + (ZF + h) * U);
      for (let i = 0; i < np; i++) {
        const b0 = pts[2 * i], tm = pts[2 * i + 1], b1 = pts[2 * i + 2];
        g.bar(P(b0, -0.5), P(b1, -0.5), 0.5 * U, 0.7 * U, col);                     // 下弦
        g.bar(P(b0, -0.5), P(tm, H), 0.45 * U, 0.45 * U, col);                       // 斜材
        g.bar(P(tm, H), P(b1, -0.5), 0.45 * U, 0.45 * U, col);
        if (i + 1 < np) g.bar(P(tm, H), P(pts[2 * i + 3], H), 0.55 * U, 0.6 * U, col);   // 上弦
      }
    }
    if (pts[0].lod >= 1) for (let i = 0; i < np; i++) { const S = pts[2 * i + 1]; g.bar(PT(S, -S.eR - 1.25, S.rt + (ZF + H) * U), PT(S, S.eL + 1.25, S.rt + (ZF + H) * U), 0.3 * U, 0.4 * U, col); }   // 上の つなぎ
  }
}
// 橋台（高架・橋と 地面の線の さかい）：sd = 1 は さかいの前が高架
function abut(C, S, sd) {
  const DL = S.eL + 1.6, DR = S.eR + 1.6, W = DL + DR, tx = S.tx * sd, ty = S.ty * sd;
  const cx = S.x + S.nx * ((DL - DR) / 2) * U + tx * 2 * U, cy = S.y + S.ny * ((DL - DR) / 2) * U + ty * 2 * U, gz = Math.min(X.m3Surf(cx, cy), S.rt + ZF * U) - 0.6 * U;
  G.v.box(cx, cy, tx, ty, 2.0 * U, (W / 2 + 0.2) * U, gz, S.rt + ZF * U - 0.02 * U, CL.concD);
}
// トンネルの中（地下ビュー。DB の更新109）：床・左右の壁（天井はなし：上から中が見える）・レール・地下駅のホーム
const CLU = { f: [0.44, 0.44, 0.45], w: [0.80, 0.78, 0.73], wt: [0.92, 0.90, 0.85], r: [0.22, 0.22, 0.24], s: [0.52, 0.48, 0.43], p: [0.88, 0.86, 0.80], pe: [0.95, 0.82, 0.25], ps: [0.70, 0.68, 0.64] };
function tunPiece(C, A, B) {
  const g = G.u, wl = Math.max(A.eL, B.eL) + 1.4, wr = Math.max(A.eR, B.eR) + 1.4;
  const P = (S, o, h) => [S.x + S.nx * o * U, S.rt + h * U, S.y + S.ny * o * U];
  g.q(P(A, -wr, -0.5), P(B, -wr, -0.5), P(B, wl, -0.5), P(A, wl, -0.5), CLU.f);   // 床
  for (const o of [wl, -wr]) {   // 壁（上のはしは 明るく）
    g.q(P(A, o, -0.5), P(B, o, -0.5), P(B, o, 5.4), P(A, o, 5.4), CLU.w);
    g.q(P(A, o, 5.4), P(B, o, 5.4), P(B, o, 5.8), P(A, o, 5.8), CLU.wt);
  }
  for (const t of A.tr) {   // バラスト（コンクリート道床）とレール
    g.q(P(A, t.o - 1.3, -0.25), P(B, t.o - 1.3, -0.25), P(B, t.o + 1.3, -0.25), P(A, t.o + 1.3, -0.25), CLU.s);
    for (const r of [-0.72, 0.72]) g.q(P(A, t.o + r - 0.05, 0), P(B, t.o + r - 0.05, 0), P(B, t.o + r + 0.05, 0), P(A, t.o + r + 0.05, 0), CLU.r);
  }
  for (const p of A.pl) {   // 地下駅のホーム（上・ふち・黄色い線）
    g.q(P(A, p.a, 1.1), P(B, p.a, 1.1), P(B, p.b, 1.1), P(A, p.b, 1.1), CLU.p);
    g.q(P(A, p.a, -0.2), P(B, p.a, -0.2), P(B, p.a, 1.1), P(A, p.a, 1.1), CLU.ps); g.q(P(A, p.b, -0.2), P(B, p.b, -0.2), P(B, p.b, 1.1), P(A, p.b, 1.1), CLU.ps);
    if (p.b - p.a > 2.4) { g.q(P(A, p.a + 0.6, 1.12), P(B, p.a + 0.6, 1.12), P(B, p.a + 0.9, 1.12), P(A, p.a + 0.9, 1.12), CLU.pe); g.q(P(A, p.b - 0.9, 1.12), P(B, p.b - 0.9, 1.12), P(B, p.b - 0.6, 1.12), P(A, p.b - 0.6, 1.12), CLU.pe); }
  }
}
// トンネルの入口：入口の面（アーチの口・まわりのコンクリート）と 中の暗がり。out：外の向き（線の向きに ±1）
function portal(C, S, out, cOut) {
  const g = G.v, ox = S.tx * out, oy = S.ty * out, nx = -oy, ny = ox;   // 外向き・右向き（外を向いて）
  let lo = 1e9, hi = -1e9; for (const t of S.tr) { lo = Math.min(lo, t.o); hi = Math.max(hi, t.o); }
  if (lo > hi) { lo = hi = 0; }
  const mid = (lo + hi) / 2, hw = (hi - lo) / 2 + 2.6, crown = hw + 2.8, Wf = hw + 3.0, top = crown + 2.2, base = DECK[cOut] ? ZF : ZF - 1.0;
  const cx = S.x + S.nx * mid * U, cy = S.y + S.ny * mid * U, rt = S.rt;
  // 断面の点：横 u（右＋。S の左向きとの関係は out による）・高さ h（m）・前後 a（外へ＋ m）
  const sideSign = (S.nx * nx + S.ny * ny) >= 0 ? 1 : -1;
  const P = (u, h, a) => [cx + (nx * u + ox * a) * U, rt + h * U, cy + (ny * u + oy * a) * U];
  const arc = []; const N = 10; const sp = crown - hw;
  for (let i = 0; i <= N; i++) { const th = Math.PI * i / N; arc.push([-Math.cos(th) * hw, sp + Math.sin(th) * hw]); }
  const T = 1.2;
  // 面（外がわの面 a = 0、厚み T で 奥へ）：左右の柱・アーチの上
  for (const a of [0, -T]) {
    g.q(P(-Wf, base, a), P(-hw, base, a), P(-hw, sp, a), P(-Wf, sp, a), CL.conc);
    g.q(P(hw, base, a), P(Wf, base, a), P(Wf, sp, a), P(hw, sp, a), CL.conc);
    for (let i = 0; i < N; i++) { const p0 = arc[i], p1 = arc[i + 1]; g.q(P(p0[0], p0[1], a), P(p1[0], p1[1], a), P(p1[0], top, a), P(p0[0], top, a), CL.conc); }
    g.q(P(-Wf, sp, a), P(-hw, sp, a), P(-hw, top, a), P(-Wf, top, a), CL.conc);
    g.q(P(hw, sp, a), P(Wf, sp, a), P(Wf, top, a), P(hw, top, a), CL.conc);
  }
  g.q(P(-Wf, top, 0), P(Wf, top, 0), P(Wf, top, -T), P(-Wf, top, -T), CL.concD);   // 上
  g.q(P(-Wf, base, 0), P(-Wf, top, 0), P(-Wf, top, -T), P(-Wf, base, -T), CL.concD);
  g.q(P(Wf, base, 0), P(Wf, top, 0), P(Wf, top, -T), P(Wf, base, -T), CL.concD);
  // 中：トンネルの内がわ（暗い灰）と 奥の暗がり
  const D = 6;
  g.q(P(-hw, base, 0), P(-hw, sp, 0), P(-hw, sp, -D), P(-hw, base, -D), [0.30, 0.30, 0.30]);
  g.q(P(hw, base, 0), P(hw, sp, 0), P(hw, sp, -D), P(hw, base, -D), [0.30, 0.30, 0.30]);
  for (let i = 0; i < N; i++) { const p0 = arc[i], p1 = arc[i + 1]; g.q(P(p0[0], p0[1], 0), P(p1[0], p1[1], 0), P(p1[0], p1[1], -D), P(p0[0], p0[1], -D), [0.26, 0.26, 0.27]); }
  g.q(P(-hw, base, -D), P(hw, base, -D), P(hw, sp, -D), P(-hw, sp, -D), CL.dark);
  for (let i = 0; i < N; i++) { const p0 = arc[i], p1 = arc[i + 1]; g.t(P(0, sp, -D), P(p0[0], p0[1], -D), P(p1[0], p1[1], -D), CL.dark); }
  // 中の線路（入口から 6m）
  const sp2 = C.sp, tb = G.trk.get(sp2.key) || (G.trk.set(sp2.key, { g: new GB(true), sp: sp2 }), G.trk.get(sp2.key)), w = sp2.wt / 2;
  g.q(P(-hw, ZT - 0.01, 0), P(hw, ZT - 0.01, 0), P(hw, ZT - 0.01, -D), P(-hw, ZT - 0.01, -D), CL.bal);
  for (const t of S.tr) { const u = (t.o - mid) * sideSign; tb.g.q(P(u - w, ZT + 0.015, 0), P(u + w, ZT + 0.015, 0), P(u + w, ZT + 0.015, -D), P(u - w, ZT + 0.015, -D), CL.white, [0, 0, 1, 0, 1, D / 2.4, 0, D / 2.4]); }
}

/* ---------- 架線：電柱（複線はビームの門型・単線は片がわ）・ちょう架線・トロリ線・き電線 ---------- */
function curvAt(C, s) {
  const a = at(C, Math.max(0, s - 0.3), {}), b = at(C, Math.min(C.len, s + 0.3), {}), d = Math.acos(Math.max(-1, Math.min(1, a.tx * b.tx + a.ty * b.ty)));
  return d / Math.max(0.05, Math.min(C.len, s + 0.3) - Math.max(0, s - 0.3));
}
function poleS(C) {
  if (C.poles) return C.poles;
  const out = []; let s = 0.25;
  while (s < C.len - 0.15) { out.push(s); const k = curvAt(C, s), R = k > 1e-6 ? 1 / k : 1e9; s += Math.max(0.5, Math.min(1.0, Math.sqrt(8 * R * 0.006))); }
  return (C.poles = Float32Array.from(out));
}
function catenary(C, SA, PC, sA, sB) {
  const sp = C.sp; if (sp.ct === 6) return;
  const ps = poleS(C), g = G.v, W = G.w, F = G.f, sup = [];
  let cj = 0; const codeAt = s => { while (cj + 1 < SA.length - 1 && SA[cj + 1].s < s) cj++; return s >= SA[0].s - 1e-6 && s <= SA[SA.length - 1].s + 1e-6 ? PC[Math.min(cj, PC.length - 1)] : codeS(C.sg, s); };   // 電柱は s の順なので 前から
  for (let i = 0; i < ps.length; i++) {
    const s = ps[i]; if (s < sA - 0.02 || s > sB + 0.02) continue;
    const pc = codeAt(s), c = pc[0]; if (c === 'T') { sup.push(null); continue; }
    const S = mkS(C, s); if (S.lod === 0) { sup.push(null); continue; }
    const xr = C.xr.length && (inXr(C, s, 'x') || inXr(C, s, 'g')), deck = !!DECK[c], tru = pc.length > 1;
    const st = (i % 2) ? 0.2 : -0.2;   // トロリ線の ジグザグ（±20cm）
    sup.push({ S, st, i, g: !!(C.xr.length && inXr(C, s, 'g')) });
    if (xr || tru) continue;   // 踏切の中・トラスの中は 電柱を立てない（線は つなぐ）
    const oL = deck ? S.eL + (S.inPl ? 0.25 : 1.6) - 0.25 : S.fL - 0.25, oR = -(deck ? S.eR + (S.inPl ? 0.25 : 1.6) - 0.25 : S.fR - 0.25);
    const fz = S.rt + ZF * U, top = S.rt + 8.6 * U, beam = S.rt + 7.4 * U, single = sp.n === 1 && S.tr.length === 1;
    const pL = [S.x + S.nx * oL * U, S.y + S.ny * oL * U], pR = [S.x + S.nx * oR * U, S.y + S.ny * oR * U], one = sp.n === 1 && S.tr.length === 1;
    if (onRail(C, pL[0], pL[1], 0.6) || (!one && onRail(C, pR[0], pR[1], 0.6)) || (DEPR.length && (onLead(pL[0], pL[1]) || (!one && onLead(pR[0], pR[1]))))) continue;   // 分かれ目・車庫のはしご：線路の上には立てない   // 分かれ目：ほかの線の上には立てない
    const pole = (o, conc) => { const x = S.x + S.nx * o * U, y = S.y + S.ny * o * U, gz = deck ? fz : Math.min(fz, X.m3Surf(x, y)) - 0.1 * U; g.box(x, y, S.tx, S.ty, (conc ? 0.2 : 0.16) * U, (conc ? 0.2 : 0.16) * U, gz, top, conc ? CL.poleC : CL.steel); return [x, y]; };
    if (single) {
      const t = S.tr[0], p = pole(oL, true);
      if (S.lod >= 2) {   // 片がわの腕（可動ブラケット）
        const a0 = PT(S, oL - 0.2, S.rt + 6.3 * U), a1 = PT(S, t.o - 0.6, S.rt + 6.3 * U), b0 = PT(S, oL - 0.2, S.rt + 5.0 * U), b1 = PT(S, t.o + st - 0.2, S.rt + 5.25 * U);
        g.bar(a0, a1, 0.08 * U, 0.08 * U, CL.steelD); g.bar(b0, b1, 0.07 * U, 0.07 * U, CL.steelD); g.bar(PT(S, (oL + t.o) / 2, S.rt + 6.3 * U), b1, 0.05 * U, 0.05 * U, CL.steelD);
      }
    } else {
      pole(oL, false); pole(oR, false);
      if (S.lod >= 3) {   // ビーム（V トラス）
        g.bar(PT(S, oR, beam + 0.3 * U), PT(S, oL, beam + 0.3 * U), 0.12 * U, 0.12 * U, CL.steel); g.bar(PT(S, oR, beam - 0.3 * U), PT(S, oL, beam - 0.3 * U), 0.12 * U, 0.12 * U, CL.steel);
        const nn = Math.max(2, Math.round((oL - oR) / 1.6));
        for (let k = 0; k < nn; k++) { const u0 = oR + (oL - oR) * k / nn, u1 = oR + (oL - oR) * (k + 1) / nn; g.bar(PT(S, u0, beam - 0.3 * U), PT(S, u1, beam + 0.3 * U), 0.06 * U, 0.06 * U, CL.steel); }
      } else g.bar(PT(S, oR, beam), PT(S, oL, beam), 0.35 * U, 0.6 * U, CL.steel);
      if (S.lod >= 2) for (const t of S.tr) {   // 線路ごとの つりさげ
        const d0 = PT(S, t.o + 0.3, beam - 0.3 * U), d1 = PT(S, t.o + 0.3, S.rt + 5.5 * U), d2 = PT(S, t.o + st, S.rt + 5.2 * U);
        g.bar(d0, d1, 0.06 * U, 0.06 * U, CL.steelD); if (S.lod >= 3) g.bar(d1, d2, 0.05 * U, 0.05 * U, CL.steelD);
      }
    }
  }
  // 線（近いところ）：ちょう架線（たるむ）・トロリ線（まっすぐ）・ハンガー・き電線
  for (let i = 0; i + 1 < sup.length; i++) {
    const a = sup[i], b = sup[i + 1]; if (!a || !b || b.i !== a.i + 1) continue;
    const A = a.S, B = b.S; if (Math.max(A.lod, B.lod) < 3) continue;
    for (const t of A.tr) {
      let t2 = null; for (const q of B.tr) if (q.id === t.id) { t2 = q; break; } if (!t2) continue;
      if (sp.ct === 5) { g.bar(PT(A, t.o + a.st * 0.3, A.rt + 5.0 * U), PT(B, t2.o + b.st * 0.3, B.rt + 5.0 * U), 0.12 * U, 0.14 * U, CL.steelD); continue; }   // 剛体架線
      const cw = sp.ct === 1 ? 5.0 : CWH, c0 = PT(A, t.o + a.st, A.rt + cw * U), c1 = PT(B, t2.o + b.st, B.rt + cw * U);
      W.l(c0, c1);
      if (sp.ct === 2) W.l(PT(A, t.o + a.st + 0.1, A.rt + cw * U), PT(B, t2.o + b.st + 0.1, B.rt + cw * U));   // ツイン
      if (sp.ct === 1) continue;   // 直接吊架：トロリ線だけ
      const mh = sp.ct === 3 ? 1.3 : 0.95, sag = sp.ct === 3 ? 0.9 : 0.7, NS = 6; let prev = null;
      const mp = f => { const o = t.o + (t2.o - t.o) * f, S2 = f < 0.5 ? A : B, x = A.x + (B.x - A.x) * f + (A.nx + (B.nx - A.nx) * f) * o * U, y = A.y + (B.y - A.y) * f + (A.ny + (B.ny - A.ny) * f) * o * U; return [x, A.rt + (B.rt - A.rt) * f + (cw + mh - 4 * sag * f * (1 - f)) * U, y]; };
      for (let k = 0; k <= NS; k++) { const p = mp(k / NS); if (prev) { W.l(prev, p); if (sp.ct === 2) W.l([prev[0], prev[1] - 0.01 * U, prev[2]], [p[0], p[1] - 0.01 * U, p[2]]); } prev = p; }
      if (sp.ct === 3) { const q0 = PT(A, t.o + a.st * 0.5, A.rt + (cw + 0.4) * U), q1 = PT(B, t2.o + b.st * 0.5, B.rt + (cw + 0.4) * U); W.l(q0, q1); }   // 補助ちょう架線
      for (let k = 1; k < 5; k++) { const f = k / 5, m = mp(f), c = [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]; W.l(m, c); }   // ハンガー
    }
    // き電線（電柱の上の外がわ。たるむ）
    if (sp.ct !== 5 && !a.g && !b.g && !(C.xr.length && C.xr.some(r => r.k === 'g' && r.s1 > A.s && r.s0 < B.s))) {
      const fo = [];
      const deckA = !!DECK[codeS(C.sg, A.s)];
      const oLa = (deckA ? A.eL + 1.35 : A.fL - 0.25) + 0.45, oLb = (deckA ? B.eL + 1.35 : B.fL - 0.25) + 0.45;
      fo.push([oLa, oLb, 8.3], [oLa, oLb, 7.9]);
      if (sp.n > 1) { const oRa = -((deckA ? A.eR + 1.35 : A.fR - 0.25) + 0.45), oRb = -((deckA ? B.eR + 1.35 : B.fR - 0.25) + 0.45); fo.push([oRa, oRb, 8.3]); }
      for (const [o1, o2, h] of fo) { let prev = null; for (let k = 0; k <= 4; k++) { const f = k / 4, o = o1 + (o2 - o1) * f, x = A.x + (B.x - A.x) * f + (A.nx + (B.nx - A.nx) * f) * o * U, y = A.y + (B.y - A.y) * f + (A.ny + (B.ny - A.ny) * f) * o * U, p = [x, A.rt + (B.rt - A.rt) * f + (h - 2.4 * f * (1 - f)) * U, y]; if (prev) F.l(prev, p); prev = p; } }
    }
  }
}

/* ---------- 駅：駅舎・屋根の場所（道路をよけて） ---------- */
function staPlan(t, XS) {
  const L = t._L; if (!L) return;
  const roads = [];   // 駅の線をまたぐ道路（d（m）と 半分の長さ）
  for (const h of XS) { if (h.k === 'level') continue; for (const e of t._cov) if (e.C === h.C) { const dm = e.dir * (h.s - e.sRef) * 50; if (Math.abs(dm) <= L.Lh + L.Rmax + 10) roads.push([dm, h.hw / h.sn + 3]); } }
  L.roads = roads;
  const big = L.elev ? true : (L.sids.length > 0 || L.pl >= 180 || L.nM >= 2 && L.pl >= 160);
  L.big = big; const bl = big ? 24 : 18;
  const free = d => roads.every(([r, w]) => Math.abs(r - d) > w + bl / 2 + 4);
  const cands = [0, -L.pl / 6, L.pl / 6, -L.pl / 3, L.pl / 3, -L.pl * 0.42, L.pl * 0.42];
  L.db = cands.find(free); if (L.db == null) L.db = null;
  // 屋根：駅舎のまわり（大きい駅は 長く）。道路のところは 切る
  const Lc = Math.min(L.pl - 8, Math.max(40, L.pl * (big ? 0.72 : 0.5))), c0 = L.db != null ? L.db : 0;
  let a = Math.max(-L.Lh + 4, c0 - Lc / 2), b = Math.min(L.Lh - 4, a + Lc); a = Math.max(-L.Lh + 4, b - Lc);
  let rs = [[a, b]];
  for (const [r, w] of roads) { const nr = []; for (const [p, q] of rs) { if (r + w <= p || r - w >= q) { nr.push([p, q]); continue; } if (r - w - p > 6) nr.push([p, r - w]); if (q - (r + w) > 6) nr.push([r + w, q]); } rs = nr; }
  L.cn = L.under ? [] : rs;
}

/* ---------- 駅：屋根の柱・駅舎・階段・跨線橋・高架駅の下・地下駅の出入口・名前 ---------- */
function staBuild(t) {
  const g = G.v;
  let g0 = X.m3Surf(t.fx, t.fy);
  if (t.k === 'bus') {   // バス停：屋根・柱・うしろのかべ・ポール
    const a = t.a || 0, c = Math.cos(a), s = Math.sin(a), lod = lodAt(t.fx, t.fy), y0 = g0 + LIFT;
    if (lod >= 1) {
      const bx = t.fx - s * 0.9 * U, by = t.fy + c * 0.9 * U;
      g.box(bx, by, c, s, 2.0 * U, 0.8 * U, y0 + 2.4 * U, y0 + 2.55 * U, CL.busR, true);
      g.box(bx - s * 0.7 * U, by + c * 0.7 * U, c, s, 1.9 * U, 0.04 * U, y0, y0 + 2.4 * U, [0.62, 0.72, 0.78]);
      for (const k of [-1.7, 1.7]) g.box(bx + c * k * U - s * 0.6 * U, by + s * k * U + c * 0.6 * U, c, s, 0.05 * U, 0.05 * U, y0, y0 + 2.4 * U, CL.steelD);
      g.box(t.fx + c * 3 * U, t.fy + s * 3 * U, c, s, 0.04 * U, 0.04 * U, y0, y0 + 2.3 * U, CL.steelD); g.box(t.fx + c * 3 * U, t.fy + s * 3 * U, c, s, 0.3 * U, 0.03 * U, y0 + 2.0 * U, y0 + 2.6 * U, CL.bus);
    } else g.box(t.fx, t.fy, c, s, 3 * U, 1 * U, y0, y0 + 2.6 * U, CL.bus);
    M3.labs.push({ x: t.fx, y: t.fy, h: y0 + 5 * U, n: t.n, f: 0, st: 'bus' });
    return;
  }
  if (t.k !== 'rail') { M3.labs.push({ x: t.fx, y: t.fy, h: g0 + 20 * U, n: t.n, f: 99, st: t.k }); return; }
  const L = t._L;
  if (!L) {   // 線がない（読めていない）：前のような かんたんな駅
    const a = t.a || 0, c = Math.cos(a), s = Math.sin(a), Ln = Math.max(0.4, (t.pl || 120) / 50), Wd = 0.22 * Math.max(1, t.tr || 1) + 0.18, y0 = g0 + LIFT;
    for (const sd of [-1, 1]) { const w = sd * (Wd / 2 - 0.055); g.box(t.fx - s * w, t.fy + c * w, c, s, Ln / 2, 0.055, y0 + ZT * U, y0 + PH * U, CL.plat); }
    M3.labs.push({ x: t.fx, y: t.fy, h: y0 + 16 * U, n: t.n, f: 99, st: 'rail' });
    return;
  }
  const c0 = staAt(t, 0); if (!c0) return;
  const lod = lodAt(c0.x, c0.y);
  let topH = c0.rt + 8 * U;
  const loc2 = (dm, o, h) => { const S = staAt(t, dm); if (!S) return null; return { x: S.x + S.nx * o * U, y: S.y + S.ny * o * U, h: S.rt + h * U, S }; };
  if (L.stub && !L.under) {   // 頭端式（DB の更新107）：線路のはし（車止め）の先に、ホームを横につなぐ コンコース（ホームの高さ・屋根つき）
    const S1 = staAt(t, L.stub * Math.max(L.Lh, L.stubL - 0.3));
    if (S1) {
      const tx = S1.tx * L.stub, ty = S1.ty * L.stub, ln = 12, mid = (L.Wl - L.Wr) / 2, hw = (L.Wl + L.Wr) / 2 + 1;
      const cx = S1.x + tx * (ln / 2) * U + S1.nx * mid * U, cy = S1.y + ty * (ln / 2) * U + S1.ny * mid * U, gz = X.m3Surf(cx, cy);
      g.box(cx, cy, tx, ty, ln / 2 * U, hw * U, Math.min(S1.rt, gz) - 0.5 * U, S1.rt + PH * U, CL.plat, true);
      g.box(cx - tx * (ln / 2 - 0.15) * U, cy - ty * (ln / 2 - 0.15) * U, tx, ty, 0.15 * U, hw * U, S1.rt + PH * U, S1.rt + (PH + 0.05) * U, CL.tact);   // 点字ブロック（ホームとの さかい）
      if (lod >= 1) {
        g.box(cx, cy, tx, ty, ln / 2 * U, hw * U, S1.rt + (PH + 3.4) * U, S1.rt + (PH + 3.7) * U, CL.roofT, true);
        for (const a of [-1, 1]) for (const b of [-1, 1]) g.box(cx + tx * a * (ln / 2 - 0.6) * U + S1.nx * b * (hw - 0.6) * U, cy + ty * a * (ln / 2 - 0.6) * U + S1.ny * b * (hw - 0.6) * U, tx, ty, 0.15 * U, 0.15 * U, S1.rt + PH * U, S1.rt + (PH + 3.4) * U, CL.col);
      }
    }
  }
  if (L.under) {   // 地下駅：地上は 出入口（屋根つきの階段の入口）と 換気口
    const ents = [[-L.pl * 0.3, L.Wl + 6], [L.pl * 0.3, -(L.Wr + 6)], [L.pl * 0.38, L.Wl + 6], [-L.pl * 0.38, -(L.Wr + 6)]];
    for (const [dm, o] of ents.slice(0, L.pl >= 160 ? 4 : 2)) {
      const S = staAt(t, dm); if (!S) continue;
      const x = S.x + S.nx * o * U, y = S.y + S.ny * o * U, gz = X.m3Surf(x, y) + LIFT * 0.5, sd = o > 0 ? 1 : -1;
      g.box(x, y, S.tx, S.ty, 3.2 * U, 1.6 * U, gz - 0.2 * U, gz + 2.8 * U, CL.bldW);
      g.box(x, y, S.tx, S.ty, 3.5 * U, 1.9 * U, gz + 2.8 * U, gz + 3.1 * U, CL.bldR, true);
      const fx = x + S.tx * 3.21 * U * sd, fy = y + S.ty * 3.21 * U * sd;   // 入口の暗い口（駅の外がわ）
      g.q([fx - S.nx * 1.1 * U, gz, fy - S.ny * 1.1 * U], [fx + S.nx * 1.1 * U, gz, fy + S.ny * 1.1 * U], [fx + S.nx * 1.1 * U, gz + 2.3 * U, fy + S.ny * 1.1 * U], [fx - S.nx * 1.1 * U, gz + 2.3 * U, fy - S.ny * 1.1 * U], [0.16, 0.17, 0.19]);
      topH = Math.max(topH, gz + 6 * U);
    }
    M3.labs.push({ x: t.fx, y: t.fy, h: Math.max(topH, g0 + 10 * U), n: t.n, f: 99, st: 'rail' });
    return;
  }
  // 屋根の柱（8m ごと。島式は まん中・相対式は うしろがわ）
  if (lod >= 1) for (const r of (L.cn || [])) for (let dm = r[0] + 2; dm <= r[1] - 1.9; dm += 8) {
    const S = staAt(t, dm); if (!S) continue;
    for (const p of L.plats) {
      const o = p.isl ? (p.lo + p.hi) / 2 : p.flo ? p.hi - 0.9 : p.lo + 0.9, x = S.x + S.nx * o * U, y = S.y + S.ny * o * U;
      g.box(x, y, S.tx, S.ty, 0.13 * U, 0.13 * U, S.rt + PH * U, S.rt + (PH + 3.35) * U, CL.col);
    }
  }
  const db = L.db;
  if (db != null && L.plats.length) {
    const S = staAt(t, db);
    if (S) {
      const Wl = L.Wl, Wr = L.Wr, mid = (Wl - Wr) / 2, bl = L.big ? 24 : 18;
      const cx = S.x + S.nx * mid * U, cy = S.y + S.ny * mid * U;
      if (L.elev) {   // 高架駅：高架の下に 駅（コンコース）。ホームには 階段の かこい
        const top = S.rt + (ZF - 2.0) * U, gz = X.m3Surf(cx, cy) - 0.2 * U;
        if (top - gz > 3 * U) { g.box(cx, cy, S.tx, S.ty, (bl / 2 + 6) * U, ((Wl + Wr) / 2 - 1.5) * U, gz, top, CL.bldW); glassBand(S, cx, cy, bl / 2 + 6, (Wl + Wr) / 2 - 1.5, gz + 0.6 * U, gz + 3.4 * U); }
        for (const p of L.plats) { const o = p.isl ? (p.lo + p.hi) / 2 : (p.lo + p.hi) / 2, x = S.x + S.nx * o * U, y = S.y + S.ny * o * U, w = Math.min(1.6, (p.hi - p.lo) / 2 - 1.3); if (w > 0.5) stairBox(x, y, S, 6, w, S.rt + PH * U, S.rt + (PH + 2.6) * U); }
        topH = Math.max(topH, S.rt + 6 * U);
      } else if (L.big) {   // 橋上駅舎：線路をまたぐ建物・ホームから階段・外へ 自由通路の階段
        const f0 = S.rt + 7.0 * U, f1 = S.rt + 12.2 * U, hw = (Wl + Wr) / 2 + 4;
        g.box(cx, cy, S.tx, S.ty, (bl / 2) * U, hw * U, f0, f1, CL.bldW, true);
        g.box(cx, cy, S.tx, S.ty, (bl / 2 + 0.6) * U, (hw + 0.6) * U, f1, f1 + 0.5 * U, CL.bldR, true);
        glassBand(S, cx, cy, bl / 2, hw, f0 + 1.0 * U, f0 + 3.6 * U);
        for (const p of L.plats) {   // ホームから 上へ（屋根のある 階段）
          const o = (p.lo + p.hi) / 2, w = Math.min(1.7, (p.hi - p.lo) / 2 - 1.2); if (w < 0.6) continue;
          const S2 = staAt(t, db + bl / 2 + 7); if (!S2) continue;
          const x = S2.x + S2.nx * o * U, y = S2.y + S2.ny * o * U; stairWedge(x, y, S2, 7, w, S2.rt + PH * U, S2.rt + (PH + 2.7) * U, f0 + 3.0 * U);
        }
        if (lod >= 1) for (const sd of [1, -1]) {   // 自由通路の階段（駅の外へ おりる）
          const o = sd > 0 ? Wl + 4 + 1.2 : -(Wr + 4 + 1.2), x = S.x + S.nx * o * U, y = S.y + S.ny * o * U, gz = X.m3Surf(x, y) + LIFT * 0.5;
          if (f0 - gz > 2 * U) { g.box(x, y, S.tx, S.ty, 2.0 * U, 1.2 * U, gz, f0 + 2.8 * U, CL.bldB); g.box(x, y, S.tx, S.ty, 2.3 * U, 1.5 * U, f0 + 2.8 * U, f0 + 3.1 * U, CL.bldR, true); }
        }
        topH = Math.max(topH, f1 + 1 * U);
      } else {   // 小さい駅：ホームのよこに 駅舎（平屋）・ホームが 2つ以上なら 跨線橋
        const top = L.plats.reduce((m, p) => Math.max(m, p.hi), 0), o = top + 5.5, x = S.x + S.nx * o * U, y = S.y + S.ny * o * U, gz = Math.min(X.m3Surf(x, y), S.rt + ZF * U) - 0.2 * U;
        g.box(x, y, S.tx, S.ty, 8 * U, 4.2 * U, gz, S.rt + (PH + 3.4) * U, CL.bldW);
        roofGable(x, y, S, 8.6, 4.8, S.rt + (PH + 3.4) * U, 1.6);
        glassBand(S, x, y, 8, 4.2, S.rt + (PH + 0.4) * U, S.rt + (PH + 2.4) * U);
        if (L.plats.length >= 2) {
          const S2 = staAt(t, db + 14); if (S2) {
            const f0 = S2.rt + 6.6 * U, lo = L.plats.reduce((m, p) => Math.min(m, p.lo), 0), hi = top, m2 = (lo + hi) / 2, x2 = S2.x + S2.nx * m2 * U, y2 = S2.y + S2.ny * m2 * U;
            g.box(x2, y2, S2.tx, S2.ty, 1.6 * U, ((hi - lo) / 2 - 1) * U, f0, f0 + 2.9 * U, CL.bldW, true);
            g.box(x2, y2, S2.tx, S2.ty, 1.8 * U, ((hi - lo) / 2 - 0.8) * U, f0 + 2.9 * U, f0 + 3.15 * U, CL.bldR, true);
            for (const p of L.plats) { const op = p.flo && !p.isl ? p.hi - 1.6 : p.fhi && !p.isl ? p.lo + 1.6 : (p.lo + p.hi) / 2, S3 = staAt(t, db + 14 - 7.5); if (!S3) continue; stairWedge(S3.x + S3.nx * op * U, S3.y + S3.ny * op * U, S3, 6, 1.1, S3.rt + PH * U, S3.rt + (PH + 2.6) * U, f0 + 2.7 * U); }
            topH = Math.max(topH, f0 + 4 * U);
          }
        }
      }
    }
  }
  M3.labs.push({ x: t.fx, y: t.fy, h: Math.max(topH, c0.rt + 9 * U) + 3 * U, n: t.n, f: 99, st: 'rail' });
}
// 窓の帯（建物の 長い2つの面に、暗いガラスの帯）
function glassBand(S, x, y, hl, hw, y0, y1) {
  const g = G.v;
  for (const sd of [1, -1]) {
    const ox = S.nx * (hw + 0.03) * U * sd, oy = S.ny * (hw + 0.03) * U * sd;
    g.q([x + ox - S.tx * (hl - 0.8) * U, y0, y + oy - S.ty * (hl - 0.8) * U], [x + ox + S.tx * (hl - 0.8) * U, y0, y + oy + S.ty * (hl - 0.8) * U], [x + ox + S.tx * (hl - 0.8) * U, y1, y + oy + S.ty * (hl - 0.8) * U], [x + ox - S.tx * (hl - 0.8) * U, y1, y + oy - S.ty * (hl - 0.8) * U], CL.glass);
  }
  for (const sd of [1, -1]) {
    const ox = S.tx * (hl + 0.03) * U * sd, oy = S.ty * (hl + 0.03) * U * sd;
    g.q([x + ox - S.nx * (hw - 0.8) * U, y0, y + oy - S.ny * (hw - 0.8) * U], [x + ox + S.nx * (hw - 0.8) * U, y0, y + oy + S.ny * (hw - 0.8) * U], [x + ox + S.nx * (hw - 0.8) * U, y1, y + oy + S.ny * (hw - 0.8) * U], [x + ox - S.nx * (hw - 0.8) * U, y1, y + oy - S.ny * (hw - 0.8) * U], CL.glass);
  }
}
function stairBox(x, y, S, hl, hw, y0, y1) { G.v.box(x, y, S.tx, S.ty, hl * U, hw * U, y0, y1, CL.bldB); G.v.box(x, y, S.tx, S.ty, (hl + 0.3) * U, (hw + 0.3) * U, y1, y1 + 0.25 * U, CL.bldR, true); }
// 屋根のある階段（長さの向きに、低いがわ y1a → 高いがわ y1b）
function stairWedge(x, y, S, hl, hw, y0, y1a, y1b) {
  const g = G.v, c = (a, b, h) => [x + S.tx * a * U + S.nx * b * U, h, y + S.ty * a * U + S.ny * b * U];
  const ya = y1a, yb = y1b;   // a がわ（+長さ）が低い・b がわ（−長さ）が高い
  g.q(c(hl, -hw, ya), c(-hl, -hw, yb), c(-hl, hw, yb), c(hl, hw, ya), CL.bldR);
  g.q(c(hl, -hw, y0), c(-hl, -hw, y0), c(-hl, -hw, yb), c(hl, -hw, ya), CL.bldB);
  g.q(c(hl, hw, y0), c(-hl, hw, y0), c(-hl, hw, yb), c(hl, hw, ya), CL.bldB);
  g.q(c(hl, -hw, y0), c(hl, hw, y0), c(hl, hw, ya), c(hl, -hw, ya), [0.30, 0.32, 0.35]);
}
// 切妻屋根（長さの向きに 棟）
function roofGable(x, y, S, hl, hw, y0, rh) {
  const g = G.v, c = (a, b, h) => [x + S.tx * a * U + S.nx * b * U, h, y + S.ty * a * U + S.ny * b * U], top = y0 + rh * U;
  g.q(c(-hl, -hw, y0), c(hl, -hw, y0), c(hl, 0, top), c(-hl, 0, top), [0.42, 0.44, 0.47]);
  g.q(c(-hl, hw, y0), c(hl, hw, y0), c(hl, 0, top), c(-hl, 0, top), [0.42, 0.44, 0.47]);
  g.t(c(-hl, -hw, y0), c(-hl, hw, y0), c(-hl, 0, top), CL.bldW); g.t(c(hl, -hw, y0), c(hl, hw, y0), c(hl, 0, top), CL.bldW);
}

/* ---------- 踏切：板（道路より手前）・レール・警報機・遮断機・止まれの線 ---------- */
const XA = { list: [], bySeg: new Map(), fr: -1, t: 0, arms: null, lamps: null, tm: 0 };
function xBuild() {
  XA.list = []; XA.bySeg = new Map(); XA.arms = null; XA.lamps = null;
  const g = G.x, v = G.v;
  for (const h of G.xs) {
    const S = mkS(h.C, h.s); if (S.lod === 0 && M3.d > 60) continue;
    const tx = S.tx, ty = S.ty, nx = S.ty, ny = -S.tx;   // まっすぐの 線の向き・左（踏切のところ）
    const cs = h.rx * tx + h.ry * ty, sn = h.rx * nx + h.ry * ny, asn = Math.max(0.25, Math.abs(sn)), sgn = sn >= 0 ? 1 : -1, k = cs / (sgn * asn), H = h.hw / asn + 0.4;
    const roadZ = X.m3Surf(h.x, h.y) + LIFT, zP = Math.max(S.rt, roadZ) + 0.02 * U;
    const W = (t, o, z) => [h.x + (tx * t + nx * o) * U, z, h.y + (ty * t + ny * o) * U];
    const oL = S.eL + 0.4, oR = -S.eR - 0.4;
    g.q(W(oL * k - H, oL, zP), W(oL * k + H, oL, zP), W(oR * k + H, oR, zP), W(oR * k - H, oR, zP), CL.xpan);   // 踏切の板
    for (const t of S.tr) for (const r of h.C.sp.rails) { const o = t.o + r; g.q(W(o * k - H, o - 0.035, zP + 0.006 * U), W(o * k + H, o - 0.035, zP + 0.006 * U), W(o * k + H, o + 0.035, zP + 0.006 * U), W(o * k - H, o + 0.035, zP + 0.006 * U), CL.railT); }
    // 道路の向き（+r に進む車・−r に進む車）ごとに：止まれの線・警報機・遮断機
    const c = { s: h.s, cl: 0, tg: 0, arms: [], lamps: [], C: h.C };
    for (const dr of [1, -1]) {
      const rx = h.rx * dr, ry = h.ry * dr, lx = ry, ly = -rx;   // 進む向き・左
      const sideB = (-dr * sgn) > 0 ? S.eL : S.eR;   // 来るがわの 道床のはば
      const uS = -(sideB + 2.2) / asn, uL = -(sideB + 4.2) / asn;   // 警報機・止まれの線（線路のまん中から）
      const pS = [h.x + rx * uS * U, h.y + ry * uS * U], pL = [h.x + rx * uL * U, h.y + ry * uL * U];
      const zr = X.m3Surf(pL[0], pL[1]) + LIFT + 0.03 * U;
      if (S.lod >= 1) g.q([pL[0], zr, pL[1]], [pL[0] + lx * h.hw * 0.95 * U, zr, pL[1] + ly * h.hw * 0.95 * U], [pL[0] + lx * h.hw * 0.95 * U + rx * 0.45 * U, zr, pL[1] + ly * h.hw * 0.95 * U + ry * 0.45 * U], [pL[0] + rx * 0.45 * U, zr, pL[1] + ry * 0.45 * U], CL.white);
      const px = pS[0] + lx * (h.hw + 0.7) * U, py = pS[1] + ly * (h.hw + 0.7) * U, gz = X.m3Surf(px, py) + LIFT;
      // 警報機：柱（黒と黄）・バッテン（踏切警標）・赤い灯 2つ（灯は 来る車のほうへ）・方向の箱
      v.box(px, py, rx, ry, 0.1 * U, 0.1 * U, gz, gz + 3.8 * U, CL.post);
      for (let q = 0; q < 4; q++) v.box(px, py, rx, ry, 0.11 * U, 0.11 * U, gz + (0.1 + q * 0.3) * U, gz + (0.25 + q * 0.3) * U, CL.blk);
      if (S.lod >= 1) {
        const xb = [px - rx * 0.14 * U, gz + 3.4 * U, py - ry * 0.14 * U];
        for (const sgx of [1, -1]) { const dx = lx * 0.75 * sgx, dy = 0.5; xcross(v, xb, [xb[0] + dx * U, xb[1] + dy * U, xb[2] + ly * 0.75 * sgx * U], [xb[0] - dx * U, xb[1] - dy * U, xb[2] - ly * 0.75 * sgx * U]); }
        v.box(px - rx * 0.12 * U, py - ry * 0.12 * U, rx, ry, 0.07 * U, 0.7 * U, gz + 2.5 * U, gz + 3.0 * U, CL.blk);   // 灯の板
        v.box(px - rx * 0.14 * U, py - ry * 0.14 * U, rx, ry, 0.09 * U, 0.3 * U, gz + 2.05 * U, gz + 2.4 * U, CL.blk);   // 方向の箱
        for (const sgx of [1, -1]) c.lamps.push([px - rx * 0.2 * U + lx * 0.38 * sgx * U, gz + 2.75 * U, py - ry * 0.2 * U + ly * 0.38 * sgx * U, Math.atan2(ry, rx)]);
      }
      // 遮断機：箱と さお（しまると 道路の左半分を ふさぐ）
      const bx = px + rx * -0.7 * U, by = py + ry * -0.7 * U;
      v.box(bx, by, rx, ry, 0.25 * U, 0.2 * U, gz, gz + 1.1 * U, CL.post);
      c.arms.push({ x: bx - lx * 0.15 * U, y: gz + 0.95 * U, z: by - ly * 0.15 * U, dx: -lx, dz: -ly, len: (h.hw + 0.6) * U });
    }
    XA.list.push(c);
    let a = XA.bySeg.get(h.C.sg.id); if (!a) XA.bySeg.set(h.C.sg.id, a = []); a.push(c);
  }
}
// 踏切警標の 1本（黄と黒の しま）
function xcross(g, c, p, q) {
  const n = 6; for (let i = 0; i < n; i++) { const f0 = i / n, f1 = (i + 1) / n, a = [p[0] + (q[0] - p[0]) * f0, p[1] + (q[1] - p[1]) * f0, p[2] + (q[2] - p[2]) * f0], b = [p[0] + (q[0] - p[0]) * f1, p[1] + (q[1] - p[1]) * f1, p[2] + (q[2] - p[2]) * f1]; g.bar(a, b, 0.05 * U, 0.26 * U, i % 2 ? CL.blk : CL.yel); }
}
// さお（しま）の形：+x に長さ 1
let ARMG = null, LAMPG = null;
function armGeo() {
  if (ARMG) return ARMG;
  const g = new GB(false), n = 10, w = 0.07 * U;
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n, col = i % 2 ? CL.blk : CL.yel; g.box((a + b) / 2, 0, 1, 0, (b - a) / 2, w, -w, w, col, true); }
  const m = g.mesh(null); ARMG = m.geometry; return ARMG;
}
function flushX() {
  const L = XA.list; if (!L.length) return;
  const arms = [], lamps = [];
  L.forEach((c, i) => { c.ai = arms.length; for (const a of c.arms) arms.push(a); c.li = lamps.length; for (const l of c.lamps) lamps.push(l); });
  // さお・灯は いつも同じ InstancedMesh を使う（数が足りなければ 作りなおす。作りなおすたびに 捨てない）
  if (arms.length) {
    if (!MAT.arm) MAT.arm = keep(new T3.MeshLambertMaterial({ vertexColors: true }));
    if (!XA.armIM || XA.armIM.cap < arms.length) { if (XA.armIM) XA.armIM.dispose(); XA.armIM = new T3.InstancedMesh(armGeo(), MAT.arm, Math.ceil(arms.length * 1.5) + 8); XA.armIM.cap = Math.ceil(arms.length * 1.5) + 8; XA.armIM.frustumCulled = false; XA.armIM.instanceMatrix.setUsage(T3.DynamicDrawUsage); }
    const im = XA.armIM; im.geometry = armGeo(); im.count = arms.length; XA.arms = im; XA.armL = arms;
    for (const c of L) setArms(c);
    X.grp.add(im);
  }
  if (lamps.length) {
    if (!MAT.lamp) MAT.lamp = keep(new T3.MeshBasicMaterial({ color: '#ffffff' }));
    if (!LAMPG) LAMPG = new T3.CylinderGeometry(0.2 * U, 0.2 * U, 0.08 * U, 12).rotateZ(Math.PI / 2);
    if (!XA.lampIM || XA.lampIM.cap < lamps.length) { if (XA.lampIM) XA.lampIM.dispose(); XA.lampIM = new T3.InstancedMesh(LAMPG, MAT.lamp, Math.ceil(lamps.length * 1.5) + 8); XA.lampIM.cap = Math.ceil(lamps.length * 1.5) + 8; XA.lampIM.frustumCulled = false; }
    const im = XA.lampIM, m = new T3.Matrix4(), q = new T3.Quaternion(), up = new T3.Vector3(0, 1, 0), p = new T3.Vector3(), sc = new T3.Vector3(1, 1, 1), col = new T3.Color(0.22, 0.05, 0.04);
    im.geometry = LAMPG; im.count = lamps.length;
    lamps.forEach((l, i) => { p.set(l[0], l[1], l[2]); q.setFromAxisAngle(up, -l[3]); m.compose(p, q, sc); im.setMatrixAt(i, m); im.setColorAt(i, col); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    XA.lamps = im; X.grp.add(im);
  }
  XA.fr = -1; XA.t = performance.now();
}
const _m = { m: null, q: null, p: null, s: null, d: null, x: null };
function setArms(c) {
  if (!XA.arms) return;
  if (!_m.m) { _m.m = new T3.Matrix4(); _m.q = new T3.Quaternion(); _m.p = new T3.Vector3(); _m.s = new T3.Vector3(); _m.d = new T3.Vector3(); _m.x = new T3.Vector3(1, 0, 0); }
  const th = (1 - smooth(c.cl)) * 1.45;   // ひらく：ほぼ まっすぐ上（83°）・しまる：水平
  c.arms.forEach((a, k) => {
    _m.d.set(a.dx * Math.cos(th), Math.sin(th), a.dz * Math.cos(th)).normalize(); _m.q.setFromUnitVectors(_m.x, _m.d);
    _m.p.set(a.x, a.y, a.z); _m.s.set(a.len, 1, 1); _m.m.compose(_m.p, _m.q, _m.s); XA.arms.setMatrixAt(c.ai + k, _m.m);
  });
  XA.arms.instanceMatrix.needsUpdate = true;
}
// 1フレームに1回（列車の高さを聞かれたとき）：近くに列車がいる踏切は 鳴って しまる
function xFrame() {
  const now = performance.now(), dt = Math.min(0.5, Math.max(0, (now - XA.t) / 1000)); XA.t = now;
  let any = false; const blink = Math.floor(Date.now() / 520) % 2, col = XA.lamps ? new T3.Color() : null;
  for (const c of XA.list) {
    const tg = c.hit ? 1 : 0; c.hit = false;
    if (tg && !c.tg) c.since = now; c.tg = tg;
    const go = tg && now - (c.since || 0) > 2500;   // 鳴りはじめてから 少しして しまる
    const nv = go ? Math.min(1, c.cl + dt / 4) : !tg ? Math.max(0, c.cl - dt / 5) : c.cl;
    if (nv !== c.cl) { c.cl = nv; setArms(c); }
    if (tg || c.cl > 0) any = true;
    if (XA.lamps && (tg || c.lit)) { c.lamps.forEach((l, k) => { const on = tg && (k % 2) === blink; col.setRGB(on ? 1 : 0.22, on ? 0.12 : 0.05, on ? 0.08 : 0.04); XA.lamps.setColorAt(c.li + k, col); }); c.lit = tg; if (XA.lamps.instanceColor) XA.lamps.instanceColor.needsUpdate = true; }
  }
  clearTimeout(XA.tm);
  if (any) { const fr0 = XA.fr; XA.tm = setTimeout(() => { if (XA.fr !== fr0) return; for (const c of XA.list) { c.tg = 0; c.cl = 0; c.hit = false; setArms(c); } if (XA.lamps) { const k = new T3.Color(0.22, 0.05, 0.04); for (let i = 0; i < XA.lamps.count; i++) XA.lamps.setColorAt(i, k); if (XA.lamps.instanceColor) XA.lamps.instanceColor.needsUpdate = true; } if (M3) M3.dirty = true; }, 2500); }
}

/* ---------- 車両基地（T）・留置線（R）：大きさ "T240x6"（長さ m × 線の数）の車庫だけ（S・M・L とバスの車庫は描かない）
   四角（map.js の depPoly と同じ）：P0→P1 が線路から gap・P3→P2 が gap＋wt。k 番目（1〜n）の線は P0＋(P3−P0)·k/(n+1) → P1＋(P2−P1)·k/(n+1)
   （留置線の編成は この線の まん中に、地面＋1m＋10cm で 描かれるので、レールの上は 地面＋1m）。
   道床（地面にそって）・枕木とレール・両はしの車止め・本線からの はしご（P0 のはし）。T は 検修庫（1・2番目の線の P1 のはし）と 架線のビーム ---------- */
function depDim2(sz) { const m = /^([TR])(\d+)x(\d+)$/.exec(sz || ''); if (!m) return null; const l = +m[2], n = +m[3]; return { kind: m[1], lt: l / 50, wt: (n * 5 + 10) / 50, gap: 0.25, n }; }
let DEPR = [];
function depPrep(deps, v) {
  DEPR = [];
  for (const d of deps) {
    if (d.k !== 'rail' || d.fx == null) continue;
    const q = depDim2(d.sz); if (!q || !(q.n >= 1) || !(q.lt > 0)) continue;
    if (d.fx < v.x0 - q.lt || d.fx > v.x1 + q.lt || d.fy < v.y0 - q.lt || d.fy > v.y1 + q.lt) continue;
    const a = d.a || 0, sd = d.side || 1, ux = Math.cos(a), uy = Math.sin(a), nx = -uy * sd, ny = ux * sd;
    const sg = d.seg != null && X.it && X.it.segs ? X.it.segs.get(d.seg) : null, sp = sg && sg.k === 'rail' && sg.np >= 2 ? segC(sg).sp : spec({});
    const wm = sp.n > 1 ? Math.abs(sp.offs[0]) : 0, wf = (q.gap + q.wt * q.n / (q.n + 1)) * 50, u1 = -q.lt * 25 + 8, Lld = Math.max(40, (wf - wm) * 2.2);
    DEPR.push(Object.assign({ d, ux, uy, nx, ny, sp, wm, wf, u1, u0: u1 - Lld }, q));
  }
}
// 車庫の四角（本線から 外がわの はしまで・はしごも）の中か（柵をよける）
const inDep = (x, y, pad) => DEPR.some(r => { const dx = (x - r.d.fx) / U, dy = (y - r.d.fy) / U, u = dx * r.ux + dy * r.uy, w = dx * r.nx + dy * r.ny; return u >= r.u0 - pad / U && u <= r.lt * 25 + pad / U && w >= -pad / U && w <= (r.gap + r.wt) * 50 + pad / U; });
// はしご（本線から 車庫へ ななめの線）の近くか（電柱を立てない）
const onLead = (x, y) => DEPR.some(r => { const dx = (x - r.d.fx) / U, dy = (y - r.d.fy) / U, u = dx * r.ux + dy * r.uy, w = dx * r.nx + dy * r.ny; if (u < r.u0 - 5 || u > r.u1 + 5) return false; const t = Math.max(0, Math.min(1, (u - r.u0) / (r.u1 - r.u0))); return Math.abs(w - (r.wm + (r.wf - r.wm) * t)) < 4; });
function depBuild() {
  const g = G.v;
  for (const r of DEPR) {
    const { d, n, ux, uy, nx, ny, sp } = r, L = r.lt * 50, W = r.wt * 50, G0 = r.gap * 50;
    const P2 = (u, w) => [d.fx + (ux * u + nx * w) * U, d.fy + (uy * u + ny * w) * U];
    const hAt = (u, w) => { const p = P2(u, w); return X.m3Surf(p[0], p[1]) + LIFT; };   // レールの上
    const Q = (u, w, h) => { const p = P2(u, w); return [p[0], h, p[1]]; };
    const lod = lodAt(d.fx + nx * (G0 + W / 2) * U, d.fy + ny * (G0 + W / 2) * U), step = lod >= 1 ? 12.5 : 50, nu = Math.max(2, Math.ceil(L / step));
    const ws = [G0]; for (let k = 1; k <= n; k++) ws.push(G0 + W * k / (n + 1)); ws.push(G0 + W);
    const us = []; for (let i = 0; i <= nu; i++) us.push(-L / 2 + L * i / nu);
    const H = us.map(u => ws.map(w => hAt(u, w)));
    // 道床（地面にそって）・まわりの のり面
    for (let i = 0; i < nu; i++) for (let j = 0; j + 1 < ws.length; j++) g.q(Q(us[i], ws[j], H[i][j] + ZT * U), Q(us[i + 1], ws[j], H[i + 1][j] + ZT * U), Q(us[i + 1], ws[j + 1], H[i + 1][j + 1] + ZT * U), Q(us[i], ws[j + 1], H[i][j + 1] + ZT * U), CL.bal);
    const J = ws.length - 1;
    for (let i = 0; i < nu; i++) for (const [j, sd] of [[0, -1], [J, 1]]) g.q(Q(us[i], ws[j], H[i][j] + ZT * U), Q(us[i + 1], ws[j], H[i + 1][j] + ZT * U), Q(us[i + 1], ws[j] + sd * 1.2, H[i + 1][j] + (ZF - 0.3) * U), Q(us[i], ws[j] + sd * 1.2, H[i][j] + (ZF - 0.3) * U), CL.balS);
    for (const [i, sd] of [[0, -1], [nu, 1]]) for (let j = 0; j < J; j++) g.q(Q(us[i], ws[j], H[i][j] + ZT * U), Q(us[i], ws[j + 1], H[i][j + 1] + ZT * U), Q(us[i] + sd * 1.2, ws[j + 1], H[i][j + 1] + (ZF - 0.3) * U), Q(us[i] + sd * 1.2, ws[j], H[i][j] + (ZF - 0.3) * U), CL.balS);
    // 線路（絵・近くはレール）。線の向きの まっすぐ
    let tb = G.trk.get(sp.key); if (!tb) G.trk.set(sp.key, tb = { g: new GB(true), sp });
    const rep = trackTex(sp).rep, wt2 = sp.wt / 2;
    const strip = (ua, wa, ha, ub, wb, hb, lift) => {
      const du = ub - ua, dw = wb - wa, Ll = Math.hypot(du, dw) || 1, eu = -dw / Ll, ew = du / Ll, za = ha + ZT * U + lift, zb = hb + ZT * U + lift, va = ua / rep, vb = va + Ll / rep;
      tb.g.q(Q(ua - eu * wt2, wa - ew * wt2, za), Q(ub - eu * wt2, wb - ew * wt2, zb), Q(ub + eu * wt2, wb + ew * wt2, zb), Q(ua + eu * wt2, wa + ew * wt2, za), CL.white, [0, va, 0, vb, 1, vb, 1, va]);
      if (lod >= 3) for (const rr of sp.rails) {
        const a0 = Q(ua + eu * (rr - 0.036), wa + ew * (rr - 0.036), ha), a1 = Q(ua + eu * (rr + 0.036), wa + ew * (rr + 0.036), ha), b0 = Q(ub + eu * (rr - 0.036), wb + ew * (rr - 0.036), hb), b1 = Q(ub + eu * (rr + 0.036), wb + ew * (rr + 0.036), hb);
        g.q(a0, b0, b1, a1, CL.railT); g.q([a0[0], za, a0[2]], [b0[0], zb, b0[2]], b0, a0, CL.railS); g.q([a1[0], za, a1[2]], [b1[0], zb, b1[2]], b1, a1, CL.railS);
      }
    };
    for (let k = 1; k <= n; k++) {
      for (let i = 0; i < nu; i++) strip(us[i], ws[k], H[i][k], us[i + 1], ws[k], H[i + 1][k], 0.015 * U);
      if (lod >= 2) for (const [i, sd] of [[0, -1], [nu, 1]]) { const p = P2(us[i] - sd * 1.2, ws[k]); g.box(p[0], p[1], ux, uy, 0.25 * U, 1.1 * U, H[i][k] + ZT * U, H[i][k] + 0.9 * U, CL.buf); const p2 = P2(us[i] - sd * 0.95, ws[k]); g.box(p2[0], p2[1], ux, uy, 0.06 * U, 1.0 * U, H[i][k] + 0.35 * U, H[i][k] + 0.75 * U, CL.white); }   // 車止め
    }
    // はしご：本線（車庫がわの線路）から P0 のはしの 線路を ななめに（道床も）
    const nl = Math.max(2, Math.ceil((r.u1 - r.u0) / 12.5)); let pv = null;
    for (let i = 0; i <= nl; i++) {
      const t = i / nl, u = r.u0 + (r.u1 - r.u0) * t, w = r.wm + (r.wf - r.wm) * t, h = hAt(u, w);
      if (pv) {
        strip(pv[0], pv[1], pv[2], u, w, h, 0.035 * U);
        if (pv[1] < G0 || w < G0) g.q(Q(pv[0], pv[1] - 2.2, pv[2] + ZT * U - 0.01 * U), Q(u, w - 2.2, h + ZT * U - 0.01 * U), Q(u, w + 2.2, h + ZT * U - 0.01 * U), Q(pv[0], pv[1] + 2.2, pv[2] + ZT * U - 0.01 * U), CL.bal);
      }
      pv = [u, w, h];
    }
    // 検修庫（T：1・2番目の線の上、はしごと反対の P1 のはし。どこにでもある形：切妻の屋根・線路ごとの入口）
    if (r.kind === 'T' && (lod >= 1 || L >= 300)) {
      const k2 = Math.min(2, n), wa = ws[1] - 3.2, wb = ws[k2] + 3.2, Ls = Math.max(40, Math.min(110, L * 0.35)), ua = L / 2 - 0.5 - Ls, ub = L / 2 - 0.5;
      let lo = 1e9, hi = -1e9; for (const u of [ua, (ua + ub) / 2, ub]) for (const w of [wa, wb]) { const h = hAt(u, w); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const c = P2((ua + ub) / 2, (wa + wb) / 2), Hh = hi + 8.5 * U, top = Hh + Math.min(2.2, (wb - wa) * 0.12) * U, wc = (wa + wb) / 2, wall = [0.80, 0.82, 0.83], roof = [0.55, 0.58, 0.62];
      g.box(c[0], c[1], ux, uy, (ub - ua) / 2 * U, (wb - wa) / 2 * U, lo + ZF * U, Hh, wall);
      g.q(Q(ua - 0.6, wa - 0.6, Hh), Q(ub + 0.6, wa - 0.6, Hh), Q(ub + 0.6, wc, top), Q(ua - 0.6, wc, top), roof);
      g.q(Q(ua - 0.6, wb + 0.6, Hh), Q(ub + 0.6, wb + 0.6, Hh), Q(ub + 0.6, wc, top), Q(ua - 0.6, wc, top), roof);
      g.t(Q(ua, wa, Hh), Q(ua, wb, Hh), Q(ua, wc, top), wall); g.t(Q(ub, wa, Hh), Q(ub, wb, Hh), Q(ub, wc, top), wall);
      for (let k = 1; k <= k2; k++) g.q(Q(ua - 0.03, ws[k] - 2.1, lo + ZT * U), Q(ua - 0.03, ws[k] + 2.1, lo + ZT * U), Q(ua - 0.03, ws[k] + 2.1, hi + 5.4 * U), Q(ua - 0.03, ws[k] - 2.1, hi + 5.4 * U), [0.20, 0.21, 0.23]);   // 入口
      if (lod >= 2) for (let u = ua + 6; u < ub - 4; u += 9) g.q(Q(u, wa - 0.03, lo + 1.5 * U), Q(u + 5, wa - 0.03, lo + 1.5 * U), Q(u + 5, wa - 0.03, lo + 6.5 * U), Q(u, wa - 0.03, lo + 6.5 * U), CL.glass);   // 窓
    }
    // 架線のビーム（T・電化した線の車庫）
    if (r.kind === 'T' && sp.el && sp.ct !== 6 && lod >= 2) for (let u = -L / 2 + 15; u < L / 2 - 10; u += 45) {
      const wa = G0 + 1.4, wb = G0 + W - 1.4, ha = hAt(u, wa), hb = hAt(u, wb), hm = Math.max(ha, hb);
      for (const [w, h] of [[wa, ha], [wb, hb]]) { const p = P2(u, w); g.box(p[0], p[1], ux, uy, 0.16 * U, 0.16 * U, h + ZF * U, hm + 8.4 * U, CL.steel); }
      g.bar(Q(u, wa, hm + 7.4 * U), Q(u, wb, hm + 7.4 * U), 0.35 * U, 0.6 * U, CL.steel);
      if (lod >= 3) for (let k = 1; k <= n; k++) { const u2 = Math.min(L / 2 - 4, u + 45), h1 = hAt(u, ws[k]), h2 = hAt(u2, ws[k]); G.w.l(Q(u, ws[k], h1 + CWH * U), Q(u2, ws[k], h2 + CWH * U)); G.w.l(Q(u, ws[k], h1 + MWH * U), Q(u2, ws[k], h2 + MWH * U)); }
    }
  }
}

/* ---------- メッシュにする ---------- */
function flush() {
  const grp = X.grp;
  if (G.v.nv) grp.add(G.v.mesh(matV()));
  for (const o of G.trk.values()) if (o.g.nv) grp.add(o.g.mesh(matT(o.sp)));
  if (G.x.nv) grp.add(G.x.mesh(matX()));
  if (G.u.nv) { const m = G.u.mesh(matU()); m.userData.ug = true; grp.add(m); }   // 地下ビューの トンネル（DB の更新109）
  for (const [lb, k] of [[G.w, 0], [G.f, 1]]) if (lb.a.length) { const geo = new T3.BufferGeometry(); geo.setAttribute('position', new T3.Float32BufferAttribute(lb.a, 3)); grp.add(new T3.LineSegments(geo, matL(k))); }
  flushX();
  R.nv = G.v.nv;
}

/* ---------- 列車：レールの上に ---------- */
// 左右のずれ（マス。進む向きの左が＋）：複線・複々線は 内がわの 2本（左を走る）・単線は まん中。s があれば 線のはしの よせ も。
//   sd：線の s の向きに進むか（1）逆か（−1）。ホームの形を決めた駅（DB の更新107）では 本線が ひろがる。
//   tr：とまる駅と番線［駅, 番線, 駅, 番線］（前の駅・つぎの駅）があれば、その駅では その番線に入る
function off(sg, k, s, sd, tr) {
  const C = segC(sg); if (!C.sp) C.sp = spec(sg);
  const n = C.sp.n, d = sd < 0 ? -1 : 1;
  if (s == null) return n === 1 ? 0 : C.sp.sp / 2 * U;
  if (tr && C.sta.length) for (const e of C.sta) {
    const L = e.t._L; if (!L || !L.slot) continue;
    let no = 0; for (let i = 0; i + 1 < tr.length; i += 2) if (tr[i] === e.t.id) no = tr[i + 1];
    if (!no) continue;
    const q = L.sids.find(x => x.slot === no - 1); if (!q) continue;   // 本線の番線は ふつうの本線（ひろげたもの）
    const dm = e.dir * (s - e.sRef) * 50, o = sidO(q, L.Lh, dm, L);
    if (o != null) return d * e.dir * o * U;
  }
  const j = n === 1 ? 0 : n === 2 ? (d > 0 ? 0 : 1) : (d > 0 ? 1 : 2);
  return d * conv(C, s, C.sta.length ? mainOff(C, s, j) : C.sp.offs[j]) * U;
}
// 走る面の高さ（レールの上）。トンネルの中は見せない
function runY(sg, s, x, y, k) {
  if (!X) return null;
  try { return runY2(sg, s); } catch (e) { return null; }
}
function runY2(sg, s) {
  const C = segC(sg);
  if (XA.list.length) {
    const fr = M3 && M3.r ? M3.r.info.render.frame : 0; if (fr !== XA.fr) { XA.fr = fr; xFrame(); }
    const L = XA.bySeg.get(sg.id); if (L) for (const c of L) if (Math.abs(s - c.s) < 4) c.hit = true;
  }
  return { y: rtS(C, s), hide: codeS(sg, s) === 'T' };
}

const R = window.M3RAIL = { build, off, runY, stations: true, car: { w: 2.95, h: 3.75 }, ms: 0, nv: 0, ver: 1 };
// たしかめる用：踏切を しめる（v 1）・ひらく（v 0）
R.dbg = { xa: XA, close(v) { for (const c of XA.list) { c.cl = v; c.tg = v; c.lit = !!v; setArms(c); if (XA.lamps) { const k = new T3.Color(); c.lamps.forEach((l, i) => { k.setRGB(v && i % 2 ? 1 : 0.22, v && i % 2 ? 0.12 : 0.05, v && i % 2 ? 0.08 : 0.04); XA.lamps.setColorAt(c.li + i, k); }); if (XA.lamps.instanceColor) XA.lamps.instanceColor.needsUpdate = true; } } if (M3) M3.dirty = true; return XA.list.length; } };
})();
