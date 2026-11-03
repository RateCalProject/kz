-- 高さ「トンネル優先」（tn）：線路・道路の縦断を、まわり（±1km）より細い出っぱり（丘・尾根）に合わせて上下させず、トンネルでぬける。
--   線は地面（出っぱりをけずったもの）より上に出ない（高架にしない。勾配や、つなぐ先・川の橋でできないところだけ）。坂・広い谷は地形どおり。
--   上下を通るもの（線路・道路・建物など）は下から（踏切にできる道路は踏切）。川・海は橋のまま
-- 線路・道路の見つもりと作成を軽く：
--   公道の区画（使用料なし）をしらべるとき、国の線はこちらの近くを通る部分だけ区画にする（長い国道をまるごと区画にしていた）
--   _mp_rate（料金・率）：毎回大きな jsonb をつくらず、ふだんの値は CASE（_mp_rate_def）。呼ぶ式の中にとけこむ（地価・使用料の計算が速くなる）
--   線の区画（_mp_line_cells）：点の列を1回だけひらく（表の大きな pts を点ごとに読みなおしていた。使用料・公道・区画の計算が速くなる）
--   線路をつくったあと：行きどまりの線（はしの1つしかつながらない）では、系統の道すじが変わらないので見なおさない

-- ふだんの値（運営が app_settings 'mp_rates' で変えていないとき）。DB の更新81：毎回 jsonb をつくらない（CASE。immutable なので式の中で前もって計算される）
create or replace function public._mp_rate_def(k text) returns numeric
language sql immutable as $$
  select (case k
    when 'land_P' then 200000
    when 'land_F' then 120000
    when 'land_B' then 150000
    when 'land_H' then 90000
    when 'land_M' then 25000
    when 'land_K' then 7000
    when 'dens_k' then 0.2
    when 'road_mul' then 1.25
    when 'sta_mul' then 0.9
    when 'sta_r' then 15
    when 'lease' then 0.001
    when 'lease_gov' then 0.0005
    when 'prop_tax' then 0.0001
    when 'rail' then 300000
    when 'road' then 150000
    when 'dbl_mul' then 1.7
    when 'elec' then 100000
    when 'sta_base' then 20000000
    when 'sta_m' then 100000
    when 'stop' then 500000
    when 'dep_S' then 100000000
    when 'dep_M' then 300000000
    when 'dep_L' then 700000000
    when 'dep_base' then 20000000
    when 'dep_car' then 5500000
    when 'bdep_S' then 20000000
    when 'bdep_M' then 50000000
    when 'up_rail' then 1500
    when 'up_road' then 300
    when 'up_sta' then 50000
    when 'up_stop' then 500
    when 'up_dep' then 60000
    when 'up_bdep' then 20000
    when 'g_rail' then 0.55
    when 'g_bus' then 0.12
    when 'fare_base' then 150
    when 'fare_km' then 20
    when 'bus_fare' then 220
    when 'bus_km' then 15
    when 'catch_rail' then 20
    when 'catch_bus' then 6
    when 'max_tiles' then 600
    when 'grow' then 0.0002
    when 'grow_sta' then 0.0006
    when 'urb_k' then 0.03
    when 'urb_sta' then 0.02
    when 'p_wheat' then 40000
    when 'p_flour' then 70000
    when 'p_food' then 200000
    when 'p_ore' then 25000
    when 'p_steel' then 90000
    when 'p_car' then 1500000
    when 'p_crude' then 60000
    when 'p_chem' then 120000
    when 'p_elec' then 1000000
    when 'truck_base' then 500
    when 'truck_km' then 60
    when 'sc_imp' then 1.2
    when 'sc_mkt' then 0.85
    when 'sc_shop' then 0.3
    when 'sc_food' then 0.0002
    when 'sc_food_km' then 30
    when 'sc_keep' then 0.25
    when 'rc_parts' then 0.45
    when 'rc_m2' then 5000
    when 'rd_m2' then 3000
    when 'trk_tkm' then 300
    when 'g_ship' then 0.15
    when 'catch_ship' then 40
    when 'ship_fare' then 300
    when 'ship_km' then 25
    when 'ferry_t' then 400
    when 'ferry_tkm' then 30
    when 'up_port' then 50000
    when 'ship_dock' then 600
    when 'sy_tpd' then 0.02
    when 'sy_steel' then 0.3
    when 'g_air' then 0.01
    when 'catch_air' then 200
    when 'air_fare' then 8000
    when 'air_km' then 60
    when 'up_air' then 200000
    when 'air_ovh' then 1500
    when 'rwy_m2' then 20000
    when 'slot_days' then 30
    when 'slot_hours' then 24
    when 'slot_inc' then 0.05
  end)::numeric
$$;
create or replace function public._mp_rate(k text) returns numeric
language sql stable as $$
  select coalesce((select (s.value::jsonb ->> k)::numeric from public.app_settings s where s.key = 'mp_rates'), public._mp_rate_def(k))
$$;

-- 縦断を決める（DB の更新81）：_mp_prof_solve と同じで、下から包む線（U）と上から包む線（L）のあいだの どこにするか（al：0 は下・0.5 はまん中）
--   トンネル優先（tn）は 0：目標（地面）より上には出ない（できないところだけ）。ほかは 0.5（まん中。_mp_prof_solve と同じ）
create or replace function public._mp_prof_solve_al(tg real[], lo real[], hi real[], d real[], al real) returns real[]
language plpgsql immutable as $$
declare n int := array_length(tg, 1); k int; a real[] := lo; b real[] := hi; L real[] := tg; U real[] := tg; z real[] := tg;
begin
  for k in 2..n loop a[k] := greatest(a[k], a[k - 1] - d[k - 1]); b[k] := least(b[k], b[k - 1] + d[k - 1]); L[k] := greatest(L[k], L[k - 1] - d[k - 1]); U[k] := least(U[k], U[k - 1] + d[k - 1]); end loop;
  for k in reverse n - 1..1 loop a[k] := greatest(a[k], a[k + 1] - d[k]); b[k] := least(b[k], b[k + 1] + d[k]); L[k] := greatest(L[k], L[k + 1] - d[k]); U[k] := least(U[k], U[k + 1] + d[k]); end loop;
  for k in 1..n loop
    if a[k] > b[k] + 0.01 then return null; end if;
    z[k] := least(b[k], greatest(a[k], case when al = 0.5 then (L[k] + U[k]) / 2 else U[k] + al * (L[k] - U[k]) end));
  end loop;
  return z;
end $$;

create or replace function public._mp_line_cells(p int[], r real) returns table (x int, y int)
language sql immutable as $$
  select distinct q.x, q.y from (
      select z.ax / 20.0 ax, z.ay / 20.0 ay, z.bx / 20.0 bx, z.by_ / 20.0 bby
        from (select v.px ax, v.py ay, lead(v.px) over (order by v.k) bx, lead(v.py) over (order by v.k) by_
                from (select (u.o + 1) / 2 k, max(u.v) filter (where u.o % 2 = 1) px, max(u.v) filter (where u.o % 2 = 0) py
                        from unnest(p) with ordinality u(v, o) group by (u.o + 1) / 2) v) z
       where z.bx is not null) s,
    lateral generate_series(floor(least(s.ax, s.bx) - r)::int, floor(greatest(s.ax, s.bx) + r)::int) gx(v),
    lateral generate_series(floor(least(s.ay, s.bby) - r)::int, floor(greatest(s.ay, s.bby) + r)::int) gy(v),
    lateral (select gx.v x, gy.v y, least(1.0, greatest(0.0, ((gx.v + 0.5 - s.ax) * (s.bx - s.ax) + (gy.v + 0.5 - s.ay) * (s.bby - s.ay))
                                        / greatest((s.bx - s.ax) ^ 2 + (s.bby - s.ay) ^ 2, 1e-9))) t) q
   where (q.x + 0.5 - (s.ax + (s.bx - s.ax) * q.t)) ^ 2 + (q.y + 0.5 - (s.ay + (s.bby - s.ay) * q.t)) ^ 2 <= r * r
$$;

create or replace function public._mp_pub_of(cells int[]) returns table (x int, y int)
language sql stable set search_path = public as $$
  with c as materialized (select distinct cells[2 * i - 1] x, cells[2 * i] y from generate_series(1, coalesce(array_length(cells, 1), 0) / 2) i),
       t as materialized (select distinct _mp_t5(c.x) + d.dx tx, _mp_t5(c.y) + d.dy ty from c cross join (select a dx, b dy from generate_series(-1, 1) a, generate_series(-1, 1) b) d),
       sg as materialized (select distinct o.what, o.ref from mp_occ o join t on o.x = t.tx and o.y = t.ty where o.what in ('road', 'rail', 'rwy')),
       -- 国の線の点（DB の更新81：点の列は1回だけひらく。長い国道の pts を点ごとに読みなおさない）
       v as materialized (select s.id, u.o, u.v from sg join mp_segs s on sg.what in ('road', 'rail') and s.id = sg.ref and s.gov cross join lateral unnest(s.pts) with ordinality u(v, o)),
       pt as materialized (select v.id, (v.o + 1) / 2 k, max(v.v) filter (where v.o % 2 = 1) px, max(v.v) filter (where v.o % 2 = 0) py from v group by v.id, (v.o + 1) / 2),
       -- 点と点のあいだ（とそのマスの範囲）
       pc as materialized (select z.*, floor(least(z.ax, z.bx) / 100.0)::int x0, floor(greatest(z.ax, z.bx) / 100.0)::int x1, floor(least(z.ay, z.by_) / 100.0)::int y0, floor(greatest(z.ay, z.by_) / 100.0)::int y1
                             from (select pt.id, pt.k, pt.px ax, pt.py ay, lead(pt.px) over w bx, lead(pt.py) over w by_ from pt window w as (partition by pt.id order by pt.k)) z where z.bx is not null),
       -- こちらの区画のまわり（1マス）にかかる部分だけ区画にする（長い国道をまるごと区画にしない。とても長い部分は、そのまま）
       near as materialized (select distinct pc.id, pc.k, pc.ax, pc.ay, pc.bx, pc.by_ from pc cross join lateral generate_series(pc.x0, pc.x1) gx cross join lateral generate_series(pc.y0, pc.y1) gy
                               join t on t.tx = gx and t.ty = gy where (pc.x1 - pc.x0 + 1) * (pc.y1 - pc.y0 + 1) <= 64
                             union select pc.id, pc.k, pc.ax, pc.ay, pc.bx, pc.by_ from pc where (pc.x1 - pc.x0 + 1) * (pc.y1 - pc.y0 + 1) > 64),
       lc as materialized (select q.x, q.y from near join mp_segs s on s.id = near.id cross join lateral _mp_line_cells(array[near.ax, near.ay, near.bx, near.by_], _mp_seg_r(s.kind, s.w, s.dbl)) q
                           union all   -- 滑走路（t57）
                           select q.x, q.y from sg join mp_rwys r on sg.what = 'rwy' and r.id = sg.ref cross join lateral _mp_rwy_cells(r.x0, r.y0, r.x1, r.y1, r.w) q)
  select distinct lc.x, lc.y from lc join c on c.x = lc.x and c.y = lc.y
$$;

create or replace function public._mp_prof_make(p int[], kind text, cls text, z0 real, z1 real, mode text, rack boolean, upf real[], cells int[], tiles int[], ea real, eb real, oseg bigint[], xonly boolean, fx real[]) returns jsonb
language plpgsql stable set search_path = public as $$
declare sm record; ss real[] := '{}'; gg real[] := '{}'; tt text[] := '{}'; S real; ns int; n int; k int; j int; i int; it int;
        cs real[] := '{}'; an real[]; tg real[] := '{}'; lo real[]; hi real[]; d real[] := '{}'; z real[]; pf real[]; o record;
        o_s0 real[] := '{}'; o_s1 real[] := '{}'; o_zb real[] := '{}'; o_zt real[] := '{}'; o_g real[] := '{}'; o_lv boolean[] := '{}'; o_nm text[] := '{}'; o_k text[] := '{}';
        o_ka int[] := '{}'; o_kb int[] := '{}'; ord int[]; no int := 0; fi int;
        za real; zb_ real; zm real; ka int; kb int; side text; sides text[]; z2 real[]; lo2 real[]; hi2 real[]; mg real := 0; st text := ''; zz real; lx int := 0; xs jsonb := '[]'::jsonb;
        tun int := 0; via int := 0; brg int := 0; acc real; cnt int; G real; off real; wr real[] := '{}'; w0 real; nu int;
        gb real[]; ge real[]; tw int := 20; wv real; jj int;
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
    -- トンネル優先（DB の更新81）：目標にする地面は、まわり ±tw マスより細い出っぱり（丘・尾根）をけずったもの
    --   （オープニング：いちばん低いところ → いちばん高いところ。はしの外は、はしの地面がつづくとみる。坂・谷・ふつうの上り下りはそのまま）
    gb := gg;
    if mode = 'tn' then
      ge := array_fill(0::real, array[ns + 2 * tw]);
      for jj in 1 - tw..ns + tw loop
        wv := 1e9;
        for i in jj - tw..jj + tw loop wv := least(wv, gg[least(ns, greatest(1, i))]); end loop;
        ge[jj + tw] := wv;
      end loop;
      for j in 1..ns loop
        wv := -1e9;
        for i in j - tw..j + tw loop wv := greatest(wv, ge[i + tw]); end loop;
        gb[j] := least(gg[j], wv);
      end loop;
    end if;
    for k in 1..n loop
      acc := 0; cnt := 0;
      for j in greatest(1, ceil(cs[k] - 1.5)::int + 1)..least(ns, floor(cs[k] + 1.5)::int + 2) loop if abs(ss[j] - cs[k]) <= 1.5 then acc := acc + gb[j]; cnt := cnt + 1; end if; end loop;
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
    z := _mp_prof_solve_al(tg, lo, hi, d, case when mode = 'tn' then 0 else 0.5 end::real);   -- トンネル優先は、目標より下で いちばん近い線（DB の更新81）
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
      -- ためす順：滑走路は下だけ。地下・高架をえらんだら その側から。踏切にできて地面に近ければ踏切。トンネル優先は下から（DB の更新81）。高い建物（25m より上）は下から。ほかは近い側から
      sides := case when o_zt[fi] > 1e8 then array['under']
                    when mode = 'ug' then array['under', 'over'] when mode = 'el' then array['over', 'under']
                    when o_lv[fi] and abs(zm - o_g[fi]) <= 7.5 then case when zm >= o_g[fi] and mode <> 'tn' then array['level', 'over', 'under'] else array['level', 'under', 'over'] end
                    when mode = 'tn' then array['under', 'over']
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
        z2 := _mp_prof_solve_al(tg, lo2, hi2, d, case when mode = 'tn' then 0 else 0.5 end::real);
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
  if md not in ('auto', 'el', 'ug', 'tn') then md := 'auto'; end if;   -- tn：トンネル優先（DB の更新81）
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
  -- 系統の道すじは、行きどまりの線（はしの1つしか ほかの線とつながらない・線のとちゅうにつないでいない）では変わらないので、見なおさない（DB の更新81）
  if p_kind = 'rail' then
    perform _mp_renet(pa.pu, pa.pc);
    if coalesce(p_from ? 'seg', false) or coalesce(p_to ? 'seg', false)
       or (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) >= 2 then
      perform _mp_routes_fix(pa.pu, pa.pc);
    end if;
  end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee));
end $$;

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
  md := case when sg.hm in ('el', 'ug', 'tn') then sg.hm else 'auto' end;
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
  md := case when p_mode in ('auto', 'el', 'ug', 'tn') then p_mode else 'auto' end;   -- tn：トンネル優先（DB の更新81）
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

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。線をひく・直す・高さはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_rate_def', '_mp_rate', '_mp_line_cells', '_mp_pub_of', '_mp_prof_solve_al', '_mp_prof_make', 'mp_seg_build', 'mp_seg_edit', 'mp_seg_height') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 時刻を組みなおす関数の待ち時間（作りなおすと消えるので、もう一度）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '20s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean) set statement_timeout = '20s';
alter function public.mp_seg_height(bigint, text, real[], boolean, boolean) set statement_timeout = '20s';
