/* カニノケンカ 3D：ネット対戦（風の芽経済組で足したもの）。det.js・ゲームの本体のあとに読みこむ */
/* ===== カニノケンカ 3D：ネット対戦（風の芽経済組で足したもの） =====
   ゲームの本体（kani/index.html の中身）には手を入れず、外から動かす。
   しくみ：ロックステップ。全員の端末で同じ計算（1/60秒ずつ）をして、やりとりするのは入力だけ。
   - 1ステップのあいだだけ、Math.random（決まった種の乱数）・performance.now（試合の時計）・Math.sin など（どの端末でも同じ答えの計算）に入れかえる
   - 自分の入力（キー・マウス・タッチ）は直接カニを動かさず、D ステップ後の入力として全員に送り、全員が同じステップで使う
   - ホストが全員の入力をまとめて「フレーム」にして配る。フレームがそろったステップだけ進める
   - 0.5秒ごとに状態のハッシュをくらべ、ずれたらホストの値で直す
   つなぎ方：PeerJS（端末どうしを直接）＋ 公開MQTTサーバー（中継）。部屋コード（4けた）とランダム */
(() => {
'use strict';
if (window.KNET || !window.KDET) return;
const KD = window.KDET, DMATH = KD.DMATH;
const PROTO = 1, TICK = 1000 / 60, PFX = 'kani1';
const Q = new URLSearchParams(location.search);
const PNOW = Performance.prototype.now;
const realNow = () => PNOW.call(performance);
const wait = ms => new Promise(r => setTimeout(r, ms));
const $k = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(36).slice(2, 12);
const MYID = 'k' + rid();

// ゲームの版（中身が同じ人どうしでないと、計算がずれる）。ゲームの本体と、det.js・net.js の版（?v=）から
const BUILD = (() => {
  let s = '';
  for (const sc of document.scripts) if (!sc.src && sc.text.length > s.length) s = sc.text;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const v = [...document.scripts].map(sc => (/\/(?:det|net)\.js\?v=(\w+)/.exec(sc.src || '') || [])[1]).filter(Boolean).join('.');
  return (h >>> 0).toString(36) + '.' + s.length + (v ? '.' + v : '');
})();

const mkRng = KD.mkRng;
// 試合をまたいでのこる見た目の状態のうち、乱数を使う回数にかかわるもの（嵐の海上の雨つぶ）。読みこんだときの形をおぼえておき、試合のはじめにもどす
const RAIN0 = (() => { try { return rainPts.geometry.attributes.position.array.slice(); } catch (e) { return null; } })();
function rainReset() { try { if (RAIN0) { const a = rainPts.geometry.attributes.position; a.array.set(RAIN0); a.needsUpdate = true; } } catch (e) {} }

/* ---------- 1ステップのあいだだけ入れかえる（サンドボックス） ---------- */
const MK = Object.keys(DMATH);
const NAT = { random: KD.NAT.random, raf: window.requestAnimationFrame, m: KD.NAT.m };   // 本当の Math（det.js が読みこみの前におぼえたもの）
const simRandom = () => (KD.uuid ? NAT.random() : RNG.next());   // three.js の物の ID には、ゲームの乱数を使わない
const SIM = { ms: 0 };
let SBD = 0, RNG = null;
const nowStub = () => SIM.ms;
const rafStub = function (cb) { if (cb === window.loop) return 0; return NAT.raf.call(window, cb); };
const noop = () => {};
function applySB() {
  for (const k of MK) Math[k] = DMATH[k];
  Math.random = RNG ? simRandom : NAT.random;
  try { Object.defineProperty(performance, 'now', { value: nowStub, configurable: true, writable: true }); } catch (e) {}
  window.requestAnimationFrame = rafStub;
  ren.render = noop;
}
function restoreSB() {
  for (const k of MK) Math[k] = NAT.m[k];
  Math.random = NAT.random;
  try { delete performance.now; } catch (e) {}
  window.requestAnimationFrame = NAT.raf;
  try { delete ren.render; } catch (e) {}
}
function sbIn() { if (SBD++ === 0) applySB(); }
function sbOut() { if (--SBD === 0) restoreSB(); }
// 音は端末ごと（ミュートしているかなど）にちがうので、乱数・時計はふつうのものを使う
function native(fn) { return function () { if (!SBD) return fn.apply(this, arguments); restoreSB(); try { return fn.apply(this, arguments); } finally { applySB(); } }; }
bgm.start = native(bgm.start); bgm.stop = native(bgm.stop); sfx.p = native(sfx.p);
// ステップの前後で、画面の操作の値（スティック・とっしんボタン・キー・説明を開いているか）をよけておく
const KS = {}, SVS = [null, null, null, null], RHS = [0, 0, 0, 0];
let RULES = false;
function simIn() {
  for (const k in keys) { KS[k] = keys[k]; delete keys[k]; }
  for (let i = 0; i < 4; i++) { SVS[i] = sv[i]; RHS[i] = rh[i]; }
  RULES = rulesOpen; rulesOpen = false;
  sbIn();
}
function simOut() {
  sbOut();
  for (const k in KS) { keys[k] = KS[k]; delete KS[k]; }
  for (let i = 0; i < 4; i++) { sv[i] = SVS[i]; rh[i] = RHS[i]; }
  rulesOpen = RULES;
}

/* ---------- 状態のハッシュ・スナップショット ---------- */
const HDV = new DataView(new ArrayBuffer(8));
function H() { this.h = 2166136261 | 0; }
H.prototype.u = function (x) { this.h = Math.imul(this.h ^ (x | 0), 16777619); };
H.prototype.n = function (v) {
  if (typeof v === 'number') { HDV.setFloat64(0, v); this.u(HDV.getInt32(0)); this.u(HDV.getInt32(4)); }
  else if (typeof v === 'boolean') this.u(v ? 7 : 3);
  else if (typeof v === 'string') { this.u(v.length); for (let i = 0; i < v.length; i++) this.u(v.charCodeAt(i)); }
  else if (v === null) this.u(11); else if (v === undefined) this.u(13);
};
H.prototype.o = function (o) {
  if (!o) { this.u(17); return; }
  for (const k in o) { const v = o[k], t = typeof v; if (t === 'number' || t === 'boolean' || t === 'string' || v == null) this.n(v); }
};
function stateHash() {
  const h = new H();
  h.n(LS.tick); h.n(t); h.n(tmr); h.n(score[0]); h.n(score[1]); h.n(state); h.n(shake); h.n(stage);
  if (RNG) RNG.get().forEach(x => h.u(x));
  if (P) for (const c of CR()) { h.o(c); h.n(c.W && c.W.id); h.n(c.T && c.T.n); }
  h.u(fishes.length); for (const f of fishes) h.o(f);
  h.u(items.length); for (const f of items) h.o(f);
  h.u(rocks.length); h.u(beams.length); h.u(mats.length); h.u(pools.length); h.u(magas.length); h.u(misc.length); h.u(fx.length);
  return h.h >>> 0;
}
// プリミティブだけを、キーの順に値の配列で
const ENC = v => (typeof v === 'number' && !isFinite(v)) ? { n: String(v) } : v;
const DEC = v => (v && typeof v === 'object' && typeof v.n === 'string') ? Number(v.n) : v;
function primVals(o) {
  const ks = [], vs = [];
  for (const k in o) { const v = o[k], ty = typeof v; if (ty === 'number' || ty === 'boolean' || ty === 'string' || v == null) { ks.push(k); vs.push(ENC(v === undefined ? null : v)); } }
  const hh = new H(); for (const k of ks) hh.n(k);
  return { k: hh.h >>> 0, v: vs };
}
function primSet(o, s) {
  const ks = [];
  for (const k in o) { const v = o[k], ty = typeof v; if (ty === 'number' || ty === 'boolean' || ty === 'string' || v == null) ks.push(k); }
  const hh = new H(); for (const k of ks) hh.n(k);
  if ((hh.h >>> 0) !== s.k || ks.length !== s.v.length) return false;
  ks.forEach((k, i) => { o[k] = DEC(s.v[i]); });
  return true;
}
function capSnap() {
  return { t, tm: tmr, sc: [score[0], score[1]], sh: shake, en: endT, st: state, rng: RNG.get(),
    cr: P ? CR().map(primVals) : [], fi: fishes.map(primVals), it: items.map(primVals),
    hd: [holdT[0], holdT[1]], sw: [swapped[0], swapped[1]] };
}
function applySnap(S) {
  t = S.t; tmr = S.tm; score[0] = S.sc[0]; score[1] = S.sc[1]; shake = S.sh; endT = S.en; RNG.set(S.rng);
  holdT[0] = S.hd[0]; holdT[1] = S.hd[1]; swapped[0] = S.sw[0]; swapped[1] = S.sw[1];
  let ok = S.st === state;
  const cs = P ? CR() : [];
  if (cs.length === S.cr.length) cs.forEach((c, i) => { if (!primSet(c, S.cr[i])) ok = false; }); else ok = false;
  if (fishes.length === S.fi.length) fishes.forEach((f, i) => { if (!primSet(f, S.fi[i])) ok = false; }); else ok = false;
  if (items.length === S.it.length) items.forEach((f, i) => { if (!primSet(f, S.it[i])) ok = false; }); else ok = false;
  return ok;
}

/* ---------- 自分の入力（ネット対戦のあいだは、ゲームの操作を横取りして、入力として送る） ---------- */
const IN = { kd: {}, ev: [], rush: 0, ptr: new Map() };
const KEYS = {
  S: ['Space', 'KeyF', 'KeyJ', 'Enter', 'NumpadEnter', 'Slash'],
  T: ['KeyG', 'KeyK', 'Period'],
  E: ['KeyE', 'Quote'], Q: ['KeyQ', 'Semicolon'], R: ['KeyR', 'Comma'],
  L: ['KeyV'], B: ['KeyB', 'Backslash'],
  X: ['KeyX', 'KeyN'], C: ['KeyC', 'KeyM'],
  rush: ['ShiftLeft', 'ShiftRight', 'KeyL', 'KeyR', 'Comma'],
  move: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
};
const K2A = {};
for (const a in KEYS) for (const c of KEYS[a]) (K2A[c] = K2A[c] || []).push(a);
const inField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
addEventListener('keydown', e => {
  if (!LS.on) return;
  const as = K2A[e.code]; if (!as) return;
  e.preventDefault(); e.stopImmediatePropagation();
  IN.kd[e.code] = 1;
  for (const a of as) {
    if (a === 'S' || a === 'T' || a === 'E' || a === 'Q' || a === 'R' || a === 'L' || a === 'B') IN.ev.push(a);
    else if ((a === 'X' || a === 'C') && !e.repeat) IN.ev.push(a);
  }
}, true);
addEventListener('keyup', e => {
  if (!LS.on) return;
  const as = K2A[e.code]; if (!as) return;
  e.preventDefault(); e.stopImmediatePropagation();
  IN.kd[e.code] = 0;
  for (const a of as) { if (a === 'S') IN.ev.push('U'); else if (a === 'E' || a === 'Q' || a === 'R') IN.ev.push('e'); else if (a === 'X') IN.ev.push('x'); }
}, true);
addEventListener('blur', () => {
  if (!LS.on) return;
  const kd = IN.kd;
  if (KEYS.S.some(c => kd[c])) IN.ev.push('U');
  if (KEYS.E.concat(KEYS.Q, KEYS.R).some(c => kd[c])) IN.ev.push('e');
  if (KEYS.X.some(c => kd[c])) IN.ev.push('x');
  IN.kd = {};
  IN.ptr.forEach(a => ptrUp(a)); IN.ptr.clear();
});
const BTN = { b1: ['S', 'U'], t1: ['T'], r1: ['rush'], e1: ['E', 'e'], e1b: ['Q', 'e'], e1c: ['R', 'e'], l1: ['L'], lt1: ['B'], c1: ['X', 'x'], g1: ['C'] };
function ptrUp(a) { if (a === 'rush') IN.rush = Math.max(0, IN.rush - 1); else if (a) IN.ev.push(a); }
addEventListener('pointerdown', e => {
  if (!LS.on) return;
  const tg = e.target;
  const b = tg.closest && tg.closest('.act');
  if (b) {
    e.preventDefault(); e.stopPropagation();
    const m = BTN[b.id]; if (!m) return;
    if (m[0] === 'rush') { IN.rush++; IN.ptr.set(e.pointerId, 'rush'); }
    else { IN.ev.push(m[0]); if (m[1]) IN.ptr.set(e.pointerId, m[1]); }
    try { b.setPointerCapture(e.pointerId); } catch (x) {}
    return;
  }
  if (tg === ren.domElement) {
    e.preventDefault(); e.stopPropagation();
    if (e.pointerType === 'mouse') { if (e.button === 0) { IN.ev.push('S'); IN.ptr.set(e.pointerId, 'U'); } else if (e.button === 2) IN.ev.push('T'); }
    return;
  }
  const ic = tg.closest && tg.closest('.ic');
  if (ic) {
    e.preventDefault(); e.stopPropagation();
    const box = ic.parentElement, my = LS.slot;
    if (LS.fmt === '1v1' && box && ((my === 0 && box.id === 'ib2') || (my === 1 && box.id === 'ib1'))) IN.ev.push('g' + (+ic.dataset.i || 0));
  }
}, true);
// 指をはなしたとき：ゲームのボタンの「はなした」の処理（はさむのをやめる・EVO をとめる など）は、ここで止める（自分の端末だけで動くと、ずれるので）
const ptrEnd = e => {
  if (LS.on) { const tg = e.target; if (IN.ptr.has(e.pointerId) || (tg && tg.closest && tg.closest('.act'))) e.stopPropagation(); }
  const a = IN.ptr.get(e.pointerId); if (a === undefined) return; IN.ptr.delete(e.pointerId); ptrUp(a);
};
addEventListener('pointerup', ptrEnd, true);
addEventListener('pointercancel', ptrEnd, true);
addEventListener('click', e => { if (LS.on && e.target.closest && e.target.closest('.ic')) e.stopPropagation(); }, true);
// いまの自分の入力（D ステップ後に使う）
function sampleLocal() {
  const kd = IN.kd;
  let x = ((kd.KeyD || kd.ArrowRight) ? 1 : 0) - ((kd.KeyA || kd.ArrowLeft) ? 1 : 0);
  let z = ((kd.KeyS || kd.ArrowDown) ? 1 : 0) - ((kd.KeyW || kd.ArrowUp) ? 1 : 0);
  const s = sv[0]; if (s) { x += +s.x || 0; z += +s.z || 0; }
  const l = Math.sqrt(x * x + z * z); if (l > 1) { x /= l; z /= l; }
  const qx = Math.round(x * 100), qz = Math.round(z * 100);
  const r = (kd.ShiftLeft || kd.ShiftRight || kd.KeyL || kd.KeyR || kd.Comma || IN.rush > 0) ? 1 : 0;
  const ev = IN.ev.length ? IN.ev.splice(0, IN.ev.length) : null;
  if (!qx && !qz && !r && !ev) return 0;
  return ev ? [qx, qz, r, ev] : [qx, qz, r];
}

/* ---------- ロックステップ ---------- */
const LS = {
  on: false, host: false, fmt: '1v1', n: 2, slot: 0, D: 6, D0: 6, lastTgt: 5, lastInp: 0, dT: 0, dWait: 0, dLow: 0, tick: 0, base: 1e6, mid: '',
  frames: new Map(), snaps: new Map(), sched: new Map(),
  inb: [], nf: 0, ackIn: [], gs: new Map(),          // ホスト：スロットごとに届いた入力・次に作るフレーム・どこまで届いたか・相手ごとの送り具合
  myIn: new Map(), sentIn: -1, hostAck: -1, lf: -1, lastSendIn: 0, lastResendIn: 0,   // 参加者
  budget: 0, lastReal: 0, lastStep: 0, prevState: '', hh: new Map(), gh: new Map(),
  snapReq: false, snapPend: -1, fixes: 0, fixT: 0, desync: 0, err: 0, endInfo: null, stats: { steps: 0, stall: 0, wait: 0 }
};
const crabOf = k => LS.fmt === '2v2' ? (P ? CR()[k] : null) : (k === 0 ? P : E);
const oppOf = (k, c) => LS.fmt === '2v2' ? OPP(c) : (k === 0 ? E : P);
function applyEv(k, e) {
  if (e === 'A') { advance(); return; }
  if (state !== 'play' || typeof e !== 'string') return;
  const c = crabOf(k); if (!c) return;
  const o = oppOf(k, c), one = LS.fmt !== '2v2';
  switch (e[0]) {
    case 'S': if (one) holdT[k] = holdT[k] || performance.now(); strikeS(c, 1); break;
    case 'U': if (one) { holdT[k] = 0; swapped[k] = false; } releaseS(c); break;
    case 'L': if (c.T.nito) strikeS(c, -1); break;
    case 'T': throwW(c, o); break;
    case 'B': if (c.T.nito) throwW(c, o, -1); break;
    case 'E': evoUse(c, o); break;
    case 'Q': evoUse(c, o, 2); break;
    case 'R': evoUse(c, o, 3); break;
    case 'e': evoRel(c); break;
    case 'X': carBoost(c); break;
    case 'x': c.cHold = false; break;
    case 'C': judoGrab(c); break;
    case 'g': { const i = +e.slice(1), L = entList(o), r = L[i] && L[i].ref; if (r) c.tgt = r; break; }
  }
}
function applyFrame(I) {
  for (let k = 0; k < LS.n; k++) {
    const p = I && I[k];
    if (p) { sv[k] = { x: p[0] / 100, z: p[1] / 100 }; rh[k] = p[2] ? 1 : 0; }
    else { sv[k] = { x: 0, z: 0 }; rh[k] = 0; }
  }
  if (I) for (let k = 0; k < LS.n; k++) { const p = I[k]; if (p && p[3]) for (const e of p[3]) applyEv(k, e); }
}
const origLoop = window.loop;
window.loop = function (n) { if (!LS.on) return origLoop(n); KN.frame(n); };
// 1ステップ
function canStep(T) {
  if (T < LS.D0) return true;
  const fr = LS.frames.get(T);
  if (!fr) return false;
  if (fr.z && !LS.host && !LS.snaps.has(T)) return false;
  return true;
}
function stepOnce() {
  const T = LS.tick;
  produceInput(T);
  const fr = T < LS.D0 ? null : LS.frames.get(T);
  if (fr && fr.z) {
    if (LS.host) { LS.fixT = T; net.send({ y: 'snap', n: T, s: capSnap() }); }
    else { const S = LS.snaps.get(T); LS.snaps.delete(T); if (S && !applySnap(S)) console.warn('[kani net] snap: 形がちがうので一部だけ直しました', T); }
  }
  SIM.ms = LS.base + T * TICK;
  const t0 = realNow();
  simIn();
  try { applyFrame(fr ? fr.i : null); origLoop(SIM.ms); }
  catch (e) { LS.err++; console.error('[kani net] step', T, e); }
  finally { simOut(); }
  LS.tick = T + 1; LS.stats.steps++; LS.stats.ms += realNow() - t0;
  if (T % 30 === 29) checkHash(T);
  afterStep(T);
  if (!LS.host) LS.frames.delete(T);
  else { const old = T - 900; if (old >= 0) LS.frames.delete(old); }
}
// 自分の入力は、ステップ T のときに T + D のぶんとして出す。D が大きくなってあいたステップは、前の入力（向きと、とっしんの押しっぱなしだけ）でうめる。
// D が小さくなったときは、もう出したステップに追いつくまで入力をためておく（どのステップにも、だれの入力も1つずつ）
function produceInput(T) {
  const tgt = T + LS.D;
  if (tgt <= LS.lastTgt) return;
  const inp = sampleLocal();
  const p = LS.lastInp, rep = p ? ((p[0] || p[1] || p[2]) ? [p[0], p[1], p[2]] : 0) : 0;
  for (let x = LS.lastTgt + 1; x <= tgt; x++) {
    let v = x === tgt ? inp : rep;
    if (LS.host) {
      const se = LS.sched.get(x);
      if (se) { LS.sched.delete(x); v = !v ? [0, 0, 0, se] : !v[3] ? [v[0], v[1], v[2], se] : [v[0], v[1], v[2], v[3].concat(se)]; }
      LS.inb[LS.slot].set(x, v);
    } else { LS.myIn.set(x, v); LS.myTop = x; }
  }
  LS.lastTgt = tgt; LS.lastInp = inp;
  if (LS.host) hostFinalize();   // 参加者の入力は、このフレームのステップがおわってから、まとめて送る
}
// ホスト：2秒ごとに、通信の速さ（往復の時間）と、入力を待って止まった回数から D を決めなおして、全員に知らせる。大きくするのはすぐ、小さくするのはゆっくり
function adaptD(now) {
  if (!LS.on || !LS.host || now - LS.dT < 2000) return;
  LS.dT = now;
  const R = KN.room, rt = Math.max(0, ...(R ? R.mem.filter(m => m.id !== MYID && LS.gs.has(m.id)).map(m => m.rtt || 0) : [0]));
  let want = Math.max(4, Math.min(40, Math.ceil((rt + 50) / TICK)));
  let waits = LS.stats.wait - LS.dWait; LS.dWait = LS.stats.wait;
  for (const g of LS.gs.values()) { waits = Math.max(waits, g.w || 0); g.w = 0; }   // 参加者が止まった回数も（ハッシュといっしょに届く）
  if (waits > 20) want = Math.max(want, LS.D + 3);
  else if (waits > 10) want = Math.max(want, LS.D + 1);   // ときどき止まる：少しだけ大きく（止まるより、少しおくれるほうが気にならない）
  if (want > LS.D) { LS.dLow = 0; setD(Math.min(40, want)); }
  else if (want < LS.D - 2 && waits < 3) { if (++LS.dLow >= 3) { LS.dLow = 0; setD(LS.D - 2); } }
  else LS.dLow = 0;
}
function setD(d) { if (d === LS.D) return; LS.D = d; net.send({ y: 'dd', D: d, mid: LS.mid }); }
// ホスト：全員の入力がそろったステップから、フレームにして配る
function hostFinalize() {
  for (;;) {
    const T = LS.nf, I = [];
    for (let k = 0; k < LS.n; k++) { const m = LS.inb[k]; if (!m.has(T)) { sendFrames(false); return; } I.push(m.get(T)); }
    for (let k = 0; k < LS.n; k++) LS.inb[k].delete(T);
    const fr = { i: I };
    if (LS.snapReq) { fr.z = 1; LS.snapReq = false; LS.snapPend = T; }
    LS.frames.set(T, fr); LS.nf = T + 1;
    for (let k = 0; k < LS.n; k++) if (LS.ackIn[k] < T) LS.ackIn[k] = T;
  }
}
function framePack(a, b) {
  const d = [], z = [];
  for (let T = a; T <= b; T++) { const f = LS.frames.get(T); if (!f) break; d.push(f.i); if (f.z) z.push(T); }
  return { d, z };
}
function sendFrames(force) {
  const now = realNow();
  for (const g of LS.gs.values()) {
    const top = LS.nf - 1, direct = net.direct(g.id);
    let from;
    if (top > g.sent) from = direct && top - g.ack <= 48 ? g.ack + 1 : g.sent + 1;   // 直接のときは、まだ届いたと言われていない分も（1つ遅れても止まらない）
    else if (g.ack < g.sent && (force || now - g.rs > 300)) { from = g.ack + 1; g.rs = now; }
    else continue;
    if (!direct && !force && top - from < 2 && now - g.lt < 50) continue;   // 中継のときは少しまとめる
    const b = Math.min(top, from + 59), pk = framePack(from, b);
    if (!pk.d.length) continue;
    net.send({ y: 'f', a: from, d: pk.d, z: pk.z.length ? pk.z : undefined, k: LS.ackIn[g.slot], D: LS.D }, g.id);
    g.sent = Math.max(g.sent, from + pk.d.length - 1); g.lt = now;
  }
}
function sendInputs(force) {
  const now = realNow();
  const top = LS.myTop;
  const direct = net.direct();
  let from;
  if (top > LS.sentIn) from = direct && top - LS.hostAck <= 48 ? LS.hostAck + 1 : LS.sentIn + 1;   // 直接のときは、まだ届いたと言われていない分も
  else if (LS.hostAck < LS.sentIn && (force || now - LS.lastResendIn > 300)) { from = LS.hostAck + 1; LS.lastResendIn = now; }
  else return;
  from = Math.max(from, LS.D0);
  if (!direct && !force && top - from < 2 && now - LS.lastSendIn < 50) return;
  const d = [];
  for (let T = from; T <= top && d.length < 60; T++) d.push(LS.myIn.has(T) ? LS.myIn.get(T) : 0);
  if (!d.length) return;
  net.send({ y: 'i', s: LS.slot, a: from, d, k: LS.lf });
  LS.sentIn = Math.max(LS.sentIn, from + d.length - 1); LS.lastSendIn = now;
}
const EVOK = /^(?:[SULTBEQReXxC]|g\d{1,2})$/;
function cleanInp(p) {
  if (!Array.isArray(p)) return 0;
  const n = v => (Number.isInteger(v) && v >= -100 && v <= 100) ? v : 0;
  const x = n(p[0]), z = n(p[1]), r = p[2] ? 1 : 0;
  let ev = Array.isArray(p[3]) ? p[3].filter(e => typeof e === 'string' && EVOK.test(e)).slice(0, 24) : null;
  if (ev && !ev.length) ev = null;
  if (!x && !z && !r && !ev) return 0;
  return ev ? [x, z, r, ev] : [x, z, r];
}
function onInputs(m, from) {
  if (!LS.on || !LS.host) return;
  const g = LS.gs.get(from); if (!g || g.slot !== m.s || !Array.isArray(m.d) || !Number.isInteger(m.a)) return;
  const box = LS.inb[g.slot];
  for (let j = 0; j < m.d.length && j < 120; j++) { const T = m.a + j; if (T >= LS.nf && !box.has(T)) box.set(T, cleanInp(m.d[j])); }
  let x = LS.ackIn[g.slot]; while (x + 1 < LS.nf || box.has(x + 1)) x++; LS.ackIn[g.slot] = x;
  if (typeof m.k === 'number' && m.k > g.ack) g.ack = Math.min(m.k, g.sent);
  g.lastIn = realNow();
  hostFinalize();
}
function onFrames(m) {
  if (!LS.on || LS.host || !Array.isArray(m.d)) return;
  const zs = new Set(m.z || []);
  for (let j = 0; j < m.d.length; j++) { const T = m.a + j; if (T >= LS.tick && !LS.frames.has(T)) LS.frames.set(T, zs.has(T) ? { i: m.d[j], z: 1 } : { i: m.d[j] }); }
  while (LS.lf + 1 < LS.tick || LS.frames.has(LS.lf + 1)) LS.lf++;
  if (typeof m.k === 'number' && m.k > LS.hostAck) { LS.hostAck = m.k; for (const T of LS.myIn.keys()) if (T <= m.k) LS.myIn.delete(T); }
  const e = m.a + m.d.length;   // 入力のおくれ（ホストが決める）。順番が入れかわって届いた古いものでは、もどさない
  if (Number.isInteger(m.D) && e >= (LS.dN || 0)) { LS.dN = e; LS.D = Math.max(2, Math.min(40, m.D)); }
  LS.lastFrameAt = realNow();
}
// 0.5秒ごとのハッシュ（参加者はホストに送る。ホストはくらべて、ずれたら直す）
const DBG = Q.has('knetdbg');
function dbgSnap() {
  const prim = o => { const r = {}; for (const k in o) { const v = o[k], ty = typeof v; if (ty === 'number' || ty === 'boolean' || ty === 'string' || v == null) r[k] = v; } return r; };
  return { t, tmr, state, shake, rng: RNG && RNG.get(), cr: P ? CR().map(prim) : [], fi: fishes.map(prim), it: items.map(prim),
    n: { rocks: rocks.length, beams: beams.length, mats: mats.length, pools: pools.length, magas: magas.length, misc: misc.length, fx: fx.length } };
}
function checkHash(T) {
  const h = stateHash();
  if (DBG) { LS.dbg = LS.dbg || new Map(); LS.dbg.set(T, JSON.stringify(dbgSnap())); if (LS.dbg.size > 40) LS.dbg.delete(LS.dbg.keys().next().value); }
  if (!LS.host) { const w = LS.stats.wait - (LS.repW || 0); LS.repW = LS.stats.wait; net.send({ y: 'h', n: T, h, w }); return; }
  LS.hh.set(T, h); LS.hh.delete(T - 1800);
  const pend = LS.gh.get(T); if (pend) { LS.gh.delete(T); pend.forEach(x => cmpHash(T, x[0], x[1])); }
}
function onHash(m, from) {
  if (!LS.on || !LS.host) return;
  const g = LS.gs.get(from); if (g && Number.isInteger(m.w) && m.w > 0) g.w = (g.w || 0) + Math.min(m.w, 600);
  if (LS.hh.has(m.n)) cmpHash(m.n, from, m.h);
  else if (m.n >= LS.tick - 1) { const a = LS.gh.get(m.n) || []; a.push([from, m.h]); LS.gh.set(m.n, a); }
}
function cmpHash(T, from, h) {
  if (LS.hh.get(T) === h) return;
  LS.desync++;
  console.warn('[kani net] ずれ', T, from, LS.hh.get(T), h);
  if (LS.snapPend >= 0 && T < LS.snapPend + 90) return;    // もう直しに行っている
  if (LS.fixes >= 6) { KN.hostAbort('計算のずれが直らないので、試合を止めました'); return; }
  LS.fixes++; LS.snapReq = true; LS.snapPend = LS.nf;
}
function onSnap(m) { if (LS.on && !LS.host && typeof m.n === 'number' && m.s) LS.snaps.set(m.n, m.s); }
// ステップのあと：ラウンドの終わり → ホストが「つぎへ」を予約。試合が終わって選ぶ画面にもどったら、部屋へ
function afterStep(T) {
  if (state !== LS.prevState) {
    const was = LS.prevState; LS.prevState = state;
    if (state === 'round' || state === 'match') {
      LS.endInfo = { sc: [score[0], score[1]], msg: msg.textContent || '', over: state === 'match' };
      if (LS.host) { const at = T + 1 + (state === 'match' ? 240 : 150); const a = LS.sched.get(at) || []; a.push('A'); LS.sched.set(at, a); }
    }
    if (state === 'select' && was) { KN.matchOver(); return; }
  }
}

/* ---------- 公開MQTTサーバーでの中継（市区町村バトルと同じしくみ） ---------- */
const MQ = (() => {
  const LIST = Array.isArray(window.__mqttBrokers) ? window.__mqttBrokers : [
    'wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://mqtt.eclipseprojects.io/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const OK = typeof TextEncoder === 'function' && typeof TextDecoder === 'function';
  const te = OK ? new TextEncoder() : null, td = OK ? new TextDecoder() : null;
  const subs = new Map(), unsubT = new Map(), watch = new Set();
  const bs = LIST.map(url => ({ url, ws: null, ok: false, fails: 0, t: 0, buf: null, last: 0, rx: 0, tx: 0 }));
  const cid = 'kn' + rid();
  let on = false, pid = 0, ka = 0;
  function cat(ps) { let n = 0; for (const p of ps) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; }
  function s16(s) { const b = te.encode(s); return cat([[b.length >> 8 & 255, b.length & 255], b]); }
  function pkt(h, body) { const a = [h]; let n = body.length; do { let d = n & 127; n = Math.floor(n / 128); if (n) d |= 128; a.push(d); } while (n); return cat([a, body]); }
  const nid = () => (pid = pid % 65535 + 1);
  const pConnect = () => pkt(0x10, cat([s16('MQTT'), [4, 2, 0, 60], s16(cid)]));
  function pSub(ts) { const id = nid(); const ps = [[id >> 8, id & 255]]; for (const t of ts) ps.push(s16(t), [0]); return pkt(0x82, cat(ps)); }
  function pUnsub(ts) { const id = nid(); const ps = [[id >> 8, id & 255]]; for (const t of ts) ps.push(s16(t)); return pkt(0xA2, cat(ps)); }
  const pPub = (t, s) => pkt(0x30, cat([s16(t), te.encode(s)]));
  function send(b, d) { if (b.ws && b.ws.readyState === 1) { try { b.ws.send(d); b.tx++; return true; } catch (e) {} } return false; }
  function changed() { watch.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
  function handle(b, h, body) {
    const type = h >> 4;
    if (type === 2) { if (body.length >= 2 && body[1] === 0) { b.ok = true; b.fails = 0; const ts = [...subs.keys()]; if (ts.length) send(b, pSub(ts)); changed(); } else if (b.kill) b.kill(); }
    else if (type === 3) {
      if (body.length < 2) return;
      const tl = body[0] << 8 | body[1]; if (2 + tl > body.length) return;
      const topic = td.decode(body.subarray(2, 2 + tl)); let k = 2 + tl;
      const qos = (h >> 1) & 3; if (qos) { if (qos === 1 && k + 2 <= body.length) send(b, pkt(0x40, [body[k], body[k + 1]])); k += 2; }
      b.rx++;
      const hs = subs.get(topic); if (!hs || !hs.size) return;
      let m; try { m = JSON.parse(td.decode(body.subarray(k))); } catch (e) { return; }
      [...hs].forEach(f => { try { f(m, topic); } catch (e) { console.error(e); } });
    }
  }
  function feed(b, data) {
    const buf = b.buf ? cat([b.buf, data]) : data;
    let i = 0;
    for (;;) {
      if (buf.length - i < 2) break;
      let len = 0, mul = 1, j = i + 1, done = false;
      while (j < buf.length) { const d = buf[j++]; len += (d & 127) * mul; if (!(d & 128)) { done = true; break; } mul *= 128; if (mul > 2097152) { b.buf = null; if (b.kill) b.kill(); return; } }
      if (!done || buf.length - j < len) break;
      handle(b, buf[i], buf.subarray(j, j + len)); i = j + len;
    }
    b.buf = i < buf.length ? buf.slice(i) : null;
  }
  function open(b) {
    if (!on || b.ws) return;
    let ws; try { ws = new WebSocket(b.url, ['mqtt']); } catch (e) { b.fails++; later(b); return; }
    ws.binaryType = 'arraybuffer'; b.ws = ws; b.ok = false; b.buf = null; b.last = Date.now();
    const dead = () => { clearTimeout(to); if (b.ws !== ws) return; b.ws = null; const was = b.ok; b.ok = false; b.fails++; try { ws.close(); } catch (e) {} later(b); if (was) changed(); };
    const to = setTimeout(() => { if (b.ws === ws && !b.ok) dead(); }, 10000);
    ws.onopen = () => { if (b.ws === ws) send(b, pConnect()); };
    ws.onmessage = e => { if (b.ws !== ws) return; b.last = Date.now(); if (e.data instanceof ArrayBuffer) feed(b, new Uint8Array(e.data)); };
    ws.onclose = dead; ws.onerror = dead; b.kill = dead;
  }
  function later(b) { clearTimeout(b.t); if (on) b.t = setTimeout(() => open(b), Math.min(30000, 800 * Math.pow(2, Math.min(b.fails, 6)))); }
  function keep() { const now = Date.now(); for (const b of bs) { if (!b.ws) continue; if (b.ok && now - b.last > 70000) { if (b.kill) b.kill(); continue; } if (b.ok) send(b, new Uint8Array([0xC0, 0])); } }
  function start() { if (on || !OK || typeof WebSocket !== 'function' || !bs.length) return; on = true; bs.forEach(open); ka = setInterval(keep, 20000); }
  function count() { let n = 0; for (const b of bs) if (b.ok) n++; return n; }
  return {
    start, count, get all() { return bs.length; },
    sub(topic, f) {
      start();
      let hs = subs.get(topic);
      if (!hs) { hs = new Set(); subs.set(topic, hs); bs.forEach(b => { if (b.ok) send(b, pSub([topic])); }); }
      clearTimeout(unsubT.get(topic)); unsubT.delete(topic);
      hs.add(f);
      return () => {
        const h2 = subs.get(topic); if (!h2 || !h2.delete(f) || h2.size || unsubT.has(topic)) return;
        unsubT.set(topic, setTimeout(() => { unsubT.delete(topic); const h3 = subs.get(topic); if (h3 && !h3.size) { subs.delete(topic); bs.forEach(b => { if (b.ok) send(b, pUnsub([topic])); }); } }, 3000));
      };
    },
    pub(topic, obj) { start(); let s; try { s = JSON.stringify(obj); } catch (e) { return 0; } const d = pPub(topic, s); let n = 0; for (const b of bs) if (b.ok && send(b, d)) n++; return n; },
    ready(ms) { start(); return new Promise(res => { if (count()) return res(true); if (!on) return res(false); const t0 = Date.now(); const iv = setInterval(() => { if (count()) { clearInterval(iv); res(true); } else if (Date.now() - t0 >= ms || bs.every(b => b.fails > 0)) { clearInterval(iv); res(false); } }, 100); }); },
    onChange(f) { watch.add(f); return () => watch.delete(f); },
    stat() { return bs.map(b => ({ url: b.url, ok: b.ok, fails: b.fails, rx: b.rx, tx: b.tx })); }
  };
})();

/* ---------- PeerJS（使うときだけ読みこむ） ---------- */
const PEEROPT = Object.assign({ debug: 0 }, window.__peerOpt || {});
let peerP = null;
function loadPeerJS() {
  if (typeof window.Peer === 'function') return Promise.resolve(true);
  if (peerP) return peerP;
  peerP = new Promise(res => {
    const s = document.createElement('script');
    s.src = window.__peerSrc || 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
    if (!window.__peerSrc) { s.integrity = 'sha512-iFU+yF1keEaLDC9HEwPfLMSRaS0unBHE14GEgx6pQKJXjp5v0tvX8xpfp2lgJ62XEjbYp/M5C3CAmej/PWXMyA=='; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
    s.onload = () => res(typeof window.Peer === 'function');
    s.onerror = () => res(false);
    document.head.appendChild(s);
    setTimeout(() => res(typeof window.Peer === 'function'), 9000);
  });
  return peerP;
}
function newPeer(id, ms) {
  return new Promise((res, rej) => {
    let p; try { p = id ? new Peer(id, PEEROPT) : new Peer(PEEROPT); } catch (e) { rej({ code: 'ng' }); return; }
    let done = false;
    const tm = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch (e) {} rej({ code: 'timeout' }); } }, ms || 10000);
    p.on('open', () => { if (!done) { done = true; clearTimeout(tm); res(p); } });
    p.on('error', e => { if (!done) { done = true; clearTimeout(tm); try { p.destroy(); } catch (x) {} rej({ code: e && e.type === 'unavailable-id' ? 'taken' : 'ng' }); } });
  });
}

/* ---------- つなぐところ（ホスト・参加者。テスト用に同じブラウザの BroadcastChannel も） ---------- */
// 届いた知らせが重なっていないか（同じ知らせが、直接と中継の両方から届くことがある）
function mkDedup() {
  const seen = new Map();
  return env => {
    let s = seen.get(env.g); if (!s) { s = { set: new Set(), q: [] }; seen.set(env.g, s); }
    if (s.set.has(env.n)) return true;
    s.set.add(env.n); s.q.push(env.n); if (s.q.length > 1024) s.set.delete(s.q.shift());
    return false;
  };
}
// PeerJS の JSON の道は、16300 バイトより大きい通信は送れない（送れないうえに、その道がエラーになる）。大きくなりうるもの（状態の直し・部屋・開始）は、はかって大きければ中継で送る
const BIG = new Set(['snap', 'room', 'start']);
const ENCD = new TextEncoder();
const tooBig = env => { if (!BIG.has(env.m && env.m.y)) return false; try { return ENCD.encode(JSON.stringify(env)).length > 15000; } catch (e) { return true; } };
async function linkHost(code, onMsg) {
  const L = { role: 'host', code, peer: null, gs: new Map(), closed: false, seq: 0, viaPeer: false };
  const dup = mkDedup(), tH = `${PFX}/r/${code}/h`, tG = `${PFX}/r/${code}/g`;
  function recv(env, via, dc) {
    if (L.closed || !env || typeof env !== 'object' || env.g === MYID || typeof env.g !== 'string') return;
    if (env.to && env.to !== MYID) return;
    let g = L.gs.get(env.g); if (!g) { g = { dc: null }; L.gs.set(env.g, g); }
    if (dc) g.dc = dc;
    if (dup(env)) return;
    onMsg(env.m, env.g, via);
  }
  if (Q.get('knet') === 'bc') {
    const ch = new BroadcastChannel('knet-' + code);
    ch.onmessage = e => { const env = e.data; if (env && env.k === 'h') recv(env.e, 'bc'); };
    L.send = (m, to) => { ch.postMessage({ k: 'g', e: { g: MYID, n: ++L.seq, to, m } }); };
    L.direct = () => true;
    L.close = () => { L.closed = true; ch.close(); };
    return L;
  }
  L.unsub = MQ.sub(tH, env => recv(env, 'mq'));
  let taken = false;
  if (await loadPeerJS()) {
    try {
      const p = await newPeer(`${PFX}-${code}`, 8000);
      L.peer = p; L.viaPeer = true;
      p.on('connection', c => {
        c.on('data', env => recv(env, 'dc', c));
        const drop = () => { for (const g of L.gs.values()) if (g.dc === c) g.dc = null; };
        c.on('close', drop); c.on('error', drop);
      });
      p.on('disconnected', () => { if (!L.closed) try { p.reconnect(); } catch (e) {} });
      p.on('error', () => {});
    } catch (e) { if (e && e.code === 'taken') taken = true; }
  }
  if (taken) { if (L.unsub) L.unsub(); throw { code: 'taken' }; }
  if (!L.peer) {   // PeerJS が使えないとき：同じコードのホストがいないか、MQTTで少しだけ確かめる
    if (!(await MQ.ready(8000))) { if (L.unsub) L.unsub(); throw { code: 'offline' }; }
    let other = false; const un = MQ.sub(tG, env => { if (env && env.g !== MYID) other = true; });
    MQ.pub(tH, { g: MYID, n: 0, m: { y: 'who' } }); await wait(1500); un();
    if (other) { if (L.unsub) L.unsub(); throw { code: 'taken' }; }
  }
  L.direct = to => { if (!to) return [...L.gs.values()].every(g => g.dc && g.dc.open); const g = L.gs.get(to); return !!(g && g.dc && g.dc.open); };
  L.send = (m, to) => {
    const env = { g: MYID, n: ++L.seq, to, m };
    let needMq = false, any = false;
    for (const [id, g] of L.gs) {
      if (to && id !== to) continue;
      any = true;
      if (g.dc && g.dc.open && !tooBig(env)) { try { g.dc.send(env); } catch (e) { needMq = true; } } else needMq = true;
    }
    if (needMq || !any) MQ.pub(tG, env);
  };
  L.forget = id => L.gs.delete(id);
  L.close = () => { L.closed = true; if (L.unsub) L.unsub(); const p = L.peer; if (p) setTimeout(() => { try { p.destroy(); } catch (e) {} }, 300); };
  return L;
}
async function linkGuest(code, onMsg) {
  const L = { role: 'guest', code, peer: null, dc: null, closed: false, seq: 0, fails: 0, rt: 0 };
  const dup = mkDedup(), tH = `${PFX}/r/${code}/h`, tG = `${PFX}/r/${code}/g`;
  function recv(env, via) {
    if (L.closed || !env || typeof env !== 'object' || env.g === MYID || typeof env.g !== 'string') return;
    if (env.to && env.to !== MYID) return;
    if (dup(env)) return;
    onMsg(env.m, env.g, via);
  }
  if (Q.get('knet') === 'bc') {
    const ch = new BroadcastChannel('knet-' + code);
    ch.onmessage = e => { const env = e.data; if (env && env.k === 'g') recv(env.e, 'bc'); };
    L.send = m => { ch.postMessage({ k: 'h', e: { g: MYID, n: ++L.seq, m } }); };
    L.direct = () => true;
    L.close = () => { L.closed = true; ch.close(); };
    return L;
  }
  L.unsub = MQ.sub(tG, env => recv(env, 'mq'));
  function connect() {
    if (L.closed || !L.peer || L.peer.destroyed) return;
    clearTimeout(L.rt);
    // 直接の道は、順番を待たずに届いたものからすぐ使う（1つ遅れても、あとのものが止まらない。足りない分は次の通信にも入れて送る）
    let c; try { c = L.peer.connect(`${PFX}-${code}`, { reliable: false, serialization: 'json' }); } catch (e) { L.rt = setTimeout(connect, 5000); return; }
    const lost = () => { clearTimeout(to); if (L.dc !== c && L.pend !== c) return; if (L.dc === c) L.dc = null; L.pend = null; L.fails++; if (!L.closed) L.rt = setTimeout(connect, L.fails < 3 ? 2500 : 12000); };
    const to = setTimeout(() => { if (!c.open) { try { c.close(); } catch (e) {} lost(); } }, 15000);
    L.pend = c;
    c.on('open', () => { clearTimeout(to); L.pend = null; L.dc = c; L.fails = 0; });
    c.on('data', env => recv(env, 'dc'));
    c.on('close', lost); c.on('error', lost);
  }
  loadPeerJS().then(ok => {
    if (!ok || L.closed) return;
    newPeer(null, 10000).then(p => {
      if (L.closed) { try { p.destroy(); } catch (e) {} return; }
      L.peer = p;
      p.on('error', e => { if (e && e.type === 'peer-unavailable' && !L.closed && !L.dc) { L.fails++; clearTimeout(L.rt); if (L.fails < 8) L.rt = setTimeout(connect, L.fails < 3 ? 3000 : 15000); } });
      p.on('disconnected', () => { if (!L.closed) try { p.reconnect(); } catch (e) {} });
      connect();
    }, () => {});
  });
  L.direct = () => !!(L.dc && L.dc.open);
  L.send = m => {
    const env = { g: MYID, n: ++L.seq, m };
    if (L.dc && L.dc.open && !tooBig(env)) { try { L.dc.send(env); return; } catch (e) {} }
    MQ.pub(tH, env);
  };
  L.close = () => { L.closed = true; clearTimeout(L.rt); if (L.unsub) L.unsub(); const p = L.peer; if (p) setTimeout(() => { try { p.destroy(); } catch (e) {} }, 300); };
  return L;
}
// いまのつながり（ロックステップから使う）
const net = {
  L: null,
  send(m, to) { if (this.L) this.L.send(m, to); },
  direct(to) { return !!(this.L && this.L.direct(to)); }
};

/* ---------- 部屋 ---------- */
const STAGES = [...document.querySelectorAll('#stages .sb')].map(b => b.textContent);
const FMT = { '1v1': { max: 2, order: [0, 1], name: '1対1' }, '2v2': { max: 4, order: [0, 2, 1, 3], name: '2v2' } };
const SLOTN = { '1v1': ['1P（左）', '2P（右）'], '2v2': ['1P（下チーム）', '2P（下チーム）', '3P（上チーム）', '4P（上チーム）'] };
const SLOTS = { '1v1': ['1P', '2P'], '2v2': ['1P', '2P', '3P', '4P'] };
const KN = {
  ui: 'off', room: null, host: false, code: '', fmt: '1v1', rand: false, me: { id: MYID, nm: '' },
  rtt: 0, rtts: [], lastHost: 0, timer: 0, selecting: false, picked: null, pickSent: 0, selDeadline: 0,
  saved: null, busy: false, msg: '', seekTimer: 0, adT: 0, autoT: 0, startSent: 0
};
function myName() { const v = ($k('knetName') && $k('knetName').value || '').trim().slice(0, 12); return v || KN.me.nm || 'カニ' + (1000 + Math.floor(Math.random() * 9000)); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
KN.me.nm = lsGet('kani_name') || '';

// ---- ホスト側の部屋 ----
function roomNew(code, fmt, rand) {
  return { code, fmt, rand: !!rand, ph: 'lobby', st: rand ? -1 : stage, mem: [{ id: MYID, nm: KN.me.nm, s: 0, rtt: 0, last: realNow() }],
    picks: {}, selEnd: 0, mid: '', res: '', ver: 1, t0: Date.now(), autoAt: 0 };
}
function roomPub(to) {
  const R = KN.room; if (!R || !KN.host) return;
  R.ver++;
  const left = R.ph === 'select' ? Math.max(0, Math.ceil((R.selEnd - realNow()) / 1000)) : 0;
  const auto = R.autoAt ? Math.max(0, Math.ceil((R.autoAt - realNow()) / 1000)) : 0;
  net.send({ y: 'room', v: R.ver, code: R.code, fmt: R.fmt, rand: R.rand, ph: R.ph, st: R.st, mem: R.mem.map(m => ({ id: m.id, nm: m.nm, s: m.s, rtt: m.rtt })),
    pk: Object.keys(R.picks).map(Number), left, auto, res: R.res, mid: R.mid }, to);
}
function hostOnMsg(m, from, via) {
  if (!m || typeof m !== 'object') return;
  const R = KN.room; if (!R) return;
  const mem = R.mem.find(x => x.id === from);
  if (mem) { mem.last = realNow(); mem.via = via; }
  switch (m.y) {
    case 'hello': {
      const deny = w => { net.send({ y: 'deny', w }, from); setTimeout(() => { if (net.L && net.L.forget && !(KN.room && KN.room.mem.some(x => x.id === from))) net.L.forget(from); }, 3000); };
      if (m.p !== PROTO || m.b !== BUILD) { deny('ver'); return; }
      if (mem) { if (typeof m.nm === 'string') mem.nm = m.nm.slice(0, 12); roomPub(); return; }
      if (R.ph !== 'lobby') { deny('busy'); return; }
      const F = FMT[R.fmt];
      if (R.mem.length >= F.max) { deny('full'); return; }
      const used = new Set(R.mem.map(x => x.s)), s = F.order.find(x => !used.has(x));
      R.mem.push({ id: from, nm: String(m.nm || '').slice(0, 12) || 'カニ', s, rtt: 0, last: realNow(), via });
      if (R.rand && R.mem.length >= F.max) R.autoAt = realNow() + 4000;
      roomPub(); uiRender(); return;
    }
    case 'bye': if (mem) memberGone(mem, 'left'); return;
    case 'ping': net.send({ y: 'pong', t: m.t }, from); return;
    case 'pong': if (mem && typeof m.t === 'number') { const r = realNow() - m.t; mem.rtts = (mem.rtts || []).concat(r).slice(-7); mem.rtt = median(mem.rtts); } return;
    case 'pick': if (mem && R.ph === 'select' && m.s === mem.s && m.p) { if (!R.picks[mem.s]) { R.picks[mem.s] = checkPick(m.p, R.fmt); roomPub(); maybeStart(); } else net.send({ y: 'pkok' }, from); } return;
    case 'go': if (mem) mem.go = m.mid; return;
    case 'i': onInputs(m, from); return;
    case 'h': onHash(m, from); return;
    case 'who': roomPub(); return;
  }
}
function median(a) { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] || 0; }
function memberGone(mem, why) {
  const R = KN.room; if (!R) return;
  R.mem = R.mem.filter(x => x !== mem);
  if (net.L && net.L.forget) net.L.forget(mem.id);
  R.autoAt = 0;
  if (R.ph === 'select' || R.ph === 'play') {
    const msgx = `${mem.nm} さんがぬけたので、試合をやめました`;
    net.send({ y: 'abort', w: msgx });
    if (LS.on) KN.stopLockstep(msgx); else exitSelect();
    R.ph = 'lobby'; R.picks = {}; R.res = msgx;
  }
  roomPub(); uiRender();
}
function checkPick(p, fmt) {
  const ok = Number.isInteger(p.k) && TYPES[p.k] && !TYPES[p.k].hidden && (fmt !== '2v2' || (!TYPES[p.k].nito && !TYPES[p.k].two && !TYPES[p.k].judo && !TYPES[p.k].nikani));
  if (!ok) return randPick(fmt);
  const W = id => WEAPONS.some(w => w.id === id) ? id : 0, V = id => VEHS.some(v => v.id === id) && !(fmt === '2v2' && id === 5) ? id : 0,
    A = id => ARMS.some(v => v.id === id) ? id : 0, M = id => MINDS.some(v => v.id === id) ? id : 0;
  return { k: p.k, w: W(p.w), wl: W(p.wl), v: V(p.v), a: A(p.a), m: M(p.m), pw: W(p.pw), pv: V(p.pv), pa: A(p.pa), pm: M(p.pm) };
}
function randPick(fmt) {
  const rnd = n => Math.floor(Math.random() * n);
  const cs = TYPES.map((x, i) => i).filter(i => !TYPES[i].hidden && (fmt !== '2v2' || (!TYPES[i].nito && !TYPES[i].two && !TYPES[i].judo && !TYPES[i].nikani)));
  const k = cs[rnd(cs.length)], T = TYPES[k];
  const wl = WEAPONS.filter(w => (!w.aura || T.plain) && !w.lock), vs = fmt === '2v2' ? VEHS.filter(v => v.id !== 5) : VEHS;
  const p = { k, w: wl[rnd(wl.length)].id, wl: T.nito ? wl[rnd(wl.length)].id : 0, v: vs[rnd(vs.length)].id, a: ARMS[rnd(ARMS.length)].id, m: MINDS[rnd(MINDS.length)].id,
    pw: wl[rnd(wl.length)].id, pv: VEHS[rnd(VEHS.length)].id, pa: ARMS[rnd(ARMS.length)].id, pm: MINDS[rnd(MINDS.length)].id };
  if (T.nito || T.zombie || T.nabe || T.buddha) p.v = 0;
  if (T.nito || T.buddha) p.a = 0;
  if (T.zombie) { p.w = 0; p.wl = 0; }
  if (T.alien) { p.w = 0; p.v = 4; }
  if (T.chef) p.w = 14;
  return p;
}
function hostStartSelect() {
  const R = KN.room; if (!R || !KN.host || R.ph !== 'lobby') return;
  if (R.mem.length < FMT[R.fmt].max) return;
  R.ph = 'select'; R.picks = {}; R.selEnd = realNow() + 60000; R.autoAt = 0; R.res = '';
  roomPub(); enterSelect(); uiRender();
}
function maybeStart(force) {
  const R = KN.room; if (!R || !KN.host || R.ph !== 'select') return;
  const all = R.mem.every(m => R.picks[m.s]);
  if (!all && !force) return;
  R.mem.forEach(m => { if (!R.picks[m.s]) R.picks[m.s] = randPick(R.fmt); });
  const F = FMT[R.fmt], picks = [], names = [];
  for (let s = 0; s < F.max; s++) { picks.push(R.picks[s] || randPick(R.fmt)); const m = R.mem.find(x => x.s === s); names.push(m ? m.nm : 'カニ'); }
  const maxRtt = Math.max(0, ...R.mem.filter(m => m.id !== MYID).map(m => m.rtt || 0));
  const D = Math.max(4, Math.min(40, Math.ceil((maxRtt + 50) / TICK)));
  const st = R.st >= 0 ? R.st : Math.floor(Math.random() * STAGES.length);
  R.mid = rid(); R.ph = 'play';
  const sl = {}; R.mem.forEach(m => { sl[m.id] = m.s; });
  const S = { y: 'start', mid: R.mid, seed: (Math.random() * 4294967296) >>> 0, st, fmt: R.fmt, D, picks, nm: names, sl };
  KN.startMsg = S; KN.startSent = realNow();
  net.send(S); roomPub();
  KN.beginLockstep(S);
}
// ---- 参加者側 ----
function guestOnMsg(m, from, via) {
  if (!m || typeof m !== 'object') return;
  KN.lastHost = realNow(); KN.hostId = from; KN.via = via;
  switch (m.y) {
    case 'room': {
      if (KN.room && typeof KN.room.v === 'number' && typeof m.v === 'number' && m.v < KN.room.v && KN.room.code === m.code) return;
      const prev = KN.room; KN.room = m;
      if (LS.on && m.ph === 'lobby' && m.mid && m.mid === LS.mid) { KN.stopLockstep(m.res || '試合が終わりました'); KN.msg = m.res || ''; }
      const me = m.mem.find(x => x.id === MYID);
      if (me) { KN.slot = me.s; KN.fmt = m.fmt; }
      if (me && m.ph === 'select' && !LS.on && !KN.selecting && !KN.picked) enterSelect();
      if (me && m.ph === 'select' && KN.picked && !m.pk.includes(KN.slot) && realNow() - KN.pickSent > 1200) sendPick();
      if (m.ph === 'lobby' && (KN.selecting || KN.picked) && !LS.on) exitSelect();
      if (m.ph === 'select' && typeof m.left === 'number') KN.selDeadline = realNow() + m.left * 1000;
      if (!LS.on && state === 'select' && Number.isInteger(m.st) && m.st >= 0 && m.st < STAGES.length && m.st !== stage) { stage = m.st; applyStage(); }
      if (!prev || prev.ph !== m.ph || prev.ver !== m.ver) uiRender();
      return;
    }
    case 'deny': KN.leave(m.w === 'full' ? 'その部屋はいっぱいです' : m.w === 'busy' ? 'その部屋は試合中です' : m.w === 'ver' ? 'ゲームの版がちがいます。ページを読みなおしてから入ってください' : '入れませんでした'); return;
    case 'start':
      if (typeof m.mid !== 'string' || m.mid === KN.doneMid) return;
      if (LS.on && LS.mid !== m.mid) KN.stopLockstep('');
      if (!LS.on) { if (!KN.room || KN.room.mid !== m.mid) KN.room = Object.assign({}, KN.room || {}, { mid: m.mid, ph: 'play' }); KN.beginLockstep(m); }
      net.send({ y: 'go', mid: m.mid }); return;
    case 'abort': if (LS.on) KN.stopLockstep(m.w || '試合をやめました'); else if (KN.selecting || KN.picked) exitSelect(); KN.msg = m.w || ''; uiRender(); return;
    case 'f': onFrames(m); return;
    case 'snap': onSnap(m); return;
    case 'pkok': return;
    case 'dd': if (LS.on && m.mid === LS.mid && Number.isInteger(m.D)) LS.D = Math.max(2, Math.min(40, m.D)); return;
    case 'ping': net.send({ y: 'pong', t: m.t }); return;
    case 'pong': if (typeof m.t === 'number') { KN.rtts = KN.rtts.concat(realNow() - m.t).slice(-7); KN.rtt = median(KN.rtts); } return;
    case 'bye': KN.leave('ホストが部屋をとじました'); return;
  }
}
function sendPick() { if (!KN.picked) return; net.send({ y: 'pick', s: KN.slot, p: KN.picked }); KN.pickSent = realNow(); }

/* ---------- 選ぶ画面（自分のカニと装備だけ。ゲームの選ぶ画面をそのまま使う） ---------- */
const origPick = window.pickIt, origNewRound = window.newRound, origShowCards = window.showCards;
window.newRound = function (first) {
  if (KN.selecting && !SBD) { onPicked(); return; }
  return origNewRound.apply(this, arguments);
};
window.showCards = function () {
  if (!KN.selecting) return origShowCards.apply(this, arguments);
  const m0 = mode; if (KN.fmt === '2v2') mode = 3;
  try { origShowCards.apply(this, arguments); } finally { mode = m0; }
  const sub = $k('sub');
  if (sub) sub.textContent = 'あなた（' + SLOTS[KN.fmt][KN.slot] + '）' + sub.textContent.replace(/^(1P|2P|3P|4P|あなた|CPU)/, '');
};
window.pickIt = function (i) {
  if (!KN.selecting) return origPick.apply(this, arguments);
  const m0 = mode; mode = 1; cpuSel = false;
  try { return origPick.apply(this, arguments); } finally { if (KN.selecting) mode = m0; }
};
function enterSelect() {
  if (LS.on) return;
  if (!KN.saved) KN.saved = { mode, cpuSel };
  KN.selecting = true; KN.picked = null; KN.slot = KN.slot || 0;
  mode = 1; cpuSel = false; league.on = false;
  if (state !== 'select') { CR().forEach(c => c && scene.remove(c.g)); P = E = P2 = E2 = null; state = 'select'; clearItems(); }
  document.documentElement.classList.add('knet-sel');
  sel.style.display = 'flex';
  setSub();
  sel.scrollTop = 0;
  const R = KN.room; KN.selDeadline = realNow() + ((R && R.left) || 60) * 1000;
  uiRender();
}
function onPicked() {
  KN.selecting = false;
  KN.picked = { k: pk[0], w: pw[0] ? pw[0].id : 0, wl: pwL[0] ? pwL[0].id : 0, v: pv[0], a: pa[0], m: pm[0], pw: pwP[0] ? pwP[0].id : 0, pv: pvP[0], pa: paP[0], pm: pmP[0] };
  $k('cards').innerHTML = '';
  if (KN.host) { const R = KN.room; if (R && R.ph === 'select') { R.picks[KN.slot] = checkPick(KN.picked, R.fmt); roomPub(); maybeStart(); } }
  else sendPick();
  uiRender();
}
function autoPick() {   // 時間切れ：のこりは、でたらめに選ぶ
  for (let i = 0; i < 30 && KN.selecting; i++) {
    const cs = [...document.querySelectorAll('#cards .card')];
    if (!cs.length) break;
    const ok = cs.find(b => b.textContent === 'この2つで決定');
    (ok || cs[Math.floor(Math.random() * cs.length)]).click();
  }
}
function exitSelect() {
  KN.selecting = false; KN.picked = null;
  document.documentElement.classList.remove('knet-sel');
  if (KN.saved) { mode = KN.saved.mode; cpuSel = KN.saved.cpuSel; }
  if (state === 'select') setSub();
  uiRender();
}

/* ---------- 試合（ロックステップの始まりと終わり） ---------- */
KN.beginLockstep = function (S) {
  if (LS.on) return;
  const fmt = S.fmt === '2v2' ? '2v2' : '1v1', n = FMT[fmt].max;
  if (S.sl && Number.isInteger(S.sl[MYID]) && S.sl[MYID] >= 0 && S.sl[MYID] < n) KN.slot = S.sl[MYID];
  KN.selecting = false; KN.picked = null;
  document.documentElement.classList.remove('knet-sel');
  showRules(false); showTier(false);
  // ゲームの状態を、全員同じところからはじめる
  if (P) CR().forEach(c => { if (c) { scene.remove(c.g); if (c.slH) slamEnd(c); } });
  P = E = P2 = E2 = null; clearItems();
  for (const f of fx) scene.remove(f.m); fx.length = 0;
  league.on = false; league.fin = false; cpuSel = false;
  mode = fmt === '2v2' ? 3 : 2; stage = S.st | 0;
  document.querySelectorAll('.sb').forEach(x => x.classList.toggle('on', +x.dataset.s === stage));
  for (let s = 0; s < n; s++) {
    const p = S.picks[s], Wf = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];
    pk[s] = p.k; pw[s] = Wf(p.w); pwL[s] = Wf(p.wl); pv[s] = p.v; pa[s] = p.a; pm[s] = p.m;
    if (s < 2) { pwP[s] = Wf(p.pw); pvP[s] = p.pv; paP[s] = p.pa; pmP[s] = p.pm; }
  }
  score = [0, 0]; t = 0; tmr = 120; shake = 0; endT = 0; fuid = 0; LH[0] = LH[1] = null; LHt[0] = LHt[1] = 0;
  holdT[0] = holdT[1] = 0; swapped[0] = swapped[1] = false; pierce = false; inEvo = false; mini30 = false; noDownF = false;
  camSm.x = 0; camSm.z = 0; camSm.f = 1;
  rainReset();
  for (const k in keys) delete keys[k];
  for (let i = 0; i < 4; i++) { sv[i] = { x: 0, z: 0 }; rh[i] = 0; }
  IN.kd = {}; IN.ev.length = 0; IN.rush = 0; IN.ptr.clear();
  const D0 = Math.max(2, Math.min(60, S.D | 0));
  Object.assign(LS, {
    host: KN.host, fmt, n, slot: KN.slot | 0, D: D0, D0, lastTgt: D0 - 1, lastInp: 0, dT: realNow(), dWait: 0, dLow: 0, tick: 0, base: 1e6, mid: S.mid,
    frames: new Map(), snaps: new Map(), sched: new Map(), inb: [], nf: D0, ackIn: [], gs: new Map(),
    myIn: new Map(), myTop: D0 - 1, sentIn: D0 - 1, hostAck: D0 - 1, lf: D0 - 1, lastSendIn: 0, lastResendIn: 0,
    budget: 0, lastReal: realNow(), lastStep: realNow(), lastFrameAt: realNow(), prevState: '', hh: new Map(), gh: new Map(),
    snapReq: false, snapPend: -1, fixes: 0, fixT: 0, desync: 0, err: 0, endInfo: null, stats: { steps: 0, stall: 0, ms: 0, frames: 0, wait: 0 }, repW: 0, dN: 0, names: S.nm || []
  });
  for (let k = 0; k < n; k++) { LS.inb.push(new Map()); LS.ackIn.push(LS.D - 1); }
  if (KN.host && KN.room) KN.room.mem.forEach(m => { if (m.id !== MYID) LS.gs.set(m.id, { id: m.id, slot: m.s, sent: LS.D - 1, ack: LS.D - 1, rs: 0, lt: 0, lastIn: realNow() }); });
  RNG = mkRng(S.seed | 0);
  SIM.ms = LS.base - TICK;
  simIn();
  try { origNewRound(true); } catch (e) { console.error('[kani net] start', e); } finally { simOut(); }
  last = LS.base - TICK;
  LS.prevState = state;
  LS.on = true;
  document.documentElement.classList.add('knet-play');
  bodyFix();
  KN.ui = 'play'; uiRender();
};
KN.stopLockstep = function (why) {
  if (!LS.on) return;
  if (LS.host) try { sendFrames(true); } catch (e) {}   // 中継のときにまとめて待っているフレームも、送ってから
  LS.on = false; KN.doneMid = LS.mid;
  document.documentElement.classList.remove('knet-play');
  // 選ぶ画面にもどす（試合のあとと同じ片づけ）
  if (P) CR().forEach(c => { if (c) scene.remove(c.g); });
  state = 'select'; P = E = P2 = E2 = null; msg.innerHTML = ''; hud.innerHTML = ''; document.body.className = ''; clearItems(); bgm.stop();
  RNG = null; last = realNow();   // ふつうのループの時計にもどす
  if (KN.saved) { mode = KN.saved.mode; cpuSel = KN.saved.cpuSel; }
  setSub(); sel.style.display = 'flex';
  tagsHide();
  KN.msg = why || '';
  KN.ui = KN.room ? 'room' : 'menu'; uiRender();
};
KN.matchOver = function () {
  const ei = LS.endInfo, R = KN.room;
  const res = ei ? (resText(ei)) : '';
  KN.stopLockstep('');
  KN.msg = res;
  if (KN.host && R) { R.ph = 'lobby'; R.res = res; R.picks = {}; if (R.rand && R.mem.length >= FMT[R.fmt].max) R.autoAt = realNow() + 10000; roomPub(); }
  uiRender();
};
function resText(ei) {
  const fmt = LS.fmt, w = ei.sc[0] > ei.sc[1] ? 0 : ei.sc[1] > ei.sc[0] ? 1 : -1;
  if (w < 0) return `試合終了：${ei.sc[0]} - ${ei.sc[1]}`;
  const names = LS.names || [];
  let who;
  if (fmt === '2v2') who = (w ? '上チーム（' + names[2] + '・' + names[3] + '）' : '下チーム（' + names[0] + '・' + names[1] + '）');
  else who = names[w] || (w ? '2P' : '1P');
  return `試合終了：${who} の勝ち（${ei.sc[0]} - ${ei.sc[1]}）`;
}
KN.hostAbort = function (why) { if (!KN.host) return; net.send({ y: 'abort', w: why }); const R = KN.room; if (R) { R.ph = 'lobby'; R.res = why; R.picks = {}; } KN.stopLockstep(why); roomPub(); };

/* ---------- 毎フレーム（ネット対戦のあいだ：ステップを進めて、1回だけ描く） ---------- */
const g1e = $k('g1'), g2e = $k('g2'), c1e = $k('c1'), c2e = $k('c2'), sd1e = $k('sd1'), sd2e = $k('sd2'), e1e = $k('e1');
KN.frame = function (n) {
  LS.stats.frames++;
  try {
    const now = realNow();
    const el = Math.min(now - LS.lastReal, 500); LS.lastReal = now;
    LS.budget = Math.min(LS.budget + el, Math.max(TICK * 6, el + TICK * 2));
    // 遅れているときは速く進める（届いているフレームが多いほど）。描くのが遅い端末では、1回に何ステップも進める
    let ahead = 0; if (!LS.host) { let x = LS.tick; while (LS.frames.has(x)) x++; ahead = x - LS.tick; }
    if (ahead > LS.D + 6) LS.budget += TICK * Math.min(4, Math.max(1, Math.floor((ahead - LS.D) / 8)));
    let maxSteps = Math.min(15, Math.max(4, Math.ceil(el / TICK) + 1));
    if (ahead > 20) maxSteps = Math.max(maxSteps, 8);
    let steps = 0;
    while (LS.on && LS.budget >= TICK - 0.5 && steps < maxSteps && canStep(LS.tick)) { stepOnce(); LS.budget -= TICK; steps++; }
    if (LS.on && LS.budget >= TICK - 0.5 && steps < maxSteps && !canStep(LS.tick)) LS.stats.wait++;   // 進めたいのに、フレーム（だれかの入力）を待っている
    if (LS.on) {
      if (steps) LS.lastStep = now; else if (now - LS.lastStep > 300) LS.stats.stall++;
      if (LS.host) sendFrames(false); else sendInputs(false);
      uiPlay(now);
    }
    try { ren.render(scene, cam); } catch (e) {}
    tagsMove();
  } finally { NAT.raf.call(window, window.loop); }
};
function myCrab() { return LS.on ? crabOf(LS.slot) : null; }
function partnerOf(slot) { return LS.fmt === '2v2' ? null : slot === 0 ? P2 : E2; }
function bodyWant() {
  const cls = document.body.className;
  if (!/\bplay\b/.test(cls)) return null;
  const c = myCrab(), pt = partnerOf(LS.slot);
  let s = 'play m1';
  if (c) { if (c.T.nito) s += ' n1'; if (c.T.two || (pt && pt.T.two)) s += ' i1'; if (c.T.three) s += ' j1'; }
  if (LS.fmt === '2v2') s += ' knet3';
  return s;
}
function bodyFix() { if (!LS.on) return; const w = bodyWant(); if (w && document.body.className !== w) document.body.className = w; }
new MutationObserver(bodyFix).observe(document.body, { attributes: true, attributeFilter: ['class'] });
function uiPlay(now) {
  const c = myCrab(), pl = state === 'play';
  if (g1e) { g1e.textContent = c && c.prey ? '吐き出す！' : c && c.mh ? '脱出！' : c && c.hid ? '家から出る！' : 'つかむ！'; g1e.style.display = c && ((c.T.judo && c.gOpen > 0) || c.prey || c.mh || c.hid) && pl ? 'block' : 'none'; }
  if (g2e) g2e.style.display = 'none';
  if (c1e) c1e.style.display = c && CARI(c) && pl ? 'block' : 'none';
  if (c2e) c2e.style.display = 'none';
  if (sd1e) { sd1e.style.width = '100%'; sd1e.style.opacity = c && c.blind > 0 ? .9 : 0; }
  if (sd2e) sd2e.style.opacity = 0;
  if (e1e && c) e1e.textContent = c.T.two ? 'EVO1' : 'EVO';
  if ((state === 'round' || state === 'match') && /タップ ?か Enter で(つぎ|次)へ/.test(msg.innerHTML))
    msg.innerHTML = msg.innerHTML.replace(/タップ ?か Enter で(つぎ|次)へ/, state === 'match' ? 'まもなく部屋にもどります' : 'まもなくつぎへ');
  const b = $k('knetBadge');
  if (b) {
    const stall = now - LS.lastStep > 400;
    const rtt = LS.host ? Math.max(0, ...(KN.room ? KN.room.mem.filter(m => m.id !== MYID).map(m => m.rtt || 0) : [0])) : KN.rtt;
    const txt = stall ? `🌐 ${SLOTS[LS.fmt][LS.slot]}・<b>通信待ち…</b>` : `🌐 ${SLOTS[LS.fmt][LS.slot]}・${Math.round(rtt)}ms`;
    if (b._t !== txt) { b._t = txt; $k('knetBadgeT').innerHTML = txt; }
  }
}
// 名前の札（カニの上）
const TAGS = [];
function tagsMove() {
  if (!LS.on || !P) { tagsHide(); return; }
  for (let k = 0; k < LS.n; k++) {
    let el = TAGS[k];
    if (!el) { el = TAGS[k] = document.createElement('div'); el.className = 'knet-tag'; document.body.appendChild(el); }
    const c = crabOf(k);
    if (!c || c.gone || c.fall > .5) { el.style.display = 'none'; continue; }
    const v = new THREE.Vector3(c.x, (c.r || 26) * 2.2 + 18, c.z).project(cam);
    const nm = k === LS.slot ? 'あなた' : (LS.names[k] || SLOTS[LS.fmt][k]);
    if (el._n !== nm) { el._n = nm; el.textContent = nm; el.classList.toggle('me', k === LS.slot); el.classList.toggle('t1', LS.fmt === '2v2' ? k >= 2 : k === 1); }
    el.style.display = 'block'; el.style.left = ((v.x * .5 + .5) * innerWidth) + 'px'; el.style.top = ((-v.y * .5 + .5) * innerHeight) + 'px';
  }
}
function tagsHide() { TAGS.forEach(el => { if (el) el.style.display = 'none'; }); }

/* ---------- 定期の仕事（1秒ごと：ping・いなくなった人・選ぶ時間・ランダムの募集） ---------- */
setInterval(() => {
  if (!net.L) return;
  const now = realNow(), R = KN.room;
  net.send({ y: 'ping', t: now });
  if (KN.host && R) {
    for (const m of R.mem.slice()) if (m.id !== MYID && now - m.last > (LS.on ? 9000 : 15000)) memberGone(m, 'lost');
    if (R.ph === 'select' && now > R.selEnd + 6000) maybeStart(true);
    if (LS.on && LS.host) adaptD(now);
    if (LS.on && LS.host) for (const g of LS.gs.values()) if (now - g.lastIn > 12000) { const m = R.mem.find(x => x.id === g.id); KN.hostAbort(`${m ? m.nm : 'だれか'} さんの通信が止まったので、試合をやめました`); break; }
    if (R.ph === 'play' && LS.on && KN.startMsg && now - KN.startSent > 1000) {
      const yet = R.mem.filter(m => m.id !== MYID && m.go !== R.mid);
      if (yet.length && LS.tick < 600) { net.send(KN.startMsg); KN.startSent = now; }
    }
    if (R.ph === 'lobby' && R.autoAt && now >= R.autoAt) { R.autoAt = 0; if (R.mem.length >= FMT[R.fmt].max) hostStartSelect(); }
    if (R.rand && R.ph === 'lobby' && R.mem.length < FMT[R.fmt].max && now - KN.adT > 2000) advertise();
    if (!LS.on && (R.ph !== 'play') && now - (KN.lastPub || 0) > 2000) { KN.lastPub = now; roomPub(); }
    else if (LS.on && now - (KN.lastPub || 0) > 5000) { KN.lastPub = now; roomPub(); }
  } else if (R) {
    if (now - KN.lastHost > (LS.on ? 9000 : 15000)) { KN.leave('ホストとの通信が切れました'); return; }
    if (LS.on && now - LS.lastFrameAt > 20000) KN.stopLockstep('ホストからの通信が止まったので、試合をやめました');
    const me = R.mem && R.mem.find(x => x.id === MYID);
    if (!me) net.send({ y: 'hello', nm: KN.me.nm, b: BUILD, p: PROTO });
  }
  if (KN.selecting && now > KN.selDeadline) autoPick();
  if (!LS.on) uiRender(true);
}, 1000);

/* ---------- 部屋をつくる・入る・ランダム ---------- */
function newCode() { return String(1000 + Math.floor(Math.random() * 9000)); }
KN.create = async function (fmt, rand) {
  if (KN.busy) return; KN.busy = true; KN.msg = ''; KN.ui = 'wait'; KN.waitText = '部屋をつくっています…'; uiRender();
  KN.me.nm = myName(); lsSet('kani_name', KN.me.nm);
  try {
    let L = null, code = '';
    for (let i = 0; i < 6 && !L; i++) {
      code = newCode();
      try { L = await linkHost(code, hostOnMsg); } catch (e) { if (!e || e.code !== 'taken') throw e; }
    }
    if (!L) throw { code: 'taken' };
    net.L = L; KN.host = true; KN.code = code; KN.fmt = fmt; KN.slot = 0; KN.rand = !!rand;
    KN.room = roomNew(code, fmt, rand); KN.room.mem[0].nm = KN.me.nm;
    KN.ui = 'room'; roomPub();
    if (rand) advertise();
  } catch (e) {
    KN.msg = e && e.code === 'offline' ? 'つながりませんでした（PeerJS と中継サーバーの両方につながりません）' : '部屋をつくれませんでした';
    KN.ui = 'menu';
  }
  KN.busy = false; uiRender();
};
KN.join = async function (code, quiet) {
  if (KN.busy && !quiet) return false;
  code = String(code || '').replace(/\D/g, '').slice(0, 4);
  if (code.length !== 4) { KN.msg = '部屋コードは4けたの数字です'; uiRender(); return false; }
  KN.busy = true; KN.msg = ''; KN.ui = 'wait'; KN.waitText = `部屋 ${code} に入っています…`; uiRender();
  KN.me.nm = myName(); lsSet('kani_name', KN.me.nm);
  let L = null;
  try { L = await linkGuest(code, guestOnMsg); } catch (e) { L = null; }
  if (!L) { KN.busy = false; KN.msg = '入れませんでした'; KN.ui = 'menu'; uiRender(); return false; }
  net.L = L; KN.host = false; KN.code = code; KN.room = null; KN.lastHost = realNow();
  const t0 = realNow();
  while (realNow() - t0 < 15000 && net.L === L) {
    net.send({ y: 'hello', nm: KN.me.nm, b: BUILD, p: PROTO });
    await wait(700);
    if (KN.room && KN.room.mem && KN.room.mem.some(x => x.id === MYID)) break;
  }
  KN.busy = false;
  if (net.L !== L) return false;   // 断られた
  if (!(KN.room && KN.room.mem && KN.room.mem.some(x => x.id === MYID))) { L.close(); net.L = null; KN.room = null; KN.msg = `部屋 ${code} が見つかりませんでした`; KN.ui = 'menu'; uiRender(); return false; }
  KN.ui = 'room'; uiRender(); return true;
};
KN.leave = function (why) {
  if (LS.on) KN.stopLockstep('');
  if (KN.selecting || KN.picked) exitSelect();
  if (net.L) { try { net.send({ y: 'bye' }); } catch (e) {} const L = net.L; setTimeout(() => L.close(), 150); }
  net.L = null; KN.room = null; KN.host = false; KN.code = ''; KN.rand = false; KN.startMsg = null;
  if (KN.seekUnsub) { KN.seekUnsub(); KN.seekUnsub = null; }
  if (KN.saved) { mode = KN.saved.mode; cpuSel = KN.saved.cpuSel; KN.saved = null; document.querySelectorAll('.mb').forEach(x => x.classList.toggle('on', +x.dataset.m === mode)); if (state === 'select') setSub(); }
  KN.msg = why || ''; KN.ui = why ? 'menu' : 'off'; uiRender();
};
// ランダム：募集中の部屋をさがして入る。なければ部屋をつくって待つ
function advertise() {
  const R = KN.room; if (!R || !KN.host || !R.rand) return;
  KN.adT = realNow();
  MQ.pub(`${PFX}/lobby/${R.fmt}`, { y: 'open', code: R.code, f: R.fmt, n: R.mem.length, max: FMT[R.fmt].max, t0: R.t0, host: MYID, b: BUILD });
}
KN.random = async function (fmt) {
  if (KN.busy) return; KN.busy = true; KN.msg = ''; KN.ui = 'wait'; KN.waitText = 'あいてをさがしています…'; uiRender();
  KN.me.nm = myName(); lsSet('kani_name', KN.me.nm);
  const ok = Q.get('knet') === 'bc' ? false : await MQ.ready(8000);
  if (!ok) { KN.busy = false; KN.msg = 'ランダムは使えません（中継サーバーにつながりません）。部屋コードで遊んでください'; KN.ui = 'menu'; uiRender(); return; }
  const topic = `${PFX}/lobby/${fmt}`, found = new Map();
  const un = MQ.sub(topic, m => {
    if (!m || typeof m !== 'object') return;
    if (m.y === 'open' && m.f === fmt && m.host !== MYID && m.b === BUILD && m.n < m.max) found.set(m.code, m);
    if (m.y === 'q' && KN.host && KN.room && KN.room.rand && KN.room.fmt === fmt) advertise();
    // 自分も部屋を出して待っているとき：もっと古い部屋があれば、そっちへ移る
    if (m.y === 'open' && KN.host && KN.room && KN.room.rand && KN.room.ph === 'lobby' && KN.room.mem.length === 1 && m.f === fmt && m.host !== MYID && m.b === BUILD && m.n < m.max
      && (m.t0 < KN.room.t0 || (m.t0 === KN.room.t0 && m.code < KN.room.code)) && !KN.moving) {
      KN.moving = true;
      const code = m.code;
      setTimeout(async () => { KN.leave(''); KN.ui = 'wait'; KN.waitText = 'あいてが見つかりました…'; uiRender(); KN.busy = false; await KN.join(code); KN.moving = false; }, 50);
    }
  });
  KN.seekUnsub = un;
  MQ.pub(topic, { y: 'q', f: fmt });
  await wait(2500);
  const list = [...found.values()].sort((a, b) => (b.n - a.n) || (a.t0 - b.t0));
  KN.busy = false;
  for (const r of list) { if (await KN.join(r.code, true)) { if (KN.room) KN.room.rand = true; return; } }
  await KN.create(fmt, true);
  KN.seekUnsub = un;
};

/* ---------- 画面 ---------- */
const CSS = `
#knet{position:fixed;inset:0;z-index:40;background:#000c;display:none;overflow:auto;touch-action:pan-y;padding:12px;box-sizing:border-box}
#knet.on{display:block}
#knet .rbox{max-width:560px}
#knet h2{margin:2px 0 10px;font-size:26px}
#knet .knet-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
#knet .card{width:auto;padding:8px 14px;font-size:15px;text-align:center}
#knet .card.big{font-size:18px;padding:12px 18px;flex:1 1 140px}
#knet .card:disabled{opacity:.45;cursor:default}
#knet input,#knet select{font:700 16px "Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif;padding:8px 10px;border-radius:10px;border:2px solid #fff6;background:#0b3f52;color:#fff;min-width:0}
#knet input#knetCode{width:7em;letter-spacing:.15em;text-align:center}
#knet .knet-code{font-size:15px;margin:4px 0 8px}#knet .knet-code b{font:32px "Dela Gothic One","Hiragino Sans",sans-serif;letter-spacing:.12em;margin:0 6px;color:#ffd166}
#knet ul.knet-mem{list-style:none;padding:0;margin:6px 0}
#knet ul.knet-mem li{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:10px;background:#ffffff14;margin:4px 0}
#knet ul.knet-mem li.me{outline:2px solid #ffd166}
#knet ul.knet-mem li.empty{opacity:.5}
#knet ul.knet-mem small{opacity:.75;font-size:12px}
#knet .knet-team{font-size:13px;color:#9fe3ee;margin-top:8px}
#knet .knet-msg{min-height:1.2em;color:#ffd166;margin-top:8px;font-size:14px}
#knet .knet-note{font-size:12px;opacity:.8;line-height:1.6;margin:8px 0 0}
#knet .knet-x{position:sticky;top:0;float:right;background:#e0452f;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:700 15px "Zen Maru Gothic",sans-serif;cursor:pointer}
#axNet{display:flex;justify-content:center}
#axNet .card{width:auto;padding:10px 18px;font-size:17px;border-color:#ffd166}
#knetSel{display:none;flex:none;max-width:960px;text-align:center;background:#ffd16622;border:2px solid #ffd166;border-radius:12px;padding:8px 14px;font:700 15px "Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif}
html.knet-sel #knetSel{display:block}
html.knet-sel #modes,html.knet-sel #stages,html.knet-sel #axNet,html.knet-sel #axBack,html.knet-sel #sel>div:last-child{display:none!important}
html.knet-play #q3{display:none!important}
html.knet-play #knetBadge{display:flex}
#knetBadge{position:fixed;left:50%;transform:translateX(-50%);top:calc(68px + env(safe-area-inset-top,0px));z-index:7;display:none;align-items:center;background:#0009;color:#fff;border-radius:999px;padding:2px 9px;font:700 11px "Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif;white-space:nowrap;cursor:pointer;pointer-events:auto}
#knetBadge b{color:#ffd166}
.knet-tag{position:fixed;transform:translate(-50%,-100%);z-index:4;pointer-events:none;font:700 12px "Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif;color:#fff;background:#1c5b72cc;border-radius:8px;padding:1px 7px;white-space:nowrap;display:none}
.knet-tag.t1{background:#a83232cc}.knet-tag.me{outline:2px solid #ffd166}
body.knet3 .h3{display:block}body.knet3 #h2,body.knet3 #h3{transform:none}
body.knet3 .wr,body.knet3 .ib{display:none!important}
body.knet3 #h0{left:3vw;top:calc(40px + env(safe-area-inset-top,0px));bottom:auto}body.knet3 #h1{left:3vw;top:calc(110px + env(safe-area-inset-top,0px));bottom:auto;right:auto;text-align:left}
body.knet3 #h2{right:3vw;left:auto;top:calc(40px + env(safe-area-inset-top,0px));text-align:right}body.knet3 #h3{right:3vw;top:calc(110px + env(safe-area-inset-top,0px));text-align:right}
`;
const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
const ov = document.createElement('div'); ov.id = 'knet';
ov.innerHTML = '<div class="rbox"><button class="knet-x" type="button" data-k="close">✕ とじる</button><h2 class="t">🌐 ネット対戦</h2><div id="knetBody"></div><div id="knetMsg" class="knet-msg"></div></div>';
document.body.appendChild(ov);
const badge = document.createElement('div'); badge.id = 'knetBadge';
badge.innerHTML = '<span id="knetBadgeT"></span>';
badge.title = 'タップすると、試合をやめて部屋を出られます';
document.body.appendChild(badge);
const selBar = document.createElement('div'); selBar.id = 'knetSel';
{ const h1 = sel.querySelector('h1'); if (h1) h1.after(selBar); else sel.prepend(selBar); }
// 入口のボタン（選ぶ画面）
{ const ent = $k('axNet'); if (ent) ent.querySelector('button').onclick = () => KN.open(); }
KN.open = function () { if (!net.L) KN.ui = 'menu'; else KN.ui = LS.on ? 'play' : 'room'; uiRender(); };
const fmtSel = () => (lsGet('kani_fmt') === '2v2' ? '2v2' : '1v1');
let lastRender = '';
function uiRender(soft) {
  ov.classList.toggle('on', KN.ui === 'menu' || KN.ui === 'wait' || (KN.ui === 'room' && !LS.on && !KN.selecting && !KN.picked));
  const body = $k('knetBody'), mm = $k('knetMsg');
  let h = '';
  if (KN.ui === 'menu') {
    const f = fmtSel();
    h = `<div class="knet-row"><label>なまえ <input id="knetName" maxlength="12" value="${esc(KN.me.nm)}" placeholder="カニ" autocomplete="off"></label></div>
      <div class="knet-row"><button class="card knet-f ${f === '1v1' ? 'on' : ''}" type="button" data-f="1v1">1対1</button><button class="card knet-f ${f === '2v2' ? 'on' : ''}" type="button" data-f="2v2">2v2（4人）</button></div>
      <div class="knet-row"><button class="card big" type="button" data-k="create">部屋をつくる</button><button class="card big" type="button" data-k="random">ランダム</button></div>
      <div class="knet-row"><input id="knetCode" inputmode="numeric" maxlength="4" placeholder="1234" autocomplete="off"><button class="card" type="button" data-k="join">コードで入る</button></div>
      <p class="knet-note">「部屋をつくる」と4けたの部屋コードが出ます。友だちは「コードで入る」にそのコードを入れます。「ランダム」は、同じ形（1対1・2v2）で相手をさがしている人と組みます。<br>それぞれ自分の端末で、自分のカニと装備を選んで戦います（所持金は使いません）。通信が遅いと、操作が少しおくれて届きます。</p>`;
  } else if (KN.ui === 'wait') {
    h = `<p>${esc(KN.waitText || 'つないでいます…')}</p><div class="knet-row"><button class="card" type="button" data-k="cancel">やめる</button></div>`;
  } else if (KN.ui === 'room' && KN.room) {
    const R = KN.room, F = FMT[R.fmt] || FMT['1v1'], mem = R.mem || [], names = SLOTN[R.fmt] || SLOTN['1v1'];
    const li = s => { const m = mem.find(x => x.s === s); if (!m) return `<li class="empty"><span>${names[s]}</span><span>あき</span></li>`;
      const r = m.id === MYID ? '' : KN.host ? (m.rtt ? Math.round(m.rtt) + 'ms' : '') : (m.s === 0 ? (KN.rtt ? Math.round(KN.rtt) + 'ms' : '') : '');
      return `<li class="${m.id === MYID ? 'me' : ''}"><span>${names[s]}　<b>${esc(m.nm)}</b>${m.id === MYID ? ' <small>（あなた）</small>' : ''}${m.s === 0 ? ' <small>ホスト</small>' : ''}</span><small>${(R.pk || Object.keys(R.picks || {}).map(Number)).includes(s) && R.ph === 'select' ? '選んだ ' : ''}${r}</small></li>`; };
    const lis = R.fmt === '2v2' ? `<div class="knet-team">下チーム</div><ul class="knet-mem">${li(0)}${li(1)}</ul><div class="knet-team">上チーム</div><ul class="knet-mem">${li(2)}${li(3)}</ul>` : `<ul class="knet-mem">${li(0)}${li(1)}</ul>`;
    const full = mem.length >= F.max;
    let ctl = '';
    if (KN.host && R.ph === 'lobby') {
      ctl = `<div class="knet-row"><label>ステージ <select id="knetStage"><option value="-1"${R.st < 0 ? ' selected' : ''}>おまかせ</option>${STAGES.map((s, i) => `<option value="${i}"${R.st === i ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>${R.fmt === '2v2' ? '<button class="card" type="button" data-k="shuffle">チームをシャッフル</button>' : ''}</div>
        <div class="knet-row"><button class="card big" type="button" data-k="start" ${full ? '' : 'disabled'}>${full ? '対戦スタート' : `あと ${F.max - mem.length} 人`}</button></div>`;
      if (R.autoAt) ctl += `<p class="knet-note">${Math.max(0, Math.ceil((R.autoAt - realNow()) / 1000))} 秒後に自動でスタートします</p>`;
    } else if (R.ph === 'lobby') {
      ctl = `<p class="knet-note">${full ? 'ホストがスタートするのを待っています' : `あと ${F.max - mem.length} 人そろうのを待っています`}${R.auto ? `（${R.auto} 秒後に自動でスタート）` : ''}　ステージ：${R.st >= 0 ? esc(STAGES[R.st]) : 'おまかせ'}</p>`;
    } else if (R.ph === 'select') ctl = '<p class="knet-note">選んでいます…</p>';
    else if (R.ph === 'play') ctl = '<p class="knet-note">試合中です</p>';
    h = `<div class="knet-code">部屋<b>${esc(R.code)}</b>${F.name}${R.rand ? '（ランダム）' : ''}</div>${lis}${R.res ? `<p>${esc(R.res)}</p>` : ''}${ctl}
      <div class="knet-row"><button class="card" type="button" data-k="leave">部屋を出る</button></div>
      <p class="knet-note">友だちには、このページで「🌐 ネット対戦」→「コードで入る」に <b>${esc(R.code)}</b> を入れてもらいます。</p>`;
  }
  if (KN.ui !== 'room' || !soft || (document.activeElement && document.activeElement.id !== 'knetStage')) {
    if (h !== lastRender) { lastRender = h; body.innerHTML = h; }
  }
  mm.textContent = KN.msg || '';
  // 選ぶ画面の上の帯
  if (KN.selecting || KN.picked) {
    const R = KN.room, left = Math.max(0, Math.ceil((KN.selDeadline - realNow()) / 1000));
    const done = R && R.pk ? R.pk.length : R && R.picks ? Object.keys(R.picks).length : 0, all = R && R.mem ? R.mem.length : 0;
    selBar.innerHTML = KN.selecting ? `🌐 ネット対戦（部屋 ${esc(KN.code)}）：あなたは <b>${SLOTN[KN.fmt][KN.slot]}</b>。カニと装備を選んでください（のこり ${left} 秒）`
      : `🌐 選びおわりました。ほかの人を待っています（${done}/${all}）`;
  }
}
ov.addEventListener('click', e => {
  const b = e.target.closest('[data-k],[data-f]'); if (!b) return;
  if (b.dataset.f) { lsSet('kani_fmt', b.dataset.f); lastRender = ''; uiRender(); return; }
  const k = b.dataset.k;
  if (k === 'close') { if (net.L && !confirm('部屋を出ますか？')) return; KN.leave(''); }
  else if (k === 'create') KN.create(fmtSel(), false);
  else if (k === 'random') KN.random(fmtSel());
  else if (k === 'join') KN.join($k('knetCode').value);
  else if (k === 'cancel') KN.leave('');
  else if (k === 'leave') { if (confirm('部屋を出ますか？')) KN.leave(''); }
  else if (k === 'start') hostStartSelect();
  else if (k === 'shuffle') { const R = KN.room; if (R && KN.host && R.ph === 'lobby') { const sl = [0, 1, 2, 3].sort(() => Math.random() - .5); R.mem.forEach((m, i) => { m.s = sl[i]; }); const me = R.mem.find(m => m.id === MYID); KN.slot = me ? me.s : 0; roomPub(); lastRender = ''; uiRender(); } }
});
ov.addEventListener('change', e => {
  if (e.target.id === 'knetStage' && KN.host && KN.room) { KN.room.st = +e.target.value; if (KN.room.st >= 0) { stage = KN.room.st; applyStage(); } roomPub(); }
  if (e.target.id === 'knetName') { KN.me.nm = myName(); lsSet('kani_name', KN.me.nm); }
});
// 部屋の画面のキーは、ゲームに渡さない（スペース・Enter を入力欄で使えるように）
ov.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'knetCode') { e.preventDefault(); KN.join(e.target.value); } });
ov.addEventListener('keyup', e => e.stopPropagation());
badge.addEventListener('click', () => { if (confirm('試合をやめて、部屋を出ますか？')) KN.leave(''); });
addEventListener('pagehide', () => { if (net.L) try { net.send({ y: 'bye' }); } catch (e) {} });
// デッキで1人用を始めるボタンは、部屋にいるあいだは使わない
{ const dg = $k('deckGo'); if (dg) { const f0 = dg.onclick; dg.onclick = function () { if (net.L) { alert('ネット対戦の部屋にいるあいだは使えません'); return; } return f0 && f0.apply(this, arguments); }; } }

/* ---------- PCのキーの案内（ネット対戦のとき） ---------- */
KN.keysHTML = function () {
  if (!LS.on) return null;
  const K = x => '<kbd>' + x + '</kbd>', c = myCrab(); if (!c) return '';
  let s = '移動 ' + K('WASD') + '/' + K('矢印') + '　はさむ ' + K('Space') + '/左クリック　なげる ' + K('G') + '/右クリック　とっしん ' + K('Shift') + ' 長押し　' + (c.T.two ? 'EVO1' : 'EVO') + ' ' + K('E');
  if (c.T.two || (partnerOf(LS.slot) && partnerOf(LS.slot).T.two)) s += '　EVO2 ' + K('Q');
  if (c.T.three) s += '　EVO3 ' + K('R');
  if (c.T.nito) s += '　左手 ' + K('V') + ' はさむ・' + K('B') + ' なげる';
  return s;
};

window.KNET = { KN, LS, MQ, net, BUILD, MYID, stateHash, DMATH, setD, get rng() { return RNG; } };
})();

