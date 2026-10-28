// 市区町村バトル（賭けありの部屋）のサーバーの進行。Edge Function（Deno）とテスト（Node）の両方から使う。
//   handle(sql, body)：sql は postgres.js。body.a = create / start / move / pick / tick
//   部屋は game_rooms（game = 'battle'）の行をロックして読み、手の列から盤を組み立て直して確かめる（engine.mjs は battle/index.html からの自動生成）
import { makeEngine } from './engine.mjs';
import { ENGINE } from './version.mjs';

let DATA = null;
export function init(data) { DATA = data; }
export { ENGINE };

const MV_RE = /c[0-9A-Za-z_-]{4}[xX][0-9A-Za-z_-]{4}|[mdasMDAS][0-9A-Za-z_-]{4}/g;
const GRACE = 2000;          // 締め切りのあとの猶予（通信の遅れ）
const PICK_MS = 90000;       // 本拠地をえらぶ時間（すぎたらCPUがえらぶ。もとのルールと同じ）
const MAX_MV = 5 * 20000;    // 手の列の長さの上限

class UserError extends Error { constructor(m) { super(m); this.user = true; } }
const fail = m => { throw new UserError(m); };

// 乱数（暗号用の乱数から 0以上1未満）
const rnd = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53; };
// 盤ごとのエンジン（同じ盤なら使い回す）
const ENG = new Map();
function engineFor(p) {
  let E = ENG.get(p);
  if (E) { ENG.delete(p); ENG.set(p, E); return E; }
  E = makeEngine(DATA.DATA, DATA.SPECDATA, DATA.SISDATA, DATA.FXDATA, rnd);
  const prefs = E.decPrefs(p);
  if (!prefs.length) fail('盤が正しくありません');
  E.loadBoard(prefs);
  if (ENG.size >= 3) ENG.delete(ENG.keys().next().value);
  ENG.set(p, E);
  return E;
}

// 設定を確かめて、決まった形にそろえる（もとの画面の validCfg と checkForm ＋ 賭けありの部屋の決まり）
export function cleanCfg(c0) {
  if (!c0 || typeof c0 !== 'object') fail('設定が正しくありません');
  const c = { r: String(c0.r || ''), p: c0.p, n: c0.n, l: c0.l, tm: c0.tm ? 1 : 0, tt: c0.tm ? c0.tt : '', om: c0.om, os: c0.os, mr: c0.mr, ps: c0.ps,
              tb: c0.tb, by: c0.by, hs: c0.hs ? 1 : 0, sp: c0.sp | 0 };
  const E = engineFor(c.p);
  if (!E.validCfg(c)) fail('設定が正しくありません');
  if (!(c.tb > 0 || c.by > 0)) fail('賭けありの部屋は、持ち時間か秒読みを決めてください（時間が切れたらCPUがかわりに指します）');
  const prefs = E.decPrefs(c.p), np = c.n;
  if (c.hs) { const c4 = E.countStar4(prefs); if (c4 < np) fail(c4 ? `この盤には★4の町が${c4}つしかないので、${c4}人までです` : 'この盤には★4の町がありません'); }
  if (E.countStarts(prefs) < np * E.perCount(np, c.ps) + np * 2) fail('この人数と町の数には盤が小さすぎます');
  return c;
}

// 組み立て直す：開始の配置と手の列から、いまの盤
function rebuild(E, st) {
  const c = st.cfg, n = c.n, sd = E.sideArr(c), P = st.plan;
  const G0 = E.makeBase(n, { tm: !!c.tm, sd, ord: P.o, mr: E.roundLimit(n, c.mr) });
  if (P.m === 1) {
    if (P.k.length < n) return { G: G0, picking: true };
    for (let i = 0; i < n; i++) E.claimCluster(G0, G0.ord[i], P.k[i]);
  } else {
    for (const p of G0.ord) E.claimCluster(G0, p, P.c[p]);
  }
  G0.turn = G0.ord[0]; G0.round = 1; G0.ply = 0; G0.last = null;
  let G = G0;
  for (const s of (st.mv || '').match(MV_RE) || []) {
    const m = E.decMove(s, G);
    if (!m) throw new Error('記録の手が読めません');
    G = E.apply(G, m); delete G.bad; G = E.settle(G, false);
  }
  return { G, picking: false };
}

// 1つの部屋の進行
class Match {
  constructor(row, now) {
    this.row = row; this.st = row.state; this.c = this.st.cfg; this.n = this.c.n; this.now = now;
    this.E = engineFor(this.c.p);
    this.cpu = row.seats.map(x => x == null);          // 空いた席はCPU
    this.byo = (this.c.by | 0) * 1000;
    this.changed = false;
  }
  isCpu(p) { return this.cpu[p]; }
  load() { const r = rebuild(this.E, this.st); this.G = r.G; this.picking = r.picking; }
  // いまの番の時計（人の番だけ。CPUの番は締め切りなし）
  startTurn() {
    const st = this.st, G = this.G;
    if (this.picking) {
      const i = st.plan.k.length, p = st.plan.o[i];
      st.ck = Object.assign(st.ck || {}, { p: -1 });
      if (this.isCpu(p)) { st.due = null; st.cpu = true; } else { st.due = this.now + PICK_MS; st.cpu = false; }
      return;
    }
    if (G.winner >= 0) { st.ck.p = -1; st.due = null; st.cpu = false; return; }
    const p = G.turn;
    if (this.isCpu(p)) { st.ck.p = -1; st.due = null; st.cpu = true; }
    else { st.ck.p = p; st.ck.t0 = this.now; st.due = this.now + (st.ck.b[p] || 0) + this.byo; st.cpu = false; }
  }
  commit(m) {
    const E = this.E, st = this.st;
    if (m.t === 'c') E.rollSummon(this.G, m);
    const s = E.encMove(m);
    if ((st.mv || '').length + s.length > MAX_MV) fail('手が多すぎるので、これ以上進められません');
    st.mv = (st.mv || '') + s; st.n = (st.n | 0) + 1;
    this.G = E.apply(this.G, m); delete this.G.bad; this.G = E.settle(this.G, false);
    st.turn = this.G.turn; st.round = this.G.round;
    this.changed = true;
    this.startTurn();
  }
  addPick(p, v) {
    const E = this.E, st = this.st, k = st.plan.k, sd = E.sideArr(this.c);
    k.push(E.growPick(E.pickOwnOf(k, st.plan.o), v, p, E.perCount(this.n, this.c.ps), sd));
    this.changed = true;
    if (k.length >= this.n) { this.load(); st.turn = this.G.turn; st.round = 1; st.ck.b = st.ck.b || new Array(this.n).fill((this.c.tb | 0) * 1000); }
    this.startTurn();
  }
  pickOk(v) {
    const E = this.E, st = this.st;
    if (!Number.isInteger(v) || v < 0 || v >= E.N) return false;
    if (!E.startCands(!!this.c.hs, this.n).includes(v)) return false;
    return E.pickOwnOf(st.plan.k, st.plan.o)[v] < 0;
  }
  // CPUの番・時間切れを進める（budget ms まで）
  auto(budget) {
    const t0 = Date.now(), st = this.st, E = this.E;
    for (;;) {
      if (this.picking) {
        const i = st.plan.k.length, p = st.plan.o[i];
        if (Date.now() - t0 > budget) { st.cpu = true; return; }
        if (this.isCpu(p) || (st.due != null && this.now > st.due + GRACE)) {
          const own = E.pickOwnOf(st.plan.k, st.plan.o);
          const v = E.cpuPickNode(E.startCands(!!this.c.hs, this.n), own, st.plan.k, st.plan.o, p, E.sideArr(this.c));
          this.addPick(p, v);
          continue;
        }
        return;
      }
      const G = this.G;
      if (G.winner >= 0) return;
      if (Date.now() - t0 > budget) { st.cpu = true; return; }
      const p = G.turn;
      if (this.isCpu(p)) {
        const m = E.cpuChoose(G, this.c.l);
        if (!m) throw new Error('CPUの手が見つかりません');
        this.commit(m); continue;
      }
      if (st.due != null && this.now > st.due + GRACE) {   // 時間切れ：CPUがかわりに指す（もとのルール）
        st.ck.b[p] = 0; st.ck.p = -1;
        const m = E.cpuChoose(G, this.c.l, { auto: true });
        if (!m) throw new Error('CPUの手が見つかりません');
        m.auto = true; this.commit(m); continue;
      }
      if (st.ck.p !== p) this.startTurn();   // 念のため
      return;
    }
  }
  result() {
    const G = this.G, E = this.E;
    const winners = [...Array(this.n).keys()].filter(p => E.wins(G, G.winner, p));
    const score = [...Array(this.n).keys()].map(p => E.score(G, p));
    return { win: G.winner, endBy: G.endBy || '', winners, score, ply: G.ply, round: G.round, team: this.c.tm ? [E.teamScore(G, 0), E.teamScore(G, 1)] : null };
  }
}

async function lockRoom(tx, rid) {
  const r = await tx`select id, host, to_jsonb(seats) as seats, status, max_seats, stake, bets_on, state from game_rooms where id = ${rid} and game = 'battle' for update`;
  if (!r.length) fail('その部屋は見つかりません');
  const row = r[0];
  row.seats = (row.seats || []).map(x => x == null ? null : String(x));
  row.host = String(row.host);
  return row;
}
async function save(tx, M) {
  const st = M.st;
  await tx`update game_rooms set state = ${tx.json(st)}, act_at = now() where id = ${M.row.id}`;
  if (st.ph === 'play' && !M.picking && M.G && M.G.winner >= 0) {
    const res = M.result();
    st.ph = 'over'; st.cpu = false; st.due = null;
    await tx`update game_rooms set state = ${tx.json(st)} where id = ${M.row.id}`;
    const why = res.endBy === 'king' ? '本拠地を合併して決着' : res.endBy === 'round' ? '巡数で決着（★の合計）' : '決着';
    await tx`select public._bt_settle(${M.row.id}, ${res.winners}::int[], ${why}, ${tx.json(res)})`;
  }
}
async function snapshot(tx, uid, rid) {
  await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
  const r = await tx`select public.bt_state(${rid}) as s`;
  return r[0].s;
}
async function auth(tx, ticket) {
  const r = await tx`select public._bt_auth(${ticket || ''}) as u`;
  return String(r[0].u);
}

// 入口
export async function handle(sql, body, opt = {}) {
  if (!body || typeof body !== 'object') fail('送るものが正しくありません');
  const a = body.a, now = () => opt.now ? opt.now() : Date.now();
  if (body.b && ENGINE.build && body.b !== ENGINE.build) fail('市区町村バトルの画面が古いか新しすぎます。画面を読み込み直してください');
  const budget = opt.budget || 700;
  return await sql.begin(async tx => {
    if (a === 'create') {
      const u = await auth(tx, body.t);
      const c = cleanCfg(body.cfg);
      const stake = Math.floor(Number(body.stake) || 0);
      const r = await tx`select public._bt_create(${u}, ${tx.json(c)}, ${String(body.title || '').slice(0, 30)}, ${stake}, ${!!body.bets}, ${ENGINE.hash}) as id`;
      const rid = Number(r[0].id);
      return { room: rid, s: await snapshot(tx, u, rid) };
    }
    const rid = Number(body.room);
    if (!Number.isInteger(rid) || rid < 1) fail('部屋がわかりません');
    let u = null;
    if (a === 'tick' && body.key) {
      const k = await tx`select value from app_settings where key = 'bt_key'`;
      if (!k.length || k[0].value !== body.key) fail('だめです');
    } else u = await auth(tx, body.t);
    const row = await lockRoom(tx, rid);
    const st = row.state;
    if (a === 'start') {
      if (row.status !== 'waiting') fail('この部屋はもう始まっています');
      if (row.host !== u) fail('部屋をつくった人だけ始められます');
      const c = cleanCfg(st.cfg), n = c.n, E = engineFor(c.p), sd = E.sideArr(c);
      if (c.tm && !E.teamsOK(sd)) fail('紅白戦は、紅と白の両方に1人以上入れてください');
      const P = c.sp === 2 ? null : E.planStarts(n, sd, !!c.tm, E.perCount(n, c.ps), !!c.hs, c.sp === 1 ? 'rand' : 'some');
      const O = c.om === 'd' ? E.diceOrder(n) : { order: E.decOrder(c.os, n) || [...Array(n).keys()], rolls: null };
      const d = O.rolls ? O.rolls.map(x => x.join('')) : null;
      Object.assign(st, { cfg: c, ph: 'play', g: 1, plan: P ? { s: P.starts, c: P.clusters, o: O.order, d } : { o: O.order, d, m: 1, k: [] },
                          mv: '', n: 0, ck: { b: new Array(n).fill((c.tb | 0) * 1000), p: -1, t0: now() }, due: null, cpu: false, round: 1, rx: [] });
      const M = new Match(row, now());
      M.load(); M.startTurn(); M.auto(budget);
      st.turn = M.picking ? null : M.G.turn;
      await tx`select public._bt_start(${rid}, ${u}, ${tx.json(st)})`;
      if (!M.picking && M.G.winner >= 0) { row.status = 'playing'; await save(tx, M); }
      return { s: await snapshot(tx, u, rid) };
    }
    if (row.status !== 'playing' || st.ph !== 'play') {
      if (a === 'tick') return { s: u ? await snapshot(tx, u, rid) : null };
      fail('この対局はもう終わっています');
    }
    const M = new Match(row, now());
    const seat = u ? row.seats.indexOf(u) : -1;
    if (a === 'tick') {
      // 何もすることがなければ、組み立て直さずに返す
      const due = st.due != null && now() > st.due + GRACE;
      if (!st.cpu && !due) return { s: u ? await snapshot(tx, u, rid) : null };
      M.load(); M.auto(budget); await save(tx, M);
      return { s: u ? await snapshot(tx, u, rid) : null };
    }
    if (seat < 0) fail('あなたはこの対局に参加していません');
    M.load();
    M.auto(Math.min(budget, 400));   // 先に、たまっているCPUの番と時間切れを進める
    let err = null;
    if (a === 'pick') {
      const i = body.i, v = body.v;
      if (!M.picking) err = '本拠地はもう決まっています';
      else if (i !== st.plan.k.length || st.plan.o[i] !== seat) err = 'いまはあなたが本拠地をえらぶ番ではありません';
      else if (!M.pickOk(v)) err = 'その町は本拠地にできません';
      else { M.addPick(seat, v); M.auto(budget); }
    } else if (a === 'move') {
      const G = M.G;
      if (M.picking) err = 'まだ本拠地をえらんでいます';
      else if (G.winner >= 0) err = 'この対局はもう終わっています';
      else if (G.turn !== seat) err = 'いまはあなたの番ではありません';
      else if (body.n !== (st.n | 0) || body.g !== (st.g | 0)) err = '盤面が古くなっています（最新にしました）';
      else {
        const m = M.E.decMove(body.m, G);
        let real = null;
        if (m && m.t === 'c') { if (m.r === M.E.SUM_WAIT && !m.auto && M.E.summonLegal(G, G.turn, m.ps)) real = m; }
        else if (m && !m.auto) real = M.E.genMoves(G, G.turn, false).find(x => M.E.sameMove(x, m)) || null;
        if (!real) err = 'その手は指せません';
        else {
          const ck = st.ck; ck.b[seat] = Math.max(0, (ck.b[seat] || 0) - Math.max(0, M.now - (ck.t0 || M.now))); ck.p = -1;
          M.commit(real); M.auto(budget);
        }
      }
    } else fail('わからない操作です');
    if (M.changed || st.cpu) await save(tx, M);
    const s = await snapshot(tx, u, rid);
    if (err) return { error: err, s };
    return { s };
  });
}
