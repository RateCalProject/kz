-- 乱れの対応（DB の更新82）：
--   区間折り返し：運転見合わせのあいだ、乱れの区間に入るはずの列車も、区間の外だけ走る（手前の駅で折り返す。運賃・定員は走った分）
--   迂回：区間の手前と先の駅を、区間を通らずにつなぐ自分の線路（乗り入れも）があれば、見合わせのあいだ その線路で走る（遅れる。電化した区間は電化した線路で）
--   どちらも、鉄道の「乱れの区間だけ」の対応といっしょにえらぶ（mp_unko_pick の p_ori・p_det。あとから変えられる）
--   故障：状態が悪くて故障した列車は、同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走）

alter table public.mp_unko add column if not exists ori boolean not null default false;   -- 区間折り返し（DB の更新82）：見合わせのあいだ、乱れの区間の外の列車は走る（区間の手前で折り返す）
alter table public.mp_unko add column if not exists det jsonb;   -- 迂回（DB の更新82）：{系統: 区間を通る速さ（もとの長さ ÷ 迂回の長さ）}。見合わせのあいだ、その系統の列車は ほかの線路で迂回する

-- 線路の道すじ（_mp_rail_path とおなじ）。ただし excl の線は通らない（迂回。DB の更新82）
create or replace function public._mp_rail_path_x(pu uuid, pc int, sa bigint, sb bigint, excl bigint[]) returns jsonb
language plpgsql stable set search_path = public as $$
declare A mp_stations; B mp_stations; s record; ids bigint[] := '{}'; n0s bigint[] := '{}'; n1s bigint[] := '{}'; lens real[] := '{}'; a0s real[] := '{}'; a1s real[] := '{}';
        nst int; dist real[]; prev int[]; done boolean[]; stn bigint[]; sseg int[]; i int; j int; k int; best real; cur int; cn bigint; cseg int; din real; dout real;
        bA int; bB int; cand real; cand_st int := null; cand_cost real := 1e12; cand_dir int; path int[] := '{}'; out jsonb := '[]'::jsonb; pieces jsonb := '[]'::jsonb;
        sg mp_segs; st int; fromv real; tov real; total real := 0; ell boolean := true; sgl boolean := false; e0 int;
begin
  select * into A from mp_stations where id = sa; select * into B from mp_stations where id = sb;
  if A.id is null or B.id is null then return null; end if;
  for s in select x.id, x.n0, x.n1, x.len, x.pts from mp_segs x where x.kind = 'rail' and not (x.id = any(coalesce(excl, '{}'::bigint[])))
             and ((x.own_u is not distinct from pu and x.own_c is not distinct from pc)
             or exists (select 1 from mp_thru t where t.st = 'ok' and t.gu is not distinct from pu and t.gc is not distinct from pc and t.hu is not distinct from x.own_u and t.hc is not distinct from x.own_c)) order by x.id loop
    ids := ids || s.id; n0s := n0s || s.n0; n1s := n1s || s.n1; lens := lens || s.len;
    a0s := a0s || _mp_end_ang(s.pts, 0); a1s := a1s || _mp_end_ang(s.pts, 1);
  end loop;
  bA := array_position(ids, A.seg); bB := array_position(ids, B.seg);
  if bA is null or bB is null then return null; end if;
  -- 同じ線の上ならそのまま
  if bA = bB then cand_cost := abs(B.at - A.at); end if;
  -- 状態：（線 j を通って、はし e に着いた）。番号 = 2*(j-1) + e + 1（e=0 は n0 側、1 は n1 側）
  nst := 2 * array_length(ids, 1);
  dist := array_fill(1e12::real, array[nst]); prev := array_fill(0, array[nst]); done := array_fill(false, array[nst]);
  dist[2 * (bA - 1) + 2] := lens[bA] - A.at;   -- n1 のほうへ
  dist[2 * (bA - 1) + 1] := A.at;              -- n0 のほうへ
  loop
    best := 1e12; cur := 0;
    for i in 1..nst loop if not done[i] and dist[i] < best then best := dist[i]; cur := i; end if; end loop;
    exit when cur = 0 or best >= cand_cost;
    done[cur] := true;
    j := (cur - 1) / 2 + 1; e0 := (cur - 1) % 2;
    cn := case when e0 = 0 then n0s[j] else n1s[j] end;
    if cn is null then continue; end if;
    -- 着いたときの進む向き（線の外へ）
    din := case when e0 = 0 then a0s[j] + pi() else a1s[j] + pi() end;
    for k in 1..array_length(ids, 1) loop
      if k = j then continue; end if;
      if n0s[k] = cn then dout := a0s[k];
        if _mp_angdiff(din, dout) < 0.9 then
          if k = bB then cand := dist[cur] + B.at; if cand < cand_cost then cand_cost := cand; cand_st := cur; cand_dir := 0; end if; end if;
          if dist[cur] + lens[k] < dist[2 * (k - 1) + 2] then dist[2 * (k - 1) + 2] := dist[cur] + lens[k]; prev[2 * (k - 1) + 2] := cur; end if;
        end if;
      end if;
      if n1s[k] = cn then dout := a1s[k];
        if _mp_angdiff(din, dout) < 0.9 then
          if k = bB then cand := dist[cur] + lens[k] - B.at; if cand < cand_cost then cand_cost := cand; cand_st := cur; cand_dir := 1; end if; end if;
          if dist[cur] + lens[k] < dist[2 * (k - 1) + 1] then dist[2 * (k - 1) + 1] := dist[cur] + lens[k]; prev[2 * (k - 1) + 1] := cur; end if;
        end if;
      end if;
    end loop;
  end loop;
  if cand_cost >= 1e11 then return null; end if;
  -- 道すじをつくる [[線, 入る位置, 出る位置], …]
  if cand_st is null then
    out := jsonb_build_array(jsonb_build_array(A.seg, A.at, B.at));
  else
    cur := cand_st;
    while cur <> 0 loop path := cur || path; cur := prev[cur]; end loop;
    -- はじめの線：A から、はし（path[1] の e）へ
    j := (path[1] - 1) / 2 + 1; e0 := (path[1] - 1) % 2;
    out := jsonb_build_array(jsonb_build_array(ids[j], A.at, case when e0 = 0 then 0 else lens[j] end));
    for i in 2..coalesce(array_length(path, 1), 1) loop
      j := (path[i] - 1) / 2 + 1; e0 := (path[i] - 1) % 2;
      out := out || jsonb_build_array(jsonb_build_array(ids[j], case when e0 = 0 then lens[j] else 0 end, case when e0 = 0 then 0 else lens[j] end));
    end loop;
    -- さいごの線：入ったはしから B へ
    out := out || jsonb_build_array(jsonb_build_array(B.seg, case when cand_dir = 0 then 0 else lens[bB] end, B.at));
  end if;
  return _mp_leg_from(out);
end $$;

-- 迂回（DB の更新82）：乱れの区間（_mp_unko_zi）を通らずに、区間の手前の駅と先の駅をつなぐ線路（系統の持ち主の線路と乗り入れ）があるか。
--   区間の中の駅が、はしの駅とおなじ線にあるとき・区間の中に駅がないとき（はしの駅で起きた）は迂回できない。
--   電化した区間を、電化していない線路で迂回はしない。系統ごとに、区間を通る速さ（もとの長さ ÷ 迂回の長さ。0.15〜0.9）：{系統: 速さ}。どこもなければ null
create or replace function public._mp_unko_det(p_id bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare z mp_unko; ro mp_routes; zi jsonb; e jsonb; ka int; kb int; sa mp_stations; sb mp_stations; excl bigint[]; pth jsonb; d0 float8; rr float8; v_ok boolean; el boolean;
        out jsonb := '{}'::jsonb;
begin
  select * into z from mp_unko where id = p_id;
  if not found or coalesce(z.mode, 'rail') <> 'rail' or z.wide then return null; end if;
  for ro in select * from mp_routes where id = any(z.routes) and kind = 'rail' and ok order by id loop
    zi := _mp_unko_zi(z, ro.id);
    if zi is null or jsonb_typeof(zi) <> 'array' or jsonb_array_length(zi) = 0 then continue; end if;
    v_ok := true; rr := 1;
    for e in select v from jsonb_array_elements(zi) v loop
      ka := (e ->> 0)::int; kb := (e ->> 1)::int;
      select * into sa from mp_stations where id = ro.stops[ka + 1];
      select * into sb from mp_stations where id = ro.stops[kb + 1];
      if sa.id is null or sb.id is null or sa.id = sb.id or kb - ka < 2 then v_ok := false; exit; end if;
      if exists (select 1 from unnest(ro.stops[ka + 2:kb]) q(sid) join mp_stations s on s.id = q.sid where s.seg in (sa.seg, sb.seg)) then v_ok := false; exit; end if;
      -- 区間の線路（駅と駅のあいだに通る線。はしの駅の線はのぞく）と、区間の中の駅の線
      excl := array(select distinct (g ->> 0)::bigint from jsonb_array_elements(ro.legs) with ordinality l(v, o), jsonb_array_elements(l.v -> 'g') g
                     where l.o - 1 >= ka and l.o - 1 < kb and (g ->> 0)::bigint not in (sa.seg, sb.seg))
              || array(select s.seg from unnest(ro.stops[ka + 2:kb]) q(sid) join mp_stations s on s.id = q.sid where s.seg is not null);
      pth := _mp_rail_path_x(ro.own_u, ro.own_c, sa.id, sb.id, excl);
      if pth is null then v_ok := false; exit; end if;
      d0 := coalesce((select sum((l.v ->> 'd')::float8) from jsonb_array_elements(ro.legs) with ordinality l(v, o) where l.o - 1 >= ka and l.o - 1 < kb), 0);
      el := coalesce((select bool_and(coalesce((l.v ->> 'e')::boolean, false)) from jsonb_array_elements(ro.legs) with ordinality l(v, o) where l.o - 1 >= ka and l.o - 1 < kb), false);
      if el and not coalesce((pth ->> 'e')::boolean, false) then v_ok := false; exit; end if;
      rr := least(rr, greatest(0.15, least(0.9, d0 / greatest((pth ->> 'd')::float8, 1))));
    end loop;
    if v_ok then out := out || jsonb_build_object(ro.id::text, round(rr::numeric, 3)); end if;
  end loop;
  return case when out = '{}'::jsonb then null else out end;
end $$;

create or replace function public._mp_unko_rt(rid bigint, ta float8, tb float8) returns jsonb
language plpgsql stable set search_path = public as $$
declare z mp_unko; out jsonb := '[]'::jsonb; w jsonb; zi jsonb; dr float8;
begin
  for z in select * from mp_unko x where x.routes @> array[rid] and x.t0 < to_timestamp(tb) and coalesce(x.t_end, now() + interval '1 day') > to_timestamp(ta) order by x.id loop
    zi := _mp_unko_zi(z, rid);
    -- 迂回・区間折り返し（DB の更新82）：区間だけの見合わせ（速さ 0・全線でない）は、迂回できる系統は迂回の速さで走る。
    --   迂回しない系統は、折り返しにしたら6つめを 1（区間に入るはずの列車は、区間の外だけ走る）
    dr := case when zi is not null and z.det is not null and z.det ? rid::text then (z.det ->> rid::text)::float8 end;
    w := (select coalesce(jsonb_agg(jsonb_build_array((e ->> 0)::float8, (e ->> 1)::float8,
                                    case when dr is not null and (e ->> 2)::float8 = 0 and coalesce((e ->> 5)::int, 0) = 0 then dr else (e ->> 2)::float8 end,
                                    coalesce((e ->> 3)::int, 0), coalesce((e ->> 5)::int, 0),
                                    case when dr is null and zi is not null and z.ori and (e ->> 2)::float8 = 0 and coalesce((e ->> 5)::int, 0) = 0 then 1 else 0 end)
                                    order by (e ->> 0)::float8, (e ->> 1)::float8), '[]'::jsonb)
            from jsonb_array_elements(z.wins) e where (e ->> 1)::float8 > (e ->> 0)::float8 and (e ->> 2)::float8 < 1);
    if jsonb_array_length(w) = 0 then continue; end if;
    out := out || jsonb_build_array(jsonb_build_object('id', z.id, 'w', w, 'zi', zi));
  end loop;
  return case when jsonb_array_length(out) = 0 then null else out end;
end $$;

create or replace function public._mp_unko_trn(L jsonb, st bigint[], legs jsonb, sc jsonb, dir int, d0 float8, tid bigint, te float8) returns jsonb
language plpgsql stable as $$
declare n int; ns int := coalesce(array_length(st, 1), 0); idx int[]; cum float8[]; t0 float8; bad boolean; fwd boolean;
        ia int[]; ar float8[]; dp float8[];
        xa float8[] := '{}'; xb float8[] := '{}'; xr float8[] := '{}'; xth boolean[] := '{}'; xza float8[] := '{}'; xzb float8[] := '{}'; xzc float8[] := '{}'; xrs float8[] := '{}'; xid bigint[] := '{}';
        zz jsonb; w jsonb; zi jsonb; cs float8; ce float8; rs float8; a float8; b float8; r float8; th boolean; wide boolean;
        xo boolean[] := '{}'; ori boolean; op float8 := null; oz bigint := null;
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
      ori := coalesce((w ->> 5)::int, 0) = 1;   -- 区間折り返し（DB の更新82）
      rs := a;
      if r = 0 then
        if cs is null or ce < a - 1 then cs := a; ce := b; else ce := greatest(ce, b); end if;
        rs := cs;
      end if;
      if wide or zi is null or jsonb_typeof(zi) <> 'array' or bad then
        xa := xa || a; xb := xb || b; xr := xr || r; xth := xth || th; xza := xza || (-1e9)::float8; xzb := xzb || 1e9::float8; xzc := xzc || 0::float8; xrs := xrs || rs; xid := xid || (zz ->> 'id')::bigint; xo := xo || false;
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
        xa := xa || a; xb := xb || b; xr := xr || r; xth := xth || th; xza := xza || (za - t0); xzb := xzb || (zb - t0); xzc := xzc || (za - t0); xrs := xrs || rs; xid := xid || (zz ->> 'id')::bigint; xo := xo || ori;
      end loop;
    end loop;
  end loop;
  m := coalesce(array_length(xa, 1), 0);
  if m = 0 then return jsonb_build_object('can', null, 'dly', 0, 'z', null); end if;
  -- 運休（見合わせ・間引き）
  for i in 1..m loop
    ze := d0 + xzc[i];
    -- 区間折り返し（DB の更新82）：見合わせの窓に区間に入るはずの列車は、区間の外だけ走る（op：走るわりあい。始発駅を出てから終点に着くまでの時間で）
    if xr[i] = 0 and xo[i] and xa[i] <= ze and ze < xb[i] then
      if op is null then op := greatest(0, 1 - (xzb[i] - xza[i]) / greatest(1, ar[n] - t0)); oz := xid[i]; end if;
      continue;
    end if;
    if xr[i] = 0 and xa[i] <= ze and ze < xb[i] and d0 >= xrs[i] then can := 'stop'; cz := xid[i]; exit; end if;
    if xth[i] and tid % 2 = 1 and xa[i] <= ze and ze < xb[i] and d0 >= xa[i] then can := 'thin'; cz := xid[i]; exit; end if;
  end loop;
  if can is null and op is not null and op < 0.05 then can := 'stop'; cz := oz; end if;   -- 区間の外がほとんどない列車は運休
  if can is not null then return jsonb_build_object('can', can, 'dly', 0, 'z', cz); end if;
  -- 遅れ：区間にいるあいだは窓の速さ、そのほかは 1秒に 0.1秒ずつ取りもどす
  s := d0; d := 0;
  while s < te - 1e-6 and it < 400 loop
    it := it + 1;
    p := s - d0 - d; r := 1; nx := te;
    for i in 1..m loop
      if not xo[i] and xa[i] <= s and s < xb[i] and xza[i] <= p + 1e-6 and p < xzb[i] - 1e-6 then r := least(r, xr[i]); end if;   -- 折り返しの窓では待たない（DB の更新82）
      if xa[i] > s then nx := least(nx, xa[i]); elsif xb[i] > s then nx := least(nx, xb[i]); end if;
    end loop;
    if r < 1 then
      if r > 0 then
        for i in 1..m loop
          if not xo[i] and xa[i] <= s and s < xb[i] then
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
        if not xo[i] and xa[i] <= s and s < xb[i] and p < xza[i] - 1e-6 then nx := least(nx, s + (xza[i] - p) / pr); end if;
      end loop;
      d := greatest(0, d - 0.1 * (nx - s)); s := nx;
    end if;
  end loop;
  return jsonb_build_object('can', null, 'dly', d, 'z', null) || case when op is not null then jsonb_build_object('ori', op, 'oz', oz) else '{}'::jsonb end;
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
  lg := jsonb_build_array(jsonb_build_array(td, format('%s：%s%s%s%s（%s）', case when first then '対応' else '対応を変えました' end, _mp_unko_pickt(p_pick, md), case when z.wide then '・全線' else '' end,
                          case when z.det is not null and not z.wide then '・迂回' else '' end, case when z.ori and not z.wide then '・区間の外は折り返し運転' else '' end, who)));   -- DB の更新82
  stopt := case md when 'air' then '欠航しています' when 'ship' then '欠航しています' when 'bus' then '運休しています' else '運転を見合わせています' end;
  if fit = 'under' and td < te then
    f := case when z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') then 600 else 360 end;
    len := greatest(1800, 1.5 * (te - td));
    if p_pick > 1 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + f, rate, thin, 'p', wd)); end if;
    ww := ww || jsonb_build_array(jsonb_build_array(td + f, td + f + len, 0, 0, 't', wd));
    tr := case z.kind when 'wind' then case md when 'ship' then '高い波で船が大きくゆれ、港へもどりました' when 'air' then '強い横風で着陸をやりなおし、空港を閉じました' when 'bus' then '強風で倒れた木が道路をふさぎました' else '架線に飛来物がひっかかりました' end
                      when 'rain' then case md when 'bus' then '冠水した道路で車両が動けなくなりました' when 'air' then '雷雲で出発できなくなりました' else '線路に土砂が流れこみました' end
                      when 'snow' then case md when 'bus' then '雪でバスが立ち往生しました' when 'air' then '滑走路の除雪がおいつかなくなりました' else 'ポイントが雪で動かなくなりました' end
                      when 'fog' then case md when 'air' then '霧で着陸をやりなおし、ほかの空港へ向かいました' when 'ship' then '霧で前が見えず、港へもどりました' when 'bus' then '霧で前が見えず、追突事故が起きました' else '霧で信号が見えにくくなりました' end
                      when 'heat' then '暑さでレールがゆがみました' when 'hail' then 'ひょうで機体がへこみ、点検が必要になりました'
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

create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 3, 'aioff', case when gv then null else _mp_unko_off(pu, pc) end, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null or gv) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi),
                         'zi', q.zi, 'zt', _mp_unko_zt(r.id, q.zi),
                         'det', case when q.zi is not null and z.det is not null then (z.det ->> r.id::text)::float8 end) order by r.id), '[]'::jsonb)   -- 区間（DB の更新60）・迂回の速さ（DB の更新82）
                 from mp_routes r cross join lateral (select _mp_unko_zi(z, r.id) zi) q where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st, 'wide', z.wide, 'ori', z.ori, 'det', z.det is not null,
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

create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb; rfid bigint; nsub int; orf real; sb2 bigint;
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
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
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
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0)));   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
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

drop function if exists public.mp_unko_pick(bigint, int, text, boolean);   -- 前の形（p_ori・p_det なし。DB の更新82）
create or replace function public.mp_unko_pick(p_id bigint, p_pick int, p_as text, p_wide boolean default null, p_ori boolean default null, p_det boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; z mp_unko; dj jsonb;
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
  if z.st = 'run' and z.pick = p_pick and (p_wide is null or p_wide = z.wide) and (p_ori is null or p_ori = z.ori) and (p_det is null or p_det = (z.det is not null)) then
    raise exception 'いまと同じ対応です';
  end if;
  if p_wide is not null and p_wide is distinct from z.wide then update mp_unko set wide = p_wide where id = p_id; end if;   -- 範囲：乱れの区間だけ・全線（DB の更新60）
  -- 区間折り返し・迂回（DB の更新82。鉄道の、区間だけの乱れ）
  if (coalesce(p_ori, false) or coalesce(p_det, false)) and (coalesce(z.mode, 'rail') <> 'rail' or coalesce(p_wide, z.wide)) then
    raise exception '区間折り返し・迂回は、鉄道の「乱れの区間だけ」のときにえらべます';
  end if;
  if p_ori is not null and p_ori is distinct from z.ori then update mp_unko set ori = p_ori where id = p_id; end if;
  if p_det is not null then
    if p_det then
      dj := _mp_unko_det(p_id);
      if dj is null then raise exception '迂回できる線路がありません（区間の手前と先の駅を、区間を通らずにつなぐ自分の線路がいります。電化した区間は、電化した線路で）'; end if;
    end if;
    update mp_unko set det = dj where id = p_id;
  end if;
  perform _mp_unko_apply(z.id, p_pick, false);
  select * into z from mp_unko where id = p_id;
  return jsonb_build_object('ok', true, 'pick', z.pick, 'tend', extract(epoch from z.t_end), 'wide', z.wide, 'ori', z.ori, 'det', z.det);
end $$;

-- 関数の権限：対応をえらぶのはログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_rail_path_x', '_mp_unko_det', '_mp_unko_rt', '_mp_unko_trn', '_mp_unko_apply', 'mp_unko_pick', 'mp_unko_list', '_mp_tick_hour') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 迂回をえらぶと、線路の道すじをさがすので20秒まで
alter function public.mp_unko_pick(bigint, int, text, boolean, boolean, boolean) set statement_timeout = '20s';
