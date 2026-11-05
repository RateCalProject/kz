/* ===== 風の芽経済組：国土の地図 3D の建物（t65）住まい（型は h_・質感は 'h:'）=====
   戸建て・和風の家・洋館・邸宅・アパート・マンション・タワーマンション・団地・長屋・別荘 など
   ・壁の材料（サイディング・タイル・塗り壁…）は うすい色で描いて、頂点の色で そめる（見た目ごとに 質感を ふやさない）
   ・家の窓・ドアは アトラス（h:win）の ますを 壁の前に はる（lod 1・2）。lod 0 と 遠く（far）は 窓を描いた 質感（h:far…）
   ・lod 2 近く：塀・車・自転車・洗たく物・室外機・木 など / 1 中：窓・ベランダ・屋根 / 0 遠く：箱と屋根だけ */
(function () {
'use strict';
const A = window.M3A, PT = A.paint;
const WH = [1, 1, 1];
const rnd = (R, a, b) => a + (b - a) * R();
const pick = A.pick, col = A.col, mul = A.mul, mix = A.mix;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TX = (k, w, h, d, o) => A.tex('h:' + k, w, h, d, o);
const HB = 0.45, FH = 2.85, PLC = [0.7, 0.69, 0.66], BALC = [0.74, 0.74, 0.72];   // 家の基礎の高さ・階の高さ（m）

/* ---------- 形の道具 ---------- */
// 長方形の 4つの辺（北・東・南・西。外向き）
const redges = r => [
  { ax: r[0], az: r[1], bx: r[2], bz: r[1], nx: 0, nz: -1, L: r[2] - r[0] }, { ax: r[2], az: r[1], bx: r[2], bz: r[3], nx: 1, nz: 0, L: r[3] - r[1] },
  { ax: r[2], az: r[3], bx: r[0], bz: r[3], nx: 0, nz: 1, L: r[2] - r[0] }, { ax: r[0], az: r[3], bx: r[0], bz: r[1], nx: -1, nz: 0, L: r[3] - r[1] }];
// 長方形のあつまり（重なってよい）→ F（A.foot と同じつくり：loops・edges・rects・maxr・bb・w・d・area。座標は そのまま）
// 速さのため core の A.foot・A.inset は 使わず、ここで 目（xs × zs）から 直接 つくる
function rectF(r) {   // 長方形 1つ
  const [x0, z0, x1, z1] = r, w = x1 - x0, d = z1 - z0, es = redges(r); let u = 0;
  for (const e of es) { e.u0 = u; u += e.L; e.li = 0; e.out = true; }
  return { loops: [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]], edges: es, rects: [r], maxr: [r], bb: r, w, d, area: w * d, n: 1, X0: 0, Y0: 0, cs: 10 };
}
function footR(rs) {
  rs = rs.filter(r => r[2] - r[0] > 0.05 && r[3] - r[1] > 0.05); if (!rs.length) return null;
  if (rs.length === 1) return rectF(rs[0]);
  const xs = [...new Set(rs.flatMap(r => [r[0], r[2]]))].sort((a, b) => a - b), zs = [...new Set(rs.flatMap(r => [r[1], r[3]]))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1, occ = new Uint8Array(nx * nz), O = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && occ[j * nx + i] === 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2; for (const r of rs) if (cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) { occ[j * nx + i] = 1; break; } }
  // ふちの 向きつきの辺（外は 画面で時計まわり）→ つないで 線に
  const nxt = new Map(), K = (i, j) => j * (nx + 2) + i;
  const addE = (i0, j0, i1, j1) => { const k = K(i0, j0); let l = nxt.get(k); if (!l) nxt.set(k, l = []); l.push([i1, j1]); };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { if (!O(i, j)) continue;
    if (!O(i, j - 1)) addE(i, j, i + 1, j); if (!O(i + 1, j)) addE(i + 1, j, i + 1, j + 1); if (!O(i, j + 1)) addE(i + 1, j + 1, i, j + 1); if (!O(i - 1, j)) addE(i, j + 1, i, j); }
  const loops = [];
  while (nxt.size) { const k0 = nxt.keys().next().value; let i = k0 % (nx + 2), j = (k0 - i) / (nx + 2), pd = null; const si = i, sj = j, pts = [];
    for (let g = 0; g < 400; g++) { const k = K(i, j), l = nxt.get(k); if (!l || !l.length) break; let q = 0;
      if (l.length > 1 && pd) { const rx = -pd[1], ry = pd[0]; const f = l.findIndex(v => v[0] - i === rx && v[1] - j === ry); if (f >= 0) q = f; }
      const [ni, nj] = l[q]; l.splice(q, 1); if (!l.length) nxt.delete(k); pts.push([i, j]); pd = [ni - i, nj - j]; i = ni; j = nj; if (i === si && j === sj) break; }
    const simp = []; for (let t = 0; t < pts.length; t++) { const p = pts[(t + pts.length - 1) % pts.length], c = pts[t], n2 = pts[(t + 1) % pts.length];
      if (Math.sign(c[0] - p[0]) === Math.sign(n2[0] - c[0]) && Math.sign(c[1] - p[1]) === Math.sign(n2[1] - c[1])) continue; simp.push([xs[c[0]], zs[c[1]]]); }
    if (simp.length >= 4) loops.push(simp); }
  const edges = [];
  loops.forEach((l, li) => { let sg = 0, u = 0; for (let t = 0; t < l.length; t++) { const a = l[t], b = l[(t + 1) % l.length]; sg += a[0] * b[1] - b[0] * a[1]; }
    for (let t = 0; t < l.length; t++) { const a = l[t], b = l[(t + 1) % l.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue; edges.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / L, nz: -dx / L, L, u0: u, li, out: sg > 0 }); u += L; } });
  // 長方形（行ごとに まとめる）と いちばん大きな長方形（屋根に）
  const rects = []; let prev = [];
  for (let j = 0; j < nz; j++) { const next = []; for (let i = 0; i < nx;) { if (!O(i, j)) { i++; continue; } let k = i; while (O(k + 1, j)) k++;
      const o = prev.find(r => r.i0 === i && r.i1 === k); if (o) { o.j1 = j; next.push(o); } else { const r = { i0: i, i1: k, j0: j, j1: j }; rects.push(r); next.push(r); } i = k + 1; } prev = next; }
  const mr = [], okR = (i0, i1, j) => { for (let i = i0; i <= i1; i++) if (!O(i, j)) return false; return true; }, okC = (j0, j1, i) => { for (let j = j0; j <= j1; j++) if (!O(i, j)) return false; return true; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx;) { if (!O(i, j)) { i++; continue; } let k = i; while (O(k + 1, j)) k++; let a = j, b = j; while (a > 0 && okR(i, k, a - 1)) a--; while (b < nz - 1 && okR(i, k, b + 1)) b++; mr.push([i, a, k, b]); i = k + 1; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz;) { if (!O(i, j)) { j++; continue; } let k = j; while (O(i, k + 1)) k++; let a = i, b = i; while (a > 0 && okC(j, k, a - 1)) a--; while (b < nx - 1 && okC(j, k, b + 1)) b++; mr.push([a, j, b, k]); j = k + 1; }
  const U = [];
  for (const r of mr) { if (U.some(q => q[0] <= r[0] && q[1] <= r[1] && q[2] >= r[2] && q[3] >= r[3])) continue; for (let t = U.length - 1; t >= 0; t--) { const q = U[t]; if (r[0] <= q[0] && r[1] <= q[1] && r[2] >= q[2] && r[3] >= q[3]) U.splice(t, 1); } U.push(r); }
  const rr = rects.map(r => [xs[r.i0], zs[r.j0], xs[r.i1 + 1], zs[r.j1 + 1]]); let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, area = 0;
  for (const r of rr) { x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]); x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]); area += (r[2] - r[0]) * (r[3] - r[1]); }
  return { loops, edges, rects: rr, maxr: U.map(r => [xs[r[0]], zs[r[1]], xs[r[2] + 1], zs[r[3] + 1]]), bb: [x0, z0, x1, z1], w: x1 - x0, d: z1 - z0, area, n: 1, X0: 0, Y0: 0, cs: 10 };
}
const proj = (e, x, z) => ((x - e.ax) * (e.bx - e.ax) + (z - e.az) * (e.bz - e.az)) / e.L;   // 辺の はじめからの長さ
const ept = (e, s, off = 0) => [e.ax + (e.bx - e.ax) * s / e.L + e.nx * off, e.az + (e.bz - e.az) * s / e.L + e.nz * off];
const inR = (r, x, z, m = 0) => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m;
const hitR = (a, b, m = 0) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
// 区間 segs から [s0, s1] をのぞく
const cutS = (segs, s0, s1) => { const o = []; for (const g of segs) { const p = g[0], q = g[1]; if (s1 <= p || s0 >= q) o.push(g); else { if (s0 - p > 0.05) o.push([p, s0]); if (q - s1 > 0.05) o.push([s1, q]); } } return o; };
// 辺 e のうち、外がわを ほかの長方形 rs が ふさいでいない ところ
function freeOn(e, rs, ex) {
  let segs = [[0, e.L]];
  for (const q of rs) { if (q === ex) continue;
    let a, b;
    if (e.nz !== 0) { const zo = e.az + e.nz * 0.05; if (!(q[1] < zo && zo < q[3])) continue; const x0 = Math.max(Math.min(e.ax, e.bx), q[0]), x1 = Math.min(Math.max(e.ax, e.bx), q[2]); if (x1 <= x0) continue; a = proj(e, x0, e.az); b = proj(e, x1, e.az); }
    else { const xo = e.ax + e.nx * 0.05; if (!(q[0] < xo && xo < q[2])) continue; const z0 = Math.max(Math.min(e.az, e.bz), q[1]), z1 = Math.min(Math.max(e.az, e.bz), q[3]); if (z1 <= z0) continue; a = proj(e, e.ax, z0); b = proj(e, e.ax, z1); }
    segs = cutS(segs, Math.min(a, b), Math.max(a, b));
  }
  return segs;
}
// 道に面した辺をふくむ いちばん大きい長方形（区画が L 字などのとき 家を建てるところ）
function mainRect(F, fe) {
  const mx = (fe.ax + fe.bx) / 2, mz = (fe.az + fe.bz) / 2; let best = null, ba = -1;
  for (const r of F.maxr) {
    const on = Math.abs(fe.nz) > 0.5 ? Math.abs(mz - (fe.nz > 0 ? r[3] : r[1])) < 0.01 && mx > r[0] && mx < r[2] : Math.abs(mx - (fe.nx > 0 ? r[2] : r[0])) < 0.01 && mz > r[1] && mz < r[3];
    const a = (r[2] - r[0]) * (r[3] - r[1]);
    if (on && a > ba) { ba = a; best = r; }
  }
  return best || F.maxr[0] || F.bb;
}
// 区画の局所の座標：u は道にそって（道から見て右へ）・v は道から奥へ
function frame(R, n) {
  const [x0, z0, x1, z1] = R; let W, D, P;
  if (n[1] > 0.5) { W = x1 - x0; D = z1 - z0; P = (u, v) => [x0 + u, z1 - v]; }
  else if (n[1] < -0.5) { W = x1 - x0; D = z1 - z0; P = (u, v) => [x1 - u, z0 + v]; }
  else if (n[0] > 0.5) { W = z1 - z0; D = x1 - x0; P = (u, v) => [x1 - v, z1 - u]; }
  else { W = z1 - z0; D = x1 - x0; P = (u, v) => [x0 + v, z0 + u]; }
  const rect = (u0, v0, u1, v1) => { const a = P(u0, v0), b = P(u1, v1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
  const o = P(0, 0), pu = P(1, 0), pv = P(0, 1);
  return { W, D, P, rect, n, du: [pu[0] - o[0], pu[1] - o[1]], dv: [pv[0] - o[0], pv[1] - o[1]] };
}
const angOf = d => Math.atan2(d[1], d[0]);
const roofs = (B, F, o) => B.roofs(F, o), roof1 = (B, o) => B.roof(o);
/* ---------- 頂点を じかに書く（速さ）----------
   core の B.quad と おなじ数を 書く（配列を つくらない）。読みこみのときに B.quad と くらべて、ちがえば B.quad を つかう
   wq：4つの点 a・b・c・d（反時計まわり）・法線・色・uv（a(u0,v0) b(u1,v0) c(u1,v1) d(u0,v1)）・明るさ ka（a と d）kb（b と c） */
let FASTQ = false;
function wq(B, m, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, c0, u0, v0, u1, v1, ka, kb) {
  // 点の uv・明るさ：a(u0,v0,ka) b(u1,v0,kb) c(u1,v1,kb) d(u0,v1,ka)。まわりの向き（(b-a)×(c-a)）が 法線と逆なら a→d→c・a→c→b の順に（両面の光が 正しくなる）
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const flip = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0;
  if (!FASTQ) {
    if (flip) B.quad(m, [ax, ay, az], [dx, dy, dz], [cx, cy, cz], [bx, by, bz], [nx, ny, nz], c0, [u0, v0, u0, v1, u1, v1, u1, v0], [ka, ka, kb, kb]);
    else B.quad(m, [ax, ay, az], [bx, by, bz], [cx, cy, cz], [dx, dy, dz], [nx, ny, nz], c0, [u0, v0, u1, v1], [ka, kb, kb, ka]);
    return;
  }
  const bf = B.buf(m); bf.need(66); const s = B.s, rc = B.rc, rs = B.rs, ox = B.ox, oy = B.oy, oz = B.oz, S = QS;
  S[0] = ox + (ax * rc - az * rs) * s; S[1] = oy + ay * s; S[2] = oz + (ax * rs + az * rc) * s; S[3] = u0; S[4] = v0; S[5] = ka;
  S[6] = ox + (bx * rc - bz * rs) * s; S[7] = oy + by * s; S[8] = oz + (bx * rs + bz * rc) * s; S[9] = u1; S[10] = v0; S[11] = kb;
  S[12] = ox + (cx * rc - cz * rs) * s; S[13] = oy + cy * s; S[14] = oz + (cx * rs + cz * rc) * s; S[15] = u1; S[16] = v1; S[17] = kb;
  S[18] = ox + (dx * rc - dz * rs) * s; S[19] = oy + dy * s; S[20] = oz + (dx * rs + dz * rc) * s; S[21] = u0; S[22] = v1; S[23] = ka;
  qput(B, bf, flip ? QO1 : QO0, nx * rc - nz * rs, ny, nx * rs + nz * rc, c0);
  const t = Math.max(ay, by, cy, dy); if (t > B.top) B.top = t;
}
// 表 QS の 4つの点（x y z u v 明るさ）を 順 ord で 6つ 書く
const QS = new Float64Array(24), QO0 = [0, 6, 12, 0, 12, 18], QO1 = [0, 18, 12, 0, 12, 6];
function qput(B, bf, ord, rnx, ny, rnz, c0) {
  const o = bf.a, S = QS, cc = col(c0), j = B.jit, r0 = cc[0] * j, g0 = cc[1] * j, b0 = cc[2] * j; let q = bf.n;
  for (let i = 0; i < 6; i++) { const c = ord[i], k = S[c + 5]; o[q] = S[c]; o[q + 1] = S[c + 1]; o[q + 2] = S[c + 2]; o[q + 3] = rnx; o[q + 4] = ny; o[q + 5] = rnz; o[q + 6] = r0 * k; o[q + 7] = g0 * k; o[q + 8] = b0 * k; o[q + 9] = S[c + 3]; o[q + 10] = S[c + 4]; q += 11; }
  bf.n = q; B.nv += 6;
}
// 壁（B.wall と おなじ：a→b の 外向き。uv：u0〜u1・v0〜v1。ao：下のはしの 明るさ）
function wall2(B, m, ax, az, bx, bz, y0, y1, c0, u0, u1, v0, v1, ao) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, k = ao || 1;
  if (!FASTQ) { B.wall(m, ax, az, bx, bz, y0, y1, c0, [u0, u1, v0, v1], ao); return; }
  // B.wall は a 下→a 上→b 上→b 下（uv：u0v0・u0v1・u1v1・u1v0）
  const bf = B.buf(m); bf.need(66); const s = B.s, rc = B.rc, rs = B.rs, S = QS;
  const nx = dz / L, nz = -dx / L, Ax = B.ox + (ax * rc - az * rs) * s, Az = B.oz + (ax * rs + az * rc) * s, Bx = B.ox + (bx * rc - bz * rs) * s, Bz = B.oz + (bx * rs + bz * rc) * s, Y0 = B.oy + y0 * s, Y1 = B.oy + y1 * s;
  // a 下・a 上・b 上・b 下
  S[0] = Ax; S[1] = Y0; S[2] = Az; S[3] = u0; S[4] = v0; S[5] = k;
  S[6] = Ax; S[7] = Y1; S[8] = Az; S[9] = u0; S[10] = v1; S[11] = 1;
  S[12] = Bx; S[13] = Y1; S[14] = Bz; S[15] = u1; S[16] = v1; S[17] = 1;
  S[18] = Bx; S[19] = Y0; S[20] = Bz; S[21] = u1; S[22] = v0; S[23] = k;
  qput(B, bf, QO0, nx * rc - nz * rs, 0, nx * rs + nz * rc, c0);
  if (y1 > B.top) B.top = y1;
}
// 三角（法線は まわりの向きから・uv なし）：木・植えこみ
function wt(B, m, ax, ay, az, bx, by, bz, cx, cy, cz, c0) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); if (L > 1e-12) { nx /= L; ny /= L; nz /= L; } else { nx = 0; ny = 1; nz = 0; }
  if (!FASTQ) { B.tri(m, [ax, ay, az], [bx, by, bz], [cx, cy, cz], [nx, ny, nz], c0); return; }
  const bf = B.buf(m); bf.need(33); const o = bf.a, s = B.s, rc = B.rc, rs = B.rs, ox = B.ox, oy = B.oy, oz = B.oz, cc = col(c0), j = B.jit, rnx = nx * rc - nz * rs, rnz = nx * rs + nz * rc;
  let q = bf.n;
  for (let i = 0; i < 3; i++) { const x = i === 0 ? ax : i === 1 ? bx : cx, y = i === 0 ? ay : i === 1 ? by : cy, z = i === 0 ? az : i === 1 ? bz : cz;
    o[q] = ox + (x * rc - z * rs) * s; o[q + 1] = oy + y * s; o[q + 2] = oz + (x * rs + z * rc) * s; o[q + 3] = rnx; o[q + 4] = ny; o[q + 5] = rnz; o[q + 6] = cc[0] * j; o[q + 7] = cc[1] * j; o[q + 8] = cc[2] * j; o[q + 9] = 0; o[q + 10] = 0; q += 11; if (y > B.top) B.top = y; }
  bf.n = q; B.nv += 3;
}
// 読みこみの ときの くらべ（core と おなじに 書けるか）
(() => { try {
  const mk = () => { const B = new A.Builder(); B.ox = 1.5; B.oy = 0.25; B.oz = -2; B.rc = Math.cos(0.4); B.rs = Math.sin(0.4); B.jit = 0.97; return B; };
  const B1 = mk(), B2 = mk();
  FASTQ = false; wt(B1, 'u', 1, 2, 3, 4, 2, 3, 4, 5, 6, [0.4, 0.5, 0.3]);
  wq(B1, 't', 1, 2, 3, 4, 2, 3, 4, 5, 6, 1, 5, 6, 0, 0, -1, [0.8, 0.7, 0.6], 0.1, 0.2, 0.9, 0.8, 0.85, 1); wq(B1, 't', 1, 2, 3, 4, 2, 3, 4, 5, 6, 1, 5, 6, 0, 0, 1, [0.8, 0.7, 0.6], 0.1, 0.2, 0.9, 0.8, 0.85, 1);
  B1.wall('t', 2, 3, 7, 1, 0.5, 3.5, [0.5, 0.6, 0.7], [0.2, 1.7, 0.1, 1.2], 0.8);
  FASTQ = true; wt(B2, 'u', 1, 2, 3, 4, 2, 3, 4, 5, 6, [0.4, 0.5, 0.3]);
  wq(B2, 't', 1, 2, 3, 4, 2, 3, 4, 5, 6, 1, 5, 6, 0, 0, -1, [0.8, 0.7, 0.6], 0.1, 0.2, 0.9, 0.8, 0.85, 1); wq(B2, 't', 1, 2, 3, 4, 2, 3, 4, 5, 6, 1, 5, 6, 0, 0, 1, [0.8, 0.7, 0.6], 0.1, 0.2, 0.9, 0.8, 0.85, 1); wall2(B2, 't', 2, 3, 7, 1, 0.5, 3.5, [0.5, 0.6, 0.7], 0.2, 1.7, 0.1, 1.2, 0.8);
  let ok = B1.nv === B2.nv && Math.abs(B1.top - B2.top) < 1e-9;
  for (const key of ['t', 'u']) { const a = B1.buf(key), b = B2.buf(key); if (a.n !== b.n) ok = false; for (let i = 0; ok && i < a.n; i++) if (Math.abs(a.a[i] - b.a[i]) > 1e-6) ok = false; }
  FASTQ = ok;
} catch (e) { FASTQ = false; } })();

/* ---------- 質感：外壁の材料（白っぽく描いて 頂点の色で そめる） ---------- */
const wrapR = (g, x, y, w, h, W, H) => { for (const dx of [0, -W, W]) for (const dy of [0, -H, H]) { const X = x + dx, Y = y + dy; if (X < W && X + w > 0 && Y < H && Y + h > 0) g.fillRect(X, Y, w, h); } };
const MAT = {};   // 材料：{ k（質感の名前）, su, sv（1枚の m）}
const mat = (name, su, sv, w, h, draw) => (MAT[name] = { k: TX('w_' + name, w, h, draw), su, sv });
mat('siding', 3, 3, 256, 256, (g, w, h, R) => {   // 窯業系サイディング（横ばり）
  const n = 16, st = h / n;
  for (let i = 0; i < n; i++) { const y = i * st, gr = g.createLinearGradient(0, y, 0, y + st);
    gr.addColorStop(0, '#fefdfb'); gr.addColorStop(0.78, '#f5f3ef'); gr.addColorStop(1, '#dedad3'); g.fillStyle = gr; g.fillRect(0, y, w, st);
    g.fillStyle = 'rgba(50,45,40,.26)'; g.fillRect(0, y + st - Math.max(1, st * 0.09), w, Math.max(1, st * 0.09)); }
  g.fillStyle = 'rgba(90,90,90,.3)'; g.fillRect(0, 0, Math.max(1, w * 0.008), h);   // たての目地
  PT.noise(g, 0, 0, w, h, 0.018, R);
});
mat('tile', 3, 3, 256, 256, (g, w, h, R) => {   // タイル調
  PT.fill(g, 0, 0, w, h, '#c4bfb6');
  const cols = 10, rows = 30, tw = w / cols, th = h / rows, j1 = Math.max(1, w / 256);
  for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) {
    const x = (i + (j % 2) * 0.5) * tw, k = R() < 0.1 ? 0.84 + R() * 0.06 : 0.94 + R() * 0.09;
    g.fillStyle = PT.css('#f3efe8', k); g.fillRect(x + j1, j * th + j1, tw - j1 * 1.5, th - j1 * 1.5);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + j1, j * th + j1, tw - j1 * 1.5, Math.max(1, th * 0.16));
  }
  PT.noise(g, 0, 0, w, h, 0.02, R);
});
mat('stone', 3, 3, 256, 256, (g, w, h, R) => {   // 石積み調
  PT.fill(g, 0, 0, w, h, '#aaa69e');
  const rows = 14, th = h / rows, jw = Math.max(1, w / 220);
  for (let j = 0; j < rows; j++) { const x0 = R() * w * 0.2; let x = x0;
    while (x < x0 + w - 1) { const sw = Math.min(w * (0.07 + 0.13 * R()), x0 + w - x), k = 0.84 + R() * 0.22;
      g.fillStyle = PT.css('#efece6', k); wrapR(g, x + jw, j * th + jw, sw - jw, th - jw, w, h);
      g.fillStyle = 'rgba(255,255,255,.15)'; wrapR(g, x + jw, j * th + jw, sw - jw, Math.max(1, th * 0.13), w, h);
      g.fillStyle = 'rgba(0,0,0,.1)'; wrapR(g, x + jw, (j + 1) * th - Math.max(1, th * 0.16), sw - jw, Math.max(1, th * 0.16), w, h);
      x += sw; } }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
mat('stucco', 4, 4, 256, 256, (g, w, h, R) => {   // 塗り壁・吹付け
  PT.fill(g, 0, 0, w, h, '#f6f5f1');
  for (let i = 0; i < 160; i++) { const x = R() * w, y = R() * h, r = w * (0.01 + 0.03 * R()), a = R() * 3; g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.018)';
    for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) { g.beginPath(); g.ellipse(x + dx, y + dy, r * 1.7, r, a, 0, 6.283); g.fill(); } }
  PT.noise(g, 0, 0, w, h, 0.014, R);
});
mat('galva', 3, 3, 256, 256, (g, w, h, R) => {   // ガルバリウム鋼板（たての角波）
  const n = 24, st = w / n;
  for (let i = 0; i < n; i++) { const x = i * st, gr = g.createLinearGradient(x, 0, x + st, 0);
    gr.addColorStop(0, '#c4c7cb'); gr.addColorStop(0.16, '#f3f4f5'); gr.addColorStop(0.3, '#e2e4e6'); gr.addColorStop(0.74, '#dadcdf'); gr.addColorStop(0.86, '#adb1b5'); gr.addColorStop(1, '#c4c7cb');
    g.fillStyle = gr; g.fillRect(x, 0, st, h); }
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, w, Math.max(1, h * 0.006));
  PT.noise(g, 0, 0, w, h, 0.01, R);
});
mat('board', 3, 3, 256, 256, (g, w, h, R) => {   // たて板ばり（木・焼杉）
  const n = 16, st = w / n;
  for (let i = 0; i < n; i++) { const x = i * st; PT.fill(g, x, 0, st, h, '#e8dac4', 0.84 + R() * 0.22);
    for (let q = 0; q < 6; q++) { g.fillStyle = `rgba(90,60,30,${0.05 + R() * 0.08})`; g.fillRect(x + R() * st, 0, Math.max(1, st * 0.06), h); }
    g.fillStyle = 'rgba(30,20,10,.5)'; g.fillRect(x + st - Math.max(1, st * 0.1), 0, Math.max(1, st * 0.1), h); }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
mat('brick', 2.4, 2.4, 256, 256, (g, w, h, R) => {   // レンガ（このままの色）
  PT.fill(g, 0, 0, w, h, '#cfc7ba');
  const cols = 11, rows = 36, bw = w / cols, bh = h / rows, j = Math.max(1, w / 220), pal = ['#a8563a', '#b4613f', '#9b4c34', '#b86b48', '#8f4631', '#a35a3e', '#c07650'];
  for (let r = 0; r < rows; r++) for (let i = -1; i <= cols; i++) { const x = (i + (r % 2) * 0.5) * bw; g.fillStyle = PT.css(pick(R, pal), 0.9 + R() * 0.18); g.fillRect(x + j, r * bh + j, bw - j * 1.6, bh - j * 1.6); }
  PT.noise(g, 0, 0, w, h, 0.035, R);
});
mat('log', 3, 3, 128, 128, (g, w, h, R) => {   // 丸太（このままの色）
  const n = 10, st = h / n;
  for (let i = 0; i < n; i++) { const y = i * st, gr = g.createLinearGradient(0, y, 0, y + st);
    gr.addColorStop(0, '#6e4a2a'); gr.addColorStop(0.2, '#c18f5a'); gr.addColorStop(0.5, '#d9a971'); gr.addColorStop(0.85, '#a87446'); gr.addColorStop(1, '#5a3a20'); g.fillStyle = gr; g.fillRect(0, y, w, st); }
  PT.noise(g, 0, 0, w, h, 0.04, R);
});
mat('timber', 3.6, 2.85, 256, 256, (g, w, h, R) => {   // ハーフティンバー（白いしっくいに 木の骨組み。このままの色）
  PT.fill(g, 0, 0, w, h, '#f1ede4'); PT.noise(g, 0, 0, w, h, 0.03, R);
  const bc = '#5a4030', bw = Math.max(2, w * 0.035);
  g.fillStyle = bc; g.fillRect(0, 0, w, bw * 1.2); g.fillRect(0, h - bw * 1.2, w, bw * 1.2); g.fillRect(0, h * 0.5 - bw / 2, w, bw);
  for (const x of [0, w * 0.5]) g.fillRect(x, 0, bw, h);
  g.strokeStyle = bc; g.lineWidth = bw * 0.9; g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w * 0.25, 0); g.moveTo(w * 0.5, h * 0.5); g.lineTo(w * 0.25, 0); g.moveTo(w * 0.5, h); g.lineTo(w * 0.75, h * 0.5); g.moveTo(w, h); g.lineTo(w * 0.75, h * 0.5); g.stroke();
  PT.noise(g, 0, 0, w, h, 0.02, R);
});
mat('conc', 3.6, 2.7, 256, 256, (g, w, h, R) => {   // コンクリート打ちはなし
  PT.fill(g, 0, 0, w, h, '#c6c4be');
  for (let i = 0; i < 140; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.045)'; const x = R() * w, y = R() * h, r = w * (0.03 + 0.07 * R()); for (const dx of [0, -w, w]) { g.beginPath(); g.arc(x + dx, y, r, 0, 6.283); g.fill(); } }
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let k = 0; k < 3; k++) g.fillRect(0, k * h / 3, w, Math.max(1, h / 256));
  for (let k = 0; k < 2; k++) g.fillRect(k * w / 2, 0, Math.max(1, w / 256), h);
  g.fillStyle = 'rgba(60,60,60,.45)';
  for (let k = 0; k < 3; k++) for (let q = 0; q < 2; q++) for (const [a, b] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) g.fillRect((q + a) * w / 2 - 1, (k + b) * h / 3 - 1, Math.max(2, w / 120), Math.max(2, w / 120));
  PT.noise(g, 0, 0, w, h, 0.03, R);
});

/* ---------- 質感：屋根 ---------- */
const RMAT = {};
const rmat = (name, su, sv, w, h, draw) => (RMAT[name] = { k: TX('r_' + name, w, h, draw), su, sv });
rmat('kawara', 2.4, 2.4, 256, 256, (g, w, h, R) => {   // 和瓦（いぶし。そめる）
  const cols = 8, rows = 10, tw = w / cols, th = h / rows, c = '#c9ced4';
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = i * tw, y = j * th, k = 0.9 + R() * 0.16, gr = g.createLinearGradient(x, 0, x + tw, 0);
    gr.addColorStop(0, PT.css(c, 0.5 * k)); gr.addColorStop(0.18, PT.css(c, 0.85 * k)); gr.addColorStop(0.38, PT.css(c, 1.08 * k)); gr.addColorStop(0.62, PT.css(c, 0.92 * k)); gr.addColorStop(0.86, PT.css(c, 0.66 * k)); gr.addColorStop(1, PT.css(c, 0.5 * k)); g.fillStyle = gr; g.fillRect(x, y, tw, th); }
  for (let j = 0; j < rows; j++) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, (j + 1) * th - Math.max(1, th * 0.16), w, Math.max(1, th * 0.16)); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, j * th, w, Math.max(1, th * 0.12)); }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
rmat('slate', 3.64, 2.2, 256, 256, (g, w, h, R) => {   // 化粧スレート（そめる）
  PT.fill(g, 0, 0, w, h, '#8f9298');
  const cols = 4, rows = 12, tw = w / cols, th = h / rows, lw = Math.max(1, w / 256);
  for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) { const x = (i + (j % 2) * 0.5) * tw, y = j * th;
    g.fillStyle = PT.css('#c6c9ce', 0.9 + R() * 0.12); g.fillRect(x + lw, y, tw - lw * 1.5, th);
    g.fillStyle = 'rgba(0,0,0,.22)'; for (let q = 1; q < 4; q++) g.fillRect(x + tw * q / 4, y + th * 0.35, lw, th * 0.65); }
  for (let j = 0; j < rows; j++) { g.fillStyle = 'rgba(0,0,0,.36)'; g.fillRect(0, (j + 1) * th - Math.max(1, th * 0.14), w, Math.max(1, th * 0.14)); }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
rmat('yogawara', 2.4, 2.1, 256, 256, (g, w, h, R) => {   // 洋瓦（S形・まぜぶき。このままの色）
  const cols = 8, rows = 8, tw = w / cols, th = h / rows, pal = ['#b8693f', '#a95a38', '#c27a4e', '#9c5434', '#b06644', '#8f4d34', '#c2875c'];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = i * tw, y = j * th, c = pick(R, pal), gr = g.createLinearGradient(x, 0, x + tw, 0);
    gr.addColorStop(0, PT.css(c, 0.55)); gr.addColorStop(0.25, PT.css(c, 1.12)); gr.addColorStop(0.5, PT.css(c, 0.95)); gr.addColorStop(0.72, PT.css(c, 0.62)); gr.addColorStop(1, PT.css(c, 0.55)); g.fillStyle = gr; g.fillRect(x, y, tw, th); }
  for (let j = 0; j < rows; j++) { g.fillStyle = 'rgba(30,10,0,.45)'; g.fillRect(0, (j + 1) * th - Math.max(1, th * 0.12), w, Math.max(1, th * 0.12)); }
  PT.noise(g, 0, 0, w, h, 0.035, R);
});
rmat('seam', 3.64, 3.64, 128, 128, (g, w, h, R) => {   // 金属のたてはぜ（ガルバ・銅板。そめる）
  PT.fill(g, 0, 0, w, h, '#d4d7da');
  const n = 8, st = w / n;
  for (let i = 0; i < n; i++) { const x = i * st, gr = g.createLinearGradient(x, 0, x + st, 0); gr.addColorStop(0, '#c8cbcf'); gr.addColorStop(0.5, '#dcdfe2'); gr.addColorStop(1, '#ced1d4'); g.fillStyle = gr; g.fillRect(x, 0, st, h);
    g.fillStyle = '#f5f6f7'; g.fillRect(x, 0, Math.max(1, st * 0.07), h); g.fillStyle = '#979ba0'; g.fillRect(x + Math.max(1, st * 0.07), 0, Math.max(1, st * 0.06), h); }
  PT.noise(g, 0, 0, w, h, 0.012, R);
});
rmat('flat', 6, 6, 128, 128, (g, w, h, R) => {   // 屋上（防水シート）
  PT.fill(g, 0, 0, w, h, '#cbccca');
  g.fillStyle = 'rgba(0,0,0,.08)'; for (let k = 0; k < 4; k++) g.fillRect(0, k * h / 4, w, Math.max(1, h / 128));
  PT.noise(g, 0, 0, w, h, 0.03, R, 2);
});
// 屋根の だいたいの色（棟・遠くの屋根に）：そめる材料は 色 × わり、洋瓦は このまま
// 外壁の だいたいの色（遠くの 箱に）：このままの色の材料は その色 × そめ、ほかは そめの色
const MAVG = { brick: [0.66, 0.38, 0.27], log: [0.72, 0.52, 0.33], timber: [0.86, 0.81, 0.74], conc: [0.78, 0.77, 0.74], board: [0.86, 0.8, 0.7] };
const wallAvg = (m, c) => { const t = col(c || '#efede8'), a = MAVG[m]; return a ? [a[0] * t[0], a[1] * t[1], a[2] * t[2]] : mul(t, 0.96); };
const FWC = new Map(), farWall = L => { let c = FWC.get(L); if (!c) FWC.set(L, c = wallAvg(L.w2 || L.w, L.w2 ? L.wc2 : L.wc)); return c; }, farGable = L => mul(farWall(L), 0.92);
const RAVG = { kawara: 0.62, slate: 0.72, seam: 0.8, flat: 0.8, kaya: 1 };
const roofAvg = (rm, rc) => rm === 'yogawara' ? [0.63, 0.37, 0.25] : rm === 'kaya' ? [0.52, 0.46, 0.36] : mul(col(rc || '#55585e'), RAVG[rm] || 0.7);
rmat('kaya', 3, 3, 128, 128, (g, w, h, R) => {   // 茅葺き（このままの色）
  PT.fill(g, 0, 0, w, h, '#8a7a5e');
  for (let i = 0; i < 900; i++) { g.fillStyle = PT.css(pick(R, ['#9c8b6a', '#7a6a50', '#a89874', '#6c5e47']), 1, 0.7); g.fillRect(R() * w, R() * h, Math.max(1, w / 128), h * (0.05 + 0.08 * R())); }
  for (let j = 0; j < 4; j++) { g.fillStyle = 'rgba(40,30,20,.25)'; g.fillRect(0, h * (j + 0.95) / 4, w, h * 0.04); }
  PT.noise(g, 0, 0, w, h, 0.05, R);
});
const SOLAR = TX('solar', 128, 128, (g, w, h, R) => {   // 太陽光パネル（4×2枚）
  PT.fill(g, 0, 0, w, h, '#b9bdc1');
  const mw = w / 4, mh = h / 2, lw = Math.max(1, w / 128);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) { const x = i * mw + lw, y = j * mh + lw, ww = mw - lw * 2, hh = mh - lw * 2, gr = g.createLinearGradient(x, y, x + ww, y + hh);
    gr.addColorStop(0, '#34466c'); gr.addColorStop(1, '#1a253d'); g.fillStyle = gr; g.fillRect(x, y, ww, hh);
    g.fillStyle = 'rgba(160,180,220,.2)'; for (let q = 1; q < 6; q++) g.fillRect(x + ww * q / 6, y, lw, hh); for (let q = 1; q < 10; q++) g.fillRect(x, y + hh * q / 10, ww, lw); }
  PT.noise(g, 0, 0, w, h, 0.02, R);
});

/* ---------- 質感：地面（区画の中） ---------- */
const GND = {
  gravel: TX('g_gravel', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#a9a59c'); for (let i = 0; i < 1100; i++) { g.fillStyle = PT.css('#bdb8ad', 0.7 + R() * 0.5); const s = Math.max(1, w / 90) * (0.6 + R()); g.fillRect(R() * w, R() * h, s, s); } PT.noise(g, 0, 0, w, h, 0.05, R); }),
  lawn: TX('g_lawn', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#86995f'); for (let i = 0; i < 120; i++) { g.fillStyle = R() < 0.5 ? 'rgba(170,180,110,.1)' : 'rgba(60,75,40,.08)'; const x = R() * w, y = R() * h, r = w * (0.02 + 0.06 * R()); for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, 6.283); g.fill(); } } PT.noise(g, 0, 0, w, h, 0.05, R); }),
  conc: TX('g_conc', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#c3c1bb'); g.globalAlpha = 0.08; PT.hlines(g, 0, 0, w, h, Math.max(2, h / 40), '#000', 1); g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, 0, w, Math.max(1, h / 100)); g.fillRect(0, 0, Math.max(1, w / 100), h); PT.noise(g, 0, 0, w, h, 0.03, R); }),
  tile: TX('g_tile', 128, 128, (g, w, h, R) => { PT.fill(g, 0, 0, w, h, '#9f9a90'); const n = 4, s = w / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = PT.css('#d9d2c4', 0.9 + R() * 0.12); g.fillRect(i * s + 1, j * s + 1, s - 2, s - 2); } PT.noise(g, 0, 0, w, h, 0.03, R); }),
};
const GSU = { gravel: 3, lawn: 4, conc: 4, tile: 1.6 };

/* ---------- 質感：窓とドアのアトラス（8列 × 16行） ----------
   行0：引き違い窓 わくの色 0〜3（カーテンをよせる）/ 4〜7（レース）  行1：同（ブラインド）/（しめたカーテン・暗い）
   行2：掃き出し窓（カーテン）/（レース）  行3：掃き出し窓（いろいろ）/ 小窓（くもり・面格子）  行4：たて長のすべり出し窓 / FIX 窓
   行5：ドア（0 こげ茶の木目・1 明るい木目・2 黒い金属・3 白い洋風・4 格子の引き戸・5 アパートの鉄の扉・6 洋館の両開き・7 ガラス戸）
   行6：そめて使う（0 シャッターボックス・1 しめた雨戸・2 車庫のシャッター・3 ガラリ）・4〜7 ドア（横木目・親子・アパート 灰・茶）
   行7：和風（0 障子窓・1 京格子・2 虫籠窓・3 木の雨戸・4 丸窓・5 格子窓・6 縁側のガラス戸・7 蔵の窓）
   行8：洋館・お店（0 上げ下げ窓・1 アーチの窓・2 よろい戸つき・3 出窓・4 お店のガラス・5 お店のシャッター（そめる）・6 お店のガラス 2・7 ショーウインドー）
   行9：小物（0 室外機・1 給湯器・2 貯湯タンク・3 門柱・4 メーター・5 自動販売機・6 看板の板（そめる）・7 掲示板）
   行10：集合住宅（0 廊下の窓・1 マンションの掃き出し・2 同 暗いわく・3 エレベーター・4 ロビーのガラス戸・5 集合ポスト・6 車庫の中・7 物置） */
const FRC = ['#c4c8cb', '#4f443a', '#2c2d2f', '#f2f1ed'];   // サッシの色：シルバー・ブロンズ・黒・白
const CURC = ['#e9e2d2', '#d8cdb6', '#c9d3cf', '#e3cfc9', '#b9c3cf', '#d9d0c0', '#a9b49f', '#cdbfae', '#e8e6e0'];
function pGlass(g, x, y, w, h, dark) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, dark ? '#80909c' : '#b4c3ce'); gr.addColorStop(0.42, dark ? '#4a5763' : '#6d7f8f'); gr.addColorStop(1, dark ? '#2b333b' : '#3c4955');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}
function pRefl(g, x, y, w, h) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = 'rgba(255,255,255,.13)';
  g.beginPath(); g.moveTo(x + w * 0.1, y); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x - w * 0.35, y + h); g.closePath(); g.fill(); g.restore();
}
function pIn(g, x, y, w, h, R, st, side, cc) {   // 窓の中：0 カーテンをよせる 1 レース 2 しめた 3 ブラインド 4 暗い
  if (st === 0) { g.fillStyle = 'rgba(240,238,232,.4)'; g.fillRect(x, y, w, h); const cw = w * (0.22 + 0.15 * R()); g.fillStyle = PT.css(cc, 0.95); if (side <= 0) g.fillRect(x, y, cw, h); if (side >= 0) g.fillRect(x + w - cw, y, cw, h); }
  else if (st === 1) { g.fillStyle = 'rgba(238,236,230,.62)'; g.fillRect(x, y, w, h); }
  else if (st === 2) { g.fillStyle = PT.css(cc, 0.9); g.fillRect(x, y, w, h); }
  else if (st === 3) { const n = Math.max(5, Math.round(h / 3)), m = n * (0.35 + 0.6 * R()); g.fillStyle = 'rgba(232,229,221,.9)'; for (let i = 0; i < m; i++) g.fillRect(x, y + i * h / n, w, Math.max(1, h / n * 0.7)); }
  else { g.fillStyle = 'rgba(20,24,28,.35)'; g.fillRect(x, y + h * 0.5, w, h * 0.5); }
  if (st <= 2) { g.fillStyle = 'rgba(0,0,0,.07)'; for (let u = x; u < x + w; u += Math.max(2, w / 9)) g.fillRect(u, y, 1, h); }
}
function pSash(g, x, y, w, h, R, o) {   // アルミサッシ（n 枚）
  const f = o.f, fw = Math.max(2, Math.round(Math.min(w, h) * 0.06)), n = o.n || 2, st = o.st === 'r' ? Math.floor(R() * 4) : o.st, cc = pick(R, CURC);
  PT.fill(g, x, y, w, h, f);
  const gx = x + fw, gy = y + fw, gw = w - fw * 2, gh = h - fw * 2;
  for (let i = 0; i < n; i++) { const px = gx + gw * i / n, pw = gw / n;
    if (o.frost) { PT.fill(g, px, gy, pw, gh, '#d2d8db'); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(px, gy, pw, gh * 0.45); PT.noise(g, px, gy, pw, gh, 0.03, R); }
    else { pGlass(g, px, gy, pw, gh, o.dark); if (st != null) pIn(g, px + 1, gy + 1, pw - 2, gh - 2, R, st, n === 1 ? 0 : i === 0 ? -1 : i === n - 1 ? 1 : 0, cc); }
    pRefl(g, px, gy, pw, gh); }
  g.fillStyle = PT.css(f, 0.93);
  for (let i = 1; i < n; i++) g.fillRect(gx + gw * i / n - fw * 0.8, gy, fw * 1.6, gh);
  if (o.tr) g.fillRect(gx, gy + gh * o.tr - fw * 0.4, gw, fw * 0.8);
  g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(gx, gy, gw, Math.max(1, fw * 0.5));
  if (o.grille) { const nb = 6; g.fillStyle = PT.css(f, 1.06); for (let i = 0; i <= nb; i++) g.fillRect(x + w * (0.07 + 0.86 * i / nb) - fw * 0.35, y, fw * 0.7, h);
    g.fillRect(x, y + h * 0.3, w, fw * 0.6); g.fillRect(x, y + h * 0.68, w, fw * 0.6); g.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i <= nb; i++) g.fillRect(x + w * (0.07 + 0.86 * i / nb) + fw * 0.35, y, Math.max(1, fw * 0.3), h); }
}
function pWood(g, x, y, w, h, c, R, vert = true) {   // 木目の板
  PT.fill(g, x, y, w, h, c);
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(30,15,5,${0.06 + R() * 0.1})`; if (vert) g.fillRect(x + R() * w, y, Math.max(1, w * 0.02), h); else g.fillRect(x, y + R() * h, w, Math.max(1, h * 0.02)); }
}
function pDoor(g, x, y, w, h, R, t) {
  const fw = Math.max(2, w * 0.05);
  if (t <= 2) {   // 木目・金属のドア（右に そで のくもりガラス）
    PT.fill(g, x, y, w, h, '#36332f');
    const lx = x + fw, lw = w * 0.68 - fw, sx = x + w * 0.72, sw = w * 0.28 - fw;
    if (t === 2) { PT.fill(g, lx, y + fw, lw, h - fw, '#33363a'); g.fillStyle = 'rgba(255,255,255,.08)'; for (let k = 1; k < 12; k++) g.fillRect(lx, y + fw + (h - fw) * k / 12, lw, Math.max(1, h / 200)); }
    else pWood(g, lx, y + fw, lw, h - fw, t === 0 ? '#5a3f2d' : '#a67d53', R);
    PT.fill(g, lx + lw * 0.12, y + h * 0.1, lw * 0.1, h * 0.8, '#cfd5d8');   // たてのスリット
    PT.fill(g, lx + lw * 0.82, y + h * 0.36, Math.max(2, lw * 0.05), h * 0.3, '#c9ccce');   // 取っ手
    PT.fill(g, sx, y + fw, sw, h - fw, '#cdd3d6'); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(sx, y + fw, sw, h * 0.3);
  } else if (t === 3) {   // 白い洋風
    PT.fill(g, x, y, w, h, '#e9e6de'); PT.fill(g, x + fw, y + fw, w - fw * 2, h - fw, '#f4f2ec');
    g.fillStyle = 'rgba(0,0,0,.1)'; for (const [a, b, c, d] of [[0.15, 0.45, 0.32, 0.22], [0.53, 0.45, 0.32, 0.22], [0.15, 0.72, 0.32, 0.2], [0.53, 0.72, 0.32, 0.2]]) g.fillRect(x + w * a, y + h * b, w * c, h * d);
    pGlass(g, x + w * 0.22, y + h * 0.1, w * 0.56, h * 0.28); g.fillStyle = '#f4f2ec'; g.beginPath(); g.moveTo(x + w * 0.2, y + h * 0.09); g.lineTo(x + w * 0.2, y + h * 0.2); g.quadraticCurveTo(x + w * 0.5, y + h * 0.02, x + w * 0.8, y + h * 0.2); g.lineTo(x + w * 0.8, y + h * 0.09); g.closePath(); g.fill();
    PT.fill(g, x + w * 0.8, y + h * 0.55, Math.max(2, w * 0.06), Math.max(2, h * 0.03), '#b89a52');
  } else if (t === 4) {   // 格子の引き戸（和風）
    PT.fill(g, x, y, w, h, '#3e2e22');
    for (let k = 0; k < 2; k++) { const px = x + fw + (w - fw * 2) * k / 2, pw = (w - fw * 2) / 2 - fw * 0.3;
      PT.fill(g, px, y + fw, pw, h - fw * 2, '#d8d9d3'); g.fillStyle = '#4a3627'; for (let i = 0; i <= 9; i++) g.fillRect(px + pw * i / 9 - 1, y + fw, Math.max(1.5, pw * 0.05), h - fw * 2);
      g.fillRect(px, y + h * 0.3, pw, Math.max(2, h * 0.02)); g.fillRect(px, y + h * 0.7, pw, Math.max(2, h * 0.02)); }
  } else if (t === 5) {   // アパートの鉄の扉
    PT.fill(g, x, y, w, h, '#8f8b82'); PT.fill(g, x + fw, y + fw, w - fw * 2, h - fw, '#d5cfc1');
    PT.fill(g, x + w * 0.3, y + h * 0.55, w * 0.4, h * 0.04, '#6c6860'); PT.fill(g, x + w * 0.78, y + h * 0.45, w * 0.1, h * 0.03, '#a9a9a6');
    PT.fill(g, x + w * 0.35, y + h * 0.2, w * 0.3, h * 0.06, '#efede6');
  } else if (t === 6) {   // 洋館の両開き
    PT.fill(g, x, y, w, h, '#efece4'); pGlass(g, x + fw, y + fw, w - fw * 2, h * 0.18);
    for (let k = 0; k < 2; k++) { const px = x + fw + (w - fw * 2) * k / 2, pw = (w - fw * 2) / 2 - 1; pWood(g, px, y + h * 0.22, pw, h * 0.78, '#5d3b28', R);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(px + pw * 0.15, y + h * 0.3, pw * 0.7, h * 0.25); g.fillRect(px + pw * 0.15, y + h * 0.62, pw * 0.7, h * 0.3); }
  } else {   // ガラス戸
    PT.fill(g, x, y, w, h, '#5b5f63');
    for (let k = 0; k < 2; k++) { const px = x + fw + (w - fw * 2) * k / 2, pw = (w - fw * 2) / 2 - fw * 0.4; pGlass(g, px, y + fw, pw, h - fw * 2); g.fillStyle = 'rgba(255,236,200,.35)'; g.fillRect(px, y + h * 0.45, pw, h * 0.5); pRefl(g, px, y + fw, pw, h - fw * 2); PT.fill(g, px + pw * (k ? 0.08 : 0.82), y + h * 0.4, Math.max(2, pw * 0.08), h * 0.2, '#c9cccf'); }
  }
}
function pDoor2(g, x, y, w, h, R, t) {
  const fw = Math.max(2, w * 0.05);
  if (t === 0) { PT.fill(g, x, y, w, h, '#2f2d2b'); pWood(g, x + fw, y + fw, w * 0.7 - fw, h - fw, '#8a6446', R, false); PT.fill(g, x + w * 0.62, y + h * 0.3, Math.max(2, w * 0.04), h * 0.4, '#b9bcbf'); PT.fill(g, x + w * 0.74, y + fw, w * 0.26 - fw, h - fw, '#2a2b2c'); for (let k = 1; k < 6; k++) PT.fill(g, x + w * 0.74, y + h * k / 6, w * 0.26 - fw, Math.max(1, h * 0.012), '#d5dade'); }
  else if (t === 1) { PT.fill(g, x, y, w, h, '#3a3632'); pWood(g, x + fw, y + fw, w * 0.6, h - fw, '#4b3527', R); pWood(g, x + w * 0.64, y + fw, w * 0.36 - fw, h - fw, '#4b3527', R); PT.fill(g, x + w * 0.52, y + h * 0.35, Math.max(2, w * 0.03), h * 0.3, '#c2a35e'); PT.fill(g, x + w * 0.1, y + h * 0.12, w * 0.4, h * 0.05, '#d2d7da'); }
  else { PT.fill(g, x, y, w, h, '#6f6b64'); PT.fill(g, x + fw, y + fw, w - fw * 2, h - fw, t === 2 ? '#8e9aa3' : '#7a5b45'); PT.fill(g, x + w * 0.78, y + h * 0.46, w * 0.1, h * 0.03, '#d0d0cc'); PT.fill(g, x + w * 0.3, y + h * 0.58, w * 0.4, h * 0.035, 'rgba(0,0,0,.35)'); PT.fill(g, x + w * 0.35, y + h * 0.18, w * 0.3, h * 0.05, '#e8e6e0'); }
}
function pMono(g, x, y, w, h, R, t) {   // そめて使う ます（うすい色）
  if (t === 0) { PT.fill(g, x, y, w, h, '#e9eaeb'); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x, y, w, h * 0.18); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y + h * 0.84, w, h * 0.16); }
  else if (t === 1) { PT.fill(g, x, y, w, h, '#dfe1e2'); g.fillStyle = 'rgba(0,0,0,.16)'; for (let k = 0; k < 22; k++) g.fillRect(x, y + h * k / 22, w, Math.max(1, h / 90)); PT.fill(g, x, y, w * 0.06, h, '#c9cbcc'); PT.fill(g, x + w * 0.94, y, w * 0.06, h, '#c9cbcc'); PT.fill(g, x, y + h * 0.94, w, h * 0.06, '#b9bbbc'); }
  else if (t === 2) { PT.fill(g, x, y, w, h, '#e4e6e7'); for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(x, y + h * k / 14, w, Math.max(1, h / 60)); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y + h * (k + 0.8) / 14, w, Math.max(1, h / 70)); } PT.fill(g, x, y + h * 0.95, w, h * 0.05, '#aeb0b2'); }
  else { PT.fill(g, x, y, w, h, '#e3e3e0'); for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + h * (k + 0.6) / 10, w, h * 0.04); } }
}
function pWafu(g, x, y, w, h, R, t) {
  if (t === 0) { PT.fill(g, x, y, w, h, '#7c5f45'); const fw = w * 0.05; PT.fill(g, x + fw, y + fw, w - fw * 2, h - fw * 2, '#f1eee4'); g.fillStyle = '#8a6c4f'; for (let i = 1; i < 6; i++) g.fillRect(x + fw + (w - fw * 2) * i / 6, y + fw, Math.max(1, w * 0.012), h - fw * 2); for (let i = 1; i < 5; i++) g.fillRect(x + fw, y + fw + (h - fw * 2) * i / 5, w - fw * 2, Math.max(1, h * 0.012)); PT.fill(g, x + w / 2 - fw * 0.4, y, fw * 0.8, h, '#7c5f45'); }
  else if (t === 1) { PT.fill(g, x, y, w, h, '#2a2521'); g.fillStyle = '#6a4d36'; for (let i = 0; i < 14; i++) g.fillRect(x + w * i / 14, y, w / 14 * 0.58, h); g.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 14; i++) g.fillRect(x + w * i / 14, y, Math.max(1, w / 14 * 0.12), h); PT.fill(g, x, y, w, h * 0.06, '#5a4230'); PT.fill(g, x, y + h * 0.94, w, h * 0.06, '#5a4230'); }
  else if (t === 2) { PT.fill(g, x, y, w, h, '#ebe7dd'); g.fillStyle = '#2d2b28'; for (let i = 0; i < 5; i++) { const sx = x + w * (0.1 + i * 0.17); g.fillRect(sx, y + h * 0.15, w * 0.09, h * 0.7); } PT.noise(g, x, y, w, h, 0.03, R); }
  else if (t === 3) { PT.fill(g, x, y, w, h, '#5e4a38'); for (let i = 0; i < 8; i++) { PT.fill(g, x + w * i / 8, y, w / 8 - 1, h, '#6b5643', 0.9 + R() * 0.2); } PT.fill(g, x, y + h * 0.3, w, h * 0.03, '#4a3a2c'); PT.fill(g, x, y + h * 0.7, w, h * 0.03, '#4a3a2c'); }
  else if (t === 4) { PT.fill(g, x, y, w, h, '#e8e3d8'); g.fillStyle = '#6a5038'; g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.42, 0, 6.283); g.fill(); g.fillStyle = '#f0ece2'; g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.37, 0, 6.283); g.fill(); g.fillStyle = '#8a6c4f'; for (let i = 1; i < 4; i++) { g.fillRect(x + w * (0.15 + i * 0.175), y + h * 0.1, Math.max(1, w * 0.015), h * 0.8); g.fillRect(x + w * 0.1, y + h * (0.15 + i * 0.175), w * 0.8, Math.max(1, h * 0.015)); } }
  else if (t === 5) { PT.fill(g, x, y, w, h, '#4a3626'); const fw = w * 0.06; pGlass(g, x + fw, y + fw, w - fw * 2, h - fw * 2, true); pIn(g, x + fw, y + fw, w - fw * 2, h - fw * 2, R, 1, 0, '#fff'); g.fillStyle = '#5d4532'; for (let i = 0; i <= 8; i++) g.fillRect(x + fw + (w - fw * 2) * i / 8 - 1, y, Math.max(2, w * 0.03), h); g.fillRect(x, y + h * 0.5, w, Math.max(2, h * 0.04)); }
  else if (t === 6) { PT.fill(g, x, y, w, h, '#5a4330'); for (let k = 0; k < 4; k++) { const px = x + w * (0.02 + k * 0.245), pw = w * 0.225; pGlass(g, px, y + h * 0.04, pw, h * 0.92, true); g.fillStyle = 'rgba(242,238,228,.75)'; g.fillRect(px, y + h * 0.5, pw, h * 0.46); PT.fill(g, px, y + h * 0.48, pw, h * 0.03, '#5a4330'); pRefl(g, px, y + h * 0.04, pw, h * 0.44); } }
  else { PT.fill(g, x, y, w, h, '#e9e5dc'); PT.fill(g, x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6, '#2c2a27'); PT.fill(g, x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.56, '#4a4640'); for (let i = 1; i < 4; i++) PT.fill(g, x + w * (0.22 + i * 0.14), y + h * 0.22, Math.max(1, w * 0.03), h * 0.56, '#2c2a27'); PT.fill(g, x + w * 0.12, y + h * 0.12, w * 0.76, h * 0.06, '#d9d4c9'); }
}
function pYo(g, x, y, w, h, R, t) {   // 洋館の窓・お店
  if (t === 0) { PT.fill(g, x, y, w, h, '#f1efe9'); const fw = w * 0.08; for (let k = 0; k < 2; k++) { const py = y + fw + (h - fw * 2) * k / 2, ph = (h - fw * 2) / 2 - fw * 0.3; pGlass(g, x + fw, py, w - fw * 2, ph, true); pIn(g, x + fw, py, w - fw * 2, ph, R, k ? 4 : 0, 0, pick(R, CURC)); g.fillStyle = '#f1efe9'; g.fillRect(x + w / 2 - fw * 0.25, py, fw * 0.5, ph); g.fillRect(x + fw, py + ph / 2 - fw * 0.2, w - fw * 2, fw * 0.4); pRefl(g, x + fw, py, w - fw * 2, ph); } }
  else if (t === 1) { PT.fill(g, x, y, w, h, '#efece5'); const fw = w * 0.09; pGlass(g, x + fw, y + h * 0.12, w - fw * 2, h * 0.88 - fw, true); pIn(g, x + fw, y + h * 0.3, w - fw * 2, h * 0.6, R, 0, 0, pick(R, CURC)); g.fillStyle = '#efece5'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h * 0.3); g.quadraticCurveTo(x + w - fw, y + fw * 0.5, x + w / 2, y + fw); g.quadraticCurveTo(x + fw, y + fw * 0.5, x, y + h * 0.3); g.closePath(); g.fill(); g.fillRect(x + w / 2 - fw * 0.25, y, fw * 0.5, h); g.fillRect(x, y + h * 0.55, w, fw * 0.4); pRefl(g, x + fw, y + h * 0.12, w - fw * 2, h * 0.8); }
  else if (t === 2) { const sw = w * 0.24; for (const sx of [x, x + w - sw]) { PT.fill(g, sx, y, sw, h, '#4f6b58'); g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 16; k++) g.fillRect(sx, y + h * k / 16, sw, Math.max(1, h / 80)); } PT.fill(g, x + sw, y, w - sw * 2, h, '#f1efe9'); const fw = w * 0.04; pGlass(g, x + sw + fw, y + fw, w - sw * 2 - fw * 2, h - fw * 2, true); pIn(g, x + sw + fw, y + fw, w - sw * 2 - fw * 2, h - fw * 2, R, 1, 0, '#fff'); g.fillStyle = '#f1efe9'; g.fillRect(x + w / 2 - fw * 0.3, y, fw * 0.6, h); for (let k = 1; k < 4; k++) g.fillRect(x + sw, y + h * k / 4, w - sw * 2, fw * 0.5); }
  else if (t === 3) { PT.fill(g, x, y, w, h, '#f1efe9'); const fw = w * 0.05; for (let k = 0; k < 3; k++) { const px = x + fw + (w - fw * 2) * k / 3, pw = (w - fw * 2) / 3 - fw * 0.5; pGlass(g, px, y + fw, pw, h - fw * 2); pIn(g, px, y + fw, pw, h - fw * 2, R, 1, 0, '#fff'); pRefl(g, px, y + fw, pw, h - fw * 2); } }
  else if (t === 4) { PT.fill(g, x, y, w, h, '#4b4f53'); const fw = w * 0.03; for (let k = 0; k < 3; k++) { const px = x + fw + (w - fw * 2) * k / 3, pw = (w - fw * 2) / 3 - fw; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#d9dfe2'); gr.addColorStop(0.5, '#efe3c9'); gr.addColorStop(1, '#c9b89a'); g.fillStyle = gr; g.fillRect(px, y + fw, pw, h - fw * 2);
      for (let s = 0; s < 3; s++) { PT.fill(g, px, y + h * (0.35 + s * 0.2), pw, Math.max(1, h * 0.02), '#8a8276'); for (let q = 0; q < 5; q++) PT.fill(g, px + pw * (0.05 + q * 0.19), y + h * (0.25 + s * 0.2), pw * 0.12, h * 0.09, pick(R, ['#c9a46a', '#a7b9c2', '#d7c7a7', '#9fae8a', '#c88f7a', '#e6e0d4'])); }
      pRefl(g, px, y + fw, pw, h - fw * 2); } }
  else if (t === 5) { PT.fill(g, x, y, w, h, '#dfe1e2'); for (let k = 0; k < 24; k++) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, y + h * k / 24, w, Math.max(1, h / 100)); } PT.fill(g, x, y + h * 0.95, w, h * 0.05, '#b3b5b6'); }
  else if (t === 6) { PT.fill(g, x, y, w, h, '#3b3631'); const fw = w * 0.04; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#d5d0c4'); gr.addColorStop(0.45, '#f0d9b0'); gr.addColorStop(1, '#b9946a'); g.fillStyle = gr; g.fillRect(x + fw, y + fw, w - fw * 2, h - fw * 2);
    for (let q = 0; q < 4; q++) PT.fill(g, x + w * (0.12 + q * 0.2), y + h * 0.55, w * 0.1, h * 0.3, '#5c4634'); PT.fill(g, x + w / 2 - fw * 0.4, y, fw * 0.8, h, '#3b3631'); pRefl(g, x + fw, y + fw, w - fw * 2, h - fw * 2); }
  else { PT.fill(g, x, y, w, h, '#2f3134'); const fw = w * 0.03; pGlass(g, x + fw, y + fw, w - fw * 2, h - fw * 2); g.fillStyle = 'rgba(255,245,225,.45)'; g.fillRect(x + fw, y + h * 0.2, w - fw * 2, h * 0.75);
    for (let q = 0; q < 3; q++) PT.fill(g, x + w * (0.1 + q * 0.3), y + h * (0.45 + 0.1 * (q % 2)), w * 0.18, h * 0.4, pick(R, ['#b9a58a', '#8fa3b0', '#c8b9a0', '#a7997f', '#d9cfc0'])); PT.fill(g, x, y + h * 0.9, w, h * 0.1, '#4a4c4f'); pRefl(g, x + fw, y + fw, w - fw * 2, h - fw * 2); }
}
function pProp(g, x, y, w, h, R, t) {
  if (t === 0) { PT.fill(g, x, y, w, h, '#e6e6e2'); g.fillStyle = '#7b7d7e'; g.beginPath(); g.arc(x + w * 0.36, y + h / 2, Math.min(w * 0.3, h * 0.42), 0, 6.283); g.fill(); g.strokeStyle = '#d0d1cf'; g.lineWidth = Math.max(1, w / 60); for (let k = 1; k < 5; k++) { g.beginPath(); g.arc(x + w * 0.36, y + h / 2, Math.min(w * 0.3, h * 0.42) * k / 5, 0, 6.283); g.stroke(); } g.fillStyle = 'rgba(0,0,0,.15)'; for (let k = 0; k < 6; k++) g.fillRect(x + w * 0.74, y + h * (0.2 + k * 0.11), w * 0.2, Math.max(1, h * 0.03)); }
  else if (t === 1) { PT.fill(g, x, y, w, h, '#ecebe7'); PT.fill(g, x + w * 0.2, y + h * 0.75, w * 0.6, h * 0.12, '#9c9d9b'); PT.fill(g, x + w * 0.35, y + h * 0.2, w * 0.3, h * 0.1, '#55595c'); }
  else if (t === 2) { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, '#d8d7d2'); gr.addColorStop(0.4, '#f4f3ef'); gr.addColorStop(1, '#cfceca'); g.fillStyle = gr; g.fillRect(x, y, w, h); PT.fill(g, x + w * 0.3, y + h * 0.12, w * 0.4, h * 0.06, '#8d9092'); }
  else if (t === 3) { PT.fill(g, x, y, w, h, '#3d3e40'); PT.fill(g, x + w * 0.15, y + h * 0.12, w * 0.7, h * 0.1, '#e6e3da'); PT.fill(g, x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.12, '#1e1f20'); PT.fill(g, x + w * 0.1, y + h * 0.5, w * 0.8, h * 0.18, '#a6a9ab'); PT.fill(g, x + w * 0.2, y + h * 0.56, w * 0.6, h * 0.03, '#454749'); PT.fill(g, x + w * 0.3, y + h * 0.02, w * 0.4, h * 0.06, '#f3ead0'); }
  else if (t === 4) { PT.fill(g, x, y, w, h, '#d7d5ce'); PT.fill(g, x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.35, '#3c4246'); PT.fill(g, x + w * 0.25, y + h * 0.65, w * 0.5, h * 0.2, '#b9b7b0'); }
  else if (t === 5) { PT.fill(g, x, y, w, h, '#e9e9e7'); PT.fill(g, x + w * 0.08, y + h * 0.06, w * 0.84, h * 0.5, '#2f3437'); for (let r = 0; r < 3; r++) for (let q = 0; q < 6; q++) PT.fill(g, x + w * (0.12 + q * 0.13), y + h * (0.1 + r * 0.15), w * 0.09, h * 0.1, pick(R, ['#c9c2b0', '#9fb6c4', '#d8b48a', '#a9c29b', '#e0d8c8', '#b9a6c2', '#c8a08e'])); PT.fill(g, x + w * 0.1, y + h * 0.62, w * 0.5, h * 0.1, '#cfd6da'); PT.fill(g, x + w * 0.2, y + h * 0.8, w * 0.6, h * 0.1, '#3d4144'); }
  else if (t === 6) { PT.fill(g, x, y, w, h, '#efefed'); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y + h * 0.9, w, h * 0.1); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, w, h * 0.12); }
  else { PT.fill(g, x, y, w, h, '#a8865f'); PT.noise(g, x, y, w, h, 0.05, R); for (let k = 0; k < 4; k++) PT.fill(g, x + w * (0.08 + R() * 0.6), y + h * (0.08 + R() * 0.55), w * 0.25, h * 0.3, pick(R, ['#f2f0ea', '#e8ecef', '#f3ead6'])); }
}
function pApt(g, x, y, w, h, R, t) {
  if (t === 0) pSash(g, x, y, w, h, R, { f: '#c4c8cb', frost: true, grille: true });
  else if (t === 1 || t === 2) pSash(g, x, y, w, h, R, { f: t === 1 ? '#c4c8cb' : '#4f443a', st: 'r', tr: 0.7 });
  else if (t === 3) { PT.fill(g, x, y, w, h, '#a4a8ab'); const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, '#c9cdd0'); gr.addColorStop(0.5, '#e8eaeb'); gr.addColorStop(1, '#b9bdc0'); g.fillStyle = gr; g.fillRect(x + w * 0.08, y + h * 0.08, w * 0.84, h * 0.92); PT.fill(g, x + w / 2 - 1, y + h * 0.08, 2, h * 0.92, '#8d9194'); }
  else if (t === 4) { PT.fill(g, x, y, w, h, '#3e4245'); const fw = w * 0.04; for (let k = 0; k < 2; k++) { const px = x + fw + (w - fw * 2) * k / 2, pw = (w - fw * 2) / 2 - fw * 0.5; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#c8d1d6'); gr.addColorStop(0.4, '#f1e6cf'); gr.addColorStop(1, '#d9c9a9'); g.fillStyle = gr; g.fillRect(px, y + fw, pw, h - fw * 2); pRefl(g, px, y + fw, pw, h - fw * 2); } }
  else if (t === 5) { PT.fill(g, x, y, w, h, '#8e9194'); for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) PT.fill(g, x + w * (0.03 + q * 0.16), y + h * (0.03 + r * 0.16), w * 0.14, h * 0.14, '#b4b7ba', 0.95 + R() * 0.08); }
  else if (t === 6) { PT.fill(g, x, y, w, h, '#2a2c2e'); PT.fill(g, x + w * 0.15, y + h * 0.45, w * 0.7, h * 0.4, '#3b4045'); PT.fill(g, x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.2, '#30353a'); PT.fill(g, x + w * 0.18, y + h * 0.6, w * 0.12, h * 0.06, '#a33'); PT.fill(g, x + w * 0.7, y + h * 0.6, w * 0.12, h * 0.06, '#a33'); }
  else { PT.fill(g, x, y, w, h, '#d9d6cc'); g.fillStyle = 'rgba(0,0,0,.12)'; for (let k = 1; k < 8; k++) g.fillRect(x + w * k / 8, y, 1, h); PT.fill(g, x, y + h * 0.9, w, h * 0.1, '#a9a69c'); }
}
const WIN = TX('win', 512, 1024, (g, w, h, R) => {
  const cw = w / 8, ch = h / 16;
  PT.fill(g, 0, 0, w, h, '#888');
  for (let r = 0; r < 11; r++) for (let c = 0; c < 8; c++) {
    const x = c * cw, y = r * ch, f = FRC[c % 4], lo = c < 4;
    if (r === 0) pSash(g, x, y, cw, ch, R, { f, st: lo ? 0 : 1 });
    else if (r === 1) pSash(g, x, y, cw, ch, R, { f, st: lo ? 3 : (c % 2 ? 4 : 2) });
    else if (r === 2) pSash(g, x, y, cw, ch, R, { f, st: lo ? 0 : 1 });
    else if (r === 3) { if (lo) pSash(g, x, y, cw, ch, R, { f, st: c % 2 ? 3 : 4 }); else pSash(g, x, y, cw, ch, R, { f, frost: true, grille: true }); }
    else if (r === 4) { if (lo) pSash(g, x, y, cw, ch, R, { f, n: 1, st: 4 }); else pSash(g, x, y, cw, ch, R, { f, n: 1, frost: c % 2 === 1 }); }
    else if (r === 5) pDoor(g, x, y, cw, ch, R, c);
    else if (r === 6) { if (lo) pMono(g, x, y, cw, ch, R, c); else pDoor2(g, x, y, cw, ch, R, c - 4); }
    else if (r === 7) pWafu(g, x, y, cw, ch, R, c);
    else if (r === 8) pYo(g, x, y, cw, ch, R, c);
    else if (r === 9) pProp(g, x, y, cw, ch, R, c);
    else pApt(g, x, y, cw, ch, R, c);
  }
});
const WP = 1 / 1024;
const wuv0 = (c, r) => [c / 8 + WP * 2, 1 - (r + 1) / 16 + WP, (c + 1) / 8 - WP * 2, 1 - r / 16 - WP];
const WUVT = []; for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) WUVT.push(wuv0(c, r));
// ます（c 列・r 行）の uv。表から（同じ 配列を かえす。書きかえないこと）
const wuv = (c, r) => c >= 0 && c < 8 && r >= 0 && r < 16 && c === (c | 0) && r === (r | 0) ? WUVT[r * 8 + c] : wuv0(c, r);

/* ---------- 質感：塀・手すり・ガラス ---------- */
// 塀（帯 8本・横にくりかえす）：0 ブロック 1 化粧ブロック 2 目かくしフェンス（そめる）3 生け垣 4 しっくいの塀 5 石積み 6 コンクリートの擁壁 7 板塀
const EXT = TX('ext', 256, 512, (g, w, h, R) => {
  const bh = h / 8;
  for (let b = 0; b < 8; b++) { const y = b * bh;
    if (b === 0 || b === 1) { const nc = b ? 5 : 6, c = b ? '#d7ccb6' : '#b7b6af'; PT.fill(g, 0, y, w, bh, b ? '#b5aa96' : '#9a9993'); for (let k = 0; k < nc; k++) for (let i = 0; i < 4; i++) { const x = (i + (k % 2) * 0.5) * w / 4; g.fillStyle = PT.css(c, 0.92 + R() * 0.12); wrapR(g, x + 1, y + bh * k / nc + 1, w / 4 - 2, bh / nc - 2, w, h); }
      PT.fill(g, 0, y, w, bh / nc * 0.6, b ? '#e2dac8' : '#c9c8c2'); PT.noise(g, 0, y, w, bh, 0.05, R); }
    else if (b === 2) { PT.fill(g, 0, y, w, bh, '#e4e5e6'); for (let k = 0; k < 9; k++) { PT.fill(g, 0, y + bh * k / 9, w, bh / 9 * 0.78, '#eef0f1'); PT.fill(g, 0, y + bh * (k + 0.78) / 9, w, bh / 9 * 0.22, '#5c5f62'); } PT.fill(g, 0, y, w * 0.03, bh, '#c9cbcd'); }
    else if (b === 3) { PT.fill(g, 0, y, w, bh, '#3f5a33'); for (let i = 0; i < 700; i++) { g.fillStyle = PT.css(pick(R, ['#4e6d3c', '#5b7a45', '#36502b', '#6a8a50']), 1); const s = Math.max(1, w / 90) * (1 + R() * 1.5); g.fillRect(R() * w, y + R() * bh, s, s); } g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, y, w, bh * 0.2); }
    else if (b === 4) { PT.fill(g, 0, y, w, bh, '#efece5'); PT.noise(g, 0, y, w, bh * 0.8, 0.03, R); PT.fill(g, 0, y + bh * 0.8, w, bh * 0.2, '#8d8a84'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y, w, bh * 0.05); g.fillStyle = 'rgba(80,70,50,.08)'; for (let i = 0; i < 8; i++) g.fillRect(R() * w, y + bh * 0.05, w * 0.02, bh * 0.4 * R()); }
    else if (b === 5) { PT.fill(g, 0, y, w, bh, '#8b8880'); for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) { const x = (i + (k % 2) * 0.5) * w / 6; g.fillStyle = PT.css('#b5b1a7', 0.85 + R() * 0.25); wrapR(g, x + 1.5, y + bh * k / 4 + 1.5, w / 6 - 3, bh / 4 - 3, w, h); } PT.noise(g, 0, y, w, bh, 0.05, R); }
    else if (b === 6) { PT.fill(g, 0, y, w, bh, '#aeaca6'); PT.noise(g, 0, y, w, bh, 0.04, R); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, y, Math.max(1, w / 128), bh); g.fillStyle = '#3c3c3a'; g.beginPath(); g.arc(w * 0.5, y + bh * 0.6, Math.max(1.5, bh * 0.06), 0, 6.283); g.fill(); PT.streaks(g, 0, y + bh * 0.62, w, bh * 0.38, 4, 0.12, R); }
    else { PT.fill(g, 0, y, w, bh, '#4d3d2f'); for (let i = 0; i < 16; i++) PT.fill(g, i * w / 16, y, w / 16 - 1, bh, '#5d4a39', 0.85 + R() * 0.3); PT.fill(g, 0, y + bh * 0.15, w, bh * 0.04, '#3a2d22'); PT.fill(g, 0, y + bh * 0.75, w, bh * 0.04, '#3a2d22'); }
  }
});
const EB0 = (b) => [1 - (b + 1) / 8 + 1 / 512, 1 - b / 8 - 1 / 512], EBT = [0, 1, 2, 3, 4, 5, 6, 7].map(EB0), EB = b => EBT[b] || EB0(b);
// 手すり（すかし・帯 8本）：0 アルミの たて格子（そめる）1 鉄の手すり 2 あみのフェンス 3 洋風の鉄柵 4 パネル 5 横格子 6 木の格子 7 自転車（ます 2つ）
const RAIL = TX('rail', 256, 256, (g, w, h, R) => {
  g.clearRect(0, 0, w, h); const bh = h / 8;
  for (let b = 0; b < 7; b++) { const y = b * bh, c = b === 3 ? '#e4e4e4' : '#eceeef';
    if (b === 0 || b === 1) { PT.fill(g, 0, y + bh * 0.02, w, bh * 0.12, c); PT.fill(g, 0, y + bh * 0.88, w, bh * 0.1, c); const nb = b ? 12 : 20; for (let i = 0; i < nb; i++) PT.fill(g, i * w / nb, y, Math.max(1, w / nb * (b ? 0.3 : 0.38)), bh, c); }
    else if (b === 2) { PT.fill(g, 0, y, w, bh * 0.08, c); for (let i = 0; i < 24; i++) { g.strokeStyle = PT.css(c); g.lineWidth = Math.max(1, w / 200); g.beginPath(); g.moveTo(i * w / 24, y); g.lineTo(i * w / 24 + bh, y + bh); g.moveTo(i * w / 24 + bh, y); g.lineTo(i * w / 24, y + bh); g.stroke(); } PT.fill(g, 0, y + bh * 0.92, w, bh * 0.08, c); }
    else if (b === 3) { PT.fill(g, 0, y + bh * 0.15, w, bh * 0.06, c); PT.fill(g, 0, y + bh * 0.85, w, bh * 0.08, c); for (let i = 0; i < 16; i++) { const x = i * w / 16; PT.fill(g, x, y + bh * 0.06, Math.max(1, w / 90), bh * 0.94, c); g.fillStyle = PT.css(c); g.beginPath(); g.moveTo(x - w / 120, y + bh * 0.1); g.lineTo(x + w / 180, y); g.lineTo(x + w / 60, y + bh * 0.1); g.fill(); } }
    else if (b === 4) { PT.fill(g, 0, y, w, bh, '#d6dadd'); PT.fill(g, 0, y, w, bh * 0.1, '#eceeef'); for (let i = 0; i < 4; i++) PT.fill(g, i * w / 4, y, Math.max(1, w / 100), bh, '#eceeef'); g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(0, y + bh * 0.1, w, bh * 0.3); }
    else if (b === 5) { for (let k = 0; k < 6; k++) PT.fill(g, 0, y + bh * k / 6, w, bh / 6 * 0.6, c); PT.fill(g, 0, y, Math.max(1, w / 64), bh, c); }
    else { g.strokeStyle = '#e8e1d6'; g.lineWidth = Math.max(1, w / 90); for (let i = -8; i < 24; i++) { g.beginPath(); g.moveTo(i * w / 16, y); g.lineTo(i * w / 16 + bh, y + bh); g.moveTo(i * w / 16 + bh, y); g.lineTo(i * w / 16, y + bh); g.stroke(); } PT.fill(g, 0, y, w, bh * 0.1, '#e8e1d6'); }
  }
  // 自転車（2台。はばは帯の 半分ずつ）
  for (let k = 0; k < 2; k++) { const x = k * w / 2, y = 7 * bh, cw = w / 2, c = k ? '#3b4a5c' : '#b8bcc0';
    g.strokeStyle = '#2b2b2b'; g.lineWidth = Math.max(1, cw / 40); for (const fx of [0.22, 0.78]) { g.beginPath(); g.ellipse(x + cw * fx, y + bh * 0.68, cw * 0.17, bh * 0.3, 0, 0, 6.283); g.stroke(); }
    g.strokeStyle = c; g.lineWidth = Math.max(1, cw / 30); g.beginPath(); g.moveTo(x + cw * 0.22, y + bh * 0.68); g.lineTo(x + cw * 0.45, y + bh * 0.68); g.lineTo(x + cw * 0.38, y + bh * 0.3); g.lineTo(x + cw * 0.7, y + bh * 0.3); g.lineTo(x + cw * 0.78, y + bh * 0.68); g.moveTo(x + cw * 0.45, y + bh * 0.68); g.lineTo(x + cw * 0.7, y + bh * 0.3); g.moveTo(x + cw * 0.7, y + bh * 0.3); g.lineTo(x + cw * 0.72, y + bh * 0.12); g.stroke();
    PT.fill(g, x + cw * 0.66, y + bh * 0.08, cw * 0.14, bh * 0.06, '#2b2b2b'); PT.fill(g, x + cw * 0.33, y + bh * 0.22, cw * 0.1, bh * 0.06, '#2b2b2b'); PT.fill(g, x + cw * 0.76, y + bh * 0.18, cw * 0.16, bh * 0.16, '#5b5f63'); }
}, { alpha: true });
const RB0 = (b) => [1 - (b + 1) / 8 + 1 / 256, 1 - b / 8 - 1 / 256], RBT = [0, 1, 2, 3, 4, 5, 6, 7].map(RB0), RB = b => RBT[b] || RB0(b);
// ガラス（半とうめい）：上 ガラスの手すり・下 カーポートのポリカ屋根
const GLS = TX('glass', 64, 64, (g, w, h) => {
  PT.fill(g, 0, 0, w, h / 2, '#c5d5de'); PT.fill(g, 0, 0, w, h * 0.05, '#e9eef1');
  PT.fill(g, 0, h / 2, w, h / 2, '#e3ebef'); g.fillStyle = 'rgba(120,130,140,.5)'; for (let i = 0; i < 4; i++) g.fillRect(i * w / 4, h / 2, Math.max(1, w / 32), h / 2);
}, { tr: true, op: 0.5 });

/* ---------- 遠く用の外壁（窓を描いた 128px） ---------- */
const FAR1 = TX('far1', 128, 128, (g, w, h, R) => {   // 家（2柱間 × 2階）
  PT.fill(g, 0, 0, w, h, '#f1efea'); PT.hlines(g, 0, 0, w, h, h / 24, '#dad6ce', 1);
  const pane = (x, y, ww, hh) => { PT.fill(g, x, y, ww, hh, '#c9ccce'); pGlass(g, x + 1, y + 1, ww - 2, hh - 2); PT.fill(g, x + ww / 2 - 0.5, y, 1, hh, '#c9ccce'); };
  pane(w * 0.08, h * 0.08, w * 0.34, h * 0.24); pane(w * 0.6, h * 0.1, w * 0.18, h * 0.2);
  pane(w * 0.06, h * 0.56, w * 0.36, h * 0.4); pane(w * 0.58, h * 0.62, w * 0.3, h * 0.22);
  PT.fill(g, w * 0.04, h * 0.05, w * 0.42, h * 0.035, '#d9dadb');
});
const FARM = TX('farm', 128, 128, (g, w, h, R) => {   // マンション（2戸 × 2階。ベランダ）
  PT.fill(g, 0, 0, w, h, '#efede8');
  for (let j = 0; j < 2; j++) { const y = j * h / 2;
    for (let i = 0; i < 2; i++) { const x = i * w / 2; PT.fill(g, x + w * 0.04, y + h * 0.08, w * 0.42, h * 0.3, '#59636c'); pGlass(g, x + w * 0.05, y + h * 0.09, w * 0.4, h * 0.28); PT.fill(g, x, y + h * 0.3, w / 2, h * 0.16, '#e3e1db'); PT.fill(g, x + w * 0.49, y + h * 0.05, w * 0.02, h * 0.41, '#d4d2cc'); }
    PT.fill(g, 0, y + h * 0.46, w, h * 0.04, '#c9c6bf'); }
});
const FART = TX('fart', 128, 128, (g, w, h, R) => {   // タワー（ガラスの手すり・まわりバルコニー）
  PT.fill(g, 0, 0, w, h, '#d9dde0');
  for (let j = 0; j < 4; j++) { const y = j * h / 4; pGlass(g, 0, y + h * 0.02, w, h * 0.16); g.fillStyle = 'rgba(200,214,222,.7)'; g.fillRect(0, y + h * 0.13, w, h * 0.09); PT.fill(g, 0, y + h * 0.22, w, h * 0.03, '#eef0f1'); for (let i = 0; i < 4; i++) PT.fill(g, i * w / 4, y, Math.max(1, w / 64), h * 0.22, '#c9cdd0'); }
});

/* ---------- 小物 ---------- */
// 辺 e の外に 四角（窓・ドア）：はじめから s m がまん中・はば w・y0〜y1。uv：アトラスの ます
function panel(B, m, e, s, w, y0, y1, uv, off, c) {
  const tx = (e.bx - e.ax) / e.L, tz = (e.bz - e.az) / e.L, o = off == null ? 0.08 : off, hw = w / 2;
  const cx = e.ax + tx * s + e.nx * o, cz = e.az + tz * s + e.nz * o;
  wq(B, m, cx + tx * hw, y0, cz + tz * hw, cx - tx * hw, y0, cz - tz * hw, cx - tx * hw, y1, cz - tz * hw, cx + tx * hw, y1, cz + tz * hw, e.nx, 0, e.nz, c || WH, uv[0], uv[1], uv[2], uv[3], 1, 1);
}
// 手すり・塀の帯（すかしの RAIL か EXT）：辺 e の外 dep m・s0〜s1・y〜y+h
function band(B, m, e, s0, s1, dep, y, h, vb, su, c) {
  const tx = (e.bx - e.ax) / e.L, tz = (e.bz - e.az) / e.L;
  wall2(B, m, e.ax + tx * s0 + e.nx * dep, e.az + tz * s0 + e.nz * dep, e.ax + tx * s1 + e.nx * dep, e.az + tz * s1 + e.nz * dep, y, y + h, c || WH, 0, (s1 - s0) / su, vb[0], vb[1]);
}
// 点 a→b の 帯（自由な向き）
function bandP(B, m, a, b, y, h, vb, su, c) { wall2(B, m, a[0], a[1], b[0], b[1], y, y + h, c || WH, 0, Math.hypot(b[0] - a[0], b[1] - a[1]) / su, vb[0], vb[1]); }
const TRUNK = [0.36, 0.28, 0.2];
// 木：まるい 葉のかたまり（5角 2段）と幹
function tree(B, x, z, y, h, r, c, R) {
  const lc = col(c), yT = y + h * 0.3, hh = h - (yT - y), y1 = yT + hh * 0.38, y2 = yT + hh * 0.74, n = 5, rot = R() * 6.283;
  wq(B, 'c', x - 0.09, y, z, x + 0.09, y, z, x + 0.07, yT + 0.4, z, x - 0.07, yT + 0.4, z, 0, 0, 1, TRUNK, 0, 0, 0, 0, 1, 1);
  const top = [x + (R() - 0.5) * 0.4, y + h, z + (R() - 0.5) * 0.4], bot = [x, yT, z], r1 = [], r2 = [], hi = mix(lc, [0.95, 0.95, 0.7], 0.1), dk = mul(lc, 0.7), mid = mix(lc, hi, 0.5);
  for (let i = 0; i < n; i++) { const t = rot + i / n * 6.283, k = 0.82 + 0.36 * R(), t2 = t + Math.PI / n; r1.push([x + Math.cos(t) * r * k, y1 + (R() - 0.5) * 0.3, z + Math.sin(t) * r * k]); r2.push([x + Math.cos(t2) * r * 0.74 * k, y2, z + Math.sin(t2) * r * 0.74 * k]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; const p = r1[i], q = r1[j], u = r2[i], v = r2[j]; wt(B, 'c', u[0], u[1], u[2], top[0], top[1], top[2], v[0], v[1], v[2], hi); wt(B, 'c', p[0], p[1], p[2], u[0], u[1], u[2], q[0], q[1], q[2], lc); wt(B, 'c', q[0], q[1], q[2], u[0], u[1], u[2], v[0], v[1], v[2], mid); wt(B, 'c', q[0], q[1], q[2], bot[0], bot[1], bot[2], p[0], p[1], p[2], dk); }
}
// 松（ななめの幹と、平たい 葉の段 3つ）
function pine(B, x, z, y, h, r, R) {
  const tc = [0.3, 0.25, 0.2], lc = [0.19, 0.31, 0.19], dx = (R() - 0.5) * 0.8, dz = (R() - 0.5) * 0.8;
  B.quad('c', [x - 0.1, y, z], [x + 0.1, y, z], [x + dx + 0.07, y + h * 0.8, z + dz], [x + dx - 0.07, y + h * 0.8, z + dz], null, tc);
  B.quad('c', [x, y, z - 0.1], [x, y, z + 0.1], [x + dx, y + h * 0.8, z + dz + 0.07], [x + dx, y + h * 0.8, z + dz - 0.07], null, tc);
  for (let k = 0; k < 3; k++) { const f = 0.45 + k * 0.24, yy = y + h * f, cx = x + dx * f / 0.8 + (k === 1 ? r * 0.45 : k === 2 ? -r * 0.25 : 0), cz = z + dz * f / 0.8 + (k === 1 ? -r * 0.2 : 0), rr = r * (1.05 - k * 0.25), n = 5, rot = R() * 6;
    const ring = []; for (let i = 0; i < n; i++) { const t = rot + i / n * 6.283; ring.push([cx + Math.cos(t) * rr * (0.8 + 0.3 * R()), yy, cz + Math.sin(t) * rr * 0.75]); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.tri('c', ring[i], [cx, yy + 0.45, cz], ring[j], null, mix(lc, [0.32, 0.45, 0.28], (i % 2) * 0.35)); B.tri('c', ring[j], [cx, yy - 0.2, cz], ring[i], null, mul(lc, 0.7)); } }
}
// 丸い植えこみ（ツゲ・ツツジ）
function shrub(B, x, z, y, r, c) {
  const lc = col(c), n = 5, ring = [];
  for (let i = 0; i < n; i++) { const t = i / n * 6.283 + x; ring.push([x + Math.cos(t) * r, y + r * 0.55, z + Math.sin(t) * r]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.tri('c', ring[i], [x, y + r * 1.25, z], ring[j], null, mix(lc, [0.8, 0.85, 0.6], 0.08)); B.tri('c', ring[j], [x + (ring[j][0] - x) * 0.8, y, z + (ring[j][2] - z) * 0.8], ring[i], null, mul(lc, 0.8)); }
}
// 車（0 軽のトールワゴン・1 ふつうの車・2 ミニバン）：まん中 x, z・前の向き ang
const CARC = ['#ecebe7', '#ecebe7', '#f2f1ee', '#e4e3df', '#1d1e20', '#26282b', '#b3b6ba', '#9a9ea3', '#6b6e72', '#2c3750', '#5e2a2d', '#c9bea4', '#9fb7c6', '#4a5446'];
const CARGL = [0.16, 0.19, 0.23], CARUB = [0.1, 0.1, 0.11];
const CARS = [   // 長さ・はば・車体の上・屋根・キャビン（下の 前・後ろ、上の 前・後ろ）
  [3.4, 1.48, 0.95, 1.74, 0.95, -1.62, 0.5, -1.6], [4.4, 1.72, 0.86, 1.43, 1.15, -1.45, 0.35, -1.05], [4.7, 1.74, 1.0, 1.86, 1.45, -2.25, 0.85, -2.2]];
function car(B, x, z, ang, R, t) {
  const c = col(pick(R, CARC)), gl = CARGL, ty = t == null ? Math.floor(R() * 3) : t, cv = CARS[ty], L0 = cv[0], W0 = cv[1], hb = cv[2], hc = cv[3], cf0 = cv[4], cb0 = cv[5], cf1 = cv[6], cb1 = cv[7];
  const ca = Math.cos(ang), sa = Math.sin(ang), hl = L0 / 2, hw = W0 / 2;
  // 前後（u）・左右（w）の 箱：側面 4つ（+ 上）。下の幅 w0・上の幅 w1、前 u1・後ろ u0（上で uf・ub）
  const box = (u0, u1, uf, ub, w0, w1, y0, y1, k, top) => {
    const X = (u, w) => x + ca * u - sa * w, Z = (u, w) => z + sa * u + ca * w;
    // 右（+w）・前（+u）・左（-w）・後ろ（-u）
    wq(B, 'c', X(u0, w0), y0, Z(u0, w0), X(u1, w0), y0, Z(u1, w0), X(uf, w1), y1, Z(uf, w1), X(ub, w1), y1, Z(ub, w1), -sa, 0, ca, k, 0, 0, 0, 0, 1, 1);
    wq(B, 'c', X(u1, w0), y0, Z(u1, w0), X(u1, -w0), y0, Z(u1, -w0), X(uf, -w1), y1, Z(uf, -w1), X(uf, w1), y1, Z(uf, w1), ca, 0, sa, k, 0, 0, 0, 0, 1, 1);
    wq(B, 'c', X(u1, -w0), y0, Z(u1, -w0), X(u0, -w0), y0, Z(u0, -w0), X(ub, -w1), y1, Z(ub, -w1), X(uf, -w1), y1, Z(uf, -w1), sa, 0, -ca, k, 0, 0, 0, 0, 1, 1);
    wq(B, 'c', X(u0, -w0), y0, Z(u0, -w0), X(u0, w0), y0, Z(u0, w0), X(ub, w1), y1, Z(ub, w1), X(ub, -w1), y1, Z(ub, -w1), -ca, 0, -sa, k, 0, 0, 0, 0, 1, 1);
    if (top) wq(B, 'c', X(ub, w1), y1, Z(ub, w1), X(uf, w1), y1, Z(uf, w1), X(uf, -w1), y1, Z(uf, -w1), X(ub, -w1), y1, Z(ub, -w1), 0, 1, 0, top, 0, 0, 0, 0, 1, 1); };
  box(-hl + 0.45, hl - 0.45, hl - 0.45, -hl + 0.45, hw - 0.12, hw - 0.12, 0.05, 0.32, CARUB, null);
  box(-hl, hl, hl, -hl, hw, hw, 0.3, hb, c, c);
  box(cb0, cf0, cf1, cb1, hw - 0.06, hw - 0.16, hb, hc, gl, c);
}
const AC_UV = wuv(0, 9), AC_S = [0.836, 0.836, 0.817];
// 室外機（前に ファンの絵。うしろの面は なし）：まん中 x, z・向き ang（前は (-sin, cos)）
function acU(B, x, z, y, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), nx = -s, nz = c, hw = 0.4, hd = 0.14, y1 = y + 0.62, k = [0.88, 0.88, 0.86];
  const P = (u, v) => [x + c * u + nx * v, z + s * u + nz * v];
  const fl = P(hw, hd), fr = P(-hw, hd), bl = P(hw, -hd), br = P(-hw, -hd);
  const uv = AC_UV;
  wq(B, WIN, fl[0], y, fl[1], fr[0], y, fr[1], fr[0], y1, fr[1], fl[0], y1, fl[1], nx, 0, nz, WH, uv[0], uv[1], uv[2], uv[3], 1, 1);
  wq(B, 'c', fl[0], y1, fl[1], fr[0], y1, fr[1], br[0], y1, br[1], bl[0], y1, bl[1], 0, 1, 0, k, 0, 0, 0, 0, 1, 1);
  wall2(B, 'c', fr[0], fr[1], br[0], br[1], y, y1, AC_S, 0, 0, 0, 0); wall2(B, 'c', bl[0], bl[1], fl[0], fl[1], y, y1, AC_S, 0, 0, 0, 0);
}
// 細い柱（2枚の板を 十字に）
function post(B, x, z, y0, y1, w, c) { wq(B, 'c', x - w, y0, z, x + w, y0, z, x + w, y1, z, x - w, y1, z, 0, 0, 1, c, 0, 0, 0, 0, 1, 1); wq(B, 'c', x, y0, z - w, x, y0, z + w, x, y1, z + w, x, y1, z - w, 1, 0, 0, c, 0, 0, 0, 0, 1, 1); }

/* ---------- 戸建て ----------
   見た目 L：{ n, w, wc（外壁の材料・色）, w2, wc2（2階より上）, ac, acc（アクセントの材料・色）, rf（'gable' 切妻・'hip' 寄棟・'shed' 片流れ・'flat' 陸屋根）, rm, rc（屋根の材料・色）, p, oh,
     fc（鼻隠し）, gc（雨どい）, fr（サッシの色 0 シルバー・1 ブロンズ・2 黒・3 白）, bal（'alu' アルミ・'solid' 腰壁・'glass'・'none'）, dr（ドア）, fen（塀）, sh（雨戸の わり）, gd（庭：'gravel'・'lawn'）, solar, pine }
   kind の P.ko：{ mw, md（家の はば・奥行きの めやす m）, fmax, garage（車庫を1階に）, two（玄関 2つ）, cars, big } */
const WT = { K: [1.69, 2.0, 0.02], K2: [1.2, 2.0, 0.02], H: [1.69, 1.17, 0.88], H2: [1.19, 0.97, 1.0], S: [0.6, 0.74, 1.25], SL: [0.42, 1.17, 0.88], FX: [0.6, 0.6, 1.55], HI: [1.69, 0.45, 1.72] };
// 洋館（たて長の 上げ下げ窓・フランス窓）と 和風（縁側の ガラス戸・格子窓）の 窓の 大きさ
const WTS = { yo: { K: [1.3, 2.3, 0.02], K2: [1.2, 2.2, 0.02], H: [0.9, 1.65, 0.7], H2: [0.9, 1.5, 0.8], S: [0.6, 0.95, 1.05], SL: [0.55, 1.4, 0.8], FX: [0.8, 1.0, 1.2], HI: [0.9, 1.65, 0.7] },
  lux: { K: [3.2, 2.4, 0.02], K2: [2.4, 2.4, 0.02], H: [2.6, 1.5, 0.6], H2: [1.69, 1.2, 0.85], S: [0.6, 0.9, 1.2], SL: [0.35, 2.1, 0.3], FX: [1.2, 1.2, 1.0], HI: [2.6, 0.5, 1.85] },
  wa: { K: [2.6, 1.95, 0.02], K2: [1.8, 1.95, 0.02], H: [1.69, 1.1, 0.8], H2: [1.2, 0.95, 0.95], S: [0.6, 0.7, 1.25], SL: [0.9, 1.4, 0.6], FX: [0.75, 0.75, 1.2], HI: [1.69, 0.45, 1.72] } };
function winUV(t, f, R, st) {
  const r = R();
  if (st === 'yo') { if (t === 'K' || t === 'K2') return r < 0.5 ? wuv(1, 8) : wuv(3, 5); if (t === 'FX') return wuv(3, 8); return r < 0.55 ? wuv(0, 8) : r < 0.8 ? wuv(2, 8) : wuv(1, 8); }
  if (st === 'lux') { if (t === 'K' || t === 'K2') return r < 0.5 ? wuv(2, 10) : wuv(3, 8); if (t === 'SL' || t === 'FX') return wuv(f, 4); if (t === 'H' || t === 'HI') return wuv(f, 4); return winUV(t, f, R); }
  if (st === 'wa') { if (t === 'K' || t === 'K2') return r < 0.6 ? wuv(6, 7) : wuv(0, 7); if (t === 'SL') return wuv(1, 7); if (t === 'FX') return r < 0.4 ? wuv(4, 7) : wuv(5, 7); if (t === 'S') return wuv(5, 3); return r < 0.5 ? wuv(5, 7) : wuv(0, 7); }
  if (t === 'K' || t === 'K2') return r < 0.4 ? wuv(f, 2) : r < 0.75 ? wuv(4 + f, 2) : wuv(f, 3);
  if (t === 'H' || t === 'H2' || t === 'HI') return wuv(f + (r < 0.3 || (r >= 0.55 && r < 0.75) ? 0 : 4), r < 0.55 ? 0 : 1);
  if (t === 'S') return wuv(4 + f, 3);
  if (t === 'SL') return wuv(f, 4);
  return wuv(4 + f, 4);
}
// 面の 役（S 南・F 道・N 北・X 横）と 階 k → 窓の ならび（定数の 配列。書きかえないこと）
const WLS = [['K', 'K', 'H', 'K'], ['K', 'H', 'K'], ['K', 'K', 'S'], ['H', 'H2', 'S'], ['H', 'H', 'H2'], ['H', 'SL', 'H']], WLF = [['S', 'H2', 'SL'], ['H2', 'S'], ['H', 'SL', 'H2'], ['H2', 'H2', 'S'], ['SL', 'H', 'SL']],
  WLN = [['S', 'H2', 'S'], ['H2', 'S'], ['S', 'FX', 'H2']], WLX = [['H2', 'S'], ['SL', 'SL'], ['H'], ['S', 'FX'], ['H2'], [], ['S']], WLW = [['K', 'H'], ['H2', 'S']];
function winList(role, k, R, bal) {
  const r = R();
  if (role === 'S') { if (k === 0) return r < 0.4 ? WLS[0] : r < 0.7 ? WLS[1] : WLS[2];
    return bal ? WLS[3] : r < 0.5 ? WLS[4] : WLS[5]; }
  if (role === 'F') return k === 0 ? (r < 0.5 ? WLF[0] : WLF[1]) : (r < 0.4 ? WLF[2] : r < 0.7 ? WLF[3] : WLF[4]);
  if (role === 'N') return k === 0 ? (r < 0.5 ? WLN[0] : WLN[1]) : (r < 0.5 ? WLN[1] : WLN[2]);
  return pick(R, WLX);
}
// 家の窓：区間に ならべて、窓の表（WIN_E・WIN_T・WIN_F）に 入れ、その番号を かご wb に（大きい窓・道と南 から）
const SGA = new Float64Array(32), SGB = new Float64Array(32), SGU = new Float64Array(32), SGN = new Int32Array(32), ASG = new Int32Array(16);
const WIN_E = [], WIN_T = [], WIN_F = new Float64Array(4 * 1024), WBK = [[], [], [], [], [], []];
let WIN_N = 0;
function fitWinsH(segs, list, gap, R, WT, e, yF, yTop, rp, wb) {
  let ns = 0; const nl = Math.min(list.length, 16);
  for (const g of segs) if (g[1] - g[0] > 1.2 && ns < 32) { SGA[ns] = g[0] + 0.4; SGB[ns] = g[1] - 0.4; SGU[ns] = 0; SGN[ns] = 0; ns++; }
  for (let i = 0; i < nl; i++) { const w = WT[list[i]][0]; let best = -1, bf = -1;
    for (let g = 0; g < ns; g++) { const fr = SGB[g] - SGA[g] - SGU[g] - SGN[g] * gap; if (fr >= w && fr > bf) { bf = fr; best = g; } }
    ASG[i] = best; if (best >= 0) { SGN[best]++; SGU[best] += w; } }
  for (let g = 0; g < ns; g++) { const ni = SGN[g]; if (!ni) continue; const sp = (SGB[g] - SGA[g] - SGU[g]) / (ni + 1); let x = SGA[g] + sp;
    for (let i = 0; i < nl; i++) { if (ASG[i] !== g) continue; const t = list[i], wt = WT[t], w = wt[0], sc = x + w / 2 + (R() - 0.5) * sp * 0.5; x += w + sp;
      const y0 = yF + wt[2], y1 = Math.min(y0 + wt[1], yTop); if (y1 - y0 < 0.3 || WIN_N >= 1024) continue;
      const id = WIN_N++; WIN_E[id] = e; WIN_T[id] = t; WIN_F[id * 4] = sc; WIN_F[id * 4 + 1] = wt[0]; WIN_F[id * 4 + 2] = y0; WIN_F[id * 4 + 3] = y1;
      wb[(t === 'K' || t === 'H' ? 0 : t === 'H2' ? 2 : 4) + rp].push(id); } }
}
// 区間に 窓を ならべる → [{ t, s（まん中）}]
function fitWins(segs, list, gap, R, WT, cb) {
  const sg = [];
  for (const s of segs) if (s[1] - s[0] > 1.2) sg.push({ a: s[0] + 0.4, b: s[1] - 0.4, it: [], used: 0 });
  for (const t of list) { const w = WT[t][0]; let best = null, bf = -1;
    for (const s of sg) { const fr = s.b - s.a - s.used - s.it.length * gap; if (fr >= w && fr > bf) { bf = fr; best = s; } }
    if (best) { best.it.push(t); best.used += w; } }
  const out = cb ? null : [];
  for (const s of sg) { const ni = s.it.length; if (!ni) continue; const sp = (s.b - s.a - s.used) / (ni + 1); let x = s.a + sp;
    for (const t of s.it) { const w = WT[t][0], j = (R() - 0.5) * sp * 0.5; if (cb) cb(t, x + w / 2 + j); else out.push({ t, s: x + w / 2 + j }); x += w + sp; } }
  return out;
}
const roleOf = (e, n) => e.nz > 0.5 ? 'S' : (e.nx * n[0] + e.nz * n[1]) > 0.5 ? 'F' : e.nz < -0.5 ? 'N' : 'X';
// 家の配置（局所の座標）：区画 W × D → { parts: [{ r: [u0, v0, u1, v1], f0, f1, acc, wing }], park: [u0, v0, u1, v1] | null, cars, gar（車庫の場所）}
function houseLayout(W, D, fl, O, L, R, tilt) {
  const ss = tilt ? 0.3 : 0.7, sb = tilt ? 0.3 : 0.85, cw = O.cw || 15.5, cd2 = O.cd || 11.5, mw0 = Math.min(cw, Math.max(O.mw || 9.1, W * 0.5)) * (0.86 + 0.28 * R()), md0 = Math.min(cd2, Math.max(O.md || 8.2, D * 0.55)) * (0.88 + 0.24 * R());
  const sn = (v) => Math.max(3.64, Math.floor(v / 0.455 + 1e-6) * 0.455);
  const cars = O.cars != null ? O.cars : (W >= 16.5 && R() < 0.7 ? 2 : 1), pw = cars * 2.5 + 0.4, pd = 5.2;
  const out = { parts: [], park: null, cars, side: R() < 0.5 ? 0 : 1 };
  const wA = Math.min(mw0, W - pw - ss - 0.3), dA = Math.min(md0, D - 1.1 - sb), wB = Math.min(mw0, W - 2 * ss), dB = Math.min(md0, D - pd - 0.7 - sb);
  const sA = wA >= 4.4 && dA >= 4.4 ? wA * dA : 0, sB = wB >= 4.4 && dB >= 4.4 ? wB * dB : 0;
  let hu0, hv0, hw, hd, mode = O.garage ? 'G' : sA >= sB * 0.9 && sA > 0 ? 'A' : sB > 0 ? 'B' : 'N';
  if (mode === 'G') { hw = sn(Math.min(O.mw || 7.3, W - 1.0)); hd = sn(Math.min(md0, D - 1.0 - 0.7)); hu0 = (W - hw) / 2; hv0 = 0.8; }
  else if (mode === 'A') { const f0 = tilt ? 0.3 : 1.0; hw = sn(wA); hd = sn(dA); hv0 = f0 + Math.max(0, Math.min(D - sb - hd - f0, (D - sb - hd - f0) * (O.back == null ? R() : O.back)));
    const pu0 = out.side ? W - pw - 0.05 : 0.05; out.park = [pu0, 0.05, pu0 + pw, 0.05 + pd]; hu0 = out.side ? W - pw - 0.35 - hw : pw + 0.35; }
  else if (mode === 'B') { hw = sn(wB); hd = sn(dB); hv0 = D - sb - hd; hu0 = ss + (W - 2 * ss - hw) * R(); const pu0 = out.side ? W - pw - 0.05 : 0.05; out.park = [pu0, 0.05, pu0 + pw, 0.05 + pd]; }
  else { hw = sn(Math.max(3.6, W - 2 * ss)); hd = sn(Math.max(3.6, D - (tilt ? 0.3 : 1.0) - sb)); hu0 = (W - hw) / 2; hv0 = tilt ? 0.3 : 1.0; out.cars = 0; }
  hw = Math.min(hw, W - 0.6); hd = Math.min(hd, D - 0.9);
  const H = [hu0, hv0, hu0 + hw, hv0 + hd];
  out.house = H; out.mode = mode;
  // かたち：box（総2階）・L（かどを へこませる）・ext（1階の 下屋）・gar（1階に 車庫）
  const r = R(), big = hw * hd > 48;
  let mt = L.mt || (r < 0.3 ? 'box' : r < 0.62 ? 'L' : 'ext');
  if (fl === 1) mt = r < 0.5 ? 'L' : 'box';
  if (mode === 'G') mt = 'gar';
  if (!big && mt === 'L' && hw * hd < 36) mt = 'box';
  if (mt === 'gar') {
    const gw = Math.min(3.1, hw * 0.55), gd = Math.min(5.6, hd - 1.8), left = out.side === 0;
    const g0 = left ? H[0] : H[2] - gw;
    out.gar = [g0, H[1], g0 + gw, H[1] + gd];
    if (left) { out.parts.push({ r: [H[0] + gw, H[1], H[2], H[1] + gd], f0: 0, f1: fl }); }
    else out.parts.push({ r: [H[0], H[1], H[2] - gw, H[1] + gd], f0: 0, f1: fl });
    out.parts.push({ r: [H[0], H[1] + gd, H[2], H[3]], f0: 0, f1: fl });
    out.parts.push({ r: out.gar, f0: 1, f1: fl, soffit: true });
    out.cars = 1; out.park = null;
  } else if (mt === 'L') {
    const nw = sn(clamp(hw * (0.3 + 0.15 * R()), 1.82, 3.64)), nd = sn(clamp(hd * (0.25 + 0.2 * R()), 1.36, 2.73)), left = out.park ? out.side === 1 : R() < 0.5;
    // 道に近いかどを へこませる（玄関の ポーチに）
    if (left) { out.parts.push({ r: [H[0] + nw, H[1], H[2], H[3]], f0: 0, f1: fl }); out.parts.push({ r: [H[0], H[1] + nd, H[0] + nw, H[3]], f0: 0, f1: fl, acc: true }); out.notch = [H[0], H[1], H[0] + nw, H[1] + nd]; out.maxr = [[H[0] + nw, H[1], H[2], H[3]], [H[0], H[1] + nd, H[2], H[3]]]; }
    else { out.parts.push({ r: [H[0], H[1], H[2] - nw, H[3]], f0: 0, f1: fl }); out.parts.push({ r: [H[2] - nw, H[1] + nd, H[2], H[3]], f0: 0, f1: fl, acc: true }); out.notch = [H[2] - nw, H[1], H[2], H[1] + nd]; out.maxr = [[H[0], H[1], H[2] - nw, H[3]], [H[0], H[1] + nd, H[2], H[3]]]; }
  } else if (mt === 'ext' && fl >= 2) {
    // 下屋：家の 横か うしろに 1階だけ（区画の あまりに 入るときだけ）
    const room = [W - H[2] - 0.6, H[0] - 0.6, D - H[3] - 0.6];   // 右・左・奥 の あき
    const k = room[0] >= 1.8 && (out.side === 0 || !out.park) ? 0 : room[1] >= 1.8 && (out.side === 1 || !out.park) ? 1 : room[2] >= 1.8 ? 2 : -1;
    out.parts.push({ r: H, f0: 0, f1: fl });
    if (k >= 0) { const dep = sn(Math.min(room[k], 1.82 + 1.36 * R())), len = k === 2 ? sn(clamp(hw * (0.45 + 0.4 * R()), 2.73, hw)) : sn(clamp(hd * (0.5 + 0.45 * R()), 2.73, hd));
      let w;
      if (k === 0) w = [H[2], H[3] - len, H[2] + dep, H[3]]; else if (k === 1) w = [H[0] - dep, H[3] - len, H[0], H[3]]; else { const a = R() < 0.5 ? H[0] : H[2] - len; w = [a, H[3], a + len, H[3] + dep]; }
      out.parts.push({ r: w, f0: 0, f1: 1, wing: true }); }
  } else out.parts.push({ r: H, f0: 0, f1: fl });
  return out;
}
// 下屋の屋根の向き：w が m の どちらがわか → 高いがわ
function shedDir(w, m) { if (Math.abs(w[3] - m[1]) < 0.05) return { ax: 'x', hi: '+' }; if (Math.abs(w[1] - m[3]) < 0.05) return { ax: 'x', hi: '-' }; if (Math.abs(w[2] - m[0]) < 0.05) return { ax: 'z', hi: '+' }; return { ax: 'z', hi: '-' }; }
// 陸屋根：屋上のふた・パラペット（形 F）
function flatTop(B, F, y, ph, wm, wc, lod, cap) {
  B.cap(RMAT.flat.k, F, y + 0.05, [0.82, 0.82, 0.8], { su: RMAT.flat.su });
  if (lod >= 1) { const I = A.inset(F, 0.18); for (const e of I.edges) B.wall('c', e.bx, e.bz, e.ax, e.az, y, y + ph, mul(col(wc), 0.82));
    if (lod >= 2) for (let k = 0; k < F.loops.length; k++) { const a = F.loops[k], b = I.loops[k]; if (!b) continue; for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; B.quad('c', [a[i][0], y + ph + 0.03, a[i][1]], [b[i][0], y + ph + 0.03, b[i][1]], [b[j][0], y + ph + 0.03, b[j][1]], [a[j][0], y + ph + 0.03, a[j][1]], [0, 1, 0], cap || [0.62, 0.63, 0.64]); } } }
}
// 屋根の上に 太陽光パネル（長方形 r・屋根 o）
function solarOn(B, r, o) {
  const { t, p, oh } = o, y = o.y, w = r[2] - r[0], d = r[3] - r[1], alongX = o.ax ? o.ax === 'x' : w >= d;
  const S = alongX ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];
  const x0 = alongX ? r[0] : r[1], x1 = alongX ? r[2] : r[3], z0 = alongX ? r[1] : r[0], z1 = alongX ? r[3] : r[2];
  const zm = (z0 + z1) / 2, yr = y + (z1 - z0) / 2 * p, su = 4, sv = 3.3;
  // 南（日あたり）の面：alongX なら z の大きいがわ。そうでなければ x の大きいがわ（東）に しておく
  const quadS = (ua, ub, za, zb, ya, yb2) => B.quad(SOLAR, S(ua, ya + 0.07, za), S(ub, ya + 0.07, za), S(ub, yb2 + 0.07, zb), S(ua, yb2 + 0.07, zb), null, WH, [0, 0, (ub - ua) / su, Math.abs(zb - za) / sv]);
  if (t === 'gable' || t === 'hip') {
    const zA = zm + 0.35, zB = z1 + oh * 0.3, yA = yr - (zA - zm) * p, yB = yr - (zB - zm) * p;
    const ua = x0 + Math.max(0.3, t === 'hip' ? (z1 + oh - zA) + 0.2 - oh : 0.3), ub = x1 - (ua - x0);
    if (ub - ua > 1.2) quadS(ua, ub, zB, zA, yB, yA);
  } else if (t === 'shed') {
    const hiPlus = (o.hi || '+') === '+', yl = y, yh = y + (z1 - z0) * p, zl = hiPlus ? z0 : z1, zh = hiPlus ? z1 : z0;
    const za = zl + (zh - zl) * 0.06, zb = zl + (zh - zl) * 0.92, ya = yl + (yh - yl) * 0.06, yb2 = yl + (yh - yl) * 0.92;
    quadS(x0 + 0.3, x1 - 0.3, za, zb, ya, yb2);
  }
}
// 生け垣（辺 e の内がわ s0〜s1・高さ h・あつさ t）
function hedge(B, e, s0, s1, h, t) {
  band(B, EXT, e, s0, s1, -0.05, 0, h, EB(3), 2.5);
  const a = ept(e, s0, -0.05 - t), b = ept(e, s1, -0.05 - t), a0 = ept(e, s0, -0.05), b0 = ept(e, s1, -0.05);
  B.wall(EXT, b[0], b[1], a[0], a[1], 0, h, WH, [0, (s1 - s0) / 2.5, EB(3)[0], EB(3)[1]]);
  B.quad('c', [a0[0], h, a0[1]], [b0[0], h, b0[1]], [b[0], h, b[1]], [a[0], h, a[1]], null, [0.3, 0.42, 0.26]);
}
// 塀の ひと続き（fen：block・blockf・slat・hedge・wood・wafu・brick）
function fence(B, e, s0, s1, fen, front, L, R) {
  if (fen === 'hedge') hedge(B, e, s0, s1, front ? 0.9 : 1.25, 0.5);
  else if (fen === 'slat') band(B, EXT, e, s0, s1, -0.06, 0, front ? 1.1 : 1.7, EB(2), 2, col(L.fenc || '#3d3a36'));
  else if (fen === 'wood') band(B, EXT, e, s0, s1, -0.06, 0, front ? 1.4 : 1.8, EB(7), 3);
  else if (fen === 'wafu') { band(B, EXT, e, s0, s1, -0.1, 0, 1.9, EB(4), 3); const a = ept(e, s0, 0.12), b = ept(e, s1, 0.12), a2 = ept(e, s0, -0.32), b2 = ept(e, s1, -0.32);
    B.quad(RMAT.kawara.k, [a2[0], 2.1, a2[1]], [b2[0], 2.1, b2[1]], [b[0], 1.86, b[1]], [a[0], 1.86, a[1]], null, [0.52, 0.54, 0.57], [0, 0.3, (s1 - s0) / 2.4, 0]); }
  else if (fen === 'iron') { band(B, EXT, e, s0, s1, -0.08, 0, 0.5, EB(1), 1.6, [0.95, 0.8, 0.72]); band(B, RAIL, e, s0, s1, -0.08, 0.5, 1.2, RB(3), 1.2, [0.16, 0.16, 0.17]);
    for (let q = s0 + 0.2; q < s1; q += 3.6) { const c = ept(e, q, -0.25); B.box(MAT.brick.k, c[0] - 0.2, c[1] - 0.2, c[0] + 0.2, c[1] + 0.2, 0, 1.85, WH, { su: 2.4, sv: 2.4 }); } }
  else if (fen === 'wall') { const a = ept(e, s0, -0.06), b = ept(e, s1, -0.06), hh = front ? 1.6 : 2.0; B.wall(MAT.stucco.k, a[0], a[1], b[0], b[1], 0, hh, col(L.fenc || '#e9e6df'), [0, (s1 - s0) / 4, 0, hh / 4]); const a2 = ept(e, s0, -0.26), b2 = ept(e, s1, -0.26); B.quad('c', [a[0], hh, a[1]], [b[0], hh, b[1]], [b2[0], hh, b2[1]], [a2[0], hh, a2[1]], null, [0.55, 0.55, 0.56]); }
  else if (fen === 'brick') { band(B, EXT, e, s0, s1, -0.08, 0, 0.7, EB(0), 1.6, [0.95, 0.78, 0.7]); band(B, RAIL, e, s0, s1, -0.08, 0.7, 0.6, RB(3), 1.2, [0.2, 0.2, 0.21]); }
  else { const hb = front ? 0.6 : 1.0 + 0.2 * Math.floor(R() * 3); band(B, EXT, e, s0, s1, -0.07, 0, hb, EB(0), 1.6);
    if (fen === 'blockf' && !front || !front && R() < 0.3) band(B, RAIL, e, s0, s1, -0.07, hb, 0.6, RB(2), 1.2, [0.58, 0.62, 0.58]); }
}
// 屋根の向きなど（lod 0 と おなじに するため 1か所で）
function houseRoof(L, FMbb, n) {
  const t = L.rf || 'gable', o = { t, p: L.p || 0.45, oh: L.oh == null ? 0.5 : L.oh };
  if (t === 'shed') { o.ax = 'x'; o.hi = '-'; if (FMbb && FMbb[3] - FMbb[1] > (FMbb[2] - FMbb[0]) * 1.6) { o.ax = 'z'; o.hi = n[0] > 0 ? '-' : '+'; } }
  return o;
}
// 家の 組み立ての 道具：のこりの頂点の数・同じ辺か・辺の外の 細い帯・k 階を ふさぐ 長方形・L 字の 屋根の形
const hroom = C => C.cap - (C.B.nv - C.nv0);
const sameE = (a, b) => a && b && a.ax === b.ax && a.az === b.az && a.bx === b.bx && a.bz === b.bz;
const strip = (e, d) => [Math.min(e.ax, e.bx) + e.nx * d - 0.02, Math.min(e.az, e.bz) + e.nz * d - 0.02, Math.max(e.ax, e.bx) + e.nx * d + 0.02, Math.max(e.az, e.bz) + e.nz * d + 0.02];
const occK = (parts, k) => { const o = []; for (const p of parts) if (p.f0 <= k && p.f1 > k) o.push(p.r); return o; };
const lFM = (lay, fr) => { const mr = lay.maxr.map(r => fr.rect(r[0], r[1], r[2], r[3])); return { maxr: mr, bb: fr.rect(lay.house[0], lay.house[1], lay.house[2], lay.house[3]), rects: mr }; };
// 家：遠く（lod 0）。いちばん大きな部分の 箱と屋根だけ（配置は 近くと同じ。部分の かたちは 作らない）
function houseLod0(B, L, P, lay, fr, fl, H, fh, flat, rm, rc, n) {
  let r = null, ra = -1, bb = null;
  for (const p of lay.parts) { if (p.f1 !== fl) continue; const q = fr.rect(p.r[0], p.r[1], p.r[2], p.r[3]);
    if (!p.soffit) { const a = (q[2] - q[0]) * (q[3] - q[1]); if (!r || a > ra) { r = q; ra = a; } }
    bb = bb ? [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[2]), Math.max(bb[3], q[3])] : q; }
  const yb = P.yb < -0.5 ? P.yb : 0, Hw = H + (flat ? 0.5 : 0), v0 = (yb - HB) / fh / 2, v1 = (Hw - HB) / fh / 2, w = r[2] - r[0], d = r[3] - r[1], uw = Math.max(1, Math.round(w / 4.2)) / 2, ud = Math.max(1, Math.round(d / 4.2)) / 2;
  const fwc = farWall(L);
  wall2(B, FAR1, r[0], r[1], r[2], r[1], yb, Hw, fwc, 0, uw, v0, v1, 0.85); wall2(B, FAR1, r[2], r[1], r[2], r[3], yb, Hw, fwc, 0, ud, v0, v1, 0.85);
  wall2(B, FAR1, r[2], r[3], r[0], r[3], yb, Hw, fwc, 0, uw, v0, v1, 0.85); wall2(B, FAR1, r[0], r[3], r[0], r[1], yb, Hw, fwc, 0, ud, v0, v1, 0.85);
  if (flat) B.flat('c', r, Hw - 0.1, [0.72, 0.72, 0.7]);
  else { const RO = houseRoof(L, bb, n); B.roof({ t: RO.t, p: RO.p, oh: RO.oh, ax: RO.ax, hi: RO.hi, r, y: H, th: 0, m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: 'c', cg: farGable(L) }); }
}
// 家：地面・基礎・壁・屋根・車庫・プール・下屋（lod 1・2）
function houseShell(C) {
  const { B, L, P, O, R, lod, fl, n, fr, lay, parts, fh, H, flat, rm, rc, mainP, wm, wc, wm2, wc2, am, ac, frI, deckW } = C, lot = C.F0, yOf = k => HB + k * fh;
  const notchW = lay.notch ? fr.rect(lay.notch[0], lay.notch[1], lay.notch[2], lay.notch[3]) : null;
  for (const p of parts) p.es = redges(p.r);
  // 屋根の形：1つの長方形・L字（配置の いちばん大きな長方形）は そのまま、ほかは footR
  const FM = mainP.length === 1 ? rectF(mainP[0].r) : lay.maxr && !flat ? lFM(lay, fr) : footR(mainP.map(p => p.r));
  const RO = houseRoof(L, FM && FM.bb, n);
  // --- 区画の地面（砂利・芝）と 擁壁（坂のとき）
  const gk = L.gd || 'gravel';
  B.cap(GND[gk], lot, 0.03, WH, { su: GSU[gk] });
  if (P.yb < -0.45) { const vb = EB(6); for (const e of lot.edges) B.wallE(EXT, e, P.yb, 0.03, WH, { off: -0.05, uv: [0, e.L / 3, vb[0], vb[0] + (vb[1] - vb[0]) * Math.min(1, (0.03 - P.yb) / 1.6)] }); }
  const parkW = lay.park ? fr.rect(lay.park[0], lay.park[1], lay.park[2], lay.park[3]) : null;
  if (parkW && !L.garage) B.flat(GND.conc, parkW, 0.07, WH, { su: GSU.conc });
  // --- 基礎
  const plin = lod >= 2 || P.yb < -0.5;
  if (plin) for (const p of parts) if (p.f0 === 0) for (const e of p.es) wall2(B, 'c', e.ax, e.az, e.bx, e.bz, P.yb, HB + 0.005, PLC, 0, 0, 0, 0, 0.85);
  // --- 壁（部分ごと。2色の家は 1階と 2階で 材料を かえる）
  for (const p of parts) {
    const y0 = p.f0 === 0 && !plin ? 0 : yOf(p.f0), y1 = p.wing ? (deckW ? yOf(1) : yOf(1) - 0.35) : yOf(p.f1);
    const mA = p.acc ? am : wm, cA = p.acc ? ac : wc, mB = p.acc ? am : wm2, cB = p.acc ? ac : wc2;
    for (const e of p.es) {
      if (p.f0 >= 1) wall2(B, mB.k, e.ax, e.az, e.bx, e.bz, y0, y1, cB, 0, e.L / mB.su, y0 / mB.sv, y1 / mB.sv);
      else if ((mB === mA && cB === cA) || p.f1 <= 1 || p.wing) wall2(B, mA.k, e.ax, e.az, e.bx, e.bz, y0, y1, cA, 0, e.L / mA.su, y0 / mA.sv, y1 / mA.sv, 0.85);
      else { const ym = yOf(1); wall2(B, mA.k, e.ax, e.az, e.bx, e.bz, y0, ym, cA, 0, e.L / mA.su, y0 / mA.sv, ym / mA.sv, 0.85); wall2(B, mB.k, e.ax, e.az, e.bx, e.bz, ym, y1, cB, 0, e.L / mB.su, ym / mB.sv, y1 / mB.sv); }
    }
    if (p.soffit) B.flat('c', p.r, yOf(1), [0.62, 0.62, 0.6], { down: true });
  }
  if (lod >= 2 && L.w2 && fl >= 2) for (const p of parts) if (p.f0 === 0 && p.f1 >= 2 && !p.acc) for (const e of redges(p.r)) { const a = ept(e, 0, 0.04), b = ept(e, e.L, 0.04); B.wall('c', a[0], a[1], b[0], b[1], yOf(1) - 0.08, yOf(1) + 0.06, mul(col(wc2), 0.82)); }
  // --- 屋根
  const ph = 0.55, cf = L.fc || mul(col(rc), 0.8);
  let ro = null;
  if (flat) { if (FM) { for (const e of FM.edges) B.wallE(wm2.k, e, H, H + ph, wc2, { uv: [e.u0 / wm2.su, (e.u0 + e.L) / wm2.su, H / wm2.sv, (H + ph) / wm2.sv] }); flatTop(B, FM, H, ph, wm2, wc2, lod, L.fc ? col(L.fc) : null);
    if (L.green) for (const r of FM.rects) B.flat(GND.lawn, A.rin(r, 0.35), H + 0.12, WH, { su: 4 });
    if (L.solar) for (const r of FM.rects) { const w = r[2] - r[0], d = r[3] - r[1]; if (w < 3 || d < 3) continue; const nr = Math.max(1, Math.floor((d - 1) / 1.9));
      for (let i = 0; i < nr; i++) { const z0 = r[1] + 0.6 + i * 1.9, x0 = r[0] + 0.5, x1 = r[2] - 0.5; B.quad(SOLAR, [x0, H + 0.25, z0 + 1.3], [x1, H + 0.25, z0 + 1.3], [x1, H + 0.75, z0], [x0, H + 0.75, z0], null, WH, [0, 0, (x1 - x0) / 4, 0.4]); } } } }
  else if (FM) {
    ro = Object.assign({}, RO, { y: H, th: lod >= 2 ? 0.16 : 0, m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: wm2.k, cg: wc2, gsu: wm2.su, gsv: wm2.sv, cf, cr: mul(roofAvg(L.rm, rc), 0.88) });
    if (ro.t === 'shed' && FM.maxr.length > 1) ro.t = 'gable';
    roofs(B, FM, ro);
    if (L.solar) for (const r of FM.maxr) solarOn(B, r, ro);
  }
  // 煙突（洋館）・塔（とんがり屋根）
  if (L.chim && FM && !flat) { const r = FM.maxr[0], ax = r[2] - r[0] >= r[3] - r[1], t = R() < 0.5 ? 0.22 : 0.78, cx = ax ? r[0] + (r[2] - r[0]) * t : (r[0] + r[2]) / 2 + 0.7, cz = ax ? (r[1] + r[3]) / 2 + 0.7 : r[1] + (r[3] - r[1]) * t, top = H + Math.min(r[2] - r[0], r[3] - r[1]) / 2 * (L.p || 0.45) + 0.9;
    B.box(MAT.brick.k, cx - 0.4, cz - 0.4, cx + 0.4, cz + 0.4, H - 0.5, top, WH, { su: 2.4, sv: 2.4 }); B.box('c', cx - 0.48, cz - 0.48, cx + 0.48, cz + 0.48, top, top + 0.15, [0.45, 0.42, 0.4]); }
  if (L.tur && mainP[0]) { const r = mainP[0].r, fc2 = fr.P(...(lay.side ? [lay.house[0], lay.house[1]] : [lay.house[2], lay.house[1]])), cx = clamp(fc2[0], r[0], r[2]), cz = clamp(fc2[1], r[1], r[3]), rr = 1.7, y2 = H + 1.0;
    B.cyl(wm2.k, cx, cz, rr, lod >= 2 ? HB : 0, y2, 8, wc2, { su: wm2.su, sv: wm2.sv, notop: true }); B.cone(rm.k, cx, cz, rr + 0.25, y2, y2 + 3.6, 8, rc);
    if (lod >= 2) for (let k = 0; k < fl; k++) { const a = fr.dv, ex = { ax: cx - a[1] * 0.5 - a[0] * rr, az: cz + a[0] * 0.5 - a[1] * rr, bx: cx + a[1] * 0.5 - a[0] * rr, bz: cz - a[0] * 0.5 - a[1] * rr, nx: -a[0], nz: -a[1], L: 1 }; panel(B, WIN, ex, 0.5, 0.75, yOf(k) + 0.8, yOf(k) + 2.2, wuv(0, 8), 0.05); } }
  // 車庫の棟（シャッター 付き。中に車）
  if (L.garage && parkW) { const g = A.rin(parkW, 0.05), gh = 2.9, ge = redges(g).find(e => e.nx * n[0] + e.nz * n[1] > 0.5);
    for (const e of redges(g)) B.wall(e === ge ? WIN : wm.k, e.ax, e.az, e.bx, e.bz, 0, gh, e === ge ? col(L.fenc || '#55585c') : col(wc), e === ge ? null : [0, e.L / wm.su, 0, gh / wm.sv], 0.85);
    if (ge) { const sw = Math.min(ge.L - 0.6, 2.6 * lay.cars), ny = Math.max(1, lay.cars); for (let i = 0; i < ny; i++) { const s0 = ge.L / 2 - sw / 2 + i * sw / ny; panel(B, WIN, ge, s0 + sw / ny / 2, sw / ny - 0.2, 0.05, 2.25, wuv(2, 6), 0.06, col(L.fenc || '#55585c')); } }
    B.cap(RMAT.flat.k, footR([g]), gh, [0.75, 0.75, 0.73], { su: 6 }); }
  // プール（芝の 庭に）
  if (L.pool || O.pool) { const H0 = lay.house, Wd = fr.W, Dd = fr.D, cand = [[0.6, 0.6, H0[0] - 0.8, Dd - 0.6], [H0[2] + 0.8, 0.6, Wd - 0.6, Dd - 0.6], [0.6, H0[3] + 0.8, Wd - 0.6, Dd - 0.6], [0.6, 0.6, Wd - 0.6, H0[1] - 0.8]].filter(r => r[2] - r[0] > 4 && r[3] - r[1] > 3 && !(lay.park && hitR(r, lay.park, 0)));
    const pr = cand.sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
    if (pr) { const w = Math.min(pr[2] - pr[0], 10), d = Math.min(pr[3] - pr[1], 5), r = fr.rect(pr[0] + (pr[2] - pr[0] - w) / 2, pr[1] + (pr[3] - pr[1] - d) / 2, pr[0] + (pr[2] - pr[0] + w) / 2, pr[1] + (pr[3] - pr[1] + d) / 2);
      B.flat('c', A.rin(r, -0.9), 0.06, [0.78, 0.74, 0.66]); B.flat('c', r, 0.1, [0.32, 0.62, 0.72]); if (lod >= 2) for (const e of redges(r)) B.wall('c', e.ax, e.az, e.bx, e.bz, 0.1, 0.16, [0.9, 0.9, 0.88]); } }
  for (const p of parts) if (p.wing) {
    const m = mainP.find(q => hitR(q.r, p.r, 0.06)) || mainP[0], d = shedDir(p.r, m.r), yw = yOf(1) - 0.35, dep = d.ax === 'x' ? p.r[3] - p.r[1] : p.r[2] - p.r[0];
    if (deckW) { const F = footR([p.r]); B.cap(RMAT.flat.k, F, yOf(1) + 0.02, WH, { su: 6 }); p.deck = true;
      for (const e of F.edges) { const fs = freeOn(e, mainP.map(q => q.r)); for (const s of fs) band(B, flat ? GLS : RAIL, e, s[0], s[1], -0.05, yOf(1), 1.0, flat ? [0.52, 0.98] : RB(0), flat ? 2 : 1.6, flat ? WH : col(FRC[frI])); } }
    else roof1(B, { t: 'shed', r: p.r, y: yw, p: Math.min(0.42, 1.0 / Math.max(1, dep)), oh: 0.35, ax: d.ax, hi: d.hi, th: lod >= 2 ? 0.12 : 0, m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: am.k, cg: ac, gsu: am.su, gsv: am.sv, cf, cr: mul(roofAvg(L.rm, rc), 0.88) });
  }
  C.notchW = notchW; C.FM = FM; C.gk = gk; C.parkW = parkW; C.plin = plin; C.cf = cf; C.ro = ro;
}
// 家：玄関と 2階のベランダ（lod 1・2）
function houseOpen(C) {
  const { B, L, O, R, lod, fl, n, lay, parts, fh, wst, frI, am, ac, notchW } = C, yOf = k => HB + k * fh;
  // --- 玄関（1階の 道がわの辺）
  let door = null;
  { let best = null, bs = -9; const o0 = occK(parts, 0);
    for (const p of parts) { if (p.f0 !== 0) continue; for (const e of p.es) { const d = e.nx * n[0] + e.nz * n[1]; if (d < 0.5) continue;
      for (const s of freeOn(e, o0, p.r)) { if (s[1] - s[0] < 1.8) continue; const sc = d * 2 + (notchW && hitR(notchW, strip(e, 0.2), 0) ? 1.5 : 0) + (p.wing ? -1 : 0) + R() * 0.5; if (sc > bs) { bs = sc; best = { e, s, p }; } } } }
    if (best) { const { e, s } = best, dw = O.two ? 1.0 : 1.25, pos = lay.side ? s[0] + 0.55 + dw / 2 : s[1] - 0.55 - dw / 2;
      door = { e, s: clamp(pos, s[0] + dw / 2 + 0.1, s[1] - dw / 2 - 0.1), w: dw };
      if (O.two && s[1] - s[0] > 4.6) door.s2 = lay.side ? s[1] - 0.55 - dw / 2 : s[0] + 0.55 + dw / 2; } }
  // --- 2階のベランダ（日あたりの面）
  const balT = fl >= 2 ? (L.bal || 'alu') : 'none';
  let bal = null;
  if (balT !== 'none' && hroom(C) > 70) { let bs = -9; const o1 = occK(parts, 1);
    for (const p of parts) { if (p.f1 < 2 || p.f0 > 1 || p.wing) continue; for (const e of p.es) {
      const segs = freeOn(e, o1, p.r).filter(s => s[1] - s[0] > 2.6); if (!segs.length) continue;
      if (parts.some(q => (q.wing || q.f1 === 1) && hitR(q.r, strip(e, 0.5), 0))) continue;
      const sc = e.nz * 2 + (e.nx * n[0] + e.nz * n[1]) * 0.8 + R() * 0.6; if (sc > bs) { bs = sc; const s = segs.reduce((a, q) => q[1] - q[0] > a[1] - a[0] ? q : a), len = Math.min(s[1] - s[0] - 0.3, clamp(e.L * (0.45 + 0.4 * R()), 2.7, 5.5)), s0 = s[0] + 0.15 + (s[1] - s[0] - 0.3 - len) * R(); bal = { e, s0, s1: s0 + len }; } } } }
  // ドア
  if (door) { const { e, w } = door, dt = L.dr == null ? 0 : L.dr, cc = L.fc ? col(L.fc) : [0.35, 0.35, 0.36];
    for (const ss of [door.s, door.s2]) { if (ss == null) continue;
      panel(B, WIN, e, ss, w, HB + 0.02, HB + 2.3, dt < 8 ? wuv(dt, 5) : wuv(dt - 4, 6), 0.08);
      const a = ept(e, ss - 0.85), b = ept(e, ss + 0.85), dp = 0.85, yC = HB + 2.55;
      B.quad('c', [a[0] + e.nx * dp, yC, a[1] + e.nz * dp], [b[0] + e.nx * dp, yC, b[1] + e.nz * dp], [b[0], yC + 0.1, b[1]], [a[0], yC + 0.1, a[1]], null, cc);
      if (lod >= 2) { B.wall('c', a[0] + e.nx * dp, a[1] + e.nz * dp, b[0] + e.nx * dp, b[1] + e.nz * dp, yC - 0.08, yC, cc);
        const pa = ept(e, ss - 0.95, 1.1), pb = ept(e, ss + 0.95, 1.1), pa0 = ept(e, ss - 0.95), pb0 = ept(e, ss + 0.95), yp = HB - 0.12, pc = [0.78, 0.76, 0.72];
        B.quad('c', [pb[0], yp, pb[1]], [pa[0], yp, pa[1]], [pa0[0], yp, pa0[1]], [pb0[0], yp, pb0[1]], null, pc);
        B.wall('c', pa[0], pa[1], pb[0], pb[1], 0, yp, mul(pc, 0.92)); B.wall('c', pa0[0], pa0[1], pa[0], pa[1], 0, yp, mul(pc, 0.92)); B.wall('c', pb[0], pb[1], pb0[0], pb0[1], 0, yp, mul(pc, 0.92)); } } }
  // ベランダ
  if (bal) { const { e, s0, s1 } = bal, len = s1 - s0, dep = balT === 'alu' ? 0.9 + 0.25 * R() : 1.0, yF = yOf(1), rc0 = col(FRC[frI]);
    bal.dep = dep;
    if (lod >= 2) slab(B, e, s0, s1, dep, yF - 0.18, yF, 'c', BALC, 1, 1, false);
    else { const a = ept(e, s0), b = ept(e, s1), a2 = ept(e, s0, dep), b2 = ept(e, s1, dep); B.quad('c', [a2[0], yF, a2[1]], [b2[0], yF, b2[1]], [b[0], yF, b[1]], [a[0], yF, a[1]], null, [0.74, 0.74, 0.72]); if (balT !== 'solid') B.wall('c', a2[0], a2[1], b2[0], b2[1], yF - 0.18, yF, [0.72, 0.72, 0.7]); }
    if (balT === 'solid') { const yT = yF + 1.1, a = ept(e, s0), b = ept(e, s1), a2 = ept(e, s0, dep), b2 = ept(e, s1, dep), U = l2 => [0, l2 / am.su, yF / am.sv, yT / am.sv];
      B.wall(am.k, a2[0], a2[1], b2[0], b2[1], yF - 0.18, yT, ac, U(len)); B.wall(am.k, a[0], a[1], a2[0], a2[1], yF - 0.18, yT, ac, U(dep)); B.wall(am.k, b2[0], b2[1], b[0], b[1], yF - 0.18, yT, ac, U(dep));
      if (lod >= 2) { const cc = [0.55, 0.56, 0.57], tq = (p0, p1) => { const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l2 = Math.hypot(dx, dz) || 1, ox = -dz / l2 * 0.06, oz = dx / l2 * 0.06; wq(B, 'c', p0[0] - ox, yT + 0.03, p0[1] - oz, p1[0] - ox, yT + 0.03, p1[1] - oz, p1[0] + ox, yT + 0.03, p1[1] + oz, p0[0] + ox, yT + 0.03, p0[1] + oz, 0, 1, 0, cc, 0, 0, 0, 0, 1, 1); }; tq(a, a2); tq(a2, b2); tq(b2, b); } }
    else { const gl = balT === 'glass', m = gl ? GLS : RAIL, vb = gl ? [0.52, 0.98] : RB(0), c = gl ? WH : rc0;
      band(B, m, e, s0, s1, dep, yF, 1.05, vb, gl ? 2 : 1.6, c);
      if (lod >= 2) { bandP(B, m, ept(e, s0), ept(e, s0, dep), yF, 1.05, vb, gl ? 2 : 1.6, c); bandP(B, m, ept(e, s1, dep), ept(e, s1), yF, 1.05, vb, gl ? 2 : 1.6, c); bal.posts = !gl && R() < 0.5; } }
    bal.ws = (s0 + s1) / 2; bal.ww = Math.min(1.69, len - 0.6);
    panel(B, WIN, e, bal.ws, bal.ww, yF + 0.02, yF + (wst === 'yo' ? 2.3 : 2.0), winUV('K', frI, R, wst), 0.06);
  }
  C.door = door; C.bal = bal; C.balT = balT;
}
// 家：窓（lod 1 は 大きい窓・道と南の面から。lod 2 は ぜんぶ）
function houseWins(C) {
  const { B, L, R, lod, n, parts, fh, wst, WTX, frI, deckW, door, bal } = C, yOf = k => HB + k * fh;
  // --- 窓
  const shP = L.sh || 0, wrs = [], wb = WBK, gap = wst === 'yo' ? 0.8 : 0.55;
  for (const bk of wb) bk.length = 0; WIN_N = 0;
  for (const p of parts) {
    for (let k = p.f0; k < (p.wing ? 1 : p.f1); k++) {
      const others = [], below = [];
      for (const q of parts) { if (q === p) continue; if (q.f0 <= k && q.f1 > k) others.push(q.r); if (k > 0 && q.f1 === k && !q.deck) below.push(q.r); }
      for (const e of p.es) {
        let segs = freeOn(e, others); if (!segs.length) continue;
        if (k === 0 && door && sameE(door.e, e)) { segs = cutS(segs, door.s - door.w / 2 - 0.35, door.s + door.w / 2 + 0.35); if (door.s2 != null) segs = cutS(segs, door.s2 - door.w / 2 - 0.35, door.s2 + door.w / 2 + 0.35); }
        if (k === 1 && bal && sameE(bal.e, e)) segs = cutS(segs, bal.ws - bal.ww / 2 - 0.4, bal.ws + bal.ww / 2 + 0.4);
        const role = roleOf(e, n);
        let list = p.wing ? (role === 'S' ? WLW[0] : WLW[1]) : winList(role, k, R, false);
        if (below.some(q => hitR(q, strip(e, 0.3), 0))) list = list.map(t => t === 'K' || t === 'K2' ? 'H' : t);
        const yF = yOf(k), yTop = p.wing ? (deckW ? yOf(1) - 0.2 : yOf(1) - 0.55) : yOf(k + 1) - 0.25;
        const rp = role === 'S' || role === 'F' ? 0 : 1;
        fitWinsH(segs, list, gap, R, WTX, e, yF, yTop, rp, wb);
        if (k === 0) wrs.push({ e, p, role });
      }
    }
  }
  for (let bi = 0; bi < (lod >= 2 ? 6 : 4); bi++) for (const id of wb[bi]) {
    if (hroom(C) < 18) break;
    const e = WIN_E[id], wt = WIN_T[id], ws = WIN_F[id * 4], ww = WIN_F[id * 4 + 1], y0 = WIN_F[id * 4 + 2], y1 = WIN_F[id * 4 + 3];
    const closed = (wt === 'K' || wt === 'H') && shP && R() < shP * 0.22;
    panel(B, WIN, e, ws, ww, y0, y1, closed ? (wst === 'wa' ? wuv(3, 7) : wuv(1, 6)) : winUV(wt, frI, R, wst), 0.08, closed && wst !== 'wa' ? col(FRC[frI]) : WH);
    if (wst === 'yo' && lod >= 2 && wt !== 'K') { const a = ept(e, ws - ww / 2 - 0.08), b = ept(e, ws + ww / 2 + 0.08); B.wall('c', a[0] + e.nx * 0.12, a[1] + e.nz * 0.12, b[0] + e.nx * 0.12, b[1] + e.nz * 0.12, y0 - 0.12, y0, [0.93, 0.92, 0.88]); B.wall('c', a[0] + e.nx * 0.1, a[1] + e.nz * 0.1, b[0] + e.nx * 0.1, b[1] + e.nz * 0.1, y1, y1 + 0.16, [0.93, 0.92, 0.88]); }
    else if (lod >= 2 && shP && (wt === 'K' || wt === 'H') && R() < shP) panel(B, WIN, e, ws, ww + 0.12, y1, y1 + 0.24, wuv(0, 6), 0.14, col(FRC[frI]));
    else if (lod >= 2 && (wt === 'S' || wt === 'H2') && R() < 0.35) { const a = ept(e, ws - ww / 2 - 0.1), b = ept(e, ws + ww / 2 + 0.1), yy = y1 + 0.18; B.quad('c', [a[0] + e.nx * 0.38, yy - 0.07, a[1] + e.nz * 0.38], [b[0] + e.nx * 0.38, yy - 0.07, b[1] + e.nz * 0.38], [b[0], yy, b[1]], [a[0], yy, a[1]], null, L.fc ? col(L.fc) : [0.4, 0.4, 0.42]); }
  }
  C.wrs = wrs;
}
// 家：近くの 小物（lod 2）。だいじなものから、のこりの頂点の数で
function houseProps(C) {
  const { B, L, R, n, fr, lay, parts, F0, H, flat, FM, ro, mainP, parkW, door, bal, wrs, gk, frI, tilt, fe, fh } = C, lot = F0, yOf = k => HB + k * fh, room = () => hroom(C);
  const todo = [], add = (pr, cost, f) => { (todo[pr] || (todo[pr] = [])).push(cost, f); };
  const fe2 = fe, gcol = col(L.gc || '#4a4a48');
  if (parkW && lay.cars > 0 && !L.garage) { const ang = angOf(fr.dv), cx = (parkW[0] + parkW[2]) / 2, cz = (parkW[1] + parkW[3]) / 2, ax = Math.abs(fr.dv[0]) > 0.5, nC = lay.cars, sp = (ax ? parkW[3] - parkW[1] : parkW[2] - parkW[0]) / nC;
    for (let i = 0; i < nC; i++) { if (R() < 0.15) continue; const o = -((nC - 1) / 2 - i) * sp, rv = R() < 0.5 ? 0 : Math.PI; add(1 + i * 4, 90, () => car(B, ax ? cx : cx + o, ax ? cz + o : cz, ang + rv, R)); }
    if (L.cport || R() < 0.3) add(9, 32, () => { const pr = A.rin(parkW, -0.1), y = 2.35, k = [0.42, 0.4, 0.37];
      B.quad(GLS, [pr[0], y, pr[3]], [pr[2], y, pr[3]], [pr[2], y + 0.1, pr[1]], [pr[0], y + 0.1, pr[1]], [0, 1, 0], WH, [0, 0.02, 2, 0.48]);
      const b0 = fr.P(lay.park[0] + 0.1, lay.park[3] - 0.15), b1 = fr.P(lay.park[2] - 0.1, lay.park[3] - 0.15);
      post(B, b0[0], b0[1], 0.07, y + 0.05, 0.05, k); post(B, b1[0], b1[1], 0.07, y + 0.05, 0.05, k); bandP(B, 'c', b0, b1, y - 0.1, 0.12, [0, 0], 1, k); }); }
  else if (lay.gar && R() < 0.8) { const g = fr.rect(...lay.gar), t = R() < 0.5 ? 0 : 1; add(1, 90, () => car(B, (g[0] + g[2]) / 2, (g[1] + g[3]) / 2, angOf(fr.dv), R, t)); }
  // 塀（区画のまわり。道がわは 駐車場と 門をあける）
  const gate = door ? (() => { const c = ept(door.e, door.s, 1.1); let q = proj(fe2, c[0], c[1]);
    if (parkW) { const a = proj(fe2, parkW[0], parkW[1]), b = proj(fe2, parkW[2], parkW[3]), p0 = Math.min(a, b), p1 = Math.max(a, b), gw = L.gate ? 1.75 : 1.0;   // 門は 駐車場に かからないように
      if (q + gw > p0 && q - gw < p1) q = (q - p0 < p1 - q && p0 - gw > 0.6) || p1 + gw > fe2.L - 0.6 ? p0 - gw : p1 + gw; }
    return { c, q }; })() : null;
  if (!tilt) add(2, 50, () => { const fen = L.fen || 'block';
    for (const e of lot.edges) { if (room() < 12) break;
      const front = e.nx * n[0] + e.nz * n[1] > 0.5; let segs = [[0.05, e.L - 0.05]];
      if (front) { for (const g of [parkW, lay.gar ? fr.rect(...lay.gar) : null]) if (g) { const a = proj(e, g[0], g[1]), b = proj(e, g[2], g[3]); segs = cutS(segs, Math.min(a, b) - 0.15, Math.max(a, b) + 0.15); }
        if (gate && sameE(e, fe2)) { const gw = L.gate ? 1.45 : 0.8, qa = L.gate ? clamp(gate.q, L.gate === 'wa' ? 1.6 : 1.4, fe2.L - 1.6) : gate.q; segs = cutS(segs, qa - gw, qa + gw); } }
      for (const s of segs) if (s[1] - s[0] > 0.4) fence(B, e, s[0], s[1], fen, front, L, R); } });
  // 玄関までの アプローチ・門柱・自転車
  if (gate) add(4, L.gate === 'wa' ? 150 : L.gate === 'yo' ? 90 : 42, () => { const { c, q } = gate, g0 = ept(fe2, clamp(q, 0.6, fe2.L - 0.6)), w2 = 0.6, hz = Math.abs(fe2.nz) > 0.5;
    const pr = [Math.min(c[0], g0[0]) - (hz ? w2 : 0), Math.min(c[1], g0[1]) - (hz ? 0 : w2), Math.max(c[0], g0[0]) + (hz ? w2 : 0), Math.max(c[1], g0[1]) + (hz ? 0 : w2)];
    if (!parkW || !hitR(pr, parkW, -0.2)) B.flat(GND.tile, pr, 0.06, WH, { su: GSU.tile });
    if (L.gate === 'wa') { const qa = clamp(q, 1.6, fe2.L - 1.6), k = [0.28, 0.22, 0.18];
      for (const dq of [-1.25, 1.25]) { const c2 = ept(fe2, qa + dq, -0.3); B.box('c', c2[0] - 0.13, c2[1] - 0.13, c2[0] + 0.13, c2[1] + 0.13, 0, 2.45, k); }
      const a = ept(fe2, qa - 1.45, 0.25), b = ept(fe2, qa + 1.45, -0.85); roof1(B, { t: 'gable', r: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], y: 2.45, p: 0.55, oh: 0.25, th: 0.1, ax: Math.abs(fe2.nz) > 0.5 ? 'x' : 'z', m: RMAT.kawara.k, c: '#8e959e', su: 2.4, sv: 2.4, mg: 'c', cg: k, cf: [0.3, 0.27, 0.24] });
      bandP(B, 'c', ept(fe2, qa - 1.4, -0.3), ept(fe2, qa + 1.4, -0.3), 2.25, 0.2, [0, 0], 1, k); return; }
    if (L.gate === 'yo') { const qa = clamp(q, 1.4, fe2.L - 1.4); for (const dq of [-1.15, 1.15]) { const c2 = ept(fe2, qa + dq, -0.3); B.box(MAT.brick.k, c2[0] - 0.28, c2[1] - 0.28, c2[0] + 0.28, c2[1] + 0.28, 0, 2.0, WH, { su: 2.4, sv: 2.4 }); B.box('c', c2[0] - 0.34, c2[1] - 0.34, c2[0] + 0.34, c2[1] + 0.34, 2.0, 2.12, [0.85, 0.84, 0.8]); }
      band(B, RAIL, fe2, qa - 0.87, qa + 0.87, -0.3, 0.05, 1.6, RB(3), 1.2, [0.16, 0.16, 0.17]); return; }
    const gp = ept(fe2, clamp(q + (lay.side ? -1.05 : 1.05), 0.3, fe2.L - 0.3), -0.25), ang = angOf([fe2.bx - fe2.ax, fe2.bz - fe2.az]);
    B.obox('c', gp[0], gp[1], ang, 0.24, 0.16, 0.05, 1.3, [0.25, 0.25, 0.26]);
    const tx = (fe2.bx - fe2.ax) / fe2.L, tz = (fe2.bz - fe2.az) / fe2.L, fx = gp[0] + fe2.nx * 0.09, fz = gp[1] + fe2.nz * 0.09;
    panel(B, WIN, { ax: fx - tx * 0.12, az: fz - tz * 0.12, bx: fx + tx * 0.12, bz: fz + tz * 0.12, nx: fe2.nx, nz: fe2.nz, L: 0.24 }, 0.12, 0.22, 0.1, 1.28, wuv(3, 9), 0); });
  if (door && R() < 0.55) { const e = door.e, bp = ept(e, door.s + (lay.side ? 1.7 : -1.7), 0.6), k = R() < 0.5 ? 0 : 0.5; add(13, 6, () => { const ex = (e.bx - e.ax) / e.L, ez = (e.bz - e.az) / e.L, vb = RB(7);
    B.quad(RAIL, [bp[0] + ex * 0.9, 0.05, bp[1] + ez * 0.9], [bp[0] - ex * 0.9, 0.05, bp[1] - ez * 0.9], [bp[0] - ex * 0.9, 1.1, bp[1] - ez * 0.9], [bp[0] + ex * 0.9, 1.1, bp[1] + ez * 0.9], [e.nx, 0, e.nz], WH, [k, vb[0], k + 0.5, vb[1]]); }); }
  // 木（庭の あいているところ）
  { const hs = parts.map(p => p.r), bb = lot.bb, nT = clamp(Math.round(Math.sqrt(F0.area) / 7), 1, 6) + (L.pine ? 1 : 0); let i = 0;
    for (let t = 0; i < nT && t < 16; t++) { const x = rnd(R, bb[0] + 0.8, bb[2] - 0.8), z = rnd(R, bb[1] + 0.8, bb[3] - 0.8);
      if (!lot.rects.some(r => inR(r, x, z, -0.7)) || hs.some(r => inR(r, x, z, 0.9)) || (parkW && inR(parkW, x, z, 0.6))) continue;
      const k = i, h = rnd(R, 2.6, 4.2), r0 = rnd(R, 0.8, 1.4), sr = R(), cc = pick(R, ['#4f7340', '#5f8448', '#3f6036', '#6d8f4e', '#567a3e']);
      add(k === 0 ? 3 : 11 + k, L.pine && k === 0 ? 60 : 45, () => { if (L.pine && k === 0) pine(B, x, z, 0.03, h * 0.85, r0 * 1.05, R); else if (sr < 0.35) shrub(B, x, z, 0.03, r0 * 0.5, '#4a6b3a'); else tree(B, x, z, 0.03, h, r0, cc, R); });
      i++; } }
  // 庭の あき（家と駐車場の外の いちばん大きい 長方形）：芝・物置・家庭菜園
  { const H0 = lay.house, pk = lay.park || [0, 0, 0, 0], W = fr.W, D = fr.D, cand = [[0, 0, H0[0] - 0.4, D], [H0[2] + 0.4, 0, W, D], [0, 0, W, H0[1] - 0.4], [0, H0[3] + 0.4, W, D]].map(r => {
      if (hitR(r, pk, 0.2)) { if (pk[3] < r[3] - 1.5 && pk[3] > r[1]) r = [r[0], pk[3] + 0.3, r[2], r[3]]; else if (pk[2] < r[2] - 1.5 && pk[2] > r[0]) r = [pk[2] + 0.3, r[1], r[2], r[3]]; else if (pk[0] > r[0] + 1.5) r = [r[0], r[1], pk[0] - 0.3, r[3]]; else r = [0, 0, 0, 0]; }
      return A.rin(r, 0.35); }).filter(r => r[2] - r[0] > 2.2 && r[3] - r[1] > 2.2);
    const gr = cand.sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
    if (gr) { const gw = fr.rect(...gr), ga = (gr[2] - gr[0]) * (gr[3] - gr[1]);
      if (gk !== 'lawn' && ga > 14 && (ga > 40 || R() < 0.5)) add(3, 6, () => B.flat(GND.lawn, gw, 0.05, WH, { su: GSU.lawn }));
      if (L.pond && ga > 20) { const pc = fr.P((gr[0] + gr[2]) / 2, (gr[1] + gr[3]) / 2), pr0 = Math.min(gr[2] - gr[0], gr[3] - gr[1]) * 0.32, rot = R() * 6;
        add(5, 110, () => { const n8 = 8, ring = [], ring2 = []; for (let i = 0; i < n8; i++) { const t = rot + i / n8 * 6.283, k = 0.75 + 0.4 * ((i * 7) % 5) / 4; ring.push([pc[0] + Math.cos(t) * pr0 * k * 1.3, pc[1] + Math.sin(t) * pr0 * k]); ring2.push([pc[0] + Math.cos(t) * (pr0 * k * 1.3 + 0.35), pc[1] + Math.sin(t) * (pr0 * k + 0.35)]); }
          for (let i = 0; i < n8; i++) { const j = (i + 1) % n8; B.tri('c', [pc[0], 0.06, pc[1]], [ring[j][0], 0.06, ring[j][1]], [ring[i][0], 0.06, ring[i][1]], [0, 1, 0], [0.24, 0.33, 0.32]); B.quad('c', [ring2[i][0], 0.08, ring2[i][1]], [ring2[j][0], 0.08, ring2[j][1]], [ring[j][0], 0.07, ring[j][1]], [ring[i][0], 0.07, ring[i][1]], null, [0.6, 0.59, 0.56]); }
          for (let i = 0; i < 3; i++) { const q = ring2[(i * 3) % n8]; shrub(B, q[0], q[1], 0.05, 0.35, '#7d7b76'); }
          const lt = ring2[5]; B.box('c', lt[0] - 0.12, lt[1] - 0.12, lt[0] + 0.12, lt[1] + 0.12, 0.05, 0.9, [0.66, 0.65, 0.62]); B.box('c', lt[0] - 0.3, lt[1] - 0.3, lt[0] + 0.3, lt[1] + 0.3, 0.9, 1.05, [0.62, 0.61, 0.58]); }); }
      if (ga > 30 && R() < 0.55) { const sw = 1.8, sd = 0.9, back = gr[3] - sd - 0.2, u0 = R() < 0.5 ? gr[0] + 0.2 : gr[2] - sw - 0.2, sr = fr.rect(u0, back, u0 + sw, back + sd), sc = pick(R, [[0.82, 0.8, 0.74], [0.7, 0.72, 0.7], [0.62, 0.66, 0.6]]);
        add(12, 36, () => { B.box('c', sr[0], sr[1], sr[2], sr[3], 0.05, 1.9, sc, { ct: mul(sc, 0.9) }); const ef = redges(sr).find(e => (e.nx * -fr.dv[0] + e.nz * -fr.dv[1]) > 0.5); if (ef) panel(B, WIN, ef, ef.L / 2, ef.L - 0.1, 0.1, 1.8, wuv(7, 10), 0.03); }); }
      if (ga > 45 && R() < 0.4) { const pw = Math.min(4, (gr[2] - gr[0]) * 0.5), pd = Math.min(2.4, (gr[3] - gr[1]) * 0.4), u0 = gr[0] + 0.3, v0 = gr[1] + 0.3;
        add(12, 30, () => { const pr = fr.rect(u0, v0, u0 + pw, v0 + pd); B.flat('c', pr, 0.08, [0.42, 0.33, 0.25]); const along = pr[2] - pr[0] > pr[3] - pr[1];
          for (let k = 0; k < 3; k++) { const t0 = (k + 0.25) / 3, t1 = (k + 0.7) / 3; const rr = along ? [pr[0] + 0.2, pr[1] + (pr[3] - pr[1]) * t0, pr[2] - 0.2, pr[1] + (pr[3] - pr[1]) * t1] : [pr[0] + (pr[2] - pr[0]) * t0, pr[1] + 0.2, pr[0] + (pr[2] - pr[0]) * t1, pr[3] - 0.2]; B.box('c', rr[0], rr[1], rr[2], rr[3], 0.08, 0.4, [0.33, 0.5, 0.27], { ct: [0.38, 0.56, 0.3] }); } }); } } }
  // 雨どい（軒先）と たてどい
  if (!flat && FM && FM.maxr.length === 1 && ro) add(5, 24, () => { const r = FM.maxr[0], oh = ro.oh, ye = H - oh * ro.p - ro.th - 0.02, alongX = ro.ax ? ro.ax === 'x' : r[2] - r[0] >= r[3] - r[1];
    const es = []; if (ro.t === 'hip' || ro.t === 'gable' || ro.t === 'shed') { if (alongX) { if (ro.t !== 'shed' || ro.hi === '+') es.push([r[2] + oh, r[1] - oh - 0.07, r[0] - oh, r[1] - oh - 0.07]); if (ro.t !== 'shed' || ro.hi === '-') es.push([r[0] - oh, r[3] + oh + 0.07, r[2] + oh, r[3] + oh + 0.07]); }
      else { if (ro.t !== 'shed' || ro.hi === '+') es.push([r[0] - oh - 0.07, r[1] - oh, r[0] - oh - 0.07, r[3] + oh]); if (ro.t !== 'shed' || ro.hi === '-') es.push([r[2] + oh + 0.07, r[3] + oh, r[2] + oh + 0.07, r[1] - oh]); } }
    for (const q of es) B.wall('c', q[0], q[1], q[2], q[3], ye - 0.12, ye, gcol); });
  if (!flat && mainP[0]) add(10, 24, () => { const mr = mainP[0].r; for (const [x, z, dx, dz] of [[mr[0], mr[1], -0.07, -0.07], [mr[2], mr[3], 0.07, 0.07]]) post(B, x + dx, z + dz, 0.1, H - 0.1, 0.045, gcol); });
  // 洗たく物・ベランダの室外機・柱
  if (bal) { const { e, s0, s1, dep } = bal, yF = yOf(1);
    if (R() < 0.6) add(6, 42, () => { const off = dep * 0.6, yp = yF + 1.55, a = ept(e, s0 + 0.25, off), b = ept(e, s1 - 0.25, off), cl = ['#f3f2ee', '#e9ecef', '#9fb3c8', '#c9c3b8', '#5a6a80', '#d9b8b8', '#efe8d0', '#7d8b74', '#3b4250'];
      B.wall('c', a[0], a[1], b[0], b[1], yp - 0.035, yp, [0.78, 0.79, 0.8]);
      let q = s0 + 0.4;
      for (let i = 0; i < 6 && q < s1 - 0.5; i++) { const w = rnd(R, 0.28, 0.62), h = rnd(R, 0.35, 0.85); if (q + w > s1 - 0.3) break; const c = ept(e, q, off), d = ept(e, q + w, off);
        B.quad('c', [d[0], yp - h, d[1]], [c[0], yp - h, c[1]], [c[0], yp - 0.03, c[1]], [d[0], yp - 0.03, d[1]], [e.nx, 0, e.nz], pick(R, cl)); q += w + rnd(R, 0.06, 0.3); } });
    if (R() < 0.5) add(8, 24, () => { const c = ept(e, s1 - 0.6, 0.3); acU(B, c[0], c[1], yF + 0.02, angOf([e.bx - e.ax, e.bz - e.az]) + Math.PI); });
    if (bal.posts) add(14, 24, () => { for (const q of [s0 + 0.1, s1 - 0.1]) { const c0 = ept(e, q, dep - 0.05); post(B, c0[0], c0[1], 0.05, yF - 0.18, 0.05, col(FRC[frI])); } }); }
  // 室外機・給湯器（横か うらの壁ぞい）
  { const side = wrs.filter(w => (w.role === 'X' || w.role === 'N') && w.e.L > 2.2);
    if (side.length) { const e = pick(R, side).e, sA = rnd(R, 0.8, e.L - 0.8); add(7, 24, () => { const c = ept(e, sA, 0.32); acU(B, c[0], c[1], 0.05, angOf([e.bx - e.ax, e.bz - e.az]) + Math.PI); });
      const e2 = pick(R, side).e, sW = rnd(R, 1.0, e2.L - 1.0), tank = L.solar || R() < 0.45;
      add(8, 30, () => { const ang = angOf([e2.bx - e2.ax, e2.bz - e2.az]); if (tank) { const c = ept(e2, sW, 0.45); B.obox('c', c[0], c[1], ang, 0.7, 0.75, 0.05, 1.85, [0.93, 0.93, 0.91]); } else { const c = ept(e2, sW, 0.15); B.obox('c', c[0], c[1], ang, 0.4, 0.22, 1.2, 1.75, [0.92, 0.92, 0.9]); } }); } }
  // テレビのアンテナ（古めの家）
  if (!flat && L.ant && FM && R() < L.ant) add(15, 18, () => { const r = FM.maxr[0], cx = (r[0] + r[2]) / 2 + (R() - 0.5) * 2, cz = (r[1] + r[3]) / 2, top = H + Math.min(r[2] - r[0], r[3] - r[1]) / 2 * (L.p || 0.45), k = [0.45, 0.45, 0.46];
    post(B, cx, cz, top - 0.3, top + 2.2, 0.03, k); B.quad('c', [cx - 0.7, top + 1.9, cz], [cx + 0.7, top + 1.9, cz], [cx + 0.7, top + 1.95, cz], [cx - 0.7, top + 1.95, cz], null, k); });
  for (const bk of todo) if (bk) for (let i = 0; i < bk.length; i += 2) if (room() >= bk[i]) bk[i + 1]();
}
// 家（戸建て・洋館・和風・邸宅・エコ住宅 など）：配置 → 遠く（lod 0）か、からだ → 玄関・ベランダ → 窓 → 小物（lod 2）
function houseBuild(B, L, P) {
  const O = P.ko || {}, R = P.rng, lod = P.lod, vb = O.vb || [58, 245, 790];
  const fl = clamp(P.f || 2, 1, O.fmax || 3), tilt = !!P.tilt;
  const F0 = P.F, fe = A.frontEdge(F0, P.front), n = [Math.round(fe.nx), Math.round(fe.nz)];
  const LR = A.rin(F0.rects.length === 1 ? F0.rects[0] : mainRect(F0, fe), 0.05), fr = frame(LR, n);   // 区画のふちは 道具がわで 少し内へ（となりと 重ならない）
  const lay = houseLayout(fr.W, fr.D, fl, O, L, R, tilt);
  const fh = O.fh || L.fh || FH, H = HB + fl * fh, flat = L.rf === 'flat', rm = RMAT[L.rm] || RMAT.slate, rc = L.rc || '#55585e';
  if (lod <= 0) { houseLod0(B, L, P, lay, fr, fl, H, fh, flat, rm, rc, n); return; }
  const parts = lay.parts.map(p => { const q = Object.assign({}, p); q.r = fr.rect(p.r[0], p.r[1], p.r[2], p.r[3]); return q; });
  const wm = MAT[L.w] || MAT.siding, wc = L.wc || '#f0eee8';
  const C = { B, L, P, O, R, lod, nv0: B.nv, cap: vb[clamp(lod, 0, 2)], fl, tilt, F0, fe, n, fr, lay, parts, fh, H, flat, rm, rc, mainP: parts.filter(p => p.f1 === fl),
    wm, wc, wm2: L.w2 ? MAT[L.w2] : wm, wc2: L.wc2 || wc, am: L.ac ? MAT[L.ac] : wm, ac: L.acc || wc, wst: L.wst, WTX: WTS[L.wst] || WT, frI: L.fr || 0, deckW: flat || L.bal === 'roof',
    notchW: null, FM: null, gk: null, parkW: null, plin: false, cf: null, ro: null, door: null, bal: null, balT: 'none', wrs: null };
  houseShell(C);
  if (hroom(C) < 40) return;
  houseOpen(C);
  houseWins(C);
  if (lod >= 2) houseProps(C);
}
const LOOK_HOUSE = [
  { n: '白い外壁・黒い屋根', w: 'siding', wc: '#f2f1ec', rf: 'gable', rm: 'slate', rc: '#3b3d42', p: 0.45, oh: 0.5, fc: '#3a3b3e', gc: '#3a3b3e', fr: 0, bal: 'alu', dr: 0, fen: 'blockf', sh: 0.5, ant: 0.2 },
  { n: 'ベージュのタイル調', w: 'tile', wc: '#e6d9c4', rf: 'hip', rm: 'kawara', rc: '#9aa1a9', p: 0.45, oh: 0.55, fc: '#5a5650', gc: '#6a5f52', fr: 1, bal: 'solid', dr: 0, fen: 'block', sh: 0.8, ant: 0.35 },
  { n: 'グレーの石目調', w: 'stone', wc: '#cfccc6', rf: 'hip', rm: 'slate', rc: '#4b4e54', p: 0.42, oh: 0.5, fc: '#3f4145', gc: '#45474a', fr: 0, bal: 'alu', dr: 2, fen: 'slat', fenc: '#4a4743', sh: 0.5 },
  { n: 'こげ茶とクリーム', w: 'tile', wc: '#7d6250', w2: 'siding', wc2: '#ede4d3', rf: 'gable', rm: 'slate', rc: '#5e4a3c', p: 0.45, oh: 0.5, fc: '#4a3a2e', gc: '#5a4636', fr: 1, bal: 'solid', ac: 'siding', acc: '#ede4d3', dr: 0, fen: 'blockf', sh: 0.6, ant: 0.15 },
  { n: '白い箱・陸屋根', w: 'stucco', wc: '#f3f2ee', rf: 'flat', fr: 2, bal: 'glass', ac: 'board', acc: '#b88f64', dr: 1, fen: 'slat', fenc: '#2f3032', fc: '#a9abad', gd: 'lawn', sh: 0 },
  { n: '黒いガルバ・片流れ', w: 'galva', wc: '#3a3c40', rf: 'shed', rm: 'seam', rc: '#34363a', p: 0.22, oh: 0.25, fc: '#2c2d30', gc: '#2c2d30', fr: 2, bal: 'alu', ac: 'board', acc: '#a8835c', dr: 1, fen: 'slat', fenc: '#2c2d2f', sh: 0, mt: 'box' },
  { n: '南欧風・オレンジ瓦', w: 'stucco', wc: '#efe2c6', rf: 'hip', rm: 'yogawara', rc: '#ffffff', p: 0.38, oh: 0.35, fc: '#e9e1cf', gc: '#d9cfbb', fr: 3, bal: 'solid', dr: 3, fen: 'brick', gd: 'lawn', sh: 0.2 },
  { n: '和モダン・いぶし瓦', w: 'stucco', wc: '#ddd7cb', ac: 'board', acc: '#4a3b2f', rf: 'gable', rm: 'kawara', rc: '#959ca5', p: 0.42, oh: 0.75, fc: '#3c3632', gc: '#4a4540', fr: 1, bal: 'solid', dr: 4, fen: 'wood', sh: 0.4, pine: true },
  { n: 'ネイビーのガルバ', w: 'galva', wc: '#4c5a6c', w2: 'siding', wc2: '#eef0f0', rf: 'gable', rm: 'seam', rc: '#45494e', p: 0.35, oh: 0.3, fc: '#3c4046', gc: '#3c4046', fr: 0, bal: 'alu', dr: 2, fen: 'blockf', sh: 0.3 },
  { n: 'レンガ調・茶色の屋根', w: 'brick', wc: '#ffffff', w2: 'siding', wc2: '#efe7da', rf: 'hip', rm: 'slate', rc: '#6a4e3d', p: 0.42, oh: 0.45, fc: '#f0ece4', gc: '#6a5040', fr: 3, bal: 'solid', ac: 'siding', acc: '#efe7da', dr: 6, fen: 'brick', gd: 'lawn', sh: 0.4 },
];
const LOOK_ECO = [
  { n: '白い外壁・太陽光', w: 'siding', wc: '#f2f1ec', rf: 'shed', rm: 'slate', rc: '#3b3d42', p: 0.3, oh: 0.4, fc: '#3a3b3e', gc: '#3a3b3e', fr: 0, bal: 'alu', dr: 0, fen: 'blockf', sh: 0.3, solar: true, mt: 'box' },
  { n: '黒いガルバ・太陽光', w: 'galva', wc: '#3a3c40', ac: 'board', acc: '#a8835c', rf: 'shed', rm: 'seam', rc: '#34363a', p: 0.28, oh: 0.25, fc: '#2c2d30', gc: '#2c2d30', fr: 2, bal: 'alu', dr: 1, fen: 'slat', fenc: '#2c2d2f', solar: true, mt: 'box' },
  { n: '木の外壁・太陽光', w: 'board', wc: '#c9a57c', rf: 'shed', rm: 'seam', rc: '#9a9ea3', p: 0.3, oh: 0.45, fc: '#6b5a48', gc: '#6b5a48', fr: 2, bal: 'alu', dr: 1, fen: 'wood', gd: 'lawn', solar: true, mt: 'box' },
  { n: 'グレー・切妻・太陽光', w: 'siding', wc: '#bfc0bf', rf: 'gable', rm: 'slate', rc: '#3f4247', p: 0.45, oh: 0.5, fc: '#3a3b3e', gc: '#3a3b3e', fr: 0, bal: 'alu', dr: 2, fen: 'blockf', sh: 0.4, solar: true },
  { n: '白い箱・屋上パネル', w: 'stucco', wc: '#f3f2ee', rf: 'flat', fr: 2, bal: 'glass', ac: 'board', acc: '#b88f64', dr: 1, fen: 'slat', fenc: '#2f3032', gd: 'lawn', solar: true },
  { n: 'ベージュ・寄棟・太陽光', w: 'tile', wc: '#e6d9c4', rf: 'hip', rm: 'slate', rc: '#4a4d52', p: 0.45, oh: 0.5, fc: '#5a5650', gc: '#6a5f52', fr: 1, bal: 'solid', dr: 0, fen: 'block', sh: 0.6, solar: true },
  { n: '緑の屋根・太陽光', w: 'siding', wc: '#f0efe8', rf: 'gable', rm: 'seam', rc: '#55705e', p: 0.4, oh: 0.45, fc: '#3f5546', gc: '#3f5546', fr: 0, bal: 'alu', dr: 1, fen: 'hedge', gd: 'lawn', solar: true },
  { n: 'ネイビー・片流れ', w: 'galva', wc: '#4c5a6c', ac: 'siding', acc: '#eef0f0', rf: 'shed', rm: 'seam', rc: '#45494e', p: 0.28, oh: 0.3, fc: '#3c4046', gc: '#3c4046', fr: 0, bal: 'alu', dr: 2, fen: 'blockf', solar: true, mt: 'box' },
  { n: '和モダン・太陽光', w: 'stucco', wc: '#ddd7cb', ac: 'board', acc: '#4a3b2f', rf: 'gable', rm: 'kawara', rc: '#959ca5', p: 0.42, oh: 0.7, fc: '#3c3632', gc: '#4a4540', fr: 1, bal: 'solid', dr: 4, fen: 'wood', solar: true, pine: true },
  { n: '屋上緑化・木の箱', w: 'board', wc: '#b89670', ac: 'stucco', acc: '#efeee9', rf: 'flat', fr: 2, bal: 'glass', dr: 1, fen: 'hedge', gd: 'lawn', green: true },
];
const houseFar = (L, P) => {
  const fl = clamp(P.f || 2, 1, (P.ko && P.ko.fmax) || 3), fh = (P.ko && P.ko.fh) || L.fh || FH, H = HB + fl * fh, flat = L.rf === 'flat';
  return { H: H + (flat ? 0.5 : 0), base: 0, wall: FAR1, bw: 4.2, fh, tb: 2, tf: 2, roof: null, rc: flat ? [0.7, 0.7, 0.68] : mul(col(L.rc || '#55585e'), L.rm === 'yogawara' ? 0.62 : 0.78), rt: flat ? 'flat' : L.rf === 'hip' || L.rf === 'irimoya' ? 'hip' : 'gable', p: L.rf === 'shed' ? 0.2 : (L.p || 0.45), ins: (P.ko && P.ko.fins) || 2.2, wc: wallAvg(L.w2 || L.w, L.w2 ? L.wc2 : L.wc) };
};
// 洋館・和風邸宅・モダンな邸宅・古民家・別荘
const LOOK_YO = [
  { n: '赤レンガ・スレート', w: 'brick', wc: '#ffffff', rf: 'hip', rm: 'slate', rc: '#40444b', p: 0.55, oh: 0.45, fc: '#efebe3', gc: '#3a3a3a', fr: 3, wst: 'yo', bal: 'none', dr: 6, fen: 'iron', gate: 'yo', chim: true, gd: 'lawn', mt: 'L' },
  { n: '白い下見板・緑の屋根', w: 'siding', wc: '#f6f5f0', rf: 'gable', rm: 'seam', rc: '#86a896', p: 0.75, oh: 0.4, fc: '#f4f3ee', gc: '#e9e9e4', fr: 3, wst: 'yo', bal: 'solid', dr: 3, fen: 'iron', gd: 'lawn', chim: true },
  { n: '水色の下見板', w: 'siding', wc: '#c7d7de', ac: 'siding', acc: '#f4f3ee', rf: 'hip', rm: 'slate', rc: '#5a5f66', p: 0.6, oh: 0.45, fc: '#f4f3ee', fr: 3, wst: 'yo', bal: 'solid', dr: 3, fen: 'iron', gd: 'lawn' },
  { n: 'クリーム色・洋瓦', w: 'stucco', wc: '#f0e3c5', rf: 'hip', rm: 'yogawara', rc: '#ffffff', p: 0.42, oh: 0.4, fc: '#ebe1cc', fr: 3, wst: 'yo', bal: 'solid', dr: 6, fen: 'brick', gate: 'yo', gd: 'lawn' },
  { n: 'ハーフティンバー', w: 'brick', wc: '#ffffff', w2: 'timber', wc2: '#ffffff', rf: 'gable', rm: 'slate', rc: '#4a403a', p: 0.85, oh: 0.35, fc: '#5a4030', fr: 3, wst: 'yo', bal: 'none', dr: 6, fen: 'hedge', gd: 'lawn', chim: true, mt: 'L' },
  { n: '石造り風・寄棟', w: 'stone', wc: '#e4dfd4', rf: 'hip', rm: 'slate', rc: '#3f4349', p: 0.5, oh: 0.4, fc: '#e4dfd4', fr: 3, wst: 'yo', bal: 'solid', dr: 6, fen: 'iron', gate: 'yo', chim: true, gd: 'lawn' },
  { n: '黄色い壁・とんがり屋根', w: 'stucco', wc: '#e8d29c', rf: 'gable', rm: 'slate', rc: '#4b4e55', p: 0.7, oh: 0.4, fc: '#f1ece2', fr: 3, wst: 'yo', bal: 'none', tur: true, dr: 3, fen: 'iron', gd: 'lawn' },
  { n: '白壁・黒いスレート', w: 'stucco', wc: '#f5f4f0', rf: 'hip', rm: 'slate', rc: '#2f3237', p: 0.55, oh: 0.45, fc: '#f0eee9', fr: 2, wst: 'yo', bal: 'solid', dr: 6, fen: 'iron', gate: 'yo', gd: 'lawn', chim: true },
  { n: '赤い屋根・白い壁', w: 'siding', wc: '#f3f1ea', rf: 'gable', rm: 'seam', rc: '#a24a3a', p: 0.6, oh: 0.4, fc: '#f3f1ea', fr: 3, wst: 'yo', bal: 'none', tur: true, dr: 3, fen: 'hedge', gd: 'lawn' },
  { n: '灰色の石・青い屋根', w: 'stone', wc: '#c3c0b8', rf: 'hip', rm: 'slate', rc: '#52617a', p: 0.55, oh: 0.45, fc: '#e9e6df', fr: 3, wst: 'yo', bal: 'none', dr: 6, fen: 'iron', gate: 'yo', chim: true, gd: 'lawn', mt: 'L' },
];
const LOOK_WA = [
  { n: 'いぶし瓦・白しっくい', w: 'stucco', wc: '#f3f0e9', ac: 'board', acc: '#4a3b2f', rf: 'irimoya', rm: 'kawara', rc: '#9aa1a9', p: 0.5, oh: 0.95, fc: '#3c342e', gc: '#5a5550', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wafu', gate: 'wa', pine: true, pond: true, sh: 0.3 },
  { n: '焼杉・切妻', w: 'board', wc: '#3b3531', rf: 'gable', rm: 'kawara', rc: '#8f969f', p: 0.48, oh: 0.9, fc: '#2e2a27', gc: '#3a3633', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wood', gate: 'wa', pine: true },
  { n: '黒瓦・入母屋', w: 'stucco', wc: '#e9e0d0', ac: 'board', acc: '#4a3b2f', rf: 'irimoya', rm: 'kawara', rc: '#71777f', p: 0.5, oh: 1.0, fc: '#3a332d', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wafu', gate: 'wa', pine: true, pond: true },
  { n: '銅板ぶきの屋根', w: 'stucco', wc: '#f2efe8', ac: 'board', acc: '#5a4636', rf: 'irimoya', rm: 'seam', rc: '#8aab9b', p: 0.45, oh: 0.9, fc: '#5a4636', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'hedge', pine: true, pond: true },
  { n: '土かべ・茶色', w: 'stucco', wc: '#cfb690', ac: 'board', acc: '#5a4636', rf: 'gable', rm: 'kawara', rc: '#8b9199', p: 0.45, oh: 0.9, fc: '#4a3a2c', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wood', pine: true },
  { n: '白かべと腰板', w: 'board', wc: '#5e4b3b', w2: 'stucco', wc2: '#f3f0e9', rf: 'irimoya', rm: 'kawara', rc: '#969da6', p: 0.5, oh: 0.95, fc: '#3c342e', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wafu', gate: 'wa', pine: true },
  { n: '数寄屋風・ひくい屋根', w: 'stucco', wc: '#ebe4d6', ac: 'board', acc: '#6a5442', rf: 'hip', rm: 'seam', rc: '#5d5a55', p: 0.35, oh: 1.1, fc: '#4a3e34', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'hedge', pine: true, pond: true, mt: 'L' },
  { n: '銀ねずの瓦・生け垣', w: 'stucco', wc: '#f0ebe1', ac: 'board', acc: '#4e3f32', rf: 'hip', rm: 'kawara', rc: '#b0b6bd', p: 0.48, oh: 0.85, fc: '#433a32', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'hedge', pine: true },
  { n: '蔵風・白と黒', w: 'board', wc: '#302c29', w2: 'stucco', wc2: '#f5f3ed', rf: 'gable', rm: 'kawara', rc: '#7e848c', p: 0.5, oh: 0.8, fc: '#2e2a27', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wafu', gate: 'wa' },
  { n: 'モダン和風・ガルバ', w: 'galva', wc: '#4a4b4d', ac: 'board', acc: '#a8835c', rf: 'gable', rm: 'seam', rc: '#3a3b3d', p: 0.3, oh: 0.9, fc: '#2f3032', fr: 2, wst: 'wa', bal: 'none', dr: 4, fen: 'wood', pine: true },
];
const LOOK_LUX = [
  { n: '白い大きな箱', wst: 'lux', w: 'stucco', wc: '#f4f3ef', ac: 'stone', acc: '#dcd6c9', rf: 'flat', fr: 2, bal: 'glass', dr: 1, fen: 'wall', fenc: '#eeece7', gd: 'lawn', garage: true, mt: 'L', fc: '#b9bbbd' },
  { n: '石張りと木', wst: 'lux', w: 'stone', wc: '#dad4c8', ac: 'board', acc: '#9b7350', rf: 'flat', fr: 2, bal: 'glass', dr: 1, fen: 'slat', fenc: '#3a3532', gd: 'lawn', garage: true, fc: '#8a8c8e' },
  { n: '黒いタイルの邸宅', wst: 'lux', w: 'tile', wc: '#525150', ac: 'board', acc: '#a57e58', rf: 'flat', fr: 2, bal: 'glass', dr: 2, fen: 'slat', fenc: '#2c2d2f', gd: 'lawn', garage: true, fc: '#5a5b5d' },
  { n: '打ちはなしの邸宅', wst: 'lux', w: 'conc', wc: '#ffffff', rf: 'flat', fr: 2, bal: 'glass', dr: 2, fen: 'wall', fenc: '#c4c2bc', gd: 'lawn', garage: true, fc: '#a9a8a4' },
  { n: '大屋根の邸宅', wst: 'lux', w: 'siding', wc: '#eae8e2', ac: 'board', acc: '#8a6446', rf: 'gable', rm: 'seam', rc: '#3b3c3f', p: 0.35, oh: 1.0, fc: '#2f3032', gc: '#2f3032', fr: 2, bal: 'glass', dr: 1, fen: 'slat', gd: 'lawn', garage: true },
  { n: 'ベージュの石と寄棟', w: 'stone', wc: '#e8dfcf', rf: 'hip', rm: 'slate', rc: '#4a4d53', p: 0.42, oh: 0.6, fc: '#e8dfcf', gc: '#6a5f52', fr: 1, bal: 'solid', dr: 6, fen: 'iron', gate: 'yo', gd: 'lawn', garage: true },
];
const LOOK_KOMIN = [
  { n: 'かやぶき屋根', w: 'stucco', wc: '#dccfb6', ac: 'board', acc: '#4e3e30', w2: 'board', wc2: '#4e3e30', rf: 'hip', rm: 'kaya', rc: '#ffffff', p: 0.95, oh: 0.9, fc: '#6a5c48', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'hedge', gd: 'gravel', mt: 'box' },
  { n: '赤いトタン屋根', w: 'board', wc: '#6c5947', rf: 'hip', rm: 'seam', rc: '#97473a', p: 0.8, oh: 0.8, fc: '#4a3a2c', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'hedge', mt: 'box' },
  { n: '青いトタン屋根', w: 'stucco', wc: '#e2d8c4', ac: 'board', acc: '#4e3e30', rf: 'hip', rm: 'seam', rc: '#4f6886', p: 0.8, oh: 0.8, fc: '#4a3a2c', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wood', mt: 'box' },
  { n: '瓦の古民家', w: 'stucco', wc: '#e6ddcc', ac: 'board', acc: '#4e3e30', rf: 'irimoya', rm: 'kawara', rc: '#8b9199', p: 0.55, oh: 1.0, fc: '#3c342e', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wafu', gate: 'wa', pine: true },
  { n: '板ばりの古民家', w: 'board', wc: '#6e5b49', rf: 'gable', rm: 'kawara', rc: '#7f858d', p: 0.55, oh: 0.9, fc: '#3c342e', fr: 1, wst: 'wa', bal: 'none', dr: 4, fen: 'wood', pine: true },
];
const LOOK_VILLA = [
  { n: '木の別荘・急な屋根', w: 'board', wc: '#c49a6c', rf: 'gable', rm: 'seam', rc: '#3f5a4c', p: 0.95, oh: 0.6, fc: '#5a4636', fr: 1, bal: 'alu', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box' },
  { n: '白い板ばり・片流れ', w: 'siding', wc: '#f3f2ee', rf: 'shed', rm: 'seam', rc: '#4a4b4e', p: 0.3, oh: 0.5, fc: '#4a4b4e', fr: 2, bal: 'glass', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box' },
  { n: 'こげ茶の板・大屋根', w: 'board', wc: '#5a4636', rf: 'gable', rm: 'seam', rc: '#2f3033', p: 0.5, oh: 0.9, fc: '#2f3033', fr: 2, bal: 'alu', dr: 1, fen: 'hedge', gd: 'lawn' },
  { n: '石と木の山荘', w: 'stone', wc: '#b9b3a8', w2: 'board', wc2: '#a77f56', rf: 'gable', rm: 'slate', rc: '#3c3f44', p: 0.65, oh: 0.7, fc: '#4a3a2c', fr: 1, bal: 'solid', ac: 'board', acc: '#a77f56', dr: 1, fen: 'hedge', gd: 'lawn', chim: true },
];
const LOOK_LOG = [
  { n: '丸太・緑の屋根', w: 'log', wc: '#ffffff', rf: 'gable', rm: 'seam', rc: '#4d6b55', p: 0.85, oh: 0.7, fc: '#5a3e26', fr: 1, bal: 'solid', ac: 'log', acc: '#ffffff', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box', chim: true },
  { n: '丸太・赤い屋根', w: 'log', wc: '#ffffff', rf: 'gable', rm: 'seam', rc: '#8e3f32', p: 0.85, oh: 0.7, fc: '#5a3e26', fr: 1, bal: 'none', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box', chim: true },
  { n: 'こげ茶の丸太', w: 'log', wc: '#9c7f66', rf: 'gable', rm: 'slate', rc: '#3c3f44', p: 0.75, oh: 0.7, fc: '#4a3a2c', fr: 1, bal: 'solid', ac: 'log', acc: '#9c7f66', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box' },
  { n: '丸太・かやぶき風', w: 'log', wc: '#ffffff', rf: 'gable', rm: 'kaya', rc: '#ffffff', p: 0.9, oh: 0.8, fc: '#5a3e26', fr: 1, bal: 'none', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box' },
];
const LOOK_BEACH = [
  { n: '白い板ばり・青い屋根', w: 'siding', wc: '#f5f5f1', rf: 'gable', rm: 'seam', rc: '#4f7593', p: 0.35, oh: 0.6, fc: '#f5f5f1', fr: 3, bal: 'alu', dr: 3, fen: 'hedge', gd: 'lawn' },
  { n: '水色の板・白い屋根', w: 'siding', wc: '#bcd6df', rf: 'gable', rm: 'seam', rc: '#e9eaea', p: 0.35, oh: 0.6, fc: '#f5f5f1', fr: 3, bal: 'glass', dr: 3, fen: 'hedge', gd: 'lawn' },
  { n: '白い箱・ルーフデッキ', w: 'stucco', wc: '#f6f5f1', rf: 'flat', fr: 3, bal: 'glass', dr: 1, fen: 'hedge', gd: 'lawn', fc: '#d9dadb' },
  { n: '木のデッキハウス', w: 'board', wc: '#d2b08a', rf: 'shed', rm: 'seam', rc: '#8d9196', p: 0.2, oh: 0.8, fc: '#8d9196', fr: 2, bal: 'alu', dr: 1, fen: 'hedge', gd: 'lawn', mt: 'box' },
  { n: '砂色の塗り壁・洋瓦', w: 'stucco', wc: '#eadbc0', rf: 'hip', rm: 'yogawara', rc: '#ffffff', p: 0.35, oh: 0.4, fc: '#e2d6c0', fr: 3, bal: 'solid', dr: 3, fen: 'brick', gd: 'lawn' },
];
A.arch('h_house', { looks: LOOK_HOUSE, build: houseBuild, far: houseFar });
A.arch('h_yokan', { looks: LOOK_YO, build: houseBuild, far: houseFar });
A.arch('h_wafu', { looks: LOOK_WA, build: houseBuild, far: houseFar });
A.arch('h_estate', { looks: LOOK_LUX, build: houseBuild, far: houseFar });
A.arch('h_eco', { looks: LOOK_ECO, build: houseBuild, far: houseFar });

/* ---------- マンション（RC）----------
   外壁の面は 1戸（はば MW）× 2階 の質感を くりかえす：ベランダがわ（掃き出し窓 2つ）・廊下がわ（ドア・PS・面格子の窓）。種類（fam）ごとに 1枚ずつ、色は 頂点で そめる
   辺の役：B ベランダ（南など）・C 開放廊下（北・中庭）・E 妻（窓の少ない壁）。ベランダ・廊下は 階ごとの 板（lod 1 は 前と上だけ） */
const MW = 6.0, MF = 2.95, MB = 0.25, DIVC = [0.9, 0.89, 0.86];
function pWallF(g, x, y, w, h, t, R) {
  if (t === 'tile') { PT.fill(g, x, y, w, h, '#cdc7bd'); const nc = 26, nr = 44, tw = w / nc, th = h / nr; for (let j = 0; j < nr; j++) for (let i = -1; i <= nc; i++) { g.fillStyle = PT.css('#f2ede5', 0.91 + R() * 0.11); g.fillRect(x + (i + (j % 2) * 0.5) * tw + 0.6, y + j * th + 0.6, tw - 1.2, th - 1.2); } }
  else if (t === 'stone') { PT.fill(g, x, y, w, h, '#c9c4ba'); const nc = 10, nr = 20, tw = w / nc, th = h / nr; for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) { g.fillStyle = PT.css('#f1ede6', 0.88 + R() * 0.14); g.fillRect(x + i * tw + 0.8, y + j * th + 0.8, tw - 1.6, th - 1.6); } }
  else if (t === 'conc') { PT.fill(g, x, y, w, h, '#d3d1cb'); for (let i = 0; i < 60; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)'; g.beginPath(); g.arc(x + R() * w, y + R() * h, w * (0.02 + 0.05 * R()), 0, 6.283); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,.16)'; for (let k = 0; k <= 6; k++) g.fillRect(x, y + h * k / 6, w, 1); for (let k = 0; k <= 3; k++) g.fillRect(x + w * k / 3, y, 1, h); g.fillStyle = 'rgba(60,60,60,.4)'; for (let k = 0; k < 6; k++) for (let q = 0; q < 6; q++) g.fillRect(x + w * (q + 0.5) / 6, y + h * (k + 0.5) / 6, 1.6, 1.6); }
  else { PT.fill(g, x, y, w, h, '#f3f1ec'); PT.noise(g, x, y, w, h, 0.03, R); }
}
function pMansB(g, w, h, R, t) {   // ベランダがわ（1戸 × 2階）
  pWallF(g, 0, 0, w, h, t, R);
  for (let j = 0; j < 2; j++) { const y = j * h / 2, ch = h / 2, yb = y + ch * 0.95, yt = yb - ch * 0.69;
    PT.fill(g, w * 0.05, yt - ch * 0.03, w * 0.39, yb - yt + ch * 0.03, 'rgba(0,0,0,.12)');
    pSash(g, w * 0.06, yt, w * 0.37, yb - yt, R, { f: '#8e9296', st: 'r' }); pSash(g, w * 0.53, yt, w * 0.32, yb - yt, R, { f: '#8e9296', st: 'r' });
    PT.fill(g, 0, yb, w, ch * 0.05, '#bdb8af'); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, yb, w, Math.max(1, ch * 0.015));
    PT.streaks(g, 0, yb + ch * 0.05, w, ch * 0.3, 3, 0.05, R); }
}
function pMansC(g, w, h, R, t) {   // 廊下がわ（1戸 × 2階）
  pWallF(g, 0, 0, w, h, t, R);
  for (let j = 0; j < 2; j++) { const y = j * h / 2, ch = h / 2, yb = y + ch * 0.95;
    PT.fill(g, w * 0.07, yb - ch * 0.69, w * 0.15, ch * 0.69, '#6c6a66'); PT.fill(g, w * 0.08, yb - ch * 0.67, w * 0.13, ch * 0.67, pick(R, ['#7b6656', '#8f9aa3', '#6d6f72', '#9a8e7e']));
    PT.fill(g, w * 0.19, yb - ch * 0.36, w * 0.012, ch * 0.05, '#d0d0cc');
    PT.fill(g, w * 0.25, yb - ch * 0.62, w * 0.1, ch * 0.62, '#c9c6bf'); g.fillStyle = 'rgba(0,0,0,.18)'; for (let k = 0; k < 8; k++) g.fillRect(w * 0.26, yb - ch * (0.58 - k * 0.07), w * 0.08, Math.max(1, ch * 0.012));
    pSash(g, w * 0.42, yb - ch * 0.66, w * 0.22, ch * 0.3, R, { f: '#9a9ea2', frost: true, grille: true }); pSash(g, w * 0.74, yb - ch * 0.66, w * 0.1, ch * 0.2, R, { f: '#9a9ea2', frost: true, grille: true });
    PT.fill(g, w * 0.3, yb - ch * 0.8, w * 0.04, ch * 0.03, '#f4f2e8');
    PT.fill(g, 0, yb, w, ch * 0.05, '#bdb8af'); }
}
const FAMS = {};
for (const t of ['tile', 'paint', 'conc', 'stone']) FAMS[t] = { b: TX('mb_' + t, 256, 256, (g, w, h, R) => pMansB(g, w, h, R, t)), c: TX('mc_' + (t === 'stone' ? 'tile' : t === 'conc' ? 'paint' : t), 256, 256, (g, w, h, R) => pMansC(g, w, h, R, t === 'stone' ? 'tile' : t === 'conc' ? 'paint' : t)), m: MAT[t === 'paint' ? 'stucco' : t] };
// 1階のお店（2つの間口 × 1階）：ガラスの店先・シャッター・看板の帯（色だけ。文字なし）
const MSHOP = TX('mshop', 256, 128, (g, w, h, R) => {
  PT.fill(g, 0, 0, w, h, '#d7d3cb');
  const sg = ['#5d6b78', '#7a5f4a', '#3f5a4e', '#8a8478', '#5a4f63', '#9a7f5c', '#46525e'];
  for (let i = 0; i < 2; i++) { const x = i * w / 2, bw = w / 2;
    PT.fill(g, x + bw * 0.02, h * 0.06, bw * 0.96, h * 0.2, pick(R, sg)); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + bw * 0.02, h * 0.06, bw * 0.96, h * 0.05);
    if (i === 1 && R() < 0.5) PT.shutter(g, x + bw * 0.05, h * 0.34, bw * 0.9, h * 0.66, '#b4b7b9');
    else { PT.fill(g, x + bw * 0.04, h * 0.32, bw * 0.92, h * 0.68, '#3b3e41'); const gr = g.createLinearGradient(0, h * 0.34, 0, h); gr.addColorStop(0, '#c9d2d8'); gr.addColorStop(0.35, '#efe2c8'); gr.addColorStop(1, '#bba27f'); g.fillStyle = gr; g.fillRect(x + bw * 0.06, h * 0.34, bw * 0.88, h * 0.64);
      for (let q = 0; q < 6; q++) PT.fill(g, x + bw * (0.1 + q * 0.14), h * (0.55 + 0.1 * (q % 2)), bw * 0.08, h * 0.3, pick(R, ['#a88f6f', '#8ea2ae', '#c3b293', '#9aa786', '#c79582']));
      PT.fill(g, x + bw * 0.49, h * 0.34, bw * 0.02, h * 0.66, '#3b3e41'); pRefl(g, x + bw * 0.06, h * 0.34, bw * 0.88, h * 0.64); }
    PT.fill(g, x, 0, bw * 0.02, h, '#c4bfb5'); }
});
// 箱の帯（ひさし・廊下・ベランダの床）：辺 e の外 0〜dep・s0〜s1・y0〜y1。前は 材料の質感（m・su・sv）、ほかは 色 c
function slab(B, e, s0, s1, dep, y0, y1, m, c, su, sv, lite) {
  const tx = (e.bx - e.ax) / e.L, tz = (e.bz - e.az) / e.L, ax = e.ax + tx * s0, az = e.az + tz * s0, bx = e.ax + tx * s1, bz = e.az + tz * s1, px = e.nx * dep, pz = e.nz * dep, cc = col(c);
  if (m === 'c') wall2(B, 'c', ax + px, az + pz, bx + px, bz + pz, y0, y1, cc, 0, 0, 0, 0); else wall2(B, m, ax + px, az + pz, bx + px, bz + pz, y0, y1, cc, s0 / su, s1 / su, y0 / sv, y1 / sv);
  const ct = [cc[0] * 1.04, cc[1] * 1.04, cc[2] * 1.04];
  wq(B, 'c', ax + px, y1, az + pz, bx + px, y1, bz + pz, bx, y1, bz, ax, y1, az, 0, 1, 0, ct, 0, 0, 0, 0, 1, 1);
  if (lite) return;
  const cb = [cc[0] * 0.7, cc[1] * 0.7, cc[2] * 0.7], cs = [cc[0] * 0.92, cc[1] * 0.92, cc[2] * 0.92];
  wq(B, 'c', ax, y0, az, bx, y0, bz, bx + px, y0, bz + pz, ax + px, y0, az + pz, 0, -1, 0, cb, 0, 0, 0, 0, 1, 1);
  wall2(B, 'c', ax, az, ax + px, az + pz, y0, y1, cs, 0, 0, 0, 0); wall2(B, 'c', bx + px, bz + pz, bx, bz, y0, y1, cs, 0, 0, 0, 0);
}
// 区画の 地面と 木・自転車置き場 など（マンション・アパート 共通の外まわり）
function yard(B, P, F, lot, n, R, room, o = {}) {
  B.cap(o.gm || GND.tile, lot, 0.03, WH, { su: o.gsu || GSU.tile });
  if (P.lod < 2) return;
  const fe = A.frontEdge(lot, P.front);
  // 植えこみ（道がわ以外の ふち）と 木
  for (const e of lot.edges) { if (room() < 60) break; const front = e.nx * n[0] + e.nz * n[1] > 0.5; if (front && !o.frontHedge) continue; if (e.L < 3) continue; hedge(B, e, 0.3, e.L - 0.3, front ? 0.7 : 1.1, 0.6); }
  const nT = clamp(Math.round(Math.sqrt(lot.area) / 8), 1, 8);
  for (let i = 0, t = 0; i < nT && t < 20 && room() > 80; t++) { const e = pick(R, lot.edges), s = rnd(R, 1.5, e.L - 1.5), c = ept(e, s, -1.0); if (F.rects.some(r => inR(r, c[0], c[1], 0.6))) continue; tree(B, c[0], c[1], 0.03, rnd(R, 3.5, 6), rnd(R, 1.0, 1.7), pick(R, ['#4f7340', '#5f8448', '#3f6036', '#567a3e']), R); i++; }
  // 自転車置き場（屋根つき）
  if (o.bikes !== false && room() > 120) { const e = pick(R, lot.edges.filter(q => q.L > 8 && !(q.nx * n[0] + q.nz * n[1] > 0.5)) || []) || fe; if (!e) return;
    const s0 = rnd(R, 1, Math.max(1.2, e.L - 7)), s1 = Math.min(e.L - 0.6, s0 + 5.5), d = 1.9, y = 2.1, k = [0.55, 0.56, 0.57];
    const a = ept(e, s0, -0.2), b = ept(e, s1, -0.2), a2 = ept(e, s0, -0.2 - d), b2 = ept(e, s1, -0.2 - d);
    if (!F.rects.some(r => hitR(r, [Math.min(a[0], b2[0]), Math.min(a[1], b2[1]), Math.max(a[0], b2[0]), Math.max(a[1], b2[1])], 0.1))) {
      B.quad(GLS, [a[0], y, a[1]], [b[0], y, b[1]], [b2[0], y + 0.15, b2[1]], [a2[0], y + 0.15, a2[1]], null, WH, [0, 0.02, (s1 - s0) / 2, 0.48]);
      post(B, a2[0], a2[1], 0.03, y + 0.15, 0.04, k); post(B, b2[0], b2[1], 0.03, y + 0.15, 0.04, k);
      const ex = (e.bx - e.ax) / e.L, ez = (e.bz - e.az) / e.L, vb = RB(7);
      for (let q = s0 + 0.4; q < s1 - 0.3; q += 0.65) { const c = ept(e, q, -0.2 - d * 0.5), k2 = R() < 0.5 ? 0 : 0.5; B.quad(RAIL, [c[0] - e.nx * 0.9, 0.04, c[1] - e.nz * 0.9], [c[0] + e.nx * 0.9, 0.04, c[1] + e.nz * 0.9], [c[0] + e.nx * 0.9, 1.08, c[1] + e.nz * 0.9], [c[0] - e.nx * 0.9, 1.08, c[1] - e.nz * 0.9], [ex, 0, ez], WH, [k2, vb[0], k2 + 0.5, vb[1]]); } } }
}
function mansionBuild(B, L, P) {
  const O = P.ko || {}, R = P.rng, lod = P.lod, nv0 = B.nv, fl = Math.max(1, P.f || 4), shop = !!(O.shop || (P.pr && P.pr.g1)), g1h = shop ? 4.2 : MF;
  const F0 = P.F, bigB = F0.area * fl > 8000 || fl >= 10, cap = lod >= 2 ? (bigB ? 3400 : 2100) : lod === 1 ? (bigB ? 1000 : 520) : (bigB ? 290 : 145), room = () => cap - (B.nv - nv0);
  const yOf = k => k <= 0 ? MB : MB + g1h + (k - 1) * MF, H = yOf(fl), uw = O.uw || MW;
  const fam = FAMS[L.wf] || FAMS.tile, tint = col(L.wc || '#e8e2d6'), wmat = L.em ? MAT[L.em] : fam.m, ec = col(L.ec || L.wc || '#e8e2d6'), ftint = L.wf === 'conc' ? wallAvg('conc', L.wc) : tint;
  const ins = O.ins != null ? O.ins : F0.area >= 600 ? 2.2 : 1.6, F = A.inset(F0, ins), lot = A.inset(F0, 0.05);
  const fe = A.frontEdge(F0, P.front), n = [Math.round(fe.nx), Math.round(fe.nz)];
  const hip = L.rf === 'hip' && F.maxr.length <= 6 && fl <= 6;
  const shopF = shop ? A.inset(F0, 0.6) : null;
  // --- 遠く（lod 0）：箱と 屋根
  if (lod <= 0) {
    const yb = P.yb < -0.5 ? P.yb : 0;
    if (shopF) { for (const e of shopF.edges) B.wallE(MSHOP, e, yb, yOf(1), WH, { uv: [0, Math.max(1, Math.round(e.L / uw)) / 2, -0.06, 1] }); B.cap('c', shopF, yOf(1), [0.7, 0.7, 0.68]); }
    for (const e of F.edges) B.wallE(FARM, e, shopF ? yOf(1) : yb, H + (hip ? 0 : 0.9), ftint, { uv: [0, Math.max(1, Math.round(e.L / uw)) / 2, ((shopF ? yOf(1) : yb) - yOf(shop ? 1 : 0)) / MF / 2, (H - yOf(shop ? 1 : 0)) / MF / 2], ao: 0.85 });
    if (hip) roofs(B, F, { t: 'hip', y: H, p: 0.38, oh: 0.6, th: 0, m: RMAT[L.rm || 'slate'].k, c: L.rcol || '#ffffff', su: 3, sv: 3 });
    else B.cap('c', F, H + 0.9, [0.72, 0.72, 0.7]);
    return;
  }
  // --- 辺の役
  const elEW = F.w >= F.d * 1.3, elNS = F.d >= F.w * 1.3, hasS = F.edges.some(e => e.out && e.nz > 0.5 && e.L >= 6.5), ewB = (O.ew || (R() < 0.5 ? 1 : -1));
  const role = new Map();
  for (const e of F.edges) { let r;
    if (!e.out) r = 'C'; else if (e.L < 6.5) r = 'E';
    else if (Math.abs(e.nz) > 0.5) r = elNS && e.L < 12 ? 'E' : e.nz > 0 ? 'B' : hasS ? 'C' : 'B';
    else r = elEW && e.L < 14 ? 'E' : (e.nx * ewB > 0 ? 'B' : (hasS || elNS ? 'C' : 'B'));
    role.set(e, r); }
  const insideF = (x, z) => F.rects.some(r => inR(r, x, z));
  const span = (e, d) => { const tx = (e.bx - e.ax) / e.L, tz = (e.bz - e.az) / e.L, ca = insideF(e.ax - tx * 0.1 + e.nx * 0.1, e.az - tz * 0.1 + e.nz * 0.1), cb = insideF(e.bx + tx * 0.1 + e.nx * 0.1, e.bz + tz * 0.1 + e.nz * 0.1); return [ca ? d + 0.15 : 0, e.L - (cb ? d + 0.15 : 0)]; };
  // --- 地面・基礎
  yard(B, P, F, lot, n, R, room, { frontHedge: false });
  if (lod >= 2 || P.yb < -0.5) B.plinth(shopF || F, P.yb, MB + 0.01, [0.66, 0.65, 0.62]);
  // --- 1階のお店（下駄ばき）
  const y1 = yOf(1);
  if (shopF) { for (const e of shopF.edges) { const fr2 = e.nx * n[0] + e.nz * n[1] > -0.5; if (fr2) B.wallE(MSHOP, e, MB, y1, WH, { uv: [0, Math.max(1, Math.round(e.L / uw)) / 2, 0, 0.97] }); else B.wallE(wmat.k, e, MB, y1, ec, { uv: [0, e.L / wmat.su, MB / wmat.sv, y1 / wmat.sv] }); }
    B.cap(RMAT.flat.k, shopF, y1 + 0.02, WH, { su: 6 });
    for (const e of shopF.edges) B.wallE(wmat.k, e, y1, y1 + 0.6, ec, { uv: [0, e.L / wmat.su, y1 / wmat.sv, (y1 + 0.6) / wmat.sv] });
    if (lod >= 2) for (const e of shopF.edges) { if (!(e.nx * n[0] + e.nz * n[1] > -0.5) || room() < 200) continue; const nb = Math.max(1, Math.round(e.L / uw)), bw2 = e.L / nb;
      for (let i = 0; i < nb; i++) if (R() < 0.6) { const s0 = i * bw2 + bw2 * 0.06, s1 = (i + 1) * bw2 - bw2 * 0.06, a = ept(e, s0), b = ept(e, s1), a2 = ept(e, s0, 1.1), b2 = ept(e, s1, 1.1), ac = pick(R, [[0.55, 0.32, 0.25], [0.32, 0.4, 0.33], [0.62, 0.58, 0.5], [0.3, 0.36, 0.45], [0.5, 0.45, 0.38]]);
        B.quad('c', [a2[0], y1 - 1.55, a2[1]], [b2[0], y1 - 1.55, b2[1]], [b[0], y1 - 1.05, b[1]], [a[0], y1 - 1.05, a[1]], null, ac); } } }
  // --- 壁（役ごとの 外壁の面）
  const yF0 = shopF ? y1 : MB, vy = shopF ? y1 : MB;
  B.facade(fam.b, F, yF0, H, { bw: uw, fh: MF, tb: 1, tf: 2, vy, only: e => role.get(e) === 'B', c: tint, ao: shopF ? 1 : 0.85 });
  B.facade(fam.c, F, yF0, H, { bw: uw, fh: MF, tb: 1, tf: 2, vy, only: e => role.get(e) === 'C', c: tint, ao: shopF ? 1 : 0.85 });
  for (const e of F.edges) if (role.get(e) === 'E') B.wallE(wmat.k, e, yF0, H, ec, { uv: [0, e.L / wmat.su, yF0 / wmat.sv, H / wmat.sv], ao: 0.85 });
  // パラペット（外の面は 外壁の材料）
  if (!hip) { const ph = 0.9; for (const e of F.edges) B.wallE(wmat.k, e, H, H + ph, ec, { uv: [0, e.L / wmat.su, H / wmat.sv, (H + ph) / wmat.sv] });
    B.cap(RMAT.flat.k, F, H + 0.05, [0.8, 0.8, 0.78], { su: 6 });
    const I = A.inset(F, 0.2); for (const e of I.edges) B.wall('c', e.bx, e.bz, e.ax, e.az, H, H + ph, mul(ec, 0.8));
    if (lod >= 2) for (let k = 0; k < F.loops.length; k++) { const a = F.loops[k], b = I.loops[k]; if (!b || a.length !== b.length) continue; for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; B.quad('c', [a[i][0], H + ph + 0.02, a[i][1]], [b[i][0], H + ph + 0.02, b[i][1]], [b[j][0], H + ph + 0.02, b[j][1]], [a[j][0], H + ph + 0.02, a[j][1]], [0, 1, 0], [0.62, 0.63, 0.64]); } } }
  else roofs(B, F, { t: 'hip', y: H, p: 0.38, oh: 0.6, th: 0.2, m: RMAT[L.rm || 'slate'].k, c: L.rcol || '#ffffff', su: RMAT[L.rm || 'slate'].su, sv: RMAT[L.rm || 'slate'].sv, cf: mul(ec, 0.9), cr: mul(roofAvg(L.rm || 'slate', L.rcol || '#ffffff'), 0.85) });
  // --- ベランダ・廊下（階ごと）
  const bd = O.bd || L.bd || 1.6, cd = 1.35, sc = col(L.sc || '#dedad2'), rl = L.rl || 'solid', rlc = col(L.rlc || L.wc || '#dedad2'), lite = lod < 2;
  const bes = F.edges.filter(e => role.get(e) === 'B'), ces0 = F.edges.filter(e => role.get(e) === 'C');
  // こまかさ：すべての階に 同じだけ（足りなければ そろって へらす）
  const left = room() - (lod >= 2 ? 420 : 70), nk = Math.max(1, fl - 1), cost = q => nk * (bes.reduce((a, e) => a + (q ? [0, 18, 12, 6][q] : 48 + 6 * Math.max(0, Math.round(e.L / uw) - 1)), 0) + ces0.length * [30, 12, 6, 6][q]);
  let q = lite ? 1 : 0; while (q < 3 && cost(q) > left) q++;
  const ces = cost(q) > left ? [] : ces0, thin = q >= 2, lt = lite || q >= 1;
  for (let k = 1; k < fl; k++) { const y = yOf(k);
    for (const e of bes) { const [s0, s1] = span(e, bd); if (s1 - s0 < 2) continue;
      if (q >= 3) { band(B, rl === 'solid' ? wmat.k : 'c', e, s0, s1, bd, y - 0.2, 1.3, [y / wmat.sv, (y + 1.1) / wmat.sv], wmat.su, rl === 'solid' ? rlc : mix(sc, rlc, 0.5)); continue; }
      if (rl === 'solid') { slab(B, e, s0, s1, bd, y - 0.2, y + 1.1, wmat.k, rlc, wmat.su, wmat.sv, lt); }
      else { if (thin) band(B, 'c', e, s0, s1, bd, y - 0.2, 0.2, [0, 0], 1, sc); else slab(B, e, s0, s1, bd, y - 0.2, y, 'c', sc, 1, 1, lt);
        const m = rl === 'glass' ? GLS : RAIL, vb = rl === 'glass' ? [0.52, 0.98] : rl === 'frost' ? RB(4) : RB(rl === 'bar2' ? 1 : 0), su = rl === 'glass' ? 2 : 1.6, c = rl === 'glass' ? WH : rlc;
        band(B, m, e, s0, s1, bd, y, 1.1, vb, su, c);
        if (!lt) { bandP(B, m, ept(e, s0), ept(e, s0, bd), y, 1.1, vb, su, c); bandP(B, m, ept(e, s1, bd), ept(e, s1), y, 1.1, vb, su, c); } }
      if (!lt) { const nb = Math.max(1, Math.round(e.L / uw)), bw2 = e.L / nb;   // 隔て板
        for (let i = 1; i < nb; i++) { const q = i * bw2; if (q < s0 + 0.5 || q > s1 - 0.5) continue; const a = ept(e, q, 0.05), b = ept(e, q, bd - 0.05); wall2(B, 'c', a[0], a[1], b[0], b[1], y, y + 1.9, DIVC, 0, 0, 0, 0); } } }
    for (const e of ces) { const [s0, s1] = span(e, cd); if (s1 - s0 < 2) continue; if (thin) band(B, wmat.k, e, s0, s1, cd, y - 0.25, 1.4, [(y - 0.25) / wmat.sv, (y + 1.15) / wmat.sv], wmat.su, ec); else slab(B, e, s0, s1, cd, y - 0.25, y + 1.15, wmat.k, ec, wmat.su, wmat.sv, lt); }
  }
  // --- 階段・エレベーターの棟（廊下がわ）
  const ce = ces.length ? ces.reduce((a, e) => e.L > a.L ? e : a) : null;
  if (ce && fl >= 3 && ce.L > 12) { const s = ce.L * (R() < 0.5 ? 0.5 : R() < 0.5 ? 0.15 : 0.85), w = 4.6, d = cd + 2.6, a = ept(ce, s - w / 2), b = ept(ce, s + w / 2, d), yT = H + (fl >= 4 ? 2.8 : 0.9);
    const r = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    B.box(wmat.k, r[0], r[1], r[2], r[3], MB, yT, ec, { su: wmat.su, sv: wmat.sv });
    if (lod >= 2) { const fe2 = redges(r).find(q => q.nx === ce.nx && q.nz === ce.nz); if (fe2) for (let k = 1; k < fl && room() > 200; k++) { const y = yOf(k) + 1.0; panel(B, WIN, fe2, fe2.L * 0.5, 0.5, y, y + 1.2, wuv(4 + 1, 4), 0.06); } } }
  else if (!hip && fl >= 3 && lod >= 1) { const big = F.rects.reduce((a, r) => (r[2] - r[0]) * (r[3] - r[1]) > (a[2] - a[0]) * (a[3] - a[1]) ? r : a), cx = (big[0] + big[2]) / 2 + (R() - 0.5) * (big[2] - big[0]) * 0.4, cz = (big[1] + big[3]) / 2;
    if (big[2] - big[0] > 8 && big[3] - big[1] > 8) B.box(wmat.k, cx - 2.4, cz - 2, cx + 2.4, cz + 2, H, H + 2.8, ec, { su: wmat.su, sv: wmat.sv }); }
  // --- エントランス（道がわ）
  const fF = A.frontEdge(F, P.front);
  let entS = null;
  if (fF && fF.L > 6) { const s = fF.L * (shopF ? 0.5 : 0.3 + 0.4 * R()), w = 4.8, yc = shopF ? y1 : y1 - 0.58; entS = { e: fF, s0: s - w / 2 - 0.3, s1: s + w / 2 + 0.3 };
    panel(B, WIN, fF, s, 3.2, MB + 0.02, MB + 2.5, wuv(4, 10), shopF ? (shopF === F ? 0.08 : ins - 0.6 + 0.08) : 0.08);
    if (!shopF) { slab(B, fF, s - w / 2, s + w / 2, 2.4, yc, yc + 0.26, 'c', col(L.acc || '#5c5f62'), 1, 1, lod < 2);
      if (lod >= 2) { const a = ept(fF, s - w / 2 - 0.6, 0.1), b = ept(fF, s - w / 2 + 0.2, 0.1); B.wall(MAT.stone.k, a[0], a[1], b[0], b[1], MB, yc, col(L.acc ? mix(L.acc, '#ffffff', 0.5) : '#d9d4ca'), [0, 0.3, 0, 1]); } } }
  if (lod < 2) return;
  // ---------- 近く：1階の専用庭・屋上の小物・ベランダの 室外機と 洗たく物
  if (!shopF) for (const e of bes) { if (room() < 200) break; const [s0, s1] = span(e, 0); const d = Math.min(ins - 0.3, 1.9); if (d < 0.8) continue;
    let segs = [[s0 + 0.2, s1 - 0.2]]; if (entS && entS.e === e) segs = cutS(segs, entS.s0, entS.s1);
    for (const [g0, g1] of segs) { if (g1 - g0 < 1.5) continue; const a = ept(e, g0, 0.05), b = ept(e, g1, 0.05), a2 = ept(e, g0, d), b2 = ept(e, g1, d);
      wq(B, GND.lawn, a2[0], 0.06, a2[1], b2[0], 0.06, b2[1], b[0], 0.06, b[1], a[0], 0.06, a[1], 0, 1, 0, WH, 0, 0, (g1 - g0) / 4, d / 4, 1, 1);
      band(B, RAIL, e, g0, g1, d, 0.06, 0.9, RB(0), 1.6, col(L.rlc || '#b9bdc0')); } }
  if (!hip && room() > 120) { const rs = F.rects.filter(r => r[2] - r[0] > 4 && r[3] - r[1] > 4), nA = Math.min(8, Math.floor(F.area / 70));
    for (let i = 0; i < nA && rs.length && room() > 60; i++) { const r = pick(R, rs); acU(B, rnd(R, r[0] + 1, r[2] - 1), rnd(R, r[1] + 1, r[3] - 1), H + 0.05, R() < 0.5 ? 0 : Math.PI / 2); }
    if (L.tank && rs.length && room() > 80) { const r = rs[0], cx = rnd(R, r[0] + 2, r[2] - 2), cz = rnd(R, r[1] + 2, r[3] - 2); B.box('c', cx - 1.3, cz - 1.0, cx + 1.3, cz + 1.0, H + 0.05, H + 0.9, [0.5, 0.5, 0.5]); B.box('c', cx - 1.2, cz - 0.9, cx + 1.2, cz + 0.9, H + 0.9, H + 2.4, [0.84, 0.83, 0.78]); } }
  { let nAC = 0, nL = 0;
    for (let k = 1; k < fl && room() > 80; k++) for (const e of bes) { const nb = Math.max(1, Math.round(e.L / uw)), bw2 = e.L / nb, [s0, s1] = span(e, bd), y = yOf(k);
      for (let i = 0; i < nb && room() > 80; i++) { const q0 = i * bw2, q1 = q0 + bw2; if (q0 < s0 - 0.1 || q1 > s1 + 0.1) continue;
        if (R() < 0.45 && nAC < 24) { const c = ept(e, q0 + bw2 * 0.78, 0.35); acU(B, c[0], c[1], y + 0.02, angOf([e.bx - e.ax, e.bz - e.az]) + Math.PI); nAC++; }
        if (R() < 0.18 && nL < 10) { const off = bd * 0.62, yp = y + 1.7; let q = q0 + 0.6; for (let j = 0; j < 4 && q < q1 - 1.4; j++) { const w = rnd(R, 0.3, 0.6), h = rnd(R, 0.4, 0.8), c = ept(e, q, off), d = ept(e, q + w, off);
          B.quad('c', [d[0], yp - h, d[1]], [c[0], yp - h, c[1]], [c[0], yp, c[1]], [d[0], yp, d[1]], [e.nx, 0, e.nz], pick(R, ['#f3f2ee', '#e9ecef', '#9fb3c8', '#c9c3b8', '#5a6a80', '#d9b8b8'])); q += w + 0.15; } nL++; } } } }
}
const MLOOK = [
  { n: '茶色のタイル・腰壁', wf: 'tile', wc: '#a2826a', rl: 'solid', rlc: '#a2826a', sc: '#d8d2c8', acc: '#4e4a46' },
  { n: '白い外壁・ガラス手すり', wf: 'paint', wc: '#f2f0eb', em: 'stucco', rl: 'glass', sc: '#e9e7e2', acc: '#5c5f62' },
  { n: 'ベージュのタイル', wf: 'tile', wc: '#e4d6bf', rl: 'bar', rlc: '#cdd1d4', sc: '#e6dfd2', acc: '#6a5f52' },
  { n: '打ちはなし・ガラス', wf: 'conc', wc: '#ffffff', rl: 'glass', sc: '#c8c6c0', acc: '#3a3b3d' },
  { n: 'グレーのタイル・寄棟', wf: 'tile', wc: '#bdbcb7', rl: 'solid', rlc: '#bdbcb7', rf: 'hip', rm: 'slate', rcol: '#4b4e54', sc: '#d0cfca' },
  { n: 'レンガ色・洋瓦', wf: 'tile', wc: '#b47862', rl: 'solid', rlc: '#efe6d6', rf: 'hip', rm: 'yogawara', rcol: '#ffffff', sc: '#e9e0d0' },
  { n: '白とグレー・格子', wf: 'paint', wc: '#efefeb', em: 'stucco', rl: 'bar', rlc: '#5d6166', sc: '#d6d6d3', acc: '#8d9196' },
  { n: '黒いタイル・木目', wf: 'tile', wc: '#5f5d5a', rl: 'glass', sc: '#6a6865', acc: '#a57e58' },
  { n: 'クリーム色・アルミ', wf: 'paint', wc: '#f0e6d0', em: 'stucco', rl: 'bar', rlc: '#dadde0', sc: '#e9e2d0', tank: true },
  { n: '石張り・高級', wf: 'stone', wc: '#e8e2d5', rl: 'glass', sc: '#e2ddd2', acc: '#4a4846' },
  { n: 'こげ茶タイル・ガラス', wf: 'tile', wc: '#735a49', rl: 'glass', sc: '#cfc8bc', acc: '#3d3a37' },
  { n: 'ライトグレー・パネル', wf: 'paint', wc: '#d4d5d3', em: 'stucco', rl: 'frost', rlc: '#eef0f1', sc: '#d8d8d6' },
  { n: '白タイル・紺の手すり', wf: 'tile', wc: '#f1f0ec', rl: 'bar', rlc: '#3e4a5e', sc: '#e4e3df', acc: '#3e4a5e' },
  { n: '石とガラス・植栽', wf: 'stone', wc: '#dcd5c7', rl: 'glass', sc: '#d6d0c4', acc: '#5a5048' },
  { n: 'クリームと洋瓦', wf: 'paint', wc: '#f0e4cf', em: 'stucco', rl: 'solid', rlc: '#f0e4cf', rf: 'hip', rm: 'yogawara', rcol: '#ffffff', sc: '#e6dccb' },
  { n: '濃いグレー・たて格子', wf: 'conc', wc: '#85878a', rl: 'bar2', rlc: '#2d2f31', sc: '#7a7c7e', acc: '#2d2f31' },
  { n: '赤茶のタイル・古め', wf: 'tile', wc: '#93604c', rl: 'solid', rlc: '#93604c', sc: '#d2cbc0', tank: true },
  { n: '木と白・テラス', wf: 'paint', wc: '#f3f2ee', em: 'stucco', rl: 'glass', sc: '#e8e6e1', acc: '#b38b62' },
];
const mansFar = (L, P) => { const shop = !!((P.ko && P.ko.shop) || (P.pr && P.pr.g1)), fl = Math.max(1, P.f || 4), H = MB + (shop ? 4.2 : MF) + (fl - 1) * MF, hip = L.rf === 'hip' && fl <= 6;
  return { H: H + (hip ? 0 : 0.9), base: 0, wall: FARM, bw: MW, fh: MF, tb: 2, tf: 2, roof: null, rc: hip ? roofAvg(L.rm || 'slate', L.rcol) : [0.66, 0.66, 0.64], rt: hip ? 'hip' : 'flat', p: 0.38, ins: 1.8, wc: L.wf === 'conc' ? wallAvg('conc', L.wc) : col(L.wc || '#e8e2d6') }; };
A.arch('h_mansion', { looks: MLOOK, build: mansionBuild, far: mansFar });
const ML = idx => idx.map(i => MLOOK[i]);

/* ---------- 長屋・テラスハウス・商店長屋・町家・看板建築 ----------
   区画の 道がわに 1棟。戸（はば uw）ごとに 玄関・窓・ベランダ。P.ko.st：terrace・nagaya・shoten（1階がお店）・machiya・kanban・shop */
const KANBAN = TX('kanban', 128, 128, (g, w, h, R) => {   // 看板建築の 銅板（網代と青海波の もよう。そめる）
  PT.fill(g, 0, 0, w, h, '#e9ece9');
  const n = 8, s2 = w / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = i * s2, y = j * s2, hz = (i + j) % 2 === 0; g.fillStyle = 'rgba(0,0,0,.14)';
    for (let k = 1; k < 4; k++) { if (hz) g.fillRect(x, y + s2 * k / 4, s2, Math.max(1, s2 * 0.06)); else g.fillRect(x + s2 * k / 4, y, Math.max(1, s2 * 0.06), s2); } }
  g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = Math.max(1, w / 128);
  for (let i = -1; i < 5; i++) for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(i * w / 4 + w / 8, h * 0.06, w / 8 * r / 3, Math.PI, 0); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, h * 0.065, w, Math.max(1, h / 100));
  PT.noise(g, 0, 0, w, h, 0.04, R);
});
function rowBuild(B, L, P) {
  const O = P.ko || {}, R = P.rng, lod = P.lod, nv0 = B.nv, st = O.st || 'terrace';
  let cap = 0; const room = () => cap - (B.nv - nv0);
  const fl = clamp(P.f || 2, 1, 3), F0 = P.F, fe = A.frontEdge(F0, P.front), n = [Math.round(fe.nx), Math.round(fe.nz)];
  const LR = A.rin(mainRect(F0, fe), 0.05), fr = frame(LR, n), lot = A.inset(F0, 0.05), W = fr.W, D = fr.D;
  const shopG = st === 'shoten' || st === 'machiya' || st === 'kanban' || st === 'shop', mach = st === 'machiya', kan = st === 'kanban';
  const fs = O.fs != null ? O.fs : st === 'terrace' ? clamp(D - 9.8, 1.2, 5.6) : st === 'nagaya' ? 0.9 : 0.2;
  const md = Math.max(4, Math.min(D - fs - 0.6, O.md || (st === 'terrace' ? 9.1 : 8.6))), u0 = st === 'terrace' || st === 'nagaya' ? 0.45 : 0.12, u1 = W - u0;
  const base = shopG ? 0.15 : HB, g1 = shopG ? (mach ? 3.4 : 3.7) : FH, fh = mach ? 2.4 : FH, yOf = k => base + (k === 0 ? 0 : g1 + (k - 1) * fh), H = yOf(fl);
  const uw = O.uw || L.uw || 5.6, nu = Math.max(1, Math.round((u1 - u0) / uw)), uw2 = (u1 - u0) / nu;
  cap = [Math.min(300, 60 + 12 * nu), Math.min(1000, 200 + 70 * nu), Math.min(3400, 500 + 260 * nu)][clamp(lod, 0, 2)];
  const M = fr.rect(u0, fs, u1, fs + md), es = redges(M), fe0 = es.find(e => e.nx * n[0] + e.nz * n[1] > 0.5), be = es.find(e => e.nx * n[0] + e.nz * n[1] < -0.5);
  const wm = MAT[L.w] || MAT.siding, wc = col(L.wc || '#efede8'), wm2 = L.w2 ? MAT[L.w2] : wm, wc2 = col(L.wc2 || L.wc || '#efede8'), rm = RMAT[L.rm] || RMAT.slate, rc = L.rc || '#4b4e54', frI = L.fr || 0, wst = L.wst;
  const alongX = Math.abs(fr.du[0]) > 0.5, rt = L.rf || 'gable', flat = rt === 'flat', ph = flat ? 0.6 : 0, kanT = kan ? H + 1.3 : H;
  // 戸ごとの 区間（道がわの辺の s）：fe0 の s は u の向きか 逆か
  const sOf = u => proj(fe0, ...fr.P(u, fs)), su0 = sOf(u0), sgn = sOf(u0 + 1) > su0 ? 1 : -1, unitS = i => { const a = sOf(u0 + i * uw2), b = sOf(u0 + (i + 1) * uw2); return [Math.min(a, b), Math.max(a, b)]; };
  const ucol = i => L.alt ? col(L.alt[i % L.alt.length]) : null;
  if (lod <= 0) {   // 遠く：箱と屋根
    const yb = P.yb < -0.5 ? P.yb : 0;
    const fwc = kan ? col(L.wc2 || L.wc) : wallAvg(L.w2 || L.w, L.wc2 || L.wc); for (const e of es) B.wall(FAR1, e.ax, e.az, e.bx, e.bz, yb, kanT + ph, fwc, [0, Math.max(1, Math.round(e.L / 4.2)) / 2, (yb - base) / fh / 2, (H - base) / fh / 2], 0.85);
    if (flat || kan) B.flat('c', M, kanT + ph - 0.1, [0.7, 0.7, 0.68]);
    if (!flat) roof1(B, { t: rt === 'gables' ? 'gable' : rt === 'shed' ? 'gable' : 'gable', r: M, y: H, p: L.p || 0.45, oh: 0.4, th: 0, ax: alongX ? 'x' : 'z', m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: 'c', cg: mul(wc2, 0.92) });
    return;
  }
  // 地面・基礎
  B.cap(GND[L.gd || (st === 'terrace' ? 'gravel' : 'conc')], lot, 0.03, WH, { su: 3 });
  if (st === 'terrace' && fs >= 4.8) for (let i = 0; i < nu; i++) { const r = fr.rect(u0 + i * uw2 + 0.25, 0.1, u0 + (i + 1) * uw2 - 0.25, fs - 0.2); B.flat(GND.conc, r, 0.07, WH, { su: 4 }); }
  if (lod >= 2 || P.yb < -0.5) B.plinth(rectF(M), P.yb, base + 0.005, [0.68, 0.67, 0.64]);
  // 壁：1階と 2階より上（交互の色の 戸は 戸ごと）
  const ym = yOf(1);
  for (const e of es) { const isF = e === fe0, isB = e === be, split = (isF || isB) && L.alt;
    const parts = split ? Array.from({ length: nu }, (_, i) => { const [a, b] = unitS(i); return isF ? [a, b, i] : [e.L - b, e.L - a, i]; }) : [[0, e.L, -1]];
    for (const [s0, s1, i] of parts) { const a = ept(e, s0), b = ept(e, s1), c1 = i >= 0 ? ucol(i) : wc, c2 = i >= 0 ? ucol(i) : wc2, top = isF && kan ? kanT : H;
      if (fl === 1 || (wm === wm2 && !L.w2 && !kan)) B.wall(wm.k, a[0], a[1], b[0], b[1], base, top + ph, c2, [s0 / wm.su, s1 / wm.su, base / wm.sv, (top + ph) / wm.sv], 0.85);
      else { B.wall(wm.k, a[0], a[1], b[0], b[1], base, ym, c1, [s0 / wm.su, s1 / wm.su, base / wm.sv, ym / wm.sv], 0.85);
        const m2 = isF && kan ? KANBAN : wm2.k, s2u = isF && kan ? 2.4 : wm2.su, s2v = isF && kan ? 2.4 : wm2.sv;
        B.wall(m2, a[0], a[1], b[0], b[1], ym, top + ph, c2, [s0 / s2u, s1 / s2u, ym / s2v, (top + ph) / s2v]); } } }
  // 屋根
  if (flat) { const FM = footR([M]); flatTop(B, FM, H, ph, wm2, L.wc2 || L.wc, lod, null); }
  else if ((rt === 'gables' || rt === 'shed') && (lod >= 2 || nu <= 6)) for (let i = 0; i < nu; i++) { const r = fr.rect(u0 + i * uw2, fs, u0 + (i + 1) * uw2, fs + md);
    roof1(B, { t: rt === 'shed' ? 'shed' : 'gable', r, y: H, p: L.p || 0.5, oh: 0.3, th: lod >= 2 ? 0.12 : 0, ax: alongX ? 'z' : 'x', hi: rt === 'shed' ? ((alongX ? n[0] : n[1]) > 0 ? '-' : '+') : undefined, m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: wm2.k, cg: ucol(i) || wc2, gsu: wm2.su, gsv: wm2.sv, cf: col(L.fc || '#3a3b3e'), cr: mul(roofAvg(L.rm, rc), 0.85) }); }
  else roof1(B, { t: rt === 'gables' || rt === 'shed' ? 'gable' : rt, r: M, y: H, p: L.p || 0.45, oh: L.oh == null ? 0.45 : L.oh, th: lod >= 2 ? 0.15 : 0, ax: alongX ? 'x' : 'z', m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: wm2.k, cg: wc2, gsu: wm2.su, gsv: wm2.sv, cf: col(L.fc || '#3a3b3e'), cr: mul(roofAvg(L.rm, rc), 0.85) });
  if (kan && lod >= 1) { slab(B, fe0, 0, fe0.L, 0.35, kanT - 0.1, kanT + 0.15, 'c', mul(wc2, 0.85), 1, 1, lod < 2); slab(B, fe0, 0, fe0.L, 0.18, ym + 0.05, ym + 0.3, 'c', mul(wc2, 0.85), 1, 1, true); }
  // 町家：1階の上の 一文字の ひさし（瓦）
  if (mach || st === 'shoten' || st === 'nagaya') { const y = ym + (mach ? 0.25 : 0.1), d = mach ? 0.95 : 0.75, a = ept(fe0, 0), b = ept(fe0, fe0.L), a2 = ept(fe0, 0, d), b2 = ept(fe0, fe0.L, d), rk = mach || L.rm === 'kawara' ? RMAT.kawara.k : rm.k;
    B.quad(rk, [a2[0], y, a2[1]], [b2[0], y, b2[1]], [b[0], y + d * 0.45, b[1]], [a[0], y + d * 0.45, a[1]], null, mach ? '#8a9098' : rc, [0, 0, fe0.L / 2.4, d / 2.4]); }
  // 戸ごとの 玄関・窓・ベランダ（道がわ）・うらの窓
  const winsF = [];
  for (let i = 0; i < nu; i++) { const [s0, s1] = unitS(i), mir = (i % 2 === 1) !== (sgn < 0), w = s1 - s0, dS = mir ? s1 - 0.75 : s0 + 0.75;
    if (shopG) { const sh = mach ? null : MSHOP;
      if (mach) { panel(B, WIN, fe0, dS, 1.4, base + 0.02, base + 2.2, wuv(4, 5), 0.06); const gs0 = mir ? s0 + 0.2 : s0 + 1.6, gs1 = mir ? s1 - 1.6 : s1 - 0.2; if (gs1 - gs0 > 0.6) panel(B, WIN, fe0, (gs0 + gs1) / 2, gs1 - gs0, base + 0.35, base + 2.4, wuv(1, 7), 0.06, L.lat ? col(L.lat) : WH); }
      else panel(B, sh, fe0, (s0 + s1) / 2, w - 0.3, base + 0.02, ym - 0.35, [0, 0.03, 0.5, 0.97], 0.06);
      if (!mach && lod >= 2 && room() > 200 && R() < 0.7) { const a = ept(fe0, s0 + 0.2), b = ept(fe0, s1 - 0.2), a2 = ept(fe0, s0 + 0.2, 1.1), b2 = ept(fe0, s1 - 0.2, 1.1), ac = pick(R, [[0.55, 0.32, 0.25], [0.32, 0.4, 0.33], [0.62, 0.58, 0.5], [0.3, 0.36, 0.45], [0.5, 0.45, 0.38]]); B.quad('c', [a2[0], ym - 1.0, a2[1]], [b2[0], ym - 1.0, b2[1]], [b[0], ym - 0.45, b[1]], [a[0], ym - 0.45, a[1]], null, ac); } }
    else { panel(B, WIN, fe0, dS, 1.0, base + 0.02, base + 2.2, (L.dr || 0) < 8 ? wuv(L.dr || 0, 5) : wuv((L.dr || 0) - 4, 6), 0.08); const ws = mir ? s0 + (w - 1.5) / 2 : s1 - (w - 1.5) / 2; if (w > 3.4) winsF.push([fe0, ws, 'H2', 0]);
      const cc = L.fc ? col(L.fc) : [0.36, 0.36, 0.37], a = ept(fe0, dS - 0.7), b = ept(fe0, dS + 0.7); B.quad('c', [a[0] + fe0.nx * 0.8, base + 2.45, a[1] + fe0.nz * 0.8], [b[0] + fe0.nx * 0.8, base + 2.45, b[1] + fe0.nz * 0.8], [b[0], base + 2.55, b[1]], [a[0], base + 2.55, a[1]], null, cc); }
    for (let k = 1; k < fl; k++) { const y = yOf(k);
      if (mach) { for (const q of [0.3, 0.7]) panel(B, WIN, fe0, s0 + w * q, Math.min(1.6, w * 0.32), y + 0.55, y + 1.65, wuv(2, 7), 0.06); continue; }
      if (k === 1 && st === 'terrace' && L.bal !== 'none' && w > 3.6) { const b0 = s0 + 0.35, b1 = s1 - 0.35, dep = 0.85; slab(B, fe0, b0, b1, dep, y - 0.18, y, 'c', [0.74, 0.74, 0.72], 1, 1, lod < 2);
        if (L.bal === 'glass') band(B, GLS, fe0, b0, b1, dep, y, 1.05, [0.52, 0.98], 2); else band(B, RAIL, fe0, b0, b1, dep, y, 1.05, RB(0), 1.6, col(FRC[frI]));
        winsF.push([fe0, (s0 + s1) / 2, 'K', k]);
        if (lod >= 2 && R() < 0.45) { const off = dep * 0.6, yp = y + 1.55; let q = b0 + 0.3; for (let j = 0; j < 4 && q < b1 - 0.7; j++) { const ww = rnd(R, 0.3, 0.6), hh = rnd(R, 0.4, 0.8), c = ept(fe0, q, off), d = ept(fe0, q + ww, off); B.quad('c', [d[0], yp - hh, d[1]], [c[0], yp - hh, c[1]], [c[0], yp, c[1]], [d[0], yp, d[1]], [fe0.nx, 0, fe0.nz], pick(R, ['#f3f2ee', '#e9ecef', '#9fb3c8', '#c9c3b8', '#5a6a80'])); q += ww + 0.15; } } }
      else { winsF.push([fe0, s0 + w * 0.3, kan && wst !== 'yo' ? 'H2' : 'H', k]); if (w > 3.8) winsF.push([fe0, s0 + w * 0.75, 'H2', k]); } }
    if (be) { const bs0 = be.L - s1, bs1 = be.L - s0; winsF.push([be, bs0 + (bs1 - bs0) * 0.35, st === 'terrace' ? 'K' : 'H', 0]); for (let k = 1; k < fl; k++) winsF.push([be, bs0 + (bs1 - bs0) * (k % 2 ? 0.6 : 0.4), 'H', k]); }
  }
  for (const [e, s, t, k] of winsF) { if (room() < 20) break; const WTX = WTS[wst] || WT, [ww, wh, sill] = WTX[t], y0 = yOf(k) + sill, y1 = Math.min(y0 + wh, yOf(k + 1) - 0.2); if (y1 - y0 < 0.3) continue; panel(B, WIN, e, s, ww, y0, y1, winUV(t, frI, R, wst), 0.08); }
  // 端の壁の 小窓
  if (lod >= 2) for (const e of es) if (e !== fe0 && e !== be) for (let k = 0; k < fl && room() > 40; k++) if (R() < 0.6) panel(B, WIN, e, e.L * rnd(R, 0.3, 0.7), 0.6, yOf(k) + 1.2, yOf(k) + 1.95, winUV('S', frI, R), 0.08);
  if (lod < 2) return;
  // ---------- 近く：戸の さかいの 袖かべ・前庭の 車・自転車・鉢植え・室外機
  for (let i = 1; i < nu && st === 'terrace'; i++) { const [s0] = unitS(i), a = ept(fe0, s0), b = ept(fe0, s0, 0.35); B.wall('c', a[0], a[1], b[0], b[1], base, H - 0.1, mul(wc2, 0.9)); }
  for (let i = 0; i < nu && room() > 120; i++) { const [s0, s1] = unitS(i), mir = (i % 2 === 1) !== (sgn < 0);
    if (st === 'terrace' && fs >= 4.8 && R() < 0.75) { const c = ept(fe0, (s0 + s1) / 2 + (mir ? -0.4 : 0.4), fs / 2 + 0.1); car(B, c[0], c[1], angOf([fe0.nx, fe0.nz]) + (R() < 0.5 ? 0 : Math.PI), R, R() < 0.6 ? 0 : 1); }
    else if (R() < 0.5) { const c = ept(fe0, mir ? s0 + 0.9 : s1 - 0.9, 0.45), ex = (fe0.bx - fe0.ax) / fe0.L, ez = (fe0.bz - fe0.az) / fe0.L, vb2 = RB(7), k2 = R() < 0.5 ? 0 : 0.5; B.quad(RAIL, [c[0] - fe0.nx * 0.85, 0.05, c[1] - fe0.nz * 0.85], [c[0] + fe0.nx * 0.85, 0.05, c[1] + fe0.nz * 0.85], [c[0] + fe0.nx * 0.85, 1.08, c[1] + fe0.nz * 0.85], [c[0] - fe0.nx * 0.85, 1.08, c[1] - fe0.nz * 0.85], [ex, 0, ez], WH, [k2, vb2[0], k2 + 0.5, vb2[1]]); }
    if ((st === 'nagaya' || mach) && R() < 0.7) for (let j = 0; j < 3; j++) { const c = ept(fe0, s0 + 0.4 + j * 0.45, 0.25); shrub(B, c[0], c[1], 0.3, 0.22, '#55783f'); B.box('c', c[0] - 0.15, c[1] - 0.15, c[0] + 0.15, c[1] + 0.15, 0.03, 0.32, [0.55, 0.42, 0.32]); }
    if (be && R() < 0.6) { const c = ept(be, be.L - (s0 + s1) / 2, 0.3); acU(B, c[0], c[1], 0.05, angOf([be.bx - be.ax, be.bz - be.az]) + Math.PI); }
  }
  // 区画の ふち（テラスハウスは 低い塀）
  if (st === 'terrace' && room() > 60) for (const e of lot.edges) { if (e.nx * n[0] + e.nz * n[1] > 0.5) continue; if (room() < 20) break; fence(B, e, 0.05, e.L - 0.05, L.fen || 'blockf', false, L, R); }
  if (st === 'terrace' && fs >= 4.8 && room() > 40) for (let i = 1; i < nu; i++) { const [s0] = unitS(i), a = ept(fe0, s0, 0.3), b = ept(fe0, s0, fs - 0.3); bandP(B, EXT, a, b, 0, 0.6, EB(0), 1.6); }
}
const LOOK_TERR = [
  { n: '白い外壁・切妻', w: 'siding', wc: '#f2f1ec', rf: 'gable', rm: 'slate', rc: '#3b3d42', fc: '#3a3b3e', fr: 0, bal: 'alu', dr: 0, fen: 'blockf' },
  { n: 'ベージュ・妻入り', w: 'tile', wc: '#e6d9c4', rf: 'gables', rm: 'slate', rc: '#5e4a3c', p: 0.55, fc: '#4a3a2e', fr: 1, bal: 'alu', dr: 0, fen: 'block' },
  { n: 'グレー・陸屋根', w: 'stucco', wc: '#c9c9c6', rf: 'flat', fr: 2, bal: 'glass', dr: 2, fen: 'slat', fenc: '#2f3032' },
  { n: 'レンガ調・洋風', w: 'brick', wc: '#ffffff', w2: 'siding', wc2: '#efe7da', rf: 'gable', rm: 'slate', rc: '#6a4e3d', fc: '#f0ece4', fr: 3, bal: 'alu', dr: 6, fen: 'brick' },
  { n: 'こげ茶の板・のこぎり屋根', w: 'board', wc: '#5a4636', w2: 'siding', wc2: '#efede8', rf: 'shed', rm: 'seam', rc: '#3a3b3e', p: 0.35, fc: '#2f3032', fr: 2, bal: 'alu', dr: 1, fen: 'slat' },
  { n: '戸ごとに ちがう色', w: 'siding', wc: '#efede8', alt: ['#f2f1ec', '#c9d3d8', '#e6dcc6', '#d6d0c8'], rf: 'gables', rm: 'slate', rc: '#45484d', p: 0.55, fc: '#3a3b3e', fr: 0, bal: 'alu', dr: 2, fen: 'blockf' },
  { n: '南欧風・洋瓦', w: 'stucco', wc: '#efe2c6', rf: 'gable', rm: 'yogawara', rc: '#ffffff', p: 0.38, fc: '#e9e1cf', fr: 3, bal: 'alu', dr: 3, fen: 'brick', gd: 'lawn' },
  { n: '黒いガルバと木', w: 'galva', wc: '#3a3c40', w2: 'board', wc2: '#b08a63', rf: 'flat', fr: 2, bal: 'glass', dr: 1, fen: 'slat', fenc: '#2c2d2f' },
  { n: '和風・いぶし瓦', w: 'board', wc: '#4a3b2f', w2: 'stucco', wc2: '#ece6da', rf: 'gable', rm: 'kawara', rc: '#959ca5', p: 0.45, oh: 0.6, fc: '#3c3632', fr: 1, bal: 'alu', dr: 4, fen: 'wood' },
  { n: '白いタイル・ガラス', w: 'tile', wc: '#f1f0ec', rf: 'flat', fr: 0, bal: 'glass', dr: 2, fen: 'blockf' },
];
const LOOK_NAGA = [
  { n: '板ばりの長屋', w: 'board', wc: '#5d4b3b', rf: 'gable', rm: 'seam', rc: '#5b5f63', p: 0.4, fc: '#3a3330', fr: 1, bal: 'none', dr: 4, uw: 4.5 },
  { n: 'トタンの長屋', w: 'galva', wc: '#8e8a82', rf: 'gable', rm: 'seam', rc: '#7a4a3a', p: 0.35, fc: '#5a4a3e', fr: 0, bal: 'none', dr: 5, uw: 4.5 },
  { n: 'しっくいと瓦の長屋', w: 'board', wc: '#4e3f32', w2: 'stucco', wc2: '#ece6da', rf: 'gable', rm: 'kawara', rc: '#8f969f', p: 0.45, fc: '#3c3632', fr: 1, bal: 'none', dr: 4, uw: 4.5, wst: 'wa' },
  { n: 'モルタル・瓦の長屋', w: 'stucco', wc: '#c9c5bc', rf: 'gable', rm: 'kawara', rc: '#7e848c', p: 0.45, fc: '#4a4642', fr: 0, bal: 'none', dr: 5, uw: 4.5 },
];
const LOOK_SHOTEN = [
  { n: 'モルタルの商店長屋', w: 'stucco', wc: '#cfcbc2', rf: 'gable', rm: 'kawara', rc: '#7e848c', p: 0.42, fc: '#4a4642', fr: 0, dr: 5, uw: 5.4 },
  { n: 'タイルの商店長屋', w: 'tile', wc: '#d9cbb3', rf: 'gable', rm: 'slate', rc: '#4b4e54', fc: '#3a3b3e', fr: 1, dr: 5, uw: 5.4 },
  { n: '木造の商店長屋', w: 'board', wc: '#5e4b3b', w2: 'stucco', wc2: '#e9e3d6', rf: 'gable', rm: 'kawara', rc: '#8b9199', p: 0.45, fc: '#3c3632', fr: 1, dr: 4, uw: 5.4, wst: 'wa' },
  { n: 'トタン屋根の商店', w: 'siding', wc: '#e0dcd2', rf: 'gable', rm: 'seam', rc: '#6a5a4a', p: 0.35, fc: '#4a3e34', fr: 0, dr: 5, uw: 5.4 },
];
const LOOK_MACHI = [
  { n: '京町家・格子', w: 'board', wc: '#3e332b', w2: 'stucco', wc2: '#e9e2d4', rf: 'gable', rm: 'kawara', rc: '#8a9098', p: 0.42, oh: 0.6, fc: '#2e2a27', fr: 1, wst: 'wa', uw: 5 },
  { n: '白しっくいの町家', w: 'stucco', wc: '#f1ede4', w2: 'stucco', wc2: '#f1ede4', rf: 'gable', rm: 'kawara', rc: '#959ca5', p: 0.42, oh: 0.6, fc: '#3a332d', fr: 1, wst: 'wa', uw: 5 },
  { n: 'ベンガラ格子の町家', w: 'board', wc: '#5a3a2e', w2: 'stucco', wc2: '#dfd3bd', rf: 'gable', rm: 'kawara', rc: '#7f858d', p: 0.42, oh: 0.6, fc: '#3a2a22', fr: 1, wst: 'wa', lat: '#c07a62', uw: 5 },
  { n: '虫籠窓の町家', w: 'board', wc: '#2f2a26', w2: 'stucco', wc2: '#cfc3ab', rf: 'gable', rm: 'kawara', rc: '#71777f', p: 0.42, oh: 0.6, fc: '#2a2522', fr: 1, wst: 'wa', uw: 5 },
];
const LOOK_KANBAN = [
  { n: '銅板の看板建築', w: 'stucco', wc: '#c9c5bc', wc2: '#7aa392', rf: 'gable', rm: 'seam', rc: '#5b5f63', p: 0.4, fr: 0, wst: 'yo', uw: 5.4 },
  { n: 'モルタルの看板建築', w: 'stucco', wc: '#cfcbc2', wc2: '#bdb8ae', rf: 'gable', rm: 'seam', rc: '#5b5f63', p: 0.4, fr: 0, wst: 'yo', uw: 5.4 },
  { n: 'タイルの看板建築', w: 'stucco', wc: '#cfcbc2', wc2: '#d7c3a6', rf: 'gable', rm: 'kawara', rc: '#7e848c', p: 0.4, fr: 1, uw: 5.4 },
  { n: 'クリーム色の洋風', w: 'stucco', wc: '#d9d3c4', wc2: '#ece2c8', rf: 'gable', rm: 'slate', rc: '#4b4e54', p: 0.4, fr: 3, wst: 'yo', uw: 5.4 },
];
const rowFar = (L, P) => { const st = (P.ko && P.ko.st) || 'terrace', shop = st !== 'terrace' && st !== 'nagaya', fl = clamp(P.f || 2, 1, 3), H = (shop ? 0.15 + (st === 'machiya' ? 3.4 : 3.7) + (fl - 1) * (st === 'machiya' ? 2.4 : FH) : HB + fl * FH) + (st === 'kanban' ? 1.3 : 0);
  return { H, base: 0, wall: FAR1, bw: 4.2, fh: FH, tb: 2, tf: 2, roof: null, rc: roofAvg(L.rm || 'slate', L.rc), rt: L.rf === 'flat' || st === 'kanban' ? 'flat' : 'gable', p: L.p || 0.45, ins: 0.8, wc: st === 'kanban' ? col(L.wc2 || L.wc) : wallAvg(L.w2 || L.w, L.wc2 || L.wc) }; };
A.arch('h_row', { looks: LOOK_TERR, build: rowBuild, far: rowFar });

/* ---------- アパート（木造・鉄骨の 2〜4階）----------
   外廊下（鉄の手すり・はしの鉄骨階段）に ドア・メーター・面格子の窓がならび、反対がわに ベランダ。屋根は 切妻・寄棟・平ら */
function apartBuild(B, L, P) {
  const O = P.ko || {}, R = P.rng, lod = P.lod, nv0 = B.nv, vb = O.vb || [90, 480, 1700], cap = vb[clamp(lod, 0, 2)], room = () => cap - (B.nv - nv0);
  const fl = clamp(P.f || 2, 1, 4), F0 = P.F, fe = A.frontEdge(F0, P.front), n = [Math.round(fe.nx), Math.round(fe.nz)];
  const LR = A.rin(mainRect(F0, fe), 0.05), fr = frame(LR, n), lot = A.inset(F0, 0.05), W = fr.W, D = fr.D;
  const md = Math.min(O.md || 8.2, D - 2.2), sw = 2.2, uw = O.uw || L.uw || 5.0;
  const parkF = D - md - 1.2 >= 5.6, fs = parkF ? D - md - 1.0 : Math.max(1.0, (D - md) / 2), corrF = n[1] < 0.5 || R() < 0.3;   // 南の道なら ベランダが道がわ
  const u0 = 0.9 + (R() < 0.5 ? sw : 0), u1 = Math.min(W - 0.9, u0 + Math.max(uw, W - 1.8 - sw)), stairL = u0 > 1.5;
  const M = fr.rect(u0, fs, u1, fs + md), es = redges(M), fe0 = es.find(e => e.nx * n[0] + e.nz * n[1] > 0.5), be = es.find(e => e.nx * n[0] + e.nz * n[1] < -0.5);
  const ce = corrF ? fe0 : be, ba = corrF ? be : fe0, base = 0.4, fh = 2.75, yOf = k => base + k * fh, H = yOf(fl);
  const wm = MAT[L.w] || MAT.siding, wc = col(L.wc || '#e6dcc8'), wm2 = L.w2 ? MAT[L.w2] : wm, wc2 = col(L.wc2 || L.wc || '#e6dcc8'), rm = RMAT[L.rm] || RMAT.slate, rc = L.rc || '#5a4a3e', frI = L.fr || 0;
  const rt = L.rf || 'gable', flat = rt === 'flat', alongX = Math.abs(fr.du[0]) > 0.5, stc = col(L.stc || '#c9c2b4');
  const nu = Math.max(1, Math.round(ce.L / uw)), uw2 = ce.L / nu;
  if (lod <= 0) { const yb = P.yb < -0.5 ? P.yb : 0;
    const fwc = wallAvg(L.w2 || L.w, L.wc2 || L.wc); for (const e of es) B.wall(FAR1, e.ax, e.az, e.bx, e.bz, yb, H + (flat ? 0.6 : 0), fwc, [0, Math.max(1, Math.round(e.L / 4.2)) / 2, (yb - base) / fh / 2, (H - base) / fh / 2], 0.85);
    if (flat) B.flat('c', M, H + 0.5, [0.7, 0.7, 0.68]); else roof1(B, { t: rt, r: M, y: H, p: L.p || 0.42, oh: 0.4, th: 0, ax: alongX ? 'x' : 'z', m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: 'c', cg: mul(wc2, 0.92) });
    return; }
  // 地面（駐車場は アスファルト色の 土間）
  B.cap(GND.gravel, lot, 0.03, WH, { su: 3 });
  const pk = parkF ? fr.rect(0.4, 0.1, W - 0.4, fs - 0.5) : null;
  if (pk) B.flat(GND.conc, pk, 0.06, [0.78, 0.78, 0.78], { su: 4 });
  if (lod >= 2 || P.yb < -0.5) B.plinth(rectF(M), P.yb, base + 0.005, [0.68, 0.67, 0.64]);
  // 壁
  for (const e of es) { const two = L.w2 && fl >= 2; if (!two) B.wall(wm.k, e.ax, e.az, e.bx, e.bz, base, H + (flat ? 0.6 : 0), wc, [0, e.L / wm.su, base / wm.sv, (H + (flat ? 0.6 : 0)) / wm.sv], 0.85);
    else { B.wall(wm.k, e.ax, e.az, e.bx, e.bz, base, yOf(1), wc, [0, e.L / wm.su, base / wm.sv, yOf(1) / wm.sv], 0.85); B.wall(wm2.k, e.ax, e.az, e.bx, e.bz, yOf(1), H + (flat ? 0.6 : 0), wc2, [0, e.L / wm2.su, yOf(1) / wm2.sv, (H + (flat ? 0.6 : 0)) / wm2.sv]); } }
  if (flat) flatTop(B, footR([M]), H, 0.6, wm2, L.wc2 || L.wc, lod, null);
  else roof1(B, { t: rt, r: M, y: H, p: L.p || 0.42, oh: 0.45, th: lod >= 2 ? 0.15 : 0, ax: alongX ? 'x' : 'z', m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: wm2.k, cg: wc2, gsu: wm2.su, gsv: wm2.sv, cf: col(L.fc || '#e8e4dc'), cr: mul(roofAvg(L.rm, rc), 0.85) });
  // 外廊下（2階より上）と 鉄骨階段
  const cd = 1.15;
  for (let k = 1; k < fl; k++) { const y = yOf(k); slab(B, ce, 0, ce.L, cd, y - 0.2, y, 'c', stc, 1, 1, lod < 2);
    if (L.crs) slab(B, ce, 0, ce.L, cd, y, y + 1.05, wm2.k, wc2, wm2.su, wm2.sv, true); else band(B, RAIL, ce, 0, ce.L, cd, y, 1.05, RB(1), 1.4, stc);
    if (lod >= 2) for (let q = 0.1; q < ce.L; q += Math.max(2.5, ce.L / Math.ceil(ce.L / 4))) { const c = ept(ce, Math.min(q, ce.L - 0.1), cd - 0.06); post(B, c[0], c[1], 0.03, y - 0.2, 0.05, stc); } }
  if (fl >= 2) { const sEnd = stairL === (proj(ce, ...fr.P(u0, fs)) < ce.L / 2) ? 0 : ce.L, dir = sEnd === 0 ? -1 : 1, t = [(ce.bx - ce.ax) / ce.L, (ce.bz - ce.az) / ce.L];
    for (let k = 0; k < fl - 1; k++) { const y0 = yOf(k) - (k === 0 ? base - 0.03 : 0), y1 = yOf(k + 1), len = 3.4, s0 = sEnd + dir * 0.15, s1 = sEnd + dir * (0.15 + Math.min(2.0, sw - 0.2)), off0 = 0.1, off1 = cd;
      // 階段：外の 踊り場から 廊下へ（壁にそって）
      const P0 = ept(ce, s0, off0), P1 = ept(ce, s1, off0), Q0 = ept(ce, s0, off1), Q1 = ept(ce, s1, off1), lo = k % 2 === 0;
      const A0 = lo ? P0 : Q0, A1 = lo ? P1 : Q1, B0 = lo ? Q0 : P0, B1 = lo ? Q1 : P1;
      B.quad('c', [A0[0], y0, A0[1]], [A1[0], y0, A1[1]], [B1[0], y1, B1[1]], [B0[0], y1, B0[1]], null, mul(stc, 0.9));
      B.quad(RAIL, [A1[0], y0, A1[1]], [A1[0], y0 + 1.0, A1[1]], [B1[0], y1 + 1.0, B1[1]], [B1[0], y1, B1[1]], null, stc, [0, RB(1)[0], len / 1.4, RB(1)[1]]);
      if (lod >= 2) { post(B, A1[0] + t[0] * dir * 0.05, A1[1] + t[1] * dir * 0.05, 0.03, y0 + 0.02, 0.05, stc); post(B, B1[0] + t[0] * dir * 0.05, B1[1] + t[1] * dir * 0.05, 0.03, y1, 0.05, stc); }
      slab(B, ce, Math.min(s0, s1) - (dir > 0 ? 0 : 0), Math.max(s0, s1), cd, y1 - 0.2, y1, 'c', stc, 1, 1, true); } }
  // ドア・メーター・面格子の窓（廊下がわ）と 掃き出し窓・ベランダ（反対がわ）
  const dts = [[5, 5], [6, 6], [7, 6]], dt = dts[L.dt || 0];
  for (let k = 0; k < fl; k++) { const y = yOf(k);
    for (let i = 0; i < nu; i++) { const s0 = i * uw2, mir = i % 2 === 1, ds = mir ? s0 + uw2 - 0.7 : s0 + 0.7, ws = mir ? s0 + uw2 * 0.42 : s0 + uw2 * 0.58;
      if (room() < 30) break;
      panel(B, WIN, ce, ds, 0.85, y + 0.02, y + 2.0, wuv(dt[0], dt[1]), 0.06);
      panel(B, WIN, ce, ws, 0.9, y + 1.1, y + 1.85, winUV('S', frI, R), 0.08);
      if (lod >= 2) panel(B, WIN, ce, mir ? ds - 0.75 : ds + 0.75, 0.42, y + 1.0, y + 1.55, wuv(4, 9), 0.1);
      const bs0 = ba.L - (s0 + uw2), bs1 = ba.L - s0, bmid = (bs0 + bs1) / 2;
      panel(B, WIN, ba, bmid, Math.min(1.69, uw2 - 1.2), y + 0.02, y + 1.95, winUV('K', frI, R), 0.06);
      if (k >= 1) { const b0 = bs0 + 0.2, b1 = bs1 - 0.2, dep = 0.85; slab(B, ba, b0, b1, dep, y - 0.18, y, 'c', [0.72, 0.72, 0.7], 1, 1, lod < 2);
        if (L.brl === 'glass') band(B, GLS, ba, b0, b1, dep, y, 1.05, [0.52, 0.98], 2); else band(B, RAIL, ba, b0, b1, dep, y, 1.05, RB(0), 1.6, col(L.brc || FRC[frI]));
        if (lod >= 2) { if (room() > 120 && R() < 0.45) { const off = dep * 0.6, yp = y + 1.55; let q = b0 + 0.3; for (let j = 0; j < 4 && q < b1 - 0.7; j++) { const w = rnd(R, 0.3, 0.6), h = rnd(R, 0.4, 0.8), c = ept(ba, q, off), d = ept(ba, q + w, off); B.quad('c', [d[0], yp - h, d[1]], [c[0], yp - h, c[1]], [c[0], yp, c[1]], [d[0], yp, d[1]], [ba.nx, 0, ba.nz], pick(R, ['#f3f2ee', '#e9ecef', '#9fb3c8', '#c9c3b8', '#5a6a80', '#d9b8b8'])); q += w + 0.15; } }
          if (room() > 80 && R() < 0.6) { const c = ept(ba, b1 - 0.55, 0.3); acU(B, c[0], c[1], y + 0.02, angOf([ba.bx - ba.ax, ba.bz - ba.az]) + Math.PI); } } }
      else if (lod >= 2 && room() > 80 && R() < 0.6) { const c = ept(ba, bs1 - 0.55, 0.35); acU(B, c[0], c[1], 0.05, angOf([ba.bx - ba.ax, ba.bz - ba.az]) + Math.PI); } } }
  for (const e of es) if (e !== ce && e !== ba && lod >= 2) for (let k = 0; k < fl && room() > 40; k++) panel(B, WIN, e, e.L * 0.5, 0.6, yOf(k) + 1.2, yOf(k) + 1.9, winUV('S', frI, R), 0.08);
  if (lod < 2) return;
  // 近く：駐車場の車・自転車・ゴミ置き場・ふちの塀
  if (pk && room() > 200) { const nC = Math.floor((W - 1) / 2.6); for (let i = 0; i < nC && room() > 120; i++) { if (R() < 0.35) continue; const c = fr.P(0.9 + (i + 0.5) * ((W - 1.8) / nC), (fs - 0.4) / 2); car(B, c[0], c[1], angOf(fr.dv) + (R() < 0.5 ? 0 : Math.PI), R); } }
  if (room() > 60) { const c = fr.P(stairL ? u1 + 0.8 : u0 - 0.8, fs + md * 0.8), ex = fr.du; for (let j = 0; j < 4; j++) { const q = [c[0] + fr.dv[0] * (j * 0.6 - 0.9), c[1] + fr.dv[1] * (j * 0.6 - 0.9)], vb2 = RB(7), k2 = R() < 0.5 ? 0 : 0.5; B.quad(RAIL, [q[0] - ex[0] * 0.85, 0.04, q[1] - ex[1] * 0.85], [q[0] + ex[0] * 0.85, 0.04, q[1] + ex[1] * 0.85], [q[0] + ex[0] * 0.85, 1.07, q[1] + ex[1] * 0.85], [q[0] - ex[0] * 0.85, 1.07, q[1] - ex[1] * 0.85], null, WH, [k2, vb2[0], k2 + 0.5, vb2[1]]); } }
  if (room() > 60) { const g = fr.P(stairL ? W - 1.2 : 1.2, 1.0); B.box('c', g[0] - 0.9, g[1] - 0.5, g[0] + 0.9, g[1] + 0.5, 0.04, 1.2, [0.6, 0.66, 0.6]); }
  for (const e of lot.edges) { if (room() < 30) break; if (e.nx * n[0] + e.nz * n[1] > 0.5) continue; fence(B, e, 0.05, e.L - 0.05, L.fen || 'blockf', false, L, R); }
}
const APLOOK = [
  { n: 'ベージュのサイディング', w: 'siding', wc: '#e5dac5', rf: 'gable', rm: 'slate', rc: '#5e4a3c', fc: '#efe9df', fr: 1, stc: '#c8bfae', dt: 2, brc: '#c8bfae' },
  { n: '白い外壁・紺の屋根', w: 'siding', wc: '#f1f0eb', rf: 'hip', rm: 'slate', rc: '#3d4656', fc: '#f1f0eb', fr: 0, stc: '#e3e3df', dt: 1 },
  { n: 'グレーの鉄骨アパート', w: 'galva', wc: '#b9bbbd', w2: 'siding', wc2: '#d9dadb', rf: 'gable', rm: 'seam', rc: '#55595e', fc: '#d9dadb', fr: 0, stc: '#9a9ea2', dt: 1, crs: true },
  { n: 'レンガ調と クリーム', w: 'tile', wc: '#b47d64', w2: 'siding', wc2: '#efe6d4', rf: 'gable', rm: 'slate', rc: '#5a4436', fc: '#efe6d4', fr: 1, stc: '#7a5f4d', dt: 2, brc: '#7a5f4d' },
  { n: 'モルタル・瓦の文化住宅', w: 'stucco', wc: '#cdc7bb', rf: 'gable', rm: 'kawara', rc: '#7f858d', p: 0.45, fc: '#5a5550', fr: 0, stc: '#6b5a4c', dt: 0, brc: '#6b5a4c' },
  { n: '黒い箱・デザイナーズ', w: 'galva', wc: '#3a3c40', w2: 'board', wc2: '#b08a63', rf: 'flat', fr: 2, stc: '#2f3134', dt: 1, brl: 'glass', crs: true },
  { n: '水色の外壁', w: 'siding', wc: '#c8d6dc', rf: 'gable', rm: 'slate', rc: '#4b4e54', fc: '#f1f0eb', fr: 0, stc: '#e3e3df', dt: 1 },
  { n: '打ちはなしの アパート', w: 'conc', wc: '#ffffff', rf: 'flat', fr: 2, stc: '#9a9ea2', dt: 1, brl: 'glass', crs: true },
];
const apFar = (L, P) => { const fl = clamp(P.f || 2, 1, 4), H = 0.4 + fl * 2.75, flat = L.rf === 'flat'; return { H: H + (flat ? 0.6 : 0), base: 0, wall: FAR1, bw: 4.2, fh: 2.75, tb: 2, tf: 2, roof: null, rc: flat ? [0.7, 0.7, 0.68] : roofAvg(L.rm || 'slate', L.rc), rt: flat ? 'flat' : L.rf === 'hip' ? 'hip' : 'gable', p: L.p || 0.42, ins: 1.6, wc: wallAvg(L.w2 || L.w, L.wc2 || L.wc || '#e6dcc8') }; };
A.arch('h_apart', { looks: APLOOK, build: apartBuild, far: apFar });
const AL = idx => idx.map(i => APLOOK[i]);

/* ---------- 団地・公営住宅・社宅・寮 ----------
   階段室型の 板状の棟（南に ベランダ・北に 階段室）。大きな区画には 棟を 何本も 平行に（あいだに 芝・木・駐車場） */
const DNORTH = TX('dn', 256, 256, (g, w, h, R) => {   // 団地の 北がわ（1戸 × 2階：小窓と 面格子）
  pWallF(g, 0, 0, w, h, 'paint', R);
  for (let j = 0; j < 2; j++) { const y = j * h / 2, ch = h / 2, yb = y + ch * 0.95;
    pSash(g, w * 0.12, yb - ch * 0.62, w * 0.24, ch * 0.3, R, { f: '#a6aaad', frost: true, grille: true }); pSash(g, w * 0.55, yb - ch * 0.66, w * 0.14, ch * 0.22, R, { f: '#a6aaad', frost: true, grille: true }); pSash(g, w * 0.76, yb - ch * 0.62, w * 0.16, ch * 0.3, R, { f: '#a6aaad', st: 1 });
    PT.fill(g, 0, yb, w, ch * 0.05, '#cfcac0'); PT.streaks(g, 0, yb, w, ch * 0.4, 4, 0.06, R); }
});
function danchiBuild(B, L, P) {
  const O = P.ko || {}, R = P.rng, lod = P.lod, nv0 = B.nv, fl = Math.max(1, P.f || 5), F0 = P.F, fe = A.frontEdge(F0, P.front), n = [Math.round(fe.nx), Math.round(fe.nz)];
  const big = F0.area * fl > 4500 || fl >= 10, cap = (lod >= 2 ? [2100, 3400] : lod === 1 ? [520, 1000] : [145, 290])[big ? 1 : 0], room = () => cap - (B.nv - nv0);
  const fh = 2.75, base = 0.35, yOf = k => base + k * fh, H = yOf(fl), sd = O.sd || 9.6, bd = 1.3, gap = Math.max(12, H * 1.2), lot = A.inset(F0, 0.05);
  const fam = FAMS[L.wf] || FAMS.paint, tint = col(L.wc || '#ebe7dd'), wmat = fam.m, rlc = col(L.rlc || '#d9d9d4'), corr = !!L.corr;
  // 棟の配置（東西に長い 棟を 南北に ならべる）
  const slabs = [];
  for (const r0 of F0.rects) { const r = A.rin(r0, F0.n > 4 ? 3.0 : 1.8), w = r[2] - r[0], d = r[3] - r[1]; if (w < 8 || d < 7) continue;
    const dd = Math.min(sd + 2.2, d), rows = Math.max(1, Math.floor((d + gap) / (dd + gap))), sp = rows > 1 ? (d - rows * dd) / (rows - 1) : 0;
    for (let i = 0; i < rows && slabs.length < 14; i++) { const z0 = r[1] + (rows > 1 ? i * (dd + sp) : (d - dd) / 2), nx = Math.max(1, Math.ceil(w / 64)), lw = (w - (nx - 1) * 8) / nx;
      for (let j = 0; j < nx && slabs.length < 14; j++) { const x0 = r[0] + j * (lw + 8); slabs.push([x0, z0 + 1.0, x0 + lw, z0 + Math.min(dd, sd + 1.0)]); } } }
  if (!slabs.length) { const r = A.rin(F0.bb, 1.5); slabs.push(r); }
  const ns = slabs.length, nk = Math.max(1, fl - 1), per = q => slabs.reduce((a, r) => { const L2 = r[2] - r[0], nb = Math.max(1, Math.round(L2 / MW)); return a + nk * ([42 + 6 * (nb - 1), 18, 12, 0][q] + (corr ? [30, 12, 6, 0][q] : 0)) + (corr ? 0 : Math.ceil(L2 / (MW * 2)) * (30 + (q === 0 && lod >= 2 ? fl * 6 + 6 : 0))) + 90; }, 0);
  let dq = lod >= 2 ? 0 : 1; while (dq < 3 && per(dq) > cap * 0.82) dq++;
  const lite = dq >= 1, noBal = dq >= 3;
  if (lod <= 0) { const ft = L.wf === 'conc' ? wallAvg('conc', L.wc) : tint; for (const r of slabs.slice(0, big ? 9 : 4)) { const yb = P.yb < -0.5 ? P.yb : 0; for (const e of redges(r)) B.wall(FARM, e.ax, e.az, e.bx, e.bz, yb, H + 0.7, ft, [0, Math.max(1, Math.round(e.L / MW)) / 2, (yb - base) / MF / 2, (H - base) / MF / 2], 0.85); B.flat('c', r, H + 0.7, [0.66, 0.66, 0.64]); } return; }
  B.cap(GND.lawn, lot, 0.03, WH, { su: 4 });
  for (let si = 0; si < ns; si++) { const r = slabs[si], es = redges(r), sE = es[2], nE = es[0];
    if (lod >= 2 || P.yb < -0.5) B.plinth(rectF(r), P.yb, base + 0.01, [0.66, 0.65, 0.62]);
    B.flat(GND.conc, [r[0] - 1.2, r[1] - 3.2, r[2] + 1.2, r[1] - 0.05], 0.05, [0.85, 0.85, 0.84], { su: 4 });
    B.wall(fam.b, sE.ax, sE.az, sE.bx, sE.bz, base, H, tint, [0, Math.max(1, Math.round(sE.L / MW)), 0, (H - base) / MF / 2], 0.85);
    B.wall(corr ? fam.c : DNORTH, nE.ax, nE.az, nE.bx, nE.bz, base, H, tint, [0, Math.max(1, Math.round(nE.L / MW)), 0, (H - base) / fh / 2], 0.85);
    for (const e of [es[1], es[3]]) B.wall(wmat.k, e.ax, e.az, e.bx, e.bz, base, H, tint, [0, e.L / wmat.su, base / wmat.sv, H / wmat.sv], 0.85);
    // 屋根
    if (L.rf === 'gable') roof1(B, { t: 'gable', r, y: H, p: 0.35, oh: 0.5, th: lod >= 2 ? 0.15 : 0, ax: 'x', m: RMAT[L.rm || 'slate'].k, c: L.rcol || '#7a5a4a', su: 3.6, sv: 2.2, mg: wmat.k, cg: tint, gsu: wmat.su, gsv: wmat.sv, cf: mul(tint, 0.9) });
    else { for (const e of es) B.wall(wmat.k, e.ax, e.az, e.bx, e.bz, H, H + 0.7, tint, [0, e.L / wmat.su, H / wmat.sv, (H + 0.7) / wmat.sv]); B.flat(RMAT.flat.k, r, H + 0.05, [0.78, 0.78, 0.76], { su: 6 });
      const I = A.rin(r, 0.2); for (const e of redges(I)) B.wall('c', e.bx, e.bz, e.ax, e.az, H, H + 0.7, mul(tint, 0.8)); }
    // ベランダ（南）
    if (!noBal) for (let k = 1; k < fl; k++) { const y = yOf(k); if (dq >= 2) { band(B, L.rl === 'solid' ? wmat.k : RAIL, sE, 0.3, sE.L - 0.3, bd, y - 0.18, 1.18, L.rl === 'solid' ? [y / wmat.sv, (y + 1) / wmat.sv] : RB(1), 1.4, L.rl === 'solid' ? tint : rlc); continue; } slab(B, sE, 0.3, sE.L - 0.3, bd, y - 0.18, y, 'c', [0.82, 0.81, 0.78], 1, 1, lite);
      if (L.rl === 'solid') band(B, wmat.k, sE, 0.3, sE.L - 0.3, bd, y, 1.0, [y / wmat.sv, (y + 1.0) / wmat.sv], wmat.su, tint); else band(B, RAIL, sE, 0.3, sE.L - 0.3, bd, y, 1.0, RB(1), 1.4, rlc);
      if (!lite) { const nb = Math.max(1, Math.round(sE.L / MW)); for (let i = 1; i < nb; i++) { const a = ept(sE, i * sE.L / nb, 0.05), b = ept(sE, i * sE.L / nb, bd - 0.05); B.wall('c', a[0], a[1], b[0], b[1], y, y + 1.8, [0.88, 0.87, 0.84]); } } }
    // 階段室（北。2戸ごと）か 片廊下
    if (corr) { if (!noBal) for (let k = 1; k < fl; k++) { if (dq >= 2) band(B, wmat.k, nE, 0.3, nE.L - 0.3, 1.3, yOf(k) - 0.25, 1.35, [(yOf(k) - 0.25) / wmat.sv, (yOf(k) + 1.1) / wmat.sv], wmat.su, tint); else slab(B, nE, 0.3, nE.L - 0.3, 1.3, yOf(k) - 0.25, yOf(k) + 1.1, wmat.k, tint, wmat.su, wmat.sv, lite); } }
    else { const nb = Math.max(1, Math.round(nE.L / (MW * 2)));
      for (let i = 0; i < nb; i++) { const sc = (i + 0.5) * nE.L / nb, a = ept(nE, sc - 1.3), b = ept(nE, sc + 1.3, 2.3), rr = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        B.box(wmat.k, rr[0], rr[1], rr[2], rr[3], base, H + (L.rf === 'gable' ? 0 : 0.7), tint, { su: wmat.su, sv: wmat.sv });
        if (dq === 0 && lod >= 2 && room() > 300) { const fe2 = redges(rr)[0]; for (let k = 0; k < fl; k++) panel(B, WIN, fe2, fe2.L / 2, 1.2, yOf(k) + 1.3, yOf(k) + 2.2, wuv(3, 6), 0.05, [0.85, 0.85, 0.83]); panel(B, WIN, fe2, fe2.L / 2, 1.3, base + 0.02, base + 2.1, wuv(4, 10), 0.05); } } }
  }
  if (lod < 2) return;
  // 近く：木・駐車の車・自転車置き場・砂場
  for (let i = 0, t = 0; i < Math.min(18, 2 + ns * 3) && t < 60 && room() > 100; t++) { const bb = lot.bb, x = rnd(R, bb[0] + 1.5, bb[2] - 1.5), z = rnd(R, bb[1] + 1.5, bb[3] - 1.5);
    if (!lot.rects.some(q => inR(q, x, z, -1)) || slabs.some(q => inR(q, x, z, 3.5))) continue; tree(B, x, z, 0.03, rnd(R, 5, 8), rnd(R, 1.6, 2.6), pick(R, ['#4f7340', '#5f8448', '#3f6036', '#567a3e']), R); i++; }
  for (const r of slabs) { if (room() < 400) break; const nC = Math.floor((r[2] - r[0]) / 2.8); for (let i = 0; i < nC && room() > 300; i++) if (R() < 0.45) car(B, r[0] + (i + 0.5) * 2.8, r[1] - 1.6, Math.PI / 2 + (R() < 0.5 ? 0 : Math.PI), R); }
  if (room() > 200 && ns > 1) { const r = slabs[0], c = [r[2] + 2.5, (r[1] + r[3]) / 2]; if (lot.rects.some(q => inR(q, c[0], c[1], -1.5))) { B.flat('c', [c[0] - 1.5, c[1] - 1.5, c[0] + 1.5, c[1] + 1.5], 0.06, [0.85, 0.78, 0.62]); B.box('c', c[0] - 1.6, c[1] - 1.6, c[0] + 1.6, c[1] - 1.45, 0.03, 0.25, [0.7, 0.7, 0.68]); } }
}
const DLOOK = [
  { n: '白い団地・平らな屋根', wf: 'paint', wc: '#ece9e0', rlc: '#d6d6d1' },
  { n: 'クリーム色の団地', wf: 'paint', wc: '#efe3c9', rlc: '#f2f1ec' },
  { n: 'うすい緑の団地', wf: 'paint', wc: '#d7ddcf', rlc: '#efeee6' },
  { n: 'レンガ色の住宅', wf: 'tile', wc: '#ad7a63', rlc: '#5d6166' },
  { n: '勾配屋根の団地', wf: 'paint', wc: '#e8e3d7', rlc: '#d6d6d1', rf: 'gable', rm: 'slate', rcol: '#8a5a48' },
  { n: 'グレーのタイル・社宅', wf: 'tile', wc: '#c3c2bd', rlc: '#c9cdd0' },
  { n: 'ベージュの寮・廊下', wf: 'paint', wc: '#e4d7bf', rlc: '#7a6a5a', corr: true },
  { n: '打ちはなしの寮', wf: 'conc', wc: '#ffffff', rlc: '#9a9ea2', corr: true, rl: 'solid' },
];
const DL = idx => idx.map(i => DLOOK[i]);
A.arch('h_danchi', { looks: DLOOK, build: danchiBuild, far: (L, P) => ({ H: 0.35 + Math.max(1, P.f || 5) * 2.75 + 0.7, base: 0, wall: FARM, bw: MW, fh: MF, tb: 2, tf: 2, roof: null, rc: [0.64, 0.64, 0.62], rt: 'flat', ins: 3, wc: L.wf === 'conc' ? wallAvg('conc', L.wc) : col(L.wc || '#ebe7dd') }) });

/* ---------- タワーマンション ----------
   ガラスの外壁（TWF）と、1.8m 外の 半とうめいの 手すりの幕（TWS：階ごとの 床の帯・ガラス）。近くでは 階ごとの ベランダの床。上に 冠（フレーム）、下に 低層棟 */
const TWF = TX('twf', 256, 256, (g, w, h, R) => {   // 2柱間 × 4階
  PT.fill(g, 0, 0, w, h, '#c9ccce');
  for (let j = 0; j < 4; j++) { const y = j * h / 4, ch = h / 4;
    for (let i = 0; i < 2; i++) { const x = i * w / 2, bw = w / 2; pGlass(g, x + bw * 0.03, y + ch * 0.08, bw * 0.94, ch * 0.78, true); pIn(g, x + bw * 0.05, y + ch * 0.1, bw * 0.9, ch * 0.74, R, Math.floor(R() * 5), 0, pick(R, CURC));
      g.fillStyle = 'rgba(160,175,190,.22)'; g.fillRect(x + bw * 0.03, y + ch * 0.08, bw * 0.94, ch * 0.3); PT.fill(g, x + bw * 0.49, y + ch * 0.08, bw * 0.02, ch * 0.78, '#9a9fa3'); }
    PT.fill(g, 0, y + ch * 0.86, w, ch * 0.14, '#b9bcbf'); }
});
const TWSL = [0.82, 0.83, 0.83];
const TWS = TX('tws', 128, 128, (g, w, h) => {   // 手すりの幕（4階分）：床の帯（白）・ガラス（半とうめい）・あいだ（とうめい）
  g.clearRect(0, 0, w, h);
  for (let j = 0; j < 4; j++) { const y = j * h / 4, ch = h / 4;
    g.fillStyle = 'rgba(242,243,243,1)'; g.fillRect(0, y + ch * 0.82, w, ch * 0.18);
    g.fillStyle = 'rgba(206,218,226,.62)'; g.fillRect(0, y + ch * 0.48, w, ch * 0.34);
    g.fillStyle = 'rgba(225,228,230,1)'; g.fillRect(0, y + ch * 0.48, w, ch * 0.03); for (let i = 0; i < 4; i++) g.fillRect(i * w / 4, y + ch * 0.5, Math.max(1, w / 128), ch * 0.36); }
}, { tr: true, op: 1 });
function towerBuild(B, L, P) {
  const O = P.ko || {}, R = P.rng, lod = P.lod, nv0 = B.nv, fl = Math.max(5, P.f || 30), F0 = P.F, fe = A.frontEdge(F0, P.front), n = [Math.round(fe.nx), Math.round(fe.nz)];
  const cap = [300, 1000, 3400][clamp(lod, 0, 2)], room = () => cap - (B.nv - nv0), lot = A.inset(F0, 0.05);
  const LR = F0.maxr.reduce((a, r) => (r[2] - r[0]) * (r[3] - r[1]) > (a[2] - a[0]) * (a[3] - a[1]) ? r : a), w = LR[2] - LR[0], d = LR[3] - LR[1];
  const side = clamp(Math.min(w, d) - (Math.min(w, d) > 30 ? 10 : 3), 14, 44), tw = Math.min(w - 3, side * (w > d * 1.3 ? 1.25 : 1)), td = Math.min(d - 3, side * (d > w * 1.3 ? 1.25 : 1));
  const cx = (LR[0] + LR[2]) / 2, cz = (LR[1] + LR[3]) / 2, T = [cx - tw / 2, cz - td / 2, cx + tw / 2, cz + td / 2];
  const pod = Math.min(w, d) - Math.min(tw, td) > 8, pf = O.shop ? 3 : 2, ph = 4.6, PR = pod ? A.rin(LR, 2.2) : null, y0 = 0.3 + (pod ? pf * ph : ph), fh = 3.15, H = y0 + (fl - (pod ? pf : 1)) * fh;
  const tint = col(L.wc || '#e6eaed'), stint = col(L.sc || '#ffffff'), pm = MAT[L.pm || 'stone'], pc = col(L.pc || '#d9d4ca'), es = redges(T), bd = 1.8;
  if (lod <= 0) { if (PR) { for (const e of redges(PR)) B.wall(pm.k, e.ax, e.az, e.bx, e.bz, 0, y0, pc, [0, e.L / pm.su, 0, y0 / pm.sv]); B.flat('c', PR, y0, [0.6, 0.62, 0.6]); }
    for (const e of es) B.wall(FART, e.ax, e.az, e.bx, e.bz, PR ? y0 : 0, H + 2, tint, [0, Math.max(1, Math.round(e.L / 4)) / 4, 0, (H - y0) / fh / 4]); B.flat('c', T, H + 2, [0.6, 0.6, 0.6]); return; }
  B.cap(GND.tile, lot, 0.03, WH, { su: 2 });
  // 低層棟（ロビー・お店）
  if (PR) { B.plinth(rectF(PR), P.yb, 0.31, [0.62, 0.62, 0.6]);
    for (const e of redges(PR)) { const fr2 = e.nx * n[0] + e.nz * n[1] > 0.5; if (O.shop && fr2) B.wall(MSHOP, e.ax, e.az, e.bx, e.bz, 0.3, 0.3 + ph, WH, [0, Math.max(1, Math.round(e.L / MW)) / 2, 0, 0.97]); else B.wall(pm.k, e.ax, e.az, e.bx, e.bz, 0.3, 0.3 + ph, pc, [0, e.L / pm.su, 0.3 / pm.sv, (0.3 + ph) / pm.sv], 0.85);
      B.wall(TWF, e.ax, e.az, e.bx, e.bz, 0.3 + ph, y0, mul(tint, 0.95), [0, Math.max(1, Math.round(e.L / 4)) / 2, 0, (y0 - 0.3 - ph) / fh / 4]);
      if (fr2 && lod >= 1) for (let q = 4; q < e.L - 3; q += 9) panel(B, WIN, e, q, 3.2, 0.32, 2.8, wuv(4, 10), 0.08); }
    B.flat(GND.lawn, A.rin(PR, 0.4), y0 + 0.05, WH, { su: 4 }); }
  else B.plinth(rectF(T), P.yb, 0.31, [0.62, 0.62, 0.6]);
  // 塔
  const yb0 = PR ? y0 : 0.3;
  if (L.seis) for (const e of es) { const a = ept(e, 0, -0.3), b = ept(e, e.L, -0.3); B.wall('c', a[0], a[1], b[0], b[1], yb0, yb0 + 0.6, [0.2, 0.21, 0.22]); }
  for (const e of es) B.wall(TWF, e.ax, e.az, e.bx, e.bz, yb0 + (L.seis ? 0.6 : 0), H, tint, [0, Math.max(1, Math.round(e.L / 4)) / 2, 0, (H - yb0) / fh / 4], 0.9);
  // 手すりの幕（角で まわりこむ）と 階ごとの床（近く）
  const ys = yb0 + fh, ye = H - 0.4;
  for (const e of es) { const a = ept(e, -bd, bd), b = ept(e, e.L + bd, bd); B.wall(TWS, a[0], a[1], b[0], b[1], ys - fh * 0.14 - 0.02, ye, stint, [0, (e.L + 2 * bd) / 4, -0.035, (ye - ys + fh * 0.14) / fh / 4 - 0.035]); }
  if (lod >= 2) { const k0 = Math.ceil((ys - yb0) / fh), kn = Math.floor((ye - yb0) / fh); for (let k = k0; k <= kn && room() > 300; k++) { const y = yb0 + k * fh; for (const e of es) { const a = ept(e, -bd, 0), b = ept(e, e.L + bd, 0), a2 = ept(e, -bd, bd), b2 = ept(e, e.L + bd, bd); wq(B, 'c', a2[0], y, a2[1], b2[0], y, b2[1], b[0], y, b[1], a[0], y, a[1], 0, 1, 0, TWSL, 0, 0, 0, 0, 1, 1); } } }
  if (L.col) for (const [x, z] of [[T[0] - bd, T[1] - bd], [T[2] + bd, T[1] - bd], [T[2] + bd, T[3] + bd], [T[0] - bd, T[3] + bd]]) B.box('c', x - 0.5, z - 0.5, x + 0.5, z + 0.5, yb0, H, col(L.col));
  // 冠（屋上の フレーム）
  const yc = H + 3.2;
  for (const e of es) B.wall(L.crown === 'glass' ? TWS : 'c', e.ax, e.az, e.bx, e.bz, H, yc, L.crown === 'glass' ? stint : mul(stint, 0.86), L.crown === 'glass' ? [0, e.L / 4, 0, 1] : null);
  B.flat(RMAT.flat.k, T, H + 0.05, [0.72, 0.72, 0.7], { su: 6 });
  const I = A.rin(T, 0.3); for (const e of redges(I)) B.wall('c', e.bx, e.bz, e.ax, e.az, H, yc, mul(stint, 0.75));
  if (lod >= 2) { const hc = [(T[0] + T[2]) / 2, (T[1] + T[3]) / 2], rr = Math.min(tw, td) * 0.28, n8 = 12;   // 屋上の 救助スペース（まるい しるし。文字なし）
    for (let i = 0; i < n8; i++) { const t0 = i / n8 * 6.283, t1 = (i + 1) / n8 * 6.283; B.tri('c', [hc[0], H + 0.09, hc[1]], [hc[0] + Math.cos(t1) * rr, H + 0.09, hc[1] + Math.sin(t1) * rr], [hc[0] + Math.cos(t0) * rr, H + 0.09, hc[1] + Math.sin(t0) * rr], [0, 1, 0], [0.88, 0.88, 0.86]); B.tri('c', [hc[0], H + 0.1, hc[1]], [hc[0] + Math.cos(t1) * rr * 0.7, H + 0.1, hc[1] + Math.sin(t1) * rr * 0.7], [hc[0] + Math.cos(t0) * rr * 0.7, H + 0.1, hc[1] + Math.sin(t0) * rr * 0.7], [0, 1, 0], [0.55, 0.56, 0.57]); }
    for (let i = 0; i < 6 && room() > 60; i++) acU(B, rnd(R, T[0] + 1.5, T[2] - 1.5), rnd(R, T[1] + 1, T[1] + 3), H + 0.05, 0);
    for (let i = 0, t = 0; i < 10 && t < 40 && room() > 80; t++) { const bb = lot.bb, x = rnd(R, bb[0] + 1, bb[2] - 1), z = rnd(R, bb[1] + 1, bb[3] - 1); if ((PR && inR(PR, x, z, 1)) || inR(T, x, z, 3)) continue; tree(B, x, z, 0.03, rnd(R, 5, 8), rnd(R, 1.4, 2.2), '#4f7340', R); i++; } }
}
const TLOOK = [
  { n: '白いガラスのタワー', wc: '#e8ecef', sc: '#ffffff', crown: 'glass' },
  { n: 'グレーの縦じま', wc: '#b9bec3', sc: '#d6d9db', col: '#a9adb1' },
  { n: 'ベージュのタワー', wc: '#e6dbc9', sc: '#f1e9db', pm: 'tile', pc: '#cdb89a' },
  { n: '黒いガラスのタワー', wc: '#7b8188', sc: '#55595e', pm: 'conc', pc: '#ffffff', crown: 'glass' },
  { n: '茶色の柱のタワー', wc: '#dcd5ca', sc: '#efeae2', col: '#7a5f4d', pm: 'tile', pc: '#8a6a55' },
  { n: '免震の白いタワー', wc: '#eef0f1', sc: '#ffffff', seis: true, crown: 'glass' },
];
A.arch('h_tower', { looks: TLOOK, build: towerBuild, far: (L, P) => ({ H: 0.3 + Math.max(5, P.f || 30) * 3.15 + 3, base: 0, wall: FART, bw: 4, fh: 3.15, tb: 4, tf: 4, roof: null, rc: [0.6, 0.6, 0.6], rt: 'flat', ins: 6, wc: col(L.wc || '#e6eaed') }) });

/* ---------- 中庭のある家（コの字・ロの字） ----------
   区画の形にそって 家をまわし、中庭に 木と芝。外は 小窓、中庭がわは 大きな掃き出し窓 */
function courtBuild(B, L, P) {
  const R = P.rng, lod = P.lod, nv0 = B.nv, cap = [90, 400, 1300][clamp(lod, 0, 2)], room = () => cap - (B.nv - nv0), fl = clamp(P.f || 1, 1, 2), F0 = P.F, n = (() => { const e = A.frontEdge(F0, P.front); return [Math.round(e.nx), Math.round(e.nz)]; })();
  const lot = A.inset(F0, 0.05), F = (() => { const F1 = A.inset(F0, 1.6); if (F1.loops.length > 1 || F1.rects.length > 1) return F1; const b = F1.bb, w = b[2] - b[0], d = b[3] - b[1], t = clamp(Math.min(w, d) * 0.3, 4.5, 6.5);
    if (w < 2 * t + 3 || d < 2 * t + 3) return F1; const ring = [[b[0], b[1], b[2], b[1] + t], [b[0], b[1], b[0] + t, b[3]], [b[2] - t, b[1], b[2], b[3]]]; if (w >= 2 * t + 6 && d >= 2 * t + 6 && w * d > 500) ring.push([b[0], b[3] - t, b[2], b[3]]);
    return footR(ring) || F1; })(), wm = MAT[L.w] || MAT.stucco, wc = col(L.wc || '#efede8'), rm = RMAT[L.rm] || RMAT.kawara, rc = L.rc || '#8e959e', flat = L.rf === 'flat', H = HB + fl * FH, frI = L.fr || 1;
  const yb = lod >= 2 || P.yb < -0.5 ? HB : 0;
  if (lod <= 0) { const bb = F.bb; for (const e of redges(bb)) B.wall(FAR1, e.ax, e.az, e.bx, e.bz, 0, H, wallAvg(L.w, L.wc), [0, Math.max(1, Math.round(e.L / 4.2)) / 2, -HB / FH / 2, (H - HB) / FH / 2]); if (flat) B.flat('c', bb, H, [0.7, 0.7, 0.68]); else roof1(B, { t: 'hip', r: bb, y: H, p: L.p || 0.42, oh: 0.6, th: 0, m: rm.k, c: rc, su: rm.su, sv: rm.sv }); return; }
  B.cap(GND.gravel, lot, 0.03, WH, { su: 3 });
  if (yb > 0) B.plinth(F, P.yb, HB + 0.005, [0.7, 0.69, 0.66]);
  for (const e of F.edges) B.wallE(wm.k, e, yb, H + (flat ? 0.5 : 0), wc, { uv: [0, e.L / wm.su, yb / wm.sv, (H + (flat ? 0.5 : 0)) / wm.sv], ao: 0.85 });
  if (flat) flatTop(B, F, H, 0.5, wm, L.wc, lod, null);
  else roofs(B, F, { t: L.rf || 'gable', y: H, p: L.p || 0.42, oh: L.oh || 0.6, th: lod >= 2 ? 0.15 : 0, m: rm.k, c: rc, su: rm.su, sv: rm.sv, mg: wm.k, cg: wc, gsu: wm.su, gsv: wm.sv, cf: col(L.fc || '#3c3632'), cr: mul(roofAvg(L.rm, rc), 0.85) });
  // 窓：外は 小窓、中庭（内がわ・くぼみ）は 掃き出し
  const wst = L.wst, WTX = WTS[wst] || WT, fe2 = A.frontEdge(F, P.front);
  let doorDone = false;
  for (const e of F.edges) for (let k = 0; k < fl; k++) { if (room() < 30) break; const y = HB + k * FH, court = !e.out || !lot.rects.some(r => inR(r, ...ept(e, e.L / 2, 3.0), 0.01)) || false;
    const nrep = Math.max(1, Math.round(e.L / 6)), list = [].concat(...Array.from({ length: nrep }, () => court ? (k === 0 ? ['K', 'K'] : ['H', 'H']) : (k === 0 ? ['H2', 'S'] : ['H2', 'SL'])));
    let segs = [[0, e.L]];
    if (!doorDone && e === fe2 && k === 0) { const s = e.L * 0.5; panel(B, WIN, e, s, 1.25, HB + 0.02, HB + 2.3, (L.dr || 0) < 8 ? wuv(L.dr || 0, 5) : wuv(L.dr - 4, 6), 0.08); segs = cutS(segs, s - 1.0, s + 1.0); doorDone = true; }
    for (const w of fitWins(segs, list, 0.6, R, WTX)) { const [ww, wh, sill] = WTX[w.t]; panel(B, WIN, e, w.s, ww, y + sill, Math.min(y + sill + wh, y + FH - 0.25), winUV(w.t, frI, R, wst), 0.08); } }
  if (lod < 2) return;
  // 中庭の木（形の くぼみ・穴の まん中）
  const hole = F.loops.length > 1 ? F.loops[1] : F0.loops.length > 1 ? F0.loops[1] : null;
  const pts = [];
  if (hole) { let x = 0, z = 0; for (const p of hole) { x += p[0]; z += p[1]; } pts.push([x / hole.length, z / hole.length]); }
  else { const bb = F0.bb; for (let t = 0; t < 30 && pts.length < 2; t++) { const x = rnd(R, bb[0] + 2, bb[2] - 2), z = rnd(R, bb[1] + 2, bb[3] - 2); if (!F.rects.some(r => inR(r, x, z, 1.2)) && lot.rects.some(r => inR(r, x, z, -1))) pts.push([x, z]); } }
  for (const [x, z] of pts) { if (room() < 80) break; B.flat(GND.lawn, [x - 3, z - 3, x + 3, z + 3], 0.05, WH, { su: 4 }); tree(B, x, z, 0.05, rnd(R, 3.5, 5), rnd(R, 1.2, 1.8), '#5f8448', R); }
  for (const e of lot.edges) { if (room() < 30) break; if (e.nx * n[0] + e.nz * n[1] > 0.5) continue; fence(B, e, 0.05, e.L - 0.05, L.fen || 'wall', false, L, R); }
}
const CLOOK = [
  { n: '白い塗り壁・中庭', w: 'stucco', wc: '#f3f2ee', rf: 'flat', fr: 2, dr: 1, fen: 'wall', fenc: '#efede8', fc: '#b9bbbd' },
  { n: '木と瓦の中庭', w: 'board', wc: '#6a5442', rf: 'gable', rm: 'kawara', rc: '#959ca5', p: 0.42, oh: 0.8, fr: 1, wst: 'wa', dr: 4, fen: 'wood' },
  { n: 'グレーのガルバ・中庭', w: 'galva', wc: '#5a5c60', rf: 'gable', rm: 'seam', rc: '#3a3b3e', p: 0.3, oh: 0.5, fr: 2, dr: 2, fen: 'slat', fenc: '#2f3032' },
  { n: 'レンガ色の中庭', w: 'tile', wc: '#b47d64', rf: 'hip', rm: 'slate', rc: '#4b4e54', p: 0.4, oh: 0.5, fr: 1, dr: 0, fen: 'blockf' },
];
A.arch('h_court', { looks: CLOOK, build: courtBuild, far: (L, P) => ({ H: HB + clamp(P.f || 1, 1, 2) * FH + (L.rf === 'flat' ? 0.5 : 0), base: 0, wall: FAR1, bw: 4.2, fh: FH, tb: 2, tf: 2, roof: null, rc: L.rf === 'flat' ? [0.7, 0.7, 0.68] : roofAvg(L.rm || 'kawara', L.rc), rt: L.rf === 'flat' ? 'flat' : 'gable', p: L.p || 0.42, ins: 1.6, wc: wallAvg(L.w, L.wc) }) });

/* ---------- プリセット → 型 ---------- */
const L4 = (arr, idx) => idx.map(i => arr[i]);
A.kinds({
  chumon: ['h_house', { mw: 10, md: 8.6 }],
  house: ['h_house', { mw: 9.1, md: 8.2 }],
  kodate: ['h_house', { mw: 8.2, md: 7.7, looks: L4(LOOK_HOUSE, [0, 1, 2, 3, 8, 5]) }],
  nisetai: ['h_house', { mw: 12.7, md: 9.1, two: true }],
  hira: ['h_house', { mw: 12.7, md: 10, fmax: 1 }],
  sankai: ['h_house', { mw: 6.8, md: 8.6, garage: true }],
  kyosho: ['h_house', { mw: 5.9, md: 7.3, garage: true, looks: L4(LOOK_HOUSE, [0, 2, 4, 5, 8]) }],
  eco: ['h_eco', { mw: 9.6, md: 8.2 }],
  share: ['h_house', { mw: 11, md: 9.1, looks: L4(LOOK_HOUSE, [0, 2, 4, 6, 9]) }],
  yokan: ['h_yokan', { vb: [90, 380, 1300], mw: 12, md: 9.6, cw: 17, cd: 12, fh: 3.1, fins: 3 }],
  wafu: ['h_wafu', { vb: [90, 380, 1300], mw: 13, md: 10, cw: 19, cd: 13, fh: 3.0, cars: 2, fins: 3 }],
  teitaku: ['h_estate', { vb: [90, 380, 1300], mw: 13.5, md: 10.5, cw: 19, cd: 13.5, fh: 3.05, cars: 2, fins: 3, looks: [LOOK_WA[0], LOOK_WA[2], LOOK_WA[5], LOOK_WA[7], LOOK_YO[0], LOOK_YO[5], LOOK_YO[3], LOOK_LUX[0], LOOK_LUX[1], LOOK_LUX[4]] }],
  gotei: ['h_estate', { vb: [90, 380, 1300], mw: 15, md: 11, cw: 22, cd: 15, fh: 3.2, cars: 3, fins: 4, looks: [LOOK_LUX[0], LOOK_LUX[1], LOOK_LUX[2], LOOK_LUX[3], LOOK_WA[0], LOOK_WA[3], LOOK_WA[6], LOOK_YO[0], LOOK_YO[5], LOOK_YO[9]] }],
  poolvilla: ['h_estate', { vb: [90, 380, 1300], mw: 14, md: 10, cw: 20, cd: 13, fh: 3.1, cars: 2, pool: true, fins: 4, looks: [LOOK_LUX[0], LOOK_LUX[1], LOOK_LUX[2], LOOK_LUX[3], LOOK_LUX[4]] }],
  kominka: ['h_wafu', { vb: [90, 380, 1300], mw: 13, md: 10, cw: 17, cd: 12, fh: 3.0, fmax: 2, fins: 3, looks: LOOK_KOMIN }],
  villa: ['h_house', { mw: 11, md: 9, cw: 15, cd: 11, fh: 2.9, looks: LOOK_VILLA }],
  log: ['h_house', { mw: 9, md: 8, cw: 12, cd: 10, fh: 2.8, looks: LOOK_LOG }],
  beachhouse: ['h_house', { mw: 10, md: 8.5, cw: 14, cd: 11, looks: LOOK_BEACH }],
  lowman: ['h_mansion', { looks: ML([0, 1, 2, 4, 5, 6, 8, 11, 16, 3]) }],
  mansion: ['h_mansion', { looks: ML([0, 1, 2, 3, 6, 8, 9, 11, 12, 16]) }],
  luxman: ['h_mansion', { bd: 2.0, looks: ML([7, 9, 10, 1, 3, 13, 15, 17, 12, 0]) }],
  residence: ['h_mansion', { bd: 2.0, looks: ML([13, 14, 17, 9, 7, 10, 5, 4, 3, 1]) }],
  midman: ['h_mansion', { looks: ML([0, 1, 2, 8, 9, 12]) }],
  highman: ['h_mansion', { looks: ML([0, 1, 2, 9, 12, 7]) }],
  family: ['h_mansion', { looks: ML([0, 2, 8, 6, 11, 16]) }],
  designman: ['h_mansion', { looks: ML([3, 15, 7, 17, 1]) }],
  petman: ['h_mansion', { looks: ML([1, 2, 8, 11, 0]) }],
  oneroom: ['h_mansion', { uw: 3.6, bd: 1.2, looks: ML([1, 6, 11, 15, 2]) }],
  smartman: ['h_mansion', { looks: ML([1, 3, 7, 9, 12]) }],
  servapa: ['h_mansion', { looks: ML([9, 7, 1, 10, 3]) }],
  senior: ['h_mansion', { looks: ML([8, 2, 13, 14, 11]) }],
  tenpoman: ['h_mansion', { shop: true, looks: ML([0, 1, 2, 8, 16, 6]) }],
  getaba: ['h_mansion', { shop: true, looks: ML([16, 8, 2, 0, 6]) }],
  resortcondo: ['h_mansion', { bd: 2.0, looks: ML([1, 9, 14, 13, 3, 17]) }],
  complexres: ['h_mansion', { shop: true, looks: ML([1, 9, 3, 7, 12, 2]) }],
  terrace: ['h_row', { st: 'terrace', vb: [100, 480, 1600] }],
  nagaya: ['h_row', { st: 'nagaya', looks: LOOK_NAGA }],
  shotennaga: ['h_row', { st: 'shoten', looks: LOOK_SHOTEN }],
  machiya: ['h_row', { st: 'machiya', looks: LOOK_MACHI }],
  kanban: ['h_row', { st: 'kanban', looks: LOOK_KANBAN }],
  shop: ['h_row', { st: 'shop', looks: LOOK_SHOTEN }],
  apart: ['h_apart', { looks: AL([0, 1, 2, 3, 6, 4]) }],
  mokuapa: ['h_apart', { looks: AL([0, 1, 4, 6, 3]) }],
  tekkotsu: ['h_apart', { looks: AL([2, 1, 0, 7, 6]) }],
  gakusei: ['h_apart', { uw: 4.0, looks: AL([6, 0, 2, 1]) }],
  designapa: ['h_apart', { looks: AL([5, 7, 1, 2]) }],
  bunka: ['h_apart', { uw: 4.5, looks: AL([4, 3, 0, 2]) }],
  danchi: ['h_danchi', { looks: DL([0, 1, 2, 4, 3]) }],
  koei: ['h_danchi', { looks: DL([3, 0, 5, 4, 1]) }],
  shataku: ['h_danchi', { looks: DL([5, 0, 1, 2, 4, 3]) }],
  ryo: ['h_danchi', { looks: DL([6, 5, 7, 1]) }],
  gakuryo: ['h_danchi', { looks: DL([6, 0, 7, 2]) }],
  udorm: ['h_danchi', { looks: DL([7, 6, 0, 5]) }],
  barracks: ['h_danchi', { looks: DL([1, 6, 5, 2]) }],
  tower: ['h_tower', {}],
  supertower: ['h_tower', {}],
  menshin: ['h_tower', { looks: [TLOOK[5], TLOOK[0], TLOOK[3], TLOOK[1]] }],
  stantower: ['h_tower', { shop: true }],
  okushon: ['h_tower', { looks: [TLOOK[3], TLOOK[4], TLOOK[2], TLOOK[0]] }],
  courtyard: ['h_court', {}],
});
})();
