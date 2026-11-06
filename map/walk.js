/* ===== 風の芽経済組：3D の街を歩く（DB の更新118・119）=====
   3D の地図に 自分の人を出して 歩く。左下のスティック（パソコンは WASD・矢印。Shift で走る）。スティックを いっぱいに たおすと 走る
   カメラは うしろから：1本指（マウス）で まわす・2本指（ホイール）で 近く／遠く
   ほかの人も見える（DB の更新119）：サーバーと この端末のあいだだけで やりとり（av_step）。送るのは しるし（av_walk_start。歩きはじめるたびに 新しい）と
     位置・向き・うごきだけ。近く（400m）の人の 位置・向き・うごきを受けとって、この端末で その人を組み立てる。名前と見た目はサーバーから（ほかの人の名前を かたれない）
   見た目（スキン）：組み立ての人（服の形と色・髪とはだの色）・MMD のモデル（map/skins。map/vendor の MMDLoader で読む。まばたき以外のモーフ・物理演算は使わない）
   たてもの（区画）には入れない。海・川・湖には入れない（橋の上は歩ける）。道路・線路・橋・ホームの面は、のぼれる段（1.6m）まで のれる
   map3d.js（window.m3State・MapInt）を使う。歩いているあいだは M3.walk に この中身（step・cam・look・zoom・tags・stop） */
(function () {
'use strict';
const U = 1 / 50;                       // 1m（マス）
const SPD = { walk: 2.2, run: 6.5 };    // 歩く・走る（m/秒）
const STEP = 1.6;                       // のぼれる段（m）。道路の帯（地面から 1m）にも のれる
const HEAD = 1.45;                      // カメラが見る高さ（足もとから m）
const LOST = 12000;                     // これだけ 位置が来なければ いなくなった
const SEE = 8;                          // ほかの人を描く遠さ（マス。400m）
const TAG = 1.4;                        // 名前を出す遠さ（マス。70m）
const MMD_CAP = 6, OTHER_CAP = 24;      // MMD のモデルで描く人数（ほかは 組み立ての人）・描く人数
const HAIR = ['#1e1b1a', '#3b2a20', '#6b4a2f', '#a07a52', '#9a9a9a', '#1f2433'];
const SKIN = ['#f2d3b8', '#e0b48f', '#c48c62', '#8d5a3b'];
const BASE_SKIN = { code: 'base', name: 'ふだん着', kind: 'base', rare: '-', look: { t: 'tee', c1: '#e8e4da', c2: '#4a5568', c3: '#3b3b3b' }, n: 0 };
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
  return { root, body, chest, head, legs, arms, h: 1.78 };
}
function poseBase(P, ph, amt, run, tIdle) {
  const sA = run ? 0.8 : 0.46, kA = run ? 1.35 : 0.62, aA = run ? 0.95 : 0.36, s = Math.sin(ph), c = Math.cos(ph);
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? 1 : -1, L = P.legs[i], th = -sA * amt * s * sg, kn = (kA * Math.max(0, c * sg) + (run ? 0.28 : 0.05)) * amt;
    L.leg.rotation.x = th; L.knee.rotation.x = kn; L.foot.rotation.x = -(th + kn) * 0.6;
    const A = P.arms[i];
    A.arm.rotation.x = aA * amt * s * sg + (1 - amt) * 0.035 * Math.sin(tIdle * 1.3 + i);
    A.arm.rotation.z = 0.07 * A.sd;
    A.elbow.rotation.x = -((run ? 1.25 : 0.22) * amt + 0.1);
  }
  P.body.position.y = 0.93 + ((run ? 0.055 : 0.024) * Math.abs(c) - (run ? 0.035 : 0)) * amt + (1 - amt) * 0.004 * Math.sin(tIdle * 1.7);
  P.chest.rotation.x = (run ? 0.2 : 0.05) * amt;
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
  e = { p: null, mesh: null };
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
             armL2: '左腕袖', armR2: '右腕袖', elbL2: '左ひじ袖', elbR2: '右ひじ袖' };
function mkMMD(e) {
  const T = T3, mesh = T.SkeletonUtils.clone(e.mesh);
  mesh.scale.setScalar(e.k); mesh.frustumCulled = false;
  const root = new T.Group(); root.add(mesh);
  const byName = new Map(mesh.skeleton.bones.map(b => [b.name, b])), B = {};
  for (const k in BN) { const b = byName.get(BN[k]); if (b) B[k] = { b, q: b.quaternion.clone(), p: b.position.clone() }; }
  const mi = mesh.morphTargetDictionary && mesh.morphTargetDictionary['まばたき'];
  return { root, mesh, B, blink: mi == null ? -1 : mi, k: e.k, h: e.hgt * e.k, mmd: true, nb: now() + 2000 + Math.random() * 3000 };
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
function poseMMD(P, ph, amt, run, tIdle) {
  const B = P.B, sA = run ? 0.8 : 0.46, kA = run ? 1.35 : 0.62, aA = run ? 0.9 : 0.34, s = Math.sin(ph), c = Math.cos(ph);
  const T = T3; if (!P.qz) { P.qz = [new T.Quaternion(), new T.Quaternion()]; P.qz[0].setFromAxisAngle(new T.Vector3(0, 0, 1), -0.68); P.qz[1].setFromAxisAngle(new T.Vector3(0, 0, 1), 0.68); }   // 両うで（A ポーズ）を下げる
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? 1 : -1, Lr = i === 0 ? 'L' : 'R', th = -sA * amt * s * sg, kn = (kA * Math.max(0, c * sg) + (run ? 0.28 : 0.05)) * amt;
    qset(B, 'leg' + Lr, 'x', th); qset(B, 'knee' + Lr, 'x', kn); qset(B, 'ank' + Lr, 'x', -(th + kn) * 0.6);
    const sw = aA * amt * s * sg + (1 - amt) * 0.035 * Math.sin(tIdle * 1.3 + i), el = -((run ? 1.2 : 0.2) * amt + 0.08);
    qset(B, 'arm' + Lr, 'x', sw, P.qz[i]); qset(B, 'arm' + Lr + '2', 'x', sw, P.qz[i]);
    qset(B, 'elb' + Lr, 'x', el); qset(B, 'elb' + Lr + '2', 'x', el);
  }
  qset(B, 'up', 'x', (run ? 0.16 : 0.04) * amt);
  if (B.ctr) B.ctr.b.position.y = B.ctr.p.y + (((run ? 0.055 : 0.024) * Math.abs(c) - (run ? 0.035 : 0)) * amt) / P.k;
  // まばたき
  if (P.blink >= 0) { const t = now(); let v = 0; if (t > P.nb) { const d = t - P.nb; v = d < 70 ? d / 70 : d < 140 ? 1 - (d - 70) / 70 : 0; if (d >= 140) P.nb = t + 2200 + Math.random() * 3500; } P.mesh.morphTargetInfluences[P.blink] = v; }
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
function poseAv(A, dt, spd, run) {
  const P = A.P, tgt = clamp(spd / SPD.walk, 0, 1);
  A.amt += (tgt - A.amt) * Math.min(1, dt * 8);
  A.run = run && spd > SPD.walk * 1.2;
  const stride = A.run ? 1.35 : 0.75;
  A.ph += dt * Math.PI * Math.max(spd, 0.3 * A.amt) / stride;
  if (A.ph > 1e4) A.ph -= Math.PI * 2 * 1000;
  const ti = now() / 1000;
  if (P.mmd) poseMMD(P, A.ph, A.amt, A.run, ti); else poseBase(P, A.ph, A.amt, A.run, ti);
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
  const t = M3.surf(x, y), lim = f + STEP * U;
  let g = t, on = false;
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
        if (h <= lim && h > g - 0.5 * U) { if (h > g || !on) { g = Math.max(g, h); on = true; } }
      }
    }
  }
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
  let run = !!(K.ShiftLeft || K.ShiftRight) || W.runOn;
  if (W.stick.on) { ix += W.stick.x; iy += W.stick.y; if (Math.hypot(W.stick.x, W.stick.y) > 0.93) run = true; }
  const m = Math.hypot(ix, iy); if (m > 1) { ix /= m; iy /= m; }
  return { ix, iy, m: Math.min(1, m), run };
}
function step() {
  if (!W || !M3.on) return;
  const t = now(), dt = Math.min(0.25, Math.max(0, (t - W.t) / 1000)); W.t = t;
  if (W.ixKey !== M3.bKey || Math.hypot(W.x - W.ixAt[0], W.y - W.ixAt[1]) > 3) {
    try { idxBuild(); unstuck(); } catch (e) { console.error(e); }
  }
  { const t0 = M3.surf(W.x, W.y); if (W.f < t0) { W.f = t0; W.fv = 0; } }   // 地形の網が こまかくなって 地面の下に なったら 上へ
  const I = input(), yaw = M3.yaw;
  let spd = 0;
  if (I.m > 0.05) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * I.iy + rx * I.ix, dz = fz * I.iy + rz * I.ix; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // 向き：すぐに（1秒に 10 ラジアン）
    let da = Math.atan2(dx, dz) - W.h; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    W.h += clamp(da, -10 * dt, 10 * dt);
    const v = I.m * (I.run ? SPD.run : SPD.walk), d = v * dt * U, wet0 = wetAt(W.x, W.y);
    const tryTo = (nx, ny) => { if (blocked(nx, ny)) return null; const g = groundAt(nx, ny, W.f, wet0); return g == null ? null : [nx, ny, g]; };
    let r = tryTo(W.x + dx * d, W.y + dz * d);
    if (!r && Math.abs(dx) > 0.15) r = tryTo(W.x + Math.sign(dx) * d * Math.abs(dx), W.y);   // かべに そって
    if (!r && Math.abs(dz) > 0.15) r = tryTo(W.x, W.y + Math.sign(dz) * d * Math.abs(dz));
    if (r) { spd = Math.hypot(r[0] - W.x, r[1] - W.y) / U / Math.max(dt, 1e-3); W.x = r[0]; W.y = r[1]; W.gt = r[2]; }
    W.lastRun = I.run;
  }
  // 高さ：のぼるのは すぐ・おりるのは 落ちる（重力）
  const g = W.gt != null && spd > 0 ? W.gt : groundAt(W.x, W.y, W.f, true);
  W.gt = null;
  if (g != null) {
    if (g >= W.f) { W.f = g; W.fv = 0; }
    else { W.fv = (W.fv || 0) + 9.8 * dt; W.f = Math.max(g, W.f - W.fv * dt * U); if (W.f === g) W.fv = 0; }
  }
  W.spd = spd;
  const A = W.av;
  A.root.position.set(W.x, W.f, W.y); A.root.rotation.y = W.h;
  poseAv(A, dt, spd, !!W.lastRun);
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
    if (top > py - 0.3 * U || M3.surf(px, pz) > py - 0.25 * U) { d = Math.max(0.6 * U, d * (k - 1) / 12); break; }
  }
  return d;
}
function cam() {
  const C = M3.cam, yaw = M3.yaw, ty = W.f + HEAD * U, t = now(), dt = Math.min(0.25, Math.max(0, (t - (W.ct || t)) / 1000)); W.ct = t;
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
  C.position.set(cx, cy, cz); C.lookAt(W.x + fx, ty + cl * 0.2 * U, W.y + fz);
  if (W.av) W.av.root.visible = d > 0.75 * U;
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
const WHO = new Map();   // しるし → { n, c, l, v }
const r4 = v => Math.round(v * 1e4) / 1e4;
function stepArgs(m) {
  const known = [];
  for (const o of W.others.values()) { const w = WHO.get(o.k); if (w && w.v === o.v && known.length < 60) known.push(o.k); }
  return { p_k: W.me.k, p_x: r4(W.x), p_y: r4(W.y), p_f: r4(W.f), p_h: Math.round(W.h * 100) / 100, p_m: m, p_v: W.lv, p_known: known };
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
    o.m = m.m === 2 ? 2 : m.m === 1 ? 1 : 0;
    if (!o.m) { o.vx = 0; o.vy = 0; o.vm = false; }
    else if (!o.vm) { const v = (o.m === 2 ? SPD.run : SPD.walk) * U; o.vx = Math.sin(h) * v; o.vy = Math.cos(h) * v; }   // はじめは 向きと うごきから
    o.v = Number(m.v) | 0; o.t = t; o.miss = 0;
    if (m.c != null) {   // 名前と見た目（知らない人・見た目を変えた人のぶんだけ）
      WHO.set(m.k, { n: String(m.n || '').slice(0, 40), c: String(m.c || 'base'), l: m.l && typeof m.l === 'object' ? m.l : {}, v: o.v });
      if (CAT && !CAT.off && !CAT.skins.has(String(m.c)) && now() - (W.catT || 0) > 30000) { W.catT = now(); catLoad(true); }   // 新しい見た目（表を とりなおす）
    }
  }
  for (const o of W.others.values()) if (!seen.has(o.k)) o.miss = (o.miss || 0) + 1;
}
function others(dt) {
  const t = now(), list = [];
  for (const o of W.others.values()) {
    if (o.miss >= (o.dist < 6 ? 1 : 2) || t - o.t > LOST) { if (o.av) M3.sc.remove(o.av.root); W.others.delete(o.k); continue; }   // 来なかったら いなくなった（400m のふちは 2回）
    // 受けとった位置 ＋ 速さ × すぎた時間（1.2秒まで）に なめらかに（0.2秒ほどで おいつく。遠いと とぶ）
    const ex = o.m ? Math.min(1, (t - o.ts) / 1000) : 0, tx = o.x + o.vx * ex, ty = o.y + o.vy * ex;
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
    if (!show) { if (o.av) { M3.sc.remove(o.av.root); o.av = null; } continue; }
    n++;
    const hk = JSON.stringify(w.l || {}), e = MMD.get(skinOf(w.c).file);
    if (!o.av || o.av.code !== w.c || o.av.hk !== hk || (o.av.wait && e && (e.mesh || e.fail))) {
      if (o.av) M3.sc.remove(o.av.root);
      o.av = mkAvatar(w.c, w.l, false); M3.sc.add(o.av.root);
    }
    o.av.root.position.set(o.dx, o.df, o.dy); o.av.root.rotation.y = o.dh;
    poseAv(o.av, dt, o.m ? Math.max(o.spd, 0.3) : o.spd * 0.5, o.m === 2);
  }
  W.near = n;
}
function net(t) {
  const N = W.net; if (!W.me || !W.me.k || N.off) return;
  const st = W.spd > 0.05 ? (W.lastRun && W.spd > SPD.walk * 1.2 ? 2 : 1) : 0;
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
    if (W) { let mv = false; for (const o of W.others.values()) if (o.m && o.dist < SEE) { mv = true; break; } N.next = now() + (N.err ? 3000 : W.spd > 0.05 ? 500 : mv ? 600 : W.others.size ? 1500 : 3000); }
  });
}
function netLeave(w) {   // やめた：自分の位置を消す（送れなくても 12秒で 見えなくなる）
  if (!w || !w.me || !w.me.k || w.net.off) return;
  rpc('av_step', { p_k: w.me.k, p_x: 0, p_y: 0, p_f: 0, p_h: 0, p_m: -1, p_v: 0, p_known: null }).catch(() => {});
}

/* ---------- 名前（map3d の m3Labels が 描く） ---------- */
function tags() {
  if (!W) return null;
  const L = [];
  for (const o of W.others.values()) {
    if (!o.av || o.dist > TAG) continue;
    const w = WHO.get(o.k); if (!w || !w.n) continue;
    L.push({ x: o.dx, y: o.dy, h: o.df + ((o.av.P && o.av.P.h) || 1.75) * U + 0.25 * U, n: w.n, d: o.dist });
  }
  return L.sort((a, b) => a.d - b.d).slice(0, 12);
}

/* ---------- 画面（スティック・ボタン・見た目をえらぶ） ---------- */
const CSS = `
.wk-hud{position:absolute;inset:0;pointer-events:none;z-index:6}
.wk-hud>*{pointer-events:auto}
.wk-stick{position:absolute;left:18px;bottom:calc(18px + env(safe-area-inset-bottom));width:116px;height:116px;border-radius:50%;background:rgba(255,255,255,.22);border:2px solid rgba(255,255,255,.75);box-shadow:0 2px 10px rgba(0,0,0,.25);touch-action:none}
.wk-stick i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none}
.wk-btns{position:absolute;right:12px;bottom:calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
.wk-btns button{width:52px;height:52px;border-radius:50%;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.94);font-size:22px;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.wk-btns button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
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
`;
function hudMake() {
  if (!document.getElementById('wkCss')) { const s = document.createElement('style'); s.id = 'wkCss'; s.textContent = CSS; document.head.appendChild(s); }
  const S = MI.S, h = document.createElement('div');
  h.className = 'wk-hud';
  h.innerHTML = `<div class="wk-info"><span data-wk-n>🚶 歩いています</span><small data-wk-s></small><button class="wk-cr" data-wk-cr hidden></button></div>
    <div class="wk-stick" data-wk-stick title="うごく（いっぱいに たおすと 走る）"><i></i></div>
    <div class="wk-btns"><button data-wk-run title="走る">🏃</button><button data-wk-look title="見た目">👕</button><button data-wk-x title="歩くのをやめる">✕</button></div>
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
  const rb = h.querySelector('[data-wk-run]');
  rb.onclick = () => { W.runOn = !W.runOn; rb.classList.toggle('on', W.runOn); };
  h.querySelector('[data-wk-look]').onclick = () => pickOpen();
  h.querySelector('[data-wk-x]').onclick = () => stop();
  h.querySelector('[data-wk-cr]').onclick = () => { W.crOpen = !W.crOpen; W.hudT = 0; hudTick(now()); };
  W.kd = e => {
    if (!W || (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]'))) return;
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) { W.keys[e.code] = e.type === 'keydown'; if (/^Arrow/.test(e.code)) e.preventDefault(); }
  };
  W.blur = () => { if (W) W.keys = {}; };
  window.addEventListener('keydown', W.kd); window.addEventListener('keyup', W.kd); window.addEventListener('blur', W.blur);
}
function hudTick(t) {
  if (!W.hud || t - (W.hudT || 0) < 500) return;
  W.hudT = t;
  const N = W.net, n = W.near || 0;
  const a = W.hud.querySelector('[data-wk-n]'), s = W.hud.querySelector('[data-wk-s]');
  a.textContent = n ? `🚶 近くに ${n}人` : '🚶 歩いています';
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
  if (!p.hidden) { p.hidden = true; return; }
  p.hidden = false; pickDraw();
  if (!CAT || CAT.off || now() - (CAT.t || 0) > 20000) catLoad(true).then(() => { if (CAT) CAT.t = now(); if (W && !p.hidden) pickDraw(); });
}
function pickDraw() {
  const p = W.hud.querySelector('.wk-pick'), me = CAT.me || { c: 'base', l: {} }, cur = skinOf(me.c), l = me.l || {};
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
async function start() {
  M3 = window.m3State; MI = window.MapInt;
  if (!M3 || !M3.on || !MI) return false;
  if (W) return true;
  T3 = M3.T;
  MI.hint('歩く準備をしています…');
  await catLoad();
  if (!M3.on) { MI.hint(''); return false; }
  if (CAT && CAT.soon && CAT.soon.walk && !CAT.admin) { MI.hint(''); if (typeof toast === 'function') toast(tt('🚶 街を歩くのは もうすぐ できるようになります（カミングスーン）')); return false; }   // 準備中（DB の更新121）
  W = { x: M3.tx, y: M3.ty, f: 0, fv: 0, h: M3.yaw + Math.PI, pitch: 0.32, cd: 4.5, d0: M3.d, t: now(), keys: {}, stick: { x: 0, y: 0, on: false }, runOn: false,
        others: new Map(), net: { busy: false, next: 0, sent: 0, st: -1, err: 0, off: false }, me: null, lv: 0, ix: null, blk: null, ixAt: [Infinity, Infinity], ixKey: null, near: 0 };
  W.f = M3.surf(W.x, W.y);
  M3.d = 1.2; M3.glide = null; M3.dirty = true; MI.S.dirty = true;
  avSelf();
  hudMake();
  M3.walk = { step, cam, look, zoom, tags, stop };
  MI.hint('');
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
  const w = W;
  netLeave(w);
  clearInterval(w.refresh);
  if (w.pagehide) window.removeEventListener('pagehide', w.pagehide);
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

window.Walk = { start, stop, on: () => !!W, dbg: () => (W ? { x: W.x, y: W.y, f: W.f, ix: W.ix ? { n: W.ix.tri.length / 9, ms: W.ix.ms } : null, blk: W.blk ? W.blk.size : 0, others: W.others.size, me: !!(W.me && W.me.k) } : null), cat: catLoad, onChange: f => { onChange = f; }, mmd: mmdLoad, mkBase: (look, hl) => { T3 = T3 || window.THREE; return mkBase(look, hl); }, poseBase,
  mkMMD: e => { T3 = T3 || window.THREE; return mkMMD(e); }, poseMMD, HAIR, SKIN };
})();
