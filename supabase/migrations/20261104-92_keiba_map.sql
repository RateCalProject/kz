-- 競馬場（国の建物。府中・京都・中京の3つ）：管理者が地図に場所をえらんでおく（地図の ≡ → 国土の管理 → 競馬場）。大きさは本物ぐらい（府中 1,120m×520m など）
--   その会場のレースの時間には、来場者（1レース 府中 2,500人・京都 2,000人・中京 1,600人。G1 は12倍）が、近くの駅（ふちから800m）・バス停（400m）で乗り降りする（行きと帰り）
-- 場外馬券売り場（建物の種類 kbshop・娯楽）：プレイヤーが建てられる。客は まわり10kmの人と駅の乗り降りする人から。手数料（町の人の馬券の売上の 5%）が レースのある時間に入る

create table if not exists public.mp_tracks (   -- 競馬場（DB の更新92）：国の建物。会場（keiba_venues の name）ごとに1つ。管理者が地図におく
  k    text primary key check (k in ('府中', '京都', '中京')),
  bld  bigint unique references public.mp_blds(id) on delete cascade,
  x0   int not null, y0 int not null, x1 int not null, y1 int not null,   -- 区画（10m）の四角
  dir  text not null default 'h' check (dir in ('h', 'v')),             -- 長い辺の向き（h：横・v：縦）
  at   timestamptz not null default now()
);
alter table public.mp_tracks enable row level security;
revoke all on public.mp_tracks from public, anon, authenticated;

-- レースの格の重み（DB の更新92）：競馬場の来場者・場外馬券売り場の手数料（ふつうのレース 1・G1 は 12）
create or replace function public._mp_race_w(g text) returns real
language sql immutable as $$
  select (case g when 'G1' then 12 when 'G2' then 5 when 'G3' then 3 when 'L' then 2 when 'OP' then 1.5 else 1 end)::real
$$;
-- 競馬場の大きさ（区画。h：横長・v：縦長）。コースの1周（府中 2,083m・京都 1,894m・中京 1,705m）と直線・スタンド・駐車場が入る広さ
create or replace function public._mp_track_wh(p_k text, p_dir text) returns int[]
language sql immutable as $$
  select case when p_dir = 'v' then array[s[2], s[1]] else s end
    from (select case p_k when '府中' then array[112, 52] when '京都' then array[102, 52] when '中京' then array[92, 46] end s) z
$$;
-- 1レースの来場者（ふつうのレース。格の重みをかける）
create or replace function public._mp_track_base(p_k text) returns real
language sql immutable as $$ select (case p_k when '府中' then 2500 when '京都' then 2000 when '中京' then 1600 else 0 end)::real $$;
-- 競馬場をおけるか（区画の四角）：持ち主のいる土地（p_old の競馬場の筆はのぞく）・道路・線路・駅・車庫・滑走路・水・山・公園の区画の数
create or replace function public._mp_track_check(x0 int, y0 int, x1 int, y1 int, p_old bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare opid bigint := (select b.parcel from mp_blds b where b.id = p_old); own int; bz int; wt int := 0; mt int := 0; pk int := 0; c record; ni int;
begin
  select count(*) into own from mp_pcells pc where pc.x between x0 and x1 and pc.y between y0 and y1 and pc.parcel is distinct from opid;
  select count(*) into bz from _mp_busy_cells(x0, y0, x1, y1);
  for c in select t.tx, t.ty, cc.t, cc.z from (select gx tx, gy ty from generate_series(_mp_t5(x0), _mp_t5(x1)) gx, generate_series(_mp_t5(y0), _mp_t5(y1)) gy) t, lateral _mp_cell(t.tx, t.ty) cc loop
    ni := (least(x1, c.tx * 5 + 4) - greatest(x0, c.tx * 5) + 1) * (least(y1, c.ty * 5 + 4) - greatest(y0, c.ty * 5) + 1);
    if c.t is null or c.t in ('S', 'D', 'R', 'L') then wt := wt + ni;
    elsif c.t in ('M', 'K') then mt := mt + ni;
    elsif c.z = 'j' then pk := pk + ni; end if;
  end loop;
  return jsonb_build_object('owned', own, 'busy', bz, 'water', wt, 'mount', mt, 'park', pk, 'n', (x1 - x0 + 1) * (y1 - y0 + 1), 'ok', own + bz + wt + mt + pk = 0);
end $$;
-- おけないわけ（文）
create or replace function public._mp_track_why(ck jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(concat_ws('・',
    case when (ck ->> 'owned')::int > 0 then format('持ち主のいる土地 %s区画', ck ->> 'owned') end,
    case when (ck ->> 'busy')::int > 0 then format('道路・線路・駅など %s区画', ck ->> 'busy') end,
    case when (ck ->> 'water')::int > 0 then format('海・川・湖 %s区画', ck ->> 'water') end,
    case when (ck ->> 'mount')::int > 0 then format('山 %s区画', ck ->> 'mount') end,
    case when (ck ->> 'park')::int > 0 then format('公園 %s区画', ck ->> 'park') end), ''), 'なし')
$$;
-- 競馬場のお客が乗り降りする駅・バス停：競馬場のふちから 駅 800m・バス停 400m の、系統の止まるもの。f：わりあい（駅 1・バス停 0.25 を、近いほど多く）
create or replace function public._mp_track_sta(p_k text) returns table (sid bigint, kind text, dm real, f real)
language sql stable set search_path = public as $$
  with tk as (select t.* from mp_tracks t where t.k = p_k and t.bld is not null),
       st as (select s.id sid, s.kind,
                     (sqrt(greatest(tk.x0 - s.x / 20.0, 0, s.x / 20.0 - (tk.x1 + 1)) ^ 2 + greatest(tk.y0 - s.y / 20.0, 0, s.y / 20.0 - (tk.y1 + 1)) ^ 2) * 10)::real dm
                from tk join mp_stations s on s.x between (tk.x0 - 80) * 20 and (tk.x1 + 81) * 20 and s.y between (tk.y0 - 80) * 20 and (tk.y1 + 81) * 20
               where s.kind in ('rail', 'bus') and exists (select 1 from mp_routes r where r.ok and s.id = any(r.stops))),
       ok as (select st.*, ((case when st.kind = 'rail' then 1.0 else 0.25 end) / (1 + st.dm / 300.0))::real w
                from st where st.dm <= case when st.kind = 'rail' then 800 else 400 end)
  select ok.sid, ok.kind, ok.dm, (ok.w / sum(ok.w) over ())::real f from ok
$$;
-- この1時間（h-1 〜 h）のレースの来場者が乗る人（系統ごと。{系統: 人}）。行きと帰りで2回。駅があれば 75%・バス停だけなら 35% が列車・バスで来る。
--   駅ごとの人は、その駅に止まる系統で分ける
create or replace function public._mp_track_riders(h timestamptz) returns jsonb
language sql stable set search_path = public as $$
  with vis as (select v.name k, sum(_mp_track_base(v.name) * _mp_race_w(kr.grade))::real n
                 from keiba_races kr join keiba_venues v on v.id = kr.venue
                where kr.post >= h - interval '1 hour' and kr.post < h and v.name in (select t.k from mp_tracks t where t.bld is not null)
                group by v.name),
       s as (select vis.k, vis.n, ts.sid, ts.kind, ts.f from vis cross join lateral _mp_track_sta(vis.k) ts),
       m as (select s.k, case when bool_or(s.kind = 'rail') then 0.75 else 0.35 end ms from s group by s.k),
       sr as (select s.sid, sum(s.n * 2 * m.ms * s.f) n from s join m on m.k = s.k group by s.sid),
       rr as (select r.id rid, sum(sr.n / greatest(1, (select count(*) from mp_routes r2 where r2.ok and sr.sid = any(r2.stops)))) n
                from sr join mp_routes r on r.ok and sr.sid = any(r.stops) group by r.id)
  select coalesce(jsonb_object_agg(rr.rid::text, round(rr.n::numeric)), '{}'::jsonb) from rr where rr.n >= 1
$$;
-- その日のレース（ひとつづきのレースを1つにまとめる：会場がかわるか、20分よりあくと次）。p_k：会場（null ならぜんぶ）
--   [{k 会場, t 発走（はじめ）, n レースの数, g いちばん上の格, top そのレースの名前}]
create or replace function public._mp_race_sessions(d date, p_k text) returns jsonb
language sql stable set search_path = public as $$
  with r as (select kr.post, v.name k, kr.grade, kr.name nm
               from keiba_races kr join keiba_venues v on v.id = kr.venue
              where kr.post >= (d::timestamp at time zone 'Asia/Tokyo') and kr.post < ((d + 1)::timestamp at time zone 'Asia/Tokyo')
                and (p_k is null or v.name = p_k)),
       l as (select r.*, lag(r.k) over (order by r.post, r.k) lk, lag(r.post) over (order by r.post, r.k) lp from r),
       g as (select l.*, sum(case when l.lk is distinct from l.k or l.post - l.lp > interval '20 minutes' then 1 else 0 end) over (order by l.post, l.k) sn from l)
  select coalesce(jsonb_agg(z.x order by z.t0), '[]'::jsonb) from (
    select min(g.post) t0, jsonb_build_object('k', min(g.k), 't', to_char(min(g.post) at time zone 'Asia/Tokyo', 'HH24:MI'), 'n', count(*),
             'g', (array_agg(g.grade order by _mp_race_w(g.grade) desc, g.post))[1], 'top', (array_agg(g.nm order by _mp_race_w(g.grade) desc, g.post))[1]) x
      from g group by g.sn) z
$$;
-- 競馬場の一覧（地図においてあるか・場所）
create or replace function public.mp_track_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  perform _mp_ok(u);
  return (select jsonb_agg(jsonb_build_object('k', v.k, 'bld', t.bld, 'dir', coalesce(t.dir, 'h'), 'wh', to_jsonb(_mp_track_wh(v.k, 'h')),
            'rect', case when t.bld is not null then jsonb_build_array(t.x0, t.y0, t.x1, t.y1) end,
            'x', case when t.bld is not null then t.x0 + (t.x1 - t.x0 + 1) / 2 end, 'y', case when t.bld is not null then t.y0 + (t.y1 - t.y0 + 1) / 2 end,
            'addr', case when t.bld is not null then _mp_addr(_mp_t5(t.x0 + (t.x1 - t.x0 + 1) / 2), _mp_t5(t.y0 + (t.y1 - t.y0 + 1) / 2), t.x0 + (t.x1 - t.x0 + 1) / 2, t.y0 + (t.y1 - t.y0 + 1) / 2) ->> 'text' end)
            order by v.o)
    from (values ('府中', 1), ('京都', 2), ('中京', 3)) v(k, o) left join mp_tracks t on t.k = v.k and t.bld is not null);
end $$;
-- 競馬場をおく（管理者）。p_x・p_y：まん中の区画。p_dir：h 横長・v 縦長。p_dry：しらべるだけ。
--   もうおいてあれば、いまの競馬場をとりのぞいて、あたらしい場所におく（場所を変える）。国の筆（町字をまたいでもよい：区画のいちばん多い町字の地番）と国の建物（工事は無料）
create or replace function public.mp_track_place(p_k text, p_x int, p_y int, p_dir text, p_dry boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); dr text := coalesce(p_dir, 'h'); wh int[]; x0 int; y0 int; x1 int; y1 int; ck jsonb; old mp_tracks; opid bigint; pid bigint; bid bigint; chk text; n int; cs int[];
begin
  perform _mp_admin(u);
  if p_k is null or p_k not in ('府中', '京都', '中京') then raise exception '競馬場は 府中・京都・中京 の3つです'; end if;
  if dr not in ('h', 'v') then raise exception '向きは 横（h）か 縦（v）です'; end if;
  if p_x is null or p_y is null then raise exception '場所がありません'; end if;
  wh := _mp_track_wh(p_k, dr);
  x0 := p_x - wh[1] / 2; y0 := p_y - wh[2] / 2; x1 := x0 + wh[1] - 1; y1 := y0 + wh[2] - 1;
  select * into old from mp_tracks where k = p_k and bld is not null;
  ck := _mp_track_check(x0, y0, x1, y1, old.bld)
        || jsonb_build_object('rect', jsonb_build_array(x0, y0, x1, y1), 'dir', dr, 'moved', old.bld is not null,
                              'addr', _mp_addr(_mp_t5(p_x), _mp_t5(p_y), p_x, p_y) ->> 'text');
  if p_dry then return ck; end if;
  if not (ck ->> 'ok')::boolean then raise exception 'ここには おけません（%）', _mp_track_why(ck); end if;
  -- いまの競馬場（場所を変えるとき）：筆ごととりのぞく（建物・競馬場の行も消える）
  if old.bld is not null then
    opid := (select b.parcel from mp_blds b where b.id = old.bld);
    delete from mp_parcels where id = opid;
    perform _mp_chg('land', null, 'set', box(point(_mp_t5(old.x0), _mp_t5(old.y0)), point(_mp_t5(old.x1) + 1, _mp_t5(old.y1) + 1)));
  end if;
  -- 町字：区画のいちばん多い町字
  select z.cho_k into chk from (select _mp_cho_at(gx, gy) cho_k, sum((least(x1, gx * 5 + 4) - greatest(x0, gx * 5) + 1) * (least(y1, gy * 5 + 4) - greatest(y0, gy * 5) + 1)) nc
                                  from generate_series(_mp_t5(x0), _mp_t5(x1)) gx, generate_series(_mp_t5(y0), _mp_t5(y1)) gy group by 1) z
   where z.cho_k is not null order by z.nc desc, z.cho_k limit 1;
  if chk is null then raise exception '町字がわかりません'; end if;
  perform 1 from mp_cho where id = chk for update;   -- 地番をとる（同じ町字の同時の買いものを順番に）
  n := wh[1] * wh[2];
  insert into mp_parcels(own_u, own_c, gov, cho, ban, eda, n, bb, price, val, mval)
    values (null, null, true, chk, coalesce((select max(p.ban) from mp_parcels p where p.cho = chk), 0) + 1, 0, n, box(point(x0, y0), point(x1 + 1, y1 + 1)), 0, 0, 0)
    returning id into pid;
  insert into mp_pcells(x, y, parcel) select gx, gy, pid from generate_series(x0, x1) gx, generate_series(y0, y1) gy;
  perform _mp_parcel_vals(array[pid]);
  cs := array(select q.v from generate_series(y0, y1) gy, generate_series(x0, x1) gx, lateral unnest(array[gx, gy]) with ordinality q(v, o) order by gy, gx, q.o);
  bid := _mp_bld_make(pid, jsonb_build_object('kind', 'keiba', 'shape', 'full', 'floors', 0, 'cells', to_jsonb(cs), 'fm2', n * 100, 'plan', '[]'::jsonb), '', p_k || '競馬場', 0, false);
  insert into mp_tracks(k, bld, x0, y0, x1, y1, dir, at) values (p_k, bid, x0, y0, x1, y1, dr, now())
    on conflict (k) do update set bld = excluded.bld, x0 = excluded.x0, y0 = excluded.y0, x1 = excluded.x1, y1 = excluded.y1, dir = excluded.dir, at = excluded.at;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(x0), _mp_t5(y0)), point(_mp_t5(x1) + 1, _mp_t5(y1) + 1)));
  return ck || jsonb_build_object('id', bid, 'name', p_k || '競馬場');
end $$;
-- 近くで競馬場をおけるところをさがす（管理者）：p_x・p_y のまわり 4km を 250m ずつ、近いところから。はやい下しらべ（マスごと）のあと、くわしくしらべる（40か所まで）
create or replace function public.mp_track_find(p_k text, p_x int, p_y int, p_dir text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); dr text := coalesce(p_dir, 'h'); wh int[]; c record; x0 int; y0 int; x1 int; y1 int; ck jsonb; old bigint; opid bigint; n int := 0;
begin
  perform _mp_admin(u);
  if p_k is null or p_k not in ('府中', '京都', '中京') then raise exception '競馬場は 府中・京都・中京 の3つです'; end if;
  if dr not in ('h', 'v') then raise exception '向きは 横（h）か 縦（v）です'; end if;
  wh := _mp_track_wh(p_k, dr);
  old := (select t.bld from mp_tracks t where t.k = p_k);
  opid := (select b.parcel from mp_blds b where b.id = old);
  for c in select p_x + i * 25 cx, p_y + j * 25 cy from generate_series(-16, 16) i, generate_series(-16, 16) j order by i * i + j * j, abs(j), i, j loop
    x0 := c.cx - wh[1] / 2; y0 := c.cy - wh[2] / 2; x1 := x0 + wh[1] - 1; y1 := y0 + wh[2] - 1;
    if exists (select 1 from (values (x0, y0), (x1, y0), (x0, y1), (x1, y1), (c.cx, c.cy)) v(a, b), lateral _mp_cell(_mp_t5(v.a), _mp_t5(v.b)) cc
                where cc.t is null or cc.t in ('S', 'D', 'R', 'L', 'M', 'K') or cc.z = 'j') then continue; end if;
    if exists (select 1 from mp_occ o where o.x between _mp_t5(x0) and _mp_t5(x1) and o.y between _mp_t5(y0) and _mp_t5(y1) and o.what in ('road', 'rail', 'sta', 'dep', 'rwy')) then continue; end if;
    if exists (select 1 from mp_pcells pc where pc.x between x0 and x1 and pc.y between y0 and y1 and pc.parcel is distinct from opid) then continue; end if;
    n := n + 1;
    ck := _mp_track_check(x0, y0, x1, y1, old);
    if (ck ->> 'ok')::boolean then return jsonb_build_object('x', c.cx, 'y', c.cy, 'dir', dr, 'tried', n); end if;
    exit when n >= 40;
  end loop;
  return jsonb_build_object('x', null, 'y', null, 'dir', dr, 'tried', n);
end $$;
-- 競馬場をとりのぞく（管理者）：筆ごと
create or replace function public.mp_track_del(p_k text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); t mp_tracks;
begin
  perform _mp_admin(u);
  select * into t from mp_tracks where k = p_k;
  if not found or t.bld is null then raise exception 'この競馬場は、まだ地図においていません'; end if;
  delete from mp_parcels where id = (select b.parcel from mp_blds b where b.id = t.bld);
  delete from mp_tracks where k = p_k;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(t.x0), _mp_t5(t.y0)), point(_mp_t5(t.x1) + 1, _mp_t5(t.y1) + 1)));
  return jsonb_build_object('k', p_k);
end $$;
-- 建物のシート：競馬場（きょうのレース・来場者の見こみ・お客が乗る駅）・場外馬券売り場（きょうのレース）
create or replace function public.mp_track_info(p_bld bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g(); b mp_blds; t mp_tracks; d0 date := (now() at time zone 'Asia/Tokyo')::date;
begin
  perform _mp_ok(u);
  select * into b from mp_blds where id = p_bld;
  if not found then raise exception '建物が見つかりません'; end if;
  if b.kind = 'keiba' then
    select * into t from mp_tracks where bld = b.id;
    if not found then return null; end if;
    return jsonb_build_object('kind', 'keiba', 'k', t.k, 'w', (t.x1 - t.x0 + 1) * 10, 'h', (t.y1 - t.y0 + 1) * 10,
      'today', _mp_race_sessions(d0, t.k),
      'vis', (select round(sum(_mp_track_base(t.k) * _mp_race_w(kr.grade))::numeric) from keiba_races kr join keiba_venues v on v.id = kr.venue
               where v.name = t.k and kr.post >= (d0::timestamp at time zone 'Asia/Tokyo') and kr.post < ((d0 + 1)::timestamp at time zone 'Asia/Tokyo')),
      'sta', (select coalesce(jsonb_agg(jsonb_build_object('id', s.sid, 'n', st.name, 'k', s.kind, 'm', round(s.dm::numeric), 'f', round((s.f * 100)::numeric)) order by s.f desc), '[]'::jsonb)
                from _mp_track_sta(t.k) s join mp_stations st on st.id = s.sid));
  elsif b.kind = 'kbshop' then
    return jsonb_build_object('kind', 'kbshop', 'today', _mp_race_sessions(d0, null));
  end if;
  return null;
end $$;

create or replace function public._mp_bld_presets() returns jsonb
language sql immutable as $$
  select '[
   {"k":"house","n":"一戸建て","use":"home","one":true,"z":"abcehik","cpm":300,"f0":1,"f1":3,"min":1,"max":6,"sh":["full","L"],"cat":"home","c":"#c47b4e"},
   {"k":"apart","n":"アパート","use":"home","u":40,"z":"abcek","cpm":320,"f0":2,"f1":3,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#9aa7b3"},
   {"k":"mansion","n":"マンション","use":"home","u":70,"z":"bcdek","cpm":600,"f0":4,"f1":15,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"opt":["shop1"],"cat":"home","c":"#d9d4cc"},
   {"k":"tower","n":"タワーマンション","use":"home","u":75,"z":"cd","cpm":900,"f0":20,"f1":45,"min":16,"max":200,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#cfd6de"},
   {"k":"shop","n":"店舗つき住宅","use":"home","u":50,"g1":"shop","z":"abcdek","cpm":350,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"cat":"home","c":"#e6a06e"},
   {"k":"zakkyo","n":"雑居ビル","use":"office","u":60,"g1":"shop","g2":"shop","z":"cd","cpm":650,"f0":3,"f1":10,"min":2,"max":12,"sh":["full","slab"],"cat":"biz","c":"#c9b8a6"},
   {"k":"office","n":"オフィスビル","use":"office","u":0,"z":"cd","cpm":800,"f0":5,"f1":30,"min":6,"max":120,"sh":["full","slab","L","tower"],"opt":["shop1"],"cat":"biz","c":"#aebdd0"},
   {"k":"sky","n":"超高層ビル","use":"office","u":0,"g1":"shop","g2":"shop","z":"d","cpm":1100,"f0":30,"f1":60,"min":25,"max":400,"sh":["tower"],"cat":"biz","c":"#9fb3cc","fx":{"office":0.04,"shop":0.03}},
   {"k":"mall","n":"ショッピングセンター","use":"shop","u":200,"z":"cde","cpm":450,"f0":1,"f1":4,"min":20,"max":1600,"sh":["full","slab","ro"],"cat":"shop","c":"#e8d2b0","fx":{"shop":0.06}},
   {"k":"factory","n":"工場","use":"factory","one":true,"z":"ef","cpm":250,"f0":1,"f1":2,"min":10,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#b8b8b0","fx":{"home":-0.03}},
   {"k":"warehouse","n":"倉庫","use":"warehouse","one":true,"z":"efgk","cpm":200,"f0":1,"f1":3,"min":4,"max":800,"sh":["full","slab"],"cat":"logi","c":"#c2b59b"},
   {"k":"port","n":"港湾施設","use":"port","one":true,"z":"gk","cpm":500,"f0":1,"f1":1,"min":10,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#9ab3c0","opts":["ore","crude"]},
   {"k":"farm","n":"田畑","use":"farm","one":true,"z":"h","cpm":10,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#a9cf73","opts":["wheat"],"pat":"rows"},
   {"k":"parking","n":"駐車場","use":"parking","one":true,"z":"abcdefghk","cpm":30,"f0":0,"f1":0,"min":1,"max":400,"sh":["full"],"cat":"park","c":"#bdbdbd","pat":"lines"},
   {"k":"pkbld","n":"立体駐車場","use":"parking","u":0,"z":"bcdefk","cpm":400,"f0":2,"f1":8,"min":6,"max":400,"sh":["full","slab"],"cat":"park","c":"#b0b0b0"},
   {"k":"es","n":"小学校","use":"school","one":true,"z":"abcek","cpm":350,"f0":1,"f1":4,"min":10,"max":400,"sh":["full","slab","L","ko"],"sc":"es","cat":"school","c":"#d9b77e"},
   {"k":"jhs","n":"中学校","use":"school","one":true,"z":"abcek","cpm":350,"f0":1,"f1":4,"min":10,"max":400,"sh":["full","slab","L","ko"],"sc":"jhs","cat":"school","c":"#c9a16a"},
   {"k":"hs","n":"高校","use":"school","one":true,"z":"abcdek","cpm":400,"f0":1,"f1":6,"min":12,"max":600,"sh":["full","slab","L","ko"],"sc":"hs","cat":"school","c":"#b98e5e"},
   {"k":"univ","n":"大学","use":"school","one":true,"z":"abcdehk","cpm":500,"f0":1,"f1":20,"min":20,"max":1600,"sh":["full","slab","L","ko","ro","tower"],"sc":"univ","cat":"school","c":"#a65a46","fx":{"home":0.08,"shop":0.04}},
   {"k":"voc","n":"専門学校","use":"school","one":true,"z":"bcdek","cpm":600,"f0":2,"f1":15,"min":3,"max":200,"sh":["full","slab","tower"],"sc":"voc","cat":"school","c":"#b7a2c9"},
   {"k":"mill","n":"製粉工場","use":"factory","one":true,"z":"efgk","cpm":300,"f0":1,"f1":4,"min":10,"max":1600,"sh":["full","slab"],"mk":"flour","cat":"ind","c":"#d8c9a3"},
   {"k":"foodf","n":"食品工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":4,"min":10,"max":1600,"sh":["full","slab"],"mk":"food","cat":"ind","c":"#e3b98a"},
   {"k":"steelw","n":"製鉄所","use":"factory","one":true,"z":"fgk","cpm":400,"f0":1,"f1":3,"min":40,"max":1600,"sh":["full","slab"],"mk":"steel","cat":"ind","c":"#7d7f86","fx":{"home":-0.05}},
   {"k":"carf","n":"自動車工場","use":"factory","one":true,"z":"ef","cpm":350,"f0":1,"f1":3,"min":30,"max":1600,"sh":["full","slab"],"mk":"car","cat":"ind","c":"#9fb4c8"},
   {"k":"petro","n":"石油化学工場","use":"factory","one":true,"z":"fgk","cpm":450,"f0":1,"f1":3,"min":30,"max":1600,"sh":["full","slab"],"mk":"chem","cat":"ind","c":"#c7c2a0","fx":{"home":-0.05}},
   {"k":"elecf","n":"半導体・家電工場","use":"factory","one":true,"z":"ef","cpm":500,"f0":1,"f1":5,"min":10,"max":1600,"sh":["full","slab"],"mk":"elec","cat":"ind","c":"#b8d0d8"},
   {"k":"railf","n":"鉄道車両工場","use":"factory","one":true,"z":"ef","cpm":350,"f0":1,"f1":2,"min":30,"max":1600,"sh":["full","slab"],"mk":"railcar","cat":"ind","c":"#8f9e8a"},
   {"k":"hira","n":"平屋","use":"home","one":true,"z":"abcehik","cpm":280,"f0":1,"f1":1,"min":1,"max":8,"sh":["full","L"],"cat":"home","c":"#b9845a","dm":1.05},
   {"k":"nisetai","n":"二世帯住宅","use":"home","u":0,"z":"abcek","cpm":320,"f0":2,"f1":3,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#b77e57","rl":1.1,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"sankai","n":"三階建て住宅","use":"home","one":true,"z":"abcdek","cpm":330,"f0":3,"f1":3,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#a9704c","rl":1.05},
   {"k":"kyosho","n":"狭小住宅","use":"home","one":true,"z":"bcdek","cpm":360,"f0":2,"f1":3,"min":1,"max":2,"sh":["full"],"cat":"home","c":"#9b6a4e","rl":0.95,"dm":1.1},
   {"k":"kodate","n":"建売住宅","use":"home","one":true,"z":"abcek","cpm":270,"f0":2,"f1":2,"min":1,"max":4,"sh":["full","L"],"cat":"home","c":"#c98a5c","rl":0.95,"dm":1.1},
   {"k":"chumon","n":"注文住宅","use":"home","one":true,"z":"abcek","cpm":400,"f0":2,"f1":3,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#b5654a","rl":1.2,"dm":0.95},
   {"k":"eco","n":"エコハウス","use":"home","one":true,"z":"abcek","cpm":450,"f0":2,"f1":2,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#5d7f6a","rl":1.15},
   {"k":"yokan","n":"洋館","use":"home","one":true,"z":"abhik","cpm":650,"f0":2,"f1":3,"min":4,"max":20,"sh":["full","L","ko"],"cat":"home","c":"#8c5a4a","rl":1.6,"dm":0.75},
   {"k":"gotei","n":"豪邸","use":"home","one":true,"z":"abhik","cpm":900,"f0":1,"f1":3,"min":8,"max":40,"sh":["full","L","ko","ro"],"cat":"home","c":"#6b4b3a","rl":2.2,"dm":0.6},
   {"k":"wafu","n":"和風邸宅","use":"home","one":true,"z":"abhik","cpm":800,"f0":1,"f1":2,"min":6,"max":30,"sh":["full","L","ko"],"cat":"home","c":"#4f5a58","rl":1.9,"dm":0.65},
   {"k":"kominka","n":"古民家","use":"home","one":true,"z":"abhik","cpm":200,"f0":1,"f1":2,"min":3,"max":20,"sh":["full","L"],"cat":"home","c":"#6d5c48","rl":0.8,"dm":0.8},
   {"k":"machiya","n":"町家","use":"home","u":50,"g1":"shop","z":"bcdk","cpm":380,"f0":2,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#5b4636","rl":1.1},
   {"k":"log","n":"ログハウス","use":"home","one":true,"z":"ahik","cpm":300,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"home","c":"#9b6b3c","rl":1.1,"dm":0.7},
   {"k":"villa","n":"別荘","use":"home","one":true,"z":"hi","cpm":500,"f0":1,"f1":2,"min":4,"max":30,"sh":["full","L"],"cat":"home","c":"#7aa0a8","rl":1.5,"dm":0.5},
   {"k":"nagaya","n":"長屋","use":"home","u":35,"z":"abcek","cpm":250,"f0":1,"f1":2,"min":2,"max":12,"sh":["slab","full"],"cat":"home","c":"#7b6a58","rl":0.7,"dm":1.1,"dn":["{}長屋"]},
   {"k":"bunka","n":"文化住宅","use":"home","u":30,"z":"abcek","cpm":240,"f0":2,"f1":2,"min":2,"max":12,"sh":["full","slab"],"cat":"home","c":"#a08f78","rl":0.65,"dm":1.15,"dn":["{}文化","{}荘"]},
   {"k":"mokuapa","n":"木造アパート","use":"home","u":35,"z":"abcek","cpm":280,"f0":2,"f1":2,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#b39a7a","rl":0.85,"dm":1.05,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"tekkotsu","n":"鉄骨アパート","use":"home","u":40,"z":"abcek","cpm":340,"f0":2,"f1":3,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#9fa7ad","rl":0.95,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"gakusei","n":"学生アパート","use":"home","u":20,"z":"bcdek","cpm":320,"f0":2,"f1":4,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#a7b4bf","rl":0.8,"pp":1.2,"dn":["{}荘","コーポ{}"]},
   {"k":"designapa","n":"デザイナーズアパート","use":"home","u":45,"z":"abcdek","cpm":480,"f0":2,"f1":3,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#e8e3da","rl":1.35,"dm":0.9,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"share","n":"シェアハウス","use":"home","u":14,"z":"abcdek","cpm":360,"f0":2,"f1":3,"min":2,"max":8,"sh":["full"],"cat":"home","c":"#d1b48c","rl":0.9,"dm":1.1,"dn":["シェアハウス{}"]},
   {"k":"shataku","n":"社宅","use":"home","u":60,"z":"bcdek","cpm":450,"f0":3,"f1":6,"min":6,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#c8c2b5","rl":0.8,"dm":1.2,"dn":["{}社宅"]},
   {"k":"ryo","n":"社員寮","use":"home","u":18,"z":"bcdefk","cpm":400,"f0":2,"f1":6,"min":4,"max":40,"sh":["full","slab"],"cat":"home","c":"#bfb6a6","rl":0.6,"dm":1.2,"pp":1.2,"dn":["{}寮"]},
   {"k":"gakuryo","n":"学生寮","use":"home","u":16,"z":"abcdek","cpm":420,"f0":2,"f1":8,"min":4,"max":60,"sh":["full","slab"],"cat":"home","c":"#c4b9a3","rl":0.6,"pp":1.2,"dn":["{}学生寮"]},
   {"k":"senior","n":"高齢者向け住宅","use":"home","u":45,"z":"abcdek","cpm":600,"f0":2,"f1":6,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d6cbb8","rl":1.2,"dm":1.1,"pp":0.6,"dn":["{}シニアレジデンス"]},
   {"k":"danchi","n":"団地","use":"home","u":50,"z":"bcdek","cpm":420,"f0":4,"f1":5,"min":20,"max":600,"sh":["slab","L","full"],"cat":"home","c":"#d9d6cc","rl":0.75,"dm":1.15,"dn":["{}団地"]},
   {"k":"koei","n":"公営住宅","use":"home","u":55,"z":"bcdek","cpm":430,"f0":3,"f1":10,"min":10,"max":400,"sh":["slab","L","full"],"cat":"home","c":"#d2cfc4","rl":0.6,"dm":1.3,"dn":["{}住宅"]},
   {"k":"lowman","n":"低層マンション","use":"home","u":70,"z":"abcdek","cpm":600,"f0":2,"f1":4,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#e2ddd4","rl":1.15,"dm":0.95,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"midman","n":"中層マンション","use":"home","u":70,"z":"bcdek","cpm":620,"f0":5,"f1":9,"min":6,"max":100,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#dcd7ce","dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"highman","n":"高層マンション","use":"home","u":70,"z":"bcdk","cpm":700,"f0":10,"f1":19,"min":10,"max":160,"sh":["slab","L","full","tower"],"opt":["shop1"],"cat":"home","c":"#d5d9de","rl":1.05,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"luxman","n":"高級マンション","use":"home","u":110,"z":"abcdk","cpm":950,"f0":3,"f1":15,"min":8,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#c9c1b4","rl":1.7,"dm":0.75,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"designman","n":"デザイナーズマンション","use":"home","u":60,"z":"bcdk","cpm":800,"f0":3,"f1":10,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#ebe8e2","rl":1.35,"dm":0.9,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"petman","n":"ペット可マンション","use":"home","u":70,"z":"bcdek","cpm":650,"f0":3,"f1":10,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d8cfc0","rl":1.1,"dm":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"oneroom","n":"ワンルームマンション","use":"home","u":22,"z":"bcdk","cpm":650,"f0":3,"f1":12,"min":2,"max":40,"sh":["full","slab"],"cat":"home","c":"#cfd2d4","rl":1.0,"dm":1.15,"pp":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"family","n":"ファミリーマンション","use":"home","u":85,"z":"bcdek","cpm":620,"f0":4,"f1":14,"min":6,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#dfd8cb","dm":1.05,"pp":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"smartman","n":"スマートマンション","use":"home","u":65,"z":"bcdek","cpm":750,"f0":5,"f1":15,"min":6,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d2dbe0","rl":1.2,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"okushon","n":"億ション","use":"home","u":150,"z":"cd","cpm":1300,"f0":5,"f1":30,"min":10,"max":120,"sh":["slab","L","full","tower"],"cat":"home","c":"#b8ad9c","rl":2.6,"dm":0.55,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"servapa","n":"サービスアパートメント","use":"home","u":50,"z":"cd","cpm":900,"f0":5,"f1":20,"min":6,"max":80,"sh":["slab","full","tower"],"cat":"home","c":"#c7cdd2","rl":1.5,"dm":0.85,"dn":["{}サービスアパートメント"]},
   {"k":"supertower","n":"超高層マンション","use":"home","u":75,"z":"cd","cpm":1050,"f0":40,"f1":60,"min":30,"max":300,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#c4ccd6","rl":1.25,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"menshin","n":"免震タワーマンション","use":"home","u":75,"z":"cd","cpm":1150,"f0":25,"f1":50,"min":25,"max":300,"sh":["tower"],"cat":"home","c":"#bcc6d1","rl":1.35,"dm":0.95,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"stantower","n":"駅前タワーマンション","use":"home","u":70,"z":"cd","cpm":1000,"f0":25,"f1":45,"min":16,"max":200,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#c8d0d9","rl":1.2,"dm":1.1,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"tenpoman","n":"店舗つきマンション","use":"home","u":65,"g1":"shop","z":"bcdek","cpm":620,"f0":4,"f1":12,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d6cec2","rl":1.0,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"getaba","n":"下駄ばきアパート","use":"home","u":40,"g1":"shop","z":"bcdek","cpm":400,"f0":3,"f1":5,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#b7aa98","rl":0.9,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"kanban","n":"看板建築","use":"home","u":50,"g1":"shop","z":"bcdk","cpm":380,"f0":2,"f1":3,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#8a9a8a"},
   {"k":"shotennaga","n":"商店長屋","use":"home","u":40,"g1":"shop","z":"bcdk","cpm":300,"f0":2,"f1":2,"min":2,"max":12,"sh":["slab","full"],"cat":"home","c":"#8f7a62","rl":0.85,"dn":["{}長屋"]},
   {"k":"complexres","n":"複合マンション","use":"home","mix":[[0.15,"shop"],[0.4,"office"],[1,"home"]],"us":{"shop":60,"office":0,"home":70},"z":"cd","cpm":750,"f0":6,"f1":20,"min":8,"max":120,"sh":["slab","L","ko","ro","full","tower"],"cat":"home","c":"#d1d4d0","rl":1.05,"dn":["{}プレイス"]},
   {"k":"konbini","n":"コンビニ","use":"shop","one":true,"z":"abcdehk","cpm":300,"f0":1,"f1":1,"min":2,"max":12,"sh":["full"],"cat":"shop","c":"#f0f0ee","rl":1.1,"dm":1.2,"dn":["{}コンビニ"]},
   {"k":"super","n":"スーパー","use":"shop","one":true,"z":"bcdek","cpm":330,"f0":1,"f1":2,"min":10,"max":200,"sh":["full"],"cat":"shop","c":"#e9d8b4","rl":1.0,"dm":1.1,"fx":{"home":0.05},"dn":["{}スーパー"]},
   {"k":"bigsuper","n":"大型スーパー","use":"shop","one":true,"z":"cde","cpm":380,"f0":1,"f1":3,"min":40,"max":600,"sh":["full","slab"],"cat":"shop","c":"#e2cfa8","dm":1.0,"fx":{"home":0.06,"shop":0.03},"dn":["{}大型スーパー"]},
   {"k":"drug","n":"ドラッグストア","use":"shop","one":true,"z":"bcdek","cpm":320,"f0":1,"f1":2,"min":4,"max":60,"sh":["full"],"cat":"shop","c":"#e7eef2","dm":1.1,"dn":["{}ドラッグストア"]},
   {"k":"kaitenzushi","n":"回転寿司","use":"shop","one":true,"z":"bcdek","cpm":400,"f0":1,"f1":2,"min":4,"max":20,"sh":["full"],"cat":"shop","c":"#e4c9a8","rl":1.05,"dm":1.15,"dn":["{}回転寿司"]},
   {"k":"dollar","n":"100円ショップ","use":"shop","one":true,"z":"bcdek","cpm":320,"f0":1,"f1":2,"min":4,"max":40,"sh":["full"],"cat":"shop","c":"#f2e0c2","rl":0.85,"dm":1.25,"dn":["{}100円ショップ"]},
   {"k":"books","n":"書店","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":3,"min":2,"max":30,"sh":["full"],"cat":"shop","c":"#d8c6a6","rl":0.9,"dm":0.95,"dn":["{}書店"]},
   {"k":"kaden","n":"家電量販店","use":"shop","one":true,"z":"cde","cpm":420,"f0":1,"f1":6,"min":20,"max":400,"sh":["full","slab"],"cat":"shop","c":"#dfe4ea","fx":{"shop":0.03},"dn":["{}家電"]},
   {"k":"homecenter","n":"ホームセンター","use":"shop","one":true,"z":"cdef","cpm":280,"f0":1,"f1":2,"min":60,"max":1200,"sh":["full","slab"],"cat":"shop","c":"#e6d9c0","rl":0.8,"dm":1.1,"dn":["{}ホームセンター"]},
   {"k":"fashion","n":"衣料品店","use":"shop","one":true,"z":"bcdk","cpm":420,"f0":1,"f1":3,"min":2,"max":40,"sh":["full"],"cat":"shop","c":"#ead7da","rl":1.05,"dn":["{}衣料品店"]},
   {"k":"depart","n":"百貨店","use":"shop","u":300,"z":"cd","cpm":900,"f0":5,"f1":12,"min":60,"max":800,"sh":["full","slab"],"cat":"shop","c":"#d8c3a5","rl":1.3,"dm":0.95,"fx":{"shop":0.12,"office":0.04},"dn":["{}百貨店","{}デパート"]},
   {"k":"fashionbldg","n":"ファッションビル","use":"shop","u":60,"z":"cd","cpm":850,"f0":5,"f1":12,"min":10,"max":200,"sh":["full","slab","tower"],"cat":"shop","c":"#e3cfd6","rl":1.3,"dm":0.95,"fx":{"shop":0.06},"dn":["{}ファッションビル"]},
   {"k":"ekibiru","n":"駅ビル","use":"shop","mix":[[0.5,"shop"],[1,"office"]],"us":{"shop":80,"office":0},"z":"cd","cpm":850,"f0":3,"f1":12,"min":10,"max":200,"sh":["full","slab"],"cat":"shop","c":"#d6ccbd","rl":1.25,"dm":1.1,"fx":{"shop":0.08},"dn":["{}駅ビル"]},
   {"k":"famires","n":"ファミリーレストラン","use":"shop","one":true,"z":"bcdek","cpm":380,"f0":1,"f1":2,"min":4,"max":30,"sh":["full"],"cat":"shop","c":"#efc89a","dn":["{}ファミリーレストラン"]},
   {"k":"ramen","n":"ラーメン屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#d9a066","rl":1.1,"dm":1.1,"dn":["{}ラーメン屋"]},
   {"k":"soba","n":"そば屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#9c7a52","dn":["{}そば屋"]},
   {"k":"sushi","n":"寿司屋","use":"shop","one":true,"z":"bcdk","cpm":500,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#c9b08a","rl":1.4,"dm":0.85,"dn":["{}寿司屋"]},
   {"k":"kissa","n":"喫茶店","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#a47b55","rl":0.95,"dn":["{}喫茶店"]},
   {"k":"cafe","n":"カフェ","use":"shop","one":true,"z":"bcdk","cpm":450,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#b88a5e","rl":1.2,"dn":["{}カフェ"]},
   {"k":"izakaya","n":"居酒屋","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"cat":"shop","c":"#a8613e","rl":1.05,"dm":1.05,"dn":["{}居酒屋"]},
   {"k":"yakiniku","n":"焼肉店","use":"shop","one":true,"z":"bcdk","cpm":420,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"shop","c":"#8f4a35","rl":1.15,"dn":["{}焼肉店"]},
   {"k":"fastfood","n":"ファストフード店","use":"shop","one":true,"z":"bcdek","cpm":400,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"shop","c":"#e9b44c","rl":1.05,"dm":1.15,"dn":["{}ファストフード店"]},
   {"k":"bakery","n":"パン屋","use":"shop","one":true,"z":"abcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#dcb07a","dn":["{}パン屋"]},
   {"k":"cake","n":"ケーキ屋","use":"shop","one":true,"z":"abcdk","cpm":420,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#efd1d6","rl":1.15,"dm":0.9,"dn":["{}ケーキ屋"]},
   {"k":"wagashi","n":"和菓子屋","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#b98f7a","dn":["{}和菓子屋"]},
   {"k":"flower","n":"花屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":1,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#e6b8c8","rl":0.9,"dn":["{}花屋"]},
   {"k":"yaoya","n":"八百屋","use":"shop","one":true,"z":"bcdk","cpm":280,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#9fbf6f","rl":0.85,"dm":1.05,"dn":["{}八百屋"]},
   {"k":"sakanaya","n":"魚屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#8fb3c4","rl":0.85,"dn":["{}魚屋"]},
   {"k":"nikuya","n":"肉屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#c47f74","rl":0.85,"dn":["{}肉屋"]},
   {"k":"sakaya","n":"酒屋","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#a3866a","rl":0.95,"dn":["{}酒屋"]},
   {"k":"zakka","n":"雑貨店","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#e0cdb5","rl":1.05,"dn":["{}雑貨店"]},
   {"k":"stationery","n":"文房具店","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#c8cfd8","rl":0.85,"dn":["{}文房具店"]},
   {"k":"toy","n":"おもちゃ屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"cat":"shop","c":"#f0c56a","rl":0.95,"dn":["{}おもちゃ屋"]},
   {"k":"megane","n":"メガネ・時計店","use":"shop","one":true,"z":"bcdk","cpm":450,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#b9c2cc","rl":1.2,"dm":0.85,"dn":["{}メガネ・時計店"]},
   {"k":"bicycle","n":"自転車店","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#9fb6a0","rl":0.9,"dn":["{}自転車店"]},
   {"k":"furuhon","n":"古本屋","use":"shop","one":true,"z":"bcdk","cpm":280,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#a69276","rl":0.8,"dn":["{}古本屋"]},
   {"k":"shichiya","n":"質屋","use":"shop","one":true,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#8d8476","rl":1.1,"dm":0.8,"dn":["{}質屋"]},
   {"k":"pharmacy","n":"調剤薬局","use":"shop","one":true,"z":"abcdek","cpm":380,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#dfeaf0","rl":1.1,"dm":1.05,"dn":["{}調剤薬局"]},
   {"k":"biyou","n":"美容室","use":"shop","one":true,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#e9c9d3","rl":1.05,"dn":["{}美容室"]},
   {"k":"riyou","n":"理容室","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#c2d0e0","rl":0.85,"dn":["{}理容室"]},
   {"k":"cleaning","n":"クリーニング店","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#d3e2ea","rl":0.85,"dn":["{}クリーニング店"]},
   {"k":"dealer","n":"カーディーラー","use":"shop","one":true,"z":"cdef","cpm":450,"f0":1,"f1":2,"min":10,"max":100,"sh":["full"],"cat":"shop","c":"#c9d4de","rl":1.3,"dm":0.8,"dn":["{}自動車販売"]},
   {"k":"gas","n":"ガソリンスタンド","use":"shop","one":true,"z":"bcdefghk","cpm":350,"f0":1,"f1":1,"min":6,"max":40,"sh":["full"],"cat":"shop","c":"#e4dfcf","rl":1.0,"dn":["{}給油所"]},
   {"k":"arcadeshop","n":"商店街（アーケード）","use":"shop","u":40,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":6,"max":120,"sh":["slab","full"],"cat":"shop","c":"#d9c3a1","rl":0.95,"dm":1.1,"fx":{"shop":0.05},"dn":["{}商店街"]},
   {"k":"outlet","n":"アウトレットモール","use":"shop","u":120,"z":"cdeh","cpm":400,"f0":1,"f1":2,"min":200,"max":1600,"sh":["full","slab","ro"],"cat":"shop","c":"#e7d6bd","rl":0.9,"fx":{"hotel":0.05},"dn":["{}アウトレット"]},
   {"k":"michinoeki","n":"道の駅","use":"shop","u":60,"z":"hi","cpm":300,"f0":1,"f1":1,"min":20,"max":400,"sh":["full","slab"],"cat":"shop","c":"#cdb98f","rl":0.8,"dm":1.2,"dn":["道の駅 {}"]},
   {"k":"ichiba","n":"市場","use":"shop","u":25,"z":"cdegk","cpm":250,"f0":1,"f1":1,"min":10,"max":200,"sh":["full","slab"],"cat":"shop","c":"#c9b48e","rl":0.8,"dm":1.15,"dn":["{}市場"]},
   {"k":"yatai","n":"屋台村","use":"shop","u":12,"z":"bcdk","cpm":200,"f0":1,"f1":1,"min":4,"max":60,"sh":["full"],"cat":"shop","c":"#b7865c","rl":0.75,"dm":1.2,"dn":["{}屋台村"]},
   {"k":"smalloffice","n":"小さなオフィスビル","use":"office","u":0,"z":"cde","cpm":600,"f0":3,"f1":6,"min":2,"max":20,"sh":["full","slab"],"cat":"biz","c":"#b9c4cf","rl":0.9,"dn":["{}ビル"]},
   {"k":"pencil","n":"ペンシルビル","use":"office","u":0,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":12,"min":1,"max":4,"sh":["full"],"cat":"biz","c":"#c0c8d0","rl":0.95,"dn":["{}ビル"]},
   {"k":"midoffice","n":"中規模オフィスビル","use":"office","u":0,"z":"cd","cpm":820,"f0":8,"f1":20,"min":10,"max":160,"sh":["full","slab","L"],"cat":"biz","c":"#aab8c8","dn":["{}ビル","{}センタービル"]},
   {"k":"bigoffice","n":"大規模オフィスビル","use":"office","u":0,"z":"d","cpm":900,"f0":15,"f1":35,"min":40,"max":400,"sh":["full","slab","L","tower"],"opt":["shop1"],"cat":"biz","c":"#a2b2c5","rl":1.1,"dn":["{}センタービル","{}ビルディング"]},
   {"k":"hq","n":"本社ビル","use":"office","u":0,"z":"cd","cpm":1000,"f0":10,"f1":40,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#8fa2b8","rl":1.25,"dm":0.9,"dn":["{}本社ビル"]},
   {"k":"intelligent","n":"インテリジェントビル","use":"office","u":0,"z":"cd","cpm":1150,"f0":10,"f1":40,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#9cb6cc","rl":1.35,"dm":0.95,"dn":["{}インテリジェントビル"]},
   {"k":"skyoffice","n":"超高層オフィスビル","use":"office","u":0,"g1":"shop","g2":"shop","z":"d","cpm":1300,"f0":40,"f1":70,"min":40,"max":600,"sh":["tower"],"cat":"biz","c":"#8ea8c4","rl":1.3,"fx":{"office":0.05,"shop":0.04},"dn":["{}タワー","{}スカイタワー"]},
   {"k":"complex","n":"複合ビル","use":"office","u":0,"mix":[[0.25,"shop"],[1,"office"]],"us":{"shop":60,"office":0},"z":"cd","cpm":900,"f0":6,"f1":25,"min":8,"max":200,"sh":["full","slab","tower"],"cat":"biz","c":"#b3bfca","rl":1.1,"dn":["{}スクエア"]},
   {"k":"it","n":"ITオフィス","use":"office","u":0,"z":"cd","cpm":850,"f0":5,"f1":20,"min":6,"max":120,"sh":["full","slab"],"cat":"biz","c":"#a8c3cf","rl":1.1,"dm":1.1,"pp":1.2,"dn":["{}ITオフィス"]},
   {"k":"startup","n":"スタートアップビル","use":"office","u":30,"z":"cd","cpm":650,"f0":3,"f1":8,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#bccad0","rl":0.95,"dm":1.15,"dn":["{}スタートアップビル"]},
   {"k":"coworking","n":"コワーキングスペース","use":"office","u":20,"z":"cd","cpm":700,"f0":2,"f1":8,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#c7d3d8","rl":1.15,"dm":1.05,"pp":1.3,"dn":["{}コワーキングスペース"]},
   {"k":"rentalmtg","n":"貸会議室ビル","use":"office","u":40,"z":"cd","cpm":700,"f0":3,"f1":12,"min":2,"max":60,"sh":["full","slab"],"cat":"biz","c":"#bdc6cf","dn":["{}貸会議室ビル"]},
   {"k":"lawoffice","n":"法律事務所ビル","use":"office","u":60,"z":"cd","cpm":750,"f0":3,"f1":10,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#a9b1bb","rl":1.15,"dn":["{}法律事務所ビル"]},
   {"k":"ad","n":"広告代理店ビル","use":"office","u":0,"z":"cd","cpm":950,"f0":6,"f1":25,"min":10,"max":200,"sh":["full","slab","tower"],"cat":"biz","c":"#b6a9c4","rl":1.2,"dn":["{}広告代理店ビル"]},
   {"k":"publisher","n":"出版社","use":"office","u":0,"z":"cd","cpm":800,"f0":4,"f1":12,"min":4,"max":80,"sh":["full","slab"],"cat":"biz","c":"#b5b0a5","dn":["{}出版"]},
   {"k":"newspaper","n":"新聞社","use":"office","u":0,"z":"cd","cpm":900,"f0":6,"f1":20,"min":10,"max":200,"sh":["full","slab"],"cat":"biz","c":"#a7a39a","rl":1.05,"dn":["{}新聞社"]},
   {"k":"tvstation","n":"放送局","use":"office","u":0,"z":"cd","cpm":1100,"f0":5,"f1":30,"min":40,"max":600,"sh":["full","slab","tower"],"cat":"biz","c":"#9bb0c6","rl":1.3,"dm":0.8,"fx":{"office":0.05},"dn":["{}放送センター"]},
   {"k":"bankhq","n":"銀行の本店","use":"office","u":0,"z":"cd","cpm":1150,"f0":8,"f1":30,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#94a1ad","rl":1.35,"dm":0.85,"fx":{"office":0.05},"dn":["{}銀行本店"]},
   {"k":"bankbranch","n":"銀行の支店","use":"office","u":0,"z":"bcdk","cpm":800,"f0":2,"f1":5,"min":2,"max":30,"sh":["full"],"cat":"biz","c":"#a5b0ba","rl":1.1,"dn":["{}支店"]},
   {"k":"shinkin","n":"信用金庫","use":"office","u":0,"z":"bcdk","cpm":700,"f0":2,"f1":4,"min":2,"max":30,"sh":["full"],"cat":"biz","c":"#a9b6b0","dn":["{}信用金庫"]},
   {"k":"securities","n":"証券会社","use":"office","u":0,"z":"cd","cpm":1000,"f0":6,"f1":25,"min":6,"max":160,"sh":["full","slab"],"cat":"biz","c":"#9eaabd","rl":1.25,"dn":["{}証券ビル"]},
   {"k":"insurance","n":"保険会社","use":"office","u":0,"z":"cd","cpm":950,"f0":8,"f1":30,"min":10,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#a3b4c0","rl":1.1,"dn":["{}生命ビル"]},
   {"k":"postoffice","n":"郵便局","use":"office","u":0,"z":"abcdek","cpm":600,"f0":1,"f1":4,"min":4,"max":60,"sh":["full","slab"],"cat":"biz","c":"#d98a7a","rl":0.9,"dm":1.2,"dn":["{}郵便局"]},
   {"k":"travel","n":"旅行代理店ビル","use":"office","u":0,"z":"cd","cpm":700,"f0":2,"f1":6,"min":2,"max":30,"sh":["full","slab"],"cat":"biz","c":"#b9cbd6","rl":0.95,"fx":{"hotel":0.03},"dn":["{}旅行代理店ビル"]},
   {"k":"lab","n":"研究所","use":"office","u":0,"z":"cdef","cpm":750,"f0":2,"f1":8,"min":20,"max":800,"sh":["full","slab"],"cat":"biz","c":"#b7c2b7","rl":0.9,"dm":1.05,"dn":["{}研究所"]},
   {"k":"datacenter","n":"データセンター","use":"office","u":0,"z":"cdef","cpm":1100,"f0":2,"f1":6,"min":20,"max":600,"sh":["full","slab"],"cat":"biz","c":"#7f8d99","rl":1.2,"dm":1.1,"pp":0.1,"dn":["{}データセンター"]},
   {"k":"callcenter","n":"コールセンター","use":"office","u":0,"z":"cde","cpm":650,"f0":3,"f1":10,"min":10,"max":200,"sh":["full","slab"],"cat":"biz","c":"#b0bcc8","rl":0.85,"dm":1.1,"pp":1.5,"dn":["{}コールセンター"]},
   {"k":"bizhotel","n":"ビジネスホテル","use":"hotel","one":true,"z":"cde","cpm":700,"f0":5,"f1":15,"min":3,"max":60,"sh":["full","slab","tower"],"sc":"bizhotel","cat":"hotel","c":"#c9b9a8","dn":["ホテル{}","{}ホテル"]},
   {"k":"stahotel","n":"駅前ホテル","use":"hotel","one":true,"z":"cd","cpm":750,"f0":6,"f1":20,"min":4,"max":80,"sh":["full","slab","tower"],"sc":"stahotel","cat":"hotel","c":"#c2b4a4","dn":["{}駅前ホテル"]},
   {"k":"cityhotel","n":"シティホテル","use":"hotel","one":true,"z":"cd","cpm":900,"f0":8,"f1":30,"min":20,"max":300,"sh":["full","slab","L","tower"],"sc":"cityhotel","cat":"hotel","c":"#b8a48c","dn":["{}シティホテル","ホテル{}"]},
   {"k":"luxhotel","n":"高級ホテル","use":"hotel","one":true,"z":"cd","cpm":1400,"f0":10,"f1":50,"min":30,"max":400,"sh":["tower","full","slab"],"sc":"luxhotel","cat":"hotel","c":"#a38d6f","fx":{"shop":0.04},"dn":["ホテル{}","グランドホテル{}"]},
   {"k":"resort","n":"リゾートホテル","use":"hotel","one":true,"z":"abhik","cpm":900,"f0":3,"f1":15,"min":40,"max":1600,"sh":["slab","L","ko","full"],"sc":"resort","cat":"hotel","c":"#d6c6a2","fx":{"shop":0.03},"dn":["{}リゾートホテル"]},
   {"k":"ryokan","n":"旅館","use":"hotel","one":true,"z":"abchik","cpm":650,"f0":1,"f1":4,"min":6,"max":200,"sh":["L","ko","full"],"sc":"ryokan","cat":"hotel","c":"#6f6658","dn":["旅館 {}","{}旅館"]},
   {"k":"onsenryokan","n":"温泉旅館","use":"hotel","one":true,"z":"hi","cpm":800,"f0":2,"f1":8,"min":10,"max":400,"sh":["L","ko","full"],"sc":"onsenryokan","cat":"hotel","c":"#5f5a52","dn":["{}温泉旅館"]},
   {"k":"minshuku","n":"民宿","use":"hotel","one":true,"z":"abhik","cpm":350,"f0":1,"f1":3,"min":2,"max":30,"sh":["full","L"],"sc":"minshuku","cat":"hotel","c":"#8c7a62","dn":["民宿 {}"]},
   {"k":"pension","n":"ペンション","use":"hotel","one":true,"z":"ahik","cpm":450,"f0":2,"f1":3,"min":3,"max":30,"sh":["full","L"],"sc":"pension","cat":"hotel","c":"#b5876a","dn":["ペンション {}"]},
   {"k":"capsule","n":"カプセルホテル","use":"hotel","one":true,"z":"cd","cpm":650,"f0":3,"f1":10,"min":1,"max":20,"sh":["full"],"sc":"capsule","cat":"hotel","c":"#b9c0c6","dn":["{}カプセルホテル"]},
   {"k":"guesthouse","n":"ゲストハウス","use":"hotel","one":true,"z":"bcdk","cpm":400,"f0":2,"f1":4,"min":1,"max":10,"sh":["full"],"sc":"guesthouse","cat":"hotel","c":"#c4a98a","dn":["ゲストハウス {}"]},
   {"k":"condo","n":"コンドミニアム","use":"hotel","one":true,"z":"cdh","cpm":900,"f0":5,"f1":30,"min":10,"max":200,"sh":["slab","L","tower","full"],"sc":"condo","cat":"hotel","c":"#cbc3b3","dn":["{}コンドミニアム"]},
   {"k":"clinic","n":"診療所","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":4,"min":1,"max":10,"sh":["full"],"sc":"clinic","cat":"med","c":"#e3ecef","dn":["{}クリニック"]},
   {"k":"dental","n":"歯科医院","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"sc":"dental","cat":"med","c":"#e9f0f2","dn":["{}歯科医院"]},
   {"k":"pedi","n":"小児科医院","use":"hospital","one":true,"z":"abcdek","cpm":550,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"sc":"pedi","cat":"med","c":"#f0e7d8","fx":{"home":0.03},"dn":["{}こどもクリニック"]},
   {"k":"eye","n":"眼科","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"sc":"eye","cat":"med","c":"#dfe8ef","dn":["{}眼科"]},
   {"k":"vet","n":"動物病院","use":"hospital","one":true,"z":"abcdek","cpm":550,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"sc":"vet","cat":"med","c":"#e2ead9","dn":["{}動物病院"]},
   {"k":"obgyn","n":"産婦人科","use":"hospital","one":true,"z":"bcdek","cpm":800,"f0":2,"f1":6,"min":4,"max":40,"sh":["full","slab"],"sc":"obgyn","cat":"med","c":"#f0dfe2","dn":["{}レディースクリニック"]},
   {"k":"hospital","n":"総合病院","use":"hospital","one":true,"z":"bcdek","cpm":1000,"f0":4,"f1":15,"min":30,"max":600,"sh":["full","slab","L","tower"],"sc":"hospital","cat":"med","c":"#e8eef2","fx":{"home":0.05,"shop":0.03},"dn":["{}総合病院"]},
   {"k":"erhosp","n":"救急病院","use":"hospital","one":true,"z":"bcdek","cpm":1100,"f0":4,"f1":12,"min":20,"max":400,"sh":["full","slab","L"],"sc":"erhosp","cat":"med","c":"#e6e1e1","fx":{"home":0.04},"dn":["{}救急病院"]},
   {"k":"bighosp","n":"大病院","use":"hospital","one":true,"z":"bcdehk","cpm":1200,"f0":8,"f1":30,"min":80,"max":1600,"sh":["full","slab","L","ko","tower"],"sc":"bighosp","cat":"med","c":"#dfe7ec","fx":{"home":0.06,"shop":0.04},"dn":["{}医療センター"]},
   {"k":"nursing","n":"老人ホーム","use":"hospital","one":true,"z":"abcdehk","cpm":600,"f0":2,"f1":8,"min":6,"max":200,"sh":["full","slab","L"],"sc":"nursing","cat":"med","c":"#e4dccd","dn":["{}老人ホーム"]},
   {"k":"care","n":"介護施設","use":"hospital","one":true,"z":"abcdehk","cpm":550,"f0":1,"f1":4,"min":4,"max":120,"sh":["full","slab","L"],"sc":"care","cat":"med","c":"#ded7c8","dn":["{}介護センター"]},
   {"k":"dayserv","n":"デイサービスセンター","use":"hospital","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":2,"max":30,"sh":["full"],"sc":"dayserv","cat":"med","c":"#e8e0cf","dn":["デイサービス{}"]},
   {"k":"cinema","n":"映画館","use":"leisure","one":true,"z":"cde","cpm":800,"f0":2,"f1":8,"min":10,"max":200,"sh":["full","slab"],"sc":"cinema","cat":"fun","c":"#5c5f6e","dn":["{}シネマ"]},
   {"k":"theater","n":"劇場","use":"leisure","one":true,"z":"cd","cpm":1000,"f0":3,"f1":10,"min":20,"max":300,"sh":["full","slab"],"sc":"theater","cat":"fun","c":"#8a4f45","fx":{"shop":0.03},"dn":["{}劇場"]},
   {"k":"hall","n":"コンサートホール","use":"leisure","one":true,"z":"cd","cpm":1000,"f0":3,"f1":10,"min":20,"max":400,"sh":["full","slab"],"sc":"hall","cat":"fun","c":"#9b7b63","dn":["{}ホール"]},
   {"k":"livehouse","n":"ライブハウス","use":"leisure","one":true,"z":"cd","cpm":600,"f0":1,"f1":4,"min":2,"max":20,"sh":["full"],"sc":"livehouse","cat":"fun","c":"#4f4a55","dn":["ライブハウス{}"]},
   {"k":"bowling","n":"ボウリング場","use":"leisure","one":true,"z":"cde","cpm":500,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"bowling","cat":"fun","c":"#c96d5a","dn":["{}ボウル"]},
   {"k":"arcade","n":"ゲームセンター","use":"leisure","one":true,"z":"cd","cpm":550,"f0":1,"f1":4,"min":2,"max":60,"sh":["full"],"sc":"arcade","cat":"fun","c":"#d77fb0","dn":["ゲーム{}"]},
   {"k":"karaoke","n":"カラオケ店","use":"leisure","one":true,"z":"cd","cpm":600,"f0":2,"f1":8,"min":2,"max":40,"sh":["full"],"sc":"karaoke","cat":"fun","c":"#c98bd6","dn":["カラオケ{}"]},
   {"k":"pachinko","n":"パチンコ店","use":"leisure","one":true,"z":"cde","cpm":600,"f0":1,"f1":3,"min":6,"max":120,"sh":["full","slab"],"sc":"pachinko","cat":"fun","c":"#e3a83a","fx":{"home":-0.03},"dn":["{}ホール"]},
   {"k":"kbshop","n":"場外馬券売り場","use":"leisure","one":true,"z":"cdef","cpm":700,"f0":2,"f1":8,"min":20,"max":400,"sh":["full","slab"],"sc":"kbshop","cat":"fun","c":"#5f8a62","fx":{"shop":0.03},"dn":["{}場外馬券売り場"]},
   {"k":"batting","n":"バッティングセンター","use":"leisure","one":true,"z":"cdefh","cpm":300,"f0":1,"f1":1,"min":10,"max":120,"sh":["full"],"sc":"batting","cat":"fun","c":"#7fae7a","dn":["{}バッティングセンター"]},
   {"k":"sportsclub","n":"スポーツクラブ","use":"leisure","one":true,"z":"bcdk","cpm":700,"f0":2,"f1":6,"min":4,"max":80,"sh":["full","slab"],"sc":"sportsclub","cat":"fun","c":"#7aa3c8","dn":["{}スポーツクラブ"]},
   {"k":"pool","n":"屋内プール","use":"leisure","one":true,"z":"bcdek","cpm":800,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"pool","cat":"fun","c":"#7cc2d8","dn":["{}プール"]},
   {"k":"skate","n":"スケートリンク","use":"leisure","one":true,"z":"cde","cpm":800,"f0":1,"f1":2,"min":20,"max":200,"sh":["full","slab"],"sc":"skate","cat":"fun","c":"#a9d4e6","dn":["{}スケートリンク"]},
   {"k":"superonsen","n":"スーパー銭湯","use":"leisure","one":true,"z":"cdeh","cpm":600,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"superonsen","cat":"fun","c":"#b78d6c","dn":["{}の湯"]},
   {"k":"sento","n":"銭湯","use":"leisure","one":true,"z":"abcdek","cpm":400,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"sc":"sento","cat":"fun","c":"#7d9bb0","dn":["{}湯"]},
   {"k":"wedding","n":"結婚式場","use":"leisure","one":true,"z":"bcdhk","cpm":1000,"f0":2,"f1":6,"min":10,"max":200,"sh":["full","L","ko"],"sc":"wedding","cat":"fun","c":"#efe6da","dn":["{}迎賓館","{}会館"]},
   {"k":"arena","n":"アリーナ","use":"leisure","one":true,"z":"cde","cpm":900,"f0":2,"f1":5,"min":60,"max":800,"sh":["full","ro"],"sc":"arena","cat":"fun","c":"#a7b0b8","fx":{"shop":0.04,"hotel":0.04},"dn":["{}アリーナ"]},
   {"k":"baseball","n":"野球場","use":"leisure","one":true,"z":"cdeh","cpm":700,"f0":1,"f1":2,"min":300,"max":1600,"sh":["ro","full"],"sc":"baseball","cat":"fun","c":"#6fa35a","fx":{"shop":0.05,"hotel":0.05},"dn":["{}球場","{}スタジアム"]},
   {"k":"soccer","n":"サッカースタジアム","use":"leisure","one":true,"z":"cdeh","cpm":700,"f0":1,"f1":2,"min":300,"max":1600,"sh":["ro","full"],"sc":"soccer","cat":"fun","c":"#5f9a62","fx":{"shop":0.05,"hotel":0.05},"dn":["{}スタジアム"]},
   {"k":"convention","n":"展示場","use":"leisure","one":true,"z":"cdefgk","cpm":700,"f0":1,"f1":4,"min":100,"max":1600,"sh":["full","slab"],"sc":"convention","cat":"fun","c":"#b7c0c9","fx":{"hotel":0.12,"shop":0.04},"dn":["{}国際展示場","{}メッセ"]},
   {"k":"aquarium","n":"水族館","use":"leisure","one":true,"z":"cdgk","cpm":1200,"f0":2,"f1":5,"min":30,"max":400,"sh":["full","slab","L"],"sc":"aquarium","cat":"fun","c":"#5f9fc2","fx":{"hotel":0.08},"dn":["{}水族館"]},
   {"k":"artmuseum","n":"美術館","use":"leisure","one":true,"z":"abcdek","cpm":1100,"f0":2,"f1":5,"min":20,"max":400,"sh":["full","L","ko"],"sc":"artmuseum","cat":"fun","c":"#d0c8bc","dn":["{}美術館"]},
   {"k":"museum","n":"博物館","use":"leisure","one":true,"z":"abcdek","cpm":1000,"f0":2,"f1":6,"min":20,"max":400,"sh":["full","L","ko"],"sc":"museum","cat":"fun","c":"#bcb3a4","dn":["{}博物館"]},
   {"k":"science","n":"科学館","use":"leisure","one":true,"z":"bcdek","cpm":1000,"f0":2,"f1":5,"min":20,"max":300,"sh":["full","L"],"sc":"science","cat":"fun","c":"#a7bccb","dn":["{}科学館"]},
   {"k":"shrine","n":"神社","use":"leisure","one":true,"z":"abcdehik","cpm":600,"f0":1,"f1":1,"min":4,"max":400,"sh":["full","L"],"sc":"shrine","cat":"fun","c":"#c0392b","dn":["{}神社"]},
   {"k":"temple","n":"寺","use":"leisure","one":true,"z":"abcdehik","cpm":700,"f0":1,"f1":2,"min":6,"max":600,"sh":["full","L","ko"],"sc":"temple","cat":"fun","c":"#5a5550","dn":["{}寺","{}院"]},
   {"k":"church","n":"教会","use":"leisure","one":true,"z":"abcdek","cpm":800,"f0":1,"f1":3,"min":2,"max":60,"sh":["full"],"sc":"church","cat":"fun","c":"#d9d4cc","dn":["{}教会"]},
   {"k":"golfrange","n":"ゴルフ練習場","use":"leisure","one":true,"z":"cdefh","cpm":120,"f0":0,"f1":0,"min":40,"max":600,"sh":["full"],"sc":"golfrange","cat":"fun","c":"#86bf6a","pat":"lawn","dn":["{}ゴルフガーデン"]},
   {"k":"golf","n":"ゴルフ場","use":"leisure","one":true,"z":"hi","cpm":60,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"golf","cat":"fun","c":"#78b05e","fx":{"hotel":0.05},"pat":"golf","dn":["{}カントリークラブ"]},
   {"k":"tennis","n":"テニスコート","use":"leisure","one":true,"z":"abcdehk","cpm":100,"f0":0,"f1":0,"min":6,"max":200,"sh":["full"],"sc":"tennis","cat":"fun","c":"#5f9e6e","pat":"court","dn":["{}テニスクラブ"]},
   {"k":"athletics","n":"陸上競技場","use":"leisure","one":true,"z":"bcdehk","cpm":200,"f0":0,"f1":0,"min":200,"max":1600,"sh":["full"],"sc":"athletics","cat":"fun","c":"#93c56a","pat":"track","dn":["{}陸上競技場"]},
   {"k":"amuse","n":"遊園地","use":"leisure","one":true,"z":"cdeh","cpm":300,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"amuse","cat":"fun","c":"#e6c3d6","fx":{"hotel":0.15,"shop":0.04},"pat":"amuse","dn":["{}ランド","{}遊園地"]},
   {"k":"tpark","n":"テーマパーク","use":"leisure","one":true,"z":"cdefgh","cpm":500,"f0":0,"f1":0,"min":3000,"max":10000,"sh":["full"],"sc":"tpark","cat":"fun","c":"#efc7de","fx":{"hotel":0.3,"shop":0.08},"pat":"tpark","dn":["{}ランド","{}パーク"]},
   {"k":"zoo","n":"動物園","use":"leisure","one":true,"z":"abcdehk","cpm":150,"f0":0,"f1":0,"min":200,"max":1600,"sh":["full"],"sc":"zoo","cat":"fun","c":"#a9c98a","fx":{"hotel":0.06},"pat":"trees","dn":["{}動物園"]},
   {"k":"botanical","n":"植物園","use":"leisure","one":true,"z":"abcdehk","cpm":100,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"botanical","cat":"fun","c":"#9fcf8f","pat":"trees","dn":["{}植物園"]},
   {"k":"camp","n":"キャンプ場","use":"leisure","one":true,"z":"hi","cpm":30,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"camp","cat":"fun","c":"#7fb070","pat":"trees","dn":["{}キャンプ場"]},
   {"k":"fishing","n":"釣り堀","use":"leisure","one":true,"z":"cdeh","cpm":80,"f0":0,"f1":0,"min":10,"max":200,"sh":["full"],"sc":"fishing","cat":"fun","c":"#7fb8d4","pat":"water","dn":["{}釣り堀"]},
   {"k":"ski","n":"スキー場","use":"leisure","one":true,"z":"i","cpm":80,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"ski","cat":"fun","c":"#eef3f6","fx":{"hotel":0.1},"pat":"snow","dn":["{}スキー場"]},
   {"k":"nursery","n":"保育園","use":"school","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":2,"max":20,"sh":["full","L"],"sc":"nursery","cat":"school","c":"#f2d49b","fx":{"home":0.03},"dn":["{}保育園"]},
   {"k":"kinder","n":"幼稚園","use":"school","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":3,"max":30,"sh":["full","L"],"sc":"kinder","cat":"school","c":"#f5c98a","fx":{"home":0.03},"dn":["{}幼稚園"]},
   {"k":"esjhs","n":"小中一貫校","use":"school","one":true,"z":"abcek","cpm":380,"f0":2,"f1":5,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"esjhs","cat":"school","c":"#d4b07a","fx":{"home":0.04},"dn":["{}学園"]},
   {"k":"jhshs","n":"中高一貫校","use":"school","one":true,"z":"abcdek","cpm":420,"f0":2,"f1":6,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"jhshs","cat":"school","c":"#b9935f","dn":["{}学院","{}学園"]},
   {"k":"techhs","n":"工業高校","use":"school","one":true,"z":"bcdefk","cpm":400,"f0":2,"f1":5,"min":30,"max":800,"sh":["full","slab","L"],"sc":"techhs","cat":"school","c":"#a98e6c","dn":["{}工業高校"]},
   {"k":"comhs","n":"商業高校","use":"school","one":true,"z":"bcdek","cpm":400,"f0":2,"f1":5,"min":20,"max":600,"sh":["full","slab","L"],"sc":"comhs","cat":"school","c":"#b49a72","dn":["{}商業高校"]},
   {"k":"jc","n":"短期大学","use":"school","one":true,"z":"abcdek","cpm":500,"f0":2,"f1":8,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"jc","cat":"school","c":"#b07a5e","dn":["{}短期大学"]},
   {"k":"cram","n":"学習塾","use":"school","one":true,"z":"bcdk","cpm":500,"f0":2,"f1":5,"min":1,"max":10,"sh":["full"],"sc":"cram","cat":"school","c":"#c8b3d6","dn":["{}ゼミナール"]},
   {"k":"prep","n":"予備校","use":"school","one":true,"z":"cd","cpm":650,"f0":4,"f1":12,"min":4,"max":60,"sh":["full","slab"],"sc":"prep","cat":"school","c":"#b2a3c9","dn":["{}予備校"]},
   {"k":"eikaiwa","n":"英会話教室","use":"school","one":true,"z":"bcdk","cpm":500,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"sc":"eikaiwa","cat":"school","c":"#a9c3df","dn":["{}英会話スクール"]},
   {"k":"music","n":"音楽学校","use":"school","one":true,"z":"bcdek","cpm":700,"f0":2,"f1":6,"min":6,"max":100,"sh":["full","slab","L"],"sc":"music","cat":"school","c":"#c7a9b8","dn":["{}音楽学院"]},
   {"k":"cook","n":"調理師学校","use":"school","one":true,"z":"bcdek","cpm":650,"f0":2,"f1":6,"min":4,"max":80,"sh":["full","slab"],"sc":"cook","cat":"school","c":"#d9b48f","dn":["{}調理師学校"]},
   {"k":"driving","n":"自動車教習所","use":"school","one":true,"z":"cdefh","cpm":80,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"driving","cat":"school","c":"#c9c9c9","pat":"course","dn":["{}自動車教習所"]},
   {"k":"machikoba","n":"町工場","use":"factory","one":true,"z":"bcefk","cpm":220,"f0":1,"f1":2,"min":1,"max":10,"sh":["full","slab"],"cat":"ind","c":"#a9a49a","rl":0.9,"dm":1.1,"fx":{"home":-0.02},"dn":["{}製作所"]},
   {"k":"print","n":"印刷工場","use":"factory","one":true,"z":"cef","cpm":280,"f0":1,"f1":3,"min":6,"max":200,"sh":["full","slab"],"cat":"ind","c":"#b4b8bd","dn":["{}印刷"]},
   {"k":"textile","n":"繊維工場","use":"factory","one":true,"z":"ef","cpm":240,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#c2b8c6","rl":0.9,"dn":["{}紡績"]},
   {"k":"paper","n":"製紙工場","use":"factory","one":true,"z":"fgk","cpm":260,"f0":1,"f1":2,"min":60,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#c9c4b5","rl":0.95,"fx":{"home":-0.05},"dn":["{}製紙"]},
   {"k":"machine","n":"機械工場","use":"factory","one":true,"z":"ef","cpm":280,"f0":1,"f1":2,"min":20,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#a6adb3","rl":1.05,"dn":["{}機械"]},
   {"k":"metal","n":"金属加工工場","use":"factory","one":true,"z":"ef","cpm":270,"f0":1,"f1":2,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#9ca3a8","fx":{"home":-0.04},"dn":["{}金属"]},
   {"k":"parts","n":"部品工場","use":"factory","one":true,"z":"ef","cpm":280,"f0":1,"f1":3,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#adb5ba","rl":1.05,"dn":["{}工業"]},
   {"k":"precision","n":"精密機械工場","use":"factory","one":true,"z":"ef","cpm":380,"f0":1,"f1":4,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#c3ccd3","rl":1.25,"dm":0.95,"dn":["{}精機"]},
   {"k":"pharma","n":"薬品工場","use":"factory","one":true,"z":"ef","cpm":420,"f0":1,"f1":4,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#d6e2e6","rl":1.3,"dn":["{}製薬"]},
   {"k":"cosme","n":"化粧品工場","use":"factory","one":true,"z":"ef","cpm":380,"f0":1,"f1":3,"min":10,"max":400,"sh":["full","slab"],"cat":"ind","c":"#e6d3dc","rl":1.2,"dn":["{}化粧品"]},
   {"k":"beverage","n":"飲料工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":3,"min":40,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#b9d1db","rl":1.05,"dn":["{}飲料"]},
   {"k":"beer","n":"ビール工場","use":"factory","one":true,"z":"efh","cpm":320,"f0":1,"f1":3,"min":60,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#d8b26a","rl":1.1,"fx":{"hotel":0.02},"dn":["{}ビール"]},
   {"k":"sake","n":"酒蔵","use":"factory","one":true,"z":"bcefhk","cpm":350,"f0":1,"f1":2,"min":4,"max":100,"sh":["full","L"],"cat":"ind","c":"#4d4a46","rl":1.15,"dm":0.9,"dn":["{}酒造"]},
   {"k":"confect","n":"製菓工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":3,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#e9cfae","rl":1.05,"dn":["{}製菓"]},
   {"k":"breadf","n":"パン工場","use":"factory","one":true,"z":"ef","cpm":290,"f0":1,"f1":2,"min":10,"max":400,"sh":["full","slab"],"cat":"ind","c":"#e4c491","dn":["{}製パン"]},
   {"k":"frozen","n":"冷凍食品工場","use":"factory","one":true,"z":"ef","cpm":330,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#c8dbe4","rl":1.05,"dn":["{}食品"]},
   {"k":"furniture","n":"家具工場","use":"factory","one":true,"z":"ef","cpm":260,"f0":1,"f1":2,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#a98c6c","rl":0.95,"dn":["{}木工"]},
   {"k":"glass","n":"ガラス工場","use":"factory","one":true,"z":"ef","cpm":290,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#bcd6da","dn":["{}硝子"]},
   {"k":"cement","n":"セメント工場","use":"factory","one":true,"z":"fgk","cpm":260,"f0":1,"f1":2,"min":100,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#b8b6b0","rl":0.9,"fx":{"home":-0.06},"dn":["{}セメント"]},
   {"k":"recycle","n":"リサイクル工場","use":"factory","one":true,"z":"efgk","cpm":260,"f0":1,"f1":2,"min":20,"max":600,"sh":["full","slab"],"cat":"ind","c":"#9fb39a","rl":0.9,"fx":{"home":-0.03},"dn":["{}リサイクルセンター"]},
   {"k":"garbage","n":"ごみ処理場","use":"factory","one":true,"z":"fgk","cpm":450,"f0":1,"f1":3,"min":60,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#8f969c","rl":0.8,"dm":1.3,"fx":{"home":-0.08},"dn":["{}クリーンセンター"]},
   {"k":"thermal","n":"火力発電所","use":"factory","one":true,"z":"fgk","cpm":500,"f0":1,"f1":3,"min":200,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#7c8288","rl":1.3,"pp":0.2,"fx":{"home":-0.05},"dn":["{}火力発電所"]},
   {"k":"shipyard","n":"造船所","use":"factory","one":true,"z":"gk","cpm":350,"f0":1,"f1":2,"min":200,"max":1600,"sh":["full","slab"],"sea":true,"mk":"ship","cat":"ind","c":"#8ea2ae","rl":1.2,"dn":["{}造船所"]},
   {"k":"water","n":"浄水場","use":"factory","one":true,"z":"efghik","cpm":300,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"ind","c":"#9cc4d6","rl":0.9,"pp":0.1,"pat":"water","dn":["{}浄水場"]},
   {"k":"solar","n":"太陽光発電所","use":"factory","one":true,"z":"efghik","cpm":80,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"ind","c":"#3d5a80","pp":0.02,"pat":"solar","dn":["{}メガソーラー"]},
   {"k":"wind","n":"風力発電所","use":"factory","one":true,"z":"ghik","cpm":120,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"ind","c":"#cfe3c4","pp":0.01,"pat":"wind","dn":["{}ウインドファーム"]},
   {"k":"smallwh","n":"小さな倉庫","use":"warehouse","one":true,"z":"cdefgk","cpm":180,"f0":1,"f1":2,"min":1,"max":20,"sh":["full","slab"],"cat":"logi","c":"#c7bba3","rl":0.95,"dn":["{}倉庫"]},
   {"k":"whbldg","n":"倉庫ビル","use":"warehouse","one":true,"z":"cdefgk","cpm":300,"f0":3,"f1":8,"min":20,"max":600,"sh":["full","slab"],"cat":"logi","c":"#b9ae98","dn":["{}倉庫ビル"]},
   {"k":"dc","n":"物流センター","use":"warehouse","one":true,"z":"efgk","cpm":280,"f0":1,"f1":5,"min":100,"max":1600,"sh":["full","slab"],"cat":"logi","c":"#c4b9a5","rl":1.15,"dm":1.1,"pp":1.5,"dn":["{}ロジスティクスセンター"]},
   {"k":"coldwh","n":"冷凍倉庫","use":"warehouse","one":true,"z":"efgk","cpm":380,"f0":1,"f1":4,"min":20,"max":800,"sh":["full","slab"],"cat":"logi","c":"#cfe0e6","rl":1.35,"dn":["{}冷蔵倉庫"]},
   {"k":"delivery","n":"配送センター","use":"warehouse","one":true,"z":"cdef","cpm":240,"f0":1,"f1":2,"min":20,"max":600,"sh":["full","slab"],"cat":"logi","c":"#cdbf9f","rl":1.05,"dm":1.1,"dn":["{}配送センター"]},
   {"k":"truckterm","n":"トラックターミナル","use":"warehouse","one":true,"z":"efgk","cpm":200,"f0":1,"f1":1,"min":60,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#b6ab92","dn":["{}トラックターミナル"]},
   {"k":"trunk","n":"トランクルーム","use":"warehouse","u":10,"z":"bcdek","cpm":250,"f0":1,"f1":4,"min":1,"max":20,"sh":["full","slab"],"cat":"logi","c":"#d2c7b1","rl":1.2,"dn":["{}トランクルーム"]},
   {"k":"wholesale","n":"卸売市場","use":"warehouse","one":true,"z":"cdegk","cpm":300,"f0":1,"f1":3,"min":60,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#c8b48e","fx":{"shop":0.04},"dn":["{}卸売市場"]},
   {"k":"oiltank","n":"油槽所","use":"warehouse","one":true,"z":"gk","cpm":350,"f0":1,"f1":1,"min":40,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#d9d9d2","rl":1.1,"pp":0.2,"dn":["{}油槽所"]},
   {"k":"container","n":"コンテナヤード","use":"warehouse","one":true,"z":"gk","cpm":60,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"logi","c":"#c26a4a","pat":"container","dn":["{}コンテナヤード"]},
   {"k":"fishport","n":"漁港","use":"port","one":true,"z":"ghk","cpm":300,"f0":1,"f1":1,"min":6,"max":400,"sh":["full"],"sea":true,"cat":"port","c":"#8fb0bf","rl":0.8,"dm":1.1,"dn":["{}漁港"]},
   {"k":"airfield","n":"飛行場（コミューター）","use":"port","one":true,"z":"efghk","cpm":3000,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"port","c":"#b7bec5","air":true,"gov":true,"rwy":800,"gates":2,"hangar":4,"pp":1.2,"rl":0.4,"dn":["{}飛行場"]},
   {"k":"airport_s","n":"地方空港","use":"port","one":true,"z":"efghk","cpm":5000,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"cat":"port","c":"#b2b9c1","air":true,"gov":true,"rwy":1500,"gates":4,"hangar":8,"pp":1.5,"rl":0.4,"dn":["{}空港"]},
   {"k":"airport_m","n":"空港","use":"port","one":true,"z":"efgh","cpm":8000,"f0":0,"f1":0,"min":900,"max":3200,"sh":["full"],"cat":"port","c":"#adb4bc","air":true,"gov":true,"rwy":2500,"gates":8,"hangar":16,"pp":2,"rl":0.4,"dn":["{}空港"]},
   {"k":"airport_l","n":"国際空港","use":"port","one":true,"z":"efgh","cpm":12000,"f0":0,"f1":0,"min":1500,"max":6400,"sh":["full"],"cat":"port","c":"#a8b0b8","air":true,"gov":true,"rwy":3000,"gates":16,"hangar":30,"pp":3,"rl":0.4,"dn":["{}国際空港"]},
   {"k":"ferry","n":"フェリーターミナル","use":"port","one":true,"z":"gk","cpm":600,"f0":1,"f1":3,"min":20,"max":600,"sh":["full"],"sea":true,"cat":"port","c":"#a7c0cf","pp":1.5,"fx":{"hotel":0.04},"dn":["{}フェリーターミナル"]},
   {"k":"containerport","n":"コンテナふ頭","use":"port","one":true,"z":"gk","cpm":450,"f0":1,"f1":1,"min":100,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#8c9fae","rl":1.15,"opts":["ore","crude"],"dn":["{}コンテナふ頭"]},
   {"k":"oilport","n":"石油基地","use":"port","one":true,"z":"gk","cpm":500,"f0":1,"f1":1,"min":40,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#b7b9b1","rl":1.1,"opts":["crude"],"rb":1.3,"dn":["{}石油基地"]},
   {"k":"marina","n":"マリーナ","use":"port","one":true,"z":"ghk","cpm":400,"f0":1,"f1":1,"min":10,"max":400,"sh":["full"],"sea":true,"cat":"port","c":"#9fc7d8","rl":1.2,"dm":0.8,"fx":{"hotel":0.04},"dn":["{}マリーナ"]},
   {"k":"mugi","n":"麦畑","use":"farm","one":true,"z":"h","cpm":10,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#e2c666","opts":["wheat"],"rb":1.3,"pat":"rows","dn":["{}麦畑"]},
   {"k":"hatake","n":"畑","use":"farm","one":true,"z":"h","cpm":8,"f0":0,"f1":0,"min":2,"max":1600,"sh":["full"],"cat":"farm","c":"#b9a36a","opts":["wheat"],"pat":"rows"},
   {"k":"paddy","n":"田んぼ","use":"farm","one":true,"z":"h","cpm":12,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#8fc28a","rl":1.05,"pat":"paddy"},
   {"k":"kaju","n":"果樹園","use":"farm","one":true,"z":"hi","cpm":20,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#88b05e","rl":1.3,"dm":0.9,"pat":"trees","dn":["{}果樹園"]},
   {"k":"cha","n":"茶畑","use":"farm","one":true,"z":"hi","cpm":15,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#6f9f55","rl":1.2,"pat":"rows","dn":["{}茶園"]},
   {"k":"vineyard","n":"ぶどう畑","use":"farm","one":true,"z":"hi","cpm":20,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#7f8f4e","rl":1.25,"pat":"rows","dn":["{}ワイナリー"]},
   {"k":"flowerfield","n":"花畑","use":"farm","one":true,"z":"hi","cpm":15,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#e9b6cf","rl":1.1,"fx":{"hotel":0.03},"pat":"flowers","dn":["{}フラワーパーク"]},
   {"k":"ranch","n":"牧場","use":"farm","one":true,"z":"hi","cpm":10,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"farm","c":"#b8d48c","rl":0.9,"pat":"lawn","dn":["{}牧場"]},
   {"k":"forestry","n":"植林地","use":"farm","one":true,"z":"i","cpm":5,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"farm","c":"#5d8a4f","rl":0.6,"pat":"trees"},
   {"k":"greenhouse","n":"ビニールハウス","use":"farm","one":true,"z":"h","cpm":60,"f0":1,"f1":1,"min":2,"max":400,"sh":["full","slab"],"cat":"farm","c":"#e8f1ee","rl":1.6},
   {"k":"chicken","n":"養鶏場","use":"farm","one":true,"z":"h","cpm":80,"f0":1,"f1":1,"min":10,"max":400,"sh":["full","slab"],"cat":"farm","c":"#d9cfb6","rl":1.2,"fx":{"home":-0.04},"dn":["{}養鶏場"]},
   {"k":"coinpark","n":"コインパーキング","use":"parking","one":true,"z":"abcdefghk","cpm":40,"f0":0,"f1":0,"min":1,"max":60,"sh":["full"],"cat":"park","c":"#c4c4c4","rl":1.2,"dm":0.95,"pat":"lines"},
   {"k":"tsukigime","n":"月極駐車場","use":"parking","one":true,"z":"abcdefghk","cpm":25,"f0":0,"f1":0,"min":2,"max":200,"sh":["full"],"cat":"park","c":"#bababa","rl":0.9,"dm":1.1,"pat":"lines"},
   {"k":"bigpark","n":"大型駐車場","use":"parking","one":true,"z":"cdefghk","cpm":25,"f0":0,"f1":0,"min":60,"max":1600,"sh":["full"],"cat":"park","c":"#b5b5b5","rl":0.85,"pat":"lines"},
   {"k":"bikepark","n":"自転車置き場","use":"parking","one":true,"z":"bcdk","cpm":20,"f0":0,"f1":0,"min":1,"max":40,"sh":["full"],"cat":"park","c":"#c9c3b5","rl":0.7,"dm":1.3,"pat":"lines"},
   {"k":"mechpark","n":"機械式駐車場","use":"parking","u":0,"z":"cd","cpm":600,"f0":3,"f1":10,"min":1,"max":20,"sh":["full"],"cat":"park","c":"#a9adb1","rl":1.3,"dn":["{}パーキングタワー"]},
   {"k":"busterm","n":"バスターミナル","use":"parking","u":0,"z":"cd","cpm":400,"f0":1,"f1":2,"min":20,"max":400,"sh":["full","slab"],"cat":"park","c":"#b9c2c9","pp":20,"fx":{"shop":0.03},"dn":["{}バスターミナル"]},
   {"k":"cityhall","n":"市役所","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"plaza","n":"広場","use":"plaza","one":true,"z":"abcdefghik","cpm":40,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"uhq","n":"大学の本部","use":"school","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ukan","n":"大学の校舎","use":"school","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ulab","n":"大学の研究棟","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ulib","n":"大学の図書館","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uhall","n":"大学の講堂","use":"school","u":0,"z":"abcdefghik","cpm":800,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ugym","n":"大学の体育館","use":"school","u":0,"z":"abcdefghik","cpm":450,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uunion","n":"学生会館","use":"school","u":0,"z":"abcdefghik","cpm":500,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"udorm","n":"学生寮","use":"home","u":0,"z":"abcdefghik","cpm":400,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"uhosp","n":"大学病院","use":"hospital","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"umus","n":"大学の博物館","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uschool","n":"附属学校","use":"school","u":0,"z":"abcdefghik","cpm":450,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"hs"},
   {"k":"ugh","n":"温室","use":"farm","u":0,"z":"abcdefghik","cpm":200,"f0":1,"f1":2,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ufield","n":"グラウンド","use":"plaza","one":true,"z":"abcdefghik","cpm":30,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ufarm","n":"実験農場","use":"farm","one":true,"z":"abcdefghik","cpm":10,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ugreen","n":"緑地","use":"plaza","one":true,"z":"abcdefghik","cpm":20,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"uave","n":"並木道","use":"plaza","one":true,"z":"abcdefghik","cpm":40,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"prefhall","n":"府県庁","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"govhall","n":"官庁","use":"office","u":0,"z":"abcdefghik","cpm":1100,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"diet","n":"国会議事堂","use":"office","u":0,"z":"abcdefghik","cpm":2500,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"court","n":"裁判所","use":"office","u":0,"z":"abcdefghik","cpm":1300,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"kantei","n":"首相官邸","use":"office","u":0,"z":"abcdefghik","cpm":1800,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natlib","n":"国立図書館","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"milhq","n":"司令部","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"wardoffice","n":"区役所","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"townhall","n":"町村役場","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"gpost","n":"郵便局","use":"office","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"police","n":"警察署","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"firest","n":"消防署","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"publib","n":"図書館","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"civic","n":"市民会館","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"pgym","n":"体育館","use":"office","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":5,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"cityhosp","n":"市立病院","use":"office","u":0,"z":"abcdefghik","cpm":1100,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"cleanfac","n":"清掃工場","use":"office","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":6,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"pwater","n":"浄水場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true,"pat":"water"},
   {"k":"natmus","n":"国立博物館","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natart","n":"国立美術館","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"nattheater","n":"国立劇場","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natstad","n":"国立競技場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true,"pat":"track"},
   {"k":"keiba","n":"競馬場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":20000,"sh":["full"],"gov":true,"pat":"keiba","c":"#cfe0b4","fx":{"shop":0.05,"hotel":0.1}},
   {"k":"hangar","n":"格納庫","use":"warehouse","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":1,"min":16,"max":400,"sh":["full","slab"],"gov":true,"c":"#8d9196"},
   {"k":"ctower","n":"管制塔","use":"office","u":0,"z":"abcdefghik","cpm":1500,"f0":4,"f1":12,"min":1,"max":9,"sh":["tower","full"],"gov":true,"c":"#c9cdd2"},
   {"k":"barracks","n":"隊舎","use":"home","u":30,"z":"abcdefghik","cpm":350,"f0":3,"f1":6,"min":6,"max":120,"sh":["slab","L","ko","full"],"gov":true,"c":"#b9b29a"},
   {"k":"mro","n":"航空機整備工場","use":"factory","one":true,"z":"abcdefghik","cpm":400,"f0":1,"f1":2,"min":30,"max":800,"sh":["full","slab"],"gov":true,"c":"#9aa1a8"},
   {"k":"fueltank","n":"燃料タンク","use":"warehouse","one":true,"z":"abcdefghik","cpm":250,"f0":1,"f1":1,"min":4,"max":400,"sh":["full"],"gov":true,"c":"#d8d8d0"},
   {"k":"radar","n":"レーダー基地","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":3,"min":2,"max":60,"sh":["full"],"gov":true,"c":"#c0c6cc"},
   {"k":"milschool","n":"士官学校","use":"office","u":0,"z":"abcdefghik","cpm":700,"f0":2,"f1":6,"min":20,"max":800,"sh":["full","slab","L","ko"],"gov":true,"c":"#a89a7c"},
   {"k":"navpier","n":"軍港の岸壁","use":"port","one":true,"z":"abcdefghik","cpm":500,"f0":1,"f1":1,"min":20,"max":1600,"sh":["full"],"sea":true,"gov":true,"c":"#8a9aa6"},
   {"k":"drydock","n":"乾ドック","use":"factory","one":true,"z":"abcdefghik","cpm":450,"f0":1,"f1":1,"min":60,"max":1600,"sh":["full","slab"],"sea":true,"gov":true,"c":"#7f8f99"},
   {"k":"arsenal","n":"海軍工廠","use":"factory","one":true,"z":"abcdefghik","cpm":400,"f0":1,"f1":4,"min":40,"max":1600,"sh":["full","slab"],"gov":true,"c":"#8b8e84"},
   {"k":"uminoie","n":"海の家","use":"shop","u":0,"z":"aghik","cpm":200,"f0":1,"f1":1,"min":1,"max":6,"sh":["full"],"sea":true,"cat":"shop","c":"#e8c88a","dn":["海の家 {}"]},
   {"k":"seaside","n":"シーサイドハウス","use":"hotel","one":true,"z":"abhik","cpm":500,"f0":1,"f1":2,"min":2,"max":12,"sh":["full","L"],"sea":true,"sc":"guesthouse","cat":"hotel","c":"#9ec9d6","dn":["シーサイドハウス {}"]},
   {"k":"beachhouse","n":"ビーチハウス","use":"home","one":true,"z":"abhik","cpm":600,"f0":1,"f1":2,"min":3,"max":20,"sh":["full","L"],"sea":true,"cat":"home","c":"#d9e4e8","rl":1.6,"dm":0.6},
   {"k":"cottage","n":"コテージ","use":"hotel","one":true,"z":"ahik","cpm":420,"f0":1,"f1":2,"min":2,"max":10,"sh":["full","L"],"sc":"pension","cat":"hotel","c":"#a77b55","dn":["{}コテージ"]},
   {"k":"glamping","n":"グランピング施設","use":"leisure","one":true,"z":"hik","cpm":150,"f0":1,"f1":1,"min":20,"max":400,"sh":["full"],"sc":"camp","cat":"fun","c":"#c9b48a","dn":["{}グランピング"]},
   {"k":"beachclub","n":"ビーチクラブ","use":"leisure","one":true,"z":"cdghk","cpm":600,"f0":1,"f1":3,"min":6,"max":100,"sh":["full","L"],"sea":true,"sc":"pool","cat":"fun","c":"#5fb3c8","dn":["{}ビーチクラブ"]},
   {"k":"oceanview","n":"オーシャンビューホテル","use":"hotel","one":true,"z":"abcdhik","cpm":950,"f0":5,"f1":25,"min":20,"max":800,"sh":["slab","L","tower"],"sea":true,"sc":"resort","cat":"hotel","c":"#e3d9c6","fx":{"shop":0.03},"dn":["{}オーシャンビューホテル"]},
   {"k":"resortcondo","n":"リゾートマンション","use":"home","u":70,"z":"bcdhk","cpm":700,"f0":5,"f1":20,"min":10,"max":200,"sh":["slab","L","tower"],"cat":"home","c":"#e6e0d4","rl":1.4},
   {"k":"aquapark","n":"ウォーターパーク","use":"leisure","one":true,"z":"cdhk","cpm":400,"f0":1,"f1":2,"min":60,"max":1600,"sh":["full"],"sc":"pool","cat":"fun","c":"#4fb0d8","dn":["{}ウォーターパーク"]},
   {"k":"teitaku","n":"邸宅","use":"home","one":true,"z":"abhik","cpm":800,"f0":2,"f1":3,"min":6,"max":30,"sh":["full","L","ko"],"cat":"home","c":"#7a5a48","rl":1.9,"dm":0.65},
   {"k":"poolvilla","n":"プールつき邸宅","use":"home","one":true,"z":"abhik","cpm":1000,"f0":1,"f1":3,"min":10,"max":50,"sh":["full","L","ko"],"cat":"home","c":"#f0ede6","rl":2.4,"dm":0.55},
   {"k":"residence","n":"高級低層レジデンス","use":"home","u":120,"z":"abck","cpm":900,"f0":3,"f1":6,"min":8,"max":80,"sh":["full","L","ko","ro"],"cat":"home","c":"#cdb89a","rl":2.0},
   {"k":"terrace","n":"テラスハウス","use":"home","u":80,"z":"abcek","cpm":380,"f0":2,"f1":3,"min":3,"max":12,"sh":["slab","full"],"cat":"home","c":"#c8a27c"},
   {"k":"courtyard","n":"中庭のある家","use":"home","one":true,"z":"abhik","cpm":550,"f0":1,"f1":2,"min":6,"max":20,"sh":["ko","ro"],"cat":"home","c":"#a8806a","rl":1.3},
   {"k":"koban","n":"交番","use":"office","u":0,"z":"abcdefghik","cpm":800,"f0":1,"f1":2,"min":1,"max":2,"sh":["full"],"gov":true,"c":"#e8e2d0"},
   {"k":"hokenjo","n":"保健所","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":2,"f1":5,"min":4,"max":40,"sh":["full","slab"],"gov":true,"c":"#d5e3e6"},
   {"k":"zeimusho","n":"税務署","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":3,"f1":8,"min":4,"max":60,"sh":["full","slab"],"gov":true,"c":"#c9c3b5"},
   {"k":"kishodai","n":"気象台","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":2,"f1":5,"min":4,"max":80,"sh":["full","tower"],"gov":true,"c":"#dfe6ea"},
   {"k":"lighthouse","n":"灯台","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":3,"f1":8,"min":1,"max":4,"sh":["tower","full"],"sea":true,"gov":true,"c":"#ffffff"},
   {"k":"cemetery","n":"霊園","use":"plaza","one":true,"z":"abcdefghik","cpm":60,"f0":0,"f1":0,"min":10,"max":800,"sh":["full"],"gov":true,"c":"#a9b39a"},
   {"k":"sewage","n":"下水処理場","use":"factory","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":2,"min":40,"max":800,"sh":["full","slab"],"gov":true,"c":"#9fb8a8"},
   {"k":"geihinkan","n":"迎賓館","use":"office","u":0,"z":"abcdefghik","cpm":2000,"f0":2,"f1":3,"min":40,"max":800,"sh":["full","ko"],"gov":true,"c":"#efe7d6"},
   {"k":"embassy","n":"大使館","use":"office","u":0,"z":"abcd","cpm":1200,"f0":2,"f1":8,"min":4,"max":60,"sh":["full","L","ko"],"cat":"biz","c":"#d8d2c4","dn":["{}大使館"]},
   {"k":"radiotower","n":"電波塔","use":"office","u":0,"z":"abcdefghik","cpm":2000,"f0":30,"f1":100,"min":4,"max":40,"sh":["tower"],"cat":"biz","c":"#d94f3d","dn":["{}タワー"]},
   {"k":"obstower","n":"展望タワー","use":"leisure","one":true,"z":"cdk","cpm":1800,"f0":20,"f1":90,"min":4,"max":60,"sh":["tower"],"sc":"science","cat":"fun","c":"#e8e3d6","dn":["{}タワー"]},
   {"k":"castle","n":"城","use":"leisure","one":true,"z":"abcdehik","cpm":1500,"f0":3,"f1":6,"min":20,"max":800,"sh":["full"],"sc":"museum","cat":"fun","c":"#f2efe8","dn":["{}城"]},
   {"k":"garden","n":"日本庭園","use":"leisure","one":true,"z":"abcdehik","cpm":120,"f0":0,"f1":0,"min":10,"max":800,"sh":["full"],"sc":"botanical","cat":"fun","c":"#7fb06a","dn":["{}庭園"]},
   {"k":"observatory","n":"天文台","use":"leisure","one":true,"z":"hik","cpm":900,"f0":1,"f1":3,"min":4,"max":100,"sh":["full"],"sc":"science","cat":"fun","c":"#e9eef2","dn":["{}天文台"]},
   {"k":"domestadium","n":"ドーム球場","use":"leisure","one":true,"z":"cdefk","cpm":1500,"f0":4,"f1":8,"min":400,"max":1600,"sh":["full"],"sc":"baseball","cat":"fun","c":"#e8ecef","dn":["{}ドーム"]},
   {"k":"bigtemple","n":"大寺院","use":"leisure","one":true,"z":"abcdehik","cpm":900,"f0":1,"f1":5,"min":20,"max":800,"sh":["full","L","ko"],"sc":"temple","cat":"fun","c":"#8b3a2a","dn":["{}寺"]},
   {"k":"taisha","n":"大社","use":"leisure","one":true,"z":"abcdehik","cpm":800,"f0":1,"f1":1,"min":40,"max":1600,"sh":["full","L"],"sc":"shrine","cat":"fun","c":"#b03a2e","dn":["{}大社"]},
   {"k":"substation","n":"変電所","use":"factory","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":1,"min":4,"max":100,"sh":["full"],"cat":"ind","c":"#a0a4a8","fx":{"home":-0.02}},
   {"k":"hydro","n":"水力発電所","use":"factory","one":true,"z":"hi","cpm":600,"f0":1,"f1":3,"min":10,"max":200,"sh":["full"],"cat":"ind","c":"#8fa9b8"},
   {"k":"geothermal","n":"地熱発電所","use":"factory","one":true,"z":"hik","cpm":500,"f0":1,"f1":2,"min":10,"max":200,"sh":["full"],"cat":"ind","c":"#b3a58f"},
   {"k":"heliport","n":"ヘリポート","use":"parking","one":true,"z":"cdefgk","cpm":200,"f0":0,"f1":0,"min":4,"max":40,"sh":["full"],"cat":"park","c":"#9da39f"},
   {"k":"glassoffice","n":"ガラス張りのオフィスビル","use":"office","u":0,"z":"cd","cpm":1000,"f0":8,"f1":40,"min":8,"max":200,"sh":["slab","tower","L"],"opt":["shop1"],"cat":"biz","c":"#8fb4cf"},
   {"k":"twintower","n":"ツインタワー","use":"office","u":0,"g1":"shop","z":"d","cpm":1200,"f0":30,"f1":55,"min":40,"max":400,"sh":["tower"],"cat":"biz","c":"#a3b8cc","fx":{"office":0.05}},
   {"k":"mixeduse","n":"複合商業ビル","use":"shop","u":150,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":20,"min":10,"max":400,"sh":["full","slab","L"],"cat":"shop","c":"#d9c3a5"}
]'::jsonb
$$;

create or replace function public._mp_sc_kinds() returns jsonb
language sql immutable as $$
  select '{
    "es": {"n":"小学校","use":"school","spp":10,"r":16,"age":0.06,"rs":0,"fee":200,"w":0.05,"acc":false,"loc":false},
    "jhs": {"n":"中学校","use":"school","spp":11,"r":30,"age":0.03,"rs":0,"fee":230,"w":0.1,"acc":false,"loc":false},
    "hs": {"n":"高校","use":"school","spp":12,"r":100,"age":0.03,"rs":0,"fee":320,"w":0.8,"acc":true,"loc":false},
    "univ": {"n":"大学","use":"school","spp":18,"r":300,"age":0.035,"rs":0,"fee":650,"w":1.0,"acc":true,"loc":false},
    "voc": {"n":"専門学校","use":"school","spp":9,"r":200,"age":0.012,"rs":0,"fee":500,"w":0.9,"acc":true,"loc":false},
    "nursery": {"n":"保育園","use":"school","spp":8,"r":10,"age":0.02,"rs":0,"fee":400,"w":0.05,"acc":false,"loc":false},
    "kinder": {"n":"幼稚園","use":"school","spp":8,"r":12,"age":0.02,"rs":0,"fee":300,"w":0.05,"acc":false,"loc":false},
    "esjhs": {"n":"小中一貫校","use":"school","spp":10,"r":30,"age":0.04,"rs":0,"fee":220,"w":0.1,"acc":false,"loc":false},
    "jhshs": {"n":"中高一貫校","use":"school","spp":12,"r":100,"age":0.015,"rs":0,"fee":380,"w":0.7,"acc":true,"loc":false},
    "techhs": {"n":"工業高校","use":"school","spp":14,"r":120,"age":0.008,"rs":0,"fee":320,"w":0.8,"acc":true,"loc":false},
    "comhs": {"n":"商業高校","use":"school","spp":12,"r":120,"age":0.008,"rs":0,"fee":320,"w":0.8,"acc":true,"loc":false},
    "jc": {"n":"短期大学","use":"school","spp":15,"r":200,"age":0.006,"rs":0,"fee":550,"w":0.9,"acc":true,"loc":false},
    "cram": {"n":"学習塾","use":"school","spp":5,"r":20,"age":0.02,"rs":0,"fee":250,"w":0.2,"acc":false,"loc":false},
    "prep": {"n":"予備校","use":"school","spp":6,"r":150,"age":0.004,"rs":0,"fee":600,"w":0.9,"acc":true,"loc":false},
    "driving": {"n":"自動車教習所","use":"school","spp":60,"r":150,"age":0.001,"rs":0,"fee":1500,"w":0.5,"acc":true,"loc":false},
    "eikaiwa": {"n":"英会話教室","use":"school","spp":6,"r":40,"age":0.004,"rs":0,"fee":400,"w":0.4,"acc":true,"loc":false},
    "music": {"n":"音楽学校","use":"school","spp":12,"r":150,"age":0.002,"rs":0,"fee":600,"w":0.8,"acc":true,"loc":false},
    "cook": {"n":"調理師学校","use":"school","spp":10,"r":150,"age":0.002,"rs":0,"fee":550,"w":0.8,"acc":true,"loc":false},
    "bizhotel": {"n":"ビジネスホテル","use":"hotel","spp":25,"r":60,"age":0.0015,"rs":0.012,"fee":1000,"w":1.0,"acc":true,"loc":true},
    "cityhotel": {"n":"シティホテル","use":"hotel","spp":40,"r":100,"age":0.001,"rs":0.01,"fee":1800,"w":1.0,"acc":true,"loc":true},
    "luxhotel": {"n":"高級ホテル","use":"hotel","spp":70,"r":200,"age":0.0004,"rs":0.004,"fee":4000,"w":0.8,"acc":true,"loc":true},
    "resort": {"n":"リゾートホテル","use":"hotel","spp":60,"r":300,"age":0.0005,"rs":0.002,"fee":3000,"w":0.5,"acc":false,"loc":true,"pk":[7,8],"op":[1,2]},
    "ryokan": {"n":"旅館","use":"hotel","spp":35,"r":200,"age":0.0006,"rs":0.004,"fee":1600,"w":0.8,"acc":true,"loc":true,"pk":[9,10,11]},
    "onsenryokan": {"n":"温泉旅館","use":"hotel","spp":40,"r":300,"age":0.0005,"rs":0.003,"fee":2200,"w":0.6,"acc":false,"loc":true,"pk":[12,1,2],"op":[7,8]},
    "minshuku": {"n":"民宿","use":"hotel","spp":30,"r":200,"age":0.0004,"rs":0.002,"fee":900,"w":0.6,"acc":false,"loc":true,"pk":[7,8]},
    "pension": {"n":"ペンション","use":"hotel","spp":35,"r":200,"age":0.0003,"rs":0.002,"fee":1200,"w":0.5,"acc":false,"loc":true,"pk":[7,8,12]},
    "capsule": {"n":"カプセルホテル","use":"hotel","spp":6,"r":40,"age":0.0008,"rs":0.01,"fee":300,"w":1.0,"acc":true,"loc":true},
    "guesthouse": {"n":"ゲストハウス","use":"hotel","spp":12,"r":100,"age":0.0004,"rs":0.005,"fee":450,"w":1.0,"acc":true,"loc":true},
    "stahotel": {"n":"駅前ホテル","use":"hotel","spp":28,"r":60,"age":0.001,"rs":0.015,"fee":1100,"w":1.0,"acc":true,"loc":true},
    "condo": {"n":"コンドミニアム","use":"hotel","spp":50,"r":200,"age":0.0003,"rs":0.003,"fee":2200,"w":0.6,"acc":false,"loc":true,"pk":[7,8]},
    "clinic": {"n":"診療所","use":"hospital","spp":8,"r":16,"age":0.02,"rs":0,"fee":400,"w":0.2,"acc":false,"loc":false},
    "dental": {"n":"歯科医院","use":"hospital","spp":10,"r":16,"age":0.008,"rs":0,"fee":450,"w":0.1,"acc":false,"loc":false},
    "vet": {"n":"動物病院","use":"hospital","spp":12,"r":30,"age":0.003,"rs":0,"fee":500,"w":0.1,"acc":false,"loc":false},
    "hospital": {"n":"総合病院","use":"hospital","spp":25,"r":100,"age":0.01,"rs":0,"fee":1200,"w":0.6,"acc":true,"loc":false},
    "bighosp": {"n":"大病院","use":"hospital","spp":30,"r":200,"age":0.006,"rs":0,"fee":1600,"w":0.8,"acc":true,"loc":false},
    "erhosp": {"n":"救急病院","use":"hospital","spp":30,"r":120,"age":0.004,"rs":0,"fee":1500,"w":0.4,"acc":true,"loc":false},
    "pedi": {"n":"小児科医院","use":"hospital","spp":10,"r":20,"age":0.006,"rs":0,"fee":350,"w":0.1,"acc":false,"loc":false,"pk":[12,1,2]},
    "eye": {"n":"眼科","use":"hospital","spp":10,"r":30,"age":0.005,"rs":0,"fee":400,"w":0.2,"acc":false,"loc":false},
    "obgyn": {"n":"産婦人科","use":"hospital","spp":20,"r":60,"age":0.002,"rs":0,"fee":900,"w":0.3,"acc":false,"loc":false},
    "nursing": {"n":"老人ホーム","use":"hospital","spp":40,"r":60,"age":0.002,"rs":0,"fee":1300,"w":0.05,"acc":false,"loc":false},
    "care": {"n":"介護施設","use":"hospital","spp":35,"r":40,"age":0.002,"rs":0,"fee":1100,"w":0.05,"acc":false,"loc":false},
    "dayserv": {"n":"デイサービスセンター","use":"hospital","spp":15,"r":20,"age":0.004,"rs":0,"fee":500,"w":0.05,"acc":false,"loc":false},
    "cinema": {"n":"映画館","use":"leisure","spp":3,"r":100,"age":0.004,"rs":0.01,"fee":120,"w":0.8,"acc":true,"loc":true},
    "theater": {"n":"劇場","use":"leisure","spp":4,"r":200,"age":0.001,"rs":0.005,"fee":200,"w":0.9,"acc":true,"loc":true},
    "hall": {"n":"コンサートホール","use":"leisure","spp":4,"r":200,"age":0.001,"rs":0.005,"fee":180,"w":0.9,"acc":true,"loc":true},
    "livehouse": {"n":"ライブハウス","use":"leisure","spp":3,"r":100,"age":0.001,"rs":0.008,"fee":150,"w":0.9,"acc":true,"loc":true},
    "bowling": {"n":"ボウリング場","use":"leisure","spp":8,"r":60,"age":0.002,"rs":0.003,"fee":300,"w":0.5,"acc":false,"loc":true},
    "arcade": {"n":"ゲームセンター","use":"leisure","spp":3,"r":40,"age":0.005,"rs":0.01,"fee":120,"w":0.5,"acc":true,"loc":true},
    "karaoke": {"n":"カラオケ店","use":"leisure","spp":4,"r":40,"age":0.005,"rs":0.01,"fee":160,"w":0.6,"acc":true,"loc":true},
    "pachinko": {"n":"パチンコ店","use":"leisure","spp":4,"r":40,"age":0.004,"rs":0.008,"fee":200,"w":0.4,"acc":false,"loc":true},
    "kbshop": {"n":"場外馬券売り場","use":"leisure","spp":8,"r":200,"age":0.003,"rs":0.006,"fee":400,"w":0.6,"acc":true,"loc":false,"kb":true},
    "batting": {"n":"バッティングセンター","use":"leisure","spp":10,"r":40,"age":0.001,"rs":0.002,"fee":300,"w":0.3,"acc":false,"loc":true,"pk":[3,4,5,7,8]},
    "golfrange": {"n":"ゴルフ練習場","use":"leisure","spp":30,"r":60,"age":0.001,"rs":0,"fee":500,"w":0.2,"acc":false,"loc":true},
    "golf": {"n":"ゴルフ場","use":"leisure","spp":500,"r":400,"age":0.0003,"rs":0,"fee":8000,"w":0.2,"acc":false,"loc":false,"pk":[3,4,5,9,10,11],"op":[12,1,2]},
    "tennis": {"n":"テニスコート","use":"leisure","spp":60,"r":40,"age":0.0008,"rs":0,"fee":600,"w":0.2,"acc":false,"loc":false,"pk":[3,4,5,9,10,11],"op":[12,1,2]},
    "sportsclub": {"n":"スポーツクラブ","use":"leisure","spp":8,"r":40,"age":0.006,"rs":0.003,"fee":250,"w":0.4,"acc":true,"loc":true},
    "pool": {"n":"屋内プール","use":"leisure","spp":10,"r":40,"age":0.003,"rs":0,"fee":300,"w":0.3,"acc":false,"loc":false,"pk":[7,8]},
    "skate": {"n":"スケートリンク","use":"leisure","spp":12,"r":100,"age":0.001,"rs":0.002,"fee":400,"w":0.5,"acc":true,"loc":false,"pk":[12,1,2],"op":[7,8]},
    "baseball": {"n":"野球場","use":"leisure","spp":4,"r":300,"age":0.0015,"rs":0.004,"fee":150,"w":1.2,"acc":true,"loc":false,"pk":[3,4,5,7,8,9],"op":[12,1,2]},
    "soccer": {"n":"サッカースタジアム","use":"leisure","spp":4,"r":300,"age":0.0012,"rs":0.004,"fee":150,"w":1.2,"acc":true,"loc":false,"op":[12,1]},
    "arena": {"n":"アリーナ","use":"leisure","spp":5,"r":200,"age":0.001,"rs":0.004,"fee":180,"w":1.0,"acc":true,"loc":true},
    "athletics": {"n":"陸上競技場","use":"leisure","spp":8,"r":200,"age":0.0008,"rs":0.002,"fee":120,"w":1.0,"acc":true,"loc":false,"pk":[3,4,5,9,10,11]},
    "amuse": {"n":"遊園地","use":"leisure","spp":15,"r":400,"age":0.002,"rs":0.004,"fee":700,"w":1.0,"acc":true,"loc":false,"pk":[3,4,5,7,8],"op":[12,1,2]},
    "tpark": {"n":"テーマパーク","use":"leisure","spp":20,"r":600,"age":0.004,"rs":0.008,"fee":1200,"w":1.0,"acc":true,"loc":false,"pk":[3,4,5,7,8,12],"op":[1,2,6]},
    "aquarium": {"n":"水族館","use":"leisure","spp":6,"r":300,"age":0.0015,"rs":0.004,"fee":300,"w":0.9,"acc":true,"loc":true,"pk":[7,8]},
    "zoo": {"n":"動物園","use":"leisure","spp":30,"r":300,"age":0.0015,"rs":0.003,"fee":400,"w":0.9,"acc":true,"loc":false,"pk":[3,4,5,9,10,11],"op":[12,1,2]},
    "botanical": {"n":"植物園","use":"leisure","spp":40,"r":200,"age":0.0008,"rs":0.001,"fee":300,"w":0.7,"acc":true,"loc":false,"pk":[3,4,5]},
    "artmuseum": {"n":"美術館","use":"leisure","spp":8,"r":200,"age":0.001,"rs":0.003,"fee":250,"w":0.9,"acc":true,"loc":true},
    "museum": {"n":"博物館","use":"leisure","spp":8,"r":200,"age":0.001,"rs":0.003,"fee":220,"w":0.9,"acc":true,"loc":false},
    "science": {"n":"科学館","use":"leisure","spp":8,"r":200,"age":0.001,"rs":0.002,"fee":220,"w":0.8,"acc":true,"loc":false,"pk":[7,8]},
    "superonsen": {"n":"スーパー銭湯","use":"leisure","spp":6,"r":60,"age":0.004,"rs":0.003,"fee":300,"w":0.4,"acc":false,"loc":true,"pk":[12,1,2]},
    "sento": {"n":"銭湯","use":"leisure","spp":4,"r":12,"age":0.01,"rs":0,"fee":120,"w":0.05,"acc":false,"loc":false,"pk":[12,1,2]},
    "wedding": {"n":"結婚式場","use":"leisure","spp":30,"r":200,"age":0.0003,"rs":0.002,"fee":1500,"w":0.8,"acc":true,"loc":true,"pk":[5,6,10,11]},
    "convention": {"n":"展示場","use":"leisure","spp":8,"r":300,"age":0.0008,"rs":0.006,"fee":200,"w":1.0,"acc":true,"loc":true},
    "camp": {"n":"キャンプ場","use":"leisure","spp":100,"r":400,"age":0.0004,"rs":0,"fee":1500,"w":0.3,"acc":false,"loc":false,"pk":[7,8],"op":[12,1,2]},
    "fishing": {"n":"釣り堀","use":"leisure","spp":30,"r":40,"age":0.0005,"rs":0,"fee":500,"w":0.2,"acc":false,"loc":false},
    "shrine": {"n":"神社","use":"leisure","spp":10,"r":40,"age":0.01,"rs":0.002,"fee":80,"w":0.3,"acc":false,"loc":false,"pk":[1]},
    "temple": {"n":"寺","use":"leisure","spp":10,"r":40,"age":0.006,"rs":0.002,"fee":100,"w":0.3,"acc":false,"loc":false,"pk":[8,11]},
    "church": {"n":"教会","use":"leisure","spp":8,"r":40,"age":0.004,"rs":0,"fee":80,"w":0.2,"acc":false,"loc":false,"pk":[12]},
    "ski": {"n":"スキー場","use":"leisure","spp":400,"r":400,"age":0.0006,"rs":0,"fee":4000,"w":0.3,"acc":false,"loc":false,"pk":[12,1,2],"op":[5,6,7,8,9,10]}
  }'::jsonb
$$;

create or replace function public._mp_sc_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare gd jsonb := _mp_goods(); rc jsonb := _mp_sc_recipes(); kd jsonb := _mp_sc_kinds();
        imul numeric := _mp_rate('sc_imp'); mmul numeric := _mp_rate('sc_mkt'); tb numeric := _mp_rate('truck_base'); tk numeric := _mp_rate('truck_km');
        fkm numeric := _mp_rate('sc_food_km'); smul numeric := _mp_rate('sc_shop'); rcm2 numeric := _mp_rate('rc_m2'); keep numeric := _mp_rate('sc_keep');
        fa record; cb record; sp record; gk text; kq numeric; need numeric; qq numeric; have numeric; mk numeric; uc numeric; amt bigint; shp bigint; bal numeric;
        gp numeric; wt numeric; buf numeric; tq numeric; ta numeric; ts numeric; nn int; mul numeric;
        rdm2 numeric := _mp_rate('rd_m2'); trkkm numeric := _mp_rate('trk_tkm'); capl numeric; ownq numeric; tr2 record;
        fp record; dkm numeric; ff bigint; ffs numeric;   -- t54o：フェリー（海をこえる荷物）
        kbw numeric;   -- 場外馬券売り場（DB の更新92）
begin
  -- 学校：生徒
  perform _mp_sc_school_calc(h);
  -- 場外馬券売り場（DB の更新92）：この1時間（h-1 〜 h）のレースの数と格。ふだんの1日（昼・夕方・夜・深夜で 50レースくらい）で1日分の手数料
  kbw := coalesce((select sum(_mp_race_w(kr.grade)) from keiba_races kr where kr.post >= h - interval '1 hour' and kr.post < h), 0) / 50.0;
  -- 施設の売上（人・会社が動かしている施設）：学校は授業料、宿泊は宿泊料、医療・福祉は診療報酬など、娯楽は入場料など
  for fa in select scx.bld, scx.grp, (scx.st ->> 'n')::int sn, coalesce((scx.st ->> 'fee')::numeric, (kd -> scx.grp ->> 'fee')::numeric) fee, kd -> scx.grp ->> 'use' fuse,
                   coalesce(nullif(blx.name, ''), kd -> scx.grp ->> 'n') name, opx.pu, opx.pc,
                   least(1, extract(epoch from h - blx.built_at) / 3600.0)::numeric fr      -- 建ててから1時間たっていなければ、その分だけ
              from mp_sc scx join mp_blds blx on blx.id = scx.bld, lateral _mp_sc_op(scx.bld, h) opx
             where scx.grp is not null and opx.ok and not opx.gv and coalesce((scx.st ->> 'n')::int, 0) > 0 loop
    amt := round(fa.sn * fa.fee * case when fa.grp = 'kbshop' then kbw else 1.0 / 24 end * fa.fr);   -- 場外馬券売り場は、レースのある時間だけ（DB の更新92）
    if amt > 0 then
      perform _mp_earn(fa.pu, fa.pc, false, amt, case when fa.fuse = 'school' then 'tuition' else 'fee' end,
                       format(case when fa.grp = 'kbshop' then '馬券の手数料：%s（%s人）' else case fa.fuse when 'school' then '授業料：%s（%s人）' when 'hotel' then '宿泊料：%s（%s人）' when 'hospital' then '診療報酬など：%s（%s人）'
                                           else '入場料など：%s（%s人）' end end, fa.name, fa.sn));
      insert into mp_sclog(at, bld, k, qty, amt) values (h, fa.bld, 'fee', fa.sn, amt);
    end if;
  end loop;

  -- この1時間に動いている工場・田畑・港（人・会社が動かしているもの）
  drop table if exists _sco;
  create temp table _sco on commit drop as
    select scx.bld, scx.prod, scx.imp, scx.lv, scx.x, scx.y, blx.kind,
           coalesce(nullif(blx.name, ''), _mp_bld_pmap() -> blx.kind ->> 'n', '') name,
           opx.pu, opx.pc, opx.m2 * coalesce((_mp_bld_pmap() -> blx.kind ->> 'rb')::numeric, 1) m2, _mp_sc_owes(opx.pu, opx.pc) owes,
           least(1, extract(epoch from h - blx.built_at) / 3600.0)::numeric fr      -- 建ててから1時間たっていなければ、その分だけつくる
      from mp_sc scx join mp_blds blx on blx.id = scx.bld, lateral _mp_sc_op(scx.bld, h) opx
     where scx.prod is not null and rc ? scx.prod and opx.ok and not opx.gv;

  -- 1) つくる（材料の在庫の分だけ。田畑・港は材料なし）
  for fa in select * from _sco o where o.prod not in ('railcar', 'ship') and not o.owes order by o.bld loop
    mk := (rc -> fa.prod ->> 'r')::numeric * fa.m2 / 24 * fa.fr;
    for gk, kq in select e.key, e.value::text::numeric from jsonb_each(rc -> fa.prod -> 'in') e loop
      have := coalesce((select stk.qty from mp_stock stk where stk.bld = fa.bld and stk.good = gk), 0);
      mk := least(mk, have / kq);
    end loop;
    mk := floor(mk * 10000) / 10000;
    if mk <= 0 then continue; end if;
    for gk, kq in select e.key, e.value::text::numeric from jsonb_each(rc -> fa.prod -> 'in') e loop
      update mp_stock stk set qty = greatest(0, stk.qty - round(mk * kq, 4)) where stk.bld = fa.bld and stk.good = gk;
      insert into mp_sclog(at, bld, k, good, qty) values (h, fa.bld, 'use', gk, round(mk * kq, 4));
    end loop;
    insert into mp_stock(bld, good, qty) values (fa.bld, fa.prod, mk) on conflict (bld, good) do update set qty = mp_stock.qty + excluded.qty;
    amt := round(mk * (gd -> fa.prod ->> 'p')::numeric * (rc -> fa.prod ->> 'oc')::numeric);
    if amt > 0 then amt := _mp_soft_pay(fa.pu, fa.pc, false, amt, 'goods', rc -> fa.prod ->> 'ocn'); end if;
    insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'make', fa.prod, mk, 0);
    if amt > 0 then insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'cost', fa.prod, 0, amt); end if;
  end loop;

  -- 自分のトラック（t54l）：名義ごとの1時間の輸送力（t・km）。積める重さ × trk_tkm ÷ 24。納車まち・工事中・状態が20より悪いものはのぞく。
  --   営業所のまわり 20km の道が混んでいると、へる（いちばん半分。DB の更新67）
  --   1t 運ぶごとに（距離 + 10km）分を使う（積みおろし）。動いているトラックターミナル1つごとに +10%（3つまで）
  drop table if exists _trk;
  create temp table _trk on commit drop as
    select cx.own_u pu, cx.own_c pc, (sum(tx.load * coalesce(jf.f, 1)) * trkkm / 24.0)::numeric cap, 0::numeric used, count(*) n
      from mp_cars cx join mp_types tx on tx.code = cx.type
      left join lateral (select 1 - 0.5 * _mp_jam_idx(dp.x / 100.0, dp.y / 100.0) f from mp_depots dp where dp.id = cx.depot) jf on true   -- 渋滞（DB の更新67）
     where tx.role = 'Truck' and tx.load > 0 and (cx.busy_until is null or cx.busy_until <= h) and cx.cond >= 20
     group by cx.own_u, cx.own_c;
  update _trk t2 set cap = t2.cap * (1 + 0.1 * least(3, (select count(*) from mp_blds bt, lateral _mp_sc_op(bt.id, h) ot
                                                         where bt.kind = 'truckterm' and ot.ok and not ot.gv and ot.pu is not distinct from t2.pu and ot.pc is not distinct from t2.pc))) where true;

  -- 2) 仕入れ（トラック）：材料のいる工場が、近くの工場・田畑・港の在庫から買う（市場の値段＋運送費）。輸入のほうが安いとき・足りないときは輸入。
  --   自分のトラックで運べる分は運送費なし。海をこえるときは、航路のフェリーにトラックをのせる（のせられる重さまで。運賃は航路の持ち主に。t54o）
  perform _mp_ferry_links(h);
  for cb in select * from _sco o where not o.owes and (rc -> o.prod -> 'in') <> '{}'::jsonb order by random() loop
    for gk, kq in select e.key, e.value::text::numeric from jsonb_each(rc -> cb.prod -> 'in') e loop
      if cb.prod = 'railcar' then need := greatest(1, floor(cb.m2 / rcm2)) * 3 * 35;   -- 3日分（1両 35t くらい）
      elsif cb.prod = 'ship' then need := cb.m2 * _mp_rate('sy_tpd') * 3 * _mp_rate('sy_steel');   -- 造船所：3日分（t54o）
      else need := (rc -> cb.prod ->> 'r')::numeric * cb.m2 * kq;                         -- 1日分
      end if;
      if cb.prod = 'car' then need := need + greatest(1, floor(cb.m2 / rdm2)) * 2 * 10; end if;   -- 自動車工場：バス・トラックの注文の分（2日分・1台 10t くらい）
      need := round(need - coalesce((select stk.qty from mp_stock stk where stk.bld = cb.bld and stk.good = gk), 0), 4);
      if need <= 0.001 then continue; end if;
      gp := (gd -> gk ->> 'p')::numeric; wt := (gd -> gk ->> 'wt')::numeric;
      for sp in select o.bld, o.name, o.pu, o.pc, stk.qty, (sqrt((o.x - cb.x) ^ 2 + (o.y - cb.y) ^ 2) * 0.05 * 1.25)::numeric km, o.x sx, o.y sy
                  from _sco o join mp_stock stk on stk.bld = o.bld and stk.good = gk
                 where o.prod = gk and o.bld <> cb.bld and stk.qty > 0.001
                 order by 6, o.bld loop
        select * into fp from _mp_ferry_pick(sp.sx, sp.sy, cb.x, cb.y, cb.pu, cb.pc);
        if fp.n = 1 and fp.f_route is null then continue; end if;   -- 海の向こう：フェリーがない（のせられない）
        dkm := case when fp.n = 1 then fp.tkm else sp.km end;        -- トラックで走る km（フェリーのときは港まで・港から）
        uc := gp + wt * (tb + tk * dkm) + case when fp.n = 1 then wt * fp.fare else 0 end;
        if uc > gp * imul then if fp.n = 1 then continue; end if; exit; end if;   -- 輸入のほうが安い
        bal := _mp_bal(cb.pu, cb.pc) - 2;
        qq := floor(least(need, sp.qty, greatest(bal, 0) / uc, case when fp.n = 1 then fp.room / wt else need end) * 1000) / 1000;
        if qq <= 0 then if fp.n = 1 then continue; end if; exit; end if;
        -- 自分のトラックで運べる分（運送費なし）
        ownq := 0; capl := coalesce((select t2.cap - t2.used from _trk t2 where t2.pu is not distinct from cb.pu and t2.pc is not distinct from cb.pc), 0);
        if capl > 0.001 then
          ownq := least(qq, capl / (dkm + 10));
          update _trk t2 set used = t2.used + ownq * (dkm + 10) where t2.pu is not distinct from cb.pu and t2.pc is not distinct from cb.pc;
          insert into mp_sclog(at, bld, k, good, qty, amt, peer, km) values (h, cb.bld, 'own', gk, ownq, 0, sp.bld, dkm);
        end if;
        amt := round(qq * gp); shp := round((qq - ownq) * wt * (tb + tk * dkm));
        if fp.n = 1 then   -- フェリー（トラックをのせる）
          perform _mp_ferry_use(fp.f_route, fp.f_dir, qq * wt);
          ff := round(qq * wt * fp.fare);
          if ff > 0 then
            perform _mp_pay(cb.pu, cb.pc, false, ff, 'ship', format('フェリー（トラック）：%s %s・海 %skm', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), round(fp.skm::numeric, 1)));
            perform _mp_earn(fp.f_ru, fp.f_rc, false, ff, 'ferry', format('フェリーの運賃（トラック・%s %s）', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u')));
          end if;
          insert into mp_sclog(at, bld, k, good, qty, amt, peer, km) values (h, cb.bld, 'ferry', gk, qq, ff, sp.bld, fp.skm);
        end if;
        update mp_stock stk set qty = greatest(0, stk.qty - qq) where stk.bld = sp.bld and stk.good = gk;
        insert into mp_stock(bld, good, qty) values (cb.bld, gk, qq) on conflict (bld, good) do update set qty = mp_stock.qty + excluded.qty;
        perform _mp_pay(cb.pu, cb.pc, false, amt, 'goods', format('仕入れ：%s %s（%s から・%skm）', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), sp.name, round(sp.km, 1)));
        perform _mp_earn(sp.pu, sp.pc, false, amt, 'sales', format('売上：%s %s（%s へ・%skm）', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), cb.name, round(sp.km, 1)));
        if shp > 0 then perform _mp_pay(cb.pu, cb.pc, false, shp, 'ship', format('運送費（トラック）：%s %s・%skm', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), round(sp.km, 1))); end if;
        insert into mp_sclog(at, bld, k, good, qty, amt, peer, km) values (h, cb.bld, 'buy', gk, qq, amt, sp.bld, sp.km), (h, sp.bld, 'sell', gk, qq, amt, cb.bld, sp.km),
                                                                          (h, cb.bld, 'ship', gk, qq, shp, sp.bld, sp.km);
        need := need - qq;
        exit when need <= 0.001;
      end loop;
      -- 輸入
      if need > 0.001 and cb.imp then
        bal := _mp_bal(cb.pu, cb.pc) - 2;
        qq := floor(least(need, greatest(bal, 0) / (gp * imul)) * 1000) / 1000;
        if qq > 0 then
          amt := round(qq * gp * imul);
          perform _mp_pay(cb.pu, cb.pc, false, amt, 'goods', format('輸入：%s %s', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u')));
          insert into mp_stock(bld, good, qty) values (cb.bld, gk, qq) on conflict (bld, good) do update set qty = mp_stock.qty + excluded.qty;
          insert into mp_sclog(at, bld, k, good, qty, amt) values (h, cb.bld, 'imp', gk, qq, amt);
        end if;
      end if;
    end loop;
  end loop;

  -- 3) 食品をお店へ（人・会社・町の人が入っているお店。床の広さで売れる量。30km まで。近いお店から）
  if exists (select 1 from _sco o join mp_stock stk on stk.bld = o.bld and stk.good = 'food' where o.prod = 'food' and stk.qty > 0.001) then
    drop table if exists _shop; drop table if exists _marg;
    create temp table _shop on commit drop as
      select ux.id, (blx.cells[1] + 0.5) / 5.0 sx, (blx.cells[2] + 0.5) / 5.0 sy, (ux.m2 * _mp_rate('sc_food') / 24)::numeric dem,
             case when ux.t_kind = 'corp' then null else pcl.own_u end pu, case when ux.t_kind = 'corp' then ux.t_c else pcl.own_c end pc,
             ((ux.mode = 'self' and ux.t_kind is null) or (ux.t_kind = 'corp' and ux.t_c is not null)) pl
        from mp_units ux join mp_blds blx on blx.id = ux.bld join mp_parcels pcl on pcl.id = blx.parcel
       where ux.use = 'shop' and not pcl.gov and (ux.t_kind is not null or ux.mode = 'self') and blx.built_at < h - interval '1 hour';
    create temp table _marg (pu uuid, pc int, a numeric) on commit drop;
    drop table if exists _ffare;
    create temp table _ffare (ru uuid, rc int, a numeric, q numeric) on commit drop;   -- フェリーの運賃（食品をお店へ。t54o）
    gp := (gd -> 'food' ->> 'p')::numeric; wt := (gd -> 'food' ->> 'wt')::numeric;
    for fa in select o.*, stk.qty from _sco o join mp_stock stk on stk.bld = o.bld and stk.good = 'food' where o.prod = 'food' and stk.qty > 0.001 order by o.bld loop
      have := fa.qty; tq := 0; ta := 0; ts := 0; nn := 0;
      for sp in select shx.id, shx.dem, shx.pu, shx.pc, shx.pl, (sqrt((shx.sx - fa.x) ^ 2 + (shx.sy - fa.y) ^ 2) * 0.05 * 1.25)::numeric km, shx.sx, shx.sy
                  from _shop shx
                 where shx.dem > 0.00001 and shx.sx between fa.x - fkm / 0.0625 and fa.x + fkm / 0.0625 and shx.sy between fa.y - fkm / 0.0625 and fa.y + fkm / 0.0625
                 order by 6, shx.id loop
        exit when sp.km > fkm;
        select * into fp from _mp_ferry_pick(fa.x, fa.y, sp.sx, sp.sy, fa.pu, fa.pc);   -- 海の向こうのお店：フェリー（t54o）
        if fp.n = 1 and (fp.f_route is null or fp.room < 0.001) then continue; end if;
        qq := least(have, sp.dem, case when fp.n = 1 then fp.room / wt else have end);
        if fp.n = 1 then
          perform _mp_ferry_use(fp.f_route, fp.f_dir, qq * wt);
          ffs := qq * wt * fp.fare;
          if ffs > 0 then insert into _ffare values (fp.f_ru, fp.f_rc, ffs, qq); end if;
        end if;
        update _shop shx set dem = shx.dem - qq where shx.id = sp.id;
        -- 自分のトラックで運べる分（運送費なし）
        ownq := 0; capl := coalesce((select t2.cap - t2.used from _trk t2 where t2.pu is not distinct from fa.pu and t2.pc is not distinct from fa.pc), 0);
        if capl > 0.001 then
          ownq := least(qq, capl / (case when fp.n = 1 then fp.tkm else sp.km end + 10));
          update _trk t2 set used = t2.used + ownq * (case when fp.n = 1 then fp.tkm else sp.km end + 10) where t2.pu is not distinct from fa.pu and t2.pc is not distinct from fa.pc;
        end if;
        have := have - qq; tq := tq + qq; ta := ta + qq * gp; ts := ts + (qq - ownq) * wt * (tb + tk * case when fp.n = 1 then fp.tkm else sp.km end); nn := nn + 1;
        if sp.pl then insert into _marg values (sp.pu, sp.pc, qq * gp * smul); end if;
        exit when have <= 0.00001;
      end loop;
      if tq > 0 then
        update mp_stock stk set qty = greatest(0, stk.qty - tq) where stk.bld = fa.bld and stk.good = 'food';
        amt := round(ta); shp := round(ts);
        perform _mp_earn(fa.pu, fa.pc, false, amt, 'sales', format('お店に売った：食品 %s（%s軒）', _mp_fmtq(tq, 't'), nn));
        if shp > 0 then shp := _mp_soft_pay(fa.pu, fa.pc, false, shp, 'ship', format('運送費（トラック）：お店 %s軒へ', nn)); end if;
        insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'shop', 'food', tq, amt);
        if shp > 0 then insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'ship', 'food', tq, shp); end if;
      end if;
      -- フェリーの運賃（海の向こうのお店へ。航路の持ち主ごと）
      for tr2 in select f.ru, f.rc, sum(f.a) a, sum(f.q) q from _ffare f group by f.ru, f.rc loop
        ff := round(tr2.a);
        if ff > 0 then
          ff := _mp_soft_pay(fa.pu, fa.pc, false, ff, 'ship', format('フェリー（トラック）：食品 %s', _mp_fmtq(tr2.q, 't')));
          if ff > 0 then perform _mp_earn(tr2.ru, tr2.rc, false, ff, 'ferry', format('フェリーの運賃（トラック・食品 %s）', _mp_fmtq(tr2.q, 't'))); end if;
          insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'ferry', 'food', tr2.q, ff);
        end if;
      end loop;
      delete from _ffare where true;
    end loop;
    -- 人・会社が使っているお店：小売のもうけ
    for fa in select m.pu, m.pc, sum(m.a) a from _marg m group by m.pu, m.pc loop
      amt := round(fa.a);
      if amt > 0 then perform _mp_earn(fa.pu, fa.pc, false, amt, 'sales', '食品の販売（お店のもうけ）'); end if;
    end loop;
    drop table if exists _shop; drop table if exists _marg;
  end if;

  -- 4) 市場に売る：最後の品（自動車・家電・半導体は1倍、お店に売れのこった食品は 0.85倍）はぜんぶ。ほかは sc_keep 日分（6時間分）をこえた分。いまはつくらない・使わない品目もぜんぶ
  for fa in select o.*, stk.good, stk.qty from _sco o join mp_stock stk on stk.bld = o.bld where stk.qty > 0.001 order by o.bld, stk.good loop
    if (rc -> fa.prod -> 'in') ? fa.good then continue; end if;          -- 材料
    if fa.good = fa.prod then buf := case when gd -> fa.good ? 'fin' then 0 else (rc -> fa.prod ->> 'r')::numeric * fa.m2 * keep end;
    else buf := 0; end if;
    qq := floor((fa.qty - buf) * 10000) / 10000;
    if qq <= 0.0005 or not (gd ? fa.good) then continue; end if;
    mul := case when gd -> fa.good ->> 'fin' = 'mkt' then 1 else mmul end;
    amt := round(qq * (gd -> fa.good ->> 'p')::numeric * mul);
    update mp_stock stk set qty = greatest(0, stk.qty - qq) where stk.bld = fa.bld and stk.good = fa.good;
    if amt > 0 then perform _mp_earn(fa.pu, fa.pc, false, amt, 'sales', format('市場に売った：%s %s', gd -> fa.good ->> 'n', _mp_fmtq(qq, gd -> fa.good ->> 'u'))); end if;
    insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'mkt', fa.good, qq, amt);
  end loop;
  -- 自分のトラックのいたみ（その1時間に使ったわりあいで。寿命をすぎると2倍）
  for tr2 in select * from _trk t2 where t2.used > 0 loop
    update mp_cars c set cond = greatest(0, c.cond - 0.035 * least(1, tr2.used / greatest(tr2.cap, 0.001))
                                             * case when now() - c.born > make_interval(days => (select ty.life from mp_types ty where ty.code = c.type) * (1 + c.renewed)) then 2 else 1 end)
     where c.own_u is not distinct from tr2.pu and c.own_c is not distinct from tr2.pc and (c.busy_until is null or c.busy_until <= h) and c.cond >= 20
       and c.type in (select ty.code from mp_types ty where ty.role = 'Truck');
  end loop;
  delete from mp_stock stk where stk.qty <= 0.0001;
  drop table if exists _sco; drop table if exists _trk;
end $$;

create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb; rfid bigint; nsub int; orf real; sb2 bigint;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
        lfd boolean[]; rsh jsonb; sube jsonb := '{}'::jsonb; sk text; sf real; sbx record; ld int;   -- 変電所（DB の更新89）
        trk jsonb := '{}'::jsonb; xkb real;   -- 競馬場のお客（DB の更新92）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  -- 競馬場（DB の更新92）：この1時間のレースの来場者が、近くの駅・バス停で乗り降りする（系統ごと）。うまくいかなくても、ふだんどおり
  begin trk := _mp_track_riders(h); exception when others then trk := '{}'::jsonb; raise warning 'mp track riders: %', sqlerrm; end;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    lfd := case when r.kind = 'rail' then _mp_leg_fed(r.legs) end; rsh := case when r.kind = 'rail' then _mp_route_feed(r.legs) end;   -- 変電所（DB の更新89）
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null then continue; end if;
      dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      -- 編成の工事中（検査・改造・転属・納車）にかかる列車は運休：始発駅を出てから終点に着くまでのどこかが、工事の時間にかかるもの（DB の更新60）
      --   予備編成（DB の更新80）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走。予定は mp_subst）
      rfid := tr.fid;
      if _mp_form_busy(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) then
        begin rfid := _mp_subst_ok(tr.id, d0, tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)); exception when others then rfid := null; end;
        if rfid is not null then perf := _mp_form_perf(rfid); end if;
        if rfid is null or perf is null then nwk := nwk + 1; continue; end if;
        nsub := nsub + 1;
      end if;
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
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and (select coalesce(bit_or(x.m), 0) from unnest(_mp_leg_pm(r.legs)) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) & ~coalesce((perf ->> 'ps')::int, 1) <> 0 then continue; end if;   -- 電化方式がちがう区間は走れない（DB の更新87）
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from unnest(lfd) with ordinality x(f, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib) and not x.f) then continue; end if;   -- 変電所から遠く、電気が来ていない区間は走れない（DB の更新89）
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
      end if;
      -- 変電所の負荷（DB の更新89）：電車・電気機関車は、走る区間の変電所に 出力 × 0.45 × 走る時間（1時間まで）× 長さの割合
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and rsh is not null then
        for sk, sf in select key, value::real from jsonb_each_text(rsh) loop
          sube := sube || jsonb_build_object(sk, coalesce((sube ->> sk)::real, 0) + coalesce((perf ->> 'kw')::real, 0) * 0.45 * least(rt, 3600) * sf * cf);
        end loop;
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        -- 予備編成（DB の更新82）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走）
        sb2 := case when rfid = tr.fid then _mp_subst_pick(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) end;
        if sb2 is null then
          broke := broke + 1;
          update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
          continue;
        end if;
        insert into mp_subst(train, day, orig, sub, own_u, own_c, t0, t1)
          select tr.id, d0, tr.fid, sb2, f.own_u, f.own_c, to_timestamp(dep_abs), to_timestamp(dep_abs + rt) from mp_forms f where f.id = tr.fid
        on conflict (train, day) do update set orig = excluded.orig, sub = excluded.sub, t0 = excluded.t0, t1 = excluded.t1, made_at = now();
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''),
                                    format('故障のため予備編成「%s」が代走（%s）', (select name from mp_forms where id = sb2), to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        rfid := sb2; perf := _mp_form_perf(sb2); nsub := nsub + 1;
        if perf is null then broke := broke + 1; continue; end if;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）。区間折り返しは走った分だけ（DB の更新82）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800) * coalesce(orf, 1);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = rfid;   -- 代走なら予備編成がいたむ（DB の更新80）
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
    xkb := coalesce((trk ->> r.id::text)::real, 0) * least(1.2, greatest(0.7, q));   -- 競馬場のお客（DB の更新92）：遅い線は少し へる
    dem := dem + xkb;
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0), 'kb', nullif(round(case when dem > 0 then served * xkb / dem else 0 end), 0)));   -- kb：競馬場のお客（DB の更新92）   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 変電所（DB の更新89）：この1時間の負荷（平均 × 1.6 を いちばん多いときとみる）。容量をこえたら電圧の低下、1.5倍をこえたら停止（3時間に1回まで）
  for sbx in select vs.* from mp_subs vs loop
    ld := round(coalesce((sube ->> sbx.id::text)::real, 0) / 3600 * 1.6);
    update mp_subs set load = ld where id = sbx.id;
    if ld > sbx.cap and (sbx.ev_at is null or sbx.ev_at < h - interval '3 hours') and (sbx.trip is null or sbx.trip < now()) then
      begin perform _mp_sub_event(sbx.id, ld); exception when others then raise warning 'mp sub event: %', sqlerrm; end;
    end if;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
      union all select own_u, own_c, upk, '変電所' from mp_subs where not gov   -- 変電所（DB の更新89）
      union all select p.own_u, p.own_c, (_mp_attr_kinds() -> a.kind ->> 'upk')::numeric, 'アトラクション' from mp_attrs a join mp_blds b on b.id = a.bld join mp_parcels p on p.id = b.parcel where not p.gov   -- DB の更新91
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

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人（管理の関数は中で管理者かをしらべる）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_race_w', '_mp_track_wh', '_mp_track_base', '_mp_track_check', '_mp_track_why', '_mp_track_sta', '_mp_track_riders', '_mp_race_sessions',
                                                         'mp_track_list', 'mp_track_place', 'mp_track_find', 'mp_track_del', 'mp_track_info',
                                                         '_mp_bld_presets', '_mp_sc_kinds', '_mp_sc_tick_hour', '_mp_tick_hour') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 競馬場をおく・さがす（DB の更新92）は、広い土地をしらべるので60秒まで
alter function public.mp_track_place(text, int, int, text, boolean) set statement_timeout = '60s';
alter function public.mp_track_find(text, int, int, text) set statement_timeout = '60s';
