-- DB の更新123：ほかの人が 線路を引く（つなぐ・分かれ道をつくる）と「通信がとぎれました」になる のを直す
--   列車の多い路線網（その持ち主の系統と 乗り入れの系統の 列車が 400本より多い）では、系統の時刻の組みなおしに 1分ちかく かかり、
--   ゲートウェイ・ブラウザ（60秒）が先に切れていた。道すじは いま書きかえて、時刻は あとで組みなおす（mp_resched_q。1分ごとの _mp_resched_run）
--   線路をつくる・直す・つなぐ・こわす・設定を変える 関数の時間の上限は 50秒に（切れるときは「時間がかかりすぎました」と わかる）
--   mp_seg_build は、時刻を あとで組みなおすとき later を返す（画面が「系統の時刻は 1分ほどで 組みなおします」）

-- 系統の時刻を あとで組みなおす（DB の更新123）：線路の持ち主（pu・pc）ごとに まとめて 1分ごと（_mp_resched_run）
create table if not exists public.mp_resched_q (
  rid bigint primary key references public.mp_routes(id) on delete cascade,   -- 時刻を組みなおす系統
  pu  uuid,                                                                   -- 線路の持ち主（その人の系統・乗り入れの系統を まとめて 見なおす）
  pc  int,
  at  timestamptz not null default now()
);
alter table public.mp_resched_q enable row level security;
revoke all on public.mp_resched_q from anon, authenticated;

create or replace function public._mp_routes_fix(pu uuid, pc int, p_only bigint[] default null) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; i int; leg jsonb; lg jsonb; bad text; ids bigint[] := '{}'; lgs jsonb[] := '{}'; bads text[] := '{}'; same boolean[] := '{}'; k int;
        fp0 text;   -- DB の更新88
        near boolean[] := '{}';   -- DB の更新94
        zlater boolean;   -- 時刻は あとで（DB の更新123）
begin
  -- 1. 系統ごとに、線路の道すじを出しなおす
  --    p_only（DB の更新94）：その線を通らない系統は、道すじが変わらないので出しなおさない（線を分けて行きどまりの線をつないだ・線を1本にした・消した・
  --    設定を変えたときで、新しくつながったところがないとき。道すじは線の長さとつながりだけで決まるので）
  for r in select * from mp_routes x where x.kind = 'rail' and ((x.own_u is not distinct from pu and x.own_c is not distinct from pc)
             or exists (select 1 from mp_thru t where t.hu is not distinct from pu and t.hc is not distinct from pc and t.gu is not distinct from x.own_u and t.gc is not distinct from x.own_c)) loop
    if p_only is not null and not exists (select 1 from jsonb_array_elements(r.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g where (g ->> 0)::bigint = any(p_only)) then
      ids := ids || r.id; lgs := lgs || r.legs; bads := bads || case when r.ok then null else coalesce(r.why, '') end; same := same || true; near := near || false;
      continue;
    end if;
    lg := '[]'::jsonb; bad := null;
    for i in 1..array_length(r.stops, 1) - 1 loop
      leg := _mp_rail_path(r.own_u, r.own_c, r.stops[i], r.stops[i + 1]);
      if leg is null then bad := format('%s → %s の線路がつながっていません', (select name from mp_stations where id = r.stops[i]), (select name from mp_stations where id = r.stops[i + 1])); exit; end if;
      lg := lg || jsonb_build_array(leg);
    end loop;
    ids := ids || r.id; lgs := lgs || lg; bads := bads || bad;
    same := same || coalesce((bad is null and r.ok and r.legs = lg) or (bad is not null and not r.ok and r.why is not distinct from bad), false);
    near := near || coalesce(bad is null and r.ok and r.legs <> lg and _mp_legs_near(r.legs, lg), false);   -- DB の更新94
  end loop;
  -- 2.（2026-10-28）どの系統も前とまったく同じなら、何もしない（時刻も前のまま）。前は線路を1本つくるたびに、ぜんぶの系統の時刻を組みなおしていて、8秒の制限をこえていた
  if coalesce(array_length(ids, 1), 0) = 0 or true = all(same) then return; end if;
  -- 2.5 道すじが ほとんど同じ系統（線のとちゅうから分かれ道をつくって、通る線が2つに分かれただけ）は、道すじだけ書きかえて、時刻は前のまま（DB の更新94）。
  --     前は ここでも時刻をぜんぶ組みなおしていて、列車の多い系統が通る線から分かれ道をつくると 1系統 3秒くらい かかっていた
  for k in 1..array_length(ids, 1) loop
    if not same[k] and near[k] then
      update mp_routes set legs = lgs[k] where id = ids[k];   -- 走る時間のメモ（runt）も前のまま（時刻と同じ道すじの見かた）
      same[k] := true;
    end if;
  end loop;
  if true = all(same) then return; end if;
  -- 3. 道すじが変わった系統だけ、書きかえて時刻を組みなおす（DB の更新88）。
  --    前は どれか1つ変わると、ぜんぶの系統（乗り入れもふくむ）を組みなおしていて、大きい路線網のまん中で線を分けると（分かれ道をつくると）20秒の制限をこえていた
  --    列車の多い路線網（400本より多い）は、道すじだけ いま書きかえて、時刻は あとで（DB の更新123。mp_resched_q・1分ごと）。
  --    前は 1分ちかく かかることがあり、ゲートウェイ・ブラウザが先に切れて「通信がとぎれました」になっていた
  zlater := (select count(*) from mp_trains t where t.route = any(ids)) > 400;
  if zlater then
    for k in 1..array_length(ids, 1) loop
      if not same[k] then
        update mp_routes set legs = case when bads[k] is null then lgs[k] else mp_routes.legs end, ok = bads[k] is null, why = bads[k], runt = '{}'::jsonb where id = ids[k];
        if bads[k] is null then
          insert into mp_resched_q as q (rid, pu, pc) values (ids[k], pu, pc) on conflict (rid) do update set pu = excluded.pu, pc = excluded.pc;
        end if;
      end if;
    end loop;
    perform set_config('mp.later', '1', true);   -- 画面に「あとで」と出す（mp_seg_build）
    return;
  end if;
  fp0 := _mp_routes_fp(ids);   -- 組みなおす前の、列車の時刻・待避・注意・走れるか
  for k in 1..array_length(ids, 1) loop
    if not same[k] then
      update mp_routes set legs = case when bads[k] is null then lgs[k] else mp_routes.legs end, ok = bads[k] is null, why = bads[k], runt = '{}'::jsonb where id = ids[k];
      if bads[k] is null then perform _mp_resched(ids[k]); end if;
    end if;
  end loop;
  -- 4. 組みなおした結果が前とまったく同じなら、ほかの系統はそのまま。変わったら、前と同じように ほかの系統も組みなおす（待避・番線のかさなりが変わるので）
  if _mp_routes_fp(ids) is distinct from fp0 then
    for k in 1..array_length(ids, 1) loop
      if same[k] and bads[k] is null then perform _mp_resched(ids[k]); end if;
    end loop;
  end if;
end $$;

-- あとで組みなおす系統の時刻（DB の更新123）：1分ごと（pg_cron）。持ち主ごとに、道すじの変わった系統を組みなおして、
--   結果が前と変われば 前と同じように ほかの系統も組みなおす（_mp_routes_fix の 3・4 と同じ）。1回に 25秒くらいまで（のこりは つぎの回）
create or replace function public._mp_resched_run() returns void
language plpgsql set search_path = public as $$
declare zg record; zids bigint[]; zchg bigint[]; zfp text; zk bigint; zt0 timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(7641) then return; end if;   -- 前の回が まだ動いている
  for zg in select q.pu, q.pc, min(q.at) at from mp_resched_q q group by q.pu, q.pc order by min(q.at) loop
    exit when clock_timestamp() - zt0 > interval '25 seconds';
    perform _mp_lock(zg.pu, zg.pc);   -- 線路・系統を かえている人と かさならないように
    zchg := array(select q.rid from mp_resched_q q where q.pu is not distinct from zg.pu and q.pc is not distinct from zg.pc);
    delete from mp_resched_q q where q.rid = any(zchg);
    zids := array(select x.id from mp_routes x where x.kind = 'rail' and ((x.own_u is not distinct from zg.pu and x.own_c is not distinct from zg.pc)
             or exists (select 1 from mp_thru t where t.hu is not distinct from zg.pu and t.hc is not distinct from zg.pc and t.gu is not distinct from x.own_u and t.gc is not distinct from x.own_c)));
    zfp := _mp_routes_fp(zids);
    foreach zk in array zchg loop
      if exists (select 1 from mp_routes r where r.id = zk and r.ok) then perform _mp_resched(zk); end if;
    end loop;
    if _mp_routes_fp(zids) is distinct from zfp then
      foreach zk in array zids loop
        if not (zk = any(zchg)) and exists (select 1 from mp_routes r where r.id = zk and r.ok) then perform _mp_resched(zk); end if;
      end loop;
    end if;
  end loop;
end $$;
revoke all on function public._mp_resched_run() from public, anon, authenticated;

-- 1分ごと：あとで組みなおす系統の時刻（pg_cron があるとき。DB の更新123）
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-resched', '* * * * *', 'select public._mp_resched_run()');
  end if;
end $$;

-- 線路をつくる：時刻を あとで組みなおすときは later（DB の更新123）
create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); pws smallint := least(2, greatest(0, coalesce((p_opts ->> 'ps')::int, 0)))::smallint; elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text; ho jsonb;
        sga smallint; sg2 smallint; ssl smallint; sct smallint; snw smallint;   -- 線路の規格（DB の更新99）
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  zfo := pa.gv and coalesce(p_opts -> 'force' = 'true'::jsonb, false);   -- 国の強行（DB の更新116）：きついカーブ・深い海の上・高さ（勾配・交差）のエラーでも つくる
  if p_kind not in ('road', 'rail') then raise exception '作るものがちがいます'; end if;
  if p_kind = 'rail' then cls := 'rail'; end if;   -- 国も線路を引ける（DB の更新101。国の工事は無料・土地の申請も使用料もなし・免許もいらない）
  if p_kind = 'road' then
    if pa.gv then if cls not in ('exp', 'nat', 'pref', 'city', 'lane') then cls := 'city'; end if;
    else cls := 'priv'; end if;
    dbl := false; elec := false; quad := false;
    ln_ := least(case when cls = 'priv' then 2 else 4 end, greatest(case when cls in ('exp', 'nat') then 2 else 0 end,
             coalesce(ln_, case cls when 'exp' then 2 when 'nat' then 2 when 'pref' then 1 when 'city' then 1 when 'lane' then 0 else 1 end)));
    if cls = 'lane' then ln_ := 0; end if;
  else ln_ := 0; end if;
  perform _mp_geom_ok(p_pts);
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  if exists (select 1 from mp_segs s where s.kind = p_kind and s.bb && _mp_bb(p_pts) and s.pts = p_pts) then raise exception '同じところに、同じ線がもうあります'; end if;
  tiles := _mp_tiles(p_pts); ln := _mp_len(p_pts); rmin := _mp_minr(p_pts);
  if p_kind = 'rail' and not pa.gv then   -- 鉄道の免許（t108）：免許のない市区町村には引けない
    bad := _mp_lic_need(pa.pu, pa.pc, tiles);
    if bad is not null then raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', bad; end if;
  end if;
  if array_length(tiles, 1) / 2 > _mp_rate('max_tiles') then raise exception '一度に引けるのは %マスまでです。分けて引いてください', _mp_rate('max_tiles'); end if;
  if (p_kind = 'rail' and rmin < 3) or (p_kind = 'road' and rmin < 0.7) then
    if not zfo then
      if p_kind = 'rail' then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
      raise exception 'カーブがきつすぎます';
    end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('r', round((rmin * 50)::numeric)));
  end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then
    if not zfo then raise exception '深い海には作れません'; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('D'));
  end if;
  if quad then dbl := true; end if;   -- 複々線（DB の更新86）は複線のうち
  -- 線路の規格（DB の更新99）：p_opts の gauge・g2（三線軌条）・slp（枕木）・cat（架線）・nw（防音壁）。ないときは 1067mm・PC・シンプル・なし。第三軌条は 直流750V
  sga := case when (p_opts ->> 'gauge')::int in (762, 1067, 1372, 1435) then (p_opts ->> 'gauge')::int else 1067 end;
  sg2 := case when (p_opts ->> 'g2')::int in (762, 1067, 1372, 1435) and (p_opts ->> 'g2')::int <> sga then (p_opts ->> 'g2')::int end;
  ssl := least(3, greatest(0, coalesce((p_opts ->> 'slp')::int, 0)));
  sct := case when elec then least(6, greatest(0, coalesce((p_opts ->> 'cat')::int, 0))) else 0 end;
  snw := least(2, greatest(0, coalesce((p_opts ->> 'nw')::int, 0)));
  if p_kind <> 'rail' then sga := 1067; sg2 := null; ssl := 0; sct := 0; snw := 0; end if;
  if sct = 6 then pws := 3; end if;
  sw := case when p_kind = 'rail' then case when quad then 0.8 when dbl then 0.5 else 0.36 end else _mp_road_w(cls, ln_) end;
  cells := _mp_seg_cells_arr(p_pts, p_kind, sw, dbl);
  -- 高さ（t108）：縦断を決める。交差する線（線路どうしは 10m 上か下。道路とは、どちらも地面なら踏切・交差点）・建物（屋根＋5m より上か、地面−15m より下）・
  --   駅のホーム・車庫・バス停（±10m）・滑走路（下だけ）は、上か下を通る（つなぐはしの 20m はのぞく）。はしの高さは、つなぐ先と同じ
  if md not in ('auto', 'el', 'ug', 'tn', 'fl', 'tz') then md := 'auto'; end if;   -- tn：トンネル優先（DB の更新81）・fl：平坦（地上）・tz：高さを決める（DB の更新84）
  if p_kind <> 'rail' then rk := false; end if;
  ho := _mp_hopt(md, p_opts, p_kind, rk);   -- 高さ・勾配の上限（DB の更新84）
  if md = 'tz' and not coalesce(ho ? 'zt', false) then md := 'auto'; end if;
  if jsonb_typeof(p_opts -> 'prof') = 'array' then upf := array(select v::real from jsonb_array_elements_text(p_opts -> 'prof') v); end if;
  nhm := case when upf is not null then 'man' else md end;
  z0 := _mp_att_z(p_from, p_pts[1], p_pts[2]); z1 := _mp_att_z(p_to, p_pts[2 * np - 1], p_pts[2 * np]);
  ea := case when p_from is null then 0 else least(0.4, ln / 3) end; eb := case when p_to is null then ln else ln - least(0.4, ln / 3) end;
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], case when zfo then coalesce(ho, '{}'::jsonb) || jsonb_build_object('force', true) else ho end);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  zfc := zfc || coalesce(pr -> 'fc', '[]'::jsonb);
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：マスごとに、つくり（地面・高架・トンネル・橋）と地形の倍率 ×（1 ＋ まちの係数）。アプト式は 1.3倍
  base := case when p_kind = 'rail' then _mp_rate('rail') * _mp_gauge_mul(sga) * case when sg2 is not null then 1.4 else 1 end * _mp_slp_bmul(ssl) else _mp_rate('road') * _mp_road_mul(cls, ln_) end;   -- 軌間・三線軌条・枕木（DB の更新99）
  if not pa.gv then   -- 国の工事は無料（t57b）：工事費の計算もしない
    cost := _mp_st_cost(tiles, ters, _mp_st_tiles(p_pts, pr ->> 'st'), rk, null, false, base, _mp_trmul(dbl, quad), case when elec then _mp_rate('elec') * _mp_cat_cmul(sct, _mp_st_tiles(p_pts, pr ->> 'st')) else 0 end)
            + _mp_nw_cost(snw) * (select count(*) from unnest(_mp_st_tiles(p_pts, pr ->> 'st')) c where c <> 'T');   -- 架線の種類・防音壁（DB の更新99）
  end if;
  cost := round(cost);
  vl := case when p_kind = 'rail' then case when rk then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else _mp_road_v(cls, ln_) end;
  select * into lq from _mp_lease_quote(cells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(cells, pa.pu, pa.pc, pa.gv);
  if p_dry then
    return jsonb_build_object('cost', cost, 'lease', round(lq.fee), 'own', lq.own, 'other', lq.other, 'state', lq.state, 'pub', lq.pub,
      'tiles', array_length(tiles, 1) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50),
      'vlim', vl, 'lanes', ln_, 've', case when p_kind = 'rail' and elec then _mp_cat_v(sct) end,
      'vtop', case when p_kind = 'rail' then least(_mp_seg_v(sga, sg2, ssl, rk), (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)) else _mp_road_v(cls, ln_) end,
      'need', need, 'hm', nhm, 'ho', ho, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns' - 'fc')
      || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt, quad, ps, gauge, g2, slp, cat, nw)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho, quad, case when elec then pws else 0 end, sga, sg2, ssl, sct, snw)
  returning id into sid;
  update mp_nodes set z = pf[2] where id = n0 and z is null;   -- はしの点の高さ（つないだ先は同じ高さ）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = n1 and z is null;
  perform _mp_occ_set(sid, p_kind, tiles);
  perform _mp_lease_set('seg', sid, pa.pu, pa.pc, pa.gv);
  -- 系統の道すじは、行きどまりの線（はしの1つしか ほかの線とつながらない・線のとちゅうにつないでいない）では変わらないので、見なおさない（DB の更新81）
  if p_kind = 'rail' then
    perform _mp_renet(pa.pu, pa.pc);
    if coalesce(p_from ? 'seg', false) or coalesce(p_to ? 'seg', false)
       or (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) >= 2 then
      -- 線のとちゅうから分かれた 行きどまりの線（はしの1つだけが、線のとちゅうにつながる）：道すじが変わるのは、分けた線を通る系統だけ（DB の更新94）
      perform _mp_routes_fix(pa.pu, pa.pc,
        case when coalesce(p_from ? 'seg', false) <> coalesce(p_to ? 'seg', false)
              and (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) = 1
             then array[coalesce((p_from ->> 'seg')::bigint, (p_to ->> 'seg')::bigint)] end);
    end if;
  end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee))
         || case when current_setting('mp.later', true) = '1' then jsonb_build_object('later', true) else '{}'::jsonb end;   -- 系統の時刻は あとで（DB の更新123）
end $$;

-- 線路をつくる・直す・つなぐ・こわす・設定を変える は 50秒まで（DB の更新123。前は60秒。ゲートウェイ・ブラウザの 60秒より前に、わかる エラーを返す）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mp_seg_build', 'mp_seg_edit', 'mp_seg_join', 'mp_seg_del', 'mp_seg_opts') loop
    execute format('alter function %s set statement_timeout = %L', f.sig, '50s');
  end loop;
end $$;
