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
const B64X = B64 + '.~!*()+=';   // 標高だけ 64〜71 段（2825m〜3875m：国土を広げたところの高い山）
const B64I = (() => { const m = new Int8Array(128); for (let i = 0; i < 72; i++) m[B64X.charCodeAt(i)] = i; return m; })();
const edec = l => l <= 7 ? -187.5 + l * 25 : l <= 32 ? (l - 8) * 4 + 2 : l <= 48 ? 112.5 + (l - 33) * 25 : 575 + (l - 49) * 150;
const EDEC = Float32Array.from({ length: 72 }, (_, i) => edec(i));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const now = () => performance.now();
const evT = e => (e && e.timeStamp > 0 && e.timeStamp < 1e11 ? e.timeStamp : now());   // 指が動いた時刻（画面が重くても、指の速さを正しく）
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
  ov: null, ovInfo: null, ovMore: [], ovHi: [], seaInfo: null, seaMask: null,
  layer: { zone: false, own: true, label: true, run: false, wxmap: false, track: false, snowz: false, jam: false, er: false, elev: false },   // elev：高低差（標高の色・陰）・run：列車・バスの走行位置（t61）・wxmap：天気図（t62）・track：非電化・単線を強く出す（2026-10-29）
  wxOff: 0, wxMode: 'rain', wxPlay: 0,   // 天気図：何時間後・雨と雪／気温・うごかす
  inertia: false, v3names: true, glide: null,   // 惰性・3D の建物の名前（t61）
  wx: true,   // 天気と気温（t62。map/wx.js）
  b25: true,   // 建物を 2.5D（高さのある見えかた）で描く。false なら 2D（上から見たまま）
  tool: 'look', toolState: null,
  sel: null,          // えらんだもの（{kind, id, ...}）
  hover: null,
  routeHi: null,      // 地図でめだたせる系統
};
window.MP_STATE = S;   // テスト用

/* ---------- 画質と見える遠さ（t63）：省エネ・標準・高画質・最高（＋自分で）。この端末におぼえる ----------
   d2：2D の遠さ（くわしい地形・遠くの建物）・d25：2.5D（建物の壁を出す遠さ）・d3：3D の遠さ。0 近い・1 ふつう・2 遠い・3 とても遠い
   fps：1秒に描く数の上限・res：画面のこまかさ（端末のきめこまかさにかける）・aa：3D のふちをなめらかに（次に 3D にしたときから）
   遠くまで見せるときも、サーバーには あらい地形（mp_chunk_lo）・かんたんな建物（mp_blds_lite。サーバーがとっておく）だけをたのむ */
const QP = { eco: { d2: 0, d25: 0, d3: 0, fps: 30, res: 0.75, aa: false }, std: { d2: 1, d25: 1, d3: 1, fps: 60, res: 1, aa: true },
             high: { d2: 2, d25: 2, d3: 2, fps: 60, res: 1, aa: true }, max: { d2: 3, d25: 3, d3: 3, fps: 60, res: 1, aa: true } };
const QK = ['d2', 'd25', 'd3', 'fps', 'res', 'aa'];
const MQ = Object.assign({ p: 'std' }, QP.std);
try { const v = JSON.parse(localStorage.getItem('mp_q') || 'null'); if (v && typeof v === 'object') for (const k of ['p'].concat(QK)) if (k in v) MQ[k] = v[k]; } catch (e) {}
const QV = {   // 段階（0〜3）ごとの値
  zc: [1.6, 1.2, 1.2, 1.0],           // 2D：くわしい地形（チャンク）を出す近さ（これより引くと、全体の絵）
  maxCh: [220, 600, 900, 1300],       // 2D：くわしい地形は、画面の中のチャンクがこの数までのときだけ読む（大きな画面で引いたときに、通信とサーバーをまもる）
  zl: [Infinity, Infinity, 3.5, 2.2], // 2D：遠くの建物（かんたんな形）を出す近さ（7 より近いと、くわしい建物）
  zw: [12, 9, 7, 5],                  // 2.5D：建物の壁を出す近さ
  k3: [3.4, 4.2, 5.5, 7],             // 3D：地形を見せる遠さ ＝ カメラの遠さ × これ（上限は r3）
  r3: [380, 700, 1050, 1400],         // 3D：地形を見せる遠さの上限（マス）
  rf3: [380, 420, 520, 560],          // 3D：くわしい地形を読む遠さ（その先は あらい地形）
  rb3: [120, 220, 220, 260],          // 3D：くわしい建物の遠さ
  db3: [110, 160, 160, 180],          // 3D：カメラがこれより近いときに、くわしい建物を読む
  rl3: [0, 0, 480, 760],              // 3D：遠くの建物（かんたんな形）の遠さ
};
const q = (k, lv) => QV[k][Math.max(0, Math.min(3, Number(lv) || 0))];
function qSave() { try { localStorage.setItem('mp_q', JSON.stringify(MQ)); } catch (e) {} }
// プリセットに合うか（合わなければ「自分で」）
function qMatch() { MQ.p = 'custom'; for (const [k, P] of Object.entries(QP)) if (QK.every(x => P[x] === MQ[x])) MQ.p = k; }

/* ---------- カメラ ---------- */
const sx = x => (x - S.cam.x) * S.cam.z + S.W / 2;
const sy = y => (y - S.cam.y) * S.cam.z + S.H / 2;
const wx = px => (px - S.W / 2) / S.cam.z + S.cam.x;
const wy = py => (py - S.H / 2) / S.cam.z + S.cam.y;
function view() { if (S.v3rect) return S.v3rect; return { x0: wx(0), y0: wy(0), x1: wx(S.W), y1: wy(S.H) }; }   // 3D のときは 3D のはんい（map3d.js）
// いちばん引いたときの近さ（t108）：国土の箱がまるごと画面に入るまで（5×5 で国土が広くなったので。前は 0.18 まで）。
//   天気図のときは、まわりの海（600km）までまるごと（前は 0.03 まで）
const Z_FAR = 0.18;   // これより引くと「とても遠く」：線路・高速・県の名前だけ（lod 3）
function zMin() {
  const w = S.boot && S.boot.world, wxm = S.layer.wxmap, m = wxm ? 12000 : 0, z0 = wxm ? 0.03 : Z_FAR;
  if (!w || w.cx1 < w.cx0 || !(S.W > 0) || !(S.H > 0)) return z0;
  const f = 0.94 * Math.min(S.W / ((w.cx1 - w.cx0 + 1) * CS + 2 * m), S.H / ((w.cy1 - w.cy0 + 1) * CS + 2 * m));
  return Math.max(0.004, Math.min(z0, f));
}
function setCam(x, y, z) {
  if (S.v3) { m3Target(x, y); S.dirty = true; return; }   // 3D：まん中だけうごかす
  S.cam.z = clamp(z, zMin(), 64);
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
// 2D：くわしい地形（チャンク）を出すか（近さと、画面の中のチャンクの数。t63）
function chunkView() {
  if (S.cam.z < q('zc', MQ.d2)) return false;
  const v = view(), n = (Math.floor(v.x1 / CS) - Math.floor(v.x0 / CS) + 1) * (Math.floor(v.y1 / CS) - Math.floor(v.y0 / CS) + 1);
  return n <= q('maxCh', MQ.d2);
}
function needChunks() {
  if (!S.v3 && !chunkView()) return;
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
/* ---------- 遠くの建物（かんたんな形。t63・DB の更新47）：192 マス四方ごと。サーバーがとっておいたものを読む ---------- */
const LITE = { cells: new Map(), busy: 0, off: false, LS: 192 };
const B64N = (s, i) => B64I[s.charCodeAt(i)] * 64 + B64I[s.charCodeAt(i + 1)];
// 12文字ずつ：種類の番号・階・x0＋64・y0＋64・はば・高さ（10m の区画。ます目の左上から）→ マスの単位の四角
function liteDecode(d) {
  const items = [], k = d.k || [], s = d.b || '', ox = d.i * LITE.LS * 5, oy = d.j * LITE.LS * 5;
  for (let p = 0; p + 11 < s.length; p += 12) {
    const x0 = ox + B64N(s, p + 4) - 64, y0 = oy + B64N(s, p + 6) - 64, w = B64N(s, p + 8), h = B64N(s, p + 10);
    items.push({ kind: k[B64N(s, p)], f: B64N(s, p + 2), x0: x0 / 5, y0: y0 / 5, x1: (x0 + w) / 5, y1: (y0 + h) / 5 });
  }
  return items;
}
// r（マスの四角）にかかるます目を、近い順に読む（2つずつ）。max：読むます目の数の上限
function liteNeed(r, max) {
  if (LITE.off || !S.open) return;
  const L = LITE.LS, i0 = Math.floor(r.x0 / L), j0 = Math.floor(r.y0 / L), i1 = Math.floor(r.x1 / L), j1 = Math.floor(r.y1 / L);
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, want = [], t = now();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = LITE.cells.get(i + ',' + j); if (c) c.used = t;
    if (c && (c.busy || (c.items && !c.stale) || (c.stale && t - (c.got || 0) < 120000) || (c.err && t - c.err < 15000))) continue;   // 変わっても2分は前のまま（遠くの見た目なので）
    want.push([i, j, ((i + 0.5) * L - cx) ** 2 + ((j + 0.5) * L - cy) ** 2]);
  }
  want.sort((a, b) => a[2] - b[2]);
  for (const [i, j] of want.slice(0, max)) {
    if (LITE.busy >= 2) break;
    const key = i + ',' + j, c = LITE.cells.get(key) || { i, j, items: null, v: 0 };
    c.busy = true; c.used = t; LITE.cells.set(key, c); LITE.busy++;
    call('mp_blds_lite', { p_i: i, p_j: j })
      .then(d => { c.items = liteDecode(d); c.stale = false; c.err = 0; c.got = now(); c.paths = null; c.v++; S.dirty = true; if (S.v3) S.v3.dirty = true; })
      .catch(e => { if (/Could not find the function|schema cache|does not exist/.test(e.message)) LITE.off = true; c.err = now(); })
      .finally(() => { c.busy = false; LITE.busy--; });
  }
  if (LITE.cells.size > 140) { const all = [...LITE.cells.entries()].filter(e => !e[1].busy).sort((a, b) => a[1].used - b[1].used); for (const [k2] of all.slice(0, LITE.cells.size - 110)) LITE.cells.delete(k2); }
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
  // 5×5 の新しい土地（t108）：worldgen.js の川の線がないので、川のマスを なめらかな形にして水の色で描く（近づくと川が消えないように）
  const newLand = !(x0 + N > OLDBOX[0] && x0 < OLDBOX[2] && y0 + N > OLDBOX[1] && y0 < OLDBOX[3]);
  const Rv = newLand ? new Float32Array(M2 * M2) : null, RW = newLand ? new Float32Array(M * M) : null;
  const own = (i, j) => { const ii = clamp(i, 0, N - 1), jj = clamp(j, 0, N - 1), k = jj * N + ii; return { t: c.t[k], e: EDEC[B64I[c.e.charCodeAt(k)]], z: c.zo && c.zo.has(k) ? c.zo.get(k) : c.z[k] }; };
  const get = (i, j) => (i >= 0 && j >= 0 && i < N && j < N) ? own(i, j) : (tileAt(x0 + i, y0 + j) || own(i, j));
  for (let j = -2; j <= N + 1; j++) for (let i = -2; i <= N + 1; i++) {
    const q = get(i, j), k2 = (j + 2) * M2 + (i + 2);
    raw[k2] = q.t === 'D' || q.t === 'S' || q.t === 'L' ? 1 : 0;
    if (Rv) Rv[k2] = q.t === 'R' ? 1 : 0;
    let t = q.t;
    if (t === 'R') t = q.e > 300 ? 'H' : 'P';                                   // 川のマスは陸の色（川は線で描く）
    const col = PAL.tileColor(t, q.e, q.t === 'R' ? '-' : q.z, 0);
    Rr[k2] = col[0]; Rg[k2] = col[1]; Rb[k2] = col[2]; Re[k2] = Math.max(0, q.e);
  }
  // 3×3 でならす（海岸がなめらかに・色の境目もやわらかく。色は水どうし・陸どうしだけでまぜる）
  const KW = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const c0 = (j + 1) * M2 + (i + 1), self = raw[c0];
    let w = 0, sr = 0, sg = 0, sb = 0, sw = 0, n = 0, se = 0, rw = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const k2 = c0 + b * M2 + a, kw = KW[n++];
      w += kw * raw[k2]; se += kw * Re[k2]; if (Rv) rw += kw * Rv[k2];
      if (raw[k2] === self) { sw += kw; sr += kw * Rr[k2]; sg += kw * Rg[k2]; sb += kw * Rb[k2]; }
    }
    const k = j * M + i;
    Wt[k] = w / 16; Lw[k] = self; Cr[k] = sr / sw; Cg[k] = sg / sw; Cb[k] = sb / sw; Et[k] = se / 16; if (RW) RW[k] = rw / 16;
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
        if (RW) {   // 新しい土地の川（川のマスの重み 0.3 から川。ふちは少し白っぽく）
          const rv = RW[k00] * a00 + RW[k10] * a10 + RW[k01] * a01 + RW[k11] * a11;
          if (rv >= 0.3) { const f = rv < 0.36 ? 0.55 : 1; r = r * (1 - f) + 100 * f; gg = gg * (1 - f) + 166 * f; b = b * (1 - f) + 226 * f; }
          else if (rv >= 0.24) { const f = (rv - 0.24) / 0.06 * 0.35; r = r * (1 - f) + 150 * f; gg = gg * (1 - f) + 175 * f; b = b * (1 - f) + 150 * f; }
        }
      } else if (w < 0.6) { const f = (0.6 - w) / 0.1 * 0.18; r = r * (1 - f) + 240 * f; gg = gg * (1 - f) + 248 * f; b = b * (1 - f) + 255 * f; }      // 水ぎわ
      const o = (py * size + px) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return cv;
}
/* ---------- 川（worldgen.js の川のまん中の線から。256マスごとにまとめて計算） ---------- */
let WG = null;
const RIV = new Map();
const OLDBOX = [-1536, -1536, 1536, 2752];   // いまの国土（worldgen.js で作った土地）の箱（マス）。5×5 の新しい土地はこの外
function riversCell(i, j) {
  const k = i + ',' + j; let r = RIV.get(k); if (r) return r;
  r = [];
  // worldgen.js の川は、いまの国土（箱）の中だけ（5×5 の新しい土地の川は、チャンクの地形の川）
  const inOld = (i + 1) * 256 + 3 > OLDBOX[0] && i * 256 - 3 < OLDBOX[2] && (j + 1) * 256 + 3 > OLDBOX[1] && j * 256 - 3 < OLDBOX[3];
  if (!WG && window.MapGen && inOld) WG = MapGen.world();
  if (WG && inOld) {
    const x0 = Math.max(i * 256 - 3, OLDBOX[0]), y0 = Math.max(j * 256 - 3, OLDBOX[1]), x1 = Math.min((i + 1) * 256 + 3, OLDBOX[2]), y1 = Math.min((j + 1) * 256 + 3, OLDBOX[3]), SQ = Math.SQRT1_2;
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
// 層「⛰ 高低差」：標高の色（低い うすい → 高い こい茶色）と、北西から光を当てた陰。近いときはチャンクごと（海・湖・川はぬらない）、遠いときは絵
const ELV = { src: 'map/elev.png?v=1', x0: -7680, y0: -10112, x1: 7680, y1: 11328, img: null, loading: false };   // 遠くから見た絵（16マス＝1画素）
const ELV_E = [0, 20, 50, 100, 200, 400, 700, 1200, 2000];
const ELV_C = ['#ffebd6', '#f9cba2', '#ecad7a', '#dd8f56', '#c9723b', '#b15929', '#934524', '#743420', '#55251a'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
function elvCol(e) {
  if (e <= ELV_E[0]) return ELV_C[0];
  for (let i = 1; i < ELV_E.length; i++) if (e < ELV_E[i]) { const f = (e - ELV_E[i - 1]) / (ELV_E[i] - ELV_E[i - 1]), a = ELV_C[i - 1], b = ELV_C[i]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  return ELV_C[ELV_C.length - 1];
}
function elvLegend() {
  return '<b>標高</b>' + ELV_E.map((e, i) => i).reverse().map(i => `<span><i style="background:rgb(${ELV_C[i].join(',')})"></i>${fmt(ELV_E[i])}m${i === ELV_E.length - 1 ? '〜' : ''}</span>`).join('');
}
function chunkElev(c, cx, cy) {
  const M = 2, N = CS + 2 * M, ev = new Float32Array(N * N), tmp = new Float32Array(N * N);
  const eAt = (cc, x, y) => Math.max(0, EDEC[B64I[cc.e.charCodeAt((y & 63) * 64 + (x & 63))]]);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {   // まわりのチャンクも（なければ、このチャンクのふち）
    const x = cx * CS + i - M, y = cy * CS + j - M, ox = x >> 6, oy = y >> 6;
    const cc = ox === cx && oy === cy ? c : S.chunks.get(ckey(ox, oy));
    ev[j * N + i] = cc && !cc.sea && cc.e ? eAt(cc, x, y) : eAt(c, cx * CS + clamp(i - M, 0, CS - 1), cy * CS + clamp(j - M, 0, CS - 1));
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let a = 0, n = 0; for (let d = -2; d <= 2; d++) { const k = i + d; if (k >= 0 && k < N) { a += ev[j * N + k]; n++; } } tmp[j * N + i] = a / n; }   // 5×5 の平均（標高の段をならす。陰だけ）
  const sm = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let a = 0, n = 0; for (let d = -2; d <= 2; d++) { const k = j + d; if (k >= 0 && k < N) { a += tmp[k * N + i]; n++; } } sm[j * N + i] = a / n; }
  const cv = document.createElement('canvas'); cv.width = cv.height = CS;
  const g = cv.getContext('2d'), im = g.createImageData(CS, CS), d = im.data, ca = Math.cos(Math.PI / 4), sa = Math.sin(Math.PI / 4), zf = 1.5;
  for (let k = 0; k < CS * CS; k++) {
    const t = c.t[k]; if (t === 'S' || t === 'D' || t === 'R' || t === 'L') continue;
    const i = (k & 63) + M, j = (k >> 6) + M;
    const dzdx = (sm[j * N + i + 1] - sm[j * N + i - 1]) / 100 * zf, dzdy = (sm[(j + 1) * N + i] - sm[(j - 1) * N + i]) / 100 * zf;
    const sl = Math.atan(Math.hypot(dzdx, dzdy)), asp = Math.atan2(dzdy, -dzdx);
    const sh = ca * Math.sin(sl) * Math.cos(Math.PI * 1.25 - asp) + sa * Math.cos(sl), f = clamp(0.6 + 0.55 * sh, 0.55, 1.25), col = elvCol(ev[j * N + i]);
    d[k * 4] = clamp(Math.round(col[0] * f), 0, 255); d[k * 4 + 1] = clamp(Math.round(col[1] * f), 0, 255); d[k * 4 + 2] = clamp(Math.round(col[2] * f), 0, 255); d[k * 4 + 3] = 205;
  }
  g.putImageData(im, 0, 0); return cv;
}
function drawElevFar(g, z) {
  if (!ELV.img) {
    if (!ELV.loading) { ELV.loading = true; const im = new Image(); im.onload = () => { ELV.img = im; S.dirty = true; }; im.onerror = () => { ELV.loading = false; }; im.src = ELV.src; }
    return;
  }
  g.imageSmoothingEnabled = true; g.drawImage(ELV.img, sx(ELV.x0), sy(ELV.y0), (ELV.x1 - ELV.x0) * z, (ELV.y1 - ELV.y0) * z);
}

/* ---------- 地図の上のもの（道路・線路・駅など）：範囲（セル）ごとに読む ---------- */
// ズームで細かさ（lod）とセルの大きさを決める
//   lod 3（t108）：Z_FAR より引いたとき。4096 マスのます目で、線路・高速・駅と空港・県の名前だけ（サーバーの更新53 の前は lod 2 と同じものが来る）
function lodOf(z) { const e = MQ.d2 === 0 && S.tool === 'look' && !S.v3; return z < Z_FAR && !S.v3 ? [3, 4096] : z < (e ? 2.5 : 2) ? [2, 1024] : z < (e ? 9 : 7) ? [1, 384] : [0, 96]; }   // 省エネ（t63）：見るだけのときは、土地・建物を もっと近くから
const CELL0 = { segs: [], stas: [], deps: [], subs: [], attrs: [], nodes: [], parcels: [], blds: [], places: [], chos: [], lanes: [], rwys: [], names: {} };   // 国土の外のセル（読まない）
function needCells() {
  const [lod, cs] = lodOf(S.cam.z), v = view(), w = S.boot && S.boot.world;
  const i0 = Math.floor(v.x0 / cs), j0 = Math.floor(v.y0 / cs), i1 = Math.floor(v.x1 / cs), j1 = Math.floor(v.y1 / cs);
  const want = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = lod + ':' + i + ',' + j, c = S.cells.get(k);
    if (c && (c.busy || !c.stale)) { if (c) c.used = now(); continue; }
    // 国土の箱の外（海だけ。天気図で引いたときなど）は、サーバーにたのまない
    if (w && w.cx1 >= w.cx0 && ((i + 1) * cs <= w.cx0 * CS || i * cs >= (w.cx1 + 1) * CS || (j + 1) * cs <= w.cy0 * CS || j * cs >= (w.cy1 + 1) * CS)) {
      S.cells.set(k, { lod, i, j, cs, data: CELL0, used: now(), busy: false, stale: false }); continue;
    }
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
  // 高さ（t108）：縦断のある線は、点ごとの長さ（マス）と、つくりの区間 [はじめの点, おわりの点, G 地面（切り通し C もふくむ）・V 高架・T トンネル・B 橋]
  s.runs = null; s.L = null;
  if (s.pf) {
    const L = new Float32Array(n);
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
    s.L = L;
    if (s.st && /[TVB]/.test(s.st)) {
      const st = s.st, m = st.length, code = i => { const c = st[Math.min(m - 1, Math.max(0, Math.round(L[i])))] || 'G'; return c === 'C' ? 'G' : c; }, runs = [];   // 切り通し C（DB の更新111）は 地面と おなじに描く
      let a = 0, c = code(0);
      for (let i = 1; i < n; i++) { const k = code(i); if (k !== c) { runs.push([a, i, c]); a = i; c = k; } }
      runs.push([a, n - 1, c]); s.runs = runs;
    }
  }
  return s;
}
// 読んだものを描きやすく
function prepArea(d) {
  if (d.snow) S.snowOK = true;   // 雪の対策（DB の更新57）のあるサーバー
  if (d.hgt) S.hgtOK = true;     // 高さ（DB の更新59）のあるサーバー
  if (d.sup) S.supOK = true;     // 給水・給炭（DB の更新78）のあるサーバー
  if (d.hgt2) S.hgt2 = true;     // 平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）のあるサーバー
  if (d.sig) S.sigOK = true;     // 信号の段（DB の更新85）のあるサーバー
  if (d.quad) S.quadOK = true;   // 複々線（DB の更新86）のあるサーバー
  if (d.pw) S.pwOK = true;       // 電化方式（DB の更新87）のあるサーバー
  if (d.spec) S.specOK = true;   // 線路の規格・1本にする・騒音（DB の更新99）のあるサーバー
  if (d.subs2) { S.subsOK = true; for (const s of d.segs) s.pw2 = true; }   // 変電所（DB の更新89）のあるサーバー（pw2：fd がないのは 電気が来ていない線）
  d.subs = d.subs || []; for (const v of d.subs) { v.fx = v.x / 100; v.fy = v.y / 100; }
  if (d.park2) S.parkOK = true;   // テーマパーク・アトラクション（DB の更新91）のあるサーバー
  d.attrs = (d.attrs || []).map(a => ({ id: a[0], bld: a[1], k: a[2], x: a[3], y: a[4] }));
  for (const s of d.segs) prepSeg(s);
  for (const s of d.stas) { s.fx = s.x / 100; s.fy = s.y / 100; }
  for (const s of d.deps) { s.fx = s.x / 100; s.fy = s.y / 100; }
  for (const n of d.nodes) { n.fx = n.x / 100; n.fy = n.y / 100; }
  d.parcels = (d.parcels || []).map(prepParcel);
  d.blds = (d.blds || []).map(prepBld);
  d.chos = d.chos || [];
  d.lanes = d.lanes || []; for (const l of d.lanes) prepLane(l);   // 航路（t54o）
  d.rwys = d.rwys || []; for (const r of d.rwys) prepRwy(r);         // 滑走路（t57）
  d.props = (d.props || []).map(a => ({ id: a[0], kind: a[1], x: a[2] / 100, y: a[3] / 100, rot: a[4], col: a[5], mine: a[6] === 1 }));   // 小物（DB の更新103）
  if (d.ugm) S.ugmOK = true;   // 地下街（DB の更新109）のあるサーバー：[id, 駅, 点（1/100 マス）, 名前, 自分の]
  d.ugm = (d.ugm || []).map(prepUgm);
}
function prepUgm(a) {
  const p = a[2] || [], P = [];
  for (let i = 0; i + 1 < p.length; i += 2) P.push([p[i] / 100, p[i + 1] / 100]);
  let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  return { id: a[0], sta: a[1], P, n: a[3], mine: !!a[4], L };
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
  const segs = new Map(), stas = new Map(), deps = new Map(), subs = new Map(), attrs = new Map(), nodes = new Map(), parcels = new Map(), places = new Map(), chos = new Map(), blds = new Map(), props = new Map(), lanes = new Map(), rwys = new Map(), ugm = new Map(), names = {};
  const take = d => {
    for (const s of d.segs) segs.set(s.id, s);
    for (const s of d.stas) stas.set(s.id, s);
    for (const s of d.deps) deps.set(s.id, s);
    for (const v of (d.subs || [])) subs.set(v.id, v);   // 変電所（DB の更新89）
    for (const a of (d.attrs || [])) attrs.set(a.id, a);   // アトラクション（DB の更新91）
    for (const n of d.nodes) nodes.set(n.id, n);
    for (const p of d.parcels) parcels.set(p.id, p);
    for (const b of (d.blds || [])) blds.set(b.id, b);
    for (const q of (d.props || [])) props.set(q.id, q);   // 小物（t65）
    for (const p of d.places) places.set(p.id, p);
    for (const c of d.chos) chos.set(c[0], c);
    for (const l of (d.lanes || [])) lanes.set(l.id, l);
    for (const r of (d.rwys || [])) rwys.set(r.id, r);
    for (const u of (d.ugm || [])) ugm.set(u.id, u);   // 地下街（DB の更新109）
    Object.assign(names, d.names);
  };
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let c = S.cells.get(lod + ':' + i + ',' + j);
    if (c && c.data) { take(c.data); continue; }
    // まだ読めていないところは、ほかの細かさのものを使う（とても遠い lod 3 は、lod 2 だけ。小さいセルを数えすぎないように）
    for (const [l2, cs2] of lod === 3 ? [[2, 1024]] : [[0, 96], [1, 384], [2, 1024], [3, 4096]]) {
      if (l2 === lod) continue;
      const a0 = Math.floor(i * cs / cs2), b0 = Math.floor(j * cs / cs2), a1 = Math.floor(((i + 1) * cs - 1) / cs2), b1 = Math.floor(((j + 1) * cs - 1) / cs2);
      let any = false;
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const c2 = S.cells.get(l2 + ':' + a + ',' + b); if (c2 && c2.data) { take(c2.data); any = true; } }
      if (any) break;
    }
  }
  return { segs, stas, deps, subs, attrs, attrB: new Set([...attrs.values()].map(a => a.bld)), nodes, parcels, places, chos, blds, props, lanes, rwys, ugm, names };
}
// 変わったもの（ほかの人の工事など）。15秒ごと
async function poll() {
  if (!S.open || document.hidden) return;
  unkoLoad();   // 運行の乱れ（1分ごと）
  try {
    const r = await call('mp_poll', { p_since: S.ver });
    if (r.reload) { for (const c of S.cells.values()) c.stale = true; S.ver = r.ver; S.dirty = true; needCells(); return; }
    for (const ch of r.ch || []) {
      if (ch.k === 'zone') { // 用途地域：チャンクを読みなおす
        if (ch.b) for (let cy = Math.floor(ch.b[1] / CS); cy <= Math.floor(ch.b[3] / CS); cy++) for (let cx = Math.floor(ch.b[0] / CS); cx <= Math.floor(ch.b[2] / CS); cx++) S.chunks.delete(ckey(cx, cy));
      }
      if (ch.k === 'route') { if (S.onRoute) S.onRoute(); continue; }
      if (ch.k === 'land') { const L = LITE.LS; for (const c of LITE.cells.values()) if (!ch.b || (ch.b[0] <= (c.i + 1) * L && ch.b[2] >= c.i * L && ch.b[1] <= (c.j + 1) * L && ch.b[3] >= c.j * L)) c.stale = true; }   // 遠くの建物（t63）
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
// 見えているところをぜんぶ読みなおす（路線カラーをまとめて変えたときなど）
function refreshAll() { for (const c of S.cells.values()) c.stale = true; S.dirty = true; needCells(); }
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
// 渋滞の層を出しているときの道の色（色のついた道を灰色にして、渋滞の色を見やすく。DB の更新67）
const RS_J = { exp: { fill: '#c9d1cc', edge: '#87938b', min: 2.6 }, nat: { fill: '#e3ddd2', edge: '#a2988a', min: 2.2 }, pref: { fill: '#ebe6d8', edge: '#b0a893', min: 1.7 } };
const rsOf = c => (S.layer.jam && !S.v3 && RS_J[c]) || RS[c];
const DEP_SIZE = { rail: { S: [5, 2], M: [7, 3], L: [10, 4] }, bus: { S: [3, 2], M: [5, 3] } };
function pathSeg(g, s, off) {
  const P = s.P, n = s.np, r = s.rng, i0 = r ? r[0] : 0, i1 = r ? r[1] : n - 1;   // s.rng：線の一部だけ（高さ。t108）
  g.beginPath();
  if (!off) {
    g.moveTo(sx(P[2 * i0]), sy(P[2 * i0 + 1]));
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(sx(P[2 * i]), sy(P[2 * i + 1]));
    return;
  }
  // 横にずらした線（車線・複線）
  for (let i = i0; i <= i1; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = P[2 * b] - P[2 * a], dy = P[2 * b + 1] - P[2 * a + 1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const x = P[2 * i] - dy * off, y = P[2 * i + 1] + dx * off;
    if (i > i0) g.lineTo(sx(x), sy(y)); else g.moveTo(sx(x), sy(y));
  }
}
// 高さ（t108）：線の、つくりが set（'G' 地面・'V' 高架・'T' トンネル・'B' 橋）の区間ごとに fn。縦断のない線は ぜんぶ地面
function segParts(s, set, fn) {
  if (!s.runs) { if (set.includes('G')) fn(); return; }
  for (const r of s.runs) if (set.includes(r[2])) { s.rng = r; fn(); }
  s.rng = null;
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
// 遠くから見た絵の こまかいタイル（4マス＝1画素。t108）：近づいたときに、見えているものだけ読む。
//   5×5 の新しい土地も、元の国土の箱（overview.png）と同じこまかさにして、箱のふちが四角く見えないように
function ovHiDraw(g, z, v) {
  const t = now(); let all = true;
  for (const h of S.ovHi) {
    const o = h.o;
    if (o.x1 < v.x0 || o.x0 > v.x1 || o.y1 < v.y0 || o.y0 > v.y1) continue;
    h.used = t;
    if (!h.img) {
      if (!h.busy && !(h.bad && t - h.bad < 60000)) {
        h.busy = true; const im = new Image();
        im.onload = () => { h.img = im; h.busy = false; S.dirty = true; };
        im.onerror = () => { h.busy = false; h.bad = now(); };
        im.src = o.src;
      }
      all = false; continue;
    }
    // ふちを画面の画素にそろえる（となりのタイルと同じところで切れるので、すきまも重なりも出ない）
    const X0 = Math.round(sx(o.x0)), Y0 = Math.round(sy(o.y0)), X1 = Math.round(sx(o.x1)), Y1 = Math.round(sy(o.y1));
    g.imageSmoothingEnabled = true; g.drawImage(h.img, X0, Y0, X1 - X0, Y1 - Y0);
  }
  // 読んだ絵が多いときは、しばらく見ていないものからすてる（スマホのメモリ）
  const got = S.ovHi.filter(h => h.img);
  if (got.length > 8) for (const h of got.sort((a, b) => a.used - b.used).slice(0, got.length - 8)) if (t - h.used > 5000) h.img = null;
  return all;
}
function segVisible(s, v) { const b = s.bb; return b[2] >= v.x0 - 1 && b[0] <= v.x1 + 1 && b[3] >= v.y0 - 1 && b[1] <= v.y1 + 1; }
function render() {
  const g = S.ctx, z = S.cam.z, v = view();
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  g.fillStyle = 'rgb(70,128,186)'; g.fillRect(0, 0, S.W, S.H);
  // 遠くから見た絵（いつも下に）
  const wd = S.boot && S.boot.world;   // 5×5 の新しい土地の絵は、サーバーに新しい土地が入ってから（世界がいまの国土より広いとき）
  if (wd && wd.cx0 < -24) for (const m of S.ovMore) { g.imageSmoothingEnabled = true; g.drawImage(m.img, sx(m.o.x0), sy(m.o.y0), (m.o.x1 - m.o.x0) * z, (m.o.y1 - m.o.y0) * z); }
  const hiAll = wd && wd.cx0 < -24 && z >= 0.16 && S.ovHi.length ? ovHiDraw(g, z, v) : false;   // こまかい絵（t108）
  if (S.ov && S.ovInfo && !hiAll) {   // 元の国土の箱の絵：こまかいタイルが見えているところぜんぶ読めていれば、かさねない（同じ絵。かさねると箱のふちがうすく見える）
    const o = S.ovInfo;
    g.imageSmoothingEnabled = true;
    g.drawImage(S.ov, sx(o.x0), sy(o.y0), (o.x1 - o.x0) * z, (o.y1 - o.y0) * z);
  }
  // チャンク
  const chOn = chunkView();
  if (chOn) {
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
      if (S.layer.snowz) { if (!c.sz) c.sz = chunkSnow(c, cy); g.imageSmoothingEnabled = false; g.drawImage(c.sz, sx(cx * CS), sy(cy * CS), CS * z, CS * z); }   // 雪の地域（t108）
      if (S.layer.elev) { if (!c.ev) c.ev = chunkElev(c, cx, cy); g.imageSmoothingEnabled = false; g.drawImage(c.ev, sx(cx * CS), sy(cy * CS), CS * z, CS * z); }   // 高低差
      if (LIC.pick && LIC.pickSet && LIC.pickSet.size) { if (c.lkKey !== LIC.pickKey) { c.lk = chunkLic(c, LIC.pickSet); c.lkKey = LIC.pickKey; } g.imageSmoothingEnabled = false; g.drawImage(c.lk, sx(cx * CS), sy(cy * CS), CS * z, CS * z); }   // 免許の申請でえらんだ市区町村
    }
    if (made >= 6) S.dirty = true;   // 次のフレームで続きを
  }
  if (S.layer.snowz && !chOn) drawSnowZ(g, z);   // 雪の地域（t108）：遠いときは絵
  if (S.layer.elev && !chOn) drawElevFar(g, z);   // 高低差：遠いときは絵
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
  const far = z < Z_FAR;   // とても遠い（t108）：道路は高速だけ（国道は出さない。サーバーの更新53 の前も、ここで落とす）
  const roads = segs.filter(s => s.k === 'road' && (!far || s.c === 'exp')), rails = segs.filter(s => s.k === 'rail');
  g.lineCap = 'round'; g.lineJoin = 'round';
  const wpx = s => Math.max(RS[s.c] ? (s.art && s.c === 'city' ? 1.4 : RS[s.c].min) : 1, s.w * z);
  // とても近いときは、アスファルトの色に白い線（車線）。ふちは歩道
  const asph = z >= 20;
  // 高さ（t108）：トンネル・地下は下に うすく（点線）
  for (const s of roads) if (s.runs) segParts(s, 'T', () => drawTunnel(g, s, z));
  for (const s of rails) if (s.runs) segParts(s, 'T', () => drawTunnel(g, s, z));
  const roadPass = (s, set) => {
    for (const pass of [0, 1]) {
      const st = rsOf(s.c) || RS.city, w = wpx(s);
      g.strokeStyle = pass ? (asph ? (s.c === 'lane' ? '#9a9a96' : '#86868a') : st.fill) : (asph ? '#d9d5cc' : st.edge);
      g.lineWidth = pass ? w : w + (asph ? Math.max(2, 0.1 * z) : w > 2.5 ? 2 : 1.2);
      segParts(s, set, () => { pathSeg(g, s); g.stroke(); });
    }
  };
  for (const pass of [0, 1]) for (const cls of ROAD_ORDER) for (const s of roads) {
    if (s.c !== cls) continue;
    const st = rsOf(cls), w = wpx(s);
    g.strokeStyle = pass ? (asph ? (cls === 'lane' ? '#9a9a96' : '#86868a') : st.fill) : (asph ? '#d9d5cc' : st.edge);
    g.lineWidth = pass ? w : w + (asph ? Math.max(2, 0.1 * z) : w > 2.5 ? 2 : 1.2);
    segParts(s, 'G', () => { pathSeg(g, s); g.stroke(); });
  }
  // 車線の線（近いとき）
  if (asph) for (const s of roads) {
    if (s.c === 'exp' || !s.l) continue;
    segParts(s, 'G', () => laneMarks(g, s, z));
  }
  // 線路（非電化・単線を強く出すときは、下にしるし）
  if (S.layer.track) for (const s of rails) segParts(s, 'G', () => trackMark(g, s, z));
  for (const s of rails) segParts(s, 'G', () => drawRail(g, s, z));
  // 高架・橋（t108）：かげ → 道路・線路（地面のものの上に）
  const ups = segs.filter(s => s.runs && (s.k === 'rail' || s.c !== 'exp') && s.runs.some(r => r[2] === 'V' || r[2] === 'B') && (s.k === 'rail' || !far));
  for (const s of ups) segParts(s, 'VB', () => drawUpShadow(g, s, z, s.k === 'rail' ? Math.max(1.8, (s.q ? 0.52 : s.dbl ? 0.34 : 0.22) * z) : wpx(s)));
  for (const s of ups) {
    if (s.k === 'rail') { if (S.layer.track) segParts(s, 'VB', () => trackMark(g, s, z)); segParts(s, 'VB', () => drawRail(g, s, z)); }
    else { roadPass(s, 'VB'); if (asph && s.l) segParts(s, 'VB', () => laneMarks(g, s, z)); }
  }
  if (S.pwOK && z >= 2) drawDeadSecs(g, rails, z);   // デッドセクション（DB の更新87）
  if (S.subsOK && z >= 2) drawPower(g, rails, z);    // エアセクション・電気の来ていない線（DB の更新89）
  if (S.ugmOK && z >= 1.5 && it.ugm && it.ugm.size) drawUgm(g, it, z);   // 地下街（DB の更新109）
  // 航路（海の上の点線。t54o）
  drawLanes(g, it, z);
  // 高速（高架なので上に。高さを決めた高速は、トンネルのところをのぞく）
  for (const s of roads) if (s.c === 'exp' && s.runs) segParts(s, 'VB', () => drawUpShadow(g, s, z, wpx(s)));
  for (const pass of [0, 1]) for (const s of roads) {
    if (s.c !== 'exp') continue;
    const st = rsOf('exp'), w = wpx(s);
    g.strokeStyle = pass ? (asph ? '#7b7f86' : st.fill) : st.edge; g.lineWidth = pass ? w : w + 2; segParts(s, 'GVB', () => { pathSeg(g, s); g.stroke(); });
  }
  if (asph) for (const s of roads) if (s.c === 'exp' && s.l) segParts(s, 'GVB', () => laneMarks(g, s, z));
  // 渋滞（DB の更新67）：混雑はオレンジ・渋滞は赤・通行止めは黒の点線。とても遠いときは、道ごとのまとまりを点で
  if (S.layer.jam && !S.v3) drawJam(g, roads, z, far);
  // 重なりの順（下から）：平らな建物（田畑・駐車場・広場）→ 車庫 → 系統 → 駅のホーム → 高さのある建物 → 境界線 → しるし（バス停・家・えらんだもの）→ 文字
  const bs = z >= 4 ? bldsIn(it, v) : [];
  if (bs.length) drawBlds(g, bs, z, 0);
  if (S.parkOK && z >= 5 && it.attrs && it.attrs.size) drawAttrs(g, it, z);   // アトラクション（DB の更新91）
  for (const d of it.deps.values()) if (d.k !== 'ship' && d.k !== 'air') drawDepot(g, d, z);
  if (S.subsOK && z >= 2) for (const v of it.subs.values()) drawSub(g, v, z);   // 変電所（DB の更新89）
  if (S.routeHi) drawRouteHi(g, z, it);
  if (!far) for (const s of it.stas.values()) if (s.k === 'rail') drawStation(g, s, z);   // とても遠いときは駅の四角を出さない（線路だけ）
  if (bs.length) drawBlds(g, bs, z, 1);
  // 遠くの建物（かんたんな形。t63）：くわしい建物を読まない遠さのとき
  if (z < 7 && z >= q('zl', MQ.d2) && !LITE.off) drawLite(g, z, v);
  // 境界線（県・市区町村・町字）
  if (chOn) drawBounds(g, z, v);
  // バス停（しるし。建物にかくれないように）
  for (const s of it.stas.values()) if (s.k === 'bus') drawBusStop(g, s, z);
  // 港（⚓。t54o）・空港（✈。t54p）
  for (const s of it.stas.values()) if (s.k === 'ship' || s.k === 'air') drawPort(g, s, z);
  // 自分の住所（家のしるし。自分にだけ見える）
  if (S.boot && S.boot.home && z >= 1.2) drawHome(g, S.boot.home);
  // えらんだもの
  if (S.sel && S.sel.kind === 'seg') { const s = it.segs.get(S.sel.id); if (s) { g.strokeStyle = 'rgba(220,40,60,.75)'; g.lineWidth = Math.max(4, s.w * z + 4); pathSeg(g, s); g.stroke(); if (s.k === 'rail' && s.col) drawRail(g, s, z); } }   // 路線カラーの線は、えらんでも色が見えるように
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
  // 救急車（DB の更新68）
  if (S.layer.er && !S.v3) drawEr(g, z);
  // 天気図（t62）：雨・雪（または気温）と等圧線。文字の下
  drawWx(g, z, v);
  // 文字（いちばん上）。だいじなものから置き、重なるものはあとから出さない
  drawLabels(g, it, z, v, bs);
  drawWxTop(g, z);   // 等圧線の数字・「高」「低」
  // 道具の上がき
  if (S.drawTool) S.drawTool(g, z);
  licDraw(g, z);   // 鉄道の免許の計画の線（t108）
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
  if (S.subsOK && z >= 8) for (const v of it.subs.values()) subLabel(g, v, z);   // 変電所の名前（DB の更新89）
  if (z >= 9) for (const s of it.stas.values()) if (s.k === 'bus') { const x = sx(s.fx), y = sy(s.fy), r = Math.max(3.5, 0.18 * z); if (x > -80 && y > -40 && x < S.W + 80 && y < S.H + 40) label(g, s.n, x, y - r - 8, { size: 11, color: '#164f99', bg: 'rgba(255,255,255,.85)' }); }
  if (bs.length) bldNames(g, bs, z);
  if (S.layer.label) drawPlaces(g, it, z);
  if (S.layer.label) drawNature(g, z, v);   // 山・湖・峠・岬（t108）
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
// 非電化・単線のしるし（2026-10-29）：非電化はオレンジの帯、単線はむらさきの点線
function trackMark(g, s, z) {
  if (s.el && s.dbl) return;
  const hw = Math.max(7, 0.7 * z);
  g.lineCap = 'butt';
  if (!s.el) { g.strokeStyle = 'rgba(255,140,0,.6)'; g.lineWidth = hw + 6; g.setLineDash([]); pathSeg(g, s); g.stroke(); }
  if (!s.dbl) { g.strokeStyle = 'rgba(190,0,170,.85)'; g.lineWidth = Math.max(3, hw * 0.45); g.setLineDash([Math.max(7, z * 0.7), Math.max(5, z * 0.45)]); pathSeg(g, s); g.stroke(); }
  g.setLineDash([]); g.lineCap = 'round';
}
// 高さ（t108）：トンネル・地下（点線で うすく。入口に短い線）・高架と橋のかげ
function drawTunnel(g, s, z) {
  const rail = s.k === 'rail', w = rail ? Math.max(1.6, (s.q ? 0.46 : s.dbl ? 0.3 : 0.2) * z) : Math.max(1.2, s.w * z * 0.75);
  g.lineCap = 'butt';
  g.strokeStyle = rail ? 'rgba(70,70,70,.5)' : 'rgba(150,140,120,.55)'; g.lineWidth = w; g.setLineDash([Math.max(4, z * 0.45), Math.max(3, z * 0.3)]); pathSeg(g, s); g.stroke();
  g.setLineDash([]);
  const r = s.rng;
  if (r && z >= 2) {   // 入口（トンネルのはしが、線のはしでないところ）
    const P = s.P, n = s.np;
    for (const [i, j] of [[r[0], r[0] + 1], [r[1], r[1] - 1]]) {
      if (i === 0 || i === n - 1 || j < 0 || j > n - 1) continue;
      const dx = P[2 * j] - P[2 * i], dy = P[2 * j + 1] - P[2 * i + 1], L = Math.hypot(dx, dy) || 1, hw = Math.max(5, w * 1.6) / z;
      g.strokeStyle = rail ? '#555' : '#8a7f6a'; g.lineWidth = Math.max(2, 0.08 * z);
      g.beginPath(); g.moveTo(sx(P[2 * i] - dy / L * hw), sy(P[2 * i + 1] + dx / L * hw)); g.lineTo(sx(P[2 * i] + dy / L * hw), sy(P[2 * i + 1] - dx / L * hw)); g.stroke();
    }
  }
  g.lineCap = 'round';
}
function drawUpShadow(g, s, z, w) {
  g.lineCap = 'butt'; g.setLineDash([]);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = w + Math.max(9, 0.5 * z); pathSeg(g, s); g.stroke();
  if (z >= 4) {   // 高架・橋の両わきの線（らんかん）
    const off = (w / 2 + Math.max(3, 0.12 * z)) / z;
    g.strokeStyle = 'rgba(60,60,60,.85)'; g.lineWidth = Math.max(1.2, 0.05 * z);
    for (const o of [off, -off]) { pathSeg(g, s, o); g.stroke(); }
  }
  g.lineCap = 'round';
}
// 電化方式（DB の更新87）：0 直流・1 交流50Hz・2 交流60Hz・3 第三軌条（直流750V。架線の種類で えらぶ。DB の更新99）
const PS_N = ['直流', '交流50Hz', '交流60Hz', '第三軌条'];
// 線路の規格（DB の更新99）：軌間（mm）・三線軌条（2つめの軌間）・枕木・架線・防音壁。上限の速さ（km/h）
const GAUGES = [762, 1067, 1372, 1435], GAUGE_V = { 762: 70, 1067: 160, 1372: 130, 1435: 300 };
const SLP_N = ['PC', '木', 'RC', 'スラブ'], SLP_V = [285, 100, 130, 300], SLP_ORDER = [1, 2, 0, 3];
const SLP_D = ['ふつう（プレストレストコンクリート）', '安いが、維持費が高い', '鉄筋コンクリート。維持費は少し高め', '工事費が高いが、維持費は安い。少しうるさい'];
const CAT_N = ['シンプルカテナリー', '直接吊架式', 'ツインシンプルカテナリー', 'コンパウンドカテナリー', 'ヘビーシンプルカテナリー', '剛体架線', '第三軌条'];
const CAT_V = [130, 85, 130, 160, 300, 110, 90], CAT_ORDER = [1, 0, 2, 3, 4, 5, 6];
const CAT_D = ['ふつう', 'いちばん安い（路面電車のような低い速さの線に）', '電気を遠くまで送れる（変電所が とどく遠さ 1.5倍）', '電気を遠くまで送れる（変電所が とどく遠さ 1.5倍）',
  '高速用（変電所が とどく遠さ 1.2倍）', 'トンネルの中では安い', '直流750V・第三軌条の電車だけ走れる・トンネルの中では安い'];
const NW_N = ['なし', '防音壁', '高い防音壁'];
const segCapAll = s => Math.min(GAUGE_V[s.ga || 1067] || 160, s.g2 ? Math.min(130, GAUGE_V[s.g2] || 160) : 300, SLP_V[s.sl || 0] || 285, s.rk ? 30 : 300);   // 列車ぜんぶの上限
const segCapEl = s => s.el ? Math.min(segCapAll(s), CAT_V[s.ct || 0] || 130) : null;   // 電車の上限（架線も）
const gaugeN = (g, g2) => `${g || 1067}mm${g2 ? `＋${g2}mm（三線軌条）` : ''}`;
const gmN = m => GAUGES.filter((v, i) => m & (1 << i)).map(v => v + 'mm').join('・');   // 編成の軌間のしるし（762 1・1067 2・1372 4・1435 8）
function specLine(s) {
  return [gaugeN(s.ga, s.g2), `${SLP_N[s.sl || 0]}枕木`, s.el ? CAT_N[s.ct || 0] : null, s.nw ? NW_N[s.nw] : null].filter(Boolean);
}
const specHtml = s => specLine(s).map(x => `<span>${esc(x)}</span>`).join('・');   // ことばごとに訳せるように
// 線路の騒音（DB の更新99）のことば（0〜3）
const nzWord = v => v >= 2 ? 'とてもうるさい' : v >= 1 ? 'うるさい' : v >= 0.3 ? 'ややうるさい' : '少し聞こえる';
// デッドセクション（DB の更新87）：電化した線路どうしで、方式のちがう線がつながる点に、黄と黒のしるし
function drawDeadSecs(g, rails, z) {
  const at = new Map();
  for (const s of rails) {
    if (!s.el || !s.P || s.np < 2) continue;
    const ends = [[s.n0, s.P[0], s.P[1], s.P[2], s.P[3]], [s.n1, s.P[2 * s.np - 2], s.P[2 * s.np - 1], s.P[2 * s.np - 4], s.P[2 * s.np - 3]]];
    for (const [n, x, y, x2, y2] of ends) {
      if (n == null) continue;
      let e = at.get(n); if (!e) at.set(n, e = { x, y, a: Math.atan2(y2 - y, x2 - x), ps: new Set() });
      e.ps.add(s.ps || 0);
    }
  }
  const r = Math.max(6, 0.45 * z);
  for (const e of at.values()) {
    if (e.ps.size < 2) continue;
    g.save(); g.translate(sx(e.x), sy(e.y)); g.rotate(e.a + Math.PI / 2);
    g.fillStyle = '#ffd400'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
    g.fillRect(-r, -r * 0.35, 2 * r, r * 0.7); g.strokeRect(-r, -r * 0.35, 2 * r, r * 0.7);
    g.fillStyle = '#111'; for (let k = -1; k <= 1; k += 2) g.fillRect(k * r * 0.5 - r * 0.12, -r * 0.35, r * 0.24, r * 0.7);
    g.restore();
    if (z >= 12) { g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#111'; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
      g.strokeText(T('デッドセクション'), sx(e.x), sy(e.y) - r - 6); g.fillText(T('デッドセクション'), sx(e.x), sy(e.y) - r - 6); }
  }
}
/* ---------- 変電所（DB の更新89）：電化した線路に電気をとどける（同じ持ち主・同じ方式。直流 10km・交流 40km まで） ---------- */
const SUB_SZ = ['小', '中', '大'];
const subKm = ps => ps === 3 ? 4 : ps ? 40 : 10;   // とどく遠さ（km。第三軌条 4km。DB の更新99）
const subCaps = ps => ps === 3 ? '小 1,500・中 3,000・大 6,000 kW' : ps ? '小 10,000・中 20,000・大 40,000 kW' : '小 3,000・中 6,000・大 12,000 kW';
// エアセクション（同じ方式で、電気をとどける変電所がかわる点）に青のしるし。自分の電化した線で、電気が来ていない線は赤の点線
function drawPower(g, rails, z) {
  const at = new Map();
  for (const s of rails) {
    if (!s.el || !s.P || s.np < 2) continue;
    if (s.mine && s.pw2 && s.fd == null) {   // 変電所から遠い（電気が来ていない。電車は走れない）
      g.save(); g.strokeStyle = 'rgba(214,30,30,.9)'; g.lineWidth = Math.max(2, 0.14 * z); g.lineCap = 'butt'; g.setLineDash([7, 5]); pathSeg(g, s); g.stroke(); g.restore();
    }
    if (z < 6 || s.fd == null) continue;
    const ends = [[s.n0, s.P[0], s.P[1], s.P[2], s.P[3]], [s.n1, s.P[2 * s.np - 2], s.P[2 * s.np - 1], s.P[2 * s.np - 4], s.P[2 * s.np - 3]]];
    for (const [n, x, y, x2, y2] of ends) {
      if (n == null) continue;
      let e = at.get(n); if (!e) at.set(n, e = { x, y, a: Math.atan2(y2 - y, x2 - x), fd: new Set(), ps: new Set() });
      e.fd.add(s.fd); e.ps.add(s.ps || 0);
    }
  }
  const r = Math.max(6, 0.45 * z);
  for (const e of at.values()) {
    if (e.fd.size < 2 || e.ps.size > 1) continue;   // 方式がちがう点は デッドセクション
    g.save(); g.translate(sx(e.x), sy(e.y)); g.rotate(e.a + Math.PI / 2);
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'butt';
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(-r, k * r * 0.28); g.lineTo(r, k * r * 0.28); g.stroke(); }
    g.strokeStyle = '#1f5fbf'; g.lineWidth = 2;
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(-r, k * r * 0.28); g.lineTo(r, k * r * 0.28); g.stroke(); }
    g.restore();
    if (z >= 12) { g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#1f5fbf'; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
      g.strokeText(T('エアセクション'), sx(e.x), sy(e.y) - r - 6); g.fillText(T('エアセクション'), sx(e.x), sy(e.y) - r - 6); }
  }
}
const subR = z => Math.max(6, Math.min(13, 0.3 * z));
// 変電所のしるし：紺の四角に黄の ⚡（容量をこえている：オレンジ・止まっている：赤）
function drawSub(g, v, z) {
  const x = sx(v.fx), y = sy(v.fy), r = subR(z);
  if (x < -20 || y < -20 || x > S.W + 20 || y > S.H + 20) return;
  const over = v.ld != null && v.ld > v.cap;
  g.save();
  if (S.sel && S.sel.kind === 'sub' && S.sel.id === v.id) { g.strokeStyle = 'rgba(220,40,60,.8)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r * 1.7, 0, 6.3); g.stroke(); }
  g.fillStyle = v.tr ? '#c62828' : over ? '#e67e00' : '#1f3f73'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.beginPath(); if (g.roundRect) g.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3); else g.rect(x - r, y - r, 2 * r, 2 * r); g.fill(); g.stroke();
  g.fillStyle = '#ffd400'; g.beginPath();
  g.moveTo(x + 0.18 * r, y - 0.8 * r); g.lineTo(x - 0.48 * r, y + 0.12 * r); g.lineTo(x - 0.04 * r, y + 0.12 * r);
  g.lineTo(x - 0.22 * r, y + 0.8 * r); g.lineTo(x + 0.48 * r, y - 0.14 * r); g.lineTo(x + 0.04 * r, y - 0.14 * r); g.closePath(); g.fill();
  g.restore();
}
function subLabel(g, v, z) {
  const x = sx(v.fx), y = sy(v.fy); if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  label(g, v.n, x, y + subR(z) + 9, { size: 10, color: '#1f3f73', bg: 'rgba(255,255,255,.85)' });
}
function nearSub(x, y, rpx) {
  const it = S.vis; if (!it || !it.subs) return null; let best = null;
  for (const v of it.subs.values()) { const d = Math.hypot(v.fx - x, v.fy - y) * S.cam.z; if (d < Math.max(rpx, subR(S.cam.z) + 4) && (!best || d < best.d)) best = { v, d }; }
  return best;
}
function showSub(v) {
  S.sel = { kind: 'sub', id: v.id }; S.dirty = true;
  const own = v.o === 'gov' ? '国' : (S.vis.names[v.o] || ''), pct = v.ld != null && v.cap > 0 ? Math.round(100 * v.ld / v.cap) : null;
  sheet(`<h4>⚡ <span>${esc(v.n)}</span></h4>
    <div class="mp-kv"><b>持ち主</b><span><span>${esc(own)}</span>${v.mine && v.o !== 'gov' ? '<small>（あなた）</small>' : ''}</span>
      <b>方式</b><span>${PS_N[v.ps || 0]}</span>
      <b>大きさ</b><span><span>${SUB_SZ[v.sz] || ''}</span>（容量 <span>${fmt(v.cap)}</span> kW）</span>
      <b>負荷</b><span>${pct == null ? 'まだ計算していません（1時間ごと）' : `いちばん多いとき 約 <span>${fmt(v.ld)}</span> kW（<span class="${pct > 100 ? 'mp-warn' : ''}">${pct}%</span>）`}</span>
      <b>とどく遠さ</b><span>${subKm(v.ps)} km</span>
      ${v.tr ? '<b>いま</b><span class="mp-warn">止まっています（電気の使いすぎ）</span>' : ''}</div>
    <p class="small muted" style="margin:4px 0">同じ持ち主・同じ方式の電化した線路に、電気をとどけます。1時間の負荷が容量をこえると電圧が下がって遅れ、1.5倍をこえると止まります（運転見合わせ）</p>
    ${v.mine ? '<div class="mp-row"><button class="btn" data-size>大きさ・名前</button><button class="btn" data-del>こわす</button></div>' : ''}`, sh => {
    const b1 = sh.querySelector('[data-size]'); if (b1) b1.onclick = () => subSize(v);
    const b2 = sh.querySelector('[data-del]'); if (b2) b2.onclick = () => subDel(v);
  });
}
// 大きさ・名前を変える（大きくするのは差の工事費。小さくするのは無料）
function subSize(v) {
  const st = { sz: v.sz, name: v.n, q: null, err: null, quoting: false, seq: 0 };
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_sub_set', { p_id: v.id, p_sz: st.sz, p_name: st.name, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; draw();
  };
  const draw = () => {
    const q = st.q;
    sheet(`<h4>⚡ 変電所の大きさ・名前</h4>
      <div class="mp-row small" style="align-items:center"><span>大きさ</span><span class="mp-seg">${SUB_SZ.map((n, k) => `<button data-sz="${k}" class="${st.sz === k ? 'on' : ''}">${n}</button>`).join('')}</span></div>
      <p class="small muted" style="margin:0 0 4px">容量：<span>${subCaps(v.ps)}</span></p>
      <div class="mp-row small" style="align-items:center"><span>名前</span><input class="mp-inp" data-name maxlength="30" value="${esc(st.name)}"></div>
      <div class="mp-row">${q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span><span class="small muted"><span>容量 ${fmt(q.cap)} kW</span>・<span>維持費 1日 ${X(q.upk)}</span></span>`
        : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button>'}</div>
      <div class="mp-row"><button class="btn main" data-ok ${q ? '' : 'disabled'}>変える</button><button class="btn" data-back>もどる</button></div>
      <p class="muted small" style="margin:4px 0 0">大きくするのは差の工事費。小さくするのは無料（返金なし）</p>`, sh => {
      sh.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => { st.sz = Number(b.dataset.sz); st.seq++; st.quoting = false; st.q = null; st.err = null; draw(); });
      const nm = sh.querySelector('[data-name]'); nm.oninput = () => { st.name = nm.value; };
      { const e = sh.querySelector('[data-est]'); if (e) e.onclick = () => quote(); }
      sh.querySelector('[data-back]').onclick = () => showSub(v);
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_sub_set', { p_id: v.id, p_sz: st.sz, p_name: st.name, p_dry: false });
        if (!r) return;
        toast(r.cost > 0 ? `変えました（${fmt(r.cost)} X）` : '変えました');
        refreshBox(v.fx - 3, v.fy - 3, v.fx + 3, v.fy + 3); S.sel = null; sheet(null);
      };
    });
  };
  draw();
}
// こわす（返金なし）：電気が来なくなる線・通る系統の数を見せてから
async function subDel(v) {
  const q = await api('mp_sub_del', { p_id: v.id, p_dry: true }); if (!q) return;
  sheet(`<h4>⚡ <span>${esc(v.n)}</span>をこわす</h4>
    ${q.lost ? `<p class="mp-warn">電気が来なくなる線路が <span>${q.lost}</span>本あります（通る系統 <span>${q.routes}</span>。その区間の電車は走れなくなります）</p>` : '<p class="small">ほかの変電所から電気がとどくので、電車はそのまま走れます</p>'}
    <p class="muted small">こわしても お金はもどりません</p>
    <div class="mp-row"><button class="btn main" data-ok>こわす</button><button class="btn" data-back>もどる</button></div>`, sh => {
    sh.querySelector('[data-back]').onclick = () => showSub(v);
    sh.querySelector('[data-ok]').onclick = async () => {
      const r = await api('mp_sub_del', { p_id: v.id, p_dry: false }, '変電所をこわしました'); if (!r) return;
      const k = subKm(v.ps) * 20 + 2; refreshBox(v.fx - k, v.fy - k, v.fx + k, v.fy + k); S.sel = null; sheet(null);
    };
  });
}
// 線のシートの「電気」の行：どの変電所から来ているか・来ていないか
function subFeedRow(s) {
  if (s.k !== 'rail' || !s.el || !S.subsOK || !s.pw2) return '';
  const v = s.fd != null && S.vis.subs ? S.vis.subs.get(s.fd) : null;
  return `<b>電気</b><span>${s.fd != null ? (v ? `<span>${esc(v.n)}</span>から` : '変電所から') : '<span class="mp-warn">変電所から遠く、電気が来ていません（電車は走れません）</span>'}</span>`;
}
// 変電所をつくる（自分の電化した線路の上の、タップしたところ）
function subBuild(s, hit) {
  const st = { sz: 1, name: '', q: null, err: null, quoting: false, seq: 0 };
  const args = dry => ({ p_seg: s.id, p_x: hit.x, p_y: hit.y, p_sz: st.sz, p_name: st.name.trim() || null, p_dry: dry });
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_sub_build', args(true)); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; draw();
  };
  const draw = () => {
    const q = st.q;
    sheet(`<h4>⚡ 変電所をつくる</h4>
      <p class="small muted" style="margin:0 0 4px">この線路の上（タップしたところ）に。同じ持ち主・同じ方式（<span>${PS_N[s.ps || 0]}</span>）の電化した線路に、<span>${subKm(s.ps)}</span> km まで電気をとどけます</p>
      <div class="mp-row small" style="align-items:center"><span>大きさ</span><span class="mp-seg">${SUB_SZ.map((n, k) => `<button data-sz="${k}" class="${st.sz === k ? 'on' : ''}">${n}</button>`).join('')}</span></div>
      <p class="small muted" style="margin:0 0 4px">容量：<span>${subCaps(s.ps)}</span></p>
      <div class="mp-row small" style="align-items:center"><span>名前</span><input class="mp-inp" data-name maxlength="30" value="${esc(st.name)}" placeholder="${esc(q && q.name ? q.name : '近い駅の名前＋変電所')}"></div>
      <div class="mp-row">${q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span><span class="small muted"><span>容量 ${fmt(q.cap)} kW</span>・<span>維持費 1日 ${X(q.upk)}</span>${q.newfed ? `<br><span>電気が来るようになる線路 ${q.newfed}本</span>` : ''}</span>`
        : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button>'}</div>
      <div class="mp-row"><button class="btn main" data-ok ${q ? '' : 'disabled'}>つくる</button><button class="btn" data-back>もどる</button></div>
      <p class="muted small" style="margin:4px 0 0">1時間の負荷が容量をこえると電圧が下がって遅れ、1.5倍をこえると止まります。列車の多い線は大きく、長い線は とちゅうにもう1つ</p>`, sh => {
      sh.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => { st.sz = Number(b.dataset.sz); st.seq++; st.quoting = false; st.q = null; st.err = null; draw(); });
      const nm = sh.querySelector('[data-name]'); nm.oninput = () => { st.name = nm.value; };
      { const e = sh.querySelector('[data-est]'); if (e) e.onclick = () => quote(); }
      sh.querySelector('[data-back]').onclick = () => showSeg(s, hit);
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_sub_build', args(false));
        if (!r) return;
        toast(r.cost > 0 ? `変電所「${r.name}」をつくりました（${fmt(r.cost)} X）` : `変電所「${r.name}」をつくりました`);
        const k = subKm(s.ps) * 20 + 2; refreshBox(hit.x - k, hit.y - k, hit.x + k, hit.y + k); S.sel = null; sheet(null);
      };
    });
  };
  draw();
}
/* ---------- アトラクション（DB の更新91）：遊園地・テーマパークの乗りもの。大きさは本物ぐらい（観覧車は直径 100m） ---------- */
const PARK_K = ['amuse', 'tpark'];
const ATTR_N = { wheel: '観覧車', coaster: 'ジェットコースター', merry: 'メリーゴーラウンド', cups: 'コーヒーカップ', haunt: 'お化け屋敷', water: 'ウォーターライド', drop: 'フリーフォール', kart: 'ゴーカート', show: 'ショー劇場' };
const ATTR_R = { wheel: 1, coaster: 1.6, merry: 0.4, cups: 0.4, haunt: 0.5, water: 1.2, drop: 0.35, kart: 0.9, show: 0.7 };   // 半径（マス。サーバーの _mp_attr_kinds の r と同じ）
function drawAttrs(g, it, z) {
  for (const a of it.attrs.values()) {
    const x = sx(a.x), y = sy(a.y), r = Math.max(5, (ATTR_R[a.k] || 0.6) * z);
    if (x < -r - 40 || y < -r - 40 || x > S.W + r + 40 || y > S.H + r + 40) continue;
    g.save(); g.translate(x, y); drawAttr(g, a.k, r); g.restore();
    if (z >= 12) label(g, T(ATTR_N[a.k] || ''), x, y + r + 9, { size: 10, color: '#7a2a52', bg: 'rgba(255,255,255,.85)' });
  }
}
function drawAttr(g, k, r) {
  const lw = Math.max(1.2, r * 0.08);
  g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  switch (k) {
    case 'wheel': {   // 観覧車：輪・スポーク・ゴンドラ
      g.strokeStyle = '#c8325f'; g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2);
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.moveTo(0, 0); g.lineTo(r * 0.9 * Math.cos(a), r * 0.9 * Math.sin(a)); }
      g.stroke();
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillStyle = ['#f6c343', '#5aa9e6', '#7bc96f', '#ef7fa8'][i % 4]; g.beginPath(); g.arc(r * 0.9 * Math.cos(a), r * 0.9 * Math.sin(a), Math.max(1.5, r * 0.09), 0, Math.PI * 2); g.fill(); }
      break; }
    case 'coaster': {   // ジェットコースター：まわるレールと、宙がえりの輪
      g.strokeStyle = 'rgba(80,60,60,.35)'; g.lineWidth = lw * 2.4;
      const path = () => { g.beginPath(); g.moveTo(-r, r * 0.35); g.bezierCurveTo(-r * 0.9, -r * 0.9, -r * 0.1, -r * 0.9, 0, -r * 0.1); g.bezierCurveTo(r * 0.1, r * 0.6, r * 0.8, r * 0.7, r, 0);
        g.bezierCurveTo(r * 1.1, -r * 0.6, r * 0.4, -r * 0.8, r * 0.3, -r * 0.3); g.moveTo(-r, r * 0.35); g.bezierCurveTo(-r * 0.6, r * 0.9, r * 0.5, r * 0.95, r, 0); };
      path(); g.stroke(); g.strokeStyle = '#d23c3c'; g.lineWidth = lw * 1.3; path(); g.stroke();
      g.beginPath(); g.arc(-r * 0.45, r * 0.25, r * 0.28, 0, Math.PI * 2); g.stroke();
      break; }
    case 'merry': {   // メリーゴーラウンド：しまの屋根
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e4607f'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, i * Math.PI / 6, (i + 1) * Math.PI / 6); g.closePath(); g.fill(); }
      g.strokeStyle = '#b8436a'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f6c343'; g.beginPath(); g.arc(0, 0, r * 0.18, 0, Math.PI * 2); g.fill();
      break; }
    case 'cups': {   // コーヒーカップ：3つのカップ
      g.fillStyle = 'rgba(240,230,210,.95)'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      ['#ef7fa8', '#5aa9e6', '#f6c343'].forEach((c, i) => { const a = i * 2.094 - 1.57; g.fillStyle = c; g.beginPath(); g.arc(r * 0.5 * Math.cos(a), r * 0.5 * Math.sin(a), r * 0.32, 0, Math.PI * 2); g.fill(); });
      break; }
    case 'haunt': {   // お化け屋敷：紫の館
      g.fillStyle = '#4b3361'; g.beginPath(); g.moveTo(-r, r * 0.8); g.lineTo(-r, -r * 0.2); g.lineTo(0, -r); g.lineTo(r, -r * 0.2); g.lineTo(r, r * 0.8); g.closePath(); g.fill();
      g.fillStyle = '#f2d34b'; for (const [wx, wy] of [[-0.45, 0.05], [0.25, 0.05], [-0.45, 0.45], [0.25, 0.45]]) g.fillRect(wx * r, wy * r, r * 0.22, r * 0.18);
      break; }
    case 'water': {   // ウォーターライド：水路と水しぶき
      g.strokeStyle = '#3a8fd1'; g.lineWidth = lw * 2.2; g.beginPath(); g.moveTo(-r, -r * 0.3); g.bezierCurveTo(-r * 0.4, -r * 1.1, r * 0.2, r * 0.6, r * 0.8, -r * 0.2); g.stroke();
      g.strokeStyle = '#bfe3fb'; g.lineWidth = lw; g.stroke();
      g.fillStyle = 'rgba(160,215,250,.9)'; g.beginPath(); g.arc(r * 0.8, -r * 0.2, r * 0.25, 0, Math.PI * 2); g.fill();
      break; }
    case 'drop': {   // フリーフォール：塔（上から見た輪）
      g.fillStyle = '#9aa3ad'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#e4607f'; g.lineWidth = lw * 1.6; g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI * 2); g.fill();
      break; }
    case 'kart': {   // ゴーカート：楕円のコース
      g.fillStyle = '#8fc46f'; g.strokeStyle = '#6b6e73'; g.lineWidth = lw * 2.2; g.beginPath(); g.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = lw * 0.6; g.setLineDash([r * 0.12, r * 0.12]); g.beginPath(); g.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      break; }
    case 'show': {   // ショー劇場：屋根と星
      g.fillStyle = '#6b4fa0'; g.beginPath(); if (g.roundRect) g.roundRect(-r, -r * 0.7, 2 * r, 1.4 * r, r * 0.25); else g.rect(-r, -r * 0.7, 2 * r, 1.4 * r); g.fill();
      g.fillStyle = '#f6c343'; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.22 : r * 0.5; g[i ? 'lineTo' : 'moveTo'](rr * Math.cos(a), rr * Math.sin(a)); }
      g.closePath(); g.fill();
      break; }
    default: g.fillStyle = '#e4607f'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  }
}
// 建物のシート：アトラクションの一覧・つくる・こわす（遊園地・テーマパーク）
async function attrFill(el, bid, reload) {
  let L;
  try { L = await call('mp_attr_list', { p_bld: bid }); } catch (e) { el.innerHTML = /mp_attr_list|schema cache|function/i.test(e.message) ? '' : `<p class="mp-warn small">${esc(errJa(e.message))}</p>`; return; }
  if (!L || !L.park) { el.innerHTML = ''; return; }
  const K = L.kinds || {}, items = L.items || [], can = L.mine && items.length < L.max;
  const st = { k: Object.keys(K)[0], q: null };
  const draw = () => {
    el.innerHTML = `<h4 style="margin:12px 0 4px">🎢 <span>アトラクション</span> <small class="muted">${items.length} / ${L.max}</small></h4>
      ${items.length ? items.map(a => { const kn = (K[a.k] || {}).n || a.k; return `<div class="mp-row small" style="justify-content:space-between;margin:2px 0"><span><b>${esc(a.n)}</b>${a.n !== kn && !a.n.startsWith(kn) ? ` <small class="muted">${esc(kn)}</small>` : ''} <small class="muted">人気 ${Math.round(a.fresh * 100)}%・${esc(a.at)}</small></span>${L.mine ? `<button class="btn" data-adel="${a.id}" style="padding:2px 8px">こわす</button>` : ''}</div>`; }).join('') : '<p class="muted small" style="margin:0">まだありません</p>'}
      ${L.mine ? `<div class="mp-row"><select class="mp-inp" data-ak style="flex:1 1 170px">${Object.entries(K).map(([k, v]) => `<option value="${k}" ${k === st.k ? 'selected' : ''}>${esc(v.n)}</option>`).join('')}</select>
          <button class="btn" data-aest ${can ? '' : 'disabled'}>見つもる</button></div>
        ${st.q ? `<div class="mp-row"><span class="mp-cost">工事費 ${X(st.q.cost)}</span><span class="small muted"><span>定員 +${fmt(st.q.cap)}人</span>・<span>人気 +${Math.round(st.q.ap * 100)}%</span>・<span>維持費 1日 ${X(st.q.upk)}</span></span>
          <button class="btn main" data-ago>つくる</button></div>` : ''}
        ${!can && items.length >= L.max ? `<p class="mp-warn small" style="margin:2px 0">この広さでは ${L.max}こまでです</p>` : ''}` : ''}
      <p class="muted small" style="margin:2px 0 6px">アトラクションをつくると、定員と人気がふえて、来場者がふえます（人気は、つくってから2年で半分まで下がります）。土地 150区画ごとに1つ・同じものは3つまで。維持費は1日ごと。こわしても お金はもどりません</p>`;
    const ak = el.querySelector('[data-ak]'); if (ak) ak.onchange = () => { st.k = ak.value; st.q = null; draw(); };
    const ae = el.querySelector('[data-aest]'); if (ae) ae.onclick = async () => { const q = await api('mp_attr_build', { p_bld: bid, p_kind: st.k, p_name: null, p_as: S.as, p_dry: true }); if (q) { st.q = q; draw(); } };
    const ag = el.querySelector('[data-ago]'); if (ag) ag.onclick = async () => {
      const r = await api('mp_attr_build', { p_bld: bid, p_kind: st.k, p_name: null, p_as: S.as, p_dry: false });
      if (r) { toast(T(`「${r.name}」をつくりました（${fmt(r.cost)} X）`)); refreshAround(bid); reload(); }
    };
    el.querySelectorAll('[data-adel]').forEach(x => x.onclick = async () => {
      const a = items.find(i => i.id === Number(x.dataset.adel)); if (!a) return;
      if (!await confirm2(T(`「${a.n}」をこわします（工事費はもどりません）。よろしいですか？`), { what: `「${a.n}」`, q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません。工事費はもどりません。' })) return;
      if (await api('mp_attr_del', { p_attr: a.id, p_as: S.as }, 'こわしました')) { refreshAround(bid); reload(); }
    });
  };
  draw();
}
// 建物のまわりの地図を読みなおす（アトラクションの絵）
function refreshAround(bid) {
  const b = S.vis && S.vis.blds ? S.vis.blds.get(bid) : null;
  if (b && b.bb) refreshBox(b.bb[0] - 1, b.bb[1] - 1, b.bb[2] + 1, b.bb[3] + 1); else { for (const c of S.cells.values()) c.stale = true; S.dirty = true; needCells(); }
}
/* ---------- 競馬場（国の建物）・場外馬券売り場（DB の更新92） ---------- */
const TRACK_WH = { '府中': [112, 52], '京都': [102, 52], '中京': [92, 46] };   // 区画（横長）。サーバーの _mp_track_wh と同じ
const RACE_G = g => /^(G1|G2|G3|L|OP)$/.test(g || '');
const RACE_GN = { G1: 'G1', G2: 'G2', G3: 'G3', L: 'リステッド', OP: 'オープン' };
const whyTrk = r => [r.owned ? `持ち主のいる土地 ${fmt(r.owned)}区画` : '', r.busy ? `道路・線路・駅など ${fmt(r.busy)}区画` : '', r.water ? `海・川・湖 ${fmt(r.water)}区画` : '',
  r.mount ? `山 ${fmt(r.mount)}区画` : '', r.park ? `公園 ${fmt(r.park)}区画` : ''].filter(Boolean).join('・') || '—';
// きょうのレース（ひとつづきのレースごと）
function raceSes(L, withK) {
  const ses = L.today || [], d = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (!ses.length) return '<span class="muted">きょうのレースはありません</span>';
  return ses.map(x => `<span${x.t < hm ? ' class="muted"' : ''}><span translate="no">${esc(x.t)}</span>〜 ${withK ? `<span translate="no">${esc(x.k)}</span> ` : ''}<span>${x.n}レース</span>${RACE_G(x.g) ? ` <small>（<span translate="no">${esc(x.top || '')}</span> ${esc(RACE_GN[x.g] || x.g)}）</small>` : ''}</span>`).join('<br>');
}
async function kbFill(el, bid) {
  let L;
  try { L = await call('mp_track_info', { p_bld: bid }); } catch (e) { el.innerHTML = /mp_track_info|schema cache|function/i.test(e.message) ? '' : `<p class="mp-warn small">${esc(errJa(e.message))}</p>`; return; }
  if (!L) { el.innerHTML = ''; return; }
  if (L.kind === 'keiba') {
    const sta = L.sta || [];
    el.innerHTML = `<h4 style="margin:12px 0 4px">🏇 <span>競馬場</span> <small class="muted"><span>会場</span> <span translate="no">${esc(L.k)}</span></small></h4><div class="mp-kv">
      <b>広さ</b><span>${fmt(L.w)}m × ${fmt(L.h)}m</span>
      <b>きょうのレース</b><span>${raceSes(L, false)}</span>
      <b>来場者</b><span>${L.vis ? `<span>きょう 約${fmt(L.vis)}人</span> <small>（見こみ）</small>` : '—'}</span>
      <b>お客が乗る駅</b><span>${sta.length ? sta.map(x => `<span><span translate="no">${esc(x.n)}</span> <small>（${x.k === 'bus' ? 'バス停・' : ''}${fmt(x.m)}m・${x.f}%）</small></span>`).join('<br>') : '<span class="muted">まだありません</span>'}</span></div>
      <p class="muted small" style="margin:2px 0 6px">その会場のレースの時間には、来場者が近くの駅（競馬場のふちから800m）・バス停（400m）で乗り降りします（行きと帰り。G1 などの大きなレースは とても多い）。列車をふやしておくと、たくさん運べます。</p>`;
  } else {
    el.innerHTML = `<h4 style="margin:12px 0 4px">🏇 <span>きょうのレース</span></h4><div class="mp-kv"><b>レース</b><span>${raceSes(L, true)}</span></div>`;
  }
}
// 管理：競馬場（国）の一覧・地図でおく・場所を変える・とりのぞく
async function trkAdminFill(el, m) {
  if (!el) return;
  let L;
  try { L = await call('mp_track_list', {}); } catch (e) { el.innerHTML = /mp_track_list|schema cache|function/i.test(e.message) ? '<p class="muted small">サーバーの更新（DB の更新92）のあとで使えます</p>' : `<p class="mp-warn small">${esc(errJa(e.message))}</p>`; return; }
  L = L || [];
  const nmOK = L.some(t => 'auto' in t);   // 名前を変えられるサーバー（DB の更新93）
  el.innerHTML = L.map(t => `<div class="mp-row small" style="justify-content:space-between;margin:2px 0;flex-wrap:wrap"><span>${t.bld
        ? `${t.name ? `<b translate="no">${esc(t.name)}</b> ` : ''}<small class="muted"><span>会場</span> <span translate="no">${esc(t.k)}</span></small> <span translate="no">${esc(t.addr || '')}</span>`
        : `<b><span>会場</span> <span translate="no">${esc(t.k)}</span></b> <span class="muted">まだ地図にありません</span>`}</span>
      <span>${t.bld ? `<button class="btn" data-tgo="${esc(t.k)}" style="padding:2px 8px">見に行く</button> ` : ''}${t.bld && nmOK ? `<button class="btn" data-tren="${esc(t.k)}" style="padding:2px 8px">名前</button> ` : ''}<button class="btn" data-tput="${esc(t.k)}" style="padding:2px 8px">${t.bld ? '場所を変える' : '地図でおく'}</button>${t.bld ? ` <button class="btn" data-tdel="${esc(t.k)}" style="padding:2px 8px;color:#c33">とりのぞく</button>` : ''}</span></div>`).join('')
    + '<p class="muted small" style="margin:2px 0 6px">競馬場は国の建物です（競馬の会場 府中・京都・中京 ごとに1つ）。名前は、おいた場所の地名からつきます（「名前」で変えられます）。その会場のレースの時間には、来場者が近くの駅（ふちから800m）・バス停（400m）で乗り降りします。おけるのは、道路・線路・駅・持ち主のいる土地・水・山・公園のないところです。</p>';
  const T0 = k => L.find(t => t.k === k);
  el.querySelectorAll('[data-tput]').forEach(x => x.onclick = () => { m.close(); trackTool(x.dataset.tput, T0(x.dataset.tput)); });
  el.querySelectorAll('[data-tgo]').forEach(x => x.onclick = () => { const t = T0(x.dataset.tgo); m.close(); setCam(t.x / 5, t.y / 5, 8); });
  el.querySelectorAll('[data-tren]').forEach(x => x.onclick = async () => {   // 名前を変える（DB の更新93）
    const t = T0(x.dataset.tren), nm = prompt(T('競馬場の名前（30文字まで。空にすると、おいた場所の地名から）'), t.nm || '');
    if (nm == null) return;
    if (await api('mp_track_rename', { p_k: t.k, p_name: nm }, '名前を変えました')) {
      if (t.rect) refreshBox(Math.floor(t.rect[0] / 5) - 1, Math.floor(t.rect[1] / 5) - 1, Math.floor(t.rect[2] / 5) + 1, Math.floor(t.rect[3] / 5) + 1);
      trkAdminFill(el, m);
    }
  });
  el.querySelectorAll('[data-tdel]').forEach(x => x.onclick = async () => {
    const t = T0(x.dataset.tdel);
    if (!await confirm2(`「${t.name || '競馬場'}」（会場 ${t.k}）を地図からとりのぞきます（筆と建物がなくなります）。よろしいですか？`, { what: `「${t.name || '競馬場'}」`, q: '本当にとりのぞきますか？', ok: 'とりのぞく', note: '筆と建物がなくなります（あとでまた おけます）。' })) return;
    if (await api('mp_track_del', { p_k: t.k }, 'とりのぞきました')) {
      if (t.rect) refreshBox(Math.floor(t.rect[0] / 5) - 1, Math.floor(t.rect[1] / 5) - 1, Math.floor(t.rect[2] / 5) + 1, Math.floor(t.rect[3] / 5) + 1);
      trkAdminFill(el, m);
    }
  });
}
// 管理：競馬場を地図でおく（まん中をタップ → しらべる → おく）。もうあれば場所を変える
function trackTool(k, cur) {
  setTool('look');
  const st = S.toolState = { c: cur && cur.bld ? [cur.x, cur.y] : null, dir: (cur && cur.dir) || 'h', r: null };
  hint(`競馬場（会場 ${k}）：おきたいところ（まん中）をタップします`);
  const rect = () => { const z = TRACK_WH[k] || [100, 50], w = st.dir === 'v' ? z[1] : z[0], h = st.dir === 'v' ? z[0] : z[1], x0 = st.c[0] - Math.floor(w / 2), y0 = st.c[1] - Math.floor(h / 2); return [x0, y0, x0 + w - 1, y0 + h - 1]; };
  S.drawTool = (g, z) => {
    if (!st.c) return;
    const [x0, y0, x1, y1] = st.r && st.r.rect ? st.r.rect : rect(), ok = st.r && st.r.ok, W = (x1 - x0 + 1) / 5 * z, H = (y1 - y0 + 1) / 5 * z;
    g.fillStyle = ok ? 'rgba(40,150,60,.2)' : st.r ? 'rgba(210,40,40,.18)' : 'rgba(120,120,120,.15)'; g.fillRect(sx(x0 / 5), sy(y0 / 5), W, H);
    g.strokeStyle = ok ? '#1f7a33' : st.r ? '#c33' : '#777'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(sx(x0 / 5), sy(y0 / 5), W, H); g.setLineDash([]);
  };
  const show = () => {
    const r = st.r;
    sheet(`<h4><span>競馬場</span> <small class="muted"><span>会場</span> <span translate="no">${esc(k)}</span></small></h4>
      ${!st.c ? '<p class="muted small">地図をタップしてください（そこが競馬場のまん中になります）</p>'
        : !r ? '<p class="muted small">しらべています…</p>'
        : `<p class="small" style="margin:2px 0">${r.addr ? `<span translate="no">${esc(r.addr)}</span>・` : ''}${r.ok ? '<b style="color:#1a7f37">ここにおけます</b>' : `<span class="mp-warn">おけません：${esc(whyTrk(r))}</span>`}</p>
          ${r.name ? `<p class="small" style="margin:2px 0"><span>名前</span>：<b translate="no">${esc(r.name)}</b> <small class="muted">${r.auto ? '（おいた場所の地名から。あとで変えられます）' : ''}</small></p>` : ''}`}
      <div class="mp-row"><button class="btn" data-tdir>${st.dir === 'v' ? '横長にする' : '縦長にする'}</button><button class="btn" data-tfind ${st.c ? '' : 'disabled'}>近くでさがす</button>
        <button class="btn main" data-tok ${r && r.ok ? '' : 'disabled'}>${cur && cur.bld ? 'ここにうつす' : 'ここにおく'}</button></div>
      <p class="muted small" style="margin:2px 0">大きさ ${(st.dir === 'v' ? [...(TRACK_WH[k] || [0, 0])].reverse() : (TRACK_WH[k] || [0, 0])).map(v => fmt(v * 10) + 'm').join(' × ')}（${st.dir === 'v' ? '縦長' : '横長'}）。道路・線路・駅・持ち主のいる土地・水・山・公園のないところに おけます</p>`, sh => {
      q0(sh, '[data-tdir]').onclick = () => { st.dir = st.dir === 'v' ? 'h' : 'v'; check(); };
      q0(sh, '[data-tfind]').onclick = async () => {
        if (!st.c) return;
        toast(T('さがしています…'));
        const f = await api('mp_track_find', { p_k: k, p_x: st.c[0], p_y: st.c[1], p_dir: st.dir }); if (!f) return;
        if (f.x == null) return toast(T('近く（4km）に おけるところが見つかりませんでした'));
        st.c = [f.x, f.y]; setCam(f.x / 5, f.y / 5, S.cam.z); check();
      };
      q0(sh, '[data-tok]').onclick = async () => {
        if (!st.r || !st.r.ok) return;
        const tn = st.r.name ? `「${st.r.name}」` : '競馬場';
        if (!await confirm2(`${tn}（会場 ${k}）を${st.r.addr ? `「${st.r.addr}」に` : 'ここに'}${cur && cur.bld ? 'うつします（いまの競馬場はとりのぞきます）' : 'おきます'}。よろしいですか？`, { what: tn, q: cur && cur.bld ? '本当にうつしますか？' : '本当におきますか？', ok: cur && cur.bld ? 'うつす' : 'おく', note: cur && cur.bld ? 'いまの競馬場の筆と建物はなくなります（場所はまた変えられます）。' : '場所はあとで変えられます。' })) return;
        const d = await api('mp_track_place', { p_k: k, p_x: st.c[0], p_y: st.c[1], p_dir: st.dir, p_dry: false }, cur && cur.bld ? 'うつしました' : 'おきました'); if (!d) return;
        const [x0, y0, x1, y1] = d.rect || rect(); refreshBox(Math.floor(x0 / 5) - 1, Math.floor(y0 / 5) - 1, Math.floor(x1 / 5) + 1, Math.floor(y1 / 5) + 1);
        if (cur && cur.rect) refreshBox(Math.floor(cur.rect[0] / 5) - 1, Math.floor(cur.rect[1] / 5) - 1, Math.floor(cur.rect[2] / 5) + 1, Math.floor(cur.rect[3] / 5) + 1);
        setTool('look');
      };
    });
  };
  const check = async () => {
    if (!st.c) return show();
    st.r = null; S.dirty = true; show();
    const c0 = st.c.join(',') + st.dir, r = await api('mp_track_place', { p_k: k, p_x: st.c[0], p_y: st.c[1], p_dir: st.dir, p_dry: true });
    if (S.toolState !== st || c0 !== st.c.join(',') + st.dir) return;   // しらべているあいだに、ほかをタップした
    st.r = r; S.dirty = true; show();
  };
  S.tapHook = (x, y) => { st.c = [Math.floor(x * 5), Math.floor(y * 5)]; check(); };
  S.toolEnd = () => { S.tapHook = null; S.toolState = null; S.drawTool = null; };
  if (st.c) { setCam(st.c[0] / 5, st.c[1] / 5, 8); check(); } else show();
  S.dirty = true;
}
function drawRail(g, s, z) {
  const mine = s.mine, col = s.col && /^#[0-9a-f]{6}$/i.test(s.col) ? s.col : null;   // 路線カラー（2026-10-29）
  const w = Math.max(1.8, (s.q ? 0.52 : s.dbl ? 0.34 : 0.22) * z);   // 複々線（DB の更新86）は太く
  // 線路の規格（DB の更新99）：軌間で太さ（大きく見たとき）・枕木の色（木は茶色・スラブは つながった灰色）・三線軌条と第三軌条の細い線
  const gk = z >= 10 ? ({ 762: 0.75, 1372: 1.08, 1435: 1.15 }[s.ga] || 1) : 1, tie = s.sl === 1 ? '#e8d5ad' : s.sl === 3 ? '#d6d6d6' : '#ffffff', slab = s.sl === 3;
  const extra = off => {
    if (z < 10) return;
    if (s.g2) { g.strokeStyle = '#c8962e'; g.lineWidth = Math.max(1, 0.025 * z); g.setLineDash([]); pathSeg(g, s, off + 0.035); g.stroke(); }
    if (s.ct === 6 && s.el) { g.strokeStyle = '#e8b400'; g.lineWidth = Math.max(1, 0.03 * z); g.setLineDash([]); pathSeg(g, s, off - 0.06); g.stroke(); }
  };
  g.lineCap = 'butt';
  if (z >= 10 && s.dbl) {
    for (const off of s.q ? [0.27, 0.09, -0.09, -0.27] : [0.09, -0.09]) {
      g.strokeStyle = col || '#4a4a4a'; g.lineWidth = Math.max(1.5, 0.12 * z * gk); g.setLineDash([]); pathSeg(g, s, off); g.stroke();
      g.strokeStyle = tie; g.lineWidth = Math.max(1, 0.07 * z * gk); g.setLineDash(slab ? [] : [z * 0.5, z * 0.5]); pathSeg(g, s, off); g.stroke();
      extra(off);
    }
  } else {
    if (mine) { g.strokeStyle = 'rgba(40,110,220,.5)'; g.lineWidth = w + 4; g.setLineDash([]); pathSeg(g, s); g.stroke(); }
    if (col) { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = w + 2; g.setLineDash([]); pathSeg(g, s); g.stroke(); }   // 色の線は、ふちを少し濃く
    g.strokeStyle = col || '#3f3f3f'; g.lineWidth = w * gk; g.setLineDash([]); pathSeg(g, s); g.stroke();
    if (z >= 1.5) { g.strokeStyle = tie; g.lineWidth = Math.max(1, w * gk - 2); g.setLineDash(slab && z >= 4 ? [] : [Math.max(4, z * 0.5), Math.max(4, z * 0.5)]); pathSeg(g, s); g.stroke(); }
    extra(0);
  }
  if (z >= 10 && !s.el) { /* 非電化：そのまま */ }
  g.setLineDash([]); g.lineCap = 'round';
  if (mine && z >= 10 && s.dbl) { g.strokeStyle = 'rgba(40,110,220,.35)'; g.lineWidth = (s.q ? 0.86 : 0.5) * z + 4; pathSeg(g, s); g.stroke(); }
  // 雪よけ（t108）：スノーシェッドは線路の上の屋根（灰色の帯と、はりの線）・防雪柵は両わきの茶色の点線
  if (s.sp && z >= 1.5) {
    g.lineCap = 'butt';
    if (s.sp === 2) {
      const rw = Math.max(w + 5, (s.q ? 0.9 : s.dbl ? 0.55 : 0.42) * z);
      g.strokeStyle = 'rgba(96,104,118,.62)'; g.lineWidth = rw; g.setLineDash([]); pathSeg(g, s); g.stroke();
      if (z >= 4) { g.strokeStyle = 'rgba(235,238,242,.75)'; g.lineWidth = rw; g.setLineDash([Math.max(1, 0.06 * z), Math.max(5, 0.4 * z)]); pathSeg(g, s); g.stroke(); }
    } else {
      const off = Math.max(0.3, 5 / z);
      g.strokeStyle = '#8a5a2b'; g.lineWidth = Math.max(1.2, 0.08 * z); g.setLineDash([Math.max(3, 0.3 * z), Math.max(2, 0.2 * z)]);
      for (const o of [off, -off]) { pathSeg(g, s, o); g.stroke(); }
    }
    g.setLineDash([]); g.lineCap = 'round';
  }
  // 防音壁（DB の更新99）：線路の両わきに灰色の線（高い防音壁は太く・濃く）
  if (s.nw && z >= 1.5) {
    const off = Math.max((s.q ? 0.46 : s.dbl ? 0.3 : 0.2) + 0.06, (w / 2 + 3) / z);
    g.lineCap = 'butt'; g.setLineDash([]);
    g.strokeStyle = s.nw === 2 ? '#6d8399' : '#93a6ba'; g.lineWidth = Math.max(1.4, (s.nw === 2 ? 0.11 : 0.07) * z);
    for (const o of [off, -off]) { pathSeg(g, s, o); g.stroke(); }
    g.lineCap = 'round';
  }
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
  const up = label(g, s.n, x, y - Wd / 2 - 10, o); if (!up) label(g, s.n, x, y + Wd / 2 + 10, o);
  if (s.zl && z >= 3) label(g, s.zl === 'U' ? '地下' : '高架', x, y + (up ? Wd / 2 + 9 : -Wd / 2 - 27), { size: 10, bold: true, color: s.zl === 'U' ? '#3d4f66' : '#7a4a1f', bg: 'rgba(255,255,255,.88)' });   // 地下駅・高架駅（t108）
  // 積雪（t108。3時間ごと）：20cm より多くて融雪器がないと赤
  if (s.sn && z >= 2.5) label(g, `⛄${s.sn}cm`, x, y + Wd / 2 + (up ? 9 : 27), { size: 10, bold: true, color: s.sn >= 20 && !s.ml ? '#b3261e' : '#0b4f8a', bg: 'rgba(240,248,255,.92)' });
}
// 駅のはば（px）：ホームの形を決めた駅は ホームと番線の数から（DB の更新107）
const staPg = (s, z) => s.k === 'rail' && s.pf && z >= 6 ? pfGaps(s.pf, Math.max(1, s.tr)) : null;
function staUt(pg, n) { let u = n; if (pg) for (let k = 0; k <= n; k++) if (pg[k] === 'P') u += k > 0 && k < n ? 1 : 0.7; return u; }
function staWd(s, z) { const n = Math.max(1, s.tr), pg = staPg(s, z); return pg ? Math.max(5, (0.13 * staUt(pg, n) + 0.18) * z) : Math.max(5, (0.22 * n + 0.18) * z); }
function drawStation(g, s, z) {
  const x = sx(s.fx), y = sy(s.fy);
  if (x < -80 || y < -40 || x > S.W + 80 || y > S.H + 40) return;
  const L = Math.max(10, s.pl / 50 * z), n = Math.max(1, s.tr), pg = staPg(s, z), Ut = staUt(pg, n), Wd = staWd(s, z);
  // ホームの形（DB の更新107）：上（駅の向きの左）から ホーム・番線のならび。ホームは白・番線は灰色
  const lane = [];   // 番線ごとの［上のはし, はば］
  g.save(); g.translate(x, y); g.rotate(s.a);
  if (s.zl === 'E') { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(-L / 2 - 3, -Wd / 2 - 3, L + 6, Wd + 6); }   // 高架駅のかげ（t108）
  if (s.zl === 'U') { g.globalAlpha = 0.6; g.setLineDash([5, 3]); }   // 地下駅：うすく・点線
  g.fillStyle = '#ffffff'; g.strokeStyle = s.mine ? '#1f5fbf' : '#333'; g.lineWidth = 1.6;
  g.fillRect(-L / 2, -Wd / 2, L, Wd);
  if (pg) {
    const u = Wd / Ut; let yy = -Wd / 2;
    for (let k = 0; k <= n; k++) {
      if (pg[k] === 'P') yy += u * (k > 0 && k < n ? 1 : 0.7);
      if (k < n) { lane.push([yy, u]); g.fillStyle = '#c9ccd0'; g.fillRect(-L / 2, yy, L, u); if (z >= 12) { g.fillStyle = '#9aa0a6'; g.fillRect(-L / 2, yy + u * 0.32, L, Math.max(1, u * 0.08)); g.fillRect(-L / 2, yy + u * 0.6, L, Math.max(1, u * 0.08)); } yy += u; }
    }
  } else {
    for (let k = 0; k < n; k++) lane.push([-Wd / 2 + Wd * k / n, Wd / n]);
    if (s.tk && n > 1) { g.fillStyle = '#c9ccd0'; s.tk.forEach((t, k) => { if (t && t.m === 'pass') g.fillRect(-L / 2, -Wd / 2 + Wd * k / n, L, Wd / n); }); }   // 通過線（ホームなし。t62）
  }
  g.strokeRect(-L / 2, -Wd / 2, L, Wd);
  if (!pg && z >= 12) { g.strokeStyle = '#999'; g.lineWidth = 1; for (let k = 1; k < n; k++) { const yy = -Wd / 2 + Wd * k / n; g.beginPath(); g.moveTo(-L / 2, yy); g.lineTo(L / 2, yy); g.stroke(); } }
  g.setLineDash([]); g.globalAlpha = 1;
  g.restore();
  // 番線の番号（ホームの中。近づいたとき）：1番線は駅の向きの左がわ（上）から順に
  const lh = Math.min(...lane.map(q => q[1]));
  if (z >= 16 && lh >= 6.5) {
    const ca = Math.cos(s.a), sa = Math.sin(s.a), fs = Math.round(Math.min(13, Math.max(8, lh * 0.75)));
    g.font = `bold ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = s.mine ? '#1f5fbf' : '#444';
    lane.forEach((q, k) => {
      const ly = q[0] + q[1] / 2;
      for (const lx of (L > 70 ? [-L / 2 + fs * 0.9, L / 2 - fs * 0.9] : [0])) g.fillText(String(k + 1), x + lx * ca - ly * sa, y + lx * sa + ly * ca + 0.5);
    });
  }
}
// 車庫の大きさ：[長さ, はば, 線からのあき, 留置線の数]（マス）。'T400x6' は線路をなぞったもの（400m・6本）
function depDim(k, sz) {
  const m = /^[TR](\d+)x(\d+)$/.exec(sz || '');   // R：留置線（DB の更新105）
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
  const tome = /^R/.test(d.sz || '');   // 留置線（DB の更新105）：砂利の色で、線路だけ
  g.fillStyle = tome ? 'rgba(190,182,168,.7)' : d.k === 'rail' ? 'rgba(170,160,150,.85)' : 'rgba(150,170,190,.85)'; g.fill();
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
// subPts と同じ点に、線の上の s（マス）をつけて：[[x, y, s], …]（3D の列車の高さ。t64）
function subPtsS(s, s0, s1) {
  const P = s.P, out = []; let acc = 0;
  for (let i = 0; i + 1 < s.np; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], d = Math.hypot(bx - ax, by - ay);
    if (acc + d >= s0 && acc <= s1) {
      const t0 = clamp((s0 - acc) / (d || 1), 0, 1), t1 = clamp((s1 - acc) / (d || 1), 0, 1);
      if (!out.length) out.push([ax + (bx - ax) * t0, ay + (by - ay) * t0, acc + d * t0]);
      out.push([ax + (bx - ax) * t1, ay + (by - ay) * t1, acc + d * t1]);
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
  if (!o.force) for (const b of LBL) if (x0 < b[2] && x0 + w + 6 > b[0] && y0 < b[3] && y0 + h > b[1]) return false;   // force：重なっても出す
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
/* ---------- 山・湖・峠・岬（t108）：地形から見つけて名前をつけたもの（map/nature.json。だれが見ても同じ） ----------
   [id, 名前, x, y, 標高 m か 面積 km², 大きさ（1 だいじ〜4）, 都道府県, 市区町村, …] */
const NAT = { d: null, p: null };
function natLoad() {
  if (!NAT.p) NAT.p = fetch('map/nature.json?v=3', { cache: 'force-cache' }).then(r => r.json()).then(d => { NAT.d = d; S.dirty = true; return d; }).catch(e => { NAT.p = null; console.warn('nature', e); return null; });
  return NAT.p;
}
// 出す近さ：[山・湖・峠・岬][大きさ]
const NAT_Z = { peak: [0, 0.12, 0.4, 1.5, 3], lake: [0, 0.12, 0.12, 1.5, 3], pass: [0, 0.8, 0.8, 1.5, 3], cape: [0, 0.4, 0.4, 1.2, 3] };
function drawNature(g, z, v) {
  const d = NAT.d; if (!d) { natLoad(); return; }
  const fmtE = e => Number(e).toLocaleString('ja-JP');
  for (const k of ['lake', 'peak', 'cape', 'pass']) for (const r of d[k] || []) {
    if (z < NAT_Z[k][r[5]] || r[2] < v.x0 - 2 || r[2] > v.x1 + 2 || r[3] < v.y0 - 2 || r[3] > v.y1 + 2) continue;
    const x = sx(r[2] + 0.5), y = sy(r[3] + 0.5);
    if (k === 'peak') {   // ▲ と 名前・標高
      if (!label(g, `${r[1]} ${fmtE(r[4])}`, x + 5, y - 9, { size: r[5] <= 1 ? 12 : 11, bold: r[5] <= 2, color: '#6b4423', left: true })) continue;
      g.fillStyle = '#6b4423'; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x - 5, y + 4); g.lineTo(x + 5, y + 4); g.closePath(); g.stroke(); g.fill();
    } else if (k === 'lake') label(g, r[1], x, y, { size: r[5] <= 2 ? 13 : 11, bold: r[5] <= 2, color: '#1a56a8' });
    else if (k === 'pass') { if (label(g, `${r[1]} ${fmtE(r[4])}`, x + 7, y, { size: 11, color: '#5b3a6b', left: true })) { g.fillStyle = '#5b3a6b'; g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(')(', x, y); } }
    else label(g, r[1], x, y, { size: 11, bold: r[5] <= 2, color: '#24507a' });
  }
}
// さがす：名前に q をふくむもの（「〇〇県〇〇山」のように前に地名を書いても）
const NAT_FK = { peak: 2.5, lake: 3, pass: 4, cape: 2.5, river: 1.5 };
async function natFind(q) {
  const d = await natLoad(); if (!d) return [];
  q = q.replace(/\s+/g, ''); if (!q) return [];
  const out = [];
  for (const k of ['peak', 'lake', 'pass', 'cape', 'river']) for (const r of d[k] || []) {
    const nm = r[1]; if (!nm) continue;
    const hit = nm === q ? 0 : nm.startsWith(q) ? 1 : nm.includes(q) ? 2 : q.endsWith(nm) && q.length > nm.length && (q.includes(r[6] || '\0') || q.includes(r[7] || '\0')) ? 0 : -1;
    if (hit < 0) continue;
    const z = k === 'lake' ? (r[5] <= 2 ? 0.6 : 3) : NAT_FK[k];
    const sub = k === 'peak' || k === 'pass' ? `${r[6]} ${r[7]}・標高 ${Number(r[4]).toLocaleString('ja-JP')}m` : k === 'lake' ? `${r[6]} ${r[7]}・${r[4] >= 10 ? Math.round(r[4]).toLocaleString('ja-JP') : Number(r[4]).toFixed(1)}km²` : k === 'river' ? (r[8] || r[6]) : `${r[6]} ${r[7]}`;
    out.push({ k, n: nm, s: sub, x: r[2] + 0.5, y: r[3] + 0.5, z, hit, h: k === 'peak' ? r[4] : 0 });
  }
  return out.sort((a, b) => a.hit - b.hit || b.h - a.h).slice(0, 12);
}
// 地名のローマ字（設定 → 地名のローマ字。おまかせ：日本語のときは出さない）（DB の更新114）：都道府県・市区町村・区の id → Tsukimi-shi
function roOn() { let v = null; try { v = localStorage.getItem('ro'); } catch (e) { v = null; } return v === 'on' || (v !== 'off' && typeof LANG !== 'undefined' && LANG !== 'ja'); }
function roLoad(force) {
  if (!roOn() || (S.roP && !force)) return;
  S.roP = call('mp_place_ro', {}).then(d => { S.ro = d || {}; S.dirty = true; })
    .catch(e => { S.ro = S.ro || {}; if (!/Could not find the function|schema cache|does not exist/.test(e.message || '')) setTimeout(() => { S.roP = null; }, 60000); });
}
const placeRo = id => S.ro && roOn() ? S.ro[id] || '' : '';
const zipFmt = z => /^\d{7}$/.test(z || '') ? z.slice(0, 3) + '-' + z.slice(3) : z || '';
// 名前（漢字）と、その下に小さくローマ字
function labelRo(g, p, text, x, y, o) {
  const ro = placeRo(p.id); if (!ro) return label(g, text, x, y, o);
  const sz = o.size || 12, s2 = Math.max(9, Math.round(sz * 0.72)), ky = y - (s2 + 4) / 2, ok = label(g, text, x, ky, o);
  if (ok) label(g, ro, x, ky + (sz + 4) / 2 + (s2 + 4) / 2 + 0.5, { size: s2, color: o.color });   // 名前の箱の すぐ下（重ならない）
  return ok;
}
function drawPlaces(g, it, z) {
  roLoad();
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
    if (p.k === 'pref') labelRo(g, p, p.n + (p.t || '県'), x, y, { size: z < Z_FAR ? 14 : 18, bold: true, color: '#3a3a3a' });   // 瑠璃府は「府」。とても遠いときは小さく（t108）
    else if (p.k === 'muni') labelRo(g, p, p.n + (p.t || ''), x, y, { size: p.pop > 500000 ? 16 : 13, bold: true, color: '#2b2b2b' });
    else if (p.k === 'ward') labelRo(g, p, p.n + '区', x, y, { size: 13, bold: true, color: '#5a4a6a' });
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
  const opts = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
  let m = opts[0]; for (const o of opts) if (o / 50 * z <= 120) m = o;
  const w = m / 50 * z, x = 12, y = S.H - 14;
  g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(x - 4, y - 16, w + 8, 20);
  g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y - 6); g.stroke();
  g.fillStyle = '#222'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(m >= 1000 ? m / 1000 + 'km' : m + 'm', x + 4, y - 4);
}
function frame() {
  if (!S.open) return;
  if (MQ.fps < 60) { const t = now(); if (t - (S.lastF || 0) < 1000 / MQ.fps - 4) { requestAnimationFrame(frame); return; } S.lastF = t; }   // 省エネ（t63）
  glideStep();   // 惰性（t61）
  runFollowStep();   // 追跡（t62）
  wxStep();   // 天気（t62）
  jamStep();   // 渋滞（DB の更新67）
  erStep();    // 救急（DB の更新68）
  if (S.v3) {   // 3D（map3d.js）
    // 視点が止まっていても、列車・踏切・水面などは 毎フレーム うごかす（t66：前は 0.12秒ごとで ガクガクした）。
    //   地形・建物の読みこみ（m3Frame まるごと）は 1秒ごと。うごくものが見えないときは 0.5秒ごと
    const t = now();
    if (t - (S.v3.full || 0) > 1000) S.v3.dirty = true;
    if (S.dirty || S.v3.dirty) { S.dirty = false; S.v3.dirty = false; S.v3.full = t; try { m3Frame(); } catch (e) { console.error(e); } RUN.drawn = t; }
    else if (window.m3RunFrame && t - RUN.drawn >= (window.m3Moving && window.m3Moving() ? 0 : 500)) { try { window.m3RunFrame(); } catch (e) { console.error(e); } RUN.drawn = t; }
    requestAnimationFrame(frame); return;
  }
  if (S.dirty) {
    S.dirty = false; LBL = [];
    try { render(); } catch (e) { console.error(e); }
    needChunks(); needCells(); needCho(); trimChunks();
    if (S.cam.z < 7 && S.cam.z >= q('zl', MQ.d2)) liteNeed(view(), 40);   // 遠くの建物（t63）
    drawRunLayer();
  } else if (S.layer.run && now() - RUN.drawn > (MQ.fps < 60 ? 180 : 90)) drawRunLayer();
  requestAnimationFrame(frame);
}
// 惰性（t61）：指をはなしたあと、少しすべる。S.glide = {vx, vy（マス/ms）, t}
function glideStep() {
  const g = S.glide; if (!g) return;
  const t = now(), dt = Math.min(48, t - g.t); g.t = t;
  if (S.v3) { S.glide = null; return; }
  setCam(S.cam.x + g.vx * dt, S.cam.y + g.vy * dt, S.cam.z);
  const k = Math.exp(-dt / 325); g.vx *= k; g.vy *= k;
  if (Math.hypot(g.vx, g.vy) * S.cam.z < 0.015) S.glide = null;
}

/* ---------- 走行位置（t61・t62）：列車・バス・船・飛行機が、ダイヤ（時刻）のとおりに動く。近いと車両の形、遠いと点。
   上りと下りは、進む向きの左にずらして描く（日本は左側通行。重ならないように）。タップで列車の情報・追跡。しぼりこみ・さがす ---------- */
const RUN = { routes: new Map(), busy: 0, need: 0, drawn: 0, hits: [], sel: null, selT: 0, follow: null, ft: 0, keep: new Set(),
              f: { k: ['rail', 'bus', 'ship', 'air'], dir: 0, kind: '', rid: 0 } };   // f：しぼりこみ（種類・向き 1 下り/-1 上り・種別・系統）
try { const v = JSON.parse(localStorage.getItem('mp_runf') || 'null'); if (v && Array.isArray(v.k)) Object.assign(RUN.f, v); } catch (e) {}
const RUN_K = { rail: '列車', bus: 'バス', ship: '船', air: '飛行機' }, RUN_IC = { rail: '🚃', bus: '🚌', ship: '⛴', air: '✈' };
function runFiltered() { const f = RUN.f; return f.k.length < 4 || !!f.dir || !!f.kind || !!f.rid; }
function runPass(R, tn) {
  const f = RUN.f;
  if (!f.k.includes(R.k) || (f.rid && R.id !== f.rid)) return false;
  return !tn || ((!f.dir || tn.dir === f.dir) && (!f.kind || tn.kind === f.kind));
}
function runSetF(f) { RUN.f = f; try { localStorage.setItem('mp_runf', JSON.stringify(f)); } catch (e) {} runBar(); S.dirty = true; if (S.v3) S.v3.dirty = true; }
function runReset() { if (!S.layer.run) { RUN.routes.clear(); RUN.follow = null; RUN.sel = null; clearRunLayer(); } RUN.need = 0; runBar(); }
function clearRunLayer() { if (S.ctxr) { S.ctxr.setTransform(1, 0, 0, 1, 0, 0); S.ctxr.clearRect(0, 0, S.cvr.width, S.cvr.height); } }
// いまの時刻（日本時間）：その日の 0 時からの秒・今日と きのうの日付
function jstNow() {
  const a = Date.now() / 1000, t = a + 9 * 3600, d = Math.floor(t / 86400), ds = n => new Date(n * 86400000).toISOString().slice(0, 10);
  return { sec: t - d * 86400, date: ds(d), prev: ds(d - 1), next: ds(d + 1), abs: a, day0: d * 86400 - 9 * 3600 };   // abs・day0：1970年からの秒（運行の乱れ）
}
// 1つの系統のダイヤを読む（10分ごとに読みなおす）。true 読みはじめた・false もうある・null いそがしい（3つまで）
function runLoad(id) {
  const R = RUN.routes.get(id);
  if (R && (R.loading || now() - R.at < 600000)) return false;
  if (RUN.busy >= 3) return null;
  if (R) R.loading = true; else RUN.routes.set(id, { id, loading: true, at: 0, tr: [], st: [], legs: [] });
  RUN.busy++;
  call('mp_dia', { p_route: id }).then(D => { if (D) RUN.routes.set(id, prepRun(D)); })
    .catch(() => { const r = RUN.routes.get(id); if (r) { r.loading = false; r.at = now(); } })
    .finally(() => { RUN.busy--; RUN.need = 0; S.dirty = true; if (S.v3) S.v3.dirty = true; });
  return true;
}
// 見えている駅・バス停・港・空港を通る系統のダイヤを読む
function runNeed(it) {
  if (now() - RUN.need < 1500) return; RUN.need = now();
  unkoLoad();   // 運行の乱れ（1分ごと）
  const ids = new Set();
  for (const st of it.stas.values()) for (const r of (st.rt || [])) ids.add(r.id);
  for (const l of it.lanes.values()) ids.add(l.id);
  if (RUN.follow) ids.add(RUN.follow.rid);
  for (const id of ids) if (runLoad(id) === null) break;
  if (RUN.routes.size > 160) {   // 多くなったら、いま見えていない系統からすてる（追跡中・さがした系統はのこす）
    for (const [id, R] of RUN.routes) { if (RUN.routes.size <= 120) break; if (!ids.has(id) && !RUN.keep.has(id) && !R.loading) RUN.routes.delete(id); }
  }
}
function prepRun(D) {
  const R = { id: D.id, k: D.kind, c: D.color || '#d23', n: D.name || '', own: D.owner || '', mine: !!D.mine, at: now(), loading: false, legs: D.legs || [], lp: [], hop: new Map(), tr: [],
              st: (D.stops || []).map(x => ({ id: x.id, x: x.x / 100, y: x.y / 100, n: x.name || '' })) };
  R.sn = new Map(R.st.map(s => [s.id, s.n]));
  for (const t of D.trains || []) {
    const sc = t.sched; if (t.bad || !Array.isArray(sc) || sc.length < 2) continue;
    const t0 = sc[0][2], t1 = sc[sc.length - 1][1]; if (t0 == null || t1 == null) continue;
    R.tr.push({ id: t.id, dir: t.dir, num: t.num, kind: t.kind, day: t.day, fn: Math.max(1, t.fn || 1), s: sc, t0, t1, idx: null,
                fname: t.fname || '', fser: t.fser || '', onum: t.onum || '', form: t.form == null ? null : t.form, fm: Array.isArray(t.fm) ? t.fm : null,   // fm：モデルのある系列の編成の形式（下り方から。DB の更新107）
                lay: Array.isArray(t.lay) ? t.lay : null, lz: Array.isArray(t.lay) && t.lay[6] != null ? t.lay[6] : null,   // 折り返しを待つ（DB の更新105）
                wk: Array.isArray(t.wk) ? t.wk : null, wkk: t.wkk || '',   // wk：編成の工事中［はじめ（null は前から）, おわり］（1970年からの秒。DB の更新60）
                sub: Array.isArray(t.sub) ? t.sub : null,   // sub：予備編成の代走［運行日, 発車（1970年からの秒）, 予備編成］（DB の更新80）
                ordd: Array.isArray(t.ordd) && t.ordd.length ? new Map(t.ordd.map(c => [c[0], c[1]])) : null });   // 運転整理（DB の更新100）：その日は走らない（v 運転整理の列車が かわりに走る・x 運休）
  }
  return R;
}
// 列車のとまる駅が、系統の駅の何番目か（行きは前から、帰りはうしろから。同じ駅が2回出る環状線も）
function runIdx(R, tn) {
  const ids = R.st.map(x => x.id), out = []; let p = tn.dir === -1 ? ids.length - 1 : 0;
  for (const e of tn.s) {
    let q = -1;
    if (tn.dir === -1) { for (let k = p; k >= 0; k--) if (ids[k] === e[0]) { q = k; break; } }
    else { for (let k = p; k < ids.length; k++) if (ids[k] === e[0]) { q = k; break; } }
    if (q < 0) q = ids.indexOf(e[0]);
    out.push(q); if (q >= 0) p = q;
  }
  return out;
}
// 駅 i → i+1 の線（行きの向き）。線路・道路が読めていないときは、駅と駅をまっすぐ（あとで読みなおす）
function runLeg(R, i, it) {
  const c = R.lp[i]; if (c && (c.exact || now() - c.at < 3000)) return c;
  const L = R.legs[i], A = R.st[i], B = R.st[i + 1]; if (!L || !A || !B) return null;
  let pts = null, refs = null, exact = true;
  if (L.w && L.w.length >= 4) { pts = []; for (let k = 0; k + 1 < L.w.length; k += 2) pts.push([L.w[k] / 100, L.w[k + 1] / 100]); }
  else if (L.g && L.g.length) {
    // refs（t64・3D の高さ）：点 k → k+1 が、どの線の s から s まで か［線の id, s, s］。線と線のすきまは null
    pts = []; refs = []; let pend = null;
    for (const [sid, s0, s1] of L.g) {
      const sg = it.segs.get(sid); if (!sg) { pts = null; break; }
      let q = subPtsS(sg, Math.min(s0, s1), Math.max(s0, s1)); if (s0 > s1) q = q.reverse();
      for (const v of q) {
        const l = pts[pts.length - 1];
        if (!l || Math.hypot(v[0] - l[0], v[1] - l[1]) > 1e-4) { if (l) refs.push(pend && pend[0] === sid ? [sid, pend[1], v[2]] : null); pts.push([v[0], v[1]]); }
        pend = [sid, v[2]];
      }
    }
    if (pts && pts.length < 2) pts = null;
  }
  if (!pts) { pts = [[A.x, A.y], [B.x, B.y]]; exact = false; }
  if (!refs || refs.length !== pts.length - 1) refs = null;
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return (R.lp[i] = { pts, cum, len: cum[cum.length - 1], exact, at: now(), refs });
}
// 駅 a → b（系統の何番目か）の線。帰りは逆向き
function runHop(R, a, b, it) {
  if (a < 0 || b < 0) return null;
  const key = a + '>' + b, c = R.hop.get(key);
  if (c && c.exact) return c;
  const lo = Math.min(a, b), hi = Math.max(a, b), parts = [], prf = [];
  let exact = true;
  for (let i = lo; i < hi; i++) { const L = runLeg(R, i, it); if (!L) return null; if (!L.exact) exact = false; parts.push(L.pts); prf.push(L.refs || null); }
  if (a > b) {
    parts.reverse(); prf.reverse();
    for (let i = 0; i < parts.length; i++) { parts[i] = parts[i].slice().reverse(); if (prf[i]) prf[i] = prf[i].slice().reverse().map(r => r && [r[0], r[2], r[1]]); }
  }
  const pts = [], refs = [];
  for (let j = 0; j < parts.length; j++) {
    const q = parts[j], rf = prf[j];
    for (let k = 0; k < q.length; k++) {
      const v = q[k], l = pts[pts.length - 1];
      if (!l || Math.hypot(v[0] - l[0], v[1] - l[1]) > 1e-4) { if (l) refs.push(k > 0 && rf ? rf[k - 1] : null); pts.push(v); }
    }
  }
  if (pts.length < 2) return null;
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const h = { pts, cum, len: cum[cum.length - 1], exact, refs: refs.length === pts.length - 1 ? refs : null };
  R.hop.set(key, h); return h;
}
/* ---------- 列車は ホームの まん中に（t66）：止まっているときは 列車のまん中が 駅の点（ホームのまん中）。走るときも 頭は 駅の点より 列車の長さの半分 先 ---------- */
// 線 H の d0〜d1 の部分 { pts, refs }（はしの点は おぎなう。refs は 3D の高さ）
function runCut(H, d0, d1) {
  d0 = clamp(d0, 0, H.len); d1 = clamp(d1, d0, H.len);
  const c = H.cum, P = H.pts, F = H.refs, pts = [], refs = [];
  const seg = d => { let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; } return lo; };
  const tt = (k, d) => clamp((d - c[k]) / ((c[k + 1] - c[k]) || 1), 0, 1);
  const ip = (k, t) => { const a = P[k], b = P[k + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  const rs = (k, t0, t1) => { const r = F && F[k]; return r ? [r[0], r[1] + (r[2] - r[1]) * t0, r[1] + (r[2] - r[1]) * t1] : null; };
  const k0 = seg(d0), k1 = seg(d1), t0 = tt(k0, d0), t1 = tt(k1, d1);
  pts.push(ip(k0, t0));
  if (k0 === k1) { pts.push(ip(k1, t1)); refs.push(rs(k0, t0, t1)); }
  else {
    pts.push(P[k0 + 1]); refs.push(rs(k0, t0, 1));
    for (let k = k0 + 1; k < k1; k++) { pts.push(P[k + 1]); refs.push(rs(k, 0, 1)); }
    pts.push(ip(k1, t1)); refs.push(rs(k1, 0, t1));
  }
  return { pts, refs };
}
// いくつかの線をつなぐ（つなぎ目の同じ点は1つに）。mark：その番目の線の はじめの点の位置を H.o に
function runJoin(parts, mark) {
  const pts = [], refs = []; let mi = 0;
  parts.forEach((q, j) => {
    if (j === mark) mi = Math.max(0, pts.length - 1);
    for (let k = 0; k < q.pts.length; k++) {
      const v = q.pts[k], l = pts[pts.length - 1];
      if (!l || Math.hypot(v[0] - l[0], v[1] - l[1]) > 1e-4) { if (l) refs.push(k > 0 && q.refs ? q.refs[k - 1] || null : null); pts.push([v[0], v[1]]); }
    }
  });
  if (pts.length < 2) return null;
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { pts, cum, len: cum[cum.length - 1], refs, o: cum[Math.min(mi, cum.length - 1)] };
}
// 線 part の うしろ（end）か 前に、長さ L だけ のばす：はしの線（DB の線）が わかれば その線にそって、なければ まっすぐ
function runExt(part, L, end, it) {
  const p = part.pts, n = p.length, r = part.refs ? part.refs[end ? n - 2 : 0] : null, sg = r && r[2] !== r[1] && it && it.segs ? it.segs.get(r[0]) : null;
  const out = { pts: [], refs: [] }; let got = 0;
  if (sg) {
    const dir = Math.sign(r[2] - r[1]), s0 = end ? r[2] : r[1], s1 = end ? s0 + dir * L : s0 - dir * L;
    let q = subPtsS(sg, Math.max(0, Math.min(s0, s1)), Math.max(s0, s1));
    if ((s1 > s0) !== end) q = q.reverse();   // end：s0 → s1 の順。前：s1 → s0 の順（つなぎ目が うしろ）
    if (q.length >= 2) {
      for (let k = 0; k < q.length; k++) { out.pts.push([q[k][0], q[k][1]]); if (k) out.refs.push([sg.id, q[k - 1][2], q[k][2]]); }
      got = Math.abs(q[q.length - 1][2] - q[0][2]);
    }
  }
  if (got < L - 1e-3) {   // 線のはしの先：まっすぐ（高さは 線のはしの高さのまま）
    const R2 = L - got;
    if (end) {
      const b = out.pts.length ? out.pts[out.pts.length - 1] : p[n - 1], a = out.pts.length >= 2 ? out.pts[out.pts.length - 2] : p[n - 2];
      const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, rl = out.refs.length ? out.refs[out.refs.length - 1] : r;
      if (!out.pts.length) out.pts.push(b);
      out.pts.push([b[0] + (b[0] - a[0]) / dl * R2, b[1] + (b[1] - a[1]) / dl * R2]); out.refs.push(rl ? [rl[0], rl[2], rl[2]] : null);
    } else {
      const a = out.pts.length ? out.pts[0] : p[0], b = out.pts.length >= 2 ? out.pts[1] : p[1];
      const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, rf = out.refs.length ? out.refs[0] : r;
      if (!out.pts.length) out.pts.push(a);
      out.pts.unshift([a[0] - (b[0] - a[0]) / dl * R2, a[1] - (b[1] - a[1]) / dl * R2]); out.refs.unshift(rf ? [rf[0], rf[1], rf[1]] : null);
    }
  }
  return out;
}
// 列車（鉄道）の線：とまる駅 i から j（i か i+1）まで ＋ 前後に 列車の長さの半分と すこし（となりの駅への線。なければ その先へ のばす）。
//   { H, o（駅 i の点の位置）, L（i → j の長さ）, h（列車の長さの半分） } か null（いままでの やりかたに）
function runSpan(R, tn, i, j, it) {
  const ix = tn.idx, n = R.st.length, sd = tn.dir === -1 ? -1 : 1, h = runCarL(R.k) * tn.fn / 2, P = Math.ceil(h + 0.3);
  if (ix[i] < 0 || ix[j] < 0) return null;
  let a = i > 0 ? ix[i - 1] : ix[i] - sd, c = j + 1 < ix.length ? ix[j + 1] : ix[j] + sd;
  if (a < 0 || a >= n || a === ix[i]) a = -1;
  if (c < 0 || c >= n || c === ix[j]) c = -1;
  const key = 'S' + a + '>' + ix[i] + '>' + ix[j] + '>' + c + ':' + P, z = R.hop.get(key);
  if (z && z.exact) return { H: z, o: z.o, L: z.L, h };
  const M = j > i ? runHop(R, ix[i], ix[j], it) : null; if (j > i && !M) return null;
  const A = a >= 0 ? runHop(R, a, ix[i], it) : null, B = c >= 0 ? runHop(R, ix[j], c, it) : null;
  const pre = A ? runCut(A, A.len - P, A.len) : null, mid = M ? { pts: M.pts, refs: M.refs } : null, post = B ? runCut(B, 0, P) : null;
  const first = pre || mid || post, last = post || mid || pre; if (!first) return null;
  const preL = pre ? Math.min(P, A.len) : 0, postL = post ? Math.min(P, B.len) : 0, parts = [];
  if (preL < P - 1e-3) parts.push(runExt(first, P - preL, false, it));
  if (pre) parts.push(pre);
  const mark = parts.length;
  if (mid) parts.push(mid);
  if (post) parts.push(post);
  if (postL < P - 1e-3) parts.push(runExt(last, P - postL, true, it));
  const J = runJoin(parts, mark); if (!J) return null;
  J.L = M ? M.len : 0; J.exact = (!A || A.exact) && (!M || M.exact) && (!B || B.exact);
  R.hop.set(key, J);
  return { H: J, o: J.o, L: J.L, h };
}
// 線の上の d（はじめからのマス）の点と向き
function runPt(H, d) {
  d = clamp(d, 0, H.len); const c = H.cum; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const a = H.pts[lo], b = H.pts[hi] || a, L = (c[hi] - c[lo]) || 1, t = (d - c[lo]) / L;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
}
// 線の上の d のところが、DB の線の どこか：[線の id, s（マス）] か null（線の形がわからないところ）。3D の高さ（t64）
function runRef(H, d) {
  if (!H || !H.refs) return null;
  d = clamp(d, 0, H.len); const c = H.cum; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const r = H.refs[lo]; if (!r) return null;
  const t = clamp((d - c[lo]) / ((c[hi] - c[lo]) || 1), 0, 1);
  return [r[0], r[1] + (r[2] - r[1]) * t, r[2] < r[1] ? -1 : 1];   // 3つめ：線の s の向きに進むか（1）逆か（−1）
}
// 線の d0〜d1 の折れ線
function runSub(H, d0, d1) {
  d0 = clamp(d0, 0, H.len); d1 = clamp(d1, 0, H.len); const out = [runPt(H, d0)];
  for (let k = 1; k < H.pts.length - 1; k++) if (H.cum[k] > d0 && H.cum[k] < d1) out.push(H.pts[k]);
  out.push(runPt(H, d1)); return out;
}
// 進む向きの左に off（マス）ずらした折れ線
function runOff(pts, off) {
  if (!off) return pts;
  const n = pts.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    out[i] = [pts[i][0] + dy * off, pts[i][1] - dx * off];
  }
  return out;
}
// 列車 tn の、時刻 tm の位置：{H（走っている線）, d（頭の位置）, x, y, a, at（止まっている駅：sched の何番目）, nx（つぎに着く駅）, tt（その日の秒）} か null（走っていない）
function runPos(R, tn, tm, it) {
  let tt = null, dl = 0, rday = null, rd0 = 0;
  // 運行の乱れ（DB の更新51。鉄道・バス・船・飛行機）：始発駅を出てからの遅れ（dl 秒）の分、ダイヤより うしろの位置。見合わせ・間引きで運休（走らない）。
  //   DB の更新60 から、乱れの区間を通る列車だけ（W は その列車の窓。なければ null）。工事中の編成・持ち主が運休にした列車も走らない
  const W = tm.abs ? unkoTrW(R, tn) : null;
  for (const [day, off] of [[tm.date, 0], [tm.prev, 86400]]) {   // きょう・きのう（日をまたぐ列車。24時すぎ）
    if (tn.day && tn.day !== day) continue;
    const t1x = tn.lz != null && !tn.day ? Math.max(tn.t1, tn.lz) : tn.t1;   // 折り返しを待つ（DB の更新105）：ホームをあけるまで 終着駅に
    const t = tm.sec + off; if (t < tn.t0 || t > t1x + (W ? 43200 : 0)) continue;   // 遅れていても12時間まで
    const d0 = tm.day0 - off + tn.t0;
    if (runOffK(tn, day, d0)) continue;
    let dly = 0;
    let ori = null;
    if (W) { const c = unkoCanW(W, d0, tn.id, tn.t1 - tn.t0); if (c && c.k !== 'ori') continue; ori = c; dly = unkoDlyW(W, d0, tm.abs); }
    const tau = t - dly;
    if (ori && tau - tn.t0 >= ori.za && tau - tn.t0 < ori.zb) continue;   // 区間折り返し（DB の更新82）：見合わせの区間の手前で折り返した
    if (tau >= tn.t0 && tau <= t1x) { tt = tau; dl = dly; rday = day; rd0 = d0; break; }
  }
  if (tt == null) return null;
  if (!tn.idx) tn.idx = runIdx(R, tn);
  const sc = tn.s; let H = null, d = 0, at = -1, nx = -1;
  const ctr = R.k === 'rail';   // 鉄道：ホームの まん中に（t66。頭は 駅の点より 列車の長さの半分 先）
  for (let i = 0; i < sc.length; i++) {
    const ar = sc[i][1], dp = sc[i][2];
    if (ar != null && dp != null && tt >= ar && tt <= dp) {   // 駅にとまっている：来た線の終わり（頭が駅。鉄道は 列車のまん中が駅）
      at = i;
      const Q = ctr ? runSpan(R, tn, i, i, it) : null;
      if (Q) { H = Q.H; d = Q.o + Q.h; }
      else if (i > 0) { H = runHop(R, tn.idx[i - 1], tn.idx[i], it); if (H) d = H.len; }
      else if (i + 1 < sc.length) { H = runHop(R, tn.idx[0], tn.idx[1], it); if (H) d = Math.min(H.len, 0.4 * tn.fn); }
      break;
    }
    if (i + 1 < sc.length && dp != null && sc[i + 1][1] != null && tt >= dp && tt <= sc[i + 1][1]) {
      nx = i + 1;
      const f = (tt - dp) / Math.max(1, sc[i + 1][1] - dp), g = R.k === 'air' || R.k === 'ship' ? f : f * f * (3 - 2 * f);   // 電車・バスは、はじめとおわりがゆっくり
      const Q = ctr ? runSpan(R, tn, i, i + 1, it) : null;
      if (Q) { H = Q.H; d = Q.o + g * Q.L + Q.h; break; }
      H = runHop(R, tn.idx[i], tn.idx[i + 1], it); if (!H) break;
      d = g * H.len; break;
    }
    if (i + 1 === sc.length && ar != null && tt >= ar) {
      at = i;
      const Q = ctr ? runSpan(R, tn, i, i, it) : null;
      if (Q) { H = Q.H; d = Q.o + Q.h; }
      else if (i > 0) { H = runHop(R, tn.idx[i - 1], tn.idx[i], it); if (H) d = H.len; }
    }
  }
  if (!H) return null;
  const p = runPt(H, d);
  return { H, d, x: p[0], y: p[1], a: p[2], at, nx, tt, dl, day: rday, d0: rd0 };
}
const runCarL = k => k === 'rail' ? 0.4 : k === 'bus' ? 0.24 : k === 'ship' ? 2.4 : 0.9;   // 1両（1台）の長さ（マス）
// いま走っている車両（しぼりこみのとおり）：[{R, T, H, d（頭の位置）, x, y, a, len（長さ・マス）, car}]。v：見るはんい（マス）
function runList(it, v) {
  runNeed(it);
  const tm = jstNow(), out = [], pad = 3;
  for (const R of RUN.routes.values()) {
    if (!R.tr || !R.tr.length || !R.st.length || !runPass(R)) continue;
    const carL = runCarL(R.k);
    for (const tn of R.tr) {
      if (!runPass(R, tn)) continue;
      const p = runPos(R, tn, tm, it); if (!p) continue;
      if (p.x < v.x0 - pad || p.x > v.x1 + pad || p.y < v.y0 - pad || p.y > v.y1 + pad) continue;
      out.push({ R, T: tn, H: p.H, d: p.d, x: p.x, y: p.y, a: p.a, at: p.at, nx: p.nx, len: carL * (R.k === 'rail' ? tn.fn : 1), car: carL, dl: p.dl || 0 });
    }
    // 留置線で待つ編成（DB の更新105）：着いて3分〜出る3分前。留置線の その線の まん中に
    if (R.k === 'rail' && it.deps) for (const tn of R.tr) {
      const L = tn.lay; if (!L || L[3] !== 2 || tn.day || !runPass(R, tn)) continue;
      const tt = tm.sec; if (tt < L[1] + 180 || tt > L[2] - 180) continue;
      const dp = it.deps.get(L[4]); if (!dp) continue;
      const P = depPoly({ fx: dp.fx, fy: dp.fy, a: dp.a, side: dp.side, sz: dp.sz, k: 'rail' }), nn = depDim('rail', dp.sz)[3], f = (L[5] || 1) / (nn + 1);
      const a = [P[0][0] + (P[3][0] - P[0][0]) * f, P[0][1] + (P[3][1] - P[0][1]) * f], b = [P[1][0] + (P[2][0] - P[1][0]) * f, P[1][1] + (P[2][1] - P[1][1]) * f];
      const Ln = Math.hypot(b[0] - a[0], b[1] - a[1]); if (Ln < 1e-6) continue;
      const len = Math.min(Ln, carL * tn.fn), H = { pts: [a, b], cum: [0, Ln], len: Ln }, d = (Ln + len) / 2, q = runPt(H, d);
      if (q[0] < v.x0 - pad || q[0] > v.x1 + pad || q[1] < v.y0 - pad || q[1] > v.y1 + pad) continue;
      out.push({ R, T: tn, H, d, x: q[0], y: q[1], a: q[2], at: -1, nx: -1, len, car: carL, dl: 0, yard: true });
    }
  }
  return out;
}
const runIsSel = o => (!!RUN.sel && RUN.sel.rid === o.R.id && RUN.sel.tid === o.T.id) || (!!RUN.follow && RUN.follow.rid === o.R.id && RUN.follow.tid === o.T.id);   // えらんだ・追跡中
// 2D・2.5D：上がきのキャンバスに描く
function drawRunLayer() {
  RUN.drawn = now(); RUN.hits = [];
  if (!S.ctxr) return;
  clearRunLayer();
  if (!S.layer.run || S.v3 || !S.vis) return;
  const g = S.ctxr, z = S.cam.z, list = runList(S.vis, view());
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); g.lineJoin = 'round';
  const lb = [];
  list.sort((a, b) => runIsSel(a) - runIsSel(b));   // えらんだ列車はいちばん上に
  for (const o of list) {
    const k = o.R.k, sel = runIsSel(o);
    if (k === 'rail' || k === 'bus') {
      // 太さは地図といっしょに大きくなる（決まった大きさ。t62：遠くから見ても大きすぎないように）
      const wd = k === 'rail' ? clamp(0.42 * z, 2.5, 22) : clamp(0.3 * z, 2, 16), hl = Math.max(1.2, wd * 0.3);
      const off = o.yard ? 0 : (wd / 2 + hl) / z, hx = o.x + Math.sin(o.a) * off, hy = o.y - Math.cos(o.a) * off;   // 進む向きの左（留置線は まん中）
      if (o.len * z >= 10) {
        // 車両の形：線路・道路にそって、頭から うしろへ。両ごとにすきま
        const pts = runOff(runSub(o.H, o.d - o.len, o.d), off).map(q => [sx(q[0]), sy(q[1])]);
        const path = () => { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); };
        g.setLineDash([]); g.lineCap = 'round';
        if (sel) { path(); g.strokeStyle = 'rgba(255,205,0,.95)'; g.lineWidth = wd + 2 * hl + 7; g.stroke(); }
        path(); g.strokeStyle = 'rgba(255,255,255,.96)'; g.lineWidth = wd + 2 * hl; g.stroke();
        path(); g.strokeStyle = 'rgba(22,22,22,.92)'; g.lineWidth = wd + Math.min(1.8, hl); g.stroke();
        g.lineCap = 'butt';
        const cpx = o.car * z; if (k === 'rail' && cpx >= 8) g.setLineDash([cpx - 1.8, 1.8]);
        path(); g.strokeStyle = o.R.c; g.lineWidth = wd; g.stroke(); g.setLineDash([]);
        if (wd >= 5) { const h = pts[pts.length - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(h[0], h[1], wd * 0.3, 0, 6.3); g.fill(); }   // 頭（前のまど）
        RUN.hits.push({ o, pts, r: wd / 2 + 10 });
      } else {
        // 遠いとき：小さな丸（地図といっしょに小さく）
        const r = clamp(o.len * z * 0.35, 2.2, 4.5), X = sx(hx), Y = sy(hy);
        g.save(); g.translate(X, Y); g.rotate(o.a);
        if (sel) { g.beginPath(); g.arc(0, 0, r + 6, 0, 6.3); g.fillStyle = 'rgba(255,205,0,.95)'; g.fill(); }
        g.beginPath(); g.arc(0, 0, r, 0, 6.3);
        g.fillStyle = o.R.c; g.fill(); g.lineWidth = o.dl >= 60 ? 2 : 1.4; g.strokeStyle = o.dl >= 60 ? '#e8322a' : '#fff'; g.stroke(); g.restore();   // 遅れている列車は赤いふち
        RUN.hits.push({ o, pts: [[X, Y]], r: r + 12 });
      }
      if (z >= 14 || sel) lb.push([o, sx(hx), sy(hy)]);
    } else {
      // 船・飛行機：向きのある しるし（地図といっしょに大きさを変える）
      const r = clamp(0.45 * z + 2.5, 3.5, 8), X = sx(o.x), Y = sy(o.y);
      g.save(); g.translate(X, Y); g.rotate(o.a);
      if (sel) { g.beginPath(); g.arc(0, 0, r + 7, 0, 6.3); g.fillStyle = 'rgba(255,205,0,.95)'; g.fill(); }
      g.beginPath(); g.moveTo(r + 3, 0); g.lineTo(-r, r * 0.85); g.lineTo(-r * 0.4, 0); g.lineTo(-r, -r * 0.85); g.closePath();
      g.fillStyle = o.R.c; g.fill(); g.lineWidth = 1.8; g.strokeStyle = '#fff'; g.stroke(); g.restore();
      RUN.hits.push({ o, pts: [[X, Y]], r: r + 11 });
      if (z >= 9 || sel) lb.push([o, X, Y]);
    }
  }
  // 列車の名前（近いとき・えらんだ列車。重ならないように）
  g.font = '700 11px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const used = [];
  lb.sort((a, b) => runIsSel(b[0]) - runIsSel(a[0]));
  for (const [o, X, Y] of lb.slice(0, 40)) {
    const late = o.dl >= 60 ? ' +' + Math.round(o.dl / 60) + T('分') : '';   // 遅れ（運行の乱れ）
    const sel = runIsSel(o), t = runName(o.T, o.R.k) + (sel || z >= 20 ? ' → ' + runDest(o.R, o.T) : '') + late, w = g.measureText(t).width + 8, x = X + 9, y = Y - 12;
    if (!sel && used.some(r => x < r[2] && x + w > r[0] && y - 8 < r[3] && y + 8 > r[1])) continue;
    used.push([x, y - 8, x + w, y + 8]);
    g.fillStyle = sel ? 'rgba(255,236,150,.97)' : late ? 'rgba(255,222,220,.95)' : 'rgba(255,255,255,.9)'; g.fillRect(x, y - 8, w, 16); g.fillStyle = late ? '#a3120c' : '#222'; g.fillText(t, x + 4, y);
  }
}
const runName = (tn, k) => (tn.kind && (k === 'rail' || !k || tn.kind !== '普通') ? T(kindL(tn.kind)) + ' ' : '') + tn.num;   // バス・船・飛行機は「普通」を出さない
function runDest(R, tn) { const e = tn.s[tn.s.length - 1]; return (e && R.sn && R.sn.get(e[0])) || ''; }
// タップした列車（2D：描いた形の近く）
const runSegD = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)) : 0; return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t); };
function runHit(px, py) {
  let best = null, bd = Infinity;
  for (const h of RUN.hits) {
    const P = h.pts; let d = P.length === 1 ? Math.hypot(px - P[0][0], py - P[0][1]) : Infinity;
    for (let i = 0; i + 1 < P.length; i++) d = Math.min(d, runSegD(px, py, P[i], P[i + 1]));
    if (d <= h.r && d < bd) { bd = d; best = h.o; }
  }
  return best;
}
// 列車の情報（下のシート）。2秒ごとに「いま」を書きなおす。3D でも出す
function showTrain(R, tn) {
  RUN.sel = { rid: R.id, tid: tn.id }; S.sel = null; S.dirty = true; if (S.v3) S.v3.dirty = true;
  const key = R.id + ':' + tn.id, rail = R.k === 'rail', sc = tn.s;
  const rows = sc.map((e, i) => `<div class="mp-ttr" data-i="${i}"><span class="n">${esc(R.sn.get(e[0]) || '')}</span><span class="t">${e[1] != null ? `<span>${hms(e[1])}着</span>` : ''}</span><span class="t">${e[2] != null ? `<span>${hms(e[2])}発</span>` : ''}</span><span class="k">${rail && e[3] ? `<span>${e[3]}番線</span>` : ''}</span></div>`).join('');
  sheet(`<div class="mp-s3in"><h4 data-trn="${key}"><span style="color:${esc(R.c)}">■</span> <span>${esc(R.n)}</span></h4>
    <div class="mp-kv"><b>${RUN_K[R.k] || '列車'}</b><span><b translate="no">${esc(runName(tn, R.k))}</b>　<span>${esc(runDest(R, tn))}行き</span>${tn.day ? ' <small class="mp-tag">臨時</small>' : ''}</span>
      <b>いま</b><span data-now></span><b>つぎ</b><span data-next></span><b data-unkoh hidden>運行</b><span data-unko hidden></span>${S.wx && wxOk() ? '<b>天気</b><span data-wxt>—</span>' : ''}
      ${tn.fname ? `<b>${rail ? '編成' : '車両'}</b><span><span translate="no">${esc(tn.fname)}</span>${tn.fser ? `<small class="muted">（<span>${esc(tn.fser)}</span>）</small>` : ''}${rail ? `・<span>${tn.fn}両</span>` : ''}</span>` : ''}
      ${tn.onum ? `<b>運用</b><span>${esc(tn.onum)}</span>` : ''}<b data-subh hidden>代走</b><span data-sub hidden></span>
      <b>持ち主</b><span>${esc(R.own)}</span></div>
    <div class="mp-row"><button class="btn main" data-fol></button><button class="btn" data-dia>系統のダイヤ</button></div>
    <div class="mp-row" data-cxrow hidden></div>
    <div class="mp-ttl">${rows}</div></div>`, sh => {
    sh.querySelector('[data-dia]').onclick = () => openDia(R.id);
    sh.addEventListener('click', ev => {
      const a = ev.target.closest && ev.target.closest('[data-unkoz]'); if (a) { ev.preventDefault(); openUnko(Number(a.dataset.unkoz)); return; }   // 運行情報
      const b = ev.target.closest && ev.target.closest('[data-cxa],[data-cxd],[data-cxf]'); if (b) { ev.preventDefault(); cxBtn(b, R, tn, () => { const r = S.sheet.querySelector('[data-cxrow]'); if (r) r.dataset.k = ''; upd(); }); }   // 運休にする・やめる（DB の更新60）
    });
    sh.querySelector('[data-fol]').onclick = () => { const on = !(RUN.follow && RUN.follow.rid === R.id && RUN.follow.tid === tn.id); runFollow(on ? R.id : 0, tn.id); upd(); };
  });
  S.sheet.classList.add('mp-s3');
  const upd = () => {
    const h = S.sheet.querySelector('[data-trn]');
    if (!h || h.dataset.trn !== key || !RUN.sel || RUN.sel.rid !== R.id || RUN.sel.tid !== tn.id) { clearInterval(RUN.selT); if (!h || h.dataset.trn !== key) { RUN.sel = null; S.dirty = true; } return; }
    const R2 = RUN.routes.get(R.id) || R, t2 = (R2.tr || []).find(x => x.id === tn.id) || tn, p = runPos(R2, t2, jstNow(), S.vis || visibleItems()), nm = i => esc(R.sn.get(sc[i][0]) || '');
    let now_ = '', nxt = '';
    if (!p) {
      const tm = jstNow(), tt = tm.sec;
      now_ = tt < tn.t0 ? `<span>まだ出ていません</span>（<span>${nm(0)}</span> <span>${hms(tn.t0)}発</span>）` : '<span>走りおわりました</span>';
    } else if (p.at >= 0) {
      now_ = `<b>${p.at === sc.length - 1 ? `${nm(p.at)}着（終点）` : `${nm(p.at)}に停車中`}</b>${rail && sc[p.at][3] ? `（<span>${sc[p.at][3]}番線</span>）` : ''}`;
      if (p.at + 1 < sc.length) nxt = `<span>${nm(p.at + 1)}</span> <span>${hms(sc[p.at + 1][1] != null ? sc[p.at + 1][1] : sc[p.at + 1][2])}着</span>　<small class="muted"><span>${hms(sc[p.at][2])}発</span></small>`;
    } else if (p.nx > 0) {
      now_ = `<span>${nm(p.nx - 1)} → ${nm(p.nx)} を走っています</span>`;
      nxt = `<b>${nm(p.nx)}</b> <span>${hms(sc[p.nx][1])}着</span>`;
    }
    const ui = unkoTrain(R2, t2, p);   // 運行の乱れ：遅れ・運休（鉄道・バス・船・飛行機。t108）・工事中・持ち主の運休（DB の更新60）
    if (!p && ui && ui.can) now_ = ui.can === 'ori' ? `<b class="mp-late">区間運休（折り返し運転）</b>（<span>${esc(ui.why)}</span>）` : `<b class="mp-late">運休</b>（<span>${esc(ui.why)}</span>）`;
    const a = S.sheet.querySelector('[data-now]'), b = S.sheet.querySelector('[data-next]'); if (a) a.innerHTML = now_; if (b) b.innerHTML = nxt || '—';
    const sh2 = S.sheet.querySelector('[data-subh]'), sb2 = S.sheet.querySelector('[data-sub]');   // 予備編成の代走（DB の更新80）
    if (sh2 && sb2) { const sx = ui && ui.run ? runSubOf(t2, ui.run.day) : null; sh2.hidden = sb2.hidden = !sx;
      if (sx) { const h = `<span>予備編成</span> <b translate="no">${esc(sx[2])}</b> <span>が走ります（${esc(runShopT(t2))}）</span>`; if (sb2.dataset.k !== h) { sb2.dataset.k = h; sb2.innerHTML = h; } } }
    const uh = S.sheet.querySelector('[data-unkoh]'), ub = S.sheet.querySelector('[data-unko]');
    if (uh && ub) { const on = !!(ui && (ui.dl >= 60 || ui.can || ui.stop)); uh.hidden = ub.hidden = !on; if (on) ub.innerHTML = unkoTrainHtml(ui); }
    const cr = S.sheet.querySelector('[data-cxrow]');   // 自分の列車：運休にする・やめる（DB の更新60）
    if (cr) { const h = R2.mine && UNKO.v3 && ui && ui.run ? cxBtns(R2, t2, ui) : ''; if (cr.dataset.k !== h) { cr.dataset.k = h; cr.innerHTML = h; cr.hidden = !h; } }
    const wt = S.sheet.querySelector('[data-wxt]'); if (wt && p) { const k = Math.round(p.x / 4) + ',' + Math.round(p.y / 4) + ',' + Math.floor(Date.now() / 60000); if (wt.dataset.k !== k) { wt.dataset.k = k; wt.innerHTML = wxInner(p.x, p.y); } }
    const fol = RUN.follow && RUN.follow.rid === R.id && RUN.follow.tid === tn.id, fb = S.sheet.querySelector('[data-fol]');
    if (fb) { fb.textContent = T(fol ? '📍 追跡をやめる' : '📍 追跡する'); fb.classList.toggle('on', fol); }
    const cur = p ? (p.at >= 0 ? p.at : p.nx) : -1, tt = p ? p.tt : -1;
    S.sheet.querySelectorAll('.mp-ttr').forEach(r => { const i = Number(r.dataset.i), e = sc[i];
      r.classList.toggle('now', i === cur); r.classList.toggle('past', !!p && i !== cur && (e[2] != null ? e[2] : e[1]) < tt); });
  };
  clearInterval(RUN.selT); RUN.selT = setInterval(upd, 2000); upd();
  { const r = S.sheet.querySelector('.mp-ttr.now'), box = S.sheet.querySelector('.mp-ttl'); if (r && box) box.scrollTop = Math.max(0, r.offsetTop - box.offsetTop - 44); }
  S.onSheetClose = () => { RUN.sel = null; clearInterval(RUN.selT); S.dirty = true; if (S.v3) S.v3.dirty = true; };
}
// 追跡：地図がその列車についていく（自分で地図をうごかすと、やめる）
function runFollow(rid, tid) {
  RUN.follow = rid ? { rid, tid } : null; RUN.ft = 0;
  if (rid) { RUN.keep.add(rid); RUN.sel = { rid, tid }; }
  runBar(); S.dirty = true; if (S.v3) S.v3.dirty = true;
}
function runFollowStep() {
  const f = RUN.follow; if (!f || !S.layer.run) return;
  const t = now(); if (t - RUN.ft < 33) return; RUN.ft = t;
  const R = RUN.routes.get(f.rid); if (!R || !R.tr || !R.tr.length) return;
  const tn = R.tr.find(x => x.id === f.tid), p = tn && runPos(R, tn, jstNow(), S.vis || visibleItems());
  if (!p) { RUN.follow = null; runBar(); toast(T('列車が走りおわりました（追跡をやめました）')); return; }
  const q = runPt(p.H, p.d - runCarL(R.k) * (R.k === 'rail' ? tn.fn : 1) / 2);   // 列車のまん中
  if (S.v3) { if (Math.hypot(q[0] - S.v3.tx, q[1] - S.v3.ty) > 1e-4) { m3Target(q[0], q[1]); S.v3.dirty = true; } }
  else if (Math.hypot(q[0] - S.cam.x, q[1] - S.cam.y) * S.cam.z > 0.4) setCam(q[0], q[1], S.cam.z);
}
// 追跡中・しぼりこみ中のしるし（地図の左上）
function runBar() {
  if (!S.wrap) return;
  let b = S.wrap.querySelector('.mp-runbar');
  if (!b) { b = el('<div class="mp-runbar" hidden></div>'); S.wrap.appendChild(b); }
  const f = RUN.follow, R = f && RUN.routes.get(f.rid), tn = R && R.tr && R.tr.find(x => x.id === f.tid), parts = [];
  if (f && S.layer.run) parts.push(`<button data-rbf>📍 <span>追跡中</span>${tn ? `：<b translate="no">${esc(runName(tn, R.k))}</b>` : ''}</button><button data-rbfx title="追跡をやめる">✕</button>`);
  if (S.layer.run && runFiltered()) parts.push(`<button data-rbs>🔎 <span>しぼりこみ中</span></button><button data-rbsx title="しぼりこみをやめる">✕</button>`);
  { const t = Date.now() / 1000, n = UNKO.list.filter(z => unkoState(z, t).live).length, ask = UNKO.list.some(z => z.st === 'ask' && (z.me || z.can));   // 運行情報（DB の更新51）
    if ((S.layer.run && n) || ask) parts.push(`<button data-rbu class="${ask ? 'mp-rbu-ask' : ''}">🚦 <span>運行情報</span> <b>${n}</b>${ask ? ' <span>❗対応をえらぶ</span>' : ''}</button>`); }
  b.innerHTML = parts.join(''); b.hidden = !parts.length;
  const q = s => b.querySelector(s);
  if (q('[data-rbf]')) q('[data-rbf]').onclick = () => { if (R && tn) showTrain(R, tn); };
  if (q('[data-rbfx]')) q('[data-rbfx]').onclick = () => runFollow(0);
  if (q('[data-rbs]')) q('[data-rbs]').onclick = () => openRunFind();
  if (q('[data-rbsx]')) q('[data-rbsx]').onclick = () => runSetF({ k: ['rail', 'bus', 'ship', 'air'], dir: 0, kind: '', rid: 0 });
  if (q('[data-rbu]')) q('[data-rbu]').onclick = () => { const z = UNKO.list.find(z => z.st === 'ask' && (z.me || z.can)); openUnko(z ? z.id : 0); };
}
/* ---------- 運行の乱れ（2026-11-01・DB の更新51）：列車の遅れ・運転見合わせ・運行情報 ----------
   サーバー（5分ごと）が、雪・大雨・強風（天気と同じ式）・人と接触などで「乱れ」を作る。乱れごとに、列車の速さの窓 wins：[[はじめ, おわり（1970年からの秒）, 速さ（0 止まる・0.6 徐行）]]。
   列車の遅れは、始発駅を出た時刻から窓の分だけたまり、窓のあとは 1秒に 0.1秒ずつ取りもどす（サーバーの毎時の処理と同じ計算）。見合わせ中に始発駅を出る列車は運休 */
const UNKO = { list: [], rt: new Map(), cx: [], cxT: new Map(), cxF: new Map(), ver: 0, v3: false, at: -1e9, busy: false, off: false, toff: 0 };   // at：前に読んだ時刻（performance.now）。rt：系統ごとの乱れ・cx：持ち主の運休（DB の更新60）
const UNKO_K = { wind: '強風', rain: '大雨', snow: '大雪', person: '人と接触', sick: '急病のお客さまの救護', car: '車両・機材の点検', signal: '信号の確認', track: '線路内の点検',
                 bird: 'バードストライク', rwy: '滑走路の点検', atc: '管制の混雑', wave: '高波・うねり', accident: '交通事故', traffic: '渋滞',
                 snowstop: '冬の運休', stuck: '大雪で立ち往生', fog: '濃霧', heat: '高温（レール）', hail: 'ひょう',
                 volt: '電圧の低下', power: '変電所の停止' };   // 冬の運休・立ち往生（t108。DB の更新57）・濃霧・高温・ひょう（DB の更新66）・変電所（DB の更新89）
// 対応（t108。5つ・乗りものごと。サーバーの _mp_unko_pickt と同じ）。どれがよいかは出さない
const unkoPickT = (p, md) => md === 'air' || md === 'ship' ? ({ 1: '定刻どおり運航する', 2: '点検してから運航する', 3: '出発を見合わせて待つ', 4: '一部の便を欠航する', 5: '全便を欠航する' })[p]
  : md === 'bus' ? ({ 1: 'いつもどおり運行する', 2: '安全を確認しながら運行する', 3: '徐行・迂回して運行する', 4: '一部の便を運休する', 5: '運休する' })[p]
  : ({ 1: 'いつもどおり運転する', 2: '点検しながら運転する', 3: '徐行運転する', 4: '間引き運転（一部の列車を運休）', 5: '運転を見合わせる' })[p];
const UNKO_PICK = { 1: unkoPickT(1), 2: unkoPickT(2), 3: unkoPickT(3), 4: unkoPickT(4), 5: unkoPickT(5) };
const unkoOpts = z => UNKO.v2 === false ? [[1, 'いつもどおり運転する'], [2, '徐行・点検しながら運転する'], [3, '運転を見合わせる']] : [1, 2, 3, 4, 5].map(k => [k, unkoPickT(k, z.mode)]);
// 運転規制の目安（DB の更新75 のあと＝wx 3 は、気をつける基準が少し上がる）
const unkoRule = (n = (UNKO.wx || 1) >= 3) => `<ul style="margin:6px 0;padding-left:1.2em;line-height:1.7">
  <li><b>鉄道</b>：強風（最大瞬間風速）${n ? 22 : 20}m/s から気をつける・25m/s で とても危ない／強い雨（1時間）${n ? 40 : 30}mm・50mm／強い雪（1時間）${n ? 4 : 3}cm・7cm</li>
  <li>天気は「これから強くなる予報」のときは、いちばん強いときに合わせる</li>
  <li><b>濃霧</b>（見通し）：飛行機 ${n ? 300 : 400}m・150m、船 ${n ? 350 : 500}m・200m、バス ${n ? 80 : 100}m　<b>高温</b>：鉄道は 36℃ でレールがのびるおそれ　<b>ひょう</b>：飛行機は機体の点検</li>
  <li><b>船</b>：最大瞬間 ${n ? 17 : 15}m/s から気をつける・20m/s で とても危ない　<b>飛行機</b>：横風 ${n ? 21 : 18}m/s・25m/s、雪 ${n ? 3 : 2}cm・5cm（除雪）　<b>バス</b>：大雨 ${n ? 50 : 40}mm・70mm（冠水）、雪 ${n ? 3 : 2}cm・5cm</li>
  <li><b>人と接触</b>：救護と警察の確認がおわるまでは、運転できません</li>
  <li><b>重い不具合</b>（ブレーキの異音・停電・倒木・落下物・機材の故障）は、点検がおわるまで あぶない</li>
  <li><b>雪国の冬</b>：積雪 20cm（バスは 10cm）より多い駅をとおる系統は、雪の対策（車両・融雪器）がないと「冬の運休」（対策がすむまで。えらぶ対応はありません）。積雪 50cm（バスは 30cm）で強い雪のとき、除雪車が足りないと立ち往生（≡ →「❄ 雪の対策」）</li></ul>
  <p class="muted" style="margin:4px 0">対応しだいで、遅れの大きさや、あとのトラブルが変わります。対応は、乱れがおわるまで何度でも変えられます（10分えらばないと現場の判断）。</p>`;
const hmA = t => hms(t + 9 * 3600);   // 1970年からの秒 → 日本時間の 時:分
// 運行情報を読む（1分ごと。地図を開いているとき）。サーバーの更新（DB の更新51）の前は、なにもしない
async function unkoLoad(force) {
  if (UNKO.off || UNKO.busy || (!force && now() - UNKO.at < 60000)) return;
  UNKO.busy = true; UNKO.at = now();
  try {
    const d = await call('mp_unko_list', { p_as: S.as });
    UNKO.list = (d && d.list) || []; UNKO.toff = d && d.now ? d.now - Date.now() / 1000 : 0;
    if (UNKO.list.length) UNKO.v2 = UNKO.list.every(z => 'mode' in z);   // サーバーの更新56（対応5つ）のあとか
    // 系統ごとの乱れ（サーバーの _mp_unko_rt と同じ形）：{id, w: [[はじめ, おわり, 速さ, 間引き, 全線]]（はじめの順）, zi: 区間（null は全線）}
    UNKO.v3 = !!(d && d.v3); UNKO.wx = (d && d.wx) || 1; UNKO.ver++;
    UNKO.aioff = d && 'aioff' in d ? d.aioff : undefined;   // AI の運行の乱れをオフにしているか（いまの名義。DB の更新73。国は null・更新の前は undefined）   // wx 2：濃霧・高温・ひょう（DB の更新66）
    const rt = new Map();
    for (const z of UNKO.list.slice().sort((a, b) => a.id - b.id)) {
      const w = (z.wins || []).filter(e => e[1] > e[0] && e[2] < 1).map(e => [e[0], e[1], e[2], e[3] === 1 ? 1 : 0, e[5] === 1 ? 1 : 0]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      if (!w.length) continue;
      for (const r of z.routes || []) {
        // 迂回・区間折り返し（DB の更新82）：区間だけの見合わせ（速さ 0・全線でない）は、迂回できる系統は迂回の速さ、迂回しない系統で折り返しなら6つめ 1
        const zi = Array.isArray(r.zi) ? r.zi : null, dr = zi && typeof r.det === 'number' ? r.det : null;
        const wr = w.map(e => e[2] === 0 && e[4] !== 1 ? (dr != null ? [e[0], e[1], dr, e[3], e[4], 0] : [e[0], e[1], 0, e[3], e[4], zi && z.ori ? 1 : 0]) : [e[0], e[1], e[2], e[3], e[4], 0]);
        if (!rt.has(r.id)) rt.set(r.id, []); rt.get(r.id).push({ id: z.id, w: wr, zi });
      }
    }
    UNKO.rt = rt;
    // 持ち主の運休：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の]
    UNKO.cx = (d && Array.isArray(d.cx)) ? d.cx : []; UNKO.cxT = new Map(); UNKO.cxF = new Map();
    for (const c of UNKO.cx) {
      if (c[1] != null) { if (!UNKO.cxT.has(c[1])) UNKO.cxT.set(c[1], new Map()); UNKO.cxT.get(c[1]).set(c[2], c); }
      else if (c[3] != null) { if (!UNKO.cxF.has(c[3])) UNKO.cxF.set(c[3], []); UNKO.cxF.get(c[3]).push(c); }
    }
    S.dirty = true; if (S.v3) S.v3.dirty = true; runBar();
  } catch (e) { if (/Could not find|schema cache|does not exist/i.test((e && e.message) || '')) UNKO.off = true; }
  finally { UNKO.busy = false; }
}
// 系統の駅までの距離（m。駅 j まで）：乱れの区間に入る・出る時刻（通過する駅）をきめる
function runCum(R) { if (!R.cum) { const c = [0]; for (let i = 0; i + 1 < R.st.length; i++) c.push(c[i] + ((R.legs[i] && Number(R.legs[i].d)) || 0)); R.cum = c; } return R.cum; }
// 列車ごとの乱れの窓（サーバーの _mp_unko_trn と同じ計算。DB の更新60）：[{a, b（1970年からの秒）, r 速さ, th 間引き, za・zb（始発駅を出てから、区間にいるあいだ。秒）, zc, rs（続けて止めているところのはじめ）, id 乱れ}]
//   区間：乱れの場所の駅と、その となりの駅のあいだ（z.zi。系統の駅の何番目〜何番目）。その区間を通らない列車は null（ふだんどおり）。全線の窓は どこでも
function unkoTrW(R, tn) {
  if (tn.ukv === UNKO.ver) return tn.ukW;
  tn.ukv = UNKO.ver; tn.ukW = null;
  const L = UNKO.rt.get(R.id), sc = tn.s, n = sc.length; if (!L || !L.length || n < 2) return null;
  if (!tn.idx) tn.idx = runIdx(R, tn);
  const idx = tn.idx, bad = idx.some(q => q < 0), t0 = sc[0][2], cum = runCum(R), fwd = idx[n - 1] > idx[0];
  const ar = sc.map(e => e[1] != null ? e[1] : e[2]), dp = sc.map(e => e[2] != null ? e[2] : e[1]);
  const at = (k, enter) => {   // 系統の k 番目の駅を出る（enter）・着く時刻（その日の秒。通過する駅は前後の駅から距離で）
    for (let i = 0; i < n; i++) {
      if (idx[i] === k) return enter ? dp[i] : ar[i];
      if (i + 1 < n && ((idx[i] < k && k < idx[i + 1]) || (idx[i] > k && k > idx[i + 1]))) {
        const ca = cum[idx[i]], cb = cum[idx[i + 1]], f = cb !== ca ? (cum[k] - ca) / (cb - ca) : (k - idx[i]) / (idx[i + 1] - idx[i]);
        return dp[i] + (ar[i + 1] - dp[i]) * f;
      }
    }
    return null;
  };
  const W = [], lo = Math.min(idx[0], idx[n - 1]), hi = Math.max(idx[0], idx[n - 1]);
  for (const z of L) {
    let cs = null, ce = -Infinity;
    for (const [a, b, r, th, wide, o] of z.w) {
      let rs = a;
      if (r === 0) { if (cs === null || ce < a - 1) { cs = a; ce = b; } else ce = Math.max(ce, b); rs = cs; }
      const E = { a, b, r, th: th === 1, rs, id: z.id, o: o === 1 };   // o：区間折り返し（DB の更新82）
      if (wide === 1 || !Array.isArray(z.zi) || bad) { W.push(Object.assign({ za: -1e9, zb: 1e9, zc: 0 }, E, { o: false })); continue; }
      for (const [ka, kb] of z.zi) {
        const ea = Math.max(ka, lo), eb = Math.min(kb, hi); if (eb <= ea) continue;
        const za = at(fwd ? ea : eb, true), zb = at(fwd ? eb : ea, false);
        if (za == null || zb == null || zb <= za) continue;
        W.push(Object.assign({ za: za - t0, zb: zb - t0, zc: za - t0 }, E));
      }
    }
  }
  return (tn.ukW = W.length ? W : null);
}
// 運休か：見合わせの窓のあいだに区間に入るはずで、見合わせ（続けて止めているところ）がはじまってから始発駅を出る列車（stop）。
//   間引き：番号が奇数で、間引きの窓のあいだに区間に入り、窓がはじまってから出る列車（thin）。{k, id（乱れ）} か null
function unkoCanW(W, d0, tid, T) {
  if (!W) return null;
  let ori = null;
  for (const E of W) {
    const ze = d0 + E.zc;
    if (E.r === 0 && E.o && E.a <= ze && ze < E.b) { if (!ori) ori = E; continue; }   // 区間折り返し（DB の更新82。サーバーの _mp_unko_trn と同じ）
    if (E.r === 0 && E.a <= ze && ze < E.b && d0 >= E.rs) return { k: 'stop', id: E.id };
    if (E.th && tid % 2 === 1 && E.a <= ze && ze < E.b && d0 >= E.a) return { k: 'thin', id: E.id };
  }
  if (ori && T && 1 - (ori.zb - ori.za) / Math.max(1, T) < 0.05) return { k: 'stop', id: ori.id };   // 区間の外がほとんどない列車は運休
  return ori ? { k: 'ori', id: ori.id, za: ori.za, zb: ori.zb } : null;
}
// d0 に始発駅を出た列車の、時刻 te の遅れ（秒）：区間にいるあいだは窓の速さ（0 なら区間の手前で待つ）、そのほかは 1秒に 0.1秒ずつ取りもどす。
//   pl：ダイヤの位置（始発駅を出てからの秒）がそこに着いたら やめる（終点に着くときの遅れの見こみ。サーバーにはない）
function unkoDlyW(W, d0, te, pl = Infinity) {
  if (!W || te <= d0) return 0;
  let s = d0, d = 0, it = 0;
  while (s < te - 1e-6 && it++ < 400) {
    const p = s - d0 - d; if (p >= pl - 1e-6) break;
    let r = 1, nx = Math.min(te, s + (pl - p) / (d > 0 ? 1.1 : 1));
    for (const E of W) {
      if (!E.o && E.a <= s && s < E.b && E.za <= p + 1e-6 && p < E.zb - 1e-6 && E.r < r) r = E.r;   // 折り返しの窓では待たない（DB の更新82）
      if (E.a > s) nx = Math.min(nx, E.a); else if (E.b > s) nx = Math.min(nx, E.b);
    }
    if (r < 1) {
      if (r > 0) for (const E of W) if (!E.o && E.a <= s && s < E.b) {
        if (p < E.za - 1e-6) nx = Math.min(nx, s + (E.za - p) / r);
        else if (p < E.zb - 1e-6) nx = Math.min(nx, s + (E.zb - p) / r);
      }
      if (!isFinite(nx)) break;
      d += (1 - r) * (nx - s); s = nx;
    } else {
      const pr = d > 0 ? 1.1 : 1;
      if (d > 0) nx = Math.min(nx, s + d / 0.1);
      for (const E of W) if (!E.o && E.a <= s && s < E.b && p < E.za - 1e-6) nx = Math.min(nx, s + (E.za - p) / pr);
      d = Math.max(0, d - 0.1 * (nx - s)); s = nx;
    }
  }
  return d;
}
// 工事中（検査・改造・転属・納車）・持ち主の運休（DB の更新60）：その日（day）・d0 に始発駅を出る1本が走らないわけ（shop・cxl）か null
function runOffK(tn, day, d0) {
  if (tn.ordd && tn.ordd.has(day)) return tn.ordd.get(day) === 'v' ? 'ordv' : 'ordx';   // 運転整理（DB の更新100）：その日は運転整理の列車が かわりに走る・運転整理で運休
  const w = tn.wk; if (w && d0 < w[1] && d0 + (tn.t1 - tn.t0) > (w[0] == null ? -Infinity : w[0]) && !runSubOf(tn, day)) return 'shop';   // 予備編成が代走する回は走る（DB の更新80）
  return runCxOf(tn, day, d0) ? 'cxl' : null;
}
// 予備編成の代走（DB の更新80）：その日（day）の1本を走る予備編成［運行日, 発車, 予備編成］か null
const runSubOf = (tn, day) => (tn.sub || []).find(x => x[0] === day) || null;
// 持ち主の運休（その1本・編成ごと）：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の] か null
function runCxOf(tn, day, d0) {
  const ct = UNKO.cxT.get(tn.id); if (ct && ct.has(day)) return ct.get(day);
  const cf = tn.form != null ? UNKO.cxF.get(tn.form) : null;
  if (cf) for (const c of cf) if (c[4] <= d0 && d0 < (c[5] == null ? Infinity : c[5])) return c;
  return null;
}
const CAR_BUSY = { deliver: '納車まち', move: '転属中', ac: '冷房工事', heat: '暖房工事', toilet: 'トイレ工事', inspect: '検査中', renew: '更新工事', snow: '雪の対策工事' };
const mdhmA = t => { const x = new Date((t + 9 * 3600) * 1000); return `${x.getUTCMonth() + 1}/${x.getUTCDate()} ${hms(t + 9 * 3600)}`; };   // 1970年からの秒 → 日本時間の 月/日 時:分
const runShopT = tn => `編成が${CAR_BUSY[tn.wkk] || '工事中'}${tn.wk ? `（${mdhmA(tn.wk[1])} まで）` : ''}`;
const runListStale = () => { for (const R of RUN.routes.values()) R.at = 0; RUN.need = 0; S.dirty = true; };   // 車両の工事・転属をしたら、ダイヤを読みなおす
// 乱れのいまのようす（t：1970年からの秒）。先の窓（あまい対応のトラブル）は、その時刻になるまで見せない
function unkoState(z, t) {
  const W = (z.wins || []).filter(w => w[1] > w[0]), cur = W.filter(w => w[0] <= t && t < w[1]).sort((a, b) => a[2] - b[2])[0];
  const stopEnd = () => { let e = cur[1]; for (const w of W.slice().sort((a, b) => a[0] - b[0])) if (w[2] === 0 && w[0] <= e + 1 && w[1] > e && w[0] <= t) e = w[1]; return e; };
  const md = z.mode || 'rail', stopW = md === 'air' || md === 'ship' ? '欠航' : md === 'bus' ? '運休' : '運転見合わせ';
  if (z.kind === 'snowstop' && cur) return { k: 'stop', live: true, txt: `${md === 'rail' ? '運転見合わせ' : '運休'}（雪の対策がすむまで）` };   // 冬の運休（t108）
  if (z.st === 'ask') return { k: 'ask', live: true, txt: cur && cur[2] === 0 ? `${md === 'rail' ? '運転を見合わせています' : stopW + 'しています'}（対応を決めています）` : 'おくれています（対応を決めています）' };
  if (cur) return cur[2] === 0 ? { k: 'stop', live: true, txt: `${stopW}（再開は ${hmA(stopEnd())} ごろの見こみ）` }
    : cur[3] === 1 ? { k: 'slow', live: true, txt: `${md === 'rail' ? '間引き運転' : '一部の便を運休'}（${hmA(cur[1])} ごろまで）。遅れが出ています` }
    : { k: 'slow', live: true, txt: `${cur[2] >= 0.8 ? '点検しながら運行' : md === 'rail' ? '徐行運転' : '徐行・待ち合わせ'}（${hmA(cur[1])} ごろまで）。遅れが出ています` };
  if (W.some(w => w[0] > t)) return { k: 'run', live: true, txt: '運転しています' };
  const e = W.reduce((m, w) => Math.max(m, w[1]), 0);
  if (e && t < e + 3600) return { k: 'rec', live: true, txt: W.some(w => w[2] === 0) ? '運転を再開しました（遅れが出ています）' : 'ふだんの速さにもどりました（遅れが出ています）' };
  return { k: 'done', live: false, txt: 'ふだんどおり運転しています' };
}
// 列車のいまの運行（シート用）：{ dl（遅れ 秒）, can（shop 工事中・cxl 持ち主の運休・stop 見合わせ・thin 間引き）, stop（見合わせで止まっている）, why（わけ）, z（乱れ）,
//   run：{day, d0}（いま走っている・運休になった・つぎに走る1本） }
function unkoTrain(R, tn, p) {
  const tm = jstNow(), W = unkoTrW(R, tn);
  let run = p ? { day: p.day, d0: p.d0 } : null, can = null, z = null;
  if (!p) for (const [day, off] of [[tm.date, 0], [tm.prev, 86400]]) {   // 走っていない：運休になった1本（2時間先まで・1時間前まで）
    if (tn.day && tn.day !== day) continue;
    const d0 = tm.day0 - off + tn.t0;
    if (!(d0 < tm.abs + 7200 && d0 + (tn.t1 - tn.t0) > tm.abs - 3600)) continue;
    const k = runOffK(tn, day, d0); if (k) { can = k; run = { day, d0 }; break; }
    const c = unkoCanW(W, d0, tn.id, tn.t1 - tn.t0); if (c) { can = c.k; z = UNKO.list.find(q => q.id === c.id) || null; run = { day, d0 }; break; }
  }
  if (p && W) { const c = unkoCanW(W, p.d0, tn.id, tn.t1 - tn.t0); if (c && c.k === 'ori') { can = 'ori'; z = UNKO.list.find(q => q.id === c.id) || null; } }   // 区間折り返し（DB の更新82）
  if (!run) for (const [day, off] of [[tm.date, 0], [tm.next, -86400]]) {   // つぎに走る1本
    if (tn.day && tn.day !== day) continue;
    const d0 = tm.day0 - off + tn.t0; if (d0 > tm.abs) { run = { day, d0 }; break; }
  }
  let stop = false;
  if (p && W) { const rel = p.tt - tn.t0; stop = W.some(E => E.r === 0 && E.a <= tm.abs && tm.abs < E.b && E.za <= rel + 1e-6 && rel < E.zb - 1e-6); }
  if (!z && W) { const ids = new Set(W.map(E => E.id)); z = UNKO.list.filter(q => ids.has(q.id) && q.t0 <= tm.abs).sort((a, b) => b.t0 - a.t0)[0] || null; }
  const why = can === 'shop' ? runShopT(tn) : can === 'cxl' ? '持ち主が運休にしました' : can === 'ordx' ? 'ダイヤの運転整理' : can === 'ordv' ? 'この日は運転整理の列車が かわりに走ります' : z ? (z.kind === 'snowstop' ? '雪の対策が足りないため' : (UNKO_K[z.kind] || '') + 'のため') : '';
  return { dl: p ? p.dl || 0 : 0, can, stop, why, z, run };
}
function unkoTrainHtml(ui) {
  const a = [];
  if (ui.can === 'ori') a.push('<b class="mp-late">区間運休（折り返し運転）</b>');   // DB の更新82
  else if (ui.can === 'ordv') a.push('<b>運転整理</b>');   // DB の更新100
  else if (ui.can) a.push('<b class="mp-late">運休</b>'); else if (ui.stop) a.push('<b class="mp-late">運転見合わせ中</b>');
  if (ui.dl >= 60) a.push(`<b class="mp-late">約${Math.round(ui.dl / 60)}分遅れ</b>`);
  return a.join('・') + (ui.why ? `（<span>${esc(ui.why)}</span>）` : '') + (ui.z && ui.can !== 'shop' && ui.can !== 'cxl' && ui.can !== 'ordv' && ui.can !== 'ordx' ? ` <a href="#" data-unkoz="${ui.z.id}">運行情報</a>` : '');
}
// 自分の列車のボタン（DB の更新60）：この1本を運休にする・編成ごと運休・運休をやめる
function cxBtns(R, tn, ui) {
  const r = ui.run, md = mdL(r.day), out = [], unit = R.k === 'rail' ? '列車' : '便', fu = R.k === 'rail' ? '編成' : '車両';
  if (ui.can === 'ordv' || ui.can === 'ordx') return '';   // 運転整理（DB の更新100）：ダイヤの「運転整理」で
  const ct = UNKO.cxT.get(tn.id), c1 = ct && ct.get(r.day), cf = runCxForm(tn);   // この1本・編成ごと（いま・これから）
  if (c1) { if (c1[7]) out.push(`<button class="btn" data-cxd="${c1[0]}"><span>この${unit}の運休をやめる</span>（<span>${md}</span>）</button>`); }
  else if (ui.can !== 'shop' && !(cf && cf[4] <= r.d0 && (cf[5] == null || r.d0 < cf[5]))) out.push(`<button class="btn" data-cxa="${tn.id}|${r.day}">🚫 <span>この${unit}を運休</span>（<span>${md}</span>）</button>`);
  if (cf) { if (cf[7]) out.push(`<button class="btn" data-cxd="${cf[0]}"><span>${fu}の運休をやめる</span>（<span>${cf[5] != null ? mdhmA(cf[5]) + ' まで' : '乱れがおわるまで'}</span>）</button>`); }
  else if (tn.form != null) out.push(`<button class="btn" data-cxf="${tn.form}" data-cxz="${ui.z && ui.z.st !== 'done' ? ui.z.id : ''}" data-fn="${esc(tn.fname || '')}">🚫 <span>${fu}ごと運休…</span></button>`);
  return out.join('');
}
// 編成ごとの運休で、いま・これから きいているもの
const runCxForm = tn => { if (tn.form == null) return null; const t = Date.now() / 1000; return (UNKO.cxF.get(tn.form) || []).find(c => c[5] == null || c[5] > t) || null; };
// 運休にする・やめる（ボタン b の data-cxa・data-cxd・data-cxf）。おわったら done
async function cxBtn(b, R, tn, done) {
  let r = null;
  if (b.dataset.cxd) r = await api('mp_cxl_del', { p_id: Number(b.dataset.cxd), p_as: S.as }, '運休をやめました');
  else if (b.dataset.cxa) {
    const [tid, day] = b.dataset.cxa.split('|');
    if (!confirm(T(`${mdL(day)}の ${runName(tn, R.k)}（${runDest(R, tn)}行き）を運休にします。運賃は入りません。よろしいですか？`))) return;
    r = await api('mp_cxl_add', { p_train: Number(tid), p_day: day, p_form: null, p_hours: null, p_unko: null, p_as: S.as }, '運休にしました');
  } else if (b.dataset.cxf) {
    const zid = Number(b.dataset.cxz) || null, fn = b.dataset.fn || '';
    const tm = jstNow(), toNight = Math.min(48, Math.max(0.25, ((tm.sec < 3 * 3600 ? 3 * 3600 : 27 * 3600) - tm.sec) / 3600));   // きょうの終電まで（夜中の3時まで）
    const opts = [[1, '1時間'], [3, '3時間'], [6, '6時間'], [Math.round(toNight * 100) / 100, 'きょうの終電まで']];
    const pick = await new Promise(ok => {
      const m = modal([`🚫 ${R.k === 'rail' ? '編成ごと運休' : '車両ごと運休'}`, `<p class="small" style="margin:0 0 6px"><b translate="no">${esc(fn)}</b> <span>が入る列車を、えらんだ時間のあいだ運休にします（運賃は入りません。いつでもやめられます）。</span></p>
        <div class="mp-uk-btns">${opts.map((o, i) => `<button class="btn" data-h="${i}"><b>${i + 1}</b>　<span>${o[1]}</span></button>`).join('')}${zid ? `<button class="btn" data-h="z"><b>${opts.length + 1}</b>　<span>この運行の乱れがおわるまで</span></button>` : ''}</div>`], b2 => {
        b2.querySelectorAll('[data-h]').forEach(x => x.onclick = () => { const v = x.dataset.h; m.onclose = null; m.close(); ok(v === 'z' ? { z: zid } : { h: opts[Number(v)][0] }); });
      });
      m.onclose = () => ok(null);
    });
    if (!pick) return;
    r = await api('mp_cxl_add', { p_train: null, p_day: null, p_form: Number(b.dataset.cxf), p_hours: pick.h || null, p_unko: pick.z || null, p_as: S.as }, '運休にしました');
  }
  if (!r) return;
  await unkoLoad(true); S.dirty = true; if (S.v3) S.v3.dirty = true;
  if (done) done();
}
// 名義を切りかえる（運行情報の対応をえらぶとき）
function setAs(v) { const sel = S.wrap && S.wrap.querySelector('.mp-as'); if (sel && [...sel.options].some(o => o.value === v)) { sel.value = v; if (sel.onchange) sel.onchange(); } }
// 運行情報（国じゅう）：いま乱れている線・3時間以内におわったもの。自分の線なら対応をえらぶ・振替輸送をたのむ
// 運行の乱れを わざと起こす（管理者だけ。t108）：駅・系統・原因・ひどさ・長さ。起きたあとは、ふつうの乱れと同じ（持ち主が対応をえらぶ）
const UNKO_MK = { rail: [['person', '人と接触'], ['sick', '急病のお客さまの救護'], ['car', '車両の点検'], ['signal', '信号の確認'], ['track', '線路内の点検'], ['wind', '強い風'], ['rain', '強い雨'], ['snow', '強い雪'], ['heat', '高温（レール）']],
  air: [['car', '機材の点検・故障'], ['bird', 'バードストライク'], ['rwy', '滑走路の点検'], ['atc', '管制の混雑'], ['sick', '急病のお客さまの救護'], ['wind', '強い横風'], ['rain', '雷雨'], ['snow', '大雪（除雪）'], ['fog', '濃霧'], ['hail', 'ひょう']],
  ship: [['car', 'エンジンの点検・故障'], ['wave', '高波・うねり'], ['sick', '急病のお客さまの救護'], ['wind', '強い風と高い波'], ['fog', '濃霧']],
  bus: [['accident', '交通事故'], ['traffic', '渋滞'], ['car', '車両の点検'], ['sick', '急病のお客さまの救護'], ['wind', '強い風'], ['rain', '大雨（冠水）'], ['snow', '大雪'], ['fog', '濃霧']] };   // 濃霧・高温・ひょう（DB の更新66）
function unkoMake(s) {
  const rts = (s.rt || []);
  const m = modal(['🚦 乱れを起こす（管理者）', `<p class="small" style="margin:0 0 6px"><b>${s.k === 'air' ? '✈' : s.k === 'ship' ? '⚓' : s.k === 'bus' ? '🚏' : '🚉'} <span translate="no">${esc(s.n)}</span>${s.k === 'rail' ? '<span>駅</span>' : ''}</b></p>
    <div class="mp-kv"><b>系統</b><span><select class="mp-inp" data-r><option value="">ここにとまる系統ぜんぶ</option>${rts.map(r => `<option value="${r.id}" translate="no">${esc(r.n)}</option>`).join('')}</select></span>
      <b>原因</b><span><select class="mp-inp" data-k>${(UNKO_MK[s.k] || UNKO_MK.rail).filter(([k]) => (UNKO.wx || 1) >= 2 || !['fog', 'heat', 'hail'].includes(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></span>
      <b>理由</b><span><input class="mp-inp" data-sub maxlength="40" placeholder="空なら原因の名前（例：踏切の安全確認）"></span>
      <b>ひどさ</b><span><select class="mp-inp" data-lv>${[[1, '軽い'], [2, 'ふつう'], [3, '重い']].map(([k, l]) => `<option value="${k}" ${k === 2 ? 'selected' : ''}>${k}　${l}</option>`).join('')}</select> <small class="muted">（持ち主には出しません）</small></span>
      <b>長さ</b><span><input class="mp-inp" data-min type="number" min="3" max="240" value="20" style="width:6em"> 分</span></div>
    <p class="muted small">ふつうの乱れと同じように、持ち主が10分以内に対応をえらびます（えらばないと現場の判断・あとから変えられる）。国・AI の線は、すぐに対応します。続けて何回でも起こせます。</p>
    <div class="mp-row"><button class="btn main" data-go>起こす</button></div>`], b => {
    const k = b.querySelector('[data-k]'), sub = b.querySelector('[data-sub]');
    const syncSub = () => { const wx = ['wind', 'rain', 'snow', 'fog', 'heat', 'hail'].includes(k.value); sub.disabled = wx; sub.placeholder = wx ? '天気のときは、強さから決まります' : '空なら原因の名前（例：踏切の安全確認）'; };
    k.onchange = syncSub; syncSub();
    b.querySelector('[data-go]').onclick = async () => {
      const mins = Math.round(Number(hw(b.querySelector('[data-min]').value)));
      if (!(mins >= 3 && mins <= 240)) return toast('長さは 3〜240分にしてください');
      const rv = b.querySelector('[data-r]').value;
      let r = null;
      try { r = await call('mp_unko_make', { p_sta: s.id, p_route: rv ? Number(rv) : null, p_kind: k.value, p_sub: sub.disabled ? null : sub.value, p_lv: Number(b.querySelector('[data-lv]').value), p_min: mins }); }
      catch (e) { return toast(/Could not find the function|schema cache|does not exist/.test(e.message || '') ? T('サーバーの更新（DB の更新54）のあとで使えます') : errJa(e.message)); }
      toast(T(`運行の乱れを起こしました（${r.routes} 系統。対応をえらぶのは ${r.by}）`));
      m.close(); UNKO.at = -1e9; unkoLoad(true); setTimeout(() => openUnko(r.id), 400);
    };
  });
}
async function openUnko(focus) {
  const m = modal(['🚦 運行情報', '<p class="muted small">読みこんでいます…</p>'], null);
  let first = true;
  const card = ({ z, s }, t) => {
    const rs = (z.routes || []).map(r => `<span class="mp-uk-r"><span style="color:${esc(r.color || '#888')}">■</span> <span translate="no">${esc(r.name)}</span> <small class="muted">${esc(r.own || '')}</small>${r.furi ? ' <small class="mp-tag">振替輸送</small>' : ''}</span>`).join(' ');
    const left = Math.max(0, Math.ceil(((z.until || 0) - (Date.now() / 1000 + UNKO.toff)) / 60));   // のこり時間はサーバーの時計で
    // 範囲（DB の更新60）：乱れの区間だけ（ふだん）・全線
    const zt = [...new Set((z.routes || []).map(r => r.zt).filter(Boolean))].join('・');
    const scope = UNKO.v3 && z.kind !== 'snowstop' && z.me && s.live ? `<div class="small mp-uk-sc"><span>範囲</span>：<label><input type="radio" name="sc${z.id}" value="0" ${z.wide ? '' : 'checked'}><span><span>乱れの区間だけ</span>${zt ? `（<span translate="no">${esc(zt)}</span>）` : ''}</span></label><label><input type="radio" name="sc${z.id}" value="1" ${z.wide ? 'checked' : ''}><span>全線</span></label></div>`
      + (z.mode === 'rail' && 'ori' in z ? `<div class="small mp-uk-sc"><span>区間だけのとき</span>：<label><input type="checkbox" data-ori="${z.id}" ${z.ori ? 'checked' : ''}><span>区間の外は折り返し運転</span></label><label><input type="checkbox" data-det="${z.id}" ${z.det ? 'checked' : ''}><span>ほかの線路で迂回</span></label>
          <br><span class="muted">見合わせのあいだ、折り返し：区間に入るはずの列車も、区間の外だけ走ります。迂回：区間の手前と先の駅をつなぐ ほかの自分の線路があれば、その系統の列車は迂回して走ります（遅れます）</span></div>` : '') : '';
    const ask = z.st !== 'ask' ? '' : z.me ? `<div class="mp-uk-ask"><b>対応をえらんでください</b> <small>（あと <span>${left}分</span>。えらばないと「現場の判断」）</small>
        ${scope}<div class="mp-uk-btns">${unkoOpts(z).map(([k, l]) => `<button class="btn" data-pick="${k}" data-z="${z.id}"><b>${k}</b>　<span>${l}</span></button>`).join('')}</div>
        <details class="small"><summary>運転規制の目安</summary>${unkoRule()}</details></div>`
      : z.can ? `<p class="small">対応をえらぶには、名義を「<span>${esc(z.by)}</span>」にしてください <button class="btn" data-as="${esc(z.can)}">名義を切りかえる</button></p>`
      : `<p class="small muted"><span>${esc(z.by)}</span> が対応を決めています</p>`;
    const stopNow = (z.wins || []).some(w => w[2] === 0 && w[0] <= t + 1 && w[1] > t + 300);
    const furi = (z.routes || []).some(r => r.mine && !r.furi) && stopNow
      ? `<div class="mp-uk-furi"><button class="btn" data-furi="${z.id}">🚌 振替輸送をたのむ</button> <small class="muted">近くのほかの線（鉄道・バス）に、お客をはこんでもらいます（運賃の半分をはらう）。たのまずに合わせて1時間より長く止めると、線の信頼が下がります</small></div>` : '';
    const res = z.kind !== 'snowstop' && z.st !== 'ask' && z.pick ? `<div>対応：<b>${esc((unkoOpts(z).find(q => q[0] === z.pick) || [0, ''])[1])}</b>${z.wide ? '・<b>全線</b>' : ''}${!z.wide && z.det ? '・<b>迂回</b>' : ''}${!z.wide && z.ori ? '・<b>区間の外は折り返し運転</b>' : ''}（<span>${z.auto ? (z.by === '国' ? '国' : '現場の判断') : esc(z.by)}</span>）</div>` : '';
    // 対応を変える（t108）：乱れがつづいているあいだ、自分の線なら何度でも。範囲だけ変えるのも（DB の更新60）
    const chg = UNKO.v2 !== false && z.kind !== 'snowstop' && z.st === 'run' && z.me && s.live ? `<details class="small mp-uk-chg" data-k="chg${z.id}"><summary><b>対応を変える</b></summary>${scope}<div class="mp-uk-btns">${[1, 2, 3, 4, 5].filter(k => k !== z.pick).map(k => `<button class="btn" data-pick="${k}" data-z="${z.id}"><b>${k}</b>　<span>${unkoPickT(k, z.mode)}</span></button>`).join('')}${UNKO.v3 && z.pick ? `<button class="btn" data-pick="${z.pick}" data-z="${z.id}" data-wto="${z.wide ? 0 : 1}"><b>${z.pick}</b>　<span>${unkoPickT(z.pick, z.mode)}</span>（<span>${z.wide ? '範囲を乱れの区間だけにする' : '範囲を全線にする'}</span>）</button>` : ''}${z.mode === 'rail' && 'ori' in z && z.pick && !z.wide ? `<button class="btn" data-pick="${z.pick}" data-z="${z.id}" data-od="1"><b>${z.pick}</b>　<span>${unkoPickT(z.pick, z.mode)}</span>（<span>折り返し・迂回を、えらんだとおりにする</span>）</button>` : ''}</div></details>` : '';
    // 区間（DB の更新60）：そこを通る列車だけ。自分の線なら、列車を1本ずつ・編成ごと運休にできる
    const zone = UNKO.v3 && zt && s.live ? `<div class="small"><span>区間</span>：<span translate="no">${esc(zt)}</span>${z.wide ? '・<b>全線</b>' : '<span class="muted">（ほかの区間の列車は ふだんどおり）</span>'}</div>` : '';
    const cxs = UNKO.v3 && s.live && (z.routes || []).some(r => r.mine) ? `<details class="small mp-uk-cx" data-k="cx${z.id}" data-cxz="${z.id}"><summary><b>🚫 列車を運休にする（1本ずつ・編成ごと）</b></summary><div data-cxl><p class="muted">読みこんでいます…</p></div></details>` : '';
    const log = (z.log || []).filter(l => l[0] <= t + 1).map(l => `<div><small class="muted">${hmA(l[0])}</small> <span>${esc(l[1])}</span></div>`).join('');
    return `<div class="mp-uk mp-uk-${s.k}" data-uz="${z.id}"><div class="mp-uk-rs">${rs}</div>
      <div><b>🚦 <span>${esc(UNKO_K[z.kind] || '')}</span></b>・<span>${esc(z.where || '')}</span> <small class="muted">${hmA(z.t0)}〜</small></div>
      <div class="mp-uk-st">${esc(s.txt)}</div>${zone}${['snowstop', 'stuck', 'volt', 'power'].includes(z.kind) ? `<div class="small">${esc(z.why || '')}</div>` : ''}
      ${z.kind === 'snowstop' && z.me && s.live ? '<div class="mp-uk-ask"><b>雪の対策が足りないため、運休しています</b> <small>（車両の雪の対策・融雪器。対策がすむと、15分ほどで再開します）</small><div class="mp-row" style="margin-top:4px"><button class="btn main" data-snow>❄ 雪の対策</button></div></div>' : ''}${ask}${chg}${furi}${cxs}
      <details class="small"><summary>くわしく</summary>${log}${res}</details>
      <div class="mp-row" style="margin-top:4px"><button class="btn" data-go="${z.id}">🗺 地図で見る</button></div></div>`;
  };
  const draw = async () => {
    await unkoLoad(true);
    if (!document.body.contains(m)) return;
    if (UNKO.off) { m.set('🚦 運行情報', '<p class="small">サーバーの更新（DB の更新51）のあとで使えます。</p>'); return; }
    const opened = new Set([...m.querySelectorAll('details[data-k][open]')].map(x => x.dataset.k));   // 30秒ごとに書きなおしても、開いたところは開いたまま
    const t = Date.now() / 1000, L = UNKO.list.map(z => ({ z, s: unkoState(z, t) })), live = L.filter(o => o.s.live), past = L.filter(o => !o.s.live);   // 列車の位置と同じ、この端末の時計
    m.set('🚦 運行情報', `<p class="muted small" style="margin:0 0 6px">国じゅうの鉄道・バス・船・飛行機の、遅れ・見合わせ・欠航です。自分の線なら、対応をえらべます（あとから変えられます）（🔔でも知らせます）。</p>
      ${UNKO.aioff === true || UNKO.aioff === false ? `<div class="mp-item small" style="margin:0 0 8px"><b>AIの運行の乱れ</b>（<span translate="no">${esc(asName())}</span>）：<b>${UNKO.aioff ? 'オフ' : 'オン'}</b> <button class="btn" style="padding:2px 10px" data-aioff="${UNKO.aioff ? 0 : 1}">${UNKO.aioff ? 'オンにする' : 'オフにする'}</button>
        <br><span class="muted">${UNKO.aioff ? 'この名義の線と駅では、天気や事故・故障などの乱れが自動で起きません。' : '天気や事故・故障などで、遅れや見合わせが自動で起きます（対応は自分でえらべます）。名義（自分・会社）ごとにオフにできます。'}</span></div>` : ''}
      ${live.length ? live.map(o => card(o, t)).join('') : '<p class="small">いま、乱れている線はありません（ふだんどおり運転しています）。</p>'}
      ${past.length ? `<h4 style="margin:12px 0 4px">おわったもの（3時間以内）</h4>${past.map(o => card(o, t)).join('')}` : ''}
      <details class="small" style="margin-top:10px"><summary><b>運転規制の目安</b></summary>${unkoRule()}</details>`, b => {
      b.querySelectorAll('[data-pick]').forEach(x => x.onclick = async () => {
        const k = Number(x.dataset.pick), zid = Number(x.dataset.z), arg = { p_id: zid, p_pick: k, p_as: S.as };
        if (UNKO.v3) {   // 範囲（DB の更新60）：えらんだ丸・「範囲を変える」ボタン
          const card = x.closest('.mp-uk'), rb = card && card.querySelector(`input[name="sc${zid}"]:checked`);
          if (x.dataset.wto != null) arg.p_wide = x.dataset.wto === '1'; else if (rb) arg.p_wide = rb.value === '1';
          const ob = card && card.querySelector(`[data-ori="${zid}"]`), db = card && card.querySelector(`[data-det="${zid}"]`);   // DB の更新82
          if (ob && db) { const wide = arg.p_wide != null ? arg.p_wide : !!(UNKO.list.find(q => q.id === zid) || {}).wide; arg.p_ori = !wide && ob.checked; arg.p_det = !wide && db.checked; }
        }
        const r = await api('mp_unko_pick', arg); if (!r) return;
        const z = UNKO.list.find(q => q.id === zid), o = z && unkoOpts(z).find(q => q[0] === k);
        toast(T(`対応を決めました：${o ? o[1] : k}`) + (r.wide ? T('（全線）') : '') + (r.det ? T('（迂回）') : '') + (r.ori ? T('（区間の外は折り返し運転）') : ''));
        draw();
      });
      // 列車を運休にする（DB の更新60）：開いたら、これから区間を通る自分の列車
      b.querySelectorAll('details[data-cxz]').forEach(dt => {
        const fill = () => cxList(dt, Number(dt.dataset.cxz), () => draw());
        dt.addEventListener('toggle', () => { if (dt.open) fill(); });
        if (opened.has(dt.dataset.k)) { dt.open = true; fill(); }
      });
      b.querySelectorAll('details[data-k]').forEach(dt => { if (!dt.dataset.cxz && opened.has(dt.dataset.k)) dt.open = true; });
      b.querySelectorAll('[data-snow]').forEach(x => x.onclick = () => { m.close(); openSnow(); });   // 冬の運休（t108）
      b.querySelectorAll('[data-furi]').forEach(x => x.onclick = async () => { const r = await api('mp_unko_furi', { p_id: Number(x.dataset.furi), p_as: S.as }); if (r) { toast(T(`振替輸送をたのみました（ほかの ${r.partners} 系統）`)); draw(); } });
      b.querySelectorAll('[data-as]').forEach(x => x.onclick = () => { setAs(x.dataset.as); draw(); });
      b.querySelectorAll('[data-aioff]').forEach(x => x.onclick = async () => {   // AI の運行の乱れ：この名義でオン／オフ（DB の更新73）
        const off = x.dataset.aioff === '1';
        if (off && !confirm(T('AIの運行の乱れをオフにしますか？\nこの名義の線と駅で、天気や事故・故障などの乱れが自動で起きなくなります（いま起きているものは、終わるまでそのまま）'))) return;
        const r = await api('mp_unko_opt', { p_as: S.as, p_off: off }); if (!r) return;
        toast(T(r.aioff ? 'AIの運行の乱れをオフにしました' : 'AIの運行の乱れをオンにしました')); draw();
      });
      b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => {
        const z = UNKO.list.find(q => q.id === Number(x.dataset.go)); if (!z) return;
        m.close(); if (!S.layer.run) setOpt('run', true);
        if (S.v3) { m3Target(z.x / 100, z.y / 100); S.v3.dirty = true; } else setCam(z.x / 100, z.y / 100, Math.max(S.cam.z, 12));
      });
    });
    if (first && focus) { const c = m.querySelector(`[data-uz="${focus}"]`); if (c) { c.classList.add('mp-uk-focus'); c.scrollIntoView({ block: 'center' }); } }
    first = false;
  };
  draw();
  const tmr = setInterval(() => { if (!document.body.contains(m)) return clearInterval(tmr); draw(); }, 30000);
}
// 運行情報の「列車を運休にする」（DB の更新60）：乱れ zid の区間を これから通る自分の列車（3時間先に始発駅を出るものまで・40本まで）。1本ずつ・編成ごと（乱れがおわるまで）
async function cxList(box, zid, redraw) {
  const el2 = box.querySelector('[data-cxl]'); if (!el2) return;
  const z = UNKO.list.find(q => q.id === zid); if (!z) { el2.innerHTML = ''; return; }
  const rs = (z.routes || []).filter(r => r.mine);
  for (const r of rs) {   // ダイヤ（まだ読んでいなければ）
    const R0 = RUN.routes.get(r.id);
    if (!R0 || !R0.tr || !R0.tr.length || R0.loading) { try { const D = await call('mp_dia', { p_route: r.id }); if (D) { RUN.routes.set(r.id, prepRun(D)); RUN.keep.add(r.id); } } catch (e) {} }
  }
  const tm = jstNow(), rows = [];
  for (const r of rs) {
    const R = RUN.routes.get(r.id); if (!R || !R.tr) continue;
    for (const tn of R.tr) {
      const W = unkoTrW(R, tn), Es = W ? W.filter(E => E.id === zid && E.b > tm.abs) : []; if (!Es.length) continue;   // いま・これからの窓だけ
      const len = tn.t1 - tn.t0, za = Math.max(0, Math.min(...Es.map(E => E.zc))), zb = Math.min(len, Math.max(...Es.map(E => E.zb)));   // 区間に入る・出る（始発駅を出てからの秒）
      for (const [day, off] of [[tm.date, 0], [tm.prev, 86400], [tm.next, -86400]]) {
        if (tn.day && tn.day !== day) continue;
        const d0 = tm.day0 - off + tn.t0; if (d0 + zb < tm.abs || d0 > tm.abs + 3 * 3600) continue;   // もう区間を出た列車・3時間より先は出さない
        if (tn.ordd && tn.ordd.get(day) === 'v') continue;   // その日は運転整理の列車が かわりに走る（DB の更新100）
        rows.push({ R, tn, day, d0, za: Es.some(E => E.zb >= 1e8) ? null : d0 + za });
      }
    }
  }
  rows.sort((a, b) => a.d0 - b.d0);
  const fdone = new Set();
  const html = rows.slice(0, 40).map(({ R, tn, day, d0, za }) => {
    const W = unkoTrW(R, tn), k = runOffK(tn, day, d0), c = runCxOf(tn, day, d0), cw = !k && unkoCanW(W, d0, tn.id, tn.t1 - tn.t0);
    const dl = k || cw ? 0 : unkoDlyW(W, d0, Infinity, tn.t1 - tn.t0);   // 終点に着くときの遅れ（見こみ）
    const st = k === 'shop' ? '<b class="mp-late">運休</b><small>（工事中）</small>' : k === 'cxl' ? '<b class="mp-late">運休</b>' : k === 'ordx' ? '<b class="mp-late">運休</b><small>（運転整理）</small>' : cw && cw.k === 'ori' ? '<b class="mp-late">区間運休</b><small>（折り返し運転）</small>'
      : cw ? `<b class="mp-late">運休</b><small>（${cw.k === 'thin' ? '間引き' : '見合わせ'}）</small>`
      : dl >= 60 ? `<span class="mp-late">約${Math.round(dl / 60)}分遅れ</span>` : '<span class="muted">ふだんどおり</span>';
    let bt = '';
    if (c) { if (c[7]) bt = `<button class="btn" data-cxd="${c[0]}">${c[1] != null ? '運休をやめる' : '編成の運休をやめる'}</button>`; }
    else if (k !== 'shop' && k !== 'ordx') {
      bt = `<button class="btn" data-cxa="${tn.id}|${day}">運休</button>`;
      if (tn.form != null && !fdone.has(tn.form) && !runCxForm(tn)) { fdone.add(tn.form); bt += `<button class="btn" data-cxg="${tn.form}" data-fn="${esc(tn.fname || '')}">${R.k === 'rail' ? '編成ごと' : '車両ごと'}</button>`; }
    }
    return `<div class="mp-uk-tr"><span class="t">${hmA(d0)}</span> <b translate="no">${esc(runName(tn, R.k))}</b> <span>${esc(runDest(R, tn))}行き</span>${tn.fname ? ` <small class="muted" translate="no">${esc(tn.fname)}</small>` : ''}${za != null ? ` <small class="muted">（<span>区間 ${hmA(za)}</span>）</small>` : ''} ${st}<span class="b">${bt}</span></div>`;
  }).join('');
  el2.innerHTML = rows.length ? `<p class="muted" style="margin:4px 0">これから区間を通る列車です（左は始発駅を出る時刻。3時間先まで）。「編成ごと」は、この乱れがおわるまで、その編成が入る列車をぜんぶ運休にします。運休にした列車は運賃が入りません。</p>${html}${rows.length > 40 ? `<p class="muted">ほか ${rows.length - 40}本</p>` : ''}`
    : '<p class="muted" style="margin:4px 0">これから区間を通る自分の列車は、3時間先までありません。</p>';
  el2.querySelectorAll('[data-cxa],[data-cxd]').forEach(x => x.onclick = async () => {
    const o = rows.find(q => x.dataset.cxa ? q.tn.id === Number(x.dataset.cxa.split('|')[0]) : true);
    let r = null;
    if (x.dataset.cxd) r = await api('mp_cxl_del', { p_id: Number(x.dataset.cxd), p_as: S.as }, '運休をやめました');
    else { const [tid, day] = x.dataset.cxa.split('|'); r = await api('mp_cxl_add', { p_train: Number(tid), p_day: day, p_form: null, p_hours: null, p_unko: zid, p_as: S.as }, `運休にしました（${o ? runName(o.tn, o.R.k) : ''}）`); }
    if (r) { await unkoLoad(true); redraw(); }
  });
  el2.querySelectorAll('[data-cxg]').forEach(x => x.onclick = async () => {
    if (!confirm(T(`編成「${x.dataset.fn}」が入る列車を、この運行の乱れがおわるまで、ぜんぶ運休にします。よろしいですか？`))) return;
    const r = await api('mp_cxl_add', { p_train: null, p_day: null, p_form: Number(x.dataset.cxg), p_hours: null, p_unko: zid, p_as: S.as }, '編成ごと運休にしました');
    if (r) { await unkoLoad(true); redraw(); }
  });
}
// 列車・バスをさがす・しぼりこむ（🔍 → 列車・バス）。いま走っているものを、系統ごとに
async function runAllIds() {
  if (!RUN.noPub) { try { const r = await call('mp_routes_pub', {}); if (Array.isArray(r)) return { ids: r.map(x => x.id), all: true }; } catch (e) { RUN.noPub = true; } }   // サーバーの更新の前は、1回だけためす
  // サーバーの更新の前：読んだところ（見えていないところも）の駅・港・空港を通る系統
  const ids = new Set();
  for (const c of S.cells.values()) { const d = c && c.data; if (!d) continue; for (const s of d.stas || []) for (const r of (s.rt || [])) ids.add(r.id); for (const l of d.lanes || []) ids.add(l.id); }
  for (const id of RUN.routes.keys()) ids.add(id);
  return { ids: [...ids], all: false };
}
function openRunFind() {
  if (!S.layer.run) setOpt('run', true);
  const st = { q: '', all: null, prog: '', tmr: 0, qt: 0, shown: [] };
  const m = modal(['🔍 列車・バスをさがす', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  m.onclose = () => { clearInterval(st.tmr); clearTimeout(st.qt); };
  const loadAll = async () => {
    const r = await runAllIds(); st.all = r.all;
    for (const id of r.ids) RUN.keep.add(id);
    const q = r.ids.filter(id => { const R = RUN.routes.get(id); return !R || (!R.loading && now() - R.at >= 600000); });
    let done = r.ids.length - q.length, last = 0;
    const tick = () => { st.prog = `${done} / ${r.ids.length}`; if (now() - last > 700) { last = now(); drawAll(); } };
    const work = async () => { while (q.length) { const id = q.shift(); try { const D = await call('mp_dia', { p_route: id }); if (D) RUN.routes.set(id, prepRun(D)); } catch (e) {} done++; tick(); } };
    tick();
    await Promise.all([work(), work(), work()]);
    st.prog = ''; if (document.body.contains(m)) drawAll(); S.dirty = true; if (S.v3) S.v3.dirty = true;
  };
  const routesNow = () => [...RUN.routes.values()].filter(R => R.tr && R.st && R.st.length).sort((a, b) => a.k.localeCompare(b.k) || a.n.localeCompare(b.n, 'ja'));
  // 一覧（さがすことば・しぼりこみのとおり）
  const drawList = () => {
    const res = m.querySelector('[data-res]'); if (!res) return;
    const tm = jstNow(), it = S.vis || visibleItems(), q = hw(st.q).trim().toLowerCase(), L = [];
    for (const R of routesNow()) {
      if (!runPass(R)) continue;
      for (const tn of R.tr) {
        if (!runPass(R, tn)) continue;
        const p = runPos(R, tn, tm, it); if (!p) continue;
        if (q) { const hay = [tn.num, tn.kind, kindL(tn.kind), R.n, runDest(R, tn), tn.fname, tn.onum, ...tn.s.map(e => R.sn.get(e[0]) || '')].join(' ').toLowerCase(); if (!hay.includes(q)) continue; }
        L.push({ R, tn, p });
      }
    }
    const where = o => { const R = o.R, sc = o.tn.s, nm = i => esc(R.sn.get(sc[i][0]) || ''); return (o.p.dl >= 60 ? `<b class="mp-late">+${Math.round(o.p.dl / 60)}分</b> ` : '') + (o.p.at >= 0 ? `<span>${o.p.at === sc.length - 1 ? `${nm(o.p.at)}着` : `${nm(o.p.at)}に停車中`}</span>` : `<span>${nm(o.p.nx - 1)}</span> → <span>${nm(o.p.nx)}</span>`); };
    st.shown = L.slice(0, 300);
    res.innerHTML = `<p class="small" style="margin:4px 0"><b><span>いま走っている</span> <span>${L.length}本</span></b>${L.length > st.shown.length ? `（<span>はじめの</span> <span>${st.shown.length}本</span>）` : ''}</p>
      <div class="mp-list">${st.shown.map((o, i) => `<button class="mp-item" style="text-align:left" data-i="${i}"><b><span style="color:${esc(o.R.c)}">■</span> <span translate="no">${esc(runName(o.tn, o.R.k))}</span></b> → <span>${esc(runDest(o.R, o.tn))}</span>
          <br><small><span>${esc(o.R.n)}</span>・${where(o)}${o.tn.fname ? `・<span>${esc(o.tn.fname)}</span>` : ''}</small></button>`).join('') || '<p class="muted small">条件にあう列車・バスは、いま走っていません</p>'}</div>`;
    res.querySelectorAll('[data-i]').forEach(x => x.onclick = () => {
      const o = st.shown[Number(x.dataset.i)]; m.close();
      const p = runPos(o.R, o.tn, jstNow(), S.vis || visibleItems()) || o.p;
      if (S.v3) { m3Target(p.x, p.y); S.v3.dirty = true; } else setCam(p.x, p.y, Math.max(S.cam.z, 14));
      RUN.keep.add(o.R.id); showTrain(o.R, o.tn);
    });
  };
  // ぜんぶ（しぼりこみのボタン・入力・一覧）
  const drawAll = () => {
    if (!document.body.contains(m)) return;
    const f = RUN.f, routes = routesNow();
    const kinds = [...new Set(routes.flatMap(R => R.tr.map(t => t.kind)).filter(Boolean))].sort((a, b) => (KINDS.indexOf(a) + 1 || 99) - (KINDS.indexOf(b) + 1 || 99) || a.localeCompare(b, 'ja'));
    const ch = (g, v, label, on) => `<button data-${g}="${esc(String(v))}" class="${on ? 'on' : ''}">${label}</button>`;
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-q]');
    m.set('🔍 列車・バスをさがす', `<div class="mp-row" style="margin-top:0"><input class="mp-inp" data-q style="flex:1 1 180px" placeholder="列車番号・系統・種別・行き先・駅名" value="${esc(st.q)}" enterkeyhint="search" autocomplete="off"></div>
      <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">種類</span><span class="mp-seg" style="flex-wrap:wrap">${['rail', 'bus', 'ship', 'air'].map(k => ch('fk', k, `${RUN_IC[k]} <span>${RUN_K[k]}</span>`, f.k.includes(k))).join('')}</span></div>
      <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">向き</span><span class="mp-seg">${ch('fd', 0, 'すべて', !f.dir)}${ch('fd', 1, '下り', f.dir === 1)}${ch('fd', -1, '上り', f.dir === -1)}</span></div>
      <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">系統</span><select class="mp-inp" style="width:auto;max-width:70%" data-fr><option value="0">すべて</option>${routes.map(R => `<option value="${R.id}" ${f.rid === R.id ? 'selected' : ''}>${RUN_IC[R.k] || ''} ${esc(R.n)}</option>`).join('')}</select></div>
      <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">種別</span><select class="mp-inp" style="width:auto" data-fkd><option value="">すべて</option>${kinds.map(k => `<option value="${esc(k)}" ${f.kind === k ? 'selected' : ''}>${esc(kindL(k))}</option>`).join('')}</select>
        ${runFiltered() ? '<button class="btn" data-fx style="padding:4px 10px;font-size:12px">しぼりこみをやめる</button>' : ''}</div>
      <p class="muted small" style="margin:4px 0"><span>しぼりこみは地図にも出ます（地図には、えらんだものだけ）。</span>${st.prog ? `<span>系統を読んでいます</span> <span>${st.prog}</span>` : st.all === false ? '<span>いまは、地図で読んだあたりの系統だけです（サーバーの更新のあとは、国じゅうからさがせます）</span>' : ''}</p>
      <div data-res></div>`, b => {
      const inp = b.querySelector('[data-q]');
      inp.oninput = () => { st.q = inp.value; clearTimeout(st.qt); st.qt = setTimeout(drawList, 250); };
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); drawList(); } };
      if (typing) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      const set = c => { runSetF(Object.assign({}, RUN.f, c)); drawAll(); };
      b.querySelectorAll('[data-fk]').forEach(x => x.onclick = () => { const k = x.dataset.fk, ks = RUN.f.k.includes(k) ? RUN.f.k.filter(y => y !== k) : [...RUN.f.k, k]; set({ k: ks.length ? ks : [k] }); });
      b.querySelectorAll('[data-fd]').forEach(x => x.onclick = () => set({ dir: Number(x.dataset.fd) }));
      b.querySelector('[data-fr]').onchange = e => set({ rid: Number(e.target.value) });
      b.querySelector('[data-fkd]').onchange = e => set({ kind: e.target.value });
      const fx = b.querySelector('[data-fx]'); if (fx) fx.onclick = () => { runSetF({ k: ['rail', 'bus', 'ship', 'air'], dir: 0, kind: '', rid: 0 }); drawAll(); };
    });
    drawList();
  };
  drawAll(); loadAll();
  st.tmr = setInterval(() => { if (!document.body.contains(m)) { clearInterval(st.tmr); return; } drawList(); }, 10000);   // 10秒ごとに「いま」を書きなおす
}

/* ---------- 天気（t62）：季節・時刻・場所で決まる（map/wx.js。だれが見ても同じ）。
   左下：地図のまん中の天気（タップでくわしく）。場所・駅・列車のシートにも「天気」 ---------- */
const WXS = { t: 0, key: '' };
const wxOk = () => !!window.MapWx;
// 標高（天気用）：読んだマスはそのまま。ほかは地形の式（worldgen）で、32マスごとにおぼえる
const WXE = new Map();
function wxElev(x, y) {
  const t = tileAt(Math.floor(x), Math.floor(y)); if (t) return t.e > 0 ? t.e : 0;
  if (!inWorld(Math.floor(x / CS), Math.floor(y / CS))) return 0;   // 国の外は海
  if (!inOldBox(x, y)) return 0;   // 5×5 の新しい土地で、まだ読んでいないところ（worldgen.js の地形ではないので）
  if (!WG && window.MapGen) WG = MapGen.world();
  if (!WG) return 0;
  const qx = Math.round(x / 32), qy = Math.round(y / 32), k = qx + ',' + qy;
  let e = WXE.get(k);
  if (e === undefined) { try { e = Math.max(0, WG.cell(qx * 32, qy * 32).e || 0); } catch (er) { e = 0; } if (WXE.size > 30000) WXE.clear(); WXE.set(k, e); }
  return e;
}
function wxCenter() { return S.v3 && Number.isFinite(S.v3.tx) && Number.isFinite(S.v3.ty) ? [S.v3.tx, S.v3.ty] : [S.cam.x, S.cam.y]; }
const wxT = v => (Math.round(v * 10) / 10).toFixed(1).replace('-', '−') + '℃';
const wxD = v => String(v).replace('-', '−') + '℃';
function wxStep() {
  const t = now(); if (t - WXS.t < 500) return; WXS.t = t;
  if (S.layer.wxmap) { const k = wxKey(); if (WXL.c && WXL.c.key !== k) S.dirty = true; wxBarSync(); }
  const b = S.wrap && S.wrap.querySelector('.mp-wx'); if (!b) return;
  if (!S.wx || !wxOk()) { b.hidden = true; return; }
  const [x, y] = wxCenter(), ld = tileAt(Math.floor(x), Math.floor(y)) ? 1 : 0;
  const key = Math.round(x / 4) + ',' + Math.round(y / 4) + ',' + Math.floor(Date.now() / 60000) + ',' + ld;   // まん中が動いた・1分たった・地形を読んだ
  if (key === WXS.key && !b.hidden) return; WXS.key = key;
  const w = MapWx.now(x, y, wxElev(x, y));
  b.innerHTML = `<span>${w.ic}</span> <b>${wxT(w.T)}</b>${w.snow > 0 ? ` <small>⛄${w.snow}cm</small>` : ''}`;
  b.title = T(w.nm); b.hidden = false;
}
// シートの「天気」の行の中み
function wxInner(x, y, e) {
  const w = MapWx.now(x, y, e == null ? wxElev(x, y) : e);
  return `${w.ic} <span>${w.nm}</span>・<b>${wxT(w.T)}</b> <small class="muted">（<span>最高 ${wxD(w.hi)}</span>・<span>最低 ${wxD(w.lo)}</span>）</small>${w.snow > 0 ? `・<span>積雪 ${w.snow}cm</span>` : ''}${wxWind(w)}${w.vis != null && w.vis < 1000 ? `・<span>見通し ${w.vis}m</span>` : ''} <a href="#" data-wx="${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}">くわしく</a>`;
}
// 風（と強い雨）のことば：風 北西 5m/s（最大瞬間 8m/s）
function wxWind(w, long) {
  if (w.ws == null) return '';
  const g = w.wg >= 15 || long ? `<small class="muted">（<span>最大瞬間 ${w.wg}m/s</span>）</small>` : '';
  return `・<span>風 ${w.wd} ${w.ws}m/s</span>${g}${w.mm >= 10 ? `・<span>1時間に ${Math.round(w.mm)}mm</span>` : ''}${w.cm >= 2 ? `・<span>1時間に ${Math.round(w.cm)}cm の雪</span>` : ''}`;
}
function wxRow(x, y, e) { return S.wx && wxOk() ? `<b>天気</b><span>${wxInner(x, y, e)}</span>` : ''; }
// くわしく：いま・3時間ごと・これから4日
async function openWx(x, y) {
  if (!wxOk()) return;
  const e = wxElev(x, y), w = MapWx.now(x, y, e), hs = MapWx.hours(x, y, e, 8, 3), ds = MapWx.days(x, y, e, 4), al = MapWx.alerts ? MapWx.alerts(x, y, e) : [];
  const WD = '日月火水木金土', dl = (d, i) => { if (i === 0) return 'きょう'; if (i === 1) return 'あした'; const j = new Date(d.date + 9 * 3600000); return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日（${WD[j.getUTCDay()]}）`; };
  const m = modal(['🌤 天気', `<p class="small" style="margin:0"><b data-wxa translate="no">${Math.floor(x)}, ${Math.floor(y)}</b>${e > 0 ? ` <small class="muted">（標高 約${Math.round(e)}m）</small>` : ''}</p>
    <div class="mp-wxnow"><span class="ic">${w.ic}</span><b>${wxT(w.T)}</b><span>${w.nm}</span></div>
    ${al.length ? `<div class="mp-wxal">${al.map(a => `<span class="lv${a.lv}">${a.nm}</span>`).join('')}</div>` : ''}
    <div class="mp-kv"><b>きょう</b><span><span>最高 ${wxD(w.hi)}</span>・<span>最低 ${wxD(w.lo)}</span></span>${w.snow > 0 ? `<b>積雪</b><span>${w.snow}cm</span>` : ''}${w.ws != null ? `<b>風</b><span><span>${w.wd} ${w.ws}m/s</span> <small class="muted">（<span>最大瞬間 ${w.wg}m/s</span>）</small></span>` : ''}${w.mm > 0 ? `<b>雨</b><span>1時間に ${w.mm}mm</span>` : ''}${w.cm > 0 ? `<b>雪</b><span>1時間に ${w.cm}cm</span>` : ''}${w.vis != null && w.vis < 5000 ? `<b>見通し</b><span>${w.vis}m</span>` : ''}</div>
    <h4 style="margin:10px 0 4px">3時間ごと</h4>
    <div class="mp-wxh">${hs.map(h => `<div><small>${h.hr}時</small><span>${h.ic}</span><b>${wxD(Math.round(h.T))}</b></div>`).join('')}</div>
    <h4 style="margin:10px 0 4px">これからの天気</h4>
    <div class="mp-wxd">${ds.map((d, i) => `<div><small>${dl(d, i)}</small><span class="ic">${d.ic}</span><span>${d.nm}</span><b>${wxD(d.hi)}</b><small>${wxD(d.lo)}</small>${d.tags && d.tags.length ? `<em>${d.tags.map(t => `<span>${t}</span>`).join('・')}</em>` : ''}</div>`).join('')}</div>
    <p class="muted small"><span>国土の天気は、季節・時刻・場所で決まります（だれが見ても同じです）。</span><span>北ほど寒く、北の冬は雪がよく降ります。南は暖かく、高いところほど寒くなります（100mで約0.65℃）。</span><span>風は、等圧線がこんでいるところ・強い雨のところで強くなります。強い風・雨・雪のときは、列車が遅れたり止まったりします。</span><span>ときどき変な天気もあります：冬の寒波（首都でも雪が積もる）・季節外れの雪・夏の猛暑・台風（6〜11月）・ゲリラ豪雨・ひょう・竜巻・朝の濃霧・春の黄砂。</span></p>`], null);
  const d = await api('mp_spot', { p_x: Math.floor(x * 5), p_y: Math.floor(y * 5) });
  const a = m.querySelector('[data-wxa]'); if (a && d && d.addr) a.textContent = d.addr.text;
}

/* ---------- 渋滞（2026-11-02・DB の更新67）：サーバーが5分ごとに決める（通勤・休日・帰省・まちの人の多さ・車線・天気・事故・工事）。
   層「🚗 渋滞」：見えているところの道を色で（オレンジ 混雑・赤 渋滞・黒の点線 通行止め）。とても遠いときは まとまりを点で。
   ≡ →「🚗 渋滞情報」：道ごと・場所ごとの一覧。サーバーの更新（DB の更新67）の前は、ボタンを出さない ---------- */
const JAM = { m: new Map(), t: -1e9, box: null, busy: false, off: false, ok: false, at: 0, list: null, lt: 0 };
const JAM_C = ['', '#ff8a00', '#e0201b', '#222'], JAM_N = ['', '混雑', '渋滞', '通行止め'];
function jamStep() {
  if (!S.layer.jam || JAM.off || JAM.busy) return;
  const v = view(), far = S.cam.z < Z_FAR;
  const inBox = far ? !!JAM.list : JAM.box && v.x0 >= JAM.box[0] && v.y0 >= JAM.box[1] && v.x1 <= JAM.box[2] && v.y1 <= JAM.box[3];
  if (inBox && now() - JAM.t < 60000) return;
  if (!inBox && now() - JAM.t < 1200) return;   // うごかしているあいだは、少し待つ
  jamLoad();
}
async function jamLoad() {
  if (JAM.off || JAM.busy) return;
  JAM.busy = true; JAM.t = now();
  const v = view(), w = v.x1 - v.x0, h = v.y1 - v.y0, far = S.cam.z < Z_FAR;
  try {
    if (far) {   // とても遠い：まとまり（一覧）だけ
      const d = await call('mp_jam_list', { p_n: 50 });
      JAM.list = d; JAM.at = d && d.at; JAM.lt = now();
    } else {
      const box = [v.x0 - w * 0.6, v.y0 - h * 0.6, v.x1 + w * 0.6, v.y1 + h * 0.6];
      const d = await call('mp_jam_now', { p_x0: box[0], p_y0: box[1], p_x1: box[2], p_y1: box[3] });
      const m = new Map(); for (const [id, lv] of (d && d.s) || []) m.set(id, lv);
      JAM.m = m; JAM.box = box; JAM.at = d && d.at;
    }
    JAM.ok = true; S.dirty = true; jamBarSync();
  } catch (e) { if (/Could not find|schema cache|does not exist/i.test((e && e.message) || '')) { JAM.off = true; jamBtnSync(); } }
  finally { JAM.busy = false; }
}
// サーバーに渋滞があるか（地図を開いたとき1回）：なければボタンを出さない
async function jamProbe() {
  if (JAM.ok || JAM.off) return jamBtnSync();
  try { await call('mp_jam_now', { p_x0: 0, p_y0: 0, p_x1: 1, p_y1: 1 }); JAM.ok = true; }
  catch (e) { if (/Could not find|schema cache|does not exist/i.test((e && e.message) || '')) JAM.off = true; }
  jamBtnSync();
}
function jamBtnSync() {
  const b = S.wrap && S.wrap.querySelector('[data-lay="jam"]'); if (b) b.hidden = !JAM.ok || JAM.off;
  if (JAM.off && S.layer.jam) { S.layer.jam = false; S.dirty = true; }
  jamBarSync();
}
function drawJam(g, roads, z, far) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  if (far) {   // とても遠い：道ごとのまとまりを点で（ひどいほど大きく）
    const L = (JAM.list && JAM.list.list) || [];
    for (const q of L) {
      const x = sx(q.x), y = sy(q.y); if (x < -10 || y < -10 || x > S.W + 10 || y > S.H + 10) continue;
      const r = q.lv >= 3 ? 6 : q.lv === 2 ? 4 + Math.min(4, q.km / 3) : 3;
      g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = JAM_C[Math.min(3, q.lv)]; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
    }
  } else if (JAM.m.size) {
    for (const s of roads) {
      const lv = JAM.m.get(s.id); if (!lv) continue;
      const w = Math.max(2.6, Math.min(9, s.w * z * 0.75));
      g.setLineDash(lv >= 3 ? [w * 1.6, w * 1.2] : []);
      g.strokeStyle = 'rgba(60,25,10,.55)'; g.lineWidth = w + 2; pathSeg(g, s); g.stroke();
      g.strokeStyle = JAM_C[Math.min(3, lv)]; g.lineWidth = w; g.stroke();
    }
    g.setLineDash([]);
  }
  g.restore();
}
// 層の下の帯：色の見かた・時刻・一覧
function jamBarSync() {
  if (!S.wrap) return;
  let b = S.wrap.querySelector('.mp-jbar');
  const on = !!S.layer.jam && !JAM.off && !S.v3;
  if (!b) { if (!on) return; b = document.createElement('div'); b.className = 'mp-jbar'; S.wrap.appendChild(b); b.onclick = e => { if (e.target.closest('[data-jl]')) openJamList(); }; }
  b.hidden = !on; if (!on) return;
  const k = (JAM.at || 0) + '|' + (S.cam.z < Z_FAR ? 1 : 0); if (b.dataset.k === k) return; b.dataset.k = k;
  b.innerHTML = `🚗 <span><i style="background:${JAM_C[1]}"></i>混雑</span><span><i style="background:${JAM_C[2]}"></i>渋滞</span><span><i style="background:${JAM_C[3]}"></i>通行止め</span>${JAM.at ? `<small>${hmA(JAM.at)}</small>` : ''}<button type="button" data-jl>一覧</button>`;
}
// 渋滞情報（一覧）
async function openJamList() {
  const m = modal(['🚗 渋滞情報', '<p class="muted small">読みこんでいます…</p>'], null);
  let d;
  try { d = await call('mp_jam_list', { p_n: 50 }); }
  catch (e) { m.set('🚗 渋滞情報', `<p class="small">${/Could not find|schema cache|does not exist/i.test((e && e.message) || '') ? 'サーバーの更新（DB の更新67）のあとで使えます。' : esc(e.message)}</p>`); return; }
  const s = (d && d.sum) || {}, L = (d && d.list) || [];
  const rows = L.map(q => `<button class="mp-item mp-jrow" data-x="${q.x}" data-y="${q.y}"><span class="lv" style="background:${JAM_C[Math.min(3, q.lv)]}">${JAM_N[Math.min(3, q.lv)]}</span><span class="t"><b translate="no">${esc(q.nm)}</b> <span translate="no">${esc(q.pl)}</span><span>付近</span><br><small><span>${q.km}km</span>・<span>${esc(q.why)}</span>${q.t0 ? `・<span>${hmA(q.t0)} から</span>` : ''}</small></span></button>`).join('');
  m.set('🚗 渋滞情報', `<p class="small" style="margin:0 0 6px">${d && d.at ? `<b>${hmA(d.at)}</b> <span>現在</span>：` : ''}<span>渋滞 ${s.k2 || 0}km</span>・<span>混雑 ${s.k1 || 0}km</span>${s.n3 ? `・<span>通行止め ${s.n3}か所</span>` : ''}${d && d.bus ? `・<span>渋滞で遅れているバス ${d.bus}系統</span>` : ''}</p>
    <div class="mp-jlist">${rows || '<p class="muted small">いま、目立つ渋滞はありません。</p>'}</div>
    <div class="mp-row"><button class="btn" data-lay>🚗 地図で渋滞を見る</button></div>
    <p class="muted small"><span>5分ごとに新しくなります。</span><span>平日の朝夕・休日の昼すぎ・帰省のころ（正月・GW・お盆）の高速・雨や雪の日・事故・夜の工事で混みます。</span><span>高速は、強風・大雨・大雪で通行止めになります。</span><span>バスは、通る道が混むと遅れます（🚦 運行情報）。トラックは、営業所のまわりが混むと運べる量がへります。</span></p>`, b => {
    b.querySelectorAll('[data-x]').forEach(x => x.onclick = () => { m.close(); if (!S.layer.jam) setOpt('jam', true); if (S.v3) { m3Target(Number(x.dataset.x), Number(x.dataset.y)); S.v3.dirty = true; } else setCam(Number(x.dataset.x), Number(x.dataset.y), Math.max(S.cam.z, 1.5)); });
    b.querySelector('[data-lay]').onclick = () => { m.close(); if (!S.layer.jam) setOpt('jam', true); };
  });
}

/* ---------- 救急（2026-11-02・DB の更新68）：119番 → 近くの病院の救急車（なければ消防署・市区町村の消防）が出動 → 病院へ運ぶ。
   層「🚑 救急」：いま出ている救急車（むかう・手当て・病院へ・もどる）。≡ →「🚑 救急情報」。病院・消防署の建物の画面に救急車の台数など ---------- */
const ER = { list: [], t: -1e9, dt: 0, busy: false, off: false, ok: false, toff: 0 };
const ER_K = ['erhosp', 'bighosp', 'hospital', 'firest'], ER_SEV = ['', '軽症', '中等症', '重症'];
const q0 = (b, k) => b.querySelector(k);
function erStep() {
  if (!S.layer.er || ER.off) return;
  if (!ER.busy && now() - ER.t > 30000) erLoad();
  if (ER.list.length && now() - ER.dt > 250) { ER.dt = now(); S.dirty = true; }   // うごかす
}
async function erLoad() {
  if (ER.off || ER.busy) return;
  ER.busy = true; ER.t = now();
  try {
    const d = await call('mp_er_now', { p_x0: null, p_y0: null, p_x1: null, p_y1: null });
    ER.list = (d && d.list) || []; ER.toff = d && d.now ? d.now - Date.now() / 1000 : 0; ER.ok = true; S.dirty = true;
  } catch (e) { if (/Could not find|schema cache|does not exist/i.test((e && e.message) || '')) { ER.off = true; erBtnSync(); } }
  finally { ER.busy = false; }
}
async function erProbe() {   // サーバーに救急があるか（地図を開いたとき1回。あれば、そのまま読む）
  if (!ER.ok && !ER.off) await erLoad();
  erBtnSync();
}
function erBtnSync() {
  const b = S.wrap && S.wrap.querySelector('[data-lay="er"]'); if (b) b.hidden = !ER.ok || ER.off;
  if (ER.off && S.layer.er) { S.layer.er = false; S.dirty = true; }
}
// いまの救急車の場所（マス）と、ようす（0 出る前・1 むかっている・2 手当て・3 病院へ・4 もどる）
function erPos(e, t) {
  const x = e[1] / 100, y = e[2] / 100, ux = e[3] / 100, uy = e[4] / 100, hx = e[5] / 100, hy = e[6] / 100, [t0, t1, t2, t3, t4] = [e[7], e[8], e[9], e[10], e[11]];
  const L = (ax, ay, bx, by, p) => [ax + (bx - ax) * Math.max(0, Math.min(1, p)), ay + (by - ay) * Math.max(0, Math.min(1, p))];
  if (t < t0 + 60) return [ux, uy, 0];
  if (t < t1) return [...L(ux, uy, x, y, (t - t0 - 60) / Math.max(1, t1 - t0 - 60)), 1];
  if (t < t2) return [x, y, 2];
  if (t < t3) return [...L(x, y, hx, hy, (t - t2) / Math.max(1, t3 - t2)), 3];
  if (t < t4) { const away = Math.hypot(hx - ux, hy - uy) > 1; return away ? [...L(hx, hy, ux, uy, (t - t3 - 600) / Math.max(1, t4 - t3 - 600)), 4] : [hx, hy, 4]; }
  return null;
}
function drawEr(g, z) {
  if (!ER.list.length) return;
  const t = Date.now() / 1000 + ER.toff;
  g.save(); g.lineCap = 'round';
  for (const e of ER.list) {
    const p = erPos(e, t); if (!p) continue;
    const x = sx(p[0]), y = sy(p[1]), st = p[2];
    if (st <= 2) { const cx = sx(e[1] / 100), cy = sy(e[2] / 100); g.strokeStyle = 'rgba(220,30,30,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 8, 0, 2 * Math.PI); g.stroke(); }   // よばれた場所
    const tg = st === 1 ? [e[1] / 100, e[2] / 100] : st === 3 ? [e[5] / 100, e[6] / 100] : null;   // 行き先
    if (tg) { g.setLineDash([4, 4]); g.strokeStyle = 'rgba(220,30,30,.65)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(sx(tg[0]), sy(tg[1])); g.stroke(); g.setLineDash([]); }
    if (x < -20 || y < -20 || x > S.W + 20 || y > S.H + 20) continue;
    const blink = (st === 1 || st === 3) && Math.floor(t * 2) % 2 === 0;   // サイレン
    g.fillStyle = '#fff'; g.strokeStyle = blink ? '#ff1a1a' : '#b71c1c'; g.lineWidth = blink ? 2.6 : 1.6;
    g.beginPath(); if (g.roundRect) g.roundRect(x - 9, y - 6.5, 18, 13, 3); else g.rect(x - 9, y - 6.5, 18, 13); g.fill(); g.stroke();
    g.fillStyle = '#c62828'; g.fillRect(x - 1.3, y - 4.3, 2.6, 8.6); g.fillRect(x - 4.3, y - 1.3, 8.6, 2.6);
  }
  g.restore();
}
const erSt = (q, t) => t < q.t1 ? `<span>出動中</span>（<span translate="no">${esc(q.un)}</span>）` : t < q.t1 + 600 + 120 * q.sev ? '<span>現場で手当て中</span>'
  : t < q.t3 ? `<span translate="no">${esc(q.hn)}</span><span>へ搬送中</span>` : `<span translate="no">${esc(q.hn)}</span><span>に到着</span>`;
// 救急情報（一覧）
async function openErList() {
  const m = modal(['🚑 救急情報', '<p class="muted small">読みこんでいます…</p>'], null);
  let d;
  try { d = await call('mp_er_list', { p_n: 50 }); }
  catch (e) { m.set('🚑 救急情報', `<p class="small">${/Could not find|schema cache|does not exist/i.test((e && e.message) || '') ? 'サーバーの更新（DB の更新68）のあとで使えます。' : esc(e.message)}</p>`); return; }
  const td = (d && d.today) || {}, L = (d && d.list) || [], t = (d && d.now) || Date.now() / 1000;
  const whys = Object.entries(td.why || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k)} ${v}</span>`).join('・');
  const rows = L.map(q => `<button class="mp-item mp-jrow" data-x="${q.x}" data-y="${q.y}"><span class="lv" style="background:${q.sev >= 3 ? '#b71c1c' : q.sev === 2 ? '#e65100' : '#6d7a86'}">${ER_SEV[q.sev]}</span><span class="t"><b>${hmA(q.t0)}</b> <span translate="no">${esc(q.pl)}</span>・<span>${esc(q.why)}</span><br><small>${erSt(q, t)}</small></span></button>`).join('');
  m.set('🚑 救急情報', `<p class="small" style="margin:0 0 6px"><b>きょう ${td.n || 0}件</b>${whys ? `（${whys}）` : ''}${td.sev3 ? `・<span>重症 ${td.sev3}件</span>` : ''}${td.busy ? `・<span>いま出ている救急車 ${td.busy}台</span>` : ''}</p>
    <div class="mp-jlist">${rows || '<p class="muted small">この3時間の出動はありません。</p>'}</div>
    <div class="mp-row"><button class="btn" data-lay>🚑 地図で救急車を見る</button></div>
    <p class="muted small"><span>119番によばれると、近くの病院（救急病院・大病院・総合病院）の救急車が出動して、病院へ運びます。</span><span>病院の救急車がないときは、消防署か市区町村の消防の救急車が出て、近くの病院へ運びます。</span><span>猛暑の日は熱中症、雪の日は転倒、台風のときはけが、道路の事故のときは交通事故が ふえます。道が混んでいると救急車も遅れます。</span><span>運ばれた病院には、救急の患者の分の売上が入ります（軽症 2万・中等症 5万・重症 12万 X）。</span></p>`, b => {
    b.querySelectorAll('[data-x]').forEach(x => x.onclick = () => { m.close(); if (!S.layer.er) setOpt('er', true); if (S.v3) { m3Target(Number(x.dataset.x), Number(x.dataset.y)); S.v3.dirty = true; } else setCam(Number(x.dataset.x), Number(x.dataset.y), Math.max(S.cam.z, 1.5)); });
    b.querySelector('[data-lay]').onclick = () => { m.close(); if (!S.layer.er) setOpt('er', true); };
  });
}
// メインと情報の「交通・天気・救急」から（2026-11-02）：渋滞・救急の層をつけて、その場所へ（場所がなければ、層をつけるだけ）
function layAt(k, L, z) {
  const x = Number(L && L.x), y = Number(L && L.y);
  if (L && L.x != null && isFinite(x) && isFinite(y)) setCam(x, y, z);
  if (!S.layer[k]) setOpt(k, true);
}
// 建物の画面：救急車の台数・出ている台数・きょう運ばれた患者（病院を動かしている人には売上も）
async function erBldFill(el, bid) {
  let d; try { d = await call('mp_er_bld', { p_bld: bid }); } catch (e) { return; }
  if (!d || !document.body.contains(el)) return;
  el.innerHTML = `<h4 style="margin:12px 0 4px">🚑 <span>救急</span></h4><div class="mp-kv">
    <b>救急車</b><span>${d.run ? `<span>${d.n}台</span>${d.busy ? `<small>（<span>いま出ている ${d.busy}台</span>）</small>` : ''}` : '<span class="mp-warn">止まっています</span> <small>（病院が動くと出動します）</small>'}</span>
    <b>きょうの出動</b><span>${d.out}件</span>
    ${d.hosp ? `<b>運ばれた患者</b><span><span>きょう ${d.today}人</span>${d.fee != null ? `<small>（<span>売上 ${X(d.fee)}</span>）</small>` : ''}</span>` : ''}</div>
    <p class="muted small" style="margin:2px 0 6px">${d.hosp ? '<span>119番によばれると、この病院の救急車が出動します（15km 以内）。ほかの救急車の患者も運ばれてきます（40km 以内）。救急の患者の分の売上が入ります（軽症 2万・中等症 5万・重症 12万 X）。</span>' : '<span>近くの病院の救急車がないときに出動します（15km 以内）。</span>'}</p>`;
}

/* ---------- 天気図（t62）：等圧線（2hPa ごと）・高気圧「高」と低気圧「低」・雨と雪（または気温）。いまから24時間後まで ---------- */
const WXL = { c: null, at: 0 };
const WX_OFFS = [0, 3, 6, 12, 24];
const wxKey = () => S.wxMode + ':' + S.wxOff + ':' + Math.floor(Date.now() / 300000);   // 5分ごとに新しく
const wxMs = () => S.wxOff ? (Math.floor(Date.now() / 3600000) + S.wxOff) * 3600000 : Date.now();   // 予想は ちょうどの時刻
// 雨・雪の色（気象レーダーのような色。1時間の量 mm）・雲はうすい灰色
function wxRainCol(o) {
  if (o.wet) {
    if (o.kind === 'snow') return [246, 248, 255, 150 + Math.round(90 * o.inten)];
    if (o.kind === 'sleet') return [196, 214, 255, 175];
    const mm = MapWx.rainMM ? MapWx.rainMM(o.inten) : 0.5 + 40 * o.inten * o.inten;   // 2026-11-01：弱い雨が多く、強い雨は まれ（列車の遅れと同じ目安）
    return mm < 1 ? [200, 228, 255, 150] : mm < 5 ? [130, 190, 255, 170] : mm < 10 ? [33, 140, 255, 180] : mm < 20 ? [0, 65, 255, 190]
      : mm < 30 ? [250, 245, 0, 200] : mm < 50 ? [255, 153, 0, 210] : [255, 40, 0, 220];
  }
  if (o.fg >= 0.3) return [214, 218, 226, 110 + Math.round(110 * o.fg)];   // 霧（2026-11-02）
  if (o.ds >= 0.3) return [222, 190, 120, 70 + Math.round(110 * o.ds)];   // 黄砂
  return o.cl === 1 ? [236, 239, 243, 90] : o.cl ? [236, 239, 243, 38] : [0, 0, 0, 0];
}
// 気温の色（−15℃ むらさき → 0℃ 青 → 15℃ 黄緑 → 30℃ 赤）
const WX_TC = [[-15, 80, 40, 160], [-5, 60, 90, 220], [0, 90, 160, 240], [5, 90, 200, 220], [10, 110, 210, 150], [15, 190, 225, 100], [20, 250, 220, 80], [25, 250, 160, 60], [30, 235, 80, 50], [35, 190, 30, 60]];
function wxTempCol(T) {
  if (T <= WX_TC[0][0]) return [WX_TC[0][1], WX_TC[0][2], WX_TC[0][3], 150];
  for (let i = 1; i < WX_TC.length; i++) {
    const b = WX_TC[i]; if (T > b[0]) continue;
    const a = WX_TC[i - 1], f = (T - a[0]) / (b[0] - a[0]);
    return [Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f), 150];
  }
  const l = WX_TC[WX_TC.length - 1]; return [l[1], l[2], l[3], 150];
}
// 等圧線（マーチングスクエア）：値 L の線を [x1, y1, x2, y2, …]（マス）で
function wxIso(P, nx, ny, x0, y0, st, L) {
  const out = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = j * nx + i, a = P[k], b = P[k + 1], c = P[k + nx + 1], d = P[k + nx];
    const id = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0); if (id === 0 || id === 15) continue;
    const X = x0 + i * st, Y = y0 + j * st;
    const T_ = () => [X + st * (L - a) / (b - a), Y], R_ = () => [X + st, Y + st * (L - b) / (c - b)];
    const B_ = () => [X + st * (L - d) / (c - d), Y + st], L_ = () => [X, Y + st * (L - a) / (d - a)];
    const seg = (p, q) => out.push(p[0], p[1], q[0], q[1]), up = (a + b + c + d) / 4 > L;
    switch (id) {
      case 1: case 14: seg(L_(), B_()); break;
      case 2: case 13: seg(B_(), R_()); break;
      case 3: case 12: seg(L_(), R_()); break;
      case 4: case 11: seg(T_(), R_()); break;
      case 6: case 9: seg(T_(), B_()); break;
      case 7: case 8: seg(L_(), T_()); break;
      case 5: if (up) { seg(L_(), T_()); seg(B_(), R_()); } else { seg(T_(), R_()); seg(L_(), B_()); } break;
      case 10: if (up) { seg(T_(), R_()); seg(L_(), B_()); } else { seg(L_(), T_()); seg(B_(), R_()); } break;
    }
  }
  return out;
}
// 見えているところ（まわりも少し）の天気を、画面で16pxごとに計算する
function wxArea(v, z) {
  const w = S.boot && S.boot.world, m = 12000;   // 国のまわり 600km まで（まわりの海の天気も）
  let X0 = v.x0, Y0 = v.y0, X1 = v.x1, Y1 = v.y1;
  if (w && w.cx1 >= w.cx0) { X0 = Math.max(X0, w.cx0 * CS - m); Y0 = Math.max(Y0, w.cy0 * CS - m); X1 = Math.min(X1, (w.cx1 + 1) * CS + m); Y1 = Math.min(Y1, (w.cy1 + 1) * CS + m); }
  return { X0, Y0, X1, Y1 };
}
const wxStepOf = z => Math.pow(2, Math.round(Math.log2(Math.max(0.25, 16 / z))));
function wxBuild(v, z) {
  const st = wxStepOf(z), a = wxArea(v, z); if (a.X1 <= a.X0 || a.Y1 <= a.Y0) return null;
  const mx = (a.X1 - a.X0) * 0.3, my = (a.Y1 - a.Y0) * 0.3, b = wxArea({ x0: a.X0 - mx, y0: a.Y0 - my, x1: a.X1 + mx, y1: a.Y1 + my }, z);
  const x0 = Math.floor(b.X0 / st) * st, y0 = Math.floor(b.Y0 / st) * st, nx = Math.ceil((b.X1 - x0) / st) + 2, ny = Math.ceil((b.Y1 - y0) / st) + 2;
  if (nx < 3 || ny < 3 || nx * ny > 16000) return null;
  const ms = wxMs(), t = MapWx.tinfo(ms), N = nx * ny, temp = S.wxMode === 'temp';
  const P = new Float32Array(N), cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
  const cg = cv.getContext('2d'), im = cg.createImageData(nx, ny), d = im.data;
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * st, y = y0 + j * st, k = j * nx + i, o = MapWx.core(x, y, wxElev(x, y), ms, t), c = temp ? wxTempCol(o.T) : wxRainCol(o);
    P[k] = o.P; if (o.P < lo) lo = o.P; if (o.P > hi) hi = o.P;
    d[k * 4] = c[0]; d[k * 4 + 1] = c[1]; d[k * 4 + 2] = c[2]; d[k * 4 + 3] = c[3];
  }
  cg.putImageData(im, 0, 0);
  const lines = []; for (let L = Math.ceil(lo / 2) * 2; L <= hi; L += 2) { const sg = wxIso(P, nx, ny, x0, y0, st, L); if (sg.length) lines.push({ L, s: sg }); }
  // 高気圧・低気圧：まわり（9×9）でいちばん高い・低いところ
  const ext = [], R = 4;
  for (let j = R; j < ny - R; j++) for (let i = R; i < nx - R; i++) {
    const k = j * nx + i, p = P[k]; let mxf = true, mnf = true, sum = 0, n = 0;
    for (let bb = -R; bb <= R && (mxf || mnf); bb++) for (let aa = -R; aa <= R; aa++) { if (!aa && !bb) continue; const q = P[k + bb * nx + aa]; if (q >= p) mxf = false; if (q <= p) mnf = false; sum += q; n++; }
    if ((mxf || mnf) && Math.abs(p - sum / n) > 0.02 && !ext.some(e => Math.abs(e.i - i) < 8 && Math.abs(e.j - j) < 8)) ext.push({ i, j, x: x0 + i * st, y: y0 + j * st, P: p, hi: mxf });
  }
  return { key: wxKey(), st, x0, y0, nx, ny, img: cv, lines, ext, A: a, ms };
}
function drawWx(g, z, v) {
  if (!S.layer.wxmap || !wxOk() || S.v3) return;
  const key = wxKey(), a = wxArea(v, z), t = now();
  let c = WXL.c;
  const need = !c || c.key !== key || c.st !== wxStepOf(z) || a.X0 < c.x0 || a.Y0 < c.y0 || a.X1 > c.x0 + (c.nx - 1) * c.st || a.Y1 > c.y0 + (c.ny - 1) * c.st;
  if (need) {
    if (!c || c.key !== key || t - WXL.at > 140) { WXL.at = t; const n = wxBuild(v, z); if (n) WXL.c = c = n; }
    else S.dirty = true;   // うごかしているあいだは、少しあとで作りなおす
  }
  if (!c) return;
  g.save();
  g.fillStyle = 'rgba(20,30,50,.14)'; g.fillRect(0, 0, S.W, S.H);   // 地図を少し暗くして、雲と雨を見やすく
  g.imageSmoothingEnabled = true;
  g.drawImage(c.img, sx(c.x0 - c.st / 2), sy(c.y0 - c.st / 2), c.nx * c.st * z, c.ny * c.st * z);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const ln of c.lines) {
    g.beginPath(); const sg = ln.s;
    for (let i = 0; i < sg.length; i += 4) { g.moveTo(sx(sg[i]), sy(sg[i + 1])); g.lineTo(sx(sg[i + 2]), sy(sg[i + 3])); }
    g.strokeStyle = 'rgba(34,34,48,.8)'; g.lineWidth = ln.L % 20 === 0 ? 2.6 : ln.L % 10 === 0 ? 1.8 : 1.1; g.stroke();
  }
  g.restore();
}
function drawWxTop(g, z) {
  const c = WXL.c; if (!S.layer.wxmap || !c || S.v3) return;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  // 等圧線の数字：線ごとに1つ（画面のまん中にいちばん近いところ）
  g.font = '700 11px system-ui, sans-serif';
  //   ほかの線の数字と重なるところはとばす（引いたとき、低気圧のまわりで数字がかさならないように。t108）
  const used = [];
  for (const ln of c.lines) {
    const sg = ln.s, cand = [];
    for (let i = 0; i < sg.length; i += 4) {
      const x = sx((sg[i] + sg[i + 2]) / 2), y = sy((sg[i + 1] + sg[i + 3]) / 2);
      if (x < 26 || y < 64 || x > S.W - 64 || y > S.H - 160) continue;
      cand.push([x, y, (x - S.W / 2) ** 2 + ((y - S.H / 2) * 1.6) ** 2]);
    }
    cand.sort((a, b) => a[2] - b[2]);
    const best = cand.find(q => used.every(u => Math.abs(u[0] - q[0]) > 30 || Math.abs(u[1] - q[1]) > 15));
    if (!best) continue;
    used.push(best);
    const tx = String(ln.L); g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,.92)'; g.strokeText(tx, best[0], best[1]); g.fillStyle = '#26263a'; g.fillText(tx, best[0], best[1]);
  }
  // 高・低（日本の天気図のように、高は青・低は赤）。台風の中心には「低」をかかない
  const L = window.I18N && I18N.lang, HL = L === 'en' ? ['H', 'L'] : L === 'ko' ? ['고', '저'] : ['高', '低'];
  const tys = MapWx.typhoons ? MapWx.typhoons(c.ms) : [];
  for (const e of c.ext) {
    const x = sx(e.x), y = sy(e.y); if (x < 12 || y < 56 || x > S.W - 12 || y > S.H - 150) continue;
    if (!e.hi && tys.some(q => Math.hypot(q.x - e.x, q.y - e.y) * 0.05 < q.r0 * 1.6)) continue;
    g.font = '900 24px system-ui, sans-serif'; g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.95)';
    const tx = e.hi ? HL[0] : HL[1]; g.strokeText(tx, x, y); g.fillStyle = e.hi ? '#1d4fc4' : '#d1302a'; g.fillText(tx, x, y);
    g.font = '800 12px system-ui, sans-serif'; g.lineWidth = 3.5; const pv = String(Math.round(e.P)); g.strokeText(pv, x, y + 19); g.fillText(pv, x, y + 19);
  }
  for (const q of tys) wxTyDraw(g, z, q, c.ms);
  g.restore();
}
// 台風（2026-11-02）：強い風の範囲（黄 15m/s 以上・赤 25m/s 以上）・これまでの進路（線）・これからの進路（点線と予報の円：24・48・72時間後）・中心の × と「台風N号 中心気圧」
function wxTyRad(D, r0, W) {   // 台風だけの風が W m/s になる半径（km。wx.js と同じ気圧の式から）
  const v = r => 0.6 + 180 * D * r / (r0 * r0 * Math.pow(1 + (r / r0) * (r / r0), 1.5));   // 台風の風は 1.8 倍（wx.js の wind）
  let r = r0 / Math.SQRT2; if (v(r) < W) return 0;
  while (r < 2000 && v(r) >= W) r += 2;
  return r;
}
function wxTyDraw(g, z, q, ms) {
  const k = 1 / 0.05 * z, x = sx(q.x), y = sy(q.y), D = 1008 - q.P;   // 1km ＝ k px。ms：天気図の時刻（進路は その 24時間前〜72時間後）
  const fut = q.path.filter(p => p[0] > ms), past = q.path.filter(p => p[0] < ms);
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  // 予報の円と進路
  const fc = [[24, 60], [48, 110], [72, 160]].map(([h, r]) => { const p = q.path.find(e => e[0] === ms + h * 3600000); return p ? [sx(p[1]), sy(p[2]), r * k] : null; }).filter(Boolean);
  g.setLineDash([5, 5]); g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,.95)';
  for (const [a, b, r] of fc) { g.beginPath(); g.arc(a, b, Math.max(6, r), 0, 2 * Math.PI); g.stroke(); }
  if (fut.length > 1) { g.beginPath(); g.moveTo(x, y); for (const p of fut) g.lineTo(sx(p[1]), sy(p[2])); g.strokeStyle = 'rgba(40,40,60,.75)'; g.lineWidth = 2; g.stroke(); }
  g.setLineDash([]);
  if (past.length > 1) { g.beginPath(); past.forEach((p, i) => i ? g.lineTo(sx(p[1]), sy(p[2])) : g.moveTo(sx(p[1]), sy(p[2]))); g.lineTo(x, y); g.strokeStyle = 'rgba(40,40,60,.75)'; g.lineWidth = 2.4; g.stroke(); }
  // 強い風の範囲
  const r15 = wxTyRad(D, q.r0, 15) * k, r25 = wxTyRad(D, q.r0, 25) * k;
  if (r15 > 2) { g.beginPath(); g.arc(x, y, r15, 0, 2 * Math.PI); g.fillStyle = 'rgba(250,215,40,.18)'; g.fill(); g.strokeStyle = 'rgba(220,170,0,.9)'; g.lineWidth = 1.6; g.stroke(); }
  if (r25 > 2) { g.beginPath(); g.arc(x, y, r25, 0, 2 * Math.PI); g.fillStyle = 'rgba(230,40,40,.18)'; g.fill(); g.strokeStyle = 'rgba(210,30,30,.95)'; g.lineWidth = 1.8; g.stroke(); }
  // 中心
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke();
  g.lineWidth = 3; g.strokeStyle = '#d1302a'; g.stroke();
  const L = window.I18N && I18N.lang, nm = L === 'en' ? `Typhoon ${q.n}` : L === 'ko' ? `태풍 ${q.n}호` : L === 'zh' ? `${q.n}号台风` : `台風${q.n}号`;
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '900 13px system-ui, sans-serif'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,.95)'; g.fillStyle = '#b3201b';
  g.strokeText(nm, x + 11, y - 8); g.fillText(nm, x + 11, y - 8);
  g.font = '800 11.5px system-ui, sans-serif'; g.fillStyle = '#26263a'; const pv = `${q.P}hPa・${q.w}m/s`; g.strokeText(pv, x + 11, y + 8); g.fillText(pv, x + 11, y + 8);
  g.restore();
}
// 天気図の下の帯：時刻・雨と雪／気温・何時間後・うごかす・色の見かた
function wxBarSync() {
  const b = S.wrap && S.wrap.querySelector('.mp-wxbar'); if (!b) return;
  const on = !!S.layer.wxmap && !S.v3;
  b.hidden = !on; S.wrap.classList.toggle('mp-wxon', on);
  if (!on) return;
  const ms = wxMs(), j = new Date(ms + 9 * 3600000), p2 = n => String(n).padStart(2, '0');
  const tm = `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p2(j.getUTCHours())}:${p2(j.getUTCMinutes())}`;
  const k = tm + '|' + S.wxMode + '|' + S.wxOff + '|' + (S.wxPlay ? 1 : 0);
  if (b.dataset.k === k) return; b.dataset.k = k;
  b.querySelector('[data-wxtime]').innerHTML = `<span>${tm}</span> <small>${S.wxOff ? '予想' : 'いま'}</small>`;
  b.querySelectorAll('[data-wxm]').forEach(x => x.classList.toggle('on', x.dataset.wxm === S.wxMode));
  b.querySelectorAll('[data-wxo]').forEach(x => x.classList.toggle('on', Number(x.dataset.wxo) === S.wxOff));
  b.querySelector('[data-wxplay]').textContent = S.wxPlay ? '⏸' : '▶';
  b.querySelector('[data-wxleg]').innerHTML = S.wxMode === 'temp'
    ? `<span class="mp-wxgr" style="background:linear-gradient(90deg,${WX_TC.map(c => `rgb(${c[1]},${c[2]},${c[3]})`).join(',')})"></span><span class="mp-wxsc"><span>−15</span><span>0</span><span>15</span><span>35℃</span></span>`
    : `<span><i style="background:rgb(236,239,243)"></i>くもり</span><span><i style="background:rgb(130,190,255)"></i>弱い雨</span><span><i style="background:rgb(0,65,255)"></i>雨</span><span><i style="background:rgb(255,153,0)"></i>強い雨</span><span><i style="background:rgb(246,248,255);border-color:#99a"></i>雪</span><span><i style="background:rgb(214,218,226)"></i>霧</span><span><i style="background:rgb(222,190,120)"></i>黄砂</span><span><b style="color:#d1302a">×</b> 台風</span>`;
}
function wxSetOff(h) { S.wxOff = Math.max(0, Math.min(24, h | 0)); S.dirty = true; wxBarSync(); }
function wxPlayToggle() {
  if (S.wxPlay) { clearInterval(S.wxPlay); S.wxPlay = 0; wxBarSync(); return; }
  if (S.wxOff >= 24) wxSetOff(0);
  S.wxPlay = setInterval(() => { if (!S.open || !S.layer.wxmap || S.wxOff >= 24) { clearInterval(S.wxPlay); S.wxPlay = 0; wxBarSync(); return; } wxSetOff(S.wxOff + 1); }, 700);
  wxBarSync();
}
// メニューの「天気図」から：天気図を出して、国ぜんたいが見えるように
function wxMapOn() {
  if (S.v3) { const b = S.wrap.querySelector('[data-v3]'); if (b) b.click(); }
  if (!S.layer.wxmap) setOpt('wxmap', true);
  const w = S.boot && S.boot.world;
  if (w && w.cx1 >= w.cx0) { const W_ = (w.cx1 - w.cx0 + 1) * CS, H_ = (w.cy1 - w.cy0 + 1) * CS; setCam(((w.cx0 + w.cx1 + 1) / 2) * CS, ((w.cy0 + w.cy1 + 1) / 2) * CS, Math.min(S.W / W_, (S.H - 120) / H_) / 1.5); }   // まわりの海も少し
}

/* ---------- 画面（ボタン・下のシート） ---------- */
const CSS = `
.mp-wrap{position:relative;height:calc(100dvh - 210px);min-height:440px;border-radius:12px;overflow:hidden;background:#4680ba;touch-action:none;user-select:none;-webkit-user-select:none}
.mp-wrap.mp-full{position:fixed;inset:0;height:auto;border-radius:0;z-index:25}
.mp-wrap.mp-photo>*:not(.mp-cv3):not(.mp-photox){display:none!important}
.mp-photox{position:absolute;right:10px;top:calc(10px + env(safe-area-inset-top));z-index:30;width:42px;height:42px;padding:0;border-radius:21px;border:1px solid rgba(255,255,255,.7);background:rgba(20,24,30,.45);color:#fff;font-size:18px;font-weight:700;transition:opacity .5s}
.mp-photox.mp-dim{opacity:0}
.mp-photox[hidden]{display:none}
.mp-cv{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}
.mp-cvr{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.mp-cfg[hidden]{display:none}
.mp-cfg{position:absolute;right:56px;top:8px;z-index:6;background:rgba(255,255,255,.97);border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.22);padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:13px;color:#222;max-width:min(320px,calc(100% - 72px))}
.mp-cfg label{display:flex;gap:8px;align-items:flex-start;line-height:1.35}
.mp-cfg{max-height:calc(100% - 16px);overflow:auto}.mp-cfg>*{flex-shrink:0}
.mp-cfg select{margin-left:auto;font-size:13px;padding:2px 4px;border-radius:6px}
.mp-qp{display:flex}.mp-seg.mp-qp button{flex:1 1 auto;padding:6px 3px;font-size:12px;line-height:1.25;word-break:keep-all}
.mp-qd summary{cursor:pointer;color:#555;font-size:12px}.mp-qd label{margin-top:6px;align-items:center}
.mp-qn{color:#666;font-size:11px;line-height:1.4}
.mp-cfg input{margin-top:2px;flex:none;width:18px;height:18px}
.mp-top{position:absolute;left:8px;right:56px;top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}
.mp-top>*{pointer-events:auto}
.mp-topb{display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}
.mp-topb>*{pointer-events:auto}
@media (max-width:600px){.mp-topb{flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;pointer-events:auto;max-width:100%;padding:1px 0 3px}
  .mp-topb::-webkit-scrollbar{display:none}.mp-topb>*{flex:none}.mp-top select{max-width:9.5em}}
.mp-top select{max-width:38%}
.mp-top select,.mp-top button,.mp-zoom button,.mp-tools button{border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.94);color:#222;border-radius:10px;font-weight:700;font-size:13px;padding:7px 10px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.mp-top button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.mp-top .mp-addr{background:rgba(255,255,255,.94);border-radius:10px;padding:6px 10px;font-size:12px;font-weight:700;color:#333;max-width:60%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.mp-zoom{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px}
.mp-zoom button{width:40px;height:40px;padding:0;font-size:18px}
.mp-tools{position:absolute;left:0;right:0;bottom:0;display:flex;gap:4px;padding:6px 6px calc(6px + env(safe-area-inset-bottom));overflow-x:auto;background:linear-gradient(transparent,rgba(0,0,0,.18))}
.mp-tools button{flex:none;padding:8px 11px}
.mp-tools button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.mp-wrap.mp-3d .mp-tools,.mp-wrap.mp-3d .mp-sheet{display:none}
.mp-wrap.mp-3d .mp-sheet.mp-s3:not([hidden]){display:block;bottom:10px;overflow:hidden;max-height:none}
.mp-wrap.mp-3d .mp-s3in{max-height:40vh;overflow:auto}
.mp-runbar{position:absolute;left:8px;top:calc(var(--mp-top-h, 38px) + 16px);z-index:6;display:flex;flex-wrap:wrap;gap:4px;max-width:calc(100% - 70px)}
.mp-runbar[hidden]{display:none}
.mp-runbar button{border:1px solid rgba(0,0,0,.18);background:rgba(255,248,214,.97);color:#222;border-radius:16px;font-weight:700;font-size:12.5px;padding:5px 10px;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.mp-runbar button[data-rbfx],.mp-runbar button[data-rbsx]{padding:5px 8px;margin-right:6px}
.mp-runbar button.mp-rbu-ask{background:#ffe1dc;border-color:#e8322a}
.mp-late{color:#c0170f}
.mp-uk{border:1px solid var(--line,#e2e2e2);border-left:5px solid #9aa3ad;border-radius:10px;padding:8px 10px;margin:8px 0;font-size:13.5px;line-height:1.6}
.mp-uk.mp-uk-stop,.mp-uk.mp-uk-ask{border-left-color:#e8322a}.mp-uk.mp-uk-slow{border-left-color:#f0a020}.mp-uk.mp-uk-rec,.mp-uk.mp-uk-run{border-left-color:#2a8de8}
.mp-uk.mp-uk-focus{box-shadow:0 0 0 3px rgba(255,205,0,.8)}
.mp-uk-rs{display:flex;flex-wrap:wrap;gap:2px 10px;font-weight:700}
.mp-uk-st{font-weight:800;margin:2px 0}
.mp-uk-stop .mp-uk-st,.mp-uk-ask .mp-uk-st{color:#c0170f}.mp-uk-slow .mp-uk-st{color:#a85f00}
.mp-uk-ask{background:#fff4f2;border-radius:8px;padding:6px 8px;margin:6px 0}
.mp-uk-btns{display:flex;flex-direction:column;gap:6px;margin:6px 0}
.mp-uk-btns .btn{text-align:left;font-weight:700}
.mp-uk-furi{margin:6px 0}
.mp-uk-sc{margin:4px 0 2px}.mp-uk-sc label{display:inline-flex;align-items:center;gap:4px;margin:0 12px 0 4px}
.mp-uk-cx{margin:6px 0}.mp-uk-tr{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;padding:4px 0;border-bottom:1px dashed var(--line,#eee)}
.mp-uk-tr .t{font-variant-numeric:tabular-nums;font-weight:700}.mp-uk-tr .b{margin-left:auto;display:inline-flex;gap:4px}.mp-uk-tr .btn{padding:3px 10px;font-size:12.5px}
.mp-ttl{margin-top:6px;border-top:1px solid var(--line,#e6e6e6);font-size:12.5px;max-height:190px;overflow:auto;position:relative}
.mp-ttr{display:grid;grid-template-columns:1fr 4.6em 4.6em 3.6em;gap:4px;padding:3px 2px;border-bottom:1px dashed var(--line,#eee);font-variant-numeric:tabular-nums}
.mp-ttr .t,.mp-ttr .k{text-align:right}.mp-ttr small{opacity:.7;margin-left:1px}
.mp-ttr.past{opacity:.45}
.mp-ttr.now{background:#fff2b8;font-weight:800;border-radius:6px}
.mp-cv3{touch-action:none}
.mp-wx{position:absolute;left:8px;bottom:62px;border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.94);color:#222;border-radius:16px;font-size:13px;padding:5px 11px;box-shadow:0 1px 3px rgba(0,0,0,.15);font-variant-numeric:tabular-nums}
.mp-wx[hidden]{display:none}
.mp-wx small{font-size:11.5px;color:#345;margin-left:2px}
.mp-wrap.mp-3d .mp-wx{bottom:12px}
.mp-wrap.mp-wxon .mp-wx{bottom:166px}
.mp-wxbar{position:absolute;left:8px;right:56px;bottom:62px;background:rgba(255,255,255,.95);color:#222;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.22);padding:7px 9px;display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.mp-wxbar[hidden]{display:none}
.mp-wxr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mp-wxr b[data-wxtime]{font-variant-numeric:tabular-nums;margin-right:auto}
.mp-wxr b[data-wxtime] small{font-weight:700;color:#1f5fbf;margin-left:3px}
.mp-wxbar .mp-seg button{padding:4px 9px;font-size:12px;background:#f2f4f7;color:#222}
.mp-wxbar .mp-seg button.on{background:#1f5fbf;color:#fff}
.mp-wxo button,.mp-wxpl{border:1px solid rgba(0,0,0,.16);background:#f4f6f9;color:#222;border-radius:14px;padding:4px 9px;font-weight:700;font-size:12px}
.mp-wxo button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.mp-wxpl{min-width:34px}
.mp-wxleg{display:flex;gap:8px;flex-wrap:wrap;align-items:center;color:#444;font-size:11.5px}
.mp-wxleg i{display:inline-block;width:12px;height:10px;border-radius:3px;margin-right:3px;vertical-align:-1px;border:1px solid rgba(0,0,0,.12)}
.mp-eleg{position:absolute;right:6px;bottom:62px;background:rgba(255,255,255,.94);color:#333;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.18);padding:6px 7px;font-size:10.5px;line-height:1.3;display:flex;flex-direction:column;gap:1px;font-variant-numeric:tabular-nums;pointer-events:none}
.mp-eleg[hidden]{display:none}
.mp-wrap.mp-wxon .mp-eleg{bottom:166px}
.mp-eleg b{font-size:11px;margin-bottom:2px}
.mp-eleg span{display:flex;align-items:center;gap:4px;white-space:nowrap}
.mp-eleg i{display:inline-block;width:12px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.12)}
.mp-wxgr{display:block;height:9px;border-radius:5px;flex:1 1 100%}
.mp-wxsc{display:flex;justify-content:space-between;flex:1 1 100%;font-variant-numeric:tabular-nums;margin-top:-4px}
.mp-wxnow{display:flex;align-items:baseline;gap:10px;margin:8px 0 2px}
.mp-wxnow .ic{font-size:30px;line-height:1}
.mp-wxnow b{font-size:28px;font-variant-numeric:tabular-nums}
.mp-wxh,.mp-wxd{display:grid;gap:4px}
.mp-wxh{grid-template-columns:repeat(8,1fr)}
.mp-wxd{grid-template-columns:repeat(4,1fr)}
.mp-wxh div,.mp-wxd div{display:flex;flex-direction:column;align-items:center;gap:1px;background:var(--soft,#f2f4f6);border-radius:8px;padding:5px 2px;font-size:12px;text-align:center;font-variant-numeric:tabular-nums}
.mp-wxh small,.mp-wxd small{color:var(--muted,#666);font-size:11px}
.mp-wxh span{font-size:17px}
.mp-wxd .ic{font-size:20px}
.mp-wxd em{font-style:normal;font-size:10.5px;font-weight:800;color:#b3201b;line-height:1.2}
.mp-jbar{position:absolute;left:8px;bottom:100px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:calc(100% - 70px);background:rgba(255,255,255,.95);color:#222;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.2);padding:5px 9px;font-size:12px}
.mp-jbar[hidden]{display:none}.mp-jbar i{display:inline-block;width:14px;height:5px;border-radius:3px;margin-right:3px;vertical-align:2px}
.mp-jbar small{color:#555;font-variant-numeric:tabular-nums}.mp-jbar button{border:1px solid rgba(0,0,0,.18);background:#f4f6f9;border-radius:12px;padding:3px 9px;font-weight:700;font-size:12px;color:#222}
.mp-wrap.mp-wxon .mp-jbar{bottom:204px}.mp-wrap.mp-3d .mp-jbar{display:none}
.mp-jlist{display:flex;flex-direction:column;gap:4px;max-height:52vh;overflow:auto}
.mp-jrow{display:flex !important;align-items:center;gap:8px;text-align:left}.mp-jrow .lv{flex:0 0 auto;color:#fff;font-weight:800;font-size:11.5px;border-radius:6px;padding:2px 6px}
.mp-jrow .t{min-width:0}
.mp-wxal{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 2px}.mp-wxal span{font-size:12px;font-weight:800;border-radius:6px;padding:2px 7px;background:#fff1b8;color:#6b4e00;border:1px solid #e8c95a}
.mp-wxal .lv2{background:#ffd9d6;color:#9b1c13;border-color:#ee8b82}.mp-wxal .lv3{background:#4b1d6b;color:#fff;border-color:#4b1d6b}
.mp-hint{position:absolute;left:50%;top:calc(var(--mp-top-h, 38px) + 14px);transform:translateX(-50%);background:rgba(20,20,20,.78);color:#fff;font-size:12px;font-weight:700;border-radius:10px;padding:6px 10px;max-width:86%;text-align:center;pointer-events:none}
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
.mp-prof{width:100%;height:130px;display:block;margin:6px 0 2px;border:1px solid var(--line,#ddd);border-radius:8px;background:#fff;touch-action:manipulation}
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
// 地図の設定を変える（t61）。k：zone・own・label・run（層）／inertia・v3names・v3x
function setOpt(k, on) {
  const LS = { run: 'mp_run', inertia: 'mp_inertia', v3names: 'mp_v3n', v3x: 'mp_v3x', wx: 'mp_wx', jam: 'mp_jam', er: 'mp_er' };
  if (k in S.layer) S.layer[k] = !!on; else S[k] = !!on;
  if (LS[k]) try { localStorage.setItem(LS[k], on ? '1' : '0'); } catch (e) {}
  if (k === 'inertia' && !on) S.glide = null;
  if (k === 'run') runReset();
  if (k === 'track' && on) toast(T('非電化はオレンジ、単線はむらさきの点線で出ます'));
  if (k === 'snowz' && on) toast(T('❄ 雪の地域：うすい青は雪国（補助金 3分の1）・青は豪雪地帯（半分）・むらさきは特別豪雪地帯（3分の2）'));
  if (k === 'wx') { WXS.key = ''; WXS.t = 0; }
  if (k === 'jam') { JAM.t = -1e9; JAM.box = null; if (on) jamLoad(); jamBarSync(); }
  if (k === 'er') { ER.t = -1e9; if (on) erLoad(); }
  if (k === 'wxmap') { WXL.c = null; if (!on && S.wxPlay) { clearInterval(S.wxPlay); S.wxPlay = 0; } if (!on && S.cam.z < zMin()) setCam(S.cam.x, S.cam.y, zMin()); if (on && S.v3) toast(T('天気図は2Dの地図で見られます（3Dをやめると出ます）')); wxBarSync(); }
  optSync(); S.dirty = true; if (S.v3) S.v3.dirty = true;
}
function optSync() {
  if (!S.wrap) return;
  S.wrap.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('on', !!S.layer[b.dataset.lay]));
  const v3x = S.wrap.querySelector('[data-v3x]'); if (v3x) v3x.classList.toggle('on', !!S.v3x);
  S.wrap.querySelectorAll('.mp-cfg [data-o]').forEach(c => { const k = c.dataset.o; c.checked = !!(k in S.layer ? S.layer[k] : S[k]); });
  const el = S.wrap.querySelector('.mp-eleg'); if (el) el.hidden = !S.layer.elev || !!S.v3;   // 高低差の色の見かた（3D のときは出さない）
}
function build(root) {
  if (!document.getElementById('mpCss')) { const st = document.createElement('style'); st.id = 'mpCss'; st.textContent = CSS; document.head.appendChild(st); }
  root.innerHTML = `<div class="mp-wrap" id="mpWrap">
    <canvas class="mp-cv"></canvas><canvas class="mp-cvr"></canvas>
    <div class="mp-top">
      <div class="mp-topb"><select class="mp-as" title="だれの名前で"></select>
      <button data-lay="zone">用途地域</button><button data-lay="own" class="on">持ち主</button><button data-lay="track" title="非電化はオレンジ・単線はむらさきの点線">非電化・単線</button><button data-lay="run" title="列車・バスの走行位置">🚃 走行</button><button data-lay="wxmap" title="天気図（等圧線・高気圧と低気圧・雨と雪・気温）">🌤 天気図</button><button data-lay="jam" title="道路の混みぐあい（オレンジ 混雑・赤 渋滞・黒 通行止め）" hidden>🚗 渋滞</button><button data-lay="er" title="救急車（いま出ているもの）" hidden>🚑 救急</button><button data-lay="snowz" title="雪の地域（雪国・豪雪地帯・特別豪雪地帯。雪の対策の補助金）">❄ 雪の地域</button><button data-lay="elev" title="高低差（標高を色で。北西から光を当てた陰つき）">⛰ 高低差</button><button data-b25 title="建物の見えかた（2D・2.5D）"></button><button data-v3 title="ななめから立体に見る">🗻 3D</button><button data-v3x hidden title="横に回す向きを反対にする（2本指でひねる・右ドラッグ）">⇄ 左右反転</button><button data-v3e hidden title="自分の土地に 自販機・ベンチ・植木などを置く">🧰 小物</button><button data-v3u hidden title="地面と建物をすかして、トンネル・地下駅・地下街を見る">⛏ 地下</button><button data-v3p hidden title="名前・ボタンを ぜんぶ消して 3D の写真を撮る（✕ で もどる）">📷 フォト</button></div>
      <span class="mp-addr" translate="no" hidden></span>
    </div>
    <div class="mp-zoom"><button data-find title="さがす">🔍</button><button data-full title="大きく">⤢</button><button data-zin>＋</button><button data-zout>－</button><button data-home title="瑠璃市役所">⌂</button><button data-opt title="地図の設定">⚙</button></div>
    <div class="mp-cfg" hidden>
      <b>地図の設定</b>
      <label><input type="checkbox" data-o="inertia"> 指をはなしたあと、少しすべる（惰性）</label>
      <label><input type="checkbox" data-o="run"> 列車・バスの走行位置を出す</label>
      <label><input type="checkbox" data-o="v3names"> 3D で建物の名前を出す</label>
      <label><input type="checkbox" data-o="v3x"> 3D で横に回す向きを反対にする</label>
      <label><input type="checkbox" data-o="wx"> 天気と気温を出す（左下に地図のまん中の天気。場所・駅・列車にも）</label>
      <b>画質と見える遠さ（この端末）</b>
      <div class="mp-seg mp-qp"><button data-qp="eco">🍃 省エネ</button><button data-qp="std">標準</button><button data-qp="high">高画質</button><button data-qp="max">最高画質</button></div>
      <small class="mp-qn" data-qcustom hidden>自分で決めた設定です</small>
      <details class="mp-qd"><summary>くわしく</summary>
        <label>2D の見える遠さ <select data-q="d2"><option value="0">近い</option><option value="1">ふつう</option><option value="2">遠い</option><option value="3">とても遠い</option></select></label>
        <label>2.5D（建物の高さ）の遠さ <select data-q="d25"><option value="0">近い</option><option value="1">ふつう</option><option value="2">遠い</option><option value="3">とても遠い</option></select></label>
        <label>3D の見える遠さ <select data-q="d3"><option value="0">近い</option><option value="1">ふつう</option><option value="2">遠い</option><option value="3">とても遠い</option></select></label>
        <label>なめらかさ <select data-q="fps"><option value="60">60コマ/秒</option><option value="30">30コマ/秒</option><option value="20">20コマ/秒</option></select></label>
        <label>画面のこまかさ <select data-q="res"><option value="1">ふつう</option><option value="0.75">少しあらい</option><option value="0.5">あらい</option></select></label>
        <label><input type="checkbox" data-q="aa"> 3D のふちをなめらかに（次に 3D にしたときから）</label>
      </details>
      <small class="mp-qn">遠くまで見るほど、電池と通信を多く使います。「最高画質」はパソコン向けです。重いときは「省エネ」に。</small>
    </div>
    <div class="mp-hint" hidden></div>
    <div class="mp-eleg" hidden></div>
    <button class="mp-wx" hidden title="天気"></button>
    <button class="mp-photox" hidden title="フォトモードを おわる">✕</button>
    <div class="mp-wxbar" hidden>
      <div class="mp-wxr"><b data-wxtime></b><span class="mp-seg"><button data-wxm="rain">雨・雪</button><button data-wxm="temp">気温</button></span><button class="mp-wxpl" data-wxplay title="うごかす（1時間ずつ）">▶</button></div>
      <div class="mp-wxr mp-wxo">${WX_OFFS.map(h => `<button data-wxo="${h}">${h ? `${h}時間後` : 'いま'}</button>`).join('')}</div>
      <div class="mp-wxleg" data-wxleg></div>
    </div>
    <div class="mp-sheet" hidden></div>
    <div class="mp-tools">
      <button data-tool="look" class="on">👆 見る</button><button data-tool="land">▦ 土地</button><button data-tool="rail">🚃 線路</button>
      <button data-tool="road">🛣 道路</button><button data-tool="sta">🚉 駅・バス停</button><button data-tool="dep">🏭 車庫</button>
      <button data-tool="rwy" hidden>✈ 滑走路</button><button data-tool="del">✖ こわす</button><button data-menu>≡ 車両・系統・ダイヤ</button>
    </div></div>`;
  S.wrap = root.querySelector('#mpWrap'); S.cv = S.wrap.querySelector('canvas'); S.ctx = S.cv.getContext('2d');
  S.cvr = S.wrap.querySelector('.mp-cvr'); S.ctxr = S.cvr.getContext('2d');   // 上がき（走行位置・3D の名前。t61）
  S.sheet = S.wrap.querySelector('.mp-sheet'); S.hint = S.wrap.querySelector('.mp-hint'); S.addr = S.wrap.querySelector('.mp-addr');
  S.wrap.querySelector('.mp-eleg').innerHTML = elvLegend();   // 高低差の色の見かた
  // 上のボタンの段の高さ（スマホでは折り返して2〜3段になる）：運行情報・追跡のしるしと、道具のヒントは、その下に出す（重ならないように）
  { const top = S.wrap.querySelector('.mp-top'), setH = () => { if (top.offsetHeight) S.wrap.style.setProperty('--mp-top-h', top.offsetHeight + 'px'); };
    setH(); if (window.ResizeObserver) new ResizeObserver(setH).observe(top); else window.addEventListener('resize', setH); }
  const asSel = S.wrap.querySelector('.mp-as');
  asSel.innerHTML = S.boot.as.map(a => `<option value="${esc(a.as)}">${a.as === 'me' ? '👤' : a.as === 'gov' ? '🏛' : '🏢'} ${esc(asLabel(a))}</option>`).join('');
  try { const sv = localStorage.getItem('mp_as'); if (sv && S.boot.as.some(a => a.as === sv)) S.as = sv; } catch (e) {}
  asSel.value = S.as;
  asSel.onchange = () => { S.as = asSel.value; try { localStorage.setItem('mp_as', S.as); } catch (e) {} for (const c of S.cells.values()) c.stale = true; S.dirty = true; toolVis(); if (S.onAs) S.onAs(); };
  // 地図の設定（t61）：惰性・走行位置・3D の建物の名前・3D の左右反転。この端末におぼえる
  try { S.inertia = localStorage.getItem('mp_inertia') === '1'; S.layer.run = localStorage.getItem('mp_run') === '1'; const n3 = localStorage.getItem('mp_v3n'); if (n3 != null) S.v3names = n3 !== '0'; S.wx = localStorage.getItem('mp_wx') !== '0'; } catch (e) {}
  S.wrap.querySelector('[data-lay="run"]').classList.toggle('on', !!S.layer.run);
  runBar();   // 追跡中・しぼりこみ中のしるし（t62）
  try { S.layer.jam = localStorage.getItem('mp_jam') === '1'; S.layer.er = localStorage.getItem('mp_er') === '1'; } catch (e) {}   // 渋滞（DB の更新67）・救急（68）
  S.wrap.querySelector('[data-lay="jam"]').classList.toggle('on', !!S.layer.jam); S.wrap.querySelector('[data-lay="er"]').classList.toggle('on', !!S.layer.er);
  jamProbe(); erProbe();
  S.wrap.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { const k = b.dataset.lay; setOpt(k, !S.layer[k]); });
  const cfg = S.wrap.querySelector('.mp-cfg');
  S.wrap.querySelector('[data-opt]').onclick = () => { cfg.hidden = !cfg.hidden; optSync(); };
  cfg.querySelectorAll('[data-o]').forEach(c => c.onchange = () => setOpt(c.dataset.o, c.checked));
  // 画質と見える遠さ（t63）
  const qUI = () => {
    cfg.querySelectorAll('[data-qp]').forEach(b => b.classList.toggle('on', b.dataset.qp === MQ.p));
    cfg.querySelectorAll('select[data-q]').forEach(x => { x.value = String(MQ[x.dataset.q]); });
    cfg.querySelector('input[data-q="aa"]').checked = !!MQ.aa; cfg.querySelector('[data-qcustom]').hidden = MQ.p !== 'custom';
  };
  const qApply = aa0 => { qSave(); resize(); S.dirty = true; if (S.v3) { S.v3.dirty = true; S.v3.bKey = ''; if (aa0 !== MQ.aa) toast(T('3D のふちは、次に 3D にしたときから変わります')); } qUI(); };
  cfg.querySelectorAll('[data-qp]').forEach(b => b.onclick = () => { const aa0 = MQ.aa; Object.assign(MQ, QP[b.dataset.qp], { p: b.dataset.qp }); qApply(aa0); });
  cfg.querySelectorAll('select[data-q]').forEach(x => x.onchange = () => { const aa0 = MQ.aa; MQ[x.dataset.q] = Number(x.value); qMatch(); qApply(aa0); });
  cfg.querySelector('input[data-q="aa"]').onchange = ev => { const aa0 = MQ.aa; MQ.aa = ev.target.checked; qMatch(); qApply(aa0); };
  qUI();
  S.wrap.addEventListener('pointerdown', e => { if (!cfg.hidden && e.target.tagName === 'CANVAS') cfg.hidden = true; }, true);   // 地図にさわったら とじる
  // 建物の見えかた：2.5D（高さ・壁）と 2D（上から見たまま）。この端末におぼえる
  try { const v = localStorage.getItem('mp_b25'); if (v != null) S.b25 = v !== '0'; } catch (e) {}
  const b25 = S.wrap.querySelector('[data-b25]'), b25L = () => { b25.textContent = S.b25 ? '🏢 2.5D' : '🏢 2D'; };
  b25L(); b25.onclick = () => { S.b25 = !S.b25; b25L(); try { localStorage.setItem('mp_b25', S.b25 ? '1' : '0'); } catch (e) {} S.dirty = true; };
  // 3D（t61）。⇄ 左右反転：横に回す向きを反対に（この端末におぼえる）
  { const v3 = S.wrap.querySelector('[data-v3]'), v3x = S.wrap.querySelector('[data-v3x]');
    try { S.v3x = localStorage.getItem('mp_v3x') === '1'; } catch (e) { S.v3x = false; }
    v3x.classList.toggle('on', !!S.v3x);
    v3x.onclick = () => setOpt('v3x', !S.v3x);
    lookOn();   // サーバーの版（DB の更新103〜105：見た目・小物・留置線）を はじめに しらべておく
    const v3e = S.wrap.querySelector('[data-v3e]');   // 小物を置く（編集モード。t65）
    const e3 = on => { S.v3edit = !!on; v3e.classList.toggle('on', S.v3edit); if (S.v3edit) { hint('小物：自分の土地をタップして置く・置いた小物をタップして回す／動かす'); setTimeout(() => hint(''), 4000); } };
    v3e.onclick = () => { if (!S.lookDB && S.lookDB !== null) return toast(T('サーバーの更新のあとで使えます')); e3(!S.v3edit); };
    const v3u = S.wrap.querySelector('[data-v3u]');   // 地下ビュー（DB の更新109）：地面と建物をすかして、トンネル・地下駅・地下街を見る
    const u3 = on => { S.v3u = !!on; v3u.classList.toggle('on', S.v3u); if (window.m3Ug) window.m3Ug(S.v3u); if (S.v3u) { hint('地下：地面と建物をすかして、トンネル・地下駅・地下街を見ます（もう一度おすと もどります）'); setTimeout(() => hint(''), 4000); } };
    v3u.onclick = () => u3(!S.v3u);
    // フォトモード（t67）：3D の名前・ボタン・天気などを ぜんぶ消して 写真を撮る。画面いっぱいに。右上の ✕ は 2.5秒で消えて、さわると また出る（1回目は 出すだけ）
    const v3p = S.wrap.querySelector('[data-v3p]'), px = S.wrap.querySelector('.mp-photox');
    let pFull = false, pT = 0;
    const pDim = () => { clearTimeout(pT); px.classList.remove('mp-dim'); pT = setTimeout(() => px.classList.add('mp-dim'), 2500); };
    const p3 = on => {
      if (!!on === !!S.v3photo) return;
      S.v3photo = !!on;
      if (S.v3photo) { pFull = S.wrap.classList.contains('mp-full'); S.wrap.classList.add('mp-full', 'mp-photo'); px.hidden = false; pDim(); }
      else { S.wrap.classList.remove('mp-photo'); if (!pFull) S.wrap.classList.remove('mp-full'); px.hidden = true; px.classList.remove('mp-dim'); clearTimeout(pT); }
      resize(); S.dirty = true; if (S.v3) S.v3.dirty = true;
    };
    S.photoOff = () => p3(false);
    v3p.onclick = () => p3(true);
    S.wrap.addEventListener('pointerdown', () => { if (!S.v3photo) return; px._dim = px.classList.contains('mp-dim'); pDim(); }, true);
    px.onclick = ev => { ev.stopPropagation(); if (px._dim) { px._dim = false; return; } p3(false); };
    v3.onclick = async () => { if (S.v3) { u3(false); p3(false); m3Close(); } else await m3Open(); v3.classList.toggle('on', !!S.v3); b25.hidden = !!S.v3; v3x.hidden = !S.v3; v3e.hidden = !S.v3 || !lookOn(); v3u.hidden = !S.v3; v3p.hidden = !S.v3; if (!S.v3) e3(false); optSync(); }; }
  S.wrap.querySelector('[data-full]').onclick = () => { S.wrap.classList.toggle('mp-full'); resize(); };
  S.wrap.querySelector('[data-find]').onclick = () => openFind();   // さがす（t59）
  S.wrap.querySelector('.mp-wx').onclick = () => { const [x, y] = wxCenter(); openWx(x, y); };   // 天気（t62）
  { const wb = S.wrap.querySelector('.mp-wxbar');   // 天気図の帯（t62）
    wb.querySelectorAll('[data-wxm]').forEach(x => x.onclick = () => { S.wxMode = x.dataset.wxm; S.dirty = true; wxBarSync(); });
    wb.querySelectorAll('[data-wxo]').forEach(x => x.onclick = () => { if (S.wxPlay) wxPlayToggle(); wxSetOff(Number(x.dataset.wxo)); });
    wb.querySelector('[data-wxplay]').onclick = () => wxPlayToggle(); }
  S.wrap.addEventListener('click', ev => { const a = ev.target.closest && ev.target.closest('[data-wx]'); if (!a) return; ev.preventDefault(); const [x, y] = a.dataset.wx.split(',').map(Number); openWx(x, y); });
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
  const r = S.wrap.getBoundingClientRect(); S.dpr = Math.max(0.5, Math.min(2, window.devicePixelRatio || 1) * (Number(MQ.res) || 1));   // 画面のこまかさ（t63）
  S.W = Math.max(1, r.width); S.H = Math.max(1, r.height);
  S.cv.width = Math.round(S.W * S.dpr); S.cv.height = Math.round(S.H * S.dpr); S.dirty = true;
  if (S.cvr) { S.cvr.width = S.cv.width; S.cvr.height = S.cv.height; }
  if (S.v3) m3Resize();
}
function hint(t) { S.hint.hidden = !t; S.hint.textContent = t ? T(t) : ''; }
function sheet(html, bind) {
  S.sheet.classList.remove('mp-s3');   // 3D でも出すシート（列車の情報。t62）
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
  if (S.v3) { m3Zoom(f); S.dirty = true; return; }   // 3D（map3d.js）
  const x = wx(px), y = wy(py), z = clamp(S.cam.z * f, zMin(), 64);
  setCam(x - (px - S.W / 2) / z, y - (py - S.H / 2) / z, z);
}
function bindInput() {
  const cv = S.cv, P = new Map();
  let drag = null, pinch = null, downAt = 0, moved = false, lp = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const p = pos(e); P.set(e.pointerId, p); S.glide = null;
    if (P.size === 1) {
      downAt = now(); moved = false;
      // 道具が点をつかむ（線の点を動かす）
      if (S.grab && S.grab(p[0], p[1])) {
        drag = { tool: true, x: p[0], y: p[1] };
        clearTimeout(lp); lp = setTimeout(() => { if (!moved && P.size === 1 && drag && drag.tool && S.onLong) { drag = null; if (S.grabEnd) S.grabEnd(); S.onLong(wx(p[0]), wy(p[1]), p[0], p[1]); } }, 550);
        return;
      }
      drag = { x: p[0], y: p[1], cx: S.cam.x, cy: S.cam.y, hist: [] };
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
      const z = clamp(pinch.z * d / Math.max(10, pinch.d), zMin(), 64);
      setCam(pinch.wx - (mx - S.W / 2) / z, pinch.wy - (my - S.H / 2) / z, z); moved = true; return;
    }
    if (!drag) return;
    if (drag.tool) { if (!moved && Math.hypot(p[0] - drag.x, p[1] - drag.y) > 4) { moved = true; clearTimeout(lp); } if (moved && S.grabMove) S.grabMove(wx(p[0]), wy(p[1])); return; }
    if (Math.hypot(p[0] - drag.x, p[1] - drag.y) > 6) moved = true;
    if (moved) {
      if (RUN.follow) runFollow(0);   // 自分でうごかしたら、追跡をやめる（t62）
      setCam(drag.cx - (p[0] - drag.x) / S.cam.z, drag.cy - (p[1] - drag.y) / S.cam.z, S.cam.z);
      const t = evT(e); drag.hist.push([t, S.cam.x, S.cam.y]); while (drag.hist.length > 2 && t - drag.hist[0][0] > 100) drag.hist.shift();
    }
  });
  const up = e => {
    const p = pos(e); P.delete(e.pointerId); clearTimeout(lp);
    if (P.size < 2) pinch = null;
    if (drag && drag.tool) { drag = null; if (S.grabEnd) S.grabEnd(); return; }
    if (drag && !moved && now() - downAt < 500 && e.type === 'pointerup') onTap(wx(p[0]), wy(p[1]), p[0], p[1]);
    // 惰性（t61）：さいごの 100ms の速さで、すこしすべる
    if (S.inertia && drag && !drag.tool && moved && P.size === 0 && e.type === 'pointerup' && drag.hist && drag.hist.length >= 2) {
      const h = drag.hist, a = h[0], b = h[h.length - 1], dt = b[0] - a[0];
      if (dt > 8 && evT(e) - b[0] < 60) { const vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt; if (Math.hypot(vx, vy) * S.cam.z > 0.05) S.glide = { vx, vy, t: now() }; }
    }
    if (P.size === 0) drag = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))); }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- いちばん近いもの ---------- */
function nearSeg(x, y, rpx, pred) {
  const it = S.vis; if (!it) return null;
  let best = null; const r = rpx / S.cam.z, far = S.cam.z < Z_FAR;
  for (const s of it.segs.values()) {
    if (pred && !pred(s)) continue;
    if (far && s.k === 'road' && s.c !== 'exp') continue;   // とても遠いとき（t108）：見えていない国道はえらばない
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
      if (z < Z_FAR) continue;   // とても遠いときは駅を出していない（t108）
      const L = Math.max(10, s.pl / 50 * z), Wd = staWd(s, z);   // drawStation と同じ（px）
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
async function lookAt(x, y, px, py) {
  if (S.layer.run && px != null) { const o = runHit(px, py); if (o) return showTrain(o.R, o.T); }   // 列車・バス（t62）
  const st = nearSta(x, y, 14);
  if (st) return showSta(st.s);
  const dp = nearDep(x, y);
  if (dp) return showDep(dp);
  const sb = S.subsOK && S.cam.z >= 2 ? nearSub(x, y, 12) : null;   // 変電所（DB の更新89）
  if (sb) return showSub(sb.v);
  const hb = hitBld(x, y);
  if (hb) { const [bx, by] = hb.cell.split(',').map(Number); return showSpot(bx, by); }
  const rw = nearRwy(x, y, 6);
  if (rw) return showRwy(rw);
  const ug = S.ugmOK && S.cam.z >= 1.5 ? nearUgm(x, y, 8) : null;   // 地下街（DB の更新109）
  if (ug) return showUgm(ug, x, y);
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
/* ---------- 高さ（t108）：縦断の図・線の高さを変える。サーバーの更新（DB の更新59）の前は出さない（mp_area の hgt。S.hgtOK） ---------- */
const HGT_MODE = { auto: '地形に合わせる', tn: 'トンネル優先', fl: '平坦（地上）', tz: '高さを決める', el: '高架', ug: '地下', man: '手で決めた高さ' };   // tn：出っぱった地形に上下を合わせず、トンネルでぬける（DB の更新81）
//   fl：地面の高さの範囲（8m 低い〜6m 高い）の中で いちばん平らに・tz：標高か地面からの高さ（m）に合わせる（DB の更新84。S.hgt2 のときだけ）
const hgtModes = () => S.hgt2 ? ['auto', 'tn', 'fl', 'tz', 'el', 'ug'] : ['auto', 'tn', 'el', 'ug'];
const hmName = (hm, ho) => hm === 'tz' && ho && ho.zt != null ? `${HGT_MODE.tz}（${ho.zr ? `地面から ${ho.zt > 0 ? '+' : ''}${ho.zt}m` : `標高 ${ho.zt}m`}）` : (HGT_MODE[hm] || '');
// 高さを決める（tz）の高さ・勾配の上限の行（DB の更新84）。o：{hm, zt, zr, gm}
function hgtOptHtml(o, kind, rack) {
  if (!S.hgt2) return '';
  const mx = kind === 'road' ? 80 : rack ? 70 : 35;
  return (o.hm === 'tz' ? `<div class="mp-row small" style="align-items:center"><span>高さ</span><input class="mp-inp" type="number" inputmode="decimal" step="1" data-zt value="${o.zt != null ? o.zt : ''}" placeholder="30" style="width:5.5em;flex:none"><span>m</span>
      <span class="mp-seg"><button data-zr="0" class="${!o.zr ? 'on' : ''}">標高</button><button data-zr="1" class="${o.zr ? 'on' : ''}">地面から</button></span></div>
      ${o.zt == null ? '<p class="mp-warn small" style="margin:2px 0">高さ（m）を入れてください</p>' : ''}` : '')
    + `<div class="mp-row small" style="align-items:center"><span>勾配の上限</span><input class="mp-inp" type="number" inputmode="numeric" step="1" min="5" max="${mx}" data-gm value="${o.gm != null ? o.gm : ''}" placeholder="${mx}" style="width:4.5em;flex:none"><span>‰</span><span class="muted">（空なら ${mx}‰ まで）</span></div>`;
}
function hgtOptBind(sh, o, changed) {
  const zt = sh.querySelector('[data-zt]'); if (zt) zt.onchange = () => { const v = parseFloat(hw(zt.value).replace(/[－−]/g, '-')); o.zt = isFinite(v) ? v : null; changed(); };
  sh.querySelectorAll('[data-zr]').forEach(b => b.onclick = () => { o.zr = b.dataset.zr === '1'; changed(); });
  const gm = sh.querySelector('[data-gm]'); if (gm) gm.onchange = () => { const v = parseFloat(hw(gm.value)); o.gm = isFinite(v) && v > 0 ? Math.round(v) : null; changed(); };
}
const hgtOpt = o => ({ zt: o.hm === 'tz' ? o.zt : null, zr: !!o.zr, gm: o.gm != null ? o.gm : null });
const hgtNoZ = o => S.hgt2 && o.hm === 'tz' && o.zt == null;   // 高さを決めるのに、高さがない
// 縦断 pf（[s, z, …]）の s マスのところの高さ（m）
function pfZ(pf, s) {
  const n = (pf || []).length / 2; if (!n) return 0;
  if (s <= pf[0]) return pf[1];
  for (let i = 0; i < n - 1; i++) if (s <= pf[2 * i + 2]) { const a = pf[2 * i], b = pf[2 * i + 2]; return pf[2 * i + 1] + (pf[2 * i + 3] - pf[2 * i + 1]) * (s - a) / Math.max(1e-6, b - a); }
  return pf[2 * n - 1];
}
// 線の地面の高さ（1マスごと。読んであるチャンクから。ないところは null）
function segGround(s) {
  const P = s.P, n = s.np, out = []; let acc = 0, k = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], d = Math.hypot(bx - ax, by - ay);
    while (k <= acc + d + 1e-6) {
      const f = d > 1e-9 ? (k - acc) / d : 0, t = tileAt(Math.floor(ax + (bx - ax) * f), Math.floor(ay + (by - ay) * f));
      out.push(t ? (/[SRLD]/.test(t.t) ? 0 : Math.max(0, t.e)) : null); k++;
    }
    acc += d;
  }
  return out;
}
// 線の いまの縦断（図のデータ）。縦断がなければ地面どおり（高速道路は 10m 上）
function segProf(s) {
  const g = segGround(s), len = s.len;
  let prof = s.pf;
  if (!prof) { prof = []; g.forEach((v, k) => { if (v != null) prof.push(Math.min(k, len), v + (s.c === 'exp' ? 10 : 0)); }); }
  return { prof, g, st: s.st || null, len };
}
// 縦断の図：地面（茶色のぬり）・線の高さ（地面 黒・切り通し 緑（DB の更新111）・高架 茶・トンネル 点線・橋 青）・点（えらんだ点はオレンジ・手で決めた点は赤）・交差（▲ 上・▼ 下・● 踏切）
function profChart(cv, d, o) {
  o = o || {};
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 300, H = cv.clientHeight || 130;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const pf = d.prof || [], n = pf.length / 2, len = Math.max(0.5, d.len || (n ? pf[2 * n - 2] : 1)), gs = d.g || [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, pf[2 * i + 1]); hi = Math.max(hi, pf[2 * i + 1]); }
  for (const v of gs) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (o.cmp) for (let i = 1; i < o.cmp.length; i += 2) { lo = Math.min(lo, o.cmp[i]); hi = Math.max(hi, o.cmp[i]); }
  if (!isFinite(lo)) { lo = 0; hi = 10; }
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  lo -= 4; hi += 4;
  const L0 = 36, R0 = 6, T0 = 8, B0 = 18, X = v => L0 + v / len * (W - L0 - R0), Y = z => T0 + (hi - z) / (hi - lo) * (H - T0 - B0);
  g.font = '10px system-ui, sans-serif'; g.fillStyle = '#777'; g.textBaseline = 'middle'; g.textAlign = 'right';
  const step = [5, 10, 20, 50, 100, 200, 500].find(v => (hi - lo) / v <= 5) || 1000;
  g.strokeStyle = '#eee'; g.lineWidth = 1;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { g.beginPath(); g.moveTo(L0, Y(v)); g.lineTo(W - R0, Y(v)); g.stroke(); g.fillText(v + 'm', L0 - 3, Y(v)); }
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillText('0', L0, H - 4); g.textAlign = 'right'; g.fillText(fmt(Math.round(len * 50)) + 'm', W - R0, H - 4);
  // 地面
  if (gs.length) {
    g.beginPath(); let first = true, lastX = L0;
    gs.forEach((v, k) => { if (v == null) return; const x = X(Math.min(k, len)); if (first) { g.moveTo(x, Y(lo)); first = false; } g.lineTo(x, Y(v)); lastX = x; });
    if (!first) { g.lineTo(lastX, Y(lo)); g.closePath(); g.fillStyle = '#efe3c6'; g.fill(); g.strokeStyle = '#b89f70'; g.lineWidth = 1; g.stroke(); }
  }
  // ホームのところ（青いおび）・いまの高さ（灰色の点線。駅の高さを変えるとき。DB の更新84）
  if (o.mark) { const a = X(clamp(o.mark[0], 0, len)), b = X(clamp(o.mark[1], 0, len)); g.fillStyle = 'rgba(31,95,191,.14)'; g.fillRect(a, T0, Math.max(2, b - a), H - T0 - B0); }
  if (o.cmp && o.cmp.length >= 4) {
    g.strokeStyle = 'rgba(80,80,80,.6)'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath();
    for (let i = 0; i < o.cmp.length / 2; i++) { const x = X(clamp(o.cmp[2 * i], 0, len)), y = Y(o.cmp[2 * i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke(); g.setLineDash([]);
  }
  // 線の高さ（1マスごとのつくりの色）
  const st = d.st || '', col = { G: '#333', V: '#9a5b2e', T: '#666', B: '#1f6fbf', C: '#2f7d4a' };   // C：切り通し（DB の更新111）
  g.lineWidth = 2.5; g.lineCap = 'round';
  for (let k = 0; k < Math.ceil(len); k++) {
    const a = k, b = Math.min(len, k + 1), c = st[Math.min(st.length - 1, k)] || 'G';
    g.strokeStyle = col[c] || '#333'; g.setLineDash(c === 'T' ? [4, 3] : []);
    g.beginPath(); g.moveTo(X(a), Y(pfZ(pf, a)));
    for (let i = 0; i < n; i++) if (pf[2 * i] > a && pf[2 * i] < b) g.lineTo(X(pf[2 * i]), Y(pf[2 * i + 1]));
    g.lineTo(X(b), Y(pfZ(pf, b))); g.stroke();
  }
  g.setLineDash([]);
  // 交差など（下のふちに）
  for (const x of d.xs || []) {
    const xx = X(Math.min(len, Math.max(0, x[0]))), yy = H - B0 + 6;
    g.fillStyle = x[1] === 'over' ? '#9a5b2e' : x[1] === 'under' ? '#3d4f66' : '#d23';
    g.beginPath();
    if (x[1] === 'over') { g.moveTo(xx, yy - 4); g.lineTo(xx - 4, yy + 3); g.lineTo(xx + 4, yy + 3); }
    else if (x[1] === 'under') { g.moveTo(xx, yy + 3); g.lineTo(xx - 4, yy - 4); g.lineTo(xx + 4, yy - 4); }
    else g.arc(xx, yy, 3, 0, 6.3);
    g.fill();
  }
  // 点
  if (o.points) for (let i = 0; i < n; i++) {
    const pin = o.pins && [...o.pins.keys()].some(k => Math.abs(k - pf[2 * i]) < 0.03), sel = o.sel === i;
    g.fillStyle = sel ? '#e8590c' : pin ? '#d23' : '#1f5fbf'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(pf[2 * i]), Y(pf[2 * i + 1]), sel ? 5.5 : pin ? 4.5 : 3, 0, 6.3); g.fill(); g.stroke();
  }
  // タップ：いちばん近い点
  cv.onclick = o.onPick ? ev => {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top; let bi = -1, bd = 1e9;
    for (let i = 0; i < n; i++) { const d2 = (X(pf[2 * i]) - mx) ** 2 + ((Y(pf[2 * i + 1]) - my) ** 2) * 0.25; if (d2 < bd) { bd = d2; bi = i; } }
    if (bi >= 0) o.onPick(bi);
  } : null;
}
// 縦断のまとめ（ことば）：いちばん急な勾配・トンネル・高架・橋・踏切・上下を通るもの
function profSum(q) {
  const ps = [`最急 ${q.maxg}‰`];
  if (q.tun) ps.push(`トンネル・地下 ${fmt(q.tun)}m`); if (q.cut) ps.push(`切り通し ${fmt(q.cut)}m`); if (q.via) ps.push(`高架 ${fmt(q.via)}m`); if (q.brg) ps.push(`橋 ${fmt(q.brg)}m`); if (q.lx) ps.push(`踏切 ${q.lx}`);
  const grp = side => { const m = new Map(); for (const x of q.xs || []) if (x[1] === side) { const k = /^建物/.test(x[2]) ? '建物' : x[2]; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, v]) => `<span>${esc(k)}</span>` + (v > 1 ? `×${v}` : '')).join('・'); };
  const ov = grp('over'), un = grp('under');
  return `<span>${ps.join('・')}</span>${ov ? `<br><small class="muted">▲ 上を通る：${ov}</small>` : ''}${un ? `<br><small class="muted">▼ 下を通る：${un}</small>` : ''}`;
}
// 地下・高架をえらんだのに とどかないとき（はしが地面で、線が短い）
function hgtShort(hm, q) {
  if (hm === 'tn' && q.hm && q.hm !== 'tn' && q.hm !== 'man') return '<p class="muted small" style="margin:2px 0">トンネル優先は、サーバーの更新（DB の更新81）のあとで使えます（いまは「地形に合わせる」で見つもりました）</p>';
  if (hm === 'fl' && (q.tun || q.via)) return '<p class="muted small" style="margin:2px 0">地面の高さのままでは引けないところ（急な山・谷）は、トンネル・高架にしています</p>';
  if (hm === 'ug' && !q.tun) return '<p class="mp-warn small" style="margin:2px 0">はしが地面の高さなので、この長さでは地下にとどきません（はしの線も地下にするか、長く引いてください）</p>';
  if (hm === 'el' && !q.via && !q.brg) return '<p class="mp-warn small" style="margin:2px 0">はしが地面の高さなので、この長さでは高架にとどきません（はしの線も高架にするか、長く引いてください）</p>';
  return '';
}
// 手で決める高さの行（図でえらんだ点を ▲5m・▼5m）
function pinRow(pf, sel, pins) {
  if (sel == null || !pf || sel * 2 >= pf.length) return '<p class="muted small" style="margin:2px 0">図の点をタップすると、その点の高さを 5m ずつ変えられます（ほかは自動）</p>';
  const v = pf[2 * sel], z = pf[2 * sel + 1], pinned = [...pins.keys()].some(k => Math.abs(k - v) < 0.03);
  return `<div class="mp-row small"><span>${fmt(Math.round(v * 50))}m のところ：高さ <b>${Math.round(z)}m</b></span>
    <button class="btn" data-pz="5" style="flex:none;padding:4px 10px">▲ 5m</button><button class="btn" data-pz="-5" style="flex:none;padding:4px 10px">▼ 5m</button>
    ${pinned ? '<button class="btn" data-pz="0" style="flex:none;padding:4px 10px">自動にもどす</button>' : ''}</div>`;
}
// えらんだ点の高さを変える（pins：s → 高さ）。新しい縦断で、同じ点をえらびなおすための s を返す
function pinSet(pins, pf, sel, dz) {
  const v = Math.round(pf[2 * sel] * 100) / 100, z = pf[2 * sel + 1];
  for (const k of [...pins.keys()]) if (Math.abs(k - v) < 0.03) pins.delete(k);
  if (dz) pins.set(v, Math.round(z + dz));
  return v;
}
const pinArr = pins => pins && pins.size ? [...pins].sort((a, b) => a[0] - b[0]).flat() : null;
const pinFind = (pf, v) => { if (v == null || !pf) return null; for (let i = 0; i < pf.length / 2; i++) if (Math.abs(pf[2 * i] - v) < 0.03) return i; return null; };
// 線の高さを変える（線のシートから）：地形に合わせる・高架・地下・アプト式・点ごとに手で。見つもり → この高さにする
function segHeight(s) {
  const st = { hm: s.hm && s.hm !== 'man' ? s.hm : 'auto', rack: !!s.rk, pins: new Map(), q: null, err: null, quoting: false, seq: 0, sel: null, pv: null,
              zt: s.ho && s.ho.zt != null ? s.ho.zt : null, zr: !!(s.ho && s.ho.zr), gm: s.ho && s.ho.gm != null ? s.ho.gm : null };   // 高さ・勾配の上限（DB の更新84）
  if (!hgtModes().includes(st.hm)) st.hm = 'auto';
  const args = dry => ({ p_id: s.id, p_mode: st.hm, p_prof: pinArr(st.pins), p_rack: s.k === 'rail' ? st.rack : null, p_dry: dry, ...(S.hgt2 ? { p_opt: hgtOpt(st) } : {}) });
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_seg_height', args(true)); } catch (e) { err = e.message; }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; st.sel = q ? pinFind(q.prof, st.pv) : null; draw();
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; st.err = null; st.sel = null; st.pins.clear(); draw(); };
  const draw = () => {
    const q = st.q, cur = segProf(s);
    sheet(`<h4>${s.k === 'rail' ? '線路' : '道路'}の高さ</h4>
      <p class="small muted" style="margin:0 0 4px">いま：${esc(hmName(s.hm, s.ho) || '地面どおり')}${s.ho && s.ho.gm ? `・勾配の上限 ${s.ho.gm}‰` : ''}${s.rk ? '・アプト式' : ''}。はしの高さは、つながっている線と同じです</p>
      <div class="mp-row"><span class="mp-seg" style="flex-wrap:wrap">${hgtModes().map(m => `<button data-hm="${m}" class="${st.hm === m ? 'on' : ''}">${HGT_MODE[m]}</button>`).join('')}</span>
        ${s.k === 'rail' ? `<label class="small"><input type="checkbox" data-rack ${st.rack ? 'checked' : ''}> アプト式（急な坂 70‰ まで・30km/h まで）</label>` : ''}</div>
      ${hgtOptHtml(st, s.k, st.rack)}
      <canvas class="mp-prof" data-prof></canvas>
      ${q ? `<p class="small" style="margin:2px 0">${profSum(q)}</p>${hgtShort(st.hm, q)}${pinRow(q.prof, st.sel, st.pins)}
        ${(q.stas || []).length ? `<p class="small" style="margin:2px 0">駅：${q.stas.map(x => `<span>${esc(x[0])}</span>（${{ G: '地上', U: '地下駅', E: '高架駅' }[x[1]]} → ${{ G: '地上', U: '地下駅', E: '高架駅' }[x[2]]}）`).join('・')}</p>` : ''}
        <div class="mp-row"><span class="mp-cost">工事費 ${X(q.cost)}</span><span class="small muted">${q.rack ? `制限速度 ${q.vlim} km/h まで` : ''}</span></div>`
        : st.err ? `<p class="mp-warn">${esc(st.err)}</p>` : st.quoting ? '<p class="muted small">見つもり中…</p>' : '<p class="muted small">図は、いまの高さです。えらんで「見つもる」を押すと、新しい高さと工事費が出ます</p>'}
      <div class="mp-row"><button class="btn" data-est ${st.quoting || hgtNoZ(st) ? 'disabled' : ''}>見つもる</button><button class="btn main" data-ok ${q ? '' : 'disabled'}>この高さにする</button></div>
      <p class="muted small" style="margin:4px 0 0">工事費は、つくりが高くなるところ（地面 → 高架・トンネル・橋など）と、地下駅・高架駅になる駅の分。もどしても返金はありません</p>`, sh => {
      hgtOptBind(sh, st, changed);
      const cv = sh.querySelector('[data-prof]');
      if (cv) profChart(cv, q ? { prof: q.prof, g: q.g, st: q.st, xs: q.xs, len: q.len } : cur, q ? { points: true, sel: st.sel, pins: st.pins, onPick: i => { st.sel = i; st.pv = q.prof[2 * i]; draw(); } } : {});
      sh.querySelectorAll('[data-hm]').forEach(b => b.onclick = () => { st.hm = b.dataset.hm; changed(); });
      { const r = sh.querySelector('[data-rack]'); if (r) r.onchange = () => { st.rack = r.checked; changed(); }; }
      sh.querySelectorAll('[data-pz]').forEach(b => b.onclick = async () => {   // だめなら（勾配がきつすぎるなど）、前にもどす
        const bk = new Map(st.pins), q0 = st.q, sel0 = st.sel;
        st.pv = pinSet(st.pins, q.prof, st.sel, Number(b.dataset.pz));
        await quote();
        if (!st.q && st.err) { st.pins = bk; st.q = q0; st.sel = sel0; toast(st.err); st.err = null; draw(); }
      });
      sh.querySelector('[data-est]').onclick = () => quote();
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_seg_height', args(false));
        if (!r) return;
        toast(r.cost > 0 ? `高さを変えました（${fmt(r.cost)} X）` : '高さを変えました');
        refreshBox(...s.bb); sheet(null); S.sel = null; S.dirty = true;
      };
    });
  };
  draw();
}
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
const TRK_D = { down: '下り', up: '上り', both: '両方' }, TRK_M = { main: '本線', side: '待避線', pass: '通過線' };   // pass：ホームのない番線（t62）
const TRK_L = { 'down:main': n => T(`${n}番線 下り本線`), 'up:main': n => T(`${n}番線 上り本線`), 'both:main': n => T(`${n}番線 上下の本線`),
                'down:side': n => T(`${n}番線 下り待避線`), 'up:side': n => T(`${n}番線 上り待避線`), 'both:side': n => T(`${n}番線 上下の待避線`),
                'down:pass': n => T(`${n}番線 下り通過線`), 'up:pass': n => T(`${n}番線 上り通過線`), 'both:pass': n => T(`${n}番線 上下の通過線`) };
const trkL = (t, i) => (TRK_L[t.d + ':' + t.m] || (n => T(`${n}番線`)))(i + 1);
async function showSpot(cx, cy) {
  if (S.favIds === undefined) { S.favIds = null; call('mp_bld_favs', {}).then(L => { S.favIds = new Set((L || []).map(b => b.id)); if (S.sel && S.sel.kind === 'cell' && S.sel.x === cx && S.sel.y === cy) showSpot(cx, cy); }).catch(() => {}); }   // お気に入り物件（DB の更新65 の前は出さない）
  S.sel = { kind: 'cell', x: cx, y: cy }; S.dirty = true;
  const sh = sheet(`<h4>${Math.floor(cx / 5)}, ${Math.floor(cy / 5)}</h4><p class="muted small">しらべています…</p>`);
  const d = await api('mp_spot', { p_x: cx, p_y: cy }); if (!d || S.sheet !== sh || !S.sel || S.sel.x !== cx || S.sel.y !== cy) return;
  if (d.none) return sheet(`<h4>地図の外です</h4>`);
  const P = d.parcel; S.sel.parcel = P ? P.id : null; S.dirty = true;
  const on = (d.on || []).map(o => onH(o.name)).join('<br>');
  sheet(`<h4><span translate="no">${esc(d.addr.text)}</span>${d.addr.ban ? ` <span>${esc(d.addr.ban)}</span>` : ''}</h4>${addrSub(d.addr)}
    <div class="mp-kv"><b>地形</b><span><span>${esc(d.ter)}</span>${d.elev ? `<small>（標高 約${d.elev}m）</small>` : ''}</span>${wxRow((cx + 0.5) / 5, (cy + 0.5) / 5)}<b>地目</b><span>${esc(d.chimoku)}</span>
      <b>用途地域</b><span>${esc(d.zname)}</span><b>人の多さ</b><span>${fmt(d.dens)} 人/km²</span>
      ${d.nz != null ? `<b>線路の騒音</b><span><span>${nzWord(d.nz)}</span><small class="muted">（${d.nz}）</small></span>` : ''}
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
      ${P && P.b && S.favIds ? `<button class="btn" data-bfav>${S.favIds.has(P.b.id) ? '★ お気に入り物件' : '☆ お気に入り物件に入れる'}</button>` : ''}
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
    if (q('[data-bfav]')) q('[data-bfav]').onclick = async () => {   // お気に入り物件（10件まで。DB の更新65）
      const on = !S.favIds.has(P.b.id), r = await api('mp_bld_fav', { p_bld: P.b.id, p_on: on }, on ? 'お気に入り物件に入れました（情報 → 建物をさがす）' : 'お気に入り物件からはずしました');
      if (r) { S.favIds = new Set(r.ids || []); showSpot(cx, cy); }
    };
    if (q('[data-jm]')) q('[data-jm]').onclick = () => openJuumin(P.b.id);   // 住民の窓口（t59）
    if (q('[data-split]')) q('[data-split]').onclick = () => startSplit(P);
    if (q('[data-merge]')) q('[data-merge]').onclick = () => startMerge(P);
    if (q('[data-home]')) q('[data-home]').onclick = () => homeHere(cx, cy, P);
  });
  S.addr.hidden = false; S.addr.textContent = (d.addr.zip ? '〒' + zipFmt(d.addr.zip) + ' ' : '') + d.addr.text + (d.addr.ban ? ' ' + d.addr.ban : '');
}
// 住所の下の行：郵便番号・ローマ字（DB の更新114）
const addrSub = a => a && (a.zip || (roOn() && a.ro)) ? `<p class="small muted" style="margin:-4px 0 6px" translate="no">${a.zip ? `〒${esc(zipFmt(a.zip))}` : ''}${roOn() && a.ro ? `${a.zip ? '　' : ''}${esc(a.ro)}` : ''}</p>` : '';
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
      ${s.k === 'road' ? `<b>車線</b><span>${s.l ? '片側' + s.l + '車線' : '中央線なし'}</span>` : `<b>線路</b><span>${s.q ? '複々線' : s.dbl ? '複線' : '単線'}・${s.el ? (S.pwOK ? `電化（${PS_N[s.ps || 0]}）` : '電化') : '非電化'}</span>`}
      ${s.k === 'rail' && S.specOK ? `<b>規格</b><span>${specHtml(s)}</span>` : ''}
      ${s.k === 'rail' && s.col ? `<b>路線カラー</b><span><span style="display:inline-block;width:2.2em;height:.8em;border-radius:3px;vertical-align:middle;background:${esc(s.col)}"></span></span>` : ''}
      <b>制限速度</b><span data-spd><span>${s.k === 'rail' && S.specOK ? Math.min(s.v, segCapAll(s)) : s.v} km/h</span></span>${segSnowRow(s)}
      ${s.k === 'rail' && S.sigOK ? `<b>信号</b><span>${SIG_N[s.sg || 0]}</span>` : ''}${subFeedRow(s)}
      ${s.k === 'rail' && s.o !== 'gov' ? thruRow(s.o) : ''}</div>
    ${s.k === 'rail' ? '<canvas class="mp-spd" data-spdc hidden></canvas>' : ''}
    ${S.hgtOK && (s.pf || s.k === 'rail') ? `<canvas class="mp-prof" data-profc></canvas><p class="small muted" style="margin:0 0 4px">${hgtLine(s)}</p>` : ''}
    ${s.mine ? `<div class="mp-row"><button class="btn" data-edit>形を直す</button><button class="btn" data-split>ここで分ける</button>${s.k === 'rail' && S.specOK ? '<button class="btn" data-merge>1本にする</button><button class="btn" data-spec>規格（軌間・枕木・架線・防音壁）</button>' : ''}<button class="btn" data-opt>${s.k === 'rail' ? '複線・電化・名前・色' : '車線・名前'}</button>${S.hgtOK ? '<button class="btn" data-hgt>⛰ 高さ</button>' : ''}${s.k === 'rail' && S.sigOK ? '<button class="btn" data-sig>🚦 信号</button>' : ''}${s.k === 'rail' && s.el && S.subsOK ? '<button class="btn" data-sub>⚡ 変電所</button>' : ''}${s.k === 'rail' && S.snowOK && (s.sp || segSnowZone(s) > 0) ? '<button class="btn" data-snowp>❄ 雪よけ</button>' : ''}<button class="btn" data-del>こわす</button></div>` : ''}`, sh => {
    const q = k => sh.querySelector(k);
    if (q('[data-edit]')) q('[data-edit]').onclick = () => startEdit(s);
    if (q('[data-split]')) q('[data-split]').onclick = async () => { if (await api('mp_seg_split', { p_id: s.id, p_x: hit.x, p_y: hit.y }, '分けました')) { refreshBox(...s.bb); sheet(null); } };
    if (q('[data-opt]')) q('[data-opt]').onclick = () => segOpts(s);
    if (q('[data-spec]')) q('[data-spec]').onclick = () => segSpec(s, hit);    // 線路の規格（DB の更新99）
    if (q('[data-merge]')) q('[data-merge]').onclick = () => segMerge(s, hit);  // 1本にする（DB の更新99）
    if (q('[data-hgt]')) q('[data-hgt]').onclick = () => segHeight(s);   // 高さ（t108）
    if (q('[data-sig]')) q('[data-sig]').onclick = () => segSig(s, hit);   // 信号（DB の更新85）
    if (q('[data-sub]')) q('[data-sub]').onclick = () => subBuild(s, hit);   // 変電所（DB の更新89）
    if (q('[data-profc]')) profChart(q('[data-profc]'), segProf(s));
    if (q('[data-snowp]')) q('[data-snowp]').onclick = () => segSnow(s, () => { if (S.sel && S.sel.kind === 'seg' && S.sel.id === s.id) showSeg(s, hit); });   // 雪よけ（t108）
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
    if (e) e.innerHTML = s.k === 'rail' ? `${sp.here != null ? `<span>ここ ${sp.here} km/h</span><br>` : ''}<small class="muted">${sp.min === sp.max ? `<span>この線 ${sp.min} km/h</span>` : `<span>この線 ${sp.min}〜${sp.max} km/h</span>`}${sp.ve != null && sp.ve < sp.max ? `<br><span>電車は ${sp.ve} km/h まで（架線）</span>` : ''}${sp.rmin && sp.rmin < 99999 ? `<br><span>いちばんきついカーブ 半径 ${fmt(sp.rmin)} m</span>` : ''}</small>` : `<span>${sp.here} km/h</span>`;
    const cv = S.sheet.querySelector('[data-spdc]'); if (cv) { cv.hidden = false; spdChart(cv, sp); }
  });
}
// 信号の段（DB の更新85）：自動閉塞（ふつう）・ATC（車内信号）・移動閉塞。強いほど、前の列車につめて走れる
const SIG_N = ['自動閉塞', 'ATC', '移動閉塞'];
const SIG_D = ['ふつう。前の列車のうしろ 30m まで近づける', '車内信号。20m まで・駅のあたりでも速いまま つめられる', '10m まで。いちばん つめられる'];
function segSig(s, hit) {
  const st = { lv: s.sg || 0, chain: true, q: null, err: null, quoting: false, seq: 0 };
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_seg_sig', { p_id: s.id, p_sig: st.lv, p_chain: st.chain, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; draw();
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; st.err = null; draw(); };
  const draw = () => {
    const q = st.q;
    sheet(`<h4>🚦 線路の信号</h4>
      <p class="small muted" style="margin:0 0 4px">いま：<span>${SIG_N[s.sg || 0]}</span>。強いほど、前の列車につめて走れます（待避・続行の待ちが へる）</p>
      ${[0, 1, 2].map(k => `<label class="small" style="display:flex;align-items:flex-start;gap:6px;margin:5px 0"><input type="radio" name="mpsig" data-lv="${k}" ${st.lv === k ? 'checked' : ''} style="flex:none;margin-top:2px"><span><b>${SIG_N[k]}</b>：<span>${SIG_D[k]}</span></span></label>`).join('')}
      <label class="small" style="display:block;margin:4px 0"><input type="checkbox" data-chain ${st.chain ? 'checked' : ''}> 分かれ道までの つながる線路も いっしょに</label>
      <div class="mp-row">${q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span><span class="small muted"><span>線路 約${fmt(q.m)}m</span><span>・通る系統 ${q.routes}</span></span>`
        : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button>'}</div>
      <div class="mp-row"><button class="btn main" data-ok ${q ? '' : 'disabled'}>この信号にする</button><button class="btn" data-back>もどる</button></div>
      <p class="muted small" style="margin:4px 0 0">工事費は上げる分だけ（1マス：ATC は線路の工事費の 0.4倍・移動閉塞は 0.8倍。複線はその倍率）。下げるのは無料（返金なし）。維持費は変わりません。変えると、通る系統の時刻（待避・続行）を計算しなおします</p>`, sh => {
      sh.querySelectorAll('[data-lv]').forEach(r => r.onchange = () => { st.lv = Number(r.dataset.lv); changed(); });
      { const c = sh.querySelector('[data-chain]'); if (c) c.onchange = () => { st.chain = c.checked; changed(); }; }
      { const e = sh.querySelector('[data-est]'); if (e) e.onclick = () => quote(); }
      sh.querySelector('[data-back]').onclick = () => showSeg(s, hit);
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_seg_sig', { p_id: s.id, p_sig: st.lv, p_chain: st.chain, p_dry: false });
        if (!r) return;
        toast(r.cost > 0 ? `信号を変えました（${fmt(r.cost)} X）` : '信号を変えました');
        s.sg = st.lv; refreshBox(...s.bb); showSeg(s, hit);
      };
    });
  };
  draw();
}
// 線路の規格（DB の更新99）：軌間（三線軌条）・枕木・架線（電化した線）・防音壁。見つもり（工事費・上限の速さ・1日の維持費・走れなくなる列車）
function segSpec(s, hit) {
  const st = { ga: s.ga || 1067, g2: s.g2 || 0, sl: s.sl || 0, ct: s.ct || 0, nw: s.nw || 0, chain: false, q: null, err: null, quoting: false, seq: 0 };
  const same = () => st.ga === (s.ga || 1067) && st.g2 === (s.g2 || 0) && st.sl === (s.sl || 0) && (!s.el || st.ct === (s.ct || 0)) && st.nw === (s.nw || 0);
  const spec = () => ({ gauge: st.ga, g2: st.g2 && st.g2 !== st.ga ? st.g2 : 0, slp: st.sl, nw: st.nw, ...(s.el ? { cat: st.ct } : {}) });
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_seg_spec', { p_id: s.id, p_spec: spec(), p_chain: st.chain, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; draw();
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; st.err = null; draw(); };
  const seg = (k, list, cur, lab) => `<span class="mp-seg" style="flex-wrap:wrap">${list.map(v => `<button data-${k}="${v}" class="${cur === v ? 'on' : ''}">${lab(v)}</button>`).join('')}</span>`;
  const draw = () => {
    const q = st.q;
    sheet(`<h4>線路の規格</h4>
      <p class="small muted" style="margin:0 0 4px">いま：${specHtml(s)}</p>
      <h4 style="margin:8px 0 4px">軌間</h4>
      <div class="mp-row small">${seg('ga', GAUGES, st.ga, v => `${v}mm`)}</div>
      <div class="mp-row small" style="align-items:center"><span>三線軌条</span>${seg('g2', [0, ...GAUGES.filter(v => v !== st.ga)], st.g2 === st.ga ? 0 : st.g2, v => v ? `＋${v}mm` : 'なし')}</div>
      <p class="muted small" style="margin:0"><span>軌間が合わない列車は走れません（三線軌条なら、2つの軌間の列車が走れます）。</span>${SEP()}<span>上限：762mm 70km/h・1067mm 160km/h・1372mm 130km/h・1435mm 300km/h・三線軌条 130km/h</span></p>
      <h4 style="margin:10px 0 4px">枕木</h4>
      ${SLP_ORDER.map(k => `<label class="small" style="display:flex;align-items:flex-start;gap:6px;margin:4px 0"><input type="radio" name="mpslp" data-sl="${k}" ${st.sl === k ? 'checked' : ''} style="flex:none;margin-top:2px"><span><b><span>${SLP_N[k]}枕木</span></b>（<span>${SLP_V[k]}km/h まで</span>）：<span>${SLP_D[k]}</span></span></label>`).join('')}
      ${s.el ? `<h4 style="margin:10px 0 4px">架線</h4>
        ${CAT_ORDER.map(k => `<label class="small" style="display:flex;align-items:flex-start;gap:6px;margin:4px 0"><input type="radio" name="mpcat" data-ct="${k}" ${st.ct === k ? 'checked' : ''} style="flex:none;margin-top:2px"><span><b><span>${CAT_N[k]}</span></b>（<span>電車は ${CAT_V[k]}km/h まで</span>）：<span>${CAT_D[k]}</span></span></label>`).join('')}
        ${st.ct === 6 && (s.ct || 0) !== 6 ? '<p class="mp-warn small" style="margin:2px 0">第三軌条にすると直流750Vになり、いまの電車（架線の電車）は走れなくなります</p>' : ''}
        ${st.ct !== 6 && (s.ct || 0) === 6 ? '<p class="small muted" style="margin:2px 0">架線にすると直流1500Vになります</p>' : ''}` : '<p class="muted small" style="margin:8px 0 0">架線の種類は、電化した線でえらべます（複線・電化・名前・色 で電化）</p>'}
      <h4 style="margin:10px 0 4px">防音壁</h4>
      <div class="mp-row small">${seg('nw', [0, 1, 2], st.nw, v => NW_N[v])}</div>
      <p class="muted small" style="margin:0"><span>家の近くを速く・たくさん走ると、騒音で まわりの地価とまちの成長が少し下がります。</span>${SEP()}<span>防音壁で騒音は半分、高い防音壁で4分の1（トンネルの中は騒音なし）。</span></p>
      <label class="small" style="display:block;margin:8px 0 4px"><input type="checkbox" data-chain ${st.chain ? 'checked' : ''}> <span>分かれ道までの つながる線路も いっしょに</span></label>
      <div class="mp-row">${same() ? '<span class="muted small">いまと同じ規格です</span>' : q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span><span class="small muted"><span>線路 約${fmt(q.m)}m</span><span>・通る系統 ${q.routes}</span></span>`
        : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button>'}</div>
      ${q && !same() ? `<p class="small" style="margin:2px 0"><span>上限の速さ：列車 ${q.v}km/h</span>${q.ve != null ? `<span>・電車 ${Math.min(q.v, q.ve)}km/h</span>` : ''}${SEP()}<span>・維持費 1日 ${X(q.up0)} → ${X(q.up1)}</span></p>
        ${q.bad ? `<p class="mp-warn small" style="margin:2px 0">${esc(T(`軌間が合わなくなって、走れなくなる列車が ${q.bad}本あります`))}</p>` : ''}` : ''}
      <div class="mp-row"><button class="btn main" data-ok ${q && !same() ? '' : 'disabled'}>この規格にする</button><button class="btn" data-back>もどる</button></div>
      <p class="muted small" style="margin:4px 0 0"><span>工事費は1マスごと：改軌は線路の工事費の半分くらい（軌間で ちがう）・三線軌条を足す 0.35倍・枕木の取りかえ・架線の取りかえ・防音壁。</span>${SEP()}<span>へらす（三線軌条をやめる・防音壁をへらす）のは無料（返金なし）。変えると、通る系統の時刻を計算しなおします</span></p>`, sh => {
      sh.querySelectorAll('[data-ga]').forEach(b => b.onclick = () => { st.ga = Number(b.dataset.ga); if (st.g2 === st.ga) st.g2 = 0; changed(); });
      sh.querySelectorAll('[data-g2]').forEach(b => b.onclick = () => { st.g2 = Number(b.dataset.g2); changed(); });
      sh.querySelectorAll('[data-sl]').forEach(r => r.onchange = () => { st.sl = Number(r.dataset.sl); changed(); });
      sh.querySelectorAll('[data-ct]').forEach(r => r.onchange = () => { st.ct = Number(r.dataset.ct); changed(); });
      sh.querySelectorAll('[data-nw]').forEach(b => b.onclick = () => { st.nw = Number(b.dataset.nw); changed(); });
      { const c = sh.querySelector('[data-chain]'); if (c) c.onchange = () => { st.chain = c.checked; changed(); }; }
      { const e = sh.querySelector('[data-est]'); if (e) e.onclick = () => quote(); }
      sh.querySelector('[data-back]').onclick = () => showSeg(s, hit);
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_seg_spec', { p_id: s.id, p_spec: spec(), p_chain: st.chain, p_dry: false });
        if (!r) return;
        toast(r.cost > 0 ? T(`規格を変えました（${fmt(r.cost)} X）`) : T('規格を変えました'));
        s.ga = st.ga === 1067 ? undefined : st.ga; s.g2 = st.g2 && st.g2 !== st.ga ? st.g2 : undefined; s.sl = st.sl || undefined; s.nw = st.nw || undefined;
        if (s.el) { s.ct = st.ct || undefined; s.ps = st.ct === 6 ? 3 : s.ps === 3 ? 0 : s.ps; }
        refreshBox(...s.bb); showSeg(s, hit);
      };
    });
  };
  draw();
}
// 線路を1本にする（DB の更新99）：つなぎ目で となりの線と結合。設定がちがうときは、えらんだ線にそろえる（そろえる工事費）
async function segMerge(s, hit) {
  const r0 = await api('mp_seg_merge', { p_a: s.id, p_b: null, p_keep: null, p_dry: true }); if (!r0) return;
  const cands = r0.cands || [];
  const st = { b: null, qa: null, qb: null, busy: false };
  const nm = c => c.n ? c.n : T(`線路（${fmt(c.m)}m）`);
  const pick = async c => {
    st.b = c; st.qa = st.qb = null; st.busy = true; draw();
    const [qa, qb] = await Promise.all([call('mp_seg_merge', { p_a: s.id, p_b: c.id, p_keep: s.id, p_dry: true }).catch(e => ({ err: errJa(e.message) })),
                                        call('mp_seg_merge', { p_a: s.id, p_b: c.id, p_keep: c.id, p_dry: true }).catch(e => ({ err: errJa(e.message) }))]);
    if (st.b !== c) return;
    st.qa = qa; st.qb = qb; st.busy = false; draw();
  };
  const opt = (q, keep, label) => !q ? '' : `<div class="mp-item" data-optw="${keep}"><div class="small"><b>${label}</b></div>
      ${q.err ? `<p class="mp-warn small" style="margin:2px 0">${esc(q.err)}</p>` : `<div class="mp-row" style="align-items:center;margin:4px 0 0"><span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span>
        <button class="btn main" data-go="${keep}" ${hasNeed(q) ? 'disabled' : ''}>1本にする</button></div>${needH(q.need)}`}</div>`;
  const draw = () => {
    const c = st.b;
    sheet(`<h4>線路を1本にする</h4>
      <p class="small muted" style="margin:0 0 4px">つなぎ目（分かれ道のない点）で、となりの線と1本にします。駅・車庫はそのまま。設定がちがうときは、どちらかの線にそろえます</p>
      ${cands.length ? `<div class="mp-list">${cands.map((x, i) => `<button class="mp-item" style="text-align:left${c && c.id === x.id ? ';outline:2px solid var(--accent)' : ''}" data-c="${i}"><b><span>${x.end ? 'おわりのほう' : 'はじめのほう'}</span>：<span translate="no">${esc(nm(x))}</span></b>
          <br><small>${x.rack ? '<span class="mp-warn">アプト式の線とは1本にできません</span>' : x.dif && x.dif.length ? `<span>設定のちがい：</span><span>${x.dif.map(d => esc(d)).join('・')}</span>` : '<span>設定は同じ</span>'}</small></button>`).join('')}</div>`
        : '<p class="muted small">1本にできる となりの線がありません（分かれ道のある点・ほかの持ち主の線とは、1本にできません）</p>'}
      ${c && st.busy ? '<p class="muted small">見つもり中…</p>' : ''}
      ${c && !st.busy ? (st.qa && st.qa.dif && !st.qa.dif.length ? opt(st.qa, s.id, T('1本にする（設定は同じ）'))
        : opt(st.qa, s.id, T('この線の設定に そろえる')) + opt(st.qb, c.id, T('となりの線の設定に そろえる'))) : ''}
      <div class="mp-row"><button class="btn" data-back>もどる</button></div>
      <p class="muted small" style="margin:4px 0 0">そろえる工事費は、それぞれの設定を変えるのと同じです（へらす分は無料・返金なし）。名前と路線カラーも そろえます</p>`, sh => {
      sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const x = cands[Number(b.dataset.c)]; if (x && !x.rack) pick(x); });
      sh.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => {
        const r = await api('mp_seg_merge', { p_a: s.id, p_b: c.id, p_keep: Number(b.dataset.go), p_dry: false });
        if (!r) return;
        toast(r.cost > 0 ? T(`1本にしました（${fmt(r.cost)} X）`) : T('1本にしました'));
        refreshAll(); sheet(null);
      });
      sh.querySelectorAll('[data-optw]').forEach(w => { const q = Number(w.dataset.optw) === s.id ? st.qa : st.qb; needBind(w, q && q.need, () => pick(c)); });
      sh.querySelector('[data-back]').onclick = () => showSeg(s, hit);
    });
  };
  draw();
}
// 線の高さのことば（線のシート）：高さのえらびかた・トンネル・高架・橋の長さ（t108）
function hgtLine(s) {
  if (!s.pf) return s.c === 'exp' ? '高さ：地面から 10m（高架）' : '高さ：地面どおり';
  const n = c => ((s.st || '').split(c).length - 1) * 50, ps = [];
  if (n('T')) ps.push(`トンネル・地下 ${fmt(n('T'))}m`); if (n('C')) ps.push(`切り通し ${fmt(n('C'))}m`); if (n('V')) ps.push(`高架 ${fmt(n('V'))}m`); if (n('B')) ps.push(`橋 ${fmt(n('B'))}m`);
  return `高さ：${esc(hmName(s.hm, s.ho) || '地形に合わせる')}${s.ho && s.ho.gm ? `・勾配の上限 ${s.ho.gm}‰` : ''}${s.rk ? '・アプト式' : ''}${ps.length ? '（' + ps.join('・') + '）' : ''}`;
}
// 住所をシートと上の帯に
async function addrInto(x, y, still) {   // x, y：マス（50m）の座標。その場所の区画（10m）の住所
  const d = await api('mp_spot', { p_x: Math.floor(x * 5), p_y: Math.floor(y * 5) }); if (!d || !d.addr || !still()) return null;
  const e = S.sheet.querySelector('[data-addr]'); if (e) e.textContent = d.addr.text;
  S.addr.hidden = false; S.addr.textContent = d.addr.text;
  return d;
}
function segOpts(s) {
  const st = { dbl: s.dbl, qd: !!s.q, ps: s.ps || 0, el: s.el, l: s.l, name: s.n || '', q: null, quoting: false, seq: 0, col: s.col || null, rts: null, same: 0, sc: 'one' };   // qd：複々線（DB の更新86）
  const same = () => st.dbl === s.dbl && st.qd === !!s.q && st.el === s.el && st.l === s.l && (!st.el || st.ps === (s.ps || 0));   // 名前だけ
  const oa = dry => ({ p_id: s.id, p_dbl: st.dbl, p_elec: st.el, p_name: st.name, p_dry: dry, p_lanes: st.l, ...(S.quadOK && s.k === 'rail' ? { p_quad: st.qd } : {}), ...(S.pwOK && s.k === 'rail' ? { p_ps: st.ps } : {}) });
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; draw();
    const q = await api('mp_seg_opts', oa(true));
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; draw();
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; draw(); };
  const draw = () => {
    const q = st.q;
    sheet(`<h4 data-segopt="${s.id}">${s.k === 'rail' ? '線路' : '道路'}の設定</h4>
      ${s.k === 'rail' ? `<div class="mp-row"><span class="mp-seg"><button data-d="0" class="${!st.dbl ? 'on' : ''}">単線</button><button data-d="1" class="${st.dbl && !st.qd ? 'on' : ''}">複線</button>${S.quadOK ? `<button data-d="2" class="${st.qd ? 'on' : ''}">複々線</button>` : ''}</span>
        <span class="mp-seg"><button data-e="0" class="${!st.el ? 'on' : ''}">非電化</button><button data-e="1" class="${st.el ? 'on' : ''}">電化</button></span></div>
        ${S.pwOK && st.el ? `<div class="mp-row small" style="align-items:center"><span>電化方式</span><span class="mp-seg">${PS_N.slice(0, 3).map((n, k) => `<button data-ps="${k}" class="${st.ps === k ? 'on' : ''}">${n}</button>`).join('')}</span></div>` : ''}`
      : `<div class="mp-row">片側 <span class="mp-seg">${[0, 1, 2, 3].map(n => `<button data-l="${n}" class="${st.l === n ? 'on' : ''}">${n ? n + '車線' : '細い道'}</button>`).join('')}</span></div>`}
      <div class="mp-row"><input class="mp-inp" data-nm placeholder="名前（路線名など）" value="${esc(st.name)}"></div>
      ${s.k === 'rail' ? `<h4 style="margin:10px 0 4px">路線カラー</h4>
        <div class="mp-row" style="align-items:center;flex-wrap:wrap"><input type="color" data-col value="${esc(st.col || '#d23d3d')}" style="width:52px;height:36px;border:0;background:none">
          ${(st.rts || []).filter(r => /^#[0-9a-f]{6}$/i.test(r.c || '')).map(r => `<button class="btn" data-sw="${esc(r.c)}" style="padding:4px 8px;font-size:12px;flex:0 1 auto"><span style="display:inline-block;width:1.4em;height:1em;border-radius:3px;vertical-align:middle;background:${esc(r.c)}"></span> <span translate="no">${esc(r.n)}</span></button>`).join('')}</div>
        ${(st.rts || []).length ? '<p class="muted small" style="margin:0">系統の名前のボタンで、その系統の色になります</p>' : ''}
        <div class="small" style="display:flex;flex-direction:column;gap:4px;margin:4px 0">
          <label><input type="radio" name="colsc" value="one" ${st.sc === 'one' ? 'checked' : ''}> <span>この線だけ</span></label>
          ${s.n && st.same > 1 ? `<label><input type="radio" name="colsc" value="name" ${st.sc === 'name' ? 'checked' : ''}> <span>${esc(T(`同じ名前（${s.n}）の線路ぜんぶ（${st.same}本）`))}</span></label>` : ''}
          ${(st.rts || []).map(r => `<label><input type="radio" name="colsc" value="r${r.id}" ${st.sc === 'r' + r.id ? 'checked' : ''}> <span>${esc(T(`系統「${r.n}」が通る線路ぜんぶ`))}</span></label>`).join('')}
          ${st.rts === null ? '<span class="muted">通る系統を読みこんでいます…</span>' : ''}</div>
        <div class="mp-row"><button class="btn" data-colok>この色にする</button><button class="btn" data-colx>色をなくす</button></div>
        <p class="muted small">路線カラーは、だれが見ても地図にこの色で出ます。お金はかかりません。色をつけるのは自分の線路だけです（ほかの人の線路は、その持ち主が決めます）</p>` : ''}
      <div class="mp-row">${same() ? '' : q ? `<span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、変えられます</span>'}</div>
      ${!same() && q ? needH(q.need) : ''}
      <p class="muted small">もとにもどしても（単線にする・車線をへらす）お金はもどりません</p>
      <div class="mp-row"><button class="btn main" data-ok ${same() || (q && !hasNeed(q)) ? '' : 'disabled'}>この設定にする</button></div>`, sh => {
      needBind(sh, !same() && q && q.need, () => quote());
      sh.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { st.dbl = b.dataset.d !== '0'; st.qd = b.dataset.d === '2'; changed(); });
      sh.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { st.el = b.dataset.e === '1'; changed(); });
      sh.querySelectorAll('[data-ps]').forEach(b => b.onclick = () => { st.ps = Number(b.dataset.ps); changed(); });   // 電化方式（DB の更新87）
      sh.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { st.l = Number(b.dataset.l); changed(); });
      { const es = sh.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
      sh.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
      // 路線カラー：この線だけ・同じ名前の線路・系統が通る線路（どれも自分の線路だけ）
      const setCol = async c => {
        const r = await api('mp_seg_color', { p_id: s.id, p_color: c, p_all: st.sc === 'name', p_route: st.sc[0] === 'r' ? Number(st.sc.slice(1)) : null });
        if (r) { toast(c ? T(`路線カラーをつけました（${r.n}本）`) : T(`路線カラーをなくしました（${r.n}本）`)); s.col = r.color; st.col = r.color; refreshAll(); }
      };
      { const e = sh.querySelector('[data-col]'); if (e) e.oninput = () => { st.col = e.value; }; }
      sh.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { st.col = b.dataset.sw; const e = sh.querySelector('[data-col]'); if (e) e.value = st.col; });
      sh.querySelectorAll('input[name=colsc]').forEach(b => b.onchange = () => { if (b.checked) st.sc = b.value; });
      { const e = sh.querySelector('[data-colok]'); if (e) e.onclick = () => setCol(sh.querySelector('[data-col]').value); }
      { const e = sh.querySelector('[data-colx]'); if (e) e.onclick = () => setCol(null); }
      sh.querySelector('[data-ok]').onclick = async () => {
        st.name = sh.querySelector('[data-nm]').value;
        if (await api('mp_seg_opts', oa(false), '設定を変えました')) { refreshBox(...s.bb); sheet(null); }
      };
    });
  };
  draw();
  // 路線カラー：この線路を通る系統（はじめは、いちばん上の系統が通る線路ぜんぶに）
  if (s.k === 'rail') api('mp_seg_routes', { p_id: s.id }).then(r => {
    st.rts = r ? r.routes : []; st.same = r ? r.same : 0;
    st.sc = st.rts.length ? 'r' + st.rts[0].id : s.n && st.same > 1 ? 'name' : 'one';
    if (!st.col && st.rts.length && /^#[0-9a-f]{6}$/i.test(st.rts[0].c || '')) st.col = st.rts[0].c;
    if (S.sheet && !S.sheet.hidden && S.sheet.querySelector(`[data-segopt="${s.id}"]`)) { st.name = (S.sheet.querySelector('[data-nm]') || {}).value ?? st.name; draw(); }
  });
}
async function segDel(s) {
  if (!await confirm2(T('この線をこわしますか？（工事費はもどりません）'), { what: s.n ? `「${s.n}」` : '', q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません。工事費はもどりません。' })) return;
  if (await api('mp_seg_del', { p_id: s.id }, 'こわしました')) { refreshBox(...s.bb); sheet(null); S.sel = null; }
}
function showSta(s) {
  S.sel = { kind: 'sta', id: s.id }; S.dirty = true;
  const air = s.k === 'air', port = s.k === 'ship' || air, pdep = port ? [...S.vis.deps.values()].find(d => d.k === s.k && d.b != null && d.b === s.b) : null;
  const gov = air && s.o === 'gov', adm = gov && S.admin;   // 国の空港（t54q）：だれでも使える。名前・使用料は管理者
  sheet(`<h4>${s.k === 'rail' ? '🚉 ' : air ? '✈ ' : port ? '⚓ ' : '🚏 '}<span>${esc(s.n)}</span>${s.k === 'rail' ? '<span>駅</span>' : gov ? '<span>（国の空港）</span>' : air ? '<span>（空港）</span>' : port ? '<span>（港）</span>' : ''}</h4><p class="small muted" data-addr translate="no" style="margin:0"></p>
    <div class="mp-kv"><b>持ち主</b><span><span>${s.o === 'gov' ? '国' : esc(S.vis.names[s.o] || '')}</span>${s.mine && s.o !== 'gov' ? '<small>（あなた）</small>' : ''}</span>
      ${wxRow(s.fx, s.fy)}${snowStaRow(s)}
      ${s.k === 'rail' ? `<b>ホーム</b><span>${s.pl} m・${s.tr}番線まで${pfName(s.pf, s.tr) ? `<br><span>${esc(pfName(s.pf, s.tr))}</span>` : ''}</span>` : ''}
      ${s.k === 'rail' && S.hgtOK ? `<b>高さ</b><span>${STA_LV[s.zl || 'G']}</span>` : ''}
      ${s.k === 'rail' && S.supOK ? `<b>補給</b><span>${s.wt || s.cl ? `<span>${[s.wt ? '💧 給水' : '', s.cl ? '⛏ 給炭' : ''].filter(Boolean).join('・')}</span><small class="muted">（蒸気機関車）</small>` : '<span class="muted">給水・給炭の設備はありません</span>'}</span>` : ''}
      ${s.k === 'rail' && s.tk ? `<b>発着番線</b><span>${s.tk.map((t, i) => `<span>${esc(trkL(t, i))}</span>`).join('<br>')}</span>` : ''}
      ${s.k === 'rail' && tomeOn() ? (() => { const ts = [...S.vis.deps.values()].filter(d => d.st === s.id);   // 留置線（DB の更新105）
        return `<b>留置線</b><span>${ts.length ? ts.map(d => { const [l, n] = tomeDim(d.sz); return `<span translate="no">${esc(d.n)}</span>（${esc(T(`${l}m・${n}本`))}）`; }).join('<br>') : '<span class="muted">なし</span>'}</span>`; })() : ''}
      ${gov ? `<b>使用料</b><span>${s.ln != null ? `<span>空路に入れると 1路線・1日 ${X(s.ln)}（国庫へ）</span>` : '<span>いまは新しい空路に使えません</span>'}</span>`
        : s.k === 'bus' || port ? `<b>貸し出し</b><span>${s.ln != null ? `<span>ほかの人・会社に貸しています（1系統・1日 ${X(s.ln)}）</span>` : '<span>ほかの人・会社には貸していません</span>'}</span>` : ''}
      ${air ? `<b>滑走路</b><span>${s.pl > 0 ? `<span>${fmt(s.pl)}m（いちばん長い滑走路）</span>` : '<span class="mp-warn">まだありません（飛行機は飛べません）</span>'}</span><b>発着口</b><span><span>${s.tr}こ</span>（<span>1つで1時間に1便</span>）</span>` : ''}
      ${port && pdep ? (gov ? `<b>駐機場</b><span>${pdep.cap}機まで（みんなで使う）</span>` : air ? `<b>駐機場</b><span>${pdep.cap}機まで</span>` : `<b>船の置き場</b><span>${pdep.cap}隻まで</span>`) : ''}
      <b>${air ? '空路' : port ? '航路' : '系統'}</b><span>${(s.rt || []).map(r => `<a href="#" data-rt="${r.id}" style="color:${esc(r.c)};font-weight:800">■ ${esc(r.n)}</a>`).join('<br>') || 'なし'}</span>
      ${s.k === 'rail' ? thruRow(s.o) : ''}
      ${s.k === 'rail' && S.ugmOK ? (() => { const us = [...S.vis.ugm.values()].filter(g => g.sta === s.id);   // 地下街（DB の更新109）
        return us.length ? `<b>地下街</b><span>${us.map(g => `<a href="#" data-ugm="${g.id}" translate="no">${esc(g.n)}</a>（${fmt(Math.round(g.L * 50))}m）`).join('<br>')}</span>` : ''; })() : ''}</div>
    ${gov ? `<div class="mp-row"><button class="btn main" data-slot>🛫 発着口・入札</button>${pdep ? '<button class="btn" data-cars>飛行機を見る・注文する</button>' : ''}<button class="btn" data-newr>＋ 空路</button>${adm ? '<button class="btn" data-ren>名前を変える</button><button class="btn" data-lend>使用料</button>' : ''}</div>
      <p class="muted small"><span>国の空港です。だれでも駐機場に飛行機を置いて（≡ →「車両と編成」）、空路に使えます。空路に入れると、1路線・1日の使用料を国にはらいます（使いはじめたときの値段のまま）。</span><span>この空港を出る便は、1時間に、持っている発着口の数まで（発着口の権利は入札で買います）</span></p>`
    : s.mine && port ? `<div class="mp-row"><button class="btn" data-ren>名前を変える</button><button class="btn" data-lend>貸し出し</button>${pdep ? (air ? '<button class="btn" data-cars>飛行機を見る</button>' : '<button class="btn" data-cars>船を見る</button>') : ''}${air ? '<button class="btn" data-newr>＋ 空路</button>' : '<button class="btn" data-newr>＋ 航路</button>'}</div>
      <p class="muted small">${air ? '空港は、空港の建物をこわすとなくなります' : '港は、フェリーターミナルの建物をこわすとなくなります'}</p>` : s.mine ? `<div class="mp-row"><button class="btn" data-ren>名前を変える</button>${s.k === 'bus' ? '<button class="btn" data-lend>貸し出し</button>' : '<button class="btn" data-plat>ホーム・番線</button><button class="btn" data-trk>' + (pfOn() ? '発着番線・ホームの形' : '発着番線') + '</button>' + (S.hgt2 ? '<button class="btn" data-sth>⛰ 駅の高さ</button>' : '') + (tomeOn() ? '<button class="btn" data-tome>🅿 留置線をつくる</button>' : '') + (ugmOn() ? '<button class="btn" data-ugmb>🛍 地下街をつくる</button>' : '')}${s.k === 'rail' && S.snowOK && (s.ml || snowZoneAt(s.fx, s.fy) > 0) ? `<button class="btn" data-melt>${s.ml ? '融雪器をはずす' : '❄ 融雪器をつける'}</button>` : ''}${s.k === 'rail' && S.supOK ? `<button class="btn" data-sup="water">${s.wt ? '給水設備をはずす' : '💧 給水設備をつくる'}</button><button class="btn" data-sup="coal">${s.cl ? '給炭設備をはずす' : '⛏ 給炭設備をつくる'}</button>` : ''}<button class="btn" data-del>こわす</button></div>` : ''}
    ${S.admin && (s.rt || []).length ? '<div class="mp-row"><button class="btn" data-unkomk>🚦 乱れを起こす（管理者）</button></div>' : ''}`, sh => {
    const cs = sh.querySelector('[data-cars]'); if (cs) cs.onclick = () => openCars(pdep.id);
    const um = sh.querySelector('[data-unkomk]'); if (um) um.onclick = () => unkoMake(s);   // t108
    const mt = sh.querySelector('[data-melt]'); if (mt) mt.onclick = () => staMelt(s, () => { if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) showSta(s); });   // 融雪器（t108）
    sh.querySelectorAll('[data-sup]').forEach(x => x.onclick = () => staSup(s, x.dataset.sup, () => { if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) showSta(s); }));   // 給水・給炭（DB の更新78）
    const sl = sh.querySelector('[data-slot]'); if (sl) sl.onclick = () => openSlots(s.id);
    const nr = sh.querySelector('[data-newr]'); if (nr) nr.onclick = () => { sheet(null); routeBuild(s.k); };
    sh.querySelectorAll('[data-rt]').forEach(a => a.onclick = ev => { ev.preventDefault(); openDia(Number(a.dataset.rt)); });
    const th = sh.querySelector('[data-thru]'); if (th) th.onclick = () => thruReq({ sta: s.id }, () => { if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) showSta(s); });
    const tk = sh.querySelector('[data-trk]'); if (tk) tk.onclick = () => trkEdit(s);
    const ub = sh.querySelector('[data-ugmb]'); if (ub) ub.onclick = () => startUgm(s);   // 地下街（DB の更新109）
    sh.querySelectorAll('[data-ugm]').forEach(a => a.onclick = ev => { ev.preventDefault(); const g = S.vis.ugm.get(Number(a.dataset.ugm)); if (g) showUgm(g); });
    const pl = sh.querySelector('[data-plat]'); if (pl) pl.onclick = () => staResize(s);
    const sth = sh.querySelector('[data-sth]'); if (sth) sth.onclick = () => staHeight(s);   // 駅の高さ（DB の更新84）
    const ld = sh.querySelector('[data-lend]'); if (ld) ld.onclick = async () => {
      const v = prompt(gov ? T('国の空港の使用料（1路線・1日・X）。空にすると、新しい空路には使えなくなります（いまの空路は、そのまま使えます）') : T('ほかの人・会社に貸す使用料（1系統・1日・X）。空にすると貸しません（いま使っている系統は、そのまま使えます）'), s.ln != null ? String(s.ln) : '1000');
      if (v == null) return;
      const t = hw(v).replace(/[,，\s]/g, ''), n = t === '' ? null : Number(t);
      if (n != null && !(n >= 0)) return toast('数字を入れてください');
      const r = await api('mp_stop_lend', { p_id: s.id, p_lend: n }, gov ? (n == null ? '新しい空路には使えなくしました' : '使用料を決めました') : n == null ? '貸すのをやめました' : '貸し出します');
      if (r) { s.ln = r.lend; refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); showSta(s); }
    };
    { const tb = sh.querySelector('[data-tome]'); if (tb) tb.onclick = () => { setTool('dep'); S.toolState = { tome: s.id }; hint('留置線：駅の近くの線路の上で、はじめと終わりをタップします（ホームの はしより先・同じ線路の上）'); }; }   // 留置線（DB の更新105）
    const r = sh.querySelector('[data-ren]'); if (r) r.onclick = async () => { const nm = prompt(T('新しい名前'), s.n); if (nm && await api('mp_sta_edit', { p_id: s.id, p_name: nm, p_del: false }, '名前を変えました')) refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); };
    const d = sh.querySelector('[data-del]'); if (d) d.onclick = async () => { if (await confirm2(T('こわしますか？（工事費はもどりません）'), { what: `「${s.n}」`, q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません。工事費はもどりません。' }) && await api('mp_sta_edit', { p_id: s.id, p_name: null, p_del: true }, 'こわしました')) { refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); sheet(null); } };
  });
  addrInto(s.fx, s.fy, () => S.sel && S.sel.kind === 'sta' && S.sel.id === s.id);
  if (s.k === 'rail' && s.o !== myKey() && !thruFresh()) loadThru().then(() => { if (S.sel && S.sel.kind === 'sta' && S.sel.id === s.id) showSta(s); });
}
/* ---------- 地下街（DB の更新109）：自分の駅から 道路の下に のばす。駅の乗り降りする人が お店に来る ---------- */
const ugmOn = () => { lookOn(); return (S.dbv || 0) >= 109; };
const UGM_W = 14 / 50;   // はば 14m（マス）
// 2D：うすい だいだいの帯と、点線のふち
function drawUgm(g, it, z) {
  const w = Math.max(3, UGM_W * z);
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  for (const u of it.ugm.values()) {
    const P = u.P; if (P.length < 2) continue;
    const on = S.sel && S.sel.kind === 'ugm' && S.sel.id === u.id;
    g.beginPath(); g.moveTo(sx(P[0][0]), sy(P[0][1])); for (let i = 1; i < P.length; i++) g.lineTo(sx(P[i][0]), sy(P[i][1]));
    g.setLineDash([]); g.strokeStyle = on ? 'rgba(232,140,24,.6)' : 'rgba(240,164,48,.38)'; g.lineWidth = w; g.stroke();
    if (z >= 4) { g.setLineDash([Math.max(4, 0.14 * z), Math.max(3, 0.09 * z)]); g.strokeStyle = on ? '#a85c00' : 'rgba(168,92,0,.75)'; g.lineWidth = Math.max(1, Math.min(2.5, 0.04 * z)); g.stroke(); }
    if (z >= 10 && u.n) {   // 名前（まん中あたり）
      let L = 0, k = 1; for (; k < P.length; k++) { const d = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); if (L + d >= u.L / 2) break; L += d; }
      const a = P[Math.min(k, P.length - 1) - 1], b = P[Math.min(k, P.length - 1)], t = Math.hypot(b[0] - a[0], b[1] - a[1]) ? (u.L / 2 - L) / Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
      label(g, u.n, sx(a[0] + (b[0] - a[0]) * t), sy(a[1] + (b[1] - a[1]) * t), { size: 11, color: '#7a4300', bg: 'rgba(255,248,236,.85)' });
    }
  }
  g.restore();
}
// 地下街をタップしたか（まん中の線から はばの半分 ＋ rpx の半分）
function nearUgm(x, y, rpx) {
  const it = S.vis; if (!it || !it.ugm) return null; let best = null;
  for (const u of it.ugm.values()) {
    const P = u.P;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1][0], ay = P[i - 1][1], dx = P[i][0] - ax, dy = P[i][1] - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0, d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
      if (d <= UGM_W / 2 + rpx / 2 / S.cam.z && (!best || d < best.d)) best = { u, d };
    }
  }
  return best && best.u;
}
async function showUgm(u, tx, ty) {
  S.sel = { kind: 'ugm', id: u.id }; S.dirty = true;
  sheet(`<h4>🛍 <span translate="no">${esc(u.n)}</span><span>（地下街）</span></h4><p class="muted small">読みこんでいます…</p>`);
  const d = await api('mp_ugm_get', { p_id: u.id });
  if (!d || !S.sel || S.sel.kind !== 'ugm' || S.sel.id !== u.id) return;
  const st = S.vis && S.vis.stas.get(d.sta);
  sheet(`<h4>🛍 <span translate="no">${esc(d.name)}</span><span>（地下街）</span></h4>
    <div class="mp-kv"><b>持ち主</b><span><span>${esc(d.who || '')}</span>${d.mine ? '<small>（あなた）</small>' : ''}</span>
      <b>駅</b><span>${st ? `<a href="#" data-sta translate="no">${esc(d.sname || '')}</a>` : `<span translate="no">${esc(d.sname || '')}</span>`}</span>
      <b>長さ</b><span><span>${fmt(d.m)}m</span>・<span>はば ${d.w}m</span></span>
      <b>お客さん</b><span>${d.n != null ? `<span>1日 ${fmt(d.n)}人</span> / <span>1日に入れる人 ${fmt(d.cap)}人</span>` : '<span class="muted">つぎの1時間から数えます</span>'}</span>
      ${d.pool != null ? `<b>来る見こみ</b><span><span>${fmt(d.pool)}人</span> <small>（駅の乗り降りの 8%。同じ駅の地下街で 長さで分けます）</small></span>` : ''}
      <b>お店の売り上げ</b><span><span>1人</span> <span>${X(d.fee)}</span>${d.rev != null ? ` <small>（<span>24時間 ${X(d.rev)}</span>）</small>` : ''}</span>
      ${d.up != null ? `<b>維持費</b><span>1日 ${X(d.up)}</span>` : ''}
      ${d.cost != null ? `<b>工事費</b><span>${X(d.cost)}</span>` : ''}</div>
    <p class="muted small" style="margin:2px 0 6px"><span>駅の乗り降りする人が、地下街のお店に来ます。売り上げと維持費は 1時間ごとです。</span>${S.v3 ? '' : '<span>3D の「地下」で、地下街の中が見られます。</span>'}</p>
    <div class="mp-row">${d.mine ? '<button class="btn" data-ren>名前を変える</button><button class="btn" data-del>こわす</button>' : ''}${tx != null ? '<button class="btn" data-road>上の道路を見る</button>' : ''}</div>`, sh => {
    const bb = () => { const xs = u.P.map(p => p[0]), ys = u.P.map(p => p[1]); refreshBox(Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2); };
    const sa = sh.querySelector('[data-sta]'); if (sa) sa.onclick = ev => { ev.preventDefault(); showSta(st); };
    const rd = sh.querySelector('[data-road]'); if (rd) rd.onclick = () => { const sg = nearSeg(tx, ty, 10, q => q.k === 'road'); if (sg) showSeg(sg.s, sg); else showSpot(Math.floor(tx * 5), Math.floor(ty * 5)); };
    const rn = sh.querySelector('[data-ren]'); if (rn) rn.onclick = async () => {
      const nm = prompt(T('地下街の名前（30文字まで）'), d.name); if (nm == null || !nm.trim()) return;
      if (await api('mp_ugm_set', { p_id: u.id, p_name: nm.trim() }, '名前を変えました')) { u.n = nm.trim(); bb(); showUgm(u, tx, ty); }
    };
    const dl = sh.querySelector('[data-del]'); if (dl) dl.onclick = async () => {
      if (!await confirm2(T(`「${d.name}」をこわします（工事費はもどりません）。よろしいですか？`), { what: `「${d.name}」`, q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません' })) return;
      if (await api('mp_ugm_del', { p_id: u.id }, 'こわしました')) { sheet(null); S.sel = null; bb(); }
    };
  });
}
// 駅のホーム（まっすぐとみなす）から (x, y) までの きょり（マス）
function staDist(s, x, y) {
  const h = s.pl / 100, c = Math.cos(s.a), n = Math.sin(s.a), ax = s.fx - c * h, ay = s.fy - n * h, dx = 2 * c * h, dy = 2 * n * h, L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}
// 線 s の上の at0 から at1 までの あいだの点（向きのとおり）
function segBetween(s, a0, a1) {
  const P = s.P, out = []; let acc = 0; const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  for (let i = 0; i < s.np; i++) {
    if (i) acc += Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
    if (acc > lo + 0.02 && acc < hi - 0.02) out.push([P[2 * i], P[2 * i + 1]]);
  }
  return a1 >= a0 ? out : out.reverse();
}
// 地下街をなぞる：駅のそばをタップしてから、道路の上をタップしていく（道路の線にすいつく。同じ道路なら まがり角もなぞる）
function startUgm(s) {
  setTool('look');
  const st = { s, pts: [], q: null, err: null, seq: 0, timer: 0 };
  S.toolState = st; S.sel = { kind: 'sta', id: s.id };
  const flat = () => {   // 送る点（ほとんどまっすぐな なぞった点は へらす。80点まで）
    const a = st.pts.filter((p, i) => {
      if (!p.mid || i === 0 || i === st.pts.length - 1) return true;
      const q = st.pts[i - 1], r = st.pts[i + 1], a1 = Math.atan2(p.y - q.y, p.x - q.x), a2 = Math.atan2(r.y - p.y, r.x - p.x);
      return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))) > 0.05;
    });
    return a.flatMap(p => [Math.round(p.x * 100), Math.round(p.y * 100)]);
  };
  const quote = () => {
    clearTimeout(st.timer); st.q = null; st.err = null;
    if (st.pts.length < 2) return ugmSheet(st);
    ugmSheet(st);
    const my = ++st.seq, pts = flat();
    st.timer = setTimeout(async () => {
      let q = null, err = null;
      try { q = await call('mp_ugm_build', { p_sta: s.id, p_pts: pts, p_name: '', p_as: S.as, p_dry: true }); } catch (e) { err = errJa(e.message); }
      if (st.seq !== my || S.toolState !== st) return;
      st.q = q; st.err = err; st.sent = pts; S.dirty = true; ugmSheet(st);
    }, 300);
  };
  st.quote = quote;
  S.drawTool = (g, z) => {
    if (S.toolState !== st || !st.pts.length) return;
    const P = st.pts, ok = st.q && st.q.ok;
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    if (P.length > 1) {
      g.beginPath(); g.moveTo(sx(P[0].x), sy(P[0].y)); for (let i = 1; i < P.length; i++) g.lineTo(sx(P[i].x), sy(P[i].y));
      g.strokeStyle = ok ? 'rgba(232,140,24,.55)' : 'rgba(120,120,120,.45)'; g.lineWidth = Math.max(4, UGM_W * z); g.stroke();
      g.strokeStyle = ok ? '#a85c00' : '#555'; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]);
    }
    for (const [i, p] of P.entries()) if (!p.mid) { g.fillStyle = i === 0 ? '#1f5fbf' : '#a85c00'; g.beginPath(); g.arc(sx(p.x), sy(p.y), i === 0 ? 6 : 4.5, 0, 6.3); g.fill(); }
    const marks = (arr, c) => { g.fillStyle = c; for (const b of arr || []) { g.beginPath(); g.arc(sx(b[0] / 100), sy(b[1] / 100), Math.max(3, 0.06 * z), 0, 6.3); g.fill(); } };
    if (st.q) { marks(st.q.bad, 'rgba(210,30,30,.85)'); marks(st.q.ov, 'rgba(150,40,160,.85)'); }
    g.restore();
  };
  S.tapHook = (x, y) => {
    if (S.cam.z < 3) { setCam(x, y, 6); hint('近づいてから、駅のそば・道路の上をタップします'); return; }
    if (!st.pts.length) {
      if (staDist(s, x, y) > 1.0 + (0.22 * Math.max(1, s.tr) + 0.18) / 2) { toast(T('はじめは、駅のそば（ホームから 50m 以内）をタップします')); return; }
      st.pts.push({ x, y });
    } else {
      if (st.pts.length >= 80) { toast(T('点が多すぎます（80まで）')); return; }
      const sn = nearSeg(x, y, 18, q => q.k === 'road' && q.c !== 'exp'), last = st.pts[st.pts.length - 1];
      const p = sn ? { x: sn.x, y: sn.y, sid: sn.s.id, at: sn.at } : { x, y };
      if (sn && last.sid === sn.s.id && last.at != null) for (const q of segBetween(sn.s, last.at, sn.at)) st.pts.push({ x: q[0], y: q[1], sid: sn.s.id, mid: true });
      st.pts.push(p);
    }
    quote(); S.dirty = true;
  };
  S.toolEnd = () => { clearTimeout(st.timer); S.tapHook = null; S.toolState = null; S.drawTool = null; };
  S.onSheetClose = () => { if (S.toolState === st) { setTool('look'); } };
  hint('地下街：駅のそば（ホームから 50m 以内）をタップしてから、道路の上をタップしていきます');
  ugmSheet(st);
}
function ugmSheet(st) {
  if (S.toolState !== st) return;
  const q = st.q, s = st.s, n = st.pts.length;
  sheet(`<h4>🛍 <span>地下街をつくる</span> <small class="muted">（<span translate="no">${esc(s.n)}</span>）</small></h4>
    ${n < 2 ? `<p class="muted small">${n ? '<span>つぎに、道路の上をタップしていきます（道路の線にすいつきます。同じ道路なら まがり角も なぞります）</span>' : '<span>はじめに、駅のそば（ホームから 50m 以内）をタップします</span>'}</p>`
      : q ? `<div class="mp-kv"><b>長さ</b><span><span>${fmt(q.m)}m</span>・<span>はば ${q.w}m</span></span>
          <b>工事費</b><span class="mp-cost">${X(q.cost)}</span>
          <b>維持費</b><span>1日 ${X(q.up)}</span>
          <b>お客さんの見こみ</b><span><span>1日 ${fmt(q.n)}人</span> / <span>1日に入れる人 ${fmt(q.cap)}人</span><br><small>（<span>駅の乗り降り 1日 ${fmt(q.flow)}人</span>${q.others ? `・<span>同じ駅の地下街 ${q.others}本と 長さで分けます</span>` : ''}）</small></span>
          <b>売り上げの見こみ</b><span>24時間 ${X(q.rev)} <small>（1人 ${X(q.fee)}）</small></span></div>
        ${q.ok ? '' : `<p class="mp-warn">${esc(q.why || '')}</p>`}${q.bad && q.bad.length ? '<p class="muted small"><span style="color:#d21e1e">●</span> <span>道路の下でないところ（そこに点を足すか、1つもどします）</span></p>' : ''}${q.ov && q.ov.length ? '<p class="muted small"><span style="color:#962aa0">●</span> <span>ほかの地下街と重なるところ</span></p>' : ''}`
      : st.err ? `<p class="mp-warn">${esc(st.err)}</p>` : '<p class="muted small">見つもっています…</p>'}
    <div class="mp-row">${n ? '<button class="btn" data-undo>1つもどす</button><button class="btn" data-clr>はじめから</button>' : ''}<button class="btn main" data-ok ${q && q.ok ? '' : 'disabled'}>つくる</button><button class="btn" data-quit>やめる</button></div>
    <p class="muted small" style="margin:4px 0 0"><span>地下街は、駅から 道路の下に のばします（25m〜1km・はば 14m）。駅の乗り降りする人が お店に来て、1時間ごとに売り上げが入ります（維持費も）。</span></p>`, sh => {
    const un = sh.querySelector('[data-undo]'); if (un) un.onclick = () => { st.pts.pop(); while (st.pts.length && st.pts[st.pts.length - 1].mid) st.pts.pop(); st.quote(); S.dirty = true; };
    const cl = sh.querySelector('[data-clr]'); if (cl) cl.onclick = () => { st.pts = []; st.quote(); S.dirty = true; };
    sh.querySelector('[data-quit]').onclick = () => { sheet(null); setTool('look'); showSta(s); };
    const ok = sh.querySelector('[data-ok]'); if (ok) ok.onclick = async () => {
      if (!q || !q.ok || !st.sent) return;
      if (!confirm(T(`地下街（${fmt(q.m)}m）をつくります。工事費 ${X(q.cost)}。よろしいですか？`))) return;
      const r = await api('mp_ugm_build', { p_sta: s.id, p_pts: st.sent, p_name: '', p_as: S.as, p_dry: false });
      if (!r) return;
      toast(T(`「${r.name}」をつくりました（${fmt(r.cost)} X）`));
      const b = r.bb || []; refreshBox(b[0] / 100 - 2, b[1] / 100 - 2, b[2] / 100 + 2, b[3] / 100 + 2);
      setTool('look'); sheet(null); S.dirty = true;
    };
  });
  S.onSheetClose = () => { if (S.toolState === st) setTool('look'); };
}

// 駅の高さを変える（DB の更新84）：地上駅・高架駅・地下駅。ホームの前後の線路の高さを決めなおす。見つもってから
const STA_LV = { G: '地上駅', E: '高架駅', U: '地下駅' };
function staHeight(s) {
  const cur = s.zl || 'G', sg = S.vis && S.vis.segs.get(s.seg);
  const st = { lv: cur === 'G' ? 'E' : 'G', q: null, err: null, quoting: false, seq: 0 };
  S.sel = { kind: 'sta', id: s.id }; S.dirty = true;
  const quote = async () => {
    const my = ++st.seq; st.quoting = true; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_sta_height', { p_id: s.id, p_lv: st.lv, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err; draw();
  };
  const changed = () => { st.seq++; st.quoting = false; st.q = null; st.err = null; draw(); };
  const draw = () => {
    const q = st.q;
    sheet(`<h4>🚉 <span>${esc(s.n)}</span><span>駅の高さ</span></h4>
      <p class="small muted" style="margin:0 0 4px">いま：<span>${STA_LV[cur]}</span></p>
      <div class="mp-row"><span class="mp-seg">${['G', 'E', 'U'].map(k => `<button data-lv="${k}" class="${st.lv === k ? 'on' : ''}" ${k === cur ? 'disabled' : ''}>${STA_LV[k]}</button>`).join('')}</span></div>
      <canvas class="mp-prof" data-prof></canvas>
      ${q ? `<p class="small" style="margin:2px 0">${profSum(q)}</p>
        <p class="small muted" style="margin:2px 0"><span>高さを決めなおす線路 約${fmt(q.m)}m</span>${q.segs > 1 ? `<span>（${q.segs}本の線）</span>` : ''}<span>・点線は いまの高さ</span></p>
        <div class="mp-row"><span class="mp-cost">${q.cost > 0 ? '工事費 ' + X(q.cost) : '工事費なし'}</span></div>`
        : st.err ? `<p class="mp-warn">${esc(st.err)}</p>` : st.quoting ? '<p class="muted small">見つもり中…</p>' : '<p class="muted small">図は、いまの線の高さです（青いところがホーム）。えらんで「見つもる」を押すと、新しい高さと工事費が出ます</p>'}
      <div class="mp-row"><button class="btn" data-est ${st.quoting ? 'disabled' : ''}>見つもる</button><button class="btn main" data-ok ${q ? '' : 'disabled'}>この高さにする</button><button class="btn" data-back>もどる</button></div>
      <p class="muted small" style="margin:4px 0 0">ホームの前後の線路の高さを決めなおします（ほかの駅・車庫のところは、いまの高さのまま）。工事費は、つくりが高くなるところ（地面 → 高架・トンネルなど）と、地下駅・高架駅の分。もどしても返金はありません</p>`, sh => {
      const cv = sh.querySelector('[data-prof]');
      if (cv && q) profChart(cv, { prof: q.prof, g: q.g, st: q.st, xs: q.xs, len: q.len }, { mark: q.sta, cmp: q.cur });
      else if (cv && sg) profChart(cv, segProf(sg), { mark: [s.at - s.pl / 100, s.at + s.pl / 100] });
      sh.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { st.lv = b.dataset.lv; changed(); });
      sh.querySelector('[data-est]').onclick = () => quote();
      sh.querySelector('[data-back]').onclick = () => showSta(s);
      sh.querySelector('[data-ok]').onclick = async () => {
        const r = await api('mp_sta_height', { p_id: s.id, p_lv: st.lv, p_dry: false });
        if (!r) return;
        toast(r.cost > 0 ? `駅の高さを変えました（${fmt(r.cost)} X）` : '駅の高さを変えました');
        s.zl = st.lv === 'G' ? null : st.lv;
        refreshBox(s.fx - 60, s.fy - 60, s.fx + 60, s.fy + 60); showSta(s);
      };
    });
  };
  draw();
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
/* ---------- ホームの形（DB の更新107）：pf は 番線のあいだ（両はしも）ごとに P（ホーム）・-（なし）。はじめの T は頭端式。番線は 駅の向きの左から ---------- */
const pfOn = () => { lookOn(); return (S.dbv || 0) >= 107; };
function pfGaps(pf, n) { if (!pf) return null; const g = pf[0] === 'T' ? pf.slice(1) : pf; return g.length === n + 1 && /^[P-]+$/.test(g) ? g : null; }
// 名前：相対式 2面2線 など（決めていなければ null）
function pfName(pf, n) {
  const g = pfGaps(pf, n); if (!g) return null;
  let isl = 0, side = 0; for (let k = 0; k <= n; k++) if (g[k] === 'P') { if (k > 0 && k < n) isl++; else side++; }
  return T((pf[0] === 'T' ? '頭端式' : isl && side ? '島式＋相対式' : isl ? '島式' : '相対式') + `（${isl + side}面${n}線）`);
}
// 決まった形（番線 n）：{ g（あいだの P・-）, trk }。下りは左がわ・上りは右がわ（まん中は両方）。ホームのない番線は通過線。
//   その向きで まん中に近い ホームの番線が本線、ほかは待避線
function pfPreset(kind, n) {
  const g = new Array(n + 1).fill('-');
  if (kind === 'opp') { g[0] = 'P'; if (n > 1) g[n] = 'P'; }
  else if (kind === 'isl') { for (let k = 1; k < n; k += 2) g[k] = 'P'; if (n % 2) g[n] = 'P'; }
  else { g[0] = 'P'; for (let k = 2; k < n; k += 2) g[k] = 'P'; if (n % 2 === 0) g[n] = 'P'; }
  const trk = [];
  for (let k = 0; k < n; k++) trk.push({ d: n === 1 || 2 * k === n - 1 ? 'both' : 2 * k < n - 1 ? 'down' : 'up', m: g[k] === 'P' || g[k + 1] === 'P' ? 'side' : 'pass' });
  for (const dd of ['down', 'up', 'both']) {
    let best = -1, bd = 1e9;
    trk.forEach((t, k) => { if (t.d === dd && t.m !== 'pass' && Math.abs(k - (n - 1) / 2) < bd) { bd = Math.abs(k - (n - 1) / 2); best = k; } });
    if (best >= 0 && (dd !== 'both' || n === 1)) trk[best].m = 'main';
  }
  return { g: g.join(''), trk };
}
// 駅の発着番線を決める：番線ごとに 下り・上り・両方／本線・待避線（待避線があると、優先番号の低い列車がそこで待避する）。
//   DB の更新107 から：ホームの形も（上が 駅の向きの左。ホームを押すと つける・はずす）
async function trkEdit(s) {
  const d = await api('mp_sta_trk', { p_sta: s.id }); if (!d) return;
  if (pfOn()) return pfEdit(s, d);
  const cur = d.trk.map(t => ({ ...t }));
  const m = modal(['発着番線', ''], null);
  const draw = () => m.set('発着番線', `<p class="small" style="margin:0"><b>${esc(d.name)}</b>（<span>${d.tracks}番線まで</span>）</p>
      <div class="mp-list">${cur.map((t, i) => `<div class="mp-row small" style="align-items:center;margin-top:4px"><b style="min-width:4.5em">${i + 1}番線</b>
        <span class="mp-seg">${['down', 'up', 'both'].map(k => `<button data-td="${i}:${k}" class="${t.d === k ? 'on' : ''}">${TRK_D[k]}</button>`).join('')}</span>
        <span class="mp-seg">${['main', 'side', 'pass'].map(k => `<button data-tm="${i}:${k}" class="${t.m === k ? 'on' : ''}">${TRK_M[k]}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="mp-row"><button class="btn main" data-ok>決める</button><button class="btn" data-def>いつもの決まりにもどす</button></div>
      <p class="muted small"><span>通過線はホームのない番線です。止まる列車は使わず、通過する列車が、止まっている列車を追いこせます（その向きに番線が2つ以上あると、待避できる駅になります）。</span><br><span>地図で駅に近づくと、ホームの中に番線の番号（1・2…）が出ます。</span><br><span>列車は、ふだんはその向きの本線に止まります（採時駅で番線を決めた列車は、その番線）。その向きで使える番線が2つ以上ある駅は待避できます。優先番号の大きい列車は待避線で待ち、あとから来る優先番号の小さい列車に先をゆずります</span></p>`, b => {
    b.querySelectorAll('[data-td]').forEach(x => x.onclick = () => { const [i, k] = x.dataset.td.split(':'); cur[Number(i)].d = k; draw(); });
    b.querySelectorAll('[data-tm]').forEach(x => x.onclick = () => { const [i, k] = x.dataset.tm.split(':'); cur[Number(i)].m = k; draw(); });
    b.querySelector('[data-ok]').onclick = async () => { const r = await api('mp_sta_trk_set', { p_sta: s.id, p_trk: cur }, '決めました'); if (r) { s.tk = r.trk; m.close(); showSta(s); } };
    b.querySelector('[data-def]').onclick = async () => { const r = await api('mp_sta_trk_set', { p_sta: s.id, p_trk: null }, 'もどしました'); if (r) { s.tk = r.trk; m.close(); showSta(s); } };
  });
  draw();
}
function pfEdit(s, d) {
  const n = Math.max(1, d.tracks), cur = d.trk.map(t => ({ ...t }));
  let g = pfGaps(d.pf, n), term = !!(d.pf && d.pf[0] === 'T');   // g：null は おまかせ
  const m = modal(['発着番線・ホームの形', ''], null);
  const fix = () => { if (!g) return; cur.forEach((t, k) => { if (g[k] !== 'P' && g[k + 1] !== 'P') t.m = 'pass'; }); };   // ホームのない番線は 通過線
  const gapRow = k => {
    const on = g && g[k] === 'P', isl = k > 0 && k < n;
    return `<button class="mp-pfg${on ? ' on' : ''}" data-pg="${k}" ${g ? '' : 'disabled'} style="display:block;width:100%;margin:3px 0;padding:${on ? 6 : 2}px 8px;border-radius:6px;border:1px ${on ? 'solid #9aa3ad' : 'dashed #c7ccd2'};background:${on ? '#eef0f2' : 'transparent'};color:${on ? '#333' : '#9aa0a6'};font-size:12px;text-align:center">${on ? `<span>${isl ? '島式のホーム' : '片側のホーム'}</span>` : g ? '<span>＋ ホーム</span>' : ''}</button>`;
  };
  const trkRow = (t, i) => `<div class="mp-row small" style="align-items:center;margin:0;padding:4px 6px;border-left:4px solid ${t.m === 'pass' ? '#c7ccd2' : '#6b7480'}"><b style="min-width:4.5em">${i + 1}番線</b>
        <span class="mp-seg">${['down', 'up', 'both'].map(k => `<button data-td="${i}:${k}" class="${t.d === k ? 'on' : ''}">${TRK_D[k]}</button>`).join('')}</span>
        <span class="mp-seg">${['main', 'side', 'pass'].map(k => `<button data-tm="${i}:${k}" class="${t.m === k ? 'on' : ''}">${TRK_M[k]}</button>`).join('')}</span></div>`;
  const draw = () => m.set('発着番線・ホームの形', `<p class="small" style="margin:0"><b>${esc(d.name)}</b>（<span>${n}番線まで</span>）</p>
      <p class="small" style="margin:6px 0 2px"><b>ホームの形</b>：<span>${g ? esc(pfName((term ? 'T' : '') + g, n)) : 'おまかせ'}</span></p>
      <div class="mp-row small" style="flex-wrap:wrap;gap:4px"><span class="mp-seg"><button data-pp="auto" class="${g ? '' : 'on'}">おまかせ</button><button data-pp="opp">相対式</button><button data-pp="isl">島式</button>${n >= 2 ? '<button data-pp="mix">島式＋相対式</button>' : ''}</span>
        <button class="btn${term ? ' main' : ''}" data-pt ${g ? '' : 'disabled'} style="padding:4px 10px">${term ? '✓ ' : ''}<span>頭端式</span></button></div>
      <p class="muted small" style="margin:2px 0 4px">${g ? '<span>上が 駅の向きの左がわです（地図の 1番線のがわ）。ホームを押すと、つける・はずす</span>' : '<span>おまかせ：番線の使いかたから、ホームの場所を決めます</span>'}</p>
      <div style="border:1px solid #e1e4e8;border-radius:8px;padding:4px 6px">${cur.map((t, i) => gapRow(i) + trkRow(t, i)).join('') + gapRow(n)}</div>
      <div class="mp-row"><button class="btn main" data-ok>決める</button><button class="btn" data-def>いつもの決まりにもどす</button></div>
      <p class="muted small"><span>通過線はホームのない番線です。止まる列車は使わず、通過する列車が、止まっている列車を追いこせます（その向きに番線が2つ以上あると、待避できる駅になります）。</span><br><span>頭端式は、線路の行き止まりの駅で使います（線路のはしに 車止め・ホームを横につなぐ）。</span><br><span>列車は、ふだんはその向きの本線に止まります（採時駅で番線を決めた列車は、その番線）。3Dでは、列車は その番線に入ります</span></p>`, b => {
    b.querySelectorAll('[data-td]').forEach(x => x.onclick = () => { const [i, k] = x.dataset.td.split(':'); cur[Number(i)].d = k; draw(); });
    b.querySelectorAll('[data-tm]').forEach(x => x.onclick = () => { const [i, k] = x.dataset.tm.split(':'); cur[Number(i)].m = k; draw(); });
    b.querySelectorAll('[data-pg]').forEach(x => x.onclick = () => { if (!g) return; const k = Number(x.dataset.pg); g = g.slice(0, k) + (g[k] === 'P' ? '-' : 'P') + g.slice(k + 1); fix(); draw(); });
    b.querySelectorAll('[data-pp]').forEach(x => x.onclick = () => {
      if (x.dataset.pp === 'auto') { g = null; term = false; draw(); return; }
      const P = pfPreset(x.dataset.pp, n); g = P.g; P.trk.forEach((t, k) => { cur[k].d = t.d; cur[k].m = t.m; }); draw();
    });
    b.querySelector('[data-pt]').onclick = () => { if (g) { term = !term; draw(); } };
    const done = r => { s.tk = r.trk; s.pf = r.pf || null; m.close(); refreshBox(s.fx - 6, s.fy - 6, s.fx + 6, s.fy + 6); showSta(s); };
    b.querySelector('[data-ok]').onclick = async () => { const r = await api('mp_sta_pf_set', { p_sta: s.id, p_pf: g ? (term ? 'T' : '') + g : null, p_trk: cur }, '決めました'); if (r) done(r); };
    b.querySelector('[data-def]').onclick = async () => {
      const r = await api('mp_sta_pf_set', { p_sta: s.id, p_pf: null, p_trk: null }); if (!r) return;
      const r2 = await api('mp_sta_trk_set', { p_sta: s.id, p_trk: null }, 'もどしました'); if (r2) done({ trk: r2.trk, pf: null });
    };
  });
  draw();
}
function showDep(d) {
  S.sel = { kind: 'dep', id: d.id }; S.dirty = true;
  if (/^R/.test(d.sz || '')) return showTome(d);   // 留置線（DB の更新105）
  sheet(`<h4>🏭 ${esc(d.n)}</h4><div class="mp-kv"><b>種類</b><span>${d.k === 'rail' ? '車両基地' : 'バスの営業所'}（${d.sz}）</span><b>入る数</b><span>${d.k === 'rail' ? `${d.cap}両` : `${d.cap}台`}</span>${depSnowRow(d)}</div>
    ${d.mine ? `<div class="mp-row"><button class="btn" data-cars>車両を見る</button>${S.snowOK && (d.k === 'rail' || d.k === 'bus') ? `<button class="btn" data-plow>❄ ${d.k === 'rail' ? 'ラッセル車' : '除雪トラック'}</button>` : ''}<button class="btn" data-ren>名前を変える</button><button class="btn" data-del>こわす</button></div>` : ''}`, sh => {
    const c = sh.querySelector('[data-cars]'); if (c) c.onclick = () => openCars(d.id);
    const pw = sh.querySelector('[data-plow]'); if (pw) pw.onclick = () => depPlow(d, () => { if (S.sel && S.sel.kind === 'dep' && S.sel.id === d.id) showDep(d); });   // 除雪車（t108）
    const r = sh.querySelector('[data-ren]'); if (r) r.onclick = async () => { const nm = prompt(T('新しい名前'), d.n); if (nm && await api('mp_dep_edit', { p_id: d.id, p_name: nm, p_del: false }, '名前を変えました')) refreshBox(d.fx - 8, d.fy - 8, d.fx + 8, d.fy + 8); };
    const x = sh.querySelector('[data-del]'); if (x) x.onclick = async () => { if (await confirm2(T('こわしますか？（工事費はもどりません）'), { what: d.n ? `「${d.n}」` : '', q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません。工事費はもどりません。' }) && await api('mp_dep_edit', { p_id: d.id, p_name: null, p_del: true }, 'こわしました')) { refreshBox(d.fx - 8, d.fy - 8, d.fx + 8, d.fy + 8); sheet(null); } };
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
    <p class="muted small"><span>空港の滑走路の長さは、いちばん長い滑走路です。長さで飛べる飛行機が決まります（コミューター機 800m・プロペラ機 1,200m・小型ジェット 1,800m・中型ワイドボディ 2,300m・ジャンボ 2,800m）。</span><span>滑走路の区画は国の土地で、建物は建てられません。道路・線路は地下（地面より 10m 深く）なら通れます。もう一度タップすると、引きなおせます</span></p>`, s => {
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
      if (!await confirm2(T('この滑走路をこわしますか？（工事費はもどりません）'), { what: `滑走路 ${r.n}`, q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません。工事費はもどりません。' })) return;
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
  hint('合筆：となりの自分の筆をタップしてえらびます（同じ町字・建物なし。合わせて3,000区画以上なら、町字がちがっても合筆できます：テーマパークの土地）');
  const draw = () => sheet(`<h4>合筆</h4><p class="small">${[...marks.values()].map(p => esc(p.ban)).join('・')}（<span>${marks.size}筆</span>・<span>${fmt([...marks.values()].reduce((a, p) => a + (p.n || 0), 0))}区画</span>）</p>
    ${S.parkOK ? `<p class="muted small" style="margin:0 0 4px">合わせて 3,000区画（30ha）以上なら、町字がちがう筆も合筆できます（テーマパークの土地。区画のいちばん多い筆の地番がのこります）</p>` : ''}
    <div class="mp-row"><button class="btn main" data-ok ${marks.size >= 2 ? '' : 'disabled'}>合筆する</button></div>`, s => {
    s.querySelector('[data-ok]').onclick = async () => {
      const r = await api('mp_parcel_merge', { p_ids: [...marks.keys()], p_as: S.as, p_dry: false });
      if (r) { toast(T(r.xcho ? `町字をまたいで合筆しました（${r.ban}・${fmt(r.n * 100)}㎡）` : `合筆しました（${r.ban}・${fmt(r.n * 100)}㎡）`)); for (const p of marks.values()) refreshP(p); setTool('look'); }
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
  const st = S.toolState = { kind, mode, rad, ctrl: [], A: null, B: null, curve: [], quote: null, err: null, opts: { dbl: false, elec: false, lanes: admin ? 2 : 1, cls: admin ? 'nat' : 'priv', name: '', hm: 'auto', rack: false, ...specLoad() }, qt: 0, pins: new Map(), psel: null, pv: null };
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
  // 形が変わったら、見つもりはやりなおし（「見つもる」を押す）。送っている見つもりの答えはすてる。手で決めた高さもやりなおし
  st.quote = null; st.err = null; st.qseq = (st.qseq || 0) + 1; st.quoting = false; if (st.pins) st.pins.clear(); st.psel = null;
  S.dirty = true;
  drawSheet();
}
// 線をひくときの規格（DB の更新99）：軌間・三線軌条・枕木・架線（電化するとき）・防音壁。前に えらんだものを この端末におぼえる
function specLoad() {
  let v = null; try { v = JSON.parse(localStorage.getItem('mp_spec') || 'null'); } catch (e) { v = null; }
  v = v && typeof v === 'object' ? v : {};
  return { ga: GAUGES.includes(v.ga) ? v.ga : 1067, g2: GAUGES.includes(v.g2) && v.g2 !== v.ga ? v.g2 : 0, sl: [0, 1, 2, 3].includes(v.sl) ? v.sl : 0,
           ct: [0, 1, 2, 3, 4, 5, 6].includes(v.ct) ? v.ct : 0, nw: [0, 1, 2].includes(v.nw) ? v.nw : 0 };
}
function specSave(o) { try { localStorage.setItem('mp_spec', JSON.stringify({ ga: o.ga, g2: o.g2, sl: o.sl, ct: o.ct, nw: o.nw })); } catch (e) {} }
const specOpt = o => ({ gauge: o.ga || 1067, g2: o.g2 && o.g2 !== o.ga ? o.g2 : 0, slp: o.sl || 0, cat: o.elec ? o.ct || 0 : 0, nw: o.nw || 0 });
function specPick(o) {
  const ga = o.ga || 1067, g2 = o.g2 && o.g2 !== ga ? o.g2 : 0;
  const sum = specHtml({ ga, g2, sl: o.sl, el: o.elec, ct: o.ct, nw: o.nw });
  const va = Math.min(GAUGE_V[ga], g2 ? Math.min(130, GAUGE_V[g2]) : 300, SLP_V[o.sl || 0]), ve = o.elec ? Math.min(va, CAT_V[o.ct || 0]) : null;
  return `<div class="mp-row small" style="align-items:center"><span>規格</span><span style="flex:1 1 auto">${sum}</span><button class="btn" data-specx style="flex:0 0 auto">${o.specOpen ? 'とじる' : '変える'}</button></div>
    ${o.specOpen ? `<div class="mp-row small" style="align-items:center"><span>軌間</span><span class="mp-seg" style="flex-wrap:wrap">${GAUGES.map(v => `<button data-bga="${v}" class="${ga === v ? 'on' : ''}">${v}mm</button>`).join('')}</span></div>
      <div class="mp-row small" style="align-items:center"><span>三線軌条</span><span class="mp-seg" style="flex-wrap:wrap">${[0, ...GAUGES.filter(v => v !== ga)].map(v => `<button data-bg2="${v}" class="${g2 === v ? 'on' : ''}">${v ? `＋${v}mm` : 'なし'}</button>`).join('')}</span></div>
      <div class="mp-row small" style="align-items:center"><span>枕木</span><span class="mp-seg" style="flex-wrap:wrap">${SLP_ORDER.map(k => `<button data-bsl="${k}" class="${(o.sl || 0) === k ? 'on' : ''}">${SLP_N[k]}</button>`).join('')}</span></div>
      ${o.elec ? `<div class="mp-row small" style="align-items:center"><span>架線</span><select class="mp-inp" data-bct style="width:auto">${CAT_ORDER.map(k => `<option value="${k}" ${(o.ct || 0) === k ? 'selected' : ''}>${CAT_N[k]}（${CAT_V[k]}km/h）</option>`).join('')}</select></div>` : ''}
      <div class="mp-row small" style="align-items:center"><span>防音壁</span><span class="mp-seg">${[0, 1, 2].map(v => `<button data-bnw="${v}" class="${(o.nw || 0) === v ? 'on' : ''}">${NW_N[v]}</button>`).join('')}</span></div>
      <p class="muted small" style="margin:0"><span>上限の速さ：列車 ${va}km/h</span>${ve != null ? `<span>・電車 ${ve}km/h</span>` : ''}${SEP()}<span>（軌間が合わない列車は走れません。くわしくは 線をタップ →「規格」）</span></p>` : ''}`;
}
function specPickBind(s, o, upd, redraw) {
  { const b = s.querySelector('[data-specx]'); if (b) b.onclick = () => { o.specOpen = !o.specOpen; redraw(); }; }
  const set = (k, v) => { o[k] = v; if (o.g2 === o.ga) o.g2 = 0; specSave(o); upd(); };
  s.querySelectorAll('[data-bga]').forEach(b => b.onclick = () => set('ga', Number(b.dataset.bga)));
  s.querySelectorAll('[data-bg2]').forEach(b => b.onclick = () => set('g2', Number(b.dataset.bg2)));
  s.querySelectorAll('[data-bsl]').forEach(b => b.onclick = () => set('sl', Number(b.dataset.bsl)));
  s.querySelectorAll('[data-bnw]').forEach(b => b.onclick = () => set('nw', Number(b.dataset.bnw)));
  { const e = s.querySelector('[data-bct]'); if (e) e.onchange = () => set('ct', Number(e.value)); }
}
// 見つもり（「見つもる」を押したとき）
async function quoteDraw(st) {
  if (S.toolState !== st || st.curve.length < 3 || st.quoting) return;
  const my = st.qseq = (st.qseq || 0) + 1;
  st.quoting = true; drawSheet();
  let q = null, err = null;
  try { q = await call(st.edit ? 'mp_seg_edit' : 'mp_seg_build', drawArgs(st, true)); } catch (e) { err = e.message; }
  if (st.qseq !== my) return;
  st.quoting = false; st.quote = q; st.err = err; st.psel = q && q.prof ? pinFind(q.prof, st.pv) : null;
  if (S.toolState === st) drawSheet();
}
function drawArgs(st, dry) {
  if (st.edit) return { p_id: st.edit.id, p_ctl: toInts(st.ctrl), p_pts: toInts(st.curve), p_dry: dry };
  const o = st.opts;
  return { p_kind: st.kind, p_cls: st.kind === 'road' ? o.cls : null, p_ctl: st.mode === 'arc' ? null : toInts(st.ctrl), p_pts: toInts(st.curve),
    p_opts: { dbl: o.dbl, elec: o.elec, name: o.name, lanes: o.lanes, ...(S.quadOK && o.quad ? { quad: true } : {}), ...(S.pwOK && o.elec && o.ps ? { ps: o.ps } : {}), ...(S.hgtOK ? { hm: o.hm || 'auto', rack: st.kind === 'rail' && !!o.rack, prof: pinArr(st.pins) } : {}), ...(S.hgt2 ? hgtOpt({ ...o, hm: o.hm || 'auto' }) : {}), ...(S.specOK && st.kind === 'rail' ? specOpt(o) : {}) },
    p_as: S.as, p_from: st.A ? st.A.att : null, p_to: st.B ? st.B.att : null, p_dry: dry };
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
    ${st.edit ? '' : rail ? `<div class="mp-row"><span class="mp-seg"><button data-d="0" class="${!o.dbl ? 'on' : ''}">単線</button><button data-d="1" class="${o.dbl && !o.quad ? 'on' : ''}">複線</button>${S.quadOK ? `<button data-d="2" class="${o.quad ? 'on' : ''}">複々線</button>` : ''}</span>
        <span class="mp-seg"><button data-e="0" class="${!o.elec ? 'on' : ''}">非電化</button><button data-e="1" class="${o.elec ? 'on' : ''}">電化</button></span></div>
        ${S.pwOK && o.elec && o.ct !== 6 ? `<div class="mp-row small" style="align-items:center"><span>電化方式</span><span class="mp-seg">${PS_N.slice(0, 3).map((n, k) => `<button data-ps="${k}" class="${(o.ps || 0) === k ? 'on' : ''}">${n}</button>`).join('')}</span></div>` : ''}
        ${S.specOK ? specPick(o) : ''}`
      : `<div class="mp-row">${gov ? `<select class="mp-inp" style="width:auto" data-cls>${[['exp', '高速道路'], ['nat', '国道'], ['pref', '府県道'], ['city', '市道'], ['lane', '細い道']].map(c => `<option value="${c[0]}" ${o.cls === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select>` : ''}
        片側 <span class="mp-seg">${(gov ? [0, 1, 2, 3] : [0, 1, 2]).map(n => `<button data-l="${n}" class="${o.lanes === n ? 'on' : ''}">${n ? n + '車線' : '細い道'}</button>`).join('')}</span></div>`}
    ${S.hgtOK && !st.edit ? `<div class="mp-row"><span>高さ</span> <span class="mp-seg" style="flex-wrap:wrap">${hgtModes().map(m => `<button data-hm="${m}" class="${(o.hm || 'auto') === m ? 'on' : ''}">${HGT_MODE[m]}</button>`).join('')}</span>${rail ? `<label class="small"><input type="checkbox" data-rack ${o.rack ? 'checked' : ''}> アプト式</label>` : ''}</div>${hgtOptHtml({ ...o, hm: o.hm || 'auto' }, st.kind, !!o.rack)}` : ''}
    ${st.edit ? '' : `<div class="mp-row"><input class="mp-inp" data-nm placeholder="${rail ? '路線名（なくてもよい）' : '道路の名前（なくてもよい）'}" value="${esc(o.name)}"></div>`}
    <div class="mp-row">${q ? `${q.cost > 0 || S.as !== 'gov' ? `<span class="mp-cost">工事費 ${X(q.cost)}</span>` : '<span>工事費なし（国の工事は無料）</span>'}<span class="small"><span>使用料 1日 ${X(q.lease || 0)}</span>${q.tunnel ? `<span>・トンネル ${q.tunnel}マス</span>` : ''}${q.bridge ? `<span>・橋 ${q.bridge}マス</span>` : ''}${q.vtop != null && q.vtop !== q.vlim ? `<span>・制限速度 ${q.vlim}〜${q.vtop} km/h</span>` : `<span>・制限速度 ${q.vlim} km/h</span>`}</span>`
      : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>'
      : st.curve.length > 2 ? `<button class="btn" data-est ${tight || st.geoBad || (!st.edit && hgtNoZ({ ...o, hm: o.hm || 'auto' })) ? 'disabled' : ''}>見つもる</button><span class="muted small">${gov ? '国の工事は無料です（見つもらずに、つくれます）' : '工事費を出してから、つくれます'}</span>` : st.mode === 'arc' ? '<span class="muted small">地図をタップして角の点をおいてください（2つ以上）。角には、えらんだ半径のカーブが入ります。線路のはしから始めると延長、まん中から始めると分岐です</span>' : '<span class="muted small">地図をタップして点をおいてください（2つ以上）。はしを線の近くにおくと、つながります</span>'}</div>
    ${q && q.prof ? `<canvas class="mp-prof" data-prof></canvas><p class="small" style="margin:2px 0">${profSum(q)}</p>${st.edit ? '' : hgtShort(o.hm, q) + pinRow(q.prof, st.psel, st.pins)}` : ''}
    ${q ? needH(q.need) : ''}
    <div class="mp-row"><button class="btn" data-undo ${st.ctrl.length ? '' : 'disabled'}>1つもどす</button><button class="btn" data-cancel>キャンセル</button>
      <button class="btn main" data-ok ${(q || (gov && st.curve.length > 2)) && !tight && !st.geoBad && !(q && hasNeed(q)) ? '' : 'disabled'}>${st.edit ? 'この形にする' : `つくる（${esc(asName())}）`}</button></div>
    <p class="muted small" style="margin:6px 0 0">点はドラッグで動かせます。長押しで消せます</p>`, s => {
    s.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { st.mode = b.dataset.m; try { localStorage.setItem('mp_dm_' + st.kind, st.mode); } catch (e) {} drawUpdate(); });
    { const rd = s.querySelector('[data-rad]'); if (rd) rd.onchange = () => { st.rad = Number(rd.value); try { localStorage.setItem('mp_dr_' + st.kind, String(st.rad)); } catch (e) {} drawUpdate(); }; }
    s.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { o.dbl = b.dataset.d !== '0'; o.quad = b.dataset.d === '2'; drawUpdate(); });
    s.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { o.elec = b.dataset.e === '1'; drawUpdate(); });
    s.querySelectorAll('[data-ps]').forEach(b => b.onclick = () => { o.ps = Number(b.dataset.ps); drawUpdate(); });   // 電化方式（DB の更新87）
    specPickBind(s, o, () => drawUpdate(), () => drawSheet());   // 線路の規格（DB の更新99）
    s.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { o.lanes = Number(b.dataset.l); drawUpdate(); });
    const cl = s.querySelector('[data-cls]'); if (cl) cl.onchange = () => { o.cls = cl.value; if (o.cls === 'exp' && o.hm === 'auto') o.hm = 'el'; drawUpdate(); };
    // 高さ（t108）
    s.querySelectorAll('[data-hm]').forEach(b => b.onclick = () => { o.hm = b.dataset.hm; drawUpdate(); });
    { const r = s.querySelector('[data-rack]'); if (r) r.onchange = () => { o.rack = r.checked; drawUpdate(); }; }
    hgtOptBind(s, o, () => drawUpdate());   // 高さ・勾配の上限（DB の更新84）
    { const cv = s.querySelector('[data-prof]'); if (cv && q) profChart(cv, { prof: q.prof, g: q.g, st: q.st, xs: q.xs, len: q.len }, st.edit ? {} : { points: true, sel: st.psel, pins: st.pins, onPick: i => { st.psel = i; st.pv = q.prof[2 * i]; drawSheet(); } }); }
    s.querySelectorAll('[data-pz]').forEach(b => b.onclick = async () => {   // だめなら（勾配がきつすぎるなど）、前にもどす
      const bk = new Map(st.pins), q0 = st.quote, sel0 = st.psel;
      st.pv = pinSet(st.pins, q.prof, st.psel, Number(b.dataset.pz)); st.quote = null;
      await quoteDraw(st);
      if (S.toolState === st && !st.quote && st.err) { st.pins = bk; st.quote = q0; st.psel = sel0; toast(st.err); st.err = null; drawSheet(); }
    });
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
    <div class="mp-row">${st.q ? `${S.as === 'gov' && !st.q.cost ? '<span>工事費なし（国の工事は無料）</span>' : `<span class="mp-cost">工事費 ${X(st.q.cost)}</span>`}<span class="small">${st.q.up_day ? `<span>維持費 1日 ${X(st.q.up_day)}</span>` : ''}${st.q.lease ? `<span>・使用料 1日 ${X(st.q.lease)}</span>` : ''}${st.q.zl ? `<span>・${st.q.zl === 'U' ? '地下駅（工事費 2.5倍）' : '高架駅（工事費 1.5倍）'}</span>` : ''}</span>` : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、つくれます</span>'}</div>
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
      S.toolState = { da: hr, tome: st.tome || null }; sheet(null);
      hint(st.tome ? '留置線：終点をタップしてください（同じ線路の上・20m単位）' : '車両基地：終点をタップしてください（同じ線路の上・20m単位）');
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
    <div class="mp-row">${st.q ? (S.as === 'gov' && !st.q.cost ? '<span>工事費なし（国の工事は無料）</span>' : `<span class="mp-cost">工事費 ${X(st.q.cost)}</span><span class="small">使用料 1日 ${X(st.q.lease)}・維持費 1日 ${X(st.q.up_day)}</span>`) : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、つくれます</span>'}</div>
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

/* ---- 留置線（DB の更新105）：駅の近くに 線路をなぞって つくる。折り返しで 8分以上 待つ編成が 番線をあけて待つ（車両は置けない） ---- */
const tomeOn = () => { lookOn(); return (S.dbv || 0) >= 105; };
const tomeDim = sz => { const m = /^R(\d+)x(\d+)$/.exec(sz || ''); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
function showTome(d) {
  const [len, n] = tomeDim(d.sz), sta = d.st != null && S.vis && S.vis.stas.get(d.st);
  sheet(`<h4>🅿 <span translate="no">${esc(d.n)}</span></h4><div class="mp-kv"><b>種類</b><span>留置線</span><b>駅</b><span translate="no">${sta ? esc(sta.n) : '—'}</span>
      <b>大きさ</b><span>${T(`${len}m・${n}本`)}</span></div>
    <p class="muted small"><span>折り返しで 8分以上 待つ編成（この長さに入るもの）は、着いて3分で ここへ入り、番線をあけて待ちます（出る3分前に もどります）。車両は置けません。</span></p>
    ${d.mine ? '<div class="mp-row"><button class="btn" data-ren>名前を変える</button><button class="btn" data-del>こわす</button></div>' : ''}`, sh => {
    const r = sh.querySelector('[data-ren]'); if (r) r.onclick = async () => { const nm = prompt(T('新しい名前'), d.n); if (nm && await api('mp_dep_edit', { p_id: d.id, p_name: nm, p_del: false }, '名前を変えました')) { refreshBox(d.fx - 3, d.fy - 3, d.fx + 3, d.fy + 3); sheet(null); } };
    const x = sh.querySelector('[data-del]'); if (x) x.onclick = async () => { if (await confirm2(T('こわしますか？（工事費はもどりません）'), { what: `「${d.n}」`, q: '本当にこわしますか？', ok: 'こわす' }) && await api('mp_dep_edit', { p_id: d.id, p_name: null, p_del: true }, 'こわしました')) { refreshBox(d.fx - 14, d.fy - 14, d.fx + 14, d.fy + 14); sheet(null); } };
  });
}
// 駅の近くの 自分の駅（留置線をつくれる駅）：留置線のまん中から（ホームの半分＋留置線の半分＋500m）まで。近い順
function tomeNear(p, len) {
  return [...(S.vis ? S.vis.stas.values() : [])].filter(x => x.k === 'rail' && x.mine)
    .map(x => ({ s: x, d: Math.hypot(x.fx - p.x, x.fy - p.y) - (x.pl || 0) / 100 - len / 100 })).filter(o => o.d <= 10).sort((a, b) => a.d - b.d);
}

// 車両基地（線路をなぞる）：長さ（20m単位）・留置線の数・どちら側か
function depSheetRail(h1, h2) {
  const seg = h1.s, span = Math.abs(h2.at - h1.at);
  const st = { len: clamp(Math.round(span * 50 / 20) * 20, 40, 1000), mid: (h1.at + h2.at) / 2, n: 6, side: 1, name: nearDist(h1.x, h1.y) + '車両基地', q: null, err: null,
               mode: 'dep', sta: null };   // mode：dep 車両基地・tome 留置線（駅の。DB の更新105）
  const sz = () => `${st.mode === 'tome' ? 'R' : 'T'}${st.len}x${st.n}`;
  const at = () => { const p = segPointAt(seg, st.mid); return p; };
  const near = () => tomeOn() ? tomeNear(at(), Math.min(st.len, 600)) : [];
  { const t0 = S.toolState && S.toolState.tome, nr = near(); if (nr.length && (t0 || false)) { st.mode = 'tome'; st.sta = (nr.find(o => o.s.id === t0) || nr[0]).s.id; st.n = 2; st.len = clamp(st.len, 40, 600); } }
  S.sel = { kind: 'seg', id: seg.id };
  S.drawTool = (g, z) => {
    const p = at(), P = depPoly({ fx: p.x, fy: p.y, a: p.ang, side: st.side, sz: sz(), k: 'rail' });
    g.beginPath(); P.forEach((q, i) => i ? g.lineTo(sx(q[0]), sy(q[1])) : g.moveTo(sx(q[0]), sy(q[1]))); g.closePath();
    g.fillStyle = st.err ? 'rgba(220,40,40,.35)' : 'rgba(150,110,60,.4)'; g.fill(); g.strokeStyle = '#8a5a1f'; g.lineWidth = 2; g.stroke();
    g.lineCap = 'butt'; g.strokeStyle = 'rgba(138,90,31,.85)'; g.lineWidth = Math.max(5, 0.3 * z); pathPart(g, seg, st.mid - st.len / 100, st.mid + st.len / 100); g.stroke(); g.lineCap = 'round';
  };
  S.dirty = true;
  const args = dry => { const p = at(); return st.mode === 'tome' ? { p_sta: st.sta, p_seg: seg.id, p_x: p.x, p_y: p.y, p_side: st.side, p_len: st.len, p_n: st.n, p_as: S.as, p_dry: dry }
    : { p_kind: 'rail', p_seg: seg.id, p_x: p.x, p_y: p.y, p_side: st.side, p_size: sz(), p_name: st.name || '仮', p_as: S.as, p_dry: dry }; };
  const fn = () => st.mode === 'tome' ? 'mp_tome_build' : 'mp_dep_build';
  const quote = async () => {
    const my = st.seq = (st.seq || 0) + 1; st.quoting = true; draw();
    let q = null, err = null;
    try { q = await call(fn(), args(true)); } catch (e) { err = e.message; }
    if (st.seq !== my) return;
    st.quoting = false; st.q = q; st.err = err;
    draw(); S.dirty = true;
  };
  const changed = () => { st.seq = (st.seq || 0) + 1; st.quoting = false; st.q = null; st.err = null; draw(); S.dirty = true; };
  const step = (k, d, lo, hi) => `<button class="btn" data-${k}="${-d}" style="flex:none;padding:4px 12px">−</button><b style="min-width:4.2em;text-align:center">${k === 'len' ? st.len + 'm' : T(`${st.n}本`)}</b><button class="btn" data-${k}="${d}" style="flex:none;padding:4px 12px">＋</button>`;
  const draw = () => { const nr = near(), tm = st.mode === 'tome';
    sheet(`<h4>${tm ? '🅿 留置線をつくる' : '🏭 車両基地をつくる'}</h4>
    ${nr.length ? `<div class="mp-row"><span class="mp-seg"><button data-md="dep" class="${tm ? '' : 'on'}">🏭 車両基地</button><button data-md="tome" class="${tm ? 'on' : ''}">🅿 留置線（駅の）</button></span></div>` : ''}
    ${tm ? `<div class="mp-row"><span>駅</span><select class="mp-inp" style="flex:1 1 140px" data-tsta>${nr.map(o => `<option value="${o.s.id}" ${o.s.id === st.sta ? 'selected' : ''}>${esc(o.s.n)}</option>`).join('')}</select></div>`
      : `<div class="mp-row"><input class="mp-inp" data-nm value="${esc(st.name)}" placeholder="車両基地の名前"></div>`}
    <div class="mp-row"><span>長さ</span> ${step('len', 20)}</div>
    <div class="mp-row"><span>${tm ? '線の数' : '留置線'}</span> ${step('n', 1)} <button class="btn" data-side>反対側にする</button></div>
    <p class="small" style="margin:4px 0 0">${tm ? `<span>${T(`${st.len}m の編成まで・${st.n}本`)}</span>（<span>折り返しで 8分以上 待つ編成が、番線をあけて待ちます。車両は置けません</span>）` : `20m の車両 ${Math.floor(st.len / 20) * st.n}両まで（${Math.floor(st.len / 20)}両 × ${st.n}本）`}</p>
    <div class="mp-row">${st.q ? (S.as === 'gov' && !st.q.cost ? '<span>工事費なし（国の工事は無料）</span>' : `<span class="mp-cost">工事費 ${X(st.q.cost)}</span><span class="small">使用料 1日 ${X(st.q.lease)}・維持費 1日 ${X(st.q.up_day)}</span>`) : st.err ? `<span class="mp-warn">${esc(st.err)}</span>` : st.quoting ? '<span class="muted small">見つもり中…</span>' : '<button class="btn" data-est>見つもる</button><span class="muted small">工事費を出してから、つくれます</span>'}</div>
    ${st.q ? needH(st.q.need) : ''}
    <div class="mp-row"><button class="btn main" data-ok ${st.q && !hasNeed(st.q) ? '' : 'disabled'}>つくる（${esc(asName())}）</button></div>
    <p class="muted small" style="margin:4px 0 0">${tm ? '起点と終点のあいだに、線路にそって留置線をつくります（20m単位・40〜600m・1〜8本。駅の近く、ホームの はしより先）。もう一度タップすると、えらびなおせます' : '起点と終点のあいだに、線路にそって車両基地をつくります（20m単位）。もう一度タップすると、えらびなおせます'}</p>`, s => {
    { const e = s.querySelector('[data-nm]'); if (e) e.onchange = ev => { st.name = ev.target.value; }; }
    s.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { st.mode = b.dataset.md; if (st.mode === 'tome') { const n2 = near(); st.sta = st.sta && n2.some(o => o.s.id === st.sta) ? st.sta : n2.length ? n2[0].s.id : null; st.n = clamp(st.n, 1, 8); st.len = clamp(st.len, 40, 600); } changed(); });
    { const e = s.querySelector('[data-tsta]'); if (e) e.onchange = () => { st.sta = Number(e.value); changed(); }; }
    needBind(s, st.q && st.q.need, () => quote());
    s.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { st.len = clamp(st.len + Number(b.dataset.len), 40, st.mode === 'tome' ? 600 : 1000); changed(); });
    s.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { st.n = clamp(st.n + Number(b.dataset.n), 1, st.mode === 'tome' ? 8 : 20); changed(); });
    s.querySelector('[data-side]').onclick = () => { st.side = -st.side; changed(); };
    { const es = s.querySelector('[data-est]'); if (es) es.onclick = () => quote(); }
    s.querySelector('[data-ok]').onclick = async () => {
      if (st.mode !== 'tome') { st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('名前をつけてください'); }
      const p = at();
      if (await api(fn(), args(false), 'つくりました')) { refreshBox(p.x - 14, p.y - 14, p.x + 14, p.y + 14); sheet(null); S.drawTool = null; S.toolState = null; S.sel = null; hint(TOOL_HINT.dep); if (st.mode === 'tome') runListStale(); }
    };
  }); };
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
/* ---------- 雪の対策（t108）：雪の地域（雪国・豪雪地帯・特別豪雪地帯）・積雪・冬の運休・大雪の立ち往生。
   車両の雪の対策・駅の融雪器・線路の雪よけ（防雪柵・スノーシェッド）・車庫の除雪車と補助金。
   サーバーの更新（DB の更新57）の前は、ボタンを出さない（mp_area の snow で見分ける。S.snowOK） ---------- */
const SNOW_Z = ['雪国ではない', '雪国', '豪雪地帯', '特別豪雪地帯'], SNOW_SUB = ['', '3分の1', '半分', '3分の2'], SNOW_P = ['なし', '防雪柵', 'スノーシェッド'];
const SNZ = { src: 'map/snowz.png?v=1', x0: -7680, y0: -10112, x1: 7680, y1: 11328, img: null, loading: false };   // 雪の地域の絵（16マス＝1画素。陸のマスだけ）
const SNZ_C = [null, [120, 180, 255, 70], [60, 120, 235, 95], [120, 70, 215, 110]];   // 雪国・豪雪地帯・特別豪雪地帯の色（RGBA）
// 雪の地域：1月の平均気温（サーバーの _mp_snowzone と同じ式。北へ 50km で約2℃・100m 高いと 0.65℃ 寒い）。y はマス、e は標高 m
function snowZone(y, e) { const tj = 13.2 + (y < 54 ? 0.00205 : 0.00045) * (y - 54) - 0.0065 * Math.max(0, e || 0); return tj <= -5.5 ? 3 : tj <= -1.5 ? 2 : tj <= 2.5 ? 1 : 0; }
function snowZoneAt(x, y) { const px = Math.floor(x), py = Math.floor(y); return snowZone(py + 0.5, wxElev(px + 0.5, py + 0.5)); }
const snowZL = z => z > 0 ? `${SNOW_Z[z]}（補助金 ${SNOW_SUB[z]}）` : SNOW_Z[0];
// 層「❄ 雪の地域」：近いときはチャンクごと（そのマスの標高から。海・湖・川はぬらない）、遠いときは絵
function chunkSnow(c, cy) {
  const cv = document.createElement('canvas'); cv.width = cv.height = CS;
  const g = cv.getContext('2d'), im = g.createImageData(CS, CS), d = im.data;
  for (let k = 0; k < CS * CS; k++) {
    const t = c.t[k]; if (t === 'S' || t === 'D' || t === 'R' || t === 'L') continue;
    const col = SNZ_C[snowZone(cy * CS + Math.floor(k / CS) + 0.5, EDEC[B64I[c.e.charCodeAt(k)]])]; if (!col) continue;
    d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = col[3];
  }
  g.putImageData(im, 0, 0); return cv;
}
function drawSnowZ(g, z) {
  if (!SNZ.img) {
    if (!SNZ.loading) { SNZ.loading = true; const im = new Image(); im.onload = () => { SNZ.img = im; S.dirty = true; }; im.onerror = () => { SNZ.loading = false; }; im.src = SNZ.src; }
    return;
  }
  g.imageSmoothingEnabled = true; g.drawImage(SNZ.img, sx(SNZ.x0), sy(SNZ.y0), (SNZ.x1 - SNZ.x0) * z, (SNZ.y1 - SNZ.y0) * z);
}
// シートの「雪」の行：駅・バス停（雪の地域・積雪・融雪器）・線路（雪よけ）・車庫（除雪車）。雪国でなく、何もないときは出さない
function snowStaRow(s) {
  if (!S.snowOK || (s.k !== 'rail' && s.k !== 'bus')) return '';
  const zn = snowZoneAt(s.fx, s.fy); if (!zn && !s.sn && !s.ml) return '';
  return `<b>雪</b><span><span>${snowZL(zn)}</span>${s.sn ? `・<span>積雪 ${s.sn}cm</span>` : ''}${s.k === 'rail' ? `・<span>${s.ml ? '融雪器あり' : '融雪器なし'}</span>` : ''}</span>`;
}
function segSnowZone(s) { const i = Math.floor((s.np || 1) / 2); return s.P ? snowZoneAt(s.P[2 * i], s.P[2 * i + 1]) : 0; }
function segSnowRow(s) {
  if (!S.snowOK || s.k !== 'rail') return '';
  const zn = segSnowZone(s); if (!zn && !s.sp) return '';
  return `<b>雪よけ</b><span><span>${SNOW_P[s.sp || 0]}</span>・<span>${snowZL(zn)}</span></span>`;
}
function depSnowRow(d) {
  if (!S.snowOK || (d.k !== 'rail' && d.k !== 'bus')) return '';
  const zn = snowZoneAt(d.fx, d.fy); if (!zn && !d.pw) return '';
  return `<b>除雪車</b><span><span>${d.k === 'rail' ? 'ラッセル車' : '除雪トラック'} ${d.pw || 0}台</span>・<span>${snowZL(zn)}</span></span>`;
}
// 給水・給炭の設備をつくる・はずす（蒸気機関車の補給。DB の更新78）。s：{ id, n（名前）, fx, fy, wt, cl }
async function staSup(s, kind, done) {
  const on = !(kind === 'water' ? s.wt : s.cl), nm = kind === 'water' ? '給水設備' : '給炭設備';
  const q = await api('mp_sta_sup', { p_id: s.id, p_kind: kind, p_on: on, p_dry: true }); if (!q) return;
  if (!confirm(T(on ? `「${s.n}」駅に${nm}をつくります（蒸気機関車の列車がこの駅に止まると、${kind === 'water' ? '水' : '石炭'}を満タンにします）\n工事費 ${fmt(q.cost)} X` : `「${s.n}」駅の${nm}をはずします（お金はもどりません）`))) return;
  const r = await api('mp_sta_sup', { p_id: s.id, p_kind: kind, p_on: on, p_dry: false }, on ? `${nm}をつくりました` : `${nm}をはずしました`); if (!r) return;
  if (kind === 'water') s.wt = on ? 1 : 0; else s.cl = on ? 1 : 0;
  refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3); runListStale();
  if (done) done();
}
// 融雪器をつける・はずす（駅のシート・雪の対策から）。s：{ id, n（名前）, fx, fy, ml }
async function staMelt(s, done) {
  const on = !s.ml, q = await api('mp_sta_melt', { p_id: s.id, p_on: on, p_dry: true }); if (!q) return;
  const msg = on ? `「${s.n}」駅に融雪器をつけます（ポイントの雪をとかして、冬も列車が走れるように）\n工事費 ${fmt(q.cost)} X${q.sub ? `（${SNOW_Z[q.zone]}なので、ほかに補助金 ${fmt(q.sub)} X を国がはらいます）` : ''}\n維持費：冬（11〜4月）は1日 ${fmt(q.up)} X${q.zone ? '（半分を国が）' : ''}`
    : `「${s.n}」駅の融雪器をはずします（お金はもどりません。冬の維持費がなくなります）`;
  if (!confirm(T(msg))) return;
  const r = await api('mp_sta_melt', { p_id: s.id, p_on: on, p_dry: false }, on ? '融雪器をつけました' : '融雪器をはずしました'); if (!r) return;
  s.ml = on ? 1 : 0; refreshBox(s.fx - 3, s.fy - 3, s.fx + 3, s.fy + 3);
  if (done) done();
}
// 線路の雪よけ（防雪柵・スノーシェッド）：見つもりをならべて、えらぶ
async function segSnow(s, done) {
  const cur = s.sp || 0, lvs = [1, 2, 0].filter(v => v !== cur), qs = {};
  for (const lv of lvs) { try { qs[lv] = await call('mp_seg_snow', { p_id: s.id, p_lv: lv, p_dry: true }); } catch (e) { qs[lv] = { err: errJa(e.message) }; } }
  const zn = (lvs.map(lv => qs[lv]).find(q => q && q.zone != null) || {}).zone || 0;
  const m = modal(['❄ 線路の雪よけ', `<p class="small" style="margin:0 0 6px"><b>${esc(s.n || '線路')}</b>（<span>${fmt(Math.round(s.len * 50))} m</span>）・<span>いま：${SNOW_P[cur]}</span>・<span>${snowZL(zn)}</span></p>
    <div class="mp-list">${lvs.map(lv => { const q = qs[lv]; return q.err ? `<div class="mp-item small"><b>${SNOW_P[lv]}</b>：<span class="mp-warn">${esc(q.err)}</span></div>`
      : `<button class="mp-item" style="text-align:left" data-lv="${lv}"><b>${lv ? SNOW_P[lv] + 'にする' : '雪よけをなくす'}</b><br><small>${lv > cur ? `<span>工事費 ${X(q.cost)}</span>${q.sub ? `<span>（ほかに補助金 ${X(q.sub)} を国が）</span>` : ''}` : '<span>お金はもどりません</span>'}・<span>維持費 1日 ${X(q.up)}</span>${q.up && zn ? '<span>（半分を国が）</span>' : ''}</small></button>`; }).join('')}</div>
    <p class="muted small"><span>防雪柵は線路のわきの柵で、ふぶき・ふきだまりをふせぎます。スノーシェッドは線路を屋根でおおいます（雪崩・大雪に強い）。</span><span>どちらも、強い雪の運行の乱れが起きにくくなります（持ち主の雪国の線路のうち、防雪柵は半分・スノーシェッドはぜんぶの長さと数えます）。維持費は1年じゅう</span></p>`], b => {
    b.querySelectorAll('[data-lv]').forEach(x => x.onclick = async () => {
      const lv = Number(x.dataset.lv);
      if (lv < cur && !confirm(T(`${SNOW_P[cur]}を${lv ? SNOW_P[lv] + 'にします' : 'なくします'}（お金はもどりません）`))) return;
      const r = await api('mp_seg_snow', { p_id: s.id, p_lv: lv, p_dry: false }, lv ? `${SNOW_P[lv]}にしました` : '雪よけをなくしました'); if (!r) return;
      m.close(); s.sp = lv; refreshBox(...s.bb); if (done) done();
    });
  });
}
// 除雪車（車庫）：鉄道の車庫はラッセル車・バスの車庫は除雪トラック。d：{ id, n（名前）, k, pw, fx, fy }
async function depPlow(d, done) {
  const rail = d.k === 'rail', nm = rail ? 'ラッセル車' : '除雪トラック', cur = d.pw || 0;
  const v = prompt(T(`${nm}を何台にしますか（0〜20。いま ${cur}台）\n${rail ? '鉄道は、雪国にある線路 100km ごとに 1台いります（足りないと、大雪のときに立ち往生）' : 'バスは、1台あれば大雪で立ち往生しにくくなります'}`), String(cur + 1));
  if (v == null) return;
  const n = Math.round(Number(hw(v))); if (!(n >= 0 && n <= 20)) return toast('0〜20台にしてください');
  if (n === cur) return;
  const q = await api('mp_dep_plow', { p_id: d.id, p_n: n, p_dry: true }); if (!q) return;
  if (!confirm(T(n > cur ? `${nm}を ${n - cur}台 ふやします（${d.n}）\n${fmt(q.cost)} X${q.sub ? `（${SNOW_Z[q.zone]}なので、ほかに補助金 ${fmt(q.sub)} X を国がはらいます）` : ''}\n維持費：冬（11〜4月）は1日 ${fmt(q.up)} X${q.zone ? '（半分を国が）' : ''}`
    : `${nm}を ${cur - n}台 へらします（お金はもどりません）`))) return;
  const r = await api('mp_dep_plow', { p_id: d.id, p_n: n, p_dry: false }, `${nm}を ${n}台にしました`); if (!r) return;
  d.pw = n; refreshBox(d.fx - 8, d.fy - 8, d.fx + 8, d.fy + 8); if (done) done();
}
// 工事・転属のあいだに運休になる列車（DB の更新60。見つもりの trains）
const carRunsT = r => (r && r.trains ? '\n' + T(`この編成の列車 のべ ${r.trains}本が、そのあいだ運休になります（いま走っている列車も止まります）`) : '')
  + (r && r.spare && r.spare.length ? '\n' + T(`予備編成がある編成（${r.spare.join('・')}）の列車は、予備編成が代走します`) : '');   // DB の更新80
// 増結の期間（DB の更新80）：時間（'' はずっと）
const ADDH = [['', 'ずっと'], ['6', '6時間'], ['12', '12時間'], ['24', '1日'], ['48', '2日'], ['72', '3日'], ['168', '1週間'], ['336', '2週間'], ['720', '30日']];
// 車両の雪の対策（まとめて）：鉄道は耐雪改造（48時間）・バスとトラックは冬用タイヤとチェーン（6時間）
async function carSnow(ids, done, u) {
  const r = await api('mp_car_work', { p_cars: ids, p_kind: 'snow', p_as: S.as, p_dry: true }); if (!r) return;
  if (!confirm(T(`${r.n}${u || '両'}の雪の対策${u === '台' ? '（冬用タイヤとチェーン）' : '（耐雪改造）'}：${fmt(r.cost)} X${r.sub ? `（ほかに補助金 ${fmt(r.sub)} X を国が）` : ''}・${r.hours}時間（そのあいだ走れません）${r.skip ? '\n（できない車両：' + r.skip + '）' : ''}`) + carRunsT(r))) return;
  if (await api('mp_car_work', { p_cars: ids, p_kind: 'snow', p_as: S.as, p_dry: false }, 'たのみました')) { runListStale(); if (done) done(); }
}
// ≡ →「❄ 雪の対策」：雪国をとおる自分の系統（足りないもの・駅の融雪器・車両）・除雪車・ねだん・きまり
async function openSnow() {
  const m = modal(['❄ 雪の対策', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  const load = async () => {
    let d;
    try { d = await call('mp_snow_mine', { p_as: S.as }); }
    catch (e) { m.set('❄ 雪の対策', `<p class="small">${/Could not find the function|schema cache|does not exist/.test(e.message || '') ? 'サーバーの更新（DB の更新57）のあとで使えます。' : esc(errJa(e.message))}</p>`); return; }
    if (!document.body.contains(m)) return;
    const C = d.cost || {}, rs = d.routes || [], deps = d.deps || [];
    const ok = (b, t) => `<b style="color:${b ? '#1e7a3c' : '#b3261e'}">${b ? '○' : '✕'}</b> <span>${t}</span>`;
    const card = r => {
      const R = r.ready || {}, rail = r.kind === 'rail', u = rail ? '両' : '台';
      const st = r.stop === 'snowstop' ? ' <b class="mp-late">冬の運休中</b>' : r.stop === 'stuck' ? ' <b class="mp-late">大雪で立ち往生</b>' : '';
      const stas = (r.stas || []).map(x => `<div class="mp-row small" style="align-items:center;margin:2px 0"><span translate="no" style="flex:1 1 8em">${esc(x.n)}</span><span class="muted">${SNOW_Z[x.z]}</span>${x.dep ? `<span>積雪 ${x.dep}cm</span>` : ''}
          ${rail ? (x.melt ? '<span>融雪器 ○</span>' : x.mine ? `<button class="btn" style="flex:none;padding:3px 9px" data-melt="${x.id}">融雪器をつける</button>` : '<span class="muted">融雪器なし（ほかの持ち主の駅）</span>') : ''}</div>`).join('');
      return `<div class="mp-uk"><div><b><span style="color:${esc(r.color || '#888')}">■</span> <span translate="no">${esc(r.name)}</span></b> <small class="muted">${rail ? '鉄道' : 'バス'}・${esc(SNOW_Z[r.zone] || '')}</small>${st}</div>
        <div class="small" style="margin:4px 0">${R.deep ? (R.ok ? ok(true, `雪が深い駅（${R.th}cm より多い）が ${R.deep}駅。対策があるので走れます`) : ok(false, `冬の運休になります：${esc(R.why)}`)) : `<span class="muted">いま、雪が深い駅（${R.th || (rail ? 20 : 10)}cm より多い）はありません</span>`}</div>
        <div class="small">${!R.ncar ? '<span class="muted">列車（車両）がありません</span>' : ok(R.nsnow >= R.ncar, `車両の雪の対策：${R.nsnow || 0}/${R.ncar}${u}`)}${(r.fix || []).length ? ` <button class="btn" style="flex:none;padding:3px 9px" data-fix="${r.id}">のこり ${r.fix.length}${u}を雪の対策</button>` : ''}</div>
        ${rail ? `<div class="small">${ok(R.plow, `除雪：ラッセル車 ${R.plows}台／いる台数 ${R.need}台（雪国にある線路 ${R.km}km）`)}</div>` : `<div class="small">${ok(R.plows > 0, `除雪：除雪トラック ${R.plows}台`)}</div>`}
        <details class="small" style="margin-top:4px"><summary>雪国の駅（${(r.stas || []).length}）</summary>${stas}</details></div>`;
    };
    m.set('❄ 雪の対策', `<p class="small" style="margin:0 0 6px"><span>名義：</span><b>${esc(asName())}</b>　<span>${d.winter ? 'いまは冬（11〜4月）です。雪国では雪が積もります' : 'いまは冬ではありません（雪が積もるのは 11〜4月）'}</span></p>
      <details class="small"><summary><b>雪のきまり</b></summary><ul style="margin:6px 0;padding-left:1.2em;line-height:1.7">
        <li>北ほど・高いところほど寒く、<b>雪国</b>（1月の平均気温 2.5℃まで）・<b>豪雪地帯</b>（−1.5℃まで）・<b>特別豪雪地帯</b>（−5.5℃まで）になります。地図の上の「❄ 雪の地域」で見られます</li>
        <li><b>冬の運休</b>：積雪が 20cm（バスは 10cm）より多い駅をとおる系統は、雪の対策をしていない車両（バスは冬用タイヤのないバス）が1両でもあるか、その駅に融雪器がないと、運休します。対策がすむと、15分ほどで再開します</li>
        <li><b>立ち往生</b>：積雪 50cm（バスは 30cm）より多い駅で強い雪（1時間に 3cm から）のとき、除雪車が足りないと、列車・バスが立ち往生します。鉄道は、雪国にある線路 100km ごとに ラッセル車 1台、バスは 除雪トラック 1台から</li>
        <li>車両の雪の対策・融雪器・防雪柵とスノーシェッド（線路をタップ）・除雪車があると、強い雪の運行の乱れも起きにくくなります</li>
        <li><b>補助金</b>：工事費は、雪国は 3分の1・豪雪地帯は 半分・特別豪雪地帯は 3分の2 を国がはらいます（場所の雪の地域で。車両は車庫の場所）。維持費は、雪国にあるものは半分を国が。豪雪地帯をとおる系統が雪で運休・遅れたら、減った運賃の 3割を国がはらいます</li></ul></details>
      <h4 style="margin:10px 0 4px">雪国をとおる系統（${rs.length}）</h4>${rs.length ? rs.map(card).join('') : '<p class="small muted">ありません</p>'}
      <h4 style="margin:12px 0 4px">除雪車（車庫）</h4>
      <p class="small" style="margin:0 0 4px"><span>雪国にある線路：</span><b>${d.km}km</b>${d.km > 0 ? `<span>（防雪柵・スノーシェッド ${d.pkm}km 分）・ラッセル車がいる台数 </span><b>${Math.ceil(d.km / 100)}台</b>` : ''}</p>
      ${deps.length ? deps.map(x => `<div class="mp-row small" style="align-items:center;margin:2px 0"><span translate="no" style="flex:1 1 9em">${x.kind === 'rail' ? '🏭' : '🚌'} ${esc(x.name)}</span><span class="muted">${esc(SNOW_Z[x.zone] || '')}</span><span>${x.kind === 'rail' ? 'ラッセル車' : '除雪トラック'} ${x.plows}台</span><button class="btn" style="flex:none;padding:3px 9px" data-plow="${x.id}">台数を変える</button></div>`).join('') : '<p class="small muted">車庫がありません</p>'}
      <h4 style="margin:12px 0 4px">ねだん</h4>
      <div class="mp-kv small"><b>車両（鉄道）</b><span>1両 ${X(C.car)}・48時間（耐雪改造）</span><b>バス・トラック</b><span>1台 ${X(C.bus)}・6時間（冬用タイヤとチェーン）</span>
        <b>融雪器</b><span>駅ごとに ${X(C.melt)} ＋ 番線ごとに ${X(C.melt_tr)}</span><b>防雪柵</b><span>1マス（50m）${X(C.fence)}</span><b>スノーシェッド</b><span>1マス（50m）${X(C.shed)}</span>
        <b>ラッセル車</b><span>1台 ${X(C.plow)}（鉄道の車庫）</span><b>除雪トラック</b><span>1台 ${X(C.plow_bus)}（バスの車庫）</span>
        <b>維持費（1日）</b><span><span>融雪器 ${X(C.up_melt)}・ラッセル車 ${X(C.up_plow)}・除雪トラック ${X(C.up_plow_bus)}（冬だけ）</span>／<span>防雪柵 1マス ${X(C.up_fence)}・スノーシェッド 1マス ${X(C.up_shed)}（1年じゅう）</span></span></div>
      <p class="muted small">駅の融雪器は駅を、線路の雪よけは線路を、除雪車は車庫をタップしても つけられます。車両の雪の対策は ≡ →「車両と編成」でも</p>
      <div class="mp-row"><button class="btn" data-lay>❄ 地図で雪の地域を見る</button></div>`, b => {
      b.querySelectorAll('[data-melt]').forEach(x => x.onclick = () => {
        const id = Number(x.dataset.melt); let s0 = null; for (const r of rs) for (const s of r.stas || []) if (s.id === id) s0 = s;
        if (s0) staMelt({ id, n: s0.n, fx: s0.x / 100, fy: s0.y / 100, ml: s0.melt }, load);
      });
      b.querySelectorAll('[data-fix]').forEach(x => x.onclick = () => { const r = rs.find(q => q.id === Number(x.dataset.fix)); if (r) carSnow(r.fix, load, r.kind === 'bus' ? '台' : '両'); });
      b.querySelectorAll('[data-plow]').forEach(x => x.onclick = () => { const q = deps.find(o => o.id === Number(x.dataset.plow)); if (q) depPlow({ id: q.id, n: q.name, k: q.kind, pw: q.plows, fx: q.x / 100, fy: q.y / 100 }, load); });
      b.querySelector('[data-lay]').onclick = () => { m.close(); if (!S.layer.snowz) setOpt('snowz', true); };
    });
  };
  load();
}
function openMenu() {
  const m = modal(['国土のメニュー', `<div class="mp-list">
    <button class="mp-item" style="text-align:left" data-k="cars"><b>🚃 車両と編成</b><br><small>注文（1両から）・編成を組む・改造・検査・更新・転属・廃車</small></button>
    <button class="mp-item" style="text-align:left" data-k="routes"><b>🗺 系統とダイヤ</b><br><small>止まる駅の順番・列車の時刻（採時駅）・ダイヤグラム・航路（フェリー）・空路（飛行機）</small></button>
    <button class="mp-item" style="text-align:left" data-k="ops"><b>📋 運用</b><br><small>どの編成がどの列車を走るか・運用ファイル（書き出し・読みこみ）</small></button>
    <button class="mp-item" style="text-align:left" data-k="unko"><b>🚦 運行情報</b><br><small>国じゅうの遅れ・運転見合わせ／自分の線の対応・振替輸送</small></button>
    <button class="mp-item" style="text-align:left" data-k="jam"><b>🚗 渋滞情報</b><br><small>国じゅうの道路の渋滞・混雑・通行止め（5分ごと）</small></button>
    <button class="mp-item" style="text-align:left" data-k="er"><b>🚑 救急情報</b><br><small>救急車の出動・病院への搬送（この3時間）・きょうの件数</small></button>
    <button class="mp-item" style="text-align:left" data-k="snow"><b>❄ 雪の対策</b><br><small>雪国の線の冬の運休・車両の雪の対策・融雪器・雪よけ・除雪車・補助金</small></button>
    <button class="mp-item" style="text-align:left" data-k="segfind"><b>🔎 線路をさがす</b><br><small>非電化・単線のところ（自分の線路と、自分の系統が通る線路）</small></button>
    <button class="mp-item" style="text-align:left" data-k="xfer"><b>🤝 編成の譲渡</b><br><small>とどいた申しこみを受けとる・ことわる／出した申しこみ</small></button>
    <button class="mp-item" style="text-align:left" data-k="lic"><b>🚃 鉄道の免許</b><br><small>線路を引く市区町村の免許・申請（概要と計画の線）・審査</small></button>
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
    b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => { m.close(); ({ cars: () => openCars(), routes: openRoutes, ops: () => openOps(), unko: () => openUnko(0), jam: () => openJamList(), er: () => openErList(), snow: () => openSnow(), segfind: () => openSegFind(), xfer: () => openXfers(), thru: () => openThru(), lic: () => openLic(), blds: openMyBlds, tenants: openTenants, sc: () => openSC(), home: openHome, landreq: () => openLandReqs(), slots: () => openSlotList(), ledger: openLedger, admin: openAdmin, help: openHelp })[x.dataset.k](); });
  });
}
/* ---------- 鉄道の免許（t108）：線路を引く市区町村の免許。申請（市区町村・概要・計画の線）→ 審査（許可・却下）
   サーバーの更新（DB の更新55）の前は「まだ使えません」 ---------- */
const LIC = { draft: { areas: [], note: '', pts: null }, show: null, tab: 'have', pick: false, pickKey: '', pickSet: null };
const LIC_ST = { ask: '審査中', ok: '許可', ng: '却下', cancel: '取り下げ' };
// 計画の線を地図に（申請の下書き・審査で見るもの）
function licDraw(g, z) {
  if (LIC.pick && LIC.pickSet && S.vis) for (const p of S.vis.places.values()) {   // えらんだ市区町村の名前（✓）
    if (!LIC.pickSet.has(p.id) || (p.k !== 'muni' && p.k !== 'ward')) continue;
    const x = sx(p.x + 0.5), y = sy(p.y + 0.5); if (x < -120 || y < -40 || x > S.W + 120 || y > S.H + 40) continue;
    label(g, '✓ ' + p.n, x, y - 18, { size: 12, bold: true, color: '#fff', bg: 'rgba(142,36,170,.92)', force: true });
  }
  const L = LIC.show; if (!L || !L.pts || L.pts.length < 4) return;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); for (let i = 0; i < L.pts.length; i += 2) { const x = sx(L.pts[i] / 100), y = sy(L.pts[i + 1] / 100); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 7; g.stroke();
  g.strokeStyle = '#8e24aa'; g.lineWidth = 3.5; g.setLineDash([10, 6]); g.stroke(); g.setLineDash([]);
  for (let i = 0; i < L.pts.length; i += 2) { const x = sx(L.pts[i] / 100), y = sy(L.pts[i + 1] / 100); g.fillStyle = '#fff'; g.strokeStyle = '#8e24aa'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, i === 0 || i === L.pts.length - 2 ? 6 : 4, 0, 6.3); g.fill(); g.stroke(); }
  if (L.label) { const x = sx(L.pts[0] / 100), y = sy(L.pts[1] / 100); label(g, L.label, x, y - 16, { size: 12, bold: true, color: '#fff', bg: 'rgba(142,36,170,.92)' }); }
  g.restore();
}
// 申請の市区町村を地図でえらぶ：タップで足す・もう一度タップではずす（えらんだところは、むらさきの色と ✓ の名前）
function licPickSet() {   // えらんだ市区町村（市をえらんだら、その市の区も）
  const ids = new Set(LIC.draft.areas.map(a => a.id));
  if (S.vis) for (const p of S.vis.places.values()) if (p.par && ids.has(p.par)) ids.add(p.id);
  return ids;
}
function licPickSync() { LIC.pickSet = licPickSet(); LIC.pickKey = [...LIC.pickSet].sort().join(','); S.dirty = true; }
function chunkLic(c, set) {
  const cv = document.createElement('canvas'); cv.width = cv.height = CS;
  const g = cv.getContext('2d'), im = g.createImageData(CS, CS), d = im.data;
  for (let k = 0; k < CS * CS; k++) { const a = c.ap[B64I[c.a.charCodeAt(k)]]; if (!a || !set.has(a)) continue; d[k * 4] = 142; d[k * 4 + 1] = 36; d[k * 4 + 2] = 170; d[k * 4 + 3] = 72; }
  g.putImageData(im, 0, 0); return cv;
}
function licPick() {
  const d = LIC.draft, before = d.areas.slice();
  setTool('look'); LIC.pick = true; licPickSync();
  const bar = () => sheet(`<h4>🗺 市区町村をえらぶ</h4><p class="small muted" style="margin:0 0 6px">地図をタップすると、その市区町村を足します（もう一度タップすると、はずします）。いま <b>${d.areas.length}</b> こ（30まで）${d.areas.some(a => a.fee) ? `・申請料 ${X(d.areas.reduce((t, a) => t + (a.fee || 0), 0))}` : ''}</p>
    <div>${d.areas.length ? d.areas.map((a, i) => `<span class="mp-tag" translate="no">${esc(a.n)} <a href="#" data-rm="${i}">✕</a></span>`).join(' ') : '<span class="small muted">まだえらんでいません</span>'}</div>
    <div class="mp-row" style="margin-top:6px"><button class="btn main" data-ok>できた</button><button class="btn" data-x>やめる</button></div>`, sh => {
      sh.querySelector('[data-ok]').onclick = () => end(true);
      sh.querySelector('[data-x]').onclick = () => end(false);
      sh.querySelectorAll('[data-rm]').forEach(x => x.onclick = ev => { ev.preventDefault(); d.areas.splice(Number(x.dataset.rm), 1); licPickSync(); bar(); });
    });
  const end = ok => { S.tapHook = null; S.toolEnd = null; LIC.pick = false; S.dirty = true; sheet(null); if (!ok) d.areas = before; LIC.tab = 'apply'; openLic(); };
  let busy = false;
  S.tapHook = (x, y) => {
    if (busy) return true; busy = true;
    call('mp_lic_at', { p_x: Math.floor(x), p_y: Math.floor(y) }).then(a => {
      busy = false;
      if (!a) return toast('ここは市区町村の中ではありません');
      const i = d.areas.findIndex(q => q.id === a.id);
      if (i >= 0) { d.areas.splice(i, 1); toast(T(`${a.n} をはずしました`)); }
      else if (d.areas.length >= 30) return toast('市区町村は30までです');
      else { d.areas.push({ id: a.id, n: a.n, fee: a.fee }); toast(T(`${a.n} を足しました`)); }   // fee：市区町村の申請料（DB の更新63）
      licPickSync(); bar();
    }).catch(e => { busy = false; toast(errJa(e.message)); });
    return true;
  };
  S.toolEnd = () => { S.tapHook = null; LIC.pick = false; S.dirty = true; };
  bar();
}
function licFit(pts) {
  if (!pts || pts.length < 2) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { const x = pts[i] / 100, y = pts[i + 1] / 100; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const z = clamp(0.8 * Math.min(S.W / Math.max(40, x1 - x0), S.H / Math.max(40, y1 - y0)), zMin(), 8);
  setCam((x0 + x1) / 2, (y0 + y1) / 2, z);
}
// 計画の線をかく：地図をタップして点を足す（できたら申請の画面へもどる）
function licSketch() {
  const d = LIC.draft, pts = d.pts ? d.pts.slice() : [];
  setTool('look'); LIC.show = { pts, label: '計画の線' }; S.dirty = true;
  const bar = () => sheet(`<h4>✏ 計画の線をかく</h4><p class="small muted" style="margin:0 0 6px">地図をタップすると点が足されます（だいたいでよいです・点は200こまで）。いま <b>${pts.length / 2}</b> こ</p>
    <div class="mp-row"><button class="btn main" data-ok>できた</button><button class="btn" data-undo ${pts.length ? '' : 'disabled'}>1つもどす</button><button class="btn" data-clr ${pts.length ? '' : 'disabled'}>ぜんぶけす</button><button class="btn" data-x>やめる</button></div>`, sh => {
      sh.querySelector('[data-ok]').onclick = () => end(true);
      sh.querySelector('[data-undo]').onclick = () => { pts.splice(-2, 2); S.dirty = true; bar(); };
      sh.querySelector('[data-clr]').onclick = () => { pts.length = 0; S.dirty = true; bar(); };
      sh.querySelector('[data-x]').onclick = () => end(false);
    });
  const end = ok => { S.tapHook = null; S.toolEnd = null; sheet(null); if (ok) d.pts = pts.length >= 4 ? pts.slice() : null; LIC.show = d.pts ? { pts: d.pts, label: '計画の線' } : null; S.dirty = true; LIC.tab = 'apply'; openLic(); };
  S.tapHook = (x, y) => { if (pts.length >= 400) return toast('点は200こまでです'); pts.push(Math.round(x * 100), Math.round(y * 100)); S.dirty = true; bar(); return true; };
  S.toolEnd = () => { S.tapHook = null; };
  bar();
}
async function openLic() {
  const m = modal(['🚃 鉄道の免許', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  let d;
  try { d = await call('mp_lic_mine', { p_as: S.as }); }
  catch (e) { m.set('🚃 鉄道の免許', `<p class="small">${/Could not find the function|schema cache|does not exist/.test(e.message || '') ? 'サーバーの更新（DB の更新55）のあとで使えます。' : esc(errJa(e.message))}</p>`); return; }
  const areaName = x => x.k === 'all' ? '🗾 全国' : x.k === 'pref' ? `${x.n}（県ぜんぶ）` : x.n;   // 県の免許・全国の免許（DB の更新61）
  const areaChips = a => (a || []).map(x => `<span class="mp-tag" translate="no"${x.k === 'pref' || x.k === 'all' ? ' style="background:#7b4fd8;color:#fff"' : ''}>${esc(areaName(x))}</span>`).join(' ');
  const fmtPop = n => n >= 1e6 ? `${fmt(Math.round(n / 1e4))}万人` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万人` : `${fmt(n)}人`;
  const appCard = (l, rev) => `<div class="mp-uk" data-l="${l.id}"><div><b>${esc(LIC_ST[l.st] || l.st)}</b>${rev ? `・<span translate="no">${esc(l.who)}</span>` : ''} <small class="muted">${jdt(l.at * 1000)}</small></div>
      <div style="margin:4px 0">${areaChips(l.areas)}</div><div class="small" style="white-space:pre-wrap">${esc(l.note)}</div>
      ${l.pfee > 0 ? `<div class="small" style="margin-top:4px"><span>申請料 ${X(l.pfee)}</span>${l.st === 'ask' ? (rev ? '<span>（却下すると返します）</span>' : '<span>（却下・取り下げのときは返ります）</span>') : l.st === 'ng' || l.st === 'cancel' ? '<span>（返しました）</span>' : ''}</div>` : ''}
      ${rev && l.have && l.have.length ? `<div class="small muted" style="margin-top:4px"><span>いま持っている免許：</span>${l.have.map(x => esc(areaName(x))).join('・')}</div>` : ''}
      ${l.reply ? `<div class="small" style="margin-top:4px">💬 <span>${esc(l.reply)}</span>${l.by ? ` <small class="muted">（${esc(l.by)}）</small>` : ''}</div>` : ''}
      <div class="mp-row" style="margin-top:6px">${l.pts && l.pts.length >= 4 ? `<button class="btn" data-see="${l.id}">🗺 計画の線を見る</button>` : ''}${!rev && l.st === 'ask' ? `<button class="btn" data-cancel="${l.id}">取り下げる</button>` : ''}</div>
      ${rev && l.st === 'ask' ? `<textarea class="mp-inp" data-reply rows="2" placeholder="審査のことば（却下のときは理由を）" style="width:100%;margin-top:6px"></textarea>
        <div class="mp-row"><button class="btn main" data-ok="${l.id}">許可する</button><button class="btn" data-ng="${l.id}">却下する</button></div>` : ''}</div>`;
  const all = [...(d.list || [])];
  const draw = async () => {
    const tabs = [['have', '免許と申請'], ['apply', '申請する']].concat(d.rev ? [['rev', `審査${d.pend ? `（${d.pend}）` : ''}`]] : []);
    let body = '';
    if (LIC.tab === 'have') {
      body = `<p class="small" style="margin:0 0 6px"><b>免許のある市区町村</b>（<span>${esc(asName())}</span>）</p>
        <div>${d.all ? '<span class="mp-tag" style="background:#7b4fd8;color:#fff">🗾 全国</span> <span class="small">どこにでも線路を引けます</span>' : d.have.length ? areaChips(d.have) : '<span class="small muted">まだありません</span>'}</div>
        <p class="muted small"><span>線路を新しく引く・形を変えて広げるには、そこの市区町村の免許がいります（市の免許は、その市の区もふくみます）。</span>${d.prefs ? '<span>県の免許は、その県の市町村・区ぜんぶです。</span>' : ''}${d.mdiv ? `<span>申請料は 県は 人口 × ${fmt(d.pper)} X、市区町村は その${fmt(d.mdiv)}分の1（却下・取り下げのときは返ります）。</span>` : ''}${d.gov ? '<span>国の名義では、免許はいりません。</span>' : ''}</p>
        <h4 style="margin:10px 0 4px">申請</h4>${all.length ? all.map(l => appCard(l, false)).join('') : '<p class="small muted">まだありません</p>'}`;
    } else if (LIC.tab === 'apply' && d.all) {
      body = `<p class="small"><span>名義：</span><b>${esc(asName())}</b></p><p><span class="mp-tag" style="background:#7b4fd8;color:#fff">🗾 全国</span> <span>全国の免許があるので、申請はいりません（どこにでも線路を引けます）。</span></p>`;
    } else if (LIC.tab === 'apply') {
      const dr = LIC.draft, psum = dr.areas.reduce((t, a) => t + (a.fee || 0), 0);   // 申請料（県・市区町村。DB の更新61・63）
      body = `<p class="small" style="margin:0 0 6px"><span>名義：</span><b>${esc(asName())}</b>${d.fee > 0 ? `　<span>申請料 ${X(d.fee)}</span>` : ''}${d.fee2 > 0 ? `　<span>許可されたら免許料 ${X(d.fee2)}</span>` : ''}</p>
        <h4 style="margin:6px 0 4px">1. ${d.prefs ? '市区町村・県' : '市区町村'}</h4>
        <div data-sel>${dr.areas.length ? dr.areas.map((a, i) => `<span class="mp-tag" translate="no"${a.k === 'pref' ? ' style="background:#7b4fd8;color:#fff"' : ''}>${esc(areaName(a))} <a href="#" data-rm="${i}"${a.k === 'pref' ? ' style="color:#fff"' : ''}>✕</a></span>`).join(' ') : '<span class="small muted">まだえらんでいません</span>'}</div>
        ${psum > 0 ? `<p class="small" style="margin:4px 0 0"><b>申請料 ${X(psum)}</b>（申請するときに はらいます。却下・取り下げのときは返ります）</p>` : ''}
        <div class="mp-row" style="margin-top:6px"><button class="btn main" data-pick>🗺 地図をタップしてえらぶ</button></div>
        <div class="mp-row"><input class="mp-inp" data-q placeholder="名前でさがす（例：葉島市）" style="flex:1 1 160px"><button class="btn" data-find>さがす</button></div>
        <div data-res class="mp-list"></div>
        ${d.prefs && d.prefs.length ? `<details data-pf ${LIC.pfOpen ? 'open' : ''} style="margin-top:8px"><summary><b>県ごとに申請する</b><span class="small muted">（県の申請料がかかります）</span></summary>
          <p class="small muted" style="margin:4px 0"><span>県の免許は、その県の市町村・区ぜんぶ（あとでふえた市町村もふくみます）。</span><span>申請料は 県の人口 × ${fmt(d.pper)} X（1万 X 単位。いちばん安くて ${X(d.pmin)}）${d.mdiv ? `。市区町村ごとの申請は、その市区町村の人口 × ${fmt(d.pper)} X の${fmt(d.mdiv)}分の1` : ''}。</span><span>審査は市区町村と同じで、却下・取り下げのときは返ります。</span></p>
          <div class="mp-list">${d.prefs.map(p => { const on = dr.areas.some(a => a.id === p.id);
            return `<div class="mp-item small" style="display:flex;align-items:center;gap:8px"><span style="flex:1 1 auto"><b translate="no">${esc(p.n)}</b>　<span>市町村 ${p.munis}・人口 ${fmtPop(p.pop)}</span><br><span>申請料 ${X(p.fee)}</span></span>
              ${p.have ? '<span class="mp-tag">持っている</span>' : p.ask ? '<span class="mp-tag">申請中</span>' : on ? `<button class="btn" data-pdel="${esc(p.id)}">はずす</button>` : `<button class="btn" data-padd="${esc(p.id)}">足す</button>`}</div>`; }).join('')}</div></details>` : ''}
        <h4 style="margin:10px 0 4px">2. 概要</h4>
        <textarea class="mp-inp" data-note rows="5" style="width:100%" placeholder="どこからどこまで、どんな線を引くか（例：瑠璃市中里区から白樺市まで、複線電化の線路をひき、とちゅうに駅を5つ。通勤の客をはこぶ）">${esc(dr.note)}</textarea>
        <h4 style="margin:10px 0 4px">3. 計画の線（なくてもよい）</h4>
        <div class="mp-row"><button class="btn" data-sketch>✏ 地図にかく</button>${dr.pts ? `<span class="small">点 ${dr.pts.length / 2}こ</span><button class="btn" data-seed>🗺 見る</button><button class="btn" data-unsketch>けす</button>` : ''}</div>
        <div class="mp-row" style="margin-top:12px"><button class="btn main" data-send>申請する</button></div>`;
    } else {
      const r = await api('mp_lic_review', {}); if (!r) return;
      LIC.rv = r;
      body = `<h4 style="margin:0 0 4px">審査をまっているもの</h4>${r.ask.length ? r.ask.map(l => appCard(l, true)).join('') : '<p class="small muted">ありません</p>'}
        <h4 style="margin:12px 0 4px">30日以内に決めたもの</h4>${r.done.length ? r.done.map(l => appCard(l, true)).join('') : '<p class="small muted">ありません</p>'}`;
    }
    m.set('🚃 鉄道の免許', `<div class="mp-seg" style="margin-bottom:8px">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${LIC.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`, b => {
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { LIC.tab = x.dataset.tab; draw(); });
      const findL = id => (LIC.tab === 'rev' ? [...LIC.rv.ask, ...LIC.rv.done] : all).find(l => l.id === Number(id));
      b.querySelectorAll('[data-see]').forEach(x => x.onclick = () => { const l = findL(x.dataset.see); if (!l) return; m.close(); LIC.show = { pts: l.pts, label: l.who || '計画の線' }; licFit(l.pts); toast(T('紫の点線が計画の線です（≡ → 鉄道の免許 でもどれます）')); });
      b.querySelectorAll('[data-cancel]').forEach(x => x.onclick = async () => { if (!confirm(T('取り下げますか？（申請料は返します）'))) return; if (await api('mp_lic_cancel', { p_id: Number(x.dataset.cancel), p_as: S.as }, '取り下げました')) { m.close(); openLic(); } });
      b.querySelectorAll('[data-ok],[data-ng]').forEach(x => x.onclick = async () => {
        const ok = x.hasAttribute('data-ok'), id = Number(x.dataset.ok || x.dataset.ng), rp = x.closest('[data-l]').querySelector('[data-reply]').value;
        if (!ok && !rp.trim()) return toast('却下するときは、理由を書いてください');
        if (await api('mp_lic_decide', { p_id: id, p_ok: ok, p_reply: rp }, ok ? '許可しました' : '却下しました')) { d = await call('mp_lic_mine', { p_as: S.as }); draw(); }
      });
      if (LIC.tab !== 'apply' || d.all) return;   // 全国の免許があれば、申請の欄はない
      const dr = LIC.draft, note = b.querySelector('[data-note]');
      note.oninput = () => { dr.note = note.value; };
      b.querySelectorAll('[data-rm]').forEach(x => x.onclick = ev => { ev.preventDefault(); dr.areas.splice(Number(x.dataset.rm), 1); draw(); });
      const add = a => { if (!a || dr.areas.some(x => x.id === a.id)) return; if (dr.areas.length >= 30) return toast(d.prefs ? '市区町村と県は、あわせて30までです' : '市区町村は30までです'); dr.areas.push({ id: a.id, n: a.n, fee: a.fee }); draw(); };
      // 県を足す・はずす（その県の市区町村は、県の免許にふくまれるので はずす）
      const pf = b.querySelector('[data-pf]'); if (pf) pf.ontoggle = () => { LIC.pfOpen = pf.open; };
      b.querySelectorAll('[data-padd]').forEach(x => x.onclick = () => {
        const p = (d.prefs || []).find(q => q.id === x.dataset.padd); if (!p) return;
        dr.areas = dr.areas.filter(a => a.k === 'pref' || !a.n.startsWith(p.n));
        if (dr.areas.length >= 30) return toast('市区町村と県は、あわせて30までです');
        dr.areas.push({ id: p.id, n: p.n, k: 'pref', fee: p.fee }); draw();
      });
      b.querySelectorAll('[data-pdel]').forEach(x => x.onclick = () => { dr.areas = dr.areas.filter(a => a.id !== x.dataset.pdel); draw(); });
      const q = b.querySelector('[data-q]'), res = b.querySelector('[data-res]');
      const find = async () => { const v = q.value.trim(); if (!v) return; const r = await api('mp_lic_find', { p_q: v }); if (!r) return;
        res.innerHTML = r.length ? r.map((a, i) => `<button class="mp-item" style="text-align:left" data-a="${i}"><b translate="no">${esc(a.n)}</b>${a.fee ? ` <small>申請料 ${X(a.fee)}</small>` : ''}</button>`).join('') : '<p class="small muted">見つかりませんでした</p>';
        res.querySelectorAll('[data-a]').forEach(x => x.onclick = () => add(r[Number(x.dataset.a)])); };
      b.querySelector('[data-find]').onclick = find; q.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); find(); } };
      b.querySelector('[data-pick]').onclick = () => { m.close(); licPick(); };   // 地図をタップしてえらぶ
      b.querySelector('[data-sketch]').onclick = () => { m.close(); licSketch(); };
      const sd = b.querySelector('[data-seed]'); if (sd) sd.onclick = () => { m.close(); LIC.show = { pts: dr.pts, label: '計画の線' }; licFit(dr.pts); };
      const us = b.querySelector('[data-unsketch]'); if (us) us.onclick = () => { dr.pts = null; LIC.show = null; S.dirty = true; draw(); };
      b.querySelector('[data-send]').onclick = async () => {
        if (!dr.areas.length) return toast(d.prefs ? '市区町村か県をえらんでください' : '市区町村をえらんでください');
        if (dr.note.trim().length < 10) return toast('概要を書いてください（10字より長く）');
        const psum = dr.areas.reduce((t, x) => t + (x.fee || 0), 0);
        if (psum > 0) { if (!confirm(T(`申請料 ${X(psum + (d.fee || 0))} をはらって申請しますか？（却下・取り下げのときは返ります${d.fee > 0 ? `。ただし ${X(d.fee)} は却下のとき返りません` : ''}）`))) return; }
        else if (d.fee > 0 && !confirm(T(`申請料 ${X(d.fee)} をはらって申請しますか？（却下されても返りません。取り下げなら返ります）`))) return;
        const r = await api('mp_lic_apply', { p_areas: dr.areas.map(a => a.id), p_note: dr.note, p_pts: dr.pts, p_as: S.as }, '申請しました（審査の結果は🔔で知らせます）');
        if (!r) return;
        LIC.draft = { areas: [], note: '', pts: null }; LIC.show = null; S.dirty = true; LIC.tab = 'have';
        d = await call('mp_lic_mine', { p_as: S.as }); all.length = 0; all.push(...(d.list || [])); draw();
      };
    });
  };
  draw();
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
        if (!await confirm2(T('この発着口を国に返しますか？（もう一度使うときは、申しこみからです）'), { q: '本当に返しますか？', ok: '返す', note: 'もう一度使うときは、申しこみからです。' })) return;
        if (await api('mp_slot_return', { p_slot: Number(x.dataset.ret), p_as: S.as }, '国に返しました')) load();
      });
      b.querySelectorAll('[data-rev]').forEach(x => x.onclick = async () => {
        if (!await confirm2(T(`${x.dataset.rev}番の認可をとりけしますか？（持ち主に知らせます）`), { what: `${x.dataset.rev}番の認可`, q: '本当にとりけしますか？', ok: 'とりけす' })) return;
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
    <p><b>車両</b>：122系0番台は通勤形電車（最高100km/h）。両はしに運転台つきの Tc（奇数向き・偶数向き）、まん中に Mp（パンタグラフつき）と M をはさんで編成にします。「編成で注文」で形式を先頭から順にえらんで、まとめて注文できます（編成番号は自分で決める）。車番は 122-0001 のように、形式の番号と4けたの番号です（Tc 奇数向き 0001〜・Mp 2001〜・M 4001〜・Tc 偶数向き 6001〜）。編成はほかの人・会社にゆずれます（相手が受けとったら移る）。検査・改造・転属・納車のあいだ、その編成の列車は運休です（工事をはじめると、走っている列車も止まります。運賃は入りません）。</p>
    <p><b>系統とダイヤ</b>：止まる駅を順にえらんで系統をつくり、列車を入れます。時刻を決めるのは、会社が決めた採時駅だけ（着・発・番線）。ほかの駅は走る時間から自動で決まります。回送・試運転はお客を乗せません。日付をえらぶと、その日だけ走る臨時列車になります（過ぎたら消えます）。</p>
    <p><b>環状線</b>：系統をつくるとき、さいごに、はじめの駅をもう一度えらぶと環状線になります。下りはその順に一周、上りは逆まわりで、はじめの駅にもどります。止まる駅で始発・終着を外すと、途中から・途中までも走れます。</p>
    <p><b>運用</b>：1つの編成が1日に走る列車のならびです。列車は運用に入れ、運用に編成を入れます（編成を入れかえると、その運用の列車ぜんぶが変わる）。「運用を自動で組む」で、編成ごとの運用をつくれます。運用ごとに JSON ファイルに書き出して、バックアップや AI にまかせたあと、読みこめます。</p>
    <p><b>待避と発着番線</b>：種別ごとに優先番号（0〜9。0 がいちばん優先）があります。優先番号の大きい列車は、待避できる駅で、うしろから来る優先番号の小さい列車に先をゆずって待ちます（待避）。追いつく列車は、前の列車のあとを走ります（続行）。時刻は自動でずれます。駅の番線ごとに、下り・上り・両方と、本線・待避線を決められます（駅をタップ →「発着番線」）。種別と優先番号は、系統の画面の「種別と優先番号」で。</p>
    <p><b>ほかの系統との待避・続行</b>：系統の画面で「ほかの系統と待避・続行」をオンにすると、その系統の列車は、同じ駅を通るほかの系統（乗り入れてくる他社の列車もふくむ）の列車のうち、優先番号の小さい列車（同じなら系統の番号の小さいほう）にもゆずります。相手の時刻は変わりません。同じ駅の同じ番線に重なる列車は、系統の画面の「重なりを直す」で直せます。</p>
    <p><b>停車駅のパターン</b>：系統の画面の「停車駅のパターン」で、種別ごとに止まる駅を決めておけます（例：快速はこの駅だけ）。端の駅も通過にでき、止まる最初の駅が始発、最後の駅が終着になります（列車ごとの「止まる駅」も同じ）。列車をつくるとき・まとめてつくるとき・種別を変えたときに、そのパターンになります。「この種別の列車にも当てはめる」で、いまある列車もまとめて変えられます。</p>
    <p><b>1時間の型（パターンダイヤ）</b>：系統の画面の「⏱ 1時間の型」で、毎時 同じ分に出る列車の型（行ごとに 種別・下り／上り／両方・発車の分・走る区間）をつくり、何時から何時まで くりかえして、1日のダイヤを組めます。停車駅は 種別の停車駅のパターンどおりです。その時間帯の列車を消して つくりなおすこともでき、「↶ 取り消す」で もどせます。型は系統に のこります。ダイヤグラムの線は 種別ごとの色で、種別で しぼりこめます。</p>
    <p><b>留置線と折り返し</b>：編成が終着駅に着いて、同じ駅から つぎの列車で出るまで、その駅の番線を1本つかいます。待つ編成と止まる列車で 番線が足りなくなると注意が出ます。駅の画面の「🅿 留置線をつくる」で、駅の近くの線路をなぞって 留置線をつくると、8分以上 待つ編成は 着いて3分で留置線へ入り、番線をあけて待ちます。ダイヤグラムでは 終着駅の横に 待つあいだの点線（留置線は灰色の破線）が出ます。</p>
    <p><b>ホームの形</b>：駅の画面の「発着番線・ホームの形」で、相対式・島式・島式＋相対式・頭端式（行き止まりの駅）をえらべます。番線のあいだの ホームを押して、自分で つける・はずすこともできます（頭端式は ほかの形と いっしょに使えます）。上が 駅の向きの左がわ（地図の 1番線のがわ）です。ホームのない番線は 通過線になります。3Dでは その形のとおりに ホームと線路をならべ、列車は 決まった番線に入ります。</p>
    <p><b>電化と区間で しぼりこむ</b>：ダイヤグラム・時刻表・列車の一覧は、編成の電化（直流・交流・交直流・非電化）と、走る区間（始発駅 → 終着駅）でも しぼりこめます。「運用を自動で組む」の編成も 電化で しぼりこめます。</p>
    <p><b>あてる先ごとの運用</b>：「運用を自動で組む」の「あてる先ごとに」で、あてる先（種別・区間・向き・時間帯・走る線の電化で決める 列車のまとまり）を いくつもつくり、それぞれに使う編成をえらんで わりあてます。列車は 上から順に 最初にあてはまる あてる先に入ります（どれにも入らない列車は いまのまま）。</p>
    <p><b>種別ごとの運用</b>：「運用を自動で組む」の「種別ごと」で、種別ごとに使う編成をえらべます。系統の画面の「運用番号を種別ごとに」で、運用番号を 種別ごとに まとめられます（例：快速は 101・102…）。運用の画面では、種別で しぼりこめます。</p>
    <p><b>車歴と譲渡</b>：車両ごとに、新製・転属・譲渡・廃車が車歴にのこります（車両をえらんで「車歴」。廃車した車両は「廃車した車両」）。編成は「ゆずる」、編成に入っていない車両はえらんで「ゆずる」で、ほかの人・会社にゆずれます。まん中にも運転台つきの Tc を入れられます（中間封じ込め）。</p>
    <p><b>乗り入れ（他社直通）</b>：ほかの人・会社の駅か線路をタップ →「乗り入れを申請」。持ち主が許可する（線路使用料：1列車・1km）と、系統にその持ち主の駅を入れて、持ち主の線路を走れます。線路をつなぐこともできます（どちらかの向きに許可があれば）。運賃は系統の持ち主に、走った km ぶんの線路使用料は1時間ごとに線路の持ち主に入ります。同じ駅の番線は、ほかの持ち主の列車ともかさならないように見ます。持ち主が「やめる」と、その線路・駅を使う系統は走れなくなります。≡ →「乗り入れ」で、許可・ことわる・使用料を変える・やめる。</p>
    <p><b>連結</b>：列車ごとに、ほかの運用の編成をつなげます（3つ・16両まで）。とちゅうの駅でつなぐ・切りはなすこともできます（その運用の編成は、つなぐ駅に2分前までに着いていること）。ダイヤグラムでは太い線です。</p>
    <p><b>運行の乱れ</b>：雪・大雨・強風（天気どおり）や、人と接触・急病のお客さま・車両の点検・信号の確認・線路内の点検（飛行機・船・バスは、機材・バードストライク・滑走路・管制・高波・交通事故・渋滞など）で、遅れたり、運転を見合わせたりします。乱れがきくのは、起きた駅と となりの駅のあいだ（天気は まわり約10km の駅のあいだ）を通る列車だけで、遠くの列車は ふだんどおり走ります（対応をえらぶときに「全線」にもできます）。運転見合わせのあいだに その区間を通るはずの列車は運休で、運賃は入りません（もう走っている列車は、区間の手前で待ちます）。遅れが大きいほど、お客も少なくなります。自分の列車は、運行情報や列車の画面から 1本ずつ（その日）・編成ごと（時間をきめて／乱れがおわるまで）運休にできます。自分の線（駅）で起きると🔔で知らせが来るので、≡ →「🚦 運行情報」で対応を 1 いつもどおり・2 点検しながら・3 徐行・4 間引き運転（一部の列車を運休）・5 運転見合わせ からえらびます（乱れがおわるまで、何度でも変えられます）。対応しだいで、遅れの大きさや、あとのトラブルが変わります（運転規制の目安は「🚦 運行情報」に）。10分えらばないと「現場の判断」。見合わせ中は「振替輸送」をたのめます（近くのほかの線がお客をはこぶ・運賃の半分をはらう）。たのまずに合わせて1時間より長く止めると、その線の信頼が下がり、しばらくお客が少しへります（1日に1％ずつもどる）。</p>
    <p><b>雪</b>：北ほど・高いところほど寒く、雪国・豪雪地帯・特別豪雪地帯があります（地図の上の「❄ 雪の地域」）。冬（11〜4月）、積雪 20cm（バスは 10cm）より多い駅をとおる系統は、車両の雪の対策（鉄道は耐雪改造・バスは冬用タイヤ）と、その駅の融雪器がないと「冬の運休」になります。積雪 50cm（バスは 30cm）で強い雪のとき、除雪車（車庫のラッセル車・除雪トラック）が足りないと立ち往生します。防雪柵・スノーシェッド（線路をタップ）も、雪の乱れを起きにくくします。工事費は、雪国は 3分の1・豪雪地帯は 半分・特別豪雪地帯は 3分の2 を国がはらいます（≡ →「❄ 雪の対策」）。</p>
    <p><b>お金</b>：1時間ごとに運賃（駅のまわりの人・本数・速さ・冷暖房・遅れ・信頼で決まる）が入り、維持費・使用料をはらいます。</p></div>`]);
}

/* ---- 車両と編成 ---- */
// 形式の役わり → 置く車庫の種類（rail 車両基地・bus 営業所・ship 港）
const roleKind = r => r === 'Ship' ? 'ship' : r === 'Air' ? 'air' : (r === 'Bus' || r === 'Truck') ? 'bus' : 'rail';
async function openCars(depFocus) {
  const m = modal(['車両と編成', '<p class="muted small">読みこんでいます…</p>']);
  const st = { dep: depFocus || null, pick: [], form: null, mode: 'view', seq: [], maker: null, mk: [], ser: null, one: null, loco: null, pcs: null, fno: '', att: null, attL: null, lone: null, addF: null, addAt: 'tail', addH: '24' };   // addF・addAt・addH：増結する編成・場所・期間（DB の更新80）。att：機関車をつなぐ編成・attL：つなぐ機関車・lone：注文する機関車（DB の更新78）   // seq：編成で注文する形式の列。maker：鉄道車両工場（t54k）。ser：系列（機関車と客車は 'lp'）・one：1両ずつの形式（DB の更新71）
  const load = async () => {
    const [d, mk] = await Promise.all([api('mp_cars_list', { p_as: S.as }), api('mp_makers', {})]); if (!d) return;
    st.d = d; st.mk = mk || [];
    if (st.maker && !st.mk.some(x => x.id === st.maker)) st.maker = null;
    if (!st.dep || !d.depots.some(x => x.id === st.dep)) st.dep = d.depots.length ? d.depots[0].id : null;
    draw();
  };
  const carChip = (c, on) => `<span class="mp-car ${on ? 'on' : ''} ${c.busy ? 'busy' : ''}" data-car="${c.id}">${c.xfer ? '<small class="mp-warn">譲渡中</small> ' : ''}${c.tmp ? `<small class="mp-tag">増結 〜${esc(mdhmA(Date.parse(c.tmp) / 1000))}</small> ` : ''}${c.role === 'Truck' ? '<small class="muted">トラック</small> ' : c.role && c.role !== 'Bus' && c.role !== 'Ship' && c.role !== 'Air' ? `<small class="muted">${esc(c.role)}</small> ` : ''}${esc(c.num)}<span class="n">${c.busy ? esc(CAR_BUSY[c.busy] || c.busy) : `<span>状態${c.cond}</span>${c.ac ? '❄' : ''}${c.toilet ? '🚻' : ''}${c.snow ? '⛄' : ''}`}</span></span>`;
  const draw = () => {
    const d = st.d, deps = d.depots, dep = deps.find(x => x.id === st.dep);
    if (!deps.length) return m.set('車両と編成', `<p class="small">まず地図で車庫（🏭）をつくってください。車両は車庫に車籍をおきます（${esc(asName())}）。船は港（フェリーターミナルの建物）に、飛行機は国の空港の駐機場に置きます。</p>`);
    const cars = d.cars.filter(c => c.depot === st.dep), forms = d.forms.filter(f => f.depot === st.dep), loose = cars.filter(c => !c.form);
    // 期間つき増結（DB の更新80）：入れ替え枠の車をえらぶと、この車庫の編成に増結できる。増結した車は期間を変えられる
    const v80 = d.forms.some(f => 'spare' in f), railForms = forms.filter(f => (f.perf || {}).rail !== false);
    const picked = st.pick.map(id => d.cars.find(c => c.id === id)).filter(Boolean);
    const addOK = v80 && dep && dep.kind === 'rail' && !st.form && picked.length > 0 && picked.every(c => !c.form && !c.xfer) && railForms.length > 0;
    const tmpOK = v80 && picked.length > 0 && picked.every(c => c.form && c.tmp);
    const road = dep.kind === 'bus', sea = dep.kind === 'ship', air = dep.kind === 'air', uni = sea || air, typeOpts = d.types.filter(t => roleKind(t.role) === dep.kind);   // 営業所：バス・トラック（t54l）・港：船（t54o）・空港：飛行機（t54p）
    const mks = st.mk.filter(x => (x.kind || 'rail') === (road ? 'road' : sea ? 'sea' : air ? 'air' : 'rail')), trucks = loose.filter(c => c.role === 'Truck');
    // 系列（DB の更新71）：電車・気動車は系列ごと、機関車と客車は1つにまとめて、編成で注文する。つなげる仲間（grp）
    const sers = d.series || S.boot.series || [], serOf = c => sers.find(x => x.code === c) || {}, groups = []; let lpG = null, lG = null, pG = null;
    const split = !!d.lsplit;   // DB の更新78：機関車は1両ずつ、客車は客車だけの編成で注文して、入れ替え枠の機関車をあとでつなぐ
    sers.forEach(x => { const ts = typeOpts.filter(t => t.series === x.code); if (!ts.length) return;
      if (split && x.kind === 'loco') { if (!lG) groups.push(lG = { k: 'L', kind: 'L', name: '機関車（1両ずつ）', types: [] }); lG.types.push(...ts); return; }
      if (split && x.kind === 'pc') { if (!pG) groups.push(pG = { k: 'P', kind: 'P', name: '客車（客車だけの編成。機関車はあとでつなぐ）', types: [] }); pG.types.push(...ts); return; }
      if (x.kind === 'loco' || x.kind === 'pc') { if (!lpG) groups.push(lpG = { k: 'lp', kind: 'lp', name: '機関車と客車', types: [] }); lpG.types.push(...ts); return; }
      groups.push({ k: x.code, kind: x.kind, s: x, name: x.name + (x.note ? '（' + x.note.split('。')[0].replace(/（[^）]*）/g, '') + '）' : ''), types: ts }); });
    if (lpG) lpG.types.sort((a, c) => (c.role === 'L') - (a.role === 'L'));
    if (lG && pG && groups.indexOf(lG) > groups.indexOf(pG)) { groups.splice(groups.indexOf(lG), 1); groups.splice(groups.indexOf(pG), 0, lG); }   // 機関車を客車の前に
    const rest = typeOpts.filter(t => !groups.some(x => x.types.includes(t))); if (rest.length) groups.push({ k: '_', kind: 'emu', name: 'そのほか', types: rest });
    const g = groups.find(x => x.k === st.ser) || groups[0] || { k: '', kind: 'emu', types: [] };
    const mates = g.s && g.s.grp ? sers.filter(x => x.grp === g.s.grp && x.code !== g.s.code).map(x => x.name) : [];
    const locos = g.types.filter(t => t.role === 'L'), pcSers = sers.filter(x => x.kind === 'pc' && g.types.some(t => t.series === x.code));
    // 等級・設備（DB の更新72）と、プリセット（系列の よく使う編成・自分で保存したもの）
    const CLS = { G: 'グリーン車', A: 'A寝台', B: 'B寝台' }, FN = { din: '食堂車', buf: 'ビュフェ', lng: 'ラウンジ', obs: '展望車', bag: '荷物車', mail: '郵便車', pow: '電源車' };
    const tTag = t => [t.face, CLS[t.cls], t.rooms ? `個室${t.rooms}室` : '', ...(t.fn || []).map(k => FN[k] || ''),
      t.gauge && t.gauge !== 1067 && !['Bus', 'Truck', 'Ship', 'Air'].includes(t.role) ? `軌間${t.gauge}mm` : '', t.elec && (t.ps & 8) ? '第三軌条' : ''].filter(Boolean).map(x => T(x)).join('・');   // 軌間・第三軌条（DB の更新99）
    const pcs = pcSers.find(x => x.code === st.pcs) || pcSers[0], loco = locos.find(t => t.code === st.loco) || locos.slice().sort((x, y) => y.vmax - x.vmax)[0];   // はじめは いちばん速い機関車
    const shown = g.kind === 'lp' ? g.types.filter(t => t.role === 'L' || !pcs || t.series === pcs.code) : g.kind === 'P' ? g.types.filter(t => !pcs || t.series === pcs.code) : g.types;   // 機関車と客車は、えらんだ客車の系列の形式だけ
    const has = c => typeOpts.some(t => t.code === c);
    const bsets = (g.kind === 'lp' || g.kind === 'P' ? (pcs && pcs.sets) || [] : (g.s && g.s.sets) || []).map(x => ({ n: x.n, t: (x.t || []).map(c => c === '@L' ? (g.kind === 'P' ? null : (loco || {}).code) : c).filter(Boolean) })).filter(x => x.t.length && x.t.every(has));
    const fsets = d.fsets ? d.fsets.filter(x => (x.types || []).length && x.types.every(has)) : null;   // DB の更新72 の前は null（プリセットを出さない）
    const nextFno = p => { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$'); let mx = 0, w = 2;
      d.forms.forEach(f => { const r2 = re.exec(f.name || ''); if (r2) { mx = Math.max(mx, Number(r2[1])); w = Math.max(w, r2[1].length); } }); return p + String(mx + 1).padStart(w, '0'); };
    const one = typeOpts.some(t => t.code === st.one) ? st.one : (g.types[0] || typeOpts[0] || {}).code;
    const optT = t => `<option value="${t.code}" ${t.code === one ? 'selected' : ''}>${esc(t.label)}${tTag(t) ? '（' + esc(tTag(t)) + '）' : ''}・${X(t.price)}</option>`;
    const sgs = [...new Set(typeOpts.map(t => t.series))];
    const ruleNote = g.kind === 'P' ? '客車だけの編成で注文します。機関車は「機関車（1両ずつ）」で注文して、とどいたら編成の「🚂 機関車をつなぐ」で先頭か最後につなぎます（つなぐまで走れません・運用に入れられません）。客車（P）には緩急車（車掌室つき）を1両以上。28系などは電源車もいります。客車の系列は、まぜてもかまいません。納車まで6時間'
      : g.kind === 'lp' ? '編成のきまり：機関車（L）を先頭か最後に1両以上。客車（P）には緩急車（車掌室つき）を1両以上。28系などは電源車もいります。機関車と客車の系列は、まぜてもかまいません。電気機関車は電化した線だけ（ディーゼル機関車は電化していない線も）。納車まで6時間'
      : g.kind === 'dmu' ? `編成のきまり：両はしは運転台つきの Dc（奇数向きと偶数向き。両運転台の車はどちらでも）。1両で走れるのは両運転台の車だけ。まん中には運転台のない D も入れられます。${mates.length ? mates.join('・') + 'ともつなげます。' : ''}電化していない線も走れます。納車まで6時間`
      : `編成のきまり：両はしは運転台つきの車（奇数向き・偶数向きがある形式は1両ずつ）。電動車（Mp・M）が1両以上、パンタグラフのある車（Mp・Tp）が1両以上で、M はその数まで。まん中にも運転台つきの車を入れられます（中間封じ込め：運転台は使いません）。${g.types.some(t => t.role === 'T') && !bsets.length ? 'グリーン車（T）は、形式のボタンで入れます。' : ''}${mates.length ? mates.join('・') + 'ともつなげます。' : ''}納車まで6時間`;
    const locoSpec = t => `<span>${esc(serOf(t.series).name || '')}</span>：<span>${esc(t.note || '')}</span><br><span>${t.power}kW・最高${t.vmax}km/h・${t.mass}t・長さ${t.len}m</span>${t.wkm ? `<span>・水で ${t.wkm}km・石炭で ${t.ckm}km 走れる</span>` : ''}<span>・${t.elec ? '電化した線だけ' : '電化していない線も走れる'}</span><span>・維持費 1日 ${fmt(t.upkeep)} X</span>`;
    const locoH = () => { const lt = g.types.find(t => t.code === st.lone) || g.types[0]; if (!lt) return '';
      return `<div class="mp-row small" style="align-items:center"><span>機関車</span><select class="mp-inp" data-lsel style="width:auto;max-width:100%">${g.types.map(t => `<option value="${t.code}" ${t === lt ? 'selected' : ''}>${esc(t.label)}・${esc((serOf(t.series).note || '').split('。')[0])}・${X(t.price)}</option>`).join('')}</select></div>
        <p class="small muted" style="margin:4px 0">${locoSpec(lt)}</p>
        <div class="mp-row" style="align-items:center"><span class="small">両数</span><input class="mp-inp mp-num" style="width:4em" data-ln value="1" inputmode="numeric"><button class="btn main" data-lord>見つもって注文</button></div>
        <p class="muted small" style="margin:2px 0 0">機関車は1両ずつ注文します。とどいた機関車は「入れ替え枠」に入ります。客車の編成の「🚂 機関車をつなぐ」で、先頭か最後につなぎます（2両で重連にもできます）。機関車だけで走らせるときは、入れ替え枠でえらんで「この順で編成にする」。${g.types.some(t => t.wkm) ? '蒸気機関車は、水と石炭を駅の給水・給炭設備で補給します（駅をタップしてつくれます）。止まる駅のあいだで水か石炭がたりなくなる列車は走れません（1日のはじめは満タン）。' : ''}納車まで6時間</p>`; };
    // 入れ替え枠の機関車を、客車の編成につなぐ（DB の更新78）
    const attH = (f, p) => { if (st.att !== f.id) return '';
      const ll = loose.filter(c => c.role === 'L' && !c.xfer);
      return `<div class="mp-item" style="margin-top:6px"><b>つなぐ機関車（入れ替え枠）</b>
        <div class="mp-cars">${ll.map(c => `<span class="mp-car ${st.attL === c.id ? 'on' : ''} ${c.busy && c.busy !== 'deliver' ? 'busy' : ''}" data-attl="${c.id}">${esc(c.num)}<span class="n">${c.busy ? esc(CAR_BUSY[c.busy] || c.busy) : `<span>状態${c.cond}</span>`}</span></span>`).join('') || '<span class="muted small">入れ替え枠に機関車がありません。下の「編成で注文する」で「機関車（1両ずつ）」をえらんで注文してください</span>'}</div>
        <div class="mp-row">${ll.length ? `<button class="btn main" data-attgo="head">先頭につなぐ</button><button class="btn" data-attgo="tail">最後につなぐ</button>${p.nl ? '<button class="btn" data-attgo="swap">いまの機関車ととりかえる</button>' : ''}` : ''}<button class="btn" data-attx>やめる</button></div>
        <p class="muted small" style="margin:2px 0 0">組みかえの手間 ${fmt(150000)} X（つなぐ1両ごとに 10万 X＋5万 X）。とりかえると、いまの機関車は入れ替え枠にもどります</p></div>`; };
    m.set('車両と編成', `
      <div class="tabs-s">${deps.map(x => `<button data-dep="${x.id}" class="${x.id === st.dep ? 'on' : ''}">${x.pub ? '✈ ' : ''}${esc(x.name)} ${x.n}/${x.cap}</button>`).join('')}</div>
      ${dep.pub ? '<p class="muted small" style="margin:4px 0 0">国の空港の駐機場です（みんなで使います。数は、みんなの飛行機の合計）</p>' : ''}
      <h4 style="margin:12px 0 4px">編成（${forms.length}）</h4>
      ${forms.map(f => { const p = f.perf || {}; const fc = cars.filter(c => c.form === f.id).sort((a, b) => a.pos - b.pos); return `<div class="mp-item">
        <b>${esc(f.name)}</b>${f.op ? ` <small class="muted"><span>運用</span> <span>${esc(f.op.num)}</span></small>` : ''}${f.spare ? ' <small class="mp-tag">予備</small>' : ''}${f.xfer ? ' <small class="mp-warn">譲渡の申しこみ中</small>' : ''}
        <small>${p.air ? `<span>長さ${p.len}m・${fmt(p.cap)}席</span><span>・巡航${p.vmax}km/h</span><span>・滑走路${fmt(p.rwy)}m以上</span>` : p.ship ? `<span>長さ${p.len}m・旅客${fmt(p.cap)}人</span>${p.load ? `<span>・車両 ${fmt(p.load)}t</span>` : '<span>・車はのせられない</span>'}<span>・最高${p.vmax}km/h</span>` : `<span>${p.n}両・${p.len}m・定員${fmt(p.cap)}人・加速 ${p.acc}km/h/s・最高${p.vmax}km/h</span>${p.gm && p.gm !== 2 ? `<span>・軌間 ${esc(gmN(p.gm))}</span>` : ''}${p.ac ? '<span>・冷房</span>' : ''}${p.toilet ? '<span>・トイレ</span>' : ''}${p.g ? `<span>・グリーン${p.g}</span>` : ''}${p.a ? `<span>・A寝台${p.a}</span>` : ''}${p.b ? `<span>・B寝台${p.b}</span>` : ''}${p.rooms ? `<span>・個室${p.rooms}室</span>` : ''}${p.din ? '<span>・食堂車</span>' : ''}${p.lng ? '<span>・ラウンジ</span>' : ''}${p.obs ? '<span>・展望車</span>' : ''}${p.bag ? `<span>・荷物と郵便${p.bag}両</span>` : ''}${p.wkm ? `<span>・蒸気（水で ${p.wkm}km・石炭で ${p.ckm}km）</span>` : ''}`}${uni ? `<span>・状態${p.cond}・便 ${f.trains}本</span>` : `<span>・状態${p.cond}・列車 ${f.trains}本</span>`}</small>
        ${split && p.np && !p.nl ? '<small class="mp-warn"><br>客車だけの編成です。機関車をつなぐまで走れません（運用に入れられません）</small>' : ''}
        ${f.spare ? `<small class="muted"><br>${f.subn ? `<b>代走の予定 ${f.subn}本</b>・` : ''}<span>同じ車庫の、同じ形式・両数の編成が検査・改造・転属のあいだ、その列車をかわりに走ります</span></small>`
          : f.subby ? `<small><br>🔁 <span>工事のあいだ、予備編成が ${f.subby}本 代走します</span></small>` : ''}
        <div class="mp-cars">${fc.map(c => carChip(c, st.pick.includes(c.id))).join('')}</div>
        ${dep.kind === 'rail' && split && p.np ? attH(f, p) : ''}
        <div class="mp-row">${dep.kind === 'rail' && split && p.np ? `<button class="btn" data-att="${f.id}">${p.nl ? '🚂 機関車をとりかえる・足す' : '🚂 機関車をつなぐ'}</button>${p.nl ? `<button class="btn" data-detach="${f.id}">機関車をはずす</button>` : ''}` : ''}${dep.kind === 'rail' ? `<button class="btn" data-reform="${f.id}">組みかえる</button><button class="btn" data-split="${f.id}">ばらす</button>` : ''}${dep.kind === 'rail' && 'spare' in f ? (f.spare ? `<button class="btn" data-spare="${f.id}" data-on="0">予備をやめる</button>` : f.op ? '' : `<button class="btn" data-spare="${f.id}" data-on="1">予備にする</button>`) : ''}${f.xfer ? '' : `<button class="btn" data-give="${f.id}">ゆずる</button>`}</div></div>`; }).join('') || '<p class="muted small">まだありません</p>'}
      ${dep.kind === 'rail' ? `<h4 style="margin:12px 0 4px">${split ? `入れ替え枠（編成に入っていない車両・${loose.length}両）` : `編成に入っていない車両（${loose.length}）`}</h4><div class="mp-cars">${loose.map(c => carChip(c, st.pick.includes(c.id))).join('') || '<span class="muted small">なし</span>'}</div>`
        : air ? `<p class="muted small" style="margin:6px 0 0">飛行機は1機ずつが編成（機体の番号）になります。≡ →「系統とダイヤ」で空路に便を入れて飛ばします。滑走路の短い空港には離着陸できません</p>`
        : sea ? `<p class="muted small" style="margin:6px 0 0">船は1隻ずつが編成（船の名前）になります。≡ →「系統とダイヤ」で航路に便を入れて走らせます。フェリーは人のほかにトラックをのせて、海をこえる荷物を運びます（運賃は航路の持ち主に）</p>`
        : `<h4 style="margin:12px 0 4px">🚚 トラック（${trucks.length}）</h4><div class="mp-cars">${trucks.map(c => carChip(c, st.pick.includes(c.id))).join('') || '<span class="muted small">なし</span>'}</div>
          <p class="muted small" style="margin:2px 0 0">トラックは、${esc(asName())}の工場・田畑・港の荷物を運びます（そのぶん運送費がかかりません）。1台で1時間に「積める重さ × ${fmt((S.boot.scr || {}).trk || 300)}km ÷ 24」t・km（1t 運ぶごとに 距離＋10km 分）。トラックターミナルを動かしていると +10%（3つまで）。状態が20より悪いと走りません</p>`}
      <div class="mp-item" style="margin-top:8px">${st.pick.length ? `<b>えらんだ車両（${st.pick.length}）</b>：${st.pick.map(id => esc((d.cars.find(c => c.id === id) || {}).num || '')).join(' → ')}
          <div class="mp-row">${dep.kind === 'rail' ? `<input class="mp-inp" style="flex:1 1 120px" data-fname placeholder="編成番号（例：R1）" value="${esc(st.form ? (d.forms.find(f => f.id === st.form) || {}).name || '' : '')}"><button class="btn main" data-mkform>${st.form ? 'この順に組みかえる' : 'この順で編成にする'}</button>` : ''}</div>
          ${addOK ? `<div class="mp-row small" style="align-items:center"><span>増結</span><select class="mp-inp" data-addf style="width:auto;max-width:100%">${railForms.map(f => `<option value="${f.id}" ${st.addF === f.id ? 'selected' : ''}>${esc(f.name)}${f.op ? '（' + esc(T('運用')) + ' ' + esc(f.op.num) + '）' : f.spare ? '（' + esc(T('予備')) + '）' : ''}</option>`).join('')}</select>
            <select class="mp-inp" data-addat style="width:auto"><option value="tail" ${st.addAt === 'tail' ? 'selected' : ''}>最後がわ</option><option value="head" ${st.addAt === 'head' ? 'selected' : ''}>先頭がわ</option></select>
            <select class="mp-inp" data-addh style="width:auto">${ADDH.map(([h, l]) => `<option value="${h}" ${String(st.addH) === String(h) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="mp-row"><button class="btn" data-addgo>見つもって増結</button></div>` : ''}
          ${tmpOK ? `<div class="mp-row small" style="align-items:center"><span>増結の期間</span><select class="mp-inp" data-tmph style="width:auto">${ADDH.map(([h, l]) => `<option value="${h}" ${String(h) === '24' ? 'selected' : ''}>${h === '' ? 'ずっと（期間なし）' : 'いまから' + l}</option>`).join('')}</select><button class="btn" data-tmpgo>期間を変える</button></div>` : ''}
          <div class="mp-row">${uni ? '' : `<button class="btn" data-w="ac">冷房をつける</button><button class="btn" data-w="heat">暖房をつける</button>${st.pick.every(id => (d.cars.find(c => c.id === id) || {}).role === 'Truck') ? '' : '<button class="btn" data-w="toilet">トイレをつける</button>'}${'zone' in dep ? `<button class="btn" data-w="snow" title="${road ? '冬用タイヤとチェーン（6時間）' : '耐雪改造（48時間）'}">❄ 雪の対策</button>` : ''}`}
            <button class="btn" data-w="inspect">検査</button><button class="btn" data-w="renew">更新工事</button><button class="btn" data-move>${uni ? '回航' : '転属'}</button><button class="btn" data-scrap>${sea ? '廃船' : air ? '廃機' : '廃車'}</button>
            ${dep.kind === 'rail' && st.pick.every(id => { const c = d.cars.find(x => x.id === id); return c && !c.form && !c.xfer; }) ? '<button class="btn" data-give2>ゆずる</button>' : ''}<button class="btn" data-hist>車歴</button><button class="btn" data-clear>えらびなおす</button></div>`
        : air ? '<small class="muted">飛行機をタップしてえらぶと、検査・更新工事・回航（ほかの空港へ）・廃機ができます</small>'
        : sea ? '<small class="muted">船をタップしてえらぶと、検査・更新工事・回航（ほかの港へ）・廃船ができます</small>' : '<small class="muted">車両をタップしてえらぶと、編成・改造・検査・転属・廃車ができます。編成は、えらんだ順（先頭から）になります</small>'}</div>
      <h4 style="margin:14px 0 4px">メーカー</h4>
        <div class="mp-row"><select class="mp-inp" data-maker style="width:auto;max-width:100%"><option value="">${road ? '国のメーカー（定価・3時間で納車）' : sea ? '国の造船所（定価・24時間で納車）' : air ? '国の航空機メーカー（定価・48時間で納車）' : '国のメーカー（定価・6時間で納車）'}</option>${mks.map(x => `<option value="${x.id}" translate="no" ${st.maker === x.id ? 'selected' : ''}>${esc(x.name)}（${esc(x.who)}）・${esc(x.as === S.as ? T(`部品代 ${Math.round(x.parts * 100)}%`) : T(`定価の${Math.round(x.lv * 100)}%`))}・${esc(road ? T(`1日${x.capd}台`) : sea ? T(`1日${fmt(x.tpd)}t`) : T(`1日${x.capd}両`))}・${esc(T(`鉄鋼 ${x.steel}t`))}${x.wait ? '・' + esc(T(`待ち ${x.wait}時間`)) : ''}</option>`).join('')}</select></div>
        <p class="muted small" style="margin:2px 0 0">${air ? '飛行機は、いまは国の航空機メーカーだけです（1980年ごろの性能）' : sea ? (mks.length ? '造船所をえらぶと、その造船所の鉄鋼で船をつくります（納車は造船所が1日につくれる重さで順番に）。自分の造船所なら部品代だけ' : '造船所（人・会社の工場）は、まだありません。船は1980年ごろの性能です') : road ? (mks.length ? '自動車工場をえらぶと、その工場の鉄鋼でバス・トラックをつくります（納車は工場の1日につくれる台数で順番に）。自分の工場なら部品代だけ' : '自動車工場（人・会社の工場）は、まだありません。バス・トラックは1980年ごろの性能です')
          : (mks.length ? '鉄道車両工場をえらぶと、その工場の鉄鋼でつくります（納車は工場の1日につくれる両数で順番に）。自分の工場なら部品代だけ' : '鉄道車両工場（人・会社の工場）は、まだありません')}</p>
      ${dep.kind === 'rail' ? `<h4 style="margin:14px 0 4px">編成で注文する</h4>
        ${groups.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>系列</span><select class="mp-inp" data-ser style="width:auto;max-width:100%">${groups.map(x => `<option value="${esc(x.k)}" ${x === g ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        ${g.kind === 'L' ? locoH() : `${g.kind === 'P' && pcSers.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>客車の系列</span><select class="mp-inp" data-pcs style="width:auto;max-width:100%">${pcSers.map(x => `<option value="${x.code}" ${pcs === x ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        ${g.kind === 'lp' ? `<div class="mp-row small" style="align-items:center"><span>機関車</span><select class="mp-inp" data-loco style="width:auto;max-width:100%">${locos.map(t => `<option value="${t.code}" ${loco === t ? 'selected' : ''}>${esc(t.label)}・${esc((serOf(t.series).note || '').split('。')[0])}</option>`).join('')}</select>
            <span>客車</span><select class="mp-inp" data-pcs style="width:auto;max-width:100%">${pcSers.map(x => `<option value="${x.code}" ${pcs === x ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        ${bsets.length ? `<div class="mp-row small" style="align-items:center"><span>プリセット</span>${bsets.map((x, i) => `<button class="btn" style="flex:none;padding:4px 10px" data-bs="${i}">${esc(x.n)}</button>`).join('')}</div>` : ''}
        ${fsets ? `<div class="mp-row small" style="align-items:center"><span>保存したプリセット</span>${fsets.map(x => `<span style="display:inline-flex;gap:2px"><button class="btn" style="flex:none;padding:4px 10px" data-fs="${x.id}">${esc(x.name)}<small>（${x.types.length}両）</small></button><button class="btn" style="flex:none;padding:4px 8px" data-fsdel="${x.id}" title="${esc(T('消す'))}">✕</button></span>`).join('') || '<span class="muted">まだありません（形式をならべて「＋ この並びを保存」）</span>'}${st.seq.length ? '<button class="btn" style="flex:none;padding:4px 10px" data-fsave>＋ この並びを保存</button>' : ''}</div>` : ''}
        <div class="mp-row small" style="align-items:center"><span>形式を先頭から順に</span>${shown.map(t => `<button class="btn" style="flex:none;padding:4px 10px" data-sq="${t.code}">${esc(t.label)}${tTag(t) ? `<small>（${esc(tTag(t))}）</small>` : ''}</button>`).join('')}</div>
        ${g.kind === 'lp' || g.kind === 'P' ? `<div class="mp-row small" style="align-items:center"><span>${g.kind === 'P' ? 'よく使う形（客車だけ）' : 'よく使う形（機関車＋客車）'}</span>${[2, 4, 6, 8, 10, 12].map(n => `<button class="btn" style="flex:none;padding:4px 10px" data-sql="${n}">客車${n}両</button>`).join('')}</div>`
          : bsets.length ? '' : `<div class="mp-row small" style="align-items:center"><span>よく使う形</span>${(g.kind === 'dmu' ? [1, 2, 3, 4].filter(n => n > 1 || g.types.some(t => t.face === '両運転台')) : [4, 6, 8, 10]).map(n => `<button class="btn" style="flex:none;padding:4px 10px" ${g.kind === 'dmu' ? 'data-sqd' : 'data-sqn'}="${n}">${n}両</button>`).join('')}</div>`}
        <div class="mp-cars">${st.seq.map((code, i) => { const t = d.types.find(x => x.code === code) || {}; return `<span class="mp-car on" data-sqx="${i}"><b>${i + 1}</b> ${esc(t.label || code)}<span class="n">${esc(tTag(t) || t.role || '')}</span></span>`; }).join('') || '<span class="muted small">形式をえらぶと、ここに先頭から並びます（タップで外す）</span>'}</div>
        <div class="mp-row" style="align-items:center"><input class="mp-inp" style="flex:1 1 120px" data-fno placeholder="編成番号（例：R1）" value="${esc(st.fno || '')}"><label class="small" style="display:inline-flex;align-items:center;gap:4px"><span>×</span><input class="mp-inp mp-num" style="width:4em" data-fsets value="1" inputmode="numeric"><span>本まとめて</span></label><button class="btn main" data-ford ${st.seq.length ? '' : 'disabled'}>見つもって注文</button><button class="btn" data-sqc>えらびなおす</button></div>
        <p class="muted small" style="margin:2px 0 0">${ruleNote}</p>`}` : ''}
      <h4 style="margin:14px 0 4px">${sea ? '注文する（1隻から）' : air ? '注文する（1機から）' : '注文する（1両から）'}</h4>
      <select class="mp-inp" data-type>${sgs.length > 1 ? sgs.map(c => `<optgroup label="${esc(serOf(c).name || c)}">${typeOpts.filter(t => t.series === c).map(optT).join('')}</optgroup>`).join('') : typeOpts.map(optT).join('')}</select>
      <p class="small muted" data-tnote style="margin:4px 0"></p>
      <div class="mp-row">${dep.kind === 'bus' ? '台数' : sea ? '隻数' : air ? '機数' : '両数'} <input class="mp-inp mp-num" type="number" min="1" max="${uni ? 4 : 20}" value="1" data-n> <button class="btn main" data-order>見つもって注文</button></div>
      <p class="muted small">${air ? `${esc(asName())}・納車まで飛行機は48時間（国の航空機メーカー）。機体の番号は形式ごとに順番につきます` : sea ? `${esc(asName())}・納車まで船は24時間（国の造船所）。船の名前は形式ごとに順番につきます` : `${esc(asName())}・納車まで鉄道の車両は6時間、バスは3時間。車番は形式ごとに順番につきます`}</p>
      <div class="mp-row"><button class="btn" data-gone>廃車した車両</button></div>`, b => {
      const tnote = () => { const t = d.types.find(x => x.code === b.querySelector('[data-type]').value); if (!t) return; const s = sers.find(x => x.code === t.series);
        b.querySelector('[data-tnote]').innerHTML = `${s ? `<span>${esc(s.name)}</span>：` : ''}<span>${esc(t.note)}</span><br>${t.role === 'Truck' ? `<span>長さ${t.len}m・積める重さ ${t.load}t・${t.mass}t</span>` : t.role === 'Ship' ? `<span>長さ${t.len}m・旅客${fmt(t.cap)}人</span>${t.load ? `<span>・車両 ${fmt(t.load)}t</span>` : ''}<span>・${fmt(t.mass)}総トン</span>`
          : t.role === 'Air' ? `<span>長さ${t.len}m・${fmt(t.cap)}席・${fmt(t.mass)}t</span><span>・滑走路${fmt(t.rwy)}m以上</span>` : !t.cap ? `<span>長さ${t.len}m・${t.mass}t${t.seats ? T(`・${t.seats}席（定員にはふくまない）`) : '（客は乗れない）'}</span>` : t.cls === 'A' || t.cls === 'B' ? `<span>長さ${t.len}m・寝台${t.cap}・${t.mass}t</span>` : `<span>長さ${t.len}m・定員${t.cap}人（座席${t.seats}）・${t.mass}t</span>`}${tTag(t) ? `<span>・${esc(tTag(t))}</span>` : ''}${t.power ? `<span>・${t.power}kW</span>` : ''}${t.wkm ? `<span>・水で ${t.wkm}km・石炭で ${t.ckm}km 走れる</span>` : ''}<span>・最高${t.vmax}km/h</span>${t.acc && roleKind(t.role) === 'rail' ? `<span>・加速は ${Number(t.acc).toFixed(1)}km/h/s まで</span>` : ''}<span>・維持費 1日 ${fmt(t.upkeep)} X</span>`; };
      tnote(); b.querySelector('[data-type]').onchange = () => { st.one = b.querySelector('[data-type]').value; tnote(); };
      const mkSel = b.querySelector('[data-maker]'); if (mkSel) mkSel.onchange = () => { st.maker = Number(mkSel.value) || null; };
      const maker = () => mks.some(x => x.id === st.maker) ? st.maker : null;
      const mkLine = r => r.maker ? '\n' + T(`メーカー：${r.maker}（鉄鋼 ${r.steel}t）`) : '';
      b.querySelectorAll('[data-dep]').forEach(x => x.onclick = () => { st.dep = Number(x.dataset.dep); st.pick = []; st.form = null; draw(); });
      b.querySelectorAll('[data-car]').forEach(x => x.onclick = () => { const id = Number(x.dataset.car); const i = st.pick.indexOf(id); if (i >= 0) st.pick.splice(i, 1); else st.pick.push(id); draw(); });
      b.querySelectorAll('[data-reform]').forEach(x => x.onclick = () => { const f = Number(x.dataset.reform); st.form = f; st.pick = cars.filter(c => c.form === f).sort((a, c) => a.pos - c.pos).map(c => c.id); draw(); });
      b.querySelectorAll('[data-split]').forEach(x => x.onclick = async () => { if (await confirm2(T('この編成をばらしますか？（列車の運用からも外れます）'), { q: '本当にばらしますか？', ok: 'ばらす', note: 'もう一度つくるときは、車両をえらんで編成からやりなおしです。' }) && await api('mp_form_del', { p_form: Number(x.dataset.split), p_as: S.as }, 'ばらしました')) { runListStale(); load(); } });
      const q = k => b.querySelector(k);
      if (q('[data-clear]')) q('[data-clear]').onclick = () => { st.pick = []; st.form = null; draw(); };
      if (q('[data-mkform]')) q('[data-mkform]').onclick = async () => {
        const r = await api('mp_form_set', { p_form: st.form, p_cars: st.pick, p_name: q('[data-fname]').value, p_as: S.as });
        if (r) { toast(T(`編成にしました（加速 ${r.perf.acc}km/h/s・定員 ${fmt(r.perf.cap)}人）`) + (r.fee ? SEP() + T(`・組みかえ ${fmt(r.fee)} X`) : '')); st.pick = []; st.form = null; runListStale(); load(); }
      };
      b.querySelectorAll('[data-w]').forEach(x => x.onclick = async () => {
        const k = x.dataset.w, r = await api('mp_car_work', { p_cars: st.pick, p_kind: k, p_as: S.as, p_dry: true }); if (!r) return;
        const l1 = air ? `${r.n}機：${x.textContent}・${fmt(r.cost)} X・${r.hours}時間（そのあいだ飛べません）` : sea ? `${r.n}隻：${x.textContent}・${fmt(r.cost)} X・${r.hours}時間（そのあいだ走れません）`
          : `${r.n}${road ? '台' : '両'}：${x.textContent.replace('❄ ', '')}${k === 'snow' ? (road ? '（冬用タイヤとチェーン）' : '（耐雪改造）') : ''}・${fmt(r.cost)} X${r.sub ? `（ほかに補助金 ${fmt(r.sub)} X を国が）` : ''}・${r.hours}時間（そのあいだ走れません）`;
        if (!confirm(T(`${l1}${r.skip ? '\n（できない車両：' + r.skip + '）' : ''}`) + carRunsT(r))) return;
        if (await api('mp_car_work', { p_cars: st.pick, p_kind: k, p_as: S.as, p_dry: false }, 'たのみました')) { st.pick = []; runListStale(); load(); }
      });
      if (q('[data-move]')) q('[data-move]').onclick = async () => {
        const others = deps.filter(x => x.id !== st.dep && x.kind === dep.kind);
        if (!others.length) return toast('ほかの車庫がありません');
        const name = prompt(T('うつす先の車庫の番号：\n') + others.map((x, i) => `${i + 1}. ${x.name}`).join('\n'), '1'); const to = others[Number(name) - 1]; if (!to) return;
        const r = await api('mp_car_move', { p_cars: st.pick, p_depot: to.id, p_as: S.as, p_dry: true }); if (!r) return;
        if (confirm(T(`「${to.name}」へ ${r.how}・${fmt(r.cost)} X・${r.hours}時間`) + carRunsT(r)) && await api('mp_car_move', { p_cars: st.pick, p_depot: to.id, p_as: S.as, p_dry: false }, uni ? '回航します' : '転属します')) { st.pick = []; runListStale(); load(); }
      };
      if (q('[data-scrap]')) q('[data-scrap]').onclick = async () => {
        const r = await api('mp_car_scrap', { p_cars: st.pick, p_as: S.as, p_dry: true }); if (!r) return;
        if (await confirm2(T(air ? `${r.n}機を廃機にします（機体の登録がなくなります）。スクラップ代 ${fmt(r.back)} X がもどります` : sea ? `${r.n}隻を廃船にします（船籍がなくなります）。スクラップ代 ${fmt(r.back)} X がもどります` : `${r.n}両を廃車にします（車籍がなくなります）。スクラップ代 ${fmt(r.back)} X がもどります`),
                           { what: air ? `${r.n}機` : sea ? `${r.n}隻` : `${r.n}両`, q: air ? '本当に廃機にしますか？' : sea ? '本当に廃船にしますか？' : '本当に廃車にしますか？', ok: air ? '廃機にする' : sea ? '廃船にする' : '廃車にする' })
            && await api('mp_car_scrap', { p_cars: st.pick, p_as: S.as, p_dry: false }, sea ? '廃船にしました' : air ? '廃機にしました' : '廃車にしました')) { st.pick = []; runListStale(); load(); }
      };
      b.querySelectorAll('[data-sq]').forEach(x => x.onclick = () => { if (st.seq.length >= 16) return toast('1編成は16両までです'); st.seq.push(x.dataset.sq); draw(); });
      b.querySelectorAll('[data-sqx]').forEach(x => x.onclick = () => { st.seq.splice(Number(x.dataset.sqx), 1); draw(); });
      const by = (role, face) => (g.types.find(t => t.role === role && (face == null || t.face === face)) || {}).code;   // えらんだ系列の形式
      if (q('[data-ser]')) q('[data-ser]').onchange = () => {   // つなげない系列にかえたら、ならべた形式は消す
        st.ser = q('[data-ser]').value; const ng = groups.find(x => x.k === st.ser) || g, key = x => ['lp', 'L', 'P'].includes(x.kind) ? x.kind : (x.s && x.s.grp) || x.k;
        const tk = c => { const t = d.types.find(y => y.code === c) || {}, x = serOf(t.series); return x.kind === 'loco' || x.kind === 'pc' ? (split ? (x.kind === 'loco' ? 'L' : 'P') : 'lp') : x.grp || x.code || '_'; };
        if (st.seq.some(c => tk(c) !== key(ng))) st.seq = [];
        draw(); };
      b.querySelectorAll('[data-sqn]').forEach(x => x.onclick = () => {   // Tc（奇数向き）＋（Mp M）× k ＋ Tc（偶数向き）
        const tc1 = by('Tc', '奇数向き') || by('Tc'), tc2 = by('Tc', '偶数向き') || by('Tc'), mp = by('Mp'), mm = by('M');
        if (!tc1 || !tc2 || !mp) return toast('この形式ではつくれません');
        const k = (Number(x.dataset.sqn) - 2) / 2; st.seq = [tc1]; for (let i = 0; i < k; i++) { st.seq.push(mp); if (mm) st.seq.push(mm); else st.seq.push(mp); } st.seq.push(tc2); draw();
      });
      b.querySelectorAll('[data-sqd]').forEach(x => x.onclick = () => {   // 気動車：両はしは Dc（奇数向き・偶数向き。なければ両運転台）。まん中は D（1両目）と、両運転台か Dc（DB の更新71）
        const n = Number(x.dataset.sqd), both = by('Dc', '両運転台'), o = by('Dc', '奇数向き'), e = by('Dc', '偶数向き'), mid = by('D');
        if (n === 1) { if (!both) return toast('この系列は1両では走れません'); st.seq = [both]; return draw(); }
        const h = o || both, t2 = e || both; if (!h || !t2) return toast('この形式ではつくれません');
        st.seq = [h]; for (let i = 0; i < n - 2; i++) st.seq.push(i === 0 && mid ? mid : both || (i % 2 ? o : e)); st.seq.push(t2); draw();
      });
      if (q('[data-loco]')) q('[data-loco]').onchange = () => { st.loco = q('[data-loco]').value; draw(); };
      // 機関車の注文・つなぐ・はずす（DB の更新78）
      if (q('[data-lsel]')) q('[data-lsel]').onchange = () => { st.lone = q('[data-lsel]').value; draw(); };
      if (q('[data-lord]')) q('[data-lord]').onclick = async () => {
        const t = q('[data-lsel]').value, n = Math.round(Number(hw(q('[data-ln]').value)) || 1);
        if (n < 1 || n > 20) return toast('両数は1〜20です');
        const r = await api('mp_car_order', { p_type: t, p_n: n, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
        if (!confirm(T(`${r.nums.join('・')}\n${fmt(r.cost)} X（維持費 1日 ${fmt(r.upkeep)} X）。${r.hours ? r.hours + '時間で納車' : 'すぐ納車'}。とどいたら入れ替え枠に入ります`) + mkLine(r))) return;
        if (await api('mp_car_order', { p_type: t, p_n: n, p_depot: st.dep, p_as: S.as, p_dry: false, p_maker: maker() }, '注文しました')) load();
      };
      b.querySelectorAll('[data-att]').forEach(x => x.onclick = () => { const id = Number(x.dataset.att); st.att = st.att === id ? null : id; st.attL = null; draw(); });
      b.querySelectorAll('[data-attl]').forEach(x => x.onclick = () => { st.attL = Number(x.dataset.attl); draw(); });
      if (q('[data-attx]')) q('[data-attx]').onclick = () => { st.att = null; st.attL = null; draw(); };
      b.querySelectorAll('[data-attgo]').forEach(x => x.onclick = async () => {
        const f = d.forms.find(z => z.id === st.att); if (!f) return; if (!st.attL) return toast('つなぐ機関車をえらんでください');
        const fc = cars.filter(c => c.form === f.id).sort((a, c) => a.pos - c.pos).map(c => c.id), isL = id => (d.cars.find(c => c.id === id) || {}).role === 'L', how = x.dataset.attgo;
        const rest = fc.filter(id => !isL(id));
        const seq = how === 'head' ? [st.attL, ...fc] : how === 'tail' ? [...fc, st.attL] : isL(fc[0]) ? [st.attL, ...rest] : [...rest, st.attL];
        const r = await api('mp_form_set', { p_form: f.id, p_cars: seq, p_name: f.name, p_as: S.as });
        if (r) { toast(T(`機関車をつなぎました（加速 ${r.perf.acc}km/h/s）`) + (r.fee ? SEP() + T(`・組みかえ ${fmt(r.fee)} X`) : '')); st.att = null; st.attL = null; runListStale(); load(); }
      });
      b.querySelectorAll('[data-detach]').forEach(x => x.onclick = async () => {
        const f = d.forms.find(z => z.id === Number(x.dataset.detach)); if (!f) return;
        const rest = cars.filter(c => c.form === f.id && c.role !== 'L').sort((a, c) => a.pos - c.pos).map(c => c.id); if (!rest.length) return toast('客車がありません');
        if (!confirm(T(`編成「${f.name}」から機関車をはずして、入れ替え枠に入れます。${f.op ? `運用 ${f.op.num} からはずれます（機関車をつないだら、運用に入れなおしてください）。` : ''}`))) return;
        const r = await api('mp_form_set', { p_form: f.id, p_cars: rest, p_name: f.name, p_as: S.as }); if (r) { toast(T('機関車をはずしました')); runListStale(); load(); }
      });
      // 予備編成にする・やめる（DB の更新80）
      b.querySelectorAll('[data-spare]').forEach(x => x.onclick = async () => {
        const on = x.dataset.on === '1', f = d.forms.find(z => z.id === Number(x.dataset.spare)); if (!f) return;
        if (on && !confirm(T(`編成「${f.name}」を予備にします。運用には入れずに待機して、同じ車庫の同じ形式・両数の編成が検査・改造・転属のあいだ、その列車をかわりに走ります（代走）。運用に入れると予備ではなくなります`))) return;
        const r = await api('mp_form_spare', { p_form: f.id, p_on: on, p_as: S.as }); if (!r) return;
        toast(on ? (r.subn ? T(`予備にしました（代走の予定 ${r.subn}本）`) : T('予備にしました')) : T('予備をやめました')); runListStale(); load();
      });
      // 入れ替え枠の車両を増結する・増結の期間を変える（DB の更新80）
      if (q('[data-addf]')) q('[data-addf]').onchange = () => { st.addF = Number(q('[data-addf]').value); };
      if (q('[data-addat]')) q('[data-addat]').onchange = () => { st.addAt = q('[data-addat]').value; };
      if (q('[data-addh]')) q('[data-addh]').onchange = () => { st.addH = q('[data-addh]').value; };
      if (q('[data-addgo]')) q('[data-addgo]').onclick = async () => {
        const fid = Number(q('[data-addf]').value), at = q('[data-addat]').value, hv = q('[data-addh]').value, f = d.forms.find(z => z.id === fid);
        if (!f) return toast('増結する編成をえらんでください');
        const arg = { p_form: fid, p_cars: st.pick, p_at: at, p_hours: hv === '' ? null : Number(hv), p_as: S.as };
        const r = await api('mp_form_add', { ...arg, p_dry: true }); if (!r) return;
        const until = r.until ? T(`期間：${mdhmA(Date.parse(r.until) / 1000)} まで（すぎたら はずして入れ替え枠にもどします）`) : T('期間：ずっと（もどすときは「組みかえる」で）');
        if (!confirm(T(`編成「${f.name}」に ${st.pick.length}両を増結します（${at === 'head' ? '先頭がわ' : '最後がわ'}）`) + `\n${r.seq.join(' → ')}\n`
          + T(`${r.n}両・長さ ${r.len}m・定員 ${fmt(r.cap0)} → ${fmt(r.cap)}人`) + '\n' + T(`組みかえの手間 ${fmt(r.fee)} X`) + '\n' + until)) return;
        const r2 = await api('mp_form_add', { ...arg, p_dry: false }); if (!r2) return;
        toast(T(`増結しました（${r2.n}両）`)); st.pick = []; st.addF = fid; runListStale(); load();
      };
      if (q('[data-tmpgo]')) q('[data-tmpgo]').onclick = async () => {
        const hv = q('[data-tmph]').value;
        const r = await api('mp_car_tmp', { p_cars: st.pick, p_hours: hv === '' ? null : Number(hv), p_as: S.as }); if (!r) return;
        toast(r.until ? T(`期間を ${mdhmA(Date.parse(r.until) / 1000)} までにしました`) : T('期間をなくしました（ずっと編成に入れておきます）')); st.pick = []; load();
      };
      if (q('[data-pcs]')) q('[data-pcs]').onchange = () => { st.pcs = q('[data-pcs]').value; draw(); };
      if (q('[data-fno]')) q('[data-fno]').oninput = () => { st.fno = q('[data-fno]').value; };
      b.querySelectorAll('[data-bs]').forEach(x => x.onclick = () => { const p = bsets[Number(x.dataset.bs)]; if (!p) return; st.seq = p.t.slice(); draw(); });
      b.querySelectorAll('[data-fs]').forEach(x => x.onclick = () => {   // 保存したプリセット：形式をならべ、系列をあわせ、編成番号のつづきをすすめる（DB の更新72）
        const p = (fsets || []).find(y => y.id === Number(x.dataset.fs)); if (!p) return;
        st.seq = p.types.slice(); const tp = c => typeOpts.find(t => t.code === c) || {}, gx = groups.find(y => y.types.some(t => t.code === p.types[0]));
        if (split && p.types.some(c => tp(c).role === 'P')) { st.ser = 'P'; const pc = p.types.map(tp).find(t => t.role === 'P'); if (pc) st.pcs = pc.series; }   // 機関車をふくむ前のプリセットも、客車の注文で（機関車ごと注文できる）
        else if (gx) { st.ser = gx.k; if (gx.kind === 'lp') { const pc = p.types.map(tp).find(t => t.role === 'P'); if (pc) st.pcs = pc.series; const lc = p.types.find(c => tp(c).role === 'L'); if (lc) st.loco = lc; } }
        if (p.pfx) st.fno = nextFno(p.pfx);
        draw();
      });
      b.querySelectorAll('[data-fsdel]').forEach(x => x.onclick = async () => {
        const p = (fsets || []).find(y => y.id === Number(x.dataset.fsdel)); if (!p || !confirm(T(`プリセット「${p.name}」を消しますか？`))) return;
        const r = await api('mp_fset_del', { p_id: p.id }, '消しました'); if (r) { d.fsets = r; draw(); }
      });
      if (q('[data-fsave]')) q('[data-fsave]').onclick = async () => {   // 編成番号のはじめ（L01 の L）も保存して、つぎに使うとき続きの番号をすすめる
        const nm = prompt(T('プリセットの名前（例：急行 8両）'), `${g.kind === 'lp' || g.kind === 'P' ? (pcs || {}).name || '' : (g.s || {}).name || ''} ${st.seq.length}両`.trim()); if (!nm) return;
        const pfx = ((q('[data-fno]').value || '').match(/^\D*/) || [''])[0].trim();
        const r = await api('mp_fset_save', { p_name: nm, p_types: st.seq, p_pfx: pfx }, 'プリセットに保存しました'); if (r) { d.fsets = r; draw(); }
      };
      b.querySelectorAll('[data-sql]').forEach(x => x.onclick = () => {   // 機関車＋緩急車＋客車…＋緩急車（DB の更新71）
        const n = Number(x.dataset.sql), L = (loco || {}).code, ps = g.types.filter(t => t.role === 'P' && t.series === (pcs || {}).code);
        const plain = t => t.cap > 0 && !(t.fn || []).some(k => k !== 'np');   // 人が乗る、ふつうの客車
        const fu = (ps.find(t => t.face === '緩急車' && plain(t)) || ps.find(t => t.face === '緩急車') || {}).code, ha = (ps.find(t => t.face !== '緩急車' && plain(t) && !t.rooms && !['A', 'G'].includes(t.cls)) || ps.find(t => t.face !== '緩急車' && plain(t)) || {}).code || fu;
        const pw = ps.some(t => (t.fn || []).includes('np')) ? (ps.find(t => (t.fn || []).includes('pow')) || {}).code : null;
        if ((!L && g.kind !== 'P') || !fu) return toast('この形式ではつくれません');
        st.seq = g.kind === 'P' ? [] : [L]; if (pw) st.seq.push(pw); st.seq.push(fu); for (let i = 0; i < n - 2; i++) st.seq.push(ha); st.seq.push(fu); draw();
      });
      if (q('[data-sqc]')) q('[data-sqc]').onclick = () => { st.seq = []; draw(); };
      if (q('[data-ford]')) q('[data-ford]').onclick = async () => {
        const no = q('[data-fno]').value.trim(); if (!no) return toast('編成番号を入れてください');
        const sets = Math.round(Number(hw(q('[data-fsets]').value)) || 1);   // まとめて何本（2026-10-28）
        if (sets < 1 || sets > 20) return toast('本数は1〜20です');
        if (sets > 1) {
          const r = await api('mp_form_order_many', { p_types: st.seq, p_name: no, p_sets: sets, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
          if (!confirm(T(`${r.n}両編成を ${sets}本（${r.n_all}両）：${r.names.join('・')}\n${fmt(r.cost_all)} X（維持費 1日 ${fmt(r.upkeep_all)} X）。${r.hours ? r.hours + '時間で納車' : 'すぐ納車'}`) + mkLine(r)
                       + (maker() ? '\n' + T('工場では1本ずつ順につくるので、あとの編成ほど納車がおそくなることがあります') : ''))) return;
          const x = await api('mp_form_order_many', { p_types: st.seq, p_name: no, p_sets: sets, p_depot: st.dep, p_as: S.as, p_dry: false, p_maker: maker() });
          if (x) { toast(T(`${x.sets}本を注文しました（${x.names[0]}〜${x.names[x.names.length - 1]}）`)); st.seq = []; st.fno = ''; load(); }
          return;
        }
        const r = await api('mp_form_order', { p_types: st.seq, p_name: no, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
        if (!confirm(T(`編成「${no}」${r.n}両：${r.nums.join('・')}\n${fmt(r.cost)} X（維持費 1日 ${fmt(r.upkeep)} X）。${r.hours ? r.hours + '時間で納車' : 'すぐ納車'}`) + mkLine(r))) return;
        if (await api('mp_form_order', { p_types: st.seq, p_name: no, p_depot: st.dep, p_as: S.as, p_dry: false, p_maker: maker() }, '注文しました')) { st.seq = []; st.fno = ''; load(); }
      };
      b.querySelectorAll('[data-give]').forEach(x => x.onclick = () => giveForm(d.forms.find(f => f.id === Number(x.dataset.give)), load));
      if (q('[data-give2]')) q('[data-give2]').onclick = () => giveCars(st.pick.map(id => d.cars.find(c => c.id === id)).filter(Boolean), () => { st.pick = []; load(); });
      if (q('[data-hist]')) q('[data-hist]').onclick = async () => { const r = await api('mp_car_log', { p_cars: st.pick, p_as: S.as }); if (r) carLog('車歴', r); };
      q('[data-gone]').onclick = async () => { const r = await api('mp_cars_gone', { p_as: S.as }); if (r) carLog('廃車した車両', r); };
      q('[data-order]').onclick = async () => {
        const t = q('[data-type]').value, n = Number(q('[data-n]').value) || 1;
        const r = await api('mp_car_order', { p_type: t, p_n: n, p_depot: st.dep, p_as: S.as, p_dry: true, p_maker: maker() }); if (!r) return;
        if (!confirm(T(`${r.nums.join('・')}\n${fmt(r.cost)} X（維持費 1日 ${fmt(r.upkeep)} X）。${r.hours ? r.hours + '時間で納車' : 'すぐ納車'}`) + mkLine(r))) return;
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
  const ui = b => { const k = (S.boot.sck || {})[b.grp] || {}, u = FAC_UI[k.use] || FAC_UI.school; return k.kb ? { ...u, who: '客', day: '24時間の手数料' } : u; };   // 場外馬券売り場（DB の更新92）
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
  const d0 = await api('mp_routes_list', { p_as: S.as }); if (!d0) return;
  // 支線（DB の更新70）：本線のすぐ下に、字下げして出す
  const byId = new Map(d0.map(r => [r.id, r])), kids = new Map(), d = [], seen = new Set();
  for (const r of d0) if (r.parent && byId.has(r.parent)) { if (!kids.has(r.parent)) kids.set(r.parent, []); kids.get(r.parent).push(r); }
  const add = (r, lv) => { if (seen.has(r.id)) return; seen.add(r.id); d.push(Object.assign({ lv }, r)); for (const c of kids.get(r.id) || []) add(c, lv + 1); };
  for (const r of d0) if (!(r.parent && byId.has(r.parent))) add(r, 0);
  for (const r of d0) add(r, 0);
  m.set('系統とダイヤ', `<div class="mp-list">${d.map(r => `<button class="mp-item" style="text-align:left${r.lv ? `;margin-left:${Math.min(3, r.lv) * 18}px` : ''}" data-r="${r.id}">
      ${r.lv ? '<small class="muted">└ 支線</small> ' : ''}<b style="color:${esc(r.color)}">■</b> <b>${esc(r.name)}</b> <small><span>${r.kind === 'air' ? `空路・${r.km}km・便${r.trains}本` : r.kind === 'ship' ? `航路・${r.km}km・便${r.trains}本` : `${r.kind === 'rail' ? '鉄道' : 'バス'}・${r.km}km・列車${r.trains}本`}</span>${r.warn ? `<span class="mp-warn">・注意 ${r.warn}本</span>` : ''}${r.ok ? '' : '<span class="mp-warn">・走れません</span>'}${(r.thru || []).length ? `<span>・乗り入れ：${r.thru.map(esc).join('・')}</span>` : ''}</small><br>
      <small>${esc((r.stops || []).join(' → '))}</small>${r.last && r.last.revenue != null ? `<br><small><span>さいきんの1時間：${fmt(r.last.served || 0)}人・${X(r.last.revenue || 0)}・${r.last.tph || 0}本</span>${r.last.load != null ? `<span>・混み具合${r.last.load}%</span>` : ''}</small>` : ''}</button>`).join('')
      || '<p class="muted small">まだありません</p>'}</div>
    <div class="mp-row"><button class="btn main" data-new="rail">＋ 鉄道の系統</button><button class="btn main" data-new="bus">＋ バスの系統</button><button class="btn main" data-new="ship">＋ 航路（フェリー）</button><button class="btn main" data-new="air">＋ 空路（飛行機）</button></div>
    <p class="muted small"><span>系統は、止まる駅（バス停）を順にえらんでつくります。下りはその順、上りは逆の順に走ります。</span><span>航路は、港（フェリーターミナル）を順にえらぶと、海の上の道を自動でさがします。</span><span>空路は、空港を順にえらんでつくります（まっすぐ飛びます）</span></p>`, b => {
    b.querySelectorAll('[data-r]').forEach(x => x.onclick = () => { m.close(); openDia(Number(x.dataset.r)); });
    b.querySelectorAll('[data-new]').forEach(x => x.onclick = () => { m.close(); routeBuild(x.dataset.new, null); });
  });
}
// 系統をつくる・直す：地図で駅を順にタップ
//   （2026-11-02）途中に入れる：駅の「＋」をおすと、そのあとに入る（ins：入れる場所。null は さいご）
//   opt（支線・DB の更新70）：{ stops: はじめの駅 [{id, name, x, y}], name, color, parent: 本線の系統, pname }。つくったら本線の支線にする
function routeBuild(kind, edit, opt) {
  if (kind === 'ship') return shipRouteBuild(edit);   // 航路（t54o）
  if (kind === 'air') return airRouteBuild(edit);     // 空路（t54p）
  setTool('look');
  const st = { kind, stops: edit ? edit.stops.map(s => ({ id: s.id, n: s.name })) : opt && opt.stops ? opt.stops.map(s => ({ id: s.id, n: s.name, x: s.x, y: s.y })) : [],
               name: edit ? edit.name : opt && opt.name ? opt.name : '', color: edit ? edit.color : opt && opt.color ? opt.color : (kind === 'rail' ? '#d23' : '#1d7fd8'),
               timing: new Set(edit ? edit.timing : opt && opt.stops ? opt.stops.slice(0, 1).map(s => s.id) : []), dwell: edit ? edit.dwell : (kind === 'rail' ? 30 : 20), ins: null };
  const insHint = () => hint(st.ins != null ? T(`${st.ins}番目の${kind === 'rail' ? '駅' : 'バス停'}のあとに入れます。${kind === 'rail' ? '駅' : 'バス停'}をタップしてください`)
    : kind === 'rail' ? '止まる駅を、順にタップしてください（自分の駅と、乗り入れの許可がある駅）' : '止まるバス停を、順にタップしてください');
  insHint();
  if (kind === 'rail') loadThru();
  S.tapHook = (x, y) => {
    const h = nearSta(x, y, 18, s => s.k === kind); if (!h || h.s.k !== kind) return toast(kind === 'rail' ? '駅をタップしてください' : 'バス停をタップしてください');
    if (kind === 'rail' && h.s.o !== myKey() && !thruHosts().has(h.s.o)) return toast('自分（この名義）の駅と、乗り入れの許可がある駅だけです（ほかの人・会社の駅は、タップ →「乗り入れを申請」）');
    if (kind === 'bus' && !h.s.mine && h.s.ln == null && !(edit && edit.stops.some(x => x.id === h.s.id))) return toast('このバス停は、持ち主が貸し出していません');
    const it = { id: h.s.id, n: h.s.n, x: h.s.fx, y: h.s.fy, ln: h.s.mine ? null : h.s.ln, o: h.s.o };
    if (st.ins != null) {   // 途中に入れる（2026-11-02）
      const i = Math.max(0, Math.min(st.ins, st.stops.length));
      if ((st.stops[i - 1] && st.stops[i - 1].id === h.s.id) || (st.stops[i] && st.stops[i].id === h.s.id)) return toast('となりと同じ駅です');
      if (st.stops.some(x => x.id === h.s.id)) return toast('同じ駅を2回入れられるのは、環状線にするとき（さいごに、はじめの駅にもどる）だけです');
      st.stops.splice(i, 0, it); st.ins = i + 1; insHint(); draw(); return;
    }
    if (st.stops.length && st.stops[st.stops.length - 1].id === h.s.id) return;
    // 環状線（2026-10-29）：はじめの駅をもう一度えらぶと環状線。同じ駅を2回入れられるのは、このときだけ
    if (st.stops.length >= 3 && st.stops[0].id === st.stops[st.stops.length - 1].id) return toast('環状線は、はじめの駅にもどったところでおわりです（駅を足すときは、とちゅうの駅の「＋」から）');
    if (st.stops.some(x => x.id === h.s.id) && !(st.stops.length >= 2 && h.s.id === st.stops[0].id)) return toast('同じ駅を2回入れられるのは、環状線にするとき（さいごに、はじめの駅にもどる）だけです');
    st.stops.push(it); if (st.stops.length === 1 || st.stops.length === 2) st.timing.add(h.s.id); draw();
  };
  S.drawTool = (g, z) => {
    g.strokeStyle = st.color; g.lineWidth = 3; g.setLineDash([8, 6]); g.beginPath();
    let k = 0; for (const s of st.stops) { const it = S.vis && S.vis.stas.get(s.id); const x = it ? it.fx : s.x, y = it ? it.fy : s.y; if (x == null) continue; if (k++) g.lineTo(sx(x), sy(y)); else g.moveTo(sx(x), sy(y)); } g.stroke(); g.setLineDash([]);
  };
  S.toolEnd = () => { S.tapHook = null; };
  const draw = () => {
    const insRow = i => st.ins === i ? `<div class="mp-item" style="display:flex;align-items:center;gap:6px;border:2px dashed ${esc(st.color)}"><b>▼</b> <span>ここに入れます（${kind === 'rail' ? '駅' : 'バス停'}をタップ）</span><button class="btn" style="margin-left:auto;white-space:nowrap" data-insx>やめる</button></div>` : '';
    sheet(`<h4>${edit ? '系統を直す' : opt && opt.parent ? '支線をつくる' : kind === 'rail' ? '鉄道の系統をつくる' : 'バスの系統をつくる'}</h4>
      ${opt && opt.parent ? `<p class="small" style="margin:0 0 6px"><span>本線：</span><b translate="no">${esc(opt.pname || '')}</b>。<span>${opt.stops && opt.stops.length > 1 ? '本線から直通できるように、本線の駅を入れてあります（いらない駅は × で）。' : '分かれる駅を入れてあります。'}つづけて、支線の${kind === 'rail' ? '駅' : 'バス停'}を順にタップしてください</span></p>` : ''}
      <div class="mp-row"><input class="mp-inp" style="flex:1 1 150px" data-nm placeholder="系統の名前（例：瑠璃本線）" value="${esc(st.name)}"><input type="color" data-col value="${esc(st.color)}" style="width:44px;height:36px;border:0;background:none"></div>
      ${st.stops.length >= 2 && st.ins !== 0 ? '<div class="mp-row" style="margin:0"><button class="btn" data-ins="0">＋ いちばん前に入れる</button></div>' : ''}
      <div class="mp-list">${insRow(0)}${st.stops.map((s, i) => `<div class="mp-item" style="display:flex;align-items:center;gap:6px"><b>${i + 1}.</b> ${esc(s.n)}${kind === 'bus' && s.ln != null ? ` <small class="muted">（借りる・1日 ${X(s.ln)}）</small>` : ''}${kind === 'rail' && s.o && s.o !== myKey() ? ' <small class="muted">（乗り入れ）</small>' : ''}
          <label class="small" style="margin-left:auto"><input type="checkbox" data-tm="${s.id}" ${st.timing.has(s.id) ? 'checked' : ''}> 採時駅</label>${i < st.stops.length - 1 ? `<button class="btn" data-ins="${i + 1}" title="${T('このあとに入れる')}">＋</button>` : ''}<button class="btn" data-rm="${i}">×</button></div>${insRow(i + 1)}`).join('') || '<p class="muted small">まだ駅がありません</p>'}</div>
      ${st.stops.length >= 2 ? `<p class="muted small" style="margin:2px 0 0">${T('「＋」：そのあとに駅を入れる（とちゅうの駅をふやす）')}${edit ? T('。とちゅうに足した駅には、いまの列車も止まります（通過させるときは「停車駅のパターン」）') : ''}</p>` : ''}
      <div class="mp-row">停車時間 <input class="mp-inp mp-num" type="number" min="10" max="300" value="${st.dwell}" data-dw> 秒</div>
      <div class="mp-row"><button class="btn" data-cancel>キャンセル</button><button class="btn main" data-ok ${st.stops.length >= 2 ? '' : 'disabled'}>${edit ? 'この順に直す' : '系統をつくる'}（${esc(asName())}）</button></div>
      ${st.stops.length >= 3 && st.stops[0].id === st.stops[st.stops.length - 1].id ? '<p class="small"><b>環状線</b>：はじめの駅にもどります。下りはこの順に一周、上りは逆まわりです</p>' : st.stops.length >= 2 ? '<p class="muted small">さいごに、はじめの駅をもう一度えらぶと、環状線になります</p>' : ''}
      <p class="muted small">採時駅：時刻表に時刻を決めて出す駅（はじめ・終わりなど）。ほかの駅は、走る時間から自動で決まります</p>`, s => {
      s.querySelector('[data-nm]').onchange = e => { st.name = e.target.value; };
      s.querySelector('[data-col]').oninput = e => { st.color = e.target.value; S.dirty = true; };
      s.querySelector('[data-dw]').onchange = e => { st.dwell = Number(e.target.value) || 30; };
      s.querySelectorAll('[data-tm]').forEach(c => c.onchange = () => { const id = Number(c.dataset.tm); if (c.checked) st.timing.add(id); else st.timing.delete(id); });
      s.querySelectorAll('[data-rm]').forEach(c => c.onclick = () => { const i = Number(c.dataset.rm); st.stops.splice(i, 1); if (st.ins != null && i < st.ins) st.ins--; if (st.ins != null && st.ins > st.stops.length) st.ins = null; insHint(); draw(); S.dirty = true; });
      s.querySelectorAll('[data-ins]').forEach(c => c.onclick = () => { st.ins = Number(c.dataset.ins); insHint(); draw(); });
      { const x = s.querySelector('[data-insx]'); if (x) x.onclick = () => { st.ins = null; insHint(); draw(); }; }
      s.querySelector('[data-cancel]').onclick = () => setTool('look');
      s.querySelector('[data-ok]').onclick = async () => {
        st.name = s.querySelector('[data-nm]').value.trim(); if (!st.name) return toast('系統の名前をつけてください');
        let paths = null;
        if (kind === 'bus') { paths = await busPaths(st.stops.map(x => x.id)); if (!paths) return; }
        const r = await api('mp_route_save', { p_id: edit ? edit.id : null, p_kind: kind, p_name: st.name, p_color: st.color, p_stops: st.stops.map(x => x.id),
          p_timing: [...new Set(st.stops.map(x => x.id).filter(id => st.timing.has(id)))], p_dwell: st.dwell, p_paths: paths, p_as: S.as });
        if (r && !edit && opt && opt.parent) {   // 支線（DB の更新70）：本線につなぐ
          const b = await api('mp_route_branch', { p_route: r.id, p_parent: opt.parent, p_as: S.as });
          toast(b ? T('支線をつくりました。列車を入れましょう') : T('系統はつくりましたが、支線にできませんでした'));
          setTool('look'); openDia(r.id); return;
        }
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
// 種別の色（DB の更新104：ダイヤグラム・時刻表・運用で 種別ごとに見分ける）。決まった種別は KIND_COL、ほかは 名義の種別の順に パレットから（名義の一覧がないときは 名前から）
const KIND_PAL = ['#1f6fd1', '#1a9e5a', '#0e9fb0', '#8a5a2b', '#b8860b', '#5b6abf', '#d1477a', '#4f7d1f', '#7a4fb8', '#c85a12'];
function kindCol(D, k) {
  if (KIND_COL[k]) return KIND_COL[k];
  const ks = ((D && D.kinds) || []).map(x => x.name).filter(x => !KIND_COL[x]);
  let i = ks.indexOf(k);
  if (i < 0) { i = 0; for (const c of String(k)) i = (i * 31 + c.charCodeAt(0)) >>> 0; }
  return KIND_PAL[i % KIND_PAL.length];
}
// 電化方式で しぼりこむ（DB の更新104）：d 直流・a 交流・x 交直流・n 非電化（気動車・客車など）・'' 編成なし
const PW_L = { d: '直流', a: '交流', x: '交直流', n: '非電化', '': '編成なし' }, PW_O = ['d', 'a', 'x', 'n', ''];
const pwCls = (el, ps) => !el ? 'n' : (ps & 1) && (ps & 6) ? 'x' : (ps & 6) ? 'a' : 'd';
const kindSw = c => `<span style="display:inline-block;width:12px;height:4px;border-radius:2px;background:${c};vertical-align:middle;margin-right:4px"></span>`;
const mdL = d => { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? T(`${Number(m[1])}月${Number(m[2])}日`) : ''; };   // 臨時列車の日付（10月25日）
const dayAdd = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const kindL = k => k === '普通' ? '各停' : k;   // 種別の見せ方（データは「普通」のまま）
async function openDia(rid) {
  const m = modal(['系統', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  let D = null, tab = 'dia';
  const lf = { kinds: new Set(), sers: new Set(), dirs: new Set(), pws: new Set(), secs: new Set(), sort: 'dep', err: false, sel: null, day: '' };   // pws：電化方式・secs：走る区間（DB の更新104）   // 列車一覧の絞り込み（空はぜんぶ）・並べ替え・エラーだけ・えらんで消す（sel：えらんだ列車）・日（'' ぜんぶ・'*' 毎日のダイヤ・日付。DB の更新100）
  const load = async () => { D = await api('mp_dia', { p_route: rid }); if (!D) return m.close(); if (D.gov && D.mine && S.as !== 'gov') { D.mine = false; D.govLock = true; }   // 国の系統は、名義「国」のときだけ編集（DB の更新101）
    S.routeHi = { legs: D.legs, color: D.color, kind: D.kind }; S.dirty = true; draw(); };
  m.onclose = () => { S.routeHi = null; S.dirty = true; };
  const draw = () => {
    m.set(D.name, `<p class="small" style="margin:0"><b style="color:${esc(D.color)}">■</b> <span>${KIND_L[D.kind] || D.kind}</span>・<span>${esc(D.owner)}</span>・<span>${D.km[D.km.length - 1]}km・停車 ${D.dwell}秒</span>
        ${D.ok ? '' : `<br><span class="mp-warn"><span>走れません：</span> <span>${esc(D.why || '')}</span></span>`}${D.govLock ? '<br><span class="muted">国の系統です。名義を「国（役所）」にすると、列車を編集できます</span>' : ''}${D.last && D.last.revenue != null ? (D.last.load != null && D.last.speed != null ? `<br>さいきんの1時間：${fmt(D.last.served || 0)}人・${X(D.last.revenue || 0)}・${D.last.tph}本・混み具合${D.last.load}%・平均${D.last.speed}km/h${D.last.fee || D.last.meal || D.last.bag || D.last.kb ? `<br><small class="muted">うち ${[D.last.fee ? T(`料金 ${X(D.last.fee)}`) : '', D.last.meal ? T(`食堂 ${X(D.last.meal)}`) : '', D.last.bag ? T(`荷物と郵便 ${X(D.last.bag)}`) : '', D.last.kb ? T(`競馬場のお客 ${fmt(D.last.kb)}人`) : ''].filter(Boolean).join('・')}</small>` : ''}`
          : `<br><span>さいきんの1時間：${fmt(D.last.served || 0)}人・${X(D.last.revenue || 0)}・${D.last.tph || 0}本</span>`) : ''}${D.last && (D.last.cancel || D.last.shop) ? `<span class="mp-warn">${D.last.cancel ? `・<span>運休${D.last.cancel}本</span>` : ''}${D.last.shop ? `・<span>工事中で運休${D.last.shop}本</span>` : ''}</span>` : ''}</p>
      ${D.parent ? `<p class="small" style="margin:4px 0 0">🔀 <span>支線</span>：<span>本線は</span> <a href="#" data-gor="${D.parent.id}" translate="no">${esc(D.parent.name)}</a>${(D.parent.jct || []).length ? `（<span>分かれる駅</span>：<span translate="no">${D.parent.jct.map(esc).join('・')}</span>）` : ''}</p>` : ''}
      ${(D.branches || []).length ? `<p class="small" style="margin:4px 0 0">🔀 <span>支線</span>：${D.branches.map(x => `<a href="#" data-gor="${x.id}" translate="no">${esc(x.name)}</a>${(x.jct || []).length ? `（<span translate="no">${x.jct.map(esc).join('・')}</span>）` : ''}`).join('・')}</p>` : ''}
      <div class="tabs-s" style="margin-top:8px">${[['dia', 'ダイヤグラム'], ['tt1', '時刻表（下り）'], ['tt2', '時刻表（上り）'], ['list', '列車'], ...(D.ord && D.mine ? [['ord', '運転整理']] : [])].map(t => `<button data-tab="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>
      <div data-flt style="margin-top:6px"></div><div data-pane style="margin-top:8px"></div>
      ${D.mine ? `<div class="mp-row"><button class="btn main" data-add>${D.kind === 'ship' || D.kind === 'air' ? '＋ 便' : '＋ 列車'}</button><button class="btn" data-bulk>＋ まとめて</button>${'hpat' in D ? '<button class="btn" data-hpat>⏱ 1時間の型</button>' : ''}${D.ord ? '<button class="btn" data-ordb>✂ 運転整理</button>' : ''}<button class="btn" data-auto>運用を自動で組む</button>${'hpat' in D && D.trains.some(t => t.onum) ? '<button class="btn" data-orn>運用番号を種別ごとに</button>' : ''}
        <button class="btn" data-edit>${D.kind === 'air' ? '空港の順を直す' : D.kind === 'ship' ? '港の順・航路を直す' : '駅の順を直す（途中に入れる）'}</button>${'branches' in D && (D.kind === 'rail' || D.kind === 'bus') ? '<button class="btn" data-br>＋ 支線をつくる</button>' : ''}${D.parent ? '<button class="btn" data-brx>支線をやめる</button>' : ''}<button class="btn" data-ai>🤖 AIで編集</button><button class="btn" data-kp>種別と優先番号</button><button class="btn" data-pat>停車駅のパターン</button><button class="btn" data-fix>重なりを直す${(() => { const n = D.trains.filter(t => /とかさなります/.test(t.warn || '')).length; return n ? `<span>（${n}本）</span>` : ''; })()}</button>${D.kind === 'rail' ? `<button class="btn" data-xw>${D.xwait ? 'ほかの系統と待避・続行：オン' : 'ほかの系統と待避・続行：オフ'}</button>` : ''}<button class="btn" data-del>系統を消す</button></div>
        <div class="mp-row"><button class="btn" style="flex:none" data-undo ${D.undo ? '' : 'disabled'}>↶ 取り消す</button>${D.undo ? `<span class="small muted"><span>もどす：</span><span>${esc(D.undo.what)}</span><span>（${D.undo.n}回もどせます）</span></span>` : '<span class="small muted">もどせる操作はありません</span>'}</div>` : ''}`, b => {
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { tab = x.dataset.tab; draw(); });
      { const un = b.querySelector('[data-undo]'); if (un) un.onclick = async () => {
        if (!D.undo || !confirm(T('この操作を取り消して、その前のダイヤにもどしますか？') + '\n' + T(D.undo.what))) return;
        const r = await api('mp_dia_undo', { p_route: rid }); if (r) { toast(T('取り消しました') + SEP() + '（' + T(r.what) + '）'); load(); }
      }; }
      const pane = b.querySelector('[data-pane]'), flt = b.querySelector('[data-flt]');
      // 形式（編成の系列・両数）・種別・向きで絞りこむ（t62：ダイヤグラム・時刻表でも）。一覧は、発車時刻・列車番号・種別・形式で並べかえる
      const serOf = t => t.fser ? t.fser + '|' + t.fn : '';   // 形式（系列）と両数
      // 電化方式（編成の。DB の更新104）と 走る区間（どこからどこまで：始発駅 → 終着駅）
      const hasPw = D.trains.some(t => 'fpw' in t), pwOf = t => t.fpw == null ? '' : pwCls(t.fpw > 0, t.fpw);
      const secOf = t => { const sc = t.sched || []; return sc.length > 1 ? sc[0][0] + '>' + sc[sc.length - 1][0] : ''; };
      const stN = id => (D.stops.find(x => String(x.id) === String(id)) || {}).name || '';
      const secL = k => { if (!k) return T('時刻なし'); const [a, z] = k.split('>'); return stN(a) + ' → ' + stN(z); };
      const serH = k => { if (!k) return '<span>編成なし</span>'; const [a, n] = k.split('|'); return `<span>${esc(a)}</span>${D.kind === 'ship' || D.kind === 'air' ? '' : `・<span>${D.kind === 'bus' ? `${n}台` : `${n}両`}</span>`}`; };
      const ko = k => { const x = (D.kinds || []).find(y => y.name === k); return x ? x.prio * 100 + (KINDS.indexOf(k) + 1) : 999; };   // 優先番号の順
      const kinds = [...new Set(D.trains.map(t => t.kind))].sort((a, b) => ko(a) - ko(b) || a.localeCompare(b, 'ja'));
      const sers = [...new Set(D.trains.map(serOf))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'ja', { numeric: true }));
      for (const k of [...lf.kinds]) if (!kinds.includes(k)) lf.kinds.delete(k);
      for (const k of [...lf.sers]) if (!sers.includes(k)) lf.sers.delete(k);
      const pws = hasPw ? PW_O.filter(k => D.trains.some(t => pwOf(t) === k)) : [];
      const secCnt = new Map(); for (const t of D.trains) { const k = secOf(t); secCnt.set(k, (secCnt.get(k) || 0) + 1); }
      const secs = [...secCnt.keys()].sort((a, b) => secCnt.get(b) - secCnt.get(a) || secL(a).localeCompare(secL(b), 'ja'));
      for (const k of [...lf.pws]) if (!pws.includes(k)) lf.pws.delete(k);
      for (const k of [...lf.secs]) if (!secs.includes(k)) lf.secs.delete(k);
      const pwSec = t => (!lf.pws.size || lf.pws.has(pwOf(t))) && (!lf.secs.size || lf.secs.has(secOf(t)));
      const isErr = t => !!(t.bad || t.warn || !t.fname);   // エラーの列車：走れない・注意がある・編成がない
      // 日（DB の更新100）：毎日のダイヤ（臨時・運転整理の列車はのぞく）か、その日に走る列車（運転整理で その日は走らない毎日の列車はのぞく）
      const dayOk = t => !lf.day ? true : lf.day === '*' ? !t.day : t.day ? t.day === lf.day : !(t.ordd || []).some(c => c[0] === lf.day);
      const pass = t => (!lf.kinds.size || lf.kinds.has(t.kind)) && (!lf.sers.size || lf.sers.has(serOf(t))) && (!lf.dirs.size || lf.dirs.has(t.dir)) && dayOk(t) && pwSec(t);
      const passL = t => pass(t) && (!lf.err || isErr(t));   // 一覧は「エラーだけ」でもしぼる
      if (lf.sel) for (const id of [...lf.sel]) if (!D.trains.some(t => t.id === id)) lf.sel.delete(id);
      const byNum = (a, b) => String(a.num).localeCompare(String(b.num), 'ja', { numeric: true });
      const cmp = { dep: (a, b) => a.dep - b.dep || byNum(a, b), num: (a, b) => byNum(a, b) || a.dep - b.dep, kind: (a, b) => ko(a.kind) - ko(b.kind) || a.dep - b.dep,
                    ser: (a, b) => (serOf(a) === '') - (serOf(b) === '') || serOf(a).localeCompare(serOf(b), 'ja', { numeric: true }) || a.dep - b.dep }[lf.sort];
      const L = D.trains.filter(passL).sort(cmp), nErr = D.trains.filter(isErr).length;
      const chip = (g, v, label, on) => `<button data-${g}="${esc(String(v))}" class="${on ? 'on' : ''}">${label}</button>`;
      const row = (title, g, all, items) => `<div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">${title}</span><span class="mp-seg" style="flex-wrap:wrap">${chip(g, '*', 'すべて', !all.size)}${items.join('')}</span></div>`;
      const D2 = Object.assign({}, D, { trains: D.trains.filter(tab === 'tt1' || tab === 'tt2' ? (t => (!lf.kinds.size || lf.kinds.has(t.kind)) && (!lf.sers.size || lf.sers.has(serOf(t))) && dayOk(t) && pwSec(t)) : pass) });   // 時刻表は向きのタブなので、向きでは しぼらない
      const hasDay = D.trains.some(t => t.day || (t.ordd || []).length);
      flt.innerHTML = D.trains.length && tab !== 'ord' ? `${row('種別', 'fk', lf.kinds, kinds.map(k => chip('fk', k, `${kindSw(kindCol(D, k))}<span>${esc(kindL(k))}</span><small>（${D.trains.filter(t => t.kind === k).length}）</small>`, lf.kinds.has(k))))}
        ${sers.length > 1 ? row('形式', 'fs', lf.sers, sers.map(k => chip('fs', k, serH(k), lf.sers.has(k)))) : ''}
        ${pws.length > 1 ? row('電化', 'fp', lf.pws, pws.map(k => chip('fp', k, `<span>${PW_L[k]}</span><small>（${D.trains.filter(t => pwOf(t) === k).length}）</small>`, lf.pws.has(k)))) : ''}
        ${secs.length > 1 ? (secs.length <= 8 ? row('区間', 'fz', lf.secs, secs.map(k => chip('fz', k, `<span translate="no">${esc(secL(k))}</span><small>（${secCnt.get(k)}）</small>`, lf.secs.has(k))))
          : `<div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">区間</span><select class="mp-inp" style="flex:1 1 180px" data-fzs><option value="">${esc(T('すべて'))}（${D.trains.length}）</option>${secs.map(k => `<option value="${esc(k)}" ${lf.secs.size === 1 && lf.secs.has(k) ? 'selected' : ''}>${esc(secL(k))}（${secCnt.get(k)}）</option>`).join('')}</select></div>`) : ''}
        ${tab === 'dia' ? row('向き', 'fd', lf.dirs, [chip('fd', 1, '下り', lf.dirs.has(1)), chip('fd', -1, '上り', lf.dirs.has(-1))]) : ''}
        ${hasDay ? `<div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">日付</span><span class="mp-seg" style="flex-wrap:wrap"><button data-fy="" class="${lf.day ? '' : 'on'}">すべて</button><button data-fy="*" class="${lf.day === '*' ? 'on' : ''}">毎日のダイヤ</button><button data-fy="d" class="${lf.day && lf.day !== '*' ? 'on' : ''}">日付で見る</button></span>
          ${lf.day && lf.day !== '*' ? `<input class="mp-inp" style="width:auto" type="date" data-fyd value="${esc(lf.day)}" min="${esc(D.today)}" max="${esc(dayAdd(D.today, 60))}">` : ''}</div>` : ''}` : '';
      { const tog = (set, v) => { if (v === '*') set.clear(); else if (set.has(v)) set.delete(v); else set.add(v); draw(); };
        flt.querySelectorAll('[data-fk]').forEach(x => x.onclick = () => tog(lf.kinds, x.dataset.fk));
        flt.querySelectorAll('[data-fs]').forEach(x => x.onclick = () => tog(lf.sers, x.dataset.fs));
        flt.querySelectorAll('[data-fp]').forEach(x => x.onclick = () => tog(lf.pws, x.dataset.fp));
        flt.querySelectorAll('[data-fz]').forEach(x => x.onclick = () => tog(lf.secs, x.dataset.fz));
        if (flt.querySelector('[data-fzs]')) flt.querySelector('[data-fzs]').onchange = e => { lf.secs.clear(); if (e.target.value) lf.secs.add(e.target.value); draw(); };
        flt.querySelectorAll('[data-fd]').forEach(x => x.onclick = () => tog(lf.dirs, x.dataset.fd === '*' ? '*' : Number(x.dataset.fd)));
        flt.querySelectorAll('[data-fy]').forEach(x => x.onclick = () => { const v = x.dataset.fy; lf.day = v === 'd' ? (lf.day && lf.day !== '*' ? lf.day : D.today) : v; draw(); });
        if (flt.querySelector('[data-fyd]')) flt.querySelector('[data-fyd]').onchange = e => { lf.day = e.target.value || D.today; draw(); }; }
      if (tab === 'dia') diaCanvas(pane, D2, t => trainEdit(D, t, load), lf.V || (lf.V = { t0: 5 * 3600, sec: 19 * 3600 }));
      if (tab === 'tt1' || tab === 'tt2') pane.innerHTML = ttTable(D2, tab === 'tt1' ? 1 : -1);
      if (tab === 'ord') ordPane(pane, D, load, t => trainEdit(D, t, load));   // 運転整理（DB の更新100）
      if (tab === 'list') {
        pane.innerHTML = `${row('向き', 'fd', lf.dirs, [chip('fd', 1, '下り', lf.dirs.has(1)), chip('fd', -1, '上り', lf.dirs.has(-1))])}
          ${row('エラー', 'fe', new Set(lf.err ? ['1'] : []), [chip('fe', 1, `<span>エラーだけ</span><span>（${nErr}本）</span>`, lf.err)])}
          ${D.mine ? (lf.sel ? `<div class="mp-row small" style="align-items:center"><b>${T(`えらんだ列車：${lf.sel.size}本`)}</b>
              <button class="btn" style="flex:none" data-sall="err" ${nErr ? '' : 'disabled'}>${T(`エラーの列車をぜんぶえらぶ（${nErr}本）`)}</button>
              <button class="btn" style="flex:none" data-sall="list" ${L.length ? '' : 'disabled'}>${T(`表示中をぜんぶえらぶ（${L.length}本）`)}</button>
              <button class="btn" style="flex:none" data-sall="none" ${lf.sel.size ? '' : 'disabled'}>えらびなおす</button>
              <button class="btn main" style="flex:none" data-sdel ${lf.sel.size ? '' : 'disabled'}>${T(`えらんだ ${lf.sel.size}本を消す`)}</button>
              <button class="btn" style="flex:none" data-soff>やめる</button></div>`
            : `<div class="mp-row small" style="align-items:center"><button class="btn" style="flex:none" data-son>☑ えらんで消す</button><span class="muted">エラーの出た列車などを、まとめてえらんで消せます</span></div>`) : ''}
          <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">並べかえ</span><select class="mp-inp" style="width:auto" data-sort>${[['dep', '発車時刻'], ['num', '列車番号'], ['kind', '種別'], ['ser', '形式']].map(o => `<option value="${o[0]}" ${lf.sort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
            <span class="muted">${L.length} / ${D.trains.length}本</span></div>
          <div class="mp-list">${L.map(t => `<button class="mp-item${lf.sel && lf.sel.has(t.id) ? ' on' : ''}" style="text-align:left" data-t="${t.id}">${lf.sel ? (lf.sel.has(t.id) ? '☑ ' : '☐ ') : ''}<b>${esc(t.num)}</b>${t.bad ? ' <small class="mp-warn">走れない</small>' : ''} <span>${esc(kindL(t.kind))}・${t.dir === 1 ? '下り' : '上り'}・${hms(t.dep)}発</span>${t.orig ? ` <small class="mp-tag"><span>運転整理</span> <span>${mdL(t.day)}</span></small> <small translate="no">✂ ${esc(ordJ(D, t))}</small>` : t.day ? ` <small class="mp-tag"><span>臨時</span> <span>${mdL(t.day)}</span></small>` : (t.ordd || []).some(c => c[0] >= D.today) ? ` <small class="muted">${esc(T(`✂ 運転整理 ${(t.ordd || []).filter(c => c[0] >= D.today).length}日`))}</small>` : ''}・${t.onum ? `<small class="muted"><span>運用</span> <span>${esc(t.onum)}</span></small> ` : ''}${t.fname ? `<span>${esc(t.fname)}</span>${t.fser ? `<small class="muted">（${serH(serOf(t))}）</small>` : ''}` : `<span class="mp-warn">${t.onum ? '運用に編成なし' : '編成なし'}</span>`}${cplL(t, D)}${taiL(t, D)}${t.warn ? `<br><small class="mp-warn">${warnH(t.warn)}</small>` : ''}${Array.isArray(t.wk) ? (Array.isArray(t.sub) && t.sub.length ? `<br><small>🔁 <span>${esc(runShopT(t))}は、予備編成</span> <b translate="no">${esc([...new Set(t.sub.map(x => x[2]))].join('・'))}</b> <span>が代走（${t.sub.length}本）</span></small>` : `<br><small class="mp-warn">🔧 <span>${esc(runShopT(t))}は運休</span></small>`) : ''}</button>`).join('')
            || `<p class="muted small">${D.trains.length ? '条件にあう列車はありません' : '列車はまだありません'}</p>`}</div>`;
        const tog = (set, v) => { if (v === '*') set.clear(); else if (set.has(v)) set.delete(v); else set.add(v); draw(); };
        pane.querySelectorAll('[data-fd]').forEach(x => x.onclick = () => tog(lf.dirs, x.dataset.fd === '*' ? '*' : Number(x.dataset.fd)));
        pane.querySelector('[data-sort]').onchange = e => { lf.sort = e.target.value; draw(); };
        pane.querySelectorAll('[data-t]').forEach(x => x.onclick = () => {
          const id = Number(x.dataset.t);
          if (lf.sel) { if (lf.sel.has(id)) lf.sel.delete(id); else lf.sel.add(id); draw(); return; }   // えらんで消す：タップでえらぶ
          trainEdit(D, D.trains.find(t => t.id === id), load); });
        pane.querySelectorAll('[data-fe]').forEach(x => x.onclick = () => { lf.err = x.dataset.fe === '*' ? false : !lf.err; draw(); });
        const pq = k => pane.querySelector(k);
        if (pq('[data-son]')) pq('[data-son]').onclick = () => { lf.sel = new Set(); draw(); };
        if (pq('[data-soff]')) pq('[data-soff]').onclick = () => { lf.sel = null; draw(); };
        pane.querySelectorAll('[data-sall]').forEach(x => x.onclick = () => {
          const k = x.dataset.sall; if (k === 'none') lf.sel.clear(); else (k === 'err' ? D.trains.filter(isErr) : L).forEach(t => lf.sel.add(t.id)); draw(); });
        if (pq('[data-sdel]')) pq('[data-sdel]').onclick = async () => {
          const ids = [...lf.sel], n = ids.length; if (!n) return;
          if (!await confirm2(T(`えらんだ ${n}本の${D.kind === 'ship' || D.kind === 'air' ? '便' : '列車'}を消しますか？`), { what: T(`${n}本`), q: '本当に消しますか？', ok: '消す', note: '消したあとでも、すぐ下の「↶ 取り消す」でもどせます。' })) return;
          if (await api('mp_train_del', { p_ids: ids, p_as: S.as }, T(`${n}本 消しました`))) { lf.sel = null; runListStale(); load(); }
        };
      }
      const q = k => b.querySelector(k);
      if (q('[data-add]')) q('[data-add]').onclick = () => trainEdit(D, null, load);
      if (q('[data-bulk]')) q('[data-bulk]').onclick = () => trainBulk(D, load);
      if (q('[data-hpat]')) q('[data-hpat]').onclick = () => hourDia(D, load);   // 1時間の型（DB の更新104）
      if (q('[data-orn]')) q('[data-orn]').onclick = () => opsRenum(D, load);   // 運用番号を種別ごとに（DB の更新104）
      if (q('[data-ordb]')) q('[data-ordb]').onclick = () => ordEdit(D, null, load);   // 運転整理（DB の更新100）
      if (q('[data-auto]')) q('[data-auto]').onclick = () => autoForm(D, load);
      if (q('[data-edit]')) q('[data-edit]').onclick = () => { m.close(); routeBuild(D.kind, D); };
      if (q('[data-kp]')) q('[data-kp]').onclick = () => kindsEdit(D, load);
      if (q('[data-pat]')) q('[data-pat]').onclick = () => patEdit(D, load);
      if (q('[data-fix]')) q('[data-fix]').onclick = () => diaFix(D, load);
      if (q('[data-ai]')) q('[data-ai]').onclick = () => aiDia(D, load);
      if (q('[data-br]')) q('[data-br]').onclick = () => { m.close(); branchMake(D); };
      if (q('[data-brx]')) q('[data-brx]').onclick = async () => {
        if (!await confirm2(T('この系統を支線でなくしますか？（本線とのつながりだけ外れます。列車はそのまま）'), { what: `「${D.name}」`, q: '本当に支線をやめますか？', ok: 'やめる', note: 'もう一度 支線にするには、支線をつくりなおします。' })) return;
        if (await api('mp_route_branch', { p_route: D.id, p_parent: null, p_as: S.as }, '支線ではなくなりました')) load();
      };
      b.querySelectorAll('[data-gor]').forEach(a => a.onclick = e => { e.preventDefault(); const id = Number(a.dataset.gor); m.close(); openDia(id); });
      if (q('[data-xw]')) q('[data-xw]').onclick = async () => {
        const on = !D.xwait;
        if (on && !confirm(T('ほかの系統（乗り入れてくる他社の列車もふくむ）の、優先番号の小さい列車にもゆずるようにしますか？（この系統の時刻が自動でずれます。相手の時刻は変わりません）'))) return;
        const r = await api('mp_route_xwait', { p_route: D.id, p_on: on, p_as: S.as }, on ? 'ほかの系統とも待避・続行するようにしました' : 'ほかの系統とは待避・続行しないようにしました');
        if (r) load();
      };
      if (q('[data-del]')) q('[data-del]').onclick = async () => { if (await confirm2(T('この系統と、列車をぜんぶ消しますか？'), { what: `「${D.name}」と、${D.kind === 'ship' || D.kind === 'air' ? '便' : '列車'} ${D.trains.length}本`, note: 'もとに戻せません。「↶ 取り消す」でも もどりません。' }) && await api('mp_route_del', { p_id: D.id, p_as: S.as }, '消しました')) m.close(); };
    });
  };
  load();
}
/* ---------- 支線をつくる（2026-11-02・DB の更新70）：本線（この系統）の分かれる駅をえらぶ → 直通のしかたをえらぶ → 系統づくり（はじめの駅を入れてある） ---------- */
function branchMake(D) {
  const n = D.stops.length, loop = n >= 3 && D.stops[0].id === D.stops[n - 1].id;
  const S2 = loop ? D.stops.slice(0, n - 1) : D.stops, w = D.kind === 'rail' ? '駅' : 'バス停';
  const m = modal(['支線をつくる', ''], null);
  const conv = a => a.map(x => ({ id: x.id, name: x.name, x: x.x / 100, y: x.y / 100 }));
  const go = stops => { m.close(); routeBuild(D.kind, null, { stops: conv(stops), name: D.name.replace(/線$/, '') + '支線', color: D.color, parent: D.id, pname: D.name }); };
  const pick = j => {
    const s = S2[j], first = S2[0], last = S2[S2.length - 1];
    m.set('支線をつくる', `<p class="small" style="margin-top:0"><b translate="no">${esc(s.name)}</b> <span>から分かれます。本線の${D.kind === 'rail' ? '列車' : 'バス'}が、そのまま支線へ走れる（直通）ようにしますか？</span></p>
      <div class="mp-list">
        <button class="mp-item" style="text-align:left" data-o="0"><b>支線だけ</b><br><small><span translate="no">${esc(s.name)}</span> <span>から支線の${w}へ（直通しない）</span></small></button>
        ${j > 0 ? `<button class="mp-item" style="text-align:left" data-o="1"><b><span translate="no">${esc(first.name)}</span> <span>から直通</span></b><br><small><span translate="no">${esc(first.name)} → … → ${esc(s.name)}</span> <span>→ 支線（本線の${w} ${j + 1}つを入れておきます）</span></small></button>` : ''}
        ${j < S2.length - 1 ? `<button class="mp-item" style="text-align:left" data-o="2"><b><span translate="no">${esc(last.name)}</span> <span>から直通</span></b><br><small><span translate="no">${esc(last.name)} → … → ${esc(s.name)}</span> <span>→ 支線（本線の${w} ${S2.length - j}つを入れておきます）</span></small></button>` : ''}
      </div>
      <p class="muted small"><span>支線は、本線とはべつの系統になり、系統の一覧では本線の下に出ます。</span><span>直通する${D.kind === 'rail' ? '列車' : 'バス'}は支線の系統の${D.kind === 'rail' ? '列車' : 'バス'}です。本線の${w}から途中始発・途中止まりにもできます。</span>${D.kind === 'rail' ? '<span>鉄道は、本線と支線の「ほかの系統と待避・続行」をオンにします（同じ線路で、優先番号の小さい列車に たがいにゆずる）。</span>' : ''}</p>
      <div class="mp-row"><button class="btn" data-back>もどる</button></div>`, b => {
      b.querySelectorAll('[data-o]').forEach(x => x.onclick = () => { const o = Number(x.dataset.o); go(o === 0 ? [s] : o === 1 ? S2.slice(0, j + 1) : S2.slice(j).reverse()); });
      b.querySelector('[data-back]').onclick = () => draw();
    });
  };
  const draw = () => m.set('支線をつくる', `<p class="small" style="margin-top:0">${T(`どの${w}から分かれますか？`)}</p>
    <div class="mp-list">${S2.map((s, j) => `<button class="mp-item" style="text-align:left" data-j="${j}"><b>${j + 1}.</b> <span translate="no">${esc(s.name)}</span></button>`).join('')}</div>`,
    b => b.querySelectorAll('[data-j]').forEach(x => x.onclick = () => pick(Number(x.dataset.j))));
  draw();
}

/* ---------- ダイヤを AI で直す（2026-11-02）：AI むけの説明つきで書き出す → AI（Claude など）に たのむ → 答えを貼って取りこむ（取りこみは DB の更新70）
   書き出し：説明・系統・駅（km・番線・待避・採時駅）・単線・種別と優先番号・停車駅のパターン・運用・標準の所要時間・列車（JSON Lines。_ ではじまる項目は ようす）
   取りこみ：1行に1本の JSON。id あり＝直す（書いた項目だけ）・id なし＝足す・del＝消す。駅・運用は名前で、時刻は "時:分" ---------- */
const AI_KEYS = new Set(['id', 'del', 'num', 'dir', 'kind', 'dep', 'from', 'to', 'pass', 'times', 'op', 'day']);
const aiT = s => { s = Math.round(s); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}${s % 60 ? ':' + String(s % 60).padStart(2, '0') : ''}`; };
const aiOff = s => `${Math.floor(Math.max(0, Math.round(s)) / 60)}:${String(Math.max(0, Math.round(s)) % 60).padStart(2, '0')}`;
const aiW = D => ({ unit: D.kind === 'ship' || D.kind === 'air' ? '便' : D.kind === 'bus' ? 'バス' : '列車', sta: D.kind === 'rail' ? '駅' : D.kind === 'bus' ? 'バス停' : D.kind === 'ship' ? '港' : '空港',
                    kindN: { rail: '鉄道', bus: 'バス', ship: '航路（フェリー）', air: '空路（飛行機）' }[D.kind] || D.kind });
// 駅の名前（この系統の中で同じ名前の駅がほかにあれば「名前#2」）
function aiNames(D) {
  const byId = new Map(), byName = new Map(), cnt = new Map();
  for (const s of D.stops) {
    if (byId.has(s.id)) continue;   // 環状線：さいごは はじめの駅
    const k = (cnt.get(s.name) || 0) + 1; cnt.set(s.name, k);
    const nm = k > 1 ? `${s.name}#${k}` : s.name;
    byId.set(s.id, nm); byName.set(nm, s.id);
  }
  return { byId, byName };
}
function aiExport(D, o) {
  const { unit, sta, kindN } = aiW(D), N = aiNames(D), nm = id => N.byId.get(id) || String(id);
  const n = D.stops.length, loop = n >= 3 && D.stops[0].id === D.stops[n - 1].id, rail = D.kind === 'rail';
  const dirs = o.dir ? [o.dir] : [1, -1];
  const L = D.trains.filter(t => dirs.includes(t.dir) && t.dep >= o.h0 * 3600 && t.dep < o.h1 * 3600)
    .sort((a, b) => b.dir - a.dir || a.dep - b.dep || String(a.num).localeCompare(String(b.num), 'ja', { numeric: true }));
  const jt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const kinds = (D.kinds || []).filter(k => k.std || k.add || D.trains.some(t => t.kind === k.name));
  const out = [], P = (...a) => out.push(...a);
  P(`# 風の芽経済組 ダイヤ編集データ：系統「${D.name}」`,
    `書き出し：${jt}（日本時間）・系統の番号 ${D.id}・${unit} ${L.length}本${L.length < D.trains.length ? `（この系統の${unit}は ぜんぶで ${D.trains.length}本。向き・時間でしぼって書き出しました）` : ''}`, '',
    '## AIへのお願い（はじめに読んでください）',
    `- これは、ブラウザのゲーム「風の芽経済組」で、ユーザーが運営している${kindN}の系統と、その${unit}のダイヤ（時刻）です。`,
    `- ユーザーが「どう直したいか」をたのみます（例：「朝7時台の快速を10分おきにして」「重なりをなくして」「終電を30分おそくして」）。たのまれたとおりに${unit}を足す・直す・消すをして、下の「こたえの書き方」のとおりに返してください。`,
    `- 各${sta}に着く・出る時刻は、ゲームが自動で計算します。あなたが決めるのは、おもに「始発${sta}を出る時刻（dep）」「種別（kind）」「止まる${sta}（pass）」「始発・終着の${sta}（from・to）」「運用（op）」です。`,
    `- 時刻は日本時間の "時:分" または "時:分:秒"（"06:30"・"06:30:15"）。0:00〜23:59:59 の中だけで、日をまたぐ${unit}は作れません。`,
    `- たのみがあいまいなときや、できないことがあるときは、こたえの前にユーザーに聞くか、理由を書いてください。`, '',
    '## こたえの書き方（いちばん大事）',
    `1. こたえの${unit}は、\`\`\`jsonl ではじまるコードブロックの中に、1行に1本ずつ JSON で書く（1行に1つの { … }）。`,
    `2. いまある${unit}を直す：その${unit}の "id" をそのまま書き、変える項目だけを書く。書かなかった項目は いまのまま。　例：{"id": 1234, "dep": "07:05"}`,
    `3. 新しい${unit}を足す："id" は書かない。"num"（番号）・"dir"（向き）・"dep"（始発を出る時刻）は かならず書く。　例：{"num": "711", "dir": "下り", "kind": "快速", "dep": "07:10"${(D.ops || []).length ? `, "op": "${esc0((D.ops[0] || {}).num)}"` : ''}}`,
    `4. ${unit}を消す：{"id": 1234, "del": true}`,
    `5. 変えない${unit}は書かなくてよい（ぜんぶ書いてもかまわない）。`,
    `6. 「_」ではじまる項目（_end・_warn・_bad）は、いまのようすを知らせるためのもの。こたえに書いても使いません。`,
    `7. 何をどう変えたかは、コードブロックの外に短く書いてください（ユーザーが読みます）。`, '',
    '## 項目',
    '| 項目 | 意味 | 例 |', '|---|---|---|',
    `| id | ${unit}のしるし（ゲームが決めた番号）。直す・消すときに使う。新しい${unit}には書かない | 1234 |`,
    `| num | ${unit}番号（12文字まで） | "701M" |`,
    `| dir | 向き。"下り"＝下の「${sta}」の表の上から下へ、"上り"＝下から上へ | "下り" |`,
    `| kind | 種別（下の「種別」から。新しい名前も使える。8文字まで） | "快速" |`,
    `| dep | 始発${sta}を出る時刻 | "06:30" |`,
    `| from | 始発${sta}（途中から走るときだけ。系統の端から走るなら書かない。直すとき null で端にもどる） | "${nm(D.stops[Math.min(1, n - 1)].id)}" |`,
    `| to | 終着${sta}（途中までのときだけ。同じく） | "${nm(D.stops[Math.max(0, n - 2)].id)}" |`,
    `| pass | 通過する${sta}（止まらない${sta}）の名前の一覧。[] は全部に止まる。新しい${unit}で書かないと、種別の「停車駅のパターン」どおり | ["${nm(D.stops[Math.min(1, n - 1)].id)}"] |`,
    `| times | 採時駅で、着 "a"・発 "d"・番線 "t" を決める（採時駅だけ。ふつうは書かない。ぜんぶ書きなおす） | {"${nm((D.timing || [])[0] || D.stops[0].id)}": {"d": "06:42"}} |`,
    `| op | 運用（この${unit}に入る編成）。下の「運用」の番号。null は運用なし＝走れない | "${esc0(((D.ops || [])[0] || {}).num || 'A01')}" |`,
    `| day | 臨時（その日だけ走る）の日付。毎日走るなら書かない（直すとき null で毎日に）。きょうから60日先まで | "${D.today || '2026-11-20'}" |`, '',
    '## ダイヤのきまり（ゲームの計算）',
    `- ${unit}は dep に始発${sta}を出て、${sta}と${sta}のあいだを、編成の性能と${rail ? '線路（距離・制限速度）' : '道（距離）'}で決まる時間で走る。下の「標準の所要時間」が目安。`,
    `- 止まる${sta}では、ふつう ${D.dwell}秒 止まる（採時駅は times で決められる）。`);
  if (rail) P(
    '- 同じ向きの前の列車に追いつくときは、ゲームが自動で待たせる（続行）。待避できる駅では、優先番号の小さい（えらい）種別に先をゆずる（待避）。そのぶん、あとの駅に着く時刻がおそくなる。',
    '- 同じ駅の同じ番線に、2本が同時にいる（30秒のよゆうをふくむ）と「重なり」になる（_warn に出る）。番線の少ない駅では、時刻をずらす。',
    '- 単線の区間では、反対向きの列車とすれちがえない（すれちがいは駅で。下の「単線の区間」）。');
  P(`- 1つの運用（編成）は、前の${unit}の終着${sta}に着いて2分以上たってから、その${sta}を出る次の${unit}に入れる。同じ運用の${unit}が時間で重なると、あとのほうが走れない（_bad）。`,
    `- 1つの系統の${unit}は900本まで。`);
  if (D.xwait) P('- 「ほかの系統と待避・続行」がオン：同じ駅を通るほかの系統の列車にも、優先番号に合わせてゆずる。');
  if (D.parent) P(`- この系統は「${D.parent.name}」の支線（分かれる${sta}：${(D.parent.jct || []).join('・')}）。本線と同じ${rail ? '線路' : '道'}を走る区間がある。`);
  if ((D.branches || []).length) P(`- この系統には支線がある（${D.branches.map(b => `${b.name}：${(b.jct || []).join('・')} で分かれる`).join('、')}）。支線の${unit}は、それぞれの系統で直す。`);
  P(`- よいダイヤのめやす：同じ種別は等間隔に・朝夕に多く夜は少なく・追い越しは待避できる${sta}で・運用の折り返しは5〜15分。`, '',
    '## 系統',
    `- 名前：${D.name}・種類：${kindN}・停車時間：${D.dwell}秒${loop ? `・環状線（下りは この順に一周して はじめの${sta}にもどる。上りは逆まわり）` : ''}${rail ? `・ほかの系統と待避・続行：${D.xwait ? 'オン' : 'オフ'}` : ''}`,
    `- いまの${unit}：${D.trains.length}本（下り ${D.trains.filter(t => t.dir === 1).length}本・上り ${D.trains.filter(t => t.dir === -1).length}本）。重なり ${D.trains.filter(t => /とかさなります/.test(t.warn || '')).length}本・走れない ${D.trains.filter(t => t.bad).length}本`, '',
    `## ${sta}（上から下りの順）`,
    rail ? `| 順 | ${sta} | km | 番線（下り/上り） | 待避できる | 採時駅 |` : `| 順 | ${sta} | km | 採時駅 |`, rail ? '|---|---|---|---|---|---|' : '|---|---|---|---|');
  D.stops.forEach((s, i) => {
    const T2 = s.trk || [], dn = T2.filter(x => x.d === 'down' || x.d === 'both'), up = T2.filter(x => x.d === 'up' || x.d === 'both');
    const cap = a => a.length >= 2 && a.some(x => (x.m || 'main') !== 'pass');
    const tm = (D.timing || []).includes(s.id) ? '○' : '';
    P(rail ? `| ${i + 1} | ${nm(s.id)} | ${D.km[i]} | ${dn.length}/${up.length} | ${[cap(dn) ? '下り' : '', cap(up) ? '上り' : ''].filter(Boolean).join('・') || '—'} | ${tm} |`
      : `| ${i + 1} | ${nm(s.id)} | ${D.km[i]} | ${tm} |`);
  });
  if (rail) {
    const sg = (D.legs || []).map((l, i) => l && l.s ? `${nm(D.stops[i].id)}〜${nm(D.stops[i + 1].id)}` : null).filter(Boolean);
    P('', '## 単線の区間', sg.length ? sg.map(x => `- ${x}`).join('\n') : '- なし（ぜんぶ複線）');
  }
  P('', '## 種別と優先番号（小さいほど優先。追い越すほう）', kinds.map(k => `- ${k.name}：${k.prio}`).join('\n') || '- 普通：5');
  const pats = Object.entries(D.pats || {}).filter(([, v]) => (v || []).length);
  P('', '## 停車駅のパターン（種別ごとに通過する駅。新しい列車で pass を書かないと、これになる）', pats.length ? pats.map(([k, v]) => `- ${k}：通過 ${v.map(nm).join('・')}`).join('\n') : '- なし（ぜんぶの駅に止まる）');
  P('', '## 運用（op に書けるもの。番号：編成）', (D.ops || []).length ? D.ops.map(x => `- ${x.num}：${x.fname ? `${x.fname}（${x.n}${D.kind === 'rail' ? '両' : '台'}）` : '編成なし（走れない）'}`).join('\n') : '- なし（「運用を自動で組む」で、あとから決められる）');
  // 標準の所要時間：向き・種別ごとに、いちばん長く走る列車（待避の少ないもの）の、始発を出てからの時間
  P('', `## 標準の所要時間（いまの${unit}から。始発を出てからの 分:秒。待避・続行で待つと、もっとかかる）`);
  let any = false;
  for (const d of [1, -1]) for (const k of [...new Set(D.trains.filter(t => t.dir === d).map(t => t.kind))]) {
    const c = D.trains.filter(t => t.dir === d && t.kind === k && (t.sched || []).length >= 2)
      .sort((a, b) => b.sched.length - a.sched.length || (a.tai || []).length - (b.tai || []).length || a.dep - b.dep)[0];
    if (!c) continue;
    any = true;
    const t0 = c.sched[0][2] != null ? c.sched[0][2] : c.sched[0][1];
    P(`- ${d === 1 ? '下り' : '上り'}・${k}（${c.num}）：` + c.sched.map((e, i) => i === 0 ? `${nm(e[0])} 発0:00` : e[2] == null ? `${nm(e[0])} 着${aiOff(e[1] - t0)}` : `${nm(e[0])} ${aiOff(e[1] - t0)}〜${aiOff(e[2] - t0)}`).join(' → '));
  }
  if (!any) P(`- まだ${unit}がありません（1${sta}あいだ、だいたい 1km 1分 + 停車 ${D.dwell}秒 を目安に）`);
  P('', `## いまの${unit}（直すときは id を そのまま）`, '```jsonl');
  for (const t of L) {
    const r = { id: t.id, num: t.num, dir: t.dir === 1 ? '下り' : '上り', kind: t.kind, dep: aiT(t.dep) };
    if (t.sa) r.from = nm(t.sa);
    if (t.sb) r.to = nm(t.sb);
    if ((t.skip || []).length) r.pass = t.skip.map(nm);
    const tt = Object.entries(t.tt || {}).filter(([k]) => (D.timing || []).includes(Number(k)));
    if (tt.length) r.times = Object.fromEntries(tt.map(([k, v]) => [nm(Number(k)), Object.fromEntries(Object.entries({ a: v.a != null ? aiT(v.a) : null, d: v.d != null ? aiT(v.d) : null, t: v.t != null ? v.t : null }).filter(([, x]) => x != null))]));
    if (t.onum) r.op = t.onum;
    if (t.day) r.day = t.day;
    const last = (t.sched || [])[(t.sched || []).length - 1];
    if (last) r._end = `${aiT(last[1] != null ? last[1] : last[2])} ${nm(last[0])}`;
    if (t.warn) r._warn = t.warn;
    if (t.bad) r._bad = true;
    P(JSON.stringify(r));
  }
  P('```', '');
  return out.join('\n');
}
const esc0 = s => String(s == null ? '' : s).replace(/"/g, '');
// AI の答え → 取りこむ行（駅・運用は id、時刻は秒）。まちがいは行番号つき
function aiParse(text, D) {
  const { unit, sta } = aiW(D), N = aiNames(D), errs = [], notes = [], rows = [];
  const opBy = new Map((D.ops || []).map(x => [String(x.num), x.id])), ids = new Set(D.trains.map(t => t.id));
  const tsec = v => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string') throw '時刻は "06:30" のように書いてください';
    const m2 = v.trim().match(/^(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?$/); if (!m2) throw `時刻「${v}」が読めません（"06:30" のように）`;
    const s = +m2[1] * 3600 + +m2[2] * 60 + +(m2[3] || 0);
    if (+m2[2] > 59 || +(m2[3] || 0) > 59 || s >= 86400) throw `時刻「${v}」は 0:00〜23:59:59 にしてください`;
    return s;
  };
  const sid = v => { if (v == null || v === '') return null; const id = N.byName.get(String(v).trim()); if (id == null) throw `「${v}」は この系統の${sta}にありません`; return id; };
  let items = [];
  const tx = String(text || '').trim();
  if (tx.startsWith('[')) { try { const a = JSON.parse(tx); if (Array.isArray(a)) items = a.map((x, i) => [i + 1, x]); } catch (e) {} }
  if (!items.length) tx.split(/\r?\n/).forEach((ln, i) => {
    const s = ln.trim().replace(/^[-*]\s+/, '').replace(/,\s*$/, '');
    if (!s.startsWith('{')) return;
    try { items.push([i + 1, JSON.parse(s)]); } catch (e) { errs.push({ line: i + 1, msg: 'JSON として読めません（1行に1つの { … }）' }); }
  });
  for (const [line, o] of items) {
    try {
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw '1行に1つの { … } で書いてください';
      const r = { line };
      for (const k of Object.keys(o)) if (!k.startsWith('_') && !AI_KEYS.has(k)) notes.push({ line, msg: `使わない項目「${k}」` });
      if (o.id != null) { const id = Number(o.id); if (!Number.isInteger(id) || !ids.has(id)) throw `id ${o.id} の${unit}は、この系統にありません（新しい${unit}なら id は書かない）`; r.id = id; }
      if (o.del === true) { if (r.id == null) throw `消す${unit}の id がありません`; r.del = true; rows.push(r); continue; }
      if ('num' in o) r.num = String(o.num == null ? '' : o.num).trim();
      if ('dir' in o) { const d = { '下り': 1, '上り': -1, 'down': 1, 'up': -1, '1': 1, '-1': -1 }[String(o.dir).trim()]; if (!d) throw '向き（dir）は "下り" か "上り" にしてください'; r.dir = d; }
      if ('kind' in o) r.kind = String(o.kind == null ? '' : o.kind).trim();
      if ('dep' in o) r.dep = tsec(o.dep);
      if ('from' in o) r.sa = sid(o.from);
      if ('to' in o) r.sb = sid(o.to);
      if ('pass' in o) { if (o.pass != null && !Array.isArray(o.pass)) throw `pass は${sta}の名前の一覧（["A", "B"]）にしてください`; r.skip = (o.pass || []).map(sid); }
      if ('times' in o) {
        if (o.times != null && (typeof o.times !== 'object' || Array.isArray(o.times))) throw 'times は {"駅": {"a": "06:40", "d": "06:41"}} の形にしてください';
        r.tt = {};
        for (const [k, v] of Object.entries(o.times || {})) {
          const id = sid(k), e = {};
          if (v && v.a != null) e.a = tsec(v.a);
          if (v && v.d != null) e.d = tsec(v.d);
          if (v && v.t != null) { const t = Number(v.t); if (!Number.isInteger(t) || t < 1) throw '番線（t）は 1 からの数にしてください'; e.t = t; }
          r.tt[id] = e;
        }
      }
      if ('op' in o) { if (o.op == null || o.op === '') r.op = null; else { const id = opBy.get(String(o.op).trim()); if (id == null) throw `運用「${o.op}」がありません（「運用」の一覧から）`; r.op = id; } }
      if ('day' in o) { if (o.day == null || o.day === '') r.day = null; else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.day))) throw '日付（day）は "2026-11-20" のように書いてください'; else r.day = String(o.day); }
      if (r.id == null) for (const [k, l] of [['num', '番号（num）'], ['dir', '向き（dir）'], ['dep', '始発の時刻（dep）']]) if (r[k] == null || r[k] === '') throw `新しい${unit}には ${l} がいります`;
      rows.push(r);
    } catch (e) { errs.push({ line, msg: typeof e === 'string' ? e : (e && e.message) || 'まちがいがあります' }); }
  }
  if (!items.length && !errs.length) errs.push({ line: 0, msg: `${unit}の行（{ … }）が見つかりません。AIの答えの jsonl のところを貼ってください` });
  return { rows, errs, notes };
}
function aiDia(D, reload) {
  const { unit } = aiW(D);
  const st = { dir: 0, h0: 0, h1: 24, out: null, text: '', mode: 'up', res: null, perr: null, err: null, notes: [], busy: false, sig: '' };
  const m = modal(['🤖 AIでダイヤを直す', ''], null, 'mp-wide');
  const sig = () => st.mode + '|' + st.text;
  const lineL = e => e.line ? T(`${e.line}行目`) + '：' : '';
  const resBox = () => {
    if (st.busy) return `<p class="muted small">${T('見つもり中…（列車の多い系統は少しかかります）')}</p>`;
    if (st.err) return `<p class="mp-warn small">${esc(st.err)}</p>`;
    if (st.perr) return `<p class="mp-warn small">${T('まちがいがあります。AIに直してもらうか、ここで直してから、もう一度見つもってください')}</p><ul class="small">${st.perr.slice(0, 50).map(e => `<li>${esc(lineL(e))}${esc(e.msg)}</li>`).join('')}</ul>`;
    const r = st.res; if (!r) return '';
    const nt = [...(st.notes || []), ...(r.notes || [])];
    if (!r.ok) return `<p class="mp-warn small">${T('まちがいがあります（何も変えていません）')}</p><ul class="small">${(r.errs || []).slice(0, 50).map(e => `<li>${esc(lineL(e))}${esc(e.msg)}</li>`).join('')}</ul>`;
    if (!r.add && !r.upd && !r.del) return `<p class="small">${T('変わるところはありません')}</p>`;
    return `<div class="mp-kv"><b>${T('見つもり')}</b><span><span>${T(`追加 ${r.add}本`)}</span>・<span>${T(`変更 ${r.upd}本`)}</span>・<span class="${r.del ? 'mp-warn' : ''}">${T(`削除 ${r.del}本`)}</span></span>
        <b>${T(`${unit}`)}</b><span>${r.before.n}本 → ${r.after.n}本</span>
        <b>${T('重なり')}</b><span class="${r.after.ov > r.before.ov ? 'mp-warn' : ''}">${r.before.ov}本 → ${r.after.ov}本</span>
        <b>${T('走れない')}</b><span class="${r.after.bad > r.before.bad ? 'mp-warn' : ''}">${r.before.bad}本 → ${r.after.bad}本</span></div>
      ${(r.probs || []).length ? `<p class="small" style="margin:6px 0 2px">${T('注意の出る列車（取りこむ列車の分。30本まで）')}</p><ul class="small">${r.probs.map(p => `<li><b translate="no">${esc(p.num)}</b>（${p.dir === 1 ? '下り' : '上り'} ${hms(p.dep)}）：<span class="mp-warn">${esc(p.warn || (p.bad ? '走れません' : ''))}</span></li>`).join('')}</ul>
        <p class="muted small">${T('運用が決まっていない列車は走れません。取りこんだあと「運用を自動で組む」で決められます')}</p>` : ''}
      ${nt.length ? `<details class="small"><summary>${T(`メモ（${nt.length}）`)}</summary><ul>${nt.slice(0, 50).map(e => `<li>${esc(lineL(e))}${esc(e.msg)}</li>`).join('')}</ul></details>` : ''}`;
  };
  const hoursSel = (k, from, to) => `<select class="mp-inp" style="width:auto" data-${k}>${Array.from({ length: to - from + 1 }, (_, i) => from + i).map(h => `<option value="${h}" ${st[k] === h ? 'selected' : ''}>${h}時</option>`).join('')}</select>`;
  const draw = () => m.set('🤖 AIでダイヤを直す', `<p class="small" style="margin-top:0"><b>1.</b> <span>書き出して、AI（Claude など）に貼る</span> → <b>2.</b> <span>「朝の快速を10分おきにして」のように たのむ</span> → <b>3.</b> <span>AIの答えを下に貼って取りこむ</span></p>
    <h4 style="margin:10px 0 4px">1. ${T('書き出す（AIにわたす）')}</h4>
    <div class="mp-row small" style="align-items:center"><span style="min-width:3em">${T('向き')}</span><span class="mp-seg">${[[0, '両方'], [1, '下り'], [-1, '上り']].map(([v, l]) => `<button data-dr="${v}" class="${st.dir === v ? 'on' : ''}">${T(l)}</button>`).join('')}</span></div>
    <div class="mp-row small" style="align-items:center"><span style="min-width:3em">${T('時間')}</span>${hoursSel('h0', 0, 23)}〜${hoursSel('h1', 1, 24)}<span class="muted">${T('（始発の時刻。列車が多いときは しぼると軽くなります）')}</span></div>
    <div class="mp-row"><button class="btn main" data-ex>${T('書き出す')}</button></div>
    ${st.out != null ? `<textarea class="mp-inp" rows="6" readonly data-out style="width:100%;font-size:12px;font-family:ui-monospace,Menlo,monospace">${esc(st.out)}</textarea>
      <div class="mp-row" style="align-items:center"><button class="btn" data-cp>${T('コピー')}</button><button class="btn" data-dl>${T('ファイルで保存')}</button><span class="muted small">${T(`${st.out.length.toLocaleString()}文字`)}</span></div>` : ''}
    <details class="small"><summary>${T('AIへのたのみ方の例')}</summary><ul>
      <li>${T('朝7時台の快速を10分おきにして（運用は A01〜A06 を使って）')}</li><li>${T('重なりをなくして（番線をかえるか、時刻を少しずらして）')}</li>
      <li>${T('各駅停車を15分おきの等間隔にして')}</li><li>${T('終電を30分おそくして、23時台に2本足して')}</li><li>${T('昼間（10〜16時）は本数を半分にして')}</li></ul>
      <p class="muted">${T('書き出した文字の中に、AI むけの説明（書き方・きまり）が入っています。そのまま全部わたしてください')}</p></details>
    <h4 style="margin:14px 0 4px">2. ${T('AIの答えを取りこむ')}</h4>
    <textarea class="mp-inp" rows="6" data-in placeholder="${T('AIの答え（jsonl のところ。ぜんぶ貼ってもOK）')}" style="width:100%;font-size:12px;font-family:ui-monospace,Menlo,monospace">${esc(st.text)}</textarea>
    <div class="mp-row small" style="align-items:center"><label class="btn" style="cursor:pointer">${T('ファイルから')}<input type="file" accept=".txt,.json,.jsonl,.md,text/plain" data-file style="display:none"></label></div>
    <div class="mp-row small" style="align-items:center"><span class="mp-seg"><button data-md="up" class="${st.mode === 'up' ? 'on' : ''}">${T(`書いた${unit}だけ直す`)}</button><button data-md="all" class="${st.mode === 'all' ? 'on' : ''}">${T('まるごと入れかえ')}</button></span></div>
    <p class="muted small">${st.mode === 'all' ? T(`書かなかった${unit}は消えます（AIが ぜんぶの${unit}を書いたときだけ使ってください）`) : T(`書かなかった${unit}は そのままです。消すときは {"id": …, "del": true}`)}</p>
    <div class="mp-row"><button class="btn" data-est>${T('見つもる')}</button><button class="btn main" data-imp ${st.res && st.res.ok && (st.res.add || st.res.upd || st.res.del) && st.sig === sig() && !st.busy ? '' : 'disabled'}>${T('取りこむ')}</button></div>
    <div data-res>${resBox()}</div>
    <p class="muted small">${T('取りこんだあとも、ダイヤの「↶ 取り消す」で もとにもどせます')}</p>`, b => {
    const q = k => b.querySelector(k);
    b.querySelectorAll('[data-dr]').forEach(x => x.onclick = () => { st.dir = Number(x.dataset.dr); draw(); });
    q('[data-h0]').onchange = e => { st.h0 = Number(e.target.value); if (st.h1 <= st.h0) st.h1 = st.h0 + 1; draw(); };
    q('[data-h1]').onchange = e => { st.h1 = Number(e.target.value); if (st.h1 <= st.h0) st.h0 = st.h1 - 1; draw(); };
    q('[data-ex]').onclick = () => { st.out = aiExport(D, { dir: st.dir, h0: st.h0, h1: st.h1 }); draw(); };
    const ta = q('[data-in]');
    ta.oninput = () => { st.text = ta.value; const imp = q('[data-imp]'); if (imp) imp.disabled = true; };
    if (q('[data-cp]')) q('[data-cp]').onclick = async () => {
      try { await navigator.clipboard.writeText(st.out); toast(T('コピーしました。AIに貼ってください')); }
      catch (e) { const o = q('[data-out]'); o.removeAttribute('readonly'); o.select(); try { document.execCommand('copy'); toast(T('コピーしました。AIに貼ってください')); } catch (e2) { toast(T('コピーできませんでした。文字をえらんでコピーしてください')); } o.setAttribute('readonly', ''); }
    };
    if (q('[data-dl]')) q('[data-dl]').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([st.out], { type: 'text/plain;charset=utf-8' }));
      a.download = `dia_${D.id}_${String(D.name).replace(/[\\/:*?"<>|\s]+/g, '_')}.txt`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    q('[data-file]').onchange = e => { const f = e.target.files && e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { st.text = String(rd.result || ''); st.res = null; st.perr = null; st.err = null; draw(); }; rd.readAsText(f); };
    b.querySelectorAll('[data-md]').forEach(x => x.onclick = () => { st.text = ta.value; st.mode = x.dataset.md; draw(); });
    q('[data-est]').onclick = async () => {
      st.text = ta.value; st.res = null; st.err = null; st.perr = null;
      const p = aiParse(st.text, D); st.notes = p.notes;
      if (p.errs.length) { st.perr = p.errs; draw(); return; }
      st.busy = true; draw();
      try { st.res = await call('mp_dia_import', { p_route: D.id, p_rows: p.rows, p_replace: st.mode === 'all', p_dry: true, p_as: S.as }); st.sig = sig(); st.rows = p.rows; }
      catch (e) { st.err = /Could not find|schema cache|does not exist/i.test((e && e.message) || '') ? T('サーバーの更新（DB の更新70）のあとで使えます') : errJa(e.message); }
      st.busy = false; draw();
    };
    q('[data-imp]').onclick = async () => {
      if (!st.res || !st.res.ok || st.sig !== sig() || st.busy) return;
      if (st.mode === 'all' && st.res.del > 0 && !confirm(T(`書かなかった${unit} ${st.res.del}本を消して、入れかえますか？`))) return;
      st.busy = true; draw();
      try {
        const r = await call('mp_dia_import', { p_route: D.id, p_rows: st.rows, p_replace: st.mode === 'all', p_dry: false, p_as: S.as });
        if (r && r.ok) { toast(T(`取りこみました（追加 ${r.add}・変更 ${r.upd}・削除 ${r.del}）。もどすときは「↶ 取り消す」`)); m.close(); reload(); return; }
        st.res = r;
      } catch (e) { st.err = errJa(e.message); }
      st.busy = false; draw();
    };
  });
  draw();
}

// 重なりを直す（同じ駅・同じ番線に重なる列車）：番線をふりかえる・前の駅で待って時刻をずらす・両方。見つもってから。あとで「↶ 取り消す」でもどせる
//   （DB の更新69）サーバーは1回40秒まで。列車の多い系統は、とちゅうで more が返るので、つづき（p_cont）を何回か呼んで直しきる（「とめる」でやめられる）
function diaFix(D, reload) {
  const st = { mode: 'both', q: null, err: null, busy: false, seq: 0, run: null };
  const MODES = [['trk', '番線をふりかえる'], ['time', '時刻をずらす'], ['both', '両方（ふりかえ → だめならずらす）']];
  const m = modal(['重なりを直す', ''], null);
  const quote = async () => {
    const my = ++st.seq; st.busy = true; st.q = null; st.err = null; draw();
    let q = null, err = null;
    try { q = await call('mp_dia_fix', { p_route: D.id, p_mode: st.mode, p_as: S.as, p_dry: true }); } catch (e) { err = errJa(e.message); }
    if (st.seq !== my) return;
    st.busy = false; st.q = q; st.err = err; draw();
  };
  const canFix = q => !!q && q.before > 0 && !!(q.trk || q.time || q.more);
  const res = q => {
    if (!q.before) return '<p class="small">重なっている列車はありません</p>';
    if (q.more && !q.passes) return `<p class="small"><span>重なっている列車 ${q.before}本</span></p>
      <p class="muted small">列車が多いので、見つもりは できませんでした。直してみて、よくなければ ダイヤの「↶ 取り消す」で もどせます（何回かに分けて直します）</p>`;
    if (!q.trk && !q.time) return `<p class="small"><span>重なっている列車 ${q.before}本</span>・<span class="mp-warn">この直し方では直せませんでした</span></p>
      <p class="muted small">空いている番線がないか、時刻をずらすと走れなくなる列車が出るか、15分より長く待たないと直らないところです。ほかの直し方か、駅の番線をふやすのをためしてください</p>`;
    return `<div class="mp-kv"><b>重なっている列車</b><span><span>${q.before}本 → ${q.after}本</span>${q.more ? '<small>（とちゅうまで）</small>' : ''}</span>
      ${q.trk ? `<b>番線のふりかえ</b><span>${q.trk}か所</span>` : ''}${q.time ? `<b>時刻のずらし</b><span><span>${q.time}か所</span>（<span>合計 ${mmss(q.delay)}</span>）</span>` : ''}
      ${q.bad0 || q.bad1 ? `<b>走れない列車</b><span>${q.bad0}本 → ${q.bad1}本</span>` : ''}</div>
      ${q.more ? '<p class="muted small">列車が多いので、ここまでで見つもりました。直すときは、のこりも つづけて直します</p>' : ''}`;
  };
  // 直す：1回目は ふつうに、2回目からは つづき。サーバーが前のまま（DB の更新69 の前）なら、1回でやめる
  const run = async () => {
    const R = st.run = { i: 0, before: null, after: null, trk: 0, time: 0, delay: 0, bad0: 0, bad1: 0, stop: false, err: null, old: false, done: false };
    draw();
    for (let k = 0; k < 30 && !R.stop; k++) {
      const args = { p_route: D.id, p_mode: st.mode, p_as: S.as, p_dry: false };
      if (k > 0) args.p_cont = true;
      let r;
      try { r = await call('mp_dia_fix', args); }
      catch (e) {
        if (k > 0 && /Could not find the function|p_cont/i.test((e && e.message) || '')) { R.old = true; break; }
        R.err = errJa(e.message); break;
      }
      R.i = k + 1;
      if (R.before == null) { R.before = r.before; R.bad0 = r.bad0; }
      R.after = r.after; R.bad1 = r.bad1; R.trk += r.trk || 0; R.time += r.time || 0; R.delay += r.delay || 0;
      draw();
      if (!r.more || (k > 0 && !r.passes)) break;   // おわり・すすまない
      if (k === 0 && !('ms' in r)) { R.old = !!r.more; break; }   // 前のサーバー（DB の更新69 の前。つづきがない）
    }
    R.done = true; draw(); reload();
    if (!R.err) toast(T(R.before ? `重なりを直しました（${R.before}本 → ${R.after}本）${R.stop ? '。とちゅうで とめました' : R.old ? '。列車が多いので、ここまでにしました。もう一度「重なりを直す」で つづきを直せます' : ''}` : '重なっている列車はありません'));
  };
  const runBox = R => `<div class="mp-kv"><b>重なっている列車</b><span>${R.before == null ? '<span>数えています…</span>' : `<span>${R.before}本 → ${R.after}本</span>`}</span>
      ${R.trk ? `<b>番線のふりかえ</b><span>${R.trk}か所</span>` : ''}${R.time ? `<b>時刻のずらし</b><span><span>${R.time}か所</span>（<span>合計 ${mmss(R.delay)}</span>）</span>` : ''}
      ${R.bad0 || R.bad1 ? `<b>走れない列車</b><span>${R.bad0}本 → ${R.bad1}本</span>` : ''}</div>
    ${R.done ? (R.err ? `<p class="mp-warn small">${esc(R.err)}</p><p class="muted small">ここまで直した分は、のこっています（「↶ 取り消す」で もどせます）。もう一度おすと、つづきを直します</p>` : '<p class="small">おわりました</p>')
      : `<p class="small" style="margin-bottom:2px"><b>直しています…</b>${R.i ? `<span>（${R.i}回目まで おわり）</span>` : ''}</p><p class="muted small" style="margin-top:0">列車の多い系統は、何回かに分けて直します</p>
         <div class="mp-row"><button class="btn" data-stop ${R.stop ? 'disabled' : ''}>${R.stop ? 'とめています…' : 'とめる'}</button></div>`}`;
  const draw = () => m.set('重なりを直す', `<p class="small" style="margin-top:0">同じ駅の同じ番線に重なる列車を、この系統の列車をうごかして直します。ゆずるのは優先番号の大きい列車です（ほかの系統の列車と重なるときは、この系統の列車がゆずります）。</p>
    <div class="mp-row"><span class="mp-seg" style="flex-wrap:wrap">${MODES.map(([k, l]) => `<button data-m="${k}" class="${st.mode === k ? 'on' : ''}" ${st.run && !st.run.done ? 'disabled' : ''}>${l}</button>`).join('')}</span></div>
    <p class="muted small">${st.mode === 'time' ? '前の駅で待って、相手の列車が出てから着くようにします（始発駅なら発車をおくらせます）' : st.mode === 'trk' ? 'その向きで使える、空いている番線にうつします（本線から）' : 'まず空いている番線にうつし、なければ前の駅で待って時刻をずらします'}</p>
    <div data-res>${st.run ? runBox(st.run) : st.busy ? '<p class="muted small">見つもり中…（列車の多い系統は 40秒ほど かかります）</p>' : st.err ? `<p class="mp-warn small">${esc(st.err)}</p>` : st.q ? res(st.q) : '<div class="mp-row"><button class="btn" data-est>見つもる</button><span class="muted small">どれだけ直るかを出してから、直せます</span></div>'}</div>
    ${st.run ? (st.run.done ? '<div class="mp-row"><button class="btn" data-x>とじる</button></div>' : '') : `<div class="mp-row"><button class="btn main" data-ok ${canFix(st.q) && !st.busy ? '' : 'disabled'}>この直し方で直す</button></div>`}
    <p class="muted small">直したあとも、ダイヤの「↶ 取り消す」でもとにもどせます（何回かに分けて直しても、1回で もどります）。重なりの数がへらない・走れない列車がふえるところまでは直しません</p>`, b => {
    b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { if (st.mode === x.dataset.m || (st.run && !st.run.done)) return; st.mode = x.dataset.m; st.run = null; st.seq++; st.busy = false; st.q = null; st.err = null; draw(); });
    { const e = b.querySelector('[data-est]'); if (e) e.onclick = () => quote(); }
    { const o = b.querySelector('[data-ok]'); if (o) o.onclick = () => { if (!st.run || st.run.done) run(); }; }
    { const x = b.querySelector('[data-stop]'); if (x) x.onclick = () => { if (st.run) { st.run.stop = true; draw(); } }; }
  });
  m.onclose = () => { if (st.run && !st.run.done) st.run.stop = true; };   // とじたら、いまの1回がおわったところで やめる
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
      <b style="min-width:5em;color:${kindCol(D, k.name)}">${esc(kindL(k.name))}</b>
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
  return m;
}
function ttTable(D, dir) {
  const n = D.stops.length, ordI = Array.from({ length: n }, (_, i) => dir === 1 ? i : n - 1 - i);   // 系統の何番目の駅か（走る順。環状線は、はじめの駅が2回）
  const trs = D.trains.filter(t => t.dir === dir).sort((a, b) => a.dep - b.dep);
  if (!trs.length) return '<p class="muted small">列車はまだありません</p>';
  const pm = new Map(trs.map(t => { const si = schedIdx(D, t), m = new Map(), ok = si.filter(x => x >= 0); (t.sched || []).forEach((e, j) => { if (si[j] >= 0) m.set(si[j], e); });
    return [t.id, { m, lo: Math.min(...ok), hi: Math.max(...ok) }]; }));
  const cell = (t, ri) => {
    const P = pm.get(t.id), e = P.m.get(ri), s = D.stops[ri];
    if (!e) return (P.lo < ri && ri < P.hi) ? '<span class="muted">レ</span>' : '<span class="muted">‥</span>';
    const tm = D.timing.includes(s.id);
    return `<span style="${tm ? 'font-weight:800' : ''}">${e[2] != null ? hms(e[2]) : hms(e[1]) + '着'}</span>${tm && e[3] ? `<br><small class="muted">${e[3]}番</small>` : ''}`;
  };
  return `<div class="mp-scroll"><table class="mp-tt"><tr><th></th>${trs.map(t => `<th style="color:${kindCol(D, t.kind)}">${esc(t.num)}<br>${esc(kindL(t.kind))}${t.day ? `<br><small>${t.orig ? '✂' : ''}${mdL(t.day)}</small>` : ''}</th>`).join('')}</tr>
    ${ordI.map(ri => `<tr><td class="st">${esc(D.stops[ri].name)}${D.timing.includes(D.stops[ri].id) ? ' ◎' : ''}</td>${trs.map(t => `<td>${cell(t, ri)}</td>`).join('')}</tr>`).join('')}
    <tr><td class="st">運用</td>${trs.map(t => `<td><small>${t.onum ? esc(t.onum) : '—'}</small></td>`).join('')}</tr>
    <tr><td class="st">編成</td>${trs.map(t => `<td><small>${t.fname ? esc(t.fname) : '—'}</small></td>`).join('')}</tr>
    <tr><td class="st">両数</td>${trs.map(t => `<td><small>${t.fn ? t.fn + (t.cplx || []).filter(c => c.ok).map(c => '+' + c.n).join('') : '—'}</small></td>`).join('')}</tr></table></div><p class="muted small"><span>◎ 採時駅（太字の時刻）・レ 通過・日付があるのは臨時列車（その日だけ）</span>${trs.some(t => t.orig) ? '<span>・✂ は運転整理の列車（その日だけ、もとの列車のかわりに走る）</span>' : ''}</p>`;
}
// ダイヤグラム（よこ：時刻・たて：駅）。ドラッグでよこに動く・ピンチでよこに拡大
// 環状線（2026-10-29）：列車の時刻（sched）の駅が、系統の何番目の駅か（走る順に見る。はじめの駅が最後にもう一度ある系統でも）
function schedIdx(D, t) {
  const n = D.stops.length, at = c => t.dir === -1 ? n - 1 - c : c, out = []; let c = 0;
  for (const e of t.sched || []) { while (c < n && D.stops[at(c)].id !== e[0]) c++; out.push(c < n ? at(c) : -1); c++; }
  return out;
}
function diaCanvas(pane, D, onTrain, V0) {
  pane.innerHTML = `<canvas class="mp-dia"></canvas><p class="muted small" style="margin:4px 0 0">よこにドラッグで動かす・2本指でよこに拡大・列車の線をタップで編集</p><p class="muted small" style="margin:2px 0 0">${(() => { const ks = [...new Set(D.trains.map(t => t.kind))]; return ks.map(k => `<span style="white-space:nowrap;margin-right:8px">${kindSw(kindCol(D, k))}<span>${esc(kindL(k))}</span></span>`).join(''); })()}<br><span>線の色は種別・点線は編成なし・一点鎖線は臨時列車・赤は注意のある列車・太い線は連結している区間</span>${D.trains.some(t => Array.isArray(t.lay)) ? '<br><span>駅の横の点線は 折り返しを待つあいだ（灰色の破線は 留置線で待つ）</span>' : ''}</p>`;
  const cv = pane.querySelector('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const km = D.km.map(Number), tot = Math.max(0.1, km[km.length - 1]);
  const V = V0 || { t0: 5 * 3600, sec: 19 * 3600 };   // V0：しぼりこみで描きなおしても、見ている時刻のはんいをのこす（t62）
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
    D.paths = [];
    for (const t of D.trains) {
      const pts = [], at = new Map(), atB = new Map(), si = schedIdx(D, t);   // 駅 → [着の点, 発の点]（環状線：つなぐ駅は前・切りはなす駅はうしろのほう）
      (t.sched || []).forEach((e, j) => { if (si[j] < 0) return; const k = km[si[j]], i0 = pts.length; if (e[1] != null) pts.push([X(e[1]), Y(k)]); if (e[2] != null) pts.push([X(e[2]), Y(k)]);
        if (!at.has(e[0])) at.set(e[0], [i0, pts.length - 1]); atB.set(e[0], [i0, pts.length - 1]); });
      if (pts.length < 2) continue;
      // 線の色は種別（DB の更新104。編成のない列車も 種別の色の点線・うすく）。注意のある列車は赤
      g.strokeStyle = t.form && t.warn ? '#d23' : kindCol(D, t.kind); g.globalAlpha = t.form ? 1 : 0.6; g.lineWidth = 1.4; g.setLineDash(!t.form ? [4, 3] : t.day ? [9, 3, 2, 3] : []);
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      // 連結している区間は太く
      for (const c of t.cplx || []) {
        const a = c.ok && at.get(c.a), b = c.ok && atB.get(c.b); if (!a || !b) continue;
        g.lineWidth = 3.4; g.beginPath(); for (let i = a[1]; i <= b[0]; i++) { if (i === a[1]) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1]); } g.stroke();
      }
      // 折り返しを待つあいだ（DB の更新105）：終着駅の高さに、着いてから出るまで（点線はホーム・破線は留置線）
      if (Array.isArray(t.lay) && !t.day) {
        const e = pts[pts.length - 1], xb = X(t.lay[2]);
        if (xb > e[0] + 1) { g.strokeStyle = t.lay[3] === 2 ? 'rgba(120,120,120,.75)' : kindCol(D, t.kind); g.globalAlpha = t.lay[3] === 2 ? 1 : 0.55; g.lineWidth = t.lay[3] === 2 ? 1.2 : 2.2;
          g.setLineDash(t.lay[3] === 2 ? [6, 3] : [2, 3]); g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(xb, e[1]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
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
  const tm = D.stops.filter((s, i) => D.timing.includes(s.id) && D.stops.findIndex(x => x.id === s.id) === i);   // 採時駅（環状線のはじめの駅は1つ）
  const ops = (D.ops || []).slice();
  const st = t ? { ...t, tt: { ...(t.tt || {}) }, skip: new Set(t.skip || []), opv: t.op ? 'o:' + t.op : '', day: t.day || null, cpl: (t.cpl || []).map(c => ({ op: c.op, a: c.a, b: c.b })), sa: t.sa || null, sb: t.sb || null }
               : { dir: 1, num: '', kind: D.kind === 'rail' ? '普通' : '', dep: 7 * 3600, opv: '', day: null, tt: {}, skip: new Set(), cpl: [], sa: null, sb: null };
  // 止まる駅（2026-10-29）：st.on = 止まる駅（系統の何番目の駅か。環状線は、はじめの駅が最後にもう一度ある）。止まる最初の駅が始発、最後の駅が終着（その外は走らない・あいだの止まらない駅は通過）
  const ordOf = d => d === 1 ? D.stops : D.stops.slice().reverse();
  const RI = s => D.stops.indexOf(s);
  const lastIdx = (o, f) => { for (let i = o.length - 1; i >= 0; i--) if (f(o[i])) return i; return -1; };
  const ends = o => [o.findIndex(s => st.on.has(RI(s))), lastIdx(o, s => st.on.has(RI(s)))];
  { const o = ordOf(st.dir); let a = st.sa ? o.findIndex(s => s.id === st.sa) : 0, z = st.sb ? lastIdx(o, s => s.id === st.sb) : o.length - 1;   // 環状線：終着は走る順でうしろのほう
    if (a < 0) a = 0; if (z < 0 || z <= a) z = o.length - 1;
    st.on = new Set(o.filter((s, i) => i === a || i === z || (i > a && i < z && !st.skip.has(s.id))).map(RI)); }
  const m = modal([t ? `列車 ${t.num}` : '列車をつくる', '']);
  const bus = D.kind !== 'rail', ship = D.kind === 'ship' || D.kind === 'air', air = D.kind === 'air';   // バス・船・飛行機は連結しない
  // 停車駅のパターンを当てはめる：いまの走る区間のうち、パターンで通過でない駅に止まる
  const applyPat = P => { const o = ordOf(st.dir), [a, z] = ends(o), nw = new Set(o.slice(a, z + 1).filter(s => !P.has(s.id)).map(RI));
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
    const o0 = t && t.orig ? D.trains.find(x => x.id === t.orig) : null, od = t && D.ord ? (t.ordd || []).filter(c => c[0] >= D.today) : [];   // 運転整理（DB の更新100）
    m.set(t ? `列車 ${t.num}` : '列車をつくる', `
      ${t && t.orig ? `<div class="mp-item small" style="margin:0 0 8px;text-align:left">✂ <b>${esc(T('運転整理の列車'))}</b>：<span>${esc(mdW(t.day))}</span> <span>${esc(T('だけ、もとの列車のかわりに走ります'))}</span>${o0 ? `（<span>もとの列車</span> <b translate="no">${esc(o0.num)}</b>）` : ''}
        <br><span translate="no">${esc(ordJ(D, t))}</span>
        <div class="mp-row"><button class="btn" data-ordm>✂ さらに指示…</button>${o0 ? '<button class="btn" data-ordorig>もとの列車を開く</button>' : ''}<button class="btn" data-ordv>この運転整理をやめる</button></div></div>` : ''}
      <div class="mp-row"><input class="mp-inp" style="flex:1 1 90px" data-num placeholder="列車番号" value="${esc(st.num)}">
        <select class="mp-inp" style="flex:1 1 90px" data-kind>${kindOpts(D, st.kind)}</select>
        <span class="mp-seg"><button data-dir="1" class="${st.dir === 1 ? 'on' : ''}">下り</button><button data-dir="-1" class="${st.dir === -1 ? 'on' : ''}">上り</button></span></div>
      ${ord.length > 2 ? `<div class="mp-row" style="align-items:center"><span>走る区間</span><select class="mp-inp" style="flex:1 1 110px" data-sa>${ord.slice(0, ib).map((s, i) => `<option value="${i === 0 ? '' : s.id}" ${i === ia ? 'selected' : ''}>${esc(i === 0 ? T(`${s.name}（系統の端）`) : s.name)}</option>`).join('')}</select><span>→</span>
        <select class="mp-inp" style="flex:1 1 110px" data-sb>${ord.slice(ia + 1).map((s, i) => { const k = ia + 1 + i; return `<option value="${k === ord.length - 1 ? '' : s.id}" ${k === ib ? 'selected' : ''}>${esc(k === ord.length - 1 ? T(`${s.name}（系統の端）`) : s.name)}</option>`; }).join('')}</select></div>
        ${ia > 0 || ib < ord.length - 1 ? `<p class="small muted" style="margin:0 0 4px">${ia > 0 ? '<span>途中始発</span>' : ''}${ia > 0 && ib < ord.length - 1 ? '・' : ''}${ib < ord.length - 1 ? '<span>途中止まり</span>' : ''}</p>` : ''}` : ''}
      <div class="mp-row">始発（${esc(ord[ia].name)}）の発車 <input class="mp-inp mp-num" data-dep value="${hms(st.dep)}"></div>
      ${t && t.orig ? `<div class="mp-row" style="align-items:center"><span>走る日</span><b>${esc(mdW(t.day))}</b><span class="small muted">${esc(T('だけ（運転整理の列車）'))}</span></div>` : `<div class="mp-row" style="align-items:center"><span>走る日</span><span class="mp-seg"><button data-day="0" class="${st.day ? '' : 'on'}">毎日</button><button data-day="1" class="${st.day ? 'on' : ''}">この日だけ（臨時）</button></span>
        ${st.day ? `<input class="mp-inp" style="width:auto" type="date" data-dt value="${esc(st.day)}" min="${esc(D.today)}" max="${esc(dayAdd(D.today, 60))}">` : ''}</div>`}
      ${t && !t.orig && D.ord ? `<div class="mp-row" style="align-items:center;flex-wrap:wrap"><button class="btn" style="flex:none" data-ordm>${t.day ? '✂ 運転整理（この日）…' : '✂ 運転整理（打ち切り・延長運転など）…'}</button>
        ${od.length ? `<span class="small">${od.map(c => `<span>${esc(mdL(c[0]))}</span>：<span translate="no">${c[1] === 'x' ? esc(T('運休')) : esc(ordJ(D, D.trains.find(x => x.orig === t.id && x.day === c[0]) || {}))}</span>`).join('・')}</span>` : ''}</div>` : ''}
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
      ${ord.length > 2 ? `<h4 style="margin:10px 0 4px">${air ? '寄る空港' : ship ? '寄る港' : '止まる駅'}${(D.pats || {})[st.kind] ? ` <button class="btn" style="padding:2px 8px;font-size:12px" data-pat1>${esc(T(`「${kindL(st.kind)}」のパターンにする`))}</button>` : ''}</h4><div class="mp-cars">${ord.map((s, i) => { const on = st.on.has(RI(s)), out = i < ia || i > ib;
          return `<span class="mp-car ${on ? 'on' : ''}" data-sk="${RI(s)}"${out ? ' style="opacity:.5"' : ''}>${esc(s.name)}<span class="n">${on ? (i === ia ? (ship ? '出発' : '始発') : i === ib ? (ship ? '到着' : '終着') : '停車') : out ? (ship ? '寄らない' : '走らない') : '通過'}</span></span>`; }).join('')}</div>
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
          ord.forEach((s, i) => { if (i < na) st.on.delete(RI(s)); else if (i < ia) st.on.add(RI(s)); }); st.on.add(RI(ord[na])); draw(); };
        q('[data-sb]').onchange = e => { keep(); const v = Number(e.target.value) || null, nb = v ? lastIdx(ord, s => s.id === v) : ord.length - 1;
          ord.forEach((s, i) => { if (i > nb) st.on.delete(RI(s)); else if (i > ib) st.on.add(RI(s)); }); st.on.add(RI(ord[nb])); draw(); };
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
      b.querySelectorAll('[data-sk]').forEach(x => x.onclick = () => { keep(); const ri = Number(x.dataset.sk);   // 系統の何番目の駅か
        if (st.on.has(ri)) { if (st.on.size <= 2) return toast(ship ? '寄るところは2つ以上いります' : '止まる駅は2つ以上いります'); st.on.delete(ri); } else st.on.add(ri); draw(); });
      if (q('[data-cadd]')) q('[data-cadd]').onclick = () => { keep(); st.cpl.push({ op: null, a: null, b: null }); draw(); };
      b.querySelectorAll('[data-cx]').forEach(x => x.onclick = () => { keep(); st.cpl.splice(Number(x.dataset.cx), 1); draw(); });
      if (q('[data-del]')) q('[data-del]').onclick = async () => { if (await api('mp_train_del', { p_ids: [t.id], p_as: S.as }, '消しました')) { m.close(); reload(); } };
      // 運転整理（DB の更新100）
      if (q('[data-ordm]')) q('[data-ordm]').onclick = () => ordEdit(D, { t }, () => { m.close(); reload(); });
      if (q('[data-ordorig]')) q('[data-ordorig]').onclick = () => { m.close(); trainEdit(D, o0, reload); };
      if (q('[data-ordv]')) q('[data-ordv]').onclick = async () => {
        if (!await confirm2(T('この運転整理をやめますか？（もとの列車が その日も走ります）'), { what: `${t.num}（${mdL(t.day)}）`, q: '本当にやめますか？', ok: 'やめる', note: 'やめたあとでも「↶ 取り消す」でもどせます。' })) return;
        if (await api('mp_dia_order_del', { p_route: D.id, p_trains: [t.id], p_cxl: null, p_as: S.as }, '運転整理をやめました')) { m.close(); runListStale(); reload(); }
      };
      q('[data-ok]').onclick = async () => {
        keep(); if (!st.num.trim()) return toast('列車番号を入れてください');
        const pop = st.opv.startsWith('o:') ? Number(st.opv.slice(2)) : null, pf = st.opv.startsWith('f:') ? Number(st.opv.slice(2)) : null;
        // 止まる最初の駅が始発・最後の駅が終着（系統の端なら null）。あいだの止まらない駅が通過
        const sa = ia > 0 ? ord[ia].id : null, sb = ib < ord.length - 1 ? ord[ib].id : null, skip = ord.slice(ia + 1, ib).filter(s => !st.on.has(RI(s))).map(s => s.id);
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
      <select class="mp-inp" style="width:auto" data-kind>${kindOpts(D, '普通')}</select><button class="btn" style="flex:none" data-bpat>停車駅のパターン</button></div>
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
    b.querySelector('[data-bpat]').onclick = () => { const pm = patEdit(D, null, b.querySelector('[data-kind]').value); if (pm) pm.onclose = pn; };   // 種別の停車駅のパターンを そのまま直す（DB の更新104）
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
/* ---------- 1時間の型でつくる（パターンダイヤ。DB の更新104）：毎時 同じ分に出る列車の型（行ごとに 種別・向き・発車の分・走る区間・列車番号の頭）を、
   何時から何時まで くりかえして つくる。停車駅は 種別の停車駅のパターン。型は系統に のこる（D.hpat） ---------- */
const HP_N = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30];   // 1時間に何本（等間隔）
const hpMins = v => [...new Set(hw(v).split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n >= 0 && n <= 59))].sort((a, b) => a - b);
function hourDia(D, reload) {
  const hp = D.hpat && Array.isArray(D.hpat.rows) && D.hpat.rows.length ? D.hpat : null;
  const st = { h0: hp ? hp.h0 : 6, h1: hp ? hp.h1 : 24, rep: hp ? hp.rep !== false : true, q: null, busy: false,
    rows: hp ? hp.rows.map(r => ({ k: r.k, d: r.d, m: (r.m || []).slice(), sa: r.sa || null, sb: r.sb || null, pre: r.pre || '' }))
             : [{ k: '普通', d: 0, m: [0, 15, 30, 45], sa: null, sb: null, pre: '' }] };
  const unit = D.kind === 'ship' || D.kind === 'air' ? '便' : '列車';
  const m = modal(['1時間の型でつくる', ''], null, 'mp-wide');
  const stopName = id => (D.stops.find(x => x.id === id) || {}).name || '';
  // 走る区間：下り・両方は 下りの順（両方の上りは 逆に走る）、上りは 上りの順。null は系統の端
  const secSel = (r, i) => {
    if (D.stops.length <= 2) return '';
    const ord = r.d === -1 ? D.stops.slice().reverse() : D.stops, n = ord.length;
    return `<div class="mp-row small" style="align-items:center"><span>走る区間</span><select class="mp-inp" style="flex:1 1 100px" data-hsa="${i}">${ord.slice(0, -1).map((x, j) => `<option value="${j === 0 ? '' : x.id}" ${(j === 0 ? r.sa == null : r.sa === x.id) ? 'selected' : ''}>${esc(j === 0 ? T(`${x.name}（系統の端）`) : x.name)}</option>`).join('')}</select>
      <span>${r.d === 0 ? '⇄' : '→'}</span><select class="mp-inp" style="flex:1 1 100px" data-hsb="${i}">${ord.slice(1).map((x, j) => `<option value="${j === n - 2 ? '' : x.id}" ${(j === n - 2 ? r.sb == null : r.sb === x.id) ? 'selected' : ''}>${esc(j === n - 2 ? T(`${x.name}（系統の端）`) : x.name)}</option>`).join('')}</select></div>`;
  };
  // 1時間の図：向きごとに 0〜60分の帯に、種別の色で 発車の分
  const bar = dir => {
    const ts = []; st.rows.forEach((r, i) => { if (r.d === dir || r.d === 0) for (const mm of r.m) ts.push([mm, r.k, i]); });
    return `<div class="mp-row small" style="align-items:center;margin:2px 0"><span style="min-width:2.5em">${dir === 1 ? '下り' : '上り'}</span>
      <div style="position:relative;flex:1 1 auto;height:22px;background:var(--bg2,#f2f2f2);border-radius:4px;overflow:hidden">
        ${[15, 30, 45].map(x => `<span style="position:absolute;left:${x / 60 * 100}%;top:0;bottom:0;width:1px;background:#0002"></span>`).join('')}
        ${ts.map(([mm, k]) => `<span title="${esc(kindL(k))} :${String(mm).padStart(2, '0')}" style="position:absolute;left:calc(${mm / 60 * 100}% - 1px);top:3px;bottom:3px;width:3px;border-radius:1px;background:${kindCol(D, k)}"></span>`).join('')}
      </div><small class="muted" style="min-width:3em;text-align:right">${ts.length}<span>本</span></small></div>`;
  };
  const draw = () => {
    const hs = Array.from({ length: 25 }, (_, h) => h);
    m.set('1時間の型でつくる', `<p class="small" style="margin-top:0"><span>毎時 同じ分に出る${unit}の型をつくって、1日に くりかえします（パターンダイヤ）。停車駅は 種別の「停車駅のパターン」どおりです。</span></p>
      <div class="mp-row small" style="align-items:center"><span>時間帯</span><select class="mp-inp" style="width:auto" data-h0>${hs.slice(0, 24).map(h => `<option value="${h}" ${h === st.h0 ? 'selected' : ''}>${h}</option>`).join('')}</select><span>時から</span>
        <select class="mp-inp" style="width:auto" data-h1>${hs.slice(1).map(h => `<option value="${h}" ${h === st.h1 ? 'selected' : ''}>${h}</option>`).join('')}</select><span>時まで</span></div>
      <div class="mp-list">${st.rows.map((r, i) => `<div class="mp-item" style="border-left:4px solid ${kindCol(D, r.k)}">
        <div class="mp-row small" style="align-items:center;margin-top:0"><select class="mp-inp" style="width:auto" data-hk="${i}">${kindOpts(D, r.k)}</select>
          <span class="mp-seg">${[[1, '下り'], [-1, '上り'], [0, '両方']].map(([v, l]) => `<button data-hd="${i}" data-v="${v}" class="${r.d === v ? 'on' : ''}">${l}</button>`).join('')}</span>
          ${st.rows.length > 1 ? `<button class="btn" style="flex:none;margin-left:auto" data-hx="${i}">×</button>` : ''}</div>
        <div class="mp-row small" style="align-items:center"><span>発車の分</span><input class="mp-inp" style="flex:1 1 120px" data-hm="${i}" value="${r.m.map(x => String(x).padStart(2, '0')).join(', ')}" inputmode="numeric" placeholder="00, 15, 30, 45">
          <select class="mp-inp" style="width:auto" data-hn="${i}"><option value="">${esc(T('1時間に何本'))}</option>${HP_N.map(n => `<option value="${n}">${esc(T(`${n}本（${60 / n}分おき）`))}</option>`).join('')}</select></div>
        ${secSel(r, i)}
        <div class="mp-row small" style="align-items:center"><span>列車番号の頭</span><input class="mp-inp" style="width:5em" data-hp="${i}" value="${esc(r.pre)}" maxlength="4" placeholder="${esc(T('なし'))}">
          <small class="muted" style="flex:1 1 auto">${esc(pnLine(D, r))}</small></div></div>`).join('')}</div>
      <div class="mp-row"><button class="btn" data-hadd ${st.rows.length >= 20 ? 'disabled' : ''}>＋ 行を足す</button></div>
      <div style="margin:6px 0"><b class="small">1時間の型</b>${bar(1)}${bar(-1)}<div class="small" style="margin-top:2px">${[...new Set(st.rows.map(r => r.k))].map(k => `<span style="white-space:nowrap;margin-right:8px">${kindSw(kindCol(D, k))}<span>${esc(kindL(k))}</span></span>`).join('')}</div></div>
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-hrep ${st.rep ? 'checked' : ''}><span>この時間帯に出る${unit}（型の向き・毎日の${unit}）を消して、つくりなおす</span></label>
      <div class="mp-row"><button class="btn" data-hq>見つもる</button><button class="btn main" data-hgo ${st.q && !st.busy ? '' : 'disabled'}>つくる</button></div>
      <p class="small" data-hres style="margin:2px 0">${st.busy ? `<span class="muted">${T('見つもり中…')}</span>` : st.q ? (st.q.err ? `<span class="mp-warn">${esc(st.q.err)}</span>` : `<b>${esc(T(`${unit}を ${st.q.n}本 つくります`))}</b>${st.q.del ? `<span>${esc(T(`（いまの${unit} ${st.q.del}本 を消します）`))}</span>` : ''}`) : `<span class="muted">${esc(T('「見つもる」で本数をたしかめてから、つくります'))}</span>`}</p>
      <p class="muted small"><span>列車番号は、向きごとに 発車の順で「時×100＋下り 1・3・5…／上り 2・4・6…」（頭をつけた行は 頭＋番号）。編成は、あとで「運用を自動で組む」で わりあてます。「↶ 取り消す」で もどせます。型は この系統に のこります。</span></p>`, b => {
      const chg = () => { st.q = null; draw(); };
      b.querySelector('[data-h0]').onchange = e => { st.h0 = Number(e.target.value); if (st.h1 <= st.h0) st.h1 = st.h0 + 1; chg(); };
      b.querySelector('[data-h1]').onchange = e => { st.h1 = Number(e.target.value); if (st.h1 <= st.h0) st.h0 = st.h1 - 1; chg(); };
      b.querySelectorAll('[data-hk]').forEach(x => x.onchange = () => { st.rows[Number(x.dataset.hk)].k = x.value; chg(); });
      b.querySelectorAll('[data-hd]').forEach(x => x.onclick = () => { const r = st.rows[Number(x.dataset.hd)], v = Number(x.dataset.v); if (r.d !== v) { if ((r.d === -1) !== (v === -1)) { const a = r.sa; r.sa = r.sb; r.sb = a; } r.d = v; } chg(); });
      b.querySelectorAll('[data-hx]').forEach(x => x.onclick = () => { st.rows.splice(Number(x.dataset.hx), 1); chg(); });
      b.querySelectorAll('[data-hm]').forEach(x => x.onchange = () => { const r = st.rows[Number(x.dataset.hm)]; r.m = hpMins(x.value); chg(); });
      b.querySelectorAll('[data-hn]').forEach(x => x.onchange = () => { const n = Number(x.value); if (!n) return; const r = st.rows[Number(x.dataset.hn)], f = r.m.length ? r.m[0] % (60 / n) : 0;
        r.m = Array.from({ length: n }, (_, j) => Math.round(f + j * 60 / n) % 60).sort((a, c) => a - c); chg(); });
      b.querySelectorAll('[data-hsa]').forEach(x => x.onchange = () => { st.rows[Number(x.dataset.hsa)].sa = Number(x.value) || null; chg(); });
      b.querySelectorAll('[data-hsb]').forEach(x => x.onchange = () => { st.rows[Number(x.dataset.hsb)].sb = Number(x.value) || null; chg(); });
      b.querySelectorAll('[data-hp]').forEach(x => x.onchange = () => { st.rows[Number(x.dataset.hp)].pre = x.value.trim().slice(0, 4); chg(); });
      b.querySelector('[data-hadd]').onclick = () => { const l = st.rows[st.rows.length - 1]; st.rows.push({ k: l ? l.k : '普通', d: l ? l.d : 0, m: [0, 30], sa: null, sb: null, pre: '' }); chg(); };
      b.querySelector('[data-hrep]').onchange = e => { st.rep = e.target.checked; chg(); };
      const args = dry => ({ p_route: D.id, p_rows: st.rows.map(r => ({ k: r.k, d: r.d, m: r.m, sa: r.sa, sb: r.sb, pre: r.pre })), p_h0: st.h0, p_h1: st.h1, p_replace: st.rep, p_as: S.as, p_dry: dry });
      b.querySelector('[data-hq]').onclick = async () => {
        if (st.rows.some(r => !r.m.length)) return toast('発車の分を入れてください');
        st.busy = true; draw();
        try { const r = await call('mp_train_pattern', args(true)); st.q = { n: r.n, del: r.del }; } catch (e) { st.q = { err: errJa(e.message) }; }
        st.busy = false; draw();
      };
      b.querySelector('[data-hgo]').onclick = async () => {
        if (!st.q || st.q.err) return;
        if (st.q.del && !await confirm2(T(`いまの${unit} ${st.q.del}本 を消して、${st.q.n}本 つくりますか？`), { what: T(`${unit} ${st.q.del}本`), q: '消して つくりなおしますか？', ok: 'つくる', note: '「↶ 取り消す」で もどせます。' })) return;
        const r = await api('mp_train_pattern', args(false));
        if (r) { toast(T(`${r.n}本つくりました`)); m.close(); runListStale(); reload(); }
      };
    });
  };
  draw();
}
// 行の停車駅（種別の停車駅のパターン）のひとこと
function pnLine(D, r) {
  const p = (D.pats || {})[r.k];
  if (!p || !p.length) return T(`「${kindL(r.k)}」は各駅に停車`);
  const ns = D.stops.filter(x => p.includes(x.id)).map(x => x.name);
  return T(`「${kindL(r.k)}」の停車駅のパターン`) + '：' + T('通過') + ' ' + ns.slice(0, 6).join('・') + (ns.length > 6 ? '…' : '');
}
/* ---------- 運用番号を種別ごとにまとめる（DB の更新104）：この系統の毎日の列車の運用を、いちばん多く走る種別で分けて、
   種別ごとに 頭＋はじめの番号から（例：快速は 101・102…）。見つもり（だぶり）を見てから つけなおす ---------- */
function opsRenum(D, reload) {
  const daily = D.trains.filter(t => !t.day && t.onum);
  const ko = k => { const x = (D.kinds || []).find(y => y.name === k); return x ? x.prio * 100 + (KINDS.indexOf(k) + 1) : 999; };
  const kinds = [...new Set(daily.map(t => t.kind))].sort((a, b) => ko(a) - ko(b) || a.localeCompare(b, 'ja'));
  const cfg = new Map(kinds.map((k, i) => [k, { on: true, pre: '', st: String((i + 1) * 100 + 1) }]));
  const st = { q: null, busy: false, seq: 0 };
  const m = modal(['運用番号を種別ごとにまとめる', '']);
  const map = () => { const o = {}; for (const [k, c] of cfg) if (c.on) o[k] = { pre: c.pre, st: c.st }; return o; };
  const quote = async () => {
    const my = ++st.seq; st.busy = true; draw();
    let q = null; try { q = await call('mp_ops_renum_kind', { p_route: D.id, p_map: map(), p_as: S.as, p_dry: true }); } catch (e) { q = { err: errJa(e.message) }; }
    if (my !== st.seq) return; st.q = q; st.busy = false; draw();
  };
  const draw = () => {
    const L = st.q && st.q.list || [], dup = new Set(st.q && st.q.dup || []);
    m.set('運用番号を種別ごとにまとめる', `<p class="small" style="margin-top:0"><span>この系統の毎日の列車が入っている運用を、この系統で いちばん多く走る種別で分けて、種別ごとに 運用番号を つけなおします（はじめの列車が早い順）。</span></p>
      <div class="mp-list">${kinds.map(k => { const c = cfg.get(k), n = L.filter(x => x.k === k).length; return `<div class="mp-item" style="border-left:4px solid ${kindCol(D, k)}"><div class="mp-row small" style="align-items:center;margin:0">
          <label style="display:inline-flex;gap:6px;align-items:center;flex:1 1 auto"><input type="checkbox" data-ron="${esc(k)}" ${c.on ? 'checked' : ''}><b><span>${esc(kindL(k))}</span></b>${st.q && !st.q.err && c.on ? `<small class="muted">（<span>運用 ${n}つ</span>）</small>` : ''}</label>
          <span>頭</span><input class="mp-inp" style="width:4em" data-rpre="${esc(k)}" value="${esc(c.pre)}" maxlength="4" placeholder="${esc(T('なし'))}">
          <span>はじめの番号</span><input class="mp-inp" style="width:5em" data-rst="${esc(k)}" value="${esc(c.st)}" maxlength="4" inputmode="numeric"></div>
        ${c.on && L.some(x => x.k === k) ? `<small translate="no">${L.filter(x => x.k === k).slice(0, 6).map(x => `${esc(x.old)} → <b style="${dup.has(x.new) ? 'color:#c33' : ''}">${esc(x.new)}</b>`).join('・')}${n > 6 ? '…' : ''}</small>` : ''}</div>`; }).join('')}</div>
      <p class="small" style="margin:4px 0">${st.busy ? `<span class="muted">${esc(T('見つもり中…'))}</span>` : !st.q ? '' : st.q.err ? `<span class="mp-warn">${esc(st.q.err)}</span>`
        : dup.size ? `<span class="mp-warn">${esc(T('ほかの運用と だぶる番号があります（赤）。頭か はじめの番号を変えてください'))}</span>` : `<b>${esc(T(`運用 ${st.q.n}つ の番号を つけなおします`))}</b>`}</p>
      <div class="mp-row"><button class="btn main" data-rgo ${st.q && !st.q.err && !dup.size && st.q.n > 0 && !st.busy ? '' : 'disabled'}>つけなおす</button></div>
      <p class="muted small"><span>つけなおす前に、運用のバックアップを自動でとります（≡ →「運用」→「バックアップ」から もどせます）。運用番号は 名義で1つです。ほかの系統も走る運用も、この系統で いちばん多い種別で分けます。</span></p>`, b => {
      let tm = 0; const later = () => { clearTimeout(tm); tm = setTimeout(quote, 400); };
      b.querySelectorAll('[data-ron]').forEach(x => x.onchange = () => { cfg.get(x.dataset.ron).on = x.checked; quote(); });
      b.querySelectorAll('[data-rpre]').forEach(x => x.oninput = () => { cfg.get(x.dataset.rpre).pre = x.value.trim().slice(0, 4); later(); });
      b.querySelectorAll('[data-rst]').forEach(x => x.oninput = () => { cfg.get(x.dataset.rst).st = hw(x.value).replace(/[^0-9]/g, '').slice(0, 4); later(); });
      b.querySelector('[data-rgo]').onclick = async () => {
        const r = await api('mp_ops_renum_kind', { p_route: D.id, p_map: map(), p_as: S.as, p_dry: false });
        if (r) { toast(T(`運用番号を ${r.n}つ つけなおしました`)); m.close(); reload(); }
      };
    });
  };
  draw(); quote();
}
/* ---------- 運転整理（DB の更新100）：列車ごと・まとめて「○○駅で打ち切り」「延長運転（同じ系統の先の駅まで）」「途中から運転」「始発を延ばす」「臨時停車」「通過」「時刻をずらす」「運休」。
   毎日（ふだんのダイヤの列車を変える）か、日をきめて（31日まで・60日先まで・曜日も）。日をきめた分は、その日だけ走る「運転整理の列車」になり、もとの列車は その日は走らない ---------- */
const ORD_KS = [['cut', '打ち切り'], ['ext', '延長運転'], ['from', '途中から運転'], ['xfrom', '始発を延ばす'], ['stop', '臨時停車'], ['pass', '通過'], ['shift', '時刻をずらす'], ['x', '運休']];
const ORD_S = { cut: '打ち切る駅', ext: 'のばす先の駅', from: '運転をはじめる駅', xfrom: 'のばす始発駅', stop: '臨時停車する駅', pass: '通過する駅' };
const ORD_H = { cut: 'えらんだ駅を終着にします（その先は走りません）',
  ext: '同じ系統の先の駅まで走ります。のばした区間は、種別の停車駅のパターンで止まります（パターンがなければ各駅に停車）',
  from: 'えらんだ駅から走ります（その駅を出る時刻は、いまの時刻表のまま）',
  xfrom: '手前の駅から走ります。いまの始発駅は、いまの時刻に出ます。のばした区間は、種別の停車駅のパターンで止まります',
  stop: '通過している駅に止まります', pass: '止まっている駅を通過します',
  shift: '始発駅を出る時刻を ずらします（採時駅の時刻も いっしょに）', x: 'えらんだ日は走りません（運賃も入りません）' };
const ORD_NO = { cut: 'とちゅうの駅がありません', from: 'とちゅうの駅がありません', ext: 'この列車は系統の端まで走っています（先の駅がありません）',
  xfrom: 'この列車は系統の端から走っています（手前の駅がありません）', stop: '通過している駅がありません', pass: '止まる とちゅうの駅がありません' };
const ORD_WD = ['日', '月', '火', '水', '木', '金', '土'];
const wdL = i => { const x = T(ORD_WD[i] + '曜'); return /曜$/.test(x) ? ORD_WD[i] : x; };   // 曜日の短い名前（日本語は 1字）
// 指示のことば（サーバーの _mp_ord_txt と同じ）
function ordTxt(D, a) {
  const sn = id => { const s = (D.stops || []).find(x => x.id === id); return s ? s.name : '?'; };
  switch (a && a.k) {
    case 'cut': return T(`${sn(a.s)} で打ち切り`);
    case 'ext': return T(`${sn(a.s)} まで延長運転`);
    case 'from': return T(`${sn(a.s)} から運転`);
    case 'xfrom': return T(`${sn(a.s)} から運転（始発を延ばす）`);
    case 'stop': return T(`${sn(a.s)} に臨時停車`);
    case 'pass': return T(`${sn(a.s)} を通過`);
    case 'shift': return T(`時刻を ${Math.abs(a.m)}分 ${a.m > 0 ? 'くり下げ' : 'くり上げ'}`);
    case 'x': return T('運休');
  }
  return '';
}
const ordJ = (D, t) => (t.ordj || []).map(a => ordTxt(D, a)).join('・');
const mdW = d => { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? T(`${Number(m[1])}月${Number(m[2])}日（${ORD_WD[new Date(d + 'T00:00:00Z').getUTCDay()]}）`) : ''; };   // 12月24日（水）
// 列車の走る区間：走る順の駅（ord）と、始発（a）・終着（z）が何番目か
function trRange(D, t) {
  const ord = t.dir === -1 ? D.stops.slice().reverse() : D.stops, n = ord.length;
  let a = t.sa ? ord.findIndex(s => s.id === t.sa) : 0, z = -1;
  if (t.sb) for (let i = n - 1; i >= 0; i--) if (ord[i].id === t.sb) { z = i; break; }   // 環状線：終着は うしろのほう
  if (a < 0) a = 0; if (z < 0 || z <= a) z = n - 1;
  return { ord, a, z };
}
// 運転整理をする：o = { t }（1本）か null（まとめて：毎日の列車を しぼる）。done：決めたあと
function ordEdit(D, o, done) {
  const t = o && o.t, fixDay = t && t.day ? t.day : null;   // 臨時列車・運転整理の列車は その日だけ
  const unit = D.kind === 'ship' || D.kind === 'air' ? '便' : '列車';
  const uniq = []; for (const s of D.stops) if (!uniq.some(x => x.id === s.id)) uniq.push(s);   // 環状線：はじめの駅は1つ
  const st = { k: 'cut', s: null, m: 10, every: false, d0: fixDay || D.today, d1: fixDay || D.today, dow: new Set([0, 1, 2, 3, 4, 5, 6]),
               dir: 0, kinds: new Set(), t0: '', t1: '', via: null, res: null };
  const kinds = [...new Set(D.trains.filter(x => !x.day).map(x => x.kind))];
  const m = modal(['運転整理', ''], null);
  const stas = () => {   // えらべる駅（1本のときは、その列車の走る区間から）
    if (!t) return uniq;
    const { ord, a, z } = trRange(D, t), skip = new Set(t.skip || []), mid = ord.slice(a + 1, z);
    return st.k === 'cut' || st.k === 'from' ? mid : st.k === 'ext' ? ord.slice(z + 1) : st.k === 'xfrom' ? ord.slice(0, a)
      : st.k === 'stop' ? mid.filter(s => skip.has(s.id)) : st.k === 'pass' ? mid.filter(s => !skip.has(s.id)) : [];
  };
  const days = () => { const out = []; if (fixDay) return [fixDay]; for (let d = st.d0; d <= st.d1 && out.length < 62; d = dayAdd(d, 1)) if (st.dow.has(new Date(d + 'T00:00:00Z').getUTCDay())) out.push(d); return out; };
  const pick = () => {   // まとめて：あてはまる毎日の列車（サーバーと同じしぼりかた）
    if (t) return [t];
    const t0 = parseHM(st.t0), t1 = parseHM(st.t1);
    return D.trains.filter(x => !x.day && !x.orig && (!st.dir || x.dir === st.dir) && (!st.kinds.size || st.kinds.has(x.kind)) && (t0 == null || x.dep >= t0) && (t1 == null || x.dep <= t1)
      && (!st.via || (() => { const { ord, a, z } = trRange(D, x), i = ord.findIndex(s => s.id === st.via); return i >= a && i <= z; })()));
  };
  const draw = () => {
    const needS = !!ORD_S[st.k], ks = stas(), ds = days(), L = pick(), canEvery = !fixDay && st.k !== 'x';
    if (!canEvery) st.every = false;
    if (needS && !ks.some(s => s.id === st.s)) st.s = ks.length ? (st.k === 'xfrom' ? ks[ks.length - 1].id : ks[0].id) : null;
    const nOK = L.length > 0 && (!needS || st.s != null) && (st.k !== 'shift' || (st.m && Math.abs(st.m) <= 180)) && (st.every || (ds.length > 0 && ds.length <= 31 && L.length * ds.length <= 400));
    const r = st.res, when = st.every ? T('毎日') : ds.length === 1 ? mdW(ds[0]) : ds.length ? T(`${mdW(ds[0])}〜${mdW(ds[ds.length - 1])}（${ds.length}日ぶん）`) : '';
    const tr0 = t ? trRange(D, t) : null;
    const resH = !r ? '' : `<div class="mp-item small" style="margin:6px 0"><b>${esc(when)}</b>・<span translate="no">${esc(ordTxt(D, { k: st.k, s: st.s, m: st.m }))}</span>
      ${r.daily ? `<br><span>${esc(T(`毎日の${unit} ${r.daily}本を変えます`))}</span>` : ''}${r.made ? `<br><span>${esc(T(`運転整理の${unit}を ${r.made}本つくります`))}</span>` : ''}
      ${r.upd ? `<br><span>${esc(T(`臨時・運転整理の${unit} ${r.upd}本を変えます`))}</span>` : ''}${r.cx ? `<br><span>${esc(T(`${r.cx}本を運休にします`))}</span>` : ''}
      ${r.ex ? `<br><span>${esc(T('例：'))}</span> <b translate="no">${esc(r.ex.num)}</b> <span translate="no">${esc(r.ex.from)}</span> <span>${hms(r.ex.dep)}</span><span>${esc(T('発'))}</span> → <span translate="no">${esc(r.ex.to)}</span>` : ''}
      ${r.bad1 != null && r.bad1 > r.bad0 ? `<br><span class="mp-warn">${esc(T(`この指示のあと、走れない${unit}が ${r.bad0}本 → ${r.bad1}本 になります（編成のつながりなど。運用を見なおしてください）`))}</span>` : ''}
      ${r.ov1 != null && r.ov1 > r.ov0 ? `<br><span class="mp-warn">${esc(T(`番線で重なる${unit}が ${r.ov0}本 → ${r.ov1}本 になります`))}</span>` : ''}
      ${r.full ? `<br><span class="mp-warn">${esc(T(`1つの系統の${unit}は900本までです（いま ${r.have}本）`))}</span>` : ''}
      ${r.skip ? `<br><span class="${r.n ? 'muted' : 'mp-warn'}">${esc(T(`できない${unit}：${r.skip}本`))}</span><br><small class="muted">${(r.sk || []).slice(0, 6).map(x => `<span translate="no">${esc(x.num)}</span>${x.d ? `<span>（${mdL(x.d)}）</span>` : ''}：<span translate="no">${esc(T(x.w))}</span>`).join('<br>')}${r.skip > 6 ? '<br>…' : ''}</small>` : ''}
      ${!r.n ? `<br><span class="mp-warn">${esc(T(`この指示ができる${unit}がありません`))}</span>` : ''}</div>`;
    m.set(t ? T(`運転整理（${unit} ${t.num}）`) : '運転整理（まとめて）', `
      ${t ? `<p class="small" style="margin-top:0"><b translate="no">${esc(t.num)}</b> <span>${esc(kindL(t.kind))}・${t.dir === 1 ? '下り' : '上り'}・${hms(t.dep)}発</span> <span translate="no">${esc(tr0.ord[tr0.a].name)} → ${esc(tr0.ord[tr0.z].name)}</span>${t.orig ? ` <small class="mp-tag"><span>運転整理</span> <span>${mdL(t.day)}</span></small>` : t.day ? ` <small class="mp-tag"><span>臨時</span> <span>${mdL(t.day)}</span></small>` : ''}</p>`
        : `<h4 style="margin:4px 0">${unit}をえらぶ（毎日の${unit}）</h4>
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">向き</span><span class="mp-seg">${[[0, '両方'], [1, '下り'], [-1, '上り']].map(([v, l]) => `<button data-odir="${v}" class="${st.dir === v ? 'on' : ''}">${l}</button>`).join('')}</span></div>
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">種別</span><span class="mp-seg" style="flex-wrap:wrap"><button data-okd="*" class="${st.kinds.size ? '' : 'on'}">すべて</button>${kinds.map(k => `<button data-okd="${esc(k)}" class="${st.kinds.has(k) ? 'on' : ''}">${esc(kindL(k))}</button>`).join('')}</span></div>
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">発車</span><input class="mp-inp mp-num" data-ot0 value="${esc(st.t0)}" placeholder="—"><span>〜</span><input class="mp-inp mp-num" data-ot1 value="${esc(st.t1)}" placeholder="—"><span class="muted">${esc(T('（始発駅を出る時刻。空はぜんぶ）'))}</span></div>
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">通る駅</span><select class="mp-inp" style="flex:1 1 140px" data-ovia><option value="">${esc(T('（どこでも）'))}</option>${uniq.map(s => `<option value="${s.id}" ${st.via === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <p class="small" style="margin:0 0 4px"><b>${esc(T(`あてはまる${unit}：${L.length}本`))}</b></p>`}
      <h4 style="margin:10px 0 4px">指示</h4>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">${ORD_KS.map(([k, l], i) => `<button class="btn${st.k === k ? ' main' : ''}" style="text-align:left;justify-content:flex-start" data-okk="${k}"><b>${i + 1}</b>　<span>${l}</span></button>`).join('')}</div>
      ${needS ? (ks.length ? `<div class="mp-row" style="align-items:center"><span>${ORD_S[st.k]}</span><select class="mp-inp" style="flex:1 1 160px" data-os>${ks.map(s => `<option value="${s.id}" ${st.s === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`
        : `<p class="mp-warn small">${esc(T(ORD_NO[st.k]))}</p>`) : ''}
      ${st.k === 'shift' ? `<div class="mp-row" style="align-items:center;flex-wrap:wrap"><span class="mp-seg">${[-10, -5, -1, 1, 5, 10].map(v => `<button data-omv="${v}" class="${st.m === v ? 'on' : ''}">${v > 0 ? '+' : '−'}${Math.abs(v)}</button>`).join('')}</span>
        <input class="mp-inp mp-num" type="number" data-om value="${st.m}" min="-180" max="180" step="1"><span class="small">${esc(T('分（＋ はくり下げ・− はくり上げ）'))}</span></div>` : ''}
      <p class="muted small" style="margin:2px 0 6px">${esc(T(ORD_H[st.k]))}</p>
      <h4 style="margin:10px 0 4px">走る日</h4>
      ${fixDay ? `<p class="small" style="margin:0"><span>${esc(mdW(fixDay))}</span> <span>${t.orig ? 'だけ（この運転整理の列車の日）' : 'だけ（臨時列車の日）'}</span></p>` : `
        <div class="mp-row" style="align-items:center"><span class="mp-seg"><button data-oev="0" class="${st.every ? '' : 'on'}">日をきめて</button><button data-oev="1" class="${st.every ? 'on' : ''}" ${canEvery ? '' : 'disabled'}>毎日（ふだんのダイヤを変える）</button></span></div>
        ${st.every ? `<p class="small muted" style="margin:0 0 4px">${esc(T(`ふだんのダイヤの${unit}そのものを変えます（日をきめた運転整理は そのまま）`))}</p>` : `
        <div class="mp-row" style="align-items:center"><input class="mp-inp" style="width:auto" type="date" data-od0 value="${esc(st.d0)}" min="${esc(D.today)}" max="${esc(dayAdd(D.today, 60))}"><span>〜</span>
          <input class="mp-inp" style="width:auto" type="date" data-od1 value="${esc(st.d1)}" min="${esc(D.today)}" max="${esc(dayAdd(D.today, 60))}"></div>
        <div class="mp-row small" style="align-items:center;flex-wrap:wrap"><span class="mp-seg">${ORD_WD.map((w, i) => `<button data-owd="${i}" translate="no" class="${st.dow.has(i) ? 'on' : ''}">${esc(wdL(i))}</button>`).join('')}</span>
          <span>${esc(T(`えらんだ日：${ds.length}日`))}</span>${ds.length > 31 ? `<span class="mp-warn">${esc(T('（31日まで）'))}</span>` : ''}</div>`}`}
      <p class="small" style="margin:6px 0">${st.every ? esc(T(`毎日の${unit} ${L.length}本`)) : esc(T(`${L.length}本 × ${ds.length}日`))}${!st.every && L.length * ds.length > 400 ? ` <span class="mp-warn">${esc(T('（一度に 400本・日 まで）'))}</span>` : ''}</p>
      <div data-ores>${resH}</div>
      <div class="mp-row"><button class="btn" data-odry ${nOK ? '' : 'disabled'}>見つもる</button><button class="btn main" data-ogo ${nOK && r && r.n > 0 && !r.full ? '' : 'disabled'}>この指示をする</button></div>
      <p class="muted small">${esc(T(`日をきめた指示は、その日だけ走る「運転整理の${unit}」になります（もとの${unit}は、その日は走りません）。ダイヤの「運転整理」で見る・消すことができます。「↶ 取り消す」でも もどせます`))}</p>`, b => {
      const q = k => b.querySelector(k);
      const keep = () => {
        if (q('[data-ot0]')) { st.t0 = q('[data-ot0]').value; st.t1 = q('[data-ot1]').value; }
        if (q('[data-ovia]')) st.via = Number(q('[data-ovia]').value) || null;
        if (q('[data-od0]')) { st.d0 = q('[data-od0]').value || st.d0; st.d1 = q('[data-od1]').value || st.d1; if (st.d1 < st.d0) st.d1 = st.d0; }
        if (q('[data-om]')) st.m = Math.max(-180, Math.min(180, Math.round(Number(q('[data-om]').value) || 0)));
        if (q('[data-os]')) st.s = Number(q('[data-os]').value) || null;
      };
      const re = () => { keep(); st.res = null; draw(); };
      b.querySelectorAll('[data-okk]').forEach(x => x.onclick = () => { keep(); st.k = x.dataset.okk; st.s = null; st.res = null; draw(); });
      b.querySelectorAll('[data-odir]').forEach(x => x.onclick = () => { keep(); st.dir = Number(x.dataset.odir); st.res = null; draw(); });
      b.querySelectorAll('[data-okd]').forEach(x => x.onclick = () => { keep(); const v = x.dataset.okd; if (v === '*') st.kinds.clear(); else if (st.kinds.has(v)) st.kinds.delete(v); else st.kinds.add(v); st.res = null; draw(); });
      b.querySelectorAll('[data-omv]').forEach(x => x.onclick = () => { keep(); st.m = Number(x.dataset.omv); st.res = null; draw(); });
      b.querySelectorAll('[data-oev]').forEach(x => x.onclick = () => { keep(); st.every = x.dataset.oev === '1'; st.res = null; draw(); });
      b.querySelectorAll('[data-owd]').forEach(x => x.onclick = () => { keep(); const i = Number(x.dataset.owd); if (st.dow.has(i)) { if (st.dow.size > 1) st.dow.delete(i); } else st.dow.add(i); st.res = null; draw(); });
      ['[data-ot0]', '[data-ot1]', '[data-ovia]', '[data-od0]', '[data-od1]', '[data-om]', '[data-os]'].forEach(k => { const e = q(k); if (e) e.onchange = re; });
      const args = dry => ({ p_route: D.id, p_trains: t ? [t.id] : null,
        p_flt: t ? null : { dir: st.dir || null, kinds: [...st.kinds], t0: parseHM(st.t0), t1: parseHM(st.t1), via: st.via },
        p_act: { k: st.k, s: ORD_S[st.k] ? st.s : null, m: st.k === 'shift' ? st.m : null },
        p_days: st.every ? null : { d0: fixDay || st.d0, d1: fixDay || st.d1, dow: fixDay || st.dow.size === 7 ? null : [...st.dow] }, p_dry: dry, p_as: S.as });
      q('[data-odry]').onclick = async () => { keep(); const r2 = await api('mp_dia_order', args(true)); if (r2) { st.res = r2; draw(); } };
      q('[data-ogo]').onclick = async () => {
        keep(); const r2 = await api('mp_dia_order', args(false)); if (!r2) return;
        toast(T(`運転整理をしました（${r2.n}本）`) + (r2.bad1 > r2.bad0 ? SEP() + T(`走れない${unit} ${r2.bad1}本`) : ''));
        m.close(); runListStale(); if (done) done();
      };
    });
  };
  draw();
}
// ダイヤの「運転整理」：日をきめた運転整理（運転整理の列車・運休）を日ごとに。開く・消す
function ordPane(pane, D, load, openT) {
  const today = D.today, byDay = new Map(), add = (d, x) => { if (d < today) return; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(x); };
  for (const t of D.trains) {
    if (t.orig) add(t.day, { v: t });
    for (const c of t.ordd || []) if (c[1] === 'x') add(c[0], { x: t, cid: c[2] });
  }
  const unit = D.kind === 'ship' || D.kind === 'air' ? '便' : '列車';
  const dd = [...byDay.keys()].sort(), sortK = x => (x.v || x.x).dep;
  pane.innerHTML = `<div class="mp-row"><button class="btn main" data-ordn>✂ 運転整理をする（まとめて）</button></div>
    <p class="muted small" style="margin:4px 0 8px">${esc(T(`列車をタップして開くと、その${unit}だけの運転整理もできます。日をきめた運転整理は、その日だけ もとの${unit}のかわりに走ります（運休は走りません）`))}</p>
    ${dd.length ? dd.map(d => `<h4 style="margin:10px 0 4px;display:flex;align-items:center;gap:8px"><span>${esc(mdW(d))}</span><small class="muted">${esc(T(`${byDay.get(d).length}件`))}</small>
        <button class="btn" style="margin-left:auto;flex:none;padding:2px 10px;font-size:12px" data-ordd="${d}">この日をぜんぶ消す</button></h4>
      <div class="mp-list">${byDay.get(d).sort((a, b) => sortK(a) - sortK(b)).map(x => { const tr = x.v || x.x, rg = trRange(D, tr);
        return `<div class="mp-item small" style="display:flex;align-items:center;gap:6px;text-align:left"><span style="flex:1"><b translate="no">${esc(tr.num)}</b> <span>${esc(kindL(tr.kind))}・${tr.dir === 1 ? '下り' : '上り'}・${hms(tr.dep)}発</span>
          ${x.v ? `<span translate="no">${esc(rg.ord[rg.a].name)} → ${esc(rg.ord[rg.z].name)}</span><br><span translate="no">✂ ${esc(ordJ(D, tr))}</span>${tr.bad ? ' <small class="mp-warn">走れない</small>' : tr.warn ? ` <small class="mp-warn">${esc(T('注意があります'))}</small>` : ''}`
            : `<br><b class="mp-late">運休</b>`}</span>
          ${x.v ? `<button class="btn" style="flex:none" data-ordo="${tr.id}">開く</button>` : ''}<button class="btn" style="flex:none" data-ordx="${x.v ? 'v' + tr.id : 'x' + x.cid}">消す</button></div>`; }).join('')}</div>`).join('')
      : `<p class="muted small">${esc(T('日をきめた運転整理は、まだありません'))}</p>`}`;
  const del = async (vs, xs, n) => {
    if (!await confirm2(T(`運転整理を ${n}件 消しますか？（もとの${unit}が その日も走ります）`), { what: T(`${n}件`), q: '本当に消しますか？', ok: '消す', note: '消したあとでも「↶ 取り消す」でもどせます。' })) return;
    if (await api('mp_dia_order_del', { p_route: D.id, p_trains: vs, p_cxl: xs, p_as: S.as }, T(`${n}件 消しました`))) { runListStale(); load(); }
  };
  pane.querySelector('[data-ordn]').onclick = () => ordEdit(D, null, load);
  pane.querySelectorAll('[data-ordo]').forEach(x => x.onclick = () => openT(D.trains.find(t => t.id === Number(x.dataset.ordo))));
  pane.querySelectorAll('[data-ordx]').forEach(x => x.onclick = () => { const v = x.dataset.ordx; del(v[0] === 'v' ? [Number(v.slice(1))] : [], v[0] === 'x' ? [Number(v.slice(1))] : [], 1); });
  pane.querySelectorAll('[data-ordd]').forEach(x => x.onclick = () => { const L = byDay.get(x.dataset.ordd) || []; del(L.filter(y => y.v).map(y => y.v.id), L.filter(y => y.x).map(y => y.cid), L.length); });
}
async function autoForm(D, reload) {
  // 種別ごと（DB の更新97）：保存してある えらびかた も いっしょに読む（まだのサーバーでは null）
  const GRP = 'agrp' in D;   // あてる先ごと（DB の更新106）
  const [cl, kf] = await Promise.all([api('mp_cars_list', { p_as: S.as }), GRP ? call('mp_train_autoform_g', { p_route: D.id, p_groups: null, p_as: S.as, p_dry: true }).catch(() => null)
    : call('mp_train_autoform_k', { p_route: D.id, p_map: null, p_as: S.as, p_dry: true }).catch(() => null)]);
  if (!cl) return;
  const forms = cl.forms.filter(f => fKind(f) === D.kind);
  if (!forms.length) return toast(D.kind === 'air' ? '飛行機がありません（≡ →「車両と編成」で空港をえらんで注文してください）' : D.kind === 'ship' ? '船がありません（≡ →「車両と編成」で港をえらんで注文してください）' : '編成がありません（車両と編成で組んでください）');
  const pick = new Set();   // はじめは何もえらばない（2026-10-29。絞りこんでから「表示中をぜんぶえらぶ」かタップで）
  // わりあてる列車（2026-10-29）：種別でえらぶ（毎日の列車。臨時列車はそのまま）。えらばなかった種別の列車はいまのまま
  const daily = D.trains.filter(t => !t.day);
  const ko = k => { const x = (D.kinds || []).find(y => y.name === k); return x ? x.prio * 100 + (KINDS.indexOf(k) + 1) : 999; };   // 優先番号の順
  const kinds = [...new Set(daily.map(t => t.kind))].sort((a, b) => ko(a) - ko(b) || a.localeCompare(b, 'ja'));
  const ks = new Set(kinds);
  // 編成の絞りこみ：両数（台数）・形式。表示中をぜんぶえらぶ・ぜんぶはずす
  const counted = D.kind === 'rail' || D.kind === 'bus', unit = D.kind === 'bus' ? '台' : '両', fu = D.kind === 'ship' ? '隻' : D.kind === 'air' ? '機' : '編成';
  const serN = c => ((S.boot && S.boot.series) || []).find(x => x.code === c)?.name || c || '';
  const ns = [...new Set(forms.map(f => f.perf.n))].sort((a, b) => a - b), sers = [...new Set(forms.map(f => f.perf.series || ''))].filter(Boolean).sort();
  let fn = null, fsr = null, fpw = null;   // fpw：電化方式（DB の更新104）
  const fPw = f => pwCls(!!(f.perf && f.perf.elec), (f.perf && f.perf.ps) || 0), pwsF = PW_O.filter(k => k && forms.some(f => fPw(f) === k));
  // 種別ごと（DB の更新97）：種別 → えらんだ編成。前に保存した えらびかた（いまもある、この系統で使える編成だけ・1つの編成は1つの種別だけ）
  const fid = new Set(forms.map(f => f.id)), kmap = new Map(kinds.map(k => [k, new Set()])), saved = (kf && kf.kform) || {};
  for (const k of kinds) for (const id of saved[k] || []) if (fid.has(id) && ![...kmap.values()].some(z => z.has(id))) kmap.get(k).add(id);
  let mode = kinds.length > 1 && [...kmap.values()].some(z => z.size) ? 'kind' : 'all', ek = null;   // mode：all いっしょに・kind 種別ごと。ek：編成をえらんでいる種別
  // あてる先ごと（DB の更新106）：あてる先 [{n, k, z, d, t0, t1, pw, f}]。保存した あてる先 → 種別ごとの えらびかた → 種別ごとに1つずつ
  const G = GRP ? autoGrp(D, daily, kinds, forms, kf, kmap) : null;
  if (GRP && G.list.some(g => g.f.size)) mode = 'grp';
  const m = modal(['運用を自動で組む', '']);
  const elsewhere = f => f.trains > D.trains.filter(t => t.form === f.id).length;   // ほかの系統の列車にも入っている編成（「ぜんぶえらぶ」ではえらばない）
  const fLabel = f => `${D.kind === 'ship' || D.kind === 'air' ? `便${f.trains}本` : D.kind === 'bus' ? `${f.perf.n}台・列車${f.trains}本` : `${f.perf.n}両・列車${f.trains}本`}`;
  const filters = () => `${counted && ns.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>${unit === '台' ? '台数' : '両数'}</span><span class="mp-seg" style="flex-wrap:wrap"><button data-an="" class="${fn == null ? 'on' : ''}">すべて</button>${ns.map(n => `<button data-an="${n}" class="${fn === n ? 'on' : ''}">${T(`${n}${unit}`)}</button>`).join('')}</span></div>` : ''}
      ${sers.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>形式</span><span class="mp-seg" style="flex-wrap:wrap"><button data-as="" class="${fsr == null ? 'on' : ''}">すべて</button>${sers.map(c => `<button data-as="${esc(c)}" class="${fsr === c ? 'on' : ''}"><span translate="no">${esc(serN(c))}</span></button>`).join('')}</span></div>` : ''}
      ${D.kind === 'rail' && pwsF.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>電化</span><span class="mp-seg" style="flex-wrap:wrap"><button data-ap="" class="${fpw == null ? 'on' : ''}">すべて</button>${pwsF.map(c => `<button data-ap="${c}" class="${fpw === c ? 'on' : ''}"><span>${PW_L[c]}</span><small>（${forms.filter(f => fPw(f) === c).length}）</small></button>`).join('')}</span></div>` : ''}`;
  const modeRow = () => GRP ? `<div class="mp-row small" style="align-items:center"><span>使う編成</span><span class="mp-seg"><button data-mode="all" class="${mode === 'all' ? 'on' : ''}">いっしょに</button><button data-mode="grp" class="${mode === 'grp' ? 'on' : ''}">あてる先ごとに</button></span></div>`
    : kinds.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>使う編成</span><span class="mp-seg"><button data-mode="all" class="${mode === 'all' ? 'on' : ''}">いっしょに</button><button data-mode="kind" class="${mode === 'kind' ? 'on' : ''}">種別ごとに</button></span></div>` : '';
  const bindCommon = b => {
    b.querySelectorAll('[data-mode]').forEach(x => x.onclick = () => { mode = x.dataset.mode; ek = null; draw(); });
    b.querySelectorAll('[data-an]').forEach(x => x.onclick = () => { fn = x.dataset.an === '' ? null : Number(x.dataset.an); draw(); });
    b.querySelectorAll('[data-as]').forEach(x => x.onclick = () => { fsr = x.dataset.as === '' ? null : x.dataset.as; draw(); });
    b.querySelectorAll('[data-ap]').forEach(x => x.onclick = () => { fpw = x.dataset.ap === '' ? null : x.dataset.ap; draw(); });
  };
  const done = r => { if (r) { toast(T(`${r.ok}本にわりあてました（${r.used}編成）`) + (r.none ? SEP() + T(`・${r.none}本は編成が足りません`) : '') + (r.busy ? SEP() + T(mode === 'grp' ? `・${r.busy}編成は わりあてなおさない列車に入っているので使いませんでした` : `・${r.busy}編成はほかの種別の列車に入っているので使いませんでした`) : '')); m.close(); reload(); } };
  // 種別ごと：まとめて わりあてる（まだのサーバー＝DB の更新97の前 では、種別ごとに順に。えらびかたの保存はなし）
  const runKind = async () => {
    const mp = {}; for (const [k, z] of kmap) if (z.size) mp[k] = [...z];
    if (kf) return done(await api('mp_train_autoform_k', { p_route: D.id, p_map: mp, p_as: S.as, p_dry: false }));
    const kk = Object.keys(mp); let sum = { ok: 0, none: 0, used: 0, busy: 0 };
    for (let i = 0; i < kk.length; i++) {
      toast(T(`わりあてています…（${i + 1}/${kk.length}）`));
      const r = await api('mp_train_autoform', { p_route: D.id, p_forms: mp[kk[i]], p_as: S.as, p_kinds: [kk[i]] }); if (!r) { m.close(); return reload(); }
      sum = { ok: sum.ok + r.ok, none: sum.none + r.none, used: r.used, busy: sum.busy + r.busy };
    }
    done(sum);
  };
  const draw = () => {
    const vis = forms.filter(f => (fn == null || f.perf.n === fn) && (fsr == null || f.perf.series === fsr) && (fpw == null || fPw(f) === fpw));
    if (mode === 'grp') return G.draw(m, { modeRow, filters, bindCommon, vis, fLabel, elsewhere, fu, done, redraw: draw });   // あてる先ごと（DB の更新106）
    if (mode === 'kind' && ek == null) {   // 種別ごと：種別の一覧
      const on = kinds.filter(k => kmap.get(k).size), busyF = daily.some(t => !kmap.get(t.kind).size && t.form);
      const nm = id => (forms.find(f => f.id === id) || {}).name || id;
      m.set('運用を自動で組む', `<p class="small" style="margin-top:0">種別ごとに使う編成をえらんで、その種別の列車にわりあてます（始発駅にいて、2分前にあいている編成）</p>
        ${modeRow()}
        <div class="mp-list">${kinds.map(k => { const z = [...kmap.get(k)]; return `<div class="mp-item"><div class="mp-row" style="align-items:center;margin:0">
            <b style="flex:1 1 auto">${kindSw(kindCol(D, k))}<span>${esc(kindL(k))}</span> <small class="muted">（${daily.filter(t => t.kind === k).length}本）</small><br><small class="muted" style="font-weight:400">${esc(pnLine(D, { k }))}</small></b>
            <button class="btn ${z.length ? '' : 'main'}" data-kedit="${esc(k)}">${z.length ? '編成を変える' : '編成をえらぶ'}</button></div>
            <small>${z.length ? `<span>${z.length}${fu}えらんでいます</span>：<span translate="no">${z.slice(0, 8).map(id => esc(nm(id))).join('・')}${z.length > 8 ? '…' : ''}</span>` : '<span class="muted">えらんでいません（この種別の列車は、いまのまま）</span>'}</small></div>`; }).join('')}</div>
        <div class="mp-row"><button class="btn main" data-okk ${on.length ? '' : 'disabled'}>わりあてる</button></div>
        <p class="muted small"><span>1つの編成は1つの種別だけで使います。</span>${busyF ? SEP() + '<span>編成をえらんでいない種別の列車に入っている編成は使いません。</span>' : ''}${kf ? SEP() + '<span>えらびかたは この系統に保存して、次にひらいたときに出します。</span>' : ''}</p>`, b => {
        bindCommon(b);
        b.querySelectorAll('[data-kedit]').forEach(x => x.onclick = () => { ek = x.dataset.kedit; draw(); });
        b.querySelector('[data-okk]').onclick = () => runKind();
      });
      return;
    }
    if (mode === 'kind') {   // 種別ごと：その種別の編成をえらぶ
      const z = kmap.get(ek), other = id => kinds.find(k => k !== ek && kmap.get(k).has(id));
      const busyF = new Set(daily.filter(t => t.kind !== ek && !kmap.get(t.kind).size && t.form).map(t => t.form));   // 編成をえらんでいない種別の列車に入っている編成
      const can = f => !other(f.id) && !busyF.has(f.id);
      m.set('運用を自動で組む', `<p class="small" style="margin-top:0"><b><span>${esc(kindL(ek))}</span></b>（<span>${daily.filter(t => t.kind === ek).length}本</span>）<br><span>この種別の列車に使う編成をえらんでください</span></p>
        ${filters()}
        <div class="mp-row small" style="align-items:center"><button class="btn" data-aall ${vis.some(f => can(f) && !elsewhere(f) && !z.has(f.id)) ? '' : 'disabled'}>表示中をぜんぶえらぶ</button><button class="btn" data-anone ${z.size ? '' : 'disabled'}>ぜんぶはずす</button><b><span>${z.size}${fu}えらんでいます</span></b></div>
        <div class="mp-cars">${vis.map(f => { const o = other(f.id); return `<span class="mp-car ${z.has(f.id) ? 'on' : ''}" data-f="${f.id}"${!can(f) ? ' style="opacity:.55"' : ''}>${esc(f.name)}<span class="n">${fLabel(f)}${o ? `<br><span>${esc(kindL(o))}にえらんだ</span>` : busyF.has(f.id) ? '<br><span>ほかの種別で使用中</span>' : elsewhere(f) ? '<br><span>ほかの系統で使用中</span>' : ''}</span></span>`; }).join('') || '<p class="muted small">この絞りこみにあう編成はありません</p>'}</div>
        <div class="mp-row"><button class="btn main" data-kback>決める</button></div>
        <p class="muted small"><span>ほかの種別にえらんだ編成と、編成をえらんでいない種別の列車に入っている編成は、えらべません。</span>${SEP()}<span>「表示中をぜんぶえらぶ」では、ほかの系統で使用中の編成はえらびません（えらぶときはタップ）。</span></p>`, b => {
        bindCommon(b);
        b.querySelector('[data-aall]').onclick = () => { for (const f of vis) if (can(f) && !elsewhere(f)) z.add(f.id); draw(); };
        b.querySelector('[data-anone]').onclick = () => { z.clear(); draw(); };
        b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => {
          const id = Number(x.dataset.f), f = forms.find(y => y.id === id), o = other(id);
          if (!f || !can(f)) return toast(o ? T(`${kindL(o)}にえらんでいます（そちらで はずすと、えらべます）`) : T('ほかの種別の列車に入っています（その種別でも編成をえらぶと、えらべます）'));
          if (z.has(id)) z.delete(id); else z.add(id); draw();
        });
        b.querySelector('[data-kback]').onclick = () => { ek = null; draw(); };
      });
      return;
    }
    const nT = daily.filter(t => ks.has(t.kind)).length;
    const allK = ks.size === kinds.length, busyF = new Set(allK ? [] : daily.filter(t => !ks.has(t.kind) && t.form).map(t => t.form));   // えらばなかった種別の列車に入っている編成（使わない）
    m.set('運用を自動で組む', `<p class="small" style="margin-top:0">この系統の列車に、えらんだ編成をわりあてます（始発駅にいて、2分前にあいている編成）</p>
      ${modeRow()}
      <h4 style="margin:8px 0 4px">わりあてる列車</h4>
      ${kinds.length > 1 ? `<div class="mp-row small" style="align-items:center"><span>種別</span><span class="mp-seg" style="flex-wrap:wrap">${kinds.map(k => `<button data-ak="${esc(k)}" class="${ks.has(k) ? 'on' : ''}"><span>${esc(kindL(k))}</span>（${daily.filter(t => t.kind === k).length}）</button>`).join('')}</span></div>` : ''}
      <p class="small muted" style="margin:2px 0"><span>${nT}本の列車をわりあてなおします</span>${allK ? '' : SEP() + '<span>（えらばなかった種別の列車は、いまのまま）</span>'}</p>
      <h4 style="margin:10px 0 4px">使う編成</h4>
      ${filters()}
      <div class="mp-row small" style="align-items:center"><button class="btn" data-aall ${vis.some(f => !busyF.has(f.id) && !elsewhere(f)) ? '' : 'disabled'}>表示中をぜんぶえらぶ</button><button class="btn" data-anone ${pick.size ? '' : 'disabled'}>ぜんぶはずす</button><b><span>${pick.size}${fu}えらんでいます</span></b></div>
      <div class="mp-cars">${vis.map(f => `<span class="mp-car ${pick.has(f.id) ? 'on' : ''}" data-f="${f.id}"${busyF.has(f.id) ? ' style="opacity:.55"' : ''}>${esc(f.name)}<span class="n">${fLabel(f)}${busyF.has(f.id) ? '<br><span>ほかの種別で使用中</span>' : elsewhere(f) ? '<br><span>ほかの系統で使用中</span>' : ''}</span></span>`).join('') || '<p class="muted small">この絞りこみにあう編成はありません</p>'}</div>
      <div class="mp-row"><button class="btn main" data-ok ${nT && pick.size ? '' : 'disabled'}>わりあてる</button></div>
      <p class="muted small"><span>「表示中をぜんぶえらぶ」では、ほかの系統で使用中の編成はえらびません（えらぶときはタップ）。</span>${allK ? '' : SEP() + '<span>えらばなかった種別の列車に入っている編成は使いません（種別ごとに、ちがう編成をわりあてるとき）。</span>'}${kinds.length > 1 ? SEP() + '<span>種別ごとに ちがう編成を まとめて わりあてるときは「種別ごとに」。</span>' : ''}</p>`, b => {
      bindCommon(b);
      b.querySelectorAll('[data-ak]').forEach(x => x.onclick = () => { const k = x.dataset.ak; if (ks.has(k)) { if (ks.size > 1) ks.delete(k); } else ks.add(k); draw(); });
      b.querySelector('[data-aall]').onclick = () => { for (const f of vis) if (!busyF.has(f.id) && !elsewhere(f)) pick.add(f.id); draw(); };
      b.querySelector('[data-anone]').onclick = () => { pick.clear(); draw(); };
      b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => { const id = Number(x.dataset.f); if (pick.has(id)) pick.delete(id); else pick.add(id); draw(); });
      b.querySelector('[data-ok]').onclick = async () => done(await api('mp_train_autoform', { p_route: D.id, p_forms: [...pick], p_as: S.as, p_kinds: allK ? null : [...ks] }));
    });
  };
  draw();
}

/* ---------- 運用を自動で組む：あてる先ごと（DB の更新106）。あてる先 = 種別・区間・向き・時間帯・走る線の電化で決める 毎日の列車のまとまり。
   列車は 上から順に 最初にあてはまる あてる先に入る。あてる先ごとに 使う編成をえらぶ（1つの編成は1つの あてる先だけ） ---------- */
const LPW_L = [[0, 'すべて'], [1, '直流の区間だけ'], [2, '交流の区間だけ'], [3, '直流と交流の両方'], [4, '非電化の区間がある']];
function autoGrp(D, daily, kinds, forms, kf, kmap) {
  const fid = new Set(forms.map(f => f.id));
  const mk = o => ({ n: o.n || '', k: new Set(o.k || []), z: new Set(o.z || []), d: o.d || 0, t0: o.t0 == null ? null : o.t0, t1: o.t1 == null ? null : o.t1, pw: o.pw || 0,
                     f: new Set((o.f || []).filter(id => fid.has(id))) });
  let list = (kf && Array.isArray(kf.agrp) && kf.agrp.length) ? kf.agrp.map(mk)
    : [...kmap.entries()].filter(([, z]) => z.size).map(([k, z]) => mk({ k: [k], f: [...z] }));
  if (!list.length) list = kinds.map(k => mk({ k: [k] }));
  for (const g of list) for (const id of [...g.f]) if (list.some(h => h !== g && h.f.has(id) && list.indexOf(h) < list.indexOf(g))) g.f.delete(id);   // 1つの編成は1つだけ
  const stN = id => (D.stops.find(x => String(x.id) === String(id)) || {}).name || '';
  const secOf = t => { const sc = t.sched || []; return sc.length > 1 ? sc[0][0] + '>' + sc[sc.length - 1][0] : ''; };
  const secL = k => { if (!k) return '—'; const [a, z] = k.split('>'); return stN(a) + ' → ' + stN(z); };
  const ftOf = t => t.sched && t.sched[0] && t.sched[0][2] != null ? t.sched[0][2] : t.dep;
  const pwOk = (pw, lp) => !pw ? true : pw === 1 ? lp === 1 : pw === 2 ? lp === 2 : pw === 3 ? (lp & 3) === 3 : pw === 4 ? !!(lp & 4) : true;
  const match = (g, t) => (!g.k.size || g.k.has(t.kind)) && (!g.z.size || g.z.has(secOf(t))) && (!g.d || g.d === t.dir)
    && (g.t0 == null || ftOf(t) >= g.t0) && (g.t1 == null || ftOf(t) < g.t1) && pwOk(g.pw, t.lpw || 0);
  const grpOf = t => list.findIndex(g => match(g, t));
  const secs = (() => { const c = new Map(); for (const t of daily) { const k = secOf(t); if (k) c.set(k, (c.get(k) || 0) + 1); } return [...c.keys()].sort((a, b) => c.get(b) - c.get(a)); })();
  const lps = new Set(daily.map(t => t.lpw || 0));
  const hm = v => v == null ? '' : String(Math.floor(v / 3600)).padStart(2, '0') + ':' + String(Math.floor(v / 60) % 60).padStart(2, '0');
  // あてる先の まとめ（HTML。ことばごとに span：訳せるように。駅の名前は訳さない）
  const sum = g => [g.k.size ? [...g.k].map(k => `<span>${esc(kindL(k))}</span>`).join('・') : '<span>すべての種別</span>',
    g.z.size ? `<span translate="no">${esc([...g.z].map(secL).slice(0, 2).join('・') + (g.z.size > 2 ? '…' : ''))}</span>` : '',
    g.d ? `<span>${g.d === 1 ? '下り' : '上り'}</span>` : '', g.t0 != null || g.t1 != null ? `<span translate="no">${hm(g.t0) || '0:00'}〜${hm(g.t1) || '24:00'}</span>` : '',
    g.pw ? `<span>${LPW_L[g.pw][1]}</span>` : ''].filter(Boolean).join('／');
  // 走れるか：交流の区間には 交流・交直流（か 非電化の車）、直流の区間には 直流・交直流（か 非電化の車）、非電化の区間には 非電化の車
  const fPw = f => pwCls(!!(f.perf && f.perf.elec), (f.perf && f.perf.ps) || 0);
  const fOk = (f, lp) => { const c = fPw(f); if (lp & 4) return c === 'n'; if ((lp & 1) && !(c === 'd' || c === 'x' || c === 'n')) return false; if ((lp & 2) && !(c === 'a' || c === 'x' || c === 'n')) return false; return true; };
  let eg = null, sub = null;   // eg：えらんでいる あてる先・sub：cond（条件）か forms（編成）
  const st = () => {   // いまの あてる先：列車の数・わりあてなおさない列車（あてる先に入らない・編成をえらんでいない あてる先）・その編成（使えない）
    const by = list.map(() => []), keep = [];
    for (const t of daily) { const i = grpOf(t); if (i >= 0 && list[i].f.size) by[i].push(t); else { if (i >= 0) by[i].push(t); keep.push(t); } }
    const busy = new Set(keep.filter(t => t.form).map(t => t.form));
    return { by, keep, busy };
  };
  const draw = (m, c) => {
    const S2 = st(), nm = id => (forms.find(f => f.id === id) || {}).name || id;
    if (eg == null) {   // あてる先の一覧
      const on = list.some((g, i) => g.f.size && S2.by[i].length);
      m.set('運用を自動で組む', `<p class="small" style="margin-top:0"><span>あてる先（種別・区間・向き・時間帯・走る線の電化で決める 列車のまとまり）ごとに 使う編成をえらんで、わりあてます（始発駅にいて、2分前にあいている編成）。列車は 上から順に 最初にあてはまる あてる先に入ります。</span></p>
        ${c.modeRow()}
        <div class="mp-list">${list.map((g, i) => { const z = [...g.f], lp = S2.by[i].reduce((a, t) => a | (t.lpw || 0), 0), bad = z.filter(id => { const f = forms.find(y => y.id === id); return f && !fOk(f, lp); }).length;
          return `<div class="mp-item"><div class="mp-row" style="align-items:center;margin:0;gap:4px">
            <b style="flex:1 1 auto"><span>${i + 1}.</span> ${g.n ? `<span translate="no">${esc(g.n)}</span>：` : ''}${sum(g)} <small class="muted">（<span>${S2.by[i].length}本</span>）</small></b>
            <button class="btn" style="flex:none;padding:2px 8px" data-gup="${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn" style="flex:none;padding:2px 8px" data-gx="${i}">×</button></div>
            <div class="mp-row small" style="margin:2px 0"><button class="btn" data-gc="${i}">条件</button><button class="btn ${z.length ? '' : 'main'}" data-gf="${i}">${z.length ? '編成を変える' : '編成をえらぶ'}</button></div>
            <small>${z.length ? `<span>${z.length}${c.fu}えらんでいます</span>：<span translate="no">${z.slice(0, 6).map(id => esc(nm(id))).join('・')}${z.length > 6 ? '…' : ''}</span>${bad ? `<br><span class="mp-warn">${esc(T(`走れない区間のある編成が ${bad}${c.fu}`))}</span>` : ''}`
              : '<span class="muted">えらんでいません（この あてる先の列車は、いまのまま）</span>'}</small></div>`; }).join('')}</div>
        <div class="mp-row"><button class="btn" data-gadd ${list.length >= 20 ? 'disabled' : ''}>＋ あてる先を足す</button></div>
        <p class="small muted" style="margin:2px 0">${S2.keep.length ? `<span>${esc(T(`わりあてなおさない列車 ${S2.keep.length}本（いまのまま）`))}</span>${S2.busy.size ? SEP() + `<span>${esc(T(`その列車の編成 ${S2.busy.size}${c.fu}は使いません`))}</span>` : ''}` : `<span>${esc(T('すべての毎日の列車を わりあてなおします'))}</span>`}</p>
        <div class="mp-row"><button class="btn main" data-gok ${on ? '' : 'disabled'}>わりあてる</button></div>
        <p class="muted small"><span>1つの編成は1つの あてる先だけで使います。あてる先は この系統に保存して、次にひらいたときに出します。</span></p>`, b => {
        c.bindCommon(b);
        b.querySelectorAll('[data-gup]').forEach(x => x.onclick = () => { const i = Number(x.dataset.gup); if (i > 0) { const a = list[i - 1]; list[i - 1] = list[i]; list[i] = a; } c.redraw(); });
        b.querySelectorAll('[data-gx]').forEach(x => x.onclick = () => { list.splice(Number(x.dataset.gx), 1); c.redraw(); });
        b.querySelectorAll('[data-gc]').forEach(x => x.onclick = () => { eg = Number(x.dataset.gc); sub = 'cond'; c.redraw(); });
        b.querySelectorAll('[data-gf]').forEach(x => x.onclick = () => { eg = Number(x.dataset.gf); sub = 'forms'; c.redraw(); });
        b.querySelector('[data-gadd]').onclick = () => { list.push(mk({})); eg = list.length - 1; sub = 'cond'; c.redraw(); };
        b.querySelector('[data-gok]').onclick = async () => {
          const groups = list.map(g => ({ n: g.n, k: [...g.k], z: [...g.z], d: g.d, t0: g.t0, t1: g.t1, pw: g.pw, f: [...g.f] }));
          c.done(await api('mp_train_autoform_g', { p_route: D.id, p_groups: groups, p_as: S.as, p_dry: false }));
        };
      });
      return;
    }
    const g = list[eg];
    if (sub === 'cond') {   // 条件
      const mine = daily.filter(t => match(g, t)).length, got = S2.by[eg].length;
      const secsK = [...new Set([...g.z, ...secs.filter(k => !g.k.size || daily.some(t => g.k.has(t.kind) && secOf(t) === k))])];   // えらんだ種別の列車が走る区間（えらんだ区間はのこす）
      const chips = (attr, items, label) => items.map(v => `<button data-${attr}="${esc(String(v))}" class="${g[attr === 'ck' ? 'k' : 'z'].has(v) ? 'on' : ''}">${label(v)}</button>`).join('');
      m.set('あてる先の条件', `<div class="mp-row"><input class="mp-inp" data-gn value="${esc(g.n)}" maxlength="20" placeholder="${esc(T('名前（なくてもよい）'))}"></div>
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">種別</span><span class="mp-seg" style="flex-wrap:wrap"><button data-ck="*" class="${g.k.size ? '' : 'on'}">すべて</button>${chips('ck', kinds, k => `${kindSw(kindCol(D, k))}<span>${esc(kindL(k))}</span>`)}</span></div>
        ${secsK.length > 1 || g.z.size ? `<div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">区間</span><span class="mp-seg" style="flex-wrap:wrap"><button data-cz="*" class="${g.z.size ? '' : 'on'}">すべて</button>${chips('cz', secsK.slice(0, 24), k => `<span translate="no">${esc(secL(k))}</span><small>（${daily.filter(t => secOf(t) === k && (!g.k.size || g.k.has(t.kind))).length}）</small>`)}</span></div>` : ''}
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">向き</span><span class="mp-seg">${[[0, 'すべて'], [1, '下り'], [-1, '上り']].map(([v, l]) => `<button data-cd="${v}" class="${g.d === v ? 'on' : ''}">${l}</button>`).join('')}</span></div>
        <div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">時間帯</span><span>始発を出る</span><input class="mp-inp mp-num" style="width:5em" data-ct0 value="${hm(g.t0)}" placeholder="0:00"><span>〜</span><input class="mp-inp mp-num" style="width:5em" data-ct1 value="${hm(g.t1)}" placeholder="24:00"></div>
        ${lps.size > 1 || g.pw ? `<div class="mp-row small" style="align-items:center"><span style="min-width:3.5em">電化</span><span class="mp-seg" style="flex-wrap:wrap">${LPW_L.map(([v, l]) => `<button data-cp="${v}" class="${g.pw === v ? 'on' : ''}">${l}</button>`).join('')}</span></div>` : ''}
        <p class="small" style="margin:4px 0"><b>${esc(T(`あてはまる列車 ${mine}本`))}</b>${got !== mine ? `<span>${esc(T(`（この あてる先に入るのは ${got}本。上の あてる先が先にとります）`))}</span>` : ''}</p>
        <div class="mp-row"><button class="btn main" data-cok>決める</button></div>
        <p class="muted small"><span>えらばない条件は「すべて」です。時間帯は 始発駅を出る時刻（はじめの時刻から、おわりの時刻の前まで）。電化は 列車が走る線の電化です。</span></p>`, b => {
        const tog = (set, v) => { if (v === '*') set.clear(); else if (set.has(v)) set.delete(v); else set.add(v); c.redraw(); };
        b.querySelector('[data-gn]').onchange = e => { g.n = e.target.value.trim().slice(0, 20); };
        b.querySelectorAll('[data-ck]').forEach(x => x.onclick = () => tog(g.k, x.dataset.ck));
        b.querySelectorAll('[data-cz]').forEach(x => x.onclick = () => tog(g.z, x.dataset.cz));
        b.querySelectorAll('[data-cd]').forEach(x => x.onclick = () => { g.d = Number(x.dataset.cd); c.redraw(); });
        b.querySelectorAll('[data-cp]').forEach(x => x.onclick = () => { g.pw = Number(x.dataset.cp); c.redraw(); });
        const tm = v => { const t = String(hw(v)).trim(); if (!t) return null; const p = parseHM(t); return p == null || !Number.isFinite(p) ? null : Math.max(0, Math.min(86400, p)); };
        b.querySelector('[data-ct0]').onchange = e => { g.t0 = tm(e.target.value); c.redraw(); };
        b.querySelector('[data-ct1]').onchange = e => { g.t1 = tm(e.target.value); if (g.t1 === 0) g.t1 = null; c.redraw(); };
        b.querySelector('[data-cok]').onclick = () => { const n = b.querySelector('[data-gn]'); if (n) g.n = n.value.trim().slice(0, 20); eg = null; sub = null; c.redraw(); };
      });
      return;
    }
    // 編成をえらぶ
    const z = g.f, other = id => list.findIndex(h => h !== g && h.f.has(id)), lp = S2.by[eg].reduce((a, t) => a | (t.lpw || 0), 0);
    const can = f => other(f.id) < 0 && !S2.busy.has(f.id) && fOk(f, lp);
    m.set('運用を自動で組む', `<p class="small" style="margin-top:0"><b>${eg + 1}. ${g.n ? `<span translate="no">${esc(g.n)}</span>：` : ''}${sum(g)}</b>（<span>${S2.by[eg].length}本</span>）<br><span>この あてる先の列車に使う編成をえらんでください</span></p>
      ${c.filters()}
      <div class="mp-row small" style="align-items:center"><button class="btn" data-aall ${c.vis.some(f => can(f) && !c.elsewhere(f) && !z.has(f.id)) ? '' : 'disabled'}>表示中をぜんぶえらぶ</button><button class="btn" data-anone ${z.size ? '' : 'disabled'}>ぜんぶはずす</button><b><span>${z.size}${c.fu}えらんでいます</span></b></div>
      <div class="mp-cars">${c.vis.map(f => { const o = other(f.id); return `<span class="mp-car ${z.has(f.id) ? 'on' : ''}" data-f="${f.id}"${!can(f) && !z.has(f.id) ? ' style="opacity:.55"' : ''}>${esc(f.name)}<span class="n">${c.fLabel(f)}${o >= 0 ? `<br><span>${esc(T(`${o + 1}つめの あてる先にえらんだ`))}</span>` : S2.busy.has(f.id) ? '<br><span>わりあてなおさない列車で使用中</span>' : !fOk(f, lp) ? '<br><span>走れない区間がある</span>' : c.elsewhere(f) ? '<br><span>ほかの系統で使用中</span>' : ''}</span></span>`; }).join('')}</div>
      <div class="mp-row"><button class="btn main" data-gback>決める</button></div>
      <p class="muted small"><span>ほかの あてる先にえらんだ編成・わりあてなおさない列車に入っている編成・走れない区間（電化）がある編成は、えらべません。</span>${SEP()}<span>「表示中をぜんぶえらぶ」では、ほかの系統で使用中の編成はえらびません（えらぶときはタップ）。</span></p>`, b => {
      c.bindCommon(b);
      b.querySelector('[data-aall]').onclick = () => { for (const f of c.vis) if (can(f) && !c.elsewhere(f)) z.add(f.id); c.redraw(); };
      b.querySelector('[data-anone]').onclick = () => { z.clear(); c.redraw(); };
      b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => {
        const id = Number(x.dataset.f), f = forms.find(y => y.id === id);
        if (z.has(id)) { z.delete(id); return c.redraw(); }
        if (!f) return;
        const o = other(id);
        if (o >= 0) return toast(T(`${o + 1}つめの あてる先にえらんでいます（そちらで はずすと、えらべます）`));
        if (S2.busy.has(id)) return toast(T('わりあてなおさない列車に入っています（その列車も あてる先に入れると、えらべます）'));
        if (!fOk(f, lp)) return toast(T('この あてる先には、走れない区間（電化）があります'));
        z.add(id); c.redraw();
      });
      b.querySelector('[data-gback]').onclick = () => { eg = null; sub = null; c.redraw(); };
    });
  };
  return { list, draw };
}

/* ---- 運用：運用番号・編成・列車の数。運用ファイル（JSON）の書き出し・読みこみ ---- */
function saveJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const ymd = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
// 線路をさがす（2026-10-29）：自分の線路と、自分の系統が通る線路のうち、非電化・単線のところ。地図で見る
async function openSegFind() {
  const m = modal(['線路をさがす', '<p class="muted small">読みこんでいます…</p>']);
  const L = await api('mp_seg_find', { p_as: S.as }); if (!L) return m.close();
  if (!S.layer.track) { S.layer.track = true; const b = S.wrap.querySelector('[data-lay="track"]'); if (b) b.classList.add('on'); S.dirty = true; }
  let f = 'all';
  const ok = (x, k) => k === 'all' || (k === 'el' ? !x.el : !x.dbl);
  const draw = () => m.set('線路をさがす', `<p class="small" style="margin-top:0">${esc(asName())}</p>
    <div class="mp-row small"><span class="mp-seg">${[['all', 'すべて'], ['el', '非電化'], ['sg', '単線']].map(([k, t]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}"><span>${t}</span>（${L.filter(x => ok(x, k)).length}）</button>`).join('')}</span></div>
    <div class="mp-list">${L.filter(x => ok(x, f)).map(x => `<div class="mp-item"><b>${x.n ? `<span translate="no">${esc(x.n)}</span>` : '<span>（名前なし）</span>'}</b>
        <small class="muted"><span>${fmt(x.len)} m</span>・<span>${x.dbl ? '複線' : '単線'}</span>・<span>${x.el ? '電化' : '非電化'}</span>${x.mine ? '' : `・<span translate="no">${esc(x.own)}</span><span>の線路</span>`}</small>
        ${x.routes.length ? `<br><small><span>通る系統</span>：<span translate="no">${x.routes.map(esc).join('・')}</span></small>` : ''}
        <div class="mp-row small" style="margin-bottom:0"><button class="btn" data-go="${x.id}">地図で見る</button></div></div>`).join('') || '<p class="muted small">非電化・単線のところはありません</p>'}</div>
    <p class="muted small">地図では、非電化はオレンジ、単線はむらさきの点線で出ます（上の「非電化・単線」で切りかえ）。線路をタップすると、複線・電化にできます（自分の線路）</p>`, b => {
    b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => { f = x.dataset.f; draw(); });
    b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => {
      const it = L.find(y => y.id === Number(x.dataset.go)); if (!it) return;
      const [x0, y0, x1, y1] = it.bb, z = clamp(Math.min(S.W / Math.max(1, x1 - x0 + 6), S.H / Math.max(1, y1 - y0 + 6)), 1.5, 24);
      m.close(); setCam((x0 + x1) / 2, (y0 + y1) / 2, z); S.sel = { kind: 'seg', id: it.id }; S.dirty = true;
    });
  });
  draw();
}
// 運用のバックアップ（2026-10-29）：いまの運用をのこす（新しい10こまで）・その時にもどす・消す
async function opsBackup(reload) {
  const m = modal(['運用のバックアップ', '<p class="muted small">読みこんでいます…</p>']);
  let L = await api('mp_op_backup_list', { p_as: S.as }); if (!L) return m.close();
  const draw = () => m.set('運用のバックアップ', `<p class="small" style="margin-top:0">${esc(asName())}</p>
    <div class="mp-row"><button class="btn main" data-bsave>いまの運用をバックアップする</button></div>
    <div class="mp-list">${L.map(x => `<div class="mp-item"><b>${jdt(x.at)}</b>${x.label ? ` <span>${esc(x.label)}</span>` : ''}<br><small class="muted"><span>運用 ${x.nops}つ・列車 ${x.ntr}本</span></small>
        <div class="mp-row small" style="margin-bottom:0"><button class="btn" data-bres="${x.id}">この時にもどす</button><button class="btn" data-bdel="${x.id}">消す</button></div></div>`).join('') || '<p class="muted small">まだありません</p>'}</div>
    <p class="muted small">新しい10こまでのこります（古いものから消えます）。もどすと、運用（運用番号・編成・メモ）と、列車の運用・連結が、そのときにもどります。バックアップのあとにつくった運用は消えます。列車の時刻は変わりません。もどす前の運用も、自動でバックアップします</p>`, b => {
      b.querySelector('[data-bsave]').onclick = async () => {
        const lbl = prompt(T('バックアップの名前（なくてもよい）'), ''); if (lbl === null) return;
        const r = await api('mp_op_backup_save', { p_label: lbl, p_as: S.as }, 'バックアップしました'); if (r) { L = r.list; draw(); }
      };
      b.querySelectorAll('[data-bres]').forEach(x => x.onclick = async () => {
        const it = L.find(y => y.id === Number(x.dataset.bres)); if (!it) return;
        if (!confirm(T(`${jdt(it.at)} の運用にもどしますか？（運用 ${it.nops}つ・列車 ${it.ntr}本。いまの運用は、自動でバックアップします）`))) return;
        const r = await api('mp_op_backup_restore', { p_id: it.id, p_as: S.as });
        if (r) { toast(T(`もどしました（運用 ${r.ops}つ・列車 ${r.trains}本）`)); L = r.list; draw(); if (reload) reload(); }
      });
      b.querySelectorAll('[data-bdel]').forEach(x => x.onclick = async () => {
        if (!await confirm2(T('このバックアップを消しますか？'))) return;
        const r = await api('mp_op_backup_del', { p_id: Number(x.dataset.bdel), p_as: S.as }, '消しました'); if (r) { L = r; draw(); }
      });
    });
  draw();
}
async function openOps() {
  const m = modal(['運用', '<p class="muted small">読みこんでいます…</p>'], null, 'mp-wide');
  let D = null, kind = 'rail', flt = 'all', KD = null;
  const sel = new Set(), kf = new Set();   // まとめて消す・編集する運用（2026-10-28）・種別で しぼりこむ（DB の更新104：o.ks）
  const load = async () => { const [d, kd] = await Promise.all([api('mp_ops_list', { p_as: S.as }), KD ? null : call('mp_kinds_list', { p_as: S.as }).catch(() => null)]); D = d; if (kd) KD = { kinds: kd };
    if (!D) return m.close(); for (const id of [...sel]) if (!D.ops.some(o => o.id === id)) sel.delete(id); draw(); };
  // 絞りこみ：走れない列車がある・注意がある・編成なし・列車なし
  const FLT = [['all', 'すべて', () => true], ['bad', '走れない列車あり', o => o.bad > 0], ['warn', '注意あり', o => o.warn > 0], ['noform', '編成なし', o => !o.form], ['empty', '列車なし', o => !o.trains]];
  const exportOps = async (ids, name) => { const r = await api('mp_op_export', { p_ops: ids, p_as: S.as }); if (r) { saveJson(name, r); toast('書き出しました'); } };
  const draw = () => {
    const LK = D.ops.filter(o => o.kind === kind), fx = (FLT.find(f => f[0] === flt) || FLT[0])[2], forms = D.forms.filter(f => fKind(f) === kind);
    const KS = [...new Set(LK.flatMap(o => o.ks || []))].sort((a, b) => (KINDS.indexOf(a) + 1 || 99) - (KINDS.indexOf(b) + 1 || 99) || a.localeCompare(b, 'ja'));
    for (const k of [...kf]) if (!KS.includes(k)) kf.delete(k);
    const L = LK.filter(fx).filter(o => !kf.size || (o.ks || []).some(k => kf.has(k)));
    const nsel = LK.filter(o => sel.has(o.id)).length;
    m.set('運用', `<p class="small" style="margin:0">${esc(asName())}</p>
      <div class="tabs-s" style="margin-top:6px">${[['rail', '鉄道'], ['bus', 'バス'], ['ship', '船'], ['air', '飛行機']].map(t => `<button data-kind="${t[0]}" class="${kind === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>
      <div class="mp-row small" style="align-items:center"><span class="mp-seg" style="flex-wrap:wrap">${FLT.map(f => `<button data-flt="${f[0]}" class="${flt === f[0] ? 'on' : ''}"><span>${f[1]}</span>${f[0] === 'all' ? '' : `（${LK.filter(f[2]).length}）`}</button>`).join('')}</span></div>
      ${KS.length > 1 ? `<div class="mp-row small" style="align-items:center"><span style="min-width:3em">種別</span><span class="mp-seg" style="flex-wrap:wrap"><button data-okf="*" class="${kf.size ? '' : 'on'}">すべて</button>${KS.map(k => `<button data-okf="${esc(k)}" class="${kf.has(k) ? 'on' : ''}">${kindSw(kindCol(KD, k))}<span>${esc(kindL(k))}</span>（${LK.filter(o => (o.ks || []).includes(k)).length}）</button>`).join('')}</span></div>` : ''}
      <div class="mp-row small" style="align-items:center"><button class="btn" data-sall ${L.length ? '' : 'disabled'}>表示中をぜんぶえらぶ</button>${nsel ? `<button class="btn" data-snone>えらぶのをやめる</button><b><span>${nsel}つ えらんでいます</span></b>
        <button class="btn main" data-bedit>まとめて編集</button><button class="btn" data-bex>書き出す</button><button class="btn" data-bdel>まとめて消す</button>` : '<span class="muted">運用の左の □ でえらぶと、まとめて消す・編集できます</span>'}</div>
      <div class="mp-list" style="margin-top:8px">${L.map(o => `<div class="mp-item">
          <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-sel="${o.id}" ${sel.has(o.id) ? 'checked' : ''}><b>${esc(o.num)}</b></label> ${(o.ks || []).map(k => `<small style="white-space:nowrap">${kindSw(kindCol(KD, k))}<span>${esc(kindL(k))}</span></small>`).join(' ')} <small class="muted"><span>列車 ${o.trains}本</span>${o.daily !== o.trains ? `<span>（臨時 ${o.trains - o.daily}本）</span>` : ''}${o.cpl ? `<span>・連結 ${o.cpl}本</span>` : ''}${o.first != null ? `<span>・${hms(o.first)}〜${hms(o.last)}</span>` : ''}${o.routes.length ? `<span>・</span><span>${o.routes.map(esc).join('・')}</span>` : ''}</small>
          ${o.bad ? `<small class="mp-warn">・<span>走れない列車 ${o.bad}本</span></small>` : ''}${o.warn ? `<small class="mp-warn">・<span>注意 ${o.warn}本</span></small>` : ''}${o.note ? `<br><small>${esc(o.note)}</small>` : ''}
          <div class="mp-row small" style="align-items:center"><span>編成</span><select class="mp-inp" style="flex:1 1 140px" data-of="${o.id}"><option value="">（入れない）</option>${forms.map(f => `<option value="${f.id}" ${o.form === f.id ? 'selected' : ''} ${f.ok ? '' : 'disabled'}>${esc(T(f.op && f.op !== o.num ? (kind === 'ship' || kind === 'air' ? `${f.name}・いまは運用 ${f.op}` : kind === 'bus' ? `${f.name}（${f.perf.n}台）・いまは運用 ${f.op}` : `${f.name}（${f.perf.n}両）・いまは運用 ${f.op}`) : kind === 'ship' || kind === 'air' ? f.name : kind === 'bus' ? `${f.name}（${f.perf.n}台）` : `${f.name}（${f.perf.n}両）`))}</option>`).join('')}</select>
            <button class="btn" data-oren="${o.id}">運用番号</button><button class="btn" data-oex="${o.id}">書き出す</button><button class="btn" data-odel="${o.id}">消す</button></div></div>`).join('')
        || (LK.length ? '<p class="muted small">この絞りこみにあう運用はありません</p>' : '<p class="muted small">まだありません。「＋ 運用」でつくるか、系統の「運用を自動で組む」でつくれます</p>')}</div>
      <div class="mp-row"><button class="btn main" data-onew>＋ 運用</button><button class="btn" data-oall>ぜんぶ書き出す</button><button class="btn" data-oimp>ファイルを読みこむ</button><button class="btn" data-obk>バックアップ</button><button class="btn" data-odall ${LK.length ? '' : 'disabled'}>ぜんぶ消す</button>
        <input type="file" accept=".json,application/json" data-ofile hidden></div>
      <p class="muted small">列車は運用に入れ、運用に編成を入れます。編成を変えると、その運用の列車ぜんぶの編成が変わります（ほかの運用に入っていた編成は、そちらからはずれます）。運用ファイル（JSON）を読みこむと、ファイルにある運用の列車が、ファイルの列車に入れかわります${D.free ? `<span>（運用に入っていない列車 ${D.free}本）</span>` : ''}</p>`, b => {
      b.querySelectorAll('[data-kind]').forEach(x => x.onclick = () => { kind = x.dataset.kind; draw(); });
      b.querySelectorAll('[data-flt]').forEach(x => x.onclick = () => { flt = x.dataset.flt; draw(); });
      b.querySelectorAll('[data-okf]').forEach(x => x.onclick = () => { const v = x.dataset.okf; if (v === '*') kf.clear(); else if (kf.has(v)) kf.delete(v); else kf.add(v); draw(); });
      b.querySelectorAll('[data-sel]').forEach(x => x.onchange = () => { const id = Number(x.dataset.sel); if (x.checked) sel.add(id); else sel.delete(id); draw(); });
      b.querySelector('[data-sall]').onclick = () => { for (const o of L) sel.add(o.id); draw(); };
      { const e = b.querySelector('[data-snone]'); if (e) e.onclick = () => { for (const o of LK) sel.delete(o.id); draw(); }; }
      const ids = () => LK.filter(o => sel.has(o.id)).map(o => o.id);
      { const e = b.querySelector('[data-bex]'); if (e) e.onclick = () => exportOps(ids(), `運用_${ids().length}_${ymd()}.json`); }
      { const e = b.querySelector('[data-bdel]'); if (e) e.onclick = async () => {
        const n = ids().length; if (!await confirm2(T(`えらんだ運用 ${n}つ を消しますか？（列車は消えずに、運用なし・編成なしになります）`), { what: `運用 ${n}つ`, note: '列車は消えずに、運用なし・編成なしになります。' })) return;
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
        if (await confirm2(T(`運用 ${o.num} を消しますか？（列車は消えずに、運用なし・編成なしになります）`), { what: `運用 ${o.num}`, note: '列車は消えずに、運用なし・編成なしになります。' }) && await api('mp_op_del', { p_id: o.id, p_as: S.as }, '消しました')) load();
      });
      b.querySelector('[data-onew]').onclick = async () => {
        const nm = prompt(T('新しい運用の運用番号（例：A01）'), ''); if (!nm) return;
        if (await api('mp_op_save', { p_id: null, p_num: nm, p_form: null, p_note: '', p_kind: kind, p_as: S.as }, '運用をつくりました')) load();
      };
      b.querySelector('[data-oall]').onclick = () => exportOps(null, `運用_ぜんぶ_${ymd()}.json`);
      b.querySelector('[data-obk]').onclick = () => opsBackup(load);
      // ぜんぶ消す（2026-10-29）：いまのタブ（鉄道・バス・船・飛行機）の運用をぜんぶ。列車は消えずに、運用なし・編成なしになる。500ずつ
      b.querySelector('[data-odall]').onclick = async () => {
        const all = LK.map(o => o.id), kl = { rail: '鉄道', bus: 'バス', ship: '船', air: '飛行機' }[kind] || '';
        if (!all.length || !await confirm2(T(`${kl}の運用 ${all.length}つ を、ぜんぶ消しますか？（列車は消えずに、運用なし・編成なしになります。消す前の運用は自動でバックアップするので、「バックアップ」からもどせます）`), { what: `${kl}の運用 ${all.length}つ`, q: '本当に ぜんぶ消しますか？', ok: 'ぜんぶ消す', note: '「バックアップ」から もどせます。' })) return;
        if (!await api('mp_op_backup_save', { p_label: 'ぜんぶ消す前（自動）', p_as: S.as })) return;   // 消す前に、自動でバックアップ
        let n = 0;
        for (let i = 0; i < all.length; i += 500) { const r = await api('mp_ops_bulk', { p_ids: all.slice(i, i + 500), p_act: 'del', p_arg: {}, p_as: S.as }); if (!r) break; n += r.n; }
        if (n) toast(T(`運用を ${n}つ 消しました`)); sel.clear(); load();
      };
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
        if (!await confirm2(T('乗り入れをやめます。持ち主の線路・駅を使う系統は走れなくなります。よろしいですか？'), { q: '本当に乗り入れをやめますか？', ok: 'やめる', note: 'もう一度 乗り入れるには、申請からやりなおしです。' })) return;
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
  tuition: '授業料', fee: '施設の売上', goods: '仕入れ・材料', ship: '運送費', ferry: 'フェリーの運賃（トラック）', slot: '発着口', rwy: '滑走路の工事', jm: '役所の手数料', snow: '雪の対策', snow_sub: '雪の補助金' };
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
    <h4 style="margin:10px 0 4px">🏇 競馬場（国）</h4><div data-trk><p class="muted small">読みこんでいます…</p></div>
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
    trkAdminFill(b.querySelector('[data-trk]'), m);   // 競馬場（DB の更新92）
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
        ${r[1].gen ? `<small class="muted">（もとは ${esc(r[1].gen)}）</small>` : ''}${r[1].zip ? ` <small class="muted" translate="no">〒${esc(zipFmt(r[1].zip))}</small>` : ''} <button class="btn" style="padding:2px 8px" data-ren="${i}">名前を変える</button>
        ${r[1].ro !== undefined && r[2] !== 'cho' && r[0] !== '島' ? `<br><small translate="no">${r[1].ro ? `${esc(r[1].ro)}（${esc(r[1].yomi || '')}）` : '<span class="muted">読み：まだ</span>'}</small> <button class="btn" style="padding:2px 8px" data-yomi="${i}">読み</button>` : ''}</span>`).join('')}</div>
      ${d.cho ? `<div class="mp-row"><button class="btn" data-split>この${esc(subName || choName)}を分ける</button>
        ${d.sub ? `<button class="btn" data-merge="sub">${esc(subName)}をとなりと合併</button>` : ''}<button class="btn" data-merge="cho">${esc(choName)}をとなりと合併</button></div>` : ''}`, s => {
      s.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => {
        const r = rows[Number(b.dataset.ren)];
        const nm = prompt(r[0] === '島' ? T('島の新しい名前（「島」「岩」までつける）') : T('新しい名前（「県」「市」「区」「郡」などはつけない）'), r[1].name); if (!nm) return;
        if (await api('mp_admin_rename', { p_kind: r[2], p_id: r[1].id, p_name: nm }, '名前を変えました')) { for (const c of S.cells.values()) c.stale = true; show(tx, ty); }
      });
      // 読み（ひらがな）→ ローマ字（DB の更新114）
      s.querySelectorAll('[data-yomi]').forEach(b => b.onclick = async () => {
        const r = rows[Number(b.dataset.yomi)];
        const y = prompt(T('読み（ひらがな。空にすると消します。町を「ちょう」・村を「そん」と読むときは「すずの ちょう」のように空白のあとに）'), r[1].yomi || ''); if (y == null) return;
        const x = await api('mp_admin_yomi', { p_kind: r[2], p_id: r[1].id, p_yomi: y });
        if (x) { toast(x.ro ? T(`ローマ字：${x.ro}`) : T('読みを消しました')); roLoad(true); show(tx, ty); }
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
          if (!await confirm2(T(`「${from.name}」を「${into.name}」に合併します。よろしいですか？`), { what: `「${from.name}」→「${into.name}」`, q: '本当に合併しますか？', ok: '合併する' })) return;
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
      // 5×5：新しい土地もふくむ、あらい絵（下にしく）と、海のマスク（航路さがしで、読んでいないところの海・陸）
      //   サーバーに新しい土地が入るまで（世界がいまの国土の箱のまま）は読まない
      const wd = S.boot && S.boot.world, big = wd && wd.cx0 < -24;
      if (big) for (const m of inf.more || []) { const im = new Image(); im.onload = () => { S.ovMore.push({ img: im, o: m }); S.dirty = true; }; im.src = m.src; }
      if (big && inf.sea) S.seaInfo = inf.sea;
      if (big) S.ovHi = (inf.hi || []).map(o => ({ o, img: null, busy: false, used: 0, bad: 0 }));   // こまかいタイル（t108。近づいたときに読む）
    } catch (e) { console.warn('overview', e); }
  }
  loadCam();
  natLoad();   // 山・湖・峠・岬の名前（t108）
  build(root);
  if (!localStorage.getItem('mp_cam')) setCam(0, 0, 4);
  S.open = true; S.dirty = true;
  requestAnimationFrame(frame);
  clearInterval(S.pollT); S.pollT = setInterval(poll, 15000);
}
function resume() { if (!S.wrap) return; S.open = true; S.dirty = true; resize(); requestAnimationFrame(frame); clearInterval(S.pollT); S.pollT = setInterval(poll, 15000); }
function pause() { if (!S.open) return; S.open = false; clearInterval(S.pollT); if (S.photoOff) S.photoOff(); if (S.wrap) S.wrap.classList.remove('mp-full'); }

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
// 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている%, 1 他人・2 自分, 見た目（1〜10。null は自動）, 向き（0〜345度。null は自動）]（DB の更新103）
function prepBld(a) {
  const b = { id: a[0], parcel: a[1], kind: a[2], floors: a[3], name: a[5] || '', occ: a[6], own: a[7], lk: a[8] || 0, rot: a[9] == null ? null : a[9], sc: a[10] || null, set: new Set() };
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
// 遠くの建物（かんたんな形。t63）：色ごとにまとめた形を、ます目ごとに つくっておく（壁：南・東。屋根は北西にずらす）
function litePaths(items, walls) {
  const flat = new Map(), roof = new Map(), ws = new Map(), we = new Map(), get = (m, k) => { let P = m.get(k); if (!P) m.set(k, P = new Path2D()); return P; };
  for (const b of items) {
    const col = bcol(b.kind), w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (b.f <= 0) { get(flat, col[0]).rect(b.x0, b.y0, w, h); continue; }
    if (!walls) { get(roof, col[0]).rect(b.x0, b.y0, w, h); continue; }
    const [dx, dy] = bldShift(b.f), P = get(ws, col[1]), E = get(we, col[2]);
    P.moveTo(b.x0, b.y1); P.lineTo(b.x1, b.y1); P.lineTo(b.x1 + dx, b.y1 + dy); P.lineTo(b.x0 + dx, b.y1 + dy); P.closePath();
    E.moveTo(b.x1, b.y0); E.lineTo(b.x1, b.y1); E.lineTo(b.x1 + dx, b.y1 + dy); E.lineTo(b.x1 + dx, b.y0 + dy); E.closePath();
    get(roof, col[0]).rect(b.x0 + dx, b.y0 + dy, w, h);
  }
  return { flat: [...flat], roof: [...roof], ws: [...ws], we: [...we] };
}
function drawLite(g, z, v) {
  const L = LITE.LS, walls = S.b25 && z >= q('zw', MQ.d25), mode = walls ? 'w' : 'f';
  const i0 = Math.floor(v.x0 / L), j0 = Math.floor(v.y0 / L), i1 = Math.floor(v.x1 / L), j1 = Math.floor(v.y1 / L);
  worldT(g);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = LITE.cells.get(i + ',' + j); if (!c || !c.items) continue;
    if (!c.paths || c.pm !== mode) { c.paths = litePaths(c.items, walls); c.pm = mode; }
    for (const [col, P] of c.paths.flat) { g.fillStyle = col; g.fill(P); }
    for (const [col, P] of c.paths.ws) { g.fillStyle = col; g.fill(P); }
    for (const [col, P] of c.paths.we) { g.fillStyle = col; g.fill(P); }
    for (const [col, P] of c.paths.roof) { g.fillStyle = col; g.fill(P); }
  }
  screenT(g);
}
// 見えている建物（平らなもの（広場・駐車場・田畑）を先に。あとは北西から＝手前のものをあとで）
function bldsIn(it, v) {
  const bs = [...it.blds.values()].filter(b => b.bb[2] >= v.x0 && b.bb[0] <= v.x1 && b.bb[3] >= v.y0 && b.bb[1] <= v.y1);
  bs.sort((a, b) => ((a.floors > 0) - (b.floors > 0)) || ((a.cy + a.cx * 0.3) - (b.cy + b.cx * 0.3)));
  return bs;
}
// 建物を描く。pass 0：平らなもの（駅のホームより下）・1：高さのあるもの（ホームより上）
function drawBlds(g, bs, z, pass) {
  const walls = S.b25 && z >= q('zw', MQ.d25), selP = S.sel && S.sel.kind === 'cell' ? S.sel.parcel : null;   // 2D のときは壁を描かない（上から見たまま）
  worldT(g);
  for (const b of bs) {
    if ((b.floors > 0) !== (pass === 1)) continue;
    const col = bcol(b.kind);
    if (b.floors <= 0) {   // 田畑・駐車場・広場・グラウンド・緑地・ゴルフ場など（平ら）
      const pat = FLAT_PAT[b.kind] || (pOf(b.kind) || {}).pat, soft = SOFT_PAT.has(pat);
      g.fillStyle = col[0]; g.fill(b.base);
      if (pat && (z >= 9 || (pat === 'keiba' && z >= 4))) flatPat(g, b, z, pat);   // 競馬場は遠くからも（DB の更新92）
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
      if (S.vis && S.vis.attrB && S.vis.attrB.has(b.id)) break;   // アトラクションがある遊園地は、アトラクションの絵（DB の更新91）
      const r = Math.min(0.45, Math.min(x1 - x0, y1 - y0) * 0.18);
      g.strokeStyle = 'rgba(200,60,90,.9)'; g.lineWidth = 2 / z; g.beginPath(); g.arc(b.cx, b.cy, r, 0, Math.PI * 2);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.moveTo(b.cx, b.cy); g.lineTo(b.cx + r * Math.cos(a), b.cy + r * Math.sin(a)); }
      g.stroke(); break; }
    case 'tpark': {                                                                         // テーマパーク（DB の更新91）：園路・木・人
      if (z >= 9) lines(0.8, 'rgba(250,244,228,.95)', Math.max(2, 0.12 * z), true);
      dots((x, y) => hsh(x, y) % 6 === 0, 'rgba(80,150,80,.6)', 0.07);
      dots((x, y) => hsh(x, y) % 19 === 4, 'rgba(240,120,150,.85)', 0.045);
      dots((x, y) => hsh(x, y) % 23 === 7, 'rgba(90,160,230,.85)', 0.045);
      if (!(S.vis && S.vis.attrB && S.vis.attrB.has(b.id))) {   // アトラクションがまだないときは、まん中に観覧車
        const r = Math.min(1, Math.min(x1 - x0, y1 - y0) * 0.12);
        g.strokeStyle = 'rgba(200,60,90,.9)'; g.lineWidth = 2 / z; g.beginPath(); g.arc(b.cx, b.cy, r, 0, Math.PI * 2);
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.moveTo(b.cx, b.cy); g.lineTo(b.cx + r * Math.cos(a), b.cy + r * Math.sin(a)); }
        g.stroke();
      }
      break; }
    case 'keiba': {                                                                         // 競馬場（DB の更新92）：芝（外）・ダート（内）・内馬場の池・スタンド・駐車場・ゴール板
      const W = x1 - x0, H = y1 - y0, hz = W >= H, sd = Math.min(W, H), st = sd * 0.2, mg = sd * 0.05;
      const ox = x0 + mg, oy = y0 + mg, ow = W - 2 * mg - (hz ? 0 : st), oh = H - 2 * mg - (hz ? st : 0), R = Math.min(ow, oh) / 2;
      const oval = k => { g.beginPath(); const w2 = ow - 2 * k, h2 = oh - 2 * k; if (w2 <= 0 || h2 <= 0) return false;
        if (typeof g.roundRect === 'function') g.roundRect(ox + k, oy + k, w2, h2, Math.max(0.01, R - k)); else g.rect(ox + k, oy + k, w2, h2); return true; };
      const tw = Math.min(0.6, R * 0.16), dw = Math.min(0.5, R * 0.13);   // 芝 30m・ダート 25m
      if (oval(0)) { g.fillStyle = '#5f9f52'; g.fill(); }
      if (oval(tw)) { g.fillStyle = '#b98d5e'; g.fill(); }
      if (oval(tw + dw)) { g.fillStyle = '#a9d48f'; g.fill(); }
      const pr = Math.min(ow, oh) * 0.12;   // 内馬場の池
      g.fillStyle = 'rgba(110,170,215,.9)'; g.beginPath(); g.ellipse(ox + ow / 2, oy + oh / 2, hz ? pr * 2 : pr, hz ? pr : pr * 2, 0, 0, Math.PI * 2); g.fill();
      if (z >= 9) { g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.2 / z; for (const k of [0.02, tw, tw + dw]) if (oval(k)) g.stroke(); }   // 白いさく（ラチ）
      // スタンド（ゴール前の直線のそと。横長は下・縦長は右）と、その両よこの駐車場
      const ax = hz ? x0 + W * 0.28 : x1 - st + mg * 0.3, ay = hz ? y1 - st + mg * 0.3 : y0 + H * 0.28, aw = hz ? W * 0.44 : st * 0.6, ah = hz ? st * 0.6 : H * 0.44;
      g.fillStyle = '#9ea3aa'; g.fillRect(ax, ay, aw, ah);
      g.fillStyle = '#7d828a'; if (hz) g.fillRect(ax, ay, aw, ah * 0.35); else g.fillRect(ax + aw * 0.65, ay, aw * 0.35, ah);   // 屋根
      if (z >= 12) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1 / z; g.beginPath();
        for (let k = 1; k < 8; k++) { if (hz) { const yy = ay + ah * 0.35 + ah * 0.65 * k / 8; g.moveTo(ax, yy); g.lineTo(ax + aw, yy); } else { const xx = ax + aw * 0.65 * k / 8; g.moveTo(xx, ay); g.lineTo(xx, ay + ah); } }
        g.stroke(); }
      g.fillStyle = 'rgba(150,150,150,.55)';
      if (hz) { g.fillRect(x0 + W * 0.06, ay, W * 0.18, ah); g.fillRect(x0 + W * 0.76, ay, W * 0.18, ah); } else { g.fillRect(ax, y0 + H * 0.06, aw, H * 0.18); g.fillRect(ax, y0 + H * 0.76, aw, H * 0.18); }
      g.strokeStyle = '#d32f2f'; g.lineWidth = Math.max(2 / z, 0.05); g.beginPath();   // ゴール板
      if (hz) { const gx = x0 + W * 0.62; g.moveTo(gx, oy + oh - tw); g.lineTo(gx, oy + oh); } else { const gy = y0 + H * 0.62; g.moveTo(ox + ow - tw, gy); g.lineTo(ox + ow, gy); }
      g.stroke();
      break; }
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
const bldPt = (b, z) => { const w = S.b25 && z >= q('zw', MQ.d25) && b.floors > 0; return [sx(w ? b.lx : b.cx), sy(w ? b.ly : b.cy)]; };
// 地図記号（t54l）：種類 → 記号。施設（学校・宿泊・医療・娯楽）は施設の用途から。工場は歯車、港はいかり、駐車場は P
const SYM_K = { shrine: 'torii', temple: 'manji', church: 'cross', superonsen: 'onsen', sento: 'onsen', onsenryokan: 'onsen',
  baseball: 'stadium', soccer: 'stadium', arena: 'stadium', athletics: 'stadium', museum: 'museum', artmuseum: 'museum', science: 'museum', umus: 'museum',
  aquarium: 'fish', fishing: 'fish', zoo: 'tree', botanical: 'tree', camp: 'tent', amuse: 'wheel', tpark: 'wheel', golf: 'flag', golfrange: 'flag', ski: 'mount',
  hospital: 'hosp', bighosp: 'hosp', erhosp: 'hosp', uhosp: 'hosp', nursing: 'care', care: 'care', dayserv: 'care', uschool: 'sch',
  gpost: 'post', wardoffice: 'hall', townhall: 'town', police: 'police', firest: 'fire', publib: 'book', civic: 'civic', pgym: 'stadium', cityhosp: 'hosp',   // t58
  cleanfac: 'gear', pwater: 'drop', natmus: 'museum', natart: 'museum', nattheater: 'theater', natstad: 'stadium', keiba: 'horse', kbshop: 'horse',   // 競馬場・場外馬券売り場（DB の更新92）
  postoffice: 'post', cityhall: 'hall', prefhall: 'pref', govhall: 'gov', kantei: 'gov', diet: 'diet', court: 'court', natlib: 'book', milhq: 'mil', thermal: 'power', solar: 'power', wind: 'power', truckterm: 'truck', busterm: 'bus', water: '', garbage: '' };
// 重なったときに先に出すもの（小さいほど先）
const SYM_P = { pref: 0, diet: 0, hall: 0, court: 0, gov: 0, town: 0, police: 1, fire: 1, book: 1, mil: 1, hosp: 1, civic: 3, theater: 4, drop: 6, sch: 2, torii: 3, manji: 3, cross: 3, stadium: 4, museum: 4, wheel: 4, fish: 5, tree: 5, hotel: 5, onsen: 5, mount: 5,
  horse: 4, flag: 6, tent: 6, star: 6, post: 6, clinic: 7, care: 7, power: 8, truck: 8, bus: 8, gear: 9, anchor: 9, P: 10 };
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
    case 'horse': path(() => { g.moveTo(-4.6, -5.5); g.lineTo(-4.6, 0); g.arc(0, 0, 4.6, Math.PI, 0, true); g.lineTo(4.6, -5.5); }, '#7a4a1f', 2.2); break;   // 蹄鉄（競馬場・場外馬券売り場。DB の更新92）
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
    if (b.floors > 0 && S.b25 && S.cam.z >= q('zw', MQ.d25)) { const k = Math.floor((x - b.dx) * 5) + ',' + Math.floor((y - b.dy) * 5); if (b.set.has(k)) return { b, cell: k }; }
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
  shop: { ic: '🛍', who: 'お客さん', cap: '1日に入れる人', pool: '来る見こみ', fee: 'お店の売り上げ', unit: '1人', day: '24時間の売り上げ', lv: '値段の水準', npc: '町のお店', come: '駅の人がお店に来る' },   // 駅ナカのお店（DB の更新109）
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
    const ui0 = FAC_UI[kd.use] || FAC_UI.leisure, ui = kd.kb ? { ...ui0, come: '客が馬券を買う', cap: '1日に入れる人', fee: '手数料', unit: '1人 1日' } : ui0;   // 場外馬券売り場（DB の更新92）
    ft(`<span>${ui.come}</span>`, 'in');
    if (kd.kb) ft('手数料は、レースのある時間に入る（G1 などは多い）', 'in');
    if (ok) ft(`<span>${ui.cap} ${fmt(Math.floor((p.self1 ? (o.fm2 || o.total_m2 / Math.max(1, o.floors || o.f1 || 1)) : o.total_m2) / kd.spp))}人</span>`, 'in');   // 駅直結ビル（DB の更新109）：お店は 1階だけ
    ft(`<span>${ui.fee}</span> <span>${ui.unit}</span> <span>${X(kd.fee)}</span>`);
    if (kd.acc) ft(kd.use === 'school' ? '駅が近いと生徒がふえる' : '駅が近いと客がふえる', 'up');
    if (kd.rs) ft(p.sta ? 'となりの駅の乗り降りする人が来る' : '駅の乗り降りする人も来る', 'up');
    if (p.self1) ft('1階は自分のお店・2階から上はテナントに貸す', 'in');
    if (p.sta) ft('自分の駅のとなり（ホームから 20m 以内）に建てる', 'dn');
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
  lookOn();   // 見た目をえらべるサーバーか（t65）
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
    ${lookOn() ? lookHtml() : ''}
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
    // 見た目（t65）：建てるときは無料でえらべる（はじめは どれかを えらんでおく）。ためし見は 見つもった形（なければ 土地の形）・階数で
    const pCells = () => [...(S.vis && S.vis.parcels.get(P.id) ? S.vis.parcels.get(P.id).cells : [])].map(k => k.split(',').map(Number));
    const lk = lookBind(b, { kind: pr.k, floors: () => Math.max(0, Math.min(st.floors, pr.f1)), id: 0, pick: v => { st.look = v; }, rot: null, pickRot: pr.f1 > 0 ? v => { st.rot = v; } : null,
      cells: () => { if (last && last.cells) { const o = []; for (let i = 0; i + 1 < last.cells.length; i += 2) o.push([last.cells[i], last.cells[i + 1]]); return o; } return pCells(); } });
    // 見つもりは「見つもる」を押してから。形・階数を変えたら、やりなおし
    const changed = () => { ++seq; last = null; go.disabled = true; qv.innerHTML = '<b>見つもり</b><span class="muted small">「見つもる」を押すと、工事費と部屋が出ます</span>'; draw(null); lk.later(); };
    const quote = async () => {
      const my = ++seq; go.disabled = true; qv.innerHTML = '<b>見つもり</b><span class="muted small">見つもり中…</span>';
      const q = await api('mp_bld_quote', { p_parcel: P.id, p_kind: pr.k, p_shape: st.shape, p_floors: st.floors, p_opt: st.opt, p_as: S.as });
      if (my !== seq) return;
      last = q; draw(q); lk.later();
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
      if (r && (st.look || st.rot != null)) await lookSave(r.id, st.look, st.rot, S.as);   // 見た目と向き（t65。建てた直後は無料）
      if (r) { m.close(); refreshP(P); sheet(null); openBld(r.id); }
    };
    sync(); changed(); if (fln) fln.textContent = T(`${st.floors}階`);
  });
}

/* ---- 建物の見た目と向き（t65・DB の更新103）：建てるときに えらぶ（無料）。あとで変えるのは 見た目は外装工事・向きは曳家工事（前からある建物は はじめの1回は無料） ---- */
// サーバーが 103 より前なら出さない（app_ver。わからないときは出す）
function lookOn() {
  if (!window.M3Look) return false;
  if (S.lookDB === undefined) { S.lookDB = null; call('app_ver').then(v => { S.lookDB = !(v && v.db && v.db < 103); S.dbv = v && v.db ? v.db : 0; S.dirty = true; }).catch(() => {}); }
  return S.lookDB !== false;
}
const lookHtml = () => `<div class="mp-look" data-look><div class="mp-row" style="margin:2px 0 0"><b>見た目</b><small class="muted" data-lkn></small></div>
  <canvas width="360" height="220" style="width:100%;max-width:360px;height:auto;display:block;margin:2px auto;border:1px solid var(--line,#ddd);border-radius:10px;background:#dce7ef"></canvas>
  <div class="mp-row" data-lks style="flex-wrap:wrap;gap:4px"></div>
  <div class="mp-row" data-rotrow style="gap:4px;margin-top:4px"><b style="white-space:nowrap">向き</b><button class="btn" data-rl style="padding:3px 8px">⟲ 15°</button><b data-rotv style="min-width:6.5em;text-align:center"></b><button class="btn" data-rr style="padding:3px 8px">15° ⟳</button><button class="btn" data-ra style="padding:3px 8px">道にそろえる</button></div></div>`;
const lookName = n => String(n || '').split('・').map(s => T(s)).join('・');
// 向き（正面の方角。北 0・東 90・南 180・西 270）の名前。null は自動（近くの道のほう）
const ROT_N = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const rotName = r => r == null ? T('自動（道のほう）') : (r % 45 === 0 ? T(ROT_N[r / 45]) + ' ' : '') + r + '°';
// えらぶところ（b の中の [data-look]）。o = { kind, floors(), cells(), id, cur（番号か (数) => 番号）, pick(番号), rot（向き。null は自動）, pickRot(向き) }
//   返り値の later() で ためし見を描きなおす
function lookBind(b, o) {
  const el = b.querySelector('[data-look]'), R = { later() {} };
  if (!el || !window.M3Look) return R;
  const cv = el.querySelector('canvas'), lks = el.querySelector('[data-lks]'), nm = el.querySelector('[data-lkn]'), rv = el.querySelector('[data-rotv]');
  let names = null, cur = 0, tm = 0, rot = o.rot == null ? null : o.rot;
  const paint = () => { if (names) window.M3Look.draw(cv, { kind: o.kind, floors: o.floors(), cells: o.cells(), look: cur, id: o.id, rot }).catch(() => {}); };
  R.later = () => { clearTimeout(tm); tm = setTimeout(paint, 160); };
  const chips = () => {
    lks.innerHTML = names.map((n, i) => `<button class="btn${i + 1 === cur ? ' main' : ''}" data-lk="${i + 1}" style="padding:3px 8px;font-size:12px">${esc(lookName(n))}</button>`).join('');
    lks.querySelectorAll('[data-lk]').forEach(x => x.onclick = () => { cur = Number(x.dataset.lk); o.pick(cur); chips(); paint(); });
    nm.textContent = `${cur} / ${names.length}`;
  };
  // 向き：15度ずつ（右まわり ⟳ は 方角が ふえる）。自動からは 南（道が南のとき）から
  const rows = () => { rv.textContent = rotName(rot); el.querySelector('[data-ra]').classList.toggle('main', rot == null); };
  const turn = d => { rot = (((rot == null ? 180 : rot) + d) % 360 + 360) % 360; if (o.pickRot) o.pickRot(rot); rows(); R.later(); };
  el.querySelector('[data-rl]').onclick = () => turn(-15); el.querySelector('[data-rr]').onclick = () => turn(15);
  el.querySelector('[data-ra]').onclick = () => { rot = null; if (o.pickRot) o.pickRot(null); rows(); R.later(); };
  if (!o.pickRot) el.querySelector('[data-rotrow]').remove(); else rows();
  nm.textContent = T('読みこんでいます…');
  window.M3Look.looks(o.kind).then(ns => {
    names = ns; if (!names || !names.length) { el.remove(); return; }
    const c0 = typeof o.cur === 'function' ? o.cur(names.length) : o.cur;
    cur = c0 >= 1 && c0 <= names.length ? c0 : 1 + Math.floor(Math.random() * names.length);
    o.pick(cur, true); chips(); paint();   // true：はじめの（えらんだのではない）
  }).catch(() => el.remove());
  return R;
}
// 建てた直後に（無料）。古いサーバー（関数がない）なら、つぎから えらぶところを出さない
async function lookSave(bid, look, rot, as) {
  try { await call('mp_bld_look', { p_bld: bid, p_look: look || null, p_rot: rot == null ? null : rot, p_as: as }); return true; }
  catch (e) { if (/mp_bld_look|function|schema cache/i.test(String(e && e.message))) S.lookDB = false; return false; }
}
// 建物の画面の「見た目」と「向き」（look_cost があるのは 103 のサーバー）
const lookRow = d => 'look_cost' in d ? `<b>見た目</b><span><span data-lkname>…</span>${d.look_ok ? ' <button class="btn" data-lkchg style="padding:2px 8px">変える</button>' : ''}</span>
  <b>向き</b><span>${esc(rotName(d.rot))}</span>` : '';
function lookRowBind(b, d, load) {
  const el = b.querySelector('[data-lkname]'); if (!el) return;
  if (!window.M3Look) { el.textContent = d.look ? String(d.look) : T('おまかせ'); return; }
  window.M3Look.looks(d.kind).then(ns => { const i = d.look && d.look <= ns.length ? d.look : window.M3Look.auto(d.id, ns.length); el.textContent = lookName(ns[i - 1] || '') + (d.look ? '' : T('（おまかせ）')); }).catch(() => { el.textContent = '—'; });
  const bt = b.querySelector('[data-lkchg]'); if (bt) bt.onclick = () => lookChange(d, load);
}
function lookChange(d, done) {
  const bb = S.vis && S.vis.blds && S.vis.blds.get(d.id), cells = bb ? [...bb.set].map(k => k.split(',').map(Number)) : null;
  const free = d.style_free != null ? !!d.style_free : (!d.look || d.gov), r0 = d.rot == null ? null : d.rot;
  let pick = 0, upick = false, rot = r0;
  const lch = () => upick && pick !== (d.look || 0), rch = () => rot !== r0, cost = () => free ? 0 : (lch() ? d.look_cost : 0) + (rch() ? d.rot_cost || 0 : 0);
  const m = modal(['見た目と向きを変える', '']);
  m.set('見た目と向きを変える', `${lookHtml()}<p class="small" data-lkc style="margin:4px 0"></p>
    <div class="mp-row"><button class="btn main" data-lkgo>これにする</button></div>
    <p class="muted small" style="margin:4px 0 0"><span>見た目と向きは 3D の地図にあらわれます。</span>${free ? '<span>はじめの1回は無料です。</span>' : '<span>見た目を変えるのは外装工事（建てたときの工事費の10%。いちばん安くて1万 X）、向きを変えるのは曳家工事（30%。いちばん安くて3万 X）です</span>'}</p>`, b => {
    const cl = b.querySelector('[data-lkc]'), go = b.querySelector('[data-lkgo]');
    // 変えたもの（見た目は ボタンを押したときだけ）の 工事費：見た目は外装工事・向きは曳家工事（はじめの1回は無料）
    const line = () => {
      const any = lch() || rch(); go.disabled = !any;
      if (!any) { cl.innerHTML = T('いまの見た目と向きです'); return; }
      if (free) { cl.innerHTML = T('はじめの1回は無料です'); return; }
      const parts = [];
      if (lch()) parts.push(`<span>外装工事</span> <span class="mp-cost">${X(d.look_cost)}</span>`);
      if (rch()) parts.push(`<span>曳家工事</span> <span class="mp-cost">${X(d.rot_cost || 0)}</span>`);
      cl.innerHTML = parts.join('・') + (parts.length > 1 ? `　<b>${X(cost())}</b>` : '');
    };
    lookBind(b, { kind: d.kind, floors: () => d.floors, cells: () => cells, id: d.id, cur: n => d.look || window.M3Look.auto(d.id, n), pick: (v, init) => { pick = v; if (!init) upick = true; line(); },
      rot: r0, pickRot: d.floors > 0 ? v => { rot = v; line(); } : null });
    go.onclick = async () => {
      if (!lch() && !rch()) return;
      const c = cost();
      if (c > 0 && !confirm(T(`工事をして、見た目と向きを変えます（${fmt(c)} X）。よろしいですか？`))) return;
      go.disabled = true;
      const r = await api('mp_bld_look', { p_bld: d.id, p_look: lch() ? pick : null, p_rot: rch() ? (rot == null ? -1 : rot) : null, p_as: d.gov ? 'gov' : S.as }, '見た目と向きを変えました');
      go.disabled = false;
      if (r) { m.close(); refreshBld(d); if (done) done(); }
    };
  });
}

/* ---- 小物（3D の編集モード。t65・DB の更新103）：自分の土地に置く（置くときに お金・国庫へ）。回す・色・動かすは無料、かたづけても もどらない ---- */
let PROPK = null;   // 種類と値段（サーバー）
const PROP_ORD = ['vend', 'bench', 'planter', 'shrub', 'tree', 'sakura', 'bikes', 'lantern', 'jizo', 'hokora', 'parasol', 'slide', 'swing', 'gomi', 'nobori', 'lamp', 'sign', 'shed', 'doghouse'];   // ならべる順
const propKinds = async () => PROPK || (PROPK = await api('mp_prop_kinds', {}));
const parcelAt = (x, y) => { const k = Math.floor(x * 5) + ',' + Math.floor(y * 5); for (const p of (S.vis && S.vis.parcels ? S.vis.parcels.values() : [])) if (p.cells.has(k)) return p; return null; };
const PROP_MOVE = { o: null };   // 動かす小物（つぎに 地面をタップしたところへ）
const propAs = (x, y) => { const P = parcelAt(x, y); return P && P.own === 3 ? 'gov' : S.as; };
window.MapProp = {
  tapGround(x, y) {
    if (PROP_MOVE.o) { const o = PROP_MOVE.o; PROP_MOVE.o = null; hint(''); return propMove(o, x, y); }
    const P = parcelAt(x, y);
    if (!P || !(P.own === 2 || (P.own === 3 && S.as === 'gov'))) return toast(T('自分の土地をタップしてください'));
    propPut(P, x, y);
  },
  tapProp(o) { propEdit(o); },
  tapBlock(w) { toast(T(w === 'bld' ? '建物の上には置けません。地面をタップしてください' : '道路や線路の上には置けません。地面をタップしてください')); }
};
const propCv = '<canvas width="300" height="180" style="width:100%;max-width:300px;height:auto;display:block;margin:0 auto 4px;border:1px solid var(--line,#ddd);border-radius:10px;background:#dce7ef"></canvas>';
const propRotRow = '<div class="mp-row" style="gap:4px"><b>向き</b><button class="btn" data-rl style="padding:3px 8px">⟲ 15°</button><b data-rv style="min-width:6.5em;text-align:center"></b><button class="btn" data-rr style="padding:3px 8px">15° ⟳</button></div>';
const propColors = (b, cs, cur, pick) => {
  const el = b.querySelector('[data-pc]'); if (!el) return;
  el.innerHTML = cs.map(c => `<button class="btn${c === cur ? ' main' : ''}" data-c="${c}" style="padding:2px 6px"><span style="display:inline-block;width:18px;height:14px;border-radius:3px;background:${c};border:1px solid #0002;vertical-align:middle"></span></button>`).join('');
  el.querySelectorAll('[data-c]').forEach(x => x.onclick = () => pick(x.dataset.c));
};
async function propPut(P, x, y) {
  const K = await propKinds(); if (!K || !window.M3Look) return;
  const PR = await window.M3Look.props(), ks = Object.keys(K).filter(k => PR[k]).sort((a, b) => (PROP_ORD.indexOf(a) + 1 || 99) - (PROP_ORD.indexOf(b) + 1 || 99)); if (!ks.length) return;
  let kind = ks[0], rot = 180, col = null;
  const m = modal(['小物を置く', '']);
  m.set('小物を置く', `${propCv}<div class="mp-row" data-pk style="flex-wrap:wrap;gap:4px"></div><div class="mp-row" data-pc style="flex-wrap:wrap;gap:4px"></div>${propRotRow}
    <div class="mp-row"><button class="btn main" data-go></button></div>
    <p class="muted small"><span>自分の土地の中に置けます（土地ごとに 6＋区画×2 こまで）。お金は国庫へ。回す・色・動かすは無料で、かたづけても お金は もどりません</span></p>`, b => {
    const cv = b.querySelector('canvas'), go = b.querySelector('[data-go]');
    const paint = () => window.M3Look.draw(cv, { prop: kind, rot, col }).catch(() => {});
    const draw = () => {
      b.querySelector('[data-pk]').innerHTML = ks.map(k => `<button class="btn${k === kind ? ' main' : ''}" data-k="${k}" style="padding:3px 8px;font-size:12px"><span>${esc(T(K[k].n))}</span> <small>${X(K[k].c)}</small></button>`).join('');
      b.querySelectorAll('[data-k]').forEach(x2 => x2.onclick = () => { kind = x2.dataset.k; col = null; draw(); paint(); });
      const d = PR[kind] || {}, cs = d.col && d.cols ? d.cols : [];
      if (!col && cs.length) col = cs[0];
      propColors(b, cs, col, c => { col = c; draw(); paint(); });
      b.querySelector('[data-rv]').textContent = rotName(rot);
      go.textContent = T(`置く（${fmt(K[kind].c)} X）`);
    };
    b.querySelector('[data-rl]').onclick = () => { rot = (rot + 345) % 360; draw(); paint(); };
    b.querySelector('[data-rr]').onclick = () => { rot = (rot + 15) % 360; draw(); paint(); };
    go.onclick = async () => {
      go.disabled = true;
      const r = await api('mp_prop_put', { p_parcel: P.id, p_kind: kind, p_x: Math.round(x * 100), p_y: Math.round(y * 100), p_rot: rot, p_col: col, p_as: P.own === 3 ? 'gov' : S.as }, T(`${K[kind].n}を置きました`));
      go.disabled = false;
      if (r) { m.close(); refreshBox(x - 0.05, y - 0.05, x + 0.05, y + 0.05); }
    };
    draw(); paint();
  });
}
async function propEdit(o) {
  const K = await propKinds(); if (!K || !window.M3Look) return;
  const PR = await window.M3Look.props(), d = PR[o.kind] || {}, cs = d.col && d.cols ? d.cols : [], as = propAs(o.x, o.y);
  let rot = o.rot, col = o.col;
  const m = modal([K[o.kind] ? K[o.kind].n : '小物', '']);
  m.set(K[o.kind] ? K[o.kind].n : '小物', `${propCv}<div class="mp-row" data-pc style="flex-wrap:wrap;gap:4px"></div>${propRotRow}
    <div class="mp-row"><button class="btn main" data-save>決める</button><button class="btn" data-mv>動かす</button><button class="btn" data-del style="color:#c33">かたづける</button></div>`, b => {
    const cv = b.querySelector('canvas');
    const paint = () => window.M3Look.draw(cv, { prop: o.kind, rot, col }).catch(() => {});
    const draw = () => { propColors(b, cs, col, c => { col = c; draw(); paint(); }); b.querySelector('[data-rv]').textContent = rotName(rot); };
    b.querySelector('[data-rl]').onclick = () => { rot = (rot + 345) % 360; draw(); paint(); };
    b.querySelector('[data-rr]').onclick = () => { rot = (rot + 15) % 360; draw(); paint(); };
    b.querySelector('[data-save]').onclick = async () => { if (await api('mp_prop_set', { p_id: o.id, p_x: null, p_y: null, p_rot: rot, p_col: col, p_as: as }, '変えました')) { m.close(); refreshBox(o.x - 0.05, o.y - 0.05, o.x + 0.05, o.y + 0.05); } };
    b.querySelector('[data-mv]').onclick = () => { m.close(); PROP_MOVE.o = o; hint(T('動かす先の地面をタップしてください（同じ土地の中）')); };
    b.querySelector('[data-del]').onclick = async () => {
      if (!confirm(T('かたづけます（お金は もどりません）。よろしいですか？'))) return;
      if (await api('mp_prop_del', { p_id: o.id, p_as: as }, 'かたづけました')) { m.close(); refreshBox(o.x - 0.05, o.y - 0.05, o.x + 0.05, o.y + 0.05); }
    };
    draw(); paint();
  });
}
async function propMove(o, x, y) {
  if (await api('mp_prop_set', { p_id: o.id, p_x: Math.round(x * 100), p_y: Math.round(y * 100), p_rot: null, p_col: null, p_as: propAs(o.x, o.y) }, '小物を動かしました'))
    refreshBox(Math.min(o.x, x) - 0.05, Math.min(o.y, y) - 0.05, Math.max(o.x, x) + 0.05, Math.max(o.y, y) + 0.05);
}
/* ---- 1階のお店の看板の色（横線3つ。t65・DB の更新103）：建物の持ち主と、その部屋を借りている会社が、何度でも無料で ---- */
function scSheet(d, u, load) {
  const bb = S.vis && S.vis.blds && S.vis.blds.get(d.id), cells = bb ? [...bb.set].map(k => k.split(',').map(Number)) : null;
  const shops = d.units.filter(x => x.f === 1 && x.use === 'shop').sort((a, b) => a.no - b.no), idx = shops.findIndex(x => x.id === u.id);
  const c = (u.sc && u.sc.length ? [...u.sc] : []).concat(['#2f7d4a', '#e0a020', '#c8322d']).slice(0, 3);
  const SW = ['#c8322d', '#e0603a', '#e0a020', '#f2d03b', '#2f7d4a', '#1e9e6a', '#2e86c1', '#1f4e9a', '#6c3fa0', '#d64f8c', '#ffffff', '#2b2b2b'];
  const as = u.tmine ? corpOf(u) : d.gov ? 'gov' : S.as;
  const m = modal(['看板の色', '']);
  m.set('看板の色', `<canvas width="360" height="220" style="width:100%;max-width:360px;height:auto;display:block;margin:0 auto 4px;border:1px solid var(--line,#ddd);border-radius:10px;background:#dce7ef"></canvas>
    <p class="small" style="margin:2px 0"><span translate="no">${esc(u.room)}</span>：<span>1階のお店の 横線の色（3つ）</span></p>
    ${[0, 1, 2].map(i => `<div class="mp-row" style="gap:3px;flex-wrap:wrap"><b style="min-width:4em">${['1本目', '2本目', '3本目'][i]}</b><input type="color" data-ci="${i}" value="${c[i]}" style="width:44px;height:28px;padding:0;border:0">
      ${SW.map(v => `<button class="btn" data-p="${i}" data-v="${v}" style="padding:1px 3px"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${v};border:1px solid #0002;vertical-align:middle"></span></button>`).join('')}</div>`).join('')}
    <div class="mp-row"><button class="btn main" data-save>決める</button><button class="btn" data-reset>もとの色にもどす</button></div>
    <p class="muted small"><span>何度でも無料で変えられます。建物の持ち主と、この部屋を借りている会社が変えられます</span></p>`, b => {
    const cv = b.querySelector('canvas');
    const paint = () => { if (window.M3Look) window.M3Look.draw(cv, { kind: d.kind, floors: d.floors, cells, look: d.look, id: d.id, rot: d.rot, sc: shops.map((x, i) => i === idx ? c.slice() : (x.sc || null)) }).catch(() => {}); };
    b.querySelectorAll('[data-ci]').forEach(x => x.oninput = () => { c[+x.dataset.ci] = x.value; paint(); });
    b.querySelectorAll('[data-p]').forEach(x => x.onclick = () => { const i = +x.dataset.p; c[i] = x.dataset.v; b.querySelector(`[data-ci="${i}"]`).value = c[i]; paint(); });
    b.querySelector('[data-save]').onclick = async () => { if (await api('mp_unit_colors', { p_unit: u.id, p_sc: c, p_as: as }, '看板の色を変えました')) { m.close(); refreshBld(d); load(); } };
    b.querySelector('[data-reset]').onclick = async () => { if (await api('mp_unit_colors', { p_unit: u.id, p_sc: null, p_as: as }, 'もとの色にもどしました')) { m.close(); refreshBld(d); load(); } };
    paint();
  });
}

/* ---- 建物を見る：部屋・テナント・家賃の水準 ---- */
async function openBld(bid) {
  lookOn();
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
        ${!d.mine && u.tk === 'corp' && u.tmine ? `<button class="btn" data-leave="${u.id}">退去する</button>` : ''}
        ${u.can_sc && window.M3Look ? `<button class="btn" data-sc="${u.id}">🎨 看板の色</button>` : ''}</div>`;
    const dm = d.dem || {}, star = v => '★'.repeat(Math.max(1, Math.min(5, Math.round((v || 0) * 2.5))));
    const mainUses = [...new Set(d.units.map(u => u.use))];
    m.set(d.name || kindName(d.kind), `<div class="mp-kv">
        <b>種類</b><span><span>${esc(d.kname)}</span>${d.floors > 0 ? `・<span>${d.floors}階</span>・<span>${SHAPE_NAME[d.shape] || d.shape}</span>` : ''}</span>
        ${lookRow(d)}
        <b>住所</b><span translate="no">${esc(d.addr)}</span>
        <b>持ち主</b><span><span>${esc(d.owner)}</span>${d.mine ? '<small>（あなた）</small>' : ''}</span>
        <b>延床面積</b><span>${fmt(d.fm2 * Math.max(1, d.floors))}㎡</span>
        ${mainUses.length ? `<b>入りやすさ</b><span>${mainUses.map(u => `<span>${USE_NAME[u] || u}</span> <span style="color:#d89a00">${star(dm[u])}</span>`).join('・')}</span>` : ''}
        ${d.mine ? `<b>入居</b><span>${d.day.occ} / ${d.day.n}</span><b>家賃</b><span>1日 ${X(d.day.rent)}</span>
          <b>家賃の水準</b><span><input type="range" min="50" max="200" step="5" value="${Math.round(d.rent_lv * 100)}" class="mp-lv" style="width:55%;vertical-align:middle"> <b class="mp-lvn">${Math.round(d.rent_lv * 100)}%</b> <button class="btn" data-lvset style="padding:2px 8px">決める</button></span>` : ''}
      </div>
      ${scBlock(d)}${S.parkOK && PARK_K.includes(d.kind) ? '<div data-attrs></div>' : ''}${d.kind === 'keiba' || d.kind === 'kbshop' ? '<div data-kb></div>' : ''}${portBlock(d)}${ER_K.includes(d.kind) ? '<div data-er></div>' : ''}
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
      lookRowBind(b, d, load);   // 見た目（t65）
      b.querySelectorAll('[data-sc]').forEach(x => x.onclick = () => scSheet(d, d.units.find(z => z.id === Number(x.dataset.sc)), load));   // 看板の色（t65）
      if (q0(b, '[data-attrs]')) attrFill(q0(b, '[data-attrs]'), bid, load);   // アトラクション（DB の更新91）
      if (q0(b, '[data-kb]')) kbFill(q0(b, '[data-kb]'), bid);   // 競馬場・場外馬券売り場（DB の更新92）
      if (q0(b, '[data-er]')) erBldFill(q0(b, '[data-er]'), bid);   // 救急（DB の更新68）
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
      b.querySelectorAll('[data-out]').forEach(x => x.onclick = async () => { if (!await confirm2(T('テナントの会社に退去してもらいます。よろしいですか？'), { q: '本当に退去してもらいますか？', ok: '退去してもらう', note: 'その会社に、また借りてもらえるとはかぎりません。' })) return; if (await api('mp_unit_leave', { p_unit: Number(x.dataset.out), p_as: S.as }, '退去してもらいました')) load(); });
      b.querySelectorAll('[data-lease]').forEach(x => x.onclick = () => leaseUnit(Number(x.dataset.lease), d.units.find(u => u.id === Number(x.dataset.lease)), load));
      b.querySelectorAll('[data-leave]').forEach(x => x.onclick = async () => { if (!confirm(T('この部屋から退去します。よろしいですか？'))) return; const u = d.units.find(z => z.id === Number(x.dataset.leave)); if (await api('mp_unit_leave', { p_unit: u.id, p_as: corpOf(u) }, '退去しました')) load(); });
      if (q('[data-ren]')) q('[data-ren]').onclick = async () => { const nm = prompt(T('建物の名前（30文字まで）'), d.name); if (nm == null) return; if (await api('mp_bld_set', { p_bld: bid, p_name: nm, p_rent_lv: null, p_as: S.as }, '名前を変えました')) { load(); refreshBld(d); } };
      if (q('[data-del]')) q('[data-del]').onclick = async () => {
        if (!await confirm2(T(`「${d.name || d.kname}」をこわします（工事費はもどりません。テナントの会社には知らせます）。よろしいですか？`), { what: `「${d.name || d.kname}」`, q: '本当にこわしますか？', ok: 'こわす', note: 'もとに戻せません。工事費はもどりません。' })) return;
        if (await api('mp_bld_demolish', { p_bld: bid, p_as: S.as }, 'こわしました')) { m.close(); refreshBld(d); sheet(null); }
      };
    });
  };
  load();
}
/* ---- 建物の事業（t54k）：学校（生徒・授業料）・工場（つくるもの・在庫・仕入れ・売上）・田畑と港（つくるもの）・鉄道車両工場 ---- */
function scBlock(d) {
  const s = d.sc; if (!s) return '';
  const ui0 = FAC_UI[s.use] || (s.kind === 'school' ? FAC_UI.school : FAC_UI.leisure);
  const ui = s.grp === 'kbshop' ? { ...ui0, ic: '🏇', who: '客', fee: '手数料', unit: '1人 1日', day: '24時間の手数料', come: '客が馬券を買う' } : ui0;   // 場外馬券売り場（DB の更新92）
  const opRow = s.gov ? '' : `<b>動かしている</b><span>${s.op ? `<span>${esc(s.who || '')}</span>` : s.npc ? `<span>${ui.npc}（入居募集）</span>`
    : `<span class="mp-warn">止まっています</span> <small>（自分で使うか、会社が借りると動きます）</small>${d.mine && d.units.length ? ' <button class="btn main" data-scself style="padding:2px 10px">自分で使う</button>' : ''}`}</span>`;
  if (s.kind === 'fac' || s.kind === 'school') {   // 施設（t54l）：学校・宿泊・医療と福祉・娯楽
    const k = (S.boot.sck || {})[s.grp] || {}, lv = Math.round((s.lv || 1) * 100), mo = new Date().getMonth() + 1;
    const ssn = (k.pk || k.op) ? `<b>季節</b><span>${k.pk ? `<span>多い月</span> ${monthsTxt(k.pk)} <small>（1.3倍）</small>` : ''}${k.pk && k.op ? '・' : ''}${k.op ? `<span>少ない月</span> ${monthsTxt(k.op)} <small>（0.75倍）</small>` : ''}${(k.pk || []).includes(mo) ? ' <b style="color:#23864a">いまは多い月</b>' : (k.op || []).includes(mo) ? ' <b style="color:#c0392b">いまは少ない月</b>' : ''}</span>` : '';
    const how = s.grp === 'kbshop' ? '<span>客は、まわりの人と、近くの駅の乗り降りする人から来て、馬券を買います。同じ種類の売り場が近くにあると分けあいます。</span><span>手数料（町の人の馬券の売上の 5%）は、レースのある時間に、その時間のレースの数と格に合わせて入ります（G1 などの大きなレースは多い）。</span>'
      : s.use === 'school' || s.kind === 'school' ? '<span>生徒は、まわりの人（その年ごろの人）から通ってきます。同じ種類の学校が近くにあると分けあいます。</span>'
      : s.use === 'hotel' ? '<span>宿泊客は、近くの駅の乗り降りする人（旅の人）と、まわりの人から来ます。同じ種類の宿が近くにあると分けあいます。地価が高いところは宿泊料も高くなります。</span>'
      : s.use === 'hospital' ? '<span>患者・利用者は、まわりの人から来ます。同じ種類の病院・施設が近くにあると分けあいます。</span>'
      : s.use === 'shop' ? '<span>お客さんは、となりの駅（250m 以内）の乗り降りする人と、まわりの人から来ます。同じ駅のそばの駅ナカのお店と分けあいます。地価が高いところは値段も高くなります。お店は1階だけです（2階から上はテナントに貸します）。</span>'
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
      <p class="muted small" style="margin:2px 0 6px">${how}${k.acc ? '<span>駅・バス停が近いとふえます。</span>' : ''}${k.w ? '<span>近くの駅・バス停の乗る人にふえます（次の日から）。</span>' : ''}${s.gov ? '' : `<span>自分で使うか会社が借りると、${ui.fee}（人件費などをひいた分）が${s.grp === 'kbshop' ? 'レースのある時間に' : '1時間ごとに'}入ります。水準が高いと減ります。</span>`}</p>`;
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
  if (!inOldBox(x, y)) { const m = seaMaskAt(x, y); return m === 255; }   // 5×5 の新しい土地：海のマスク（4マスごと）
  if (!WG && window.MapGen) WG = MapGen.world();
  if (!WG) return false;
  const t = WG.cell(x, y).t; return t === 'S' || t === 'D';
}
const inOldBox = (x, y) => x >= OLDBOX[0] && x < OLDBOX[2] && y >= OLDBOX[1] && y < OLDBOX[3];
// 海のマスク（overview.json の sea）：255 海・0 陸・128 わからない。まだ読めていなければ 128
function seaMaskAt(x, y) {
  const o = S.seaInfo; if (!o) return 128;
  if (!S.seaMask) {
    S.seaMask = 'loading';
    const im = new Image(); im.onload = () => { try { const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, o.w, o.h).data, a = new Uint8Array(o.w * o.h); for (let i = 0; i < a.length; i++) a[i] = d[i * 4]; S.seaMask = a; } catch (e) { S.seaMask = null; } }; im.onerror = () => { S.seaMask = null; }; im.src = o.src;
    return 128;
  }
  if (S.seaMask === 'loading') return 128;
  const i = Math.floor((x - o.x0) / o.step), j = Math.floor((y - o.y0) / o.step);
  if (i < 0 || j < 0 || i >= o.w || j >= o.h) return 255;
  return S.seaMask[j * o.w + i];
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
const FIND_IC = { pref: '🗾', muni: '🏙', ward: '🏙', island: '🏝', cho: '🏷', addr: '📍', bld: '🏢', peak: '🏔', lake: '💧', pass: '⛰', cape: '🌊', river: '🏞', sta: { rail: '🚉', bus: '🚏', air: '✈', ship: '⚓' } };
const FIND_K = { pref: '都道府県', muni: '市区町村', ward: '区', island: '島', cho: '町字', addr: '住所', bld: '建物', sta: '駅・空港・港', peak: '山', lake: '湖・池', pass: '峠', cape: '岬', river: '川' };
function findHist() { try { return JSON.parse(localStorage.getItem('mp_find') || '[]').slice(0, 6); } catch (e) { return []; } }
function findSave(q) { try { const h = [q, ...findHist().filter(x => x !== q)].slice(0, 6); localStorage.setItem('mp_find', JSON.stringify(h)); } catch (e) {} }
function openFind() {
  const m = modal(['🔍 さがす', `<div class="mp-seg" style="margin-bottom:8px"><button class="on">📍 <span>場所・建物</span></button><button data-runf>🚃 <span>列車・バス</span></button></div><div class="mp-row" style="margin-top:0"><input class="mp-inp" data-q style="flex:1 1 180px" placeholder="住所・地名・駅・建物の名前" enterkeyhint="search" autocomplete="off"><button class="btn main" data-go>さがす</button></div>
      <p class="muted small" style="margin:4px 0"><span>例：瑠璃市中里区中央三丁目・中里3-12-5・梅ヶ枝町・新中里・瑠璃府庁・赤影岳</span><br><span>郵便番号（〒100-0001）・ローマ字の地名（Nakazato）でも さがせます</span></p>
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
      const [d0, nat] = await Promise.all([api('mp_find', { p_q: q }), natFind(q).catch(() => [])]); if (my !== seq) return;
      if (!d0 && !nat.length) { res.innerHTML = ''; return; }
      const d = [...nat.filter(r => r.hit === 0), ...(d0 || []), ...nat.filter(r => r.hit > 0)];   // 山・湖・峠・岬・川（t108）
      findSave(q); showHist();
      const ro = roOn();   // ローマ字（DB の更新114）
      res.innerHTML = d.length ? d.map((r, i) => `<button class="mp-item" style="text-align:left" data-i="${i}"><b>${r.k === 'sta' ? (FIND_IC.sta[r.sk] || '🚉') : (FIND_IC[r.k] || '📍')} <span translate="no">${esc(r.n)}</span>${ro && r.ro ? ` <small translate="no">${esc(r.ro)}</small>` : ''}</b>
          <br><small><span>${esc(T(FIND_K[r.k] || ''))}</span>${r.zip ? `・<span translate="no">〒${esc(zipFmt(r.zip))}</span>` : ''}${r.s ? `・<span translate="no">${esc(r.s)}</span>` : ''}${ro && r.sro ? `<br><span translate="no">${esc(r.sro)}</span>` : ''}</small></button>`).join('')
        : '<p class="small"><span>見つかりませんでした。</span><span>地名・町字・番地・駅・建物・山・湖・川・峠・岬の名前でさがせます（人の名前ではさがせません）</span></p>';
      res.querySelectorAll('[data-i]').forEach(x => x.onclick = () => go(d[Number(x.dataset.i)]));
    };
    b.querySelector('[data-go]').onclick = run;
    b.querySelector('[data-runf]').onclick = () => { m.close(); openRunFind(); };   // 列車・バス（t62）
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
          if (!await confirm2(T('印鑑登録を廃止します。よろしいですか？'), { q: '本当に廃止しますか？', ok: '廃止する', note: 'もう一度 使うには、印鑑登録からやりなおしです。' })) return;
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
    if (!await confirm2(T(`転出届を出して、${d.area}の住民登録をやめます。よろしいですか？`), { what: `${d.area}の住民登録`, q: '本当に転出しますか？', ok: '転出する', note: 'もう一度 住むには、転入届からやりなおしです。' })) return;
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
window.MapInt = { MQ, q, LITE, liteNeed, EDEC, B64I, bldShift, S, CS, tileAt, visibleItems, needChunks, needCells, ckey, pOf, bcol, hint, saveCam, now, evT, runList, runPt, clearRunLayer, RUN, runOff, runIsSel, runName, runDest, showTrain, showSta, runFollow, pfZ, runRef };   // 3D（map3d.js）が使う
window.MapApp = { open, pause, state: S, spline, setCam, roLoad: f => { roLoad(f); S.dirty = true; }, jamList: () => openJamList(), erList: () => openErList(), jamAt: L => layAt('jam', L, 3), erAt: L => layAt('er', L, 2.5), landReqs: () => openLandReqs(), xfers: () => openXfers(), cars: () => openCars(), goto: (x, y) => homeGo(x, y), thru: () => openThru(), bld: id => openBld(id), sc: () => openSC(),
  slots: L => (L && L.st ? openSlots(Number(L.st)) : openSlotList()), unko: L => openUnko(L && L.id ? Number(L.id) : 0), bldAt: L => { if (L && L.cx != null) homeGo(Number(L.cx), Number(L.cy)); }, lic: L => { if (L && /申請があります/.test(L.body || '')) LIC.tab = 'rev'; openLic(); }, snow: () => openSnow(), find: () => openFind(), jm: id => openJuumin(id), wxMap: () => wxMapOn() };
})();
