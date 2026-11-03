-- 雪の対策（t108）：北と高い山は雪国（雪国・豪雪・特別豪雪）。車両の雪の対策（耐雪改造・バスは冬用タイヤ）・駅の融雪器・線路の雪よけ（防雪柵・スノーシェッド）・車庫の除雪車と、その補助金（雪国 1/3・豪雪 1/2・特別豪雪 2/3）
--   冬（11〜4月）、積雪 20cm（バスは 10cm）より多い駅をとおる系統は、対策が足りないと「冬の運休」。除雪車が足りないと、大雪で立ち往生。対策があると、雪の乱れも起きにくい
--   豪雪地帯の系統が雪で運休・遅れたら、減った運賃の3割を補助。維持費（融雪器・除雪車は冬だけ・雪よけは1年じゅう）も雪国なら半分を国が。国土 → ≡ →「❄ 雪の対策」

alter table public.mp_cars add column if not exists snow boolean not null default false;      -- 雪の対策：耐雪改造（鉄道）・冬用タイヤとチェーン（バス・トラック）
alter table public.mp_stations add column if not exists melt boolean not null default false;  -- 融雪器（鉄道の駅のポイント）
alter table public.mp_segs add column if not exists snowp smallint not null default 0;        -- 線路の雪よけ：0 なし・1 防雪柵・2 スノーシェッド
alter table public.mp_depots add column if not exists plows int not null default 0;           -- 除雪車（鉄道の車庫：ラッセル車・バスの車庫：除雪トラック）
create table if not exists public.mp_snow (                -- 駅・バス停の積雪（3時間ごと。走っている系統の駅だけ）
  sta  bigint primary key references public.mp_stations(id) on delete cascade,
  zone smallint not null default 0,                       -- 雪の地域：0 なし・1 雪国・2 豪雪・3 特別豪雪
  dep  real not null default 0,                           -- 積雪（cm）
  at   timestamptz not null default now()
);
alter table public.mp_snow enable row level security;
revoke all on public.mp_snow from public, anon, authenticated;

-- 積もっている雪（cm）：map/wx.js の snowAt と同じ。150日前から6時間ごとに、降った雪をたして、暖かいととかす
create or replace function public._wx_snow(x float8, y float8, e float8, ms bigint) returns float8
language plpgsql stable set search_path = public as $$
declare st bigint := 6 * 3600000; t1 bigint := floor(ms::float8 / st)::bigint * st; tt bigint; o record; dep float8 := 0;
begin
  tt := t1 - 150 * 4 * st;
  while tt <= t1 loop
    o := _wx_core(x, y, e, tt + 3 * 3600000);
    if o.kind = 'snow' then dep := dep + (0.25 + 1.5 * o.inten) * 6;
    elsif o.kind = 'sleet' then dep := dep + (0.2 + 0.8 * o.inten) * 6 * 0.4; end if;
    if o.t > 0 then dep := dep - (0.12 * 6 * o.t + case when o.kind = 'rain' then 1.5 else 0 end); end if;
    dep := case when dep > 0 then dep * 0.988 else 0 end;
    tt := tt + st;
  end loop;
  return dep;
end $$;
-- 雪の地域：1月の平均気温（天気と同じ式から。北へ 50km で約2℃・100m 高いと 0.65℃ 寒い）。x, y はマス、e は標高 m
--   1 雪国（2.5℃まで）・2 豪雪（−1.5℃まで）・3 特別豪雪（−5.5℃まで）。画面（map.js の snowZone）も同じ式
create or replace function public._mp_snowzone(x float8, y float8, e float8) returns int
language sql immutable as $$
  select case when tj <= -5.5 then 3 when tj <= -1.5 then 2 when tj <= 2.5 then 1 else 0 end
    from (select 13.2 + case when y < 54 then 0.00205 else 0.00045 end * (y - 54) - 0.0065 * greatest(coalesce(e, 0), 0) tj) z
$$;
create or replace function public._mp_snowzone_at(px int, py int) returns int
language sql stable set search_path = public as $$ select _mp_snowzone(px + 0.5, py + 0.5, coalesce((_mp_cell(px, py)).e, 0)) $$;
-- 補助金のわりあい（国がはらう）：雪国 1/3・豪雪 1/2・特別豪雪 2/3
drop function if exists public._mp_snow_sub(int);
create or replace function public._mp_snow_sub(z int) returns numeric
language sql immutable as $$ select case z when 1 then 1 / 3.0 when 2 then 0.5 when 3 then 2 / 3.0 else 0 end::numeric $$;
-- 雪の対策のねだん（X）：車両1両・バス1台・融雪器（駅＋番線ごと）・防雪柵とスノーシェッド（1マス）・ラッセル車・除雪トラック。up_ は1日の維持費
insert into public.app_settings(key, value) values ('snow_cost', '{"car": 12000000, "bus": 1200000, "melt": 30000000, "melt_tr": 10000000, "fence": 150000, "shed": 1500000, "plow": 300000000, "plow_bus": 50000000,
  "up_melt": 30000, "up_plow": 60000, "up_plow_bus": 20000, "up_fence": 200, "up_shed": 1000}') on conflict (key) do nothing;
create or replace function public._mp_snowc(k text) returns bigint
language sql stable set search_path = public as $$ select coalesce((select (value::jsonb ->> k)::bigint from app_settings where key = 'snow_cost'), 0) $$;
-- お金のことば（3,000,000 のように）
create or replace function public._mp_snow_x(v bigint) returns text
language sql immutable as $$ select to_char(v, 'FM999,999,999,999,999,990') $$;

-- 駅の融雪器（鉄道の駅）：3,000万 X ＋ 番線ごとに 1,000万 X（雪国なら補助金）。p_on = false ではずす（返金なし・維持費がなくなる）
create or replace function public.mp_sta_melt(p_id bigint, p_on boolean, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s mp_stations; me_cs int[]; gv boolean; z int; cost bigint; sub bigint; bx box;
begin
  perform _mp_ok(u);
  select * into s from mp_stations where id = p_id for update;
  if not found or s.kind <> 'rail' then raise exception '鉄道の駅をえらんでください'; end if;
  me_cs := array(select id from companies where owner = u);
  gv := s.own_u is null and s.own_c is null;
  if not coalesce(s.own_u = u or s.own_c = any(me_cs) or (gv and _is_admin(u)), false) then raise exception 'あなたの駅ではありません'; end if;
  z := _mp_snowzone_at(floor(s.x / 100.0)::int, floor(s.y / 100.0)::int);
  bx := box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3));
  if not coalesce(p_on, true) then
    if not s.melt then raise exception '融雪器はありません'; end if;
    if not p_dry then update mp_stations set melt = false where id = p_id; perform _mp_chg('sta', p_id, 'set', bx); end if;
    return jsonb_build_object('on', false, 'cost', 0, 'full', 0, 'sub', 0, 'zone', z, 'up', 0);
  end if;
  if s.melt then raise exception 'もう融雪器があります'; end if;
  cost := _mp_snowc('melt') + _mp_snowc('melt_tr') * greatest(1, coalesce(s.tracks, 1));
  sub := case when gv then 0 else round(cost * _mp_snow_sub(z)) end;
  if not p_dry then
    perform _mp_lock(s.own_u, s.own_c);
    perform _mp_pay(s.own_u, s.own_c, gv, cost - sub, 'snow', format('融雪器（%s駅）%s', s.name, case when sub > 0 then format('（補助金 %s X）', _mp_snow_x(sub)) else '' end));
    update mp_stations set melt = true where id = p_id;
    perform _mp_chg('sta', p_id, 'set', bx);
  end if;
  return jsonb_build_object('on', true, 'cost', cost - sub, 'full', cost, 'sub', sub, 'zone', z, 'up', _mp_snowc('up_melt'));   -- up：1日の維持費（冬だけ・雪国は半分を国が）
end $$;

-- 線路の雪よけ：p_lv 0 なし・1 防雪柵（1マス 15万 X）・2 スノーシェッド（1マス 150万 X）。ふやす分だけはらう（補助金あり）・へらしても返金なし
create or replace function public.mp_seg_snow(p_id bigint, p_lv int, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; gv boolean; n int; z int; per bigint; cost bigint := 0; sub bigint := 0; m record;
begin
  perform _mp_ok(u);
  if p_lv is null or p_lv not in (0, 1, 2) then raise exception '0・1・2 からえらんでください'; end if;
  select * into sg from mp_segs where id = p_id for update;
  if not found or sg.kind <> 'rail' then raise exception '線路をえらんでください'; end if;
  me_cs := array(select id from companies where owner = u);
  gv := coalesce(sg.gov, false) or (sg.own_u is null and sg.own_c is null);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (gv and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  if p_lv = sg.snowp then raise exception 'いまと同じです'; end if;
  n := greatest(1, round(sg.len)::int);
  select * into m from _mp_at(sg.pts, sg.len / 2);
  z := _mp_snowzone_at(floor(m.x)::int, floor(m.y)::int);
  if p_lv > sg.snowp then
    per := case p_lv when 2 then _mp_snowc('shed') else _mp_snowc('fence') end - case sg.snowp when 1 then _mp_snowc('fence') else 0 end;
    cost := per * n; sub := case when gv then 0 else round(cost * _mp_snow_sub(z)) end;
  end if;
  if not p_dry then
    if cost > 0 then
      perform _mp_lock(sg.own_u, sg.own_c);
      perform _mp_pay(sg.own_u, sg.own_c, gv, cost - sub, 'snow', format('%s（%s・%sマス）%s', case p_lv when 2 then 'スノーシェッド' else '防雪柵' end, coalesce(nullif(sg.name, ''), '線路'), n,
                       case when sub > 0 then format('（補助金 %s X）', _mp_snow_x(sub)) else '' end));
    end if;
    update mp_segs set snowp = p_lv where id = p_id;
    perform _mp_chg('seg', p_id, 'set', sg.bb);
  end if;
  return jsonb_build_object('lv', p_lv, 'cost', cost - sub, 'full', cost, 'sub', sub, 'zone', z, 'tiles', n,
                            'up', n * case p_lv when 2 then _mp_snowc('up_shed') when 1 then _mp_snowc('up_fence') else 0 end);   -- up：1日の維持費（1年じゅう）
end $$;

-- 除雪車（車庫に置く）：鉄道の車庫はラッセル車（3億 X）・バスの車庫は除雪トラック（5,000万 X）。p_n 台にする（ふやす分だけはらう・補助金あり。へらしても返金なし）
create or replace function public.mp_dep_plow(p_id bigint, p_n int, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); d mp_depots; me_cs int[]; gv boolean; z int; per bigint; cost bigint := 0; sub bigint := 0; r real; bx box;
begin
  perform _mp_ok(u);
  if p_n is null or p_n < 0 or p_n > 20 then raise exception '0〜20台にしてください'; end if;
  select * into d from mp_depots where id = p_id for update;
  if not found or d.kind not in ('rail', 'bus') then raise exception '鉄道かバスの車庫をえらんでください'; end if;
  me_cs := array(select id from companies where owner = u);
  gv := d.own_u is null and d.own_c is null;
  if not coalesce(d.own_u = u or d.own_c = any(me_cs) or (gv and _is_admin(u)), false) then raise exception 'あなたの車庫ではありません'; end if;
  if p_n = d.plows then raise exception 'いまと同じです'; end if;
  z := _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int);
  per := case d.kind when 'rail' then _mp_snowc('plow') else _mp_snowc('plow_bus') end;
  if p_n > d.plows then cost := per * (p_n - d.plows); sub := case when gv then 0 else round(cost * _mp_snow_sub(z)) end; end if;
  if not p_dry then
    if cost > 0 then
      perform _mp_lock(d.own_u, d.own_c);
      perform _mp_pay(d.own_u, d.own_c, gv, cost - sub, 'snow', format('%s %s台（%s）%s', case d.kind when 'rail' then 'ラッセル車' else '除雪トラック' end, p_n - d.plows, d.name,
                       case when sub > 0 then format('（補助金 %s X）', _mp_snow_x(sub)) else '' end));
    end if;
    update mp_depots set plows = p_n where id = p_id;
    r := 14; bx := box(point(d.x / 100.0 - r, d.y / 100.0 - r), point(d.x / 100.0 + r, d.y / 100.0 + r));
    perform _mp_chg('dep', p_id, 'set', bx);
  end if;
  return jsonb_build_object('n', p_n, 'cost', cost - sub, 'full', cost, 'sub', sub, 'zone', z, 'up', p_n * case d.kind when 'rail' then _mp_snowc('up_plow') else _mp_snowc('up_plow_bus') end);   -- up：1日の維持費（冬だけ）
end $$;

-- 改造・検査・更新。p_kind：ac 冷房をつける・heat 暖房をつける・toilet トイレをつける・inspect 検査・renew 更新工事・
--   snow 雪の対策（t108：鉄道は耐雪改造 1両 1,200万 X・48時間、バス・トラックは冬用タイヤとチェーン 1台 120万 X・6時間。車庫が雪国なら補助金）
create or replace function public.mp_car_work(p_cars bigint[], p_kind text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; c record; cost bigint := 0; n int := 0; hrs int; skip text := ''; label text; one bigint; subs bigint := 0; sb bigint; busn int := 0;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  hrs := case p_kind when 'ac' then 24 when 'heat' then 6 when 'toilet' then 12 when 'inspect' then 4 when 'renew' then 48 when 'snow' then 48 else null end;
  label := case p_kind when 'ac' then '冷房化' when 'heat' then '暖房の取りつけ' when 'toilet' then 'トイレの取りつけ' when 'inspect' then '検査' when 'renew' then '更新工事' when 'snow' then '雪の対策' end;
  if hrs is null then raise exception '工事の種類がちがいます'; end if;
  for c in select x.*, t.role, t.price tprice, t.cab, (select _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int) from mp_depots d where d.id = x.depot) zn
             from mp_cars x join mp_types t on t.code = x.type
            where x.id = any(p_cars) and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc loop
    if c.busy_until > now() then skip := skip || ' ' || c.num || '（工事中・納車前）'; continue; end if;
    if p_kind = 'ac' and c.ac then skip := skip || ' ' || c.num || '（冷房あり）'; continue; end if;
    if p_kind = 'heat' and c.heat then skip := skip || ' ' || c.num || '（暖房あり）'; continue; end if;
    if p_kind = 'toilet' and c.toilet then skip := skip || ' ' || c.num || '（トイレあり）'; continue; end if;
    if p_kind = 'toilet' and c.role not in ('Tc', 'T') then skip := skip || ' ' || c.num || '（トイレは Tc・T に）'; continue; end if;
    if p_kind = 'snow' and c.snow then skip := skip || ' ' || c.num || '（雪の対策ずみ）'; continue; end if;
    if p_kind = 'snow' and c.role in ('Ship', 'Air') then skip := skip || ' ' || c.num || '（船・飛行機はいりません）'; continue; end if;
    one := case p_kind when 'ac' then 8000000 when 'heat' then 2000000 when 'toilet' then 5000000 when 'inspect' then round(c.tprice * 0.03)
                       when 'renew' then round(c.tprice * 0.3) when 'snow' then case when c.role in ('Bus', 'Truck') then _mp_snowc('bus') else _mp_snowc('car') end end;
    if p_kind = 'snow' then   -- 車庫が雪国なら補助金（国がはらう）
      sb := case when pa.gv then 0 else round(one * _mp_snow_sub(coalesce(c.zn, 0))) end; subs := subs + sb; one := one - sb;
      if c.role in ('Bus', 'Truck') then busn := busn + 1; end if;
    end if;
    if c.role in ('Bus', 'Truck') and p_kind in ('ac', 'toilet') then one := round(one * 0.3); end if;
    cost := cost + one; n := n + 1;
    if not p_dry then
      update mp_cars set busy_until = now() + make_interval(hours => case when p_kind = 'snow' and c.role in ('Bus', 'Truck') then 6 else hrs end), busy_kind = p_kind,
             ac = ac or p_kind = 'ac', heat = heat or p_kind = 'heat', toilet = toilet or p_kind = 'toilet', snow = snow or p_kind = 'snow',
             cond = case when p_kind = 'inspect' then least(100, cond + 35) when p_kind = 'renew' then 100 else cond end,
             renewed = renewed + case when p_kind = 'renew' then 1 else 0 end
       where id = c.id;
    end if;
  end loop;
  if n = 0 then raise exception 'できる車両がありません%', case when skip <> '' then '（' || left(trim(skip), 120) || '）' else '' end; end if;
  if not p_dry then perform _mp_pay(pa.pu, pa.pc, false, cost, case when p_kind = 'snow' then 'snow' else 'car' end,
                                    format(case when (select bool_and(t.role = 'Ship') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '船の%s（%s隻）'
                                                when (select bool_and(t.role = 'Air') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '飛行機の%s（%s機）' else '車両の%s（%s両）' end, label, n)
                                    || case when subs > 0 then format('（補助金 %s X）', _mp_snow_x(subs)) else '' end); end if;
  return jsonb_build_object('n', n, 'cost', cost, 'hours', case when p_kind = 'snow' and busn = n then 6 else hrs end, 'skip', trim(skip), 'sub', subs);
end $$;

-- 車両と編成の一覧（t108：車両の雪の対策 snow・車庫の除雪車 plows と雪の地域 zone）
create or replace function public.mp_cars_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return jsonb_build_object(
    'cars', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'num', c.num, 'role', t.role, 'face', t.face, 'label', t.label, 'depot', c.depot, 'form', c.form, 'pos', c.pos,
               'cond', round(c.cond::numeric), 'heat', c.heat, 'ac', c.ac, 'toilet', c.toilet, 'snow', c.snow, 'renewed', c.renewed,
               'age', floor(extract(epoch from now() - c.born) / 86400), 'life', t.life,
               'busy', case when c.busy_until > now() then c.busy_kind end, 'until', case when c.busy_until > now() then c.busy_until end, 'price', c.price,
               'xfer', exists (select 1 from mp_xfers x where x.st = 'offer' and c.id = any(x.cars)))
               order by c.depot, c.form nulls last, c.pos, c.num), '[]'::jsonb)
             from mp_cars c join mp_types t on t.code = c.type where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'depot', f.depot, 'perf', _mp_form_perf(f.id),
               'trains', (select count(*) from mp_trains tr where tr.form = f.id),
               'op', (select jsonb_build_object('id', o.id, 'num', o.num) from mp_ops o where o.form = f.id),
               'xfer', (select x.id from mp_xfers x where x.form = f.id and x.st = 'offer' limit 1)) order by f.name), '[]'::jsonb)
             from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'cap', d.cap, 'x', d.x, 'y', d.y,
               'n', (select count(*) from mp_cars c where c.depot = d.id), 'plows', d.plows, 'zone', _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int), 'pub', d.own_u is null and d.own_c is null and not pa.gv) order by d.own_u is null and d.own_c is null, d.id), '[]'::jsonb)
             from mp_depots d where (d.own_u is not distinct from pa.pu and d.own_c is not distinct from pa.pc)
                                 or (d.kind = 'air' and d.bld is not null and _mp_gov_term(d.bld))),   -- 国の空港の駐機場（みんなで使う。t54q）
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from mp_types t where t.on_sale),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ord), '[]'::jsonb) from mp_series s));
end $$;

-- 持ち主の、雪国（雪の地域 1 から）にある線路の長さ（km）と、雪よけのある長さ（防雪柵は半分・スノーシェッドはぜんぶと数える）
create or replace function public._mp_snow_km(pu uuid, pc int, out km real, out pkm real)
language plpgsql stable set search_path = public as $$
declare sg record; m record;
begin
  km := 0; pkm := 0;
  for sg in select s.pts, s.len, s.snowp from mp_segs s where s.kind = 'rail' and s.own_u is not distinct from pu and s.own_c is not distinct from pc loop
    select * into m from _mp_at(sg.pts, sg.len / 2);
    if _mp_snowzone_at(floor(m.x)::int, floor(m.y)::int) >= 1 then
      km := km + sg.len * 0.05; pkm := pkm + sg.len * 0.05 * case sg.snowp when 2 then 1 when 1 then 0.5 else 0 end;
    end if;
  end loop;
end $$;

-- 系統の雪の対策：ok（冬の運休にならない）・why（足りないもの）・plow（除雪がまにあう）・plows（除雪車の数）・need（いる数）・
--   melt（融雪器のある駅のわりあい）・car（雪の対策をした車両のわりあい）・prot（雪よけのある線路のわりあい）
--   冬の運休：積雪 20cm（バスは 10cm）より多い駅をとおる系統で、雪の対策をしていない車両（冬用タイヤのないバス）が1両でもある・その駅に融雪器がない
--   除雪：鉄道は、持ち主の雪国の線路 100km ごとに ラッセル車 1台。バスは、除雪トラックが1台でもあればよい
create or replace function public._mp_snow_ready(rid bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare r mp_routes; th real; deep bigint[]; nc int := 0; ns int := 0; nm int; nomelt text; why text[] := '{}'; km real := 0; pkm real := 0; pl int := 0; nmelt int := 0; nst int;
begin
  select * into r from mp_routes where id = rid;
  if not found then return null; end if;
  th := case r.kind when 'bus' then 10 else 20 end;
  deep := array(select sn.sta from mp_snow sn where sn.sta = any(r.stops) and sn.dep >= th);
  select count(*), count(*) filter (where c.snow) into nc, ns from mp_cars c
   where c.form in (select distinct t.form from mp_trains t where t.route = rid and t.form is not null and not coalesce(t.bad, false));
  if cardinality(deep) > 0 and ns < nc then why := why || case r.kind when 'bus' then format('冬用タイヤのないバス %s台', nc - ns) else format('雪の対策をしていない車両 %s両', nc - ns) end; end if;
  nst := coalesce(array_length(r.stops, 1), 0);
  if r.kind = 'rail' then
    nmelt := (select count(*) from mp_stations st where st.id = any(r.stops) and st.melt);
    nm := (select count(*) from mp_stations where id = any(deep) and not melt);
    nomelt := (select string_agg(q.name || '駅', '・' order by q.id) from (select id, name from mp_stations where id = any(deep) and not melt order by id limit 3) q);
    if nomelt is not null then why := why || ('融雪器のない駅：' || nomelt || case when nm > 3 then format('など %s駅', nm) else '' end); end if;
    select x.km, x.pkm into km, pkm from _mp_snow_km(r.own_u, r.own_c) x;
    pl := coalesce((select sum(d.plows) from mp_depots d where d.kind = 'rail' and d.own_u is not distinct from r.own_u and d.own_c is not distinct from r.own_c), 0);
  else
    pl := coalesce((select sum(d.plows) from mp_depots d where d.kind = 'bus' and d.own_u is not distinct from r.own_u and d.own_c is not distinct from r.own_c), 0);
  end if;
  return jsonb_build_object('ok', cardinality(why) = 0, 'why', array_to_string(why, '・'), 'deep', cardinality(deep), 'th', th,
    'plow', case when r.kind = 'rail' then km <= 0 or pl >= ceil(km / 100.0) else pl > 0 end, 'plows', pl,
    'need', case when r.kind = 'rail' then ceil(km / 100.0)::int else 1 end, 'km', round(km::numeric, 1),
    'melt', case when nst > 0 then round((nmelt::numeric / nst), 3) else 0 end, 'nmelt', nmelt, 'nst', nst,
    'car', case when nc > 0 then round(ns::numeric / nc, 3) else 0 end, 'ncar', nc, 'nsnow', ns,
    'prot', case when km > 0 then round((pkm / km)::numeric, 3) else 0 end);
end $$;

-- 雪の乱れの起きにくさ：雪の強さに かける数（1 対策なし〜0.35 ぜんぶ）。鉄道：車両・融雪器・雪よけ・除雪車。バス：冬用タイヤ・除雪トラック
create or replace function public._mp_snow_fac(rid bigint) returns float8
language plpgsql stable set search_path = public as $$
declare rd jsonb; md text; pw float8;
begin
  select kind into md from mp_routes where id = rid;
  rd := _mp_snow_ready(rid);
  if rd is null then return 1; end if;
  pw := case when (rd ->> 'plows')::int > 0 and (rd ->> 'plow')::boolean then 1 else 0 end;
  if md = 'bus' then return greatest(0.35, 1 - 0.45 * (rd ->> 'car')::float8 - 0.2 * pw); end if;
  return greatest(0.35, 1 - 0.25 * (rd ->> 'car')::float8 - 0.15 * (rd ->> 'melt')::float8 - 0.15 * (rd ->> 'prot')::float8 - 0.1 * pw);
end $$;

-- 雪の運休の補助金（1時間ぶん）：豪雪地帯（雪の地域 2 から）をとおる系統が、hb の前の1時間に雪で運休・遅れたら、
--   減った運賃（この1週間の同じ時間の、いちばん多い日から）の3割を国庫から。hb は mp_hours の hour（1時間のおわり）
create or replace function public._mp_snow_subsidy(hb timestamptz) returns int
language plpgsql set search_path = public as $$
declare r record; base bigint; cur bigint; amt bigint; n int := 0;
begin
  for r in select ro.id, ro.name, ro.own_u, ro.own_c from mp_routes ro
            where ro.ok and ro.kind in ('rail', 'bus') and (ro.own_u is not null or ro.own_c is not null)
              and exists (select 1 from mp_unko z where z.routes @> array[ro.id] and z.kind in ('snowstop', 'stuck', 'snow')
                            and z.t0 < hb and coalesce(z.t_end, now()) > hb - interval '1 hour')
              and exists (select 1 from mp_snow sn where sn.sta = any(ro.stops) and sn.zone >= 2) loop
    base := coalesce((select max(h.revenue) from mp_hours h where h.route = r.id and h.hour in (select hb - make_interval(days => d) from generate_series(1, 7) d)), 0);
    cur := coalesce((select h.revenue from mp_hours h where h.route = r.id and h.hour = hb), 0);
    amt := round(0.3 * greatest(0, base - cur));
    if amt > 0 then
      perform _mp_earn(r.own_u, r.own_c, false, amt, 'snow_sub', format('雪の運休の補助金（%s・%s時台）', r.name, to_char((hb - interval '1 hour') at time zone 'Asia/Tokyo', 'FMHH24')));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 雪の対策の維持費（1日ぶん）：融雪器・除雪車は冬だけ・防雪柵とスノーシェッドは1年じゅう。雪国（雪の地域 1 から）にあるものは半分を国が
create or replace function public._mp_snow_upkeep(winter boolean) returns int
language plpgsql set search_path = public as $$
declare ow record; s record; o record; full_ bigint; sb bigint; up bigint; n int := 0;
begin
  for ow in select distinct q.own_u, q.own_c from (select own_u, own_c from mp_stations where melt union all select own_u, own_c from mp_depots where plows > 0
                                                  union all select own_u, own_c from mp_segs where snowp > 0) q where q.own_u is not null or q.own_c is not null loop
    full_ := 0; sb := 0;
    if winter then
      for s in select st.x, st.y from mp_stations st where st.melt and st.own_u is not distinct from ow.own_u and st.own_c is not distinct from ow.own_c loop
        up := _mp_snowc('up_melt'); full_ := full_ + up;
        if _mp_snowzone_at(floor(s.x / 100.0)::int, floor(s.y / 100.0)::int) >= 1 then sb := sb + up / 2; end if;
      end loop;
      for s in select d.x, d.y, d.plows, d.kind from mp_depots d where d.plows > 0 and d.own_u is not distinct from ow.own_u and d.own_c is not distinct from ow.own_c loop
        up := s.plows * case s.kind when 'rail' then _mp_snowc('up_plow') else _mp_snowc('up_plow_bus') end; full_ := full_ + up;
        if _mp_snowzone_at(floor(s.x / 100.0)::int, floor(s.y / 100.0)::int) >= 1 then sb := sb + up / 2; end if;
      end loop;
    end if;
    for s in select g.pts, g.len, g.snowp from mp_segs g where g.snowp > 0 and g.own_u is not distinct from ow.own_u and g.own_c is not distinct from ow.own_c loop
      up := round(greatest(1, round(s.len)) * case s.snowp when 2 then _mp_snowc('up_shed') else _mp_snowc('up_fence') end); full_ := full_ + up;
      select * into o from _mp_at(s.pts, s.len / 2);
      if _mp_snowzone_at(floor(o.x)::int, floor(o.y)::int) >= 1 then sb := sb + up / 2; end if;
    end loop;
    if full_ - sb > 0 then
      perform _mp_soft_pay(ow.own_u, ow.own_c, false, full_ - sb, 'upkeep', format('雪の対策の維持費%s', case when sb > 0 then format('（補助金 %s X）', _mp_snow_x(sb)) else '' end));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 15分ごと（pg_cron）：積雪（3時間ごと）・冬の運休・大雪の立ち往生・雪の運休の補助金（1時間ごと）・雪の対策の維持費（1日1回）
create or replace function public._mp_snow_tick() returns void
language plpgsql set search_path = public as $$
declare ms bigint := floor(extract(epoch from now()) * 1000)::bigint; td float8 := extract(epoch from now());
        mo int := extract(month from now() at time zone 'Asia/Tokyo')::int; hh int := extract(hour from now() at time zone 'Asia/Tokyo')::int;
        winter boolean; wxok boolean; s record; r record; e float8; key text; cache jsonb := '{}'::jsonb; z int; dep real; rd jsonb; uz mp_unko; cm float8; o record;
        who uuid; th real; nw int; lw jsonb; wh text;
begin
  winter := mo in (11, 12, 1, 2, 3, 4);
  wxok := exists (select 1 from mp_wx_k);
  -- 1) 3時間ごと：走っている系統（鉄道・バス）の駅の積雪。雪国でないところ・冬でないときは 0。近く（1km・標高 50m）は同じ
  begin
    if wxok and not exists (select 1 from mp_state where k = 'snow_at' and v > now() - interval '3 hours') then
      for s in select distinct st.id, st.x, st.y from mp_stations st join mp_routes ro on st.id = any(ro.stops)
                where ro.ok and ro.kind in ('rail', 'bus') and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false)) loop
        e := greatest(coalesce((_mp_cell(floor(s.x / 100.0)::int, floor(s.y / 100.0)::int)).e, 0), 0);
        z := _mp_snowzone(floor(s.x / 100.0) + 0.5, floor(s.y / 100.0) + 0.5, e);
        if z = 0 or not winter then dep := 0;
        else
          key := round(s.x / 2000.0) || ',' || round(s.y / 2000.0) || ',' || round(e / 50.0);
          if cache ? key then dep := (cache ->> key)::real;
          else dep := _wx_snow(s.x / 100.0, s.y / 100.0, e, ms); cache := cache || jsonb_build_object(key, dep); end if;
        end if;
        insert into mp_snow(sta, zone, dep, at) values (s.id, z, dep, now()) on conflict (sta) do update set zone = excluded.zone, dep = excluded.dep, at = excluded.at;
      end loop;
      delete from mp_snow where at < now();
      insert into mp_state values ('snow_at', now()) on conflict (k) do update set v = excluded.v;
    end if;
  exception when others then raise warning 'mp snow depth: %', sqlerrm; end;
  -- 2) 冬の運休：対策が足りない系統は、25分ずつ運休をのばす（運行の乱れ snowstop。対応はえらばない。対策がすめば、のばさないので おわる）
  begin
    for r in select ro.* from mp_routes ro
              where ro.ok and ro.kind in ('rail', 'bus')
                and exists (select 1 from mp_snow sn where sn.sta = any(ro.stops) and sn.dep >= case ro.kind when 'bus' then 10 else 20 end)
                and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false)) loop
      rd := _mp_snow_ready(r.id);
      if coalesce((rd ->> 'ok')::boolean, true) then continue; end if;
      select st.id, st.name, st.x, st.y, sn.dep into s from mp_snow sn join mp_stations st on st.id = sn.sta where sn.sta = any(r.stops) order by sn.dep desc, st.id limit 1;
      select * into uz from mp_unko where st <> 'done' and kind = 'snowstop' and routes @> array[r.id] order by id desc limit 1;
      if found then
        nw := jsonb_array_length(uz.wins);
        lw := case when nw > 0 then uz.wins -> (nw - 1) end;
        if lw is not null and (lw ->> 1)::float8 >= td - 60 then
          uz.wins := jsonb_set(uz.wins, array[(nw - 1)::text, '1'], to_jsonb(greatest((lw ->> 1)::float8, td + 1500)));
        else
          uz.wins := uz.wins || jsonb_build_array(jsonb_build_array(td, td + 1500, 0, 0, 'p'));
        end if;
        update mp_unko set wins = uz.wins, t_end = greatest(t_end, to_timestamp(td + 1500)), dur = greatest(dur, ceil(td + 1500 - extract(epoch from t0))::int),
               sub = format('冬の運休（%s）', rd ->> 'why'), sev = s.dep, sevmax = greatest(coalesce(sevmax, 0), s.dep) where id = uz.id;
      else
        wh := s.name || case r.kind when 'bus' then '（バス停）' else '駅' end;
        insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end, mode, st, pick, pick_at, pick_auto, log)
          values ('snowstop', format('冬の運休（%s）', rd ->> 'why'), s.id, s.x, s.y, array[r.id], r.own_u, r.own_c, 3, s.dep, s.dep, 1500, now(),
                  jsonb_build_array(jsonb_build_array(td, td + 1500, 0, 0, 'p')), to_timestamp(td + 1500), r.kind, 'run', 5, now(), true,
                  jsonb_build_array(jsonb_build_array(td, format('%sのあたりで積雪 %scm。雪の対策が足りないため、%s（%s）', wh, round(s.dep),
                                                                 case r.kind when 'bus' then '運休しています' else '運転を見合わせています' end, rd ->> 'why'))));
        who := coalesce(r.own_u, (select owner from companies where id = r.own_c));
        if who is not null then
          perform _notice_l(who, format('【運行】%s：%sのあたりで積雪 %scm。雪の対策が足りないので、冬の運休になりました（%s）。対策がすむと、15分ほどで再開します（国土 → ≡ →「❄ 雪の対策」）',
                                        r.name, wh, round(s.dep), rd ->> 'why'), jsonb_build_object('go', 'map', 'k', 'snow'), null);
        end if;
      end if;
    end loop;
  exception when others then raise warning 'mp snow stop: %', sqlerrm; end;
  -- 3) 立ち往生：積雪 50cm（バスは 30cm）より多い駅で強い雪（1時間に 3cm から）、除雪がまにあわない系統（同じ系統は12時間に1回まで）
  begin
    if wxok then
      for r in select ro.* from mp_routes ro
                where ro.ok and ro.kind in ('rail', 'bus')
                  and exists (select 1 from mp_snow sn where sn.sta = any(ro.stops) and sn.dep >= case ro.kind when 'bus' then 30 else 50 end)
                  and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
                  and not exists (select 1 from mp_unko z where z.routes @> array[ro.id]
                                    and ((z.st <> 'done' and z.kind in ('snow', 'snowstop', 'stuck')) or (z.kind = 'stuck' and z.t0 > now() - interval '12 hours'))) loop
        rd := _mp_snow_ready(r.id);
        if coalesce((rd ->> 'plow')::boolean, true) then continue; end if;
        th := case r.kind when 'bus' then 30 else 50 end;
        select st.id, st.x, st.y, sn.dep into s from mp_snow sn join mp_stations st on st.id = sn.sta where sn.sta = any(r.stops) and sn.dep >= th order by sn.dep desc, st.id limit 1;
        e := greatest(coalesce((_mp_cell(floor(s.x / 100.0)::int, floor(s.y / 100.0)::int)).e, 0), 0);
        o := _wx_core(s.x / 100.0, s.y / 100.0, e, ms);
        if o.kind is distinct from 'snow' then continue; end if;
        cm := _wx_cm(o.inten);
        if cm < 3 then continue; end if;
        perform _mp_unko_new('stuck', format('%sが大雪で立ち往生（積雪 %scm・除雪がおいつかない）', case r.kind when 'bus' then 'バス' else '列車' end, round(s.dep)),
                             s.id, s.x, s.y, array[r.id], 3, cm::real, cm::real, ((180 + floor(random() * 181)) * 60)::int, r.own_u, r.own_c);
      end loop;
    end if;
  exception when others then raise warning 'mp snow stuck: %', sqlerrm; end;
  -- 4) 1時間に1回（毎時10分すぎ。国土の1時間の処理のあと）：雪の運休の補助金
  begin
    if extract(minute from now()) >= 10 and not exists (select 1 from mp_state where k = 'snow_hr' and v >= date_trunc('hour', now())) then
      perform _mp_snow_subsidy(date_trunc('hour', now()));
      insert into mp_state values ('snow_hr', now()) on conflict (k) do update set v = excluded.v;
    end if;
  exception when others then raise warning 'mp snow sub: %', sqlerrm; end;
  -- 5) 1日1回（朝4時台）：雪の対策の維持費
  begin
    if hh = 4 and not exists (select 1 from mp_state where k = 'snow_day' and v >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') then
      perform _mp_snow_upkeep(winter);
      insert into mp_state values ('snow_day', now()) on conflict (k) do update set v = excluded.v;
    end if;
  exception when others then raise warning 'mp snow upkeep: %', sqlerrm; end;
end $$;

-- ことば：場所（駅・空港・港・バス停）。天気・冬の運休・立ち往生は「〜のあたり」
create or replace function public._mp_unko_where(z mp_unko) returns text
language sql stable set search_path = public as $$
  select coalesce((select s.name || case s.kind when 'rail' then '駅' when 'bus' then '（バス停）' else '' end from mp_stations s where s.id = z.sta),
                  case coalesce(z.mode, 'rail') when 'rail' then '線路' when 'bus' then '道路' when 'ship' then '航路' else '空路' end)
         || case when z.kind in ('wind', 'rain', 'snow', 'stuck', 'snowstop') then 'のあたり' else '' end
$$;

-- 対応をえらぶ・変える（1〜5）。起きてから、乱れがおわるまで何度でも。冬の運休（t108）はえらべない（雪の対策がすむと おわる）
create or replace function public.mp_unko_pick(p_id bigint, p_pick int, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; z mp_unko;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_pick is null or p_pick not between 1 and 5 then raise exception '1〜5 からえらんでください'; end if;
  select * into z from mp_unko where id = p_id for update;
  if not found then raise exception '運行情報が見つかりません'; end if;
  if z.kind = 'snowstop' then raise exception '冬の運休は、対応をえらべません（雪の対策がすむと、15分ほどで再開します）'; end if;
  if not (z.own_u is not distinct from pa.pu and z.own_c is not distinct from pa.pc) or pa.gv then
    raise exception 'この対応をえらべるのは「%」です（名義を切りかえてください）', _mp_pname(z.own_u, z.own_c, false);
  end if;
  if z.st = 'done' or (z.st = 'run' and coalesce(z.t_end, now()) <= now() and now() >= z.t0 + make_interval(secs => z.dur)) then raise exception 'この乱れは、もうおわっています'; end if;
  if z.st = 'run' and z.pick = p_pick then raise exception 'いまと同じ対応です'; end if;
  perform _mp_unko_apply(z.id, p_pick, false);
  select * into z from mp_unko where id = p_id;
  return jsonb_build_object('ok', true, 'pick', z.pick, 'tend', extract(epoch from z.t_end));
end $$;

-- 天気の乱れ（系統ごと）。t108：雪は、雪の対策のぶん弱く数える（_mp_snow_fac）。冬の運休・立ち往生のあいだは起こさない
create or replace function public._mp_unko_wxr(rid bigint, ms bigint) returns bigint
language plpgsql set search_path = public as $$
declare r record; uz mp_unko; q record; n int; m int; i int; sid bigint; sx int; sy int; se float8;
        blv int := 0; bsev float8 := 0; bkind text; bsid bigint; bx int; by_ int; be float8; mx int; mxs float8; kk int;
        sf float8; ql int; qk text; qs float8; w record; wl int;
begin
  select ro.id, ro.own_u, ro.own_c, ro.stops, ro.kind into r from mp_routes ro where ro.id = rid;
  if not found or coalesce(array_length(r.stops, 1), 0) < 2 then return null; end if;
  if exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[rid] and z.kind in ('snowstop', 'stuck')) then return null; end if;
  n := array_length(r.stops, 1); m := least(n, 6);
  for i in 0..m - 1 loop
    sid := r.stops[1 + (i * (n - 1)) / greatest(1, m - 1)];
    select x, y into sx, sy from mp_stations where id = sid;
    if not found then continue; end if;
    se := coalesce((_mp_cell(floor(sx / 100.0)::int, floor(sy / 100.0)::int)).e, 0);
    q := _mp_unko_wxat(sx / 100.0, sy / 100.0, se, ms, r.kind);
    qk := q.kind; ql := q.lv; qs := q.sev;
    if qk = 'snow' and ql >= 2 and r.kind in ('rail', 'bus') then
      if sf is null then sf := _mp_snow_fac(rid); end if;
      ql := _mp_unko_lvl(r.kind, 'snow', qs * sf);
      if ql < 2 then   -- 雪が弱く数えられたら、風のほうがひどいかもしれない
        w := _wx_wind(sx / 100.0, sy / 100.0, ms); wl := _mp_unko_lvl(r.kind, 'wind', w.gust);
        if wl > ql then qk := 'wind'; ql := wl; qs := w.gust; end if;
      end if;
    end if;
    if ql > blv or (ql = blv and ql > 0 and qs > bsev) then blv := ql; bsev := qs; bkind := qk; bsid := sid; bx := sx; by_ := sy; be := se; end if;
  end loop;
  if blv < 2 then return null; end if;
  select * into uz from mp_unko where st <> 'done' and kind = bkind and mode = r.kind and own_u is not distinct from r.own_u and own_c is not distinct from r.own_c
     and t0 > now() - interval '30 minutes' and abs(x - bx) < 80000 and abs(y - by_) < 80000 order by id desc limit 1;
  if found then update mp_unko set routes = routes || r.id where id = uz.id and not (routes @> array[r.id]); return uz.id; end if;
  mx := blv; mxs := bsev; kk := 0;
  while kk < 16 loop
    q := _mp_unko_wxk(bx / 100.0, by_ / 100.0, be, ms + (kk + 1) * 900000, bkind, r.kind);
    ql := q.lv;
    if bkind = 'snow' and sf is not null then ql := _mp_unko_lvl(r.kind, 'snow', q.sev * sf); end if;
    exit when ql < 2;
    kk := kk + 1; mx := greatest(mx, ql); mxs := greatest(mxs, q.sev);
  end loop;
  return _mp_unko_new(bkind, '', bsid, bx, by_, array[r.id], mx, bsev::real, mxs::real, (kk + 1) * 900, r.own_u, r.own_c);
end $$;

-- 地図の上のもの（t108 で雪：線路の雪よけ sp・駅の融雪器 ml と積雪 sn・車庫の除雪車 pw。snow: 1 は「雪の対策がある サーバー」のしるし）
create or replace function public.mp_area(p_x0 int, p_y0 int, p_x1 int, p_y1 int, p_lod int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b box; r jsonb; me_cs int[];
begin
  perform _mp_ok(u);
  if p_x1 - p_x0 > 6000 or p_y1 - p_y0 > 6000 then raise exception '範囲が広すぎます'; end if;
  if p_lod = 0 and (p_x1 - p_x0) * (p_y1 - p_y0) > 360000 then p_lod := 1; end if;
  b := box(point(p_x0, p_y0), point(p_x1, p_y1));
  me_cs := array(select id from companies where owner = u);
  select jsonb_build_object(
    'segs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(_mp_thin(s.pts, case p_lod when 0 then 1 when 1 then 3 when 2 then 8 else 16 end)), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
                  'o', case when s.gov then 'gov' when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.gov and _is_admin(u)), 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1),
                  'ctl', case when s.own_u = u or s.own_c = any(me_cs) or (s.gov and _is_admin(u)) then to_jsonb(s.ctl) end)
                  || case when s.snowp > 0 then jsonb_build_object('sp', s.snowp) else '{}'::jsonb end), '[]'::jsonb)
               from mp_segs s where s.bb && b and (p_lod = 0 or s.kind = 'rail' or s.cls in ('exp', 'nat', 'pref') or (p_lod = 1 and s.art))
                 and (p_lod < 2 or s.kind = 'rail' or s.cls in ('exp', 'nat'))
                 and (p_lod < 3 or s.kind = 'rail' or s.cls = 'exp')),   -- lod 3（とても遠く。t108）：線路と高速だけ
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'k', n.kind, 'x', n.x, 'y', n.y, 'n', n.name, 'nk', n.nk)), '[]'::jsonb)
               from mp_nodes n where p_lod < 3 and (n.name is not null or p_lod = 0) and n.x between p_x0 * 100 and p_x1 * 100 and n.y between p_y0 * 100 and p_y1 * 100
                 and (n.name is not null or exists (select 1 from mp_segs s where s.n0 = n.id and not s.gov) or exists (select 1 from mp_segs s where s.n1 = n.id and not s.gov))),
    'stas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'seg', s.seg, 'at', s.at, 'x', s.x, 'y', s.y, 'a', s.ang, 'pl', s.plat, 'tr', s.tracks, 'n', s.name, 'ln', s.lend, 'b', s.bld,
                  'tk', case when s.kind = 'rail' then _mp_sta_trk(s) end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))
                  || case when s.melt then jsonb_build_object('ml', 1) else '{}'::jsonb end
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld,
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false)) || case when d.plows > 0 then jsonb_build_object('pw', d.plows) else '{}'::jsonb end), '[]'::jsonb)
               from mp_depots d where d.x between (p_x0 - 13) * 100 and (p_x1 + 13) * 100 and d.y between (p_y0 - 13) * 100 and (p_y1 + 13) * 100 and p_lod < 2),
    -- 航路（t54o）：海の上の折れ線（区間ごと。1/100 マス）
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'k', r.kind, 'c', r.color, 'n', r.name, 'ok', r.ok, 'mine', coalesce(r.own_u = u or r.own_c = any(me_cs), false),
                  'w', (select coalesce(jsonb_agg(l -> 'w'), '[]'::jsonb) from jsonb_array_elements(r.legs) l))), '[]'::jsonb)
               from mp_routes r where r.kind in ('ship', 'air') and r.bb && b),   -- t54p：空の路線も
    -- 滑走路（t57）：両はし [x0, y0, x1, y1]（1/100 マス）・はば（マス）・番号・長さ・空港
    'rwys', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'p', jsonb_build_array(r.x0, r.y0, r.x1, r.y1), 'w', r.w, 'n', r.name, 'len', r.len, 'st', r.st,
                  'sn', (select s.name from mp_stations s where s.id = r.st))), '[]'::jsonb)
               from mp_rwys r where box(point(least(r.x0, r.x1) / 100.0, least(r.y0, r.y1) / 100.0), point(greatest(r.x0, r.x1) / 100.0, greatest(r.y0, r.y1) / 100.0)) && b),
    -- 筆：[id, 行ごとの区画のならび [y, x0, x1, …], 1 他人・2 自分・3 国, 売り出し, 建物, 地番, 持ち主のキー]
    'parcels', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(pa.id,
                  (select jsonb_agg(v order by rn.y, rn.x0, u.o) from (
                      select y, min(x) x0, max(x) x1 from (select x, y, x - row_number() over (partition by y order by x) g from mp_pcells where parcel = pa.id) z group by y, g) rn,
                     lateral unnest(array[rn.y, rn.x0, rn.x1]) with ordinality u(v, o)),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end, pa.sale, pa.bld, _mp_ban(pa.ban, pa.eda),
                  case when pa.gov then 'gov' when pa.own_u is not null then 'u:' || pa.own_u else 'c:' || pa.own_c end)), '[]'::jsonb)
               from mp_parcels pa where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    -- 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている部屋の割合（%）, 1 他人・2 自分・3 国]
    'blds', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(b.id, b.parcel, b.kind, b.floors, to_jsonb(b.cells), b.name,
                  (select round(100.0 * count(*) filter (where x.t_kind is not null or x.mode = 'self') / greatest(count(*), 1)) from mp_units x where x.bld = b.id),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end)), '[]'::jsonb)
               from mp_blds b join mp_parcels pa on pa.id = b.parcel where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    'places', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'k', p.k, 'n', p.name, 'x', p.x, 'y', p.y, 't', p.type, 'pop', p.pop, 'par', p.parent)
                  || case when p.k = 'island' then jsonb_build_object('sz', (p.extra ->> 'n')::int) else '{}'::jsonb end), '[]'::jsonb)   -- 島（t54k2）：sz＝陸のマスの数
               from mp_places p where p.pt <@ b and p.k in ('pref', 'muni', 'ward', 'river', 'spot', 'island') and (p_lod < 2 or p.k in ('pref', 'muni')) and (p_lod < 3 or p.k = 'pref')),
    -- 町字の名前：[id, 種類, 名前, x, y]（町・大字は lod 1 から、丁目・字は lod 0）
    'chos', (select coalesce(jsonb_agg(jsonb_build_array(m.id, m.kind, m.name, m.x, m.y)), '[]'::jsonb)
               from mp_cho m where m.pt <@ b and m.gone is null and (p_lod = 0 or (p_lod = 1 and m.kind in ('cho', 'oaza')))),
    'names', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
               select distinct 'u:' || pa.own_u k, (select nickname from profiles where id = pa.own_u) v from mp_parcels pa where p_lod = 0 and pa.own_u is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'c:' || pa.own_c, (select name from companies where id = pa.own_c) from mp_parcels pa where p_lod = 0 and pa.own_c is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'u:' || s.own_u, (select nickname from profiles where id = s.own_u) from mp_segs s where s.own_u is not null and s.bb && b
               union select distinct 'c:' || s.own_c, (select name from companies where id = s.own_c) from mp_segs s where s.own_c is not null and s.bb && b) z where v is not null),
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1) into r;
  return r;
end $$;

-- 記録の種類（t108：雪の運休の補助金 snow_sub も「国土の事業」。運賃と同じく所得に入る）
create or replace function public._mp_g(k text) returns text
language sql immutable as $$ select case when k in ('fare', 'rent', 'lease_in', 'upkeep', 'lease', 'tax', 'sales', 'tuition', 'goods', 'ship', 'fee', 'ferry', 'snow_sub') then 'map_in' else 'map' end $$;

-- 雪の対策のまとめ（国土 → ≡ →「❄ 雪の対策」）：雪国をとおる自分の系統（駅ごとの雪の地域・積雪・融雪器、足りないもの、雪の対策がまだの車両）・車庫の除雪車・ねだん
create or replace function public.mp_snow_mine(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; km real; pkm real;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select x.km, x.pkm into km, pkm from _mp_snow_km(pa.pu, pa.pc) x;
  return jsonb_build_object(
    'winter', extract(month from now() at time zone 'Asia/Tokyo')::int in (11, 12, 1, 2, 3, 4),
    'cost', coalesce((select value::jsonb from app_settings where key = 'snow_cost'), '{}'::jsonb),
    'km', round(km::numeric, 1), 'pkm', round(pkm::numeric, 1),
    'routes', (select coalesce(jsonb_agg(q.j order by q.id), '[]'::jsonb) from (
       select ro.id, jsonb_build_object('id', ro.id, 'name', ro.name, 'kind', ro.kind, 'color', ro.color, 'zone', ss.zmax, 'stas', ss.j, 'ready', _mp_snow_ready(ro.id),
                'stop', (select z.kind from mp_unko z where z.st <> 'done' and z.kind in ('snowstop', 'stuck') and z.routes @> array[ro.id] order by z.id desc limit 1),
                'fix', (select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) from mp_cars c
                         where not c.snow and c.form in (select t.form from mp_trains t where t.route = ro.id and t.form is not null and not coalesce(t.bad, false)))) j
         from mp_routes ro
         cross join lateral (
           select max(x.z) zmax, coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'n', x.name, 'z', x.z, 'dep', x.dep, 'melt', x.melt, 'mine', x.mine, 'x', x.x, 'y', x.y) order by x.ord) filter (where x.z >= 1 or x.dep >= 1), '[]'::jsonb) j
             from (select st.id, st.name, st.melt, st.x, st.y, o.ord, _mp_snowzone_at(floor(st.x / 100.0)::int, floor(st.y / 100.0)::int) z,
                          (st.own_u is not distinct from pa.pu and st.own_c is not distinct from pa.pc) mine,
                          coalesce((select round(sn.dep) from mp_snow sn where sn.sta = st.id), 0) dep
                     from unnest(ro.stops) with ordinality o(sid, ord) join mp_stations st on st.id = o.sid) x) ss
        where ro.kind in ('rail', 'bus') and ro.own_u is not distinct from pa.pu and ro.own_c is not distinct from pa.pc and ss.zmax >= 1) q),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind, 'plows', d.plows, 'x', d.x, 'y', d.y,
                'zone', _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int)) order by d.kind desc, d.id), '[]'::jsonb)
             from mp_depots d where d.kind in ('rail', 'bus') and d.own_u is not distinct from pa.pu and d.own_c is not distinct from pa.pc));
end $$;

-- 15分ごと：積雪・冬の運休・立ち往生・補助金・維持費（pg_cron があるとき）
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-snow', '*/15 * * * *', 'select public._mp_snow_tick()');
  end if;
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない。融雪器・雪よけ・除雪車・雪の対策のまとめ・車両・地図は、ログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_wx_snow', '_mp_snowzone', '_mp_snowzone_at', '_mp_snow_sub', '_mp_snowc', '_mp_snow_x', '_mp_snow_km', '_mp_snow_ready',
                                                         '_mp_snow_fac', '_mp_snow_tick', '_mp_snow_subsidy', '_mp_snow_upkeep', '_mp_unko_where', '_mp_unko_wxr', '_mp_g',
                                                         'mp_sta_melt', 'mp_seg_snow', 'mp_dep_plow', 'mp_snow_mine', 'mp_car_work', 'mp_cars_list', 'mp_area', 'mp_unko_pick') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
