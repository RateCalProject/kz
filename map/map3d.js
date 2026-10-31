/* ===== 風の芽経済組：国土の地図 3D（t61）=====
   地図をななめから見る：地形（チャンクの標高・地形・用途地域）・建物（区画・階数・プリセットの見た目）・道路・線路を立体に
   three.js（cdnjs r128）は、はじめて 3D にしたときだけ読む。3D は見るだけ（工事などの道具は 2D で）
   map.js のあとに読む（S・CS・tileAt・visibleItems・pOf・bcol などを使う） */
(function () {
'use strict';
// map.js の中のもの（window.MapInt）を使う
let S, CS, tileAt, visibleItems, needChunks, needCells, ckey, pOf, bcol, hint, saveCam, now, evT, runList, runPt, clearRunLayer, RUN, runIsSel, runName, runDest, showTrain, runFollow, PAL;
function m3Init() { ({ S, CS, tileAt, visibleItems, needChunks, needCells, ckey, pOf, bcol, hint, saveCam, now, evT, runList, runPt, clearRunLayer, RUN, runIsSel, runName, runDest, showTrain, runFollow } = window.MapInt); PAL = window.MapPal; }
const M3 = { on: false, loading: false };
const M3_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const M3_FH = 3.4;          // 1階の高さ（m）
const M3_U = 1 / 50;        // 1m → マス
const M3_VEX = 1.15;        // 地形の高さを少しだけ大きく（見やすく）

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
  // logarithmicDepthBuffer：遠くと近くを両方きれいに（深さの精度）
  try { r = new T3.WebGLRenderer({ canvas: cv, antialias: true, logarithmicDepthBuffer: !!M3.logz }); } catch (e) { cv.remove(); alertMsg('この端末では 3D が使えません'); return; }
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(S.W, S.H, false);
  const sc = new T3.Scene(); sc.background = new T3.Color('#b9d3ea'); sc.fog = new T3.Fog('#b9d3ea', 200, 900);
  const cam = new T3.PerspectiveCamera(45, S.W / Math.max(1, S.H), 0.05, 4000);
  sc.add(new T3.HemisphereLight('#e8f0ff', '#7d7566', 0.68));
  const sun = new T3.DirectionalLight('#fff6e8', 0.55); sun.position.set(-0.35, 1.2, 0.55); sc.add(sun);   // 南西の高いところから（北を見るとき、手前の壁が明るい）
  const sea = new T3.Mesh(new T3.PlaneGeometry(20000, 20000), new T3.MeshLambertMaterial({ color: '#4680ba' })); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.4; sc.add(sea);   // チャンクのない深い海（チャンクの海は高さ 0）
  const grpT = new T3.Group(), grpB = new T3.Group(), grpR = new T3.Group(); sc.add(grpT, grpB, grpR);
  Object.assign(M3, { on: true, T: T3, r, sc, cam, sea, grpT, grpB, grpR, cv, cm: new Map(), bKey: '', rKey: '', tex: null,
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
  for (const g of [M3.grpT, M3.grpB, M3.grpR]) m3Clear(g);
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
function m3Ground(x, y) { const t = tileAt(Math.floor(x), Math.floor(y)); if (!t) return 0; return (t.t === 'D' || t.t === 'S') ? 0 : Math.max(0, t.e) * M3_U * M3_VEX; }
function m3Cam() {
  const { cam } = M3, c = Math.cos(M3.pitch), s = Math.sin(M3.pitch);
  const gy = m3Ground(M3.tx, M3.ty); M3.gy += (gy - M3.gy) * 0.35;
  cam.position.set(M3.tx + Math.sin(M3.yaw) * c * M3.d, M3.gy + s * M3.d, M3.ty + Math.cos(M3.yaw) * c * M3.d);
  cam.lookAt(M3.tx, M3.gy, M3.ty);
  cam.far = Math.max(600, M3.d * 14); cam.near = Math.max(0.05, M3.d / 400); cam.updateProjectionMatrix();
  M3.sc.fog.near = M3.d * 1.6; M3.sc.fog.far = M3.d * 1.6 + Math.max(260, M3.d * 6);
}
// 読むはんい：地形は広く、建物・道路は近くだけ
function m3Rects() {
  const R = Math.max(70, Math.min(700, M3.d * 4.2)), RB = Math.max(40, Math.min(220, M3.d * 2.2));
  return { big: { x0: M3.tx - R, y0: M3.ty - R, x1: M3.tx + R, y1: M3.ty + R }, near: { x0: M3.tx - RB, y0: M3.ty - RB, x1: M3.tx + RB, y1: M3.ty + RB } };
}
function m3Frame() {
  if (!M3.on) return;
  const rc = m3Rects();
  // 地形：チャンクを読む（2D の読みこみを、このはんいで）
  S.cam.x = M3.tx; S.cam.y = M3.ty;
  S.v3rect = rc.big; S.cam.z = 2; needChunks(); trimChunks3(rc.big);
  S.v3rect = rc.near; S.cam.z = M3.d < 160 ? 8 : 3; needCells();
  m3Terrain(rc.big);
  m3Blds(rc.near);
  try { m3Runs(rc.near); } catch (e) { console.error(e); }   // 列車・バス（t61）
  m3Cam();
  M3.r.render(M3.sc, M3.cam);
  m3Labels();   // 建物の名前（t61）
  if (Math.abs(m3Ground(M3.tx, M3.ty) - M3.gy) > 0.002) M3.dirty = true;
}
// 3D のときのチャンクの片づけ（遠いものから。2D の trimChunks は 2D の見えかたで決めるので使わない）
function trimChunks3(v) {
  if (S.chunks.size < 900) return;
  const far = [...S.chunks.entries()].filter(([, c]) => !(c.cx * CS + CS >= v.x0 && c.cx * CS <= v.x1 && c.cy * CS + CS >= v.y0 && c.cy * CS <= v.y1)).sort((a, b) => a[1].used - b[1].used);
  for (const [k] of far.slice(0, S.chunks.size - 800)) S.chunks.delete(k);
}

/* ---------- 地形：チャンクごとの網（遠いほどあらく） ---------- */
function m3Terrain(v) {
  const T3 = M3.T, cx0 = Math.floor(v.x0 / CS), cy0 = Math.floor(v.y0 / CS), cx1 = Math.floor(v.x1 / CS), cy1 = Math.floor(v.y1 / CS);
  const keep = new Set(); let made = 0;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const k = ckey(cx, cy), c = S.chunks.get(k); if (!c || c.sea) continue;
    c.used = now(); keep.add(k);
    const dist = Math.hypot(cx * CS + 32 - M3.tx, cy * CS + 32 - M3.ty), st = dist < Math.max(160, M3.d * 1.4) ? 1 : dist < Math.max(360, M3.d * 3) ? 2 : dist < 700 ? 4 : 8;
    const nb = [[1, 0], [0, 1], [1, 1]].map(([dx, dy]) => S.chunks.get(ckey(cx + dx, cy + dy)) ? 'y' : 'n').join('');   // となりがあるか（へりをつなぐため）
    const old = M3.cm.get(k);
    if (old && old.st === st && old.nb === nb) continue;
    if (made >= 8) { M3.dirty = true; continue; }   // 1フレームに作るのは少しずつ
    if (old) { M3.grpT.remove(old.mesh); old.mesh.geometry.dispose(); }
    const mesh = m3ChunkMesh(T3, c, cx, cy, st); M3.grpT.add(mesh); M3.cm.set(k, { mesh, st, nb }); made++;
  }
  for (const [k, o] of M3.cm) if (!keep.has(k)) { M3.grpT.remove(o.mesh); o.mesh.geometry.dispose(); M3.cm.delete(k); }
}
const M3_TMAT = { m: null };
function m3ChunkMesh(T3, c, cx, cy, st) {
  const n = CS / st + 1, pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), idx = [];
  const at = (x, y) => { const t = tileAt(x, y); return t && !(t.t === 'D' && t.e === -190 && !S.chunks.get(ckey(Math.floor(x / CS), Math.floor(y / CS)))) ? t : tileAt(Math.min(x, cx * CS + CS - 1), Math.min(y, cy * CS + CS - 1)); };
  // 標高はとびとびの段（高いところは 150m ごと）なので、まわりとならして段々にならないように（2回ならす）
  const R = 3, M = 2 * R + 2, G = CS + 2 * M + 1, x00 = cx * CS - M, y00 = cy * CS - M;
  let E = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const t = tileAt(x00 + i, y00 + j); E[j * G + i] = !t || t.t === 'D' || t.t === 'S' ? 0 : Math.max(0, t.e); }
  const box = (A, H) => { const B = new Float32Array(G * G); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let s2 = 0, m = 0; for (let k = -R; k <= R; k++) { const ii = H ? i + k : i, jj = H ? j : j + k; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue; s2 += A[jj * G + ii]; m++; } B[j * G + i] = s2 / m; } return B; };
  for (let p = 0; p < 2; p++) E = box(box(E, true), false);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cx * CS + Math.min(i * st, CS), y = cy * CS + Math.min(j * st, CS), t = at(x, y) || { t: 'D', e: 0, z: '-' };
    const water = t.t === 'D' || t.t === 'S', h = water ? 0 : Math.max(0.02, E[(y - y00) * G + (x - x00)]) * M3_U * M3_VEX;
    const o = (j * n + i) * 3; pos[o] = x + 0.5; pos[o + 1] = h; pos[o + 2] = y + 0.5;
    const cc = PAL.tileColor(t.t, t.e, t.z || '-', 0);
    col[o] = cc[0] / 255; col[o + 1] = cc[1] / 255; col[o + 2] = cc[2] / 255;
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, d = a + n, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new T3.BufferGeometry();
  g.setAttribute('position', new T3.BufferAttribute(pos, 3)); g.setAttribute('color', new T3.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (!M3_TMAT.m) { M3_TMAT.m = new T3.MeshLambertMaterial({ vertexColors: true }); M3_TMAT.m.keep = true; }
  return new T3.Mesh(g, M3_TMAT.m);
}

/* ---------- 建物・道路・線路 ---------- */
function m3Blds(v) {
  const it = visibleItems();   // S.v3rect（近いはんい）・S.cam.z（細かさ）は m3Frame で合わせてある
  const bs = [...it.blds.values()].filter(b => b.bb[2] >= v.x0 && b.bb[0] <= v.x1 && b.bb[3] >= v.y0 && b.bb[1] <= v.y1);
  const segs = [...it.segs.values()].filter(s => s.bb[2] >= v.x0 && s.bb[0] <= v.x1 && s.bb[3] >= v.y0 && s.bb[1] <= v.y1);
  const rws = [...(it.rwys ? it.rwys.values() : [])].filter(r => r.bb && r.bb[2] >= v.x0 && r.bb[0] <= v.x1 && r.bb[3] >= v.y0 && r.bb[1] <= v.y1);
  const sts = [...it.stas.values()].filter(t => t.fx >= v.x0 - 2 && t.fx <= v.x1 + 2 && t.fy >= v.y0 - 2 && t.fy <= v.y1 + 2);   // 駅（t62）
  const key = bs.length + ':' + bs.reduce((a, b) => (a + b.id * 31 + b.floors) % 1e9, 0) + '|' + segs.length + ':' + segs.reduce((a, s) => (a + s.id * 17) % 1e9, 0) + '|' + M3.cm.size
            + '|' + rws.length + ':' + rws.reduce((a, r) => (a + r.id * 13) % 1e9, 0) + '|' + sts.length + ':' + sts.reduce((a, t) => (a + t.id * 7 + (t.pl || 0) * 3 + (t.tr || 0)) % 1e9, 0);
  if (key === M3.bKey) return;
  M3.bKey = key;
  m3Clear(M3.grpB); m3Clear(M3.grpR);
  const T3 = M3.T;
  M3.labs = [];   // 建物の名前（t61）：[{x, y, h, n}]。駅（t62）は st
  // 区画（10m）→ 行ごとの長方形 → 同じ横はばの行をまとめる
  const W = { glass: [], grid: [], house: [], none: [] }, RF = [];
  const push = (arr, x, y, z, nx, ny, nz, c, u, w) => arr.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], u, w);
  const hex = (h, f) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255 * f, ((n >> 8) & 255) / 255 * f, (n & 255) / 255 * f]; };
  for (const b of bs) {
    const st = m3Style(b.kind, b), f = Math.max(0, b.floors);
    const g0 = m3Ground(b.cx, b.cy) - 0.01, hgt = f > 0 ? (f * M3_FH + 0.8) * M3_U : 0.25 * M3_U;
    if (b.name) M3.labs.push({ x: b.cx, y: b.cy, h: g0 + hgt + 2 * M3_U, n: b.name, f });
    const wc = hex(st.wc, st.jit), rcol = hex(f > 0 ? st.rc : (bcol(b.kind)[0] || '#bbb'), st.jit), wa = W[st.win] || W.none;
    // 長方形にまとめる
    const rows = new Map();
    for (const k of b.set) { const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1); let r = rows.get(y); if (!r) rows.set(y, r = []); r.push(x); }
    const runs = [];
    for (const [y, xs] of rows) { xs.sort((p, q) => p - q); let s0 = xs[0], p = xs[0]; for (let i = 1; i <= xs.length; i++) { if (i < xs.length && xs[i] === p + 1) { p = xs[i]; continue; } runs.push([s0, p, y]); if (i < xs.length) s0 = p = xs[i]; } }
    runs.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
    const rects = [];
    for (const r of runs) { const last = rects[rects.length - 1]; if (last && last[0] === r[0] && last[2] === r[1] && last[3] + 1 === r[2]) last[3] = r[2]; else rects.push([r[0], r[2], r[1], r[2]]); }
    for (const [X0, Y0, X1, Y1] of rects) {
      const x0 = X0 / 5, z0 = Y0 / 5, x1 = (X1 + 1) / 5, z1 = (Y1 + 1) / 5, y0 = g0, y1 = g0 + hgt, fu = M3_FH * M3_U;
      // 壁（窓の模様：横 3.2m・たて1階ごと）
      const wall = (ax, az, bx, bz, nx, nz) => { const L = Math.hypot(bx - ax, bz - az) / (3.2 * M3_U), H = (y1 - y0) / fu;
        push(wa, ax, y0, az, nx, 0, nz, wc, 0, 0); push(wa, bx, y0, bz, nx, 0, nz, wc, L, 0); push(wa, bx, y1, bz, nx, 0, nz, wc, L, H);
        push(wa, ax, y0, az, nx, 0, nz, wc, 0, 0); push(wa, bx, y1, bz, nx, 0, nz, wc, L, H); push(wa, ax, y1, az, nx, 0, nz, wc, 0, H); };
      if (f > 0) { wall(x0, z1, x1, z1, 0, 1); wall(x1, z1, x1, z0, 1, 0); wall(x1, z0, x0, z0, 0, -1); wall(x0, z0, x0, z1, -1, 0); }
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
      const g0 = m3Ground(t.fx, t.fy);
      if (t.k === 'rail') {
        const L = Math.max(0.4, (t.pl || 120) / 50), Wd = 0.22 * Math.max(1, t.tr || 1) + 0.18, pw = 0.11, a = t.a || 0, c = Math.cos(a), sn = Math.sin(a);
        obox(t.fx, t.fy, a, L + 0.06, Wd, g0 - 0.2 * M3_U, g0 + 0.15 * M3_U, BED);   // 線路の敷地
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
  // 道路・線路：地面の少し上に帯で（道のはば・地面の高さにそって）
  const RD = [];
  // 帯（a→b・はば wdt マス・地面から lift だけ上）
  const strip = (ax, ay, bx, by, wdt, col, lift) => {
    const L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) return;
    const m = Math.max(1, Math.ceil(L / 1)), nx = -(by - ay) / L * wdt / 2, ny = (bx - ax) / L * wdt / 2;
    for (let q = 0; q < m; q++) {
      const t0 = q / m, t1 = (q + 1) / m, x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
      const h0 = m3Ground(x0, y0) + lift, h1 = m3Ground(x1, y1) + lift;
      RD.push(x0 + nx, h0, y0 + ny, x1 + nx, h1, y1 + ny, x1 - nx, h1, y1 - ny, x0 + nx, h0, y0 + ny, x1 - nx, h1, y1 - ny, x0 - nx, h0, y0 - ny);
      for (let k = 0; k < 6; k++) RD.push(...col);
    }
  };
  for (const s of segs) {
    const isRail = s.k === 'rail', wdt = Math.max(isRail ? 0.18 : 0.14, s.w || 0.2), col = isRail ? [0.42, 0.38, 0.35] : (s.c === 'exp' ? [0.62, 0.66, 0.72] : [0.72, 0.72, 0.70]);
    const P = s.P, n = s.np;
    for (let i = 0; i < n - 1; i++) strip(P[i * 2], P[i * 2 + 1], P[i * 2 + 2], P[i * 2 + 3], wdt, col, 0.05 * M3_U * 20);
  }
  // 滑走路（t61）：黒っぽい帯（はば r.w マス）と、白い中心線
  for (const r of rws) {
    const [ax, ay, bx, by] = r.P;
    strip(ax, ay, bx, by, r.w || 1.2, [0.30, 0.31, 0.33], 0.07 * M3_U * 20);
    strip(ax + r.ux * 0.6, ay + r.uy * 0.6, bx - r.ux * 0.6, by - r.uy * 0.6, 0.04, [0.95, 0.95, 0.93], 0.09 * M3_U * 20);
  }
  if (RD.length) {   // 四角ごとに 位置18・色18 の順
    const P = [], C = [];
    for (let i = 0; i < RD.length; i += 36) { P.push(...RD.slice(i, i + 18)); C.push(...RD.slice(i + 18, i + 36)); }
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T3.Float32BufferAttribute(C, 3)); g.computeVertexNormals();
    M3.grpR.add(new T3.Mesh(g, new T3.MeshBasicMaterial({ vertexColors: true, side: T3.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  }
}

/* ---------- 走行位置（t61・t62）：列車は両ごと、バス・船・飛行機は1つの箱。線路・道路・航路の上を、ダイヤのとおりに。
   遠くても見えるように、画面で 9px ぐらいの太さまで大きくする（近いときは本物の大きさ）。上りと下りは進む向きの左にずらす ---------- */
function m3Runs(v) {
  const T3 = M3.T;
  M3.runHit = []; M3.selLab = null;
  if (!S.layer.run) { if (M3.run) M3.run.visible = false; if (M3.mark) M3.mark.visible = false; return; }
  const list = runList(visibleItems(), v);
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
    let hh = (k === 'rail' ? 3.8 : k === 'bus' ? 3.1 : k === 'ship' ? 9 : 5) * M3_U, ww = (k === 'rail' ? 2.9 : k === 'bus' ? 2.5 : k === 'ship' ? 16 : 30) * M3_U;
    const wmin = (k === 'ship' || k === 'air' ? 11 : 9) * ppx;
    if (ww < wmin) { hh *= wmin / ww; ww = wmin; }
    hh = Math.min(hh, ww * 1.35);
    const cl = Math.max(o.car, ww * (k === 'rail' ? 1.6 : 1.3)), gap = k === 'rail' ? cl * 0.05 : 0;
    const off = k === 'rail' || k === 'bus' ? ww / 2 + Math.max(0.5 * M3_U, 1.5 * ppx) : 0;   // 進む向きの左
    col.set(o.R.c || '#d23');
    for (let c = 0; c < cars; c++) {
      const p = runPt(o.H, o.d - (c + 0.5) * cl), px = p[0] + Math.sin(p[2]) * off, pz = p[1] - Math.cos(p[2]) * off;
      let y = k === 'ship' ? 0.05 * M3_U : m3Ground(px, pz) + 0.3 * M3_U;
      if (k === 'air') { const f = o.H.len > 0 ? o.d / o.H.len : 0; y = Math.max(y, Math.min(1, 6 * f, 6 * (1 - f)) * 900 * M3_U); }   // 飛行機：まん中は 900m の高さ
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
function m3Resize() { if (!M3.on) return; M3.r.setSize(S.W, S.H, false); M3.cam.aspect = S.W / Math.max(1, S.H); M3.cam.updateProjectionMatrix(); }

Object.assign(window, { m3Open, m3Close, m3Frame, m3Zoom, m3Target, m3Resize, m3State: M3 });
})();
