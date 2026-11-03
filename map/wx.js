/* ===== 国土の天気（t62・2026-10-31） =====
   季節・時刻（日本時間）・場所だけで決まる。乱数の種は固定なので、だれが見ても同じ天気になる（サーバーはいらない）
   - 首都 美東区（y = 54 マス）の季節ごとの平均と、夏のいちばん高い・冬のいちばん低い気温は、本人の目安に合わせてある
   - 北（y が小さい）ほど寒い。冬ほど差が大きい（北の 300km より先は、冬は雪国）。南は少し暖かい
   - 高いところほど寒い（100m で 0.65℃）
   - 雲のかたまりは、西から東へ動いていく（1時間に 30km ぐらい）。0℃ぐらいより寒いと雪、そのすこし上はみぞれ
   - 積もった雪：150日前から6時間ごとに、降った雪をたして、暖かいととかす
   - 風（2026-11-01）：気圧の差（等圧線のこみぐあい）から。低い気圧を左に見てふく。強い雨・雪のときは強め。
     サーバー（DB の更新51 の _wx_core・_wx_wind：列車の遅れ）も同じ式
   - 変な天気（2026-11-02・DB の更新66）：日本の季節に合わせて、たまに
       寒波：冬（12〜3月。1月下旬〜2月上旬がいちばん）に何日か ぐっと寒くなる。首都でも毎冬なんどか雪が積もり、南へも少し。春・秋には まれに季節外れの雪
       猛暑：夏（7〜8月）に何日か、35℃をこえる
       台風：6〜11月（8月下旬〜9月に多い）。南の海で生まれて北へすすみ、東へ向きを変える。まわりは強い風と大雨。毎年 1号から
       ゲリラ豪雨・ひょう・竜巻：夏の午後の雷雲（せまいところだけ）。ひょうは初夏、竜巻は とてもまれ
       濃霧：夜明けごろ、高気圧でおだやかな日。黄砂：春（3〜5月。4月がいちばん）に西から
     サーバー（DB の更新66 の _wx_core・_wx_wind・_wx_ty）も同じ式
   使いかた：MapWx.now(x, y, e) → { T, w, ic, nm, hi, lo, snow, ws（風速 m/s）, wg（最大瞬間）, wd（風向き）, mm（雨 mm/h）, vis（見通し m）, … }（x・y はマス、e は標高 m）
            MapWx.days(x, y, e, n) → きょうから n 日の { date, hi, lo, w, ic, nm, tags }
            MapWx.hours(x, y, e, n, step) → いまから step 時間ごとに n こ { ms, hr, T, w, ic, nm }
            MapWx.alerts(x, y, e) → これから24時間の注意報・警報 [{ k, nm, lv（1 注意報・2 警報・3 特別警報）, at }]
            MapWx.typhoons() → いまの台風 [{ n（号）, x, y（マス）, P（中心気圧）, w（最大風速）, path }] */
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
// 気圧（高気圧・低気圧：400km ぐらいのかたまり。西から東へ 30km/h）。天気図の等圧線にも
const nP = (xk, yk, th) => 0.8 * noise(xk - 30 * th, yk, th, 380, 48, 31) + 0.45 * noise(xk - 24 * th, yk, th, 900, 120, 32);
// 変な天気（2026-11-02）：雷雲（10km ぐらい・1時間ぐらい）・霧・黄砂（西から）。寒波・猛暑は「何日もつづくずれ」（nA）の はし
const nV = (xk, yk, th) => noise(xk - 15 * th, yk - 3 * th, th, 12, 1.4, 51);
const nF = (xk, yk, th) => noise(xk - 8 * th, yk, th, 30, 8, 61) + 0.5 * noise(xk - 8 * th, yk, th, 9, 3, 62);
const nD = (xk, yk, th) => 0.8 * noise(xk - 30 * th, yk - 5 * th, th, 520, 40, 71) + 0.4 * noise(xk - 30 * th, yk - 5 * th, th, 170, 14, 72);
// 雑音のちらばり（はじめに1回はかる。いつも同じ点なので、だれでも同じ）
const sd = f => { let q = 0; for (let i = 0; i < 3000; i++) { const v = f(i * 37.3, i * 11.7, i * 53.1); q += v * v; } return Math.sqrt(q / 3000); };
const SA = sd(nA), SC = sd(nC), SP = sd(nP);
const SV = sd(nV), SF = sd(nF), SD = sd(nD);
// 雲：低気圧のところに多い（天気図の「低」のまわりで雨・雪）
const cloudZ = (c, zp) => 0.75 * c / SC - 0.65 * zp;
const QC = (() => { const a = []; for (let i = 0; i < 3000; i++) { const x = i * 97.1, y = i * 41.3, h = i * 13.7; a.push(cloudZ(nC(x, y, h), nP(x, y, h) / SP)); } return Float64Array.from(a.sort((x, y) => x - y)); })();
function cdf(v) { let lo = 0, hi = QC.length; while (lo < hi) { const m = (lo + hi) >> 1; if (QC[m] < v) lo = m + 1; else hi = m; } return lo / QC.length; }
const cl01 = v => Math.max(0, Math.min(1, v));

/* ---- 季節・時刻（日本時間） ---- */
// 季節の山：d（1月1日が 0 の日）が c 日のとき 1、はば w 日（年をまたぐ）
function bump(d, c, w) { let x = d - c; if (x > 182.625) x -= 365.25; else if (x < -182.625) x += 365.25; return Math.exp(-(x / w) * (x / w)); }
function tinfo(ms) {
  const j = ms + JST, d = new Date(j), y = d.getUTCFullYear(), y0 = Date.UTC(y, 0, 1), y1 = Date.UTC(y + 1, 0, 1);
  const doy = (j - y0) / DAY;                          // 1月1日の0時が 0
  const th = 2 * Math.PI * ((j - y0) / (y1 - y0) - 14.5 / 365.25);   // 1月15日ごろ（冬のまん中）が 0
  return { doy, th, c: Math.cos(th), s: Math.sin(th), c2: Math.cos(2 * th), hr: (((j % DAY) + DAY) % DAY) / HR, h: ms / HR, Y: y,
           sk: bump(doy, 28, 42), sh: bump(doy, 215, 28), sv: bump(doy, 205, 50), sd: bump(doy, 100, 25) };   // 寒波・猛暑・雷雲・黄砂の季節
}
// 1日の気温の形：朝6時がいちばん低く、14時半がいちばん高い（−1〜1）
function diurnal(hr) {
  if (hr >= 6 && hr < 14.5) return -Math.cos(Math.PI * (hr - 6) / 8.5);
  const u = (((hr - 14.5) % 24) + 24) % 24 / 15.5;
  return Math.cos(Math.PI * Math.pow(u, 0.6));   // 夕方は早く下がり（19時すぎに平均）、夜は ゆっくり
}
// 上と下を、なめらかにおさえる（首都の夏の最高・冬の最低。目安）
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

/* ---- 台風（2026-11-02）：1年に 10こ。生まれるのは 6月〜11月（8月下旬に多い）。南の海（首都の 1,100〜1,600km 南）で生まれて
   北（すこし西）へすすみ、向きを東へ変えて速くなる。北へ行くほど弱く、5〜7日で消える。中心気圧は フジタの式（1/√(1+(r/r0)²)） ---- */
const TYN = 10, TYC = new Map(), TYA = new Map();
const tyG = q => 235 + 15 * Math.log(q / (1 - q));   // 生まれる日（1月1日が 0）：6月なかば〜10月おわり
function tyYear(Y) {
  let a = TYC.get(Y); if (a) return a;
  a = []; const y0 = Date.UTC(Y, 0, 1) - JST;
  for (let i = 0; i < TYN; i++) {
    const u = k => hash3(Y, i, k, 91);
    const g = tyG((i + 0.5 + 0.4 * u(1)) / TYN), v1 = 17 + 5 * u(6), py = 1350 + 250 * u(4), U = (u(10) + 1) / 2;
    a.push({ n: i + 1, t0: y0 + g * DAY, L: 140 + 30 * u(2), x0: -300 + 1300 * u(3), y0: py, vx1: -6 + 7 * u(5), vy1: -v1,
             tr: (py - (400 + 500 * u(7))) / v1, vx2: 24 + 12 * u(8), vy2: -24 - 10 * u(9), D: 25 + 50 * U * U, r0: 90 + 20 * u(11) });
  }
  if (TYC.size > 3) TYC.clear();
  TYC.set(Y, a); return a;
}
// 時刻 ms の中心（km）・中心の気圧の下がり D（hPa）・大きさ r0（km）。いなければ null
function tyState(T, ms) {
  const tau = (ms - T.t0) / HR;
  if (!(tau >= 0 && tau <= T.L)) return null;
  const s = tau - T.tr, R = 0.5 * (s + Math.sqrt(s * s + 900));   // 向きを変えるところを なめらかに
  const x = T.x0 + T.vx1 * tau + (T.vx2 - T.vx1) * R, y = T.y0 + T.vy1 * tau + (T.vy2 - T.vy1) * R;
  const D = T.D * (0.25 + 0.75 * Math.min(1, tau / 48)) * Math.max(0.3, Math.min(1, (y + 650) / 900)) * Math.min(1, (T.L - tau) / 18);
  return { n: T.n, x, y, D, r0: T.r0 * (1 + 0.3 * cl01(s / 36)) };
}
function tyAt(ms, t) {
  if (!(t.doy >= 145 && t.doy < 335)) return [];
  let a = TYA.get(ms); if (a) return a;
  a = []; for (const T of tyYear(t.Y)) { const q = tyState(T, ms); if (q) a.push(q); }
  if (TYA.size > 64) TYA.clear();
  TYA.set(ms, a); return a;
}
// 台風のぶん、気圧が下がる（hPa）
function tyP(xk, yk, ty) { let p = 0; for (const q of ty) { const dx = xk - q.x, dy = yk - q.y; p -= q.D / Math.sqrt(1 + (dx * dx + dy * dy) / (q.r0 * q.r0)); } return p; }

/* ---- その時刻・その場所 ---- */
// 気圧（hPa）：ふつう 1000〜1026 ぐらい。冬は西が高く東が低い（西高東低）、夏は南が高い（太平洋の高気圧）
const presOf = (xk, yk, t, zp) => 1013 - 7 * zp + 6 * Math.max(0, t.c) * (-xk / 400) + 4 * Math.max(0, -t.c) * (yk / 400);
// 1時間の雨（mm）・雪（cm）：強さ（0〜1）から。弱いものが多く、強いものは まれ（サーバーの _wx_mm・_wx_cm と同じ）
const rainMM = inten => Math.min(100, 0.3 + 2.5 * (Math.pow(Math.max(1e-9, 1 - inten), -0.6) - 1));
const snowCM = inten => Math.min(20, 0.2 + 1.2 * (Math.pow(Math.max(1e-9, 1 - inten), -0.5) - 1));
const mmInten = mm => 1 - Math.pow((mm - 0.3) / 2.5 + 1, -1.6666666666666667);   // rainMM の逆（mm → 強さ）
// lite：積もった雪の計算用（台風・雷雲・霧・黄砂を見ない。サーバーの _wx_snow も同じ）
function core(x, y, e, ms, tt, lite) {
  const t = tt || tinfo(ms), xk = x * KM, yk = y * KM, dN = (CAPY - y) * KM, zp = nP(xk, yk, t.h) / SP;
  const base = 21.35 - 7.83 * t.c + 0.944 * t.s + 0.785 * t.c2;   // 首都の、その日の平年（3か月の平均が目安どおりになる）
  // 寒波・猛暑の強さ（0〜1）：何日もつづく寒い・暑い（nA）が とても強いとき。その季節のまん中ほど起きやすい（季節のはしは まれ）
  const na = nA(xk, yk, t.h);
  const ec = t.sk > 0.004 ? cl01((-na / SA - (0.9 + 1.5 * (1 - t.sk))) / 0.9) : 0;
  const eh = t.sh > 0.02 ? cl01((na / SA - (2 - t.sh)) / 0.9) : 0;
  // 寒波のときは南の海の低気圧で、首都のあたり（北 300km〜南 450km）も雨・雪がふえる。猛暑のときは晴れやすい
  const ws = cl01((300 - dN) / 150) * cl01((dN + 450) / 250);
  const p = Math.max(0.05, Math.min(0.6, wetP(t, dN) + 0.3 * ec * ws - 0.05 * eh));
  const nc = nC(xk, yk, t.h), cu = cdf(cloudZ(nc, zp));
  let wet = cu > 1 - p, inten = wet ? (cu - (1 - p)) / p : 0;
  let cl = wet ? 1 : cu > 1 - p - 0.28 ? 1 : cu > 1 - p - 0.5 ? 0.5 : 0;   // 雲：1 くもり・0.5 すこし・0 晴れ
  let sg = inten;   // 突風のもとになる雨・雪の強さ（台風の雨はのぞく）
  // 台風：中心のまわり（目のかべ）と、外のうずまき（雲のかたまりで まだら）に強い雨。いちばん近い台風（tyn 号・tya ＝ 中心からの距離 ÷ 大きさ）
  const ty = lite ? [] : tyAt(ms, t);
  let tyn = 0, tya = 99, tyD = 0, typ = 0;
  if (ty.length) {
    let R = 0;
    const band = cl01(0.4 + 0.5 * nc / SC);
    for (const q of ty) {
      const dx = xk - q.x, dy = yk - q.y, d2 = dx * dx + dy * dy, a = Math.sqrt(d2) / q.r0;
      typ -= q.D / Math.sqrt(1 + d2 / (q.r0 * q.r0));
      if (a < tya) { tya = a; tyn = q.n; tyD = q.D; }
      const r = q.D / 50 * Math.max(Math.exp(Math.max(-700, -((a - 0.8) / 0.6) * ((a - 0.8) / 0.6))), 0.55 * Math.exp(-a / 3.5) * band);   // exp は −700 まで（サーバーと同じ）
      if (r > R) R = r;
    }
    if (R > 0.05) cl = 1;
    if (R > 0.15) { inten = Math.max(inten, mmInten(Math.min(100, 2 + 70 * Math.pow(R - 0.15, 1.3)))); wet = true; }
  }
  const amp = (3.75 + 0.75 * t.c) * (wet ? 0.4 : cl === 1 ? 0.6 : cl ? 0.9 : 1.2);   // 1日の差の半分（晴れは大きく、雨は小さく）
  const an = (2.4 + 1.6 * t.c) * na / SA;   // 何日もつづくずれ（冬 ±4℃・夏 ±0.8℃ ぐらい）
  // 寒波で下がる（首都 15℃・北 10℃・南の 100km より先は だんだん半分まで）。首都の冬の最低は −2℃ から −5℃ まで下がる（南の 400km より先は −2℃ のまま）
  const fs = 1 - cl01((-dN - 100) / 300), A = (15 - 5 * cl01(dN / 450)) * (0.5 + 0.5 * fs), H = 6 - 3 * cl01(-dN / 400);   // 猛暑は 6℃（南の島は 3℃）まで上がる
  // 寒波・猛暑で平年がずれないように、冬は少し暖かく・夏は少し涼しくしておく（首都の平年 冬14℃・夏28℃ のまま）
  const tc = soft(base + amp * diurnal(t.hr) + an - (wet && t.c < 0 ? 1.2 : 0) - A * ec + 0.112 * t.sk * t.sk * A - 0.125 * t.sh * t.sh * H, -2 - 3 * ec * fs, 31, 3) + H * eh;
  const g = dN > 0 ? (0.028 + 0.012 * t.c) * dN : (0.008 + 0.004 * t.c) * dN;   // 北へ1kmで 冬 0.04℃・夏 0.016℃ 寒い
  let T = tc - g - 0.0065 * Math.max(0, e || 0);
  // 雷雲（夏の午後）：せまいところに強い雨（ゲリラ豪雨）。雨で少し冷える。初夏の強いものは ひょう、とても強いものの一部に竜巻
  let cv = 0, hail = false, torn = 0;
  if (!lite && t.sv > 0.05 && t.hr >= 11 && t.hr < 22 && T >= 18) {
    const hv = Math.exp(-((t.hr - 16) / 2.8) * ((t.hr - 16) / 2.8));
    cv = cl01((nV(xk, yk, t.h) / SV - (3.1 - t.sv * hv - 0.4 * cl01((T - 26) / 6))) / 0.7);
    if (cv > 0) {
      const i2 = mmInten(8 + 82 * cv * cv);
      inten = Math.max(inten, i2); sg = Math.max(sg, i2); wet = true; cl = 1;
      T -= 3 * cv;
      hail = cv > 0.45 && t.doy < 200 && T <= 29;
      // 竜巻：とても強い雷雲の まん中（雷雲の格子の点）の 0.1％ぐらい。まわり 1.2km・前後 12分だけ
      if (cv > 0.85 && t.doy >= 170) {
        const fx = (xk - 15 * t.h) / 12, fy = (yk - 3 * t.h) / 12, ft = t.h / 1.4, i = Math.floor(fx + 0.5), j = Math.floor(fy + 0.5), k = Math.floor(ft + 0.5);
        if (hash3(i, j, k, 53) > 0.9985) { const dx = (fx - i) * 12, dy = (fy - j) * 12; torn = cl01(1 - Math.sqrt(dx * dx + dy * dy) / 1.2) * cl01(1 - Math.abs(ft - k) * 1.4 / 0.2); }
      }
    }
  }
  // 霧（夜明けごろ。高気圧で雨のないとき。秋に多い）・黄砂（春。雨のないとき。西ほど こい）
  let fg = 0, ds = 0;
  if (!lite && !wet) {
    const hh = t.hr >= 18 ? t.hr - 24 : t.hr, hf = Math.exp(-((hh - 6) / 2.4) * ((hh - 6) / 2.4));
    const k = hf * cl01(0.5 + zp) * (0.6 + 0.4 * Math.cos(2 * Math.PI * (t.doy - 300) / 365.25));
    if (k > 0.02) fg = cl01((nF(xk, yk, t.h) / SF - (2.4 - 1.4 * k)) / 0.7);
    if (t.sd > 0.03) ds = cl01((nD(xk, yk, t.h) / SD * Math.max(0.6, Math.min(1.25, 1 - xk / 1600)) - (2 - 0.9 * t.sd)) / 0.9);
  }
  const kind = !wet ? '' : T <= 0.6 ? 'snow' : T < 2.4 ? 'sleet' : 'rain';
  return { t, T, wet, inten, cl, P: presOf(xk, yk, t, zp) + typ, kind, sg, ec, eh, cv, hail, torn, fg, ds, tyn, tya, tyD, ty,
           ux: kind === 'snow' && t.sk < 0.15 - 0.149 * cl01(dN / 330) };   // ux：季節外れの雪
}
// 風：地上の平均風速（m/s）・最大瞬間風速・ふいてくる向き（北 0・東 90）。o は core() の答え（なければ計算する）
const WDIR = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
function wind(x, y, ms, o) {
  const t = o ? o.t : tinfo(ms), xk = x * KM, yk = y * KM, d = 20;   // 20km はなれた点の気圧の差
  if (!o) o = core(x, y, 0, ms, t);
  const ty = o.ty || [];
  const P = (a, b) => presOf(a, b, t, nP(a, b, t.h) / SP) + 1.8 * tyP(a, b, ty);   // 台風の風は 1.8 倍（うずが強い）
  const gx = (P(xk + d, yk) - P(xk - d, yk)) / (2 * d) * 100, gy = (P(xk, yk + d) - P(xk, yk - d)) / (2 * d) * 100;   // hPa/100km（x 東・y 南）
  const st = o.sg > 0.8 ? 10 * ((o.sg - 0.8) / 0.2) * ((o.sg - 0.8) / 0.2) : 0;   // 強い雨・雪・雷雲の突風
  const spd = 0.6 + Math.sqrt(gx * gx + gy * gy) + st;
  // 向き：地衡風（東 gy・北 gx）を、地面のまさつで 30°低いほう（左）へ
  const ue = gy * 0.8660254037844387 - gx * 0.5, vn = gy * 0.5 + gx * 0.8660254037844387;
  const dir = ((Math.round(Math.atan2(ue, vn) * 180 / Math.PI) + 180) % 360 + 360) % 360;
  const gust = o.torn > 0 ? Math.max(spd * 1.6, 30 + 30 * o.torn) : spd * 1.6;   // 竜巻
  return { spd, gust, dir, nm: WDIR[Math.round(dir / 22.5) % 16] };
}
// 天気のことば・しるし
const isTy = o => o.tyn > 0 && o.tya < 1.5 && o.tyD >= 15;
const isGer = o => o.cv > 0 && o.kind === 'rain' && rainMM(o.inten) >= 30;
function label(o, night) {
  if (o.torn > 0) return ['torn', '🌪', '竜巻'];
  if (isTy(o)) return ['ty', '🌀', '台風'];
  if (o.hail) return ['hail', '🧊', 'ひょう'];
  if (isGer(o)) return ['gerira', '⛈', 'ゲリラ豪雨'];
  if (o.kind === 'snow') return o.ux ? ['snowx', '🌨', '季節外れの雪'] : o.inten > 0.75 ? ['snow3', '🌨', '大雪'] : o.inten < 0.3 ? ['snow1', '🌨', '小雪'] : ['snow', '🌨', '雪'];
  if (o.kind === 'sleet') return ['sleet', '🌨', 'みぞれ'];
  if (o.kind === 'rain') {
    if (o.inten > 0.85 && o.T >= 22) return ['thun', '⛈', '雷雨'];
    return o.inten > 0.75 ? ['rain3', '🌧', '大雨'] : o.inten < 0.3 ? ['rain1', '🌧', '小雨'] : ['rain', '🌧', '雨'];
  }
  if (o.fg >= 0.71) return ['fog2', '🌫', '濃霧'];
  if (o.fg >= 0.3) return ['fog', '🌫', '霧'];
  if (o.ds >= 0.3) return ['dust', '🏜', '黄砂'];
  if (o.T >= 35 && !night) return ['heat', '🥵', '猛暑'];
  if (o.cl === 1) return ['cld', '☁', 'くもり'];
  if (o.cl) return ['pcl', night ? '☁' : '⛅', '晴れ時々くもり'];
  return ['sun', night ? '🌙' : '☀', '晴れ'];
}
const r1 = v => Math.round(v * 10) / 10;
// 見通し（m）：霧・黄砂のとき。なければ null
const visOf = o => o.fg > 0 ? Math.round(60 + 1940 * (1 - o.fg) * (1 - o.fg)) : o.ds > 0 ? Math.round(10000 - 8000 * o.ds) : null;
// 積もっている雪（cm）。同じ場所・同じ6時間は、おぼえておく
const SNOW = new Map();
function snowAt(x, y, e, ms) {
  const STEP = 6 * HR, t1 = Math.floor(ms / STEP) * STEP, key = Math.round(x / 20) + ',' + Math.round(y / 20) + ',' + Math.round((e || 0) / 50) + ',' + t1;
  if (SNOW.has(key)) return SNOW.get(key);
  let dep = 0;
  for (let tt = t1 - 150 * 4 * STEP; tt <= t1; tt += STEP) {
    const o = core(x, y, e, tt + 3 * HR, null, true);   // 6時間のまん中
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
  const snow = Math.round(snowAt(x, y, e, ms)), wn = wind(x, y, ms, o);
  return { T: r1(o.T), w, ic, nm, night, hi: d.hi, lo: d.lo, snow, wet: o.wet, ws: Math.round(wn.spd), wg: Math.round(wn.gust), wd: wn.nm,
           mm: o.kind === 'rain' ? r1(rainMM(o.inten)) : 0, cm: o.kind === 'snow' ? r1(snowCM(o.inten)) : 0, vis: visOf(o), tags: d.tags,
           ty: o.tyn > 0 && o.tya < 3 && o.tyD >= 12 ? o.tyn : 0, cold: o.ec >= 0.5, heat: o.eh >= 0.5 };
}
// その日（日本時間の0時〜24時）の最高・最低と、昼（6〜21時）の天気。tags：猛暑日・台風・ゲリラ豪雨・ひょう・竜巻・濃霧・黄砂・季節外れの雪
function day(x, y, e, ms) {
  const j = ms + JST, d0 = Math.floor(j / DAY) * DAY - JST;
  let hi = -99, lo = 99, wet = 0, cl = 0, snow = 0, rain = 0, thun = 0, tyh = 0, ger = 0, hail = 0, torn = 0, fog = 0, dust = 0, ux = 0;
  for (let h = 0; h < 24; h++) {
    const o = core(x, y, e, d0 + h * HR + 30 * 60000);
    if (o.T > hi) hi = o.T; if (o.T < lo) lo = o.T;
    if (h >= 3 && h <= 10 && o.fg >= 0.71) fog++;
    if (h >= 6 && h <= 21) {
      cl += o.cl; if (o.wet) { wet++; if (o.kind === 'rain') { rain++; if (o.inten > 0.85 && o.T >= 22) thun++; } else snow++; }
      if (isTy(o)) tyh++; if (isGer(o)) ger++; if (o.hail) hail++; if (o.torn > 0) torn++; if (o.ds >= 0.3) dust++; if (o.ux) ux++;
    }
  }
  let w, ic, nm;
  const sn = snow > rain;
  if (tyh >= 3) [w, ic, nm] = ['ty', '🌀', '台風'];
  else if (wet >= 8) [w, ic, nm] = thun >= 2 ? ['thun', '⛈', '雷雨'] : sn ? ['snow', '🌨', '雪'] : ['rain', '🌧', '雨'];
  else if (wet >= 4) [w, ic, nm] = sn ? ['csnow', '🌨', 'くもり時々雪'] : ['crain', '🌧', 'くもり時々雨'];
  else if (cl / 16 > 0.62) [w, ic, nm] = ['cld', '☁', 'くもり'];
  else if (cl / 16 > 0.3) [w, ic, nm] = ['pcl', '⛅', '晴れ時々くもり'];
  else [w, ic, nm] = ['sun', '☀', '晴れ'];
  const tags = [];
  if (hi >= 35) tags.push('猛暑日');
  if (tyh && tyh < 3) tags.push('台風');
  if (ux) tags.push('季節外れの雪');
  if (torn) tags.push('竜巻'); else if (hail) tags.push('ひょう'); else if (ger) tags.push('ゲリラ豪雨');
  if (fog) tags.push('濃霧');
  if (dust >= 3) tags.push('黄砂');
  return { date: d0, hi: Math.round(hi), lo: Math.round(lo), w, ic, nm, tags };
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
// 注意報・警報（いまから24時間。2時間ごとに見る）：[{ k, nm, lv（1 注意報・2 警報・3 特別警報）, at（はじめの時刻） }]（ひどい順）
function alerts(x, y, e, ms) {
  ms = ms == null ? Date.now() : ms;
  const m = new Map(), add = (k, nm, lv, at) => { const q = m.get(k); if (!q) m.set(k, { k, nm, lv, at }); else if (lv > q.lv) { q.nm = nm; q.lv = lv; } };
  const t0 = Math.floor(ms / HR) * HR;
  for (let i = 0; i <= 24; i += 2) {
    const tt = i ? t0 + i * HR : ms, o = core(x, y, e, tt), w = wind(x, y, tt, o);
    const mm = o.kind === 'rain' ? rainMM(o.inten) : 0, cm = o.kind === 'snow' ? snowCM(o.inten) : 0;
    const big = o.tyn > 0 && o.tya < 1.2 && o.tyD >= 55;   // とても強い台風の中心のあたり（特別警報）
    if (mm >= 50) add('rain', big ? '大雨特別警報' : '大雨警報', big ? 3 : 2, tt); else if (mm >= 30) add('rain', '大雨注意報', 1, tt);
    if (w.spd >= 40) add('wind', '暴風特別警報', 3, tt); else if (w.spd >= 20 || w.gust >= 35) add('wind', '暴風警報', 2, tt); else if (w.spd >= 12 || w.gust >= 22) add('wind', '強風注意報', 1, tt);
    if (cm >= 5) add('snow', '大雪警報', 2, tt); else if (cm >= 2) add('snow', '大雪注意報', 1, tt);
    if (o.torn > 0 || o.cv > 0.85) add('torn', '竜巻注意情報', 1, tt);
    if (o.cv > 0) add('thun', o.hail ? '雷注意報（ひょう）' : '雷注意報', 1, tt);
    if (o.fg >= 0.71) add('fog', '濃霧注意報', 1, tt);
    if (o.T >= 35) add('heat', '高温注意情報', 2, tt); else if (o.T >= 33) add('heat', '熱中症警戒アラート', 1, tt);
    if (o.ec >= 0.6 && o.T <= 2) add('cold', '低温注意報（寒波）', 1, tt);
    if (o.ds >= 0.5) add('dust', '黄砂情報', 1, tt);
    if (o.tyn > 0 && o.tya < 3 && o.tyD >= 12) add('ty', `台風${o.tyn}号が接近`, 1, tt);
  }
  return [...m.values()].sort((p, q) => q.lv - p.lv || p.at - q.at);
}
// いまの台風（中心気圧が 1,000hPa より低いもの）：中心（マス）・中心気圧・最大風速（m/s）・進路（24時間前〜72時間後。6時間ごと [ms, x, y, 中心気圧]）
function typhoons(ms) {
  ms = ms == null ? Date.now() : ms;
  const t = tinfo(ms); if (!(t.doy >= 145 && t.doy < 335)) return [];
  const out = [];
  for (const T of tyYear(t.Y)) {
    const q = tyState(T, ms); if (!q || q.D < 12) continue;
    const path = [];
    for (let k = -24; k <= 72; k += 6) { const s = tyState(T, ms + k * HR); if (s) path.push([ms + k * HR, s.x / KM, s.y / KM, Math.round(1008 - s.D)]); }
    out.push({ n: q.n, x: q.x / KM, y: q.y / KM, P: Math.round(1008 - q.D), w: Math.round(0.6 + 1.8 * 38.5 * q.D / q.r0), r0: q.r0, path });
  }
  return out;
}
window.MapWx = { now, day, days, hours, core, snowAt, tinfo, label, isNight, wind, rainMM, snowCM, alerts, typhoons, visOf, CAPY, v: 2 };
})();
