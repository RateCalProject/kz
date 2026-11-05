(function () {
'use strict';
/* ===== 風の芽経済組：3D の地形・川・湖・海岸（t64c。M3TERRA）=====
   map3d.js が chunk(X, c, cx, cy, st)（チャンクの網）・lo(X, cx, cy)（遠くの あらい網）を よぶ。水のないチャンクは 前の m3ChunkMesh のまま。
   水の近くは カメラに近いほど こまかく（1/8・1/4 マス）。遠くは マスの網と 水の色の面。こまかさは 自分で見て 作りなおしを たのむ（onBeforeRender）
   地面のまま 水の上をとおる道路には 橋（床版・桁・高欄・橋脚。m3Surf も橋の高さに）。線路の橋は 線路のファイルが つくる
   - 川・湖は 岸より低い水面（川は下流へなめらかに下がる。段は ならす）。岸は まち：コンクリートの護岸・大きい川：河川敷・いなか：草の土手・山：石の河原
   - 海：砂浜（ぬれた砂・波打ちぎわの白い波）・磯（がけの下の岩）・まち：護岸と消波ブロック・港：岸壁
   - userData.H：網の点の高さ（見える面：地面か水面）。建物・道路・線路・列車は m3Surf（この H）の上に。
     陸のマスは 水ぎわまで前と同じ高さ（建物が うかない・しずまない）。岸の形は 水のマスの中だけ */

const CS = 64;
let MG = 26, NW = CS + 2 * MG;   // 窓：チャンクと まわり MG マス（くわしく しらべるときは 26・あらい網は 8）
const setWin = m => { MG = m; NW = CS + 2 * m; };
const B64X = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~!*()+=';
const B64I = new Int8Array(128); for (let i = 0; i < 72; i++) B64I[B64X.charCodeAt(i)] = i;
const EDEC = Float32Array.from({ length: 72 }, (_, l) => l <= 7 ? -187.5 + l * 25 : l <= 32 ? (l - 8) * 4 + 2 : l <= 48 ? 112.5 + (l - 33) * 25 : 575 + (l - 49) * 150);
const half = e => e <= 100 ? 2 : e <= 500 ? 12.5 : Infinity;   // 標高の段の半分（map3d.js の m3Half と同じ）
// 地形の記号 → 番号（1〜4 は水）
const TD = 1, TS = 2, TR = 3, TL = 4, TB = 5, TP = 6, TF = 7, TH = 8, TM = 9, TK = 10;
const TCH = ' DSRLBPFHMK', TCODE = new Uint8Array(128); for (let i = 1; i < TCH.length; i++) TCODE[TCH.charCodeAt(i)] = i;
const ZDASH = 45;   // 用途地域なし '-'
const ZURB = new Uint8Array(128); for (const ch of 'abcdefgk') ZURB[ch.charCodeAt(0)] = 1;   // まち（住居・商業・工業・港湾）
const ZG = 'g'.charCodeAt(0);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// なめらかなゆらぎ（-1〜1。f：1マスあたりの目の数）。世界の位置だけで決まる（チャンクのさかいで そろう）
function vn(x, y, f, s) {
  const X1 = x * f, Y1 = y * f, i = Math.floor(X1), j = Math.floor(Y1), u = X1 - i, v = Y1 - j, uu = u * u * (3 - 2 * u), vv = v * v * (3 - 2 * v);
  const a = hash(i + s, j), b = hash(i + 1 + s, j), c = hash(i + s, j + 1), d = hash(i + 1 + s, j + 1);
  return ((a + (b - a) * uu) * (1 - vv) + (c + (d - c) * uu) * vv) * 2 - 1;
}

// 岸の形（水のマスごと）
const ST_OPEN = 1, ST_BEACH = 2, ST_ROCK = 3, ST_WALL = 4, ST_PORT = 5, ST_LAKE = 6, ST_LAKEU = 7, ST_RURB = 8, ST_RRUR = 9, ST_RBIG = 10, ST_RMTN = 11;
// 色（0〜1）
const C_PAVE = [0.70, 0.69, 0.65], C_CONC = [0.66, 0.66, 0.63], C_CONCW = [0.44, 0.45, 0.43], C_BED = [0.31, 0.31, 0.27], C_MUD = [0.45, 0.43, 0.33],
      C_GRASS = [0.46, 0.58, 0.30], C_GRASS2 = [0.53, 0.62, 0.35], C_REED = [0.57, 0.59, 0.37], C_GRAVEL = [0.71, 0.69, 0.63], C_STONE = [0.55, 0.54, 0.50],
      C_SAND = [0.90, 0.85, 0.70], C_WSAND = [0.69, 0.63, 0.49], C_ROCK = [0.45, 0.43, 0.39], C_ROCKW = [0.28, 0.28, 0.26], C_SEABED = [0.62, 0.60, 0.50];
// 水の色（ふかいところ）：海・湖・川・山の川
const WC_SEA = [0.20, 0.42, 0.63], WC_LAKE = [0.17, 0.36, 0.47], WC_RIV = [0.21, 0.38, 0.43], WC_MTN = [0.19, 0.43, 0.46];

const ST = { n: 0, ms: 0, ms5: 0, n5: 0, ph: {} };
const TPH = (k, t) => { const n = performance.now(); ST.ph[k] = (ST.ph[k] || 0) + n - t; return n; };   // かかった時間（場面ごと。たしかめる用）   // かかった時間（たしかめる用）
const MAT = { t: null, w: null, wd: null, b: null, ws: null, k: null, blk: null };


// のびる型つき配列（push の配列より 速い・ごみが少ない）
class FA { constructor(n) { this.a = new Float32Array(n); this.n = 0; } push3(x, y, z) { if (this.n + 3 > this.a.length) this.grow(); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3; } push2(x, y) { if (this.n + 2 > this.a.length) this.grow(); this.a[this.n] = x; this.a[this.n + 1] = y; this.n += 2; } grow() { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } out() { return this.a.slice(0, this.n); } }
class IA { constructor(n) { this.a = new Uint32Array(n); this.n = 0; } tri(a, b, c) { if (this.n + 3 > this.a.length) { const b2 = new Uint32Array(this.a.length * 2); b2.set(this.a); this.a = b2; } const t = this.a, n = this.n; t[n] = a; t[n + 1] = b; t[n + 2] = c; this.n = n + 3; } quad(a, b, d, e) { this.tri(a, d, b); this.tri(b, d, e); } quad2(a, b, d, e, ha, hb, hd, he) { if (Math.abs(ha - he) < Math.abs(hb - hd)) { this.tri(a, d, e); this.tri(a, e, b); } else { this.tri(a, d, b); this.tri(b, d, e); } } out(nv) { return nv > 65535 ? this.a.slice(0, this.n) : Uint16Array.from(this.a.subarray(0, this.n)); } }
// 頂点の法線（三角の面の向きを 面積で足す。computeVertexNormals より速い）
function normals(P, I, nv) {
  const N = new Float32Array(nv * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let v = 0; v < nv * 3; v += 3) { const l = Math.sqrt(N[v] * N[v] + N[v + 1] * N[v + 1] + N[v + 2] * N[v + 2]) || 1; N[v] /= l; N[v + 1] /= l; N[v + 2] /= l; }
  return N;
}
function geo(T3, P, C, I, nv, extra) {
  const g = new T3.BufferGeometry(), Pa = P instanceof FA ? P.out() : P, Ia = I.out(nv);
  g.setAttribute('position', new T3.BufferAttribute(Pa, 3)); g.setAttribute('color', new T3.BufferAttribute(C instanceof FA ? C.out() : C, 3));
  if (extra) for (const k in extra) g.setAttribute(k, new T3.BufferAttribute(extra[k][0] instanceof FA ? extra[k][0].out() : extra[k][0], extra[k][1]));
  g.setIndex(new T3.BufferAttribute(Ia, 1));
  return g;
}

/* ---------- 作業用の配列（使いまわす。ごみを出さない） ---------- */
const SCR = new Map();
function scr(name, Type, n) { let a = SCR.get(name); if (!a || a.length < n || !(a instanceof Type)) { a = new Type(n); SCR.set(name, a); } return a; }

/* ---------- 窓（チャンクと まわり MG マス）のマス ---------- */
function readWin(X, c, cx, cy) {
  const S = X.S, ck = X.ckey, x0 = cx * CS - MG, y0 = cy * CS - MG, n = NW * NW;
  const T = scr('T', Uint8Array, n), ER = scr('ER', Float32Array, n), Z = scr('Z', Uint8Array, n);
  let hasB = false, hasL = false;
  for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
    const ccx = cx + dcx, ccy = cy + dcy, src = S.chunks.get(ck(ccx, ccy));
    const ax = Math.max(x0, ccx * CS), bx = Math.min(x0 + NW, ccx * CS + CS), ay = Math.max(y0, ccy * CS), by = Math.min(y0 + NW, ccy * CS + CS);
    if (src && src.sea) { for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) { const w = (y - y0) * NW + (x - x0); T[w] = TD; ER[w] = -190; Z[w] = ZDASH; } continue; }
    const s = src || c, ts = s.t, es = s.e, zs = s.z, zo = s.zo, scx = s.cx * CS, scy = s.cy * CS;
    for (let y = ay; y < by; y++) {
      const sy = src ? y : clamp(y, cy * CS, cy * CS + CS - 1), row = (sy - scy) * CS;   // まだ読んでいない となりは、このチャンクのへり（前と同じ）
      for (let x = ax; x < bx; x++) {
        const w = (y - y0) * NW + (x - x0), k = row + (src ? x : clamp(x, cx * CS, cx * CS + CS - 1)) - scx;
        const t = TCODE[ts.charCodeAt(k)] || TP; T[w] = t; ER[w] = EDEC[B64I[es.charCodeAt(k)]];
        Z[w] = zo && zo.has(k) ? String(zo.get(k)).charCodeAt(0) : zs.charCodeAt(k);
        if (t === TB) hasB = true; else if (t === TL) hasL = true;
      }
    }
  }
  return { x0, y0, T, ER, Z, hasB, hasL };
}
// ならした標高（前の m3ChunkMesh と同じ：3 マスの箱で 2 回・もとの段の中に）
function smoothE(T, ER) {
  const n = NW * NW, E0 = scr('E0', Float32Array, n), A = scr('E', Float32Array, n), B = scr('Eb', Float32Array, n), P = scr('Ep', Float64Array, NW + 1);
  for (let k = 0; k < n; k++) A[k] = E0[k] = T[k] === TD || T[k] === TS ? 0 : Math.max(0, ER[k]);
  for (let p = 0; p < 4; p++) {
    const src = p & 1 ? B : A, dst = p & 1 ? A : B, hor = !(p & 1);
    for (let r = 0; r < NW; r++) {
      P[0] = 0;
      if (hor) { const o = r * NW; for (let q = 0; q < NW; q++) P[q + 1] = P[q] + src[o + q]; for (let q = 0; q < NW; q++) { const lo = q > 3 ? q - 3 : 0, hi = q < NW - 4 ? q + 3 : NW - 1; dst[o + q] = (P[hi + 1] - P[lo]) / (hi - lo + 1); } }
      else { for (let q = 0; q < NW; q++) P[q + 1] = P[q] + src[q * NW + r]; for (let q = 0; q < NW; q++) { const lo = q > 3 ? q - 3 : 0, hi = q < NW - 4 ? q + 3 : NW - 1; dst[q * NW + r] = (P[hi + 1] - P[lo]) / (hi - lo + 1); } }
    }
  }
  for (let k = 0; k < n; k++) { const e0 = E0[k], hs = half(e0); A[k] = Math.max(e0 - hs, Math.min(e0 + hs, A[k])); }
  return A;
}
// 距離（マスのまん中どうし。近い目安）：src のマスからの距離
function chamfer(src, out) {
  const INF = 1e6, D2 = 1.41421;
  for (let k = 0; k < NW * NW; k++) out[k] = src[k] ? 0 : INF;
  for (let y = 0; y < NW; y++) for (let x = 0; x < NW; x++) {
    const k = y * NW + x; let v = out[k]; if (!v) continue;
    if (x > 0 && out[k - 1] + 1 < v) v = out[k - 1] + 1;
    if (y > 0) { if (out[k - NW] + 1 < v) v = out[k - NW] + 1; if (x > 0 && out[k - NW - 1] + D2 < v) v = out[k - NW - 1] + D2; if (x < NW - 1 && out[k - NW + 1] + D2 < v) v = out[k - NW + 1] + D2; }
    out[k] = v;
  }
  for (let y = NW - 1; y >= 0; y--) for (let x = NW - 1; x >= 0; x--) {
    const k = y * NW + x; let v = out[k]; if (!v) continue;
    if (x < NW - 1 && out[k + 1] + 1 < v) v = out[k + 1] + 1;
    if (y < NW - 1) { if (out[k + NW] + 1 < v) v = out[k + NW] + 1; if (x < NW - 1 && out[k + NW + 1] + D2 < v) v = out[k + NW + 1] + D2; if (x > 0 && out[k + NW - 1] + D2 < v) v = out[k + NW - 1] + D2; }
    out[k] = v;
  }
}
// まわり r マスの和（和の表で）
function sat(name, V) { const S2 = scr(name, Float32Array, (NW + 1) * (NW + 1)); for (let x = 0; x <= NW; x++) S2[x] = 0; for (let y = 0; y < NW; y++) { let rs = 0; const o = (y + 1) * (NW + 1); S2[o] = 0; for (let x = 0; x < NW; x++) { rs += V[y * NW + x]; S2[o + x + 1] = S2[o - NW - 1 + x + 1] + rs; } } return S2; }
const boxSum = (S2, x, y, r) => { const a = x > r ? x - r : 0, b = y > r ? y - r : 0, c = x + r + 1 < NW ? x + r + 1 : NW, d = y + r + 1 < NW ? y + r + 1 : NW; return S2[d * (NW + 1) + c] - S2[b * (NW + 1) + c] - S2[d * (NW + 1) + a] + S2[b * (NW + 1) + a]; };

// 湖の水面（つながった湖のマスの いちばん低い標高 − 1m）。まわり 1 チャンクまで さがす
function lakeLevels(X, c, cx, cy, Wn) {
  const S = X.S, ck = X.ckey, B = 3 * CS, bx = (cx - 1) * CS, by = (cy - 1) * CS, n = B * B;
  const LT = scr('LT', Uint8Array, n).fill(0), LE = scr('LE', Float32Array, n);
  for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
    const s = S.chunks.get(ck(cx + dcx, cy + dcy)); if (!s || s.sea) continue;
    const t = s.t, e = s.e, ox = (dcx + 1) * CS, oy = (dcy + 1) * CS;
    for (let k = t.indexOf('L'); k >= 0; k = t.indexOf('L', k + 1)) { const q = (oy + (k >> 6)) * B + ox + (k & 63); LT[q] = 1; LE[q] = EDEC[B64I[e.charCodeAt(k)]]; }
  }
  const comp = scr('LC', Int32Array, n).fill(-1), stack = scr('LS', Int32Array, n), lv = [];
  for (let y = 0; y < NW; y++) for (let x = 0; x < NW; x++) {
    const w = y * NW + x; if (Wn.T[w] !== TL) continue;
    const gx = Wn.x0 + x - bx, gy = Wn.y0 + y - by; if (gx < 0 || gy < 0 || gx >= B || gy >= B) continue;
    const q0 = gy * B + gx; if (!LT[q0]) continue;
    if (comp[q0] < 0) {
      const id = lv.length; let sp = 0, mn = Infinity; stack[sp++] = q0; comp[q0] = id;
      while (sp) { const q = stack[--sp]; if (LE[q] < mn) mn = LE[q]; const qx = q % B, qy = (q / B) | 0;
        if (qx > 0 && LT[q - 1] && comp[q - 1] < 0) { comp[q - 1] = id; stack[sp++] = q - 1; }
        if (qx < B - 1 && LT[q + 1] && comp[q + 1] < 0) { comp[q + 1] = id; stack[sp++] = q + 1; }
        if (qy > 0 && LT[q - B] && comp[q - B] < 0) { comp[q - B] = id; stack[sp++] = q - B; }
        if (qy < B - 1 && LT[q + B] && comp[q + B] < 0) { comp[q + B] = id; stack[sp++] = q + B; } }
      lv.push(mn - 1);
    }
    Wn.LK[w] = lv[comp[q0]];
  }
}

/* ---------- 水のしらべ：水面の高さ・岸の高さ・はば・岸の形（マスごと）。full でないとき（遠い網）は 湖・海の水面だけ ---------- */
function analyze(X, c, cx, cy, full) {
  const Wn = readWin(X, c, cx, cy), { T, ER, Z } = Wn, n = NW * NW;
  const E = smoothE(T, ER);
  const isW = scr('isW', Uint8Array, n), isL = scr('isL', Uint8Array, n);
  let nWater = 0;
  for (let k = 0; k < n; k++) { const t = T[k]; if (t >= TD && t <= TL) { isW[k] = 1; isL[k] = 0; nWater++; } else { isW[k] = 0; isL[k] = 1; } }
  Wn.E = E; Wn.isW = isW; Wn.nWater = nWater;
  // 陸の高さ EL（m。網の点で使う）。砂浜（海のそばの B）は 波打ちぎわへ低く
  const EL = Wn.EL = scr('EL', Float32Array, n);
  for (let k = 0; k < n; k++) EL[k] = E[k] > 0.02 ? E[k] : 0.02;
  if (Wn.hasB && nWater) {
    const isSea = scr('isSea', Uint8Array, n), dSea = scr('dSea', Float32Array, n);
    for (let k = 0; k < n; k++) isSea[k] = T[k] === TD || T[k] === TS ? 1 : 0;
    chamfer(isSea, dSea);
    for (let k = 0; k < n; k++) if (T[k] === TB && dSea[k] < 3.5) EL[k] = Math.max(0.02, Math.min(EL[k], 0.45 + 0.9 * (dSea[k] - 1)));
  }
  if (!nWater) return Wn;
  const Wt = Wn.Wt = scr('Wt', Float32Array, n).fill(NaN), STY = Wn.STY = scr('STY', Uint8Array, n).fill(0);
  // 湖の水面
  const LK = Wn.LK = scr('LK', Float32Array, n).fill(NaN);
  if (Wn.hasL) lakeLevels(X, c, cx, cy, Wn);
  if (!full) {   // 遠い網：海 0・湖の水面・川は陸の高さ（上に水の色の面）
    for (let k = 0; k < n; k++) { if (!isW[k]) continue; const t = T[k]; Wt[k] = t === TR ? EL[k] : t === TL ? (LK[k] === LK[k] ? LK[k] : Math.max(0, E[k] - 1)) : 0; STY[k] = t === TR ? ST_RRUR : t === TL ? ST_LAKE : ST_OPEN; }
    return Wn;
  }
  const dL = Wn.dL = scr('dL', Float32Array, n), dW = Wn.dW = scr('dW', Float32Array, n); chamfer(isL, dL); chamfer(isW, dW);
  // まち・港・砂浜・陸の数（まわり 3 マス）・陸の高さの和
  const U = scr('U', Float32Array, n), G = scr('G', Float32Array, n), BB = scr('BB', Float32Array, n), SEv = scr('SEv', Float32Array, n);
  for (let k = 0; k < n; k++) { const l = isL[k]; U[k] = l && ZURB[Z[k]] ? 1 : 0; G[k] = l && Z[k] === ZG ? 1 : 0; BB[k] = T[k] === TB ? 1 : 0; SEv[k] = l ? EL[k] : 0; }
  const SU = sat('SU', U), SG = sat('SG', G), SL = sat('SL', isL), SB = sat('SB', BB), SE = sat('SE', SEv);
  // 岸の高さ HB（水のマス：まわりの陸の平均）・はば HW・形 STY・水面の目安 L0
  const HB = Wn.HB = scr('HB', Float32Array, n), HW = Wn.HW = scr('HW', Float32Array, n).fill(0), L0 = scr('L0', Float32Array, n).fill(Infinity);
  for (let y = 0; y < NW; y++) for (let x = 0; x < NW; x++) {
    const k = y * NW + x;
    if (!isW[k]) { HB[k] = EL[k]; continue; }
    let r = 2, nl = boxSum(SL, x, y, r); if (nl < 1) { r = 4; nl = boxSum(SL, x, y, r); }
    const hb = nl >= 1 ? boxSum(SE, x, y, r) / nl : EL[k];
    HB[k] = hb;
    // はば（岸からの いちばん遠いところ。まわり 2 マス）
    let mx = 0; for (let b = y > 2 ? y - 2 : 0; b <= Math.min(NW - 1, y + 2); b++) for (let a = x > 2 ? x - 2 : 0; a <= Math.min(NW - 1, x + 2); a++) { const q = b * NW + a; if (isW[q] && dL[q] > mx) mx = dL[q]; }
    HW[k] = Math.max(0.5, mx - 0.5);
    const t = T[k], nu = boxSum(SU, x, y, 3), nl3 = boxSum(SL, x, y, 3);
    if (t === TD || t === TS) {
      L0[k] = 0;
      if (dL[k] > 4) STY[k] = ST_OPEN;
      else if (boxSum(SB, x, y, 1) >= 1) STY[k] = ST_BEACH;   // 砂浜のマスが となりに あれば 砂浜（港の中でも）
      else if (boxSum(SG, x, y, 3) >= 3) STY[k] = ST_PORT;
      else if (nu >= 5 && nu >= nl3 * 0.3) STY[k] = ST_WALL;
      else STY[k] = ST_ROCK;
    } else if (t === TL) {
      L0[k] = LK[k] === LK[k] ? LK[k] : Math.max(0, E[k] - 1);
      STY[k] = nu >= 6 && nu >= nl3 * 0.4 ? ST_LAKEU : ST_LAKE;
    } else {
      // 川：山（高い・まわりの高さの差が大きい）・大きい川（はば 1.4 マス以上）・まち・いなか
      let emn = Infinity, emx = -Infinity;
      for (let b = y > 3 ? y - 3 : 0; b <= Math.min(NW - 1, y + 3); b += 2) for (let a = x > 3 ? x - 3 : 0; a <= Math.min(NW - 1, x + 3); a += 2) { const e = E[b * NW + a]; if (e < emn) emn = e; if (e > emx) emx = e; }
      const sty = hb > 140 || emx - emn > 40 ? ST_RMTN : HW[k] >= 1.4 ? ST_RBIG : nu >= 4 && nu >= nl3 * 0.25 ? ST_RURB : ST_RRUR;
      STY[k] = sty;
      L0[k] = Math.min(E[k], hb) - (sty === ST_RURB ? 3.4 : sty === ST_RBIG ? 3.8 : sty === ST_RMTN ? 1.6 : 2.4);
    }
  }
  // 川の水面：小さなでこぼこ・段をとる（まわり 5 マスの いちばん低い目安。ただし 6m まで）→ まわり 3 マスの水のマスの平均を 2 回
  {
    const R = 5, L1 = scr('L1', Float32Array, n), tmp = scr('Lt', Float32Array, n);
    for (let y = 0; y < NW; y++) { const r0 = y * NW; for (let x = 0; x < NW; x++) { let m = Infinity; const a1 = Math.min(NW - 1, x + R); for (let a = x > R ? x - R : 0; a <= a1; a++) if (L0[r0 + a] < m) m = L0[r0 + a]; tmp[r0 + x] = m; } }
    for (let x = 0; x < NW; x++) for (let y = 0; y < NW; y++) { let m = Infinity; const b1 = Math.min(NW - 1, y + R); for (let b = y > R ? y - R : 0; b <= b1; b++) if (tmp[b * NW + x] < m) m = tmp[b * NW + x]; L1[y * NW + x] = m; }
    for (let k = 0; k < n; k++) L1[k] = isW[k] ? Math.max(L1[k], L0[k] - 6) : 0;
    const SM = sat('SM', isW);
    for (let p = 0; p < 2; p++) {
      const SV = sat('SV', L1);
      for (let y = 0; y < NW; y++) for (let x = 0; x < NW; x++) { const k = y * NW + x; if (!isW[k]) continue; const m = boxSum(SM, x, y, 3); tmp[k] = m > 0 ? boxSum(SV, x, y, 3) / m : L1[k]; }
      for (let k = 0; k < n; k++) if (isW[k]) L1[k] = tmp[k];
    }
    for (let k = 0; k < n; k++) {
      if (!isW[k]) continue;
      const t = T[k];
      Wt[k] = t === TD || t === TS ? 0 : t === TL ? L0[k] : Math.max(0, Math.min(L1[k], L0[k] + 0.3, HB[k] - 0.8));
    }
    // 川は 岸より高くしない（t67）：となり（1マス。なければ 2マス）の いちばん低い陸より 0.6m 下まで（低い岸から あふれて、まわりの陸が 水びたしに見えないように）
    for (let y = 0; y < NW; y++) for (let x = 0; x < NW; x++) {
      const k = y * NW + x; if (!isW[k] || T[k] !== TR) continue;
      let lo = Infinity;
      for (let r = 1; r <= 2 && lo === Infinity; r++) for (let b = y > r ? y - r : 0; b <= Math.min(NW - 1, y + r); b++) for (let a = x > r ? x - r : 0; a <= Math.min(NW - 1, x + r); a++) { const q = b * NW + a; if (!isW[q] && EL[q] < lo) lo = EL[q]; }
      if (lo < Infinity) Wt[k] = Math.max(0, Math.min(Wt[k], lo - 0.6));
    }
  }
  // 陸のマスにも（となりの水のマスの平均）：岸の近くの 補間のため
  for (let y = 0; y < NW; y++) for (let x = 0; x < NW; x++) {
    const k = y * NW + x; if (isW[k] || dW[k] > 2.9) continue;
    let s = 0, m = 0, hw = 0, sea = false;
    for (let r = 1; r <= 2 && !m; r++) for (let b = y > r ? y - r : 0; b <= Math.min(NW - 1, y + r); b++) for (let a = x > r ? x - r : 0; a <= Math.min(NW - 1, x + r); a++) { const q = b * NW + a; if (isW[q]) { s += Wt[q]; hw += HW[q]; m++; if (T[q] === TD || T[q] === TS) sea = true; } }
    if (m) { Wt[k] = sea ? s / m : Math.min(s / m, EL[k] - 0.3); HW[k] = hw / m; }   // 川・湖のそばの陸は 水の下にしない（t67）
  }
  return Wn;
}

/* ---------- 岸の形：u（なめらかな岸の線からの距離。マス。0 より小さいところは 陸と同じ高さ・色の へり）・hb（岸の高さ m）・W（水面 m）・
   hw（川はばの半分 マス）・lc（となりの陸の色）→ 地面の高さ（m）と色 ---------- */
function col(o, c, f, c2) { if (c2) { o.r = c[0] + (c2[0] - c[0]) * f; o.gg = c[1] + (c2[1] - c[1]) * f; o.b = c[2] + (c2[2] - c[2]) * f; } else { o.r = c[0]; o.gg = c[1]; o.b = c[2]; } }
const MIXC = [0, 0, 0];
const mixc = (a, b, f) => { MIXC[0] = a[0] + (b[0] - a[0]) * f; MIXC[1] = a[1] + (b[1] - a[1]) * f; MIXC[2] = a[2] + (b[2] - a[2]) * f; return MIXC; };
function profile(sty, u, hb, W, hw, x, y, lc, o) {
  hb = Math.max(hb, W + 0.3);
  if (u <= 0) { o.g = hb; col(o, lc); return; }   // 陸のマスの角と なめらかな岸の線のあいだ：陸と同じ
  switch (sty) {
    case ST_RURB: {   // まちの川：天端（コンクリートのふち）→ 護岸（コンクリートの のり面。下は ぬれて暗い）→ 水
      const c0 = 0.03, w0 = clamp(hw * 0.42, 0.12, 0.24);
      if (u <= c0) { o.g = hb + 0.12; col(o, C_PAVE); }
      else if (u <= c0 + w0) { const t = (u - c0) / w0; o.g = hb + 0.12 + (W - 0.6 - hb - 0.12) * (0.15 * t + 0.85 * t * t); col(o, C_CONC, sst(W + 0.9, W - 0.1, o.g), C_CONCW); }
      else { o.g = W - 0.6 - 0.9 * sst(0, 0.12, u - c0 - w0); col(o, C_BED); }
      return;
    }
    case ST_RRUR: {   // いなかの川：草の土手 → 水ぎわの ヨシ・どろ
      const b1 = clamp(hw * 0.45, 0.08, 0.3), wl = W - 0.3;
      if (u <= b1) { const t = u / b1, g = hb + (wl - hb) * (0.3 * t + 0.7 * t * t); o.g = g; col(o, mixc(lc, C_GRASS2, sst(0, 0.3, t)), sst(W + 1.4, W + 0.25, g), C_REED); if (g < W + 0.25) col(o, C_MUD); }
      else { o.g = wl - 1.0 * sst(0, 0.15, u - b1); col(o, C_BED); }
      return;
    }
    case ST_RBIG: {   // 大きい川：天端（道）→ のり面（草）→ 河川敷（草・へりは石の河原）→ 低水路の岸 → 水
      const hf = Math.max(W + 1.3, Math.min(hb - 1.2, W + 2.2)), s1 = 0.17, wc = Math.max(0.42, hw * 0.46), uc = Math.max(s1 + 0.14, hw - wc);
      if (u <= 0.03) { o.g = hb; col(o, C_PAVE); }
      else if (u <= s1) { const t = (u - 0.03) / (s1 - 0.03); o.g = hb + (hf - hb) * t; col(o, C_GRASS); }
      else if (u <= uc) { o.g = hf; const g2 = vn(x, y, 1.5, 11); col(o, mixc(C_GRASS2, C_GRASS, 0.5 + 0.5 * vn(x, y, 0.7, 13)), sst(uc - 0.2, uc - 0.03, u) * (0.6 + 0.4 * g2), C_GRAVEL); }
      else if (u <= uc + 0.12) { const t = (u - uc) / 0.12; o.g = hf + (W - 0.4 - hf) * t; col(o, C_STONE, sst(W + 0.6, W - 0.2, o.g), C_MUD); }
      else { o.g = W - 0.4 - 1.6 * sst(0, 0.25, u - uc - 0.12); col(o, C_BED); }
      return;
    }
    case ST_RMTN: {   // 山の川：石の河原（岩がところどころ水から出る）
      const b = clamp(hw * 0.6, 0.08, 0.4), wl = W - 0.2, nz = vn(x, y, 6, 3);
      if (u <= b) { const t = u / b, g = hb + (wl - hb) * Math.pow(t, 0.75); o.g = g + 0.35 * nz * sst(0.2, 0.6, t); col(o, mixc(lc, C_ROCK, sst(0, 0.35, t)), sst(W + 3, W + 0.6, g), C_GRAVEL); }
      else { o.g = wl - 0.7 * sst(0, 0.2, u - b) + 0.55 * Math.max(0, nz - 0.25) * 2.2; col(o, C_STONE); }
      return;
    }
    case ST_LAKE: {   // 湖：草の岸 → 水ぎわの砂利 → ゆるい浅瀬
      const b = 0.12, wl = W + 0.1;
      if (u <= b) { const t = u / b, g = hb + (wl - hb) * sst(0, 1, t); o.g = g; col(o, mixc(lc, C_GRASS2, sst(0, 0.4, t)), sst(W + 1.0, W + 0.25, g), C_GRAVEL); }
      else { o.g = wl - Math.min(5, 0.35 + 3.2 * (u - b)); col(o, C_BED); }
      return;
    }
    case ST_LAKEU: {   // まちの湖：石の護岸
      const c0 = 0.03, w0 = 0.14;
      if (u <= c0) { o.g = hb; col(o, C_PAVE); }
      else if (u <= c0 + w0) { const t = (u - c0) / w0; o.g = hb + (W - 1 - hb) * t; col(o, C_STONE, sst(W + 0.8, W - 0.2, o.g), C_CONCW); }
      else { o.g = W - 1 - Math.min(4, 3 * (u - c0 - w0)); col(o, C_BED); }
      return;
    }
    case ST_BEACH: {   // 砂浜：ぬれた砂 → 波打ちぎわ → 砂の浅瀬
      const g = u < 0.5 ? hb - 4.6 * u : hb - 2.3 - 2.4 * (u - 0.5);
      o.g = Math.max(g, -14);
      if (g > 0.3) col(o, C_SAND, sst(0.6, 0.3, g), C_WSAND); else if (g > -0.05) col(o, C_WSAND); else col(o, C_SEABED);
      return;
    }
    case ST_ROCK: {   // 磯：がけ（高い陸）・岩の多い岸。岩が ところどころ水から出る
      const nz = vn(x, y, 5, 5), nz2 = vn(x, y, 11, 9);
      if (hb > 6) {
        if (u <= 0.08) { const t = u / 0.08; o.g = hb + (0.9 - hb) * Math.pow(t, 0.6); col(o, mixc(lc, C_ROCK, sst(0, 0.3, t))); }
        else { o.g = 0.9 - 4.5 * (u - 0.08) + 0.9 * nz + 0.35 * nz2; col(o, o.g > 0.1 ? C_ROCK : C_ROCKW); }
      } else {
        const t = clamp(u / 0.2, 0, 1); o.g = hb + (-0.6 - hb) * t + (0.7 * nz + 0.3 * nz2) * sst(0.1, 0.5, t) - Math.max(0, u - 0.2) * 3;
        col(o, C_ROCK, sst(0.8, 0.1, o.g), C_ROCKW); if (t < 0.3) col(o, lc, t / 0.3, C_ROCK);
      }
      o.g = Math.max(o.g, -12);
      return;
    }
    case ST_WALL: {   // まちの海：護岸（コンクリートの のり面）→ 消波ブロックの置き場
      const c0 = 0.03, w0 = 0.13;
      if (u <= c0) { o.g = hb; col(o, C_PAVE); }
      else if (u <= c0 + w0) { const t = (u - c0) / w0; o.g = hb + (-2.2 - hb) * t; col(o, C_CONC, sst(0.8, -0.2, o.g), C_CONCW); }
      else { o.g = -2.2 - Math.min(8, 3.5 * (u - c0 - w0)); col(o, C_BED); }
      return;
    }
    case ST_PORT: {   // 港：岸壁（深い。直立の壁は coastKit で。地面は 壁の線から すぐ水の下へ）
      const c0 = 0.015;
      if (u <= c0) { o.g = hb; col(o, C_CONC); }
      else if (u <= c0 + 0.03) { const t = (u - c0) / 0.03; o.g = hb + (-3 - hb) * t; col(o, C_CONCW); }
      else { o.g = -3 - Math.min(5, 50 * (u - c0 - 0.03)); col(o, C_BED); }
      return;
    }
    default: { o.g = -6 - 4 * Math.min(1, u / 3); col(o, C_BED); }
  }
}
/* ---------- 岸の線（なめらか）：水と陸のさかい（マスのへり）を、まっすぐな ひとつづき（run）ごとの 点にして むすび、つなげた線を ならす。
   短い run は まん中の点（階段は ななめの線に）。長い run は 角から（陸の角 0.5・水の角 2 マス）はなれた 2 点（角を まるく）。
   線は 4 回ならす（ちぢまない ならしかた。もとの点から 0.45 マスまで）。向き：水が左 ---------- */
const DX = [0, 1, 0, 0, -1, 0, 0, 0, 0], DY = [0, 0, 1, 0, 0, 0, 0, 0, -1];   // 1 東・2 南・4 西・8 北
const LEFT = [0, 8, 1, 0, 2, 0, 0, 0, 4];
function bankLines(Wn, cx, cy) {
  const N = NW, M = N + 1, isW = Wn.isW;
  const wat = (x, y) => isW[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)];
  const OUT = scr('BLo', Uint8Array, M * M).fill(0), VIS = scr('BLv', Uint8Array, M * M).fill(0);
  for (let y = 2; y <= N - 2; y++) for (let x = 2; x <= N - 2; x++) {
    const a = wat(x - 1, y - 1), b = wat(x, y - 1), c = wat(x - 1, y), d = wat(x, y);
    let o = 0; if (b && !d) o |= 1; if (d && !c) o |= 2; if (c && !a) o |= 4; if (a && !b) o |= 8;
    OUT[y * M + x] = o;
  }
  const step = d => DY[d] * M + DX[d], multi = o => (o & (o - 1)) !== 0;
  const turn = (din, dout) => dout === din ? 2 : dout === LEFT[din] ? 1 : 3;   // 1 水の角（左へ）・2 まっすぐ・3 陸の角（右へ）
  const x0w = Wn.x0, y0w = Wn.y0, seg = [];
  const P = (k, d, t) => [x0w + k % M + DX[d] * t, y0w + ((k / M) | 0) + DY[d] * t];
  const RUN = new Map();   // （はじめの角・向き）→ { pts: [点…], next: つぎの run のキー }
  const doRun = (k, d, tk) => {
    let q = k, L = 0;
    do { VIS[q] = 1; q += step(d); L++; } while (L < 300 && OUT[q] === d);
    const a = tk === 3 ? 0.5 : 2;
    if (!OUT[q]) { RUN.set(k * 16 + d, { pts: [P(k, d, Math.min(a, L / 2)), P(k, d, L)], next: -1 }); return; }   // 窓のそとへ
    const dn = multi(OUT[q]) ? LEFT[d] : OUT[q], tq = multi(OUT[q]) ? 1 : turn(d, dn), b = tq === 3 ? 0.5 : 2;
    RUN.set(k * 16 + d, { pts: a + b > L ? [P(k, d, L / 2)] : [P(k, d, a), P(k, d, L - b)], next: q * 16 + dn });
  };
  for (let y = 2; y <= N - 2; y++) for (let x = 2; x <= N - 2; x++) {
    const k = y * M + x, o = OUT[k]; if (!o) continue;
    if (multi(o)) { for (const d of [1, 2, 4, 8]) if (o & d) doRun(k, d, 1); continue; }   // ななめの点：水の角が 2 つ
    let din = 0; for (const d of [1, 2, 4, 8]) if (OUT[k - step(d)] & d) { din = d; break; }
    if (!din || din === o) continue;   // まっすぐの点は run の とちゅう
    doRun(k, o, turn(din, o));
  }
  // run を つないで 線に（はじめ：だれの つぎでもない run。輪は どこからでも）
  const isNext = new Set(); for (const r of RUN.values()) if (r.next >= 0 && RUN.has(r.next)) isNext.add(r.next);
  const used = new Set(), chains = [];
  const walk = (key, loop) => { const pts = []; let k = key; while (k >= 0 && RUN.has(k) && !used.has(k)) { used.add(k); for (const p of RUN.get(k).pts) pts.push(p); k = RUN.get(k).next; } chains.push({ pts, loop: loop && k === key }); };
  for (const key of RUN.keys()) if (!isNext.has(key)) walk(key, false);
  for (const key of RUN.keys()) if (!used.has(key)) walk(key, true);
  // ならす（λ 0.5・μ −0.52 を 4 回。はしの点は そのまま。もとの点から 0.45 マスまで）
  for (const ch of chains) {
    const p = ch.pts, n = p.length; if (n < 3) { for (let i = 0; i + 1 < n; i++) seg.push(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]); continue; }
    const X0 = p.map(q => q[0]), Y0 = p.map(q => q[1]), X1 = X0.slice(), Y1 = Y0.slice(), TX = new Float64Array(n), TY = new Float64Array(n);
    for (let it = 0; it < 6; it++) {
      const f = it & 1 ? -0.52 : 0.5;
      for (let i = 0; i < n; i++) {
        const a = ch.loop ? (i + n - 1) % n : i - 1, b = ch.loop ? (i + 1) % n : i + 1;
        if (a < 0 || b >= n) { TX[i] = X1[i]; TY[i] = Y1[i]; continue; }
        TX[i] = X1[i] + f * ((X1[a] + X1[b]) / 2 - X1[i]); TY[i] = Y1[i] + f * ((Y1[a] + Y1[b]) / 2 - Y1[i]);
      }
      for (let i = 0; i < n; i++) { let dx = TX[i] - X0[i], dy = TY[i] - Y0[i]; const l = Math.hypot(dx, dy); if (l > 0.36) { dx *= 0.36 / l; dy *= 0.36 / l; } X1[i] = X0[i] + dx; Y1[i] = Y0[i] + dy; }
    }
    for (let i = 0; i + 1 < n; i++) seg.push(X1[i], Y1[i], X1[i + 1], Y1[i + 1]);
    if (ch.loop) seg.push(X1[n - 1], Y1[n - 1], X1[0], Y1[0]);
  }
  for (let y = MG - 6; y <= MG + CS + 6; y++) for (let x = MG - 6; x <= MG + CS + 6; x++) {   // 角のない へり（長い まっすぐ）：もとの へり
    const k = y * M + x, o = OUT[k]; if (!o || VIS[k] || multi(o)) continue;
    const q = k + step(o); seg.push(x0w + x, y0w + y, x0w + q % M, y0w + ((q / M) | 0));
  }
  // マスごとの箱（まわり 2.5 マスの線）：チャンクと まわり 6 マス
  const B0x = cx * CS - 6, B0y = cy * CS - 6, BN = CS + 12, cnt = new Int32Array(BN * BN + 1), ns = seg.length / 4, R = 2.5, BB = new Int32Array(4);
  const box = s => { const ax = seg[4 * s], ay = seg[4 * s + 1], bx = seg[4 * s + 2], by = seg[4 * s + 3]; BB[0] = Math.max(0, Math.floor(Math.min(ax, bx) - R) - B0x); BB[1] = Math.min(BN - 1, Math.floor(Math.max(ax, bx) + R) - B0x); BB[2] = Math.max(0, Math.floor(Math.min(ay, by) - R) - B0y); BB[3] = Math.min(BN - 1, Math.floor(Math.max(ay, by) + R) - B0y); };
  for (let s = 0; s < ns; s++) { box(s); for (let j = BB[2]; j <= BB[3]; j++) for (let i = BB[0]; i <= BB[1]; i++) cnt[j * BN + i + 1]++; }
  for (let q = 1; q <= BN * BN; q++) cnt[q] += cnt[q - 1];
  const fillp = new Int32Array(BN * BN), list = new Int32Array(cnt[BN * BN]);
  for (let s = 0; s < ns; s++) { box(s); for (let j = BB[2]; j <= BB[3]; j++) for (let i = BB[0]; i <= BB[1]; i++) { const b = j * BN + i; list[cnt[b] + fillp[b]++] = s; } }
  return { seg: Float32Array.from(seg), cnt, list, B0x, B0y, BN };
}
// 岸の線からの 符号つき距離（マス。水の側が +。2.5 まで）
function bankDist(BL, isWat, x, y) {
  const i = Math.floor(x) - BL.B0x, j = Math.floor(y) - BL.B0y;
  if (i < 0 || j < 0 || i >= BL.BN || j >= BL.BN) return isWat ? 2.5 : -2.5;
  const b = j * BL.BN + i, S = BL.seg, L = BL.list; let best = 6.25, side = -1e9;
  for (let q = BL.cnt[b]; q < BL.cnt[b + 1]; q++) {
    const s = L[q] * 4, ax = S[s], ay = S[s + 1], dx = S[s + 2] - ax, dy = S[s + 3] - ay, l2 = dx * dx + dy * dy;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1), qx = ax + dx * t - x, qy = ay + dy * t - y, d2 = qx * qx + qy * qy;
    const sd = ((x - ax) * dy - (y - ay) * dx) / Math.sqrt(l2);   // 線の左（水）が +
    if (d2 < best - 1e-7) { best = d2; side = sd; } else if (d2 < best + 1e-7 && sd > side) side = sd;
  }
  if (best >= 6.25) return isWat ? 2.5 : -2.5;
  const d = Math.sqrt(best);
  return side > -1e-6 ? d : -d;
}

/* ---------- チャンクの網 ---------- */
// 形ごとの 水の色・白い波の強さ
const WK_C = [], WK_F = [];
for (let s = 0; s <= ST_RMTN; s++) { const k = s === ST_RMTN ? [WC_MTN, 0.55] : s >= ST_RURB ? [WC_RIV, 0.2] : s === ST_LAKE || s === ST_LAKEU ? [WC_LAKE, 0.25] : s === ST_BEACH ? [WC_SEA, 1] : s === ST_ROCK ? [WC_SEA, 0.8] : s === ST_WALL ? [WC_SEA, 0.55] : [WC_SEA, 0.35]; WK_C[s] = k[0]; WK_F[s] = k[1]; }
// ひとつの点の「水の側の形」の高さ（m）と色：まわりの 4 つのマスのまん中から（水のマスの形を まぜる。値はなめらかにつなぐ）
function makeField(Wn, cx, cy, BL, HWS, landAt, prot) {
  const { Wt, HB, STY, isW, x0, y0, BC } = Wn;
  const o2 = { g: 0, r: 0, gg: 0, b: 0 }, lc = [0, 0, 0], LA = { g: 0, r: 0, gg: 0, b: 0 };
  // landRule：陸のマスの点は 網の点の高さ（H と同じ）。なめらかな岸の線より水の側（角を切るところ）だけ 岸の形に（道・建物のところは 切らない）
  return (x, y, out, landRule) => {
    const w0 = (Math.floor(y) - y0) * NW + (Math.floor(x) - x0), wat = isW[w0] === 1;
    const u = bankDist(BL, wat, x, y);   // なめらかな岸の線からの距離（水の側 +）
    const fx = x - 0.5, fy = y - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), tu = fx - i0, tv = fy - j0;
    let W = 0, hb = 0, hw = 0, ws = 0, sw = 0, g = 0, r = 0, gg = 0, b = 0, wcr = 0, wcg = 0, wcb = 0, foam = 0;
    lc[0] = lc[1] = lc[2] = 0;
    const w00 = (j0 - y0) * NW + (i0 - x0);
    for (let q = 0; q < 4; q++) {
      const w = w00 + (q >> 1) * NW + (q & 1), f = (q & 1 ? tu : 1 - tu) * (q >> 1 ? tv : 1 - tv), wt = Wt[w];
      if (wt === wt) { W += wt * f; ws += f; }
      hb += HB[w] * f; hw += HWS[w] * f; lc[0] += BC[w * 3] * f; lc[1] += BC[w * 3 + 1] * f; lc[2] += BC[w * 3 + 2] * f;
    }
    W = ws > 0 ? W / ws : 0; hw = hw > 0.25 ? hw : 0.25; out.W = W;
    let land = false;
    if (!wat && landRule) {
      landAt(x, y, LA);
      if (u <= 0 || prot(x, y)) land = true; else { hb = LA.g; lc[0] = LA.r; lc[1] = LA.gg; lc[2] = LA.b; }
    }
    for (let q = 0; q < 4; q++) {
      const w = w00 + (q >> 1) * NW + (q & 1); if (!isW[w]) continue;
      const f = (q & 1 ? tu : 1 - tu) * (q >> 1 ? tv : 1 - tv) + 1e-6, s = STY[w];
      if (!land) { profile(s, wat ? u : u, hb, W, hw, x, y, lc, o2); g += o2.g * f; r += o2.r * f; gg += o2.gg * f; b += o2.b * f; }
      sw += f;
      const wk = WK_C[s]; wcr += wk[0] * f; wcg += wk[1] * f; wcb += wk[2] * f; foam += WK_F[s] * f;
    }
    if (sw > 0) { out.wr = wcr / sw; out.wg = wcg / sw; out.wb = wcb / sw; out.foam = foam / sw; } else { out.wr = WC_RIV[0]; out.wg = WC_RIV[1]; out.wb = WC_RIV[2]; out.foam = 0; }
    if (land || sw <= 0) { if (landRule && !wat) { out.g = LA.g; out.r = LA.r; out.gg = LA.gg; out.b = LA.b; } else { out.g = hb; out.r = lc[0]; out.gg = lc[1]; out.b = lc[2]; } return; }
    out.g = g / sw; out.r = r / sw; out.gg = gg / sw; out.b = b / sw;
    if (!wat && landRule && out.g > LA.g) { out.g = LA.g; out.r = LA.r; out.gg = LA.gg; out.b = LA.b; }
  };
}

// こまかい点の しまい場所（使いまわす）
const POOL = { cap: 0, D: null, vmap: null, span: 0, tv: null, wv: null, used: 0 };
function pool(span) {
  if (POOL.span !== span) { POOL.span = span; POOL.vmap = new Int32Array(span * span).fill(-1); }
  if (!POOL.cap) { POOL.cap = 8192; POOL.D = new Float32Array(POOL.cap * 9); POOL.tv = new Int32Array(POOL.cap); POOL.wv = new Int32Array(POOL.cap); }
  POOL.used = 0;
}
// 半マスの網（st 0.5）：陸は前と同じ（マスのまん中・さかい・かどの点。さかいは となりのマスの平均）。水のマスの岸のところは こまかく（1/K マス）
function buildFine(X, Wn, c, cx, cy, K, st, decks) {
  const T3 = X.T3, U = X.M3_U * X.M3_VEX, { EL, isW, x0, y0 } = Wn, PAL = X.PAL;
  const n = 129, LM = 2, nl = n + 2 * LM, NL = nl * nl, ox = cx * CS + 0.5, oy = cy * CS + 0.5;
  const tw = (rx, ry) => (ry + MG) * NW + (rx + MG);   // チャンクの左上からの マス → 窓の番号
  const hasW = Wn.nWater > 0;
  // 網の点の「さわるマス」：i が偶数＝マスのまん中、奇数＝さかい（ii：LM をたした番号）
  const TA = new Int32Array(nl * 2), TN = new Uint8Array(nl);
  for (let ii = 0; ii < nl; ii++) { const i = ii - LM; if (i & 1) { TA[ii * 2] = (i - 1) >> 1; TA[ii * 2 + 1] = (i + 1) >> 1; TN[ii] = 2; } else { TA[ii * 2] = i >> 1; TN[ii] = 1; } }
  // マスの色（地図と同じ）
  const TC = scr('TC', Float32Array, NW * NW * 3).fill(-1);
  const tcol = w => { if (TC[w * 3] < 0) { const t = Wn.T[w], z = String.fromCharCode(Wn.Z[w] || ZDASH), cc = PAL.tileColor(TCH[t], Wn.ER[w], z, 0); TC[w * 3] = cc[0] / 255; TC[w * 3 + 1] = cc[1] / 255; TC[w * 3 + 2] = cc[2] / 255; } return w * 3; };
  // なめらかな岸の線・川はばの半分 HWS（マスのまん中の 岸の線からの距離の いちばん大きいところ。まわり 2 マス）・となりの陸の色 BC
  let tph = performance.now();
  let BL = null, HWS = null;
  if (hasW) {
    BL = bankLines(Wn, cx, cy);
    const n2 = NW * NW, UC = scr('UC', Float32Array, n2).fill(0), BC = Wn.BC = scr('BC', Float32Array, n2 * 3);
    HWS = scr('HWS', Float32Array, n2).fill(0.5);
    for (let ry = -5; ry <= CS + 5; ry++) for (let rx = -5; rx <= CS + 5; rx++) {
      const w = tw(rx, ry);
      if (!isW[w]) { const t3 = tcol(w); BC[w * 3] = TC[t3]; BC[w * 3 + 1] = TC[t3 + 1]; BC[w * 3 + 2] = TC[t3 + 2]; continue; }
      UC[w] = Math.max(0, bankDist(BL, true, cx * CS + rx + 0.5, cy * CS + ry + 0.5));
      let r = 0, g = 0, b = 0, m = 0;
      for (let rad = 1; rad <= 2 && !m; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const w2 = w + dy * NW + dx; if (isW[w2]) continue; const t3 = tcol(w2); r += TC[t3]; g += TC[t3 + 1]; b += TC[t3 + 2]; m++; }
      if (m) { BC[w * 3] = r / m; BC[w * 3 + 1] = g / m; BC[w * 3 + 2] = b / m; } else { BC[w * 3] = C_GRASS2[0]; BC[w * 3 + 1] = C_GRASS2[1]; BC[w * 3 + 2] = C_GRASS2[2]; }
    }
    for (let ry = -3; ry <= CS + 3; ry++) for (let rx = -3; rx <= CS + 3; rx++) {
      const w = tw(rx, ry); let mx = 0, m = 0;
      if (isW[w]) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const w2 = w + dy * NW + dx; if (isW[w2] && UC[w2] > mx) mx = UC[w2]; } HWS[w] = Math.max(0.25, mx); }
    }
    for (let ry = -3; ry <= CS + 3; ry++) for (let rx = -3; rx <= CS + 3; rx++) {   // 陸のマス：となりの水のマスの値（補間のため）
      const w = tw(rx, ry); if (isW[w]) continue; let mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const w2 = w + dy * NW + dx; if (isW[w2] && HWS[w2] > mx) mx = HWS[w2]; }
      HWS[w] = mx || 0.5;
    }
  }
  // 網の点の 陸の高さ・色（m3Surf と同じ三角で）。陸の角を切るときの もと
  let LDr = null;
  const landAt = (x, y, o) => {
    const fu0 = (x - ox) * 2 + LM, fv0 = (y - oy) * 2 + LM, i = clamp(Math.floor(fu0), 0, nl - 2), j = clamp(Math.floor(fv0), 0, nl - 2), fu = fu0 - i, fv = fv0 - j, a = (j * nl + i) * 9, b = a + 9, d = a + nl * 9, e = d + 9;
    if (fu + fv <= 1) { o.g = LDr[a] + (LDr[b] - LDr[a]) * fu + (LDr[d] - LDr[a]) * fv; o.r = LDr[a + 1] + (LDr[b + 1] - LDr[a + 1]) * fu + (LDr[d + 1] - LDr[a + 1]) * fv; o.gg = LDr[a + 2] + (LDr[b + 2] - LDr[a + 2]) * fu + (LDr[d + 2] - LDr[a + 2]) * fv; o.b = LDr[a + 3] + (LDr[b + 3] - LDr[a + 3]) * fu + (LDr[d + 3] - LDr[a + 3]) * fv; }
    else { const p = 1 - fu, q2 = 1 - fv; o.g = LDr[e] + (LDr[d] - LDr[e]) * p + (LDr[b] - LDr[e]) * q2; o.r = LDr[e + 1] + (LDr[d + 1] - LDr[e + 1]) * p + (LDr[b + 1] - LDr[e + 1]) * q2; o.gg = LDr[e + 2] + (LDr[d + 2] - LDr[e + 2]) * p + (LDr[b + 2] - LDr[e + 2]) * q2; o.b = LDr[e + 3] + (LDr[d + 3] - LDr[e + 3]) * p + (LDr[b + 3] - LDr[e + 3]) * q2; }
  };
  tph = TPH('lines', tph);
  const PM = hasW ? protMask(X, Wn, cx, cy) : null;
  tph = TPH('prot', tph);
  const field = hasW ? makeField(Wn, cx, cy, BL, HWS, landAt, PM ? PM.at : () => false) : null;
  const FO = { g: 0, r: 0, gg: 0, b: 0, W: 0, wr: 0, wg: 0, wb: 0, foam: 0 };
  // 網の点（ii, jj）：LD（g, r, gg, b, W, wr, wg, wb, foam）・見える高さ HLm（m）・LWT：1 陸だけ・2 陸と水・3 水だけ
  const LD = scr('LD', Float32Array, NL * 9), HLm = scr('HLm', Float32Array, NL), LWT = scr('LWT', Uint8Array, NL);
  LDr = LD;
  for (let jj = 0; jj < nl; jj++) for (let ii = 0; ii < nl; ii++) {
    const k = jj * nl + ii, o = k * 9;
    let hl = 0, nlnd = 0, r = 0, g = 0, b = 0, nwt = 0;
    for (let p = 0; p < TN[jj]; p++) for (let q = 0; q < TN[ii]; q++) { const w = tw(TA[ii * 2 + q], TA[jj * 2 + p]); if (isW[w]) { nwt++; continue; } hl += EL[w]; const t3 = tcol(w); r += TC[t3]; g += TC[t3 + 1]; b += TC[t3 + 2]; nlnd++; }
    if (nwt || (hasW && Wn.dW[tw(TA[ii * 2], TA[jj * 2])] <= 2)) { field(ox + (ii - LM) / 2, oy + (jj - LM) / 2, FO, false); LD[o + 4] = FO.W; LD[o + 5] = FO.wr; LD[o + 6] = FO.wg; LD[o + 7] = FO.wb; LD[o + 8] = FO.foam; }
    else { LD[o + 4] = LD[o + 5] = LD[o + 6] = LD[o + 7] = LD[o + 8] = 0; }
    if (nlnd) { LD[o] = HLm[k] = hl / nlnd; LD[o + 1] = r / nlnd; LD[o + 2] = g / nlnd; LD[o + 3] = b / nlnd; LWT[k] = nwt ? 2 : 1; }
    else { LD[o] = FO.g; LD[o + 1] = FO.r; LD[o + 2] = FO.gg; LD[o + 3] = FO.b; HLm[k] = FO.g > FO.W ? FO.g : FO.W; LWT[k] = 3; }
  }
  tph = TPH('lattice', tph);
  // こまかくするセル（半マスの四角）：水のマスで、岸から近いところ
  const nc = 128 + 2 * LM, cellF = scr('cellF', Uint8Array, nc * nc).fill(0);   // セル (i, j)：i = −LM〜127+LM
  if (hasW) for (let jj = 0; jj < nc; jj++) for (let ii = 0; ii < nc; ii++) {
    const i = ii - LM, j = jj - LM, w = tw((i + 1) >> 1, (j + 1) >> 1);
    let cand = 0;
    if (!isW[w]) { if (Wn.dW[w] <= 1.5) cand = 2; }   // 陸のマス（水のとなり）：角を 岸の形に切るため
    else { const s = Wn.STY[w], reach = s === ST_RBIG ? Math.min(4, Wn.HW[w] * 0.62 + 1.2) : s === ST_OPEN ? 0 : 2.2; if (Wn.dL[w] <= reach) cand = 1; }
    if (!cand) continue;
    // 岸の形のあるところだけ（なめらかな岸の線からの距離 u のはんいが 形の帯に かかるセル）
    const xa = ox + i / 2, ya = oy + j / 2, wt = isW[w] === 1; let umin = 1e9, umax = -1e9;
    for (let q = 0; q < 5; q++) { const u = bankDist(BL, wt, xa + (q === 4 ? 0.25 : (q & 1) * 0.5), ya + (q === 4 ? 0.25 : (q >> 1) * 0.5)); if (u < umin) umin = u; if (u > umax) umax = u; }
    if (umax < -0.06) continue;
    if (wt && Wn.STY[w] === ST_RBIG) { const hw = HWS[w], uc = Math.max(0.31, hw - Math.max(0.42, hw * 0.46)); if ((umin > 0.33 && umax < uc - 0.25) || umin > uc + 0.5) continue; }
    else if (umin > 0.64) continue;
    cellF[jj * nc + ii] = cand;
  }
  const isFine = (i, j) => { const ii = i + LM, jj = j + LM; return ii >= 0 && jj >= 0 && ii < nc && jj < nc && cellF[jj * nc + ii] > 0; };
  // こまかい点：a, b（1/K マスの目。チャンクの左上から）。網の点 i ↔ a = h2 + i*h2
  const h2 = K >> 1, A0 = -h2 * 2, span = CS * K + K + 1 - A0 + 1;
  pool(span);
  const vmap = POOL.vmap, touched = [];
  const isLat = (a, b) => (a - h2) % h2 === 0 && (b - h2) % h2 === 0, latK = (a, b) => ((b - h2) / h2 + LM) * nl + ((a - h2) / h2 + LM);
  // 網の点でない こまかい点の値（POOL の番号）。セルのふち（となりが あらいセル）は 網の点から直線で
  const val = (a, b) => {
    const key = (b - A0) * span + (a - A0); let v = vmap[key]; if (v >= 0) return v;
    v = POOL.used++;
    if (v >= POOL.cap) { const D2 = new Float32Array(POOL.cap * 2 * 9); D2.set(POOL.D); POOL.D = D2; const t2 = new Int32Array(POOL.cap * 2); t2.set(POOL.tv); POOL.tv = t2; const w2 = new Int32Array(POOL.cap * 2); w2.set(POOL.wv); POOL.wv = w2; POOL.cap *= 2; }
    vmap[key] = v; touched.push(key);
    const D = POOL.D, o = v * 9, ra = a - h2, rb = b - h2, onI = ra % h2 === 0, onJ = rb % h2 === 0, i = Math.floor(ra / h2), j = Math.floor(rb / h2);
    const lin = (k0, k1, f) => { for (let q = 0; q < 9; q++) D[o + q] = LD[k0 * 9 + q] + (LD[k1 * 9 + q] - LD[k0 * 9 + q]) * f; if (LWT[k0] === 1 || LWT[k1] === 1) { const kk = LWT[k0] === 1 ? k1 : k0; for (let q = 4; q < 9; q++) D[o + q] = LD[kk * 9 + q]; } };
    if (onI && !(isFine(i - 1, j) && isFine(i, j))) { const k0 = (j + LM) * nl + (i + LM); lin(k0, k0 + nl, (rb - j * h2) / h2); }   // たての ふち（となりが あらい）
    else if (onJ && !(isFine(i, j - 1) && isFine(i, j))) { const k0 = (j + LM) * nl + (i + LM); lin(k0, k0 + 1, (ra - i * h2) / h2); }   // よこの ふち
    else { field(cx * CS + a / K, cy * CS + b / K, FO, true); D[o] = FO.g; D[o + 1] = FO.r; D[o + 2] = FO.gg; D[o + 3] = FO.b; D[o + 4] = FO.W; D[o + 5] = FO.wr; D[o + 6] = FO.wg; D[o + 7] = FO.wb; D[o + 8] = FO.foam; }
    POOL.tv[v] = -1; POOL.wv[v] = -1;
    return v;
  };
  // 地形の点：はじめに網の点（0〜128）を ならべる
  const P = new FA(n * n * 3 + 30000), C = new FA(n * n * 3 + 30000), I = new IA(128 * 128 * 6 + 60000);
  const VGL = scr('VGL', Float32Array, NL * 4).fill(NaN);
  const visLat = (i, j) => {   // 網の点の 見える地面（g, r, gg, b）の番号。まわり 4 つのセルが こまかい 陸にさわる点は 角を切ったあと
    const k = (j + LM) * nl + i + LM, o = k * 4;
    if (VGL[o] !== VGL[o]) {
      if (hasW && LWT[k] !== 3 && isFine(i - 1, j - 1) && isFine(i, j - 1) && isFine(i - 1, j) && isFine(i, j)) { field(ox + i / 2, oy + j / 2, FO, true); VGL[o] = FO.g; VGL[o + 1] = FO.r; VGL[o + 2] = FO.gg; VGL[o + 3] = FO.b; }
      else { VGL[o] = LD[k * 9]; VGL[o + 1] = LD[k * 9 + 1]; VGL[o + 2] = LD[k * 9 + 2]; VGL[o + 3] = LD[k * 9 + 3]; }
    }
    return o;
  };
  {   // 網の点（まとめて。多いので 速く）
    const Pa = P.a, Ca = C.a; let o3 = 0;
    for (let j = 0; j < n; j++) {
      const r0 = (j - 1 + LM) * nc + LM - 1, r1 = r0 + nc;
      for (let i = 0; i < n; i++, o3 += 3) {
        const k = (j + LM) * nl + i + LM;
        let src = LD, so = k * 9;
        if (hasW && LWT[k] !== 3 && cellF[r0 + i] && cellF[r0 + i + 1] && cellF[r1 + i] && cellF[r1 + i + 1]) { const vo = visLat(i, j); src = VGL; so = vo; }
        Pa[o3] = ox + i * 0.5; Pa[o3 + 1] = src[so] * U; Pa[o3 + 2] = oy + j * 0.5; Ca[o3] = src[so + 1]; Ca[o3 + 1] = src[so + 2]; Ca[o3 + 2] = src[so + 3];
      }
    }
    P.n = C.n = n * n * 3;
  }
  const vert = (a, b) => {
    if (isLat(a, b)) return (b - h2) / h2 * n + (a - h2) / h2;
    const v = val(a, b); let t = POOL.tv[v]; if (t >= 0) return t;
    t = POOL.tv[v] = P.n / 3; const D = POOL.D, o = v * 9;
    P.push3(cx * CS + a / K, D[o] * U, cy * CS + b / K); C.push3(D[o + 1], D[o + 2], D[o + 3]);
    return t;
  };
  // 地形の三角：セル i, j = 0〜127
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    if (!cellF[(j + LM) * nc + i + LM]) { const A = j * n + i, t = I.a, m = I.n; if (m + 6 > t.length) { I.tri(A, A + n, A + 1); I.tri(A + 1, A + n, A + n + 1); continue; } t[m] = A; t[m + 1] = A + n; t[m + 2] = A + 1; t[m + 3] = A + 1; t[m + 4] = A + n; t[m + 5] = A + n + 1; I.n = m + 6; continue; }
    const a0 = h2 + i * h2, b0 = h2 + j * h2;
    for (let q = 0; q < h2; q++) for (let p = 0; p < h2; p++) { const A = vert(a0 + p, b0 + q), B = vert(a0 + p + 1, b0 + q), D = vert(a0 + p, b0 + q + 1), E2 = vert(a0 + p + 1, b0 + q + 1), Pa = P.a; I.quad2(A, B, D, E2, Pa[A * 3 + 1], Pa[B * 3 + 1], Pa[D * 3 + 1], Pa[E2 * 3 + 1]); }   // 高さの近い対角で わける（ななめの岸が ぎざぎざに ならないように）
  }
  // へりの すそ（となりのチャンクと こまかさがちがっても すきまを かくす）
  const nv0 = P.n / 3;
  for (let side = 0; side < 4; side++) {
    const fix = side & 1 ? h2 + 128 * h2 : h2, isX = side < 2, list = [];
    for (let t = h2; t <= h2 + 128 * h2; t++) {
      const a = isX ? fix : t, b = isX ? t : fix;
      if (isLat(a, b)) { list.push((b - h2) / h2 * n + (a - h2) / h2); continue; }
      const v = vmap[(b - A0) * span + (a - A0)]; if (v >= 0 && POOL.tv[v] >= 0) list.push(POOL.tv[v]);
    }
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k], b = list[k + 1], va = P.n / 3, Pa = P.a, Ca = C.a;
      const ax2 = Pa[a * 3], ay2 = Pa[a * 3 + 1], az2 = Pa[a * 3 + 2], bx2 = Pa[b * 3], by2 = Pa[b * 3 + 1], bz2 = Pa[b * 3 + 2];
      const c0 = Ca[a * 3], c1 = Ca[a * 3 + 1], c2 = Ca[a * 3 + 2], d0 = Ca[b * 3], d1 = Ca[b * 3 + 1], d2 = Ca[b * 3 + 2];
      P.push3(ax2, ay2 - 0.03, az2); P.push3(bx2, by2 - 0.03, bz2); C.push3(c0, c1, c2); C.push3(d0, d1, d2);
      I.tri(a, va, b); I.tri(b, va, va + 1); I.tri(a, b, va); I.tri(b, va + 1, va);
    }
  }
  const nv = P.n / 3, g = geo(T3, P, C, I, nv);
  const Nn = normals(g.attributes.position.array, g.index.array, nv); for (let v = nv0; v < nv; v++) { Nn[v * 3] = 0; Nn[v * 3 + 1] = 1; Nn[v * 3 + 2] = 0; }   // すそは 上向きの光
  g.setAttribute('normal', new T3.BufferAttribute(Nn, 3));
  const mesh = new T3.Mesh(g, MAT.t);
  // H：網の点の見える高さ。st 0.5：半マスの点（0〜128）。st 1：マスのまん中（偶数の点）。st 1 の岸のマス（となりに陸）は 岸の高さ（陸の建物・道が 岸までの坂に しずまないように）
  const sh = st < 1 ? 1 : 2, nh = st < 1 ? n : 65, HH = new Float32Array(nh * nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nh; i++) {
    const k = (j * sh + LM) * nl + (i * sh + LM); let h = HLm[k];
    if (sh === 2 && LWT[k] === 3) { const w = tw(i, j); if (Wn.dL[w] < 1.5) h = Math.max(h, Wn.HB[w]); }
    HH[j * nh + i] = h * U;
  }
  mesh.userData.H = HH;
  if (decks && decks.length) deckApply(X, Wn, cx, cy, st, HH, nh, decks, mesh, (x, y) => { const ii = Math.round((x - ox) * 2) + LM, jj = Math.round((y - oy) * 2) + LM; return ii >= 0 && jj >= 0 && ii < nl && jj < nl ? LWT[jj * nl + ii] : 1; });
  tph = TPH('terrain', tph);
  // 水面：このチャンクのマスのところ（セル −1〜126）。岸の上（4 点とも水より高い）は なし。沖は となりと つなげて大きな四角に
  if (hasW) {
    const WP = new FA(8192), WC = new FA(8192), WA = new FA(8192), WI = new IA(8192), latW = scr('latW', Int32Array, NL).fill(-1), D = POOL.D;
    const wv = (a, b) => {
      if (isLat(a, b)) { const k = latK(a, b); let t = latW[k]; if (t >= 0) return t; t = latW[k] = WP.n / 3; const o = k * 9, vo = visLat((a - h2) / h2, (b - h2) / h2); WP.push3(cx * CS + a / K, LD[o + 4] * U, cy * CS + b / K); WC.push3(LD[o + 5], LD[o + 6], LD[o + 7]); WA.push2(LD[o + 4] - VGL[vo], LD[o + 8]); return t; }
      const v = val(a, b); let t = POOL.wv[v]; if (t >= 0) return t;
      t = POOL.wv[v] = WP.n / 3; const o = v * 9, Dd = POOL.D;
      WP.push3(cx * CS + a / K, Dd[o + 4] * U, cy * CS + b / K); WC.push3(Dd[o + 5], Dd[o + 6], Dd[o + 7]); WA.push2(Dd[o + 4] - Dd[o], Dd[o + 8]);
      return t;
    };
    const above = (a, b) => { if (isLat(a, b)) { const k = latK(a, b), vo = visLat((a - h2) / h2, (b - h2) / h2); return VGL[vo] > LD[k * 9 + 4] + 0.05; } const o = val(a, b) * 9; return POOL.D[o] > POOL.D[o + 4] + 0.05; };
    const deepCell = (i, j) => {   // 沖のセル：4 点とも 水だけ・4m より深い・同じ水面
      if (isFine(i, j)) return false;
      const W0 = LD[((j + LM) * nl + (i + LM)) * 9 + 4];
      for (let d = 0; d < 4; d++) { const k = (j + (d >> 1) + LM) * nl + (i + (d & 1) + LM); if (LWT[k] !== 3 || LD[k * 9 + 4] - LD[k * 9] < 4 || LD[k * 9 + 4] !== W0) return false; }
      return true;
    };
    for (let j = -1; j <= 126; j++) {
      let run = -9;   // 沖のセルの つづき（-9 は なし。セルは -1 から）
      for (let i = -1; i <= 127; i++) {
        const inW = i <= 126 && (isW[tw((i + 1) >> 1, (j + 1) >> 1)] || isFine(i, j)), deep = inW && deepCell(i, j);
        if (run > -9 && !deep) {   // 沖のつづきを 1 つの四角に
          const a0 = h2 + run * h2, a1 = h2 + i * h2, b0 = h2 + j * h2;
          WI.quad(wv(a0, b0), wv(a1, b0), wv(a0, b0 + h2), wv(a1, b0 + h2)); run = -9;
        }
        if (!inW) continue;
        if (deep) { if (run === -9) run = i; continue; }
        const a0 = h2 + i * h2, b0 = h2 + j * h2;
        if (!isFine(i, j)) { WI.quad(wv(a0, b0), wv(a0 + h2, b0), wv(a0, b0 + h2), wv(a0 + h2, b0 + h2)); continue; }
        for (let q = 0; q < h2; q++) for (let p = 0; p < h2; p++) {
          if (above(a0 + p, b0 + q) && above(a0 + p + 1, b0 + q) && above(a0 + p, b0 + q + 1) && above(a0 + p + 1, b0 + q + 1)) continue;
          const A = wv(a0 + p, b0 + q), B = wv(a0 + p + 1, b0 + q), Dd = wv(a0 + p, b0 + q + 1), E2 = wv(a0 + p + 1, b0 + q + 1), Wa = WA.a; WI.quad2(A, B, Dd, E2, Wa[A * 2], Wa[B * 2], Wa[Dd * 2], Wa[E2 * 2]);
        }
      }
    }
    if (WI.n) {
      const nw = WP.n / 3, wg = geo(T3, WP, WC, WI, nw, { aW: [WA, 2] });
      const NN = new Float32Array(nw * 3); for (let v = 0; v < nw; v++) NN[v * 3 + 1] = 1; wg.setAttribute('normal', new T3.BufferAttribute(NN, 3));
      mesh.add(new T3.Mesh(wg, MAT.w));
    }
  }
  tph = TPH('water', tph);
  if (hasW && st < 1) { const FK = { g: 0, r: 0, gg: 0, b: 0, W: 0, wr: 0, wg: 0, wb: 0, foam: 0 }; coastKit(X, Wn, BL, cx, cy, K, (x, y) => { field(x, y, FK, true); return FK.g; }, mesh); TPH('kit', tph); }
  for (let q = 0; q < touched.length; q++) vmap[touched[q]] = -1;
  return mesh;
}

// ふつうの網（st 1・2・4・8）：マスのまん中の点。川は st 1 で 谷に（水面は マスごと）、st 2 より あらいときは 地面の少し上に水の色の面
function buildCoarse(X, Wn, c, cx, cy, st, decks) {
  const T3 = X.T3, U = X.M3_U * X.M3_VEX, PAL = X.PAL, { T, E, EL, isW, x0, y0 } = Wn, full = !!Wn.dL;
  const n = Math.round(CS / st) + 1, nn = n * n, ns = 4 * (n - 1) * 2, P = new Float32Array((nn + ns) * 3), Cc = new Float32Array((nn + ns) * 3), HH = new Float32Array(nn), GG = scr('GG', Float32Array, nn);
  const tw = (rx, ry) => (ry + MG) * NW + (rx + MG);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const rx = Math.min(i * st, CS), ry = Math.min(j * st, CS), w = tw(rx, ry), t = T[w], o = j * n + i;
    let g, h, cr, cg, cb;
    if (!isW[w]) { g = h = EL[w]; const cc = PAL.tileColor(TCH[t], Wn.ER[w], String.fromCharCode(Wn.Z[w] || ZDASH), 0); cr = cc[0] / 255; cg = cc[1] / 255; cb = cc[2] / 255; }
    else {
      const Wl = Wn.Wt[w];
      if (t === TR) {
        g = h = EL[w];   // 川（あらい網）：陸の高さ（上に 水の面を なめらかな形で）
        cr = C_BED[0]; cg = C_BED[1]; cb = C_BED[2];
      } else if (t === TL) { g = Wl - (full ? Math.min(8, 1 + 2 * (Wn.dL[w] - 1)) : 3); h = Wl; cr = C_BED[0]; cg = C_BED[1]; cb = C_BED[2]; }
      else { g = Math.max(Wn.ER[w], full ? -(0.9 + 3 * (Wn.dL[w] - 1)) : -2.5); h = 0; cr = C_SEABED[0]; cg = C_SEABED[1]; cb = C_SEABED[2]; }
    }
    P[o * 3] = cx * CS + 0.5 + rx; P[o * 3 + 1] = g * U; P[o * 3 + 2] = cy * CS + 0.5 + ry;
    Cc[o * 3] = cr; Cc[o * 3 + 1] = cg; Cc[o * 3 + 2] = cb; HH[o] = (g > h ? g : h) * U; GG[o] = g;
  }
  const I = new IA((n - 1) * (n - 1) * 6 + ns * 6);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; I.quad(a, a + 1, a + n, a + n + 1); }
  // へりの すそ（となりのチャンクと こまかさがちがっても すきまを かくす）
  let nv = nn; const dd = 0.03 + 0.02 * st;
  for (let side = 0; side < 4; side++) for (let k = 0; k < n - 1; k++) {
    const a = side === 0 ? k : side === 1 ? (n - 1) * n + k : side === 2 ? k * n : k * n + n - 1, b = side < 2 ? a + 1 : a + n, va = nv;
    for (const v of [a, b]) { P[nv * 3] = P[v * 3]; P[nv * 3 + 1] = P[v * 3 + 1] - dd; P[nv * 3 + 2] = P[v * 3 + 2]; Cc[nv * 3] = Cc[v * 3]; Cc[nv * 3 + 1] = Cc[v * 3 + 1]; Cc[nv * 3 + 2] = Cc[v * 3 + 2]; nv++; }
    I.tri(a, va, b); I.tri(b, va, va + 1); I.tri(a, b, va); I.tri(b, va + 1, va);
  }
  const g = geo(T3, P, Cc, I, nv), Nn = normals(P, g.index.array, nv);
  for (let v = nn; v < nv; v++) { Nn[v * 3] = 0; Nn[v * 3 + 1] = 1; Nn[v * 3 + 2] = 0; }
  g.setAttribute('normal', new T3.BufferAttribute(Nn, 3));
  const mesh = new T3.Mesh(g, MAT.t); mesh.userData.H = HH;
  if (decks && decks.length) deckApply(X, Wn, cx, cy, st, HH, n, decks, mesh, (x, y) => isW[tw(clamp(Math.floor(x) - cx * CS, -MG, CS + MG - 1), clamp(Math.floor(y) - cy * CS, -MG, CS + MG - 1))] ? 3 : 1);
  // 水面：このチャンクのマスごと（かどの高さは となりの水のマスの平均）。沖・湖のまん中は となりと つなげて大きな四角に
  if (Wn.nWater) {
    const WP = new FA(4096), WC = new FA(4096), WA = new FA(2048), WI = new IA(4096), Wt = Wn.Wt, STY = Wn.STY;
    const surfG = (x, y) => {   // このメッシュの地面の高さ（m。m3Surf と同じ三角で）
      const u = (x - 0.5 - cx * CS) / st, v = (y - 0.5 - cy * CS) / st, i = clamp(Math.floor(u), 0, n - 2), j = clamp(Math.floor(v), 0, n - 2), fu = u - i, fv = v - j;
      const a = GG[j * n + i], b = GG[j * n + i + 1], d = GG[(j + 1) * n + i], e = GG[(j + 1) * n + i + 1];
      return fu + fv <= 1 ? a + (b - a) * fu + (d - a) * fv : e + (d - e) * (1 - fu) + (b - e) * (1 - fv);
    };
    const CW = [0, 0, 0, 0, 0];
    const cornerW = (x, y) => { let s = 0, m = 0, f = 0, cr = 0, cg = 0, cb = 0; for (let q = 0; q < 4; q++) { const w = (y - 1 + (q >> 1) - y0) * NW + (x - 1 + (q & 1) - x0); if (!isW[w]) continue; s += Wt[w]; m++; const sy = STY[w], wk = WK_C[sy]; cr += wk[0]; cg += wk[1]; cb += wk[2]; f += WK_F[sy]; } CW[0] = s / m; CW[1] = cr / m; CW[2] = cg / m; CW[3] = cb / m; CW[4] = f / m; };
    // 平らなマス（海・湖で、まわり 8 つも水・同じ水面）
    const flat = w => { const t = T[w]; if (t === TR || !isW[w]) return false; const W0 = Wt[w]; for (let q = 0; q < 9; q++) { const v = w + ((q / 3) | 0) * NW - NW + (q % 3) - 1; if (!isW[v] || Wt[v] !== W0) return false; } return true; };
    const corner = (x, y, w) => {
      cornerW(x, y); const wl = CW[0], gx = surfG(x, y), y2 = st >= 2 && T[w] === TR ? Math.max(wl, gx + 0.6) : wl;
      const v = WP.n / 3; WP.push3(x, y2 * U, y); WC.push3(CW[1], CW[2], CW[3]); WA.push2(Math.max(st >= 2 ? 2 : 0.3, wl - gx), CW[4] * 0.3); return v;
    };
    for (let ry = 0; ry < CS; ry++) {
      let run = -1;
      for (let rx = 0; rx <= CS; rx++) {
        const w = tw(rx, ry), fl = rx < CS && flat(w);
        if (run >= 0 && (!fl || Wt[w] !== Wt[tw(run, ry)])) {   // 平らなマスのつづきを 1 つの四角に
          const X0 = cx * CS + run, X1 = cx * CS + rx, Y0 = cy * CS + ry, wr = tw(run, ry), wl = Wt[wr], wk = WK_C[STY[wr]], v = WP.n / 3;
          for (let q = 0; q < 4; q++) { WP.push3(q & 1 ? X1 : X0, wl * U, Y0 + (q >> 1)); WC.push3(wk[0], wk[1], wk[2]); WA.push2(8, 0); }
          WI.quad(v, v + 1, v + 2, v + 3); run = -1;
        }
        if (rx >= CS || !isW[w] || T[w] === TR) continue;   // 川は あとで（なめらかな形）
        if (fl) { if (run < 0) run = rx; continue; }
        const X0 = cx * CS + rx, Y0 = cy * CS + ry;
        WI.quad(corner(X0, Y0, w), corner(X0 + 1, Y0, w), corner(X0, Y0 + 1, w), corner(X0 + 1, Y0 + 1, w));
      }
    }
    // 川：マスのまん中の目で ぼかした「川らしさ」が 0.35 より大きいところ（marching squares。階段にならない）を、地面の少し上に
    let anyR = false; for (let ry = -2; ry <= CS + 2 && !anyR; ry++) for (let rx = -2; rx <= CS + 2; rx++) if (T[tw(rx, ry)] === TR) { anyR = true; break; }
    if (anyR) {
      const G2 = 68, V = scr('RV', Float32Array, G2 * G2), rv = (rx, ry) => T[tw(rx, ry)] === TR ? 1 : 0;
      for (let j = 0; j < G2; j++) for (let i = 0; i < G2; i++) { const rx = i - 2, ry = j - 2; let a = 0; for (let b = -1; b <= 1; b++) for (let q = -1; q <= 1; q++) a += rv(rx + q, ry + b) * (b ? 1 : 2) * (q ? 1 : 2); V[j * G2 + i] = a / 16; }
      const TH = 0.35, wk = WK_C[ST_RRUR], pt = [], put = (x, y) => { const g = surfG(x, y), v = WP.n / 3; WP.push3(x, (g + 0.6) * U, y); WC.push3(wk[0], wk[1], wk[2]); WA.push2(1.6, 0); return v; };
      for (let ry = 0; ry < CS; ry++) for (let rx = 0; rx < CS; rx++) {
        const i = rx + 2, j = ry + 2, c4 = [V[j * G2 + i], V[j * G2 + i + 1], V[(j + 1) * G2 + i + 1], V[(j + 1) * G2 + i]];
        if (c4[0] < TH && c4[1] < TH && c4[2] < TH && c4[3] < TH) continue;
        const X0 = cx * CS + rx + 0.5, Y0 = cy * CS + ry + 0.5, cxy = [[0, 0], [1, 0], [1, 1], [0, 1]]; pt.length = 0;
        for (let q = 0; q < 4; q++) {
          const a = c4[q], b = c4[(q + 1) & 3], pa = cxy[q], pb = cxy[(q + 1) & 3];
          if (a >= TH) pt.push(put(X0 + pa[0], Y0 + pa[1]));
          if ((a >= TH) !== (b >= TH)) { const f = (TH - a) / (b - a); pt.push(put(X0 + pa[0] + (pb[0] - pa[0]) * f, Y0 + pa[1] + (pb[1] - pa[1]) * f)); }
        }
        for (let q = 1; q + 1 < pt.length; q++) WI.tri(pt[0], pt[q + 1], pt[q]);
      }
    }
    if (WI.n) {
      const nw = WP.n / 3, wg = geo(T3, WP, WC, WI, nw, { aW: [WA, 2] });
      const NN = new Float32Array(nw * 3); for (let v = 0; v < nw; v++) NN[v * 3 + 1] = 1; wg.setAttribute('normal', new T3.BufferAttribute(NN, 3));
      mesh.add(new T3.Mesh(wg, MAT.wd));
    }
  }
  return mesh;
}

/* ---------- 海の護岸の部品（こまかい網のときだけ）：まちの海の護岸（天端・パラペット）・港の岸壁（エプロン・直立の壁）・消波ブロック ----------
   なめらかな岸の線（水が左）にそって。線のまん中が このチャンクのマスにある線だけ（となりと かさならない） */
let TETRA = null;
function tetraGeo() {   // 消波ブロック（4 本足）：足の向きは 正四面体の 4 つの頂点。足は 3 角の柱（先が細い）
  if (TETRA) return TETRA;
  const P = [], dirs = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  for (const d0 of dirs) {
    const l = Math.hypot(d0[0], d0[1], d0[2]), d = d0.map(v => v / l), a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]; const lu = Math.hypot(u[0], u[1], u[2]); u = u.map(v => v / lu);
    const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const ring = (r, s) => [0, 1, 2].map(q => { const t = q / 3 * Math.PI * 2, c = Math.cos(t) * r, sn = Math.sin(t) * r; return [d[0] * s + u[0] * c + w[0] * sn, d[1] * s + u[1] * c + w[1] * sn, d[2] * s + u[2] * c + w[2] * sn]; });
    const B = ring(0.56, 0), T = ring(0.36, 1), tri = (p, q, r) => P.push(...p, ...q, ...r);
    for (let q = 0; q < 3; q++) { const q2 = (q + 1) % 3; tri(B[q], B[q2], T[q2]); tri(B[q], T[q2], T[q]); }
    tri(T[0], T[1], T[2]);
  }
  const Pa = new Float32Array(P), nv = Pa.length / 3, Ia = new Uint32Array(nv); for (let i = 0; i < nv; i++) Ia[i] = i;
  TETRA = { P: Pa, N: normals(Pa, Ia, nv) };
  return TETRA;
}
function coastKit(X, Wn, BL, cx, cy, K, gAt, mesh) {
  const T3 = X.T3, U = X.M3_U * X.M3_VEX, { isW, STY, Wt, x0, y0 } = Wn, S = BL.seg, ns = S.length / 4;
  const P = new FA(3072), C = new FA(3072), I = new IA(3072);
  const blk = K >= 8 && (Number(X.MQ && X.MQ.d3) || 0) >= 1 ? [] : null;
  const cw = 1.25 / K + 0.01;   // 天端・エプロンのはば（こまかい網の 1 目より 少し広く：のり面の上の くぼみを かくす）
  const wat = (x, y) => { const w = (Math.floor(y) - y0) * NW + (Math.floor(x) - x0); return isW[w] ? w : -1; };
  // 四角（a→b の線を 2 本：下の線 p0,p1・上の線 p2,p3）。色は 下・上
  const quad = (p, cl, cu) => { const v = P.n / 3; for (let q = 0; q < 4; q++) { P.push3(p[q * 3], p[q * 3 + 1], p[q * 3 + 2]); const c = q < 2 ? cl : cu; C.push3(c[0], c[1], c[2]); } I.tri(v, v + 1, v + 3); I.tri(v, v + 3, v + 2); };
  const C_TOP = [0.75, 0.74, 0.70], C_PAR = [0.69, 0.68, 0.64];
  // つなぎめ：線の はしの点ごとに 向きの平均（となりの線と すきま・段が できないように。窓の中の線 ぜんぶから：となりのチャンクと 同じ値）
  const JN = new Map(), jk = (x, y) => Math.round(x * 512) * 1e7 + Math.round(y * 512);
  for (let s = 0; s < ns; s++) {
    const ax = S[4 * s], ay = S[4 * s + 1], dx = S[4 * s + 2] - ax, dy = S[4 * s + 3] - ay, L = Math.hypot(dx, dy); if (L < 1e-4) continue;
    for (let e = 0; e < 2; e++) { const k = jk(S[4 * s + 2 * e], S[4 * s + 2 * e + 1]), v = JN.get(k); if (v) { v[0] += dy / L; v[1] -= dx / L; v[2]++; } else JN.set(k, [dy / L, -dx / L, 1, NaN]); }
  }
  const J = [0, 0, 0, 0];   // 点の 向き（x, y）・はばの倍率・岸の高さ
  const joint = (x, y, nx, ny, W) => {
    const v = JN.get(jk(x, y)); let mx = nx, my = ny, f = 1;
    if (v && v[2] >= 2) { const l = Math.hypot(v[0], v[1]); if (l > 1e-3) { mx = v[0] / l; my = v[1] / l; f = 1 / Math.max(0.55, mx * nx + my * ny); } }
    let h = v ? v[3] : NaN; if (h !== h) { h = Math.max(gAt(x - mx * 0.06, y - my * 0.06), W + 0.6) + 0.1; if (v) v[3] = h; }
    J[0] = mx; J[1] = my; J[2] = f; J[3] = h;
  };
  for (let s = 0; s < ns; s++) {
    const ax = S[4 * s], ay = S[4 * s + 1], bx = S[4 * s + 2], by = S[4 * s + 3], mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (mx < cx * CS || mx >= cx * CS + CS || my < cy * CS || my >= cy * CS + CS) continue;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); if (L < 1e-4) continue;
    const nx = dy / L, ny = -dx / L;   // 水の側
    let w = wat(mx + nx * 0.4, my + ny * 0.4); if (w < 0) w = wat(mx + nx * 0.9, my + ny * 0.9); if (w < 0) continue;
    const sty = STY[w]; if (sty !== ST_WALL && sty !== ST_PORT) continue;
    const W = Wt[w] === Wt[w] ? Wt[w] : 0, uf = sty === ST_WALL ? 0.03 : 0.015;
    joint(ax, ay, nx, ny, W); const anx = J[0] * J[2], any = J[1] * J[2], hA = J[3];
    joint(bx, by, nx, ny, W); const bnx = J[0] * J[2], bny = J[1] * J[2], hB = J[3];
    const Ax = ax + anx * uf, Ay = ay + any * uf, Bx = bx + bnx * uf, By = by + bny * uf;   // 壁の線
    // 天端・エプロン（陸の側 cw まで）
    quad([ax - anx * cw, hA * U, ay - any * cw, bx - bnx * cw, hB * U, by - bny * cw, Ax, hA * U, Ay, Bx, hB * U, By], sty === ST_WALL ? C_TOP : C_CONC, sty === ST_WALL ? C_TOP : C_CONC);
    if (sty === ST_WALL) {   // パラペット（高さ 1.1m・あつさ 0.7m）：陸の側の面・上の面・海の側の面（のり面の上まで）
      const tA = hA + 1.1, tB = hB + 1.1, iax = -anx * 0.014, iay = -any * 0.014, ibx = -bnx * 0.014, iby = -bny * 0.014;
      quad([Ax + iax, hA * U, Ay + iay, Bx + ibx, hB * U, By + iby, Ax + iax, tA * U, Ay + iay, Bx + ibx, tB * U, By + iby], C_CONCW, C_PAR);
      quad([Ax + iax, tA * U, Ay + iay, Bx + ibx, tB * U, By + iby, Ax, tA * U, Ay, Bx, tB * U, By], C_TOP, C_TOP);
      quad([Ax, (hA - 0.8) * U, Ay, Bx, (hB - 0.8) * U, By, Ax, tA * U, Ay, Bx, tB * U, By], C_CONC, C_PAR);
    } else {   // 岸壁：直立の壁（水の下まで。水ぎわは ぬれて暗い）
      const mA = W + 0.7, bt = W - 2;
      quad([Ax, bt * U, Ay, Bx, bt * U, By, Ax, mA * U, Ay, Bx, mA * U, By], C_ROCKW, C_CONCW);
      quad([Ax, mA * U, Ay, Bx, mA * U, By, Ax, hA * U, Ay, Bx, hB * U, By], C_CONCW, C_CONC);
    }
    // 消波ブロック：のり面の下に 2〜3 列（近いときだけ）
    if (blk && sty === ST_WALL) {
      const sp = 0.054, nb = Math.max(1, Math.round(L / sp));
      for (let k = 0; k < nb; k++) for (let r = 0; r < 3; r++) {
        const t = (k + 0.5 + (r & 1) * 0.5) / nb, px = ax + dx * t, py = ay + dy * t, hs = hash(Math.round(px * 211) + r * 7919, Math.round(py * 211));
        if (r === 2 && hs < 0.3) continue;
        const h2 = hash(Math.round(py * 173) + r, Math.round(px * 173) + 5), h3 = hash(Math.round(px * 97) + r * 3, Math.round(py * 89) + 11);
        const along = (h2 - 0.5) * 0.35 * sp, uu = [0.165, 0.215, 0.265][r] + (h3 - 0.5) * 0.016, hh = W + [1.3, 0.7, 0.05][r] + (hs - 0.5) * 0.5;
        blk.push(px + dx / L * along + nx * uu, hh * U, py + dy / L * along + ny * uu, hs, h2, h3);
      }
    }
  }
  if (I.n) {
    const nv = P.n / 3, g = geo(T3, P, C, I, nv); g.setAttribute('normal', new T3.BufferAttribute(normals(g.attributes.position.array, g.index.array, nv), 3));
    mesh.add(new T3.Mesh(g, MAT.k));
  }
  if (blk && blk.length) {
    const nb = blk.length / 6, TG = tetraGeo(), g = new T3.BufferGeometry();
    g.setAttribute('position', new T3.BufferAttribute(TG.P, 3)); g.setAttribute('normal', new T3.BufferAttribute(TG.N, 3));
    const im = new T3.InstancedMesh(g, MAT.blk, nb), M4 = new T3.Matrix4(), Q = new T3.Quaternion(), E3 = new T3.Euler(), V = new T3.Vector3(), SC = new T3.Vector3(), CO = new T3.Color();
    for (let i = 0; i < nb; i++) {
      const o = i * 6, a = blk[o + 3], b = blk[o + 4], c = blk[o + 5], s = 0.03 * (0.92 + 0.16 * c);
      E3.set(a * 6.283, b * 6.283, c * 6.283); Q.setFromEuler(E3); V.set(blk[o], blk[o + 1], blk[o + 2]); SC.set(s, s, s);
      M4.compose(V, Q, SC); im.setMatrixAt(i, M4);
      const sh = 0.9 + 0.14 * b - (blk[o + 1] < 0.4 * U ? 0.1 : 0); CO.setRGB(0.78 * sh, 0.77 * sh, 0.73 * sh); im.setColorAt(i, CO);
    }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    g.boundingSphere = new T3.Sphere(new T3.Vector3(cx * CS + 32, 0, cy * CS + 32), 47);   // 見えるかの はんい：チャンクと同じ（ブロックの形の球では はかれない）
    mesh.add(im); ST.blk = (ST.blk || 0) + nb;
  }
}

/* ---------- 質感（材料）：地面（頂点の色）・水面（深さで色・岸の白い波・空のうつりこみ・さざなみ）・橋 ---------- */
// さざなみの絵（くりかえし）：RG 面の向き・B 高さ・A 白い波を まだらにする ゆらぎ
function rippleTex(T3) {
  if (typeof document === 'undefined') return null;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), im = g.createImageData(S, S), d = im.data, H = new Float32Array(S * S);
  let r = 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  // いろいろな向きの波を 22 本（向きが かたよると すじに見える）
  const W = []; for (let k = 0; k < 22; k++) { const a = (k + rnd() * 0.8) / 22 * Math.PI * 2, f = 3 + Math.floor(rnd() * 10); W.push([Math.round(Math.cos(a) * f), Math.round(Math.sin(a) * f), rnd() * 6.283, 0.62 / (1 + f * 0.3)]); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let h = 0; for (const [fx, fy, p, am] of W) h += am * Math.sin((fx * x + fy * y) / S * 6.283 + p); H[y * S + x] = h; }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = H[y * S + (x + 1) % S] - H[y * S + (x + S - 1) % S], hy = H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x], o = (y * S + x) * 4;
    d[o] = 128 + clamp(hx * 60, -127, 127); d[o + 1] = 128 + clamp(hy * 60, -127, 127); d[o + 2] = 128 + clamp(H[y * S + x] * 40, -127, 127); d[o + 3] = Math.floor(rnd() * 120 + 70 + 60 * Math.sin(x / S * 12.566) * Math.sin(y / S * 18.85));
  }
  g.putImageData(im, 0, 0);
  const t = new T3.CanvasTexture(cv); t.wrapS = t.wrapT = T3.RepeatWrapping; t.anisotropy = 4; return t;
}
function waterMat(T3, rip, decal) {
  const m = new T3.MeshPhongMaterial({ vertexColors: true, specular: new T3.Color('#262d32'), shininess: 110 });
  if (decal) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.keep = true;
  if (!rip) return m;
  m.onBeforeCompile = sh => {
    sh.uniforms.uRip = { value: rip }; sh.uniforms.uSky = { value: new T3.Color('#c4dbee') }; sh.uniforms.uSand = { value: new T3.Color('#a8b39a') };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aW;\nvarying vec2 vW;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = aW;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uRip;\nuniform vec3 uSky;\nuniform vec3 uSand;\nvarying vec2 vW;\nvarying vec3 vWP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 浅いところは 底の色がすける（砂・石）
        float dep = max(vW.x, 0.0), shl = 1.0 - smoothstep(0.0, 2.6, dep);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, uSand, 0.62), shl);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // さざなみ（世界の位置で 2 つの大きさ）
        vec2 q0 = mat2(0.6, -0.8, 0.8, 0.6) * vWP.xz * 0.23 + vec2(0.13, 0.41), q1 = vWP.xz * 1.9, q2 = mat2(0.8, 0.6, -0.6, 0.8) * vWP.xz * 5.3 + vec2(0.31, 0.77);
        vec4 r0 = texture2D(uRip, q0), r1 = texture2D(uRip, q1), r2 = texture2D(uRip, q2);
        // 深い海・湖は 大きなうねり（遠くでも）。こまかい さざなみは 遠いほど よわく（ちらつかないように）
        float vd = length(vViewPosition), fz = (1.0 - 0.7 * smoothstep(10.0, 70.0, vd)) * mix(0.35, 1.0, smoothstep(0.06, 0.4, abs(dot(normal, vViewPosition / vd)))), swl = smoothstep(1.5, 6.0, dep) * (1.0 - 0.75 * smoothstep(20.0, 120.0, vd));
        vec2 dn = (r0.xy - 0.5) * 0.11 * swl + ((r1.xy - 0.5) * 0.36 + (r2.xy - 0.5) * 0.22) * fz;
        normal = normalize((viewMatrix * vec4(normalize(vec3(dn.x, 1.0, dn.y)), 0.0)).xyz);`)
      .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', `
        // 空のうつりこみ（ななめから見るほど つよく）
        float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight = mix(outgoingLight, uSky, clamp(0.07 + 0.62 * pow(1.0 - ndv, 3.0), 0.0, 0.8));
        // 岸の白い波（浅いところ。まだらに）
        float fw = vW.y, fo = fw * (1.0 - smoothstep(0.02, 0.22 + 0.55 * fw, dep)) * smoothstep(0.25, 0.7, r2.w * 0.6 + r1.w * 0.4 + 0.25 * (1.0 - dep));
        outgoingLight = mix(outgoingLight, vec3(0.92, 0.94, 0.95), clamp(fo, 0.0, 0.9));
        gl_FragColor = vec4( outgoingLight, diffuseColor.a );`);
  };
  m.customProgramCacheKey = () => 'm3water' + (decal ? 'd' : '');
  return m;
}
// 地面の こまかい模様（くりかえし）：R こまかい草のつぶ・G 田畑の区画（4 マスで 1 まい）・B 林の木のかたまり・A なだらかな ゆらぎ
function detailTex(T3) {
  if (typeof document === 'undefined') return null;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), im = g.createImageData(S, S), d = im.data;
  let r = 11; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const vnT = (x, y, f, s) => vn(x / S, y / S, f, s);   // くりかえしの ゆらぎ（f は整数）
  // 田畑：たて 2 列 × よこ 6 段くらいの区画（あぜ道は明るく・区画ごとに色が少しちがう）
  const fx = [0, 0.33, 0.52, 0.78, 1], fy = [0, 0.12, 0.27, 0.41, 0.55, 0.71, 0.86, 1], shade = [];
  for (let k = 0; k < 64; k++) shade.push(0.82 + rnd() * 0.3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    let ix = 0; while (u > fx[ix + 1]) ix++; let iy = 0; while (v > fy[iy + 1]) iy++;
    const ex = Math.min(u - fx[ix], fx[ix + 1] - u) * S, ey = Math.min(v - fy[iy], fy[iy + 1] - v) * S, bund = Math.min(ex, ey) < 1.6;
    const fieldV = bund ? 1.18 : shade[(iy * 5 + ix) % 64] * (0.97 + 0.06 * Math.sin(v * S * 0.9 + ix));   // 畝のすじ
    const grass = 0.9 + 0.2 * rnd(), canopy = 0.5 + 0.5 * vnT(x, y, 24, 3) * 0.6 + 0.5 * vnT(x, y, 52, 5) * 0.4, soft = 0.5 + 0.5 * vnT(x, y, 6, 7);
    d[o] = clamp(grass * 128, 0, 255); d[o + 1] = clamp(fieldV * 128, 0, 255); d[o + 2] = clamp(canopy * 255, 0, 255); d[o + 3] = clamp(soft * 255, 0, 255);
  }
  g.putImageData(im, 0, 0);
  const t = new T3.CanvasTexture(cv); t.wrapS = t.wrapT = T3.RepeatWrapping; t.anisotropy = 8; return t;
}
// 地面の質感：頂点の色（地図の色）に こまかい模様をかける。模様は色から（田畑のうすい黄緑・林の緑・まちの灰色）。平均は 1 くらい（遠くでは 地図の色のまま）
function terrainMat(T3, det) {
  const m = new T3.MeshLambertMaterial({ vertexColors: true }); m.keep = true;
  if (!det) return m;
  m.onBeforeCompile = sh => {
    sh.uniforms.uDet = { value: det };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDet;\nvarying vec3 vWP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 c0 = diffuseColor.rgb;
        vec4 tA = texture2D(uDet, vWP.xz * 0.25), tB = texture2D(uDet, vWP.xz * 1.9 + vec2(0.37, 0.11)), tC = texture2D(uDet, vWP.xz * 0.061);
        float gb = c0.g - c0.b, gr = abs(c0.r - c0.g);
        float gw = smoothstep(0.0, 0.035, c0.g - c0.r);   // 緑より（砂浜・ぬれた砂・岩は のぞく）
        float fieldW = smoothstep(0.79, 0.84, c0.r) * smoothstep(0.11, 0.15, gb) * smoothstep(0.95, 0.9, c0.g) * gw;
        float forestW = smoothstep(0.83, 0.77, c0.r) * smoothstep(0.09, 0.15, gb) * smoothstep(0.62, 0.68, c0.g) * smoothstep(0.86, 0.82, c0.g) * gw;   // 林・丘・山（公園の明るい緑は のぞく）
        float urbanW = smoothstep(0.06, 0.03, gb) * smoothstep(0.05, 0.02, gr) * smoothstep(0.6, 0.7, c0.r);
        float k = (0.93 + 0.14 * tB.r) * (0.94 + 0.12 * tC.a);
        k *= mix(1.0, 0.82 + 0.3 * tA.g, fieldW);
        k *= mix(1.0, 0.74 + 0.42 * tB.b, forestW * (1.0 - fieldW));
        k *= mix(1.0, 0.96 + 0.08 * tB.a, urbanW);
        diffuseColor.rgb = c0 * k;`);
  };
  m.customProgramCacheKey = () => 'm3terrain';
  return m;
}
function mats(T3) {
  if (MAT.t) return;
  MAT.t = terrainMat(T3, detailTex(T3));
  const rip = rippleTex(T3);
  MAT.w = waterMat(T3, rip, false); MAT.wd = waterMat(T3, rip, true);
  MAT.ws = waterMat(T3, rip, false); MAT.ws.vertexColors = false; MAT.ws.color.setRGB(WC_SEA[0], WC_SEA[1], WC_SEA[2]); MAT.ws.customProgramCacheKey = () => 'm3waters';
  MAT.b = new T3.MeshLambertMaterial({ vertexColors: true }); MAT.b.keep = true;
  MAT.k = new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }); MAT.k.keep = true;
  MAT.blk = new T3.MeshLambertMaterial({ color: 0xffffff }); MAT.blk.keep = true;
}

/* ---------- 地面のまま 水の上をとおる道路：橋（床版・桁・高欄・橋脚）。m3Surf（H）も 橋の高さに（道が川底へ しずまないように） ----------
   線路は 線路のファイルが 自分で橋にする（水の上は 岸と岸を まっすぐ）ので、ここでは道路だけ */
// 近くの道路（visibleItems。読んだセル・近いはんいが かわったときだけ よみなおす）
const SEG = { sig: '', roads: [], it: null };
function roadsNear(X) {
  const S = X.S; if (!S || !S.cells || !X.visibleItems) return [];
  let n = 0, m = 0, nb = 0;
  for (const c of S.cells.values()) if (c.data) { n++; m += c.data.segs ? c.data.segs.length : 0; nb += c.data.blds ? c.data.blds.length : 0; }
  const r = S.v3rect || {}, sig = n + ':' + m + ':' + nb + ':' + Math.round(r.x0 || 0) + ',' + Math.round(r.y0 || 0) + ',' + Math.round(r.x1 || 0) + ',' + Math.round(r.y1 || 0) + ':' + (S.cam ? S.cam.z : 0);
  if (sig === SEG.sig) return SEG.roads;
  SEG.sig = sig;
  let it = null; try { it = X.visibleItems(); } catch (e) { it = null; }
  SEG.it = it;
  SEG.roads = it && it.segs ? [...it.segs.values()].filter(s => s.k === 'road' && s.np >= 2 && s.P && s.bb) : [];
  return SEG.roads;
}
const isWch = t => !!t && (t.t === 'R' || t.t === 'L' || t.t === 'S' || t.t === 'D');
// 道の 0.2 マスごとの点 [x, y, s, …]（s：はじめからの長さ）
function segPts(s) {
  if (s._m3p) return s._m3p;
  const P = s.P, n = s.np, out = []; let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], D = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(D / 0.2));
    for (let q = 0; q < m; q++) out.push(ax + (bx - ax) * q / m, ay + (by - ay) * q / m, acc + D * q / m);
    acc += D;
  }
  out.push(P[2 * n - 2], P[2 * n - 1], acc);
  return (s._m3p = out);
}
const segCode = (s, sv) => s.pf && s.L && s.st ? (s.st[clamp(Math.round(sv), 0, s.st.length - 1)] || 'G') : 'G';
// このチャンク（網のはんい ＋ 1 マス）に かかる 橋のいる道：[{ id, hw（半はば マス）, P [x, y, …], h [床の高さ m], w [水面 m] }]
function findDecks(X, Wn, cx, cy) {
  const roads = roadsNear(X); if (!roads.length) return [];
  const bx0 = cx * CS - 0.5, by0 = cy * CS - 0.5, bx1 = cx * CS + CS + 1.5, by1 = cy * CS + CS + 1.5, out = [];
  const inWin = (tx, ty) => { const rx = tx - Wn.x0, ry = ty - Wn.y0; return rx >= 0 && ry >= 0 && rx < NW && ry < NW ? ry * NW + rx : -1; };
  const isWat = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y), w = inWin(tx, ty); return w >= 0 ? Wn.isW[w] === 1 : isWch(X.tileAt(tx, ty)); };
  const landH = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y), w = inWin(tx, ty); if (w >= 0) return Wn.EL[w]; const t = X.tileAt(tx, ty); return t ? Math.max(0.02, t.e) : 0.02; };
  const waterL = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y), w = inWin(tx, ty); if (w >= 0 && Wn.Wt) { const v = Wn.Wt[w]; return v === v ? v : NaN; } return NaN; };
  for (const s of roads) {
    if (s.bb[2] < bx0 - 1 || s.bb[0] > bx1 + 1 || s.bb[3] < by0 - 1 || s.bb[1] > by1 + 1) continue;
    const pts = segPts(s), N = pts.length / 3;
    for (let k = 0; k < N; k++) {
      if (!isWat(pts[3 * k], pts[3 * k + 1]) || segCode(s, pts[3 * k + 2]) !== 'G') continue;
      let k1 = k; while (k1 + 1 < N && isWat(pts[3 * k1 + 3], pts[3 * k1 + 4]) && segCode(s, pts[3 * k1 + 5]) === 'G') k1++;
      const a = Math.max(0, k - 1), b = Math.min(N - 1, k1 + 1);
      let hit = false; for (let j = a; j <= b; j++) { const x = pts[3 * j], y = pts[3 * j + 1]; if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) { hit = true; break; } }
      if (hit) {
        const h0 = landH(pts[3 * a], pts[3 * a + 1]), h1 = landH(pts[3 * b], pts[3 * b + 1]), s0 = pts[3 * a + 2], s1 = pts[3 * b + 2];
        const run = { id: s.id, hw: Math.max(6, (s.w || 0.2) * 50) / 100, P: [], h: [], w: [], land0: !isWat(pts[3 * a], pts[3 * a + 1]), land1: !isWat(pts[3 * b], pts[3 * b + 1]) };
        for (let j = a; j <= b; j++) {
          const x = pts[3 * j], y = pts[3 * j + 1], f = (pts[3 * j + 2] - s0) / Math.max(1e-6, s1 - s0), wl = waterL(x, y);
          let h = h0 + (h1 - h0) * f; if (wl === wl && j > a && j < b) h = Math.max(h, wl + 0.8);
          run.P.push(x, y); run.h.push(h); run.w.push(wl === wl ? wl : h - 3);
        }
        out.push(run);
      }
      k = k1;
    }
  }
  return out;
}
const deckKey = d => d.map(r => r.id).sort((a, b) => a - b).join(',');
// 橋：H を床の高さに（水の点だけ）・床版・桁・高欄・橋脚（このチャンクの網のはんいの ところ）
function deckApply(X, Wn, cx, cy, st, HH, nh, decks, mesh, lwt) {
  const T3 = X.T3, U = X.M3_U * X.M3_VEX, ox = cx * CS + 0.5, oy = cy * CS + 0.5, LIFT = X.M3_LIFT || 0.02;
  for (const r of decks) {
    const m = r.hw + st * 1.0, P = r.P, np = P.length / 2;
    for (let j = 0; j + 1 < np; j++) {
      const ax = P[2 * j], ay = P[2 * j + 1], bx = P[2 * j + 2], by = P[2 * j + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - m - ox) / st)), i1 = Math.min(nh - 1, Math.ceil((Math.max(ax, bx) + m - ox) / st));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - m - oy) / st)), j1 = Math.min(nh - 1, Math.ceil((Math.max(ay, by) + m - oy) / st));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const px = ox + Math.min(ii * st, CS), py = oy + Math.min(jj * st, CS), t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1), qx = ax + dx * t - px, qy = ay + dy * t - py;
        if (qx * qx + qy * qy > m * m || lwt(px, py) !== 3) continue;
        const h = (r.h[j] + (r.h[j + 1] - r.h[j]) * t) * U, k = jj * nh + ii; if (h > HH[k]) HH[k] = h;
      }
    }
  }
  // 橋のかたち
  const B = new FA(4096), BC = new FA(4096), BN = new FA(4096), mm = 1 / 50;
  const quad = (a, b, c, d, n, col) => { for (const p of [a, b, c, a, c, d]) { B.push3(p[0], p[1], p[2]); BN.push3(n[0], n[1], n[2]); BC.push3(col[0], col[1], col[2]); } };
  const inR = (x, y) => x >= ox && x < ox + CS && y >= oy && y < oy + CS;
  const C1 = [0.70, 0.70, 0.67], C2 = [0.55, 0.55, 0.53], C3 = [0.78, 0.78, 0.75];
  for (const r of decks) {
    const P = r.P, np = P.length / 2, w = r.hw + 0.4 * mm;
    let sAcc = 0, nextPier = 0.45; const total = (() => { let t = 0; for (let j = 0; j + 1 < np; j++) t += Math.hypot(P[2 * j + 2] - P[2 * j], P[2 * j + 3] - P[2 * j + 1]); return t; })();
    for (let j = 0; j + 1 < np; j++) {
      const ax = P[2 * j], ay = P[2 * j + 1], bx = P[2 * j + 2], by = P[2 * j + 3], L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) continue;
      const nx = -(by - ay) / L, ny = (bx - ax) / L, mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (inR(mx, my)) {
        const ta = r.h[j] * U + LIFT * 0.85, tb = r.h[j + 1] * U + LIFT * 0.85, ga = ta - 1.9 * mm, gb = tb - 1.9 * mm;
        for (const sd of [1, -1]) {
          const A = [ax + nx * w * sd, 0, ay + ny * w * sd], Bp = [bx + nx * w * sd, 0, by + ny * w * sd], n = [nx * sd, 0, ny * sd];
          const p = (q, y) => [q[0], y, q[2]];
          // 桁の横（床版のはしから 1.9m 下まで）
          if (sd > 0) quad(p(A, ga), p(Bp, gb), p(Bp, tb), p(A, ta), n, C1); else quad(p(Bp, gb), p(A, ga), p(A, ta), p(Bp, tb), n, C1);
          // 高欄（コンクリート。高さ 1.1m・あつさ 25cm）
          const ins = [A[0] - nx * sd * 0.25 * mm, 0, A[2] - ny * sd * 0.25 * mm], insB = [Bp[0] - nx * sd * 0.25 * mm, 0, Bp[2] - ny * sd * 0.25 * mm], ha = ta + LIFT * 0.15 + 1.1 * mm, hb2 = tb + LIFT * 0.15 + 1.1 * mm;
          if (sd > 0) { quad(p(A, ta), p(Bp, tb), p(Bp, hb2), p(A, ha), n, C3); quad(p(insB, tb), p(ins, ta), p(ins, ha), p(insB, hb2), [-n[0], 0, -n[2]], C3); quad(p(A, ha), p(Bp, hb2), p(insB, hb2), p(ins, ha), [0, 1, 0], C3); }
          else { quad(p(Bp, tb), p(A, ta), p(A, ha), p(Bp, hb2), n, C3); quad(p(ins, ta), p(insB, tb), p(insB, hb2), p(ins, ha), [-n[0], 0, -n[2]], C3); quad(p(Bp, hb2), p(A, ha), p(ins, ha), p(insB, hb2), [0, 1, 0], C3); }
        }
        // 桁の下
        quad([ax - nx * w, ga, ay - ny * w], [bx - nx * w, gb, by - ny * w], [bx + nx * w, gb, by + ny * w], [ax + nx * w, ga, ay + ny * w], [0, -1, 0], C2);
      }
      // 橋脚（35m ごと。岸から 15m は なし。水の中まで）
      while (nextPier < sAcc + L) {
        const f = (nextPier - sAcc) / L, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        if (nextPier > 0.3 && nextPier < total - 0.3 && inR(x, y)) {
          const top = (r.h[j] + (r.h[j + 1] - r.h[j]) * f) * U + LIFT * 0.85 - 1.9 * mm, bot = (r.w[j] - 3) * U, tx = (bx - ax) / L, ty = (by - ay) / L, hw2 = w * 0.8, th = 0.7 * mm;
          if (top - bot > 0.5 * mm) {
            const c = (u, v, h) => [x + nx * u + tx * v, h, y + ny * u + ty * v];
            quad(c(-hw2, th, bot), c(hw2, th, bot), c(hw2, th, top), c(-hw2, th, top), [tx, 0, ty], C1);
            quad(c(hw2, -th, bot), c(-hw2, -th, bot), c(-hw2, -th, top), c(hw2, -th, top), [-tx, 0, -ty], C1);
            quad(c(hw2, th, bot), c(hw2, -th, bot), c(hw2, -th, top), c(hw2, th, top), [nx, 0, ny], C2);
            quad(c(-hw2, -th, bot), c(-hw2, th, bot), c(-hw2, th, top), c(-hw2, -th, top), [-nx, 0, -ny], C2);
          }
        }
        nextPier += 0.7;
      }
      sAcc += L;
    }
  }
  if (!B.n) return;
  const g = new T3.BufferGeometry();
  g.setAttribute('position', new T3.BufferAttribute(B.out(), 3)); g.setAttribute('normal', new T3.BufferAttribute(BN.out(), 3)); g.setAttribute('color', new T3.BufferAttribute(BC.out(), 3));
  mesh.add(new T3.Mesh(g, MAT.b));
}

/* ---------- 切らないところ：道路・線路・建物（陸のマスの角を 岸の形に切るとき、ここは切らない。H と 見える地面を そろえる） ---------- */
const PR = 5;   // 1 マスに 5 つ（10m）
function protMask(X, Wn, cx, cy) {
  const B0x = cx * CS - 2, B0y = cy * CS - 2, BN = (CS + 4) * PR, R = scr('PRm', Uint8Array, BN * BN).fill(0), ids = [];
  roadsNear(X); const it = SEG.it;
  const nearW = (x, y) => { const rx = Math.floor(x) - Wn.x0, ry = Math.floor(y) - Wn.y0; return rx >= 0 && ry >= 0 && rx < NW && ry < NW && Wn.dW[ry * NW + rx] <= 1.5; };
  const mark = (x, y, r) => { const i0 = Math.max(0, Math.floor((x - r - B0x) * PR)), i1 = Math.min(BN - 1, Math.floor((x + r - B0x) * PR)), j0 = Math.max(0, Math.floor((y - r - B0y) * PR)), j1 = Math.min(BN - 1, Math.floor((y + r - B0y) * PR)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) R[j * BN + i] = 1; };
  if (it) {
    const bx0 = B0x, by0 = B0y, bx1 = B0x + CS + 4, by1 = B0y + CS + 4;
    for (const s of (it.segs ? it.segs.values() : [])) {
      if (!s.P || s.np < 2 || !s.bb || s.bb[2] < bx0 || s.bb[0] > bx1 || s.bb[3] < by0 || s.bb[1] > by1) continue;
      const hw = (s.k === 'road' ? Math.max(6, (s.w || 0.2) * 50) / 100 : Math.max(0.18, s.w || 0.2) / 2) + 0.07, pts = segPts(s); let hit = false;
      for (let k = 0; k < pts.length; k += 3) { const x = pts[k], y = pts[k + 1]; if (x < bx0 - 1 || x > bx1 + 1 || y < by0 - 1 || y > by1 + 1 || !nearW(x, y)) continue; mark(x, y, hw); hit = true; }
      if (hit) ids.push(s.id);
    }
    for (const b of (it.blds ? it.blds.values() : [])) {
      if (!b.bb || b.bb[2] < bx0 || b.bb[0] > bx1 || b.bb[3] < by0 || b.bb[1] > by1) continue;
      let hit = false;
      for (const key of b.set) { const i = key.indexOf(','), x = (+key.slice(0, i) + 0.5) / 5, y = (+key.slice(i + 1) + 0.5) / 5; if (!nearW(x, y)) continue; mark(x, y, 0.16); hit = true; }
      if (hit) ids.push(-b.id);
    }
  }
  const key = ids.sort((a, b) => a - b).join(',');
  return { key, at: (x, y) => { const i = Math.floor((x - B0x) * PR), j = Math.floor((y - B0y) * PR); return i >= 0 && j >= 0 && i < BN && j < BN && R[j * BN + i] === 1; } };
}

/* ---------- こまかさ（自分で決める）：近い川・湖・海のチャンクは こまかい網。カメラが動いたら 作りなおしを たのむ ---------- */
const PL = { frame: -1, X: null, sig: '' };
// のぞましい こまかさ：0 ふつう・4 こまかい・8 とてもこまかい（cur：いまの こまかさ。境目で 行ったり来たり しないように）
function levelWant(X, cx, cy, st, water, cur) {
  if (st > 1 || !water) return 0;
  const M3 = X.M3, d = M3.d, dist = Math.hypot(cx * CS + 32 - M3.tx, cy * CS + 32 - M3.ty), lv = clamp(Number(X.MQ && X.MQ.d3) || 0, 0, 3), hy = cur > 0 ? 1.12 : 1;
  const NR = (d < 150 ? [70, 100, 140, 180][lv] : 0) * hy;
  if (st === 1 && (NR <= 0 || dist > NR)) return 0;
  const R8 = (d < 14 ? 40 + d : 0) * (cur === 8 ? 1.12 : 1);
  return dist < R8 ? 8 : 4;
}
// 水のマスが このチャンクの網のはんいに あるか
function waterHere(Wn, cx, cy) {
  if (!Wn.nWater) return false;
  for (let ry = -1; ry <= CS + 1; ry++) { const row = (ry + MG) * NW + MG; for (let rx = -1; rx <= CS + 1; rx++) if (Wn.isW[row + rx]) return true; }
  return false;
}
// 作りなおしの しるし：このチャンクの水のまわり（wb：水のマスの はんい ＋ 1.5 マス）に かかる 道路・線路・建物の id（橋・切らないところが かわったら 作りなおす）
function itemKey(wb) {
  const it = SEG.it; if (!it || !wb) return '';
  let h = 0, n = 0;
  const hit = bb => bb && !(bb[2] < wb[0] || bb[0] > wb[2] || bb[3] < wb[1] || bb[1] > wb[3]);
  if (it.segs) for (const s of it.segs.values()) if (hit(s.bb)) { h = (h * 31 + s.id) % 1000000007; n++; }
  if (it.blds) for (const b of it.blds.values()) if (hit(b.bb)) { h = (h * 37 + b.id) % 1000000007; n++; }
  return n + ':' + h;
}
// 1 フレームに 1 回（地形のメッシュを描く前）：こまかさ・橋・切らないところが かわったチャンクを 作りなおしに（m3Terrain が つぎのフレームで）
function poll() {
  const X = PL.X; if (!X) return; const M3 = X.M3; if (!M3 || !M3.on || !M3.cm) return;
  const inv = [];
  for (const [, o] of M3.cm) {
    const u = o.mesh && o.mesh.userData && o.mesh.userData.tk; if (!u || !(u.water || u.hw) || o.st > 1) continue;   // 遠くで あらく作った 水のチャンクも（前は こまかくならず、川が 陸の高さの 水の板のまま。t67）
    const want = levelWant(X, u.cx, u.cy, o.st, true, u.lvl);
    if (o.st < 1 && !want) continue;
    if (want !== u.lvl) inv.push([Math.hypot(u.cx * CS + 32 - M3.tx, u.cy * CS + 32 - M3.ty), o]);
  }
  // 読んだ道路・建物が かわったら：水のまわりの ものが かわったチャンク
  roadsNear(X);
  if (PL.sig !== SEG.sig) {
    PL.sig = SEG.sig;
    const r = X.S.v3rect;
    for (const [, o] of M3.cm) {
      const u = o.mesh && o.mesh.userData && o.mesh.userData.tk; if (!u || !u.water || !u.wb || o.st > 1) continue;
      if (r && (u.wb[0] > r.x1 + 1 || u.wb[2] < r.x0 - 1 || u.wb[1] > r.y1 + 1 || u.wb[3] < r.y0 - 1)) continue;
      if (itemKey(u.wb) !== u.ik && !inv.some(q => q[1] === o)) inv.push([Math.hypot(u.cx * CS + 32 - M3.tx, u.cy * CS + 32 - M3.ty), o]);
    }
  }
  if (!inv.length) return;
  inv.sort((a, b) => a[0] - b[0]);
  for (const [, o] of inv.slice(0, 12)) o.nb = (o.nb || '') + '~';   // m3Terrain が 作りなおす（nb が かわった）
  M3.dirty = true;
}
function onBR(renderer) { const f = renderer && renderer.info ? renderer.info.render.frame : -2; if (f === PL.frame) return; PL.frame = f; const t = performance.now(); try { poll(); } catch (e) { console.error(e); } TPH('poll', t); }

/* ---------- 遠くの地形（あらい版）：前の m3LoMesh に、海・湖の水面（ほかの水面と同じ質感）をのせる。チャンクのない海（大きな板）も同じ質感に ---------- */
function seaPlane(X) {
  const sea = X.M3 && X.M3.sea; if (!sea || sea.userData.m3t || !MAT.ws) return;
  const n = sea.geometry.attributes.position.count, A = new Float32Array(n * 2); for (let v = 0; v < n; v++) A[v * 2] = 60;
  sea.geometry.setAttribute('aW', new X.T3.BufferAttribute(A, 2)); sea.material = MAT.ws; sea.userData.m3t = true;
}
function lo(X, cx, cy) {
  if (!X.m3LoMesh || !X.loAt) return null;
  let mesh;
  try {
    mats(X.T3); PL.X = X; seaPlane(X); if (X.M3_TMAT && X.M3_TMAT.m !== MAT.t) X.M3_TMAT.m = MAT.t;
    mesh = X.m3LoMesh(X.T3, cx, cy);
    const T3 = X.T3, U = X.M3_U * X.M3_VEX, WP = new FA(1024), WC = new FA(1024), WA = new FA(512), WI = new IA(1024);
    const cell = (i, j) => { const t = X.loAt(cx * 16 + i, cy * 16 + j); return t && (t.t === 'D' || t.t === 'S' || t.t === 'L') ? t : null; };
    for (let j = 0; j < 16; j++) {
      let run = -1, lvl = 0, kind = 0;
      for (let i = 0; i <= 16; i++) {
        const t = i < 16 ? cell(i, j) : null, k = t ? (t.t === 'L' ? 2 : 1) : 0, l = t ? (t.t === 'L' ? Math.max(0.02, t.e) : 0) : 0;
        if (run >= 0 && (!t || k !== kind || l !== lvl)) {   // 同じ水面の つづきを 1 つの四角に
          const x0 = cx * CS + run * 4 + 0.5, x1 = cx * CS + i * 4 + 0.5, y0 = cy * CS + j * 4 + 0.5, y1 = y0 + 4, v = WP.n / 3, wc = kind === 2 ? WC_LAKE : WC_SEA;
          for (let q = 0; q < 4; q++) { WP.push3(q & 1 ? x1 : x0, lvl * U, q >> 1 ? y1 : y0); WC.push3(wc[0], wc[1], wc[2]); WA.push2(8, 0); }
          WI.quad(v, v + 1, v + 2, v + 3); run = -1;
        }
        if (t && run < 0) { run = i; kind = k; lvl = l; }
      }
    }
    if (WI.n) {
      const nw = WP.n / 3, wg = geo(T3, WP, WC, WI, nw, { aW: [WA, 2] }), NN = new Float32Array(nw * 3); for (let v = 0; v < nw; v++) NN[v * 3 + 1] = 1;
      wg.setAttribute('normal', new T3.BufferAttribute(NN, 3)); mesh.add(new T3.Mesh(wg, MAT.wd));
    }
  } catch (e) { console.error(e); return mesh || null; }
  return mesh;
}

/* ---------- 入口 ---------- */
// まわり 3 マスまでに 水（川・湖・海）があるか（なければ 前の網と同じ。前の m3ChunkMesh を使う）
function waterNear(X, c, cx, cy) {
  const S = X.S, ck = X.ckey, has = s => s.indexOf('R') >= 0 || s.indexOf('L') >= 0 || s.indexOf('S') >= 0 || s.indexOf('D') >= 0;
  if (has(c.t)) return true;
  for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
    if (!dcx && !dcy) continue;
    const n = S.chunks.get(ck(cx + dcx, cy + dcy)); if (!n) continue; if (n.sea) return true;
    const t = n.t, x0 = dcx < 0 ? CS - 3 : 0, x1 = dcx > 0 ? 4 : dcx < 0 ? CS : CS, y0 = dcy < 0 ? CS - 3 : 0, y1 = dcy > 0 ? 4 : CS;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const ch = t.charCodeAt(y * CS + x); if (ch === 82 || ch === 76 || ch === 83 || ch === 68) return true; }
  }
  return false;
}
function chunk(X, c, cx, cy, st) {
  const t0 = performance.now();
  PL.X = X;
  mats(X.T3); if (X.M3_TMAT && X.M3_TMAT.m !== MAT.t) X.M3_TMAT.m = MAT.t;   // 前の網（m3ChunkMesh・m3LoMesh）も この質感で
  if (!waterNear(X, c, cx, cy) && X.m3ChunkMesh) { const m = X.m3ChunkMesh(X.T3, c, cx, cy, st); ST.nOld = (ST.nOld || 0) + 1; ST.msOld = (ST.msOld || 0) + performance.now() - t0; return m; }   // 水のないところ：前のまま（同じ高さ）
  mats(X.T3); seaPlane(X);
  let tq = performance.now();
  // こまかい網のときだけ 水のくわしい しらべ（あらい網は 海・湖の水面だけ）
  let lvl = st < 1 ? Math.max(4, levelWant(X, cx, cy, st, true, -1)) : levelWant(X, cx, cy, st, true, -1);   // 海ぞい（半マスの網）は いつも こまかく
  setWin(lvl > 0 ? 26 : 8);
  const Wn = analyze(X, c, cx, cy, lvl > 0), hw = waterHere(Wn, cx, cy), water = lvl > 0 && hw;
  if (!water && st >= 1) lvl = 0;
  tq = TPH('analyze', tq);
  // 水のマスの はんい（＋1.5 マス）：橋・切らないところの しるし
  let wb = null;
  if (water) { let a = 1e9, b = 1e9, cc = -1e9, d = -1e9; for (let ry = -1; ry <= CS + 1; ry++) for (let rx = -1; rx <= CS + 1; rx++) if (Wn.isW[(ry + MG) * NW + rx + MG]) { if (rx < a) a = rx; if (rx > cc) cc = rx; if (ry < b) b = ry; if (ry > d) d = ry; } wb = [cx * CS + a - 1.5, cy * CS + b - 1.5, cx * CS + cc + 2.5, cy * CS + d + 2.5]; }
  const decks = water ? findDecks(X, Wn, cx, cy) : [];
  tq = TPH('decks', tq);
  const mesh = lvl ? buildFine(X, Wn, c, cx, cy, lvl, st, decks) : buildCoarse(X, Wn, c, cx, cy, st, decks);
  mesh.userData.tk = { cx, cy, lvl, water, hw, wb, ik: water ? itemKey(wb) : '' };   // hw：水がある（遠くで あらく作ったときも。近づいたら こまかく。t67）
  mesh.onBeforeRender = onBR;
  const dt = performance.now() - t0;
  ST.n++; ST.ms += dt; if (lvl) { ST.n5++; ST.ms5 += dt; } ST.last = dt; (ST.recent || (ST.recent = [])).push(Math.round(dt * 10) / 10); if (ST.recent.length > 12) ST.recent.shift();
  if (!ST.slow || dt > ST.slow.ms) ST.slow = { k: cx + ',' + cy, st, lvl, ms: Math.round(dt), v: mesh.geometry.attributes.position.count };
  return mesh;
}

// たしかめる用：チャンク k を st で reps 回つくる時間（ms）と 場面ごとの時間
function bench(k, st, reps) {
  const X = PL.X; if (!X) return null; const c = X.S.chunks.get(k); if (!c || c.sea) return null;
  const [cx, cy] = k.split(',').map(Number), ph0 = Object.assign({}, ST.ph), ts = [];
  for (let r = 0; r < reps; r++) { const t = performance.now(), m = chunk(X, c, cx, cy, st); ts.push(Math.round((performance.now() - t) * 10) / 10); m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const ph = {}; for (const q in ST.ph) ph[q] = Math.round((ST.ph[q] - (ph0[q] || 0)) / reps * 10) / 10;
  return { ts, ph };
}
window.M3TERRA = { chunk, lo, stat: ST, bench };
})();
