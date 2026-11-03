-- 道路の渋滞：5分ごとに、高速・国道・府県道・まちの大きな道（と、バスの通る道）の 混雑・渋滞・通行止めを決める。
--   通勤の朝夕・休日の昼・帰省ラッシュ（正月・GW・お盆の高速）・まちの人の多さ・車線・天気（雨・雪・霧）・事故（まれ）・夜の工事。高速は 強風・大雨・大雪で通行止め
--   バス：通る道が混むと、その区間で遅れる（運行情報に「渋滞」。えらぶ対応・🔔はなし）。前の くじの「渋滞」はやめる。トラック：営業所のまわりが混むと、運べる量がへる
--   地図の色（mp_jam_now）・渋滞情報の一覧（mp_jam_list）。はじめに道路を そろえるのに少し時間がかかる（約6万本）

-- ---------------------------------------------------------------------
-- 道路の渋滞（DB の更新67）：5分ごと。時刻（通勤・休日・帰省）・まちの人の多さ・車線・天気・事故・工事から
-- ---------------------------------------------------------------------
-- 渋滞を見る道路：高速・国道・府県道・市道の幹線・バスの通る道。まん中・長さ・まちのこみぐあい u（0〜1）・つまりやすさ b・近くの市区町村
create table if not exists public.mp_jseg (
  seg   bigint primary key references public.mp_segs(id) on delete cascade,
  cls   text not null,
  lanes smallint not null,
  nm    text not null default '',            -- 道の名前（国道101号 など。なければ ''）
  x     real not null, y real not null,      -- まん中（マス）
  len   real not null,                       -- 長さ（マス）
  u     real not null,                       -- まちのこみぐあい（人の多さから。0 いなか〜1 都心）
  b     real not null,                       -- つまりやすさ（0.8〜1.2）
  pl    text not null default '',            -- 近くの市区町村
  bus   boolean not null default false       -- バスの系統が通る
);
create index if not exists mp_jseg_xy on public.mp_jseg (x, y);
alter table public.mp_jseg enable row level security;
revoke all on public.mp_jseg from public, anon, authenticated;
-- いまの渋滞（5分ごと）：lv 1 混雑・2 渋滞・3 通行止め。why：自然渋滞・事故・工事・雪・大雨・大雪・強風・帰省
create table if not exists public.mp_jam (
  seg bigint primary key references public.mp_jseg(seg) on delete cascade,
  lv  smallint not null,
  why text not null,
  t0  timestamptz not null default now()
);
alter table public.mp_jam enable row level security;
revoke all on public.mp_jam from public, anon, authenticated;

-- 渋滞を見る道路をそろえる（1時間に1回）：新しい道路を足し、バスの通る道に印
create or replace function public._mp_jseg_sync() returns int
language plpgsql set search_path = public as $$
declare n int; bs bigint[];
begin
  bs := array(select distinct (e ->> 0)::bigint from mp_routes r, jsonb_array_elements(r.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) e where r.kind = 'bus');
  with c as (
    select s.id, s.cls, s.lanes, s.name, s.len, s.pts,
           (s.pts[2 * (array_length(s.pts, 1) / 4) + 1] / 100.0)::real x, (s.pts[2 * (array_length(s.pts, 1) / 4) + 2] / 100.0)::real y
      from mp_segs s
     where s.kind = 'road' and coalesce(array_length(s.pts, 1), 0) >= 4
       and (s.cls in ('exp', 'nat', 'pref') or (s.cls = 'city' and s.art) or s.id = any(bs))
       and not exists (select 1 from mp_jseg j where j.seg = s.id)
  )
  insert into mp_jseg(seg, cls, lanes, nm, x, y, len, u, b, pl, bus)
  select c.id, c.cls, c.lanes, c.name, c.x, c.y, c.len,
         greatest(0::float8, least(1::float8, ln(greatest(_mp_dens(c.x, c.y), 0.0001)::float8 / 3) / ln(40::float8)))::real,
         (1 + 0.2 * _wx_h3(c.id::int, 0, 0, 81))::real,
         coalesce((select case when p.k = 'ward' then coalesce((select q.name || coalesce(q.type, '') from mp_places q where q.id = p.parent), '') else '' end || p.name || coalesce(p.type, '')
                     from mp_places p where p.k in ('ward', 'muni') order by p.pt <-> point(c.x, c.y) limit 1), ''),   -- 区は「瑠璃市中里区」のように市から
         c.id = any(bs)
    from c
  on conflict (seg) do nothing;
  get diagnostics n = row_count;
  update mp_jseg j set bus = (j.seg = any(bs)) where j.bus is distinct from (j.seg = any(bs));
  update mp_jseg j set cls = s.cls, lanes = s.lanes, nm = s.name from mp_segs s where s.id = j.seg and (j.cls, j.lanes, j.nm) is distinct from (s.cls, s.lanes, s.name);
  return n;
end $$;

-- 5分ごと：いまの渋滞を決める。そのあと、バスの遅れ
--   こみぐあい rr ＝ 時刻の交通量 × 道の交通量（まちほど多い）× つまりやすさ × 天気 × 帰省 ÷ 道の流せる量（車線）
--   rr が 0.82 から混雑・1 から渋滞。事故（30分ごと・まれ）は渋滞、夜の工事は混雑。高速は 強風（最大瞬間 30m/s）・大雨（50mm）・大雪（5cm）で通行止め
--   p_at：ためすときの時刻（そのときはバスは見ない）
drop function if exists public._mp_jam_tick();
create or replace function public._mp_jam_tick(p_at timestamptz default null) returns void
language plpgsql set search_path = public as $$
declare at timestamptz := coalesce(p_at, now()); lt timestamp := coalesce(p_at, now()) at time zone 'Asia/Tokyo'; hr float8; md text; off boolean; rush int; dem float8; demx float8;
        ms bigint := floor(extract(epoch from coalesce(p_at, now())) * 1000)::bigint; slot int := floor(extract(epoch from coalesce(p_at, now())) / 1800)::int;
        dday int := floor((extract(epoch from coalesce(p_at, now())) + 32400) / 86400)::int; night boolean; wxok boolean := exists (select 1 from mp_wx_k);
begin
  if not exists (select 1 from mp_state where k = 'jseg_at' and v > now() - interval '1 hour') then
    perform _mp_jseg_sync();
    insert into mp_state values ('jseg_at', now()) on conflict (k) do update set v = excluded.v;
  end if;
  hr := extract(hour from lt) + extract(minute from lt) / 60.0;
  md := to_char(lt, 'MM-DD');
  night := hr >= 21 or hr < 5;
  -- 休日：土日・正月・GW・お盆・年末。帰省ラッシュ（高速だけ）：行きは朝〜昼、帰りは昼すぎ〜夜
  off := extract(dow from lt) in (0, 6) or md in ('01-01', '01-02', '01-03', '04-29', '05-03', '05-04', '05-05', '08-13', '08-14', '08-15', '08-16', '12-29', '12-30', '12-31');
  rush := case when md in ('12-29', '12-30', '05-03', '08-11', '08-12', '08-13') and hr >= 6 and hr < 15 then 1
               when md in ('01-02', '01-03', '05-05', '05-06', '08-15', '08-16') and hr >= 12 and hr < 22 then 2 else 0 end;
  -- 時刻の交通量（0.12〜1）：平日は朝8時と夕方6時が山、休日は昼すぎが山
  dem := case when not off then 0.12 + 0.88 * greatest(exp(-((hr - 8) / 1.1) * ((hr - 8) / 1.1)), 0.92 * exp(-((hr - 18) / 1.4) * ((hr - 18) / 1.4)),
                                                     0.55 * greatest(0::float8, least(1::float8, (hr - 5) / 3)) * greatest(0::float8, least(1::float8, (23 - hr) / 4)))
              else 0.12 + 0.88 * greatest(0.8 * exp(-((hr - 14) / 3.2) * ((hr - 14) / 3.2)), 0.35 * greatest(0::float8, least(1::float8, (hr - 6) / 3)) * greatest(0::float8, least(1::float8, (23 - hr) / 4))) end;
  -- 高速の帰省ラッシュ：行きは10時ごろ、帰りは17時ごろが山
  demx := case rush when 1 then greatest(dem, 0.5 + 0.4 * exp(-((hr - 10) / 3) * ((hr - 10) / 3))) when 2 then greatest(dem, 0.5 + 0.4 * exp(-((hr - 17) / 3) * ((hr - 17) / 3))) else dem end;
  -- 天気：25km ごとの点（高速のあるところは風も）
  drop table if exists _jwx;
  create temp table _jwx (gx int, gy int, kind text, mm float8, cm float8, fg float8, gust float8) on commit drop;
  if wxok then
    insert into _jwx
      select g.gx, g.gy, w.kind, case when w.kind = 'rain' then _wx_mm(w.inten) else 0 end, case when w.kind = 'snow' then _wx_cm(w.inten) else 0 end, w.fg,
             case when g.ex then (_wx_wind((g.gx + 0.5) * 500, (g.gy + 0.5) * 500, ms)).gust else 0 end
        from (select floor(j.x / 500)::int gx, floor(j.y / 500)::int gy, bool_or(j.cls = 'exp') ex from mp_jseg j group by 1, 2) g
        cross join lateral _wx_core((g.gx + 0.5) * 500, (g.gy + 0.5) * 500, 0, ms) w;
  end if;
  drop table if exists _jl;
  create temp table _jl on commit drop as
    with q as (
      select j.seg, j.cls, j.lanes, j.len, j.u, j.b, coalesce(w.kind, '') wk, coalesce(w.mm, 0) mm, coalesce(w.cm, 0) cm, coalesce(w.fg, 0) fg, coalesce(w.gust, 0) gu,
             (_wx_h3(j.seg::int, slot, 0, 83) + 1) / 2 ha, (_wx_h3(j.seg::int, dday, 0, 84) + 1) / 2 hw
        from mp_jseg j left join _jwx w on w.gx = floor(j.x / 500)::int and w.gy = floor(j.y / 500)::int
       where j.cls <> 'city' or j.u >= 0.5 or j.bus
    ), r as (
      select q.*,
             (case when q.cls = 'exp' then demx else dem end)
                 * (case q.cls when 'exp' then 0.55 + 0.45 * q.u when 'nat' then 0.35 + 0.65 * q.u when 'pref' then 0.25 + 0.6 * q.u when 'city' then 0.12 + 0.6 * q.u else 0.1 + 0.5 * q.u end)
                 * q.b
                 * (case when q.wk = 'snow' then 1.5 when q.mm >= 10 then 1.25 when q.wk in ('rain', 'sleet') then 1.1 when q.fg >= 0.71 and q.cls = 'exp' then 1.2 else 1 end)
                 * (case when q.cls = 'exp' and rush > 0 then 1.45 else 1 end)
                 / (case q.cls when 'exp' then case when q.lanes >= 3 then 1.4 else 1.0 end
                               when 'nat' then case when q.lanes >= 3 then 1.15 when q.lanes = 2 then 0.85 else 0.55 end
                               when 'pref' then case when q.lanes >= 2 then 0.9 else 0.6 end
                               when 'city' then case when q.lanes >= 3 then 1.1 when q.lanes = 2 then 0.85 else 0.6 end
                               else 0.5 end) rr,
             q.cls = 'exp' and (q.gu >= 30 or q.mm >= 50 or q.cm >= 5) shut,
             q.ha < 0.00001 * q.len * 0.05 * (0.5 + least(1.5, dem)) acc,
             night and q.cls in ('exp', 'nat') and q.hw < 0.003 wk2
        from q
    )
    select r.seg,
           (case when r.shut then 3 when r.acc then 2 when r.rr >= 1 then 2 when r.rr >= 0.82 or r.wk2 then 1 else 0 end)::smallint lv,
           case when r.shut then case when r.cm >= 5 then '大雪' when r.mm >= 50 then '大雨' else '強風' end
                when r.acc then '事故'
                when r.rr >= 0.82 then case when r.wk = 'snow' then '雪' when r.mm >= 10 then '大雨' when r.cls = 'exp' and rush > 0 then '帰省' else '自然渋滞' end
                when r.wk2 then '工事' else '' end why
      from r;
  delete from mp_jam m where not exists (select 1 from _jl l where l.seg = m.seg and l.lv > 0);
  insert into mp_jam(seg, lv, why, t0) select l.seg, l.lv, l.why, at from _jl l where l.lv > 0
    on conflict (seg) do update set lv = excluded.lv, why = excluded.why,
                                   t0 = case when mp_jam.lv = excluded.lv and mp_jam.why = excluded.why then mp_jam.t0 else excluded.t0 end;
  insert into mp_state values ('jam_at', at) on conflict (k) do update set v = excluded.v;
  -- バス：通る道が混んでいると遅れる
  if p_at is null then begin perform _mp_jam_bus(); exception when others then raise warning 'mp jam bus: %', sqlerrm; end; end if;
end $$;

-- バスの遅れ（渋滞）：系統の区間（バス停 → つぎのバス停）の道が混んでいると、その区間で遅くなる（混雑 7割・渋滞 4.5割・通行止めは迂回で 2.5割の速さ）。
--   運行情報に「渋滞」（えらぶ対応はない・🔔もない）。5分ごとに10分ずつのばし、混まなくなったら おわる
create or replace function public._mp_jam_bus() returns void
language plpgsql set search_path = public as $$
declare r record; q record; z mp_unko; td float8 := extract(epoch from now()); rate float8; zz bigint[]; sb text; nw int; lw jsonb; ww jsonb; st mp_stations;
begin
  for r in select ro.id, ro.stops, ro.legs, ro.own_u, ro.own_c from mp_routes ro
            where ro.kind = 'bus' and ro.ok and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false)) loop
    select max(x.lv) lv, array_agg(distinct x.o) os, (array_agg(x.nm order by x.lv desc, x.km desc))[1] nm, (array_agg(x.pl order by x.lv desc, x.km desc))[1] pl,
           sum(x.km) km, (array_agg(x.why order by x.lv desc, x.km desc))[1] why
      into q
      from (select l.o::int o, jm.lv, jm.why, js.pl, case when jm.why in ('事故', '工事') then least(3, js.len * 0.05) else js.len * 0.05 end km,
                   coalesce(nullif(js.nm, ''), case js.cls when 'exp' then '高速道路' when 'nat' then '国道' when 'pref' then '府県道' else '市道' end) nm
              from jsonb_array_elements(r.legs) with ordinality l(v, o), jsonb_array_elements(coalesce(l.v -> 'g', '[]'::jsonb)) e
              join mp_jam jm on jm.seg = (e ->> 0)::bigint join mp_jseg js on js.seg = jm.seg) x;   -- km：事故・工事は その場所だけ（3km まで）
    select * into z from mp_unko u where u.st <> 'done' and u.kind = 'traffic' and u.mode = 'bus' and u.routes @> array[r.id]
       and exists (select 1 from jsonb_array_elements(u.wins) e where e ->> 4 = 'j') order by u.id desc limit 1;
    if q.lv is null then continue; end if;   -- 混んでいない：前の乱れは、窓がおわれば おわる
    rate := case q.lv when 1 then 0.7 when 2 then 0.45 else 0.25 end;
    zz := array(select distinct s from unnest(q.os) o, unnest(array[r.stops[o], r.stops[o + 1]]) s where s is not null);
    sb := format('%s %s付近の%s（%skm）', q.nm, q.pl, case when q.lv >= 3 then '通行止め（迂回）' when q.why = '事故' then '事故渋滞' when q.lv = 1 then '混雑' else '渋滞' end, round(q.km::numeric, 1));
    if z.id is not null then
      nw := jsonb_array_length(z.wins); lw := z.wins -> (nw - 1);
      if (lw ->> 1)::float8 >= td - 60 and abs((lw ->> 2)::float8 - rate) < 0.01 then
        ww := jsonb_set(z.wins, array[(nw - 1)::text, '1'], to_jsonb(td + 600));
      else
        ww := (case when (lw ->> 1)::float8 > td then jsonb_set(z.wins, array[(nw - 1)::text, '1'], to_jsonb(td)) else z.wins end)
              || jsonb_build_array(jsonb_build_array(td, td + 600, rate, 0, 'j', 0));
      end if;
      update mp_unko set wins = ww, t_end = to_timestamp(td + 600), dur = ceil(td + 600 - extract(epoch from t0))::int, sub = sb,
             lv = greatest(lv, least(q.lv, 3)), sev = q.km, sevmax = greatest(coalesce(sevmax, 0), q.km),
             zs = array(select distinct s from unnest(coalesce(zs, '{}'::bigint[]) || zz) s),
             log = case when sub is distinct from sb then log || jsonb_build_array(jsonb_build_array(td, sb || 'で遅れています')) else log end
       where id = z.id;
    else
      select * into st from mp_stations where id = zz[1];
      if not found then continue; end if;
      insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end, mode, st, pick, pick_at, pick_auto, log, zs)
        values ('traffic', sb, st.id, st.x, st.y, array[r.id], r.own_u, r.own_c, least(q.lv, 3), q.km, q.km, 600, now(),
                jsonb_build_array(jsonb_build_array(td, td + 600, rate, 0, 'j', 0)), to_timestamp(td + 600), 'bus', 'run', 3, now(), true,
                jsonb_build_array(jsonb_build_array(td, sb || 'で遅れています')), zz);
    end if;
  end loop;
end $$;

-- まわり 20km の混みぐあい（0〜1）：道の長さで重みをつけた 混雑 1・渋滞（通行止め）2 の平均 ÷ 2。トラックの輸送力に使う
create or replace function public._mp_jam_idx(px float8, py float8) returns float8
language sql stable set search_path = public as $$
  select coalesce(sum(j.len * least(2, coalesce(m.lv, 0)))::float8 / nullif(sum(j.len)::float8 * 2, 0), 0)
    from mp_jseg j left join mp_jam m on m.seg = j.seg
   where j.x between px - 400 and px + 400 and j.y between py - 400 and py + 400 and (j.cls <> 'city' or j.u >= 0.5 or j.bus)
$$;

-- 地図の渋滞の色：見えているところ（マス。なければ国じゅう）の 混雑・渋滞・通行止めの道 [[線, lv], …]
create or replace function public.mp_jam_now(p_x0 real, p_y0 real, p_x1 real, p_y1 real) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  return jsonb_build_object('at', (select extract(epoch from v) from mp_state where k = 'jam_at'),
    's', coalesce((select jsonb_agg(jsonb_build_array(m.seg, m.lv)) from mp_jam m join mp_jseg j on j.seg = m.seg
                    where p_x0 is null or (j.x between p_x0 and p_x1 and j.y between p_y0 and p_y1)), '[]'::jsonb));
end $$;

-- 渋滞情報（一覧）：道ごと・場所ごとにまとめて、ひどい順に p_n こ（50まで）。
--   sum：混雑・渋滞の長さ（km）・通行止めの数・渋滞で遅れているバスの系統の数
create or replace function public.mp_jam_list(p_n int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g(); n int := least(greatest(coalesce(p_n, 20), 1), 50);
begin
  return jsonb_build_object('at', (select extract(epoch from v) from mp_state where k = 'jam_at'),
    'sum', (select jsonb_build_object('k1', coalesce(round((sum(x.km) filter (where x.lv = 1))::numeric), 0), 'k2', coalesce(round((sum(x.km) filter (where x.lv = 2))::numeric), 0),
                                      'n3', count(distinct x.k) filter (where x.lv = 3))
              from (select m.lv, coalesce(nullif(j.nm, ''), j.cls) || j.pl k, case when m.why in ('事故', '工事') then least(3, j.len * 0.05) else j.len * 0.05 end km
                      from mp_jam m join mp_jseg j on j.seg = m.seg) x),
    'bus', (select count(*) from mp_unko z where z.st <> 'done' and z.kind = 'traffic' and z.mode = 'bus' and exists (select 1 from jsonb_array_elements(z.wins) e where e ->> 4 = 'j')),
    'list', (select coalesce(jsonb_agg(z.g order by z.lv desc, z.km desc), '[]'::jsonb) from (
               select max(m.lv) lv, sum(case when m.why in ('事故', '工事') then least(3, j.len * 0.05) else j.len * 0.05 end) km,
                      jsonb_build_object('nm', coalesce(nullif(j.nm, ''), case j.cls when 'exp' then '高速道路' when 'nat' then '国道' when 'pref' then '府県道' else '市道' end),
                                         'c', j.cls, 'pl', j.pl, 'lv', max(m.lv), 'km', round(sum(case when m.why in ('事故', '工事') then least(3, j.len * 0.05) else j.len * 0.05 end)::numeric, 1),
                                         'why', mode() within group (order by m.why), 'x', round(avg(j.x)::numeric), 'y', round(avg(j.y)::numeric), 'n', count(*),
                                         't0', extract(epoch from min(m.t0))) g
                 from mp_jam m join mp_jseg j on j.seg = m.seg
                group by j.nm, j.pl, j.cls
                order by 1 desc, 2 desc limit n) z));
end $$;

-- 5分ごと：運行の乱れ。バスの「渋滞」は道路の渋滞から（_mp_jam_bus）なので、くじで起こすものからは はずす（DB の更新67）
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
    perform _mp_unko_new(tpk ->> 0, tpk ->> 1, s.id, s.x, s.y, s.rs, (tpk ->> 2)::int, null, null, dd, ou, oc);
  end loop;
  -- 5) 1日1回（朝4時台）：信頼が1％もどる。30日より前の記録はけす
  if hh = 4 and not exists (select 1 from mp_state where k = 'unko_day' and v >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') then
    update mp_routes set trust = least(1, trust + 0.01) where trust < 1;
    delete from mp_unko where st = 'done' and t_end < now() - interval '30 days';
    insert into mp_state values ('unko_day', now()) on conflict (k) do update set v = excluded.v;
  end if;
end $$;

-- 1時間ごと：学校・工場・トラック（トラックは、営業所のまわりの渋滞で運べる量がへる。DB の更新67）
create or replace function public._mp_sc_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare gd jsonb := _mp_goods(); rc jsonb := _mp_sc_recipes(); kd jsonb := _mp_sc_kinds();
        imul numeric := _mp_rate('sc_imp'); mmul numeric := _mp_rate('sc_mkt'); tb numeric := _mp_rate('truck_base'); tk numeric := _mp_rate('truck_km');
        fkm numeric := _mp_rate('sc_food_km'); smul numeric := _mp_rate('sc_shop'); rcm2 numeric := _mp_rate('rc_m2'); keep numeric := _mp_rate('sc_keep');
        fa record; cb record; sp record; gk text; kq numeric; need numeric; qq numeric; have numeric; mk numeric; uc numeric; amt bigint; shp bigint; bal numeric;
        gp numeric; wt numeric; buf numeric; tq numeric; ta numeric; ts numeric; nn int; mul numeric;
        rdm2 numeric := _mp_rate('rd_m2'); trkkm numeric := _mp_rate('trk_tkm'); capl numeric; ownq numeric; tr2 record;
        fp record; dkm numeric; ff bigint; ffs numeric;   -- t54o：フェリー（海をこえる荷物）
begin
  -- 学校：生徒
  perform _mp_sc_school_calc(h);
  -- 施設の売上（人・会社が動かしている施設）：学校は授業料、宿泊は宿泊料、医療・福祉は診療報酬など、娯楽は入場料など
  for fa in select scx.bld, scx.grp, (scx.st ->> 'n')::int sn, coalesce((scx.st ->> 'fee')::numeric, (kd -> scx.grp ->> 'fee')::numeric) fee, kd -> scx.grp ->> 'use' fuse,
                   coalesce(nullif(blx.name, ''), kd -> scx.grp ->> 'n') name, opx.pu, opx.pc,
                   least(1, extract(epoch from h - blx.built_at) / 3600.0)::numeric fr      -- 建ててから1時間たっていなければ、その分だけ
              from mp_sc scx join mp_blds blx on blx.id = scx.bld, lateral _mp_sc_op(scx.bld, h) opx
             where scx.grp is not null and opx.ok and not opx.gv and coalesce((scx.st ->> 'n')::int, 0) > 0 loop
    amt := round(fa.sn * fa.fee / 24 * fa.fr);
    if amt > 0 then
      perform _mp_earn(fa.pu, fa.pc, false, amt, case when fa.fuse = 'school' then 'tuition' else 'fee' end,
                       format(case fa.fuse when 'school' then '授業料：%s（%s人）' when 'hotel' then '宿泊料：%s（%s人）' when 'hospital' then '診療報酬など：%s（%s人）'
                                           else '入場料など：%s（%s人）' end, fa.name, fa.sn));
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

-- 5分ごと：道路の渋滞（pg_cron があるとき）
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-jam', '*/5 * * * *', 'select public._mp_jam_tick()');
  end if;
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない。地図の渋滞・渋滞情報は、ログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_jseg_sync', '_mp_jam_tick', '_mp_jam_bus', '_mp_jam_idx', 'mp_jam_now', 'mp_jam_list', '_mp_unko_tick', '_mp_sc_tick_hour') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- はじめの道路と渋滞（いまの時刻で）
select public._mp_jseg_sync();
insert into public.mp_state values ('jseg_at', now()) on conflict (k) do update set v = excluded.v;
select public._mp_jam_tick();
