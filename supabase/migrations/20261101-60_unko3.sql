-- 工事中の列車は運休・運行の乱れは起きた場所の近くだけ・列車の運休（1本ずつ・編成ごと）・車両の操作を1つずつ：
--   検査・改造・転属・納車のあいだ、その編成の列車は運休（発車から終点までのどこかが工事の時間にかかるもの。運賃なし）。列車のダイヤに工事中を出す
--   改造・転属・廃車・注文・編成を組む／ばらす・譲渡を受けとるは、同じ名義の操作を1つずつ（同時に押しても二重にならない。廃車のスクラップ代も1回だけ）
--   運行の乱れは、起きた駅と となりの駅のあいだ（天気は まわり約10km の駅）を通る列車だけ遅れ・運休。遠くの列車は ふだんどおり（対応をえらぶとき「全線」にもできる）
--   持ち主は、列車を1本ずつ（その日）・編成ごと（時間をきめて／乱れがおわるまで）運休にできる（mp_cxl_add・mp_cxl_del）
--   乗り入れの線路使用料は、ほんとうに走った列車だけ（運休・工事中・故障の列車はのぞく）

/* ---------- 工事中の運休・運行の乱れの範囲・列車の運休（2026-11-01・DB の更新60。t108） ----------
   - 検査・改造・転属・納車のあいだ、その編成の列車は運休（発車から終点までのどこかが工事の時間にかかる列車。地図にも出さない・運賃なし）
   - 運行の乱れは、起きた駅とそのとなりの駅のあいだ（天気は まわり約10km の駅）を通る列車だけ。遠くの列車は ふだんどおり。対応をえらぶとき「全線」にもできる
   - 持ち主は、列車を1本ずつ（その日）・編成ごと（時間をきめて／乱れがおわるまで）運休にできる ---------- */
alter table public.mp_cars add column if not exists busy_from timestamptz;    -- 工事・転属・納車のはじまり（null：前からのもの。busy_until までずっと）
alter table public.mp_unko add column if not exists zs bigint[];              -- 乱れの場所の駅（列車がきくのは、この駅と系統のとなりの駅のあいだ。null は全線：前からのもの）
alter table public.mp_unko add column if not exists wide boolean not null default false;   -- 対応を「全線」にした（これからの窓は全線。窓の6つめ 1）

-- 持ち主が決めた運休
create table if not exists public.mp_cxl (
  id bigserial primary key,
  train bigint references public.mp_trains(id) on delete cascade,   -- 1本：列車（day の日の1回）
  day date,                                                          -- 1本：運行日（日本時間。始発駅を出る日）
  form bigint references public.mp_forms(id) on delete cascade,     -- 編成ごと：この編成が入る列車（t0〜t1 に始発駅を出るもの）
  t0 timestamptz not null default now(),
  t1 timestamptz,                                                    -- 編成ごとの おわり（null：運行の乱れ unko がおわるまで）
  unko bigint references public.mp_unko(id) on delete cascade,      -- 運行の乱れの対応として
  route bigint,                                                      -- 1本：その列車の系統
  own_u uuid, own_c int,                                             -- 決めた名義（系統・編成の持ち主）
  by_u uuid,                                                         -- 押した人
  made_at timestamptz not null default now(),
  check ((train is not null and day is not null and form is null) or (train is null and day is null and form is not null))
);
create index if not exists mp_cxl_train on public.mp_cxl (train, day);
create index if not exists mp_cxl_form on public.mp_cxl (form);
create index if not exists mp_cxl_own on public.mp_cxl (own_u, own_c);
alter table public.mp_cxl enable row level security;
revoke all on public.mp_cxl from public, anon, authenticated;
revoke all on sequence public.mp_cxl_id_seq from public, anon, authenticated;

-- 編成が工事中（検査・改造・転属・納車）か：ta〜tb に、工事の時間（busy_from〜busy_until）がかかる車両があるか
create or replace function public._mp_form_busy(fid bigint, ta timestamptz, tb timestamptz) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from mp_cars c where c.form = fid and c.busy_until > ta and coalesce(c.busy_from, '-infinity'::timestamptz) < tb)
$$;
-- 編成 fids の列車が ta〜tb に走るはずの回数（毎日の列車は日ごとに。臨時列車はその日だけ）：工事をはじめる前の見つもり
create or replace function public._mp_form_runs(fids bigint[], ta timestamptz, tb timestamptz) returns int
language sql stable set search_path = public as $$
  select count(*)::int
    from mp_trains t
    cross join lateral (select g::date dd from generate_series(((ta at time zone 'Asia/Tokyo')::date - 1)::timestamp, ((tb at time zone 'Asia/Tokyo')::date)::timestamp, interval '1 day') g) d
   where t.form = any(fids) and not coalesce(t.bad, false) and jsonb_array_length(t.sched) > 1 and (t.day is null or t.day = d.dd)
     and (d.dd::timestamp + make_interval(secs => t.dep)) at time zone 'Asia/Tokyo' < tb
     and (d.dd::timestamp + make_interval(secs => coalesce((t.sched -> (jsonb_array_length(t.sched) - 1) ->> 1)::int, t.dep))) at time zone 'Asia/Tokyo' > ta
$$;
-- 持ち主が運休にした列車か：列車 tid の d（運行日）の1本、または編成 fid が入っていて dep（1970年からの秒）に始発駅を出るもの
create or replace function public._mp_cxl_on(tid bigint, d date, fid bigint, dep float8) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from mp_cxl c where c.train = tid and c.day = d)
      or (fid is not null and exists (
            select 1 from mp_cxl c left join mp_unko z on z.id = c.unko
             where c.form = fid and c.t0 <= to_timestamp(dep)
               and to_timestamp(dep) < coalesce(c.t1, case when z.st = 'done' then greatest(z.t_end, z.t0 + make_interval(secs => z.dur)) end, 'infinity'::timestamptz)))
$$;

-- 乱れの場所の駅：起きた駅。天気（風・雨・雪）は、かかわる系統の駅のうち まわり約10km（×100 マスで 20000）のもの。系統ごとに いちばん近い駅も
create or replace function public._mp_unko_zone(p_kind text, p_sta bigint, p_x int, p_y int, p_routes bigint[]) returns bigint[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct q.sid), '{}'::bigint[])
    from (select s.id sid from mp_routes ro, unnest(ro.stops) u(sid) join mp_stations s on s.id = u.sid
           where ro.id = any(p_routes) and p_kind in ('wind', 'rain', 'snow') and abs(s.x - p_x) <= 20000 and abs(s.y - p_y) <= 20000
             and (s.x - p_x)::float8 ^ 2 + (s.y - p_y)::float8 ^ 2 <= 400000000::float8
          union all
          select p_sta where p_sta is not null
          union all
          select (select s.id from unnest(ro.stops) u(sid) join mp_stations s on s.id = u.sid order by (s.x - p_x)::float8 ^ 2 + (s.y - p_y)::float8 ^ 2, s.id limit 1)
            from mp_routes ro where ro.id = any(p_routes)) q
   where q.sid is not null
$$;
-- 乱れがきく区間（系統 rid の駅の何番目〜何番目。0 から）：[[a, b], …]。場所の駅と、その となりの駅のあいだ。
--   null は全線（前からの乱れ）。冬の運休は、いま雪の多い駅（なければ起きた駅）
create or replace function public._mp_unko_zi(z mp_unko, rid bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare st bigint[]; zs bigint[]; ks int[]; out jsonb := '[]'::jsonb; a int; b int; k int; i int; n int; th real;
begin
  select ro.stops into st from mp_routes ro where ro.id = rid;
  n := coalesce(array_length(st, 1), 0);
  if n = 0 then return null; end if;
  if z.kind = 'snowstop' then
    th := case z.mode when 'bus' then 10 else 20 end;
    zs := array(select s from unnest(st) s where exists (select 1 from mp_snow sn where sn.sta = s and sn.dep >= th));
    if coalesce(cardinality(zs), 0) = 0 then zs := array[z.sta]; end if;
  else
    zs := z.zs;
    if zs is null then return null; end if;
  end if;
  ks := array(select distinct w.g from (select (q.o - 1)::int + d.v g from unnest(st) with ordinality q(s, o), unnest(array[-1, 0, 1]) d(v) where q.s = any(zs)) w
               where w.g between 0 and n - 1 order by w.g);
  if coalesce(cardinality(ks), 0) = 0 then return out; end if;
  a := ks[1]; b := ks[1];
  for i in 2..cardinality(ks) loop
    k := ks[i];
    if k = b + 1 then b := k;
    else
      if b > a then out := out || jsonb_build_array(jsonb_build_array(a, b)); end if;
      a := k; b := k;
    end if;
  end loop;
  if b > a then out := out || jsonb_build_array(jsonb_build_array(a, b)); end if;
  return out;
end $$;
-- 区間のことば（「A〜B」。いくつかあれば「・」でつなぐ）。null は「全線」
create or replace function public._mp_unko_zt(rid bigint, zi jsonb) returns text
language sql stable set search_path = public as $$
  select case when zi is null then '全線'
              else coalesce((select string_agg(coalesce(sa.name, '') || '〜' || coalesce(sb.name, ''), '・' order by e.o)
                               from mp_routes ro cross join jsonb_array_elements(zi) with ordinality e(v, o)
                               left join mp_stations sa on sa.id = ro.stops[(e.v ->> 0)::int + 1]
                               left join mp_stations sb on sb.id = ro.stops[(e.v ->> 1)::int + 1]
                              where ro.id = rid), '') end
$$;
-- 系統 rid の乱れ（ta〜tb にかかるもの）：[{id, w: [[はじめ, おわり, 速さ, 間引き, 全線], …]（はじめの順）, zi}, …]。なければ null
create or replace function public._mp_unko_rt(rid bigint, ta float8, tb float8) returns jsonb
language plpgsql stable set search_path = public as $$
declare z mp_unko; out jsonb := '[]'::jsonb; w jsonb;
begin
  for z in select * from mp_unko x where x.routes @> array[rid] and x.t0 < to_timestamp(tb) and coalesce(x.t_end, now() + interval '1 day') > to_timestamp(ta) order by x.id loop
    w := (select coalesce(jsonb_agg(jsonb_build_array((e ->> 0)::float8, (e ->> 1)::float8, (e ->> 2)::float8, coalesce((e ->> 3)::int, 0), coalesce((e ->> 5)::int, 0))
                                    order by (e ->> 0)::float8, (e ->> 1)::float8), '[]'::jsonb)
            from jsonb_array_elements(z.wins) e where (e ->> 1)::float8 > (e ->> 0)::float8 and (e ->> 2)::float8 < 1);
    if jsonb_array_length(w) = 0 then continue; end if;
    out := out || jsonb_build_array(jsonb_build_object('id', z.id, 'w', w, 'zi', _mp_unko_zi(z, rid)));
  end loop;
  return case when jsonb_array_length(out) = 0 then null else out end;
end $$;
-- 列車のとまる駅（sched の順）が、系統の駅の何番目か（0 から。見つからなければ -1）。map.js の runIdx と同じ
create or replace function public._mp_sched_idx(st bigint[], dir int, sc jsonb) returns int[]
language plpgsql immutable as $$
declare n int := coalesce(array_length(st, 1), 0); p int; q int; k int; sid bigint; out int[] := '{}'; r record;
begin
  p := case when dir = -1 then n - 1 else 0 end;
  for r in select (v ->> 0)::bigint s from jsonb_array_elements(sc) with ordinality x(v, o) order by o loop
    sid := r.s; q := -1;
    if dir = -1 then
      k := p; while k >= 0 loop if st[k + 1] = sid then q := k; exit; end if; k := k - 1; end loop;
    else
      k := p; while k < n loop if st[k + 1] = sid then q := k; exit; end if; k := k + 1; end loop;
    end if;
    if q < 0 then q := coalesce(array_position(st, sid), 0) - 1; end if;
    out := out || q;
    if q >= 0 then p := q; end if;
  end loop;
  return out;
end $$;
-- 列車1本の、運行の乱れ（map.js の unkoTrW・unkoCanW・unkoDlyW と同じ計算）：
--   L：_mp_unko_rt・st：系統の駅・legs：駅と駅のあいだ（d：m）・sc：列車の時刻・d0：始発駅を出る時刻（1970年からの秒）・tid：列車・te：遅れを見る時刻
--   乱れの区間（_mp_unko_zi）を通る列車だけ、その区間にいるあいだ窓の速さになる（区間の手前の駅で待つ）。全線の窓は、どこでも
--   運休：見合わせの窓のあいだに区間に入るはずで、見合わせ（続けて止めているところ）がはじまってから始発駅を出る列車。間引き：番号が奇数で、間引きの窓に区間に入り、窓がはじまってから出るもの
--   返すもの：{can（stop・thin・null）, dly（te の遅れ 秒）, z（運休にした乱れ）}
create or replace function public._mp_unko_trn(L jsonb, st bigint[], legs jsonb, sc jsonb, dir int, d0 float8, tid bigint, te float8) returns jsonb
language plpgsql stable as $$
declare n int; ns int := coalesce(array_length(st, 1), 0); idx int[]; cum float8[]; t0 float8; bad boolean; fwd boolean;
        ia int[]; ar float8[]; dp float8[];
        xa float8[] := '{}'; xb float8[] := '{}'; xr float8[] := '{}'; xth boolean[] := '{}'; xza float8[] := '{}'; xzb float8[] := '{}'; xzc float8[] := '{}'; xrs float8[] := '{}'; xid bigint[] := '{}';
        zz jsonb; w jsonb; zi jsonb; cs float8; ce float8; rs float8; a float8; b float8; r float8; th boolean; wide boolean;
        ka int; kb int; k int; lo int; hi int; ea int; eb int; za float8; zb float8; i int; j int; m int;
        s float8; d float8; p float8; nx float8; pr float8; it int := 0; ze float8; can text := null; cz bigint := null;
begin
  n := jsonb_array_length(sc);
  if L is null or jsonb_array_length(L) = 0 or n < 2 then return jsonb_build_object('can', null, 'dly', 0, 'z', null); end if;
  idx := _mp_sched_idx(st, dir, sc);
  bad := exists (select 1 from unnest(idx) q where q < 0);
  t0 := (sc -> 0 ->> 2)::float8;
  ar := array(select coalesce((v ->> 1)::float8, (v ->> 2)::float8) from jsonb_array_elements(sc) with ordinality x(v, o) order by o);
  dp := array(select coalesce((v ->> 2)::float8, (v ->> 1)::float8) from jsonb_array_elements(sc) with ordinality x(v, o) order by o);
  -- 系統の駅までの距離（m）
  cum := array[0::float8];
  for i in 1..greatest(ns - 1, 0) loop cum := cum || (cum[i] + coalesce((legs -> (i - 1) ->> 'd')::float8, 0)); end loop;
  fwd := idx[n] > idx[1];
  -- 窓を、この列車の区間の時刻つきに（区間がいくつかあれば、その数だけ）
  for zz in select v from jsonb_array_elements(L) with ordinality x(v, o) order by o loop
    zi := zz -> 'zi'; cs := null; ce := '-infinity';
    for w in select v from jsonb_array_elements(zz -> 'w') with ordinality x(v, o) order by o loop
      a := (w ->> 0)::float8; b := (w ->> 1)::float8; r := (w ->> 2)::float8; th := coalesce((w ->> 3)::int, 0) = 1; wide := coalesce((w ->> 4)::int, 0) = 1;
      rs := a;
      if r = 0 then
        if cs is null or ce < a - 1 then cs := a; ce := b; else ce := greatest(ce, b); end if;
        rs := cs;
      end if;
      if wide or zi is null or jsonb_typeof(zi) <> 'array' or bad then
        xa := xa || a; xb := xb || b; xr := xr || r; xth := xth || th; xza := xza || (-1e9)::float8; xzb := xzb || 1e9::float8; xzc := xzc || 0::float8; xrs := xrs || rs; xid := xid || (zz ->> 'id')::bigint;
        continue;
      end if;
      for m in 0..jsonb_array_length(zi) - 1 loop
        ka := (zi -> m ->> 0)::int; kb := (zi -> m ->> 1)::int;
        lo := least(idx[1], idx[n]); hi := greatest(idx[1], idx[n]);
        ea := greatest(ka, lo); eb := least(kb, hi);
        if eb <= ea then continue; end if;
        za := null; zb := null;
        -- 区間に入る時刻（その駅を出る・通る）と、出る時刻（その駅に着く・通る）
        for j in 0..1 loop
          k := case when (j = 0) = fwd then ea else eb end;   -- j=0 入る駅・j=1 出る駅
          for i in 1..n loop
            if idx[i] = k then
              if j = 0 then za := dp[i]; else zb := ar[i]; end if;
              exit;
            end if;
            if i < n and ((idx[i] < k and k < idx[i + 1]) or (idx[i] > k and k > idx[i + 1])) then
              pr := case when cum[idx[i + 1] + 1] <> cum[idx[i] + 1] then (cum[k + 1] - cum[idx[i] + 1]) / (cum[idx[i + 1] + 1] - cum[idx[i] + 1])
                         else (k - idx[i])::float8 / (idx[i + 1] - idx[i]) end;
              if j = 0 then za := dp[i] + (ar[i + 1] - dp[i]) * pr; else zb := dp[i] + (ar[i + 1] - dp[i]) * pr; end if;
              exit;
            end if;
          end loop;
        end loop;
        if za is null or zb is null or zb <= za then continue; end if;
        xa := xa || a; xb := xb || b; xr := xr || r; xth := xth || th; xza := xza || (za - t0); xzb := xzb || (zb - t0); xzc := xzc || (za - t0); xrs := xrs || rs; xid := xid || (zz ->> 'id')::bigint;
      end loop;
    end loop;
  end loop;
  m := coalesce(array_length(xa, 1), 0);
  if m = 0 then return jsonb_build_object('can', null, 'dly', 0, 'z', null); end if;
  -- 運休（見合わせ・間引き）
  for i in 1..m loop
    ze := d0 + xzc[i];
    if xr[i] = 0 and xa[i] <= ze and ze < xb[i] and d0 >= xrs[i] then can := 'stop'; cz := xid[i]; exit; end if;
    if xth[i] and tid % 2 = 1 and xa[i] <= ze and ze < xb[i] and d0 >= xa[i] then can := 'thin'; cz := xid[i]; exit; end if;
  end loop;
  if can is not null then return jsonb_build_object('can', can, 'dly', 0, 'z', cz); end if;
  -- 遅れ：区間にいるあいだは窓の速さ、そのほかは 1秒に 0.1秒ずつ取りもどす
  s := d0; d := 0;
  while s < te - 1e-6 and it < 400 loop
    it := it + 1;
    p := s - d0 - d; r := 1; nx := te;
    for i in 1..m loop
      if xa[i] <= s and s < xb[i] and xza[i] <= p + 1e-6 and p < xzb[i] - 1e-6 then r := least(r, xr[i]); end if;
      if xa[i] > s then nx := least(nx, xa[i]); elsif xb[i] > s then nx := least(nx, xb[i]); end if;
    end loop;
    if r < 1 then
      if r > 0 then
        for i in 1..m loop
          if xa[i] <= s and s < xb[i] then
            if p < xza[i] - 1e-6 then nx := least(nx, s + (xza[i] - p) / r);
            elsif p < xzb[i] - 1e-6 then nx := least(nx, s + (xzb[i] - p) / r); end if;
          end if;
        end loop;
      end if;
      d := d + (1 - r) * (nx - s); s := nx;
    else
      pr := case when d > 0 then 1.1 else 1 end;
      if d > 0 then nx := least(nx, s + d / 0.1); end if;
      for i in 1..m loop
        if xa[i] <= s and s < xb[i] and p < xza[i] - 1e-6 then nx := least(nx, s + (xza[i] - p) / pr); end if;
      end loop;
      d := greatest(0, d - 0.1 * (nx - s)); s := nx;
    end if;
  end loop;
  return jsonb_build_object('can', null, 'dly', d, 'z', null);
end $$;

-- 列車を運休にする（系統・編成の持ち主）：p_train と p_day で1本（その日）。p_form で編成ごと（p_hours 時間、または p_unko の乱れがおわるまで）
create or replace function public.mp_cxl_add(p_train bigint, p_day date, p_form bigint, p_hours real, p_unko bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; tr record; f mp_forms; z mp_unko; today date := (now() at time zone 'Asia/Tokyo')::date; cid bigint; t1 timestamptz;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if (p_train is null) = (p_form is null) then raise exception '列車か編成をえらんでください'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  -- おわったものは かたづける（この名義の）
  delete from mp_cxl c where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc
     and ((c.day is not null and c.day < today - 1) or (c.t1 is not null and c.t1 < now() - interval '1 day'));
  if (select count(*) from mp_cxl c where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc) >= 300 then
    raise exception '運休にしている列車が多すぎます（300まで。運休をやめてから）';
  end if;
  if p_unko is not null then
    select * into z from mp_unko where id = p_unko;
    if not found then raise exception '運行情報が見つかりません'; end if;
  end if;
  if p_train is not null then
    select t.id, t.route, t.day, ro.own_u, ro.own_c into tr from mp_trains t join mp_routes ro on ro.id = t.route where t.id = p_train;
    if not found or not (tr.own_u is not distinct from pa.pu and tr.own_c is not distinct from pa.pc) or pa.gv is distinct from (tr.own_u is null and tr.own_c is null) then
      raise exception 'この名義の列車ではありません（名義を切りかえてください）';
    end if;
    if p_day is null or p_day < today - 1 or p_day > today + 1 then raise exception '運休にできるのは、きのう・きょう・あしたの列車です'; end if;
    if tr.day is not null and tr.day <> p_day then raise exception 'この臨時列車は、その日は走りません'; end if;
    if exists (select 1 from mp_cxl where train = p_train and day = p_day) then raise exception 'もう運休にしています'; end if;
    insert into mp_cxl(train, day, route, unko, own_u, own_c, by_u) values (p_train, p_day, tr.route, p_unko, pa.pu, pa.pc, u) returning id into cid;
  else
    select * into f from mp_forms where id = p_form;
    if not found or not (f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc) or pa.gv is distinct from (f.own_u is null and f.own_c is null) then
      raise exception 'この名義の編成ではありません（名義を切りかえてください）';
    end if;
    if p_hours is null and p_unko is null then raise exception '何時間か、えらんでください'; end if;
    if p_hours is not null and (p_hours < 0.25 or p_hours > 48) then raise exception '15分〜48時間にしてください'; end if;
    if p_hours is null and z.st = 'done' then raise exception 'この乱れは、もうおわっています'; end if;
    t1 := case when p_hours is not null then now() + make_interval(secs => round(p_hours * 3600)::int) end;
    if exists (select 1 from mp_cxl c left join mp_unko x on x.id = c.unko where c.form = p_form
                and coalesce(c.t1, case when x.st = 'done' then greatest(x.t_end, x.t0 + make_interval(secs => x.dur)) end, 'infinity'::timestamptz) > now()) then
      raise exception 'この編成は、もう運休にしています（やめてから、もう一度）';
    end if;
    insert into mp_cxl(form, t0, t1, unko, own_u, own_c, by_u) values (p_form, now(), t1, case when p_hours is null then p_unko end, pa.pu, pa.pc, u) returning id into cid;
  end if;
  return jsonb_build_object('id', cid);
end $$;
-- 運休をやめる：1本はけす。編成ごとは いまでおわり（おわったところまでは運休のまま）
create or replace function public.mp_cxl_del(p_id bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; c mp_cxl;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into c from mp_cxl where id = p_id for update;
  if not found or not (c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc) or pa.gv is distinct from (c.own_u is null and c.own_c is null) then
    raise exception '運休が見つかりません（名義を切りかえてください）';
  end if;
  if c.form is not null then update mp_cxl set t1 = now(), unko = null where id = p_id;
  else delete from mp_cxl where id = p_id; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---- 直す関数 ----
create or replace function public.mp_car_order(p_type text, p_n int, p_depot bigint, p_as text, p_dry boolean, p_maker bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; t mp_types; d mp_depots; have int; k text; s int; i int; nums text[] := '{}'; cost bigint; cid bigint; fid bigint; hrs int; fnm text; mk jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '車両は人か会社で持ちます'; end if;
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;   -- 同じ名義の操作は1つずつ（車庫の空き・車番がかさならないように。DB の更新60）
  select * into t from mp_types where code = p_type and on_sale;
  if not found then raise exception 'その形式は注文できません'; end if;
  if p_n < 1 or p_n > 20 then raise exception '一度に1〜20両です'; end if;
  if t.role = 'Ship' and p_n > 4 then raise exception '船は一度に4隻までです'; end if;
  if t.role = 'Air' and p_n > 4 then raise exception '飛行機は一度に4機までです'; end if;
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_dep_ok(d, pa.pu, pa.pc) then raise exception '車籍を置く車庫をえらんでください（この名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
  if _mp_role_kind(t.role) <> d.kind then raise exception '%', case when t.role = 'Ship' then '船は港（フェリーターミナル）に置きます' when t.role = 'Air' then '飛行機は空港の駐機場に置きます'
    when d.kind = 'ship' then '港に置けるのは船だけです' when d.kind = 'air' then '空港に置けるのは飛行機だけです' when t.role = 'Truck' then 'トラックは営業所に置きます' when t.role = 'Bus' then 'バスは営業所に置きます' else '電車は車両基地に置きます' end; end if;
  if t.role = 'Air' and coalesce(t.rwy, 0) > coalesce((select s.plat from mp_stations s where s.bld = d.bld and s.kind = 'air'), 0) then   -- 滑走路（t54p）
    raise exception '「%」の滑走路（%m）では、%は離着陸できません（%m以上いります）', d.name, (select s.plat from mp_stations s where s.bld = d.bld and s.kind = 'air'), t.label, t.rwy;
  end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + p_n > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  k := _mp_okey(pa.pu, pa.pc);
  select coalesce(n, 0) into s from mp_serials where owner = k and type = p_type;
  s := coalesce(s, 0);
  if t.num_from + s + p_n - 1 > t.num_to then raise exception 'この形式の車番がいっぱいです（%〜%）', t.num_from, t.num_to; end if;
  cost := t.price * p_n;
  hrs := case when t.role in ('Bus', 'Truck') then 3 when t.role = 'Ship' then 24 when t.role = 'Air' then 48 else 6 end;   -- 船は国のメーカーで24時間（t54o）・飛行機は48時間（t54p）
  if p_maker is not null then   -- 鉄道車両工場（払い・鉄鋼はここで）
    mk := _mp_maker_order(p_maker, pa.pu, pa.pc, array_fill(p_type, array[p_n]), p_dry);
    cost := (mk ->> 'cost')::bigint; hrs := (mk ->> 'hours')::int;
  end if;
  if p_dry then
    return jsonb_build_object('cost', cost, 'nums', (select jsonb_agg(_mp_carnum(t, t.num_from + s + i)) from generate_series(0, p_n - 1) i), 'hours', hrs, 'upkeep', t.upkeep * p_n,
                              'maker', mk ->> 'maker', 'self', mk -> 'self', 'steel', mk -> 'steel');
  end if;
  if p_maker is null then perform _mp_pay(pa.pu, pa.pc, false, cost, 'car', format(case when t.role = 'Ship' then '%s を %s隻 注文' when t.role = 'Air' then '%s を %s機 注文' else '%s を %s両 注文' end, t.label, p_n)); end if;
  insert into mp_serials(owner, type, n) values (k, p_type, s + p_n) on conflict (owner, type) do update set n = excluded.n;
  for i in 0..p_n - 1 loop
    insert into mp_cars(type, num, own_u, own_c, depot, heat, ac, toilet, busy_from, busy_until, busy_kind, price)
    values (p_type, _mp_carnum(t, t.num_from + s + i), pa.pu, pa.pc, p_depot, t.heat, t.ac, t.toilet, now(), now() + make_interval(hours => hrs), 'deliver', round(cost::numeric / p_n)::bigint)
    returning id into cid;
    insert into mp_car_hist(car, k, num, type, ou, oc, d) values (cid, 'new', _mp_carnum(t, t.num_from + s + i), p_type, pa.pu, pa.pc,
      jsonb_build_object('dep', d.name) || case when mk is not null then jsonb_build_object('maker', mk ->> 'maker') else '{}'::jsonb end);
    nums := nums || _mp_carnum(t, t.num_from + s + i);
    -- バス・船・飛行機は1台（1隻・1機）で1編成（編成番号は車番。同じ名前の編成があれば「*」をつける）
    if t.role in ('Bus', 'Ship', 'Air') then
      fnm := _mp_carnum(t, t.num_from + s + i);
      while exists (select 1 from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.name = fnm) loop fnm := fnm || '*'; end loop;
      insert into mp_forms(name, own_u, own_c, depot) values (fnm, pa.pu, pa.pc, p_depot) returning id into fid;
      update mp_cars set form = fid, pos = 1 where id = cid;
    end if;
  end loop;
  return jsonb_build_object('nums', to_jsonb(nums), 'cost', cost, 'hours', hrs);
end $$;

create or replace function public.mp_form_set(p_form bigint, p_cars bigint[], p_name text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; why text; dep bigint; nd int; f mp_forms; i int; old bigint[]; fee bigint := 0; nbusy int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  perform _mp_lock(pa.pu, pa.pc);   -- 同じ名義の操作は1つずつ（DB の更新60）
  perform 1 from mp_cars where id = any(p_cars) for update;   -- 車両をおさえてから持ち主を見る（ゆずる・廃車と同時にならないように）
  if exists (select 1 from unnest(p_cars) x where not exists (select 1 from mp_cars c where c.id = x and c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc)) then
    raise exception 'この名義の車両ではないものがあります';
  end if;
  if (select count(distinct x) from unnest(p_cars) x) <> coalesce(array_length(p_cars, 1), 0) then raise exception '同じ車両が2回入っています'; end if;
  select count(distinct depot), min(depot) into nd, dep from mp_cars where id = any(p_cars);
  if nd > 1 then raise exception 'ちがう車庫の車両はつなげません（先に転属を）'; end if;
  select count(*) into nbusy from mp_cars where id = any(p_cars) and busy_until > now() and busy_kind <> 'deliver';
  if nbusy > 0 then raise exception '検査・改造・転属中の車両があります'; end if;
  why := _mp_form_rule(p_cars);
  if why is not null then raise exception '%', why; end if;
  -- 編成番号（持ち主ごとに1つずつ）
  if p_form is null and trim(coalesce(p_name, '')) = '' then raise exception '編成番号を入れてください'; end if;
  if trim(coalesce(p_name, '')) <> '' and exists (select 1 from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc
                                                     and x.name = left(trim(p_name), 20) and x.id is distinct from p_form) then
    raise exception '編成番号「%」はもうあります', left(trim(p_name), 20);
  end if;
  if p_form is not null then
    select * into f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
    if not found then raise exception '編成が見つかりません'; end if;
    old := array(select id from mp_cars where form = p_form order by pos);
    if old is distinct from p_cars then fee := 100000 * (select count(*) from unnest(p_cars) x where not (x = any(old))) + 50000; end if;   -- 組みかえの手間
  end if;
  -- ほかの編成から抜く（抜かれた編成は、のこりの車でもう一度きまりを見る → だめなら運用から外す）
  update mp_cars set form = null, pos = 0 where id = any(p_cars) and form is distinct from p_form;
  if p_form is null then
    insert into mp_forms(name, own_u, own_c, depot) values (left(trim(p_name), 20), pa.pu, pa.pc, dep) returning * into f;
  else
    update mp_cars set form = null, pos = 0 where form = p_form and not (id = any(p_cars));
    update mp_forms set name = coalesce(nullif(left(trim(p_name), 20), ''), name), depot = dep where id = p_form;
  end if;
  for i in 1..array_length(p_cars, 1) loop update mp_cars set form = f.id, pos = i where id = p_cars[i]; end loop;
  if fee > 0 then perform _mp_pay(pa.pu, pa.pc, false, fee, 'car', format('編成「%s」の組みかえ', f.name)); end if;
  -- 空になった編成・きまりに合わなくなった編成は、運用と列車からはずす
  perform _mp_form_drop(array(select x.id from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.id <> f.id
                      and _mp_form_rule(array(select c.id from mp_cars c where c.form = x.id order by c.pos)) is not null), '編成が組みかわったので、運用からはずれました');
  delete from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and not exists (select 1 from mp_cars c where c.form = x.id);
  -- 組みかえた編成の列車（運用）は、時刻を計算しなおす（長さ・性能が変わる）
  perform _mp_resched(rr) from _mp_form_routes(f.id) rr;
  return jsonb_build_object('id', f.id, 'perf', _mp_form_perf(f.id), 'fee', fee);
end $$;

create or replace function public.mp_form_del(p_form bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  perform _mp_lock(pa.pu, pa.pc);   -- 同じ名義の操作は1つずつ（DB の更新60）
  perform 1 from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;   -- ゆずると同時にならないように
  if not found then raise exception '編成が見つかりません'; end if;
  if exists (select 1 from mp_cars c join mp_types t on t.code = c.type where c.form = p_form and t.role in ('Bus', 'Ship', 'Air')) then raise exception 'バス・船・飛行機はばらせません'; end if;
  perform _mp_form_drop(array[p_form], '編成がばらされたので、運用からはずれました');
  update mp_cars set form = null, pos = 0 where form = p_form;
  delete from mp_forms where id = p_form;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mp_car_work(p_cars bigint[], p_kind text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; c record; cost bigint := 0; n int := 0; hrs int; skip text := ''; label text; one bigint; subs bigint := 0; sb bigint; busn int := 0; ids bigint[] := '{}';
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  hrs := case p_kind when 'ac' then 24 when 'heat' then 6 when 'toilet' then 12 when 'inspect' then 4 when 'renew' then 48 when 'snow' then 48 else null end;
  label := case p_kind when 'ac' then '冷房化' when 'heat' then '暖房の取りつけ' when 'toilet' then 'トイレの取りつけ' when 'inspect' then '検査' when 'renew' then '更新工事' when 'snow' then '雪の対策' end;
  if hrs is null then raise exception '工事の種類がちがいます'; end if;
  if not coalesce(p_dry, false) then   -- 同じ名義の操作は1つずつ・車両をおさえる（2回押しても二重にならないように。DB の更新60）
    perform _mp_lock(pa.pu, pa.pc);
    perform 1 from mp_cars where id = any(p_cars) for update;
  end if;
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
    cost := cost + one; n := n + 1; ids := ids || c.id;
    if not p_dry then
      update mp_cars set busy_from = now(), busy_until = now() + make_interval(hours => case when p_kind = 'snow' and c.role in ('Bus', 'Truck') then 6 else hrs end), busy_kind = p_kind,
             ac = ac or p_kind = 'ac', heat = heat or p_kind = 'heat', toilet = toilet or p_kind = 'toilet', snow = snow or p_kind = 'snow',
             cond = case when p_kind = 'inspect' then least(100, cond + 35) when p_kind = 'renew' then 100 else cond end,
             renewed = renewed + case when p_kind = 'renew' then 1 else 0 end
       where id = c.id and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    end if;
  end loop;
  if n = 0 then raise exception 'できる車両がありません%', case when skip <> '' then '（' || left(trim(skip), 120) || '）' else '' end; end if;
  if not p_dry then perform _mp_pay(pa.pu, pa.pc, false, cost, case when p_kind = 'snow' then 'snow' else 'car' end,
                                    format(case when (select bool_and(t.role = 'Ship') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '船の%s（%s隻）'
                                                when (select bool_and(t.role = 'Air') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '飛行機の%s（%s機）' else '車両の%s（%s両）' end, label, n)
                                    || case when subs > 0 then format('（補助金 %s X）', _mp_snow_x(subs)) else '' end); end if;
  return jsonb_build_object('n', n, 'cost', cost, 'hours', case when p_kind = 'snow' and busn = n then 6 else hrs end, 'skip', trim(skip), 'sub', subs,
    -- 工事のあいだに運休になる列車（のべ。DB の更新60）
    'trains', case when p_dry then _mp_form_runs(array(select distinct x.form from mp_cars x where x.id = any(ids) and x.form is not null), now(),
                                                 now() + make_interval(hours => case when p_kind = 'snow' and busn = n then 6 else hrs end)) end);
end $$;

create or replace function public.mp_car_move(p_cars bigint[], p_depot bigint, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; d mp_depots; nd int; src mp_depots; same boolean; cost bigint := 0; hrs int; c record; n int := 0; have int; forms bigint[];
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if not coalesce(p_dry, false) then   -- 同じ名義の操作は1つずつ・車両をおさえる（DB の更新60）
    perform _mp_lock(pa.pu, pa.pc);
    perform 1 from mp_cars where id = any(p_cars) for update;
  end if;
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_dep_ok(d, pa.pu, pa.pc) then raise exception 'うつす先の車庫をえらんでください（この名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
  select count(distinct depot) into nd from mp_cars where id = any(p_cars);
  if nd <> 1 then raise exception '同じ車庫の車両をえらんでください'; end if;
  select x.* into src from mp_depots x where x.id = (select depot from mp_cars where id = p_cars[1]);
  if src.id = d.id then raise exception 'もうその車庫の車両です'; end if;
  if src.kind <> d.kind then raise exception '電車は車両基地、バスは営業所、船は港、飛行機は空港にしか置けません'; end if;
  if d.kind = 'air' and exists (select 1 from mp_cars xc join mp_types xt on xt.code = xc.type where xc.id = any(p_cars) and coalesce(xt.rwy, 0) > coalesce((select xs.plat from mp_stations xs where xs.bld = d.bld and xs.kind = 'air'), 0)) then
    raise exception '「%」の滑走路（%m）では離着陸できない飛行機があります', d.name, (select s.plat from mp_stations s where s.bld = d.bld and s.kind = 'air');   -- t54p
  end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + array_length(p_cars, 1) > d.cap then raise exception 'うつす先の車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  same := d.kind = 'rail' and (select net from mp_segs where id = src.seg) = (select net from mp_segs where id = d.seg);
  hrs := case when d.kind = 'bus' then 2 when d.kind = 'ship' then greatest(3, ceil(sqrt(((d.x - src.x) / 100.0) ^ 2 + ((d.y - src.y) / 100.0) ^ 2) * 0.05 * 1.3 / 25))::int   -- 船：回航（およそ25km/h）
              when d.kind = 'air' then 2   -- 飛行機：回航（飛んでいく。t54p）
              when same then 2 else 12 end;
  for c in select x.*, t.price tprice from mp_cars x join mp_types t on t.code = x.type
            where x.id = any(p_cars) and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc loop
    if c.busy_until > now() then raise exception '%は工事中・納車前です', c.num; end if;
    cost := cost + round(c.tprice * case when d.kind in ('bus', 'ship', 'air') or same then 0.005 else 0.03 end); n := n + 1;
  end loop;
  if n <> array_length(p_cars, 1) then raise exception 'この名義の車両ではないものがあります'; end if;
  if p_dry then return jsonb_build_object('cost', cost, 'hours', hrs,
    'trains', _mp_form_runs(array(select f.id from mp_forms f where f.id in (select x.form from mp_cars x where x.id = any(p_cars) and x.form is not null)
                                    and not exists (select 1 from mp_cars o where o.form = f.id and not (o.id = any(p_cars)))), now(), now() + make_interval(hours => hrs)),   -- 編成ごと動くときの運休（DB の更新60）
    'how', case when d.kind = 'bus' then '回送' when d.kind in ('ship', 'air') then '回航' when same then '回送（線路でつながっています）' else '陸送（線路でつながっていません）' end); end if;
  perform _mp_pay(pa.pu, pa.pc, false, cost, 'car', format(case when d.kind = 'ship' then '%s隻を「%s」へ回航' when d.kind = 'air' then '%s機を「%s」へ回航' else '%s両を「%s」へ転属' end, n, d.name));
  insert into mp_car_hist(car, k, num, type, ou, oc, d)
    select cc.id, 'move', cc.num, cc.type, cc.own_u, cc.own_c, jsonb_build_object('dep', src.name, 'to', d.name, 'how', case when d.kind in ('ship', 'air') then '回航' when same or d.kind = 'bus' then '回送' else '陸送' end)
      from mp_cars cc where cc.id = any(p_cars);
  -- 編成ぜんぶが動くなら編成ごと。一部だけなら、その車は編成から外れる
  forms := array(select distinct form from mp_cars where id = any(p_cars) and form is not null);
  update mp_cars set form = null, pos = 0 where id = any(p_cars) and form is not null
     and exists (select 1 from mp_cars o where o.form = mp_cars.form and not (o.id = any(p_cars)));
  update mp_cars set depot = p_depot, busy_from = now(), busy_until = now() + make_interval(hours => hrs), busy_kind = 'move'
   where id = any(p_cars) and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  update mp_forms f set depot = p_depot where f.id = any(forms) and not exists (select 1 from mp_cars cc where cc.form = f.id and cc.depot <> p_depot);
  perform _mp_form_drop(array(select x from unnest(forms) x where _mp_form_rule(array(select cc.id from mp_cars cc where cc.form = x order by cc.pos)) is not null),
                        '編成が組みかわったので、運用からはずれました');
  delete from mp_forms f where f.id = any(forms) and not exists (select 1 from mp_cars cc where cc.form = f.id);
  return jsonb_build_object('n', n, 'cost', cost, 'hours', hrs);
end $$;

create or replace function public.mp_car_scrap(p_cars bigint[], p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; back bigint; n int; forms bigint[]; sh boolean; ai boolean;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if not coalesce(p_dry, false) then   -- 同じ名義の操作は1つずつ・車両をおさえる（スクラップ代を二重にもらえないように。DB の更新60）
    perform _mp_lock(pa.pu, pa.pc);
    perform 1 from mp_cars where id = any(p_cars) for update;
  end if;
  select count(*), coalesce(sum(round(t.price * 0.03)), 0), coalesce(bool_and(t.role = 'Ship'), false), coalesce(bool_and(t.role = 'Air'), false) into n, back, sh, ai from mp_cars c join mp_types t on t.code = c.type
   where c.id = any(p_cars) and c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc;
  if n = 0 or n <> array_length(p_cars, 1) then raise exception 'この名義の車両ではないものがあります'; end if;
  if exists (select 1 from mp_cars where id = any(p_cars) and busy_until > now() and busy_kind = 'deliver') then raise exception '納車前の車両は廃車にできません'; end if;
  if p_dry then return jsonb_build_object('n', n, 'back', back); end if;
  forms := array(select distinct form from mp_cars where id = any(p_cars) and form is not null);
  insert into mp_car_hist(car, k, num, type, ou, oc, d)
    select c.id, 'scrap', c.num, c.type, c.own_u, c.own_c, jsonb_build_object('dep', coalesce((select dd.name from mp_depots dd where dd.id = c.depot), '')) from mp_cars c where c.id = any(p_cars);
  -- スクラップ代は、ほんとうに消した車両の分だけ（DB の更新60）
  with del as (delete from mp_cars c where c.id = any(p_cars) and c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc returning c.type)
  select count(*), coalesce(sum(round(t.price * 0.03)), 0) into n, back from del join mp_types t on t.code = del.type;
  if n <> array_length(p_cars, 1) then raise exception 'この名義の車両ではないものがあります'; end if;
  perform _mp_form_drop(array(select x from unnest(forms) x where _mp_form_rule(array(select c.id from mp_cars c where c.form = x order by c.pos)) is not null),
                        '編成の車両が廃車になったので、運用からはずれました');
  delete from mp_forms f where f.id = any(forms) and not exists (select 1 from mp_cars c where c.form = f.id);
  perform _mp_earn(pa.pu, pa.pc, false, back, 'car', format(case when sh then '%s隻を廃船（スクラップ代）' when ai then '%s機を廃機（スクラップ代）' else '%s両を廃車（スクラップ代）' end, n));
  return jsonb_build_object('n', n, 'back', back);
end $$;

create or replace function public.mp_form_order(p_types text[], p_name text, p_depot bigint, p_as text, p_dry boolean, p_maker bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; d mp_depots; why text; nc int := coalesce(array_length(p_types, 1), 0); have int; k text; t mp_types; i int;
        cnt jsonb := '{}'::jsonb; s int; nums text[] := '{}'; cost bigint := 0; up bigint := 0; fid bigint; nm text := left(trim(coalesce(p_name, '')), 20); hrs int := 6; ky text; vv text; cid bigint;
        mk jsonb; lst bigint := 0;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '車両は人か会社で持ちます'; end if;
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;   -- 同じ名義の操作は1つずつ（車庫の空き・車番がかさならないように。DB の更新60）
  if nc = 0 then raise exception '形式をえらんでください'; end if;
  if exists (select 1 from unnest(p_types) x where not exists (select 1 from mp_types y where y.code = x and y.on_sale)) then raise exception 'その形式は注文できません'; end if;
  if exists (select 1 from unnest(p_types) x join mp_types y on y.code = x where y.role in ('Bus', 'Truck', 'Ship', 'Air')) then raise exception 'バス・トラック・船・飛行機は1台ずつ注文してください'; end if;
  why := _mp_form_rule_t(p_types);
  if why is not null then raise exception '%', why; end if;
  if nm = '' then raise exception '編成番号を入れてください'; end if;
  if exists (select 1 from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc and f.name = nm) then raise exception '編成番号「%」はもうあります', nm; end if;
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_same(d.own_u, d.own_c, false, pa.pu, pa.pc, false) then raise exception '車籍を置く車庫をえらんでください（この名義の車庫）'; end if;
  if d.kind <> 'rail' then raise exception '電車は車両基地に置きます'; end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + nc > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  k := _mp_okey(pa.pu, pa.pc);
  -- 車番：形式ごとに、持ち主の続きから
  for i in 1..nc loop
    select * into t from mp_types where code = p_types[i];
    s := coalesce((select z.n from mp_serials z where z.owner = k and z.type = t.code), 0) + coalesce((cnt ->> t.code)::int, 0);
    if t.num_from + s > t.num_to then raise exception '%の車番がいっぱいです（%〜%）', t.label, t.num_from, t.num_to; end if;
    nums := nums || _mp_carnum(t, t.num_from + s);
    cnt := cnt || jsonb_build_object(t.code, coalesce((cnt ->> t.code)::int, 0) + 1);
    cost := cost + t.price; up := up + t.upkeep;
  end loop;
  lst := cost;
  if p_maker is not null then   -- 鉄道車両工場（払い・鉄鋼はここで）
    mk := _mp_maker_order(p_maker, pa.pu, pa.pc, p_types, p_dry);
    cost := (mk ->> 'cost')::bigint; hrs := (mk ->> 'hours')::int;
  end if;
  if p_dry then return jsonb_build_object('cost', cost, 'nums', to_jsonb(nums), 'hours', hrs, 'upkeep', up, 'n', nc, 'maker', mk ->> 'maker', 'self', mk -> 'self', 'steel', mk -> 'steel'); end if;
  if p_maker is null then perform _mp_pay(pa.pu, pa.pc, false, cost, 'car', format('編成「%s」（%s両）を注文', nm, nc)); end if;
  insert into mp_forms(name, own_u, own_c, depot) values (nm, pa.pu, pa.pc, p_depot) returning id into fid;
  for i in 1..nc loop
    select * into t from mp_types where code = p_types[i];
    insert into mp_cars(type, num, own_u, own_c, depot, form, pos, heat, ac, toilet, busy_from, busy_until, busy_kind, price)
    values (t.code, nums[i], pa.pu, pa.pc, p_depot, fid, i, t.heat, t.ac, t.toilet, now(), now() + make_interval(hours => hrs), 'deliver',
            case when mk is null then t.price else round(t.price::numeric * cost / greatest(lst, 1))::bigint end)
    returning id into cid;
    insert into mp_car_hist(car, k, num, type, ou, oc, d) values (cid, 'new', nums[i], t.code, pa.pu, pa.pc,
      jsonb_build_object('dep', d.name) || case when mk is not null then jsonb_build_object('maker', mk ->> 'maker') else '{}'::jsonb end);
  end loop;
  for ky, vv in select * from jsonb_each_text(cnt) loop
    insert into mp_serials(owner, type, n) values (k, ky, vv::int) on conflict (owner, type) do update set n = mp_serials.n + excluded.n;
  end loop;
  return jsonb_build_object('id', fid, 'name', nm, 'nums', to_jsonb(nums), 'cost', cost, 'hours', hrs);
end $$;

create or replace function public.mp_xfer_accept(p_id bigint, p_depot bigint, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); me_cs int[]; x mp_xfers; f mp_forms; d mp_depots; ncar int; have int; nm text; k text; c record; s int; t mp_types; rail boolean; tonm text; fromnm text; n0 text; knd text;
begin
  perform _mp_ok(u);
  me_cs := array(select id from companies where owner = u);
  select * into x from mp_xfers where id = p_id and st = 'offer' for update;
  if not found or not coalesce(x.to_u = u or x.to_c = any(me_cs), false) then raise exception '申しこみが見つかりません'; end if;
  if x.to_c is not null and (select status from companies where id = x.to_c) <> 'active' then raise exception 'この会社は、いまは使えません'; end if;
  perform _mp_lock(x.to_u, x.to_c);   -- 受けとる名義の操作は1つずつ（車庫の空き・車番。DB の更新60）
  tonm := _mp_pname(x.to_u, x.to_c, false); fromnm := _mp_pname(x.from_u, x.from_c, false);
  -- 1両ずつ（t54h）
  if x.form is null then
    ncar := coalesce(array_length(x.cars, 1), 0);
    perform 1 from mp_cars where id = any(x.cars) for update;
    if ncar = 0 or (select count(*) from mp_cars where id = any(x.cars) and own_u is not distinct from x.from_u and own_c is not distinct from x.from_c and form is null) <> ncar then
      raise exception 'この車両は、もう相手のものではないか、編成に入っています';
    end if;
    knd := coalesce((select case when bool_or(ty.role = 'Ship') then 'ship' when bool_or(ty.role = 'Air') then 'air' when bool_or(ty.role in ('Bus', 'Truck')) then 'bus' else 'rail' end
                       from mp_cars cc join mp_types ty on ty.code = cc.type where cc.id = any(x.cars)), 'rail');   -- t54o：船も
    select * into d from mp_depots where id = p_depot;
    if not found or not _mp_dep_ok(d, x.to_u, x.to_c) then raise exception '車籍を置く車庫をえらんでください（受けとる名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
    if d.kind <> knd then raise exception '%', case knd when 'rail' then '電車は車両基地に置きます' when 'ship' then '船は港に置きます' when 'air' then '飛行機は空港の駐機場に置きます' else 'バスは営業所に置きます' end; end if;
    select count(*) into have from mp_cars where depot = p_depot;
    if have + ncar > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
    if x.price > 0 then
      perform _mp_pay(x.to_u, x.to_c, false, x.price, 'car', format('車両%s両をゆずり受けた', ncar));
      perform _mp_earn(x.from_u, x.from_c, false, x.price, 'car', format('車両%s両をゆずった', ncar));
    end if;
    k := _mp_okey(x.to_u, x.to_c);
    for c in select cc.id, cc.type, cc.num from mp_cars cc where cc.id = any(x.cars) order by array_position(x.cars, cc.id) loop
      select * into t from mp_types where code = c.type;
      s := coalesce((select z.n from mp_serials z where z.owner = k and z.type = t.code), 0);
      if t.num_from + s > t.num_to then raise exception '%の車番がいっぱいです（%〜%）', t.label, t.num_from, t.num_to; end if;
      insert into mp_serials(owner, type, n) values (k, t.code, s + 1) on conflict (owner, type) do update set n = excluded.n;
      update mp_cars set num = _mp_carnum(t, t.num_from + s), own_u = x.to_u, own_c = x.to_c, depot = p_depot,
             busy_from = case when busy_until > now() then busy_from else now() end, busy_until = greatest(coalesce(busy_until, now()), now() + interval '12 hours'), busy_kind = 'move' where id = c.id;
      insert into mp_car_hist(car, k, num, type, ou, oc, d) values (c.id, 'xfer', _mp_carnum(t, t.num_from + s), c.type, x.to_u, x.to_c, jsonb_build_object('from', fromnm, 'to', tonm, 'num0', c.num, 'dep', d.name));
    end loop;
    update mp_xfers set st = 'done', decided_at = now() where id = x.id;
    perform _notice_l(coalesce(x.from_u, (select owner from companies where id = x.from_c)),
      format('【国土】車両%s両の譲渡を、%sが受けとりました（%s X）。', ncar, tonm, _fmt(x.price)), jsonb_build_object('go', 'map', 'k', 'xfer'), null);
    return jsonb_build_object('n', ncar, 'price', x.price);
  end if;
  select * into f from mp_forms where id = x.form for update;
  if not found or not (f.own_u is not distinct from x.from_u and f.own_c is not distinct from x.from_c) then raise exception 'この編成は、もう相手のものではありません'; end if;
  ncar := (select count(*) from mp_cars where form = f.id);
  if ncar = 0 then raise exception 'この編成には車両がありません'; end if;
  knd := _mp_form_kind(f.id);   -- t54o：船も
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_dep_ok(d, x.to_u, x.to_c) then raise exception '車籍を置く車庫をえらんでください（受けとる名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
  if d.kind <> knd then raise exception '%', case knd when 'rail' then '電車は車両基地に置きます' when 'ship' then '船は港に置きます' when 'air' then '飛行機は空港の駐機場に置きます' else 'バスは営業所に置きます' end; end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + ncar > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  nm := coalesce(nullif(left(trim(coalesce(p_name, '')), 20), ''), f.name);
  if exists (select 1 from mp_forms y where y.own_u is not distinct from x.to_u and y.own_c is not distinct from x.to_c and y.name = nm) then
    raise exception '編成番号「%」はもうあります（ちがう編成番号を入れてください）', nm;
  end if;
  -- 代金（受けとる名義 → ゆずる名義）
  if x.price > 0 then
    perform _mp_pay(x.to_u, x.to_c, false, x.price, 'car', format('編成「%s」（%s両）をゆずり受けた', f.name, ncar));
    perform _mp_earn(x.from_u, x.from_c, false, x.price, 'car', format('編成「%s」（%s両）をゆずった', f.name, ncar));
  end if;
  -- ゆずる側の運用・列車からはずす
  perform _mp_form_drop(array[f.id], '編成をゆずったので、運用からはずれました');
  -- 車番は、受けとる名義の続きに
  k := _mp_okey(x.to_u, x.to_c);
  for c in select cc.id, cc.type, cc.num from mp_cars cc where cc.form = f.id order by cc.pos loop
    select * into t from mp_types where code = c.type;
    s := coalesce((select z.n from mp_serials z where z.owner = k and z.type = t.code), 0);
    if t.num_from + s > t.num_to then raise exception '%の車番がいっぱいです（%〜%）', t.label, t.num_from, t.num_to; end if;
    insert into mp_serials(owner, type, n) values (k, t.code, s + 1) on conflict (owner, type) do update set n = excluded.n;
    update mp_cars set num = _mp_carnum(t, t.num_from + s), own_u = x.to_u, own_c = x.to_c, depot = p_depot,
           busy_from = case when busy_until > now() then busy_from else now() end, busy_until = greatest(coalesce(busy_until, now()), now() + interval '12 hours'), busy_kind = 'move' where id = c.id;
    insert into mp_car_hist(car, k, num, type, ou, oc, d) values (c.id, 'xfer', _mp_carnum(t, t.num_from + s), c.type, x.to_u, x.to_c, jsonb_build_object('from', fromnm, 'to', tonm, 'num0', c.num, 'dep', d.name, 'form', nm));
  end loop;
  update mp_forms set own_u = x.to_u, own_c = x.to_c, depot = p_depot, name = nm where id = f.id;
  update mp_xfers set st = 'done', decided_at = now() where id = x.id;
  perform _notice_l(coalesce(x.from_u, (select owner from companies where id = x.from_c)),
    format('【国土】編成「%s」（%s両）の譲渡を、%sが受けとりました（%s X）。', f.name, ncar, tonm, _fmt(x.price)), jsonb_build_object('go', 'map', 'k', 'xfer'), null);
  return jsonb_build_object('id', f.id, 'name', nm, 'n', ncar, 'price', x.price);
end $$;

create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean;
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'mine', mine, 'ok', r.ok, 'why', r.why, 'dwell', r.dwell,
    'owner', _mp_pname(r.own_u, r.own_c, false), 'timing', to_jsonb(r.timing), 'last', r.last, 'xwait', r.xwait,
    'undo', case when mine then (select jsonb_build_object('what', h.what, 'at', h.at, 'n', (select count(*) from mp_dia_hist x where x.route = r.id))
                                   from mp_dia_hist h where h.route = r.id order by h.id desc limit 1) end,
    -- 列車に入れられる運用（持ち主の、同じ種類の運用）
    'ops', case when mine then (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'num', o.num, 'form', o.form, 'fname', f.name,
                                   'n', (select count(*) from mp_cars c where c.form = o.form)) order by o.num), '[]'::jsonb)
                                  from mp_ops o left join mp_forms f on f.id = o.form
                                 where o.own_u is not distinct from r.own_u and o.own_c is not distinct from r.own_c and o.kind = r.kind) end,
    'today', _mp_today(),
    'stops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'tracks', s.tracks, 'plat', s.plat, 'trk', _mp_sta_trk(s), 'x', s.x, 'y', s.y) order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats,
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'fser', fi.ser, 'fn', fi.n,   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk   -- 編成の工事中（DB の更新60）
               ) order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;

create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb;
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
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
    rev := floor(served * fare);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'shop', nwk, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, o.amt::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));
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

create or replace function public._mp_unko_apply(p_id bigint, p_pick int, p_auto boolean) returns void
language plpgsql set search_path = public as $$
declare z mp_unko; td float8 := extract(epoch from now()); t0 float8; te float8; ww jsonb := '[]'::jsonb; e jsonb; fit text; f float8; len float8; tr text; lg jsonb;
        rate float8; thin int; ed float8; md text; who text; first boolean; tg text; stopt text; wd int;
begin
  select * into z from mp_unko where id = p_id for update;
  if not found or z.st = 'done' then return; end if;
  first := z.st = 'ask'; md := coalesce(z.mode, 'rail');
  wd := case when z.wide then 1 else 0 end;   -- 全線（窓の6つめ。DB の更新60）
  t0 := extract(epoch from z.t0); te := t0 + z.dur; td := greatest(td, t0);
  -- いままでの窓：過ぎたところはのこす（いまをまたぐものは、いまで切る）。はじまったトラブルはそのまま、まだのトラブル・これからの対応はすてる
  for e in select v from jsonb_array_elements(z.wins) v loop
    tg := coalesce(e ->> 4, 'p');
    if (e ->> 0)::float8 >= td then continue; end if;
    if tg <> 't' and (e ->> 1)::float8 > td then e := jsonb_set(e, '{1}', to_jsonb(td)); end if;
    if (e ->> 1)::float8 > (e ->> 0)::float8 then ww := ww || jsonb_build_array(e); end if;
  end loop;
  fit := _mp_unko_fit(z.lv, p_pick);
  rate := case p_pick when 1 then 1 when 2 then 0.85 when 3 then 0.6 when 4 then 0.75 else 0 end;
  thin := case when p_pick = 4 then 1 else 0 end;
  ed := greatest(td + case when p_pick >= 4 then 600 else 300 end, te) + case when p_pick = 5 then 600 else 0 end;   -- 見合わせは、あとの点検10分
  if fit = 'over' then ed := ed + 900; end if;
  who := case when p_auto and z.own_u is null and z.own_c is null then '国' when p_auto then '現場の判断' else _mp_pname(z.own_u, z.own_c, false) end;
  lg := jsonb_build_array(jsonb_build_array(td, format('%s：%s%s（%s）', case when first then '対応' else '対応を変えました' end, _mp_unko_pickt(p_pick, md), case when z.wide then '・全線' else '' end, who)));
  stopt := case md when 'air' then '欠航しています' when 'ship' then '欠航しています' when 'bus' then '運休しています' else '運転を見合わせています' end;
  if fit = 'under' and td < te then
    f := case when z.kind in ('wind', 'rain', 'snow') then 600 else 360 end;
    len := greatest(1800, 1.5 * (te - td));
    if p_pick > 1 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + f, rate, thin, 'p', wd)); end if;
    ww := ww || jsonb_build_array(jsonb_build_array(td + f, td + f + len, 0, 0, 't', wd));
    tr := case z.kind when 'wind' then case md when 'ship' then '高い波で船が大きくゆれ、港へもどりました' when 'air' then '強い横風で着陸をやりなおし、空港を閉じました' when 'bus' then '強風で倒れた木が道路をふさぎました' else '架線に飛来物がひっかかりました' end
                      when 'rain' then case md when 'bus' then '冠水した道路で車両が動けなくなりました' when 'air' then '雷雲で出発できなくなりました' else '線路に土砂が流れこみました' end
                      when 'snow' then case md when 'bus' then '雪でバスが立ち往生しました' when 'air' then '滑走路の除雪がおいつかなくなりました' else 'ポイントが雪で動かなくなりました' end
                      when 'person' then '現場の確認がやりなおしになりました' when 'car' then case md when 'air' then '機材の不具合が大きくなりました（交換の機体を手配します）' when 'ship' then 'エンジンの不具合が大きくなりました' else '車両の故障が大きくなりました（車両を交換します）' end
                      when 'signal' then '信号の故障が広がりました' when 'bird' then '機体の点検で、ほかにも傷が見つかりました' when 'rwy' then '滑走路に落下物が見つかり、閉鎖しました'
                      when 'atc' then '管制の混雑がひどくなりました' when 'wave' then 'うねりが大きくなり、港へもどりました' when 'accident' then '事故の処理に時間がかかっています' when 'traffic' then '渋滞がひどくなりました'
                      else '安全確認がやりなおしになりました' end;
    lg := lg || jsonb_build_array(jsonb_build_array(td + f, tr || '。' || stopt));
    if not z.pen then
      update mp_routes set trust = greatest(0.7, trust - 0.03) where id = any(z.routes) and own_u is not distinct from z.own_u and own_c is not distinct from z.own_c;
      update mp_unko set pen = true where id = p_id;
    end if;
  elsif p_pick > 1 then
    ww := ww || jsonb_build_array(jsonb_build_array(td, ed, rate, thin, 'p', wd));
    if fit = 'over' then lg := lg || jsonb_build_array(jsonb_build_array(greatest(td + 60, ed - 900), '念のため、点検・確認をつづけています')); end if;
  end if;
  ed := coalesce((select max((x ->> 1)::float8) from jsonb_array_elements(ww) x), td);
  -- 記録：これからの予定（前の対応のトラブルなど）はけして、新しいものを足す
  update mp_unko set pick = p_pick, pick_at = to_timestamp(td), pick_auto = p_auto, wins = ww, t_end = to_timestamp(greatest(ed, td)), st = 'run',
         log = (select coalesce(jsonb_agg(l order by o), '[]'::jsonb) from jsonb_array_elements(log) with ordinality x(l, o) where (l ->> 0)::float8 <= td + 1) || lg
   where id = p_id;
end $$;

create or replace function public._mp_unko_new(p_kind text, p_sub text, p_sta bigint, p_x int, p_y int, p_routes bigint[], p_lv int, p_sev real, p_sevmax real, p_dur int,
                                               p_ou uuid, p_oc int) returns bigint
language plpgsql set search_path = public as $$
declare z mp_unko; ts0 float8 := extract(epoch from now()); human boolean; prov float8; who uuid; q record; txt text; fc text; md text; tag text;
begin
  human := (p_ou is not null and not exists (select 1 from profiles where id = p_ou and ai is not null))
        or (p_oc is not null and exists (select 1 from companies c where c.id = p_oc and c.ai is null and not coalesce(c.official, false)
                                           and not exists (select 1 from profiles p where p.id = c.owner and p.ai is not null)));
  md := coalesce((select kind from mp_routes where id = p_routes[1]), 'rail');
  tag := case md when 'air' then '【運航】' when 'ship' then '【運航】' else '【運行】' end;
  prov := case when p_kind in ('wind', 'rain', 'snow', 'atc', 'traffic') then 0.6 else 0 end;   -- えらぶまで：天気・混雑は徐行（待つ）、ほかは その場で止まる
  insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end, mode, zs)
    values (p_kind, coalesce(p_sub, ''), p_sta, p_x, p_y, p_routes, p_ou, p_oc, p_lv, p_sev, p_sevmax, p_dur, to_timestamp(ts0 + 600),
            jsonb_build_array(jsonb_build_array(ts0, ts0 + 600, prov, 0, 'v')), to_timestamp(ts0 + 600), md,
            _mp_unko_zone(p_kind, p_sta, p_x, p_y, p_routes))   -- 場所の駅（列車がきくのは、この駅と となりの駅のあいだ。DB の更新60）
    returning * into z;
  fc := case when z.kind in ('wind', 'rain', 'snow') and z.sevmax > z.sev + 0.5 then format('（これから %s ぐらいまで強くなる予報）',
          case z.kind when 'wind' then round(z.sevmax) || 'm/s' when 'rain' then round(z.sevmax) || 'mm' else round(z.sevmax) || 'cm' end) else '' end;
  txt := _mp_unko_where(z) || 'で' || _mp_unko_why(z);
  update mp_unko set log = jsonb_build_array(jsonb_build_array(ts0, txt || fc)) where id = z.id;
  if not human then perform _mp_unko_apply(z.id, case p_lv when 1 then 1 when 2 then 3 else 5 end, true); end if;   -- 人でない（国・AI・国営）：すぐに よい対応
  -- 知らせ（🔔）。えらぶ人には「えらんでください」
  if human then
    who := coalesce(p_ou, (select owner from companies where id = p_oc));
    perform _notice_l(who, format(tag || '%s：%s%s。対応をえらんでください（10分以内。あとから変えられます。国土 → 🚦運行情報）',
                                  (select string_agg(r.name, '・' order by r.id) from mp_routes r where r.id = any(p_routes) and r.own_u is not distinct from p_ou and r.own_c is not distinct from p_oc),
                                  txt, fc), jsonb_build_object('go', 'map', 'k', 'unko', 'id', z.id), null);
  end if;
  for q in select coalesce(r.own_u, c.owner) u, string_agg(r.name, '・' order by r.id) nm from mp_routes r left join companies c on c.id = r.own_c
            where r.id = any(p_routes) and not (r.own_u is not distinct from p_ou and r.own_c is not distinct from p_oc) and (r.own_u is not null or r.own_c is not null)
            group by 1 loop
    if q.u is not null and q.u is distinct from who then
      perform _notice_l(q.u, format(tag || '%sで%sのため、%sにも遅れが出ています（国土 → 🚦運行情報）', _mp_unko_where(z), _mp_unko_why(z), q.nm),
                        jsonb_build_object('go', 'map', 'k', 'unko', 'id', z.id), null);
    end if;
  end loop;
  return z.id;
end $$;

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
  if found then   -- その系統のいちばんひどい駅のまわりも、場所の駅に（DB の更新60）
    update mp_unko set routes = routes || r.id,
           zs = case when zs is null then null else array(select distinct q from unnest(zs || _mp_unko_zone(bkind, bsid, bx, by_, array[r.id])) q) end
     where id = uz.id and not (routes @> array[r.id]);
    return uz.id;
  end if;
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

create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
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

drop function if exists public.mp_unko_pick(bigint, int, text);   -- 前の形（p_wide なし。DB の更新60）
create or replace function public.mp_unko_pick(p_id bigint, p_pick int, p_as text, p_wide boolean default null) returns jsonb
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
  if z.st = 'run' and z.pick = p_pick and (p_wide is null or p_wide = z.wide) then raise exception 'いまと同じ対応です'; end if;
  if p_wide is not null and p_wide is distinct from z.wide then update mp_unko set wide = p_wide where id = p_id; end if;   -- 範囲：乱れの区間だけ・全線（DB の更新60）
  perform _mp_unko_apply(z.id, p_pick, false);
  select * into z from mp_unko where id = p_id;
  return jsonb_build_object('ok', true, 'pick', z.pick, 'tend', extract(epoch from z.t_end), 'wide', z.wide);
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_form_busy', '_mp_form_runs', '_mp_cxl_on', '_mp_unko_zone', '_mp_unko_zi', '_mp_unko_zt', '_mp_unko_rt', '_mp_sched_idx', '_mp_unko_trn', 'mp_cxl_add', 'mp_cxl_del', 'mp_unko_pick', 'mp_car_order', 'mp_form_set', 'mp_form_del', 'mp_car_work', 'mp_car_move', 'mp_car_scrap', 'mp_form_order', 'mp_xfer_accept', 'mp_dia', '_mp_tick_hour', '_mp_unko_apply', '_mp_unko_new', '_mp_unko_wxr', 'mp_unko_list') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 作りなおした関数の待ち時間（schema.sql の「20秒まで待つ」）
alter function public.mp_form_set(bigint, bigint[], text, text) set statement_timeout = '20s';
