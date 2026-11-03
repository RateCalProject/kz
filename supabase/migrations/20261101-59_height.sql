-- 高さ（t108）：線路・道路に高さ（縦断）。勾配の上限（線路 35‰・アプト式 70‰・道路 80‰）。地形に合わせて自動でトンネル・高架・橋（高架・地下（地下鉄）もえらべる。高さは手で 5m ずつ直せる）。
--   線路どうしは 10m、道路とは 5m 以上 上か下でまたぐ（どちらも地面なら踏切）。低い建物の上・建物の下（地下 15m より深く）も通れる。地下駅（工事費 2.5倍）・高架駅（1.5倍）。アプト式は 30km/h まで。
--   いまの中心部で線路どうしが同じ高さで交わっているところは、交わるところの前後だけ高さを変えて直す（分かれ道のすぐ近くは そのまま）

alter table public.mp_segs add column if not exists prof real[];   -- 縦断：[s0, z0, s1, z1, …]（s：はじめからの長さ（マス）・z：海面からの高さ（m））。null は地面どおり（高速道路は地面＋10m）
alter table public.mp_segs add column if not exists st text;       -- つくり（1マスごと）：G 地面・V 高架・T トンネル（地下）・B 橋（川・湖・海の上）。null は地面どおり
alter table public.mp_segs add column if not exists rack boolean not null default false;   -- アプト式（急な坂を登れる。30km/h まで）
alter table public.mp_segs add column if not exists hm text;       -- 高さのえらびかた：auto 地形に合わせる・el 高架・ug 地下・man 手で直した
alter table public.mp_nodes add column if not exists z real;       -- 点の高さ（m）。null は地面

-- 地面の高さ（m。海・川・湖は 0）
create or replace function public._mp_gz(x float8, y float8) returns real
language sql stable set search_path = public as $$ select greatest(coalesce((_mp_cell(floor(x)::int, floor(y)::int)).e, 0), 0)::real $$;
-- 縦断の、はじめから s マスのところの高さ（m）
create or replace function public._mp_pz(pf real[], s float8) returns real
language plpgsql immutable as $$
declare n int := coalesce(array_length(pf, 1), 0) / 2; i int;
begin
  if n = 0 then return null; end if;
  if s <= pf[1] then return pf[2]; end if;
  for i in 1..n - 1 loop
    if s <= pf[2 * i + 1] then return (pf[2 * i] + (pf[2 * i + 2] - pf[2 * i]) * (s - pf[2 * i - 1]) / greatest(pf[2 * i + 1] - pf[2 * i - 1], 1e-6))::real; end if;
  end loop;
  return pf[2 * n];
end $$;
-- 線の、はじめから s マスのところの高さ（縦断がなければ地面。高速道路は地面＋10m）
create or replace function public._mp_seg_z(sg mp_segs, s real) returns real
language plpgsql stable set search_path = public as $$
declare q record;
begin
  if sg.prof is not null then return _mp_pz(sg.prof, s); end if;
  select * into q from _mp_at(sg.pts, s);
  return _mp_gz(q.x, q.y) + case when sg.kind = 'road' and sg.cls = 'exp' then 10 else 0 end;
end $$;
-- 点の高さ（なければ地面）
create or replace function public._mp_node_z(nid bigint) returns real
language sql stable set search_path = public as $$ select coalesce(n.z, _mp_gz(n.x / 100.0, n.y / 100.0)) from mp_nodes n where n.id = nid $$;
-- 縦断を、s0〜s1 マスのところだけにする（はじめを 0 に）
create or replace function public._mp_prof_sub(pf real[], s0 real, s1 real) returns real[]
language plpgsql immutable as $$
declare n int := coalesce(array_length(pf, 1), 0) / 2; i int; out real[];
begin
  if n = 0 then return null; end if;
  out := array[0::real, _mp_pz(pf, s0)];
  for i in 1..n loop
    if pf[2 * i - 1] > s0 + 0.01 and pf[2 * i - 1] < s1 - 0.01 then out := out || array[pf[2 * i - 1] - s0, pf[2 * i]]; end if;
  end loop;
  return out || array[s1 - s0, _mp_pz(pf, s1)];
end $$;
-- 縦断を逆向きに（長さ ln）
create or replace function public._mp_prof_rev(pf real[], ln real) returns real[]
language sql immutable as $$
  select case when pf is null then null else (select array_agg(v order by i desc, o) from (select i, array[ln - pf[2 * i - 1], pf[2 * i]] a from generate_series(1, array_length(pf, 1) / 2) i) q,
                                                      lateral unnest(q.a) with ordinality u(v, o)) end
$$;

-- 線の上の 1マスごとの点：s（はじめからの長さ）・x・y・地面の高さ g（m。水は 0）・地形 t。チャンクは1回だけ読む
create or replace function public._mp_gsamp(p int[]) returns table (i int, s real, x real, y real, g real, t text)
language plpgsql stable set search_path = public as $$
declare np int := coalesce(array_length(p, 1), 0) / 2; j int; acc float8 := 0; d float8; ax float8; ay float8; bx float8; by_ float8; k int := 0; ln float8; f float8;
        vcx int; vcy int; ccx int := null; ccy int := null; ct text; ce text; px int; py int; kk int; w jsonb; inw boolean;
begin
  ln := _mp_len(p);
  for j in 1..np - 1 loop
    ax := p[2 * j - 1] / 100.0; ay := p[2 * j] / 100.0; bx := p[2 * j + 1] / 100.0; by_ := p[2 * j + 2] / 100.0;
    d := sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2);
    while k <= acc + d + 1e-6 and k <= ln + 1e-6 loop
      f := case when d > 1e-9 then (k - acc) / d else 0 end;
      x := ax + (bx - ax) * f; y := ay + (by_ - ay) * f; s := k; i := k;
      px := floor(x)::int; py := floor(y)::int; vcx := px >> 6; vcy := py >> 6;
      if ccx is distinct from vcx or ccy is distinct from vcy then
        select c.t, c.e into ct, ce from mp_chunks c where c.cx = vcx and c.cy = vcy; ccx := vcx; ccy := vcy;
        if not found then ct := null; ce := null; end if;
      end if;
      if ct is null then
        w := _mp_world(); inw := vcx between (w ->> 'cx0')::int and (w ->> 'cx1')::int and vcy between (w ->> 'cy0')::int and (w ->> 'cy1')::int;
        t := case when inw then 'D' else '?' end; g := 0;
      else
        kk := (py & 63) * 64 + (px & 63) + 1;
        t := substr(ct, kk, 1);
        g := greatest(_mp_edec(position(substr(ce, kk, 1) in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~!*()+=') - 1), 0);
      end if;
      return next;
      k := k + 1;
    end loop;
    acc := acc + d;
  end loop;
  if k - 1 < ln - 0.05 then   -- さいごの点（はし）
    x := p[2 * np - 1] / 100.0; y := p[2 * np] / 100.0; s := ln; i := k;
    g := _mp_gz(x, y); t := coalesce((_mp_cell(floor(x)::int, floor(y)::int)).t, '?');
    return next;
  end if;
end $$;

-- 1区間（ds マス）で上り下りできる高さ（m）：線路 35‰・アプト式 70‰・道路 80‰
create or replace function public._mp_hd(kind text, rack boolean, ds real) returns real
language sql immutable as $$
  select ((case when kind = 'road' then 0.08 when rack then 0.07 else 0.035 end) * ds * 50)::real
$$;
-- 縦断を決める：目標 tg に近く、lo〜hi に入り、となりとの差が d まで。できなければ null
--   下から包む（いちばん低い・tg より上）と、上から包む（いちばん高い・tg より下）のまん中を、lo〜hi（となりとの差もみた範囲）に
create or replace function public._mp_prof_solve(tg real[], lo real[], hi real[], d real[]) returns real[]
language plpgsql immutable as $$
declare n int := array_length(tg, 1); k int; a real[] := lo; b real[] := hi; L real[] := tg; U real[] := tg; z real[] := tg;
begin
  for k in 2..n loop a[k] := greatest(a[k], a[k - 1] - d[k - 1]); b[k] := least(b[k], b[k - 1] + d[k - 1]); L[k] := greatest(L[k], L[k - 1] - d[k - 1]); U[k] := least(U[k], U[k - 1] + d[k - 1]); end loop;
  for k in reverse n - 1..1 loop a[k] := greatest(a[k], a[k + 1] - d[k]); b[k] := least(b[k], b[k + 1] + d[k]); L[k] := greatest(L[k], L[k + 1] - d[k]); U[k] := least(U[k], U[k + 1] + d[k]); end loop;
  for k in 1..n loop
    if a[k] > b[k] + 0.01 then return null; end if;
    z[k] := least(b[k], greatest(a[k], (L[k] + U[k]) / 2));
  end loop;
  return z;
end $$;

-- 線 p が、ほかの線路・道路と交わるところ：s（p のはじめからの長さ）・相手・相手の高さ oz・地面 og・相手に縦断があるか ohp（はしで つながるところ・excl の線はのぞく）
create or replace function public._mp_xing(p int[], excl bigint[]) returns table (s real, oid bigint, okind text, ocls text, oname text, oz real, og real, ohp boolean)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare r record; sg mp_segs;
begin
  for r in
    with e as (select i, p[2 * i - 1] / 100.0 ax, p[2 * i] / 100.0 ay, p[2 * i + 1] / 100.0 bx, p[2 * i + 2] / 100.0 by_ from generate_series(1, array_length(p, 1) / 2 - 1) i),
         ec as materialized (select e.*, sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2) d, coalesce(sum(sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2)) over (order by i rows between unbounded preceding and 1 preceding), 0) s0 from e),
         cand as materialized (select distinct q1.id ref from ec join mp_segs q1 on q1.bb && box(point(least(ec.ax, ec.bx) - 0.01, least(ec.ay, ec.by_) - 0.01), point(greatest(ec.ax, ec.bx) + 0.01, greatest(ec.ay, ec.by_) + 0.01))
                                where not (q1.id = any(coalesce(excl, '{}')))),
         oe as (select q2.id, j, q2.pts[2 * j - 1] / 100.0 cx, q2.pts[2 * j] / 100.0 cy, q2.pts[2 * j + 1] / 100.0 dx, q2.pts[2 * j + 2] / 100.0 dy
                  from cand join mp_segs q2 on q2.id = cand.ref, generate_series(1, array_length(q2.pts, 1) / 2 - 1) j),
         oc as materialized (select oe.*, sqrt((dx - cx) ^ 2 + (dy - cy) ^ 2) od, coalesce(sum(sqrt((dx - cx) ^ 2 + (dy - cy) ^ 2)) over (partition by id order by j rows between unbounded preceding and 1 preceding), 0) os0 from oe),
         ecg as materialized (select ec.*, gx, gy from ec, generate_series(floor(least(ax, bx) / 2)::int, floor(greatest(ax, bx) / 2)::int) gx, generate_series(floor(least(ay, by_) / 2)::int, floor(greatest(ay, by_) / 2)::int) gy),
         ocg as materialized (select oc.*, gx, gy from oc, generate_series(floor(least(cx, dx) / 2)::int, floor(greatest(cx, dx) / 2)::int) gx, generate_series(floor(least(cy, dy) / 2)::int, floor(greatest(cy, dy) / 2)::int) gy),
         pr as (select distinct ecg.i, ecg.s0, ecg.d, ecg.ax, ecg.ay, ecg.bx, ecg.by_, ocg.id, ocg.j, ocg.os0, ocg.od, ocg.cx, ocg.cy, ocg.dx, ocg.dy,
                       (ecg.ax - ecg.bx) * (ocg.cy - ocg.dy) - (ecg.ay - ecg.by_) * (ocg.cx - ocg.dx) den
                  from ecg join ocg on ocg.gx = ecg.gx and ocg.gy = ecg.gy),
         it as (select pr.*, ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / den t, ((ax - cx) * (ay - by_) - (ay - cy) * (ax - bx)) / den u from pr where abs(den) > 1e-12)
    select distinct on (id, round((s0 + t * d)::numeric, 1)) (s0 + t * d)::real s, id, (os0 + u * od)::real os, (ax + t * (bx - ax))::real x, (ay + t * (by_ - ay))::real y
      from it where t >= -1e-6 and t < 1 - 1e-6 and u >= -1e-6 and u < 1 - 1e-6   -- 点の上で交わるときも1回（その点から始まる区間）
  loop
    select * into sg from mp_segs where id = r.id;
    -- はしの近く（0.3マス）は、つながる線（同じ点）なので数えない
    if (r.s < 0.3 or r.s > _mp_len(p) - 0.3) and (r.os < 0.3 or r.os > sg.len - 0.3) then continue; end if;
    s := r.s; oid := sg.id; okind := sg.kind; ocls := sg.cls; oname := sg.name; ohp := sg.prof is not null;
    og := _mp_gz(r.x, r.y); oz := case when sg.prof is not null then _mp_pz(sg.prof, r.os) else og + case when sg.kind = 'road' and sg.cls = 'exp' then 10 else 0 end end;
    return next;
  end loop;
end $$;

-- 線 p（区画 cells・マス tiles。oseg：線そのもの（その線の駅・車庫はのぞく。いくつでも））が上か下を通るもの（建物・駅のホーム・車庫・バス停・滑走路）：s の範囲・通れない高さ（zb〜zt のあいだ）・名前
--   建物：屋根＋5m より上か、地面−15m より下。ホーム：ホームの高さ ±10m。車庫・バス停：地面 ±10m。滑走路：地面−10m より下だけ
--   区画が かかるものだけ、線の上の位置（s）を出す（線の区画ぜんぶは見ない）
create or replace function public._mp_prof_obst(p int[], cells int[], tiles int[], oseg bigint[]) returns table (s0 real, s1 real, zb real, zt real, name text)
language sql stable set search_path = public as $$
  with e as (select i, p[2 * i - 1] / 100.0 ax, p[2 * i] / 100.0 ay, p[2 * i + 1] / 100.0 bx, p[2 * i + 2] / 100.0 by_ from generate_series(1, array_length(p, 1) / 2 - 1) i),
       ec as materialized (select e.*, sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2) d, coalesce(sum(sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2)) over (order by i rows between unbounded preceding and 1 preceding), 0) s0 from e),
       ecg as materialized (select ec.*, gx, gy from ec, generate_series(floor(least(ax, bx) / 2)::int, floor(greatest(ax, bx) / 2)::int) gx, generate_series(floor(least(ay, by_) / 2)::int, floor(greatest(ay, by_) / 2)::int) gy),
       c as materialized (select distinct cells[2 * i - 1] x, cells[2 * i] y from generate_series(1, coalesce(array_length(cells, 1), 0) / 2) i),
       -- 近くの駅・バス停・車庫・滑走路（線の 2マスのます目の、となりまで）
       eg as materialized (select distinct gx, gy from ecg),
       cand as materialized (
         select 'sta' what, st.id ref from mp_stations st, generate_series(-3, 3) ox, generate_series(-3, 3) oy join eg on true
                where st.kind = 'rail' and not coalesce(st.seg = any(oseg), false) and eg.gx = floor(st.x / 200.0)::int + ox and eg.gy = floor(st.y / 200.0)::int + oy
         union select 'dep', d.id from mp_depots d, generate_series(-7, 7) ox, generate_series(-7, 7) oy join eg on true
                where d.kind in ('rail', 'bus') and not coalesce(d.seg = any(oseg), false) and eg.gx = floor(d.x / 200.0)::int + ox and eg.gy = floor(d.y / 200.0)::int + oy
         union select 'stop', st.id from mp_stations st join eg on eg.gx = floor(st.x / 200.0)::int and eg.gy = floor(st.y / 200.0)::int where st.kind = 'bus'
         union select 'rwy', r.id from mp_rwys r where box(point(least(r.x0, r.x1) / 100.0, least(r.y0, r.y1) / 100.0), point(greatest(r.x0, r.x1) / 100.0, greatest(r.y0, r.y1) / 100.0)) && _mp_bb(p)),
       -- 線の区画にかかるもの（区画ごと）
       hit as materialized (
         select 'b' what, bc.bld ref, c.x, c.y from c join mp_bcells bc on bc.x = c.x and bc.y = c.y
         union all select 'sta', st.id, c.x, c.y from cand join mp_stations st on cand.what = 'sta' and st.id = cand.ref cross join lateral _mp_sta_cells(st.id) sc join c on c.x = sc.x and c.y = sc.y
         union all select 'dep', d.id, c.x, c.y from cand join mp_depots d on cand.what = 'dep' and d.id = cand.ref
                     cross join lateral _mp_dep_cells((d.x / 100.0)::real, (d.y / 100.0)::real, d.ang, d.side, d.kind, d.size) dc join c on c.x = dc.x and c.y = dc.y
         union all select 'stop', st.id, c.x, c.y from cand join mp_stations st on cand.what = 'stop' and st.id = cand.ref join c on abs(c.x - floor(st.x / 20.0)) <= 1 and abs(c.y - floor(st.y / 20.0)) <= 1
         union all select 'rwy', r.id, c.x, c.y from cand join mp_rwys r on cand.what = 'rwy' and r.id = cand.ref cross join lateral _mp_rwy_cells(r.x0, r.y0, r.x1, r.y1, r.w) rc join c on c.x = rc.x and c.y = rc.y),
       -- かかる区画のまん中を線に投げた位置（s）
       cs as materialized (select distinct on (h.x, h.y) h.x, h.y,
                             (ecg.s0 + ecg.d * least(1, greatest(0, case when ecg.d < 1e-9 then 0 else (((h.x + 0.5) / 5.0 - ecg.ax) * (ecg.bx - ecg.ax) + ((h.y + 0.5) / 5.0 - ecg.ay) * (ecg.by_ - ecg.ay)) / (ecg.d * ecg.d) end)))::real s
                             from (select distinct x, y from hit) h, generate_series(-1, 1) ox, generate_series(-1, 1) oy
                             join ecg on true
                            where ecg.gx = floor((h.x + 0.5) / 10.0)::int + ox and ecg.gy = floor((h.y + 0.5) / 10.0)::int + oy
                            order by h.x, h.y, ((h.x + 0.5) / 5.0 - (ecg.ax + ecg.bx) / 2) ^ 2 + ((h.y + 0.5) / 5.0 - (ecg.ay + ecg.by_) / 2) ^ 2),
       hs as (select hit.what, hit.ref, min(cs.s) s0, max(cs.s) s1, min(hit.x) x, min(hit.y) y from hit join cs on cs.x = hit.x and cs.y = hit.y group by hit.what, hit.ref)
  select hs.s0, hs.s1, (g - 15)::real, (g + case when b.floors > 0 then b.floors * 3.5 + 3 else 0 end + 5)::real, '建物（' || coalesce(nullif(b.name, ''), pa.ban || '番') || '）'
    from hs join mp_blds b on hs.what = 'b' and b.id = hs.ref join mp_parcels pa on pa.id = b.parcel, lateral (select _mp_gz((hs.x + 0.5) / 5.0, (hs.y + 0.5) / 5.0) g) q
  union all
  select hs.s0, hs.s1, (zp - 10)::real, (zp + 10)::real, '駅「' || st.name || '」のホーム'
    from hs join mp_stations st on hs.what = 'sta' and st.id = hs.ref, lateral (select _mp_seg_z(sg, st.at) zp from mp_segs sg where sg.id = st.seg) q
  union all
  select hs.s0, hs.s1, (g - 10)::real, (g + 10)::real, '車庫「' || d.name || '」' from hs join mp_depots d on hs.what = 'dep' and d.id = hs.ref, lateral (select _mp_gz(d.x / 100.0, d.y / 100.0) g) q
  union all
  select hs.s0, hs.s1, (g - 10)::real, (g + 10)::real, 'バス停「' || st.name || '」' from hs join mp_stations st on hs.what = 'stop' and st.id = hs.ref, lateral (select _mp_gz(st.x / 100.0, st.y / 100.0) g) q
  union all
  select hs.s0, hs.s1, (g - 10)::real, 1e9::real, '滑走路「' || r.name || '」' from hs join mp_rwys r on hs.what = 'rwy' and r.id = hs.ref, lateral (select _mp_gz(r.x0 / 100.0, r.y0 / 100.0) g) q
$$;

-- つくり（1マスごとの1文字）：水の上 B 橋（水の 8m より下なら T）・地面より 6m 高い V 高架・8m 低い T トンネル（地下）・ほか G 地面（盛り土・切り通し）
create or replace function public._mp_st_code(z real, g real, t text) returns text
language sql immutable as $$
  select case when t in ('S', 'R', 'L', 'D') then case when z <= g - 8 then 'T' else 'B' end when z - g >= 6 then 'V' when z - g <= -8 then 'T' else 'G' end
$$;
-- 工事費の倍率（1マス）：地面は地形（平地 1〜高い山 2.5。水の上は橋と同じ）・高架 3・トンネル 4.5（水の下は橋より少し高い）・橋（川 4・湖 6・海 8・深い海 10。陸の上は高架と同じ）
create or replace function public._mp_smul(code text, t text) returns real
language sql immutable as $$
  select (case code when 'V' then 3
                    when 'T' then case t when 'R' then 5 when 'L' then 7 when 'S' then 9 when 'D' then 11 else 4.5 end
                    when 'B' then case t when 'R' then 4 when 'L' then 6 when 'S' then 8 when 'D' then 10 else 3 end
                    else case t when 'F' then 1.2 when 'B' then 1.2 when 'H' then 1.5 when 'M' then 2 when 'K' then 2.5 when 'R' then 4 when 'L' then 6 when 'S' then 8 when 'D' then 10 else 1 end end)::real
$$;

-- 縦断を決めて、しらべる（線をひく・形を直す・高さを変える）
--   p：線の点・kind・cls：道路の種類・z0, z1：はしの高さ（つなぐ先の高さ。null なら自由）・mode：auto 地形に合わせる・el 高架・ug 地下・rack：アプト式・
--   upf：手で決めた高さ（[s, z, …]。その位置はその高さ。ほかは自動）・cells, tiles：線の区画・マス・ea, eb：はしの近く（ここだけにかかる駅・車庫などは見ない）・
--   oseg：線そのもの（形を直す・高さを変えるとき。その線との交差・その線の駅・車庫はのぞく。いくつでも）・xonly：線路との交差だけ見る（前からある線を直すとき）・
--   fx：決まった高さのところ [s0, s1, 下, 上, …]（車庫のところは地面 ±2.5m）
--   答え：{ok, prof, st（1マスごとのつくり）, g（1マスごとの地面）, maxg（いちばん急な勾配 ‰）, tun・via・brg（m）, lx（踏切の数）, xs（交差・上下を通るもの [s, 'over'/'under'/'level', 名前]）, ns} か {ok: false, err}
create or replace function public._mp_prof_make(p int[], kind text, cls text, z0 real, z1 real, mode text, rack boolean, upf real[], cells int[], tiles int[], ea real, eb real, oseg bigint[], xonly boolean, fx real[]) returns jsonb
language plpgsql stable set search_path = public as $$
declare sm record; ss real[] := '{}'; gg real[] := '{}'; tt text[] := '{}'; S real; ns int; n int; k int; j int; i int; it int;
        cs real[] := '{}'; an real[]; tg real[] := '{}'; lo real[]; hi real[]; d real[] := '{}'; z real[]; pf real[]; o record;
        o_s0 real[] := '{}'; o_s1 real[] := '{}'; o_zb real[] := '{}'; o_zt real[] := '{}'; o_g real[] := '{}'; o_lv boolean[] := '{}'; o_nm text[] := '{}'; o_k text[] := '{}';
        o_ka int[] := '{}'; o_kb int[] := '{}'; ord int[]; no int := 0; fi int;
        za real; zb_ real; zm real; ka int; kb int; side text; sides text[]; z2 real[]; lo2 real[]; hi2 real[]; mg real := 0; st text := ''; zz real; lx int := 0; xs jsonb := '[]'::jsonb;
        tun int := 0; via int := 0; brg int := 0; acc real; cnt int; G real; off real; wr real[] := '{}'; w0 real; nu int;
begin
  -- 1マスごとの地面
  for sm in select * from _mp_gsamp(p) loop ss := ss || sm.s; gg := gg || sm.g; tt := tt || sm.t; end loop;
  ns := array_length(ss, 1); S := ss[ns];
  G := case when kind = 'road' then 0.08 when rack then 0.07 else 0.035 end;
  -- 通るもの：交差する線（線路どうしは 10m・道路とは 5m 上か下。どちらも地面なら踏切・交差点。前からの道路（高さを決めていない）は、まわりの高さを合わせるので どの高さでもよい）・
  --   建物・ホーム・車庫・バス停・滑走路
  for o in select x.s s0, x.s s1, x.oz - q.sep zb, x.oz + q.sep zt, x.og g, (kind = 'road' or x.okind = 'road') and abs(x.oz - x.og) <= 2.5 lvl,
                  case when x.okind = 'rail' then '線路' || case when x.oname <> '' then '「' || x.oname || '」' else '' end else case x.ocls when 'exp' then '高速道路' else '道路' end end nm, 'x' k
             from _mp_xing(p, oseg) x, lateral (select case when kind = 'rail' and x.okind = 'rail' then 10 when x.okind = 'road' and not x.ohp and x.ocls <> 'exp' then 2.5 else 5 end sep) q
            where not xonly or x.okind = 'rail'
           union all
           select b.s0, b.s1, b.zb, b.zt, b.zb + 15, false, b.name, case when b.name like '建物%' then 'b' else 'o' end from _mp_prof_obst(p, cells, tiles, oseg) b where not xonly loop
    if o.k in ('o', 'x') and (o.s1 < ea or o.s0 > eb) then continue; end if;   -- つなぐはしの近く（20m）の駅・車庫・線（つなぐところ）
    o_s0 := o_s0 || o.s0; o_s1 := o_s1 || o.s1; o_zb := o_zb || o.zb; o_zt := o_zt || o.zt; o_g := o_g || o.g; o_lv := o_lv || o.lvl; o_nm := o_nm || o.nm; o_k := o_k || o.k; no := no + 1;
  end loop;
  -- 水のところ（川・湖・海）：[はじめ, おわり, …]（線のはしの 0.2マスはのぞく）
  for j in 1..ns loop
    if tt[j] in ('S', 'R', 'L', 'D') and ss[j] > 0.2 and ss[j] < S - 0.2 then
      if w0 is null then w0 := greatest(0.2, ss[j] - 0.5); end if;
    elsif w0 is not null then wr := wr || array[w0, least(S - 0.2, ss[j - 1] + 0.5)]; w0 := null; end if;
  end loop;
  if w0 is not null then wr := wr || array[w0, least(S - 0.2, ss[ns] + 0.5)]; end if;
  begin
    -- 自動：3マス（150m）ごとの点と、通るもの・水・車庫のはしの点（近い点は1つに）。目標は まわり（±1.5マス）の地面の平均 ＋ 高架 10m・地下 −20m
    nu := greatest(1, floor(S / 3)::int);
    an := array(select (S * gi / nu)::real from generate_series(0, nu) gi);
    for i in 1..no loop an := an || array[least(S, greatest(0, o_s0[i])), least(S, greatest(0, o_s1[i]))]; end loop;
    an := an || wr;
    for k in 1..coalesce(array_length(fx, 1), 0) / 4 loop an := an || array[least(S, greatest(0, fx[4 * k - 3])), least(S, greatest(0, fx[4 * k - 2]))]; end loop;
    for k in 1..coalesce(array_length(upf, 1), 0) / 2 loop an := an || least(S, greatest(0, upf[2 * k - 1])); end loop;
    for zz in select v from unnest(an) v order by v loop
      if array_length(cs, 1) is null or zz > cs[array_length(cs, 1)] + 0.02 then cs := cs || zz; end if;
    end loop;
    cs[1] := 0; cs[array_length(cs, 1)] := S; n := array_length(cs, 1);
    off := case mode when 'el' then 10 when 'ug' then -20 else 0 end;
    for k in 1..n loop
      acc := 0; cnt := 0;
      for j in greatest(1, ceil(cs[k] - 1.5)::int + 1)..least(ns, floor(cs[k] + 1.5)::int + 2) loop if abs(ss[j] - cs[k]) <= 1.5 then acc := acc + gg[j]; cnt := cnt + 1; end if; end loop;
      tg := tg || (round((acc / greatest(cnt, 1) + off)::numeric, 1))::real;
    end loop;
    lo := array_fill(-1e9::real, array[n]); hi := array_fill(1e9::real, array[n]);
    if z0 is not null then lo[1] := z0; hi[1] := z0; end if;
    if z1 is not null then lo[n] := z1; hi[n] := z1; end if;
    for k in 1..n - 1 loop d := d || _mp_hd(kind, rack, cs[k + 1] - cs[k]); end loop;
    -- 水の上：橋（2m より上）。地下（地下鉄）なら 川・海の下（−15m より下）
    for k in 1..coalesce(array_length(wr, 1), 0) / 2 loop
      for j in 1..n loop
        if cs[j] >= wr[2 * k - 1] - 0.02 and cs[j] <= wr[2 * k] + 0.02 then
          if mode = 'ug' then hi[j] := least(hi[j], -15); else lo[j] := greatest(lo[j], 2); end if;
        end if;
      end loop;
    end loop;
    -- 決まった高さのところ（車庫：地面 ±2.5m）
    for k in 1..coalesce(array_length(fx, 1), 0) / 4 loop
      for j in 1..n loop
        if cs[j] >= fx[4 * k - 3] - 0.02 and cs[j] <= fx[4 * k - 2] + 0.02 then lo[j] := greatest(lo[j], fx[4 * k - 1]); hi[j] := least(hi[j], fx[4 * k]); end if;
      end loop;
    end loop;
    -- 手で決めた高さ（その点は その高さ）
    for k in 1..coalesce(array_length(upf, 1), 0) / 2 loop
      for j in 1..n loop
        if abs(cs[j] - least(S, greatest(0, upf[2 * k - 1]))) <= 0.02 then lo[j] := greatest(lo[j], upf[2 * k]); hi[j] := least(hi[j], upf[2 * k]); end if;
      end loop;
    end loop;
    -- 通るものごとの点の範囲（ka〜kb）
    for i in 1..no loop
      ka := null; kb := null;
      for j in 1..n loop
        exit when cs[j] > o_s1[i] + 0.02;
        if cs[j] >= o_s0[i] - 0.02 then ka := coalesce(ka, j); kb := j; end if;
      end loop;
      o_ka := o_ka || coalesce(ka, 0); o_kb := o_kb || coalesce(kb, -1);
    end loop;
    ord := array(select gi from generate_series(1, no) gi order by o_lv[gi], o_s0[gi]);
    -- 解く。通るものにかかるところは、1つずつ上か下（か踏切）に決めて解きなおす（だめなら ほかの側。線路・建物などが先、踏切にできる道路はあと）
    z := _mp_prof_solve(tg, lo, hi, d);
    if z is null then
      return jsonb_build_object('ok', false, 'err', case when z0 is not null and z1 is not null and abs(z1 - z0) > G * S * 50 then
        format('勾配がきつすぎて、はしの高さどうしをつなげません（%s は %s‰ まで。高さの差 %sm・長さ %sm）', case when kind = 'road' then '道路' when rack then 'アプト式' else '線路' end,
               round(G * 1000), round(abs(z1 - z0)::numeric), round((S * 50)::numeric))
        when upf is not null then '手で決めた高さでは、勾配がきつすぎます（はしの高さ・ほかの決めた高さ・川の上の橋・車庫のところとあいません）'
        else '勾配がきつすぎて、この形では引けません（川・海の上の橋や、車庫のところの高さがとれません）' end);
    end if;
    for it in 1..no + 1 loop
      fi := null;
      foreach i in array coalesce(ord, '{}') loop
        continue when o_ka[i] = 0;
        za := 1e9; zb_ := -1e9;
        for j in o_ka[i]..o_kb[i] loop za := least(za, z[j]); zb_ := greatest(zb_, z[j]); end loop;
        continue when zb_ <= o_zb[i] + 0.01 or za >= o_zt[i] - 0.01 or (o_lv[i] and za >= o_g[i] - 2.51 and zb_ <= o_g[i] + 2.51);
        fi := i; exit;
      end loop;
      exit when fi is null;
      zm := (za + zb_) / 2;
      -- ためす順：滑走路は下だけ。地下・高架をえらんだら その側から。踏切にできて地面に近ければ踏切。高い建物（25m より上）は下から。ほかは近い側から
      sides := case when o_zt[fi] > 1e8 then array['under']
                    when mode = 'ug' then array['under', 'over'] when mode = 'el' then array['over', 'under']
                    when o_lv[fi] and abs(zm - o_g[fi]) <= 7.5 then case when zm >= o_g[fi] then array['level', 'over', 'under'] else array['level', 'under', 'over'] end
                    when o_k[fi] = 'b' and o_zt[fi] - o_g[fi] > 25 then array['under', 'over']
                    when o_zt[fi] - zm <= zm - o_zb[fi] then array['over', 'under'] else array['under', 'over'] end
               || case when o_lv[fi] and not abs(zm - o_g[fi]) <= 7.5 then array['level'] else '{}'::text[] end;
      z2 := null;
      foreach side in array sides loop
        lo2 := lo; hi2 := hi;
        for j in o_ka[fi]..o_kb[fi] loop
          if side = 'over' then lo2[j] := greatest(lo2[j], o_zt[fi]);
          elsif side = 'under' then hi2[j] := least(hi2[j], o_zb[fi]);
          else lo2[j] := greatest(lo2[j], o_g[fi] - 2.5); hi2[j] := least(hi2[j], o_g[fi] + 2.5); end if;
        end loop;
        z2 := _mp_prof_solve(tg, lo2, hi2, d);
        exit when z2 is not null;
      end loop;
      if z2 is null then return jsonb_build_object('ok', false, 'err', '上下をよける高さがとれません（勾配がきつすぎます' || case when upf is not null then '。手で決めた高さも見なおしてください' else '' end || '）：' || o_nm[fi]); end if;
      lo := lo2; hi := hi2; z := z2;
    end loop;
    if fi is not null then return jsonb_build_object('ok', false, 'err', '上下をよける高さがとれません：' || o_nm[fi]); end if;
    pf := _mp_prof_pack(cs, z);
  end;
  -- いちばん急な勾配・1マスごとのつくり・踏切・交差
  for k in 1..n - 1 loop mg := greatest(mg, abs(z[k + 1] - z[k]) / greatest((cs[k + 1] - cs[k]) * 50, 1) * 1000); end loop;
  for j in 1..ns loop
    zz := _mp_pz(pf, ss[j]);
    st := st || _mp_st_code(zz, gg[j], tt[j]);
  end loop;
  tun := 50 * (length(st) - length(replace(st, 'T', ''))); via := 50 * (length(st) - length(replace(st, 'V', ''))); brg := 50 * (length(st) - length(replace(st, 'B', '')));
  for i in 1..no loop
    za := _mp_pz(pf, (o_s0[i] + o_s1[i]) / 2);
    side := case when za >= o_zt[i] - 0.01 then 'over' when za <= o_zb[i] + 0.01 then 'under' else 'level' end;
    if side = 'level' and o_k[i] = 'x' then lx := lx + 1; end if;
    xs := xs || jsonb_build_array(jsonb_build_array(round(o_s0[i]::numeric, 1), side, o_nm[i]));
  end loop;
  return jsonb_build_object('ok', true, 'prof', to_jsonb(pf), 'st', st, 'g', (select jsonb_agg(round(v::numeric)) from unnest(gg) v), 'maxg', round(mg::numeric),
    'tun', tun, 'via', via, 'brg', brg, 'lx', lx, 'xs', xs, 'ns', ns);
end $$;
-- s の列と z の列を、縦断 [s0, z0, s1, z1, …] に
create or replace function public._mp_prof_pack(cs real[], z real[]) returns real[]
language sql immutable as $$ select array_agg(v order by i, o) from generate_series(1, array_length(cs, 1)) i, lateral unnest(array[round(cs[i]::numeric, 2)::real, round(z[i]::numeric, 2)::real]) with ordinality u(v, o) $$;

-- つなぐ先の高さ（{node: id} は点の高さ・{seg: id} はその線のその位置の高さ（はしの近くなら はしの点）。新しい点なら null）
create or replace function public._mp_att_z(att jsonb, px int, py int) returns real
language plpgsql stable set search_path = public as $$
declare sg mp_segs; q record;
begin
  if att is null then return null; end if;
  if att ? 'node' then return _mp_node_z((att ->> 'node')::bigint); end if;
  if att ? 'seg' then
    select * into sg from mp_segs where id = (att ->> 'seg')::bigint;
    if not found then return null; end if;
    select * into q from _mp_proj(sg.pts, px / 100.0, py / 100.0);
    if q.s < 0.4 and sg.n0 is not null then return _mp_node_z(sg.n0); end if;   -- _mp_end と同じ
    if q.s > sg.len - 0.4 and sg.n1 is not null then return _mp_node_z(sg.n1); end if;
    return _mp_seg_z(sg, q.s);
  end if;
  return null;
end $$;
-- 線のはしの点の高さ：ほかの線もつながっていれば その高さ（動かせない）。この線だけのはしなら null（自由）
create or replace function public._mp_end_z(nid bigint, sid bigint) returns real
language sql stable set search_path = public as $$
  select case when nid is not null and exists (select 1 from mp_segs s where (s.n0 = nid or s.n1 = nid) and s.id <> sid) then _mp_node_z(nid) end
$$;
-- 地面どおりの縦断（1マスごと。前からの線を、ほかの線とつなぐとき）
create or replace function public._mp_prof_ground(p int[]) returns real[]
language sql stable set search_path = public as $$
  select array_agg(v order by g.i, u.o) from _mp_gsamp(p) g, lateral unnest(array[round(g.s::numeric, 2)::real, g.g]) with ordinality u(v, o)
$$;
-- 2つの縦断をつなぐ（b は off マスずらす。同じ位置の点は1つに）
create or replace function public._mp_prof_cat(a real[], b real[], off real) returns real[]
language plpgsql immutable as $$
declare out real[] := a; i int; ls real := a[array_length(a, 1) - 1];
begin
  for i in 1..array_length(b, 1) / 2 loop
    if b[2 * i - 1] + off > ls + 0.05 then out := out || array[(b[2 * i - 1] + off)::real, b[2 * i]]; end if;
  end loop;
  return out;
end $$;
-- 線のつくり（1マスごと。縦断がなければ null）
create or replace function public._mp_st_of(p int[], pf real[]) returns text
language sql stable set search_path = public as $$
  select case when pf is null then null else (select string_agg(_mp_st_code(_mp_pz(pf, g.s), g.g, g.t), '' order by g.i) from _mp_gsamp(p) g) end
$$;

-- 線のマス（_mp_tiles と同じ順）ごとの、はじめからの長さ（そのマスに入ったところ）
create or replace function public._mp_tiles_s(p int[]) returns real[]
language plpgsql immutable as $$
declare n int := coalesce(array_length(p, 1), 0) / 2; i int; k int; m int; ax real; ay real; bx real; by_ real; tx int; ty int; d real; acc real := 0;
        out real[] := '{}'; lx int := null; ly int := null; seen text[] := '{}'; key text;
begin
  for i in 1..n loop
    ax := p[2 * i - 1] / 100.0; ay := p[2 * i] / 100.0;
    if i < n then bx := p[2 * i + 1] / 100.0; by_ := p[2 * i + 2] / 100.0; else bx := ax; by_ := ay; end if;
    d := sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2);
    m := greatest(1, ceil(d / 0.25)::int);
    for k in 0..(case when i < n then m - 1 else 0 end) loop
      tx := floor(ax + (bx - ax) * k / m)::int; ty := floor(ay + (by_ - ay) * k / m)::int;
      if lx is distinct from tx or ly is distinct from ty then
        key := tx || ',' || ty;
        if not (key = any(seen)) then out := out || (acc + d * k / m)::real; seen := seen || key; end if;
        lx := tx; ly := ty;
      end if;
    end loop;
    acc := acc + d;
  end loop;
  return out;
end $$;
-- 線のマス（_mp_tiles と同じ順）ごとのつくり（G・V・T・B）。st がなければ ぜんぶ G（地面どおり）
create or replace function public._mp_st_tiles(p int[], st text) returns text[]
language plpgsql immutable as $$
declare ts real[] := _mp_tiles_s(p); out text[] := '{}'; i int; ns int := length(st);
begin
  for i in 1..coalesce(array_length(ts, 1), 0) loop
    out := out || case when st is null then 'G' else substr(st, least(ns, floor(ts[i] + 1)::int + 1), 1) end;
  end loop;
  return out;
end $$;
-- {"x,y": つくり}（前の線のマスごとのつくり。工事費の差をみるとき）
create or replace function public._mp_st_map(p int[], st text) returns jsonb
language plpgsql immutable as $$
declare t int[] := _mp_tiles(p); c text[] := _mp_st_tiles(p, st);
begin
  return (select coalesce(jsonb_object_agg(t[2 * gi - 1] || ',' || t[2 * gi], c[gi]), '{}'::jsonb) from generate_series(1, coalesce(array_length(c, 1), 0)) gi);
end $$;
-- 工事費（マスごと）：base ×（つくりと地形の倍率）×（1 ＋ urb_k × 人の多さ）× 複線 ×（アプト式 1.3）＋ 電化
--   om（{"x,y": 前のつくり}）があれば、前からあるマスは高くなった分だけ（電化はなし）。om にないマスは新しいマス
create or replace function public._mp_st_cost(tiles int[], ters text[], codes text[], rack boolean, om jsonb, orack boolean, base numeric, dblm numeric, elec numeric) returns numeric
language plpgsql stable set search_path = public as $$
declare i int; c text; o text; k numeric := _mp_rate('urb_k'); f numeric; tot numeric := 0; rm numeric := case when rack then 1.3 else 1 end; orm numeric := case when orack then 1.3 else 1 end;
begin
  for i in 1..coalesce(array_length(ters, 1), 0) loop
    c := coalesce(codes[i], 'G'); o := case when om is null then null else om ->> (tiles[2 * i - 1] || ',' || tiles[2 * i]) end;
    if o is null then
      tot := tot + base * _mp_smul(c, ters[i]) * rm * (1 + k * _mp_dens(tiles[2 * i - 1] + 0.5, tiles[2 * i] + 0.5)) * dblm + elec;
    else
      f := _mp_smul(c, ters[i]) * rm - _mp_smul(o, ters[i]) * orm;
      if f > 0.001 then tot := tot + base * f * (1 + k * _mp_dens(tiles[2 * i - 1] + 0.5, tiles[2 * i] + 0.5)) * dblm; end if;
    end if;
  end loop;
  return tot;
end $$;

-- マスごとの工事費の倍率（つくり st と地形 ters・まちの係数・アプト式 1.3倍）。_mp_cmuls の、縦断のある線の分
create or replace function public._mp_st_muls(p int[], ters text[], st text, rack boolean) returns real[]
language plpgsql stable set search_path = public as $$
declare t int[] := _mp_tiles(p); c text[] := _mp_st_tiles(p, st); out real[] := '{}'; i int; k numeric := _mp_rate('urb_k');
begin
  for i in 1..coalesce(array_length(ters, 1), 0) loop
    out := out || (_mp_smul(coalesce(c[i], 'G'), ters[i]) * (1 + k * _mp_dens(t[2 * i - 1] + 0.5, t[2 * i] + 0.5)) * case when rack then 1.3 else 1 end)::real;
  end loop;
  return out;
end $$;

-- 駅の高さの種類：U 地下駅（地面より 8m 以上 低い）・E 高架駅（6m 以上 高い）・null 地上
create or replace function public._mp_zl(z real, g real) returns text
language sql immutable as $$ select case when z <= g - 8 then 'U' when z >= g + 6 then 'E' end $$;
-- 駅（線 seg の位置 at）の高さの種類（線に縦断がなければ null＝地上）
create or replace function public._mp_sta_lv(seg bigint, at real, x int, y int) returns text
language sql stable set search_path = public as $$
  select _mp_zl(_mp_pz(sg.prof, at), _mp_gz(x / 100.0, y / 100.0)) from mp_segs sg where sg.id = seg and sg.prof is not null
$$;
-- 駅の工事費（地上）：基本 ＋ 番線 × ホームの長さ（m）×（1 ＋ urb_sta × 人の多さ）。地下駅は 2.5倍・高架駅は 1.5倍
create or replace function public._mp_sta_cost(tracks int, plat int, px real, py real, zl text) returns numeric
language sql stable set search_path = public as $$
  select (_mp_rate('sta_base') + tracks * plat * _mp_rate('sta_m')) * (1 + _mp_rate('urb_sta') * _mp_dens(px, py)) * case zl when 'U' then 2.5 when 'E' then 1.5 else 1 end
$$;
-- 区画の一覧（[X0, Y0, …]）のうち、高さ z（m）のホームがかかる建物の筆（地面−15m より深いか、屋根＋5m より高ければ かからない）
create or replace function public._mp_bld_hit_z(cells int[], z real) returns text
language sql stable set search_path = public as $$
  select string_agg(distinct p.ban || '番', ' ') from generate_series(1, coalesce(array_length(cells, 1), 0) / 2) i
    join mp_bcells bc on bc.x = cells[2 * i - 1] and bc.y = cells[2 * i] join mp_blds b on b.id = bc.bld join mp_parcels p on p.id = b.parcel,
    lateral (select _mp_gz((bc.x + 0.5) / 5.0, (bc.y + 0.5) / 5.0) g) q
   where z is null or (z > q.g - 15 and z < q.g + case when b.floors > 0 then b.floors * 3.5 + 3 else 0 end + 5)
$$;

-- 線の高さを変える（地形に合わせる・高架・地下・手で直した縦断・アプト式）。駅のある線もできる（駅も地下駅・高架駅になる）。車庫のところは地面の高さのまま
--   p_mode：auto・el・ug。p_prof：手で決めた高さ（[s, z, …]。その位置はその高さ、ほかは p_mode で自動）。p_rack：アプト式（線路だけ。null はいまのまま）
--   はしの高さは、つながっている線と同じ（この線だけのはしは自由）
--   工事費：つくりが高くなるマス（地面 → 高架・トンネル・橋など）の差の分と、地下駅・高架駅になる駅の差の分。もどしても返金なし
create or replace function public.mp_seg_height(p_id bigint, p_mode text, p_prof real[], p_rack boolean, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; pr jsonb; rk boolean; md text; nhm text; tiles int[]; cells int[]; base numeric; amt numeric := 0; scost numeric := 0;
        pf real[]; nw text; vl int; z0 real; z1 real; s record; g real; ozl text; nzl text; sts jsonb := '[]'::jsonb;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  rk := sg.kind = 'rail' and coalesce(p_rack, sg.rack);
  md := case when p_mode in ('auto', 'el', 'ug') then p_mode else 'auto' end;
  nhm := case when p_prof is not null then 'man' else md end;
  if not p_dry then perform _mp_lock(sg.own_u, sg.own_c); end if;
  tiles := _mp_tiles(sg.pts);
  cells := _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl);
  z0 := _mp_end_z(sg.n0, p_id); z1 := _mp_end_z(sg.n1, p_id);
  pr := _mp_prof_make(sg.pts, sg.kind, sg.cls, z0, z1, md, rk, p_prof, cells, tiles, least(0.4, sg.len / 3)::real, (sg.len - least(0.4, sg.len / 3))::real, array[sg.id], false,
                       _mp_dep_fx(sg.id, 0, false, sg.len));
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  nw := pr ->> 'st';
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  base := case when sg.kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(sg.cls, sg.lanes) end;
  -- 駅：地上・地下駅・高架駅が変わるとき
  for s in select * from mp_stations where seg = p_id and kind = 'rail' order by at loop
    g := _mp_gz(s.x / 100.0, s.y / 100.0);
    ozl := _mp_zl(_mp_seg_z(sg, s.at), g); nzl := _mp_zl(_mp_pz(pf, s.at), g);
    if ozl is distinct from nzl then
      sts := sts || jsonb_build_array(jsonb_build_array(s.name, coalesce(ozl, 'G'), coalesce(nzl, 'G')));
      if not sg.gov then scost := scost + greatest(0, _mp_sta_cost(s.tracks, s.plat, (s.x / 100.0)::real, (s.y / 100.0)::real, nzl) - _mp_sta_cost(s.tracks, s.plat, (s.x / 100.0)::real, (s.y / 100.0)::real, ozl)); end if;
    end if;
  end loop;
  if not sg.gov then
    amt := _mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(sg.pts, nw), rk, _mp_st_map(sg.pts, sg.st), sg.rack, base, case when sg.dbl then _mp_rate('dbl_mul') else 1 end, 0) + scost;
  end if;
  amt := round(amt);
  vl := case when sg.kind = 'rail' then case when rk then least(30, _mp_vlim(_mp_minr(sg.pts))) else _mp_vlim(_mp_minr(sg.pts)) end else sg.vlim end;
  if p_dry then
    return (pr - 'ok' - 'ns') || jsonb_build_object('cost', amt, 'vlim', vl, 'rack', rk, 'hm', nhm, 'stas', sts, 'z0', z0, 'z1', z1, 'len', round(sg.len::numeric, 2));
  end if;
  if amt > 0 then
    perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt::bigint, sg.kind, format('%sの高さ（%s）', case when sg.kind = 'rail' then '線路' else '道路' end,
                    case nhm when 'man' then '高さを手で決めた' when 'el' then '高架' when 'ug' then '地下' else '地形に合わせる' end || case when rk and not sg.rack then '・アプト式' else '' end));
  end if;
  update mp_segs set prof = pf, st = nw, rack = rk, hm = nhm, vlim = vl, cost = cost + amt::bigint where id = p_id;
  update mp_nodes set z = pf[2] where id = sg.n0 and (z is null or z0 is null);
  update mp_nodes set z = pf[array_length(pf, 1)] where id = sg.n1 and (z is null or z1 is null);
  if sg.kind = 'rail' and vl is distinct from sg.vlim then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  for s in select id, x, y from mp_stations where seg = p_id loop
    perform _mp_chg('sta', s.id, 'set', box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3)));
  end loop;
  return jsonb_build_object('id', p_id, 'cost', amt);
end $$;

-- 線 sid の車庫のところ：[s0, s1, 地面−2.5, 地面＋2.5, …]（off マスずらす。rev なら逆向き。長さ ln）
create or replace function public._mp_dep_fx(sid bigint, off real, rev boolean, ln real) returns real[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(u.v order by d.id, u.o), '{}') from mp_depots d,
    lateral (select (_mp_dep_dim(d.kind, d.size))[1] / 2 + 0.5 h, _mp_gz(d.x / 100.0, d.y / 100.0) g, off + case when rev then ln - d.at else d.at end c) q,
    lateral unnest(array[q.c - q.h, q.c + q.h, q.g - 2.5, q.g + 2.5]::real[]) with ordinality u(v, o)
   where d.seg = sid
$$;
-- 分かれ道のない点でつながる線路（同じ持ち主。あわせて 600マスまで）を、sid から両がわへ。はしから順に（rev：逆向きにつなぐ）
create or replace function public._mp_chain(sid bigint) returns table (ord int, id bigint, rev boolean)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare s0 mp_segs; t mp_segs; ids bigint[]; rvs boolean[]; nd bigint; cur bigint; k int; tot real; dir int;
begin
  select * into s0 from mp_segs q where q.id = sid;
  if not found then return; end if;
  ids := array[sid]; rvs := array[false]; tot := s0.len;
  for dir in 0..1 loop
    nd := case when dir = 0 then s0.n1 else s0.n0 end; cur := sid;
    for k in 1..60 loop
      exit when nd is null or tot > 600;
      exit when (select count(*) from mp_segs q where q.n0 = nd or q.n1 = nd) <> 2;
      select * into t from mp_segs q where (q.n0 = nd or q.n1 = nd) and q.id <> cur limit 1;
      exit when t.id is null or t.id = any(ids) or t.kind <> 'rail' or t.own_u is distinct from s0.own_u or t.own_c is distinct from s0.own_c or t.gov <> s0.gov;
      if dir = 0 then ids := ids || t.id; rvs := rvs || (t.n1 = nd);   -- うしろへ：nd から出ていく向き
      else ids := t.id || ids; rvs := (t.n0 = nd) || rvs; end if;     -- まえへ：nd に入る向き
      tot := tot + t.len;
      nd := case when t.n0 = nd then t.n1 else t.n0 end; cur := t.id;
    end loop;
  end loop;
  return query select o::int, ids[o], rvs[o] from generate_subscripts(ids, 1) o;
end $$;
-- 線路 k（と、分かれ道のない点でつながる線路）が、ほかの線路と同じ高さ（10m より近い）で交わるところを直す：交わるところの前後 w マスだけ
--   縦断を決めなおす（ほかの線路との交差だけ見る。車庫のところは地面のまま。無料）。直した線の番号（直すところがなければ '{}'。1つも直せなければ null）
--   直せないところ（分かれ道のすぐ近くなど）は、そのまま
create or replace function public._mp_fix_xing(k bigint, w real) returns bigint[]
language plpgsql set search_path = public as $$
declare c record; sg mp_segs; ids bigint[] := '{}'; rvs boolean[] := '{}'; offs real[] := '{}'; lens real[] := '{}'; cp int[] := '{}'; p int[]; m int; gp real; tl real := 0;
        cs_ real[] := '{}'; cz_ real[] := '{}'; cur real[]; smp record; x record; xs real[] := '{}'; wa real[] := '{}'; wb real[] := '{}'; i int; j int; a0 real; a1 real;
        nd0 bigint; nd1 bigint; z0 real; z1 real; pr jsonb; wp real[]; wpt real[] := '{}'; fx real[] := '{}'; wfx real[]; comb real[]; sub real[]; upd bigint[] := '{}'; inw boolean;
begin
  -- 1本の線に（つなぎ目の点は1つに）
  for c in select * from _mp_chain(k) order by ord loop
    select * into sg from mp_segs where id = c.id;
    p := case when c.rev then _mp_rev(sg.pts) else sg.pts end;
    m := coalesce(array_length(cp, 1), 0);
    if m > 0 then
      gp := sqrt(((p[1] - cp[m - 1]) / 100.0) ^ 2 + ((p[2] - cp[m]) / 100.0) ^ 2);
      if gp < 0.03 then cp := cp || p[3:]; else cp := cp || p; tl := tl + gp; end if;
    else cp := p; end if;
    ids := ids || c.id; rvs := rvs || c.rev; offs := offs || tl; lens := lens || sg.len;
    fx := fx || _mp_dep_fx(c.id, tl, c.rev, sg.len);
    -- いまの高さ（1マスごと）
    for smp in select g.s, g.g from _mp_gsamp(sg.pts) g loop
      cs_ := cs_ || (tl + case when c.rev then sg.len - smp.s else smp.s end)::real;
      cz_ := cz_ || case when sg.prof is null then smp.g else _mp_pz(sg.prof, smp.s) end;
    end loop;
    tl := tl + sg.len;
  end loop;
  if array_length(ids, 1) is null then return null; end if;
  cur := (select array_agg(u.v order by q.s, q.k, u.o) from unnest(cs_, cz_) with ordinality q(s, z, k), lateral unnest(array[q.s, q.z]) with ordinality u(v, o));   -- 同じ s の点があっても組をくずさない
  -- 同じ高さで交わるところ → 前後 w マスの区間（重なれば1つに）
  for x in select * from _mp_xing(cp, ids) q where q.okind = 'rail' order by q.s loop
    if abs(x.oz - _mp_pz(cur, x.s)) < 9.9 then xs := xs || x.s; end if;
  end loop;
  if array_length(xs, 1) is null then return '{}'; end if;
  for i in 1..array_length(xs, 1) loop
    a0 := greatest(0, xs[i] - w); a1 := least(tl, xs[i] + w);
    if array_length(wa, 1) is not null and a0 <= wb[array_length(wb, 1)] + 1 then wb[array_length(wb, 1)] := a1;
    else wa := wa || a0; wb := wb || a1; end if;
  end loop;
  -- はしの点：ほかの線もつながっていれば その高さ
  select * into sg from mp_segs where id = ids[1]; nd0 := case when rvs[1] then sg.n1 else sg.n0 end; z0 := _mp_end_z(nd0, ids[1]);
  select * into sg from mp_segs where id = ids[array_length(ids, 1)]; nd1 := case when rvs[array_length(ids, 1)] then sg.n0 else sg.n1 end; z1 := _mp_end_z(nd1, ids[array_length(ids, 1)]);
  -- 区間ごとに縦断を決める（区間のはしは、いまの高さ）
  for i in 1..array_length(wa, 1) loop
    a0 := wa[i]; a1 := wb[i];
    if a0 < 0.5 then a0 := 0; end if;
    if a1 > tl - 0.5 then a1 := tl; end if;
    wfx := '{}';
    for j in 1..coalesce(array_length(fx, 1), 0) / 4 loop
      if fx[4 * j - 2] > a0 and fx[4 * j - 3] < a1 then wfx := wfx || array[fx[4 * j - 3] - a0, fx[4 * j - 2] - a0, fx[4 * j - 1], fx[4 * j]]; end if;
    end loop;
    pr := _mp_prof_make(_mp_sub(cp, a0, a1), 'rail', 'rail', case when a0 = 0 then z0 else _mp_pz(cur, a0) end, case when a1 = tl then z1 else _mp_pz(cur, a1) end,
                        'auto', false, null::real[], null::int[], null::int[], case when a0 = 0 then 0.4 else 0 end::real, (a1 - a0 - case when a1 = tl then 0.4 else 0 end)::real, ids, true, wfx);
    if not (pr ->> 'ok')::boolean then wa[i] := null; wb[i] := null; continue; end if;   -- この区間は直せない（そのまま）
    wp := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
    for j in 1..array_length(wp, 1) / 2 loop wpt := wpt || array[wp[2 * j - 1] + a0, wp[2 * j]]; end loop;
    wa[i] := a0; wb[i] := a1;
  end loop;
  if array_length(wpt, 1) is null then return null; end if;
  -- 区間の外は いまの高さ、区間の中は 決めた縦断
  comb := wpt;
  for j in 1..array_length(cs_, 1) loop
    inw := false;
    for i in 1..array_length(wa, 1) loop if wa[i] is not null and cs_[j] > wa[i] + 0.01 and cs_[j] < wb[i] - 0.01 then inw := true; exit; end if; end loop;
    if not inw then comb := comb || array[cs_[j], cz_[j]]; end if;
  end loop;
  comb := (select array_agg(u.v order by q.s, q.gi, u.o) from (select comb[2 * gi - 1] s, comb[2 * gi] z, gi from generate_series(1, array_length(comb, 1) / 2) gi) q,
                   lateral unnest(array[q.s, q.z]) with ordinality u(v, o));
  -- 区間にかかる線だけ、縦断を入れる
  for i in 1..array_length(ids, 1) loop
    if not exists (select 1 from generate_series(1, array_length(wa, 1)) gi where wa[gi] < offs[i] + lens[i] and wb[gi] > offs[i]) then continue; end if;
    select * into sg from mp_segs where id = ids[i] for update;
    sub := _mp_prof_sub(comb, offs[i], offs[i] + lens[i]);
    if rvs[i] then sub := _mp_prof_rev(sub, lens[i]); end if;
    update mp_segs set prof = sub, st = _mp_st_of(sg.pts, sub), hm = coalesce(hm, 'auto') where id = ids[i];
    update mp_nodes set z = _mp_pz(sub, 0) where id = sg.n0;
    update mp_nodes set z = _mp_pz(sub, sg.len) where id = sg.n1;
    perform _mp_chg('seg', ids[i], 'set', sg.bb);
    for smp in select st.id, st.x, st.y from mp_stations st where st.seg = ids[i] loop
      perform _mp_chg('sta', smp.id, 'set', box(point(smp.x / 100.0 - 3, smp.y / 100.0 - 3), point(smp.x / 100.0 + 3, smp.y / 100.0 + 3)));
    end loop;
    upd := upd || ids[i];
  end loop;
  return upd;
end $$;

-- ---------- 前からの関数を直す（高さ） ----------
create or replace function public._mp_split(sid bigint, s real) returns bigint
language plpgsql set search_path = public as $$
declare sg mp_segs; q record; nid bigint; pa int[]; pb int[]; bid bigint; ta int[]; tb int[]; prev jsonb; fa real[]; fb real[];
begin
  select * into sg from mp_segs where id = sid for update;
  if s < 0.3 or s > sg.len - 0.3 then raise exception '線のはしの近くでは分けられません'; end if;
  select * into q from _mp_at(sg.pts, s);
  insert into mp_nodes(kind, x, y, z) values (sg.kind, round(q.x * 100), round(q.y * 100), case when sg.prof is not null then _mp_pz(sg.prof, s) end) returning id into nid;   -- 高さ（t108）
  pa := _mp_sub(sg.pts, 0, s); pb := _mp_sub(sg.pts, s, sg.len);
  fa := _mp_prof_sub(sg.prof, 0, s); fb := _mp_prof_sub(sg.prof, s, sg.len);   -- 縦断（なければ null）
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color, snowp, prof, st, rack, hm)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then least(case when sg.rack then 30 else 300 end, _mp_vlim(_mp_minr(pb))) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color,   -- color：路線カラーもそのまま（2026-10-29）
          sg.snowp, fb, _mp_st_of(pb, fb), sg.rack, sg.hm)   -- 雪よけ・高さ・アプト式もそのまま（t108）
  returning id into bid;
  update mp_segs set pts = pa, ctl = null, bb = _mp_bb(pa), len = _mp_len(pa), vlim = case when kind = 'rail' then least(case when rack then 30 else 300 end, _mp_vlim(_mp_minr(pa))) else vlim end, n1 = nid,
                     prof = fa, st = _mp_st_of(pa, fa) where id = sid;
  ta := _mp_tiles(pa); tb := _mp_tiles(pb);
  delete from mp_occ where what = sg.kind and ref = sid;
  perform _mp_occ_set(sid, sg.kind, ta); perform _mp_occ_set(bid, sg.kind, tb);
  -- 使用料は、分けたあとの線ごとに区画で決めなおす（前から使っていた区画の使用料はそのまま）
  prev := (select jsonb_object_agg(e.x || ',' || e.y, e.fee) from mp_leases e where e.ref_kind = 'seg' and e.ref = sid);
  perform _mp_lease_set('seg', sid, sg.own_u, sg.own_c, sg.gov, prev);
  perform _mp_lease_set('seg', bid, sg.own_u, sg.own_c, sg.gov, prev);
  -- 駅・車庫は、後ろ半分にあるものを新しい線へ
  update mp_stations set seg = bid, at = at - s where seg = sid and at > s;
  update mp_depots set seg = bid, at = at - s where seg = sid and at > s;
  update mp_occ o set ref = o.ref where false;   -- （駅・車庫のマスは駅・車庫の番号なので、そのまま）
  perform _mp_chg('seg', sid, 'set', sg.bb);
  perform _mp_chg('seg', bid, 'set', sg.bb);
  return nid;
end $$;

create or replace function public._mp_seg_join2(xid bigint, yid bigint) returns bigint
language plpgsql set search_path = public as $$
declare x mp_segs; y mp_segs; nd bigint; xr boolean; yr boolean; px int[]; py int[]; pm int[]; lx real; jl real; n int; d real; fx real[]; fy real[]; fm real[];
begin
  select * into x from mp_segs where id = xid for update;
  select * into y from mp_segs where id = yid for update;
  if x.id is null or y.id is null or x.id = y.id or x.kind <> 'rail' or y.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  nd := case when x.n1 is not null and x.n1 in (y.n0, y.n1) then x.n1 when x.n0 is not null and x.n0 in (y.n0, y.n1) then x.n0 end;
  if nd is null then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if (select count(*) from mp_segs s where s.n0 = nd or s.n1 = nd) <> 2 then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if not (x.own_u is not distinct from y.own_u and x.own_c is not distinct from y.own_c and x.gov = y.gov) then raise exception 'ほかの会社の線路にはつなげません'; end if;
  if x.dbl <> y.dbl or x.elec <> y.elec then raise exception '単線と複線、電化と非電化がかわるところは、またげません（線路の設定をそろえてください）'; end if;
  if x.rack <> y.rack then raise exception 'アプト式とそうでない線路のつなぎ目は、またげません（線路の高さの設定をそろえてください）'; end if;
  if x.name <> '' and y.name <> '' and x.name <> y.name then raise exception '名前のちがう線路のつなぎ目は、またげません（線路の名前をそろえてください）'; end if;
  xr := x.n1 is distinct from nd;   -- x は nd で終わるように
  yr := y.n0 is distinct from nd;   -- y は nd から始まるように
  px := case when xr then _mp_rev(x.pts) else x.pts end;
  py := case when yr then _mp_rev(y.pts) else y.pts end;
  n := array_length(px, 1);
  d := sqrt(((py[1] - px[n - 1]) / 100.0) ^ 2 + ((py[2] - px[n]) / 100.0) ^ 2);
  pm := px || case when d < 0.03 then py[3:] else py end;
  lx := _mp_len(px); jl := lx + case when d < 0.03 then 0 else d end;
  if _mp_minr(_mp_sub(pm, greatest(0, lx - 1.5), least(_mp_len(pm), lx + 1.5))) < 3 then raise exception 'つなぎ目のカーブがきつすぎて、またげません'; end if;
  -- 高さ（t108）：縦断もつなぐ（縦断のないほうは地面どおり）
  if x.prof is not null or y.prof is not null then
    fx := case when x.prof is null then _mp_prof_ground(px) when xr then _mp_prof_rev(x.prof, x.len) else x.prof end;
    fy := case when y.prof is null then _mp_prof_ground(py) when yr then _mp_prof_rev(y.prof, y.len) else y.prof end;
    fm := _mp_prof_cat(fx, fy, jl);
  end if;
  -- 駅・車庫の位置（はじめからの長さ）を、1本にした線の上に
  update mp_stations set at = case when xr then x.len - at else at end where seg = x.id;
  update mp_depots set at = case when xr then x.len - at else at end where seg = x.id;
  update mp_stations set seg = x.id, at = jl + case when yr then y.len - at else at end where seg = y.id;
  update mp_depots set seg = x.id, at = jl + case when yr then y.len - at else at end where seg = y.id;
  -- 使っているマス・使用料は x へ（同じ区画は1つに）
  delete from mp_occ o where o.what = 'rail' and o.ref = y.id and exists (select 1 from mp_occ o2 where o2.what = 'rail' and o2.ref = x.id and o2.x = o.x and o2.y = o.y);
  update mp_occ set ref = x.id where what = 'rail' and ref = y.id;
  delete from mp_leases l where l.ref_kind = 'seg' and l.ref = y.id and exists (select 1 from mp_leases l2 where l2.ref_kind = 'seg' and l2.ref = x.id and l2.x = l.x and l2.y = l.y);
  update mp_leases set ref = x.id where ref_kind = 'seg' and ref = y.id;
  update mp_segs set pts = pm, ctl = null, bb = _mp_bb(pm), len = _mp_len(pm),
                     n0 = case when xr then x.n1 else x.n0 end, n1 = case when yr then y.n0 else y.n1 end,
                     name = case when x.name <> '' then x.name else y.name end, cost = x.cost + y.cost, color = coalesce(x.color, y.color),
                     prof = fm, st = _mp_st_of(pm, fm), hm = case when fm is null then null when x.prof is null then y.hm when y.prof is null then x.hm when x.hm = y.hm then x.hm else 'man' end,
                     vlim = case when x.rack then least(30, _mp_vlim(_mp_minr(pm))) else _mp_vlim(_mp_minr(pm)) end
   where id = x.id;
  delete from mp_segs where id = y.id;
  delete from mp_nodes where id = nd;
  perform _mp_chg('seg', y.id, 'del', y.bb);
  perform _mp_chg('seg', x.id, 'set', _mp_bb(pm));
  return x.id;
end $$;

-- 線を引く。p_opts に高さ（t108）：{hm: auto 地形に合わせる・el 高架・ug 地下, rack: アプト式, prof: 手で決めた高さ [s, z, …]（その位置はその高さ）}
create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_kind not in ('road', 'rail') then raise exception '作るものがちがいます'; end if;
  if p_kind = 'rail' then cls := 'rail'; if pa.gv then raise exception '線路は人か会社で作ります'; end if; end if;
  if p_kind = 'road' then
    if pa.gv then if cls not in ('exp', 'nat', 'pref', 'city', 'lane') then cls := 'city'; end if;
    else cls := 'priv'; end if;
    dbl := false; elec := false;
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
  if p_kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if p_kind = 'road' and rmin < 0.7 then raise exception 'カーブがきつすぎます'; end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  sw := case when p_kind = 'rail' then case when dbl then 0.5 else 0.36 end else _mp_road_w(cls, ln_) end;
  cells := _mp_seg_cells_arr(p_pts, p_kind, sw, dbl);
  -- 高さ（t108）：縦断を決める。交差する線（線路どうしは 10m 上か下。道路とは、どちらも地面なら踏切・交差点）・建物（屋根＋5m より上か、地面−15m より下）・
  --   駅のホーム・車庫・バス停（±10m）・滑走路（下だけ）は、上か下を通る（つなぐはしの 20m はのぞく）。はしの高さは、つなぐ先と同じ
  if md not in ('auto', 'el', 'ug') then md := 'auto'; end if;
  if p_kind <> 'rail' then rk := false; end if;
  if jsonb_typeof(p_opts -> 'prof') = 'array' then upf := array(select v::real from jsonb_array_elements_text(p_opts -> 'prof') v); end if;
  nhm := case when upf is not null then 'man' else md end;
  z0 := _mp_att_z(p_from, p_pts[1], p_pts[2]); z1 := _mp_att_z(p_to, p_pts[2 * np - 1], p_pts[2 * np]);
  ea := case when p_from is null then 0 else least(0.4, ln / 3) end; eb := case when p_to is null then ln else ln - least(0.4, ln / 3) end;
  pr := _mp_prof_make(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[]);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：マスごとに、つくり（地面・高架・トンネル・橋）と地形の倍率 ×（1 ＋ まちの係数）。アプト式は 1.3倍
  base := case when p_kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(cls, ln_) end;
  if not pa.gv then   -- 国の工事は無料（t57b）：工事費の計算もしない
    cost := _mp_st_cost(tiles, ters, _mp_st_tiles(p_pts, pr ->> 'st'), rk, null, false, base, case when dbl then _mp_rate('dbl_mul') else 1 end, case when elec then _mp_rate('elec') else 0 end);
  end if;
  cost := round(cost);
  vl := case when p_kind = 'rail' then case when rk then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else _mp_road_v(cls, ln_) end;
  select * into lq from _mp_lease_quote(cells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(cells, pa.pu, pa.pc, pa.gv);
  if p_dry then
    return jsonb_build_object('cost', cost, 'lease', round(lq.fee), 'own', lq.own, 'other', lq.other, 'state', lq.state, 'pub', lq.pub,
      'tiles', array_length(tiles, 1) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50),
      'vlim', vl, 'lanes', ln_,
      'vtop', case when p_kind = 'rail' then least(case when rk then 30 else 300 end, (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)) else _mp_road_v(cls, ln_) end,
      'need', need, 'hm', nhm, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns');   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm)
  returning id into sid;
  update mp_nodes set z = pf[2] where id = n0 and z is null;   -- はしの点の高さ（つないだ先は同じ高さ）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = n1 and z is null;
  perform _mp_occ_set(sid, p_kind, tiles);
  perform _mp_lease_set('seg', sid, pa.pu, pa.pc, pa.gv);
  if p_kind = 'rail' then perform _mp_renet(pa.pu, pa.pc); perform _mp_routes_fix(pa.pu, pa.pc); end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee));
end $$;

-- 線を直す。高さ（t108）：縦断も決めなおす（地形に合わせる・高架・地下はそのまま。手で直した縦断は、地形に合わせるにもどる）
create or replace function public.mp_seg_edit(p_id bigint, p_ctl int[], p_pts int[], p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); sg mp_segs; me_cs int[]; tiles int[]; old int[]; newt int[] := '{}'; ters text[]; ln real; rmin real; amt_ numeric := 0; mul real[]; i int; base numeric; lq record; a mp_nodes; b mp_nodes; np int := array_length(p_pts, 1) / 2; bad text;
        ncells int[]; need jsonb; md text; pr jsonb; pf real[]; z0 real; z1 real; vl int;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  if exists (select 1 from mp_stations where seg = p_id) or exists (select 1 from mp_depots where seg = p_id) then raise exception '駅や車庫のある線は、形を変えられません（先に駅・車庫をこわしてください）'; end if;
  perform _mp_geom_ok(p_pts);
  select * into a from mp_nodes where id = sg.n0; select * into b from mp_nodes where id = sg.n1;
  if a.id is not null and sqrt(((a.x - p_pts[1]) / 100.0) ^ 2 + ((a.y - p_pts[2]) / 100.0) ^ 2) > 0.6 then raise exception 'はしの点は動かせません（はじめ）'; end if;
  if b.id is not null and sqrt(((b.x - p_pts[2 * np - 1]) / 100.0) ^ 2 + ((b.y - p_pts[2 * np]) / 100.0) ^ 2) > 0.6 then raise exception 'はしの点は動かせません（おわり）'; end if;
  tiles := _mp_tiles(p_pts); ln := _mp_len(p_pts); rmin := _mp_minr(p_pts);
  if sg.kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if array_length(tiles, 1) / 2 > _mp_rate('max_tiles') then raise exception '長すぎます'; end if;
  old := _mp_tiles(sg.pts);
  -- 新しく通るマス
  for i in 1..array_length(tiles, 1) / 2 loop
    if not exists (select 1 from generate_series(1, array_length(old, 1) / 2) j where old[2 * j - 1] = tiles[2 * i - 1] and old[2 * j] = tiles[2 * i]) then
      newt := newt || tiles[2 * i - 1] || tiles[2 * i];
    end if;
  end loop;
  ters := _mp_ters(newt);
  if sg.kind = 'rail' and not sg.gov then   -- 鉄道の免許（t108）：免許のない市区町村には引けない
    bad := _mp_lic_need(sg.own_u, sg.own_c, newt);
    if bad is not null then raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', bad; end if;
  end if;
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  ncells := _mp_seg_cells_arr(p_pts, sg.kind, sg.w, sg.dbl);
  -- 高さ（t108）：縦断を決めなおす。交差する線・建物・駅のホーム・車庫・バス停・滑走路は、上か下を通る（はしの 20m はのぞく）
  md := case when sg.hm in ('el', 'ug') then sg.hm else 'auto' end;
  z0 := _mp_end_z(sg.n0, p_id); z1 := _mp_end_z(sg.n1, p_id);
  pr := _mp_prof_make(p_pts, sg.kind, sg.cls, z0, z1, md, sg.rack, null::real[], ncells, tiles, least(0.4, ln / 3)::real, (ln - least(0.4, ln / 3))::real, array[p_id], false, null::real[]);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：新しく通るマスはぜんぶ、前から通るマスは つくりが高くなった分だけ
  base := case when sg.kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(sg.cls, sg.lanes) end;
  if not sg.gov then   -- 国の工事は無料（t57b）
    amt_ := _mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(p_pts, pr ->> 'st'), sg.rack, _mp_st_map(sg.pts, sg.st), sg.rack, base,
                        case when sg.dbl then _mp_rate('dbl_mul') else 1 end, case when sg.elec then _mp_rate('elec') else 0 end);
  end if;
  amt_ := round(amt_);
  vl := case when sg.kind = 'rail' then case when sg.rack then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else sg.vlim end;
  select * into lq from _mp_lease_quote(ncells, sg.own_u, sg.own_c, sg.gov);
  -- 新しく通る他人の筆は、貸出料があるか申請が許可されているときだけ（前から通っている区画はそのまま）
  need := _mp_land_need(ncells, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  if p_dry then return jsonb_build_object('cost', amt_, 'lease', round(lq.fee), 'tiles', array_length(tiles, 1) / 2, 'new', coalesce(array_length(newt, 1), 0) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50), 'vlim', vl,
    'vtop', least(case when sg.rack then 30 else 300 end, (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)), 'need', need,
    'hm', md, 'rack', sg.rack, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns'); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, format('%sの引きなおし', case when sg.kind = 'rail' then '線路' else '道路' end));
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  delete from mp_occ where what = sg.kind and ref = p_id;
  perform _mp_occ_set(p_id, sg.kind, tiles);
  update mp_segs set ctl = p_ctl, pts = p_pts, bb = _mp_bb(p_pts), len = ln, vlim = vl, cost = cost + amt_::bigint,
                     prof = pf, st = pr ->> 'st', hm = md where id = p_id;
  update mp_nodes set z = pf[2] where id = sg.n0 and (z is null or z0 is null);   -- はしの点の高さ（この線だけのはしは、決めた高さに）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = sg.n1 and (z is null or z1 is null);
  -- 使用料は新しい形の区画で決めなおす
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', p_id, 'cost', amt_);
end $$;

create or replace function public.mp_sta_build(p_kind text, p_seg bigint, p_x real, p_y real, p_plat int, p_tracks int, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; span real; tiles int[]; cost numeric; sid bigint; pt record; nm text := left(trim(coalesce(p_name, '')), 20); sub int[];
        pcs int[]; oc int[]; need jsonb; lfee numeric := 0; zp real; zl text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '駅・バス停は人か会社で作ります'; end if;
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  select * into sg from mp_segs where id = p_seg;
  if not found then raise exception '線が見つかりません'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y); s := q.s;
  if q.dist > 1.2 then raise exception '線の上をえらんでください'; end if;
  if p_kind = 'rail' and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if nm = '' then raise exception '名前をつけてください'; end if;
  if p_kind = 'rail' then
    if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, false) then raise exception '駅は自分（この名義）の線路の上に作ります'; end if;
    if p_plat < 20 or p_plat > 400 or p_plat % 20 <> 0 then raise exception 'ホームの長さは20m単位で、20〜400mです'; end if;
    if p_tracks < 1 or p_tracks > 8 then raise exception '番線の数は1〜8です'; end if;
    span := p_plat / 50.0;
    if s - span / 2 < 0.3 or s + span / 2 > sg.len - 0.3 then raise exception 'ホームが線路からはみ出します（線路のはしから離すか、ホームを短くしてください）'; end if;
    sub := _mp_sub(sg.pts, s - span / 2, s + span / 2);   -- ホームの線（先に1回だけ）
    if _mp_minr(sub) < 8 then raise exception 'ホームはカーブのゆるいところ（半径400m以上）に作ります'; end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + span) / 2 + 1)
       or exists (select 1 from mp_depots t where t.seg = p_seg and abs(t.at - s) < (span + (_mp_dep_dim(t.kind, t.size))[1]) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
    tiles := _mp_tiles(sub);
    pcs := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_line_cells(sub, greatest(0.5, (0.22 * p_tracks + 0.18) * 2.5)::real) z,
                    lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
    -- 高さ（t108）：ホームの高さ。地下駅（地面−15m より深い）は建物の下、高架駅は低い建物の上（屋根＋5m）にも作れる
    zp := case when sg.prof is not null then _mp_pz(sg.prof, s) end;
    if _mp_bld_hit_z(pcs, zp) is not null then raise exception 'ホームが建物のある土地にかかります'; end if;
    -- ホームが他人の筆にかかるところ（線路の区画はのぞく）は、貸出料があるか申請が許可されているときだけ。使用料もかかる
    oc := _mp_seg_cells_arr(_mp_sub(sg.pts, greatest(0, s - span / 2 - 1), least(sg.len, s + span / 2 + 1)), 'rail', sg.w, sg.dbl);   -- ホームの前後 50m までの線路
    need := _mp_land_need(pcs, pa.pu, pa.pc, false, oc);
    with c as (select distinct pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i),
         o as materialized (select distinct oc[2 * i - 1] x, oc[2 * i] y from generate_series(1, coalesce(array_length(oc, 1), 0) / 2) i)
    select coalesce(sum(coalesce(_mp_land_fee(p.id, pa.pu, pa.pc), _mp_land_std(p.id))), 0) into lfee
      from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y join mp_parcels p on p.id = pcl.parcel
     where not exists (select 1 from o where o.x = c.x and o.y = c.y) and (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false);
    select * into pt from _mp_at(sg.pts, s);
    zl := case when zp is not null then _mp_zl(zp, _mp_gz(pt.x, pt.y)) end;
    cost := _mp_sta_cost(p_tracks, p_plat, pt.x, pt.y, zl);   -- 地下駅 2.5倍・高架駅 1.5倍
  elsif p_kind = 'bus' then
    if sg.kind <> 'road' then raise exception 'バス停は道路の上に作ります'; end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and t.kind = 'bus' and abs(t.at - s) < 3) then raise exception '近くにほかのバス停があります'; end if;
    span := 0.4; p_plat := 0; p_tracks := 1;
    select * into pt from _mp_at(sg.pts, s);
    tiles := array[floor(pt.x)::int, floor(pt.y)::int];
    cost := _mp_rate('stop');
  else raise exception '作るものがちがいます'; end if;
  if p_dry then return jsonb_build_object('cost', round(cost), 'up_day', case when p_kind = 'rail' then round(_mp_rate('up_sta') * (1 + 0.25 * (p_tracks - 1))) else _mp_rate('up_stop') end,
    'lease', round(lfee), 'need', need, 'zl', zl); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, false, round(cost)::bigint, 'sta', format('%s「%s」の工事', case when p_kind = 'rail' then '駅' else 'バス停' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_stations(kind, seg, at, x, y, ang, plat, tracks, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, round(pt.x * 100), round(pt.y * 100), pt.ang, p_plat, p_tracks, nm, pa.pu, pa.pc, round(cost))
  returning id into sid;
  perform _mp_occ_set(sid, case when p_kind = 'rail' then 'sta' else 'stop' end, tiles);
  if p_kind = 'rail' then perform _mp_lease_set('sta', sid, pa.pu, pa.pc, false); end if;
  perform _mp_chg('sta', sid, 'set', box(point(pt.x - 3, pt.y - 3), point(pt.x + 3, pt.y + 3)));
  return jsonb_build_object('id', sid, 'cost', round(cost));
end $$;

create or replace function public.mp_sta_resize(p_id bigint, p_plat int, p_tracks int, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; sg mp_segs; span real; sub int[]; tiles int[]; pcs int[]; oc int[]; olds int[]; need jsonb; lfee numeric := 0;
        pt record; cost numeric; addc bigint; ntrk jsonb; dflt jsonb; rr bigint; st2 mp_stations;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_id;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  if not p_dry then
    perform _mp_lock(st.own_u, st.own_c);
    select * into st from mp_stations where id = p_id for update;
  end if;
  if p_plat is null or p_plat < 20 or p_plat > 400 or p_plat % 20 <> 0 then raise exception 'ホームの長さは20m単位で、20〜400mです'; end if;
  if p_tracks is null or p_tracks < 1 or p_tracks > 8 then raise exception '番線の数は1〜8です'; end if;
  if p_plat = st.plat and p_tracks = st.tracks then raise exception 'ホームの長さも番線の数も、いまと同じです'; end if;
  select * into sg from mp_segs where id = st.seg;
  if not found then raise exception '線路が見つかりません'; end if;
  span := p_plat / 50.0;
  if st.at - span / 2 < 0.3 or st.at + span / 2 > sg.len - 0.3 then raise exception 'ホームが線路からはみ出します（いまの線路では、これより長くできません）'; end if;
  sub := _mp_sub(sg.pts, st.at - span / 2, st.at + span / 2);
  if p_plat > st.plat and _mp_minr(sub) < 8 then raise exception 'ホームはカーブのゆるいところ（半径400m以上）にしか作れません'; end if;
  if exists (select 1 from mp_stations t where t.seg = st.seg and t.id <> p_id and abs(t.at - st.at) < (t.plat / 50.0 + span) / 2 + 1)
     or exists (select 1 from mp_depots t where t.seg = st.seg and abs(t.at - st.at) < (span + (_mp_dep_dim(t.kind, t.size))[1]) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
  tiles := _mp_tiles(sub);
  pcs := (select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from _mp_line_cells(sub, greatest(0.5, (0.22 * p_tracks + 0.18) * 2.5)::real) z,
                  lateral unnest(array[z.x, z.y]) with ordinality u2(v, o));
  -- いまのホームの区画（もう使っている）は、建物・許可・使用料の見つもりからのぞく
  olds := (select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from _mp_sta_cells(p_id) z, lateral unnest(array[z.x, z.y]) with ordinality u2(v, o));
  if _mp_bld_hit_z((select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from (
        select pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i
        except select olds[2 * i - 1], olds[2 * i] from generate_series(1, coalesce(array_length(olds, 1), 0) / 2) i) z, lateral unnest(array[z.x, z.y]) with ordinality u2(v, o)),
        case when sg.prof is not null then _mp_pz(sg.prof, st.at) end) is not null then   -- 高さ（t108）：地下駅・高架駅は建物の下・上にも
    raise exception 'ホームが建物のある土地にかかります';
  end if;
  oc := _mp_seg_cells_arr(_mp_sub(sg.pts, greatest(0, st.at - span / 2 - 1), least(sg.len, st.at + span / 2 + 1)), 'rail', sg.w, sg.dbl);
  need := _mp_land_need(pcs, st.own_u, st.own_c, false, oc || olds);
  with c as (select distinct pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i),
       o as materialized (select distinct oc[2 * i - 1] x, oc[2 * i] y from generate_series(1, coalesce(array_length(oc, 1), 0) / 2) i
                          union select olds[2 * i - 1], olds[2 * i] from generate_series(1, coalesce(array_length(olds, 1), 0) / 2) i)
  select coalesce(sum(coalesce(_mp_land_fee(p.id, st.own_u, st.own_c), _mp_land_std(p.id))), 0) into lfee
    from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y join mp_parcels p on p.id = pcl.parcel
   where not exists (select 1 from o where o.x = c.x and o.y = c.y) and (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, st.own_u, st.own_c, false);
  select * into pt from _mp_at(sg.pts, st.at);
  -- ふえるホーム（番線 × 長さ）の分だけ、いまの場所の値段で
  cost := greatest(0, p_tracks * p_plat - st.tracks * st.plat) * _mp_rate('sta_m') * (1 + _mp_rate('urb_sta') * _mp_dens(pt.x, pt.y))
          * case _mp_sta_lv(st.seg, st.at, st.x, st.y) when 'U' then 2.5 when 'E' then 1.5 else 1 end;   -- 地下駅 2.5倍・高架駅 1.5倍（t108）
  addc := round(cost)::bigint;
  if p_dry then
    return jsonb_build_object('cost', addc, 'up_day', round(_mp_rate('up_sta') * (1 + 0.25 * (p_tracks - 1))), 'up_now', round(_mp_rate('up_sta') * (1 + 0.25 * (st.tracks - 1))),
                              'lease', round(lfee), 'need', need,
                              'routes', (select count(*) from mp_routes r where p_id = any(r.stops)));
  end if;
  perform _mp_land_stop(need);
  if addc > 0 then perform _mp_pay(st.own_u, st.own_c, false, addc, 'sta', format('駅「%s」のホームの工事（%sm・%s番線 → %sm・%s番線）', st.name, st.plat, st.tracks, p_plat, p_tracks)); end if;
  -- 番線の使いかた：決めていたら、のこる番線はそのまま・ふえた番線はいつもの決まり
  ntrk := null;
  if st.trk is not null and jsonb_typeof(st.trk) = 'array' and jsonb_array_length(st.trk) = greatest(st.tracks, 1) and p_tracks > 1 then
    st2 := st; st2.trk := null; st2.tracks := p_tracks; dflt := _mp_sta_trk(st2);
    ntrk := (select jsonb_agg(case when k <= jsonb_array_length(st.trk) then st.trk -> (k - 1) else dflt -> (k - 1) end order by k) from generate_series(1, p_tracks) k);
  end if;
  update mp_stations set plat = p_plat, tracks = p_tracks, cost = st.cost + addc, trk = ntrk where id = p_id;
  delete from mp_occ where what = 'sta' and ref = p_id;
  perform _mp_occ_set(p_id, 'sta', tiles);
  perform _mp_lease_set('sta', p_id, st.own_u, st.own_c, false);
  for rr in select r.id from mp_routes r where p_id = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_id, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'cost', addc, 'plat', p_plat, 'tracks', p_tracks);
end $$;

create or replace function public._mp_leg_from(g jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare it jsonb; sg mp_segs; m real; total real := 0; ell boolean := true; sgl boolean := false; p jsonb := '[]'::jsonb; lastv int := -1; lastm real := 0; v int; e jsonb; runs jsonb := '[]'::jsonb;
        cp int[] := '{}'; sub int[]; s0 real; s1 real; nc int; rail boolean := false;
        rk real[] := '{}'; rpos real := 0; nr jsonb; pos real; a real; b real; x real; p0 real; vv int;   -- アプト式のところ [はじめ, おわり, …]（m。t108）
begin
  for it in select * from jsonb_array_elements(g) loop
    select * into sg from mp_segs where id = (it ->> 0)::bigint;
    if not found then return null; end if;
    s0 := (it ->> 1)::real; s1 := (it ->> 2)::real;
    m := abs(s1 - s0) * 50;
    if m < 0.01 then continue; end if;
    total := total + m;
    if sg.kind = 'rail' then
      rail := true; ell := ell and sg.elec; sgl := sgl or not sg.dbl;
      if sg.rack then rk := rk || array[rpos, rpos + m]; end if;
      rpos := rpos + m;
      sub := case when s0 <= s1 then _mp_sub(sg.pts, s0, s1) else _mp_rev(_mp_sub(sg.pts, s1, s0)) end;
      nc := coalesce(array_length(cp, 1), 0);
      if nc >= 2 and cp[nc - 1] = sub[1] and cp[nc] = sub[2] then sub := sub[3:]; end if;
      cp := cp || sub;
    else
      runs := runs || jsonb_build_array(jsonb_build_array(m, sg.vlim));
    end if;
  end loop;
  if rail then cp := _mp_resample(cp, 0.5); runs := _mp_vruns(cp, 0, _mp_len(cp)); end if;
  -- アプト式のところは 30km/h まで（そのはしで区切る）
  if array_length(rk, 1) > 0 then
    nr := '[]'::jsonb; pos := 0;
    for e in select * from jsonb_array_elements(runs) loop
      a := pos; b := pos + (e ->> 0)::real; p0 := a;
      for x in select distinct c from unnest(rk || b) c where c > a + 0.05 and c <= b order by c loop
        vv := (e ->> 1)::int;
        if exists (select 1 from generate_series(1, array_length(rk, 1) / 2) j where (p0 + x) / 2 between rk[2 * j - 1] and rk[2 * j]) then vv := least(vv, 30); end if;
        nr := nr || jsonb_build_array(jsonb_build_array(round((x - p0)::numeric, 1), vv)); p0 := x;
      end loop;
      pos := b;
    end loop;
    runs := nr;
  end if;
  for e in select * from jsonb_array_elements(runs) loop
    v := (e ->> 1)::int;
    if v = lastv then lastm := lastm + (e ->> 0)::real;
    else
      if lastv >= 0 then p := p || jsonb_build_array(jsonb_build_array(round(lastm::numeric, 1), lastv)); end if;
      lastv := v; lastm := (e ->> 0)::real;
    end if;
  end loop;
  if lastv >= 0 then p := p || jsonb_build_array(jsonb_build_array(round(lastm::numeric, 1), lastv)); end if;
  return jsonb_build_object('d', round(total::numeric, 1), 'p', p, 'e', ell, 's', sgl, 'g', g);
end $$;

create or replace function public.mp_seg_opts(p_id bigint, p_dbl boolean, p_elec boolean, p_name text, p_dry boolean, p_lanes int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ters text[]; amt_ numeric := 0; i int; base numeric; nl int; what text := ''; mul real[]; what2 text; wc int[]; need jsonb;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  ters := _mp_ters(_mp_tiles(sg.pts));
  if not sg.gov then mul := case when sg.st is null then _mp_cmuls(_mp_tiles(sg.pts), ters) else _mp_st_muls(sg.pts, ters, sg.st, sg.rack) end; end if;   -- 国の工事は無料（t57b）。縦断のある線は つくりの倍率（t108）
  if sg.kind = 'rail' then
    base := _mp_rate('rail');
    for i in 1..array_length(ters, 1) loop
      if coalesce(p_dbl, sg.dbl) and not sg.dbl then amt_ := amt_ + base * mul[i] * (_mp_rate('dbl_mul') - 1); end if;
      if coalesce(p_elec, sg.elec) and not sg.elec then amt_ := amt_ + _mp_rate('elec'); end if;
    end loop;
    what := case when coalesce(p_dbl, sg.dbl) and not sg.dbl then '複線化' else '' end || case when coalesce(p_elec, sg.elec) and not sg.elec then '電化' else '' end;
    nl := sg.lanes;
  else
    nl := coalesce(p_lanes, sg.lanes);
    if sg.cls = 'lane' then nl := 0; end if;
    nl := least(case when sg.cls = 'priv' then 2 else 4 end, greatest(case when sg.cls in ('exp', 'nat') then 2 else 0 end, nl));
    if nl > sg.lanes and not sg.gov then
      for i in 1..array_length(ters, 1) loop
        amt_ := amt_ + _mp_rate('road') * (_mp_road_mul(sg.cls, nl) - _mp_road_mul(sg.cls, sg.lanes)) * mul[i];
      end loop;
    end if;
    if nl > sg.lanes then what := format('拡幅（片側%s車線）', nl); end if;
  end if;
  amt_ := round(amt_);
  if (sg.kind = 'rail' and coalesce(p_dbl, sg.dbl) and not sg.dbl) or (sg.kind = 'road' and nl > sg.lanes) then
    wc := _mp_seg_cells_arr(sg.pts, sg.kind, case when sg.kind = 'rail' then 0.5 else _mp_road_w(sg.cls, nl) end, coalesce(p_dbl, sg.dbl));
    what2 := _mp_bld_hit(wc);
    if what2 is not null then raise exception '建物のある土地（%）にかかるので、はばを広げられません', left(what2, 60); end if;
    -- 広げたところが他人の筆にかかるときは、貸出料があるか申請が許可されているときだけ
    need := _mp_land_need(wc, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  end if;
  if p_dry then return jsonb_build_object('cost', amt_, 'lanes', nl, 'need', need); end if;
  perform _mp_land_stop(need);
  if amt_ > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, case when sg.kind = 'rail' then '線路の' else '道路の' end || what); end if;
  update mp_segs set dbl = case when kind = 'rail' then coalesce(p_dbl, dbl) else false end, elec = case when kind = 'rail' then coalesce(p_elec, elec) else false end,
         name = coalesce(left(p_name, 30), name),
         lanes = nl,
         w = case when kind = 'rail' then case when coalesce(p_dbl, dbl) then 0.5 else 0.36 end else _mp_road_w(cls, nl) end,
         vlim = case when kind = 'rail' then vlim else _mp_road_v(cls, nl) end,
         cost = cost + amt_::bigint
   where id = p_id;
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  return jsonb_build_object('id', p_id, 'cost', amt_, 'lanes', nl);
end $$;

create or replace function public.mp_dep_build(p_kind text, p_seg bigint, p_x real, p_y real, p_side int, p_size text, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; lt real; wt real; gap real := 0.9; dim real[]; cap int; cost numeric; tiles int[]; ters text[]; bad text; lq record; did bigint; pt record; dcells int[];
        nm text := left(trim(coalesce(p_name, '')), 20); side int := case when p_side < 0 then -1 else 1 end; need jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '車庫は人か会社で作ります'; end if;
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  select * into sg from mp_segs where id = p_seg;
  if not found then raise exception '線が見つかりません'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y); s := q.s;
  if q.dist > 1.2 then raise exception '線の上をえらんでください'; end if;
  if p_kind = 'rail' and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if nm = '' then raise exception '名前をつけてください'; end if;
  if p_kind = 'rail' then
    if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, false) then raise exception '車両基地は自分（この名義）の線路の横に作ります'; end if;
    if coalesce(p_size, '') like 'T%' then   -- 線路をなぞった大きさ（長さ20m単位・留置線の数）
      if p_size !~ '^T[0-9]{2,4}x[0-9]{1,2}$' then raise exception '車両基地の大きさが読めません'; end if;
      if split_part(substr(p_size, 2), 'x', 1)::int not between 40 and 1000 or split_part(substr(p_size, 2), 'x', 1)::int % 20 <> 0 then raise exception '車両基地の長さは20m単位で、40〜1000mです'; end if;
      if split_part(p_size, 'x', 2)::int not between 1 and 20 then raise exception '留置線は1〜20本です'; end if;
      dim := _mp_dep_dim('rail', p_size); lt := dim[1]; wt := dim[2]; gap := dim[3]; cap := dim[4]::int;
      cost := _mp_rate('dep_base') + cap * _mp_rate('dep_car');
    else
      lt := case p_size when 'L' then 10 when 'M' then 7 else 5 end; wt := case p_size when 'L' then 4 when 'M' then 3 else 2 end;
      cap := case p_size when 'L' then 120 when 'M' then 48 else 16 end;
      cost := _mp_rate('dep_' || case when p_size in ('S', 'M', 'L') then p_size else 'S' end);
    end if;
  elsif p_kind = 'bus' then
    if sg.kind <> 'road' then raise exception 'バスの営業所は道路の横に作ります'; end if;
    lt := case p_size when 'M' then 5 else 3 end; wt := case p_size when 'M' then 3 else 2 end;
    cap := case p_size when 'M' then 60 else 20 end;
    cost := _mp_rate('bdep_' || case when p_size = 'M' then 'M' else 'S' end);
  else raise exception '作るものがちがいます'; end if;
  if s - lt / 2 < 0.2 or s + lt / 2 > sg.len - 0.2 then raise exception '線のはしからはみ出します'; end if;
  if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + lt) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
  tiles := _mp_dep_tiles_g(sg.pts, s, side, lt, wt, gap);
  ters := _mp_ters(tiles);
  if '?' = any(ters) or 'D' = any(ters) or 'S' = any(ters) or 'R' = any(ters) or 'L' = any(ters) then raise exception '水の上や地図のないところには作れません'; end if;
  select string_agg(distinct o.x || ',' || o.y, ' ') into bad from mp_occ o
    join (select tiles[2 * i - 1] x, tiles[2 * i] y from generate_series(1, array_length(tiles, 1) / 2) i) t on t.x = o.x and t.y = o.y
   where not (o.what = sg.kind and o.ref = p_seg);
  if bad is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', left(bad, 60); end if;
  select * into pt from _mp_at(sg.pts, s);
  if sg.prof is not null and abs(_mp_pz(sg.prof, s) - _mp_gz(pt.x, pt.y)) > 5 then raise exception '車庫は、線が地面の高さのところに作ります（高架・地下・橋のところには作れません）'; end if;   -- 高さ（t108）
  dcells := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_dep_cells(pt.x, pt.y, pt.ang, side, p_kind, coalesce(p_size, 'S')) z, lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
  if _mp_bld_hit(dcells) is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', _mp_bld_hit(dcells); end if;
  select * into lq from _mp_lease_quote(dcells, pa.pu, pa.pc, false);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(dcells, pa.pu, pa.pc, false);
  if p_dry then return jsonb_build_object('cost', round(cost), 'lease', round(lq.fee), 'cap', cap, 'tiles', array_length(tiles, 1) / 2,
    'up_day', round(_mp_rate(case when p_kind = 'rail' then 'up_dep' else 'up_bdep' end) * case when coalesce(p_size, '') like 'T%' then greatest(1, cap / 24.0) when p_size = 'L' then 5 when p_size = 'M' then 2.5 else 1 end), 'need', need); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, false, round(cost)::bigint, 'dep', format('%s「%s」の工事', case when p_kind = 'rail' then '車両基地' else '営業所' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_depots(kind, seg, at, side, size, x, y, ang, cap, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, side, coalesce(p_size, 'S'), round(pt.x * 100), round(pt.y * 100), pt.ang, cap, nm, pa.pu, pa.pc, round(cost))
  returning id into did;
  perform _mp_occ_set(did, 'dep', tiles);
  perform _mp_lease_set('dep', did, pa.pu, pa.pc, false);
  perform _mp_chg('dep', did, 'set', box(point(pt.x - greatest(8, lt / 2 + gap + wt + 1), pt.y - greatest(8, lt / 2 + gap + wt + 1)),
                                         point(pt.x + greatest(8, lt / 2 + gap + wt + 1), pt.y + greatest(8, lt / 2 + gap + wt + 1))));
  return jsonb_build_object('id', did, 'cost', round(cost), 'cap', cap);
end $$;

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
                  || case when s.snowp > 0 then jsonb_build_object('sp', s.snowp) else '{}'::jsonb end
                  || case when s.prof is not null and p_lod <= 1 then jsonb_build_object('pf', to_jsonb(s.prof), 'st', s.st) else '{}'::jsonb end   -- 高さ（t108）
                  || case when s.rack then jsonb_build_object('rk', 1) else '{}'::jsonb end || case when s.hm is not null then jsonb_build_object('hm', s.hm) else '{}'::jsonb end), '[]'::jsonb)
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
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1) into r;
  return r;
end $$;

-- ---------- いまの中心部：線路どうしが同じ高さで交わっているところを直す ----------
-- 新しいほうの線路の、交わるところの前後だけ高さを変える（15マス → 30マス → 60マス。地形に合わせて、交わるところは 10m 上か下。ほかの線路との交差だけ見る。無料）。
--   新しいほうで直せなければ古いほう。分かれ道のない点でつながる線路も いっしょに。車庫のところは地面のまま
do $$
declare r record; a mp_segs; b mp_segs; k bigint; w real; done bigint[]; tried bigint[] := '{}'; nfix int := 0; nok int := 0; nng int := 0;
begin
  for r in
    with e as materialized (
           select q.id, j, q.pts[2 * j - 1] / 100.0 ax, q.pts[2 * j] / 100.0 ay, q.pts[2 * j + 1] / 100.0 bx, q.pts[2 * j + 2] / 100.0 by_, q.len
             from mp_segs q, generate_series(1, array_length(q.pts, 1) / 2 - 1) j where q.kind = 'rail'),
         ec as materialized (select e.*, sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2) d,
                                    coalesce(sum(sqrt((bx - ax) ^ 2 + (by_ - ay) ^ 2)) over (partition by id order by j rows between unbounded preceding and 1 preceding), 0) s0 from e),
         eg as materialized (select ec.*, gx, gy from ec, generate_series(floor(least(ax, bx) / 2)::int, floor(greatest(ax, bx) / 2)::int) gx,
                                                      generate_series(floor(least(ay, by_) / 2)::int, floor(greatest(ay, by_) / 2)::int) gy),
         pp as (select distinct e1.id aid, e2.id bid, e1.s0 as0, e1.d ad, e1.len alen, e2.s0 bs0, e2.d bd, e2.len blen,
                       e1.ax, e1.ay, e1.bx, e1.by_, e2.ax cx, e2.ay cy, e2.bx dx, e2.by_ dy, (e1.ax - e1.bx) * (e2.ay - e2.by_) - (e1.ay - e1.by_) * (e2.ax - e2.bx) den
                  from eg e1 join eg e2 on e1.gx = e2.gx and e1.gy = e2.gy and e1.id < e2.id),
         it as (select pp.*, ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / den t, ((ax - cx) * (ay - by_) - (ay - cy) * (ax - bx)) / den u from pp where abs(den) > 1e-12)
    select aid, bid, (as0 + t * ad)::real sa, (bs0 + u * bd)::real sb from it
     where t > 1e-4 and t < 1 - 1e-4 and u > 1e-4 and u < 1 - 1e-4
       and not ((as0 + t * ad < 0.3 or as0 + t * ad > alen - 0.3) and (bs0 + u * bd < 0.3 or bs0 + u * bd > blen - 0.3))   -- はしでつながるところ
     order by bid desc, aid desc, sb
  loop
    select * into a from mp_segs where id = r.aid; select * into b from mp_segs where id = r.bid;
    if abs(_mp_seg_z(a, r.sa) - _mp_seg_z(b, r.sb)) >= 9.9 then continue; end if;
    foreach k in array array[r.bid, r.aid] loop
      exit when abs(_mp_seg_z(a, r.sa) - _mp_seg_z(b, r.sb)) >= 9.9;
      continue when k = any(tried);
      done := null;
      foreach w in array array[15, 30, 60]::real[] loop
        done := _mp_fix_xing(k, w);
        exit when done is not null;
      end loop;
      tried := tried || k || coalesce(done, '{}');
      if done is null then raise notice '線路 % のまわりは直せません（勾配がきつすぎます）', k; else nfix := nfix + coalesce(array_length(done, 1), 0); end if;
      select * into a from mp_segs where id = r.aid; select * into b from mp_segs where id = r.bid;
    end loop;
    if abs(_mp_seg_z(a, r.sa) - _mp_seg_z(b, r.sb)) >= 9.9 then nok := nok + 1;
    else nng := nng + 1; raise notice '線路 % と % の交差（%マス目）は、同じ高さのまま（平面交差）', r.aid, r.bid, round(r.sa::numeric, 1); end if;
  end loop;
  raise notice '線路どうしが同じ高さで交わるところ：% か所を直しました（線路 % 本に高さ）。同じ高さのまま % か所', nok, nfix, nng;
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない。線の高さ（mp_seg_height）・前からの関数は、ログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_att_z', '_mp_bld_hit_z', '_mp_chain', '_mp_dep_fx', '_mp_end_z', '_mp_fix_xing', '_mp_gsamp', '_mp_gz', '_mp_hd', '_mp_leg_from', '_mp_node_z', '_mp_prof_cat', '_mp_prof_ground', '_mp_prof_make', '_mp_prof_obst', '_mp_prof_pack', '_mp_prof_rev', '_mp_prof_solve', '_mp_prof_sub', '_mp_pz', '_mp_seg_join2', '_mp_seg_z', '_mp_smul', '_mp_split', '_mp_st_code', '_mp_st_cost', '_mp_st_map', '_mp_st_muls', '_mp_st_of', '_mp_st_tiles', '_mp_sta_cost', '_mp_sta_lv', '_mp_tiles_s', '_mp_xing', '_mp_zl', 'mp_area', 'mp_dep_build', 'mp_seg_build', 'mp_seg_edit', 'mp_seg_height', 'mp_seg_opts', 'mp_sta_build', 'mp_sta_resize') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 時刻を組みなおすこともあるので、20秒まで待つ（create or replace で消えた設定をつけなおす）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '20s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean) set statement_timeout = '20s';
alter function public.mp_seg_height(bigint, text, real[], boolean, boolean) set statement_timeout = '20s';
alter function public.mp_sta_resize(bigint, int, int, boolean) set statement_timeout = '20s';
alter function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int) set statement_timeout = '20s';
