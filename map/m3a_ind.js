(function () {
'use strict';
/* ===== 風の芽経済組：国土の地図 3D の建物（t65）・ind：工場・倉庫・港・農業・駐車場・インフラ =====
   型の名前は i_…、質感の名前は i:…
   ・質感は少なく：うすい色の質感 × 頂点の色（見た目の色）で 染める。横帯の質感（帯 k 本目）は v をのばして使う（たての模様だけ）
   ・大きな区画（〜1600 区画）は 棟を わけて、小物の数は 面積の平方根まで。遠く（lod 0）は 箱と屋根だけ
   ・far(L, P)：いちばん遠く（lod -1。core が組み立てる）の めやす */
const A = window.M3A, PT = A.paint, PI = Math.PI;
const W1 = [1, 1, 1];
const col = A.col, mul = A.mul, mix = A.mix, css = PT.css, fill = PT.fill;
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const rw = r => r[2] - r[0], rd = r => r[3] - r[1];

/* ---------- 描く道具 ---------- */
// たての波（n 山）
function ribs(g, x, y, w, h, n, c, dk = 0.74, lt = 1.1) {
  const p = w / n;
  for (let i = 0; i < n; i++) {
    const u = x + i * p, gr = g.createLinearGradient(u, 0, u + p, 0);
    gr.addColorStop(0, css(c, dk)); gr.addColorStop(0.3, css(c, lt)); gr.addColorStop(0.52, css(c, 1)); gr.addColorStop(0.82, css(c, 0.87)); gr.addColorStop(1, css(c, dk));
    g.fillStyle = gr; g.fillRect(u, y, p + 0.5, h);
  }
}
// 台形の山（角波・折板）
function trap(g, x, y, w, h, n, c) {
  const p = w / n; fill(g, x, y, w, h, c);
  for (let i = 0; i < n; i++) {
    const u = x + i * p;
    g.fillStyle = css(c, 1.1); g.fillRect(u, y, p * 0.15, h);
    g.fillStyle = css(c, 0.72); g.fillRect(u + p * 0.15, y, Math.max(1, p * 0.08), h);
    g.fillStyle = css(c, 0.9); g.fillRect(u + p * 0.23, y, Math.max(1, p * 0.05), h);
    g.fillStyle = css(c, 0.95); g.fillRect(u + p * 0.9, y, Math.max(1, p * 0.1), h);
  }
}
// 上から たれる よごれ
function drips(g, x, y, w, h, n, rgb, a, R, len = 0.7) {
  for (let i = 0; i < n; i++) {
    const sx = x + R() * w, sw = Math.max(1, w * (0.002 + R() * 0.007)), sl = h * len * (0.3 + 0.7 * R()), sy = y + R() * h * 0.08;
    const gr = g.createLinearGradient(0, sy, 0, sy + sl); gr.addColorStop(0, `rgba(${rgb},${(a * (0.5 + R() * 0.5)).toFixed(3)})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(sx, sy, sw, sl);
  }
}
// 下の よごれ（はね返り）
function grime(g, x, y, w, h, a, t = 0.3, rgb = '55,50,42') { const gr = g.createLinearGradient(0, y + h * (1 - t), 0, y + h); gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(1, `rgba(${rgb},${a})`); g.fillStyle = gr; g.fillRect(x, y + h * (1 - t), w, h * t); }
// まだら（よこに つながる。sy：たての つぶし）
function blots(g, x, y, w, h, n, rgb, a, R, s = 0.05, sy = 1) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  for (let i = 0; i < n; i++) {
    const cx = x + R() * w, cy = y + R() * h, r = (0.3 + R()) * s * w, aa = (a * (0.4 + 0.6 * R())).toFixed(3);
    for (const ox of [-w, 0, w]) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(${rgb},${aa})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.save(); g.translate(cx + ox, cy); g.scale(1, sy); g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2); g.restore();
    }
  }
  g.restore();
}
const clip = (g, x, y, w, h, f) => { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); f(); g.restore(); };
const rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

/* ---------- 質感 ----------
   i:nami（外壁の波板 8 帯・たてにのばす）・i:roof（屋根 4 帯）・i:win（窓の帯 8 本・すかし）・i:door（戸 4×4 ます）
   i:panel・i:alc・i:conc・i:brick（m ではる）・i:flat（平らな屋根）・i:asph・i:cpad（地面）・far 用 i:fw… */
// 外壁の波板：帯 k（上から）0 亜鉛めっき・1 塗装（うすい色）・2 塗装（錆すじ）・3 大波スレート・4 錆びたトタン・5 角波（うすい色）・6 木の板・7 焼杉
A.tex('i:nami', 256, 512, (g, w, h, R) => {
  const n = 8, sh = h / n;
  const S = (k, f) => clip(g, 0, k * sh, w, sh, () => f(k * sh));
  S(0, y => { ribs(g, 0, y, w, sh, 48, '#b7bcbe'); blots(g, 0, y, w, sh, 40, '255,255,255', 0.16, R, 0.05, 0.25); blots(g, 0, y, w, sh, 24, '60,66,70', 0.12, R, 0.06, 0.3); drips(g, 0, y, w, sh, 30, '70,64,58', 0.14, R, 0.6); grime(g, 0, y, w, sh, 0.32, 0.22); PT.noise(g, 0, y, w, sh, 0.025, R); });
  S(1, y => { ribs(g, 0, y, w, sh, 48, '#eeede8', 0.8, 1.06); drips(g, 0, y, w, sh, 24, '90,90,85', 0.09, R, 0.5); grime(g, 0, y, w, sh, 0.22, 0.2); PT.noise(g, 0, y, w, sh, 0.02, R); });
  S(2, y => { ribs(g, 0, y, w, sh, 48, '#e9e7e0', 0.8, 1.06); drips(g, 0, y, w, sh, 40, '120,62,30', 0.22, R, 0.45); for (const t of [0.34, 0.67]) drips(g, 0, y + sh * t, w, sh * 0.3, 18, '120,62,30', 0.18, R, 0.8); blots(g, 0, y + sh * 0.8, w, sh * 0.2, 16, '110,60,32', 0.25, R, 0.04, 0.4); grime(g, 0, y, w, sh, 0.3, 0.25); PT.noise(g, 0, y, w, sh, 0.025, R); });
  S(3, y => { ribs(g, 0, y, w, sh, 30, '#b1b2ad', 0.8, 1.07); drips(g, 0, y, w, sh, 46, '40,42,40', 0.2, R, 0.85); blots(g, 0, y, w, sh, 30, '70,78,60', 0.14, R, 0.05, 0.3); blots(g, 0, y, w, sh, 20, '230,230,220', 0.1, R, 0.04, 0.3); grime(g, 0, y, w, sh, 0.4, 0.3, '40,44,36'); PT.noise(g, 0, y, w, sh, 0.03, R); });
  S(4, y => { ribs(g, 0, y, w, sh, 48, '#a9a496'); blots(g, 0, y, w, sh, 60, '128,62,30', 0.55, R, 0.06, 0.35); blots(g, 0, y, w, sh, 30, '90,44,24', 0.4, R, 0.04, 0.3); drips(g, 0, y, w, sh, 40, '110,52,26', 0.3, R, 0.9); grime(g, 0, y, w, sh, 0.35, 0.3); PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(5, y => { trap(g, 0, y, w, sh, 20, '#ecebe7'); drips(g, 0, y, w, sh, 20, '90,90,85', 0.08, R, 0.5); grime(g, 0, y, w, sh, 0.2, 0.18); PT.noise(g, 0, y, w, sh, 0.018, R); });
  S(6, y => { for (let i = 0; i < 24; i++) { const u = i * w / 24; rect(g, u, y, w / 24, sh, css('#6b5543', 0.82 + R() * 0.3)); rect(g, u, y, 1, sh, 'rgba(0,0,0,.35)'); } drips(g, 0, y, w, sh, 20, '30,24,20', 0.2, R, 0.8); grime(g, 0, y, w, sh, 0.35, 0.3); PT.noise(g, 0, y, w, sh, 0.05, R); });
  S(7, y => { for (let i = 0; i < 24; i++) { const u = i * w / 24; rect(g, u, y, w / 24, sh, css('#34312e', 0.85 + R() * 0.3)); rect(g, u + w / 48, y, 1, sh, 'rgba(255,255,255,.06)'); rect(g, u, y, 1, sh, 'rgba(0,0,0,.4)'); } grime(g, 0, y, w, sh, 0.3, 0.2); PT.noise(g, 0, y, w, sh, 0.05, R); });
});
// 屋根：帯 0 折板（うすい色）・1 折板＋明かり取り・2 大波スレート・3 錆の出た折板
A.tex('i:roof', 256, 256, (g, w, h, R) => {
  const n = 4, sh = h / n;
  const S = (k, f) => clip(g, 0, k * sh, w, sh, () => f(k * sh));
  S(0, y => { trap(g, 0, y, w, sh, 12, '#e3e4e3'); blots(g, 0, y, w, sh, 14, '80,80,78', 0.08, R, 0.1, 0.5); PT.noise(g, 0, y, w, sh, 0.02, R); });
  S(1, y => { trap(g, 0, y, w, sh, 12, '#e3e4e3'); const x = w * 0.42; trap(g, x, y, w * 2 / 12, sh, 2, '#f4f8f8'); rect(g, x, y, w * 2 / 12, sh, 'rgba(170,200,210,.35)'); blots(g, 0, y, w, sh, 14, '80,80,78', 0.08, R, 0.1, 0.5); PT.noise(g, 0, y, w, sh, 0.02, R); });
  S(2, y => { ribs(g, 0, y, w, sh, 40, '#9a9c98', 0.8, 1.08); blots(g, 0, y, w, sh, 40, '40,46,34', 0.22, R, 0.06, 0.5); blots(g, 0, y, w, sh, 20, '220,220,210', 0.1, R, 0.05, 0.5); drips(g, 0, y, w, sh, 30, '30,30,28', 0.12, R, 1); PT.noise(g, 0, y, w, sh, 0.035, R); });
  S(3, y => { trap(g, 0, y, w, sh, 12, '#dcdcda'); blots(g, 0, y, w, sh, 50, '125,62,30', 0.45, R, 0.06, 0.5); blots(g, 0, y, w, sh, 20, '80,40,22', 0.35, R, 0.03, 0.5); PT.noise(g, 0, y, w, sh, 0.035, R); });
});
// 窓の帯（すかし）：帯 k 0 アルミの窓・1 工場の高窓（網入り）・2 明かり取り（ポリカ）・3 連窓・4 小窓と面格子・5 ガラリ・6 カーテンウォール・7 縦長の窓（鉄の戸）
const WIN = [
  (g, x, y, w, h, R) => { const wx = x + w * 0.13, wy = y + h * 0.1, ww = w * 0.74, wh = h * 0.78; rect(g, wx - 2, wy - 2, ww + 4, wh + 5, 'rgba(0,0,0,.25)');
    PT.win(g, wx, wy, ww, wh, { f: '#c9cdcf', fw: Math.max(1, ww * 0.035), div: [2, 1], g0: '#a9bbc8', g1: '#4b5f6f', bl: 0.5, cur: 0.15, cc: ['#e9e5da', '#dfe3e6'] }, R); },
  (g, x, y, w, h, R) => { const wx = x + w * 0.07, wy = y + h * 0.1, ww = w * 0.86, wh = h * 0.8; rect(g, wx - 2, wy - 2, ww + 4, wh + 5, 'rgba(0,0,0,.22)'); rect(g, wx, wy, ww, wh, '#56605d');
    const nx = 4, ny = 2, fw = Math.max(1, ww * 0.018);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const px = wx + fw + i * (ww - fw) / nx, py = wy + fw + j * (wh - fw) / ny, pw = (ww - fw) / nx - fw, ph = (wh - fw) / ny - fw, op = R() < 0.12;
      const gr = g.createLinearGradient(0, py, 0, py + ph); gr.addColorStop(0, op ? '#2b3231' : '#b9c6c2'); gr.addColorStop(1, op ? '#1e2423' : '#7b8c88'); g.fillStyle = gr; g.fillRect(px, py, pw, ph);
      g.fillStyle = 'rgba(40,50,50,.16)'; for (let t = px; t < px + pw; t += 3) g.fillRect(t, py, 1, ph); for (let t = py; t < py + ph; t += 3) g.fillRect(px, t, pw, 1); } },
  (g, x, y, w, h, R) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#f1f4f2'); gr.addColorStop(1, '#c6cdca'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    for (let u = x; u < x + w; u += w / 10) { rect(g, u, y, 1, h, 'rgba(255,255,255,.6)'); rect(g, u + 1, y, 1.5, h, 'rgba(0,0,0,.07)'); }
    rect(g, x, y, w, Math.max(1, h * 0.06), '#999f9d'); rect(g, x, y + h * 0.94, w, h * 0.06, '#999f9d'); drips(g, x, y, w, h, 6, '80,80,70', 0.1, R, 0.8); },
  (g, x, y, w, h, R) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#9fb3c1'); gr.addColorStop(0.6, '#4a5d6c'); gr.addColorStop(1, '#3d4d5a'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(x + w * 0.1, y); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.2, y + h); g.lineTo(x - w * 0.2, y + h); g.fill();
    if (R() < 0.5) rect(g, x + w * 0.55, y + h * 0.15, w * 0.4, h * 0.6, 'rgba(225,225,215,.55)');
    rect(g, x, y, w, h * 0.07, '#a7acaf'); rect(g, x, y + h * 0.93, w, h * 0.07, '#a7acaf'); rect(g, x, y + h * 0.3, w, Math.max(1, h * 0.03), '#a7acaf'); for (let i = 0; i < 2; i++) rect(g, x + i * w / 2, y, Math.max(1.5, w * 0.025), h, '#a7acaf'); },
  (g, x, y, w, h, R) => { for (const cx of [0.27, 0.73]) { const wx = x + w * (cx - 0.15), wy = y + h * 0.2, ww = w * 0.3, wh = h * 0.6; rect(g, wx - 1, wy - 1, ww + 2, wh + 3, 'rgba(0,0,0,.25)');
    PT.win(g, wx, wy, ww, wh, { f: '#c4c8ca', fw: Math.max(1, ww * 0.06), div: [1, 1], g0: '#d4dadc', g1: '#aeb7bb', refl: false }, R);
    for (let i = 1; i < 6; i++) rect(g, wx + ww * i / 6, wy, Math.max(1, ww * 0.03), wh, '#d8dadb'); rect(g, wx, wy + wh * 0.5, ww, Math.max(1, wh * 0.04), '#d8dadb'); } },
  (g, x, y, w, h, R) => { const wx = x + w * 0.3, wy = y + h * 0.15, ww = w * 0.4, wh = h * 0.7; rect(g, wx, wy, ww, wh, '#8e9393');
    for (let v = wy + 2; v < wy + wh - 2; v += Math.max(3, wh / 9)) { rect(g, wx + 1, v, ww - 2, Math.max(1.5, wh / 18), '#b5b9b8'); rect(g, wx + 1, v + Math.max(1.5, wh / 18), ww - 2, 1, 'rgba(0,0,0,.35)'); } grime(g, wx, wy, ww, wh, 0.25, 0.4); },
  (g, x, y, w, h, R) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#a6bccb'); gr.addColorStop(0.5, '#55707f'); gr.addColorStop(1, '#40525e'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    for (let i = 0; i < 3; i++) if (R() < 0.35) rect(g, x + w * (i / 3 + 0.03), y + h * 0.1, w / 3 * 0.9, h * 0.65, `rgba(${R() < 0.5 ? '230,228,220' : '60,70,78'},.35)`);
    g.fillStyle = 'rgba(255,255,255,.09)'; g.beginPath(); g.moveTo(x + w * 0.3, y); g.lineTo(x + w * 0.7, y); g.lineTo(x + w * 0.35, y + h); g.lineTo(x - w * 0.05, y + h); g.fill();
    rect(g, x, y + h * 0.82, w, h * 0.18, '#5e666c'); for (let i = 0; i <= 3; i++) rect(g, x + i * w / 3 - 1, y, 2.5, h, '#b6bcc0'); rect(g, x, y + h * 0.8, w, 2, '#b6bcc0'); rect(g, x, y, w, 2, '#b6bcc0'); },
  (g, x, y, w, h, R) => { for (const cx of [0.27, 0.73]) { const wx = x + w * (cx - 0.12), wy = y + h * 0.12, ww = w * 0.24, wh = h * 0.76; rect(g, wx - 2, wy - 2, ww + 4, wh + 4, '#d4d0c6');
    PT.win(g, wx, wy, ww, wh, { f: '#3e3f3c', fw: Math.max(1, ww * 0.08), div: [2, 3], g0: '#8d9ca4', g1: '#38444b', refl: false }, R); if (R() < 0.4) rect(g, wx, wy, ww, wh, '#2f3330'); } }
];
A.tex('i:win', 256, 512, (g, w, h, R) => { g.clearRect(0, 0, w, h); const sh = h / 8, bw = w / 2; WIN.forEach((f, k) => { for (let i = 0; i < 2; i++) clip(g, i * bw, k * sh, bw, sh, () => f(g, i * bw, k * sh, bw, sh, R)); }); }, { alpha: true });
// 戸：4×4 ます（0〜15）
const slats = (g, x, y, w, h, c, n = 22) => { rect(g, x, y, w, h, c); for (let v = y; v < y + h; v += Math.max(2, h / n)) { rect(g, x, v, w, 1, 'rgba(0,0,0,.16)'); rect(g, x, v + 1, w, 1, 'rgba(255,255,255,.22)'); } };
const DOOR = [
  // 0 シャッター（うすい色）
  (g, x, y, w, h, R) => { slats(g, x, y + h * 0.1, w, h * 0.9, '#d7d9d7'); rect(g, x, y, w, h * 0.1, '#a6a9a9'); rect(g, x, y + h * 0.95, w, h * 0.05, '#8b8e8e'); rect(g, x, y, w * 0.04, h, '#9da0a0'); rect(g, x + w * 0.96, y, w * 0.04, h, '#9da0a0'); grime(g, x, y, w, h, 0.28, 0.25); },
  // 1 鉄の引き戸（2枚・たての山）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#d2d3cf'); for (let i = 0; i < 2; i++) { const dx = x + i * w / 2; ribs(g, dx + w * 0.03, y + h * 0.06, w / 2 - w * 0.06, h * 0.9, 9, '#d2d3cf', 0.8, 1.05); rect(g, dx + w * 0.03, y + h * 0.5, w / 2 - w * 0.06, Math.max(1, h * 0.03), 'rgba(0,0,0,.2)'); }
    rect(g, x, y, w, h * 0.06, '#7d8180'); rect(g, x + w * 0.495, y, Math.max(1, w * 0.01), h, 'rgba(0,0,0,.4)'); grime(g, x, y, w, h, 0.3, 0.3); },
  // 2 コンテナの戸（うすい色）
  (g, x, y, w, h, R) => { ribs(g, x, y, w, h, 10, '#d9d9d5', 0.8, 1.04); rect(g, x + w * 0.495, y, Math.max(1, w * 0.012), h, 'rgba(0,0,0,.45)'); for (const t of [0.2, 0.38, 0.62, 0.8]) rect(g, x + w * t, y + h * 0.05, Math.max(1, w * 0.02), h * 0.9, 'rgba(60,60,60,.55)'); rect(g, x, y, w, h * 0.05, '#9b9b98'); rect(g, x, y + h * 0.95, w, h * 0.05, '#9b9b98'); },
  // 3 ドックシェルター（黒いわく）とシャッター
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#2b2c2d'); slats(g, x + w * 0.14, y + h * 0.16, w * 0.72, h * 0.84, '#d4d6d4'); rect(g, x + w * 0.14, y + h * 0.16, w * 0.72, h * 0.05, '#999c9c'); for (let i = 0; i < 6; i++) rect(g, x + w * 0.02 + i * w * 0.16, y + h * 0.93, w * 0.08, h * 0.07, i % 2 ? '#d8b43a' : '#2b2c2d'); },
  // 4 開いた入口（中は暗い・機械）
  (g, x, y, w, h, R) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#1d1f20'); gr.addColorStop(1, '#3b3c3b'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    for (let i = 0; i < 4; i++) rect(g, x + w * (0.08 + i * 0.23), y + h * (0.45 + R() * 0.2), w * 0.15, h * 0.4, css(A.pick(R, ['#4a5a58', '#5a5a52', '#3f4d5c', '#6a5a3a']), 0.8)); rect(g, x, y + h * 0.9, w, h * 0.1, '#55554f'); rect(g, x, y, w, h * 0.07, '#8f9292'); },
  // 5 開いた入口（あかり・棚）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#4b4a45'); for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) rect(g, x + w * (0.06 + i * 0.235), y + h * (0.18 + j * 0.24), w * 0.2, h * 0.17, css(A.pick(R, ['#a88a5c', '#b9a47a', '#8a8f94', '#c9c2b0']), 0.85)); const gr = g.createLinearGradient(0, y, 0, y + h * 0.3); gr.addColorStop(0, 'rgba(255,240,200,.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(x, y, w, h * 0.3); rect(g, x, y, w, h * 0.06, '#8f9292'); },
  // 6 ガラスの戸（アルミ・2枚）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#a9aeb1'); PT.win(g, x + w * 0.06, y + h * 0.05, w * 0.88, h * 0.22, { f: '#a9aeb1', div: [2, 1], g0: '#98aab6', g1: '#45545f' }, R); for (let i = 0; i < 2; i++) PT.win(g, x + w * (0.06 + i * 0.45), y + h * 0.3, w * 0.43, h * 0.7, { f: '#a9aeb1', div: [1, 1], g0: '#8fa2ae', g1: '#36434d', fw: Math.max(1, w * 0.03) }, R); rect(g, x + w * 0.46, y + h * 0.6, w * 0.08, h * 0.02, '#d9dcdc'); },
  // 7 鉄の戸（片びらき・小窓）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#bfc2c0'); rect(g, x + w * 0.2, y + h * 0.08, w * 0.6, h * 0.92, '#a3a8a7'); PT.win(g, x + w * 0.38, y + h * 0.18, w * 0.24, h * 0.22, { f: '#a3a8a7', div: [1, 1] }, R); rect(g, x + w * 0.7, y + h * 0.55, w * 0.06, h * 0.03, '#e4e4e0'); grime(g, x, y, w, h, 0.25, 0.3); },
  // 8 木の引き戸（蔵）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#3a3029'); for (let i = 0; i < 8; i++) rect(g, x + i * w / 8, y, 1, h, 'rgba(0,0,0,.4)'); for (const t of [0.25, 0.75]) rect(g, x, y + h * t, w, h * 0.04, '#24201c'); rect(g, x + w * 0.49, y, w * 0.02, h, '#1b1815'); rect(g, x + w * 0.42, y + h * 0.5, w * 0.05, h * 0.05, '#8c8070'); PT.noise(g, x, y, w, h, 0.05, R); },
  // 9 鉄の扉（黒・びょう）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#2e3030'); for (let i = 0; i < 2; i++) { rect(g, x + w * (0.05 + i * 0.47), y + h * 0.05, w * 0.43, h * 0.95, '#3a3c3b'); for (let j = 0; j < 6; j++) for (let k = 0; k < 3; k++) rect(g, x + w * (0.1 + i * 0.47 + k * 0.15), y + h * (0.1 + j * 0.15), 1.5, 1.5, '#6a6c6a'); } },
  // 10 格納庫の扉（たて長の板・上に窓）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#d4d6d5'); for (let i = 0; i < 6; i++) { const dx = x + i * w / 6; rect(g, dx, y, 1.5, h, 'rgba(0,0,0,.3)'); PT.win(g, dx + w * 0.02, y + h * 0.05, w / 6 - w * 0.04, h * 0.12, { f: '#c3c6c6', div: [1, 1], g0: '#9fb0bb', g1: '#4f606b', refl: false }, R); for (let v = 0.3; v < 1; v += 0.12) rect(g, dx, y + h * v, w / 6, 1, 'rgba(0,0,0,.12)'); } rect(g, x, y + h * 0.95, w, h * 0.05, '#8d9090'); },
  // 11 自動販売機の前（うすい色：頂点の色で）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#e9eaea'); rect(g, x + w * 0.08, y + h * 0.07, w * 0.84, h * 0.5, '#2f3a44'); for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) rect(g, x + w * (0.12 + i * 0.13), y + h * (0.1 + j * 0.15), w * 0.09, h * 0.1, css(A.pick(R, ['#c84a3a', '#3a78c8', '#e8c040', '#5aa050', '#e8e8e8', '#7a4a30']), 1)); rect(g, x + w * 0.08, y + h * 0.62, w * 0.6, h * 0.08, '#cfd2d4'); rect(g, x + w * 0.15, y + h * 0.8, w * 0.7, h * 0.12, '#3d4144'); },
  // 12 キュービクル（ガラリと扉）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#cdd0c8'); for (let i = 0; i < 3; i++) { const dx = x + w * (0.04 + i * 0.32); rect(g, dx, y + h * 0.04, w * 0.29, h * 0.92, '#c2c5bd'); rect(g, dx, y + h * 0.04, 1, h * 0.92, 'rgba(0,0,0,.3)'); for (let v = 0.12; v < 0.4; v += 0.06) rect(g, dx + w * 0.04, y + h * v, w * 0.2, 1.2, 'rgba(0,0,0,.35)'); for (let v = 0.65; v < 0.9; v += 0.06) rect(g, dx + w * 0.04, y + h * v, w * 0.2, 1.2, 'rgba(0,0,0,.35)'); } },
  // 13 ドアと窓（小さな事務所の入口）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#b4b8b9'); PT.win(g, x + w * 0.05, y + h * 0.05, w * 0.9, h * 0.92, { f: '#b4b8b9', div: [3, 2], g0: '#9db0bc', g1: '#40505c', bl: 0.5 }, R); },
  // 14 鉄の網戸（金網の シャッター：駐車場など）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#2a2c2c'); for (let u = x; u < x + w; u += 3) rect(g, u, y, 1, h, '#9a9e9e'); for (let v = y; v < y + h; v += 3) rect(g, x, v, w, 1, '#8a8e8e'); rect(g, x, y, w, h * 0.06, '#8a8e8e'); },
  // 15 搬入口（トラックの荷台が見える）
  (g, x, y, w, h, R) => { rect(g, x, y, w, h, '#3a3b3b'); rect(g, x + w * 0.1, y + h * 0.15, w * 0.8, h * 0.7, '#dcdcd8'); for (let i = 1; i < 4; i++) rect(g, x + w * (0.1 + i * 0.2), y + h * 0.15, 1, h * 0.7, 'rgba(0,0,0,.25)'); rect(g, x + w * 0.1, y + h * 0.85, w * 0.8, h * 0.06, '#555'); }
];
A.tex('i:door', 256, 256, (g, w, h, R) => { const cw = w / 4, ch = h / 4; DOOR.forEach((f, k) => { const i = k % 4, j = (k / 4) | 0; clip(g, i * cw, j * ch, cw, ch, () => f(g, i * cw, j * ch, cw, ch, R)); }); });
// サンドイッチパネル（横張り。8m 四方）
A.tex('i:panel', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#edece8');
  for (let j = 0; j < 8; j++) { const y = j * h / 8, ph = h / 8; const gr = g.createLinearGradient(0, y, 0, y + ph); gr.addColorStop(0, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(0,0,0,.04)'); g.fillStyle = gr; g.fillRect(0, y, w, ph);
    for (let t = 1; t < 4; t++) rect(g, 0, y + t * ph / 4, w, 0.7, 'rgba(0,0,0,.045)'); rect(g, 0, y + ph - 1.4, w, 1.4, 'rgba(0,0,0,.24)'); rect(g, (j % 2) * w / 2 + w * 0.2, y, 1, ph, 'rgba(0,0,0,.12)'); }
  drips(g, 0, 0, w, h, 14, '90,90,85', 0.05, R, 0.4); PT.noise(g, 0, 0, w, h, 0.015, R);
});
// ALC（たて張り 0.6m・3m ごとの よこ目地。6m 四方）
A.tex('i:alc', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#ebe9e3');
  for (let i = 0; i < 10; i++) { rect(g, i * w / 10, 0, 1, h, 'rgba(0,0,0,.13)'); rect(g, i * w / 10 + 1, 0, 1, h, 'rgba(255,255,255,.3)'); rect(g, i * w / 10 + w * 0.02, 0, w / 10 * 0.9, h, css('#ebe9e3', 0.97 + R() * 0.05)); }
  for (const t of [0, 0.5]) { rect(g, 0, t * h, w, 1.5, 'rgba(0,0,0,.18)'); drips(g, 0, t * h, w, h * 0.3, 10, '80,78,70', 0.06, R, 0.9); }
  PT.noise(g, 0, 0, w, h, 0.018, R);
});
// コンクリート（型わくの目地・セパの穴・雨すじ。8m 四方）
A.tex('i:conc', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#c9c7c1'); blots(g, 0, 0, w, h, 30, '90,88,80', 0.06, R, 0.12); blots(g, 0, 0, w, h, 20, '255,255,250', 0.06, R, 0.1);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const x = i * w / 4, y = j * h / 4; rect(g, x, y, w / 4, 1, 'rgba(0,0,0,.12)'); rect(g, x, y, 1, h / 4, 'rgba(0,0,0,.1)'); for (const a of [0.25, 0.75]) for (const b of [0.25, 0.75]) rect(g, x + a * w / 4, y + b * h / 4, 1.5, 1.5, 'rgba(60,60,55,.4)'); }
  drips(g, 0, 0, w, h, 26, '60,58,52', 0.1, R, 0.5); PT.noise(g, 0, 0, w, h, 0.03, R);
});
// レンガ（4m 四方）
A.tex('i:brick', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#b3a99c'); const rows = 46, bh = h / rows, bw = w / 18;
  for (let j = 0; j < rows; j++) for (let i = -1; i < 19; i++) { const x = i * bw + (j % 2) * bw / 2; rect(g, x + 0.6, j * bh + 0.6, bw - 1.2, bh - 1.2, css(A.mix('#9b4c36', '#7b3a2a', R()), 0.86 + R() * 0.24)); }
  drips(g, 0, 0, w, h, 16, '40,30,25', 0.12, R, 0.6); PT.noise(g, 0, 0, w, h, 0.03, R);
});
// 平らな屋根（防水シート。16m 四方。うすい色）
A.tex('i:flat', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#c4c6c6'); for (let j = 0; j < 8; j++) { rect(g, 0, j * h / 8, w, 1, 'rgba(0,0,0,.1)'); rect(g, 0, j * h / 8 + 1, w, 1, 'rgba(255,255,255,.18)'); }
  blots(g, 0, 0, w, h, 16, '70,72,70', 0.1, R, 0.12); blots(g, 0, 0, w, h, 10, '255,255,255', 0.08, R, 0.1); rect(g, w * 0.48, h * 0.48, w * 0.04, h * 0.04, '#5a5c5c'); PT.noise(g, 0, 0, w, h, 0.025, R);
});
// アスファルト（16m 四方）
A.tex('i:asph', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#8a8b8a'); PT.noise(g, 0, 0, w, h, 0.06, R, 1); blots(g, 0, 0, w, h, 12, '40,40,40', 0.12, R, 0.1); blots(g, 0, 0, w, h, 8, '200,200,195', 0.06, R, 0.12);
  g.strokeStyle = 'rgba(30,30,30,.3)'; g.lineWidth = 1; for (let i = 0; i < 5; i++) { g.beginPath(); let x = R() * w, y = R() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.5) * w * 0.1; y += (R() - 0.3) * h * 0.08; g.lineTo(x, y); } g.stroke(); }
});
// コンクリートの床（4m ごとの目地。16m 四方）
A.tex('i:cpad', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#c6c4be'); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) rect(g, i * w / 4 + 1, j * h / 4 + 1, w / 4 - 2, h / 4 - 2, css('#c6c4be', 0.95 + R() * 0.08));
  blots(g, 0, 0, w, h, 14, '80,78,72', 0.12, R, 0.08); PT.noise(g, 0, 0, w, h, 0.03, R);
});
/* far（lod -1）と lod 0 の外壁：u は 柱間・v は 1階分（または 壁の高さ）でくり返す。うすい色で 頂点の色で 染める */
A.tex('i:fw:koba', 128, 128, (g, w, h, R) => { ribs(g, 0, 0, w, h, 16, '#e6e6e2', 0.82, 1.04); rect(g, 0, h * 0.18, w, h * 0.16, '#cfd6d6'); rect(g, w * 0.1, h * 0.2, w * 0.8, h * 0.12, '#7d8b92'); grime(g, 0, 0, w, h, 0.25, 0.25); });
A.tex('i:fw:soko', 128, 128, (g, w, h, R) => { rect(g, 0, 0, w, h, '#e8e7e3'); for (let j = 0; j < 8; j++) rect(g, 0, j * h / 8, w, 1, 'rgba(0,0,0,.12)'); rect(g, 0, h * 0.1, w, h * 0.08, '#d9e0e0'); grime(g, 0, 0, w, h, 0.2, 0.2); });
A.tex('i:fw:ofc', 128, 128, (g, w, h, R) => { rect(g, 0, 0, w, h, '#e6e4de'); for (let i = 0; i < 2; i++) rect(g, w * (0.08 + i * 0.5), h * 0.25, w * 0.34, h * 0.42, '#5d6e7a'); rect(g, 0, h * 0.9, w, h * 0.1, 'rgba(0,0,0,.08)'); });

/* ---------- 形の道具 ---------- */
// 長方形 r の 形（A.foot と同じ形）。辺は 北→東→南→西（外向きの法線）
function RF(r) {
  const [x0, z0, x1, z1] = r, l = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], edges = []; let s = 0;
  for (let i = 0; i < 4; i++) { const a = l[i], b = l[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-6; edges.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / L, nz: -dx / L, L, u0: s, li: 0, out: true }); s += L; }
  return { loops: [l], edges, rects: [r], maxr: [r], bb: r.slice(), w: x1 - x0, d: z1 - z0, area: (x1 - x0) * (z1 - z0), n: 1 };
}
const inR = (r, d) => [r[0] + d, r[1] + d, r[2] - d, r[3] - d];
const sideOf = fr => { fr = fr || [0, 1]; return Math.abs(fr[1]) >= Math.abs(fr[0]) ? (fr[1] >= 0 ? 'S' : 'N') : (fr[0] >= 0 ? 'E' : 'W'); };
const FI = { N: 0, E: 1, S: 2, W: 3 };
// 長方形 R を「道がわが v=0」の座標に：u（道にそって 0〜W）・v（奥へ 0〜D）。fa：道を向く角度・ua：u の向きの角度
function frame(R, fr) {
  const [x0, z0, x1, z1] = R, s = sideOf(fr); let W, D, p;
  if (s === 'S') { W = x1 - x0; D = z1 - z0; p = (u, v) => [x0 + u, z1 - v]; }
  else if (s === 'N') { W = x1 - x0; D = z1 - z0; p = (u, v) => [x1 - u, z0 + v]; }
  else if (s === 'E') { W = z1 - z0; D = x1 - x0; p = (u, v) => [x1 - v, z1 - u]; }
  else { W = z1 - z0; D = x1 - x0; p = (u, v) => [x0 + v, z0 + u]; }
  const r = (u0, v0, u1, v1) => { const a = p(u0, v0), b = p(u1, v1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
  return { W, D, p, r, s, fa: { S: PI / 2, N: -PI / 2, E: 0, W: PI }[s], ua: { S: 0, N: PI, E: -PI / 2, W: PI / 2 }[s], fi: FI[s] };
}
// 帯の v（n 本の帯の 上から k 本目。e：はしの にじみよけ）
const SV = (k, n, e = 0.03) => [1 - (k + 1 - e) / n, 1 - (k + e) / n];
// 辺 e の a〜b m・y0〜y1 の壁。U：[u0, u1]
function seg(B, m, e, a, b, y0, y1, c, U, v0, v1, ao, off) {
  const tx = (e.bx - e.ax) / e.L, tz = (e.bz - e.az) / e.L, f = off || 0;
  B.wall(m, e.ax + tx * a + e.nx * f, e.az + tz * a + e.nz * f, e.ax + tx * b + e.nx * f, e.az + tz * b + e.nz * f, y0, y1, c, U ? [U[0], U[1], v0, v1] : null, ao);
}
const ePt = (e, t, o = 0) => [e.ax + (e.bx - e.ax) * t / e.L + e.nx * o, e.az + (e.bz - e.az) * t / e.L + e.nz * o];
const eAng = e => Math.atan2(e.bz - e.az, e.bx - e.ax);
// 外壁の材料：{ m, k（帯。なければ m でくり返す）, n（帯の数）, su, sv, c }
function clad(B, e, a, b, y0, y1, Wm, ao, off) {
  if (Wm.k != null) { const [v0, v1] = SV(Wm.k, Wm.n || 8); seg(B, Wm.m, e, a, b, y0, y1, Wm.c || W1, [(e.u0 + a) / Wm.su, (e.u0 + b) / Wm.su], v0, v1, ao, off); }
  else seg(B, Wm.m, e, a, b, y0, y1, Wm.c || W1, [(e.u0 + a) / Wm.su, (e.u0 + b) / Wm.su], y0 / (Wm.sv || Wm.su), y1 / (Wm.sv || Wm.su), ao, off);
}
// 窓の帯（i:win の帯 k）：辺 e の a〜b・y0〜y1。bw：窓 1つの はば m
function band(B, e, a, b, y0, y1, k, bw, off) {
  const L = b - a; if (L < 1.2) return; const nb = Math.max(1, Math.round(L / bw)), [v0, v1] = SV(k, 8, 0.02);
  seg(B, 'i:win', e, a, b, y0, y1, W1, [0, nb / 2], v0, v1, 1, off == null ? 0.08 : off);
}
// 戸（i:door のます k）：辺 e の t（まん中 m）・はば w・高さ h
function door(B, e, t, w, y0, h, k, c, off) {
  const i = k % 4, j = (k / 4) | 0, u0 = i / 4 + 0.006, u1 = (i + 1) / 4 - 0.006, v1 = 1 - j / 4 - 0.006, v0 = 1 - (j + 1) / 4 + 0.006;
  seg(B, 'i:door', e, t - w / 2, t + w / 2, y0, y0 + h, c || W1, [u0, u1], v0, v1, 1, off == null ? 0.08 : off);
}
// 質感の帯つきの箱（壁：Wm。上：mt/ct か 'c'）
function boxW(B, r, y0, y1, Wm, o = {}) {
  const G = RF(r); for (const e of G.edges) clad(B, e, 0, e.L, y0, y1, Wm, o.ao || 1);
  if (!o.notop) B.flat(o.mt || 'c', r, y1, o.ct || [0.6, 0.6, 0.6], { su: o.tsu });
}
// 3D の角材（p0 → p1・はば w・あつさ h）
function beam(B, m, p0, p1, w, h, c, o = {}) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz) || 1e-6, t = [dx / L, dy / L, dz / L];
  let sx = -t[2], sz = t[0], sl = Math.hypot(sx, sz); if (sl < 1e-6) { sx = 1; sz = 0; sl = 1; } sx /= sl; sz /= sl;
  const u = [-sz * t[1], sz * t[0] - sx * t[2], sx * t[1]];   // s × t
  const P = (p, a, b) => [p[0] + sx * a * w / 2 + u[0] * b * h / 2, p[1] + u[1] * b * h / 2, p[2] + sz * a * w / 2 + u[2] * b * h / 2];
  const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]], uv = o.uv;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; if (o.sides && !o.sides[i]) continue; B.quad(m, P(p0, a[0], a[1]), P(p1, a[0], a[1]), P(p1, b[0], b[1]), P(p0, b[0], b[1]), null, c, uv); }
  if (o.caps) { B.quad(m, P(p0, -1, -1), P(p0, 1, -1), P(p0, 1, 1), P(p0, -1, 1), null, c); B.quad(m, P(p1, -1, -1), P(p1, -1, 1), P(p1, 1, 1), P(p1, 1, -1), null, c); }
}
// 円柱（よこ向き：軸 ax 'x' | 'z'、中心 (cx, cy, cz)・半径 r・長さ L）
function hcyl(B, m, ax, cx, cy, cz, r, L, n, c, caps) {
  for (let i = 0; i < n; i++) {
    const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2, a0 = [Math.cos(t0) * r, Math.sin(t0) * r], a1 = [Math.cos(t1) * r, Math.sin(t1) * r];
    const P = (s, a) => ax === 'x' ? [cx + s, cy + a[1], cz + a[0]] : [cx + a[0], cy + a[1], cz + s];
    B.quad(m, P(-L / 2, a0), P(L / 2, a0), P(L / 2, a1), P(-L / 2, a1), null, c);
    if (caps) { B.tri(m, P(-L / 2, [0, 0]), P(-L / 2, a0), P(-L / 2, a1), null, c); B.tri(m, P(L / 2, [0, 0]), P(L / 2, a1), P(L / 2, a0), null, c); }
  }
}

/* ---------- 屋根（棟・のこぎり・かまぼこ・片流れ・平ら）----------
   RS：屋根の材料 { m, k（帯）, n, su, sv, c }。GW：妻壁の材料（clad と同じ）。o：{ p, oh, ax, ms（1スパンの最大 m）, hmax, tw, lod, cr（棟の色）, tr（軒先の色）} */
const rV = (RS, s, len) => { if (RS.k != null) { const [v0, v1] = SV(RS.k, RS.n || 4); return v0 + (v1 - v0) * s; } return s * len / (RS.sv || RS.su); };
const gV = (GW, y, yb, yt) => { if (GW.k != null) { const [v0, v1] = SV(GW.k, GW.n || 8); return v0 + (v1 - v0) * (0.55 + 0.45 * (y - yb) / Math.max(0.01, yt - yb)); } return y / (GW.sv || GW.su); };
function gableRoof(B, r, y, RS, GW, o) {
  const X = (o.ax || (rw(r) >= rd(r) ? 'x' : 'z')) === 'x', S = X ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];
  const x0 = X ? r[0] : r[1], x1 = X ? r[2] : r[3], z0 = X ? r[1] : r[0], z1 = X ? r[3] : r[2];
  const span = z1 - z0, ns = Math.max(1, Math.round(span / (o.ms || 32))), sw = span / ns, p = o.p == null ? 0.2 : o.p;
  const rise = Math.min(o.hmax || 99, sw / 2 * p), pp = rise / (sw / 2), oh = o.oh == null ? 0.4 : o.oh, X0 = x0 - oh, X1 = x1 + oh, yr = y + rise;
  const m = RS.m, c = RS.c || W1, su = RS.su;
  for (let i = 0; i < ns; i++) {
    const za = z0 + i * sw, zb = za + sw, zm = (za + zb) / 2, ea = i === 0 ? oh : 0, eb = i === ns - 1 ? oh : 0, ya = y - ea * pp, yb = y - eb * pp;
    const la = Math.hypot(sw / 2 + ea, rise + ea * pp), lb = Math.hypot(sw / 2 + eb, rise + eb * pp);
    B.quad(m, S(X0, ya, za - ea), S(X0, yr, zm), S(X1, yr, zm), S(X1, ya, za - ea), null, c, [X0 / su, rV(RS, 0, la), X0 / su, rV(RS, 1, la), X1 / su, rV(RS, 1, la), X1 / su, rV(RS, 0, la)]);
    B.quad(m, S(X1, yb, zb + eb), S(X1, yr, zm), S(X0, yr, zm), S(X0, yb, zb + eb), null, c, [X1 / su, rV(RS, 0, lb), X1 / su, rV(RS, 1, lb), X0 / su, rV(RS, 1, lb), X0 / su, rV(RS, 0, lb)]);
    if (GW) for (const xg of [x0, x1]) B.tri(GW.m, S(xg, y, za), S(xg, y, zb), S(xg, yr, zm), null, GW.c || W1, [za / GW.su, gV(GW, y, y, yr), zb / GW.su, gV(GW, y, y, yr), zm / GW.su, gV(GW, yr, y, yr)]);
    if (o.lod >= 2) { const q = 0.2; B.quad('c', S(X0, yr + 0.05, zm - q), S(X0, yr + 0.05, zm + q), S(X1, yr + 0.05, zm + q), S(X1, yr + 0.05, zm - q), null, o.cr || mul(c, 0.8)); }
    if (o.lod >= 2 && o.mon && sw > 10) {   // 越屋根（棟の上の換気の屋根）
      const mw = Math.min(4, sw * 0.18), mh = 1.3, xa = x0 + (x1 - x0) * 0.08, xb = x1 - (x1 - x0) * 0.08, yy = yr - mw / 2 * pp;
      for (const sg of [-1, 1]) B.quad('i:win', S(xa, yy, zm + sg * mw / 2), S(xa, yy + mh, zm + sg * mw / 2), S(xb, yy + mh, zm + sg * mw / 2), S(xb, yy, zm + sg * mw / 2), null, W1, [0, SV(5, 8)[0], (xb - xa) / 3, SV(5, 8)[0], (xb - xa) / 3, SV(5, 8)[1], 0, SV(5, 8)[1]]);
      for (const xg of [xa, xb]) B.quad('c', S(xg, yy, zm - mw / 2), S(xg, yy + mh, zm - mw / 2), S(xg, yy + mh, zm + mw / 2), S(xg, yy, zm + mw / 2), null, mul(c, 0.85));
      const yt = yy + mh, rr = mw / 2 + 0.4;
      B.quad(m, S(xa - 0.4, yt, zm - rr), S(xa - 0.4, yt + rr * pp, zm), S(xb + 0.4, yt + rr * pp, zm), S(xb + 0.4, yt, zm - rr), null, c, [xa / su, rV(RS, 0, 2), xa / su, rV(RS, 1, 2), xb / su, rV(RS, 1, 2), xb / su, rV(RS, 0, 2)]);
      B.quad(m, S(xb + 0.4, yt, zm + rr), S(xb + 0.4, yt + rr * pp, zm), S(xa - 0.4, yt + rr * pp, zm), S(xa - 0.4, yt, zm + rr), null, c, [xb / su, rV(RS, 0, 2), xb / su, rV(RS, 1, 2), xa / su, rV(RS, 1, 2), xa / su, rV(RS, 0, 2)]);
    }
  }
  if (o.lod >= 2 && o.tr) {   // 軒先・けらばの板
    const t = 0.22;
    B.quad('c', S(X0, y - oh * pp - t, z0 - oh), S(X1, y - oh * pp - t, z0 - oh), S(X1, y - oh * pp, z0 - oh), S(X0, y - oh * pp, z0 - oh), null, o.tr);
    B.quad('c', S(X1, y - oh * pp - t, z1 + oh), S(X0, y - oh * pp - t, z1 + oh), S(X0, y - oh * pp, z1 + oh), S(X1, y - oh * pp, z1 + oh), null, o.tr);
  }
  return yr;
}
// のこぎり屋根：歯は z 向き（明かりとりは北向き）
function sawRoof(B, r, y, RS, GW, o) {
  const X = rd(r) >= rw(r), S = X ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];   // 歯は 長いほうに ならべる（明かりとりは 北か西）
  const x0 = X ? r[0] : r[1], x1 = X ? r[2] : r[3], z0 = X ? r[1] : r[0], z1 = X ? r[3] : r[2];
  const n = Math.max(1, Math.round((z1 - z0) / (o.tw || 9))), st = (z1 - z0) / n, hh = Math.min(o.hmax || 3.2, st * 0.3), m = RS.m, c = RS.c || W1, su = RS.su;
  const [g0, g1] = SV(o.gk == null ? 1 : o.gk, 8, 0.02), nb = Math.max(1, Math.round((x1 - x0) / 3));
  for (let i = 0; i < n; i++) {
    const za = z0 + i * st, zb = za + st, sl = Math.hypot(st, hh);
    B.quad(m, S(x0, y + hh, za), S(x1, y + hh, za), S(x1, y, zb), S(x0, y, zb), null, c, [x0 / su, rV(RS, 1, sl), x1 / su, rV(RS, 1, sl), x1 / su, rV(RS, 0, sl), x0 / su, rV(RS, 0, sl)]);
    B.quad('i:win', S(x0, y, za), S(x0, y + hh, za), S(x1, y + hh, za), S(x1, y, za), null, W1, [0, g0, 0, g1, nb / 2, g1, nb / 2, g0]);
    if (GW) for (const xg of [x0, x1]) B.tri(GW.m, S(xg, y, za), S(xg, y + hh, za), S(xg, y, zb), null, GW.c || W1, [za / GW.su, gV(GW, y, y, y + hh), za / GW.su, gV(GW, y + hh, y, y + hh), zb / GW.su, gV(GW, y, y, y + hh)]);
    if (o.lod >= 2) B.quad('c', S(x0 - 0.1, y + hh + 0.04, za - 0.15), S(x1 + 0.1, y + hh + 0.04, za - 0.15), S(x1 + 0.1, y + hh + 0.04, za + 0.25), S(x0 - 0.1, y + hh + 0.04, za + 0.25), null, o.cr || mul(c, 0.8));
  }
  return y + hh;
}
// かまぼこ屋根（スパンを わける）
function barrelRoof(B, r, y, RS, GW, o) {
  const X = (o.ax || (rw(r) >= rd(r) ? 'x' : 'z')) === 'x', S = X ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];
  const x0 = X ? r[0] : r[1], x1 = X ? r[2] : r[3], z0 = X ? r[1] : r[0], z1 = X ? r[3] : r[2];
  const span = z1 - z0, ns = Math.max(1, Math.round(span / (o.ms || 50))), sw = span / ns, n = o.lod >= 2 ? 7 : o.lod >= 1 ? 3 : 4, m = RS.m, c = RS.c || W1, su = RS.su, oh = o.oh == null ? 0.3 : o.oh;
  const rise = Math.min(o.hmax || 99, sw * (o.p || 0.2)), hw = sw / 2, Rr = (hw * hw + rise * rise) / (2 * rise), a0 = Math.asin(Math.min(1, hw / Rr));
  for (let s = 0; s < ns; s++) {
    const zc = z0 + (s + 0.5) * sw, yc = y + rise - Rr, Pq = q => { const ang = -a0 + 2 * a0 * q / n; return [zc + Math.sin(ang) * Rr, yc + Math.cos(ang) * Rr]; };
    for (let i = 0; i < n; i++) {
      const [za, ya] = Pq(i), [zb, yb] = Pq(i + 1), len = 2 * a0 * Rr;
      B.quad(m, S(x0 - oh, ya, za), S(x0 - oh, yb, zb), S(x1 + oh, yb, zb), S(x1 + oh, ya, za), null, c, [(x0 - oh) / su, rV(RS, i / n, len), (x0 - oh) / su, rV(RS, (i + 1) / n, len), (x1 + oh) / su, rV(RS, (i + 1) / n, len), (x1 + oh) / su, rV(RS, i / n, len)]);
      if (GW) for (const xg of [x0, x1]) B.tri(GW.m, S(xg, y, zc), S(xg, ya, za), S(xg, yb, zb), null, GW.c || W1, [zc / GW.su, gV(GW, y, y, y + rise), za / GW.su, gV(GW, ya, y, y + rise), zb / GW.su, gV(GW, yb, y, y + rise)]);
    }
  }
  return y + rise;
}
// 片流れ（高いがわ：o.hi = 'n' 北/西 か 's'）
function shedRoof(B, r, y, RS, GW, o) {
  const X = (o.ax || (rw(r) >= rd(r) ? 'x' : 'z')) === 'x', S = X ? (u, h, v) => [u, h, v] : (u, h, v) => [v, h, u];
  const x0 = X ? r[0] : r[1], x1 = X ? r[2] : r[3], z0 = X ? r[1] : r[0], z1 = X ? r[3] : r[2];
  const span = z1 - z0, p = o.p == null ? 0.12 : o.p, rise = Math.min(o.hmax || 6, span * p), oh = o.oh == null ? 0.5 : o.oh, m = RS.m, c = RS.c || W1, su = RS.su, hiN = (o.hi || 'n') === 'n';
  const zh = hiN ? z0 : z1, zl = hiN ? z1 : z0, sg = hiN ? -1 : 1, sl = Math.hypot(span + oh * 2, rise);
  B.quad(m, S(x0 - oh, y + rise + oh * p, zh + sg * oh), S(x1 + oh, y + rise + oh * p, zh + sg * oh), S(x1 + oh, y - oh * p, zl - sg * oh), S(x0 - oh, y - oh * p, zl - sg * oh), null, c, [(x0 - oh) / su, rV(RS, 1, sl), (x1 + oh) / su, rV(RS, 1, sl), (x1 + oh) / su, rV(RS, 0, sl), (x0 - oh) / su, rV(RS, 0, sl)]);
  if (GW) {
    for (const xg of [x0, x1]) B.tri(GW.m, S(xg, y, zh), S(xg, y + rise, zh), S(xg, y, zl), null, GW.c || W1, [zh / GW.su, gV(GW, y, y, y + rise), zh / GW.su, gV(GW, y + rise, y, y + rise), zl / GW.su, gV(GW, y, y, y + rise)]);
    B.quad(GW.m, S(x0, y, zh), S(x0, y + rise, zh), S(x1, y + rise, zh), S(x1, y, zh), null, GW.c || W1, [x0 / GW.su, gV(GW, y, y, y + rise), x0 / GW.su, gV(GW, y + rise, y, y + rise), x1 / GW.su, gV(GW, y + rise, y, y + rise), x1 / GW.su, gV(GW, y, y, y + rise)]);
  }
  return y + rise + oh * p;
}
// 形 G の上に屋根（o.t：'gable' | 'saw' | 'barrel' | 'shed' | 'flat'）。返り値：いちばん上
function roofs(B, G, y, RS, GW, o) {
  const t = o.t || 'gable';
  if (t === 'flat') {
    B.cap(RS.m, G, y, RS.c || W1, { su: RS.su });
    if (o.lod >= 1 && o.par !== false) B.parapet(G, y, o.ph || 0.5, 0.22, o.pc || [0.7, 0.7, 0.68]);
    else if (o.par !== false && o.pc) for (const e of G.edges) B.wallE('c', e, y, y + (o.ph || 0.5), o.pc);
    return y + (o.ph || 0.5);
  }
  const rs = t === 'saw' ? G.rects : (G.maxr.length <= 6 ? G.maxr : G.rects), fn = t === 'saw' ? sawRoof : t === 'barrel' ? barrelRoof : t === 'shed' ? shedRoof : gableRoof;
  let top = y;
  for (const r of rs) top = Math.max(top, fn(B, r, y, RS, GW, o));
  return top;
}

/* ---------- 小物（近くだけ） ---------- */
const CARS = ['#f2f2ef', '#f0f0ee', '#e9e9e6', '#c9ccd0', '#b6babe', '#2b2d31', '#3c4048', '#6f7479', '#8b2a2a', '#2c4a6e', '#a9b4bd', '#d9d2c0', '#4f5a3f', '#7b8a96'];
// 車：帯 0 車の列（上から）・1 車の列（前から）・2 列のはしの車（横）・3 車1台（上・うすい色）・4 車1台（横）・5 車1台（前）・6 バスの横（うすい色）・7 電車の横
A.tex('i:veh', 256, 256, (g, w, h, R) => {
  g.clearRect(0, 0, w, h); const sh = h / 8, sw = w / 8, dk = '#262b30';
  for (let i = 0; i < 8; i++) {
    if (R() < 0.14) continue;
    const c0 = A.pick(R, CARS), x = i * sw, cw = sw * 0.68, cx = x + (sw - cw) / 2;
    // 上から（帯 0）：前が下
    rect(g, cx, sh * 0.04, cw, sh * 0.92, css(c0)); rect(g, cx, sh * 0.04, cw * 0.08, sh * 0.92, css(c0, 0.8)); rect(g, cx + cw * 0.92, sh * 0.04, cw * 0.08, sh * 0.92, css(c0, 0.8));
    rect(g, cx + cw * 0.1, sh * 0.2, cw * 0.8, sh * 0.1, dk); rect(g, cx + cw * 0.08, sh * 0.3, cw * 0.84, sh * 0.32, css(c0, 1.06)); rect(g, cx + cw * 0.1, sh * 0.62, cw * 0.8, sh * 0.13, dk);
    // 前から（帯 1）
    const y1 = sh;
    g.fillStyle = css(c0); g.beginPath(); g.moveTo(cx + cw * 0.12, y1 + sh * 0.46); g.lineTo(cx + cw * 0.2, y1 + sh * 0.06); g.lineTo(cx + cw * 0.8, y1 + sh * 0.06); g.lineTo(cx + cw * 0.88, y1 + sh * 0.46); g.fill();
    rect(g, cx + cw * 0.24, y1 + sh * 0.12, cw * 0.52, sh * 0.3, dk); rect(g, cx, y1 + sh * 0.46, cw, sh * 0.4, css(c0)); rect(g, cx + cw * 0.04, y1 + sh * 0.52, cw * 0.16, sh * 0.1, '#e8e8e0'); rect(g, cx + cw * 0.8, y1 + sh * 0.52, cw * 0.16, sh * 0.1, '#e8e8e0');
    rect(g, cx + cw * 0.3, y1 + sh * 0.58, cw * 0.4, sh * 0.12, '#2e3134'); rect(g, cx, y1 + sh * 0.8, cw, sh * 0.1, '#2a2b2c'); rect(g, cx + cw * 0.04, y1 + sh * 0.88, cw * 0.14, sh * 0.12, '#151515'); rect(g, cx + cw * 0.82, y1 + sh * 0.88, cw * 0.14, sh * 0.12, '#151515');
  }
  const side = (y, c0, L0) => { // 横すがた（長さ L0 の割合で）：ボンネットが右
    rect(g, w * 0.04, y + sh * 0.4, w * 0.92, sh * 0.42, css(c0)); g.fillStyle = css(c0); g.beginPath(); g.moveTo(w * 0.16, y + sh * 0.42); g.lineTo(w * 0.24, y + sh * 0.06); g.lineTo(w * 0.66, y + sh * 0.06); g.lineTo(w * 0.8, y + sh * 0.42); g.fill();
    rect(g, w * 0.27, y + sh * 0.12, w * 0.18, sh * 0.26, dk); rect(g, w * 0.47, y + sh * 0.12, w * 0.17, sh * 0.26, dk); rect(g, w * 0.04, y + sh * 0.74, w * 0.92, sh * 0.06, 'rgba(0,0,0,.3)');
    for (const t of [0.2, 0.8]) { g.fillStyle = '#161616'; g.beginPath(); g.arc(w * t, y + sh * 0.82, sh * 0.17, 0, PI * 2); g.fill(); g.fillStyle = '#8a8c8e'; g.beginPath(); g.arc(w * t, y + sh * 0.82, sh * 0.07, 0, PI * 2); g.fill(); } void L0; };
  side(sh * 2, A.pick(R, CARS));
  // 車1台（うすい色：頂点の色で 染める。箱なので ぬりつぶす）
  { const y = sh * 3; rect(g, 0, y, w, sh, '#f4f4f2'); rect(g, 0, y, w, sh * 0.1, '#d0d0ce'); rect(g, 0, y + sh * 0.9, w, sh * 0.1, '#d0d0ce'); rect(g, w * 0.2, y + sh * 0.1, w * 0.1, sh * 0.8, dk); rect(g, w * 0.3, y + sh * 0.12, w * 0.32, sh * 0.76, '#ffffff'); rect(g, w * 0.62, y + sh * 0.1, w * 0.14, sh * 0.8, dk); }
  { const y = sh * 4; rect(g, 0, y, w, sh, '#f4f4f2'); rect(g, w * 0.08, y, w * 0.86, sh * 0.06, '#e0e0de'); rect(g, w * 0.06, y + sh * 0.1, w * 0.16, sh * 0.36, '#f4f4f2'); rect(g, w * 0.24, y + sh * 0.1, w * 0.22, sh * 0.34, dk); rect(g, w * 0.48, y + sh * 0.1, w * 0.2, sh * 0.34, dk); rect(g, w * 0.7, y + sh * 0.12, w * 0.1, sh * 0.3, dk);
    rect(g, 0, y + sh * 0.74, w, sh * 0.08, 'rgba(0,0,0,.3)'); for (const t of [0.2, 0.8]) { g.fillStyle = '#161616'; g.beginPath(); g.arc(w * t, y + sh * 0.84, sh * 0.16, 0, PI * 2); g.fill(); } rect(g, 0, y + sh * 0.9, w, sh * 0.1, '#2a2a2a'); }
  { const y = sh * 5; rect(g, 0, y, w, sh, '#f4f4f2'); rect(g, w * 0.1, y + sh * 0.08, w * 0.8, sh * 0.34, dk); rect(g, w * 0.06, y + sh * 0.52, w * 0.18, sh * 0.12, '#e8e8e0'); rect(g, w * 0.76, y + sh * 0.52, w * 0.18, sh * 0.12, '#e8e8e0'); rect(g, w * 0.32, y + sh * 0.56, w * 0.36, sh * 0.14, '#3a3d40'); rect(g, 0, y + sh * 0.8, w, sh * 0.2, '#2a2b2c'); }
  // バスの横（帯 6）
  { const y = sh * 6; rect(g, 0, y, w, sh, '#f2f2ee'); rect(g, w * 0.02, y + sh * 0.12, w * 0.96, sh * 0.4, '#2c343a'); for (let i = 1; i < 9; i++) rect(g, w * (0.02 + i * 0.106), y + sh * 0.12, 2, sh * 0.4, '#d8dada'); rect(g, w * 0.08, y + sh * 0.12, w * 0.07, sh * 0.78, '#3a4248'); rect(g, w * 0.55, y + sh * 0.12, w * 0.07, sh * 0.78, '#3a4248');
    rect(g, 0, y + sh * 0.58, w, sh * 0.08, '#9aa4a8'); for (const t of [0.2, 0.82]) { g.fillStyle = '#151515'; g.beginPath(); g.arc(w * t, y + sh * 0.9, sh * 0.13, 0, PI * 2); g.fill(); } }
  // 電車の横（帯 7）
  { const y = sh * 7; const gr = g.createLinearGradient(0, y, 0, y + sh); gr.addColorStop(0, '#d9dcde'); gr.addColorStop(1, '#a9adb0'); g.fillStyle = gr; g.fillRect(0, y, w, sh); rect(g, 0, y + sh * 0.62, w, sh * 0.06, '#5b6b7a');
    for (let i = 0; i < 4; i++) { const dx = w * (0.08 + i * 0.25); rect(g, dx, y + sh * 0.18, w * 0.06, sh * 0.74, '#7d8488'); rect(g, dx + w * 0.012, y + sh * 0.22, w * 0.036, sh * 0.3, dk); rect(g, dx + w * 0.08, y + sh * 0.22, w * 0.1, sh * 0.3, dk); } }
}, { alpha: true });
// 車1台（箱：長さ 4.3・はば 1.7・高さ 1.45）
function car1(B, x, z, ang, c0, y = 0.04) {
  const L = 4.3, Wd = 1.7, H = 1.45, c = Math.cos(ang), s = Math.sin(ang), P = (u, w) => [x + c * u - s * w, z + s * u + c * w];
  const a = P(-L / 2, -Wd / 2), b = P(L / 2, -Wd / 2), q = P(L / 2, Wd / 2), d = P(-L / 2, Wd / 2), cc = col(c0);
  const [t0, t1] = SV(3, 8, 0.05), [s0, s1] = SV(4, 8, 0.03), [f0, f1] = SV(5, 8, 0.03), V = (p, h) => [p[0], y + h, p[1]];
  B.quad('i:veh', V(a, H), V(b, H), V(q, H), V(d, H), null, cc, [0, t0, 1, t0, 1, t1, 0, t1]);
  B.quad('i:veh', V(a, 0), V(b, 0), V(b, H), V(a, H), null, cc, [0, s0, 1, s0, 1, s1, 0, s1]);
  B.quad('i:veh', V(d, 0), V(q, 0), V(q, H), V(d, H), null, cc, [0, s0, 1, s0, 1, s1, 0, s1]);
  B.quad('i:veh', V(b, 0), V(q, 0), V(q, H), V(b, H), null, cc, [0, f0, 1, f0, 1, f1, 0, f1]);
  B.quad('i:veh', V(d, 0), V(a, 0), V(a, H), V(d, H), null, cc, [0, f0, 1, f0, 1, f1, 0, f1]);
}
// 車の列（質感の箱）：frame fm の u0〜u1・v0〜v0+4.6（車は v 向き）
function carRow(B, fm, u0, u1, v0, y = 0.04) {
  const d = 4.6, h = 1.45, L = u1 - u0, P = (u, v, hh) => { const q = fm.p(u, v); return [q[0], y + hh, q[1]]; };
  const [a0, a1] = SV(0, 8, 0.02), [b0, b1] = SV(1, 8, 0.02), [c0, c1] = SV(2, 8, 0.03);
  B.quad('i:veh', P(u0, v0, h), P(u1, v0, h), P(u1, v0 + d, h), P(u0, v0 + d, h), null, W1, [0, a0, L / 20, a0, L / 20, a1, 0, a1]);
  B.quad('i:veh', P(u0, v0, 0), P(u1, v0, 0), P(u1, v0, h), P(u0, v0, h), null, W1, [0, b0, L / 20, b0, L / 20, b1, 0, b1]);
  B.quad('i:veh', P(u0, v0 + d, 0), P(u1, v0 + d, 0), P(u1, v0 + d, h), P(u0, v0 + d, h), null, W1, [0, b0, L / 20, b0, L / 20, b1, 0, b1]);
  for (const u of [u0, u1]) B.quad('i:veh', P(u, v0, 0), P(u, v0 + d, 0), P(u, v0 + d, h), P(u, v0, h), null, W1, [0, c0, 1, c0, 1, c1, 0, c1]);
}
// 駐車場の ます（16m：車の列 5m・通路 6m・車の列 5m。u は 2.5m ごと）
A.tex('i:park', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#7c7e7e'); PT.noise(g, 0, 0, w, h, 0.05, R); blots(g, 0, 0, w, h, 14, '40,40,40', 0.14, R, 0.05);
  const mv = h / 16, mu = w / 4;
  for (const [v0, v1] of [[0, 5], [11, 16]]) { for (let i = 0; i <= 4; i++) rect(g, i * mu - 1.2, v0 * mv, 2.4, (v1 - v0) * mv, '#e9e9e4'); rect(g, 0, (v0 === 0 ? 5 : 11) * mv - 1, w, 2, 'rgba(233,233,228,.8)'); for (let i = 0; i < 4; i++) rect(g, i * mu + mu * 0.3, (v0 === 0 ? 0.5 : 15.2) * mv, mu * 0.4, mv * 0.3, '#b9b9b2'); }
  blots(g, 0, 5 * mv, w, 6 * mv, 8, '30,30,30', 0.1, R, 0.06);
});
// 駐車場（frame の u0〜u1・v0〜v1）：ますの質感と 車（多いときは 列の箱）。ok：車のある わり
function parkLot(B, fm, u0, v0, u1, v1, R, lod, ok = 0.7, y = 0.05, cap = 90) {
  const L = u1 - u0, D = v1 - v0; if (L < 3 || D < 4.5) return;
  const P = (u, v) => { const q = fm.p(u, v); return [q[0], y, q[1]]; };
  B.quad('i:park', P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), null, W1, [0, 0, L / 10, 0, L / 10, D / 16, 0, D / 16]);
  if (lod < 2) return;
  const n = Math.floor(L / 2.5), run = n > 24 ? Math.max(8, Math.floor(n / 4)) : 4 + (R() * 8 | 0); let nb = 0;
  for (let m = 0; m * 16 < D; m++) for (const rv of [0, 11]) {
    const vr = v0 + m * 16 + rv; if (vr + 5 > v1 + 0.01) continue;
    const okr = ok * (1 - 0.55 * (vr - v0) / Math.max(D, 1));   // 入口から 遠いほど すいている
    if (n >= 6) { let a = 0; while (a < n && nb < cap) { const len = Math.min(n - a, ok > 0.9 ? Math.max(run, 24) : run); if (R() < okr) { carRow(B, fm, u0 + a * 2.5, u0 + (a + len) * 2.5, vr + 0.2); nb++; } a += len + (R() < 0.3 ? 1 : 0); } }
    else for (let i = 0; i < n && nb < cap; i++) if (R() < okr) { const q = fm.p(u0 + i * 2.5 + 1.25, vr + 2.5); car1(B, q[0], q[1], fm.fa + PI / 2 + (rv ? PI : 0), A.pick(R, CARS)); nb++; }
  }
}
function truck(B, x, z, ang, o = {}) {   // トラック（4t・箱）。o：{ L, cab（色）, box（色）, flat（平ボディ）, load }
  const L = o.L || 7.5, Wd = 2.3, c = Math.cos(ang), s = Math.sin(ang), cab = o.cab || '#e8eaea', bx = o.box || '#e9e9e6';
  B.obox('c', x + c * (L / 2 - 1.0), z + s * (L / 2 - 1.0), ang, 2.0, Wd, 0.5, 2.7, cab, {});
  B.obox('c', x + c * (L / 2 + 0.02), z + s * (L / 2 + 0.02), ang, 0.06, Wd - 0.3, 1.6, 2.5, [0.2, 0.24, 0.28], {});
  if (o.flat) { B.obox('c', x - c * 1.0, z - s * 1.0, ang, L - 2.2, Wd, 0.8, 1.2, '#8a8c8c', {}); if (o.load) B.obox('c', x - c * 1.2, z - s * 1.2, ang, L - 3, Wd - 0.3, 1.2, 1.9, o.load, {}); }
  else B.obox('c', x - c * 1.0, z - s * 1.0, ang, L - 2.2, Wd + 0.1, 0.8, o.bh || 3.3, bx, {});
}
function trailer(B, x, z, ang, o = {}) {   // トレーラー（ヘッドと 箱・コンテナ）
  const c = Math.cos(ang), s = Math.sin(ang);
  B.obox('c', x + c * 7.2, z + s * 7.2, ang, 2.6, 2.4, 0.5, 3.0, o.cab || '#dfe2e2', {});
  B.obox('c', x - c * 0.6, z - s * 0.6, ang, 12.2, 2.45, 1.2, 4.0, o.box || '#d8d9d6', {});
}
function kei(B, x, z, ang, c0) {   // 軽トラ
  const c = Math.cos(ang), s = Math.sin(ang);
  B.obox('c', x + c * 1.2, z + s * 1.2, ang, 1.0, 1.45, 0.4, 1.8, c0 || '#efefec', {});
  B.obox('c', x - c * 0.5, z - s * 0.5, ang, 2.2, 1.45, 0.4, 0.95, c0 || '#efefec', {});
}
function forklift(B, x, z, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  B.obox('c', x, z, ang, 2.2, 1.1, 0.2, 1.2, '#d99a2b', {});
  B.obox('c', x - c * 0.2, z - s * 0.2, ang, 1.0, 1.0, 1.2, 2.1, [0.25, 0.25, 0.25], { ct: '#d99a2b' });
  B.obox('c', x + c * 1.25, z + s * 1.25, ang, 0.15, 0.9, 0.1, 2.4, [0.2, 0.2, 0.2], {});
}
function pallets(B, x, z, ang, n, R) {   // パレットの荷（段ボール・袋）
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i < n; i++) { const hh = 0.8 + R() * 0.8, x2 = x + c * i * 1.3, z2 = z + s * i * 1.3;
    B.obox('c', x2, z2, ang, 1.1, 1.1, 0.04, 0.16 + hh, A.pick(R, ['#b79a6a', '#c4ad82', '#d8d2c2', '#8e9aa3', '#5d7d9a']), {}); }
}
function drums(B, x, z, n, R) { const cc = A.pick(R, ['#2f5d8a', '#3a6a3e', '#8a3a2a', '#c8c8c0']); for (let i = 0; i < n; i++) B.cyl('c', x + (i % 3) * 0.65, z + ((i / 3) | 0) * 0.65, 0.29, 0.04, 0.94, 5, cc); }
function steel(B, x, z, ang, L, R) {   // 鋼材の山
  for (let j = 0; j < 3; j++) B.obox('c', x, z, ang, L, 1.4 - j * 0.3, 0.15 + j * 0.25, 0.4 + j * 0.25, mix('#6a6560', '#8a5a3a', R() * 0.6), {});
}
function vending(B, e, t, R) {   // 自動販売機（壁ぎわ）
  const p = ePt(e, t, 0.45), ang = eAng(e), cc = col(A.pick(R, ['#e9eaea', '#c8383a', '#2f5fa8', '#e9eaea']));
  B.obox('c', p[0], p[1], ang, 0.95, 0.8, 0.04, 1.85, cc, {});
  door(B, e, t, 0.9, 0.05, 1.75, 11, cc, 0.86);
}
function acs(B, e, n, y, R, off = 0.35) { for (let i = 0; i < n; i++) { const t = e.L * (0.15 + 0.7 * R()), p = ePt(e, t, off); B.acUnit(p[0], p[1], y, eAng(e)); } }
function signPanel(B, e, t, w, y, h, c) { const p0 = ePt(e, t - w / 2, 0.12), p1 = ePt(e, t + w / 2, 0.12); B.wall('c', p0[0], p0[1], p1[0], p1[1], y, y + h, c); }
function downs(B, G, y0, y1, c, n = 2) {   // 雨どい（たての管）
  let k = 0; for (const e of G.edges) { if (e.L < 6 || k >= n) continue; k++; const p = ePt(e, 0.35, 0.12); B.box('c', p[0] - 0.06, p[1] - 0.06, p[0] + 0.06, p[1] + 0.06, y0, y1, c || [0.75, 0.75, 0.73]); }
}
// 手すり（すかしの 縦格子：i:lat の帯 2）。辺 e の外 off m・y〜y+h
function railE(B, e, y, h, c, off = 0) { const [v0, v1] = SV(2, 8, 0.02); seg(B, 'i:lat', e, 0, e.L, y, y + h, c || W1, [0, e.L / 4], v0, v1, 1, off); }
// 金網のフェンス（外がわの辺。道がわ fe の まん中に 門）
function fence(B, F, h, c, gate, fe) {
  for (const e of F.edges) {
    if (!e.out) continue;
    if (fe && e === fe && e.L > 12) { const g = Math.min(gate || 8, e.L * 0.4), a = e.L / 2 - g / 2; fseg(B, e, 0.3, a, h, c); fseg(B, e, a + g, e.L - 0.3, h, c); }
    else fseg(B, e, 0.3, e.L - 0.3, h, c);
  }
}
function fseg(B, e, a, b, h, c, k = 1) { if (b - a < 0.5) return; const [v0, v1] = SV(k, 8, 0.02); seg(B, 'i:lat', e, a, b, 0.03, h, c || W1, [(e.u0 + a) / 8, (e.u0 + b) / 8], v0, v1, 1, -0.35); }
// すかしの格子：帯 0 ラチス・1 金網・2 手すり・3 自転車・4 パイプ・5 トラス（V）・6 はしご・7 ネット
A.tex('i:lat', 256, 256, (g, w, h, R) => {
  g.clearRect(0, 0, w, h); const sh = h / 8;
  clip(g, 0, 0, w, sh, () => { const st = sh; rect(g, 0, 0, w, 3, '#e2e4e5'); rect(g, 0, sh - 3, w, 3, '#e2e4e5'); g.strokeStyle = '#d6d8d9'; g.lineWidth = 2.2; for (let u = 0; u < w; u += st) { rect(g, u, 0, 2.5, sh, '#e2e4e5'); g.beginPath(); g.moveTo(u, 0); g.lineTo(u + st, sh); g.moveTo(u + st, 0); g.lineTo(u, sh); g.stroke(); } });
  clip(g, 0, sh, w, sh, () => { const y = sh; g.strokeStyle = 'rgba(150,156,158,1)'; g.lineWidth = 1; for (let u = -sh; u < w + sh; u += 4) { g.beginPath(); g.moveTo(u, y + 3); g.lineTo(u + sh, y + sh); g.moveTo(u + sh, y + 3); g.lineTo(u, y + sh); g.stroke(); } rect(g, 0, y + 1, w, 2.5, '#8d9294'); for (let u = 0; u < w; u += w / 4) rect(g, u, y, 2.5, sh, '#7d8284'); });
  clip(g, 0, sh * 2, w, sh, () => { const y = sh * 2; rect(g, 0, y + 1, w, 3, '#8a8e90'); rect(g, 0, y + sh - 4, w, 2, '#8a8e90'); for (let u = 0; u < w; u += 5) rect(g, u, y, 1.5, sh, '#8a8e90'); });
  clip(g, 0, sh * 3, w, sh, () => { const y = sh * 3; for (let i = 0; i < 6; i++) { const cx = (i + 0.5) * w / 6, c0 = A.pick(R, ['#3a3d40', '#8a9096', '#6a2a2a', '#2a4a6a', '#b8bcc0']); g.strokeStyle = '#2a2a2a'; g.lineWidth = 1.5; for (const dx of [-w / 30, w / 30]) { g.beginPath(); g.arc(cx + dx, y + sh * 0.68, sh * 0.26, 0, PI * 2); g.stroke(); } g.strokeStyle = c0; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - w / 30, y + sh * 0.68); g.lineTo(cx, y + sh * 0.4); g.lineTo(cx + w / 30, y + sh * 0.68); g.moveTo(cx, y + sh * 0.4); g.lineTo(cx - w / 60, y + sh * 0.3); g.stroke(); } });
  clip(g, 0, sh * 4, w, sh, () => { const y = sh * 4; const PP = [['#a8acae', 0.2, 0.12], ['#c9cbc8', 0.45, 0.09], ['#b9a070', 0.66, 0.07], ['#8f9496', 0.85, 0.08]]; for (const [c0, t, r] of PP) { const gr = g.createLinearGradient(0, y + sh * (t - r), 0, y + sh * (t + r)); gr.addColorStop(0, css(c0, 1.2)); gr.addColorStop(0.5, css(c0, 1)); gr.addColorStop(1, css(c0, 0.6)); g.fillStyle = gr; g.fillRect(0, y + sh * (t - r), w, sh * r * 2); } for (let u = 0; u < w; u += w / 2) rect(g, u, y, 3, sh, '#6f7375'); });
  clip(g, 0, sh * 5, w, sh, () => { const y = sh * 5; rect(g, 0, y, w, 3, '#8a8e90'); rect(g, 0, y + sh - 3, w, 3, '#8a8e90'); g.strokeStyle = '#8a8e90'; g.lineWidth = 2; g.beginPath(); for (let u = 0; u < w; u += sh) { g.moveTo(u, y + sh); g.lineTo(u + sh / 2, y); g.lineTo(u + sh, y + sh); } g.stroke(); });
  clip(g, 0, sh * 6, w, sh, () => { const y = sh * 6; for (const u of [w * 0.3, w * 0.7]) rect(g, u, y, 2, sh, '#9a9e9e'); for (let v = y; v < y + sh; v += 5) rect(g, w * 0.3, v, w * 0.4, 1.5, '#9a9e9e'); });
  clip(g, 0, sh * 7, w, sh, () => { const y = sh * 7; g.fillStyle = 'rgba(60,70,60,1)'; for (let u = 0; u < w; u += 3) g.fillRect(u, y, 1, sh); for (let v = y; v < y + sh; v += 3) g.fillRect(0, v, w, 1); });
}, { alpha: true });
function trees(B, fm, Wd, R, v, n) { for (let i = 0; i < n; i++) { const p = fm.p(Wd * (i + 0.5) / n, v); B.tree(p[0], p[1], 0.04, 4 + R() * 2, 1.6 + R() * 0.6, [0.27 + R() * 0.06, 0.42, 0.22]); } }
// 資材置き場（パレット・鋼材・ドラム缶・フォークリフト）
function yardProps(B, fm, u0, v0, u1, v1, R, kind) {
  const n = cl(Math.round(Math.sqrt((u1 - u0) * (v1 - v0)) / 10), 1, 6);
  for (let i = 0; i < n; i++) { const p = fm.p(u0 + 3 + (u1 - u0 - 6) * R(), v0 + 3 + (v1 - v0 - 6) * R()), t = R(); if (t < 0.4 || kind === 'box') pallets(B, p[0], p[1], fm.ua, 3, R); else if (t < 0.7) steel(B, p[0], p[1], fm.ua + PI / 2 * (R() < 0.5 ? 1 : 0), 6, R); else drums(B, p[0], p[1], 6, R); }
  const q = fm.p((u0 + u1) / 2, (v0 + v1) / 2); forklift(B, q[0], q[1], fm.fa + 0.4); if (u1 - u0 > 14) truck(B, q[0] + 6 * Math.cos(fm.ua), q[1] + 6 * Math.sin(fm.ua), fm.ua, { flat: true, load: '#8a8580' });
}

/* ---------- 大きな区画の配置 ----------
   道がわの帯（事務所・駐車場）と、奥の 棟のます目。o：{ set（区画から さがる m）, fzk（道がわの帯の割合）, ck（棟のはばの めやす：√面積 × ck）, maxU, maxV } */
function plan(P, o = {}) {
  const F = P.F, fr = P.front || [0, 1], R0 = inR(F.rects[0], o.set || 1.5), fm = frame(R0, fr), Wd = fm.W, D = fm.D, sq = Math.sqrt(F.area);
  const fz = D > 40 ? cl(D * (o.fzk || 0.16), 9, 24) : 0, gap = cl(sq * 0.06, 6, 14);
  const nU = cl(Math.round(Wd / cl(sq * (o.ck || 0.5), 22, 100)), 1, o.maxU || 3), nV = cl(Math.round((D - fz) / (o.dv || 110)), 1, o.maxV || 2);
  const sw = (Wd - gap * (nU - 1)) / nU, sd = (D - fz - gap * (nV - 1)) / nV, cells = [];
  for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) { const u0 = i * (sw + gap), v0 = fz + j * (sd + gap); cells.push({ i, j, u0, v0, u1: u0 + sw, v1: v0 + sd, a: sw * sd }); }
  return { R0, fm, Wd, D, fz, gap, nU, nV, cells, sq };
}

/* ---------- 外壁・屋根の材料 ---------- */
const MW = {
  galv: { m: 'i:nami', k: 0, su: 4 }, paint: c => ({ m: 'i:nami', k: 1, su: 4, c: col(c) }), paintR: c => ({ m: 'i:nami', k: 2, su: 4, c: col(c) }),
  slate: { m: 'i:nami', k: 3, su: 4 }, rust: { m: 'i:nami', k: 4, su: 4 }, kaku: c => ({ m: 'i:nami', k: 5, su: 4, c: col(c) }), wood: { m: 'i:nami', k: 6, su: 4 }, yaki: { m: 'i:nami', k: 7, su: 4 },
  panel: c => ({ m: 'i:panel', su: 8, c: col(c) }), alc: c => ({ m: 'i:alc', su: 6, c: col(c) }), brick: { m: 'i:brick', su: 4 }, conc: c => ({ m: 'i:conc', su: 8, c: col(c || '#ffffff') })
};
const MR = {
  orib: c => ({ m: 'i:roof', k: 0, n: 4, su: 6, c: col(c) }), osky: c => ({ m: 'i:roof', k: 1, n: 4, su: 6, c: col(c) }), slate: { m: 'i:roof', k: 2, n: 4, su: 6 },
  orust: c => ({ m: 'i:roof', k: 3, n: 4, su: 6, c: col(c) }), flat: c => ({ m: 'i:flat', su: 16, c: col(c || '#ffffff') })
};

/* ---------- 棟（工場・倉庫のたてもの） ----------
   lod 2：外壁（波板など）・腰壁・窓の帯・戸・小物。lod 1：far の質感（窓を描きこんだ）＋ 戸 ＋ 屋根。lod 0：箱と屋根 */
// 腰壁（コンクリートブロック）つきの外壁
function shedWalls(B, G, y0, H, L) {
  const wh = L.wain || 0;
  for (const e of G.edges) {
    if (wh > 0) seg(B, 'i:conc', e, 0, e.L, y0, y0 + wh, col('#d8d6d0'), [e.u0 / 8, (e.u0 + e.L) / 8], (y0 + 2) / 8, (y0 + 2 + wh) / 8, 0.8);
    clad(B, e, 0, e.L, y0 + wh, H, L.W, wh > 0 ? 1 : 0.82);
  }
}
// far と同じ質感の壁（u は 4m・v は 1階分）
function farWalls(B, G, y0, H, fw, wc, fh) { for (const e of G.edges) seg(B, fw, e, 0, e.L, y0, H, wc, [e.u0 / 4, (e.u0 + e.L) / 4], 0, (H - y0) / (fh || H - y0), 0.85); }
// lod 0 の棟：箱 ＋ 屋根（切妻か平ら）
function lowShed(B, P, G, H, L, o = {}) {
  const wc = col(L.fc || '#d0d0d0'); farWalls(B, G, 0, H, o.fw || L.fw || 'i:fw:koba', wc, o.fh);
  if (P.yb < -0.5) B.plinth(G, P.yb, 0.05);
  const r = G.rects[0], t = o.rt || L.rt;
  if (t !== 'flat' && G.rects.length === 1 && Math.min(rw(r), rd(r)) < 60) return gableRoof(B, r, H, { m: 'c', su: 1, c: col(L.rc || '#9a9c9c') }, { m: 'c', su: 1, sv: 1, c: wc }, { p: t === 'barrel' ? 0.3 : t === 'saw' ? 0.06 : (L.p || 0.15), oh: 0.2, lod: 0, ms: 60 });
  B.cap('c', G, H, col(L.rc || '#9a9c9c')); return H;
}
// 棟。o：{ fe（道がわの辺）, ow（事務所の窓のはば）, ofs, f（階）, multi（階ごとの窓）, nd（戸の数のめやす）, dside（よこの辺にも戸）}
function shed(B, P, L, G, H, o = {}) {
  const lod = P.lod, R = P.rng, fe = o.fe, f = o.f || 1, big = G.area > 1200;
  if (lod <= 0) return lowShed(B, P, G, H, L, o);
  const RSo = { t: L.rt, p: L.p, lod, tr: L.tr, mon: L.mon && lod >= 2, pc: L.pc ? col(L.pc) : mul(L.W.c || W1, 0.85), ms: o.ms || (L.rt === 'barrel' ? 50 : 30), tw: Math.max(8.5, Math.max(G.bb[3] - G.bb[1], G.bb[2] - G.bb[0]) / (lod >= 2 ? 10 : 4)), hmax: o.hmax };
  if (lod === 1) {
    farWalls(B, G, 0, H, o.fw || L.fw || 'i:fw:koba', col(L.fc || '#d0d0d0'), f >= 2 ? H / f : H);
  } else {
    shedWalls(B, G, 0, H, L);
    const lo = L.bh === 'lo', dh = f >= 2 ? Math.min(H / f - 0.5, 4.5) : Math.min(H - 1.4, 4.8);
    for (const e of G.edges) {
      if (e.L < 4 || L.bk == null) continue;
      const isF = e === fe, a = isF ? (o.ofs || 0) + (o.ow || 0) : 0.6;
      if (f >= 2 && o.multi) { for (let i = isF ? 1 : 0; i < f; i++) { const fy = i * (H / f); band(B, e, isF ? a + 0.3 : 0.6, e.L - 0.6, fy + 1.0, fy + Math.min(2.4, H / f - 0.8), L.bk === 2 ? 1 : L.bk, L.bk === 0 ? 2.6 : 3.2); } }
      else if (!isF) { if (lo) band(B, e, 0.8, e.L - 0.8, 1.1, 2.3, L.bk, L.bk === 4 ? 4 : 3); else band(B, e, 0.8, e.L - 0.8, H - 2.0, H - 0.7, L.bk, 3.6); }
      else if (!lo && H > dh + 2.5) band(B, e, a + 0.4, e.L - 0.6, H - 1.8, H - 0.7, L.bk, 3.6);
    }
    if (L.stripe) for (const e of G.edges) seg(B, 'c', e, 0, e.L, H - 0.9, H - 0.45, col(L.stripe), null, 0, 0, 1, 0.04);
  }
  // 道がわ：事務所の窓・入口・大きな戸
  if (fe) {
    const ow = o.ow || 0, ofs = o.ofs || 0, dh = f >= 2 ? Math.min(H / f - 0.5, 4.5) : Math.min(H - 1.4, 4.8);
    if (ow > 0 && lod >= 2) {
      band(B, fe, ofs + 0.3, ofs + ow - 0.3, 1.0, 2.2, 0, 2.4);
      door(B, fe, ofs + ow - 1.2, 1.0, 0, 2.1, L.ofc ? 6 : 7, W1);
      if (H > 7) band(B, fe, ofs + 0.3, ofs + ow - 0.3, 4.0, 5.3, 0, 2.4);
    }
    const free = fe.L - ow - 1.2, dw = cl(H * 0.65, 3.2, 5.5), nd = cl(Math.floor(free / (dw + (big ? 8 : 2.2))), 1, lod >= 2 ? 6 : 3);
    for (let i = 0; i < nd; i++) { const t = ofs + ow + 0.6 + free * (i + 0.5) / nd; door(B, fe, t, Math.min(dw, free / nd - 0.8), 0, Math.min(dh, dw * 0.95), (i === 0 && R() < 0.5 && L.dk < 2) ? 4 : L.dk, col(L.dc)); }
    if (L.sg && lod >= 2 && ow > 2) signPanel(B, fe, ofs + ow / 2, Math.min(ow - 0.6, 4.5), f >= 2 ? H - 1.6 : 2.6, 0.8, col(L.sg));
  }
  if (o.dside && lod >= 2) for (const e of G.edges) if (e !== fe && e.L > 20 && R() < 0.7) door(B, e, e.L * (0.3 + 0.4 * R()), 4, 0, Math.min(4.2, H - 1.5), L.dk, col(L.dc));
  const top = roofs(B, G, H, L.RS, lod >= 2 ? L.W : { m: o.fw || L.fw || 'i:fw:koba', su: 4, sv: H, c: col(L.fc || '#d0d0d0') }, RSo);
  if (lod >= 2) {
    downs(B, G, 0, H, mul(L.W.c || W1, 0.8), big ? 3 : 2);
    if (L.rt === 'flat') { const rr = G.rects[0]; if (rw(rr) > 6 && rd(rr) > 6) for (let i = 0; i < Math.min(4, (G.area / 150) | 0); i++) B.acUnit(rr[0] + 2 + (rw(rr) - 4) * R(), rr[1] + 2 + (rd(rr) - 4) * R(), H, 0); }
    else if (L.rt === 'gable' && G.area > 150 && !L.mon) { const rr = G.rects[0], ax = rw(rr) >= rd(rr), nv = Math.min(3, Math.max(1, ((ax ? rw(rr) : rd(rr)) / 14) | 0)); if ((ax ? rd(rr) : rw(rr)) <= 36) for (let i = 0; i < nv; i++) { const t = (i + 0.5) / nv, x = ax ? rr[0] + rw(rr) * t : (rr[0] + rr[2]) / 2, z = ax ? (rr[1] + rr[3]) / 2 : rr[1] + rd(rr) * t; B.cyl('c', x, z, 0.35, top - 0.1, top + 0.7, 5, [0.75, 0.76, 0.76]); } }
    if (fe) acs(B, fe, 1 + (R() * 2 | 0), 0.05, R);
  }
  return top;
}
// 事務所（小さなビル）：形 G・階 nf・階高 fh・道がわの辺 fe
function office(B, P, G, nf, fh, L, fe) {
  const lod = P.lod, H = nf * fh + 0.3, wc = col(L.ofc ? '#eeede8' : (L.ow || '#e6e1d6'));
  if (lod <= 1) { farWalls(B, G, 0, H, 'i:fw:ofc', wc, fh); B.cap('c', G, H, col('#b9bbbb')); if (lod === 1) for (const e of G.edges) B.wallE('c', e, H, H + 0.6, mul(wc, 0.9)); return H; }
  const Wm = MW.alc(L.ofc ? '#eeede8' : (L.ow || '#e6e1d6'));
  for (const e of G.edges) clad(B, e, 0, e.L, 0, H, Wm, 0.85);
  for (let i = 0; i < nf; i++) for (const e of G.edges) { if (e.L < 4) continue; const y = 0.3 + i * fh; if (i === 0 && e === fe) { band(B, e, 0.5, e.L * 0.55, y + 0.9, y + 2.3, 0, 2.6); door(B, e, e.L * 0.72, 2.0, 0.05, 2.4, 6, W1); } else band(B, e, 0.5, e.L - 0.5, y + 0.9, y + 2.3, L.ofc ? 3 : 0, 2.6); }
  B.cap('i:flat', G, H, col('#c9cbcb'), { su: 16 });
  B.parapet(G, H, 0.6, 0.2, col(L.pc || '#d8d6d0'));
  B.rooftop(G, H, P.rng, { per: 50, nmax: 4, ph: false });
  const p0 = ePt(fe, fe.L * 0.72 - 1.6, 0), p1 = ePt(fe, fe.L * 0.72 + 1.6, 1.4); B.box('c', Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), 2.7, 2.9, [0.8, 0.8, 0.78]);
  return H;
}
// 地面（区画の 舗装。坂は 土台で 地面まで）
function pave(B, P, F, m, c, y = 0.04) { if (P.lod >= 1) { B.plinth(F, P.yb, y); B.cap(m || 'i:asph', F, y, c || W1, { su: 16 }); } }

/* ---------- 設備（煙突・タンク・サイロ・配管・山） ---------- */
// 煙突の質感（たて 1本：u は まわり、v は 高さ）：列 0 赤白の帯・1 コンクリート（上が すす）・2 レンガ・3 白（上に 帯）
A.tex('i:stack', 128, 256, (g, w, h, R) => {
  const cw = w / 4;
  for (let i = 0; i < 7; i++) rect(g, 0, i * h / 7, cw, h / 7, i % 2 ? '#eeeeea' : '#c8473a');
  { const x = cw; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#4a4a48'); gr.addColorStop(0.08, '#8e8d88'); gr.addColorStop(0.2, '#bdbcb6'); gr.addColorStop(1, '#c6c4be'); g.fillStyle = gr; g.fillRect(x, 0, cw, h); for (let v = 0; v < h; v += h / 24) rect(g, x, v, cw, 1, 'rgba(0,0,0,.08)'); }
  { const x = cw * 2; rect(g, x, 0, cw, h, '#8a4a36'); for (let v = 0; v < h; v += 2) rect(g, x, v, cw, 1, 'rgba(0,0,0,.12)'); const gr = g.createLinearGradient(0, 0, 0, h * 0.25); gr.addColorStop(0, 'rgba(30,26,24,.8)'); gr.addColorStop(1, 'rgba(30,26,24,0)'); g.fillStyle = gr; g.fillRect(x, 0, cw, h * 0.25); }
  { const x = cw * 3; rect(g, x, 0, cw, h, '#e9e8e3'); rect(g, x, h * 0.04, cw, h * 0.05, '#5d6a78'); rect(g, x, h * 0.12, cw, h * 0.015, '#5d6a78'); for (let v = 0; v < h; v += h / 30) rect(g, x, v, cw, 1, 'rgba(0,0,0,.05)'); }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
// タンクの外板（うすい色：溶接の目地。16m 四方）
A.tex('i:tank', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#eeeeea'); for (let j = 0; j < 8; j++) { rect(g, 0, j * h / 8, w, 1.2, 'rgba(0,0,0,.14)'); for (let i = 0; i < 4; i++) rect(g, ((i + (j % 2) * 0.5) * w / 4) % w, j * h / 8, 1, h / 8, 'rgba(0,0,0,.08)'); }
  drips(g, 0, 0, w, h, 30, '110,100,90', 0.08, R, 0.4); grime(g, 0, 0, w, h, 0.12, 0.1); PT.noise(g, 0, 0, w, h, 0.015, R);
});
// 円すい台（まわり n 面。質感 m の u は U、v は V）
function frustum(B, m, cx, cz, r0, r1, y0, y1, n, c, U, V) {
  const u0 = U ? U[0] : 0, u1 = U ? U[1] : 0, v0 = V ? V[0] : 0, v1 = V ? V[1] : 0;
  for (let i = 0; i < n; i++) {
    const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2, ua = u0 + (u1 - u0) * i / n, ub = u0 + (u1 - u0) * (i + 1) / n;
    B.quad(m, [cx + Math.cos(t0) * r0, y0, cz + Math.sin(t0) * r0], [cx + Math.cos(t1) * r0, y0, cz + Math.sin(t1) * r0], [cx + Math.cos(t1) * r1, y1, cz + Math.sin(t1) * r1], [cx + Math.cos(t0) * r1, y1, cz + Math.sin(t0) * r1], null, c, U ? [ua, v0, ub, v0, ub, v1, ua, v1] : null);
  }
}
// 煙突（k：0 赤白・1 コンクリート・2 レンガ・3 白）。高さ 60m より上は 赤白（航空障害の標識）
function chimney(B, x, z, r, h, k, lod, y0 = 0) {
  const n = lod >= 2 ? 12 : lod >= 1 ? 8 : 6, kk = h >= 60 && k !== 3 ? 0 : k, U = [kk / 4 + 0.01, (kk + 1) / 4 - 0.01];
  frustum(B, 'i:stack', x, z, r * 1.25, r, y0, y0 + h, n, W1, U, [0.003, 0.997]);
  B.cyl('c', x, z, r * 0.8, y0 + h - 0.6, y0 + h - 0.05, n, [0.15, 0.14, 0.13], { notop: false });
  if (lod >= 2 && h > 30) { B.cyl('c', x, z, r + 0.7, y0 + h * 0.62, y0 + h * 0.62 + 0.25, n, [0.45, 0.45, 0.44]); B.cyl('c', x, z, r + 0.6, y0 + h - 4, y0 + h - 3.8, n, [0.45, 0.45, 0.44]); }
  return y0 + h;
}
// たてのタンク（t：'cone' 屋根・'flat' 浮き屋根・'dome'。c：色）。lod 2 は らせん階段と てすり
function tank(B, cx, cz, r, h, c, t, lod, y0 = 0) {
  const n = lod >= 2 ? (r > 12 ? 20 : r > 5 ? 14 : 10) : lod >= 1 ? (r > 8 ? 8 : r > 4 ? 6 : 5) : (r > 8 ? 6 : 4), C = 2 * PI * r;
  frustum(B, 'i:tank', cx, cz, r, r, y0, y0 + h, n, c, [0, C / 16], [y0 / 16, (y0 + h) / 16]);
  if (t === 'flat') { fan(B, cx, cz, r * 0.97, y0 + h - 0.85, y0 + h - 0.85, n, mul(c, 0.78)); }
  else if (t === 'dome' && lod >= 2 && r > 3.5) B.dome('c', cx, cz, r, r, y0 + h, r * 0.35, n, mul(c, 0.95), { rings: 2 });
  else fan(B, cx, cz, r, y0 + h, y0 + h + r * (t === 'dome' ? 0.3 : 0.18), n, mul(c, 0.92));
  if (lod >= 2 && h > 8 && r >= 6 && t !== 'dome') {   // らせん階段（帯）と 上のてすり
    const m = Math.max(6, Math.round(n * 0.6)), turn = Math.min(1, 22 / C) * PI * 2;
    for (let i = 0; i < m; i++) { const a0 = i / m * turn, a1 = (i + 1) / m * turn, ya = y0 + 0.3 + (h - 0.6) * i / m, yb = y0 + 0.3 + (h - 0.6) * (i + 1) / m, ro = r + 0.9;
      B.quad('c', [cx + Math.cos(a0) * r, ya, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, yb, cz + Math.sin(a1) * r], [cx + Math.cos(a1) * ro, yb, cz + Math.sin(a1) * ro], [cx + Math.cos(a0) * ro, ya, cz + Math.sin(a0) * ro], null, [0.55, 0.55, 0.53]); }
    if (t !== 'dome' && r > 14) { const [v0, v1] = SV(2, 8, 0.02); for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.quad('i:lat', [cx + Math.cos(t0) * r, y0 + h, cz + Math.sin(t0) * r], [cx + Math.cos(t1) * r, y0 + h, cz + Math.sin(t1) * r], [cx + Math.cos(t1) * r, y0 + h + 1.1, cz + Math.sin(t1) * r], [cx + Math.cos(t0) * r, y0 + h + 1.1, cz + Math.sin(t0) * r], null, W1, [0, v0, C / n / 4, v0, C / n / 4, v1, 0, v1]); } }
  }
  return y0 + h;
}
// 円すいの ふた（y0 の円 → y1 の点）
function fan(B, cx, cz, r, y0, y1, n, c) { for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.tri('c', [cx + Math.cos(t0) * r, y0, cz + Math.sin(t0) * r], [cx, y1, cz], [cx + Math.cos(t1) * r, y0, cz + Math.sin(t1) * r], null, c); } }
// 球形タンク（脚つき）
function sphereT(B, cx, cz, r, c, lod) {
  const n = lod >= 2 ? 10 : lod >= 1 ? 6 : 4, yc = r + 2.5;
  B.dome('c', cx, cz, r, r, yc, r, n, c, { rings: lod >= 2 ? 3 : 1 }); B.dome('c', cx, cz, r, r, yc, -r, n, mul(c, 0.82), { rings: lod >= 2 ? 2 : 1 });
  if (lod >= 2) for (let i = 0; i < 4; i++) { const t = i / 4 * PI * 2 + 0.4, x = cx + Math.cos(t) * r * 0.9, z = cz + Math.sin(t) * r * 0.9; B.wall('c', x - Math.sin(t) * 0.4, z + Math.cos(t) * 0.4, x + Math.sin(t) * 0.4, z - Math.cos(t) * 0.4, 0, yc, mul(c, 0.7)); }
  return yc + r;
}
// サイロ（コンクリート：n 本の ならび）＋ 上の 建屋
function silos(B, x0, z0, nx, nz, r, h, lod, c) {
  const n = lod >= 2 ? 10 : 4, cc = c || W1, W = nx * r * 2.02, D = nz * r * 2.02;
  if (lod <= 0) boxW(B, [x0, z0, x0 + W, z0 + D], 0, h, MW.conc(cc), { ct: [0.6, 0.6, 0.6] });
  else for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const cx = x0 + r + i * r * 2.02, cz = z0 + r + j * r * 2.02; frustum(B, 'i:conc', cx, cz, r, r, 0, h, n, cc, [0, 2 * PI * r / 8], [0, h / 8]); fan(B, cx, cz, r, h, h + 0.3, n, mul(cc, 0.72)); }
  boxW(B, [x0 + W * 0.1, z0 + D * 0.3, x0 + W * 0.9, z0 + D * 0.7], h, h + 4.5, MW.conc(mul(cc, 0.95)), { ct: [0.55, 0.56, 0.56] });
  return h + 4.5;
}
// 配管の架台（長い箱：横は パイプの すかし質感）：x0,z0 → x1,z1（まっすぐ）・高さ h・はば w
function pipeRack(B, x0, z0, x1, z1, h, w, lod) {
  const L = Math.hypot(x1 - x0, z1 - z0); if (L < 2) return; const tx = (x1 - x0) / L, tz = (z1 - z0) / L, nx = -tz * w / 2, nz = tx * w / 2, [v0, v1] = SV(4, 8, 0.02);
  for (const sg of [-1, 1]) B.wall('i:lat', x0 + nx * sg, z0 + nz * sg, x1 + nx * sg, z1 + nz * sg, h - 2.2, h, W1, [0, L / 8, v0, v1]);
  B.quad('c', [x0 - nx, h - 1.1, z0 - nz], [x1 - nx, h - 1.1, z1 - nz], [x1 + nx, h - 1.1, z1 + nz], [x0 + nx, h - 1.1, z0 + nz], null, [0.6, 0.62, 0.62]);
  if (lod >= 2) { const nb = Math.max(1, Math.round(L / 15)); for (let i = 0; i <= nb; i++) { const px = x0 + (x1 - x0) * i / nb, pz = z0 + (z1 - z0) * i / nb; B.wall('c', px - nx, pz - nz, px + nx, pz + nz, 0, h - 2.2, [0.5, 0.5, 0.48]); } }
}
// 山（鉱石・石炭・チップ・砂利）：長方形 r のうえに 屋根のような 山
function pile(B, r, h, c) {
  const [x0, z0, x1, z1] = r, X = rw(r) >= rd(r), m = h * 0.9;
  if (X) { const zm = (z0 + z1) / 2, a = Math.min(rd(r) / 2, h), xa = x0 + a, xb = x1 - a;
    B.quad('c', [x0, 0.05, z0], [xa, h, zm], [xb, h, zm], [x1, 0.05, z0], null, c); B.quad('c', [x1, 0.05, z1], [xb, h, zm], [xa, h, zm], [x0, 0.05, z1], null, mul(c, 0.9));
    B.tri('c', [x0, 0.05, z1], [xa, h, zm], [x0, 0.05, z0], null, mul(c, 0.85)); B.tri('c', [x1, 0.05, z0], [xb, h, zm], [x1, 0.05, z1], null, mul(c, 0.95)); }
  else { const xm = (x0 + x1) / 2, a = Math.min(rw(r) / 2, h), za = z0 + a, zb = z1 - a;
    B.quad('c', [x0, 0.05, z1], [xm, h, zb], [xm, h, za], [x0, 0.05, z0], null, c); B.quad('c', [x1, 0.05, z0], [xm, h, za], [xm, h, zb], [x1, 0.05, z1], null, mul(c, 0.9));
    B.tri('c', [x0, 0.05, z0], [xm, h, za], [x1, 0.05, z0], null, mul(c, 0.85)); B.tri('c', [x1, 0.05, z1], [xm, h, zb], [x0, 0.05, z1], null, mul(c, 0.95)); }
  void m;
}
// ラチスの塔・やぐら（四角。下 w0・上 w1・高さ y0〜y1。すかしの 格子）
const STEEL_C = [0.5, 0.52, 0.53];
function latTower(B, cx, cz, w0, w1, y0, y1, c, k = 0) {
  if (!c || c === W1) c = STEEL_C;
  const [v0, v1] = SV(k, 8, 0.02), P = (sx, sz, y, w) => [cx + sx * w / 2, y, cz + sz * w / 2], hh = y1 - y0, rep = Math.max(1, Math.round(hh / Math.max(1, (w0 + w1) / 2)));
  const sides = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
  for (const [a, b] of sides) B.quad('i:lat', P(a[0], a[1], y0, w0), P(b[0], b[1], y0, w0), P(b[0], b[1], y1, w1), P(a[0], a[1], y1, w1), null, c, [0, v0, 0, v1, rep / 8, v1, rep / 8, v0]);
}
// コンベヤ（ななめの箱：p0 → p1。横は トラス）
function conveyor(B, p0, p1, w, lod) {
  beam(B, 'c', p0, p1, w, 1.8, [0.66, 0.67, 0.66]);
  if (lod >= 2) { const L = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), n = Math.max(1, Math.round(L / 25)); for (let i = 1; i < n + 1; i++) { const t = i / (n + 1), x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, z = p0[2] + (p1[2] - p0[2]) * t; B.box('c', x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0, y - 0.9, [0.5, 0.5, 0.48]); } }
}

/* ---------- 町工場・中小の工場（i_koba） ----------
   小さな区画：棟 1つ（道がわに 事務所の窓と入口・大きな戸）。大きな区画：事務所・駐車場・棟いくつか・資材置き場 */
// 見た目：W 外壁・wain 腰壁・rt 屋根の形・RS 屋根・bk/bh 窓の帯・dk/dc 戸・tr 軒先・sg 看板・fc/rc（遠くの色）
const KOBA = [
  { n: 'グレーの波板・折板屋根', W: MW.galv, wain: 1.0, rt: 'gable', p: 0.12, RS: MR.orib('#b9bcbd'), bk: 2, bh: 'hi', dk: 0, dc: '#c9cccb', tr: '#9a9d9e', sg: '#2f4f78', fc: '#b3b8ba', rc: '#a9acad' },
  { n: '水色の波板・のこぎり屋根', W: MW.paint('#a9c1cf'), wain: 1.1, rt: 'saw', RS: MR.orib('#b5b8b9'), bk: 1, bh: 'lo', dk: 1, dc: '#9fb8c6', tr: '#7e98a8', sg: '#e8e6dc', fc: '#9db5c3', rc: '#a3a7a9' },
  { n: '大波スレートの古い工場', W: MW.slate, wain: 0.9, rt: 'gable', p: 0.22, RS: MR.slate, bk: 1, bh: 'hi', dk: 1, dc: '#8f9a96', tr: '#6f7472', mon: true, sg: '#d8d4c8', fc: '#a4a5a0', rc: '#8b8d89' },
  { n: 'クリームの波板・赤い屋根', W: MW.paintR('#ece3c6'), wain: 0.9, rt: 'gable', p: 0.18, RS: MR.orib('#9a4a36'), bk: 0, bh: 'lo', dk: 0, dc: '#e4dcc2', tr: '#7d3c2c', sg: '#3a6a4a', fc: '#e0d6ba', rc: '#8c4232' },
  { n: '白いALC・平らな屋根', W: MW.alc('#f0efea'), wain: 0, rt: 'flat', RS: MR.flat('#d3d5d5'), bk: 3, bh: 'lo', dk: 0, dc: '#d8dadb', pc: '#3f6c96', stripe: '#3f6c96', sg: '#3f6c96', fc: '#e8e7e2', rc: '#babdbe', ofc: true, fw: 'i:fw:ofc' },
  { n: '緑の波板・かまぼこ屋根', W: MW.paint('#9fb59f'), wain: 1.0, rt: 'barrel', p: 0.16, RS: MR.orib('#5e7a64'), bk: 2, bh: 'hi', dk: 0, dc: '#8aa08c', tr: '#4e6654', sg: '#efeee8', fc: '#97ac97', rc: '#5e7a64' },
  { n: '白いパネル・青い帯', W: MW.panel('#f3f3f0'), wain: 0, rt: 'gable', p: 0.08, RS: MR.osky('#c9cccd'), bk: 3, bh: 'lo', dk: 3, dc: '#d9dbdb', tr: '#c2c5c6', stripe: '#2f6aa8', sg: '#2f6aa8', fc: '#ecece9', rc: '#c3c6c7', ofc: true, fw: 'i:fw:soko' },
  { n: '錆びたトタンの小屋', W: MW.rust, wain: 0, rt: 'gable', p: 0.25, RS: MR.orust('#c5c0b6'), bk: 4, bh: 'lo', dk: 4, dc: '#ffffff', tr: '#6e4a38', sg: null, fc: '#9e8a76', rc: '#8c6c58' },
  { n: 'レンガ造り・のこぎり屋根', W: MW.brick, wain: 0, rt: 'saw', RS: MR.slate, bk: 7, bh: 'lo', dk: 9, dc: '#ffffff', tr: '#5a5650', sg: null, fc: '#94563f', rc: '#8b8d89' },
  { n: 'ベージュの角波・片流れ', W: MW.kaku('#dcd0b6'), wain: 0.8, rt: 'shed', p: 0.1, RS: MR.orib('#6c625a'), bk: 0, bh: 'lo', dk: 0, dc: '#cfc4ac', tr: '#5a524a', sg: '#7a3a30', fc: '#d4c8ad', rc: '#625a52' }
];
const kobaH = (f, R) => f <= 1 ? 5.2 + 1.6 * R() : f === 2 ? 8.0 + 1.2 * R() : 4.3 * f + 0.4 * R();
A.arch('i_koba', {
  looks: KOBA,
  far(L, P) { const f = Math.max(1, P.f), H = kobaH(f, P.rng); return { H, base: 0, wall: L.fw || 'i:fw:koba', bw: 4, fh: f >= 2 ? H / f : H, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: L.rt === 'flat' ? 'flat' : 'gable', p: 0.15, ins: 0.8, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, f = Math.max(1, P.f), H = kobaH(f, R), fr = P.front || [0, 1];
    if (F.n <= 12 || F.rects.length > 1) {   // 小さな区画：棟 1つ（形は 区画の形）
      const I = A.inset(F, 0.6), fe = A.frontEdge(I, fr), ow = fe.L > 9 && (f >= 2 || R() < 0.6) ? cl(fe.L * 0.3, 3.5, 7) : 0;
      pave(B, P, F, 'i:cpad');
      shed(B, P, L, I, H, { fe, ow, ofs: R() < 0.5 ? 0.6 : 0, f, multi: f >= 2 });
      if (lod >= 2 && fe.L > 8 && R() < 0.5) vending(B, fe, ow > 0 ? ow + 0.8 : 1.2, R);
      return;
    }
    // 大きな区画：道がわに 事務所と駐車場、奥に 棟
    const pl = plan(P), fm = pl.fm; pave(B, P, F, 'i:asph');
    let k = 0, nb = 0; const lim = lod <= 0 ? 3 : 99;
    for (const c of pl.cells) {
      const yard = pl.cells.length > 2 && k++ === 1 && R() < 0.5;
      if (yard) { if (lod >= 2) yardProps(B, fm, c.u0, c.v0, c.u1, c.v1, R); continue; }
      if (nb++ >= lim) continue;
      const G = RF(fm.r(c.u0, c.v0, c.u1, c.v1));
      shed(B, P, L, G, H + (c.a > 1500 ? 1.5 : 0), { fe: G.edges[fm.fi], f, multi: f >= 3, dside: true });
    }
    if (pl.fz > 0 && lod >= 1) {   // 事務所（2〜3階）と駐車場
      const ow2 = cl(pl.Wd * 0.3, 10, 30), od = cl(pl.fz - 3, 6, 12), G = RF(fm.r(2, 1.5, 2 + ow2, 1.5 + od));
      office(B, P, G, f >= 3 ? 3 : 2, 3.5, L, G.edges[fm.fi]);
      parkLot(B, fm, 6 + ow2, 1.2, pl.Wd - 2, Math.min(pl.fz - 1, 17), R, lod, 0.75);
      if (lod >= 2) { fence(B, F, 1.8, W1, 9, A.frontEdge(F, fr)); trees(B, fm, pl.Wd, R, 0.6, 4); }
    }
  }
});

/* ---------- 倉庫（i_soko） ----------
   区画の奥に 大きな棟、道がわに トラックの広場。荷さばきの 高床・庇・シャッター。冷凍倉庫・配送センター・トラックターミナル・卸売市場は P.ko で */
A.tex('i:kawara', 256, 256, (g, w, h, R) => PT.roofMat(g, w, h, { t: 'kawara', c: '#62676d' }, R));
A.tex('i:stone', 256, 256, (g, w, h, R) => {   // 石（大谷石のような やわらかい石。4m 四方）
  rect(g, 0, 0, w, h, '#b3aa90'); const rows = 13, bh = h / rows, bw = w / 4.4;
  for (let j = 0; j < rows; j++) for (let i = -1; i < 6; i++) { const x = i * bw + (j % 2) * bw / 2; rect(g, x + 0.8, j * bh + 0.8, bw - 1.6, bh - 1.6, css(mix('#cbc2a6', '#bdb08e', R()), 0.92 + R() * 0.14)); }
  blots(g, 0, 0, w, h, 60, '120,96,60', 0.25, R, 0.012); drips(g, 0, 0, w, h, 14, '70,64,50', 0.12, R, 0.6); PT.noise(g, 0, 0, w, h, 0.03, R);
});
MW.stone = { m: 'i:stone', su: 4 }; MR.kawara = { m: 'i:kawara', su: 4.8 };
const SOKO = [
  { n: 'シルバーの波板・切妻屋根', W: MW.galv, wain: 1.2, rt: 'gable', p: 0.16, RS: MR.orib('#c2c5c6'), bk: 2, bh: 'hi', dk: 0, dc: '#c7cac9', tr: '#9a9d9e', cn: '#b8bbbc', fc: '#b5b9bb', rc: '#b0b3b4', fw: 'i:fw:soko' },
  { n: '白いパネル・荷さばきの庇', W: MW.panel('#f2f2ef'), wain: 0, rt: 'flat', RS: MR.flat('#cfd1d1'), bk: 2, bh: 'hi', dk: 3, dc: '#e0e2e2', pc: '#d8dad9', cn: '#e9e9e6', dock: true, stripe: '#5a6f86', fc: '#ecece9', rc: '#c4c6c6', fw: 'i:fw:soko' },
  { n: '水色のパネル・低い屋根', W: MW.panel('#c3d5e0'), wain: 0, rt: 'gable', p: 0.06, RS: MR.osky('#d2d5d6'), bk: 2, bh: 'hi', dk: 0, dc: '#d9dcdc', tr: '#9fb3bf', cn: '#d0d4d6', dock: true, fc: '#bccfdb', rc: '#c9cccd', fw: 'i:fw:soko' },
  { n: '赤レンガ倉庫', W: MW.brick, wain: 0, rt: 'gable', p: 0.42, RS: MR.kawara, bk: 7, bh: 'lo', dk: 9, dc: '#ffffff', tr: '#4a4a48', fc: '#94563f', rc: '#5f646b', fw: 'i:fw:koba', ms: 22 },
  { n: 'クリーム角波・錆色屋根', W: MW.kaku('#eadfc2'), wain: 1.0, rt: 'gable', p: 0.2, RS: MR.orib('#8e4434'), bk: 2, bh: 'hi', dk: 0, dc: '#ddd3b8', tr: '#6e3428', fc: '#e0d5b8', rc: '#8a4232', fw: 'i:fw:soko' },
  { n: 'かまぼこ屋根の倉庫', W: MW.paint('#c9ccc8'), wain: 1.0, rt: 'barrel', p: 0.2, RS: MR.orib('#9ea3a3'), bk: 2, bh: 'hi', dk: 1, dc: '#bfc4c2', tr: '#7e8483', fc: '#c2c5c1', rc: '#9ea3a3', fw: 'i:fw:koba' },
  { n: '黒い板張りの古い倉庫', W: MW.yaki, wain: 0.6, rt: 'gable', p: 0.38, RS: MR.kawara, bk: 4, bh: 'lo', dk: 8, dc: '#ffffff', tr: '#2a2826', fc: '#3a3633', rc: '#5f646b', fw: 'i:fw:koba', ms: 20 },
  { n: 'ベージュ壁・こげ茶屋根', W: MW.panel('#ddd2bb'), wain: 0, rt: 'gable', p: 0.1, RS: MR.orib('#5d544c'), bk: 2, bh: 'hi', dk: 0, dc: '#cfc5ae', tr: '#4d453e', cn: '#5d544c', dock: true, fc: '#d6cbb3', rc: '#5d544c', fw: 'i:fw:soko' },
  { n: '石造りの蔵', W: MW.stone, wain: 0, rt: 'gable', p: 0.45, RS: MR.kawara, bk: 7, bh: 'lo', dk: 8, dc: '#ffffff', tr: '#3a3a38', fc: '#c4b998', rc: '#5f646b', fw: 'i:fw:koba', ms: 18 },
  { n: '緑のトタン・錆すじ', W: MW.paintR('#8fa596'), wain: 0.8, rt: 'gable', p: 0.22, RS: MR.orust('#a4b0a6'), bk: 4, bh: 'lo', dk: 1, dc: '#8aa092', tr: '#4f6355', fc: '#899f90', rc: '#7a8a7e', fw: 'i:fw:koba' }
];
// 冷凍倉庫：窓のない 断熱パネルの箱
const COLD = [
  { n: '白いパネル・黒い搬入口', W: MW.panel('#f4f4f1'), wain: 0, rt: 'flat', RS: MR.flat('#d2d4d4'), dk: 3, dc: '#e4e6e6', pc: '#dcdedd', cn: '#e9e9e6', dock: true, nowin: true, fc: '#efefec', rc: '#c8caca', fw: 'i:fw:soko' },
  { n: '銀パネル・低い屋根', W: MW.panel('#c9cdd0'), wain: 0, rt: 'gable', p: 0.05, RS: MR.orib('#c3c6c8'), dk: 3, dc: '#d0d3d5', tr: '#a9adb0', cn: '#b9bcbe', dock: true, nowin: true, fc: '#c5c9cc', rc: '#bdc0c2', fw: 'i:fw:soko' },
  { n: '白いパネル・紺の帯', W: MW.panel('#f1f1ee'), wain: 0, rt: 'flat', RS: MR.flat('#cdd0d0'), dk: 3, dc: '#e4e6e6', pc: '#2c4466', stripe: '#2c4466', cn: '#e9e9e6', dock: true, nowin: true, fc: '#eaeae7', rc: '#c4c6c6', fw: 'i:fw:soko' },
  { n: 'クリーム壁・茶色の帯', W: MW.panel('#ebe4d0'), wain: 0, rt: 'flat', RS: MR.flat('#cfcfcb'), dk: 3, dc: '#e0dccd', pc: '#6b4f3c', stripe: '#6b4f3c', cn: '#e4dece', dock: true, nowin: true, fc: '#e6dfca', rc: '#c6c6c2', fw: 'i:fw:soko' },
  { n: '水色のパネル・白い庇', W: MW.panel('#bcd3df'), wain: 0, rt: 'flat', RS: MR.flat('#d3d5d5'), dk: 3, dc: '#e4e6e6', pc: '#e9eceb', cn: '#f0f0ee', dock: true, nowin: true, fc: '#b8cfdb', rc: '#c9cbcb', fw: 'i:fw:soko' }
];
const sokoH = (f, R, ko) => (ko.cold ? 7.5 : 7 + 1.6 * R()) + (Math.max(1, f) - 1) * (ko.cold ? 6.5 : 5.2);
// 荷さばき：高床・庇・シャッター・トラック（辺 e のまわり）
function dock(B, P, L, e, H, f, o = {}) {
  const lod = P.lod, R = P.rng, hp = 1.1, dep = 3.2, nd = cl(Math.floor((e.L - 4) / 5.2), 1, lod >= 2 ? 18 : 6), st = (e.L - 4) / nd, cy = Math.min(H / f - 0.6, 5.6);
  if (lod < 1) return;
  for (let i = 0; i < nd; i++) door(B, e, 2 + st * (i + 0.5), Math.min(3.4, st - 1.2), hp, Math.min(3.6, cy - hp - 0.4), L.dk, col(L.dc));
  // 高床（コンクリート）と 庇
  const a = ePt(e, 1, 0), b = ePt(e, e.L - 1, 0), c2 = ePt(e, e.L - 1, dep), d = ePt(e, 1, dep);
  const box4 = (p, y0, y1, cc) => { B.wall('c', p[0][0], p[0][1], p[1][0], p[1][1], y0, y1, cc); B.wall('c', p[1][0], p[1][1], p[2][0], p[2][1], y0, y1, cc); B.wall('c', p[2][0], p[2][1], p[3][0], p[3][1], y0, y1, cc); B.wall('c', p[3][0], p[3][1], p[0][0], p[0][1], y0, y1, cc); B.quad('c', [p[0][0], y1, p[0][1]], [p[1][0], y1, p[1][1]], [p[2][0], y1, p[2][1]], [p[3][0], y1, p[3][1]], null, cc); };
  box4([d, c2, b, a], 0.02, hp, col('#bdbbb4'));
  const e2 = ePt(e, 0.5, 0), f2 = ePt(e, e.L - 0.5, 0), g2 = ePt(e, e.L - 0.5, dep + 2.2), h2 = ePt(e, 0.5, dep + 2.2);
  box4([h2, g2, f2, e2], cy, cy + 0.35, col(L.cn || '#d6d8d8'));
  if (lod < 2) return;
  // バックで つけた トラック
  const ang = Math.atan2(e.nz, e.nx), nt = Math.min(nd, Math.ceil(nd * 0.4));
  for (let i = 0; i < nd; i++) { if (R() > nt / nd) continue; const t = 2 + st * (i + 0.5), L2 = o.small ? 6.2 : 8.5, p = ePt(e, t, dep + L2 / 2 + 0.2); truck(B, p[0], p[1], ang, { L: L2, cab: A.pick(R, ['#eceeee', '#e2e4e4', '#d8dcdf', '#3f5f8a']), box: '#ececea', bh: o.small ? 3.0 : 3.5 }); }
  for (let i = 0; i < 3; i++) { const p = ePt(e, 2 + (e.L - 4) * R(), 0.6); pallets(B, p[0], p[1], eAng(e), 1 + (R() * 2 | 0), R); }
}
A.arch('i_soko', {
  looks: SOKO,
  far(L, P) { const f = Math.max(1, P.f), H = sokoH(f, P.rng, P.ko || {}); return { H, base: 0, wall: L.fw || 'i:fw:soko', bw: 4, fh: f >= 2 ? H / f : H, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: L.rt === 'flat' ? 'flat' : 'gable', p: Math.min(0.3, L.p || 0.15), ins: 1, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, ko = P.ko, f = Math.max(1, P.f), H = sokoH(f, R, ko), fr = P.front || [0, 1];
    const LL = ko.cold || L.nowin ? Object.assign({}, L, { bk: L.nowin ? null : L.bk }) : L;
    if (F.n <= 6 || F.rects.length > 1) {   // 小さな倉庫：棟 1つ
      const I = A.inset(F, 0.8), fe = A.frontEdge(I, fr);
      pave(B, P, F, 'i:cpad');
      shed(B, P, LL, I, H, { fe, f, multi: f >= 2, ms: L.ms });
      if (lod >= 2 && fe.L > 8) { const p = ePt(fe, fe.L * 0.25, 4); if (R() < 0.6) kei(B, p[0], p[1], eAng(fe) + PI / 2, '#efefec'); else forklift(B, p[0], p[1], eAng(fe)); }
      return;
    }
    const R0 = inR(F.rects[0], 1.0), fm = frame(R0, fr), Wd = fm.W, D = fm.D;
    pave(B, P, F, 'i:asph');
    const cross = !!ko.cross, market = !!ko.market;
    let yd = D > 28 ? cl(D * (cross ? 0.3 : 0.26), 12, 36) : 0, bd = D - yd;
    if (cross) bd = cl(D * 0.35, 18, 45);
    const nb = cl(Math.round(Wd / 170), 1, 3), gap = 14, bw = (Wd - gap * (nb - 1)) / nb;
    for (let i = 0; i < nb; i++) {
      const u0 = i * (bw + gap), v0 = cross ? yd : yd, G = RF(fm.r(u0, v0, u0 + bw, v0 + bd)), fe = G.edges[fm.fi], be = G.edges[(fm.fi + 2) % 4];
      const Hs = market ? H + 2 : H;
      if (market) marketHall(B, P, LL, G, Hs, fe);
      else {
        const dk = !!(L.dock || ko.dock || ko.cold || cross);
        shed(B, P, dk ? Object.assign({}, LL, { dk: L.dock || ko.cold || cross ? 3 : L.dk }) : LL, G, Hs, { fe: dk ? null : fe, f, multi: f >= 2, ms: L.ms, dside: !dk });
        if (dk) { dock(B, P, L, fe, Hs, f, { small: ko.small }); if (cross) dock(B, P, L, be, Hs, f, { small: ko.small }); }
      }
      if (ko.cold && lod >= 2) for (let k = 0; k < Math.min(6, (bw / 12) | 0); k++) { const q = fm.p(u0 + 6 + k * 10, v0 + bd - 6); B.box('c', q[0] - 2, q[1] - 1.2, q[0] + 2, q[1] + 1.2, Hs + 0.6, Hs + 2.2, col('#d9dcdc')); for (const dx of [-1, 1]) B.cyl('c', q[0] + dx, q[1], 0.7, Hs + 2.2, Hs + 2.35, 8, col('#3a3d40')); }
    }
    if (lod >= 2) {   // 広場：とまっているトラック・車
      const nt = cl(Math.round(Math.sqrt(F.area) / 22), 1, 8);
      for (let i = 0; i < nt; i++) { const u = 8 + (Wd - 16) * (i + 0.5) / nt, q = fm.p(u, Math.max(5, yd * 0.45)); if (yd > 14) (R() < 0.5 && !ko.small ? trailer : truck)(B, q[0], q[1], fm.ua + (R() < 0.5 ? 0 : PI), { cab: A.pick(R, ['#e8eaea', '#d9dcdc', '#5a7896', '#e8eaea']), box: A.pick(R, ['#e9e9e6', '#d8d9d6', '#c0c4c6']) }); }
      if (cross && D - yd - bd > 14) for (let i = 0; i < nt; i++) { const q = fm.p(8 + (Wd - 16) * (i + 0.5) / nt, yd + bd + (D - yd - bd) * 0.55); trailer(B, q[0], q[1], fm.ua + (R() < 0.5 ? 0 : PI), { box: A.pick(R, ['#e9e9e6', '#c0c4c6', '#8a3a2a', '#2f4f78']) }); }
      if (yd > 10) parkLot(B, fm, 2, 1.2, Math.min(Wd * 0.35, 40), 6.4, R, lod, 0.6);
      fence(B, F, 1.8, W1, 12, A.frontEdge(F, fr));
      const gp = fm.p(Wd / 2 + 9, 3); B.box('c', gp[0] - 1.3, gp[1] - 1.3, gp[0] + 1.3, gp[1] + 1.3, 0.04, 2.6, col('#e9e7e1'));   // 守衛所
    }
  }
});
// 卸売市場の棟：まわりは 低い壁と あいた入口（中が暗い）。中に 小さな車
function marketHall(B, P, L, G, H, fe) {
  const lod = P.lod, R = P.rng;
  if (lod <= 0) return lowShed(B, P, G, H, L);
  for (const e of G.edges) {
    const n = cl(Math.round(e.L / 9), 1, lod >= 2 ? 16 : 6);
    for (let i = 0; i < n; i++) { const a = e.L * i / n, b = e.L * (i + 1) / n; door(B, e, (a + b) / 2, b - a - 1.2, 0, 4.8, 4, W1, 0.02); }
    clad(B, e, 0, e.L, 4.8, H, L.W, 1); if (lod >= 2) for (let i = 0; i <= n; i++) { const p0 = ePt(e, e.L * i / n - 0.3, 0.12), p1 = ePt(e, e.L * i / n + 0.3, 0.12); B.wall('c', p0[0], p0[1], p1[0], p1[1], 0, 4.8, col('#b5b7b5')); }
  }
  roofs(B, G, H, L.RS, L.W, { t: L.rt === 'flat' ? 'gable' : L.rt, p: 0.12, lod, tr: L.tr, ms: 40 });
  if (lod >= 2) { const e = fe; for (let i = 0; i < 6; i++) { const p = ePt(e, e.L * (0.1 + 0.8 * R()), 2.5 + R() * 6); B.obox('c', p[0], p[1], R() * PI, 2.4, 1.2, 0.3, 1.3, A.pick(R, ['#3f6aa0', '#d9a12b', '#5a8a4a']), {}); } }
}

/* ---------- 大きな工場（i_plant） ----------
   事務所・駐車場・棟いくつか ＋ 種類ごとの設備（P.ko：clean 白い箱・tanks タンク・silo サイロ・chim 煙突・pile 山・scrap くず鉄・cars 完成車・rail 線路・multi 何階も） */
const PLANT = [
  { n: '白いパネル・青い帯', W: MW.panel('#f3f3f0'), wain: 0, rt: 'flat', RS: MR.flat('#cdd0d0'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#2f6aa8', stripe: '#2f6aa8', fc: '#eeeeeb', rc: '#c4c7c7', fw: 'i:fw:soko', ofc: true, tc: '#f2f2ef', ck: 3 },
  { n: '銀の折板・明かり取り', W: MW.galv, wain: 1.2, rt: 'gable', p: 0.1, RS: MR.osky('#c6c9ca'), bk: 2, bh: 'hi', dk: 0, dc: '#c9cccb', tr: '#9a9d9e', fc: '#b7bbbd', rc: '#bdc0c1', fw: 'i:fw:koba', tc: '#d9dcdd', ck: 1 },
  { n: 'スレート・のこぎり屋根', W: MW.slate, wain: 1.0, rt: 'saw', RS: MR.slate, bk: 1, bh: 'lo', dk: 1, dc: '#9aa3a0', tr: '#6f7472', fc: '#a6a7a2', rc: '#8e908c', fw: 'i:fw:koba', tc: '#c9c9c4', ck: 1 },
  { n: 'クリームの外壁・緑の屋根', W: MW.kaku('#ebe2c8'), wain: 0.9, rt: 'gable', p: 0.14, RS: MR.orib('#5c7a66'), bk: 2, bh: 'hi', dk: 0, dc: '#e0d8be', tr: '#4b6354', fc: '#e2d9be', rc: '#5c7a66', fw: 'i:fw:soko', tc: '#ece6d4', ck: 1 },
  { n: '灰色パネル・ガラス事務所', W: MW.panel('#c9cdcf'), wain: 0, rt: 'gable', p: 0.06, RS: MR.orib('#a9adaf'), bk: 3, bh: 'hi', dk: 3, dc: '#d4d7d8', tr: '#8f9497', stripe: '#59646c', fc: '#c4c8ca', rc: '#a9adaf', fw: 'i:fw:soko', glass: true, tc: '#d8dbdc', ck: 3 },
  { n: 'レンガと鉄骨の工場', W: MW.brick, wain: 0, rt: 'gable', p: 0.3, RS: MR.slate, bk: 7, bh: 'lo', dk: 9, dc: '#ffffff', tr: '#4a4a48', fc: '#94563f', rc: '#8e908c', fw: 'i:fw:koba', tc: '#c9c6bd', ck: 2, ms: 22 }
];
const plantH = (f, R) => f <= 1 ? 9 + 2 * R() : f === 2 ? 12.5 + 2 * R() : 4.8 * f + 1.5 * R();
// 電車（車両工場）：長さ 20m の箱
function railcar(B, x, z, ang, y = 0.15) {
  const L = 20, Wd = 2.9, c = Math.cos(ang), s = Math.sin(ang), P = (u, w) => [x + c * u - s * w, z + s * u + c * w], [v0, v1] = SV(7, 8, 0.03);
  const a = P(-L / 2, -Wd / 2), b = P(L / 2, -Wd / 2), q = P(L / 2, Wd / 2), d = P(-L / 2, Wd / 2), y0 = y + 0.9, y1 = y + 4.0;
  B.wall('i:veh', a[0], a[1], b[0], b[1], y0, y1, W1, [0, 1, v0, v1]); B.wall('i:veh', q[0], q[1], d[0], d[1], y0, y1, W1, [0, 1, v0, v1]);
  B.wall('c', b[0], b[1], q[0], q[1], y0, y1, [0.75, 0.77, 0.78]); B.wall('c', d[0], d[1], a[0], a[1], y0, y1, [0.75, 0.77, 0.78]);
  B.quad('c', [a[0], y1, a[1]], [b[0], y1, b[1]], [q[0], y1, q[1]], [d[0], y1, d[1]], null, [0.55, 0.57, 0.58]);
  B.obox('c', x, z, ang, L - 3, Wd - 0.6, y, y0, [0.2, 0.2, 0.2], {});
}
// 線路（u0〜u1 を v にそって：frame で）
function track(B, fm, u, v0, v1, y = 0.06) {
  const P = (uu, vv, h) => { const q = fm.p(uu, vv); return [q[0], y + h, q[1]]; };
  B.quad('c', P(u - 1.6, v0, 0), P(u + 1.6, v0, 0), P(u + 1.6, v1, 0), P(u - 1.6, v1, 0), null, [0.5, 0.47, 0.43]);
  for (const o of [-0.72, 0.72]) B.quad('c', P(u + o - 0.05, v0, 0.16), P(u + o + 0.05, v0, 0.16), P(u + o + 0.05, v1, 0.16), P(u + o - 0.05, v1, 0.16), null, [0.32, 0.3, 0.28]);
}
// 設備のます：タンク（n 本）
function tankYard(B, r, n, c, lod, R, o = {}) {
  const W = rw(r), D = rd(r), rr = o.r || cl(Math.sqrt(W * D / n) * 0.3, 1.6, o.tall ? 3.2 : 7), h = o.h || rr * (o.tall ? 5 : 2.2), sp = rr * 2.6;
  const nx = Math.max(1, Math.floor(W / sp)), nz = Math.max(1, Math.floor(D / sp)); let k = 0;
  for (let j = 0; j < nz && k < n; j++) for (let i = 0; i < nx && k < n; i++, k++) { const cx = r[0] + (W - nx * sp) / 2 + sp * (i + 0.5), cz = r[1] + (D - nz * sp) / 2 + sp * (j + 0.5); tank(B, cx, cz, rr, h, col(c), o.t || (rr < 3 ? 'dome' : 'cone'), lod, o.y0 || 0); if (o.legs && lod >= 1) fan(B, cx, cz, rr, o.y0 || 0, 0.2, lod >= 2 ? 8 : 4, [0.6, 0.62, 0.62]); }
  if (lod >= 1 && nx * nz > 1) pipeRack(B, r[0] + 1, (r[1] + r[3]) / 2, r[2] - 1, (r[1] + r[3]) / 2, Math.min(h * 0.6, 7), 2.5, lod);
}
// 設備のます（kind に合わせて）
function equipCell(B, P, L, fm, c, kind, R) {
  const lod = P.lod, r = fm.r(c.u0, c.v0, c.u1, c.v1), ko = P.ko;
  if (kind === 'tanks') tankYard(B, inR(r, 2), Math.min(ko.tanks || 6, lod >= 2 ? 12 : 8), ko.stain ? '#cfd3d6' : L.tc || '#eeeeea', lod, R, { t: ko.stain ? 'dome' : null, tall: ko.stain, y0: ko.stain ? 1.5 : 0, legs: ko.stain });
  else if (kind === 'silo') { const rr = cl(Math.min(rw(r), rd(r)) / 8, 3, 5.5), nx = cl(Math.floor((rw(r) - 4) / (rr * 2.02)), 1, 6), nz = cl(Math.floor((rd(r) - 4) / (rr * 2.02)), 1, 3); silos(B, r[0] + 2, r[1] + 2, nx, nz, rr, ko.siloH || 30, lod, W1); }
  else if (kind === 'pile') { const n = cl(Math.round(rw(r) / 30), 1, 3); for (let i = 0; i < n; i++) pile(B, [r[0] + 2 + i * rw(r) / n, r[1] + 3, r[0] + (i + 1) * rw(r) / n - 2, r[3] - 3], cl(Math.min(rw(r) / n, rd(r)) * 0.25, 3, 14), col(ko.pileC || '#b39b72')); if (lod >= 2) { const q = fm.p((c.u0 + c.u1) / 2, c.v0 + 2); B.obox('c', q[0], q[1], fm.ua, 6, 2.6, 0.04, 3.4, '#d9a12b', {}); } }
  else if (kind === 'scrap') { for (let i = 0; i < 3; i++) { const a = c.u0 + (c.u1 - c.u0) * i / 3; pile(B, fm.r(a + 2, c.v0 + 3, a + (c.u1 - c.u0) / 3 - 2, c.v1 - 4), cl(rd(r) * 0.15, 2.5, 7), col(A.pick(R, ['#6e6258', '#7a6a5c', '#5f5b57']))); }
    if (lod >= 1) { const q = fm.p(c.u0 + 6, c.v1 - 6); latTower(B, q[0], q[1], 1.6, 1.6, 0, 12, W1); beam(B, 'c', [q[0], 12, q[1]], [q[0] + 14 * Math.cos(fm.ua), 9, q[1] + 14 * Math.sin(fm.ua)], 0.8, 0.8, col('#d9a12b')); } }
  else if (kind === 'cars') parkLot(B, fm, c.u0 + 2, c.v0 + 2, c.u1 - 2, c.v1 - 2, R, lod, 0.97);
  else if (kind === 'yard' && lod >= 2) yardProps(B, fm, c.u0, c.v0, c.u1, c.v1, R);
}
A.arch('i_plant', {
  looks: PLANT,
  far(L, P) { const f = Math.max(1, P.f), H = plantH(f, P.rng); return { H, base: 0, wall: (P.ko || {}).clean ? 'i:fw:soko' : L.fw, bw: 4, fh: f >= 2 ? H / f : H, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: L.rt === 'flat' || (P.ko || {}).clean ? 'flat' : 'gable', p: 0.12, ins: 2, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, ko = P.ko, f = Math.max(1, P.f), H = plantH(f, R), fr = P.front || [0, 1];
    const Lc = ko.clean ? Object.assign({}, L, { bk: L.bk === 7 ? 7 : 3, bh: 'lo', rt: L.rt === 'saw' || L.rt === 'barrel' ? 'flat' : L.rt, wain: 0 }) : L;
    if (F.n < 16 || F.rects.length > 1) {   // 小さな区画：棟 1つ
      const I = A.inset(F, 1.0), fe = A.frontEdge(I, fr); pave(B, P, F, 'i:cpad');
      const top = shed(B, P, Lc, I, H, { fe, ow: fe.L > 14 ? cl(fe.L * 0.25, 4, 9) : 0, f, multi: f >= 2, ms: L.ms });
      if (ko.chim && lod >= 0) { const r = I.rects[0]; chimney(B, r[2] - 3, r[1] + 3, 1.2, Math.max(top + 12, 25), L.ck, lod); }
      return;
    }
    const pl = plan(P, { ck: ko.long ? 0.7 : 0.5, maxU: ko.long ? 2 : 3 }), fm = pl.fm; pave(B, P, F, 'i:asph');
    // ますの 役わり：設備（奥がわ）と 棟
    const eqK = ko.silo ? 'silo' : ko.tanks ? 'tanks' : ko.pile ? 'pile' : ko.scrap ? 'scrap' : ko.cars ? 'cars' : null;
    const nc = pl.cells.length, nEq = eqK ? cl(Math.round(nc * 0.34), 1, eqK === 'silo' || eqK === 'cars' ? 1 : 2) : (nc >= 4 && R() < 0.5 ? 1 : 0);
    const order = pl.cells.map((c, i) => i).sort((a, b) => pl.cells[b].v0 - pl.cells[a].v0 || (R() - 0.5));
    const eq = new Set(order.slice(0, nEq)); let big = null, nb = 0;
    for (let i = 0; i < nc; i++) {
      const c = pl.cells[i];
      if (eq.has(i)) { if (lod >= 1 || eqK === 'silo') equipCell(B, P, L, fm, c, eqK || 'yard', R); continue; }
      if (lod <= 0 && nb >= 3) continue; nb++;
      const G = RF(fm.r(c.u0, c.v0, c.u1, c.v1)), Hs = H + (c.a > 2500 ? 2 : 0);
      const top = shed(B, P, Lc, G, Hs, { fe: G.edges[fm.fi], f, multi: f >= 2, dside: true, ms: L.ms });
      if (!big || c.a > big.c.a) big = { c, G, top };
      if (ko.clean && lod >= 2) { const rr = G.rects[0]; for (let k = 0; k < 3; k++) { const x = rr[0] + rw(rr) * (0.2 + 0.6 * R()), z = rr[1] + rd(rr) * (0.2 + 0.6 * R()); B.box('c', x - 3, z - 1.2, x + 3, z + 1.2, top, top + 1.8, col('#cfd2d2')); } }
      if (ko.rail && lod >= 1) { const uu = (c.u0 + c.u1) / 2; track(B, fm, uu, 0.5, c.v1 - 1, 0.06); if (lod >= 2) { const q = fm.p(uu, c.v0 - 12); railcar(B, q[0], q[1], fm.fa, 0.2); } }
    }
    if (ko.chim && big) { const r = big.G.rects[0], n = ko.chim > 1 ? 2 : 1; for (let k = 0; k < n; k++) chimney(B, r[2] - 4 - k * 8, r[1] + 4, ko.chimR || 2, ko.chimH || Math.max(big.top + 25, 45), L.ck, lod); }
    if (pl.fz > 0 && lod >= 1) {   // 事務所と駐車場
      const ow2 = cl(pl.Wd * 0.28, 12, 40), od = cl(pl.fz - 3, 7, 14), G = RF(fm.r(2, 1.5, 2 + ow2, 1.5 + od));
      office(B, P, G, f >= 3 ? 4 : 3, 3.6, Object.assign({}, L, { ofc: L.ofc || L.glass }), G.edges[fm.fi]);
      parkLot(B, fm, 6 + ow2, 1.2, pl.Wd - 2, Math.min(pl.fz - 1, 17), R, lod, 0.8);
      if (lod >= 2) { fence(B, F, 1.8, W1, 12, A.frontEdge(F, fr)); trees(B, fm, pl.Wd, R, 0.6, 5); if (ko.trucks || ko.clean) for (let i = 0; i < 4; i++) { const q = fm.p(pl.Wd * (0.3 + 0.15 * i), pl.fz - 3); truck(B, q[0], q[1], fm.ua, { L: 6.5, box: '#f0f0ee', bh: 3.0 }); } }
    }
  }
});

/* ---------- 飛行機（ふつうの形：機体・主翼・尾翼・エンジン） ----------
   L：全長 m・c：機体の色・ct：尾翼の色。ang：機首の向き */
function plane(B, x, z, ang, L, c, ct, lod, y = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang), P = (u, h, w) => [x + ca * u - sa * w, y + h, z + sa * u + ca * w], r = L * 0.055, hc = r + L * 0.04, n = lod >= 2 ? 8 : 5, cc = col(c), ctc = col(ct || c);
  for (let i = 0; i < n; i++) {   // 胴体（まん中は 円柱・前と うしろは すぼまる）
    const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2, q0 = [Math.cos(t0) * r, Math.sin(t0) * r], q1 = [Math.cos(t1) * r, Math.sin(t1) * r], k = Math.sin((t0 + t1) / 2) < -0.3 ? 0.85 : 1;
    B.quad('c', P(-L * 0.32, hc + q0[1], q0[0]), P(L * 0.36, hc + q0[1], q0[0]), P(L * 0.36, hc + q1[1], q1[0]), P(-L * 0.32, hc + q1[1], q1[0]), null, mul(cc, k));
    B.quad('c', P(L * 0.36, hc + q0[1], q0[0]), P(L * 0.5, hc + q0[1] * 0.35 - r * 0.1, q0[0] * 0.35), P(L * 0.5, hc + q1[1] * 0.35 - r * 0.1, q1[0] * 0.35), P(L * 0.36, hc + q1[1], q1[0]), null, mul(cc, k));
    B.quad('c', P(-L * 0.32, hc + q0[1], q0[0]), P(-L * 0.5, hc + r * 0.55 + q0[1] * 0.3, q0[0] * 0.3), P(-L * 0.5, hc + r * 0.55 + q1[1] * 0.3, q1[0] * 0.3), P(-L * 0.32, hc + q1[1], q1[0]), null, mul(cc, k));
  }
  if (lod >= 2) B.quad('c', P(L * 0.43, hc + r * 0.45, -r * 0.5), P(L * 0.47, hc + r * 0.2, -r * 0.4), P(L * 0.47, hc + r * 0.2, r * 0.4), P(L * 0.43, hc + r * 0.45, r * 0.5), null, [0.15, 0.18, 0.2]);   // 操縦席の窓
  const sp = L * 0.48, wr = L * 0.17, sw = L * 0.13;   // 主翼（うしろへ 少し）
  for (const sg of [-1, 1]) {
    B.quad('c', P(L * 0.08, hc - r * 0.3, sg * r * 0.8), P(L * 0.08 - sw, hc - r * 0.15, sg * sp), P(L * 0.08 - sw - wr * 0.35, hc - r * 0.15, sg * sp), P(L * 0.08 - wr, hc - r * 0.3, sg * r * 0.8), null, mul(cc, 0.95));
    B.quad('c', P(-L * 0.36, hc + r * 0.3, sg * r * 0.5), P(-L * 0.44, hc + r * 0.35, sg * L * 0.17), P(-L * 0.48, hc + r * 0.35, sg * L * 0.17), P(-L * 0.47, hc + r * 0.3, sg * r * 0.5), null, mul(cc, 0.95));
    if (L > 20) { const ex = L * 0.02, ew = sg * L * 0.16; hcylA(B, P, ex, hc - r * 1.05, ew, r * 0.42, L * 0.11, lod >= 2 ? 6 : 4, mul(cc, 0.8)); }
  }
  B.quad('c', P(-L * 0.34, hc + r * 0.6, 0), P(-L * 0.5, hc + r * 0.6 + L * 0.16, 0), P(-L * 0.55, hc + r * 0.6 + L * 0.16, 0), P(-L * 0.49, hc + r * 0.6, 0), null, ctc);   // たての尾翼
  if (lod >= 2) for (const u of [L * 0.3, -L * 0.02]) for (const sg of (u > 0 ? [0] : [-1, 1])) B.box('c', ...(() => { const q = P(u, 0, sg * r * 0.9); return [q[0] - 0.2, q[2] - 0.2, q[0] + 0.2, q[2] + 0.2]; })(), y, y + hc - r * 0.8, [0.2, 0.2, 0.2]);   // 脚
}
function hcylA(B, P, u, h, w, r, L, n, c) { for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.quad('c', P(u - L / 2, h + Math.sin(t0) * r, w + Math.cos(t0) * r), P(u + L / 2, h + Math.sin(t0) * r, w + Math.cos(t0) * r), P(u + L / 2, h + Math.sin(t1) * r, w + Math.cos(t1) * r), P(u - L / 2, h + Math.sin(t1) * r, w + Math.cos(t1) * r), null, c); } }
// ヘリコプター
function heli(B, x, z, ang, c, lod) {
  const ca = Math.cos(ang), sa = Math.sin(ang), cc = col(c);
  B.obox('c', x, z, ang, 5.5, 2.2, 0.6, 3.0, cc, {}); B.obox('c', x - ca * 5, z - sa * 5, ang, 5, 0.6, 2.0, 2.6, cc, {}); B.obox('c', x - ca * 7.4, z - sa * 7.4, ang, 0.9, 0.2, 2.2, 3.9, cc, {});
  B.obox('c', x + ca * 1.8, z + sa * 1.8, ang, 1.5, 2.0, 1.4, 2.6, [0.2, 0.24, 0.28], {});
  for (const t of [0, PI / 2]) B.obox('c', x, z, ang + t + 0.4, 11, 0.4, 3.25, 3.32, [0.2, 0.2, 0.2], {});
  if (lod >= 2) for (const sg of [-1, 1]) B.obox('c', x - sa * sg * 1.2, z + ca * sg * 1.2, ang, 4.2, 0.15, 0.05, 0.2, [0.2, 0.2, 0.2], {});
}

/* ---------- 格納庫（i_hangar） ----------
   道がわの面は 大きな引き戸。横に 2階の事務所。前は コンクリートの エプロンと 飛行機 */
const HANGAR = [
  { n: '白いパネル・かまぼこ屋根', W: MW.panel('#f0f0ed'), rt: 'barrel', p: 0.16, RS: MR.orib('#c9cccc'), dc: '#e9eae8', fc: '#ececea', rc: '#c4c7c7', tr: '#b9bcbc', ln: '#dcdedd' },
  { n: 'グレーの波板・切妻屋根', W: MW.galv, rt: 'gable', p: 0.12, RS: MR.orib('#a9adae'), dc: '#c6c9c8', fc: '#b3b8ba', rc: '#a5a9aa', tr: '#8f9394', ln: '#c9cbca' },
  { n: '緑灰色の格納庫', W: MW.paint('#8d9a88'), rt: 'barrel', p: 0.22, RS: MR.orib('#66735f'), dc: '#7f8c7a', fc: '#87947f', rc: '#66735f', tr: '#55604f', ln: '#8d9a88' },
  { n: '白い外壁・青い扉', W: MW.alc('#efeeea'), rt: 'flat', RS: MR.flat('#cfd2d2'), dc: '#5d82ab', fc: '#e9e8e3', rc: '#c4c7c7', pc: '#3d5f86', ln: '#e3e1db' },
  { n: '銀色の折板・平らな屋根', W: MW.kaku('#cfd3d6'), rt: 'flat', RS: MR.flat('#bfc2c3'), dc: '#d0d3d5', fc: '#c9cdd0', rc: '#b9bcbd', pc: '#a9adb0', ln: '#d6d9db' },
  { n: 'クリーム壁・こげ茶屋根', W: MW.kaku('#e8dfc6'), rt: 'gable', p: 0.14, RS: MR.orib('#5c524a'), dc: '#ddd5bd', fc: '#e0d7bd', rc: '#5c524a', tr: '#4a423c', ln: '#ddd5bd' }
];
const hangarH = (F, R) => cl(Math.sqrt(F ? F.area : 1600) * 0.17, 10, 26) + R() * 2;
function hangarBody(B, P, L, G, H, fe, o = {}) {
  const lod = P.lod, R = P.rng;
  if (lod <= 0) return lowShed(B, P, G, H, Object.assign({ fw: 'i:fw:soko' }, L, { rt: L.rt === 'barrel' ? 'barrel' : L.rt }));
  if (lod === 1) farWalls(B, G, 0, H, 'i:fw:soko', col(L.fc), H); else for (const e of G.edges) clad(B, e, 0, e.L, 0, H, L.W, 0.82);
  // 大きな引き戸（前の面いっぱい）
  const dh = Math.min(H - 1.5, H * 0.82);
  door(B, fe, fe.L / 2, fe.L - 2.4, 0, dh, 10, col(L.dc), 0.1);
  if (lod >= 2) { for (let i = 0; i < 2; i++) { const p = ePt(fe, i ? fe.L - 0.6 : 0.6, 0.6); B.box('c', p[0] - 0.6, p[1] - 0.6, p[0] + 0.6, p[1] + 0.6, 0, dh + 0.5, mul(col(L.dc), 0.8)); } }
  for (const e of G.edges) if (e !== fe && e.L > 8) { if (lod >= 2) band(B, e, 1, e.L - 1, H - 2.6, H - 1.2, 2, 3); if (lod >= 2 && R() < 0.6) door(B, e, e.L * 0.25, 1.0, 0, 2.1, 7, W1); }
  return roofs(B, G, H, L.RS, lod >= 2 ? L.W : { m: 'i:fw:soko', su: 4, sv: H, c: col(L.fc) }, { t: L.rt, p: L.p, lod, tr: L.tr, pc: L.pc ? col(L.pc) : mul(L.W.c || W1, 0.85), ms: 70, ax: o.ax });
}
A.arch('i_hangar', {
  looks: HANGAR,
  far(L, P) { const H = 12 + P.rng() * 2; return { H, base: 0, wall: 'i:fw:soko', bw: 4, fh: H, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: L.rt === 'flat' ? 'flat' : 'gable', p: 0.15, ins: 3, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], H = hangarH(F, R);
    pave(B, P, F, 'i:cpad', col('#dad8d2'));
    if (F.rects.length > 1) { const I = A.inset(F, 1.5), fe = A.frontEdge(I, fr); hangarBody(B, P, L, I, H, fe); return; }
    const R0 = inR(F.rects[0], 1.5), fm = frame(R0, fr), Wd = fm.W, D = fm.D, ap = D > 40 ? cl(D * 0.32, 12, 60) : 0;
    const G = RF(fm.r(Wd > 50 ? 7 : 0, ap, Wd, D)), fe = G.edges[fm.fi];
    hangarBody(B, P, L, G, H, fe, { ax: fm.s === 'S' || fm.s === 'N' ? 'z' : 'x' });
    if (Wd > 50 && lod >= 1) { const G2 = RF(fm.r(0, ap + 2, 6.5, Math.min(D, ap + 40))); office(B, P, G2, 2, 3.4, { ow: L.ln, pc: L.ln }, G2.edges[fm.fi]); }
    if (lod >= 2 && ap > 12) {   // エプロンの飛行機・線
      const q = fm.p(Wd / 2, ap * 0.5), pl = cl(Math.min(Wd * 0.6, ap * 1.2), 10, 38);
      if (pl < 16) heli(B, q[0], q[1], fm.fa + PI, A.pick(R, ['#e9eaea', '#6f7c6a', '#d9dcdc']), lod); else plane(B, q[0], q[1], fm.fa, pl, A.pick(R, ['#eeeeec', '#d9dcde', '#a9b0b5']), A.pick(R, ['#3f5f86', '#8a3a33', '#5a6a5a', '#eeeeec']), lod, 0.05);
      for (let i = 0; i < 2; i++) { const a = fm.p(Wd * (0.25 + 0.5 * i), 1), b = fm.p(Wd * (0.25 + 0.5 * i), ap); B.quad('c', [a[0] - 0.12, 0.06, a[1] - 0.12], [a[0] + 0.12, 0.06, a[1] - 0.12], [b[0] + 0.12, 0.06, b[1] + 0.12], [b[0] - 0.12, 0.06, b[1] + 0.12], null, [0.86, 0.72, 0.28]); }
      fence(B, F, 2.2, W1, 16, A.frontEdge(F, fr));
    }
  }
});

/* ---------- タンク（i_tank）：燃料タンク・油槽所・石油基地 ----------
   防油堤（ひくい コンクリートの かこい）の中に タンク。ポンプの小屋・配管・事務所・ローリーの 積み場 */
const TANKL = [
  { n: '白い円筒タンク', tc: '#eeeeea', t: 'cone', fc: '#e6e6e2', rc: '#d9d9d5' },
  { n: '銀色のタンク', tc: '#c4c8cb', t: 'cone', fc: '#bcc0c3', rc: '#b2b6b9' },
  { n: 'うす緑のタンク', tc: '#c9d8c8', t: 'cone', fc: '#c2d1c1', rc: '#b5c4b4' },
  { n: '球形のガスタンク', tc: '#f0f0ec', t: 'sphere', fc: '#e8e8e4', rc: '#dcdcd8' },
  { n: 'クリーム色・浮き屋根', tc: '#ece5cf', t: 'flat', fc: '#e4dcc4', rc: '#cfc7b0' }
];
A.arch('i_tank', {
  looks: TANKL,
  far(L, P) { return { H: 9 + P.rng() * 4, base: 0, wall: 'c', roof: null, rc: col(L.rc), rt: 'flat', ins: 6, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], ko = P.ko, sea = !!ko.sea;
    pave(B, P, F, 'i:cpad', col('#cfcdc6'));
    const rs = F.rects, big = F.area > 6000, base = sea ? 1.2 : 0;
    // 区画の長方形ごとに タンクを ならべる（海がわは 桟橋）
    let n = 0;
    for (const r0 of rs) {
      const fm = frame(inR(r0, 2), fr), Wd = fm.W, D = fm.D, fz = D > 40 && r0 === rs[0] ? cl(D * 0.12, 8, 18) : 0, qz = sea && r0 === rs[0] ? cl(D * 0.22, 10, 40) : 0;
      const area = Wd * (D - fz - qz), rr = cl(Math.sqrt(area) * (big ? 0.16 : 0.2), 3, ko.oil ? 30 : 16), sp = rr * 2.5, nx = Math.max(1, Math.floor(Wd / sp)), nz = Math.max(1, Math.floor((D - fz - qz) / sp)), lim = lod >= 2 ? 10 : lod >= 1 ? 8 : 4;
      const h = L.t === 'sphere' ? 0 : cl(rr * (rr > 12 ? 0.75 : 1.4), 5, 24);
      // 防油堤
      if (lod >= 1) { const G = RF(fm.r(1, fz, Wd - 1, D - qz - 1)); for (const e of G.edges) { B.wallE('i:conc', e, 0.04, 1.4, W1, { uv: [e.u0 / 8, (e.u0 + e.L) / 8, 0, 1.4 / 8] }); B.wallE('c', e, 1.4, 1.4, [0.7, 0.7, 0.68]); } }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { if (n++ >= lim) continue; const q = fm.p((Wd - nx * sp) / 2 + sp * (i + 0.5), fz + (D - fz - qz - nz * sp) / 2 + sp * (j + 0.5)), rj = rr * (0.85 + 0.15 * R());
        if (L.t === 'sphere') sphereT(B, q[0], q[1], Math.min(rj, 11), col(L.tc), lod); else tank(B, q[0], q[1], rj, h, col(L.tc), L.t, lod); }
      if (lod >= 2 && nx * nz > 1) { const a = fm.p(2, fz + 2), b = fm.p(Wd - 2, fz + 2); pipeRack(B, a[0], a[1], b[0], b[1], 3.5, 2, lod); }
      if (fz > 0 && lod >= 1) { const G = RF(fm.r(2, 1, Math.min(18, Wd * 0.3), fz - 1.5)); office(B, P, G, 2, 3.3, { ow: '#e9e6de', pc: '#d0cdc6' }, G.edges[fm.fi]);
        if (lod >= 2) { const c0 = fm.p(Wd * 0.62, fz * 0.5); B.box('c', c0[0] - 9, c0[1] - 4, c0[0] + 9, c0[1] + 4, 5.2, 5.6, col('#e3e4e2')); for (const sg of [-1, 1]) B.box('c', c0[0] + sg * 8 - 0.3, c0[1] - 0.3, c0[0] + sg * 8 + 0.3, c0[1] + 0.3, 0, 5.2, col('#9a9c9c'));   // ローリーの積み場
          for (let k = 0; k < 2; k++) { const t = fm.p(Wd * 0.62 + (k - 0.5) * 7, fz * 0.5); tanker(B, t[0], t[1], fm.ua + PI / 2); } } }
      if (qz > 0) quay(B, P, fm, D - qz, D, Wd, base, { ship: 'tanker' });
    }
    if (lod >= 2) fence(B, F, 2.0, W1, 10, A.frontEdge(F, fr));
  }
});
function tanker(B, x, z, ang) {   // タンクローリー
  const c = Math.cos(ang), s = Math.sin(ang);
  B.obox('c', x + c * 3.6, z + s * 3.6, ang, 2.0, 2.3, 0.5, 2.8, col('#e9ebeb'), {});
  hcylA(B, (u, h, w) => [x + c * u - s * w, h, z + s * u + c * w], -1.2, 2.1, 0, 1.15, 7, 6, col('#d9dcde'));
}

/* ---------- 岸壁（海がわ v0〜v1：水面・岸壁・ボラード・船） ----------
   区画の 奥がわを 水面にする（地図の 海と つながる）。水面は 区画の中だけ */
A.tex('i:water', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#5d7c8c'); for (let i = 0; i < 260; i++) { const x = R() * w, y = R() * h, l = 4 + R() * 14; rect(g, x, y, l, 1, `rgba(${R() < 0.5 ? '210,226,232' : '40,60,72'},${(0.12 + R() * 0.2).toFixed(2)})`); }
  blots(g, 0, 0, w, h, 10, '30,50,60', 0.15, R, 0.2); PT.noise(g, 0, 0, w, h, 0.02, R);
}, { shiny: '#3a4448', sh: 50 });
function quay(B, P, fm, v0, v1, Wd, base, o = {}) {
  const lod = P.lod, R = P.rng, wy = -0.2, P3 = (u, v, y) => { const q = fm.p(u, v); return [q[0], y, q[1]]; };
  B.quad('i:water', P3(0, v0, wy + 0.25), P3(Wd, v0, wy + 0.25), P3(Wd, v1 + 1.4, wy + 0.25), P3(0, v1 + 1.4, wy + 0.25), null, W1, [0, v0 / 32, Wd / 32, v0 / 32, Wd / 32, (v1 + 1.4) / 32, 0, (v1 + 1.4) / 32]);
  // 岸壁（コンクリート）
  const a = fm.p(0, v0), b = fm.p(Wd, v0); B.wall('i:conc', b[0], b[1], a[0], a[1], wy, base + 0.04, W1, [0, Wd / 8, 0, (base + 0.3) / 8]);
  B.quad('c', P3(0, v0 - 0.6, base + 0.06), P3(Wd, v0 - 0.6, base + 0.06), P3(Wd, v0, base + 0.06), P3(0, v0, base + 0.06), null, [0.85, 0.75, 0.3]);
  if (lod >= 2) { const nb = Math.max(1, Math.floor(Wd / 18)); for (let i = 0; i < nb; i++) { const q = fm.p((i + 0.5) * Wd / nb, v0 - 1.2); B.cyl('c', q[0], q[1], 0.3, base, base + 0.7, 6, [0.25, 0.25, 0.25]); } }
  // 船
  if (o.ship && lod >= 1 && v1 - v0 > 12) { const L = Math.min(Wd * 0.8, (v1 - v0) * 6, o.ship === 'tanker' ? 160 : 140), q = fm.p(Wd / 2, v0 + Math.min((v1 - v0) * 0.5, L * 0.08 + 4)); ship(B, q[0], q[1], fm.ua, L, o.ship, lod, R); }
}
// 船（t：'tanker' | 'bulk' | 'cont' | 'navy' | 'ferry' | 'fish' | 'boat'）。L：長さ
function ship(B, x, z, ang, L, t, lod, R) {
  const Wd = L * (t === 'navy' ? 0.12 : t === 'fish' || t === 'boat' ? 0.3 : 0.16), Dh = L * (t === 'boat' ? 0.08 : 0.09), ca = Math.cos(ang), sa = Math.sin(ang), P = (u, h, w) => [x + ca * u - sa * w, h, z + sa * u + ca * w];
  const hull = col(t === 'navy' ? '#7d858c' : t === 'tanker' ? '#8a3a30' : t === 'ferry' || t === 'boat' ? '#f2f2ee' : t === 'fish' ? '#eeeeea' : '#3f5f7f'), deck = col(t === 'tanker' ? '#7a8a6a' : t === 'navy' ? '#6a7278' : '#a9a49a');
  const y0 = -0.1, y1 = Dh * 0.6, u0 = -L / 2, u1 = L / 2, bw = Wd / 2;
  // 船体（へさきは とがる）
  const pts = [[u0, -bw], [u1 - L * 0.14, -bw], [u1, 0], [u1 - L * 0.14, bw], [u0, bw]];
  for (let i = 0; i < pts.length; i++) { const p0 = pts[i], p1 = pts[(i + 1) % pts.length], a = P(p0[0], y0, p0[1]), b = P(p1[0], y0, p1[1]); B.quad('c', [a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [a[0], y1, a[2]], null, hull); }
  B.quad('c', P(u0, y1, -bw), P(u1 - L * 0.14, y1, -bw), P(u1 - L * 0.14, y1, bw), P(u0, y1, bw), null, deck); B.tri('c', P(u1 - L * 0.14, y1, -bw), P(u1, y1, 0), P(u1 - L * 0.14, y1, bw), null, deck);
  if (lod >= 2 && t !== 'boat') { const q0 = P(u0, y1 - Dh * 0.25, -bw - 0.05), q1 = P(u1 - L * 0.14, y1 - Dh * 0.25, -bw - 0.05); B.wall('c', q0[0], q0[2], q1[0], q1[2], y1 - Dh * 0.25, y1 - Dh * 0.18, [0.92, 0.92, 0.9]); }
  // 上部構造
  const sb = (ua, ub, wa, h0, h1, c2) => { const a = P(ua, 0, wa), b = P(ub, 0, wa), c3 = P(ub, 0, -wa), d = P(ua, 0, -wa); B.wall('c', a[0], a[2], b[0], b[2], h0, h1, c2); B.wall('c', b[0], b[2], c3[0], c3[2], h0, h1, c2); B.wall('c', c3[0], c3[2], d[0], d[2], h0, h1, c2); B.wall('c', d[0], d[2], a[0], a[2], h0, h1, c2); B.quad('c', [a[0], h1, a[2]], [b[0], h1, b[2]], [c3[0], h1, c3[2]], [d[0], h1, d[2]], null, mul(c2, 0.9)); };
  const wc = col(t === 'navy' ? '#8d959c' : '#f0f0ec');
  if (t === 'tanker' || t === 'bulk') { sb(u0 + L * 0.02, u0 + L * 0.13, bw * 0.9, y1, y1 + Dh * 1.6, wc); B.box('c', ...(() => { const q = P(u0 + L * 0.05, 0, 0); return [q[0] - 1.2, q[2] - 1.2, q[0] + 1.2, q[2] + 1.2]; })(), y1 + Dh * 1.6, y1 + Dh * 2.1, col('#3a3d40'));
    if (t === 'tanker' && lod >= 2) { const a = P(u0 + L * 0.15, y1 + 1, 0), b = P(u1 - L * 0.16, y1 + 1, 0); beam(B, 'c', a, b, 1.2, 1.2, [0.7, 0.7, 0.66]); }
    if (t === 'bulk') for (let i = 0; i < 5; i++) { const ua = u0 + L * (0.18 + i * 0.13); sb(ua, ua + L * 0.1, bw * 0.75, y1, y1 + 0.8, col('#5f7f5f')); } }
  else if (t === 'cont') { sb(u0 + L * 0.06, u0 + L * 0.14, bw * 0.95, y1, y1 + Dh * 2.2, wc); const nb = Math.max(2, Math.round(L * 0.7 / 13)); for (let i = 0; i < nb; i++) { const ua = u0 + L * 0.16 + i * 13, ub = ua + 12.2; if (ub > u1 - L * 0.12) break; const h = 2.6 * (2 + (R() * 3 | 0)), a = P(ua, 0, bw * 0.9), b = P(ub, 0, -bw * 0.9); const [v0, v1] = SV(0, 4, 0.02);
      const q = [P(ua, 0, -bw * 0.9), P(ub, 0, -bw * 0.9), P(ub, 0, bw * 0.9), P(ua, 0, bw * 0.9)]; for (let k = 0; k < 4; k++) { const p0 = q[k], p1 = q[(k + 1) % 4], Ls = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]); const [w0, w1] = SV(k % 2 ? 1 : 0, 4, 0.02); B.wall('i:cont', p0[0], p0[2], p1[0], p1[2], y1, y1 + h, W1, [0, Ls / (k % 2 ? 9.76 : 48.8), w0, w0 + (w1 - w0) * h / 10.4]); }
      B.quad('i:ctop', [q[0][0], y1 + h, q[0][2]], [q[1][0], y1 + h, q[1][2]], [q[2][0], y1 + h, q[2][2]], [q[3][0], y1 + h, q[3][2]], null, W1, [0, 0, 12.2 / 48.8, 0, 12.2 / 48.8, Wd * 0.9 / 19.5, 0, Wd * 0.9 / 19.5]); void a; void b; } }
  else if (t === 'navy') { sb(u0 + L * 0.3, u0 + L * 0.62, bw * 0.75, y1, y1 + Dh * 1.5, wc); sb(u0 + L * 0.38, u0 + L * 0.55, bw * 0.5, y1 + Dh * 1.5, y1 + Dh * 2.3, wc); const q = P(u0 + L * 0.47, 0, 0); B.box('c', q[0] - 0.4, q[2] - 0.4, q[0] + 0.4, q[2] + 0.4, y1 + Dh * 2.3, y1 + Dh * 3.6, wc);
    if (lod >= 2) { const g2 = P(u0 + L * 0.75, 0, 0); B.cyl('c', g2[0], g2[2], 1.4, y1, y1 + 1.2, 8, wc); beam(B, 'c', [g2[0], y1 + 0.9, g2[2]], P(u0 + L * 0.86, y1 + 1.0, 0), 0.25, 0.25, [0.4, 0.42, 0.44]); } }
  else if (t === 'ferry') { sb(u0 + L * 0.08, u1 - L * 0.2, bw * 0.95, y1, y1 + Dh * 0.9, wc); sb(u0 + L * 0.12, u1 - L * 0.26, bw * 0.9, y1 + Dh * 0.9, y1 + Dh * 1.8, wc); sb(u0 + L * 0.5, u1 - L * 0.28, bw * 0.7, y1 + Dh * 1.8, y1 + Dh * 2.4, wc);
    const q = P(u0 + L * 0.3, 0, 0); B.box('c', q[0] - 2.2, q[2] - 2.2, q[0] + 2.2, q[2] + 2.2, y1 + Dh * 1.8, y1 + Dh * 2.9, col('#3f6f9a'));
    if (lod >= 2) for (const lv of [0.45, 1.35]) { const a = P(u0 + L * 0.1, 0, -bw * 0.96), b = P(u1 - L * 0.22, 0, -bw * 0.96), [v0, v1] = SV(6, 8, 0.03); B.wall('i:win', a[0], a[2], b[0], b[2], y1 + Dh * lv - 0.6, y1 + Dh * lv + 0.4, W1, [0, L * 0.68 / 6, v0, v1]); } }
  else if (t === 'fish') { sb(u0 + L * 0.45, u0 + L * 0.7, bw * 0.6, y1, y1 + Dh * 1.6, wc); const q = P(u0 + L * 0.58, 0, 0); B.box('c', q[0] - 0.1, q[2] - 0.1, q[0] + 0.1, q[2] + 0.1, y1 + Dh * 1.6, y1 + Dh * 3, [0.3, 0.3, 0.3]); if (lod >= 2) { const a = P(u0, y1 - Dh * 0.3, -bw - 0.04), b = P(u1 - L * 0.14, y1 - Dh * 0.3, -bw - 0.04); B.wall('c', a[0], a[2], b[0], b[2], y1 - Dh * 0.35, y1 - Dh * 0.2, col(A.pick(R, ['#2f5f9a', '#a33a30', '#2f7a5a']))); } }
  else if (t === 'boat') { sb(u0 + L * 0.3, u0 + L * 0.65, bw * 0.6, y1, y1 + Dh * 1.4, col('#f4f4f0')); if (R() < 0.6) { const q = P(u0 + L * 0.45, 0, 0); B.box('c', q[0] - 0.08, q[2] - 0.08, q[0] + 0.08, q[2] + 0.08, y1, y1 + L * 1.1, [0.85, 0.85, 0.85]); } }
}

/* ---------- 海軍工廠（i_navy）：灰色の上屋・レンガの工場・大きな クレーン・つくりかけの 船 ---------- */
const NAVY = [
  { n: '赤レンガの工場群', W: MW.brick, wain: 0, rt: 'gable', p: 0.32, RS: MR.slate, bk: 7, bh: 'lo', dk: 9, dc: '#ffffff', tr: '#4a4a48', fc: '#94563f', rc: '#8e908c', fw: 'i:fw:koba', ms: 22, cr: '#c8473a' },
  { n: '灰色の鉄骨の上屋', W: MW.paint('#a9b0b4'), wain: 1.0, rt: 'gable', p: 0.14, RS: MR.orib('#8d9498'), bk: 2, bh: 'hi', dk: 1, dc: '#9aa2a6', tr: '#757c80', fc: '#a3aaae', rc: '#8d9498', fw: 'i:fw:koba', cr: '#7d858c' },
  { n: '緑灰色の塗装', W: MW.paint('#9aa597'), wain: 1.0, rt: 'barrel', p: 0.18, RS: MR.orib('#6d7a6a'), bk: 2, bh: 'hi', dk: 1, dc: '#8a9686', tr: '#5c6858', fc: '#93a090', rc: '#6d7a6a', fw: 'i:fw:koba', cr: '#d9a12b' },
  { n: '白いパネルの新しい工場', W: MW.panel('#efefec'), wain: 0, rt: 'flat', RS: MR.flat('#c8cbcb'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#5d6a78', stripe: '#5d6a78', fc: '#ebebe8', rc: '#c2c5c5', fw: 'i:fw:soko', ofc: true, cr: '#3f6f9a' }
];
// 門形クレーン（ゴライアス）：u0〜u1 をまたぐ・高さ h（frame の v 位置 v0〜v1 を 走る）
function gantry(B, fm, u0, u1, v, h, c, lod) {
  const P3 = (u, vv, y) => { const q = fm.p(u, vv); return [q[0], y, q[1]]; }, cc = col(c);
  for (const u of [u0, u1]) { beam(B, 'c', P3(u, v - 3, 0), P3(u, v, h), 1.4, 1.4, cc); beam(B, 'c', P3(u, v + 3, 0), P3(u, v, h), 1.4, 1.4, cc); }
  beam(B, 'c', P3(u0 - 3, v, h + 1.6), P3(u1 + 3, v, h + 1.6), 3.2, 3.6, cc);
  B.box('c', ...(() => { const q = fm.p(u0 + (u1 - u0) * 0.4, v); return [q[0] - 3, q[1] - 3, q[0] + 3, q[1] + 3]; })(), h + 3.4, h + 6, col('#e9e9e6'));
  if (lod >= 2) { const q = fm.p(u0 + (u1 - u0) * 0.4, v); B.box('c', q[0] - 0.15, q[1] - 0.15, q[0] + 0.15, q[1] + 0.15, h * 0.4, h, [0.2, 0.2, 0.2]); }
}
A.arch('i_navy', {
  looks: NAVY,
  far(L, P) { const f = Math.max(1, P.f), H = plantH(f, P.rng); return { H, base: 0, wall: L.fw, bw: 4, fh: f >= 2 ? H / f : H, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: L.rt === 'flat' ? 'flat' : 'gable', p: 0.15, ins: 2, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, f = Math.max(1, P.f), H = plantH(f, R), fr = P.front || [0, 1];
    if (F.rects.length > 1 || F.n < 40) { const I = A.inset(F, 1.0), fe = A.frontEdge(I, fr); pave(B, P, F, 'i:cpad'); shed(B, P, L, I, H, { fe, f, multi: f >= 2, ms: L.ms }); return; }
    const pl = plan(P, { ck: 0.6, maxU: 2 }), fm = pl.fm; pave(B, P, F, 'i:cpad', col('#d2d0ca'));
    const nc = pl.cells.length, yi = nc > 1 ? nc - 1 : -1; let nb = 0;
    for (let i = 0; i < nc; i++) {
      const c = pl.cells[i];
      if (i === yi) {   // 船台：つくりかけの船と 門形クレーン
        if (lod >= 1) { const L2 = Math.min(c.u1 - c.u0, (c.v1 - c.v0) * 3) * 0.75, q = fm.p((c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2), gs = Math.min((c.v1 - c.v0) * 0.8, 50);
          if (lod >= 2) ship(B, q[0], q[1], fm.ua, Math.max(30, L2), 'navy', lod, R); gantry(B, fm, (c.u0 + c.u1) / 2 - gs / 2, (c.u0 + c.u1) / 2 + gs / 2, (c.v0 + c.v1) / 2, cl(gs * 0.7, 20, 45), L.cr, lod); void gs; }
        continue;
      }
      if (lod <= 0 && nb >= 3) continue; nb++;
      const G = RF(fm.r(c.u0, c.v0, c.u1, c.v1)); shed(B, P, L, G, H + (c.a > 2500 ? 2 : 0), { fe: G.edges[fm.fi], f, multi: f >= 2, dside: true, ms: L.ms });
    }
    if (pl.fz > 0 && lod >= 1) { const ow2 = cl(pl.Wd * 0.28, 12, 40), G = RF(fm.r(2, 1.5, 2 + ow2, 1.5 + cl(pl.fz - 3, 7, 14))); office(B, P, G, 3, 3.6, { ow: '#e2ddd2', pc: '#cfcac0' }, G.edges[fm.fi]); parkLot(B, fm, 6 + ow2, 1.2, pl.Wd - 2, Math.min(pl.fz - 1, 17), R, lod, 0.7); if (lod >= 2) fence(B, F, 2.2, W1, 12, A.frontEdge(F, fr)); }
  }
});

/* ---------- コンテナ ----------
   i:cont：帯 0・2 長い側面（4段 × 4本：48.8m）・1 妻（とびら：4段 × 4列：9.76m）・3 トランクルームの 戸（うすい色 4列）。i:ctop：上から（4 × 8 本） */
const CCOL = ['#9a3b2e', '#2f5a8a', '#3f7a52', '#c9cbc9', '#d0742e', '#6a2f3a', '#d9c89a', '#7d8a94', '#e9e9e4', '#4a4f55', '#b8a040', '#2f7a86', '#a35a2a'];
A.tex('i:cont', 256, 256, (g, w, h, R) => {
  const sh = h / 4;
  for (const k of [0, 2]) for (let t = 0; t < 4; t++) for (let i = 0; i < 4; i++) { const x = i * w / 4, y = k * sh + t * sh / 4, cw = w / 4, ch = sh / 4, c0 = A.pick(R, CCOL); ribs(g, x, y, cw, ch, 24, c0, 0.8, 1.06); rect(g, x, y, cw, 1, 'rgba(0,0,0,.35)'); rect(g, x, y + ch - 1, cw, 1, 'rgba(0,0,0,.45)'); rect(g, x, y, 1.5, ch, 'rgba(0,0,0,.5)'); rect(g, x + cw - 1.5, y, 1.5, ch, 'rgba(0,0,0,.5)'); }
  for (let t = 0; t < 4; t++) for (let i = 0; i < 4; i++) { const x = i * w / 4, y = sh + t * sh / 4, cw = w / 4, ch = sh / 4, c0 = A.pick(R, CCOL); rect(g, x, y, cw, ch, css(c0)); for (const a of [0.2, 0.38, 0.62, 0.8]) rect(g, x + cw * a, y + 1, 1.5, ch - 2, 'rgba(40,40,40,.6)'); rect(g, x + cw * 0.5, y, 1, ch, 'rgba(0,0,0,.5)'); rect(g, x, y, cw, 1, 'rgba(0,0,0,.4)'); rect(g, x, y, 1, ch, 'rgba(0,0,0,.5)'); }
  for (let i = 0; i < 4; i++) { const x = i * w / 4, y = sh * 3, cw = w / 4; rect(g, x, y, cw, sh, '#dededa'); for (let u = x + 3; u < x + cw - 3; u += 4) rect(g, u, y + 3, 1, sh - 6, 'rgba(0,0,0,.08)'); rect(g, x + cw * 0.5, y + 3, 1, sh - 6, 'rgba(0,0,0,.45)'); for (const a of [0.22, 0.4, 0.6, 0.78]) rect(g, x + cw * a, y + sh * 0.1, 1.5, sh * 0.8, 'rgba(60,60,60,.55)'); rect(g, x, y, cw, 3, '#a9a9a4'); rect(g, x, y + sh - 3, cw, 3, '#8d8d88'); rect(g, x, y, 3, sh, '#9d9d98'); rect(g, x + cw - 3, y, 3, sh, '#9d9d98'); }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
A.tex('i:ctop', 256, 256, (g, w, h, R) => {
  rect(g, 0, 0, w, h, '#3a3c3d');
  for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) { const x = i * w / 4, y = j * h / 8, c0 = A.pick(R, CCOL); rect(g, x + 1, y + 1, w / 4 - 2, h / 8 - 2, css(c0, 0.95)); for (let u = x + 3; u < x + w / 4 - 2; u += 3) rect(g, u, y + 1, 1, h / 8 - 2, 'rgba(0,0,0,.12)'); }
  PT.noise(g, 0, 0, w, h, 0.03, R);
});
// コンテナの山（長方形 r：x 向きか z 向き・段 t）
function cstack(B, r, t, k) {
  const X = rw(r) >= rd(r), h = t * 2.6, [s0, s1] = SV(k || 0, 4, 0.02), [e0, e1] = SV(1, 4, 0.02), vv = (a, b) => a + (b - a) * t / 4, G = RF(r);
  for (let i = 0; i < 4; i++) { const e = G.edges[i], long = X ? i % 2 === 0 : i % 2 === 1; B.wallE('i:cont', e, 0.05, 0.05 + h, W1, { uv: long ? [e.u0 / 48.8, (e.u0 + e.L) / 48.8, s0, vv(s0, s1)] : [0, e.L / 9.76, e0, vv(e0, e1)] }); }
  const L = X ? rw(r) : rd(r), Wd = X ? rd(r) : rw(r);
  if (X) B.quad('i:ctop', [r[0], h + 0.05, r[3]], [r[2], h + 0.05, r[3]], [r[2], h + 0.05, r[1]], [r[0], h + 0.05, r[1]], null, W1, [r[0] / 48.8, Wd / 19.52, r[2] / 48.8, Wd / 19.52, r[2] / 48.8, 0, r[0] / 48.8, 0]);
  else B.quad('i:ctop', [r[0], h + 0.05, r[3]], [r[2], h + 0.05, r[3]], [r[2], h + 0.05, r[1]], [r[0], h + 0.05, r[1]], null, W1, [0, r[3] / 48.8, Wd / 19.52, r[3] / 48.8, Wd / 19.52, r[1] / 48.8, 0, r[1] / 48.8]);
  void L;
}
// タイヤ式の門形クレーン（RTG）：コンテナの山をまたぐ
function rtg(B, x0, z0, x1, z1, h, c, lod) {
  const cc = col(c), X = (x1 - x0) >= (z1 - z0);
  const legs = X ? [[x0, z0], [x0, z1], [x0 + 7, z0], [x0 + 7, z1]] : [[x0, z0], [x1, z0], [x0, z0 + 7], [x1, z0 + 7]];
  for (const [x, z] of legs) B.box('c', x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0, h, cc);
  if (X) { B.box('c', x0 - 0.6, z0 - 0.6, x0 + 7.6, z0 + 0.6, h, h + 1.4, cc); B.box('c', x0 - 0.6, z1 - 0.6, x0 + 7.6, z1 + 0.6, h, h + 1.4, cc); if (lod >= 2) B.box('c', x0 + 1, (z0 + z1) / 2 - 1.5, x0 + 6, (z0 + z1) / 2 + 1.5, h + 0.2, h + 1.8, col('#e9e9e6')); }
  else { B.box('c', x0 - 0.6, z0 - 0.6, x0 + 0.6, z0 + 7.6, h, h + 1.4, cc); B.box('c', x1 - 0.6, z0 - 0.6, x1 + 0.6, z0 + 7.6, h, h + 1.4, cc); if (lod >= 2) B.box('c', (x0 + x1) / 2 - 1.5, z0 + 1, (x0 + x1) / 2 + 1.5, z0 + 6, h + 0.2, h + 1.8, col('#e9e9e6')); }
}
// 岸壁クレーン（ガントリークレーン）：海がわへ ブーム（frame の v1 の外へ）
function sts(B, fm, u, v, c, lod, out = 1) {
  const P3 = (uu, vv, y) => { const q = fm.p(uu, vv); return [q[0], y, q[1]]; }, cc = col(c), h = 38, gw = 9, gl = 16;
  if (lod <= 0) { beam(B, 'c', P3(u, v + gl / 2 * out, 0), P3(u, v + gl / 2 * out, h), gl, gw * 2, cc, { sides: [1, 1, 1, 1] }); beam(B, 'c', P3(u, v - 22 * out, h + 1.5), P3(u, v + (gl + 40) * out, h + 1.5), gw * 2, 2.4, cc); return; }
  for (const du of [-gw, gw]) for (const dv of [0, gl]) beam(B, 'c', P3(u + du, v + dv * out, 0), P3(u + du, v + dv * out, h), 1.3, 1.3, cc);
  for (const du of [-gw, gw]) beam(B, 'c', P3(u + du, v - 22 * out, h + 1.5), P3(u + du, v + (gl + 40) * out, h + 1.5), 1.6, 2.4, cc);
  beam(B, 'c', P3(u - gw, v, h + 0.5), P3(u + gw, v, h + 0.5), 1.4, 1.4, cc); beam(B, 'c', P3(u - gw, v + gl * out, h + 0.5), P3(u + gw, v + gl * out, h + 0.5), 1.4, 1.4, cc);
  if (lod >= 1) { for (const du of [-gw, gw]) { beam(B, 'c', P3(u + du, v + 4 * out, h + 2.5), P3(u + du * 0.4, v + 8 * out, h + 16), 0.8, 0.8, cc); beam(B, 'c', P3(u + du * 0.4, v + 8 * out, h + 16), P3(u + du, v + (gl + 38) * out, h + 2.6), 0.5, 0.5, cc); }
    B.box('c', ...(() => { const q = fm.p(u, v - 16 * out); return [q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5]; })(), h + 2.7, h + 6.5, col('#e9e9e6')); }
}
const CYARD = [
  { n: '赤白のクレーン・高く積む', cr: '#c8473a', tier: [2, 4], ck: 0, gr: 'i:asph', gc: '#ffffff' },
  { n: '青いクレーン・白い床', cr: '#3f6f9a', tier: [2, 3], ck: 2, gr: 'i:cpad', gc: '#e0ded8' },
  { n: '黄色いクレーン・低く積む', cr: '#d9a12b', tier: [1, 2], ck: 0, gr: 'i:asph', gc: '#ffffff' },
  { n: '白クレーン・冷凍コンテナ', cr: '#e9e9e6', tier: [2, 3], ck: 2, gr: 'i:cpad', gc: '#e8e6e0', reefer: true },
  { n: '灰色クレーン・空コンテナ', cr: '#8d9498', tier: [3, 5], ck: 0, gr: 'i:asph', gc: '#f0f0f0' }
];
// コンテナヤード（f=0）・コンテナふ頭（海がわに 岸壁と クレーン）
A.arch('i_cyard', {
  looks: CYARD,
  far(L, P) { return { H: 5, base: 0.05, wall: 'c', wc: col('#8f6f5f'), ct: col('#9a8a7a'), rc: col('#8a7a6a'), rt: 'flat', ins: 6 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], sea = !!P.ko.sea;
    if (lod >= 0) { B.plinth(F, P.yb, 0.04); B.cap(L.gr, F, 0.04, col(L.gc), { su: 16 }); }
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 3), fr), Wd = fm.W, D = fm.D;
    const qz = sea ? cl(D * 0.28, 20, 70) : 0, gz = D > 60 ? 14 : 6, yd = D - qz - gz;
    // ブロック：6列 × ながさ（u）・あいだに 通路
    const bw = 6 * 2.5, bl = cl(Wd * 0.44, 30, 110), gap = 8, nv = Math.max(1, Math.floor(yd / (bw + gap))), nu = Math.max(1, Math.floor(Wd / (bl + 12))), lim = lod >= 2 ? 24 : lod >= 1 ? 12 : 4; let nb = 0, nr = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (nb++ >= lim) continue;
      const u0 = (Wd - nu * (bl + 12)) / 2 + i * (bl + 12) + 6, v0 = gz + j * (bw + gap) + gap / 2;
      // ブロックの中を 2〜3 段の ちがう山に
      const parts = lod >= 2 ? 3 : lod >= 1 ? 2 : 1; for (let k = 0; k < parts; k++) { const a = u0 + bl * k / parts, b = u0 + bl * (k + 1) / parts - 0.6, t = L.tier[0] + Math.floor(R() * (L.tier[1] - L.tier[0] + 1)); cstack(B, fm.r(a, v0, b, v0 + bw), Math.min(4, t), (k + j) % 2 ? L.ck : 0); }
      if (lod >= 2 && (i + j) % 3 === 0 && nr++ < 5) { const r = fm.r(u0 + bl * 0.3, v0 - 1.5, u0 + bl * 0.3 + 7, v0 + bw + 1.5); rtg(B, r[0], r[1], r[2], r[3], 13, L.cr, lod); }
    }
    if (lod >= 2) {   // ゲート・トラック・照明の塔
      const gq = fm.p(Wd / 2, 3); B.box('c', gq[0] - 12, gq[1] - 3, gq[0] + 12, gq[1] + 3, 5.5, 6, col('#e0e2e2')); for (const s of [-1, 0, 1]) B.box('c', gq[0] + s * 8 - 0.8, gq[1] - 0.8, gq[0] + s * 8 + 0.8, gq[1] + 0.8, 0.04, 2.6, col('#e9e7e1'));
      const nt = cl(Math.round(Math.sqrt(F.area) / 25), 2, 8); for (let i = 0; i < nt; i++) { const q = fm.p(10 + (Wd - 20) * R(), gz - 4); trailer(B, q[0], q[1], fm.ua + (R() < 0.5 ? 0 : PI), { box: A.pick(R, CCOL) }); }
      for (let i = 0; i < 3; i++) { const q = fm.p(Wd * (0.2 + 0.3 * i), gz + yd * 0.5); B.box('c', q[0] - 0.3, q[1] - 0.3, q[0] + 0.3, q[1] + 0.3, 0, 30, [0.6, 0.6, 0.58]); B.box('c', q[0] - 1.6, q[1] - 0.4, q[0] + 1.6, q[1] + 0.4, 30, 31.2, [0.85, 0.85, 0.8]); }
      fence(B, F, 2.2, W1, 24, A.frontEdge(F, fr));
    }
    if (sea) { quay(B, P, fm, D - qz + 30, D, Wd, 1.2, { ship: lod >= 1 ? 'cont' : null }); const ns = cl(Math.round(Wd / 70), 1, lod >= 1 ? 4 : 2); for (let i = 0; i < ns; i++) sts(B, fm, Wd * (i + 0.5) / ns, D - qz + 12, L.cr, lod, 1); }
  }
});

/* ---------- 倉庫ビル・物流センター（i_logi）：何階もの 倉庫。スロープ（らせん か まっすぐ）・各階の トラックの荷さばき ---------- */
const LOGI = [
  { n: '白壁・らせんスロープ', W: MW.panel('#f2f2ef'), ramp: 'helix', st: '#3f6c96', fc: '#eeeeeb', rc: '#c6c8c8', cn: '#e9e9e6', dc: '#e0e2e2' },
  { n: '灰色壁・直線スロープ', W: MW.panel('#bfc3c6'), ramp: 'line', st: '#6c757c', fc: '#b9bdc0', rc: '#a9adaf', cn: '#d6d8d8', dc: '#cfd2d3' },
  { n: 'ベージュ打放し・小窓', W: MW.conc('#e6dccb'), ramp: 'none', st: null, win: 4, fc: '#ddd3c0', rc: '#b9b5ac', cn: '#cfc9bd', dc: '#c9c4ba' },
  { n: '白と紺の帯', W: MW.panel('#f0f0ed'), ramp: 'helix', st: '#2c4466', band: true, fc: '#e2e3e3', rc: '#c4c6c6', cn: '#2c4466', dc: '#e0e2e2' },
  { n: '銀の壁・ガラス事務所', W: MW.kaku('#cdd1d4'), ramp: 'line', st: '#8a9299', glass: true, fc: '#c8ccd0', rc: '#b5b9bc', cn: '#c9cdd0', dc: '#d4d7d9' }
];
const logiFh = 6.0;
A.arch('i_logi', {
  looks: LOGI,
  far(L, P) { const f = Math.max(1, P.f), H = f * logiFh + 1; return { H, base: 0, wall: 'i:fw:soko', bw: 4, fh: logiFh, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 2, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f), fh = logiFh, H = f * fh + 1;
    pave(B, P, F, 'i:asph');
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 1.5), fr), Wd = fm.W, D = fm.D;
    const yd = D > 40 ? cl(D * 0.22, 14, 40) : 6, rp = L.ramp !== 'none' && f >= 2 && Wd > 50 ? (L.ramp === 'helix' ? 30 : 14) : 0;
    const G = RF(fm.r(rp ? rp + 2 : 0, yd, Wd, D)), fe = G.edges[fm.fi];
    if (lod <= 0) { lowShed(B, P, G, H, { fc: L.fc, rc: L.rc, rt: 'flat', fw: 'i:fw:soko' }, { fh }); if (rp) { const q = fm.p(rp / 2, yd + rp / 2 + 2); if (L.ramp === 'helix') B.cyl('c', q[0], q[1], rp / 2, 0, H - fh, 8, col(L.fc)); } return; }
    if (lod === 1) farWalls(B, G, 0, H, 'i:fw:soko', col(L.fc), fh);
    else {
      for (const e of G.edges) clad(B, e, 0, e.L, 0, H, L.W, 0.85);
      for (let i = 0; i < f; i++) for (const e of G.edges) { const y = i * fh; if (L.win) band(B, e, 1, e.L - 1, y + 2.2, y + 3.4, L.win, 3); else if (e !== fe) band(B, e, 1, e.L - 1, y + 4.2, y + 5.2, 2, 4); if (L.band || L.st) seg(B, 'c', e, 0, e.L, y + fh - 0.5, y + fh, col(L.st || '#888'), null, 0, 0, 1, 0.05); }
      if (L.glass) { const e = fe; band(B, e, 0.5, Math.min(e.L * 0.3, 30), 1, H - 1, 6, 3.2, 0.1); }
    }
    // 各階の 荷さばき（道がわ）：1階は ドック、上の階は スロープから
    for (let i = 0; i < (rp ? f : 1); i++) { const y = i * fh; if (i === 0) dock(B, P, L.dc ? Object.assign({}, L, { dk: 3 }) : L, fe, fh, 1, {}); else if (lod >= 2) { const nd = cl(Math.floor(fe.L / 6), 1, 14); for (let k = 0; k < nd; k++) door(B, fe, (k + 0.5) * fe.L / nd, 3.4, y + 0.3, 3.8, 3, col(L.dc)); B.ledge(fe, y - 0.4, y, 9, col(L.cn), { m: 'c' }); } }
    B.cap('i:flat', G, H, col('#c9cbcb'), { su: 16 }); if (lod >= 1) B.parapet(G, H, 0.8, 0.25, mul(col(L.fc), 0.9));
    if (rp && lod >= 1) {   // スロープ
      if (L.ramp === 'helix') { const q = fm.p(rp / 2 + 1, yd + rp / 2 + 2), rr = rp / 2, n = lod >= 2 ? 14 : 8; frustum(B, 'i:conc', q[0], q[1], rr, rr, 0, H - fh + 1.2, n, col(L.fc), [0, 2 * PI * rr / 8], [0, (H - fh) / 8]); fan(B, q[0], q[1], rr, H - fh + 1.2, H - fh + 1.2, n, col('#8a8c8c'));
        if (lod >= 2) for (let i = 1; i < f; i++) frustum(B, 'c', q[0], q[1], rr + 0.05, rr + 0.05, i * fh - 0.5, i * fh + 0.4, n, col(L.st || '#8a8c8c')); }
      else { const a = fm.p(1, yd + 2), b = fm.p(rp - 1, D - 2); const yt = (f - 1) * fh; for (let i = 0; i < f - 1; i++) { const v0 = yd + 2 + (D - yd - 4) * i / (f - 1), v1 = yd + 2 + (D - yd - 4) * (i + 1) / (f - 1); beam(B, 'c', (() => { const q = fm.p(rp / 2, v0); return [q[0], i * fh + 0.6, q[1]]; })(), (() => { const q = fm.p(rp / 2, v1); return [q[0], (i + 1) * fh + 0.6, q[1]]; })(), rp - 2, 1.2, col(L.fc)); } void a; void b; void yt; }
    }
    if (lod >= 2) { parkLot(B, fm, Wd * 0.55, 1.2, Wd - 2, Math.min(yd - 2, 17), R, lod, 0.6); fence(B, F, 1.8, W1, 14, A.frontEdge(F, fr)); B.rooftop(G, H, R, { per: 400, nmax: 6, ph: true }); }
  }
});

/* ---------- トランクルーム（i_trunk）：1階は コンテナの列、2階より上は 屋内の トランクルームの建物 ---------- */
const TRUNK = [
  { n: '水色のコンテナ', c: '#9fc0d2', fc: '#9fc0d2', rc: '#8fa9b8', sg: '#2f5f8a' },
  { n: 'クリームのコンテナ', c: '#e8dfc4', fc: '#e8dfc4', rc: '#cfc6ab', sg: '#8a5a3a' },
  { n: 'グレーのコンテナ', c: '#b9bdbf', fc: '#b9bdbf', rc: '#a5a9ab', sg: '#3a3d40' },
  { n: '赤茶のコンテナ', c: '#a5644a', fc: '#a5644a', rc: '#8e5640', sg: '#e9e6dc' }
];
A.arch('i_trunk', {
  looks: TRUNK,
  far(L, P) { const f = Math.max(1, P.f); return { H: f <= 1 ? 2.7 : f * 3.2, base: 0, wall: f <= 1 ? 'c' : 'i:fw:soko', bw: 4, fh: 3.2, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 1, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f), cc = col(L.c);
    pave(B, P, F, 'i:asph');
    if (f >= 2 || F.rects.length > 1) {   // 屋内のトランクルーム
      const I = A.inset(F, 0.8), fe = A.frontEdge(I, fr), H = f * 3.2 + 0.2;
      if (lod <= 0) { lowShed(B, P, I, H, { fc: L.fc, rc: L.rc, rt: 'flat', fw: 'i:fw:soko' }, { fh: 3.2 }); return; }
      for (const e of I.edges) clad(B, e, 0, e.L, 0, H, MW.kaku(L.c), 0.85);
      if (lod >= 2) for (let i = 0; i < f; i++) for (const e of I.edges) if (e.L > 5) band(B, e, 1, e.L - 1, i * 3.2 + 2.0, i * 3.2 + 2.8, 4, 4);
      door(B, fe, fe.L / 2, 2.2, 0, 2.4, 6, W1); if (lod >= 2) signPanel(B, fe, fe.L / 2, Math.min(fe.L - 1, 6), H - 1.2, 0.9, col(L.sg));
      B.cap('i:flat', I, H, col('#c8caca'), { su: 16 }); if (lod >= 1) B.parapet(I, H, 0.5, 0.2, mul(cc, 0.9));
      return;
    }
    const fm = frame(inR(F.rects[0], 0.8), fr), Wd = fm.W, D = fm.D, aisle = 3.5, row = 6.1;
    if (lod <= 0) { boxW(B, fm.r(0, 1.7, Math.max(2.44, Math.floor(Wd / 2.44) * 2.44), D - 1.7), 0, 2.65, { m: 'c', su: 1, c: cc }, { ct: mul(cc, 0.85) }); return; }
    // コンテナの列（戸が 通路がわ）
    const nr = Math.max(1, Math.floor((D + aisle) / (row + aisle))), nc = Math.max(1, Math.floor(Wd / 2.44));
    for (let j = 0; j < nr; j++) {
      const v0 = j * (row + aisle) + (j % 2 ? 0 : 0), r = fm.r(0, v0 + aisle * 0.5, nc * 2.44, v0 + aisle * 0.5 + row), G = RF(r), fe = G.edges[fm.fi], [s0, s1] = SV(3, 4, 0.02);
      for (const e of G.edges) { if (e === fe) seg(B, 'i:cont', e, 0, e.L, 0.05, 2.65, cc, [0, e.L / 9.76], s0, s1, 1); else B.wallE('c', e, 0.05, 2.65, mul(cc, 0.92)); }
      B.cap('c', G, 2.65, mul(cc, 0.85));
      if (lod >= 2) for (let k = 0; k < Math.min(nc, 12); k++) { const q = fm.p((k + 0.5) * 2.44 * nc / Math.min(nc, 12), v0 + aisle * 0.5 + row); void q; }
    }
    if (lod >= 2) { fence(B, F, 1.8, W1, 4, A.frontEdge(F, fr)); const q = fm.p(Wd - 1, 0.6); B.box('c', q[0] - 0.12, q[1] - 0.12, q[0] + 0.12, q[1] + 0.12, 0, 4.2, [0.5, 0.5, 0.5]); B.box('c', q[0] - 0.9, q[1] - 0.1, q[0] + 0.9, q[1] + 0.1, 3.0, 4.0, col(L.sg)); }
  }
});

/* ---------- 酒蔵（i_sake）：白しっくい・焼杉や なまこ壁の 腰・重い 瓦屋根・杉玉・レンガの煙突 ---------- */
// i:kura：帯 0 焼杉（たての黒い板）・1 なまこ壁・2 白しっくい（うすい色）・3 下見板（よこの板と 押縁）
A.tex('i:kura', 256, 256, (g, w, h, R) => {
  const sh = h / 4;
  clip(g, 0, 0, w, sh, () => { for (let i = 0; i < 32; i++) { rect(g, i * w / 32, 0, w / 32, sh, css('#302d2a', 0.85 + R() * 0.3)); rect(g, i * w / 32, 0, 1, sh, 'rgba(0,0,0,.45)'); } PT.noise(g, 0, 0, w, sh, 0.05, R); });
  clip(g, 0, sh, w, sh, () => { const y = sh; rect(g, 0, y, w, sh, '#2d2e30'); const s = sh / 2; for (let i = 0; i < w / s + 1; i++) for (let j = 0; j < 3; j++) { const cx = i * s, cy = y + j * s; g.fillStyle = '#3a3c3e'; g.beginPath(); g.moveTo(cx, cy - s * 0.42); g.lineTo(cx + s * 0.42, cy); g.lineTo(cx, cy + s * 0.42); g.lineTo(cx - s * 0.42, cy); g.fill(); }
    g.strokeStyle = '#e9e6dc'; g.lineWidth = Math.max(2, s * 0.14); for (let u = -sh; u < w + sh; u += s) { g.beginPath(); g.moveTo(u, y); g.lineTo(u + sh, y + sh); g.moveTo(u + sh, y); g.lineTo(u, y + sh); g.stroke(); } });
  clip(g, 0, sh * 2, w, sh, () => { const y = sh * 2; rect(g, 0, y, w, sh, '#f0eee6'); blots(g, 0, y, w, sh, 20, '150,140,120', 0.08, R, 0.06, 0.4); drips(g, 0, y, w, sh, 14, '120,110,95', 0.1, R, 0.8); PT.noise(g, 0, y, w, sh, 0.015, R); });
  clip(g, 0, sh * 3, w, sh, () => { const y = sh * 3; for (let j = 0; j < 8; j++) { rect(g, 0, y + j * sh / 8, w, sh / 8, css('#3a3330', 0.85 + R() * 0.25)); rect(g, 0, y + (j + 1) * sh / 8 - 1, w, 1, 'rgba(0,0,0,.5)'); } for (let u = 0; u < w; u += w / 8) rect(g, u, y, 3, sh, '#26221f'); });
});
const SAKE = [
  { n: '白しっくい・焼杉の腰', lo: 0, up: '#ffffff', rc: '#9aa0a6', rk: W1, fc: '#e9e6de', ch: 0 },
  { n: '白しっくい・なまこ壁', lo: 1, up: '#ffffff', rc: '#9aa0a6', rk: W1, fc: '#e2dfd6', ch: 0 },
  { n: '黒い板張り・瓦屋根', lo: 3, up: null, rc: '#9aa0a6', rk: W1, fc: '#3a3532', ch: 1 },
  { n: '土壁・こげ茶の板', lo: 3, up: '#c9a57a', rc: '#9aa0a6', rk: W1, fc: '#b7966e', ch: 0 },
  { n: '白しっくい・赤茶の瓦', lo: 0, up: '#ffffff', rc: '#9a5a44', rk: [1.6, 0.92, 0.72], fc: '#e9e6de', ch: 1 }
];
function kura(B, P, L, G, H, fe, R) {
  const lod = P.lod, lh = Math.min(1.8, H * 0.32), [l0, l1] = SV(L.lo, 4, 0.03), [p0, p1] = SV(2, 4, 0.05);
  if (lod <= 0) { for (const e of G.edges) seg(B, 'c', e, 0, e.L, 0, H, col(L.fc), null, 0, 0, 0.85); }
  else for (const e of G.edges) {
    seg(B, 'i:kura', e, 0, e.L, 0, L.up ? lh : H, W1, [e.u0 / 4, (e.u0 + e.L) / 4], l0, L.up ? l1 : l1, 0.85);
    if (L.up) { seg(B, 'i:kura', e, 0, e.L, lh, H, col(L.up), [e.u0 / 4, (e.u0 + e.L) / 4], p0, p1, 1); if (lod >= 2) seg(B, 'c', e, 0, e.L, lh - 0.06, lh + 0.08, [0.3, 0.29, 0.28], null, 0, 0, 1, 0.06); }
    if (lod >= 2 && e.L > 6) { const n = Math.max(1, Math.round(e.L / 9)); for (let i = 0; i < n; i++) { const t = e.L * (i + 0.5) / n; band(B, e, t - 0.7, t + 0.7, H - 2.2, H - 1.0, 4, 1.4, 0.06); } }
  }
  if (fe && lod >= 1) door(B, fe, fe.L * 0.5, 2.6, 0, 2.6, 8, W1, 0.08);
  const top = lod <= 0 ? gableRoof(B, G.rects[0], H, { m: 'c', su: 1, c: col(L.rc) }, { m: 'c', su: 1, sv: 1, c: col(L.fc) }, { p: 0.5, oh: 0.6, lod: 0, ms: 14 }) : roofs(B, G, H, { m: 'i:kawara', su: 4.8, c: L.rk }, lod >= 1 ? { m: 'i:kura', k: L.up ? 2 : L.lo, n: 4, su: 4, c: col(L.up || '#ffffff') } : { m: 'c', su: 1, sv: 1, c: col(L.fc) }, { t: 'gable', p: 0.5, oh: 0.9, lod, tr: [0.25, 0.24, 0.23], cr: [0.3, 0.31, 0.33], ms: 14 });
  return top;
}
A.arch('i_sake', {
  looks: SAKE,
  far(L, P) { const f = Math.max(1, P.f), H = 4.2 + (f - 1) * 3.2; return { H, base: 0, wall: 'c', roof: null, rc: col(L.rc), rt: 'gable', p: 0.5, ins: 0.8, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f), H = 4.2 + (f - 1) * 3.2 + R() * 0.6;
    if (lod >= 1) { B.plinth(F, P.yb, 0.05); B.cap('i:cpad', F, 0.05, col('#d6d0c4'), { su: 16 }); }
    // 区画の長方形ごとに 蔵（細長く）：大きな長方形は 2つに わける
    const rs = F.rects.length > 4 ? [F.bb] : F.rects; let first = true, big = null;
    for (const r0 of rs) {
      const fm = frame(inR(r0, 0.8), fr), Wd = fm.W, D = fm.D, n = Wd > 28 && lod >= 1 ? 2 : 1, gap = 5;
      for (let i = 0; i < n; i++) { const u0 = i * (Wd + gap) / n, u1 = u0 + (Wd - gap * (n - 1)) / n, G = RF(fm.r(u0, D > 24 ? 4 : 0, u1, D)), fe = G.edges[fm.fi];
        const top = kura(B, P, L, G, H, fe, R); if (!big || G.area > big.G.area) big = { G, top, fe };
        if (first && lod >= 2) { const p = ePt(fe, fe.L * 0.25, 1.0); B.dome('c', p[0], p[1], 0.55, 0.55, H - 1.3, 0.55, 8, [0.42, 0.33, 0.2], { rings: 2 }); B.dome('c', p[0], p[1], 0.55, 0.55, H - 1.3, -0.55, 8, [0.38, 0.3, 0.18], { rings: 2 }); first = false; }   // 杉玉
      }
    }
    if (big && (L.ch || F.area > 900) && lod >= 1) { const r = big.G.rects[0]; chimney(B, r[0] + 1.6, r[1] + 1.6, 0.9, Math.max(big.top + 9, 16), 2, lod); }
    if (lod >= 2) { const fe = A.frontEdge(F, fr); for (const e of F.edges) if (e.out && e !== fe) seg(B, 'i:kura', e, 0.3, e.L - 0.3, 0.05, 1.9, col('#ffffff'), [e.u0 / 4, (e.u0 + e.L) / 4], SV(2, 4, 0.05)[0], SV(2, 4, 0.05)[1], 0.9, -0.3); }
  }
});

/* ---------- 重工業：製鉄所（i_steel）・石油化学（i_petro）・セメント（i_cement）・火力発電所（i_power）・清掃工場（i_incin） ----------
   どれも：区画の ます目（plan）に 大きな設備を ひとつずつ。のこりは 棟（shed）・道がわに 事務所と駐車場 */
function heavySite(B, P, L, fns, o = {}) {
  const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f), H = o.H || plantH(f, R);
  if (F.rects.length > 1 || F.n < 30) { const I = A.inset(F, 1.5), r = I.rects.reduce((a, q) => rw(q) * rd(q) > rw(a) * rd(a) ? q : a); pave(B, P, F, 'i:cpad', col('#cfcdc6')); const fm = frame(r, fr); fns[0](B, P, L, fm, { u0: 0, v0: 0, u1: fm.W, v1: fm.D, a: fm.W * fm.D }, R); return; }
  const pl = plan(P, { ck: o.ck || 0.5, maxU: o.maxU || 3, maxV: 2 }), fm = pl.fm; pave(B, P, F, o.gr || 'i:asph', o.gc ? col(o.gc) : W1);
  const nc = pl.cells.length, order = pl.cells.map((c, i) => i).sort((a, b) => pl.cells[b].a - pl.cells[a].a);
  const role = new Map(); fns.forEach((fn, k) => { if (k < order.length) role.set(order[k], fn); });
  let nb = 0;
  for (let i = 0; i < nc; i++) {
    const c = pl.cells[i], fn = role.get(i);
    if (fn) { fn(B, P, L, fm, c, R); continue; }
    if (lod <= 0 && nb >= 2) continue; nb++;
    const G = RF(fm.r(c.u0, c.v0, c.u1, c.v1)); shed(B, P, L, G, H + (c.a > 3000 ? 3 : 0), { fe: G.edges[fm.fi], f, multi: f >= 2, dside: true, ms: L.ms || 34 });
  }
  if (pl.fz > 0 && lod >= 1) { const ow2 = cl(pl.Wd * 0.25, 12, 40), G = RF(fm.r(2, 1.5, 2 + ow2, 1.5 + cl(pl.fz - 3, 7, 14))); office(B, P, G, 3, 3.6, { ow: L.ow || '#e6e2d8', pc: '#d0ccc2', ofc: L.ofc }, G.edges[fm.fi]); parkLot(B, fm, 6 + ow2, 1.2, pl.Wd - 2, Math.min(pl.fz - 1, 17), R, lod, 0.75); if (lod >= 2) fence(B, F, 2.0, W1, 14, A.frontEdge(F, fr)); }
}
const cellR = (fm, c, d = 3) => fm.r(c.u0 + d, c.v0 + d, c.u1 - d, c.v1 - d);
// 製鉄所 -----------------------------------------------------------------
const STEEL = [
  { n: '灰色の建屋・赤さびの高炉', W: MW.galv, wain: 1.2, rt: 'gable', p: 0.12, RS: MR.orust('#b0aaa0'), bk: 2, bh: 'hi', dk: 1, dc: '#9aa09e', tr: '#7d8180', fc: '#b0b5b7', rc: '#a39c92', fw: 'i:fw:koba', fu: '#8a5a44', ore: '#7a4a3a' },
  { n: '青い建屋・銀色の高炉', W: MW.paint('#7f9db8'), wain: 1.2, rt: 'gable', p: 0.1, RS: MR.orib('#8a9aa8'), bk: 2, bh: 'hi', dk: 1, dc: '#7f9db8', tr: '#5f7d98', fc: '#7f9db8', rc: '#8a9aa8', fw: 'i:fw:koba', fu: '#a9adb0', ore: '#6e4a3e' },
  { n: '緑灰色の建屋・黒い高炉', W: MW.paint('#9aa597'), wain: 1.2, rt: 'gable', p: 0.12, RS: MR.orib('#7a8577'), bk: 2, bh: 'hi', dk: 1, dc: '#8a9686', tr: '#5c6858', fc: '#93a090', rc: '#7a8577', fw: 'i:fw:koba', fu: '#4a4a48', ore: '#5a4a40' },
  { n: '白い建屋・赤白の煙突', W: MW.panel('#eeeeeb'), wain: 0, rt: 'gable', p: 0.08, RS: MR.orib('#bfc2c3'), bk: 3, bh: 'hi', dk: 0, dc: '#d9dbdb', tr: '#a9acad', stripe: '#c8473a', fc: '#e9e9e6', rc: '#bfc2c3', fw: 'i:fw:soko', fu: '#9a6a50', ore: '#7a4a3a' }
];
function blastFurnace(B, P, L, fm, c, R) {
  const lod = P.lod, q = fm.p((c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2), s = cl(Math.min(c.u1 - c.u0, c.v1 - c.v0) / 70, 0.5, 1.2), fu = col(L.fu), n = lod >= 2 ? 12 : lod >= 1 ? 8 : 6;
  const x = q[0], z = q[1];
  frustum(B, 'c', x, z, 8 * s, 6 * s, 0, 38 * s, n, fu); frustum(B, 'c', x, z, 6 * s, 3.5 * s, 38 * s, 62 * s, n, mul(fu, 0.92));
  latTower(B, x, z, 26 * s, 18 * s, 0, 70 * s, mul(fu, 0.9));
  B.box('c', x - 6 * s, z - 6 * s, x + 6 * s, z + 6 * s, 70 * s, 78 * s, mul(fu, 0.85));
  if (lod >= 1) { for (let i = 0; i < 3; i++) { const sx = x + (i - 1) * 11 * s, sz = z + 22 * s; frustum(B, 'c', sx, sz, 4.5 * s, 4.5 * s, 0, 44 * s, n, col('#9a9c9a')); B.dome('c', sx, sz, 4.5 * s, 4.5 * s, 44 * s, 3 * s, n, col('#8a8c8a'), { rings: 2 }); }
    beam(B, 'c', [x + 3 * s, 64 * s, z], [x + 20 * s, 30 * s, z - 14 * s], 2.2 * s, 2.2 * s, mul(fu, 0.8)); frustum(B, 'c', x + 22 * s, z - 16 * s, 5 * s, 5 * s, 10 * s, 26 * s, n, mul(fu, 0.85)); fan(B, x + 22 * s, z - 16 * s, 5 * s, 10 * s, 4 * s, n, mul(fu, 0.75));
    boxW(B, [x - 18 * s, z - 30 * s, x + 18 * s, z - 12 * s], 0, 16 * s, L.W, { ct: col(L.rc) }); conveyor(B, [x - 30 * s, 2, z - 40 * s], [x - 2 * s, 66 * s, z - 2 * s], 3, lod); }
}
function cokeOven(B, P, L, fm, c, R) {
  const lod = P.lod, r = cellR(fm, c, 6), X = rw(r) >= rd(r), a = X ? [r[0], (r[1] + r[3]) / 2 - 8, r[2] - 20, (r[1] + r[3]) / 2 + 8] : [(r[0] + r[2]) / 2 - 8, r[1], (r[0] + r[2]) / 2 + 8, r[3] - 20];
  boxW(B, a, 0, 13, MW.conc('#b9b5ae'), { ct: col('#5a5856') }); boxW(B, X ? [a[2], a[1] - 2, a[2] + 12, a[3] + 2] : [a[0] - 2, a[3], a[2] + 2, a[3] + 12], 0, 38, MW.conc('#c4c0b8'), { ct: col('#6a6866') });
  chimney(B, X ? a[2] + 16 : (a[0] + a[2]) / 2, X ? (a[1] + a[3]) / 2 : a[3] + 16, 3, 100, 0, lod);
  if (lod >= 1) pile(B, X ? [r[0], r[1], r[2] - 22, a[1] - 4] : [r[0], r[1], a[0] - 4, r[3] - 22], 9, col('#3a3836'));
}
function oreYard(B, P, L, fm, c, R) {
  const lod = P.lod, n = cl(Math.round((c.u1 - c.u0) / 40), 1, 4);
  for (let i = 0; i < n; i++) { const a = c.u0 + (c.u1 - c.u0) * i / n, b = c.u0 + (c.u1 - c.u0) * (i + 1) / n; pile(B, fm.r(a + 3, c.v0 + 4, b - 3, c.v1 - 4), cl((b - a) * 0.22, 5, 15), col(i % 2 ? L.ore : '#3e3c3a')); }
  if (lod >= 1) { const q = fm.p(c.u0 + (c.u1 - c.u0) / n, (c.v0 + c.v1) / 2), p1 = fm.p(c.u0 + (c.u1 - c.u0) / n + 20, (c.v0 + c.v1) / 2 + 14); latTower(B, q[0], q[1], 6, 4, 0, 14, W1); beam(B, 'c', [q[0], 14, q[1]], [p1[0], 6, p1[1]], 1.6, 1.6, col('#d9a12b')); }
}
function gasHolder(B, P, L, fm, c, R) { const q = fm.p((c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2), r = cl(Math.min(c.u1 - c.u0, c.v1 - c.v0) * 0.3, 12, 30); frustum(B, 'c', q[0], q[1], r, r, 0, r * 2.4, P.lod >= 1 ? 16 : 8, col('#7d8a94')); fan(B, q[0], q[1], r, r * 2.4, r * 2.6, P.lod >= 1 ? 16 : 8, col('#6a7680')); if (P.lod >= 2) latTower(B, q[0] + r + 1, q[1], 2.2, 2.2, 0, r * 2.4, W1, 6); }
A.arch('i_steel', {
  looks: STEEL,
  far(L, P) { return { H: 22, base: 0, wall: 'i:fw:koba', bw: 4, fh: 22, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 4, wc: col(L.fc) }; },
  build(B, L, P) { heavySite(B, P, L, [blastFurnace, oreYard, cokeOven, gasHolder], { H: 20 + P.rng() * 4, ck: 0.45, maxU: 3 }); }
});
// 石油化学 ---------------------------------------------------------------
const PETRO = [
  { n: '白い塔と タンク', tw: '#eeeeea', pp: '#9aa0a4', tc: '#eeeeea', sp: '#f0f0ec', W: MW.panel('#ecece8'), wain: 0, rt: 'flat', RS: MR.flat('#c8caca'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#9aa0a4', fc: '#e8e8e4', rc: '#c8caca', fw: 'i:fw:soko' },
  { n: '銀色の塔・赤白のフレア', tw: '#c4c8cb', pp: '#8a9096', tc: '#c4c8cb', sp: '#e9e9e6', W: MW.panel('#c9cdd0'), wain: 0, rt: 'flat', RS: MR.flat('#babdbe'), bk: 3, bh: 'lo', dk: 0, dc: '#cfd2d3', pc: '#8a9096', fc: '#c4c8ca', rc: '#babdbe', fw: 'i:fw:soko' },
  { n: 'うす緑のタンク・灰色の塔', tw: '#a9adb0', pp: '#7d8a7a', tc: '#c9d8c8', sp: '#e2ebe1', W: MW.panel('#d5ddd3'), wain: 0, rt: 'flat', RS: MR.flat('#c2c8c0'), bk: 3, bh: 'lo', dk: 0, dc: '#cfd6cd', pc: '#7d8a7a', fc: '#cfd8cd', rc: '#c2c8c0', fw: 'i:fw:soko' },
  { n: '黄色い配管・白い球タンク', tw: '#e4e4e0', pp: '#d9b13a', tc: '#ece5cf', sp: '#f4f4f0', W: MW.panel('#efeae0'), wain: 0, rt: 'flat', RS: MR.flat('#c8c6c0'), bk: 3, bh: 'lo', dk: 0, dc: '#ddd9cf', pc: '#d9b13a', fc: '#ebe6dc', rc: '#c8c6c0', fw: 'i:fw:soko' }
];
function towers(B, P, L, fm, c, R) {
  const lod = P.lod, r = cellR(fm, c, 5), n = lod >= 2 ? 10 : lod >= 1 ? 6 : 4, k = cl(Math.round(rw(r) * rd(r) / 900), 2, lod >= 2 ? 6 : lod >= 1 ? 4 : 2);
  for (let i = 0; i < k; i++) { const x = r[0] + rw(r) * (0.15 + 0.7 * ((i * 0.618) % 1)), z = r[1] + rd(r) * (0.2 + 0.6 * ((i * 0.382 + 0.3) % 1)), rr = 1.6 + R() * 2.4, h = 30 + R() * 40;
    frustum(B, 'i:tank', x, z, rr, rr, 0, h, n, col(L.tw), [0, 2 * PI * rr / 16], [0, h / 16]); B.dome('c', x, z, rr, rr, h, rr * 0.6, n, col(L.tw), { rings: 1 });
    if (lod >= 2 && i < 4) for (let y = 12; y < h - 2; y += 16) frustum(B, 'c', x, z, rr + 1.0, rr + 1.0, y, y + 0.25, 8, col(L.pp)); }
  if (lod >= 1) { const a = fm.p(c.u0 + 2, (c.v0 + c.v1) / 2), b = fm.p(c.u1 - 2, (c.v0 + c.v1) / 2); pipeRack(B, a[0], a[1], b[0], b[1], 8, 5, lod); const a2 = fm.p((c.u0 + c.u1) / 2, c.v0 + 2), b2 = fm.p((c.u0 + c.u1) / 2, c.v1 - 2); pipeRack(B, a2[0], a2[1], b2[0], b2[1], 7, 4, lod);
    for (let i = 0; i < 2; i++) { const q = fm.p(c.u0 + (c.u1 - c.u0) * (0.25 + i * 0.5), c.v1 - 10); boxW(B, [q[0] - 6, q[1] - 4, q[0] + 6, q[1] + 4], 0, 9, MW.conc('#d9d9d4'), { ct: col('#8a8c8c') }); if (lod >= 2) for (const d of [-3, 3]) B.cyl('c', q[0] + d, q[1], 2.2, 9, 10.5, 8, col('#6a6c6c')); } }
}
function flare(B, P, L, fm, c, R) {
  const lod = P.lod, q = fm.p(c.u1 - 8, c.v1 - 8), h = 90;
  frustum(B, 'i:stack', q[0], q[1], 1.6, 0.9, 0, h, lod >= 1 ? 8 : 5, W1, [0.01, 0.24], [0.003, 0.997]);
  if (lod >= 1) { latTower(B, q[0], q[1], 7, 3, 0, h * 0.8, W1); for (let i = 0; i < 3; i++) B.tri('c', [q[0] + Math.cos(i * 2.1) * 1.2, h, q[1] + Math.sin(i * 2.1) * 1.2], [q[0], h + 7, q[1]], [q[0] + Math.cos(i * 2.1 + 2.1) * 1.2, h, q[1] + Math.sin(i * 2.1 + 2.1) * 1.2], null, [1.5, 0.75, 0.25]); }
  const r = cellR(fm, c, 6); tankYard(B, [r[0], r[1], r[2] - 16, r[3]], 3, L.tc, lod, R, {});
}
function spheres(B, P, L, fm, c, R) {
  const r = cellR(fm, c, 6), k = cl(Math.floor(rw(r) / 26), 1, 4), rr = cl(Math.min(rw(r) / k, rd(r)) * 0.3, 6, 11);
  for (let i = 0; i < k; i++) { const q = [r[0] + rw(r) * (i + 0.5) / k, r[1] + rd(r) * 0.35]; sphereT(B, q[0], q[1], rr, col(L.sp), P.lod); }
  if (P.lod >= 1) { const a = fm.p(c.u0 + 2, c.v1 - 6), b = fm.p(c.u1 - 2, c.v1 - 6); pipeRack(B, a[0], a[1], b[0], b[1], 6, 3, P.lod); }
}
A.arch('i_petro', {
  looks: PETRO,
  far(L, P) { return { H: 14, base: 0, wall: 'c', roof: null, rc: col(L.rc), rt: 'flat', ins: 4, wc: col(L.fc) }; },
  build(B, L, P) { heavySite(B, P, L, [towers, flare, spheres, (B2, P2, L2, fm, c, R) => tankYard(B2, cellR(fm, c, 4), 6, L2.tc, P2.lod, R, { r: cl(Math.min(c.u1 - c.u0, c.v1 - c.v0) * 0.16, 6, 16) })], { H: 9, ck: 0.45, maxU: 3, gr: 'i:cpad', gc: '#d6d4ce' }); }
});
// セメント ---------------------------------------------------------------
const CEMENT = [
  { n: '灰色の塔・白いサイロ', W: MW.paint('#c9c9c4'), wain: 1, rt: 'gable', p: 0.15, RS: MR.orib('#b5b5b0'), bk: 2, bh: 'hi', dk: 1, dc: '#b9bab5', tr: '#8f908c', fc: '#c4c4bf', rc: '#b5b5b0', fw: 'i:fw:koba', ph: '#a9aaa6', sl: '#eeeeea', kn: '#8a8c8a' },
  { n: '赤茶の塔・灰色サイロ', W: MW.paint('#d2c9bc'), wain: 1, rt: 'gable', p: 0.15, RS: MR.orib('#9a6a56'), bk: 2, bh: 'hi', dk: 1, dc: '#c9c0b2', tr: '#7d5a4a', fc: '#cec5b8', rc: '#9a6a56', fw: 'i:fw:koba', ph: '#9a5a44', sl: '#c9c7c1', kn: '#6a5a50' },
  { n: '青いトラス・ベージュ棟', W: MW.kaku('#dcd2be'), wain: 1, rt: 'barrel', p: 0.2, RS: MR.orib('#a9b2b8'), bk: 2, bh: 'hi', dk: 1, dc: '#d0c7b3', tr: '#8a8270', fc: '#d6ccb8', rc: '#a9b2b8', fw: 'i:fw:koba', ph: '#5d7f9f', sl: '#e2dfd8', kn: '#7a8a96' },
  { n: '黄色い塔・灰色のサイロ', W: MW.galv, wain: 1, rt: 'gable', p: 0.12, RS: MR.orib('#a9adae'), bk: 2, bh: 'hi', dk: 1, dc: '#c6c9c8', tr: '#8f9394', fc: '#b5b9bb', rc: '#a9adae', fw: 'i:fw:koba', ph: '#d9b13a', sl: '#b9bbbb', kn: '#9a9c9c' }
];
function preheater(B, P, L, fm, c, R) {
  const lod = P.lod, q = fm.p((c.u0 + c.u1) / 2 - 12, (c.v0 + c.v1) / 2), s = cl(Math.min(c.u1 - c.u0, c.v1 - c.v0) / 70, 0.55, 1.1), x = q[0], z = q[1], pc = col(L.ph);
  latTower(B, x, z, 22 * s, 18 * s, 0, 80 * s, pc); boxW(B, [x - 9 * s, z - 9 * s, x + 9 * s, z + 9 * s], 0, 76 * s, MW.conc('#d8d6d0'), { ct: mul(pc, 0.8) });
  B.box('c', x - 11 * s, z - 11 * s, x + 11 * s, z + 11 * s, 78 * s, 86 * s, pc);
  if (lod >= 1) { // ロータリーキルン（ななめの 円筒）と 煙突
    const a = fm.p((c.u0 + c.u1) / 2 - 12 + 10 * s, (c.v0 + c.v1) / 2), b = fm.p(c.u1 - 6, (c.v0 + c.v1) / 2), n = lod >= 2 ? 10 : 6, kc = col(L.kn), L2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2, r = 2.8 * s, ux = (b[0] - a[0]) / L2, uz = (b[1] - a[1]) / L2, P0 = (p, y, t) => [p[0] - uz * Math.cos(t) * r, y + Math.sin(t) * r, p[1] + ux * Math.cos(t) * r]; B.quad('c', P0(a, 9 * s, t0), P0(b, 5 * s, t0), P0(b, 5 * s, t1), P0(a, 9 * s, t1), null, kc); }
    for (let i = 1; i < 4; i++) { const t = i / 4, x2 = a[0] + (b[0] - a[0]) * t, z2 = a[1] + (b[1] - a[1]) * t; B.box('c', x2 - 1.5, z2 - 1.5, x2 + 1.5, z2 + 1.5, 0, 9 * s - (4 * s) * t - 2, col('#b9b7b0')); }
    chimney(B, x + 14 * s, z + 14 * s, 2.4, 90, 0, lod); }
}
function cemSilos(B, P, L, fm, c, R) { const r = cellR(fm, c, 6), rr = cl(Math.min(rw(r), rd(r)) / 6, 5, 9), nx = cl(Math.floor(rw(r) / (rr * 2.1)), 1, 4), nz = cl(Math.floor(rd(r) / (rr * 2.1)), 1, 2); silos(B, r[0], r[1], nx, nz, rr, 42, P.lod, col(L.sl)); if (P.lod >= 1) conveyor(B, (() => { const q = fm.p(c.u0 - 4, (c.v0 + c.v1) / 2); return [q[0], 2, q[1]]; })(), [r[0] + rr, 46, r[1] + rr], 2.5, P.lod); }
function limeStore(B, P, L, fm, c, R) { const G = RF(cellR(fm, c, 4)); shed(B, P, Object.assign({}, L, { rt: 'barrel', p: 0.3, bk: null }), G, 12, { fe: G.edges[fm.fi], ms: 60 }); if (P.lod >= 1) { const q = fm.p(c.u0 + 4, c.v0 + 4); pile(B, [q[0] - 10, q[1] - 6, q[0] + 10, q[1] + 6], 5, col('#d9d6cc')); } }
A.arch('i_cement', {
  looks: CEMENT,
  far(L, P) { return { H: 16, base: 0, wall: 'i:fw:koba', bw: 4, fh: 16, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 4, wc: col(L.fc) }; },
  build(B, L, P) { heavySite(B, P, L, [preheater, cemSilos, limeStore], { H: 14 + P.rng() * 3, ck: 0.5, maxU: 3, gr: 'i:cpad', gc: '#dedcd4' }); }
});
// 火力発電所 -------------------------------------------------------------
const POWER = [
  { n: '白い建屋・赤白の煙突', W: MW.panel('#efefec'), wain: 0, rt: 'flat', RS: MR.flat('#c8caca'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#9aa0a4', fc: '#ebebe8', rc: '#c8caca', fw: 'i:fw:soko', fuel: 'coal', nch: 1, bc: '#e9e9e6' },
  { n: '灰色の建屋・LNGタンク', W: MW.panel('#c4c8cb'), wain: 0, rt: 'flat', RS: MR.flat('#b5b8ba'), bk: 3, bh: 'lo', dk: 0, dc: '#cfd2d3', pc: '#8a9096', fc: '#bfc3c6', rc: '#b5b8ba', fw: 'i:fw:soko', fuel: 'lng', nch: 1, bc: '#c9cdd0' },
  { n: '青い帯・石炭の山', W: MW.panel('#ecece9'), wain: 0, rt: 'flat', RS: MR.flat('#c6c8c8'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#2f5f8a', stripe: '#2f5f8a', fc: '#e6e6e3', rc: '#c6c8c8', fw: 'i:fw:soko', fuel: 'coal', nch: 1, bc: '#e4e6e8' },
  { n: 'ベージュ・2本の煙突', W: MW.kaku('#ddd3bf'), wain: 0, rt: 'flat', RS: MR.flat('#c2c0b9'), bk: 3, bh: 'lo', dk: 0, dc: '#d0c8b6', pc: '#8a7d6a', fc: '#d8cebb', rc: '#c2c0b9', fw: 'i:fw:soko', fuel: 'oil', nch: 2, bc: '#d9d0bd' }
];
function powerBlock(B, P, L, fm, c, R) {
  const lod = P.lod, r = cellR(fm, c, 5), X = rw(r) >= rd(r), bh = 62 + R() * 15, tw = X ? rw(r) : rd(r);
  const boiler = X ? [r[0], r[1], r[0] + tw * 0.35, r[1] + rd(r) * 0.7] : [r[0], r[1], r[0] + rw(r) * 0.7, r[1] + tw * 0.35];
  const hall = X ? [r[0] + tw * 0.35, r[1], r[2], r[1] + rd(r) * 0.55] : [r[0], r[1] + tw * 0.35, r[0] + rw(r) * 0.55, r[3]];
  const G1 = RF(boiler), G2 = RF(hall);
  if (lod <= 0) { lowShed(B, P, G1, bh, L, { rt: 'flat', fh: 8 }); lowShed(B, P, G2, 28, L, { rt: 'flat', fh: 8 }); }
  else { for (const e of G1.edges) { clad(B, e, 0, e.L, 0, bh, L.W, 0.85); if (lod >= 2) for (let y = 12; y < bh - 4; y += 14) band(B, e, 2, e.L - 2, y, y + 1.6, 3, 4); } B.cap('i:flat', G1, bh, col('#c4c6c6'), { su: 16 });
    shed(B, P, Object.assign({}, L, { rt: 'barrel', p: 0.12 }), G2, 28, { fe: G2.edges[fm.fi], ms: 60 }); }
  const cr = X ? [r[0] + tw * 0.18, r[3] - 12] : [r[2] - 12, r[1] + tw * 0.18];
  for (let k = 0; k < (L.nch || 1); k++) chimney(B, cr[0] + (X ? k * 14 : 0), cr[1] + (X ? 0 : k * 14), 4.2, 180, 0, lod);
  if (lod >= 1) { const q = X ? [r[0] + tw * 0.7, r[3] - 10] : [r[2] - 10, r[1] + tw * 0.7]; for (let i = 0; i < 3; i++) { const x = q[0] + (X ? (i - 1) * 12 : 0), z = q[1] + (X ? 0 : (i - 1) * 12); B.box('c', x - 3, z - 2, x + 3, z + 2, 0, 5, col('#8a8e90')); if (lod >= 2) latTower(B, x, z, 2, 1.2, 5, 18, W1); } }
}
function fuelYard(B, P, L, fm, c, R) {
  const r = cellR(fm, c, 5);
  if (L.fuel === 'lng') tankYard(B, r, 3, '#e9eaea', P.lod, R, { r: cl(Math.min(rw(r), rd(r)) * 0.22, 12, 30), t: 'dome', h: 32 });
  else if (L.fuel === 'oil') tankYard(B, r, 4, '#e4e2dc', P.lod, R, { r: cl(Math.min(rw(r), rd(r)) * 0.18, 8, 22), t: 'flat' });
  else { oreYard(B, P, Object.assign({}, L, { ore: '#33312f' }), fm, c, R); }
}
A.arch('i_power', {
  looks: POWER,
  far(L, P) { return { H: 30, base: 0, wall: 'i:fw:soko', bw: 4, fh: 30, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 6, wc: col(L.fc) }; },
  build(B, L, P) { heavySite(B, P, L, [powerBlock, fuelYard, (B2, P2, L2, fm, c, R) => switchyard(B2, P2, fm, c, R)], { H: 12, ck: 0.5, maxU: 3, gr: 'i:cpad', gc: '#dcdad4' }); }
});
// 変電所の 鉄骨と 変圧器（ます c の中）
function switchyard(B, P, fm, c, R, o = {}) {
  const lod = P.lod, r = cellR(fm, c, 3), X = rw(r) >= rd(r), L1 = X ? rw(r) : rd(r), L2 = X ? rd(r) : rw(r), nb = cl(Math.floor(L1 / 14), 1, lod >= 2 ? 7 : 4), ng = cl(Math.floor(L2 / 18), 1, 2), h = o.h || 14;
  if (lod >= 1) B.cap('c', RF(r), 0.08, col('#a9a7a0'));
  const tc = col('#b9bcbe'), P2 = (i, j) => { const t = (i + 0.5) / nb, s2 = (j + 0.5) / ng; return X ? [r[0] + rw(r) * t, r[1] + rd(r) * s2] : [r[0] + rw(r) * s2, r[1] + rd(r) * t]; };
  for (let j = 0; j < ng; j++) {
    if (lod <= 0) { const a = P2(0, j), b = P2(nb - 1, j); B.box('c', Math.min(a[0], b[0]) - 0.5, Math.min(a[1], b[1]) - 0.5, Math.max(a[0], b[0]) + 0.5, Math.max(a[1], b[1]) + 0.5, h - 1.2, h, tc); continue; }
    for (let i = 0; i < nb; i++) { const [x, z] = P2(i, j); latTower(B, x, z, 1.4, 1.0, 0, h, tc); }
    const a = P2(0, j), b = P2(nb - 1, j); beam(B, 'c', [a[0], h - 0.5, a[1]], [b[0], h - 0.5, b[1]], 0.5, 0.6, tc, { sides: [1, 1, 1, 0] });
    for (let i = 0; i < nb; i += 2) { const [x, z] = P2(i, j), ox = X ? 0 : 5, oz = X ? 5 : 0; B.box('c', x + ox - 2.2, z + oz - 1.6, x + ox + 2.2, z + oz + 1.6, 0.08, 3.8, col('#8e9496'));
      if (lod >= 2) { B.box('c', x + ox - (X ? 1.4 : 0.15), z + oz - (X ? 0.15 : 1.4), x + ox + (X ? 1.4 : 0.15), z + oz + (X ? 0.15 : 1.4), 3.8, 5.6, col('#c9b9a0')); B.box('c', x + ox - 2.6, z + oz - 2.0, x + ox + 2.6, z + oz - 1.7, 0.6, 3.4, col('#6f7578')); } }
  }
}
// 清掃工場（ごみ焼却）----------------------------------------------------
const INCIN = [
  { n: '白とグレーの箱・白い煙突', wa: '#eeeeeb', wb: '#9aa2a8', rf: 'flat', ck: 3, ch: 59, fc: '#e6e6e3', rc: '#c4c6c6' },
  { n: 'レンガ色タイル・丸屋根', wa: '#b07a5e', wb: '#e6dfd2', rf: 'barrel', ck: 1, ch: 59, fc: '#ad7a60', rc: '#8f9496' },
  { n: 'ガラスと 白い外壁', wa: '#f2f2ef', wb: '#5d7486', rf: 'flat', ck: 3, ch: 80, glass: true, fc: '#e8eaea', rc: '#c8cbcb' },
  { n: 'ベージュの外壁・緑の帯', wa: '#e2d8c3', wb: '#5f8a6a', rf: 'shed', ck: 1, ch: 59, fc: '#ddd2bc', rc: '#7f9a86' },
  { n: '青い外壁・赤白の煙突', wa: '#8fb0c9', wb: '#eeeeea', rf: 'flat', ck: 0, ch: 100, fc: '#8fb0c9', rc: '#b9bcbd' }
];
A.arch('i_incin', {
  looks: INCIN,
  far(L, P) { const f = Math.max(1, P.f); return { H: 18 + f * 4, base: 0, wall: 'i:fw:soko', bw: 4, fh: 18 + f * 4, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 6, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f), H = 18 + f * 4;
    pave(B, P, F, 'i:asph');
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 2), fr), Wd = fm.W, D = fm.D;
    const fz = D > 45 ? cl(D * 0.25, 10, 40) : 3, bw = cl(Wd * 0.7, 10, 95), bd = cl((D - fz) * 0.8, 10, 75), u0 = (Wd - bw) / 2, G = RF(fm.r(u0, fz, u0 + bw, fz + bd)), fe = G.edges[fm.fi];
    const Wa = MW.panel(L.wa), Wb = MW.alc(L.wb);
    if (lod <= 0) { lowShed(B, P, G, H, { fc: L.fc, rc: L.rc, rt: 'flat', fw: 'i:fw:soko' }); }
    else {
      for (const e of G.edges) { clad(B, e, 0, e.L, 0, H * 0.35, Wb, 0.85); clad(B, e, 0, e.L, H * 0.35, H, Wa, 1); if (lod >= 2) { band(B, e, 2, e.L - 2, H * 0.35 + 1.5, H * 0.35 + 3, L.glass ? 6 : 3, 4); if (L.glass && e === fe) band(B, e, 2, e.L * 0.4, 1, H - 2, 6, 3.2, 0.1); } }
      if (L.rf === 'flat') { B.cap('i:flat', G, H, col('#c9cbcb'), { su: 16 }); if (lod >= 1) B.parapet(G, H, 1.0, 0.3, col(L.wb)); }
      else roofs(B, G, H, MR.orib(L.rc), Wa, { t: L.rf, p: L.rf === 'barrel' ? 0.14 : 0.12, lod, ms: 200, hi: 'n' });
      // ごみの車の スロープ（2階の 入口へ）
      if (lod >= 1 && fz > 12) { const a = fm.p(u0 + bw * 0.7, 1.5), b = fm.p(u0 + bw * 0.7, fz); beam(B, 'c', [a[0], 0.4, a[1]], [b[0], 8, b[1]], 7, 0.8, col('#bdbbb4')); door(B, fe, bw * 0.7, 6, 7.6, 5, 0, col('#d9dbdb')); }
    }
    const q = fm.p(u0 + bw * 0.2, fz + bd * 0.75); chimney(B, q[0], q[1], 3.4, Math.max(L.ch, H + 20), L.ck, lod);
    if (lod >= 2) { office(B, P, RF(fm.r(2, 2, Math.min(u0 - 2, 22) > 8 ? Math.min(u0 - 2, 22) : 14, Math.min(fz - 2, 14) > 6 ? Math.min(fz - 2, 14) : 10)), 2, 3.5, { ow: L.wa, pc: L.wb }, RF(fm.r(2, 2, 14, 10)).edges[fm.fi]); fence(B, F, 1.8, W1, 14, A.frontEdge(F, fr)); trees(B, fm, Wd, R, 1.2, 6);
      for (let i = 0; i < 3; i++) { const t = fm.p(u0 + bw * 0.7 + (i - 1) * 8, Math.max(4, fz * 0.4)); truck(B, t[0], t[1], fm.fa, { L: 7, cab: '#3f6f9a', box: '#3f6f9a', bh: 3.0 }); } }
  }
});

/* ---------- 港（i_port）：岸壁・上屋・荷役の クレーン・船。P.ko.t で 種類（port 港湾・navy 軍港・fish 漁港・marina・ferry・dock 乾ドック・yard 造船所）----------
   区画の 奥がわ（道の反対）を 水面にして 岸壁をつくる。陸は 少し高い エプロン */
// 引き込みクレーン（塔と ブーム）：岸壁の 上
function jib(B, x, z, ang, h, L, c, lod) {
  const cc = col(c), ca = Math.cos(ang), sa = Math.sin(ang);
  B.box('c', x - 3, z - 3, x + 3, z + 3, 0, 2.5, mul(cc, 0.8)); latTower(B, x, z, 4.5, 2.6, 2.5, h, cc);
  B.box('c', x - 2.4, z - 2.4, x + 2.4, z + 2.4, h, h + 3.5, col('#e9e9e6'));
  beam(B, 'c', [x, h + 1.5, z], [x + ca * L, h + L * 0.35, z + sa * L], 1.2, 1.4, cc);
  if (lod >= 2) beam(B, 'c', [x - ca * 2, h + 3.5, z - sa * 2], [x + ca * L, h + L * 0.35 + 0.2, z + sa * L], 0.2, 0.2, [0.25, 0.25, 0.25]);
}
// 浮き桟橋（マリーナ）
function pontoon(B, x0, z0, x1, z1) { B.box('c', x0, z0, x1, z1, -0.05, 0.45, col('#d9d6cf')); }
const PORT = [
  { n: '上屋と 赤白のクレーン', W: MW.galv, wain: 1.0, rt: 'gable', p: 0.12, RS: MR.orib('#b5b8b9'), bk: 2, bh: 'hi', dk: 0, dc: '#c9cccb', tr: '#9a9d9e', fc: '#b5b9bb', rc: '#b0b3b4', fw: 'i:fw:soko', cr: '#c8473a', yard: 'shed' },
  { n: '鉱石の山と 青いクレーン', W: MW.paint('#c9ccc8'), wain: 1.0, rt: 'gable', p: 0.12, RS: MR.orib('#9ea3a3'), bk: 2, bh: 'hi', dk: 0, dc: '#bfc4c2', tr: '#7e8483', fc: '#c2c5c1', rc: '#9ea3a3', fw: 'i:fw:soko', cr: '#3f6f9a', yard: 'ore', pc0: '#8a5a44' },
  { n: '石炭の山・ベルトコンベヤ', W: MW.paint('#d8d2c2'), wain: 1.0, rt: 'barrel', p: 0.2, RS: MR.orib('#8a8f90'), bk: 2, bh: 'hi', dk: 0, dc: '#c9c3b3', tr: '#7a7466', fc: '#d0cab9', rc: '#8a8f90', fw: 'i:fw:soko', cr: '#d9a12b', yard: 'coal', pc0: '#34322f' },
  { n: 'タンクの ならぶ 岸壁', W: MW.panel('#ecece8'), wain: 0, rt: 'flat', RS: MR.flat('#c8caca'), bk: 2, bh: 'hi', dk: 0, dc: '#d9dbdb', pc: '#9aa0a4', fc: '#e6e6e2', rc: '#c8caca', fw: 'i:fw:soko', cr: '#9aa0a4', yard: 'tank' },
  { n: '灰色上屋・黄色クレーン', W: MW.paint('#a9b0b4'), wain: 1.0, rt: 'gable', p: 0.1, RS: MR.orib('#8d9498'), bk: 2, bh: 'hi', dk: 0, dc: '#9aa2a6', tr: '#757c80', fc: '#a3aaae', rc: '#8d9498', fw: 'i:fw:soko', cr: '#d9b13a', yard: 'shed' }
];
const NAVPIER = [
  { n: '灰色の艦艇・白い建物', W: MW.panel('#ecece8'), wain: 0, rt: 'flat', RS: MR.flat('#c8caca'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#8d959c', fc: '#e6e6e2', rc: '#c8caca', fw: 'i:fw:soko', cr: '#8d959c', ships: 2 },
  { n: '灰色の艦艇・レンガ倉庫', W: MW.brick, wain: 0, rt: 'gable', p: 0.35, RS: MR.kawara, bk: 7, bh: 'lo', dk: 9, dc: '#ffffff', tr: '#4a4a48', fc: '#94563f', rc: '#5f646b', fw: 'i:fw:koba', cr: '#c8473a', ships: 2, ms: 20 },
  { n: '大きな艦艇・灰色の上屋', W: MW.paint('#a9b0b4'), wain: 1, rt: 'gable', p: 0.12, RS: MR.orib('#8d9498'), bk: 2, bh: 'hi', dk: 1, dc: '#9aa2a6', tr: '#757c80', fc: '#a3aaae', rc: '#8d9498', fw: 'i:fw:koba', cr: '#d9b13a', ships: 1, big: true },
  { n: '小さな艦艇が ならぶ', W: MW.paint('#c9ccc8'), wain: 1, rt: 'barrel', p: 0.18, RS: MR.orib('#7a8577'), bk: 2, bh: 'hi', dk: 1, dc: '#9aa597', tr: '#5c6858', fc: '#c2c5c1', rc: '#7a8577', fw: 'i:fw:koba', cr: '#8d959c', ships: 4 }
];
const FISH = [
  { n: '青い屋根の市場・白い漁船', W: MW.panel('#eeeeea'), wain: 0, rt: 'gable', p: 0.15, RS: MR.orib('#4f7aa6'), bk: 2, bh: 'hi', dk: 4, dc: '#ffffff', tr: '#3f6a96', fc: '#e8e8e4', rc: '#4f7aa6', fw: 'i:fw:soko', boat: '#eeeeea' },
  { n: '赤い屋根の市場', W: MW.panel('#ece9e2'), wain: 0, rt: 'gable', p: 0.15, RS: MR.orib('#a8483a'), bk: 2, bh: 'hi', dk: 4, dc: '#ffffff', tr: '#8a3a30', fc: '#e6e2da', rc: '#a8483a', fw: 'i:fw:soko', boat: '#eeeeea' },
  { n: '灰色屋根・色々な漁船', W: MW.galv, wain: 1, rt: 'gable', p: 0.12, RS: MR.orib('#9a9e9f'), bk: 2, bh: 'hi', dk: 4, dc: '#ffffff', tr: '#7d8182', fc: '#b5b9bb', rc: '#9a9e9f', fw: 'i:fw:soko', boat: 'mix' },
  { n: '古い木の小屋・小さな漁船', W: MW.wood, wain: 0, rt: 'gable', p: 0.3, RS: MR.orust('#b7b1a6'), bk: 4, bh: 'lo', dk: 8, dc: '#ffffff', tr: '#4a3a30', fc: '#6b5543', rc: '#8a7a6a', fw: 'i:fw:koba', boat: '#e9e6dc' }
];
const MARINA = [
  { n: '白いクラブハウス・ヨット', W: MW.alc('#f4f4f1'), wain: 0, rt: 'flat', RS: MR.flat('#d2d4d4'), bk: 6, bh: 'lo', dk: 6, dc: '#ffffff', pc: '#d9dbdb', fc: '#efefec', rc: '#d2d4d4', fw: 'i:fw:ofc', sail: true },
  { n: '木のデッキ・ボート', W: MW.wood, wain: 0, rt: 'gable', p: 0.25, RS: MR.orib('#5c524a'), bk: 0, bh: 'lo', dk: 6, dc: '#ffffff', tr: '#4a423c', fc: '#6b5543', rc: '#5c524a', fw: 'i:fw:koba', sail: false },
  { n: '青い屋根・陸置きボート', W: MW.panel('#eeeeea'), wain: 0, rt: 'gable', p: 0.12, RS: MR.orib('#4f7aa6'), bk: 2, bh: 'hi', dk: 0, dc: '#d9dbdb', tr: '#3f6a96', fc: '#e8e8e4', rc: '#4f7aa6', fw: 'i:fw:soko', sail: true, rack: true },
  { n: 'ガラスのクラブハウス', W: MW.panel('#c9cdcf'), wain: 0, rt: 'flat', RS: MR.flat('#bfc2c3'), bk: 6, bh: 'lo', dk: 6, dc: '#ffffff', pc: '#a9adb0', fc: '#c4c8ca', rc: '#bfc2c3', fw: 'i:fw:ofc', sail: false }
];
const FERRY = [
  { n: '白いターミナル・青い船', W: MW.alc('#f2f2ef'), wain: 0, rt: 'flat', RS: MR.flat('#cfd1d1'), bk: 6, bh: 'lo', dk: 6, dc: '#ffffff', pc: '#3f6f9a', stripe: '#3f6f9a', fc: '#ecece9', rc: '#cfd1d1', fw: 'i:fw:ofc', fun: '#3f6f9a' },
  { n: 'ガラスの建物・白い船', W: MW.panel('#c9cdcf'), wain: 0, rt: 'barrel', p: 0.12, RS: MR.orib('#d0d3d5'), bk: 6, bh: 'lo', dk: 6, dc: '#ffffff', tr: '#a9adb0', fc: '#c4c8ca', rc: '#d0d3d5', fw: 'i:fw:ofc', fun: '#e9e9e6' },
  { n: 'ベージュ・赤い煙突の船', W: MW.alc('#e6dcc8'), wain: 0, rt: 'gable', p: 0.15, RS: MR.orib('#7a6a5a'), bk: 0, bh: 'lo', dk: 6, dc: '#ffffff', tr: '#5a4a3a', fc: '#e0d6c2', rc: '#7a6a5a', fw: 'i:fw:ofc', fun: '#b8473a' },
  { n: 'グレー・緑の煙突の船', W: MW.panel('#b9bdc0'), wain: 0, rt: 'flat', RS: MR.flat('#b5b8ba'), bk: 3, bh: 'lo', dk: 6, dc: '#ffffff', pc: '#5f8a6a', stripe: '#5f8a6a', fc: '#b5b9bc', rc: '#b5b8ba', fw: 'i:fw:ofc', fun: '#4f7f5f' }
];
const DOCKL = [
  { n: '赤白クレーン・灰色上屋', W: MW.galv, wain: 1, rt: 'gable', p: 0.12, RS: MR.orib('#a9adae'), bk: 2, bh: 'hi', dk: 1, dc: '#c6c9c8', tr: '#8f9394', fc: '#b3b8ba', rc: '#a5a9aa', fw: 'i:fw:koba', cr: '#c8473a', hull: '#8a3a30' },
  { n: '黄色いクレーン・青い上屋', W: MW.paint('#8fa9c0'), wain: 1, rt: 'gable', p: 0.1, RS: MR.orib('#7f97ab'), bk: 2, bh: 'hi', dk: 1, dc: '#8fa9c0', tr: '#5f7d98', fc: '#8fa9c0', rc: '#7f97ab', fw: 'i:fw:koba', cr: '#d9b13a', hull: '#3f5f7f' },
  { n: '青いクレーン・白い上屋', W: MW.panel('#eeeeea'), wain: 0, rt: 'flat', RS: MR.flat('#c8caca'), bk: 3, bh: 'lo', dk: 0, dc: '#d9dbdb', pc: '#3f6f9a', stripe: '#3f6f9a', fc: '#e6e6e2', rc: '#c8caca', fw: 'i:fw:soko', cr: '#3f6f9a', hull: '#5f6a72' },
  { n: '白クレーン・赤さび上屋', W: MW.rust, wain: 0, rt: 'gable', p: 0.2, RS: MR.orust('#c5c0b6'), bk: 2, bh: 'hi', dk: 1, dc: '#a08c78', tr: '#6e4a38', fc: '#9e8a76', rc: '#8c6c58', fw: 'i:fw:koba', cr: '#e9e9e6', hull: '#2f3f4f' }
];
A.arch('i_port', {
  looks: PORT,
  far(L, P) { const t = (P.ko || {}).t || 'port'; return { H: t === 'marina' ? 4 : t === 'fish' ? 6 : 10, base: 0.6, wall: L.fw || 'i:fw:soko', bw: 4, fh: 8, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'flat', ins: 6, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], t = P.ko.t || 'port', base = t === 'marina' || t === 'fish' ? 0.8 : 1.2;
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(r0, fr), Wd = fm.W, D = fm.D;
    const wz = cl(D * (t === 'marina' ? 0.55 : t === 'dock' ? 0.15 : 0.35), 8, t === 'marina' ? 200 : 90), land = D - wz;
    // 陸（エプロン）：少し高い
    const LG = RF(fm.r(0, 0, Wd, land));
    if (lod >= 1 || P.yb < -0.5) B.plinth(LG, P.yb, base); B.cap(t === 'marina' ? 'i:cpad' : 'i:asph', LG, base, t === 'marina' ? col('#e0ddd5') : W1, { su: 16 });
    for (const r of F.rects) if (r !== r0 && lod >= 1) { B.plinth(RF(r), P.yb, base); B.cap('i:asph', RF(r), base, W1, { su: 16 }); }
    B.oy += base * A.U; const BY = B.oy;   // ここから上は エプロンの高さ
    const done = () => { B.oy = BY - base * A.U; };
    quayZ(B, P, fm, land, D, Wd, base);
    if (t === 'port' || t === 'navy') {
      const ns = t === 'navy' ? (L.ships || 2) : 1, sl = t === 'navy' ? (L.big ? 180 : L.ships > 2 ? 70 : 120) : 140;
      for (let i = 0; i < ns && lod >= 1; i++) { const L2 = Math.min(Wd / ns * 0.85, sl), q = fm.p(Wd * (i + 0.5) / ns, land + 2 + L2 * (t === 'navy' ? 0.07 : 0.09) + 2); ship(B, q[0], q[1] + 0, fm.ua, L2, t === 'navy' ? 'navy' : (L.yard === 'ore' || L.yard === 'coal' ? 'bulk' : L.yard === 'tank' ? 'tanker' : 'bulk'), lod, R); void q; }
      const ny = cl(Math.round(Wd / 60), 1, 4);
      for (let i = 0; i < ny; i++) { const u0 = Wd * i / ny + 4, u1 = Wd * (i + 1) / ny - 4, v1 = land - 18, v0 = Math.max(4, land * 0.15);
        if (v1 - v0 < 8) continue;
        if (t === 'navy' || L.yard === 'shed') { const G = RF(fm.r(u0, v0, u1, v1)); shed(B, P, L, G, 9, { fe: G.edges[(fm.fi + 2) % 4], ms: 30 }); }
        else if (L.yard === 'tank') tankYard(B, fm.r(u0, v0, u1, v1), 3, '#eeeeea', lod, R, {});
        else if (lod >= 0) pile(B, fm.r(u0 + 2, v0 + 2, u1 - 2, v1 - 2), cl(Math.min(u1 - u0, v1 - v0) * 0.25, 4, 14), col(L.pc0 || '#7a6a5a')); }
      if (lod >= 1) { const nc = cl(Math.round(Wd / 50), 1, 4); for (let i = 0; i < nc; i++) { const q = fm.p(Wd * (i + 0.5) / nc, land - 7); jib(B, q[0], q[1], fm.fa + PI, 24, 26, L.cr, lod); } }
      if (L.yard === 'coal' && lod >= 1) { const a = fm.p(Wd * 0.2, land - 8), b = fm.p(Wd * 0.8, land - 8); conveyor(B, [a[0], 9, a[1]], [b[0], 9, b[1]], 2.4, lod); }
    } else if (t === 'fish') {
      const nb = cl(Math.round(Wd / 14), 1, lod >= 2 ? 8 : 4);
      for (let i = 0; i < nb && lod >= 1; i++) { const L2 = 10 + R() * 8, q = fm.p(Wd * (i + 0.5) / nb, land + 3 + L2 * 0.15 + (i % 2) * 2); ship(B, q[0], q[1], fm.ua + PI / 2 + (R() < 0.5 ? 0 : PI), L2, 'fish', lod, R); }
      const G = RF(fm.r(Wd * 0.08, land - Math.min(18, land * 0.6), Wd * 0.75, land - 2)); shed(B, P, L, G, 6, { fe: G.edges[(fm.fi + 2) % 4], ms: 24 });
      if (lod >= 2) { for (let i = 0; i < 6; i++) { const q = fm.p(Wd * (0.1 + 0.6 * R()), land - 1.2); B.box('c', q[0] - 0.6, q[1] - 0.4, q[0] + 0.6, q[1] + 0.4, 0, 0.3 + 0.3 * (R() * 3 | 0), col('#3f6aa0')); } const n = fm.p(Wd * 0.9, land - 5); B.box('c', n[0] - 3, n[1] - 2, n[0] + 3, n[1] + 2, 0, 1.0, col('#4f6a5a')); }
      if (land > 24 && lod >= 1) { const G2 = RF(fm.r(Wd * 0.78, 3, Wd - 2, Math.min(land - 4, 16))); boxW(B, G2.rects[0], 0, 9, MW.panel('#e9e9e6'), { ct: col('#b9bcbd') }); }
    } else if (t === 'marina') {
      const np = cl(Math.round(Wd / 30), 1, 5), pw = 2.2;
      for (let i = 0; i < np; i++) { const u = Wd * (i + 0.5) / np, a = fm.r(u - pw / 2, land, u + pw / 2, D - 6); B.oy = BY - base * A.U; pontoon(B, a[0], a[1], a[2], a[3]); B.oy = BY;
        if (lod >= 1) { const nb = Math.max(1, Math.floor((D - 6 - land) / 7)), mx = Math.ceil((lod >= 2 ? 28 : 10) / np / 2); for (let k = 0; k < Math.min(nb, mx); k++) for (const sg of [-1, 1]) { if (R() < 0.3) continue; const L2 = 8 + R() * 5, q = fm.p(u + sg * (pw / 2 + 1.6 + L2 * 0.12), land + 4 + k * 7); B.oy = BY - base * A.U; ship(B, q[0], q[1], fm.ua + PI / 2, L2, L.sail && R() < 0.7 ? 'boat' : 'boat', lod, R); B.oy = BY; } } }
      const G = RF(fm.r(Wd * 0.1, Math.max(2, land - 16), Math.min(Wd * 0.45, Wd * 0.1 + 30), land - 3)); shed(B, P, L, G, 7, { fe: G.edges[(fm.fi + 2) % 4], ms: 30 });
      if (L.rack && lod >= 2) for (let i = 0; i < 6; i++) { const q = fm.p(Wd * 0.55 + i * 4, land * 0.5); ship(B, q[0], q[1], fm.fa, 8, 'boat', lod, R); }
    } else if (t === 'ferry') {
      const L2 = Math.min(Wd * 0.85, 170), q = fm.p(Wd * 0.5, land + 2 + L2 * 0.08 + 2);
      if (lod >= 1) { const sh0 = B.mark(); ship(B, q[0], q[1], fm.ua, L2, 'ferry', lod, R); void sh0; const f2 = fm.p(Wd * 0.5 - L2 * 0.2, land + 2 + L2 * 0.08 + 2); B.box('c', f2[0] - 2.4, f2[1] - 2.4, f2[0] + 2.4, f2[1] + 2.4, L2 * 0.09 * 2.5, L2 * 0.09 * 3.0, col(L.fun)); }
      const tw = cl(Wd * 0.4, 14, 60), G = RF(fm.r(Wd * 0.05, Math.max(3, land - 26), Wd * 0.05 + tw, land - 6)), fe = G.edges[fm.fi];
      const top = shed(B, P, L, G, 9.5, { fe, f: 2, multi: true, ms: 40 });
      if (lod >= 1) { const a = fm.p(Wd * 0.05 + tw * 0.7, land - 6), b = fm.p(Wd * 0.05 + tw * 0.7, land + 4); beam(B, 'c', [a[0], 7.5, a[1]], [b[0], 6.5, b[1]], 3, 3, col('#d9dbdb')); }   // 乗船橋
      if (lod >= 2) { for (let i = 0; i < 5; i++) { const u = Wd * 0.55 + i * 7; if (u > Wd - 4) break; const a = fm.p(u, 4), b = fm.p(u, land - 4); B.quad('c', [a[0] - 0.1, 0.03, a[1]], [a[0] + 0.1, 0.03, a[1]], [b[0] + 0.1, 0.03, b[1]], [b[0] - 0.1, 0.03, b[1]], null, [0.92, 0.92, 0.9]); for (let k = 0; k < 4; k++) { const c2 = fm.p(u + 3.5, 8 + k * 6); car1(B, c2[0], c2[1], fm.fa + PI / 2, A.pick(R, CARS), 0.03); } } }
      void top;
    } else if (t === 'dock' || t === 'yard') {
      // 船台・乾ドック：陸の中に 長い みぞ（ドック）と 船。門形クレーン
      const dw = cl(Wd * 0.28, 24, 60), du0 = Wd * 0.5 - dw / 2, dv0 = Math.max(4, land * 0.12);
      if (t === 'dock') { const P3 = (u, v, y) => { const q = fm.p(u, v); return [q[0], y, q[1]]; }; B.quad('c', P3(du0, dv0, 0.06 - base + 0.2), P3(du0 + dw, dv0, 0.06 - base + 0.2), P3(du0 + dw, land, 0.06 - base + 0.2), P3(du0, land, 0.06 - base + 0.2), null, col('#8a8a84'));
        for (const [a, b] of [[[du0, dv0], [du0 + dw, dv0]], [[du0 + dw, dv0], [du0 + dw, land]], [[du0, land], [du0, dv0]]]) { const p0 = fm.p(a[0], a[1]), p1 = fm.p(b[0], b[1]); B.wall('i:conc', p1[0], p1[1], p0[0], p0[1], -base + 0.25, 0.02, W1, [0, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 8, 0, base / 8]); } }
      if (lod >= 1) { const L2 = Math.min((land - dv0) * 0.95, 200), q = fm.p(Wd * 0.5, dv0 + (land - dv0) * 0.5); B.oy = BY - (t === 'dock' ? base - 0.3 : 0) * A.U; ship(B, q[0], q[1], fm.fa + PI / 2, Math.max(40, L2), t === 'dock' ? 'bulk' : 'bulk', lod, R); B.oy = BY; void L2; }
      gantry(B, fm, du0 - 6, du0 + dw + 6, dv0 + (land - dv0) * 0.45, cl(dw * 1.3, 35, 80), L.cr, lod);
      const sw = (Wd - dw) / 2 - 12; if (sw > 12) for (const u0 of [4, du0 + dw + 8]) { const G = RF(fm.r(u0, dv0, u0 + sw, Math.min(land - 6, dv0 + 90))); shed(B, P, L, G, 18, { fe: G.edges[fm.fi], dside: true, ms: 40 }); }
      if (lod >= 1) { const q = fm.p(du0 - 10, land - 10); jib(B, q[0], q[1], fm.fa + PI, 30, 30, L.cr, lod); }
    }
    if (lod >= 2) fence(B, F, 2.0, W1, 12, A.frontEdge(F, fr));
    done();
  }
});
// 海がわの 水面と 岸壁（v0〜v1）
function quayZ(B, P, fm, v0, v1, Wd, base) {
  const wy = -base + 0.2, P3 = (u, v, y) => { const q = fm.p(u, v); return [q[0], y, q[1]]; };
  B.quad('i:water', P3(0, v0, wy), P3(Wd, v0, wy), P3(Wd, v1, wy), P3(0, v1, wy), null, W1, [0, v0 / 32, Wd / 32, v0 / 32, Wd / 32, v1 / 32, 0, v1 / 32]);
  const a = fm.p(0, v0), b = fm.p(Wd, v0); B.wall('i:conc', b[0], b[1], a[0], a[1], wy - 0.1, 0.03, W1, [0, Wd / 8, 0, base / 8]);
  for (const u of [0, Wd]) { const p0 = fm.p(u, v0), p1 = fm.p(u, v1); B.wall('i:conc', p0[0], p0[1], p1[0], p1[1], wy - 0.1, wy + 0.25, W1, [0, (v1 - v0) / 8, 0, 0.05]); }
  if (P.lod >= 2) { B.quad('c', P3(0, v0 - 0.5, 0.05), P3(Wd, v0 - 0.5, 0.05), P3(Wd, v0, 0.05), P3(0, v0, 0.05), null, [0.86, 0.76, 0.32]); const nb = Math.max(1, Math.floor(Wd / 20)); for (let i = 0; i < nb; i++) { const q = fm.p((i + 0.5) * Wd / nb, v0 - 1.0); B.cyl('c', q[0], q[1], 0.3, 0, 0.7, 6, [0.25, 0.25, 0.25]); } }
}

/* ---------- 空港（i_air）：滑走路・誘導路・エプロン・ターミナル（大きい空港は ボーディングブリッジ）・管制塔・駐車場 ----------
   i:run：帯 0 滑走路（中心線・両はし の線）・1 誘導路（黄色い中心線）・2 しま模様（滑走路のはし）・3 ヘリポートの円 */
A.tex('i:run', 256, 256, (g, w, h, R) => {
  const sh = h / 4;
  rect(g, 0, 0, w, h, '#5c5e5f'); PT.noise(g, 0, 0, w, h, 0.05, R); blots(g, 0, 0, w, sh * 3, 20, '30,30,30', 0.12, R, 0.06, 0.3);
  rect(g, 0, sh * 0.06, w, sh * 0.03, '#e9e9e4'); rect(g, 0, sh * 0.91, w, sh * 0.03, '#e9e9e4'); rect(g, 0, sh * 0.485, w * 0.55, sh * 0.03, '#e9e9e4');   // 滑走路
  rect(g, 0, sh * 1.485, w, sh * 0.03, '#e0b23a'); rect(g, 0, sh + sh * 0.04, w, sh * 0.02, '#e0b23a'); rect(g, 0, sh + sh * 0.94, w, sh * 0.02, '#e0b23a');   // 誘導路
  for (let i = 0; i < 12; i++) if (i !== 5 && i !== 6) rect(g, w * 0.1, sh * 2 + sh * (0.06 + i * 0.075), w * 0.6, sh * 0.05, '#ececE6');   // しま
  { const y = sh * 3; rect(g, 0, y, w, sh, '#b9b7b0'); g.strokeStyle = '#f0f0ea'; g.lineWidth = sh * 0.05; g.beginPath(); g.arc(w / 2, y + sh / 2, sh * 0.42, 0, PI * 2); g.stroke(); g.strokeStyle = '#e0b23a'; g.beginPath(); g.arc(w / 2, y + sh / 2, sh * 0.3, 0, PI * 2); g.stroke(); rect(g, w / 2 - sh * 0.12, y + sh / 2 - sh * 0.12, sh * 0.24, sh * 0.24, '#f0f0ea'); }
});
// 帯つきの 平らな 長方形（frame の u0..u1 × v0..v1：u 方向に くり返す。k：i:run の帯）
function strip(B, fm, u0, v0, u1, v1, y, k, su) { const P3 = (u, v) => { const q = fm.p(u, v); return [q[0], y, q[1]]; }, [a, b] = SV(k, 4, 0.02); B.quad('i:run', P3(u0, v0), P3(u1, v0), P3(u1, v1), P3(u0, v1), null, W1, [u0 / su, a, u1 / su, a, u1 / su, b, u0 / su, b]); }
function stripV(B, fm, u0, v0, u1, v1, y, k, su) { const P3 = (u, v) => { const q = fm.p(u, v); return [q[0], y, q[1]]; }, [a, b] = SV(k, 4, 0.02); B.quad('i:run', P3(u0, v0), P3(u0, v1), P3(u1, v1), P3(u1, v0), null, W1, [v0 / su, a, v1 / su, a, v1 / su, b, v0 / su, b]); }
// 管制塔（x, z・高さ h・はば w）
function ctower(B, x, z, h, w, c, lod, gl) {
  const n = lod >= 1 ? 8 : 4, cc = col(c);
  frustum(B, 'i:conc', x, z, w * 0.42, w * 0.32, 0, h, n, cc, [0, 2 * PI * w * 0.4 / 8], [0, h / 8]);
  if (lod <= 0) { frustum(B, 'c', x, z, w * 0.5, w * 0.62, h, h + 6.2, n, col(gl || '#5d6a78')); fan(B, x, z, w * 0.62, h + 6.2, h + 7.2, n, mul(cc, 0.9)); return h + 7.2; }
  frustum(B, 'c', x, z, w * 0.34, w * 0.6, h, h + 2.4, n, mul(cc, 0.9));
  const [v0, v1] = SV(6, 8, 0.02); for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2, r0 = w * 0.6, r1 = w * 0.66; B.quad('i:win', [x + Math.cos(t0) * r0, h + 2.4, z + Math.sin(t0) * r0], [x + Math.cos(t1) * r0, h + 2.4, z + Math.sin(t1) * r0], [x + Math.cos(t1) * r1, h + 6.2, z + Math.sin(t1) * r1], [x + Math.cos(t0) * r1, h + 6.2, z + Math.sin(t0) * r1], null, W1, [0, v0, 0.5, v0, 0.5, v1, 0, v1]); }
  frustum(B, 'c', x, z, w * 0.7, w * 0.4, h + 6.2, h + 7.2, n, col(gl || '#5d6a78')); fan(B, x, z, w * 0.4, h + 7.2, h + 7.4, n, col(gl || '#5d6a78'));
  if (lod >= 2) { B.box('c', x - 0.1, z - 0.1, x + 0.1, z + 0.1, h + 7.2, h + 12, [0.85, 0.85, 0.85]); B.box('c', x + w * 0.2 - 0.8, z - 0.8, x + w * 0.2 + 0.8, z + 0.8, h + 7.4, h + 8.6, [0.9, 0.9, 0.88]); }
  return h + 7.4;
}
const AIR = [
  { n: '白いターミナル・ガラス', W: MW.panel('#f2f2ef'), tw: '#f2f2ef', rt: 'flat', RS: MR.flat('#d2d4d4'), fc: '#eeeeeb', rc: '#cfd1d1', tail: ['#3f5f86', '#8a3a33', '#5a6a5a', '#2f7a86'], ctc: '#ecebe6', gl: '#4f6a80' },
  { n: '波形の屋根・グレー', W: MW.panel('#c9cdcf'), tw: '#c9cdcf', rt: 'barrel', RS: MR.orib('#c3c7c9'), fc: '#c4c8ca', rc: '#c3c7c9', tail: ['#4a5a8a', '#a8483a', '#4f7f5f', '#d9a12b'], ctc: '#d9d9d4', gl: '#3f4f5f' },
  { n: 'ベージュ・低い屋根', W: MW.alc('#e4dac6'), tw: '#e4dac6', rt: 'gable', RS: MR.orib('#8a7d6a'), fc: '#ddd3bf', rc: '#8a7d6a', tail: ['#6a3a3a', '#2f5f8a', '#5a6a3a', '#8a8f94'], ctc: '#e2dccf', gl: '#5d5040' },
  { n: '銀色の大屋根', W: MW.kaku('#cdd1d4'), tw: '#cdd1d4', rt: 'barrel', RS: MR.orib('#dfe2e4'), fc: '#c8ccd0', rc: '#dfe2e4', tail: ['#3f6f9a', '#5d6a78', '#8a3a33', '#e9e9e6'], ctc: '#d0d3d6', gl: '#2f3f4f' }
];
A.arch('i_air', {
  looks: AIR,
  far(L, P) { return { H: 0.3, base: 0.05, wall: 'c', ct: col('#8a9086'), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], sz = P.ko.sz || 1;   // sz：0 飛行場・1 地方・2 空港・3 国際
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.04);
    B.cap('i:lawn', F, 0.04, col('#ffffff'), { su: 24 });
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm0 = frame(r0, fr);
    // 滑走路は 長いほうに。道がわ（v=0）が ターミナル
    const along = fm0.W >= fm0.D * 0.8, fm = fm0, Wd = fm.W, D = fm.D;
    const rwW = sz === 0 ? 30 : sz >= 3 ? 60 : 45, nr = sz >= 3 && D > 500 ? 2 : 1, ap = cl(D * (sz >= 2 ? 0.34 : 0.28), 40, 260), tz = cl(D * 0.12, 20, 80);
    const L0 = Wd - 20, vr = D - rwW - 12;
    for (let k = 0; k < nr; k++) { const v = vr - k * (rwW + 160); strip(B, fm, 10, v, Wd - 10, v + rwW, 0.07, 0, 60); if (lod >= 1) { stripV(B, fm, 10, v, 40, v + rwW, 0.08, 2, rwW); stripV(B, fm, Wd - 40, v, Wd - 10, v + rwW, 0.08, 2, rwW); } }
    strip(B, fm, 20, vr - 46, Wd - 20, vr - 23, 0.07, 1, 30);   // 誘導路
    for (const u of [30, Wd / 2, Wd - 30]) stripV(B, fm, u - 11, ap + tz, u + 11, vr - 23, 0.075, 1, 30);
    // エプロン（コンクリート）
    const P3 = (u, v, y) => { const q = fm.p(u, v); return [q[0], y, q[1]]; };
    B.quad('i:cpad', P3(Wd * 0.08, tz, 0.072), P3(Wd * 0.92, tz, 0.072), P3(Wd * 0.92, tz + ap, 0.072), P3(Wd * 0.08, tz + ap, 0.072), null, col('#dddbd4'), [Wd * 0.08 / 16, tz / 16, Wd * 0.92 / 16, tz / 16, Wd * 0.92 / 16, (tz + ap) / 16, Wd * 0.08 / 16, (tz + ap) / 16]);
    // ターミナル
    const tw = cl(Wd * (sz >= 2 ? 0.5 : 0.3), 30, 600), td = cl(tz * 0.9, 16, 70), u0 = (Wd - tw) / 2, G = RF(fm.r(u0, Math.max(2, tz - td), u0 + tw, tz)), fe = G.edges[fm.fi], ae = G.edges[(fm.fi + 2) % 4], H = sz >= 2 ? 22 : sz === 1 ? 14 : 8;
    if (lod <= 0) lowShed(B, P, G, H, { fc: L.fc, rc: L.rc, rt: L.rt, fw: 'i:fw:ofc' }, { fh: 6 });
    else { for (const e of G.edges) { clad(B, e, 0, e.L, 0, H, L.W, 0.85); if (lod >= 2) band(B, e, 1, e.L - 1, 1, H - 1.5, 6, 3.2, 0.08); }
      roofs(B, G, H, L.RS, L.W, { t: L.rt === 'gable' ? 'gable' : L.rt, p: 0.08, lod, ms: 80, ax: fm.s === 'S' || fm.s === 'N' ? 'x' : 'z', pc: mul(col(L.tw), 0.9) });
      if (lod >= 1) B.ledge(fe, H - 3, H - 2.4, 8, mul(col(L.tw), 0.95), { m: 'c' }); }
    // 飛行機と ボーディングブリッジ
    const ng = sz === 0 ? 2 : cl(Math.floor(tw / 55), 1, lod >= 2 ? 12 : 6), pl = sz === 0 ? 11 : sz === 1 ? 36 : 52;
    for (let i = 0; i < ng; i++) { const u = u0 + tw * (i + 0.5) / ng, q = fm.p(u, tz + pl * 0.62 + 6);
      if (lod >= 1) plane(B, q[0], q[1], fm.fa, pl * (0.85 + 0.25 * R()), '#f2f2ef', A.pick(R, L.tail), lod, 0.07);
      if (sz >= 1 && lod >= 1) { const a = fm.p(u + 6, tz), b = fm.p(u + 3, tz + 16); beam(B, 'c', [a[0], 5, a[1]], [b[0], 4.6, b[1]], 3, 3, col('#c9ccce')); } }
    if (lod >= 1) { const cq = fm.p(u0 + tw + Math.min(40, (Wd - u0 - tw) * 0.5), tz * 0.6); ctower(B, cq[0], cq[1], sz >= 2 ? 60 : sz === 1 ? 32 : 16, sz >= 2 ? 12 : 8, L.ctc, lod, L.gl); }
    if (lod >= 2) { parkLot(B, fm, 6, 2, Math.max(8, u0 - 6), Math.max(6, tz - 2), R, lod, 0.7); fence(B, F, 2.4, W1, 30, A.frontEdge(F, fr));
      for (let i = 0; i < 4; i++) { const q = fm.p(u0 + tw * R(), tz + 3 + R() * 8); B.obox('c', q[0], q[1], fm.ua, 3.5, 1.8, 0.07, 1.6, A.pick(R, ['#e9e9e6', '#d9a12b', '#3f6aa0']), {}); }
      if (sz <= 1) { const G2 = RF(fm.r(Wd * 0.8, tz, Wd * 0.8 + 30, tz + 26)); hangarBody(B, P, HANGAR[1], G2, 11, G2.edges[(fm.fi + 2) % 4]); } }
    void along; void L0;
  }
});
A.tex('i:lawn', 256, 256, (g, w, h, R) => { rect(g, 0, 0, w, h, '#86a05e'); for (let i = 0; i < 4; i++) rect(g, i * w / 4, 0, w / 8, h, 'rgba(255,255,255,.05)'); PT.noise(g, 0, 0, w, h, 0.06, R, 2); blots(g, 0, 0, w, h, 14, '70,90,40', 0.15, R, 0.1); });
// ヘリポート（f=0）
const HELI = [
  { n: '白い床・黄色い円', gc: '#d6d4cc', h: '#e9e9e6' },
  { n: 'アスファルトの台・白い円', gc: '#9a9c9c', h: '#3f6f9a' },
  { n: '芝生の中の パッド', gc: '#ffffff', grass: true, h: '#d0742e' },
  { n: '高い台の ヘリポート', gc: '#cfcdc6', deck: true, h: '#e9e9e6' }
];
A.arch('i_heli', {
  looks: HELI,
  far(L, P) { return { H: L.deck ? 6 : 0.3, base: 0.05, wall: 'c', ct: col(L.grass ? '#8aa060' : L.gc), wc: col('#c9c7c0'), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1];
    B.plinth(F, P.yb, 0.05); B.cap(L.grass ? 'i:lawn' : 'i:cpad', F, 0.05, col(L.gc), { su: 16 });
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(r0, fr), s = Math.min(fm.W, fm.D) * 0.8, y = L.deck ? 6 : 0.08;
    const q = fm.p(fm.W / 2, fm.D / 2), [a, b] = SV(3, 4, 0.02);
    if (L.deck) { boxW(B, [q[0] - s / 2, q[1] - s / 2, q[0] + s / 2, q[1] + s / 2], 0, y - 0.05, MW.conc('#d9d7d0'), { ct: col('#c9c7c0') }); if (lod >= 1) for (const e of RF([q[0] - s / 2, q[1] - s / 2, q[0] + s / 2, q[1] + s / 2]).edges) railE(B, e, y, 1.1, W1); }
    const r = Math.min(s / 2, 14); B.quad('i:run', [q[0] - r, y + 0.02, q[1] + r], [q[0] + r, y + 0.02, q[1] + r], [q[0] + r, y + 0.02, q[1] - r], [q[0] - r, y + 0.02, q[1] - r], null, W1, [0.3, a, 0.7, a, 0.7, b, 0.3, b]);
    if (lod >= 2) { heli(B, q[0] + r * 0.1, q[1], fm.ua, A.pick(R, ['#e9e9e6', '#3f6f9a', '#c84a3a']), lod); const w = fm.p(fm.W - 2, 2); B.box('c', w[0] - 0.06, w[1] - 0.06, w[0] + 0.06, w[1] + 0.06, 0.05, 5, [0.6, 0.6, 0.6]); B.obox('c', w[0] + 0.7, w[1], 0, 1.4, 0.3, 4.4, 4.8, col(L.h), {}); fence(B, F, 1.6, W1, 4, A.frontEdge(F, fr)); }
  }
});
// 管制塔（i_ctower：f4〜12。区画は 1〜9）
const CTW = [
  { n: '白いコンクリートの塔', c: '#ecebe6', gl: '#4f6a80', fc: '#ecebe6' },
  { n: 'グレーの塔・青いガラス', c: '#b9bdc0', gl: '#3f5f86', fc: '#b9bdc0' },
  { n: 'タイル張りの塔', c: '#d9c7aa', gl: '#5d5040', fc: '#d9c7aa' },
  { n: '赤白の帯の塔', c: '#eeeeea', gl: '#3f4f5f', fc: '#e6e6e2', band: true }
];
A.arch('i_ctower', {
  looks: CTW,
  far(L, P) { const f = Math.max(4, P.f); return { H: f * 4.2, base: 0, wall: 'c', roof: null, rc: col('#5d6a78'), rt: 'flat', ins: 3, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, lod = P.lod, f = Math.max(4, P.f), h = f * 4.2, r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), x = (r0[0] + r0[2]) / 2, z = (r0[1] + r0[3]) / 2, w = cl(Math.min(rw(r0), rd(r0)) * 0.6, 6, 14);
    pave(B, P, F, 'i:cpad');
    if (F.n > 1 && lod >= 1) { const G = RF(inR(r0, 1.5)); boxW(B, G.rects[0], 0, 7, MW.alc(L.c), { ct: col('#c9cbcb') }); if (lod >= 2) for (const e of G.edges) band(B, e, 1, e.L - 1, 2.5, 5.0, 3, 3); }
    ctower(B, x, z, h, w, L.c, lod, L.gl);
    if (L.band && lod >= 1) for (let i = 0; i < 3; i++) frustum(B, 'c', x, z, w * 0.43, w * 0.43, h * (0.25 + i * 0.25), h * (0.25 + i * 0.25) + 2.5, 8, col('#c8473a'));
  }
});
// レーダー基地（i_radar）：白い ドーム（レドーム）・回る アンテナ・建物
const RADAR = [
  { n: '白いドームのレーダー', t: 'dome', c: '#f2f2ef', W: '#e6e4de' },
  { n: '塔の上の 大きな球', t: 'ball', c: '#f4f4f0', W: '#d9dcdc' },
  { n: '回る アンテナ', t: 'ant', c: '#c9ccce', W: '#c9cdc4' },
  { n: 'パラボラアンテナ', t: 'dish', c: '#eeeeea', W: '#e2ddd2' }
];
A.arch('i_radar', {
  looks: RADAR,
  far(L, P) { return { H: 10, base: 0, wall: 'i:fw:ofc', bw: 4, fh: 3.5, tb: 1, tf: 1, roof: null, rc: col('#c9cbcb'), rt: 'flat', ins: 3, wc: col(L.W) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f);
    pave(B, P, F, 'i:cpad', col('#d2d0c9'));
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 2), fr), Wd = fm.W, D = fm.D;
    const G = RF(fm.r(0, 0, Math.min(Wd, Math.max(8, Wd * 0.45)), Math.min(D, Math.max(8, D * 0.4)))), H = f * 3.6 + 0.3;
    if (lod <= 0) lowShed(B, P, G, H, { fc: L.W, rc: '#c9cbcb', rt: 'flat', fw: 'i:fw:ofc' }, { fh: 3.6 }); else office(B, P, G, f, 3.6, { ow: L.W, pc: '#cfcac0' }, G.edges[fm.fi]);
    const q = fm.p(Wd * 0.7, D * 0.65), rr = cl(Math.min(Wd, D) * 0.25, 4, 12), cc = col(L.c), n = lod >= 2 ? 14 : lod >= 1 ? 8 : 6;
    if (L.t === 'dome') { boxW(B, [q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], 0, 6, MW.conc('#e9e7e1'), { ct: col('#c9c7c0') }); B.dome('c', q[0], q[1], rr * 0.95, rr * 0.95, 6, rr * 0.95, n, cc, { rings: lod >= 2 ? 5 : lod >= 1 ? 3 : 1 }); }
    else if (L.t === 'ball') { latTower(B, q[0], q[1], rr * 0.9, rr * 0.6, 0, 18, W1); const yc = 18 + rr * 0.8; B.dome('c', q[0], q[1], rr * 0.9, rr * 0.9, yc, rr * 0.9, n, cc, { rings: lod >= 2 ? 5 : lod >= 1 ? 3 : 1 }); B.dome('c', q[0], q[1], rr * 0.9, rr * 0.9, yc, -rr * 0.9, n, mul(cc, 0.85), { rings: lod >= 2 ? 3 : 1 }); }
    else if (L.t === 'ant') { latTower(B, q[0], q[1], 4, 2.4, 0, 16, W1); B.box('c', q[0] - 1.5, q[1] - 1.5, q[0] + 1.5, q[1] + 1.5, 16, 17.5, col('#9aa0a4')); B.obox('c', q[0], q[1], R() * PI, rr * 1.6, 0.6, 17.5, 20.5, cc, {}); }
    else { B.box('c', q[0] - 1.2, q[1] - 1.2, q[0] + 1.2, q[1] + 1.2, 0, 7, col('#c9c7c0')); B.dome('c', q[0], q[1] - 0.5, rr, rr * 0.35, 7 + rr * 0.9, -rr * 0.5, n, cc, { rings: 2 }); }
    if (lod >= 2) fence(B, F, 2.4, W1, 6, A.frontEdge(F, fr));
  }
});

/* ---------- 駐車場（i_park：f=0）：ますの質感・車・照明・精算機・看板（字なし）・自転車置き場 ---------- */
const PARK = [
  { n: 'アスファルト・白い線', m: 'i:park', gc: '#ffffff', ok: 0.65, sg: '#2f5f8a' },
  { n: '車でいっぱい', m: 'i:park', gc: '#f0f0f0', ok: 0.95, sg: '#3a6a4a' },
  { n: '砂利の駐車場', m: 'i:grav', gc: '#ffffff', ok: 0.6, sg: '#8a3a30', gravel: true },
  { n: '植えこみのある 駐車場', m: 'i:park', gc: '#e8e8e8', ok: 0.7, sg: '#5d6a78', green: true },
  { n: 'がらんとした 駐車場', m: 'i:park', gc: '#ffffff', ok: 0.25, sg: '#6a6a6a' }
];
const COIN = [
  { n: '黄色いロック板・青看板', m: 'i:park', gc: '#ffffff', ok: 0.7, sg: '#2f5f8a', lock: '#d9b13a' },
  { n: '灰色ロック板・緑看板', m: 'i:park', gc: '#f0f0f0', ok: 0.75, sg: '#3a6a4a', lock: '#8a8e90' },
  { n: 'ゲート式・赤い看板', m: 'i:park', gc: '#ffffff', ok: 0.6, sg: '#a8483a', gate: true },
  { n: '白いフェンス・紺の看板', m: 'i:park', gc: '#e8e8e8', ok: 0.65, sg: '#2c3f5e', lock: '#c9ccce' }
];
const BIKE = [
  { n: '屋根つきの 自転車置き場', roof: '#c9d6dc', st: '#8a9096' },
  { n: '緑の屋根・2段ラック', roof: '#7f9e86', st: '#5f6a62' },
  { n: '屋根なし・ラックだけ', roof: null, st: '#9aa0a4' },
  { n: '茶色の屋根・バイク置き場', roof: '#8a6a56', st: '#6a5a50' }
];
A.tex('i:grav', 256, 256, (g, w, h, R) => { rect(g, 0, 0, w, h, '#a29d92'); PT.noise(g, 0, 0, w, h, 0.14, R, 2); blots(g, 0, 0, w, h, 16, '90,84,74', 0.18, R, 0.08); blots(g, 0, 0, w, h, 10, '200,196,186', 0.12, R, 0.06); });
A.arch('i_park', {
  looks: PARK,
  far(L, P) { return { H: 0.3, base: 0.05, wall: 'c', ct: col(L.gravel ? '#a29d92' : L.roof !== undefined ? '#9a9c9c' : '#7c7e7e'), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], ko = P.ko;
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05);
    if (ko.bike) { B.cap('i:cpad', F, 0.05, W1, { su: 16 }); return bikePark(B, P, L, F, fr); }
    // ますの 質感：区画の長方形ごと（道の向きに そろえる）
    const fe0 = A.frontEdge(F, fr);
    for (const r of F.rects) {
      const fm = frame(r, fr), Wd = fm.W, D = fm.D;
      if (L.m === 'i:park' && D >= 6) { parkLot(B, fm, 0, 0, Wd, D, R, lod, L.ok * (ko.big ? 1 : 1), 0.05); if (D % 16 > 0.5) { const P3 = (u, v) => { const q = fm.p(u, v); return [q[0], 0.05, q[1]]; }; void P3; } }
      else { B.cap(L.m === 'i:grav' ? 'i:grav' : 'i:asph', RF(r), 0.05, col(L.gc), { su: 16 }); if (lod >= 2) { const n = Math.floor(Wd / 2.6); for (let i = 0; i < n; i++) if (R() < L.ok) { const q = fm.p(1.3 + i * 2.6, Math.min(D - 2.5, 3)); car1(B, q[0], q[1], fm.fa + PI / 2, A.pick(R, CARS)); } } }
      if (lod >= 2 && L.lock) { const n = Math.min(24, Math.floor(Wd / 2.5)); for (let i = 0; i < n; i++) { const q = fm.p(1.25 + i * 2.5, 2.6); B.obox('c', q[0], q[1], fm.ua, 0.7, 0.9, 0.05, 0.16, col(L.lock), {}); } }
    }
    if (lod < 2) return;
    // 照明・看板・精算機・植えこみ
    const fm = frame(F.rects[0], fr), Wd = fm.W, D = fm.D, nl = cl(Math.round(Math.sqrt(F.area) / 25), 1, 8);
    for (let i = 0; i < nl; i++) { const q = fm.p(Wd * (i + 0.5) / nl, Math.min(D - 1, 0.6 + (i % 2) * D * 0.5)); B.box('c', q[0] - 0.08, q[1] - 0.08, q[0] + 0.08, q[1] + 0.08, 0.05, 7, [0.55, 0.56, 0.56]); B.box('c', q[0] - 0.5, q[1] - 0.2, q[0] + 0.5, q[1] + 0.2, 7, 7.25, [0.85, 0.85, 0.82]); }
    if (ko.coin || ko.tsuki || P.f === 0) { const p = ePt(fe0, Math.min(1.5, fe0.L * 0.1), -0.6); B.box('c', p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, 0.05, ko.coin ? 5.5 : 2.4, [0.5, 0.5, 0.5]); const pa = ePt(fe0, Math.min(1.5, fe0.L * 0.1) - 0.8, -0.6), pb = ePt(fe0, Math.min(1.5, fe0.L * 0.1) + 0.8, -0.6); B.wall('c', pa[0], pa[1], pb[0], pb[1], ko.coin ? 3.6 : 1.4, ko.coin ? 5.4 : 2.4, col(L.sg)); B.wall('c', pb[0], pb[1], pa[0], pa[1], ko.coin ? 3.6 : 1.4, ko.coin ? 5.4 : 2.4, col(L.sg)); }
    if (ko.coin) { const p = ePt(fe0, Math.min(3.5, fe0.L * 0.3), -1.2); B.obox('c', p[0], p[1], eAng(fe0), 0.6, 0.5, 0.05, 1.5, col('#e9e9e6'), {}); if (L.gate) { const g2 = ePt(fe0, fe0.L * 0.6, -1); B.obox('c', g2[0], g2[1], eAng(fe0), 0.4, 0.4, 0.05, 1.1, col('#d9b13a'), {}); B.obox('c', g2[0] + Math.cos(eAng(fe0)) * 1.5, g2[1] + Math.sin(eAng(fe0)) * 1.5, eAng(fe0), 3, 0.08, 1.0, 1.08, col('#e9e9e6'), {}); } }
    if (L.green) for (const e of F.edges) if (e.out && e !== fe0 && e.L > 6) { const n = Math.min(4, Math.round(e.L / 16)); for (let i = 0; i < n; i++) { const p = ePt(e, e.L * (i + 0.5) / n, -1.2); B.tree(p[0], p[1], 0.05, 3.5 + R(), 1.4, [0.3, 0.44, 0.24]); } }
    if (ko.tsuki || L.gravel) fence(B, F, 1.2, W1, 6, fe0);
  }
});
function bikePark(B, P, L, F, fr) {
  const R = P.rng, lod = P.lod, fm = frame(inR(F.rects[0], 0.6), fr), Wd = fm.W, D = fm.D, nr = cl(Math.floor(D / 5), 1, lod >= 2 ? 12 : lod >= 1 ? 6 : 3), [v0, v1] = SV(3, 8, 0.02);
  for (let j = 0; j < nr; j++) {
    const v = 1 + j * 5, a = fm.p(0.3, v + 1.2), b = fm.p(Wd - 0.3, v + 1.2), L2 = Wd - 0.6;
    if (lod >= 1) { B.wall('i:lat', a[0], a[1], b[0], b[1], 0.05, 1.1, W1, [0, L2 / 6, v0, v1]); B.wall('i:lat', b[0], b[1], a[0], a[1], 0.05, 1.1, W1, [0, L2 / 6, v0, v1]); }
    if (L.roof) { const r = fm.r(0, v - 0.2, Wd, v + 2.8); B.flat('c', r, 2.4, col(L.roof)); if (lod >= 1) B.flat('c', r, 2.38, mul(col(L.roof), 0.8), { down: true }); if (lod >= 2) for (const u of [0.5, Wd / 2, Wd - 0.5]) { const q = fm.p(u, v + 2.6); B.box('c', q[0] - 0.06, q[1] - 0.06, q[0] + 0.06, q[1] + 0.06, 0.05, 2.4, col(L.st)); } }
  }
  if (lod >= 2) fence(B, F, 1.2, W1, 3, A.frontEdge(F, fr));
}
// 立体駐車場（i_pkbld：f2〜8）：ひらいた 床・低い 手すり壁・中の 車・スロープ・階段の塔
const PKB = [
  { n: '打ちはなし・白い手すり壁', c: '#d4d1ca', par: '#e9e7e1', st: '#d4d1ca', fc: '#cbc8c0' },
  { n: '鉄骨・青い手すり', c: '#bfc3c6', par: '#3f6f9a', st: '#3f6f9a', fc: '#9fb0be', steel: true },
  { n: 'タイル・茶色の帯', c: '#c9b79a', par: '#8a6a56', st: '#c9b79a', fc: '#b9a68a' },
  { n: '白い壁・緑の ルーバー', c: '#e9e9e6', par: '#5f8a6a', st: '#e9e9e6', fc: '#c9d6cb', louver: true },
  { n: 'グレー・オレンジの階段塔', c: '#b5b8ba', par: '#d9dbdb', st: '#d0742e', fc: '#b5b8ba' }
];
A.tex('i:fw:pk', 128, 128, (g, w, h, R) => { rect(g, 0, 0, w, h, '#e6e4de'); rect(g, 0, h * 0.0, w, h * 0.55, '#3b3d3f'); for (let i = 0; i < 4; i++) rect(g, i * w / 4 + w * 0.05, h * 0.35, w * 0.14, h * 0.18, A.pick(R, ['#d9d9d6', '#3a3d40', '#8b2a2a', '#c9ccd0'])); rect(g, 0, h * 0.55, w, h * 0.35, '#e6e4de'); rect(g, 0, h * 0.9, w, h * 0.1, '#c9c7c0'); rect(g, 0, 0, w * 0.04, h, '#d6d4ce'); });
A.arch('i_pkbld', {
  looks: PKB,
  far(L, P) { const f = Math.max(2, P.f); return { H: f * 3.0 + 1.2, base: 0, wall: 'i:fw:pk', bw: 4, fh: 3.0, tb: 1, tf: 1, roof: null, rc: col('#8a8c8c'), rt: 'flat', ins: 0.6, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(2, P.f), fh = 3.0, H = f * fh;
    const I = A.inset(F, 0.6), fe = A.frontEdge(I, fr), cc = col(L.c);
    pave(B, P, F, 'i:asph');
    if (lod <= 0) { lowShed(B, P, I, H + 1.2, { fc: L.fc, rc: '#8a8c8c', rt: 'flat', fw: 'i:fw:pk' }, { fh }); return; }
    if (lod === 1) { farWalls(B, I, 0, H + 1.2, 'i:fw:pk', col(L.fc), fh); B.cap('c', I, H + 1.2, col('#8a8c8c')); return; }
    // 床スラブと 手すり壁（各階）・柱
    for (let i = 0; i <= f; i++) { const y = i * fh;
      if (i > 0) { B.cap('c', I, y, col('#9a9c9c')); B.cap('c', I, y - 0.35, mul(cc, 0.8), { down: true }); }
      for (const e of I.edges) { seg(B, 'c', e, 0, e.L, y - 0.35, y, mul(cc, 0.95), null, 0, 0, 1); if (i < f || true) { if (L.steel) railE(B, e, y, 1.1, col(L.par)); else if (L.louver && i > 0) seg(B, 'i:win', e, 0, e.L, y, y + 2.2, col(L.par), [0, e.L / 3], SV(5, 8, 0.03)[0], SV(5, 8, 0.03)[1], 1); else seg(B, 'c', e, 0, e.L, y, y + 1.1, col(L.par), null, 0, 0, 1); } } }
    for (const e of I.edges) { const n = Math.max(1, Math.round(e.L / 8)); for (let k = 0; k <= n; k++) { const p = ePt(e, e.L * k / n, -0.4); B.box('c', p[0] - 0.35, p[1] - 0.35, p[0] + 0.35, p[1] + 0.35, 0, H, cc); } }
    // 中の 車（列の箱）
    const r = I.rects[0], fm = frame(inR(r, 1), fr);
    for (let i = 0; i <= f && i < 6; i++) { const y = i * fh + 0.04; const B2 = B; B2.oy += y * A.U; for (const v of [0.4, fm.D - 5]) if (v > 0 && v + 4.6 < fm.D + 0.5) carRow(B2, fm, 1, fm.W - 1, v, 0); B2.oy -= y * A.U; }
    // 階段の塔
    const sp = ePt(fe, Math.min(3, fe.L * 0.15), 1.6), sw = 4; boxW(B, [sp[0] - sw / 2, sp[1] - sw / 2, sp[0] + sw / 2, sp[1] + sw / 2], 0, H + 3, MW.alc(L.st), { ct: col('#8a8c8c') });
    if (I.rects[0] && rw(r) > 20) { const a = fm.p(fm.W - 4, 2), b = fm.p(fm.W - 4, fm.D - 2); beam(B, 'c', [a[0], 0.3, a[1]], [b[0], fh, b[1]], 5.5, 0.4, col('#9a9c9c')); }
    signPanel(B, fe, fe.L * 0.5, Math.min(fe.L - 2, 5), H - 1.4, 1.2, col(L.st));
  }
});
// 機械式駐車場（i_mech：f3〜10）：細長い 塔。下に 車の入口
const MECH = [
  { n: 'シルバーのパネルの塔', c: '#c9cdd0', door: '#5a6066', fc: '#c4c8ca' },
  { n: '白い塔・紺の帯', c: '#ececE8', door: '#2c4466', band: '#2c4466', fc: '#e6e6e2' },
  { n: '鉄骨むきだし・車が見える', c: '#9aa0a4', door: '#5a6066', open: true, fc: '#7d8488' },
  { n: 'ベージュの塔・茶色の入口', c: '#ddd2bb', door: '#6b4f3c', fc: '#d6cbb3' }
];
A.arch('i_mech', {
  looks: MECH,
  far(L, P) { const f = Math.max(3, P.f); return { H: f * 2.1 + 1, base: 0, wall: L.open ? 'i:fw:pk' : 'i:fw:soko', bw: 4, fh: L.open ? 2.1 : f * 2.1 + 1, tb: 1, tf: 1, roof: null, rc: col('#8a8c8c'), rt: 'flat', ins: 0.8, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, lod = P.lod, fr = P.front || [0, 1], f = Math.max(3, P.f), H = f * 2.1 + 1;
    pave(B, P, F, 'i:asph');
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 1), fr), tw = Math.min(fm.W, 7), td = Math.min(fm.D, 7), G = RF(fm.r((fm.W - tw) / 2, Math.max(0, fm.D - td - 1), (fm.W + tw) / 2, fm.D - 1)), fe = G.edges[fm.fi];
    if (lod <= 0) { lowShed(B, P, G, H, { fc: L.fc, rc: '#8a8c8c', rt: 'flat', fw: L.open ? 'i:fw:pk' : 'i:fw:soko' }, { fh: L.open ? 2.1 : H }); return; }
    if (L.open) { latTower(B, (G.bb[0] + G.bb[2]) / 2, (G.bb[1] + G.bb[3]) / 2, Math.min(tw, td), Math.min(tw, td), 0, H, col(L.c)); if (lod >= 2) for (let i = 1; i < f; i++) { const q = fm.p(fm.W / 2, fm.D - 1 - td / 2); car1(B, q[0], q[1], fm.fa + PI / 2, A.pick(P.rng, CARS), i * 2.1); } B.cap('c', G, H, col('#8a8c8c')); }
    else { for (const e of G.edges) clad(B, e, 0, e.L, 0, H, MW.kaku(L.c), 0.85); if (L.band) for (const e of G.edges) seg(B, 'c', e, 0, e.L, H - 1.6, H - 0.8, col(L.band), null, 0, 0, 1, 0.05); B.cap('i:flat', G, H, col('#c4c6c6'), { su: 16 }); }
    door(B, fe, fe.L / 2, Math.min(fe.L - 1, 2.6), 0, 2.2, 14, col(L.door), 0.1);
    if (lod >= 2) { const p = fm.p(fm.W / 2, Math.max(0, fm.D - td - 4)); B.obox('c', p[0], p[1], fm.ua, 2.6, 2.6, 0.05, 0.12, col('#9a9c9c'), {}); signPanel(B, fe, fe.L / 2, Math.min(fe.L - 1, 3), 2.6, 0.7, col(L.door)); }
  }
});
// バスターミナル（i_bus：f1〜2）：のりばの 屋根（長い庇）・バス・待合の建物
const BUS = [
  { n: '白い屋根の のりば', roof: '#e9eaea', bus: ['#e9e9e6', '#f0f0ec'], W: '#e6e4de', fc: '#e6e4de' },
  { n: 'ガラス待合室・銀屋根', roof: '#c9cdd0', bus: ['#e9e9e6', '#dfe7ee'], W: '#c9cdcf', glass: true, fc: '#c9cdcf' },
  { n: '緑屋根・れんが待合室', roof: '#6f8f78', bus: ['#e9e9e6', '#e6e2d2'], W: '#b07a5e', fc: '#b07a5e' },
  { n: '大きな膜の屋根', roof: '#f4f4f2', bus: ['#e9e9e6', '#e9eef2'], W: '#e9e9e6', membrane: true, fc: '#e9e9e6' }
];
function bus(B, x, z, ang, c, lod) {
  const L = 11, Wd = 2.5, ca = Math.cos(ang), sa = Math.sin(ang), P = (u, w) => [x + ca * u - sa * w, z + sa * u + ca * w], cc = col(c), [v0, v1] = SV(6, 8, 0.03);
  const a = P(-L / 2, -Wd / 2), b = P(L / 2, -Wd / 2), q = P(L / 2, Wd / 2), d = P(-L / 2, Wd / 2);
  B.wall('i:veh', a[0], a[1], b[0], b[1], 0.3, 3.2, cc, [0, 1, v0, v1]); B.wall('i:veh', q[0], q[1], d[0], d[1], 0.3, 3.2, cc, [1, 0, v0, v1]);
  B.wall('c', b[0], b[1], q[0], q[1], 0.3, 3.2, [0.25, 0.3, 0.34]); B.wall('c', d[0], d[1], a[0], a[1], 0.3, 3.2, mul(cc, 0.9));
  B.quad('c', [a[0], 3.2, a[1]], [b[0], 3.2, b[1]], [q[0], 3.2, q[1]], [d[0], 3.2, d[1]], null, mul(cc, 0.95));
}
A.arch('i_bus', {
  looks: BUS,
  far(L, P) { return { H: 6, base: 0, wall: 'i:fw:ofc', bw: 4, fh: 3.5, tb: 1, tf: 1, roof: null, rc: col(L.roof), rt: 'flat', ins: 2, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f);
    pave(B, P, F, 'i:asph', col('#e0e0e0'));
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 1), fr), Wd = fm.W, D = fm.D;
    // 待合の建物（道がわ）
    const bd = cl(D * 0.25, 8, 20), G = RF(fm.r(Wd * 0.1, 0.5, Wd * 0.9, bd)), H = f * 3.8 + 0.3;
    if (lod <= 0) { lowShed(B, P, G, H, { fc: L.fc, rc: L.roof, rt: 'flat', fw: 'i:fw:ofc' }, { fh: 3.8 }); return; }
    office(B, P, G, f, 3.8, { ow: L.W, pc: L.roof, ofc: L.glass }, G.edges[fm.fi]);
    // のりば（島）と 屋根
    const ni = cl(Math.floor((D - bd - 6) / 16), 1, 4);
    for (let i = 0; i < ni; i++) { const v = bd + 6 + i * 16, isl = fm.r(4, v, Wd - 4, v + 3);
      B.box('c', isl[0], isl[1], isl[2], isl[3], 0.04, 0.2, col('#c9c7c0'));
      const rr = fm.r(4, v - 1.5, Wd - 4, v + 4.5); B.flat('c', rr, 4.2, col(L.roof)); B.flat('c', rr, 4.15, mul(col(L.roof), 0.75), { down: true }); if (L.membrane) for (const sg of [0, 1]) { const q = fm.p(Wd / 2, sg ? v + 4.5 : v - 1.5); void q; }
      if (lod >= 2) { const nc = Math.max(1, Math.round((Wd - 8) / 12)); for (let k = 0; k <= nc; k++) { const q = fm.p(4 + (Wd - 8) * k / nc, v + 1.5); B.box('c', q[0] - 0.15, q[1] - 0.15, q[0] + 0.15, q[1] + 0.15, 0.2, 4.2, col('#9aa0a4')); }
        const nb = Math.min(4, Math.floor((Wd - 8) / 14)); for (let k = 0; k < nb; k++) if (R() < 0.75) { const q = fm.p(10 + k * 14, v + 5.6); bus(B, q[0], q[1], fm.ua, A.pick(R, L.bus), lod); } } }
    if (lod >= 2) { const nt = Math.min(3, Math.floor(Wd / 25)); for (let k = 0; k < nt; k++) { const q = fm.p(Wd * (k + 0.5) / nt, D - 3); bus(B, q[0], q[1], fm.ua + PI, A.pick(R, L.bus), lod); } }
  }
});

/* ---------- インフラ：変電所・太陽光・風力・浄水場・下水処理場・水力・地熱・灯台・電波塔 ---------- */
// 変電所（i_subst）
const SUBST = [
  { n: '銀の鉄骨・砂利じき', tc: '#b9bcbe', gc: '#ffffff', W: '#e6e4de', fc: '#b9bcbe' },
  { n: '灰色の変圧器・白い建屋', tc: '#a9adb0', gc: '#e8e8e8', W: '#f0efea', fc: '#a9adb0' },
  { n: '緑の変圧器・高い鉄塔', tc: '#c4c8cb', gc: '#ffffff', W: '#d9dcd4', tx: '#6f8a72', fc: '#b0b5ae', tall: true },
  { n: '屋内の 変電所（箱）', tc: '#b9bcbe', gc: '#e8e8e8', W: '#d9d4c8', fc: '#d9d4c8', indoor: true }
];
A.arch('i_subst', {
  looks: SUBST,
  far(L, P) { return { H: L.indoor ? 12 : 6, base: 0, wall: L.indoor ? 'i:fw:soko' : 'c', bw: 4, fh: 12, tb: 1, tf: 1, roof: null, rc: col('#a9a7a0'), rt: 'flat', ins: L.indoor ? 2 : 1, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1];
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); B.cap('i:grav', F, 0.05, col(L.gc), { su: 16 });
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 2), fr), Wd = fm.W, D = fm.D;
    if (L.indoor) { const G = RF(fm.r(Wd * 0.1, D * 0.15, Wd * 0.9, D * 0.85)); shed(B, P, Object.assign({}, KOBA[4], { fc: L.fc, rc: '#b9bcbd', W: MW.alc(L.W), stripe: null, sg: null }), G, 12, { fe: G.edges[fm.fi], f: 2, multi: true }); }
    else { const sw = { u0: 0, v0: D * 0.25, u1: Wd, v1: D, a: Wd * D }; switchyard(B, P, fm, sw, R, { h: L.tall ? 22 : 14 }); const G = RF(fm.r(1, 1, Math.min(Wd * 0.4, 16), Math.min(D * 0.22, 9))); if (lod >= 1) office(B, P, G, 1, 4, { ow: L.W, pc: '#cfcac0' }, G.edges[fm.fi]); }
    if (lod >= 2) fence(B, F, 2.4, W1, 6, A.frontEdge(F, fr));
  }
});
// 太陽光発電所（i_solar：f=0）
A.tex('i:solar', 128, 128, (g, w, h, R) => { rect(g, 0, 0, w, h, '#c9cdd0'); for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) { const x = i * w / 4 + 1, y = j * h / 2 + 1, cw = w / 4 - 2, ch = h / 2 - 2; const gr = g.createLinearGradient(x, y, x + cw, y + ch); gr.addColorStop(0, '#2c3f66'); gr.addColorStop(1, '#1b2742'); g.fillStyle = gr; g.fillRect(x, y, cw, ch); for (let u = 1; u < 6; u++) rect(g, x + cw * u / 6, y, 1, ch, 'rgba(160,180,210,.25)'); for (let v = 1; v < 10; v++) rect(g, x, y + ch * v / 10, cw, 1, 'rgba(160,180,210,.2)'); } }, { shiny: '#556677', sh: 60 });
const SOLAR = [
  { n: '芝生の上の パネル', gm: 'i:lawn', gc: '#ffffff', tilt: 0.3, gap: 3.5 },
  { n: '砂利の上の パネル', gm: 'i:grav', gc: '#ffffff', tilt: 0.3, gap: 3.0 },
  { n: '低い傾きのパネル・密', gm: 'i:grav', gc: '#d8d8d8', tilt: 0.16, gap: 1.6 },
  { n: '山の斜面の パネル', gm: 'i:lawn', gc: '#c8d0b8', tilt: 0.45, gap: 4.5 }
];
A.arch('i_solar', {
  looks: SOLAR,
  far(L, P) { return { H: 0.3, base: 0.05, wall: 'c', ct: col('#2f3f5f'), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1];
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); B.cap(L.gm, F, 0.05, col(L.gc), { su: 24 });
    for (const r of F.rects) {
      const fm = frame(inR(r, 2), [0, 1]), Wd = fm.W, D = fm.D, pd = 4.0, rows = Math.floor((D + L.gap) / (pd + L.gap)), hy = pd * Math.sin(L.tilt), hz = pd * Math.cos(L.tilt);
      const step = lod >= 1 ? 1 : Math.max(1, Math.ceil(rows / 8));
      for (let j = 0; j < rows; j += step) {
        const v = j * (pd + L.gap), P3 = (u, vv, y) => { const q = fm.p(u, vv); return [q[0], y, q[1]]; };
        B.quad('i:solar', P3(0, v, 0.6), P3(Wd, v, 0.6), P3(Wd, v + hz, 0.6 + hy), P3(0, v + hz, 0.6 + hy), null, W1, [0, 0, Wd / 4, 0, Wd / 4, 1, 0, 1]);
        if (lod >= 2) { B.quad('c', P3(0, v + hz, 0.6 + hy), P3(Wd, v + hz, 0.6 + hy), P3(Wd, v + hz, 0.05), P3(0, v + hz, 0.05), null, [0.45, 0.46, 0.48]); }
      }
      if (lod >= 2) { const n = Math.max(1, Math.round(Wd * D / 6000)); for (let i = 0; i < Math.min(n, 4); i++) { const q = fm.p(Wd * (i + 0.5) / Math.min(n, 4), D * 0.5); B.box('c', q[0] - 1.6, q[1] - 1.1, q[0] + 1.6, q[1] + 1.1, 0.05, 2.3, col('#d9dcdc')); } }
    }
    if (lod >= 2) fence(B, F, 1.8, W1, 6, A.frontEdge(F, fr));
  }
});
// 風力発電所（i_wind：f=0）
const WIND = [
  { n: '白い風車・草地', c: '#f2f2ef', gm: 'i:lawn', h: 80, r: 40 },
  { n: '大きな風車・畑のなか', c: '#eeeeea', gm: 'i:lawn', h: 100, r: 52 },
  { n: '小さな風車が ならぶ', c: '#f4f4f0', gm: 'i:lawn', h: 55, r: 26 },
  { n: '赤い先の 羽根・砂利の台', c: '#eeeeea', gm: 'i:grav', h: 85, r: 42, tip: '#c8473a' }
];
function turbine(B, x, z, h, r, c, ang, lod, tip, spin) {
  const n = lod >= 2 ? 10 : lod >= 1 ? 6 : 4, cc = col(c);
  frustum(B, 'c', x, z, 2.2 * h / 80, 1.2 * h / 80, 0, h, n, cc);
  const ca = Math.cos(ang), sa = Math.sin(ang), hx = x + ca * 2.5, hz = z + sa * 2.5;
  B.obox('c', x - ca * 1.5, z - sa * 1.5, ang, 9 * h / 80, 3.4 * h / 80, h - 1.6, h + 2, cc, {});
  for (let k = 0; k < 3; k++) { const t = spin + k * PI * 2 / 3, dx = Math.cos(t), dy = Math.sin(t), w = 1.6 * r / 40;
    const P0 = (d, o) => [hx - sa * dx * d + ca * 0.3 * o, h + 0.2 + dy * d, hz + ca * dx * d + sa * 0.3 * o];
    B.quad('c', P0(1.2, -w), P0(r, -w * 0.25), P0(r, w * 0.25), P0(1.2, w), null, cc);
    if (tip && lod >= 1) B.quad('c', P0(r * 0.85, -w * 0.4), P0(r, -w * 0.25), P0(r, w * 0.25), P0(r * 0.85, w * 0.4), null, col(tip)); }
  if (lod >= 2) B.box('c', hx - 1.1, hz - 1.1, hx + 1.1, hz + 1.1, h - 0.9, h + 1.3, cc);
}
A.arch('i_wind', {
  looks: WIND,
  far(L, P) { return { H: 0.3, base: 0.05, wall: 'c', ct: col('#8aa060'), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1];
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); B.cap(L.gm, F, 0.05, W1, { su: 24 });
    const sp = L.r * 4.5; let n = 0; const lim = lod >= 2 ? 12 : lod >= 1 ? 8 : 4;
    for (const r of F.rects) { const nx = Math.max(1, Math.floor(rw(r) / sp)), nz = Math.max(1, Math.floor(rd(r) / sp));
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { if (n++ >= lim) continue; const x = r[0] + rw(r) * (i + 0.5) / nx + (R() - 0.5) * 6, z = r[1] + rd(r) * (j + 0.5) / nz + (R() - 0.5) * 6;
        if (lod >= 1) B.box('c', x - 6, z - 6, x + 6, z + 6, 0.05, 0.12, col('#a9a7a0')); turbine(B, x, z, L.h, L.r, L.c, -PI * 0.75, lod, L.tip, R() * PI); } }
  }
});
// 浄水場・下水処理場（i_water）：四角い 沈殿池・まるい 池・ろ過の建物・芝生
const WATER = [
  { n: '四角い池・白い建物', wc: '#7c98a6', W: '#ecebe6', gm: 'i:lawn', round: false, fc: '#9ab0a0' },
  { n: 'まるい池が ならぶ', wc: '#6f8e9c', W: '#e2ddd2', gm: 'i:lawn', round: true, fc: '#9ab0a0' },
  { n: '緑の水の池・れんがの建物', wc: '#6f8a72', W: '#b07a5e', gm: 'i:lawn', round: false, fc: '#8aa080' },
  { n: 'ふたをした池・公園', wc: '#8a8c88', W: '#d9dcd4', gm: 'i:lawn', round: false, cover: true, fc: '#9aaa8a' }
];
A.arch('i_water', {
  looks: WATER,
  far(L, P) { return { H: 0.6, base: 0.05, wall: 'c', ct: col(L.fc), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(0, P.f);
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); B.cap(L.gm, F, 0.05, W1, { su: 24 });
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 4), fr), Wd = fm.W, D = fm.D;
    // 建物（道がわ）
    const bz = cl(D * 0.18, 8, 24), G = RF(fm.r(Wd * 0.05, 1, Math.min(Wd * 0.45, Wd * 0.05 + 50), bz)), H = Math.max(1, f || 2) * 4;
    if (lod >= 1) office(B, P, G, Math.max(1, f || 2), 4, { ow: L.W, pc: '#cfcac0' }, G.edges[fm.fi]); else lowShed(B, P, G, H, { fc: L.W, rc: '#b9b9b4', rt: 'flat', fw: 'i:fw:ofc' }, { fh: 4 });
    // 池
    const v0 = bz + 6, n = cl(Math.floor((D - v0) / 26), 1, lod >= 2 ? 5 : 3), m = cl(Math.floor(Wd / (L.round ? 30 : 60)), 1, lod >= 2 ? 5 : 4), wc = col(L.wc);
    for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) {
      const a = Wd * i / m + 3, b = Wd * (i + 1) / m - 3, c0 = v0 + (D - v0) * j / n + 2, c1 = v0 + (D - v0) * (j + 1) / n - 2;
      if (lod <= 0) { const r = fm.r(a, c0, b, c1); B.flat('c', L.round ? inR(r, Math.min(rw(r), rd(r)) * 0.1) : r, 1.0, L.cover ? col('#9aa58a') : mul(wc, 1.1)); continue; }
      if (L.round) { const q = fm.p((a + b) / 2, (c0 + c1) / 2), rr = Math.min(b - a, c1 - c0) / 2, k = lod >= 2 ? 14 : 8; frustum(B, 'i:conc', q[0], q[1], rr, rr, 0.05, 1.3, k, W1, [0, 2 * PI * rr / 8], [0, 0.15]); fanW(B, q[0], q[1], rr * 0.97, 1.1, k, wc); if (lod >= 2) beam(B, 'c', [q[0], 1.6, q[1]], [q[0] + rr, 1.6, q[1]], 0.8, 0.5, col('#d9dbdb')); }
      else { const r = fm.r(a, c0, b, c1); boxW(B, r, 0.05, 1.3, MW.conc('#ffffff'), { notop: true }); if (L.cover) B.flat('c', r, 1.3, col('#9aa58a')); else { B.quad('i:water', [r[0] + 0.3, 1.1, r[3] - 0.3], [r[2] - 0.3, 1.1, r[3] - 0.3], [r[2] - 0.3, 1.1, r[1] + 0.3], [r[0] + 0.3, 1.1, r[1] + 0.3], null, mul(wc, 1.25), [r[0] / 32, r[3] / 32, r[2] / 32, r[3] / 32, r[2] / 32, r[1] / 32, r[0] / 32, r[1] / 32]); if (lod >= 2) { const q0 = fm.p(a, (c0 + c1) / 2), q1 = fm.p(b, (c0 + c1) / 2); beam(B, 'c', [q0[0], 1.5, q0[1]], [q1[0], 1.5, q1[1]], 0.8, 0.3, col('#c9ccce')); } } }
    }
    if (lod >= 2) { fence(B, F, 1.8, W1, 8, A.frontEdge(F, fr)); trees(B, fm, Wd, R, bz + 2, 5); }
  }
});
function fanW(B, cx, cz, r, y, n, c) { const [u0, v0] = [0, 0]; for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.tri('i:water', [cx + Math.cos(t0) * r, y, cz + Math.sin(t0) * r], [cx, y, cz], [cx + Math.cos(t1) * r, y, cz + Math.sin(t1) * r], [0, 1, 0], mul(c, 1.25), [(cx + Math.cos(t0) * r) / 32, (cz + Math.sin(t0) * r) / 32, cx / 32, cz / 32, (cx + Math.cos(t1) * r) / 32, (cz + Math.sin(t1) * r) / 32]); } void u0; void v0; }
// 水力発電所（i_hydro）：発電所の建物・水圧管（山から）・放水路・開閉所
const HYDRO = [
  { n: '打放し・黒い水圧管', W: '#cfccc4', pipe: '#3a3c3e', fc: '#cfccc4' },
  { n: 'れんが造りの 古い発電所', W: '#a5644a', pipe: '#5a4a40', fc: '#a5644a', brick: true },
  { n: '白い建屋・緑の水圧管', W: '#ecebe6', pipe: '#5f7a64', fc: '#ecebe6' },
  { n: '山の中の 灰色の建屋', W: '#a9adb0', pipe: '#6a6c6e', fc: '#a9adb0' }
];
A.arch('i_hydro', {
  looks: HYDRO,
  far(L, P) { return { H: 12, base: 0, wall: 'i:fw:koba', bw: 4, fh: 12, tb: 1, tf: 1, roof: null, rc: col('#8a8c8c'), rt: 'flat', ins: 4, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f);
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); B.cap('i:lawn', F, 0.05, col('#b8c4a0'), { su: 24 });
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 3), fr), Wd = fm.W, D = fm.D;
    const G = RF(fm.r(Wd * 0.25, D * 0.15, Wd * 0.75, Math.min(D * 0.5, D * 0.15 + 30))), H = 6 + f * 4;
    const LL = Object.assign({}, KOBA[0], { W: L.brick ? MW.brick : MW.conc(L.W), fc: L.fc, rc: '#8a8c8c', rt: 'gable', p: 0.15, bk: 7, bh: 'lo', dk: 9, wain: 0, sg: null, RS: MR.orib('#8a8e90') });
    shed(B, P, LL, G, H, { fe: G.edges[fm.fi], ms: 30 });
    if (lod >= 0) { // 水圧管：奥から 建物へ（ななめに 上がる）
      const np = lod >= 1 ? 2 : 1; for (let k = 0; k < np; k++) { const u = Wd * (0.42 + k * 0.16), a = fm.p(u, Math.min(D * 0.5, D * 0.15 + 30)), b = fm.p(u, D - 2); beam(B, 'c', [a[0], 3, a[1]], [b[0], Math.min(40, D * 0.4), b[1]], 2.4, 2.4, col(L.pipe)); }
      if (lod >= 1) { const q = fm.p(Wd / 2, D - 4); boxW(B, [q[0] - 8, q[1] - 3, q[0] + 8, q[1] + 3], 0, Math.min(40, D * 0.4) + 3, MW.conc('#d9d7d0'), { ct: col('#9a9c9a') }); } }
    if (lod >= 1) { const P3 = (u, v) => { const q = fm.p(u, v); return [q[0], 0.08, q[1]]; }; B.quad('i:water', P3(Wd * 0.4, 0), P3(Wd * 0.6, 0), P3(Wd * 0.6, D * 0.15), P3(Wd * 0.4, D * 0.15), null, W1, [0, 0, 1, 0, 1, 1, 0, 1]); }
    if (lod >= 2) { const sw = { u0: 0, v0: D * 0.55, u1: Wd * 0.22, v1: D * 0.85 }; switchyard(B, P, fm, sw, R, { h: 12 }); fence(B, F, 1.8, W1, 6, A.frontEdge(F, fr)); }
  }
});
// 地熱発電所（i_geo）：冷却塔（ファン）・ゆげ・銀色の 配管・タービン建屋
const GEO = [
  { n: '冷却塔と 白いゆげ', W: '#e6e4de', ct: '#c9ccce', pipe: '#c9ccce', fc: '#e6e4de' },
  { n: '銀色の配管が はしる', W: '#c9cdcf', ct: '#b5b9bc', pipe: '#dfe2e4', fc: '#c9cdcf' },
  { n: '緑の建屋・赤い配管', W: '#8fa596', ct: '#a9b0a8', pipe: '#a8483a', fc: '#8fa596' },
  { n: '茶色の建屋・木の冷却塔', W: '#b8a088', ct: '#8a7060', pipe: '#c9ccce', fc: '#b8a088' }
];
A.tex('i:steam', 128, 128, (g, w, h, R) => { g.clearRect(0, 0, w, h); for (let i = 0; i < 40; i++) { const x = w * (0.2 + 0.6 * R()), y = h * R(), r = w * (0.12 + 0.2 * R()) * (1 - y / h * 0.4); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); } }, { tr: true, op: 0.75 });
A.arch('i_geo', {
  looks: GEO,
  far(L, P) { return { H: 14, base: 0, wall: 'i:fw:koba', bw: 4, fh: 14, tb: 1, tf: 1, roof: null, rc: col('#8a8c8c'), rt: 'flat', ins: 4, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f);
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); B.cap('i:grav', F, 0.05, col('#d8d4c8'), { su: 16 });
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 3), fr), Wd = fm.W, D = fm.D;
    const G = RF(fm.r(Wd * 0.05, D * 0.1, Wd * 0.45, D * 0.5)), H = 10 + f * 4;
    shed(B, P, Object.assign({}, KOBA[0], { W: MW.paint(L.W), fc: L.fc, rc: '#9a9c9c', rt: 'gable', p: 0.12, wain: 0, sg: null }), G, H, { fe: G.edges[fm.fi], ms: 30 });
    // 冷却塔（ファンの 箱）と ゆげ
    const ct = fm.r(Wd * 0.55, D * 0.15, Wd * 0.95, D * 0.45); boxW(B, ct, 0, 12, MW.kaku(L.ct), { ct: mul(col(L.ct), 0.8) });
    const nf = Math.max(1, Math.round(rw(ct) * rd(ct) / 200)); for (let i = 0; i < Math.min(nf, 4); i++) { const x = ct[0] + rw(ct) * (i + 0.5) / Math.min(nf, 4), z = (ct[1] + ct[3]) / 2; frustum(B, 'c', x, z, 3, 3.4, 12, 15, lod >= 1 ? 10 : 6, mul(col(L.ct), 0.9)); if (lod >= 1) { const sw = 7, sh2 = 22; for (const t of [0, PI / 2]) B.quad('i:steam', [x - Math.cos(t) * sw, 15, z - Math.sin(t) * sw], [x + Math.cos(t) * sw, 15, z + Math.sin(t) * sw], [x + Math.cos(t) * sw * 1.6, 15 + sh2, z + Math.sin(t) * sw * 1.6], [x - Math.cos(t) * sw * 1.6, 15 + sh2, z - Math.sin(t) * sw * 1.6], null, W1, [0, 0, 1, 0, 1, 1, 0, 1]); } }
    // 配管（坑井から）
    if (lod >= 1) for (let k = 0; k < 3; k++) { const a = fm.p(Wd * 0.3, D * 0.5), b = fm.p(Wd * (0.2 + 0.3 * k), D - 4); beam(B, 'c', [a[0], 2.5, a[1]], [b[0], 2.5, b[1]], 0.9, 0.9, col(L.pipe)); if (lod >= 2) { B.cyl('c', b[0], b[1], 1.4, 0.05, 3.5, 8, col('#9a9c9c')); } }
    if (lod >= 2) fence(B, F, 1.8, W1, 6, A.frontEdge(F, fr));
  }
});
// 灯台（i_light：f3〜8）
const LIGHT = [
  { n: '白い まるい灯台', c: '#f4f4f0', b2: null, top: '#3a3d40', fc: '#f4f4f0' },
  { n: '赤白の しまの灯台', c: '#f4f4f0', b2: '#c8473a', top: '#c8473a', fc: '#e8c8c0' },
  { n: '黒白の しまの灯台', c: '#f4f4f0', b2: '#2e3032', top: '#2e3032', fc: '#a9abac' },
  { n: '四角いコンクリ灯台', c: '#e9e7e1', b2: null, top: '#5d6a78', square: true, fc: '#e9e7e1' }
];
A.arch('i_light', {
  looks: LIGHT,
  far(L, P) { const f = Math.max(3, P.f); return { H: f * 3.6, base: 0, wall: 'c', roof: null, rc: col(L.top), rt: 'flat', ins: 2, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, lod = P.lod, fr = P.front || [0, 1], f = Math.max(3, P.f), h = f * 3.6, r0 = F.rects[0], x = (r0[0] + r0[2]) / 2, z = (r0[1] + r0[3]) / 2, r = cl(Math.min(rw(r0), rd(r0)) * 0.22, 1.8, 4), n = L.square ? 4 : lod >= 2 ? 12 : lod >= 1 ? 8 : 6, cc = col(L.c);
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); if (lod >= 1) B.cap('i:cpad', F, 0.05, W1, { su: 16 });
    const nb = L.b2 && lod >= 1 ? 4 : 1; for (let i = 0; i < nb; i++) { const y0 = h * i / nb, y1 = h * (i + 1) / nb, ra = r * (1 - 0.25 * i / nb), rb = r * (1 - 0.25 * (i + 1) / nb); frustum(B, 'c', x, z, ra, rb, y0, y1, n, L.b2 && i % 2 ? col(L.b2) : cc); }
    const rt = r * 0.75; frustum(B, 'c', x, z, rt * 1.5, rt * 1.5, h, h + 0.4, n, cc);
    if (lod >= 1) for (const e of RF([x - rt * 1.5, z - rt * 1.5, x + rt * 1.5, z + rt * 1.5]).edges) railE(B, e, h + 0.4, 1, col('#5a5c5e'));
    const [v0, v1] = SV(6, 8, 0.02); if (lod >= 1) for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.quad('i:win', [x + Math.cos(t0) * rt, h + 0.4, z + Math.sin(t0) * rt], [x + Math.cos(t1) * rt, h + 0.4, z + Math.sin(t1) * rt], [x + Math.cos(t1) * rt, h + 2.6, z + Math.sin(t1) * rt], [x + Math.cos(t0) * rt, h + 2.6, z + Math.sin(t0) * rt], null, W1, [0, v0, 0.3, v0, 0.3, v1, 0, v1]); }
    if (lod >= 1) B.dome('c', x, z, rt * 1.05, rt * 1.05, h + 2.6, rt * 0.9, n, col(L.top), { rings: 2 }); else fan(B, x, z, rt * 1.2, h + 0.4, h + 3.4, n, col(L.top));
    if (lod >= 1 && rw(r0) > 9) { const G = RF([r0[0] + 1, r0[1] + 1, x - r - 0.5, r0[1] + Math.min(7, rd(r0) * 0.5)]); if (rw(G.rects[0]) > 3) boxW(B, G.rects[0], 0, 3.2, MW.alc('#eeeeea'), { ct: col('#c9cbcb') }); }
    void fr;
  }
});
// 電波塔（i_radio：f30〜100）：ふつうの ラチスの 塔（赤白の帯）。上に アンテナ
const RADIO = [
  { n: '赤白の しまの鉄塔', a: '#c8473a', b: '#eeeeea', fc: '#d89088' },
  { n: '白い鉄塔・赤い先', a: '#eeeeea', b: '#eeeeea', tip: '#c8473a', fc: '#e6e6e2' },
  { n: '灰色の鉄塔', a: '#a9adb0', b: '#a9adb0', fc: '#a9adb0' },
  { n: '赤白の 三角の鉄塔', a: '#c8473a', b: '#eeeeea', tri: true, fc: '#d89088' }
];
A.arch('i_radio', {
  looks: RADIO,
  far(L, P) { return { H: 6, base: 0, wall: 'i:fw:ofc', bw: 4, fh: 3.5, tb: 1, tf: 1, roof: null, rc: col('#9a9c9c'), rt: 'flat', ins: 3, wc: col('#e6e4de') }; },
  build(B, L, P) {
    const F = P.F, lod = P.lod, fr = P.front || [0, 1], f = Math.max(30, P.f), h = Math.min(f * 3.2, 330), r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), x = (r0[0] + r0[2]) / 2, z = (r0[1] + r0[3]) / 2, w0 = cl(Math.min(rw(r0), rd(r0)) * 0.55, 8, h * 0.12);
    pave(B, P, F, 'i:cpad');
    const nb = lod >= 1 ? 7 : 3, hm = h * 0.86;   // 帯（下から）
    for (let i = 0; i < nb; i++) { const y0 = hm * i / nb, y1 = hm * (i + 1) / nb, wa = w0 * (1 - 0.8 * i / nb), wb = w0 * (1 - 0.8 * (i + 1) / nb), cc = col(i % 2 ? L.b : L.a);
      if (lod <= 0) B.box('c', x - wa * 0.3, z - wa * 0.3, x + wa * 0.3, z + wa * 0.3, y0, y1, cc); else latTower(B, x, z, wa, wb, y0, y1, cc); }
    const wt = w0 * 0.2; B.box('c', x - wt * 0.8, z - wt * 0.8, x + wt * 0.8, z + wt * 0.8, hm, hm + 2, col(L.a));
    B.box('c', x - 0.6, z - 0.6, x + 0.6, z + 0.6, hm + 2, h, col(L.tip || L.b));
    if (lod >= 1) for (const yy of [hm * 0.45, hm * 0.7]) { const ww = w0 * (1 - 0.8 * yy / hm) * 0.6; B.box('c', x - ww, z - ww, x + ww, z + ww, yy, yy + 2.4, col('#d9dcdc')); }
    if (lod >= 1) { const G = RF([r0[0] + 1, r0[1] + 1, Math.min(r0[2] - 1, r0[0] + 12), Math.min(r0[3] - 1, r0[1] + 8)]); boxW(B, G.rects[0], 0, 4, MW.alc('#e6e4de'), { ct: col('#c9cbcb') }); }
    if (lod >= 2) fence(B, F, 2.4, W1, 5, A.frontEdge(F, fr));
  }
});

/* ---------- 農業（i_farm：f=0）：田んぼ・麦・畑・果樹・茶・ぶどう・花・牧場・植林 ----------
   i:field：16 本の帯（たての すじ＝うね。u は うねを横ぎる向きに m でくり返す、v は うねにそって のばす）
   帯 0 水田・1 青田・2 稲穂・3 稲刈りあと・4 れんげ・5 青い麦・6 黄金の麦・7 キャベツ・8 耕した土・9 黒マルチ・10 茶・11 牧草・12 ラベンダー・13 ひまわり・14 チューリップ・15 下草（果樹） */
const FSU = [6, 6, 6, 6, 8, 24, 24, 6, 4, 6, 7.2, 30, 6, 6, 24, 10];
A.tex('i:field', 256, 512, (g, w, h, R) => {
  const sh = h / 16, S = (k, f) => clip(g, 0, k * sh, w, sh, () => f(k * sh));
  const rows = (y, n, c, a, wd) => { for (let i = 0; i < n; i++) { const x = (i + 0.5) * w / n; rect(g, x - wd / 2, y, wd, sh, `rgba(${c},${a})`); } };
  S(0, y => { const gr = g.createLinearGradient(0, y, 0, y + sh); gr.addColorStop(0, '#9fb3ba'); gr.addColorStop(0.5, '#8ea4ad'); gr.addColorStop(1, '#97abb3'); g.fillStyle = gr; g.fillRect(0, y, w, sh); rows(y, 20, '90,130,60', 0.4, 1.5); for (let i = 0; i < 60; i++) rect(g, R() * w, y + R() * sh, 6 + R() * 10, 1, 'rgba(225,235,238,.25)'); PT.noise(g, 0, y, w, sh, 0.02, R); });
  S(1, y => { rect(g, 0, y, w, sh, '#6f9a3a'); rows(y, 20, '40,70,20', 0.35, 3); rows(y, 20, '140,180,80', 0.25, 1); PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(2, y => { rect(g, 0, y, w, sh, '#c8a548'); rows(y, 20, '120,90,30', 0.3, 3); rows(y, 20, '230,200,110', 0.25, 1); PT.noise(g, 0, y, w, sh, 0.05, R); });
  S(3, y => { rect(g, 0, y, w, sh, '#a3906c'); rows(y, 20, '210,190,140', 0.45, 2); rows(y, 20, '90,70,50', 0.3, 1); PT.noise(g, 0, y, w, sh, 0.06, R); });
  S(4, y => { rect(g, 0, y, w, sh, '#7c9a4a'); for (let i = 0; i < 900; i++) rect(g, R() * w, y + R() * sh, 1.5, 1.5, `rgba(${R() < 0.7 ? '210,120,170' : '235,200,225'},.9)`); PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(5, y => { rect(g, 0, y, w, sh, '#7f9e45'); for (let i = 0; i < 128; i++) rect(g, i * w / 128, y, 1, sh, 'rgba(50,80,20,.25)'); for (const t of [0.25, 0.75]) { rect(g, w * t - 3, y, 2, sh, 'rgba(110,95,60,.7)'); rect(g, w * t + 2, y, 2, sh, 'rgba(110,95,60,.7)'); } PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(6, y => { rect(g, 0, y, w, sh, '#d1b25c'); for (let i = 0; i < 128; i++) rect(g, i * w / 128, y, 1, sh, 'rgba(150,120,50,.25)'); for (const t of [0.25, 0.75]) { rect(g, w * t - 3, y, 2, sh, 'rgba(120,100,60,.6)'); rect(g, w * t + 2, y, 2, sh, 'rgba(120,100,60,.6)'); } PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(7, y => { rect(g, 0, y, w, sh, '#7d6a4e'); for (let i = 0; i < 10; i++) { const x = (i + 0.5) * w / 10; for (let v = 0; v < 8; v++) { g.fillStyle = css(mix('#7aa35a', '#9cc06a', R())); g.beginPath(); g.arc(x, y + (v + 0.5) * sh / 8, w / 26, 0, PI * 2); g.fill(); } } PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(8, y => { for (let i = 0; i < 16; i++) { const x = i * w / 16; const gr = g.createLinearGradient(x, 0, x + w / 16, 0); gr.addColorStop(0, '#6a5640'); gr.addColorStop(0.5, '#937a58'); gr.addColorStop(1, '#6a5640'); g.fillStyle = gr; g.fillRect(x, y, w / 16 + 0.5, sh); } PT.noise(g, 0, y, w, sh, 0.06, R); });
  S(9, y => { rect(g, 0, y, w, sh, '#8a7456'); for (let i = 0; i < 4; i++) { const x = i * w / 4; const gr = g.createLinearGradient(x, 0, x + w / 6, 0); gr.addColorStop(0, '#2a2b2d'); gr.addColorStop(0.5, '#4a4c50'); gr.addColorStop(1, '#2a2b2d'); g.fillStyle = gr; g.fillRect(x + w / 32, y, w / 6, sh); for (let v = 0; v < 6; v++) rect(g, x + w / 12, y + (v + 0.5) * sh / 6, 2, 2, '#6a9a4a'); } PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(10, y => { for (let i = 0; i < 4; i++) { const x = i * w / 4; const gr = g.createLinearGradient(x, 0, x + w / 4, 0); gr.addColorStop(0, '#22301a'); gr.addColorStop(0.15, '#3f5e2a'); gr.addColorStop(0.5, '#6e9440'); gr.addColorStop(0.85, '#3f5e2a'); gr.addColorStop(1, '#22301a'); g.fillStyle = gr; g.fillRect(x, y, w / 4 + 0.5, sh); } PT.noise(g, 0, y, w, sh, 0.05, R, 2); });
  S(11, y => { rect(g, 0, y, w, sh, '#86a35a'); rect(g, 0, y, w / 2, sh, 'rgba(255,255,230,.07)'); PT.noise(g, 0, y, w, sh, 0.05, R, 2); });
  S(12, y => { rect(g, 0, y, w, sh, '#4f6a3a'); for (let i = 0; i < 20; i++) { const x = (i + 0.5) * w / 20; const gr = g.createLinearGradient(x - 6, 0, x + 6, 0); gr.addColorStop(0, 'rgba(125,100,180,.6)'); gr.addColorStop(0.5, 'rgba(150,120,205,1)'); gr.addColorStop(1, 'rgba(125,100,180,.6)'); g.fillStyle = gr; g.fillRect(x - 6, y, 12, sh); } PT.noise(g, 0, y, w, sh, 0.05, R); });
  S(13, y => { rect(g, 0, y, w, sh, '#5d7a38'); for (let i = 0; i < 16; i++) for (let v = 0; v < 8; v++) { const x = (i + 0.5) * w / 16 + (R() - 0.5) * 3, yy = y + (v + 0.5) * sh / 8; g.fillStyle = '#e8b828'; g.beginPath(); g.arc(x, yy, w / 50, 0, PI * 2); g.fill(); rect(g, x - 1, yy - 1, 2, 2, '#5a3a1a'); } });
  S(14, y => { const C = ['#c8383a', '#e8c040', '#f2f0ea', '#e88aa8', '#e8803a', '#8a4ab0']; for (let i = 0; i < 8; i++) rect(g, i * w / 8, y, w / 8, sh, A.pick(R, C)); for (let i = 0; i < 64; i++) rect(g, i * w / 64, y, 1, sh, 'rgba(60,90,40,.35)'); PT.noise(g, 0, y, w, sh, 0.04, R); });
  S(15, y => { rect(g, 0, y, w, sh, '#7d955a'); for (let i = 0; i < 2; i++) rect(g, (i + 0.35) * w / 2, y, w * 0.15, sh, '#8a7a5a'); PT.noise(g, 0, y, w, sh, 0.06, R, 2); });
});
// 畑の ます（長方形 r を うねの向きで：ax 'x' なら うねは z 向き）。帯 k
function plot(B, r, y, k, ax, c) {
  const [v0, v1] = SV(k, 16, 0.08), su = FSU[k], cc = c || W1;
  if (ax === 'x') B.quad('i:field', [r[0], y, r[3]], [r[2], y, r[3]], [r[2], y, r[1]], [r[0], y, r[1]], null, cc, [r[0] / su, v0, r[2] / su, v0, r[2] / su, v1, r[0] / su, v1]);
  else B.quad('i:field', [r[0], y, r[3]], [r[2], y, r[3]], [r[2], y, r[1]], [r[0], y, r[1]], null, cc, [r[3] / su, v0, r[3] / su, v1, r[1] / su, v1, r[1] / su, v0]);
}
// 畦（あぜ：ほそい 土の もり上がり。長方形の まわりの 線）
function aze(B, x0, z0, x1, z1, wd, h, c) { const X = Math.abs(x1 - x0) >= Math.abs(z1 - z0); if (X) B.box('c', Math.min(x0, x1), z0 - wd / 2, Math.max(x0, x1), z0 + wd / 2, 0.02, h, c); else B.box('c', x0 - wd / 2, Math.min(z0, z1), x0 + wd / 2, Math.max(z0, z1), 0.02, h, c); }
// うねの山（茶・果樹・ぶどうの垣根）：長方形 r の中に ax 向きの 列。prof：高さ h・はば wd・あいだ sp
function hedges(B, r, ax, h, wd, sp, c, lim, y0 = 0.05) {
  const X = ax === 'x', L0 = X ? rd(r) : rw(r), n = Math.min(lim, Math.max(1, Math.floor(L0 / sp))), cc = col(c), dk = mul(cc, 0.72);
  for (let i = 0; i < n; i++) { const t = (X ? r[1] : r[0]) + (i + 0.5) * L0 / n, a = X ? r[0] : r[1], b = X ? r[2] : r[3];
    const P = (s, o, hh) => X ? [s, y0 + hh, t + o] : [t + o, y0 + hh, s];
    B.quad('c', P(a, -wd / 2, 0), P(b, -wd / 2, 0), P(b, -wd * 0.3, h), P(a, -wd * 0.3, h), null, dk);
    B.quad('c', P(a, -wd * 0.3, h), P(b, -wd * 0.3, h), P(b, wd * 0.3, h), P(a, wd * 0.3, h), null, cc);
    B.quad('c', P(a, wd * 0.3, h), P(b, wd * 0.3, h), P(b, wd / 2, 0), P(a, wd / 2, 0), null, mul(cc, 0.88)); }
}
// 杉（円すいの木）
function sugi(B, x, z, y, h, r, c, n = 5) { const cc = col(c); for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2; B.tri('c', [x + Math.cos(t0) * r, y + h * 0.18, z + Math.sin(t0) * r], [x, y + h, z], [x + Math.cos(t1) * r, y + h * 0.18, z + Math.sin(t1) * r], null, i % 2 ? cc : mul(cc, 0.85)); } }
// ふつうの木（みかん・りんご：低い まるい木）
function bush(B, x, z, y, h, r, c) { const cc = col(c), n = 5; for (let i = 0; i < n; i++) { const t0 = i / n * PI * 2, t1 = (i + 1) / n * PI * 2, a = [x + Math.cos(t0) * r, y + h * 0.5, z + Math.sin(t0) * r], b = [x + Math.cos(t1) * r, y + h * 0.5, z + Math.sin(t1) * r]; B.tri('c', a, [x, y + h, z], b, null, cc); B.tri('c', b, [x, y + h * 0.12, z], a, null, mul(cc, 0.7)); } }
// 農業の 見た目：plots（帯のならび）・p（畦の色）・crop（上に のせるもの）
const FARMK = {
  paddy: [
    { n: '水を張った 田んぼ', k: [0], aze: '#8a9a5a', fc: '#9ab0b6' },
    { n: '青々とした 稲', k: [1], aze: '#7a9a4a', fc: '#6f9a3a' },
    { n: '黄金色の 稲穂', k: [2], aze: '#7a8a4a', fc: '#c8a548' },
    { n: '稲刈りあと・はざ掛け', k: [3], aze: '#8a8a5a', fc: '#a3906c', haza: true },
    { n: 'れんげの 田んぼ', k: [4], aze: '#7a9a4a', fc: '#8f8a6a' }
  ],
  mugi: [
    { n: '青い 麦畑', k: [5], aze: '#7a8a5a', fc: '#7f9e45' },
    { n: '黄金色の 麦畑', k: [6], aze: '#8a8a5a', fc: '#d1b25c' },
    { n: '麦わらの ロール', k: [3], aze: '#8a8a5a', fc: '#b8a070', bale: true },
    { n: '麦畑と 防風林', k: [6, 5], aze: '#7a8a5a', fc: '#a9a650', wind: true }
  ],
  hatake: [
    { n: 'キャベツ畑', k: [7], aze: '#8a7a5a', fc: '#7d8a5a' },
    { n: '耕した 畑', k: [8], aze: '#7a6a4e', fc: '#806a4e' },
    { n: '黒いマルチの 畑', k: [9], aze: '#8a7a5a', fc: '#5a5048' },
    { n: 'いろいろな 野菜', k: [7, 9, 8, 1], aze: '#8a7a5a', fc: '#7d7a58' },
    { n: '畑とビニールトンネル', k: [8, 7], aze: '#8a7a5a', fc: '#8a7a5e', tunnel: true }
  ],
  farm: [
    { n: '田と 畑の まだら', k: [1, 7, 1, 8], aze: '#7a9a4a', fc: '#7a8a50' },
    { n: '水田と 黒マルチの畑', k: [0, 9, 0], aze: '#8a9a5a', fc: '#8a9a9a' },
    { n: '稲穂と キャベツ', k: [2, 7, 2], aze: '#7a8a4a', fc: '#a99a58' },
    { n: '冬の 田畑', k: [3, 8, 3], aze: '#8a8a5a', fc: '#94806a' }
  ],
  kaju: [
    { n: 'みかん畑', k: [15], tree: '#3d5a2a', fruit: '#e08a2a', fc: '#4f6a36' },
    { n: 'りんご畑', k: [15], tree: '#55743a', fruit: '#c83a3a', fc: '#5f7a42' },
    { n: '梨の 棚', k: [15], tana: '#6a8a42', fc: '#6a8a42' },
    { n: '柿の 畑', k: [15], tree: '#6a7a3a', fruit: '#d8742a', fc: '#6f7a42' }
  ],
  cha: [
    { n: '茶畑と 防霜ファン', k: [10], hedge: '#4f7a32', fan: true, fc: '#4f7a32' },
    { n: '新芽の 茶畑', k: [10], hedge: '#7aa046', fan: false, fc: '#6f9a3c', tint: [1.25, 1.2, 1.0] },
    { n: '刈りこんだ 茶畑', k: [10], hedge: '#3f6428', fan: true, fc: '#3f6428', tint: [0.85, 0.9, 0.85] },
    { n: '段々の 茶畑', k: [10], hedge: '#4a7030', fan: false, fc: '#4a7030', step: true }
  ],
  vineyard: [
    { n: 'ぶどうの 棚', k: [15], tana: '#5f8a3a', fc: '#5f8a3a' },
    { n: 'ぶどうの 垣根', k: [15], hedge: '#4f7a32', hh: 1.8, sp: 2.6, fc: '#5f7a40' },
    { n: '雨よけの ビニール屋根', k: [15], hedge: '#4f7a32', hh: 1.8, sp: 2.8, cover: true, fc: '#c9d2cc' },
    { n: '秋の ぶどう棚', k: [15], tana: '#b8903a', fc: '#a8883a' }
  ],
  flowerfield: [
    { n: 'ラベンダー', k: [12], fc: '#8a76b0' },
    { n: 'ひまわり', k: [13], fc: '#c9a830' },
    { n: 'チューリップ', k: [14], fc: '#c87a6a' },
    { n: 'コスモス', k: [4], fc: '#b48aa0', tint: [1.1, 0.95, 1.05] },
    { n: '菜の花', k: [13], fc: '#c9b830', tint: [1.05, 1.08, 0.7] }
  ],
  ranch: [
    { n: '赤い屋根の 牛舎', k: [11], barn: '#a8483a', silo: '#3f6f9a', fc: '#86a35a' },
    { n: '緑の屋根の 牛舎', k: [11], barn: '#4f7a5a', silo: '#d9d6cc', fc: '#86a35a' },
    { n: '白い柵と ロールベール', k: [11], barn: '#6a6a6a', silo: '#c9ccce', bale: true, fc: '#8aa35e' },
    { n: '広い 放牧地', k: [11], barn: '#8a5a3a', silo: null, cows: 2, fc: '#86a35a' }
  ],
  forestry: [
    { n: '杉の 植林', tree: '#2f4a2a', h: 22, fc: '#2f4a2a' },
    { n: 'ひのきの 植林', tree: '#3a5a32', h: 18, fc: '#3a5a32' },
    { n: '若い 植林', tree: '#4a6a3a', h: 7, fc: '#5a7a42' },
    { n: '伐採あとと 植林', tree: '#2f4a2a', h: 20, cut: true, fc: '#5a6a42' }
  ],
  ufarm: [
    { n: '田と ハウスと 研究棟', k: [1, 8], gh: true, lab: '#e9e6de', fc: '#7a8a50' },
    { n: '畑と 白い研究棟', k: [7, 9], gh: false, lab: '#f0f0ec', fc: '#7a7a58' },
    { n: 'ハウスが ならぶ 農場', k: [8], gh: true, lab: '#d9d4c8', fc: '#a9aaa4' },
    { n: '果樹と 牧草の 農場', k: [15, 11], gh: false, lab: '#e2ddd2', fc: '#7a9a50' }
  ]
};
A.arch('i_farm', {
  looks: FARMK.paddy,
  far(L, P) { return { H: 0.2, base: 0.05, wall: 'c', ct: col(L.fc), ins: 0 }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, t = P.ko.t || 'paddy', y = 0.06;
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05, col('#8a7a5a'));
    if (t === 'forestry') return forest(B, P, L, F);
    const ks = L.k || [11], ac = col(L.aze || '#7a8a5a'), tint = L.tint ? L.tint : W1;
    let pi = 0, nTree = 0, nFan = 0, nHz = 0, nBale = 0, nTun = 0;
    for (const r0 of F.rects) {
      const X = rw(r0) >= rd(r0);   // 長いほうに うね
      if (lod <= 0) { plot(B, r0, y, ks[0], X ? 'z' : 'x', tint); continue; }
      // ます：長いほうに 長さ 60〜100m・はば 20〜30m（田は 30m）
      const L1 = X ? rw(r0) : rd(r0), L2 = X ? rd(r0) : rw(r0), pl = t === 'paddy' || t === 'farm' ? 30 : 40, nA = Math.max(1, Math.round(L1 / 100)), nB = Math.max(1, Math.round(L2 / pl));
      for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
        const a0 = (X ? r0[0] : r0[1]) + L1 * i / nA, a1 = a0 + L1 / nA, b0 = (X ? r0[1] : r0[0]) + L2 * j / nB, b1 = b0 + L2 / nB, r = X ? [a0, b0, a1, b1] : [b0, a0, b1, a1];
        const k = ks[(pi++) % ks.length]; plot(B, r, y, k, X ? 'z' : 'x', tint);
        if (lod >= 2 && L.tunnel && pi % 2 === 0 && nTun < 32) { const nt = Math.min(8, Math.floor(rw(r) / 2.5)); nTun += nt; for (let q = 0; q < nt; q++) { const x = r[0] + (q + 0.5) * rw(r) / nt; barrelRoof(B, [x - 0.6, r[1] + 1, x + 0.6, r[3] - 1], 0.05, { m: 'c', su: 1, c: col('#e9ece9') }, null, { p: 0.5, lod: 0, ax: 'z', ms: 99, oh: 0 }); } }
        if (lod >= 2 && L.haza && nHz < 6 && R() < 0.5) { nHz++; const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2; B.obox('c', cx, cz, X ? 0 : PI / 2, Math.min(12, rw(r) * 0.6), 0.5, 0.6, 2.0, col('#c9b27a'), {}); }
        if (lod >= 2 && L.bale) for (let q = 0; q < 3 && nBale < 24; q++, nBale++) { const x = r[0] + rw(r) * R(), z = r[1] + rd(r) * R(); hcyl(B, 'c', 'x', x, 0.75, z, 0.75, 1.2, 6, col(t === 'ranch' ? '#eeeeea' : '#d9c27a'), true); }
      }
      // 畦と 農道
      if (lod >= 1 && (t === 'paddy' || t === 'farm' || t === 'mugi' || t === 'hatake' || t === 'flowerfield' || t === 'ufarm')) {
        const h = t === 'paddy' || t === 'farm' ? 0.3 : 0.12, wd = t === 'paddy' || t === 'farm' ? 0.6 : 0.8;
        if (t === 'paddy' || t === 'farm') { const q = inR(r0, wd / 2); aze(B, q[0], q[1], q[2], q[1], wd, h, ac); aze(B, q[0], q[3], q[2], q[3], wd, h, ac); aze(B, q[0], q[1], q[0], q[3], wd, h, ac); aze(B, q[2], q[1], q[2], q[3], wd, h, ac); }
        for (let j = 1; j < nB; j++) { const b = (X ? r0[1] : r0[0]) + L2 * j / nB; if (X) aze(B, r0[0], b, r0[2], b, wd, h, ac); else aze(B, b, r0[1], b, r0[3], wd, h, ac); }
        for (let i = 1; i < nA; i++) { const a = (X ? r0[0] : r0[1]) + L1 * i / nA; if (X) B.box('c', a - 1.5, r0[1], a + 1.5, r0[3], 0.03, 0.12, col('#a9a492')); else B.box('c', r0[0], a - 1.5, r0[2], a + 1.5, 0.03, 0.12, col('#a9a492')); }
      }
      // うえもの
      if (lod >= 1 && (t === 'cha' || (t === 'vineyard' && L.hedge))) {
        const sp = L.sp || 1.8, hh = L.hh || 1.0, lim = lod >= 2 ? 90 : 24, sp2 = lod >= 2 ? sp : sp * Math.max(1, Math.ceil(((X ? rd(r0) : rw(r0)) / sp) / lim));
        hedges(B, inR(r0, 1), X ? 'x' : 'z', hh, sp * 0.62, sp2, L.hedge, lim);
        if (L.cover && lod >= 2) hedges(B, inR(r0, 1), X ? 'x' : 'z', hh + 0.8, sp * 0.8, sp2, '#dfe6e2', lim, 0.05);
        if (L.fan && lod >= 2) { const nf = cl(Math.round(rw(r0) * rd(r0) / 600), 1, 30 - nFan); for (let q = 0; q < nf; q++, nFan++) { const x = r0[0] + rw(r0) * ((q * 0.618) % 1), z = r0[1] + rd(r0) * ((q * 0.382 + 0.2) % 1); B.box('c', x - 0.06, z - 0.06, x + 0.06, z + 0.06, 0, 6.5, [0.55, 0.55, 0.53]); B.obox('c', x, z, 0.5, 1.2, 0.3, 6.3, 6.9, [0.75, 0.76, 0.76], {}); } }
      }
      if (lod >= 1 && L.tana) { const r = inR(r0, 1.5); B.flat('c', r, 1.9, col(L.tana)); if (lod >= 2) { B.flat('c', r, 1.88, mul(col(L.tana), 0.6), { down: true }); const n2 = Math.min(30, Math.round(rw(r) / 8) * Math.round(rd(r) / 8)); for (let q = 0; q < n2; q++) { const x = r[0] + rw(r) * R(), z = r[1] + rd(r) * R(); B.box('c', x - 0.05, z - 0.05, x + 0.05, z + 0.05, 0, 1.9, [0.5, 0.45, 0.38]); } } }
      if (lod >= 1 && L.tree) {   // 果樹：まるい木の列（多いときは うねの山で）
        const sp = 5, nx = Math.floor(rw(r0) / sp), nz = Math.floor(rd(r0) / sp), lim = lod >= 2 ? 160 : 40;
        if (nx * nz <= lim - nTree) { for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) { bush(B, r0[0] + (a + 0.5) * sp, r0[1] + (b + 0.5) * sp, 0.05, 3.2, 2.0, L.tree); nTree++; } }
        else hedges(B, inR(r0, 1), X ? 'x' : 'z', 3.0, 3.6, sp, L.tree, lod >= 2 ? 60 : 20);
        if (lod >= 2 && L.fruit) for (let q = 0; q < 12; q++) { const x = r0[0] + rw(r0) * R(), z = r0[1] + rd(r0) * R(); B.box('c', x - 0.25, z - 0.25, x + 0.25, z + 0.25, 2.2, 2.7, col(L.fruit)); }
      }
      if (lod >= 2 && L.wind && r0 === F.rects[0]) { const n2 = Math.min(30, Math.floor((X ? rw(r0) : rd(r0)) / 6)); for (let q = 0; q < n2; q++) { const s2 = (X ? r0[0] : r0[1]) + (q + 0.5) * (X ? rw(r0) : rd(r0)) / n2; sugi(B, X ? s2 : r0[0] + 1.5, X ? r0[1] + 1.5 : s2, 0.05, 12, 2.2, '#3a5a32'); } }
    }
    if (t === 'ranch') ranchProps(B, P, L, F);
    if (t === 'ufarm' && lod >= 1) { const r0 = F.rects[0], fm = frame(inR(r0, 2), P.front || [0, 1]); if (fm.W > 20 && fm.D > 20) { const G = RF(fm.r(2, 2, Math.min(fm.W * 0.35, 30), Math.min(fm.D * 0.3, 16))); office(B, P, G, 2, 3.6, { ow: L.lab, pc: '#cfcac0', ofc: true }, G.edges[fm.fi]); if (L.gh) for (let i = 0; i < 4; i++) { const u = fm.W * 0.45 + i * 8; if (u + 6 > fm.W) break; tunnel(B, fm.r(u, 4, u + 6, Math.min(fm.D - 2, 40)), 'z', GHL[0], lod); } } }
  }
});
// 植林地：円すいの木（lod 0 は 林のかたまり）
function forest(B, P, L, F) {
  const R = P.rng, lod = P.lod, h = L.h, sp = Math.max(3.5, h * 0.28);
  for (const r0 of F.rects) {
    B.flat('c', r0, 0.06, mul(col(L.tree), 0.9));
    if (lod <= 0) { boxW(B, inR(r0, 1), 0.06, h * 0.75, { m: 'c', su: 1, c: col(L.tree) }, { ct: mul(col(L.tree), 1.08) }); continue; }
    const lim = lod >= 2 ? 300 : 50, nx = Math.floor(rw(r0) / sp), nz = Math.floor(rd(r0) / sp), tot = nx * nz, sk = Math.max(1, Math.ceil(Math.sqrt(tot / lim)));
    let cutR = L.cut ? [r0[0] + rw(r0) * 0.5, r0[1], r0[2], r0[3]] : null;
    if (cutR) B.flat('c', inR(cutR, 0.5), 0.08, col('#8a7a5a'));
    for (let a = 0; a < nx; a += sk) for (let b = 0; b < nz; b += sk) { const x = r0[0] + (a + 0.5) * sp + (R() - 0.5), z = r0[1] + (b + 0.5) * sp + (R() - 0.5); const cut = cutR && x > cutR[0]; const hh = (cut ? h * 0.25 : h) * (0.85 + 0.3 * R()); sugi(B, x, z, 0.06, hh, sp * sk * 0.55 * (cut ? 0.5 : 1), L.tree, lod >= 2 ? 5 : 4); }
  }
}
function ranchProps(B, P, L, F) {
  const R = P.rng, lod = P.lod, fr = P.front || [0, 1], r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 3), fr);
  // 牛舎（白い壁・色の屋根）と サイロ
  const bw = cl(fm.W * 0.4, 12, 50), G = RF(fm.r(3, 3, 3 + bw, 3 + Math.min(14, fm.D * 0.3))), LB = Object.assign({}, KOBA[0], { W: MW.paint('#efeee8'), RS: MR.orib(L.barn), rt: 'gable', p: 0.45, fc: '#efeee8', rc: L.barn, bk: 4, bh: 'lo', dk: 8, dc: '#ffffff', wain: 0.8, sg: null, tr: mul(col(L.barn), 0.8) });
  shed(B, P, LB, G, 4.5, { fe: G.edges[fm.fi], ms: 20 });
  if (L.silo && lod >= 0) { const q = fm.p(3 + bw + 4, 8), n = lod >= 1 ? 10 : 6; frustum(B, 'c', q[0], q[1], 3, 3, 0.05, 16, n, col(L.silo)); B.dome('c', q[0], q[1], 3, 3, 16, 2.6, n, mul(col(L.silo), 0.9), { rings: lod >= 1 ? 3 : 1 }); }
  if (lod >= 2) {
    // 白い 木の柵（まわり）
    const [v0, v1] = SV(2, 8, 0.02); for (const e of F.edges) if (e.out) seg(B, 'i:lat', e, 0.5, e.L - 0.5, 0.05, 1.2, col('#f0f0ea'), [(e.u0) / 6, (e.u0 + e.L) / 6], v0, v1, 1, -0.6);
    const nc = Math.min(24, Math.round(Math.sqrt(F.area) / 8) * (L.cows || 1)); for (let i = 0; i < nc; i++) { const q = fm.p(fm.W * (0.2 + 0.75 * R()), fm.D * (0.35 + 0.6 * R())), a = R() * PI; B.obox('c', q[0], q[1], a, 2.2, 0.8, 0.5, 1.4, R() < 0.6 ? col('#2a2a2a') : col('#efefea'), {}); B.obox('c', q[0] + Math.cos(a) * 1.2, q[1] + Math.sin(a) * 1.2, a, 0.6, 0.5, 1.0, 1.5, col('#2a2a2a'), {}); }
    if (L.bale) for (let i = 0; i < 10; i++) { const q = fm.p(fm.W * (0.5 + 0.45 * R()), fm.D * (0.1 + 0.3 * R())); hcyl(B, 'c', R() < 0.5 ? 'x' : 'z', q[0], 0.8, q[1], 0.8, 1.2, 6, col('#f2f2ee'), true); }
  }
}
/* ---------- ビニールハウス・温室（i_ghouse）：かまぼこの トンネル（連棟は 切妻）・ガラス温室 ---------- */
A.tex('i:green', 128, 128, (g, w, h, R) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f4f6f4'); gr.addColorStop(0.6, '#e2e8e2'); gr.addColorStop(1, '#b9c8b4'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let u = 0; u < w; u += w / 8) { rect(g, u, 0, 1.5, h, 'rgba(120,130,120,.5)'); } blots(g, 0, h * 0.5, w, h * 0.5, 12, '90,120,70', 0.15, R, 0.1); PT.noise(g, 0, 0, w, h, 0.02, R); });
const GHL = [
  { n: '白い ビニールハウス', m: 'i:green', c: '#ffffff', t: 'tunnel', fc: '#e6ebe6' },
  { n: '半透明のハウス', m: 'i:green', c: '#c9dccb', t: 'tunnel', fc: '#c4d4c4' },
  { n: '黒い遮光ネットの ハウス', m: 'i:green', c: '#555a58', t: 'tunnel', fc: '#5a5e5c' },
  { n: '連棟の ハウス', m: 'i:green', c: '#f0f2f0', t: 'multi', fc: '#e6ebe6' },
  { n: 'ガラスの 温室', m: 'i:win', c: '#ffffff', t: 'glass', fc: '#a9bcc6' }
];
function tunnel(B, r, ax, L, lod) {
  const RS = L.m === 'i:win' ? { m: 'i:win', k: 6, n: 8, su: 3, c: col(L.c) } : { m: 'i:green', su: 8, sv: 8, c: col(L.c) };
  return barrelRoof(B, r, 0.9, RS, { m: 'c', su: 1, sv: 1, c: mul(col(L.c), 0.92) }, { p: 0.32, lod: lod >= 2 ? 2 : 0, ax, ms: 99, oh: 0 }) && (lod >= 1 ? (() => { const G = RF(r); for (const e of G.edges) B.wallE('c', e, 0.05, 0.9, mul(col(L.c), 0.85)); })() : 0);
}
A.arch('i_ghouse', {
  looks: GHL,
  far(L, P) { return { H: 3, base: 0, wall: 'c', roof: null, rc: col(L.fc), rt: 'flat', ins: 1, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1], f = Math.max(1, P.f);
    if (lod >= 1 || P.yb < -0.5) B.plinth(F, P.yb, 0.05); for (const r of F.rects) plot(B, r, 0.05, 8, 'x', col('#d8d0c4'));
    for (const r0 of F.rects) {
      const fm = frame(inR(r0, 1), fr), X = fm.s === 'S' || fm.s === 'N', ax = X ? 'z' : 'x';
      if (L.t === 'glass' || L.t === 'multi' || f >= 2) {   // 連棟：切妻の ならび
        const G = RF(inR(r0, 1)), H = L.t === 'glass' ? 4.5 + (f - 1) * 1.5 : 3.2, Wg = L.m === 'i:win' ? { m: 'i:win', k: 6, n: 8, su: 3, c: col(L.c) } : { m: 'i:green', su: 8, sv: 8, c: col(L.c) };
        if (lod <= 0) { lowShed(B, P, G, H, { fc: L.fc, rc: L.fc, rt: 'flat', fw: 'c' }); continue; }
        for (const e of G.edges) { if (Wg.k != null) seg(B, 'i:win', e, 0, e.L, 0.05, H, W1, [0, e.L / 6], SV(6, 8)[0], SV(6, 8)[1], 1); else seg(B, 'i:green', e, 0, e.L, 0.05, H, col(L.c), [e.u0 / 8, (e.u0 + e.L) / 8], 0.05, H / 8, 1); }
        gableRoof(B, G.rects[0], H, Wg.k != null ? { m: 'i:win', k: 6, n: 8, su: 3, c: col(L.c) } : { m: 'i:green', su: 8, sv: 8, c: col(L.c) }, Wg, { p: 0.5, oh: 0, lod: 0, ms: (L.t === 'glass' ? 4 : 6.5) * (lod >= 2 ? 1 : 3), ax });
        if (lod >= 2) door(B, G.edges[fm.fi], G.edges[fm.fi].L / 2, 3, 0.05, 2.4, 6, W1);
        continue;
      }
      // トンネルの ならび
      const hw = 6, gap = 1.6, n = Math.max(1, Math.floor((fm.W + gap) / (hw + gap))), lim = lod >= 2 ? 40 : lod >= 1 ? 14 : 4, sk = Math.max(1, Math.ceil(n / lim));
      for (let i = 0; i < n; i += sk) { const u = i * (hw + gap) + (fm.W - n * (hw + gap) + gap) / 2, r = fm.r(u, 0.5, u + hw * (lod <= 0 ? Math.min(sk, n - i) : 1) + (lod <= 0 ? gap * (Math.min(sk, n - i) - 1) : 0), fm.D - 0.5);
        if (lod <= 1 && sk > 1) { const r2 = fm.r(u, 0.5, Math.min(fm.W, u + sk * (hw + gap) - gap), fm.D - 0.5); tunnel(B, r2, ax, L, 0); continue; } tunnel(B, r, ax, L, lod); if (lod >= 2) door(B, RF(r).edges[fm.fi], (X ? rw(r) : rd(r)) / 2, 1.8, 0.05, 2.0, 6, W1); }
    }
  }
});
// 養鶏場（i_chicken）：窓のない 長い鶏舎・換気扇・飼料の タンク
const CHICK = [
  { n: '白い鶏舎・銀のタンク', W: MW.panel('#f0f0ed'), RS: MR.orib('#c3c6c7'), fc: '#ecece9', rc: '#c3c6c7', tk: '#d9dcde' },
  { n: '銀色の 鶏舎', W: MW.galv, RS: MR.orib('#b5b8b9'), fc: '#b5b9bb', rc: '#b5b8b9', tk: '#e9e9e6' },
  { n: '緑の屋根の 鶏舎', W: MW.paint('#eeede6'), RS: MR.orib('#5c7a66'), fc: '#e8e6dc', rc: '#5c7a66', tk: '#c9ccce' },
  { n: '茶色の屋根・古い鶏舎', W: MW.wood, RS: MR.orust('#b7b1a6'), fc: '#7a6450', rc: '#8a6a56', tk: '#c9c4b8' }
];
A.arch('i_chicken', {
  looks: CHICK,
  far(L, P) { return { H: 4.2, base: 0, wall: 'i:fw:soko', bw: 4, fh: 4.2, tb: 1, tf: 1, roof: null, rc: col(L.rc), rt: 'gable', p: 0.25, ins: 2, wc: col(L.fc) }; },
  build(B, L, P) {
    const F = P.F, R = P.rng, lod = P.lod, fr = P.front || [0, 1];
    pave(B, P, F, 'i:grav', col('#d6d2c6'));
    const r0 = F.rects.reduce((a, r) => rw(r) * rd(r) > rw(a) * rd(a) ? r : a), fm = frame(inR(r0, 2), fr), Wd = fm.W, D = fm.D;
    const sw = Math.min(12, Wd - 0.5), gap = 9, n = cl(Math.floor((Wd + gap) / (sw + gap)), 1, lod >= 1 ? 10 : 3), va = D > 12 ? 4 : 0.5, vb = D > 12 ? D - 2 : D - 0.5, LL = Object.assign({}, KOBA[0], { W: L.W, RS: L.RS, fc: L.fc, rc: L.rc, rt: 'gable', p: 0.25, bk: null, dk: 7, dc: '#ffffff', wain: 0.5, sg: null, mon: true, fw: 'i:fw:soko' });
    for (let i = 0; i < n; i++) { const u = (Wd - n * (sw + gap) + gap) / 2 + i * (sw + gap), G = RF(fm.r(u, va, u + sw, vb)), fe = G.edges[fm.fi];
      shed(B, P, LL, G, 3.6, { fe: null, ms: 20 });
      if (lod >= 1) { for (let k = 0; k < 3; k++) door(B, G.edges[(fm.fi + 2) % 4], sw * (k + 0.5) / 3, 1.6, 0.8, 1.6, 4, W1); door(B, fe, sw / 2, 2.4, 0, 2.4, 0, W1); }
      if (lod >= 2) { const q = fm.p(u + sw + 2.2, 7); frustum(B, 'c', q[0], q[1], 1.4, 1.4, 2.0, 7, 8, col(L.tk)); fan(B, q[0], q[1], 1.4, 7, 7.8, 8, col(L.tk)); fan(B, q[0], q[1], 1.4, 2.0, 0.8, 8, mul(col(L.tk), 0.8)); } }
    if (lod >= 2) { fence(B, F, 1.8, W1, 6, A.frontEdge(F, fr)); const q = fm.p(Wd * 0.8, 1.5); truck(B, q[0], q[1], fm.ua, { L: 6.5, box: '#e9e9e6' }); }
  }
});

/* ---------- プリセット → 型 ---------- */
const KM = {};
Object.assign(KM, {
  warehouse: 'i_soko', smallwh: 'i_soko', coldwh: ['i_soko', { looks: COLD, cold: true }], delivery: ['i_soko', { dock: true, small: true }], truckterm: ['i_soko', { cross: true }], wholesale: ['i_soko', { market: true }],
  factory: 'i_plant', foodf: ['i_plant', { clean: 1, tanks: 4 }], confect: ['i_plant', { clean: 1, tanks: 3 }], breadf: ['i_plant', { clean: 1, trucks: 1 }], pharma: ['i_plant', { clean: 1, tanks: 3 }],
  cosme: ['i_plant', { clean: 1, tanks: 3 }], beverage: ['i_plant', { tanks: 12, stain: 1 }], beer: ['i_plant', { tanks: 16, stain: 1 }], carf: ['i_plant', { long: 1, cars: 1 }], railf: ['i_plant', { long: 1, rail: 1 }],
  frozen: ['i_plant', { clean: 1, trucks: 1 }], glass: ['i_plant', { chim: 1, chimH: 55, tanks: 3 }], recycle: ['i_plant', { scrap: 1 }], elecf: ['i_plant', { clean: 1 }], mill: ['i_plant', { silo: 1, siloH: 34 }],
  paper: ['i_plant', { chim: 1, chimH: 80, pile: 1, pileC: '#b89c70' }],
  hangar: 'i_hangar', mro: 'i_hangar', fueltank: 'i_tank', oiltank: ['i_tank', { oil: 1 }], oilport: ['i_tank', { oil: 1, sea: 1 }], arsenal: 'i_navy',
  container: 'i_cyard', containerport: ['i_cyard', { sea: 1 }], whbldg: 'i_logi', dc: 'i_logi', trunk: 'i_trunk', sake: 'i_sake',
  steelw: 'i_steel', petro: 'i_petro', cement: 'i_cement', thermal: 'i_power', garbage: 'i_incin', cleanfac: 'i_incin',
  port: 'i_port', navpier: ['i_port', { t: 'navy', looks: NAVPIER }], fishport: ['i_port', { t: 'fish', looks: FISH }], marina: ['i_port', { t: 'marina', looks: MARINA }], ferry: ['i_port', { t: 'ferry', looks: FERRY }],
  drydock: ['i_port', { t: 'dock', looks: DOCKL }], shipyard: ['i_port', { t: 'yard', looks: DOCKL }],
  airfield: ['i_air', { sz: 0 }], airport_s: ['i_air', { sz: 1 }], airport_m: ['i_air', { sz: 2 }], airport_l: ['i_air', { sz: 3 }], heliport: 'i_heli', ctower: 'i_ctower', radar: 'i_radar',
  parking: 'i_park', bigpark: ['i_park', { big: 1 }], coinpark: ['i_park', { coin: 1, looks: COIN }], tsukigime: ['i_park', { tsuki: 1 }], bikepark: ['i_park', { bike: 1, looks: BIKE }],
  pkbld: 'i_pkbld', mechpark: 'i_mech', busterm: 'i_bus',
  substation: 'i_subst', solar: 'i_solar', wind: 'i_wind', water: 'i_water', pwater: 'i_water', sewage: ['i_water', { looks: WATER.slice(0, 2).concat([WATER[3], { n: '茶色い水の池・灰色の建物', wc: '#7a6e58', W: '#c9cdcf', gm: 'i:lawn', round: false, fc: '#8f9a80' }]) }],
  hydro: 'i_hydro', geothermal: 'i_geo', lighthouse: 'i_light', radiotower: 'i_radio',
  paddy: 'i_farm', mugi: ['i_farm', { t: 'mugi', looks: FARMK.mugi }], hatake: ['i_farm', { t: 'hatake', looks: FARMK.hatake }], farm: ['i_farm', { t: 'farm', looks: FARMK.farm }],
  kaju: ['i_farm', { t: 'kaju', looks: FARMK.kaju }], cha: ['i_farm', { t: 'cha', looks: FARMK.cha }], vineyard: ['i_farm', { t: 'vineyard', looks: FARMK.vineyard }], flowerfield: ['i_farm', { t: 'flowerfield', looks: FARMK.flowerfield }],
  ranch: ['i_farm', { t: 'ranch', looks: FARMK.ranch }], forestry: ['i_farm', { t: 'forestry', looks: FARMK.forestry }], ufarm: ['i_farm', { t: 'ufarm', looks: FARMK.ufarm }],
  greenhouse: 'i_ghouse', ugh: ['i_ghouse', { looks: [GHL[4], GHL[3], GHL[0], { n: '遮光幕のガラス温室', m: 'i:win', c: '#8a9292', t: 'glass', fc: '#7d8688' }] }], chicken: 'i_chicken',
  machikoba: 'i_koba', parts: 'i_koba', metal: 'i_koba', precision: 'i_koba', print: 'i_koba', machine: 'i_koba', furniture: 'i_koba', textile: 'i_koba'
});
A.kinds(KM);
})();
