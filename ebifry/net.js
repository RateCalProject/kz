/* ===== 空飛ぶエビフライ：ネット対戦（風の芽経済組で足したもの） =====
   ゲームの本体（ebifry/index.html の中身）には手を入れず、外から動かす。最大6人の乱戦（全員が敵）。CPU を足せる。
   しくみ：ロックステップ。全員の端末で同じ World（1/60秒ずつ）を動かして、やりとりするのは入力だけ。
   - World.step と CPU の考えるところのあいだだけ、Math.sin などを「どの端末・ブラウザでも同じ答えの計算」に入れかえる
   - 自分のエビは、どの端末でも World の中では 'p1'（ゲームの画面が 'p1' を「自分」として描くので）。ほかは 'f<番号>'
   - 自分の入力は D ステップ後の入力として全員に送り、全員が同じステップで使う。ホストが全員の入力をまとめて「フレーム」にして配る
   - 0.5秒ごとに状態のハッシュをくらべ、ずれたらホストの値で直す
   つなぎ方：PeerJS（端末どうしを直接）＋ 近くの中継（Supabase Realtime）＋ 公開MQTTサーバー（遠い中継）。部屋コード（4けた）とランダム
   - ホストが人ごとに、道ごとの往復の時間をはかって、いちばん速い道を選んで相手に知らせる（試合の通信だけ。ほかはいつもの道） */
(() => {
'use strict';
if (window.ENET || typeof World !== 'function' || typeof G !== 'object' || typeof R !== 'object') return;
const DMATH = /* 決まった計算の Math（どの端末・ブラウザでも同じ答えになるように、+ − × ÷ と sqrt だけで計算する。fdlibm / musl の方法をもとにしたもの） */
(() => {
  const dv = new DataView(new ArrayBuffer(8));
  const hiw = x => { dv.setFloat64(0, x); return dv.getUint32(0); };
  const low = x => { dv.setFloat64(0, x); return dv.getUint32(4); };
  const mk = (h, l) => { dv.setUint32(0, h >>> 0); dv.setUint32(4, l >>> 0); return dv.getFloat64(0); };
  const sqrt = Math.sqrt, abs = Math.abs, floor = Math.floor;
  // 2^k（かけ算だけで。ぴったり）
  function pow2(k) {
    let r = 1;
    if (k > 0) { while (k >= 30) { r *= 1073741824; k -= 30; } r *= (1 << k); }
    else if (k < 0) { k = -k; while (k >= 30) { r /= 1073741824; k -= 30; } r /= (1 << k); }
    return r;
  }
  function scalbn(y, k) {
    if (k > 1023) { y *= pow2(1023); k -= 1023; if (k > 1023) { y *= pow2(1023); k -= 1023; if (k > 1023) k = 1023; } }
    else if (k < -1022) { y *= pow2(-1022) * pow2(53); k += 1022 - 53; if (k < -1022) { y *= pow2(-1022) * pow2(53); k += 1022 - 53; if (k < -1022) k = -1022; } }
    return y * pow2(k);
  }
  // ---- sin・cos ----
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
    S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
    C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  function ksin(x, y, iy) {
    const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * x;
    if (iy === 0) return x + v * (S1 + z * r);
    return x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }
  function kcos(x, y) {
    const z = x * x; let w = z * z;
    const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    const hz = 0.5 * z; w = 1.0 - hz;
    return w + (((1.0 - w) - hz) + (z * r - x * y));
  }
  const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
    pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
  let RY0 = 0, RY1 = 0;
  // x を (π/2)×n＋(RY0+RY1) に分ける。n を返す（|x| が 1e9 くらいまでは十分な精度）
  function rem(x) {
    const fn = floor(x * invpio2 + 0.5);
    let r = x - fn * pio2_1, w = fn * pio2_1t, t;
    t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w);
    t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w);
    RY0 = r - w; RY1 = (r - RY0) - w;
    return fn;
  }
  const BIG = 1e9, TWO_PI = 6.283185307179586;
  function sin(x) {
    x = +x;
    if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
    if (abs(x) > BIG) x = x % TWO_PI;
    if (abs(x) <= 7.85398163397448278999e-01) { if (abs(x) < 7.450580596923828e-9) return x; return ksin(x, 0, 0); }
    const n = rem(x), m = ((n % 4) + 4) % 4;
    return m === 0 ? ksin(RY0, RY1, 1) : m === 1 ? kcos(RY0, RY1) : m === 2 ? -ksin(RY0, RY1, 1) : -kcos(RY0, RY1);
  }
  function cos(x) {
    x = +x;
    if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
    if (abs(x) > BIG) x = x % TWO_PI;
    if (abs(x) <= 7.85398163397448278999e-01) { if (abs(x) < 7.450580596923828e-9) return 1; return kcos(x, 0); }
    const n = rem(x), m = ((n % 4) + 4) % 4;
    return m === 0 ? kcos(RY0, RY1) : m === 1 ? -ksin(RY0, RY1, 1) : m === 2 ? -kcos(RY0, RY1) : ksin(RY0, RY1, 1);
  }
  function tan(x) { const c = cos(x); return sin(x) / c; }
  // ---- atan・atan2 ----
  const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
  function atan(x) {
    x = +x;
    if (!(x === x)) return NaN;
    const neg = x < 0 || (x === 0 && 1 / x < 0);
    let ax = abs(x), id;
    if (ax >= 7.378697629483821e19) { const z = atanhi[3]; return neg ? -z : z; }
    if (ax < 0.4375) { if (ax < 7.450580596923828e-9) return x; id = -1; }
    else if (ax < 1.1875) {
      if (ax < 0.6875) { id = 0; ax = (2.0 * ax - 1.0) / (2.0 + ax); }
      else { id = 1; ax = (ax - 1.0) / (ax + 1.0); }
    } else {
      if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1.0 + 1.5 * ax); }
      else { id = 3; ax = -1.0 / ax; }
    }
    if (id < 0) ax = x;
    const z = ax * ax, w = z * z;
    const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10]))))),
      s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
    if (id < 0) return ax - ax * (s1 + s2);
    const r = atanhi[id] - ((ax * (s1 + s2) - atanlo[id]) - ax);
    return neg ? -r : r;
  }
  const PI = 3.1415926535897931160E+00, PI_LO = 1.2246467991473531772E-16;
  function atan2(y, x) {
    y = +y; x = +x;
    if (!(x === x) || !(y === y)) return NaN;
    if (x === 1) return atan(y);
    const sy = y < 0 || (y === 0 && 1 / y < 0), sx = x < 0 || (x === 0 && 1 / x < 0), m = (sy ? 1 : 0) | (sx ? 2 : 0);
    if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI : -PI;
    if (x === 0) return sy ? -PI / 2 : PI / 2;
    if (x === Infinity || x === -Infinity) {
      if (y === Infinity || y === -Infinity) return m === 0 ? PI / 4 : m === 1 ? -PI / 4 : m === 2 ? 3 * PI / 4 : -3 * PI / 4;
      return m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI : -PI;
    }
    if (y === Infinity || y === -Infinity) return sy ? -PI / 2 : PI / 2;
    const q = abs(y / x);
    if (q > 1.8446744073709552e19) return sy ? -PI / 2 : PI / 2;
    const z = (sx && q < 5.421010862427522e-20) ? 0 : atan(q);
    return m === 0 ? z : m === 1 ? -z : m === 2 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
  }
  function asin(x) { x = +x; if (!(abs(x) <= 1)) return NaN; if (x === 1) return PI / 2; if (x === -1) return -PI / 2; return atan2(x, sqrt((1 - x) * (1 + x))); }
  function acos(x) { x = +x; if (!(abs(x) <= 1)) return NaN; if (x === 1) return 0; if (x === -1) return PI; return atan2(sqrt((1 - x) * (1 + x)), x); }
  // ---- exp ----
  const ln2hi = 6.93147180369123816490e-01, ln2lo = 1.90821492927058770002e-10, invln2 = 1.44269504088896338700e+00,
    P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
  function exp(x) {
    x = +x;
    if (!(x === x)) return NaN;
    if (x > 709.782712893383973096) return Infinity;
    if (x < -745.13321910194110842) return 0;
    let hi, lo, k;
    const ax = abs(x);
    if (ax > 0.34657359027997264) {
      if (ax >= 1.0397207708399179) k = x < 0 ? -floor(-x * invln2 + 0.5) : floor(x * invln2 + 0.5);
      else k = x < 0 ? -1 : 1;
      hi = x - k * ln2hi; lo = k * ln2lo; x = hi - lo;
    } else if (ax > 3.725290298461914e-9) { k = 0; hi = x; lo = 0; }
    else return 1 + x;
    const xx = x * x, c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
    const y = 1 + (x * c / (2 - c) - lo + hi);
    return k === 0 ? y : scalbn(y, k);
  }
  // ---- log ----
  const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01,
    Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
  function log(x) {
    x = +x;
    if (!(x === x) || x < 0) return NaN;
    if (x === 0) return -Infinity;
    if (x === Infinity) return Infinity;
    if (x === 1) return 0;
    let k = 0;
    if (x < 2.2250738585072014e-308) { k -= 54; x *= 18014398509481984; }
    let hx = hiw(x) >>> 0;
    const lx = low(x);
    hx = (hx + (0x3ff00000 - 0x3fe6a09e)) >>> 0;
    k += (hx >>> 20) - 0x3ff;
    hx = ((hx & 0x000fffff) + 0x3fe6a09e) >>> 0;
    x = mk(hx, lx);
    const f = x - 1.0, hfsq = 0.5 * f * f, s = f / (2.0 + f), z = s * s, w = z * z;
    const t1 = w * (Lg2 + w * (Lg4 + w * Lg6)), t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7))), R = t2 + t1, dk = k;
    return s * (hfsq + R) + dk * ln2lo - hfsq + f + dk * ln2hi;
  }
  const LN2 = 0.6931471805599453, LN10 = 2.302585092994046;
  function log2(x) { return log(x) / LN2; }
  function log10(x) { return log(x) / LN10; }
  function log1p(x) { x = +x; return abs(x) < 1e-4 ? x - x * x / 2 + x * x * x / 3 : log(1 + x); }
  function expm1(x) { x = +x; return abs(x) < 1e-5 ? x + x * x / 2 + x * x * x / 6 : exp(x) - 1; }
  // ---- pow（整数の指数はかけ算で。ほかは exp(y・log x)） ----
  function ipow(x, n) { let r = 1, b = x, e = n < 0 ? -n : n; while (e) { if (e & 1) r *= b; e >>>= 1; if (e) b *= b; } return n < 0 ? 1 / r : r; }
  function pow(x, y) {
    x = +x; y = +y;
    if (y === 0) return 1;
    if (!(x === x) || !(y === y)) return NaN;
    if (y === 1) return x;
    if (y === 2) return x * x;
    if (y === 0.5 && x >= 0 && x !== Infinity) return sqrt(x);
    if (floor(y) === y && abs(y) <= 1024) return ipow(x, y);
    if (x === 0) return y > 0 ? 0 : Infinity;
    if (x < 0) { if (floor(y) !== y) return NaN; const r = exp(y * log(-x)); return (abs(y) % 2 === 1) ? -r : r; }
    if (x === Infinity) return y > 0 ? Infinity : 0;
    if (y === Infinity) return x === 1 ? NaN : x > 1 ? Infinity : 0;
    if (y === -Infinity) return x === 1 ? NaN : x > 1 ? 0 : Infinity;
    return exp(y * log(x));
  }
  function cbrt(x) { x = +x; if (x === 0 || !(x === x) || x === Infinity || x === -Infinity) return x; const a = abs(x); let y = exp(log(a) / 3); y = y - (y * y * y - a) / (3 * y * y); y = y - (y * y * y - a) / (3 * y * y); return x < 0 ? -y : y; }
  function hypot() {
    let s = 0, inf = false, nan = false;
    for (let i = 0; i < arguments.length; i++) { const v = +arguments[i]; if (v === Infinity || v === -Infinity) inf = true; else if (!(v === v)) nan = true; else s += v * v; }
    if (inf) return Infinity; if (nan) return NaN; return sqrt(s);
  }
  function sinh(x) { x = +x; if (abs(x) < 1e-5) return x + x * x * x / 6; const e = exp(x); return (e - 1 / e) / 2; }
  function cosh(x) { const e = exp(+x); return (e + 1 / e) / 2; }
  function tanh(x) { x = +x; if (x > 20) return 1; if (x < -20) return -1; if (abs(x) < 1e-5) return x - x * x * x / 3; const e = exp(2 * x); return (e - 1) / (e + 1); }
  function asinh(x) { x = +x; const a = abs(x), r = log(a + sqrt(a * a + 1)); return x < 0 ? -r : r; }
  function acosh(x) { x = +x; return log(x + sqrt(x * x - 1)); }
  function atanh(x) { x = +x; return 0.5 * log((1 + x) / (1 - x)); }
  return { sin, cos, tan, atan, atan2, asin, acos, exp, log, log2, log10, log1p, expm1, pow, cbrt, hypot, sinh, cosh, tanh, asinh, acosh, atanh };
})();
if (!DMATH) return;
const PROTO = 1, TICK = 1000 / 60, PFX = 'ebf1', MAXP = 6;
// 通信の道：dc＝直接（PeerJS）、rt＝近くの中継（Supabase Realtime）、mq＝遠い中継（公開MQTTサーバー）
const PATHS = ['dc', 'rt', 'mq'], PNAME = { dc: '直接', rt: '中継', mq: '遠い中継' };
const FAST = new Set(['f', 'i', 'snap', 'dd', 'quit', 'start', 'go']);   // 試合の通信（いちばん速い道で送る）
// PeerJS の JSON の道は、16300 バイトより大きい通信は送れない（送れないうえに、その道がエラーになる）。大きくなりうるもの（状態の直し・部屋・開始）は、はかって大きければ中継で送る
const BIG = new Set(['snap', 'room', 'start']);
const ENCD = new TextEncoder();
const tooBig = env => { if (!BIG.has(env.m && env.m.y)) return false; try { return ENCD.encode(JSON.stringify(env)).length > 15000; } catch (e) { return true; } };
const RT_STEP = 80;   // 近くの中継で試合の通信を送る間隔（ms）。中継を使う人が多いときは、人数ぶんのばす（通数の上限を守るため）
const Q = new URLSearchParams(location.search);
const FORCE = PATHS.includes(Q.get('enetpath')) ? Q.get('enetpath') : '';   // ためし用：ホストが ?enetpath=rt などで道を決める（使えるときだけ）
const PNOW = Performance.prototype.now;
const realNow = () => PNOW.call(performance);
const wait = ms => new Promise(r => setTimeout(r, ms));
const $k = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(36).slice(2, 12);
const MYID = 'e' + rid();
const clampN = (v, a, b) => v < a ? a : v > b ? b : v;

// ゲームの版（中身が同じ人どうしでないと、計算がずれる）。ゲームの本体と net.js の版（?v=）から
const BUILD = (() => {
  let s = '';
  for (const sc of document.scripts) if (!sc.src && sc.text.length > s.length) s = sc.text;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const v = [...document.scripts].map(sc => (/\/net\.js\?v=(\w+)/.exec(sc.src || '') || [])[1]).filter(Boolean).join('.');
  return (h >>> 0).toString(36) + '.' + s.length + (v ? '.' + v : '');
})();

/* ---------- 1ステップのあいだだけ、決まった計算の Math にする ---------- */
const MK = Object.keys(DMATH), NATM = {};
for (const k of MK) NATM[k] = Math[k];
let SBD = 0;
function sbIn() { if (SBD++ === 0) for (const k of MK) Math[k] = DMATH[k]; }
function sbOut() { if (--SBD === 0) for (const k of MK) Math[k] = NATM[k]; }
// ゲームと同じ mulberry32（ずれを直すときのために、中の値を読み書きできるようにしたもの）
function mb32(a) {
  const f = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.get = () => a | 0; f.set = v => { a = v | 0; };
  return f;
}

/* ---------- 名前・色・CPU ---------- */
const PAL = ['#2f7de1', '#d63d27', '#86c04f', '#9b59d0', '#e8a33a', '#2bb3b1'];
const CPUN = ['エビ太', 'エビ子', '大エビ', 'エビ蔵', '小エビ'];
const LVN = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };
const DEF = { body: 'magari', coat: 'panko', lo: ['ketchup', 'karashi', 'shichimi', 'toothpick', 'spin', 'shippo'] };
const myCode = () => { try { return encodeLoadout(G.body, G.coat, G.loadout); } catch (e) { return ''; } };
const loInfo = code => { const d = decodeLoadout(code || ''); return d ? BODIES[d.body].name + '・' + loadOf(d.lo) + 'g' : ''; };

/* ---------- ロックステップ ---------- */
const LS = {
  on: false, host: false, n: 0, slot: 0, meK: 0, list: [], hk: [], ctrls: [], D: 6, D0: 6, lastTgt: 5, lastInp: 0, dT: 0, dWait: 0, dLow: 0, dFast: false, tick: 0, mid: '',
  frames: new Map(), snaps: new Map(), inb: [], nf: 0, ackIn: [], gs: new Map(), gone: [], qs: [],
  myIn: new Map(), myTop: 0, sentIn: -1, hostAck: -1, lf: -1, lastSendIn: 0, lastResendIn: 0, rlt: 0,
  budget: 0, lastReal: 0, lastStep: 0, lastFrameAt: 0, hh: new Map(), gh: new Map(),
  snapReq: false, snapPend: -1, fixes: 0, desync: 0, err: 0, endT: -1, deadAt: [], leftK: [], rank: null, specId: null,
  stats: { steps: 0, stall: 0, ms: 0, frames: 0, wait: 0, slow: 0 }
};
const idOfK = k => k === LS.meK ? 'p1' : 'f' + k;            // 名簿の番号 → World の中の ID
const cid = id => id === 'p1' ? 'f' + LS.meK : id;           // World の中の ID → だれの端末でも同じ ID
const lid = c => c === 'f' + LS.meK ? 'p1' : c;              // だれの端末でも同じ ID → World の中の ID
function buildWorld(S) {
  const seed = S.seed >>> 0, w = new World(seed);
  w.rng = mb32(seed);
  const total = S.list.length, R0 = 150, ctrls = [];
  sbIn();
  try {
    S.list.forEach((e, k) => {
      const a = Math.PI + k * 2 * Math.PI / total, x = Math.sin(a) * R0, z = Math.cos(a) * R0;
      const sp = { x, y: 60 + k * 6, z, yaw: Math.atan2(-x, -z) }, id = idOfK(k), color = PAL[k % PAL.length];
      if (e.h) {
        const d = decodeLoadout(e.code || '') || DEF;
        w.addFighter(Object.assign({ id, name: e.nm, color, body: d.body, coat: d.coat, loadout: d.lo.slice() }, sp));
      } else {
        const body = BODY_ORDER[w.rng() * 3 | 0], coat = COAT_ORDER[w.rng() * COAT_ORDER.length | 0];
        w.addFighter(Object.assign({ id, name: e.nm, color, body, coat, loadout: randomLoadout(w.rng, body), assist: CPU_LEVELS[S.lv].assist }, sp));
        ctrls.push({ k, id, c: new CpuController(w, id, S.lv) });
      }
    });
  } finally { sbOut(); }
  return { w, ctrls };
}
function canStep(T) {
  if (T < LS.D0) return true;
  const fr = LS.frames.get(T);
  if (!fr) return false;
  if (fr.z && !LS.host && !LS.snaps.has(T)) return false;
  return true;
}
function sampleLocal() {
  const L = G.local, inp = L.getInput(); L.clearEdges();
  const me = G.world && G.world.get('p1');
  if (!me || me.dead) return 0;
  const p = packInput(inp);
  p[0] = p[0] || 0; p[1] = p[1] || 0;   // -0 を 0 に（ほかの端末には JSON で 0 として届くので、自分も同じに）
  return (!p[0] && !p[1] && !p[2]) ? 0 : p;
}
function stepOnce() {
  const T = LS.tick;
  produceInput(T);
  const fr = T < LS.D0 ? null : LS.frames.get(T);
  if (fr && fr.z) {
    if (LS.host) net.send({ y: 'snap', n: T, s: capSnap() });
    else { const S = LS.snaps.get(T); LS.snaps.delete(T); if (S && !applySnap(S)) console.warn('[ebifry net] snap: 形がちがうので一部だけ直しました', T); }
  }
  const w = G.world, t0 = realNow();
  sbIn();
  try {
    if (fr && fr.q) for (const j of fr.q) quitHuman(j);
    const inputs = {};
    for (let j = 0; j < LS.n; j++) { const p = fr && fr.i[j]; inputs[idOfK(LS.hk[j])] = p ? unpackInput(p) : neutralInput(); }
    for (const c of LS.ctrls) inputs[c.id] = c.c.getInput();
    w.step(inputs);
  } catch (e) { LS.err++; console.error('[ebifry net] step', T, e); }
  finally { sbOut(); }
  LS.tick = T + 1; LS.stats.steps++; LS.stats.ms += realNow() - t0;
  if (T % 30 === 29) checkHash(T);
  if (!LS.host) LS.frames.delete(T);
  else { const old = T - 900; if (old >= 0) LS.frames.delete(old); }
  afterStep(T);
}
// 試合のとちゅうでぬけた人のエビは、そのステップで落ちる（全員同じステップで）
function quitHuman(j) {
  const k = LS.hk[j]; if (k == null || LS.leftK[k]) return;
  LS.leftK[k] = true;
  const w = G.world, f = w.get(idOfK(k));
  if (f && !f.dead) { f.hp = 0; f.dead = true; f.deadT = 0; w.events.push({ t: 'ko', id: f.id, by: null, x: f.x, y: f.y, z: f.z }); }
  if (k !== LS.meK) try { toast((LS.list[k] && LS.list[k].nm || 'だれか') + ' さんがぬけました'); } catch (e) {}
}
// 自分の入力は、ステップ T のときに T + D のぶんとして出す。D が大きくなってあいたステップは、前の入力（向きと「撃つ」の押しっぱなしだけ）でうめる。
// D が小さくなったときは、もう出したステップに追いつくまで入力をためておく（どのステップにも、だれの入力も1つずつ）
function produceInput(T) {
  const tgt = T + LS.D;
  if (tgt <= LS.lastTgt) return;
  const inp = sampleLocal();
  const p = LS.lastInp, rep = p ? ((p[0] || p[1] || (p[2] & 1)) ? [p[0], p[1], p[2] & 1] : 0) : 0;
  for (let x = LS.lastTgt + 1; x <= tgt; x++) {
    const v = x === tgt ? inp : rep;
    if (LS.host) LS.inb[LS.slot].set(x, v); else { LS.myIn.set(x, v); LS.myTop = x; }
  }
  LS.lastTgt = tgt; LS.lastInp = inp;
  if (LS.host) hostFinalize();   // 参加者の入力は、このフレームのステップがおわってから、まとめて送る
}
// ホスト：2秒ごとに、通信の速さ（往復の時間＋まとめて送る待ち）と、入力を待って止まった回数から D を決めなおして、全員に知らせる。
// 大きくするのはすぐ、小さくするのはゆっくり（ただし、速い道に乗りかえたときは、ちがいの半分ずつ早めに）
function adaptD(now) {
  if (!LS.on || !LS.host || now - LS.dT < 2000) return;
  LS.dT = now;
  const R0 = KN.room, rt = Math.max(0, ...(R0 ? R0.mem.filter(m => m.id !== MYID && LS.gs.has(m.id)).map(m => m.eff || m.rtt || 0) : [0]));
  let want = Math.max(4, Math.min(40, Math.ceil((rt + 50) / TICK)));
  let waits = LS.stats.wait - LS.dWait, slow = LS.stats.slow - (LS.dSlow || 0); LS.dWait = LS.stats.wait; LS.dSlow = LS.stats.slow;
  for (const g of LS.gs.values()) { waits = Math.max(waits, g.w || 0); slow = Math.max(slow, g.sl || 0); g.w = 0; g.sl = 0; }
  if (waits > 20) want = Math.max(want, LS.D + 3);
  else if (waits > 10) want = Math.max(want, LS.D + 1);   // ときどき止まる：少しだけ大きく（止まるより、少しおくれるほうが気にならない）
  else if (slow > 40) want = Math.max(want, LS.D + 1);   // 2秒のうち 1/3 ほど、フレームが少なくてゆっくりにしていた
  if (want > LS.D) { LS.dLow = 0; LS.dFast = false; setD(Math.min(40, want)); }
  else if (want < LS.D - 2 && waits < 3) {
    if (LS.dFast) { LS.dLow = 0; setD(Math.max(want, LS.D - Math.max(2, Math.ceil((LS.D - want) / 2)))); }
    else if (++LS.dLow >= 3) { LS.dLow = 0; setD(LS.D - 2); }
  }
  else { LS.dLow = 0; LS.dFast = false; }
}
function setD(d) { if (d === LS.D) return; LS.D = d; net.send({ y: 'dd', D: d, mid: LS.mid }); }
function hostFinalize() {
  for (;;) {
    const T = LS.nf, I = [];
    for (let j = 0; j < LS.n; j++) {
      if (LS.gone[j]) { I.push(0); continue; }
      const m = LS.inb[j]; if (!m.has(T)) { sendFrames(false); return; } I.push(m.get(T));
    }
    for (let j = 0; j < LS.n; j++) LS.inb[j].delete(T);
    const fr = { i: I };
    if (LS.snapReq) { fr.z = 1; LS.snapReq = false; LS.snapPend = T; }
    if (LS.qs.length) { fr.q = LS.qs.splice(0, LS.qs.length); }
    LS.frames.set(T, fr); LS.nf = T + 1;
    for (let j = 0; j < LS.n; j++) if (LS.ackIn[j] < T) LS.ackIn[j] = T;
  }
}
function framePack(a, b) {
  const d = [], z = [], q = {};
  let anyQ = false;
  for (let T = a; T <= b; T++) { const f = LS.frames.get(T); if (!f) break; d.push(f.i); if (f.z) z.push(T); if (f.q) { q[T] = f.q; anyQ = true; } }
  return { d, z: z.length ? z : undefined, q: anyQ ? q : undefined };
}
// フレームを送る：直接・近くの中継の人には1人ずつ、遠い中継の人にはまとめて1つ（だれがどこまで受けとったかをそえる）
// 近くの中継は、通数をへらすため少しまとめて送る（その人の入力が届いたときは、すぐ返す）
function sendFrames(force) {
  const now = realNow(), top = LS.nf - 1, gap = rtGap();
  let rFrom = Infinity;
  const relay = [];
  for (const g of LS.gs.values()) {
    const p = net.path(g.id), hold = p === 'rt' && !force && !g.kick && now - g.lt < gap - 8;
    let from;
    if (top > g.sent) { if (hold) continue; from = p === 'dc' && top - g.ack <= 48 ? g.ack + 1 : g.sent + 1; }   // 直接のときは、まだ届いたと言われていない分も
    else if (g.ack < g.sent && (force || now - Math.max(g.rs, g.lt) > 300)) { if (hold) continue; from = g.ack + 1; g.rs = now; }   // 送ってから0.3秒たっても届いたと返事がないとき、もう一度
    else continue;
    if (p !== 'mq') {
      const pk = framePack(from, Math.min(top, from + 59)); if (!pk.d.length) continue;
      if (net.via(p, { y: 'f', a: from, d: pk.d, z: pk.z, q: pk.q, k: LS.ackIn[g.slot], D: LS.D }, g.id)) {
        g.sent = Math.max(g.sent, from + pk.d.length - 1); g.lt = now; g.kick = false;
        continue;
      }
    }
    relay.push(g); if (from < rFrom) rFrom = from;
  }
  if (!relay.length) return;
  if (!force && top - rFrom < 2 && now - LS.rlt < 50) return;   // 遠い中継のときは少しまとめる
  const pk = framePack(rFrom, Math.min(top, rFrom + 59)); if (!pk.d.length) return;
  const ks = {}; for (const g of LS.gs.values()) ks[g.slot] = LS.ackIn[g.slot];
  net.relay({ y: 'f', a: rFrom, d: pk.d, z: pk.z, q: pk.q, ks, D: LS.D });
  for (const g of relay) { g.sent = Math.max(g.sent, rFrom + pk.d.length - 1); g.lt = now; }
  LS.rlt = now;
}
function sendInputs(force) {
  const now = realNow(), top = LS.myTop;
  const p = net.path();
  let from;
  if (top > LS.sentIn) from = p === 'dc' && top - LS.hostAck <= 48 ? LS.hostAck + 1 : LS.sentIn + 1;   // 直接のときは、まだ届いたと言われていない分も（1つ遅れても止まらない）
  else if (LS.hostAck < LS.sentIn && (force || now - LS.lastResendIn > 300)) { from = LS.hostAck + 1; LS.lastResendIn = now; }
  else return;
  from = Math.max(from, LS.D0);
  if (!force) {   // 中継のときは少しまとめる（近くの中継はホストが決めた間隔で）
    if (p === 'rt' && now - LS.lastSendIn < ((net.L && net.L.gap) || RT_STEP) - 8) return;
    if (p === 'mq' && top - from < 2 && now - LS.lastSendIn < 50) return;
  }
  const d = [];
  for (let T = from; T <= top && d.length < 60; T++) d.push(LS.myIn.has(T) ? LS.myIn.get(T) : 0);
  if (!d.length) return;
  net.send({ y: 'i', s: LS.slot, a: from, d, k: LS.lf });
  LS.sentIn = Math.max(LS.sentIn, from + d.length - 1); LS.lastSendIn = now;
}
function cleanInp(p) {
  if (!Array.isArray(p)) return 0;
  const n = v => (Number.isInteger(v) && v >= -100 && v <= 100) ? v : 0;
  const x = n(p[0]), y = n(p[1]), b = (Number.isInteger(p[2]) && p[2] >= 0 && p[2] <= 127) ? p[2] : 0;
  return (!x && !y && !b) ? 0 : [x, y, b];
}
function onInputs(m, from) {
  if (!LS.on || !LS.host) return;
  const g = LS.gs.get(from); if (!g || g.slot !== m.s || !Array.isArray(m.d) || !Number.isInteger(m.a)) return;
  const box = LS.inb[g.slot];
  for (let j = 0; j < m.d.length && j < 120; j++) { const T = m.a + j; if (T >= LS.nf && !box.has(T)) box.set(T, cleanInp(m.d[j])); }
  let x = LS.ackIn[g.slot]; while (x + 1 < LS.nf || box.has(x + 1)) x++; LS.ackIn[g.slot] = x;
  if (typeof m.k === 'number' && m.k > g.ack) g.ack = Math.min(m.k, g.sent);
  g.lastIn = realNow(); g.kick = true;
  hostFinalize();
}
function onFrames(m) {
  if (!LS.on || LS.host || !Array.isArray(m.d) || !Number.isInteger(m.a)) return;
  const zs = new Set(Array.isArray(m.z) ? m.z : []), qs = m.q && typeof m.q === 'object' ? m.q : null;
  for (let j = 0; j < m.d.length; j++) {
    const T = m.a + j; if (T < LS.tick || LS.frames.has(T)) continue;
    const fr = { i: Array.isArray(m.d[j]) ? m.d[j] : [] };
    if (zs.has(T)) fr.z = 1;
    if (qs && Array.isArray(qs[T])) fr.q = qs[T].filter(Number.isInteger);
    LS.frames.set(T, fr);
  }
  while (LS.lf + 1 < LS.tick || LS.frames.has(LS.lf + 1)) LS.lf++;
  const k = typeof m.k === 'number' ? m.k : (m.ks && typeof m.ks[LS.slot] === 'number' ? m.ks[LS.slot] : -1);
  if (k > LS.hostAck) { LS.hostAck = k; for (const T of LS.myIn.keys()) if (T <= k) LS.myIn.delete(T); }
  const e = m.a + m.d.length;   // 入力のおくれ（ホストが決める）。順番が入れかわって届いた古いものでは、もどさない
  if (Number.isInteger(m.D) && e >= (LS.dN || 0)) { LS.dN = e; LS.D = clampN(m.D, 2, 40); }
  LS.lastFrameAt = realNow();
}

/* ---------- 状態のハッシュ・ずれを直す ---------- */
const HDV = new DataView(new ArrayBuffer(8));
function H() { this.h = 2166136261 | 0; }
H.prototype.u = function (x) { this.h = Math.imul(this.h ^ (x | 0), 16777619); };
H.prototype.n = function (v) {
  if (typeof v === 'number') { HDV.setFloat64(0, v); this.u(HDV.getInt32(0)); this.u(HDV.getInt32(4)); }
  else if (typeof v === 'boolean') this.u(v ? 7 : 3);
  else if (typeof v === 'string') { this.u(v.length); for (let i = 0; i < v.length; i++) this.u(v.charCodeAt(i)); }
  else if (v === null) this.u(11); else if (v === undefined) this.u(13); else this.u(17);
};
const FSKIP = new Set(['st', 'loadout', 'name', 'color', 'body', 'coat']);
const idKeys = o => Object.keys(o || {}).map(cid).sort();
function stateHash() {
  const w = G.world, h = new H();
  h.n(LS.tick); h.n(w.tick); h.n(w.time); h.n(w.nextShot); h.u(w.rng.get());
  h.u(w.fighters.length);
  for (const f of w.fighters) for (const k of Object.keys(f).sort()) {
    if (FSKIP.has(k)) continue;
    const v = f[k]; h.n(k);
    if (k === 'id' || k === 'burnBy') h.n(v == null ? v : cid(v));
    else if (k === 'dashHit') idKeys(v).forEach(x => h.n(x));
    else if (k === 'waza') { for (const wk of Object.keys(v).sort()) { h.n(wk); h.n(v[wk].cd); h.n(v[wk].t); } }
    else if (k === 'rearCd') { for (const wk of Object.keys(v).sort()) { h.n(wk); h.n(v[wk]); } }
    else if (v === null || typeof v !== 'object') h.n(v);
  }
  h.u(w.shots.length);
  for (const s of w.shots) for (const k of Object.keys(s).sort()) {
    const v = s[k]; h.n(k);
    if (k === 'owner' || k === 'target') h.n(v == null ? v : cid(v));
    else if (k === 'hit') { if (v) idKeys(v).forEach(x => h.n(x)); else h.n(null); }
    else if (Array.isArray(v)) v.forEach(x => h.n(x));
    else if (v === null || typeof v !== 'object') h.n(v);
  }
  for (const c of LS.ctrls) { const o = c.c; h.n(o.targetId == null ? null : cid(o.targetId)); h.n(o.retarget); h.n(o.swCool); h.n(o.evade); h.n(o.burst); h.n(o.firing); h.n(o.phase); }
  return h.h >>> 0;
}
const ENC = v => (typeof v === 'number' && !isFinite(v)) ? { n: String(v) } : v;
const DEC = v => (v && typeof v === 'object' && !Array.isArray(v) && typeof v.n === 'string') ? Number(v.n) : v;
function capSnap() {
  const w = G.world;
  const F = w.fighters.map(f => {
    const o = {};
    for (const k in f) {
      if (FSKIP.has(k)) continue;
      const v = f[k];
      if (k === 'id' || k === 'burnBy') o[k] = v == null ? null : cid(v);
      else if (k === 'dashHit') o[k] = idKeys(v);
      else if (k === 'waza' || k === 'rearCd') o[k] = JSON.parse(JSON.stringify(v));
      else if (v === null || typeof v !== 'object') o[k] = ENC(v);
    }
    return o;
  });
  const S = w.shots.map(s => {
    const o = {};
    for (const k in s) {
      const v = s[k];
      if (k === 'owner' || k === 'target') o[k] = v == null ? null : cid(v);
      else if (k === 'hit') o[k] = v ? idKeys(v) : null;
      else if (Array.isArray(v)) o[k] = v.map(ENC);
      else if (v === null || typeof v !== 'object') o[k] = ENC(v);
    }
    return o;
  });
  const C = LS.ctrls.map(c => { const o = c.c; return [o.targetId == null ? null : cid(o.targetId), o.retarget, o.swCool, o.evade, o.burst, o.firing, o.phase].map(ENC); });
  return { tk: w.tick, tm: w.time, ns: w.nextShot, rng: w.rng.get(), F, S, C };
}
function applySnap(X) {
  const w = G.world;
  if (!X || !Array.isArray(X.F) || !Array.isArray(X.S) || !Array.isArray(X.C)) return false;
  w.tick = X.tk; w.time = X.tm; w.nextShot = X.ns; w.rng.set(X.rng);
  let ok = X.F.length === w.fighters.length;
  X.F.forEach((o, i) => {
    const f = w.fighters[i]; if (!f) return;
    for (const k in o) {
      const v = o[k];
      if (k === 'id') { if (lid(v) !== f.id) ok = false; continue; }
      if (k === 'burnBy') f[k] = v == null ? null : lid(v);
      else if (k === 'dashHit') { const m = {}; (v || []).forEach(c => { m[lid(c)] = true; }); f[k] = m; }
      else if (k === 'waza' || k === 'rearCd') f[k] = v;
      else f[k] = DEC(v);
    }
  });
  w.shots = X.S.map(o => {
    const s = {};
    for (const k in o) {
      const v = o[k];
      if (k === 'owner' || k === 'target') s[k] = v == null ? null : lid(v);
      else if (k === 'hit') { if (v) { const m = {}; v.forEach(c => { m[lid(c)] = true; }); s[k] = m; } else s[k] = null; }
      else if (Array.isArray(v)) s[k] = v.map(DEC);
      else s[k] = DEC(v);
    }
    return s;
  });
  X.C.forEach((a, i) => {
    const c = LS.ctrls[i] && LS.ctrls[i].c; if (!c || !Array.isArray(a)) { ok = false; return; }
    const v = a.map(DEC);
    c.targetId = v[0] == null ? null : lid(v[0]); c.retarget = v[1]; c.swCool = v[2]; c.evade = v[3]; c.burst = v[4]; c.firing = v[5]; c.phase = v[6];
  });
  return ok;
}
const DBG = Q.has('enetdbg');
function checkHash(T) {
  const h = stateHash();
  if (DBG) { LS.dbg = LS.dbg || new Map(); LS.dbg.set(T, JSON.stringify(capSnap())); if (LS.dbg.size > 40) LS.dbg.delete(LS.dbg.keys().next().value); }
  if (!LS.host) {
    const st = LS.stats, w = st.wait - (LS.repW || 0), sl = st.slow - (LS.repS || 0); LS.repW = st.wait; LS.repS = st.slow;
    net.send({ y: 'h', n: T, h, w, sl }); return;
  }
  LS.hh.set(T, h); LS.hh.delete(T - 1800);
  const pend = LS.gh.get(T); if (pend) { LS.gh.delete(T); pend.forEach(x => cmpHash(T, x[0], x[1])); }
}
function onHash(m, from) {
  if (!LS.on || !LS.host || typeof m.n !== 'number') return;
  const g = LS.gs.get(from);
  if (g) { if (Number.isInteger(m.w) && m.w > 0) g.w = (g.w || 0) + Math.min(m.w, 600); if (Number.isInteger(m.sl) && m.sl > 0) g.sl = (g.sl || 0) + Math.min(m.sl, 600); }
  if (LS.hh.has(m.n)) cmpHash(m.n, from, m.h);
  else if (m.n >= LS.tick - 1) { const a = LS.gh.get(m.n) || []; a.push([from, m.h]); LS.gh.set(m.n, a); }
}
function cmpHash(T, from, h) {
  if (LS.hh.get(T) === h) return;
  LS.desync++;
  console.warn('[ebifry net] ずれ', T, from, LS.hh.get(T), h);
  if (LS.snapPend >= 0 && T < LS.snapPend + 90) return;    // もう直しに行っている
  if (LS.fixes >= 6) { KN.hostAbort('計算のずれが直らないので、試合を止めました'); return; }
  LS.fixes++; LS.snapReq = true; LS.snapPend = LS.nf;
}
function onSnap(m) { if (LS.on && !LS.host && typeof m.n === 'number' && m.s) LS.snaps.set(m.n, m.s); }
// ステップのあと：落ちた順をおぼえる。のこりが1体（か、人が全員落ちた）なら、2.5秒後に試合おわり
function afterStep(T) {
  const w = G.world;
  let alive = 0, hAlive = 0;
  for (let k = 0; k < LS.list.length; k++) {
    const f = w.get(idOfK(k));
    if (!f) continue;
    if (f.dead) { if (LS.deadAt[k] < 0) LS.deadAt[k] = T; }
    else { alive++; if (LS.list[k].h) hAlive++; }
  }
  if (LS.endT < 0) { if (alive <= 1 || hAlive === 0) { LS.endT = T; G.endT = w.time; LS.rank = ranking(); } }
  else if (T >= LS.endT + 150) KN.matchOver();
}
function ranking() {
  const w = G.world;
  const rows = LS.list.map((e, k) => {
    const f = w.get(idOfK(k));
    return { k, nm: e.nm, cpu: !e.h, me: k === LS.meK, alive: !!(f && !f.dead), hp: f ? Math.ceil(f.hp) : 0, kills: f ? f.kills : 0, dealt: f ? Math.round(f.dealt) : 0, d: LS.deadAt[k], left: !!LS.leftK[k] };
  });
  rows.sort((a, b) => (b.alive - a.alive) || (a.alive ? b.hp - a.hp : b.d - a.d) || (b.kills - a.kills) || (a.k - b.k));
  return rows;
}

/* ---------- 公開MQTTサーバーでの中継（市区町村バトル・カニノケンカと同じしくみ） ---------- */
const MQ = (() => {
  const LIST = Array.isArray(window.__mqttBrokers) ? window.__mqttBrokers : [
    'wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://mqtt.eclipseprojects.io/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const OK = typeof TextEncoder === 'function' && typeof TextDecoder === 'function';
  const te = OK ? new TextEncoder() : null, td = OK ? new TextDecoder() : null;
  const subs = new Map(), unsubT = new Map(), watch = new Set();
  const bs = LIST.map(url => ({ url, ws: null, ok: false, fails: 0, t: 0, buf: null, last: 0, rx: 0, tx: 0 }));
  const cid0 = 'eb' + rid();
  let on = false, pid = 0, ka = 0;
  function cat(ps) { let n = 0; for (const p of ps) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; }
  function s16(s) { const b = te.encode(s); return cat([[b.length >> 8 & 255, b.length & 255], b]); }
  function pkt(h, body) { const a = [h]; let n = body.length; do { let d = n & 127; n = Math.floor(n / 128); if (n) d |= 128; a.push(d); } while (n); return cat([a, body]); }
  const nid = () => (pid = pid % 65535 + 1);
  const pConnect = () => pkt(0x10, cat([s16('MQTT'), [4, 2, 0, 60], s16(cid0)]));
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
    start, count,
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

/* ---------- 近くの中継（Supabase Realtime の broadcast。風の芽経済組と同じプロジェクト） ----------
   世界のあちこちにあるサーバーのうち近いところを通るので、公開MQTTサーバー（ヨーロッパ・アメリカ）より速い。
   ただし通数に上限がある（無料プランは1秒に100通・1か月200万通。送った1通と、受けとった人の数をかぞえる）ので、
   直接（PeerJS）でよくつながっているときは使わず、使うときも少しまとめて送る。上限をこえて切られたら、しばらく使わない。
   部屋の参加者ごとに1つのチャンネル（その人とホストだけが入る）。../config.js の url・anonKey を使う */
const RT = (() => {
  const C = window.AILINAX_CONFIG || {};
  let url = '';
  if (typeof window.__rtUrl === 'string') url = window.__rtUrl;
  else if (typeof C.url === 'string' && /^https:\/\/[\w.-]+$/.test(C.url.replace(/\/+$/, '')) && typeof C.anonKey === 'string' && C.anonKey)
    url = C.url.replace(/\/+$/, '').replace(/^https:/, 'wss:') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(C.anonKey) + '&vsn=1.0.0';
  const ON = !!url && C.ebiRelay !== false && Q.get('enetrt') !== '0' && Q.get('enet') !== 'bc' && typeof WebSocket === 'function';
  const COOL = typeof window.__rtCool === 'number' ? window.__rtCool : 60000;   // 上限で切られたら、この間は使わない
  const MAXPS = 40;   // この端末から1秒に送るのはここまで
  const chans = new Map(), watch = new Set();   // チャンネル名 → { hs: 受けとる関数, st: 0 まだ・1 入るところ・2 入った・-1 入れない, jref, nf: 入れなかった回数 }
  const S = { tx: 0, rx: 0, drop: 0, cuts: 0, lim: 0 };
  let ws = null, ok = false, ref = 0, hb = 0, hbRef = '', fails = 0, reT = 0, idleT = 0, cool = 0, winT = 0, winN = 0;
  const tp = n => 'realtime:' + n;
  const nx = () => String(ref = ref % 1e9 + 1);
  function changed() { watch.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
  function raw(o) { if (!ws || !ok || ws.readyState !== 1) return false; try { ws.send(JSON.stringify(o)); return true; } catch (e) { return false; } }
  function join(n, ch) {
    ch.st = 1; ch.jref = nx();
    raw({ topic: tp(n), event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } }, ref: ch.jref, join_ref: ch.jref });
  }
  function rejoin(n) { const ch = chans.get(n); if (ch && ch.st === 0 && ok) join(n, ch); }
  function later() { clearTimeout(reT); if (!chans.size) return; reT = setTimeout(open, Math.max(cool - Date.now(), Math.min(30000, 1000 * Math.pow(2, Math.min(fails, 5))))); }
  function drop(s, why) {
    if (ws !== s) return;
    ws = null; const was = ok; ok = false; clearInterval(hb); hbRef = '';
    for (const ch of chans.values()) if (ch.st > 0) ch.st = 0;
    if (why === 'limit') { cool = Date.now() + COOL; S.lim++; } else if (was) S.cuts++;
    fails++;
    try { s.close(); } catch (e) {}
    later();
    if (was) changed();
  }
  function beat() {
    if (!ws || !ok) return;
    if (hbRef) { drop(ws, 'hb'); return; }   // 前の返事がまだ来ない
    hbRef = nx(); raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: hbRef });
  }
  function open() {
    clearTimeout(reT);
    if (!ON || ws || !chans.size) return;
    if (Date.now() < cool) { later(); return; }
    let s; try { s = new WebSocket(url); } catch (e) { fails++; later(); return; }
    ws = s; ok = false;
    const to = setTimeout(() => { if (ws === s && !ok) drop(s, ''); }, 10000);
    s.onopen = () => {
      if (ws !== s) return;
      clearTimeout(to); ok = true; fails = 0;
      for (const [n, ch] of chans) if (ch.st >= 0) join(n, ch);
      clearInterval(hb); hb = setInterval(beat, 25000);
    };
    s.onmessage = e => { if (ws === s && typeof e.data === 'string') onMsg(s, e.data); };
    s.onclose = () => { clearTimeout(to); drop(s, ''); };
    s.onerror = () => { clearTimeout(to); drop(s, ''); };
  }
  function onMsg(s, data) {
    S.rx++;
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const ev = m.event, n = typeof m.topic === 'string' && m.topic.slice(0, 9) === 'realtime:' ? m.topic.slice(9) : '';
    const ch = n ? chans.get(n) : null;
    if (ev === 'broadcast') {
      const p = m.payload && m.payload.payload;
      if (ch && ch.st === 2 && p && typeof p === 'object') ch.hs.forEach(f => { try { f(p); } catch (e) { console.error(e); } });
      return;
    }
    if (data.length < 4000 && /too many|tenant_events|rate.?limit/i.test(data)) { drop(s, 'limit'); return; }
    if (ev === 'phx_reply') {
      if (m.topic === 'phoenix') { if (m.ref === hbRef) hbRef = ''; return; }
      if (!ch || ch.st !== 1 || m.ref !== ch.jref) return;
      if (m.payload && m.payload.status === 'ok') { ch.st = 2; ch.nf = 0; changed(); }
      else { ch.nf++; ch.st = ch.nf < 4 ? 0 : -1; if (!ch.st) setTimeout(() => rejoin(n), 3000 * ch.nf); }
      return;
    }
    if ((ev === 'phx_error' || ev === 'phx_close') && ch && ch.st > 0) { const was = ch.st === 2; ch.st = 0; setTimeout(() => rejoin(n), 2000); if (was) changed(); }
  }
  return {
    on: ON,
    // チャンネルに入って受けとる（もどり値の関数でぬける。だれも使わなくなったら、しばらくしてつなぐのをやめる）
    sub(n, f) {
      if (!ON) return () => {};
      let ch = chans.get(n);
      if (!ch) { ch = { hs: new Set(), st: 0, jref: '', nf: 0 }; chans.set(n, ch); }
      ch.hs.add(f); clearTimeout(idleT);
      if (!ws) open(); else if (ok && ch.st === 0) join(n, ch);
      return () => {
        const c = chans.get(n); if (!c || !c.hs.delete(f) || c.hs.size) return;
        chans.delete(n);
        if (c.st > 0) raw({ topic: tp(n), event: 'phx_leave', payload: {}, ref: nx(), join_ref: c.jref });
        if (!chans.size) {
          clearTimeout(idleT);
          idleT = setTimeout(() => { if (chans.size || !ws) return; const s = ws; ws = null; ok = false; clearInterval(hb); clearTimeout(reT); try { s.close(); } catch (e) {} }, 20000);
        }
      };
    },
    ready(n) { const ch = chans.get(n); return !!(ok && ch && ch.st === 2 && Date.now() >= cool); },
    pub(n, env) {
      const ch = chans.get(n), now = Date.now();
      if (!ok || !ch || ch.st !== 2 || now < cool) return false;
      if (now - winT >= 1000) { winT = now; winN = 0; }
      if (winN >= MAXPS) { S.drop++; return false; }
      if (!raw({ topic: tp(n), event: 'broadcast', payload: { type: 'broadcast', event: 'm', payload: env }, ref: nx(), join_ref: ch.jref })) return false;
      winN++; S.tx++; return true;
    },
    onChange(f) { watch.add(f); return () => watch.delete(f); },
    stat() { return Object.assign({ on: ON, ok, cool: Math.max(0, cool - Date.now()), ch: [...chans].map(([n, c]) => n.slice(-6) + ':' + c.st) }, S); }
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
function mkDedup() {
  const seen = new Map();
  return env => {
    let s = seen.get(env.g); if (!s) { s = { set: new Set(), q: [] }; seen.set(env.g, s); }
    if (s.set.has(env.n)) return true;
    s.set.add(env.n); s.q.push(env.n); if (s.q.length > 2048) s.set.delete(s.q.shift());
    return false;
  };
}
// テスト用（同じブラウザの BroadcastChannel）：道は1つだけ（ふつうは「直接」、?enetrelay=1 なら「遠い中継」とみなす）
function linkBC(L, code, recv, mine, theirs) {
  const ch = new BroadcastChannel('enet-' + code), P = Q.has('enetrelay') ? 'mq' : 'dc';
  ch.onmessage = e => { const env = e.data; if (env && env.k === theirs) recv(env.e, P); };
  L.send = (m, to) => { ch.postMessage({ k: mine, e: { g: MYID, n: ++L.seq, to, m } }); };
  L.sendVia = (p, m, to) => { if (p !== P) return false; L.send(m, to); return true; };
  L.relay = m => L.send(m);
  L.direct = () => P === 'dc';
  L.path = () => P; L.has = p => p === P; L.setWant = () => {};
  L.close = () => { L.closed = true; ch.close(); };
  return L;
}
async function linkHost(code, onMsg) {
  const L = { role: 'host', code, peer: null, gs: new Map(), closed: false, seq: 0 };
  const dup = mkDedup(), tH = `${PFX}/r/${code}/h`, tG = `${PFX}/r/${code}/g`;
  const rtn = id => `${PFX}-${code}-${id}`;   // 近くの中継：参加者ごとのチャンネル
  const gOf = id => { let g = L.gs.get(id); if (!g) { g = { dc: null, want: '', rtUn: null }; L.gs.set(id, g); } return g; };
  function recv(env, via, dc) {
    if (L.closed || !env || typeof env !== 'object' || env.g === MYID || typeof env.g !== 'string') return;
    if (env.to && env.to !== MYID) return;
    const g = gOf(env.g);
    if (dc) g.dc = dc;
    if (dup(env)) return;
    onMsg(env.m, env.g, via);
  }
  if (Q.get('enet') === 'bc') return linkBC(L, code, recv, 'g', 'h');
  L.unsub = MQ.sub(tH, env => recv(env, 'mq'));
  let taken = false;
  if (await loadPeerJS()) {
    try {
      const p = await newPeer(`${PFX}-${code}`, 8000);
      L.peer = p;
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
  const dcOk = g => !!(g && g.dc && g.dc.open);
  L.direct = to => { if (!to) return [...L.gs.values()].every(dcOk); return dcOk(L.gs.get(to)); };
  L.has = (p, id) => p === 'dc' ? dcOk(L.gs.get(id)) : p === 'rt' ? RT.ready(rtn(id)) : p === 'mq' ? MQ.count() > 0 : false;
  // その人に試合の通信を送る道（ホストが決めた道。使えないときは、直接か遠い中継）
  L.path = id => {
    const g = L.gs.get(id), w = g ? g.want : '';
    if (w === 'dc' && dcOk(g)) return 'dc';
    if (w === 'rt' && RT.ready(rtn(id))) return 'rt';
    if (w === 'mq') return 'mq';
    return dcOk(g) ? 'dc' : 'mq';
  };
  L.setWant = (id, p) => { const g = L.gs.get(id); if (g) g.want = p; };
  function put(p, id, env) {
    if (p === 'dc') { const g = L.gs.get(id); if (!dcOk(g) || tooBig(env)) return false; try { g.dc.send(env); return true; } catch (e) { return false; } }
    if (p === 'rt') return RT.pub(rtn(id), env);
    return false;
  }
  L.sendVia = (p, m, to) => { const env = { g: MYID, n: ++L.seq, to, m }; return p === 'mq' ? MQ.pub(tG, env) > 0 : put(p, to, env); };
  L.send = (m, to) => {
    const env = { g: MYID, n: ++L.seq, to, m }, fast = FAST.has(m.y);
    let needMq = false, any = false;
    for (const [id, g] of L.gs) {
      if (to && id !== to) continue;
      any = true;
      const p = fast ? L.path(id) : dcOk(g) ? 'dc' : 'mq';
      if (p !== 'mq' && put(p, id, env)) continue;
      if (p !== 'dc' && dcOk(g) && put('dc', id, env)) continue;
      needMq = true;
    }
    if (needMq || !any) MQ.pub(tG, env);
  };
  L.relay = m => MQ.pub(tG, { g: MYID, n: ++L.seq, m });   // 遠い中継だけで、全員に
  L.rtAdd = id => { const g = gOf(id); if (!g.rtUn && RT.on) g.rtUn = RT.sub(rtn(id), env => { if (env && env.g === id) recv(env, 'rt'); }); };
  L.forget = id => { const g = L.gs.get(id); if (g && g.rtUn) g.rtUn(); L.gs.delete(id); };
  L.close = () => {
    L.closed = true; if (L.unsub) L.unsub();
    for (const g of L.gs.values()) if (g.rtUn) { g.rtUn(); g.rtUn = null; }
    const p = L.peer; if (p) setTimeout(() => { try { p.destroy(); } catch (e) {} }, 300);
  };
  return L;
}
async function linkGuest(code, onMsg) {
  const L = { role: 'guest', code, peer: null, dc: null, closed: false, seq: 0, fails: 0, rt: 0, want: '', gap: RT_STEP };
  const dup = mkDedup(), tH = `${PFX}/r/${code}/h`, tG = `${PFX}/r/${code}/g`, rtName = `${PFX}-${code}-${MYID}`;
  function recv(env, via) {
    if (L.closed || !env || typeof env !== 'object' || env.g === MYID || typeof env.g !== 'string') return;
    if (env.to && env.to !== MYID) return;
    if (dup(env)) return;
    onMsg(env.m, env.g, via);
  }
  if (Q.get('enet') === 'bc') return linkBC(L, code, recv, 'h', 'g');
  L.unsub = MQ.sub(tG, env => recv(env, 'mq'));
  L.rtUn = RT.sub(rtName, env => recv(env, 'rt'));   // 近くの中継：自分のチャンネル（ホストも入る）
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
  const dcOk = () => !!(L.dc && L.dc.open);
  L.direct = dcOk;
  L.has = p => p === 'dc' ? dcOk() : p === 'rt' ? RT.ready(rtName) : p === 'mq' ? MQ.count() > 0 : false;
  // 試合の通信を送る道（ホストが知らせてきた道。使えないときは、直接か遠い中継）
  L.path = () => { const w = L.want; if (w === 'dc' && dcOk()) return 'dc'; if (w === 'rt' && RT.ready(rtName)) return 'rt'; if (w === 'mq') return 'mq'; return dcOk() ? 'dc' : 'mq'; };
  function put(p, env) {
    if (p === 'dc') { if (!dcOk() || tooBig(env)) return false; try { L.dc.send(env); return true; } catch (e) { return false; } }
    if (p === 'rt') return RT.pub(rtName, env);
    if (p === 'mq') return MQ.pub(tH, env) > 0;
    return false;
  }
  L.sendVia = (p, m) => put(p, { g: MYID, n: ++L.seq, m });
  L.send = m => {
    const env = { g: MYID, n: ++L.seq, m }, p = FAST.has(m.y) ? L.path() : dcOk() ? 'dc' : 'mq';
    if (p !== 'mq' && put(p, env)) return;
    if (p !== 'dc' && put('dc', env)) return;
    MQ.pub(tH, env);
  };
  L.rtLost = () => L.want === 'rt' && !RT.ready(rtName);
  L.close = () => {
    L.closed = true; clearTimeout(L.rt); if (L.unsub) L.unsub(); if (L.rtUn) { L.rtUn(); L.rtUn = null; }
    const p = L.peer; if (p) setTimeout(() => { try { p.destroy(); } catch (e) {} }, 300);
  };
  return L;
}
const net = {
  L: null,
  send(m, to) { if (this.L) this.L.send(m, to); },
  relay(m) { if (this.L && this.L.relay) this.L.relay(m); },
  direct(to) { return !!(this.L && this.L.direct(to)); },
  path(to) { return this.L ? this.L.path(to) : 'mq'; },        // 試合の通信を送る道
  via(p, m, to) { return !!(this.L && this.L.sendVia(p, m, to)); },   // 決まった道で送る（送れなかったら false）
  has(p, to) { return !!(this.L && this.L.has(p, to)); }
};

/* ---------- 部屋 ---------- */
const KN = {
  ui: 'off', room: null, host: false, code: '', rand: false, me: { id: MYID, nm: '' },
  rtt: 0, lastHost: 0, busy: false, msg: '', adT: 0, startMsg: null, startSent: 0, lastRes: null, doneMid: '', lastPub: 0
};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function myName() { const v = ($k('enetName') && $k('enetName').value || '').trim().slice(0, 12); return v || KN.me.nm || 'エビ' + (1000 + Math.floor(Math.random() * 9000)); }
KN.me.nm = lsGet('ebifry_name') || '';
const median = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] || 0; };
// ---- ホスト側の部屋 ----
// 部屋の人（ホストだけが持つ）：rtt＝使っている道の往復の時間、eff＝まとめて送る待ちも足したもの、path＝使っている道、
// pr＝道ごとの往復の時間（最近5回）、pt＝それをはかった時刻、vt＝その道で最後に何か届いた時刻
function newMem(id, nm, lo, via) {
  return { id, nm, lo, rtt: 0, eff: 0, path: '', last: realNow(), via, pr: { dc: [], rt: [], mq: [] }, pt: { dc: 0, rt: 0, mq: 0 }, vt: {}, pc: 0 };
}
function roomNew(code, rand) {
  return { code, rand: !!rand, ph: 'lobby', mem: [newMem(MYID, KN.me.nm, myCode(), '')],
    cpu: 0, lv: G.level in LVN ? G.level : 'normal', mid: '', res: null, resT: '', ver: 1, t0: Date.now(), autoAt: 0 };
}
// ---- 通信の道を選ぶ（ホストが1秒ごとに、人ごとに）----
// 道ごとに 'pp' を送って、返事（'pq'）までの時間をはかる。直接は無料で待ちもないので、よほど遅くなければ直接。
// 近くの中継は、直接がない・遅い（90ms より）ときだけはかる（通数をへらすため）。選んだ道は 'pp' で相手に知らせる
function rtCount() { const R0 = KN.room; let n = 0; if (R0) for (const m of R0.mem) if (m.id !== MYID && m.path === 'rt') n++; return n; }
function rtGap() { return RT_STEP * Math.max(1, rtCount()); }   // 近くの中継で試合の通信を送る間隔。中継を使う人が多いほどのばす
function est(m, p, now) { const a = m.pr[p]; return a.length && now - m.pt[p] < 6000 ? median(a) : Infinity; }
function rtWanted(m, now) { return RT.on && (FORCE === 'rt' || !(net.has('dc', m.id) && est(m, 'dc', now) <= 90)); }
function choosePath(m, now) {
  const n = rtCount(), g2 = RT_STEP * Math.max(1, m.path === 'rt' ? n : n + 1);   // この人も中継にしたときの間隔
  const c = {
    dc: net.has('dc', m.id) ? est(m, 'dc', now) : Infinity,
    rt: net.has('rt', m.id) && now - (m.vt.rt || 0) < (LS.on ? 2500 : 5000) ? est(m, 'rt', now) + g2 : Infinity,
    mq: net.has('mq', m.id) ? est(m, 'mq', now) + 30 : Infinity
  };
  let best = m.path && c[m.path] < Infinity ? m.path : '';
  for (const p of PATHS) if (c[p] < Infinity && (!best || c[p] + 20 < c[best])) best = p;   // 20ms 以上速いときだけ乗りかえる
  if (FORCE && c[FORCE] < Infinity) best = FORCE;
  if (!best) best = net.has('dc', m.id) ? 'dc' : 'mq';
  if (best !== m.path) { m.path = best; if (net.L && net.L.setWant) net.L.setWant(m.id, best); if (LS.on) LS.dFast = true; }
  const r = est(m, best, now);
  if (r < Infinity) m.rtt = r;
  m.eff = c[best] < Infinity ? c[best] : (m.rtt || 0) + (best === 'rt' ? g2 : best === 'mq' ? 30 : 0);
}
function probeOne(m, now) {
  choosePath(m, now);
  m.pc++;
  const gap = rtGap(), pp = q => ({ y: 'pp', t: now, p: m.path, r: Math.round(m.rtt || 0), gp: gap, q });
  if (net.has('dc', m.id)) net.via('dc', pp('dc'), m.id);
  if (net.has('mq', m.id) && (m.pc % 2 === 0 || m.path !== 'dc')) net.via('mq', pp('mq'), m.id);
  if (net.has('rt', m.id) && (m.path === 'rt' || rtWanted(m, now))) net.via('rt', pp('rt'), m.id);
}
function probeAll(now) {
  const R0 = KN.room; if (!R0 || !KN.host || !net.L) return;
  for (const m of R0.mem) if (m.id !== MYID) probeOne(m, now);
}
// 近くの中継が切れた・つながった：その道を使っている人には、すぐ道を変えて知らせる
RT.onChange(() => {
  if (!net.L) return;
  if (KN.host) { const R0 = KN.room; if (R0) { const now = realNow(); for (const m of R0.mem) if (m.id !== MYID && m.path === 'rt' && !net.has('rt', m.id)) probeOne(m, now); } }
  else if (net.L.rtLost && net.L.rtLost()) net.send({ y: 'rtx' });
});
function roomPub(to) {
  const R0 = KN.room; if (!R0 || !KN.host) return;
  R0.ver++; KN.lastPub = realNow();
  const me = R0.mem.find(m => m.id === MYID); if (me) me.lo = myCode();
  const auto = R0.autoAt ? Math.max(0, Math.ceil((R0.autoAt - realNow()) / 1000)) : 0;
  net.send({ y: 'room', v: R0.ver, code: R0.code, rand: R0.rand, ph: R0.ph, cpu: R0.cpu, lv: R0.lv, auto,
    mem: R0.mem.map(m => ({ id: m.id, nm: m.nm, lo: m.lo, rtt: Math.round(m.rtt || 0) })), res: R0.res, resT: R0.resT, mid: R0.mid }, to);
}
function autoCheck() {   // ランダムの部屋：2人そろったら20秒後（6人なら3秒後）に自動でスタート
  const R0 = KN.room; if (!R0 || !KN.host || !R0.rand || R0.ph !== 'lobby') return;
  const n = R0.mem.length;
  if (n < 2) { R0.autoAt = 0; return; }
  const want = realNow() + (n >= MAXP ? 3000 : 20000);
  if (!R0.autoAt || (n >= MAXP && R0.autoAt > want)) R0.autoAt = want;
}
function hostOnMsg(m, from, via) {
  if (!m || typeof m !== 'object') return;
  const R0 = KN.room; if (!R0) return;
  const mem = R0.mem.find(x => x.id === from);
  if (mem) { mem.last = realNow(); mem.via = via; mem.vt[via] = mem.last; }
  switch (m.y) {
    case 'hello': {
      const deny = w => { net.send({ y: 'deny', w }, from); setTimeout(() => { if (net.L && net.L.forget && !(KN.room && KN.room.mem.some(x => x.id === from))) net.L.forget(from); }, 3000); };
      if (m.p !== PROTO || m.b !== BUILD) { deny('ver'); return; }
      if (mem) { if (typeof m.nm === 'string') mem.nm = m.nm.slice(0, 12) || mem.nm; if (typeof m.lo === 'string') mem.lo = m.lo.slice(0, 80); roomPub(); return; }
      if (R0.mem.length >= MAXP) { deny('full'); return; }   // 試合中でも部屋には入れる（つぎの試合から）
      R0.mem.push(newMem(from, String(m.nm || '').slice(0, 12) || 'エビ', typeof m.lo === 'string' ? m.lo.slice(0, 80) : '', via));
      if (net.L && net.L.rtAdd) net.L.rtAdd(from);   // 近くの中継：その人のチャンネルに入っておく
      if (R0.cpu > MAXP - R0.mem.length) R0.cpu = Math.max(0, MAXP - R0.mem.length);
      autoCheck(); roomPub(); uiRender(); return;
    }
    case 'lo': if (mem && typeof m.lo === 'string') { mem.lo = m.lo.slice(0, 80); roomPub(); uiRender(); } return;
    case 'bye': if (mem) memberGone(mem, 'left'); return;
    case 'pq':   // 道ごとの往復の時間（ホストが送った 'pp' の返事。来た道の分としてかぞえる）
      if (mem && typeof m.t === 'number' && mem.pr[via]) { const t = realNow(), r = t - m.t; if (r >= 0 && r < 20000) { mem.pr[via] = mem.pr[via].concat(r).slice(-5); mem.pt[via] = t; } }
      return;
    case 'rtx': if (mem) { mem.vt.rt = 0; probeOne(mem, realNow()); } return;   // 相手の近くの中継が切れた
    case 'go': if (mem) mem.go = m.mid; return;
    case 'quit': if (mem && LS.on && LS.host && m.mid === LS.mid) quitSlot(mem.id); return;   // 試合だけやめた（部屋にはいる）
    case 'i': onInputs(m, from); return;
    case 'h': onHash(m, from); return;
    case 'who': roomPub(); return;
  }
}
// だれかがぬけた：試合中なら、その人のエビは次のステップで落ちる（ほかの人はそのまま続ける）
function memberGone(mem, why) {
  const R0 = KN.room; if (!R0) return;
  R0.mem = R0.mem.filter(x => x !== mem);
  if (why === 'lost') net.send({ y: 'kick', w: '通信が止まったので、部屋から外れました' }, mem.id);
  if (net.L && net.L.forget) net.L.forget(mem.id);
  quitSlot(mem.id);
  autoCheck();
  roomPub(); uiRender();
}
function quitSlot(id) {   // 試合中なら、その人のエビを次のステップで落とす（入力を待たない）
  if (!LS.on || !LS.host) return;
  const j = LS.list.filter(e => e.h).findIndex(e => e.id === id);
  if (j >= 0 && !LS.gone[j]) { LS.gone[j] = true; LS.qs.push(j); LS.gs.delete(id); hostFinalize(); }
}
function hostStart() {
  const R0 = KN.room; if (!R0 || !KN.host || R0.ph !== 'lobby' || R0.mem.length < 2) return;
  const lv = R0.lv in LVN ? R0.lv : 'normal', ncpu = clampN(R0.cpu | 0, 0, MAXP - R0.mem.length);
  const list = R0.mem.map(m => ({ h: 1, id: m.id, nm: m.nm, code: m.id === MYID ? myCode() : (decodeLoadout(m.lo || '') ? m.lo : '') }));
  for (let i = 0; i < ncpu; i++) list.push({ h: 0, nm: 'CPU ' + CPUN[i % CPUN.length] });
  const maxRtt = Math.max(0, ...R0.mem.filter(m => m.id !== MYID).map(m => m.eff || m.rtt || 0));
  const D = Math.max(4, Math.min(40, Math.ceil((maxRtt + 50) / TICK)));
  R0.mid = rid(); R0.ph = 'play'; R0.autoAt = 0; R0.res = null; R0.resT = '';
  const S = { y: 'start', mid: R0.mid, seed: (Math.random() * 4294967296) >>> 0, D, lv, list };
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
      if (!Array.isArray(m.mem)) return;
      if (KN.room && typeof KN.room.v === 'number' && typeof m.v === 'number' && m.v < KN.room.v && KN.room.code === m.code) return;
      const prev = KN.room; KN.room = m;
      if (LS.on && m.ph === 'lobby' && m.mid && m.mid === LS.mid) { if (Array.isArray(m.res)) KN.lastRes = m.res; KN.stopLockstep(m.resT || '試合が終わりました'); KN.msg = m.resT || ''; }
      if (!LS.on && m.ph === 'lobby' && Array.isArray(m.res) && m.mid && m.mid !== KN.resMid) { KN.lastRes = m.res; KN.resMid = m.mid; }
      if (!prev || prev.ph !== m.ph || prev.v !== m.v) uiRender();
      return;
    }
    case 'deny': KN.leave(m.w === 'full' ? 'その部屋はいっぱいです（6人まで）' : m.w === 'busy' ? 'その部屋は試合中です。おわってから入ってください' : m.w === 'ver' ? 'ゲームの版がちがいます。ページを読みなおしてから入ってください' : '入れませんでした'); return;
    case 'kick': KN.leave(m.w || '部屋から外れました'); return;
    case 'start':
      if (typeof m.mid !== 'string' || m.mid === KN.doneMid) return;
      if (LS.on && LS.mid !== m.mid) KN.stopLockstep('');
      if (!LS.on) { if (!KN.room || KN.room.mid !== m.mid) KN.room = Object.assign({}, KN.room || {}, { mid: m.mid, ph: 'play' }); KN.beginLockstep(m); }
      net.send({ y: 'go', mid: m.mid }); return;
    case 'abort': if (LS.on) KN.stopLockstep(m.w || '試合をやめました'); KN.msg = m.w || ''; uiRender(); return;
    case 'drop': if (LS.on && m.mid === LS.mid) KN.stopLockstep('しばらく止まっていたので、この試合からは外れました（つぎの試合から出られます）'); return;
    case 'dd': if (LS.on && m.mid === LS.mid && Number.isInteger(m.D)) LS.D = clampN(m.D, 2, 40); return;
    case 'f': onFrames(m); return;
    case 'snap': onSnap(m); return;
    case 'pp':   // ホストからの道しらべ：来た道で返事をする。ホストが選んだ道・往復の時間・中継で送る間隔も入っている
      if (typeof m.t === 'number' && PATHS.includes(via)) net.via(via, { y: 'pq', t: m.t });
      if (net.L && PATHS.includes(m.p)) net.L.want = m.p;
      if (typeof m.r === 'number' && m.r >= 0 && m.r < 60000) KN.rtt = m.r;
      if (net.L && Number.isInteger(m.gp)) net.L.gap = clampN(m.gp, 30, 2000);
      return;
    case 'bye': KN.leave('ホストが部屋をとじました'); return;
  }
}
// 自分の装備が変わったら、ホストに知らせる（試合は、そのときの格納庫の機体・衣・装備で）
let loT = 0;
function loChanged() {
  if (!net.L || LS.on) return;
  clearTimeout(loT);
  loT = setTimeout(() => {
    if (!net.L || LS.on) return;
    if (KN.host) { const me = KN.room && KN.room.mem.find(m => m.id === MYID); if (me) me.lo = myCode(); roomPub(); uiRender(); }
    else net.send({ y: 'lo', lo: myCode() });
  }, 300);
}
{ const f0 = window.save; if (typeof f0 === 'function') window.save = function () { const r = f0.apply(this, arguments); try { loChanged(); } catch (e) {} return r; }; }

/* ---------- 試合（ロックステップの始まりと終わり） ---------- */
KN.beginLockstep = function (S) {
  if (LS.on || !S || !Array.isArray(S.list) || S.list.length < 2 || S.list.length > MAXP) return;
  const list = S.list.map(e => ({ h: e.h ? 1 : 0, id: e.h ? String(e.id || '') : '', nm: String(e.nm || '').slice(0, 16) || 'エビ', code: e.h ? String(e.code || '') : '' }));
  const hk = []; list.forEach((e, k) => { if (e.h) hk.push(k); });
  const meK = list.findIndex(e => e.h && e.id === MYID);
  if (meK < 0) return;
  const lv = S.lv in LVN ? S.lv : 'normal', D = Math.max(2, Math.min(60, S.D | 0));
  LS.meK = meK; LS.list = list;
  const { w, ctrls } = (() => { try { clearBattleVisuals(); } catch (e) {} return buildWorld({ seed: S.seed, list, lv }); })();
  G.world = w; G.ctrl = {}; G.acc = 0; G.endT = null; G.camPos = null;
  const L = G.local; L.clearEdges(); L.fireHeld = false; L.tsx = L.tsy = 0; L.keys = {};
  Object.assign(LS, {
    host: KN.host, n: hk.length, slot: hk.indexOf(meK), meK, list, hk, ctrls, D, D0: D, lastTgt: D - 1, lastInp: 0, dT: realNow(), dWait: 0, dLow: 0, dFast: false, tick: 0, mid: S.mid,
    frames: new Map(), snaps: new Map(), inb: hk.map(() => new Map()), nf: D, ackIn: hk.map(() => D - 1), gs: new Map(), gone: hk.map(() => false), qs: [],
    myIn: new Map(), myTop: D - 1, sentIn: D - 1, hostAck: D - 1, lf: D - 1, lastSendIn: 0, lastResendIn: 0, rlt: 0,
    budget: 0, lastReal: realNow(), lastStep: realNow(), lastFrameAt: realNow(), hh: new Map(), gh: new Map(),
    snapReq: false, snapPend: -1, fixes: 0, desync: 0, err: 0, endT: -1, deadAt: list.map(() => -1), leftK: list.map(() => false), rank: null, specId: null,
    stats: { steps: 0, stall: 0, ms: 0, frames: 0, wait: 0, slow: 0 }, repW: 0, repS: 0, dSlow: 0, dN: 0
  });
  if (KN.host && KN.room) KN.room.mem.forEach(m => { const j = hk.findIndex(k => list[k].id === m.id); if (m.id !== MYID && j >= 0) LS.gs.set(m.id, { id: m.id, slot: j, sent: D - 1, ack: D - 1, rs: 0, lt: 0, lastIn: realNow() }); });
  try { setRear(false); buildWazaButtons(w.get('p1')); Snd.init(); Snd.play('start'); } catch (e) {}
  setState('battle');
  try { if (G.stickHome) G.stickHome(); $k('stickHint').hidden = false; } catch (e) {}
  LS.on = true;
  document.documentElement.classList.add('enet-play');
  KN.ui = 'play'; uiRender();
};
KN.stopLockstep = function (why) {
  if (!LS.on) return;
  if (LS.host) try { sendFrames(true); } catch (e) {}   // 中継のときにまとめて待っているフレームも、送ってから
  LS.on = false; KN.doneMid = LS.mid;
  document.documentElement.classList.remove('enet-play', 'enet-dead');
  spec.hidden = true; spec._t = '';
  try { clearBattleVisuals(); } catch (e) {}
  G.world = null; G.endT = null; G.ctrl = {};
  try { setState('hangar'); } catch (e) {}
  KN.msg = why || '';
  KN.ui = KN.room ? 'room' : 'menu'; uiRender();
};
KN.matchOver = function () {
  const rows = LS.rank || ranking(), R0 = KN.room;
  const res = rows.map(r => ({ nm: r.nm, cpu: r.cpu, kills: r.kills, dealt: r.dealt, alive: r.alive, left: r.left, id: r.cpu ? '' : LS.list[r.k].id }));
  const txt = resText(res);
  KN.lastRes = res; KN.resMid = LS.mid;
  const win = rows[0] && rows[0].me;
  KN.stopLockstep('');
  KN.msg = txt;
  try { Snd.play(win ? 'win' : 'lose'); } catch (e) {}
  if (KN.host && R0) { R0.ph = 'lobby'; R0.res = res; R0.resT = txt; autoCheck(); if (R0.rand && R0.autoAt) R0.autoAt = Math.max(R0.autoAt, realNow() + 15000); roomPub(); }
  uiRender();
};
function resText(res) {
  const w = res[0]; if (!w) return '試合終了';
  return `試合終了：${w.cpu ? w.nm : w.nm + ' さん'} の勝ち！`;
}
KN.hostAbort = function (why) { if (!KN.host) return; net.send({ y: 'abort', w: why }); const R0 = KN.room; if (R0) { R0.ph = 'lobby'; R0.resT = why; } KN.stopLockstep(why); roomPub(); };

/* ---------- 毎フレーム（ネット対戦のあいだ：ステップを進めて、1回だけ描く） ---------- */
const origFrame = window.frame;
window.frame = function (now) {
  if (!LS.on) return origFrame(now);
  requestAnimationFrame(window.frame);
  netFrame(now);
};
// 描くのが重い端末：フレームの間隔が長い（1秒に40回くらいより少ない）ことが続いたら、画面のこまかさを少しずつ下げる（1まで。もどさない）
const PRF = { ema: TICK, t: 0 };
function perfAdapt(el) {
  const ms = Math.min(el, 100); PRF.ema += (ms - PRF.ema) * 0.05; PRF.t += ms;
  if (PRF.t < 1500) return;
  PRF.t = 0;
  const rd = R.renderer, cur = rd.getPixelRatio();
  if (PRF.ema > 24 && cur > 1) { rd.setPixelRatio(Math.max(1, cur - 0.25)); PRF.ema = TICK; }
}
function netFrame(now) {
  const dt = Math.min(.1, (now - (G.last || now)) / 1000); G.last = now;
  LS.stats.frames++;
  const t = realNow();
  const el = Math.min(t - LS.lastReal, 500); LS.lastReal = t;
  try { perfAdapt(el); } catch (e) {}
  // どこまでフレームが届いているか（ホストは、まとめおわったところまで）
  let ahead; if (LS.host) ahead = LS.nf - LS.tick; else { let x = LS.tick; while (LS.frames.has(x)) x++; ahead = x - LS.tick; }
  // なめらかに進める：届いたフレームがへってきたら少しゆっくり（止まるのをへらす）。参加者は、ためすぎたら少し速く（ホストの速さが基準）。
  // 大きくおくれているときは、おくれに合わせて速く（最大5倍）。止まったあとは一気に進めず、1フレームに1ステップ多いくらいで追いつく
  const BUF = LS.host ? 1 : 2;
  let rate = 1;
  if (ahead > LS.D + 6) rate = 1 + Math.min(4, (ahead - LS.D - 6) / 10);
  else if (ahead < BUF) { rate = 0.92; LS.stats.slow++; }
  else if (!LS.host && ahead > BUF + 3 && net.path() === 'dc') rate = 1.04;   // 中継のときは、まとめて届くのでそのまま（通数がふえないように）
  LS.budget = Math.min(LS.budget + el * rate, Math.max(TICK * 6, el * rate + TICK * 2));
  let maxSteps = Math.min(15, Math.max(2, Math.ceil(el * rate / TICK) + 1));
  if (ahead > LS.D + 6) maxSteps = Math.max(maxSteps, 8);
  let steps = 0;
  while (LS.on && LS.budget >= TICK - 0.5 && steps < maxSteps && canStep(LS.tick)) { stepOnce(); LS.budget -= TICK; steps++; }
  if (!LS.on) return;
  if (LS.budget >= TICK - 0.5 && steps < maxSteps && !canStep(LS.tick)) LS.stats.wait++;   // 進めたいのに、フレーム（だれかの入力）を待っている
  if (steps) LS.lastStep = t; else if (t - LS.lastStep > 300) LS.stats.stall++;
  if (LS.host) sendFrames(false); else sendInputs(false);
  const w = G.world;
  try {
    for (const e of w.events) if (e.t === 'ko' && e.id === 'p1' && e.by) LS.specId = e.by;   // 自分を落とした相手を見る
    handleEvents(w);
    const alpha = Math.max(0, Math.min(1, LS.budget / TICK));
    syncWorld(w, alpha, dt); updateParticles(dt);
    camera(w, dt, alpha);
    updateHud(w);
    const rd = R.renderer; rd.setViewport(0, 0, innerWidth, innerHeight); rd.setClearColor('#cfeaf6'); rd.clear(); rd.render(R.scene, R.camera);
  } catch (e) { console.error('[ebifry net] draw', e); }
  uiPlay(t);
}
// 落ちたあとは、だれかを後ろから見る（観戦）
function camera(w, dt, alpha) {
  const me = w.get('p1');
  if (me && me.dead) {
    let f = LS.specId != null ? w.get(LS.specId) : null;
    if (!f || f.dead) { f = w.fighters.find(o => !o.dead) || null; LS.specId = f ? f.id : null; }
    if (f) { specCam(f, dt, alpha); return; }
  }
  updateCamera(w, dt, alpha);
}
function specCam(f, dt, alpha) {
  const cam = R.camera;
  const x = f.px + (f.x - f.px) * alpha, y = f.py + (f.y - f.py) * alpha, z = f.pz + (f.z - f.pz) * alpha;
  const F = fwdOf(f.pyaw + wrapAngle(f.yaw - f.pyaw) * alpha, f.ppitch + (f.pitch - f.ppitch) * alpha);
  const B = BODIES[f.body] || BODIES.magari, dist = 14 + 3 * B.r, up = 4.5 + 1.2 * B.r;
  const want = new THREE.Vector3(x - F.x * dist, y - F.y * dist + up, z - F.z * dist);
  if (!G.camPos || G.specFor !== f.id) { G.camPos = want.clone(); G.specFor = f.id; } else G.camPos.lerp(want, 1 - Math.exp(-9 * dt));
  cam.position.copy(G.camPos);
  cam.lookAt(x + F.x * 10, y + F.y * 10 + 1.5, z + F.z * 10);
  cam.fov += ((G.fov || 68) - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix();
}
function specNext() {
  const w = G.world; if (!LS.on || !w) return;
  const alive = w.fighters.filter(o => !o.dead && o.id !== 'p1'); if (!alive.length) return;
  const i = alive.findIndex(o => o.id === LS.specId);
  LS.specId = alive[(i + 1) % alive.length].id;
}
function uiPlay(now) {
  const w = G.world, me = w && w.get('p1');
  const stall = now - LS.lastStep > 400;
  let rtt = 0, pth = '';   // ホストは、いちばん遅い人の分を出す
  if (LS.host) { let w = null; if (KN.room) for (const m of KN.room.mem) if (m.id !== MYID && LS.gs.has(m.id) && (!w || (m.rtt || 0) > (w.rtt || 0))) w = m; if (w) { rtt = w.rtt || 0; pth = w.path; } }
  else { rtt = KN.rtt; pth = net.path(); }
  const txt = stall ? '🌐 <b>通信待ち…</b>' : `🌐 ${Math.round(rtt)}ms${PNAME[pth] ? '・' + PNAME[pth] : ''}`;
  if (badge._t !== txt) { badge._t = txt; badge.innerHTML = txt; }
  let sp = '', win = false;
  if (LS.endT >= 0 && LS.rank) { const r = LS.rank[0]; win = true; sp = r ? (r.me ? 'あなたの勝ち！' : esc(r.cpu ? r.nm : r.nm + ' さん') + ' の勝ち') : ''; }
  else if (me && me.dead) { const f = LS.specId != null ? w.get(LS.specId) : null; sp = f ? `落ちました。観戦中：<b>${esc(f.name)}</b><u>切りかえ</u>` : '落ちました'; }
  if (spec._t !== sp) { spec._t = sp; spec.innerHTML = sp; spec.hidden = !sp; spec.classList.toggle('win', win); }
  document.documentElement.classList.toggle('enet-dead', !!(me && me.dead));
}

/* ---------- 定期の仕事（1秒ごと：道しらべ・いなくなった人・ランダムの募集・自動スタート） ---------- */
setInterval(() => {
  if (!net.L) return;
  const now = realNow(), R0 = KN.room;
  if (KN.host && R0) {
    probeAll(now);
    for (const m of R0.mem.slice()) if (m.id !== MYID && now - m.last > (LS.on ? 9000 : 15000)) memberGone(m, 'lost');
    // 試合の入力が12秒とどかない人（画面を切りかえて止まっているなど）は、この試合からだけ外す（部屋にはのこる）
    if (LS.on && LS.host) for (const g of [...LS.gs.values()]) if (now - g.lastIn > 12000) { net.send({ y: 'drop', mid: LS.mid }, g.id); quitSlot(g.id); LS.gs.delete(g.id); }
    if (R0.ph === 'play' && LS.on && KN.startMsg && now - KN.startSent > 1000) {
      const yet = R0.mem.filter(m => m.id !== MYID && m.go !== R0.mid && LS.list.some(e => e.h && e.id === m.id));
      if (yet.length && LS.tick < 600) { net.send(KN.startMsg); KN.startSent = now; }
    }
    if (LS.on && LS.host) adaptD(now);
    if (R0.ph === 'lobby' && R0.autoAt && now >= R0.autoAt) { R0.autoAt = 0; if (R0.mem.length >= 2) hostStart(); }
    if (R0.rand && R0.ph === 'lobby' && R0.mem.length < MAXP && now - KN.adT > 2000) advertise();
    if (!LS.on && now - KN.lastPub > 2000) roomPub();
    else if (LS.on && now - KN.lastPub > 5000) roomPub();
  } else if (R0) {
    if (now - KN.lastHost > (LS.on ? 9000 : 15000)) { KN.leave('ホストとの通信が切れました'); return; }
    if (LS.on && now - LS.lastFrameAt > 20000) { net.send({ y: 'quit', mid: LS.mid }); KN.stopLockstep('ホストからの通信が止まったので、試合をやめました'); }
    const me = R0.mem && R0.mem.find(x => x.id === MYID);
    if (!me) net.send({ y: 'hello', nm: KN.me.nm, lo: myCode(), b: BUILD, p: PROTO });
  }
  if (!LS.on) uiRender(true);
}, 1000);

/* ---------- 部屋をつくる・入る・ランダム ---------- */
function newCode() { return String(1000 + Math.floor(Math.random() * 9000)); }
KN.create = async function (rand) {
  if (KN.busy) return; KN.busy = true; KN.msg = ''; KN.ui = 'wait'; KN.waitText = '部屋をつくっています…'; uiRender();
  KN.me.nm = myName(); lsSet('ebifry_name', KN.me.nm);
  try {
    let L = null, code = '';
    for (let i = 0; i < 6 && !L; i++) {
      code = newCode();
      try { L = await linkHost(code, hostOnMsg); } catch (e) { if (!e || e.code !== 'taken') throw e; }
    }
    if (!L) throw { code: 'taken' };
    net.L = L; KN.host = true; KN.code = code; KN.rand = !!rand;
    KN.room = roomNew(code, rand); KN.room.mem[0].nm = KN.me.nm;
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
  KN.me.nm = myName(); lsSet('ebifry_name', KN.me.nm);
  let L = null;
  try { L = await linkGuest(code, guestOnMsg); } catch (e) { L = null; }
  if (!L) { KN.busy = false; KN.msg = '入れませんでした'; KN.ui = 'menu'; uiRender(); return false; }
  net.L = L; KN.host = false; KN.code = code; KN.room = null; KN.lastHost = realNow();
  const t0 = realNow();
  while (realNow() - t0 < 15000 && net.L === L) {
    net.send({ y: 'hello', nm: KN.me.nm, lo: myCode(), b: BUILD, p: PROTO });
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
  if (net.L) { try { net.send({ y: 'bye' }); } catch (e) {} const L = net.L; setTimeout(() => L.close(), 150); }
  net.L = null; KN.room = null; KN.host = false; KN.code = ''; KN.rand = false; KN.startMsg = null; KN.lastRes = null;
  if (KN.seekUnsub) { KN.seekUnsub(); KN.seekUnsub = null; }
  KN.msg = why || ''; KN.ui = why ? 'menu' : 'off'; uiRender();
};
// ランダム：募集中の部屋をさがして入る。なければ部屋をつくって待つ（もっと古い部屋が見つかったら、そっちへ移る）
function advertise() {
  const R0 = KN.room; if (!R0 || !KN.host || !R0.rand) return;
  KN.adT = realNow();
  MQ.pub(`${PFX}/lobby/ffa`, { y: 'open', code: R0.code, n: R0.mem.length, max: MAXP, t0: R0.t0, host: MYID, b: BUILD, ph: R0.ph });
}
KN.random = async function () {
  if (KN.busy) return; KN.busy = true; KN.msg = ''; KN.ui = 'wait'; KN.waitText = 'あいてをさがしています…'; uiRender();
  KN.me.nm = myName(); lsSet('ebifry_name', KN.me.nm);
  const ok = Q.get('enet') === 'bc' ? false : await MQ.ready(8000);
  if (!ok) { KN.busy = false; KN.msg = 'ランダムは使えません（中継サーバーにつながりません）。部屋コードで遊んでください'; KN.ui = 'menu'; uiRender(); return; }
  const topic = `${PFX}/lobby/ffa`, found = new Map();
  const un = MQ.sub(topic, m => {
    if (!m || typeof m !== 'object') return;
    const fit = m.y === 'open' && m.host !== MYID && m.b === BUILD && m.n < m.max && m.ph === 'lobby' && /^\d{4}$/.test(m.code || '');
    if (fit) found.set(m.code, m);
    if (m.y === 'q' && KN.host && KN.room && KN.room.rand) advertise();
    if (fit && KN.host && KN.room && KN.room.rand && KN.room.ph === 'lobby' && KN.room.mem.length === 1
      && (m.t0 < KN.room.t0 || (m.t0 === KN.room.t0 && m.code < KN.room.code)) && !KN.moving) {
      KN.moving = true;
      const code = m.code;
      setTimeout(async () => { KN.leave(''); KN.ui = 'wait'; KN.waitText = 'あいてが見つかりました…'; uiRender(); KN.busy = false; await KN.join(code); KN.moving = false; }, 50);
    }
  });
  KN.seekUnsub = un;
  MQ.pub(topic, { y: 'q' });
  await wait(2500);
  const list = [...found.values()].sort((a, b) => (b.n - a.n) || (a.t0 - b.t0));
  KN.busy = false;
  for (const r of list) { if (await KN.join(r.code, true)) return; }
  await KN.create(true);
  KN.seekUnsub = un;
};

/* ---------- 画面 ---------- */
const CSS = `
#enet{position:fixed;inset:0;z-index:30;background:rgba(20,12,8,.82);display:none;overflow:auto;touch-action:pan-y;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px calc(env(safe-area-inset-bottom,0px) + 16px);box-sizing:border-box;font-family:var(--body);color:var(--tartar);-webkit-user-select:none;user-select:none}
#enet.on{display:block}
#enet .ebox{max-width:560px;margin:0 auto;background:var(--soy-2);border:1px solid var(--line);border-radius:18px;padding:16px}
#enet h2{margin:0 0 10px;font:400 24px var(--display);color:var(--fry);text-shadow:2px 2px 0 var(--fry-deep)}
#enet .er{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}
#enet button{font:900 15px var(--body);color:var(--tartar);background:var(--soy);border:2px solid var(--line);border-radius:12px;padding:9px 14px;cursor:pointer}
#enet button.big{flex:1 1 140px;font-size:17px;padding:12px 14px}
#enet button.go2{font-family:var(--display);font-weight:400;font-size:20px;letter-spacing:.04em;color:var(--soy);background:var(--fry);border-color:var(--fry);box-shadow:0 4px 0 var(--fry-deep)}
#enet button:disabled{opacity:.45;cursor:default;box-shadow:none}
#enet button[aria-pressed="true"]{border-color:var(--fry);background:var(--soy-3)}
#enet input,#enet select{font:700 16px var(--body);padding:8px 10px;border-radius:10px;border:2px solid var(--line);background:var(--soy);color:var(--tartar);min-width:0;-webkit-user-select:text;user-select:text}
#enet input#enetCode{width:6.5em;letter-spacing:.15em;text-align:center}
#enet .ec{font-size:14px;margin:2px 0 8px}#enet .ec b{font:400 30px var(--display);letter-spacing:.12em;margin:0 6px;color:var(--fry)}
#enet ul{list-style:none;padding:0;margin:6px 0}
#enet li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;background:var(--soy);margin:4px 0;font-size:14px}
#enet li.me{outline:2px solid var(--fry)}
#enet li.cpu{opacity:.8}
#enet li .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:0}
#enet li small{color:var(--tartar-dim);font-size:12px;font-weight:700}
#enet .em{min-height:1.2em;color:var(--fry);margin-top:8px;font-size:14px;font-weight:700}
#enet .en{font-size:12px;color:var(--tartar-dim);line-height:1.65;margin:8px 0 0}
#enet .ex{float:right;background:var(--ketchup)!important;border-color:var(--ketchup)!important;padding:7px 12px!important;font-size:14px!important}
#enet table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0}
#enet td,#enet th{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left}
#enet th{color:var(--tartar-dim);font-size:11px}
#enet td.n{text-align:right;font-variant-numeric:tabular-nums}
#enet .lbl{font-size:12px;font-weight:900;color:var(--tartar-dim);margin-right:4px}
#m-online{border-color:var(--fry)!important}
html.enet-dead #pad,html.enet-dead #stickZone,html.enet-dead #bRear,html.enet-dead #reticle{display:none!important}
#enetMe{display:none;font-size:11px;font-weight:700;color:var(--tartar-dim)}
#enetMe b{color:var(--fry)}
html.enet-play #enetMe{display:block}
#enetSpec{position:fixed;left:50%;top:30%;transform:translateX(-50%);z-index:8;background:rgba(43,27,18,.8);color:var(--tartar);border-radius:12px;padding:7px 14px;font:700 14px var(--body);text-align:center;cursor:pointer;pointer-events:auto;max-width:calc(100vw - 32px);box-sizing:border-box}
#enetSpec b{color:var(--fry)}#enetSpec u{display:inline-block;text-decoration:none;border:1px solid rgba(251,241,220,.4);border-radius:8px;padding:0 8px;margin-left:6px;font-size:12px}
#enetSpec.win{font:400 22px var(--display);color:var(--fry);text-shadow:2px 2px 0 var(--soy);background:rgba(43,27,18,.55);pointer-events:none}
`;
const stl = document.createElement('style'); stl.textContent = CSS; document.head.appendChild(stl);
const ov = document.createElement('div'); ov.id = 'enet';
ov.innerHTML = '<div class="ebox"><button class="ex" type="button" data-k="close">✕ とじる</button><h2>🌐 ネット対戦</h2><div id="enetBody"></div><div id="enetMsg" class="em"></div></div>';
document.body.appendChild(ov);
const badge = document.createElement('div'); badge.id = 'enetMe';
{ const me = document.querySelector('#hud .me'); (me || document.body).appendChild(badge); }
const spec = document.createElement('div'); spec.id = 'enetSpec'; spec.hidden = true; document.body.appendChild(spec);
KN.open = function () { KN.ui = net.L ? (LS.on ? 'play' : 'room') : 'menu'; uiRender(); };
const onlineBtn = $k('m-online'), goBtn = $k('go'), GO0 = goBtn ? goBtn.textContent : '出撃する';
if (onlineBtn) { onlineBtn.disabled = false; onlineBtn.onclick = () => KN.open(); }
let lastRender = '';
function memRows(R0) {
  const mem = R0.mem || [];
  let h = '';
  mem.forEach((m, i) => {
    const r = m.id === MYID ? '' : KN.host ? (m.rtt ? Math.round(m.rtt) + 'ms' + (PNAME[m.path] ? '・' + PNAME[m.path] : '') : '') : (i === 0 && KN.rtt ? Math.round(KN.rtt) + 'ms・' + PNAME[net.path()] : '');
    h += `<li class="${m.id === MYID ? 'me' : ''}"><span><i class="dot" style="background:${PAL[i % PAL.length]}"></i><b>${esc(m.nm)}</b>${m.id === MYID ? ' <small>（あなた）</small>' : ''}${i === 0 ? ' <small>ホスト</small>' : ''}<br><small>${esc(loInfo(m.lo) || '（機体を待っています）')}</small></span><small>${r}</small></li>`;
  });
  const nc = Math.min(R0.cpu | 0, MAXP - mem.length);
  for (let i = 0; i < nc; i++) h += `<li class="cpu"><span><i class="dot" style="background:${PAL[(mem.length + i) % PAL.length]}"></i>CPU ${esc(CPUN[i % CPUN.length])} <small>${esc(LVN[R0.lv] || '')}</small></span><small>CPU</small></li>`;
  return `<ul>${h}</ul>`;
}
function resTable(res) {
  if (!Array.isArray(res) || !res.length) return '';
  const rows = res.map((r, i) => `<tr><td>${i + 1}位</td><td>${esc(r.nm)}${r.id === MYID ? ' <small>（あなた）</small>' : ''}${r.left ? ' <small>（ぬけた）</small>' : ''}</td><td class="n">${r.kills | 0}</td><td class="n">${r.dealt | 0}</td></tr>`).join('');
  return `<table><tr><th>順位</th><th>なまえ</th><th class="n">落とした</th><th class="n">ダメージ</th></tr>${rows}</table>`;
}
function uiRender(soft) {
  const show = KN.ui === 'menu' || KN.ui === 'wait' || (KN.ui === 'room' && !LS.on);
  ov.classList.toggle('on', show);
  { const inR = !!(net.L && KN.room);
    const t1 = inR ? `🌐 部屋 ${esc(KN.code)}<small>${(KN.room.mem || []).length}人・ひらく</small>` : '🌐 ネット対戦<small>6人まで</small>';
    if (onlineBtn && onlineBtn._t !== t1) { onlineBtn._t = t1; onlineBtn.innerHTML = t1; }
    const t2 = inR ? '🌐 部屋の画面へ' : GO0;
    if (goBtn && goBtn._t !== t2) { goBtn._t = t2; goBtn.textContent = t2; } }
  const body = $k('enetBody'), mm = $k('enetMsg');
  let h = '';
  if (KN.ui === 'menu') {
    h = `<div class="er"><label><span class="lbl">なまえ</span><input id="enetName" maxlength="12" value="${esc(KN.me.nm)}" placeholder="エビ" autocomplete="off"></label></div>
      <div class="er"><button class="big go2" type="button" data-k="create">部屋をつくる</button><button class="big" type="button" data-k="random">ランダム</button></div>
      <div class="er"><input id="enetCode" inputmode="numeric" maxlength="4" placeholder="1234" autocomplete="off"><button type="button" data-k="join">コードで入る</button></div>
      <p class="en">最大6人の乱戦（全員が敵）。最後まで飛んでいた人の勝ちです。ホストは CPU を足せます。<br>「部屋をつくる」と4けたの部屋コードが出ます。友だちは「コードで入る」にそのコードを入れます。「ランダム」は、相手をさがしている人と組みます。<br>それぞれ自分の格納庫の機体・衣・装備で出撃します（所持金は使いません）。<br>通信は、いちばん速い道を自動で選びます（直接 → 中継 → 遠い中継）。通信が遅いと、操作が少しおくれて届きます。</p>`;
  } else if (KN.ui === 'wait') {
    h = `<p>${esc(KN.waitText || 'つないでいます…')}</p><div class="er"><button type="button" data-k="cancel">やめる</button></div>`;
  } else if (KN.ui === 'room' && KN.room) {
    const R0 = KN.room, mem = R0.mem || [], n = mem.length, free = MAXP - n;
    let ctl = '';
    const last = KN.lastRes && (R0.ph === 'lobby') ? `<p class="en" style="margin-top:2px">この前の試合</p>${resTable(KN.lastRes)}` : '';
    if (KN.host && R0.ph === 'lobby') {
      const opts = []; for (let i = 0; i <= free; i++) opts.push(`<option value="${i}"${(R0.cpu | 0) === i ? ' selected' : ''}>${i}体</option>`);
      ctl = `<div class="er"><span class="lbl">CPU</span><select id="enetCpu">${opts.join('')}</select>${['easy', 'normal', 'hard'].map(v => `<button type="button" data-lv="${v}" aria-pressed="${R0.lv === v}">${LVN[v]}</button>`).join('')}</div>
        <div class="er"><button class="big go2" type="button" data-k="start" ${n >= 2 ? '' : 'disabled'}>${n >= 2 ? '出撃（スタート）' : 'あと1人そろうと出撃できます'}</button></div>`;
      if (R0.autoAt) ctl += `<p class="en">${Math.max(0, Math.ceil((R0.autoAt - realNow()) / 1000))} 秒後に自動でスタートします</p>`;
    } else if (R0.ph === 'lobby') {
      ctl = `<p class="en">${n >= 2 ? 'ホストがスタートするのを待っています' : 'あと1人そろうのを待っています'}${R0.auto ? `（${R0.auto} 秒後に自動でスタート）` : ''}</p>`;
    } else if (R0.ph === 'play') ctl = `<p class="en">${LS.on ? '試合中です' : '試合中です。おわったら、つぎの試合から出られます'}</p>`;
    h = `<div class="ec">部屋<b>${esc(R0.code)}</b>乱戦（${n}人${(R0.cpu | 0) ? '＋CPU ' + Math.min(R0.cpu | 0, free) + '体' : ''}）${R0.rand ? '・ランダム' : ''}</div>${memRows(R0)}${ctl}${last}
      <div class="er"><button type="button" data-k="hangar">格納庫で装備を変える</button><button type="button" data-k="leave">部屋を出る</button></div>
      <p class="en">友だちには、このページで「ネット対戦」→「コードで入る」に <b>${esc(R0.code)}</b> を入れてもらいます。試合は、そのときの格納庫の機体・衣・装備で出撃します。</p>`;
  }
  const typing = document.activeElement && (document.activeElement.id === 'enetCpu' || document.activeElement.id === 'enetName' || document.activeElement.id === 'enetCode');
  if (!soft || !typing) { if (h !== lastRender) { lastRender = h; body.innerHTML = h; } }
  mm.textContent = KN.msg || '';
}
ov.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !ov.contains(b)) return;
  if (b.dataset.lv) { const R0 = KN.room; if (R0 && KN.host && R0.ph === 'lobby' && LVN[b.dataset.lv]) { R0.lv = b.dataset.lv; roomPub(); uiRender(); } return; }
  const k = b.dataset.k;
  if (k === 'close') { if (net.L) { KN.ui = 'off'; uiRender(); } else { KN.ui = 'off'; KN.msg = ''; uiRender(); } }
  else if (k === 'create') KN.create(false);
  else if (k === 'random') KN.random();
  else if (k === 'join') KN.join($k('enetCode').value);
  else if (k === 'cancel') KN.leave('');
  else if (k === 'leave') { if (confirm('部屋を出ますか？')) KN.leave(''); }
  else if (k === 'start') hostStart();
  else if (k === 'hangar') { KN.ui = 'off'; uiRender(); }
});
ov.addEventListener('change', e => {
  if (e.target.id === 'enetCpu' && KN.host && KN.room && KN.room.ph === 'lobby') { KN.room.cpu = clampN(+e.target.value | 0, 0, MAXP - KN.room.mem.length); roomPub(); uiRender(); }
  if (e.target.id === 'enetName') { KN.me.nm = myName(); lsSet('ebifry_name', KN.me.nm); }
});
ov.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'enetCode') { e.preventDefault(); KN.join(e.target.value); } });
ov.addEventListener('keyup', e => e.stopPropagation());
spec.addEventListener('click', () => specNext());
addEventListener('pagehide', () => { if (net.L) try { net.send({ y: 'bye' }); } catch (e) {} });
// 試合中の「やめる」は、部屋を出る。部屋にいるあいだの「出撃する」は、部屋の画面をひらく
addEventListener('click', e => {
  const t = e.target && e.target.closest ? e.target : null; if (!t) return;
  if (LS.on && t.closest('#quit')) { e.stopImmediatePropagation(); e.preventDefault(); if (confirm('試合をやめて、部屋を出ますか？')) KN.leave(''); }
  else if (net.L && !LS.on && (t.closest('#go') || t.closest('#again'))) { e.stopImmediatePropagation(); e.preventDefault(); KN.open(); }
}, true);

window.ENET = { KN, LS, MQ, RT, net, BUILD, MYID, stateHash, capSnap, applySnap, DMATH, ranking, mb32, setD, rtGap, PNAME };
})();
