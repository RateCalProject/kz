/* 百人一首 かるた対戦：風の芽経済組（風の芽製作所）につなぐところ（2026-10-31）
   ゲームの本体（index.html の中）は、ホーム・対戦のはじめ・おわりで、ここを呼ぶ1行だけ足した：
   - ホームに「‹ 風の芽経済組」と「🏆 賞・タスク」。オンライン対戦は room.js の部屋で（公開MQTTサーバー・Realtime・同じ端末）
   - AI と対戦したら、ログインしていれば結果をサーバーへ。プレイ時間・勝った強さで賞。強いAI（Lv7〜）に勝つと X（1日の上限あり）
*/
(function () {
  'use strict';
  const CFG = window.AILINAX_CONFIG || {};
  let sb = null, user = null, run = null, last = null, noSrv = false;
  try { if (window.supabase && CFG.url && CFG.anonKey) sb = window.supabase.createClient(CFG.url, CFG.anonKey); } catch (e) {}
  window.KZ_SB = sb;   // オンライン対戦の部屋（room.js）が、近くの中継（Realtime）に使う
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = n => Number(n || 0).toLocaleString('ja-JP');
  async function rpc(fn, args) {
    if (!sb) throw new Error('nosb');
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) { if (/PGRST202|Could not find the function/i.test((error.code || '') + ' ' + (error.message || ''))) noSrv = true; throw error; }
    return data;
  }
  async function who() {
    if (!sb) return null;
    try { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.user : null; } catch (e) { return null; }
  }
  // 賞（サーバーと同じ。ここは見せるため）
  const AW = [
    ['win1', '初勝利', 'AI に1回勝つ'], ['lv3', '初級に勝つ', 'Lv3 初級 以上の AI に勝つ'], ['lv5', '普通に勝つ', 'Lv5 普通 以上に勝つ'],
    ['lv7', '上級に勝つ', 'Lv7 上級 以上に勝つ'], ['lv8', '強豪に勝つ', 'Lv8 強豪 以上に勝つ'], ['lv9', '名人に勝つ', 'Lv9 名人 以上に勝つ'], ['lv10', '鬼に勝つ', 'Lv10 鬼 に勝つ'],
    ['st3', '3連勝', 'Lv5 以上に3回つづけて勝つ'], ['st10', '10連勝', 'Lv5 以上に10回つづけて勝つ'],
    ['g10', '10戦', 'AI 対戦を10回'], ['g50', '50戦', 'AI 対戦を50回'], ['g200', '200戦', 'AI 対戦を200回'],
    ['t10', '10分', 'AI 対戦を合計10分'], ['t60', '1時間', 'AI 対戦を合計1時間'], ['t300', '5時間', 'AI 対戦を合計5時間'], ['t1200', '20時間', 'AI 対戦を合計20時間'],
  ];
  const PRIZE = [[7, 200], [8, 500], [9, 1000], [10, 2000]];   // 強いAIに勝ったときの X（札50枚のとき。少ない札は、その割合）

  // ---- ホーム：もどるリンク・賞のボタン。オンライン対戦はかくす ----
  function decorateHome() {
    const home = document.querySelector('.home'); if (!home) return;
    if (!(window.claude && window.claude.use)) { const ol = home.querySelector('[data-act="go-online"]'); if (ol) ol.remove(); }
    if (!home.querySelector('.kz-back')) {
      const a = document.createElement('a'); a.className = 'kz-back'; a.href = '../'; a.textContent = '‹ 風の芽経済組';
      home.insertBefore(a, home.firstChild);
    }
    const menu = home.querySelector('.menu');
    if (menu && !menu.querySelector('[data-kz="aw"]')) {
      const b = document.createElement('button'); b.dataset.kz = 'aw';
      b.innerHTML = '<i>賞</i><b>賞・タスク</b><small>強さとプレイ時間で賞。強いAI（Lv7〜）に勝つと X</small>';
      b.onclick = ev => { ev.stopPropagation(); showAwards(); };
      menu.appendChild(b);
    }
  }
  // ---- 賞・タスクの画面 ----
  async function showAwards() {
    const app = document.getElementById('app');
    const draw = (st, msg) => {
      const got = (st && st.awards) || {}, n = Object.keys(got).length;
      const prog = k => {
        if (!st) return '';
        const m = /^(g|t|st)(\d+)$/.exec(k); if (!m) return '';
        const v = m[1] === 'g' ? st.games : m[1] === 't' ? Math.floor((st.secs || 0) / 60) : st.best_streak, goal = Number(m[2]);
        return got[k] ? '' : `<small class="kz-prog">${fmtN(Math.min(v || 0, goal))} / ${fmtN(goal)}${m[1] === 't' ? '分' : m[1] === 'g' ? '回' : '連勝'}</small>`;
      };
      app.innerHTML = `<div class="screen"><div class="bar"><button class="back" data-kz="home">‹ もどる</button><h2>賞・タスク</h2></div>
        <div class="kz-aw">
          ${msg ? `<p class="note">${msg}</p>` : ''}
          ${st ? `<div class="kz-st"><div><b>${fmtN(st.games)}</b><small>対戦</small></div><div><b>${fmtN(st.wins)}</b><small>勝ち</small></div>
              <div><b>${st.best_lv ? 'Lv' + st.best_lv : '—'}</b><small>勝った強さ</small></div><div><b>${fmtN(Math.floor((st.secs || 0) / 60))}<span>分</span></b><small>プレイ時間</small></div></div>` : ''}
          <h3>賞 <small>${st ? `${n} / ${AW.length}` : ''}</small></h3>
          <div class="kz-grid">${AW.map(([k, t, d]) => `<div class="kz-a ${got[k] ? 'on' : ''}"><b>${got[k] ? '🏆' : '・'} ${escH(t)}</b><small>${escH(d)}</small>${prog(k)}</div>`).join('')}</div>
          <h3>強いAIに勝つと X</h3>
          <div class="kz-pz">${PRIZE.map(([lv, x]) => `<div><b>Lv${lv}</b><span>${fmtN(x)} X</span></div>`).join('')}</div>
          <p class="note">AI と1対1か、AI を何人か入れた対戦で、いちばん強いAIのレベルで決まります。札が50枚より少ないときは、その割合だけ。1日にもらえるのは ${fmtN(st && st.cap_x || 3000)} X まで${st ? `（きょう ${fmtN(st.today_x || 0)} X）` : ''}。お金は国庫から出ます。</p>
        </div></div>`;
      app.querySelector('[data-kz="home"]').onclick = () => window.__hyakunin.home();
    };
    user = await who();
    if (!user) return draw(null, 'ログインしていないので、賞と X はもらえません。<a href="../">風の芽経済組</a>でログインしてから、ここを開いてください（AI との対戦は、ログインしなくても遊べます）。');
    draw(null, '読みこんでいます…');
    try { draw(await rpc('karuta_me')); }
    catch (e) { draw(null, noSrv ? '賞と X は、サーバーの更新のあとに始まります。もうしばらくお待ちください。' : '読みこめませんでした（' + escH(e.message || e) + '）'); }
  }

  // ---- AI との対戦のはじめとおわり ----
  async function onStart(G) {
    run = null;
    try {
      if (!G || G.practice || G.online) return;
      const hum = G.players.filter(p => p.kind === 'human'), ais = G.players.filter(p => p.kind === 'ai');
      if (hum.length !== 1 || !ais.length) return;   // AI との対戦（人は自分だけ）
      user = user || await who(); if (!user) return;
      const lv = Math.max(...ais.map(p => p.level || 1));
      const r = await rpc('karuta_start', { p_lv: lv, p_n_ai: ais.length, p_cards: G.deck.length });
      if (window.__hyakunin.state() === G && r && r.run) run = { id: r.run, g: G };
    } catch (e) {}
  }
  async function onFinish(G) {
    const r0 = run; run = null;
    if (!r0 || r0.g !== G || !G || G.practice) return;
    const me = G.players.find(p => p.kind === 'human'), top = Math.max(...G.players.filter(p => p.kind === 'ai').map(p => p.score));
    let res = null;
    try { res = await rpc('karuta_end', { p_run: r0.id, p_won: me.score > top, p_my: me.score, p_top: top }); } catch (e) { return; }
    last = res; showResult(res);
  }
  function showResult(res) {
    const box = document.querySelector('.result'); if (!box || !res) return;
    const parts = [];
    if (res.x > 0) parts.push(`<b>＋${fmtN(res.x)} X</b>（Lv${res.lv} に勝った ごほうび。国庫から）`);
    else if (res.why) parts.push(escH(res.why));
    for (const k of res.new || []) { const a = AW.find(x => x[0] === k); if (a) parts.push(`🏆 賞「${escH(a[1])}」`); }
    if (!parts.length) return;
    const d = document.createElement('div'); d.className = 'kz-res'; d.innerHTML = parts.map(p => `<div>${p}</div>`).join('');
    const rk = box.querySelector('.rank'); box.insertBefore(d, rk ? rk.nextSibling : box.firstChild);
  }

  // ---- ゲームから呼ばれる（index.html の中の showHome・newGame・finish のおわりに、1行ずつ足してある） ----
  window.kzOnHome = () => decorateHome();
  window.kzOnStart = g => { onStart(g); };
  window.kzOnFinish = g => { onFinish(g); };

  // 見た目（ゲームのテーマの色をつかう）
  const st = document.createElement('style');
  st.textContent = `.kz-back{align-self:flex-start;color:var(--mute);text-decoration:none;font-size:14px;margin-bottom:-10px}
.kz-aw{max-width:640px;margin:0 auto;padding:14px 18px 36px;display:flex;flex-direction:column;gap:12px}
.kz-aw h3{margin:8px 0 0;font-family:var(--f-disp);color:var(--tx)}.kz-aw h3 small{color:var(--mute);font-size:13px;margin-left:6px}
.kz-st{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kz-st div{background:var(--panel);border-radius:12px;padding:10px 6px;text-align:center;display:flex;flex-direction:column}
.kz-st b{font-size:20px;color:var(--tx)}.kz-st b span{font-size:12px;margin-left:2px}.kz-st small{color:var(--mute);font-size:12px}
.kz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.kz-a{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:9px 10px;display:flex;flex-direction:column;gap:3px;opacity:.62}
.kz-a.on{opacity:1;border-color:var(--kin)}.kz-a b{color:var(--tx);font-size:14px}.kz-a small{color:var(--mute);font-size:12px;line-height:1.35}.kz-prog{color:var(--kjc)!important}
.kz-pz{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kz-pz div{background:var(--panel);border-radius:12px;padding:8px;text-align:center;display:flex;flex-direction:column}
.kz-pz b{color:var(--kin)}.kz-pz span{color:var(--tx);font-weight:700}
.kz-res{margin:10px auto 0;max-width:420px;background:var(--panel);border:1px solid var(--kin);border-radius:12px;padding:10px 12px;color:var(--tx);display:flex;flex-direction:column;gap:4px;text-align:center}
.kz-res b{color:var(--kin);font-size:18px}`;
  document.head.appendChild(st);
  try { decorateHome(); } catch (e) {}
})();
