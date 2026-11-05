/* ===== 風の芽経済組：国土の地図 3D の建物（t65）=====
   建物の見た目（超リアル派）：プリセット（kind）→ 型（arch）→ 見た目（look。1〜10）を組み立てる
   ・型：M3A.arch('名前', { looks: [{ n: '見た目の名前', …えらぶもの }], build(B, L, P) { … } })
       looks の n は 画面に出す名前（日本語・短く。実在の会社・お店・商品・建物の名前や、それとわかる見た目は使わない）
       build：B（組み立ての道具）・L（えらばれた見た目）・P（建物のこと）
   ・プリセット → 型：M3A.kinds({ kind: '型' | ['型', { …型に渡すもの（P.ko） }] })
   ・座標はメートル。建物の区画の北西のかど が原点。x は東・z は南・y は上（地面のいちばん高いところが 0）
   ・まわりの線（loops）は 外側が 画面で時計まわり（東へ進むとき 右が建物の中）。穴（中庭）は逆まわり。辺の外向きは (dz, -dx)
   ・色は [r, g, b]（0〜1）か '#rrggbb'。質感（テクスチャ）は キャンバスに描く（M3A.tex）。同じ質感の面は 1つのメッシュに
   map3d.js の m3Blds が 建物ごとに M3A.build を呼び、さいごに M3A.flush でメッシュにする */
(function () {
'use strict';
const A = window.M3A = window.M3A || {};
A.v = 1;
A.ARCH = A.ARCH || {}; A.KIND = A.KIND || {};
const MAT = A.MAT = A.MAT || new Map();   // 質感：名前 → { w, h, draw, o, m（three.js の material） }
A.U = 1 / 50;                             // 1m → マス（ワールドの単位）
A.tq = 1;                                 // 質感のこまかさ（画質の設定：省エネ 0.5・ふつう 1・最高 2）
A.arch = (n, d) => { d.name = n; A.ARCH[n] = d; return d; };
A.kinds = o => { for (const k in o) { const v = o[k]; A.KIND[k] = Array.isArray(v) ? { a: v[0], o: v[1] || {} } : { a: v, o: {} }; } };
A.pOf = A.pOf || (() => null);            // プリセット（map3d.js・ためし見のページが入れる）

/* ---------- 乱数・色 ---------- */
A.rng = seed => { let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
A.hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const CC = new Map();
const col = c => { if (typeof c !== 'string') return c || [1, 1, 1]; let v = CC.get(c); if (!v) { let m;   // '#rrggbb'・'#rgb'・'rgb(a)(r, g, b[, a])'
    if (c[0] === '#' && c.length === 4) v = [parseInt(c[1] + c[1], 16) / 255, parseInt(c[2] + c[2], 16) / 255, parseInt(c[3] + c[3], 16) / 255];
    else if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c))) v = [Math.min(255, +m[1]) / 255, Math.min(255, +m[2]) / 255, Math.min(255, +m[3]) / 255];
    else { const n = parseInt(c.slice(1), 16); v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    if (v.some(x => !(x >= 0))) v = [1, 1, 1];
    CC.set(c, v); } return v; };
A.col = col;
A.mul = (c, k) => { const v = col(c); return [v[0] * k, v[1] * k, v[2] * k]; };
A.mix = (a, b, t) => { const p = col(a), q = col(b); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; };
A.pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];
const WHITE = [1, 1, 1];

/* ---------- 形（footprint） ----------
   A.foot(cells)：区画 [[X, Y], …]（10m 四方の番号）→ F
   F = { loops, edges, rects（重ならない長方形）, maxr（重なってよい いちばん大きな長方形：屋根に）, bb: [x0, z0, x1, z1], w, d, area, n（区画の数）, X0, Y0, cs }
   edges：[{ ax, az, bx, bz, nx, nz, L, u0（まわりの線にそった長さ。はじめ）, li（何番目の線）, out（外側の線なら true）}]
   A.inset(F, d)：内がわへ d m（マイナスなら外へ）。せまくて つぶれるときは 小さくする */
function simp(l) {   // 同じ向きに続く点をのぞく
  const o = [];
  for (let i = 0; i < l.length; i++) {
    const p = l[(i + l.length - 1) % l.length], c = l[i], n = l[(i + 1) % l.length];
    const d1x = Math.sign(c[0] - p[0]), d1z = Math.sign(c[1] - p[1]), d2x = Math.sign(n[0] - c[0]), d2z = Math.sign(n[1] - c[1]);
    if (d1x === d2x && d1z === d2z) continue;
    o.push(c);
  }
  return o;
}
function loopsOfCells(set, cells) {
  const out = new Map(), add = (x0, y0, x1, y1) => { const k = x0 + ',' + y0; let l = out.get(k); if (!l) out.set(k, l = []); l.push([x1, y1]); };
  for (const [x, y] of cells) {
    if (!set.has(x + ',' + (y - 1))) add(x, y, x + 1, y);
    if (!set.has((x + 1) + ',' + y)) add(x + 1, y, x + 1, y + 1);
    if (!set.has(x + ',' + (y + 1))) add(x + 1, y + 1, x, y + 1);
    if (!set.has((x - 1) + ',' + y)) add(x, y + 1, x, y);
  }
  const loops = [];
  while (out.size) {
    const k0 = out.keys().next().value, i0 = k0.indexOf(','), sx = +k0.slice(0, i0), sy = +k0.slice(i0 + 1);
    let x = sx, y = sy, pd = null; const pts = [];
    for (let g = 0; g < 200000; g++) {
      const k = x + ',' + y, l = out.get(k); if (!l || !l.length) break;
      let j = 0;
      if (l.length > 1 && pd) { const rx = -pd[1], ry = pd[0]; j = l.findIndex(q => q[0] - x === rx && q[1] - y === ry); if (j < 0) j = 0; }   // 角でふれあうところは 右へ（中がわへ）
      const nx = l[j][0], ny = l[j][1]; l.splice(j, 1); if (!l.length) out.delete(k);
      pts.push([x, y]); pd = [nx - x, ny - y]; x = nx; y = ny;
      if (x === sx && y === sy) break;
    }
    if (pts.length >= 4) loops.push(simp(pts));
  }
  return loops;
}
function insetLoop(l, d) {
  const n = l.length, N = [];
  for (let i = 0; i < n; i++) { const a = l[i], b = l[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; N.push([dz / L, -dx / L]); }
  const o = [];
  for (let i = 0; i < n; i++) { const p = l[i], n1 = N[(i + n - 1) % n], n2 = N[i];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    if (Math.abs(dot) < 1e-6) o.push([p[0] - d * (n1[0] + n2[0]), p[1] - d * (n1[1] + n2[1])]);   // 直角
    else { const sx = n1[0] + n2[0], sz = n1[1] + n2[1], k = d / (1 + dot); o.push([p[0] - k * sx, p[1] - k * sz]); }   // ななめ（まれ）
  }
  return o;
}
function gridOf(loops) {   // 座標をまとめた目（中か外か）
  const xs = [...new Set(loops.flatMap(l => l.map(p => p[0])))].sort((a, b) => a - b), zs = [...new Set(loops.flatMap(l => l.map(p => p[1])))].sort((a, b) => a - b);
  const V = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length]; if (Math.abs(a[0] - b[0]) < 1e-9) V.push([a[0], Math.min(a[1], b[1]), Math.max(a[1], b[1])]); }
  const nx = xs.length - 1, nz = zs.length - 1, occ = new Uint8Array(Math.max(0, nx * nz));
  for (let j = 0; j < nz; j++) { const cz = (zs[j] + zs[j + 1]) / 2;
    for (let i = 0; i < nx; i++) { const cx = (xs[i] + xs[i + 1]) / 2; let c = 0; for (const v of V) if (v[0] > cx && cz > v[1] && cz < v[2]) c++; occ[j * nx + i] = c & 1; } }
  return { xs, zs, occ, nx, nz };
}
function rectsOf(G) {
  const { xs, zs, occ, nx, nz } = G, rects = []; let prev = [];
  for (let j = 0; j < nz; j++) {
    const runs = [];
    for (let i = 0; i < nx;) { if (!occ[j * nx + i]) { i++; continue; } let k = i; while (k + 1 < nx && occ[j * nx + k + 1]) k++; runs.push([i, k]); i = k + 1; }
    const next = [];
    for (const [i0, i1] of runs) { const o = prev.find(r => r.i0 === i0 && r.i1 === i1); if (o) { o.j1 = j; next.push(o); } else { const r = { i0, i1, j0: j, j1: j }; rects.push(r); next.push(r); } }
    prev = next;
  }
  return rects.map(r => [xs[r.i0], zs[r.j0], xs[r.i1 + 1], zs[r.j1 + 1]]);
}
function maxRectsOf(G) {
  const { xs, zs, occ, nx, nz } = G, out = [];
  const okR = (i0, i1, j) => { if (j < 0 || j >= nz) return false; for (let i = i0; i <= i1; i++) if (!occ[j * nx + i]) return false; return true; };
  const okC = (j0, j1, i) => { if (i < 0 || i >= nx) return false; for (let j = j0; j <= j1; j++) if (!occ[j * nx + i]) return false; return true; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx;) { if (!occ[j * nx + i]) { i++; continue; } let k = i; while (k + 1 < nx && occ[j * nx + k + 1]) k++; let a = j, b = j; while (okR(i, k, a - 1)) a--; while (okR(i, k, b + 1)) b++; out.push([i, a, k, b]); i = k + 1; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz;) { if (!occ[j * nx + i]) { j++; continue; } let k = j; while (k + 1 < nz && occ[(k + 1) * nx + i]) k++; let a = i, b = i; while (okC(j, k, a - 1)) a--; while (okC(j, k, b + 1)) b++; out.push([a, j, b, k]); j = k + 1; }
  const U = [];
  for (const r of out) {
    if (U.some(q => q[0] <= r[0] && q[1] <= r[1] && q[2] >= r[2] && q[3] >= r[3])) continue;
    for (let t = U.length - 1; t >= 0; t--) { const q = U[t]; if (r[0] <= q[0] && r[1] <= q[1] && r[2] >= q[2] && r[3] >= q[3]) U.splice(t, 1); }
    U.push(r);
  }
  return U.map(r => [xs[r[0]], zs[r[1]], xs[r[2] + 1], zs[r[3] + 1]]);
}
function mkFoot(loops, ex) {
  const G = gridOf(loops), rects = rectsOf(G);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, area = 0;
  for (const r of rects) { x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]); x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]); area += (r[2] - r[0]) * (r[3] - r[1]); }
  const edges = [];
  loops.forEach((l, li) => {
    let s = 0, sg = 0;   // 外側（時計まわり）か：面積の符号
    for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length]; sg += a[0] * b[1] - b[0] * a[1]; }
    for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue;
      edges.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / L, nz: -dx / L, L, u0: s, li, out: sg > 0 }); s += L;
    }
  });
  const F = Object.assign({ loops, edges, rects, G, bb: [x0, z0, x1, z1], w: x1 - x0, d: z1 - z0, area }, ex);
  Object.defineProperty(F, 'maxr', { get() { return this._mr || (this._mr = maxRectsOf(this.G)); } });
  return F;
}
A.foot = (cells, cs = 10) => {
  let X0 = Infinity, Y0 = Infinity; for (const c of cells) { if (c[0] < X0) X0 = c[0]; if (c[1] < Y0) Y0 = c[1]; }
  const rel = cells.map(c => [c[0] - X0, c[1] - Y0]), set = new Set(rel.map(c => c[0] + ',' + c[1]));
  const loops = loopsOfCells(set, rel).map(l => l.map(p => [p[0] * cs, p[1] * cs]));
  return mkFoot(loops, { n: cells.length, X0, Y0, cs, cells: rel });
};
A.inset = (F, d) => {
  if (!d) return F;
  for (let t = 0; t < 4; t++, d /= 2) {
    const L2 = F.loops.map(l => insetLoop(l, d));
    let ok = true;   // 辺の向きが 逆になったら つぶれている
    for (let k = 0; k < L2.length && ok; k++) { const a = F.loops[k], b = L2[k]; for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; if ((a[j][0] - a[i][0]) * (b[j][0] - b[i][0]) + (a[j][1] - a[i][1]) * (b[j][1] - b[i][1]) <= 1e-6) { ok = false; break; } } }
    if (ok) return mkFoot(L2, { n: F.n, X0: F.X0, Y0: F.Y0, cs: F.cs, cells: F.cells, base: F.base || F, ins: (F.ins || 0) + d });
  }
  return F;
};
// 長方形 r = [x0, z0, x1, z1] を d m 内がわへ
A.rin = (r, d) => [r[0] + d, r[1] + d, r[2] - d, r[3] - d];
// 道に面した辺（P.front：[nx, nz]）にいちばん合う、外側の長い辺
A.frontEdge = (F, fr) => { const f = fr || [0, 1]; let best = null, bs = -Infinity; for (const e of F.edges) { if (!e.out) continue; const s = (e.nx * f[0] + e.nz * f[1]) * 3 + Math.min(e.L, 30) / 10; if (s > bs) { bs = s; best = e; } } return best || F.edges[0]; };

/* ---------- 組み立ての道具（B） ----------
   頂点：位置3・法線3・色3・UV2（11）。質感の名前ごとに たまる（B.buf）
   B.ox, B.oz, B.oy：原点のワールド座標（マス）。B.s：1m のマス（A.U）
   B.jit：建物ごとの明るさのばらつき。B.top：いちばん高いところ（m。名前の高さに） */
function Buf() { this.a = new Float32Array(4096); this.n = 0; }
Buf.prototype.need = function (k) { if (this.n + k > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k + 4096)); b.set(this.a.subarray(0, this.n)); this.a = b; } };
function Builder() { this.bk = new Map(); this.ox = 0; this.oy = 0; this.oz = 0; this.s = A.U; this.top = 0; this.jit = 1; this.nv = 0; this.rc = 1; this.rs = 0; }   // rc・rs：ななめの建物の回転（cos・sin。t65）
A.Builder = Builder;
const BP = Builder.prototype;
BP.buf = function (m) { let b = this.bk.get(m); if (!b) this.bk.set(m, b = new Buf()); return b; };
BP.mark = function () { const k = new Map(); for (const [m, b] of this.bk) k.set(m, b.n); return k; };
BP.undo = function (k) { for (const [m, b] of this.bk) b.n = k.has(m) ? k.get(m) : 0; };
// 3角形（a, b, c：[x, y, z]。n：法線（なければ 右ねじで (b-a)×(c-a)）。c0：色。uv：[ua, va, ub, vb, uc, vc]。k：頂点ごとの明るさ [ka, kb, kc]）
BP.tri = function (m, a, b, c, n, c0, uv, k) {
  if (!n) { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); n = L > 1e-12 ? [nx / L, ny / L, nz / L] : [0, 1, 0]; }   // つぶれた三角は上向き（法線 0 だと黒くなる）
  const B = this.buf(m); B.need(33); const o = B.a, s = this.s, cc = col(c0), j = this.jit, rc = this.rc, rs = this.rs;
  const P = [a, b, c], nx = n[0] * rc - n[2] * rs, nz = n[0] * rs + n[2] * rc;
  for (let i = 0; i < 3; i++) {
    const p = P[i], q = B.n, kk = (k ? k[i] : 1) * j;
    o[q] = this.ox + (p[0] * rc - p[2] * rs) * s; o[q + 1] = this.oy + p[1] * s; o[q + 2] = this.oz + (p[0] * rs + p[2] * rc) * s;
    o[q + 3] = nx; o[q + 4] = n[1]; o[q + 5] = nz;
    o[q + 6] = cc[0] * kk; o[q + 7] = cc[1] * kk; o[q + 8] = cc[2] * kk;
    o[q + 9] = uv ? uv[i * 2] : 0; o[q + 10] = uv ? uv[i * 2 + 1] : 0;
    B.n = q + 11; if (p[1] > this.top) this.top = p[1];
  }
  this.nv += 3;
};
// 4角形（a→b→c→d の順。法線は 右ねじで (b-a)×(c-a)＝外から見て 反時計まわり）。uv：[u0, v0, u1, v1]（a=(u0,v0)・b=(u1,v0)・c=(u1,v1)・d=(u0,v1)）か 8つ
BP.quad = function (m, a, b, c, d, n, c0, uv, k) {
  let U;
  if (!uv) U = null; else if (uv.length === 4) U = [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]]; else U = uv;
  if (!n) {   // (b-a)×(c-a)。b と c が同じ点（三角の4角形：寄棟の妻など）なら (c-a)×(d-a)、それもだめなら (b-a)×(d-a)
    const cr = (p, q) => { const ux = p[0] - a[0], uy = p[1] - a[1], uz = p[2] - a[2], vx = q[0] - a[0], vy = q[1] - a[1], vz = q[2] - a[2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
    let v = cr(b, c), L = Math.hypot(v[0], v[1], v[2]);
    if (L < 1e-12) { v = cr(c, d); L = Math.hypot(v[0], v[1], v[2]); }
    if (L < 1e-12) { v = cr(b, d); L = Math.hypot(v[0], v[1], v[2]); }
    n = L > 1e-12 ? [v[0] / L, v[1] / L, v[2] / L] : [0, 1, 0];
  }
  const ka = k ? k[0] : 1, kb = k ? k[1] : 1, kc = k ? k[2] : 1, kd = k ? k[3] : 1;
  this.tri(m, a, b, c, n, c0, U ? [U[0], U[1], U[2], U[3], U[4], U[5]] : null, [ka, kb, kc]);
  this.tri(m, a, c, d, n, c0, U ? [U[0], U[1], U[4], U[5], U[6], U[7]] : null, [ka, kc, kd]);
};
// 壁（辺 a→b の外向きに向く。y0〜y1）。uv：[u0, u1, v0, v1]。ao：下のはしの暗さ（地面の近く。0.8 など）
BP.wall = function (m, ax, az, bx, bz, y0, y1, c0, uv, ao) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, n = [dz / L, 0, -dx / L], kb = ao || 1;
  const u0 = uv ? uv[0] : 0, u1 = uv ? uv[1] : 0, v0 = uv ? uv[2] : 0, v1 = uv ? uv[3] : 0;
  // 頂点の順は 外から見て反時計まわり（法線と合わせる。両面の質感は 裏から見ると 法線を逆にして光をあてるので）
  this.quad(m, [ax, y0, az], [ax, y1, az], [bx, y1, bz], [bx, y0, bz], n, c0, [u0, v0, u0, v1, u1, v1, u1, v0], [kb, 1, 1, kb]);
};
// 辺 e にそった壁（e.L 分。外向き）。o：{ uv: [u0, u1, v0, v1], ao, from, to（辺のはじめから何 m〜何 m だけ）, off（外へ ずらす m）}
BP.wallE = function (m, e, y0, y1, c0, o = {}) {
  const t0 = (o.from || 0) / e.L, t1 = (o.to == null ? e.L : o.to) / e.L, f = o.off || 0;
  const ax = e.ax + (e.bx - e.ax) * t0 + e.nx * f, az = e.az + (e.bz - e.az) * t0 + e.nz * f, bx = e.ax + (e.bx - e.ax) * t1 + e.nx * f, bz = e.az + (e.bz - e.az) * t1 + e.nz * f;
  this.wall(m, ax, az, bx, bz, y0, y1, c0, o.uv, o.ao);
};
// 窓のならぶ壁（ファサード）：辺ごとに、柱間 bw m ちかくの数で わりきる（かどで窓が切れない）
//   o：{ bw（柱間 m）, fh（階の高さ m）, tb（質感の中の 柱間の数）, tf（質感の中の 階の数）, vy（1階の床の y。v の0）, ao, only(e)（この辺だけ）, off, c（色）}
BP.facade = function (m, F, y0, y1, o = {}) {
  const bw = o.bw || 3.2, fh = o.fh || 3.0, tb = o.tb || 1, tf = o.tf || 1, vy = o.vy || 0;
  const es = F.edges || F;
  for (const e of es) {
    if (o.only && !o.only(e)) continue;
    const nb = Math.max(1, Math.round(e.L / bw)), u1 = nb / tb, v0 = (y0 - vy) / fh / tf, v1 = (y1 - vy) / fh / tf;
    this.wallE(m, e, y0, y1, o.c || WHITE, { uv: [0, u1, v0, v1], ao: o.ao, off: o.off });
  }
};
// 平らな四角（上向き。r：[x0, z0, x1, z1]）。o：{ su, sv（質感 1枚の m）, down（下向き）, k（明るさ）}
BP.flat = function (m, r, y, c0, o = {}) {
  const su = o.su || 0, sv = o.sv || su, uv = su ? [r[0] / su, r[1] / sv, r[2] / su, r[3] / sv] : null;
  if (o.down) this.quad(m, [r[0], y, r[1]], [r[2], y, r[1]], [r[2], y, r[3]], [r[0], y, r[3]], [0, -1, 0], c0, uv);
  else this.quad(m, [r[0], y, r[3]], [r[2], y, r[3]], [r[2], y, r[1]], [r[0], y, r[1]], [0, 1, 0], c0, uv ? [uv[0], uv[3], uv[2], uv[1]] : null, o.k);
};
// 形 F の床・屋上（長方形ごと）
BP.cap = function (m, F, y, c0, o = {}) { for (const r of (F.rects || F)) this.flat(m, r, y, c0, o); };
// 形 F をのばした立体（まわりの壁 y0〜y1 と 上のふた）。o：{ mt（ふたの質感）, ct, uv: 'm'（壁の uv を m で。su, sv）, ao, notop }
BP.ext = function (m, F, y0, y1, c0, o = {}) {
  for (const e of F.edges) this.wallE(m, e, y0, y1, c0, { ao: o.ao, uv: o.su ? [e.u0 / o.su, (e.u0 + e.L) / o.su, y0 / (o.sv || o.su), y1 / (o.sv || o.su)] : null });
  if (!o.notop) this.cap(o.mt || m, F, y1, o.ct || c0, { su: o.tsu });
};
// 箱（x0, z0, x1, z1, y0〜y1）。o：{ mt, ct（上）, bottom, su, sv（壁の質感 1枚の m）, tsu, ao }
BP.box = function (m, x0, z0, x1, z1, y0, y1, c0, o = {}) {
  const su = o.su, sv = o.sv || su, U = (a, b) => su ? [a / su, b / su, y0 / sv, y1 / sv] : null, w = x1 - x0, d = z1 - z0;
  this.wall(m, x0, z0, x1, z0, y0, y1, c0, U(0, w), o.ao); this.wall(m, x1, z0, x1, z1, y0, y1, c0, U(0, d), o.ao);
  this.wall(m, x1, z1, x0, z1, y0, y1, c0, U(0, w), o.ao); this.wall(m, x0, z1, x0, z0, y0, y1, c0, U(0, d), o.ao);
  this.flat(o.mt || m, [x0, z0, x1, z1], y1, o.ct || c0, { su: o.tsu });
  if (o.bottom) this.flat(o.mt || m, [x0, z0, x1, z1], y0, o.ct || c0, { down: true });
};
// 向きのある箱（まん中 cx, cz・向き ang（x 軸から。ラジアン）・長さ L・はば W）
BP.obox = function (m, cx, cz, ang, L, W, y0, y1, c0, o = {}) {
  const c = Math.cos(ang), s = Math.sin(ang), P = (u, w) => [cx + c * u - s * w, cz + s * u + c * w];
  const p = [P(-L / 2, -W / 2), P(L / 2, -W / 2), P(L / 2, W / 2), P(-L / 2, W / 2)];
  // 時計まわり（画面）に：-W/2 がわ（北がわ）を東へ
  const su = o.su, sv = o.sv || su;
  for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4], Ls = i % 2 ? W : L; this.wall(m, a[0], a[1], b[0], b[1], y0, y1, c0, su ? [0, Ls / su, y0 / sv, y1 / sv] : null, o.ao); }
  this.quad(o.mt || m, [p[3][0], y1, p[3][1]], [p[2][0], y1, p[2][1]], [p[1][0], y1, p[1][1]], [p[0][0], y1, p[0][1]], [0, 1, 0], o.ct || c0, o.tsu ? [0, 0, L / o.tsu, W / o.tsu] : null);
};
// 円柱（まわり n 面）。o：{ mt, ct（上）, su, sv（まわりの質感 1枚の m）, notop }
BP.cyl = function (m, cx, cz, r, y0, y1, n, c0, o = {}) {
  n = n || 12; const C = 2 * Math.PI * r, su = o.su || 0, sv = o.sv || su;
  for (let i = 0; i < n; i++) {
    const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2, tm = (t0 + t1) / 2;
    const a = [cx + Math.cos(t0) * r, cz + Math.sin(t0) * r], b = [cx + Math.cos(t1) * r, cz + Math.sin(t1) * r];
    const N0 = [Math.cos(t0), 0, Math.sin(t0)], N1 = [Math.cos(t1), 0, Math.sin(t1)];
    const u0 = su ? (i / n) * C / su : 0, u1 = su ? ((i + 1) / n) * C / su : 0, v0 = sv ? y0 / sv : 0, v1 = sv ? y1 / sv : 0;
    // なめらかに（頂点ごとの法線）
    this.tri(m, [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [Math.cos(tm), 0, Math.sin(tm)], c0, [u0, v0, u0, v1, u1, v1]);
    this.tri(m, [a[0], y0, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], [Math.cos(tm), 0, Math.sin(tm)], c0, [u0, v0, u1, v1, u1, v0]);
    if (!o.notop) this.tri(o.mt || m, [cx, y1, cz], [b[0], y1, b[1]], [a[0], y1, a[1]], [0, 1, 0], o.ct || c0);
    void N0; void N1;
  }
};
// 円すい（y0 の円 → y1 の点）・ドーム（だ円の半球。rx, rz・高さ h）
BP.cone = function (m, cx, cz, r, y0, y1, n, c0) {
  n = n || 12;
  for (let i = 0; i < n; i++) { const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2; this.tri(m, [cx + Math.cos(t0) * r, y0, cz + Math.sin(t0) * r], [cx, y1, cz], [cx + Math.cos(t1) * r, y0, cz + Math.sin(t1) * r], null, c0); }
};
BP.dome = function (m, cx, cz, rx, rz, y0, h, n, c0, o = {}) {
  n = n || 12; const rings = o.rings || 4;
  for (let j = 0; j < rings; j++) {
    const a0 = j / rings * Math.PI / 2, a1 = (j + 1) / rings * Math.PI / 2, c0r = Math.cos(a0), c1r = Math.cos(a1), s0 = Math.sin(a0), s1 = Math.sin(a1);
    for (let i = 0; i < n; i++) {
      const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2;
      const P = (t, cr, sr) => [cx + Math.cos(t) * rx * cr, y0 + h * sr, cz + Math.sin(t) * rz * cr];
      const p00 = P(t0, c0r, s0), p10 = P(t1, c0r, s0), p01 = P(t0, c1r, s1), p11 = P(t1, c1r, s1);
      const tm = (t0 + t1) / 2, am = (a0 + a1) / 2, nn = [Math.cos(tm) * Math.cos(am) / rx, Math.sin(am) / h, Math.sin(tm) * Math.cos(am) / rz], L = Math.hypot(nn[0], nn[1], nn[2]);
      const N = [nn[0] / L, nn[1] / L, nn[2] / L];
      const uv = o.su ? [i / n * o.su, j / rings, (i + 1) / n * o.su, j / rings, (i + 1) / n * o.su, (j + 1) / rings, i / n * o.su, (j + 1) / rings] : null;
      if (j === rings - 1) this.tri(m, p00, p01, p10, N, c0, uv ? [uv[0], uv[1], uv[6], uv[7], uv[2], uv[3]] : null);
      else this.quad(m, p00, p01, p11, p10, N, c0, uv ? [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]] : null);
    }
  }
};
// 土台（コンクリート。坂の低いところまで）：形 F のまわり yb〜yt
BP.plinth = function (F, yb, yt, c0) { if (yt - yb < 0.02) return; for (const e of F.edges) this.wallE('c', e, yb, yt, c0 || [0.66, 0.65, 0.62], { ao: 0.85 }); };
// パラペット（屋上のふちの低い壁）：形 F のまわり y〜y+h・あつさ t。外がわは壁の質感をのばしてもよい（o.mo）
BP.parapet = function (F, y, h, t, c0, o = {}) {
  const I = A.inset(F, t), m = o.m || 'c';
  if (!o.noOuter) for (const e of F.edges) this.wallE(o.mo || m, e, y, y + h, o.co || c0, { uv: o.uvo });
  for (const e of I.edges) { const dx = e.bx - e.ax, dz = e.bz - e.az; this.wall(m, e.bx, e.bz, e.ax, e.az, y, y + h, A.mul(c0, 0.9)); void dx; void dz; }   // 内がわ（中を向く）
  for (let k = 0; k < F.loops.length; k++) {   // 上のふた（外の線と内の線のあいだ）
    const a = F.loops[k], b = I.loops[k];
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; this.quad(m, [a[i][0], y + h, a[i][1]], [b[i][0], y + h, b[i][1]], [b[j][0], y + h, b[j][1]], [a[j][0], y + h, a[j][1]], [0, 1, 0], o.ct || c0); }
  }
  return I;
};
// 帯（辺 e にそって 外へ出っぱる板：ひさし・バルコニーの床・庇。y0〜y1・出 dep）。o：{ m, mt, from, to, ct }
BP.ledge = function (e, y0, y1, dep, c0, o = {}) {
  const m = o.m || 'c', t0 = (o.from || 0) / e.L, t1 = (o.to == null ? e.L : o.to) / e.L;
  const ax = e.ax + (e.bx - e.ax) * t0, az = e.az + (e.bz - e.az) * t0, bx = e.ax + (e.bx - e.ax) * t1, bz = e.az + (e.bz - e.az) * t1;
  const px = e.nx * dep, pz = e.nz * dep;
  this.wall(m, ax + px, az + pz, bx + px, bz + pz, y0, y1, c0);   // 正面
  this.quad(o.mt || m, [ax, y1, az], [bx, y1, bz], [bx + px, y1, bz + pz], [ax + px, y1, az + pz], [0, 1, 0], o.ct || c0);   // 上
  this.quad(m, [ax, y0, az], [ax + px, y0, az + pz], [bx + px, y0, bz + pz], [bx, y0, bz], [0, -1, 0], A.mul(c0, 0.8));   // 下
  this.wall(m, ax, az, ax + px, az + pz, y0, y1, c0); this.wall(m, bx + px, bz + pz, bx, bz, y0, y1, c0);   // 両はし
};
// 手すり（辺 e の外 dep m のところ、y〜y+h。質感 m は すかし（alpha））
BP.rail = function (m, e, y, h, dep, c0, o = {}) {
  const t0 = (o.from || 0) / e.L, t1 = (o.to == null ? e.L : o.to) / e.L, px = e.nx * dep, pz = e.nz * dep;
  const ax = e.ax + (e.bx - e.ax) * t0 + px, az = e.az + (e.bz - e.az) * t0 + pz, bx = e.ax + (e.bx - e.ax) * t1 + px, bz = e.az + (e.bz - e.az) * t1 + pz, L = Math.hypot(bx - ax, bz - az);
  this.wall(m, ax, az, bx, bz, y, y + h, c0 || WHITE, [0, L / (o.su || 2), 0, 1]);
  if (o.ends !== false && dep > 0) { const L2 = dep; this.wall(m, ax - px, az - pz, ax, az, y, y + h, c0 || WHITE, [0, L2 / (o.su || 2), 0, 1]); this.wall(m, bx, bz, bx - px, bz - pz, y, y + h, c0 || WHITE, [0, L2 / (o.su || 2), 0, 1]); }
};

/* ---------- 屋根 ----------
   B.roof(o)：o = { t: 'gable' 切妻 | 'hip' 寄棟 | 'irimoya' 入母屋 | 'shed' 片流れ | 'pyramid' 方形 | 'flat' 平ら | 'saw' のこぎり | 'barrel' かまぼこ | 'dome' | 'mansard' | 'gambrel',
     r: [x0, z0, x1, z1]（壁の外の線）, y（軒の高さ＝壁の上）, ax: 'x' | 'z'（棟の向き。なければ 長いほう）, p（勾配。高さ/横。0.45 くらい）, oh（軒の出 m）, hmax（屋根の高さの上限 m）,
     m, c（屋根の質感・色）, su, sv（質感 1枚の m）, mg, cg（妻の壁の質感・色）, gsu, gsv, th（屋根のあつさ m。0 で なし）, cf（鼻隠しの色）, cr（棟の色。なければ屋根の色）, k（窓の質感：のこぎり屋根の窓）, hi（片流れの高いがわ：'+' か '-'）}
   返り値：いちばん高いところ（m） */
BP.roof = function (o) {
  const t = o.t || 'gable', r = o.r, y = o.y, m = o.m || 'c', c0 = o.c || [0.4, 0.4, 0.42], oh = o.oh == null ? 0.5 : o.oh, th = o.th == null ? 0.18 : o.th;
  let w = r[2] - r[0], d = r[3] - r[1];
  if (w <= 0 || d <= 0) return y;
  const alongX = o.ax ? o.ax === 'x' : w >= d;
  // 棟の向きを x にそろえて 考える（z 向きなら 入れかえる）
  const S = alongX ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];
  const X0 = (alongX ? r[0] : r[1]) - oh, X1 = (alongX ? r[2] : r[3]) + oh, Z0 = (alongX ? r[1] : r[0]) - oh, Z1 = (alongX ? r[3] : r[2]) + oh;
  const x0 = alongX ? r[0] : r[1], x1 = alongX ? r[2] : r[3], z0 = alongX ? r[1] : r[0], z1 = alongX ? r[3] : r[2];
  const D = Z1 - Z0, L = X1 - X0, zm = (Z0 + Z1) / 2;
  let p = o.p == null ? 0.45 : o.p;
  if (o.hmax && (D / 2) * p > o.hmax + oh * p) p = (o.hmax + oh * p) / (D / 2);
  const ye = y - oh * p, yr = ye + (D / 2) * p;
  const su = o.su || 0, sv = o.sv || su, mg = o.mg || m, cg = o.cg || c0, cf = o.cf || A.mul(c0, 0.75);
  const gsu = o.gsu || 0, gsv = o.gsv || gsu;
  const Q = (a, b, c, d2, uvq) => this.quad(m, S(...a), S(...b), S(...c), S(...d2), null, c0, uvq);
  const T = (a, b, c, uvt, mm, cc) => this.tri(mm || m, S(...a), S(...b), S(...c), null, cc || c0, uvt);
  const slopeUV = (u0, u1, s0, s1) => su ? [u0 / su, s0 / sv, u1 / su, s0 / sv, u1 / su, s1 / sv, u0 / su, s1 / sv] : null;
  const sl = Math.hypot(D / 2, yr - ye);   // 軒から棟までの長さ
  // 妻の三角（壁の質感）：x = xg の面に、z0〜z1・y〜yr
  const gable = (xg, sgn) => {
    const zt = (z0 + z1) / 2, yt = y + ((z1 - z0) / 2) * p;
    const g = (u, h) => gsu ? [u / gsu, h / gsv] : [0, 0];
    const a = [xg, y, z0], b = [xg, y, z1], c = [xg, yt, zt];
    const ga = g(0, y), gb = g(z1 - z0, y), gc = g((z1 - z0) / 2, yt);
    if (sgn > 0) T(a, c, b, [ga[0], ga[1], gc[0], gc[1], gb[0], gb[1]], mg, cg); else T(b, c, a, [gb[0], gb[1], gc[0], gc[1], ga[0], ga[1]], mg, cg);
  };
  const fascia = (ax2, az2, bx2, bz2, ya, yb2) => {   // 軒先・けらばの あつみ（ふち）
    if (th <= 0) return;
    this.quad('c', S(ax2, ya - th, az2), S(bx2, yb2 - th, bz2), S(bx2, yb2, bz2), S(ax2, ya, az2), null, cf);
  };
  let top = yr;
  void slopeUV;
  if (t === 'gable' || t === 'gambrel') {
    Q([X0, ye, Z0], [X0, yr, zm], [X1, yr, zm], [X1, ye, Z0], su ? [X0 / su, 0, X0 / su, sl / sv, X1 / su, sl / sv, X1 / su, 0] : null);
    Q([X1, ye, Z1], [X1, yr, zm], [X0, yr, zm], [X0, ye, Z1], su ? [X1 / su, 0, X1 / su, sl / sv, X0 / su, sl / sv, X0 / su, 0] : null);
    gable(x0, -1); gable(x1, 1);
    fascia(X0, Z0, X1, Z0, ye, ye); fascia(X1, Z1, X0, Z1, ye, ye);
    fascia(X0, Z1, X0, zm, ye, yr); fascia(X0, zm, X0, Z0, yr, ye); fascia(X1, Z0, X1, zm, ye, yr); fascia(X1, zm, X1, Z1, yr, ye);
    if (o.cr || th > 0) { const rw = 0.18; this.quad('c', S(X0, yr + 0.08, zm - rw), S(X0, yr + 0.08, zm + rw), S(X1, yr + 0.08, zm + rw), S(X1, yr + 0.08, zm - rw), null, o.cr || A.mul(c0, 0.8)); }
  } else if (t === 'hip' || t === 'pyramid' || t === 'irimoya') {
    let a = Math.min(D / 2, L / 2); if (t === 'pyramid') a = Math.min(D, L) / 2;
    const yh = t === 'irimoya' ? ye + (D / 2) * p * (o.k1 || 0.55) : yr;
    const ins = (yh - ye) / p;   // 寄棟の面が上がる はば
    const ra = X0 + Math.min(ins, L / 2), rb = X1 - Math.min(ins, L / 2), za = Z0 + Math.min(ins, D / 2), zb = Z1 - Math.min(ins, D / 2);
    const s1 = Math.hypot(ins, yh - ye);
    // 長い面（北・南）と 短い面（東・西）
    Q([X0, ye, Z0], [ra, yh, za], [rb, yh, za], [X1, ye, Z0], su ? [X0 / su, 0, ra / su, s1 / sv, rb / su, s1 / sv, X1 / su, 0] : null);
    Q([X1, ye, Z1], [rb, yh, zb], [ra, yh, zb], [X0, ye, Z1], su ? [X1 / su, 0, rb / su, s1 / sv, ra / su, s1 / sv, X0 / su, 0] : null);
    Q([X0, ye, Z1], [ra, yh, zb], [ra, yh, za], [X0, ye, Z0], su ? [Z1 / su, 0, zb / su, s1 / sv, za / su, s1 / sv, Z0 / su, 0] : null);
    Q([X1, ye, Z0], [rb, yh, za], [rb, yh, zb], [X1, ye, Z1], su ? [Z0 / su, 0, za / su, s1 / sv, zb / su, s1 / sv, Z1 / su, 0] : null);
    fascia(X0, Z0, X1, Z0, ye, ye); fascia(X1, Z1, X0, Z1, ye, ye); fascia(X0, Z1, X0, Z0, ye, ye); fascia(X1, Z0, X1, Z1, ye, ye);
    if (t === 'irimoya' && rb - ra > 0.2) {   // 上の切妻（三角の妻）
      const yt = yh + ((zb - za) / 2) * p, s2 = Math.hypot((zb - za) / 2, yt - yh), e2 = Math.min(0.6, (rb - ra) * 0.1);
      Q([ra - e2, yh, za], [ra - e2, yt, zm], [rb + e2, yt, zm], [rb + e2, yh, za], su ? [ra / su, 0, ra / su, s2 / sv, rb / su, s2 / sv, rb / su, 0] : null);
      Q([rb + e2, yh, zb], [rb + e2, yt, zm], [ra - e2, yt, zm], [ra - e2, yh, zb], su ? [rb / su, 0, rb / su, s2 / sv, ra / su, s2 / sv, ra / su, 0] : null);
      const gt = (xg, sg) => { const g = (u, h) => gsu ? [u / gsu, h / gsv] : [0, 0]; const A1 = [xg, yh, za], B1 = [xg, yh, zb], C1 = [xg, yt, zm];
        if (sg > 0) T(A1, C1, B1, [...g(0, yh), ...g((zb - za) / 2, yt), ...g(zb - za, yh)], mg, cg); else T(B1, C1, A1, [...g(zb - za, yh), ...g((zb - za) / 2, yt), ...g(0, yh)], mg, cg); };
      gt(ra, -1); gt(rb, 1);
      fascia(ra - e2, za, ra - e2, zm, yh, yt); fascia(ra - e2, zm, ra - e2, zb, yt, yh); fascia(rb + e2, zb, rb + e2, zm, yh, yt); fascia(rb + e2, zm, rb + e2, za, yt, yh);
      top = yt;
    } else top = yh;
    if (t !== 'pyramid' && rb - ra > 0.05 && t !== 'irimoya') { const rw = 0.16; this.quad('c', S(ra, yh + 0.07, zm - rw), S(ra, yh + 0.07, zm + rw), S(rb, yh + 0.07, zm + rw), S(rb, yh + 0.07, zm - rw), null, o.cr || A.mul(c0, 0.8)); }
  } else if (t === 'shed') {
    const hiPlus = (o.hi || '+') === '+', yl = y - oh * p, yhh = y + (z1 - z0) * p + oh * p;   // 低いがわ Z0（hi '+' なら Z1 が高い）
    const zl = hiPlus ? Z0 : Z1, zh = hiPlus ? Z1 : Z0, s3 = Math.hypot(D, yhh - yl);
    if (hiPlus) Q([X0, yl, zl], [X0, yhh, zh], [X1, yhh, zh], [X1, yl, zl], su ? [X0 / su, 0, X0 / su, s3 / sv, X1 / su, s3 / sv, X1 / su, 0] : null);
    else Q([X1, yl, zl], [X1, yhh, zh], [X0, yhh, zh], [X0, yl, zl], su ? [X1 / su, 0, X1 / su, s3 / sv, X0 / su, s3 / sv, X0 / su, 0] : null);
    // 壁の三角と、高いがわの壁
    const zlo = hiPlus ? z0 : z1, zhi = hiPlus ? z1 : z0, yw = y + (z1 - z0) * p;
    const g = (u, h) => gsu ? [u / gsu, h / gsv] : [0, 0];
    for (const [xg, sg] of [[x0, -1], [x1, 1]]) {
      const P1 = [xg, y, zlo], P2 = [xg, y, zhi], P3 = [xg, yw, zhi];
      if ((sg > 0) === hiPlus) T(P1, P3, P2, [...g(0, y), ...g(z1 - z0, yw), ...g(z1 - z0, y)], mg, cg); else T(P2, P3, P1, [...g(z1 - z0, y), ...g(z1 - z0, yw), ...g(0, y)], mg, cg);
    }
    if (hiPlus) this.quad(mg, S(x1, y, zhi), S(x1, yw, zhi), S(x0, yw, zhi), S(x0, y, zhi), null, cg, gsu ? [x1 / gsu, y / gsv, x1 / gsu, yw / gsv, x0 / gsu, yw / gsv, x0 / gsu, y / gsv] : null);
    else this.quad(mg, S(x0, y, zhi), S(x0, yw, zhi), S(x1, yw, zhi), S(x1, y, zhi), null, cg, gsu ? [x0 / gsu, y / gsv, x0 / gsu, yw / gsv, x1 / gsu, yw / gsv, x1 / gsu, y / gsv] : null);
    fascia(X0, zl, X1, zl, yl, yl); fascia(X1, zh, X0, zh, yhh, yhh);
    top = yhh;
  } else if (t === 'saw') {
    const n = Math.max(1, Math.round((x1 - x0) / (o.tw || 10))), st = (x1 - x0) / n, hh = Math.min(o.hmax || 4, st * (o.p || 0.4));
    const k = o.k || mg;
    for (let i = 0; i < n; i++) {
      const a = x0 + i * st, b = a + st;
      Q([a, y, z0], [b, y + hh, z0], [b, y + hh, z1], [a, y, z1], su ? [z0 / su, 0, z0 / su, st / sv, z1 / su, st / sv, z1 / su, 0] : null);   // 坂
      this.quad(k, S(b, y, z1), S(b, y + hh, z1), S(b, y + hh, z0), S(b, y, z0), null, WHITE, [z1 / 3.2, 0, z1 / 3.2, 1, z0 / 3.2, 1, z0 / 3.2, 0]);   // 立った面の窓（明かりとり）
      T([a, y, z0], [b, y, z0], [b, y + hh, z0], null, mg, cg); T([b, y, z1], [a, y, z1], [b, y + hh, z1], null, mg, cg);   // 両はしの三角
    }
    top = y + hh;
  } else if (t === 'barrel') {
    const n = o.n || 10, rise = Math.min(o.hmax || 99, (Z1 - Z0) * (o.p == null ? 0.22 : o.p));
    const zc = (Z0 + Z1) / 2, hw = (Z1 - Z0) / 2, R = (hw * hw + rise * rise) / (2 * rise), yc = ye + rise - R, a0 = Math.asin(Math.min(1, hw / R));
    const P = q => { const ang = -a0 + 2 * a0 * q / n; return [zc + Math.sin(ang) * R, yc + Math.cos(ang) * R]; };
    for (let i = 0; i < n; i++) {
      const [za2, ya] = P(i), [zb2, yb2] = P(i + 1), s0 = i / n * 2 * a0 * R, s1 = (i + 1) / n * 2 * a0 * R;
      Q([X0, ya, za2], [X0, yb2, zb2], [X1, yb2, zb2], [X1, ya, za2], su ? [X0 / su, s0 / sv, X0 / su, s1 / sv, X1 / su, s1 / sv, X1 / su, s0 / sv] : null);
      for (const [xg, sg] of [[x0, -1], [x1, 1]]) {   // 両はしの壁（弓形）
        const zA = Math.max(z0, Math.min(z1, za2)), zB = Math.max(z0, Math.min(z1, zb2)), yA = Math.max(y, ya), yB = Math.max(y, yb2);
        if (sg > 0) T([xg, y, zA], [xg, yA, zA], [xg, yB, zB], null, mg, cg), T([xg, y, zA], [xg, yB, zB], [xg, y, zB], null, mg, cg);
        else T([xg, y, zB], [xg, yB, zB], [xg, yA, zA], null, mg, cg), T([xg, y, zB], [xg, yA, zA], [xg, y, zA], null, mg, cg);
      }
    }
    top = ye + rise;
  } else if (t === 'dome') {
    const h = Math.min(o.hmax || 99, Math.min(w, d) / 2 * (o.p == null ? 0.8 : o.p));
    this.dome(m, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, w / 2 + oh, d / 2 + oh, y, h, o.n || 16, c0, { rings: o.rings || 5 });
    top = y + h;
  } else if (t === 'mansard') {
    const p1 = o.p1 || 2.2, h1 = Math.min(o.h1 || 2.8, Math.min(D, L) / 2 * p1 * 0.6), ins = h1 / p1, y1b = ye + h1;
    const ra = X0 + ins, rb = X1 - ins, za = Z0 + ins, zb = Z1 - ins;
    Q([X0, ye, Z0], [ra, y1b, za], [rb, y1b, za], [X1, ye, Z0], null); Q([X1, ye, Z1], [rb, y1b, zb], [ra, y1b, zb], [X0, ye, Z1], null);
    Q([X0, ye, Z1], [ra, y1b, zb], [ra, y1b, za], [X0, ye, Z0], null); Q([X1, ye, Z0], [rb, y1b, za], [rb, y1b, zb], [X1, ye, Z1], null);
    this.quad(o.mt || m, S(ra, y1b, zb), S(rb, y1b, zb), S(rb, y1b, za), S(ra, y1b, za), null, o.ct || A.mul(c0, 0.9));
    fascia(X0, Z0, X1, Z0, ye, ye); fascia(X1, Z1, X0, Z1, ye, ye); fascia(X0, Z1, X0, Z0, ye, ye); fascia(X1, Z0, X1, Z1, ye, ye);
    top = y1b;
  } else {   // flat
    this.flat(m, r, y, c0, { su });
    top = y;
  }
  return top;
};
// 形 F の上に屋根（長方形が多いときは平ら）。o は B.roof と同じ（r・ax は長方形ごと）
BP.roofs = function (F, o) {
  const R = F.maxr.length <= (o.maxN || 8) ? F.maxr : null; let top = o.y;
  if (!R) { this.cap(o.mt || 'c', F, o.y, o.ct || o.c); return o.y; }
  for (const r of R) top = Math.max(top, this.roof(Object.assign({}, o, { r, ax: o.axF ? o.axF(r) : o.ax })));
  return top;
};

/* ---------- 小物 ---------- */
// 木（幹と葉のかたまり）
BP.tree = function (x, z, y, h, r, c0, o = {}) {
  const tc = o.tc || [0.36, 0.28, 0.2], lc = col(c0 || [0.27, 0.42, 0.22]), yT = y + h * (o.trunk || 0.35);
  this.box('c', x - 0.15, z - 0.15, x + 0.15, z + 0.15, y, yT + 0.3, tc);
  const n = 6, rr = r, yc = yT + (h - (yT - y)) * 0.45, hh = (h - (yT - y)) / 2;
  const top = [x, y + h, z], bot = [x, yT, z], ring = [];
  for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2 + (o.rot || 0); ring.push([x + Math.cos(t) * rr * (0.85 + 0.3 * ((i * 7) % 3) / 2), yc + (i % 2 ? 0.15 : -0.15) * hh, z + Math.sin(t) * rr * (0.85 + 0.3 * ((i * 5) % 3) / 2)]); }
  const dk = A.mul(lc, 0.72);
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; this.tri('c', a, top, b, null, lc); this.tri('c', b, bot, a, null, dk); }
};
// 車（向き ang）
BP.car = function (x, z, ang, c0, y = 0) {
  this.obox('c', x, z, ang, 4.3, 1.7, y + 0.25, y + 0.95, c0, {});
  this.obox('c', x - Math.cos(ang) * 0.25, z - Math.sin(ang) * 0.25, ang, 2.3, 1.5, y + 0.95, y + 1.45, [0.2, 0.24, 0.28], { ct: c0 });
};
// エアコンの室外機・屋上の小物
BP.acUnit = function (x, z, y, ang = 0) { this.obox('c', x, z, ang, 0.8, 0.3, y, y + 0.6, [0.86, 0.86, 0.84]); };
BP.rooftop = function (F, y, R, o = {}) {   // 屋上：塔屋（階段・エレベーター）・室外機・水槽
  const rs = (F.rects || F).filter(r => (r[2] - r[0]) > 6 && (r[3] - r[1]) > 6); if (!rs.length) return;
  const big = rs.reduce((a, r) => (r[2] - r[0]) * (r[3] - r[1]) > (a[2] - a[0]) * (a[3] - a[1]) ? r : a);
  const w = big[2] - big[0], d = big[3] - big[1];
  if (o.ph !== false && w > 9 && d > 9) {   // 塔屋
    const pw = Math.min(6, w * 0.3), pd = Math.min(5, d * 0.3), px = big[0] + w * (0.25 + 0.5 * R()) - pw / 2, pz = big[1] + d * (0.25 + 0.5 * R()) - pd / 2;
    this.box(o.mph || 'c', px, pz, px + pw, pz + pd, y, y + 3.2, o.cph || [0.78, 0.77, 0.74], { su: o.mph ? 3.2 : 0, sv: o.mph ? 3.2 : 0 });
    this.box('c', px - 0.2, pz - 0.2, px + pw + 0.2, pz + pd + 0.2, y + 3.2, y + 3.4, [0.6, 0.6, 0.6]);
  }
  const nAC = Math.min(o.nmax || 14, Math.floor(F.area / (o.per || 60)));
  for (let i = 0; i < nAC; i++) { const r = A.pick(R, rs), x = r[0] + 1.5 + (r[2] - r[0] - 3) * R(), z = r[1] + 1.5 + (r[3] - r[1] - 3) * R(); this.acUnit(x, z, y, R() < 0.5 ? 0 : Math.PI / 2); }
  if (o.tank && w > 12 && d > 12) { const x = big[0] + 3 + (w - 6) * R(), z = big[1] + 3 + (d - 6) * R(); this.box('c', x - 1.4, z - 1.4, x + 1.4, z + 1.4, y, y + 0.8, [0.5, 0.5, 0.5]); this.box('c', x - 1.2, z - 1.2, x + 1.2, z + 1.2, y + 0.8, y + 2.6, [0.86, 0.85, 0.8]); }
};

/* ---------- 質感（キャンバスに描く） ----------
   A.tex(名前, はば, 高さ, draw(g, w, h, R), o) → 名前。o：{ alpha（すかし。手すりなど）, tr（半とうめい。op）, shiny（ガラスのつや）, po（重ねる面：polygonOffset） }
   はば・高さは 2 のべき（128・256・512）。draw は w・h の割合で描く（画質の設定で大きさが かわる） */
A.tex = (key, w, h, draw, o = {}) => { if (!MAT.has(key)) MAT.set(key, { w, h, draw, o, m: null }); return key; };
A.matOf = (T3, key) => {
  if (key === 'c' || key === 'cp') {
    let e = MAT.get(key); if (!e) MAT.set(key, e = { o: {} });
    if (!e.m) { e.m = new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }); if (key === 'cp') Object.assign(e.m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); e.m.keep = true; }
    return e.m;
  }
  const e = MAT.get(key); if (!e) return A.matOf(T3, 'c');
  if (e.m && e.tq === A.tq) return e.m;
  if (e.m) { e.m.map && e.m.map.dispose(); e.m.dispose(); }
  const k = e.o.fixed ? 1 : A.tq, W = Math.max(16, Math.round(e.w * k)), H = Math.max(16, Math.round(e.h * k));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  try { e.draw(g, W, H, A.rng(strHash(key))); } catch (er) { console.error('M3A.tex', key, er); g.fillStyle = '#ccc'; g.fillRect(0, 0, W, H); }
  const tx = new T3.CanvasTexture(cv); tx.wrapS = tx.wrapT = T3.RepeatWrapping; tx.anisotropy = A.aniso || 4;
  const op = { map: tx, vertexColors: true, side: T3.DoubleSide };
  if (e.o.alpha) op.alphaTest = 0.5;
  if (e.o.tr) { op.transparent = true; op.opacity = e.o.op || 0.5; op.depthWrite = false; }
  const M = e.o.shiny ? new T3.MeshPhongMaterial(Object.assign(op, { specular: new T3.Color(e.o.shiny), shininess: e.o.sh || 40 })) : new T3.MeshLambertMaterial(op);
  if (e.o.po) Object.assign(M, { polygonOffset: true, polygonOffsetFactor: e.o.po, polygonOffsetUnits: e.o.po });
  M.keep = true; e.m = M; e.tq = A.tq;
  return M;
};
const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
A.strHash = strHash;
// たまった面を メッシュにして grp に入れる（B はつかいおわり）
A.flush = (T3, B, grp) => {
  let n = 0;
  for (const [key, b] of B.bk) {
    if (!b.n) continue;
    const ib = new T3.InterleavedBuffer(b.a.subarray(0, b.n), 11), g = new T3.BufferGeometry();
    g.setAttribute('position', new T3.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute('normal', new T3.InterleavedBufferAttribute(ib, 3, 3));
    g.setAttribute('color', new T3.InterleavedBufferAttribute(ib, 3, 6)); g.setAttribute('uv', new T3.InterleavedBufferAttribute(ib, 2, 9));
    const me = new T3.Mesh(g, A.matOf(T3, key)); me.userData.m3a = key; grp.add(me); n += b.n / 11;
  }
  return n;
};

/* ---------- 描く道具（PT）：キャンバスの 2D ---------- */
const PT = A.paint = {};
PT.css = (c, k = 1, a = 1) => { const v = col(c); if (a === 1 && typeof c === 'string' && /^rgba\(/i.test(c)) { const m = /,\s*([\d.]+)\s*\)\s*$/.exec(c); if (m) a = +m[1]; } return `rgba(${Math.round(Math.min(1, v[0] * k) * 255)},${Math.round(Math.min(1, v[1] * k) * 255)},${Math.round(Math.min(1, v[2] * k) * 255)},${a})`; };
PT.fill = (g, x, y, w, h, c, k = 1) => { g.fillStyle = PT.css(c, k); g.fillRect(x, y, w, h); };
// ざらざら（明るさのばらつき。amp 0.02〜0.1。sz：つぶの大きさ px）
PT.noise = (g, x, y, w, h, amp, R, sz = 1) => {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); if (w <= 0 || h <= 0) return;
  const id = g.getImageData(x, y, w, h), d = id.data;
  for (let j = 0; j < h; j += sz) for (let i = 0; i < w; i += sz) {
    const v = (R() - 0.5) * 2 * amp * 255;
    for (let jj = j; jj < Math.min(h, j + sz); jj++) for (let ii = i; ii < Math.min(w, i + sz); ii++) { const o = (jj * w + ii) * 4; d[o] += v; d[o + 1] += v; d[o + 2] += v; }
  }
  g.putImageData(id, x, y);
};
// 雨のすじ（コンクリートの よごれ。窓の下など）
PT.streaks = (g, x, y, w, h, n, a, R) => { for (let i = 0; i < n; i++) { const sx = x + R() * w, sw = 1 + R() * w * 0.02, sh = h * (0.2 + 0.8 * R()); const gr = g.createLinearGradient(0, y, 0, y + sh); gr.addColorStop(0, `rgba(40,40,35,${a})`); gr.addColorStop(1, 'rgba(40,40,35,0)'); g.fillStyle = gr; g.fillRect(sx, y, sw, sh); } };
PT.hlines = (g, x, y, w, h, step, c, lw = 1, a = 1) => { g.fillStyle = PT.css(c, 1, a); for (let v = y; v < y + h; v += step) g.fillRect(x, Math.round(v), w, lw); };
PT.vlines = (g, x, y, w, h, step, c, lw = 1, a = 1) => { g.fillStyle = PT.css(c, 1, a); for (let u = x; u < x + w; u += step) g.fillRect(Math.round(u), y, lw, h); };
// 外壁の材料：tile（小さなタイル）・brick（レンガ）・stucco（ぬり壁）・siding（横の板・サイディング）・vsiding（たての板・金属）・panel（コンクリートのパネル）・concrete（打ちはなし）・wood（木の板）・stone（石）・metal（波板）
PT.wallMat = (g, x, y, w, h, s, R) => {
  const c = s.c || '#d8d2c6', t = s.t || 'stucco', sc = s.sc || 1;   // sc：模様の大きさ（px の倍率）
  PT.fill(g, x, y, w, h, c);
  if (t === 'tile') { const tw = 6 * sc, th = 3 * sc; for (let v = y, r = 0; v < y + h; v += th, r++) for (let u = x - (r % 2) * tw / 2; u < x + w; u += tw) { g.fillStyle = PT.css(c, 0.93 + R() * 0.12); g.fillRect(u + 0.5, v + 0.5, tw - 1, th - 1); } g.globalAlpha = 0.35; PT.hlines(g, x, y, w, h, th, s.j || '#8a857c', 1); g.globalAlpha = 1; }
  else if (t === 'brick') { const bw = 8 * sc, bh = 3.4 * sc; for (let v = y, r = 0; v < y + h; v += bh, r++) for (let u = x - (r % 2) * bw / 2; u < x + w; u += bw) { g.fillStyle = PT.css(A.mix(c, s.c2 || c, R()), 0.85 + R() * 0.25); g.fillRect(u + 0.6, v + 0.6, bw - 1.2, bh - 1.2); } }
  else if (t === 'siding') { const st = 4 * sc; for (let v = y; v < y + h; v += st) { const gr = g.createLinearGradient(0, v, 0, v + st); gr.addColorStop(0, PT.css(c, 1.06)); gr.addColorStop(0.85, PT.css(c, 0.97)); gr.addColorStop(1, PT.css(c, 0.78)); g.fillStyle = gr; g.fillRect(x, v, w, st); } }
  else if (t === 'vsiding' || t === 'metal') { const st = (t === 'metal' ? 3 : 5) * sc; for (let u = x; u < x + w; u += st) { const gr = g.createLinearGradient(u, 0, u + st, 0); gr.addColorStop(0, PT.css(c, 0.86)); gr.addColorStop(0.3, PT.css(c, 1.05)); gr.addColorStop(1, PT.css(c, 0.95)); g.fillStyle = gr; g.fillRect(u, y, st, h); } }
  else if (t === 'panel' || t === 'concrete') { const pw = (s.pw || 24) * sc, ph = (s.ph || 12) * sc; g.globalAlpha = 0.5; PT.hlines(g, x, y, w, h, ph, A.mul(c, 0.7), 1); PT.vlines(g, x, y, w, h, pw, A.mul(c, 0.72), 1); g.globalAlpha = 1;
    if (t === 'concrete') { g.fillStyle = PT.css(c, 0.6, 0.5); for (let v = y + ph / 4; v < y + h; v += ph / 2) for (let u = x + pw / 6; u < x + w; u += pw / 3) g.fillRect(u, v, 1.2, 1.2); } }
  else if (t === 'wood') { const st = 3 * sc; for (let v = y; v < y + h; v += st) { g.fillStyle = PT.css(c, 0.85 + R() * 0.2); g.fillRect(x, v, w, st - 0.6); } }
  else if (t === 'stone') { const sw = 10 * sc, sh = 5 * sc; for (let v = y, r = 0; v < y + h; v += sh, r++) for (let u = x - (r % 2) * sw * 0.4; u < x + w; u += sw * (0.8 + R() * 0.4)) { g.fillStyle = PT.css(c, 0.88 + R() * 0.2); g.fillRect(u + 0.6, v + 0.6, sw - 1.2, sh - 1.2); } }
  PT.noise(g, x, y, w, h, s.n == null ? 0.035 : s.n, R, s.ns || 1);
  if (s.dirt) PT.streaks(g, x, y, w, h, Math.round(w / 6), s.dirt, R);
};
// 窓（x, y, w, h：px）。o：{ f（わくの色）, fw（わくのはば px）, g0, g1（ガラスの上・下の色）, div: [たて, よこ]（わくで わける数）, cur（カーテンの出る わり）, cc（カーテンの色）, bl（ブラインドの わり）, lit（明かり の わり）, rec（くぼみの影 px）, sill（窓台の色）, sh（雨戸・シャッター の わり）, shc }
PT.win = (g, x, y, w, h, o, R) => {
  o = o || {}; const fw = o.fw == null ? Math.max(1, w * 0.06) : o.fw;
  if (o.rec) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x - o.rec * 0.4, y - o.rec, w + o.rec * 0.8, h + o.rec * 1.2); }
  PT.fill(g, x, y, w, h, o.f || '#e8e8e6');
  const gx = x + fw, gy = y + fw, gw = w - fw * 2, gh = h - fw * 2; if (gw <= 0 || gh <= 0) return;
  // ガラス：空がうつる（上が明るい）
  const gr = g.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, PT.css(o.g0 || '#9fb4c6')); gr.addColorStop(0.55, PT.css(o.g1 || '#4f6476')); gr.addColorStop(1, PT.css(o.g1 || '#4f6476', 0.85));
  g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
  const rr = R();
  if (o.sh && rr < o.sh) { PT.fill(g, gx, gy, gw, gh, o.shc || '#b8b6ae'); PT.hlines(g, gx, gy, gw, gh, Math.max(2, gh / 10), A.mul(o.shc || '#b8b6ae', 0.8), 1); }
  else if (o.lit && R() < o.lit) { const lg = g.createLinearGradient(0, gy, 0, gy + gh); lg.addColorStop(0, 'rgba(255,236,190,.75)'); lg.addColorStop(1, 'rgba(240,210,160,.55)'); g.fillStyle = lg; g.fillRect(gx, gy, gw, gh); }
  else if (o.cur && rr < (o.sh || 0) + o.cur) {   // カーテン（左右・まん中 しめ）
    const cc = o.cc ? A.pick(R, o.cc) : '#efe8da', m = R(), cw = gw * (0.25 + 0.3 * R());
    g.fillStyle = PT.css(cc, 1, 0.92);
    if (m < 0.4) { g.fillRect(gx, gy, cw, gh); g.fillRect(gx + gw - cw * 0.8, gy, cw * 0.8, gh); } else if (m < 0.7) g.fillRect(gx, gy, gw, gh * (0.4 + 0.6 * R())); else g.fillRect(gx, gy, gw, gh);
    g.fillStyle = 'rgba(0,0,0,.07)'; for (let u = gx; u < gx + gw; u += Math.max(2, gw / 10)) g.fillRect(u, gy, 1, gh);
  } else if (o.bl && R() < o.bl) { g.globalAlpha = 0.6; PT.hlines(g, gx, gy, gw, gh * (0.3 + 0.7 * R()), Math.max(2, gh / 14), '#e6e3dc', Math.max(1, gh / 28)); g.globalAlpha = 1; }
  // うつりこみ（ななめの光）
  if (o.refl !== false) { g.save(); g.beginPath(); g.rect(gx, gy, gw, gh); g.clip(); g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.moveTo(gx + gw * 0.15, gy); g.lineTo(gx + gw * 0.45, gy); g.lineTo(gx + gw * 0.15, gy + gh); g.lineTo(gx - gw * 0.15, gy + gh); g.closePath(); g.fill(); g.restore(); }
  // わく（たて・よこ）
  const dv = o.div || [2, 1]; g.fillStyle = PT.css(o.f || '#e8e8e6');
  for (let i = 1; i < dv[0]; i++) g.fillRect(gx + gw * i / dv[0] - fw / 2, gy, Math.max(1, fw * 0.8), gh);
  for (let i = 1; i < dv[1]; i++) g.fillRect(gx, gy + gh * i / dv[1] - fw / 2, gw, Math.max(1, fw * 0.8));
  if (o.sill) { PT.fill(g, x - fw, y + h, w + fw * 2, Math.max(1, fw * 1.2), o.sill); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - fw, y + h + fw * 1.2, w + fw * 2, Math.max(1, fw)); }
};
// ドア（x, y, w, h）。o：{ c（とびらの色）, f（わく）, gl（ガラスのとびら）, n（とびらの数）}
PT.door = (g, x, y, w, h, o = {}, R) => {
  PT.fill(g, x, y, w, h, o.f || '#5a5550');
  const n = o.n || 1, fw = Math.max(1, w * 0.05);
  for (let i = 0; i < n; i++) { const dx = x + fw + (w - fw * 2) * i / n, dw = (w - fw * 2) / n - (n > 1 ? fw * 0.5 : 0);
    if (o.gl) PT.win(g, dx, y + fw, dw, h - fw, { f: o.f || '#8a8f94', fw: Math.max(1, dw * 0.08), div: [1, 1], g0: '#8fa3b3', g1: '#3c4a56' }, R);
    else { PT.fill(g, dx, y + fw, dw, h - fw, o.c || '#6b4f3a'); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(dx + dw * 0.12, y + h * 0.12, dw * 0.76, Math.max(1, h * 0.02)); g.fillRect(dx + dw * 0.12, y + h * 0.55, dw * 0.76, Math.max(1, h * 0.02)); PT.fill(g, dx + dw * 0.78, y + h * 0.5, Math.max(1, dw * 0.06), Math.max(1, h * 0.06), '#d8d0b8'); }
  }
};
// シャッター（車庫・お店の）
PT.shutter = (g, x, y, w, h, c = '#b9bcbf') => { PT.fill(g, x, y, w, h, c); PT.hlines(g, x, y, w, h, Math.max(2, h / 16), A.mul(c, 0.78), 1); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, w, Math.max(1, h * 0.05)); };
// 屋根の質感：kawara（瓦）・slate（スレート）・seam（金属のたて はぜ）・shingle（アスファルト）・membrane（屋上の防水シート）・gravel（砂利）・solar（太陽光パネル）
PT.roofMat = (g, w, h, s, R) => {
  const c = s.c || '#4b4f55', t = s.t || 'slate';
  PT.fill(g, 0, 0, w, h, c);
  if (t === 'kawara') { const tw = w / 16, th = h / 8;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) { const gr = g.createLinearGradient(i * tw, 0, i * tw + tw, 0); gr.addColorStop(0, PT.css(c, 0.72)); gr.addColorStop(0.45, PT.css(c, 1.12)); gr.addColorStop(1, PT.css(c, 0.8)); g.fillStyle = gr; g.fillRect(i * tw, j * th, tw, th); }
    for (let j = 0; j < 8; j++) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, j * th, w, Math.max(1, th * 0.12)); } }
  else if (t === 'slate' || t === 'shingle') { const tw = w / (t === 'slate' ? 10 : 8), th = h / (t === 'slate' ? 12 : 10);
    for (let j = 0; j < h / th; j++) for (let i = -1; i < w / tw + 1; i++) { g.fillStyle = PT.css(c, 0.86 + R() * 0.22); g.fillRect(i * tw + (j % 2) * tw / 2 + 0.5, j * th + 0.5, tw - 1, th - 1); }
    g.fillStyle = 'rgba(0,0,0,.22)'; for (let j = 0; j < h / th; j++) g.fillRect(0, j * th, w, 1); }
  else if (t === 'seam') { const st = w / 10; for (let i = 0; i < 10; i++) { g.fillStyle = PT.css(c, 1.12); g.fillRect(i * st, 0, Math.max(1, st * 0.12), h); g.fillStyle = PT.css(c, 0.82); g.fillRect(i * st + st * 0.12, 0, Math.max(1, st * 0.06), h); } }
  else if (t === 'membrane') { g.globalAlpha = 0.35; PT.hlines(g, 0, 0, w, h, h / 4, A.mul(c, 0.8), 1); g.globalAlpha = 1; }
  else if (t === 'gravel') PT.noise(g, 0, 0, w, h, 0.12, R, 2);
  else if (t === 'solar') { PT.fill(g, 0, 0, w, h, '#1d2a44'); for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) { g.fillStyle = PT.css('#24365a', 0.9 + R() * 0.2); g.fillRect(i * w / 10 + 1, j * h / 6 + 1, w / 10 - 2, h / 6 - 2); } }
  PT.noise(g, 0, 0, w, h, s.n == null ? 0.04 : s.n, R);
};
// 窓のならぶ外壁（ファサードの質感）。tb × tf のます（柱間 × 階）を1枚に。窓は ますごとに少しずつちがう（カーテンなど）
//   s：{ wall（PT.wallMat の s）, tb, tf, win: { x, y, w, h（ますの中の割合）, …PT.win の o }, band: { h（割合）, c }（床の帯）, pil: { w（割合）, c }（柱）,
//        gf（1階用：{ t: 'shop' | 'entr' | 'plain' | 'garage' }）, rail（ベランダの手すりを描く：{ h, c, t: 'bar' | 'solid' | 'glass' }）, ac（室外機を描く わり）}
PT.grid = (g, w, h, s, R) => {
  const tb = s.tb || 4, tf = s.tf || 4, mw = w / tb, mh = h / tf;
  PT.wallMat(g, 0, 0, w, h, s.wall || {}, R);
  for (let j = 0; j < tf; j++) for (let i = 0; i < tb; i++) {
    const X = i * mw, Y = j * mh;
    if (s.pil) PT.fill(g, X, Y, mw * s.pil.w, mh, s.pil.c);
    const W = s.win; if (W && !(s.skip && s.skip(i, j, R))) {
      const wx = X + mw * (W.x == null ? 0.15 : W.x), wy = Y + mh * (W.y == null ? 0.22 : W.y), ww = mw * (W.w == null ? 0.7 : W.w), wh = mh * (W.h == null ? 0.55 : W.h);
      PT.win(g, wx, wy, ww, wh, W, R);
    }
    if (s.rail) { const rh = mh * (s.rail.h || 0.33), ry = Y + mh - rh - (s.band ? mh * s.band.h : 0);
      if (s.rail.t === 'solid') { PT.fill(g, X, ry, mw, rh, s.rail.c || '#d9d6cf'); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(X, ry + rh - 1, mw, 1); }
      else if (s.rail.t === 'glass') { g.fillStyle = 'rgba(190,210,220,.55)'; g.fillRect(X, ry, mw, rh); PT.fill(g, X, ry, mw, Math.max(1, rh * 0.08), s.rail.c || '#c8cbce'); }
      else { PT.fill(g, X, ry, mw, Math.max(1, rh * 0.1), s.rail.c || '#6c6f72'); g.fillStyle = PT.css(s.rail.c || '#6c6f72'); for (let u = X; u < X + mw; u += Math.max(2, mw / 18)) g.fillRect(u, ry, 1, rh); } }
    if (s.ac && R() < s.ac) PT.fill(g, X + mw * (0.05 + 0.7 * R()), Y + mh * 0.78, mw * 0.16, mh * 0.12, '#e4e4e0');
    if (s.band) { PT.fill(g, X, Y + mh * (1 - s.band.h), mw, mh * s.band.h, s.band.c); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(X, Y + mh - 1, mw, 1); }
  }
};
// 1階（お店・入口）の質感：tb ます × 1階。s：{ wall, t: 'shop'（ガラスの店先）| 'entr'（入口つき）| 'plain', aw（ひさしの色）, sign（看板の帯の色）, sh（シャッター の わり）}
PT.ground = (g, w, h, s, R) => {
  const tb = s.tb || 4, mw = w / tb;
  PT.wallMat(g, 0, 0, w, h, s.wall || {}, R);
  for (let i = 0; i < tb; i++) {
    const X = i * mw;
    if (s.t === 'shop') {
      if (s.sh && R() < s.sh) PT.shutter(g, X + mw * 0.06, h * 0.3, mw * 0.88, h * 0.7, s.shc || '#a9adb0');
      else { PT.win(g, X + mw * 0.06, h * 0.3, mw * 0.88, h * 0.7, { f: s.f || '#3a3d40', fw: Math.max(1, mw * 0.03), div: [2, 1], g0: '#c9d6de', g1: '#5d6a72', lit: 0.5 }, R);
        g.fillStyle = 'rgba(255,240,210,.35)'; g.fillRect(X + mw * 0.1, h * 0.65, mw * 0.8, h * 0.3); }
      if (s.sign) PT.fill(g, X, h * 0.1, mw, h * 0.16, s.sign);
      if (s.aw) { const ag = g.createLinearGradient(0, h * 0.22, 0, h * 0.3); ag.addColorStop(0, PT.css(s.aw, 1.1)); ag.addColorStop(1, PT.css(s.aw, 0.75)); g.fillStyle = ag; g.fillRect(X, h * 0.22, mw, h * 0.08); }
    } else if (s.t === 'entr') {
      if (i === Math.floor(tb / 2)) PT.door(g, X + mw * 0.15, h * 0.28, mw * 0.7, h * 0.72, { gl: true, n: 2, f: s.f || '#5d6266' }, R);
      else PT.win(g, X + mw * 0.15, h * 0.3, mw * 0.7, h * 0.45, Object.assign({ f: '#dad8d2', div: [2, 1] }, s.win || {}), R);
    } else if (s.win) PT.win(g, X + mw * 0.15, h * 0.3, mw * 0.7, h * 0.45, s.win, R);
  }
};
// 手すり（すかし。alpha）：t 'bar'（たて格子）・'mesh'（あみ）・'glass'（くもりガラス）・'solid'（板）
A.railTex = (t = 'bar', c = '#6c6f72') => A.tex('rail:' + t + ':' + c, 64, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  if (t === 'solid' || t === 'glass') { g.fillStyle = t === 'glass' ? 'rgba(200,214,222,1)' : PT.css(c); g.fillRect(0, h * 0.06, w, h * 0.94); PT.fill(g, 0, 0, w, h * 0.08, t === 'glass' ? '#b8bcc0' : A.mul(c, 0.85)); if (t === 'glass') { PT.fill(g, 0, 0, w * 0.04, h, '#b8bcc0'); } }
  else { PT.fill(g, 0, 0, w, h * 0.1, c); PT.fill(g, 0, h * 0.9, w, h * 0.1, c); const st = t === 'mesh' ? w / 16 : w / 8; for (let u = 0; u < w; u += st) PT.fill(g, u, 0, Math.max(1, st * 0.25), h, c); if (t === 'mesh') for (let v = 0; v < h; v += st) PT.fill(g, 0, v, w, Math.max(1, st * 0.2), c); }
}, { alpha: true });

/* ---------- 建物を組み立てる（入口） ----------
   b：{ id, kind, floors, lk（見た目 1〜10。なければ id から自動）, set（区画 'X,Y' の Set）か cells（[[X, Y], …]） }
   g0：地面のいちばん高いところ（ワールドの y）・gmin：いちばん低いところ（ワールドの y）
   o：{ lod（2 近く・1 中・0 遠く）, front（道のほうの向き [nx, nz]）, cs（区画の大きさ m。10） }
   返り値：いちばん高いところ（ワールドの y） */
A.looksOf = kind => { const K = A.KIND[kind], ar = K && A.ARCH[K.a]; return (K && K.o.looks) || (ar && ar.looks) || A.ARCH.box.looks; };
A.lookOf = (b, n) => { const k = b.lk | 0; return k >= 1 && k <= n ? k : 1 + Math.floor(A.hash(b.id | 0, 11) * n) % n; };
/* 向き（t65・DB の更新103）：b.rot（正面の方角。北 0・東 90・南 180・西 270。15度ずつ）。なければ 道のほう（o.front）へ自動（ななめにするのは 小さい建物だけ）
   90度ずつのときは ます目のまま（正面だけ）。ななめのときは 区画の中に入る いちばん大きな長方形に建てて 回す（P.tilt。型は うしろに さがらなくてよい）
   返り値：null（ます目のまま・正面は道のほう）・{ fr }（正面の向き）・{ fr: [0, 1], rc, rs, w, d, cx, cz }（ななめ。cx, cz：区画の北西からの 長方形の まん中 m） */
A.ROT_AUTO_MAX = 8;
const RI = new Map();
const rrMax = (W, D, ang) => {   // W×D の中に入る、ang だけ回した いちばん大きな長方形（その向きの はば・おく）
  if (W <= 0 || D <= 0) return [0, 0];
  const wl = W >= D, Lg = wl ? W : D, Sh = wl ? D : W, sa = Math.abs(Math.sin(ang)), ca = Math.abs(Math.cos(ang));
  if (Sh <= 2 * sa * ca * Lg || Math.abs(sa - ca) < 1e-9) { const x = 0.5 * Sh; return wl ? [x / sa, x / ca] : [x / ca, x / sa]; }
  const c2 = ca * ca - sa * sa; return [(W * ca - D * sa) / c2, (D * ca - W * sa) / c2];
};
const inscribe = (rel, cs, phi) => {   // 区画（rel：北西からの番号）の中に入る、phi だけ回した いちばん大きな長方形（目にして ヒストグラムで）
  const set = new Set(rel.map(c => c[0] + ',' + c[1])), c = Math.cos(phi), sn = Math.sin(phi);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [X, Y] of rel) for (let k = 0; k < 4; k++) { const x = (X + (k & 1)) * cs, z = (Y + (k >> 1)) * cs, u = x * c + z * sn, v = -x * sn + z * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  const r = Math.max(0.5, Math.min(4, Math.sqrt(rel.length) * cs / 30)), nu = Math.max(1, Math.ceil((u1 - u0) / r)), nv = Math.max(1, Math.ceil((v1 - v0) / r));
  const IN = new Uint8Array((nu + 1) * (nv + 1));
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const u = u0 + i * r, v = v0 + j * r, x = u * c - v * sn, z = u * sn + v * c; IN[j * (nu + 1) + i] = set.has(Math.floor(x / cs + 1e-6) + ',' + Math.floor(z / cs + 1e-6)) && set.has(Math.floor(x / cs - 1e-6) + ',' + Math.floor(z / cs - 1e-6)) ? 1 : 0; }
  const hgt = new Int32Array(nu); let best = 0, bi = 0, bj = 0, bw = 0, bh = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, ok = IN[a] && IN[a + 1] && IN[a + nu + 1] && IN[a + nu + 2]; hgt[i] = ok ? hgt[i] + 1 : 0; }
    const st = [];
    for (let i = 0; i <= nu; i++) { const h = i < nu ? hgt[i] : 0; let s0 = i;
      while (st.length && st[st.length - 1][1] >= h) { const [si, sh] = st.pop(); const ar2 = sh * (i - si); if (ar2 > best) { best = ar2; bi = si; bw = i - si; bh = sh; bj = j - sh + 1; } s0 = si; }
      st.push([s0, h]); }
  }
  if (!best) return null;
  const cu = u0 + (bi + bw / 2) * r, cv = v0 + (bj + bh / 2) * r;
  return { w: bw * r, d: bh * r, cx: cu * c - cv * sn, cz: cu * sn + cv * c };
};
A.orient = (b, rel, cs, front) => {
  let beta = null, auto = false;
  if (b.rot != null && b.rot !== '' && isFinite(b.rot)) beta = ((Math.round(+b.rot / 15) * 15) % 360 + 360) % 360;
  else if (front) { beta = ((Math.round(Math.atan2(front[0], -front[1]) * 180 / Math.PI / 15) * 15) % 360 + 360) % 360; auto = true; }
  if (beta == null) return null;
  const br = beta * Math.PI / 180, fr = [Math.sin(br), -Math.cos(br)];
  if (beta % 90 === 0 || (auto && rel.length > A.ROT_AUTO_MAX)) return { fr: auto ? front : fr };
  const key = (b.id | 0) + ':' + beta + ':' + rel.length + ':' + rel.reduce((a, c) => (a * 31 + c[0] * 7 + c[1]) | 0, 0);
  let R0 = RI.get(key);
  if (R0 === undefined) {
    const phi = br + Math.PI;   // 長方形の ローカルの南（+z）が 正面の方角を向くように
    let W = 0, D = 0; for (const c of rel) { if (c[0] + 1 > W) W = c[0] + 1; if (c[1] + 1 > D) D = c[1] + 1; }
    if (W * D === rel.length) { const [w, d] = rrMax(W * cs, D * cs, phi); R0 = { w, d, cx: W * cs / 2, cz: D * cs / 2 }; }
    else R0 = inscribe(rel, cs, phi);
    if (R0) { R0.rc = Math.cos(phi); R0.rs = Math.sin(phi); R0.ratio = R0.w * R0.d / (rel.length * cs * cs); }
    if (RI.size > 60000) RI.clear(); RI.set(key, R0 || null);
  }
  if (!R0 || R0.w < 3 || R0.d < 3 || R0.ratio < (auto ? 0.45 : 0.12)) return { fr: auto ? front : fr };   // 小さくなりすぎるときは ます目のまま
  return { fr: [0, 1], rc: R0.rc, rs: R0.rs, w: R0.w, d: R0.d, cx: R0.cx, cz: R0.cz };
};
// ななめの建物：長方形の形 F と、原点（北西のかど）を B に
const tiltSet = (B, OR, X0, Y0, cs) => {
  B.rc = OR.rc; B.rs = OR.rs;
  const hx = OR.w / 2, hz = OR.d / 2, Cx = X0 * cs + OR.cx, Cz = Y0 * cs + OR.cz;
  B.ox = (Cx - (hx * OR.rc - hz * OR.rs)) * A.U; B.oz = (Cz - (hx * OR.rs + hz * OR.rc)) * A.U;
};
A.build = (B, b, g0, gmin, o = {}) => {
  const cells = b.cells || [...b.set].map(k => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1)]; });
  if (!cells.length) return g0;
  const K = A.KIND[b.kind] || { a: 'box', o: {} }, ar = A.ARCH[K.a] || A.ARCH.box;
  const looks = (K.o.looks) || ar.looks || A.ARCH.box.looks, li = A.lookOf(b, looks.length), L = looks[li - 1];
  B.rc = 1; B.rs = 0;
  if ((o.lod | 0) < 0) return A.buildFar(B, b, cells, g0, gmin, o, K, ar, L, li);
  const cs = o.cs || 10, fl = Math.max(0, b.floors | 0);
  let X0 = Infinity, Y0 = Infinity; for (const c of cells) { if (c[0] < X0) X0 = c[0]; if (c[1] < Y0) Y0 = c[1]; }
  const rel = cells.map(c => [c[0] - X0, c[1] - Y0]), OR = fl > 0 ? A.orient(b, rel, cs, o.front || null) : null;
  let F, front = o.front || null, tilt = false;
  if (OR && OR.rc != null) { F = mkFoot([[[0, 0], [OR.w, 0], [OR.w, OR.d], [0, OR.d]]], { n: cells.length, X0, Y0, cs, cells: rel, tilt: true }); front = [0, 1]; tilt = true; }
  else { F = A.foot(cells, cs); if (OR) front = OR.fr; }
  const P = { id: b.id | 0, kind: b.kind, pr: A.pOf(b.kind) || {}, f: fl, F, ko: K.o, look: li, lod: o.lod == null ? 2 : o.lod,
    yb: Math.min(0, (gmin - g0) / A.U) - 0.4, rng: A.rng((b.id | 0) * 7 + li * 1013), front, cs, tilt, rot: b.rot == null ? null : +b.rot, sc: b.sc || null };
  if (tilt) tiltSet(B, OR, X0, Y0, cs); else { B.ox = F.X0 * cs * A.U; B.oz = F.Y0 * cs * A.U; }
  B.oy = g0; B.top = 0; B.jit = 0.95 + 0.08 * A.hash(b.id | 0, 6);
  const mk = B.mark();
  try { ar.build(B, L, P); }
  catch (e) { B.undo(mk); B.top = 0; if (!A._err) { A._err = 1; console.error('M3A', b.kind, e); } A.ARCH.box.build(B, A.ARCH.box.looks[0], P); }
  B.rc = 1; B.rs = 0;
  return g0 + B.top * A.U;
};
// 高さ（壁の上 m）のめやす：階 f・1階の高さ fh・床の高さ base
A.hgt = (f, fh, base = 0) => base + Math.max(1, f) * fh;
/* 遠く（lod -1。いちばん軽く：1つの建物で 頂点 30〜40）：型の far(L, P) の めやすで、長方形の箱と かんたんな屋根だけ
   far(L, P) → { H（壁の上 m）, base（床 m）, wall（壁の質感の名前）, bw, fh（その質感の 柱間・階の m。tb・tf も）, roof（屋根の質感の名前か null）, rc（屋根の色）,
                 rt: 'flat' | 'gable' | 'hip'（小さい建物だけ。大きいと平ら）, p（勾配）, ins（区画からさがる m）, wc（壁の色。ふつうは白） }
   far がない型は、プリセットの色の ふつうの箱。P は { id, kind, pr, f, ko, look, rng }（F はない） */
const FARC = new Map();
const farDef = (P) => {
  const pr = P.pr || {}, use = pr.use || '', f = P.f, k = use + ':' + (f > 2 ? 'm' : 'l');
  if (!FARC.has(k)) {
    const win = use === 'factory' || use === 'warehouse' || use === 'farm' || use === 'parking' || use === 'port' || use === 'plaza' ? null : { f: '#9aa0a4', div: [2, 1], cur: 0.3 };
    FARC.set(k, A.tex('far:' + k, 128, 128, (g, w, h, R) => PT.grid(g, w, h, { wall: { t: win ? 'stucco' : 'metal', c: win ? '#dcd8d0' : '#b8bcbe' }, tb: 2, tf: 2, win }, R)));
  }
  const home = use === 'home' && f <= 3;
  return { H: f > 0 ? 0.3 + f * (use === 'factory' || use === 'warehouse' ? 6 : home ? 2.9 : 3.4) : 0.3, base: 0.3, wall: FARC.get(k), bw: 3.2, fh: use === 'factory' || use === 'warehouse' ? 6 : 3.2, tb: 2, tf: 2,
    roof: null, rc: home ? [0.35, 0.36, 0.38] : [0.55, 0.56, 0.56], rt: home ? 'gable' : 'flat', p: 0.45, ins: home ? 1.2 : 0.5 };
};
A.buildFar = (B, b, cells, g0, gmin, o, K, ar, L, li) => {
  const cs = o.cs || 10;
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity; for (const c of cells) { if (c[0] < X0) X0 = c[0]; if (c[1] < Y0) Y0 = c[1]; if (c[0] > X1) X1 = c[0]; if (c[1] > Y1) Y1 = c[1]; }
  const P = { id: b.id | 0, kind: b.kind, pr: A.pOf(b.kind) || {}, f: Math.max(0, b.floors | 0), ko: K.o, look: li, rng: A.rng((b.id | 0) * 7 + li * 1013), cs,
    n: cells.length, w: (X1 - X0 + 1) * cs, d: (Y1 - Y0 + 1) * cs };   // n：区画の数・w, d：はば・おく（m）
  let sp = null; try { sp = ar.far ? ar.far(L, P) : null; } catch (e) { sp = null; }
  if (!sp) sp = farDef(P);
  B.ox = X0 * cs * A.U; B.oz = Y0 * cs * A.U; B.oy = g0; B.top = 0; B.jit = 0.95 + 0.08 * A.hash(b.id | 0, 6);
  // ななめの向き（t65）：近くと同じ長方形に
  const OR = P.f > 0 ? A.orient(b, cells.map(c => [c[0] - X0, c[1] - Y0]), cs, o.front || null) : null, tilt = OR && OR.rc != null;
  if (tilt) tiltSet(B, OR, X0, Y0, cs);
  // 行ごとの長方形 → 同じはばの行をまとめる（前の 3D と同じ）
  const rows = new Map();
  for (const c of cells) { const y = c[1] - Y0; let r = rows.get(y); if (!r) rows.set(y, r = []); r.push(c[0] - X0); }
  const runs = [];
  for (const [y, xs] of rows) { xs.sort((p, q) => p - q); let s0 = xs[0], p = xs[0]; for (let i = 1; i <= xs.length; i++) { if (i < xs.length && xs[i] === p + 1) { p = xs[i]; continue; } runs.push([s0, p, y]); if (i < xs.length) s0 = p = xs[i]; } }
  runs.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
  let rects = [];
  for (const r of runs) { const l = rects[rects.length - 1]; if (l && l[0] === r[0] && l[2] === r[1] && l[3] + 1 === r[2]) l[3] = r[2]; else rects.push([r[0], r[2], r[1], r[2]]); }
  if (tilt) rects = [[0, 0, OR.w / cs - 1, OR.d / cs - 1]];   // ななめは 長方形1つ（区画の単位にして 下で m に）
  const one = rects.length === 1, ins = one ? (tilt ? Math.min(sp.ins || 0, 0.3) : (sp.ins || 0)) : 0, H = Math.max(0.2, sp.H || 3), base = sp.base || 0, slope = (g0 - gmin) / A.U > 0.3, yb = Math.min(0, (gmin - g0) / A.U) - 0.3;
  const wm = sp.wall || 'c', wc = sp.wc || WHITE, bw = sp.bw || 3.2, fh = sp.fh || 3.2, tb = sp.tb || 1, tf = sp.tf || 1;
  for (const R0 of rects) {
    const x0 = R0[0] * cs + ins, z0 = R0[1] * cs + ins, x1 = (R0[2] + 1) * cs - ins, z1 = (R0[3] + 1) * cs - ins;
    // 坂（30cm より）なら 土台（コンクリート）を地面まで。平らなら 壁を少し下まで のばすだけ
    const yw = slope ? base : Math.min(base, yb), v0 = (yw - base) / fh / tf;
    const U = L2 => [0, Math.max(1, Math.round(L2 / bw)) / tb, v0, (H - base) / fh / tf];
    if (P.f > 0) { const w = x1 - x0, d = z1 - z0;
      B.wall(wm, x0, z0, x1, z0, yw, H, wc, U(w), 0.85); B.wall(wm, x1, z0, x1, z1, yw, H, wc, U(d), 0.85); B.wall(wm, x1, z1, x0, z1, yw, H, wc, U(w), 0.85); B.wall(wm, x0, z1, x0, z0, yw, H, wc, U(d), 0.85); }
    if (slope || P.f <= 0) { const c2 = P.f > 0 ? [0.66, 0.65, 0.62] : A.mul(sp.ct || [0.6, 0.6, 0.58], 0.85); B.wall('c', x0, z0, x1, z0, yb, base, c2); B.wall('c', x1, z0, x1, z1, yb, base, c2); B.wall('c', x1, z1, x0, z1, yb, base, c2); B.wall('c', x0, z1, x0, z0, yb, base, c2); }
    const big = Math.min(x1 - x0, z1 - z0) > 24;
    if (P.f > 0 && (sp.rt === 'gable' || sp.rt === 'hip') && !big) B.roof({ t: sp.rt, r: [x0, z0, x1, z1], y: H, p: sp.p || 0.45, oh: 0.4, th: 0, m: sp.roof || 'c', c: sp.roof ? WHITE : (sp.rc || [0.4, 0.4, 0.42]), su: 4, mg: wm, cg: wc, gsu: bw * tb, gsv: fh * tf });
    else B.flat(sp.top || 'c', [x0, z0, x1, z1], P.f > 0 ? H : base, sp.ct || sp.rc || [0.55, 0.56, 0.56], { su: sp.top ? (sp.tsu || 8) : 0 });
  }
  B.rc = 1; B.rs = 0;
  return g0 + B.top * A.U;
};

/* ---------- 1階のお店の看板の帯（横線。t65・DB の更新103） ----------
   A.shopBand(B, P, e, y0, y1, o)：辺 e の外 o.off（0.06m）に、y0〜y1 の帯。o：{ from, to（辺のはじめから m）, def: [c1, c2, c3]（見た目の色）, base（帯の地の色。白）,
     pat: 'stripes'（コンビニのような 横線3本）| 'solid'（c1 の帯に 上下の細い線 c2・c3）| 'awning'（c1 の日よけと c2 の帯） }
   P.sc：1階のお店の部屋ごとの色（持ち主・入っている会社がえらぶ。[[c1, c2, c3] か null, …]。なければ null）。部屋の数で 帯を同じはばに分けて、えらんだ色で描く */
A.shopBand = (B, P, e, y0, y1, o = {}) => {
  const f0 = o.from || 0, f1 = o.to == null ? e.L : o.to, off = o.off == null ? 0.06 : o.off, base = o.base || '#f4f4f2', def = o.def || ['#2f7d4a', '#e0a020', '#c8322d'];
  const sc = P && P.sc && P.sc.length ? P.sc : [null], k = sc.length, H = y1 - y0, pat = o.pat || 'stripes';
  for (let i = 0; i < k; i++) {
    const c = sc[i] && sc[i].length ? [sc[i][0] || def[0], sc[i][1] || def[1], sc[i][2] || def[2]] : def;
    const a = f0 + (f1 - f0) * i / k, b = f0 + (f1 - f0) * (i + 1) / k, gap = k > 1 ? 0.15 : 0;
    const band = (h0, h1, cc, o2) => B.wallE('cp', e, y0 + H * h0, y0 + H * h1, cc, { from: a + gap, to: b - gap, off: off + (o2 || 0) });
    if (pat === 'solid') { band(0, 1, c[0]); band(0, 0.12, c[1], 0.01); band(0.88, 1, c[2], 0.01); }
    else if (pat === 'awning') { band(0.45, 1, c[1]); band(0, 0.42, c[0], 0.01); }
    else { band(0, 1, base); band(0.62, 0.8, c[0], 0.01); band(0.42, 0.56, c[1], 0.01); band(0.26, 0.36, c[2], 0.01); }
  }
};

/* ---------- 小物（3D の編集モードで 自分の土地に置く。t65・DB の更新103） ----------
   A.prop(kind, { n: '名前', col: true（色をえらべる）, cols: ['#…', …]（えらべる色）, build(B, P) })：原点が 小物のまん中の地面。+z が 正面。P = { col（色）, lod, rng }
   A.buildProp(B, pr, gy, o)：pr = { id, kind, x, y（マス）, rot（度。正面の方角 北0・東90・南180・西270）, col }。gy：地面の高さ（ワールド） */
A.PROP = A.PROP || {};
A.prop = (k, d) => { d.k = k; A.PROP[k] = d; return d; };
A.buildProp = (B, pr, gy, o = {}) => {
  const d = A.PROP[pr.kind]; if (!d) return gy;
  const br = ((+pr.rot || 0) % 360) * Math.PI / 180, phi = br + Math.PI;   // ローカルの +z（正面）が 方角 rot を向く
  B.rc = Math.cos(phi); B.rs = Math.sin(phi); B.ox = pr.x; B.oz = pr.y; B.oy = gy; B.top = 0; B.jit = 1;
  const mk = B.mark();
  try { d.build(B, { col: pr.col || (d.cols && d.cols[0]) || null, lod: o.lod == null ? 2 : o.lod, rng: A.rng((pr.id | 0) * 13 + 7) }); }
  catch (e) { B.undo(mk); if (!A._perr) { A._perr = 1; console.error('M3A prop', pr.kind, e); } }
  B.rc = 1; B.rs = 0;
  return gy + B.top * A.U;
};

/* ---------- ふつうの箱（どの型でもないとき・見本） ---------- */
A.arch('box', {
  looks: [
    { n: 'コンクリート', wall: { t: 'panel', c: '#cfcac0', dirt: 0.12 }, win: { f: '#9aa0a4', div: [2, 1], cur: 0.3, bl: 0.3 } },
    { n: 'ベージュのタイル', wall: { t: 'tile', c: '#d9c7a8' }, win: { f: '#5f5a52', div: [2, 1], bl: 0.4 } },
    { n: '白い外壁', wall: { t: 'stucco', c: '#eeece6' }, win: { f: '#7e8790', div: [2, 1], cur: 0.4 } },
    { n: 'グレーのガラス', wall: { t: 'panel', c: '#8f989f', pw: 40 }, win: { f: '#5d666d', div: [1, 1], x: 0.04, w: 0.92, y: 0.1, h: 0.8, g0: '#a9bccb', g1: '#3f5263' } }
  ],
  build(B, L, P) {
    const F = A.inset(P.F, P.f > 3 ? 0.5 : 1.0), fh = 3.3, base = 0.15, H = P.f > 0 ? A.hgt(P.f, fh, base) : 0.3;
    if (P.lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, base + 0.01);
    if (P.f <= 0) { B.cap('c', F, 0.3, [0.62, 0.62, 0.6]); return; }
    const key = 'box:' + P.look, m = A.tex(key + ':w', 256, 256, (g, w, h, R) => PT.grid(g, w, h, { wall: L.wall, tb: 4, tf: 4, win: L.win, band: { h: 0.06, c: A.mul(L.wall.c, 0.92) } }, R));
    B.facade(m, F, base, H, { bw: 3.2, fh, tb: 4, tf: 4, vy: base, ao: 0.82 });
    const mr = A.tex('roof:membrane:#8d9094', 128, 128, (g, w, h, R) => PT.roofMat(g, w, h, { t: 'membrane', c: '#8d9094' }, R));
    B.cap(mr, F, H, [1, 1, 1], { su: 8 });
    if (P.lod >= 1) B.parapet(F, H, 0.9, 0.3, A.mul(L.wall.c, 0.95));
    if (P.lod >= 2 && P.f >= 3) B.rooftop(F, H, P.rng, { per: 90 });
  }
});
})();
