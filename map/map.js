/* ===== 風の芽経済組：国土（2Dの地図） =====
   - 企業 →「国土」で開く（index.html から MapApp.open）。地形はチャンク（64×64マス）ごとにサーバーから読む。遠くから見るときは overview.png
   - 地形はなめらかに描く（マスの中心の値をなめらかにつないで、水と陸の境目を 0.5 で切る）。道路・線路はなめらかな曲線
   - 道具：見る（住所など）・土地（買う・売る・建物）・線路・道路（点をおいて曲線をひく・直す）・駅・車庫・こわす
   - 車両・系統・ダイヤ・お金・管理は、下の「≡」から
   - サーバーの関数：mp_boot・mp_chunk_get・mp_area・mp_poll・mp_tile・mp_land_*・mp_seg_*・mp_sta_*・mp_dep_*・mp_bld・mp_car_*・mp_form_*・mp_route_*・mp_train_*・mp_dia・mp_ledger_page・mp_admin_* */
(function () {
'use strict';
const PAL = window.MapPal;
const CS = 64, B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = (() => { const m = new Int8Array(128); for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i; return m; })();
const edec = l => l <= 7 ? -187.5 + l * 25 : l <= 32 ? (l - 8) * 4 + 2 : l <= 48 ? 112.5 + (l - 33) * 25 : 575 + (l - 49) * 150;
const EDEC = Float32Array.from({ length: 64 }, (_, i) => edec(i));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const now = () => performance.now();
const T = s => (typeof tr === 'function' ? tr(s) : s);
const SEP = () => (window.I18N && !/^zh/.test(I18N.lang) ? ' ' : '');   // 訳した文をつなぐとき（日本語・中国語は空白なし）
const X = n => fmt(n) + ' X';
// 全角の数字・記号（日本語入力の「２」「，」など）を半角に。打った数を読むところは、これを通す
const hw = v => String(v == null ? '' : v).replace(/[０-９．，－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

/* ---------- 状態 ---------- */
const S = {
  open: false, root: null, wrap: null, cv: null, ctx: null, W: 0, H: 0, dpr: 1,
  cam: { x: 0, y: 0, z: 3 }, dirty: true,
  boot: null, as: 'me', admin: false,
  chunks: new Map(), pend: new Set(), chunkQ: [], chunkBusy: 0,
  cho: new Map(), choPend: new Set(), choQ: [], choBusy: 0,   // 町字（チャンクごと：k・kp・kq）
  cells: new Map(), cellBusy: 0, ver: 0, pollT: 0,
  ov: null, ovInfo: null,
  layer: { zone: false, own: true, label: true },
  b25: true,   // 建物を 2.5D（高さのある見えかた）で描く。false なら 2D（上から見たまま）
  tool: 'look', toolState: null,
  sel: null,          // えらんだもの（{kind, id, ...}）
  hover: null,
  routeHi: null,      // 地図でめだたせる系統
};
window.MP_STATE = S;   // テスト用

/* ---------- カメラ ---------- */
const sx = x => (x - S.cam.x) * S.cam.z + S.W / 2;
const sy = y => (y - S.cam.y) * S.cam.z + S.H / 2;
const wx = px => (px - S.W / 2) / S.cam.z + S.cam.x;
const wy = py => (py - S.H / 2) / S.cam.z + S.cam.y;
function view() { return { x0: wx(0), y0: wy(0), x1: wx(S.W), y1: wy(S.H) }; }
function setCam(x, y, z) {
  S.cam.z = clamp(z, 0.18, 64);
  const w = S.boot && S.boot.world;
  if (w && w.cx1 >= w.cx0) { S.cam.x = clamp(x, w.cx0 * CS, (w.cx1 + 1) * CS); S.cam.y = clamp(y, w.cy0 * CS, (w.cy1 + 1) * CS); }
  else { S.cam.x = x; S.cam.y = y; }
  S.dirty = true; saveCam();
}
function saveCam() { try { localStorage.setItem('mp_cam', JSON.stringify([Math.round(S.cam.x * 10) / 10, Math.round(S.cam.y * 10) / 10, Math.round(S.cam.z * 100) / 100])); } catch (e) {} }
function loadCam() { try { const c = JSON.parse(localStorage.getItem('mp_cam')); if (Array.isArray(c) && c.length === 3 && c.every(Number.isFinite)) { S.cam.x = c[0]; S.cam.y = c[1]; S.cam.z = c[2]; } } catch (e) {} }

/* ---------- チャンク（地形） ---------- */
const ckey = (cx, cy) => cx + ',' + cy;
function inWorld(cx, cy) { const w = S.boot && S.boot.world; return w && cx >= w.cx0 && cx <= w.cx1 && cy >= w.cy0 && cy <= w.cy1; }
// マスの地形（読んでいなければ null）。ない（深い海の）チャンクは D
function tileAt(x, y) {
  const cx = Math.floor(x / CS), cy = Math.floor(y / CS), c = S.chunks.get(ckey(cx, cy));
  if (!c) return null;
  if (c.sea) return { t: 'D', e: -190, z: '-' };
  const k = (y - cy * CS) * CS + (x - cx * CS);
  return { t: c.t[k], e: EDEC[B64I[c.e.charCodeAt(k)]], z: c.zo && c.zo.has(k) ? c.zo.get(k) : c.z[k], a: c.ap[B64I[c.a.charCodeAt(k)]] };
}
function needChunks() {
  if (S.cam.z < 1.2) return;
  const v = view(), cx0 = Math.floor(v.x0 / CS) - 1, cy0 = Math.floor(v.y0 / CS) - 1, cx1 = Math.floor(v.x1 / CS) + 1, cy1 = Math.floor(v.y1 / CS) + 1;
  const want = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const k = ckey(cx, cy);
    if (!inWorld(cx, cy) || S.chunks.has(k) || S.pend.has(k)) continue;
    want.push([cx, cy, (cx * CS + 32 - S.cam.x) ** 2 + (cy * CS + 32 - S.cam.y) ** 2]);
  }
  want.sort((a, b) => a[2] - b[2]);
  for (const [cx, cy] of want) { S.pend.add(ckey(cx, cy)); S.chunkQ.push([cx, cy]); }
  pumpChunks();
}
async function pumpChunks() {
  while (S.chunkBusy < 2 && S.chunkQ.length) {
    const batch = S.chunkQ.splice(0, 32), keys = [];
    for (const [cx, cy] of batch) keys.push(cx, cy);
    S.chunkBusy++;
    call('mp_chunk_get', { p_keys: keys }).then(rows => {
      const got = new Set();
      for (const c of rows) {
        const k = ckey(c.cx, c.cy); got.add(k);
        S.chunks.set(k, { cx: c.cx, cy: c.cy, t: c.t, e: c.e, z: c.z, a: c.a, ap: c.ap, apx: c.apx || [], zo: zoMap(c), lo: null, hi: null, zc: null, bnd: null, used: now() });
      }
      for (const [cx, cy] of batch) {
        const k = ckey(cx, cy); S.pend.delete(k);
        if (!got.has(k)) S.chunks.set(k, { cx, cy, sea: true, used: now() });
        // となりの絵をつくりなおす（境目をなめらかに）。境界線も
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const n = S.chunks.get(ckey(cx + dx, cy + dy)); if (n && !n.sea) { n.hi = null; n.bnd = null; } }
      }
      S.dirty = true;
    }).catch(e => { for (const [cx, cy] of batch) S.pend.delete(ckey(cx, cy)); console.warn(e); })
      .finally(() => { S.chunkBusy--; pumpChunks(); });
  }
}
/* ---------- 町字（境界線と名前）：近いときだけ読む ---------- */
function needCho() {
  if (S.cam.z < 2.5) return;
  const v = view(), cx0 = Math.floor(v.x0 / CS), cy0 = Math.floor(v.y0 / CS), cx1 = Math.floor(v.x1 / CS), cy1 = Math.floor(v.y1 / CS);
  const want = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const k = ckey(cx, cy), c = S.chunks.get(k);
    if (!c || c.sea || S.cho.has(k) || S.choPend.has(k)) continue;
    want.push([cx, cy, (cx * CS + 32 - S.cam.x) ** 2 + (cy * CS + 32 - S.cam.y) ** 2]);
  }
  want.sort((a, b) => a[2] - b[2]);
  for (const [cx, cy] of want) { S.choPend.add(ckey(cx, cy)); S.choQ.push([cx, cy]); }
  pumpCho();
}
function pumpCho() {
  while (S.choBusy < 2 && S.choQ.length) {
    const batch = S.choQ.splice(0, 16), keys = [];
    for (const [cx, cy] of batch) keys.push(cx, cy);
    S.choBusy++;
    call('mp_cho_get', { p_keys: keys }).then(rows => {
      const got = new Set();
      for (const c of rows) { const k = ckey(c.cx, c.cy); got.add(k); S.cho.set(k, { k: c.k, kp: c.kp, kq: c.kq }); }
      for (const [cx, cy] of batch) {
        const k = ckey(cx, cy); S.choPend.delete(k);
        if (!got.has(k)) S.cho.set(k, { none: true });
        for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1]]) { const n = S.chunks.get(ckey(cx + dx, cy + dy)); if (n) n.bnd = null; }
      }
      S.dirty = true;
    }).catch(e => { for (const [cx, cy] of batch) S.choPend.delete(ckey(cx, cy)); console.warn(e); })
      .finally(() => { S.choBusy--; pumpCho(); });
  }
}
// マスの区域・町字（境界線用）。i, j はチャンクの中（はみ出したらとなりのチャンク）
function bndTile(c, i, j) {
  let cc = c, ii = i, jj = j;
  if (i >= CS || j >= CS) { cc = S.chunks.get(ckey(c.cx + (i >= CS ? 1 : 0), c.cy + (j >= CS ? 1 : 0))); ii = i % CS; jj = j % CS; if (!cc) return null; }
  if (cc.sea) return { sea: true };
  const k = jj * CS + ii, ai = B64I[cc.a.charCodeAt(k)], t = cc.t[k];
  const ch = S.cho.get(ckey(cc.cx, cc.cy));
  let cho = null, dist = null;
  if (ch && !ch.none) { const ix = B64I[ch.k.charCodeAt(2 * k)] * 64 + B64I[ch.k.charCodeAt(2 * k + 1)]; cho = ch.kp[ix] || null; dist = ch.kq[ix] || null; }
  const ax = cc.apx[ai] || [];
  return { sea: t === 'S' || t === 'D', area: cc.ap[ai], muni: ax[0] || '', pref: ax[1] || '', cho, dist, choOk: !!ch };
}
// 境界線（チャンクごと）：県・市町村・区・町（大字）・丁目（字）。マスの辺で、ちがうところに線
const BND_LV = ['pref', 'muni', 'ward', 'dist', 'sub'];
function chunkBnd(c) {
  const out = { pref: [], muni: [], ward: [], dist: [], sub: [] };
  const lv = (a, b) => {
    if (!a || !b || (a.sea && b.sea)) return null;
    if (a.sea || b.sea) return null;
    if (a.area !== b.area) return a.pref !== b.pref ? 'pref' : a.muni !== b.muni ? 'muni' : 'ward';
    if (!a.choOk || !b.choOk || !a.cho || !b.cho || a.cho === b.cho) return null;
    return a.dist !== b.dist ? 'dist' : 'sub';
  };
  const x0 = c.cx * CS, y0 = c.cy * CS;
  // たての辺（i と i+1 のあいだ）：同じ種類が続くところはつなぐ
  for (let i = 0; i < CS; i++) {
    let run = null, rs = 0;
    for (let j = 0; j <= CS; j++) {
      const l = j < CS ? lv(bndTile(c, i, j), bndTile(c, i + 1, j)) : null;
      if (l !== run) { if (run) out[run].push(x0 + i + 1, y0 + rs, x0 + i + 1, y0 + j); run = l; rs = j; }
    }
  }
  // よこの辺（j と j+1 のあいだ）
  for (let j = 0; j < CS; j++) {
    let run = null, rs = 0;
    for (let i = 0; i <= CS; i++) {
      const l = i < CS ? lv(bndTile(c, i, j), bndTile(c, i, j + 1)) : null;
      if (l !== run) { if (run) out[run].push(x0 + rs, y0 + j + 1, x0 + i, y0 + j + 1); run = l; rs = i; }
    }
  }
  return out;
}
function zoMap(c) {
  if (!c.zo || !c.zo.length) return null;
  const m = new Map();
  for (const [x, y, z] of c.zo) m.set((y - c.cy * CS) * CS + (x - c.cx * CS), z);
  return m;
}
// 古いチャンクの絵をすてる（メモリ）
function trimChunks() {
  const hi = [...S.chunks.values()].filter(c => c.hi);
  if (hi.length > 160) { hi.sort((a, b) => a.used - b.used); for (const c of hi.slice(0, hi.length - 160)) c.hi = null; }
  if (S.chunks.size > 2600) {
    const all = [...S.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k] of all.slice(0, S.chunks.size - 2200)) S.chunks.delete(k);
  }
  if (S.cho.size > 900) for (const k of [...S.cho.keys()]) if (!S.chunks.has(k)) S.cho.delete(k);
}
// 1マス1点の絵（遠いとき）
function chunkLo(c) {
  const cv = document.createElement('canvas'); cv.width = cv.height = CS;
  const g = cv.getContext('2d'), im = g.createImageData(CS, CS), d = im.data;
  for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) {
    const k = j * CS + i, t = c.t[k], e = EDEC[B64I[c.e.charCodeAt(k)]], z = c.zo && c.zo.has(k) ? c.zo.get(k) : c.z[k];
    const kn = Math.max(0, j - 1) * CS + Math.max(0, i - 1), en = EDEC[B64I[c.e.charCodeAt(kn)]];
    const col = PAL.tileColor(t, e, z, (e - en) / 1.4);
    d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0); return cv;
}
// なめらかな絵（近いとき）：1マスを Q 点に。海・湖かどうかを（3×3 でならしてから）なめらかにつないで 0.5 で切る
//   川はここでは陸として描き、上から川の線（worldgen の川のまん中の線）を描く
const Q = 4;
function chunkHi(c) {
  const N = CS, M = N + 2, M2 = N + 4, size = N * Q;
  const raw = new Float32Array(M2 * M2), Rr = new Float32Array(M2 * M2), Rg = new Float32Array(M2 * M2), Rb = new Float32Array(M2 * M2), Re = new Float32Array(M2 * M2);
  const Wt = new Float32Array(M * M), Et = new Float32Array(M * M), Cr = new Float32Array(M * M), Cg = new Float32Array(M * M), Cb = new Float32Array(M * M), Lw = new Uint8Array(M * M);
  const x0 = c.cx * CS, y0 = c.cy * CS;
  const own = (i, j) => { const ii = clamp(i, 0, N - 1), jj = clamp(j, 0, N - 1), k = jj * N + ii; return { t: c.t[k], e: EDEC[B64I[c.e.charCodeAt(k)]], z: c.zo && c.zo.has(k) ? c.zo.get(k) : c.z[k] }; };
  const get = (i, j) => (i >= 0 && j >= 0 && i < N && j < N) ? own(i, j) : (tileAt(x0 + i, y0 + j) || own(i, j));
  for (let j = -2; j <= N + 1; j++) for (let i = -2; i <= N + 1; i++) {
    const q = get(i, j), k2 = (j + 2) * M2 + (i + 2);
    raw[k2] = q.t === 'D' || q.t === 'S' || q.t === 'L' ? 1 : 0;
    let t = q.t;
    if (t === 'R') t = q.e > 300 ? 'H' : 'P';                                   // 川のマスは陸の色（川は線で描く）
    const col = PAL.tileColor(t, q.e, q.t === 'R' ? '-' : q.z, 0);
    Rr[k2] = col[0]; Rg[k2] = col[1]; Rb[k2] = col[2]; Re[k2] = Math.max(0, q.e);
  }
  // 3×3 でならす（海岸がなめらかに・色の境目もやわらかく。色は水どうし・陸どうしだけでまぜる）
  const KW = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const c0 = (j + 1) * M2 + (i + 1), self = raw[c0];
    let w = 0, sr = 0, sg = 0, sb = 0, sw = 0, n = 0, se = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const k2 = c0 + b * M2 + a, kw = KW[n++];
      w += kw * raw[k2]; se += kw * Re[k2];
      if (raw[k2] === self) { sw += kw; sr += kw * Rr[k2]; sg += kw * Rg[k2]; sb += kw * Rb[k2]; }
    }
    const k = j * M + i;
    Wt[k] = w / 16; Lw[k] = self; Cr[k] = sr / sw; Cg[k] = sg / sw; Cb[k] = sb / sw; Et[k] = se / 16;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), im = g.createImageData(size, size), d = im.data;
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5) / Q - 0.5, j0 = Math.floor(v), fy = v - j0;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / Q - 0.5, i0 = Math.floor(u), fx = u - i0;
      const k00 = (j0 + 1) * M + (i0 + 1), k10 = k00 + 1, k01 = k00 + M, k11 = k01 + 1;
      const a00 = (1 - fx) * (1 - fy), a10 = fx * (1 - fy), a01 = (1 - fx) * fy, a11 = fx * fy;
      const w = Wt[k00] * a00 + Wt[k10] * a10 + Wt[k01] * a01 + Wt[k11] * a11;
      const water = w >= 0.5;
      // 同じ側（水か陸か）のマスだけで色をまぜる
      let s = 0, r = 0, gg = 0, b = 0;
      const add = (k, a) => { if ((Lw[k] > 0) === water && a > 0) { s += a; r += Cr[k] * a; gg += Cg[k] * a; b += Cb[k] * a; } };
      add(k00, a00); add(k10, a10); add(k01, a01); add(k11, a11);
      if (s <= 0) { if (water) { r = 112; gg = 170; b = 220; } else { r = Cr[k00]; gg = Cg[k00]; b = Cb[k00]; } s = 1; }
      else { r /= s; gg /= s; b /= s; }
      if (!water) {
        const ex = (Et[k10] - Et[k00]) * (1 - fy) + (Et[k11] - Et[k01]) * fy, ey = (Et[k01] - Et[k00]) * (1 - fx) + (Et[k11] - Et[k10]) * fx;
        const sh = 1 + clamp(-(ex + ey) * 0.012, -0.3, 0.3);
        r *= sh; gg *= sh; b *= sh;
        if (w > 0.4) { const f = (w - 0.4) / 0.1 * 0.2; r = r * (1 - f) + 120 * f; gg = gg * (1 - f) + 140 * f; b = b * (1 - f) + 150 * f; }   // 岸のふち
      } else if (w < 0.6) { const f = (0.6 - w) / 0.1 * 0.18; r = r * (1 - f) + 240 * f; gg = gg * (1 - f) + 248 * f; b = b * (1 - f) + 255 * f; }      // 水ぎわ
      const o = (py * size + px) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0); return cv;
}
/* ---------- 川（worldgen.js の川のまん中の線から。256マスごとにまとめて計算） ---------- */
let WG = null;
const RIV = new Map();
function riversCell(i, j) {
  const k = i + ',' + j; let r = RIV.get(k); if (r) return r;
  r = [];
  if (!WG && window.MapGen) WG = MapGen.world();
  if (WG) {
    const x0 = i * 256 - 3, y0 = j * 256 - 3, x1 = (i + 1) * 256 + 3, y1 = (j + 1) * 256 + 3, SQ = Math.SQRT1_2;
    const vs = [(x0 - y0) * SQ, (x1 - y0) * SQ, (x0 - y1) * SQ, (x1 - y1) * SQ], us = [(x0 + y0) * SQ, (x1 + y0) * SQ, (x0 + y1) * SQ, (x1 + y1) * SQ];
    const vmin = Math.min(...vs), vmax = Math.max(...vs), umin = Math.min(...us), umax = Math.max(...us);
    for (let kk = Math.floor(vmin / WG.RS) - 4; kk <= Math.ceil(vmax / WG.RS) + 4; kk++) {
      const main = WG.river(kk);
      for (const rv of [main, ...main.tribs]) {
        const sA = Math.max(rv.s0 - 4, rv.cu - umax - 2), sB = Math.min(rv.s1, rv.cu - umin + 2);
        if (sB <= sA) continue;
        let cur = null;
        for (let s2 = Math.floor(sA); s2 <= sB + 1; s2 += 1) {
          const ss = Math.min(s2, sB), v = WG.riverV(rv, ss), u = rv.cu - ss, x = (u + v) * SQ, y = (u - v) * SQ;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
            if (!cur) { cur = { pts: [], w: [] }; r.push(cur); }
            cur.pts.push(x + 0.5, y + 0.5); cur.w.push(WG.riverW(rv, ss) + 0.45);
          } else cur = null;
          if (ss >= sB) break;
        }
      }
    }
    // 広げた国土（t55）の川：worldgen.js の xrivers（1マスごとの点）
    for (const xr of WG.xrivers || []) {
      let cur = null;
      for (let q = 0; q < xr.w.length; q++) {
        const x = xr.pts[2 * q], y = xr.pts[2 * q + 1];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
          if (!cur) { cur = { pts: [], w: [] }; r.push(cur); }
          cur.pts.push(x + 0.5, y + 0.5); cur.w.push(xr.w[q] + 0.45);
        } else cur = null;
      }
    }
  }
  RIV.set(k, r);
  if (RIV.size > 400) RIV.delete(RIV.keys().next().value);
  return r;
}
// 用途地域の層
function chunkZone(c) {
  const cv = document.createElement('canvas'); cv.width = cv.height = CS;
  const g = cv.getContext('2d'), im = g.createImageData(CS, CS), d = im.data;
  for (let k = 0; k < CS * CS; k++) {
    const z = c.zo && c.zo.has(k) ? c.zo.get(k) : c.z[k], col = PAL.ZC[z];
    if (!col) continue;
    d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 120;
  }
  g.putImageData(im, 0, 0); return cv;
}

/* ---------- 地図の上のもの（道路・線路・駅など）：範囲（セル）ごとに読む ---------- */
// ズームで細かさ（lod）とセルの大きさを決める
function lodOf(z) { return z < 2 ? [2, 1024] : z < 7 ? [1, 384] : [0, 96]; }
function needCells() {
  const [lod, cs] = lodOf(S.cam.z), v = view();
  const i0 = Math.floor(v.x0 / cs), j0 = Math.floor(v.y0 / cs), i1 = Math.floor(v.x1 / cs), j1 = Math.floor(v.y1 / cs);
  const want = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = lod + ':' + i + ',' + j, c = S.cells.get(k);
    if (c && (c.busy || !c.stale)) { if (c) c.used = now(); continue; }
    want.push([k, i, j, ((i + 0.5) * cs - S.cam.x) ** 2 + ((j + 0.5) * cs - S.cam.y) ** 2]);
  }
  want.sort((a, b) => a[3] - b[3]);
  for (const [k, i, j] of want) {
    if (S.cellBusy >= 3) break;
    const old = S.cells.get(k);
    const c = old || { lod, i, j, cs, data: null };
    c.busy = true; c.stale = false; c.used = now(); S.cells.set(k, c);
    S.cellBusy++;
    call('mp_area', { p_x0: i * cs, p_y0: j * cs, p_x1: (i + 1) * cs, p_y1: (j + 1) * cs, p_lod: lod })
      .then(d => { prepArea(d); c.data = d; if (d.ver > S.ver && !S.ver) S.ver = d.ver; S.dirty = true; })
      .catch(e => { c.stale = true; console.warn(e); })
      .finally(() => { c.busy = false; S.cellBusy--; if (S.open) needCells(); });
  }
  if (S.cells.size > 500) {
    const all = [...S.cells.entries()].filter(e => !e[1].busy).sort((a, b) => a[1].used - b[1].used);
    for (const [k] of all.slice(0, S.cells.size - 400)) S.cells.delete(k);
  }
}
// 線を描きやすく（点をマスの小数に）
function prepSeg(s) {
  const p = s.p, n = p.length / 2, P = new Float32Array(p.length);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { const x = p[i] / 100, y = p[i + 1] / 100; P[i] = x; P[i + 1] = y; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  s.P = P; s.bb = [x0, y0, x1, y1]; s.np = n;
  return s;
}
// 読んだものを描きやすく
function prepArea(d) {
  for (const s of d.segs) prepSeg(s);
  for (const s of d.stas) { s.fx = s.x / 100; s.fy = s.y / 100; }
  for (const s of d.deps) { s.fx = s.x / 100; s.fy = s.y / 100; }
  for (const n of d.nodes) { n.fx = n.x / 100; n.fy = n.y / 100; }
  d.parcels = (d.parcels || []).map(prepParcel);
  d.blds = (d.blds || []).map(prepBld);
  d.chos = d.chos || [];
  d.lanes = d.lanes || []; for (const l of d.lanes) prepLane(l);   // 航路（t54o）
  d.rwys = d.rwys || []; for (const r of d.rwys) prepRwy(r);         // 滑走路（t57）
}
// 滑走路（t57）：両はし（マス）・向き・はしの番号（北から右まわりの角度 ÷ 10。a のはしは a → b の向き）
function prepRwy(r) {
  const [ax, ay, bx, by] = r.p.map(v => v / 100), dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  r.P = [ax, ay, bx, by]; r.ux = dx / L; r.uy = dy / L; r.L = L;
  r.bb = [Math.min(ax, bx) - r.w, Math.min(ay, by) - r.w, Math.max(ax, bx) + r.w, Math.max(ay, by) + r.w];
  const h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, na = Math.round(h / 10) % 36 || 36, nb = (na + 18) % 36 || 36;
  r.na = String(na).padStart(2, '0'); r.nb = String(nb).padStart(2, '0');
  const m = /^(\d{2})([LCR]?)\/(\d{2})([LCR]?)$/.exec(r.n || '');   // 平行な滑走路の L・C・R（t57c。名前から）
  if (m) { const f = { [m[1]]: m[1] + m[2], [m[3]]: m[3] + m[4] }; r.na = f[r.na] || r.na; r.nb = f[r.nb] || r.nb; }
  return r;
}
// 筆：[id, [y, x0, x1, …], 1 他人・2 自分, 売り出し, 建物, 地番, 持ち主] → 区画の塗りと外まわり（マスの単位の Path2D）・まん中・大きさ
function prepParcel(a) {
  const p = { id: a[0], own: a[2], sale: a[3], bld: a[4], ban: a[5], okey: a[6], n: 0, cells: new Set(), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, sx: 0, sy: 0 };
  const r = a[1] || [], fill = new Path2D(), edge = new Path2D();
  for (let i = 0; i + 2 < r.length; i += 3) {
    const y = r[i], xa = r[i + 1], xb = r[i + 2];
    fill.rect(xa / 5, y / 5, (xb - xa + 1) / 5, 0.2);
    for (let x = xa; x <= xb; x++) { p.cells.add(x + ',' + y); p.n++; p.sx += x; p.sy += y; }
    p.x0 = Math.min(p.x0, xa); p.x1 = Math.max(p.x1, xb); p.y0 = Math.min(p.y0, y); p.y1 = Math.max(p.y1, y);
  }
  for (const key of p.cells) {
    const [x, y] = key.split(',').map(Number);
    if (!p.cells.has((x - 1) + ',' + y)) { edge.moveTo(x / 5, y / 5); edge.lineTo(x / 5, (y + 1) / 5); }
    if (!p.cells.has((x + 1) + ',' + y)) { edge.moveTo((x + 1) / 5, y / 5); edge.lineTo((x + 1) / 5, (y + 1) / 5); }
    if (!p.cells.has(x + ',' + (y - 1))) { edge.moveTo(x / 5, y / 5); edge.lineTo((x + 1) / 5, y / 5); }
    if (!p.cells.has(x + ',' + (y + 1))) { edge.moveTo(x / 5, (y + 1) / 5); edge.lineTo((x + 1) / 5, (y + 1) / 5); }
  }
  p.fill = fill; p.edge = edge;
  // 地番を書くところ：まん中にいちばん近い区画
  const mx = p.sx / Math.max(1, p.n), my = p.sy / Math.max(1, p.n); let bd = Infinity;
  for (const key of p.cells) { const [x, y] = key.split(',').map(Number), d = (x - mx) ** 2 + (y - my) ** 2; if (d < bd) { bd = d; p.lx = (x + 0.5) / 5; p.ly = (y + 0.5) / 5; } }
  p.bb = [p.x0 / 5, p.y0 / 5, (p.x1 + 1) / 5, (p.y1 + 1) / 5];
  return p;
}
// 見えているセルのもの（id でまとめる）
function visibleItems() {
  const [lod, cs] = lodOf(S.cam.z), v = view();
  const i0 = Math.floor(v.x0 / cs), j0 = Math.floor(v.y0 / cs), i1 = Math.floor(v.x1 / cs), j1 = Math.floor(v.y1 / cs);
  const segs = new Map(), stas = new Map(), deps = new Map(), nodes = new Map(), parcels = new Map(), places = new Map(), chos = new Map(), blds = new Map(), lanes = new Map(), rwys = new Map(), names = {};
  const take = d => {
    for (const s of d.segs) segs.set(s.id, s);
    for (const s of d.stas) stas.set(s.id, s);
    for (const s of d.deps) deps.set(s.id, s);
    for (const n of d.nodes) nodes.set(n.id, n);
    for (const p of d.parcels) parcels.set(p.id, p);
    for (const b of (d.blds || [])) blds.set(b.id, b);
    for (const p of d.places) places.set(p.id, p);
    for (const c of d.chos) chos.set(c[0], c);
    for (const l of (d.lanes || [])) lanes.set(l.id, l);
    for (const r of (d.rwys || [])) rwys.set(r.id, r);
    Object.assign(names, d.names);
  };
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let c = S.cells.get(lod + ':' + i + ',' + j);
    if (c && c.data) { take(c.data); continue; }
    // まだ読めていないところは、ほかの細かさのものを使う
    for (const [l2, cs2] of [[0, 96], [1, 384], [2, 1024]]) {
      if (l2 === lod) continue;
      const a0 = Math.floor(i * cs / cs2), b0 = Math.floor(j * cs / cs2), a1 = Math.floor(((i + 1) * cs - 1) / cs2), b1 = Math.floor(((j + 1) * cs - 1) / cs2);
      let any = false;
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const c2 = S.cells.get(l2 + ':' + a + ',' + b); if (c2 && c2.data) { take(c2.data); any = true; } }
      if (any) break;
    }
  }
  return { segs, stas, deps, nodes, parcels, places, chos, blds, lanes, rwys, names };
}
// 変わったもの（ほかの人の工事など）。15秒ごと
async function poll() {
  if (!S.open || document.hidden) return;
  try {
    const r = await call('mp_poll', { p_since: S.ver });
    if (r.reload) { for (const c of S.cells.values()) c.stale = true; S.ver = r.ver; S.dirty = true; needCells(); return; }
    for (const ch of r.ch || []) {
      if (ch.k === 'zone') { // 用途地域：チャンクを読みなおす
        if (ch.b) for (let cy = Math.floor(ch.b[1] / CS); cy <= Math.floor(ch.b[3] / CS); cy++) for (let cx = Math.floor(ch.b[0] / CS); cx <= Math.floor(ch.b[2] / CS); cx++) S.chunks.delete(ckey(cx, cy));
      }
      if (ch.k === 'route') { if (S.onRoute) S.onRoute(); continue; }
      if (ch.k === 'cho') {   // 町字の合併・分割：町字のデータを読みなおす
        if (ch.b) for (let cy = Math.floor(ch.b[1] / CS) - 1; cy <= Math.floor(ch.b[3] / CS) + 1; cy++) for (let cx = Math.floor(ch.b[0] / CS) - 1; cx <= Math.floor(ch.b[2] / CS) + 1; cx++) { S.cho.delete(ckey(cx, cy)); const n = S.chunks.get(ckey(cx, cy)); if (n) n.bnd = null; }
      }
      const b = ch.b;
      for (const c of S.cells.values()) {
        if (!b) { c.stale = true; continue; }
        const x0 = c.i * c.cs, y0 = c.j * c.cs, x1 = x0 + c.cs, y1 = y0 + c.cs;
        if (b[0] <= x1 + 2 && b[2] >= x0 - 2 && b[1] <= y1 + 2 && b[3] >= y0 - 2) c.stale = true;
      }
    }
    S.ver = r.ver; S.dirty = true; needCells(); needChunks();
  } catch (e) { console.warn(e); }
}
// 自分の工事のあと：その範囲を読みなおす
function refreshBox(x0, y0, x1, y1) {
  for (const c of S.cells.values()) {
    const a0 = c.i * c.cs, b0 = c.j * c.cs;
    if (x0 <= a0 + c.cs + 2 && x1 >= a0 - 2 && y0 <= b0 + c.cs + 2 && y1 >= b0 - 2) c.stale = true;
  }
  S.dirty = true; needCells();
}

/* ---------- 描く ---------- */
const RS = {
  exp: { fill: '#62bb83', edge: '#2f7d4f', min: 2.6 }, nat: { fill: '#f4ad62', edge: '#b4672b', min: 2.2 }, pref: { fill: '#f8dc7a', edge: '#b39a40', min: 1.7 },
  city: { fill: '#ffffff', edge: '#b9b3a7', min: 1.1 }, priv: { fill: '#f7f2e6', edge: '#a39c8c', min: 1.0 }, lane: { fill: '#ffffff', edge: '#cfc9be', min: 0.7 }
};
const ROAD_ORDER = ['lane', 'city', 'priv', 'pref', 'nat'];
const DEP_SIZE = { rail: { S: [5, 2], M: [7, 3], L: [10, 4] }, bus: { S: [3, 2], M: [5, 3] } };
function pathSeg(g, s, off) {
  const P = s.P, n = s.np;
  g.beginPath();
  if (!off) {
    g.moveTo(sx(P[0]), sy(P[1]));
    for (let i = 1; i < n; i++) g.lineTo(sx(P[2 * i]), sy(P[2 * i + 1]));
    return;
  }
  // 横にずらした線（車線・複線）
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = P[2 * b] - P[2 * a], dy = P[2 * b + 1] - P[2 * a + 1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const x = P[2 * i] - dy * off, y = P[2 * i + 1] + dx * off;
    if (i) g.lineTo(sx(x), sy(y)); else g.moveTo(sx(x), sy(y));
  }
}
// 滑走路（t57）：アスファルトの長い四角・まん中の白い点線・ふちの線・両はしのしま模様（近いとき）
function drawRwys(g, it, z, v) {
  for (const r of it.rwys.values()) {
    if (r.bb[2] < v.x0 - 1 || r.bb[0] > v.x1 + 1 || r.bb[3] < v.y0 - 1 || r.bb[1] > v.y1 + 1) continue;
    const [ax, ay, bx, by] = r.P, ux = r.ux, uy = r.uy, nx = -uy, ny = ux, hw = r.w / 2;
    g.lineCap = 'butt';
    // 滑走路のまわりの土地（うめたて地・着陸帯。t57c）：少し広く・はしの先まで
    g.strokeStyle = '#d6d1c1'; g.lineWidth = Math.max(3, r.w * 1.9 * z); g.beginPath(); g.moveTo(sx(ax - ux * 0.35), sy(ay - uy * 0.35)); g.lineTo(sx(bx + ux * 0.35), sy(by + uy * 0.35)); g.stroke();
    g.strokeStyle = '#555a61'; g.lineWidth = Math.max(2, r.w * z); g.beginPath(); g.moveTo(sx(ax), sy(ay)); g.lineTo(sx(bx), sy(by)); g.stroke();
    if (z >= 3) {
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = Math.max(1, 0.025 * z);
      for (const s of [-1, 1]) { const o = hw * 0.9 * s; g.beginPath(); g.moveTo(sx(ax + nx * o), sy(ay + ny * o)); g.lineTo(sx(bx + nx * o), sy(by + ny * o)); g.stroke(); }
    }
    if (z >= 1.5) {
      const e = Math.min(1.2, r.L / 6);
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, 0.02 * z); g.setLineDash([Math.max(3, 0.6 * z), Math.max(3, 0.4 * z)]);
      g.beginPath(); g.moveTo(sx(ax + ux * e), sy(ay + uy * e)); g.lineTo(sx(bx - ux * e), sy(by - uy * e)); g.stroke(); g.setLineDash([]);
    }
    if (z >= 6) {
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, 0.05 * z);
      for (const [px, py, sg] of [[ax, ay, 1], [bx, by, -1]]) for (let k = -3; k <= 3; k++) {
        if (!k) continue;
        const o = k / 3.6 * hw, x0 = px + ux * sg * 0.12 + nx * o, y0 = py + uy * sg * 0.12 + ny * o;
        g.beginPath(); g.moveTo(sx(x0), sy(y0)); g.lineTo(sx(x0 + ux * sg * 0.55), sy(y0 + uy * sg * 0.55)); g.stroke();
      }
    }
    g.lineCap = 'round';
  }
}
// 滑走路の番号：それぞれのはしの少し内がわに（a のはしは na）
function rwyLabel(g, r, z, v) {
  if (r.bb[2] < v.x0 || r.bb[0] > v.x1 || r.bb[3] < v.y0 || r.bb[1] > v.y1) return;
  const d = Math.min(r.L / 3, Math.max(0.8, 18 / z));
  label(g, r.na, sx(r.P[0] + r.ux * d), sy(r.P[1] + r.uy * d), { size: 11, color: '#fff', bg: 'rgba(60,64,70,.9)' });
  label(g, r.nb, sx(r.P[2] - r.ux * d), sy(r.P[3] - r.uy * d), { size: 11, color: '#fff', bg: 'rgba(60,64,70,.9)' });
}
function segVisible(s, v) { const b = s.bb; return b[2] >= v.x0 - 1 && b[0] <= v.x1 + 1 && b[3] >= v.y0 - 1 && b[1] <= v.y1 + 1; }
function render() {
  const g = S.ctx, z = S.cam.z, v = view();
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  g.fillStyle = 'rgb(70,128,186)'; g.fillRect(0, 0, S.W, S.H);
  // 遠くから見た絵（いつも下に）
  if (S.ov && S.ovInfo) {
    const o = S.ovInfo;
    g.imageSmoothingEnabled = true;
    g.drawImage(S.ov, sx(o.x0), sy(o.y0), (o.x1 - o.x0) * z, (o.y1 - o.y0) * z);
  }
  // チャンク
  if (z >= 1.2) {
    const cx0 = Math.floor(v.x0 / CS), cy0 = Math.floor(v.y0 / CS), cx1 = Math.floor(v.x1 / CS), cy1 = Math.floor(v.y1 / CS);
    const hi = z >= 3; let made = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = S.chunks.get(ckey(cx, cy)); if (!c || c.sea) continue;
      c.used = now();
      let img = null;
      if (hi) { if (!c.hi && made < 6) { c.hi = chunkHi(c); made++; } img = c.hi || c.lo || (c.lo = chunkLo(c)); }
      else img = c.lo || (c.lo = chunkLo(c));
      g.imageSmoothingEnabled = !hi || img !== c.hi ? z < 3 : true;
      g.drawImage(img, Math.floor(sx(cx * CS)), Math.floor(sy(cy * CS)), Math.ceil(CS * z) + 1, Math.ceil(CS * z) + 1);
      if (S.layer.zone) { if (!c.zc) c.zc = chunkZone(c); g.imageSmoothingEnabled = false; g.drawImage(c.zc, sx(cx * CS), sy(cy * CS), CS * z, CS * z); }
    }
    if (made >= 6) S.dirty = true;   // 次のフレームで続きを
  }
  // 川（線で）
  if (z >= 1.2 && window.MapGen) {
    const i0 = Math.floor(v.x0 / 256), j0 = Math.floor(v.y0 / 256), i1 = Math.floor(v.x1 / 256), j1 = Math.floor(v.y1 / 256);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const rv of riversCell(i, j)) {
      const P = rv.pts, n = P.length / 2;
      for (let a = 0; a < n - 1; a += 6) {
        const b = Math.min(n - 1, a + 6), w = rv.w[a];
        g.beginPath(); g.moveTo(sx(P[2 * a]), sy(P[2 * a + 1]));
        for (let k = a + 1; k <= b; k++) g.lineTo(sx(P[2 * k]), sy(P[2 * k + 1]));
        g.strokeStyle = pass ? 'rgb(100,166,226)' : 'rgba(150,175,150,.9)'; g.lineWidth = Math.max(pass ? 1.4 : 2.6, w * z + (pass ? 0 : Math.max(1.5, 0.12 * z))); g.stroke();
      }
    }
  }
  const it = visibleItems(); S.vis = it;
  // 土地（筆）：持ち主の色・建物・売り出し・地番
  if (S.layer.own && z >= 4) drawParcels(g, it, z, v);
  // 滑走路（t57）
  drawRwys(g, it, z, v);
  // 道路（ふち → なか）
  const segs = [...it.segs.values()].filter(s => segVisible(s, v));
  const roads = segs.filter(s => s.k === 'road'), rails = segs.filter(s => s.k === 'rail');
  g.lineCap = 'round'; g.lineJoin = 'round';
  const wpx = s => Math.max(RS[s.c] ? (s.art && s.c === 'city' ? 1.4 : RS[s.c].min) : 1, s.w * z);
  // とても近いときは、アスファルトの色に白い線（車線）。ふちは歩道
  const asph = z >= 20;
  for (const pass of [0, 1]) for (const cls of ROAD_ORDER) for (const s of roads) {
    if (s.c !== cls) continue;
    const st = RS[cls], w = wpx(s);
    g.strokeStyle = pass ? (asph ? (cls === 'lane' ? '#9a9a96' : '#86868a') : st.fill) : (asph ? '#d9d5cc' : st.edge);
    g.lineWidth = pass ? w : w + (asph ? Math.max(2, 0.1 * z) : w > 2.5 ? 2 : 1.2);
    pathSeg(g, s); g.stroke();
  }
  // 車線の線（近いとき）
  if (asph) for (const s of roads) {
    if (s.c === 'exp' || !s.l) continue;
    laneMarks(g, s, z);
  }
  // 線路
  for (const s of rails) drawRail(g, s, z);
  // 航路（海の上の点線。t54o）
  drawLanes(g, it, z);
  // 高速（高架なので上に）
  for (const pass of [0, 1]) for (const s of roads) {
    if (s.c !== 'exp') continue;
    const st = RS.exp, w = wpx(s);
    g.strokeStyle = pass ? (asph ? '#7b7f86' : st.fill) : st.edge; g.lineWidth = pass ? w : w + 2; pathSeg(g, s); g.stroke();
  }
  if (asph) for (const s of roads) if (s.c === 'exp' && s.l) laneMarks(g, s, z);
  // 重なりの順（下から）：平らな建物（田畑・駐車場・広場）→ 車庫 → 系統 → 駅のホーム → 高さのある建物 → 境界線 → しるし（バス停・家・えらんだもの）→ 文字
  const bs = z >= 4 ? bldsIn(it, v) : [];
  if (bs.length) drawBlds(g, bs, z, 0);
  for (const d of it.deps.values()) if (d.k !== 'ship' && d.k !== 'air') drawDepot(g, d, z);
  if (S.routeHi) drawRouteHi(g, z, it);
  for (const s of it.stas.values()) if (s.k === 'rail') drawStation(g, s, z);
  if (bs.length) drawBlds(g, bs, z, 1);
  // 境界線（県・市区町村・町字）
  if (z >= 1.2) drawBounds(g, z, v);
  // バス停（しるし。建物にかくれないように）
  for (const s of it.stas.values()) if (s.k === 'bus') drawBusStop(g, s, z);
  // 港（⚓。t54o）・空港（✈。t54p）
  for (const s of it.stas.values()) if (s.k === 'ship' || s.k === 'air') drawPort(g, s, z);
  // 自分の住所（家のしるし。自分にだけ見える）
  if (S.boot && S.boot.home && z >= 1.2) drawHome(g, S.boot.home);
  // えらんだもの
  if (S.sel && S.sel.kind === 'seg') { const s = it.segs.get(S.sel.id); if (s) { g.strokeStyle = 'rgba(220,40,60,.75)'; g.lineWidth = Math.max(4, s.w * z + 4); pathSeg(g, s); g.stroke(); } }
  if (S.sel && S.sel.kind === 'rwy') { const r = it.rwys.get(S.sel.id); if (r) { g.lineCap = 'butt'; g.strokeStyle = 'rgba(220,40,60,.6)'; g.lineWidth = Math.max(5, r.w * z + 5); g.beginPath(); g.moveTo(sx(r.P[0]), sy(r.P[1])); g.lineTo(sx(r.P[2]), sy(r.P[3])); g.stroke(); g.lineCap = 'round'; } }
  if (S.sel && S.sel.kind === 'cell') {
    const p = S.sel.parcel && it.parcels.get(S.sel.parcel);
    if (p) { worldT(g); g.strokeStyle = '#d23'; g.lineWidth = 3 / z; g.stroke(p.edge); screenT(g); }
    else { const w = z / 5; g.strokeStyle = '#d23'; g.lineWidth = 2; g.strokeRect(sx(S.sel.x / 5), sy(S.sel.y / 5), Math.max(3, w), Math.max(3, w)); }
  }
  // IC・JCT（点）
  if (z >= 2.2) for (const n of it.nodes.values()) {
    if (!n.n || (n.nk !== 'ic' && n.nk !== 'jct')) continue;
    const x = sx(n.fx), y = sy(n.fy); if (x < -40 || y < -20 || x > S.W + 40 || y > S.H + 20) continue;
    g.fillStyle = n.nk === 'jct' ? '#7a2fa8' : '#1f7a46'; g.beginPath(); g.arc(x, y, 4, 0, 6.3); g.fill();
  }
  // 文字（いちばん上）。だいじなものから置き、重なるものはあとから出さない
  drawLabels(g, it, z, v, bs);
  // 道具の上がき
  if (S.drawTool) S.drawTool(g, z);
  if (S.pin) drawPin(g);   // さがした場所（t59）
  // 方位と縮尺
  drawScale(g, z);
}
// 文字の層：駅 → IC・JCT → 施設のしるしと名前 → 目じるし → 車庫 → バス停 → 建物の名前 → 島 → 町字 → 市区町村・県・川 → 地番
function drawLabels(g, it, z, v, bs) {
  for (const s of it.stas.values()) if (s.k === 'rail') staLabel(g, s, z);
  if (z >= 4) for (const r of it.rwys.values()) rwyLabel(g, r, z, v);   // 滑走路の番号（t57）
  for (const s of it.stas.values()) if (s.k === 'ship' || s.k === 'air') portLabel(g, s, z);
  if (z >= 3.5) for (const n of it.nodes.values()) {
    if (!n.n || (n.nk !== 'ic' && n.nk !== 'jct')) continue;
    const x = sx(n.fx), y = sy(n.fy); if (x < -40 || y < -20 || x > S.W + 40 || y > S.H + 20) continue;
    label(g, n.n, x + 6, y - 6, { size: 11, color: n.nk === 'jct' ? '#5a1f80' : '#145a33', bg: 'rgba(255,255,255,.85)', left: true });
  }
  if (bs.length) bldMarks(g, bs, z);
  if (S.layer.label) drawSpots(g, it, z);
  if (z >= 4) for (const d of it.deps.values()) if (d.k !== 'ship' && d.k !== 'air') depLabel(g, d, z);
  if (z >= 9) for (const s of it.stas.values()) if (s.k === 'bus') { const x = sx(s.fx), y = sy(s.fy), r = Math.max(3.5, 0.18 * z); if (x > -80 && y > -40 && x < S.W + 80 && y < S.H + 40) label(g, s.n, x, y - r - 8, { size: 11, color: '#164f99', bg: 'rgba(255,255,255,.85)' }); }
  if (bs.length) bldNames(g, bs, z);
  if (S.layer.label) drawPlaces(g, it, z);
  if (S.layer.own && z >= 36) parcelLabels(g, it, v);
}
// 地図の座標（マス）で描くとき・画面にもどすとき
function worldT(g) { const z = S.cam.z; g.setTransform(S.dpr * z, 0, 0, S.dpr * z, S.dpr * (S.W / 2 - S.cam.x * z), S.dpr * (S.H / 2 - S.cam.y * z)); }
function screenT(g) { g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); }
function drawParcels(g, it, z, v) {
  const vis = [...it.parcels.values()].filter(p => p.bb[2] >= v.x0 && p.bb[0] <= v.x1 && p.bb[3] >= v.y0 && p.bb[1] <= v.y1);
  if (!vis.length) return;
  worldT(g);
  const mark = S.toolState && S.toolState.marks;   // 合筆でえらんでいる筆
  for (const p of vis) {
    g.fillStyle = p.own === 3 ? 'rgba(110,110,110,.16)' : p.own === 2 ? 'rgba(40,110,220,.24)' : 'rgba(230,120,30,.2)';
    g.fill(p.fill);
  }
  if (z >= 12) {
    for (const p of vis) {
      g.strokeStyle = p.own === 3 ? 'rgba(90,90,90,.7)' : p.own === 2 ? 'rgba(30,80,170,.85)' : 'rgba(180,90,20,.75)';
      g.lineWidth = 1.2 / z; g.stroke(p.edge);
      if (p.sale != null) { g.strokeStyle = '#d23'; g.setLineDash([4 / z, 3 / z]); g.lineWidth = 2 / z; g.stroke(p.edge); g.setLineDash([]); }
    }
  }
  if (mark && mark.size) for (const p of vis) if (mark.has(p.id)) { g.strokeStyle = '#ff9800'; g.lineWidth = 3.5 / z; g.stroke(p.edge); }
  screenT(g);
}
// 地番（文字の層のいちばん下）
function parcelLabels(g, it, v) {
  for (const p of it.parcels.values()) {
    if (!(p.bb[2] >= v.x0 && p.bb[0] <= v.x1 && p.bb[3] >= v.y0 && p.bb[1] <= v.y1)) continue;
    label(g, p.ban, sx(p.lx), sy(p.ly), { size: 10, color: p.own === 3 ? '#444' : p.own === 2 ? '#1a3f8a' : '#7a4416' });
  }
}
// 境界線：県（太い一点鎖線）・市区町村（鎖線）・区（破線）・町／大字（点線）・丁目／字（細い点線）
const BND_ST = { pref: { w: 3.2, c: 'rgba(80,40,110,.85)', d: [12, 4, 2, 4], z: 1.2 }, muni: { w: 2.2, c: 'rgba(90,50,120,.75)', d: [9, 4], z: 1.2 },
                 ward: { w: 1.6, c: 'rgba(90,50,120,.6)', d: [5, 4], z: 2 }, dist: { w: 1.1, c: 'rgba(100,70,130,.5)', d: [3, 3], z: 4 }, sub: { w: 0.9, c: 'rgba(100,70,130,.38)', d: [2, 3], z: 10 } };
function drawBounds(g, z, v) {
  const cx0 = Math.floor(v.x0 / CS), cy0 = Math.floor(v.y0 / CS), cx1 = Math.floor(v.x1 / CS), cy1 = Math.floor(v.y1 / CS);
  const chs = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const c = S.chunks.get(ckey(cx, cy)); if (c && !c.sea) { if (!c.bnd) c.bnd = chunkBnd(c); chs.push(c); } }
  worldT(g); g.lineCap = 'butt';
  for (const lv of ['sub', 'dist', 'ward', 'muni', 'pref']) {
    const st = BND_ST[lv]; if (z < st.z) continue;
    g.beginPath();
    for (const c of chs) { const a = c.bnd[lv]; for (let i = 0; i < a.length; i += 4) { g.moveTo(a[i], a[i + 1]); g.lineTo(a[i + 2], a[i + 3]); } }
    if (lv === 'pref' || lv === 'muni') { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = (st.w + 2) / z; g.setLineDash([]); g.stroke(); }
    g.strokeStyle = st.c; g.lineWidth = st.w / z; g.setLineDash(st.d.map(d => d / z)); g.stroke();
  }
  g.setLineDash([]); g.lineCap = 'round'; screenT(g);
}
function laneMarks(g, s, z) {
  const w = s.w * z; if (w < 9) return;
  const lanes = s.l, cw = Math.max(0.1, s.w - 0.1), lw = cw / (2 * lanes);
  g.lineCap = 'butt';
  // 中央線：片側2車線以上は黄色の実線2本（国道・県道）／白の実線。1車線は白の破線
  if (lanes >= 2) {
    g.setLineDash([]); g.strokeStyle = s.c === 'nat' || s.c === 'pref' ? '#e2b83a' : '#ffffff'; g.lineWidth = Math.max(1, z * 0.012);
    pathSeg(g, s, 0.012); g.stroke(); pathSeg(g, s, -0.012); g.stroke();
  } else { g.setLineDash([z * 0.12, z * 0.1]); g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, z * 0.01); pathSeg(g, s); g.stroke(); }
  // 車線の境（白の破線）
  if (lanes >= 2) {
    g.setLineDash([z * 0.1, z * 0.12]); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = Math.max(1, z * 0.008);
    for (let k = 1; k < lanes; k++) for (const sgn of [1, -1]) { pathSeg(g, s, sgn * k * lw); g.stroke(); }
  }
  g.setLineDash([]); g.lineCap = 'round';
}
function drawRail(g, s, z) {
  const mine = s.mine;
  const w = Math.max(1.8, (s.dbl ? 0.34 : 0.22) * z);
  g.lineCap = 'butt';
  if (z >= 10 && s.dbl) {
    for (const off of [0.09, -0.09]) {
      g.strokeStyle = '#4a4a4a'; g.lineWidth = Math.max(1.5, 0.12 * z); g.setLineDash([]); pathSeg(g, s, off); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, 0.07 * z); g.setLineDash([z * 0.5, z * 0.5]); pathSeg(g, s, off); g.stroke();
    }
  } else {
    if (mine) { g.strokeStyle = 'rgba(40,110,220,.5)'; g.lineWidth = w + 4; g.setLineDash([]); pathSeg(g, s); g.stroke(); }
    g.strokeStyle = '#3f3f3f'; g.lineWidth = w; g.setLineDash([]); pathSeg(g, s); g.stroke();
    if (z >= 1.5) { g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, w - 2); g.setLineDash([Math.max(4, z * 0.5), Math.max(4, z * 0.5)]); pathSeg(g, s); g.stroke(); }
  }
  if (z >= 10 && !s.el) { /* 非電化：そのまま */ }
  g.setLineDash([]); g.lineCap = 'round';
  if (mine && z >= 10 && s.dbl) { g.strokeStyle = 'rgba(40,110,220,.35)'; g.lineWidth = 0.5 * z + 4; pathSeg(g, s); g.stroke(); }
}
// バス停のしるし（名前は文字の層で）
function drawBusStop(g, s, z) {
  if (z < 5) return;
  const x = sx(s.fx), y = sy(s.fy);
  if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  const r = Math.max(3.5, 0.18 * z);
  g.fillStyle = '#2a7de1'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); g.stroke();
  if (r >= 7) { g.fillStyle = '#fff'; g.font = `bold ${Math.round(r * 1.2)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B', x, y + 0.5); }
}
// 駅の名前（文字の層。ホームの上がわ。重なるときは下がわに）
function staLabel(g, s, z) {
  if (z < 1.6) return;
  const x = sx(s.fx), y = sy(s.fy);
  if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  const Wd = Math.max(5, (0.22 * Math.max(1, s.tr) + 0.18) * z), o = { size: z >= 6 ? 13 : 11, bold: true, color: '#111', bg: 'rgba(255,255,255,.9)', border: s.mine ? '#1f5fbf' : '#555' };
  if (!label(g, s.n, x, y - Wd / 2 - 10, o)) label(g, s.n, x, y + Wd / 2 + 10, o);
}
function drawStation(g, s, z) {
  const x = sx(s.fx), y = sy(s.fy);
  if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  const L = Math.max(10, s.pl / 50 * z), Wd = Math.max(5, (0.22 * Math.max(1, s.tr) + 0.18) * z);
  g.save(); g.translate(x, y); g.rotate(s.a);
  g.fillStyle = '#ffffff'; g.strokeStyle = s.mine ? '#1f5fbf' : '#333'; g.lineWidth = 1.6;
  g.fillRect(-L / 2, -Wd / 2, L, Wd); g.strokeRect(-L / 2, -Wd / 2, L, Wd);
  if (z >= 12) { g.strokeStyle = '#999'; g.lineWidth = 1; for (let k = 1; k < s.tr; k++) { const yy = -Wd / 2 + Wd * k / s.tr; g.beginPath(); g.moveTo(-L / 2, yy); g.lineTo(L / 2, yy); g.stroke(); } }
  g.restore();
  // 番線の番号（ホームの中。近づいたとき）：1番線は駅の向きの左がわ（上）から順に
  const lh = Wd / Math.max(1, s.tr);
  if (z >= 16 && lh >= 6.5) {
    const ca = Math.cos(s.a), sa = Math.sin(s.a), fs = Math.round(Math.min(13, Math.max(8, lh * 0.75)));
    g.font = `bold ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = s.mine ? '#1f5fbf' : '#444';
    for (let k = 0; k < Math.max(1, s.tr); k++) {
      const ly = -Wd / 2 + lh * (k + 0.5);
      for (const lx of (L > 70 ? [-L / 2 + fs * 0.9, L / 2 - fs * 0.9] : [0])) g.fillText(String(k + 1), x + lx * ca - ly * sa, y + lx * sa + ly * ca + 0.5);
    }
  }
}
// 車庫の大きさ：[長さ, はば, 線からのあき, 留置線の数]（マス）。'T400x6' は線路をなぞったもの（400m・6本）
function depDim(k, sz) {
  const m = /^T(\d+)x(\d+)$/.exec(sz || '');
  if (m && k === 'rail') { const l = Number(m[1]), n = Number(m[2]); return [l / 50, (n * 5 + 10) / 50, 0.25, n]; }
  const s = (DEP_SIZE[k] || DEP_SIZE.rail)[sz] || [5, 2];
  return [s[0], s[1], 0.9, Math.round(s[1] / 0.35)];
}
function depPoly(d) {
  const [lt, wt, gap] = depDim(d.k, d.sz);
  const c = Math.cos(d.a), s = Math.sin(d.a), nx = -s * d.side, ny = c * d.side;
  const pts = [];
  for (const [a, b] of [[-lt / 2, gap], [lt / 2, gap], [lt / 2, gap + wt], [-lt / 2, gap + wt]]) pts.push([d.fx + c * a + nx * b, d.fy + s * a + ny * b]);
  return pts;
}
function drawDepot(g, d, z) {
  if (z < 2) return;
  const P = depPoly(d);
  g.beginPath(); P.forEach((p, i) => i ? g.lineTo(sx(p[0]), sy(p[1])) : g.moveTo(sx(p[0]), sy(p[1]))); g.closePath();
  g.fillStyle = d.k === 'rail' ? 'rgba(170,160,150,.85)' : 'rgba(150,170,190,.85)'; g.fill();
  g.strokeStyle = d.mine ? '#1f5fbf' : '#555'; g.lineWidth = 1.5; g.stroke();
  if (z >= 6 && d.k === 'rail') {   // 留置線
    g.strokeStyle = 'rgba(60,60,60,.7)'; g.lineWidth = 1;
    const n = depDim('rail', d.sz)[3] + 1;
    for (let k = 1; k < n; k++) {
      const f = k / n, a = P[0], b = P[1], c2 = P[3], e2 = P[2];
      g.beginPath(); g.moveTo(sx(a[0] + (c2[0] - a[0]) * f), sy(a[1] + (c2[1] - a[1]) * f)); g.lineTo(sx(b[0] + (e2[0] - b[0]) * f), sy(b[1] + (e2[1] - b[1]) * f)); g.stroke();
    }
  }
}
// 車庫の名前（文字の層）
function depLabel(g, d, z) {
  const P = depPoly(d), cx = (P[0][0] + P[2][0]) / 2, cy = (P[0][1] + P[2][1]) / 2, x = sx(cx), y = sy(cy);
  if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  label(g, d.n, x, y, { size: 11, color: '#222', bg: 'rgba(255,255,255,.8)' });
}
function drawRouteHi(g, z, it) {
  const R = S.routeHi; if (!R || !R.legs) return;
  g.strokeStyle = R.color || '#d23'; g.globalAlpha = 0.75; g.lineWidth = Math.max(5, 0.5 * z); g.lineCap = 'round';
  if (R.kind === 'ship' || R.kind === 'air') { g.lineJoin = 'round'; drawRouteHiSea(g, R); g.globalAlpha = 1; return; }   // 航路（t54o）・空路（t54p）
  for (const leg of R.legs) for (const [sid, s0, s1] of leg.g || []) {
    const s = it.segs.get(sid); if (!s) continue;
    const pts = subPts(s, Math.min(s0, s1), Math.max(s0, s1));
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(sx(p[0]), sy(p[1])) : g.moveTo(sx(p[0]), sy(p[1]))); g.stroke();
  }
  g.globalAlpha = 1;
}
// 線の一部の点（はじめから s0〜s1 マス）
function subPts(s, s0, s1) {
  const P = s.P, out = []; let acc = 0;
  for (let i = 0; i + 1 < s.np; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], d = Math.hypot(bx - ax, by - ay);
    if (acc + d >= s0 && acc <= s1) {
      const t0 = clamp((s0 - acc) / (d || 1), 0, 1), t1 = clamp((s1 - acc) / (d || 1), 0, 1);
      if (!out.length) out.push([ax + (bx - ax) * t0, ay + (by - ay) * t0]);
      out.push([ax + (bx - ax) * t1, ay + (by - ay) * t1]);
    }
    acc += d;
  }
  return out;
}
// 文字（白いふちどり・ほかの文字と重ならないように）
let LBL = [];
function label(g, text, x, y, o) {
  o = o || {};
  const size = o.size || 12;
  g.font = `${o.bold ? 'bold ' : ''}${size}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  const w = g.measureText(text).width, h = size + 4;
  const x0 = o.left ? x : x - w / 2 - 3, y0 = y - h / 2;
  for (const b of LBL) if (x0 < b[2] && x0 + w + 6 > b[0] && y0 < b[3] && y0 + h > b[1]) return false;
  LBL.push([x0, y0, x0 + w + 6, y0 + h]);
  if (o.bg) { g.fillStyle = o.bg; roundRect(g, x0, y0, w + 6, h, 4); g.fill(); if (o.border) { g.strokeStyle = o.border; g.lineWidth = 1; g.stroke(); } }
  else { g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.strokeText(text, x0 + 3, y); }
  g.fillStyle = o.color || '#222'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x0 + 3, y + 0.5);
  return true;
}
// しるし（地図記号）の場所をとる。ほかの文字・しるしと重なるときは false（描かない）
function markBox(x, y, r) {
  const b = [x - r - 1, y - r - 1, x + r + 1, y + r + 1];
  for (const c of LBL) if (b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]) return false;
  LBL.push(b); return true;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// 目じるし（大学のキャンパスなど）：町字より先に（重なったら町字のほうを出さない）
function drawSpots(g, it, z) {
  if (z >= 4.5 && z < 24) for (const p of it.places.values()) {
    if (p.k !== 'spot') continue;
    const x = sx(p.x + 0.5), y = sy(p.y + 0.5);
    if (x < -120 || y < -30 || x > S.W + 120 || y > S.H + 30) continue;
    label(g, '🎓 ' + p.n, x, y, { size: 14, bold: true, color: '#7a3214', bg: 'rgba(255,250,240,.88)', border: 'rgba(122,50,20,.35)' });
  }
}
function drawPlaces(g, it, z) {
  // 島（小さい島は近づいたときだけ。島が小さく見えるときは島の下に）
  for (const p of it.places.values()) {
    if (p.k !== 'island') continue;
    const r = Math.sqrt((p.sz || 1) / Math.PI) * z;   // 画面での島の半径（px）
    if (r < 2.5) continue;
    const x = sx(p.x + 0.5), y = sy(p.y + 0.5);
    if (x < -120 || y < -40 || x > S.W + 120 || y > S.H + 40) continue;
    label(g, p.n, x, r < 26 ? y + r + 9 : y, { size: (p.sz || 1) <= 3 ? 10 : r >= 26 ? 13 : 11, color: '#1f4f6e', bold: r >= 26 });
  }
  // 町字（町・大字は近いとき、丁目・字はもっと近いとき）
  if (z >= 5) {
    const cs = [...it.chos.values()].filter(c => (c[1] === 'cho' || c[1] === 'oaza') ? z >= 5 && z < 40 : z >= 14);
    cs.sort((a, b) => (a[1] === 'cho' || a[1] === 'oaza' ? 0 : 1) - (b[1] === 'cho' || b[1] === 'oaza' ? 0 : 1));
    for (const c of cs) {
      const x = sx(c[3] + 0.5), y = sy(c[4] + 0.5);
      if (x < -60 || y < -30 || x > S.W + 60 || y > S.H + 30) continue;
      if (c[1] === 'cho' || c[1] === 'oaza') label(g, c[2], x, y, { size: 12, bold: true, color: '#5a4a6a' });
      else label(g, c[1] === 'aza' ? '字' + c[2] : c[2], x, y, { size: 10, color: '#6a5a7a' });
    }
  }
  const ps = [...it.places.values()];
  const show = p => p.k === 'pref' ? z < 0.6 : p.k === 'muni' ? (z >= 0.3 && z < 12 && (z > 1.2 || (p.pop || 0) > 150000 || p.t === '市')) : p.k === 'ward' ? z >= 1.2 && z < 14 : p.k === 'river' ? z >= 2.5 : false;
  const rank = p => p.k === 'pref' ? 0 : p.k === 'muni' ? 1 + (p.pop > 500000 ? 0 : 1) : p.k === 'ward' ? 3 : p.k === 'river' ? 4 : 5;
  ps.filter(show).sort((a, b) => rank(a) - rank(b) || (b.pop || 0) - (a.pop || 0)).forEach(p => {
    const x = sx(p.x + 0.5), y = sy(p.y + 0.5);
    if (x < -60 || y < -30 || x > S.W + 60 || y > S.H + 30) return;
    if (p.k === 'pref') label(g, p.n + (p.t || '県'), x, y, { size: 18, bold: true, color: '#3a3a3a' });   // 瑠璃府は「府」
    else if (p.k === 'muni') label(g, p.n + (p.t || ''), x, y, { size: p.pop > 500000 ? 16 : 13, bold: true, color: '#2b2b2b' });
    else if (p.k === 'ward') label(g, p.n + '区', x, y, { size: 13, bold: true, color: '#5a4a6a' });
    else if (p.k === 'river') label(g, p.n, x, y, { size: 12, color: '#1e5ea8' });
    else label(g, p.n, x, y, { size: 11, color: '#555' });
  });
}
// 自分の住所のしるし（ピンに家の形）
function drawHome(g, h) {
  const x = sx((h.x + 0.5) / 5), y = sy((h.y + 0.5) / 5);
  if (x < -30 || y < -40 || x > S.W + 30 || y > S.H + 30) return;
  g.fillStyle = '#e0533d'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y - 16, 10, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(x, y); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x - 6, y - 15); g.lineTo(x, y - 21); g.lineTo(x + 6, y - 15); g.lineTo(x + 4, y - 15); g.lineTo(x + 4, y - 10); g.lineTo(x - 4, y - 10); g.lineTo(x - 4, y - 15); g.closePath(); g.fill();
}
function drawScale(g, z) {
  // 縮尺（100m・500m・1km・5km・10km…）
  const opts = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
  let m = opts[0]; for (const o of opts) if (o / 50 * z <= 120) m = o;
  const w = m / 50 * z, x = 12, y = S.H - 14;
  g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(x - 4, y - 16, w + 8, 20);
  g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y - 6); g.stroke();
  g.fillStyle = '#222'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(m >= 1000 ? m / 1000 + 'km' : m + 'm', x + 4, y - 4);
}
function frame() {
  if (!S.open) return;
  if (S.dirty) {
    S.dirty = false; LBL = [];
    try { render(); } catch (e) { console.error(e); }
    needChunks(); needCells(); needCho(); trimChunks();
  }
  requestAnimationFrame(frame);
}

/* ---------- 画面（ボタン・下のシート） ---------- */
const CSS = `
.mp-wrap{position:relative;height:calc(100dvh - 210px);min-height:440px;border-radius:12px;overflow:hidden;background:#4680ba;touch-action:none;user-select:none;-webkit-user-select:none}
.mp-wrap.mp-full{position:fixed;inset:0;height:auto;border-radius:0;z-index:25}
.mp-cv{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}
.mp-top{position:absolute;left:8px;right:56px;top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}
.mp-top>*{pointer-events:auto}
.mp-top select{max-width:38%}
.mp-top select,.mp-top button,.mp-zoom button,.mp-tools button{border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.94);color:#222;border-radius:10px;font-weight:700;font-size:13px;padding:7px 10px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.mp-top button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.mp-top .mp-addr{background:rgba(255,255,255,.94);border-radius:10px;padding:6px 10px;font-size:12px;font-weight:700;color:#333;max-width:60%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.mp-zoom{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px}
.mp-zoom button{width:40px;height:40px;padding:0;font-size:18px}
.mp-tools{position:absolute;left:0;right:0;bottom:0;display:flex;gap:4px;padding:6px 6px calc(6px + env(safe-area-inset-bottom));overflow-x:auto;background:linear-gradient(transparent,rgba(0,0,0,.18))}
.mp-tools button{flex:none;padding:8px 11px}
.mp-tools button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.mp-hint{position:absolute;left:50%;top:52px;transform:translateX(-50%);background:rgba(20,20,20,.78);color:#fff;font-size:12px;font-weight:700;border-radius:10px;padding:6px 10px;max-width:86%;text-align:center;pointer-events:none}
.mp-sheet{position:absolute;left:6px;right:6px;bottom:56px;max-height:44%;overflow:auto;background:var(--panel,#fff);color:var(--ink,#222);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.28);padding:12px 12px 10px;font-size:14px}
.mp-sheet h4{margin:0 0 6px;font-size:16px}
.mp-sheet .mp-x{float:right;border:0;background:none;font-size:20px;line-height:1;color:var(--muted,#777);padding:0 2px}
.mp-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:13px;margin:6px 0}
.mp-kv b{color:var(--muted,#666);font-weight:600}
.mp-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
.mp-row .btn{flex:1 1 auto}
.mp-seg{display:inline-flex;border:1px solid var(--line,#ccc);border-radius:10px;overflow:hidden}
.mp-seg button{border:0;background:var(--bg,#f4f4f4);padding:6px 10px;font-weight:700;font-size:13px;color:inherit}
.mp-seg button.on{background:#1f5fbf;color:#fff}
.mp-cost{font-weight:800;font-size:15px}
.mp-warn{color:#c33;font-size:12px;font-weight:700}
.mp-fts{margin-top:3px;line-height:1.9}
.mp-ft{display:inline-block;border-radius:6px;padding:0 6px;margin:0 4px 0 0;font-size:11px;font-weight:700;line-height:1.7;background:rgba(120,120,120,.13);color:var(--muted,#555)}
.mp-ft.up{background:rgba(46,150,80,.14);color:#23864a}
.mp-ft.dn{background:rgba(205,60,50,.12);color:#c0392b}
.mp-ft.in{background:rgba(31,95,191,.12);color:#1f5fbf}
.mp-sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:6px;border:1px solid rgba(0,0,0,.18)}
.mp-tag,.mp-item .mp-tag{display:inline-block;border:1px solid #7b4fd8;color:#7b4fd8;border-radius:6px;padding:0 5px;font-size:11px;font-weight:700}
.mp-list{display:flex;flex-direction:column;gap:6px;margin:6px 0}
.mp-item{border:1px solid var(--line,#ddd);border-radius:10px;padding:8px 10px;background:var(--panel,#fff)}
.mp-item small{color:var(--muted,#777)}
.mp-cars{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.mp-car{border:1px solid var(--line,#ccc);border-radius:7px;padding:4px 7px;font-size:12px;font-weight:700;background:var(--bg,#f6f6f6);cursor:pointer}
.mp-car.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.mp-car.busy{opacity:.55}
.mp-car .n{display:block;font-size:10px;font-weight:600;opacity:.8}
.mp-spd{width:100%;height:56px;display:block;margin:4px 0 2px;border:1px solid var(--line,#ddd);border-radius:8px;background:#fff}
.mp-dia{width:100%;height:360px;border:1px solid var(--line,#ddd);border-radius:10px;background:#fff;touch-action:pan-x pan-y}
.mp-tt{width:100%;border-collapse:collapse;font-size:12px}
.mp-tt th,.mp-tt td{border-top:1px solid var(--line,#ddd);padding:4px 3px;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
.mp-tt th{font-size:11px;color:var(--muted,#666)}
.mp-tt td.st{text-align:left;font-weight:700}
.mp-scroll{overflow-x:auto}
.mp-inp{width:100%;box-sizing:border-box;font-size:15px;padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:9px;background:var(--bg,#fff);color:inherit}
.mp-num{width:90px}
.mp-floor{border-top:1px solid var(--line,#ddd);padding:2px 0}
.mp-floor summary{cursor:pointer;padding:5px 0;font-size:13px}
.mp-urow{display:flex;flex-wrap:wrap;gap:3px 10px;align-items:center;font-size:12.5px;padding:5px 0;border-top:1px dashed var(--line,#e6e6e6)}
.mp-urow .st{flex:1 1 120px}
.mp-urow .rt{font-variant-numeric:tabular-nums;font-weight:700}
.mp-urow .btn{padding:3px 9px;font-size:12px}
`;
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
function build(root) {
  if (!document.getElementById('mpCss')) { const st = document.createElement('style'); st.id = 'mpCss'; st.textContent = CSS; document.head.appendChild(st); }
  root.innerHTML = `<div class="mp-wrap" id="mpWrap">
    <canvas class="mp-cv"></canvas>
    <div class="mp-top">
      <select class="mp-as" title="だれの名前で"></select>
      <button data-lay="zone">用途地域</button><button data-lay="own" class="on">持ち主</button><button data-b25 title="建物の見えかた（2D・2.5D）"></button>
      <span class="mp-addr" translate="no" hidden></span>
    </div>
    <div class="mp-zoom"><button data-find title="さがす">🔍</button><button data-full title="大きく">⤢</button><button data-zin>＋</button><button data-zout>－</button><button data-home title="瑠璃市役所">⌂</button></div>
    <div class="mp-hint" hidden></div>
    <div class="mp-sheet" hidden></div>
    <div class="mp-tools">
      <button data-tool="look" class="on">👆 見る</button><button data-tool="land">▦ 土地</button><button data-tool="rail">🚃 線路</button>
      <button data-tool="road">🛣 道路</button><button data-tool="sta">🚉 駅・バス停</button><button data-tool="dep">🏭 車庫</button>
      <button data-tool="rwy" hidden>✈ 滑走路</button><button data-tool="del">✖ こわす</button><button data-menu>≡ 車両・系統・ダイヤ</button>
    </div></div>`;
  S.wrap = root.querySelector('#mpWrap'); S.cv = S.wrap.querySelector('canvas'); S.ctx = S.cv.getContext('2d');
  S.sheet = S.wrap.querySelector('.mp-sheet'); S.hint = S.wrap.querySelector('.mp-hint'); S.addr = S.wrap.querySelector('.mp-addr');
  const asSel = S.wrap.querySelector('.mp-as');
  asSel.innerHTML = S.boot.as.map(a => `<option value="${esc(a.as)}">${a.as === 'me' ? '👤' : a.as === 'gov' ? '🏛' : '🏢'} ${esc(asLabel(a))}</option>`).join('');
  try { const sv = localStorage.getItem('mp_as'); if (sv && S.boot.as.some(a => a.as === sv)) S.as = sv; } catch (e) {}
  asSel.value = S.as;
  asSel.onchange = () => { S.as = asSel.value; try { localStorage.setItem('mp_as', S.as); } catch (e) {} for (const c of S.cells.values()) c.stale = true; S.dirty = true; toolVis(); if (S.onAs) S.onAs(); };
  S.wrap.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { const k = b.dataset.lay; S.layer[k] = !S.layer[k]; b.classList.toggle('on', S.layer[k]); S.dirty = true; });
  // 建物の見えかた：2.5D（高さ・壁）と 2D（上から見たまま）。この端末におぼえる
  try { const v = localStorage.getItem('mp_b25'); if (v != null) S.b25 = v !== '0'; } catch (e) {}
  const b25 = S.wrap.querySelector('[data-b25]'), b25L = () => { b25.textContent = S.b25 ? '🏢 2.5D' : '🏢 2D'; };
  b25L(); b25.onclick = () => { S.b25 = !S.b25; b25L(); try { localStorage.setItem('mp_b25', S.b25 ? '1' : '0'); } catch (e) {} S.dirty = true; };
  S.wrap.querySelector('[data-full]').onclick = () => { S.wrap.classList.toggle('mp-full'); resize(); };
  S.wrap.querySelector('[data-find]').onclick = () => openFind();   // さがす（t59）
  S.wrap.querySelector('[data-zin]').onclick = () => zoomAt(S.W / 2, S.H / 2, 1.6);
  S.wrap.querySelector('[data-zout]').onclick = () => zoomAt(S.W / 2, S.H / 2, 1 / 1.6);
  S.wrap.querySelector('[data-home]').onclick = () => setCam(HOME[0], HOME[1], 6);
  S.wrap.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  toolVis();
  S.wrap.querySelector('[data-menu]').onclick = () => openMenu();
  bindInput();
  new ResizeObserver(resize).observe(S.wrap);
  resize();
}
// 管理者が名義「国」のときだけの道具（✈ 滑走路。t57）
function toolVis() {
  const b = S.wrap && S.wrap.querySelector('[data-tool=rwy]'); if (!b) return;
  const on = !!(S.admin && S.as === 'gov'); b.hidden = !on;
  if (!on && S.tool === 'rwy') setTool('look');
}
function resize() {
  if (!S.wrap) return;
  const r = S.wrap.getBoundingClientRect(); S.dpr = Math.min(2, window.devicePixelRatio || 1);
  S.W = Math.max(1, r.width); S.H = Math.max(1, r.height);
  S.cv.width = Math.round(S.W * S.dpr); S.cv.height = Math.round(S.H * S.dpr); S.dirty = true;
}
function hint(t) { S.hint.hidden = !t; S.hint.textContent = t ? T(t) : ''; }
function sheet(html, bind) {
  if (!html) { S.sheet.hidden = true; S.sheet.innerHTML = ''; return null; }
  S.sheet.hidden = false; S.sheet.innerHTML = `<button class="mp-x" data-close>×</button>` + html;
  S.sheet.querySelector('[data-close]').onclick = () => { sheet(null); if (S.onSheetClose) { const f = S.onSheetClose; S.onSheetClose = null; f(); } };
  if (bind) bind(S.sheet);
  busyGuard(S.sheet);
  return S.sheet;
}
// 押したボタンは、その仕事（サーバーへの送信など）が終わるまで押せない（2回押しで2つできないように）
function busyGuard(root) {
  root.querySelectorAll('button').forEach(b => {
    const f = b.onclick; if (!f || f.guarded) return;
    const g = function (ev) {
      if (b.dataset.busy) return;
      const r = f.call(this, ev);
      if (r && typeof r.then === 'function') {
        b.dataset.busy = '1'; b.disabled = true;
        r.finally(() => { delete b.dataset.busy; if (b.isConnected) b.disabled = false; });
      }
      return r;
    };
    g.guarded = true; b.onclick = g;
  });
}
const asLabel = a => String((a && a.name) || '').replace(/（自分）$/, '');   // 自分は 👤 で見分ける（名前だけ出す）
const asName = () => asLabel(S.boot.as.find(a => a.as === S.as));
// サーバーの「つくる・変える」。同じものがまだ送信中なら、もう一度は送らない（2回押し）
const INFLIGHT = new Set();
// サーバー・通信のエラーを日本語に（英語の文のままだと読めない）。もとの文は（ ）で
function errJa(m) {
  const s = String(m || '');
  if (/[ぁ-んァ-ヶ一-龠]/.test(s)) return s;
  const ja = /JWT|token|not authenticated|Auth session/i.test(s) ? 'ログインの期限が切れました。ページを読みこみなおしてください'
    : /Load failed|Failed to fetch|NetworkError|network|fetch|aborted/i.test(s) ? '通信がとぎれました。もう一度ためしてください'
    : /statement timeout|canceling statement/i.test(s) ? '時間がかかりすぎました。少したってから、もう一度ためしてください'
    : /permission denied/i.test(s) ? 'この操作はできません。ログインが切れているかもしれません（ページを読みこみなおしてください）'
    : 'エラーが起きました';
  return s ? `${T(ja)}（${s}）` : T(ja);
}
async function api(fn, args, okMsg) {
  const key = args && args.p_dry !== true ? fn + JSON.stringify(args) : null;
  if (key && INFLIGHT.has(key)) return null;
  if (key) INFLIGHT.add(key);
  try { const r = await call(fn, args); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(errJa(e.message)); return null; }
  finally { if (key) INFLIGHT.delete(key); }
}
// 他人の土地：見つもりの need（許可のいる筆）を出す。持ち主への申請ボタンつき
const LRS = { wait: '返事まち', ok: '許可', no: 'ことわり' };
function needH(need) {
  if (!need || !need.length) return '';
  return `<div class="mp-need"><p class="mp-warn" style="margin:4px 0">他人の土地を使います。持ち主に申請して許可をもらうか、持ち主が貸出料を決めているときだけ、つくれます</p>
    ${need.map(p => `<div class="small">・<span translate="no">${esc(p.label)}</span>（<span>${esc(p.owner)}</span>・<span>${p.n}区画</span>）${p.wait ? ' <b>申請中</b>' : p.no ? ' <span class="mp-warn">ことわられました</span>' : ''}</div>`).join('')}
    ${need.some(p => !p.wait) ? `<div class="mp-row"><button class="btn" data-lreq>持ち主に申請する（${esc(asName())}）</button></div>` : ''}</div>`;
}
function needBind(s, need, after) {
  const b = s.querySelector('[data-lreq]'); if (!b || !need) return;
  b.onclick = async () => {
    const msg = prompt(T('持ち主へのひとこと（なくてもよい）'), ''); if (msg == null) return;
    const r = await api('mp_land_req', { p_parcels: need.filter(p => !p.wait).map(p => p.id), p_msg: msg, p_as: S.as }, '申請しました。返事がきたら通知がとどきます');
    if (r && after) after();
  };
}
const hasNeed = q => !!(q && q.need && q.need.length);

/* ---------- 指・マウス ---------- */
function zoomAt(px, py, f) {
  const x = wx(px), y = wy(py), z = clamp(S.cam.z * f, 0.18, 64);
  setCam(x - (px - S.W / 2) / z, y - (py - S.H / 2) / z, z);
}
function bindInput() {
  const cv = S.cv, P = new Map();
  let drag = null, pinch = null, downAt = 0, moved = false, lp = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const p = pos(e); P.set(e.pointerId, p);
    if (P.size === 1) {
      downAt = now(); moved = false;
      // 道具が点をつかむ（線の点を動かす）
      if (S.grab && S.grab(p[0], p[1])) {
        drag = { tool: true, x: p[0], y: p[1] };
        clearTimeout(lp); lp = setTimeout(() => { if (!moved && P.size === 1 && drag && drag.tool && S.onLong) { drag = null; if (S.grabEnd) S.grabEnd(); S.onLong(wx(p[0]), wy(p[1]), p[0], p[1]); } }, 550);
        return;
      }
      drag = { x: p[0], y: p[1], cx: S.cam.x, cy: S.cam.y };
      clearTimeout(lp); lp = setTimeout(() => { if (!moved && P.size === 1 && S.onLong) S.onLong(wx(p[0]), wy(p[1]), p[0], p[1]); }, 550);
    } else if (P.size === 2) {
      clearTimeout(lp); drag = null;
      const [a, b] = [...P.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, z: S.cam.z, wx: wx((a[0] + b[0]) / 2), wy: wy((a[1] + b[1]) / 2) };
    }
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!P.has(e.pointerId)) { if (S.onHover) S.onHover(wx(p[0]), wy(p[1])); return; }
    P.set(e.pointerId, p);
    if (pinch && P.size >= 2) {
      const [a, b] = [...P.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const z = clamp(pinch.z * d / Math.max(10, pinch.d), 0.18, 64);
      setCam(pinch.wx - (mx - S.W / 2) / z, pinch.wy - (my - S.H / 2) / z, z); moved = true; return;
    }
    if (!drag) return;
    if (drag.tool) { if (!moved && Math.hypot(p[0] - drag.x, p[1] - drag.y) > 4) { moved = true; clearTimeout(lp); } if (moved && S.grabMove) S.grabMove(wx(p[0]), wy(p[1])); return; }
    if (Math.hypot(p[0] - drag.x, p[1] - drag.y) > 6) moved = true;
    if (moved) setCam(drag.cx - (p[0] - drag.x) / S.cam.z, drag.cy - (p[1] - drag.y) / S.cam.z, S.cam.z);
  });
  const up = e => {
    const p = pos(e); P.delete(e.pointerId); clearTimeout(lp);
    if (P.size < 2) pinch = null;
    if (drag && drag.tool) { drag = null; if (S.grabEnd) S.grabEnd(); return; }
    if (drag && !moved && now() - downAt < 500 && e.type === 'pointerup') onTap(wx(p[0]), wy(p[1]), p[0], p[1]);
    if (P.size === 0) drag = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))); }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- いちばん近いもの ---------- */
function nearSeg(x, y, rpx, pred) {
  const it = S.vis; if (!it) return null;
  let best = null; const r = rpx / S.cam.z;
  for (const s of it.segs.values()) {
    if (pred && !pred(s)) continue;
    const b = s.bb; if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) continue;
    const P = s.P; let acc = 0;
    for (let i = 0; i + 1 < s.np; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = clamp(t, 0, 1);
      const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
      if (d <= r + s.w / 2 && (!best || d < best.d)) best = { s, d, x: qx, y: qy, at: acc + L * t, ang: Math.atan2(dy, dx) };
      acc += L;
    }
  }
  return best;
}
// 線 s の上で、(x, y) にいちばん近いところ
function projSeg(s, x, y) {
  const P = s.P; let acc = 0, best = null;
  for (let i = 0; i + 1 < s.np; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const t = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0, qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.d) best = { s, d, x: qx, y: qy, at: acc + L * t, ang: Math.atan2(dy, dx) };
    acc += L;
  }
  return best;
}
// 駅・バス停をタップしたか：駅はホームの四角（描いた大きさ）と駅名のところ、バス停は丸。まわりは rpx の半分（画面の px）まで
function nearSta(x, y, rpx, pred) {
  const it = S.vis; if (!it) return null; let best = null; const z = S.cam.z, tol = rpx / 2;
  for (const s of it.stas.values()) {
    if (pred && !pred(s)) continue;
    const dx = x - s.fx, dy = y - s.fy; let d;
    if (s.k === 'rail') {
      const L = Math.max(10, s.pl / 50 * z), Wd = Math.max(5, (0.22 * Math.max(1, s.tr) + 0.18) * z);   // drawStation と同じ（px）
      const ca = Math.cos(s.a), sa = Math.sin(s.a), u = (dx * ca + dy * sa) * z, v = (-dx * sa + dy * ca) * z;
      d = Math.hypot(Math.max(0, Math.abs(u) - L / 2), Math.max(0, Math.abs(v) - Wd / 2));
      if (d > tol) {
        if (z < 1.6) continue;
        const lx = dx * z, ly = dy * z + Wd / 2 + 10, hw = Math.max(18, String(s.n || '').length * 7);   // 駅名のラベル（ホームの上）
        if (Math.abs(lx) <= hw && Math.abs(ly) <= 10) d = tol; else continue;
      }
    } else if (s.k === 'ship' || s.k === 'air') {   // 港（⚓。t54o）・空港（✈。t54p）
      if (z < portMin(s)) continue;
      d = Math.max(0, Math.hypot(dx, dy) * z - portR(z));
      if (d > tol) continue;
    } else {
      d = Math.max(0, Math.hypot(dx, dy) * z - Math.max(3.5, 0.18 * z));
      if (d > tol) continue;
    }
    if (!best || d < best.d) best = { s, d };
  }
  return best;
}
function nearDep(x, y) {
  const it = S.vis; if (!it) return null;
  for (const d of it.deps.values()) { if (d.k === 'ship' || d.k === 'air') continue; const P = depPoly(d); if (inPoly(x, y, P)) return d; }
  return null;
}
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) c = !c; } return c; }
function nearNode(x, y, rpx, pred) {
  const it = S.vis; if (!it) return null; let best = null;
  for (const n of it.nodes.values()) { if (pred && !pred(n)) continue; const d = Math.hypot(n.fx - x, n.fy - y) * S.cam.z; if (d < rpx && (!best || d < best.d)) best = { n, d }; }
  return best;
}

/* ---------- 道具 ---------- */
const TOOL_HINT = {
  look: '', land: '土地：2か所タップして四角くえらびます（区画は10m四方）',
  rail: '線路：タップして点をおきます。線路のはしから始めると延長、まん中から始めると分岐。点はドラッグで動かせます', road: '道路：タップして点をおきます。道路のはし・まん中から始めると、つながります。点はドラッグで動かせます',
  sta: '駅：ホームの起点をタップ（自分の線路の上）。バス停は道路の上をタップ', dep: '車両基地：自分の線路の上で起点をタップ（バスの営業所は道路の横をタップ）', del: 'こわす：自分の線・駅・車庫・建物をタップ',
  rwy: '滑走路（国）：両はしを2か所タップします（まっすぐ・はば60m・800〜4,000m。2km 以内の国の空港の滑走路になります。浅い海の上にも引けます）'
};
function setTool(t) {
  if (S.toolEnd) { const f = S.toolEnd; S.toolEnd = null; f(); }
  S.tool = t; S.drawTool = null; S.toolState = null; S.addr.hidden = true; S.grab = S.grabMove = S.grabEnd = null; S.onLong = null; S.sel = null; S.routeHi = S.routeHi && S.keepRoute ? S.routeHi : null;
  S.wrap.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  hint(TOOL_HINT[t] || ''); sheet(null);
  if (t === 'rail' || t === 'road') startDraw(t);
  if (t === 'land') startLand();
  if (t === 'rwy') startRwy();
  S.dirty = true;
}
function onTap(x, y, px, py) {
  if (S.tapHook) return S.tapHook(x, y, px, py);
  const t = S.tool;
  if (t === 'look') return lookAt(x, y, px, py);
  if (t === 'sta') return staTap(x, y);
  if (t === 'dep') return depTap(x, y);
  if (t === 'del') return delTap(x, y);
}

/* ---- 見る ---- */
async function lookAt(x, y) {
  const st = nearSta(x, y, 14);
  if (st) return showSta(st.s);
  const dp = nearDep(x, y);
  if (dp) return showDep(dp);
  const hb = hitBld(x, y);
  if (hb) { const [bx, by] = hb.cell.split(',').map(Number); return showSpot(bx, by); }
  const rw = nearRwy(x, y, 6);
  if (rw) return showRwy(rw);
  const sg = nearSeg(x, y, 8);
  if (sg && (S.cam.z >= 3 || sg.s.k === 'rail' || ['exp', 'nat'].includes(sg.s.c))) return showSeg(sg.s, sg);
  return showSpot(Math.floor(x * 5), Math.floor(y * 5));
}
// マスの上にあるもの（「駅：名前」「線路（路線名）・持ち主」など）：種類と名前を分けて出す（種類のことばだけ訳せるように）
function onH(n) {
  n = String(n || '');
  let m = /^(駅|バス停|車庫)：(.*)$/.exec(n);
  if (m) return `<span>${esc(m[1])}</span>：<span>${esc(m[2])}</span>`;
  m = /^(高速道路|国道|県道|府道|都道|道道|市道|私道|線路)(?:（(.*?)）)?(?:・(.*))?$/.exec(n);
  if (m) return `<span>${esc(m[1])}</span>${m[2] ? `（<span>${esc(m[2])}</span>）` : ''}${m[3] ? `・<span>${esc(m[3])}</span>` : ''}`;
  return esc(n);
}
const CLS_NAME = { exp: '高速道路', nat: '国道', pref: '県道', city: '市道', lane: '市道（細い道）', priv: '私道', rail: '線路' };
// ⌂：瑠璃市役所（中里区中央三丁目）のまん中（マス）
const HOME = [-3.1, 2.9];
// 都道府県道の名前：その場所の都道府県（瑠璃府なら府道）
const prefRoad = pref => /府$/.test(pref || '') ? '府道' : /都$/.test(pref || '') ? '都道' : /道$/.test(pref || '') ? '道道' : '県道';
// 線の制限速度のグラフ（よこ：線にそった長さ・たて：速さ。カーブがきついところほど低い）。at：タップしたところ（m）
function spdChart(cv, sp) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 300, H = cv.clientHeight || 56;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const len = Math.max(1, sp.len), top = Math.max(120, Math.min(300, sp.max || 120)), X = m => 4 + m / len * (W - 8), Y = v => H - 4 - Math.min(v, top) / top * (H - 12);
  let m = 0;
  for (const [d, v] of sp.runs || []) {
    g.fillStyle = v < 60 ? '#e05252' : v < 100 ? '#f0a030' : v < 160 ? '#3a9a5a' : '#8cc8a0';
    g.fillRect(X(m), Y(v), Math.max(1, X(m + d) - X(m)), H - 4 - Y(v)); m += d;
  }
  g.strokeStyle = '#999'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(4, Y(100)); g.lineTo(W - 4, Y(100)); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#666'; g.font = '10px system-ui, sans-serif'; g.textBaseline = 'top'; g.fillText('100 km/h', 6, Math.max(0, Y(100) - 12));
  if (sp.at != null) { g.strokeStyle = '#1f5fbf'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(sp.at), 2); g.lineTo(X(sp.at), H - 2); g.stroke(); }
}
// 駅の発着番線のことば（1番線 下り本線 など）
const TRK_D = { down: '下り', up: '上り', both: '両方' }, TRK_M = { main: '本線', side: '待避線' };
const TRK_L = { 'down:main': n => T(`${n}番線 下り本線`), 'up:main': n => T(`${n}番線 上り本線`), 'both:main': n => T(`${n}番線 上下の本線`),
                'down:side': n => T(`${n}番線 下り待避線`), 'up:side': n => T(`${n}番線 上り待避線`), 'both:side': n => T(`${n}番線 上下の待避線`) };
const trkL = (t, i) => (TRK_L[t.d + ':' + t.m] || (n => T(`${n}番線`)))(i + 1);
async function showSpot(cx, cy) {
  S.sel = { kind: 'cell', x: cx, y: cy }; S.dirty = true;
  const sh = sheet(`<h4>${Math.floor(cx / 5)}, ${Math.floor(cy / 5)}</h4><p class="muted small">しらべています…</p>`);
  const d = await api('mp_spot', { p_x: cx, p_y: cy }); if (!d || S.sheet !== sh || !S.sel || S.sel.x !== cx || S.sel.y !== cy) return;
  if (d.none) return sheet(`<h4>地図の外です</h4>`);
  const P = d.parcel; S.sel.parcel = P ? P.id : null; S.dirty = true;
  const on = (d.on || []).map(o => onH(o.name)).join('<br>');
  sheet(`<h4><span translate="no">${esc(d.addr.text)}</span>${d.addr.ban ? ` <span>${esc(d.addr.ban)}</span>` : ''}</h4>
    <div class="mp-kv"><b>地形</b><span><span>${esc(d.ter)}</span>${d.elev ? `<small>（標高 約${d.elev}m）</small>` : ''}</span><b>地目</b><span>${esc(d.chimoku)}</span>
      <b>用途地域</b><span>${esc(d.zname)}</span><b>人の多さ</b><span>${fmt(d.dens)} 人/km²</span>
      ${d.cval != null ? `<b>地価</b><span>${X(d.cval)}（1区画・100㎡）</span>` : ''}
      ${d.cval0 != null ? `<b>評価額</b><span><span>${X(d.cval0)}（1区画・100㎡）</span><br><small class="muted">税・家賃・使用料は評価額で計算します</small></span>` : ''}
      <b>持ち主</b><span>${P ? `<span>${esc(P.owner)}</span>${P.mine ? '<small>（あなた）</small>' : ''}` : d.pub ? '公衆用道路' : '国'}</span>
      ${P ? `<b>筆</b><span>${esc(P.ban)}・${fmt(P.n * 100)}㎡・地価 ${X(P.val)}</span>` : ''}
      ${P && P.val0 != null ? `<b>筆の評価額</b><span>${X(P.val0)}</span>` : ''}
      ${P && P.sale != null ? `<b>売り出し</b><span>${X(P.sale)}</span>` : ''}
      ${P && !P.gov ? `<b>貸出料</b><span>${P.rent != null ? `<span>1区画・1日 ${X(P.rent)}</span><small>（線路・道路・駅・車庫に、申請なしで使えます）</small>` : '<span>貸していません</span>'}${P.mine ? `<small>・標準 ${X(P.std)}</small>` : ''}</span>` : ''}
      ${P && !P.mine && (P.reqs || []).length ? `<b>申請</b><span>${P.reqs.map(r => `<span>${esc(r.who)}</span>：<b>${esc(LRS[r.st] || r.st)}</b>${r.st === 'ok' ? `<small>（1区画・1日 ${X(r.fee)}）</small>` : ''}`).join('<br>')}</span>` : ''}
      ${P && P.mine && P.nreq ? `<b>申請</b><span><a href="#" data-lreqs>返事まち ${P.nreq}件</a></span>` : ''}
      ${P && P.b ? bldRow(P.b, P.mine) : ''}
      ${on ? `<b>あるもの</b><span>${on}</span>` : ''}
      ${(d.leases || []).length ? `<b>使用料</b><span>${d.leases.map(l => `<span>${esc(l.who)}</span>：<span>1日 ${X(l.fee)}</span>`).join('<br>')}</span>` : ''}
      ${isHome(cx, cy, P) ? '<b>住所</b><span>🏠 あなたの住所です</span>' : ''}
    </div>
    <div class="mp-row">${!P && d.buy ? `<button class="btn main" data-buyhere>ここの土地を買う</button>` : ''}
      ${P && !P.mine && P.sale != null ? `<button class="btn main" data-pbuy>この筆を買う（${X(Math.ceil(P.sale * 1.03))}）</button>` : ''}
      ${!P && !d.buy && d.why ? `<span class="muted small">${esc(d.why)}</span>` : ''}
      ${P && P.b ? `<button class="btn main" data-bopen>${P.gov ? '建物を見る' : '部屋・テナント'}</button>` : ''}
      ${P && P.gov && P.b && OFFICE_K.includes(P.b.kind) ? '<button class="btn main" data-jm>🏛 住民の窓口</button>' : ''}
      ${P && P.mine ? `<button class="btn" data-sell>${P.sale != null ? '売り出しをやめる' : '売りに出す'}</button>
        ${P.b ? '' : '<button class="btn" data-bld>建物を建てる</button>'}<button class="btn" data-split>分筆</button><button class="btn" data-merge>合筆</button><button class="btn" data-rent>貸出料</button>` : ''}
      ${P && !P.mine && !P.gov && P.rent == null && S.as !== 'gov' && !(P.reqs || []).some(r => r.as === S.as && r.st !== 'no') ? `<button class="btn" data-lreq1>使う申請（${esc(asName())}）</button>` : ''}
      ${/海|川|湖/.test(d.ter || '') ? '' : '<button class="btn" data-home>🏠 ここを自分の住所に</button>'}</div>`, s => {
    const q = k => s.querySelector(k);
    if (q('[data-rent]')) q('[data-rent]').onclick = () => parcelRent(P, cx, cy);
    if (q('[data-lreqs]')) q('[data-lreqs]').onclick = ev => { ev.preventDefault(); openLandReqs(); };
    if (q('[data-lreq1]')) q('[data-lreq1]').onclick = async () => {
      const msg = prompt(T('持ち主へのひとこと（なくてもよい）。許可されると、この筆を線路・道路・駅・車庫に使えます'), ''); if (msg == null) return;
      if (await api('mp_land_req', { p_parcels: [P.id], p_msg: msg, p_as: S.as }, '申請しました。返事がきたら通知がとどきます')) showSpot(cx, cy);
    };
    if (q('[data-buyhere]')) q('[data-buyhere]').onclick = () => { setTool('land'); S.toolState.a = [cx, cy]; landSheet(); S.dirty = true; };
    if (q('[data-pbuy]')) q('[data-pbuy]').onclick = () => parcelBuy(P);
    if (q('[data-sell]')) q('[data-sell]').onclick = () => parcelSell(P);
    if (q('[data-bld]')) q('[data-bld]').onclick = () => bldStart(P);
    if (q('[data-bopen]')) q('[data-bopen]').onclick = () => openBld(P.b.id);
    if (q('[data-jm]')) q('[data-jm]').onclick = () => openJuumin(P.b.id);   // 住民の窓口（t59）
    if (q('[data-split]')) q('[data-split]').onclick = () => startSplit(P);
    if (q('[data-merge]')) q('[data-merge]').onclick = () => startMerge(P);
    if (q('[data-home]')) q('[data-home]').onclick = () => homeHere(cx, cy, P);
  });
  S.addr.hidden = false; S.addr.textContent = d.addr.text + (d.addr.ban ? ' ' + d.addr.ban : '');
}
// 自分の住所（t54i）：ここが住所か（区画か、同じ建物）
function isHome(cx, cy, P) { const h = S.boot.home; return !!h && ((h.x === cx && h.y === cy) || (!!P && !!P.b && h.bld === P.b.id)); }
// ここを自分の住所に（建物に部屋がいくつもあれば、部屋をえらぶ）
async function homeHere(cx, cy, P) {
  const done = r => { S.boot.home = r; S.dirty = true; if (S.sel && S.sel.kind === 'cell' && S.sel.x === cx && S.sel.y === cy) showSpot(cx, cy); };
  if (P && P.b && P.b.n > 1) {
    const d = await api('mp_bld_get', { p_bld: P.b.id }); if (!d) return;
    const m = modal(['自分の住所にする', `<p class="small" style="margin:0 0 6px"><span translate="no">${esc(d.addr)}</span> <span>${esc(d.name || d.kname)}</span></p>
      <p class="muted small">部屋をえらんでください。住所は、あなたのページでみんなに見えます</p>
      <div class="mp-row" style="flex-wrap:wrap">${d.units.map(u => `<button class="btn" data-hu="${u.id}">${esc(u.room)}</button>`).join('')}</div>
      <div class="mp-row"><button class="btn" data-hu="0">部屋なし（建物まで）</button></div>`], b => {
      b.querySelectorAll('[data-hu]').forEach(x => x.onclick = async () => {
        const r = await api('mp_home_set', { p_x: cx, p_y: cy, p_unit: Number(x.dataset.hu) || null }, '自分の住所にしました'); if (r) { m.close(); done(r); }
      });
    });
    return;
  }
  if (!confirm(T('ここを自分の住所にします。住所は、あなたのページでみんなに見えます。よろしいですか？'))) return;
  const r = await api('mp_home_set', { p_x: cx, p_y: cy, p_unit: null }, '自分の住所にしました'); if (r) done(r);
}
function showSeg(s, hit) {
  S.sel = { kind: 'seg', id: s.id }; S.dirty = true;
  const own = s.o === 'gov' ? '国' : (S.vis.names[s.o] || '');
  sheet(`<h4><span data-cls>${esc(CLS_NAME[s.c] || s.c)}</span>${s.n ? `・<span>${esc(s.n)}</span>` : ''}</h4><p class="small muted" data-addr translate="no" style="margin:0"></p>
    <div class="mp-kv"><b>持ち主</b><span><span>${esc(own)}</span>${s.mine && s.o !== 'gov' ? '<small>（あなた）</small>' : ''}</span>
      <b>長さ</b><span>${fmt(Math.round(s.len * 50))} m</span>
      ${s.k === 'road' ? `<b>車線</b><span>${s.l ? '片側' + s.l + '車線' : '中央線なし'}</span>` : `<b>線路</b><span>${s.dbl ? '複線' : '単線'}・${s.el ? '電化' : '非電化'}</span>`}
      <b>制限速度</b><span data-spd><span>${s.v} km/h</span></span>
      ${s.k === 'rail' && s.o !== 'gov' ? thruRow(s.o) : ''}</div>
    ${s.k === 'rail' ? '<canvas class="mp-spd" data-spdc hidden></canvas>' : ''}
    ${s.mine ? `<div class="mp-row"><button class="btn" data-edit>形を直す</button><button class="btn" data-split>ここで分ける</button><button class="btn" data-opt>${s.k === 'rail' ? '複線・電化・名前' : '車線・名前'}</button><button class="btn" data-del>こわす</button></div>` : ''}`, sh => {
    const q = k => sh.querySelector(k);
    if (q('[data-edit]')) q('[data-edit]').onclick = () => startEdit(s);
    if (q('[data-split]')) q('[data-split]').onclick = async () => { if (await api('mp_seg_split', { p_id: s.id, p_x: hit.x, p_y: hit.y }, '分けました')) { refreshBox(...s.bb); sheet(null); } };
    if (q('[data-opt]')) q('[data-opt]').onclick = () => segOpts(s);
    if (q('[data-del]')) q('[data-del]').onclick = () => segDel(s);
    if (q('[data-thru]')) q('[data-thru]').onclick = () => thruReq({ seg: s.id }, () => { if (S.sel && S.sel.kind === 'seg' && S.sel.id === s.id) showSeg(s, hit); });
  });
  const still = () => S.sel && S.sel.kind === 'seg' && S.sel.id === s.id;
  if (s.k === 'rail' && s.o !== 'gov' && s.o !== myKey() && !thruFresh()) loadThru().then(() => { if (still()) showSeg(s, hit); });
  if (hit) addrInto(hit.x, hit.y, still).then(d => {
    if (d && d.addr && s.c === 'pref' && still()) { const e = S.sheet.querySelector('[data-cls]'); if (e) e.textContent = prefRoad(d.addr.pref); }
  });
  api('mp_seg_speed', { p_id: s.id, p_x: hit ? hit.x : null, p_y: hit ? hit.y : null }).then(sp => {
    if (!sp || !still()) return;
    const e = S.sheet.querySelector('[data-spd]');
    if (e) e.innerHTML = s.k === 'rail' ? `${sp.here != null ? `<span>ここ ${sp.here} km/h</span><br>` : ''}<small class="muted">${sp.min === sp.max ? `<span>この線 ${sp.min} km/h</span>` : `<span>この線 ${sp.min}〜${sp.max} km/h</span>`}${sp.rmin && sp.rmin < 99999 ? `<br><span>いちばんきついカーブ 半径 ${fmt(sp.rmin)} m</span>` : ''}</small>` : `<span>${sp.here} km/h</span>`;
    const cv = S.sheet.querySelector('[data-spdc]'); if (cv) { cv.hidden = false; spdChart(cv, sp); }
  });
}
// 住所をシートと上の帯に
async function addrInto(x, y, still) {   // x, y：マス（50m）の座標。その場所の区画（10m）の住所
  const d = await api('mp_spot', { p_x: Math.floor(x * 5), p_y: Math.floor(y * 5) }); if (!d || !d.addr || !still()) return null;
  const e = S.sheet.querySelector('[data-addr]'); if (e) e.textContent = d.addr.text;
  S.addr.hidden = false; S.addr.textContent = d.addr.text;
  return d;
}
function segOpts(s) {
  const st = { dbl: s.dbl, el: s.el, l: s.l, name: s.n || '', q: null, quoting: false, seq: 0 };
  const same = () => st.dbl === s.dbl && st.el === s.el && st.l === s.l;   // 名前だけ
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; draw();
    const q = await api('mp_seg_opts', { p_id: s.id, p_dbl: st.dbl, p_elec: st.el, p_name: st.name, p_dry: true, p_lanes: st.l });
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; draw();
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; draw(); };
  const draw = () => {
    const q = st.q;
    sheet(`<h4>${s.k === 'rail' ? '線路' : '道路'}の設定</h4>
      ${s.k === 'rail' ? `<div class="mp-row"><span class="mp-seg"><button data-d="0" class="${!st.dbl ? 'on' : ''}">単線</button><button data-d="1" class="${st.dbl ? 'on' : ''}">複線</button></span>
        <span class="mp-seg"><button data-e="0" class="${!st.el ? 'on' : ''}">非電化</button><button data-e="1" class="${st.el ? 'on' : ''}">電化</button></span></div>`
      : `<div class="mp-row">片側 <span class="mp-seg">${[0, 1, 2, 3].map(n => `<button data-l="${n}" class="${st.l === n ? 'on' : ''}">${n ? n + '車線' : '細い道'}</button>`).join('')}</span></div>`}
      <div class="mp-row"><input class="mp-inp" data-nm placeholder="名前（路線名など）" value="${esc(st.name)}"></div>
      <div class="mp-row">${same() ? '' : q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、変えられます</span>'}</div>
      ${!same() && q ? needH(q.need) : ''}
      <p class="muted small">もとにもどしても（単線にする・車線をへらす）お金はもどりません</p>
      <div class="mp-row"><button class="btn main" data-ok ${same() || (q && !hasNeed(q)) ? '' : 'disabled'}>この設定にする</button></div>`, sh => {
      needBind(sh, !same() && q && q.need, () => quote());
      sh.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { st.dbl = b.dataset.d === '1'; changed(); });
      sh.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { st.el = b.dataset.e === '1'; changed(); });
      sh.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { st.l = Number(b.dataset.l); changed(); });
      { const es = sh.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
      sh.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
      sh.querySelector('[data-ok]').onclick = async () => {
        st.name = sh.querySelector('[data-nm]').value;
        if (await api('mp_seg_opts', { p_id: s.id, p_dbl: st.dbl, p_elec: st.el, p_name: st.name, p_dry: false, p_lanes: st.l }, '設定を変えました')) { refreshBox(...s.bb); sheet(null); }
      };
    });
  };
  draw();
}
async function segDel(s) {
  if (!confirm(T('この線をこわしますか？（工事費はもどりません）'))) return;
  if (await api('mp_seg_del', { p_id: s.id }, 'こわしました')) { refreshBox(...s.bb); sheet(null); S.sel = null; }
}
function showSta(s) {
  S.sel = { kind: 'sta', id: s.id }; S.dirty = true;
  const air = s.k === 'air', port = s.k === 'ship' || air, pdep = port ? [...S.vis.deps.values()].find(d => d.k === s.k && d.b != null && d.b === s.b) : null;
  const gov = air && s.o === 'gov', adm = gov && S.admin;   // 国の空港（t54q）：だれでも使える。名前・使用料は管理者
  sheet(`<h4>${s.k === 'rail' ? '🚉 ' : air ? '✈ ' : port ? '⚓ ' : '🚏 '}<span>${esc(s.n)}</span>${s.k === 'rail' ? '<span>駅</span>' : gov ? '<span>（国の空港）</span>' : air ? '<span>（空港）</span>' : port ? '<span>（港）</span>' : ''}</h4><p class="small muted" data-addr translate="no" style="margin:0"></p>
    <div class="mp-kv"><b>持ち主</b><span><span>${s.o === 'gov' ? '国' : esc(S.vis.names[s.o] || '')}</span>${s.mine ? '<small>（あなた）</small>' : ''}</span>
      ${s.k === 'rail' ? `<b>ホーム</b><span>${s.pl} m・${s.tr}番線まで</span>` : ''}
      ${s.k === 'rail' && s.tk ? `<b>発着番線</b><span>${s.tk.map((t, i) => `<span>${esc(trkL(t, i))}</span>`).join('<br>')}</span>` : ''}
      ${gov ? `<b>使用料</b><span>${s.ln != null ? `<span>空路に入れると 1路線・1日 ${X(s.ln)}（国庫へ）</span>` : '<span>いまは新しい空路に使えません</span>'}</span>`
        : s.k === 'bus' || port ? `<b>貸し出し</b><span>${s.ln != null ? `<span>ほかの人・会社に貸しています（1系統・1日 ${X(s.ln)}）</span>` : '<span>ほかの人・会社には貸していません</span>'}</span>` : ''}
      ${air ? `<b>滑走路</b><span>${s.pl > 0 ? `<span>${fmt(s.pl)}m（いちばん長い滑走路）</span>` : '<span class="mp-warn">まだありません（飛行機は飛べません）</span>'}</span><b>発着口</b><span><span>${s.tr}こ</span>（<span>1つで1時間に1便</span>）</span>` : ''}
      ${port && pdep ? (gov ? `<b>駐機場</b><span>${pdep.cap}機まで（みんなで使う）</span>` : air ? `<b>駐機場</b><span>${pdep.cap}機まで</span>` : `<b>船の置き場</b><span>${pdep.cap}隻まで</span>`) : ''}
      <b>${air ? '空路' : port ? '航路' : '系統'}</b><span>${(s.rt || []).map(r => `<a href="#" data-rt="${r.id}" style="color:${esc(r.c)};font-weight:800">■ ${esc(r.n)}</a>`).join('<br>') || 'なし'}</span>
      ${s.k === 'rail' ? thruRow(s.o) : ''}</div>
    ${gov ? `<div class="mp-row"><button class="btn main" data-slot>🛫 発着口・入札</button>${pdep ? '<button class="btn" data-cars>飛行機を見る・注文する</button>' : ''}<button class="btn" data-newr>＋ 空路</button>${adm ? '<button class="btn" data-ren>名前を変える</button><button class="btn" data-lend>使用料</button>' : ''}</div>
      <p class="muted small"><span>国の空港です。だれでも駐機場に飛行機を置いて（≡ →「車両と編成」）、空路に使えます。空路に入れると、1路線・1日の使用料を国にはらいます（使いはじめたときの値段のまま）。</span><span>この空港を出る便は、1時間に、持っている発着口の数まで（発着口の権利は入札で買います）</span></p>`
    : s.mine && port ? `<div class="mp-row"><button class="btn" data-ren>名前を変える</button><button class="btn" data-lend>貸し出し</button>${pdep ? (air ? '<button class="btn" data-cars>飛行機を見る</button>' : '<button class="btn" data-cars>船を見る</button>') : ''}${air ? '<button class="btn" data-newr>＋ 空路</button>' : '<button class="btn" data-newr>＋ 航路</button>'}</div>
      <p class="muted small">${air ? '空港は、空港の建物をこわすとなくなります' : '港は、フェリーターミナルの建物をこわすとなくなります'}</p>` : s.mine ? `<div class="mp-row"><button class="btn" data-ren>名前を変える</button>${s.k === 'bus' ? '<button class="btn" data-lend>貸し出し</button>' : '<button class="btn" data-plat>ホーム・番線</button><button class="btn" data-trk>発着番線</button>'}<button class="btn" data-del>こわす</button></div>` : ''}`, sh => {
    const cs = sh.querySelector('[data-cars]'); if (cs) cs.onclick = () => openCars(pdep.id);
    const sl = sh.querySelector('[data-slot]'); if (sl) sl.onclick = () => openSlots(s.id);
    const nr = sh.querySelector('[data-newr]'); if (nr) nr.onclick = () => { sheet(null); routeBuild(s.k); };
    sh.querySelectorAll('[data-rt]').forEach(a => a.onclick = ev => { ev.preventDefault(); openDia(Number(a.dataset.rt)); });
    const th = sh.querySelector('[data-thru]'); if (th) th.onclick = () => thruReq({ sta: s.id }, () => { if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) showSta(s); });
    const tk = sh.querySelector('[data-trk]'); if (tk) tk.onclick = () => trkEdit(s);
    const pl = sh.querySelector('[data-plat]'); if (pl) pl.onclick = () => staResize(s);
    const ld = sh.querySelector('[data-lend]'); if (ld) ld.onclick = async () => {
      const v = prompt(gov ? T('国の空港の使用料（1路線・1日・X）。空にすると、新しい空路には使えなくなります（いまの空路は、そのまま使えます）') : T('ほかの人・会社に貸す使用料（1系統・1日・X）。空にすると貸しません（いま使っている系統は、そのまま使えます）'), s.ln != null ? String(s.ln) : '1000');
      if (v == null) return;
      const t = hw(v).replace(/[,，\s]/g, ''), n = t === '' ? null : Number(t);
      if (n != null && !(n >= 0)) return toast('数字を入れてください');
      const r = await api('mp_stop_lend', { p_id: s.id, p_lend: n }, gov ? (n == null ? '新しい空路には使えなくしました' : '使用料を決めました') : n == null ? '貸すのをやめました' : '貸し出します');
      if (r) { s.ln = r.lend; refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); showSta(s); }
    };
    const r = sh.querySelector('[data-ren]'); if (r) r.onclick = async () => { const nm = prompt(T('新しい名前'), s.n); if (nm && await api('mp_sta_edit', { p_id: s.id, p_name: nm, p_del: false }, '名前を変えました')) refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); };
    const d = sh.querySelector('[data-del]'); if (d) d.onclick = async () => { if (confirm(T('こわしますか？（工事費はもどりません）')) && await api('mp_sta_edit', { p_id: s.id, p_name: null, p_del: true }, 'こわしました')) { refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); sheet(null); } };
  });
  addrInto(s.fx, s.fy, () => S.sel && S.sel.kind === 'sta' && S.sel.id === s.id);
  if (s.k === 'rail' && s.o !== myKey() && !thruFresh()) loadThru().then(() => { if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) showSta(s); });
}
// 駅のホームの長さ・番線の数を変える（まん中はそのまま、前後にのびちぢみ）。見つもってから
function staResize(s) {
  const sg = S.vis && S.vis.segs.get(s.seg);
  const st = { plat: s.pl, tracks: s.tr, q: null, err: null, quoting: false, seq: 0 };
  const same = () => st.plat === s.pl && st.tracks === s.tr;
  S.sel = { kind: 'sta', id: s.id }; S.dirty = true;
  S.drawTool = sg ? (g, z) => {
    if (!S.sel || S.sel.kind !== 'sta' || S.sel.id !== s.id) return;   // ほかのものをえらんだら描かない
    const a0 = s.at - st.plat / 100, a1 = s.at + st.plat / 100;
    g.lineCap = 'butt'; g.strokeStyle = 'rgba(31,95,191,.9)'; g.lineWidth = Math.max(8, (0.22 * st.tracks + 0.3) * z); pathPart(g, sg, a0, a1); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(4, (0.22 * st.tracks + 0.18) * z); pathPart(g, sg, a0, a1); g.stroke(); g.lineCap = 'round';
  } : null;
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_sta_resize', { p_id: s.id, p_plat: st.plat, p_tracks: st.tracks, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; draw(); S.dirty = true;
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; st.err = null; draw(); S.dirty = true; };
  const draw = () => {
    const q = st.q;
    sheet(`<h4>🚉 <span>${esc(s.n)}</span><span>駅のホーム</span></h4>
      <div class="mp-row"><span>ホーム</span> <button class="btn" data-pm="-20" style="flex:none;padding:4px 12px">−</button><b style="min-width:4.2em;text-align:center">${st.plat}m</b><button class="btn" data-pm="20" style="flex:none;padding:4px 12px">＋</button>
        <span class="muted small"><span>20m の車両 ${Math.floor(st.plat / 20)}両まで</span>（<span>いま ${s.pl}m</span>）</span></div>
      <div class="mp-row">番線 <span class="mp-seg">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button data-t="${n}" class="${st.tracks === n ? 'on' : ''}">${n}</button>`).join('')}</span><span class="muted small">（いま ${s.tr}番線）</span></div>
      <div class="mp-row">${same() ? '' : q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span><span class="small"><span>維持費 1日 ${X(q.up_now)} → ${X(q.up_day)}</span>${q.lease ? `<span>・ふえる使用料 1日 ${X(q.lease)}</span>` : ''}</span>`
        : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、変えられます</span>'}</div>
      ${!same() && q ? needH(q.need) : ''}
      <p class="muted small"><span>駅のまん中はそのままで、ホームが前後にのびちぢみします。工事費は、ふえたホームの分だけかかります（短くしても・番線をへらしても、お金はもどりません）。</span>${q && q.routes ? `<span>この駅を通る ${q.routes}系統の時刻を組みなおします。</span>` : ''}</p>
      <div class="mp-row"><button class="btn main" data-ok ${!same() && q && !hasNeed(q) ? '' : 'disabled'}>この大きさにする</button><button class="btn" data-back>もどる</button></div>`, sh => {
      needBind(sh, !same() && q && q.need, () => quote());
      sh.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { st.plat = clamp(st.plat + Number(b.dataset.pm), 20, 400); changed(); });
      sh.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.tracks = Number(b.dataset.t); changed(); });
      { const es = sh.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
      sh.querySelector('[data-back]').onclick = () => { S.drawTool = null; S.dirty = true; showSta(s); };
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_sta_resize', { p_id: s.id, p_plat: st.plat, p_tracks: st.tracks, p_dry: false }, 'ホームを変えました');
        if (!r) return;
        s.pl = r.plat; s.tr = r.tracks; S.drawTool = null;
        refreshBox(s.fx - 6, s.fy - 6, s.fx + 6, s.fy + 6); showSta(s);
      };
    });
  };
  S.onSheetClose = () => { S.drawTool = null; S.dirty = true; };
  draw();
}
// 駅の発着番線を決める：番線ごとに 下り・上り・両方／本線・待避線（待避線があると、優先番号の低い列車がそこで待避する）
async function trkEdit(s) {
  const d = await api('mp_sta_trk', { p_sta: s.id }); if (!d) return;
  const cur = d.trk.map(t => ({ ...t }));
  const m = modal(['発着番線', ''], null);
  const draw = () => m.set('発着番線', `<p class="small" style="margin:0"><b>${esc(d.name)}</b>（<span>${d.tracks}番線まで</span>）</p>
      <div class="mp-list">${cur.map((t, i) => `<div class="mp-row small" style="align-items:center;margin-top:4px"><b style="min-width:4.5em">${i + 1}番線</b>
        <span class="mp-seg">${['down', 'up', 'both'].map(k => `<button data-td="${i}:${k}" class="${t.d === k ? 'on' : ''}">${TRK_D[k]}</button>`).join('')}</span>
        <span class="mp-seg">${['main', 'side'].map(k => `<button data-tm="${i}:${k}" class="${t.m === k ? 'on' : ''}">${TRK_M[k]}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="mp-row"><button class="btn main" data-ok>決める</button><button class="btn" data-def>いつもの決まりにもどす</button></div>
      <p class="muted small"><span>地図で駅に近づくと、ホームの中に番線の番号（1・2…）が出ます。</span><br><span>列車は、ふだんはその向きの本線に止まります（採時駅で番線を決めた列車は、その番線）。その向きで使える番線が2つ以上ある駅は待避できます。優先番号の大きい列車は待避線で待ち、あとから来る優先番号の小さい列車に先をゆずります</span></p>`, b => {
    b.querySelectorAll('[data-td]').forEach(x => x.onclick = () => { const [i, k] = x.dataset.td.split(':'); cur[Number(i)].d = k; draw(); });
    b.querySelectorAll('[data-tm]').forEach(x => x.onclick = () => { const [i, k] = x.dataset.tm.split(':'); cur[Number(i)].m = k; draw(); });
    b.querySelector('[data-ok]').onclick = async () => { const r = await api('mp_sta_trk_set', { p_sta: s.id, p_trk: cur }, '決めました'); if (r) { s.tk = r.trk; m.close(); showSta(s); } };
    b.querySelector('[data-def]').onclick = async () => { const r = await api('mp_sta_trk_set', { p_sta: s.id, p_trk: null }, 'もどしました'); if (r) { s.tk = r.trk; m.close(); showSta(s); } };
  });
  draw();
}
function showDep(d) {
  S.sel = { kind: 'dep', id: d.id }; S.dirty = true;
  sheet(`<h4>🏭 ${esc(d.n)}</h4><div class="mp-kv"><b>種類</b><span>${d.k === 'rail' ? '車両基地' : 'バスの営業所'}（${d.sz}）</span><b>入る数</b><span>${d.k === 'rail' ? `${d.cap}両` : `${d.cap}台`}</span></div>
    ${d.mine ? `<div class="mp-row"><button class="btn" data-cars>車両を見る</button><button class="btn" data-ren>名前を変える</button><button class="btn" data-del>こわす</button></div>` : ''}`, sh => {
    const c = sh.querySelector('[data-cars]'); if (c) c.onclick = () => openCars(d.id);
    const r = sh.querySelector('[data-ren]'); if (r) r.onclick = async () => { const nm = prompt(T('新しい名前'), d.n); if (nm && await api('mp_dep_edit', { p_id: d.id, p_name: nm, p_del: false }, '名前を変えました')) refreshBox(d.fx - 8, d.fy - 8, d.fx + 8, d.fy + 8); };
    const x = sh.querySelector('[data-del]'); if (x) x.onclick = async () => { if (confirm(T('こわしますか？（工事費はもどりません）')) && await api('mp_dep_edit', { p_id: d.id, p_name: null, p_del: true }, 'こわしました')) { refreshBox(d.fx - 8, d.fy - 8, d.fx + 8, d.fy + 8); sheet(null); } };
  });
}

/* ---- 滑走路（t57）：管理者が名義「国」で、両はしを2か所タップして引く ---- */
function startRwy() {
  S.toolState = { a: null, b: null };
  S.drawTool = (g, z) => {
    const st = S.toolState; if (!st || !st.a) return;
    const b = st.b || st.a;
    g.lineCap = 'butt'; g.strokeStyle = 'rgba(30,110,230,.35)'; g.lineWidth = Math.max(3, 1.2 * z);
    g.beginPath(); g.moveTo(sx(st.a[0]), sy(st.a[1])); g.lineTo(sx(b[0]), sy(b[1])); g.stroke(); g.lineCap = 'round';
    g.fillStyle = '#1f5fbf'; for (const p of [st.a, st.b].filter(Boolean)) { g.beginPath(); g.arc(sx(p[0]), sy(p[1]), 5, 0, 6.3); g.fill(); }
    if (st.b) label(g, fmt(Math.round(Math.hypot(b[0] - st.a[0], b[1] - st.a[1]) * 5) * 10) + 'm', sx((st.a[0] + b[0]) / 2), sy((st.a[1] + b[1]) / 2) - 14, { size: 12, color: '#123c8c', bg: 'rgba(255,255,255,.9)' });
  };
  S.tapHook = (x, y) => {
    if (S.cam.z < 1.5) { setCam(x, y, 4); hint('近づいてから、滑走路の両はしをタップします'); return; }
    const st = S.toolState;
    if (!st.a || st.b) { st.a = [x, y]; st.b = null; } else st.b = [x, y];
    rwySheet(); S.dirty = true;
  };
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; };
}
async function rwySheet() {
  const st = S.toolState; if (!st || !st.a) return;
  if (!st.b) return sheet(`<h4>✈ 滑走路</h4><p class="muted small">もう1つのはしをタップしてください（まっすぐ・はば60m・800〜4,000m）</p>`);
  const p = [st.a[0], st.a[1], st.b[0], st.b[1]];
  sheet(`<h4>✈ 滑走路</h4><p class="muted small">見つもっています…</p>`);
  const q = await api('mp_rwy_build', { p_pts: p, p_dry: true });
  if (!q || S.toolState !== st || !st.b || st.b[0] !== p[2] || st.b[1] !== p[3]) return;
  const why = q.why || {}, sk = [why.water && `水の上 ${why.water}`, why.mtn && `山 ${why.mtn}`, why.park && `公園 ${why.park}`, why.road && `道路・線路など ${why.road}`, why.owned && `筆（土地・建物） ${why.owned}`, why.out && `地図の外 ${why.out}`]
    .filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('・');
  sheet(`<h4>✈ 滑走路 <span>${esc(q.name)}</span> <small class="muted">（管理者・名義「国」）</small></h4>
    <div class="mp-kv"><b>長さ</b><span><span>${fmt(q.len)}m</span>・<span>はば60m</span></span>
      <b>空港</b><span>${q.sname ? `<span>${esc(q.sname)}</span>` : '<span class="mp-warn">2km 以内に国の空港がありません</span>'}</span>
      ${sk ? `<b>かかるもの</b><span>${sk}</span>` : ''}
      <b>工事費</b><span>${q.cost > 0 ? `<span class="mp-cost">${X(q.cost)}</span>` : 'なし（国の工事は無料）'}</span></div>
    ${q.ok ? '' : `<p class="mp-warn">${esc(q.msg || '')}</p>`}
    <div class="mp-row">${q.ok ? '<button class="btn main" data-rb>滑走路を引く</button>' : ''}</div>
    <p class="muted small"><span>空港の滑走路の長さは、いちばん長い滑走路です。長さで飛べる飛行機が決まります（コミューター機 800m・プロペラ機 1,200m・小型ジェット 1,800m・中型ワイドボディ 2,300m・ジャンボ 2,800m）。</span><span>滑走路の区画は国の土地で、道路・線路・建物は通れません。もう一度タップすると、引きなおせます</span></p>`, s => {
    const b = s.querySelector('[data-rb]'); if (b) b.onclick = async () => {
      if (!confirm(T(`滑走路 ${q.name}（${fmt(q.len)}m）を「${q.sname}」に引きます。よろしいですか？`))) return;
      const x = await api('mp_rwy_build', { p_pts: p, p_dry: false });
      if (x) {
        toast(T(`滑走路 ${x.name}（${fmt(x.len)}m）を引きました`));
        refreshBox(Math.min(p[0], p[2]) - 4, Math.min(p[1], p[3]) - 4, Math.max(p[0], p[2]) + 4, Math.max(p[1], p[3]) + 4);
        sheet(null); st.a = st.b = null; S.dirty = true;
      }
    };
  });
}
// 滑走路をタップしたか（線から はばの半分 ＋ rpx の半分）
function nearRwy(x, y, rpx) {
  const it = S.vis; if (!it || !it.rwys) return null; let best = null;
  for (const r of it.rwys.values()) {
    const [ax, ay, bx, by] = r.P, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0, d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d <= r.w / 2 + rpx / 2 / S.cam.z && (!best || d < best.d)) best = { r, d };
  }
  return best && best.r;
}
function showRwy(r) {
  S.sel = { kind: 'rwy', id: r.id }; S.dirty = true;
  const adm = S.admin && S.as === 'gov';
  sheet(`<h4>✈ 滑走路 <span>${esc(r.n)}</span></h4>
    <div class="mp-kv"><b>長さ</b><span><span>${fmt(r.len)}m</span>・<span>はば ${fmt(Math.round(r.w * 50))}m</span></span><b>空港</b><span><span>${esc(r.sn || '')}</span></span><b>持ち主</b><span>国</span></div>
    <div class="mp-row"><button class="btn" data-sl>🛫 発着口・入札</button>${adm ? '<button class="btn" data-del>こわす</button>' : ''}</div>`, sh => {
    sh.querySelector('[data-sl]').onclick = () => openSlots(r.st);
    const d = sh.querySelector('[data-del]'); if (d) d.onclick = async () => {
      if (!confirm(T('この滑走路をこわしますか？（工事費はもどりません）'))) return;
      const x = await api('mp_rwy_del', { p_id: r.id }, 'こわしました');
      if (x) { refreshBox(r.bb[0] - 3, r.bb[1] - 3, r.bb[2] + 3, r.bb[3] + 3); sheet(null); S.sel = null; }
    };
  });
}

/* ---- 土地（区画：10m四方。マスの 1/5） ---- */
const cellAt = (x, y) => [Math.floor(x * 5), Math.floor(y * 5)];
function startLand() {
  S.toolState = { a: null, b: null };
  S.drawTool = (g, z) => {
    const st = S.toolState; if (!st || !st.a) return;
    const b = st.b || st.a, x0 = Math.min(st.a[0], b[0]) / 5, y0 = Math.min(st.a[1], b[1]) / 5, x1 = (Math.max(st.a[0], b[0]) + 1) / 5, y1 = (Math.max(st.a[1], b[1]) + 1) / 5;
    g.fillStyle = 'rgba(30,110,230,.18)'; g.fillRect(sx(x0), sy(y0), (x1 - x0) * z, (y1 - y0) * z);
    g.strokeStyle = '#1f5fbf'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(sx(x0), sy(y0), (x1 - x0) * z, (y1 - y0) * z); g.setLineDash([]);
  };
  S.tapHook = (x, y) => {
    if (S.cam.z < 12) { setCam(x, y, 30); hint('区画は10m四方です。近づいてからえらびます'); return; }
    const st = S.toolState, t = cellAt(x, y);
    if (!st.a || st.b) { st.a = t; st.b = null; landSheet(); }
    else { st.b = t; landSheet(); }
    S.dirty = true;
  };
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; };
}
function landRect() {
  const st = S.toolState; if (!st || !st.a) return null;
  const b = st.b || st.a;
  return [Math.min(st.a[0], b[0]), Math.min(st.a[1], b[1]), Math.max(st.a[0], b[0]), Math.max(st.a[1], b[1])];
}
async function landSheet() {
  const r = landRect(); if (!r) return;
  const n = (r[2] - r[0] + 1) * (r[3] - r[1] + 1);
  if (S.as === 'gov' && S.admin) return airportSheet(r, n);   // 名義「国」：国の空港を建てる（t54q）
  if (n > 1600) return sheet(`<h4>${fmt(n)}区画</h4><p class="mp-warn">一度にえらべるのは1600区画（400m×400m）までです</p>`);
  sheet(`<h4>${fmt(n)}区画 えらびました</h4><p class="muted small">見つもっています…</p>`);
  const q = await api('mp_land_buy', { p_rect: r, p_as: S.as, p_dry: true });
  const r2 = landRect(); if (!q || !r2 || r2.join() !== r.join()) return;
  const why = q.why || {}, sk = [why.road && `道路 ${why.road}`, why.water && `水の上 ${why.water}`, why.park && `公園 ${why.park}`, why.owned && `持ち主がいる ${why.owned}`, why.other && `そのほか ${why.other}`].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('・');
  sheet(`<h4>${fmt(n)}区画 えらびました</h4>
    <div class="mp-kv"><b>買える</b><span><span>${fmt(q.n)}区画（${fmt(q.n * 100)}㎡）</span>・<span class="mp-cost">${X(q.total)}</span></span>
      ${q.parcels > 1 ? `<b>筆</b><span>${q.parcels}筆にわかれます（道路・町字でわける）</span>` : ''}
      ${sk ? `<b>買えない</b><span>${sk}</span>` : ''}
      <b>固定資産税</b><span>1日 約${X(q.tax_day)}</span></div>
    <div class="mp-row">${q.n ? `<button class="btn main" data-buy>${esc(asName())}の名義で買う</button>` : ''}</div>
    <p class="muted small">もう一度2か所タップすると、えらびなおせます。道路の部分は国の土地（公衆用道路）なので買えません</p>`, s => {
    const b = s.querySelector('[data-buy]'); if (b) b.onclick = async () => {
      const x = await api('mp_land_buy', { p_rect: r, p_as: S.as, p_dry: false });
      if (x) { toast(T(`${fmt(x.n)}区画（${x.parcels}筆）を買いました（${fmt(x.total)} X）`)); refreshBox(r[0] / 5 - 1, r[1] / 5 - 1, r[2] / 5 + 2, r[3] / 5 + 2); sheet(null); S.toolState.a = S.toolState.b = null; S.dirty = true; }
    };
  });
}
// 国の空港（t54q）：管理者が名義「国」で、えらんだ範囲に建てる（あいている国の土地のうち、同じ町字でつながったいちばん大きいところ）
const AIR_KINDS = [['airfield', '飛行場'], ['airport_s', '地方空港'], ['airport_m', '空港'], ['airport_l', '国際空港']];
let airKind = 'airport_s';
async function airportSheet(r, n) {
  if (n > 10000) return sheet(`<h4>${fmt(n)}区画</h4><p class="mp-warn">国の空港の範囲は10000区画（1km×1km）までです</p>`);
  sheet(`<h4>✈ 国の空港</h4><p class="muted small">見つもっています…</p>`);
  const q = await api('mp_admin_airport', { p_rect: r, p_kind: airKind, p_name: '', p_dry: true });
  const r2 = landRect(); if (!q || !r2 || r2.join() !== r.join()) return;
  const why = q.why || {}, sk = [why.road && `道路・線路など ${why.road}`, why.water && `水の上 ${why.water}`, why.mtn && `山 ${why.mtn}`, why.park && `公園 ${why.park}`, why.owned && `持ち主がいる ${why.owned}`, why.other && `そのほか ${why.other}`].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('・');
  sheet(`<h4>✈ 国の空港を建てる <small class="muted">（管理者・名義「国」）</small></h4>
    <div class="mp-seg" style="flex-wrap:wrap;margin:4px 0">${AIR_KINDS.map(([k, nm]) => `<button data-ak="${k}" class="${k === airKind ? 'on' : ''}">${esc(nm)}</button>`).join('')}</div>
    <div class="mp-kv"><b>えらんだ範囲</b><span>${fmt(n)}区画</span>
      <b>建てるところ</b><span><span>${fmt(q.n)}区画（${fmt(q.n * 100)}㎡）</span>${q.ok ? '' : ` <span class="mp-warn">${esc(q.n < q.min ? T(`${fmt(q.min)}区画以上いります`) : T(`${fmt(q.max)}区画までです`))}</span>`}</span>
      ${q.addr ? `<b>場所</b><span translate="no">${esc(q.addr)}</span>` : ''}
      ${q.parts > 1 ? `<b>町字</b><span>${q.parts}つの町字にまたがっています（いちばん大きい、つながったところに建てます）</span>` : ''}
      ${sk ? `<b>使えない</b><span>${sk}</span>` : ''}
      <b>発着口</b><span><span>${q.gates}こ</span>・<span>駐機場 ${q.hangar}機</span></span>
      <b>滑走路</b><span>建ててから「✈ 滑走路」で引きます</span>
      <b>工事費</b><span>${q.cost > 0 ? `<span class="mp-cost">${X(q.cost)}</span>` : 'なし（国の工事は無料）'}</span>
      <b>使用料</b><span>1路線・1日 ${X(q.fee)}（国庫へ）</span></div>
    <div class="mp-row"><input class="mp-inp" style="flex:1 1 160px" data-anm placeholder="${esc(q.name || '')}" maxlength="30">${q.ok ? '<button class="btn main" data-abuild>国の空港を建てる</button>' : ''}</div>
    <p class="muted small">あいている国の土地（道路・水・山・公園・持ち主のいる土地はのぞく）のうち、同じ町字でつながった いちばん大きいところに建てます。国の工事は無料です。乗り場（✈）と駐機場は国のもので、だれでも飛行機を置いて空路に使えます（使用料は国庫へ。✈ をタップして変えられます）。もう一度2か所タップすると、えらびなおせます</p>`, s => {
    s.querySelectorAll('[data-ak]').forEach(b => b.onclick = () => { airKind = b.dataset.ak; airportSheet(r, n); });
    const bb = s.querySelector('[data-abuild]'); if (bb) bb.onclick = async () => {
      const nm = s.querySelector('[data-anm]').value.trim() || q.name || '';
      if (!confirm(T(`「${nm}」（${q.kname}・${fmt(q.n)}区画）を国の空港として建てます。よろしいですか？`))) return;
      bb.disabled = true;
      const x = await api('mp_admin_airport', { p_rect: r, p_kind: airKind, p_name: nm, p_dry: false });
      bb.disabled = false;
      if (x) { toast(T(`国の空港「${x.name}」を建てました`)); refreshBox(r[0] / 5 - 2, r[1] / 5 - 2, r[2] / 5 + 3, r[3] / 5 + 3); sheet(null); S.toolState.a = S.toolState.b = null; S.dirty = true; }
    };
  });
}
const pBox = P => P.bb ? [P.bb[0] / 5 - 1, P.bb[1] / 5 - 1, P.bb[2] / 5 + 1, P.bb[3] / 5 + 1] : null;
function refreshP(P) { const b = pBox(P); if (b) refreshBox(...b); else for (const c of S.cells.values()) c.stale = true; S.dirty = true; }
async function parcelBuy(P) {
  const q = await api('mp_parcel_buy', { p_id: P.id, p_as: S.as, p_dry: true }); if (!q) return;
  if (!confirm(T(`${P.ban}（${fmt(P.n * 100)}㎡）を ${fmt(q.price)} X ＋ 取得税 ${fmt(q.tax)} X で買います。よろしいですか？`))) return;
  if (await api('mp_parcel_buy', { p_id: P.id, p_as: S.as, p_dry: false }, '買いました')) { refreshP(P); sheet(null); }
}
async function parcelSell(P) {
  let price = null;
  if (P.sale == null) { const v = prompt(T(`${P.ban}（${fmt(P.n * 100)}㎡）の値段（X）`), String(P.val || '')); if (!v) return; price = Number(String(v).replace(/[^\d]/g, '')); if (!price) return; }
  if (await api('mp_parcel_sell', { p_ids: [P.id], p_price: price, p_as: S.as }, price == null ? '売り出しをやめました' : '売りに出しました')) { refreshP(P); sheet(null); }
}
// 貸出料（1区画・1日）：決めておくと、ほかの人・会社が申請なしで線路・道路・駅・車庫に使える。空にすると貸さない
async function parcelRent(P, cx, cy) {
  const v = prompt(T(`${P.ban}の貸出料（1区画・1日・X）。ほかの人・会社が、申請なしで線路・道路・駅・車庫に使えます。空にすると貸しません（標準 ${P.std} X）`), P.rent != null ? String(P.rent) : String(P.std));
  if (v == null) return;
  const t = hw(v).replace(/[,，\s]/g, ''), n = t === '' ? null : Number(t);
  if (n != null && !(n >= 0)) return toast('数字を入れてください');
  if (await api('mp_parcel_rent', { p_ids: [P.id], p_rent: n }, n == null ? '貸すのをやめました（つくってあるものは、そのままです）' : '貸出料を決めました')) showSpot(cx, cy);
}
// 分筆：筆の中で2か所タップして四角をえらぶ
function startSplit(P) {
  setTool('look'); S.sel = { kind: 'cell', x: P.bb[0], y: P.bb[1], parcel: P.id };
  S.toolState = { a: null, b: null, split: P };
  hint('分筆：分ける部分を、2か所タップして四角くえらびます');
  S.drawTool = (g, z) => {
    const st = S.toolState; if (!st || !st.a) return;
    const b = st.b || st.a, x0 = Math.min(st.a[0], b[0]) / 5, y0 = Math.min(st.a[1], b[1]) / 5, x1 = (Math.max(st.a[0], b[0]) + 1) / 5, y1 = (Math.max(st.a[1], b[1]) + 1) / 5;
    g.fillStyle = 'rgba(255,152,0,.25)'; g.fillRect(sx(x0), sy(y0), (x1 - x0) * z, (y1 - y0) * z);
    g.strokeStyle = '#e67e00'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(sx(x0), sy(y0), (x1 - x0) * z, (y1 - y0) * z); g.setLineDash([]);
  };
  S.tapHook = async (x, y) => {
    const st = S.toolState, t = cellAt(x, y);
    if (!st.a || st.b) { st.a = t; st.b = null; } else st.b = t;
    S.dirty = true;
    const r = landRect(); if (!r) return;
    const q = await api('mp_parcel_split', { p_id: P.id, p_rect: r, p_as: S.as, p_dry: true });
    if (!q) return;
    sheet(`<h4>分筆：${esc(P.ban)}</h4><div class="mp-kv"><b>分ける部分</b><span>${fmt(q.n * 100)}㎡ → ${esc(q.ban)}</span><b>のこる部分</b><span>${fmt(q.rest * 100)}㎡</span></div>
      <div class="mp-row"><button class="btn main" data-ok>分筆する</button></div>`, s => {
      s.querySelector('[data-ok]').onclick = async () => { if (await api('mp_parcel_split', { p_id: P.id, p_rect: r, p_as: S.as, p_dry: false }, '分筆しました')) { refreshP(P); setTool('look'); } };
    });
  };
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; };
  sheet(`<h4>分筆：${esc(P.ban)}</h4><p class="small">分ける部分を、地図で2か所タップしてえらんでください</p>`);
  S.onSheetClose = () => setTool('look');
  S.dirty = true;
}
// 合筆：となりあう自分の筆をタップしてえらぶ
function startMerge(P) {
  setTool('look');
  const marks = new Map([[P.id, P]]);
  S.toolState = { marks };
  hint('合筆：となりの自分の筆をタップしてえらびます（同じ町字・建物なし）');
  const draw = () => sheet(`<h4>合筆</h4><p class="small">${[...marks.values()].map(p => esc(p.ban)).join('・')}（<span>${marks.size}筆</span>）</p>
    <div class="mp-row"><button class="btn main" data-ok ${marks.size >= 2 ? '' : 'disabled'}>合筆する</button></div>`, s => {
    s.querySelector('[data-ok]').onclick = async () => {
      const r = await api('mp_parcel_merge', { p_ids: [...marks.keys()], p_as: S.as, p_dry: false });
      if (r) { toast(T(`合筆しました（${r.ban}・${fmt(r.n * 100)}㎡）`)); for (const p of marks.values()) refreshP(p); setTool('look'); }
    };
  });
  S.tapHook = (x, y) => {
    const [cx, cy] = cellAt(x, y), key = cx + ',' + cy;
    const p = [...(S.vis ? S.vis.parcels.values() : [])].find(q => q.cells.has(key));
    if (!p || p.own !== 2) return toast('自分の筆をタップしてください');
    if (marks.has(p.id) && marks.size > 1) marks.delete(p.id); else marks.set(p.id, p);
    S.dirty = true; draw();
  };
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; };
  S.onSheetClose = () => setTool('look');
  draw(); S.dirty = true;
}

/* ---- 線をひく（線路・道路）：点をおくと、なめらかな曲線（セントリペタル・キャットムル–ロム）になる ---- */
// 点の列 → なめらかな線（0.5マスごとの点）。phA・phB は、はしの向きを決める見えない点
function spline(ctrl, phA, phB) {
  const n = ctrl.length; if (n < 2) return ctrl.slice();
  const Q = [phA || [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]], ...ctrl, phB || [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]]];
  const dense = [ctrl[0]];
  const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    const steps = Math.max(6, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 4));
    for (let k = 1; k <= steps; k++) {
      const t = t1 + (t2 - t1) * k / steps;
      const L = (a, b, ta, tb) => [(tb - t) / (tb - ta) * a[0] + (t - ta) / (tb - ta) * b[0], (tb - t) / (tb - ta) * a[1] + (t - ta) / (tb - ta) * b[1]];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      dense.push(L(B1, B2, t1, t2));
    }
  }
  return resample(dense, 0.5);
}
function resample(P, step) {
  if (P.length < 2) return P.slice();
  const out = [P[0]]; let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let ax = P[i - 1][0], ay = P[i - 1][1]; const bx = P[i][0], by = P[i][1];
    let seg = Math.hypot(bx - ax, by - ay);
    while (acc + seg >= step) { const t = (step - acc) / seg; ax += (bx - ax) * t; ay += (by - ay) * t; out.push([ax, ay]); seg = Math.hypot(bx - ax, by - ay); acc = 0; }
    acc += seg;
  }
  const l = P[P.length - 1], o = out[out.length - 1];
  if (Math.hypot(l[0] - o[0], l[1] - o[1]) > step * 0.3) out.push(l); else out[out.length - 1] = l;
  return out;
}
function minRadius(P) {
  let mr = 1e9; const g = 3;
  for (let i = g; i < P.length - g; i++) {
    const a = P[i - g], b = P[i], c = P[i + g];
    const A = Math.hypot(b[0] - c[0], b[1] - c[1]), B = Math.hypot(a[0] - c[0], a[1] - c[1]), C = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    if (ar > 1e-6) mr = Math.min(mr, A * B * C / (4 * ar));
  }
  return mr;
}
const toInts = P => P.flatMap(p => [Math.round(p[0] * 100), Math.round(p[1] * 100)]);

/* ---- 直線＋カーブ（A列車ふう）：点は角。角に半径 R の円弧を入れる。はしをつないだときは、その向きから円弧で出る・入る ---- */
const V2 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1]], add: (a, b) => [a[0] + b[0], a[1] + b[1]], mul: (a, k) => [a[0] * k, a[1] * k], len: a => Math.hypot(a[0], a[1]),
             nrm: a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; }, cross: (a, b) => a[0] * b[1] - a[1] * b[0], dot: (a, b) => a[0] * b[0] + a[1] * b[1],
             rot90: a => [-a[1], a[0]], rotm90: a => [a[1], -a[0]] };
// 円弧の点（中心 c・半径 r・はじめの角度 a0 から da（左回り +）だけ）
function arcPts(c, r, a0, da) {
  const n = Math.max(2, Math.ceil(Math.abs(da) * r / 0.08)), out = [];
  for (let k = 1; k <= n; k++) { const a = a0 + da * k / n; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return out;
}
const angOf = v => Math.atan2(v[1], v[0]);
const norm2pi = a => { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; };
// 向き h（単位）で p を出て、円弧（半径 r）で曲がってから、まっすぐ q へ。q が近すぎるときは半径を小さくする
function arcToPoint(p, h, q, r) {
  const d = V2.sub(q, p), cr = V2.cross(h, d), D = V2.len(d);
  if (D < 1e-6) return { pts: [], exit: h, r: 1e9 };
  if (Math.abs(cr) < 1e-6 * D) { if (V2.dot(h, d) > 0) return { pts: [q], exit: h, r: 1e9 }; return null; }
  const left = cr > 0, rmax = D * D / (2 * Math.abs(cr));
  const rr = Math.min(r, rmax * 0.97);
  const nrm = left ? V2.rot90(h) : V2.rotm90(h), c = V2.add(p, V2.mul(nrm, rr));
  const w = V2.sub(q, c), W = V2.len(w); if (W <= rr) return null;
  const lam = Math.sqrt(W * W - rr * rr), ua = angOf(w) + (left ? 1 : -1) * Math.atan2(rr, lam), u = [Math.cos(ua), Math.sin(ua)];
  const t = V2.add(c, V2.mul(left ? V2.rotm90(u) : V2.rot90(u), rr));
  const a0 = angOf(V2.sub(p, c)), a1 = angOf(V2.sub(t, c));
  const da = left ? norm2pi(a1 - a0) : -norm2pi(a0 - a1);
  return { pts: [...arcPts(c, rr, a0, da), q], exit: u, r: rr, t };
}
// 両はしの向きが決まっているとき（点が2つ）：円弧＋直線＋円弧（いちばん短いもの）
function dubins(p0, h0, p1, h1, r) {
  let best = null;
  for (const [s0, s1] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {   // 1 左回り・-1 右回り
    const c0 = V2.add(p0, V2.mul(s0 > 0 ? V2.rot90(h0) : V2.rotm90(h0), r)), c1 = V2.add(p1, V2.mul(s1 > 0 ? V2.rot90(h1) : V2.rotm90(h1), r));
    const d = V2.sub(c1, c0), D = V2.len(d); let u, lam;
    if (s0 === s1) { if (D < 1e-6) continue; u = V2.nrm(d); lam = D; }
    else { if (D < 2 * r) continue; lam = Math.sqrt(D * D - 4 * r * r); const ua = angOf(d) + (s0 > 0 ? 1 : -1) * Math.atan2(2 * r, lam); u = [Math.cos(ua), Math.sin(ua)]; }
    const q0 = V2.add(c0, V2.mul(s0 > 0 ? V2.rotm90(u) : V2.rot90(u), r)), q1 = V2.add(c1, V2.mul(s1 > 0 ? V2.rotm90(u) : V2.rot90(u), r));
    const a00 = angOf(V2.sub(p0, c0)), a01 = angOf(V2.sub(q0, c0)), a10 = angOf(V2.sub(q1, c1)), a11 = angOf(V2.sub(p1, c1));
    const da0 = s0 > 0 ? norm2pi(a01 - a00) : -norm2pi(a00 - a01), da1 = s1 > 0 ? norm2pi(a11 - a10) : -norm2pi(a10 - a11);
    const L = r * (Math.abs(da0) + Math.abs(da1)) + lam;
    if (!best || L < best.L) best = { L, pts: [...arcPts(c0, r, a00, da0), q1, ...arcPts(c1, r, a10, da1)] };
  }
  return best ? best.pts : null;
}
// 点の列 → 直線と円弧の線（0.5マスごと）。h0：はじめの向き、h1：おわりの向き（どちらもなくてよい）。r：半径（マス）
function arcGeom(ctrl, h0, h1, r) {
  const n = ctrl.length; if (n < 2) return { pts: ctrl.slice(), ok: true };
  if (n === 2 && h0 && h1) { const d = dubins(ctrl[0], h0, ctrl[1], h1, r); return d ? { pts: resample([ctrl[0], ...d], 0.5), ok: true } : { pts: [ctrl[0], ctrl[1]], ok: false }; }
  let head = [ctrl[0]], Q0 = ctrl[0];
  if (h0) { const a = arcToPoint(ctrl[0], h0, n > 2 || !h1 ? ctrl[1] : ctrl[1], r); if (!a) return { pts: [ctrl[0], ctrl[1]], ok: false }; head = [ctrl[0], ...a.pts.slice(0, -1)]; Q0 = a.t || ctrl[0]; }
  let tail = [ctrl[n - 1]], Qn = ctrl[n - 1];
  if (h1 && n > 2) {
    const b = arcToPoint(ctrl[n - 1], V2.mul(h1, -1), ctrl[n - 2], r); if (!b) return { pts: [ctrl[0], ctrl[n - 1]], ok: false };
    tail = [...b.pts.slice(0, -1)].reverse().concat([ctrl[n - 1]]); Qn = b.t || ctrl[n - 1];
  } else if (h1 && n === 2) {
    const b = arcToPoint(ctrl[1], V2.mul(h1, -1), ctrl[0], r); if (!b) return { pts: [ctrl[0], ctrl[1]], ok: false };
    return { pts: resample([ctrl[0], ...b.pts.slice(0, -1).reverse(), ctrl[1]], 0.5), ok: true };
  }
  const Q = [Q0, ...ctrl.slice(1, n - 1), Qn];
  const out = [...head];
  let cur = Q0;
  for (let i = 1; i < Q.length - 1; i++) {
    const P = Q[i], u = V2.nrm(V2.sub(P, Q[i - 1])), v = V2.nrm(V2.sub(Q[i + 1], P));
    const th = Math.acos(clamp(V2.dot(u, v), -1, 1));
    if (th < 1e-4) continue;
    const availIn = i === 1 ? V2.len(V2.sub(P, Q[0])) : V2.len(V2.sub(P, Q[i - 1])) / 2;
    const availOut = i === Q.length - 2 ? V2.len(V2.sub(Q[i + 1], P)) : V2.len(V2.sub(Q[i + 1], P)) / 2;
    const tt = Math.tan(th / 2), ri = Math.min(r, Math.min(availIn, availOut) / tt), T = ri * tt;
    const S1 = V2.sub(P, V2.mul(u, T)), E1 = V2.add(P, V2.mul(v, T)), left = V2.cross(u, v) > 0;
    const c = V2.add(S1, V2.mul(left ? V2.rot90(u) : V2.rotm90(u), ri));
    const a0 = angOf(V2.sub(S1, c)), a1 = angOf(V2.sub(E1, c)), da = left ? norm2pi(a1 - a0) : -norm2pi(a0 - a1);
    out.push(S1, ...arcPts(c, ri, a0, da)); cur = E1;
  }
  out.push(...tail);
  return { pts: resample(out, 0.5), ok: true };
}
// はしをつなぐ先をさがす（線路は自分の線路、道路はどの道路でも）
function findAttach(kind, x, y) {
  const links = kind === 'rail' ? thruLinks() : null;   // 乗り入れの許可がある持ち主の線路にもつなげる
  const pred = s => kind === 'rail' ? (s.k === 'rail' && (s.mine || links.has(s.o))) : (s.k === 'road' && s.c !== 'exp');
  const it = S.vis; if (!it) return null;
  // 線のはし（点）
  let best = null;
  for (const s of it.segs.values()) {
    if (!pred(s)) continue;
    for (const end of [0, 1]) {
      const i = end ? s.np - 1 : 0, px = s.P[2 * i], py = s.P[2 * i + 1], d = Math.hypot(px - x, py - y) * S.cam.z;
      if (d < 16 && (!best || d < best.d)) {
        const j = end ? s.np - 4 : 3, jj = clamp(j, 0, s.np - 1);
        let dx = s.P[2 * jj] - px, dy = s.P[2 * jj + 1] - py; const L = Math.hypot(dx, dy) || 1;   // 線の中へ入る向き
        best = { d, x: px, y: py, att: { node: end ? s.n1 : s.n0 }, din: [dx / L, dy / L], seg: s };
      }
    }
  }
  if (best) return best;
  const h = nearSeg(x, y, 12, pred);
  if (h) return { d: h.d, x: h.x, y: h.y, att: { seg: h.s.id }, tan: [Math.cos(h.ang), Math.sin(h.ang)], seg: h.s };
  return null;
}
function startDraw(kind) {
  const admin = S.as === 'gov';
  if (kind === 'rail') loadThru();
  let mode = kind === 'rail' ? 'arc' : 'free', rad = kind === 'rail' ? 400 : 50;
  try { mode = localStorage.getItem('mp_dm_' + kind) || mode; rad = Number(localStorage.getItem('mp_dr_' + kind)) || rad; } catch (e) {}
  const st = S.toolState = { kind, mode, rad, ctrl: [], A: null, B: null, curve: [], quote: null, err: null, opts: { dbl: false, elec: false, lanes: admin ? 2 : 1, cls: admin ? 'nat' : 'priv', name: '' }, qt: 0 };
  S.tapHook = (x, y) => {
    const a = findAttach(kind, x, y);
    if (!st.ctrl.length) { st.ctrl.push(a ? [a.x, a.y] : [x, y]); st.A = a; }
    else {
      if (st.B) st.B = null;   // つないでいたはしは、まん中の点に
      st.ctrl.push(a ? [a.x, a.y] : [x, y]); st.B = a;
    }
    drawUpdate();
  };
  S.grab = (px, py) => {
    const i = st.ctrl.findIndex(p => Math.hypot(sx(p[0]) - px, sy(p[1]) - py) < 18);
    if (i < 0) return false; st.drag = i; return true;
  };
  S.grabMove = (x, y) => {
    const i = st.drag; if (i == null) return;
    if (i === 0 || i === st.ctrl.length - 1) {
      const a = findAttach(kind, x, y);
      st.ctrl[i] = a ? [a.x, a.y] : [x, y];
      if (i === 0) st.A = a; else st.B = a;
    } else st.ctrl[i] = [x, y];
    drawUpdate(true);
  };
  S.grabEnd = () => { st.drag = null; drawUpdate(); };
  S.onLong = (x, y, px, py) => {   // 長押しで点を消す
    const i = st.ctrl.findIndex(p => Math.hypot(sx(p[0]) - px, sy(p[1]) - py) < 18);
    if (i >= 0) { st.ctrl.splice(i, 1); if (i === 0) st.A = null; if (i === st.ctrl.length) st.B = null; drawUpdate(); }
  };
  S.drawTool = (g, z) => drawPreview(g, z, st);
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; };
  drawSheet();
}
// 見えない点（はしの向き）。線路は、つないだ線と同じ向きでなめらかにつながるように（道路は自由な角度でつながる）
function phantoms(st) {
  const c = st.ctrl, n = c.length; if (n < 2 || (st.kind === 'road' && !st.edit)) return [null, null];
  const L0 = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), L1 = Math.hypot(c[n - 1][0] - c[n - 2][0], c[n - 1][1] - c[n - 2][1]);
  const dot = (t, a, b) => t[0] * (b[0] - a[0]) + t[1] * (b[1] - a[1]);
  let A = null, B = null;
  if (st.A) {   // 出ていく向き：線のはしなら、その線の続き。線のまん中なら、線にそって次の点のほう
    let t = st.A.din ? [-st.A.din[0], -st.A.din[1]] : st.A.tan.slice();
    if (!st.A.din && dot(t, c[0], c[1]) < 0) t = [-t[0], -t[1]];
    A = [c[1][0] - 2 * t[0] * L0, c[1][1] - 2 * t[1] * L0];
  }
  if (st.B) {   // 着く向き：線のはしなら、その線の中へ入る向き。線のまん中なら、線にそって
    let t = st.B.din ? st.B.din.slice() : st.B.tan.slice();
    if (!st.B.din && dot(t, c[n - 2], c[n - 1]) < 0) t = [-t[0], -t[1]];
    B = [c[n - 2][0] + 2 * t[0] * L1, c[n - 2][1] + 2 * t[1] * L1];
  }
  return [A, B];
}
// はしの向き（直線＋カーブ）：はじめは出ていく向き、おわりは着く向き
function endHeads(st) {
  const c = st.ctrl, n = c.length; let h0 = null, h1 = null;
  if (st.A) { let t = st.A.din ? [-st.A.din[0], -st.A.din[1]] : st.A.tan.slice(); if (!st.A.din && V2.dot(t, V2.sub(c[1], c[0])) < 0) t = [-t[0], -t[1]]; h0 = V2.nrm(t); }
  if (st.B) { let t = st.B.din ? st.B.din.slice() : st.B.tan.slice(); if (!st.B.din && V2.dot(t, V2.sub(c[n - 1], c[n - 2])) < 0) t = [-t[0], -t[1]]; h1 = V2.nrm(t); }
  return [h0, h1];
}
function drawUpdate(fast) {
  const st = S.toolState; if (!st) return;
  if (st.mode === 'arc' && st.ctrl.length >= 2) {
    const [h0, h1] = endHeads(st), g = arcGeom(st.ctrl, h0, h1, st.rad / 50);
    st.curve = g.pts; st.geoBad = !g.ok;
  } else {
    const [A, B] = phantoms(st);
    st.curve = st.ctrl.length >= 2 ? spline(st.ctrl, A, B) : []; st.geoBad = false;
  }
  st.rmin = st.curve.length > 6 ? minRadius(st.curve) : 1e9;
  // 形が変わったら、見つもりはやりなおし（「見つもる」を押す）。送っている見つもりの答えはすてる
  st.quote = null; st.err = null; st.qseq = (st.qseq || 0) + 1; st.quoting = false;
  S.dirty = true;
  drawSheet();
}
// 見つもり（「見つもる」を押したとき）
async function quoteDraw(st) {
  if (S.toolState !== st || st.curve.length < 3 || st.quoting) return;
  const my = st.qseq = (st.qseq || 0) + 1;
  st.quoting = true; drawSheet();
  let q = null, err = null;
  try { q = await call(st.edit ? 'mp_seg_edit' : 'mp_seg_build', drawArgs(st, true)); } catch (e) { err = e.message; }
  if (st.qseq !== my) return;
  st.quoting = false; st.quote = q; st.err = err;
  if (S.toolState === st) drawSheet();
}
function drawArgs(st, dry) {
  if (st.edit) return { p_id: st.edit.id, p_ctl: toInts(st.ctrl), p_pts: toInts(st.curve), p_dry: dry };
  const o = st.opts;
  return { p_kind: st.kind, p_cls: st.kind === 'road' ? o.cls : null, p_ctl: st.mode === 'arc' ? null : toInts(st.ctrl), p_pts: toInts(st.curve),
    p_opts: { dbl: o.dbl, elec: o.elec, name: o.name, lanes: o.lanes }, p_as: S.as, p_from: st.A ? st.A.att : null, p_to: st.B ? st.B.att : null, p_dry: dry };
}
function drawSheet() {
  const st = S.toolState; if (!st) return;
  const o = st.opts, rail = st.kind === 'rail', gov = S.as === 'gov', lenM = st.curve.length > 1 ? Math.round((st.curve.length - 1) * 0.5 * 50) : 0;
  const rminM = Math.round(st.rmin * 50), tight = rail ? st.rmin < 3 : st.rmin < 0.7;
  const q = st.quote;
  sheet(`<h4>${st.edit ? (rail ? '線路の形を直す' : '道路の形を直す') : rail ? '線路をひく' : '道路をひく'}</h4>
    <p class="small" style="margin:0 0 4px"><span>点 ${st.ctrl.length}・長さ 約${fmt(lenM)} m</span>${st.curve.length > 6 ? `<span>・いちばんきついカーブ 半径 ${rminM >= 50000 ? '—' : fmt(rminM) + ' m'}</span>` : ''}${st.A ? '<span>・はじめ：つなぐ</span>' : ''}${st.B ? '<span>・おわり：つなぐ</span>' : ''}</p>
    ${st.edit ? '' : `<div class="mp-row"><span class="mp-seg"><button data-m="arc" class="${st.mode === 'arc' ? 'on' : ''}">直線＋カーブ</button><button data-m="free" class="${st.mode !== 'arc' ? 'on' : ''}">なめらか</button></span>
      ${st.mode === 'arc' ? `<span>カーブの半径</span> <select class="mp-inp" data-rad style="width:auto">${(rail ? [160, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000] : [15, 20, 30, 50, 80, 100, 150, 200, 300, 500]).map(m => `<option value="${m}" ${st.rad === m ? 'selected' : ''}>${fmt(m)} m</option>`).join('')}</select>` : ''}</div>`}
    ${st.geoBad ? `<p class="mp-warn">この点では、えらんだ半径のカーブでつながりません（点を動かすか、半径を小さく）</p>` : ''}
    ${tight ? `<p class="mp-warn">${rail ? 'カーブがきつすぎます（線路は半径150m以上）' : 'カーブがきつすぎます'}</p>` : ''}
    ${st.edit ? '' : rail ? `<div class="mp-row"><span class="mp-seg"><button data-d="0" class="${!o.dbl ? 'on' : ''}">単線</button><button data-d="1" class="${o.dbl ? 'on' : ''}">複線</button></span>
        <span class="mp-seg"><button data-e="0" class="${!o.elec ? 'on' : ''}">非電化</button><button data-e="1" class="${o.elec ? 'on' : ''}">電化</button></span></div>`
      : `<div class="mp-row">${gov ? `<select class="mp-inp" style="width:auto" data-cls>${[['exp', '高速道路'], ['nat', '国道'], ['pref', '府県道'], ['city', '市道'], ['lane', '細い道']].map(c => `<option value="${c[0]}" ${o.cls === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select>` : ''}
        片側 <span class="mp-seg">${(gov ? [0, 1, 2, 3] : [0, 1, 2]).map(n => `<button data-l="${n}" class="${o.lanes === n ? 'on' : ''}">${n ? n + '車線' : '細い道'}</button>`).join('')}</span></div>`}
    ${st.edit ? '' : `<div class="mp-row"><input class="mp-inp" data-nm placeholder="${rail ? '路線名（なくてもよい）' : '道路の名前（なくてもよい）'}" value="${esc(o.name)}"></div>`}
    <div class="mp-row">${q ? `${q.cost > 0 || S.as !== 'gov' ? `<span class="mp-cost">工事費 ${X(q.cost)}</span>` : '<span>工事費なし（国の工事は無料）</span>'}<span class="small"><span>使用料 1日 ${X(q.lease || 0)}</span>${q.tunnel ? `<span>・トンネル ${q.tunnel}マス</span>` : ''}${q.bridge ? `<span>・橋 ${q.bridge}マス</span>` : ''}${q.vtop != null && q.vtop !== q.vlim ? `<span>・制限速度 ${q.vlim}〜${q.vtop} km/h</span>` : `<span>・制限速度 ${q.vlim} km/h</span>`}</span>`
      : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>'
      : st.curve.length > 2 ? `<button class="btn" data-est ${tight || st.geoBad ? 'disabled' : ''}>見つもる</button><span class="muted small">${gov ? '国の工事は無料です（見つもらずに、つくれます）' : '工事費を出してから、つくれます'}</span>` : st.mode === 'arc' ? '<span class="muted small">地図をタップして角の点をおいてください（2つ以上）。角には、えらんだ半径のカーブが入ります。線路のはしから始めると延長、まん中から始めると分岐です</span>' : '<span class="muted small">地図をタップして点をおいてください（2つ以上）。はしを線の近くにおくと、つながります</span>'}</div>
    ${q ? needH(q.need) : ''}
    <div class="mp-row"><button class="btn" data-undo ${st.ctrl.length ? '' : 'disabled'}>1つもどす</button><button class="btn" data-cancel>キャンセル</button>
      <button class="btn main" data-ok ${(q || (gov && st.curve.length > 2)) && !tight && !st.geoBad && !(q && hasNeed(q)) ? '' : 'disabled'}>${st.edit ? 'この形にする' : `つくる（${esc(asName())}）`}</button></div>
    <p class="muted small" style="margin:6px 0 0">点はドラッグで動かせます。長押しで消せます</p>`, s => {
    s.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { st.mode = b.dataset.m; try { localStorage.setItem('mp_dm_' + st.kind, st.mode); } catch (e) {} drawUpdate(); });
    { const rd = s.querySelector('[data-rad]'); if (rd) rd.onchange = () => { st.rad = Number(rd.value); try { localStorage.setItem('mp_dr_' + st.kind, String(st.rad)); } catch (e) {} drawUpdate(); }; }
    s.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { o.dbl = b.dataset.d === '1'; drawUpdate(); });
    s.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { o.elec = b.dataset.e === '1'; drawUpdate(); });
    s.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { o.lanes = Number(b.dataset.l); drawUpdate(); });
    const cl = s.querySelector('[data-cls]'); if (cl) cl.onchange = () => { o.cls = cl.value; drawUpdate(); };
    const nm = s.querySelector('[data-nm]'); if (nm) nm.onchange = () => { o.name = nm.value; };
    s.querySelector('[data-undo]').onclick = () => { if (st.edit && st.ctrl.length <= 2) return; st.ctrl.pop(); if (!st.edit) st.B = null; if (!st.ctrl.length) st.A = null; drawUpdate(); };
    s.querySelector('[data-cancel]').onclick = () => setTool(st.edit ? 'look' : st.kind);
    { const es = s.querySelector('[data-est]'); if (es) es.onclick = () => quoteDraw(st); }
    needBind(s, q && q.need, () => quoteDraw(st));
    s.querySelector('[data-ok]').onclick = async () => {
      if (nm) o.name = nm.value;
      const r = await api(st.edit ? 'mp_seg_edit' : 'mp_seg_build', drawArgs(st, false));
      if (!r) return;
      toast(r.cost > 0 ? `${st.edit ? '直しました' : 'つくりました'}（${fmt(r.cost)} X）` : (st.edit ? '直しました' : 'つくりました'));
      const xs = st.curve.map(p => p[0]), ys = st.curve.map(p => p[1]);
      refreshBox(Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2);
      if (st.edit) refreshBox(...st.edit.bb);
      setTool(st.edit ? 'look' : st.kind);
    };
  });
  S.onSheetClose = () => setTool('look');
}
function drawPreview(g, z, st) {
  if (st.curve.length > 1) {
    const rail = st.kind === 'rail';
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = st.err ? 'rgba(220,40,40,.85)' : rail ? 'rgba(30,30,30,.85)' : 'rgba(250,250,250,.95)';
    g.lineWidth = Math.max(3, (rail ? 0.34 : 0.18 + 0.13 * st.opts.lanes) * z);
    g.beginPath(); st.curve.forEach((p, i) => i ? g.lineTo(sx(p[0]), sy(p[1])) : g.moveTo(sx(p[0]), sy(p[1]))); g.stroke();
    g.strokeStyle = '#1f5fbf'; g.lineWidth = 2; g.setLineDash([6, 5]); g.stroke(); g.setLineDash([]);
  }
  // 点と、それをつなぐ細い線
  g.strokeStyle = 'rgba(31,95,191,.5)'; g.lineWidth = 1; g.beginPath(); st.ctrl.forEach((p, i) => i ? g.lineTo(sx(p[0]), sy(p[1])) : g.moveTo(sx(p[0]), sy(p[1]))); g.stroke();
  st.ctrl.forEach((p, i) => {
    const end = i === 0 || i === st.ctrl.length - 1, att = (i === 0 && st.A) || (i === st.ctrl.length - 1 && i > 0 && st.B), fixed = st.edit && end;
    g.fillStyle = fixed ? '#888' : att ? '#1fa35a' : '#1f5fbf'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(sx(p[0]), sy(p[1]), end ? 8 : 6.5, 0, 6.3); g.fill(); g.stroke();
  });
}
// 形を直す：点（ctl があればそれ、なければ線から6マスごと）を動かす。はしは動かせない
function startEdit(s) {
  setTool('look');
  let ctrl;
  if (s.ctl && s.ctl.length >= 4) { ctrl = []; for (let i = 0; i < s.ctl.length; i += 2) ctrl.push([s.ctl[i] / 100, s.ctl[i + 1] / 100]); ctrl[0] = [s.P[0], s.P[1]]; ctrl[ctrl.length - 1] = [s.P[2 * s.np - 2], s.P[2 * s.np - 1]]; }
  else { ctrl = []; const step = 12; for (let i = 0; i < s.np; i += step) ctrl.push([s.P[2 * i], s.P[2 * i + 1]]); const l = [s.P[2 * s.np - 2], s.P[2 * s.np - 1]]; if (ctrl.length < 2 || Math.hypot(ctrl[ctrl.length - 1][0] - l[0], ctrl[ctrl.length - 1][1] - l[1]) > 0.2) ctrl.push(l); }
  // はしの向き：もとの線の向きのまま
  const d0 = [s.P[2] - s.P[0], s.P[3] - s.P[1]], L0 = Math.hypot(...d0) || 1, n = s.np, d1 = [s.P[2 * n - 2] - s.P[2 * n - 4], s.P[2 * n - 1] - s.P[2 * n - 3]], L1 = Math.hypot(...d1) || 1;
  const st = S.toolState = { kind: s.k, edit: s, ctrl, A: { tan: [d0[0] / L0, d0[1] / L0] }, B: { tan: [d1[0] / L1, d1[1] / L1] }, curve: [], quote: null, err: null, opts: { lanes: s.l || 1 }, qt: 0 };
  S.tapHook = (x, y) => {   // 線の近くをタップ：点をふやす（いちばん近い、点と点のあいだに）
    let bi = 1, bd = Infinity;
    for (let i = 0; i + 1 < st.ctrl.length; i++) { const a = st.ctrl[i], b = st.ctrl[i + 1], d = Math.hypot((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y); if (d < bd) { bd = d; bi = i + 1; } }
    st.ctrl.splice(bi, 0, [x, y]); drawUpdate();
  };
  S.grab = (px, py) => { const i = st.ctrl.findIndex((p, k) => k > 0 && k < st.ctrl.length - 1 && Math.hypot(sx(p[0]) - px, sy(p[1]) - py) < 18); if (i < 0) return false; st.drag = i; return true; };
  S.grabMove = (x, y) => { if (st.drag != null) { st.ctrl[st.drag] = [x, y]; drawUpdate(true); } };
  S.grabEnd = () => { st.drag = null; drawUpdate(); };
  S.onLong = (x, y, px, py) => { const i = st.ctrl.findIndex((p, k) => k > 0 && k < st.ctrl.length - 1 && Math.hypot(sx(p[0]) - px, sy(p[1]) - py) < 18); if (i > 0) { st.ctrl.splice(i, 1); drawUpdate(); } };
  S.drawTool = (g, z) => drawPreview(g, z, st);
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; };
  hint('点をドラッグで動かす・線の近くをタップで点をふやす・長押しで消す');
  drawUpdate();
}

/* ---- 駅・バス停 ---- */
// 駅・バス停のはじめの名前：近くの町・大字の名前（「町」はとる）
function nearDist(x, y) {
  let best = null, bd = Infinity;
  for (const c of (S.vis ? S.vis.chos.values() : [])) { if (c[1] !== 'cho' && c[1] !== 'oaza') continue; const d = (c[3] + 0.5 - x) ** 2 + (c[4] + 0.5 - y) ** 2; if (d < bd) { bd = d; best = c; } }
  if (!best) return '';
  const n = String(best[2] || '');
  return n.length > 1 && n.endsWith('町') ? n.slice(0, -1) : n;
}
// 線の上の、はじめからの長さ at（マス）のところ
function segPointAt(s, at) {
  const P = s.P; let acc = 0;
  for (let i = 0; i + 1 < s.np; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], L = Math.hypot(bx - ax, by - ay);
    if (acc + L >= at || i + 2 === s.np) { const t = L ? clamp((at - acc) / L, 0, 1) : 0; return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ang: Math.atan2(by - ay, bx - ax) }; }
    acc += L;
  }
  return { x: P[0], y: P[1], ang: 0 };
}
// 線の a0〜a1 の部分（画面の座標で）
function pathPart(g, s, a0, a1) {
  const P = s.P; let acc = 0, started = false;
  g.beginPath();
  for (let i = 0; i + 1 < s.np; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], L = Math.hypot(bx - ax, by - ay);
    const t0 = L ? (a0 - acc) / L : 0, t1 = L ? (a1 - acc) / L : 0;
    if (t1 >= 0 && t0 <= 1) {
      const u0 = clamp(t0, 0, 1), u1 = clamp(t1, 0, 1);
      if (!started) { g.moveTo(sx(ax + (bx - ax) * u0), sy(ay + (by - ay) * u0)); started = true; }
      g.lineTo(sx(ax + (bx - ax) * u1), sy(ay + (by - ay) * u1));
    }
    acc += L;
  }
}
// 起点と終点が、つなぎ目（分かれ道のない点）をはさんだ別々の線のとき：サーバーで1本にして、その線の上の位置にする
//   近くないとき（えらびなおし）は 'far'、つなげないときは 'ng'（理由はサーバーのことばで出す）
async function joinHits(a, b, maxTiles) {
  if (a.s.id === b.s.id) return [a, b];
  if (Math.hypot(a.x - b.x, a.y - b.y) > maxTiles) return 'far';
  hint('線路をつないでいます…');
  const r = await api('mp_seg_join', { p_a: a.s.id, p_b: b.s.id });
  if (!r) return 'ng';
  const s = prepSeg(r);
  refreshBox(s.bb[0] - 2, s.bb[1] - 2, s.bb[2] + 2, s.bb[3] + 2);
  return [projSeg(s, a.x, a.y), projSeg(s, b.x, b.y)];
}
// 駅：ホームの起点と終点をタップ（同じ線路の上。つなぎ目をはさむときは1本にする）。長さは20m単位。バス停は1か所
async function staTap(x, y) {
  const st = S.toolState || (S.toolState = {});
  if (st.busy) return;
  const hr = nearSeg(x, y, 14, s => s.k === 'rail' && s.mine);
  if (hr) {
    let why = null;
    if (st.a && !st.done && st.a.s.id !== hr.s.id) {
      st.busy = true; const j = await joinHits(st.a, hr, 8.6); st.busy = false;
      if (S.toolState !== st || S.tool !== 'sta') return;
      if (Array.isArray(j)) { st.a = j[0]; st.b = j[1]; st.done = true; hint(''); return staSheet('rail', j[0], j[1]); }
      why = j;
    }
    if (!st.a || st.a.s.id !== hr.s.id || st.done) {
      if (why === 'far') toast(T('同じ線路の上で終点をタップしてください（起点をえらびなおしました）'));
      S.toolState = { a: hr }; sheet(null);
      hint('駅：ホームの終点をタップしてください（同じ線路の上・20m単位）');
      S.drawTool = (g, z) => { const t = S.toolState; if (!t || !t.a) return; const p = segPointAt(t.a.s, t.a.at); g.fillStyle = '#1f5fbf'; g.beginPath(); g.arc(sx(p.x), sy(p.y), 6, 0, 6.3); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); };
      S.dirty = true; return;
    }
    st.b = hr; st.done = true; hint('');
    return staSheet('rail', st.a, st.b);
  }
  const hb = nearSeg(x, y, 12, s => s.k === 'road' && s.c !== 'exp');
  if (hb) return staSheet('bus', hb);
  toast('自分の線路か、道路の上をタップしてください');
}
function staSheet(kind, hit, hit2) {
  const segLenMax = kind === 'rail' ? hit.s.len / 50 : 0;
  // 起点と終点のまん中・長さ（20m単位）
  const span = kind === 'rail' ? Math.abs(hit2.at - hit.at) : 0;
  const st = { plat: kind === 'rail' ? clamp(Math.round(span * 50 / 20) * 20, 20, 400) : 0, mid: kind === 'rail' ? (hit.at + hit2.at) / 2 : hit.at,
               tracks: 2, name: nearDist(hit.x, hit.y), q: null, err: null };
  const pt = () => segPointAt(hit.s, st.mid);
  S.sel = { kind: 'seg', id: hit.s.id }; S.dirty = true;
  if (kind === 'rail') {
    S.drawTool = (g, z) => {
      const a0 = st.mid - st.plat / 100, a1 = st.mid + st.plat / 100;
      g.lineCap = 'butt'; g.strokeStyle = 'rgba(31,95,191,.9)'; g.lineWidth = Math.max(8, (0.22 * st.tracks + 0.3) * z); pathPart(g, hit.s, a0, a1); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(4, (0.22 * st.tracks + 0.18) * z); pathPart(g, hit.s, a0, a1); g.stroke(); g.lineCap = 'round';
    };
  }
  // 見つもりは「見つもる」を押してから。大きさを変えたら、やりなおし
  const quote = async () => {
    const p = pt(), my = st.seq = (st.seq || 0) + 1; st.quoting = true; draw();
    let q = null, err = null;
    try { q = await call('mp_sta_build', { p_kind: kind, p_seg: hit.s.id, p_x: p.x, p_y: p.y, p_plat: st.plat, p_tracks: st.tracks, p_name: st.name || '仮', p_as: S.as, p_dry: true }); } catch (e) { err = e.message; }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err;
    draw(); S.dirty = true;
  };
  const changed = () => { st.seq = (st.seq || 0) + 1; st.quoting = false; st.q = null; st.err = null; draw(); S.dirty = true; };
  const draw = () => sheet(`<h4>${kind === 'rail' ? '🚉 駅をつくる' : '🚏 バス停をつくる'}</h4>
    <div class="mp-row"><input class="mp-inp" data-nm placeholder="${kind === 'rail' ? '駅の名前（「駅」はつけない）' : 'バス停の名前'}" value="${esc(st.name)}"></div>
    ${kind === 'rail' ? `<div class="mp-row"><span>ホーム</span> <button class="btn" data-pm="-20" style="flex:none;padding:4px 12px">−</button><b style="min-width:4.2em;text-align:center">${st.plat}m</b><button class="btn" data-pm="20" style="flex:none;padding:4px 12px">＋</button>
        <span class="muted small">20m の車両 ${Math.floor(st.plat / 20)}両まで</span></div>
      <div class="mp-row">番線 <span class="mp-seg">${[1, 2, 3, 4, 6].map(n => `<button data-t="${n}" class="${st.tracks === n ? 'on' : ''}">${n}</button>`).join('')}</span></div>
      <p class="muted small" style="margin:4px 0 0">起点と終点のあいだが、ホームになります（20m単位）。もう一度タップすると、えらびなおせます</p>` : ''}
    <div class="mp-row">${st.q ? `<span class="mp-cost">工事費 ${X(st.q.cost)}</span><span class="small"><span>維持費 1日 ${X(st.q.up_day)}</span>${st.q.lease ? `<span>・使用料 1日 ${X(st.q.lease)}</span>` : ''}</span>` : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、つくれます</span>'}</div>
    ${st.q ? needH(st.q.need) : ''}
    <div class="mp-row"><button class="btn main" data-ok ${st.q && !hasNeed(st.q) ? '' : 'disabled'}>つくる（${esc(asName())}）</button></div>`, s => {
    s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
    needBind(s, st.q && st.q.need, () => quote());
    s.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { st.plat = clamp(st.plat + Number(b.dataset.pm), 20, 400); changed(); });
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.tracks = Number(b.dataset.t); changed(); });
    { const es = s.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
    s.querySelector('[data-ok]').onclick = async () => {
      st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('名前をつけてください');
      const p = pt();
      if (await api('mp_sta_build', { p_kind: kind, p_seg: hit.s.id, p_x: p.x, p_y: p.y, p_plat: st.plat, p_tracks: st.tracks, p_name: st.name, p_as: S.as, p_dry: false }, 'つくりました')) {
        refreshBox(p.x - 6, p.y - 6, p.x + 6, p.y + 6); sheet(null); S.sel = null; S.toolState = null; S.drawTool = null; S.dirty = true;
        if (kind === 'rail') hint('駅：ホームの起点をタップ（自分の線路の上）。バス停は道路の上をタップ');
      }
    };
  });
  S.onSheetClose = () => { S.toolState = null; S.drawTool = null; S.dirty = true; if (S.tool === 'sta') hint('駅：ホームの起点をタップ（自分の線路の上）。バス停は道路の上をタップ'); };
  draw();
}

// 車庫：車両基地は線路をなぞる（起点と終点をタップ・20m単位。つなぎ目をはさむときは1本にする）。バスの営業所は道路の横をタップ
async function depTap(x, y) {
  if (S.toolState && S.toolState.busy) return;
  const hr = nearSeg(x, y, 14, s => s.k === 'rail' && s.mine);
  if (hr) {
    const st = S.toolState || (S.toolState = {});
    let why = null;
    if (st.da && !st.ddone && st.da.s.id !== hr.s.id) {
      st.busy = true; const j = await joinHits(st.da, hr, 20.6); st.busy = false;
      if (S.toolState !== st || S.tool !== 'dep') return;
      if (Array.isArray(j)) { st.da = j[0]; st.ddone = true; hint(''); return depSheetRail(j[0], j[1]); }
      why = j;
    }
    if (!st.da || st.da.s.id !== hr.s.id || st.ddone) {
      if (why === 'far') toast(T('同じ線路の上で終点をタップしてください（起点をえらびなおしました）'));
      S.toolState = { da: hr }; sheet(null);
      hint('車両基地：終点をタップしてください（同じ線路の上・20m単位）');
      S.drawTool = (g, z) => { const t = S.toolState; if (!t || !t.da) return; const p = segPointAt(t.da.s, t.da.at); g.fillStyle = '#8a5a1f'; g.beginPath(); g.arc(sx(p.x), sy(p.y), 6, 0, 6.3); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); };
      S.dirty = true; return;
    }
    st.ddone = true; hint('');
    return depSheetRail(st.da, hr);
  }
  const hb = nearSeg(x, y, 12, s => s.k === 'road' && s.c !== 'exp');
  const hit = hb; if (!hit) return toast('自分の線路（バスは道路）の近くをタップしてください');
  const kind = 'bus';
  // タップした側
  const side = ((x - hit.x) * -Math.sin(hit.ang) + (y - hit.y) * Math.cos(hit.ang)) >= 0 ? 1 : -1;
  const st = { size: 'S', side, name: nearDist(x, y) + (kind === 'rail' ? '車両基地' : '営業所'), q: null, err: null };
  const prev = () => ({ fx: hit.x, fy: hit.y, a: hit.ang, side: st.side, sz: st.size, k: kind });
  S.drawTool = (g, z) => { const P = depPoly(prev()); g.beginPath(); P.forEach((p, i) => i ? g.lineTo(sx(p[0]), sy(p[1])) : g.moveTo(sx(p[0]), sy(p[1]))); g.closePath(); g.fillStyle = st.err ? 'rgba(220,40,40,.35)' : 'rgba(30,110,230,.3)'; g.fill(); g.strokeStyle = '#1f5fbf'; g.lineWidth = 2; g.stroke(); };
  S.dirty = true;
  const quote = async () => {
    const my = st.seq = (st.seq || 0) + 1; st.quoting = true; draw();
    let q = null, err = null;
    try { q = await call('mp_dep_build', { p_kind: kind, p_seg: hit.s.id, p_x: hit.x, p_y: hit.y, p_side: st.side, p_size: st.size, p_name: st.name || '仮', p_as: S.as, p_dry: true }); } catch (e) { err = e.message; }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err;
    draw(); S.dirty = true;
  };
  const changed = () => { st.seq = (st.seq || 0) + 1; st.quoting = false; st.q = null; st.err = null; draw(); S.dirty = true; };
  const sizes = kind === 'rail' ? [['S', '小（16両）'], ['M', '中（48両）'], ['L', '大（120両）']] : [['S', '小（20台）'], ['M', '中（60台）']];
  const draw = () => sheet(`<h4>${kind === 'rail' ? '🏭 車両基地をつくる' : '🏭 バスの営業所をつくる'}</h4>
    <div class="mp-row"><input class="mp-inp" data-nm value="${esc(st.name)}"></div>
    <div class="mp-row"><span class="mp-seg">${sizes.map(s => `<button data-s="${s[0]}" class="${st.size === s[0] ? 'on' : ''}">${s[1]}</button>`).join('')}</span>
      <button class="btn" data-side>反対側にする</button></div>
    <div class="mp-row">${st.q ? `<span class="mp-cost">工事費 ${X(st.q.cost)}</span><span class="small">使用料 1日 ${X(st.q.lease)}・維持費 1日 ${X(st.q.up_day)}</span>` : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、つくれます</span>'}</div>
    ${st.q ? needH(st.q.need) : ''}
    <div class="mp-row"><button class="btn main" data-ok ${st.q && !hasNeed(st.q) ? '' : 'disabled'}>つくる（${esc(asName())}）</button></div>`, s => {
    s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
    needBind(s, st.q && st.q.need, () => quote());
    s.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { st.size = b.dataset.s; changed(); });
    s.querySelector('[data-side]').onclick = () => { st.side = -st.side; changed(); };
    { const es = s.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
    s.querySelector('[data-ok]').onclick = async () => {
      st.name = s.querySelector('[data-nm]').value.trim();
      if (await api('mp_dep_build', { p_kind: kind, p_seg: hit.s.id, p_x: hit.x, p_y: hit.y, p_side: st.side, p_size: st.size, p_name: st.name, p_as: S.as, p_dry: false }, 'つくりました')) {
        refreshBox(hit.x - 12, hit.y - 12, hit.x + 12, hit.y + 12); sheet(null); S.drawTool = null;
      }
    };
  });
  S.onSheetClose = () => { S.drawTool = null; S.dirty = true; };
  draw();
}

// 車両基地（線路をなぞる）：長さ（20m単位）・留置線の数・どちら側か
function depSheetRail(h1, h2) {
  const seg = h1.s, span = Math.abs(h2.at - h1.at);
  const st = { len: clamp(Math.round(span * 50 / 20) * 20, 40, 1000), mid: (h1.at + h2.at) / 2, n: 6, side: 1, name: nearDist(h1.x, h1.y) + '車両基地', q: null, err: null };
  const sz = () => `T${st.len}x${st.n}`;
  const at = () => { const p = segPointAt(seg, st.mid); return p; };
  S.sel = { kind: 'seg', id: seg.id };
  S.drawTool = (g, z) => {
    const p = at(), P = depPoly({ fx: p.x, fy: p.y, a: p.ang, side: st.side, sz: sz(), k: 'rail' });
    g.beginPath(); P.forEach((q, i) => i ? g.lineTo(sx(q[0]), sy(q[1])) : g.moveTo(sx(q[0]), sy(q[1]))); g.closePath();
    g.fillStyle = st.err ? 'rgba(220,40,40,.35)' : 'rgba(150,110,60,.4)'; g.fill(); g.strokeStyle = '#8a5a1f'; g.lineWidth = 2; g.stroke();
    g.lineCap = 'butt'; g.strokeStyle = 'rgba(138,90,31,.85)'; g.lineWidth = Math.max(5, 0.3 * z); pathPart(g, seg, st.mid - st.len / 100, st.mid + st.len / 100); g.stroke(); g.lineCap = 'round';
  };
  S.dirty = true;
  const args = dry => { const p = at(); return { p_kind: 'rail', p_seg: seg.id, p_x: p.x, p_y: p.y, p_side: st.side, p_size: sz(), p_name: st.name || '仮', p_as: S.as, p_dry: dry }; };
  const quote = async () => {
    const my = st.seq = (st.seq || 0) + 1; st.quoting = true; draw();
    let q = null, err = null;
    try { q = await call('mp_dep_build', args(true)); } catch (e) { err = e.message; }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err;
    draw(); S.dirty = true;
  };
  const changed = () => { st.seq = (st.seq || 0) + 1; st.quoting = false; st.q = null; st.err = null; draw(); S.dirty = true; };
  const step = (k, d, lo, hi) => `<button class="btn" data-${k}="${-d}" style="flex:none;padding:4px 12px">−</button><b style="min-width:4.2em;text-align:center">${k === 'len' ? st.len + 'm' : T(`${st.n}本`)}</b><button class="btn" data-${k}="${d}" style="flex:none;padding:4px 12px">＋</button>`;
  const draw = () => sheet(`<h4>🏭 車両基地をつくる</h4>
    <div class="mp-row"><input class="mp-inp" data-nm value="${esc(st.name)}" placeholder="車両基地の名前"></div>
    <div class="mp-row"><span>長さ</span> ${step('len', 20)}</div>
    <div class="mp-row"><span>留置線</span> ${step('n', 1)} <button class="btn" data-side>反対側にする</button></div>
    <p class="small" style="margin:4px 0 0">20m の車両 ${Math.floor(st.len / 20) * st.n}両まで（${Math.floor(st.len / 20)}両 × ${st.n}本）</p>
    <div class="mp-row">${st.q ? `<span class="mp-cost">工事費 ${X(st.q.cost)}</span><span class="small">使用料 1日 ${X(st.q.lease)}・維持費 1日 ${X(st.q.up_day)}</span>` : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、つくれます</span>'}</div>
    ${st.q ? needH(st.q.need) : ''}
    <div class="mp-row"><button class="btn main" data-ok ${st.q && !hasNeed(st.q) ? '' : 'disabled'}>つくる（${esc(asName())}）</button></div>
    <p class="muted small" style="margin:4px 0 0">起点と終点のあいだに、線路にそって車両基地をつくります（20m単位）。もう一度タップすると、えらびなおせます</p>`, s => {
    s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
    needBind(s, st.q && st.q.need, () => quote());
    s.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { st.len = clamp(st.len + Number(b.dataset.len), 40, 1000); changed(); });
    s.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { st.n = clamp(st.n + Number(b.dataset.n), 1, 20); changed(); });
    s.querySelector('[data-side]').onclick = () => { st.side = -st.side; changed(); };
    { const es = s.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
    s.querySelector('[data-ok]').onclick = async () => {
      st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('名前をつけてください');
      const p = at();
      if (await api('mp_dep_build', args(false), 'つくりました')) { refreshBox(p.x - 14, p.y - 14, p.x + 14, p.y + 14); sheet(null); S.drawTool = null; S.toolState = null; S.sel = null; hint(TOOL_HINT.dep); }
    };
  });
  S.onSheetClose = () => { S.drawTool = null; S.toolState = null; S.dirty = true; if (S.tool === 'dep') hint(TOOL_HINT.dep); };
  draw();
}

/* ---- こわす ---- */
async function delTap(x, y) {
  const st = nearSta(x, y, 14); if (st && st.s.mine) return showSta(st.s);
  const dp = nearDep(x, y); if (dp && dp.mine) return showDep(dp);
  const sg = nearSeg(x, y, 10, s => s.mine); if (sg) return segDel(sg.s);
  const [cx, cy] = cellAt(x, y), key = cx + ',' + cy;
  const P = S.vis && [...S.vis.parcels.values()].find(q => q.cells.has(key));
  const hb = hitBld(x, y);
  if (hb && hb.b.own === 2) return openBld(hb.b.id);
  if (P && P.own === 2 && P.bld) return showSpot(cx, cy);
  toast('こわせるもの（自分の線・駅・車庫・建物）がありません');
}

/* ---------- メニュー（車両・系統・ダイヤ・お金・管理） ---------- */
function modal(html, bind, cls) {
  const m = document.createElement('div'); m.className = 'modal mp-modal';
  m.innerHTML = `<div class="sheet ${cls || ''}"><div class="row" style="display:flex;align-items:center;gap:8px"><b style="font-size:18px" data-title></b><button class="btn" style="margin-left:auto" data-x>とじる</button></div><div data-body></div></div>`;
  const body = m.querySelector('[data-body]');
  m.onclick = ev => { if (ev.target === m || ev.target.hasAttribute('data-x')) close(); };
  const close = () => { m.remove(); if (m.onclose) m.onclose(); };
  m.set = (title, h, b) => { m.querySelector('[data-title]').textContent = T(title); body.innerHTML = h; if (b) b(body); busyGuard(body); };
  m.close = close;
  document.body.appendChild(m);
  if (html) m.set(html[0], html[1], bind);
  return m;
}
function openMenu() {
  const m = modal(['国土のメニュー', `<div class="mp-list">
    <button class="mp-item" style="text-align:left" data-k="cars"><b>🚃 車両と編成</b><br><small>注文（1両から）・編成を組む・改造・検査・更新・転属・廃車</small></button>
    <button class="mp-item" style="text-align:left" data-k="routes"><b>🗺 系統とダイヤ</b><br><small>止まる駅の順番・列車の時刻（採時駅）・ダイヤグラム・航路（フェリー）・空路（飛行機）</small></button>
    <button class="mp-item" style="text-align:left" data-k="ops"><b>📋 運用</b><br><small>どの編成がどの列車を走るか・運用ファイル（書き出し・読みこみ）</small></button>
    <button class="mp-item" style="text-align:left" data-k="xfer"><b>🤝 編成の譲渡</b><br><small>とどいた申しこみを受けとる・ことわる／出した申しこみ</small></button>
    <button class="mp-item" style="text-align:left" data-k="thru"><b>🔀 乗り入れ</b><br><small>ほかの人・会社の線路に列車を走らせる（申請・許可・線路使用料）</small></button>
    <button class="mp-item" style="text-align:left" data-k="blds"><b>🏢 自分の建物</b><br><small>部屋の入居・家賃の水準・テナント（${esc(asName())}）</small></button>
    <button class="mp-item" style="text-align:left" data-k="tenants"><b>🔑 テナント募集</b><br><small>会社で部屋を借りる・借りている部屋</small></button>
    <button class="mp-item" style="text-align:left" data-k="sc"><b>🏭 施設と工場</b><br><small>学校・ホテル・病院・娯楽の客と売上／つくるもの・在庫・トラック・市場の値段</small></button>
    <button class="mp-item" style="text-align:left" data-k="home"><b>🏠 自分の住所</b><br><small>${S.boot.home ? `<span translate="no">${esc(S.boot.home.text)}</span>` : 'まだ決めていません'}</small></button>
    <button class="mp-item" style="text-align:left" data-k="landreq"><b>📨 土地の申請</b><br><small>他人の土地を使う申請・とどいた申請への返事（許可・ことわる）</small></button>
    <button class="mp-item" style="text-align:left" data-k="slots"><b>🛫 発着口（空港）</b><br><small>空港ごとの発着口・入札・自分の発着口（${esc(asName())}）</small></button>
    <button class="mp-item" style="text-align:left" data-k="ledger"><b>💴 お金の記録</b><br><small>運賃・家賃・維持費・使用料・工事費（${esc(asName())}）</small></button>
    ${S.admin ? `<button class="mp-item" style="text-align:left" data-k="admin"><b>🛠 管理</b><br><small>値段の設定・用途地域・ようす</small></button>` : ''}
    <button class="mp-item" style="text-align:left" data-k="help"><b>❓ あそびかた</b></button></div>`], b => {
    b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => { m.close(); ({ cars: () => openCars(), routes: openRoutes, ops: () => openOps(), xfer: () => openXfers(), thru: () => openThru(), blds: openMyBlds, tenants: openTenants, sc: () => openSC(), home: openHome, landreq: () => openLandReqs(), slots: () => openSlotList(), ledger: openLedger, admin: openAdmin, help: openHelp })[x.dataset.k](); });
  });
}
/* ---------- 発着口（t57）：空港ごとの発着口・入札。国（管理者）はふやす・へらす・入札に出す
   t59：国の認可制（番号 1〜n）。申しこみ → 国が認可（無料・期限なし）。持ち主は返せる・国はとりけせる ---------- */
const jdt = t => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const APP_ST = { req: '返事まち', ok: '認可', no: '認可されませんでした', cancel: 'とりさげ' };
async function openSlotList() {
  const m = modal(['🛫 発着口（空港）', '<p class="muted small">読みこんでいます…</p>'], null);
  const d = await api('mp_slot_list', { p_as: S.as }); if (!d) return m.close();
  m.set('🛫 発着口（空港）', d.length ? `<div class="mp-list">${d.map(a => `<button class="mp-item" style="text-align:left" data-st="${a.st}"><b>✈ <span>${esc(a.name)}</span></b>
      <br><small><span>滑走路 ${a.plat > 0 ? fmt(a.plat) + 'm' : 'なし'}</span>・<span>発着口 ${a.n}（あき ${a.free}）</span>${a.lic ? `・<span>国の認可制 ${a.lic}（あき ${a.lfree}）</span>` : ''}${a.aucs ? `・<span>入札中 ${a.aucs}（しめきり ${jdt(a.ends)}）</span>` : ''}${a.my ? `・<b><span>自分 ${a.my}</span></b>` : ''}${a.lead ? `・<span>いちばん高い入札 ${a.lead}</span>` : ''}${a.apps ? `・<b class="mp-warn"><span>申しこみ ${a.apps}</span></b>` : ''}</small></button>`).join('')}</div>
      <p class="muted small"><span>発着口1つで、その空港を出る便を1時間に1便。</span><span>権利は入札で買います（${esc(asName())}の名義）。</span><span>国の認可制の発着口は、申しこんで国に認可してもらいます（無料・期限なし）</span></p>` : '<p class="small">国の空港はまだありません</p>', b => {
    b.querySelectorAll('[data-st]').forEach(x => x.onclick = () => { m.close(); openSlots(Number(x.dataset.st)); });
  });
}
async function openSlots(st) {
  if (!st) return;
  const m = modal(['🛫 発着口・入札', '<p class="muted small">読みこんでいます…</p>'], null);
  const load = async () => {
    const d = await api('mp_slot_get', { p_st: st, p_as: S.as }); if (!d) return m.close();
    const adm = d.admin && S.as === 'gov', bidOk = S.as !== 'gov';
    const free = d.slots.filter(x => !x.live && !x.auc).length, nlic = d.slots.filter(x => x.lic).length;
    const lfree = d.slots.filter(x => x.lic && !x.live).length, afree = d.slots.filter(x => !x.lic && !x.live && !x.auc).length;
    const reqs = d.apps.filter(a => a.st === 'req');
    const slotRow = x => `<div class="mp-item small"><b>${x.n}番</b>${x.lic ? ' <span class="mp-tag">認可</span>' : ''} ${x.live
        ? `<span>${esc(x.o || '')}</span>${x.mine ? '<small>（あなた）</small>' : ''}・<small>${x.until ? `<span>${jdt(x.until)}まで</span>・<span>${X(x.price)}</span>` : '<span>期限なし（国の認可）</span>'}</small>
           ${x.mine && x.lic ? ` <button class="btn" data-ret="${x.id}" style="padding:2px 8px">国に返す</button>` : ''}${adm && x.lic ? ` <button class="btn" data-rev="${x.n}" style="padding:2px 8px">とりけす</button>` : ''}`
        : x.auc ? '<span>入札中</span>' : x.lic ? '<span class="muted">あき（申しこみ）</span>' : '<span class="muted">あき</span>'}</div>`;
    m.set('🛫 発着口・入札', `<p class="small" style="margin:0"><b>✈ <span>${esc(d.name)}</span></b></p>
      <div class="mp-kv"><b>滑走路</b><span>${d.rwys.length ? d.rwys.map(r => `<span>${esc(r.n)}・${fmt(r.len)}m</span>`).join('<br>') : '<span class="mp-warn">まだありません（飛行機は飛べません）</span>'}</span>
        <b>発着口</b><span><span>${d.slots.length}こ</span>（<span>あき ${free}</span>）</span>
        ${nlic ? `<b>国の認可制</b><span><span>${nlic}こ</span>（<span>1〜${Math.max(...d.slots.filter(x => x.lic).map(x => x.n))}番</span>・<span>あき ${lfree}</span>）</span>` : ''}
        ${bidOk ? `<b>${esc(asName())}</b><span><span>${d.my}こ</span>（<span>この空港を出る便を1時間に${d.my}便まで</span>）</span>` : ''}</div>
      ${nlic ? `<h4 style="margin:10px 0 4px">国の認可制</h4>
        ${adm ? (reqs.length ? `<div class="mp-list">${reqs.map(a => `<div class="mp-item"><b><span>${esc(a.who)}</span></b> <small><span>${a.n}こ</span>・<span>${jdt(a.at)}</span>・<span>いま持っている ${a.held}こ</span></small>
              ${a.msg ? `<br><small>「<span>${esc(a.msg)}</span>」</small>` : ''}
              <div class="mp-row" style="margin-top:6px;align-items:center;flex-wrap:wrap;gap:6px"><span class="small">認可する数</span><input class="mp-inp" style="width:64px" inputmode="numeric" data-an-in="${a.id}" value="${Math.min(a.n, lfree)}"><span class="small">こ</span>
                <input class="mp-inp" style="flex:1 1 150px" data-note-in="${a.id}" maxlength="200" placeholder="ひとこと（なくてもよい）"></div>
              <div class="mp-row" style="margin-top:4px"><button class="btn main" data-aok="${a.id}">認可する</button><button class="btn" data-ano="${a.id}">ことわる</button></div></div>`).join('')}</div>`
            : '<p class="muted small">返事まちの申しこみはありません</p>')
          : `${bidOk ? `<div class="mp-row" style="align-items:center;flex-wrap:wrap;gap:6px"><span class="small">ほしい数</span><input class="mp-inp" style="width:64px" inputmode="numeric" data-ap-n value="1"><span class="small">こ</span>
                <input class="mp-inp" style="flex:1 1 150px" data-ap-msg maxlength="200" placeholder="使いみち（どこへの路線・1日何便など）"></div>
              <div class="mp-row" style="margin-top:4px"><button class="btn main" data-apply>申しこむ（${esc(asName())}）</button></div>` : ''}
            ${d.apps.length ? `<div class="mp-list">${d.apps.map(a => `<div class="mp-item small"><b>${esc(T(APP_ST[a.st] || a.st))}</b> <span>${a.n}こ</span>${a.st === 'ok' ? `（<span>認可 ${a.got}こ</span>）` : ''}・<span>${jdt(a.at)}</span>
                ${a.msg ? `<br>「<span>${esc(a.msg)}</span>」` : ''}${a.note ? `<br><span>国から</span>：「<span>${esc(a.note)}</span>」` : ''}
                ${a.st === 'req' ? ` <button class="btn" data-acan="${a.id}" style="padding:2px 8px">とりさげる</button>` : ''}</div>`).join('')}</div>` : ''}`}` : ''}
      <h4 style="margin:10px 0 4px">入札中</h4>
      ${d.aucs.length ? `<div class="mp-list">${d.aucs.map(a => `<div class="mp-item"><b>${a.n}番</b> <small><span>しめきり ${jdt(a.ends)}</span>・<span>最低 ${X(a.minp)}</span></small>
          <br><small>${a.best != null ? `<span>いま ${X(a.best)}</span>（<span>${a.nbid}件</span>）${a.mine ? ' <b><span>あなたがいちばん高い</span></b>' : ''}` : '<span>まだ入札がありません</span>'}</small>
          ${bidOk ? `<div class="mp-row" style="margin-top:4px"><input class="mp-inp" style="flex:1 1 120px" inputmode="numeric" data-amt="${a.id}" value="${a.next}"><button class="btn main" data-bid="${a.id}">入札する</button></div>` : ''}
          ${adm ? `<div class="mp-row" style="margin-top:4px"><button class="btn" data-stop="${a.id}">とりやめる</button></div>` : ''}</div>`).join('')}</div>`
        : '<p class="muted small">いま入札中の発着口はありません</p>'}
      <h4 style="margin:10px 0 4px">発着口</h4>
      <div class="mp-list">${d.slots.map(slotRow).join('')}</div>
      ${adm ? `<h4 style="margin:10px 0 4px">国（管理者）</h4><div class="mp-row"><button class="btn" data-add>＋ ふやす</button><button class="btn" data-del>－ へらす</button>${afree ? '<button class="btn main" data-open>入札に出す</button>' : ''}<button class="btn" data-lic>認可制の番号</button></div>` : ''}
      <p class="muted small"><span>発着口1つで、この空港を出る便を1時間に1便出せます（持っている数より多い便は飛びません）。</span><span>入札は${d.hours}時間で、いちばん高い人が落札します（お金は国庫へ）。入札したお金はあずかり、ほかの人が上回ったら返します。</span><span>権利は${d.days}日。期限がきたら、また入札に出ます。</span>${nlic ? '<span>国の認可制の発着口は入札に出しません。何こほしいかと使いみちを書いて申しこみ、国が認可すると、無料・期限なしで使えます（国がとりけすまで。いらなくなったら国に返せます）。</span>' : ''}</p>`, b => {
      b.querySelectorAll('[data-bid]').forEach(x => x.onclick = async () => {
        const id = Number(x.dataset.bid), t = hw(b.querySelector(`[data-amt="${id}"]`).value).replace(/[,，\s]/g, ''), n = Number(t);
        if (!(n > 0)) return toast('数字を入れてください');
        if (!confirm(T(`${fmt(n)} X で入札します（${asName()}の名義。お金はあずかり、ほかの人が上回ったら返します）。よろしいですか？`))) return;
        if (await api('mp_slot_bid', { p_auc: id, p_amt: n, p_as: S.as }, '入札しました')) load();
      });
      b.querySelectorAll('[data-stop]').forEach(x => x.onclick = async () => {
        if (!confirm(T('この入札をとりやめますか？（あずかったお金は返します）'))) return;
        if (await api('mp_slot_admin', { p_st: st, p_op: 'stop', p_n: Number(x.dataset.stop), p_minp: 0 }, 'とりやめました')) load();
      });
      const ad = b.querySelector('[data-add]'); if (ad) ad.onclick = async () => {
        const v = prompt(T('ふやす発着口の数（1〜50）'), '1'); if (v == null) return;
        if (await api('mp_slot_admin', { p_st: st, p_op: 'add', p_n: Number(hw(v).replace(/[^\d]/g, '')), p_minp: 0 }, 'ふやしました')) load();
      };
      const dl = b.querySelector('[data-del]'); if (dl) dl.onclick = async () => {
        const v = prompt(T('へらす発着口の数（あいているものだけ。番号の大きいものから）'), '1'); if (v == null) return;
        if (await api('mp_slot_admin', { p_st: st, p_op: 'del', p_n: Number(hw(v).replace(/[^\d]/g, '')), p_minp: 0 }, 'へらしました')) load();
      };
      const op = b.querySelector('[data-open]'); if (op) op.onclick = async () => {
        const v = prompt(T(`入札に出す発着口の数（あき ${afree}）`), String(afree)); if (v == null) return;
        const p = prompt(T('最低価格（X）'), '100000000'); if (p == null) return;
        const n = Number(hw(p).replace(/[,，\s]/g, ''));
        if (!(n >= 0)) return toast('数字を入れてください');
        if (await api('mp_slot_admin', { p_st: st, p_op: 'open', p_n: Number(hw(v).replace(/[^\d]/g, '')), p_minp: n }, '入札に出しました')) load();
      };
      const lc = b.querySelector('[data-lic]'); if (lc) lc.onclick = async () => {
        const v = prompt(T('国の認可制にする番号（1〜この番号まで。0 でなし）'), String(nlic ? Math.max(...d.slots.filter(x => x.lic).map(x => x.n)) : 0)); if (v == null) return;
        const dg = hw(v).replace(/[^\d]/g, ''), n = Number(dg); if (dg === '' || !(n >= 0)) return toast('数字を入れてください');
        if (await api('mp_slot_admin', { p_st: st, p_op: 'lic', p_n: n, p_minp: 0 }, '変えました')) load();
      };
      // 申しこむ：数と使いみちは欄に入れる（画面の上のポップアップは使わない。日本語入力の確定前の数字が消えないように）
      const ap = b.querySelector('[data-apply]'); if (ap) ap.onclick = async () => {
        const dg = hw((b.querySelector('[data-ap-n]') || {}).value).replace(/[^\d]/g, ''), n = Number(dg);
        if (dg === '' || !(n >= 1)) return toast(`ほしい数を数字で入れてください（1〜${Math.min(20, nlic)}）`);
        const msg = (b.querySelector('[data-ap-msg]') || {}).value || '';
        if (await api('mp_slot_apply', { p_st: st, p_n: n, p_msg: msg, p_as: S.as }, '申しこみました。国の返事がきたら通知がとどきます')) load();
      };
      b.querySelectorAll('[data-acan]').forEach(x => x.onclick = async () => {
        if (!confirm(T('この申しこみをとりさげますか？'))) return;
        if (await api('mp_slot_cancel', { p_app: Number(x.dataset.acan), p_as: S.as }, 'とりさげました')) load();
      });
      // 認可・ことわる：数とひとことは、その申しこみの欄に入れる（画面の上のポップアップは使わない）
      const inV = (k, id) => { const e = b.querySelector(`[data-${k}="${id}"]`); return e ? e.value : ''; };
      b.querySelectorAll('[data-aok]').forEach(x => x.onclick = async () => {
        const id = Number(x.dataset.aok), dg = hw(inV('an-in', id)).replace(/[^\d]/g, ''), n = Number(dg);
        if (dg === '' || !(n >= 1)) return toast(`認可する数を数字で入れてください（あき ${lfree}）`);
        if (n > lfree) return toast(`あいている認可制の発着口は ${lfree}こです`);
        if (await api('mp_slot_answer', { p_app: id, p_ok: true, p_n: n, p_note: inV('note-in', id) }, '認可しました')) load();
      });
      b.querySelectorAll('[data-ano]').forEach(x => x.onclick = async () => {
        const id = Number(x.dataset.ano);
        if (!confirm(T('この申しこみをことわりますか？（ひとことの欄に書いたことが、わけとしてとどきます）'))) return;
        if (await api('mp_slot_answer', { p_app: id, p_ok: false, p_n: 0, p_note: inV('note-in', id) }, 'ことわりました')) load();
      });
      b.querySelectorAll('[data-ret]').forEach(x => x.onclick = async () => {
        if (!confirm(T('この発着口を国に返しますか？（もう一度使うときは、申しこみからです）'))) return;
        if (await api('mp_slot_return', { p_slot: Number(x.dataset.ret), p_as: S.as }, '国に返しました')) load();
      });
      b.querySelectorAll('[data-rev]').forEach(x => x.onclick = async () => {
        if (!confirm(T(`${x.dataset.rev}番の認可をとりけしますか？（持ち主に知らせます）`))) return;
        if (await api('mp_slot_admin', { p_st: st, p_op: 'revoke', p_n: Number(x.dataset.rev), p_minp: 0 }, 'とりけしました')) load();
      });
    });
  };
  load();
}

// 自分の住所（t54i）：見る・地図で見る・消す
async function openHome() {
  const h = S.boot.home;
  const m = modal(['自分の住所', (h ? `<p class="small" style="margin:0 0 6px"><b translate="no">${esc(h.text)}</b></p>
      <p class="muted small"><span>あなたのページ（人のページ）で、みんなに見えます。</span><span>変えるときは、地図で区画か建物をタップ →「ここを自分の住所に」。</span></p>
      <div class="mp-row"><button class="btn main" data-go>地図で見る</button><button class="btn" data-clr style="color:#c33">住所を消す</button></div>`
    : `<p class="small"><span>まだ決めていません。</span><span>地図で区画か建物をタップ →「ここを自分の住所に」で決められます（建物なら部屋もえらべます）。</span></p>
      <p class="muted small">住所は、あなたのページ（人のページ）でみんなに見えます</p>`) + '<h4 style="margin:12px 0 4px">住民登録（住民票）</h4><div data-jm><p class="muted small">読みこんでいます…</p></div>'], b => {
    const q = k => b.querySelector(k);
    if (q('[data-go]')) q('[data-go]').onclick = () => { m.close(); homeGo(h.x, h.y); };
    if (q('[data-clr]')) q('[data-clr]').onclick = async () => {
      if (!confirm(T('自分の住所を消します。よろしいですか？'))) return;
      if (await api('mp_home_clear', {}, '住所を消しました')) { S.boot.home = null; S.dirty = true; m.close(); }
    };
  });
  // 住民票（t59）：本人だけ。役所の窓口へ
  const j = await api('mp_jm_mine', {}); const el = m.querySelector('[data-jm]'); if (!el) return;
  el.innerHTML = j ? `<p class="small" style="margin:0"><span>${esc(j.area)}</span>：<span translate="no">${esc(j.addr)}</span></p>
      <p class="muted small" style="margin:2px 0"><span>住民票は、あなたと管理者だけが見られます</span></p>
      ${j.office ? `<div class="mp-row"><button class="btn" data-off>🏛 <span>${esc(j.office.name)}</span><span>の窓口へ</span></button></div>` : ''}`
    : '<p class="small"><span>まだ住民登録をしていません。</span><span>市役所・区役所・町村役場をタップ →「🏛 住民の窓口」で転入届を出せます。</span></p>';
  const off = el.querySelector('[data-off]'); if (off) off.onclick = () => { m.close(); setCam((j.office.x + 0.5) / 5, (j.office.y + 0.5) / 5, Math.max(S.cam.z, 20)); pinAt((j.office.x + 0.5) / 5, (j.office.y + 0.5) / 5); openJuumin(j.office.id); };
  busyGuard(el);
}
// 住所（区画）へ地図を動かして、しらべる
function homeGo(x, y) { setCam((x + 0.5) / 5, (y + 0.5) / 5, Math.max(S.cam.z, 30)); showSpot(x, y); }
function openHelp() {
  modal(['国土のあそびかた', `<div class="small" style="line-height:1.8">
    <p><b>地図</b>：瑠璃市中里区がまん中。北西が山、南東が海です。指2本で拡大・縮小、ドラッグで動かします。タップすると住所（町字・地番）・地目・用途地域・地価がわかります。線は県・市区町村・町字の境界です。</p>
    <p><b>土地</b>：国の土地は区画（10m四方・100㎡）でえらんで買えます。道路の部分は国の土地（公衆用道路）なので買えません。買った土地は「筆」になり、地番がつきます（住所は町字＋地番）。となりあう自分の筆は合筆、筆の一部は分筆できます。売りに出ている筆は、その値段（＋取得税3%）。毎日、評価額の0.01%の固定資産税。</p>
    <p><b>地価と評価額</b>：瑠璃市の中心（中里区）は地価が高く（1㎡ 約10億 X）、まわり5kmで、なだらかにふつうの地価にもどります。国の土地を買う値段は地価、固定資産税・家賃・使用料・取得税は評価額（ふつうの地価）で計算します。瑠璃市役所と市民広場は国の建物です。</p>
    <p><b>建物</b>：自分の筆に、約280種類のプリセットから、形と階数をえらんで建てます（住まい・お店・オフィス・宿泊・医療と福祉・娯楽・学校・工場・倉庫と物流・港・田畑と農業・駐車場の12に分けてあり、名前でさがせます）。種類ごとに特徴があります（家賃の高さ・入りやすさ・人の多さ・まわりの建物への影響など。建てる画面に緑は有利・赤は不利で出ます）。広さと高さは用途地域の建ぺい率・容積率まで。細い形（塔状・板状）ほど高くできます。</p>
    <p><b>宿泊・医療と福祉・娯楽</b>：ホテル・旅館（宿泊料）、病院・診療所・老人ホーム（診療報酬など）、映画館・スタジアム・遊園地・神社・寺など（入場料など）を建てられます。客は、まわりの人と近くの駅の乗り降りする人から来て、同じ種類の施設が近くにあると分けあいます。地価が高いところは値段も高く、季節で客の多い月・少ない月があります。自分で使うか会社が借りると、1時間ごとに売上が入ります（水準 50〜200%）。</p>
    <p><b>部屋とテナント</b>：部屋ごとに「入居募集」（町の人やお店が入って家賃）・「テナント募集」（会社に貸す。会社が借りると、1時間ごとに会社から家賃）・「自分で使う」（店・事務所などは売上が入る）をえらびます。家賃の水準を上げると、入りにくく出ていきやすくなります。人が多いところ・乗り降りの多い駅の近くは入りやすく、店の売上も多くなります。会社は ≡ →「テナント募集」から部屋を借りられます。</p>
    <p><b>自社のオフィス</b>：自分の建物の部屋をえらんで「自社のオフィスにする」で、自分の別の会社をすぐ入れられます。家賃は自分で決めます（0 X でもよい）。店・事務所などの売上は、入った会社に入ります。退去すると入居募集にもどります。</p>
    <p><b>学校</b>：小学校・中学校・高校・大学・専門学校を建てられます。延床面積で定員が決まり、まわりの人（その年ごろの人）から生徒が通ってきます（同じ種類の学校が近くにあると分けあう。高校・大学・専門学校は駅やバス停が近いとふえる）。自分で使うか会社が借りると、授業料（先生の給料などをひいた分）が1時間ごとに入ります。授業料の水準（50〜200%）が高いと生徒が減ります。生徒は近くの駅・バス停の乗る人にふえます。麦畑キャンパスも同じです。</p>
    <p><b>特殊工場と物流</b>：材料からものをつくる工場です。小麦（田畑）→ 製粉工場 → 食品工場 → お店／鉄鉱石（港）→ 製鉄所 → 自動車工場／原油（港）→ 石油化学工場 → 半導体・家電工場。材料は1時間ごとに、近くの工場・田畑・港の在庫からトラックで自動で仕入れます（市場の値段＋運送費：1tごとに積みおろし＋距離）。輸入（値段の1.2倍）のほうが安いとき・足りないときは輸入。売れのこり（6時間分をこえる分）は市場へ（0.85倍）。食品は近くのお店へ、自動車・家電・半導体は市場へ。田畑・港湾施設は、建物の「つくるもの」で小麦・鉄鉱石・原油をえらぶと物流に入ります。≡ →「施設と工場」で一覧と市場の値段。</p>
    <p><b>バス・トラック</b>：1980年ごろの性能のバス（路線バス・観光バスなど）とトラック（2t・4t・10t・トレーラー）を、バスの営業所で注文できます。自動車工場（人・会社の工場）をメーカーにえらぶと、その工場の鉄鋼でつくります（自分の工場なら部品代だけ）。トラックは自分の工場・田畑・港の荷物を運び、そのぶん運送費がかかりません（1台で1時間に 積める重さ×300km÷24 t・km。トラックターミナルで +10%）。</p>
    <p><b>鉄道車両工場</b>：鉄鋼（近くの製鉄所から）で鉄道車両をつくります。≡ →「車両と編成」で注文するときにメーカーとしてえらべます。工場を動かしている名義の注文は部品代（定価の45%）と鉄鋼だけ。ほかの人・会社には値段の水準（定価の40〜150%）で売れます。1日につくれる両数は延床面積で決まり、注文が多いと納車が先になります。</p>
    <p><b>フェリー・船</b>：海の近くの筆に「フェリーターミナル」を建てると、港（⚓ 乗り場）と船の置き場ができます。船（1980年ごろの性能：旅客船・小型〜大型フェリー・高速船）は、≡ →「車両と編成」で港をえらんで注文します（国の造船所は24時間。造船所をえらぶと、その鉄鋼でつくります）。≡ →「系統とダイヤ」の「＋ 航路（フェリー）」で港を順にタップすると、海の上の道を自動でさがします（曲がり角の点はドラッグで動かせ、長押しで消せます）。便を入れると人を乗せて運賃が入ります。フェリーは、海をこえる荷物（工場の仕入れ・お店への食品）をトラックごと運び、その運賃は航路の持ち主に入ります（自分の航路なら運賃はかかりません）。フェリーの便がない島とは、荷物を運べません。ほかの人の港は、持ち主が貸し出しているものだけ航路に入れられます。</p>
    <p><b>空港・飛行機</b>：空港は国の建物で、国（管理者）が建てます。まん中に空港の乗り場（✈）と駐機場があります（飛行場・地方空港・空港・国際空港）。滑走路は国が道路のように引きます（「✈ 滑走路」。まっすぐ・800〜4,000m。浅い海の上にも、うめたてて引けます）。空港の滑走路の長さは、いちばん長い滑走路です。だれでも国の空港の駐機場に飛行機を置けます（みんなで使います）。飛行機（1980年ごろの性能：コミューター機・プロペラ旅客機・小型ジェット・中型ワイドボディ・ジャンボ）は、≡ →「車両と編成」で空港をえらんで注文します（国の航空機メーカーで48時間）。滑走路が短い空港には、大きな飛行機は置けず、離着陸もできません。≡ →「系統とダイヤ」の「＋ 空路（飛行機）」で空港を順にタップすると、まっすぐ飛ぶ路線ができます（空港どうしは10km以上）。空路に入れた空港ごとに、1路線・1日の使用料を国にはらいます。空港のまわり（10km）の人が乗り、運賃は距離で決まります。座席の数までしか乗れません。</p>
    <p><b>発着口</b>：空港ごとに発着口があり（飛行場2・地方空港4・空港8・国際空港16。国がふやせます）、1つで、その空港を出る便を1時間に1便出せます。発着口を使う権利は入札で買います（✈ →「🛫 発着口・入札」。24時間・いちばん高い人が落札。お金は国庫へ）。入札のお金はあずかり、ほかの人が上回ったら返します。権利は30日で、期限がきたら、また入札に出ます。持っている発着口より多い便は飛びません（便に【発着口】の注意が出ます）。≡ →「発着口（空港）」で空港の一覧。</p>
    <p><b>国の認可制の発着口</b>：空港によっては、番号の小さい発着口が「国の認可制」です（瑠璃国際空港は1〜59番）。入札には出ません。「🛫 発着口・入札」で、ほしい数と使いみちを書いて申しこむと、国が認可したぶんの権利が、無料・期限なしで入ります（国がとりけすまで。いらなくなったら国に返せます）。</p>
    <p><b>自分の住所</b>：地図で区画か建物をタップ →「ここを自分の住所に」（建物なら部屋もえらべます）。住所はあなたのページ（人のページ）でみんなに見えます。地図には🏠が出ます（自分にだけ）。≡ →「自分の住所」で見る・消す。</p>
    <p><b>さがす</b>：地図の右上の 🔍 で、住所（「瑠璃市中里区中央三丁目」「中里3-12-5」のように番地まで）・地名・町字・駅・空港・港・建物の名前でさがせます。人の名前や、人の住所ではさがせません。</p>
    <p><b>住民登録</b>：市役所・区役所・町村役場をタップ →「🏛 住民の窓口」。転入届（その市区町村に住所をうつす）・転居届（市区町村の中で引っこす）・転出届・住民票の写し（300 X）・印鑑登録・印鑑登録証明書（300 X）。市役所は市の全部、区役所はその区、町村役場はその町村を受けもちます。住民票（住所・日付・住民票コード）は、あなたと管理者だけが見られます。地図の「自分の住所」とは別です（届け出のときに、いっしょに変えることもできます）。</p>
    <p><b>風の芽大学</b>：風の芽大学中央駅のまわりは、風の芽大学 麦畑キャンパス（約140ha）。本部・図書館・学部・研究所・大学病院・附属学校・学生寮・グラウンド・実験農場（麦畑）などがならぶ、国の建物です。</p>
    <p><b>線路・道路</b>：点をおくと、なめらかな線になります。他人の土地や国の土地の上につくると、毎日使用料がかかります（国・府県・市の道路の上はかかりません）。まちの中は工事費が高くなります。</p>
    <p><b>他人の土地</b>：線路・道路・駅・車庫は、他人の筆の上には、持ち主が貸出料を決めているか、申請して許可をもらったときだけつくれます（使用料は1区画・1日。許可のときに持ち主が決めます）。自分の筆は、タップ →「貸出料」で貸し出せます。申請は ≡ →「土地の申請」。前からあるものは、そのまま使えます。</p>
    <p><b>バス停の貸し出し</b>：ほかの人・会社のバス停は、持ち主が貸し出しているものだけ系統に入れられます（1系統・1日の使用料。使いはじめたときの値段のまま）。自分のバス停は、タップ →「貸し出し」。</p>
    <p><b>駅と車庫</b>：駅はホームの長さ（20m単位）と番線の数を決めます（20mの車両がホームに入る両数まで。あとから駅の「ホーム・番線」で変えられます）。車両は車庫に車籍をおきます。</p>
    <p><b>車両</b>：122系0番台は国鉄103系とほぼ同じ性能（最高100km/h）。両はしに運転台つきの Tc（奇数向き・偶数向き）、まん中に Mp（パンタグラフつき）と M をはさんで編成にします。「編成で注文」で形式を先頭から順にえらんで、まとめて注文できます（編成番号は自分で決める）。車番は 122-0001 のように、形式の番号と4けたの番号です（Tc 奇数向き 0001〜・Mp 2001〜・M 4001〜・Tc 偶数向き 6001〜）。編成はほかの人・会社にゆずれます（相手が受けとったら移る）。</p>
    <p><b>系統とダイヤ</b>：止まる駅を順にえらんで系統をつくり、列車を入れます。時刻を決めるのは、会社が決めた採時駅だけ（着・発・番線）。ほかの駅は走る時間から自動で決まります。回送・試運転はお客を乗せません。日付をえらぶと、その日だけ走る臨時列車になります（過ぎたら消えます）。</p>
    <p><b>運用</b>：1つの編成が1日に走る列車のならびです。列車は運用に入れ、運用に編成を入れます（編成を入れかえると、その運用の列車ぜんぶが変わる）。「運用を自動で組む」で、編成ごとの運用をつくれます。運用ごとに JSON ファイルに書き出して、バックアップや AI にまかせたあと、読みこめます。</p>
    <p><b>待避と発着番線</b>：種別ごとに優先番号（0〜9。0 がいちばん優先）があります。優先番号の大きい列車は、待避できる駅で、うしろから来る優先番号の小さい列車に先をゆずって待ちます（待避）。追いつく列車は、前の列車のあとを走ります（続行）。時刻は自動でずれます。駅の番線ごとに、下り・上り・両方と、本線・待避線を決められます（駅をタップ →「発着番線」）。種別と優先番号は、系統の画面の「種別と優先番号」で。</p>
    <p><b>ほかの系統との待避・続行</b>：系統の画面で「ほかの系統と待避・続行」をオンにすると、その系統の列車は、同じ駅を通るほかの系統（乗り入れてくる他社の列車もふくむ）の列車のうち、優先番号の小さい列車（同じなら系統の番号の小さいほう）にもゆずります。相手の時刻は変わりません。同じ駅の同じ番線に重なる列車は、系統の画面の「重なりを直す」で直せます。</p>
    <p><b>停車駅のパターン</b>：系統の画面の「停車駅のパターン」で、種別ごとに止まる駅を決めておけます（例：快速はこの駅だけ）。端の駅も通過にでき、止まる最初の駅が始発、最後の駅が終着になります（列車ごとの「止まる駅」も同じ）。列車をつくるとき・まとめてつくるとき・種別を変えたときに、そのパターンになります。「この種別の列車にも当てはめる」で、いまある列車もまとめて変えられます。</p>
    <p><b>車歴と譲渡</b>：車両ごとに、新製・転属・譲渡・廃車が車歴にのこります（車両をえらんで「車歴」。廃車した車両は「廃車した車両」）。編成は「ゆずる」、編成に入っていない車両はえらんで「ゆずる」で、ほかの人・会社にゆずれます。まん中にも運転台つきの Tc を入れられます（中間封じ込め）。</p>
    <p><b>乗り入れ（他社直通）</b>：ほかの人・会社の駅か線路をタップ →「乗り入れを申請」。持ち主が許可する（線路使用料：1列車・1km）と、系統にその持ち主の駅を入れて、持ち主の線路を走れます。線路をつなぐこともできます（どちらかの向きに許可があれば）。運賃は系統の持ち主に、走った km ぶんの線路使用料は1時間ごとに線路の持ち主に入ります。同じ駅の番線は、ほかの持ち主の列車ともかさならないように見ます。持ち主が「やめる」と、その線路・駅を使う系統は走れなくなります。≡ →「乗り入れ」で、許可・ことわる・使用料を変える・やめる。</p>
    <p><b>連結</b>：列車ごとに、ほかの運用の編成をつなげます（3つ・16両まで）。とちゅうの駅でつなぐ・切りはなすこともできます（その運用の編成は、つなぐ駅に2分前までに着いていること）。ダイヤグラムでは太い線です。</p>
    <p><b>お金</b>：1時間ごとに運賃（駅のまわりの人・本数・速さ・冷暖房で決まる）が入り、維持費・使用料をはらいます。</p></div>`]);
}

/* ---- 車両と編成 ---- */
// 形式の役わり → 置く車庫の種類（rail 車両基地・bus 営業所・ship 港）
const roleKind = r => r === 'Ship' ? 'ship' : r === 'Air' ? 'air' : (r === 'Bus' || r === 'Truck') ? 'bus' : 'rail';
async function openCars(depFocus) {
  const m = modal(['車両と編成', '<p class="muted small">読みこんでいます…</p>']);
  const st = { dep: depFocus || null, pick: [], form: null, mode: 'view', seq: [], maker: null, mk: [] };   // seq：編成で注文する形式の列。maker：鉄道車両工場（t54k）
  const load = async () => {
    const [d, mk] = await Promise.all([api('mp_cars_list', { p_as: S.as }), api('mp_makers', {})]); if (!d) return;
    st.d = d; st.mk = mk || [];
    if (st.maker && !st.mk.some(x => x.id === st.maker)) st.maker = null;
    if (!st.dep || !d.depots.some(x => x.id === st.dep)) st.dep = d.depots.length ? d.depots[0].id : null;
    draw();
  };
  const carChip = (c, on) => `<span class="mp-car ${on ? 'on' : ''} ${c.busy ? 'busy' : ''}" data-car="${c.id}">${c.xfer ? '<small class="mp-warn">譲渡中</small> ' : ''}${c.role === 'Truck' ? '<small class="muted">トラック</small> ' : c.role && c.role !== 'Bus' && c.role !== 'Ship' && c.role !== 'Air' ? `<small class="muted">${esc(c.role)}</small> ` : ''}${esc(c.num)}<span class="n">${c.busy ? esc({ deliver: '納車まち', move: '転属中', ac: '冷房工事', heat: '暖房工事', toilet: 'トイレ工事', inspect: '検査中', renew: '更新工事' }[c.busy] || c.busy) : `<span>状態${c.cond}</span>${c.ac ? '❄' : ''}${c.toilet ? '🚻' : ''}`}</span></span>`;
  const draw = () => {
    const d = st.d, deps = d.depots, dep = deps.find(x => x.id === st.dep);
    if (!deps.length) return m.set('車両と編成', `<p class="small">まず地図で車庫（🏭）をつくってください。車両は車庫に車籍をおきます（${esc(asName())}）。船は港（フェリーターミナルの建物）に、飛行機は国の空港の駐機場に置きます。</p>`);
    const cars = d.cars.filter(c => c.depot === st.dep), forms = d.forms.filter(f => f.depot === st.dep), loose = cars.filter(c => !c.form);
    const road = dep.kind === 'bus', sea = dep.kind === 'ship', air = dep.kind === 'air', uni = sea || air, typeOpts = d.types.filter(t => roleKind(t.role) === dep.kind);   // 営業所：バス・トラック（t54l）・港：船（t54o）・空港：飛行機（t54p）
    const mks = st.mk.filter(x => (x.kind || 'rail') === (road ? 'road' : sea ? 'sea' : air ? 'air' : 'rail')), trucks = loose.filter(c => c.role === 'Truck');
    m.set('車両と編成', `
      <div class="tabs-s">${deps.map(x => `<button data-dep="${x.id}" class="${x.id === st.dep ? 'on' : ''}">${x.pub ? '✈ ' : ''}${esc(x.name)} ${x.n}/${x.cap}</button>`).join('')}</div>
      ${dep.pub ? '<p class="muted small" style="margin:4px 0 0">国の空港の駐機場です（みんなで使います。数は、みんなの飛行機の合計）</p>' : ''}
      <h4 style="margin:12px 0 4px">編成（${forms.length}）</h4>
      ${forms.map(f => { const p = f.perf || {}; const fc = cars.filter(c => c.form === f.id).sort((a, b) => a.pos - b.pos); return `<div class="mp-item">
        <b>${esc(f.name)}</b>${f.op ? ` <small class="muted"><span>運用</span> <span>${esc(f.op.num)}</span></small>` : ''}${f.xfer ? ' <small class="mp-warn">譲渡の申しこみ中</small>' : ''}
        <small>${p.air ? `<span>長さ${p.len}m・${fmt(p.cap)}席</span><span>・巡航${p.vmax}km/h</span><span>・滑走路${fmt(p.rwy)}m以上</span>` : p.ship ? `<span>長さ${p.len}m・旅客${fmt(p.cap)}人</span>${p.load ? `<span>・車両 ${fmt(p.load)}t</span>` : '<span>・車はのせられない</span>'}<span>・最高${p.vmax}km/h</span>` : `<span>${p.n}両・${p.len}m・定員${fmt(p.cap)}人・加速 ${p.acc}km/h/s・最高${p.vmax}km/h</span>${p.ac ? '<span>・冷房</span>' : ''}${p.toilet ? '<span>・トイレ</span>' : ''}`}${uni ? `<span>・状態${p.cond}・便 ${f.trains}本</span>` : `<span>・状態${p.cond}・列車 ${f.trains}本</span>`}</small>
        <div class="mp-cars">${fc.map(c => carChip(c, st.pick.includes(c.id))).join('')}</div>
        <div class="mp-row">${dep.kind === 'rail' ? `<button class="btn" data-reform="${f.id}">組みかえる</button><button class="btn" data-split="${f.id}">ばらす</button>` : ''}${f.xfer ? '' : `<button class="btn" data-give="${f.id}">ゆずる</button>`}</div></div>`; }).join('') || '<p class="muted small">まだありません</p>'}
      ${dep.kind === 'rail' ? `<h4 style="margin:12px 0 4px">編成に入っていない車両（${loose.length}）</h4><div class="mp-cars">${loose.map(c => carChip(c, st.pick.includes(c.id))).join('') || '<span class="muted small">なし</span>'}</div>`
        : air ? `<p class="muted small" style="margin:6px 0 0">飛行機は1機ずつが編成（機体の番号）になります。≡ →「系統とダイヤ」で空路に便を入れて飛ばします。滑走路の短い空港には離着陸できません</p>`
        : sea ? `<p class="muted small" style="margin:6px 0 0">船は1隻ずつが編成（船の名前）になります。≡ →「系統とダイヤ」で航路に便を入れて走らせます。フェリーは人のほかにトラックをのせて、海をこえる荷物を運びます（運賃は航路の持ち主に）</p>`
        : `<h4 style="margin:12px 0 4px">🚚 トラック（${trucks.length}）</h4><div class="mp-cars">${trucks.map(c => carChip(c, st.pick.includes(c.id))).join('') || '<span class="muted small">なし</span>'}</div>
          <p class="muted small" style="margin:2px 0 0">トラックは、${esc(asName())}の工場・田畑・港の荷物を運びます（そのぶん運送費がかかりません）。1台で1時間に「積める重さ × ${fmt((S.boot.scr || {}).trk || 300)}km ÷ 24」t・km（1t 運ぶごとに 距離＋10km 分）。トラックターミナルを動かしていると +10%（3つまで）。状態が20より悪いと走りません</p>`}
      <div class="mp-item" style="margin-top:8px">${st.pick.length ? `<b>えらんだ車両（${st.pick.length}）</b>：${st.pick.map(id => esc((d.cars.find(c => c.id === id) || {}).num || '')).join(' → ')}
          <div class="mp-row">${dep.kind === 'rail' ? `<input class="mp-inp" style="flex:1 1 120px" data-fname placeholder="編成番号（例：R1）" value="${esc(st.form ? (d.forms.find(f => f.id === st.form) || {}).name || '' : '')}"><button class="btn main" data-mkform>${st.form ? 'この順に組みかえる' : 'この順で編成にする'}</button>` : ''}</div>
          <div class="mp-row">${uni ? '' : `<button class="btn" data-w="ac">冷房をつける</button><button class="btn" data-w="heat">暖房をつける</button>${st.pick.every(id => (d.cars.find(c => c.id === id) || {}).role === 'Truck') ? '' : '<button class="btn" data-w="toilet">トイレをつける</button>'}`}
            <button class="btn" data-w="inspect">検査</button><button class="btn" data-w="renew">更新工事</button><button class="btn" data-move>${uni ? '回航' : '転属'}</button><button class="btn" data-scrap>${sea ? '廃船' : air ? '廃機' : '廃車'}</button>
            ${dep.kind === 'rail' && st.pick.every(id => { const c = d.cars.find(x => x.id === id); return c && !c.form && !c.xfer; }) ? '<button class="btn" data-give2>ゆずる</button>' : ''}<button class="btn" data-hist>車歴</button><button class="btn" data-clear>えらびなおす</button></div>`
        : air ? '<small class="muted">飛行機をタップしてえらぶと、検査・更新工事・回航（ほかの空港へ）・廃機ができます</small>'
        : sea ? '<small class="muted">船をタップしてえらぶと、検査・更新工事・回航（ほかの港へ）・廃船ができます</small>' : '<small class="muted">車両をタップしてえらぶと、編成・改造・検査・転属・廃車ができます。編成は、えらんだ順（先頭から）になります</small>'}</div>
      <h4 style="margin:14px 0 4px">メーカー</h4>
        <div class="mp-row"><select class="mp-inp" data-maker style="width:auto;max-width:100%"><option value="">${road ? '国のメーカー（定価・3時間で納車）' : sea ? '国の造船所（定価・24時間で納車）' : air ? '国の航空機メーカー（定価・48時間で納車）' : '国のメーカー（定価・6時間で納車）'}</option>${mks.map(x => `<option value="${x.id}" translate="no" ${st.maker === x.id ? 'selected' : ''}>${esc(x.name)}（${esc(x.who)}）・${esc(x.as === S.as ? T(`部品代 ${Math.round(x.parts * 100)}%`) : T(`定価の${Math.round(x.lv * 100)}%`))}・${esc(road ? T(`1日${x.capd}台`) : sea ? T(`1日${fmt(x.tpd)}t`) : T(`1日${x.capd}両`))}・${esc(T(`鉄鋼 ${x.steel}t`))}${x.wait ? '・' + esc(T(`待ち ${x.wait}時間`)) : ''}</option>`).join('')}</select></div>
        <p class="muted small" style="margin:2px 0 0">${air ? '飛行機は、いまは国の航空機メーカーだけです（1980年ごろの性能）' : sea ? (mks.length ? '造船所をえらぶと、その造船所の鉄鋼で船をつくります（納車は造船所が1日につくれる重さで順番に）。自分の造船所なら部品代だけ' : '造船所（人・会社の工場）は、まだありません。船は1980年ごろの性能です') : road ? (mks.length ? '自動車工場をえらぶと、その工場の鉄鋼でバス・トラックをつくります（納車は工場の1日につくれる台数で順番に）。自分の工場なら部品代だけ' : '自動車工場（人・会社の工場）は、まだありません。バス・トラックは1980年ごろの性能です')
          : (mks.length ? '鉄道車両工場をえらぶと、その工場の鉄鋼でつくります（納車は工場の1日につくれる両数で順番に）。自分の工場なら部品代だけ' : '鉄道車両工場（人・会社の工場）は、まだありません')}</p>
      ${dep.kind === 'rail' ? `<h4 style="margin:14px 0 4px">編成で注文する</h4>
        <div class="mp-row small" style="align-items:center"><span>形式を先頭から順に</span>${typeOpts.map(t => `<button class="btn" style="flex:none;padding:4px 10px" data-sq="${t.code}">${esc(t.label)}${t.face ? `<small>（${esc(T(t.face))}）</small>` : ''}</button>`).join('')}</div>
        <div class="mp-row small" style="align-items:center"><span>よく使う形</span>${[4, 6, 8, 10].map(n => `<button class="btn" style="flex:none;padding:4px 10px" data-sqn="${n}">${n}両</button>`).join('')}</div>
        <div class="mp-cars">${st.seq.map((code, i) => { const t = d.types.find(x => x.code === code) || {}; return `<span class="mp-car on" data-sqx="${i}"><b>${i + 1}</b> ${esc(t.label || code)}<span class="n">${t.face ? esc(T(t.face)) : esc(t.role || '')}</span></span>`; }).join('') || '<span class="muted small">形式をえらぶと、ここに先頭から並びます（タップで外す）</span>'}</div>
        <div class="mp-row" style="align-items:center"><input class="mp-inp" style="flex:1 1 120px" data-fno placeholder="編成番号（例：R1）"><label class="small" style="display:inline-flex;align-items:center;gap:4px"><span>×</span><input class="mp-inp mp-num" style="width:4em" data-fsets value="1" inputmode="numeric"><span>本まとめて</span></label><button class="btn main" data-ford ${st.seq.length ? '' : 'disabled'}>見つもって注文</button><button class="btn" data-sqc>えらびなおす</button></div>
        <p class="muted small" style="margin:2px 0 0">編成のきまり：両はしは運転台つきの Tc（奇数向きと偶数向き）、Mp が1両以上、M は Mp の数まで。まん中にも Tc を入れられます（中間封じ込め：運転台は使いません）。納車まで6時間</p>` : ''}
      <h4 style="margin:14px 0 4px">${sea ? '注文する（1隻から）' : air ? '注文する（1機から）' : '注文する（1両から）'}</h4>
      <select class="mp-inp" data-type>${typeOpts.map(t => `<option value="${t.code}">${esc(t.label)}${t.face ? '（' + esc(T(t.face)) + '）' : ''}・${X(t.price)}</option>`).join('')}</select>
      <p class="small muted" data-tnote style="margin:4px 0"></p>
      <div class="mp-row">${dep.kind === 'bus' ? '台数' : sea ? '隻数' : air ? '機数' : '両数'} <input class="mp-inp mp-num" type="number" min="1" max="${uni ? 4 : 20}" value="1" data-n> <button class="btn main" data-order>見つもって注文</button></div>
      <p class="muted small">${air ? `${esc(asName())}・納車まで飛行機は48時間（国の航空機メーカー）。機体の番号は形式ごとに順番につきます` : sea ? `${esc(asName())}・納車まで船は24時間（国の造船所）。船の名前は形式ごとに順番につきます` : `${esc(asName())}・納車まで電車は6時間、バスは3時間。車番は形式ごとに順番につきます`}</p>
      <div class="mp-row"><button class="btn" data-gone>廃車した車両</button></div>`, b => {
      const tnote = () => { const t = d.types.find(x => x.code === b.querySelector('[data-type]').value); if (!t) return; const s = (S.boot.series || []).find(x => x.code === t.series);
        b.querySelector('[data-tnote]').innerHTML = `${s ? `<span>${esc(s.name)}</span>：` : ''}<span>${esc(t.note)}</span><br>${t.role === 'Truck' ? `<span>長さ${t.len}m・積める重さ ${t.load}t・${t.mass}t</span>` : t.role === 'Ship' ? `<span>長さ${t.len}m・旅客${fmt(t.cap)}人</span>${t.load ? `<span>・車両 ${fmt(t.load)}t</span>` : ''}<span>・${fmt(t.mass)}総トン</span>`
          : t.role === 'Air' ? `<span>長さ${t.len}m・${fmt(t.cap)}席・${fmt(t.mass)}t</span><span>・滑走路${fmt(t.rwy)}m以上</span>` : `<span>長さ${t.len}m・定員${t.cap}人（座席${t.seats}）・${t.mass}t</span>`}${t.power ? `<span>・${t.power}kW</span>` : ''}<span>・最高${t.vmax}km/h・維持費 1日 ${fmt(t.upkeep)} X</span>`; };
      tnote(); b.querySelector('[data-type]').onchange = tnote;
      const mkSel = b.querySelector('[data-maker]'); if (mkSel) mkSel.onchange = () => { st.maker = Number(mkSel.value) || null; };
      const maker = () => mks.some(x => x.id === st.maker) ? st.maker : null;
      const mkLine = r => r.maker ? '\n' + T(`メーカー：${r.maker}（鉄鋼 ${r.steel}t）`) : '';
      b.querySelectorAll('[data-dep]').forEach(x => x.onclick = () => { st.dep = Number(x.dataset.dep); st.pick = []; st.form = null; draw(); });
      b.querySelectorAll('[data-car]').forEach(x => x.onclick = () => { const id = Number(x.dataset.car); const i = st.pick.indexOf(id); if (i >= 0) st.pick.splice(i, 1); else st.pick.push(id); draw(); });
      b.querySelectorAll('[data-reform]').forEach(x => x.onclick = () => { const f = Number(x.dataset.reform); st.form = f; st.pick = cars.filter(c => c.form === f).sort((a, c) => a.pos - c.pos).map(c => c.id); draw(); });
      b.querySelectorAll('[data-split]').forEach(x => x.onclick = async () => { if (confirm(T('この編成をばらしますか？（列車の運用からも外れます）')) && await api('mp_form_del', { p_form: Number(x.dataset.split), p_as: S.as }, 'ばらしました')) load(); });
      const q = k => b.querySelector(k);
      if (q('[data-clear]')) q('[data-clear]').onclick = () => { st.pick = []; st.form = null; draw(); };
      if (q('[data-mkform]')) q('[data-mkform]').onclick = async () => {
        const r = await api('mp_form_set', { p_form: st.form, p_cars: st.pick, p_name: q('[data-fname]').value, p_as: S.as });
        if (r) { toast(T(`編成にしました（加速 ${r.perf.acc}km/h/s・定員 ${fmt(r.perf.cap)}人）`) + (r.fee ? SEP() + T(`・組みかえ ${fmt(r.fee)} X`) : '')); st.pick = []; st.form = null; load(); }
      };
      b.querySelectorAll('[data-w]').forEach(x => x.onclick = async () => {
        const k = x.dataset.w, r = await api('mp_car_work', { p_cars: st.pick, p_kind: k, p_as: S.as, p_dry: true }); if (!r) return;
        const l1 = air ? `${r.n}機：${x.textContent}・${fmt(r.cost)} X・${r.hours}時間（そのあいだ飛べません）` : sea ? `${r.n}隻：${x.textContent}・${fmt(r.cost)} X・${r.hours}時間（そのあいだ走れません）` : `${r.n}両：${x.textContent}・${fmt(r.cost)} X・${r.hours}時間（そのあいだ走れません）`;
        if (!confirm(T(`${l1}${r.skip ? '\n（できない車両：' + r.skip + '）' : ''}`))) return;
        if (await api('mp_car_work', { p_cars: st.pick, p_kind: k, p_as: S.as, p_dry: false }, 'たのみました')) { st.pick = []; load(); }
      });
      if (q('[data-move]')) q('[data-move]').onclick = async () => {
        const others = deps.filter(x => x.id !== st.dep && x.kind === dep.kind);
        if (!others.length) return toast('ほかの車庫がありません');
        const name = prompt(T('うつす先の車庫の番号：\n') + others.map((x, i) => `${i + 1}. ${x.name}`).join('\n'), '1'); const to = others[Number(name) - 1]; if (!to) return;
        const r = await api('mp_car_move', { p_cars: st.pick, p_depot: to.id, p_as: S.as, p_dry: true }); if (!r) return;
        if (confirm(T(`「${to.name}」へ ${r.how}・${fmt(r.cost)} X・${r.hours}時間`)) && await api('mp_car_move', { p_cars: st.pick, p_depot: to.id, p_as: S.as, p_dry: false }, uni ? '回航します' : '転属します')) { st.pick = []; load(); }
      };
      if (q('[data-scrap]')) q('[data-scrap]').onclick = async () => {
        const r = await api('mp_car_scrap', { p_cars: st.pick, p_as: S.as, p_dry: true }); if (!r) return;
        if (confirm(T(air ? `${r.n}機を廃機にします（機体の登録がなくなります）。スクラップ代 ${fmt(r.back)} X がもどります` : sea ? `${r.n}隻を廃船にします（船籍がなくなります）。スクラップ代 ${fmt(r.back)} X がもどります` : `${r.n}両を廃車にします（車籍がなくなります）。スクラップ代 ${fmt(r.back)} X がもどります`))
            && await api('mp_car_scrap', { p_cars: st.pick, p_as: S.as, p_dry: false }, sea ? '廃船にしました' : air ? '廃機にしました' : '廃車にしました')) { st.pick = []; load(); }
      };
      b.querySelectorAll('[data-sq]').forEach(x => x.onclick = () => { if (st.seq.length >= 16) return toast('1編成は16両までです'); st.seq.push(x.dataset.sq); draw(); });
      b.querySelectorAll('[data-sqx]').forEach(x => x.onclick = () => { st.seq.splice(Number(x.dataset.sqx), 1); draw(); });
      b.querySelectorAll('[data-sqn]').forEach(x => x.onclick = () => {   // Tc（奇数向き）＋（Mp M）× k ＋ Tc（偶数向き）
        const by = (role, face) => (typeOpts.find(t => t.role === role && (face == null || t.face === face)) || {}).code;
        const tc1 = by('Tc', '奇数向き') || by('Tc'), tc2 = by('Tc', '偶数向き') || by('Tc'), mp = by('Mp'), mm = by('M');
        if (!tc1 || !tc2 || !mp) return toast('この形式ではつくれません');
        const k = (Number(x.dataset.sqn) - 2) / 2; st.seq = [tc1]; for (let i = 0; i < k; i++) { st.seq.push(mp); if (mm) st.seq.push(mm); else st.seq.push(mp); } st.seq.push(tc2); draw();
      });
      if (q('[data-sqc]')) q('[data-sqc]').onclick = () => { st.seq = []; draw(); };
      if (q('[data-ford]')) q('[data-ford]').onclick = async () => {
        const no = q('[data-fno]').value.trim(); if (!no) return toast('編成番号を入れてください');
        const sets = Math.round(Number(hw(q('[data-fsets]').value)) || 1);   // まとめて何本（2026-10-28）
        if (sets < 1 || sets > 20) return toast('本数は1〜20です');
        if (sets > 1) {
          const r = await api('mp_form_order_many', { p_types: st.seq, p_name: no, p_sets: sets, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
          if (!confirm(T(`${r.n}両編成を ${sets}本（${r.n_all}両）：${r.names.join('・')}\n${fmt(r.cost_all)} X（維持費 1日 ${fmt(r.upkeep_all)} X）。${r.hours}時間で納車`) + mkLine(r)
                       + (maker() ? '\n' + T('工場では1本ずつ順につくるので、あとの編成ほど納車がおそくなることがあります') : ''))) return;
          const x = await api('mp_form_order_many', { p_types: st.seq, p_name: no, p_sets: sets, p_depot: st.dep, p_as: S.as, p_dry: false, p_maker: maker() });
          if (x) { toast(T(`${x.sets}本を注文しました（${x.names[0]}〜${x.names[x.names.length - 1]}）`)); st.seq = []; load(); }
          return;
        }
        const r = await api('mp_form_order', { p_types: st.seq, p_name: no, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
        if (!confirm(T(`編成「${no}」${r.n}両：${r.nums.join('・')}\n${fmt(r.cost)} X（維持費 1日 ${fmt(r.upkeep)} X）。${r.hours}時間で納車`) + mkLine(r))) return;
        if (await api('mp_form_order', { p_types: st.seq, p_name: no, p_depot: st.dep, p_as: S.as, p_dry: false, p_maker: maker() }, '注文しました')) { st.seq = []; load(); }
      };
      b.querySelectorAll('[data-give]').forEach(x => x.onclick = () => giveForm(d.forms.find(f => f.id === Number(x.dataset.give)), load));
      if (q('[data-give2]')) q('[data-give2]').onclick = () => giveCars(st.pick.map(id => d.cars.find(c => c.id === id)).filter(Boolean), () => { st.pick = []; load(); });
      if (q('[data-hist]')) q('[data-hist]').onclick = async () => { const r = await api('mp_car_log', { p_cars: st.pick, p_as: S.as }); if (r) carLog('車歴', r); };
      q('[data-gone]').onclick = async () => { const r = await api('mp_cars_gone', { p_as: S.as }); if (r) carLog('廃車した車両', r); };
      q('[data-order]').onclick = async () => {
        const t = q('[data-type]').value, n = Number(q('[data-n]').value) || 1;
        const r = await api('mp_car_order', { p_type: t, p_n: n, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
        if (!confirm(T(`${r.nums.join('・')}\n${fmt(r.cost)} X（維持費 1日 ${fmt(r.upkeep)} X）。${r.hours}時間で納車`) + mkLine(r))) return;
        if (await api('mp_car_order', { p_type: t, p_n: n, p_depot: st.dep, p_as: S.as, p_dry: false, p_maker: maker() }, '注文しました')) load();
      };
    });
  };
  load();
}

/* ---- 学校と工場（t54k）：自分（名義）の学校・工場・田畑・港と、市場の値段 ---- */
async function openSC() {
  const m = modal(['施設と工場', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  const d = await api('mp_sc_list', { p_as: S.as }); if (!d) return m.close();
  const sum = (b, ks) => ks.reduce((a, k) => a + Number((b.day || {})[k] || 0), 0);
  const ui = b => FAC_UI[((S.boot.sck || {})[b.grp] || {}).use] || FAC_UI.school;
  const what = b => b.grp ? `<span>${ui(b).who} ${fmt(b.n || 0)} / ${fmt(b.cap || 0)}人</span>` : b.prod === 'railcar' ? '<span>鉄道車両</span>' : `<span>${esc(GN(b.prod))}</span>`;
  const stock = b => gSort(b.stock).map(([g, q]) => qG(g, q)).join('・');
  const tk = d.trk || {}, cap = (tk.load || 0) * (((S.boot.scr || {}).trk) || 300) / 24 * (1 + 0.1 * Math.min(3, tk.tt || 0));
  m.set('施設と工場', `<p class="small" style="margin:0 0 6px">${esc(asName())}</p>
    <div class="mp-item"><b>🚚 自分のトラック</b> <small><span>${fmt(tk.n || 0)}台</span>${tk.n ? `・<span>積める重さ ${fmt(tk.load || 0)}t</span>・<span>1時間に ${fmt(Math.round(cap))}t・km まで運べる</span>${tk.tt ? `・<span>トラックターミナル ${tk.tt}（+${Math.min(3, tk.tt) * 10}%）</span>` : ''}${tk.ok < tk.n ? `・<span class="mp-warn">走れない ${tk.n - tk.ok}台</span>` : ''}` : ''}</small>
      <small><br>${tk.n ? '自分の工場・田畑・港の荷物（仕入れ・お店への食品）は、運べるぶん運送費がかかりません' : 'トラックはバスの営業所で注文できます（≡ →「車両と編成」）。あると自分の荷物の運送費がかかりません'}</small></div>
    <div class="mp-list">${d.blds.map(b => `<div class="mp-item"><b>${esc(b.name || kindName(b.kind))}</b> <small><span>${esc(kindName(b.kind))}</span>${b.owner ? '' : '<span>（借りている）</span>'}</small>
        <small><br>${what(b)}・${b.op ? `<span>${esc(b.who || '')}</span>` : b.npc ? `<span>${b.grp ? ui(b).npc : '町の会社'}</span>` : '<span class="mp-warn">止まっています</span>'}${stock(b) ? `<br><span>在庫</span> ${stock(b)}` : ''}
        <br>${b.grp ? `<span>${ui(b).day} ${X(sum(b, ['fee']))}</span>` : `<span>24時間：売上 ${X(sum(b, ['sell', 'shop', 'mkt', 'rc']))}</span>・<span>費用 ${X(sum(b, ['buy', 'imp', 'ship', 'cost']))}</span>`}</small>
        <div class="mp-row"><button class="btn" data-go="${b.id}" data-xy="${b.x},${b.y}">地図で見る</button></div></div>`).join('')
      || '<p class="muted small">施設・工場はまだありません。自分の筆をタップ →「建物を建てる」の「学校」「宿泊」「医療・福祉」「娯楽」「工場」などから建てられます</p>'}</div>
    <h4 style="margin:12px 0 4px">市場の値段</h4>
    <div class="mp-kv">${GORDER.filter(k => (d.goods || {})[k]).map(k => { const g = d.goods[k]; return `<b>${esc(g.n)}</b><span>${X(g.p)}<small>（1${esc(g.u)}）</small></span>`; }).join('')}</div>
    <p class="muted small"><span>小麦（田畑）→ 製粉工場 → 食品工場 → お店</span><br><span>鉄鉱石（港）→ 製鉄所 → 自動車工場・鉄道車両工場</span><br><span>原油（港）→ 石油化学工場 → 半導体・家電工場</span><br>
      <span>材料は近くの在庫からトラックで（市場の値段＋運送費）。輸入は値段の1.2倍、売れのこりは市場へ 0.85倍。</span></p>`, b => {
    b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => { const [cx, cy] = x.dataset.xy.split(',').map(Number); m.close(); setCam((cx + 0.5) / 5, (cy + 0.5) / 5, Math.max(S.cam.z, 30)); openBld(Number(x.dataset.go)); });
  });
}

/* ---- 系統 ---- */
async function openRoutes() {
  const m = modal(['系統とダイヤ', '<p class="muted small">読みこんでいます…</p>']);
  const d = await api('mp_routes_list', { p_as: S.as }); if (!d) return;
  m.set('系統とダイヤ', `<div class="mp-list">${d.map(r => `<button class="mp-item" style="text-align:left" data-r="${r.id}">
      <b style="color:${esc(r.color)}">■</b> <b>${esc(r.name)}</b> <small><span>${r.kind === 'air' ? `空路・${r.km}km・便${r.trains}本` : r.kind === 'ship' ? `航路・${r.km}km・便${r.trains}本` : `${r.kind === 'rail' ? '鉄道' : 'バス'}・${r.km}km・列車${r.trains}本`}</span>${r.warn ? `<span class="mp-warn">・注意 ${r.warn}本</span>` : ''}${r.ok ? '' : '<span class="mp-warn">・走れません</span>'}${(r.thru || []).length ? `<span>・乗り入れ：${r.thru.map(esc).join('・')}</span>` : ''}</small><br>
      <small>${esc((r.stops || []).join(' → '))}</small>${r.last && r.last.revenue != null ? `<br><small><span>さいきんの1時間：${fmt(r.last.served || 0)}人・${X(r.last.revenue || 0)}・${r.last.tph || 0}本</span>${r.last.load != null ? `<span>・混み具合${r.last.load}%</span>` : ''}</small>` : ''}</button>`).join('')
      || '<p class="muted small">まだありません</p>'}</div>
    <div class="mp-row"><button class="btn main" data-new="rail">＋ 鉄道の系統</button><button class="btn main" data-new="bus">＋ バスの系統</button><button class="btn main" data-new="ship">＋ 航路（フェリー）</button><button class="btn main" data-new="air">＋ 空路（飛行機）</button></div>
    <p class="muted small"><span>系統は、止まる駅（バス停）を順にえらんでつくります。下りはその順、上りは逆の順に走ります。</span><span>航路は、港（フェリーターミナル）を順にえらぶと、海の上の道を自動でさがします。</span><span>空路は、空港を順にえらんでつくります（まっすぐ飛びます）</span></p>`, b => {
    b.querySelectorAll('[data-r]').forEach(x => x.onclick = () => { m.close(); openDia(Number(x.dataset.r)); });
    b.querySelectorAll('[data-new]').forEach(x => x.onclick = () => { m.close(); routeBuild(x.dataset.new, null); });
  });
}
// 系統をつくる・直す：地図で駅を順にタップ
function routeBuild(kind, edit) {
  if (kind === 'ship') return shipRouteBuild(edit);   // 航路（t54o）
  if (kind === 'air') return airRouteBuild(edit);     // 空路（t54p）
  setTool('look');
  const st = { kind, stops: edit ? edit.stops.map(s => ({ id: s.id, n: s.name })) : [], name: edit ? edit.name : '', color: edit ? edit.color : (kind === 'rail' ? '#d23' : '#1d7fd8'),
               timing: new Set(edit ? edit.timing : []), dwell: edit ? edit.dwell : (kind === 'rail' ? 30 : 20) };
  hint(kind === 'rail' ? '止まる駅を、順にタップしてください（自分の駅と、乗り入れの許可がある駅）' : '止まるバス停を、順にタップしてください');
  if (kind === 'rail') loadThru();
  S.tapHook = (x, y) => {
    const h = nearSta(x, y, 18, s => s.k === kind); if (!h || h.s.k !== kind) return toast(kind === 'rail' ? '駅をタップしてください' : 'バス停をタップしてください');
    if (kind === 'rail' && h.s.o !== myKey() && !thruHosts().has(h.s.o)) return toast('自分（この名義）の駅と、乗り入れの許可がある駅だけです（ほかの人・会社の駅は、タップ →「乗り入れを申請」）');
    if (kind === 'bus' && !h.s.mine && h.s.ln == null && !(edit && edit.stops.some(x => x.id === h.s.id))) return toast('このバス停は、持ち主が貸し出していません');
    if (st.stops.length && st.stops[st.stops.length - 1].id === h.s.id) return;
    st.stops.push({ id: h.s.id, n: h.s.n, x: h.s.fx, y: h.s.fy, ln: h.s.mine ? null : h.s.ln, o: h.s.o }); if (st.stops.length === 1 || st.stops.length === 2) st.timing.add(h.s.id); draw();
  };
  S.drawTool = (g, z) => {
    g.strokeStyle = st.color; g.lineWidth = 3; g.setLineDash([8, 6]); g.beginPath();
    let k = 0; for (const s of st.stops) { const it = S.vis && S.vis.stas.get(s.id); const x = it ? it.fx : s.x, y = it ? it.fy : s.y; if (x == null) continue; if (k++) g.lineTo(sx(x), sy(y)); else g.moveTo(sx(x), sy(y)); } g.stroke(); g.setLineDash([]);
  };
  S.toolEnd = () => { S.tapHook = null; };
  const draw = () => {
    sheet(`<h4>${edit ? '系統を直す' : kind === 'rail' ? '鉄道の系統をつくる' : 'バスの系統をつくる'}</h4>
      <div class="mp-row"><input class="mp-inp" style="flex:1 1 150px" data-nm placeholder="系統の名前（例：瑠璃本線）" value="${esc(st.name)}"><input type="color" data-col value="${esc(st.color)}" style="width:44px;height:36px;border:0;background:none"></div>
      <div class="mp-list">${st.stops.map((s, i) => `<div class="mp-item" style="display:flex;align-items:center;gap:6px"><b>${i + 1}.</b> ${esc(s.n)}${kind === 'bus' && s.ln != null ? ` <small class="muted">（借りる・1日 ${X(s.ln)}）</small>` : ''}${kind === 'rail' && s.o && s.o !== myKey() ? ' <small class="muted">（乗り入れ）</small>' : ''}
          <label class="small" style="margin-left:auto"><input type="checkbox" data-tm="${s.id}" ${st.timing.has(s.id) ? 'checked' : ''}> 採時駅</label><button class="btn" data-rm="${i}">×</button></div>`).join('') || '<p class="muted small">まだ駅がありません</p>'}</div>
      <div class="mp-row">停車時間 <input class="mp-inp mp-num" type="number" min="10" max="300" value="${st.dwell}" data-dw> 秒</div>
      <div class="mp-row"><button class="btn" data-cancel>キャンセル</button><button class="btn main" data-ok ${st.stops.length >= 2 ? '' : 'disabled'}>${edit ? 'この順に直す' : '系統をつくる'}（${esc(asName())}）</button></div>
      <p class="muted small">採時駅：時刻表に時刻を決めて出す駅（はじめ・終わりなど）。ほかの駅は、走る時間から自動で決まります</p>`, s => {
      s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
      s.querySelector('[data-col]').oninput = e => { st.color = e.target.value; S.dirty = true; };
      s.querySelector('[data-dw]').onchange = e => { st.dwell = Number(e.target.value) || 30; };
      s.querySelectorAll('[data-tm]').forEach(c => c.onchange = () => { const id = Number(c.dataset.tm); if (c.checked) st.timing.add(id); else st.timing.delete(id); });
      s.querySelectorAll('[data-rm]').forEach(c => c.onclick = () => { st.stops.splice(Number(c.dataset.rm), 1); draw(); S.dirty = true; });
      s.querySelector('[data-cancel]').onclick = () => setTool('look');
      s.querySelector('[data-ok]').onclick = async () => {
        st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('系統の名前をつけてください');
        let paths = null;
        if (kind === 'bus') { paths = await busPaths(st.stops.map(x => x.id)); if (!paths) return; }
        const r = await api('mp_route_save', { p_id: edit ? edit.id : null, p_kind: kind, p_name: st.name, p_color: st.color, p_stops: st.stops.map(x => x.id),
          p_timing: st.stops.map(x => x.id).filter(id => st.timing.has(id)), p_dwell: st.dwell, p_paths: paths, p_as: S.as });
        if (r) { toast(T(edit ? '直しました' : '系統をつくりました。列車を入れましょう') + (r.stopfee ? SEP() + T(`（バス停の使用料 1日 ${fmt(r.stopfee)} X）`) : '')); setTool('look'); openDia(r.id); }
      };
    });
    S.dirty = true;
  };
  S.onSheetClose = () => setTool('look');
  draw();
}
// バスの道すじ：道路のつながり（グラフ）から、いちばん短い道をさがす（画面で）
async function busPaths(ids) {
  const it = S.vis, stas = ids.map(id => it.stas.get(id));
  if (stas.some(s => !s)) { toast('バス停が見えるところまで地図を動かしてください'); return null; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of stas) { x0 = Math.min(x0, s.fx); y0 = Math.min(y0, s.fy); x1 = Math.max(x1, s.fx); y1 = Math.max(y1, s.fy); }
  x0 = Math.floor(x0 - 40); y0 = Math.floor(y0 - 40); x1 = Math.ceil(x1 + 40); y1 = Math.ceil(y1 + 40);
  if ((x1 - x0) * (y1 - y0) > 600 * 600) { toast('バス停どうしが遠すぎます（およそ30kmまで）'); return null; }
  toast('道をさがしています…');
  const segs = new Map();
  for (let y = y0; y < y1; y += 300) for (let x = x0; x < x1; x += 300) {
    const d = await api('mp_area', { p_x0: x, p_y0: y, p_x1: Math.min(x1, x + 300), p_y1: Math.min(y1, y + 300), p_lod: 0 }); if (!d) return null;
    for (const s of d.segs) if (s.k === 'road' && (s.c !== 'priv' || s.mine)) segs.set(s.id, s);
  }
  // 点 → つながる線
  const adj = new Map(); const addA = (n, s) => { if (n == null) return; let a = adj.get(n); if (!a) adj.set(n, a = []); a.push(s); };
  for (const s of segs.values()) { addA(s.n0, s); addA(s.n1, s); }
  const out = [];
  for (let i = 0; i + 1 < stas.length; i++) {
    const A = stas[i], B = stas[i + 1];
    if (A.seg === B.seg) { out.push([A.seg]); continue; }
    const sa = segs.get(A.seg), sb = segs.get(B.seg); if (!sa || !sb) { toast('バス停の道路が読めません'); return null; }
    // ダイクストラ（点ごと）：はじめは A の線の両はし
    const dist = new Map(), prev = new Map(), done = new Set(), pq = [];
    const push = (n, d, from) => { if (n == null) return; if (!dist.has(n) || d < dist.get(n)) { dist.set(n, d); prev.set(n, from); pq.push([d, n]); } };
    push(sa.n0, A.at, null); push(sa.n1, sa.len - A.at, null);
    let goal = null, best = Infinity;
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]); const [d, n] = pq.shift(); if (done.has(n)) continue; done.add(n);
      if (d >= best) break;
      if (n === sb.n0 && d + B.at < best) { best = d + B.at; goal = n; }
      if (n === sb.n1 && d + sb.len - B.at < best) { best = d + sb.len - B.at; goal = n; }
      for (const s of adj.get(n) || []) { if (s.id === sa.id || s.id === sb.id) continue; const m2 = s.n0 === n ? s.n1 : s.n0; push(m2, d + s.len, [n, s.id]); }
    }
    if (goal == null) { toast(`「${A.n}」から「${B.n}」への道が見つかりません`); return null; }
    const mid = []; for (let n = goal; prev.get(n); n = prev.get(n)[0]) mid.unshift(prev.get(n)[1]);
    out.push([A.seg, ...mid, B.seg]);
  }
  return out;
}

/* ---- ダイヤ ---- */
const warnH = w => String(w || '').split(' / ').filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('<br>');
const hms = s => { if (s == null) return ''; s = ((s % 86400) + 86400) % 86400; return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0'); };
const parseHM = t => { const m = String(t || '').trim().match(/^(\d{1,2})[:：]?(\d{2})(?:[:：](\d{2}))?$/); if (!m) return null; return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0); };
const KIND_COL = { 普通: '#222', 各停: '#222', 快速: '#e07020', 急行: '#d42', 特急: '#c0186a', 回送: '#999', 試運転: '#7b4fd8' };
const KINDS = ['普通', '快速', '急行', '特急', '回送', '試運転'];
const mdL = d => { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? T(`${Number(m[1])}月${Number(m[2])}日`) : ''; };   // 臨時列車の日付（10月25日）
const dayAdd = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const kindL = k => k === '普通' ? '各停' : k;   // 種別の見せ方（データは「普通」のまま）
async function openDia(rid) {
  const m = modal(['系統', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  let D = null, tab = 'dia';
  const lf = { kinds: new Set(), sers: new Set(), dirs: new Set(), sort: 'dep' };   // 列車一覧の絞り込み（空はぜんぶ）・並べ替え
  const load = async () => { D = await api('mp_dia', { p_route: rid }); if (!D) return m.close(); S.routeHi = { legs: D.legs, color: D.color, kind: D.kind }; S.dirty = true; draw(); };
  m.onclose = () => { S.routeHi = null; S.dirty = true; };
  const draw = () => {
    const idx = new Map(D.stops.map((s, i) => [s.id, i]));
    m.set(D.name, `<p class="small" style="margin:0"><b style="color:${esc(D.color)}">■</b> <span>${KIND_L[D.kind] || D.kind}</span>・<span>${esc(D.owner)}</span>・<span>${D.km[D.km.length - 1]}km・停車 ${D.dwell}秒</span>
        ${D.ok ? '' : `<br><span class="mp-warn"><span>走れません：</span> <span>${esc(D.why || '')}</span></span>`}${D.last && D.last.revenue != null ? (D.last.load != null && D.last.speed != null ? `<br>さいきんの1時間：${fmt(D.last.served || 0)}人・${X(D.last.revenue || 0)}・${D.last.tph}本・混み具合${D.last.load}%・平均${D.last.speed}km/h`
          : `<br><span>さいきんの1時間：${fmt(D.last.served || 0)}人・${X(D.last.revenue || 0)}・${D.last.tph || 0}本</span>`) : ''}</p>
      <div class="tabs-s" style="margin-top:8px">${[['dia', 'ダイヤグラム'], ['tt1', '時刻表（下り）'], ['tt2', '時刻表（上り）'], ['list', '列車']].map(t => `<button data-tab="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>
      <div data-pane style="margin-top:8px"></div>
      ${D.mine ? `<div class="mp-row"><button class="btn main" data-add>${D.kind === 'ship' || D.kind === 'air' ? '＋ 便' : '＋ 列車'}</button><button class="btn" data-bulk>＋ まとめて</button><button class="btn" data-auto>運用を自動で組む</button>
        <button class="btn" data-edit>${D.kind === 'air' ? '空港の順を直す' : D.kind === 'ship' ? '港の順・航路を直す' : '駅の順を直す'}</button><button class="btn" data-kp>種別と優先番号</button><button class="btn" data-pat>停車駅のパターン</button><button class="btn" data-fix>重なりを直す${(() => { const n = D.trains.filter(t => /とかさなります/.test(t.warn || '')).length; return n ? `<span>（${n}本）</span>` : ''; })()}</button>${D.kind === 'rail' ? `<button class="btn" data-xw>${D.xwait ? 'ほかの系統と待避・続行：オン' : 'ほかの系統と待避・続行：オフ'}</button>` : ''}<button class="btn" data-del>系統を消す</button></div>
        <div class="mp-row"><button class="btn" style="flex:none" data-undo ${D.undo ? '' : 'disabled'}>↶ 取り消す</button>${D.undo ? `<span class="small muted"><span>もどす：</span><span>${esc(D.undo.what)}</span><span>（${D.undo.n}回もどせます）</span></span>` : '<span class="small muted">もどせる操作はありません</span>'}</div>` : ''}`, b => {
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { tab = x.dataset.tab; draw(); });
      { const un = b.querySelector('[data-undo]'); if (un) un.onclick = async () => {
        if (!D.undo || !confirm(T('この操作を取り消して、その前のダイヤにもどしますか？') + '\n' + T(D.undo.what))) return;
        const r = await api('mp_dia_undo', { p_route: rid }); if (r) { toast(T('取り消しました') + SEP() + '（' + T(r.what) + '）'); load(); }
      }; }
      const pane = b.querySelector('[data-pane]');
      if (tab === 'dia') diaCanvas(pane, D, t => trainEdit(D, t, load));
      if (tab === 'tt1' || tab === 'tt2') pane.innerHTML = ttTable(D, tab === 'tt1' ? 1 : -1, idx);
      if (tab === 'list') {
        // 形式（編成の系列・両数）・種別・向きで絞りこむ。発車時刻・列車番号・種別・形式で並べかえる
        const serOf = t => t.fser ? t.fser + '|' + t.fn : '';   // 形式（系列）と両数
        const serH = k => { if (!k) return '<span>編成なし</span>'; const [a, n] = k.split('|'); return `<span>${esc(a)}</span>${D.kind === 'ship' || D.kind === 'air' ? '' : `・<span>${D.kind === 'bus' ? `${n}台` : `${n}両`}</span>`}`; };
        const ko = k => { const x = (D.kinds || []).find(y => y.name === k); return x ? x.prio * 100 + (KINDS.indexOf(k) + 1) : 999; };   // 優先番号の順
        const kinds = [...new Set(D.trains.map(t => t.kind))].sort((a, b) => ko(a) - ko(b) || a.localeCompare(b, 'ja'));
        const sers = [...new Set(D.trains.map(serOf))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'ja', { numeric: true }));
        for (const k of [...lf.kinds]) if (!kinds.includes(k)) lf.kinds.delete(k);
        for (const k of [...lf.sers]) if (!sers.includes(k)) lf.sers.delete(k);
        const pass = t => (!lf.kinds.size || lf.kinds.has(t.kind)) && (!lf.sers.size || lf.sers.has(serOf(t))) && (!lf.dirs.size || lf.dirs.has(t.dir));
        const byNum = (a, b) => String(a.num).localeCompare(String(b.num), 'ja', { numeric: true });
        const cmp = { dep: (a, b) => a.dep - b.dep || byNum(a, b), num: (a, b) => byNum(a, b) || a.dep - b.dep, kind: (a, b) => ko(a.kind) - ko(b.kind) || a.dep - b.dep,
                      ser: (a, b) => (serOf(a) === '') - (serOf(b) === '') || serOf(a).localeCompare(serOf(b), 'ja', { numeric: true }) || a.dep - b.dep }[lf.sort];
        const L = D.trains.filter(pass).sort(cmp);
        const chip = (g, v, label, on) => `<button data-${g}="${esc(String(v))}" class="${on ? 'on' : ''}">${label}</button>`;
        const row = (title, g, all, items) => `<div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">${title}</span><span class="mp-seg" style="flex-wrap:wrap">${chip(g, '*', 'すべて', !all.size)}${items.join('')}</span></div>`;
        pane.innerHTML = `${row('種別', 'fk', lf.kinds, kinds.map(k => chip('fk', k, `<span>${esc(kindL(k))}</span>`, lf.kinds.has(k))))}
          ${row('形式', 'fs', lf.sers, sers.map(k => chip('fs', k, serH(k), lf.sers.has(k))))}
          ${row('向き', 'fd', lf.dirs, [chip('fd', 1, '下り', lf.dirs.has(1)), chip('fd', -1, '上り', lf.dirs.has(-1))])}
          <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">並べかえ</span><select class="mp-inp" style="width:auto" data-sort>${[['dep', '発車時刻'], ['num', '列車番号'], ['kind', '種別'], ['ser', '形式']].map(o => `<option value="${o[0]}" ${lf.sort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
            <span class="muted">${L.length} / ${D.trains.length}本</span></div>
          <div class="mp-list">${L.map(t => `<button class="mp-item" style="text-align:left" data-t="${t.id}"><b>${esc(t.num)}</b> <span>${esc(kindL(t.kind))}・${t.dir === 1 ? '下り' : '上り'}・${hms(t.dep)}発</span>${t.day ? ` <small class="mp-tag"><span>臨時</span> <span>${mdL(t.day)}</span></small>` : ''}・${t.onum ? `<small class="muted"><span>運用</span> <span>${esc(t.onum)}</span></small> ` : ''}${t.fname ? `<span>${esc(t.fname)}</span>${t.fser ? `<small class="muted">（${serH(serOf(t))}）</small>` : ''}` : `<span class="mp-warn">${t.onum ? '運用に編成なし' : '編成なし'}</span>`}${cplL(t, D)}${taiL(t, D)}${t.warn ? `<br><small class="mp-warn">${warnH(t.warn)}</small>` : ''}</button>`).join('')
            || `<p class="muted small">${D.trains.length ? '条件にあう列車はありません' : '列車はまだありません'}</p>`}</div>`;
        const tog = (set, v) => { if (v === '*') set.clear(); else if (set.has(v)) set.delete(v); else set.add(v); draw(); };
        pane.querySelectorAll('[data-fk]').forEach(x => x.onclick = () => tog(lf.kinds, x.dataset.fk));
        pane.querySelectorAll('[data-fs]').forEach(x => x.onclick = () => tog(lf.sers, x.dataset.fs));
        pane.querySelectorAll('[data-fd]').forEach(x => x.onclick = () => tog(lf.dirs, x.dataset.fd === '*' ? '*' : Number(x.dataset.fd)));
        pane.querySelector('[data-sort]').onchange = e => { lf.sort = e.target.value; draw(); };
        pane.querySelectorAll('[data-t]').forEach(x => x.onclick = () => trainEdit(D, D.trains.find(t => t.id === Number(x.dataset.t)), load));
      }
      const q = k => b.querySelector(k);
      if (q('[data-add]')) q('[data-add]').onclick = () => trainEdit(D, null, load);
      if (q('[data-bulk]')) q('[data-bulk]').onclick = () => trainBulk(D, load);
      if (q('[data-auto]')) q('[data-auto]').onclick = () => autoForm(D, load);
      if (q('[data-edit]')) q('[data-edit]').onclick = () => { m.close(); routeBuild(D.kind, D); };
      if (q('[data-kp]')) q('[data-kp]').onclick = () => kindsEdit(D, load);
      if (q('[data-pat]')) q('[data-pat]').onclick = () => patEdit(D, load);
      if (q('[data-fix]')) q('[data-fix]').onclick = () => diaFix(D, load);
      if (q('[data-xw]')) q('[data-xw]').onclick = async () => {
        const on = !D.xwait;
        if (on && !confirm(T('ほかの系統（乗り入れてくる他社の列車もふくむ）の、優先番号の小さい列車にもゆずるようにしますか？（この系統の時刻が自動でずれます。相手の時刻は変わりません）'))) return;
        const r = await api('mp_route_xwait', { p_route: D.id, p_on: on, p_as: S.as }, on ? 'ほかの系統とも待避・続行するようにしました' : 'ほかの系統とは待避・続行しないようにしました');
        if (r) load();
      };
      if (q('[data-del]')) q('[data-del]').onclick = async () => { if (confirm(T('この系統と、列車をぜんぶ消しますか？')) && await api('mp_route_del', { p_id: D.id, p_as: S.as }, '消しました')) m.close(); };
    });
  };
  load();
}
// 重なりを直す（同じ駅・同じ番線に重なる列車）：番線をふりかえる・前の駅で待って時刻をずらす・両方。見つもってから。あとで「↶ 取り消す」でもどせる
function diaFix(D, reload) {
  const st = { mode: 'both', q: null, err: null, busy: false, seq: 0 };
  const MODES = [['trk', '番線をふりかえる'], ['time', '時刻をずらす'], ['both', '両方（ふりかえ → だめならずらす）']];
  const m = modal(['重なりを直す', ''], null);
  const quote = async () => {
    const my = ++st.seq; st.busy = true; st.q = null; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_dia_fix', { p_route: D.id, p_mode: st.mode, p_as: S.as, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.busy = false; st.q = q; st.err = err; draw();
  };
  const res = q => {
    if (!q.before) return '<p class="small">重なっている列車はありません</p>';
    if (!q.trk && !q.time) return `<p class="small"><span>重なっている列車 ${q.before}本</span>・<span class="mp-warn">この直し方では直せませんでした</span></p>
      <p class="muted small">空いている番線がないか、時刻をずらすと走れなくなる列車が出るか、15分より長く待たないと直らないところです。ほかの直し方か、駅の番線をふやすのをためしてください</p>`;
    return `<div class="mp-kv"><b>重なっている列車</b><span><span>${q.before}本 → ${q.after}本</span></span>
      ${q.trk ? `<b>番線のふりかえ</b><span>${q.trk}か所</span>` : ''}${q.time ? `<b>時刻のずらし</b><span><span>${q.time}か所</span>（<span>合計 ${mmss(q.delay)}</span>）</span>` : ''}
      ${q.bad0 || q.bad1 ? `<b>走れない列車</b><span>${q.bad0}本 → ${q.bad1}本</span>` : ''}</div>`;
  };
  const draw = () => m.set('重なりを直す', `<p class="small" style="margin-top:0">同じ駅の同じ番線に重なる列車を、この系統の列車をうごかして直します。ゆずるのは優先番号の大きい列車です（ほかの系統の列車と重なるときは、この系統の列車がゆずります）。</p>
    <div class="mp-row"><span class="mp-seg" style="flex-wrap:wrap">${MODES.map(([k, l]) => `<button data-m="${k}" class="${st.mode === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>
    <p class="muted small">${st.mode === 'time' ? '前の駅で待って、相手の列車が出てから着くようにします（始発駅なら発車をおくらせます）' : st.mode === 'trk' ? 'その向きで使える、空いている番線にうつします（本線から）' : 'まず空いている番線にうつし、なければ前の駅で待って時刻をずらします'}</p>
    <div data-res>${st.busy ? '<p class="muted small">見つもり中…（少しかかります）</p>' : st.err ? `<p class="mp-warn small">${esc(st.err)}</p>` : st.q ? res(st.q) : '<div class="mp-row"><button class="btn" data-est>見つもる</button><span class="muted small">どれだけ直るかを出してから、直せます</span></div>'}</div>
    <div class="mp-row"><button class="btn main" data-ok ${st.q && (st.q.trk || st.q.time) && !st.busy ? '' : 'disabled'}>この直し方で直す</button></div>
    <p class="muted small">直したあとも、ダイヤの「↶ 取り消す」でもとにもどせます。重なりの数がへらない・走れない列車がふえるところまでは直しません</p>`, b => {
    b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { if (st.mode === x.dataset.m) return; st.mode = x.dataset.m; st.seq++; st.busy = false; st.q = null; st.err = null; draw(); });
    { const e = b.querySelector('[data-est]'); if (e) e.onclick = () => quote(); }
    b.querySelector('[data-ok]').onclick = async () => {
      const r = await api('mp_dia_fix', { p_route: D.id, p_mode: st.mode, p_as: S.as, p_dry: false });
      if (!r) return;
      toast(T(`重なりを直しました（${r.before}本 → ${r.after}本）`)); m.close(); reload();
    };
  });
  draw();
}
// 列車の連結（一覧）：＋連結 A02（なか〜ひがし）。つながないものは、わけも
function cplL(t, D) {
  const cx = t.cplx || []; if (!cx.length) return '';
  const nm = id => (D.stops.find(s => s.id === id) || {}).name || '';
  const s0 = t.sched && t.sched.length ? t.sched[0][0] : null, s1 = t.sched && t.sched.length ? t.sched[t.sched.length - 1][0] : null;
  return '<br><small>' + cx.map(c => `<span class="${c.ok ? '' : 'mp-warn'}">＋<span>連結</span> <span translate="no">${esc(c.num || '')}</span>${c.v && (c.a !== s0 || c.b !== s1) ? `（<span translate="no">${esc(nm(c.a))}</span>〜<span translate="no">${esc(nm(c.b))}</span>）` : ''}${c.ok ? '' : `：<span>${esc(c.w || '')}</span>`}</span>`).join(' ') + '</small>';
}
// 待避・続行（一覧）：待避 みどり：先に通す列車 201（1分12秒）／続行 あさひ：前の列車 102（40秒）
const mmss = n => n >= 60 ? (n % 60 ? T(`${Math.floor(n / 60)}分${n % 60}秒`) : T(`${Math.floor(n / 60)}分`)) : T(`${n}秒`);
function taiL(t, D) {
  const x = t.tai || []; if (!x.length) return '';
  const nm = id => (D.stops.find(s => s.id === id) || {}).name || '';
  return '<br><small class="muted">' + x.map(a => `<span>${a.f ? '続行' : '待避'}</span> <span translate="no">${esc(nm(a.s))}</span>：<span>${a.f ? '前の列車' : '先に通す列車'}</span> <span translate="no">${(a.by || []).map(esc).join('・')}</span>（<span>${esc(mmss(a.sec))}</span>）`).join('<br>') + '</small>';
}
// 種別と優先番号（0 がいちばん優先。名義ごと）。種別を足す・消す
function kindsEdit(D, reload) {
  const L = (D.kinds || []).map(k => ({ ...k }));
  const m = modal(['種別と優先番号', '']);
  const draw = () => m.set('種別と優先番号', `<div class="mp-list">${L.map((k, i) => `<div class="mp-row small" style="align-items:center;margin-top:4px">
      <b style="min-width:5em;color:${KIND_COL[k.name] || '#2a7'}">${esc(kindL(k.name))}</b>
      <select class="mp-inp" style="width:auto" data-kp="${i}">${Array.from({ length: 10 }, (_, n) => `<option value="${n}" ${k.prio === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      ${k.std ? '' : `<button class="btn" style="flex:none" data-kx="${i}">×</button>`}</div>`).join('')}</div>
    <div class="mp-row"><input class="mp-inp" style="flex:1 1 120px" data-kn placeholder="種別を足す（例：準急）" maxlength="8"><button class="btn" data-ka>足す</button></div>
    <div class="mp-row"><button class="btn main" data-ok>決める</button></div>
    <p class="muted small">優先番号は 0 がいちばん優先（0〜9）。優先番号の大きい列車は、待避できる駅で優先番号の小さい列車に先をゆずります（待避）。追いつく列車は、前の列車のあとを走ります（続行）。同じ番号なら、先に出る列車が先です。${esc(asName())}のぜんぶの系統で使います</p>`, b => {
    b.querySelectorAll('[data-kp]').forEach(x => x.onchange = () => { L[Number(x.dataset.kp)].prio = Number(x.value); });
    b.querySelectorAll('[data-kx]').forEach(x => x.onclick = () => { L.splice(Number(x.dataset.kx), 1); draw(); });
    b.querySelector('[data-ka]').onclick = () => {
      const nm = b.querySelector('[data-kn]').value.trim(); if (!nm) return toast('種別の名前を入れてください');
      if (L.some(k => k.name === nm)) return toast('その種別はもうあります');
      L.push({ name: nm, prio: 4, std: false, add: true }); draw();
    };
    b.querySelector('[data-ok]').onclick = async () => {
      const r = await api('mp_kinds_set', { p_items: L.map(k => ({ name: k.name, prio: k.prio })), p_as: S.as }, '決めました');
      if (r) { m.close(); if (reload) reload(); }
    };
  });
  draw();
}
// 停車駅のパターン（t54h）：種別ごとに通過する駅。列車をつくるとき・まとめてつくるとき・種別を変えたときに使う
function patEdit(D, reload, kind0) {
  const ks = (D.kinds || []).length ? D.kinds.map(k => k.name) : KINDS.slice();
  let kind = kind0 || ks.find(k => (D.pats || {})[k]) || ks.find(k => k !== '普通') || ks[0];
  let skip = new Set((D.pats || {})[kind] || []);
  const m = modal(['停車駅のパターン', '']);
  const draw = () => {
    // 止まらない駅（2026-10-29）：端の駅も通過にできる。止まる最初の駅が始発、最後の駅が終着（その外は走らない）
    const has = (D.pats || {})[kind] != null, ss = D.stops, ia = ss.findIndex(s => !skip.has(s.id)), ib = ss.length - 1 - ss.slice().reverse().findIndex(s => !skip.has(s.id));
    m.set('停車駅のパターン', `<div class="mp-row" style="align-items:center"><span>種別</span><select class="mp-inp" style="flex:1 1 140px" data-pk>${ks.map(k => `<option value="${esc(k)}" ${k === kind ? 'selected' : ''}>${esc(kindL(k))}${(D.pats || {})[k] ? ' ✓' : ''}</option>`).join('')}</select></div>
      <div class="mp-cars">${ss.map((s, i) => { const out = i < ia || i > ib; return `<span class="mp-car ${skip.has(s.id) ? '' : 'on'}" data-ps="${s.id}"${out ? ' style="opacity:.5"' : ''}><span translate="no">${esc(s.name)}</span><span class="n">${!skip.has(s.id) ? '停車' : out ? '走らない' : '通過'}</span></span>`; }).join('')}</div>
      <div class="mp-row"><button class="btn main" data-ok>決める</button><button class="btn" data-ap>決めて、この種別の列車にも当てはめる</button>${has ? '<button class="btn" data-px>パターンを消す</button>' : ''}</div>
      <p class="muted small">駅をタップして停車・通過を切りかえます。端の駅を通過にすると、停車する最初の駅が始発、最後の駅が終着になります（その外は走りません）。列車をつくるとき・まとめてつくるとき・列車の種別を変えたときに、このパターンになります</p>`, b => {
      b.querySelector('[data-pk]').onchange = e => { kind = e.target.value; skip = new Set((D.pats || {})[kind] || []); draw(); };
      b.querySelectorAll('[data-ps]').forEach(x => x.onclick = () => { const id = Number(x.dataset.ps);
        if (skip.has(id)) skip.delete(id); else { if (ss.filter(z => !skip.has(z.id)).length <= 2) return toast('止まる駅は2つ以上いります'); skip.add(id); } draw(); });
      const save = async apply => {
        const r = await api('mp_route_pat', { p_route: D.id, p_kind: kind, p_skip: [...skip], p_apply: apply, p_as: S.as });
        if (!r) return; D.pats = r.pats; toast(apply ? T(`決めました（列車 ${r.n}本に当てはめました）`) : T('決めました')); if (apply && reload) reload(); else draw();
      };
      b.querySelector('[data-ok]').onclick = () => save(false);
      b.querySelector('[data-ap]').onclick = () => save(true);
      if (b.querySelector('[data-px]')) b.querySelector('[data-px]').onclick = async () => { const r = await api('mp_route_pat', { p_route: D.id, p_kind: kind, p_skip: null, p_apply: false, p_as: S.as }, '消しました'); if (r) { D.pats = r.pats; skip = new Set(); draw(); } };
    });
  };
  draw();
}
function ttTable(D, dir, idx) {
  const ord = dir === 1 ? D.stops : D.stops.slice().reverse();
  const trs = D.trains.filter(t => t.dir === dir).sort((a, b) => a.dep - b.dep);
  if (!trs.length) return '<p class="muted small">列車はまだありません</p>';
  const cell = (t, s) => {
    const e = (t.sched || []).find(x => x[0] === s.id);
    if (!e) { const i0 = t.sched.length ? idx.get(t.sched[0][0]) : -1, i1 = t.sched.length ? idx.get(t.sched[t.sched.length - 1][0]) : -1, i = idx.get(s.id);
      return (Math.min(i0, i1) < i && i < Math.max(i0, i1)) ? '<span class="muted">レ</span>' : '<span class="muted">‥</span>'; }
    const tm = D.timing.includes(s.id);
    return `<span style="${tm ? 'font-weight:800' : ''}">${e[2] != null ? hms(e[2]) : hms(e[1]) + '着'}</span>${tm && e[3] ? `<br><small class="muted">${e[3]}番</small>` : ''}`;
  };
  return `<div class="mp-scroll"><table class="mp-tt"><tr><th></th>${trs.map(t => `<th style="color:${KIND_COL[t.kind] || '#222'}">${esc(t.num)}<br>${esc(kindL(t.kind))}${t.day ? `<br><small>${mdL(t.day)}</small>` : ''}</th>`).join('')}</tr>
    ${ord.map(s => `<tr><td class="st">${esc(s.name)}${D.timing.includes(s.id) ? ' ◎' : ''}</td>${trs.map(t => `<td>${cell(t, s)}</td>`).join('')}</tr>`).join('')}
    <tr><td class="st">運用</td>${trs.map(t => `<td><small>${t.onum ? esc(t.onum) : '—'}</small></td>`).join('')}</tr>
    <tr><td class="st">編成</td>${trs.map(t => `<td><small>${t.fname ? esc(t.fname) : '—'}</small></td>`).join('')}</tr>
    <tr><td class="st">両数</td>${trs.map(t => `<td><small>${t.fn ? t.fn + (t.cplx || []).filter(c => c.ok).map(c => '+' + c.n).join('') : '—'}</small></td>`).join('')}</tr></table></div><p class="muted small">◎ 採時駅（太字の時刻）・レ 通過・日付があるのは臨時列車（その日だけ）</p>`;
}
// ダイヤグラム（よこ：時刻・たて：駅）。ドラッグでよこに動く・ピンチでよこに拡大
function diaCanvas(pane, D, onTrain) {
  pane.innerHTML = `<canvas class="mp-dia"></canvas><p class="muted small" style="margin:4px 0 0">よこにドラッグで動かす・2本指でよこに拡大・列車の線をタップで編集（一点鎖線は臨時列車・灰色の点線は編成なし・太い線は連結している区間）</p>`;
  const cv = pane.querySelector('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const km = D.km.map(Number), tot = Math.max(0.1, km[km.length - 1]);
  const V = { t0: 5 * 3600, sec: 19 * 3600 };
  const ML = 78, MT = 16, MB = 22;
  const draw = () => {
    const W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const X = t => ML + (t - V.t0) / V.sec * (W - ML - 8), Y = k => MT + k / tot * (H - MT - MB);
    g.font = '11px system-ui, sans-serif'; g.textBaseline = 'middle';
    // 時刻のめもり
    const stepM = V.sec > 12 * 3600 ? 60 : V.sec > 4 * 3600 ? 30 : V.sec > 3600 ? 10 : 2;
    for (let t = Math.ceil(V.t0 / (stepM * 60)) * stepM * 60; t <= V.t0 + V.sec; t += stepM * 60) {
      const x = X(t); g.strokeStyle = t % 3600 === 0 ? '#bbb' : '#eee'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, MT); g.lineTo(x, H - MB); g.stroke();
      if (t % 3600 === 0 || stepM <= 10) { g.fillStyle = '#666'; g.textAlign = 'center'; g.fillText(t % 3600 === 0 ? T(String(Math.floor(t / 3600) % 24) + '時') : String(Math.floor(t / 60) % 60), x, H - 9); }
    }
    // 駅
    D.stops.forEach((s, i) => { const y = Y(km[i]); g.strokeStyle = D.timing.includes(s.id) ? '#888' : '#ddd'; g.beginPath(); g.moveTo(ML, y); g.lineTo(W - 8, y); g.stroke();
      g.fillStyle = '#222'; g.textAlign = 'right'; g.fillText(s.name, ML - 6, y); });
    // 列車
    const idx = new Map(D.stops.map((s, i) => [s.id, i]));
    D.paths = [];
    for (const t of D.trains) {
      const pts = [], at = new Map();   // 駅 → [着の点, 発の点]
      for (const e of t.sched || []) { const k = km[idx.get(e[0])], i0 = pts.length; if (e[1] != null) pts.push([X(e[1]), Y(k)]); if (e[2] != null) pts.push([X(e[2]), Y(k)]); at.set(e[0], [i0, pts.length - 1]); }
      if (pts.length < 2) continue;
      g.strokeStyle = t.form && !t.warn ? (KIND_COL[t.kind] || '#222') : t.form ? '#d23' : '#aaa'; g.lineWidth = 1.4; g.setLineDash(!t.form ? [4, 3] : t.day ? [9, 3, 2, 3] : []);
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.setLineDash([]);
      // 連結している区間は太く
      for (const c of t.cplx || []) {
        const a = c.ok && at.get(c.a), b = c.ok && at.get(c.b); if (!a || !b) continue;
        g.lineWidth = 3.4; g.beginPath(); for (let i = a[1]; i <= b[0]; i++) { if (i === a[1]) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1]); } g.stroke();
      }
      D.paths.push([t, pts]);
    }
  };
  let P = new Map(), pin = null, dr = null, moved = false;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, e.clientX); moved = false;
    if (P.size === 1) dr = { x: e.clientX, t0: V.t0 }; else if (P.size === 2) { const [a, b] = [...P.values()]; pin = { d: Math.abs(a - b), sec: V.sec, mid: (a + b) / 2, t0: V.t0 }; dr = null; } });
  cv.addEventListener('pointermove', e => { if (!P.has(e.pointerId)) return; P.set(e.pointerId, e.clientX); const W = cv.clientWidth - ML - 8;
    if (pin && P.size >= 2) { const [a, b] = [...P.values()]; const f = pin.d / Math.max(20, Math.abs(a - b)); const r = cv.getBoundingClientRect();
      const tm = pin.t0 + (pin.mid - r.left - ML) / W * pin.sec; V.sec = clamp(pin.sec * f, 1800, 24 * 3600); V.t0 = clamp(tm - (pin.mid - r.left - ML) / W * V.sec, 0, 86400 - V.sec); moved = true; draw(); return; }
    if (dr) { const dx = e.clientX - dr.x; if (Math.abs(dx) > 5) moved = true; V.t0 = clamp(dr.t0 - dx / W * V.sec, 0, 86400 - V.sec); draw(); } });
  const up = e => { P.delete(e.pointerId); if (P.size < 2) pin = null;
    if (dr && !moved && e.type === 'pointerup' && D.mine) { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 10;
      for (const [t, pts] of D.paths || []) for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let u = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0; u = clamp(u, 0, 1); const d = Math.hypot(x - a[0] - dx * u, y - a[1] - dy * u); if (d < bd) { bd = d; best = t; } }
      if (best) onTrain(best); }
    if (!P.size) dr = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); const W = cv.clientWidth - ML - 8, r = cv.getBoundingClientRect(), mx = e.clientX - r.left - ML;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) V.t0 = clamp(V.t0 + e.deltaX / W * V.sec, 0, 86400 - V.sec);
    else { const tm = V.t0 + mx / W * V.sec; V.sec = clamp(V.sec * Math.exp(e.deltaY * 0.002), 1800, 86400); V.t0 = clamp(tm - mx / W * V.sec, 0, 86400 - V.sec); } draw(); }, { passive: false });
  requestAnimationFrame(draw);
}
// 列車を1本つくる・直す
// 運用のえらび方：運用（o:id）・運用に入っていない編成（f:id。その編成の運用をつくる）・なし
// 種別のえらびかた：はじめからの種別と、自分で足した種別（優先番号つき）
function kindOpts(D, cur) {
  const ks = (D.kinds || []).length ? D.kinds.map(k => k.name) : KINDS.slice();
  if (cur && !ks.includes(cur)) ks.push(cur);
  const pr = k => { const x = (D.kinds || []).find(y => y.name === k); return x ? x.prio : null; };
  return ks.map(k => `<option value="${esc(k)}" ${cur === k ? 'selected' : ''}>${esc(pr(k) != null ? T(`${kindL(k)}（優先番号 ${pr(k)}）`) : kindL(k))}</option>`).join('');
}
async function trainEdit(D, t, reload) {
  if (!D.mine) return;
  const cl = await api('mp_cars_list', { p_as: S.as }); if (!cl) return;
  const forms = cl.forms.filter(f => fKind(f) === D.kind);
  const tm = D.stops.filter(s => D.timing.includes(s.id));
  const ops = (D.ops || []).slice();
  const st = t ? { ...t, tt: { ...(t.tt || {}) }, skip: new Set(t.skip || []), opv: t.op ? 'o:' + t.op : '', day: t.day || null, cpl: (t.cpl || []).map(c => ({ op: c.op, a: c.a, b: c.b })), sa: t.sa || null, sb: t.sb || null }
               : { dir: 1, num: '', kind: D.kind === 'rail' ? '普通' : '', dep: 7 * 3600, opv: '', day: null, tt: {}, skip: new Set(), cpl: [], sa: null, sb: null };
  // 止まる駅（2026-10-29）：st.on = 止まる駅。止まる最初の駅が始発、最後の駅が終着（その外は走らない・あいだの止まらない駅は通過）
  const ordOf = d => d === 1 ? D.stops : D.stops.slice().reverse();
  const ends = o => { const a = o.findIndex(s => st.on.has(s.id)), z = o.length - 1 - o.slice().reverse().findIndex(s => st.on.has(s.id)); return [a, z]; };
  { const o = ordOf(st.dir); let a = st.sa ? o.findIndex(s => s.id === st.sa) : 0, z = st.sb ? o.findIndex(s => s.id === st.sb) : o.length - 1;
    if (a < 0) a = 0; if (z < 0 || z <= a) z = o.length - 1;
    st.on = new Set(o.filter((s, i) => i === a || i === z || (i > a && i < z && !st.skip.has(s.id))).map(s => s.id)); }
  const m = modal([t ? `列車 ${t.num}` : '列車をつくる', '']);
  const bus = D.kind !== 'rail', ship = D.kind === 'ship' || D.kind === 'air', air = D.kind === 'air';   // バス・船・飛行機は連結しない
  // 停車駅のパターンを当てはめる：いまの走る区間のうち、パターンで通過でない駅に止まる
  const applyPat = P => { const o = ordOf(st.dir), [a, z] = ends(o), nw = new Set(o.slice(a, z + 1).filter(s => !P.has(s.id)).map(s => s.id));
    if (nw.size < 2) { toast(T('パターンの止まる駅が、走る区間に2つ以上ありません')); return; } st.on = nw; };
  const opL = o => esc(o.fname ? T(ship ? `${o.num}（${o.fname}）` : bus ? `${o.num}（${o.fname}・${o.n}台）` : `${o.num}（${o.fname}・${o.n}両）`) : T(`${o.num}（編成なし）`));
  const fL = f => esc(T(ship ? `${f.name}（${f.perf.len}m）` : bus ? `${f.name}（${f.perf.n}台・${f.perf.len}m）` : `${f.name}（${f.perf.n}両・${f.perf.len}m）`));
  const draw = () => {
    const ord = st.dir === 1 ? D.stops : D.stops.slice().reverse();
    const op = st.opv.startsWith('o:') ? ops.find(o => o.id === Number(st.opv.slice(2))) : null, fo = st.opv.startsWith('f:') ? forms.find(f => f.id === Number(st.opv.slice(2))) : null;
    // 走る区間（途中始発・途中止まり）：ord の ia 番目（止まる最初の駅）から ib 番目（止まる最後の駅）まで
    const [ia, ib] = ends(ord);
    const sec = ord.slice(ia, ib + 1), secIds = new Set(sec.map(s => s.id)), tmS = tm.filter(s => secIds.has(s.id));
    const freeF = forms.filter(f => !f.op), mid = sec.slice(1, -1);
    // 連結：つなぐ運用（この列車の運用はのぞく）・つなぐ駅・切りはなす駅（走る順）
    const cops = sel => `<option value="">${esc(T('（運用をえらぶ）'))}</option>` + ops.filter(o => 'o:' + o.id !== st.opv).map(o => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${opL(o)}</option>`).join('');
    const cplH = bus ? '' : `<h4 style="margin:10px 0 4px">連結</h4>
      ${st.cpl.map((c, i) => { const cx = t && t.cplx && t.cplx[i] && t.cplx[i].op === c.op ? t.cplx[i] : null; return `<div class="mp-item small" style="margin-bottom:6px">
        <div class="mp-row" style="margin-top:0;align-items:center"><select class="mp-inp" style="flex:1 1 140px" data-co="${i}">${cops(c.op)}</select><button class="btn" style="flex:none" data-cx="${i}">×</button></div>
        <div class="mp-row" style="align-items:center"><select class="mp-inp" style="flex:1 1 110px" data-ca="${i}"><option value="">${esc(T('始発からつなぐ'))}</option>${mid.map(s => `<option value="${s.id}" ${c.a === s.id ? 'selected' : ''}>${esc(T(`${s.name}でつなぐ`))}</option>`).join('')}</select>
          <select class="mp-inp" style="flex:1 1 110px" data-cb="${i}"><option value="">${esc(T('終点まで'))}</option>${mid.map(s => `<option value="${s.id}" ${c.b === s.id ? 'selected' : ''}>${esc(T(`${s.name}で切りはなす`))}</option>`).join('')}</select></div>
        ${cx ? (cx.ok ? `<small class="muted"><span>${cx.n}両をつなぎます</span></small>` : `<small class="mp-warn">${esc(cx.w || '')}</small>`) : ''}</div>`; }).join('')}
      ${st.cpl.length < 3 ? '<div class="mp-row" style="margin-top:0"><button class="btn" data-cadd>＋ 連結する運用</button></div>' : ''}
      <p class="muted small">ほかの運用の編成を、この列車につなぎます（3つ・16両まで）。とちゅうの駅でつなぐ・切りはなすこともできます。つなぐ駅には、その編成が2分前までに着いていないとつながりません</p>`;
    m.set(t ? `列車 ${t.num}` : '列車をつくる', `
      <div class="mp-row"><input class="mp-inp" style="flex:1 1 90px" data-num placeholder="列車番号" value="${esc(st.num)}">
        <select class="mp-inp" style="flex:1 1 90px" data-kind>${kindOpts(D, st.kind)}</select>
        <span class="mp-seg"><button data-dir="1" class="${st.dir === 1 ? 'on' : ''}">下り</button><button data-dir="-1" class="${st.dir === -1 ? 'on' : ''}">上り</button></span></div>
      ${ord.length > 2 ? `<div class="mp-row" style="align-items:center"><span>走る区間</span><select class="mp-inp" style="flex:1 1 110px" data-sa>${ord.slice(0, ib).map((s, i) => `<option value="${i === 0 ? '' : s.id}" ${i === ia ? 'selected' : ''}>${esc(i === 0 ? T(`${s.name}（系統の端）`) : s.name)}</option>`).join('')}</select><span>→</span>
        <select class="mp-inp" style="flex:1 1 110px" data-sb>${ord.slice(ia + 1).map((s, i) => { const k = ia + 1 + i; return `<option value="${k === ord.length - 1 ? '' : s.id}" ${k === ib ? 'selected' : ''}>${esc(k === ord.length - 1 ? T(`${s.name}（系統の端）`) : s.name)}</option>`; }).join('')}</select></div>
        ${ia > 0 || ib < ord.length - 1 ? `<p class="small muted" style="margin:0 0 4px">${ia > 0 ? '<span>途中始発</span>' : ''}${ia > 0 && ib < ord.length - 1 ? '・' : ''}${ib < ord.length - 1 ? '<span>途中止まり</span>' : ''}</p>` : ''}` : ''}
      <div class="mp-row">始発（${esc(ord[ia].name)}）の発車 <input class="mp-inp mp-num" data-dep value="${hms(st.dep)}"></div>
      <div class="mp-row" style="align-items:center"><span>走る日</span><span class="mp-seg"><button data-day="0" class="${st.day ? '' : 'on'}">毎日</button><button data-day="1" class="${st.day ? 'on' : ''}">この日だけ（臨時）</button></span>
        ${st.day ? `<input class="mp-inp" style="width:auto" type="date" data-dt value="${esc(st.day)}" min="${esc(D.today)}" max="${esc(dayAdd(D.today, 60))}">` : ''}</div>
      <div class="mp-row" style="align-items:center"><span>運用</span><select class="mp-inp" style="flex:1 1 160px" data-op><option value="">（運用なし・編成なし）</option>
          ${ops.length ? `<optgroup label="${esc(T('運用'))}">${ops.map(o => `<option value="o:${o.id}" ${st.opv === 'o:' + o.id ? 'selected' : ''}>${opL(o)}</option>`).join('')}</optgroup>` : ''}
          ${freeF.length ? `<optgroup label="${esc(T('運用に入っていない編成（その編成の運用をつくる）'))}">${freeF.map(f => `<option value="f:${f.id}" ${st.opv === 'f:' + f.id ? 'selected' : ''}>${fL(f)}</option>`).join('')}</optgroup>` : ''}
          <option value="new">${esc(T('＋ 新しい運用…'))}</option></select></div>
      <p class="small muted" style="margin:0 0 4px">${op ? (op.fname ? `<span>この列車は 運用 ${esc(op.num)} の編成「${esc(op.fname)}」で走ります</span>` : `<span class="mp-warn">運用 ${esc(op.num)} には編成が入っていません（≡ →「運用」で入れられます）</span>`)
        : fo ? `<span>編成「${esc(fo.name)}」の運用をつくって入れます</span>` : '<span>編成がない列車は走りません</span>'}</p>
      ${cplH}
      <h4 style="margin:10px 0 4px">採時駅の時刻・番線</h4>
      ${tmS.map(s => { const v = st.tt[s.id] || {}; return `<div class="mp-row"><b style="min-width:5em">${esc(s.name)}</b>到着<input class="mp-inp mp-num" data-a="${s.id}" value="${v.a != null ? hms(v.a) : ''}" placeholder="—">
          発車<input class="mp-inp mp-num" data-d="${s.id}" value="${v.d != null ? hms(v.d) : ''}" placeholder="—">
          <select class="mp-inp" style="width:auto" data-tr="${s.id}"><option value="">${esc(T('番線（いつもの）'))}</option>${Array.from({ length: s.tracks }, (_, i) => `<option ${v.t === i + 1 ? 'selected' : ''} value="${i + 1}">${esc(s.trk && s.trk[i] ? trkL(s.trk[i], i) : T(`${i + 1}番線`))}</option>`).join('')}</select></div>`; }).join('')}
      <p class="muted small">空のところは、走る時間から自動で決まります（いちばん早い時刻）。遅くするときだけ入れます</p>
      ${ord.length > 2 ? `<h4 style="margin:10px 0 4px">${air ? '寄る空港' : ship ? '寄る港' : '止まる駅'}${(D.pats || {})[st.kind] ? ` <button class="btn" style="padding:2px 8px;font-size:12px" data-pat1>${esc(T(`「${kindL(st.kind)}」のパターンにする`))}</button>` : ''}</h4><div class="mp-cars">${ord.map((s, i) => { const on = st.on.has(s.id), out = i < ia || i > ib;
          return `<span class="mp-car ${on ? 'on' : ''}" data-sk="${s.id}"${out ? ' style="opacity:.5"' : ''}>${esc(s.name)}<span class="n">${on ? (i === ia ? (ship ? '出発' : '始発') : i === ib ? (ship ? '到着' : '終着') : '停車') : out ? (ship ? '寄らない' : '走らない') : '通過'}</span></span>`; }).join('')}</div>
        <p class="muted small" style="margin:4px 0 0">${ship ? 'タップして、寄る・寄らないを切りかえます。寄る最初のところが出発、最後のところが到着になります' : '駅をタップして、停車・通過を切りかえます。停車する最初の駅が始発、最後の駅が終着になります'}</p>` : ''}
      ${t && t.warn ? `<p class="mp-warn">${warnH(t.warn)}</p>` : ''}
      <p class="muted small">回送・試運転はお客を乗せません</p>
      <div class="mp-row">${t ? '<button class="btn" data-del>消す</button>' : ''}<button class="btn main" data-ok>${t ? '保存' : 'つくる'}</button></div>`, b => {
      const q = k => b.querySelector(k);
      const keep = () => {
        st.num = q('[data-num]').value; st.kind = q('[data-kind]').value; st.dep = parseHM(q('[data-dep]').value) ?? st.dep;
        if (q('[data-dt]')) st.day = q('[data-dt]').value || st.day;
        st.cpl = st.cpl.map((c, i) => q(`[data-co="${i}"]`) ? { op: Number(q(`[data-co="${i}"]`).value) || null, a: Number(q(`[data-ca="${i}"]`).value) || null, b: Number(q(`[data-cb="${i}"]`).value) || null } : c);
        for (const s of tm) { if (!q(`[data-a="${s.id}"]`)) continue; const a = parseHM(q(`[data-a="${s.id}"]`).value), d = parseHM(q(`[data-d="${s.id}"]`).value), r = q(`[data-tr="${s.id}"]`).value;
          const o = {}; if (a != null) o.a = a; if (d != null) o.d = d; if (r) o.t = Number(r); if (Object.keys(o).length) st.tt[s.id] = o; else delete st.tt[s.id]; }
      };
      b.querySelectorAll('[data-dir]').forEach(x => x.onclick = () => { keep(); st.dir = Number(x.dataset.dir); draw(); });   // 止まる駅はそのまま（向きだけ逆）
      b.querySelectorAll('[data-day]').forEach(x => x.onclick = () => { keep(); st.day = x.dataset.day === '1' ? (st.day || D.today) : null; draw(); });
      // 走る区間をえらびなおす：外になった駅は走らない、新しく入った駅は停車
      if (q('[data-sa]')) {
        q('[data-sa]').onchange = e => { keep(); const v = Number(e.target.value) || null, na = v ? ord.findIndex(s => s.id === v) : 0;
          ord.forEach((s, i) => { if (i < na) st.on.delete(s.id); else if (i < ia) st.on.add(s.id); }); st.on.add(ord[na].id); draw(); };
        q('[data-sb]').onchange = e => { keep(); const v = Number(e.target.value) || null, nb = v ? ord.findIndex(s => s.id === v) : ord.length - 1;
          ord.forEach((s, i) => { if (i > nb) st.on.delete(s.id); else if (i > ib) st.on.add(s.id); }); st.on.add(ord[nb].id); draw(); };
      }
      q('[data-kind]').onchange = () => { keep(); const p = (D.pats || {})[st.kind]; if (p) applyPat(new Set(p)); draw(); };   // 停車駅のパターン
      if (q('[data-pat1]')) q('[data-pat1]').onclick = () => { keep(); applyPat(new Set((D.pats || {})[st.kind] || [])); draw(); };
      q('[data-op]').onchange = async e => {
        keep();
        if (e.target.value === 'new') {
          const nm = prompt(T('新しい運用の運用番号（例：A01）'), '');
          const r = nm && await api('mp_op_save', { p_id: null, p_num: nm, p_form: null, p_note: '', p_kind: D.kind, p_as: S.as });
          if (r) { ops.push({ id: r.id, num: nm.trim(), form: null, fname: null, n: 0 }); st.opv = 'o:' + r.id; }
        } else st.opv = e.target.value;
        draw();
      };
      b.querySelectorAll('[data-sk]').forEach(x => x.onclick = () => { keep(); const id = Number(x.dataset.sk);
        if (st.on.has(id)) { if (st.on.size <= 2) return toast(ship ? '寄るところは2つ以上いります' : '止まる駅は2つ以上いります'); st.on.delete(id); } else st.on.add(id); draw(); });
      if (q('[data-cadd]')) q('[data-cadd]').onclick = () => { keep(); st.cpl.push({ op: null, a: null, b: null }); draw(); };
      b.querySelectorAll('[data-cx]').forEach(x => x.onclick = () => { keep(); st.cpl.splice(Number(x.dataset.cx), 1); draw(); });
      if (q('[data-del]')) q('[data-del]').onclick = async () => { if (await api('mp_train_del', { p_ids: [t.id], p_as: S.as }, '消しました')) { m.close(); reload(); } };
      q('[data-ok]').onclick = async () => {
        keep(); if (!st.num.trim()) return toast('列車番号を入れてください');
        const pop = st.opv.startsWith('o:') ? Number(st.opv.slice(2)) : null, pf = st.opv.startsWith('f:') ? Number(st.opv.slice(2)) : null;
        // 止まる最初の駅が始発・最後の駅が終着（系統の端なら null）。あいだの止まらない駅が通過
        const sa = ia > 0 ? ord[ia].id : null, sb = ib < ord.length - 1 ? ord[ib].id : null, skip = ord.slice(ia + 1, ib).filter(s => !st.on.has(s.id)).map(s => s.id);
        const r = await api('mp_train_save', { p_id: t ? t.id : null, p_route: D.id, p_dir: st.dir, p_num: st.num, p_kind: st.kind, p_dep: st.dep, p_form: pf, p_tt: st.tt, p_skip: skip, p_as: S.as,
          p_op: pop, p_day: st.day || null, p_cpl: bus ? [] : st.cpl.filter(c => c.op).map(c => ({ op: c.op, a: c.a || null, b: c.b || null })), p_sa: sa, p_sb: sb });
        if (r) { toast(r.warn || (r.cplx || []).some(c => !c.ok) ? '保存しました（注意があります）' : '保存しました'); m.close(); reload(); }
      };
    });
  };
  draw();
}
function trainBulk(D, reload) {
  const ops = D.ops || [];
  const m = modal(['まとめて列車をつくる', `
    <div class="mp-row"><span class="mp-seg"><button data-dir="1" class="on">下り</button><button data-dir="-1">上り</button></span>
      <select class="mp-inp" style="width:auto" data-kind>${kindOpts(D, '普通')}</select></div>
    <p class="small muted" data-pn style="margin:0 0 4px"></p>
    ${D.stops.length > 2 ? '<div class="mp-row" style="align-items:center" data-sec></div>' : ''}
    <div class="mp-row"><label class="small">はじめの列車 <input class="mp-inp mp-num" data-from value="06:00"></label> <label class="small">さいごの列車 <input class="mp-inp mp-num" data-to value="23:00"></label> <label class="small">何分おき <input class="mp-inp mp-num" type="number" data-ev value="10" min="2" max="240"></label></div>
    <div class="mp-row"><input class="mp-inp" data-pre placeholder="列車番号の頭（例：A。なくてもよい）"></div>
    <div class="mp-row" style="align-items:center"><span>走る日</span><span class="mp-seg"><button data-day="0" class="on">毎日</button><button data-day="1">この日だけ（臨時）</button></span>
      <input class="mp-inp" style="width:auto" type="date" data-dt value="${esc(D.today)}" min="${esc(D.today)}" max="${esc(dayAdd(D.today, 60))}" hidden></div>
    ${ops.length ? `<div class="mp-row" style="align-items:center"><span>運用</span><select class="mp-inp" style="flex:1 1 160px" data-op><option value="">（運用なし。あとで「運用を自動で組む」）</option>${ops.map(o => `<option value="${o.id}">${o.fname ? `${esc(o.num)}（${esc(o.fname)}）` : esc(T(`${o.num}（編成なし）`))}</option>`).join('')}</select></div>` : ''}
    <div class="mp-row"><button class="btn main" data-ok>つくる</button></div>
    <p class="muted small">編成はあとで「運用を自動で組む」でわりあてられます。1つの運用に入れると、その運用の編成がぜんぶ走ります（間にあわない列車には注意が出ます）</p>`], b => {
    let dir = 1, day = false;
    // 走る区間（途中始発・途中止まり）：向きを変えると、えらびなおし
    const secH = () => { const e = b.querySelector('[data-sec]'); if (!e) return; const ord = dir === 1 ? D.stops : D.stops.slice().reverse(), n = ord.length;
      e.innerHTML = `<span>走る区間</span><select class="mp-inp" style="flex:1 1 110px" data-sa>${ord.slice(0, -1).map((s, i) => `<option value="${i === 0 ? '' : s.id}">${esc(i === 0 ? T(`${s.name}（系統の端）`) : s.name)}</option>`).join('')}</select><span>→</span>
        <select class="mp-inp" style="flex:1 1 110px" data-sb>${ord.slice(1).map((s, i) => `<option value="${i === n - 2 ? '' : s.id}" ${i === n - 2 ? 'selected' : ''}>${esc(i === n - 2 ? T(`${s.name}（系統の端）`) : s.name)}</option>`).join('')}</select>`; };
    secH();
    const pn = () => { const k = b.querySelector('[data-kind]').value, p = (D.pats || {})[k];
      // パターンで端の駅を通過にしているとき：止まる最初の駅 → 最後の駅（走る順）
      const ord = dir === 1 ? D.stops : D.stops.slice().reverse(), on = p ? ord.filter(s => !p.includes(s.id)) : ord, cut = on.length >= 2 && (on[0] !== ord[0] || on[on.length - 1] !== ord[ord.length - 1]);
      const i0 = on.length >= 2 ? ord.indexOf(on[0]) : 0, i1 = on.length >= 2 ? ord.indexOf(on[on.length - 1]) : ord.length - 1, pass = p ? ord.slice(i0 + 1, i1).filter(s => p.includes(s.id)) : [];
      b.querySelector('[data-pn]').innerHTML = p ? `<span>${esc(T(`停車駅は「${kindL(k)}」のパターン`))}</span>：${pass.length ? `<span>通過</span> <span translate="no">${pass.map(x => esc(x.name)).join('・')}</span>` : '<span>各駅に停車</span>'}${cut ? `<br><span>走る区間</span> <span translate="no">${esc(on[0].name)} → ${esc(on[on.length - 1].name)}</span>` : ''}`
        : `<span>${esc(T(`「${kindL(k)}」の停車駅のパターンはありません（各駅に停車）`))}</span>`; };
    pn(); b.querySelector('[data-kind]').onchange = pn;
    b.querySelectorAll('[data-dir]').forEach(x => x.onclick = () => { dir = Number(x.dataset.dir); b.querySelectorAll('[data-dir]').forEach(y => y.classList.toggle('on', y === x)); secH(); pn(); });
    b.querySelectorAll('[data-day]').forEach(x => x.onclick = () => { day = x.dataset.day === '1'; b.querySelectorAll('[data-day]').forEach(y => y.classList.toggle('on', y === x)); b.querySelector('[data-dt]').hidden = !day; });
    b.querySelector('[data-ok]').onclick = async () => {
      const opv = b.querySelector('[data-op]') ? b.querySelector('[data-op]').value : '';
      const r = await api('mp_train_bulk', { p_route: D.id, p_dir: dir, p_from: parseHM(b.querySelector('[data-from]').value), p_to: parseHM(b.querySelector('[data-to]').value),
        p_every: Number(b.querySelector('[data-ev]').value), p_kind: b.querySelector('[data-kind]').value, p_prefix: b.querySelector('[data-pre]').value, p_form: null, p_as: S.as,
        p_op: opv ? Number(opv) : null, p_day: day ? (b.querySelector('[data-dt]').value || D.today) : null,
        p_sa: b.querySelector('[data-sa]') ? Number(b.querySelector('[data-sa]').value) || null : null, p_sb: b.querySelector('[data-sb]') ? Number(b.querySelector('[data-sb]').value) || null : null });
      if (r) { toast(T(`${r.n}本つくりました`)); m.close(); reload(); }
    };
  });
}
async function autoForm(D, reload) {
  const cl = await api('mp_cars_list', { p_as: S.as }); if (!cl) return;
  const forms = cl.forms.filter(f => fKind(f) === D.kind);
  if (!forms.length) return toast(D.kind === 'air' ? '飛行機がありません（≡ →「車両と編成」で空港をえらんで注文してください）' : D.kind === 'ship' ? '船がありません（≡ →「車両と編成」で港をえらんで注文してください）' : '編成がありません（車両と編成で組んでください）');
  const pick = new Set(forms.filter(f => f.trains === 0 || D.trains.some(t => t.form === f.id)).map(f => f.id));
  // わりあてる列車（2026-10-29）：種別でえらぶ（毎日の列車。臨時列車はそのまま）。えらばなかった種別の列車はいまのまま
  const daily = D.trains.filter(t => !t.day);
  const ko = k => { const x = (D.kinds || []).find(y => y.name === k); return x ? x.prio * 100 + (KINDS.indexOf(k) + 1) : 999; };   // 優先番号の順
  const kinds = [...new Set(daily.map(t => t.kind))].sort((a, b) => ko(a) - ko(b) || a.localeCompare(b, 'ja'));
  const ks = new Set(kinds);
  // 編成の絞りこみ：両数（台数）・形式。表示中をぜんぶえらぶ・ぜんぶはずす
  const counted = D.kind === 'rail' || D.kind === 'bus', unit = D.kind === 'bus' ? '台' : '両';
  const serN = c => ((S.boot && S.boot.series) || []).find(x => x.code === c)?.name || c || '';
  const ns = [...new Set(forms.map(f => f.perf.n))].sort((a, b) => a - b), sers = [...new Set(forms.map(f => f.perf.series || ''))].filter(Boolean).sort();
  let fn = null, fsr = null;
  const m = modal(['運用を自動で組む', '']);
  const draw = () => {
    const vis = forms.filter(f => (fn == null || f.perf.n === fn) && (fsr == null || f.perf.series === fsr)), nT = daily.filter(t => ks.has(t.kind)).length;
    const allK = ks.size === kinds.length, busyF = new Set(allK ? [] : daily.filter(t => !ks.has(t.kind) && t.form).map(t => t.form));   // えらばなかった種別の列車に入っている編成（使わない）
    const elsewhere = f => f.trains > D.trains.filter(t => t.form === f.id).length;   // ほかの系統の列車にも入っている編成（「ぜんぶえらぶ」ではえらばない）
    m.set('運用を自動で組む', `<p class="small" style="margin-top:0">この系統の列車に、えらんだ編成をわりあてます（始発駅にいて、2分前にあいている編成）</p>
      <h4 style="margin:8px 0 4px">わりあてる列車</h4>
      ${kinds.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>種別</span><span class="mp-seg" style="flex-wrap:wrap">${kinds.map(k => `<button data-ak="${esc(k)}" class="${ks.has(k) ? 'on' : ''}"><span>${esc(kindL(k))}</span>（${daily.filter(t => t.kind === k).length}）</button>`).join('')}</span></div>` : ''}
      <p class="small muted" style="margin:2px 0"><span>${nT}本の列車をわりあてなおします</span>${allK ? '' : SEP() + '<span>（えらばなかった種別の列車は、いまのまま）</span>'}</p>
      <h4 style="margin:10px 0 4px">使う編成</h4>
      ${counted && ns.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>${unit === '台' ? '台数' : '両数'}</span><span class="mp-seg" style="flex-wrap:wrap"><button data-an="" class="${fn == null ? 'on' : ''}">すべて</button>${ns.map(n => `<button data-an="${n}" class="${fn === n ? 'on' : ''}">${T(`${n}${unit}`)}</button>`).join('')}</span></div>` : ''}
      ${sers.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>形式</span><span class="mp-seg" style="flex-wrap:wrap"><button data-as="" class="${fsr == null ? 'on' : ''}">すべて</button>${sers.map(c => `<button data-as="${esc(c)}" class="${fsr === c ? 'on' : ''}"><span translate="no">${esc(serN(c))}</span></button>`).join('')}</span></div>` : ''}
      <div class="mp-row small" style="align-items:center"><button class="btn" data-aall ${vis.some(f => !busyF.has(f.id) && !elsewhere(f)) ? '' : 'disabled'}>表示中をぜんぶえらぶ</button><button class="btn" data-anone ${pick.size ? '' : 'disabled'}>ぜんぶはずす</button><b><span>${pick.size}${D.kind === 'ship' ? '隻' : D.kind === 'air' ? '機' : '編成'}えらんでいます</span></b></div>
      <div class="mp-cars">${vis.map(f => `<span class="mp-car ${pick.has(f.id) ? 'on' : ''}" data-f="${f.id}"${busyF.has(f.id) ? ' style="opacity:.55"' : ''}>${esc(f.name)}<span class="n">${D.kind === 'ship' || D.kind === 'air' ? `便${f.trains}本` : D.kind === 'bus' ? `${f.perf.n}台・列車${f.trains}本` : `${f.perf.n}両・列車${f.trains}本`}${busyF.has(f.id) ? '<br><span>ほかの種別で使用中</span>' : elsewhere(f) ? '<br><span>ほかの系統で使用中</span>' : ''}</span></span>`).join('') || '<p class="muted small">この絞りこみにあう編成はありません</p>'}</div>
      <div class="mp-row"><button class="btn main" data-ok ${nT && pick.size ? '' : 'disabled'}>わりあてる</button></div>
      <p class="muted small"><span>「表示中をぜんぶえらぶ」では、ほかの系統で使用中の編成はえらびません（えらぶときはタップ）。</span>${allK ? '' : SEP() + '<span>えらばなかった種別の列車に入っている編成は使いません（種別ごとに、ちがう編成をわりあてるとき）。</span>'}</p>`, b => {
      b.querySelectorAll('[data-ak]').forEach(x => x.onclick = () => { const k = x.dataset.ak; if (ks.has(k)) { if (ks.size > 1) ks.delete(k); } else ks.add(k); draw(); });
      b.querySelectorAll('[data-an]').forEach(x => x.onclick = () => { fn = x.dataset.an === '' ? null : Number(x.dataset.an); draw(); });
      b.querySelectorAll('[data-as]').forEach(x => x.onclick = () => { fsr = x.dataset.as === '' ? null : x.dataset.as; draw(); });
      b.querySelector('[data-aall]').onclick = () => { for (const f of vis) if (!busyF.has(f.id) && !elsewhere(f)) pick.add(f.id); draw(); };
      b.querySelector('[data-anone]').onclick = () => { pick.clear(); draw(); };
      b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => { const id = Number(x.dataset.f); if (pick.has(id)) pick.delete(id); else pick.add(id); draw(); });
      b.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_train_autoform', { p_route: D.id, p_forms: [...pick], p_as: S.as, p_kinds: allK ? null : [...ks] });
        if (r) { toast(T(`${r.ok}本にわりあてました（${r.used}編成）`) + (r.none ? SEP() + T(`・${r.none}本は編成が足りません`) : '') + (r.busy ? SEP() + T(`・${r.busy}編成はほかの種別の列車に入っているので使いませんでした`) : '')); m.close(); reload(); }
      };
    });
  };
  draw();
}

/* ---- 運用：運用番号・編成・列車の数。運用ファイル（JSON）の書き出し・読みこみ ---- */
function saveJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const ymd = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
async function openOps() {
  const m = modal(['運用', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  let D = null, kind = 'rail', flt = 'all';
  const sel = new Set();   // まとめて消す・編集する運用（2026-10-28）
  const load = async () => { D = await api('mp_ops_list', { p_as: S.as }); if (!D) return m.close(); for (const id of [...sel]) if (!D.ops.some(o => o.id === id)) sel.delete(id); draw(); };
  // 絞りこみ：走れない列車がある・注意がある・編成なし・列車なし
  const FLT = [['all', 'すべて', () => true], ['bad', '走れない列車あり', o => o.bad > 0], ['warn', '注意あり', o => o.warn > 0], ['noform', '編成なし', o => !o.form], ['empty', '列車なし', o => !o.trains]];
  const exportOps = async (ids, name) => { const r = await api('mp_op_export', { p_ops: ids, p_as: S.as }); if (r) { saveJson(name, r); toast('書き出しました'); } };
  const draw = () => {
    const LK = D.ops.filter(o => o.kind === kind), fx = (FLT.find(f => f[0] === flt) || FLT[0])[2], L = LK.filter(fx), forms = D.forms.filter(f => fKind(f) === kind);
    const nsel = LK.filter(o => sel.has(o.id)).length;
    m.set('運用', `<p class="small" style="margin:0">${esc(asName())}</p>
      <div class="tabs-s" style="margin-top:6px">${[['rail', '鉄道'], ['bus', 'バス'], ['ship', '船'], ['air', '飛行機']].map(t => `<button data-kind="${t[0]}" class="${kind === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>
      <div class="mp-row small" style="align-items:center"><span class="mp-seg" style="flex-wrap:wrap">${FLT.map(f => `<button data-flt="${f[0]}" class="${flt === f[0] ? 'on' : ''}"><span>${f[1]}</span>${f[0] === 'all' ? '' : `（${LK.filter(f[2]).length}）`}</button>`).join('')}</span></div>
      <div class="mp-row small" style="align-items:center"><button class="btn" data-sall ${L.length ? '' : 'disabled'}>表示中をぜんぶえらぶ</button>${nsel ? `<button class="btn" data-snone>えらぶのをやめる</button><b><span>${nsel}つ えらんでいます</span></b>
        <button class="btn main" data-bedit>まとめて編集</button><button class="btn" data-bex>書き出す</button><button class="btn" data-bdel>まとめて消す</button>` : '<span class="muted">運用の左の □ でえらぶと、まとめて消す・編集できます</span>'}</div>
      <div class="mp-list" style="margin-top:8px">${L.map(o => `<div class="mp-item">
          <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-sel="${o.id}" ${sel.has(o.id) ? 'checked' : ''}><b>${esc(o.num)}</b></label> <small class="muted"><span>列車 ${o.trains}本</span>${o.daily !== o.trains ? `<span>（臨時 ${o.trains - o.daily}本）</span>` : ''}${o.cpl ? `<span>・連結 ${o.cpl}本</span>` : ''}${o.first != null ? `<span>・${hms(o.first)}〜${hms(o.last)}</span>` : ''}${o.routes.length ? `<span>・</span><span>${o.routes.map(esc).join('・')}</span>` : ''}</small>
          ${o.bad ? `<small class="mp-warn">・<span>走れない列車 ${o.bad}本</span></small>` : ''}${o.warn ? `<small class="mp-warn">・<span>注意 ${o.warn}本</span></small>` : ''}${o.note ? `<br><small>${esc(o.note)}</small>` : ''}
          <div class="mp-row small" style="align-items:center"><span>編成</span><select class="mp-inp" style="flex:1 1 140px" data-of="${o.id}"><option value="">（入れない）</option>${forms.map(f => `<option value="${f.id}" ${o.form === f.id ? 'selected' : ''} ${f.ok ? '' : 'disabled'}>${esc(T(f.op && f.op !== o.num ? (kind === 'ship' || kind === 'air' ? `${f.name}・いまは運用 ${f.op}` : kind === 'bus' ? `${f.name}（${f.perf.n}台）・いまは運用 ${f.op}` : `${f.name}（${f.perf.n}両）・いまは運用 ${f.op}`) : kind === 'ship' || kind === 'air' ? f.name : kind === 'bus' ? `${f.name}（${f.perf.n}台）` : `${f.name}（${f.perf.n}両）`))}</option>`).join('')}</select>
            <button class="btn" data-oren="${o.id}">運用番号</button><button class="btn" data-oex="${o.id}">書き出す</button><button class="btn" data-odel="${o.id}">消す</button></div></div>`).join('')
        || (LK.length ? '<p class="muted small">この絞りこみにあう運用はありません</p>' : '<p class="muted small">まだありません。「＋ 運用」でつくるか、系統の「運用を自動で組む」でつくれます</p>')}</div>
      <div class="mp-row"><button class="btn main" data-onew>＋ 運用</button><button class="btn" data-oall>ぜんぶ書き出す</button><button class="btn" data-oimp>ファイルを読みこむ</button>
        <input type="file" accept=".json,application/json" data-ofile hidden></div>
      <p class="muted small">列車は運用に入れ、運用に編成を入れます。編成を変えると、その運用の列車ぜんぶの編成が変わります（ほかの運用に入っていた編成は、そちらからはずれます）。運用ファイル（JSON）を読みこむと、ファイルにある運用の列車が、ファイルの列車に入れかわります${D.free ? `<span>（運用に入っていない列車 ${D.free}本）</span>` : ''}</p>`, b => {
      b.querySelectorAll('[data-kind]').forEach(x => x.onclick = () => { kind = x.dataset.kind; draw(); });
      b.querySelectorAll('[data-flt]').forEach(x => x.onclick = () => { flt = x.dataset.flt; draw(); });
      b.querySelectorAll('[data-sel]').forEach(x => x.onchange = () => { const id = Number(x.dataset.sel); if (x.checked) sel.add(id); else sel.delete(id); draw(); });
      b.querySelector('[data-sall]').onclick = () => { for (const o of L) sel.add(o.id); draw(); };
      { const e = b.querySelector('[data-snone]'); if (e) e.onclick = () => { for (const o of LK) sel.delete(o.id); draw(); }; }
      const ids = () => LK.filter(o => sel.has(o.id)).map(o => o.id);
      { const e = b.querySelector('[data-bex]'); if (e) e.onclick = () => exportOps(ids(), `運用_${ids().length}_${ymd()}.json`); }
      { const e = b.querySelector('[data-bdel]'); if (e) e.onclick = async () => {
        const n = ids().length; if (!confirm(T(`えらんだ運用 ${n}つ を消しますか？（列車は消えずに、運用なし・編成なしになります）`))) return;
        const r = await api('mp_ops_bulk', { p_ids: ids(), p_act: 'del', p_arg: {}, p_as: S.as }); if (r) { toast(T(`運用を ${r.n}つ 消しました`)); sel.clear(); load(); }
      }; }
      { const e = b.querySelector('[data-bedit]'); if (e) e.onclick = () => opsBulkEdit(ids(), kind, load); }
      b.querySelectorAll('[data-of]').forEach(x => x.onchange = async () => {
        const o = D.ops.find(y => y.id === Number(x.dataset.of)), fid = x.value ? Number(x.value) : null;
        const r = await api('mp_op_save', { p_id: o.id, p_num: o.num, p_form: fid, p_note: o.note, p_kind: o.kind, p_as: S.as });
        if (r) toast(T('編成を変えました') + (r.moved_from ? SEP() + T(`（運用 ${r.moved_from} からうつしました）`) : ''));
        load();
      });
      b.querySelectorAll('[data-oren]').forEach(x => x.onclick = async () => {
        const o = D.ops.find(y => y.id === Number(x.dataset.oren)); const nm = prompt(T('運用番号（例：A01）'), o.num); if (!nm) return;
        if (await api('mp_op_save', { p_id: o.id, p_num: nm, p_form: o.form, p_note: o.note, p_kind: o.kind, p_as: S.as }, '変えました')) load();
      });
      b.querySelectorAll('[data-oex]').forEach(x => x.onclick = () => { const o = D.ops.find(y => y.id === Number(x.dataset.oex)); return exportOps([o.id], `運用_${o.num}_${ymd()}.json`); });
      b.querySelectorAll('[data-odel]').forEach(x => x.onclick = async () => {
        const o = D.ops.find(y => y.id === Number(x.dataset.odel));
        if (confirm(T(`運用 ${o.num} を消しますか？（列車は消えずに、運用なし・編成なしになります）`)) && await api('mp_op_del', { p_id: o.id, p_as: S.as }, '消しました')) load();
      });
      b.querySelector('[data-onew]').onclick = async () => {
        const nm = prompt(T('新しい運用の運用番号（例：A01）'), ''); if (!nm) return;
        if (await api('mp_op_save', { p_id: null, p_num: nm, p_form: null, p_note: '', p_kind: kind, p_as: S.as }, '運用をつくりました')) load();
      };
      b.querySelector('[data-oall]').onclick = () => exportOps(null, `運用_ぜんぶ_${ymd()}.json`);
      const fi = b.querySelector('[data-ofile]');
      b.querySelector('[data-oimp]').onclick = () => fi.click();
      fi.onchange = async () => {
        const f = fi.files && fi.files[0]; fi.value = ''; if (!f) return;
        let data; try { data = JSON.parse(await f.text()); } catch (e) { return toast('JSON として読めません'); }
        const r = await api('mp_op_import', { p_data: data, p_as: S.as, p_dry: true }); if (!r) return;
        importPreview(r, data, load);
      };
    });
  };
  load();
}
// 運用をまとめて編集（2026-10-28）：列車の時刻をずらす・種別・運用番号の置きかえ・メモ・編成をはずす
function opsBulkEdit(ids, kind, after) {
  const n = ids.length, rail = kind === 'rail';
  const m = modal([`運用 ${n}つ をまとめて編集`, `
    <div class="mp-item"><b>列車の時刻をずらす</b><div class="mp-row" style="align-items:center"><input class="mp-inp mp-num" data-min value="5" inputmode="numeric"><span>分</span>
      <button class="btn" data-sl>おそくする</button><button class="btn" data-se>早くする</button></div>
      <p class="muted small" style="margin:0">その運用の列車ぜんぶの発車時刻と、採時駅の指定をずらします（0時〜24時の外に出るときは、ずらせません）</p></div>
    ${rail ? `<div class="mp-item"><b>列車の種別</b><div class="mp-row" style="align-items:center"><input class="mp-inp" style="flex:1 1 120px" data-kd list="mpKinds" placeholder="${esc(T('種別（例：快速）'))}"><datalist id="mpKinds">${KINDS.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      <button class="btn" data-sk>この種別にする</button></div></div>` : ''}
    <div class="mp-item"><b>運用番号の一部を置きかえる</b><div class="mp-row" style="align-items:center"><input class="mp-inp" style="flex:1 1 80px" data-fr placeholder="${esc(T('前（例：A）'))}"><span>→</span><input class="mp-inp" style="flex:1 1 80px" data-to placeholder="${esc(T('後（例：B）'))}">
      <button class="btn" data-sr>置きかえる</button></div></div>
    <div class="mp-item"><b>メモ</b><div class="mp-row" style="align-items:center"><input class="mp-inp" style="flex:1 1 160px" data-nt maxlength="200"><button class="btn" data-sn>このメモにする</button></div></div>
    <div class="mp-item"><b>編成をはずす</b><div class="mp-row"><button class="btn" data-su>えらんだ運用の編成をはずす</button></div>
      <p class="muted small" style="margin:0">編成がない運用の列車は走りません</p></div>
    <p class="muted small">時刻・種別・編成を変えたときは、変わった系統の「↶ 取り消す」でもとにもどせます</p>`], b => {
    const go = async (act, arg, msg) => { const r = await api('mp_ops_bulk', { p_ids: ids, p_act: act, p_arg: arg, p_as: S.as }); if (r) { toast(msg(r)); m.close(); after(); } };
    const mins = () => { const v = Number(hw(b.querySelector('[data-min]').value)); return Number.isFinite(v) && v > 0 ? Math.round(v) : null; };
    b.querySelector('[data-sl]').onclick = () => { const v = mins(); if (!v) return toast('分を入れてください'); return go('shift', { min: v }, r => T(`${r.trains}本の列車を ${v}分 おそくしました`)); };
    b.querySelector('[data-se]').onclick = () => { const v = mins(); if (!v) return toast('分を入れてください'); return go('shift', { min: -v }, r => T(`${r.trains}本の列車を ${v}分 早くしました`)); };
    { const e = b.querySelector('[data-sk]'); if (e) e.onclick = () => { const k = b.querySelector('[data-kd]').value.trim(); if (!k) return toast('種別を入れてください'); return go('kind', { kind: k }, r => T(`${r.trains}本の列車を「${k}」にしました`)); }; }
    b.querySelector('[data-sr]').onclick = () => { const f = b.querySelector('[data-fr]').value, t = b.querySelector('[data-to]').value; if (!f) return toast('置きかえる文字を入れてください'); return go('rename', { from: f, to: t }, r => T(`運用番号を ${r.n}つ 置きかえました`)); };
    b.querySelector('[data-sn]').onclick = () => go('note', { note: b.querySelector('[data-nt]').value }, r => T(`${r.n}つの運用のメモを変えました`));
    b.querySelector('[data-su]').onclick = () => { if (!confirm(T(`えらんだ運用 ${n}つ の編成をはずしますか？`))) return; return go('unform', {}, r => T(`${r.n}つの運用の編成をはずしました`)); };
  });
}
// 運用ファイルの読みこみ：見つもり（変わる運用・列車の数・まちがい）を見せてから入れる
function importPreview(r, data, after) {
  const m = modal(['運用ファイルを読みこむ', `
    <div class="mp-list">${(r.ops || []).map(o => `<div class="mp-item small"><b>${o.num ? esc(o.num) : '<span>（運用なし）</span>'}</b>${o.new ? ' <small>（新しい運用）</small>' : ''}
      ：<span>今の列車 ${o.del}本 → ファイルの列車 ${o.add}本</span>${!('form' in o) ? '' : o.form != null ? `<span>・編成</span> <span>${esc(String(o.form))}</span>` : '<span>・編成なし</span>'}</div>`).join('')}</div>
    ${r.nerr ? `<p class="mp-warn"><span>まちがいが ${r.nerr}つあります（読みこめません）</span></p><div class="small">${(r.errors || []).map(e => `<div>・<span>${esc(e)}</span></div>`).join('')}</div>` : ''}
    ${(r.warns || []).length ? `<div class="small muted">${r.warns.map(e => `<div>・<span>${esc(e)}</span></div>`).join('')}</div>` : ''}
    <div class="mp-row"><button class="btn main" data-ok ${r.ok ? '' : 'disabled'}>読みこむ（${r.trains}本）</button></div>
    <p class="muted small">ファイルにある運用の列車は、ファイルの列車に入れかわります（あとで系統の「↶ 取り消す」でもどせます）</p>`], b => {
    b.querySelector('[data-ok]').onclick = async () => { const x = await api('mp_op_import', { p_data: data, p_as: S.as, p_dry: false }); if (x) { toast(T(`読みこみました（列車 ${x.trains}本）`)); m.close(); if (after) after(); } };
  });
}
/* ---- 編成の譲渡 ---- */
function giveForm(f, reload) {
  if (!f) return;
  const n = f.perf ? f.perf.n : 0;
  const m = modal(['編成をゆずる', `<p class="small" style="margin-bottom:2px"><b>${esc(f.name)}</b>（<span>${f.perf && f.perf.air ? `${n}機` : f.perf && f.perf.ship ? `${n}隻` : f.perf && !f.perf.rail ? `${n}台` : `${n}両`}</span>）</p>
    <p class="small" style="margin-top:0">ほかの人・会社にゆずります。相手が受けとったら移ります（受けとる側が車庫をえらびます）</p>
    <div class="mp-row"><input class="mp-inp" data-to inputmode="numeric" placeholder="相手の ID（人は5けた・会社は会社ID）"></div>
    <div class="mp-row">値段 <input class="mp-inp mp-num" style="width:140px" data-pr value="0"> X <small class="muted">（0 X でもよい）</small></div>
    <div class="mp-row"><input class="mp-inp" data-msg placeholder="ひとこと（なくてもよい）"></div>
    <div class="mp-row"><button class="btn main" data-ok>申しこむ</button></div>
    <p class="muted small">相手が受けとると、この編成は運用・列車からはずれます。車番は相手の続きの番号になります</p>`], b => {
    b.querySelector('[data-ok]').onclick = async () => {
      const to = b.querySelector('[data-to]').value.trim(), pr = Number(hw(b.querySelector('[data-pr]').value).replace(/[,，\s]/g, ''));
      if (!to) return toast('相手の ID を入れてください'); if (!(pr >= 0)) return toast('数字を入れてください');
      const r = await api('mp_xfer_offer', { p_form: f.id, p_to: to, p_price: pr, p_msg: b.querySelector('[data-msg]').value, p_as: S.as });
      if (r) { toast(T(`${r.to}に申しこみました。受けとってもらうと移ります`)); m.close(); if (reload) reload(); }
    };
  });
}
// 車歴（t54h）：新製・転属・譲渡・廃車。L：[{num, label, rows: [{at, k, num, d}]}]
const dtL = at => { const t = new Date(at); return t.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) + ' ' + t.toLocaleTimeString('sv-SE', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }); };
const histL = h => { const d = h.d || {};
  return h.k === 'new' ? T(`新製（${d.dep || ''}に配置）`) : h.k === 'move' ? (d.how === '陸送' ? T(`転属：${d.dep || ''} → ${d.to || ''}（陸送）`) : T(`転属：${d.dep || ''} → ${d.to || ''}（回送）`))
    : h.k === 'xfer' ? T(`譲渡：${d.from || ''}から${d.to || ''}へ（${d.num0 || ''} → ${h.num}）`) : h.k === 'scrap' ? T(`${d.dep || ''}で廃車`) : h.k === 'renum' ? T(`改番：${d.num0 || ''} → ${h.num}`) : h.k; };
function carLog(title, L) {
  modal([title, `<div class="mp-list">${L.map(c => `<div class="mp-item"><b translate="no">${esc(c.num)}</b> <small class="muted" translate="no">${esc(c.label || '')}</small>
      <div class="small" style="margin-top:4px">${(c.rows || []).map(h => `<div><span class="muted" style="margin-right:8px">${esc(dtL(h.at))}</span><span>${esc(histL(h))}</span></div>`).join('') || '<span class="muted">記録がありません</span>'}</div></div>`).join('')
      || '<p class="muted small">ありません</p>'}</div>
    <p class="muted small">車歴には、新製・転属・譲渡・改番・廃車がのこります（譲渡のあとも、前の持ち主の記録が見えます）</p>`]);
}
function giveCars(cars, reload) {
  if (!cars.length) return;
  const m = modal(['車両をゆずる', `<p class="small" style="margin-bottom:2px"><b translate="no">${cars.map(c => esc(c.num)).join('・')}</b>（<span>${cars.length}両</span>）</p>
    <p class="small" style="margin-top:0">編成に入っていない車両を、ほかの人・会社にゆずります。相手が受けとったら移ります（受けとる側が車庫をえらびます）</p>
    <div class="mp-row"><input class="mp-inp" data-to inputmode="numeric" placeholder="相手の ID（人は5けた・会社は会社ID）"></div>
    <div class="mp-row">値段 <input class="mp-inp mp-num" style="width:140px" data-pr value="0"> X <small class="muted">（0 X でもよい）</small></div>
    <div class="mp-row"><input class="mp-inp" data-msg placeholder="ひとこと（なくてもよい）"></div>
    <div class="mp-row"><button class="btn main" data-ok>申しこむ</button></div>
    <p class="muted small">車番は相手の続きの番号になります。車歴に「譲渡」がのこります</p>`], b => {
    b.querySelector('[data-ok]').onclick = async () => {
      const to = b.querySelector('[data-to]').value.trim(), pr = Number(hw(b.querySelector('[data-pr]').value).replace(/[,，\s]/g, ''));
      if (!to) return toast('相手の ID を入れてください'); if (!(pr >= 0)) return toast('数字を入れてください');
      const r = await api('mp_xfer_offer', { p_form: null, p_to: to, p_price: pr, p_msg: b.querySelector('[data-msg]').value, p_as: S.as, p_cars: cars.map(c => c.id) });
      if (r) { toast(T(`${r.to}に申しこみました。受けとってもらうと移ります`)); m.close(); if (reload) reload(); }
    };
  });
}
const XST = { offer: '返事まち', done: '受けとりずみ', no: 'ことわり', cancel: '取り消し' };
/* ---- 乗り入れ（他社直通・t54j） ---- */
// この名義のキー（u:… / c:… / gov）
const myKey = () => { const a = (S.boot.as || []).find(x => x.as === S.as); return a ? a.k : null; };
// 乗り入れの一覧（この名義）。名義が変わったら読みなおす
async function loadThru(force) {
  if (!force && thruFresh()) return S.thru;
  if (S.as === 'gov') { S.thru = { as: S.as, me: 'gov', in: [], out: [] }; return S.thru; }
  const as = S.as, d = await api('mp_thru_list', { p_as: as });
  S.thru = d ? { ...d, as } : { as, me: myKey(), in: [], out: [], failed: true }; S.dirty = true;
  return S.thru;
}
const thruFresh = () => !!S.thru && S.thru.as === S.as;
const thruOut = k => thruFresh() ? (S.thru.out || []).find(t => t.k === k) : null;
const thruHosts = () => new Set(thruFresh() ? (S.thru.out || []).filter(t => t.st === 'ok').map(t => t.k) : []);
const thruLinks = () => new Set(thruFresh() ? [...(S.thru.out || []), ...(S.thru.in || [])].filter(t => t.st === 'ok').map(t => t.k) : []);
// 駅・線路のシートの「乗り入れ」の行（ほかの持ち主の駅・線路）
function thruRow(o) {
  if (!o || o === 'gov' || o === myKey() || S.as === 'gov') return '';
  const t = thruOut(o);
  return `<b>乗り入れ</b><span>${t && t.st === 'ok' ? `<span>できます</span><small>（線路使用料 1列車・1km ${X(t.fee)}）</small>` : t && t.st === 'req' ? '<span>申請中（返事まち）</span>'
    : `<button class="btn" data-thru style="padding:2px 10px">乗り入れを申請</button>`}</span>`;
}
async function thruReq(ref, after) {
  const msg = prompt(T('持ち主へのひとこと（なくてもよい）。許可されると、系統にこの持ち主の駅を入れて、線路を走れます（走った km ぶん線路使用料）'), ''); if (msg == null) return;
  if (await api('mp_thru_req', { p_sta: ref.sta || null, p_seg: ref.seg || null, p_msg: msg, p_as: S.as }, '申請しました。返事がきたら通知がとどきます')) { await loadThru(true); if (after) after(); }
}
async function openThru() {
  const m = modal(['乗り入れ', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  const load = async () => {
    const d = await loadThru(true); if (!d) return m.close();
    const st = t => t.st === 'ok' ? '<b style="color:#1a7f37">許可</b>' : t.st === 'req' ? '<b class="mp-warn">申請中</b>' : '<span class="muted">終わり</span>';
    const info = t => t.st === 'ok' ? `<br><span>線路使用料 1列車・1km ${X(t.fee)}</span>・<span>乗り入れている系統 ${t.routes}</span>` : '';
    m.set('乗り入れ', `<p class="small" style="margin:0 0 6px"><span>ほかの人・会社の線路に自分の列車を走らせる（乗り入れ）には、持ち主の許可がいります。</span><span>許可されると、系統に持ち主の駅を入れられ、線路をつなぐこともできます。運賃は系統の持ち主に、走った km ぶんの線路使用料（1列車・1km）は1時間ごとに線路の持ち主に入ります。</span></p>
      <h4 style="margin:8px 0 4px">とどいた申請・許可</h4>
      <div class="mp-list">${(d.in || []).map(t => `<div class="mp-item"><b>${esc(t.who)}</b> ${st(t)}<small>${info(t)}${t.msg ? `<br><span>「${esc(t.msg)}」</span>` : ''}</small>
          ${t.st === 'req' || t.st === 'ok' ? `<div class="mp-row"><input class="mp-inp mp-num" data-fee="${t.id}" inputmode="numeric" value="${t.st === 'ok' ? t.fee : 1000}" style="width:110px"><small>X／1列車・1km</small>
            ${t.st === 'req' ? `<button class="btn main" data-ok="${t.id}">許可</button><button class="btn" data-no="${t.id}">ことわる</button>` : `<button class="btn" data-ok="${t.id}">使用料を変える</button><button class="btn" data-end="${t.id}" style="color:#c33">やめる</button>`}</div>` : ''}</div>`).join('')
        || '<p class="muted small">ありません</p>'}</div>
      <h4 style="margin:8px 0 4px">出した申請・乗り入れ</h4>
      <div class="mp-list">${(d.out || []).map(t => `<div class="mp-item"><b>${esc(t.who)}</b> ${st(t)}<small>${info(t)}</small>
          ${t.st === 'req' ? `<div class="mp-row"><button class="btn" data-cancel="${t.id}">申請を取り消す</button></div>` : t.st === 'ok' ? `<div class="mp-row"><button class="btn" data-end="${t.id}" style="color:#c33">やめる</button></div>` : ''}</div>`).join('')
        || '<p class="muted small">ありません。地図でほかの人・会社の駅か線路をタップ →「乗り入れを申請」</p>'}</div>`, b => {
      const fee = id => Number(hw((b.querySelector(`[data-fee="${id}"]`) || {}).value || '0').replace(/[^\d]/g, '') || 0);
      b.querySelectorAll('[data-ok]').forEach(x => x.onclick = async () => { const id = Number(x.dataset.ok); if (await api('mp_thru_answer', { p_id: id, p_ok: true, p_fee: fee(id), p_as: S.as }, '決めました')) load(); });
      b.querySelectorAll('[data-no]').forEach(x => x.onclick = async () => { if (await api('mp_thru_answer', { p_id: Number(x.dataset.no), p_ok: false, p_fee: null, p_as: S.as }, 'ことわりました')) load(); });
      b.querySelectorAll('[data-cancel]').forEach(x => x.onclick = async () => { if (!confirm(T('申請を取り消します。よろしいですか？'))) return; if (await api('mp_thru_end', { p_id: Number(x.dataset.cancel), p_as: S.as }, '取り消しました')) load(); });
      b.querySelectorAll('[data-end]').forEach(x => x.onclick = async () => {
        if (!confirm(T('乗り入れをやめます。持ち主の線路・駅を使う系統は走れなくなります。よろしいですか？'))) return;
        if (await api('mp_thru_end', { p_id: Number(x.dataset.end), p_as: S.as }, 'やめました')) load();
      });
    });
  };
  load();
}
async function openXfers() {
  const m = modal(['編成の譲渡', '<p class="muted small">読みこんでいます…</p>']);
  let D = null, tab = 'in', open = null, deps = [];
  const load = async () => { D = await api('mp_xfer_list', {}); if (!D) return m.close(); if (!D.in.length && D.out.length) tab = 'out'; draw(); };
  const item = (x, inc) => { const p = x.perf || {}; return `<div class="mp-item">${x.loose ? `<b>${esc(T(`車両 ${x.n}両`))}</b>` : `<b>${esc(x.fname)}</b> <small><span>${p.air ? `長さ${p.len}m・${fmt(p.cap || 0)}席` : p.ship ? `長さ${p.len}m・旅客${fmt(p.cap || 0)}人` : p.rail === false ? `${p.n}台・${p.len}m・定員${fmt(p.cap || 0)}人` : `${p.n}両・${p.len}m・定員${fmt(p.cap || 0)}人・加速 ${p.acc}km/h/s・最高${p.vmax}km/h`}</span><span>・状態${p.cond}</span></small>`}<br>
      <small><span>${esc(x.from)}</span> → <span>${esc(x.to)}</span>・<span>${X(x.price)}</span>・<b class="${x.st === 'no' ? 'mp-warn' : ''}">${esc(XST[x.st] || x.st)}</b></small>
      ${x.cars ? `<br><small class="muted">${x.cars.map(esc).join('・')}</small>` : ''}${x.msg ? `<br><small>ひとこと：<span>${esc(x.msg)}</span></small>` : ''}
      ${inc && x.st === 'offer' && open === x.id ? `<div class="mp-row small" style="align-items:center"><span>車庫</span><select class="mp-inp" style="flex:1 1 140px" data-xd>${deps.map(d => `<option value="${d.id}" ${d.n + (x.loose ? x.n : (p.n || 0)) > d.cap ? 'disabled' : ''}>${esc(d.name)}（${d.n}/${d.cap}）</option>`).join('') || '<option value="">（入れられる車庫がありません）</option>'}</select></div>
        <div class="mp-row">${x.loose ? '' : '<input class="mp-inp" style="flex:1 1 120px" data-xn placeholder="新しい編成番号（なければ今のまま）">'}<button class="btn main" data-xgo="${x.id}" ${deps.length ? '' : 'disabled'}>受けとる（${X(x.price)}）</button></div>` : ''}
      ${x.st === 'offer' ? `<div class="mp-row">${inc ? (open !== x.id ? `<button class="btn main" data-xok="${x.id}">受けとる</button>` : '') + `<button class="btn" data-xno="${x.id}">ことわる</button>` : `<button class="btn" data-xno="${x.id}">取り消す</button>`}</div>` : ''}</div>`; };
  const draw = () => {
    const L = tab === 'in' ? D.in : D.out, nw = D.in.filter(x => x.st === 'offer').length;
    m.set('編成の譲渡', `<div class="tabs-s">${[['in', 'とどいた申しこみ'], ['out', '出した申しこみ']].map(t => `<button data-tab="${t[0]}" class="${tab === t[0] ? 'on' : ''}"><span>${t[1]}</span>${t[0] === 'in' && nw ? ` <b>${nw}</b>` : ''}</button>`).join('')}</div>
      <div class="mp-list" style="margin-top:8px">${L.map(x => item(x, tab === 'in')).join('') || '<p class="muted small">ありません</p>'}</div>
      <p class="muted small">${tab === 'in' ? '受けとるときに、車籍を置く車庫をえらびます（陸送で12時間）。車番は、受けとる側の続きの番号になります' : '編成をゆずるには、≡ →「車両と編成」の編成の「ゆずる」から。編成に入っていない車両は、えらんで「ゆずる」'}</p>`, b => {
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { tab = x.dataset.tab; open = null; draw(); });
      b.querySelectorAll('[data-xok]').forEach(x => x.onclick = async () => {
        const it = D.in.find(y => y.id === Number(x.dataset.xok));
        const cl = await api('mp_cars_list', { p_as: it.to_as }); if (!cl) return;
        const want = it.loose ? (it.rail !== false ? 'rail' : 'bus') : (fKind(it) || 'rail');   // 船は港へ（t54o）
        deps = cl.depots.filter(d => d.kind === want); open = it.id; draw();
      });
      b.querySelectorAll('[data-xgo]').forEach(x => x.onclick = async () => {
        const dep = Number(b.querySelector('[data-xd]').value); if (!dep) return toast('車庫をえらんでください');
        const xn = b.querySelector('[data-xn]');
        if (await api('mp_xfer_accept', { p_id: Number(x.dataset.xgo), p_depot: dep, p_name: xn ? xn.value : '' }, '受けとりました')) { open = null; load(); }
      });
      b.querySelectorAll('[data-xno]').forEach(x => x.onclick = async () => { if (confirm(T(tab === 'in' ? 'ことわりますか？' : '取り消しますか？')) && await api('mp_xfer_close', { p_id: Number(x.dataset.xno) }, tab === 'in' ? 'ことわりました' : '取り消しました')) load(); });
    });
  };
  load();
}

/* ---- 土地の申請：とどいた申請（自分と自分の会社の筆）・出した申請 ---- */
async function openLandReqs() {
  const m = modal(['土地の申請', '<p class="muted small">読みこんでいます…</p>']);
  let D = null, tab = 'in', open = null;
  const load = async () => { D = await api('mp_land_reqs', {}); if (!D) return m.close(); if (!D.in.some(r => r.st === 'wait') && D.out.length && tab === 'in' && !D.in.length) tab = 'out'; draw(); };
  const item = (r, inc) => `<div class="mp-item"><b translate="no">${esc(r.label)}</b> <small>${fmt(r.n * 100)}㎡</small><br>
      <small><span>${esc(r.who)}</span> → <span>${esc(r.owner)}</span>・<b class="${r.st === 'no' ? 'mp-warn' : ''}">${esc(LRS[r.st] || r.st)}</b>${r.st === 'ok' ? `<span>（1区画・1日 ${X(r.fee)}）</span>` : ''}${r.rent != null ? `<span>・貸出料 ${X(r.rent)}</span>` : ''}</small>
      ${r.msg ? `<br><small>ひとこと：<span>${esc(r.msg)}</span></small>` : ''}${r.reply ? `<br><small>返事：<span>${esc(r.reply)}</span></small>` : ''}
      ${inc && open === r.id ? `<div class="mp-row"><span class="small">使用料（1区画・1日）</span><input class="mp-inp mp-num" style="width:110px" data-fee value="${r.st === 'ok' ? r.fee : r.std}"> X <small class="muted">標準 ${X(r.std)}</small></div>
        <div class="mp-row"><input class="mp-inp" data-rp placeholder="返事のひとこと（なくてもよい）"><button class="btn main" data-okgo="${r.id}">許可する</button></div>` : ''}
      <div class="mp-row">${inc ? (open !== r.id ? `<button class="btn ${r.st === 'wait' ? 'main' : ''}" data-ok="${r.id}">${r.st === 'ok' ? '使用料を変える' : '許可する'}</button>` : '')
          + (r.st !== 'no' ? `<button class="btn" data-no="${r.id}">${r.st === 'ok' ? '許可をやめる' : 'ことわる'}</button>` : '')
        : `<button class="btn" data-del="${r.id}">${r.st === 'ok' ? '許可を返す' : '取り消す'}</button>`}<button class="btn" data-go="${r.x},${r.y}">地図で見る</button></div></div>`;
  const draw = () => {
    const L = tab === 'in' ? D.in : D.out, nw = D.in.filter(r => r.st === 'wait').length;
    m.set('土地の申請', `<div class="tabs-s">${[['in', 'とどいた申請'], ['out', '出した申請']].map(t => `<button data-tab="${t[0]}" class="${tab === t[0] ? 'on' : ''}"><span>${t[1]}</span>${t[0] === 'in' && nw ? ` <b>${nw}</b>` : ''}</button>`).join('')}</div>
      <div class="mp-list" style="margin-top:8px">${L.map(r => item(r, tab === 'in')).join('') || '<p class="muted small">ありません</p>'}</div>
      <p class="muted small">${tab === 'in' ? '許可すると、その人・会社は申請した筆を、線路・道路・駅・車庫に使えます（使用料は1区画・1日。毎時、あなたに入ります）。許可をやめても、もうつくってあるものはそのままです。筆をタップ →「貸出料」で、だれでも申請なしで使えるようにもできます'
        : '申請は、地図で線路などを見つもったとき（「持ち主に申請する」）や、他人の筆をタップ →「使う申請」でできます。許可を返しても、もうつくってあるものはそのままです'}</p>`, b => {
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { tab = x.dataset.tab; open = null; draw(); });
      b.querySelectorAll('[data-ok]').forEach(x => x.onclick = () => { open = Number(x.dataset.ok); draw(); });
      b.querySelectorAll('[data-okgo]').forEach(x => x.onclick = async () => {
        const t = hw(b.querySelector('[data-fee]').value || '').replace(/[,，\s]/g, ''), f = t === '' ? null : Number(t);
        if (f != null && !(f >= 0)) return toast('数字を入れてください');
        if (await api('mp_land_decide', { p_ids: [Number(x.dataset.okgo)], p_ok: true, p_fee: f, p_reply: b.querySelector('[data-rp]').value }, '許可しました')) { open = null; load(); }
      });
      b.querySelectorAll('[data-no]').forEach(x => x.onclick = async () => {
        const rp = prompt(T('返事のひとこと（なくてもよい）'), ''); if (rp == null) return;
        if (await api('mp_land_decide', { p_ids: [Number(x.dataset.no)], p_ok: false, p_fee: null, p_reply: rp }, 'ことわりました')) load();
      });
      b.querySelectorAll('[data-del]').forEach(x => x.onclick = async () => { if (confirm(T('この申請を取り消しますか？（つくってあるものは、そのままです）')) && await api('mp_land_req_del', { p_ids: [Number(x.dataset.del)] }, '取り消しました')) load(); });
      b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => { const [cx, cy] = x.dataset.go.split(',').map(Number); m.close(); setCam((cx + 0.5) / 5, (cy + 0.5) / 5, Math.max(S.cam.z, 24)); showSpot(cx, cy); });
    });
  };
  load();
}

/* ---- お金の記録 ---- */
const LK = { fare: '運賃', rent: '家賃', sales: '売上', tenant: 'テナントの家賃（はらう）', lease: '使用料（はらう）', lease_in: '使用料（受けとり）', upkeep: '維持費', tax: '固定資産税', land: '土地', bld: '建物', car: '車両', rail: '線路の工事', road: '道路の工事', sta: '駅', dep: '車庫', owed: '未払い',
  tuition: '授業料', fee: '施設の売上', goods: '仕入れ・材料', ship: '運送費', ferry: 'フェリーの運賃（トラック）', slot: '発着口', rwy: '滑走路の工事', jm: '役所の手数料' };
async function openLedger() {
  const m = modal(['お金の記録', '<p class="muted small">読みこんでいます…</p>']);
  let rows = [], before = null, head = null;
  const more = async () => {
    const d = await api('mp_ledger_page', { p_as: S.as, p_before: before }); if (!d) return;
    if (!head) head = d; rows = rows.concat(d.rows); before = d.rows.length ? d.rows[d.rows.length - 1].id : before;
    const day = head.day || {}, a = head.assets;
    m.set('お金の記録', `<p class="small" style="margin:0">${esc(asName())}</p>
      <div class="mp-kv"><b>土地</b><span>${a.land}筆・${fmt(a.land_m2 || 0)}㎡（地価 ${X(a.land_val)}）${a.land_val0 != null && a.land_val0 !== a.land_val ? `<br><small>評価額 ${X(a.land_val0)}（税・家賃・使用料のもと）</small>` : ''}</span><b>線路</b><span>${a.rail_km} km</span><b>駅・バス停</b><span>${a.stations}</span><b>車両</b><span>${a.cars}両（台）</span>
        ${head.owed ? `<b>未払い</b><span class="mp-warn">${X(head.owed)}（運賃などから先に引かれます）</span>` : ''}</div>
      <h4 style="margin:10px 0 4px">収支グラフ</h4><p class="muted small" style="margin:0 0 4px">1日ごと（上が入ったお金、下が出たお金、線は差し引き）。記録は60日のこります</p><div data-mflow></div>
      <h4 style="margin:10px 0 4px">この24時間</h4><div class="mp-kv">${Object.entries(day).map(([k, v]) => `<b>${esc(LK[k] || k)}</b><span style="color:${v >= 0 ? '#1a7f37' : '#c33'}">${v >= 0 ? '+' : ''}${fmt(v)} X</span>`).join('') || '<span class="muted small">なし</span>'}</div>
      <h4 style="margin:10px 0 4px">記録</h4><div class="mp-list">${rows.map(r => `<div class="mp-item"><small>${new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・${esc(LK[r.k] || r.k)}</small><br>
        ${esc(r.memo || '')} <b style="float:right;color:${r.amount >= 0 ? '#1a7f37' : '#c33'}">${r.amount >= 0 ? '+' : ''}${fmt(r.amount)} X</b></div>`).join('')}</div>
      ${d.rows.length === 50 ? '<button class="btn wide" data-more>もっと見る</button>' : ''}`, b => {
        const x = b.querySelector('[data-more]'); if (x) x.onclick = more;
        const mf = b.querySelector('[data-mflow]'); if (mf && window.axFlow) window.axFlow.mount(mf, { key: 'map', ranges: [7, 30, 60], def: 30, names: LK, load: dd => api('mp_ledger_days', { p_as: S.as, p_days: dd }) });
      });
  };
  more();
}

/* ---- 管理 ---- */
const RATE_NAME = { land_P: '地価のもと：平地', land_F: '地価のもと：林', land_B: '地価のもと：砂浜', land_H: '地価のもと：丘', land_M: '地価のもと：山', land_K: '地価のもと：高い山',
  dens_k: '地価：人の多さの効き', road_mul: '地価：道路ぞい', sta_mul: '地価：駅の近く', sta_r: '駅の近く（マス）', lease: '使用料（他人の土地・1日・地価の）', lease_gov: '使用料（国の土地・1日・地価の）',
  prop_tax: '固定資産税（1日・地価の）', rail: '線路（1マス）', road: '道路（1マス・1車線）', dbl_mul: '複線の倍率', elec: '電化（1マス）', sta_base: '駅のもと', sta_m: '駅：ホーム1m・1番線',
  stop: 'バス停', dep_S: '車両基地 S', dep_M: '車両基地 M', dep_L: '車両基地 L', bdep_S: '営業所 S', bdep_M: '営業所 M', up_rail: '維持費：線路1マス・1日', up_road: '維持費：私道1マス・1日',
  up_sta: '維持費：駅・1日', up_stop: '維持費：バス停・1日', up_dep: '維持費：車両基地・1日', up_bdep: '維持費：営業所・1日', g_rail: '鉄道に乗る人（駅のまわりの人の・1日）', g_bus: 'バスに乗る人（同）',
  fare_base: '運賃：はじめ', fare_km: '運賃：1kmごと', bus_fare: 'バス運賃', bus_km: 'バス：3kmをこえて1kmごと', catch_rail: '駅のまわり（マス）', catch_bus: 'バス停のまわり（マス）',
  max_tiles: '一度にひける線（マス）', grow: 'まちの成長（1日）', grow_sta: '駅の近くのまちの成長（1日）', urb_k: 'まちの中の工事費の倍率', urb_sta: 'まちの中の駅の工事費の倍率',
  p_wheat: '値段：小麦（1t）', p_flour: '値段：小麦粉（1t）', p_food: '値段：食品（1t）', p_ore: '値段：鉄鉱石（1t）', p_steel: '値段：鉄鋼（1t）', p_car: '値段：自動車（1台）',
  p_crude: '値段：原油（1kL）', p_chem: '値段：化学品（1t）', p_elec: '値段：家電・半導体（1t）', truck_base: 'トラック：積みおろし（1t）', truck_km: 'トラック：1t・1km',
  sc_imp: '輸入（値段の何倍）', sc_mkt: '市場に売る（値段の何倍）', sc_keep: '売らずにのこす在庫（何日分）', sc_shop: 'お店のもうけ（食品の値段の）', sc_food: 'お店の食品（床1㎡・1日・t）', sc_food_km: '食品をお店に運ぶ（km まで）',
  rc_parts: '鉄道車両工場：部品代（定価の）', rc_m2: '鉄道車両工場：1両・1日あたりの床（㎡）', rd_m2: '自動車工場：1台・1日あたりの床（㎡）', trk_tkm: 'トラック：1tで1日に走る km',
  g_ship: '船に乗る人（港のまわりの人の・1日）', catch_ship: '港のまわり（マス）', ship_fare: '船の運賃：はじめ', ship_km: '船の運賃：1kmごと', ferry_t: 'フェリー（トラック）：1t のはじめ',
  ferry_tkm: 'フェリー（トラック）：1t・1km', up_port: '維持費：港・1日', ship_dock: '船が港に着く・出る時間（秒）', sy_tpd: '造船所：床1㎡で1日につくれる船（t）', sy_steel: '造船所：鉄鋼（総トン数の）',
  g_air: '飛行機に乗る人（空港のまわりの人の・1日）', catch_air: '空港のまわり（マス）', air_fare: '航空運賃：はじめ', air_km: '航空運賃：1kmごと', up_air: '維持費：空港（ゲート2つ）・1日', air_ovh: '飛行機：地上走行と離着陸の時間（秒）' };
async function openAdmin() {
  const m = modal(['国土の管理', '<p class="muted small">読みこんでいます…</p>']);
  const st = await api('mp_admin_state', {}); const rates = await api('mp_admin_rates', { p_set: null }); if (!st || !rates) return;
  m.set('国土の管理', `<div class="mp-kv"><b>チャンク</b><span>${fmt(st.chunks)}</span><b>道路・線路</b><span>${fmt(st.segs)}（国 ${fmt(st.gov_segs)}・線路 ${fmt(st.rail_segs)}）</span><b>土地</b><span>${fmt(st.land)}筆</span><b>建物</b><span><span>${fmt(st.blds || 0)}棟</span>・<span>入居 ${fmt(st.occ || 0)}/${fmt(st.units || 0)}室</span></span>
      <b>駅</b><span>${fmt(st.stations)}</span><b>車両</b><span>${fmt(st.cars)}</span><b>系統・列車</b><span>${fmt(st.routes)}・${fmt(st.trains)}</span><b>時計</b><span>${st.last_tick ? new Date(st.last_tick).toLocaleString('ja-JP') : '—'}</span>
      <b>未払いの合計</b><span>${X(st.owed)}</span></div>
    <h4 style="margin:10px 0 4px">この24時間（ぜんぶ）</h4><div class="mp-kv">${Object.entries(st.day || {}).map(([k, v]) => `<b>${esc(LK[k] || k)}</b><span>${fmt(v)} X</span>`).join('')}</div>
    <h4 style="margin:10px 0 4px">名前・町字</h4><div class="mp-row"><button class="btn" data-names>地図で名前・町字をなおす</button></div>
    <h4 style="margin:10px 0 4px">用途地域をぬる</h4><div class="mp-row"><select class="mp-inp" style="width:auto" data-z>${Object.entries(PAL.ZN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="-">なし</option><option value="">もとにもどす</option></select>
      <button class="btn" data-paint>地図でぬる</button></div>
    <h4 style="margin:10px 0 4px">値段・設定</h4>
    <div class="mp-kv">${Object.keys(rates).map(k => `<b>${esc(RATE_NAME[k] || k)}</b><span><input class="mp-inp" style="width:140px" data-rate="${k}" value="${rates[k]}"></span>`).join('')}</div>
    <div class="mp-row"><button class="btn main" data-save>設定を保存</button></div>`, b => {
    b.querySelector('[data-save]').onclick = async () => {
      const set = {}; b.querySelectorAll('[data-rate]').forEach(i => { const v = Number(i.value); if (Number.isFinite(v) && String(v) !== String(rates[i.dataset.rate])) set[i.dataset.rate] = v; });
      if (!Object.keys(set).length) return toast('変わったところがありません');
      if (await api('mp_admin_rates', { p_set: set }, '保存しました')) m.close();
    };
    b.querySelector('[data-paint]').onclick = () => { const z = b.querySelector('[data-z]').value; m.close(); zonePaint(z || null); };
    b.querySelector('[data-names]').onclick = () => { m.close(); namesTool(); };
  });
}
// マスの四角をえらぶ（管理：用途地域・町字の分割）。2か所タップ → onPick([x0, y0, x1, y1])
function tileRect(msg, onPick) {
  setTool('look');
  const st = S.toolState = { a: null, b: null };
  hint(msg);
  S.drawTool = (g, z) => {
    if (!st.a) return;
    const b = st.b || st.a, x0 = Math.min(st.a[0], b[0]), y0 = Math.min(st.a[1], b[1]), x1 = Math.max(st.a[0], b[0]) + 1, y1 = Math.max(st.a[1], b[1]) + 1;
    g.fillStyle = 'rgba(160,40,200,.16)'; g.fillRect(sx(x0), sy(y0), (x1 - x0) * z, (y1 - y0) * z);
    g.strokeStyle = '#8a2fb8'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(sx(x0), sy(y0), (x1 - x0) * z, (y1 - y0) * z); g.setLineDash([]);
  };
  S.tapHook = (x, y) => {
    const t = [Math.floor(x), Math.floor(y)];
    if (!st.a || st.b) { st.a = t; st.b = null; } else { st.b = t; onPick([Math.min(st.a[0], st.b[0]), Math.min(st.a[1], st.b[1]), Math.max(st.a[0], st.b[0]), Math.max(st.a[1], st.b[1])], st.a); }
    S.dirty = true;
  };
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; S.drawTool = null; };
  S.dirty = true;
}
const rectTiles = (r, first) => { const out = first ? [first[0], first[1]] : []; for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) if (!first || x !== first[0] || y !== first[1]) out.push(x, y); return out; };
function zonePaint(z) {
  tileRect(`用途地域（${z ? PAL.ZN[z] || 'なし' : 'もとにもどす'}）：2か所タップして四角くえらびます`, r => {
    const tiles = rectTiles(r); if (tiles.length / 2 > 2000) return sheet('<p class="mp-warn">2000マスまでです</p>');
    sheet(`<h4>${z ? `${tiles.length / 2}マスを「${PAL.ZN[z] || 'なし'}」に` : `${tiles.length / 2}マスを、もとの用途地域に`}</h4><div class="mp-row"><button class="btn main" data-ok>ぬる</button></div>`, s => {
      s.querySelector('[data-ok]').onclick = async () => {
        if (await api('mp_admin_zone', { p_tiles: tiles, p_z: z }, 'ぬりました')) {
          for (let cy = Math.floor(r[1] / CS); cy <= Math.floor(r[3] / CS); cy++) for (let cx = Math.floor(r[0] / CS); cx <= Math.floor(r[2] / CS); cx++) S.chunks.delete(ckey(cx, cy));
          S.dirty = true; sheet(null);
        }
      };
    });
  });
}
// 管理：名前・町字（地図をタップ → 県・郡・市区町村・区・町・丁目／大字・字。名前を変える・町字を分ける・合併する）
function namesTool() {
  setTool('look');
  hint('名前・町字：地図をタップすると、その場所の名前が出ます');
  const show = async (tx, ty) => {
    S.sel = { kind: 'cell', x: tx * 5 + 2, y: ty * 5 + 2 }; S.dirty = true;
    const d = await api('mp_admin_place_at', { p_x: tx, p_y: ty }); if (!d) return;
    const subName = d.sub ? (d.sub.kind === 'aza' ? '字' : '丁目') : null, choName = d.cho ? (d.cho.kind === 'oaza' ? '大字' : '町') : null;
    const rows = [[(d.pref && d.pref.type) || '県', d.pref, 'place', (d.pref && d.pref.type) || '県'], ['郡', d.gun, 'gun', '郡'], ['市区町村', d.muni, 'place', d.muni && d.muni.type], ['区', d.ward, 'place', '区'],
                  [choName || '町', d.cho, 'cho', ''], [subName || '丁目', d.sub, 'cho', ''], ['島', d.isl, 'place', '']].filter(r => r[1]);
    sheet(`<h4>${esc(d.text || '')}</h4><div class="mp-kv">${rows.map((r, i) => `<b>${esc(r[0])}</b><span><b>${esc(r[1].name + (r[0] === '郡' ? '郡' : r[3] || ''))}</b>
        ${r[1].gen ? `<small class="muted">（もとは ${esc(r[1].gen)}）</small>` : ''} <button class="btn" style="padding:2px 8px" data-ren="${i}">名前を変える</button></span>`).join('')}</div>
      ${d.cho ? `<div class="mp-row"><button class="btn" data-split>この${esc(subName || choName)}を分ける</button>
        ${d.sub ? `<button class="btn" data-merge="sub">${esc(subName)}をとなりと合併</button>` : ''}<button class="btn" data-merge="cho">${esc(choName)}をとなりと合併</button></div>` : ''}`, s => {
      s.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => {
        const r = rows[Number(b.dataset.ren)];
        const nm = prompt(r[0] === '島' ? T('島の新しい名前（「島」「岩」までつける）') : T('新しい名前（「県」「市」「区」「郡」などはつけない）'), r[1].name); if (!nm) return;
        if (await api('mp_admin_rename', { p_kind: r[2], p_id: r[1].id, p_name: nm }, '名前を変えました')) { for (const c of S.cells.values()) c.stale = true; show(tx, ty); }
      });
      const sp = s.querySelector('[data-split]'); if (sp) sp.onclick = () => {
        tileRect(`分ける：新しい町字にするマスを、2か所タップして四角くえらびます（${d.sub ? d.sub.name : d.cho.name}のところだけ）`, async r => {
          const tiles = rectTiles(r, [tx, ty]);
          const nm = prompt(T('新しい町字の名前（丁目なら空でもよい）'), ''); if (nm == null) return;
          const x = await api('mp_admin_cho_split', { p_tiles: tiles, p_name: nm });
          if (x) { toast(T(`「${x.name}」をつくりました（${x.tiles}マス・筆 ${x.parcels}）`)); dropCho(r); namesTool(); }
        });
      };
      s.querySelectorAll('[data-merge]').forEach(b => b.onclick = () => {
        const lv = b.dataset.merge, from = lv === 'sub' ? d.sub : d.cho;
        hint('合併：入れる先の町字のマスをタップしてください');
        S.tapHook = async (x2, y2) => {
          const e = await api('mp_admin_place_at', { p_x: Math.floor(x2), p_y: Math.floor(y2) }); if (!e) return;
          const into = lv === 'sub' ? e.sub : e.cho;
          if (!into || into.id === from.id) return toast('ちがう町字をタップしてください');
          if (!confirm(T(`「${from.name}」を「${into.name}」に合併します。よろしいですか？`))) return;
          const x = await api('mp_admin_cho_merge', { p_from: from.id, p_into: into.id });
          if (x) { toast(T(`合併しました（筆 ${x.parcels}）`)); dropCho([Math.min(tx, Math.floor(x2)) - 64, Math.min(ty, Math.floor(y2)) - 64, Math.max(tx, Math.floor(x2)) + 64, Math.max(ty, Math.floor(y2)) + 64]); namesTool(); }
        };
      });
    });
  };
  S.tapHook = (x, y) => show(Math.floor(x), Math.floor(y));
  S.toolEnd = () => { S.tapHook = null; };
}
// 町字のデータを読みなおす（まわりのチャンク）
function dropCho(r) {
  for (let cy = Math.floor(r[1] / CS) - 1; cy <= Math.floor(r[3] / CS) + 1; cy++) for (let cx = Math.floor(r[0] / CS) - 1; cx <= Math.floor(r[2] / CS) + 1; cx++) { S.cho.delete(ckey(cx, cy)); const n = S.chunks.get(ckey(cx, cy)); if (n) n.bnd = null; }
  for (const c of S.cells.values()) c.stale = true;
  S.dirty = true;
}

/* ---------- ひらく・とじる ---------- */
async function open(root) {
  if (S.open && S.root === root && S.wrap && root.contains(S.wrap)) { resume(); return; }
  S.root = root;
  root.innerHTML = '<p class="muted small">国土を読みこんでいます…</p>';
  try { S.boot = await call('mp_boot', {}); } catch (e) { root.innerHTML = `<p class="small">${esc(e.message)}</p>`; return; }
  S.admin = !!S.boot.admin;
  if (!S.ov) {
    try {
      const inf = await (await fetch('map/overview.json', { cache: 'no-cache' })).json();
      const img = new Image(); img.onload = () => { S.ov = img; S.ovInfo = inf; S.dirty = true; }; img.src = 'map/overview.png?v=' + (inf.v || '1');
    } catch (e) { console.warn('overview', e); }
  }
  loadCam();
  build(root);
  if (!localStorage.getItem('mp_cam')) setCam(0, 0, 4);
  S.open = true; S.dirty = true;
  requestAnimationFrame(frame);
  clearInterval(S.pollT); S.pollT = setInterval(poll, 15000);
}
function resume() { if (!S.wrap) return; S.open = true; S.dirty = true; resize(); requestAnimationFrame(frame); clearInterval(S.pollT); S.pollT = setInterval(poll, 15000); }
function pause() { if (!S.open) return; S.open = false; clearInterval(S.pollT); if (S.wrap) S.wrap.classList.remove('mp-full'); }

/* ---------- 建物（t50）：プリセット・形・階数・部屋（入居募集・テナント募集・自分で使う） ---------- */
// 色：[屋根, 南の壁, 東の壁]
const BK = {
  house: ['#c47b4e', '#efe6da', '#d6c8b6'], apart: ['#9aa7b3', '#efe9e1', '#d3cbc0'], mansion: ['#d9d4cc', '#f4f1ec', '#d2cbc0'],
  tower: ['#cfd6de', '#e8edf2', '#b8c3ce'], shop: ['#e6a06e', '#f3e6d6', '#d9c6ae'], zakkyo: ['#c9b8a6', '#eee6dc', '#cdbfae'],
  office: ['#aebdd0', '#e1e8f0', '#a7b6c7'], sky: ['#9fb3cc', '#d3dfeb', '#8ea4bc'], mall: ['#e8d2b0', '#f6ecdc', '#dcc9aa'],
  factory: ['#b8b8b0', '#e4e4dc', '#c4c4ba'], warehouse: ['#c2b59b', '#ece4d2', '#cfc2a6'], port: ['#9ab3c0', '#dde8ee', '#a9bcc6'],
  farm: ['#a9cf73'], parking: ['#bdbdbd'], pkbld: ['#b0b0b0', '#e2e2e2', '#c2c2c2'],
  cityhall: ['#c9b48c', '#f1e8d6', '#d8c6a3'], plaza: ['#e6dfcf'],   // 国の建物（t54g）：市役所・広場
  // 国の建物（t56）：府県庁・官庁・国会議事堂・裁判所・首相官邸・国立図書館・司令部
  prefhall: ['#b9a27a', '#efe5d2', '#d3c2a0'], govhall: ['#a7b3c1', '#e8ecf1', '#c4cdd8'], diet: ['#d6cbb6', '#f6f1e6', '#e3d8c4'],
  court: ['#b5ada0', '#efebe4', '#d3ccc0'], kantei: ['#c3b597', '#f3eee2', '#dbd0b9'], natlib: ['#9c8c70', '#eee8db', '#d2c6af'], milhq: ['#8a977a', '#e3e8dc', '#b6c0a8'],
  // 国の建物（t58）：区役所・町村役場・郵便局・警察署・消防署・図書館・市民会館・体育館・市立病院・清掃工場・浄水場・国立博物館・国立美術館・国立劇場・国立競技場
  wardoffice: ['#c9b48c', '#f1e8d6', '#d8c6a3'], townhall: ['#c7b48f', '#f2eadb', '#d9c9a9'], gpost: ['#d98a7a', '#f6e7e2', '#dfbcb3'],
  police: ['#7f93ad', '#e3e9f0', '#b4c1d1'], firest: ['#c96a5a', '#f3e2dd', '#d9b2a9'], publib: ['#8a9a6e', '#eeeee0', '#ccd0b8'],
  civic: ['#b59a7a', '#f1e9de', '#d6c5ae'], pgym: ['#8fb0c6', '#e9f0f4', '#c3d3de'], cityhosp: ['#e4e8ec', '#ffffff', '#d7dde3'],
  cleanfac: ['#9aa0a6', '#e3e5e7', '#bfc4c8'], pwater: ['#9cc4d6'], natmus: ['#a99a80', '#f0ebe1', '#d4cab8'], natart: ['#b8aa96', '#f3eee6', '#d9d0c2'],
  nattheater: ['#8a4f45', '#eadcd6', '#c9aaa2'], natstad: ['#93c56a'],
  // 風の芽大学（t54i）：本部・校舎・研究棟・図書館・講堂・体育館・学生会館・学生寮・大学病院・博物館・附属学校・温室・グラウンド・実験農場・緑地・並木道
  uhq: ['#a65a46', '#efe2d4', '#d4bfaa'], ukan: ['#c08a68', '#f2e8dc', '#d9c8b4'], ulab: ['#9fb0bf', '#e6eaee', '#bcc6cf'],
  ulib: ['#6f8a5e', '#efeadf', '#d3c9b6'], uhall: ['#8c4a3c', '#eadccd', '#cdb9a3'], ugym: ['#7fa0b8', '#e8edf1', '#c5d0d8'],
  uunion: ['#d39a5c', '#f4eadc', '#dbc8b0'], udorm: ['#a39d90', '#f1eee8', '#d4cfc5'], uhosp: ['#e4e8ec', '#ffffff', '#d7dde3'],
  umus: ['#6e7a8a', '#ece8e0', '#cfc8bb'], uschool: ['#c9b48a', '#f3eee2', '#d8cfb9'], ugh: ['#bfe3dc', '#e8f5f3', '#bcd9d4'],
  ufield: ['#93c56a'], ufarm: ['#e2c666'], ugreen: ['#c3dfae'], uave: ['#e6dfcf'],
  // 学校（t54k）：小学校・中学校・高校・大学・専門学校
  es: ['#d9b77e', '#f4ead8', '#dccbaa'], jhs: ['#c9a16a', '#f2e6d2', '#d8c4a2'], hs: ['#b98e5e', '#efe2d0', '#d2bc9c'], univ: ['#a65a46', '#efe2d4', '#d4bfaa'],
  voc: ['#b7a2c9', '#efe9f4', '#cfc3da'],
  // 特殊工場（t54k）：製粉・食品・製鉄・自動車・石油化学・半導体と家電・鉄道車両
  mill: ['#d8c9a3', '#f1ead8', '#d6c9ac'], foodf: ['#e3b98a', '#f6e9d8', '#dcc6a8'], steelw: ['#7d7f86', '#c9cbd0', '#9a9ca3'], carf: ['#9fb4c8', '#dfe7ef', '#b2c1cf'],
  petro: ['#c7c2a0', '#ebe7d2', '#cfcab0'], elecf: ['#b8d0d8', '#e7f0f3', '#c5d6dc'], railf: ['#8f9e8a', '#dce3d9', '#b4bfb0']
};
const USE_NAME = { home: '住居', shop: '店舗', office: '事務所', factory: '工場', warehouse: '倉庫', port: '港湾', farm: '田畑', parking: '駐車場', plaza: '広場', school: '学校',
  hotel: '宿泊', hospital: '医療・福祉', leisure: '娯楽' };
// 建てる画面の分け方（t54l：12）
const CATS = ['home', 'shop', 'biz', 'hotel', 'med', 'fun', 'school', 'ind', 'logi', 'port', 'farm', 'park'];
const CAT_NAME = { home: '住まい', shop: 'お店', biz: 'オフィス', hotel: '宿泊', med: '医療・福祉', fun: '娯楽', school: '学校', ind: '工場', logi: '倉庫・物流', port: '港・空港', farm: '田畑・農業', park: '駐車場' };
const SCH_K = new Set(['es', 'jhs', 'hs', 'univ', 'voc']), FAC_K = new Set(['mill', 'foodf', 'steelw', 'carf', 'petro', 'elecf', 'railf']);
// 品目（t54k）：名前・単位・量のことば
const GN = g => ((S.boot.goods || {})[g] || {}).n || g, GU = g => ((S.boot.goods || {})[g] || {}).u || 't';
const U_DAI = String.fromCharCode(0x53f0), SYM_SCH = String.fromCharCode(0x6587);   // 台（車の数・整数）・文（学校の地図記号）
const qtyS = (q, u) => (u === U_DAI || q >= 100 ? fmt(Math.round(q)) : q >= 1 ? (Math.round(q * 10) / 10).toFixed(1) : (Math.round(q * 1000) / 1000).toFixed(3)) + u;
const qG = (g, q) => `<span>${esc(GN(g))} ${qtyS(q, GU(g))}</span>`;
const GORDER = ['wheat', 'flour', 'food', 'ore', 'steel', 'car', 'crude', 'chem', 'elec'];   // 品目のならび（つながりの順）
const gSort = o => Object.entries(o || {}).sort((a, b) => GORDER.indexOf(a[0]) - GORDER.indexOf(b[0]));
const SHAPE_NAME = { full: 'ぜんぶ', slab: '板状', tower: '塔状', L: 'L字', ko: 'コの字', ro: 'ロの字' };
const MODE_NAME = { npc: '入居募集', corp: 'テナント募集', self: '自分で使う' };
// プリセット（種類 → プリセット。S.boot が変わったら作りなおす）
function pOf(k) { if (S._pmapOf !== S.boot) { S._pmapOf = S.boot; S._pmap = new Map(((S.boot && S.boot.bld) || []).map(p => [p.k, p])); } return S._pmap.get(k); }
const kindName = k => { const p = pOf(k); return p ? p.n : k; };
// 色（t54l）：プリセットの屋根の色 c から、壁の色（白とまぜる）をつくる
const mixW = (c, f) => { const n = parseInt(String(c).slice(1), 16); if (!Number.isFinite(n)) return '#eeeeee'; const m = v => Math.round(v + (255 - v) * f).toString(16).padStart(2, '0'); return '#' + m(n >> 16 & 255) + m(n >> 8 & 255) + m(n & 255); };
function bcol(k) { if (BK[k]) return BK[k]; const p = pOf(k); if (!p || !p.c) return ['#bbb', '#eee', '#ccc']; return (BK[k] = [p.c, mixW(p.c, 0.72), mixW(p.c, 0.5)]); }
// 高さで屋根をずらす（北西へ。見下ろしている感じ）
const bldShift = f => { const h = Math.max(0, f) * 3.5; return [-h * 0.25 / 50, -h * 0.45 / 50]; };
// 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている%, 1 他人・2 自分]
function prepBld(a) {
  const b = { id: a[0], parcel: a[1], kind: a[2], floors: a[3], name: a[5] || '', occ: a[6], own: a[7], set: new Set() };
  const c = a[4] || [];
  for (let i = 0; i + 1 < c.length; i += 2) b.set.add(c[i] + ',' + c[i + 1]);
  const [dx, dy] = bldShift(b.floors); b.dx = dx; b.dy = dy;
  const base = new Path2D(), baseEdge = new Path2D(), roof = new Path2D(), edge = new Path2D(), wallS = new Path2D(), wallE = new Path2D();
  let n = 0, mx = 0, my = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of b.set) {
    const [x, y] = k.split(',').map(Number); n++; mx += x; my += y;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    const X0 = x / 5, Y0 = y / 5, X1 = (x + 1) / 5, Y1 = (y + 1) / 5;
    const W = !b.set.has((x - 1) + ',' + y), E = !b.set.has((x + 1) + ',' + y), N = !b.set.has(x + ',' + (y - 1)), Sd = !b.set.has(x + ',' + (y + 1));
    if (Sd) { wallS.moveTo(X0, Y1); wallS.lineTo(X1, Y1); wallS.lineTo(X1 + dx, Y1 + dy); wallS.lineTo(X0 + dx, Y1 + dy); wallS.closePath(); }
    if (E) { wallE.moveTo(X1, Y0); wallE.lineTo(X1, Y1); wallE.lineTo(X1 + dx, Y1 + dy); wallE.lineTo(X1 + dx, Y0 + dy); wallE.closePath(); }
    for (const [on, ax, ay, bx, by] of [[W, X0, Y0, X0, Y1], [E, X1, Y0, X1, Y1], [N, X0, Y0, X1, Y0], [Sd, X0, Y1, X1, Y1]]) {
      if (!on) continue;
      baseEdge.moveTo(ax, ay); baseEdge.lineTo(bx, by);
      edge.moveTo(ax + dx, ay + dy); edge.lineTo(bx + dx, by + dy);
    }
  }
  // 床と屋根：行ごとに続いている区画を1つの長方形に（建物が多いところでも速く描く。t59）
  const rows = new Map();
  for (const k of b.set) { const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1); let r = rows.get(y); if (!r) rows.set(y, r = []); r.push(x); }
  for (const [y, xs] of rows) {
    xs.sort((p, q) => p - q);
    let s0 = xs[0], p = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === p + 1) { p = xs[i]; continue; }
      base.rect(s0 / 5, y / 5, (p - s0 + 1) / 5, 0.2); roof.rect(s0 / 5 + dx, y / 5 + dy, (p - s0 + 1) / 5, 0.2);
      if (i < xs.length) s0 = p = xs[i];
    }
  }
  Object.assign(b, { base, baseEdge, roof, edge, wallS, wallE, n });
  b.cx = (mx / Math.max(n, 1) + 0.5) / 5; b.cy = (my / Math.max(n, 1) + 0.5) / 5;
  b.lx = b.cx + dx; b.ly = b.cy + dy;
  b.bb = [Math.min(x0 / 5, x0 / 5 + dx), Math.min(y0 / 5, y0 / 5 + dy), (x1 + 1) / 5, (y1 + 1) / 5];
  return b;
}
// 見えている建物（平らなもの（広場・駐車場・田畑）を先に。あとは北西から＝手前のものをあとで）
function bldsIn(it, v) {
  const bs = [...it.blds.values()].filter(b => b.bb[2] >= v.x0 && b.bb[0] <= v.x1 && b.bb[3] >= v.y0 && b.bb[1] <= v.y1);
  bs.sort((a, b) => ((a.floors > 0) - (b.floors > 0)) || ((a.cy + a.cx * 0.3) - (b.cy + b.cx * 0.3)));
  return bs;
}
// 建物を描く。pass 0：平らなもの（駅のホームより下）・1：高さのあるもの（ホームより上）
function drawBlds(g, bs, z, pass) {
  const walls = S.b25 && z >= 9, selP = S.sel && S.sel.kind === 'cell' ? S.sel.parcel : null;   // 2D のときは壁を描かない（上から見たまま）
  worldT(g);
  for (const b of bs) {
    if ((b.floors > 0) !== (pass === 1)) continue;
    const col = bcol(b.kind);
    if (b.floors <= 0) {   // 田畑・駐車場・広場・グラウンド・緑地・ゴルフ場など（平ら）
      const pat = FLAT_PAT[b.kind] || (pOf(b.kind) || {}).pat, soft = SOFT_PAT.has(pat);
      g.fillStyle = col[0]; g.fill(b.base);
      if (pat && z >= 9) flatPat(g, b, z, pat);
      if ((pOf(b.kind) || {}).air && z >= 6) drawApron(g, b, z);   // 空港の駐機場の線（t57：滑走路は国が別に引く）
      g.strokeStyle = b.own === 2 ? '#1f5bd6' : soft ? 'rgba(60,90,40,.28)' : 'rgba(60,60,60,.55)'; g.lineWidth = (b.own === 2 ? 1.6 : 1) / z; g.stroke(b.baseEdge);
      if ((pat === 'pave' || pat === 'avenue' || pat === 'green') && z >= 9) {   // 広場・並木道・緑地の木
        g.fillStyle = pat === 'green' ? 'rgba(80,150,70,.6)' : 'rgba(110,170,90,.55)';
        for (const k of b.set) {
          const [x, y] = k.split(',').map(Number);
          const edge = pat === 'avenue' && (!b.set.has((x - 1) + ',' + y) || !b.set.has((x + 1) + ',' + y) || !b.set.has(x + ',' + (y - 1)) || !b.set.has(x + ',' + (y + 1)));
          if (pat === 'avenue' ? edge && (x + y) % 2 === 0 : (x * 7 + y * 13) % (pat === 'green' ? 4 : 9) === 0) { g.beginPath(); g.arc((x + 0.5) / 5, (y + 0.5) / 5, pat === 'green' ? 0.06 : 0.045, 0, Math.PI * 2); g.fill(); }
        }
      }
    } else if (walls) {
      g.fillStyle = col[1]; g.fill(b.wallS); g.fillStyle = col[2]; g.fill(b.wallE);
      g.strokeStyle = 'rgba(60,60,60,.35)'; g.lineWidth = 0.8 / z; g.stroke(b.wallS); g.stroke(b.wallE);
      g.fillStyle = col[0]; g.fill(b.roof);
      g.strokeStyle = b.own === 2 ? '#1f5bd6' : 'rgba(50,50,50,.6)'; g.lineWidth = (b.own === 2 ? 1.8 : 1) / z; g.stroke(b.edge);
    } else {
      g.fillStyle = col[0]; g.fill(b.base);
      g.strokeStyle = b.own === 2 ? '#1f5bd6' : 'rgba(50,50,50,.6)'; g.lineWidth = 1 / z; g.stroke(b.baseEdge);
    }
    if (selP && b.parcel === selP) { g.strokeStyle = '#d23'; g.lineWidth = 3 / z; g.stroke(walls && b.floors > 0 ? b.edge : b.baseEdge); }
  }
  screenT(g);
}
// 平らな建物の描きかた（t54l）。キャンパスの種類（t54i）もここで
const FLAT_PAT = { farm: 'rows', ufarm: 'wheat', plaza: 'pave', uave: 'avenue', ugreen: 'green', ufield: 'field', parking: 'lines' };
const SOFT_PAT = new Set(['green', 'field', 'pave', 'avenue', 'wheat', 'lawn', 'golf', 'trees', 'flowers', 'paddy', 'track', 'snow']);
const hsh = (x, y) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
function flatPat(g, b, z, pat) {
  const [x0, y0, x1, y1] = b.bb;
  const cells = () => [...b.set].map(k => k.split(',').map(Number));
  const lines = (step, col, lw, both, horiz) => {
    g.strokeStyle = col; g.lineWidth = lw / z; g.beginPath();
    if (!horiz) for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { g.moveTo(x, y0); g.lineTo(x, y1); }
    if (both || horiz) for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { g.moveTo(x0, y); g.lineTo(x1, y); }
    g.stroke();
  };
  const dots = (pick, col, r) => {
    g.fillStyle = col; g.beginPath();
    for (const [x, y] of cells()) if (pick(x, y)) { const cx = (x + 0.5) / 5, cy = (y + 0.5) / 5; g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI * 2); }
    g.fill();
  };
  g.save(); g.clip(b.base);
  switch (pat) {
    case 'rows': if (z >= 14) lines(0.04, 'rgba(90,130,40,.55)', 1); break;                 // 畑のうね
    case 'wheat': if (z >= 14) lines(0.04, 'rgba(150,110,30,.45)', 1); break;               // 麦畑
    case 'lines': if (z >= 14) lines(0.05, 'rgba(255,255,255,.85)', 1.2); break;            // 駐車場の白線
    case 'pave': case 'avenue': if (z >= 14) lines(0.05, 'rgba(160,150,130,.45)', 1.2, true); break;   // 石だたみ
    case 'paddy': if (z >= 12) lines(0.2, 'rgba(235,225,180,.85)', 1.5, true); break;      // 田んぼのあぜ
    case 'lawn': if (z >= 12) { g.fillStyle = 'rgba(255,255,255,.13)'; for (let x = Math.floor(x0 / 0.16) * 0.16; x <= x1; x += 0.16) g.fillRect(x, y0, 0.08, y1 - y0); } break;   // 芝のしま
    case 'golf':                                                                           // フェアウェイ・バンカー・グリーン
      dots((x, y) => hsh(x, y) % 5 === 0, 'rgba(196,232,160,.85)', 0.16);
      dots((x, y) => hsh(x, y) % 37 === 3, 'rgba(242,228,176,.95)', 0.05);
      if (z >= 14) dots((x, y) => hsh(x, y) % 61 === 7, 'rgba(140,215,110,.95)', 0.07);
      break;
    case 'court': if (z >= 12) {                                                           // テニスコート（24m × 11m）
      const cw = 0.24, ch = 0.48, gap = 0.04; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.2 / z; g.fillStyle = 'rgba(70,140,95,.95)';
      for (let x = x0 + gap; x + cw <= x1 + 0.001; x += cw + gap) for (let y = y0 + gap; y + ch <= y1 + 0.001; y += ch + gap) {
        g.fillRect(x, y, cw, ch); g.strokeRect(x + 0.02, y + 0.02, cw - 0.04, ch - 0.04); g.beginPath(); g.moveTo(x, y + ch / 2); g.lineTo(x + cw, y + ch / 2); g.stroke();
      } } break;
    case 'track': case 'field': drawField(g, b, z); break;                                  // 陸上のトラック
    case 'amuse': {                                                                         // 乗りもの・観覧車
      dots((x, y) => hsh(x, y) % 23 === 0, 'rgba(240,120,140,.9)', 0.06);
      dots((x, y) => hsh(x, y) % 29 === 5, 'rgba(90,160,230,.9)', 0.06);
      dots((x, y) => hsh(x, y) % 31 === 9, 'rgba(250,200,60,.9)', 0.06);
      const r = Math.min(0.45, Math.min(x1 - x0, y1 - y0) * 0.18);
      g.strokeStyle = 'rgba(200,60,90,.9)'; g.lineWidth = 2 / z; g.beginPath(); g.arc(b.cx, b.cy, r, 0, Math.PI * 2);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.moveTo(b.cx, b.cy); g.lineTo(b.cx + r * Math.cos(a), b.cy + r * Math.sin(a)); }
      g.stroke(); break; }
    case 'trees': dots((x, y) => (x * 7 + y * 13) % 3 === 0, 'rgba(60,120,60,.55)', 0.075); break;      // 木
    case 'water': dots((x, y) => hsh(x, y) % 4 === 0, 'rgba(110,170,215,.95)', 0.075); break;          // 池・水槽
    case 'snow': if (z >= 12) {                                                             // ゲレンデ
      g.strokeStyle = 'rgba(140,160,185,.6)'; g.lineWidth = 1.2 / z; g.beginPath();
      for (let k = x0 - (y1 - y0); k <= x1; k += 0.3) { g.moveTo(k, y1); g.lineTo(k + (y1 - y0) * 0.6, y0); }
      g.stroke(); } break;
    case 'solar': lines(0.06, 'rgba(225,235,245,.55)', 1, false, true); break;               // パネルの列
    case 'wind': {                                                                           // 風車
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.6 / z; g.beginPath();
      for (const [x, y] of cells()) if (hsh(x, y) % 9 === 0) { const cx = (x + 0.5) / 5, cy = (y + 0.5) / 5; for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.3; g.moveTo(cx, cy); g.lineTo(cx + 0.09 * Math.cos(a), cy + 0.09 * Math.sin(a)); } }
      g.stroke(); break; }
    case 'container': if (z >= 12) {                                                         // コンテナ
      const C = ['#c0392b', '#2e86c1', '#d4ac0d', '#27ae60', '#8e44ad', '#e67e22'];
      for (let x = x0 + 0.02; x < x1; x += 0.14) for (let y = y0 + 0.02; y < y1; y += 0.07) { g.fillStyle = C[hsh(Math.round(x * 100), Math.round(y * 100)) % C.length]; g.fillRect(x, y, 0.12, 0.05); }
    } break;
    case 'course': {                                                                         // 教習所のコース
      const ins = 0.12, w = x1 - x0 - 2 * ins, h = y1 - y0 - 2 * ins; if (w <= 0.1 || h <= 0.1) break;
      g.strokeStyle = 'rgba(105,105,110,.95)'; g.lineWidth = 0.07; g.beginPath();
      if (typeof g.roundRect === 'function') g.roundRect(x0 + ins, y0 + ins, w, h, Math.min(w, h) * 0.25); else g.rect(x0 + ins, y0 + ins, w, h);
      g.moveTo(x0 + ins, y0 + ins + h / 2); g.bezierCurveTo(x0 + ins + w * 0.3, y0 + ins + h * 0.2, x0 + ins + w * 0.7, y0 + ins + h * 0.8, x0 + ins + w, y0 + ins + h / 2);
      g.stroke();
      if (z >= 16) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1 / z; g.setLineDash([0.04, 0.04]); g.stroke(); g.setLineDash([]); }
      break; }
    case 'flowers': if (z >= 12) {                                                          // 花
      const C = ['rgba(236,120,170,.9)', 'rgba(250,210,60,.9)', 'rgba(170,110,210,.9)', 'rgba(255,255,255,.9)'];
      for (const [x, y] of cells()) for (let i = 0; i < 4; i++) { const h = hsh(x * 4 + i, y * 7 - i); g.fillStyle = C[h % 4]; g.beginPath(); g.arc((x + (h % 97) / 97) / 5, (y + ((h >> 8) % 89) / 89) / 5, 0.022, 0, Math.PI * 2); g.fill(); }
    } break;
  }
  g.restore();
}
// 建物の文字の場所（屋根の上）
const bldPt = (b, z) => { const w = S.b25 && z >= 9 && b.floors > 0; return [sx(w ? b.lx : b.cx), sy(w ? b.ly : b.cy)]; };
// 地図記号（t54l）：種類 → 記号。施設（学校・宿泊・医療・娯楽）は施設の用途から。工場は歯車、港はいかり、駐車場は P
const SYM_K = { shrine: 'torii', temple: 'manji', church: 'cross', superonsen: 'onsen', sento: 'onsen', onsenryokan: 'onsen',
  baseball: 'stadium', soccer: 'stadium', arena: 'stadium', athletics: 'stadium', museum: 'museum', artmuseum: 'museum', science: 'museum', umus: 'museum',
  aquarium: 'fish', fishing: 'fish', zoo: 'tree', botanical: 'tree', camp: 'tent', amuse: 'wheel', golf: 'flag', golfrange: 'flag', ski: 'mount',
  hospital: 'hosp', bighosp: 'hosp', erhosp: 'hosp', uhosp: 'hosp', nursing: 'care', care: 'care', dayserv: 'care', uschool: 'sch',
  gpost: 'post', wardoffice: 'hall', townhall: 'town', police: 'police', firest: 'fire', publib: 'book', civic: 'civic', pgym: 'stadium', cityhosp: 'hosp',   // t58
  cleanfac: 'gear', pwater: 'drop', natmus: 'museum', natart: 'museum', nattheater: 'theater', natstad: 'stadium',
  postoffice: 'post', cityhall: 'hall', prefhall: 'pref', govhall: 'gov', kantei: 'gov', diet: 'diet', court: 'court', natlib: 'book', milhq: 'mil', thermal: 'power', solar: 'power', wind: 'power', truckterm: 'truck', busterm: 'bus', water: '', garbage: '' };
// 重なったときに先に出すもの（小さいほど先）
const SYM_P = { pref: 0, diet: 0, hall: 0, court: 0, gov: 0, town: 0, police: 1, fire: 1, book: 1, mil: 1, hosp: 1, civic: 3, theater: 4, drop: 6, sch: 2, torii: 3, manji: 3, cross: 3, stadium: 4, museum: 4, wheel: 4, fish: 5, tree: 5, hotel: 5, onsen: 5, mount: 5,
  flag: 6, tent: 6, star: 6, post: 6, clinic: 7, care: 7, power: 8, truck: 8, bus: 8, gear: 9, anchor: 9, P: 10 };
function symOf(b) {
  if (SYM_K[b.kind] != null) return SYM_K[b.kind] || null;
  const p = pOf(b.kind) || {};
  if (p.sc) { const u = ((S.boot.sck || {})[p.sc] || {}).use; return u === 'school' ? 'sch' : u === 'hotel' ? 'hotel' : u === 'hospital' ? 'clinic' : u === 'leisure' ? 'star' : null; }
  if (SCH_K.has(b.kind)) return 'sch';
  if (p.cat === 'ind' || FAC_K.has(b.kind)) return 'gear';
  if (p.air) return null;   // 空港は ✈ の乗り場を描く（t54p）
  if (p.cat === 'port') return 'anchor';
  if (p.use === 'parking' && p.cat === 'park') return 'P';
  return null;
}
const SYM_TXT = { sch: SYM_SCH, manji: String.fromCharCode(0x534d), post: String.fromCharCode(0x3012), civic: String.fromCharCode(0x4f1a), theater: String.fromCharCode(0x5287) };   // 文・卍・〒・会・劇
function symDraw(g, k, X, Y) {
  g.save(); g.translate(X, Y); g.lineJoin = 'round'; g.lineCap = 'round';
  const W = 'rgba(255,255,255,.95)';
  const txt = (s, col, size) => { g.font = `bold ${size || 12}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = W; g.strokeText(s, 0, 0.5); g.fillStyle = col; g.fillText(s, 0, 0.5); };
  const path = (fn, col, lw, fill) => { g.beginPath(); fn(); g.strokeStyle = W; g.lineWidth = (lw || 1.6) + 2.6; g.stroke(); if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = col; g.lineWidth = lw || 1.6; g.stroke(); };
  const disc = (r, fill, col) => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); };
  switch (k) {
    case 'sch': txt(SYM_TXT.sch, '#5a3d0c'); break;
    case 'manji': txt(SYM_TXT.manji, '#3d3328', 12); break;
    case 'post': disc(6.5, '#fff', '#c0392b'); g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#c0392b'; g.fillText(SYM_TXT.post, 0, 0.5); break;
    case 'hall': for (const [col, lw] of [[W, 3.6], ['#333', 1.6]]) for (const r of [6, 3]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.strokeStyle = col; g.lineWidth = lw; g.stroke(); } break;
    // t58：町村役場（○）・警察署（⊗）・消防署（さすまた）・市民会館（会）・国立劇場（劇）・浄水場（しずく）
    case 'town': path(() => { g.arc(0, 0, 5.5, 0, Math.PI * 2); }, '#333', 1.6, '#fff'); break;
    case 'police': path(() => { g.arc(0, 0, 6, 0, Math.PI * 2); g.moveTo(-4.2, -4.2); g.lineTo(4.2, 4.2); g.moveTo(4.2, -4.2); g.lineTo(-4.2, 4.2); }, '#1f3d7a', 1.5, '#fff'); break;
    case 'fire': path(() => { g.moveTo(0, 6.5); g.lineTo(0, -1); g.moveTo(-5, -6.5); g.quadraticCurveTo(-5, -1, 0, -1); g.quadraticCurveTo(5, -1, 5, -6.5); g.moveTo(-3, 2.5); g.lineTo(3, 2.5); }, '#c0392b', 1.6); break;
    case 'civic': disc(6.5, '#fff', '#5a4632'); g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#5a4632'; g.fillText(SYM_TXT.civic, 0, 0.5); break;
    case 'theater': disc(6.5, '#fff', '#8a2f45'); g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#8a2f45'; g.fillText(SYM_TXT.theater, 0, 0.5); break;
    case 'drop': path(() => { g.moveTo(0, -6.5); g.bezierCurveTo(1.5, -3.5, 5, -0.5, 5, 2); g.arc(0, 2, 5, 0, Math.PI); g.bezierCurveTo(-5, -0.5, -1.5, -3.5, 0, -6.5); g.closePath(); }, '#1f6fa8', 1.4, '#cfe6f5'); break;
    // 国の建物（t56）：府県庁（◎にまん中の点）・官庁（○に横線）・国会議事堂（ドーム）・裁判所（高札）・国立図書館（本）・司令部（旗）
    case 'pref': for (const [col, lw] of [[W, 3.6], ['#1f3d7a', 1.6]]) for (const r of [6.5, 3.6]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.strokeStyle = col; g.lineWidth = lw; g.stroke(); }
      g.beginPath(); g.arc(0, 0, 1.6, 0, Math.PI * 2); g.fillStyle = '#1f3d7a'; g.fill(); break;
    case 'gov': path(() => { g.arc(0, 0, 6, 0, Math.PI * 2); g.moveTo(-6, 0); g.lineTo(6, 0); }, '#333', 1.6, '#fff'); break;
    case 'diet': path(() => { g.moveTo(-6.5, 5.5); g.lineTo(6.5, 5.5); g.lineTo(6.5, 1.5); g.lineTo(3.2, 1.5); g.arc(0, 1.5, 3.2, 0, Math.PI, true); g.lineTo(-6.5, 1.5); g.closePath(); g.moveTo(0, -1.7); g.lineTo(0, -6.5); }, '#3d3a33', 1.4, '#fff'); break;
    case 'court': path(() => { g.rect(-6, -6, 12, 6.5); g.moveTo(0, 0.5); g.lineTo(0, 6.5); }, '#3d3a33', 1.5, '#fff'); break;
    case 'book': path(() => { g.moveTo(0, -3.5); g.quadraticCurveTo(-3, -5.5, -6.5, -4.5); g.lineTo(-6.5, 4.5); g.quadraticCurveTo(-3, 3.5, 0, 5.5); g.quadraticCurveTo(3, 3.5, 6.5, 4.5); g.lineTo(6.5, -4.5); g.quadraticCurveTo(3, -5.5, 0, -3.5); g.closePath(); g.moveTo(0, -3.5); g.lineTo(0, 5.5); }, '#4d4a42', 1.3, '#fff'); break;
    case 'mil': path(() => { g.moveTo(-4.5, 6.5); g.lineTo(-4.5, -6.5); }, '#2f3d2a', 1.6); g.fillStyle = W; g.fillRect(-4.2, -6.8, 11, 7.6);
      g.fillStyle = '#4b5d3a'; g.fillRect(-3.5, -6, 9.6, 6.2); g.fillStyle = '#fff'; g.fillRect(-3.5, -3.7, 9.6, 1.6); break;
    case 'hosp': disc(6.5, '#fff', '#c62828'); g.fillStyle = '#c62828'; g.fillRect(-1.3, -4.2, 2.6, 8.4); g.fillRect(-4.2, -1.3, 8.4, 2.6); break;
    case 'clinic': g.fillStyle = W; g.fillRect(-2.7, -5.7, 5.4, 11.4); g.fillRect(-5.7, -2.7, 11.4, 5.4); g.fillStyle = '#d84343'; g.fillRect(-1.4, -4.4, 2.8, 8.8); g.fillRect(-4.4, -1.4, 8.8, 2.8); break;
    case 'care': path(() => { g.moveTo(-5, 5); g.lineTo(-5, -1); g.lineTo(0, -5.5); g.lineTo(5, -1); g.lineTo(5, 5); g.closePath(); }, '#8a5a2b', 1.5, '#fff'); g.fillStyle = '#8a5a2b'; g.fillRect(-1, 0.5, 2, 4.5); break;
    case 'hotel': path(() => { g.moveTo(-6, -4); g.lineTo(-6, 5); g.moveTo(-6, 1.5); g.lineTo(6, 1.5); g.lineTo(6, 5); g.moveTo(-6, -1.5); g.lineTo(6, -1.5); }, '#5b3f9a', 1.8); g.fillStyle = '#5b3f9a'; g.fillRect(-4.6, -3.6, 2.6, 2); break;
    case 'onsen': path(() => { g.moveTo(-5.5, 1); g.quadraticCurveTo(-5.5, 6, 0, 6); g.quadraticCurveTo(5.5, 6, 5.5, 1);
        for (const x of [-2.6, 0, 2.6]) { g.moveTo(x, 2.5); g.bezierCurveTo(x - 1.6, 0.5, x + 1.6, -1.5, x, -4.5); } }, '#c0392b', 1.5); break;
    case 'torii': path(() => { g.moveTo(-6.5, -4.5); g.quadraticCurveTo(0, -3.2, 6.5, -4.5); g.moveTo(-4.5, -2); g.lineTo(4.5, -2); g.moveTo(-3.5, -4); g.lineTo(-3.5, 5.5); g.moveTo(3.5, -4); g.lineTo(3.5, 5.5); }, '#c0392b', 1.8); break;
    case 'cross': path(() => { g.moveTo(0, -6); g.lineTo(0, 6); g.moveTo(-4, -2.5); g.lineTo(4, -2.5); }, '#4a4a6a', 2); break;
    case 'stadium': g.beginPath(); g.ellipse(0, 0, 6.5, 4.6, 0, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#2f6f3e'; g.lineWidth = 1.6; g.stroke(); g.beginPath(); g.ellipse(0, 0, 3.6, 2.2, 0, 0, Math.PI * 2); g.fillStyle = '#5fae6a'; g.fill(); break;
    case 'museum': path(() => { g.moveTo(-6, -2); g.lineTo(0, -6); g.lineTo(6, -2); g.closePath(); g.moveTo(-6, 5.5); g.lineTo(6, 5.5); for (const x of [-4, 0, 4]) { g.moveTo(x, -1); g.lineTo(x, 4.5); } }, '#4d4a42', 1.5, '#fff'); break;
    case 'fish': path(() => { g.ellipse(-0.5, 0, 4.5, 2.8, 0, 0, Math.PI * 2); g.moveTo(3.8, 0); g.lineTo(6.5, -3); g.lineTo(6.5, 3); g.closePath(); }, '#1f6fa8', 1.4, '#cfe6f5'); break;
    case 'tree': path(() => { g.moveTo(0, 6); g.lineTo(0, 0); }, '#6b4a2b', 1.8); g.beginPath(); g.arc(0, -2, 4.6, 0, Math.PI * 2); g.fillStyle = '#3f8f45'; g.fill(); g.strokeStyle = W; g.lineWidth = 1.2; g.stroke(); break;
    case 'tent': path(() => { g.moveTo(-6, 5); g.lineTo(0, -5.5); g.lineTo(6, 5); g.closePath(); g.moveTo(0, -5.5); g.lineTo(0, 5); }, '#7a5a2a', 1.5, '#f2d9a6'); break;
    case 'wheel': path(() => { g.arc(0, -1, 5, 0, Math.PI * 2); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.moveTo(0, -1); g.lineTo(5 * Math.cos(a), -1 + 5 * Math.sin(a)); } g.moveTo(-3, 6); g.lineTo(0, -1); g.lineTo(3, 6); }, '#c2185b', 1.3); break;
    case 'flag': path(() => { g.moveTo(-3, 6); g.lineTo(-3, -6); }, '#333', 1.6); g.beginPath(); g.moveTo(-3, -6); g.lineTo(5, -3.5); g.lineTo(-3, -1); g.closePath(); g.fillStyle = '#d32f2f'; g.fill(); g.strokeStyle = W; g.lineWidth = 1; g.stroke(); break;
    case 'mount': path(() => { g.moveTo(-6.5, 5); g.lineTo(0, -5.5); g.lineTo(6.5, 5); g.closePath(); }, '#4a6a8a', 1.5, '#cfe0ee'); g.beginPath(); g.moveTo(-2.4, -1.6); g.lineTo(0, -5.5); g.lineTo(2.4, -1.6); g.closePath(); g.fillStyle = '#fff'; g.fill(); break;
    case 'star': path(() => { for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.8 : 6.5, a = -Math.PI / 2 + i * Math.PI / 5; if (i) g.lineTo(r * Math.cos(a), r * Math.sin(a)); else g.moveTo(r * Math.cos(a), r * Math.sin(a)); } g.closePath(); }, '#b8860b', 1.2, '#f7c948'); break;
    case 'power': path(() => { g.moveTo(1.5, -6.5); g.lineTo(-4, 1); g.lineTo(-0.5, 1); g.lineTo(-1.8, 6.5); g.lineTo(4, -1.5); g.lineTo(0.6, -1.5); g.closePath(); }, '#8a6d00', 1.2, '#ffd23f'); break;
    case 'truck': path(() => { g.rect(-6.5, -3.5, 8, 6); g.rect(1.5, -1, 4.5, 3.5); }, '#2d4f73', 1.3, '#dbe8f5'); g.fillStyle = '#2d4f73'; for (const x of [-4, 3.5]) { g.beginPath(); g.arc(x, 3.6, 1.5, 0, Math.PI * 2); g.fill(); } break;
    case 'bus': disc(6, '#2a7de1', '#fff'); g.font = 'bold 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('B', 0, 0.5); break;
    case 'gear': g.restore(); gearSym(g, X, Y, 5); return;
    case 'anchor': path(() => { g.arc(0, -4.5, 1.6, 0, Math.PI * 2); g.moveTo(0, -2.9); g.lineTo(0, 5.5); g.moveTo(-3.5, -1); g.lineTo(3.5, -1); g.moveTo(-5.5, 1.5); g.quadraticCurveTo(-5, 5.5, 0, 5.5); g.quadraticCurveTo(5, 5.5, 5.5, 1.5); }, '#24527a', 1.5); break;
    case 'P': g.fillStyle = W; if (typeof g.roundRect === 'function') { g.beginPath(); g.roundRect(-6, -6, 12, 12, 2.5); g.fill(); g.beginPath(); g.roundRect(-5, -5, 10, 10, 2); g.fillStyle = '#1f5fbf'; g.fill(); } else { g.fillRect(-6, -6, 12, 12); g.fillStyle = '#1f5fbf'; g.fillRect(-5, -5, 10, 10); }
      g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('P', 0, 0.5); break;
  }
  g.restore();
}
// 施設のしるし（地図記号）。近いときは名前も（文字の層）。重なるときは だいじなもの・大きいものから
function bldMarks(g, bs, z) {
  if (z < 9 || z >= 24) return;
  const L = [];
  for (const b of bs) { const k = symOf(b); if (!k || (k === 'P' && z < 14)) continue; L.push([SYM_P[k] != null ? SYM_P[k] : 8, -b.n, b, k]); }
  L.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  for (const [pr, , b, k] of L) {
    const [X, Y] = bldPt(b, z);
    if (X < -60 || Y < -20 || X > S.W + 60 || Y > S.H + 20) continue;
    if (!markBox(X, Y, 7)) continue;
    symDraw(g, k, X, Y);
    if (z >= 14 && b.name && pr <= 8 && !(k === 'gear' && !(pOf(b.kind) || {}).mk)) label(g, b.name, X + 10, Y, { size: 10, left: true, color: b.own === 2 ? '#123c8c' : b.own === 3 ? '#5a3d0c' : '#333' });
  }
}
// 建物の名前（とても近いとき）。国の大きい建物は大きい字
const GOV_BIG = new Set(['cityhall', 'uhq', 'prefhall', 'govhall', 'diet', 'court', 'kantei', 'natlib', 'milhq',
  'wardoffice', 'townhall', 'police', 'firest', 'publib', 'civic', 'pgym', 'cityhosp', 'cleanfac', 'pwater', 'natmus', 'natart', 'nattheater', 'natstad']);   // t58
function bldNames(g, bs, z) {
  if (z < 24) return;
  for (const b of bs.slice().reverse()) {
    if (!b.name && b.floors <= 0) continue;
    if ((pOf(b.kind) || {}).air) continue;   // 空港は ✈ の乗り場の名前を出す（t54p）
    const [X, Y] = bldPt(b, z);
    if (X < -100 || Y < -20 || X > S.W + 100 || Y > S.H + 20) continue;
    const t = (b.name || '') + (b.floors > 0 ? (b.name ? ' ' : '') + b.floors + 'F' : '');
    label(g, t, X, Y, { size: GOV_BIG.has(b.kind) ? 12 : 10, color: b.own === 2 ? '#123c8c' : b.own === 3 ? '#5a3d0c' : '#333', bg: 'rgba(255,255,255,.82)' });
  }
}
// 工場の記号（歯車）
function gearSym(g, X, Y, r) {
  g.save(); g.translate(X, Y); g.beginPath();
  for (let k = 0; k < 32; k++) { const a = k * Math.PI / 16, rr = k % 4 < 2 ? r * 1.4 : r; if (k) g.lineTo(rr * Math.cos(a), rr * Math.sin(a)); else g.moveTo(rr, 0); }
  g.closePath(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.92)'; g.stroke(); g.fillStyle = '#4a4f57'; g.fill();
  g.beginPath(); g.arc(0, 0, r * 0.45, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore();
}
// グラウンド：大きいものは陸上のトラック（だ円）、小さいものはコートの白線
function drawField(g, b, z) {
  const [x0, y0, x1, y1] = b.bb, w = x1 - x0, h = y1 - y0;
  g.save(); g.clip(b.base);
  if (Math.min(w, h) >= 1.2) {
    const ins = 0.12, r = (Math.min(w, h) - 2 * ins) / 2, cx0 = x0 + ins, cy0 = y0 + ins, W = w - 2 * ins, H = h - 2 * ins;
    const lane = (k, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); const rr = Math.max(0.01, r - k);
      if (typeof g.roundRect === 'function') g.roundRect(cx0 + k, cy0 + k, W - 2 * k, H - 2 * k, rr); else g.rect(cx0 + k, cy0 + k, W - 2 * k, H - 2 * k); g.stroke(); };
    lane(0.06, '#c8704a', 0.12);                  // トラック（6m）
    if (z >= 14) { lane(0.02, 'rgba(255,255,255,.8)', 1 / z); lane(0.1, 'rgba(255,255,255,.8)', 1 / z); }
  } else {
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2 / z; g.strokeRect(x0 + 0.04, y0 + 0.04, w - 0.08, h - 0.08);
    g.beginPath(); if (w >= h) { g.moveTo(x0 + w / 2, y0 + 0.04); g.lineTo(x0 + w / 2, y1 - 0.04); } else { g.moveTo(x0 + 0.04, y0 + h / 2); g.lineTo(x1 - 0.04, y0 + h / 2); } g.stroke();
  }
  g.restore();
}
// タップしたところの建物（屋根を押しても）
function hitBld(x, y) {
  if (!S.vis || !S.vis.blds) return null;
  const bs = [...S.vis.blds.values()].sort((a, b) => (b.cy + b.cx * 0.3) - (a.cy + a.cx * 0.3));
  for (const b of bs) {
    const g0 = Math.floor(x * 5) + ',' + Math.floor(y * 5);
    if (b.set.has(g0)) return { b, cell: g0 };
    if (b.floors > 0 && S.b25 && S.cam.z >= 9) { const k = Math.floor((x - b.dx) * 5) + ',' + Math.floor((y - b.dy) * 5); if (b.set.has(k)) return { b, cell: k }; }
  }
  return null;
}
// 区画をしらべたときの建物の行
function bldRow(B, mine) {
  return `<b>建物</b><span><span>${esc(B.name || kindName(B.kind))}</span><small>（<span>${esc(kindName(B.kind))}</span>${B.floors > 0 ? `・<span>${B.floors}階</span>` : ''}${B.n ? `・<span>入居 ${B.occ}/${B.n}</span>` : ''}）</small>${mine ? `<br><small>家賃 1日 ${X(B.rent)}</small>` : ''}</span>`;
}

/* ---- 建てる：プリセットをえらぶ（t54l：12の分け方・さがす・建てられるものだけ・特徴） ---- */
// 施設の用途ごとのことば
const FAC_UI = {
  school: { ic: '🏫', who: '生徒', cap: '定員', pool: '通える人', fee: '授業料', unit: '1人 1日', day: '24時間の授業料', lv: '授業料の水準', npc: '町の学校法人', come: '生徒が通う' },
  hotel: { ic: '🏨', who: '宿泊客', cap: '泊まれる人', pool: '泊まりにくる見こみ', fee: '宿泊料', unit: '1人 1泊', day: '24時間の宿泊料', lv: '宿泊料の水準', npc: '町のホテル会社', come: '旅の人が泊まる' },
  hospital: { ic: '🏥', who: '患者・利用者', cap: '1日に見られる人', pool: 'かかる見こみ', fee: '診療報酬など', unit: '1人 1日', day: '24時間の診療報酬など', lv: '料金の水準', npc: '町の医療法人', come: '患者・利用者が来る' },
  leisure: { ic: '🎡', who: '来場者', cap: '1日に入れる人', pool: '来る見こみ', fee: '入場料など', unit: '1人', day: '24時間の入場料など', lv: '料金の水準', npc: '町の会社', come: '来場者が来る' },
};
// 月のならび → 春・夏・秋・冬（ほかは月を）
function monthsTxt(ms) {
  const set = new Set(ms || []), out = [];
  for (const [n, a] of [['春', [3, 4, 5]], ['夏', [7, 8]], ['秋', [9, 10, 11]], ['冬', [12, 1, 2]]]) if (a.every(m => set.has(m))) { out.push(`<span>${n}</span>`); a.forEach(m => set.delete(m)); }
  const mn = m => { try { return new Intl.DateTimeFormat(document.documentElement.lang || 'ja', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 15))); } catch (e) { return m + '/'; } };
  for (const m of [...set].sort((a, b) => a - b)) out.push(`<span translate="no">${mn(m)}</span>`);
  return out.join('・');
}
// 建物の特徴（建てる画面・形をえらぶ画面）。o：見つもり（大きさがわかれば定員・1日の量も）
function bFeats(p, o) {
  const f = [], ft = (t, c) => f.push(`<span class="mp-ft${c ? ' ' + c : ''}">${t}</span>`), ok = o && o.ok !== false && o.total_m2;
  const kd = p.sc ? (S.boot.sck || {})[p.sc] : null;
  if (kd) {
    const ui = FAC_UI[kd.use] || FAC_UI.leisure;
    ft(`<span>${ui.come}</span>`, 'in');
    if (ok) ft(`<span>${ui.cap} ${fmt(Math.floor(o.total_m2 / kd.spp))}人</span>`, 'in');
    ft(`<span>${ui.fee}</span> <span>${ui.unit}</span> <span>${X(kd.fee)}</span>`);
    if (kd.acc) ft(kd.use === 'school' ? '駅が近いと生徒がふえる' : '駅が近いと客がふえる', 'up');
    if (kd.rs) ft('駅の乗り降りする人も来る', 'up');
    if (kd.loc) ft('地価が高いと値段も高い', 'up');
    if (kd.pk) ft(`<span>多い月</span> ${monthsTxt(kd.pk)}`, 'up');
    if (kd.op) ft(`<span>少ない月</span> ${monthsTxt(kd.op)}`, 'dn');
  }
  if (p.mk === 'railcar') { ft('鉄鋼 → 鉄道車両', 'in'); if (ok) ft(`<span>1日に ${Math.max(1, Math.floor(o.total_m2 / ((S.boot.scr || {}).rc_m2 || 5000)))}両まで</span>`, 'in'); }
  else if (p.mk === 'ship') { ft('鉄鋼 → 船', 'in'); if (ok) ft(`<span>1日に ${fmt(Math.max(1, Math.round(o.total_m2 * ((S.boot.scr || {}).sy_tpd || 0.02))))}t まで</span>`, 'in'); }   // 造船所（t54o）
  else if (p.mk) {
    const rc = (S.boot.rcp || {})[p.mk] || {}, ins = Object.keys(rc.in || {});
    ft(`<span>${ins.map(g => esc(GN(g))).join('・')} → ${esc(GN(p.mk))}</span>`, 'in');
    if (ok && rc.r) ft(`<span>1日の生産 ${qtyS(rc.r * o.total_m2, GU(p.mk))}</span>`, 'in');
    if (p.mk === 'car') ft(`<span>バス・トラックの注文も受けられる</span>`, 'up');
  }
  if (p.k === 'ferry') { ft('港（⚓ 乗り場）と船の置き場ができる', 'in'); ft('フェリー・旅客船の航路をつくれる', 'up'); }   // t54o
  if (p.air) { ft(`<span>発着口 ${p.gates}こ</span>・<span>駐機場 ${p.hangar}機</span>`, 'in'); ft('建ててから「✈ 滑走路」で引きます', 'in'); ft('飛行機の空路をつくれる', 'up'); }   // t54p・t57
  if (p.opts) ft(`<span>つくるもの</span> ${p.opts.map(g => `<span>${esc(GN(g))}</span>`).join('・')}`, 'in');
  if (p.rb && p.rb !== 1) ft(`<span>とれる量 ${p.rb}倍</span>`, p.rb > 1 ? 'up' : 'dn');
  if (p.rl && p.rl !== 1) ft(`<span>家賃 ${p.rl}倍</span>`, p.rl > 1 ? 'up' : 'dn');
  if (p.dm && p.dm !== 1) ft(p.dm >= 1.15 ? '入りやすい' : p.dm > 1 ? 'やや入りやすい' : p.dm <= 0.7 ? '入りにくい' : 'やや入りにくい', p.dm > 1 ? 'up' : 'dn');
  if (p.pp != null && p.pp !== 1) ft(p.pp > 1 ? '人が多い（駅の乗る人がふえる）' : '人が少ない', p.pp > 1 ? 'up' : '');
  for (const [u, v] of Object.entries(p.fx || {})) ft(`<span>近くの${USE_NAME[u] || u}</span> <span>${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%</span>`, v > 0 ? 'up' : 'dn');
  if (p.mix) ft(`<span>階ごとに</span> ${[...new Set(p.mix.map(x => x[1]))].map(u => `<span>${USE_NAME[u] || u}</span>`).join('・')}`);
  else if (p.g2 === 'shop') ft('1・2階は店舗'); else if (p.g1 === 'shop') ft('1階は店舗');
  if ((p.opt || []).includes('shop1')) ft('1階を店舗にできる');
  if (p.sea) ft('海のそば');
  return f.join('');
}
async function bldStart(P) {
  const m = modal(['建物を建てる', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  const ops = await api('mp_bld_options', { p_parcel: P.id, p_as: S.as }); if (!ops) return m.close();
  const catOf = o => { const c = (pOf(o.k) || {}).cat; return CATS.includes(c) ? c : 'ind'; };
  const nOk = c => ops.filter(o => catOf(o) === c && o.ok).length, nAll = c => ops.filter(o => catOf(o) === c).length;
  let cat = 'home', only = true, qs = '';
  try { cat = localStorage.getItem('mp_bcat') || cat; only = localStorage.getItem('mp_bonly') !== '0'; } catch (e) {}
  if (!CATS.includes(cat) || !nOk(cat)) cat = CATS.find(nOk) || 'home';
  const item = o => { const p = pOf(o.k) || {}; return `<button class="mp-item" style="text-align:left${o.ok ? '' : ';opacity:.55'}" data-k="${o.k}" ${o.ok ? '' : 'disabled'}>
      <span class="mp-sw" style="background:${esc(p.c || '#bbb')}"></span><b>${esc(p.n || o.k)}</b> ${o.ok ? `<span class="mp-cost">${X(o.cost)}</span>` : ''}
      <small><br>${o.ok ? `<span>${p.f1 > 0 ? `${p.f0}〜${o.f1}階` : '平ら'}</span>・<span>部屋 ${fmt(o.units)}</span>・<span>家賃の目安 1日 ${X(o.rent_day)}</span>` : `<span>${esc(o.why || '')}</span>`}</small>
      <div class="mp-fts">${bFeats(p, o)}</div></button>`; };
  m.set('建物を建てる', `<p class="small" style="margin:0 0 6px"><span>${esc(P.ban)}</span>・<span>${fmt(P.n * 100)}㎡</span>・<span>建てられるもの ${ops.filter(o => o.ok).length}種類</span></p>
    <div class="tabs-s" style="flex-wrap:wrap" data-cats>${CATS.filter(nAll).map(c => `<button data-cat="${c}"><span>${CAT_NAME[c]}</span> <small>${nOk(c)}</small></button>`).join('')}</div>
    <div class="mp-row"><input class="mp-inp" data-q placeholder="さがす（ホテル・病院・神社など）" style="flex:1 1 150px">
      <label class="small" style="white-space:nowrap"><input type="checkbox" data-only ${only ? 'checked' : ''}> <span>建てられるものだけ</span></label></div>
    <div class="mp-list" data-items></div>
    <p class="muted small">工事費は床1㎡ごと。家賃の目安は満室・相場のとき。用途地域の建ぺい率・容積率で、建てられる広さと高さが決まります。学校・病院・ホテル・娯楽・特殊工場は、建てると「自分で使う」になります（入居募集・テナント募集にも変えられます）。緑の特徴は有利、赤は不利なところです</p>`, b => {
    const list = b.querySelector('[data-items]'), qi = b.querySelector('[data-q]'), oc = b.querySelector('[data-only]');
    const draw = () => {
      const q = qs.trim().toLowerCase();
      b.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', !q && x.dataset.cat === cat));
      const hit = o => { const n = (pOf(o.k) || {}).n || o.k; return n.toLowerCase().includes(q) || String(T(n)).toLowerCase().includes(q); };
      const os = ops.filter(o => (q ? hit(o) : catOf(o) === cat) && (!only || o.ok)).sort((a, c) => (c.ok - a.ok));
      list.innerHTML = os.map(item).join('') || `<p class="muted small">${q ? '見つかりません' : 'この分け方で建てられるものはありません（「建てられるものだけ」を外すと、理由が出ます）'}</p>`;
      list.querySelectorAll('[data-k]').forEach(x => x.onclick = () => { m.close(); bldDesign(P, pOf(x.dataset.k), ops.find(o => o.k === x.dataset.k)); });
    };
    b.querySelectorAll('[data-cat]').forEach(x => x.onclick = () => { cat = x.dataset.cat; qs = ''; qi.value = ''; try { localStorage.setItem('mp_bcat', cat); } catch (e) {} draw(); });
    qi.oninput = () => { qs = qi.value; draw(); };
    oc.onchange = () => { only = oc.checked; try { localStorage.setItem('mp_bonly', only ? '1' : '0'); } catch (e) {} draw(); };
    draw();
  });
}
/* ---- 建てる：形・階数・名前 ---- */
async function bldDesign(P, pr, o) {
  const st = { shape: o.shape || pr.sh[0], floors: o.f1 || pr.f0, opt: '', name: '' };
  const m = modal([pr.n, '']);
  const flat = pr.f1 === 0;
  m.set(pr.n, `<canvas class="mp-bprev" width="300" height="200" style="width:100%;max-width:300px;height:auto;display:block;margin:0 auto 6px;border:1px solid var(--line,#ddd);border-radius:10px;background:#eef0ea"></canvas>
    <div class="mp-fts" data-ft style="margin:0 0 4px">${bFeats(pr, o)}</div>
    ${flat ? '' : `<div class="mp-row" data-shapes>${pr.sh.map(s => `<button class="btn" data-sh="${s}">${SHAPE_NAME[s] || s}</button>`).join('')}</div>
      <div class="mp-row"><b style="white-space:nowrap">階数</b><input type="range" class="mp-fl" style="flex:1" min="${pr.f0}" max="${pr.f1}" value="${st.floors}"><b class="mp-fln" style="min-width:3.5em;text-align:right"></b></div>`}
    ${(pr.opt || []).includes('shop1') ? `<label class="mp-row small" style="gap:6px"><input type="checkbox" class="mp-opt"> <span>1階を店舗にする</span></label>` : ''}
    <div class="mp-row"><input class="mp-inp" maxlength="30" placeholder="名前（空ならおまかせ）"></div>
    <div class="mp-kv" data-q></div>
    <div class="mp-row"><button class="btn" data-est>見つもる</button><button class="btn main" data-go disabled>建てる</button></div>`, b => {
    const cv = b.querySelector('.mp-bprev'), fl = b.querySelector('.mp-fl'), fln = b.querySelector('.mp-fln'), qv = b.querySelector('[data-q]'), go = b.querySelector('[data-go]'), es = b.querySelector('[data-est]');
    let seq = 0, last = null, tmr = 0;
    const draw = q => {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
      const cells = [...(S.vis && S.vis.parcels.get(P.id) ? S.vis.parcels.get(P.id).cells : [])].map(k => k.split(',').map(Number));
      if (!cells.length) return;
      const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 1, y1 = Math.max(...ys) + 1;
      const sc = Math.min((W - 30) / (x1 - x0), (H - 30) / (y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
      g.fillStyle = 'rgba(40,110,220,.18)'; g.strokeStyle = 'rgba(30,80,170,.5)'; g.lineWidth = 1;
      for (const [x, y] of cells) { g.fillRect(ox + (x - x0) * sc, oy + (y - y0) * sc, sc, sc); g.strokeRect(ox + (x - x0) * sc + 0.5, oy + (y - y0) * sc + 0.5, sc - 1, sc - 1); }
      if (q && q.cells) {
        g.fillStyle = flat ? '#7a9a4a' : '#3f5f8f';
        for (let i = 0; i + 1 < q.cells.length; i += 2) { const x = q.cells[i], y = q.cells[i + 1]; g.fillRect(ox + (x - x0) * sc + 1, oy + (y - y0) * sc + 1, sc - 2, sc - 2); }
        g.fillStyle = '#fff'; g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (q.floors > 0) g.fillText(T(`${q.floors}階`), W / 2, H - 9 > oy + (y1 - y0) * sc ? H - 9 : 10);
      }
    };
    // 見つもりは「見つもる」を押してから。形・階数を変えたら、やりなおし
    const changed = () => { ++seq; last = null; go.disabled = true; qv.innerHTML = '<b>見つもり</b><span class="muted small">「見つもる」を押すと、工事費と部屋が出ます</span>'; draw(null); };
    const quote = async () => {
      const my = ++seq; go.disabled = true; qv.innerHTML = '<b>見つもり</b><span class="muted small">見つもり中…</span>';
      const q = await api('mp_bld_quote', { p_parcel: P.id, p_kind: pr.k, p_shape: st.shape, p_floors: st.floors, p_opt: st.opt, p_as: S.as });
      if (my !== seq) return;
      last = q; draw(q);
      if (!q) { qv.innerHTML = '<b>見つもり</b><span class="mp-warn">建てられません</span>'; return; }
      const fe = b.querySelector('[data-ft]'); if (fe) fe.innerHTML = bFeats(pr, q);
      if (fl) { fl.min = q.f0; fl.max = q.f1; if (Number(fl.value) !== q.floors) fl.value = q.floors; st.floors = q.floors; }
      if (fln) fln.textContent = T(`${q.floors}階`);
      const uses = Object.entries(q.uses || {}).map(([u, n]) => `<span>${USE_NAME[u] || u}</span> <span>${n}</span>`).join('・');
      qv.innerHTML = `<b>延床面積</b><span>${fmt(q.total_m2)}㎡${q.floors > 0 ? `<small>（1階 ${fmt(q.fm2)}㎡）</small>` : ''}</span>
        <b>部屋</b><span><span>${fmt(q.units)}</span>${uses ? `<small>（${uses}）</small>` : ''}</span>
        <b>工事費</b><span class="mp-cost">${X(q.cost)}</span>
        <b>家賃の目安</b><span>1日 ${X(q.rent_day)}<small>（満室・相場）</small></span>`;
      go.disabled = false;
    };
    const sync = () => { b.querySelectorAll('[data-sh]').forEach(x => x.classList.toggle('main', x.dataset.sh === st.shape)); };
    b.querySelectorAll('[data-sh]').forEach(x => x.onclick = () => { st.shape = x.dataset.sh; st.floors = 999; sync(); changed(); });
    if (fl) fl.oninput = () => { st.floors = Number(fl.value); if (fln) fln.textContent = T(`${st.floors}階`); changed(); };
    const op = b.querySelector('.mp-opt'); if (op) op.onchange = () => { st.opt = op.checked ? 'shop1' : ''; changed(); };
    es.onclick = () => quote();
    b.querySelector('.mp-inp').oninput = e => { st.name = e.target.value; };
    go.onclick = async () => {
      if (!last) return;
      const msg = last.floors > 0 ? T(`${pr.n}（${last.floors}階・${fmt(last.total_m2)}㎡）を建てます（${fmt(last.cost)} X）。よろしいですか？`)
        : T(`${pr.n}（${fmt(last.total_m2)}㎡）を建てます（${fmt(last.cost)} X）。よろしいですか？`);
      if (!confirm(msg)) return;
      go.disabled = true;
      const r = await api('mp_bld_build', { p_parcel: P.id, p_kind: pr.k, p_shape: st.shape, p_floors: st.floors, p_opt: st.opt, p_name: st.name, p_as: S.as }, '建てました');
      go.disabled = false;
      if (r) { m.close(); refreshP(P); sheet(null); openBld(r.id); }
    };
    sync(); changed(); if (fln) fln.textContent = T(`${st.floors}階`);
  });
}

/* ---- 建物を見る：部屋・テナント・家賃の水準 ---- */
async function openBld(bid) {
  const m = modal(['建物', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  const sel = new Set();
  const load = async () => {
    const d = await api('mp_bld_get', { p_bld: bid }); if (!d) return m.close();
    if (d.mine && d.units.length === 1 && !sel.size) sel.add(d.units[0].id);   // 部屋が1つ（学校・施設・工場など）は、はじめからえらんでおく
    const floors = [...new Set(d.units.map(u => u.f))];
    const stat = u => u.tk === 'corp' ? `<span>${esc(u.tn || '')}</span><small>（テナント）</small>` : u.tk === 'npc' ? `<span>${esc(u.tn || '')}</span>`
      : u.mode === 'self' ? '<span>自分で使う</span>' : u.mode === 'corp' ? `<span class="mp-warn">テナント募集中</span>` : '<span class="muted">空き</span>';
    const row = u => `<div class="mp-urow" data-u="${u.id}">
        ${d.mine ? `<input type="checkbox" data-c="${u.id}" ${sel.has(u.id) ? 'checked' : ''}>` : ''}
        <b>${esc(u.room)}</b><span><span>${USE_NAME[u.use] || u.use}</span>・<span>${fmt(u.m2)}㎡</span>${d.mine ? `・<small>${MODE_NAME[u.mode]}</small>` : ''}</span>
        <span class="st">${stat(u)}</span>
        <span class="rt">${u.tk ? `1日 ${X(u.rent)}` : u.mode === 'corp' ? `1日 ${X(u.ask)}` : ''}</span>
        ${d.mine && u.tk === 'corp' ? `<button class="btn" data-out="${u.id}">退去してもらう</button>` : ''}
        ${!d.mine && u.mode === 'corp' && !u.tk ? `<button class="btn main" data-lease="${u.id}">借りる</button>` : ''}
        ${!d.mine && u.tk === 'corp' && u.tmine ? `<button class="btn" data-leave="${u.id}">退去する</button>` : ''}</div>`;
    const dm = d.dem || {}, star = v => '★'.repeat(Math.max(1, Math.min(5, Math.round((v || 0) * 2.5))));
    const mainUses = [...new Set(d.units.map(u => u.use))];
    m.set(d.name || kindName(d.kind), `<div class="mp-kv">
        <b>種類</b><span><span>${esc(d.kname)}</span>${d.floors > 0 ? `・<span>${d.floors}階</span>・<span>${SHAPE_NAME[d.shape] || d.shape}</span>` : ''}</span>
        <b>住所</b><span translate="no">${esc(d.addr)}</span>
        <b>持ち主</b><span><span>${esc(d.owner)}</span>${d.mine ? '<small>（あなた）</small>' : ''}</span>
        <b>延床面積</b><span>${fmt(d.fm2 * Math.max(1, d.floors))}㎡</span>
        ${mainUses.length ? `<b>入りやすさ</b><span>${mainUses.map(u => `<span>${USE_NAME[u] || u}</span> <span style="color:#d89a00">${star(dm[u])}</span>`).join('・')}</span>` : ''}
        ${d.mine ? `<b>入居</b><span>${d.day.occ} / ${d.day.n}</span><b>家賃</b><span>1日 ${X(d.day.rent)}</span>
          <b>家賃の水準</b><span><input type="range" min="50" max="200" step="5" value="${Math.round(d.rent_lv * 100)}" class="mp-lv" style="width:55%;vertical-align:middle"> <b class="mp-lvn">${Math.round(d.rent_lv * 100)}%</b> <button class="btn" data-lvset style="padding:2px 8px">決める</button></span>` : ''}
      </div>
      ${scBlock(d)}${portBlock(d)}
      ${d.gov ? `<p class="muted small" style="margin:2px 0 6px">国の建物です（税・家賃はありません）</p>` : ''}
      ${d.gov && OFFICE_K.includes(d.kind) ? '<div class="mp-row"><button class="btn main" data-jm>🏛 住民の窓口</button><small class="muted">転入・転居・転出・住民票の写し・印鑑登録</small></div>' : ''}
      ${d.mine ? `<p class="muted small" style="margin:2px 0 6px">家賃の水準は入居募集の部屋の家賃（相場の何%か）。高いと入りにくく、出ていきやすくなります。店・事務所などを自分で使うか会社が借りると、売上が入ります</p>
        <div class="mp-row" data-bulk><small data-n>${sel.size}室えらんでいます</small>
          <button class="btn" data-all>ぜんぶえらぶ</button><button class="btn" data-none>えらばない</button></div>
        <div class="mp-row"><button class="btn" data-mode="npc">入居募集にする</button><button class="btn" data-mode="self">自分で使う</button>
          <button class="btn" data-mode="corp">テナント募集にする</button><input class="mp-inp mp-num" data-ask inputmode="numeric" placeholder="家賃/日" style="width:110px"></div>
        ${ownCorps(d).length ? '<div class="mp-row"><button class="btn" data-own>🏢 自社のオフィスにする</button><small class="muted">自分の会社をすぐ入れる</small></div>' : ''}` : ''}
      <div data-units>${floors.map((f, i) => { const us = d.units.filter(u => u.f === f); return `<details ${i < 3 || floors.length <= 6 ? 'open' : ''} class="mp-floor">
        <summary><b>${f > 0 ? T(`${f}階`) : T('地上')}</b> <small><span>${us.length}室</span>・<span>入居 ${us.filter(u => u.tk || u.mode === 'self').length}</span></small></summary>
        ${us.map(row).join('')}</details>`; }).join('')}</div>
      ${d.mine ? `<div class="mp-row"><button class="btn" data-ren>名前を変える</button><button class="btn" data-del style="color:#c33">こわす</button></div>` : ''}`, b => {
      scBind(b, d, load);
      const nEl = b.querySelector('[data-n]');
      const upd = () => { if (nEl) nEl.textContent = T(`${sel.size}室えらんでいます`); };
      b.querySelectorAll('[data-c]').forEach(x => x.onchange = () => { const id = Number(x.dataset.c); if (x.checked) sel.add(id); else sel.delete(id); upd(); });
      const q = k => b.querySelector(k);
      b.querySelectorAll('[data-prt]').forEach(a => a.onclick = ev => { ev.preventDefault(); m.close(); openDia(Number(a.dataset.prt)); });   // 港（t54o）
      if (q('[data-pcars]')) q('[data-pcars]').onclick = () => { m.close(); openCars(d.port.dep); };
      if (q('[data-pnew]')) q('[data-pnew]').onclick = () => { m.close(); sheet(null); routeBuild(d.port.k === 'air' ? 'air' : 'ship'); };
      if (q('[data-pslot]')) q('[data-pslot]').onclick = () => { m.close(); openSlots(d.port.sta); };   // t57
      if (q('[data-jm]')) q('[data-jm]').onclick = () => { m.close(); openJuumin(bid); };   // 住民の窓口（t59）
      if (q('[data-all]')) q('[data-all]').onclick = () => { d.units.forEach(u => sel.add(u.id)); b.querySelectorAll('[data-c]').forEach(x => x.checked = true); upd(); };
      if (q('[data-none]')) q('[data-none]').onclick = () => { sel.clear(); b.querySelectorAll('[data-c]').forEach(x => x.checked = false); upd(); };
      b.querySelectorAll('[data-mode]').forEach(x => x.onclick = async () => {
        if (!sel.size) return toast(T('部屋をえらんでください'));
        const mode = x.dataset.mode, ask = q('[data-ask]') && hw(q('[data-ask]').value).replace(/[^\d]/g, '');
        if (await api('mp_unit_set', { p_units: [...sel], p_mode: mode, p_ask: mode === 'corp' && ask ? Number(ask) : null, p_as: S.as }, '変えました')) { sel.clear(); load(); }
      });
      if (q('[data-own]')) q('[data-own]').onclick = () => {
        if (!sel.size) return toast(T('部屋をえらんでください'));
        const us = d.units.filter(u => sel.has(u.id));
        if (us.some(u => u.use === 'home')) return toast(T('住居には会社は入れません（店・事務所などの部屋をえらんでください）'));
        unitOwn(d, us, () => { sel.clear(); load(); });
      };
      const lv = q('.mp-lv'); if (lv) { lv.oninput = () => { q('.mp-lvn').textContent = lv.value + '%'; }; q('[data-lvset]').onclick = async () => { if (await api('mp_bld_set', { p_bld: bid, p_name: null, p_rent_lv: Number(lv.value) / 100, p_as: S.as }, '家賃の水準を変えました')) load(); }; }
      b.querySelectorAll('[data-out]').forEach(x => x.onclick = async () => { if (!confirm(T('テナントの会社に退去してもらいます。よろしいですか？'))) return; if (await api('mp_unit_leave', { p_unit: Number(x.dataset.out), p_as: S.as }, '退去してもらいました')) load(); });
      b.querySelectorAll('[data-lease]').forEach(x => x.onclick = () => leaseUnit(Number(x.dataset.lease), d.units.find(u => u.id === Number(x.dataset.lease)), load));
      b.querySelectorAll('[data-leave]').forEach(x => x.onclick = async () => { if (!confirm(T('この部屋から退去します。よろしいですか？'))) return; const u = d.units.find(z => z.id === Number(x.dataset.leave)); if (await api('mp_unit_leave', { p_unit: u.id, p_as: corpOf(u) }, '退去しました')) load(); });
      if (q('[data-ren]')) q('[data-ren]').onclick = async () => { const nm = prompt(T('建物の名前（30文字まで）'), d.name); if (nm == null) return; if (await api('mp_bld_set', { p_bld: bid, p_name: nm, p_rent_lv: null, p_as: S.as }, '名前を変えました')) { load(); refreshBld(d); } };
      if (q('[data-del]')) q('[data-del]').onclick = async () => {
        if (!confirm(T(`「${d.name || d.kname}」をこわします（工事費はもどりません。テナントの会社には知らせます）。よろしいですか？`))) return;
        if (await api('mp_bld_demolish', { p_bld: bid, p_as: S.as }, 'こわしました')) { m.close(); refreshBld(d); sheet(null); }
      };
    });
  };
  load();
}
/* ---- 建物の事業（t54k）：学校（生徒・授業料）・工場（つくるもの・在庫・仕入れ・売上）・田畑と港（つくるもの）・鉄道車両工場 ---- */
function scBlock(d) {
  const s = d.sc; if (!s) return '';
  const ui = FAC_UI[s.use] || (s.kind === 'school' ? FAC_UI.school : FAC_UI.leisure);
  const opRow = s.gov ? '' : `<b>動かしている</b><span>${s.op ? `<span>${esc(s.who || '')}</span>` : s.npc ? `<span>${ui.npc}（入居募集）</span>`
    : `<span class="mp-warn">止まっています</span> <small>（自分で使うか、会社が借りると動きます）</small>${d.mine && d.units.length ? ' <button class="btn main" data-scself style="padding:2px 10px">自分で使う</button>' : ''}`}</span>`;
  if (s.kind === 'fac' || s.kind === 'school') {   // 施設（t54l）：学校・宿泊・医療と福祉・娯楽
    const k = (S.boot.sck || {})[s.grp] || {}, lv = Math.round((s.lv || 1) * 100), mo = new Date().getMonth() + 1;
    const ssn = (k.pk || k.op) ? `<b>季節</b><span>${k.pk ? `<span>多い月</span> ${monthsTxt(k.pk)} <small>（1.3倍）</small>` : ''}${k.pk && k.op ? '・' : ''}${k.op ? `<span>少ない月</span> ${monthsTxt(k.op)} <small>（0.75倍）</small>` : ''}${(k.pk || []).includes(mo) ? ' <b style="color:#23864a">いまは多い月</b>' : (k.op || []).includes(mo) ? ' <b style="color:#c0392b">いまは少ない月</b>' : ''}</span>` : '';
    const how = s.use === 'school' || s.kind === 'school' ? '<span>生徒は、まわりの人（その年ごろの人）から通ってきます。同じ種類の学校が近くにあると分けあいます。</span>'
      : s.use === 'hotel' ? '<span>宿泊客は、近くの駅の乗り降りする人（旅の人）と、まわりの人から来ます。同じ種類の宿が近くにあると分けあいます。地価が高いところは宿泊料も高くなります。</span>'
      : s.use === 'hospital' ? '<span>患者・利用者は、まわりの人から来ます。同じ種類の病院・施設が近くにあると分けあいます。</span>'
      : '<span>来場者は、まわりの人と、近くの駅の乗り降りする人から来ます。同じ種類の施設が近くにあると分けあいます。</span>';
    return `<h4 style="margin:12px 0 4px">${ui.ic} <span>${esc(k.n || ui.who)}</span></h4><div class="mp-kv">
      <b>${ui.who}</b><span><span>${fmt(s.n || 0)}人</span> / <span>${ui.cap} ${fmt(s.cap || 0)}人</span></span>
      ${s.pool != null ? `<b>${ui.pool}</b><span><span>${fmt(s.pool)}人</span>${k.acc ? ` <small>（${s.acc >= 1 ? '駅が近い' : s.acc >= 0.8 ? 'バス停が近い' : '駅・バス停が遠い'}）</small>` : ''}</span>` : ''}
      ${(s.sta || []).length ? `<b>近くの駅</b><span>${s.sta.map(n => `<span translate="no">${esc(n)}</span>`).join('・')}</span>` : ''}
      ${ssn}${opRow}
      ${s.gov ? '' : `<b>${ui.fee}</b><span><span>${ui.unit}</span> <span>${X(s.fee)}</span> <small>（水準 ${lv}%）</small></span>`}
      ${s.can && s.day != null ? `<b>${ui.day}</b><span>${X(s.day)}</span>` : ''}
      ${s.can ? `<b>${ui.lv}</b><span><input type="range" min="50" max="200" step="5" value="${lv}" class="mp-sclv" style="width:55%;vertical-align:middle"> <b class="mp-sclvn">${lv}%</b> <button class="btn" data-sclv style="padding:2px 8px">決める</button></span>` : ''}
      </div>
      <p class="muted small" style="margin:2px 0 6px">${how}${k.acc ? '<span>駅・バス停が近いとふえます。</span>' : ''}<span>近くの駅・バス停の乗る人にふえます（次の日から）。</span>${s.gov ? '' : `<span>自分で使うか会社が借りると、${ui.fee}（人件費などをひいた分）が1時間ごとに入ります。水準が高いと減ります。</span>`}</p>`;
  }
  const st = s.stock || {}, stock = Object.keys(st).length ? gSort(st).map(([g, q]) => qG(g, q)).join('・') : '<span class="muted">なし</span>';
  const prodSel = s.can && s.opts ? `<b>つくるもの</b><span><select class="mp-inp" data-scprod style="width:auto"><option value="">ふつう（いままでどおり）</option>${s.opts.map(g => `<option value="${g}" ${s.prod === g ? 'selected' : ''}>${esc(GN(g))}</option>`).join('')}</select> <button class="btn" data-scprodset style="padding:2px 8px">決める</button></span>` : '';
  if (s.kind === 'none') {
    return s.can ? `<h4 style="margin:12px 0 4px">🚚 <span>物流</span></h4><div class="mp-kv">${prodSel}</div>
      <p class="muted small" style="margin:2px 0 6px">${s.opts.includes('wheat') ? '<span>「小麦」にすると、つくった小麦を近くの製粉工場に売ります（売れのこりは市場へ）。</span>' : '<span>「鉄鉱石」「原油」にすると、船で仕入れて近くの製鉄所・石油化学工場に売ります（売れのこりは市場へ）。</span>'}<span>「ふつう」は、いままでどおりの売上です。</span></p>` : '';
  }
  const day = s.day || {}, A = k => (day[k] || {}).a || 0, Q = k => (day[k] || {}).q || {};
  const qs = k => gSort(Q(k)).map(([g, q]) => qG(g, q)).join('・');
  const sales = A('sell') + A('shop') + A('mkt') + A('rc'), costs = A('buy') + A('imp') + A('ship') + A('cost');
  const dayRows = s.can ? `<b>24時間</b><span>
      ${Object.keys(Q('make')).length ? `<span>つくった</span> ${qs('make')}<br>` : ''}
      ${A('buy') ? `<span>仕入れ</span> ${X(A('buy'))} <small>（${qs('buy')}）</small><br>` : ''}${A('imp') ? `<span>輸入</span> ${X(A('imp'))} <small>（${qs('imp')}）</small><br>` : ''}
      ${A('sell') ? `<span>工場に売った</span> ${X(A('sell'))}<br>` : ''}${A('shop') ? `<span>お店に売った</span> ${X(A('shop'))}<br>` : ''}${A('mkt') ? `<span>市場に売った</span> ${X(A('mkt'))}<br>` : ''}${A('rc') ? `<span>車両の売上</span> ${X(A('rc'))}<br>` : ''}
      ${Object.keys(Q('own')).length ? `<span>自分のトラックで運んだ</span> ${qs('own')} <small>（運送費なし）</small><br>` : ''}
      ${A('ship') ? `<span>運送費</span> ${X(A('ship'))}<br>` : ''}${A('cost') ? `<span>材料・人件費など</span> ${X(A('cost'))}<br>` : ''}
      <b><span>売上 ${X(sales)}</span>・<span>費用 ${X(costs)}</span></b></span>` : '';
  const flows = s.can && (s.flows || []).length ? `<b>仕入れ先・売り先</b><span>${s.flows.map(f => `<span>${f.k === 'buy' ? '←' : '→'} <span translate="no">${esc(f.peer)}</span> ${qG(f.g, f.q)} <small>（${f.km}km・${X(f.a)}）</small></span>`).join('<br>')}</span>` : '';
  const impRow = s.can && s.kind !== 'raw' ? `<b>輸入</b><span><label class="small"><input type="checkbox" data-scimp ${s.imp ? 'checked' : ''}> <span>近くで買えないときは輸入する（値段の${Math.round(((S.boot.scr || {}).imp || 1.2) * 100)}%）</span></label></span>` : '';
  if (s.kind === 'railcar') {
    const lv = Math.round((s.lv || 0.9) * 100);
    return `<h4 style="margin:12px 0 4px">🚃 <span>鉄道車両工場</span></h4><div class="mp-kv">
      <b>つくるもの</b><span><span>鉄道車両（鉄鋼から）</span>・<span>1日に ${s.capd}両まで</span></span>
      <b>在庫</b><span>${stock}</span>
      ${opRow}
      <b>注文の待ち</b><span>${s.wait > 0 ? `あと${s.wait}時間` : 'なし'}</span>
      <b>値段</b><span><span>定価の${lv}%</span> <small>（自分の注文は部品代 ${Math.round((s.parts || 0.45) * 100)}%）</small></span>
      ${s.can ? `<b>値段の水準</b><span><input type="range" min="40" max="150" step="5" value="${lv}" class="mp-sclv" style="width:55%;vertical-align:middle"> <b class="mp-sclvn">${lv}%</b> <button class="btn" data-sclv style="padding:2px 8px">決める</button></span>` : ''}
      ${impRow}${dayRows}</div>
      <p class="muted small" style="margin:2px 0 6px"><span>≡ →「車両と編成」で車両を注文するときに、この工場をえらべます（1両に、車両の重さの8割の鉄鋼を使います）。</span><span>工場を動かしている名義の注文は、部品代と鉄鋼だけ。ほかの人・会社には値段の水準で売ります（部品代は工場が払います）。</span><span>鉄鋼は、近くの製鉄所からトラックで仕入れます（3日分）。</span></p>`;
  }
  if (s.kind === 'ship') {   // 造船所（t54o）
    const lv = Math.round((s.lv || 0.9) * 100);
    return `<h4 style="margin:12px 0 4px">🚢 <span>造船所</span></h4><div class="mp-kv">
      <b>つくるもの</b><span><span>船（鉄鋼から）</span>・<span>1日に ${fmt(s.tpd || 0)}t まで</span></span>
      <b>在庫</b><span>${stock}</span>
      ${opRow}
      <b>注文の待ち</b><span>${s.wait > 0 ? `あと${s.wait}時間` : 'なし'}</span>
      <b>値段</b><span><span>定価の${lv}%</span> <small>（自分の注文は部品代 ${Math.round((s.parts || 0.45) * 100)}%）</small></span>
      ${s.can ? `<b>値段の水準</b><span><input type="range" min="40" max="150" step="5" value="${lv}" class="mp-sclv" style="width:55%;vertical-align:middle"> <b class="mp-sclvn">${lv}%</b> <button class="btn" data-sclv style="padding:2px 8px">決める</button></span>` : ''}
      ${impRow}${dayRows}</div>
      <p class="muted small" style="margin:2px 0 6px"><span>≡ →「車両と編成」で港をえらんで船を注文するときに、この造船所をえらべます（1隻に、総トン数の${Math.round((s.steelr || 0.3) * 100)}%の鉄鋼を使います。納車は、1日につくれる重さで順番に）。</span><span>造船所を動かしている名義の注文は、部品代と鉄鋼だけ。ほかの人・会社には値段の水準で売ります（部品代は造船所が払います）。</span><span>鉄鋼は、近くの製鉄所からトラックで仕入れます（3日分）。</span></p>`;
  }
  const rc = (S.boot.rcp || {})[s.prod] || {}, ins = Object.entries(s.ins || rc.in || {});
  const what = ins.length ? `${ins.map(([g, k]) => qG(g, k)).join('・')} → ${qG(s.prod, 1)}` : `<span>${esc(GN(s.prod))}</span>`;
  return `<h4 style="margin:12px 0 4px">${s.kind === 'raw' ? '🚚' : '🏭'} <span>${s.kind === 'raw' ? '物流' : '工場'}</span></h4><div class="mp-kv">
    ${prodSel || `<b>つくるもの</b><span>${what}</span>`}
    ${s.per_day != null ? `<b>1日の生産</b><span>${qtyS(s.per_day, GU(s.prod))}</span>` : ''}
    <b>在庫</b><span>${stock}</span>
    ${s.rd ? `<b>バス・トラック</b><span><span>注文を受ける：1日に ${s.rd.capd}台まで</span>・<span>${s.rd.wait > 0 ? `待ち あと${s.rd.wait}時間` : '待ちなし'}</span><br>
      <span>値段：定価の${Math.round((s.rd.lv || 0.9) * 100)}%</span> <small>（自分の注文は部品代 ${Math.round((s.rd.parts || 0.45) * 100)}%）</small></span>
      ${s.can ? `<b>値段の水準</b><span><input type="range" min="40" max="150" step="5" value="${Math.round((s.rd.lv || 0.9) * 100)}" class="mp-sclv" style="width:55%;vertical-align:middle"> <b class="mp-sclvn">${Math.round((s.rd.lv || 0.9) * 100)}%</b> <button class="btn" data-sclv style="padding:2px 8px">決める</button></span>` : ''}` : ''}
    ${opRow}${impRow}${dayRows}${flows}</div>
    <p class="muted small" style="margin:2px 0 6px">${s.kind === 'raw' ? `<span>${s.prod === 'wheat' ? 'つくった小麦は、近くの製粉工場がトラックで買います（種・肥料などは値段の2割）。' : '船で仕入れた分（値段の6割）を、近くの工場がトラックで買います。'}</span>`
      : '<span>材料は1時間ごとに、近くの工場・田畑・港の在庫からトラックで仕入れます（市場の値段＋運送費）。輸入のほうが安いとき・足りないときは輸入します。</span>'}<span>売れのこり（6時間分をこえる分）は市場へ（値段の85%）。</span>${s.prod === 'food' ? '<span>食品は近くのお店へ（人・会社が使っているお店には小売のもうけ）。</span>' : ''}${['car', 'elec'].includes(s.prod) ? '<span>できたものは市場へ（値段のまま）。</span>' : ''}${s.rd ? '<span>≡ →「車両と編成」でバス・トラックを注文するときに、この工場をえらべます（1台に、車両の重さの8割の鉄鋼を使います）。工場を動かしている名義の注文は、部品代と鉄鋼だけ。</span>' : ''}<span>自分の名義のトラック（バスの営業所に置く）があると、そのぶん運送費がかかりません。</span><span>未払いがあると止まります。</span></p>`;
}
// 港（フェリーターミナル。t54o）：乗り場・船の数・航路
function portBlock(d) {
  const p = d.port; if (!p) return '';
  if (p.k === 'air' && d.gov) return `<h4 style="margin:12px 0 4px">✈ <span>国の空港</span></h4><div class="mp-kv">
      <b>ターミナル</b><span translate="no">${esc(p.name || '')}</span>
      <b>滑走路</b><span>${p.rwy > 0 ? `<span>${fmt(p.rwy)}m（いちばん長い滑走路）</span>` : '<span class="mp-warn">まだありません（飛行機は飛べません）</span>'}</span>
      <b>発着口</b><span><span>${p.gates || 0}こ</span>（<span>1つで1時間に1便</span>）</span>
      <b>飛行機</b><span><span>${p.n || 0} / ${p.cap || 0}機</span>（みんなで使う）</span>
      <b>使用料</b><span>${p.ln != null ? `<span>空路に入れると 1路線・1日 ${X(p.ln)}（国庫へ）</span>` : '<span>いまは新しい空路に使えません</span>'}</span>
      <b>空路</b><span>${(p.routes || []).map(r => `<a href="#" data-prt="${r.id}" style="color:${esc(r.c)};font-weight:800">■ ${esc(r.n)}</a>`).join('<br>') || 'なし'}</span></div>
    <div class="mp-row"><button class="btn" data-pcars>飛行機を見る・注文する</button><button class="btn" data-pnew>＋ 空路</button><button class="btn" data-pslot>🛫 発着口・入札</button></div>
    <p class="muted small" style="margin:2px 0 6px"><span>国の空港です（空港は国が建てます）。だれでも駐機場に飛行機を置いて、空路に使えます。空路に入れると、1路線・1日の使用料を国にはらいます。滑走路より長い滑走路がいる飛行機は、この空港に置けず、離着陸もできません</span>。<span>この空港を出る便は、1時間に、持っている発着口の数まで（発着口の権利は入札で買います）</span></p>`;
  if (p.k === 'air') return `<h4 style="margin:12px 0 4px">✈ <span>空港</span></h4><div class="mp-kv">
      <b>ターミナル</b><span translate="no">${esc(p.name || '')}</span>
      <b>滑走路</b><span>${p.rwy > 0 ? `<span>${fmt(p.rwy)}m（いちばん長い滑走路）</span>` : '<span class="mp-warn">まだありません（飛行機は飛べません）</span>'}</span>
      <b>発着口</b><span><span>${p.gates || 0}こ</span>（<span>1つで1時間に1便</span>）</span>
      <b>飛行機</b><span><span>${p.n || 0} / ${p.cap || 0}機</span></span>
      <b>貸し出し</b><span>${p.ln != null ? `<span>ほかの人・会社に貸しています（1系統・1日 ${X(p.ln)}）</span>` : '<span>ほかの人・会社には貸していません</span>'}</span>
      <b>空路</b><span>${(p.routes || []).map(r => `<a href="#" data-prt="${r.id}" style="color:${esc(r.c)};font-weight:800">■ ${esc(r.n)}</a>`).join('<br>') || 'なし'}</span></div>
    ${d.mine ? '<div class="mp-row"><button class="btn" data-pcars>飛行機を見る・注文する</button><button class="btn" data-pnew>＋ 空路</button></div>' : ''}
    <p class="muted small" style="margin:2px 0 6px">空港の乗り場（✈）は、建物のまん中にあります。✈ をタップすると、名前を変えたり、ほかの人・会社に貸し出したりできます。滑走路より長い滑走路がいる飛行機は、この空港に置けず、離着陸もできません。建物をこわすと空港もなくなります（飛行機や空路があるときは、こわせません）</p>`;
  return `<h4 style="margin:12px 0 4px">⚓ <span>フェリーの港</span></h4><div class="mp-kv">
      <b>乗り場</b><span translate="no">${esc(p.name || '')}</span>
      <b>船</b><span><span>${p.n || 0} / ${p.cap || 0}隻</span></span>
      <b>貸し出し</b><span>${p.ln != null ? `<span>ほかの人・会社に貸しています（1系統・1日 ${X(p.ln)}）</span>` : '<span>ほかの人・会社には貸していません</span>'}</span>
      <b>航路</b><span>${(p.routes || []).map(r => `<a href="#" data-prt="${r.id}" style="color:${esc(r.c)};font-weight:800">■ ${esc(r.n)}</a>`).join('<br>') || 'なし'}</span></div>
    ${d.mine ? '<div class="mp-row"><button class="btn" data-pcars>船を見る・注文する</button><button class="btn" data-pnew>＋ 航路</button></div>' : ''}
    <p class="muted small" style="margin:2px 0 6px">港の乗り場（⚓）は、建物のそばの海の上にあります。⚓ をタップすると、名前を変えたり、ほかの人・会社に貸し出したりできます。建物をこわすと港もなくなります（船や航路があるときは、こわせません）</p>`;
}
function scBind(b, d, load) {
  const s = d.sc; if (!s || !s.can) return;
  const as = d.own_as || s.as || S.as, q = k => b.querySelector(k);
  const sf = q('[data-scself]'); if (sf) sf.onclick = async () => {   // 止まっている施設・工場を、自分で使う（t54m）
    sf.disabled = true;
    const r = await api('mp_unit_set', { p_units: d.units.map(u => u.id), p_mode: 'self', p_ask: null, p_as: d.own_as || S.as }, '自分で使うようにしました');
    sf.disabled = false; if (r) load();
  };
  const lv = q('.mp-sclv'); if (lv) { lv.oninput = () => { q('.mp-sclvn').textContent = lv.value + '%'; };
    q('[data-sclv]').onclick = async () => { if (await api('mp_sc_set', { p_bld: d.id, p_prod: null, p_imp: null, p_lv: Number(lv.value) / 100, p_as: as }, s.use === 'school' || s.kind === 'school' ? '授業料の水準を変えました' : s.use === 'hotel' ? '宿泊料の水準を変えました' : s.kind === 'fac' ? '料金の水準を変えました' : '値段の水準を変えました')) load(); }; }
  const im = q('[data-scimp]'); if (im) im.onchange = async () => { if (await api('mp_sc_set', { p_bld: d.id, p_prod: null, p_imp: im.checked, p_lv: null, p_as: as }, '変えました')) load(); else im.checked = !im.checked; };
  const ps = q('[data-scprodset]'); if (ps) ps.onclick = async () => {
    const v = q('[data-scprod]').value;
    if (!confirm(T(v ? `つくるものを「${GN(v)}」にします。よろしいですか？` : 'つくるものを「ふつう」にもどします（在庫は市場に売ります）。よろしいですか？'))) return;
    if (await api('mp_sc_set', { p_bld: d.id, p_prod: v, p_imp: null, p_lv: null, p_as: as }, '変えました')) load();
  };
}
// 自社のオフィス：入れられる自分の会社（建物の持ち主の会社はのぞく）
function ownCorps(d) { return (S.boot.as || []).filter(a => a.as !== 'me' && a.as !== 'gov' && a.as !== d.own_as); }
function unitOwn(d, us, after) {
  const corps = ownCorps(d), mr = us.reduce((a, u) => a + (u.mr || 0), 0);
  const m = modal(['自社のオフィスにする', `<p class="small" style="margin:0 0 6px"><span>${esc(d.name || d.kname)}</span>：<span>${us.map(u => esc(u.room)).join('・')}</span></p>
    <p class="small"><span>えらんだ部屋に、自分の会社をすぐ入れます。</span><span>店・事務所などの売上（外の客から）は、その会社に入ります。</span></p>
    <div class="mp-row"><select class="mp-inp" data-co style="width:auto">${corps.map(a => `<option value="${esc(a.as)}">${esc(asLabel(a))}</option>`).join('')}</select></div>
    <div class="mp-row"><span>家賃 1日</span> <input class="mp-inp mp-num" data-rent inputmode="numeric" value="0" style="width:120px"> <span>X</span></div>
    <p class="muted small"><span>家賃は1時間ごとに、会社から建物の持ち主へ払います（0 X なら払いません）。</span><br><span>相場は1日 ${X(mr)}</span></p>
    <div class="mp-row"><button class="btn main" data-ok>入れる</button></div>`], b => {
    b.querySelector('[data-ok]').onclick = async () => {
      const co = b.querySelector('[data-co]').value, rent = Number(hw(b.querySelector('[data-rent]').value || '0').replace(/[^\d]/g, '') || 0);
      if (await api('mp_unit_own', { p_units: us.map(u => u.id), p_corp: co, p_rent: rent, p_as: d.own_as || S.as }, '自社のオフィスにしました')) { m.close(); if (after) after(); }
    };
  });
}
function refreshBld(d) { const P = S.vis && S.vis.parcels.get(d.parcel); if (P) refreshP(P); else { for (const c of S.cells.values()) c.stale = true; S.dirty = true; } }
// 自分の会社のうち、この部屋を借りている会社（名義）
function corpOf(u) { const a = (S.boot.as || []).find(x => x.as !== 'me' && x.as !== 'gov' && x.name === u.tn); return a ? a.as : S.as; }
// 会社で借りる（名義が会社でなければ、えらぶ）
async function leaseUnit(id, u, after) {
  const corps = (S.boot.as || []).filter(a => a.as !== 'me' && a.as !== 'gov');
  if (!corps.length) return toast(T('テナントとして借りられるのは会社だけです（会社をつくると借りられます）'));
  let as = corps.some(a => a.as === S.as) ? S.as : null;
  if (!as) {
    if (corps.length === 1) as = corps[0].as;
    else {
      const k = prompt(T('借りる会社の番号：') + '\n' + corps.map((a, i) => `${i + 1}. ${asLabel(a)}`).join('\n'), '1'); if (k == null) return;
      const a = corps[Number(k) - 1]; if (!a) return toast(T('番号がちがいます')); as = a.as;
    }
  }
  const nm = asLabel(corps.find(a => a.as === as));
  if (!confirm(T(`${nm}が借ります（家賃 1日 ${fmt(u ? u.ask : 0)} X・1時間ごとに会社から払います）。よろしいですか？`))) return;
  if (await api('mp_unit_lease', { p_unit: id, p_as: as }, '借りました')) { if (after) after(); }
}

/* ---- テナント募集（会社で借りる）・借りている部屋 ---- */
async function openTenants() {
  const m = modal(['テナント募集', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  let use = '', tab = 'find';
  const v = view(), box = [Math.floor(v.x0) - 20, Math.floor(v.y0) - 20, Math.ceil(v.x1) + 20, Math.ceil(v.y1) + 20];
  const load = async () => {
    const corps = (S.boot.as || []).filter(a => a.as !== 'me' && a.as !== 'gov');
    const head = `<div class="mp-row"><div class="mp-seg"><button data-tab="find" class="${tab === 'find' ? 'on' : ''}">さがす</button><button data-tab="mine" class="${tab === 'mine' ? 'on' : ''}">借りている部屋</button></div></div>`;
    if (tab === 'find') {
      const near = await api('mp_unit_market', { p_box: box, p_use: use || null }) || [];
      const all = near.length ? near : await api('mp_unit_market', { p_box: null, p_use: use || null }) || [];
      m.set('テナント募集', `${head}
        <div class="mp-row"><select class="mp-inp" data-use style="width:auto">${['', 'shop', 'office', 'factory', 'warehouse', 'port', 'parking', 'farm', 'school'].map(u => `<option value="${u}" ${u === use ? 'selected' : ''}>${u ? USE_NAME[u] : T('ぜんぶの用途')}</option>`).join('')}</select>
          <small class="muted">${near.length ? T('いま見ているあたり') : T('ぜんぶの地域')}</small></div>
        ${corps.length ? '' : '<p class="mp-warn">テナントとして借りられるのは会社だけです</p>'}
        <div class="mp-list">${all.map(x => `<div class="mp-item"><b>${esc(x.bname || x.kname)}</b> <span>${esc(x.room)}</span>
            <small><br><span>${USE_NAME[x.use] || x.use}</span>・<span>${fmt(x.m2)}㎡</span>・<span>家賃 1日 ${X(x.ask)}</span><small>（相場の${Math.round(100 * x.ask / Math.max(1, x.mr))}%）</small>・<span>入りやすさ</span> <span style="color:#d89a00">${'★'.repeat(Math.max(1, Math.min(5, Math.round((x.dem || 0) * 2.5))))}</span>
            <br><span translate="no">${esc(x.addr || '')}</span>・<span>${esc(x.owner)}</span></small>
            <div class="mp-row"><button class="btn" data-go="${x.id}">地図で見る</button>${corps.length ? `<button class="btn main" data-lease="${x.id}">借りる</button>` : ''}</div></div>`).join('') || '<p class="muted small">いまテナント募集をしている部屋はありません</p>'}</div>`, b => bind(b, all));
    } else {
      const lists = await Promise.all(corps.map(a => api('mp_unit_mine', { p_as: a.as }).then(r => (r ? r.leases : []).map(l => ({ ...l, as: a.as, cn: asLabel(a) })))));
      const ls = lists.flat();
      m.set('テナント募集', `${head}<div class="mp-list">${ls.map(l => `<div class="mp-item"><b>${esc(l.bname)}</b> <span>${esc(l.room)}</span>
          <small><br><span>${esc(l.cn)}</span>・<span>${USE_NAME[l.use] || l.use}</span>・<span>${fmt(l.m2)}㎡</span>・<span>家賃 1日 ${X(l.rent)}</span>・<span>${esc(l.owner)}</span></small>
          <div class="mp-row"><button class="btn" data-go2="${l.x},${l.y}">地図で見る</button><button class="btn" data-out="${l.id}" data-as="${l.as}">退去する</button></div></div>`).join('') || '<p class="muted small">借りている部屋はありません</p>'}</div>`, b => {
        b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { tab = x.dataset.tab; load(); });
        b.querySelectorAll('[data-go2]').forEach(x => x.onclick = () => { const [cx, cy] = x.dataset.go2.split(',').map(Number); m.close(); setCam((cx + 0.5) / 5, (cy + 0.5) / 5, Math.max(S.cam.z, 30)); });
        b.querySelectorAll('[data-out]').forEach(x => x.onclick = async () => { if (!confirm(T('この部屋から退去します。よろしいですか？'))) return; if (await api('mp_unit_leave', { p_unit: Number(x.dataset.out), p_as: x.dataset.as }, '退去しました')) load(); });
      });
    }
  };
  const bind = (b, all) => {
    b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { tab = x.dataset.tab; load(); });
    const us = b.querySelector('[data-use]'); if (us) us.onchange = () => { use = us.value; load(); };
    b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => { const u = all.find(z => z.id === Number(x.dataset.go)); m.close(); setCam((u.x + 0.5) / 5, (u.y + 0.5) / 5, Math.max(S.cam.z, 30)); openBld(u.bld); });
    b.querySelectorAll('[data-lease]').forEach(x => x.onclick = () => leaseUnit(Number(x.dataset.lease), all.find(z => z.id === Number(x.dataset.lease)), load));
  };
  load();
}
/* ---- 自分（名義）の建物 ---- */
async function openMyBlds() {
  const m = modal(['自分の建物', '<p class="muted small">読みこんでいます…</p>']);
  const d = await api('mp_unit_mine', { p_as: S.as }); if (!d) return m.close();
  m.set('自分の建物', `<p class="small" style="margin:0 0 6px">${esc(asName())}</p><div class="mp-list">${d.blds.map(b => `<button class="mp-item" style="text-align:left" data-b="${b.id}" data-xy="${b.x},${b.y}">
      <b>${esc(b.name || kindName(b.kind))}</b> <small><span>${esc(kindName(b.kind))}</span>${b.floors > 0 ? `・<span>${b.floors}階</span>` : ''}<br><span>入居 ${b.occ}/${b.n}</span>・<span>家賃 1日 ${X(b.rent)}</span></small></button>`).join('')
      || '<p class="muted small">建物はまだありません。自分の筆をタップして「建物を建てる」から建てられます</p>'}</div>`, b => {
    b.querySelectorAll('[data-b]').forEach(x => x.onclick = () => { const [cx, cy] = x.dataset.xy.split(',').map(Number); m.close(); setCam((cx + 0.5) / 5, (cy + 0.5) / 5, Math.max(S.cam.z, 30)); openBld(Number(x.dataset.b)); });
  });
}

/* ---------- フェリー（t54o）：港・航路（海の上の折れ線）・海の上の道さがし・航路をつくる。空港・空路（t54p） ---------- */
// 編成の種類（rail 鉄道・bus バス・ship 船・air 飛行機）
function fKind(f) { return f && f.perf ? (f.perf.air ? 'air' : f.perf.ship ? 'ship' : f.perf.rail ? 'rail' : 'bus') : null; }
const KIND_L = { rail: '鉄道', bus: 'バス', ship: '航路', air: '空路' };
// 航路の折れ線（1/100 マス）→ マス
function prepLane(l) {
  l.P = (l.w || []).map(w => { const a = new Float32Array(w.length); for (let i = 0; i < w.length; i++) a[i] = w[i] / 100; return a; });
}
// 航路を描く（点線。港のあいだ）
function drawLanes(g, it, z) {
  if (!it.lanes || !it.lanes.size) return;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const l of it.lanes.values()) {
    g.strokeStyle = l.c || '#1e88e5'; g.globalAlpha = l.ok ? 0.85 : 0.4;
    if (l.k === 'air') { g.lineWidth = Math.max(1.5, Math.min(3, 0.04 * z + 1.2)); g.setLineDash([2, Math.max(5, Math.min(10, z * 0.3))]); g.globalAlpha *= 0.8; }   // 空路：細い点線
    else { g.lineWidth = Math.max(2, Math.min(5, 0.06 * z + 1.6)); g.setLineDash([Math.max(6, Math.min(18, z * 0.5)), Math.max(5, Math.min(12, z * 0.35))]); }
    for (const P of l.P) { g.beginPath(); for (let i = 0; i < P.length; i += 2) { const x = sx(P[i]), y = sy(P[i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
  }
  g.restore();
}
// 港のしるし（青い丸に ⚓）・空港のしるし（紺の丸に ✈。遠くからも見える。t54p）
function portR(z) { return Math.max(6, Math.min(12, 0.25 * z + 4)); }
const portMin = s => s.k === 'air' ? 0.35 : 1.2;
function drawPort(g, s, z) {
  if (z < portMin(s)) return;
  const x = sx(s.fx), y = sy(s.fy); if (x < -30 || y < -30 || x > S.W + 30 || y > S.H + 30) return;
  const r = portR(z), air = s.k === 'air';
  g.fillStyle = air ? (s.mine ? '#1a237e' : '#3949ab') : (s.mine ? '#0d47a1' : '#1976d2'); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(r * 1.15)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(air ? '✈' : '⚓', x, y + 0.5);
  if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) { g.strokeStyle = '#d23'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, r + 3, 0, 6.3); g.stroke(); }
}
function portLabel(g, s, z) {
  if (z < (s.k === 'air' ? 0.8 : 2)) return;
  const x = sx(s.fx), y = sy(s.fy); if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  const r = portR(z), air = s.k === 'air';
  label(g, s.n, x, y - r - 9, { size: z >= 6 ? 12 : 11, bold: true, color: air ? '#1a237e' : '#0d47a1', bg: 'rgba(255,255,255,.88)', border: air ? 'rgba(26,35,126,.35)' : 'rgba(13,71,161,.35)' });
}
// 空港の駐機場の線（平らな空港の建物の上に。長い向きに誘導路の黄色い線と、駐機する場所の線。t57：滑走路は国が別に引く）
function drawApron(g, b, z) {
  const [x0, y0, x1, y1] = b.bb, w = x1 - x0, h = y1 - y0, hor = w >= h;
  const L = (hor ? w : h) * 0.84, sw = Math.min(1.1, (hor ? h : w) * 0.28), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, n = Math.max(2, Math.floor(L / 1.3));
  g.strokeStyle = 'rgba(249,201,40,.95)'; g.lineWidth = Math.max(0.03, 1.4 / z); g.beginPath();
  if (hor) { g.moveTo(cx - L / 2, cy); g.lineTo(cx + L / 2, cy); } else { g.moveTo(cx, cy - L / 2); g.lineTo(cx, cy + L / 2); }
  for (let i = 0; i <= n; i++) {
    const t = -L / 2 + L * i / n;
    if (hor) { g.moveTo(cx + t, cy); g.lineTo(cx + t, cy - sw); } else { g.moveTo(cx, cy + t); g.lineTo(cx + sw, cy + t); }
  }
  g.stroke();
}
// 系統の強調（ダイヤ）：航路の区間
function drawRouteHiSea(g, R) {
  for (const leg of R.legs || []) {
    const w = leg.w || []; if (w.length < 4) continue;
    g.beginPath(); for (let i = 0; i < w.length; i += 2) { const x = sx(w[i] / 100), y = sy(w[i + 1] / 100); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
  }
}

/* ---- 海の上の道さがし（サーバーの _mp_sea_seg と同じ決まり：0.25マスごとに、そのマスが海か） ---- */
function seaT(x, y) {
  const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
  if (!inWorld(cx, cy)) return false;
  const c = S.chunks.get(ckey(cx, cy));
  if (c) { if (c.sea) return true; const t = c.t[(y - cy * CS) * CS + (x - cx * CS)]; return t === 'S' || t === 'D'; }
  if (!WG && window.MapGen) WG = MapGen.world();
  if (!WG) return false;
  const t = WG.cell(x, y).t; return t === 'S' || t === 'D';
}
// 線分（マス）が海の上だけか
function seaSeg(x0, y0, x1, y1, sea) {
  sea = sea || seaT;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25));
  let lx = null, ly = null;
  for (let i = 0; i <= n; i++) {
    const tx = Math.floor(x0 + (x1 - x0) * i / n), ty = Math.floor(y0 + (y1 - y0) * i / n);
    if (tx === lx && ty === ly) continue;
    if (!sea(tx, ty)) return false;
    lx = tx; ly = ty;
  }
  return true;
}
// A：港の乗り場 → B：港の乗り場（1/100 マス）。海のマスを 8方向に（角は切らない）。陸のとなりは少し遠回り。見通しでまびいた折れ線（1/100 マス）。見つからなければ null
function seaPath(a, b) {
  const ax = a[0] / 100, ay = a[1] / 100, bx = b[0] / 100, by = b[1] / 100;
  const dist = Math.hypot(bx - ax, by - ay), pad = Math.round(Math.max(40, Math.min(300, dist * 0.6)));
  const X0 = Math.floor(Math.min(ax, bx)) - pad, Y0 = Math.floor(Math.min(ay, by)) - pad, W = Math.floor(Math.max(ax, bx)) + pad - X0 + 1, H = Math.floor(Math.max(ay, by)) + pad - Y0 + 1;
  if (W * H > 4000000) return null;
  const N = W * H, ter = new Uint8Array(N), gs = new Float32Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const sea = (x, y) => { if (x < X0 || y < Y0 || x >= X0 + W || y >= Y0 + H) return false; const k = (y - Y0) * W + (x - X0); if (!ter[k]) ter[k] = seaT(x, y) ? 1 : 2; return ter[k] === 1; };
  const sx0 = Math.floor(ax), sy0 = Math.floor(ay), gx = Math.floor(bx), gy = Math.floor(by);
  if (!sea(sx0, sy0) || !sea(gx, gy)) return null;
  // 二分ヒープ（f, k）
  const hf = [], hk = [];
  const push = (f, k) => { hf.push(f); hk.push(k); let i = hf.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hf[p], hf[i]] = [hf[i], hf[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; } };
  const pop = () => { const k = hk[0], lf = hf.pop(), lk = hk.pop(); if (hf.length) { hf[0] = lf; hk[0] = lk; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hf.length && hf[l] < hf[m]) m = l; if (r < hf.length && hf[r] < hf[m]) m = r; if (m === i) break; [hf[m], hf[i]] = [hf[i], hf[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; } } return k; };
  const hcost = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  const s0 = (sy0 - Y0) * W + (sx0 - X0), goal = (gy - Y0) * W + (gx - X0);
  gs[s0] = 0; push(hcost(sx0, sy0), s0);
  let found = false, it = 0;
  while (hf.length) {
    const k = pop(); if (done[k]) continue; done[k] = 1;
    if (k === goal) { found = true; break; }
    if (++it > 3000000) break;
    const x = X0 + k % W, y = Y0 + Math.floor(k / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!sea(nx, ny)) continue;
      if (dx && dy && (!sea(x + dx, y) || !sea(x, y + dy))) continue;   // 角を切らない
      const nk = (ny - Y0) * W + (nx - X0); if (done[nk]) continue;
      const coast = !sea(nx + 1, ny) || !sea(nx - 1, ny) || !sea(nx, ny + 1) || !sea(nx, ny - 1);
      const ng = gs[k] + (dx && dy ? 1.4142 : 1) + (coast ? 0.6 : 0);
      if (ng < gs[nk]) { gs[nk] = ng; par[nk] = k; push(ng + hcost(nx, ny), nk); }
    }
  }
  if (!found) return null;
  const cells = []; for (let k = goal; k >= 0; k = par[k]) { cells.push([X0 + k % W + 0.5, Y0 + Math.floor(k / W) + 0.5]); if (k === s0) break; }
  cells.reverse();
  if (cells.length < 2) cells.push([bx, by]);
  cells[0] = [ax, ay]; cells[cells.length - 1] = [bx, by];
  // 見通しでまびく：i から、海の上だけで行けるいちばん先の点へ
  const out = [cells[0]]; let i = 0;
  while (i < cells.length - 1) {
    let j = i + 1;
    while (j + 1 < cells.length && seaSeg(cells[i][0], cells[i][1], cells[j + 1][0], cells[j + 1][1], sea)) j++;
    out.push(cells[j]); i = j;
  }
  if (out.length > 400) return null;
  const pts = [];
  out.forEach((p, k) => { pts.push(k === 0 ? a[0] : k === out.length - 1 ? b[0] : Math.round(p[0] * 100)); pts.push(k === 0 ? a[1] : k === out.length - 1 ? b[1] : Math.round(p[1] * 100)); });
  return pts;
}
// 折れ線（1/100 マス）がぜんぶ海の上か
function seaPathOk(w) { for (let i = 0; i + 3 < w.length; i += 2) if (!seaSeg(w[i] / 100, w[i + 1] / 100, w[i + 2] / 100, w[i + 3] / 100)) return false; return true; }
function pathKm(w) { let m = 0; for (let i = 0; i + 3 < w.length; i += 2) m += Math.hypot((w[i + 2] - w[i]) / 100, (w[i + 3] - w[i + 1]) / 100) * 50; return m / 1000; }

/* ---- 航路をつくる・直す：港を順にタップ → 海の上を自動でさがす。点はドラッグで動かせる（長押しで消す） ---- */
// 道さがしの前に、そのあたりの地形（チャンク）を読んでおく（読めないところは worldgen で見る）
async function seaChunks(x0, y0, x1, y1) {
  const want = [];
  for (let cy = Math.floor(y0 / CS); cy <= Math.floor(y1 / CS); cy++) for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) {
    if (inWorld(cx, cy) && !S.chunks.has(ckey(cx, cy))) want.push([cx, cy]);
  }
  if (!want.length || want.length > 160) return;
  for (let i = 0; i < want.length; i += 32) {
    const b = want.slice(i, i + 32), ks = []; for (const [cx, cy] of b) ks.push(cx, cy);
    let rows; try { rows = await call('mp_chunk_get', { p_keys: ks }); } catch (e) { return; }
    const got = new Set();
    for (const c of rows || []) { const k = ckey(c.cx, c.cy); got.add(k); if (!S.chunks.has(k)) S.chunks.set(k, { cx: c.cx, cy: c.cy, t: c.t, e: c.e, z: c.z, a: c.a, ap: c.ap, apx: c.apx || [], zo: zoMap(c), lo: null, hi: null, zc: null, bnd: null, used: now() }); }
    for (const [cx, cy] of b) { const k = ckey(cx, cy); if (!got.has(k) && !S.chunks.has(k)) S.chunks.set(k, { cx, cy, sea: true, used: now() }); }
  }
}
function shipRouteBuild(edit) {
  setTool('look');
  const st = { stops: [], paths: [], name: edit ? edit.name : '', color: edit ? edit.color : '#1e88e5', timing: new Set(edit ? edit.timing : []), dwell: edit ? edit.dwell : 900, drag: null, busy: false };
  const old = edit ? (edit.legs || []).map(l => l.w || []) : [];
  if (edit) {
    st.stops = edit.stops.map(s => ({ id: s.id, n: s.name, x: s.x, y: s.y }));
    st.paths = old.map(w => w.slice());
    if (st.paths.length !== st.stops.length - 1 || st.paths.some(w => w.length < 4)) st.paths = [];
  }
  hint('港を順にタップしてください。海の上の道を自動でさがします（点はドラッグで動かす・長押しで消す）');
  // 港 a → 港 b の海の道（1/100 マスの折れ線）。見つからなければ null
  const addLeg = async (a, b) => {
    toast('海の道をさがしています…');
    const pad = 48;
    await seaChunks(Math.min(a.x, b.x) / 100 - pad, Math.min(a.y, b.y) / 100 - pad, Math.max(a.x, b.x) / 100 + pad, Math.max(a.y, b.y) / 100 + pad);
    await new Promise(r => setTimeout(r, 20));
    const w = seaPath([a.x, a.y], [b.x, b.y]);
    if (!w) toast(T(`「${a.n}」から「${b.n}」への海の道が見つかりません`));
    return w;
  };
  const busy = async f => { if (st.busy) return; st.busy = true; try { await f(); } finally { st.busy = false; } };
  const redoAll = () => busy(async () => {
    const ps = [];
    for (let i = 0; i + 1 < st.stops.length; i++) { const w = await addLeg(st.stops[i], st.stops[i + 1]); if (!w) { st.stops.splice(i + 1); break; } ps.push(w); }
    st.paths = ps; draw();
  });
  const rmStop = i => busy(async () => {
    if (i === 0) { st.stops.shift(); st.paths.shift(); }
    else if (i === st.stops.length - 1) { st.stops.pop(); st.paths.pop(); }
    else { const w = await addLeg(st.stops[i - 1], st.stops[i + 1]); if (!w) return; st.stops.splice(i, 1); st.paths.splice(i - 1, 2, w); }
    if (st.stops.length < 2) st.paths = [];
    draw();
  });
  S.tapHook = (x, y) => {
    if (st.busy) return;
    const h = nearSta(x, y, 24, s => s.k === 'ship'); if (!h || h.s.k !== 'ship') return toast('港（フェリーターミナル）をタップしてください');
    if (!h.s.mine && h.s.ln == null && !(edit && edit.stops.some(z => z.id === h.s.id))) return toast('この港は、持ち主が貸し出していません');
    if (st.stops.length && st.stops[st.stops.length - 1].id === h.s.id) return;
    const s = { id: h.s.id, n: h.s.n, x: h.s.x, y: h.s.y, ln: h.s.mine ? null : h.s.ln };
    busy(async () => {
      if (st.stops.length) { const w = await addLeg(st.stops[st.stops.length - 1], s); if (!w) return; st.paths.push(w); }
      st.stops.push(s); if (st.stops.length <= 2) st.timing.add(s.id);
      draw();
    });
  };
  // 点（港のあいだの曲がり角）をつかむ・動かす・長押しで消す
  const handle = (px, py) => {
    for (let i = 0; i < st.paths.length; i++) { const w = st.paths[i]; for (let k = 2; k + 2 < w.length; k += 2) if (Math.hypot(sx(w[k] / 100) - px, sy(w[k + 1] / 100) - py) < 18) return [i, k]; }
    return null;
  };
  S.grab = (px, py) => { if (st.busy) return false; const h = handle(px, py); if (!h) return false; st.drag = { i: h[0], k: h[1], x0: st.paths[h[0]][h[1]], y0: st.paths[h[0]][h[1] + 1] }; return true; };
  S.grabMove = (x, y) => { if (!st.drag) return; const w = st.paths[st.drag.i]; w[st.drag.k] = Math.round(x * 100); w[st.drag.k + 1] = Math.round(y * 100); S.dirty = true; };
  S.grabEnd = () => {
    const d = st.drag; st.drag = null; if (!d) return;
    const w = st.paths[d.i], k = d.k;
    if (w[k] === d.x0 && w[k + 1] === d.y0) return;
    if (!seaSeg(w[k - 2] / 100, w[k - 1] / 100, w[k] / 100, w[k + 1] / 100) || !seaSeg(w[k] / 100, w[k + 1] / 100, w[k + 2] / 100, w[k + 3] / 100)) {
      w[k] = d.x0; w[k + 1] = d.y0; toast('そこだと陸や浅いところにかかります');
    }
    draw();
  };
  S.onLong = (x, y, px, py) => {
    if (st.busy) return;
    const h = handle(px, py); if (!h) return;
    const w = st.paths[h[0]], k = h[1];
    if (!seaSeg(w[k - 2] / 100, w[k - 1] / 100, w[k + 2] / 100, w[k + 3] / 100)) return toast('この点を消すと、陸にかかります');
    w.splice(k, 2); draw();
  };
  S.drawTool = (g, z) => {
    g.save(); g.strokeStyle = st.color; g.lineWidth = 3; g.setLineDash([8, 6]); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const w of st.paths) { g.beginPath(); for (let k = 0; k < w.length; k += 2) { const x = sx(w[k] / 100), y = sy(w[k + 1] / 100); if (k) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    g.setLineDash([]);
    for (const w of st.paths) for (let k = 2; k + 2 < w.length; k += 2) { g.fillStyle = '#fff'; g.strokeStyle = st.color; g.lineWidth = 2; g.beginPath(); g.arc(sx(w[k] / 100), sy(w[k + 1] / 100), 6, 0, 6.3); g.fill(); g.stroke(); }
    for (const s of st.stops) { g.fillStyle = st.color; g.beginPath(); g.arc(sx(s.x / 100), sy(s.y / 100), 4, 0, 6.3); g.fill(); }
    g.restore();
  };
  S.toolEnd = () => { S.tapHook = null; };
  const draw = () => {
    const km = st.paths.reduce((a, w) => a + pathKm(w), 0);
    sheet(`<h4>${edit ? '航路を直す' : '航路（フェリー）をつくる'}</h4>
      <div class="mp-row"><input class="mp-inp" style="flex:1 1 150px" data-nm placeholder="航路の名前（例：鵜島航路）" value="${esc(st.name)}"><input type="color" data-col value="${esc(st.color)}" style="width:44px;height:36px;border:0;background:none"></div>
      <div class="mp-list">${st.stops.map((s, i) => `<div class="mp-item" style="display:flex;align-items:center;gap:6px"><b>${i + 1}.</b> ${esc(s.n)}${s.ln != null ? ` <small class="muted">（借りる・1日 ${X(s.ln)}）</small>` : ''}
          <label class="small" style="margin-left:auto"><input type="checkbox" data-tm="${s.id}" ${st.timing.has(s.id) ? 'checked' : ''}> 採時駅</label><button class="btn" data-rm="${i}">×</button></div>`).join('') || '<p class="muted small">まだ港がありません</p>'}</div>
      ${st.paths.length ? `<p class="small" style="margin:4px 0"><span>航路の長さ</span> <b>${km.toFixed(1)}km</b>（<span>曲がり角 ${st.paths.reduce((a, w) => a + w.length / 2 - 2, 0)}</span>）</p>` : ''}
      <div class="mp-row">停車時間 <input class="mp-inp mp-num" type="number" min="60" max="3600" step="60" value="${st.dwell}" data-dw> 秒 <small class="muted">（車・トラックの積みおろし）</small></div>
      <div class="mp-row"><button class="btn" data-redo ${st.stops.length >= 2 ? '' : 'disabled'}>海の道をさがしなおす</button></div>
      <div class="mp-row"><button class="btn" data-cancel>キャンセル</button><button class="btn main" data-ok ${st.stops.length >= 2 && st.paths.length === st.stops.length - 1 ? '' : 'disabled'}>${edit ? 'この順に直す' : '航路をつくる'}（${esc(asName())}）</button></div>
      <p class="muted small">港は「フェリーターミナル」の建物です（海の近くに建てると、港の乗り場と船の置き場ができます）。船は ≡ →「車両と編成」で港をえらんで注文します</p>`, s => {
      s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
      s.querySelector('[data-col]').oninput = e => { st.color = e.target.value; S.dirty = true; };
      s.querySelector('[data-dw]').onchange = e => { st.dwell = Math.max(60, Math.min(3600, Number(e.target.value) || 900)); };
      s.querySelectorAll('[data-tm]').forEach(c => c.onchange = () => { const id = Number(c.dataset.tm); if (c.checked) st.timing.add(id); else st.timing.delete(id); });
      s.querySelectorAll('[data-rm]').forEach(c => c.onclick = () => { st.name = s.querySelector('[data-nm]').value; rmStop(Number(c.dataset.rm)); });
      s.querySelector('[data-redo]').onclick = () => { st.name = s.querySelector('[data-nm]').value; redoAll(); };
      s.querySelector('[data-cancel]').onclick = () => setTool('look');
      s.querySelector('[data-ok]').onclick = async () => {
        if (st.busy) return;
        st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('航路の名前をつけてください');
        if (st.paths.some(w => !seaPathOk(w))) return toast('陸や浅いところにかかる区間があります（「海の道をさがしなおす」）');
        const r = await api('mp_route_save', { p_id: edit ? edit.id : null, p_kind: 'ship', p_name: st.name, p_color: st.color, p_stops: st.stops.map(x => x.id),
          p_timing: st.stops.map(x => x.id).filter(id => st.timing.has(id)), p_dwell: st.dwell, p_paths: st.paths, p_as: S.as });
        if (r) { toast(T(edit ? '直しました' : '航路をつくりました。便を入れましょう') + (r.stopfee ? SEP() + T(`（港の使用料 1日 ${fmt(r.stopfee)} X）`) : '')); setTool('look'); refreshBox(...laneBox(st.paths.concat(old))); openDia(r.id); }
      };
    });
    S.dirty = true;
  };
  S.onSheetClose = () => setTool('look');
  draw();
  if (edit && !st.paths.length && st.stops.length >= 2) redoAll();
}
function laneBox(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of paths) for (let k = 0; k < w.length; k += 2) { x0 = Math.min(x0, w[k] / 100); y0 = Math.min(y0, w[k + 1] / 100); x1 = Math.max(x1, w[k] / 100); y1 = Math.max(y1, w[k + 1] / 100); }
  return x0 === Infinity ? [0, 0, 0, 0] : [x0 - 2, y0 - 2, x1 + 2, y1 + 2];
}

/* ---- 空路をつくる・直す（t54p）：空港を順にタップ → まっすぐ飛ぶ（10km 以上はなれた空港どうし） ---- */
function airRouteBuild(edit) {
  setTool('look');
  const st = { stops: [], name: edit ? edit.name : '', color: edit ? edit.color : '#3949ab', timing: new Set(edit ? edit.timing : []), dwell: edit ? edit.dwell : 1800 };
  const old = edit ? (edit.legs || []).map(l => l.w || []) : [];
  if (edit) st.stops = edit.stops.map(s => ({ id: s.id, n: s.name, x: s.x, y: s.y }));
  hint('空港を順にタップしてください（まっすぐ飛びます。空港どうしは10km以上はなれていること）');
  const km = (a, b) => Math.hypot((b.x - a.x) / 100, (b.y - a.y) / 100) * 50 / 1000;
  S.tapHook = (x, y) => {
    const h = nearSta(x, y, 24, s => s.k === 'air'); if (!h || h.s.k !== 'air') return toast('空港をタップしてください');
    if (!h.s.mine && h.s.ln == null && !(edit && edit.stops.some(z => z.id === h.s.id))) return toast(h.s.o === 'gov' ? 'この国の空港は、いまは新しい空路に使えません' : 'この空港は、持ち主が貸し出していません');
    if (st.stops.length && st.stops[st.stops.length - 1].id === h.s.id) return;
    const s = { id: h.s.id, n: h.s.n, x: h.s.x, y: h.s.y, ln: h.s.mine ? null : h.s.ln };
    if (st.stops.length && km(st.stops[st.stops.length - 1], s) < 10) return toast('空港どうしが近すぎます（10km 以上）');
    st.stops.push(s); if (st.stops.length <= 2) st.timing.add(s.id);
    draw();
  };
  S.drawTool = (g, z) => {
    g.save(); g.strokeStyle = st.color; g.lineWidth = 2.5; g.setLineDash([3, 7]); g.lineCap = 'round';
    g.beginPath(); st.stops.forEach((s, i) => { const x = sx(s.x / 100), y = sy(s.y / 100); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
    g.setLineDash([]); for (const s of st.stops) { g.fillStyle = st.color; g.beginPath(); g.arc(sx(s.x / 100), sy(s.y / 100), 4, 0, 6.3); g.fill(); }
    g.restore();
  };
  S.toolEnd = () => { S.tapHook = null; };
  const draw = () => {
    let d = 0; for (let i = 0; i + 1 < st.stops.length; i++) d += km(st.stops[i], st.stops[i + 1]);
    sheet(`<h4>${edit ? '空路を直す' : '空路（飛行機）をつくる'}</h4>
      <div class="mp-row"><input class="mp-inp" style="flex:1 1 150px" data-nm placeholder="路線の名前（例：瑠璃–東線）" value="${esc(st.name)}"><input type="color" data-col value="${esc(st.color)}" style="width:44px;height:36px;border:0;background:none"></div>
      <div class="mp-list">${st.stops.map((s, i) => `<div class="mp-item" style="display:flex;align-items:center;gap:6px"><b>${i + 1}.</b> ${esc(s.n)}${s.ln != null ? ` <small class="muted">（借りる・1日 ${X(s.ln)}）</small>` : ''}
          <label class="small" style="margin-left:auto"><input type="checkbox" data-tm="${s.id}" ${st.timing.has(s.id) ? 'checked' : ''}> 採時駅</label><button class="btn" data-rm="${i}">×</button></div>`).join('') || '<p class="muted small">まだ空港がありません</p>'}</div>
      ${st.stops.length >= 2 ? `<p class="small" style="margin:4px 0"><span>飛ぶ距離</span> <b>${d.toFixed(1)}km</b></p>` : ''}
      <div class="mp-row">折り返しの時間 <input class="mp-inp mp-num" type="number" min="600" max="7200" step="300" value="${st.dwell}" data-dw> 秒 <small class="muted">（乗り降り・給油・整備）</small></div>
      <div class="mp-row"><button class="btn" data-cancel>キャンセル</button><button class="btn main" data-ok ${st.stops.length >= 2 ? '' : 'disabled'}>${edit ? 'この順に直す' : '空路をつくる'}（${esc(asName())}）</button></div>
      <p class="muted small"><span>空港は国の空港です（飛行場・地方空港・空港・国際空港。滑走路の長さで、飛べる飛行機がちがいます）。空路に入れた空港ごとに、1路線・1日の使用料を国にはらいます。飛行機は ≡ →「車両と編成」で空港をえらんで注文します。</span><span>便は、出る空港ごとに、1時間に持っている発着口の数まで飛べます（✈ →「🛫 発着口・入札」）</span></p>`, s => {
      s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
      s.querySelector('[data-col]').oninput = e => { st.color = e.target.value; S.dirty = true; };
      s.querySelector('[data-dw]').onchange = e => { st.dwell = Math.max(600, Math.min(7200, Number(e.target.value) || 1800)); };
      s.querySelectorAll('[data-tm]').forEach(c => c.onchange = () => { const id = Number(c.dataset.tm); if (c.checked) st.timing.add(id); else st.timing.delete(id); });
      s.querySelectorAll('[data-rm]').forEach(c => c.onclick = () => {
        const i = Number(c.dataset.rm), nx = st.stops.filter((_, k) => k !== i);
        if (i > 0 && i < st.stops.length - 1 && km(st.stops[i - 1], st.stops[i + 1]) < 10) return toast('空港どうしが近すぎます（10km 以上）');
        st.name = s.querySelector('[data-nm]').value; st.stops = nx; draw();
      });
      s.querySelector('[data-cancel]').onclick = () => setTool('look');
      s.querySelector('[data-ok]').onclick = async () => {
        st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('路線の名前をつけてください');
        const r = await api('mp_route_save', { p_id: edit ? edit.id : null, p_kind: 'air', p_name: st.name, p_color: st.color, p_stops: st.stops.map(x => x.id),
          p_timing: st.stops.map(x => x.id).filter(id => st.timing.has(id)), p_dwell: st.dwell, p_paths: [], p_as: S.as });
        if (r) {
          toast(T(edit ? '直しました' : '空路をつくりました。便を入れましょう') + (r.stopfee ? SEP() + T(`（空港の使用料 1日 ${fmt(r.stopfee)} X）`) : ''));
          setTool('look'); refreshBox(...laneBox((r.legs || []).map(l => l.w || []).concat(old))); openDia(r.id);
        }
      };
    });
    S.dirty = true;
  };
  S.onSheetClose = () => setTool('look');
  draw();
}

/* ---------- さがす（t59）：地名・町字・住所（町字＋地番）・駅・建物の名前。人（登録者）・自宅ではさがせない ---------- */
const FIND_IC = { pref: '🗾', muni: '🏙', ward: '🏙', island: '🏝', cho: '🏷', addr: '📍', bld: '🏢', sta: { rail: '🚉', bus: '🚏', air: '✈', ship: '⚓' } };
const FIND_K = { pref: '都道府県', muni: '市区町村', ward: '区', island: '島', cho: '町字', addr: '住所', bld: '建物', sta: '駅・空港・港' };
function findHist() { try { return JSON.parse(localStorage.getItem('mp_find') || '[]').slice(0, 6); } catch (e) { return []; } }
function findSave(q) { try { const h = [q, ...findHist().filter(x => x !== q)].slice(0, 6); localStorage.setItem('mp_find', JSON.stringify(h)); } catch (e) {} }
function openFind() {
  const m = modal(['🔍 さがす', `<div class="mp-row" style="margin-top:0"><input class="mp-inp" data-q style="flex:1 1 180px" placeholder="住所・地名・駅・建物の名前" enterkeyhint="search" autocomplete="off"><button class="btn main" data-go>さがす</button></div>
      <p class="muted small" style="margin:4px 0"><span>例：瑠璃市中里区中央三丁目・中里3-12-5・梅ヶ枝町・新中里・瑠璃府庁</span></p>
      <div data-hist class="mp-row" style="margin-top:2px"></div><div data-res class="mp-list"></div>`], b => {
    const inp = b.querySelector('[data-q]'), res = b.querySelector('[data-res]'), hist = b.querySelector('[data-hist]');
    let seq = 0;
    const showHist = () => { const h = findHist(); hist.innerHTML = h.map((q, i) => `<button class="btn" data-h="${i}" style="padding:3px 9px;font-size:12px" translate="no">${esc(q)}</button>`).join('');
      hist.querySelectorAll('[data-h]').forEach(x => x.onclick = () => { inp.value = h[Number(x.dataset.h)]; run(); }); };
    const go = r => {
      m.close(); sheet(null); setTool('look');
      setCam(r.x, r.y, r.z); pinAt(r.x, r.y);
      if ((r.k === 'bld' || r.k === 'addr') && r.cx != null) setTimeout(() => showSpot(r.cx, r.cy), 350);
    };
    const run = async () => {
      const q = inp.value.trim(); if (!q) return;
      const my = ++seq; res.innerHTML = '<p class="muted small">さがしています…</p>';
      const d = await api('mp_find', { p_q: q }); if (my !== seq) return;
      if (!d) { res.innerHTML = ''; return; }
      findSave(q); showHist();
      res.innerHTML = d.length ? d.map((r, i) => `<button class="mp-item" style="text-align:left" data-i="${i}"><b>${r.k === 'sta' ? (FIND_IC.sta[r.sk] || '🚉') : (FIND_IC[r.k] || '📍')} <span translate="no">${esc(r.n)}</span></b>
          <br><small><span>${esc(T(FIND_K[r.k] || ''))}</span>${r.s ? `・<span translate="no">${esc(r.s)}</span>` : ''}</small></button>`).join('')
        : '<p class="small"><span>見つかりませんでした。</span><span>地名・町字・番地・駅・建物の名前でさがせます（人の名前ではさがせません）</span></p>';
      res.querySelectorAll('[data-i]').forEach(x => x.onclick = () => go(d[Number(x.dataset.i)]));
    };
    b.querySelector('[data-go]').onclick = run;
    inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } };
    showHist(); setTimeout(() => inp.focus(), 50);
  });
}
// 見つけた場所のしるし（12秒）
function pinAt(x, y) { S.pin = { x, y, t: now() }; S.dirty = true; clearTimeout(S.pinT); S.pinT = setTimeout(() => { S.pin = null; S.dirty = true; }, 12000); }
function drawPin(g) {
  const p = S.pin; if (!p) return;
  const x = sx(p.x), y = sy(p.y); if (x < -30 || y < -50 || x > S.W + 30 || y > S.H + 30) return;
  g.fillStyle = '#d62f2f'; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(x, y - 22, 11, Math.PI * 0.82, Math.PI * 2.18); g.lineTo(x, y); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y - 22, 4.2, 0, 6.3); g.fill();
}
// 地図で場所（区画か建物）をえらぶ：cb(cx, cy)
function pickPlace(msg, cb) {
  setTool('look');
  hint(msg);
  sheet(`<h4>${esc(T(msg))}</h4><div class="mp-row"><button class="btn" data-cancel>やめる</button></div>`, s => { s.querySelector('[data-cancel]').onclick = () => setTool('look'); });
  S.tapHook = (x, y) => {
    let cx = Math.floor(x * 5), cy = Math.floor(y * 5);
    const hb = hitBld(x, y); if (hb) [cx, cy] = hb.cell.split(',').map(Number);
    S.tapHook = null; S.toolEnd = null; hint(''); sheet(null); S.sel = { kind: 'cell', x: cx, y: cy }; S.dirty = true;
    cb(cx, cy);
  };
  S.toolEnd = () => { S.tapHook = null; };
}

/* ---------- 住民の窓口（t59）：市役所・区役所・町村役場。転入・転居・転出・住民票の写し・印鑑登録 ---------- */
const JM_K = { in: '転入届', move: '転居届', out: '転出届', cert: '住民票の写しの交付', seal: '印鑑登録', seal_cert: '印鑑登録証明書の交付', seal_end: '印鑑登録の廃止' };
const OFFICE_K = ['cityhall', 'wardoffice', 'townhall'];
const jday = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }); };
async function openJuumin(bid) {
  const m = modal(['🏛 住民の窓口', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  const load = async () => {
    const d = await api('mp_jm_get', { p_bld: bid }); if (!d) return m.close();
    const me = d.me, here = d.here;
    m.set('🏛 住民の窓口', `<p class="small" style="margin:0"><b><span>${esc(d.name)}</span></b>・<span>${esc(d.area)}</span>${d.pop ? `<small>（<span>人口 ${fmt(d.pop)}人</span>）</small>` : ''}</p>
      <div class="mp-kv"><b>住民登録</b><span>${!me ? '<span class="muted">まだ住民登録をしていません</span>'
          : here ? `<b>この役所の住民です</b><br><span translate="no">${esc(me.addr)}</span>`
          : `<span>${esc(me.area)}に住民登録しています</span><br><span translate="no">${esc(me.addr)}</span>`}</span>
        ${me ? `<b>住民となった日</b><span>${esc(jday(me.since))}</span><b>住所を定めた日</b><span>${esc(jday(me.moved))}</span>` : ''}
        ${me && here ? `<b>印鑑登録</b><span>${me.seal ? `<span>登録あり（登録番号 ${esc(me.seal_no)}）</span>` : '<span class="muted">なし</span>'}</span>` : ''}</div>
      <h4 style="margin:10px 0 4px">届け出・証明書</h4>
      <div class="mp-list">
        ${!here ? `<button class="mp-item" style="text-align:left" data-f="in"><b>📥 転入届</b><br><small><span>${esc(d.area)}に住所をうつします（住所をえらびます）</span>${me ? '<span>。いまの市区町村からの転出も、いっしょにします</span>' : ''}</small></button>` : ''}
        ${here ? `<button class="mp-item" style="text-align:left" data-f="move"><b>🏠 転居届</b><br><small>${esc(d.area)}の中で、住所を変えます</small></button>
          <button class="mp-item" style="text-align:left" data-f="out"><b>📤 転出届</b><br><small>住民登録をやめます（ほかの市区町村へは、そこの役所に転入届を出すだけでも引っこせます）</small></button>
          <button class="mp-item" style="text-align:left" data-c="cert"><b>📄 住民票の写し</b><br><small>手数料 ${X(d.fee.cert)}（国庫へ）</small></button>
          ${me.seal ? `<button class="mp-item" style="text-align:left" data-c="seal_cert"><b>🔴 印鑑登録証明書</b><br><small>手数料 ${X(d.fee.seal_cert)}（国庫へ）</small></button>
            <button class="mp-item" style="text-align:left" data-s="end"><b>✂ 印鑑登録の廃止</b><br><small>登録した印鑑を使わなくなったとき</small></button>`
            : `<button class="mp-item" style="text-align:left" data-s="reg"><b>🔴 印鑑登録</b><br><small>印影の文字（1〜4字）を登録します（無料）</small></button>`}` : ''}
      </div>
      ${d.log.length ? `<h4 style="margin:10px 0 4px">あなたの届け出の記録</h4><div class="mp-list">${d.log.map(l => `<div class="mp-item small"><b>${esc(T(JM_K[l.k] || l.k))}</b>・<span>${esc(l.area || '')}</span>・<span>${esc(jday(l.at))}</span>${l.no ? `・<span>受付番号 ${l.no}</span>` : ''}${l.fee ? `・<span>${X(l.fee)}</span>` : ''}${l.addr ? `<br><small translate="no">${esc(l.addr)}</small>` : ''}</div>`).join('')}</div>` : ''}
      ${d.admin ? `<h4 style="margin:10px 0 4px">管理者</h4><div class="mp-row"><span class="small"><span>この役所が受けもつ住民 ${d.res}人</span></span><button class="btn" data-res>住民の一覧</button></div>` : ''}
      <p class="muted small"><span>住民票（住所・日付・住民票コード）は、あなたと管理者だけが見られます。</span><span>地図の「自分の住所」（人のページで公開）とは別です（届け出のときに、いっしょに変えることもできます）。</span>${d.kind === 'cityhall' && !d.ward ? '<span>市役所は市の全部を、区役所はその区を、町村役場はその町村を受けもちます。</span>' : ''}</p>`, b => {
      b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => jmFile(d, x.dataset.f, m, load));
      b.querySelectorAll('[data-c]').forEach(x => x.onclick = async () => {
        const k = x.dataset.c;
        if (!confirm(T(`${k === 'cert' ? '住民票の写し' : '印鑑登録証明書'}をもらいます（手数料 ${fmt(d.fee[k])} X）。よろしいですか？`))) return;
        const r = await api('mp_jm_cert', { p_bld: bid, p_kind: k }); if (r) { showCert(r); load(); }
      });
      b.querySelectorAll('[data-s]').forEach(x => x.onclick = async () => {
        if (x.dataset.s === 'end') {
          if (!confirm(T('印鑑登録を廃止します。よろしいですか？'))) return;
          if (await api('mp_jm_seal', { p_bld: bid, p_op: 'end', p_text: null }, '印鑑登録を廃止しました')) load();
          return;
        }
        const nick = asLabel((S.boot.as || []).find(a => a.as === 'me')) || '';
        const v = prompt(T('印影の文字（1〜4字。名前やその一部など）'), nick.slice(0, 2)); if (v == null) return;
        const r = await api('mp_jm_seal', { p_bld: bid, p_op: 'reg', p_text: v.trim() });
        if (r) { toast(T(`印鑑登録をしました（受付番号 ${r.no}・登録番号 ${r.seal_no}）`)); load(); }
      });
      const rs = b.querySelector('[data-res]'); if (rs) rs.onclick = async () => {
        const L = await api('mp_jm_residents', { p_bld: bid }); if (!L) return;
        modal(['住民の一覧（管理者）', L.length ? `<div class="mp-list">${L.map(r => `<div class="mp-item small"><b translate="no">${esc(r.nick)}</b> <small translate="no">@${esc(r.uid || '')}</small>${r.seal ? ' <span class="mp-tag">印鑑登録</span>' : ''}
            <br><span translate="no">${esc(r.addr)}</span><br><small><span>住民となった日 ${esc(jday(r.since))}</span></small></div>`).join('')}</div>` : '<p class="small">まだいません</p>'], null);
      };
    });
  };
  load();
}
// 転入・転居（住所をえらぶ）・転出
async function jmFile(d, k, m, load) {
  if (k === 'out') {
    if (!confirm(T(`転出届を出して、${d.area}の住民登録をやめます。よろしいですか？`))) return;
    const r = await api('mp_jm_file', { p_bld: d.bld, p_kind: 'out', p_x: null, p_y: null, p_unit: null, p_home: false });
    if (r) { toast(T(`転出届を受けつけました（受付番号 ${r.no}）`)); load(); }
    return;
  }
  const send = async (x, y, unit, home) => {
    const r = await api('mp_jm_file', { p_bld: d.bld, p_kind: k, p_x: x, p_y: y, p_unit: unit, p_home: home });
    if (!r) return false;
    if (r.home) { S.boot.home = r.home; S.dirty = true; }
    toast(T(`${k === 'in' ? '転入届' : '転居届'}を受けつけました（受付番号 ${r.no}）`));
    return true;
  };
  const ask = async (x, y, unit, text) => {
    const pm = modal([k === 'in' ? '転入届' : '転居届', `<p class="small" style="margin:0 0 6px"><span>新しい住所</span>：<b translate="no">${esc(text)}</b></p>
        <label class="small"><input type="checkbox" data-home> 地図の「自分の住所」もここにする（人のページでみんなに見えます）</label>
        <div class="mp-row"><button class="btn main" data-ok>届け出る</button><button class="btn" data-x2>やめる</button></div>`], b => {
      b.querySelector('[data-x2]').onclick = () => pm.close();
      b.querySelector('[data-ok]').onclick = async () => { if (await send(x, y, unit, b.querySelector('[data-home]').checked)) { pm.close(); openJuumin(d.bld); } };
    });
  };
  const pick = () => {
    m.close();
    pickPlace(`${d.area}の中で、住所にする区画か建物をタップしてください`, async (cx, cy) => {
      const sp = await api('mp_spot', { p_x: cx, p_y: cy }); if (!sp || sp.none) return;
      const text = sp.addr.text + (sp.addr.ban ? ' ' + sp.addr.ban : '');
      const P = sp.parcel;
      if (P && P.b && P.b.n > 1) {
        const bd = await api('mp_bld_get', { p_bld: P.b.id }); if (!bd) return;
        const um = modal(['部屋をえらぶ', `<p class="small" style="margin:0 0 6px"><span translate="no">${esc(bd.addr)}</span> <span>${esc(bd.name || bd.kname)}</span></p>
            <div class="mp-row" style="flex-wrap:wrap">${bd.units.slice(0, 400).map(u => `<button class="btn" data-hu="${u.id}">${esc(u.room)}</button>`).join('')}</div>
            <div class="mp-row"><button class="btn" data-hu="0">部屋なし（建物まで）</button></div>`], b => {
          b.querySelectorAll('[data-hu]').forEach(x => x.onclick = () => { um.close(); const u = bd.units.find(z => z.id === Number(x.dataset.hu)); ask(cx, cy, u ? u.id : null, text + ' ' + (bd.name || bd.kname) + (u ? ' ' + u.room : '')); });
        });
        return;
      }
      ask(cx, cy, null, text + (P && P.b ? ' ' + (P.b.name || '') : ''));
    });
  };
  const h = d.home;
  if (h && h.in) {
    const cm = modal([k === 'in' ? '転入届' : '転居届', `<p class="small">新しい住所をえらんでください</p><div class="mp-list">
        <button class="mp-item" style="text-align:left" data-hm><b>🏠 地図の自分の住所</b><br><small translate="no">${esc(h.text)}</small></button>
        <button class="mp-item" style="text-align:left" data-pk><b>👆 地図でえらぶ</b><br><small>区画か建物をタップします</small></button></div>`], b => {
      b.querySelector('[data-hm]').onclick = async () => { cm.close(); if (await send(h.x, h.y, h.unit, false)) load(); };
      b.querySelector('[data-pk]').onclick = () => { cm.close(); pick(); };
    });
    return;
  }
  pick();
}
// 住民票の写し・印鑑登録証明書（画面に出す）
function showCert(r) {
  const j = r.me, seal = j && j.seal;
  const box = (h) => `<div style="background:#fffdf6;color:#222;border:1px solid #c9bfa6;border-radius:6px;padding:14px 14px 10px;font-family:'Noto Serif JP',serif">${h}</div>`;
  const row = (k, v) => `<tr><th style="text-align:left;white-space:nowrap;padding:5px 8px;border:1px solid #c9bfa6;background:#f6f1e3;font-weight:600">${k}</th><td style="padding:5px 8px;border:1px solid #c9bfa6">${v}</td></tr>`;
  // 印影（1〜3字は1列・4字は右の列から2列。丸の中におさまる大きさ）
  const stamp = (t, w) => {
    const a = [...t], two = a.length >= 4, n = two ? Math.ceil(a.length / 2) : Math.max(1, a.length);
    const fs = Math.min(Math.round(w * 0.42), Math.floor(w * (two ? 0.56 : 0.68) / n)), lh = Math.round(fs * 1.04);
    const col = s => `<span style="display:flex;flex-direction:column;align-items:center">${s.map(c => `<span style="display:block;height:${lh}px;line-height:${lh}px">${esc(c)}</span>`).join('')}</span>`;
    return `<span style="display:inline-flex;flex-direction:row-reverse;align-items:center;justify-content:center;gap:2px;box-sizing:border-box;width:${w}px;height:${w}px;border:2px solid #c8261d;border-radius:${r.kind === 'seal_cert' ? '50%' : '4px'};color:#c8261d;font-weight:700;font-size:${fs}px;box-shadow:inset 0 0 0 2px rgba(200,38,29,.12)">${two ? col(a.slice(0, n)) + col(a.slice(n)) : col(a)}</span>`;
  };
  const ls = em => (window.I18N && I18N.lang && I18N.lang !== 'ja' && !/^zh/.test(I18N.lang) ? '.02em' : em + 'em');   // 見出しの字の間（日本語・中国語だけ広く）
  // 職印（四角・右の列から2列。字は1字ずつならべる：縦書きの折りかえしにたよらない）
  const kenin = t => {
    const a = [...t], n = Math.ceil(a.length / 2), fs = Math.min(14, Math.floor(46 / Math.max(3, n)));
    const col = s => `<span style="display:flex;flex-direction:column;align-items:center">${s.map(c => `<span style="display:block;height:${fs + 1}px;line-height:${fs + 1}px">${esc(c)}</span>`).join('')}</span>`;
    return `<span translate="no" style="display:inline-flex;flex-direction:row-reverse;align-items:center;justify-content:center;gap:3px;box-sizing:border-box;width:58px;height:58px;border:2.5px solid #c8261d;border-radius:3px;opacity:.9;color:#c8261d;font-weight:800;font-size:${fs}px">${col(a.slice(0, n))}${col(a.slice(n))}</span>`;
  };
  const foot = `<p style="margin:10px 0 2px;font-size:13px">${r.kind === 'cert' ? 'この写しは、住民票の原本と相違ないことを証明する。' : 'この写しは、登録されている印影と相違ないことを証明する。'}</p>
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:6px;font-size:13px"><span>${esc(jday(r.at))}</span><b translate="no">${esc(r.mayor)}</b>${kenin(r.mayor + '之印')}</div>
    <p style="margin:8px 0 0;font-size:11px;color:#777">交付番号 ${r.no}・${esc(r.office)}（手数料 ${fmt(r.fee)} X）</p>`;
  const html = r.kind === 'cert'
    ? box(`<h3 style="text-align:center;letter-spacing:${ls(0.5)};margin:0 0 10px;font-size:20px">住民票（写し）</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px">${row('氏名', `<b translate="no">${esc(r.name)}</b>`)}${row('住所', `<span translate="no">${esc(j.addr)}</span>`)}
          ${row('世帯主', `<span translate="no">${esc(r.name)}</span>`)}${row('続柄', '本人')}${row('住民となった年月日', esc(jday(j.since)))}${row('住所を定めた年月日', esc(jday(j.moved)))}
          ${row('前住所', j.prev ? `<span translate="no">${esc(j.prev)}</span>` : '―')}${row('住民票コード', `<span style="letter-spacing:2px">${esc(j.code)}</span>`)}</table>${foot}`)
    : box(`<h3 style="text-align:center;letter-spacing:${ls(0.3)};margin:0 0 10px;font-size:20px">印鑑登録証明書</h3>
        <div style="display:flex;gap:14px;align-items:center"><div style="flex:none;border:1px dashed #c9bfa6;padding:10px;border-radius:6px;background:#fff">${stamp(r.seal_text || '', 74)}</div>
        <table style="border-collapse:collapse;flex:1;font-size:13px">${row('氏名', `<b translate="no">${esc(r.name)}</b>`)}${row('住所', `<span translate="no">${esc(j.addr)}</span>`)}${row('登録番号', esc(j.seal_no || ''))}</table></div>${foot}`);
  modal([r.kind === 'cert' ? '住民票の写し' : '印鑑登録証明書', html], null, 'mp-wide');
}
window.MapApp = { open, pause, state: S, spline, setCam, landReqs: () => openLandReqs(), xfers: () => openXfers(), goto: (x, y) => homeGo(x, y), thru: () => openThru(), bld: id => openBld(id), sc: () => openSC(),
  slots: L => (L && L.st ? openSlots(Number(L.st)) : openSlotList()), find: () => openFind(), jm: id => openJuumin(id) };
})();
