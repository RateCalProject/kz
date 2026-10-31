/* ===== 国土の天気（t62・2026-10-31） =====
   季節・時刻（日本時間）・場所だけで決まる。乱数の種は固定なので、だれが見ても同じ天気になる（サーバーはいらない）
   - 首都 美東区（y = 54 マス）の平年：春 21℃・夏 28℃・秋 19℃・冬 14℃。夏の最高 31℃・冬の最低 −2℃（本人の目安）
   - 北（y が小さい）ほど寒い。冬ほど差が大きい（北の 300km より先は、冬は雪国）。南は少し暖かい
   - 高いところほど寒い（100m で 0.65℃）
   - 雲のかたまりは、西から東へ動いていく（1時間に 30km ぐらい）。0℃ぐらいより寒いと雪、そのすこし上はみぞれ
   - 積もった雪：150日前から6時間ごとに、降った雪をたして、暖かいととかす
   使いかた：MapWx.now(x, y, e) → { T, w, ic, nm, hi, lo, snow, … }（x・y はマス、e は標高 m）
            MapWx.days(x, y, e, n) → きょうから n 日の { date, hi, lo, w, ic, nm }
            MapWx.hours(x, y, e, n, step) → いまから step 時間ごとに n こ { ms, hr, T, w, ic, nm } */
(function () {
'use strict';
const CAPY = 54;           // 首都 美東区の y（マス）
const KM = 0.05;           // 1マス ≒ 50m
const HR = 3600000, DAY = 86400000, JST = 9 * HR;

/* ---- 場所と時刻だけで決まる乱数 ---- */
function hash3(i, j, k, s) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x1b873593) ^ Math.imul(s | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296 * 2 - 1;   // −1〜1
}
const sm = t => t * t * (3 - 2 * t);
// なめらかな雑音。格子の大きさ：場所 a km・時刻 b 時間
function noise(xk, yk, th, a, b, s) {
  const fx = xk / a, fy = yk / a, ft = th / b, i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(ft);
  const u = sm(fx - i), v = sm(fy - j), w = sm(ft - k);
  let r = 0;
  for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++)
    r += hash3(i + di, j + dj, k + dk, s) * (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w);
  return r;
}
// 気温のずれ（何日もつづく暖かい・寒い）と、雲（半日ぐらい）。どちらも西から東へ動く
const nA = (xk, yk, th) => 0.8 * noise(xk - 28 * th, yk, th, 450, 70, 11) + 0.5 * noise(xk - 20 * th, yk, th, 1100, 220, 12);
const nC = (xk, yk, th) => 0.8 * noise(xk - 32 * th, yk, th, 170, 20, 21) + 0.4 * noise(xk - 32 * th, yk, th, 55, 6, 22);
// 雑音のちらばり（はじめに1回はかる。いつも同じ点なので、だれでも同じ）
const SA = (() => { let q = 0; for (let i = 0; i < 3000; i++) { const v = nA(i * 37.3, i * 11.7, i * 53.1); q += v * v; } return Math.sqrt(q / 3000); })();
const QC = (() => { const a = []; for (let i = 0; i < 3000; i++) a.push(nC(i * 97.1, i * 41.3, i * 13.7)); return Float64Array.from(a.sort((x, y) => x - y)); })();
function cdf(v) { let lo = 0, hi = QC.length; while (lo < hi) { const m = (lo + hi) >> 1; if (QC[m] < v) lo = m + 1; else hi = m; } return lo / QC.length; }

/* ---- 季節・時刻（日本時間） ---- */
function tinfo(ms) {
  const j = ms + JST, d = new Date(j), y = d.getUTCFullYear(), y0 = Date.UTC(y, 0, 1), y1 = Date.UTC(y + 1, 0, 1);
  const doy = (j - y0) / DAY;                          // 1月1日の0時が 0
  const th = 2 * Math.PI * ((j - y0) / (y1 - y0) - 14.5 / 365.25);   // 1月15日ごろ（冬のまん中）が 0
  return { doy, th, c: Math.cos(th), s: Math.sin(th), c2: Math.cos(2 * th), hr: (((j % DAY) + DAY) % DAY) / HR, h: ms / HR };
}
// 1日の気温の形：朝6時がいちばん低く、14時半がいちばん高い（−1〜1）
function diurnal(hr) {
  if (hr >= 6 && hr < 14.5) return -Math.cos(Math.PI * (hr - 6) / 8.5);
  const u = (((hr - 14.5) % 24) + 24) % 24 / 15.5;
  return Math.cos(Math.PI * u);
}
// 上と下を、なめらかにおさえる（首都の 夏の最高 31℃・冬の最低 −2℃）
function soft(v, lo, hi, k) {
  if (v > hi - k) return hi - k + k * Math.tanh((v - hi + k) / k);
  if (v < lo + k) return lo + k + k * Math.tanh((v - lo - k) / k);
  return v;
}
// 雨・雪の降る割合（時間の割合）：梅雨（6月）・秋雨、冬は少ない。北は冬に雪がよく降る（北西の海から）
function wetP(t, dN) {
  const d = t.doy;
  let p = 0.13 + 0.11 * Math.exp(-(((d - 170) / 20) ** 2)) + 0.05 * Math.exp(-(((d - 255) / 18) ** 2)) - 0.03 * t.c;
  const n = Math.max(0, Math.min(1, dN / 300));
  p += n * (0.05 + 0.22 * Math.max(0, t.c));
  if (dN < 0) p += 0.03 * Math.min(1, -dN / 300);
  return Math.max(0.05, Math.min(0.6, p));
}
// 日の出・日の入り（だいたい）：冬は 6:50〜17:10、夏は 5:00〜19:00 ぐらい
function isNight(t) { const L = 12 - 1.7 * t.c; return t.hr < 12 - L / 2 || t.hr >= 12 + L / 2; }

/* ---- その時刻・その場所 ---- */
function core(x, y, e, ms) {
  const t = tinfo(ms), xk = x * KM, yk = y * KM, dN = (CAPY - y) * KM;
  const base = 20.75 - 8.05 * t.c + 0.944 * t.s + 0.785 * t.c2;   // 首都の、その日の平年（3か月の平均が 春21・夏28・秋19・冬14 になる）
  const p = wetP(t, dN), cu = cdf(nC(xk, yk, t.h));
  const wet = cu > 1 - p, inten = wet ? (cu - (1 - p)) / p : 0;
  const cl = wet ? 1 : cu > 1 - p - 0.28 ? 1 : cu > 1 - p - 0.5 ? 0.5 : 0;   // 雲：1 くもり・0.5 すこし・0 晴れ
  const amp = (3.75 + 0.75 * t.c) * (wet ? 0.4 : cl === 1 ? 0.6 : cl ? 0.9 : 1.2);   // 1日の差の半分（晴れは大きく、雨は小さく）
  const an = (2.4 + 1.6 * t.c) * nA(xk, yk, t.h) / SA;   // 何日もつづくずれ（冬 ±4℃・夏 ±0.8℃ ぐらい）
  const tc = soft(base + amp * diurnal(t.hr) + an - (wet && t.c < 0 ? 1.2 : 0), -2, 31, 3);
  const g = dN > 0 ? (0.028 + 0.012 * t.c) * dN : (0.008 + 0.004 * t.c) * dN;   // 北へ1kmで 冬 0.04℃・夏 0.016℃ 寒い
  const T = tc - g - 0.0065 * Math.max(0, e || 0);
  return { t, T, wet, inten, cl, kind: !wet ? '' : T <= 0.6 ? 'snow' : T < 2.4 ? 'sleet' : 'rain' };
}
// 天気のことば・しるし
function label(o, night) {
  if (o.kind === 'snow') return o.inten > 0.75 ? ['snow3', '🌨', '大雪'] : o.inten < 0.3 ? ['snow1', '🌨', '小雪'] : ['snow', '🌨', '雪'];
  if (o.kind === 'sleet') return ['sleet', '🌨', 'みぞれ'];
  if (o.kind === 'rain') {
    if (o.inten > 0.85 && o.T >= 22) return ['thun', '⛈', '雷雨'];
    return o.inten > 0.75 ? ['rain3', '🌧', '大雨'] : o.inten < 0.3 ? ['rain1', '🌧', '小雨'] : ['rain', '🌧', '雨'];
  }
  if (o.cl === 1) return ['cld', '☁', 'くもり'];
  if (o.cl) return ['pcl', night ? '☁' : '⛅', '晴れ時々くもり'];
  return ['sun', night ? '🌙' : '☀', '晴れ'];
}
const r1 = v => Math.round(v * 10) / 10;
// 積もっている雪（cm）。同じ場所・同じ6時間は、おぼえておく
const SNOW = new Map();
function snowAt(x, y, e, ms) {
  const STEP = 6 * HR, t1 = Math.floor(ms / STEP) * STEP, key = Math.round(x / 20) + ',' + Math.round(y / 20) + ',' + Math.round((e || 0) / 50) + ',' + t1;
  if (SNOW.has(key)) return SNOW.get(key);
  let dep = 0;
  for (let tt = t1 - 150 * 4 * STEP; tt <= t1; tt += STEP) {
    const o = core(x, y, e, tt + 3 * HR);   // 6時間のまん中
    if (o.kind === 'snow') dep += (0.25 + 1.5 * o.inten) * 6;
    else if (o.kind === 'sleet') dep += (0.2 + 0.8 * o.inten) * 6 * 0.4;
    if (o.T > 0) dep -= 0.12 * 6 * o.T + (o.kind === 'rain' ? 1.5 : 0);
    dep = dep > 0 ? dep * 0.988 : 0;   // おされて少しずつ低くなる
  }
  if (SNOW.size > 400) SNOW.clear();
  SNOW.set(key, dep);
  return dep;
}
// いま（ms をわたすと、その時刻）
function now(x, y, e, ms) {
  ms = ms == null ? Date.now() : ms;
  const o = core(x, y, e, ms), night = isNight(o.t), [w, ic, nm] = label(o, night);
  const d = day(x, y, e, ms);
  const snow = Math.round(snowAt(x, y, e, ms));
  return { T: r1(o.T), w, ic, nm, night, hi: d.hi, lo: d.lo, snow, wet: o.wet };
}
// その日（日本時間の0時〜24時）の最高・最低と、昼（6〜21時）の天気
function day(x, y, e, ms) {
  const j = ms + JST, d0 = Math.floor(j / DAY) * DAY - JST;
  let hi = -99, lo = 99, wet = 0, cl = 0, snow = 0, rain = 0, thun = 0;
  for (let h = 0; h < 24; h++) {
    const o = core(x, y, e, d0 + h * HR + 30 * 60000);
    if (o.T > hi) hi = o.T; if (o.T < lo) lo = o.T;
    if (h >= 6 && h <= 21) { cl += o.cl; if (o.wet) { wet++; if (o.kind === 'rain') { rain++; if (o.inten > 0.85 && o.T >= 22) thun++; } else snow++; } }
  }
  let w, ic, nm;
  const sn = snow > rain;
  if (wet >= 8) [w, ic, nm] = thun >= 2 ? ['thun', '⛈', '雷雨'] : sn ? ['snow', '🌨', '雪'] : ['rain', '🌧', '雨'];
  else if (wet >= 4) [w, ic, nm] = sn ? ['csnow', '🌨', 'くもり時々雪'] : ['crain', '🌧', 'くもり時々雨'];
  else if (cl / 16 > 0.62) [w, ic, nm] = ['cld', '☁', 'くもり'];
  else if (cl / 16 > 0.3) [w, ic, nm] = ['pcl', '⛅', '晴れ時々くもり'];
  else [w, ic, nm] = ['sun', '☀', '晴れ'];
  return { date: d0, hi: Math.round(hi), lo: Math.round(lo), w, ic, nm };
}
function days(x, y, e, n, ms) { ms = ms == null ? Date.now() : ms; const a = []; for (let i = 0; i < n; i++) a.push(day(x, y, e, ms + i * DAY)); return a; }
// いまから step 時間ごと（ちょうどの時刻）
function hours(x, y, e, n, step, ms) {
  ms = ms == null ? Date.now() : ms; step = step || 3;
  const a = [], t0 = Math.ceil(ms / HR) * HR;
  for (let i = 0; i < n; i++) {
    const tt = t0 + i * step * HR, o = core(x, y, e, tt), [w, ic, nm] = label(o, isNight(o.t));
    a.push({ ms: tt, hr: Math.round(o.t.hr) % 24, T: r1(o.T), w, ic, nm });
  }
  return a;
}
window.MapWx = { now, day, days, hours, core, snowAt, CAPY };
})();
