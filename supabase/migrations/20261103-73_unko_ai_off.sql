-- AI の運行の乱れを、名義（人・会社）ごとにオフにできる：
--   mp_unko_off（オフにした名義）・mp_unko_opt（オン／オフ）。運行情報（mp_unko_list）に、いまの名義がオフか（aioff）
--   オフの名義の系統と駅では、天気・事故・故障などの乱れが自動で起きない（_mp_unko_tick。管理者が起こすものは起きる）
--   オンの名義は、運賃の入金が1.05倍（_mp_tick_hour。画面・ヘルプには出さない）

create table if not exists public.mp_unko_off (   -- AI の運行の乱れ（天気・事故・故障など自動で起きるもの）をオフにした名義（DB の更新73）
  k     text primary key,               -- 名義（_mp_okey）
  own_u uuid, own_c int,
  at    timestamptz not null default now()
);
alter table public.mp_unko_off enable row level security;
revoke all on public.mp_unko_off from public, anon, authenticated;

-- AI の運行の乱れをオフにしているか（名義）
create or replace function public._mp_unko_off(pu uuid, pc int) returns boolean
language sql stable set search_path = public as $$
  select (pu is not null or pc is not null) and exists (select 1 from mp_unko_off o where o.k = _mp_okey(pu, pc))
$$;
-- AI の運行の乱れを、この名義（自分・会社）でオン／オフ。オフにすると、この名義の線と駅では自動の乱れが起きない（いま起きているものは、終わるまでそのまま）
create or replace function public.mp_unko_opt(p_as text, p_off boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国の線は変えられません'; end if;
  if coalesce(p_off, false) then
    insert into mp_unko_off(k, own_u, own_c) values (_mp_okey(pa.pu, pa.pc), pa.pu, pa.pc) on conflict (k) do update set at = now();
  else
    delete from mp_unko_off where k = _mp_okey(pa.pu, pa.pc);
  end if;
  return jsonb_build_object('aioff', _mp_unko_off(pa.pu, pa.pc));
end $$;

-- 運行の乱れ（5分ごと）：AI の乱れをオフにした名義はのぞく（DB の更新73）
create or replace function public._mp_unko_tick() returns void
language plpgsql set search_path = public as $$
declare uz mp_unko; r record; s record; ms bigint := floor(extract(epoch from now()) * 1000)::bigint; bk int := ((extract(epoch from now())::bigint / 300) % 3)::int;
        hh int := extract(hour from now() at time zone 'Asia/Tokyo')::int; hw real; stp float8; last text;
        tp jsonb; tw float8; tpk jsonb; ou uuid; oc int; dd int; T jsonb; pr float8;
        TPL constant jsonb := '{
          "rail": [["person", "人と接触", 3, 40, 75, 3], ["sick", "急病のお客さまの救護", 1, 5, 10, 4],
                   ["car", "車両の点検（ドアの不具合）", 2, 10, 20, 3], ["car", "車両の点検（ブレーキから異音）", 3, 25, 45, 1.5],
                   ["signal", "信号の確認（信号が赤のまま）", 2, 15, 25, 2], ["signal", "信号の確認（停電で信号が消えた）", 3, 30, 60, 1],
                   ["track", "線路内の点検（線路に人が立ち入った）", 2, 10, 20, 2], ["track", "線路内の点検（倒木・落下物）", 3, 30, 50, 1],
                   ["track", "線路内の点検（動物と接触）", 2, 15, 30, 1.5], ["track", "線路内の点検（小石。異常なし）", 1, 3, 6, 2]],
          "air":  [["car", "機材の点検（エンジンの警告）", 2, 30, 90, 2], ["car", "機材の故障（交換の機体を手配）", 3, 60, 180, 1],
                   ["bird", "バードストライク（機体の点検）", 2, 30, 60, 1.5], ["rwy", "滑走路の点検", 2, 15, 40, 1.5],
                   ["atc", "管制の混雑（出発の順番待ち）", 1, 15, 45, 2], ["sick", "急病のお客さまの救護", 1, 10, 30, 1]],
          "ship": [["car", "エンジンの点検", 2, 20, 60, 2], ["car", "エンジンの故障", 3, 60, 180, 1],
                   ["wave", "うねりで揺れが大きい", 2, 30, 90, 1.5], ["sick", "急病のお客さまの救護", 1, 10, 20, 1.5]],
          "bus":  [["accident", "交通事故（車どうしの接触）", 2, 15, 40, 2], ["accident", "交通事故で通行止め", 3, 30, 90, 1],
                   ["car", "車両の点検", 2, 10, 30, 2], ["sick", "急病のお客さまの救護", 1, 5, 15, 2]]}'::jsonb;
begin
  if not exists (select 1 from mp_wx_k) then return; end if;
  -- 1) 10分えらばなかった：現場の判断（安全なほう）
  for uz in select * from mp_unko where st = 'ask' and ask_until <= now() order by id loop
    perform _mp_unko_apply(uz.id, case uz.lv when 1 then 2 when 2 then 3 else 5 end, true);
  end loop;
  -- 2) おわり（窓がおわった）。合わせて1時間より長く止めて、振替輸送をたのまなかった線は、信頼が下がる
  for uz in select * from mp_unko where st = 'run' and t_end <= now() and now() >= t0 + make_interval(secs => dur) order by id loop
    stp := (select coalesce(sum((e ->> 1)::float8 - (e ->> 0)::float8), 0) from jsonb_array_elements(uz.wins) e where (e ->> 2)::float8 = 0);
    if stp >= 3600 then update mp_routes set trust = greatest(0.7, trust - 0.05) where id = any(uz.routes) and not (id = any(uz.furi)); end if;
    last := case when (select (e ->> 2)::float8 from jsonb_array_elements(uz.wins) e order by (e ->> 1)::float8 desc limit 1) = 0
                   then case uz.mode when 'rail' then '運転を再開しました（遅れが出ています）' else '運航・運行を再開しました（遅れが出ています）' end
                 when jsonb_array_length(uz.wins) > 0 then 'ふだんの速さにもどりました（遅れが出ています）' else 'ふだんどおり運行しています' end;
    update mp_unko set st = 'done', log = log || jsonb_build_array(jsonb_build_array(extract(epoch from greatest(uz.t_end, uz.t0 + make_interval(secs => uz.dur))), last)) where id = uz.id;
  end loop;
  -- 3) 天気：系統ごと（15分に1回）。鉄道・バス・船・飛行機（風・雨・雪・濃霧・高温・ひょう。DB の更新66）
  for r in select ro.id from mp_routes ro
            where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and ro.id % 3 = bk and coalesce(array_length(ro.stops, 1), 0) >= 2
              and not _mp_unko_off(ro.own_u, ro.own_c)   -- AI の乱れをオフにした名義の系統はのぞく（DB の更新73）
              and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
              and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[ro.id] and z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail')) loop
    perform _mp_unko_wxr(r.id, ms);
  end loop;
  -- 4) 人と接触・急病・機材・事故など：駅・空港・港・バス停ごと（人の多さ・朝夕は多く、夜は少ない）
  hw := case when hh < 5 then 0.15 when hh = 5 then 0.6 when hh between 6 and 9 or hh between 16 and 19 then 1.6 else 1 end;
  for s in select st.id, st.x, st.y, st.own_u, st.own_c, w.rs, w.pop, w.k
             from (select u.sid, ro.kind k, array_agg(distinct ro.id order by ro.id) rs, max((ro.catch ->> u.sid::text)::real) pop
                     from mp_routes ro, unnest(ro.stops) u(sid)
                    where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
                      and not _mp_unko_off(ro.own_u, ro.own_c)   -- AI の乱れをオフにした名義の系統はのぞく（DB の更新73）
                    group by u.sid, ro.kind) w join mp_stations st on st.id = w.sid loop
    pr := case s.k when 'rail' then 0.0002 when 'air' then 0.0003 when 'ship' then 0.0002 else 0.00003 end;   -- バス停は数が多いので少なく
    if random() >= pr / 12 * hw * greatest(0.3, least(3, coalesce(s.pop, 5000) / 20000.0)) then continue; end if;
    if exists (select 1 from mp_unko z where z.st <> 'done' and z.kind not in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') and (z.sta = s.id or z.routes && s.rs)) then continue; end if;
    T := TPL -> s.k;
    tw := random() * (select sum((e ->> 5)::float8) from jsonb_array_elements(T) e); tpk := null;
    for tp in select e from jsonb_array_elements(T) e loop
      tw := tw - (tp ->> 5)::float8; if tw <= 0 then tpk := tp; exit; end if;
    end loop;
    tpk := coalesce(tpk, T -> 0);
    dd := ((tpk ->> 3)::int + floor(random() * ((tpk ->> 4)::int - (tpk ->> 3)::int + 1))::int) * 60;
    -- えらぶ人：駅の持ち主（なければ、はじめの系統の持ち主）
    if s.own_u is not null or s.own_c is not null then ou := s.own_u; oc := s.own_c;
    else select ro.own_u, ro.own_c into ou, oc from mp_routes ro where ro.id = s.rs[1]; end if;
    if _mp_unko_off(ou, oc) then continue; end if;   -- 対応をえらぶ名義が AI の乱れをオフにしている駅（DB の更新73）
    perform _mp_unko_new(tpk ->> 0, tpk ->> 1, s.id, s.x, s.y, s.rs, (tpk ->> 2)::int, null, null, dd, ou, oc);
  end loop;
  -- 5) 1日1回（朝4時台）：信頼が1％もどる。30日より前の記録はけす
  if hh = 4 and not exists (select 1 from mp_state where k = 'unko_day' and v >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') then
    update mp_routes set trust = least(1, trust + 0.01) where trust < 1;
    delete from mp_unko where st = 'done' and t_end < now() - interval '30 days';
    insert into mp_state values ('unko_day', now()) on conflict (k) do update set v = excluded.v;
  end if;
end $$;

-- 運行情報（いまの名義が AI の乱れをオフにしているか。DB の更新73）
create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 2, 'aioff', case when gv then null else _mp_unko_off(pu, pc) end, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null or gv) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi),
                         'zi', q.zi, 'zt', _mp_unko_zt(r.id, q.zi)) order by r.id), '[]'::jsonb)   -- 乱れがきく区間（駅の何番目〜何番目。null は全線。DB の更新60）
                 from mp_routes r cross join lateral (select _mp_unko_zi(z, r.id) zi) q where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st, 'wide', z.wide,
    'log', (select coalesce(jsonb_agg(l order by (l ->> 0)::float8), '[]'::jsonb) from jsonb_array_elements(z.log) l where (l ->> 0)::float8 <= extract(epoch from now()) + 1),
    'by', _mp_pname(z.own_u, z.own_c, false),
    'me', (pu is not null or pc is not null) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'),
    -- 持ち主が決めた運休（1本：きのうから・編成ごと：おわって6時間まで）：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の]（DB の更新60）
    'cx', (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.train, c.day, c.form, extract(epoch from c.t0), extract(epoch from e.t1), c.unko,
                    (pu is not null or pc is not null or gv) and c.own_u is not distinct from pu and c.own_c is not distinct from pc) order by c.id), '[]'::jsonb)
             from mp_cxl c left join mp_unko z2 on z2.id = c.unko
             cross join lateral (select coalesce(c.t1, case when z2.st = 'done' then greatest(z2.t_end, z2.t0 + make_interval(secs => z2.dur)) end) t1) e
            where (c.day is not null and c.day >= today - 1) or (c.form is not null and coalesce(e.t1, 'infinity'::timestamptz) > now() - interval '6 hours')));
end $$;

-- 1時間ごとの運賃（DB の更新73）
create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0;
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null then continue; end if;
      dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      -- 編成の工事中（検査・改造・転属・納車）にかかる列車は運休：始発駅を出てから終点に着くまでのどこかが、工事の時間にかかるもの（DB の更新60）
      if _mp_form_busy(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) then nwk := nwk + 1; continue; end if;
      -- 持ち主が運休にした列車（1本ずつ・編成ごと。DB の更新60）
      begin if _mp_cxl_on(tr.id, d0, tr.fid, dep_abs) then ncan := ncan + 1; continue; end if; exception when others then null; end;
      -- 走る区間（途中始発・途中止まり。2026-10-28）：系統のうちの何割を走るか（cf）。本数・定員はその割合で数える
      cf := 1; ia := 1; ib := coalesce(array_length(r.stops, 1), 1);
      if tr.sa is not null or tr.sb is not null then
        ia := _mp_rpos(r.stops, tr.dir, (tr.sched -> 0 ->> 0)::bigint, false); ib := _mp_rpos(r.stops, tr.dir, (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 0)::bigint, true);   -- 環状線
        if ia is not null and ib is not null and km > 0 then
          cf := greatest(0.05, least(1, coalesce((select sum((l.v ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality l(v, lo) where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib)), 0) / 1000 / km));
        else ia := 1; ib := coalesce(array_length(r.stops, 1), 1); end if;
      end if;
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
            where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib) and not (l.v ->> 'e')::boolean) then continue; end if;
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        broke := broke + 1;
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        continue;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = tr.fid;
      -- 連結している編成（つなぐ駅から切りはなす駅まで）：その分いたみ、定員は走る時間のわりあいで足す
      ccap := 0;
      for ce in select c.v from jsonb_array_elements(tr.cplx) c(v)
                 where coalesce((c.v ->> 'ok')::boolean, false) and exists (select 1 from mp_ops ox where ox.id = (c.v ->> 'op')::bigint and ox.form = (c.v ->> 'f')::bigint) loop
        cperf := _mp_form_perf((ce ->> 'f')::bigint);
        if cperf is null or _mp_form_busy((ce ->> 'f')::bigint, to_timestamp(dep_abs + coalesce((ce ->> 'ta')::int - tr.dep, 0)), to_timestamp(dep_abs + coalesce((ce ->> 'tb')::int - tr.dep, rt))) then continue; end if;   -- 工事中の編成はつながない（DB の更新60）
        crt := greatest(60, coalesce((ce ->> 'tb')::int - (ce ->> 'ta')::int, rt));
        update mp_cars c set cond = greatest(0, cond - 0.035 * crt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
         where form = (ce ->> 'f')::bigint;
        ccap := ccap + (cperf ->> 'cap')::int * least(1, crt / greatest(rt, 1));
      end loop;
      if ev is not null then dsum := dsum + coalesce((ev ->> 'dly')::float8, 0); nd := nd + 1; end if;   -- 終点での遅れ（秒）
      nrun := nrun + 1;   -- 走った列車（回送・試運転もふくむ。乗り入れの線路使用料。DB の更新60）
      if tr.kind in ('回送', '試運転') then continue; end if;   -- お客は乗せない
      nok := nok + 1; secs := secs + rt / cf;
      if tr.dir = 1 then tph1 := tph1 + cf; cap1 := cap1 + round(((perf ->> 'cap')::int + ccap) * cf)::int; else tph2 := tph2 + cf; cap2 := cap2 + round(((perf ->> 'cap')::int + ccap) * cf)::int; end if;
      acn := acn + case when (perf ->> 'ac')::boolean then 1 else 0 end; htn := htn + case when (perf ->> 'heat')::boolean then 1 else 0 end;
      toil := toil + case when (perf ->> 'toilet')::boolean then 1 else 0 end;
      -- 料金の席と設備（DB の更新72）：グリーン席、夜行の寝台と個室、食堂車・ラウンジ・展望車、荷物車・郵便車（走る km）
      xg := xg + coalesce((perf ->> 'g')::real, 0) * cf;
      if xnight then xa := xa + coalesce((perf ->> 'a')::real, 0) * cf; xb := xb + coalesce((perf ->> 'b')::real, 0) * cf; xrm := xrm + coalesce((perf ->> 'rooms')::real, 0) * cf; end if;
      xdin := xdin + case when (perf ->> 'din')::boolean then 1 else 0 end;
      xlng := xlng + case when (perf ->> 'lng')::boolean or (perf ->> 'obs')::boolean then 1 else 0 end;
      xbag := xbag + coalesce((perf ->> 'bag')::real, 0) * km * cf;
    end loop;
    ran := ran || jsonb_build_object(r.id::text, nrun);
    -- 運休した列車のお客（きのうの同じ時間のお客 × 運休の割合）：振替輸送をたのんでいれば、近くのほかの線へ（精算）
    lost := 0;
    if ncan > 0 then
      lost := coalesce((select x.served from mp_hours x where x.route = r.id and x.hour = date_trunc('hour', h) - interval '1 day'), 0)::real * ncan / (ncan + nok);
      if lost >= 1 and exists (select 1 from mp_unko z where z.furi @> array[r.id] and z.t0 < h and coalesce(z.t_end, now()) > h - interval '1 hour') then
        begin
          perform _mp_unko_furi_pay(r, lost, case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * greatest(1.5, least(15, km * 0.45)) else 0 end);
        exception when others then raise warning 'mp unko furi: %', sqlerrm; end;
      end if;
    end if;
    if nok = 0 then
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'shop', nwk, 'trust', round(r.trust::numeric, 2)) where id = r.id;
      continue;
    end if;
    -- 乗りたい人（この1時間）
    pop := coalesce((select sum(v::text::real) from jsonb_each(catch) e(k, v)), 0);
    -- ほかの系統とのとりあい：駅のまわりに止まる、ほかの系統の本数
    share := coalesce((select avg(1.0 / (1 + coalesce((select count(*) from mp_routes r2 join mp_stations s2 on s2.id = any(r2.stops)
                         where r2.id <> r.id and r2.ok and r2.kind = r.kind and abs(s2.x - s.x) < 1200 and abs(s2.y - s.y) < 1200), 0) * 0.5))
                       from mp_stations s where s.id = any(r.stops)), 1);
    spd := case when secs > 0 then km / greatest(secs / nok / 3600.0, 0.01) else 30 end;
    q := least(1.5, greatest(0.5, spd / 30.0));
    if r.kind = 'ship' then q := case when spd > 40 then 1.3 else 1 end; end if;   -- 船：島へは船しかないので遅くても減らない（高速船は少しふえる。t54o）
    if r.kind = 'air' then q := least(1.0, greatest(0.2, km / 60)); end if;   -- 飛行機：近いところへは鉄道・バスで行く人が多い（60km より短いと減る。t54p）
    comf := 1;
    if mo in (6, 7, 8, 9) then comf := comf * (0.8 + 0.2 * acn / nok); end if;
    if mo in (12, 1, 2) then comf := comf * (0.8 + 0.2 * htn / nok); end if;
    if km > 30 then comf := comf * (0.9 + 0.1 * toil / nok); end if;
    if km > 50 then comf := comf * (1 + 0.05 * xdin / nok + 0.05 * xlng / nok); end if;   -- 食堂車・ラウンジ・展望車のある列車は、長い系統で少し人気（DB の更新72）
    dem := pop * _mp_rate(case r.kind when 'rail' then 'g_rail' when 'ship' then 'g_ship' when 'air' then 'g_air' else 'g_bus' end) * _mp_hourf(hh) * q * comf * share;
    -- 運行の乱れ：遅れが大きいほど お客がへる（平均 10分で 1割・いちばん 3割）。信頼（0.7〜1）もかける
    dem := dem * coalesce(r.trust, 1) * (1 - least(0.3, dsum / greatest(nd, 1) / 60 / 100));
    if r.kind = 'air' then   -- 飛行機：本数が少なくても予約して乗る・座席の数まで（立って乗れない。t54p）
      dem1 := dem / 2 * tph1::real / (tph1 + 0.5); dem2 := dem / 2 * tph2::real / (tph2 + 0.5);
      served := floor(least(dem1, cap1) + least(dem2, cap2));
    else
      dem1 := dem / 2 * tph1::real / (tph1 + 3); dem2 := dem / 2 * tph2::real / (tph2 + 3);
      served := floor(least(dem1, cap1 * 1.5 * 2) + least(dem2, cap2 * 1.5 * 2));
    end if;
    trip := case when r.kind = 'ship' then greatest(1.5, km * 0.85) when r.kind = 'air' then km else greatest(1.5, least(15, km * 0.45)) end;   -- 船はほとんどの人が向こう岸まで（t54o）・飛行機は終点まで
    fare := case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * trip
                 when r.kind = 'ship' then _mp_rate('ship_fare') + _mp_rate('ship_km') * trip
                 when r.kind = 'air' then _mp_rate('air_fare') + _mp_rate('air_km') * trip
                 else _mp_rate('bus_fare') + _mp_rate('bus_km') * greatest(0, trip - 3) end;
    -- 料金（DB の更新72）：グリーン席は乗る人の8%まで（席は1時間に2回転）。寝台は長い系統の夜行だけ（80km をこえるとふえ、680km で4割）。
    --   寝台に乗りたい人の3割は A寝台、のこりは B寝台。個室はそのうち（A の半分・B の2割。1室ごと）。料金は運賃の グリーン1倍・B寝台3倍・A寝台6倍・個室3倍（mp_rates で変えられる）
    --   食堂車：乗る人の5%が食事（1人 600 X）。荷物車・郵便車：1両 1km ごとに 120 X
    xfee := 0; xmeal := 0; xbagr := 0;
    if r.kind = 'rail' then
      xug := least(served * 0.08, xg * 2);
      xus := served * least(0.4, greatest(0, (km - 80) / 600.0));
      xua := least(xus * 0.3, xa); xub := least(xus - xua, xb); xur := least(xrm, xua * 0.5 + xub * 0.2);
      xfee := fare * (xug * coalesce(_mp_rate('fee_g'), 1) + xub * coalesce(_mp_rate('fee_b'), 3) + xua * coalesce(_mp_rate('fee_a'), 6) + xur * coalesce(_mp_rate('fee_room'), 3));
      if xdin > 0 and km > 30 then xmeal := served * 0.05 * xdin / nok * coalesce(_mp_rate('meal'), 600); end if;
      xbagr := xbag * coalesce(_mp_rate('bag_km'), 120);
    end if;
    rev := floor(served * fare + xfee + xmeal + xbagr);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'shop', nwk, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0)));   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
    ) z where pu is not null or pc is not null group by pu, pc   -- 国のもの（国の空港。t54q）は国庫から国庫なので、なし
  loop
    amt := round(o.amt / 24.0);
    if amt > 0 then perform _mp_soft_pay(o.pu, o.pc, false, amt, 'upkeep', format('維持費（%s）', o.ks)); end if;
  end loop;
  -- 使用料：払う人 → 区画の筆の持ち主（筆がなければ国庫）。自分の筆になっていればなし。同じ人の同じ区画は1回（線路と駅のホームが重なるところなど）
  for o in select e.pay_u, e.pay_c, sum(e.fee) fee, p.own_u lu, p.own_c lc
             from (select distinct on (l.x, l.y, l.pay_u, l.pay_c) l.x, l.y, l.pay_u, l.pay_c, l.fee from mp_leases l where not l.pay_gov order by l.x, l.y, l.pay_u, l.pay_c, l.fee desc) e
             left join mp_pcells pc on pc.x = e.x and pc.y = e.y left join mp_parcels p on p.id = pc.parcel
            where p.id is null or not _mp_same(p.own_u, p.own_c, false, e.pay_u, e.pay_c, false)
            group by e.pay_u, e.pay_c, p.own_u, p.own_c loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', '土地の使用料');
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', '土地の使用料（受けとり）');
    end if;
  end loop;
  -- 他社のバス停の使用料（1系統・1日）：系統の持ち主 → バス停の持ち主
  for o in select ro.own_u pay_u, ro.own_c pay_c, sx.own_u lu, sx.own_c lc, sx.kind sk, sum(x.fee) fee
             from mp_stopuse x join mp_routes ro on ro.id = x.route join mp_stations sx on sx.id = x.stop
            where x.fee > 0 and not _mp_same(sx.own_u, sx.own_c, false, ro.own_u, ro.own_c, false)
            group by ro.own_u, ro.own_c, sx.own_u, sx.own_c, sx.kind loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', case when o.sk = 'ship' then '港の使用料' when o.sk = 'air' then '空港の使用料' else 'バス停の使用料' end);
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', case when o.sk = 'ship' then '港の使用料（受けとり）' when o.sk = 'air' then '空港の使用料（受けとり）' else 'バス停の使用料（受けとり）' end);
    end if;
  end loop;
  -- 乗り入れの線路使用料（t54j）：この1時間に始発を出た列車（回送・試運転もふくむ）× 持ち主の線路の km × 1列車・1km の使用料。系統の持ち主 → 線路の持ち主
  for o in
    select ro.own_u gu, ro.own_c gc, hk.hu, hk.hc, sum(cnt.n * hk.km * th.fee) amt, sum(cnt.n) n, sum(cnt.n * hk.km) km
      from mp_routes ro
      join lateral (select coalesce((ran ->> ro.id::text)::int, 0) n) cnt on cnt.n > 0   -- ほんとうに走った列車だけ（運休・工事中・故障はのぞく。DB の更新60）
      join lateral (select s.own_u hu, s.own_c hc, sum(abs((g ->> 2)::real - (g ->> 1)::real) * 50 / 1000.0) km
                      from jsonb_array_elements(ro.legs) l, jsonb_array_elements(l -> 'g') g join mp_segs s on s.id = (g ->> 0)::bigint
                     where not (s.own_u is not distinct from ro.own_u and s.own_c is not distinct from ro.own_c) and not s.gov
                     group by s.own_u, s.own_c) hk on true
      join mp_thru th on th.st = 'ok' and th.fee > 0 and th.hu is not distinct from hk.hu and th.hc is not distinct from hk.hc
                     and th.gu is not distinct from ro.own_u and th.gc is not distinct from ro.own_c
     where ro.ok and ro.kind = 'rail'
     group by ro.own_u, ro.own_c, hk.hu, hk.hc
  loop
    amt := round(o.amt);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.gu, o.gc, false, amt, 'lease', format('線路使用料（乗り入れ・%s本・%skm）', o.n, round(o.km::numeric, 1)));
    if amt > 0 then perform _mp_earn(o.hu, o.hc, false, amt, 'lease_in', format('線路使用料（乗り入れの受けとり・%s本）', o.n)); end if;
  end loop;
  -- 建物：町の人の出入り・家賃・テナントの家賃・店などの売上
  perform _mp_bld_tick_hour(h);
  -- 学校・工場・物流（t54k）。うまくいかなくても、ほかの1時間の分はそのまま
  begin perform _mp_sc_tick_hour(h); exception when others then raise warning 'mp sc: %', sqlerrm; end;
end $$;

-- 関数の権限：オン／オフ・運行情報はログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_unko_off', 'mp_unko_opt', '_mp_unko_tick', 'mp_unko_list', '_mp_tick_hour') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
