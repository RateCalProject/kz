-- DB の更新108：駅は水平・古い線にも縦断
--   縦断を決めるとき（_mp_prof_make2）：線路の駅のところ（ホームの前後 30m まで）は 水平。opt の lv［s0, s1, …］でも
--   高さの決まっていない古い線（縦断なし：地形のとおり）に 縦断を決める（地形に合わせる・勾配は上限まで・山はトンネル・谷は高架。お金はかからない）。
--     駅の高さの種類（地上・高架・地下）は そのまま・車庫は地面。この更新で 60秒まで、のこりは 1分ごとに 4本ずつ（_mp_tick）
--   駅をつくる・ホームの長さを変えると、その線の縦断を決めなおす（駅のところを水平に）
alter table public.mp_segs add column if not exists pfill boolean;   -- 古い線の縦断を決めたか（DB の更新108）：true 決めた・false 決められなかった（地形のまま）・null まだ
create index if not exists mp_segs_pfill on public.mp_segs (id) where kind = 'rail' and prof is null and pfill is null;

create or replace function public._mp_prof_make2(p int[], kind text, cls text, z0 real, z1 real, mode text, rack boolean, upf real[], cells int[], tiles int[], ea real, eb real, oseg bigint[], xonly boolean, fx real[], opt jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare sm record; ss real[] := '{}'; gg real[] := '{}'; tt text[] := '{}'; S real; ns int; n int; k int; j int; i int; it int;
        cs real[] := '{}'; an real[]; tg real[] := '{}'; lo real[]; hi real[]; d real[] := '{}'; z real[]; pf real[]; o record;
        o_s0 real[] := '{}'; o_s1 real[] := '{}'; o_zb real[] := '{}'; o_zt real[] := '{}'; o_g real[] := '{}'; o_lv boolean[] := '{}'; o_nm text[] := '{}'; o_k text[] := '{}';
        o_ka int[] := '{}'; o_kb int[] := '{}'; ord int[]; no int := 0; fi int;
        za real; zb_ real; zm real; ka int; kb int; side text; sides text[]; z2 real[]; lo2 real[]; hi2 real[]; mg real := 0; st text := ''; zz real; lx int := 0; xs jsonb := '[]'::jsonb;
        tun int := 0; via int := 0; brg int := 0; acc real; cnt int; G real; off real; wr real[] := '{}'; w0 real; nu int;
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

-- 線路の縦断を決めなおす（DB の更新108。お金はかからない）：いまの 高さのえらびかた（縦断のない古い線は 地形に合わせる）で。
--   駅のところは水平（_mp_prof_make2）・駅の高さの種類（地上・高架・地下）は そのまま（いまの高さ ±6m）・車庫は地面。手で決めた縦断（man）は しない。
--   決められないときは いまの線の急さ（150‰まで）で もう一度。'ok' か まちがいの文（そのまま）
create or replace function public._mp_prof_redo(p_seg bigint) returns text
language plpgsql set search_path = public as $$
declare sg mp_segs; zmd text; zho jsonb; zfx real[]; zo record; zg real; zl text; zc real; zhp real; pr jsonb; zpf real[]; z0 real; z1 real; zcells int[]; ztiles int[]; zgx int; zmax real;
begin
  select * into sg from mp_segs where id = p_seg for update;
  if not found or sg.kind <> 'rail' or coalesce(array_length(sg.pts, 1), 0) < 4 or sg.hm = 'man' then return 'skip'; end if;
  zmd := case when sg.hm in ('el', 'ug', 'tn', 'fl') then sg.hm when sg.hm = 'tz' and coalesce(sg.hopt ? 'zt', false) then 'tz' else 'auto' end;
  zho := nullif(case when zmd = 'tz' then sg.hopt else coalesce(sg.hopt, '{}'::jsonb) - 'zt' - 'zr' end, '{}'::jsonb);
  zfx := _mp_dep_fx(sg.id, 0, false, sg.len);
  for zo in select * from mp_stations t where t.seg = p_seg and t.kind = 'rail' loop
    zg := _mp_gz(zo.x / 100.0, zo.y / 100.0); zl := coalesce(_mp_sta_lv(zo.seg, zo.at, zo.x, zo.y), 'G'); zhp := zo.plat / 100.0 + 0.1;
    zc := case when sg.prof is null then zg else _mp_pz(sg.prof, zo.at) end;
    zfx := zfx || array[zo.at - zhp, zo.at + zhp,
                        case zl when 'E' then greatest(zg + 6.2, zc - 6) when 'U' then zc - 6 else greatest(zg - 7.8, zc - 6) end,
                        case zl when 'E' then zc + 6 when 'U' then least(zg - 8.2, zc + 6) else least(zg + 5.8, zc + 6) end]::real[];
  end loop;
  z0 := _mp_end_z(sg.n0, p_seg); z1 := _mp_end_z(sg.n1, p_seg);
  if sg.prof is null then   -- 古い線：となりも 縦断のない線（点の高さも まだ）なら、はしの高さは自由（決めた高さを 点の高さに）
    if (select z from mp_nodes where id = sg.n0) is null and not exists (select 1 from mp_segs o where (o.n0 = sg.n0 or o.n1 = sg.n0) and o.id <> p_seg and o.prof is not null) then z0 := null; end if;
    if (select z from mp_nodes where id = sg.n1) is null and not exists (select 1 from mp_segs o where (o.n0 = sg.n1 or o.n1 = sg.n1) and o.id <> p_seg and o.prof is not null) then z1 := null; end if;
  end if;
  zcells := _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl); ztiles := _mp_tiles(sg.pts);
  pr := _mp_prof_make2(sg.pts, sg.kind, sg.cls, z0, z1, zmd, sg.rack, null::real[], zcells, ztiles, least(0.4, sg.len / 3)::real, (sg.len - least(0.4, sg.len / 3))::real,
                       array[sg.id], false, zfx, zho);
  -- 決められない：駅のところを 5‰ まで（停車場の勾配）→ 線を 少しずつ急に（はしの高さの差が大きいとき）
  --   縦断のある線は いまの急さより急にしない（できなければ いまのまま）
  zmax := case when sg.prof is not null then (select max(abs(sg.prof[2 * k + 2] - sg.prof[2 * k]) / greatest((sg.prof[2 * k + 1] - sg.prof[2 * k - 1]) * 50, 1) * 1000)
                                                 from generate_series(1, array_length(sg.prof, 1) / 2 - 1) k) end;
  foreach zgx in array case when sg.prof is null then array[0, 50, 70, 100, 150] else array[0, greatest(36, ceil(coalesce(zmax, 35)))::int] end loop
    exit when (pr ->> 'ok')::boolean;
    pr := _mp_prof_make2(sg.pts, sg.kind, sg.cls, z0, z1, zmd, sg.rack, null::real[], zcells, ztiles, least(0.4, sg.len / 3)::real, (sg.len - least(0.4, sg.len / 3))::real,
                         array[sg.id], false, zfx, coalesce(zho, '{}'::jsonb) || jsonb_build_object('lvg', 5) || case when zgx > 0 then jsonb_build_object('gx', zgx) else '{}'::jsonb end);
  end loop;
  if not (pr ->> 'ok')::boolean then
    if sg.prof is null then update mp_segs set pfill = false where id = p_seg; end if;
    return coalesce(pr ->> 'err', 'できません');
  end if;
  zpf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  update mp_segs set prof = zpf, st = pr ->> 'st', hm = coalesce(sg.hm, 'auto'), pfill = true where id = p_seg;
  update mp_nodes set z = zpf[2] where id = sg.n0 and (z is null or z0 is null);
  update mp_nodes set z = zpf[array_length(zpf, 1)] where id = sg.n1 and (z is null or z1 is null);
  perform _mp_chg('seg', p_seg, 'set', sg.bb);
  for zo in select id, x, y from mp_stations where seg = p_seg loop
    perform _mp_chg('sta', zo.id, 'set', box(point(zo.x / 100.0 - 3, zo.y / 100.0 - 3), point(zo.x / 100.0 + 3, zo.y / 100.0 + 3)));
  end loop;
  return 'ok';
end $$;

-- 高さの決まっていない古い線路（縦断なし）に 縦断を決める（DB の更新108）：p_n 本まで・p_ms ミリ秒まで。決めた数
create or replace function public._mp_prof_fill_some(p_n int, p_ms int) returns int
language plpgsql set search_path = public as $$
declare zt0 timestamptz := clock_timestamp(); zid bigint; zk int := 0; zr text;
begin
  for zid in select id from mp_segs where kind = 'rail' and prof is null and pfill is null order by id limit greatest(0, p_n) loop
    exit when extract(epoch from clock_timestamp() - zt0) * 1000 > p_ms;
    begin
      zr := _mp_prof_redo(zid);
    exception when others then
      raise warning 'mp prof fill %: %', zid, sqlerrm;
      update mp_segs set pfill = false where id = zid;
      zr := 'err';
    end;
    if zr = 'skip' then update mp_segs set pfill = false where id = zid; end if;
    zk := zk + 1;
  end loop;
  return zk;
end $$;

create or replace function public._mp_tick() returns void
language plpgsql set search_path = public as $$
declare last timestamptz; h timestamptz; n int := 0;
begin
  if not exists (select 1 from mp_chunks limit 1) then return; end if;
  select v into last from mp_state where k = 'hour' for update;
  h := date_trunc('hour', now());
  if last is null then insert into mp_state values ('hour', h) on conflict (k) do update set v = excluded.v; return; end if;
  last := greatest(last, h - interval '12 hours');
  begin perform _mp_subst_plan_all(); exception when others then raise warning 'mp subst: %', sqlerrm; end;   -- 予備編成の代走の予定（DB の更新80）
  while last < h and n < 12 loop
    last := last + interval '1 hour'; n := n + 1;
    begin perform _mp_tick_hour(last); exception when others then raise warning 'mp hour: %', sqlerrm; end;
    if extract(hour from last at time zone 'Asia/Tokyo') = 4 then
      begin perform _mp_tick_day(); exception when others then raise warning 'mp day: %', sqlerrm; end;
    end if;
  end loop;
  begin perform _mp_slot_tick(); exception when others then raise warning 'mp slot: %', sqlerrm; end;   -- 発着口の入札・権利の期限（t57）
  begin perform _mp_prof_fill_some(4, 3000); exception when others then raise warning 'mp prof fill: %', sqlerrm; end;   -- 古い線路の縦断（DB の更新108）
  begin perform _mp_tmp_back(); exception when others then raise warning 'mp tmp: %', sqlerrm; end;   -- 期間つき増結の車両を入れ替え枠にもどす（DB の更新80）
  update mp_state set v = last where k = 'hour';
end $$;

create or replace function public.mp_sta_build(p_kind text, p_seg bigint, p_x real, p_y real, p_plat int, p_tracks int, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; span real; tiles int[]; cost numeric; sid bigint; pt record; nm text := left(trim(coalesce(p_name, '')), 20); sub int[];
        pcs int[]; oc int[]; need jsonb; lfee numeric := 0; zp real; zl text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv and p_kind <> 'rail' then raise exception 'バス停は人か会社で作ります'; end if;   -- 国は鉄道の駅だけ（DB の更新101）
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  select * into sg from mp_segs where id = p_seg;
  if not found then raise exception '線が見つかりません'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y); s := q.s;
  if q.dist > 1.2 then raise exception '線の上をえらんでください'; end if;
  if p_kind = 'rail' and not pa.gv and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）。国はいらない（DB の更新101）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if nm = '' then raise exception '名前をつけてください'; end if;
  if p_kind = 'rail' then
    if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, pa.gv) then raise exception '駅は自分（この名義）の線路の上に作ります'; end if;
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
    need := _mp_land_need(pcs, pa.pu, pa.pc, pa.gv, oc);
    with c as (select distinct pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i),
         o as materialized (select distinct oc[2 * i - 1] x, oc[2 * i] y from generate_series(1, coalesce(array_length(oc, 1), 0) / 2) i)
    select coalesce(sum(coalesce(_mp_land_fee(p.id, pa.pu, pa.pc), _mp_land_std(p.id))), 0) into lfee
      from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y join mp_parcels p on p.id = pcl.parcel
     where not pa.gv and not exists (select 1 from o where o.x = c.x and o.y = c.y) and (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false);
    select * into pt from _mp_at(sg.pts, s);
    zl := case when zp is not null then _mp_zl(zp, _mp_gz(pt.x, pt.y)) end;
    cost := _mp_sta_cost(p_tracks, p_plat, pt.x, pt.y, zl);   -- 地下駅 2.5倍・高架駅 1.5倍
    if pa.gv then cost := 0; end if;   -- 国の工事は無料（DB の更新101）
  elsif p_kind = 'bus' then
    if sg.kind <> 'road' then raise exception 'バス停は道路の上に作ります'; end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and t.kind = 'bus' and abs(t.at - s) < 3) then raise exception '近くにほかのバス停があります'; end if;
    span := 0.4; p_plat := 0; p_tracks := 1;
    select * into pt from _mp_at(sg.pts, s);
    tiles := array[floor(pt.x)::int, floor(pt.y)::int];
    cost := _mp_rate('stop');
  else raise exception '作るものがちがいます'; end if;
  if p_dry then return jsonb_build_object('cost', round(cost), 'up_day', case when pa.gv then 0 when p_kind = 'rail' then round(_mp_rate('up_sta') * (1 + 0.25 * (p_tracks - 1))) else _mp_rate('up_stop') end,
    'lease', round(lfee), 'need', need, 'zl', zl); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, round(cost)::bigint, 'sta', format('%s「%s」の工事', case when p_kind = 'rail' then '駅' else 'バス停' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_stations(kind, seg, at, x, y, ang, plat, tracks, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, round(pt.x * 100), round(pt.y * 100), pt.ang, p_plat, p_tracks, nm, pa.pu, pa.pc, round(cost))
  returning id into sid;
  perform _mp_occ_set(sid, case when p_kind = 'rail' then 'sta' else 'stop' end, tiles);
  if p_kind = 'rail' then perform _mp_lease_set('sta', sid, pa.pu, pa.pc, pa.gv); end if;
  if p_kind = 'rail' then begin perform _mp_prof_redo(p_seg); exception when others then raise warning 'mp sta level: %', sqlerrm; end; end if;   -- 駅のところを水平に（DB の更新108）
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
   where (st.own_u is not null or st.own_c is not null) and not exists (select 1 from o where o.x = c.x and o.y = c.y) and (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, st.own_u, st.own_c, false);
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
  if addc > 0 then perform _mp_pay(st.own_u, st.own_c, st.own_u is null and st.own_c is null, addc, 'sta', format('駅「%s」のホームの工事（%sm・%s番線 → %sm・%s番線）', st.name, st.plat, st.tracks, p_plat, p_tracks)); end if;
  -- 番線の使いかた：決めていたら、のこる番線はそのまま・ふえた番線はいつもの決まり
  ntrk := null;
  if st.trk is not null and jsonb_typeof(st.trk) = 'array' and jsonb_array_length(st.trk) = greatest(st.tracks, 1) and p_tracks > 1 then
    st2 := st; st2.trk := null; st2.tracks := p_tracks; dflt := _mp_sta_trk(st2);
    ntrk := (select jsonb_agg(case when k <= jsonb_array_length(st.trk) then st.trk -> (k - 1) else dflt -> (k - 1) end order by k) from generate_series(1, p_tracks) k);
  end if;
  update mp_stations set plat = p_plat, tracks = p_tracks, cost = st.cost + addc, trk = ntrk, pf = case when p_tracks = st.tracks then st.pf end where id = p_id;   -- 番線の数が変われば ホームの形は おまかせ（DB の更新107）
  delete from mp_occ where what = 'sta' and ref = p_id;
  perform _mp_occ_set(p_id, 'sta', tiles);
  perform _mp_lease_set('sta', p_id, st.own_u, st.own_c, false);
  if p_plat <> st.plat then begin perform _mp_prof_redo(st.seg); exception when others then raise warning 'mp sta level: %', sqlerrm; end; end if;   -- 駅のところを水平に（DB の更新108）
  for rr in select r.id from mp_routes r where p_id = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_id, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'cost', addc, 'plat', p_plat, 'tracks', p_tracks);
end $$;


revoke all on function public._mp_prof_redo(bigint) from public, anon, authenticated;
revoke all on function public._mp_prof_fill_some(int, int) from public, anon, authenticated;
alter function public.mp_sta_resize(bigint, int, int, boolean) set statement_timeout = '20s';

-- 縦断のある線路で、駅のところが水平でない線：決めなおす（30秒まで。手で決めた縦断はのぞく）
do $$
declare zt0 timestamptz := clock_timestamp(); zid bigint; zn int := 0;
begin
  for zid in select distinct t.seg from mp_stations t join mp_segs s on s.id = t.seg
              where t.kind = 'rail' and s.prof is not null and s.hm is distinct from 'man'
                and (select max(_mp_pz(s.prof, v)) - min(_mp_pz(s.prof, v)) from generate_series(0, 8) g, lateral (select greatest(0, least(s.len, t.at - t.plat / 100.0 + g * t.plat / 400.0))::float8 v) q) > 0.05 loop
    exit when extract(epoch from clock_timestamp() - zt0) > 30;
    begin perform _mp_prof_redo(zid); zn := zn + 1; exception when others then raise warning 'mp sta level %: %', zid, sqlerrm; end;
  end loop;
  raise notice 'mp sta level: %', zn;
end $$;
-- 古い線路の縦断：この更新で 60秒まで（のこりは _mp_tick で 1分ごとに 4本ずつ）
do $$ declare zn int; begin zn := _mp_prof_fill_some(100000, 60000);
  update mp_segs set pfill = null where kind = 'rail' and prof is null and pfill = false;   -- となりの高さが決まったあとで もう一度
  zn := zn + _mp_prof_fill_some(100000, 20000); raise notice 'mp prof fill: %', zn; end $$;
