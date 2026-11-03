/* ===== 風の芽経済組：国土をつくる（地形・川・市町村・区・町名・用途地域） =====
   - 決まった計算なので、同じチャンクはいつ・どの端末で作っても同じになる（＋ − × ÷ と √・切り捨てだけを使う）
   - 座標：x は東へ、y は南へ（1マス＝約50m）。(0,0) が瑠璃市中里区（瑠璃市役所）。北西が山、南東が海。海岸線は北東・南西へどこまでも続く
   - 瑠璃のまわりは関東平野くらいの大きな平野（海から山まで約100km・海ぞい約150km）。台地・丘陵・大きな川（支流つき）がある。その外は細い海ぞいの平野
   - 1チャンク＝64×64マス。チャンクごとに作れるので、あとから広げてもつながる
   - 使い方：const W = MapGen.world(); W.chunk(cx, cy) → 地形など。W.places(cx0, cy0, cx1, cy1) → 地名
   地形の記号：D 深い海・S 海・R 川・L 湖・B 砂浜・P 平地・F 林・H 丘・M 山・K 高い山（岩）
   用途地域の記号：- なし・a 低層住居・b 住居・c 近隣商業・d 商業・e 準工業・f 工業・g 港湾・h 農業・i 森林・j 公園 */
(function (root) {
'use strict';
const CS = 64;                       // チャンクの大きさ
const SQ = Math.SQRT1_2;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/* ---------- 乱数（整数のハッシュ）と、なめらかな乱数（パーリンノイズ） ---------- */
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const rnd = (a, b, c) => hash3(a, b, c) / 4294967296;
const GX = [1, -1, 0, 0, SQ, -SQ, SQ, -SQ], GY = [0, 0, 1, -1, SQ, SQ, -SQ, -SQ];
function perlin(x, y, s) {                     // だいたい −0.7〜0.7
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g00 = hash3(x0, y0, s) & 7, g10 = hash3(x0 + 1, y0, s) & 7, g01 = hash3(x0, y0 + 1, s) & 7, g11 = hash3(x0 + 1, y0 + 1, s) & 7;
  const n00 = GX[g00] * fx + GY[g00] * fy, n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1), n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}
function fbm(x, y, s, oct) {                   // だいたい −0.5〜0.5
  let t = 0, amp = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { t += perlin(x * f, y * f, s + i * 7919) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return t / n;
}
function ridged(x, y, s, oct) {                // 0〜1（尾根のすじ）
  let t = 0, amp = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { let r = 1 - Math.abs(perlin(x * f, y * f, s + i * 104729)) * 1.7; if (r < 0) r = 0; t += r * r * amp; n += amp; amp *= 0.5; f *= 2.01; }
  return t / n;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pick = (arr, h) => arr[h % arr.length];
/* 標高を64段に（低いところほどこまかく）：海 25m・0〜100m は 4m・〜500m は 25m・その上 150m ごと */
function eenc(e) {
  if (e < 0) return clamp(Math.floor((e + 200) / 25), 0, 7);
  if (e < 100) return 8 + Math.floor(e / 4);
  if (e < 500) return 33 + Math.floor((e - 100) / 25);
  return 49 + Math.min(14, Math.floor((e - 500) / 150));
}
function edec(l) { return l <= 7 ? -187.5 + l * 25 : l <= 32 ? (l - 8) * 4 + 2 : l <= 48 ? 112.5 + (l - 33) * 25 : 575 + (l - 49) * 150; }

/* ---------- 地名（架空。日本っぽい漢字2文字） ---------- */
const NA = '東西南北上下大小新古高中長広深若白黒赤青緑金銀朝日月星風雲霧雪花葉松杉桜梅竹柳桐楓椿菊藤柿栗桑稲麦豆茶鶴亀鷹鷺鳩鹿熊駒竜玉石岩砂泉滝湊舟糸錦富福吉栄豊宝幸寿永安平和清美春夏秋冬光明旭千百八三二一七九万柏楠榎槙樫桂萩葦芦蓮菖紫藍朱橘柚椎栃欅檜笹蘭';
const NB = '田川野原沢浜崎津浦谷岡坂宮橋瀬島山森木里江根尾井戸丘台内本辺塚倉河洲淵岬磯浪潟堤池水見作畑園場城郷部島坪';
const NG_BAD = new Set(['東京', '大阪', '京都', '横浜', '神戸', '福岡', '広島', '仙台', '千葉', '新潟', '静岡', '浜松', '熊本', '岡山', '金沢', '富山', '長野', '岐阜', '大津', '奈良', '松江', '山口', '徳島', '高松', '松山', '高知', '佐賀', '長崎', '大分', '宮崎', '青森', '盛岡', '秋田', '山形', '福島', '水戸', '前橋', '甲府', '福井', '大宮', '川崎', '堺市', '鳥取', '那覇', '浦和', '柏市', '船橋', '豊田', '岡崎', '高崎', '宇都', '千代', '中央', '北区', '南区', '東区', '西区', '港区', '緑区', '中里', '梁川', '瑠璃']);
function kanjiName(h) {
  for (let i = 0; i < 9; i++) {
    const g = hash3(h, i, 77);
    const n = NA[g % NA.length] + NB[(g >>> 11) % NB.length];
    if (!NG_BAD.has(n) && n[0] !== n[1]) return n;
  }
  return '若' + NB[h % NB.length];
}
// 町名（大字）のもと：場所に合わせて
const DN_CORE = ['本町', '中央', '大手町', '栄町', '錦町', '銀座', '本通', '元町', '仲町', '宮町'];
const DN_SEA = ['港町', '浜町', '汐見町', '潮見町', '海岸通', '磯町', '浦町', '船町', '浜田', '入船町', '築港', '岬町', '寄木町', '湊町'];
const DN_RIVER = ['川端', '川原町', '中洲', '河内', '橋本', '堤町', '瀬戸', '川岸', '舟入', '渡町', '水門町'];
const DN_HILL = ['山手', '丘町', '台町', '高台', '見晴', '坂上', '桜ヶ丘', '緑ヶ丘', '朝日ヶ丘', '松ヶ丘', '山の手', '高見'];
const DN_TOWN = ['旭町', '緑町', '寿町', '幸町', '末広町', '若葉町', '桜町', '松原', '柳町', '桂町', '梅ヶ枝町', '宮下', '宮前', '稲荷町', '八幡町', '弁天町', '天神町', '東町', '西町', '南町', '北町', '新町', '本郷', '上町', '下町', '平和町', '昭和町', '大和町', '泉町', '清水町', '富士見町', '日の出町', '曙町', '千歳町', '常盤町', '住吉町', '春日町', '白山', '紅葉町', '柏木', '若松町', '花園町', '美園', '双葉町', '三好町', '高砂町', '相生町', '朝日町', '東雲', '豊町'];
const DN_RURAL_B = ['田', '野', '原', '沢', '谷', '畑', '平', '村', '新田', '窪', '久保', '内'];

/* ---------- 国土 ---------- */
function world(opt) {
  opt = opt || {};
  const SEED = opt.seed == null ? 20261022 : opt.seed | 0;
  const S_COAST = SEED + 11, S_C2 = SEED + 23, S_HILL = SEED + 37, S_MTN = SEED + 41, S_MTN2 = SEED + 43, S_RIV = SEED + 59, S_FOR = SEED + 61, S_LAKE = SEED + 67, S_ISL = SEED + 71, S_MUNI = SEED + 83, S_WARD = SEED + 89, S_DIST = SEED + 97, S_PARK = SEED + 101, S_NAME = SEED + 103, S_IND = SEED + 107, S_PREF = SEED + 109;
  const S_PLAT = SEED + 113;
  const C0 = 78;                                       // 中心から海岸までのおよその距離（南東へ）
  const coastN = v => 300 * fbm(v / 900, 3.7, S_COAST, 3) + 120 * fbm(v / 230, 9.1, S_COAST + 1, 3) + 26 * fbm(v / 50, 5.3, S_COAST + 2, 2);
  const CN0 = coastN(0);
  const coastU = v => C0 + coastN(v) - CN0 * (1 - ss(0, 260, Math.abs(v)));   // 中心の前の海岸はだいたい C0
  const sq = t => t * t;
  /* 平野の奥行き（海岸から山がはじまるまでのマス）。瑠璃のまわり（v≈0）は関東平野くらい。北東へ長め・南西は短め。その外は細い平野 */
  const PL_IN = 1950, PL_NE = 1850, PL_SW = 1350;
  function plainDepth(v) {
    const narrow = 170 + 300 * clamp(fbm(v / 800, 1.9, S_MTN2 + 5, 2) * 1.6 + 0.5, 0, 1);
    const t = v / (v > 0 ? PL_NE : PL_SW);
    const big = t * t < 1 ? PL_IN * Math.sqrt(1 - t * t) * (0.93 + 0.28 * fbm(v / 520, 7.7, S_MTN2 + 13, 2)) : 0;
    return (narrow + big + Math.sqrt((narrow - big) * (narrow - big) + 160 * 160)) / 2;      // なめらかに大きいほう
  }
  /* 川：海岸ぞいに 230 マスくらいごとに河口がある。河口から北西（内陸）へ、くねりながらのびる。k=0 が瑠璃川
     大きい川は平野をよこぎって山の中まで。支流（1〜2本）は本流からとがった角度で分かれて、となりの川とは交わらない
     川どうしは「共通のゆるい曲がり」（flowShift）で同じように曲がるので、交わらない */
  const RS = 230;
  const mouthV = k => k === 0 ? 18 : k * RS + (rnd(k, 0, S_RIV) - 0.5) * RS * 0.55;
  const flowShift = (v0, s) => 380 * fbm(v0 / 2600, s / 1500 + 0.37, S_RIV + 9, 2) * ss(150, 700, s);
  const riv = new Map();
  function river(k) {
    let r = riv.get(k); if (r) return r;
    const m = mouthV(k), pd = plainDepth(m), big = k === 0 || rnd(k, 2, S_RIV) < 0.4;
    const len = k === 0 ? pd + 700 : big ? pd + 250 + rnd(k, 1, S_RIV) * 650 : 200 + rnd(k, 1, S_RIV) * Math.min(1100, 0.65 * pd);
    const wide = clamp((pd - 400) / 1200, 0, 1);       // 大きい平野の川ほど太い
    r = { k, m, pd, s0: 0, s1: len, len, w0: k === 0 ? 4.2 : big ? 2.7 + 1.6 * wide * rnd(k, 5, S_RIV) : 1.7, big,
      cu: coastU(m), name: k === 0 ? '瑠璃川' : kanjiName(hash3(k, 4, S_NAME)) + '川', tribs: [] };
    riv.set(k, r);
    if (big && len > 500) {
      const gL = m - mouthV(k - 1), gR = mouthV(k + 1) - m;
      const nt = rnd(k, 6, S_RIV) < 0.55 ? 2 : 1;
      for (let j = 0; j < nt; j++) {
        const side = (j === 0) === (gR > gL) ? 1 : -1, gap = side > 0 ? gR : gL;
        if (j > 0 && gap < 160) break;
        const A = clamp(0.32 * gap, 30, 80), s0 = len * (0.16 + 0.5 * rnd(k, 7 + j, S_RIV));
        const tl = Math.min(len - s0 + 220, 300 + rnd(k, 9 + j, S_RIV) * 900);
        r.tribs.push({ k, j, trib: true, parent: r, side, A, s0, s1: s0 + tl, len: tl, m, pd, cu: r.cu, w0: 1.6 + 0.9 * rnd(k, 11 + j, S_RIV), big: false,
          name: kanjiName(hash3(k, 20 + j, S_NAME)) + '川' });
      }
    }
    return r;
  }
  function riverV(r, s) {                              // 河口から内陸へ s のところの、川のまん中の v
    if (r.trib) {
      const t = s - r.s0;
      return riverV(r.parent, s) + r.side * r.A * ss(0, 4 * r.A, t) + 16 * fbm(s / 50 + r.j * 7.1 + r.k * 3.3, 2.5, S_RIV + 15, 2) * ss(0, 2 * r.A, t);
    }
    const amp = r.k === 0 ? 6 + 26 * ss(110, 260, s) : 24 + 6 * ss(0, 200, s);
    return r.m + amp * fbm(s / 80 + r.k * 17.3, r.k * 3.1 + 0.5, S_RIV + 5, 2) * 2 + flowShift(r.m, s);
  }
  // 川はばのマス数（河口が太く、上流ほど細い）
  const riverW = (r, s) => Math.max(0.75, r.w0 * (1 - (r.trib ? 0.6 : 0.72) * clamp((s - r.s0) / r.len, 0, 1)));
  // 近くの川（v の向きの距離）。best＝いちばん近い川、all＝谷をほるための近くの川ぜんぶ
  function nearRiver(u, v) {
    const k0 = Math.round(v / RS);
    let best = null; const all = [];
    const look = r => {
      const s = r.cu - u;
      if (s < r.s0 - 12 || s > r.s1 + 90) return;
      const dv = v - riverV(r, s), w = riverW(r, s);
      const a = Math.abs(dv), q = { r, s, dv, a, w };
      all.push(q);
      if (s >= r.s0 - 5 && s <= r.s1 + 40 && (!best || a - w < best.a - best.w)) best = q;
    };
    for (let k = k0 - 2; k <= k0 + 2; k++) { const r = river(k); look(r); for (const t of r.tribs) look(t); }
    return { best, all };
  }

  /* ---------- 広げた国土（t55）：南の陸（半島・湾）と、南東の海の島 ----------
     いまの国土（広げる前の地図）の陸と、そのまわりの海は1マスも変えない：
       南の陸は y ≥ 1536（広げたところ）だけ。もとの海岸から、鷹磯川の河口の南でなめらかに分かれて東へ
       島は、もとは深い海だけだったところ（ISL_BOX）だけ
     形は「海岸からの内陸の距離 d（マス）」で決める：北の海岸の線より南が陸 ＋ 半島（芯の線とはば）− 湾（だ円）＋ ゆらぎ。小島も */
  const S_EXT = SEED + 131, Y_EXT = 1536, ISL_BOX = [576, 576, 1728, 1536];
  const inIslBox = (x, y) => x >= ISL_BOX[0] && x < ISL_BOX[2] && y >= ISL_BOX[1] && y < ISL_BOX[3];
  const extZone = (x, y) => y >= Y_EXT || inIslBox(x, y);
  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  // なめらかな線（点のあいだを Catmull-Rom で）：P は [a, b] の列（a が増える順）。a → b
  function spl(P, a) {
    let i = 1; while (i < P.length - 2 && a > P[i + 1][0]) i++;
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
    const t = clamp((a - p1[0]) / (p2[0] - p1[0]), 0, 1), t2 = t * t, t3 = t2 * t;
    const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * (p2[0] - p1[0]), m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * (p2[0] - p1[0]);
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  }
  // 南の陸の南の本土の海岸（湾の奥。x → y）と、西の陸の東の海岸（内湾の西岸。y → x）
  const SC = [[-1900, 2200], [-1300, 2236], [-1000, 2276], [-700, 2326], [-400, 2376], [-100, 2416], [200, 2428], [500, 2380], [800, 2316], [1100, 2328], [1400, 2356], [1900, 2370]];
  const WC_ = [[1400, -1460], [1616, -1440], [1700, -1388], [1800, -1336], [2000, -1290], [2200, -1250], [2400, -1220], [2900, -1200]];
  const southY = x => spl(SC, x), westX = y => spl(WC_, y);
  // 半島・島の芯（折れ線）とはば（点ごと）：はば − 芯からの距離
  function capD(p, x, y) {
    let best = -1e9;
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [ax, ay] = p.pts[i], [bx, by] = p.pts[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1), qx = ax + dx * t - x, qy = ay + dy * t - y;
      const w = p.w[i] + (p.w[i + 1] - p.w[i]) * t, d = w - Math.sqrt(qx * qx + qy * qy);
      if (d > best) best = d;
    }
    return best;
  }
  // 湾（だ円）：外がプラス、中がマイナス
  function bayD(b, x, y) {
    const c = Math.cos(b.a), s = Math.sin(b.a), dx = x - b.x, dy = y - b.y, px = (dx * c + dy * s) / b.rx, py = (-dx * s + dy * c) / b.ry;
    return (Math.sqrt(px * px + py * py) - 1) * Math.min(b.rx, b.ry);
  }
  const PEN = [   // 南の陸の半島（芯の線とはば。西から）
    { pts: [[-1470, 1792], [-1200, 1760], [-950, 1722], [-700, 1712]], w: [120, 95, 70, 38] },                      // 北の岬（内湾の北をかこむ）
    { pts: [[-640, 2390], [-560, 2150], [-440, 1960], [-300, 1830], [-150, 1730]], w: [240, 220, 180, 128, 58] },    // 大きい半島（北東へ。内湾の東）
    { pts: [[380, 2450], [400, 2200], [440, 2020], [490, 1900], [522, 1818]], w: [120, 100, 80, 60, 32] },            // 細い半島（北へ）
    { pts: [[1180, 2420], [1220, 2150], [1240, 1960], [1262, 1822], [1290, 1722]], w: [300, 262, 212, 150, 70] } ];  // 東の半島（広い・山がち。島のほうへ）
  const BAYS = [   // 入り江（中がマイナス）
    { x: -1270, y: 2050, rx: 60, ry: 34, a: 0.3 }, { x: 140, y: 2400, rx: 70, ry: 50, a: 0.2 }, { x: 760, y: 2300, rx: 70, ry: 44, a: -0.2 },
    { x: 1020, y: 2080, rx: 56, ry: 40, a: 0.7 }, { x: 1440, y: 1980, rx: 60, ry: 36, a: -0.5 } ];
  const S_ISLETS = [[-860, 1640, 18], [-600, 1680, 12], [60, 2160, 30], [-990, 2060, 22], [560, 1760, 14], [1320, 1640, 26], [1380, 1584, 12], [700, 2000, 16], [-80, 1660, 16]];
  // 南東の海の大きい島（芯の線とはば）・入り江・まわりの小島
  const BIG = { pts: [[790, 1342], [880, 1272], [962, 1236], [1050, 1156], [1130, 1104], [1222, 1056], [1310, 972]], w: [70, 112, 136, 150, 126, 140, 78] };
  const BIG_BAYS = [{ x: 930, y: 1118, rx: 62, ry: 42, a: 0.6 }, { x: 1150, y: 1262, rx: 48, ry: 34, a: -0.3 }, { x: 1260, y: 1150, rx: 40, ry: 30, a: 0.2 }];
  const B_ISLETS = [[650, 1450, 28], [700, 1500, 12], [1430, 862, 24], [1478, 900, 10], [1180, 1400, 18], [1452, 1226, 26], [1000, 1385, 10], [1380, 1330, 14]];   // 地図のはし（x 1536）にかからないように
  const isletD = (s, x, y) => s[2] - Math.sqrt((x - s[0]) * (x - s[0]) + (y - s[1]) * (y - s[1]));
  // 広げたところの内陸の距離 d と種類 k（1 南の陸・2 島）。形はゆがめて（まっすぐにならないように）、海岸にゆらぎ
  function extLand(x, y) {
    const wx = x + 70 * fbm(x / 330, y / 330, S_EXT + 31, 3), wy = y + 70 * fbm(x / 330, y / 330, S_EXT + 37, 3);
    if (y >= Y_EXT) {
      const sl = (southY(wx + 8) - southY(wx - 8)) / 16, tl = (westX(wy + 8) - westX(wy - 8)) / 16;
      let d = smax((wy - southY(wx)) / Math.sqrt(1 + sl * sl), (westX(wy) - wx) / Math.sqrt(1 + tl * tl), 80);
      for (const p of PEN) d = smax(d, capD(p, wx, wy), 80);
      for (const b of BAYS) d = smin(d, bayD(b, wx, wy), 40);
      for (const s of S_ISLETS) d = Math.max(d, isletD(s, x, y));
      d += 30 * fbm(x / 210, y / 210, S_EXT, 3) + 14 * fbm(x / 80, y / 80, S_EXT + 2, 2) + 16 * fbm(x / 46, y / 46, S_C2, 3) + 7 * fbm(x / 13, y / 13, S_C2 + 3, 2);
      d -= 34 * ss(0.6, 0.93, ridged(x / 75, y / 75, S_EXT + 41, 2)) * ss(-24, 8, d) * (1 - ss(40, 130, d)) * extW(x);   // 海岸のそばに、細い入り江（リアス式）
      if (d < -6 && d > -90) { const isl = fbm(x / 28, y / 28, S_ISL + 5, 3); if (isl > 0.37) d = (isl - 0.37) * 60; }   // 沖の小島
      return { d, k: 1 };
    }
    let d = capD(BIG, wx, wy);
    for (const b of BIG_BAYS) d = smin(d, bayD(b, wx, wy), 30);
    for (const s of B_ISLETS) d = Math.max(d, isletD(s, x, y));
    d += 26 * fbm(x / 130, y / 130, S_EXT + 3, 3) + 12 * fbm(x / 70, y / 70, S_EXT + 4, 2) + 16 * fbm(x / 46, y / 46, S_C2, 3) + 7 * fbm(x / 13, y / 13, S_C2 + 3, 2);
    if (d < -6 && d > -90) { const isl = fbm(x / 28, y / 28, S_ISL + 7, 3); if (isl > 0.37) d = (isl - 0.37) * 60; }
    return { d, k: 2 };
  }
  // 南の陸の新しい決まりのきき方：もとの海岸とつながる西のはし（x < −1420）は 0（もとと同じ）、東へ 1
  const extW = x => ss(-1420, -1060, x);
  /* 広げたところの川（湾の奥へ流れこむ）：河口のまえ（湾の中）の点 m・内陸への向き・長さ。もとの川と同じ形のもの（s：河口から内陸へ）
     川の線は、まっすぐ＋ゆるい曲がり。地図の絵のための線（xrivers）も */
  const XR_DEF = [
    { k: 1, m: [-980, 2196], dir: [0.06, 1], len: 560, w0: 2.9, big: true, pd: 330, sm: 80 },     // 内湾の南の奥へ
    { k: 2, m: [150, 2356], dir: [0.12, 1], len: 400, w0: 2.6, big: true, pd: 300, sm: 89 },      // まん中の湾の奥へ
    { k: 3, m: [776, 2250], dir: [-0.06, 1], len: 500, w0: 2.7, big: true, pd: 320, sm: 90 },     // 東の湾の奥へ
    { k: 4, m: [-1196, 1984], dir: [-1, 0.22], len: 360, w0: 1.8, big: false, pd: 260, sm: 105 },  // 内湾の西から
    { k: 5, m: [-704, 2160], dir: [1, 0.3], len: 230, w0: 1.6, big: false, pd: 220, sm: 0 },     // 大きい半島から内湾へ
    { k: 6, m: [962, 2140], dir: [1, 0.25], len: 300, w0: 1.8, big: false, pd: 240, sm: 0 },     // 東の半島から東の湾へ
    { k: 7, m: [905, 1078], dir: [0.72, 0.69], len: 170, w0: 1.6, big: false, pd: 120, sm: 115 },  // 島（北西の入り江へ）
    { k: 8, m: [1166, 1300], dir: [-0.35, -1], len: 130, w0: 1.4, big: false, pd: 100, sm: 77 } ]; // 島（南東の入り江へ）
  const XR = XR_DEF.map(r => { const L = Math.hypot(r.dir[0], r.dir[1]); return { ...r, cx: r.dir[0] / L, cy: r.dir[1] / L, s0: 0, s1: r.len, trib: false, xr: true, name: '' }; });
  const xrOff = (r, s) => (22 + 6 * ss(0, 200, s)) * fbm(s / 80 + r.k * 17.3, r.k * 3.1 + 0.5, S_EXT + 51, 2) * 2 * ss(0, 90, s);
  function nearXRiver(x, y) {
    let best = null; const all = [];
    for (const r of XR) {
      const dx = x - r.m[0], dy = y - r.m[1], s = dx * r.cx + dy * r.cy;
      if (s < r.s0 - 12 || s > r.s1 + 90) continue;
      const t = -dx * r.cy + dy * r.cx, dv = t - xrOff(r, s), w = riverW(r, s), a = Math.abs(dv);
      if (a > 220) continue;
      const q = { r, s, dv, a, w }; all.push(q);
      if (s >= r.s0 - 5 && s <= r.s1 + 40 && (!best || a - w < best.a - best.w)) best = q;
    }
    return { best, all };
  }
  // 地図の絵のための川の線（[x, y, …]・はば）。sm：河口（川のマスがはじまるところ。湾の中には描かない）
  const xrivers = XR.map(r => { const pts = [], ws = [], s0 = Math.max(0, r.sm - 3); for (let s = s0; s <= r.len; s += 1) { const o = xrOff(r, s); pts.push(r.m[0] + r.cx * s - r.cy * o, r.m[1] + r.cy * s + r.cx * o); ws.push(riverW(r, s)); } return { k: r.k, s0, pts, w: ws }; });

  /* 1マスの地形（標高 e：メートル。海はマイナス）
     平地の高さ ep ＝ ゆるい上り（0.6m/km）＋ 山のふもとの扇状地 ＋ 台地 。そこに丘陵・山がのる。川ぞいは谷（低地）になる
     rl ＝ 起伏（丘・山の分）。地形の種類は rl で決める（台地や扇状地は高くても平地）
     xk：0 もとの国土・1 南の陸・2 島（t55） */
  function cell(x, y) { return cellAt(x, y, extZone(x, y)); }
  function cell0(x, y) { return cellAt(x, y, false); }          // 広げる前の国土
  function cellAt(x, y, useExt) {
    const u = (x + y) * SQ, v = (x - y) * SQ;
    const nr = nearRiver(u, v);
    let rn = nr.best, rall = nr.all;
    let d = coastU(v) - u + 16 * fbm(x / 46, y / 46, S_C2, 3) + 7 * fbm(x / 13, y / 13, S_C2 + 3, 2);          // 海岸からの内陸の距離（マス）
    // 沖の小島
    if (d < -6 && d > -90) { const isl = fbm(x / 28, y / 28, S_ISL, 3); if (isl > 0.31) d = (isl - 0.31) * 60; }
    let xk = 0;
    if (useExt) {
      const ex = extLand(x, y); if (ex.d > d - 30) { if (ex.d >= d) xk = ex.k; d = smax(d, ex.d, 30); }
      const xr = nearXRiver(x, y);   // 広げたところの川
      if (xr.all.length) { rall = rall.concat(xr.all); if (xr.best && (!rn || xr.best.a - xr.best.w < rn.a - rn.w)) rn = xr.best; }
    }
    let e, rl = 0;
    if (d < 0) e = d * 1.2;                                              // 海の深さ
    else {
      const w = xk === 1 ? extW(x) : 0;
      const pd = xk === 2 ? 60 : w > 0 ? plainDepth(v) * (1 - w) + w * (300 + 150 * fbm(x / 700, y / 700, S_EXT + 9, 2)) : plainDepth(v);
      const ms = xk === 2 ? 74 + 40 * fbm(x / 160, y / 160, S_EXT + 11, 2) : pd + 230 * fbm(x / 420, y / 420, S_MTN2 + 7, 3) + 90 * fbm(x / 130, y / 130, S_MTN2 + 8, 2);   // 山がはじまるところ
      const fan = 150 * sq(ss(ms - 650, ms + 100, d));                                                       // 扇状地
      const plat = ss(-0.04, 0.1, fbm(x / 380, y / 380, S_PLAT, 3)) * (10 + 0.022 * d) * ss(25, 140, d);     // 台地
      const r0 = Math.sqrt(x * x + y * y);
      let hm = clamp((fbm(x / 600, y / 600, S_HILL, 3) - 0.16) * 3.2, 0, 1) * ss(60, 220, d) * ss(140, 380, r0);  // 丘陵（都心にはない）
      hm = clamp(hm + 0.8 * (xk === 2 ? ss(ms - 64, ms + 6, d) : ss(ms - 380 + 150 * w, ms - 30 + 30 * w, d)), 0, 1);   // 山のてまえは丘（広げたところは、海ぞいに平地をのこす）
      const hills = hm > 0 ? hm * (22 + 170 * ridged(x / 95, y / 95, S_HILL + 3, 3)) : 0;
      const mf = xk === 2 ? ss(ms, ms + 130, d) : ss(ms, ms + 280, d);
      const mtn = mf > 0 ? mf * (xk === 2 ? 0.62 : 1) * (220 + 1500 * ridged(x / 120, y / 120, S_MTN, 4) * (0.45 + 0.9 * clamp(fbm(x / 330, y / 330, S_MTN2, 2) + 0.5, 0, 1))) : 0;
      const ep = 1 + 0.03 * d + fan + plat + 1.5 * fbm(x / 14, y / 14, S_HILL + 9, 2);
      e = ep + hills + mtn;
      // 川ぞいは谷になる（平野では広い低地、山では細い谷）。近くの川ぜんぶの分をなめらかに（いちばん低くなるもの）
      let lo = e;
      for (const q of rall) {
        const r = q.r, f = ss(r.s0 - 12, r.s0, q.s) * (1 - ss(r.s1, r.s1 + 90, q.s));
        if (f <= 0) continue;
        const inPl = 1 - ss(r.pd - 250, r.pd + 150, q.s);
        const vw = q.w + 5 + inPl * (r.big ? 46 : 16) + (1 - inPl) * (r.big ? 10 : 4) + (r.trib ? 4 : 0);
        const z = q.a / vw, vf = f / (1 + z * z * z * z);
        const bed = 0.6 + 0.028 * Math.max(0, q.s) + 105 * sq(ss(r.pd - 650, r.pd + 100, q.s)) + 0.22 * Math.max(0, q.s - r.pd - 100);
        const c = e * (1 - 0.82 * vf) + bed * 0.82 * vf;
        if (c < lo) lo = c;
      }
      rl = lo - ep;
      e = lo;
    }
    let t;
    const isRiver = rn && rn.a < rn.w * 0.5 + 0.35 && rn.s > rn.r.s0 - 4 && rn.s < rn.r.s1 && d > -3;
    if (isRiver) t = 'R';
    else if (d < -26) t = 'D';
    else if (d < 0) t = 'S';
    else {
      const lake = d > 45 && rl < 20 && e < 150 && fbm(x / 46, y / 46, S_LAKE, 2) > 0.42 && x * x + y * y > 120 * 120;
      if (lake) t = 'L';
      else if (d < 2.2 && e < 4 && fbm(x / 60, y / 60, S_C2 + 9, 2) > -0.08) t = 'B';
      else if (rl < 28) t = fbm(x / 22, y / 22, S_FOR, 3) > 0.17 ? 'F' : 'P';
      else if (rl < 300 && e < 900) t = 'H';
      else if (e < 1700) t = 'M';
      else t = 'K';
    }
    return { t, e, d, u, v, rn, isRiver, rl, xk };
  }

  /* ---------- 市町村（ジッターつき格子のたね。瑠璃市だけ特別に大きい） ---------- */
  const MC = 150, RURI = { id: 'm:ruri', x: 0, y: 0, w: 165, name: '瑠璃', type: '市', pop: 1250000, ruri: true };
  /* 広げた国土（t55）：もとの市町村のたねはそのまま（広げる前の地形でえらぶ）。新しい土地（南の陸 j ≥ 11・島）にだけ、新しい市町村のたね
     もとの国土のマスは、もとのたねだけを見る（区域・人の多さが変わらない）。南の陸のはじめ（y < 1720）は、新しいたねを遠めに見る（境目がもとの地図にくっつかない） */
  const munis = new Map(), munis0 = new Map();
  const extGrid = (i, j) => j >= 11 || (i >= 4 && i <= 10 && j >= 4 && j <= 9);
  function muniSeed0(i, j) { const key = i + ',' + j; let m = munis0.get(key); if (m === undefined) { m = seedAt(i, j, cell0, false); munis0.set(key, m); } return m; }
  function muniSeed(i, j) {
    const key = i + ',' + j; let m = munis.get(key); if (m !== undefined) return m;
    m = muniSeed0(i, j);
    if (!m && extGrid(i, j)) m = seedExt(i, j);
    munis.set(key, m); return m;
  }
  /* 新しい土地の市町村のたね（t55）
     決めた場所（XFIX：格子 i,j → [x, y, 種類, 人口]）：湾の奥の川の河口の大きいまち・島の市町（島はこれだけ）
     ほかの南の陸は、もとと同じえらび方（人は少なめ。丘・山の中は、ときどき となりにまとめる） */
  const XFIX = { '-7,15': [-960, 2330, '市', 420000], '1,16': [160, 2470, '市', 280000], '5,15': [780, 2360, '市', 230000], '-9,12': [-1300, 1850, '市', 150000], '8,12': [1270, 1800, '市', 90000],
                 '5,7': [870, 1180, '市', 85000], '7,8': [1180, 1235, '町', 22000], '8,6': [1300, 1000, '町', 18000], '5,9': [800, 1360, '町', 15000], '7,7': [1060, 1060, '村', 3500] };
  const gunName = (i, j) => kanjiName(hash3(Math.floor(i / 2), Math.floor(j / 2), S_MUNI + 7));
  function seedExt(i, j) {
    const f = XFIX[i + ',' + j];
    if (f) {   // 近くの、海ぞいの低いところ
      let best = null;
      for (let dy = -36; dy <= 36; dy += 3) for (let dx = -36; dx <= 36; dx += 3) {
        const x = f[0] + dx, y = f[1] + dy, q = cell(x, y);
        if (q.t === 'D' || q.t === 'S' || q.t === 'R' || q.t === 'L' || q.d < 8) continue;
        const sc = -q.e - Math.abs(q.d - 30) * 0.3 - Math.sqrt(dx * dx + dy * dy) * 0.25;
        if (!best || sc > best.sc) best = { x, y, sc };
      }
      if (best) return { id: 'm:' + i + '_' + j, i, j, x: best.x, y: best.y, w: 0, type: f[2], pop: f[3], name: kanjiName(hash3(i, j, S_MUNI + 3)), gun: f[2] === '市' ? '' : gunName(i, j), ext: true };
    }
    if (j <= 10) return null;   // 島は決めた場所だけ
    const cx = i * MC + MC / 2, cy = j * MC + MC / 2;
    let best = null;
    for (let c = 0; c < 7; c++) {
      const x = Math.floor(i * MC + MC * (0.15 + 0.7 * rnd(i, j * 31 + c, S_MUNI))), y = Math.floor(j * MC + MC * (0.15 + 0.7 * rnd(i * 17 + c, j, S_MUNI + 1)));
      const q = cell(x, y);
      if (q.t === 'D' || q.t === 'S' || q.t === 'R' || q.t === 'L' || q.d < 4) continue;
      const sc = -q.e - (q.t === 'F' ? 10 : 0) + rnd(x, y, S_MUNI + 2) * 25 - Math.abs(q.d - 25) * 0.08;
      if (!best || sc > best.sc) best = { x, y, sc, q };
    }
    if (!best) return null;
    const q = best.q, r1 = rnd(i, j, S_EXT + 21);
    if ((q.e > 380 && r1 < 0.6) || (q.e > 150 && r1 < 0.3)) return null;   // 丘・山の中は、ときどき となりの市町村にまとめる
    const flat = q.rl < 28 && q.d < plainDepth(q.v) - 120;
    const type = flat ? (rnd(i, j, S_MUNI + 8) < 0.6 ? '市' : '町') : q.e < 320 ? '町' : '村';
    const pop = type === '市' ? Math.round(30000 + 150000 * rnd(i, j, S_MUNI + 4) * rnd(i, j, S_MUNI + 5) + 15000 * rnd(i, j, S_MUNI + 6))
      : type === '町' ? Math.round(5000 + 26000 * rnd(i, j, S_MUNI + 4)) : Math.round(700 + 4800 * rnd(i, j, S_MUNI + 4));
    return { id: 'm:' + i + '_' + j, i, j, x: best.x, y: best.y, w: 0, type, pop, name: kanjiName(hash3(i, j, S_MUNI + 3)), gun: type === '市' ? '' : gunName(i, j), ext: true, cx, cy };
  }
  function seedAt(i, j, cellf, ext) {
    let m = null;
    const cx = i * MC + MC / 2, cy = j * MC + MC / 2;
    if (cx * cx + cy * cy > 235 * 235) {
      let best = null;
      for (let c = 0; c < 7; c++) {
        const x = Math.floor(i * MC + MC * (0.15 + 0.7 * rnd(i, j * 31 + c, S_MUNI))), y = Math.floor(j * MC + MC * (0.15 + 0.7 * rnd(i * 17 + c, j, S_MUNI + 1)));
        const q = cellf(x, y);
        if (q.t === 'D' || q.t === 'S' || q.t === 'R' || q.t === 'L' || q.d < 4) continue;
        const sc = -q.e - (q.t === 'F' ? 10 : 0) + rnd(x, y, S_MUNI + 2) * 25 - Math.abs(q.d - 25) * 0.08;
        if (!best || sc > best.sc) best = { x, y, sc, q };
      }
      if (best && ext && best.q.e > 380 && rnd(i, j, S_EXT + 21) < 0.5) best = null;   // 新しい山の中は、ときどき となりの村にまとめる
      if (best) {
        const q = best.q, h = hash3(i, j, S_MUNI + 3), r0 = Math.sqrt(best.x * best.x + best.y * best.y);
        // 平野の市町村は「市」が多い（瑠璃に近いほど）。山あいは町・村
        const flat = q.rl < 28 && q.d < plainDepth(q.v) - 120;
        const type = flat ? (rnd(i, j, S_MUNI + 8) < (q.d < 175 ? 0.85 : 0.38 + 0.47 * (1 - ss(300, 1700, r0))) ? '市' : '町') : q.e < 320 ? '町' : '村';
        let pop = type === '市' ? Math.round(45000 + 260000 * rnd(i, j, S_MUNI + 4) * rnd(i, j, S_MUNI + 5) + 20000 * rnd(i, j, S_MUNI + 6))
          : type === '町' ? Math.round(6000 + 38000 * rnd(i, j, S_MUNI + 4)) : Math.round(800 + 5600 * rnd(i, j, S_MUNI + 4));
        if (type === '市') {
          pop = Math.round(pop * (1 + 1.3 * (1 - ss(250, 1000, r0))));                          // 瑠璃のとなりは大きいベッドタウン
          if (r0 > 400 && rnd(i, j, S_MUNI + 9) < 0.06) pop = Math.round(420000 + 480000 * rnd(i, j, S_MUNI + 10));   // ときどき大きい市
        }
        m = { id: 'm:' + i + '_' + j, i, j, x: best.x, y: best.y, w: 0, type, pop, name: kanjiName(h), gun: type === '市' ? '' : kanjiName(hash3(Math.floor(i / 2), Math.floor(j / 2), S_MUNI + 7)) };
        if (ext) m.ext = true;
      }
    }
    return m;
  }
  const warpX = (x, y) => x + 14 * fbm(x / 45, y / 45, S_MUNI + 40, 2), warpY = (x, y) => y + 14 * fbm(x / 45, y / 45, S_MUNI + 41, 2);
  function muniAt(x0, y0) {
    const x = warpX(x0, y0), y = warpY(x0, y0);
    const i0 = Math.floor(x / MC), j0 = Math.floor(y / MC);
    const ez = extZone(x0, y0), pen = ez && y0 >= Y_EXT ? sq(170 * ss(1720, 1560, y0)) : 0;
    let best = RURI, bd = x * x + y * y - RURI.w * RURI.w;
    for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) {
      const m = ez ? muniSeed(i, j) : muniSeed0(i, j); if (!m) continue;
      const dx = x - m.x, dy = y - m.y, dd = dx * dx + dy * dy + (m.ext ? pen : 0);
      if (dd < bd) { bd = dd; best = m; }
    }
    return best;
  }
  /* 瑠璃市の区（中里区がまん中、梁川区が瑠璃川の河口の港。ほかは格子のたね） */
  const WC = 105;
  const R0 = river(0);
  const mouth = (() => { const s = 9, v = riverV(R0, s) - 16, u = R0.cu - s; return { x: Math.round((u + v) * SQ), y: Math.round((u - v) * SQ) }; })();
  const FIXED_WARDS = [{ id: 'w:nakazato', x: 0, y: 0, name: '中里', core: true }, { id: 'w:yanagawa', x: mouth.x, y: mouth.y, name: '梁川', port: true }];
  const wards = new Map();
  function wardSeed(i, j) {
    const key = i + ',' + j; let w = wards.get(key); if (w !== undefined) return w;
    w = null;
    const x = Math.floor(i * WC + WC * (0.2 + 0.6 * rnd(i, j, S_WARD))), y = Math.floor(j * WC + WC * (0.2 + 0.6 * rnd(i, j, S_WARD + 1)));
    const far = FIXED_WARDS.every(f => (f.x - x) * (f.x - x) + (f.y - y) * (f.y - y) > 72 * 72);
    if (far && muniAt(x, y) === RURI) { const q = cell(x, y); if (q.d > 3 && q.t !== 'R' && q.t !== 'L') w = { id: 'w:' + i + '_' + j, x, y, name: kanjiName(hash3(i, j, S_WARD + 2)) }; }
    wards.set(key, w); return w;
  }
  function wardAt(x0, y0) {
    const x = x0 + 9 * fbm(x0 / 30, y0 / 30, S_WARD + 40, 2), y = y0 + 9 * fbm(x0 / 30, y0 / 30, S_WARD + 41, 2);
    const i0 = Math.floor(x / WC), j0 = Math.floor(y / WC);
    let best = null, bd = Infinity;
    for (const f of FIXED_WARDS) { const dx = x - f.x, dy = y - f.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = f; } }
    for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) {
      const w = wardSeed(i, j); if (!w) continue;
      const dx = x - w.x, dy = y - w.y, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = w; }
    }
    return best;
  }
  // そのマスの「区域」（区のある市は区、それ以外は市町村）
  function areaAt(x, y) { const m = muniAt(x, y); return m === RURI ? wardAt(x, y) : m; }
  // 区の人口（瑠璃市 125万人をわける。中里区・梁川区は多め）
  function wardPop(w) { return w.core ? 205000 : w.port ? 188000 : Math.round(105000 + 95000 * rnd(w.x, w.y, S_WARD + 5)); }

  /* ---------- 人口のかたまり（まちのまん中ほど人が多い） ----------
     1マスの人口（人）＝ dp ÷（π σ²）÷（1 + r²/σ²）²。dp はかたまりの人数、σ（sg）はまちの広がり
     瑠璃市は「市全体のゆるい広がり（55%）」＋「区ごとのまち（45%）」＋「中里区の都心」。ほかの市町村は1つずつ */
  const sig = p => 0.072 * Math.sqrt(p);
  let ruriPop = 0;
  function ruriTotal() {
    if (ruriPop) return ruriPop;
    let t = 0;
    for (const f of FIXED_WARDS) t += wardPop(f);
    for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) { const w = wardSeed(i, j); if (w) t += wardPop(w); }
    return (ruriPop = t);
  }
  const CORE = 110000;
  function centersNear(x, y, all) {
    const out = [], i0 = Math.floor(x / MC), j0 = Math.floor(y / MC), ez = all || extZone(x, y);   // もとの国土のマスは、もとの市町村だけ（t55）
    for (let i = i0 - 3; i <= i0 + 3; i++) for (let j = j0 - 3; j <= j0 + 3; j++) { const m = ez ? muniSeed(i, j) : muniSeed0(i, j); if (m) out.push({ id: m.id, x: m.x, y: m.y, dp: m.pop, sg: sig(m.pop) }); }
    if (x * x + y * y < 1500 * 1500) {
      const T = ruriTotal();
      out.push({ id: 'c:ruri', x: 0, y: 0, dp: Math.round(0.55 * T) - CORE, sg: 105 }, { id: 'c:core', x: 0, y: 0, dp: CORE, sg: 20 },
        { id: 'c:metro', x: 0, y: 0, dp: 4000000, sg: 300 });                  // 瑠璃のまわりに広がる郊外（ベッドタウン）
      for (const f of FIXED_WARDS) { const p = wardPop(f); out.push({ id: f.id, x: f.x, y: f.y, dp: Math.round(0.45 * p), sg: 0.06 * Math.sqrt(p) }); }
      const k0 = Math.floor(x / WC), l0 = Math.floor(y / WC);
      for (let i = k0 - 5; i <= k0 + 5; i++) for (let j = l0 - 5; j <= l0 + 5; j++) { const w = wardSeed(i, j); if (w) { const p = wardPop(w); out.push({ id: w.id, x: w.x, y: w.y, dp: Math.round(0.45 * p), sg: 0.06 * Math.sqrt(p) }); } }
    }
    return out;
  }
  function density(x, y, cs) {
    let s = 0;
    for (const c of cs) {
      const dx = x - c.x, dy = y - c.y, q = 1 + (dx * dx + dy * dy) / (c.sg * c.sg);
      s += c.dp / (3.141592653589793 * c.sg * c.sg) / (q * q);
    }
    return s;
  }
  // 人口のかたまりの一覧（場所がこの範囲にあるもの。サーバーが地価や駅の利用者を計算するのに使う）
  function centers(cx0, cy0, cx1, cy1) {
    const X0 = cx0 * CS, Y0 = cy0 * CS, X1 = (cx1 + 1) * CS, Y1 = (cy1 + 1) * CS, seen = new Set(), out = [];
    for (let x = X0; x < X1 + MC; x += MC) for (let y = Y0; y < Y1 + MC; y += MC) {
      for (const c of centersNear(Math.min(x, X1 - 1), Math.min(y, Y1 - 1), true)) {
        if (seen.has(c.id) || c.x < X0 || c.x >= X1 || c.y < Y0 || c.y >= Y1) continue;
        seen.add(c.id); out.push(c);
      }
    }
    return out;
  }

  /* ---------- 用途地域（はじめの都市計画） ----------
     人の多さ（dens）で決める。まん丸にならないよう、場所ごとのゆらぎ（zf）をかける。工業団地・川ぞいの準工業も */
  const S_ZN = SEED + 127;
  function zoneOf(q, dens, area, x, y) {
    const t = q.t;
    if (t === 'D' || t === 'S' || t === 'R' || t === 'L') return '-';
    if (t === 'B') return dens > 5 ? 'j' : '-';
    if (t === 'M' || t === 'K') return 'i';
    if (area && area.port && q.d < 40) return q.d < 13 ? 'g' : q.d < 27 ? 'f' : 'e';      // 梁川区の海ぞい：港湾・工業
    const zd = dens * (1 + 0.7 * fbm(x / 36, y / 36, S_ZN, 3));                              // ゆらぎつきの人の多さ
    if (zd >= 5 && q.rn && q.rn.a < q.rn.w * 0.5 + 1.6) return 'j';                          // 河川敷
    if (zd >= 5 && fbm(x / 9, y / 9, S_PARK, 2) > 0.36) return 'j';                            // 公園
    if (t === 'H') return zd >= 6 ? 'a' : 'i';
    if (zd >= 3 && zd < 30 && fbm(x / 70, y / 70, S_IND + 2, 2) > 0.3) return 'f';            // 郊外の工業団地
    if (zd >= 52) return 'd';
    if (zd >= 33) return 'c';
    if (zd >= 6 && q.d < 45 && fbm(x / 26, y / 26, S_IND, 2) > 0.27) return 'e';             // 海ぞいの準工業
    if (zd >= 6 && q.rn && q.rn.r.big && q.rn.a < q.rn.w * 0.5 + 9 && fbm(x / 20, y / 20, S_IND + 3, 2) > 0.2) return 'e';   // 大きい川ぞいの準工業
    if (zd >= 14) return 'b';
    if (zd >= 5) return 'a';
    return t === 'F' ? 'i' : 'h';
  }

  /* ---------- 県（たねのいちばん近いもの。市町村ごと＝市町村のたねの場所で決める） ---------- */
  const PC = 1400;
  function prefSeed(i, j) {
    if (i === 0 && j === 0) return { id: 'p:ruri', k: 'pref', name: '瑠璃', x: 0, y: 0, type: '府' };   // 瑠璃府
    return { id: 'p:' + i + '_' + j, k: 'pref', name: kanjiName(hash3(i, j, S_PREF + 2)), type: '県',
      x: Math.floor(i * PC - PC / 4 + PC / 2 * rnd(i, j, S_PREF)), y: Math.floor(j * PC - PC / 4 + PC / 2 * rnd(i, j, S_PREF + 1)) };
  }
  function prefAt(x, y) {
    const i0 = Math.round(x / PC), j0 = Math.round(y / PC);
    let best = null, bd = Infinity;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const p = prefSeed(i, j), dx = x - p.x, dy = y - p.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = p; } }
    return best;
  }
  function prefsIn(X0, Y0, X1, Y1) {
    const out = [];
    for (let i = Math.round(X0 / PC) - 1; i <= Math.round(X1 / PC) + 1; i++) for (let j = Math.round(Y0 / PC) - 1; j <= Math.round(Y1 / PC) + 1; j++) {
      const p = prefSeed(i, j); if (p.x >= X0 && p.x < X1 && p.y >= Y0 && p.y < Y1) out.push(p);
    }
    return out;
  }

  /* ---------- チャンク ---------- */
  function chunk(cx, cy) {
    const N = CS * CS, T = new Array(N), E = new Array(N), Z = new Array(N), A = new Array(N), pal = [], palIx = new Map();
    const x0 = cx * CS, y0 = cy * CS;
    let cs = null, csKey = '';
    for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) {
      const x = x0 + i, y = y0 + j, k = j * CS + i, q = cell(x, y);
      T[k] = q.t;
      E[k] = B64[eenc(q.e)];
      const ar = areaAt(x, y);
      let ix = palIx.get(ar.id); if (ix === undefined) { ix = pal.length; pal.push(ar.id); palIx.set(ar.id, ix); }
      A[k] = B64[ix];
      const key = Math.floor(x / 32) + ',' + Math.floor(y / 32) + (extZone(x, y) ? 'e' : '');
      if (key !== csKey) { csKey = key; cs = centersNear(x, y); }
      Z[k] = zoneOf(q, density(x, y, cs), ar, x, y);
    }
    return { cx, cy, t: T.join(''), e: E.join(''), z: Z.join(''), a: A.join(''), ap: pal };
  }

  /* ---------- 地名（たねがこの範囲にあるもの） ---------- */
  function places(cx0, cy0, cx1, cy1) {
    const X0 = cx0 * CS, Y0 = cy0 * CS, X1 = (cx1 + 1) * CS, Y1 = (cy1 + 1) * CS, out = [];
    const inR = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1;
    // 県（はじめは瑠璃府だけ。広げたら、遠くに別の県ができる）
    for (const p of prefsIn(X0, Y0, X1, Y1)) out.push(p);
    // 市町村
    if (inR(0, 0)) out.push({ id: RURI.id, k: 'muni', name: RURI.name, x: 0, y: 0, type: '市', pop: ruriTotal(), wards: true, parent: 'p:ruri', cap: true });
    for (let i = Math.floor(X0 / MC) - 1; i <= Math.floor((X1 - 1) / MC) + 1; i++) for (let j = Math.floor(Y0 / MC) - 1; j <= Math.floor((Y1 - 1) / MC) + 1; j++) {
      const m = muniSeed(i, j);
      if (m && inR(m.x, m.y)) out.push({ id: m.id, k: 'muni', name: m.name, x: m.x, y: m.y, type: m.type, pop: m.pop, gun: m.gun, parent: prefAt(m.x, m.y).id });
    }
    // 区
    for (const f of FIXED_WARDS) if (inR(f.x, f.y)) out.push({ id: f.id, k: 'ward', name: f.name, x: f.x, y: f.y, type: '区', pop: wardPop(f), parent: RURI.id, core: !!f.core, port: !!f.port });
    for (let i = Math.floor(X0 / WC) - 1; i <= Math.floor((X1 - 1) / WC) + 1; i++) for (let j = Math.floor(Y0 / WC) - 1; j <= Math.floor((Y1 - 1) / WC) + 1; j++) {
      const w = wardSeed(i, j);
      if (w && inR(w.x, w.y)) out.push({ id: w.id, k: 'ward', name: w.name, x: w.x, y: w.y, type: '区', pop: wardPop(w), parent: RURI.id });
    }
    // 町名（14マスごとのたね。水の上にはない）
    const DC = 14;
    for (let i = Math.floor(X0 / DC); i <= Math.floor((X1 - 1) / DC); i++) for (let j = Math.floor(Y0 / DC); j <= Math.floor((Y1 - 1) / DC); j++) {
      const x = Math.floor(i * DC + DC * (0.15 + 0.7 * rnd(i, j, S_DIST))), y = Math.floor(j * DC + DC * (0.15 + 0.7 * rnd(i, j, S_DIST + 1)));
      if (!inR(x, y)) continue;
      const q = cell(x, y);
      if (q.t === 'D' || q.t === 'S' || q.t === 'R' || q.t === 'L') continue;
      const ar = areaAt(x, y), dens = density(x, y, centersNear(x, y)), h = hash3(i, j, S_DIST + 2);
      let pool;
      if (ar.x === x && ar.y === y) pool = DN_CORE;
      else if (q.d < 14) pool = DN_SEA;
      else if (q.rn && q.rn.a < q.rn.w + 4) pool = DN_RIVER;
      else if (q.t === 'H' || (q.e > 70 && dens > 5)) pool = DN_HILL;
      else if (dens > 10) pool = (h & 7) < 2 ? DN_CORE : DN_TOWN;
      else pool = null;
      const name = pool ? pick(pool, h >>> 3) : NA[(h >>> 3) % NA.length] + DN_RURAL_B[(h >>> 13) % DN_RURAL_B.length];
      out.push({ id: 'd:' + i + '_' + j, k: 'dist', name, x, y, parent: ar.id, urban: dens > 5 });
    }
    // 川の名前（河口の近くと、上流のところ）
    const k0 = Math.floor(((X0 - Y1) * SQ) / RS) - 3, k1 = Math.ceil(((X1 - Y0) * SQ) / RS) + 3;
    for (let k = k0; k <= k1; k++) {
      const r0 = river(k);
      for (const r of [r0, ...r0.tribs]) {
        const ss_ = r.trib ? [r.s0 + 160, r.s0 + 800] : [26, 230, 520, 1100, 1700, 2300, 2900];
        for (const s of ss_) {
          if (s > r.s1 - 20) continue;
          const v = riverV(r, s), u = r.cu - s, x = Math.round((u + v) * SQ), y = Math.round((u - v) * SQ);
          if (inR(x, y)) out.push({ id: 'r:' + k + (r.trib ? 't' + r.j : '') + ':' + Math.round(s), k: 'river', name: r.name, x, y });
        }
      }
    }
    return out;
  }

  return { CS, SEED, chunk, places, centers, cell, cell0, extZone, Y_EXT, ISL_BOX, xrivers, areaAt, muniAt, wardAt, density: (x, y) => density(x, y, centersNear(x, y)), mouth, river, riverV, riverW, ruriTotal, prefAt, plainDepth, coastU, RS };
}

/* 同じ区域（市町村・区）の中で町名が重ならないように、あとから来たほうに「東・西・新…」をつける。
   taken：区域ごとのすでに使っている名前（Map: 区域 → Set）。places は id の順に処理する（いつも同じ結果） */
function dedupe(places, taken) {
  taken = taken || new Map();
  const first = new Map();
  const ds = places.filter(p => p.k === 'dist').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const p of ds) {
    let set = taken.get(p.parent); if (!set) { set = new Set(); taken.set(p.parent, set); }
    if (!set.has(p.name)) { set.add(p.name); first.set(p.parent + '|' + p.name, p); continue; }
    const f = first.get(p.parent + '|' + p.name), base = p.name.replace(/^(東|西|南|北|新|上|下|中|奥|本)(?=..)/, '');
    const dx = f ? p.x - f.x : 0, dy = f ? p.y - f.y : 0;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '東' : '西') : (dy > 0 ? '南' : '北');
    let nm = '';
    for (const pre of [dir, '新', '上', '下', '中', '奥', '東', '西', '南', '北']) { const t = pre + base; if (!set.has(t)) { nm = t; break; } }
    for (let i = 0; !nm; i++) { const t = NA[hash3(p.x, p.y, i) % NA.length] + base; if (!set.has(t)) nm = t; }
    p.name = nm; set.add(nm);
  }
  return places;
}

const MapGen = { world, CS, B64, hash3, dedupe, eenc, edec };
if (typeof module !== 'undefined' && module.exports) module.exports = MapGen; else root.MapGen = MapGen;
})(typeof self !== 'undefined' ? self : this);
