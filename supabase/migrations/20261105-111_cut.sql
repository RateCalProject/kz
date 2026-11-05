-- DB の更新111：切り通し（切土）
--   線路・道路の高さ（縦断）の つくりに「切り通し」C：陸で 地面より 8m〜15m 低いところ（前は 8m より低いと ぜんぶ トンネル）。
--   15m より深いところ・水の下は いままでどおり トンネル。8m より浅いところは 地面（盛り土・浅い切り通し）のまま。
--   切り通しの工事費は 地面より 1 高い倍率（平地 2・林 2.2・丘 2.5・山 3・高い山 3.5。トンネルは 4.5）。
--   縦断の しらべ（_mp_prof_make2）に 切り通しの長さ（cut）。列車の音（_mp_noise_day）は 切り通しでは 6割。
--   トンネルと切り通しが こまかく入れかわらないように ならす（_mp_st_tidy：短いトンネルは 切り通しに・1マスの切り通しは トンネルに）。
--   いまある線の つくりも 決めなおす（トンネルのある線：8m〜15m のところが 切り通しに）

-- つくり（1マスごとの1文字）の 短い切れはしを ならす（DB の更新111）：
--   切り通しに かこまれた 2マスまでの トンネル（片がわが地面でも）は 切り通しに・トンネルに はさまれた 1マスの 切り通しは トンネルに（線の はしの区間は そのまま）
create or replace function public._mp_st_tidy(s text) returns text
language plpgsql immutable as $$
declare zc text[] := '{}'; zn int[] := '{}'; zi int := 1; zj int; zk int; zx text; zo text := '';
begin
  if s is null or position('C' in s) = 0 then return s; end if;
  while zi <= length(s) loop
    zx := substr(s, zi, 1); zj := zi;
    while zj < length(s) and substr(s, zj + 1, 1) = zx loop zj := zj + 1; end loop;
    zc := zc || zx; zn := zn || (zj - zi + 1); zi := zj + 1;
  end loop;
  for zk in 2..coalesce(array_length(zc, 1), 0) - 1 loop
    if zc[zk] = 'T' and zn[zk] <= 2 and zc[zk - 1] in ('C', 'G') and zc[zk + 1] in ('C', 'G') and 'C' in (zc[zk - 1], zc[zk + 1]) then zc[zk] := 'C';
    elsif zc[zk] = 'C' and zn[zk] = 1 and zc[zk - 1] = 'T' and zc[zk + 1] = 'T' then zc[zk] := 'T';
    end if;
  end loop;
  for zk in 1..coalesce(array_length(zc, 1), 0) loop zo := zo || repeat(zc[zk], zn[zk]); end loop;
  return zo;
end $$;
revoke all on function public._mp_st_tidy(text) from public, anon, authenticated;

create or replace function public._mp_st_code(z real, g real, t text) returns text
language sql immutable as $$
  select case when t in ('S', 'R', 'L', 'D') then case when z <= g - 8 then 'T' else 'B' end when z - g >= 6 then 'V' when z - g <= -15 then 'T' when z - g <= -8 then 'C' else 'G' end
$$;

create or replace function public._mp_smul(code text, t text) returns real
language sql immutable as $$
  select (case code when 'V' then 3
                    when 'T' then case t when 'R' then 5 when 'L' then 7 when 'S' then 9 when 'D' then 11 else 4.5 end
                    when 'B' then case t when 'R' then 4 when 'L' then 6 when 'S' then 8 when 'D' then 10 else 3 end
                    when 'C' then case t when 'F' then 2.2 when 'B' then 2.2 when 'H' then 2.5 when 'M' then 3 when 'K' then 3.5 else 2 end   -- 切り通し（DB の更新111）
                    else case t when 'F' then 1.2 when 'B' then 1.2 when 'H' then 1.5 when 'M' then 2 when 'K' then 2.5 when 'R' then 4 when 'L' then 6 when 'S' then 8 when 'D' then 10 else 1 end end)::real
$$;

create or replace function public._mp_noise_day() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  delete from mp_noise where true;
  insert into mp_noise(x, y, lv)
  with fv as (select c.form, min(t.vmax) vm from mp_cars c join mp_types t on t.code = c.type where c.form is not null group by c.form),
       rt as (select t.route, count(*) n, max(fv.vm) vm from mp_trains t join fv on fv.form = t.form where t.day is null group by t.route),
       rs as (select distinct ro.id rid, (g ->> 0)::bigint sid   -- 系統が通る線（同じ線は 系統ごとに1回）
                from mp_routes ro cross join lateral jsonb_array_elements(ro.legs) l cross join lateral jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
               where ro.kind = 'rail' and ro.ok),
       sr as materialized (select rs.sid, sum(rt.n) n, max(rt.vm) vm from rs join rt on rt.route = rs.rid group by rs.sid),
       sl as (select sg.pts, sg.st,
                     (sr.n / 600.0) * (least(sg.vlim, _mp_seg_v(sg.gauge, sg.g2, sg.slp, sg.rack), case when sg.elec then _mp_cat_v(sg.cat) else 999 end, coalesce(sr.vm, 100)) / 100.0) ^ 2
                     * case sg.slp when 3 then 1.25 when 1 then 1.05 else 1 end * case sg.nw when 1 then 0.5 when 2 then 0.25 else 1 end lv
                from sr join mp_segs sg on sg.id = sr.sid where sg.kind = 'rail'),
       tl as materialized (select sl.lv, _mp_tiles(sl.pts) tl, _mp_st_tiles(sl.pts, sl.st) cd from sl where sl.lv >= 0.02),   -- 1本に1回だけ（まとめないと マスごとに計算しなおす）
       pt as materialized (select t.tl[2 * c.i - 1] x, t.tl[2 * c.i] y, least(3, t.lv * case c.code when 'V' then 1.15 when 'B' then 1.6 when 'C' then 0.6 else 1 end) lv
                from tl t cross join lateral unnest(t.cd) with ordinality c(code, i) where c.code <> 'T' and 2 * c.i <= coalesce(array_length(t.tl, 1), 0))
  select p.x + dx, p.y + dy, least(3, sum(p.lv * case when dx = 0 and dy = 0 then 0.5 when dx = 0 or dy = 0 then 0.25 else 0.15 end))::real
    from pt p cross join generate_series(-1, 1) dx cross join generate_series(-1, 1) dy
   group by 1, 2 having sum(p.lv * case when dx = 0 and dy = 0 then 0.5 when dx = 0 or dy = 0 then 0.25 else 0.15 end) >= 0.05;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public._mp_prof_make2(p int[], kind text, cls text, z0 real, z1 real, mode text, rack boolean, upf real[], cells int[], tiles int[], ea real, eb real, oseg bigint[], xonly boolean, fx real[], opt jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare sm record; ss real[] := '{}'; gg real[] := '{}'; tt text[] := '{}'; S real; ns int; n int; k int; j int; i int; it int;
        cs real[] := '{}'; an real[]; tg real[] := '{}'; lo real[]; hi real[]; d real[] := '{}'; z real[]; pf real[]; o record;
        o_s0 real[] := '{}'; o_s1 real[] := '{}'; o_zb real[] := '{}'; o_zt real[] := '{}'; o_g real[] := '{}'; o_lv boolean[] := '{}'; o_nm text[] := '{}'; o_k text[] := '{}';
        o_ka int[] := '{}'; o_kb int[] := '{}'; ord int[]; no int := 0; fi int;
        za real; zb_ real; zm real; ka int; kb int; side text; sides text[]; z2 real[]; lo2 real[]; hi2 real[]; mg real := 0; st text := ''; zz real; lx int := 0; xs jsonb := '[]'::jsonb;
        tun int := 0; via int := 0; brg int := 0; cut int := 0; acc real; cnt int; G real; off real; wr real[] := '{}'; w0 real; nu int;
        gb real[]; ge real[]; tw int := 20; wv real; jj int; zlv real[] := '{}'; zq record;
        zt real := (opt ->> 'zt')::real; zr boolean := coalesce(opt -> 'zr' = 'true'::jsonb, false); gm real := (opt ->> 'gm')::real; gx real := (opt ->> 'gx')::real; tz boolean; fl boolean := mode = 'fl';
        blo real[]; bhi real[]; gmx real; gmn real; wt boolean; al real; g0 real;
begin
  -- 1マスごとの地面
  for sm in select * from _mp_gsamp(p) loop ss := ss || sm.s; gg := gg || sm.g; tt := tt || sm.t; end loop;
  ns := array_length(ss, 1); S := ss[ns];
  G := case when kind = 'road' then 0.08 when rack then 0.07 else 0.035 end; g0 := G;
  if gm is not null then G := least(G, greatest(0.005, gm / 1000.0)::real); end if;   -- 勾配の上限（DB の更新84）
  if gx is not null then G := greatest(G, least(0.15, gx / 1000.0)::real); end if;   -- いまの線の急さまで（駅の高さを変えるとき。地面どおりの古い線など。DB の更新84）
  tz := mode = 'tz' and zt is not null; if mode = 'tz' and not tz then mode := 'auto'; end if;   -- tz：高さを決める（DB の更新84）
  al := case when mode = 'tn' then 0 else 0.5 end;
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
    if fl then an := an || ss; end if;   -- 平坦（DB の更新84）：地面の点（1マスごと）も点にする
    for k in 1..coalesce(array_length(fx, 1), 0) / 4 loop an := an || array[least(S, greatest(0, fx[4 * k - 3])), least(S, greatest(0, fx[4 * k - 2]))]; end loop;
    -- 駅のところは水平（DB の更新108）：opt の lv［s0, s1, …］と、この線（oseg）の駅（ホームの前後 30m まで）
    if kind = 'rail' then
      if jsonb_typeof(opt -> 'lv') = 'array' then zlv := array(select v::real from jsonb_array_elements_text(opt -> 'lv') v); end if;
      if oseg is not null then
        for zq in select pj.s zs, zt.plat zp from mp_stations zt, lateral _mp_proj(p, zt.x / 100.0, zt.y / 100.0) pj where zt.seg = any(oseg) and zt.kind = 'rail' and pj.dist < 0.15 loop
          zlv := zlv || array[(zq.zs - zq.zp / 100.0 - 0.6)::real, (zq.zs + zq.zp / 100.0 + 0.6)::real];
        end loop;
      end if;
      for k in 1..coalesce(array_length(zlv, 1), 0) / 2 loop an := an || array[least(S, greatest(0, zlv[2 * k - 1])), least(S, greatest(0, zlv[2 * k]))]; end loop;
    end if;
    for k in 1..coalesce(array_length(upf, 1), 0) / 2 loop an := an || least(S, greatest(0, upf[2 * k - 1])); end loop;
    for zz in select v from unnest(an) v order by v loop
      if array_length(cs, 1) is null or zz > cs[array_length(cs, 1)] + 0.02 then cs := cs || zz; end if;
    end loop;
    cs[1] := 0; cs[array_length(cs, 1)] := S; n := array_length(cs, 1);
    off := case mode when 'el' then 10 when 'ug' then -20 when 'tz' then case when zr then zt else 0 end else 0 end;   -- 高さを決める：地面からの高さ（標高のときは、目標がその高さ。DB の更新84）
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
      tg := tg || case when tz and not zr then zt else (round((acc / greatest(cnt, 1) + off)::numeric, 1))::real end;
    end loop;
    lo := array_fill(-1e9::real, array[n]); hi := array_fill(1e9::real, array[n]);
    if z0 is not null then lo[1] := z0; hi[1] := z0; end if;
    if z1 is not null then lo[n] := z1; hi[n] := z1; end if;
    for k in 1..n - 1 loop d := d || (G * (cs[k + 1] - cs[k]) * 50)::real; end loop;
    for k in 1..coalesce(array_length(zlv, 1), 0) / 2 loop   -- 駅のところは水平（DB の更新108）
      for j in 1..n - 1 loop if cs[j] >= zlv[2 * k - 1] - 0.02 and cs[j + 1] <= zlv[2 * k] + 0.02 then d[j] := least(d[j], (coalesce((opt ->> 'lvg')::real, 0) / 1000 * (cs[j + 1] - cs[j]) * 50)::real); end if; end loop;   -- lvg：駅の勾配（‰。ふつうは 0）
    end loop;   -- 勾配の上限（DB の更新84。決めなければ _mp_hd と同じ）
    -- 水の上：橋（2m より上）。地下（地下鉄）なら 川・海の下（−15m より下）
    for k in 1..coalesce(array_length(wr, 1), 0) / 2 loop
      for j in 1..n loop
        if cs[j] >= wr[2 * k - 1] - 0.02 and cs[j] <= wr[2 * k] + 0.02 then
          if mode = 'ug' or (tz and tg[j] <= -8) then hi[j] := least(hi[j], -15); else lo[j] := greatest(lo[j], 2); end if;   -- 高さを決める：目標が水の下なら下（DB の更新84）
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
    -- 平坦（DB の更新84）：点ごとの「地面のまま」の範囲（まわり 1マスの地面より 8m 低い〜6m 高い。水の上は 2〜8m の低い橋）
    if fl then
      blo := array_fill(-1e9::real, array[n]); bhi := array_fill(1e9::real, array[n]);
      for k in 1..n loop
        gmx := -1e9; gmn := 1e9; wt := false;
        for j in greatest(1, floor(cs[k])::int)..least(ns, floor(cs[k])::int + 2) loop
          if abs(ss[j] - cs[k]) < 0.999 then
            if tt[j] in ('S', 'R', 'L', 'D') then wt := true; else gmx := greatest(gmx, gg[j]); gmn := least(gmn, gg[j]); end if;
          end if;
        end loop;
        if gmx > -1e8 then
          blo[k] := gmx - 7.9; bhi[k] := gmn + 5.9;
          if wt then blo[k] := greatest(blo[k], 2); bhi[k] := greatest(bhi[k], blo[k]); end if;
          if blo[k] > bhi[k] then wv := (blo[k] + bhi[k]) / 2; blo[k] := wv; bhi[k] := wv; end if;
        elsif wt then blo[k] := 2; bhi[k] := 8; end if;
      end loop;
    end if;
    ord := array(select gi from generate_series(1, no) gi order by o_lv[gi], o_s0[gi]);
    -- 解く。通るものにかかるところは、1つずつ上か下（か踏切）に決めて解きなおす（だめなら ほかの側。線路・建物などが先、踏切にできる道路はあと）
    z := _mp_prof_solve_al(tg, lo, hi, d, al);   -- トンネル優先は、目標より下で いちばん近い線（DB の更新81）
    if fl and z is not null then z := _mp_prof_flat(cs, z, lo, hi, blo, bhi); end if;   -- 平坦（DB の更新84）
    if z is null then
      return jsonb_build_object('ok', false, 'err', case when z0 is not null and z1 is not null and abs(z1 - z0) > G * S * 50 then
        format('勾配がきつすぎて、はしの高さどうしをつなげません（%s は %s‰ まで。高さの差 %sm・長さ %sm）', case when G < g0 then '勾配の上限' when kind = 'road' then '道路' when rack then 'アプト式' else '線路' end,
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
                    when mode = 'ug' or (tz and tg[o_ka[fi]] < o_g[fi] - 8) then array['under', 'over'] when mode = 'el' or (tz and tg[o_ka[fi]] > o_g[fi] + 6) then array['over', 'under']
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
        z2 := _mp_prof_solve_al(tg, lo2, hi2, d, al);
        if fl and z2 is not null then z2 := _mp_prof_flat(cs, z2, lo2, hi2, blo, bhi); end if;   -- 平坦（DB の更新84）
        exit when z2 is not null;
      end loop;
      if z2 is null then return jsonb_build_object('ok', false, 'err', '上下をよける高さがとれません（勾配がきつすぎます' || case when upf is not null then '。手で決めた高さも見なおしてください' else '' end || '）：' || o_nm[fi]); end if;
      lo := lo2; hi := hi2; z := z2;
    end loop;
    if fi is not null then return jsonb_build_object('ok', false, 'err', '上下をよける高さがとれません：' || o_nm[fi]); end if;
    pf := _mp_prof_pack(cs, z);
    if fl or tz then pf := _mp_prof_simp(pf); end if;   -- まっすぐにならぶ点は まとめる（DB の更新84）
  end;
  -- いちばん急な勾配・1マスごとのつくり・踏切・交差
  for k in 1..n - 1 loop mg := greatest(mg, abs(z[k + 1] - z[k]) / greatest((cs[k + 1] - cs[k]) * 50, 1) * 1000); end loop;
  for j in 1..ns loop
    zz := _mp_pz(pf, ss[j]);
    st := st || _mp_st_code(zz, gg[j], tt[j]);
  end loop;
  st := _mp_st_tidy(st);   -- 短い切れはし をならす（DB の更新111）
  tun := 50 * (length(st) - length(replace(st, 'T', ''))); via := 50 * (length(st) - length(replace(st, 'V', ''))); brg := 50 * (length(st) - length(replace(st, 'B', '')));
  cut := 50 * (length(st) - length(replace(st, 'C', '')));   -- 切り通し（DB の更新111）
  for i in 1..no loop
    za := _mp_pz(pf, (o_s0[i] + o_s1[i]) / 2);
    side := case when za >= o_zt[i] - 0.01 then 'over' when za <= o_zb[i] + 0.01 then 'under' else 'level' end;
    if side = 'level' and o_k[i] = 'x' then lx := lx + 1; end if;
    xs := xs || jsonb_build_array(jsonb_build_array(round(o_s0[i]::numeric, 1), side, o_nm[i]));
  end loop;
  return jsonb_build_object('ok', true, 'prof', to_jsonb(pf), 'st', st, 'g', (select jsonb_agg(round(v::numeric)) from unnest(gg) v), 'maxg', round(mg::numeric),
    'tun', tun, 'via', via, 'brg', brg, 'cut', cut, 'lx', lx, 'xs', xs, 'ns', ns);
end $$;

create or replace function public._mp_st_of(p int[], pf real[]) returns text
language sql stable set search_path = public as $$
  select case when pf is null then null else _mp_st_tidy((select string_agg(_mp_st_code(_mp_pz(pf, g.s), g.g, g.t), '' order by g.i) from _mp_gsamp(p) g)) end
$$;

-- いまある線の つくりを 決めなおす（トンネルのある線だけ。8m〜15m のところが 切り通しに）。地図に しらせる
do $$
declare zq record; zn int := 0; zs text;
begin
  for zq in select id, pts, prof, st, bb from mp_segs where prof is not null and st ~ '[TC]' loop
    zs := _mp_st_of(zq.pts, zq.prof);
    if zs is not null and zs is distinct from zq.st then
      update mp_segs set st = zs where id = zq.id;
      perform _mp_chg('seg', zq.id, 'set', zq.bb);
      zn := zn + 1;
    end if;
  end loop;
  raise notice '切り通しに した線: %', zn;
end $$;
