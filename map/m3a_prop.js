/* ===== 風の芽経済組：国土の地図 3D の小物（t65・DB の更新103）=====
   3D の編集モードで 自分の土地に置く 小物（自動販売機・ベンチ・木・遊具・祠 など）
   ・A.prop(kind, { n, col, cols, build(B, P) })：原点は 小物のまん中の地面（y = 0）。m。+z が 正面。P = { col（えらんだ色）, lod（2 近く・1 中）, rng }
   ・頂点は lod 2 で 300 くらいまで・lod 1 で 80 くらいまで（lod 0 は つかわない）
   ・質感は 2まいだけ：q:o（ふつう）・q:a（すかし）。どちらも 4×4 の ます に 小物ごとの絵。白っぽく描いた ますは 頂点の色で そめる
   ・文字・しるし・実在の商品やお店の 色の組み合わせ は 描かない。乱数は P.rng だけ */
(function () {
'use strict';
const A = window.M3A, PT = A.paint, col = A.col, mul = A.mul, mix = A.mix, css = PT.css;
const PI = Math.PI, TAU = PI * 2, WH = [1, 1, 1];
const cl = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---------- ベクトル ---------- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

/* ---------- 色 ---------- */
// えらんだ色（'#rrggbb' でなければ はじめの色）
const pcol = (P, d) => { const c = P && P.col; return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? col(c) : col(d); };
// 色のあざやかさ（0〜1）
const sat = c => { const v = col(c), mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]); return mx > 0 ? (mx - mn) / mx : 0; };

/* ---------- 質感の ます（4×4）の uv ----------
   cu(i, j, x0, y0, x1, y1)：ます（i 左から・j 上から）の中の 四角（ますの中の割合。y は下へ）→ uv 8つ（左下・右下・右上・左上） */
const EU = 1.5 / 512;
function cu(i, j, x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const u0 = (i + x0) / 4 + EU, u1 = (i + x1) / 4 - EU, vb = 1 - (j + y1) / 4 + EU, vt = 1 - (j + y0) / 4 - EU;
  return [u0, vb, u1, vb, u1, vt, u0, vt];
}
// uv を 左右に 返す
const flipU = u => [u[2], u[3], u[0], u[1], u[6], u[7], u[4], u[5]];

/* ---------- 面を書く道具 ---------- */
// 3角を じかに書く（core の BP.tri と同じ しくみ。頂点ごとの法線・色）
function tri(B, m, p0, p1, p2, n0, n1, n2, c0, c1, c2, uv) {
  const bf = B.buf(m); bf.need(33);
  const o = bf.a, s = B.s, rc = B.rc, rs = B.rs, j = B.jit, P = [p0, p1, p2], N = [n0, n1, n2], C = [c0, c1, c2];
  let q = bf.n;
  for (let i = 0; i < 3; i++) {
    const p = P[i], n = N[i], c = C[i];
    o[q] = B.ox + (p[0] * rc - p[2] * rs) * s; o[q + 1] = B.oy + p[1] * s; o[q + 2] = B.oz + (p[0] * rs + p[2] * rc) * s;
    o[q + 3] = n[0] * rc - n[2] * rs; o[q + 4] = n[1]; o[q + 5] = n[0] * rs + n[2] * rc;
    o[q + 6] = c[0] * j; o[q + 7] = c[1] * j; o[q + 8] = c[2] * j;
    o[q + 9] = uv ? uv[i * 2] : 0; o[q + 10] = uv ? uv[i * 2 + 1] : 0;
    q += 11; if (p[1] > B.top) B.top = p[1];
  }
  bf.n = q; B.nv += 3;
}
// 4角（p0→p1→p2→p3 の まわり）。out の がわが おもて（まわりが逆なら 並べかえる）。
//   c：色（1つか 4つ）・uv：8つ（p0〜p3 の順）・ns：頂点ごとの法線（なければ 面の法線）・k：明るさ（1つか 4つ）
function qd(B, m, p0, p1, p2, p3, out, c, uv, ns, k) {
  let n = crs(sub(p1, p0), sub(p2, p0));
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) {
    const t = p1; p1 = p3; p3 = t; n = [-n[0], -n[1], -n[2]];
    if (uv) uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]];
    if (ns) ns = [ns[0], ns[3], ns[2], ns[1]];
    if (Array.isArray(c) && Array.isArray(c[0])) c = [c[0], c[3], c[2], c[1]];
    if (Array.isArray(k)) k = [k[0], k[3], k[2], k[1]];
  }
  const fn = nrm(n), N = ns || [fn, fn, fn, fn];
  const C0 = Array.isArray(c) && Array.isArray(c[0]) ? c.map(col) : [col(c), col(c), col(c), col(c)];
  const C = k == null ? C0 : C0.map((v, i) => sc(v, Array.isArray(k) ? k[i] : k));
  tri(B, m, p0, p1, p2, N[0], N[1], N[2], C[0], C[1], C[2], uv ? [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]] : null);
  tri(B, m, p0, p2, p3, N[0], N[2], N[3], C[0], C[2], C[3], uv ? [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]] : null);
}
// 3角（out の がわが おもて）
function tr(B, m, p0, p1, p2, out, c, uv, k) {
  let n = crs(sub(p1, p0), sub(p2, p0));
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { const t = p1; p1 = p2; p2 = t; n = [-n[0], -n[1], -n[2]]; if (uv) uv = [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]]; }
  const fn = nrm(n), cc = sc(col(c), k == null ? 1 : k);
  tri(B, m, p0, p1, p2, fn, fn, fn, cc, cc, cc, uv);
}
// たての面：外から見て 左下 (x0, z0)・右下 (x1, z1)、y0〜y1。uv：8つ（左下・右下・右上・左上）
function vf(B, m, x0, z0, x1, z1, y0, y1, c, uv, k) {
  const out = [z1 - z0, 0, -(x1 - x0)];   // 左下→右下 を 外から見て → 外向き
  qd(B, m, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [-out[0], 0, -out[2]], c, uv, null, k);
}
// 箱（x0〜x1・y0〜y1・z0〜z1）。fs：書く面（f 前 +z・b 後 -z・l 左 -x・r 右 +x・t 上・u 下）。uv・mm・cc：面ごとの uv・質感・色
function box(B, m, x0, x1, y0, y1, z0, z1, c, fs = 'fblrt', uv = {}, mm = {}, cc = {}) {
  const M = f => mm[f] || m, U = f => uv[f] || null, C = f => cc[f] || c;
  if (fs.includes('f')) vf(B, M('f'), x0, z1, x1, z1, y0, y1, C('f'), U('f'));
  if (fs.includes('b')) vf(B, M('b'), x1, z0, x0, z0, y0, y1, C('b'), U('b'));
  if (fs.includes('r')) vf(B, M('r'), x1, z1, x1, z0, y0, y1, C('r'), U('r'));
  if (fs.includes('l')) vf(B, M('l'), x0, z0, x0, z1, y0, y1, C('l'), U('l'));
  if (fs.includes('t')) qd(B, M('t'), [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], C('t'), U('t'));
  if (fs.includes('u')) qd(B, M('u'), [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], C('u'), U('u'));
}
// 向きのある板・角材（まん中 c・3つの半分の軸 ax（はば）・ay（高さ）・az（あつさ））。fs は box と同じ（f は +az のがわ）
function obb(B, m, c, ax, ay, az, col0, fs = 'fblrt', uv = {}, cc = {}) {
  const P = (i, j, k) => [c[0] + ax[0] * i + ay[0] * j + az[0] * k, c[1] + ax[1] * i + ay[1] * j + az[1] * k, c[2] + ax[2] * i + ay[2] * j + az[2] * k];
  const F = (f, a, b, d, e, out) => { if (fs.includes(f)) qd(B, m, a, b, d, e, out, cc[f] || col0, uv[f] || null); };
  F('f', P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), az);
  F('b', P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), sc(az, -1));
  F('r', P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), ax);
  F('l', P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), sc(ax, -1));
  F('t', P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), ay);
  F('u', P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), sc(ay, -1));
}
// 棒（a → b。n 面・半径 r（a）〜 r2（b））。n ≥ 6 は なめらか（flat で 角ばる）。o：{ cap: 'a' | 'b' | 'ab', rot, uv（ます 8つ）, rep（ますを まわりに 何回）, k: [ka, kb], flat }
function bar(B, m, a, b, r, r2, n, c, o = {}) {
  const d = nrm(sub(b, a)), ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], e1 = nrm(crs(ref, d)), e2 = crs(d, e1);
  const rot = o.rot || 0, sm = n >= 6 && !o.flat, U = o.uv, kk = Math.max(1, Math.round(n / (o.rep || 1))), ka = o.k ? o.k[0] : 1, kb = o.k ? o.k[1] : 1;
  const D = t => add(sc(e1, Math.cos(t)), sc(e2, Math.sin(t)));
  for (let i = 0; i < n; i++) {
    const t0 = rot + i / n * TAU, t1 = rot + (i + 1) / n * TAU, d0 = D(t0), d1 = D(t1), dm = D((t0 + t1) / 2);
    let uv = null;
    if (U) { const f0 = (i % kk) / kk, f1 = f0 + 1 / kk, u0 = U[0] + (U[2] - U[0]) * f0, u1 = U[0] + (U[2] - U[0]) * f1; uv = [u0, U[1], u1, U[1], u1, U[5], u0, U[5]]; }
    qd(B, m, add(a, sc(d0, r)), add(a, sc(d1, r)), add(b, sc(d1, r2)), add(b, sc(d0, r2)), dm, c, uv, sm ? [d0, d1, d1, d0] : null, [ka, ka, kb, kb]);
  }
  const cap = o.cap || '';
  if (cap) for (let i = 0; i < n; i++) {
    const t0 = rot + i / n * TAU, t1 = rot + (i + 1) / n * TAU;
    if (cap.includes('b')) tr(B, m, b, add(b, sc(D(t0), r2)), add(b, sc(D(t1), r2)), d, o.cc || c, null, kb);
    if (cap.includes('a')) tr(B, m, a, add(a, sc(D(t0), r)), add(a, sc(D(t1), r)), sc(d, -1), o.cc || c, null, ka);
  }
}
// 角ばった 柱・台（まん中 cx, cz・n 角・下の半径 r0 → 上の r1・y0〜y1。かどの外接円の半径）。+z の面が 正面（rot = -PI / n）
//   o：{ rot, uvf(i)（面ごとの uv）, uv, top（上のふた：true か 色）, ut（ふたの uv：ます 8つ を 平らに）, bot（下のふた）, k }
function prism(B, m, cx, cz, n, r0, r1, y0, y1, c, o = {}) {
  const rot = o.rot == null ? -PI / n : o.rot, Pt = (t, r, y) => [cx + Math.sin(t) * r, y, cz + Math.cos(t) * r];
  const tuv = (p, r) => { const U = o.ut; return U ? [U[0] + (U[2] - U[0]) * ((p[0] - cx) / (2 * r) + 0.5), U[1] + (U[5] - U[1]) * ((p[2] - cz) / (2 * r) + 0.5)] : [0, 0]; };
  for (let i = 0; i < n; i++) {
    const t0 = rot + i / n * TAU, t1 = rot + (i + 1) / n * TAU, tm = (t0 + t1) / 2;
    qd(B, m, Pt(t0, r0, y0), Pt(t1, r0, y0), Pt(t1, r1, y1), Pt(t0, r1, y1), [Math.sin(tm), 0, Math.cos(tm)], c, o.uvf ? o.uvf(i) : o.uv || null, null, o.k);
    for (const [on, y, r, dn] of [[o.top, y1, r1, 0], [o.bot, y0, r0, 1]]) {
      if (!on) continue; const a = [cx, y, cz], b = Pt(t0, r, y), d = Pt(t1, r, y);
      tr(B, m, a, b, d, [0, dn ? -1 : 1, 0], on === true ? c : on, o.ut ? [...tuv(a, r), ...tuv(b, r), ...tuv(d, r)] : null);
    }
  }
}
// 線にそった 板（点 a → b・はば w。法線 nn の 面に 平ら）
function strip(B, m, a, b, w, nn, c, uv) { const d = nrm(sub(b, a)), p = sc(nrm(crs(nn, d)), w / 2); qd(B, m, sub(a, p), add(a, p), add(b, p), sub(b, p), nn, c, uv); }
// まるい たまの かたまり（葉・花・頭など）。まん中 (cx, cy, cz)・半径 rx, ry, rz・n：まわりの数・L：たての数。
//   o：{ uv（ます 8つ）, jt（でこぼこ 0〜0.3）, bot（下の残り 0〜1。1 は 下の極まで・0 は 半球）, close（下を ふさぐ）, kb（下の暗さ）, R（乱数）, rot }
function blob(B, m, cx, cy, cz, rx, ry, rz, n, L, c, o = {}) {
  const R = o.R, jt = o.jt || 0, bot = o.bot == null ? 1 : o.bot, kb = o.kb == null ? 0.62 : o.kb, rot = o.rot || 0, U = o.uv, cc = col(c);
  const ph0 = -PI / 2 * bot, G = [], NN = [], lb = o.lb || 0, p1 = (o.seed || 0) * 1.7, p2 = (o.seed || 0) * 2.3;   // lb：大きな でこぼこ（3つ・5つの 山）
  for (let j = 0; j <= L; j++) {
    const ph = ph0 + (PI / 2 - ph0) * j / L, cp = Math.cos(ph), sp = Math.sin(ph), row = [], nr = [];
    for (let i = 0; i < n; i++) {
      const t = rot + (i + (o.tw && j % 2 ? 0.5 : 0)) / n * TAU, top = j === L, f = top ? 1 : 1 + jt * (R ? (R() - 0.5) * 2 : 0) + lb * (0.6 * Math.sin(3 * t + p1 + j) + 0.4 * Math.sin(5 * t + p2 - j));
      row.push(top ? [cx, cy + ry, cz] : [cx + Math.cos(t) * cp * rx * f, cy + sp * ry * (1 + (f - 1) * 0.5), cz + Math.sin(t) * cp * rz * f]);
      nr.push(nrm([Math.cos(t) * cp / rx, sp / ry, Math.sin(t) * cp / rz]));
    }
    G.push(row); NN.push(nr);
  }
  const K = nn => { const v = kb + (1 - kb) * (nn[1] * 0.5 + 0.5); return sc(cc, v); };
  // 面ごとに ますの中の ちがう窓（0.55）をはる（つなぎめの 鏡うつしの もようを ださない）
  const UV = (i, j) => { if (!U) return null; const h1 = A.hash(i * 7 + 3, j * 13 + (o.seed || 0)), h2 = A.hash(j * 5 + 11, i * 3 + (o.seed || 0) + 7), f = o.f || 0.55, a = h1 * (1 - f), b = h2 * (1 - f);
    const uu = q => U[0] + (U[2] - U[0]) * q, vv = q => U[1] + (U[5] - U[1]) * q; return [uu(a), vv(b), uu(a + f), vv(b), uu(a + f), vv(b + f), uu(a), vv(b + f)]; };
  for (let j = 0; j < L; j++) for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n, p0 = G[j][i], p1 = G[j][i2], p2 = G[j + 1][i2], p3 = G[j + 1][i], n0 = NN[j][i], n1 = NN[j][i2], n2 = NN[j + 1][i2], n3 = NN[j + 1][i];
    const out = add(add(n0, n1), add(n2, n3)), uv = UV(i, j);
    if (j === L - 1) {   // 上の極（3角）
      let a = p0, b = p1, nb = n1, na = n0, ua = uv ? [uv[0], uv[1], uv[2], uv[3], (uv[4] + uv[6]) / 2, uv[5]] : null;
      const cr = crs(sub(b, a), sub(p2, a)); if (cr[0] * out[0] + cr[1] * out[1] + cr[2] * out[2] < 0) { const t = a; a = b; b = t; const tn = na; na = nb; nb = tn; if (ua) ua = [ua[2], ua[3], ua[0], ua[1], ua[4], ua[5]]; }
      tri(B, m, a, b, p2, na, nb, n2, K(na), K(nb), K(n2), ua);
    } else qd(B, m, p0, p1, p2, p3, out, [K(n0), K(n1), K(n2), K(n3)], uv, [n0, n1, n2, n3]);
  }
  if (o.close) { const yb = G[0][0][1], ctr = [cx, Math.min(yb, cy - ry * bot * 0.9), cz], dn = [0, -1, 0], kc = sc(cc, kb * 0.85);
    for (let i = 0; i < n; i++) { const i2 = (i + 1) % n; tr(B, m, ctr, G[0][i2], G[0][i], dn, kc, U ? [(U[0] + U[2]) / 2, (U[1] + U[5]) / 2, U[0], U[1], U[2], U[1]] : null); } }
}
// 平らな まるい板（まん中 cx, cz・半径 r・高さ y・n 角）。下向きは dn
function disc(B, m, cx, y, cz, r, n, c, dn, rot = 0, U) {
  const nn = dn ? [0, -1, 0] : [0, 1, 0], uv = (x, z) => U ? [U[0] + (U[2] - U[0]) * ((x - cx) / (2 * r) + 0.5), U[1] + (U[5] - U[1]) * ((z - cz) / (2 * r) + 0.5)] : [0, 0];
  for (let i = 0; i < n; i++) { const t0 = rot + i / n * TAU, t1 = rot + (i + 1) / n * TAU, a = [cx + Math.cos(t0) * r, y, cz + Math.sin(t0) * r], b = [cx + Math.cos(t1) * r, y, cz + Math.sin(t1) * r];
    tr(B, m, [cx, y, cz], a, b, nn, c, U ? [...uv(cx, cz), ...uv(a[0], a[2]), ...uv(b[0], b[2])] : null); }
}

// 棒の列（点 → 点）。o：{ cap（はしを ふさぐ）, rot }
function pipe(B, m, pts, r, n, c, o = {}) { for (let i = 0; i + 1 < pts.length; i++) bar(B, m, pts[i], pts[i + 1], r, r, n, c, { rot: o.rot, cap: o.cap ? (i === 0 ? 'a' : '') + (i === pts.length - 2 ? 'b' : '') : '' }); }
// 2次の曲線の 点の列（a → c。取っ手 b。k こに 分ける）
function qpts(a, b, c, k) { const o = []; for (let i = 0; i <= k; i++) { const t = i / k, u = 1 - t; o.push([a[0] * u * u + 2 * b[0] * u * t + c[0] * t * t, a[1] * u * u + 2 * b[1] * u * t + c[1] * t * t, a[2] * u * u + 2 * b[2] * u * t + c[2] * t * t]); } return o; }
// わっか（タイヤなど）：まん中 c・軸 ax（長さ 1）・半径 R・太さ r・まわり n・断面 k
function torus(B, m, c, ax, R, r, n, k, col0) {
  const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], e1 = nrm(crs(ref, ax)), e2 = crs(ax, e1);
  const P = (i, j) => { const t = i / n * TAU, s = j / k * TAU, d = add(sc(e1, Math.cos(t)), sc(e2, Math.sin(t))), nn = add(sc(d, Math.cos(s)), sc(ax, Math.sin(s))); return [add(c, add(sc(d, R), sc(nn, r))), nn]; };
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) {
    const [p0, n0] = P(i, j), [p1, n1] = P(i + 1, j), [p2, n2] = P(i + 1, j + 1), [p3, n3] = P(i, j + 1);
    qd(B, m, p0, p1, p2, p3, add(add(n0, n1), add(n2, n3)), col0, null, [n0, n1, n2, n3]);
  }
}
// たての まるい板（まん中 (cx, cy)・面 z・半径 r。+z 向き。back なら -z 向き）
function vdisc(B, m, cx, cy, z, r, n, c, back) {
  for (let i = 0; i < n; i++) { const t0 = i / n * TAU, t1 = (i + 1) / n * TAU; tr(B, m, [cx, cy, z], [cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, z], [cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, z], [0, 0, back ? -1 : 1], c); }
}
// だ円の 平らな板（地面の すりへった あと など）
function edisc(B, m, cx, y, cz, rx, rz, n, c) {
  for (let i = 0; i < n; i++) { const t0 = i / n * TAU, t1 = (i + 1) / n * TAU; tr(B, m, [cx, y, cz], [cx + Math.cos(t0) * rx, y, cz + Math.sin(t0) * rz], [cx + Math.cos(t1) * rx, y, cz + Math.sin(t1) * rz], [0, 1, 0], c); }
}

/* ---------- 質感 ---------- */
const T = (k, w, h, f, o) => A.tex('q:' + k, w, h, f, o);
// 角の まるい 四角・まる
const rr = (g, x, y, w, h, r, c) => { g.fillStyle = typeof c === 'string' && c[0] !== '#' ? c : css(c); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); };
const ell = (g, x, y, rx, ry, c, a = 0) => { if (c) g.fillStyle = typeof c === 'string' && c[0] !== '#' ? c : css(c); g.beginPath(); g.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), a, 0, TAU); g.fill(); };
// 木の板（横・n 枚）。そめる前提の うすい色
function planks(g, R, x, y, w, h, n, u) {
  const ph = h / n;
  for (let k = 0; k < n; k++) {
    PT.fill(g, x, y + k * ph, w, ph, '#ebe4d8', 0.88 + R() * 0.16);
    g.strokeStyle = 'rgba(120,92,64,.22)'; g.lineWidth = Math.max(1, u);
    for (let q = 0; q < 4; q++) { let yy = y + k * ph + ph * (0.15 + 0.7 * R()); g.beginPath(); g.moveTo(x, yy); for (let t = 1; t <= 8; t++) { yy += (R() - 0.5) * ph * 0.1; g.lineTo(x + w * t / 8, yy); } g.stroke(); }
    if (R() < 0.35) ell(g, x + w * R(), y + k * ph + ph * 0.5, ph * 0.12, ph * 0.18, 'rgba(110,80,55,.35)');
    PT.fill(g, x, y + k * ph + ph - Math.max(1, u * 1.4), w, Math.max(1, u * 1.4), '#6c5946');
  }
}
/* ふつうの質感（4×4 の ます。512）
   行0：自動販売機の 見本の窓・下の 操作パネル（そめる）・横（そめる）・回収箱（そめる）
   行1：石（そめる）・灯籠の 火袋（そめる）・木の板（そめる）・葉
   行2：桜の花・花（プランター）・物置の 正面（そめる）・物置の 横（そめる）
   行3：犬小屋の 正面（そめる）・祠の 正面・木の皮（そめる）・のぼり旗（そめる） */
const TO = () => T('o', 512, 512, (g, w, h, R) => {
  const s = w / 4, u = w / 512, F = (x, y, ww, hh, c, k) => { if (typeof c === 'string' && c[0] !== '#') { g.fillStyle = c; g.fillRect(x, y, ww, hh); } else PT.fill(g, x, y, ww, hh, c, k); };   // 'rgba(…)' も そのまま
  const at = (i, j, f) => { const X = i * s, Y = j * s; g.save(); g.translate(X, Y); g.beginPath(); g.rect(0, 0, s, s); g.clip(); f(X, Y); g.restore(); };
  const N = (X, Y, amp, sz) => PT.noise(g, X, Y, s, s, amp, R, sz || 1);
  // --- 自動販売機の 見本の窓（0.9 × 0.7 m）：3 段 × 9 本・値段の あかり・あったか（赤）／つめた（青）の 札・ボタン
  at(0, 0, () => {
    const mx = s / 0.9, my = s / 0.7, fx = 0.014 * mx, fy = 0.014 * my;
    F(0, 0, s, s, '#4c5155');
    const gr = g.createLinearGradient(0, fy, 0, s - fy); gr.addColorStop(0, '#fdfdfb'); gr.addColorStop(1, '#e6ebec'); g.fillStyle = gr; g.fillRect(fx, fy, s - 2 * fx, s - 2 * fy);
    const DR = [['#c8352e', '#f2efe8'], ['#2b62a8', '#e9eef4'], ['#3f8a46', '#eef3e6'], ['#f1efe9', '#c94b3c'], ['#2a2b2d', '#c9a24a'], ['#e9a03b', '#fff4dc'], ['#7d4a2e', '#e8d2b0'],
      ['#f0d24a', '#3b6fb0'], ['#8a5bb0', '#f1e8f6'], ['#e86f8a', '#fbeef1'], ['#5aa8c8', '#ffffff'], ['#b8bcc0', '#2f3a4a'], ['#d9cba4', '#6b4a2a'], ['#1f4f7a', '#e2e6ea']];
    const rh = (0.7 - 0.028) / 3;
    for (let r = 0; r < 3; r++) {
      const base = 0.014 + r * rh + rh * 0.78;
      F(fx, (base - rh * 0.78) * my, s - 2 * fx, Math.max(1, 0.004 * my), '#d5d9da');
      for (let k = 0; k < 9; k++) {
        const cx = 0.014 + (k + 0.5) * (0.872 / 9), d = A.pick(R, DR), t = R(), c1 = d[0], c2 = d[1];
        const wd = t < 0.35 ? 0.066 : t < 0.55 ? 0.054 : 0.064, ht = t < 0.35 ? 0.122 : t < 0.55 ? 0.104 : 0.158, pet = t >= 0.55;
        const x0 = (cx - wd / 2) * mx, x1 = (cx + wd / 2) * mx, yb = base * my, yt = (base - ht) * my, ww = x1 - x0, hh = yb - yt;
        const g2 = g.createLinearGradient(x0, 0, x1, 0); g2.addColorStop(0, css(c1, 0.68)); g2.addColorStop(0.35, css(c1, 1.12)); g2.addColorStop(1, css(c1, 0.72));
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x0 + ww * 0.15, yb - hh * 0.04, ww, hh * 0.05);
        if (!pet) { g.fillStyle = g2; g.fillRect(x0, yt, ww, hh); F(x0, yt, ww, Math.max(1, hh * 0.05), '#d9dbdb'); F(x0, yt + hh * 0.36, ww, hh * 0.3, c2, 0.96); ell(g, x0 + ww / 2, yt + hh * 0.51, ww * 0.18, hh * 0.08, c1); }
        else {
          const xm = (x0 + x1) / 2, nw = ww * 0.36, yn = yt + hh * 0.24, yc = yt + hh * 0.08;
          F(xm - nw / 2, yt, nw, hh * 0.08, A.pick(R, ['#f2f2ee', '#d33b2f', '#2f62a6', '#3d8a45', '#e9c23d']));
          g.fillStyle = g2; g.beginPath(); g.moveTo(xm - nw / 2, yc); g.lineTo(xm + nw / 2, yc); g.lineTo(x1, yn); g.lineTo(x1, yb); g.lineTo(x0, yb); g.lineTo(x0, yn); g.closePath(); g.fill();
          F(x0, yt + hh * 0.44, ww, hh * 0.34, c2, 0.97); F(x0, yt + hh * 0.52, ww, hh * 0.1, c1, 0.9);
          g.fillStyle = 'rgba(255,255,255,.38)'; g.fillRect(x0 + ww * 0.18, yn, Math.max(1, ww * 0.12), yb - yn);
        }
        // 値段の帯：札（赤か青）・あかり・ボタン
        const sy = (base + 0.006) * my;
        F(x0 - ww * 0.1, sy, ww * 1.2, 0.034 * my, '#d3d8d9');
        F(x0, sy + 0.004 * my, ww * 0.45, 0.009 * my, R() < 0.3 ? '#d23a2e' : '#2f6fc0');
        F(x0 + ww * 0.52, sy + 0.003 * my, ww * 0.46, 0.011 * my, '#2c2f31'); F(x0 + ww * 0.56, sy + 0.006 * my, ww * 0.36, 0.004 * my, R() < 0.5 ? '#7ef08c' : '#ffb24a');
        rr(g, x0 + ww * 0.12, sy + 0.017 * my, ww * 0.76, 0.012 * my, 0.004 * my, '#f7fbff'); F(x0 + ww * 0.14, sy + 0.027 * my, ww * 0.72, Math.max(1, 0.002 * my), 'rgba(90,150,220,.6)');
      }
    }
    // ガラスの うつりこみ
    g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.moveTo(s * 0.12, fy); g.lineTo(s * 0.36, fy); g.lineTo(s * 0.16, s - fy); g.lineTo(-s * 0.08, s - fy); g.closePath(); g.fill();
    F(fx, fy, s - 2 * fx, Math.max(1, u * 2), 'rgba(0,0,0,.18)');
  });
  // --- 自動販売機の 下（0.9 × 0.9 m。そめる）：広告の面（文字なし）・硬貨／お札の口・カードの読みとり・おつりの口・取り出し口・けこみ
  at(1, 0, (X, Y) => {
    F(0, 0, s, s, '#f4f4f2'); N(X, Y, 0.012);
    rr(g, s * 0.04, s * 0.04, s * 0.6, s * 0.55, s * 0.035, '#e2e2df');
    g.save(); g.beginPath(); g.rect(s * 0.04, s * 0.04, s * 0.6, s * 0.55); g.clip();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(s * 0.04, s * 0.42); g.quadraticCurveTo(s * 0.34, s * 0.26, s * 0.64, s * 0.36); g.lineTo(s * 0.64, s * 0.44); g.quadraticCurveTo(s * 0.34, s * 0.34, s * 0.04, s * 0.5); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(s * 0.04, s * 0.5, s * 0.6, s * 0.09); g.restore();
    F(s * 0.68, s * 0.03, s * 0.29, s * 0.6, '#cdcfd0'); F(s * 0.68, s * 0.03, Math.max(1, u * 2), s * 0.6, '#9a9c9d');
    rr(g, s * 0.73, s * 0.07, s * 0.19, s * 0.07, s * 0.01, '#2b2d30'); for (let k = 0; k < 4; k++) F(s * (0.75 + k * 0.04), s * 0.095, s * 0.025, s * 0.018, '#ff6a4a');   // 表示
    rr(g, s * 0.75, s * 0.18, s * 0.07, s * 0.1, s * 0.012, '#8d9092'); F(s * 0.78, s * 0.195, Math.max(1, u * 2.5), s * 0.07, '#1d1f21');   // 硬貨の口
    rr(g, s * 0.86, s * 0.19, s * 0.06, s * 0.08, s * 0.01, '#55585a');   // 返却レバー
    F(s * 0.72, s * 0.32, s * 0.22, s * 0.05, '#4a8f62'); F(s * 0.74, s * 0.338, s * 0.18, s * 0.014, '#121314');   // お札の口
    rr(g, s * 0.75, s * 0.41, s * 0.13, s * 0.1, s * 0.012, '#3a3d40'); ell(g, s * 0.815, s * 0.46, s * 0.035, s * 0.032, '#9fb4c2');   // カードの読みとり
    rr(g, s * 0.73, s * 0.53, s * 0.2, s * 0.07, s * 0.02, '#2a2c2e'); F(s * 0.75, s * 0.535, s * 0.16, s * 0.012, '#5b5e60');   // おつりの口
    F(s * 0.06, s * 0.66, s * 0.6, s * 0.23, '#8f9294'); F(s * 0.08, s * 0.68, s * 0.56, s * 0.19, '#232528');   // 取り出し口
    F(s * 0.08, s * 0.68, s * 0.56, s * 0.07, '#4a4d50'); F(s * 0.08, s * 0.745, s * 0.56, Math.max(1, u * 2), '#9a9da0');
    F(0, s * 0.93, s, s * 0.07, '#3b3c3e'); F(0, s * 0.92, s, Math.max(1, u * 2), '#b9bbbb');
  });
  // --- 自動販売機の 横（そめる）：とびらの さかい・下のガラリ
  at(2, 0, (X, Y) => {
    const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#f8f8f6'); gr.addColorStop(1, '#e8e8e5'); g.fillStyle = gr; g.fillRect(0, 0, s, s); N(X, Y, 0.012);
    F(s * 0.06, 0, Math.max(1, u * 2), s, '#9fa1a1'); F(s * 0.93, 0, Math.max(1, u * 1.5), s, '#c3c4c3');
    F(0, 0, s, s * 0.02, '#b5b6b5'); F(0, s * 0.955, s, s * 0.045, '#3c3d3f');
    for (let k = 0; k < 7; k++) F(s * 0.6, s * (0.8 + k * 0.019), s * 0.3, Math.max(1, s * 0.008), '#606263');
    rr(g, s * 0.2, s * 0.2, s * 0.6, s * 0.42, s * 0.02, 'rgba(0,0,0,.05)');
  });
  // --- 回収箱の 正面（0.42 × 0.85 m。そめる）：ふたの まるい口 2つ
  at(3, 0, (X, Y) => {
    F(0, 0, s, s, '#f2f2ef'); N(X, Y, 0.015);
    F(0, 0, s, s * 0.3, '#e2e3e0'); F(0, s * 0.3, s, Math.max(1, u * 2.5), '#a4a6a5');
    for (const cx of [0.27, 0.73]) { ell(g, s * cx, s * 0.15, s * 0.17, s * 0.085, '#b8bab9'); ell(g, s * cx, s * 0.155, s * 0.13, s * 0.065, '#1c1e20'); }
    rr(g, s * 0.14, s * 0.42, s * 0.72, s * 0.26, s * 0.03, '#e7e8e5');
    F(0, s * 0.95, s, s * 0.05, '#55575a');
  });
  // --- 石（みかげ石。そめる）
  const stone = (X, Y) => {
    F(0, 0, s, s, '#d3d0c8'); N(X, Y, 0.05, 1);
    for (let k = 0; k < 9; k++) ell(g, R() * s, R() * s, s * (0.06 + R() * 0.16), s * (0.04 + R() * 0.1), 'rgba(85,82,74,' + (0.04 + R() * 0.07) + ')', R() * 3);
    for (let k = 0; k < 320; k++) { g.fillStyle = R() < 0.6 ? 'rgba(62,60,55,.5)' : 'rgba(252,250,244,.6)'; g.fillRect(R() * s, R() * s, Math.max(1, u * (1 + R() * 1.5)), Math.max(1, u * (1 + R() * 1.5))); }
    const gm = g.createLinearGradient(0, s * 0.7, 0, s); gm.addColorStop(0, 'rgba(92,108,66,0)'); gm.addColorStop(1, 'rgba(92,108,66,.5)'); g.fillStyle = gm; g.fillRect(0, s * 0.7, s, s * 0.3);
    PT.streaks(g, 0, 0, s, s * 0.8, 5, 0.06, R);
  };
  at(0, 1, stone);
  // --- 灯籠の 火袋（石・火の窓）
  at(1, 1, (X, Y) => {
    stone(X, Y);
    F(s * 0.2, s * 0.14, s * 0.6, s * 0.7, '#a8a59e'); F(s * 0.25, s * 0.2, s * 0.5, s * 0.58, '#24211d');
    const gl = g.createLinearGradient(0, s * 0.2, 0, s * 0.78); gl.addColorStop(0, 'rgba(0,0,0,.4)'); gl.addColorStop(1, 'rgba(90,80,64,.35)'); g.fillStyle = gl; g.fillRect(s * 0.25, s * 0.2, s * 0.5, s * 0.58);
    F(s * 0.22, s * 0.78, s * 0.56, s * 0.05, '#c9c5bc');
  });
  // --- 木の板（横。そめる）
  at(2, 1, (X, Y) => { planks(g, R, 0, 0, s, s, 6, u); N(X, Y, 0.025); });
  // 葉・花の かたまり（n こ。かたまりの 上が 明るく、下に かげ）。pal：暗い → 明るい。sh：かげの色
  const clumps = (n, r0, r1, per, pal, sh, lw, lh) => {
    for (let c = 0; c < n; c++) {
      const cx = R() * s, cy = R() * s, r = s * (r0 + R() * (r1 - r0));
      ell(g, cx + r * 0.12, cy + r * 0.38, r * 1.08, r * 0.92, sh);
      for (let k = 0; k < per; k++) {
        const a = R() * TAU, d = Math.sqrt(R()) * r, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.88;
        const t = cl(0.92 - (y - cy + r) / (2 * r) * 0.8 + (R() - 0.5) * 0.3, 0, 0.999);
        ell(g, x, y, u * (lw + R() * lw), u * (lh + R() * lh), pal[Math.floor(t * pal.length)], R() * PI);
      }
    }
  };
  // --- 葉（そめない）：葉の かたまりと すき間の かげ
  at(3, 1, () => {
    F(0, 0, s, s, '#2a4422');
    clumps(80, 0.045, 0.095, 40, ['#2f4c27', '#37572c', '#416331', '#4b7037', '#577d3d', '#658b44', '#789b4e', '#8fae5d'], 'rgba(10,22,8,.36)', 2, 1.1);
    for (let k = 0; k < 140; k++) ell(g, R() * s, R() * s, u * 1.4, u * 0.8, 'rgba(206,228,160,.45)', R() * PI);
  });
  // --- 桜の花（そめない）：花の かたまり・かげ・小枝
  at(0, 2, () => {
    F(0, 0, s, s, '#c39aa6');
    clumps(90, 0.04, 0.085, 55, ['#dcaab8', '#e6b8c4', '#eec6d0', '#f3d4dc', '#f7e1e7', '#faedf1', '#fdf7f8'], 'rgba(120,78,92,.3)', 1.4, 1.3);
    g.strokeStyle = 'rgba(66,46,50,.7)'; g.lineWidth = Math.max(1, u * 1.3);
    for (let k = 0; k < 6; k++) { let x = R() * s, y = R() * s; g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 3; q++) { x += (R() - 0.5) * s * 0.18; y += (R() - 0.2) * s * 0.1; g.lineTo(x, y); } g.stroke(); }
    for (let k = 0; k < 70; k++) ell(g, R() * s, R() * s, u * 0.9, u * 0.9, 'rgba(196,78,104,.7)');
  });
  // --- 花（プランター。そめない）：葉の上に 同じ色の花が むれて さく
  at(1, 2, () => {
    F(0, 0, s, s, '#243d1e');
    clumps(30, 0.06, 0.11, 34, ['#2f5226', '#3a6230', '#467238', '#558240', '#68944b'], 'rgba(8,16,6,.5)', 2.4, 1.4);
    const FC = ['#d8383c', '#f2c53a', '#f7f4ec', '#8a5cc4', '#ef8fb0', '#ef8a2c', '#c7457a', '#f7f4ec', '#e85a8c'];
    for (let q = 0; q < 26; q++) {
      const c = A.pick(R, FC), gx = R() * s, gy = R() * s, n = 5 + Math.floor(R() * 7);
      for (let k = 0; k < n; k++) {
        const x = gx + (R() - 0.5) * s * 0.16, y = gy + (R() - 0.5) * s * 0.13, r = u * (1.7 + R() * 1.1);
        ell(g, x + u * 0.8, y + u * 1.2, r * 1.9, r * 1.6, 'rgba(15,25,10,.4)');
        for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + k; ell(g, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r * 0.85, r * 0.85, css(c, 0.92 + R() * 0.12)); }
        ell(g, x, y, r * 0.45, r * 0.45, c === '#f2c53a' ? '#8a5a1a' : '#f3d04a');
      }
    }
  });
  // --- 物置の 正面（1.8 × 1.85 m。そめる）：引き戸 2枚（左が 前）・おしこみの取っ手・かぎ・プレスの すじ
  at(2, 2, (X, Y) => {
    F(0, 0, s, s, '#eeede8'); N(X, Y, 0.012);
    const door = (x0, x1, hx) => {
      F(s * x0, s * 0.075, s * (x1 - x0), s * 0.885, '#f1f0eb');
      for (const t of [0.2, 0.38, 0.56, 0.74]) { F(s * x0, s * (0.075 + 0.885 * t), s * (x1 - x0), Math.max(1, u * 2), 'rgba(255,255,255,.7)'); F(s * x0, s * (0.075 + 0.885 * t) + Math.max(1, u * 2), s * (x1 - x0), Math.max(1, u * 1.6), 'rgba(0,0,0,.16)'); }
      rr(g, s * hx, s * 0.43, s * 0.03, s * 0.14, s * 0.01, '#4d4c49'); F(s * hx + s * 0.006, s * 0.44, s * 0.018, s * 0.12, '#2b2a28');
    };
    door(0.49, 0.955, 0.535); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(s * 0.515, s * 0.075, s * 0.018, s * 0.885);
    door(0.045, 0.515, 0.44); ell(g, s * 0.455, s * 0.395, s * 0.012, s * 0.012, '#c9cbcc'); ell(g, s * 0.455, s * 0.395, s * 0.005, s * 0.005, '#3a3a3a');
    F(s * 0.512, s * 0.075, Math.max(1, u * 1.5), s * 0.885, '#cfcec9');
    F(0, 0, s * 0.045, s, '#a8a7a2'); F(s * 0.955, 0, s * 0.045, s, '#a8a7a2');
    F(0, 0, s, s * 0.075, '#8e8d88'); F(0, s * 0.06, s, Math.max(1, u * 2), '#6e6d69');
    F(0, s * 0.96, s, s * 0.04, '#6c6b67'); F(0, s * 0.955, s, Math.max(1, u * 1.5), '#c7c6c1');
  });
  // --- 物置の 横・うしろ（そめる）：たての リブ
  at(3, 2, (X, Y) => {
    F(0, 0, s, s, '#eceae5'); N(X, Y, 0.012);
    for (let k = 0; k < 6; k++) { const x = s * (k + 0.5) / 6; F(x, 0, Math.max(1, u * 2.2), s, 'rgba(255,255,255,.75)'); F(x + Math.max(1, u * 2.2), 0, Math.max(1, u * 2), s, 'rgba(0,0,0,.14)'); }
    F(0, 0, s, s * 0.05, '#9a9994'); F(0, s * 0.96, s, s * 0.04, '#6c6b67');
  });
  // --- 犬小屋の 正面（0.8 × 0.6 m。そめる）：板と アーチの入口
  at(0, 3, (X, Y) => {
    planks(g, R, 0, 0, s, s, 5, u); N(X, Y, 0.02);
    const ax = s * 0.29, aw = s * 0.42, ay = s * 0.3, r = aw / 2;
    g.fillStyle = '#d9cfbf'; g.beginPath(); g.moveTo(ax - u * 4, s); g.lineTo(ax - u * 4, ay + r); g.arc(ax + r, ay + r, r + u * 4, PI, 0); g.lineTo(ax + aw + u * 4, s); g.closePath(); g.fill();
    const gi = g.createLinearGradient(0, ay, 0, s); gi.addColorStop(0, '#16120e'); gi.addColorStop(1, '#3b3026'); g.fillStyle = gi;
    g.beginPath(); g.moveTo(ax, s); g.lineTo(ax, ay + r); g.arc(ax + r, ay + r, r, PI, 0); g.lineTo(ax + aw, s); g.closePath(); g.fill();
    F(ax, s * 0.94, aw, s * 0.06, '#5a4a3a');
  });
  // --- 祠の 正面（0.5 × 0.45 m。そめない）：格子の とびら・金具・しめ縄と 紙垂
  at(1, 3, () => {
    F(0, 0, s, s, '#8a785f');
    for (let k = 0; k < 14; k++) F(R() * s, 0, Math.max(1, u), s, 'rgba(60,45,30,.25)');
    F(s * 0.12, s * 0.16, s * 0.76, s * 0.78, '#231d17');
    for (let k = 0; k <= 10; k++) F(s * (0.12 + k * 0.076) - u, s * 0.16, Math.max(1, u * 2.6), s * 0.78, '#7a6650');
    for (const y of [0.16, 0.4, 0.68, 0.92]) F(s * 0.12, s * y - u, s * 0.76, Math.max(1, u * 3), '#76624c');
    F(s * 0.495, s * 0.16, Math.max(1, u * 3), s * 0.78, '#3a2e22');
    for (const x of [0.13, 0.84]) for (const y of [0.18, 0.86]) F(s * x, s * y, s * 0.04, s * 0.06, '#c8a447');
    ell(g, s * 0.46, s * 0.55, s * 0.018, s * 0.018, '#d4b04e'); ell(g, s * 0.54, s * 0.55, s * 0.018, s * 0.018, '#d4b04e');
    F(0, 0, s, s * 0.1, '#6a5844'); F(0, s * 0.94, s, s * 0.06, '#5d4c3a');
    g.strokeStyle = '#c9b27a'; g.lineWidth = Math.max(1, u * 4); g.beginPath(); g.moveTo(0, s * 0.12); g.quadraticCurveTo(s * 0.5, s * 0.2, s, s * 0.12); g.stroke();
    for (const x of [0.3, 0.7]) { g.fillStyle = '#f6f5f0'; g.beginPath(); const y0 = s * 0.155; g.moveTo(s * x - s * 0.03, y0); g.lineTo(s * x + s * 0.03, y0); g.lineTo(s * x + s * 0.01, y0 + s * 0.06); g.lineTo(s * x + s * 0.04, y0 + s * 0.06); g.lineTo(s * x + s * 0.01, y0 + s * 0.13); g.lineTo(s * x + s * 0.035, y0 + s * 0.13); g.lineTo(s * x - s * 0.01, y0 + s * 0.2); g.lineTo(s * x - s * 0.01, y0 + s * 0.14); g.lineTo(s * x - s * 0.035, y0 + s * 0.14); g.lineTo(s * x - s * 0.01, y0 + s * 0.07); g.lineTo(s * x - s * 0.035, y0 + s * 0.07); g.closePath(); g.fill(); }
  });
  // --- 木の皮（そめる）：たての われ目・横の すじ
  at(2, 3, (X, Y) => {
    F(0, 0, s, s, '#dcd6ce'); N(X, Y, 0.07, 2);
    for (let k = 0; k < 26; k++) { let x = R() * s; g.strokeStyle = 'rgba(55,46,38,' + (0.3 + R() * 0.35) + ')'; g.lineWidth = Math.max(1, u * (1 + R() * 2)); g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= s; y += s / 10) { x += (R() - 0.5) * s * 0.05; g.lineTo(x, y); } g.stroke(); }
    for (let k = 0; k < 40; k++) F(R() * s, R() * s, u * (3 + R() * 7), Math.max(1, u * 1.2), 'rgba(70,58,50,.45)');
  });
  // --- のぼり旗（0.6 × 1.8 m。そめる）：しわ・ぬい目・乳（ポールがわと上）・すそ
  at(3, 3, () => {
    F(0, 0, s, s, '#d2d2cf'); F(s * 0.2, s * 0.07, s * 0.62, s * 0.8, '#fbfbf9');
    for (let k = 0; k < 4; k++) { const x = s * (0.15 + k * 0.22 + R() * 0.06), gw = s * 0.1, gr = g.createLinearGradient(x - gw, 0, x + gw, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.09)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - gw, 0, gw * 2, s); }
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = Math.max(1, u * 1.2); g.strokeRect(s * 0.12, s * 0.035, s * 0.84, s * 0.93);
    for (let k = 0; k < 9; k++) F(0, s * (0.04 + k * 0.106), s * 0.1, s * 0.03, '#dcdcd8');
    for (let k = 0; k < 2; k++) F(s * (0.3 + k * 0.4), 0, s * 0.12, s * 0.025, '#dcdcd8');
    F(0, 0, s * 0.012, s, '#e0e0dc'); F(0, s * 0.972, s, s * 0.028, '#d4d4d0');
  });
});
// ます の uv（名前で）
const UO = {
  vd: cu(0, 0), vl: cu(1, 0), vs: cu(2, 0), bin: cu(3, 0), st: cu(0, 1), fire: cu(1, 1), wd: cu(2, 1), lf: cu(3, 1),
  sk: cu(0, 2), fl: cu(1, 2), shf: cu(2, 2), shs: cu(3, 2), dgf: cu(0, 3), hkf: cu(1, 3), bark: cu(2, 3), flag: cu(3, 3)
};

/* すかしの質感（4×4 の ます。512。alpha）
   左半分（2 ます ずつ）：0 行 自転車の部品 A（荷台）・1 行 部品 B（子どもの いす）・2 行 フレーム（そめる）・3 行 安全さく（パイプ。そめる）
   右半分：(2,0) かごの あみ（そめる）・(3,0) ベンチの わき（鉄）・(2,1) はしご（そめる）・(3,1) 手すりの さく（そめる）
           (2,2) ワイヤーの あみ（そめる）・(3,2) カラスよけネット（そめる）・(2,3) いすの わき（そめる）・(3,3) あき */
const TA = () => T('a', 512, 512, (g, w, h, R) => {
  g.clearRect(0, 0, w, h);
  const s = w / 4, u = w / 512;
  const at = (i, j, ww, f) => { g.save(); g.translate(i * s, j * s); g.beginPath(); g.rect(0, 0, s * ww, s); g.clip(); f(); g.restore(); };
  // 線（点は ます の中の m：z 横・y 上。bx, by：1m の px）
  const mk = (bx, by, H) => {
    const P = (z, y) => [z * bx, (H - y) * by];
    const L = (pts, wd, c) => { g.strokeStyle = c; g.lineWidth = Math.max(1, wd * by); g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke(); };
    const E = (z, y, r, wd, c, a0 = 0, a1 = TAU) => { const q = P(z, y); g.strokeStyle = c; g.lineWidth = Math.max(1, wd * by); g.beginPath(); g.ellipse(q[0], q[1], r * bx, r * by, 0, a0, a1); g.stroke(); };
    const Rr = (z0, y0, z1, y1, rd, c) => { const a = P(z0, y1), b = P(z1, y0); rr(g, a[0], a[1], b[0] - a[0], b[1] - a[1], rd * by, c); };
    return { P, L, E, Rr };
  };
  // 自転車（ママチャリ。1.8 × 1.12 m を 2 ます に。前は 右）。k：0 荷台・1 子どもの いす・2 フレーム
  const bike = k => {
    const { P, L, E, Rr } = mk(2 * s / 1.8, s / 1.12, 1.12), rz = 0.36, fz = 1.46, ay = 0.33;
    if (k === 2) {
      const c = '#f2f2f2'; g.strokeStyle = c; g.lineWidth = 0.065 * s / 1.12; g.lineCap = 'round';
      g.beginPath(); const a = P(1.31, 0.8), c1 = P(1.0, 0.27), b = P(0.79, 0.29); g.moveTo(a[0], a[1]); g.quadraticCurveTo(c1[0], c1[1], b[0], b[1]); g.stroke();
      L([[0.8, 0.28], [0.66, 0.79]], 0.055, c); L([[0.8, 0.28], [rz, ay]], 0.034, c); L([[0.67, 0.74], [rz, ay]], 0.03, c);
      L([[1.3, 0.78], [1.34, 0.94]], 0.065, c); L([[1.31, 0.79], [1.39, 0.55], [fz, ay]], 0.036, c);
      return;
    }
    const BK = '#1c1c1d', SV = '#c8cbcd';
    for (const z of [rz, fz]) {
      E(z, ay, 0.314, 0.05, BK); E(z, ay, 0.28, 0.018, SV);
      const c0 = P(z, ay); g.strokeStyle = 'rgba(205,208,210,.95)'; g.lineWidth = Math.max(1, u * 0.9);
      for (let q = 0; q < 16; q++) { const a = q / 16 * TAU; g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(c0[0] + Math.cos(a) * 0.28 * 2 * s / 1.8, c0[1] + Math.sin(a) * 0.28 * s / 1.12); g.stroke(); }
      Rr(z - 0.035, ay - 0.035, z + 0.035, ay + 0.035, 0.03, SV);
    }
    E(rz, ay, 0.37, 0.024, SV, PI * 0.93, PI * 2.06); E(fz, ay, 0.37, 0.024, SV, PI * 1.05, PI * 1.97);   // どろよけ
    Rr(0.4, 0.22, 0.9, 0.35, 0.06, '#a9acae');   // チェーンケース
    L([[0.66, 0.78], [0.64, 0.88]], 0.026, SV); Rr(0.52, 0.86, 0.78, 0.94, 0.03, '#2a2a2b');   // サドル
    L([[1.34, 0.92], [1.33, 1.02], [1.2, 1.035], [1.12, 1.0]], 0.024, SV); L([[1.15, 1.005], [1.06, 0.985]], 0.04, BK);   // ハンドル
    L([[rz, ay], [0.29, 0.02]], 0.024, SV); Rr(1.47, 0.6, 1.54, 0.68, 0.012, '#dadcdd');   // スタンド・ライト
    if (k === 0) { L([[0.13, 0.79], [0.64, 0.79]], 0.028, SV); L([[0.2, 0.79], [rz, ay]], 0.016, SV); L([[0.52, 0.79], [rz + 0.02, ay]], 0.016, SV); }
    else { L([[0.2, 0.79], [0.6, 0.79]], 0.028, SV); Rr(0.17, 0.8, 0.63, 1.11, 0.06, '#393b3e'); Rr(0.25, 0.86, 0.56, 1.03, 0.04, '#55585c'); }
  };
  at(0, 0, 2, () => bike(0)); at(0, 1, 2, () => bike(1)); at(0, 2, 2, () => bike(2));
  // 安全さく（2.6 × 0.7 m：上と中の パイプ・はしと まん中の 柱）
  at(0, 3, 2, () => { const { L } = mk(2 * s / 2.6, s / 0.7, 0.7), c = '#f0f0f0'; L([[0.04, 0], [0.04, 0.62], [2.56, 0.62], [2.56, 0]], 0.05, c); L([[0.04, 0.3], [2.56, 0.3]], 0.04, c); L([[1.3, 0], [1.3, 0.62]], 0.045, c); });
  // かごの あみ
  at(2, 0, 1, () => { g.fillStyle = '#eeeeee'; const n = 11, lw = Math.max(1, u * 2.4); for (let k = 0; k <= n; k++) { g.fillRect(k * s / n - lw / 2, 0, lw, s); g.fillRect(0, k * s / n - lw / 2, s, lw); } g.fillRect(0, 0, s, u * 7); g.fillRect(0, 0, u * 5, s); g.fillRect(s - u * 5, 0, u * 5, s); g.fillRect(0, s - u * 5, s, u * 5); });
  // ベンチの わき（鋳物。0.72 × 0.9 m。うしろ が 左）
  at(3, 0, 1, () => { const { L } = mk(s / 0.72, s / 0.9, 0.9), z = v => v + 0.36, c = '#3a3b3c';
    L([[z(0.22), 0.0], [z(0.22), 0.63]], 0.05, c); L([[z(0.3), 0.645], [z(-0.19), 0.66]], 0.045, c);
    L([[z(-0.27), 0.0], [z(-0.19), 0.4], [z(-0.31), 0.87]], 0.05, c); L([[z(0.25), 0.405], [z(-0.2), 0.385]], 0.04, c);
    g.strokeStyle = c; g.lineWidth = 0.03 * s / 0.9; g.beginPath(); const P = mk(s / 0.72, s / 0.9, 0.9).P, a = P(z(0.22), 0.1), cc = P(z(0), 0.34), b = P(z(-0.24), 0.1); g.moveTo(a[0], a[1]); g.quadraticCurveTo(cc[0], cc[1], b[0], b[1]); g.stroke();
    L([[z(0.16), 0.012], [z(0.28), 0.012]], 0.03, c); L([[z(-0.33), 0.012], [z(-0.21), 0.012]], 0.03, c); });
  // はしご（2本の 柱と 6段）
  at(2, 1, 1, () => { g.fillStyle = '#eeeeee'; g.fillRect(0, 0, s * 0.1, s); g.fillRect(s * 0.9, 0, s * 0.1, s); for (let k = 0; k < 6; k++) g.fillRect(0, s * (0.07 + k * 0.165), s, s * 0.055); });
  // 手すりの さく（上下の 横と たての 棒）
  at(3, 1, 1, () => { g.fillStyle = '#eeeeee'; g.fillRect(0, 0, s, s * 0.11); g.fillRect(0, s * 0.9, s, s * 0.1); for (let k = 0; k < 6; k++) g.fillRect(s * k / 6, 0, s * 0.055, s); });
  // ワイヤーの あみ（わく つき）
  at(2, 2, 1, () => { g.fillStyle = '#eeeeee'; const n = 10, lw = Math.max(1, u * 1.6); for (let k = 0; k <= n; k++) { g.fillRect(k * s / n - lw / 2, 0, lw, s); g.fillRect(0, k * s / n - lw / 2, s, lw); } const f = u * 6; g.fillRect(0, 0, s, f); g.fillRect(0, s - f, s, f); g.fillRect(0, 0, f, s); g.fillRect(s - f, 0, f, s); });
  // カラスよけネット（ひし形の あみ・むすび目）
  at(3, 2, 1, () => { g.strokeStyle = '#eeeeee'; g.lineWidth = Math.max(1.2, u * 2.1); const n = 9, st = s / n;
    for (let k = -n; k <= 2 * n; k++) { g.beginPath(); g.moveTo(k * st, 0); g.lineTo(k * st + s, s); g.stroke(); g.beginPath(); g.moveTo(k * st, 0); g.lineTo(k * st - s, s); g.stroke(); }
    g.fillStyle = '#eeeeee'; for (let i = 0; i <= n; i++) for (let m = 0; m <= 2 * n; m++) { g.beginPath(); g.arc(i * st + (m % 2) * st / 2, m * st / 2, u * 2.2, 0, TAU); g.fill(); } });
  // いすの わき（0.5 × 0.9 m。うしろ が 左）
  at(2, 3, 1, () => { const { L } = mk(s / 0.5, s / 0.9, 0.9), c = '#eeeeee', z = v => v + 0.25;
    L([[z(0.2), 0], [z(0.18), 0.45]], 0.03, c); L([[z(-0.21), 0], [z(-0.18), 0.45], [z(-0.22), 0.88]], 0.032, c); L([[z(0.2), 0.45], [z(-0.18), 0.45]], 0.03, c); L([[z(0.19), 0.16], [z(-0.2), 0.16]], 0.02, c); });
  // くさり（(3,3) の 左 1/4：たてに 輪 6つ。正面の 輪と 横向きの 輪を かわるがわる。ブランコ。lod 3）
  at(3, 3, 0.25, () => {
    const w = s * 0.25, lh = s / 6;
    for (let k = 0; k < 6; k++) {
      const cy = (k + 0.5) * lh;
      if (k % 2 === 0) { g.strokeStyle = '#eeeeee'; g.lineWidth = Math.max(1.5, w * 0.17); g.beginPath(); g.ellipse(w / 2, cy, w * 0.3, lh * 0.6, 0, 0, TAU); g.stroke(); }
      else { g.fillStyle = '#d8d8d8'; g.fillRect(w / 2 - w * 0.09, cy - lh * 0.66, w * 0.18, lh * 1.32); }
    }
  });
}, { alpha: true });
// 葉の 小枝（すかし・おもてだけ。128）：灰色の 葉が むらがる。頂点の色で 緑・桜の色に そめる（lod 3 の 木）
const TL = () => T('lf', 128, 128, (g, w, h, R) => {
  g.clearRect(0, 0, w, h);
  const u = w / 128;
  for (let k = 0; k < 120; k++) {
    const a = R() * TAU, d = Math.sqrt(R()), x = w / 2 + Math.cos(a) * d * w * 0.42, y = h / 2 + Math.sin(a) * d * h * 0.43, v = Math.round(130 + R() * 120 - d * 35);
    ell(g, x, y, u * (5 + R() * 4.5), u * (2.2 + R() * 1.8), `rgb(${v},${v},${v})`, R() * PI);
  }
}, { alpha: true, front: true });
const UL = [0.01, 0.01, 0.99, 0.01, 0.99, 0.99, 0.01, 0.99];
// ます の uv（すかし）
const UA = {
  bikeA: [0 + EU, 0.75 + EU, 0.5 - EU, 0.75 + EU, 0.5 - EU, 1 - EU, 0 + EU, 1 - EU], bikeB: [0 + EU, 0.5 + EU, 0.5 - EU, 0.5 + EU, 0.5 - EU, 0.75 - EU, 0 + EU, 0.75 - EU],
  bikeF: [0 + EU, 0.25 + EU, 0.5 - EU, 0.25 + EU, 0.5 - EU, 0.5 - EU, 0 + EU, 0.5 - EU], fence: [0 + EU, 0 + EU, 0.5 - EU, 0 + EU, 0.5 - EU, 0.25 - EU, 0 + EU, 0.25 - EU],
  bskt: cu(2, 0), bench: cu(3, 0), ladder: cu(2, 1), rail: cu(3, 1), mesh: cu(2, 2), net: cu(3, 2), chair: cu(2, 3), chain: cu(3, 3, 0, 0, 0.25, 1)
};
// 葉の 小枝の 板（lod 3 の 木）：だ円体（まん中 c・半径 rx, ry, rz）の まわりに k まい（上の ほうに 多く）。
//   板は 外向きから 少し かたむける。光の 向き（法線）は 外向き（ふんわり）。sz：板の はば（m）
function leafCards(B, c, rx, ry, rz, k, col0, R, sz) {
  const ml = TL();
  for (let i = 0; i < k; i++) {
    const y = Math.min(1, -0.35 + R() * 1.35), th = R() * TAU, rr = Math.sqrt(Math.max(0, 1 - y * y)), d0 = [Math.cos(th) * rr, y, Math.sin(th) * rr], f = 0.86 + R() * 0.14;
    const p = [c[0] + d0[0] * rx * f, c[1] + d0[1] * ry * f, c[2] + d0[2] * rz * f], n = nrm([d0[0] / rx, d0[1] / ry, d0[2] / rz]);
    const tn = nrm(add(n, [(R() - 0.5) * 1.4, (R() - 0.5) * 1.0, (R() - 0.5) * 1.4]));   // 板の 向き（外向きから かたむける）
    const t1 = nrm(Math.abs(tn[1]) < 0.95 ? crs([0, 1, 0], tn) : [1, 0, 0]), t2 = crs(tn, t1), a = R() * TAU;
    const uu = add(sc(t1, Math.cos(a)), sc(t2, Math.sin(a))), vv = crs(tn, uu), w = sz * (0.8 + R() * 0.4) / 2, h = w * 1.33;
    const P = (i2, j2) => add(p, add(sc(uu, i2 * w), sc(vv, j2 * h)));
    const cc = mul(col0, 0.82 + R() * 0.3);
    qd(B, ml, P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), tn, cc, UL, [n, n, n, n]);                       // おもて
    qd(B, ml, P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), sc(tn, -1), cc, flipU(UL), [n, n, n, n]);         // うら（同じ 外向きの 光）
  }
}

/* ---------- 小物 ---------- */
const CONC = [0.7, 0.69, 0.66];   // コンクリート

// 自動販売機（1.0 × 0.72 × 1.83 m）と 横の 回収箱。見本の窓は 明かり（頂点の色 1.3）
const VC = ['#ecebe6', '#c4c8ca', '#2f5e9c', '#3f7c4c', '#b5352e', '#36383b'];
A.prop('vend', { n: '自動販売機', col: true, cols: VC, build(B, P) {
  const lod = P.lod, c = pcol(P, VC[0]), mo = TO(), x0 = -0.74, x1 = 0.26, z0 = -0.36, z1 = 0.36, H = 1.83, yb = lod >= 2 ? 0.04 : 0;
  if (lod >= 2) box(B, 'c', x0 - 0.05, 0.8, -0.12, yb, z0 - 0.04, z1 + 0.1, CONC);   // コンクリートの 台
  box(B, mo, x0, x1, yb - (lod >= 2 ? 0 : 0.08), H, z0, z1, c, 'blr', { b: UO.vs, r: UO.vs, l: flipU(UO.vs) });
  qd(B, 'c', [x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], [0, 1, 0], mul(c, 0.9));
  vf(B, mo, x0, z1, x1, z1, yb, 0.98, c, UO.vl);                 // 下の 操作パネル（そめる）
  vf(B, 'c', x0, z1, x1, z1, 0.98, H, c);                        // 上の わく
  const dx0 = x0 + 0.05, dx1 = x1 - 0.05, dy0 = 1.03, dy1 = 1.76, dz = z1 + (lod >= 2 ? 0.03 : 0.012);
  vf(B, mo, dx0, dz, dx1, dz, dy0, dy1, WH, UO.vd, 1.3);          // 見本の窓（明かり）
  if (lod >= 2) {
    box(B, 'c', dx0, dx1, dy0, dy1, z1, dz, [0.36, 0.38, 0.4], 'lrtu');
    box(B, 'c', x0 - 0.012, x1 + 0.012, H, H + 0.035, z0 - 0.01, z1 + 0.03, mul(c, 0.82));   // 上の ふち
  }
  // 回収箱（0.42 × 0.36 × 0.85 m）
  const cb = mix(c, WH, 0.12), bx0 = 0.32, bx1 = 0.74, bz0 = 0.0, bz1 = 0.36, bh = 0.85;
  box(B, 'c', bx0, bx1, yb - 0.06, bh, bz0, bz1, cb, 'blrt', {}, {}, { t: mul(cb, 0.88) });
  vf(B, mo, bx0, bz1, bx1, bz1, yb - 0.06, bh, cb, UO.bin);
  if (lod < 3) return;
  // すぐ近く（lod 3。歩いているとき）：見本の下の ボタン（3段 × 9）・取り出し口の わくと ふた・お金を入れる 面の でっぱり・返却レバー・かどの まるみ・回収箱の 口
  const bt = [0.93, 0.95, 0.98], fr = mul(c, 0.8);
  for (let r = 0; r < 3; r++) {
    const yc = dy1 - (0.014 + r * 0.224 + 0.224 * 0.78 + 0.029) / 0.7 * (dy1 - dy0);
    for (let k = 0; k < 9; k++) { const xc = dx0 + 0.014 + (k + 0.5) * (0.872 / 9); box(B, 'c', xc - 0.022, xc + 0.022, yc - 0.007, yc + 0.007, dz, dz + 0.011, bt, 'flrtu'); }
  }
  for (const [a, b2, y0, y1] of [[-0.695, -0.065, 0.355, 0.375], [-0.695, -0.065, 0.125, 0.145], [-0.695, -0.675, 0.145, 0.355], [-0.085, -0.065, 0.145, 0.355]]) box(B, 'c', a, b2, y0, y1, z1, z1 + 0.02, fr, 'flrtu');
  qd(B, 'c', [-0.672, 0.352, z1 + 0.004], [-0.088, 0.352, z1 + 0.004], [-0.088, 0.165, z1 + 0.028], [-0.672, 0.165, z1 + 0.028], [0, -0.3, 1], [0.16, 0.17, 0.18]);   // 取り出し口の ふた（くもった 黒）
  box(B, 'c', -0.06, 0.23, 0.388, 0.95, z1, z1 + 0.012, mul(c, 0.9), 'lrtu');
  vf(B, mo, -0.06, z1 + 0.012, 0.23, z1 + 0.012, 0.388, 0.95, c, cu(1, 0, 0.68, 0.03, 0.97, 0.63));   // お金を入れる面（少し 前へ）
  box(B, 'c', 0.12, 0.18, 0.73, 0.8, z1 + 0.012, z1 + 0.03, [0.33, 0.35, 0.36], 'flrtu');                                        // 返却レバー
  for (const [x, z] of [[x0, z1], [x1, z1], [x0, z0], [x1, z0]]) bar(B, 'c', [x, yb, z], [x, H, z], 0.012, 0.012, 4, mul(c, 0.86));   // かど
  for (const xh of [0.4334, 0.6266]) { bar(B, 'c', [xh, 0.72, bz1], [xh, 0.72, bz1 + 0.014], 0.075, 0.075, 12, [0.7, 0.71, 0.7]); vdisc(B, 'c', xh, 0.72, bz1 + 0.015, 0.058, 12, [0.1, 0.11, 0.12]); }
} });

// ベンチ（1.8 m・板 3枚＋背の板 2枚・鉄の わき）。色は 板（木の色は 木目・金属の色は ぬり）
const BC = ['#9c6b42', '#c79f72', '#5e4130', '#a9afb3', '#3f5a4d'];
const woody = c => { const v = col(c); return v[0] > v[1] && v[1] > v[2] && sat(c) > 0.3; };
A.prop('bench', { n: 'ベンチ', col: true, cols: BC, build(B, P) {
  const lod = P.lod, c = pcol(P, BC[0]), wood = woody(c), m = wood ? TO() : 'c', U = wood ? UO.wd : null, ma = TA();
  const XL = 0.9, uvS = U ? { t: cu(2, 1, 0, 0.2, 1, 0.35), f: cu(2, 1, 0, 0.35, 1, 0.42), b: cu(2, 1, 0, 0.35, 1, 0.42) } : {};
  const tilt = 0.26, up = [0, Math.cos(tilt), -Math.sin(tilt)], fw = [0, Math.sin(tilt), Math.cos(tilt)];
  if (lod >= 3) {   // すぐ近く（lod 3）：わきの 鋳物を 形に（前の脚・ひじかけ・うしろの脚と背・座の うけ・まるい すじかい・足）と、板の ねじ
    const ic = [0.22, 0.225, 0.23];
    for (const x of [-0.8, 0.8]) {
      const p = (z, y) => [x, y, z];
      pipe(B, 'c', [p(0.22, 0), p(0.22, 0.63)], 0.025, 6, ic);
      pipe(B, 'c', [p(0.31, 0.64), p(0.1, 0.655), p(-0.2, 0.66)], 0.022, 6, ic, { cap: 1 });
      pipe(B, 'c', [p(-0.27, 0), p(-0.19, 0.4), p(-0.31, 0.87)], 0.025, 6, ic, { cap: 1 });
      pipe(B, 'c', [p(0.25, 0.405), p(-0.2, 0.385)], 0.02, 5, ic);
      pipe(B, 'c', qpts(p(0.22, 0.1), p(0, 0.34), p(-0.24, 0.1), 5), 0.015, 5, ic);
      box(B, 'c', x - 0.03, x + 0.03, 0, 0.025, 0.16, 0.28, ic); box(B, 'c', x - 0.03, x + 0.03, 0, 0.025, -0.33, -0.21, ic);
      for (const [z, y] of [[0.17, 0.4365], [0.04, 0.4295], [-0.09, 0.4215]]) disc(B, 'c', x, y, z, 0.009, 6, [0.3, 0.3, 0.31]);   // ねじ
    }
  } else for (const x of [-0.8, 0.8]) qd(B, ma, [x, 0, -0.36], [x, 0, 0.36], [x, 0.9, 0.36], [x, 0.9, -0.36], [Math.sign(x), 0, 0], WH, UA.bench);   // わき（鋳物）
  if (lod < 2) {
    box(B, m, -XL, XL, 0.38, 0.435, -0.17, 0.23, c, 'fblrt', uvS);
    obb(B, m, [0, 0.66, -0.25], [XL, 0, 0], sc(up, 0.14), sc(fw, 0.02), c, 'fbt', U ? { f: cu(2, 1, 0, 0, 1, 0.34), b: cu(2, 1, 0, 0, 1, 0.34) } : {});
    return;
  }
  [[0.17, 0.435], [0.04, 0.428], [-0.09, 0.42]].forEach(([z, y], i) => box(B, m, -XL, XL, y - 0.035, y, z - 0.058, z + 0.058, c, 'fblrt', U ? { t: cu(2, 1, 0, i / 6, 1, i / 6 + 0.14), f: cu(2, 1, 0, i / 6 + 0.14, 1, i / 6 + 0.16), b: cu(2, 1, 0, i / 6 + 0.14, 1, i / 6 + 0.16) } : {}));
  [[0.55, -0.205], [0.72, -0.25]].forEach(([y, z], i) => obb(B, m, [0, y, z], [XL, 0, 0], sc(up, 0.05), sc(fw, 0.016), c, 'fbtulr', U ? { f: cu(2, 1, 0, 0.5 + i / 6, 1, 0.64 + i / 6), b: cu(2, 1, 0, 0.5 + i / 6, 1, 0.64 + i / 6) } : {}));
  const fc = [0.24, 0.245, 0.25];
  if (lod < 3) for (const x of [-0.8, 0.8]) { bar(B, 'c', [x, -0.1, 0.22], [x, 0.63, 0.22], 0.026, 0.026, 4, fc, { rot: PI / 4 }); bar(B, 'c', [x, -0.1, -0.275], [x, 0.4, -0.19], 0.026, 0.026, 4, fc, { rot: PI / 4 }); }
} });

// プランター（木の箱 0.9 × 0.4 m・花の かたまり 3つ）
A.prop('planter', { n: 'プランター', col: false, build(B, P) {
  const mo = TO(), wc = [0.66, 0.5, 0.36], X = 0.45, Z = 0.2, H = 0.36, R = P.rng;
  box(B, mo, -X, X, -0.06, H, -Z, Z, wc, 'fblr', { f: cu(2, 1, 0, 0, 1, 0.5), b: cu(2, 1, 0, 0, 1, 0.5), l: cu(2, 1, 0, 0.5, 0.45, 1), r: cu(2, 1, 0, 0.5, 0.45, 1) });
  qd(B, 'c', [-X, H - 0.04, Z], [X, H - 0.04, Z], [X, H - 0.04, -Z], [-X, H - 0.04, -Z], [0, 1, 0], [0.3, 0.23, 0.17]);   // 土
  if (P.lod < 2) { blob(B, mo, 0, H - 0.04, 0, 0.46, 0.24, 0.19, 5, 1, WH, { uv: UO.fl, bot: 0, kb: 0.7 }); return; }
  if (P.lod >= 3) {   // すぐ近く（lod 3）：葉の かたまり 5つ（こまかく）・その上に 花（1〜2色）・箱の かどの 柱
    const bl = [[-0.3, 0.02, 0.17, 0.19], [-0.1, -0.05, 0.19, 0.22], [0.1, 0.04, 0.2, 0.24], [0.3, -0.02, 0.16, 0.18], [0.0, 0.06, 0.15, 0.16]];
    bl.forEach(([x, z, r, h], i) => blob(B, mo, x, H - 0.06, z, r, h, 0.16, 10, 3, WH, { uv: UO.fl, bot: 0, jt: 0.14, R, kb: 0.6, rot: i * 1.3, seed: i * 31 + 5 }));
    const FC = ['#d8383c', '#f2c53a', '#f7f4ec', '#8a5cc4', '#ef8fb0', '#ef8a2c', '#c7457a', '#e85a8c'], c1 = A.pick(R, FC), c2 = R() < 0.5 ? c1 : A.pick(R, FC);
    for (let k = 0; k < 26; k++) {
      const [x, z, r, h] = bl[k % bl.length], a = R() * TAU, f = Math.sqrt(R()) * 0.82, fx = x + Math.cos(a) * r * f, fz = z + Math.sin(a) * 0.16 * f, fy = H - 0.06 + h * Math.sqrt(1 - f * f) * 0.96;
      blob(B, 'c', fx, fy, fz, 0.028, 0.018, 0.028, 5, 1, mul(k % 3 ? c1 : c2, 0.95 + R() * 0.1), { bot: 0.4, kb: 0.75, rot: R() * TAU });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(B, 'c', sx * X - 0.025, sx * X + 0.025, -0.06, H + 0.02, sz * Z - 0.025, sz * Z + 0.025, mul(wc, 0.8));
  } else [[-0.25, 0.01, 0.22, 0.2], [0.03, -0.02, 0.24, 0.24], [0.28, 0.02, 0.19, 0.18]].forEach(([x, z, r, h], i) =>
    blob(B, mo, x, H - 0.06, z, r, h, 0.175, 7, 2, WH, { uv: UO.fl, bot: 0, jt: 0.16, R, kb: 0.62, rot: i * 1.7, seed: i * 31 }));
  // 箱の ふちの 木（上）
  for (const [a, b] of [[[-X, -Z], [X, -Z]], [[X, -Z], [X, Z]], [[X, Z], [-X, Z]], [[-X, Z], [-X, -Z]]]) { const d = nrm([b[0] - a[0], 0, b[1] - a[1]]), o = [d[2], 0, -d[0]], t = 0.035;
    qd(B, 'c', [a[0], H + 0.012, a[1]], [b[0], H + 0.012, b[1]], [b[0] - o[0] * t, H + 0.012, b[1] - o[2] * t], [a[0] - o[0] * t, H + 0.012, a[1] - o[2] * t], [0, 1, 0], mul(wc, 0.92)); }
} });

// 植木（まるく かりこんだ ツツジの かたまり 3つ・まわりの 土）
A.prop('shrub', { n: '植木', col: false, build(B, P) {
  const mo = TO(), R = P.rng, lc = [0.84, 0.95, 0.84];
  disc(B, 'c', 0, 0.012, 0.08, 0.8, 8, [0.3, 0.26, 0.21]);
  if (P.lod < 2) { blob(B, mo, 0, 0.04, 0, 0.72, 0.7, 0.66, 6, 2, lc, { uv: UO.lf, bot: 0, kb: 0.6 }); return; }
  const k3 = P.lod >= 3;   // すぐ近く（lod 3）：こまかく・小さな かたまりを 足して ふちを でこぼこに・まわりの 石
  blob(B, mo, -0.06, 0.36, -0.05, 0.6, 0.44, 0.55, k3 ? 13 : 8, k3 ? 4 : 3, lc, { uv: UO.lf, bot: 0.5, jt: 0.09, R, kb: 0.5, seed: 1 });
  blob(B, mo, 0.5, 0.2, 0.32, 0.36, 0.27, 0.33, k3 ? 9 : 6, k3 ? 3 : 2, mul(lc, 0.96), { uv: UO.lf, bot: 0.5, jt: 0.1, R, kb: 0.5, rot: 0.4, seed: 2 });
  blob(B, mo, -0.52, 0.17, 0.36, 0.31, 0.24, 0.29, k3 ? 9 : 6, k3 ? 3 : 2, mul(lc, 1.04), { uv: UO.lf, bot: 0.5, jt: 0.1, R, kb: 0.5, rot: 1.1, seed: 3 });
  if (!k3) return;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + R() * 0.6, rr2 = 0.45 + R() * 0.15, x = -0.06 + Math.cos(a) * rr2, z = -0.05 + Math.sin(a) * rr2 * 0.9, h = 0.3 + R() * 0.2;
    blob(B, mo, x, h, z, 0.2 + R() * 0.08, 0.16 + R() * 0.06, 0.2 + R() * 0.08, 7, 2, mul(lc, 0.94 + R() * 0.12), { uv: UO.lf, bot: 0.4, jt: 0.14, R, kb: 0.5, rot: a, seed: 10 + i });
  }
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + R() * 0.3, x = 0.08 + Math.cos(a) * 0.76, z = 0.08 + Math.sin(a) * 0.76;
    blob(B, mo, x, 0.0, z, 0.07 + R() * 0.04, 0.05 + R() * 0.03, 0.06 + R() * 0.03, 6, 1, [0.7, 0.69, 0.66], { uv: UO.st, bot: 0, kb: 0.7, rot: R() * TAU }); }
} });

// 木（庭の木：幹が 2つに わかれて、大きな 葉の かたまりに 小さな かたまり 2つ。高さ 4.8m）
A.prop('tree', { n: '木', col: false, build(B, P) {
  const mo = TO(), R = P.rng, bc = [0.56, 0.5, 0.44], ang = R() * TAU, k = (a, r) => [Math.cos(ang + a) * r, Math.sin(ang + a) * r];
  if (P.lod < 2) { bar(B, mo, [0, -0.1, 0], [0.04, 2.3, 0], 0.12, 0.08, 3, bc, { uv: UO.bark }); blob(B, mo, 0, 3.0, 0, 1.6, 1.6, 1.55, 6, 2, WH, { uv: UO.lf, bot: 0.4, R, jt: 0.12, kb: 0.5 }); return; }
  if (P.lod >= 3) {   // すぐ近く（lod 3）：根もと・枝が 葉の かたまり（10こ）へ のびる・かたまりは こまかく
    bar(B, mo, [0, -0.1, 0], [0.03, 1.8, 0.02], 0.14, 0.09, 9, bc, { uv: UO.bark, rep: 3 });
    for (let i = 0; i < 4; i++) { const a = ang + i * TAU / 4 + 0.4; bar(B, mo, [Math.cos(a) * 0.04, 0.32, Math.sin(a) * 0.04], [Math.cos(a) * 0.42, -0.06, Math.sin(a) * 0.42], 0.075, 0.025, 5, mul(bc, 0.95), { uv: UO.bark }); }
    const CL = [[0.02, 4.1, 0, 0.95]];
    for (let i = 0; i < 6; i++) { const a = ang + i / 6 * TAU + (R() - 0.5) * 0.4, d = 0.95 + R() * 0.3; CL.push([Math.cos(a) * d, 3.0 + (R() - 0.5) * 0.7, Math.sin(a) * d, 0.78 + R() * 0.2]); }
    for (let i = 0; i < 3; i++) { const a = ang + i / 3 * TAU + 0.9, d = 0.6 + R() * 0.2; CL.push([Math.cos(a) * d, 2.45 + R() * 0.25, Math.sin(a) * d, 0.62 + R() * 0.12]); }
    bar(B, mo, [0.03, 1.75, 0.02], [0.02, 3.6, 0], 0.08, 0.035, 5, bc, { uv: UO.bark });
    for (const [x, y, z] of CL.slice(1)) if (R() < 0.8) bar(B, mo, [0.03, 1.6 + R() * 0.3, 0.02], [x * 0.72, y - 0.3, z * 0.72], 0.06, 0.022, 5, bc, { uv: UO.bark });
    CL.forEach(([x, y, z, r], i) => {
      blob(B, mo, x, y, z, r * 0.9, r * 0.78, r * 0.9, 12, 4, mul(WH, 0.92 + R() * 0.14), { uv: UO.lf, bot: 0.5, R, jt: 0.13, lb: 0.1, kb: 0.42, rot: R() * TAU, seed: 20 + i, tw: 1, f: 0.45 });
      leafCards(B, [x, y, z], r * 0.9, r * 0.78, r * 0.9, 10, [0.44, 0.6, 0.31], R, 0.75);   // ふちの 葉（すかし）
    });
    return;
  }
  bar(B, mo, [0, -0.1, 0], [0.03, 1.8, 0.02], 0.13, 0.09, 6, bc, { uv: UO.bark, rep: 2 });
  const b1 = k(0, 0.7), b2 = k(2.7, 0.65);
  bar(B, mo, [0.03, 1.65, 0.02], [b1[0], 2.95, b1[1]], 0.07, 0.04, 4, bc, { uv: UO.bark });
  blob(B, mo, 0.02, 3.2, 0.0, 1.55, 1.5, 1.5, 8, 3, WH, { uv: UO.lf, bot: 0.45, R, jt: 0.12, lb: 0.12, kb: 0.45, seed: 5, tw: 1, f: 0.5 });
  const c1 = k(0.3, 1.05), c2 = k(3.3, 0.95);
  blob(B, mo, c1[0], 2.75, c1[1], 0.9, 0.78, 0.85, 6, 2, mul(WH, 0.96), { uv: UO.lf, bot: 0.4, R, jt: 0.18, kb: 0.45, rot: 0.5, seed: 6, tw: 1, f: 0.5 });
  blob(B, mo, c2[0], 3.95, c2[1], 0.85, 0.7, 0.8, 6, 2, mul(WH, 1.04), { uv: UO.lf, bot: 0.3, R, jt: 0.18, kb: 0.5, rot: 1.3, seed: 7, tw: 1, f: 0.5 });
} });

// 桜の木（ソメイヨシノの 若木：太く短い幹から 3本の枝が ななめに ひろがり、平たく大きな 花の雲。高さ 5.3m・はば 6.4m）
A.prop('sakura', { n: '桜の木', col: false, build(B, P) {
  const mo = TO(), R = P.rng, bc = [0.4, 0.36, 0.35], ang = R() * TAU;
  if (P.lod < 2) { bar(B, mo, [0, -0.1, 0], [0.05, 2.6, 0], 0.19, 0.12, 3, bc, { uv: UO.bark }); blob(B, mo, 0, 3.4, 0, 3.0, 1.75, 2.8, 6, 2, WH, { uv: UO.sk, bot: 0.35, R, jt: 0.1, kb: 0.5 }); return; }
  if (P.lod >= 3) {   // すぐ近く（lod 3）：根もと・3本の枝から 小枝・花の かたまり 10こ（平たく）
    bar(B, mo, [0, -0.1, 0], [0.06, 1.3, 0.03], 0.24, 0.18, 9, bc, { uv: UO.bark, rep: 3 });
    for (let i = 0; i < 4; i++) { const a = ang + i * TAU / 4 + 0.7; bar(B, mo, [Math.cos(a) * 0.08, 0.35, Math.sin(a) * 0.08], [Math.cos(a) * 0.55, -0.06, Math.sin(a) * 0.55], 0.11, 0.035, 5, mul(bc, 0.95), { uv: UO.bark }); }
    const CL = [[0, 4.2, 0, 1.45]];
    [0, 2.1, 4.2].forEach((a, i) => {
      const r = 1.7 + R() * 0.3, e = [Math.cos(ang + a) * r, 2.95 + R() * 0.3, Math.sin(ang + a) * r];
      bar(B, mo, [0.06, 1.2, 0.03], e, 0.14, 0.06, 6, bc, { uv: UO.bark, rot: i });
      for (const da of [-0.45, 0.45]) {
        const r2 = r + 0.5 + R() * 0.3, f = [Math.cos(ang + a + da) * r2, 3.3 + R() * 0.3, Math.sin(ang + a + da) * r2];
        bar(B, mo, e, f, 0.06, 0.022, 4, bc, { uv: UO.bark }); CL.push([f[0], f[1] + 0.25, f[2], 1.05 + R() * 0.2]);
      }
      CL.push([e[0] * 0.85, e[1] + 0.6, e[2] * 0.85, 1.2 + R() * 0.2]);
    });
    CL.forEach(([x, y, z, r], i) => {
      blob(B, mo, x, y, z, r * 0.92, r * 0.52, r * 0.92, 13, 4, mul(WH, 0.95 + R() * 0.1), { uv: UO.sk, bot: 0.45, R, jt: 0.1, lb: 0.12, kb: 0.55, rot: R() * TAU, seed: 30 + i, tw: 1, f: 0.42 });
      leafCards(B, [x, y, z], r * 0.92, r * 0.52, r * 0.92, 10, [1.3, 1.1, 1.16], R, 0.8);   // ふちの 花（すかし）
    });
    return;
  }
  bar(B, mo, [0, -0.1, 0], [0.06, 1.3, 0.03], 0.22, 0.17, 5, bc, { uv: UO.bark, rep: 2 });
  [0, 2.1, 4.2].forEach((a, i) => { const r = 1.7 + R() * 0.3; bar(B, mo, [0.06, 1.2, 0.03], [Math.cos(ang + a) * r, 2.95 + R() * 0.3, Math.sin(ang + a) * r], 0.13, 0.06, 3, bc, { uv: UO.bark, rot: i }); });
  blob(B, mo, 0, 3.6, 0, 3.3, 1.4, 3.1, 10, 3, WH, { uv: UO.sk, bot: 0.45, R, jt: 0.1, lb: 0.16, kb: 0.55, rot: ang, seed: 9, tw: 1, f: 0.42 });
  const l1 = [Math.cos(ang + 1) * 0.9, Math.sin(ang + 1) * 0.8];
  blob(B, mo, l1[0], 4.4, l1[1], 1.6, 0.85, 1.5, 6, 2, mul(WH, 1.02), { uv: UO.sk, bot: 0.2, R, jt: 0.15, kb: 0.62, rot: 0.4, seed: 10, tw: 1, f: 0.45 });
} });

// 自転車 1台（ママチャリ：横の絵 2まい（部品・フレーム）＋ハンドル・前かご・サドル・荷台）。x：位置・z0：前後の ずれ・c：フレームの色・v：0 荷台・1 子どもの いす
const BKC = ['#c9ccce', '#eeeeec', '#2a2b2d', '#2c3b5a', '#7a2a2c', '#6d7350', '#8fb3c9', '#d9c9b0', '#3d5a40', '#e7e2d2'];
function bike(B, x, z0, c, v, lod, bk) {
  const ma = TA(), zr = 0.95 + z0, zf = zr - 1.8, L = u => zr - u;   // u：うしろからの m（前は -z）
  const card = (dx, uv, cc) => qd(B, ma, [x + dx, 0, zr], [x + dx, 0, zf], [x + dx, 1.12, zf], [x + dx, 1.12, zr], [1, 0, 0], cc, uv);
  card(0.008, v ? UA.bikeB : UA.bikeA, WH); if (lod < 3) card(-0.008, UA.bikeF, c);
  if (lod < 2) return;
  if (lod >= 3) {   // すぐ近く（lod 3）：タイヤ・ハブ・フレームの パイプを 形に（絵の フレームの かわり）
    const tc = [0.11, 0.11, 0.12], sv = [0.78, 0.8, 0.81], ay = 0.33, Q = (u, y) => [x, y, L(u)];
    for (const u of [0.36, 1.46]) { torus(B, 'c', Q(u, ay), [1, 0, 0], 0.314, 0.024, 14, 3, tc); bar(B, 'c', [x - 0.045, ay, L(u)], [x + 0.045, ay, L(u)], 0.022, 0.022, 5, sv); }
    pipe(B, 'c', qpts(Q(1.31, 0.8), Q(1.0, 0.27), Q(0.79, 0.29), 4), 0.03, 5, c);   // メインの パイプ（下へ まがる）
    pipe(B, 'c', [Q(0.8, 0.28), Q(0.66, 0.79)], 0.026, 5, c);                         // シートの パイプ
    pipe(B, 'c', [Q(0.8, 0.28), Q(0.36, 0.33)], 0.016, 4, c); pipe(B, 'c', [Q(0.67, 0.74), Q(0.36, 0.33)], 0.014, 4, c);   // うしろの 三角
    pipe(B, 'c', [Q(1.3, 0.78), Q(1.34, 0.94)], 0.03, 6, c);                          // ヘッド
    pipe(B, 'c', [Q(1.31, 0.79), Q(1.39, 0.55), Q(1.46, 0.33)], 0.017, 4, sv);       // フォーク
  }
  vf(B, 'c', x - 0.28, L(1.13), x + 0.28, L(1.13), 0.99, 1.02, [0.72, 0.74, 0.75]);                                              // ハンドル
  box(B, ma, x - 0.17, x + 0.17, 0.7, 0.95, L(1.8), L(1.48), bk, 'fblr', { f: UA.bskt, b: UA.bskt, l: UA.bskt, r: UA.bskt });       // 前かご
  qd(B, 'c', [x - 0.08, 0.945, L(0.78)], [x + 0.08, 0.945, L(0.78)], [x + 0.08, 0.945, L(0.52)], [x - 0.08, 0.945, L(0.52)], [0, 1, 0], [0.17, 0.17, 0.18]);   // サドル
  if (v) qd(B, 'c', [x - 0.15, 1.1, L(0.62)], [x + 0.15, 1.1, L(0.62)], [x + 0.15, 1.1, L(0.18)], [x - 0.15, 1.1, L(0.18)], [0, 1, 0], [0.24, 0.25, 0.27]);   // 子どもの いす
  else qd(B, 'c', [x - 0.09, 0.8, L(0.64)], [x + 0.09, 0.8, L(0.64)], [x + 0.09, 0.8, L(0.13)], [x - 0.09, 0.8, L(0.13)], [0, 1, 0], [0.62, 0.64, 0.65]);       // 荷台
}
// 自転車置き場（前輪を さす 低い ラック 2.5m に 3〜4台。前輪が うしろ（-z））
A.prop('bikes', { n: '自転車置き場', col: false, build(B, P) {
  const lod = P.lod, R = P.rng, ma = TA(), RW = 1.25, rz = -0.78, rc = [0.64, 0.66, 0.67];
  box(B, 'c', -RW, RW, -0.05, 0.05, rz - 0.12, rz + 0.12, rc);
  if (lod >= 3) {   // すぐ近く（lod 3）：ラックの パイプ（上の 横・たて）
    bar(B, 'c', [-RW, 0.385, rz], [RW, 0.385, rz], 0.018, 0.018, 6, rc, { cap: 'ab' });
    for (let k = 0; k <= 12; k++) { const x = -RW + 0.03 + (2 * RW - 0.06) * k / 12; bar(B, 'c', [x, 0.05, rz], [x, 0.385, rz], 0.009, 0.009, 4, rc); }
  } else if (lod >= 2) for (const s0 of [-1, 1]) qd(B, ma, [s0 < 0 ? -RW : 0, 0.05, rz], [s0 < 0 ? 0 : RW, 0.05, rz], [s0 < 0 ? 0 : RW, 0.4, rz], [s0 < 0 ? -RW : 0, 0.4, rz], [0, 0, 1], rc, UA.rail);
  const xs = [-0.93, -0.31, 0.31, 0.93], skip = lod >= 2 && R() < 0.5 ? Math.floor(R() * 4) : -1;
  xs.forEach((x, i) => { const c = A.pick(R, BKC), v = R() < 0.3 ? 1 : 0, dz = (R() - 0.5) * 0.1, bk = R() < 0.6 ? [0.2, 0.2, 0.21] : [0.78, 0.8, 0.81]; if (i !== skip) bike(B, x, dz, c, v, lod, bk); });
} });

// 石灯籠（春日形：六角の 基礎・まるい 竿・中台・火袋（前と うしろに 火の窓）・笠・宝珠。高さ 2.0m）
A.prop('lantern', { n: '石灯籠', col: false, build(B, P) {
  const mo = TO(), lod = P.lod, c = [0.76, 0.75, 0.72], st = UO.st;
  if (lod < 2) {
    prism(B, mo, 0, 0, 4, 0.34, 0.3, -0.1, 0.2, c, { uv: st }); bar(B, mo, [0, 0.2, 0], [0, 1.1, 0], 0.11, 0.1, 4, c, { uv: st, rot: PI / 4 });
    prism(B, mo, 0, 0, 4, 0.22, 0.22, 1.1, 1.45, c, { uvf: i => i % 2 ? st : UO.fire });
    for (let i = 0; i < 4; i++) { const t0 = PI / 4 + i * PI / 2, t1 = t0 + PI / 2, p = (t, r, y) => [Math.sin(t) * r, y, Math.cos(t) * r]; tr(B, mo, p(t0, 0.5, 1.45), p(t1, 0.5, 1.45), [0, 1.8, 0], [Math.sin(t0 + PI / 4), 1, Math.cos(t0 + PI / 4)], c, st); }
    return;
  }
  prism(B, mo, 0, 0, 6, 0.37, 0.34, -0.1, 0.2, c, { uv: st, top: true, ut: st });                                        // 基礎
  bar(B, mo, [0, 0.2, 0], [0, 0.98, 0], 0.105, 0.095, 6, c, { uv: st });                                                  // 竿
  prism(B, mo, 0, 0, 6, 0.17, 0.31, 0.98, 1.13, c, { uv: cu(0, 1, 0, 0, 1, 0.5), top: true, ut: st });                  // 中台
  prism(B, mo, 0, 0, 6, 0.2, 0.2, 1.13, 1.45, mul(c, 0.97), { uvf: i => i % 3 === 0 ? UO.fire : st });                   // 火袋
  // 笠（うすい ふち・下の面・六角の すい。かどは 少し そり上がる）
  const rk = 0.47, Pt = (t, r, y) => [Math.sin(t) * r, y, Math.cos(t) * r], rt = -PI / 6;
  for (let i = 0; i < 6; i++) {
    const t0 = rt + i / 6 * TAU, t1 = rt + (i + 1) / 6 * TAU, tm = (t0 + t1) / 2, a0 = Pt(t0, rk, 1.45), a1 = Pt(t1, rk, 1.45), b0 = Pt(t0, rk, 1.52), b1 = Pt(t1, rk, 1.52);
    b0[1] += 0.035; b1[1] += 0.035; a0[1] += 0.03; a1[1] += 0.03;
    qd(B, mo, a0, a1, b1, b0, [Math.sin(tm), 0, Math.cos(tm)], c, cu(0, 1, 0, 0.8, 1, 0.9));
    tr(B, mo, [0, 1.45, 0], a0, a1, [0, -1, 0], mul(c, 0.85));
    tr(B, mo, b0, b1, [0, 1.75, 0], [Math.sin(tm), 1.4, Math.cos(tm)], c, [st[0], st[1], st[2], st[3], (st[0] + st[2]) / 2, st[5]]);
  }
  blob(B, mo, 0, 1.8, 0, 0.09, 0.15, 0.09, lod >= 3 ? 10 : 6, lod >= 3 ? 4 : 2, c, { uv: st, bot: 0.5, kb: 0.8 });     // 宝珠
  if (lod < 3) return;
  // すぐ近く（lod 3）：反花（基礎の上の ふくらみ）・竿の 節・火袋の 窓の わく（前と うしろ）・笠の かどの 蕨手・宝珠の 下の 請花
  prism(B, mo, 0, 0, 12, 0.29, 0.17, 0.2, 0.27, c, { uv: st });
  for (const [y, r] of [[0.53, 0.112], [0.585, 0.121], [0.64, 0.112]]) bar(B, mo, [0, y - 0.018, 0], [0, y + 0.018, 0], r, r, 10, c, { uv: st });
  const ap = 0.2 * Math.cos(PI / 6), fw = mul(c, 1.04);
  for (const sz of [1, -1]) {
    const za = sz > 0 ? ap : -ap - 0.012, zb = za + 0.012;
    box(B, mo, -0.06, -0.05, 1.181, 1.405, za, zb, fw, 'fblrt', { f: st, b: st }); box(B, mo, 0.05, 0.06, 1.181, 1.405, za, zb, fw, 'fblrt', { f: st, b: st });
    box(B, mo, -0.05, 0.05, 1.386, 1.405, za, zb, fw, 'fbtu', { f: st, b: st }); box(B, mo, -0.05, 0.05, 1.181, 1.2, za, zb, fw, 'fbtu', { f: st, b: st });
  }
  for (let i = 0; i < 6; i++) { const t = rt + i / 6 * TAU; blob(B, mo, Math.sin(t) * 0.46, 1.6, Math.cos(t) * 0.46, 0.035, 0.04, 0.035, 6, 2, c, { uv: st, bot: 0.6, kb: 0.8 }); }
  prism(B, mo, 0, 0, 10, 0.05, 0.085, 1.645, 1.69, c, { uv: st });
} });

// お地蔵さん（石の 台に 立つ 地蔵。赤い よだれかけと 帽子。うしろと 横の 板・前の 柱 2本・木の 切妻屋根の 小さな お堂）
A.prop('jizo', { n: 'お地蔵さん', col: false, build(B, P) {
  const mo = TO(), lod = P.lod, s0 = [0.66, 0.65, 0.61], red = [0.8, 0.16, 0.13], wd = [0.6, 0.47, 0.35], wdk = [0.36, 0.29, 0.23], st = UO.st;
  box(B, mo, -0.25, 0.25, -0.1, 0.24, -0.19, 0.19, s0, 'fblrt', { f: st, b: st, l: st, r: st, t: st });                    // 台石
  bar(B, mo, [0, 0.24, 0], [0, 0.76, 0], 0.15, 0.112, lod >= 3 ? 10 : lod >= 2 ? 6 : 4, s0, { uv: st });                // からだ
  const bib = lod >= 3 ? 8 : lod >= 2 ? 4 : 1, a0 = -1.05, a1 = 1.05, Pb = (t, r, y) => [Math.sin(t) * r, y, Math.cos(t) * r], yb = t => 0.5 + 0.09 * Math.abs(t) / a1;   // よだれかけ（前。下は まるく）
  for (let i = 0; i < bib; i++) { const t0 = a0 + (a1 - a0) * i / bib, t1 = a0 + (a1 - a0) * (i + 1) / bib, tm = (t0 + t1) / 2, r0 = y => 0.112 + (0.775 - y) * 0.2;
    qd(B, 'c', Pb(t0, r0(yb(t0)), yb(t0)), Pb(t1, r0(yb(t1)), yb(t1)), Pb(t1, 0.112, 0.775), Pb(t0, 0.112, 0.775), [Math.sin(tm), 0.3, Math.cos(tm)], red); }
  // お堂
  const X = 0.45, Z0 = -0.36, Z1 = 0.3, H = 1.32, zr = (Z0 + Z1) / 2, yr = H + 0.3, XR = X + 0.12, th = 0.04;
  vf(B, mo, X, Z0, -X, Z0, -0.05, H + 0.02, wd, UO.wd);                                                                    // うしろの 板
  for (let sg = -1; sg <= 1; sg += 2) {
    const ze = sg > 0 ? Z1 + 0.18 : Z0 - 0.14, ye = H - 0.04;
    qd(B, mo, [-XR, ye, ze], [XR, ye, ze], [XR, yr, zr], [-XR, yr, zr], [0, 1, sg * 0.6], wdk, cu(2, 1, 0, 0, 1, 0.6));   // 屋根の 上（板）
    if (lod < 2) continue;
    qd(B, 'c', [-XR, ye - th, ze], [XR, ye - th, ze], [XR, ye, ze], [-XR, ye, ze], [0, 0, sg], wdk);
    for (const sx of [-1, 1]) qd(B, 'c', [sx * XR, ye - th, ze], [sx * XR, yr - th, zr], [sx * XR, yr, zr], [sx * XR, ye, ze], [sx, 0, 0], wdk);
  }
  if (lod < 2) return;
  const k3 = lod >= 3;
  blob(B, mo, 0, 0.87, 0.008, 0.102, 0.112, 0.098, k3 ? 10 : 6, k3 ? 3 : 2, s0, { uv: st, bot: 0.75, kb: 0.75 });            // あたま
  blob(B, 'c', 0, 0.912, -0.018, 0.106, 0.078, 0.104, k3 ? 10 : 6, k3 ? 3 : 2, red, { bot: 0, kb: 0.7, tw: 1 });             // 帽子（毛糸）
  vf(B, mo, X, 0.02, X, Z0, -0.05, H, wd, cu(2, 1, 0, 0, 0.6, 1)); vf(B, mo, -X, Z0, -X, 0.02, -0.05, H, wd, cu(2, 1, 0.4, 0, 1, 1));   // 横の 板
  for (const sx of [-1, 1]) bar(B, 'c', [sx * (X - 0.03), -0.05, Z1 - 0.03], [sx * (X - 0.03), H, Z1 - 0.03], 0.04, 0.04, 4, wdk, { rot: PI / 4 });   // 前の 柱
  B.top = Math.max(B.top, yr);
  if (!k3) return;
  // すぐ近く（lod 3）：帽子の ぼんぼり・合わせた 手・お供え（竹の 花立て 2つ・湯のみ）・屋根の 板の すじ
  blob(B, 'c', 0, 0.99, -0.018, 0.032, 0.03, 0.032, 6, 2, mul(red, 1.05), { bot: 0.8, kb: 0.75 });
  blob(B, mo, 0, 0.6, 0.15, 0.032, 0.056, 0.03, 6, 2, s0, { uv: st, bot: 0.8, kb: 0.8 });
  for (const sx of [-1, 1]) {
    const x = sx * 0.19;
    bar(B, 'c', [x, 0.24, 0.12], [x, 0.37, 0.12], 0.024, 0.024, 8, [0.47, 0.58, 0.33], { cap: 'b' });
    blob(B, mo, x, 0.4, 0.12, 0.06, 0.07, 0.055, 6, 2, [0.85, 0.95, 0.8], { uv: UO.lf, bot: 0.6, kb: 0.6, rot: sx });
    blob(B, 'c', x + 0.012, 0.455, 0.13, 0.026, 0.022, 0.026, 6, 1, sx > 0 ? [0.95, 0.8, 0.2] : [0.62, 0.36, 0.78], { bot: 0.5, kb: 0.8 });
  }
  bar(B, 'c', [0, 0.24, 0.168], [0, 0.276, 0.168], 0.018, 0.021, 8, [0.93, 0.92, 0.88], { cap: 'a' }); disc(B, 'c', 0, 0.271, 0.168, 0.019, 8, [0.5, 0.56, 0.28]);
  for (let sg = -1; sg <= 1; sg += 2) {
    const ze = sg > 0 ? Z1 + 0.18 : Z0 - 0.14, ye = H - 0.04;
    for (const f of [0.33, 0.66]) { const y = ye + (yr - ye) * f + 0.008, z = ze + (zr - ze) * f; bar(B, 'c', [-XR, y, z], [XR, y, z], 0.007, 0.007, 4, mul(wdk, 0.75)); }
  }
} });

// 小さな祠（石の 基壇 2段・木の 社（流造り：前の 屋根が 長い）・銅板の 屋根・千木と 鰹木）
A.prop('hokora', { n: '小さな祠', col: false, build(B, P) {
  const mo = TO(), lod = P.lod, s0 = [0.7, 0.69, 0.66], wd = [0.64, 0.55, 0.45], rf = [0.32, 0.5, 0.44], st = UO.st, su = { f: st, b: st, l: st, r: st, t: st };
  box(B, mo, -0.5, 0.5, -0.12, 0.16, -0.45, 0.45, s0, 'fblrt', su);
  if (lod >= 2) box(B, mo, -0.36, 0.36, 0.16, 0.44, -0.33, 0.29, mul(s0, 1.03), 'fblrt', su);
  const yb = lod >= 2 ? 0.44 : 0.16, X = 0.26, Z0 = -0.22, Z1 = 0.2, Y1 = yb + 0.48;
  box(B, mo, -X, X, yb, Y1, Z0, Z1, wd, 'fblr', { f: UO.hkf, b: UO.wd, l: UO.wd, r: UO.wd }, {}, { f: WH });
  const zr = -0.06, yr = Y1 + 0.28, XR = 0.37, th = 0.035;
  for (const [ze, ye] of [[Z1 + 0.27, Y1 + 0.02], [Z0 - 0.12, Y1 + 0.07]]) {
    const sg = Math.sign(ze - zr);
    qd(B, 'c', [-XR, ye, ze], [XR, ye, ze], [XR, yr, zr], [-XR, yr, zr], [0, 1, sg * 0.7], rf);
    if (lod < 2) continue;
    qd(B, 'c', [-XR, ye - th, ze], [XR, ye - th, ze], [XR, yr - th, zr], [-XR, yr - th, zr], [0, -1, -sg], mul(wd, 0.6));
    qd(B, 'c', [-XR, ye - th, ze], [XR, ye - th, ze], [XR, ye, ze], [-XR, ye, ze], [0, 0, sg], mul(rf, 0.8));
    for (const sx of [-1, 1]) qd(B, 'c', [sx * XR, ye - th, ze], [sx * XR, yr - th, zr], [sx * XR, yr, zr], [sx * XR, ye, ze], [sx, 0, 0], mul(rf, 0.8));
  }
  if (lod < 2) return;
  for (const sx of [-1, 1]) tr(B, mo, [sx * X, Y1, Z0], [sx * X, Y1, Z1], [sx * X, yr - 0.05, zr], [sx, 0, 0], wd, cu(2, 1, 0, 0, 1, 0.4));   // 妻
  bar(B, 'c', [-XR - 0.02, yr + 0.015, zr], [XR + 0.02, yr + 0.015, zr], 0.035, 0.035, 4, mul(rf, 0.85), { rot: PI / 4, cap: 'ab' });   // 棟
  for (const sx of [-1, 1]) for (const d of [-1, 1]) strip(B, 'c', [sx * (XR - 0.01), yr - 0.07, zr + d * 0.12], [sx * (XR - 0.01), yr + 0.2, zr - d * 0.09], 0.045, [sx, 0, 0], mul(rf, 0.9));   // 千木
  for (const x of [-0.13, 0.13]) bar(B, 'c', [x, yr + 0.06, zr - 0.11], [x, yr + 0.06, zr + 0.11], 0.034, 0.034, 4, mul(rf, 0.8), { rot: PI / 4 });   // 鰹木
  if (lod < 3) return;
  // すぐ近く（lod 3）：石段・しめ縄（前）と 紙垂・お供えの 台（三方）と 湯のみ・おもち
  box(B, mo, -0.32, 0.32, -0.1, 0.05, 0.45, 0.66, mul(s0, 0.97), 'fblrt', su);
  const ry = t => Y1 - 0.03 - 0.06 * Math.sin(t * PI), rope = [];
  for (let i = 0; i <= 8; i++) rope.push([-X - 0.02 + (2 * X + 0.04) * i / 8, ry(i / 8), Z1 + 0.035]);
  pipe(B, 'c', rope, 0.016, 6, [0.82, 0.73, 0.48]);
  for (const x of [-0.13, 0.13]) {
    const y0 = ry((x + X + 0.02) / (2 * X + 0.04)) - 0.012, z = Z1 + 0.04, zz = [[x, y0], [x + 0.022, y0 - 0.03], [x - 0.004, y0 - 0.06], [x + 0.022, y0 - 0.09], [x + 0.002, y0 - 0.12]];
    for (let i = 0; i + 1 < zz.length; i++) strip(B, 'c', [zz[i][0], zz[i][1], z], [zz[i + 1][0], zz[i + 1][1], z], 0.02, [0, 0, 1], [0.97, 0.97, 0.95]);
  }
  box(B, 'c', -0.06, 0.06, 0.44, 0.49, 0.215, 0.275, [0.86, 0.78, 0.6]);
  bar(B, 'c', [-0.025, 0.49, 0.245], [-0.025, 0.52, 0.245], 0.013, 0.016, 8, [0.95, 0.95, 0.93], { cap: 'a' });
  blob(B, 'c', 0.03, 0.49, 0.245, 0.022, 0.02, 0.022, 6, 2, [0.97, 0.97, 0.95], { bot: 0.2, kb: 0.85 });
} });

// 外の いす（カフェの いす：木の 座面と 背・鉄の わき）。cx, cz：まん中・fx, fz：正面の 向き
function chair(B, cx, cz, fx, fz, lod) {
  const mo = TO(), ma = TA(), rx = fz, rz = -fx, Pp = (u, v, y) => [cx + rx * u + fx * v, y, cz + rz * u + fz * v], wc = [0.74, 0.55, 0.38], fc = [0.3, 0.31, 0.32];
  obb(B, mo, Pp(0, 0.02, 0.45), [rx * 0.21, 0, rz * 0.21], [0, 0.015, 0], [fx * 0.21, 0, fz * 0.21], wc, 'flrt', { t: cu(2, 1, 0, 0, 1, 0.5), f: cu(2, 1, 0, 0, 1, 0.1), b: cu(2, 1, 0, 0, 1, 0.1), l: cu(2, 1, 0, 0, 1, 0.1), r: cu(2, 1, 0, 0, 1, 0.1) });
  const up = [-fx * 0.12, 0.99, -fz * 0.12];
  obb(B, mo, Pp(0, -0.215, 0.74), [rx * 0.2, 0, rz * 0.2], sc(up, 0.12), [fx * 0.012, 0, fz * 0.012], wc, 'fb', { f: cu(2, 1, 0, 0.3, 1, 0.75), b: cu(2, 1, 0, 0.3, 1, 0.75) });
  if (lod < 2) return;
  if (lod >= 3) {   // すぐ近く（lod 3）：わきの 鉄を 形に（前の脚・うしろの脚と 背の柱・座の わく・下の 横棒）
    for (const u of [-0.19, 0.19]) {
      pipe(B, 'c', [Pp(u, 0.2, 0), Pp(u, 0.18, 0.45)], 0.012, 4, fc);
      pipe(B, 'c', [Pp(u, -0.21, 0), Pp(u, -0.18, 0.45), Pp(u, -0.22, 0.88)], 0.012, 4, fc);
      pipe(B, 'c', [Pp(u, 0.2, 0.44), Pp(u, -0.18, 0.44)], 0.01, 4, fc);
      pipe(B, 'c', [Pp(u, 0.19, 0.16), Pp(u, -0.2, 0.16)], 0.008, 4, fc);
    }
    return;
  }
  for (const u of [-0.2, 0.2]) qd(B, ma, Pp(u, -0.25, 0), Pp(u, 0.25, 0), Pp(u, 0.25, 0.9), Pp(u, -0.25, 0.9), [rx, 0, rz], fc, UA.chair);
}
// パラソルと テーブル（まるい テーブル・いす 2つ・8枚はぎの パラソル。色は パラソル）
const PC = ['#b8453a', '#2f5f86', '#d9a83e', '#4f7a55', '#ece8dd', '#7a5a44'];
A.prop('parasol', { n: 'パラソルとテーブル', col: true, cols: PC, build(B, P) {
  const lod = P.lod, c = pcol(P, PC[0]), mo = TO(), n = 8, R0 = 1.25, ye = 2.06, ya = 2.5, ce = mul(c, 0.92);
  const Pt = (i, r, y) => { const t = i / n * TAU + PI / 8; return [Math.sin(t) * r, y, Math.cos(t) * r]; };
  for (let i = 0; i < n; i++) {   // 布（三角 8枚）と たれ
    const a = Pt(i, R0, ye), b = Pt(i + 1, R0, ye), tm = (i + 0.5) / n * TAU + PI / 8, out = [Math.sin(tm) * 0.4, 1, Math.cos(tm) * 0.4];
    if (lod >= 3) {   // すぐ近く（lod 3）：骨の あいだの 布が すこし さがる・たれの すそも なみに
      const T0 = [0, ya, 0], m2 = [(a[0] + b[0]) / 2 * 0.985, ye - 0.05, (a[2] + b[2]) / 2 * 0.985], md = (p, q, dy) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + dy, (p[2] + q[2]) / 2];
      const ha = md(T0, a, 0), hb = md(T0, b, 0), hm = md(T0, m2, -0.012);
      for (const [p, q, r] of [[T0, ha, hm], [T0, hm, hb], [ha, a, m2], [ha, m2, hm], [hm, m2, b], [hm, b, hb]]) tr(B, 'c', p, q, r, out, c);
      for (const [p, q] of [[a, m2], [m2, b]]) qd(B, 'c', [p[0], p[1] - 0.13, p[2]], [q[0], q[1] - 0.13, q[2]], q, p, [Math.sin(tm), 0, Math.cos(tm)], ce);
      bar(B, 'c', [0, ya - 0.022, 0], [a[0] * 0.99, ye - 0.012, a[2] * 0.99], 0.007, 0.007, 3, [0.86, 0.86, 0.84]);                   // 骨
      bar(B, 'c', [0, 1.72, 0], [a[0] * 0.5, (ya + ye) / 2 - 0.035, a[2] * 0.5], 0.006, 0.006, 3, [0.86, 0.86, 0.84]);               // ささえ
      continue;
    }
    tr(B, 'c', a, b, [0, ya, 0], out, c);
    if (lod >= 2) qd(B, 'c', [a[0], ye - 0.13, a[2]], [b[0], ye - 0.13, b[2]], b, a, [Math.sin(tm), 0, Math.cos(tm)], ce);
  }
  bar(B, 'c', [0, 0.02, 0], [0, ya + 0.08, 0], 0.022, 0.022, lod >= 2 ? 4 : 3, [0.86, 0.86, 0.84]);                              // ポール
  disc(B, mo, 0, 0.72, 0, 0.46, 8, [0.78, 0.6, 0.42], false, PI / 8, UO.wd);                                                                            // テーブル
  if (lod < 2) return;
  prism(B, 'c', 0, 0, 4, 0.3, 0.27, -0.05, 0.03, [0.3, 0.31, 0.32], { rot: PI / 4 }); bar(B, 'c', [0, 0.03, 0], [0, 0.7, 0], 0.05, 0.045, 4, [0.3, 0.31, 0.32], { rot: PI / 4 });   // 台の 脚
  prism(B, mo, 0, 0, 8, 0.46, 0.46, 0.69, 0.72, [0.6, 0.45, 0.31], { uv: cu(2, 1, 0, 0, 1, 0.08), rot: PI / 8 });
  chair(B, 0.78, 0.08, -1, 0, lod); chair(B, -0.78, -0.08, 1, 0, lod);
  if (lod < 3) return;
  // すぐ近く（lod 3）：ポールの ろくろ・てっぺんの 玉・テーブルの カップ 2つ
  bar(B, 'c', [0, 1.68, 0], [0, 1.76, 0], 0.035, 0.035, 8, [0.86, 0.86, 0.84], { cap: 'ab' });
  blob(B, 'c', 0, ya + 0.1, 0, 0.03, 0.04, 0.03, 6, 2, [0.86, 0.86, 0.84], { bot: 0.8, kb: 0.8 });
  for (const [x, z] of [[0.2, 0.1], [-0.2, -0.1]]) {
    disc(B, 'c', x, 0.724, z, 0.06, 10, [0.95, 0.95, 0.93]);
    bar(B, 'c', [x, 0.724, z], [x, 0.79, z], 0.03, 0.036, 10, [0.96, 0.96, 0.94], { cap: 'a' });
    disc(B, 'c', x, 0.78, z, 0.033, 10, [0.3, 0.19, 0.12]);
  }
} });

// すべり台（はしご → 台（高さ 1.5m・手すり）→ ステンレスの すべり面。色は わく）
const SLC = ['#d0483c', '#e2b23a', '#3f72b0', '#4f8f4f', '#e07c34'];
A.prop('slide', { n: 'すべり台', col: true, cols: SLC, build(B, P) {
  const lod = P.lod, c = pcol(P, SLC[0]), ma = TA(), ss = [0.8, 0.82, 0.84], hp = 1.5, z0 = -0.95, z1 = -0.25, X = 0.33;
  box(B, 'c', -X, X, hp - 0.08, hp, z0, z1, mul(c, 0.9), 'fblrtu');                                                               // 台
  if (lod >= 3) {   // すぐ近く（lod 3）：横の 手すりと はしごの 段を パイプに
    for (const sx of [-1, 1]) {
      const x = sx * X;
      bar(B, 'c', [x, hp + 0.72, z0], [x, hp + 0.72, z1], 0.024, 0.024, 8, c); bar(B, 'c', [x, hp + 0.38, z0], [x, hp + 0.38, z1], 0.016, 0.016, 6, c);
      for (let k = 1; k <= 4; k++) { const z = z0 + (z1 - z0) * k / 5; bar(B, 'c', [x, hp, z], [x, hp + 0.72, z], 0.012, 0.012, 6, c); }
    }
    for (let k = 0; k < 6; k++) { const t = 0.125 + k * 0.165, y = hp * (1 - t), z = z0 + (-1.62 - z0) * t; bar(B, 'c', [-0.3, y, z], [0.3, y, z], 0.018, 0.018, 6, c); }
  } else {
    for (const sx of [-1, 1]) qd(B, ma, [sx * X, lod >= 2 ? hp : 0, z0], [sx * X, lod >= 2 ? hp : 0, z1], [sx * X, hp + 0.75, z1], [sx * X, hp + 0.75, z0], [sx, 0, 0], c, UA.rail);   // 横の 手すり
    qd(B, ma, [-0.3, 0, -1.62], [0.3, 0, -1.62], [0.3, hp, z0], [-0.3, hp, z0], [0, 0.4, -1], c, UA.ladder);                        // はしご
  }
  // すべり面（台の前 → 下へ → 平らな おわり）・横の かべ
  const S = [[z1, hp], [1.7, 0.36], [2.15, 0.3]], w = 0.23;
  for (let i = 0; i < 2; i++) { const [za, ya] = S[i], [zb, yb] = S[i + 1];
    qd(B, 'c', [-w, ya, za], [w, ya, za], [w, yb, zb], [-w, yb, zb], [0, 1, 0], ss);
    if (lod >= 2) for (const sx of [-1, 1]) qd(B, 'c', [sx * w, ya, za], [sx * w, yb, zb], [sx * w, yb + 0.15, zb], [sx * w, ya + 0.15, za], [sx, 0, 0], [0.9, 0.91, 0.92]); }
  if (lod < 2) return;
  const np = lod >= 3 ? 8 : 4;   // パイプの まわり（lod 3 は まるく）
  for (const sx of [-1, 1]) for (const z of [z0, z1]) bar(B, 'c', [sx * X, -0.1, z], [sx * X, hp + 0.75, z], 0.035, 0.035, np, c, { rot: PI / 4, cap: lod >= 3 ? 'b' : '' });   // 柱
  bar(B, 'c', [-X, hp + 0.72, z1], [X, hp + 0.72, z1], 0.03, 0.03, np, c, { rot: PI / 4 });                                      // 入口の 横の棒
  for (const sx of [-1, 1]) bar(B, 'c', [sx * 0.3, -0.08, -1.64], [sx * 0.3, hp + 0.05, z0 + 0.02], 0.025, 0.025, np, c, { rot: PI / 4 });   // はしごの 柱
  bar(B, 'c', [0, -0.1, 1.55], [0, 0.42, 1.55], 0.035, 0.035, np, c, { rot: PI / 4 });                                           // すべり面の 足
  if (lod >= 3) for (const sx of [-1, 1]) pipe(B, 'c', S.map(([z, y]) => [sx * w, y + 0.15, z]), 0.022, 6, [0.88, 0.89, 0.9], { cap: 1 });   // すべり面の ふちの まるみ
} });

// ブランコ（2人乗り：A形の 鉄の わく・上の はり・くさり・板の いす・前と うしろの 安全さく。色は わく）
const SWC = ['#3f72b0', '#d0483c', '#4f8f4f', '#e2b23a', '#7a5aa0'];
A.prop('swing', { n: 'ブランコ', col: true, cols: SWC, build(B, P) {
  const lod = P.lod, c = pcol(P, SWC[0]), ma = TA(), X = 1.45, H = 2.3, zf = 0.85, seat = [0.3, 0.26, 0.22], fence = mix(c, WH, 0.15);
  if (lod < 2) {
    bar(B, 'c', [-X - 0.1, H, 0], [X + 0.1, H, 0], 0.05, 0.05, 3, c);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) strip(B, 'c', [sx * X, 0, sz * zf], [sx * X, H, 0], 0.08, [sx, 0, 0], c);
    for (const sx of [-1, 1]) qd(B, 'c', [sx * 0.7 - 0.22, 0.44, 0.09], [sx * 0.7 + 0.22, 0.44, 0.09], [sx * 0.7 + 0.22, 0.44, -0.09], [sx * 0.7 - 0.22, 0.44, -0.09], [0, 1, 0], seat);
    return;
  }
  const k3 = lod >= 3, np = k3 ? 8 : 4;   // すぐ近く（lod 3）：まるい パイプ・くさりの 輪・つりかね・安全さくを パイプに・いすの下の すりへった 土
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(B, 'c', [sx * X, -0.1, sz * zf], [sx * X, H, 0], 0.04, 0.04, np, c, { rot: PI / 4 });   // 足
  bar(B, 'c', [-X - 0.12, H + 0.02, 0], [X + 0.12, H + 0.02, 0], 0.05, 0.05, np, c, { rot: PI / 4, cap: 'ab' });               // はり
  const chc = [0.62, 0.64, 0.66];
  for (const sx of [-1, 1]) {
    const x = sx * 0.72;
    box(B, 'c', x - 0.23, x + 0.23, 0.4, 0.44, -0.09, 0.09, seat);                                                                  // いす
    for (const d of [-0.2, 0.2]) {
      if (!k3) { for (const nn of [[0, 0, 1], [1, 0, 0]]) strip(B, 'c', [x + d, H - 0.02, 0], [x + d, 0.44, 0], 0.018, nn, chc); continue; }   // くさり
      const cx = x + d, top = H - 0.03, L = (top - 0.44) / 6, q = 0.017;
      for (let k = 0; k < 6; k++) { const ya = top - k * L, yb = ya - L;
        qd(B, ma, [cx - q, yb, 0], [cx + q, yb, 0], [cx + q, ya, 0], [cx - q, ya, 0], [0, 0, 1], chc, UA.chain);
        qd(B, ma, [cx, yb, -q], [cx, yb, q], [cx, ya, q], [cx, ya, -q], [1, 0, 0], chc, UA.chain); }
      bar(B, 'c', [cx, H - 0.04, 0], [cx, H + 0.075, 0], 0.014, 0.014, 6, mul(chc, 0.9));                                            // つりかね
      bar(B, 'c', [cx, 0.43, -0.012], [cx, 0.43, 0.012], 0.02, 0.02, 6, mul(seat, 1.3));                                              // いすの 金具
    }
  }
  if (!k3) { for (const z of [-1.95, 1.95]) qd(B, ma, [-1.6, 0, z], [1.6, 0, z], [1.6, 0.68, z], [-1.6, 0.68, z], [0, 0, Math.sign(z)], fence, UA.fence); return; }   // 安全さく
  for (const z of [-1.95, 1.95]) {
    for (const x of [-1.55, 0, 1.55]) bar(B, 'c', [x, -0.05, z], [x, 0.64, z], 0.025, 0.025, 6, fence, { cap: 'b' });
    for (const y of [0.62, 0.3]) bar(B, 'c', [-1.55, y, z], [1.55, y, z], 0.022, 0.022, 6, fence);
  }
  for (const sx of [-1, 1]) edisc(B, 'c', sx * 0.72, 0.006, 0, 0.3, 0.6, 12, [0.46, 0.39, 0.31]);
} });

// ゴミ置き場（コンクリートの 台・うしろと 横に あみの さく・前の 柱・ゴミぶくろ・カラスよけネット・文字なしの 札）
A.prop('gomi', { n: 'ゴミ置き場', col: false, build(B, P) {
  const lod = P.lod, R = P.rng, ma = TA(), X = 0.9, Z0 = -0.5, Z1 = 0.5, H = 1.0, mc = [0.36, 0.48, 0.4], nc = [0.2, 0.42, 0.78];
  if (lod >= 2) box(B, 'c', -X - 0.06, X + 0.06, -0.1, 0.05, Z0 - 0.04, Z1 + 0.12, CONC);
  const y0 = lod >= 2 ? 0.05 : 0;
  vf(B, ma, X, Z0, -X, Z0, y0, H, mc, UA.mesh); vf(B, ma, X, Z1, X, Z0, y0, H, mc, UA.mesh); vf(B, ma, -X, Z0, -X, Z1, y0, H, mc, UA.mesh);
  // ゴミぶくろ（白と 黄色の 半とうめい。上は しばった 口）
  const k3 = lod >= 3;   // すぐ近く（lod 3）：ふくろを ふやす（こまかく・口の むすび目）・さくの 上の わく・うしろの 柱・ネットの おもり
  const bags = lod >= 2 ? [[-0.5, -0.15, 0.3], [0.05, -0.2, 0.34], [0.52, -0.1, 0.3], [-0.2, 0.2, 0.27]] : [[-0.3, -0.05, 0.36], [0.35, -0.1, 0.33]];
  if (k3) bags.push([0.36, 0.22, 0.25], [-0.62, 0.2, 0.22], [0.66, 0.26, 0.2]);
  bags.forEach(([x, z, r], i) => {
    const bc2 = A.pick(R, [[0.93, 0.93, 0.9], [0.95, 0.9, 0.62], [0.9, 0.93, 0.95]]);
    blob(B, 'c', x, y0 + r * 0.7, z, r * (0.9 + R() * 0.2), r, r * 0.85, k3 ? 8 : 5, k3 ? 3 : lod >= 2 ? 2 : 1, bc2, { bot: 0.6, jt: k3 ? 0.11 : 0.08, R, kb: 0.7, rot: i });
    if (k3) blob(B, 'c', x + 0.01, y0 + r * 1.68, z, 0.045, 0.05, 0.04, 5, 2, mul(bc2, 0.97), { bot: 0.7, jt: 0.15, R, kb: 0.75, rot: i });
  });
  // カラスよけネット（ふくろに かぶせる）
  const ny = y0 + 0.68, nz0 = Z0 + 0.08, nz1 = Z1 - 0.02, nx = X - 0.1, rx = 0.45, rzc = -0.02;
  qd(B, ma, [-nx, y0 + 0.02, nz1], [nx, y0 + 0.02, nz1], [rx, ny, rzc], [-rx, ny, rzc], [0, 0.6, 1], nc, UA.net);
  if (lod >= 2) {
    qd(B, ma, [nx, y0 + 0.02, nz0], [-nx, y0 + 0.02, nz0], [-rx, ny, rzc], [rx, ny, rzc], [0, 0.6, -1], nc, UA.net);
    for (const sx of [-1, 1]) tr(B, ma, [sx * nx, y0 + 0.02, nz0], [sx * nx, y0 + 0.02, nz1], [sx * rx, ny, rzc], [sx, 0.6, 0], nc, cu(3, 2, 0, 0, 1, 0.6).slice(0, 6));
    for (const sx of [-1, 1]) bar(B, 'c', [sx * X, -0.1, Z1], [sx * X, H + 0.02, Z1], 0.028, 0.028, 4, mul(mc, 0.85), { rot: PI / 4 });   // 前の 柱
    vf(B, 'c', -0.22, Z0 + 0.02, 0.22, Z0 + 0.02, H - 0.32, H - 0.05, [0.94, 0.94, 0.92]); vf(B, 'c', -0.22, Z0 + 0.025, 0.22, Z0 + 0.025, H - 0.11, H - 0.05, [0.24, 0.55, 0.36]);   // 札（文字なし）
  }
  if (!k3) return;
  const fk = mul(mc, 0.85);
  pipe(B, 'c', [[-X, H, Z1], [-X, H, Z0], [X, H, Z0], [X, H, Z1]], 0.016, 4, fk);
  for (const sx of [-1, 1]) bar(B, 'c', [sx * X, -0.1, Z0], [sx * X, H + 0.02, Z0], 0.028, 0.028, 4, fk, { rot: PI / 4 });
  bar(B, 'c', [-nx, y0 + 0.03, nz1], [nx, y0 + 0.03, nz1], 0.014, 0.014, 4, mul(nc, 0.6));
} });

// のぼり旗（水を入れる 黒い台・白い ポール・上の 横棒・旗 0.6 × 1.8m（少し なびく。まん中は 明るい 無地））。色は 旗
const NC = ['#c8322d', '#2f62a6', '#e2b021', '#2f8a4a', '#e8e6df', '#d9672a', '#7a3f8a'];
A.prop('nobori', { n: 'のぼり旗', col: true, cols: NC, build(B, P) {
  const lod = P.lod, c = pcol(P, NC[0]), mo = TO(), pc = [0.9, 0.9, 0.88], U = UO.flag;
  if (lod >= 3) {   // すぐ近く（lod 3）：水を入れる 台（まるみ・ふた）・ポールの 玉
    prism(B, 'c', 0, 0, 8, 0.21, 0.185, -0.06, 0.2, [0.2, 0.21, 0.22], { top: true });
    bar(B, 'c', [0.08, 0.2, 0.06], [0.08, 0.23, 0.06], 0.035, 0.03, 8, [0.26, 0.27, 0.28], { cap: 'b' });
    blob(B, 'c', 0, 2.875, 0, 0.021, 0.021, 0.021, 6, 2, pc, { bot: 1, kb: 0.8 });
  } else box(B, 'c', -0.19, 0.19, -0.06, 0.2, -0.16, 0.16, [0.2, 0.21, 0.22], lod >= 2 ? 'fblrt' : 'fblr');
  bar(B, 'c', [0, 0.2, 0], [0, 2.86, 0], 0.014, 0.012, lod >= 3 ? 6 : lod >= 2 ? 4 : 3, pc, { rot: PI / 4 });
  const x0 = 0.025, x1 = 0.625, y0 = 0.9, y1 = 2.72, W = lod >= 2 ? [0, 0.04, -0.015, 0.035] : [0, 0], n = lod >= 2 ? 3 : 1;
  if (lod >= 2) bar(B, 'c', [0, y1 + 0.015, 0], [x1 + 0.03, y1 + 0.015, 0], 0.008, 0.008, 3, pc);
  if (lod >= 3) {   // 旗：6 × 4 に 分けて なびかせる（ポールから はなれるほど・上は 横棒に そう）
    const wv = (u, v) => 0.045 * Math.sin(u * 4.2 + v * 1.3 + 0.6) * u * (1 - 0.75 * v), tu = u => U[0] + (U[2] - U[0]) * u, tv = v => U[1] + (U[5] - U[1]) * v;
    const Q = (u, v) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, wv(u, v)];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { const ua = i / 6, ub = (i + 1) / 6, va = j / 4, vb = (j + 1) / 4;
      qd(B, mo, Q(ua, va), Q(ub, va), Q(ub, vb), Q(ua, vb), [0, 0, 1], c, [tu(ua), tv(va), tu(ub), tv(va), tu(ub), tv(vb), tu(ua), tv(vb)]); }
    return;
  }
  for (let i = 0; i < n; i++) {
    const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n, u0 = U[0] + (U[2] - U[0]) * i / n, u1 = U[0] + (U[2] - U[0]) * (i + 1) / n;
    qd(B, mo, [a, y0, W[i]], [b, y0 + 0.01 * i, W[i + 1]], [b, y1, W[i + 1]], [a, y1, W[i]], [0, 0, 1], c, [u0, U[1], u1, U[1], u1, U[5], u0, U[5]]);
  }
} });

// 外灯（公園の あかり：コンクリートの 台・こい灰色の ポール・乳白の まるい あかり（明るく）と かさ。高さ 3.9m）
A.prop('lamp', { n: '外灯', col: false, build(B, P) {
  const lod = P.lod, pc = [0.3, 0.31, 0.32], gl = [1.22, 1.21, 1.16], n = lod >= 3 ? 12 : lod >= 2 ? 8 : 4;
  if (lod >= 2) { box(B, 'c', -0.17, 0.17, -0.1, 0.08, -0.17, 0.17, CONC); bar(B, 'c', [0, 0.08, 0], [0, 0.42, 0], 0.085, 0.072, lod >= 3 ? 10 : 6, pc); }
  bar(B, 'c', [0, -0.05, 0], [0, 3.32, 0], 0.068, 0.045, lod >= 3 ? 10 : lod >= 2 ? 6 : 4, pc);
  if (lod >= 2) bar(B, 'c', [0, 3.3, 0], [0, 3.37, 0], 0.1, 0.13, n, pc);
  if (lod >= 3) {   // すぐ近く（lod 3）：まるい あかり・台の 点検の とびら・てっぺんの 玉
    blob(B, 'c', 0, 3.565, 0, 0.165, 0.198, 0.165, 12, 4, gl, { bot: 1, kb: 1 });
    box(B, 'c', -0.035, 0.035, 0.16, 0.33, 0.066, 0.083, mul(pc, 1.18), 'flrtu');
    blob(B, 'c', 0, 3.95, 0, 0.026, 0.03, 0.026, 6, 2, pc, { bot: 0.5, kb: 0.8 });
  } else bar(B, 'c', [0, 3.37, 0], [0, 3.76, 0], 0.15, 0.15, n, gl);
  const p = (t, r, y) => [Math.sin(t) * r, y, Math.cos(t) * r];
  for (let i = 0; i < n; i++) { const t0 = i / n * TAU, t1 = (i + 1) / n * TAU, tm = (t0 + t1) / 2;
    tr(B, 'c', p(t0, 0.21, 3.75), p(t1, 0.21, 3.75), [0, 3.92, 0], [Math.sin(tm), 1.2, Math.cos(tm)], pc);
    if (lod >= 2) tr(B, 'c', p(t0, 0.21, 3.75), p(t1, 0.21, 3.75), [0, 3.75, 0], [0, -1, 0], mul(pc, 0.8)); }
} });

// 看板（A形の 立て看板：アルミの わく・色の 板・明るい まん中の 面と 色の 帯。文字なし）。色は 板
const SGC = ['#2f5d8a', '#b23a32', '#2f6b45', '#2a2b2d', '#e6b43c', '#f0eee8'];
A.prop('sign', { n: '看板', col: true, cols: SGC, build(B, P) {
  const lod = P.lod, c = pcol(P, SGC[0]), fr = [0.8, 0.81, 0.82], inn = mix(c, WH, 0.9), H = 1.05, W = 0.31, zb = 0.25, zt = 0.025;
  for (const sg of [1, -1]) {
    const Pp = (x, t, o) => [x, H * t, sg * (zb + (zt - zb) * t + o)], out = [0, (zb - zt) / H, 1].map(v => v * sg);
    out[1] = Math.abs(out[1]);
    const pl = (xa, xb, ta, tb, o, cc) => qd(B, 'c', Pp(xa, ta, o), Pp(xb, ta, o), Pp(xb, tb, o), Pp(xa, tb, o), out, cc);
    if (lod >= 2) pl(-W, W, 0.1, 1, 0, fr);
    pl(-W + 0.025, W - 0.025, 0.125, 0.975, 0.006, c);
    pl(-W + 0.07, W - 0.07, 0.22, 0.86, 0.011, inn);
    if (lod < 2) continue;
    pl(-W + 0.07, W - 0.07, 0.7, 0.76, 0.015, c); pl(-W + 0.07, -W + 0.2, 0.3, 0.42, 0.015, mix(c, WH, 0.4));
    for (const x of [-W + 0.012, W - 0.012]) bar(B, 'c', Pp(x, -0.08, 0), Pp(x, 0.11, 0), 0.012, 0.012, lod >= 3 ? 6 : 3, fr);   // 足
    if (lod >= 3) {   // すぐ近く（lod 3）：アルミの わくの パイプ・足の ゴム
      const e = [Pp(-W + 0.01, 0.1, 0.004), Pp(W - 0.01, 0.1, 0.004), Pp(W - 0.01, 1, 0.004), Pp(-W + 0.01, 1, 0.004)];
      pipe(B, 'c', [...e, e[0]], 0.011, 4, fr);
      for (const x of [-W + 0.012, W - 0.012]) { const p = Pp(x, -0.08, 0); box(B, 'c', x - 0.018, x + 0.018, p[1] - 0.01, p[1] + 0.025, p[2] - 0.02, p[2] + 0.02, [0.15, 0.15, 0.16]); }
    }
  }
  if (lod < 2) return;
  bar(B, 'c', [-W - 0.01, H - 0.01, 0], [W + 0.01, H - 0.01, 0], 0.03, 0.03, 4, fr, { rot: PI / 4, cap: 'ab' });                 // 上の ちょうつがい
  for (const x of [-W + 0.03, W - 0.03]) strip(B, 'c', [x, 0.42, 0.17], [x, 0.42, -0.17], 0.02, [0, 1, 0], [0.4, 0.4, 0.4]);   // とめ金
} });

// 物置（スチール：引き戸 2枚（左が 前）・うしろへ ながれる 屋根・ブロックの 土台。1.8 × 0.9 × 1.9m）。色は 本体
const SHC = ['#e3ddcc', '#b9bcbc', '#7b6a5c', '#5d7b6b', '#7f93a3'];
A.prop('shed', { n: '物置', col: true, cols: SHC, build(B, P) {
  const lod = P.lod, c = pcol(P, SHC[0]), mo = TO(), rc = mix(c, [0.26, 0.25, 0.24], 0.55), X = 0.9, Z0 = -0.45, Z1 = 0.45, yb = 0.12, hf = 1.9, hb = 1.82;
  if (lod >= 2) {
    for (const z of [Z1 - 0.1, Z0 + 0.1]) for (const x of [-0.7, 0, 0.7]) box(B, 'c', x - 0.19, x + 0.19, -0.1, yb, z - 0.095, z + 0.095, CONC, 'fblr');   // ブロック
    qd(B, 'c', [-X, yb, Z0], [X, yb, Z0], [X, yb, Z1], [-X, yb, Z1], [0, -1, 0], [0.2, 0.2, 0.2]);                                // 床の 下
  } else vf(B, 'c', -X, Z1 - 0.05, X, Z1 - 0.05, -0.1, yb, CONC);
  vf(B, mo, -X, Z1, X, Z1, yb, hf, c, UO.shf);
  vf(B, mo, X, Z0, -X, Z0, yb, hb, c, UO.shs);
  for (const sx of [-1, 1]) { const zA = sx > 0 ? Z1 : Z0, zB = sx > 0 ? Z0 : Z1, hA = sx > 0 ? hf : hb, hB = sx > 0 ? hb : hf, U = UO.shs, vv = h => U[1] + (U[5] - U[1]) * (h - yb) / (hf - yb);
    qd(B, mo, [sx * X, yb, zA], [sx * X, yb, zB], [sx * X, hB, zB], [sx * X, hA, zA], [sx, 0, 0], c, [U[0], U[1], U[2], U[1], U[2], vv(hB), U[0], vv(hA)]); }
  const rx = X + 0.05, zf = Z1 + 0.08, zk = Z0 - 0.05, yf = hf + 0.07, yk = hb + 0.02, U = UO.shs;
  qd(B, mo, [-rx, yf, zf], [rx, yf, zf], [rx, yk, zk], [-rx, yk, zk], [0, 1, 0.05], rc, [U[0], U[1], U[2], U[1], U[2], U[5], U[0], U[5]]);   // 屋根
  qd(B, 'c', [-rx, yf - 0.09, zf], [rx, yf - 0.09, zf], [rx, yf, zf], [-rx, yf, zf], [0, 0, 1], rc);
  if (lod < 2) return;
  for (const sx of [-1, 1]) qd(B, 'c', [sx * rx, yf - 0.09, zf], [sx * rx, yk - 0.06, zk], [sx * rx, yk, zk], [sx * rx, yf, zf], [sx, 0, 0], rc);
  vf(B, mo, -X + 0.081, Z1 + 0.016, 0.027, Z1 + 0.016, yb + (hf - yb) * 0.04, hf - (hf - yb) * 0.075, c, cu(2, 2, 0.045, 0.075, 0.515, 0.96));   // 前の とびら
  if (lod < 3) return;
  // すぐ近く（lod 3）：とびらの 取っ手・上と下の レール・屋根の すじ・うしろの 雨どい・かどの 柱
  const hk = [0.28, 0.28, 0.27], hy0 = yb + (1 - 0.57) * (hf - yb), hy1 = yb + (1 - 0.43) * (hf - yb);
  box(B, 'c', 0.063, 0.117, hy0, hy1, Z1, Z1 + 0.016, hk, 'flrtu'); box(B, 'c', -0.108, -0.054, hy0, hy1, Z1 + 0.016, Z1 + 0.032, hk, 'flrtu');
  box(B, 'c', -X, X, hf - 0.1, hf - 0.07, Z1, Z1 + 0.034, mul(c, 0.82), 'flrtu'); box(B, 'c', -X, X, yb, yb + 0.04, Z1, Z1 + 0.03, mul(c, 0.7), 'flrtu');
  for (let k = 0; k < 7; k++) { const x = -rx + 0.12 + (2 * rx - 0.24) * k / 6; bar(B, 'c', [x, yf + 0.012, zf - 0.02], [x, yk + 0.012, zk + 0.02], 0.011, 0.011, 4, mul(rc, 1.1), { rot: PI / 4 }); }
  bar(B, 'c', [-rx, yk - 0.035, zk - 0.03], [rx, yk - 0.035, zk - 0.03], 0.03, 0.03, 6, mul(rc, 0.9), { cap: 'ab' });
  for (const [x, z] of [[-X, Z1], [X, Z1], [-X, Z0], [X, Z0]]) bar(B, 'c', [x, yb, z], [x, z > 0 ? hf : hb, z], 0.016, 0.016, 4, mul(c, 0.88), { rot: PI / 4 });
} });

// 犬小屋（木の 小屋：板の かべ・アーチの 入口・切妻の 屋根（色）・名札（文字なし）・ステンレスの 水入れ）。色は 屋根
const DHC = ['#a8473c', '#3e6a9a', '#4f7a50', '#6b4f3a', '#e6e2d8'];
A.prop('doghouse', { n: '犬小屋', col: true, cols: DHC, build(B, P) {
  const lod = P.lod, c = pcol(P, DHC[0]), mo = TO(), wc = [0.86, 0.72, 0.55], X = 0.4, Z0 = -0.5, Z1 = 0.42, yb = 0.08, H = 0.66, yr = 0.98;
  box(B, 'c', -X - 0.02, X + 0.02, -0.06, yb, Z0 - 0.02, Z1 + 0.02, mul(wc, 0.6), lod >= 2 ? 'fblrt' : 'f');
  vf(B, mo, -X, Z1, X, Z1, yb, H, wc, UO.dgf);
  vf(B, mo, X, Z0, -X, Z0, yb, H, wc, UO.wd);
  vf(B, mo, X, Z1, X, Z0, yb, H, wc, UO.wd); vf(B, mo, -X, Z0, -X, Z1, yb, H, wc, UO.wd);
  const gu = cu(2, 1, 0, 0.5, 1, 1);
  for (const [z, sg] of [[Z1, 1], [Z0, -1]]) tr(B, mo, [-X, H, z], [X, H, z], [0, yr - 0.03, z], [0, 0, sg], wc, [gu[0], gu[1], gu[2], gu[3], (gu[0] + gu[2]) / 2, gu[5]]);
  const ex = X + 0.09, ey = H - 0.04, zf = Z1 + 0.1, zk = Z0 - 0.08, th = 0.035, ru = UO.wd;
  for (const sx of [-1, 1]) {
    qd(B, mo, [sx * ex, ey, zf], [sx * ex, ey, zk], [0, yr, zk], [0, yr, zf], [sx, 1.2, 0], c, [ru[0], ru[1], ru[2], ru[1], ru[2], ru[5], ru[0], ru[5]]);
    if (lod < 2) continue;
    qd(B, 'c', [sx * ex, ey - th, zf], [sx * ex, ey - th, zk], [sx * ex, ey, zk], [sx * ex, ey, zf], [sx, 0, 0], mul(c, 0.8));
    for (const [z, sz] of [[zf, 1], [zk, -1]]) qd(B, 'c', [sx * ex, ey - th, z], [0, yr - th, z], [0, yr, z], [sx * ex, ey, z], [0, 0, sz], mul(c, 0.8));
  }
  if (lod < 2) return;
  vf(B, 'c', -0.09, Z1 + 0.012, 0.09, Z1 + 0.012, H + 0.05, H + 0.13, [0.95, 0.93, 0.88]);                                           // 名札
  const k3 = lod >= 3;
  bar(B, 'c', [0.3, -0.01, 0.74], [0.3, 0.07, 0.74], 0.085, 0.11, k3 ? 12 : 6, [0.82, 0.84, 0.86]); disc(B, 'c', 0.3, 0.06, 0.74, 0.1, k3 ? 12 : 6, [0.42, 0.5, 0.58]);   // 水入れ
  if (!k3) return;
  // すぐ近く（lod 3）：屋根の 板の すじ・棟・ほねの おもちゃ
  for (const sx of [-1, 1]) for (const f of [0.3, 0.6]) { const x = sx * ex * (1 - f), y = ey + (yr - ey) * f + 0.012; bar(B, 'c', [x, y, zk], [x, y, zf], 0.007, 0.007, 4, mul(c, 0.75)); }
  bar(B, 'c', [0, yr + 0.004, zk - 0.01], [0, yr + 0.004, zf + 0.01], 0.022, 0.022, 6, mul(c, 0.85), { cap: 'ab' });
  const bx = 0.02, bz = 0.72, bw = [0.95, 0.93, 0.87];
  bar(B, 'c', [bx - 0.055, 0.016, bz], [bx + 0.055, 0.016, bz + 0.01], 0.011, 0.011, 6, bw);
  for (const [dx, dz] of [[-0.06, -0.015], [-0.06, 0.015], [0.06, -0.005], [0.06, 0.025]]) blob(B, 'c', bx + dx, 0.016, bz + dz, 0.017, 0.016, 0.017, 6, 2, bw, { bot: 1, kb: 0.8 });
} });
})();
