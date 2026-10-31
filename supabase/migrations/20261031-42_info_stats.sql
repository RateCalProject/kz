-- t62（2026-10-31）：情報 →「統計」。都道府県・市区町村・駅（バス停・港・空港も）・系統の、だれでも見られる数字を1時間ごとにまとめておく（ランキング・並べかえ・くらべる）。
--   新しい表 info_area（区域ごとの陸のマス・毎日）・info_stats（まとめ・毎時）。cron：毎時9分と毎朝4時20分。はじめに1回つくる（5〜10秒）
--   お金（残高・売上）・登録者の情報は入れない。駅・系統の持ち主の名前は、地図に出ているものと同じ

create table if not exists public.info_area (      -- 区域（市区町村・区の id）ごとの陸のマス（海・深い海でないマス。1マス 50m 四方）
  id   text primary key,
  land int not null default 0,
  at   timestamptz not null default now()
);
alter table public.info_area enable row level security;
create table if not exists public.info_stats (     -- まとめ（kind：pref・muni・sta・route）
  kind text primary key,
  at   timestamptz not null default now(),
  data jsonb not null default '[]'::jsonb
);
alter table public.info_stats enable row level security;

-- 区域ごとの陸のマス（チャンクの a・t から。5秒ぐらい。毎朝）
create or replace function public._info_area_build() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  delete from info_area where true;
  insert into info_area(id, land, at)
    select c.ap[strpos('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', u.a)], count(*), now()
      from mp_chunks c, lateral unnest(string_to_array(c.a, null), string_to_array(c.t, null)) u(a, t)
     where u.t not in ('S', 'D') and c.ap[strpos('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', u.a)] is not null
     group by 1;
  get diagnostics n = row_count;
  return n;
end $$;

-- まとめる（毎時。3秒ぐらい）
--   駅の乗降客数（1日・推計）＝ 系統のこの24時間の利用者 × その駅のまわりの人のわりあい（系統の catch）× 2（乗る・降りる）を、駅を通る系統でたしたもの
--   発着本数：ふだんの列車（臨時でない・走れるもの）が止まる回数（1日）
create or replace function public._info_stats_build() returns int
language plpgsql set search_path = public as $$
declare b64 constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
begin
  create temp table if not exists _is_loc (k text, id bigint, aid text) on commit drop;   -- 駅・建物 → 区域
  delete from _is_loc where true;
  insert into _is_loc
    select 's', s.id, c.ap[strpos(b64, substr(c.a, (s.ty - c.cy * 64) * 64 + (s.tx - c.cx * 64) + 1, 1))]
      from (select id, floor(x / 100.0)::int tx, floor(y / 100.0)::int ty from mp_stations) s
      join mp_chunks c on c.cx = floor(s.tx / 64.0)::int and c.cy = floor(s.ty / 64.0)::int;
  insert into _is_loc
    select 'b', b.id, c.ap[strpos(b64, substr(c.a, (b.ty - c.cy * 64) * 64 + (b.tx - c.cx * 64) + 1, 1))]
      from (select id, floor(cells[1] / 5.0)::int tx, floor(cells[2] / 5.0)::int ty from mp_blds) b
      join mp_chunks c on c.cx = floor(b.tx / 64.0)::int and c.cy = floor(b.ty / 64.0)::int;
  -- 区域の数（区は市にもたす）
  create temp table if not exists _is_cnt (aid text primary key, sta int, bus int, port int, air int, blds int) on commit drop;
  delete from _is_cnt where true;
  insert into _is_cnt
    select l.aid, count(*) filter (where l.k = 's' and s.kind = 'rail'), count(*) filter (where l.k = 's' and s.kind = 'bus'),
           count(*) filter (where l.k = 's' and s.kind = 'ship'), count(*) filter (where l.k = 's' and s.kind = 'air'), count(*) filter (where l.k = 'b')
      from _is_loc l left join mp_stations s on l.k = 's' and s.id = l.id
     where l.aid is not null group by l.aid;
  -- 県庁所在地（県庁の建物がある市町村）
  create temp table if not exists _is_cap (pref text primary key, muni text) on commit drop;
  delete from _is_cap where true;
  insert into _is_cap
    select distinct on (mu.parent) mu.parent, mu.id
      from mp_blds b join _is_loc l on l.k = 'b' and l.id = b.id join mp_places ar on ar.id = l.aid
      join mp_places mu on mu.id = case when ar.k = 'ward' then ar.parent else ar.id end
     where b.kind = 'prefhall' and mu.parent is not null
     order by mu.parent, b.id;
  -- 系統のこの24時間
  create temp table if not exists _is_rt (route bigint primary key, served bigint, seats bigint) on commit drop;
  delete from _is_rt where true;
  insert into _is_rt
    select h.route, sum(h.served), sum(h.cap::bigint * case when r.kind = 'air' then 1 else 2 end)
      from mp_hours h join mp_routes r on r.id = h.route where h.hour > (select max(hour) from mp_hours) - interval '24 hours' group by h.route;   -- いちばん新しい24時間
  create temp table if not exists _is_pax (st bigint primary key, pax bigint) on commit drop;
  delete from _is_pax where true;
  insert into _is_pax
    select e.key::bigint, round(sum(2.0 * rt.served * e.value::numeric / nullif(tot.t, 0)))::bigint
      from mp_routes r join _is_rt rt on rt.route = r.id
      cross join lateral (select sum(v.value::numeric) t from jsonb_each_text(r.catch) v) tot
      cross join lateral jsonb_each_text(r.catch) e
     where r.ok and r.catch is not null and jsonb_typeof(r.catch) = 'object' and e.key ~ '^\d+$' and e.value ~ '^[0-9.]+$'
     group by 1;
  create temp table if not exists _is_stop (st bigint primary key, n int) on commit drop;
  delete from _is_stop where true;
  insert into _is_stop
    select (s.v ->> 0)::bigint, count(*)
      from mp_trains t join mp_routes r on r.id = t.route and r.ok cross join lateral jsonb_array_elements(t.sched) s(v)
     where not t.bad and t.day is null and (s.v ->> 0) ~ '^\d+$' and ((s.v ->> 1) is not null or (s.v ->> 2) is not null)
     group by 1;

  -- 市区町村（区もふくむ。区のある市は、区をたしたもの）
  insert into info_stats(kind, at, data) values ('muni', now(), (
    with a as (
      select p.*, case when p.k = 'muni' and coalesce((p.extra ->> 'wards')::boolean, false)
                       then array(select w.id from mp_places w where w.k = 'ward' and w.parent = p.id) else array[p.id] end ids
        from mp_places p where p.k in ('muni', 'ward'))
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'n', a.name || coalesce(a.type, ''), 'k', a.k,
        'pr', case when a.k = 'ward' then (select pr.name || coalesce(nullif(pr.type, ''), '県') from mp_places m join mp_places pr on pr.id = m.parent where m.id = a.parent)
                   else (select pr.name || coalesce(nullif(pr.type, ''), '県') from mp_places pr where pr.id = a.parent) end,
        'up', case when a.k = 'ward' then (select m.name || m.type from mp_places m where m.id = a.parent) end,
        'pop', a.pop, 'land', (select coalesce(sum(i.land), 0) from info_area i where i.id = any(a.ids)),
        'cv', _mp_mcval(a.x, a.y),
        'sta', (select coalesce(sum(c.sta), 0) from _is_cnt c where c.aid = any(a.ids)), 'bus', (select coalesce(sum(c.bus), 0) from _is_cnt c where c.aid = any(a.ids)),
        'blds', (select coalesce(sum(c.blds), 0) from _is_cnt c where c.aid = any(a.ids)),
        'cap', case when a.id = 'w:nakazato' then 'econ' when a.id = 'w:-1_0' then 'adm' when exists (select 1 from _is_cap c where c.muni = a.id) then 'pref' end,
        'x', a.x, 'y', a.y) order by a.id), '[]'::jsonb) from a))
  on conflict (kind) do update set at = excluded.at, data = excluded.data;

  -- 都道府県
  insert into info_stats(kind, at, data) values ('pref', now(), (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'n', pr.name || coalesce(nullif(pr.type, ''), '県'),
        'pop', (select coalesce(sum(m.pop), 0) from mp_places m where m.k = 'muni' and m.parent = pr.id),
        'land', (select coalesce(sum(i.land), 0) from info_area i join mp_places ar on ar.id = i.id
                  where (ar.k = 'muni' and ar.parent = pr.id) or (ar.k = 'ward' and exists (select 1 from mp_places m where m.id = ar.parent and m.parent = pr.id))),
        'munis', (select count(*) from mp_places m where m.k = 'muni' and m.parent = pr.id),
        'sta', (select coalesce(sum(c.sta), 0) from _is_cnt c join mp_places ar on ar.id = c.aid
                  where (ar.k = 'muni' and ar.parent = pr.id) or (ar.k = 'ward' and exists (select 1 from mp_places m where m.id = ar.parent and m.parent = pr.id))),
        'blds', (select coalesce(sum(c.blds), 0) from _is_cnt c join mp_places ar on ar.id = c.aid
                  where (ar.k = 'muni' and ar.parent = pr.id) or (ar.k = 'ward' and exists (select 1 from mp_places m where m.id = ar.parent and m.parent = pr.id))),
        'capn', (select m.name || m.type from _is_cap c join mp_places m on m.id = c.muni where c.pref = pr.id),
        'x', pr.x, 'y', pr.y) order by pr.id), '[]'::jsonb)
      from mp_places pr where pr.k = 'pref'))
  on conflict (kind) do update set at = excluded.at, data = excluded.data;

  -- 駅・バス停・港・空港
  insert into info_stats(kind, at, data) values ('sta', now(), (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'n', s.name, 'k', s.kind,
        'o', _mp_pname(s.own_u, s.own_c, s.own_u is null and s.own_c is null),
        'pr', pr.name || coalesce(nullif(pr.type, ''), '県'), 'mu', mu.name || mu.type, 'wd', case when ar.k = 'ward' then ar.name || '区' end,
        'rt', (select count(*) from mp_routes r where r.ok and s.id = any(r.stops)),
        'tr', coalesce(st.n, 0), 'pax', coalesce(px.pax, 0),
        'pl', s.plat, 'tk', s.tracks, 'x', round(s.x / 100.0, 1), 'y', round(s.y / 100.0, 1)) order by s.id), '[]'::jsonb)
      from mp_stations s
      left join _is_loc l on l.k = 's' and l.id = s.id left join mp_places ar on ar.id = l.aid
      left join mp_places mu on mu.id = case when ar.k = 'ward' then ar.parent else ar.id end
      left join mp_places pr on pr.id = mu.parent
      left join _is_stop st on st.st = s.id left join _is_pax px on px.st = s.id))
  on conflict (kind) do update set at = excluded.at, data = excluded.data;

  -- 系統（鉄道・バス・航路・空路）
  insert into info_stats(kind, at, data) values ('route', now(), (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'n', r.name, 'k', r.kind, 'c', r.color,
        'o', _mp_pname(r.own_u, r.own_c, r.own_u is null and r.own_c is null),
        'ns', coalesce(array_length(r.stops, 1), 0),
        'km', round((coalesce((select sum((l ->> 'd')::numeric) from jsonb_array_elements(case when jsonb_typeof(r.legs) = 'array' then r.legs else '[]'::jsonb end) l), 0) / 1000)::numeric, 1),
        'tr', (select count(*) from mp_trains t where t.route = r.id and not t.bad and t.day is null),
        'pax', coalesce(rt.served, 0),
        'load', case when rt.seats > 0 then round(100.0 * rt.served / rt.seats) end,
        'sp', case when jsonb_typeof(r.last) = 'object' then (r.last ->> 'speed')::numeric end,
        'x', (select round(s.x / 100.0, 1) from mp_stations s where s.id = r.stops[1]), 'y', (select round(s.y / 100.0, 1) from mp_stations s where s.id = r.stops[1])) order by r.id), '[]'::jsonb)
      from mp_routes r left join _is_rt rt on rt.route = r.id where r.ok))
  on conflict (kind) do update set at = excluded.at, data = excluded.data;
  return 4;
end $$;

-- 読む（ログインしている人なら、だれでも。ゲストも）
create or replace function public.info_stats_get(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g(); r info_stats;
begin
  if p_kind is null or p_kind not in ('pref', 'muni', 'sta', 'route') then raise exception '種類が正しくありません'; end if;
  select * into r from info_stats where kind = p_kind;
  return jsonb_build_object('kind', p_kind, 'at', r.at, 'rows', coalesce(r.data, '[]'::jsonb));
end $$;

revoke all on function public._info_area_build() from public, anon, authenticated;
revoke all on function public._info_stats_build() from public, anon, authenticated;
revoke all on function public.info_stats_get(text) from public, anon;
grant execute on function public.info_stats_get(text) to authenticated;

-- 毎時9分（国土の時計の毎時2分のあと）・毎朝4時20分（pg_cron があるとき）
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-stats', '9 * * * *', 'select public._info_stats_build()');
    perform cron.schedule('ailinax-stats-area', '20 4 * * *', 'select public._info_area_build()');
  end if;
end $$;

-- はじめに1回
select public._info_area_build();
select public._info_stats_build();
