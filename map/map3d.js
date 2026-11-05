/* ===== 風の芽経済組：国土の地図 3D（t61）=====
   地図をななめから見る：地形（チャンクの標高・地形・用途地域）・建物（区画・階数・プリセットの見た目）・道路・線路を立体に
   three.js（cdnjs r128）は、はじめて 3D にしたときだけ読む。3D は見るだけ（工事などの道具は 2D で）
   map.js のあとに読む（S・CS・tileAt・visibleItems・pOf・bcol などを使う） */
(function () {
'use strict';
// map.js の中のもの（window.MapInt）を使う
let MQ, q, LITE, liteNeed, EDEC, B64I, S, CS, tileAt, visibleItems, needChunks, needCells, ckey, pOf, bcol, hint, saveCam, now, evT, runList, runPt, clearRunLayer, RUN, runIsSel, runName, runDest, showTrain, runFollow, pfZ, runRef, PAL;
function m3Init() { ({ MQ, q, LITE, liteNeed, EDEC, B64I, S, CS, tileAt, visibleItems, needChunks, needCells, ckey, pOf, bcol, hint, saveCam, now, evT, runList, runPt, clearRunLayer, RUN, runIsSel, runName, runDest, showTrain, runFollow, pfZ, runRef } = window.MapInt); PAL = window.MapPal; if (!runRef) runRef = () => null; }
const M3 = { on: false, loading: false };
const M3_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const M3_FH = 3.4;          // 1階の高さ（m）
const M3_U = 1 / 50;        // 1m → マス
const M3_VEX = 1.15;        // 地形の高さを少しだけ大きく（見やすく）
const M3_LIFT = 0.02;       // 道路・線路の帯は、地面から 1m 上
// 標高は とびとびの段（100m まで 4m・500m まで 25m・その上 150m ごと）。段の半分（m）：ならした地形も、もとの段の中に（t64）
//   500m より上（山）は 段が大きく、段の中にとめると 段々が出るので、とめない（ならしたまま）
const m3Half = e => e <= 100 ? 2 : e <= 500 ? 12.5 : Infinity;

function m3Lib() {
  if (window.THREE) return Promise.resolve(window.THREE);
  return new Promise((ok, ng) => { const s = document.createElement('script'); s.src = M3_LIB; s.onload = () => ok(window.THREE); s.onerror = () => ng(new Error('3D の部品が読めません')); document.head.appendChild(s); });
}
const m3Hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/* ---------- 見た目（プリセット → 屋根・窓・色のばらつき）：建物ごとに少しずつちがう ---------- */
const M3_ROOF = { gable: 1, hip: 1, flat: 1, saw: 1, dome: 1, none: 1 };
const M3_SPECIAL = {
  shrine: { roof: 'hip', win: 'none', rc: ['#3f3a36'], wc: ['#c0392b'] }, jinja_big: { roof: 'hip', win: 'none', rc: ['#3f3a36'], wc: ['#b03a2e'] },
  temple: { roof: 'hip', win: 'none', rc: ['#45403a'], wc: ['#8b5a3c'] }, temple_big: { roof: 'hip', win: 'none', rc: ['#45403a'], wc: ['#8b3a2a'] },
  castle: { roof: 'hip', win: 'none', rc: ['#3d4a4f'], wc: ['#f4f1ea'] }, wafu: { roof: 'hip', win: 'house', rc: ['#3f3a36', '#4a4642'] },
  kominka: { roof: 'hip', win: 'house', rc: ['#6b5a3a', '#5a4a30'] }, machiya: { roof: 'gable', win: 'house', rc: ['#3f3a36'] }, ryokan: { roof: 'hip', win: 'house', rc: ['#3f3a36'] },
  onsenryokan: { roof: 'hip', win: 'house', rc: ['#3f3a36'] }, gotei: { roof: 'hip', win: 'house' }, yokan: { roof: 'hip', win: 'house', rc: ['#5a6f7f', '#7a3f35'] },
  diet: { roof: 'dome', win: 'grid' }, natstad: { roof: 'none' }, pgym: { roof: 'gable', win: 'none' }, ugym: { roof: 'gable', win: 'none' },
  arena: { roof: 'dome', win: 'none' }, stadium_dome: { roof: 'dome', win: 'none' }, obstower: { roof: 'flat', win: 'glass' }, radiotower: { roof: 'flat', win: 'none', wc: ['#d94f3d', '#f2f2f2'] },
  lighthouse: { roof: 'flat', win: 'none', wc: ['#ffffff'] }, hangar: { roof: 'gable', win: 'none', rc: ['#8d9196'] }, warehouse: { roof: 'gable', win: 'none' },
  fueltank: { roof: 'dome', win: 'none', wc: ['#e8e8e2'] }, oilport: { roof: 'dome', win: 'none' },
  // t61 でふやしたプリセット
  ctower: { roof: 'flat', win: 'glass' }, radar: { roof: 'dome', win: 'none', wc: ['#f2f2f2'] }, barracks: { roof: 'flat', win: 'grid' }, mro: { roof: 'gable', win: 'none' },
  milschool: { roof: 'hip', win: 'grid', rc: ['#5a6050'] }, navpier: { roof: 'none' }, drydock: { roof: 'none' }, arsenal: { roof: 'saw', win: 'none' },
  uminoie: { roof: 'gable', win: 'none', rc: ['#3f7fb3', '#c0392b', '#e1a03a'], wc: ['#f3ead8'] }, seaside: { roof: 'gable', win: 'house', rc: ['#3f7fb3', '#f2f2f2'], wc: ['#ffffff', '#e8f3f7'] },
  beachhouse: { roof: 'flat', win: 'house', wc: ['#ffffff', '#f1f4f6'] }, cottage: { roof: 'gable', win: 'house', rc: ['#5a4030', '#3f5a3a'], wc: ['#b9875a', '#a87a50'] },
  glamping: { roof: 'dome', win: 'none', wc: ['#f4efe2'] }, beachclub: { roof: 'flat', win: 'glass' }, oceanview: { roof: 'flat', win: 'glass' }, resortcondo: { roof: 'flat', win: 'grid' },
  aquapark: { roof: 'none' }, teitaku: { roof: 'hip', win: 'house' }, poolvilla: { roof: 'flat', win: 'glass', wc: ['#f4f2ec', '#ffffff'] }, residence: { roof: 'flat', win: 'grid' },
  terrace: { roof: 'gable', win: 'house' }, courtyard: { roof: 'hip', win: 'house', rc: ['#3f3a36', '#5a4a42'] }, koban: { roof: 'gable', win: 'house' },
  kishodai: { roof: 'dome', win: 'grid' }, cemetery: { roof: 'none' }, sewage: { roof: 'flat', win: 'none' }, geihinkan: { roof: 'hip', win: 'grid', rc: ['#5f7f8f'], wc: ['#f6f1e4'] },
  embassy: { roof: 'hip', win: 'grid' }, garden: { roof: 'none' }, observatory: { roof: 'dome', win: 'none', wc: ['#f2f4f6'] },
  domestadium: { roof: 'dome', win: 'none' }, bigtemple: { roof: 'hip', win: 'none', rc: ['#45403a'], wc: ['#8b3a2a'] }, taisha: { roof: 'hip', win: 'none', rc: ['#3f3a36'], wc: ['#b03a2e'] },
  substation: { roof: 'flat', win: 'none' }, hydro: { roof: 'flat', win: 'none' }, geothermal: { roof: 'dome', win: 'none' }, heliport: { roof: 'none' },
  glassoffice: { roof: 'flat', win: 'glass' }, twintower: { roof: 'flat', win: 'glass' }, mixeduse: { roof: 'flat', win: 'grid' }
};
const M3_HOUSE_RC = ['#4b4f55', '#5a4a42', '#7a3f35', '#3f5a5f', '#6f6a63', '#2f3338', '#8a5a3a'];   // 家の屋根の色（ばらつき）
const M3_HOUSE_WC = ['#efe9df', '#f6f3ec', '#e6dccb', '#d9d5cf', '#f1e6d2', '#e2e4e6', '#efe0cf'];
function m3Style(kind, b) {
  const p = pOf(kind) || {}, sp = M3_SPECIAL[kind] || {}, cat = p.cat || '', use = p.use || '', f = Math.max(0, b.floors);
  let roof = sp.roof, win = sp.win;
  if (!roof) {
    if (f <= 0) roof = 'none';
    else if (use === 'home' && f <= 3 && (p.one || (p.u || 0) === 0 || f <= 2)) roof = (m3Hash(b.id, 7) < 0.82 ? 'gable' : 'hip');
    else if ((cat === 'shop' || cat === 'hotel' || cat === 'med') && f <= 2) roof = m3Hash(b.id, 8) < 0.5 ? 'gable' : 'flat';
    else if ((use === 'factory' || use === 'warehouse') && f <= 2) roof = use === 'factory' && m3Hash(b.id, 9) < 0.55 ? 'saw' : 'gable';
    else roof = 'flat';
  }
  if (!win) {
    if (f <= 0) win = 'none';
    else if (cat === 'biz' || kind === 'tower' || cat === 'hotel' && f >= 6) win = f >= 14 || (f >= 8 && m3Hash(b.id, 10) < 0.45) ? 'glass' : 'grid';
    else if (use === 'factory' || use === 'warehouse' || use === 'port' || use === 'farm' || use === 'parking' || use === 'plaza') win = 'none';
    else if (use === 'home' && f <= 3) win = 'house';
    else win = 'grid';
  }
  const base = bcol(kind), r = m3Hash(b.id, 3);
  let rc = (sp.rc ? sp.rc[Math.floor(r * sp.rc.length)] : null), wc = (sp.wc ? sp.wc[Math.floor(m3Hash(b.id, 4) * sp.wc.length)] : null);
  if (!rc) rc = (use === 'home' && f <= 3 && roof !== 'flat') ? M3_HOUSE_RC[Math.floor(r * M3_HOUSE_RC.length)] : base[0];
  if (!wc) wc = (use === 'home' && f <= 3) ? M3_HOUSE_WC[Math.floor(m3Hash(b.id, 5) * M3_HOUSE_WC.length)] : (base[1] || '#eeeeee');
  const jit = 0.92 + 0.12 * m3Hash(b.id, 6);   // 明るさのばらつき
  return { roof, win, rc, wc, jit, tall: win === 'glass' };
}

/* ---------- 3D をひらく・とじる ---------- */
async function m3Open() {
  if (M3.on || M3.loading) return;
  m3Init();
  M3.loading = true; hint('3D を読みこんでいます…');
  let T3;
  try { T3 = await m3Lib(); } catch (e) { M3.loading = false; hint(''); alertMsg(e.message); return; }
  M3.loading = false; hint('');
  const cv = document.createElement('canvas'); cv.className = 'mp-cv mp-cv3'; cv.style.cursor = 'grab';
  S.wrap.insertBefore(cv, S.cv.nextSibling);
  let r;
  // logarithmicDepthBuffer：遠くと近くを両方きれいに（深さの精度）。antialias：ふちをなめらかに（画質の設定。t63）
  try { r = new T3.WebGLRenderer({ canvas: cv, antialias: MQ.aa !== false, logarithmicDepthBuffer: !!M3.logz }); } catch (e) { cv.remove(); alertMsg('この端末では 3D が使えません'); return; }
  r.setPixelRatio(m3PR()); r.setSize(S.W, S.H, false);
  const sc = new T3.Scene(); sc.background = new T3.Color('#b9d3ea'); sc.fog = new T3.Fog('#b9d3ea', 200, 900);
  const cam = new T3.PerspectiveCamera(45, S.W / Math.max(1, S.H), 0.05, 4000);
  sc.add(new T3.HemisphereLight('#e8f0ff', '#7d7566', 0.68));
  const sun = new T3.DirectionalLight('#fff6e8', 0.55); sun.position.set(-0.35, 1.2, 0.55); sc.add(sun);   // 南西の高いところから（北を見るとき、手前の壁が明るい）
  const sea = new T3.Mesh(new T3.PlaneGeometry(20000, 20000), new T3.MeshLambertMaterial({ color: '#4680ba' })); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.4; sc.add(sea);   // チャンクのない深い海（チャンクの海は高さ 0）
  const grpT = new T3.Group(), grpB = new T3.Group(), grpR = new T3.Group(), grpL = new T3.Group(); sc.add(grpT, grpB, grpR, grpL);   // grpL：遠くの建物（t63）
  Object.assign(M3, { on: true, T: T3, r, sc, cam, sea, grpT, grpB, grpR, grpL, lm: new Map(), cv, cm: new Map(), bKey: '', rKey: '', tex: null, tg: 0, tgN: 0,
    tx: S.cam.x, ty: S.cam.y, d: Math.max(10, Math.min(700, (S.H / S.cam.z) * 0.95)), yaw: 0, pitch: 0.92, gy: 0, dirty: true });
  M3.tex = m3WinTex(T3);
  S.v3 = M3; S.wrap.classList.add('mp-3d');
  m3Bind(cv);
  hint(S.layer.run ? '3D は見るだけです（指でうごかす・2本指で回す／かたむける・列車をタップで情報）' : '3D は見るだけです（指でうごかす・2本指で回す／かたむける）'); setTimeout(() => { if (M3.on) hint(''); }, 4000);
  S.dirty = true;
}
function m3Close() {
  if (!M3.on) return;
  // 2D のカメラを 3D の真ん中に
  S.cam.x = M3.tx; S.cam.y = M3.ty; S.cam.z = Math.max(1.2, Math.min(40, S.H / Math.max(4, M3.d * 1.05)));
  for (const g of [M3.grpT, M3.grpB, M3.grpR, M3.grpL]) m3Clear(g); M3.lm = new Map();
  if (M3.run) { M3.run.geometry.dispose(); M3.run.material.dispose(); M3.run = null; M3.runCap = 0; }
  if (M3.mark) { M3.mark.geometry.dispose(); M3.mark.material.dispose(); M3.mark = null; }
  M3.runHit = []; M3.selLab = null;
  M3.glide = null; M3.labs = []; if (clearRunLayer) clearRunLayer();
  M3.r.dispose(); M3.cv.remove();
  M3.on = false; S.v3 = null; S.v3rect = null; S.wrap.classList.remove('mp-3d');
  saveCam(); S.dirty = true;
}
function m3Clear(g) { for (const o of [...g.children]) { g.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.keep) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } }
const alertMsg = m => { try { hint(m); setTimeout(() => hint(''), 3500); } catch (e) {} };

// 窓のテクスチャ（壁の色にかける）：ガラス張り・格子の窓・家の窓
function m3WinTex(T3) {
  const mk = draw => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); draw(g); const t = new T3.CanvasTexture(c); t.wrapS = t.wrapT = T3.RepeatWrapping; t.anisotropy = 4; return t; };
  return {
    glass: mk(g => { g.fillStyle = '#a3bdd3'; g.fillRect(2, 8, 60, 46); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(2, 8, 60, 6); g.fillStyle = '#d8dee4'; g.fillRect(30, 8, 3, 46); }),
    grid: mk(g => { g.fillStyle = '#a9b8c6'; g.fillRect(12, 14, 40, 30); g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(12, 14, 40, 5); }),
    house: mk(g => { g.fillStyle = '#a5b2bd'; g.fillRect(20, 18, 24, 22); g.fillStyle = '#fff'; g.fillRect(31, 18, 2, 22); }),
    none: null
  };
}

/* ---------- カメラ・まわりのデータ ---------- */
function m3Cam() {
  const { cam } = M3, c = Math.cos(M3.pitch), s = Math.sin(M3.pitch);
  const gy = m3Surf(M3.tx, M3.ty); M3.gy += (gy - M3.gy) * 0.35;
  cam.position.set(M3.tx + Math.sin(M3.yaw) * c * M3.d, M3.gy + s * M3.d, M3.ty + Math.cos(M3.yaw) * c * M3.d);
  cam.lookAt(M3.tx, M3.gy, M3.ty);
  const R = M3.R || 700;
  cam.far = Math.max(600, M3.d * 14, R * 1.3); cam.near = Math.max(0.05, M3.d / 400); cam.updateProjectionMatrix();
  M3.sc.fog.near = M3.d * 1.6; M3.sc.fog.far = M3.d * 1.6 + Math.max(260, M3.d * 6);
  if (MQ.d3 >= 2) M3.sc.fog.far = Math.max(M3.sc.fog.far, R * 0.95);   // 遠くまで（t63）
  else if (MQ.d3 <= 0) M3.sc.fog.far = Math.max(M3.sc.fog.near + 60, Math.min(M3.sc.fog.far, R * 1.1));   // 省エネ：地形のはしを霧でかくす
}
// 読むはんい：地形は広く、建物・道路は近くだけ
//   画質の設定（t63）で遠さを変える。くわしい地形は RF まで、その先は あらい地形（サーバーにないときは前のまま 700 まで くわしい地形）
function m3Rects() {
  const lv = MQ.d3, R = Math.max(70, Math.min(q('r3', lv), M3.d * q('k3', lv))), RB = Math.max(40, Math.min(q('rb3', lv), M3.d * 2.2));
  const RF = LO.off ? Math.min(R, 700) : Math.min(R, q('rf3', lv));
  const RL = q('rl3', lv) > 0 && !LITE.off ? Math.min(q('rl3', lv), Math.max(R, RB)) : 0;
  const sq = r => ({ x0: M3.tx - r, y0: M3.ty - r, x1: M3.tx + r, y1: M3.ty + r });
  return { big: sq(LO.off ? RF : R), full: sq(RF), near: sq(RB), lite: RL ? sq(RL) : null, R: LO.off ? RF : R, RF, RB, RL };
}
function m3Frame() {
  if (!M3.on) return;
  const rc = m3Rects();
  // 地形：チャンクを読む（2D の読みこみを、このはんいで）
  S.cam.x = M3.tx; S.cam.y = M3.ty;
  M3.R = rc.R;
  S.v3rect = rc.full; S.cam.z = 2; needChunks(); trimChunks3(rc.full);
  needLo(rc.big, rc.full);   // 遠くの地形（あらい版。t63）
  const nearOn = M3.d < q('db3', MQ.d3);
  S.v3rect = rc.near; S.cam.z = nearOn ? 8 : 3; needCells();
  if (rc.lite) liteNeed(rc.lite, 80);   // 遠くの建物（t63）
  m3Terrain(rc);
  m3Blds(rc.near);
  try { m3Lite(rc, nearOn); } catch (e) { console.error(e); }
  try { m3Runs(rc.near); } catch (e) { console.error(e); }   // 列車・バス（t61）
  m3Cam();
  M3.r.render(M3.sc, M3.cam);
  m3Labels();   // 建物の名前（t61）
  if (Math.abs(m3Surf(M3.tx, M3.ty) - M3.gy) > 0.002) M3.dirty = true;
}
// 3D のときのチャンクの片づけ（遠いものから。2D の trimChunks は 2D の見えかたで決めるので使わない）
function trimChunks3(v) {
  if (S.chunks.size < 900) return;
  const far = [...S.chunks.entries()].filter(([, c]) => !(c.cx * CS + CS >= v.x0 && c.cx * CS <= v.x1 && c.cy * CS + CS >= v.y0 && c.cy * CS <= v.y1)).sort((a, b) => a[1].used - b[1].used);
  for (const [k] of far.slice(0, S.chunks.size - 800)) S.chunks.delete(k);
}

/* ---------- 地形：チャンクごとの網（遠いほどあらく） ---------- */
function m3Terrain(rc) {
  const v = rc.big, T3 = M3.T, cx0 = Math.floor(v.x0 / CS), cy0 = Math.floor(v.y0 / CS), cx1 = Math.floor(v.x1 / CS), cy1 = Math.floor(v.y1 / CS);
  const keep = new Set(), todo = [];
  // 海ぞいのチャンク（近いところ）は、半マスごとの網（t64）：陸を水ぎわまで平らに、がけは水のがわに（水ぎわの建物が うかないように）
  //   はんいは 建物を出すところ（近いとき）まで。画質で上限
  const lv = Math.max(0, Math.min(3, Number(MQ.d3) || 0)), HR = M3.d < 150 ? Math.min([64, 100, 140, 180][lv], Math.max(64, rc.RB + 48)) : 0;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const k = ckey(cx, cy), c = S.chunks.get(k), lo = LO.m.get(k);
    const dist = Math.hypot(cx * CS + 32 - M3.tx, cy * CS + 32 - M3.ty);
    let mode, st;
    if (c && !c.sea && (dist <= rc.RF + 48 || !lo || lo.sea)) { mode = 'f'; st = dist < Math.max(160, M3.d * 1.4) ? 1 : dist < Math.max(360, M3.d * 3) ? 2 : dist < 700 ? 4 : 8; if (st === 1 && dist < HR && m3Coast(c, cx, cy)) st = 0.5; }
    else if (lo && !lo.sea) { mode = 'l'; st = 4; }   // 遠くは あらい地形（t63）
    else continue;
    if (c) c.used = now(); if (lo) lo.used = now(); keep.add(k);
    // となりがあるか（へりをつなぐため。くわしい地形は、ならすときに まわり 8 つ を使うので 8 つとも。t64）
    const nb = [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => S.chunks.get(ckey(cx + dx, cy + dy)) || (mode === 'l' && LO.m.get(ckey(cx + dx, cy + dy))) ? 'y' : 'n').join('');
    const old = M3.cm.get(k);
    if (old && old.st === st && old.nb === nb && old.mode === mode) continue;
    todo.push({ k, c, cx, cy, st, nb, mode, dist });
  }
  // 1フレームに作るのは少しずつ（時間で区切る：速い端末はすぐそろい、遅い端末はカクつかない）。近いものから（t63）
  todo.sort((a, b) => a.dist - b.dist);
  const t0 = performance.now(), bud = [4, 6, 8, 10][Math.max(0, Math.min(3, Number(MQ.d3) || 0))]; let n = 0;
  for (const t of todo) {
    if (n >= 2 && performance.now() - t0 > bud) break;
    const old = M3.cm.get(t.k);
    if (old) { M3.grpT.remove(old.mesh); old.mesh.geometry.dispose(); }
    const mesh = t.mode === 'f' ? m3ChunkMesh(T3, t.c, t.cx, t.cy, t.st) : m3LoMesh(T3, t.cx, t.cy); M3.grpT.add(mesh);
    // H：網の点の高さ（建物・道路・列車を、この網の上に。m3Surf）。gen：作った順の番号（上に のせるものを作りなおす合図）
    M3.cm.set(t.k, { mesh, st: t.st, nb: t.nb, mode: t.mode, H: mesh.userData.H, gen: ++M3.tg }); n++;
    const nr = rc.near; if (t.cx * CS <= nr.x1 + 1 && t.cx * CS + CS >= nr.x0 - 1 && t.cy * CS <= nr.y1 + 1 && t.cy * CS + CS >= nr.y0 - 1) M3.tgN++;
  }
  if (n < todo.length) M3.dirty = true;
  for (const [k, o] of M3.cm) if (!keep.has(k)) { M3.grpT.remove(o.mesh); o.mesh.geometry.dispose(); M3.cm.delete(k); }
}
const M3_TMAT = { m: null };
// 海ぞいか（陸のタイルの となりに 海 D・S がある）。チャンクに おぼえる（となりのチャンクを読んだら はかりなおす）（t64）
const m3W = ch => ch === 'D' || ch === 'S';
function m3Coast(c, cx, cy) {
  const nk = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => S.chunks.has(ckey(cx + dx, cy + dy)) ? 'y' : 'n').join('');
  if (c.coastK === nk) return c.coast;
  const T = c.t; let r = false;
  out: for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const k = y * CS + x; if (m3W(T[k])) continue;
    if ((x > 0 && m3W(T[k - 1])) || (x < CS - 1 && m3W(T[k + 1])) || (y > 0 && m3W(T[k - CS])) || (y < CS - 1 && m3W(T[k + CS]))) { r = true; break out; }
    if (x === 0 || y === 0 || x === CS - 1 || y === CS - 1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const t = tileAt(cx * CS + x + dx, cy * CS + y + dy); if (t && m3W(t.t)) { r = true; break out; } }
  }
  c.coastK = nk; c.coast = r; return r;
}
function m3ChunkMesh(T3, c, cx, cy, st) {
  const n = Math.round(CS / st) + 1, pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), idx = [], HH = new Float32Array(n * n);
  const at = (x, y) => { const t = tileAt(x, y); return t && !(t.t === 'D' && t.e === -190 && !S.chunks.get(ckey(Math.floor(x / CS), Math.floor(y / CS)))) ? t : tileAt(Math.min(x, cx * CS + CS - 1), Math.min(y, cy * CS + CS - 1)); };
  // 標高はとびとびの段（高いところは 150m ごと）なので、まわりとならして段々にならないように（2回ならす）
  const R = 3, M = 2 * R + 2, G = CS + 2 * M + 1, x00 = cx * CS - M, y00 = cy * CS - M, X0 = cx * CS, Y0 = cy * CS;
  let E = new Float32Array(G * G); const E0 = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    // まだ読んでいない となりは、このチャンクのへりの高さで（0m にすると、へりが へこむ。t64）
    const t = tileAt(x00 + i, y00 + j) || tileAt(Math.max(X0, Math.min(X0 + CS - 1, x00 + i)), Math.max(Y0, Math.min(Y0 + CS - 1, y00 + j)));
    E[j * G + i] = E0[j * G + i] = !t || t.t === 'D' || t.t === 'S' ? 0 : Math.max(0, t.e);
  }
  const box = (A, H) => { const B = new Float32Array(G * G); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let s2 = 0, m = 0; for (let k = -R; k <= R; k++) { const ii = H ? i + k : i, jj = H ? j : j + k; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue; s2 += A[jj * G + ii]; m++; } B[j * G + i] = s2 / m; } return B; };
  for (let p = 0; p < 2; p++) E = box(box(E, true), false);
  // ならしても、もとの段の中（段の高さ ± 段の半分）から出さない（t64）：坂の町・岬で、地形が建物や道路から はなれないように
  for (let k = 0; k < G * G; k++) { const e0 = E0[k], hs = m3Half(e0); E[k] = Math.max(e0 - hs, Math.min(e0 + hs, E[k])); }
  let AV = null;   // 半マスの網：ふつうの網なら この高さ（へりの すそ）
  if (st >= 1) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cx * CS + Math.min(i * st, CS), y = cy * CS + Math.min(j * st, CS), t = at(x, y) || { t: 'D', e: 0, z: '-' };
    const water = t.t === 'D' || t.t === 'S', h = water ? 0 : Math.max(0.02, E[(y - y00) * G + (x - x00)]) * M3_U * M3_VEX;
    const o = (j * n + i) * 3; pos[o] = x + 0.5; pos[o + 1] = h; pos[o + 2] = y + 0.5; HH[j * n + i] = h;
    const cc = PAL.tileColor(t.t, t.e, t.z || '-', 0);
    col[o] = cc[0] / 255; col[o + 1] = cc[1] / 255; col[o + 2] = cc[2] / 255;
  } else {
    // 半マスの網（海ぞい。t64）：タイルのまん中と、タイルのさかい（へり・かど）に点。さかいの点は、となりあうタイルの平均。
    //   陸と水のさかいは 陸の高さ（陸は水ぎわまで平ら。がけ・浜は 水のタイルの がわに）。
    //   チャンクのへりは、となりが ふつうの網だと 高さがちがうことがあるので、へりに すそ（下へのかべ）をつけて すきまを かくす
    const m = CS + 1, TH = new Float32Array(m * m), TW = new Uint8Array(m * m), TC = new Float32Array(m * m * 3); AV = new Float32Array(n * n);
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const x = cx * CS + a, y = cy * CS + b, t = at(x, y) || { t: 'D', e: 0, z: '-' }, w = t.t === 'D' || t.t === 'S', cc = PAL.tileColor(t.t, t.e, t.z || '-', 0), k = b * m + a;
      TW[k] = w ? 1 : 0; TH[k] = w ? 0 : Math.max(0.02, E[(y - y00) * G + (x - x00)]) * M3_U * M3_VEX; TC[k * 3] = cc[0]; TC[k * 3 + 1] = cc[1]; TC[k * 3 + 2] = cc[2];
    }
    const cliff = 6 * M3_U * M3_VEX;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const as = i & 1 ? [(i - 1) / 2, (i + 1) / 2] : [i / 2], bs = j & 1 ? [(j - 1) / 2, (j + 1) / 2] : [j / 2];
      let ha = 0, hl = 0, nl = 0, r = 0, g = 0, bb = 0, rl = 0, gl = 0, bl = 0, nn = 0;
      for (const b of bs) for (const a of as) { const k = b * m + a; ha += TH[k]; r += TC[k * 3]; g += TC[k * 3 + 1]; bb += TC[k * 3 + 2]; nn++; if (!TW[k]) { hl += TH[k]; rl += TC[k * 3]; gl += TC[k * 3 + 1]; bl += TC[k * 3 + 2]; nl++; } }
      const mix = nl > 0 && nl < nn, h = mix ? hl / nl : ha / nn, cl = mix && h > cliff;   // 高い陸と水のさかい（がけ）は 陸の色
      AV[j * n + i] = ha / nn;   // ふつうの網なら この高さ（へりの すそ）
      const o = (j * n + i) * 3; pos[o] = cx * CS + 0.5 + i / 2; pos[o + 1] = h; pos[o + 2] = cy * CS + 0.5 + j / 2; HH[j * n + i] = h;
      col[o] = (cl ? rl / nl : r / nn) / 255; col[o + 1] = (cl ? gl / nl : g / nn) / 255; col[o + 2] = (cl ? bl / nl : bb / nn) / 255;
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, d = a + n, e = d + 1; idx.push(a, d, b, b, d, e); }
  let P = pos, Cc = col; const src = [];
  if (st < 1) {
    // へりの すそ（半マスの網）：ふつうの網と高さがちがう へりだけ（陸と水のさかい）。へりの点から、ふつうの網の高さより少し下まで（表と裏の両方の向き）
    const rows = [[...Array(n).keys()], [...Array(n).keys()].map(i => (n - 1) * n + i), [...Array(n).keys()].map(j => j * n), [...Array(n).keys()].map(j => j * n + n - 1)];
    const ex = [], tri = [];
    for (const list of rows) for (let k = 0; k < list.length - 1; k++) {
      const a = list[k], b2 = list[k + 1];
      if (Math.abs(pos[a * 3 + 1] - AV[a]) < 1e-4 && Math.abs(pos[b2 * 3 + 1] - AV[b2]) < 1e-4) continue;
      const c2 = n * n + src.length, d = c2 + 1; src.push(a, b2); tri.push(a, c2, b2, b2, c2, d, a, b2, c2, b2, d, c2);
    }
    if (src.length) {
      P = new Float32Array((n * n + src.length) * 3); P.set(pos); Cc = new Float32Array((n * n + src.length) * 3); Cc.set(col);
      src.forEach((v, q) => { const o = (n * n + q) * 3; P[o] = pos[v * 3]; P[o + 1] = Math.min(pos[v * 3 + 1], AV[v]) - 0.02; P[o + 2] = pos[v * 3 + 2]; Cc[o] = col[v * 3]; Cc[o + 1] = col[v * 3 + 1]; Cc[o + 2] = col[v * 3 + 2]; });
      for (const v of tri) idx.push(v);
    }
  }
  const g = new T3.BufferGeometry();
  g.setAttribute('position', new T3.BufferAttribute(P, 3)); g.setAttribute('color', new T3.BufferAttribute(Cc, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (src.length) { const N = g.attributes.normal.array; src.forEach((v, q) => { const o = (n * n + q) * 3; N[o] = N[v * 3]; N[o + 1] = N[v * 3 + 1]; N[o + 2] = N[v * 3 + 2]; }); }   // すその光は、上の点と同じに
  if (!M3_TMAT.m) { M3_TMAT.m = new T3.MeshLambertMaterial({ vertexColors: true }); M3_TMAT.m.keep = true; }
  const mesh = new T3.Mesh(g, M3_TMAT.m); mesh.userData.H = HH; return mesh;
}

/* ---------- 遠くの地形（あらい版。t63・DB の更新47）：チャンクを 16×16 に（4マスごとのまん中）。サーバーには あらい版だけをたのむ ---------- */
const LO = { m: new Map(), q: [], pend: new Set(), busy: 0, off: false };
const m3PR = () => Math.max(0.5, Math.min(2, window.devicePixelRatio || 1) * (Number(MQ.res) || 1));   // 画面のこまかさ（t63）
const inW = (cx, cy) => { const w = S.boot && S.boot.world; return w && cx >= w.cx0 && cx <= w.cx1 && cy >= w.cy0 && cy <= w.cy1; };
function needLo(big, full) {
  if (LO.off) return;
  const cx0 = Math.floor(big.x0 / CS), cy0 = Math.floor(big.y0 / CS), cx1 = Math.floor(big.x1 / CS), cy1 = Math.floor(big.y1 / CS), want = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const k = ckey(cx, cy), mx = cx * CS + 32, my = cy * CS + 32;
    if (!inW(cx, cy) || LO.m.has(k) || LO.pend.has(k)) continue;
    if (mx > full.x0 + 40 && mx < full.x1 - 40 && my > full.y0 + 40 && my < full.y1 - 40) continue;   // くわしい地形のところ（へりは両方）
    want.push([cx, cy, (mx - M3.tx) ** 2 + (my - M3.ty) ** 2]);
  }
  want.sort((a, b) => a[2] - b[2]);
  for (const [cx, cy] of want) { LO.pend.add(ckey(cx, cy)); LO.q.push([cx, cy]); }
  pumpLo();
  if (LO.m.size > 5000) { const all = [...LO.m.entries()].sort((a, b) => (a[1].used || 0) - (b[1].used || 0)); for (const [k] of all.slice(0, LO.m.size - 4000)) LO.m.delete(k); }
}
function pumpLo() {
  while (LO.busy < 1 && LO.q.length && !LO.off) {
    const batch = LO.q.splice(0, 128), keys = [];
    for (const [cx, cy] of batch) keys.push(cx, cy);
    LO.busy++;
    call('mp_chunk_lo', { p_keys: keys }).then(rows => {
      const got = new Set();
      for (const c of rows) { const k = ckey(c.cx, c.cy); got.add(k); LO.m.set(k, { t: c.t, e: c.e, z: c.z, used: now() }); }
      for (const [cx, cy] of batch) { const k = ckey(cx, cy); LO.pend.delete(k); if (!got.has(k)) LO.m.set(k, { sea: true, used: now() }); }
      M3.dirty = true;
    }).catch(e => { for (const [cx, cy] of batch) LO.pend.delete(ckey(cx, cy)); if (/Could not find the function|schema cache|does not exist/.test(e.message)) { LO.off = true; LO.q = []; M3.dirty = true; } })
      .finally(() => { LO.busy--; pumpLo(); });
  }
}
// あらい版の1点（gx, gy：4マスごとの格子）。なければ くわしいチャンクから
function loAt(gx, gy) {
  const cx = Math.floor(gx / 16), cy = Math.floor(gy / 16), L2 = LO.m.get(ckey(cx, cy));
  if (L2 && !L2.sea) { const i = (gy - cy * 16) * 16 + (gx - cx * 16); return { t: L2.t[i], e: EDEC[B64I[L2.e.charCodeAt(i)]], z: L2.z[i] }; }
  const t = tileAt(gx * 4 + 2, gy * 4 + 2); if (t) return t;
  return L2 && L2.sea ? { t: 'D', e: -190, z: '-' } : null;
}
const loH = t => (t.t === 'D' || t.t === 'S') ? 0 : Math.max(0.02, t.e) * M3_U * M3_VEX;
// 地面の高さ（くわしいチャンクがなければ あらい版）
function m3H(x, y) { const t = tileAt(Math.floor(x), Math.floor(y)); if (t) return (t.t === 'D' || t.t === 'S') ? 0 : Math.max(0, t.e) * M3_U * M3_VEX; const l = loAt(Math.floor(x / 4), Math.floor(y / 4)); return l ? loH(l) : 0; }
// 描いている地形の面の高さ（3D の座標。t64）：地形の網と同じ三角で。建物・道路・線路・駅・列車は、みんな これの上に
//   網は、チャンクの (x + 0.5, y + 0.5) から st マスごとの点。四角を (左上・左下・右上) と (右上・左下・右下) の三角に。網がまだないところは タイルの高さ
function m3Surf(x, y) {
  const cx = Math.floor((x - 0.5) / CS), cy = Math.floor((y - 0.5) / CS), o = M3.cm && M3.cm.get(ckey(cx, cy));
  if (!o || !o.H) return m3H(x, y);
  const st = o.st, n = o.mode === 'l' ? 17 : CS / st + 1, u = (x - 0.5 - cx * CS) / st, v = (y - 0.5 - cy * CS) / st;
  const i = Math.max(0, Math.min(n - 2, Math.floor(u))), j = Math.max(0, Math.min(n - 2, Math.floor(v))), fu = u - i, fv = v - j, H = o.H;
  const a = H[j * n + i], b = H[j * n + i + 1], d = H[(j + 1) * n + i], e = H[(j + 1) * n + i + 1];
  return fu + fv <= 1 ? a + (b - a) * fu + (d - a) * fv : e + (d - e) * (1 - fu) + (b - e) * (1 - fv);
}
// 線 sg の s（マス）のところ (x, y) の、帯のまん中の高さ（lift なし）と つくり（G 地面・V 高架・B 橋・T トンネル）。駅・列車（t64）
function m3OnLine(sg, s, x, y) {
  const g = m3Surf(x, y);
  if (!sg || !sg.pf || !sg.L) return { y: g, c: 'G', g };
  const st = sg.st || '', c = st[Math.min(st.length - 1, Math.max(0, Math.round(s)))] || 'G', z = pfZ(sg.pf, s) * M3_U * M3_VEX;
  return { y: c === 'V' || c === 'B' ? z : Math.max(z, g), c, g };
}
function m3LoMesh(T3, cx, cy) {
  const n = 17, pos = [], col = [], idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const gx = cx * 16 + i, gy = cy * 16 + j; let h = 0, r = 0, g = 0, b = 0, m = 0;
    for (const [a, c] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const t = loAt(gx + a, gy + c); if (!t) continue; h += loH(t); const cc = PAL.tileColor(t.t, t.e, t.z || '-', 0); r += cc[0]; g += cc[1]; b += cc[2]; m++; }
    if (m) { h /= m; r /= m; g /= m; b /= m; } else { r = 70; g = 128; b = 186; }
    pos.push(cx * CS + i * 4 + 0.5, h, cy * CS + j * 4 + 0.5); col.push(r / 255, g / 255, b / 255);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b2 = a + 1, d = a + n, e = d + 1; idx.push(a, d, b2, b2, d, e); }
  const HH = new Float32Array(n * n); for (let k = 0; k < n * n; k++) HH[k] = pos[k * 3 + 1];   // 網の点の高さ（m3Surf）
  // へりのすそ（となりとの すきまを かくす）
  const edge = (list) => { const base = pos.length / 3; for (const v of list) { pos.push(pos[v * 3], pos[v * 3 + 1] - 0.6, pos[v * 3 + 2]); col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]); }
    for (let k = 0; k < list.length - 1; k++) { const a = list[k], b2 = list[k + 1], c2 = base + k, d = base + k + 1; idx.push(a, c2, b2, b2, c2, d, a, b2, c2, b2, d, c2); } };
  edge([...Array(n).keys()]); edge([...Array(n).keys()].map(i => (n - 1) * n + i)); edge([...Array(n).keys()].map(j => j * n)); edge([...Array(n).keys()].map(j => j * n + n - 1));
  const geo = new T3.BufferGeometry();
  geo.setAttribute('position', new T3.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new T3.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  if (!M3_TMAT.m) { M3_TMAT.m = new T3.MeshLambertMaterial({ vertexColors: true }); M3_TMAT.m.keep = true; }
  const mesh = new T3.Mesh(geo, M3_TMAT.m); mesh.userData.H = HH; return mesh;
}
/* ---------- 遠くの建物（かんたんな形。t63）：ます目（192 マス）ごとに1つの形。遠いほど低い建物は出さない・数の上限 ---------- */
const M3_LMAT = { m: null };
const m3Hex = (h, f) => { const n = parseInt(String(h || '#cccccc').slice(1), 16); return [((n >> 16) & 255) / 255 * f, ((n >> 8) & 255) / 255 * f, (n & 255) / 255 * f]; };
function m3Lite(rc, nearOn) {
  const T3 = M3.T;
  if (!rc.lite) { if (M3.lm.size) { m3Clear(M3.grpL); M3.lm = new Map(); } return; }
  const L = LITE.LS, v = rc.lite, i0 = Math.floor(v.x0 / L), j0 = Math.floor(v.y0 / L), i1 = Math.floor(v.x1 / L), j1 = Math.floor(v.y1 / L);
  const nr = rc.near, nk = nearOn ? [nr.x0, nr.y0, nr.x1, nr.y1].map(x => Math.round(x / 16)).join(',') : '-', cap = MQ.d3 >= 3 ? 9000 : 5000;
  const keep = new Set(), todo = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = LITE.cells.get(i + ',' + j); if (!c || !c.items) continue;
    const key = i + ',' + j, mx = (i + 0.5) * L, my = (j + 0.5) * L, dist = Math.hypot(mx - M3.tx, my - M3.ty);
    if (dist > rc.RL + L * 0.71) continue;
    keep.add(key);
    const minF = dist > 560 ? 6 : dist > 380 ? 4 : dist > 240 ? 2 : 1;
    const hits = nearOn && !(mx + L / 2 < nr.x0 || mx - L / 2 > nr.x1 || my + L / 2 < nr.y0 || my - L / 2 > nr.y1);
    // 下の地形の網（作りなおしたら、建物も のせなおす。t64）
    let gk = 0; for (let b = Math.floor(j * L / CS); b <= Math.floor(((j + 1) * L - 1) / CS); b++) for (let a = Math.floor(i * L / CS); a <= Math.floor(((i + 1) * L - 1) / CS); a++) { const o = M3.cm.get(ckey(a, b)); if (o) gk += o.gen; }
    const sig = c.v + ':' + minF + ':' + (hits ? nk : '-') + ':' + gk;
    const o = M3.lm.get(key); if (o && o.sig === sig) continue;
    todo.push({ key, c, minF, hits, sig, dist });
  }
  todo.sort((a, b) => a.dist - b.dist);   // 1フレームに作るのは少しずつ（時間で区切る）。近いものから
  const t0 = performance.now(), bud = [3, 4, 6, 8][Math.max(0, Math.min(3, Number(MQ.d3) || 0))]; let n = 0;
  for (const t of todo) {
    if (n && performance.now() - t0 > bud) break;
    const o = M3.lm.get(t.key);
    if (o && o.mesh) { M3.grpL.remove(o.mesh); o.mesh.geometry.dispose(); }
    const mesh = m3LiteMesh(T3, t.c.items, t.minF, t.hits ? nr : null, cap); if (mesh) M3.grpL.add(mesh);
    M3.lm.set(t.key, { mesh, sig: t.sig }); n++;
  }
  if (n < todo.length) M3.dirty = true;
  for (const [k, o] of M3.lm) if (!keep.has(k)) { if (o.mesh) { M3.grpL.remove(o.mesh); o.mesh.geometry.dispose(); } M3.lm.delete(k); }
}
function m3LiteMesh(T3, items, minF, excl, cap) {
  let bs = items.filter(b => b.f >= minF && !(excl && (b.x0 + b.x1) / 2 >= excl.x0 && (b.x0 + b.x1) / 2 <= excl.x1 && (b.y0 + b.y1) / 2 >= excl.y0 && (b.y0 + b.y1) / 2 <= excl.y1));
  if (bs.length > cap) bs = bs.sort((a, b) => b.f - a.f).slice(0, cap);   // 多すぎたら高いものから
  if (!bs.length) return null;
  const pos = [], nrm = [], col = [], idx = [];
  const quad = (p, nx, ny, nz, c) => { const b0 = pos.length / 3; for (const q2 of p) { pos.push(q2[0], q2[1], q2[2]); nrm.push(nx, ny, nz); col.push(c[0], c[1], c[2]); } idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); };
  for (const b of bs) {
    const id = Math.round(b.x0 * 5) * 7919 + Math.round(b.y0 * 5), st = m3Style(b.kind, { id, floors: b.f });
    // 地形の面の上に（t64）：床は いちばん高いところ、壁は いちばん低いところまで（坂で うまらない・うかない）
    const hs = [m3Surf(b.x0, b.y0), m3Surf(b.x1, b.y0), m3Surf(b.x0, b.y1), m3Surf(b.x1, b.y1), m3Surf((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)];
    const g0 = Math.min(...hs) - 0.012, y1 = Math.max(...hs) + (b.f * M3_FH + 0.8) * M3_U, x0 = b.x0, x1 = b.x1, z0 = b.y0, z1 = b.y1;
    const wc = m3Hex(st.wc, st.jit), rcl = m3Hex(st.rc, st.jit);
    quad([[x0, g0, z1], [x1, g0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, wc);
    quad([[x1, g0, z1], [x1, g0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0, wc);
    quad([[x1, g0, z0], [x0, g0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1, wc);
    quad([[x0, g0, z0], [x0, g0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, wc);
    quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0, rcl);
  }
  const geo = new T3.BufferGeometry();
  geo.setAttribute('position', new T3.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new T3.Float32BufferAttribute(nrm, 3)); geo.setAttribute('color', new T3.Float32BufferAttribute(col, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new T3.Uint32BufferAttribute(idx, 1) : new T3.Uint16BufferAttribute(idx, 1));
  if (!M3_LMAT.m) { M3_LMAT.m = new T3.MeshLambertMaterial({ vertexColors: true }); M3_LMAT.m.keep = true; }
  return new T3.Mesh(geo, M3_LMAT.m);
}

/* ---------- 建物・道路・線路 ---------- */
function m3Blds(v) {
  const it = visibleItems();   // S.v3rect（近いはんい）・S.cam.z（細かさ）は m3Frame で合わせてある
  const bs = [...it.blds.values()].filter(b => b.bb[2] >= v.x0 && b.bb[0] <= v.x1 && b.bb[3] >= v.y0 && b.bb[1] <= v.y1);
  const segs = [...it.segs.values()].filter(s => s.bb[2] >= v.x0 && s.bb[0] <= v.x1 && s.bb[3] >= v.y0 && s.bb[1] <= v.y1);
  const rws = [...(it.rwys ? it.rwys.values() : [])].filter(r => r.bb && r.bb[2] >= v.x0 && r.bb[0] <= v.x1 && r.bb[3] >= v.y0 && r.bb[1] <= v.y1);
  const sts = [...it.stas.values()].filter(t => t.fx >= v.x0 - 2 && t.fx <= v.x1 + 2 && t.fy >= v.y0 - 2 && t.fy <= v.y1 + 2);   // 駅（t62）
  const key = bs.length + ':' + bs.reduce((a, b) => (a + b.id * 31 + b.floors) % 1e9, 0) + '|' + segs.length + ':' + segs.reduce((a, s) => (a + s.id * 17 + (s.pf ? Math.round(s.pf.reduce((u, w) => u + w, 0)) : 0)) % 1e9, 0) + '|' + M3.cm.size
            + '|' + rws.length + ':' + rws.reduce((a, r) => (a + r.id * 13) % 1e9, 0) + '|' + sts.length + ':' + sts.reduce((a, t) => (a + t.id * 7 + (t.pl || 0) * 3 + (t.tr || 0)) % 1e9, 0)
            + '|' + M3.tgN;   // 近くの地形の網を作りなおしたら、のせなおす（t64）
  if (key === M3.bKey) return;
  M3.bKey = key;
  m3Clear(M3.grpB); m3Clear(M3.grpR);
  const T3 = M3.T;
  M3.labs = [];   // 建物の名前（t61）：[{x, y, h, n}]。駅（t62）は st
  // 区画（10m）→ 行ごとの長方形 → 同じ横はばの行をまとめる
  const W = { glass: [], grid: [], house: [], none: [] }, RF = [];
  const push = (arr, x, y, z, nx, ny, nz, c, u, w) => arr.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], u, w);
  const hex = (h, f) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255 * f, ((n >> 8) & 255) / 255 * f, (n & 255) / 255 * f]; };
  const FND = [0.64, 0.63, 0.60];   // 土台（坂の低いがわ。コンクリート）
  for (const b of bs) {
    const st = m3Style(b.kind, b), f = Math.max(0, b.floors);
    const hgt = f > 0 ? (f * M3_FH + 0.8) * M3_U : 0.25 * M3_U;
    const wc = hex(st.wc, st.jit), rcol = hex(f > 0 ? st.rc : (bcol(b.kind)[0] || '#bbb'), st.jit), wa = W[st.win] || W.none;
    // 長方形にまとめる
    const rows = new Map();
    for (const k of b.set) { const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1); let r = rows.get(y); if (!r) rows.set(y, r = []); r.push(x); }
    const runs = [];
    for (const [y, xs] of rows) { xs.sort((p, q) => p - q); let s0 = xs[0], p = xs[0]; for (let i = 1; i <= xs.length; i++) { if (i < xs.length && xs[i] === p + 1) { p = xs[i]; continue; } runs.push([s0, p, y]); if (i < xs.length) s0 = p = xs[i]; } }
    runs.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
    const rects = [];
    for (const r of runs) { const last = rects[rects.length - 1]; if (last && last[0] === r[0] && last[2] === r[1] && last[3] + 1 === r[2]) last[3] = r[2]; else rects.push([r[0], r[2], r[1], r[2]]); }
    if (!rects.length) continue;
    // 床の高さ（t64）：建物の下の地形の面の いちばん高いところ（坂でも 建物が地面に うまらない）。
    //   長方形ごとに いちばん低いところ（gl）も。そこまでは 土台（窓のないコンクリートの壁）
    let g0 = -Infinity; const gl = [];
    for (const [X0, Y0, X1, Y1] of rects) {
      const x0 = X0 / 5, z0 = Y0 / 5, x1 = (X1 + 1) / 5, z1 = (Y1 + 1) / 5, ni = Math.max(1, Math.ceil((x1 - x0) / 0.5)), nj = Math.max(1, Math.ceil((z1 - z0) / 0.5));
      let lo = Infinity;
      for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) { const h = m3Surf(x0 + (x1 - x0) * i / ni, z0 + (z1 - z0) * j / nj); if (h > g0) g0 = h; if (h < lo) lo = h; }
      gl.push(lo);
    }
    if (b.name) M3.labs.push({ x: b.cx, y: b.cy, h: g0 + hgt + 2 * M3_U, n: b.name, f });
    for (let ri = 0; ri < rects.length; ri++) {
      const [X0, Y0, X1, Y1] = rects[ri];
      const x0 = X0 / 5, z0 = Y0 / 5, x1 = (X1 + 1) / 5, z1 = (Y1 + 1) / 5, y0 = g0, y1 = g0 + hgt, fu = M3_FH * M3_U, yb = gl[ri] - 0.012;
      const fnd = f === 0 || g0 - gl[ri] > 0.006;   // 坂（床と いちばん低いところが 30cm 以上ちがう）：土台をつける。平らなら 壁を 少し下まで のばすだけ（階のない区画は いつも まわりを）
      // 壁（窓の模様：横 3.2m・たて1階ごと。窓の高さは床から）
      const yw = fnd ? y0 : yb, vw = (yw - y0) / fu;
      const wall = (ax, az, bx, bz, nx, nz) => { const L = Math.hypot(bx - ax, bz - az) / (3.2 * M3_U), H = (y1 - y0) / fu;
        push(wa, ax, yw, az, nx, 0, nz, wc, 0, vw); push(wa, bx, yw, bz, nx, 0, nz, wc, L, vw); push(wa, bx, y1, bz, nx, 0, nz, wc, L, H);
        push(wa, ax, yw, az, nx, 0, nz, wc, 0, vw); push(wa, bx, y1, bz, nx, 0, nz, wc, L, H); push(wa, ax, y1, az, nx, 0, nz, wc, 0, H); };
      if (f > 0) { wall(x0, z1, x1, z1, 0, 1); wall(x1, z1, x1, z0, 1, 0); wall(x1, z0, x0, z0, 0, -1); wall(x0, z0, x0, z1, -1, 0); }
      // 土台（t64）：床から地面まで（窓のないコンクリートの壁）。階のない区画（駐車場・広場など）は、そのまわり
      if (fnd) { const ya = f > 0 ? y0 : y1, fc = f > 0 ? FND : rcol.map(v => v * 0.82);
        const plain = (ax, az, bx, bz, nx, nz) => { push(W.none, ax, yb, az, nx, 0, nz, fc, 0, 0); push(W.none, bx, yb, bz, nx, 0, nz, fc, 0, 0); push(W.none, bx, ya, bz, nx, 0, nz, fc, 0, 0);
          push(W.none, ax, yb, az, nx, 0, nz, fc, 0, 0); push(W.none, bx, ya, bz, nx, 0, nz, fc, 0, 0); push(W.none, ax, ya, az, nx, 0, nz, fc, 0, 0); };
        plain(x0, z1, x1, z1, 0, 1); plain(x1, z1, x1, z0, 1, 0); plain(x1, z0, x0, z0, 0, -1); plain(x0, z0, x0, z1, -1, 0); }
      // 屋根
      const top = (ax, ay, az, bx, by, bz, cx2, cy2, cz2, nx, ny, nz) => { push(RF, ax, ay, az, nx, ny, nz, rcol, 0, 0); push(RF, bx, by, bz, nx, ny, nz, rcol, 0, 0); push(RF, cx2, cy2, cz2, nx, ny, nz, rcol, 0, 0); };
      const roof = f > 0 ? st.roof : 'flat', w = x1 - x0, d = z1 - z0;
      if (roof === 'gable' || roof === 'saw' || roof === 'hip') {
        const along = w >= d, rh = Math.min(w, d) * (roof === 'saw' ? 0.22 : 0.42), yr = y1 + rh;
        if (roof === 'hip') {
          const inset = Math.min(w, d) / 2;
          if (along) { const ra = x0 + inset, rb = x1 - inset, zm = (z0 + z1) / 2;
            top(x0, y1, z1, x1, y1, z1, rb, yr, zm, 0, 0.7, 0.7); top(x0, y1, z1, rb, yr, zm, ra, yr, zm, 0, 0.7, 0.7);
            top(x1, y1, z0, x0, y1, z0, ra, yr, zm, 0, 0.7, -0.7); top(x1, y1, z0, ra, yr, zm, rb, yr, zm, 0, 0.7, -0.7);
            top(x0, y1, z0, x0, y1, z1, ra, yr, zm, -0.7, 0.7, 0); top(x1, y1, z1, x1, y1, z0, rb, yr, zm, 0.7, 0.7, 0); }
          else { const ra = z0 + inset, rb = z1 - inset, xm = (x0 + x1) / 2;
            top(x1, y1, z0, x1, y1, z1, xm, yr, rb, 0.7, 0.7, 0); top(x1, y1, z0, xm, yr, rb, xm, yr, ra, 0.7, 0.7, 0);
            top(x0, y1, z1, x0, y1, z0, xm, yr, ra, -0.7, 0.7, 0); top(x0, y1, z1, xm, yr, ra, xm, yr, rb, -0.7, 0.7, 0);
            top(x0, y1, z0, x1, y1, z0, xm, yr, ra, 0, 0.7, -0.7); top(x1, y1, z1, x0, y1, z1, xm, yr, rb, 0, 0.7, 0.7); }
        } else if (roof === 'saw') {
          const nT = Math.max(1, Math.round((along ? w : d) / (12 * M3_U))), step = (along ? w : d) / nT;
          for (let q = 0; q < nT; q++) { if (along) { const a = x0 + q * step, c2 = a + step; top(a, y1, z0, c2, yr, z0, c2, yr, z1, -0.6, 0.8, 0); top(a, y1, z0, c2, yr, z1, a, y1, z1, -0.6, 0.8, 0); top(c2, yr, z0, c2, y1, z0, c2, y1, z1, 1, 0, 0); top(c2, yr, z0, c2, y1, z1, c2, yr, z1, 1, 0, 0); }
            else { const a = z0 + q * step, c2 = a + step; top(x0, y1, a, x0, yr, c2, x1, yr, c2, 0, 0.8, -0.6); top(x0, y1, a, x1, yr, c2, x1, y1, a, 0, 0.8, -0.6); top(x0, yr, c2, x0, y1, c2, x1, y1, c2, 0, 0, 1); top(x0, yr, c2, x1, y1, c2, x1, yr, c2, 0, 0, 1); } }
        } else {   // 切妻
          if (along) { const zm = (z0 + z1) / 2;
            top(x0, y1, z1, x1, y1, z1, x1, yr, zm, 0, 0.75, 0.66); top(x0, y1, z1, x1, yr, zm, x0, yr, zm, 0, 0.75, 0.66);
            top(x1, y1, z0, x0, y1, z0, x0, yr, zm, 0, 0.75, -0.66); top(x1, y1, z0, x0, yr, zm, x1, yr, zm, 0, 0.75, -0.66);
            top(x0, y1, z0, x0, y1, z1, x0, yr, zm, -1, 0, 0); top(x1, y1, z1, x1, y1, z0, x1, yr, zm, 1, 0, 0); }
          else { const xm = (x0 + x1) / 2;
            top(x1, y1, z0, x1, y1, z1, xm, yr, z1, 0.66, 0.75, 0); top(x1, y1, z0, xm, yr, z1, xm, yr, z0, 0.66, 0.75, 0);
            top(x0, y1, z1, x0, y1, z0, xm, yr, z0, -0.66, 0.75, 0); top(x0, y1, z1, xm, yr, z0, xm, yr, z1, -0.66, 0.75, 0);
            top(x0, y1, z0, x1, y1, z0, xm, yr, z0, 0, 0, -1); top(x1, y1, z1, x0, y1, z1, xm, yr, z1, 0, 0, 1); }
        }
      } else if (roof === 'dome') {
        const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, R = Math.min(w, d) / 2, N = 12;
        for (let a = 0; a < N; a++) { const t0 = a / N * Math.PI * 2, t1 = (a + 1) / N * Math.PI * 2;
          const p0 = [xm + Math.cos(t0) * R, zm + Math.sin(t0) * R], p1 = [xm + Math.cos(t1) * R, zm + Math.sin(t1) * R], nx = Math.cos((t0 + t1) / 2), nz = Math.sin((t0 + t1) / 2);
          top(p0[0], y1, p0[1], xm, y1 + R * 0.7, zm, p1[0], y1, p1[1], nx * 0.6, 0.8, nz * 0.6); }
        top(x0, y1, z0, x0, y1, z1, x1, y1, z1, 0, 1, 0); top(x0, y1, z0, x1, y1, z1, x1, y1, z0, 0, 1, 0);
      } else { top(x0, y1, z0, x0, y1, z1, x1, y1, z1, 0, 1, 0); top(x0, y1, z0, x1, y1, z1, x1, y1, z0, 0, 1, 0); }
    }
  }
  const mkMesh = (arr, tex, grp) => {
    if (!arr.length) return;
    const n = arr.length / 11, P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), UV = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const o = i * 11; P.set(arr.slice(o, o + 3), i * 3); N.set(arr.slice(o + 3, o + 6), i * 3); C.set(arr.slice(o + 6, o + 9), i * 3); UV[i * 2] = arr[o + 9]; UV[i * 2 + 1] = arr[o + 10]; }
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.BufferAttribute(P, 3)); g.setAttribute('normal', new T3.BufferAttribute(N, 3)); g.setAttribute('color', new T3.BufferAttribute(C, 3)); g.setAttribute('uv', new T3.BufferAttribute(UV, 2));
    const m = new T3.MeshLambertMaterial({ vertexColors: true, map: tex || null, side: T3.DoubleSide });
    grp.add(new T3.Mesh(g, m));
  };
  // 駅（t62）：ホーム（両がわ）・屋根・橋の上の駅舎。バス停は小さな待合所。名前は上に
  {
    const quad = (a, b, c, d, nn, col) => { for (const p of [a, c, b, a, d, c]) push(RF, p[0], p[1], p[2], nn[0], nn[1], nn[2], col, 0, 0); };   // 外から見て表になる向き
    const obox = (cx, cz, ang, L, Wd, y0, y1, col) => {
      const c = Math.cos(ang), sn = Math.sin(ang), P = (u, w) => [cx + c * u - sn * w, cz + sn * u + c * w];
      const A = P(-L / 2, -Wd / 2), B = P(L / 2, -Wd / 2), C = P(L / 2, Wd / 2), D = P(-L / 2, Wd / 2);
      quad([A[0], y1, A[1]], [B[0], y1, B[1]], [C[0], y1, C[1]], [D[0], y1, D[1]], [0, 1, 0], col);
      const side = (p, q2, nx, nz) => quad([p[0], y0, p[1]], [q2[0], y0, q2[1]], [q2[0], y1, q2[1]], [p[0], y1, p[1]], [nx, 0, nz], col);
      side(A, B, sn, -c); side(B, C, c, sn); side(C, D, -sn, c); side(D, A, -c, -sn);
    };
    const BED = [0.50, 0.47, 0.44], PLAT = [0.84, 0.84, 0.81], EDGE = [0.93, 0.80, 0.25], ROOF = [0.42, 0.52, 0.60], HALL = [0.94, 0.93, 0.89], HALLR = [0.62, 0.66, 0.70], BUS = [0.26, 0.45, 0.78];
    for (const t of sts) {
      let g0 = m3Surf(t.fx, t.fy);
      if (t.k === 'rail' && t.zl === 'U') {   // 地下駅（t108）：地上は出入口だけ
        obox(t.fx, t.fy, t.a || 0, 0.16, 0.1, g0 - 0.012, g0 + 3 * M3_U, HALL);
        obox(t.fx, t.fy, t.a || 0, 0.18, 0.12, g0 + 3 * M3_U, g0 + 3.4 * M3_U, HALLR);
        M3.labs.push({ x: t.fx, y: t.fy, h: g0 + 8 * M3_U, n: t.n, f: 99, st: 'rail' });
        continue;
      }
      // 駅の高さは、その駅の線路の高さ（t64。高架駅は高架の上・地面の駅は 線路の帯と同じ）
      let elev = t.k === 'rail' && t.zl === 'E';
      const sg = t.k === 'rail' && t.seg != null ? it.segs.get(t.seg) : null;
      if (sg) { const th = m3OnLine(sg, t.at || 0, t.fx, t.fy); if (th.c === 'V' || th.c === 'B') elev = true; g0 = elev ? Math.max(g0, th.y) : th.y; }
      if (t.k === 'rail') {
        const L = Math.max(0.4, (t.pl || 120) / 50), Wd = 0.22 * Math.max(1, t.tr || 1) + 0.18, pw = 0.11, a = t.a || 0, c = Math.cos(a), sn = Math.sin(a);
        // 線路の敷地：地面の駅は、坂の低いところも 地面まで うめる（ホームが うかないように）
        let gm = g0 - 0.2 * M3_U;
        if (!elev) for (const [u, w] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0], [-0.25, 0], [0.25, 0], [-0.5, 0], [0.5, 0]]) gm = Math.min(gm, m3Surf(t.fx + c * u * L - sn * w * Wd, t.fy + sn * u * L + c * w * Wd) - 0.012);
        obox(t.fx, t.fy, a, L + 0.06, Wd, gm, g0 + 0.15 * M3_U, BED);
        for (const sd of [-1, 1]) {   // ホーム（駅の両はし）と、その上の屋根
          const w = sd * (Wd / 2 - pw / 2), cx = t.fx - sn * w, cz = t.fy + c * w;
          obox(cx, cz, a, L, pw, g0, g0 + 1.1 * M3_U, PLAT);
          { const we = sd * (Wd / 2 - pw + 0.012); obox(t.fx - sn * we, t.fy + c * we, a, L, 0.016, g0 + 1.1 * M3_U, g0 + 1.16 * M3_U, EDGE); }   // 黄色い線（ホームのはし）
          obox(cx, cz, a, L * 0.62, pw + 0.03, g0 + 4.0 * M3_U, g0 + 4.5 * M3_U, ROOF);
        }
        const Lh = Math.min(0.6, L * 0.16 + 0.12);   // 橋の上の駅舎（線路の上をまたぐ）
        obox(t.fx, t.fy, a, Lh, Wd + 0.08, g0 + 6.5 * M3_U, g0 + 11 * M3_U, HALL);
        obox(t.fx, t.fy, a, Lh + 0.02, Wd + 0.1, g0 + 11 * M3_U, g0 + 11.6 * M3_U, HALLR);
        M3.labs.push({ x: t.fx, y: t.fy, h: g0 + 16 * M3_U, n: t.n, f: 99, st: 'rail' });
      } else if (t.k === 'bus') {
        obox(t.fx, t.fy, t.a || 0, 0.12, 0.04, g0, g0 + 2.6 * M3_U, BUS);
        M3.labs.push({ x: t.fx, y: t.fy, h: g0 + 5 * M3_U, n: t.n, f: 0, st: 'bus' });
      } else M3.labs.push({ x: t.fx, y: t.fy, h: g0 + 20 * M3_U, n: t.n, f: 99, st: t.k });
    }
  }
  for (const k of Object.keys(W)) mkMesh(W[k], M3.tex[k], M3.grpB);
  mkMesh(RF, null, M3.grpB);
  // 道路・線路：地面の少し上に帯で（道のはば・地形の面にそって。t64）
  //   地面（G）・縦断のない線：帯の左右のはしも 地形の面にそって（坂を横ぎっても うまらない）。縦断があれば その高さより下にしない（盛土は すそを地面まで）
  //   高架・橋（V・B）：縦断の高さに。1.5マスごとに はしら。トンネル（T）：描かない
  //   地形の折れ目で うまったり うきあがったりしないように、まん中が ずれたら 半分に（3回まで）
  const RD = [];
  const PIER = [0.56, 0.56, 0.57], EMB = [0.50, 0.47, 0.42];
  const quadV = (a, b, c, d, col) => { RD.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) RD.push(...col); };   // 四角ごとに 位置18・色18
  // 点 (x, y)（線の上の s）の帯の高さ：[左, 右, 左の地面, 右の地面, まん中の地面]（c：その区間の つくり）
  const hAt = (sg, x, y, s, nx, ny, lift, c) => {
    const gL = m3Surf(x + nx, y + ny), gR = m3Surf(x - nx, y - ny), gC = m3Surf(x, y);
    if (!sg || !sg.pf || !sg.L) return [gL + lift, gR + lift, gL, gR, gC];
    const z = pfZ(sg.pf, s) * M3_U * M3_VEX;
    if (c === 'V' || c === 'B') return [z + lift, z + lift, gL, gR, gC];
    return [Math.max(z, gL) + lift, Math.max(z, gR) + lift, gL, gR, gC];
  };
  // 帯の1区間：はじめ (x0, y0)・おわり (x1, y1)。左右へのずれは はじめ (nx0, ny0)・おわり (nx1, ny1)（つぎめで となりと そろえる）
  const piece = (sg, x0, y0, s0, nx0, ny0, x1, y1, s1, nx1, ny1, lift, c, col, A, B, dep) => {
    if (dep < 3 && c !== 'V' && c !== 'B' && Math.hypot(x1 - x0, y1 - y0) > 0.12) {
      const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, sm = (s0 + s1) / 2, nxm = (nx0 + nx1) / 2, nym = (ny0 + ny1) / 2, Mh = hAt(sg, xm, ym, sm, nxm, nym, lift, c);
      if (Math.abs(Mh[0] - (A[0] + B[0]) / 2) > 0.006 || Math.abs(Mh[1] - (A[1] + B[1]) / 2) > 0.006) {
        piece(sg, x0, y0, s0, nx0, ny0, xm, ym, sm, nxm, nym, lift, c, col, A, Mh, dep + 1); piece(sg, xm, ym, sm, nxm, nym, x1, y1, s1, nx1, ny1, lift, c, col, Mh, B, dep + 1); return;
      }
    }
    quadV([x0 + nx0, A[0], y0 + ny0], [x1 + nx1, B[0], y1 + ny1], [x1 - nx1, B[1], y1 - ny1], [x0 - nx0, A[1], y0 - ny0], col);
    // 盛土（地面の区間で、帯が地面より 1m 以上 上）：両はしから地面まで
    if (c !== 'V' && c !== 'B') {
      if (A[0] - lift - A[2] > 0.02 || B[0] - lift - B[2] > 0.02) quadV([x0 + nx0, A[2] - 0.006, y0 + ny0], [x1 + nx1, B[2] - 0.006, y1 + ny1], [x1 + nx1, B[0], y1 + ny1], [x0 + nx0, A[0], y0 + ny0], EMB);
      if (A[1] - lift - A[3] > 0.02 || B[1] - lift - B[3] > 0.02) quadV([x0 - nx0, A[3] - 0.006, y0 - ny0], [x1 - nx1, B[3] - 0.006, y1 - ny1], [x1 - nx1, B[1], y1 - ny1], [x0 - nx0, A[1], y0 - ny0], EMB);
    }
  };
  // 線 sg（なければ 点の列 P だけ）を、はば wdt の帯に
  const band = (sg, P, n, wdt, col, lift) => {
    const pw = Math.max(0.03, wdt * 0.22), st = sg && sg.pf && sg.L ? (sg.st || '') : ''; let nextPier = 0, acc = 0;
    // 点ごとの左右へのずれ：前後の区間の向きの まん中（つぎめに すきまが出ないように。t64）。するどい曲がりは 2倍まで
    const NX = new Float32Array(n), NY = new Float32Array(n), dir = k => { const dx = P[2 * k + 2] - P[2 * k], dy = P[2 * k + 3] - P[2 * k + 1], L = Math.hypot(dx, dy); return L < 1e-6 ? null : [-dy / L, dx / L]; };
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? dir(i - 1) : null, b = i < n - 1 ? dir(i) : null, u = a && b ? [a[0] + b[0], a[1] + b[1]] : (a || b); if (!u) continue;
      const L = Math.hypot(u[0], u[1]); if (L < 1e-6) { const v = b || a; NX[i] = v[0] * wdt / 2; NY[i] = v[1] * wdt / 2; continue; }
      const ux = u[0] / L, uy = u[1] / L, v = b || a, cs = Math.max(0.5, ux * v[0] + uy * v[1]);
      NX[i] = ux / cs * wdt / 2; NY[i] = uy / cs * wdt / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[2 * i + 2], by = P[2 * i + 3], D = Math.hypot(bx - ax, by - ay); if (D < 1e-6) continue;
      const L0 = sg && sg.L ? sg.L[i] : acc; acc += D;
      const m = Math.max(1, Math.ceil(D));
      for (let q = 0; q < m; q++) {
        const t0 = q / m, t1 = (q + 1) / m, s0 = L0 + D * t0, s1 = L0 + D * t1, c = st[Math.min(st.length - 1, Math.max(0, Math.round((s0 + s1) / 2)))] || 'G';
        if (c === 'T') continue;
        const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
        const nx0 = NX[i] + (NX[i + 1] - NX[i]) * t0, ny0 = NY[i] + (NY[i + 1] - NY[i]) * t0, nx1 = NX[i] + (NX[i + 1] - NX[i]) * t1, ny1 = NY[i] + (NY[i + 1] - NY[i]) * t1;
        const A = hAt(sg, x0, y0, s0, nx0, ny0, lift, c), B = hAt(sg, x1, y1, s1, nx1, ny1, lift, c);
        piece(sg, x0, y0, s0, nx0, ny0, x1, y1, s1, nx1, ny1, lift, c, col, A, B, 0);
        if ((c === 'V' || c === 'B') && s0 >= nextPier && A[0] - lift > A[4] + 2 * M3_U) {   // はしら（十字の板）
          const top = A[0] - lift, g = A[4];
          quadV([x0 - pw, g, y0], [x0 + pw, g, y0], [x0 + pw, top, y0], [x0 - pw, top, y0], PIER);
          quadV([x0, g, y0 - pw], [x0, g, y0 + pw], [x0, top, y0 + pw], [x0, top, y0 - pw], PIER);
          nextPier = s0 + 1.5;
        }
      }
    }
  };
  for (const s of segs) {
    const isRail = s.k === 'rail', wdt = Math.max(isRail ? 0.18 : 0.14, s.w || 0.2), col = isRail ? [0.42, 0.38, 0.35] : (s.c === 'exp' ? [0.62, 0.66, 0.72] : [0.72, 0.72, 0.70]);
    band(s, s.P, s.np, wdt, col, M3_LIFT);
  }
  // 滑走路（t61）：黒っぽい帯（はば r.w マス）と、白い中心線
  for (const r of rws) {
    const [ax, ay, bx, by] = r.P;
    band(null, [ax, ay, bx, by], 2, r.w || 1.2, [0.30, 0.31, 0.33], 0.07 * M3_U * 20);
    band(null, [ax + r.ux * 0.6, ay + r.uy * 0.6, bx - r.ux * 0.6, by - r.uy * 0.6], 2, 0.04, [0.95, 0.95, 0.93], 0.09 * M3_U * 20);
  }
  if (RD.length) {   // 四角ごとに 位置18・色18 の順
    const P = [], C = [];
    for (let i = 0; i < RD.length; i += 36) { P.push(...RD.slice(i, i + 18)); C.push(...RD.slice(i + 18, i + 36)); }
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T3.Float32BufferAttribute(C, 3)); g.computeVertexNormals();
    M3.grpR.add(new T3.Mesh(g, new T3.MeshBasicMaterial({ vertexColors: true, side: T3.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  }
}

/* ---------- 走行位置（t61・t62）：列車は両ごと、バス・船・飛行機は1つの箱。線路・道路・航路の上を、ダイヤのとおりに。
   大きさは決まった大きさ（遠くから見ても大きくしない）。上りと下りは進む向きの左にずらす ---------- */
function m3Runs(v) {
  const T3 = M3.T;
  M3.runHit = []; M3.selLab = null;
  if (!S.layer.run) { if (M3.run) M3.run.visible = false; if (M3.mark) M3.mark.visible = false; return; }
  const it = visibleItems(), list = runList(it, v);
  let n = 0; for (const o of list) n += o.R.k === 'rail' ? o.T.fn : 1;
  if (!M3.run || M3.runCap < n) {
    if (M3.run) { M3.sc.remove(M3.run); M3.run.geometry.dispose(); M3.run.material.dispose(); }
    M3.runCap = Math.max(64, Math.ceil(n * 1.5));
    M3.run = new T3.InstancedMesh(new T3.BoxGeometry(1, 1, 1), new T3.MeshLambertMaterial({ color: '#ffffff', emissive: '#2a2a2a' }), M3.runCap);
    M3.run.instanceMatrix.setUsage(T3.DynamicDrawUsage); M3.run.frustumCulled = false; M3.sc.add(M3.run);
  }
  const ppx = 0.828 * M3.d / Math.max(300, S.H);   // 画面の 1px が、だいたい何マスか（まん中の距離で）
  const m = new T3.Matrix4(), q = new T3.Quaternion(), pos = new T3.Vector3(), sc = new T3.Vector3(), up = new T3.Vector3(0, 1, 0), col = new T3.Color();
  let i = 0, selP = null;
  for (const o of list) {
    const k = o.R.k, cars = k === 'rail' ? o.T.fn : 1, sel = runIsSel(o);
    // 大きさは決まった大きさ（t62：遠くから見ても大きくしない）。見やすいように、はばと高さは本物より少し大きめ
    const hh = (k === 'rail' ? 4.6 : k === 'bus' ? 3.6 : k === 'ship' ? 9 : 5) * M3_U, ww = (k === 'rail' ? 5.5 : k === 'bus' ? 4 : k === 'ship' ? 16 : 30) * M3_U;
    const cl = o.car, gap = k === 'rail' ? cl * 0.05 : 0;
    const off0 = k === 'rail' || k === 'bus' ? ww / 2 + 0.8 * M3_U : 0;   // 進む向きの左
    col.set(o.R.c || '#d23');
    for (let c = 0; c < cars; c++) {
      const dc = o.d - (c + 0.5) * cl, p = runPt(o.H, dc);
      // 高さ（t64）：走っている線の高さ（高架は高架の上・地面は帯の上）。トンネル・地下は見せない。単線の鉄道は まん中を
      const ref = k === 'rail' || k === 'bus' ? runRef(o.H, dc) : null, sg = ref ? it.segs.get(ref[0]) : null;
      const off = sg && k === 'rail' && !sg.dbl && !sg.q ? 0 : off0, px = p[0] + Math.sin(p[2]) * off, pz = p[1] - Math.cos(p[2]) * off;
      let y, hide = false;
      if (k === 'ship') y = 0.05 * M3_U;
      else if (sg) { const th = m3OnLine(sg, ref[1], p[0], p[1]); hide = th.c === 'T'; y = (th.c === 'V' || th.c === 'B' ? th.y : Math.max(th.y, m3Surf(px, pz))) + M3_LIFT + 0.1 * M3_U; }
      else y = m3Surf(px, pz) + M3_LIFT + 0.1 * M3_U;
      if (k === 'air') { const f = o.H.len > 0 ? o.d / o.H.len : 0; y = Math.max(y, Math.min(1, 6 * f, 6 * (1 - f)) * 900 * M3_U); }   // 飛行機：まん中は 900m の高さ
      if (hide) { if (c === 0 && sel) selP = [px, m3Surf(px, pz) + hh, pz, ww]; continue; }   // トンネルの中：えらんだ列車は しるしだけ（地上に）
      pos.set(px, y + hh / 2, pz); q.setFromAxisAngle(up, -p[2]); sc.set(cl - gap, hh, ww);
      m.compose(pos, q, sc); M3.run.setMatrixAt(i, m); M3.run.setColorAt(i, col); i++;
      M3.runHit.push({ o, x: px, y: y + hh / 2, z: pz });
      if (c === 0 && sel) selP = [px, y + hh, pz, ww];
    }
  }
  M3.run.count = i; M3.run.visible = i > 0;
  M3.run.instanceMatrix.needsUpdate = true; if (M3.run.instanceColor) M3.run.instanceColor.needsUpdate = true;
  // えらんだ列車のしるし（黄色の、下向きの三角）と名前
  if (!M3.mark) { M3.mark = new T3.Mesh(new T3.ConeGeometry(0.5, 1, 4), new T3.MeshBasicMaterial({ color: '#ffc400' })); M3.mark.rotation.x = Math.PI; M3.sc.add(M3.mark); }
  if (selP) {
    const z = Math.max(selP[3] * 1.3, 16 * ppx); M3.mark.scale.set(z, z * 1.4, z); M3.mark.position.set(selP[0], selP[1] + z * 1.3, selP[2]); M3.mark.visible = true;
    const sl = list.find(o => runIsSel(o)); if (sl) M3.selLab = { x: selP[0], y: selP[2], h: selP[1] + z * 2.2, n: runName(sl.T) + ' → ' + runDest(sl.R, sl.T) };
  } else M3.mark.visible = false;
}
// 3D をタップ：いちばん近い列車・バス（画面で 26px まで）の情報
function m3Tap(cx, cy) {
  if (!S.layer.run || !M3.runHit || !M3.runHit.length) return;
  const r = M3.cv.getBoundingClientRect(), X = cx - r.left, Y = cy - r.top, v = new M3.T.Vector3();
  let best = null, bd = Infinity;
  for (const h of M3.runHit) {
    v.set(h.x, h.y, h.z).project(M3.cam); if (v.z > 1 || v.z < -1) continue;
    const d = Math.hypot((v.x + 1) / 2 * S.W - X, (1 - v.y) / 2 * S.H - Y);
    if (d < 26 && d < bd) { bd = d; best = h.o; }
  }
  if (best) showTrain(best.R, best.T);
}
/* ---------- 建物の名前（t61）：上がきのキャンバスに、近いものから・重ならないように ---------- */
function m3Labels() {
  const g = S.ctxr; if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S.cvr.width, S.cvr.height);
  const labs = M3.labs || [];
  if (!labs.length && !M3.selLab) return;
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  const v = new M3.T.Vector3(), cam = M3.cam, cx = cam.position.x, cz = cam.position.z, used = [];
  const at = l => { v.set(l.x, l.h, l.y).project(cam); if (v.z > 1 || v.z < -1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) return null; return [(v.x + 1) / 2 * S.W, (1 - v.y) / 2 * S.H - 3]; };
  const box = (t, X, Y, font, fg, bg, bd) => {
    g.font = font; const w = g.measureText(t).width + 10, h = 19;
    if (Y < 50 || used.some(r => X - w / 2 < r[2] && X + w / 2 > r[0] && Y - h < r[3] && Y > r[1])) return false;
    used.push([X - w / 2, Y - h, X + w / 2, Y]);
    if (bg) { g.fillStyle = bg; g.strokeStyle = bd; g.lineWidth = 1.5; g.beginPath(); g.rect(X - w / 2, Y - h, w, h); g.fill(); g.stroke(); g.fillStyle = fg; g.fillText(t, X, Y - 3.5); }
    else { g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(t, X, Y - 2); g.fillStyle = fg; g.fillText(t, X, Y - 2); }
    return true;
  };
  g.textAlign = 'center'; g.textBaseline = 'bottom'; g.lineJoin = 'round';
  // えらんだ列車（いちばん上）
  if (M3.selLab) { const p = at(M3.selLab); if (p) box(M3.selLab.n, p[0], p[1], '700 12px system-ui, sans-serif', '#222', 'rgba(255,236,150,.97)', '#c99a00'); }
  // 駅（t62）：近いものから。遠すぎるときは出さない
  if (M3.d <= 420) {
    let n = 0;
    for (const [l] of labs.filter(l => l.st && (l.st !== 'bus' || M3.d <= 70)).map(l => [l, (l.x - cx) ** 2 + (l.y - cz) ** 2]).sort((a, b) => a[1] - b[1])) {
      if (n >= 40) break;
      const p = at(l); if (!p) continue;
      if (l.st === 'bus') { if (box(l.n, p[0], p[1], '700 11px system-ui, sans-serif', '#164f99', null)) n++; }
      else if (box(l.n, p[0], p[1], '800 13px system-ui, sans-serif', '#123a7a', 'rgba(255,255,255,.96)', '#1f5fbf')) n++;
    }
  }
  // 建物の名前（設定で）
  if (!S.v3names || M3.d > 260) return;
  const L = labs.filter(l => !l.st).map(l => [l, (l.x - cx) ** 2 + (l.y - cz) ** 2 - l.f * 4]).sort((a, b) => a[1] - b[1]);
  let n = 0;
  for (const [l] of L) {
    if (n >= 70) break;
    const p = at(l); if (!p) continue;
    if (box(l.n, p[0], p[1], '700 12px system-ui, sans-serif', '#1d2733', null)) n++;
  }
}

/* ---------- さわりかた：1本指＝うごかす・2本指＝ひろげる／回す／かたむける・ホイール＝ズーム・右ドラッグ＝回す ---------- */
function m3Bind(cv) {
  const P = new Map(); let last = null;
  const pan = (dx, dy) => {
    const k = M3.d * 2 * Math.tan(22.5 * Math.PI / 180) / Math.max(1, S.H), c = Math.cos(M3.yaw), s = Math.sin(M3.yaw);
    M3.tx -= (dx * c + dy * s / Math.max(0.35, Math.sin(M3.pitch))) * k; M3.ty -= (-dx * s + dy * c / Math.max(0.35, Math.sin(M3.pitch))) * k;
  };
  // 惰性（t61）：さいごの 100ms の動き（うごかす：画面の px・回す：yaw）をおぼえて、はなしたら少しすべる
  let hist = [];
  const mark = e => { const t = evT(e); hist.push([t, M3.tx, M3.ty, M3.yaw]); while (hist.length > 2 && t - hist[0][0] > 100) hist.shift(); };
  const glide = () => {
    const g = M3.glide; if (!g || !M3.on) { M3.glide = null; return; }
    const t = now(), dt = Math.min(48, t - g.t); g.t = t;
    M3.tx += g.vx * dt; M3.ty += g.vy * dt; M3.yaw += g.vr * dt;
    const k = Math.exp(-dt / 325); g.vx *= k; g.vy *= k; g.vr *= k; S.dirty = true;
    if (Math.hypot(g.vx, g.vy) / Math.max(1e-6, M3.d) < 0.00002 && Math.abs(g.vr) < 0.00005) { M3.glide = null; return; }
    requestAnimationFrame(glide);
  };
  const letGo = e => {
    if (!S.inertia || hist.length < 2) { hist = []; return; }
    const a = hist[0], b = hist[hist.length - 1], dt = b[0] - a[0];
    if (dt > 8 && evT(e) - b[0] < 60) {
      const vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt, vr = Math.max(-0.004, Math.min(0.004, (b[3] - a[3]) / dt));   // 回る惰性は 1 回転の 1/5 ぐらいまで
      if (Math.hypot(vx, vy) / Math.max(1e-6, M3.d) > 0.0001 || Math.abs(vr) > 0.0003) { M3.glide = { vx, vy, vr, t: now() }; requestAnimationFrame(glide); }
    }
    hist = [];
  };
  let tap0 = null;   // タップ（列車の情報。t62）：ほとんど動かさずに、すぐはなしたとき
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); last = null; cv.style.cursor = 'grabbing'; M3.glide = null; hist = [];
    tap0 = P.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId } : null; });
  cv.addEventListener('pointermove', e => {
    const p = P.get(e.pointerId); if (!p) return;
    M3.glide = null;
    if (tap0 && Math.hypot(e.clientX - tap0.x, e.clientY - tap0.y) > 8) tap0 = null;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (P.size === 1) {
      if (p.b === 2 || p.sh) { M3.yaw -= dx * 0.006 * (S.v3x ? -1 : 1); M3.pitch = Math.max(0.22, Math.min(1.5, M3.pitch + dy * 0.005)); }
      else { pan(dx, dy); if (!tap0 && RUN && RUN.follow) runFollow(0); }   // 自分でうごかしたら、追跡をやめる（t62）
    } else if (P.size === 2) {
      const [a, b] = [...P.values()], ids = [...P.keys()];
      const na = ids[0] === e.pointerId ? { x: e.clientX, y: e.clientY } : a, nb = ids[1] === e.pointerId ? { x: e.clientX, y: e.clientY } : b;
      const d0 = Math.hypot(b.x - a.x, b.y - a.y), d1 = Math.hypot(nb.x - na.x, nb.y - na.y);
      const a0 = Math.atan2(b.y - a.y, b.x - a.x), a1 = Math.atan2(nb.y - na.y, nb.x - na.x);
      if (d0 > 10 && d1 > 10) M3.d = Math.max(4, Math.min(900, M3.d * d0 / d1));
      let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      M3.yaw += da * (S.v3x ? -1 : 1);   // 2本指でひねった向きに地図が回る（⇄ 左右反転で反対に）
      const my0 = (a.y + b.y) / 2, my1 = (na.y + nb.y) / 2;
      M3.pitch = Math.max(0.22, Math.min(1.5, M3.pitch + (my1 - my0) * 0.004));
    }
    p.x = e.clientX; p.y = e.clientY; S.dirty = true; mark(e);
  });
  const up = e => { const n0 = P.size; P.delete(e.pointerId); if (!P.size) cv.style.cursor = 'grab';
    if (e.type === 'pointerup' && tap0 && tap0.id === e.pointerId && n0 === 1 && now() - tap0.t < 500) { const tp = tap0; tap0 = null; m3Tap(tp.x, tp.y); return; }
    tap0 = null;
    if (e.type === 'pointerup' && n0 === 1 && P.size === 0) letGo(e); else if (e.type === 'pointerup' && P.size === 1 && n0 === 2) letGo(e); };   // 2本指をはなしたら、回る惰性
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); M3.d = Math.max(4, Math.min(900, M3.d * Math.pow(1.0015, e.deltaY))); S.dirty = true; }, { passive: false });
}
function m3Zoom(f) { M3.d = Math.max(4, Math.min(900, M3.d / f)); }
function m3Target(x, y) { M3.tx = x; M3.ty = y; }
function m3Resize() { if (!M3.on) return; M3.r.setPixelRatio(m3PR()); M3.r.setSize(S.W, S.H, false); M3.cam.aspect = S.W / Math.max(1, S.H); M3.cam.updateProjectionMatrix(); }

M3.surf = m3Surf;   // 地形の面の高さ（たしかめる用。t64）
Object.assign(window, { m3Open, m3Close, m3Frame, m3Zoom, m3Target, m3Resize, m3State: M3 });
})();
