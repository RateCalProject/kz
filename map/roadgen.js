/* ===== 風の芽経済組：はじめの道路網（高速道路・国道・県道・市道）をつくる =====
   - 国土（worldgen.js）の地形を見てつなぐ。経路は A*（2〜3マスごとの格子）→ 間引き → なめらかに（チャイキン法で角をけずる）
   - 高速：海ぞい＋瑠璃のまわりの環状線（都市高速・外環・圏央）＋放射線。国道：瑠璃から放射状＋海ぞい＋大きい市どうし。県道：となりの町どうし
   - 市道：まちの中心から幹線 → 枝道 → 細い道 が入り組んで育つ（格子にしない）
   - 車線（片側）：高速 2〜3・国道 2〜3・主要県道 2・県道 1・市の幹線 2〜3・枝道 1・細い道 0（中央線なし）
   - さいごに「交差点」でわけて、道路のグラフ（点 nodes と、点と点を結ぶ線 segs）にする。高速は IC・JCT でだけつながる（ほかの道とは立体交差）
   - 出力：{ segs: [{ id, cls: 'exp'|'nat'|'pref'|'city'|'lane', name, lanes, w, vlim, art, pts: [x0, y0, …]（マス・小数）, len, n0, n1 }],
            nodes: [{ id, kind: 'x'|'end'|'ic'|'jct', name, x, y }] }
   - Node でもブラウザでも動く（あとで国土を広げるとき用） */
(function (root) {
'use strict';
const MapGen = typeof module !== 'undefined' && module.exports ? require('./worldgen.js') : root.MapGen;
const SQ = Math.SQRT1_2;

// ---- 小さい道具 ----
function heapPush(h, f, i) { h.push([f, i]); let k = h.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (h[p][0] <= h[k][0]) break; [h[p], h[k]] = [h[k], h[p]]; k = p; } }
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) { h[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === k) break; [h[m], h[k]] = [h[k], h[m]]; k = m; } }
  return top;
}
// 線を間引く（ダグラス・ポーカー）
function simplify(P, tol) {
  if (P.length < 3) return P.slice();
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const st = [[0, P.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = -1, mi = -1;
    const ax = P[a][0], ay = P[a][1], bx = P[b][0], by = P[b][1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
// 角をけずって、なめらかに（チャイキン法）。はしの点はそのまま
function chaikin(P, it) {
  for (let n = 0; n < it; n++) {
    if (P.length < 3) return P;
    const Q = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      Q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    Q.push(P[P.length - 1]); P = Q;
  }
  return P;
}
// 同じ間隔に点を打ちなおす
function resample(P, step) {
  if (P.length < 2) return P.slice();
  const out = [P[0]]; let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let ax = P[i - 1][0], ay = P[i - 1][1]; const bx = P[i][0], by = P[i][1];
    let seg = Math.hypot(bx - ax, by - ay);
    while (acc + seg >= step) { const t = (step - acc) / seg; ax = ax + (bx - ax) * t; ay = ay + (by - ay) * t; out.push([ax, ay]); seg = Math.hypot(bx - ax, by - ay); acc = 0; }
    acc += seg;
  }
  const l = P[P.length - 1], o = out[out.length - 1];
  if (Math.hypot(l[0] - o[0], l[1] - o[1]) > step * 0.3) out.push(l); else out[out.length - 1] = l;
  return out;
}
const r2 = v => Math.round(v * 100) / 100;
const flat = P => { const a = []; for (const p of P) a.push(r2(p[0]), r2(p[1])); return a; };
const plen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
// 線分 ab への点 p のいちばん近いところ
function projSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t, qy = ay + dy * t;
  return { t, x: qx, y: qy, d: Math.hypot(px - qx, py - qy) };
}
// 線分どうしの交わり（はしをのぞく）
function crossSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u, x: ax + rx * t, y: ay + ry * t };
}

// 車線（片側）→ 道のはば（マス）と、制限速度（km/h）
const roadW = (cls, lanes) => (cls === 'exp' ? 0.3 : 0.18) + 0.13 * lanes;
const roadV = (cls, lanes) => cls === 'exp' ? 100 : cls === 'nat' ? 60 : cls === 'pref' ? (lanes >= 2 ? 60 : 50) : cls === 'city' ? (lanes >= 2 ? 50 : 40) : 30;

/* ---------- 道路網 ---------- */
function build(W, X0, Y0, X1, Y1, opt) {
  opt = opt || {};
  const G = opt.grid || (X1 - X0 > 1600 ? 3 : 2);
  const NX = Math.floor((X1 - X0) / G), NY = Math.floor((Y1 - Y0) / G), N = NX * NY;
  const log = opt.log || (() => {});
  // 格子の地形
  const T = new Array(N), E = new Float32Array(N), D = new Float32Array(N), DN = new Float32Array(N), RV = new Uint8Array(N);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = X0 + i * G + (G >> 1), y = Y0 + j * G + (G >> 1), q = W.cell(x, y);
    T[k] = q.t; E[k] = q.e; D[k] = q.d; RV[k] = q.isRiver ? 1 : 0;
    DN[k] = (q.t === 'S' || q.t === 'D') ? 0 : W.density(x, y);
  }
  log('grid', NX, NY, 'G', G);
  const cx = i => X0 + i * G + G / 2, cy = j => Y0 + j * G + G / 2;
  const idx = (x, y) => { const i = Math.floor((x - X0) / G), j = Math.floor((y - Y0) / G); return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };
  const inBox = (x, y) => x >= X0 && y >= Y0 && x < X1 && y < Y1;
  // 1マスごとの地形のメモ（市道を育てるとき用）
  const TW = X1 - X0, TH = Y1 - Y0, MT = new Uint8Array(TW * TH), ME = new Int16Array(TW * TH), MD = new Float32Array(TW * TH).fill(-1);
  const TCODE = ' DSRLBPFHMK';
  function tile(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (!inBox(x, y)) return null;
    const k = (y - Y0) * TW + (x - X0);
    if (!MT[k]) { const q = W.cell(x, y); MT[k] = TCODE.indexOf(q.t); ME[k] = Math.round(q.e); }
    return k;
  }
  const tT = k => TCODE[MT[k]];
  function tDens(x, y) { const k = tile(x, y); if (k == null) return 0; if (MD[k] < 0) MD[k] = W.density(Math.floor(x), Math.floor(y)); return MD[k]; }

  const used = new Uint8Array(N);                      // 道路が通っている格子（ビット：1 市道、2 県道、4 国道、8 高速）
  const BIT = { city: 1, lane: 1, pref: 2, nat: 4, exp: 8, uexp: 8, cexp: 8 }, REUSE = { exp: 8, uexp: 8, cexp: 8, nat: 4, pref: 6 };
  const COST = {
    exp: { P: 1, F: 1.08, B: 1.3, H: 1.5, M: 2.4, K: 5, R: 3.5, L: 14, slope: 1 / 7, dens: 6, reuse: 1, simp: 3.2, smooth: 4 },
    cexp: { P: 1, F: 1.05, B: 1.1, H: 1.6, M: 3, K: 6, R: 2.5, L: 12, slope: 1 / 7, dens: 0, coast: 1, reuse: 1, simp: 3.2, smooth: 4 },  // 海ぞいの高速（海岸から 1〜1.5km）
    uexp: { P: 1, F: 1, B: 1.1, H: 1.4, M: 3, K: 6, R: 2.2, L: 10, slope: 1 / 7, dens: 0, reuse: 1, simp: 2.6, smooth: 4 },    // 都市高速（高架）
    nat: { P: 1, F: 1.15, B: 1.1, H: 2.1, M: 4.2, K: 12, R: 4.5, L: 24, slope: 1 / 3, dens: 0, reuse: 0.42, simp: 2.6, smooth: 3 },
    pref: { P: 1, F: 1.2, B: 1.1, H: 2.4, M: 5, K: 14, R: 6, L: 30, slope: 1 / 2.5, dens: 0, reuse: 0.45, simp: 2.0, smooth: 3 }
  };
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  // A*（くりかえし使う配列。gen で「今回の値か」を見分ける）：s から（t か、goal(k) が真の格子）まで
  const gA = new Float64Array(N), fromA = new Int32Array(N), seenA = new Int32Array(N), doneA = new Int32Array(N); let gen = 0;
  function astar(s, t, cls, goal) {
    if (s < 0) return null;
    const C = COST[cls], h = []; gen++;
    const tx = t >= 0 ? t % NX : 0, ty = t >= 0 ? Math.floor(t / NX) : 0, hmin = C.reuse;
    const H = k => t >= 0 ? Math.hypot(k % NX - tx, Math.floor(k / NX) - ty) * hmin * 1.15 : 0;
    gA[s] = 0; fromA[s] = -1; seenA[s] = gen; heapPush(h, H(s), s);
    let end = -1;
    while (h.length) {
      const [, k] = heapPop(h); if (doneA[k] === gen) continue; doneA[k] = gen;
      if (k === t || (goal && k !== s && goal(k))) { end = k; break; }
      const i = k % NX, j = Math.floor(k / NX);
      for (const [di, dj, L] of DIRS) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
        const n = nj * NX + ni; if (doneA[n] === gen) continue;
        const tt = T[n]; if (tt === 'S' || tt === 'D') continue;
        let m = C[tt] || 1;
        if (RV[n] && tt !== 'R') m = Math.max(m, C.R * 0.6);
        let c = L * m + C.slope * Math.abs(E[n] - E[k]) / G;
        if (C.dens) c += L * C.dens * Math.min(1, Math.max(0, (DN[n] - 10) / 35));
        if (C.coast) c += L * Math.min(3, Math.max(0, (D[n] - 22) / 30));
        if (used[n] & REUSE[cls]) c *= C.reuse;
        const ng = gA[k] + c;
        if (seenA[n] !== gen || ng < gA[n]) { gA[n] = ng; fromA[n] = k; seenA[n] = gen; heapPush(h, ng + H(n), n); }
      }
    }
    if (end < 0) return null;
    const path = []; for (let k = end; k >= 0; k = fromA[k]) path.push(k);
    return path.reverse();
  }

  /* ---- 線の索引（線分ごと。2マスのます目）---- */
  const segs = [];
  let sid = 0;
  const EI = new Map(), ek = (x, y) => Math.floor(x / 2) + ',' + Math.floor(y / 2);
  function indexEdges(s) {
    const P = s.P;
    for (let e = 0; e + 1 < P.length; e++) {
      const x0 = Math.floor(Math.min(P[e][0], P[e + 1][0]) / 2), x1 = Math.floor(Math.max(P[e][0], P[e + 1][0]) / 2);
      const y0 = Math.floor(Math.min(P[e][1], P[e + 1][1]) / 2), y1 = Math.floor(Math.max(P[e][1], P[e + 1][1]) / 2);
      for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) { const key = a + ',' + b; let L = EI.get(key); if (!L) EI.set(key, L = []); L.push([s, e]); }
    }
  }
  // いちばん近い線の上の点（ok(s) が真の線だけ）
  function snapTo(x, y, R, ok) {
    let best = null;
    const a0 = Math.floor((x - R) / 2), a1 = Math.floor((x + R) / 2), b0 = Math.floor((y - R) / 2), b1 = Math.floor((y + R) / 2);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const L = EI.get(a + ',' + b); if (!L) continue;
      for (const [s, e] of L) {
        if (!ok(s)) continue;
        const p = projSeg(x, y, s.P[e][0], s.P[e][1], s.P[e + 1][0], s.P[e + 1][1]);
        if (p.d <= R && (!best || p.d < best.d)) best = { s, e, t: p.t, x: p.x, y: p.y, d: p.d };
      }
    }
    return best;
  }
  const isExp = s => s.cls === 'exp';
  const notExp = s => s.cls !== 'exp';

  // A* の道を線にする。すでにある道（同じか上の種類）を通るところは、その道を使う（重ねない）→ 新しいところだけの線をいくつか作る
  function addRoad(path, cls, name, o) {
    o = o || {};
    if (!path || path.length < 2) return [];
    const C = COST[cls], mask = REUSE[cls], ocls = cls === 'uexp' || cls === 'cexp' ? 'exp' : cls;
    const runs = [];
    if (o.noSplit) runs.push([0, path.length - 1]);
    else {
      let i = 0;
      while (i < path.length) {
        while (i < path.length && (used[path[i]] & mask)) i++;
        if (i >= path.length) break;
        let j = i;
        while (j + 1 < path.length && !(used[path[j + 1]] & mask)) j++;
        runs.push([Math.max(0, i - 1), Math.min(path.length - 1, j + 1)]);
        i = j + 1;
      }
    }
    const out = [], okSnap = ocls === 'exp' ? isExp : notExp;
    for (const [a, b] of runs) {
      if (b - a < 2) continue;
      let P = path.slice(a, b + 1).map(k => [cx(k % NX), cy(Math.floor(k / NX))]);
      // はしが、ほかの道の上なら、その道にぴったりつける
      for (const end of [0, 1]) {
        const want = o.ends && o.ends[end] && ((end === 0 && a === 0) || (end === 1 && b === path.length - 1)) ? o.ends[end] : null;
        const p = end === 0 ? P[0] : P[P.length - 1];
        let q = want;
        if (!q) { const sn = snapTo(p[0], p[1], G * 1.6 + 0.6, okSnap); if (sn) q = [sn.x, sn.y]; }
        if (q) { if (end === 0) P[0] = q; else P[P.length - 1] = q; }
      }
      // 間引き → なめらかに。海の上に出てしまったら、間引きを弱くしてやりなおす
      const raw = P;
      for (let tol = C.simp * 2; ; tol /= 2) {
        P = tol >= 0.5 ? simplify(raw, tol) : raw.slice();
        P = chaikin(P, C.smooth);
        P = resample(P, ocls === 'exp' || ocls === 'nat' ? 0.6 : 0.8);
        if (tol < 0.5 || !P.some(p => { const k = tile(p[0], p[1]); return k != null && 'SD'.includes(tT(k)); })) break;
      }
      if (plen(P) < 2) continue;
      const s = { id: 'g' + (++sid), cls: ocls, name, lanes: o.lanes, P, icStart: !!o.icStart && a === 0, urban: cls === 'uexp' };
      segs.push(s); out.push(s); indexEdges(s);
      for (const p of P) { const k = idx(p[0], p[1]); if (k >= 0) used[k] |= BIT[ocls]; }
    }
    for (const k of path) used[k] |= BIT[ocls];
    return out;
  }
  // 区域のはしの、ある向き（xy の単位ベクトル）にいちばん遠い陸の格子
  function edgeToward(dx, dy, wantD) {
    let best = -1, bs = -Infinity;
    const consider = (i, j) => {
      const k = j * NX + i; if ('SDRL'.includes(T[k])) return;
      const x = cx(i), y = cy(j), sc = x * dx + y * dy - (wantD != null ? Math.abs(D[k] - wantD) * 0.6 : 0) - Math.abs(-x * dy + y * dx) * 0.25;
      if (sc > bs) { bs = sc; best = k; }
    };
    for (let i = 0; i < NX; i++) { consider(i, 0); consider(i, NY - 1); }
    for (let j = 0; j < NY; j++) { consider(0, j); consider(NX - 1, j); }
    return best;
  }
  const kAt = (x, y) => idx(x, y);
  // いちばん近い陸の格子（平地をえらびやすく。山でもよい）
  const nearestLand = (x, y) => {
    let best = -1, bd = Infinity; const k0 = kAt(Math.min(X1 - 1, Math.max(X0, x)), Math.min(Y1 - 1, Math.max(Y0, y))); if (k0 < 0) return -1;
    const i0 = k0 % NX, j0 = Math.floor(k0 / NX);
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
      const k = j * NX + i; if (!'PFBHMK'.includes(T[k]) || RV[k]) continue;
      const dd = di * di + dj * dj + ('PFB'.includes(T[k]) ? 0 : 6); if (dd < bd) { bd = dd; best = k; }
    }
    return best;
  };
  // uv（u：海のほう、v：海岸ぞい北東）の向き → xy
  const uvDir = phi => { const du = -Math.cos(phi), dv = Math.sin(phi); return [(du + dv) * SQ, (du - dv) * SQ]; };

  /* ---- 地名（たねの場所）---- */
  const pl = W.places(Math.floor(X0 / 64), Math.floor(Y0 / 64), Math.floor((X1 - 1) / 64), Math.floor((Y1 - 1) / 64));
  const towns = pl.filter(p => (p.k === 'muni' && !p.wards) || p.k === 'ward').map(p => ({ ...p, d: W.cell(p.x, p.y).d }));
  const bigTowns = towns.filter(t => t.k === 'muni' && t.pop >= 80000);
  const nearTown = (x, y) => { let b = null, bd = Infinity; for (const t of towns) { const d = (t.x - x) ** 2 + (t.y - y) ** 2; if (d < bd) { bd = d; b = t; } } return b; };
  // ある向きの町のつながり（中心から外へ、少しずつ進む）
  function chainDir(dx, dy, minStep, maxStep, pool, latMax) {
    let curx = 0, cury = 0; const chain = [];
    for (let n = 0; n < 40; n++) {
      let best = null;
      for (const t of pool) {
        const rx = t.x - curx, ry = t.y - cury, ahead = rx * dx + ry * dy, lat = Math.abs(-rx * dy + ry * dx);
        if (ahead < minStep || ahead > maxStep || lat > ahead * 0.6) continue;
        const latc = Math.abs(-t.x * dy + t.y * dx);
        if (latc > latMax) continue;
        const sc = Math.log(t.pop || 1000) - ahead / 260 - lat / 110 - latc / 260;
        if (!best || sc > best.sc) best = { t, sc };
      }
      if (!best) break;
      chain.push(best.t); curx = best.t.x; cury = best.t.y;
    }
    return chain;
  }

  /* ---- 高速道路 ---- */
  // 1) 海ぞい（南西のはし → 北東のはし。まちのまん中はよける）
  const coastSW = edgeToward(...uvDir(-Math.PI / 2 + 0.12), 60), coastNE = edgeToward(...uvDir(Math.PI / 2 - 0.12), 60);
  const E1 = addRoad(astar(coastSW, coastNE, 'cexp'), 'cexp', '臨海自動車道', { lanes: 2, noSplit: true });
  log('E1', E1.length);
  // 2) 環状線（中心のまわりの半円。両はしは海ぞいの高速へ）
  function ring(R, name, cls, lanes) {
    const wps = [];
    for (let a = -90; a <= 90; a += 12) {
      const [dx, dy] = uvDir(a * Math.PI / 180), x = dx * R, y = dy * R;
      if (!inBox(x, y)) continue;
      const q = W.cell(Math.round(x), Math.round(y)); if (q.d < 3) continue;
      const k = nearestLand(x, y); if (k >= 0) wps.push(k);
    }
    if (wps.length < 2) return [];
    let path = [];
    // はじめ：海ぞいの高速から
    const first = astar(wps[0], -1, cls, k => (used[k] & 8) !== 0);
    if (first) path = first.reverse();
    for (let i = 0; i + 1 < wps.length; i++) { const p = astar(wps[i], wps[i + 1], cls); if (p) path.push(...(path.length ? p.slice(1) : p)); }
    const mine = new Set(path);
    const last = astar(wps[wps.length - 1], -1, cls, k => (used[k] & 8) !== 0 && !mine.has(k));
    if (last) path.push(...last.slice(1));
    return addRoad(path, cls, name, { lanes });
  }
  const C1 = ring(150, '瑠璃環状線', 'uexp', 2);
  const C2 = ring(430, '瑠璃外環道', 'exp', 3);
  const C3 = ring(960, '瑠璃圏央道', 'exp', 2);
  log('rings', C1.length, C2.length, C3.length);
  // 3) 放射線（環状線から外へ。大きい町の近くを通って区域のはしまで）
  const radNames = [];
  for (const a of [-62, -32, -2, 28, 58]) {
    const [dx, dy] = uvDir(a * Math.PI / 180);
    const chain = chainDir(dx, dy, 220, 620, bigTowns, 420).filter(t => Math.hypot(t.x, t.y) > 260);
    const endK = edgeToward(dx, dy);
    if (endK < 0) continue;
    const far = chain.length ? chain[chain.length - 1] : nearTown(cx(endK % NX), cy(Math.floor(endK / NX)));
    const nm = (far ? far.name : '奥') + '自動車道';
    if (radNames.includes(nm)) continue; radNames.push(nm);
    // 環状線の上の、この向きにいちばん近い点から
    let st = -1, bs = -Infinity;
    for (const s of C1) for (const p of s.P) { const sc = p[0] * dx + p[1] * dy - Math.abs(-p[0] * dy + p[1] * dx) * 2; if (sc > bs) { bs = sc; st = kAt(p[0], p[1]); } }
    if (st < 0) st = nearestLand(dx * 150, dy * 150);
    const stops = [st, ...chain.map(t => nearestLand(t.x + dy * 14, t.y - dx * 14)).filter(k => k >= 0), endK];
    let path = [];
    for (let i = 0; i + 1 < stops.length; i++) { if (stops[i] === stops[i + 1]) continue; const p = astar(stops[i], stops[i + 1], 'exp'); if (p) path.push(...(path.length ? p.slice(1) : p)); }
    addRoad(path, 'exp', nm, { lanes: 3 });
  }
  log('radials', radNames.join(' '));

  /* ---- 国道：海ぞい（101号）＋ 瑠璃から放射状 ＋ 大きい市どうし ---- */
  const coastal = towns.filter(t => t.d < 120).sort((a, b) => (a.x - a.y) - (b.x - b.y));
  const n1a = edgeToward(...uvDir(-Math.PI / 2 + 0.05), 18), n1b = edgeToward(...uvDir(Math.PI / 2 - 0.05), 18);
  const stops1 = [n1a, ...coastal.map(t => nearestLand(t.x, t.y)).filter(k => k >= 0), n1b];
  const N1 = [];
  for (let i = 0; i < stops1.length - 1; i++) { if (stops1[i] === stops1[i + 1]) continue; const p = astar(stops1[i], stops1[i + 1], 'nat'); if (p) N1.push(...(N1.length ? p.slice(1) : p)); }
  addRoad(N1, 'nat', '国道101号', { lanes: 2 });
  let rno = 102;
  const c0 = nearestLand(0, 0);
  for (let a = -78; a <= 78; a += 17.3) {
    const [dx, dy] = uvDir(a * Math.PI / 180);
    const chain = chainDir(dx, dy, 110, 420, towns.filter(t => t.k === 'muni'), 300);
    const endK = edgeToward(dx, dy); if (endK < 0) continue;
    const stops = [c0, ...chain.map(t => nearestLand(t.x, t.y)).filter(k => k >= 0), endK];
    let path = [];
    for (let i = 0; i + 1 < stops.length; i++) { if (stops[i] === stops[i + 1]) continue; const p = astar(stops[i], stops[i + 1], 'nat'); if (p) path.push(...(path.length ? p.slice(1) : p)); }
    if (addRoad(path, 'nat', `国道${rno}号`, { lanes: 2 }).length) rno++;
  }
  // 大きい市どうし（相対近傍グラフ。国道から遠いところだけ）
  const rng = (pts, maxD) => {
    const E = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], dab = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; if (dab > maxD * maxD) continue;
      let ok = true;
      for (let k = 0; k < pts.length && ok; k++) { if (k === i || k === j) continue; const c = pts[k]; if (Math.max((a.x - c.x) ** 2 + (a.y - c.y) ** 2, (b.x - c.x) ** 2 + (b.y - c.y) ** 2) < dab) ok = false; }
      if (ok) E.push([a, b, Math.sqrt(dab)]);
    }
    return E.sort((p, q) => p[2] - q[2]);
  };
  const usedNear = (x, y, r, mask) => { const k0 = kAt(x, y); if (k0 < 0) return false; const i0 = k0 % NX, j0 = Math.floor(k0 / NX), rr = Math.ceil(r / G); for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const i = i0 + di, j = j0 + dj; if (i >= 0 && j >= 0 && i < NX && j < NY && (used[j * NX + i] & mask)) return true; } return false; };
  for (const [a, b] of rng(towns.filter(t => t.k === 'muni' && t.pop >= 120000), 900)) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (usedNear(mx, my, 70, 4)) continue;
    const p = astar(nearestLand(a.x, a.y), nearestLand(b.x, b.y), 'nat');
    if (addRoad(p, 'nat', `国道${rno}号`, { lanes: 2 }).length) rno++;
  }
  log('nat', rno - 101);

  /* ---- 高速道路の出入口（IC）：近くの町ごとに。IC から県道で町へ ---- */
  const icNodes = [];
  const expSegs = segs.filter(s => s.cls === 'exp' && !s.urban);
  for (const t of towns.slice().sort((a, b) => (b.pop || 0) - (a.pop || 0) || (a.id < b.id ? -1 : 1))) {
    let best = null;
    for (const s of expSegs) s.P.forEach((p, i) => { if (i < 3 || i > s.P.length - 4) return; const dd = Math.hypot(p[0] - t.x, p[1] - t.y); if (!best || dd < best.d) best = { d: dd, p, s }; });
    if (!best || best.d > 60) continue;
    const minGap = Math.hypot(best.p[0], best.p[1]) < 700 ? 50 : 90;
    if (icNodes.some(q => Math.hypot(q.x - best.p[0], q.y - best.p[1]) < minGap)) continue;
    icNodes.push({ x: best.p[0], y: best.p[1], name: t.name + 'IC' });
    const s0 = nearestLand(best.p[0] + 3, best.p[1] + 3);
    if (s0 >= 0) { const p = astar(s0, -1, 'pref', kk => (used[kk] & 6) !== 0); if (p) addRoad(p, 'pref', '', { ends: [best.p, null], lanes: 2, icStart: true, noSplit: true }); }
  }
  // 都市高速の出入口（ランプ）：環状線の上に 3km くらいごと
  const c1Ramps = [];
  for (const s of C1) for (let i = 8; i < s.P.length - 8; i += 55) {
    const p = s.P[i]; if (c1Ramps.some(q => Math.hypot(q.x - p[0], q.y - p[1]) < 45)) continue;
    const t = nearTown(p[0], p[1]); c1Ramps.push({ x: p[0], y: p[1], name: (t ? t.name : '') + '出入口' });
    const s0 = nearestLand(p[0] + 2, p[1] + 2);
    if (s0 >= 0) { const q = astar(s0, -1, 'pref', kk => (used[kk] & 6) !== 0); if (q) addRoad(q, 'pref', '', { ends: [p, null], lanes: 2, icStart: true, noSplit: true }); }
  }
  log('ic', icNodes.length, 'ramps', c1Ramps.length);

  /* ---- 県道：となりあう町どうし（相対近傍グラフ）＋ 道路から遠い町 ---- */
  let pno = 1;
  for (const [a, b] of rng(towns, 520)) {
    const ka = nearestLand(a.x, a.y), kb = nearestLand(b.x, b.y); if (ka < 0 || kb < 0 || ka === kb) continue;
    const p = astar(ka, kb, 'pref');
    const main = Math.min(a.pop || 0, b.pop || 0) >= 50000;
    if (addRoad(p, 'pref', `県道${pno}号`, { lanes: main ? 2 : 1 }).length) pno++;
  }
  for (const t of towns) {
    const k = nearestLand(t.x, t.y); if (k < 0) continue;
    if (usedNear(t.x, t.y, 8, 6)) continue;
    const p = astar(k, -1, 'pref', kk => (used[kk] & 6) !== 0);
    if (addRoad(p, 'pref', `県道${pno}号`, { lanes: 1 }).length) pno++;
  }
  log('pref', pno - 1);

  /* ---- 市道：まちの中心から幹線道路がのび、そこから枝道、さらに細い道が入り組んで育つ ----
     道の先が、ほかの道に近づいたらそこでつながる（T字路）。人が少ないところ・水・山では止まる。決まった計算なので毎回同じ */
  const rnd = (a, b, c) => MapGen.hash3(Math.floor(a), Math.floor(b), c) / 4294967296;
  const GRID = new Map(), gk = (x, y) => Math.floor(x) + ',' + Math.floor(y);
  function index(rid, P, from) { for (let i = from || 0; i < P.length; i++) { const k = gk(P[i][0], P[i][1]); let a = GRID.get(k); if (!a) GRID.set(k, a = []); a.push([rid, P[i][0], P[i][1]]); } }
  // 近くの道の点（自分の道はのぞく）
  function near(x, y, r, self) {
    let best = null, bd = r * r;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const a = GRID.get(gk(x + dx, y + dy)); if (!a) continue;
      for (const q of a) { if (q[0] === self) continue; const d = (q[1] - x) * (q[1] - x) + (q[2] - y) * (q[2] - y); if (d < bd) { bd = d; best = q; } }
    }
    return best;
  }
  for (const sg of segs) if (sg.cls !== 'exp') index(sg.id, sg.P);          // 国道・県道にもつながるように（高速にはつながない）
  const byId = new Map(segs.map(s => [s.id, s]));
  const okLand = (x, y, e) => { const k = tile(x, y); if (k == null) return false; return 'PFBH'.includes(tT(k)) && ME[k] < e; };
  const isWater = (x, y) => { const k = tile(x, y); return k != null && 'RLSD'.includes(tT(k)); };
  // 高速の上（高架・盛土）には市道を通さない
  const nearExp = (x, y) => !!snapTo(x, y, 0.9, isExp);
  const KIND = {
    art: { dmin: 2.5, amp: 0.38, L: 46, snap: 1.6, cls: 'city', art: true, sp: 6, child: 'sec', maxLen: 260, bridge: 9, elev: 400 },
    sec: { dmin: 5, amp: 0.55, L: 24, snap: 1.4, cls: 'city', art: false, sp: 7, child: 'lane', maxLen: 48, bridge: 0, elev: 400 },
    lane: { dmin: 8, amp: 0.85, L: 11, snap: 1.2, cls: 'lane', art: false, sp: 0, child: null, maxLen: 15, bridge: 0, elev: 400 }
  };
  const fronts = [];
  const towns2 = towns.slice().sort((a, b) => (b.pop || 0) - (a.pop || 0) || (a.id < b.id ? -1 : 1));
  for (const t of towns2) {
    const pop = t.pop || 0; if (pop < 4000) continue;
    const n = pop > 150000 ? 7 : pop > 60000 ? 6 : pop > 20000 ? 5 : 3;
    const base = rnd(t.x, t.y, 31) * Math.PI * 2, R = 14 + 0.34 * Math.sqrt(pop);
    for (let k = 0; k < n; k++) fronts.push({ x: t.x + 0.5, y: t.y + 0.5, a: base + k * Math.PI * 2 / n + (rnd(t.x + k, t.y, 32) - 0.5) * 0.5, kind: 'art', maxLen: Math.min(260, R * 1.6), parent: null, seed: t.x * 31 + t.y * 17 + k });
  }
  let made = 0;
  const MAXR = opt.maxRoads || 9000;
  // 幹線 → 枝道 → 細い道 の順に育てる（同じ順なので、毎回同じ形）
  for (const kind of ['art', 'sec', 'lane']) {
    for (let qi = 0; qi < fronts.length && made < MAXR; qi++) {
      const f = fronts[qi]; if (f.kind !== kind || f.done) continue; f.done = true;
      const K = KIND[kind], rid = 'g' + (sid + 1);
      let x = f.x, y = f.y, a = f.a, len = 0, wet = 0, endHit = null;
      const a0 = f.a;                                     // もとの向き（くねっても、だいたいこの向きへ進む）
      // 枝は、親の道の線の上からはじめる
      if (f.parent) { const ps = byId.get(f.parent), sn = ps && snapTo(x, y, 1.5, s => s === ps); if (sn) { x = sn.x; y = sn.y; } }
      const P = [[x, y]], kids = [];
      // はじめの数マスが、ほかの道にくっついていないか
      if (f.parent && near(x + Math.cos(a) * 2, y + Math.sin(a) * 2, 1.3, f.parent)) continue;
      for (let st = 1; st < 400; st++) {
        // 向き＝もとの向き＋場所で決まるゆるいずれ（ぐるぐる回らない）。急に向きを変えないよう、少しずつ近づける
        const want = a0 + K.amp * fbmLite(x / K.L + (f.seed % 97) * 0.37, y / K.L, 41 + (kind === 'lane' ? 7 : kind === 'sec' ? 3 : 0));
        let da = want - a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        a += Math.max(-0.12, Math.min(0.12, da * 0.35));
        const nx = x + Math.cos(a), ny = y + Math.sin(a);
        if (!inBox(nx, ny)) break;
        const water = isWater(nx, ny);
        if (water) { if (++wet > K.bridge) break; }
        else { if (!okLand(nx, ny, K.elev) || tDens(nx, ny) < K.dmin) break; wet = 0; }
        if (kind !== 'art' && nearExp(nx, ny)) break;           // 幹線は高速の下をくぐれる。枝道・細い道はそこで止まる
        const h = st > 2 ? near(nx, ny, K.snap, rid) : null;
        if (h && h[0] !== f.parent || (h && st > 6)) { P.push([h[1], h[2]]); endHit = h; break; }
        P.push([nx, ny]); x = nx; y = ny; len += 1;
        if (len >= f.maxLen) break;
        // 枝を出す（人が多いほど、こまかく）
        if (K.child && st % K.sp === 0) {
          const dn = tDens(x, y);
          for (const side of [-1, 1]) {
            const pr = kind === 'art' ? 0.75 : Math.min(0.85, 0.25 + dn / 60);
            if (rnd(x * 7 + side, y * 5, 50 + st) < pr) {
              const ck = K.child, ca = a + side * (Math.PI / 2 + (rnd(x, y * 3 + side, 51) - 0.5) * (ck === 'lane' ? 1.1 : 0.6));
              kids.push({ x, y, a: ca, kind: ck, maxLen: KIND[ck].maxLen * (0.6 + 0.8 * rnd(x + 3, y, 52 + side)), parent: rid, seed: Math.floor(x * 13 + y * 7) });
            }
          }
        }
      }
      // 水の上で終わったら、その分はけずる
      while (P.length > 1 && isWater(P[P.length - 1][0], P[P.length - 1][1]) && !endHit) P.pop();
      if (P.length < (kind === 'lane' ? 3 : 4)) continue;
      const Q = resample(chaikin(P, 2), kind === 'lane' ? 0.7 : 0.8);
      sid++; made++;
      // 車線：幹線は片側2（都心は3）、枝道1、細い道0
      let lanes = kind === 'art' ? 2 : kind === 'sec' ? 1 : 0;
      if (kind === 'art') { let dsum = 0; for (let i = 0; i < Q.length; i += 6) dsum += tDens(Q[i][0], Q[i][1]); if (dsum / Math.ceil(Q.length / 6) > 70) lanes = 3; }
      const s = { id: rid, cls: K.cls, name: '', lanes, P: Q, art: K.art };
      segs.push(s); byId.set(rid, s); indexEdges(s);
      index(rid, Q);
      for (const k of kids) fronts.push(k);
    }
  }
  log('streets', made);

  /* ---- 交差点でわけて、道路のグラフにする。車線は切ったあとに決める（高速・国道は人の多いところで片側3）---- */
  // 道にそって前後 25 マスの人の多さの平均
  function winDens(P, s) {
    let t = 0, n = 0;
    for (let i = 0; i < s.P.length; i += 4) {
      const p = s.P[i]; let near = false;
      for (let j = 0; j < P.length; j += 3) if (Math.abs(P[j][0] - p[0]) + Math.abs(P[j][1] - p[1]) < 25) { near = true; break; }
      if (near) { t += tDens(p[0], p[1]); n++; }
    }
    return n ? t / n : 0;
  }
  const lanesOf = p => {
    const s = p.s;
    if (s.cls === 'exp') return s.urban ? 2 : winDens(p.P, s) > 12 ? 3 : 2;
    if (s.cls === 'nat') return winDens(p.P, s) > 45 ? 3 : 2;
    return s.lanes == null ? 1 : s.lanes;
  };
  const G2 = planarize(segs, { ic: icNodes.concat(c1Ramps), towns, nearTown, log, lanesOf });
  log('graph', G2.segs.length, 'nodes', G2.nodes.length);
  return G2;
}

/* 交差点（はしがほかの道の上にあるところ・道どうしが交わるところ）で線を切って、点（node）と線（seg）のグラフにする
   高速とほかの道は交わらない（立体交差）。高速どうしは JCT、IC（はしが高速の上にある県道）は IC */
function planarize(segs, o) {
  const log = o.log || (() => {});
  // 切るところ：seg ごとに [{ e: 線分の番号, t: 0〜1, x, y, key }]
  const cuts = new Map(segs.map(s => [s, []]));
  // 線分の索引
  const EI = new Map();
  for (const s of segs) {
    const P = s.P;
    for (let e = 0; e + 1 < P.length; e++) {
      const x0 = Math.floor(Math.min(P[e][0], P[e + 1][0]) / 2), x1 = Math.floor(Math.max(P[e][0], P[e + 1][0]) / 2);
      const y0 = Math.floor(Math.min(P[e][1], P[e + 1][1]) / 2), y1 = Math.floor(Math.max(P[e][1], P[e + 1][1]) / 2);
      for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) { const key = a + ',' + b; let L = EI.get(key); if (!L) EI.set(key, L = []); L.push([s, e]); }
    }
  }
  const canMeet = (a, b, icEnd) => (a.cls === 'exp') === (b.cls === 'exp') || icEnd;
  // 1) はしの点が、ほかの道の上（0.25マス以内）にある
  for (const s of segs) {
    for (const end of [0, 1]) {
      const p = end ? s.P[s.P.length - 1] : s.P[0], icEnd = end === 0 && s.icStart;
      let best = null;
      for (let a = Math.floor((p[0] - 0.3) / 2); a <= Math.floor((p[0] + 0.3) / 2); a++) for (let b = Math.floor((p[1] - 0.3) / 2); b <= Math.floor((p[1] + 0.3) / 2); b++) {
        const L = EI.get(a + ',' + b); if (!L) continue;
        for (const [q, e] of L) {
          if (q === s || !canMeet(s, q, icEnd)) continue;
          const pr = projSeg(p[0], p[1], q.P[e][0], q.P[e][1], q.P[e + 1][0], q.P[e + 1][1]);
          if (pr.d < 0.25 && (!best || pr.d < best.d)) best = { q, e, t: pr.t, x: pr.x, y: pr.y, d: pr.d };
        }
      }
      if (best) {
        cuts.get(best.q).push({ e: best.e, t: best.t, x: best.x, y: best.y });
        if (end) s.P[s.P.length - 1] = [best.x, best.y]; else s.P[0] = [best.x, best.y];
        if (icEnd) s.icAt = [best.x, best.y];
      }
    }
  }
  // 2) 道どうしが交わる
  const seenPair = new Set();
  for (const L of EI.values()) {
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const [s, e] = L[i], [q, f] = L[j];
      if (s === q || !canMeet(s, q, false)) continue;
      const key = s.id < q.id ? s.id + ':' + e + '|' + q.id + ':' + f : q.id + ':' + f + '|' + s.id + ':' + e;
      if (seenPair.has(key)) continue; seenPair.add(key);
      const c = crossSeg(s.P[e][0], s.P[e][1], s.P[e + 1][0], s.P[e + 1][1], q.P[f][0], q.P[f][1], q.P[f + 1][0], q.P[f + 1][1]);
      if (!c) continue;
      cuts.get(s).push({ e, t: c.t, x: c.x, y: c.y });
      cuts.get(q).push({ e: f, t: c.u, x: c.x, y: c.y });
    }
  }
  // 3) 点をつくる（0.5マス以内の点はまとめる）
  const nodes = [], NI = new Map();
  function nodeAt(x, y) {
    const a = Math.floor(x), b = Math.floor(y);
    for (let i = a - 1; i <= a + 1; i++) for (let j = b - 1; j <= b + 1; j++) {
      const L = NI.get(i + ',' + j); if (!L) continue;
      for (const n of L) if (Math.hypot(n.x - x, n.y - y) < 0.5) return n;
    }
    const n = { id: nodes.length + 1, x, y, segs: [] }; nodes.push(n);
    const k = a + ',' + b; let L = NI.get(k); if (!L) NI.set(k, L = []); L.push(n);
    return n;
  }
  // 4) 切る
  const out = [];
  for (const s of segs) {
    const cs = cuts.get(s).sort((p, q) => p.e - q.e || p.t - q.t);
    let cur = [s.P[0]], n0 = nodeAt(s.P[0][0], s.P[0][1]), e0 = 0;
    const flush = (n1, pts) => {
      if (n1 === n0) return;                                   // 同じ点にもどる短い切れはし
      const len = plen(pts);
      if (len < 0.35) return;
      const piece = { s, n0, n1, P: pts, len };
      out.push(piece); n0.segs.push(piece); n1.segs.push(piece);
    };
    for (const c of cs) {
      for (let k = e0 + 1; k <= c.e; k++) cur.push(s.P[k]);
      const n = nodeAt(c.x, c.y);
      if (n === n0) { cur = [[n.x, n.y]]; e0 = c.e; continue; }
      cur.push([c.x, c.y]);
      flush(n, cur);
      n0 = n; cur = [[c.x, c.y]]; e0 = c.e;
    }
    for (let k = e0 + 1; k < s.P.length; k++) cur.push(s.P[k]);
    const last = s.P[s.P.length - 1], nl = nodeAt(last[0], last[1]);
    if (cur.length >= 2) flush(nl, cur);
  }
  // はしの点は、まとめた点の場所にそろえる
  for (const p of out) { p.P[0] = [p.n0.x, p.n0.y]; p.P[p.P.length - 1] = [p.n1.x, p.n1.y]; }
  // 点の種類と名前
  const icList = o.ic || [];
  const used = nodes.filter(n => n.segs.length);
  const idMap = new Map(); used.forEach((n, i) => idMap.set(n, i + 1));
  const nodesOut = used.map(n => {
    const ne = n.segs.filter(p => p.s.cls === 'exp').length, no = n.segs.length - ne;
    let kind = n.segs.length === 1 ? 'end' : 'x', name = '';
    if (ne >= 2 && no === 0 && new Set(n.segs.map(p => p.s.name)).size >= 2) { kind = 'jct'; const t = o.nearTown(n.x, n.y); name = (t ? t.name : '') + 'JCT'; }
    else if (ne >= 1 && no >= 1) { kind = 'ic'; let b = null, bd = Infinity; for (const q of icList) { const d = Math.hypot(q.x - n.x, q.y - n.y); if (d < bd) { bd = d; b = q; } } name = b && bd < 5 ? b.name : ((o.nearTown(n.x, n.y) || {}).name || '') + 'IC'; }
    return { id: idMap.get(n), kind, name, x: r2(n.x), y: r2(n.y) };
  });
  // JCT の名前がかぶったら「東・西…」
  const seenN = new Map();
  for (const n of nodesOut) { if (n.kind !== 'jct' && n.kind !== 'ic') continue; const c = seenN.get(n.name) || 0; seenN.set(n.name, c + 1); if (c) n.name = ['', '東', '西', '南', '北', '新', '中'][Math.min(6, c)] + n.name; }
  let pid = 0;
  const segsOut = out.map(p => {
    const lanes = o.lanesOf ? o.lanesOf(p) : (p.s.lanes == null ? 1 : p.s.lanes);
    return { id: 'g' + (++pid), cls: p.s.cls, name: p.s.name || '', lanes, w: r2(roadW(p.s.cls, lanes)), vlim: p.s.urban ? 80 : roadV(p.s.cls, lanes),
      art: !!p.s.art, urban: !!p.s.urban, pts: flat(p.P), len: Math.round(p.len * 10) / 10, n0: idMap.get(p.n0), n1: idMap.get(p.n1) };
  });
  log('planarize', segs.length, '→', segsOut.length);
  return { segs: segsOut, nodes: nodesOut };
}
// 川のまん中の点（河口から内陸へ s）
function riverPoint(W, r, s) {
  const u = r.cu - s, v = W.riverV ? W.riverV(r, s) : r.m;
  return [(u + v) * SQ, (u - v) * SQ];
}
// 小さいノイズ（市道のくねり用）
function fbmLite(x, y, s) {
  const h = (a, b) => (MapGen.hash3(a, b, s) / 4294967296) * 2 - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const RoadGen = { build, planarize, simplify, chaikin, resample, roadW, roadV, riverPoint };
if (typeof module !== 'undefined' && module.exports) module.exports = RoadGen; else root.RoadGen = RoadGen;
})(typeof self !== 'undefined' ? self : this);
