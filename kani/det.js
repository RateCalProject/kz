/* カニノケンカ 3D：どの端末でも同じ計算にするための下ごしらえ（風の芽経済組で足したもの。ネット対戦のため）
   ゲームの本体を読みこむあいだだけ、Math.sin などを「どの端末・ブラウザでも同じ答えの計算」に、Math.random を「決まった種の乱数」にする
   （ステージの形や置き物の位置が、どの端末でもぴったり同じになるように）。読みおわったら KDET.restore() で元にもどす。
   three.js の物を作るときの乱数（ID）は、ゲームの乱数とは別にする。three.js のあと・ゲームの本体の前に読みこむ */
(function () {
/* 決まった計算の Math（どの端末・ブラウザでも同じ答えになるように、+ − × ÷ と sqrt だけで計算する）
   fdlibm / musl の方法をもとにしたもの。ネット対戦の1ステップのあいだだけ Math.sin などと入れかえる */
const DMATH = (() => {
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

function mkRng(seed) {
  let a = 0, b = 0, c = 0, dd = 0, s = seed | 0;
  const sm = () => { s = (s + 0x9e3779b9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) | 0; };
  a = sm(); b = sm(); c = sm(); dd = sm();
  const r = {
    next() { const t = (((a + b) | 0) + dd) | 0; dd = (dd + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0; return (t >>> 0) / 4294967296; },
    get() { return [a, b, c, dd]; },
    set(v) { a = v[0] | 0; b = v[1] | 0; c = v[2] | 0; dd = v[3] | 0; }
  };
  for (let i = 0; i < 16; i++) r.next();
  return r;
}
const MK = Object.keys(DMATH), NAT = { random: Math.random, m: {} };
MK.forEach(k => { NAT.m[k] = Math[k]; });
const K = window.KDET = { DMATH, mkRng, NAT, uuid: 0 };
// three.js の物を作っているあいだは、ふつうの乱数（ID 用）
if (window.THREE) for (const name of Object.keys(THREE)) {
  const C = THREE[name];
  if (typeof C !== 'function' || !/^[A-Z]/.test(name) || !C.prototype) continue;
  try {
    const W = class extends C { constructor(...a) { K.uuid++; try { super(...a); } finally { K.uuid--; } } };
    Object.defineProperty(W, 'name', { value: C.name });
    THREE[name] = W;
  } catch (e) {}
}
const rng = mkRng(20261021);
Math.random = function () { return K.uuid ? NAT.random() : rng.next(); };
MK.forEach(k => { Math[k] = DMATH[k]; });
K.restore = function () { Math.random = NAT.random; MK.forEach(k => { Math[k] = NAT.m[k]; }); K.restore = function () {}; };
})();
