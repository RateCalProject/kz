/* ===== 風の芽経済組：3D の街を歩く（DB の更新118・119・122）=====
   3D の地図に 自分の人を出して 歩く。歩きはじめる場所は 3つから えらぶ（瑠璃府庁前・美東区役所前・蛍石県庁前。t68）
   左下のスティック（パソコンは WASD・矢印）。スティックを いっぱいに たおすと 走る。
   パソコン（t68）：Q 走る（止まると もどる）・Shift しゃがむ・スペース ジャンプ・E 持ち物（輪から えらぶ）・/ か Z チャット（近くの人に。DB の更新122）
   カメラは うしろから：1本指（マウス）で まわす・2本指（ホイール）で 近く／遠く
   ほかの人も見える（DB の更新119）：サーバーと この端末のあいだだけで やりとり（av_step）。送るのは しるし（av_walk_start。歩きはじめるたびに 新しい）と
     位置・向き・うごきだけ。近く（400m）の人の 位置・向き・うごきを受けとって、この端末で その人を組み立てる。名前と見た目はサーバーから（ほかの人の名前を かたれない）
   見た目（スキン）：組み立ての人（服の形と色・髪とはだの色）・MMD のモデル（map/skins。map/vendor の MMDLoader で読む。まばたき以外のモーフ・物理演算は使わない）
   たてもの（区画）には入れない。海・川・湖には入れない（橋の上は歩ける）。道路・線路・橋・ホームの面は、のぼれる段（1.6m）まで のれる
   map3d.js（window.m3State・MapInt）を使う。歩いているあいだは M3.walk に この中身（step・cam・look・zoom・tags・stop） */
(function () {
'use strict';
const U = 1 / 50;                       // 1m（マス）
const SPD = { walk: 2.2, run: 6.5, sneak: 1.1 };   // 歩く・走る・しゃがんで歩く（m/秒）
const JUMP_V = 3.6;                     // ジャンプ（上へ m/秒。高さ 0.66m）
const STEP = 1.6;                       // のぼれる段（m）。道路の帯（地面から 1m）にも のれる
const HEAD = 1.45;                      // カメラが見る高さ（足もとから m）
const LOST = 12000;                     // これだけ 位置が来なければ いなくなった
const SEE = 8;                          // ほかの人を描く遠さ（マス。400m）
const TAG = 1.4;                        // 名前を出す遠さ（マス。70m）
const MMD_CAP = 6, OTHER_CAP = 24;      // MMD のモデルで描く人数（ほかは 組み立ての人）・描く人数
const HAIR = ['#1e1b1a', '#3b2a20', '#6b4a2f', '#a07a52', '#9a9a9a', '#1f2433'];
const SKIN = ['#f2d3b8', '#e0b48f', '#c48c62', '#8d5a3b'];
const BASE_SKIN = { code: 'base', name: 'ふだん着', kind: 'base', rare: '-', look: { t: 'tee', c1: '#e8e4da', c2: '#4a5568', c3: '#3b3b3b' }, n: 0 };
// 持ち物（E。t68・DB の更新122 で ほかの人にも見える）：右手に持つ。arm：右うでの形（up 前へ上げる・el ひじ・sw 歩くときの ふり）。
//   at：手からの位置（m。人の向き：+y 上・+z 前）・rx：前後の かたむき。pmx：MMD の持ち物のモデル（only：その見た目のときだけ）
const ITEMS = [
  { ico: '✋', name: '手ぶら' },
  { ico: '☂️', name: '傘', arm: { up: 0.42, el: -1.25 }, rx: -0.3 },
  { ico: '📱', name: 'スマホ', arm: { up: 0.32, el: -1.8 }, at: [0, 0.05, 0.03], rx: 0.55 },
  { ico: '🛍️', name: '買い物ぶくろ', arm: { up: 0.04, el: -0.12, sw: 0.35 } },
  { ico: '🎈', name: '風船', arm: { up: 0.3, el: -0.6, sw: 0.25 } },
  { ico: '💐', name: '花たば', arm: { up: 0.26, el: -1.35 }, at: [0, 0.02, 0.02], rx: 0.25 },
  { ico: '📖', name: '本', arm: { up: 0.32, el: -1.6 }, at: [0.06, 0.08, 0.04], rx: 0.45 },
  { ico: '📷', name: 'カメラ', arm: { up: 0.62, el: -2.05 }, at: [0, 0.03, 0.06] },
  { ico: '⛩️', name: 'お祓い棒', arm: { up: 0.3, el: -1.0 }, rx: 0.12, pmx: 'map/skins/reimu/W_oonusa.pmx', only: 'map/skins/reimu/' }   // 霊夢と同じ モデルデータ集の 大幣
];
// 歩きはじめる場所（t68）：この建物の前（いちばん近い 道路などの上）。x・y：建物の まん中（マス）
const SPAWN = [
  { n: '瑠璃府庁前', x: -7.7, y: 5.5 },
  { n: '美東区役所前', x: -64.8, y: 52.9 },
  { n: '蛍石県庁前', x: -2745.1, y: -6543.5 }
];
const now = () => performance.now();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mapv = () => (typeof MAPV !== 'undefined' ? MAPV : '');
const rpc = (fn, a) => (typeof call === 'function' ? call(fn, a) : Promise.reject(new Error('rpc')));
const tt = s => (typeof tr === 'function' ? tr(s) : s);
let M3 = null, T3 = null, MI = null;
let W = null;          // 歩いているときの中身
let CAT = null;        // 見た目の表（av_info）
let onChange = null;   // map.js のボタン
let lookSeq = 0;       // 見た目を変えた回数（catLoad の古い答えで もどさない）
let spawnBusy = false; // 歩きはじめる場所を えらんでいる

/* ---------- 見た目の表 ---------- */
async function catLoad(force) {
  if (CAT && !force && !CAT.off) return CAT;
  const seq = lookSeq;
  try {
    const d = await rpc('av_info');
    // 読んでいるあいだに 見た目を変えたら、いまの見た目は そのまま（古い答えで もどさない）
    const me = seq !== lookSeq && CAT && !CAT.off ? CAT.me : (d.me || { c: 'base', l: {} });
    CAT = { skins: new Map(d.skins.map(s => [s.code, s])), list: d.skins, me, cost: d.cost, dup: d.dup, tix: d.tix, admin: !!d.admin, soon: d.soon || null };
  } catch (e) {
    let l = {}; try { l = JSON.parse(localStorage.getItem('kz_walk_look') || '{}') || {}; } catch (e2) {}
    CAT = { skins: new Map([['base', BASE_SKIN]]), list: [BASE_SKIN], me: { c: 'base', l }, off: true };
  }
  return CAT;
}
const skinOf = c => (CAT && CAT.skins.get(c)) || BASE_SKIN;

/* ---------- 組み立ての人（m。足もとが原点・前が +z） ---------- */
const MAT = new Map();
function mat(c, two) { const k = c + (two ? '2' : ''); let m = MAT.get(k); if (!m) { m = new T3.MeshLambertMaterial({ color: c, side: two ? T3.DoubleSide : T3.FrontSide }); MAT.set(k, m); } return m; }
let GE = null;
function geos() {
  if (GE) return GE;
  const T = T3;
  const cyl = (rt, rb, h, s) => { const g = new T.CylinderGeometry(rt, rb, h, s || 10); g.translate(0, -h / 2, 0); return g; };   // 上が 関節
  const sph = (r, ws, hs, tl) => new T.SphereGeometry(r, ws || 14, hs || 10, 0, Math.PI * 2, 0, tl || Math.PI);
  const ell = (rt, rb, h, sz, y, s, open) => { const g = new T.CylinderGeometry(rt, rb, h, s || 14, 1, !!open); g.scale(1, 1, sz); g.translate(0, y, 0); return g; };
  const box = (w, h, d, y, z) => { const g = new T.BoxGeometry(w, h, d); g.translate(0, y || 0, z || 0); return g; };
  GE = {
    pelvis: ell(0.15, 0.158, 0.17, 0.7, -0.045),
    torso: ell(0.175, 0.15, 0.52, 0.64, 0.26),
    skirt: ell(0.168, 0.225, 0.5, 0.74, -0.2, 14, true),
    belt: ell(0.17, 0.17, 0.045, 0.66, 0.035, 14, true),
    band: ell(0.18, 0.178, 0.04, 0.66, 0.27, 14, true),
    thigh: cyl(0.078, 0.064, 0.44), shin: cyl(0.062, 0.05, 0.43),
    foot: box(0.1, 0.075, 0.25, -0.0375, 0.045), boot: box(0.112, 0.2, 0.26, -0.09, 0.04),
    upper: cyl(0.052, 0.046, 0.29), fore: cyl(0.045, 0.038, 0.27), hand: sph(0.046, 8, 6),
    sleeveS: cyl(0.067, 0.062, 0.14), sleeveW: cyl(0.07, 0.095, 0.25),
    neck: cyl(0.048, 0.052, 0.11),
    head: sph(0.112), hair: sph(0.121, 14, 8, Math.PI * 0.56), eye: sph(0.014, 6, 4),
    hood: (() => { const g = new T.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6); g.scale(1.05, 0.72, 0.8); return g; })(),
    cap: sph(0.13, 14, 8, Math.PI * 0.62),
    helm: sph(0.132, 14, 8, Math.PI * 0.5), brim: new T.CylinderGeometry(0.152, 0.152, 0.012, 16),
    hband: (() => { const g = new T.TorusGeometry(0.114, 0.013, 6, 18); g.rotateX(Math.PI / 2); return g; })(),
    collar: (() => { const g = new T.TorusGeometry(0.062, 0.017, 6, 14); g.rotateX(Math.PI / 2); return g; })(),
    tie: box(0.045, 0.24, 0.012, -0.12), vee: box(0.1, 0.17, 0.008, -0.085), zip: box(0.012, 0.44, 0.006),
    lapel: box(0.05, 0.5, 0.008, -0.25), str: box(0.008, 0.12, 0.008, -0.06),
    stripe: box(0.016, 1, 0.016, -0.5)
  };
  return GE;
}
// 服の形 t：tee（Tシャツ）・hoodie（パーカー）・jersey（ジャージ）・shirt（シャツ）・coat（コート）・suit（スーツ）・rain（レインコート）・happi（はっぴ）・work（作業着）
function mkBase(look, hl) {
  const g = geos(), T = T3, lk = look || BASE_SKIN.look, t = lk.t || 'tee';
  const c1 = lk.c1 || '#e8e4da', c3 = lk.c3 || '#3b3b3b', c2 = t === 'happi' ? '#1f2a44' : (lk.c2 || '#4a5568');
  const sk = SKIN[hl && hl.s >= 0 && hl.s < SKIN.length ? hl.s | 0 : 0], hr = HAIR[hl && hl.h >= 0 && hl.h < HAIR.length ? hl.h | 0 : 0];
  const shoe = t === 'suit' ? '#18191b' : t === 'happi' ? '#2a2a2a' : t === 'work' ? '#3a3027' : c3;
  const longSl = t !== 'tee' && t !== 'happi';
  const M = (ge, c, two) => new T.Mesh(ge, mat(c, two));
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  const root = new T.Group(), body = new T.Group(); root.add(body); body.position.y = 0.93;
  body.add(M(g.pelvis, c2));
  if (t === 'coat' || t === 'rain') body.add(at(M(g.skirt, c1, true), 0, 0.04, 0));
  if (t === 'coat') body.add(M(g.belt, c3));
  const legs = [], arms = [];
  for (const sd of [1, -1]) {
    const leg = at(new T.Group(), 0.095 * sd, -0.02, 0); body.add(leg); leg.add(M(g.thigh, c2));
    const knee = at(new T.Group(), 0, -0.44, 0); leg.add(knee); knee.add(M(g.shin, c2));
    const foot = at(new T.Group(), 0, -0.43, 0); knee.add(foot); foot.add(M(t === 'rain' || t === 'work' ? g.boot : g.foot, shoe));
    if (t === 'jersey') { const a = at(M(g.stripe, c3), 0.074 * sd, 0, 0); a.scale.y = 0.44; leg.add(a); const b = at(M(g.stripe, c3), 0.06 * sd, 0, 0); b.scale.y = 0.42; knee.add(b); }
    legs.push({ leg, knee, foot });
  }
  const chest = at(new T.Group(), 0, 0.02, 0); body.add(chest);
  chest.add(M(g.torso, c1));
  if (t === 'work') chest.add(M(g.band, '#d9dde0'));
  if (t === 'suit') { chest.add(at(M(g.vee, '#f4f4f2'), 0, 0.515, 0.104)); chest.add(at(M(g.tie, c3), 0, 0.49, 0.11)); }
  if (t === 'hoodie') { chest.add(at(M(g.hood, c1), 0, 0.52, -0.078)); for (const sd of [1, -1]) chest.add(at(M(g.str, c3), 0.036 * sd, 0.47, 0.106)); }
  if (t === 'jersey') { chest.add(at(M(g.zip, c3), 0, 0.27, 0.108)); chest.add(at(M(g.collar, c1), 0, 0.53, 0)); }
  if (t === 'shirt' || t === 'coat') chest.add(at(M(g.collar, t === 'shirt' ? '#f2f4f6' : c1), 0, 0.53, 0));
  if (t === 'happi') for (const sd of [1, -1]) { const l = at(M(g.lapel, lk.c2 || '#f4f1e8'), 0.05 * sd, 0.53, 0.106); l.rotation.z = 0.2 * sd; chest.add(l); }
  chest.add(at(M(g.neck, sk), 0, 0.61, 0));
  const head = at(new T.Group(), 0, 0.705, 0); chest.add(head);
  head.add(M(g.head, sk));
  if (t === 'rain') head.add(at(M(g.cap, c1, true), 0, 0.006, -0.01));
  else if (t === 'work') { head.add(at(M(g.helm, c3), 0, 0.022, 0)); head.add(at(M(g.brim, c3), 0, 0.025, 0.01)); }
  else { const h = at(M(g.hair, hr), 0, 0.012, -0.008); h.rotation.x = -0.45; head.add(h); }
  if (t === 'happi') head.add(at(M(g.hband, c3), 0, 0.035, 0));
  for (const sd of [1, -1]) head.add(at(M(g.eye, '#1d1d1f'), 0.04 * sd, 0.006, 0.104));
  for (const sd of [1, -1]) {
    const arm = at(new T.Group(), 0.2 * sd, 0.49, 0); chest.add(arm);
    if (t === 'tee') { arm.add(M(g.sleeveS, c1)); arm.add(M(g.upper, sk)); }
    else if (t === 'happi') { arm.add(M(g.sleeveW, c1, true)); arm.add(M(g.upper, sk)); }
    else arm.add(M(g.upper, c1));
    const elbow = at(new T.Group(), 0, -0.29, 0); arm.add(elbow);
    elbow.add(M(g.fore, longSl ? c1 : sk));
    elbow.add(at(M(g.hand, sk), 0, -0.29, 0));
    if (t === 'jersey') { const a = at(M(g.stripe, c3), 0.05 * sd, 0, 0); a.scale.y = 0.29; arm.add(a); const b = at(M(g.stripe, c3), 0.042 * sd, 0, 0); b.scale.y = 0.27; elbow.add(b); }
    arms.push({ arm, elbow, sd });
  }
  const hand = at(new T.Object3D(), 0, -0.3, 0); arms[1].elbow.add(hand);   // 右手（持ち物の位置）
  return { root, body, chest, head, legs, arms, hand, h: 1.78 };
}
// X（t68）：{ cr しゃがむ 0〜1・air ジャンプ 0〜1・it 持ち物 }。しゃがむ：腰を下げて ひざを まげる（足のうらは 地面に）
function legPose(amt, run, s, c, sg, X) {
  const sA = run ? 0.8 : 0.46, kA = run ? 1.35 : 0.62, cr = X ? X.cr || 0 : 0, air = X ? X.air || 0 : 0, sit = X ? X.sit || 0 : 0;
  let th = -sA * amt * s * sg, kn = (kA * Math.max(0, c * sg) + (run ? 0.28 : 0.05)) * amt;
  if (cr) { th += (-1.15 + 0.28 * amt * s * sg - th) * cr; kn += (1.71 + 0.3 * amt * Math.max(0, c * sg) - kn) * cr; }
  if (sit) { th += (-1.5 - th) * sit; kn += (1.45 - kn) * sit; }   // すわる（t70）：ももを前へ・ひざを まげる
  if (X && X.bike) { th = -1.05 - 0.38 * s * sg; kn = 1.25 + 0.45 * s * sg; }   // 自転車：ペダルを こぐ（t70）
  if (air) { th += (-0.55 - th) * air; kn += (1.0 - kn) * air; }
  return [th, kn, -(th + kn) * (0.6 + 0.4 * Math.max(cr, air))];
}
function armPose(i, amt, run, s, sg, tIdle, X) {   // [前後, ひじ, 外へ]
  const aA = run ? 0.95 : 0.36, cr = X ? X.cr || 0 : 0, air = X ? X.air || 0 : 0, it = X && X.it ? ITEMS[X.it] : null, ia = it && it.arm;
  let ax = aA * amt * s * sg + (1 - amt) * 0.035 * Math.sin(tIdle * 1.3 + i), el = -((run ? 1.25 : 0.22) * amt + 0.1), az = 0;
  if (cr) { ax += (-0.35 + 0.12 * amt * s * sg - ax) * cr; el += (-0.75 - el) * cr; }
  { const sit = X ? X.sit || 0 : 0; if (sit) { ax += (-0.5 - ax) * sit; el += (-0.55 - el) * sit; } }   // すわる：手は ひざの上
  if (X && X.bike) { ax = -0.95; el = -0.35; az = 0; }   // 自転車：ハンドルを にぎる
  if (air) { ax += (-0.85 - ax) * air; el += (-0.45 - el) * air; az = 0.3 * air; }
  if (ia && i === 1) { ax = -ia.up + (ia.sw || 0) * ax; el = ia.el; az = 0; }   // 右手に 持ち物
  return [ax, el, az];
}
function poseBase(P, ph, amt, run, tIdle, X) {
  const s = Math.sin(ph), c = Math.cos(ph), cr = X ? X.cr || 0 : 0, air = X ? X.air || 0 : 0;
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? 1 : -1, L = P.legs[i], lp = legPose(amt, run, s, c, sg, X);
    L.leg.rotation.x = lp[0]; L.knee.rotation.x = lp[1]; L.foot.rotation.x = lp[2];
    const A = P.arms[i], ap = armPose(i, amt, run, s, sg, tIdle, X);
    A.arm.rotation.x = ap[0];
    A.arm.rotation.z = (0.07 + ap[2]) * A.sd;
    A.elbow.rotation.x = ap[1];
  }
  const sit = X ? X.sit || 0 : 0;
  P.body.position.y = 0.93 + ((run ? 0.055 : 0.024) * Math.abs(c) - (run ? 0.035 : 0)) * amt * (1 - cr) + (1 - amt) * 0.004 * Math.sin(tIdle * 1.7) - 0.29 * cr * (1 - sit) - 0.44 * sit;   // すわる：腰を 座面（45cm）へ
  P.chest.rotation.x = (run ? 0.2 : 0.05) * amt * (1 - cr) + 0.42 * cr + 0.08 * air;
  if (P.head) P.head.rotation.x = -0.32 * cr;   // しゃがんでも 前を見る
}

/* ---------- MMD のモデル（map/skins）：はじめて使うときに map/vendor を読む ---------- */
const MMD = new Map();   // ファイル → { p, mesh, k（m / MMD の単位）, hgt }
let mmdLibP = null;
function mmdLib() {
  if (window.THREE && window.THREE.MMDLoader && window.THREE.SkeletonUtils) return Promise.resolve();
  if (mmdLibP) return mmdLibP;
  const add = n => new Promise((ok, ng) => { const s = document.createElement('script'); s.src = 'map/vendor/' + n + '.js?v=' + mapv(); s.onload = ok; s.onerror = () => ng(new Error('モデルの部品を読めません')); document.head.appendChild(s); });
  mmdLibP = add('mmdparser').then(() => add('MMDLoader')).then(() => add('SkeletonUtils'));
  mmdLibP.catch(() => { mmdLibP = null; });
  return mmdLibP;
}
function mmdLoad(sk) {
  if (!sk || !sk.file || !/^map\/skins\/[\w/.-]+\.pmx$/.test(sk.file)) return Promise.reject(new Error('モデルのファイルがありません'));
  let e = MMD.get(sk.file);
  if (e) return e.p;
  e = { p: null, mesh: null, file: sk.file };
  MMD.set(sk.file, e);
  e.p = mmdLib().then(() => new Promise((ok, ng) => {
    const T = window.THREE, man = new T.LoadingManager();
    // テクスチャは WebP にしてある（名前は同じ・拡張子だけ。スフィアマップ .spa・.sph も）。\ は /。.tga も ふつうの画像として読む（TGALoader は使わない）
    man.setURLModifier(u => /^(data|blob):/.test(u) ? u : u.replace(/\\/g, '/').replace(/\.(png|jpe?g|bmp|tga|spa|sph)$/i, '.webp'));
    man.addHandler(/\.tga$/i, new T.TextureLoader(man));
    const L = new T.MMDLoader(man), base = sk.file.replace(/[^/]*$/, '');
    L.loadPMX(sk.file + '?v=' + mapv(), data => {
      try {
        // まばたきなど 使うモーフだけ（ほかは 大きいので すてる）・物理演算（剛体・ジョイント）は使わない
        const keep = new Set((sk.look && Array.isArray(sk.look.m) ? sk.look.m : []).map(String));
        data.morphs = data.morphs.filter(m => m.type === 1 && keep.has(m.name)); data.metadata.morphCount = data.morphs.length;
        // 物理で ゆれる鎖（剛体が「物理」の骨で、親は物理でないもの）のうち、うでについている もの（袖など）は、物理のかわりに 下へたらす（poseMMD）
        const bo = data.bones || [], ph = new Set((data.rigidBodies || []).filter(r => r.type >= 1 && r.boneIndex >= 0).map(r => r.boneIndex));
        const onArm = i => { for (let j = bo[i].parentIndex, n = 0; j >= 0 && bo[j] && n < 64; j = bo[j].parentIndex, n++) if (/^(左|右)腕$/.test(bo[j].name)) return true; return false; };
        e.hang = [...ph].filter(i => bo[i] && !ph.has(bo[i].parentIndex) && onArm(i)).map(i => bo[i].name);
        data.rigidBodies = []; data.metadata.rigidBodyCount = 0; data.constraints = []; data.metadata.constraintCount = 0;
        const mesh = L.meshBuilder.setCrossOrigin('anonymous').build(data, base, undefined, er => console.warn(er));
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const hide = new Set((sk.look && Array.isArray(sk.look.hide) ? sk.look.hide : []).map(String));   // 見せない材質（持ち物など）
        for (const m of mats) { if (m.opacity === 0 || hide.has(m.name)) m.visible = false; m.userData.em0 = m.emissive ? m.emissive.clone() : null; }   // 色を変えるモーフ用の材質（ふだんは 見えない）
        mesh.geometry.computeBoundingBox();
        const hgt = Math.max(1, mesh.geometry.boundingBox.max.y);
        e.mesh = mesh; e.hgt = hgt; e.k = (Number(sk.look && sk.look.h) || 1.6) / hgt; e.mats = mats;
        ok(e);
      } catch (er) { ng(er); }
    }, undefined, er => ng(er instanceof Error ? er : new Error('モデルを読めません')));
  }));
  e.p.catch(er => { console.warn(er); e.fail = true; });
  return e.p;
}
// 動かすボーン（袖のボーン（左腕袖・左ひじ袖）は ふつう IK で うでについていく。IK は使わないので、うでと同じだけ回す）
const BN = { legL: '左足', legR: '右足', kneeL: '左ひざ', kneeR: '右ひざ', ankL: '左足首', ankR: '右足首', armL: '左腕', armR: '右腕', elbL: '左ひじ', elbR: '右ひじ', up: '上半身', ctr: 'センター',
             armL2: '左腕袖', armR2: '右腕袖', elbL2: '左ひじ袖', elbR2: '右ひじ袖', neck: '首' };
function mkMMD(e) {
  const T = T3, mesh = T.SkeletonUtils.clone(e.mesh);
  mesh.scale.setScalar(e.k); mesh.frustumCulled = false;
  const root = new T.Group(); root.add(mesh);
  const byName = new Map(mesh.skeleton.bones.map(b => [b.name, b])), B = {};
  for (const k in BN) { const b = byName.get(BN[k]); if (b) B[k] = { b, q: b.quaternion.clone(), p: b.position.clone() }; }
  const mi = mesh.morphTargetDictionary && mesh.morphTargetDictionary['まばたき'];
  const H = (e.hang || []).map(n => byName.get(n)).filter(Boolean);   // 下へたらす鎖の はじめの骨（袖など）
  // 持ち物（t68）：右手首の骨の位置に
  return { root, mesh, B, H, hand: byName.get('右手首') || null, file: e.file || '', blink: mi == null ? -1 : mi, k: e.k, h: e.hgt * e.k, mmd: true, nb: now() + 2000 + Math.random() * 3000 };
}
const _qa = { x: null, z: null, t: null };
function qset(B, k, ax, ang, pre) {   // 休みの姿勢から ax（'x'・'z'）まわりに ang（pre：その前に かける回転）
  const o = B[k]; if (!o) return;
  const T = T3; if (!_qa.x) { _qa.x = new T.Quaternion(); _qa.z = new T.Quaternion(); _qa.t = new T.Quaternion(); _qa.vx = new T.Vector3(1, 0, 0); _qa.vz = new T.Vector3(0, 0, 1); }
  _qa.t.setFromAxisAngle(ax === 'x' ? _qa.vx : _qa.vz, ang);
  o.b.quaternion.copy(o.q);
  if (pre) o.b.quaternion.multiply(pre);
  o.b.quaternion.premultiply(_qa.t);
}
function poseMMD(P, ph, amt, run, tIdle, X) {
  const B = P.B, s = Math.sin(ph), c = Math.cos(ph), cr = X ? X.cr || 0 : 0, air = X ? X.air || 0 : 0;
  const T = T3; if (!P.qz) { P.qz = [new T.Quaternion(), new T.Quaternion()]; P.qz[0].setFromAxisAngle(new T.Vector3(0, 0, 1), -0.68); P.qz[1].setFromAxisAngle(new T.Vector3(0, 0, 1), 0.68); }   // 両うで（A ポーズ）を下げる
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? 1 : -1, Lr = i === 0 ? 'L' : 'R', lp = legPose(amt, run, s, c, sg, X);
    qset(B, 'leg' + Lr, 'x', lp[0]); qset(B, 'knee' + Lr, 'x', lp[1]); qset(B, 'ank' + Lr, 'x', lp[2]);
    const ap = armPose(i, amt, run, s, sg, tIdle, X);
    qset(B, 'arm' + Lr, 'x', ap[0], P.qz[i]); qset(B, 'arm' + Lr + '2', 'x', ap[0], P.qz[i]);
    qset(B, 'elb' + Lr, 'x', ap[1]); qset(B, 'elb' + Lr + '2', 'x', ap[1]);
  }
  qset(B, 'up', 'x', (run ? 0.16 : 0.04) * amt * (1 - cr) + 0.42 * cr + 0.08 * air);
  qset(B, 'neck', 'x', -0.3 * cr);
  // しゃがむ：腰（センター）を 下げる（足の長さは 身長の だいたい 0.47）
  const sit = X ? X.sit || 0 : 0;
  if (B.ctr) B.ctr.b.position.y = B.ctr.p.y + (((run ? 0.055 : 0.024) * Math.abs(c) - (run ? 0.035 : 0)) * amt * (1 - cr) - 0.175 * P.h * cr * (1 - sit) - 0.25 * P.h * sit) / P.k;   // すわる（t70）
  // 袖など（物理で ゆれる鎖）：うでといっしょに回すと 大きく のびるので、下へたらす。歩く・走るときは 少しうしろへ なびく
  if (P.H && P.H.length) {
    if (!P.qh) P.qh = { a: new T.Quaternion(), l: new T.Quaternion(), ax: new T.Vector3(1, 0, 0) };
    const q = P.qh;
    q.l.setFromAxisAngle(q.ax, ((run ? 0.42 : 0.12) + (run ? 0.08 : 0.03) * Math.sin(ph * 2)) * amt);
    for (const b of P.H) {
      q.a.identity();
      for (let p = b.parent; p && p.isBone; p = p.parent) q.a.premultiply(p.quaternion);
      b.quaternion.copy(q.a.invert()).multiply(q.l);
    }
  }
  // まばたき
  if (P.blink >= 0) { const t = now(); let v = 0; if (t > P.nb) { const d = t - P.nb; v = d < 70 ? d / 70 : d < 140 ? 1 - (d - 70) / 70 : 0; if (d >= 140) P.nb = t + 2200 + Math.random() * 3500; } P.mesh.morphTargetInfluences[P.blink] = v; }
}

/* ---------- 持ち物の形（t68。m。手が原点・+y 上・+z 前） ---------- */
const ITG = new Map();
// MMD の持ち物（お祓い棒など）：はじめて使うときに読む。物理・ボーンは使わない（そのままの形）
const PROP = new Map();   // ファイル → { p, mesh }
function propLoad(file) {
  let e = PROP.get(file); if (e) return e;
  e = { p: null, mesh: null }; PROP.set(file, e);
  if (!/^map\/skins\/[\w/.-]+\.pmx$/.test(file)) { e.fail = true; return e; }
  e.p = mmdLib().then(() => new Promise((ok, ng) => {
    const T = window.THREE, man = new T.LoadingManager();
    man.setURLModifier(u => /^(data|blob):/.test(u) ? u : u.replace(/\\/g, '/').replace(/\.(png|jpe?g|bmp|tga|spa|sph)$/i, '.webp'));
    man.addHandler(/\.tga$/i, new T.TextureLoader(man));
    const L = new T.MMDLoader(man);
    L.loadPMX(file + '?v=' + mapv(), data => {
      try {
        data.morphs = []; data.metadata.morphCount = 0; data.rigidBodies = []; data.metadata.rigidBodyCount = 0; data.constraints = []; data.metadata.constraintCount = 0;
        const sm = L.meshBuilder.setCrossOrigin('anonymous').build(data, file.replace(/[^/]*$/, ''), undefined, er => console.warn(er));
        const mats = (Array.isArray(sm.material) ? sm.material : [sm.material]).map(m => { const c = m.clone(); c.skinning = false; c.morphTargets = false; return c; });
        e.mesh = new T.Mesh(sm.geometry, mats.length === 1 ? mats[0] : mats);
        ok(e);
      } catch (er) { ng(er); }
    }, undefined, er => ng(er instanceof Error ? er : new Error('モデルを読めません')));
  }));
  e.p.catch(er => { console.warn(er); e.fail = true; });
  return e;
}
function mkItem(id, k) {
  const it = ITEMS[id];
  if (it && it.pmx) {   // MMD の持ち物：読めるまでは からっぽ（読めたら 作りなおす）
    const g = new T3.Group(), e = propLoad(it.pmx);
    if (e.mesh) { const m = e.mesh.clone(); m.scale.setScalar(k || 0.08); m.frustumCulled = false; g.add(m); } else g.userData.wait = it.pmx;
    return g;
  }
  if (ITG.has(id)) return ITG.get(id).clone();
  const T = T3, g = new T.Group(), M = (ge, c, two) => new T.Mesh(ge, mat(c, two));
  const cyl = (r, h, y, n) => { const q = new T.CylinderGeometry(r, r, h, n || 6); q.translate(0, y, 0); return q; };
  const box = (w, h, d, x, y, z) => { const q = new T.BoxGeometry(w, h, d); q.translate(x || 0, y || 0, z || 0); return q; };
  if (id === 1) {   // 傘：柄・骨・布（ひらいた形）
    g.add(M(cyl(0.009, 0.94, 0.39), '#2e2e30'));
    g.add(M(cyl(0.016, 0.1, -0.08, 8), '#5a3a22'));
    const cn = new T.ConeGeometry(0.52, 0.22, 16, 1, true); cn.translate(0, 0.79, 0); g.add(M(cn, '#2b3a67', true));
    g.add(M(cyl(0.012, 0.05, 0.925), '#2e2e30'));
  } else if (id === 2) {   // スマホ（画面が 自分のほうに）
    g.add(M(box(0.072, 0.15, 0.009), '#24262b'));
    g.add(M(box(0.062, 0.13, 0.002, 0, 0, -0.0055), '#6f8fb4'));
  } else if (id === 3) {   // 買い物ぶくろ（紙）
    g.add(M(box(0.3, 0.34, 0.12, 0, -0.29, 0), '#c9a46b'));
    for (const x of [-0.06, 0.06]) g.add(M(box(0.012, 0.12, 0.012, x, -0.06, 0), '#8a6a3d'));
  } else if (id === 4) {   // 風船
    g.add(M(cyl(0.0025, 1.05, 0.52, 4), '#f4f4f4'));
    const b = new T.SphereGeometry(0.17, 16, 12); b.scale(1, 1.15, 1); b.translate(0, 1.24, 0); g.add(M(b, '#e8434f'));
    const k = new T.ConeGeometry(0.02, 0.04, 6); k.translate(0, 1.05, 0); g.add(M(k, '#e8434f'));
  } else if (id === 5) {   // 花たば（つつみ・花）
    const w = new T.ConeGeometry(0.075, 0.3, 10, 1, true); w.rotateX(Math.PI); w.translate(0, 0.08, 0); g.add(M(w, '#f2efe6', true));
    const fl = [['#f07aa0', 0, 0.24, 0], ['#ffffff', 0.045, 0.22, 0.02], ['#ffd54a', -0.045, 0.22, 0.015], ['#f07aa0', 0.02, 0.23, -0.04], ['#c96adf', -0.03, 0.25, -0.03]];
    for (const [c, x, y, z] of fl) { const q = new T.SphereGeometry(0.036, 8, 6); q.translate(x, y, z); g.add(M(q, c)); }
    for (const x of [-0.06, 0.06]) { const q = new T.SphereGeometry(0.03, 6, 4); q.scale(1, 0.4, 1); q.translate(x, 0.2, 0); g.add(M(q, '#4f9a4f')); }
  } else if (id === 6) {   // 本（ひらいて 読む）
    for (const sd of [1, -1]) { const q = box(0.13, 0.19, 0.012, 0.065 * sd, 0, 0); g.add(M(q, '#7a3b2e')); g.add(M(box(0.12, 0.18, 0.01, 0.063 * sd, 0, -0.009), '#f3efe4')); }
  } else if (id === 7) {   // カメラ（レンズが 前）
    g.add(M(box(0.13, 0.085, 0.065), '#1f2023'));
    const l = new T.CylinderGeometry(0.03, 0.033, 0.06, 12); l.rotateX(Math.PI / 2); l.translate(0.015, 0, 0.06); g.add(M(l, '#2e3034'));
    g.add(M(box(0.03, 0.018, 0.02, -0.04, 0.05, 0), '#2e3034'));
  }
  ITG.set(id, g);
  return g.clone();
}
// 持ち物を持たせる・手の位置に（毎フレーム）
const _iv = { p: null, q: null };
function itemTick(A, id, t) {
  const P = A.P; if (!P) return;
  const it = ITEMS[id] || ITEMS[0], ok = id > 0 && (!it.only || String(P.file || '').startsWith(it.only));   // その見た目（MMD のモデル）の 持ち物だけ
  if (A.itO && A.itO.userData.wait) { const e = PROP.get(A.itO.userData.wait); if (e && (e.mesh || e.fail)) A.itId = -1; }   // MMD の持ち物が 読めた
  if (A.itId !== id || A.itP !== P) {
    if (A.itO && A.itO.parent) A.itO.parent.remove(A.itO);
    A.itO = ok ? mkItem(id, P.k) : null; A.itId = id; A.itP = P;
    if (A.itO) P.root.add(A.itO);
  }
  if (!A.itO || !P.hand) return;
  if (!_iv.p) { _iv.p = new T3.Vector3(); _iv.m = new T3.Matrix4(); }
  P.root.updateMatrixWorld(true);
  _iv.m.copy(P.root.matrixWorld).invert();
  _iv.p.setFromMatrixPosition(P.hand.matrixWorld).applyMatrix4(_iv.m);
  const o = it.at || [0, 0, 0];
  A.itO.position.set(_iv.p.x + o[0], _iv.p.y + o[1], _iv.p.z + o[2]);
  A.itO.rotation.set(it.rx || 0, 0, 0);
  if (id === 4) { A.itO.rotation.x = 0.08 * Math.sin(t / 900 + A.ph * 0.1); A.itO.rotation.z = 0.1 * Math.sin(t / 1300); }   // 風船は ゆれる
}

/* ---------- 人（自分・ほかの人）：見た目のかわりめ・MMD がまだのときは 組み立ての人 ---------- */
function mmdShown() { let n = 0; if (W) { if (W.av && W.av.P && W.av.P.mmd) n++; for (const o of W.others.values()) if (o.av && o.av.P && o.av.P.mmd) n++; } return n; }
function mkAvatar(code, hl, self) {
  const sk = skinOf(code), A = { code, hk: JSON.stringify(hl || {}), root: new T3.Group(), ph: Math.random() * 6, amt: 0, run: false, P: null, wait: false };
  A.root.scale.setScalar(U);
  let P = null;
  if (sk.kind === 'mmd' && sk.file) {
    const e = MMD.get(sk.file);
    if (e && e.mesh && (self || mmdShown() < MMD_CAP)) P = mkMMD(e);
    else { A.wait = !(e && (e.mesh || e.fail)); if (A.wait) mmdLoad(sk).catch(() => {}); }
  }
  if (!P) P = mkBase(sk.kind === 'base' ? sk.look : { t: 'tee', c1: '#d8d4cc', c2: '#55606e', c3: '#3b3b3b' }, hl);
  A.P = P; A.root.add(P.root);
  return A;
}
// X：{ cr しゃがむ（0・1）, air ジャンプ（0・1）, it 持ち物 }（t68）。しゃがむ・ジャンプは なめらかに
function poseAv(A, dt, spd, run, X) {
  const P = A.P, cr = X && X.cr ? 1 : 0, sneak = cr && spd > 0.05, tgt = clamp(spd / (sneak ? SPD.sneak : SPD.walk), 0, 1);
  A.amt += (tgt - A.amt) * Math.min(1, dt * 8);
  A.run = run && spd > SPD.walk * 1.2;
  A.cr = (A.cr || 0) + (cr - (A.cr || 0)) * Math.min(1, dt * 10);
  A.air = (A.air || 0) + ((X && X.air ? 1 : 0) - (A.air || 0)) * Math.min(1, dt * 14);
  A.sit = (A.sit || 0) + ((X && X.sit ? 1 : 0) - (A.sit || 0)) * Math.min(1, dt * 6);   // すわる（t70）
  const stride = A.run ? 1.35 : sneak ? 0.5 : 0.75;
  A.ph += dt * Math.PI * Math.max(spd, 0.3 * A.amt) / stride;
  if (A.ph > 1e4) A.ph -= Math.PI * 2 * 1000;
  let it = X && X.it ? X.it | 0 : 0; const I = ITEMS[it];
  if (!I || (I.only && !String(P.file || '').startsWith(I.only))) it = 0;   // その見た目では 持てない
  const ti = now() / 1000, Y = A.cr > 0.01 || A.air > 0.01 || A.sit > 0.01 || it || (X && X.bike) ? { cr: A.cr, air: A.air, it, sit: A.sit, bike: X && X.bike ? 1 : 0 } : null;
  if (P.mmd) poseMMD(P, A.ph, A.amt, A.run, ti, Y); else poseBase(P, A.ph, A.amt, A.run, ti, Y);
  if (it || A.itO) itemTick(A, it, now());
}

/* ---------- 歩ける面（道路・線路・橋・ホーム）と たてもの ---------- */
//   M3.grpR（道路・線路の3D）の 平らな三角を 5m の目に。近くだけ（R マス）。たてものは 区画（10m）の集まり
const IG = 0.1;   // 目（マス。5m）
function idxBuild() {
  const t0 = now(), T = T3, R = 7, cx = W.x, cy = W.y, cells = new Map(), tri = [];
  const add = (ax, ay, az, bx, by, bz, cx2, cy2, cz2) => {
    const n = tri.length; tri.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2);
    const x0 = Math.floor(Math.min(ax, bx, cx2) / IG), x1 = Math.floor(Math.max(ax, bx, cx2) / IG), z0 = Math.floor(Math.min(az, bz, cz2) / IG), z1 = Math.floor(Math.max(az, bz, cz2) / IG);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) return;
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 100003 + j; let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(n); }
  };
  const v = new T.Vector3();
  M3.grpR.updateMatrixWorld(true);
  M3.grpR.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry || !o.visible) return;
    const ge = o.geometry, pos = ge.getAttribute('position'); if (!pos || pos.itemSize !== 3) return;
    if (!ge.boundingBox) ge.computeBoundingBox();
    const bb = ge.boundingBox, me = o.matrixWorld.elements, id = me[0] === 1 && me[5] === 1 && me[10] === 1 && me[12] === 0 && me[13] === 0 && me[14] === 0 && me[1] === 0 && me[2] === 0 && me[4] === 0 && me[6] === 0 && me[8] === 0 && me[9] === 0;
    if (id && (bb.max.x < cx - R || bb.min.x > cx + R || bb.max.z < cy - R || bb.min.z > cy + R)) return;
    const ix = ge.index, n = ix ? ix.count : pos.count, P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = ix ? ix.getX(i + k) : i + k;
        if (id) { P[k * 3] = pos.getX(j); P[k * 3 + 1] = pos.getY(j); P[k * 3 + 2] = pos.getZ(j); }
        else { v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld); P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z; }
      }
      if (Math.max(P[0], P[3], P[6]) < cx - R || Math.min(P[0], P[3], P[6]) > cx + R || Math.max(P[2], P[5], P[8]) < cy - R || Math.min(P[2], P[5], P[8]) > cy + R) continue;
      // 平らな面だけ（坂は 35° まで）
      const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], wx = P[6] - P[0], wy = P[7] - P[1], wz = P[8] - P[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, nl = Math.hypot(nx, ny, nz);
      if (!(nl > 1e-12) || Math.abs(ny) / nl < 0.82) continue;
      add(P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], P[8]);
    }
  });
  // たてもの（階のあるもの）：区画 "x,y"（10m）
  const blk = new Map(), it = MI.visibleItems();
  for (const b of it.blds.values()) {
    if (!(b.floors > 0) || !b.set || b.bb[2] < cx - R || b.bb[0] > cx + R || b.bb[3] < cy - R || b.bb[1] > cy + R) continue;
    const top = M3.surf(b.cx != null ? b.cx : (b.bb[0] + b.bb[2]) / 2, b.cy != null ? b.cy : (b.bb[1] + b.bb[3]) / 2) + (b.floors * 3.4 + 2.5) * U;   // 屋根の上（3D）
    for (const k of b.set) blk.set(k, Math.max(top, blk.get(k) || 0));
  }
  W.ix = { cells, tri: new Float32Array(tri), ms: Math.round(now() - t0) }; W.blk = blk; W.ixAt = [cx, cy]; W.ixKey = M3.bKey;
}
// (x, y) マスの 足もとの高さ（3D）。f：いまの足もと。のぼれないとき・水に入るとき null
function groundAt(x, y, f, wet0) {
  const t = M3.surf(x, y), lim = f + STEP * U, lim1 = f + 0.55 * U;
  let g = t, on = false, g1 = -Infinity;   // g1：いまの足もとに いちばん近い面（0.55m の 上まで。あれば こちら。段の 坂を のぼっていて 上の 屋根に とびのらない。t70）
  const ix = W.ix;
  if (ix) {
    const a = ix.cells.get(Math.floor(x / IG) * 100003 + Math.floor(y / IG));
    if (a) {
      const P = ix.tri;
      for (const n of a) {
        const ax = P[n], az = P[n + 2], bx = P[n + 3], bz = P[n + 5], cx = P[n + 6], cz = P[n + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-14) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (y - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (y - cz)) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const h = l1 * P[n + 1] + l2 * P[n + 4] + l3 * P[n + 7];
        if (h <= lim && h > t - 0.5 * U) { if (h > g || !on) { g = Math.max(g, h); on = true; } if (h <= lim1 && Math.abs(h - f) < Math.abs(g1 - f)) g1 = h; }
      }
    }
  }
  if (on && g1 > -Infinity && g1 >= t - 0.5 * U && g > lim1) g = Math.max(g1, t);
  if (!on && t > lim) return null;   // 地面の急な段（がけ）
  if (!on && !wet0) { const tl = MI.tileAt(Math.floor(x), Math.floor(y)); if (tl && (tl.t === 'D' || tl.t === 'S' || tl.t === 'R' || tl.t === 'L')) return null; }   // 水（橋の上は 歩ける）
  return g;
}
const cellK = (x, y) => Math.floor(x * 5) + ',' + Math.floor(y * 5);
function blocked(x, y) {   // 人が入れない（たてものの区画）
  if (!W.blk || !W.blk.size) return false;
  const r = 0.28 * U;
  return W.blk.has(cellK(x - r, y - r)) || W.blk.has(cellK(x + r, y - r)) || W.blk.has(cellK(x - r, y + r)) || W.blk.has(cellK(x + r, y + r));
}
// 列車・バスの 当たり判定（t70）：車両の箱（M3.runHit。向き ux・uz、半分の長さ hl・はば hw、高さ y0〜y1）。人の はば r と 足の高さ f で
//   重なる箱と、外へ出る向き（いちばん近い 横・はし）を かえす
function trainAt(x, y, f, r) {
  const L = (M3 || window.m3State || {}).runHit; if (!L || !L.length) return null;
  r = r == null ? 0.3 * U : r;
  for (const h of L) {
    if (h.hl == null || f > h.y1 - 0.2 * U || f < h.y0 - 1.6 * U) continue;   // 屋根より上・ずっと下（高架の下など）は 当たらない
    const ex = x - h.x, ez = y - h.z; if (Math.abs(ex) > h.hl + h.hw + r || Math.abs(ez) > h.hl + h.hw + r) continue;
    const a = ex * h.ux + ez * h.uz, b = -ex * h.uz + ez * h.ux, pa = h.hl + r - Math.abs(a), pb = h.hw + r - Math.abs(b);
    if (pa <= 0 || pb <= 0) continue;
    return pb < pa ? { h, nx: -h.uz * Math.sign(b || 1), ny: h.ux * Math.sign(b || 1), d: pb } : { h, nx: h.ux * Math.sign(a || 1), ny: h.uz * Math.sign(a || 1), d: pa };
  }
  return null;
}
function wetAt(x, y) { const tl = MI.tileAt(Math.floor(x), Math.floor(y)); return !!(tl && (tl.t === 'D' || tl.t === 'S' || tl.t === 'R' || tl.t === 'L')); }
// たてものの中・水の中にいたら、近くの 歩けるところへ（5m ごとに まわりを さがす。300m まで）
function unstuck() {
  const ok = (x, y) => !blocked(x, y) && groundAt(x, y, M3.surf(x, y) + 0.3 * U, false) != null;
  if (!blocked(W.x, W.y) && groundAt(W.x, W.y, W.f + 0.3 * U, false) != null) return false;
  for (let r = 1; r <= 60; r++) for (let i = -r; i <= r; i++) for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]]) {
    const x = W.x + dx * 0.1, y = W.y + dy * 0.1;
    if (!ok(x, y)) continue;
    W.x = x; W.y = y; W.f = groundAt(x, y, M3.surf(x, y) + 0.3 * U, false); W.fv = 0;
    return true;
  }
  return false;
}

/* ---------- 毎フレーム：うごかす ---------- */
function input() {
  let ix = 0, iy = 0;
  const K = W.keys;
  if (K.KeyW || K.ArrowUp) iy += 1; if (K.KeyS || K.ArrowDown) iy -= 1; if (K.KeyD || K.ArrowRight) ix += 1; if (K.KeyA || K.ArrowLeft) ix -= 1;
  let run = W.runOn;   // Q・🏃（止まると もどる）
  if (W.stick.on) { ix += W.stick.x; iy += W.stick.y; if (Math.hypot(W.stick.x, W.stick.y) > 0.93) run = true; }
  const cr = !!(K.ShiftLeft || K.ShiftRight) || W.crOn;   // Shift（おしているあいだ）・🧎
  const m = Math.hypot(ix, iy); if (m > 1) { ix /= m; iy /= m; }
  return { ix, iy, m: Math.min(1, m), run: run && !cr, cr };
}
// ジャンプ（スペース・⤒）：足が 地面に ついているときだけ
function jump() {
  if (!W || W.air || (W.fv || 0) !== 0) return;
  W.fv = -JUMP_V; W.air = true; W.jumpT = now(); W.net.next = 0;
}
function dashSet(on) { if (!W) return; W.runOn = !!on; const b = W.hud && W.hud.querySelector('[data-wk-run]'); if (b) b.classList.toggle('on', W.runOn); }
function crSet(on) { if (!W) return; W.crOn = !!on; const b = W.hud && W.hud.querySelector('[data-wk-cr]'); if (b) b.classList.toggle('on', W.crOn); }

/* ---------- 乗り物（t70）：自転車（うしろに もう1人）・軽トラ（荷台に 何人でも）。ほかの人には 持ち物の番号（24〜27）で 知らせる ----------
   運転：W.veh = { k, v（速さ m/秒） }・乗せてもらう：W.pas = { k, key（運転する人）, lx・ly・lz（乗り物の上の位置 m。+z が前・+x が左） } */
const VEH = {
  bike: { name: '自転車', ico: '🚲', vmax: 6.2, acc: 1.7, brk: 5, rev: 1.2, turn: 1.8, cd: 5.5, seat: [0, 0.37, -0.2], pose: 'bike', pas: 'bikeP' },
  kei: { name: '軽トラ', ico: '🛻', vmax: 16.7, acc: 3.2, brk: 7, rev: 4, turn: 0.95, cd: 9, seat: [-0.34, 0.17, 0.95], pose: 'sit', pas: 'keiP' }
};
const VC = { bike: 24, bikeP: 25, kei: 26, keiP: 27 }, VCK = { 24: 'bike', 25: 'bikeP', 26: 'kei', 27: 'keiP' };
// 形（m。+z が前・+y が上）：どこにでもある ふつうの形（決まった車種は まねない）
function mkVeh(k) {
  const T = T3, g = new T.Group(), M = (ge, c) => new T.Mesh(ge, mat(c));
  const box = (w, h, d, x, y, z, c) => { const q = new T.BoxGeometry(w, h, d); q.translate(x, y, z); g.add(M(q, c)); };
  const tube = (a, b, r, c) => { const va = new T.Vector3(...a), vb = new T.Vector3(...b), L = va.distanceTo(vb), q = new T.CylinderGeometry(r, r, L, 6);
    const m = M(q, c); m.position.copy(va).add(vb).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize()); g.add(m); };
  if (k === 'bike') {
    const F = '#c3c8cf', D = '#26282c';
    for (const z of [0.52, -0.52]) { const w = new T.TorusGeometry(0.31, 0.028, 6, 18); w.rotateY(Math.PI / 2); w.translate(0, 0.33, z); g.add(M(w, D)); tube([0, 0.33, z - 0.02], [0, 0.33, z + 0.02], 0.03, F); }
    const rh = [0, 0.33, -0.52], bb = [0, 0.3, -0.04], st = [0, 0.86, -0.22], hd = [0, 0.86, 0.36], fh = [0, 0.33, 0.52];
    tube(rh, bb, 0.016, F); tube(bb, st, 0.018, F); tube(rh, st, 0.014, F); tube(bb, [0, 0.62, 0.34], 0.02, F); tube(hd, fh, 0.017, F); tube([0, 0.62, 0.34], hd, 0.02, F);
    tube(hd, [0, 1.0, 0.3], 0.014, F); tube([-0.27, 1.0, 0.27], [0.27, 1.0, 0.27], 0.013, F);
    box(0.13, 0.05, 0.24, 0, 0.9, -0.24, D);   // サドル
    box(0.15, 0.02, 0.34, 0, 0.78, -0.47, F);   // うしろの荷台（もう1人）
    for (const [w, h, d, x, y, z] of [[0.34, 0.2, 0.01, 0, 0.82, 0.68], [0.34, 0.2, 0.01, 0, 0.82, 0.42], [0.01, 0.2, 0.26, 0.17, 0.82, 0.55], [0.01, 0.2, 0.26, -0.17, 0.82, 0.55], [0.34, 0.01, 0.26, 0, 0.72, 0.55]]) box(w, h, d, x, y, z, '#4a4d52');   // かご
    tube([0.06, 0.3, -0.04], [0.06, 0.2, 0.05], 0.012, D); tube([-0.06, 0.3, -0.04], [-0.06, 0.4, -0.13], 0.012, D);   // ペダル
  } else {
    const B = '#f1f2ef', D = '#202326', G = '#2c3a44';
    box(1.4, 0.22, 3.3, 0, 0.42, -0.05, '#3a3d40');   // 台
    box(1.46, 0.78, 1.18, 0, 0.9, 1.06, B);   // 運転室（下）
    box(1.42, 0.55, 1.0, 0, 1.56, 0.98, B);   // 運転室（上）
    box(1.32, 0.46, 0.02, 0, 1.56, 1.49, G); box(0.02, 0.4, 0.78, 0.715, 1.56, 1.02, G); box(0.02, 0.4, 0.78, -0.715, 1.56, 1.02, G); box(1.3, 0.3, 0.02, 0, 1.6, 0.475, G);   // まど
    box(1.47, 0.16, 0.08, 0, 0.55, 1.66, D);   // バンパー
    for (const x of [0.52, -0.52]) { box(0.2, 0.12, 0.03, x, 0.86, 1.66, '#fff7d8'); box(0.12, 0.16, 0.03, x * 1.25, 0.82, -1.73, '#c8221a'); }   // 前照灯・尾灯
    box(1.42, 0.05, 1.98, 0, 0.66, -0.74, '#8b8e90');   // 荷台の床
    box(0.04, 0.32, 1.98, 0.69, 0.84, -0.74, B); box(0.04, 0.32, 1.98, -0.69, 0.84, -0.74, B); box(1.42, 0.32, 0.04, 0, 0.84, -1.72, B);   // あおり
    box(1.42, 0.05, 0.04, 0, 1.36, 0.27, '#9aa0a6'); tube([0.66, 0.68, 0.27], [0.66, 1.36, 0.27], 0.02, '#9aa0a6'); tube([-0.66, 0.68, 0.27], [-0.66, 1.36, 0.27], 0.02, '#9aa0a6');   // 鳥居（荷台の前）
    for (const [x, z] of [[0.62, 1.05], [-0.62, 1.05], [0.62, -1.18], [-0.62, -1.18]]) { const w = new T.CylinderGeometry(0.28, 0.28, 0.17, 12); w.rotateZ(Math.PI / 2); w.translate(x, 0.28, z); g.add(M(w, D)); }
  }
  g.scale.setScalar(U);
  return g;
}
// 乗り物の上の 人の位置 → 地図（x, y, f）。h：乗り物の向き
const vehAt = (x, y, f, h, l) => [x + (Math.sin(h) * l[2] + Math.cos(h) * l[0]) * U, y + (Math.cos(h) * l[2] - Math.sin(h) * l[0]) * U, f + l[1] * U];
function vehShow(on) {   // 自分の 乗り物の形
  if (W.vm) { M3.sc.remove(W.vm); W.vm = null; }
  if (on && W.veh) { W.vm = mkVeh(W.veh.k); M3.sc.add(W.vm); }
}
function vehOn(k) {   // 乗る（運転）
  if (!W || W.ride || !VEH[k]) return;
  if (W.pas) pasOff();
  sitSet(false); crSet(false);
  W.veh = { k, v: 0 }; W.cd0 = W.cd0 || W.cd; W.cd = Math.max(W.cd, VEH[k].cd); vehShow(true); W.net.next = 0; W.hudT = 0; vehBtn();
}
function vehOff() {
  if (!W || !W.veh) return;
  const V = VEH[W.veh.k], h = W.h, sx = W.x - Math.cos(h) * (W.veh.k === 'kei' ? 1.3 : 0.6) * U, sy = W.y + Math.sin(h) * (W.veh.k === 'kei' ? 1.3 : 0.6) * U;   // 右がわへ おりる
  W.veh = null; vehShow(false); if (W.cd0) { W.cd = W.cd0; W.cd0 = null; }
  if (!blocked(sx, sy)) { const g = groundAt(sx, sy, W.f + 0.5 * U, false); if (g != null) { W.x = sx; W.y = sy; W.f = g; } }
  unstuck(); W.net.next = 0; W.hudT = 0; vehBtn(); void V;
}
// 近くで 運転している人（4m。乗せてもらえる）
function vehNear() {
  let best = null, bd = 4 * U;
  for (const o of W.others.values()) { const k = VCK[o.vc]; if (!k || !VEH[k]) continue; const d = Math.hypot(o.dx - W.x, o.dy - W.y); if (d < bd) { bd = d; best = o; } }
  return best;
}
function pasOn(o) {
  const k = VCK[o.vc]; if (!k || !VEH[k] || W.ride) return;
  if (W.veh) vehOff();
  sitSet(false); crSet(false);
  const lz = k === 'bike' ? -0.47 : -1.55 + Math.random() * 1.45, lx = k === 'bike' ? 0 : (Math.random() - 0.5) * 1.0;
  W.pas = { k, key: o.k, lx, ly: k === 'bike' ? 0.32 : 0.69, lz, sit: k === 'bike' };
  W.net.next = 0; W.hudT = 0; vehBtn();
}
function pasOff() {
  const P = W.pas; if (!P) return;
  W.pas = null; const sx = W.x - Math.cos(W.h) * 1.2 * U, sy = W.y + Math.sin(W.h) * 1.2 * U;
  if (!blocked(sx, sy)) { const g = groundAt(sx, sy, W.f + 0.5 * U, false); if (g != null) { W.x = sx; W.y = sy; W.f = g; } }
  W.fv = 0; unstuck(); W.net.next = 0; W.hudT = 0; vehBtn();
}
function vehBtn() { const b = W.hud && W.hud.querySelector('[data-wk-veh]'); if (b) { b.classList.toggle('on', !!(W.veh || W.pas)); b.textContent = W.veh ? VEH[W.veh.k].ico : W.pas ? '⏏' : '🚲'; } }
// 🚲（V）：運転中・乗せてもらっているなら おりる。近くに 運転している人がいれば 乗せてもらう。でなければ えらぶ
function vehTap() {
  if (!W || W.ride) return;
  if (W.veh) return vehOff();
  if (W.pas) return pasOff();
  const o = vehNear(); if (o) return pasOn(o);
  const p = W.hud.querySelector('.wk-pick');
  if (!p.hidden && p.dataset.k === 'veh') { p.hidden = true; return; }
  p.dataset.k = 'veh'; p.hidden = false;
  p.innerHTML = `<div class="wk-ph"><b>🚲 乗り物</b><button data-wk-pc title="とじる">✕</button></div>
    <div class="wk-grid">${Object.entries(VEH).map(([k, v]) => `<button class="wk-sk" data-vk="${k}"><span style="font-size:34px;line-height:1.3">${v.ico}</span><small>${v.name}</small></button>`).join('')}</div>
    <p class="small" style="margin:8px 0 0;color:#667">W・S で すすむ・とまる、A・D で まがる。自転車は うしろに 1人、軽トラは 荷台に 何人でも 乗せられます（近くの人が 🚲 か F で 乗ります）。V か ⏏ で おりる</p>`;
  p.querySelector('[data-wk-pc]').onclick = () => { p.hidden = true; };
  p.querySelectorAll('[data-vk]').forEach(b => b.onclick = () => { p.hidden = true; vehOn(b.dataset.vk); });
}
// 運転（毎フレーム）：I.iy で 速さ・I.ix で まがる。たてもの・列車・水には 入れない（とまる）
function vehStep(I, dt) {
  const V = VEH[W.veh.k], c = W.veh;
  const th = W.stick.on ? I.iy : (W.keys.KeyW || W.keys.ArrowUp ? 1 : 0) - (W.keys.KeyS || W.keys.ArrowDown ? 1 : 0);
  const st = W.stick.on ? I.ix : (W.keys.KeyD || W.keys.ArrowRight ? 1 : 0) - (W.keys.KeyA || W.keys.ArrowLeft ? 1 : 0);
  const tg = V.vmax * (I.run ? 1 : 0.75) * th;   // Q（🏃）で いちばん速く
  if (th > 0.05) c.v = c.v < 0 ? Math.min(0, c.v + V.brk * dt) : c.v < tg ? Math.min(tg, c.v + V.acc * dt) : Math.max(tg, c.v - 0.9 * dt);
  else if (th < -0.05) c.v = c.v > 0 ? Math.max(0, c.v - V.brk * dt) : Math.max(-V.rev, c.v - V.acc * 0.6 * dt);
  else c.v = c.v > 0 ? Math.max(0, c.v - 0.9 * dt) : Math.min(0, c.v + 0.9 * dt);   // ころがる
  c.v = clamp(c.v, -V.rev, V.vmax);
  const tr = st * V.turn * Math.min(1, Math.abs(c.v) / 2.5 + (W.veh.k === 'bike' ? 0.25 : 0)) * (c.v < 0 ? -1 : 1);
  W.h -= tr * dt;   // D（+1）で 右へ
  const d = c.v * dt * U, nx = W.x + Math.sin(W.h) * d, ny = W.y + Math.cos(W.h) * d;
  let ok = Math.abs(d) > 0 && !blocked(nx, ny) && !trainAt(nx, ny, W.f, (W.veh.k === 'kei' ? 0.8 : 0.4) * U);
  const g = ok ? groundAt(nx, ny, W.f + (W.veh.k === 'kei' ? 0.35 : 0.25) * U, false) : null;
  if (ok && g != null) { W.x = nx; W.y = ny; W.gt = g; } else if (Math.abs(d) > 0) c.v *= -0.15;   // ぶつかった
  // カメラ：走っているときは うしろへ まわる
  if (Math.abs(c.v) > 1) { let da = W.h + Math.PI - M3.yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; M3.yaw += da * Math.min(1, dt * 1.6); }
  if (W.vm) { W.vm.position.set(W.x, W.f, W.y); W.vm.rotation.y = W.h; }
  return Math.abs(c.v);
}
/* ---------- 列車に乗る（t70）：駅に止まった列車の ひらいた ドアから 入る → 車両の中を 歩く・すわる（R）。ひらいた ドアから ホームへ 出る
   W.ride：{ rid, tid, kc（何両目）, lx・lz（車両の中の位置 m。x：運転台の向き・z：右）, lh（車両に対する 向き）, sit } ---------- */
const FLOOR = 1.18;   // 床の高さ（レールの上 m）
function rideCar(R) { const L = M3.runHit; if (!L) return null; for (const h of L) if (h.rid === R.rid && h.tid === R.tid && h.kc === R.kc && h.hl != null) return h; return null; }
const doorAt = (h, side, lx) => { const L = h.dx && h.dx[side]; if (!L) return null; for (const x of L) if (Math.abs(lx - x) < 0.62) return x; return null; };
function rideTry(h, nx, ny) {
  if (!h || h.mv || h.rid == null || W.ride) return false;
  const ex = (nx - h.x) / U, ez = (ny - h.z) / U, lx = ex * h.ux + ez * h.uz, lz = -ex * h.uz + ez * h.ux, side = lz > 0 ? 'R' : 'L';
  if (!((side === 'R' ? h.oR : h.oL) > 0.7) || doorAt(h, side, lx) == null) return false;
  if (Math.abs(W.f - (h.y0 + FLOOR * U)) > 0.8 * U) return false;   // ホームの高さから
  W.ride = { rid: h.rid, tid: h.tid, kc: h.kc, lx, lz: Math.sign(lz) * Math.max(0.2, h.hw / U - 0.5), lh: W.h - Math.atan2(h.ux, h.uz), sit: 0 };
  W.fv = 0; W.air = false; crSet(false); W.hudT = 0;
  return true;
}
function rideOff(x, y) {   // おりる：(x, y) の ホームへ（なければ 近くの 歩けるところ）
  const R = W.ride; W.ride = null; W.hudT = 0; sitSet(false);
  if (x != null) { const g = groundAt(x, y, W.f + 0.4 * U, false); W.x = x; W.y = y; if (g != null) { W.f = g; W.fg = g; } }
  W.fv = 0; unstuck();
  return R;
}
// 車両の中で うごく（入力 I。車両の 向き ux・uz に あわせる）
function rideIn(I, dt, yaw) {
  const R = W.ride, h = rideCar(R);
  if (!h) { R.miss = (R.miss || 0) + dt; W.spd = 0; if (R.miss > 2) rideOff(); return; }   // 列車が 見えなくなった（とおくへ・終着）
  R.miss = 0;
  const Lh = h.hl / U - 0.45, Wh = h.hw / U - 0.4, ca = Math.atan2(h.ux, h.uz);
  let spd = 0;
  if (I.m > 0.05) {
    if (R.sit) sitSet(false);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * I.iy + rx * I.ix, dz = fz * I.iy + rz * I.ix; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    let da = Math.atan2(dx, dz) - W.h; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    W.h += clamp(da, -10 * dt, 10 * dt); R.lh = W.h - ca;
    const v = I.m * (I.cr ? SPD.sneak : I.run ? SPD.run * 0.7 : SPD.walk), d = v * dt;   // 車内は 走っても ゆっくり
    let nx = clamp(R.lx + (dx * h.ux + dz * h.uz) * d, -Lh, Lh), nz = R.lz + (-dx * h.uz + dz * h.ux) * d;
    const side = nz > 0 ? 'R' : 'L', open = !h.mv && (side === 'R' ? h.oR : h.oL) > 0.7 && doorAt(h, side, nx) != null;
    if (open && Math.abs(nz) > Wh + 0.5) {   // ドアから ホームへ
      const oz = Math.sign(nz) * (h.hw / U + 0.45);
      W.lastRun = I.run; rideOff(h.x + (h.ux * nx - h.uz * oz) * U, h.z + (h.uz * nx + h.ux * oz) * U); W.spd = v; return;
    }
    nz = clamp(nz, -(open ? Wh + 0.6 : Wh), open ? Wh + 0.6 : Wh);
    spd = Math.hypot(nx - R.lx, nz - R.lz) / Math.max(dt, 1e-3); R.lx = nx; R.lz = nz;
  } else if (Math.abs(R.lz) > Wh && (h.mv || !((R.lz > 0 ? h.oR : h.oL) > 0.7))) R.lz = Math.sign(R.lz) * Wh;   // ドアが しまったら 中へ
  W.spd = spd; W.lastRun = I.run; W.cr = I.cr && !R.sit;
}
// 列車を うごかしたあと（map3d の m3Runs のあと）：車両の中の位置 → 地図の位置
function post() {
  if (!W || !W.ride || !W.av) return;
  const R = W.ride, h = rideCar(R); W.rh = h; if (!h) return;
  const x = h.x + (h.ux * R.lx - h.uz * R.lz) * U, y = h.z + (h.uz * R.lx + h.ux * R.lz) * U, t = now();
  if (W.rp && t > W.rp[2]) W.wspd = Math.hypot(x - W.rp[0], y - W.rp[1]) / U / ((t - W.rp[2]) / 1000);
  W.rp = [x, y, t];
  W.x = x; W.y = y; W.f = h.y0 + FLOOR * U; W.fg = W.f; W.air = false; W.fv = 0;
  W.h = R.sit ? (R.lz > 0 ? Math.atan2(h.uz, -h.ux) : Math.atan2(-h.uz, h.ux)) : Math.atan2(h.ux, h.uz) + R.lh;   // すわると 通路の向き
  W.av.root.position.set(W.x, W.f, W.y); W.av.root.rotation.y = W.h;
  M3.tx = W.x; M3.ty = W.y;
}
// すわる（R・🪑。t70）：乗っていれば 窓がわの 長いす（ドアの前は よける）、乗っていなければ その場に
function sitSet(on) {
  if (!W) return;
  const R = W.ride;
  if (on && R) {
    const h = rideCar(R); if (!h) return;
    const side = R.lz >= 0 ? 'R' : 'L', d = doorAt(h, side, R.lx), Lh = h.hl / U - 1.2;
    if (d != null) R.lx = clamp(R.lx >= d ? d + 1.05 : d - 1.05, -Lh, Lh);
    R.lz = (side === 'R' ? 1 : -1) * Math.max(0.2, h.hw / U - 0.62);
  }
  if (R) R.sit = on ? 1 : 0; else W.sitG = !!on;
  const b = W.hud && W.hud.querySelector('[data-wk-sit]'); if (b) b.classList.toggle('on', !!on);
  W.net.next = 0; W.hudT = 0;
}
const sitOn = () => !!(W && (W.ride ? W.ride.sit : W.sitG));
function step() {
  if (!W || !M3.on) return;
  const t = now(), dt = Math.min(0.25, Math.max(0, (t - W.t) / 1000)); W.t = t;
  if (W.ixKey !== M3.bKey || Math.hypot(W.x - W.ixAt[0], W.y - W.ixAt[1]) > 3) {
    try { idxBuild(); if (W.spawn) spawnPlace(); if (!W.ride) unstuck(); } catch (e) { console.error(e); }
  }
  if (W.spawn && t > W.spawn.until) { W.spawn = null; MI.hint(''); }
  if (!W.ride) { const t0 = M3.surf(W.x, W.y); if (W.f < t0) { W.f = t0; W.fv = 0; } }   // 地形の網が こまかくなって 地面の下に なったら 上へ
  const I = input(), yaw = M3.yaw;
  let spd = 0;
  W.cr = I.cr;
  if (W.sitG && (I.m > 0.05 || W.air)) sitSet(false);   // その場に すわっていて うごいたら 立つ
  if (W.pas) {   // 乗せてもらっている（t70）：運転する人の 乗り物の上。うごくと おりる
    const o = W.others.get(W.pas.key);
    if (!o || !VCK[o.vc] || I.m > 0.6) pasOff();
    else {
      others(dt);
      const p = vehAt(o.dx, o.dy, o.df, o.dh, [W.pas.lx, W.pas.ly, W.pas.lz]); W.x = p[0]; W.y = p[1]; W.f = p[2]; W.fg = W.f; W.h = o.dh; W.air = false; W.fv = 0;
      W.av.root.position.set(W.x, W.f, W.y); W.av.root.rotation.y = W.h; M3.tx = W.x; M3.ty = W.y;
      poseAv(W.av, dt, 0, false, { it: 0, sit: W.pas.sit || W.sitG ? 1 : 0 });
      net(t); hudTick(t); return;
    }
  }
  if (W.veh) {   // 運転している（t70）
    const sp = vehStep(I, dt);
    const g = W.gt != null ? W.gt : groundAt(W.x, W.y, W.f, true); W.gt = null;
    if (g != null) { if (g >= W.f) W.f = g; else W.f = Math.max(g, W.f - 4 * dt * U); }
    if (W.vm) W.vm.position.y = W.f;
    const V = VEH[W.veh.k], p = vehAt(W.x, W.y, W.f, W.h, V.seat);
    W.av.root.position.set(p[0], p[2], p[1]); W.av.root.rotation.y = W.h; M3.tx = W.x; M3.ty = W.y;
    W.spd = sp; W.air = false; W.fv = 0;
    poseAv(W.av, dt, V.pose === 'bike' ? sp * 0.5 : 0, false, { it: 0, sit: 1, bike: V.pose === 'bike' ? 1 : 0 });
    others(dt); net(t); hudTick(t); return;
  }
  if (W.ride) {   // 列車に 乗っている（t70）
    rideIn(I, dt, yaw);
    if (W.ride) {
      const A = W.av;
      poseAv(A, dt, W.spd, !!W.lastRun, { cr: W.cr, air: false, it: W.item | 0, sit: W.ride.sit });
      others(dt); net(t); hudTick(t);
      return;
    }
  }
  if (I.m > 0.05) { W.idleT = 0; if (W.spawn) { W.spawn = null; MI.hint(''); } }   // うごいたら 歩きはじめる場所に よせない
  else if (W.runOn && (W.idleT = (W.idleT || 0) + dt) > 0.8) dashSet(false);   // 止まったら 走るのを やめる
  if (I.m > 0.05) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * I.iy + rx * I.ix, dz = fz * I.iy + rz * I.ix; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // 向き：すぐに（1秒に 10 ラジアン）
    let da = Math.atan2(dx, dz) - W.h; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    W.h += clamp(da, -10 * dt, 10 * dt);
    const v = I.m * (I.cr ? SPD.sneak : I.run ? SPD.run : SPD.walk), d = v * dt * U, wet0 = wetAt(W.x, W.y);
    const tryTo = (nx, ny) => {
      if (W.ride || blocked(nx, ny)) return null;
      const th = trainAt(nx, ny, W.f); if (th && !trainAt(W.x, W.y, W.f)) { rideTry(th.h, nx, ny); return null; }   // 列車には 入れない（t70）。ひらいた ドアからは 乗る
      const g = groundAt(nx, ny, W.f, wet0); if (g == null || (!W.air && (g < W.f - 2.2 * U || (g < W.f - 0.6 * U && W.f - M3.surf(W.x, W.y) > 3 * U)))) return null; return [nx, ny, g]; };   // 高い ところ（跨線橋・段）からは 歩いて おりない（ジャンプなら おりられる。t70）
    let r = tryTo(W.x + dx * d, W.y + dz * d);
    if (!r && Math.abs(dx) > 0.15) r = tryTo(W.x + Math.sign(dx) * d * Math.abs(dx), W.y);   // かべに そって
    if (!r && Math.abs(dz) > 0.15) r = tryTo(W.x, W.y + Math.sign(dz) * d * Math.abs(dz));
    if (r) { spd = Math.hypot(r[0] - W.x, r[1] - W.y) / U / Math.max(dt, 1e-3); W.x = r[0]; W.y = r[1]; W.gt = r[2]; }
    W.lastRun = I.run;
  }
  // 走ってくる列車に 当たったら、横へ おしだされる（t70。線路の上に 立たないで）
  if (!W.ride) { const hc = trainAt(W.x, W.y, W.f); if (hc) { const nx = W.x + hc.nx * (hc.d + 0.02 * U), ny = W.y + hc.ny * (hc.d + 0.02 * U); if (!blocked(nx, ny)) { W.x = nx; W.y = ny; W.bump = t; } } }
  // 高さ：のぼるのは すぐ・おりるのは 落ちる（重力）。ジャンプ（fv < 0）で 上へ
  const g = W.gt != null && spd > 0 ? W.gt : groundAt(W.x, W.y, W.f, true);
  W.gt = null;
  if (g != null) {
    W.fg = g;
    if (g >= W.f && !(W.fv < 0)) { W.f = g; W.fv = 0; }
    else { W.fv = (W.fv || 0) + 9.8 * dt; W.f = Math.max(g, W.f - W.fv * dt * U); if (W.f === g && W.fv > 0) W.fv = 0; }
  }
  W.air = W.f > (W.fg != null ? W.fg : W.f) + 0.03 * U;
  W.spd = spd;
  const A = W.av;
  A.root.position.set(W.x, W.f, W.y); A.root.rotation.y = W.h;
  poseAv(A, dt, spd, !!W.lastRun, { cr: W.cr, air: W.air, it: W.item | 0, sit: !!W.sitG });
  M3.tx = W.x; M3.ty = W.y;
  if (A.wait && !A.P.mmd) { const e = MMD.get(skinOf(A.code).file); if (e && (e.mesh || e.fail)) avSelf(); }
  others(dt);
  net(t);
  hudTick(t);
}
// うしろからのカメラ（たてものの中・地面の下に入らないように）
function camReach(yaw, p, ty) {   // ピッチ p で カメラを どこまで 引けるか（3D の長さ）
  let d = W.cd * U;
  const ox = Math.sin(yaw) * Math.cos(p), oz = Math.cos(yaw) * Math.cos(p), oy = Math.sin(p), r = 0.2 * U;
  for (let k = 1; k <= 12; k++) {
    const f = k / 12, px = W.x + ox * d * f, pz = W.y + oz * d * f, py = ty + oy * d * f;
    let top = 0; if (W.blk) for (const [a, b] of [[-r, -r], [r, -r], [-r, r], [r, r]]) { const t = W.blk.get(cellK(px + a, pz + b)); if (t > top) top = t; }
    if (top > py - 0.3 * U || M3.surf(px, pz) > py - 0.25 * U || (W.ride && W.rh && !inCar(W.rh, px, pz, py))) { d = Math.max(0.6 * U, d * (k - 1) / 12); break; }   // 乗っているときは 車両の中だけ（t70）
  }
  return d;
}
// 頭の上（1.8〜3.6m）に 屋根・天井がある（ホームの屋根の下・跨線橋の中。t70）：カメラを 自分の目に
function roofOver(x, y, f) {
  const ix = W.ix; if (!ix) return false;
  const a = ix.cells.get(Math.floor(x / IG) * 100003 + Math.floor(y / IG)); if (!a) return false;
  const P = ix.tri;
  for (const n of a) {
    const ax = P[n], az = P[n + 2], bx = P[n + 3], bz = P[n + 5], cx = P[n + 6], cz = P[n + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-14) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (y - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (y - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const h = l1 * P[n + 1] + l2 * P[n + 4] + l3 * P[n + 7];
    if (h > f + 1.8 * U && h < f + 3.6 * U) return true;
  }
  return false;
}
const inCar = (h, x, z, y) => { const ex = (x - h.x) / U, ez = (z - h.z) / U; return Math.abs(ex * h.ux + ez * h.uz) < h.hl / U - 0.2 && Math.abs(-ex * h.uz + ez * h.ux) < h.hw / U - 0.15 && y < h.y0 + (FLOOR + 2.05) * U; };
function cam() {
  const C = M3.cam, yaw = M3.yaw, ty = W.f + HEAD * (1 - 0.3 * ((W.av && W.av.cr) || 0) - 0.33 * ((W.av && W.av.sit) || 0)) * U, t = now(), dt = Math.min(0.25, Math.max(0, (t - (W.ct || t)) / 1000)); W.ct = t;
  let p = W.pitch, d = camReach(yaw, p, ty);
  if (d < W.cd * U * 0.6 && d < 3 * U) for (const dp of [0.25, 0.5]) {   // うしろが 低い たてものなら 上から（高い たてものなら 近くに よせる）
    const p2 = Math.min(0.95, W.pitch + dp), d2 = camReach(yaw, p2, ty);
    if (d2 > d + 0.4 * U) { p = p2; d = d2; if (d2 >= Math.min(W.cd, 3) * U) break; }
  }
  // なめらかに（近づくのは すぐ・はなれるのは ゆっくり）
  W.cpS = W.cpS == null ? p : W.cpS + (p - W.cpS) * Math.min(1, dt * 5);
  W.cdS = W.cdS == null || d < W.cdS ? d : W.cdS + (d - W.cdS) * Math.min(1, dt * 4);
  if (Math.abs(W.cpS - p) > 0.02) { const dS = camReach(yaw, W.cpS, ty); if (dS < W.cdS) W.cdS = dS; }
  d = W.cdS; p = W.cpS;
  const ox = Math.sin(yaw) * Math.cos(p), oz = Math.cos(yaw) * Math.cos(p), oy = Math.sin(p);
  let cx = W.x + ox * d, cz = W.y + oz * d, cy = ty + oy * d;
  // たてものに じゃまされて 近くに よせたときは、頭の上から すこし前を見る（頭で 前が見えなく ならないように）。とても近いときは 自分を かくす
  const cl = clamp((1.8 - d / U) / 1.8, 0, 1), fx = -Math.sin(yaw) * cl * 1.4 * U, fz = -Math.cos(yaw) * cl * 1.4 * U;
  cy += cl * 0.55 * U;
  const gc = M3.surf(cx, cz); if (cy < gc + 0.35 * U) cy = gc + 0.35 * U;
  if ((W.ride && d < 1.3 * U) || (!W.ride && !W.veh && !W.pas && roofOver(W.x, W.y, W.f))) {   // 車内で せまい・屋根の下：自分の目から（t70）
    const ex = -Math.sin(yaw), ez = -Math.cos(yaw);
    C.position.set(W.x + ex * 0.12 * U, ty, W.y + ez * 0.12 * U); C.lookAt(W.x + ex * 3 * U, ty - Math.sin(W.pitch - 0.32) * 3 * U, W.y + ez * 3 * U);
    if (W.av) W.av.root.visible = false;
  } else {
    C.position.set(cx, cy, cz); C.lookAt(W.x + fx, ty + cl * 0.2 * U, W.y + fz);
    if (W.av) W.av.root.visible = d > 0.75 * U;
  }
  C.near = 0.12 * U; C.far = 80; C.updateProjectionMatrix();
  // 遠くの海の大きな板（20km）は、カメラのまわりだけに（近い面が 0.1m なので、大きすぎる板は 奥行きが こわれて 手前に出る）
  if (M3.sea) { M3.sea.scale.set(0.012, 0.012, 1); M3.sea.position.x = cx; M3.sea.position.z = cz; }
  const fog = M3.sc.fog; if (fog) { const q = MI.MQ ? MI.MQ.d3 : 1; fog.near = 6 + q * 2; fog.far = 30 + q * 10; }
}
function look(dx, dy) { if (!W) return; M3.yaw -= dx * 0.006 * (MI.S.v3x ? -1 : 1); W.pitch = clamp(W.pitch + dy * 0.0045, -0.35, 1.25); }
function zoom(f) { if (!W) return; W.cd = clamp(W.cd / f, 1.4, 30); }

/* ---------- ほかの人（サーバーと やりとり：av_step。DB の更新119） ---------- */
//   自分の位置・向き・うごきだけを送って、近く（400m）の人の 位置・向き・うごきを受けとる（サーバーと この端末のあいだだけ）。
//   自分が うごいているときは 0.5秒・近くの人が うごいているときは 0.6秒・止まっているときは 1.5秒（まわりに だれもいなければ 3秒）ごと。
//   名前と見た目は 知らない人のぶんだけ サーバーがつける。受けとった位置と 速さ（はじめは 向きと うごき）で、つぎの位置まで なめらかに動かす（その人を この端末で組み立てる）
//   うごき m（DB の更新122）：0 止まる・1 歩く・2 走る・3 しゃがむ・4 しゃがんで歩く・5 ジャンプした（受けとった端末が とぶ形を つくる）。持ち物 i。
//   チャット：近く（400m）の 1分以内のものを いっしょに受けとる（c：受けとった いちばん大きい番号のあと）
const WHO = new Map();   // しるし → { n, c, l, v }
const r4 = v => Math.round(v * 1e4) / 1e4;
const v122 = () => ((MI && MI.S && MI.S.dbv) || 0) >= 122;   // サーバーの更新122 のあと（しゃがむ・ジャンプ・持ち物・チャットを ほかの人に）
const v124 = () => ((MI && MI.S && MI.S.dbv) || 0) >= 124;   // サーバーの更新124 のあと（フレンドを 街歩きに よぶ）
const mvSt = m => m === 1 || m === 2 || m === 4;   // 進んでいる うごき
function stepArgs(m) {
  const known = [];
  for (const o of W.others.values()) { const w = WHO.get(o.k); if (w && w.v === o.v && known.length < 60) known.push(o.k); }
  const f = W.air && W.fg != null ? W.fg : W.f;   // ジャンプ中は 足もとの地面（とぶ形は 受けとった端末で）
  const a = { p_k: W.me.k, p_x: r4(W.x), p_y: r4(W.y), p_f: r4(f), p_h: Math.round(W.h * 100) / 100, p_m: m, p_v: W.lv, p_known: known };
  if (v122()) { a.p_i = W.veh ? VC[W.veh.k] : W.pas ? VC[VEH[W.pas.k].pas] : W.item | 0; a.p_c = W.chat.since || null; }   // 乗り物（t70）：持ち物の番号 24〜27
  else a.p_m = m === 3 ? 0 : m === 4 ? 1 : m === 5 ? (W.spd > 0.05 ? 1 : 0) : m;   // 更新122 の前：止まる・歩く・走る だけ
  return a;
}
function onStep(r, t) {
  if (!W || !r || !Array.isArray(r.o)) return;
  const seen = new Set();
  for (const m of r.o) {
    if (!m || typeof m.k !== 'string' || !/^[0-9a-f]{8,24}$/.test(m.k) || (W.me && m.k === W.me.k)) continue;
    const x = Number(m.x), y = Number(m.y), f = Number(m.f), h = Number(m.h);
    if (![x, y, f, h].every(Number.isFinite)) continue;
    seen.add(m.k);
    const ts = t - clamp(Number(m.a) || 0, 0, 15000);   // その位置の時刻（この端末の時計で）
    let o = W.others.get(m.k);
    if (!o) {
      if (W.others.size >= OTHER_CAP * 2) continue;
      o = { k: m.k, x, y, f, h, dx: x, dy: y, df: f, dh: h, vx: 0, vy: 0, ts, av: null, v: Number(m.v) | 0, m: 0, miss: 0, vm: false };
      W.others.set(m.k, o);
    } else if (ts > o.ts + 40) {
      const d = (ts - o.ts) / 1000;
      o.vm = d < 4 && Math.hypot(x - o.x, y - o.y) < 0.6;   // 前の位置からの速さ（はかれた）
      if (o.vm) { o.vx = (x - o.x) / d; o.vy = (y - o.y) / d; }
      o.x = x; o.y = y; o.f = f; o.h = h; o.ts = ts;
    }
    const pm = o.m; o.m = clamp(Number(m.m) | 0, 0, 5);
    if (o.m === 5 && pm !== 5) o.jt = t;   // ジャンプした：この端末で とぶ
    if (!mvSt(o.m) && o.m !== 5) { o.vx = 0; o.vy = 0; o.vm = false; }
    else if (!o.vm && mvSt(o.m)) { const v = (o.m === 2 ? SPD.run : o.m === 4 ? SPD.sneak : SPD.walk) * U; o.vx = Math.sin(h) * v; o.vy = Math.cos(h) * v; }   // はじめは 向きと うごきから
    { const ic = Number(m.i) | 0; o.vc = VCK[ic] ? ic : 0; o.it = o.vc ? 0 : clamp(ic, 0, ITEMS.length - 1); }   // 乗り物（t70）
    o.v = Number(m.v) | 0; o.t = t; o.miss = 0;
    if (m.c != null) {   // 名前と見た目（知らない人・見た目を変えた人のぶんだけ）
      WHO.set(m.k, { n: String(m.n || '').slice(0, 40), c: String(m.c || 'base'), l: m.l && typeof m.l === 'object' ? m.l : {}, v: o.v });
      if (CAT && !CAT.off && !CAT.skins.has(String(m.c)) && now() - (W.catT || 0) > 30000) { W.catT = now(); catLoad(true); }   // 新しい見た目（表を とりなおす）
    }
  }
  for (const o of W.others.values()) if (!seen.has(o.k)) o.miss = (o.miss || 0) + 1;
  // チャット（DB の更新122）
  if (Array.isArray(r.c)) for (const c of r.c) {
    const id = Number(c && c.id); if (!(id > (W.chat.since || 0))) continue;
    W.chat.since = id;
    if (typeof c.k !== 'string' || (W.me && c.k === W.me.k) || W.chat.mute.has(c.k)) continue;
    chatAdd({ k: c.k, n: String(c.n || '').slice(0, 40), t: String(c.t || '').slice(0, 80), at: now() - clamp(Number(c.a) || 0, 0, 60000) });
  }
}
function others(dt) {
  const t = now(), list = [];
  for (const o of W.others.values()) {
    if (o.miss >= (o.dist < 6 ? 1 : 2) || t - o.t > LOST) { if (o.av) M3.sc.remove(o.av.root); if (o.vm) M3.sc.remove(o.vm); W.others.delete(o.k); continue; }   // 来なかったら いなくなった（400m のふちは 2回）
    // 受けとった位置 ＋ 速さ × すぎた時間（1.2秒まで）に なめらかに（0.2秒ほどで おいつく。遠いと とぶ）
    const ex = mvSt(o.m) || (o.m === 5 && o.vm) ? Math.min(1, (t - o.ts) / 1000) : 0, tx = o.x + o.vx * ex, ty = o.y + o.vy * ex;
    const k = 1 - Math.exp(-dt / 0.2), jump = Math.hypot(tx - o.dx, ty - o.dy) > 1;
    const px = o.dx, py = o.dy;
    if (jump) { o.dx = tx; o.dy = ty; o.df = o.f; o.dh = o.h; }
    else { o.dx += (tx - o.dx) * k; o.dy += (ty - o.dy) * k; o.df += (o.f - o.df) * k; let da = o.h - o.dh; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; o.dh += da * Math.min(1, k * 1.5); }
    o.spd = jump ? 0 : Math.hypot(o.dx - px, o.dy - py) / U / Math.max(dt, 1e-3);
    o.dist = Math.hypot(o.dx - W.x, o.dy - W.y);
    list.push(o);
  }
  list.sort((a, b) => a.dist - b.dist);
  let n = 0;
  for (const o of list) {
    const w = WHO.get(o.k), show = w && o.dist < SEE && n < OTHER_CAP;
    if (!show) { if (o.av) { M3.sc.remove(o.av.root); o.av = null; } if (o.vm) { M3.sc.remove(o.vm); o.vm = null; } continue; }
    n++;
    const hk = JSON.stringify(w.l || {}), e = MMD.get(skinOf(w.c).file);
    if (!o.av || o.av.code !== w.c || o.av.hk !== hk || (o.av.wait && e && (e.mesh || e.fail))) {
      if (o.av) M3.sc.remove(o.av.root);
      o.av = mkAvatar(w.c, w.l, false); M3.sc.add(o.av.root);
    }
    // ジャンプ：受けとったときから この端末で とぶ（上へ JUMP_V・重力）
    let jy = 0;
    if (o.jt) { const tj = (t - o.jt) / 1000; if (tj < 2 * JUMP_V / 9.8) jy = Math.max(0, JUMP_V * tj - 4.9 * tj * tj); else o.jt = 0; }
    const vk = VCK[o.vc], V = vk && VEH[vk];   // 運転している人：乗り物の形と、いすの上に（t70）
    if (V) {
      if (!o.vm || o.vm.userData.k !== vk) { if (o.vm) M3.sc.remove(o.vm); o.vm = mkVeh(vk); o.vm.userData.k = vk; M3.sc.add(o.vm); }
      o.vm.position.set(o.dx, o.df, o.dy); o.vm.rotation.y = o.dh;
      const p = vehAt(o.dx, o.dy, o.df, o.dh, V.seat); o.av.root.position.set(p[0], p[2], p[1]); o.av.root.rotation.y = o.dh;
      poseAv(o.av, dt, V.pose === 'bike' ? o.spd * 0.5 : 0, false, { it: 0, sit: 1, bike: V.pose === 'bike' ? 1 : 0 });
      continue;
    }
    if (o.vm) { M3.sc.remove(o.vm); o.vm = null; }
    o.av.root.position.set(o.dx, o.df + jy * U, o.dy); o.av.root.rotation.y = o.dh;
    poseAv(o.av, dt, mvSt(o.m) ? Math.max(o.spd, 0.3) : o.spd * 0.5, o.m === 2, { cr: o.m === 3 || o.m === 4, air: jy > 0.03, it: o.it || 0, sit: o.vc === 25 ? 1 : 0 });
  }
  W.near = n;
}
function net(t) {
  const N = W.net; if (!W.me || !W.me.k || N.off) return;
  const rmv = (!!W.ride && (W.wspd || 0) > 0.5) || (!!W.veh && Math.abs(W.veh.v) > 0.3) || !!W.pas, mv = W.spd > 0.05 || rmv;   // 乗っている列車・乗り物が 走っている（t70）
  let st = W.cr ? (mv ? 4 : 3) : mv ? (W.lastRun && W.spd > SPD.walk * 1.2 ? 2 : 1) : 0;
  if (sitOn()) st = 3;   // すわっている：ほかの人には しゃがんで見える
  if (W.air && W.jumpT && t - W.jumpT < 1200) st = 5;
  { const ic = W.veh ? 100 + VC[W.veh.k] : W.pas ? 200 : W.item; if (ic !== N.it && t - N.sent > 250) { N.it = ic; N.next = 0; } }   // 持ち物を かえた：すぐ送る
  if (st !== N.st && N.st >= 0 && t - N.sent > 250) N.next = 0;   // 歩きだした・止まった：すぐ送る
  if (N.busy || t < N.next) return;
  N.busy = true; N.st = st; N.sent = t;
  rpc('av_step', stepArgs(st)).then(r => { N.err = 0; onStep(r, now()); }).catch(e => {
    const msg = String((e && e.message) || e);
    N.err = now();
    if (/walk_k/.test(msg)) {   // しるしが古い：とりなおす
      if (now() - (N.rk || 0) > 20000) { N.rk = now(); rpc('av_walk_start').then(r => { if (W && r && r.k) W.me = r; }).catch(() => {}); }
    } else if (/av_step|PGRST202|schema cache|Could not find the function|カミングスーン/i.test(msg)) N.off = true;   // サーバーの更新（119）の前・準備中（121）
  }).finally(() => {
    N.busy = false;
    // つぎ：自分が うごいている 0.5秒・近くの人が うごいている 0.6秒・近くに人がいる 1.5秒・だれもいない 3秒
    if (W) { let mv = false; for (const o of W.others.values()) if ((mvSt(o.m) || o.m === 5) && o.dist < SEE) { mv = true; break; } N.next = now() + (N.err ? 3000 : W.spd > 0.05 || (W.ride && (W.wspd || 0) > 0.5) ? 400 : mv ? 600 : W.others.size ? 1500 : 3000); }
  });
}
function netLeave(w) {   // やめた：自分の位置を消す（送れなくても 12秒で 見えなくなる）
  if (!w || !w.me || !w.me.k || w.net.off) return;
  rpc('av_step', { p_k: w.me.k, p_x: 0, p_y: 0, p_f: 0, p_h: 0, p_m: -1, p_v: 0, p_known: null }).catch(() => {});
}

/* ---------- チャット（DB の更新122）：近く（400m）の人に。ふきだし（8秒）と 左の ログ ---------- */
const SAY_T = 8000;
function chatAdd(c) {
  if (!W) return;
  W.chat.log.push(c); if (W.chat.log.length > 40) W.chat.log.shift();
  if (c.me) W.say = { t: c.t, at: c.at };
  else { const o = W.others.get(c.k); if (o) o.say = { t: c.t, at: c.at }; }
  chatDraw();
}
function chatDraw() {
  const box = W && W.hud && W.hud.querySelector('.wk-log'); if (!box) return;
  const t = now(), open = !!W.chat.open, L = W.chat.log.filter(c => open || t - c.at < 45000).slice(open ? -10 : -5);
  box.hidden = !L.length;
  box.innerHTML = L.map((c, i) => `<p class="${c.me ? 'me' : ''}" data-i="${W.chat.log.indexOf(c)}"><b translate="no">${esc2(c.n || '')}</b><span translate="no">${esc2(c.t)}</span>${!c.me && W.chat.sel === c ? `<button data-mute="${esc2(c.k)}">${esc2(tt('🔇 この人を かくす'))}</button>` : ''}</p>`).join('');
  box.querySelectorAll('p[data-i]').forEach(p => p.onclick = e => { if (e.target.closest('[data-mute]')) return; const c = W.chat.log[Number(p.dataset.i)]; W.chat.sel = W.chat.sel === c ? null : c; chatDraw(); });
  box.querySelectorAll('[data-mute]').forEach(b => b.onclick = () => {   // 歩いているあいだ、この人の チャットを かくす
    const k = b.dataset.mute; W.chat.mute.add(k); W.chat.log = W.chat.log.filter(c => c.k !== k); W.chat.sel = null;
    const o = W.others.get(k); if (o) o.say = null;
    chatDraw();
  });
}
function chatOpen(on) {
  if (!W || !W.hud) return;
  const bar = W.hud.querySelector('.wk-say'), inp = bar.querySelector('input');
  if (on && !v122()) { if (typeof toast === 'function') toast(tt('💬 チャットは サーバーの更新のあとで 使えます')); return; }
  if (on && (!W.me || !W.me.k || W.net.off)) { if (typeof toast === 'function') toast(tt('いまは チャットを使えません')); return; }
  W.chat.open = !!on; bar.hidden = !on;
  W.keys = {};
  if (on) { setTimeout(() => { try { inp.focus(); } catch (e) {} }, 0); } else { inp.blur(); }
  chatDraw();
}
async function chatSend() {
  if (!W || W.chat.busy) return;
  const inp = W.hud.querySelector('.wk-say input'), t = inp.value.replace(/\s+/g, ' ').trim();
  if (!t) { chatOpen(false); return; }
  W.chat.busy = true;
  try {
    const r = await rpc('av_say', { p_k: W.me.k, p_t: t });
    if (!W) return;
    inp.value = '';
    chatAdd({ k: W.me.k, n: (W.me && W.me.n) || '', t: String((r && r.t) || t), at: now(), me: true });
    W.net.next = 0;
    chatOpen(false);
  } catch (e) { if (typeof toast === 'function') toast(String((e && e.message) || e).replace(/^walk_k：/, '')); }
  finally { if (W) W.chat.busy = false; }
}

/* ---------- 名前・ふきだし（map3d の m3Labels が 描く） ---------- */
function tags() {
  if (!W) return null;
  const L = [], t = now(), sayOf = x => (x && t - x.at < SAY_T ? x.t : '');
  for (const o of W.others.values()) {
    if (!o.av || o.dist > TAG) continue;
    const w = WHO.get(o.k); if (!w || !w.n) continue;
    L.push({ x: o.dx, y: o.dy, h: o.df + ((o.av.P && o.av.P.h) || 1.75) * U + 0.25 * U, n: w.n, d: o.dist, s: sayOf(o.say) });
  }
  L.sort((a, b) => a.d - b.d);
  const out = L.slice(0, 12), me = sayOf(W.say);
  if (me && W.av) out.push({ x: W.x, y: W.y, h: W.f + ((W.av.P && W.av.P.h) || 1.75) * U + 0.2 * U, n: '', d: 0, s: me });   // 自分の ふきだし
  return out;
}

/* ---------- 画面（スティック・ボタン・見た目をえらぶ） ---------- */
const CSS = `
.wk-hud{position:absolute;inset:0;pointer-events:none;z-index:6}
.wk-hud>*{pointer-events:auto}
.wk-stick{position:absolute;left:18px;bottom:calc(18px + env(safe-area-inset-bottom));width:116px;height:116px;border-radius:50%;background:rgba(255,255,255,.22);border:2px solid rgba(255,255,255,.75);box-shadow:0 2px 10px rgba(0,0,0,.25);touch-action:none}
.wk-stick i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none}
.wk-btns{position:absolute;right:12px;bottom:calc(18px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,50px);gap:9px}
.wk-btns button{width:50px;height:50px;border-radius:50%;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.94);font-size:21px;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.25);touch-action:manipulation}
.wk-btns button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
.wk-btns .wk-jump{grid-column:1 / span 2;width:auto;border-radius:25px;font-size:15px;font-weight:800}
.wk-keys{display:block;font-weight:400;opacity:.8;font-size:10.5px;margin-top:2px}
.wk-log{position:absolute;left:8px;bottom:calc(186px + env(safe-area-inset-bottom));width:min(62%,340px);display:flex;flex-direction:column;gap:3px;pointer-events:auto}
.wk-log[hidden],.wk-say[hidden],.wk-wheel[hidden],.wk-spawn[hidden]{display:none}
.wk-log p{margin:0;background:rgba(20,24,30,.6);color:#fff;border-radius:9px;padding:3px 8px;font-size:12.5px;line-height:1.35;word-break:break-word;cursor:pointer}
.wk-log p.me{background:rgba(31,95,191,.72)}
.wk-log b{font-size:11px;opacity:.85;margin-right:6px}
.wk-log button{margin-left:6px;border:0;border-radius:7px;background:#fff;color:#222;font-size:11px;padding:1px 6px}
.wk-say{position:absolute;left:8px;right:8px;top:calc(var(--mp-top-h, 38px) + 52px);display:flex;gap:6px;z-index:3}
.wk-say input{flex:1;min-width:0;font-size:16px;padding:8px 10px;border-radius:10px;border:2px solid #1f5fbf;background:#fff;color:#222}
.wk-say button{border:0;border-radius:10px;padding:0 12px;font-weight:800;background:#1f5fbf;color:#fff;font-size:14px}
.wk-say button[data-wk-sx]{background:rgba(255,255,255,.94);color:#333;border:1px solid rgba(0,0,0,.15)}
.wk-wheel{position:absolute;left:50%;top:50%;width:270px;height:270px;margin:-135px 0 0 -135px;border-radius:50%;background:rgba(18,22,30,.72);box-shadow:0 4px 24px rgba(0,0,0,.35);z-index:3;touch-action:none}
.wk-wheel button{position:absolute;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);font-size:26px;padding:0;color:#fff}
.wk-wheel button.sel{background:#fff;border-color:#fff;color:#1d2330;transform:scale(1.12)}
.wk-wheel button.on{border-color:#ffd54a}
.wk-wheel div{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-weight:800;font-size:14px;text-align:center;pointer-events:none;width:110px}
.wk-wheel div small{display:block;font-weight:400;font-size:10.5px;opacity:.8;margin-top:2px}
.wk-spawn{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92%,330px);background:var(--panel,#fff);color:var(--ink,#222);border-radius:16px;box-shadow:0 6px 26px rgba(0,0,0,.35);padding:14px 14px 12px;z-index:7}
.wk-spawn b{display:block;font-size:16px;margin-bottom:10px}
.wk-spawn button{display:flex;align-items:center;gap:10px;width:100%;margin:0 0 8px;border:1px solid rgba(0,0,0,.14);border-radius:12px;background:#f3f5f8;padding:11px 12px;font-size:15px;font-weight:700;color:inherit;text-align:left}
.wk-spawn button i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#1f5fbf;color:#fff;font-size:14px}
.wk-spawn button[data-sp-x]{justify-content:center;background:transparent;font-weight:400;font-size:13.5px;margin:2px 0 0}
.mp-wrap.mp-walk .mp-zoom [data-find],.mp-wrap.mp-walk .mp-zoom [data-home],.mp-wrap.mp-walk .mp-zoom [data-opt]{display:none}
.wk-info{position:absolute;left:8px;top:calc(var(--mp-top-h, 38px) + 12px);background:rgba(20,24,30,.62);color:#fff;border-radius:10px;padding:5px 9px;font-size:12px;font-weight:700;max-width:62%;pointer-events:none}
.wk-info small{display:block;font-weight:400;opacity:.85;font-size:10.5px;margin-top:2px}
.wk-info small[hidden],.wk-cr[hidden]{display:none}
.wk-cr{display:block;pointer-events:auto;margin-top:3px;padding:0;border:0;background:transparent;color:#fff;opacity:.85;font-size:10.5px;font-weight:400;text-align:left;cursor:pointer;line-height:1.35}
.wk-pick{position:absolute;left:8px;right:8px;bottom:8px;max-height:64%;overflow:auto;background:var(--panel,#fff);color:var(--ink,#222);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.3);padding:10px 12px 12px;font-size:13px;z-index:2}
.wk-pick[hidden]{display:none}
.wk-ph{display:flex;align-items:center;gap:8px;margin-bottom:8px}.wk-ph b{flex:1;font-size:15px}
.wk-ph button{border:0;background:transparent;font-size:18px;padding:4px 8px}
.wk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.wk-sk{position:relative;border:2px solid rgba(0,0,0,.1);border-radius:12px;background:#f3f5f8;padding:4px 4px 6px;display:flex;flex-direction:column;align-items:center;gap:2px;color:inherit;font:inherit}
.wk-sk img{width:64px;height:80px;object-fit:contain}
.wk-sk small{font-size:11px;line-height:1.25;text-align:center}
.wk-sk.on{border-color:#1f5fbf;background:#e7effb}
.wk-sk.lock{opacity:.45}
.wk-sk .wk-r{position:absolute;left:4px;top:4px;font-size:10px;font-weight:800;border-radius:6px;padding:1px 5px;background:#8a96a8;color:#fff}
.wk-sk .wk-r.R{background:#3b7dd8}.wk-sk .wk-r.SR{background:#c98a10}
.wk-cols{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.wk-cols span{font-size:12px;font-weight:700}
.wk-sw{width:28px;height:28px;border-radius:50%;border:2px solid rgba(0,0,0,.15);padding:0}
.wk-sw.on{border:3px solid #1f5fbf}
.wk-cred{font-size:11px;color:#667;margin:8px 0 0;word-break:break-word}
.wk-foot{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.wk-foot span{flex:1;font-size:12px;color:#667}
.wk-foot button{border:1px solid rgba(0,0,0,.18);background:#fff;border-radius:10px;padding:7px 10px;font-weight:700;font-size:12.5px}
.mp-wrap.mp-walk .mp-wx{bottom:150px}
.wk-ask{position:absolute;inset:0;background:rgba(10,14,20,.3);z-index:8;display:flex;align-items:center;justify-content:center}
.wk-ask .wk-spawn{position:static;transform:none}
.wk-spawn button[data-sp-i] i{background:#c98a10}
.wk-spawn small{display:block;font-size:12px;color:#667;margin:-4px 0 10px;line-height:1.4}
.wk-inv{display:block;pointer-events:auto;margin-top:5px;border:0;border-radius:9px;background:rgba(255,255,255,.93);color:#1d2330;font-size:12px;font-weight:800;padding:4px 9px;cursor:pointer}
.wk-inv[hidden]{display:none}
.wk-fr{display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid rgba(0,0,0,.08)}
.wk-fr span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.wk-fr small{color:#667;font-weight:400;margin-left:6px;font-size:11px}
.wk-fr button{border:0;border-radius:10px;background:#1f5fbf;color:#fff;font-weight:800;font-size:12.5px;padding:6px 12px;flex:none}
.wk-fr button:disabled{opacity:.5}
`;
function hudMake() {
  if (!document.getElementById('wkCss')) { const s = document.createElement('style'); s.id = 'wkCss'; s.textContent = CSS; document.head.appendChild(s); }
  const S = MI.S, h = document.createElement('div');
  h.className = 'wk-hud';
  const pc = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);   // パソコン：キーの説明
  h.innerHTML = `<div class="wk-info"><span data-wk-n>🚶 歩いています</span><small data-wk-s></small><button class="wk-cr" data-wk-cr hidden></button>${pc ? '<small class="wk-keys">Q 走る・Shift しゃがむ・R すわる・V 乗り物・スペース ジャンプ・E 持ち物・Z チャット</small>' : ''}<button class="wk-inv" data-wk-inv ${v124() ? '' : 'hidden'}>👋 フレンドを よぶ</button></div>
    <div class="wk-stick" data-wk-stick title="うごく（いっぱいに たおすと 走る）"><i></i></div>
    <div class="wk-btns"><button data-wk-chat title="チャット（Z・/）">💬</button><button data-wk-x title="歩くのをやめる">✕</button>
      <button data-wk-item title="持ち物（E）">🎒</button><button data-wk-look title="見た目">👕</button>
      <button data-wk-veh title="乗り物（V）・乗せてもらう（F）">🚲</button><button data-wk-sit title="すわる（R）">🪑</button><button data-wk-crb title="しゃがむ（Shift）">🧎</button><button data-wk-run title="走る（Q）">🏃</button>
      <button class="wk-jump" data-wk-jump title="ジャンプ（スペース）">⤒ ジャンプ</button></div>
    <div class="wk-log" hidden></div>
    <div class="wk-say" hidden><input type="text" maxlength="60" enterkeyhint="send" autocomplete="off" placeholder="近くの人に（60文字まで）"><button data-wk-ss>送る</button><button data-wk-sx title="とじる">✕</button></div>
    <div class="wk-wheel" hidden></div>
    <div class="wk-pick" hidden></div>`;
  S.wrap.appendChild(h); S.wrap.classList.add('mp-walk');
  W.hud = h;
  const st = h.querySelector('[data-wk-stick]'), knob = st.querySelector('i');
  let pid = null;
  const mv = e => {
    const r = st.getBoundingClientRect(), R = r.width / 2 - 8;
    let x = (e.clientX - (r.left + r.width / 2)) / R, y = -(e.clientY - (r.top + r.height / 2)) / R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    W.stick.x = x; W.stick.y = y; W.stick.on = true; knob.style.transform = `translate(${x * R}px, ${-y * R}px)`;
  };
  const end = () => { pid = null; W.stick.on = false; W.stick.x = W.stick.y = 0; knob.style.transform = ''; };
  st.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { st.setPointerCapture(pid); } catch (er) {} mv(e); });
  st.addEventListener('pointermove', e => { if (e.pointerId === pid && W) mv(e); });
  st.addEventListener('pointerup', e => { if (e.pointerId === pid && W) end(); });
  st.addEventListener('pointercancel', e => { if (e.pointerId === pid && W) end(); });
  const tap = (sel, f) => { const b = h.querySelector(sel); b.onclick = e => { f(e); try { b.blur(); } catch (er) {} }; };   // ボタンに フォーカスを のこさない（スペースで おされないように）
  tap('[data-wk-run]', () => dashSet(!W.runOn));
  tap('[data-wk-crb]', () => crSet(!W.crOn));
  tap('[data-wk-sit]', () => sitSet(!sitOn()));
  tap('[data-wk-veh]', () => vehTap());
  tap('[data-wk-jump]', () => jump());
  tap('[data-wk-item]', () => wheelOpen(!W.wheel, false));
  tap('[data-wk-chat]', () => chatOpen(!W.chat.open));
  tap('[data-wk-look]', () => pickOpen());
  tap('[data-wk-x]', async () => { if (await ask()) stop(); });   // やめる前に たしかめる（t69）
  tap('[data-wk-inv]', () => invOpen());
  h.querySelector('[data-wk-cr]').onclick = () => { W.crOpen = !W.crOpen; W.hudT = 0; hudTick(now()); };
  // チャットの入力：Enter で送る（日本語の変換中は 送らない）・Esc で とじる
  const inp = h.querySelector('.wk-say input');
  inp.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); chatSend(); }
    else if (e.key === 'Escape') { e.preventDefault(); chatOpen(false); }
    e.stopPropagation();
  });
  h.querySelector('[data-wk-ss]').onclick = () => chatSend();
  h.querySelector('[data-wk-sx]').onclick = () => chatOpen(false);
  W.kd = e => {
    if (!W || (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]'))) return;
    const dn = e.type === 'keydown', c = e.code;
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(c)) { W.keys[c] = dn; if (/^Arrow/.test(c)) e.preventDefault(); return; }
    if (c === 'Space') { e.preventDefault(); if (dn && !e.repeat) jump(); return; }
    if (c === 'KeyE') { if (dn && !e.repeat) wheelOpen(!W.wheel, true, e.timeStamp); else if (!dn) wheelKeyUp(e.timeStamp); return; }
    if (!dn || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (c === 'KeyQ') dashSet(!W.runOn);
    else if (c === 'KeyR') sitSet(!sitOn());   // すわる（t70。モーションの キー）
    else if (c === 'KeyV') vehTap();   // 乗り物（t70）
    else if (c === 'KeyF') { if (W.pas) pasOff(); else { const o = vehNear(); if (o) pasOn(o); } }   // 乗せてもらう・おりる
    else if (c === 'KeyZ' || c === 'Slash' || e.key === '/') { e.preventDefault(); chatOpen(true); }
    else if (/^Digit[0-9]$/.test(c) && W.wheel) { const L = itemList(), n = Number(c.slice(5)); if (L[n]) itemPick(L[n].id); }
    else if (c === 'Escape') { if (W.wheel) wheelOpen(false); else if (!W.hud.querySelector('.wk-pick').hidden) W.hud.querySelector('.wk-pick').hidden = true; }
  };
  W.blur = () => { if (W) W.keys = {}; };
  window.addEventListener('keydown', W.kd); window.addEventListener('keyup', W.kd); window.addEventListener('blur', W.blur);
}
// 持ち物の輪（E。グラセフの 武器の輪のように）：E を おしたまま マウスを 向けて はなす・タップで えらぶ。数字の キーでも
function itemList() { const f = W && W.av && W.av.P ? String(W.av.P.file || '') : ''; return ITEMS.map((x, id) => ({ ...x, id })).filter(x => !x.only || f.startsWith(x.only)); }
function itemPick(id) {
  if (!W) return;
  W.item = clamp(id | 0, 0, ITEMS.length - 1); W.net.next = 0;
  wheelOpen(false);
  if (MI.hint) { MI.hint(ITEMS[W.item].ico + ' ' + tt(ITEMS[W.item].name)); clearTimeout(W.itHint); W.itHint = setTimeout(() => { if (W && MI.hint) MI.hint(''); }, 1200); }
}
function wheelOpen(on, byKey, ts) {
  if (!W || !W.hud) return;
  const wh = W.hud.querySelector('.wk-wheel');
  if (!on) { W.wheel = null; wh.hidden = true; window.removeEventListener('pointermove', wheelMove); return; }
  const L = itemList(), n = L.length, R = 98;
  W.wheel = { byKey: !!byKey, at: ts || now(), sel: L.findIndex(x => x.id === (W.item | 0)), L };   // at：E を おした時刻（キーの時刻。重い端末でも 長さを まちがえない）
  wh.innerHTML = L.map((x, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return `<button data-it="${x.id}" style="left:${135 + Math.cos(a) * R}px;top:${135 + Math.sin(a) * R}px" title="${esc2(tt(x.name))}（${i}）">${x.ico}</button>`; }).join('') + '<div></div>';
  wh.hidden = false;
  wh.querySelectorAll('[data-it]').forEach(b => {
    b.onclick = e => { e.stopPropagation(); itemPick(Number(b.dataset.it)); };
    b.onpointerenter = () => { if (!W || !W.wheel) return; W.wheel.sel = L.findIndex(x => x.id === Number(b.dataset.it)); wheelDraw(); };
  });
  wh.onclick = e => { if (e.target === wh) wheelOpen(false); };
  window.addEventListener('pointermove', wheelMove);
  wheelDraw();
}
function wheelDraw() {
  const wh = W.hud.querySelector('.wk-wheel'), Wh = W.wheel; if (!Wh) return;
  wh.querySelectorAll('[data-it]').forEach((b, i) => { b.classList.toggle('sel', i === Wh.sel); b.classList.toggle('on', Number(b.dataset.it) === (W.item | 0)); });
  const x = Wh.L[Wh.sel] || Wh.L[0];
  wh.querySelector('div').innerHTML = `${esc2(tt(x.name))}<small>${esc2(tt(Wh.byKey ? 'E を はなすと 持つ' : 'えらんで タップ'))}</small>`;
}
function wheelMove(e) {   // E を おしたまま：輪の まん中から マウスの向きで えらぶ
  if (!W || !W.wheel || !W.wheel.byKey) return;
  const wh = W.hud.querySelector('.wk-wheel'), r = wh.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  if (Math.hypot(dx, dy) < 30) return;
  const n = W.wheel.L.length; let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
  const i = Math.round(a / (2 * Math.PI / n)) % n;
  if (i !== W.wheel.sel) { W.wheel.sel = i; wheelDraw(); }
}
function wheelKeyUp(ts) {   // E を はなした：おしていたら（0.25秒より長く）えらんだものを持つ・すぐ はなしたら 輪は のこす（クリック・数字で）
  if (!W || !W.wheel || !W.wheel.byKey) return;
  if ((ts || now()) - W.wheel.at < 250) { W.wheel.byKey = false; wheelDraw(); return; }
  const x = W.wheel.L[W.wheel.sel]; if (x) itemPick(x.id); else wheelOpen(false);
}

/* ---------- 歩きはじめる場所（t68）：3つから えらぶ（数字の キーでも）・いま見ている ところ（t69）。フレンドに よばれていたら その人の近くも（DB の更新124） ---------- */
function cssOn() { if (!document.getElementById('wkCss')) { const st = document.createElement('style'); st.id = 'wkCss'; st.textContent = CSS; document.head.appendChild(st); } }
function spawnPick(inv) {   // inv：とどいている 招待 [{ i, n }]。こたえ：SPAWN の番号・{ f: 1 }（いま見ている ところ）・{ i }（招待）・null（やめる）
  return new Promise(ok => {
    const S = MI.S, d = document.createElement('div'), L = (inv || []).slice(0, 5), n0 = SPAWN.length;
    cssOn();
    d.className = 'wk-spawn';
    d.innerHTML = `<b>${esc2(tt('🚶 どこから 歩きますか？'))}</b>${SPAWN.map((x, i) => `<button data-sp="${i}"><i>${i + 1}</i><span>${esc2(tt(x.n))}</span></button>`).join('')}`
      + `<button data-sp-f><i>${n0 + 1}</i><span>${esc2(tt('📍 いま見ている ところ（地図の まん中）'))}</span></button>`
      + (L.length ? `<small>${esc2(tt('👋 フレンドに よばれています（10分まで）'))}</small>` + L.map((x, j) => `<button data-sp-i="${j}"><i>${n0 + j + 2}</i><span>${esc2(tt('👋 ' + x.n + 'さんの 近く'))}</span></button>`).join('') : '')
      + `<button data-sp-x>${esc2(tt('やめる'))}</button>`;
    S.wrap.appendChild(d);
    const done = v => { clearInterval(iv); window.removeEventListener('keydown', kd, true); d.remove(); ok(v); };
    const iv = setInterval(() => { if (!M3.on || !MI.S.v3) done(null); }, 500);   // 3D を とじた
    const pickN = k => k < n0 ? k : k === n0 ? { f: 1 } : L[k - n0 - 1] ? { i: L[k - n0 - 1].i } : null;
    const kd = e => { const k = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1; if (k >= 0 && pickN(k) != null) { e.preventDefault(); done(pickN(k)); } else if (e.code === 'Escape') done(null); };
    window.addEventListener('keydown', kd, true);
    d.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => done(Number(b.dataset.sp)));
    d.querySelector('[data-sp-f]').onclick = () => done({ f: 1 });
    d.querySelectorAll('[data-sp-i]').forEach(b => b.onclick = () => done({ i: L[Number(b.dataset.spI)].i }));
    d.querySelector('[data-sp-x]').onclick = () => done(null);
  });
}
// いま見ている ところ（t69）：3D の まん中。まわり 150m が ぜんぶ 水なら つかえない
function freePos() {
  const x = M3.tx, y = M3.ty;
  for (let r = 0; r <= 3; r += 0.5) for (let k = 0; k < (r ? 12 : 1); k++) {
    const a = k / 12 * Math.PI * 2;
    if (!wetAt(x + Math.sin(a) * r, y + Math.cos(a) * r)) return { n: 'いま見ている ところ', x, y, free: true };
  }
  if (typeof toast === 'function') toast(tt('ここは 水の上です。陸を 地図の まん中にしてから えらんでください'));
  return null;
}
// 招待（DB の更新124）→ よんだ人の いまの位置（10分まで・その人が 歩いているときだけ）
async function joinPos(i) {
  try {
    const r = await rpc('av_join', { p_i: i });
    if (r && isFinite(r.x) && isFinite(r.y)) return { n: '👋 ' + (r.n || '') + 'さんの 近く', x: +r.x, y: +r.y, f: isFinite(r.f) ? +r.f : null, fr: true };
  } catch (e) { if (typeof toast === 'function') toast(e.message); }
  return null;
}
// 歩いているときに 招待の通知を おした：その人の近くへ
async function join(i) {
  if (!W || !i) return false;
  const SP = await joinPos(i);
  if (!SP || !W) return false;
  W.x = SP.x; W.y = SP.y; W.f = SP.f != null ? SP.f : M3.surf(SP.x, SP.y); W.fv = 0; W.air = false;
  M3.tx = SP.x; M3.ty = SP.y; M3.glide = null; M3.dirty = true; MI.S.dirty = true;
  W.spawn = { x: SP.x, y: SP.y, n: SP.n, f: SP.f, fr: true, until: now() + 20000 };
  W.ixKey = null;   // 足もとの表を 作りなおして、近くの 歩けるところに 立つ
  MI.hint('📍 ' + tt(SP.n) + ' …');
  return true;
}
// フレンドを よぶ（DB の更新124）：よんだ人に 通知が とどく。10分のあいだ、その人は 自分の近くから 歩きはじめられる
async function invOpen() {
  if (!W || !W.hud) return;
  const p = W.hud.querySelector('.wk-pick');
  if (!p.hidden && p.dataset.k === 'inv') { p.hidden = true; return; }
  const head = `<div class="wk-ph"><b>👋 フレンドを よぶ</b><button data-wk-pc title="とじる">✕</button></div>`;
  const shut = () => { const x = p.querySelector('[data-wk-pc]'); if (x) x.onclick = () => { p.hidden = true; }; };
  p.dataset.k = 'inv'; p.hidden = false;
  p.innerHTML = head + '<p class="wk-cred">読みこんでいます…</p>'; shut();
  let L;
  try { const r = await rpc('friend_list'); L = (r && r.friends) || []; }
  catch (e) { if (W && !p.hidden && p.dataset.k === 'inv') { p.innerHTML = head + `<p class="wk-cred">${esc2(e.message)}</p>`; shut(); } return; }
  if (!W || p.hidden || p.dataset.k !== 'inv') return;
  p.innerHTML = head + '<p class="wk-cred" style="margin:0 0 6px">よんだ人に 通知が とどきます。10分のあいだ、あなたの近くから 歩きはじめられます（あなたが 歩いているときだけ）。</p>'
    + (L.length ? L.map(f => `<div class="wk-fr"><span>${esc2(f.nickname)}<small>ID ${esc2(f.uid)}</small></span><button data-fr="${esc2(f.uid)}">よぶ</button></div>`).join('')
                : '<p class="wk-cred">フレンドが まだ いません（メインの「フレンド」から 申請できます）</p>');
  shut();
  p.querySelectorAll('[data-fr]').forEach(b => b.onclick = async () => {
    if (!W) return;
    if (!W.me || !W.me.k) { if (typeof toast === 'function') toast(tt('いまは よべません（ほかの人と つながっていません）')); return; }
    b.disabled = true;
    try { const r = await rpc('av_invite', { p_k: W.me.k, p_to: b.dataset.fr }); b.textContent = tt('よんだ'); if (typeof toast === 'function') toast(tt('👋 ' + ((r && r.n) || '') + 'さんを よびました')); }
    catch (e) { b.disabled = false; if (typeof toast === 'function') toast(e.message); }
  });
}
// やめる前に たしかめる（t69）：1・Enter やめる／2・Esc つづける
let askP = null, askEnd = null;
function ask() {
  if (!W || !MI) return Promise.resolve(true);
  if (askP) return askP;
  askP = new Promise(ok => {
    cssOn();
    const bg = document.createElement('div');
    bg.className = 'wk-ask';
    bg.innerHTML = `<div class="wk-spawn"><b>${esc2(tt('🚶 歩くのを やめますか？'))}</b><button data-ak="1"><i>1</i><span>${esc2(tt('やめる'))}</span></button><button data-ak="0"><i>2</i><span>${esc2(tt('つづける'))}</span></button></div>`;
    MI.S.wrap.appendChild(bg);
    if (W) { W.keys = {}; W.stick.on = false; W.stick.x = W.stick.y = 0; }   // たしかめているあいだは とまる
    const done = v => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); bg.remove(); askP = askEnd = null; ok(v); };
    const kd = e => {
      e.stopPropagation();
      if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.code === 'Digit2' || e.code === 'Numpad2' || e.code === 'Escape') { e.preventDefault(); done(false); }
    };
    const ku = e => e.stopPropagation();
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
    bg.onclick = e => { if (e.target === bg) done(false); };
    bg.querySelectorAll('[data-ak]').forEach(b => b.onclick = () => done(b.dataset.ak === '1'));
    askEnd = done;
  });
  return askP;
}
// 建物の前に 立つ：建物の まん中から 外へ さがして、いちばん近い 道路・ホームなどの面（たてものの外）。建物のほうを向く
function onWalk(x, y) {
  const ix = W.ix; if (!ix) return false;
  const a = ix.cells.get(Math.floor(x / IG) * 100003 + Math.floor(y / IG)); if (!a) return false;
  const P = ix.tri;
  for (const n of a) {
    const ax = P[n], az = P[n + 2], bx = P[n + 3], bz = P[n + 5], cx = P[n + 6], cz = P[n + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-14) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (y - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (y - cz)) / d;
    if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6) return true;
  }
  return false;
}
function spawnPlace() {
  const sp = W.spawn; if (!sp || !W.ix) return;
  // 建物の前：10m〜160m・48の向き（道路などの上）。フレンドの近く（DB の更新124）：2m から（地面の上でも よい。その人と 同じ高さ）
  //   いま見ている ところ（t69）：その場所から（地面の上でも よい。たてものの中・水の上なら 近くの 歩けるところ）
  const nb = sp.fr || sp.free, r0 = sp.free ? 0 : sp.fr ? 0.04 : 0.2;
  for (let r = r0; r <= 3.2; r += nb && r < 0.4 ? 0.03 : 0.1) for (let k = 0; k < (r ? 48 : 1); k++) {
    const a = k * Math.PI * 2 / 48, x = sp.x + Math.sin(a) * r, y = sp.y + Math.cos(a) * r;
    if (blocked(x, y) || (!nb && !onWalk(x, y))) continue;
    const g = groundAt(x, y, sp.fr && sp.f != null ? Math.max(sp.f + 0.5 * U, M3.surf(x, y) + 0.3 * U) : M3.surf(x, y) + 2 * U, false); if (g == null) continue;
    W.x = x; W.y = y; W.f = g; W.fv = 0;
    if (!sp.free) { W.h = Math.atan2(sp.x - x, sp.y - y); M3.yaw = W.h + Math.PI; }   // 建物・フレンドのほうを向く（カメラは うしろ）。いま見ている ところは 見ていた向き
    M3.tx = x; M3.ty = y;
    if (!sp.ok) { sp.ok = true; MI.hint('📍 ' + tt(sp.n)); clearTimeout(W.spHint); W.spHint = setTimeout(() => { if (W && MI.hint) MI.hint(''); }, 2500); }
    return;
  }
}

function hudTick(t) {
  if (!W.hud || t - (W.hudT || 0) < 500) return;
  W.hudT = t;
  const N = W.net, n = W.near || 0;
  const a = W.hud.querySelector('[data-wk-n]'), s = W.hud.querySelector('[data-wk-s]');
  a.textContent = W.ride ? (W.ride.sit ? '🪑 列車で すわっています' : '🚃 列車に 乗っています') : W.veh ? (W.veh.k === 'bike' ? '🚲 自転車に 乗っています' : '🛻 軽トラを 運転しています')
    : W.pas ? (W.pas.k === 'bike' ? '🚲 自転車の うしろに 乗っています' : '🛻 軽トラの 荷台に 乗っています') : n ? `🚶 近くに ${n}人` : '🚶 歩いています';
  if (!W.veh && !W.pas && !W.ride && vehNear()) a.textContent = '🚲 F で 乗せてもらえます';
  if (!W.ride) {   // ひらいた ドアの そば（6m）：乗れる ことを 知らせる
    let near = false; for (const h of M3.runHit || []) { if (h.mv || h.rid == null || !(h.oL > 0.7 || h.oR > 0.7)) continue; if (Math.hypot(h.x - W.x, h.z - W.y) < h.hl + 6 * U && Math.abs(W.f - (h.y0 + FLOOR * U)) < 0.8 * U) { near = true; break; } }
    if (near) a.textContent = '🚃 ドアから 列車に 乗れます';
  }
  const cred = new Map();   // MMD のモデルの作者の表示（ライセンス）：ふだんは 短く・タップで 全文
  const addC = c => { const sk = skinOf(c); if (sk.kind === 'mmd' && sk.credit) cred.set(sk.code, sk); };
  if (W.av && W.av.P && W.av.P.mmd) addC(W.av.code);
  for (const o of W.others.values()) if (o.av && o.av.P && o.av.P.mmd) addC(o.av.code);
  const off = !W.me || !W.me.k || N.off ? 'ほかの人は いま表示できません' : N.err && t - N.err < 10000 ? 'つながりを まっています…' : '';
  s.textContent = off; s.hidden = !off;
  const cb = W.hud.querySelector('[data-wk-cr]'), cs = [...cred.values()];
  cb.hidden = !cs.length;
  cb.textContent = W.crOpen ? cs.map(k => k.name + '：' + k.credit).join(' ／ ') : 'ⓘ ' + cs.map(k => k.name).join('・') + '（' + (/CC BY [0-9.]+/.exec(cs.map(k => k.credit).join(' ')) || ['クレジット'])[0] + '）';
}
function pickOpen() {
  const p = W.hud.querySelector('.wk-pick');
  if (!p.hidden && p.dataset.k === 'look') { p.hidden = true; return; }
  p.dataset.k = 'look'; p.hidden = false; pickDraw();
  if (!CAT || CAT.off || now() - (CAT.t || 0) > 20000) catLoad(true).then(() => { if (CAT) CAT.t = now(); if (W && !p.hidden && p.dataset.k === 'look') pickDraw(); });
}
function pickDraw() {
  const p = W.hud.querySelector('.wk-pick'), me = CAT.me || { c: 'base', l: {} }, cur = skinOf(me.c), l = me.l || {};
  if (p.dataset.k !== 'look') return;
  const own = s => s.code === 'base' || s.n > 0, have = CAT.list.filter(own).length;
  p.innerHTML = `<div class="wk-ph"><b>👕 見た目</b><button data-wk-pc title="とじる">✕</button></div>
    ${CAT.off ? '<p class="small" style="margin:0 0 8px;color:#667">見た目をえらぶのは、サーバーの更新のあとで使えます（いまは 髪とはだの色だけ この端末に）</p>' : ''}
    <div class="wk-grid">${CAT.list.map(s => `<button class="wk-sk ${s.code === cur.code ? 'on' : ''} ${own(s) ? '' : 'lock'}" data-code="${esc2(s.code)}">
      <img src="map/skins/thumbs/${esc2(s.code)}.webp?v=${esc2(mapv())}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      ${s.rare && s.rare !== '-' ? `<span class="wk-r ${esc2(s.rare)}">${esc2(s.rare)}</span>` : ''}<small>${esc2(s.name)}${own(s) ? '' : '<br>🔒'}</small></button>`).join('')}</div>
    ${cur.kind === 'base' ? `<div class="wk-cols"><span>髪</span>${HAIR.map((c, i) => `<button class="wk-sw ${(l.h | 0) === i ? 'on' : ''}" data-h="${i}" style="background:${c}" title="髪の色"></button>`).join('')}
      <span>はだ</span>${SKIN.map((c, i) => `<button class="wk-sw ${(l.s | 0) === i ? 'on' : ''}" data-s="${i}" style="background:${c}" title="はだの色"></button>`).join('')}</div>` : ''}
    ${cur.credit ? `<p class="wk-cred">${esc2(cur.name)}：${esc2(cur.credit)}</p>` : ''}
    <div class="wk-foot"><span>${CAT.off ? '' : `持っている見た目 ${have} / ${CAT.list.length}`}</span>${CAT.off ? '' : CAT.soon && CAT.soon.skin && !CAT.admin ? '<button data-wk-ga>🎫 スキンガチャ（カミングスーン）</button>' : `<button data-wk-ga>🎫 スキンガチャ（🎫${esc2(CAT.cost || 20)}）</button>`}</div>`;
  p.querySelector('[data-wk-pc]').onclick = () => { p.hidden = true; };
  p.querySelectorAll('[data-code]').forEach(b => b.onclick = () => {
    const s = skinOf(b.dataset.code);
    if (!own(s)) { if (typeof toast === 'function') toast(tt('この見た目は スキンガチャで当たります')); return; }
    setLook(s.code, null);
  });
  p.querySelectorAll('[data-h]').forEach(b => b.onclick = () => setLook(me.c, { h: Number(b.dataset.h), s: l.s | 0 }));
  p.querySelectorAll('[data-s]').forEach(b => b.onclick = () => setLook(me.c, { h: l.h | 0, s: Number(b.dataset.s) }));
  const ga = p.querySelector('[data-wk-ga]');
  if (ga) ga.onclick = () => { stop(); if (typeof go === 'function') go('vGacha'); };
}
async function setLook(code, lk) {
  if (!W || W.lbusy) return;
  lookSeq++;
  if (CAT.off) { const l = Object.assign({}, CAT.me.l || {}, lk || {}); CAT.me = { c: 'base', l }; try { localStorage.setItem('kz_walk_look', JSON.stringify(l)); } catch (e) {} }
  else {
    W.lbusy = true;
    try { const r = await rpc('av_set', { p_code: code, p_look: lk || null }); CAT.me = { c: r.c, l: r.l || {} }; }
    catch (e) { W && (W.lbusy = false); if (typeof toast === 'function') toast(e.message); return; }
    if (!W) return;
    W.lbusy = false;
  }
  W.lv = (W.lv + 1) % 1000;
  avSelf(); pickDraw();
  W.net.next = 0;   // すぐ送る（ほかの人が 見た目を とりなおす）
}
function avSelf() {
  const me = (CAT && CAT.me) || { c: 'base', l: {} };
  if (W.av) M3.sc.remove(W.av.root);
  W.av = mkAvatar(me.c, me.l, true);
  M3.sc.add(W.av.root);
  W.av.root.position.set(W.x, W.f, W.y); W.av.root.rotation.y = W.h;
  if (W.av.wait) { if (MI.hint) { MI.hint('見た目を読みこんでいます…'); setTimeout(() => { if (W && MI.hint) MI.hint(''); }, 2500); } }
}

/* ---------- はじめる・やめる ---------- */
async function start(o) {   // o：{ inv（フレンドの 招待の番号。DB の更新124） }
  M3 = window.m3State; MI = window.MapInt;
  if (!M3 || !M3.on || !MI) return false;
  if (W) return true;
  T3 = M3.T;
  MI.hint('歩く準備をしています…');
  await catLoad();
  if (!M3.on) { MI.hint(''); return false; }
  if (CAT && CAT.soon && CAT.soon.walk && !CAT.admin) { MI.hint(''); if (typeof toast === 'function') toast(tt('🚶 街を歩くのは もうすぐ できるようになります（カミングスーン）')); return false; }   // 準備中（DB の更新121）
  MI.hint('');
  // 歩きはじめる場所（t68）：瑠璃府庁前・美東区役所前・蛍石県庁前・いま見ている ところ（t69）から えらぶ。フレンドに よばれていたら（DB の更新124）その人の近く
  if (spawnBusy) return false;
  spawnBusy = true;
  let SP = null;
  try {
    if (o && o.inv && v124()) SP = await joinPos(o.inv);   // 招待の通知から：そのまま その人の近くへ
    if (!SP) {
      let inv = [];
      if (v124()) { try { const r = await rpc('av_invites'); if (Array.isArray(r)) inv = r; } catch (e) { inv = []; } }
      if (!M3.on || W) return !!W;
      const si = await spawnPick(inv);
      if (si == null || !M3.on || W) return !!W;
      if (si && si.f) { SP = freePos(); if (!SP) return false; }   // いま見ている ところ（t69）
      else if (typeof si === 'object') { SP = await joinPos(si.i); if (!SP) return false; }
      else SP = SPAWN[si];
    }
  } finally { spawnBusy = false; }
  if (!SP || !M3.on || W) return !!W;
  M3.tx = SP.x; M3.ty = SP.y; M3.glide = null; M3.dirty = true; MI.S.dirty = true;
  W = { x: SP.x, y: SP.y, f: 0, fv: 0, h: M3.yaw + Math.PI, pitch: 0.32, cd: 4.5, d0: M3.d, t: now(), keys: {}, stick: { x: 0, y: 0, on: false }, runOn: false, crOn: false, cr: false, air: false, item: 0,
        others: new Map(), net: { busy: false, next: 0, sent: 0, st: -1, err: 0, off: false }, me: null, lv: 0, ix: null, blk: null, ixAt: [Infinity, Infinity], ixKey: null, near: 0,
        chat: { since: 0, log: [], mute: new Set(), open: false, busy: false, sel: null }, spawn: { x: SP.x, y: SP.y, n: SP.n, f: SP.f, fr: !!SP.fr, free: !!SP.free, until: now() + 20000 } };
  MI.hint('📍 ' + tt(SP.n) + ' …');
  W.f = SP.fr && SP.f != null ? SP.f : M3.surf(W.x, W.y);
  M3.d = 1.2; M3.glide = null; M3.dirty = true; MI.S.dirty = true;
  avSelf();
  hudMake();
  M3.walk = { step, post, cam, look, zoom, tags, stop };
  // しるし（DB の更新118 のあと）：ほかの人と見せあう
  try { const r = await rpc('av_walk_start'); if (W && r && typeof r.k === 'string') { W.me = r; if (r.c && CAT && !CAT.off) { const ch = r.c !== CAT.me.c || JSON.stringify(r.l || {}) !== JSON.stringify(CAT.me.l || {}); CAT.me = { c: r.c, l: r.l || {} }; if (ch) avSelf(); } } } catch (e) { if (W) W.me = null; }
  if (!W) return false;
  if (W.me) {
    W.pagehide = () => { if (W) netLeave(W); };
    window.addEventListener('pagehide', W.pagehide);
    W.refresh = setInterval(async () => { if (!W) return; try { const r = await rpc('av_walk_start'); if (W && r && r.k) { netLeave(W); W.me = r; } } catch (e) {} }, 3 * 3600 * 1000);   // しるしは 1日まで（3時間ごとに 新しく）
  }
  if (onChange) onChange(true);
  return true;
}
function stop(fromClose) {
  if (!W) return;
  if (askEnd) askEnd(false);   // たしかめる画面が出ていたら とじる
  const w = W;
  netLeave(w);
  clearInterval(w.refresh);
  if (w.pagehide) window.removeEventListener('pagehide', w.pagehide);
  window.removeEventListener('pointermove', wheelMove); clearTimeout(w.spHint); clearTimeout(w.itHint);
  if (w.spawn || w.itHint) MI.hint('');
  window.removeEventListener('keydown', w.kd); window.removeEventListener('keyup', w.kd); window.removeEventListener('blur', w.blur);
  if (w.av) M3.sc.remove(w.av.root);
  for (const o of w.others.values()) if (o.av) M3.sc.remove(o.av.root);
  if (w.hud) w.hud.remove();
  MI.S.wrap.classList.remove('mp-walk');
  if (M3.sea) { M3.sea.scale.set(1, 1, 1); M3.sea.position.x = 0; M3.sea.position.z = 0; }
  M3.walk = null; W = null;
  if (!fromClose && M3.on) { M3.tx = w.x; M3.ty = w.y; M3.d = clamp(w.d0 || 6, 3, 12); M3.dirty = true; MI.S.dirty = true; }
  if (onChange) onChange(false);
}

window.Walk = { start, stop, ask, join, on: () => !!W, ride: () => (W && W.ride ? { ...W.ride } : null), tp: (x, y) => { if (!W || W.ride) return false; W.x = x; W.y = y; const g = groundAt(x, y, M3.surf(x, y) + 3 * U, false); W.f = g != null ? g : M3.surf(x, y); W.fv = 0; W.spawn = null; return W.f; }, hit: (x, y, f) => { const h = trainAt(x, y, f); return h ? { nx: h.nx, ny: h.ny, d: h.d } : null; }, dbg: () => (W ? { x: W.x, y: W.y, f: W.f, ix: W.ix ? { n: W.ix.tri.length / 9, ms: W.ix.ms } : null, blk: W.blk ? W.blk.size : 0, others: W.others.size, ol: [...W.others.values()].map(o => [o.m, o.it || 0, !!o.say]), me: !!(W.me && W.me.k), item: W.item, cr: !!W.cr, air: !!W.air } : null), cat: catLoad, onChange: f => { onChange = f; }, mmd: mmdLoad, mkBase: (look, hl) => { T3 = T3 || window.THREE; return mkBase(look, hl); }, poseBase,
  mkMMD: e => { T3 = T3 || window.THREE; return mkMMD(e); }, poseMMD, poseAv, ITEMS, HAIR, SKIN };
})();
