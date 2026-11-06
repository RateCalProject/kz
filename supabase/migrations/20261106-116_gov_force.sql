-- DB の更新116：国の強行（国の工事は、エラーが出ても つくれる）・地下でも 線路どうしは 上下に交差
--   国（管理者）の工事に「強行」：線をひく（mp_seg_build の p_opts.force）・線の形を直す（mp_seg_edit の p_force）・線の高さ（mp_seg_height の p_opt.force）・
--   駅をつくる（mp_sta_build の p_force）・駅の高さ（mp_sta_height の p_force）。国の線・駅で、管理者のときだけ
--   強行すると：きついカーブ・深い海の上・ホームのカーブ・ホームにかかる建物も つくれる。縦断（_mp_prof_make2 の opt.force）は、
--   勾配の上限をこえてもよい（ゆるいほうから。よけるもの（交差する線路・建物・ホームなど）の まわりだけ）。線路どうしは 地下でも 上下に 10m はなす（上下交差）。
--   それでも よけきれないものだけ、そのまま通す（xs の 'clash'）。見つもりの答えに fc（強行したところ）

-- 形が変わる関数（p_force を足す）：前の形を消す
drop function if exists public.mp_seg_edit(bigint, int[], int[], boolean);
drop function if exists public.mp_sta_build(text, bigint, real, real, int, int, text, text, boolean);
drop function if exists public.mp_sta_height(bigint, text, boolean);

--   国の強行（opt.force。DB の更新116）：だめなら 勾配の上限をこえてもよい（よけるもののまわりだけ・ゆるいほうから）。それでも よけきれないものは通す（xs の 'clash'）。
--     答えに fc（強行したところ：['g', ‰]・['g', ‰, 名前]・['x', 名前]・['c'（はしの高さだけ守った）]）
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
        zfo boolean := coalesce(opt -> 'force' = 'true'::jsonb, false); zfc jsonb := '[]'::jsonb; zsk boolean[]; zgf real; zw real; zd2 real[]; zok boolean;   -- 国の強行（DB の更新116）
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
    zsk := array_fill(false, array[no]);   -- 国の強行で よけないことにしたもの（DB の更新116）
    ord := array(select gi from generate_series(1, no) gi order by o_lv[gi], o_s0[gi]);
    -- 解く。通るものにかかるところは、1つずつ上か下（か踏切）に決めて解きなおす（だめなら ほかの側。線路・建物などが先、踏切にできる道路はあと）
    z := _mp_prof_solve_al(tg, lo, hi, d, al);   -- トンネル優先は、目標より下で いちばん近い線（DB の更新81）
    if fl and z is not null then z := _mp_prof_flat(cs, z, lo, hi, blo, bhi); end if;   -- 平坦（DB の更新84）
    if z is null and zfo then   -- 国の強行（DB の更新116）：勾配の上限をこえてもよい（ゆるいほうから。120‰ までは 駅のところは水平のまま）。それでもだめなら はしの高さだけ守る
      foreach zgf in array array[0.05, 0.08, 0.12, 0.2, 0.4, 1.0]::real[] loop
        continue when zgf <= G;
        zd2 := '{}';
        for k in 1..n - 1 loop zd2 := zd2 || (zgf * (cs[k + 1] - cs[k]) * 50)::real; end loop;
        if zgf < 0.2 then
          for i in 1..coalesce(array_length(zlv, 1), 0) / 2 loop
            for k in 1..n - 1 loop if cs[k] >= zlv[2 * i - 1] - 0.02 and cs[k + 1] <= zlv[2 * i] + 0.02 then zd2[k] := least(zd2[k], d[k]); end if; end loop;
          end loop;
        end if;
        z := _mp_prof_solve_al(tg, lo, hi, zd2, al);
        if fl and z is not null then z := _mp_prof_flat(cs, z, lo, hi, blo, bhi); end if;
        if z is not null then d := zd2; zfc := zfc || jsonb_build_array(jsonb_build_array('g', round((zgf * 1000)::numeric))); exit; end if;
      end loop;
      if z is null then   -- はしの高さだけ（川の上の橋・車庫・手で決めた高さ・駅の水平は 守れない）
        lo := array_fill(-1e9::real, array[n]); hi := array_fill(1e9::real, array[n]);
        if z0 is not null then lo[1] := z0; hi[1] := z0; end if;
        if z1 is not null then lo[n] := z1; hi[n] := z1; end if;
        zd2 := '{}';
        for k in 1..n - 1 loop zd2 := zd2 || ((cs[k + 1] - cs[k]) * 50)::real; end loop;   -- 1000‰ まで
        z := _mp_prof_solve_al(tg, lo, hi, zd2, al);
        if z is null then zd2 := array_fill(1e6::real, array[n - 1]); z := _mp_prof_solve_al(tg, lo, hi, zd2, al); end if;
        d := zd2; zfc := zfc || jsonb_build_array(jsonb_build_array('c'));
      end if;
    end if;
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
        continue when o_ka[i] = 0 or zsk[i];
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
      if z2 is null and zfo then   -- 国の強行（DB の更新116）：そのまわり（3・10・30マス）だけ 勾配の上限をこえてもよい（ゆるいほうから）。上下は そのまま（線路どうしは 地下でも 10m）
        <<zfl>>
        foreach zgf in array array[0.05, 0.08, 0.12, 0.2, 0.4, 1.0]::real[] loop
          foreach zw in array array[3, 10, 30]::real[] loop
            zd2 := d; zok := false;
            for j in 1..n - 1 loop
              if cs[j + 1] >= o_s0[fi] - zw and cs[j] <= o_s1[fi] + zw and zd2[j] < zgf * (cs[j + 1] - cs[j]) * 50 then zd2[j] := (zgf * (cs[j + 1] - cs[j]) * 50)::real; zok := true; end if;
            end loop;
            continue when not zok;
            foreach side in array sides loop
              lo2 := lo; hi2 := hi;
              for j in o_ka[fi]..o_kb[fi] loop
                if side = 'over' then lo2[j] := greatest(lo2[j], o_zt[fi]);
                elsif side = 'under' then hi2[j] := least(hi2[j], o_zb[fi]);
                else lo2[j] := greatest(lo2[j], o_g[fi] - 2.5); hi2[j] := least(hi2[j], o_g[fi] + 2.5); end if;
              end loop;
              z2 := _mp_prof_solve_al(tg, lo2, hi2, zd2, al);
              if fl and z2 is not null then z2 := _mp_prof_flat(cs, z2, lo2, hi2, blo, bhi); end if;
              if z2 is not null then d := zd2; zfc := zfc || jsonb_build_array(jsonb_build_array('g', round((zgf * 1000)::numeric), o_nm[fi])); exit zfl; end if;
            end loop;
          end loop;
        end loop;
        if z2 is null then   -- よけきれない：そのまま通す（ぶつかる）
          zsk[fi] := true; zfc := zfc || jsonb_build_array(jsonb_build_array('x', o_nm[fi]));
          continue;
        end if;
      end if;
      if z2 is null then return jsonb_build_object('ok', false, 'err', '上下をよける高さがとれません（勾配がきつすぎます' || case when upf is not null then '。手で決めた高さも見なおしてください' else '' end || '）：' || o_nm[fi]); end if;
      lo := lo2; hi := hi2; z := z2;
    end loop;
    if fi is not null and not zfo then return jsonb_build_object('ok', false, 'err', '上下をよける高さがとれません：' || o_nm[fi]); end if;
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
    if zsk[i] then side := 'clash'; end if;   -- 国の強行で よけきれなかったもの（DB の更新116）
    if side = 'level' and o_k[i] = 'x' then lx := lx + 1; end if;
    xs := xs || jsonb_build_array(jsonb_build_array(round(o_s0[i]::numeric, 1), side, o_nm[i]));
  end loop;
  return jsonb_build_object('ok', true, 'prof', to_jsonb(pf), 'st', st, 'g', (select jsonb_agg(round(v::numeric)) from unnest(gg) v), 'maxg', round(mg::numeric),
    'tun', tun, 'via', via, 'brg', brg, 'cut', cut, 'lx', lx, 'xs', xs, 'ns', ns) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;   -- fc：強行したところ（DB の更新116）
end $$;

create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); pws smallint := least(2, greatest(0, coalesce((p_opts ->> 'ps')::int, 0)))::smallint; elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text; ho jsonb;
        sga smallint; sg2 smallint; ssl smallint; sct smallint; snw smallint;   -- 線路の規格（DB の更新99）
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  zfo := pa.gv and coalesce(p_opts -> 'force' = 'true'::jsonb, false);   -- 国の強行（DB の更新116）：きついカーブ・深い海の上・高さ（勾配・交差）のエラーでも つくる
  if p_kind not in ('road', 'rail') then raise exception '作るものがちがいます'; end if;
  if p_kind = 'rail' then cls := 'rail'; end if;   -- 国も線路を引ける（DB の更新101。国の工事は無料・土地の申請も使用料もなし・免許もいらない）
  if p_kind = 'road' then
    if pa.gv then if cls not in ('exp', 'nat', 'pref', 'city', 'lane') then cls := 'city'; end if;
    else cls := 'priv'; end if;
    dbl := false; elec := false; quad := false;
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
  if (p_kind = 'rail' and rmin < 3) or (p_kind = 'road' and rmin < 0.7) then
    if not zfo then
      if p_kind = 'rail' then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
      raise exception 'カーブがきつすぎます';
    end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('r', round((rmin * 50)::numeric)));
  end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then
    if not zfo then raise exception '深い海には作れません'; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('D'));
  end if;
  if quad then dbl := true; end if;   -- 複々線（DB の更新86）は複線のうち
  -- 線路の規格（DB の更新99）：p_opts の gauge・g2（三線軌条）・slp（枕木）・cat（架線）・nw（防音壁）。ないときは 1067mm・PC・シンプル・なし。第三軌条は 直流750V
  sga := case when (p_opts ->> 'gauge')::int in (762, 1067, 1372, 1435) then (p_opts ->> 'gauge')::int else 1067 end;
  sg2 := case when (p_opts ->> 'g2')::int in (762, 1067, 1372, 1435) and (p_opts ->> 'g2')::int <> sga then (p_opts ->> 'g2')::int end;
  ssl := least(3, greatest(0, coalesce((p_opts ->> 'slp')::int, 0)));
  sct := case when elec then least(6, greatest(0, coalesce((p_opts ->> 'cat')::int, 0))) else 0 end;
  snw := least(2, greatest(0, coalesce((p_opts ->> 'nw')::int, 0)));
  if p_kind <> 'rail' then sga := 1067; sg2 := null; ssl := 0; sct := 0; snw := 0; end if;
  if sct = 6 then pws := 3; end if;
  sw := case when p_kind = 'rail' then case when quad then 0.8 when dbl then 0.5 else 0.36 end else _mp_road_w(cls, ln_) end;
  cells := _mp_seg_cells_arr(p_pts, p_kind, sw, dbl);
  -- 高さ（t108）：縦断を決める。交差する線（線路どうしは 10m 上か下。道路とは、どちらも地面なら踏切・交差点）・建物（屋根＋5m より上か、地面−15m より下）・
  --   駅のホーム・車庫・バス停（±10m）・滑走路（下だけ）は、上か下を通る（つなぐはしの 20m はのぞく）。はしの高さは、つなぐ先と同じ
  if md not in ('auto', 'el', 'ug', 'tn', 'fl', 'tz') then md := 'auto'; end if;   -- tn：トンネル優先（DB の更新81）・fl：平坦（地上）・tz：高さを決める（DB の更新84）
  if p_kind <> 'rail' then rk := false; end if;
  ho := _mp_hopt(md, p_opts, p_kind, rk);   -- 高さ・勾配の上限（DB の更新84）
  if md = 'tz' and not coalesce(ho ? 'zt', false) then md := 'auto'; end if;
  if jsonb_typeof(p_opts -> 'prof') = 'array' then upf := array(select v::real from jsonb_array_elements_text(p_opts -> 'prof') v); end if;
  nhm := case when upf is not null then 'man' else md end;
  z0 := _mp_att_z(p_from, p_pts[1], p_pts[2]); z1 := _mp_att_z(p_to, p_pts[2 * np - 1], p_pts[2 * np]);
  ea := case when p_from is null then 0 else least(0.4, ln / 3) end; eb := case when p_to is null then ln else ln - least(0.4, ln / 3) end;
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], case when zfo then coalesce(ho, '{}'::jsonb) || jsonb_build_object('force', true) else ho end);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  zfc := zfc || coalesce(pr -> 'fc', '[]'::jsonb);
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：マスごとに、つくり（地面・高架・トンネル・橋）と地形の倍率 ×（1 ＋ まちの係数）。アプト式は 1.3倍
  base := case when p_kind = 'rail' then _mp_rate('rail') * _mp_gauge_mul(sga) * case when sg2 is not null then 1.4 else 1 end * _mp_slp_bmul(ssl) else _mp_rate('road') * _mp_road_mul(cls, ln_) end;   -- 軌間・三線軌条・枕木（DB の更新99）
  if not pa.gv then   -- 国の工事は無料（t57b）：工事費の計算もしない
    cost := _mp_st_cost(tiles, ters, _mp_st_tiles(p_pts, pr ->> 'st'), rk, null, false, base, _mp_trmul(dbl, quad), case when elec then _mp_rate('elec') * _mp_cat_cmul(sct, _mp_st_tiles(p_pts, pr ->> 'st')) else 0 end)
            + _mp_nw_cost(snw) * (select count(*) from unnest(_mp_st_tiles(p_pts, pr ->> 'st')) c where c <> 'T');   -- 架線の種類・防音壁（DB の更新99）
  end if;
  cost := round(cost);
  vl := case when p_kind = 'rail' then case when rk then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else _mp_road_v(cls, ln_) end;
  select * into lq from _mp_lease_quote(cells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(cells, pa.pu, pa.pc, pa.gv);
  if p_dry then
    return jsonb_build_object('cost', cost, 'lease', round(lq.fee), 'own', lq.own, 'other', lq.other, 'state', lq.state, 'pub', lq.pub,
      'tiles', array_length(tiles, 1) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50),
      'vlim', vl, 'lanes', ln_, 've', case when p_kind = 'rail' and elec then _mp_cat_v(sct) end,
      'vtop', case when p_kind = 'rail' then least(_mp_seg_v(sga, sg2, ssl, rk), (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)) else _mp_road_v(cls, ln_) end,
      'need', need, 'hm', nhm, 'ho', ho, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns' - 'fc')
      || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt, quad, ps, gauge, g2, slp, cat, nw)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho, quad, case when elec then pws else 0 end, sga, sg2, ssl, sct, snw)
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
      -- 線のとちゅうから分かれた 行きどまりの線（はしの1つだけが、線のとちゅうにつながる）：道すじが変わるのは、分けた線を通る系統だけ（DB の更新94）
      perform _mp_routes_fix(pa.pu, pa.pc,
        case when coalesce(p_from ? 'seg', false) <> coalesce(p_to ? 'seg', false)
              and (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) = 1
             then array[coalesce((p_from ->> 'seg')::bigint, (p_to ->> 'seg')::bigint)] end);
    end if;
  end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee));
end $$;

create or replace function public.mp_seg_edit(p_id bigint, p_ctl int[], p_pts int[], p_dry boolean, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); sg mp_segs; me_cs int[]; tiles int[]; old int[]; newt int[] := '{}'; ters text[]; ln real; rmin real; amt_ numeric := 0; mul real[]; i int; base numeric; lq record; a mp_nodes; b mp_nodes; np int := array_length(p_pts, 1) / 2; bad text;
        ncells int[]; need jsonb; md text; pr jsonb; pf real[]; z0 real; z1 real; vl int; ho jsonb;
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  zfo := coalesce(p_force, false) and sg.gov and _is_admin(u);   -- 国の強行（DB の更新116）
  if exists (select 1 from mp_stations where seg = p_id) or exists (select 1 from mp_depots where seg = p_id) then raise exception '駅や車庫のある線は、形を変えられません（先に駅・車庫をこわしてください）'; end if;
  perform _mp_geom_ok(p_pts);
  select * into a from mp_nodes where id = sg.n0; select * into b from mp_nodes where id = sg.n1;
  if a.id is not null and sqrt(((a.x - p_pts[1]) / 100.0) ^ 2 + ((a.y - p_pts[2]) / 100.0) ^ 2) > 0.6 then raise exception 'はしの点は動かせません（はじめ）'; end if;
  if b.id is not null and sqrt(((b.x - p_pts[2 * np - 1]) / 100.0) ^ 2 + ((b.y - p_pts[2 * np]) / 100.0) ^ 2) > 0.6 then raise exception 'はしの点は動かせません（おわり）'; end if;
  tiles := _mp_tiles(p_pts); ln := _mp_len(p_pts); rmin := _mp_minr(p_pts);
  if sg.kind = 'rail' and rmin < 3 then
    if not zfo then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('r', round((rmin * 50)::numeric)));
  end if;
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
  if 'D' = any(ters) then
    if not zfo then raise exception '深い海には作れません'; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('D'));
  end if;
  ncells := _mp_seg_cells_arr(p_pts, sg.kind, sg.w, sg.dbl);
  -- 高さ（t108）：縦断を決めなおす。交差する線・建物・駅のホーム・車庫・バス停・滑走路は、上か下を通る（はしの 20m はのぞく）
  md := case when sg.hm in ('el', 'ug', 'tn', 'fl') then sg.hm when sg.hm = 'tz' and coalesce(sg.hopt ? 'zt', false) then 'tz' else 'auto' end;   -- 平坦・高さを決める（DB の更新84）も
  ho := nullif(case when md = 'tz' then sg.hopt else coalesce(sg.hopt, '{}'::jsonb) - 'zt' - 'zr' end, '{}'::jsonb);   -- 勾配の上限は そのまま
  z0 := _mp_end_z(sg.n0, p_id); z1 := _mp_end_z(sg.n1, p_id);
  pr := _mp_prof_make2(p_pts, sg.kind, sg.cls, z0, z1, md, sg.rack, null::real[], ncells, tiles, least(0.4, ln / 3)::real, (ln - least(0.4, ln / 3))::real, array[p_id], false, null::real[], case when zfo then coalesce(ho, '{}'::jsonb) || jsonb_build_object('force', true) else ho end);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  zfc := zfc || coalesce(pr -> 'fc', '[]'::jsonb);
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：新しく通るマスはぜんぶ、前から通るマスは つくりが高くなった分だけ
  base := case when sg.kind = 'rail' then _mp_rate('rail') * _mp_gauge_mul(sg.gauge) * case when sg.g2 is not null then 1.4 else 1 end * _mp_slp_bmul(sg.slp) else _mp_rate('road') * _mp_road_mul(sg.cls, sg.lanes) end;
  if not sg.gov then   -- 国の工事は無料（t57b）
    amt_ := _mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(p_pts, pr ->> 'st'), sg.rack, _mp_st_map(sg.pts, sg.st), sg.rack, base,
                        _mp_trmul(sg.dbl, sg.quad), case when sg.elec then _mp_rate('elec') * _mp_cat_cmul(sg.cat, _mp_st_tiles(p_pts, pr ->> 'st')) else 0 end + case when sg.kind = 'rail' then _mp_nw_cost(sg.nw) else 0 end);   -- 線路の規格（DB の更新99）
  end if;
  amt_ := round(amt_);
  vl := case when sg.kind = 'rail' then case when sg.rack then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else sg.vlim end;
  select * into lq from _mp_lease_quote(ncells, sg.own_u, sg.own_c, sg.gov);
  -- 新しく通る他人の筆は、貸出料があるか申請が許可されているときだけ（前から通っている区画はそのまま）
  need := _mp_land_need(ncells, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  if p_dry then return jsonb_build_object('cost', amt_, 'lease', round(lq.fee), 'tiles', array_length(tiles, 1) / 2, 'new', coalesce(array_length(newt, 1), 0) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50), 'vlim', vl,
    'vtop', least(_mp_seg_v(sg.gauge, sg.g2, sg.slp, sg.rack), (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)), 'need', need,
    'hm', md, 'ho', ho, 'rack', sg.rack, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns' - 'fc')
    || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end; end if;
  perform _mp_land_stop(need);
  perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, format('%sの引きなおし', case when sg.kind = 'rail' then '線路' else '道路' end));
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  delete from mp_occ where what = sg.kind and ref = p_id;
  perform _mp_occ_set(p_id, sg.kind, tiles);
  update mp_segs set ctl = p_ctl, pts = p_pts, bb = _mp_bb(p_pts), len = ln, vlim = vl, cost = cost + amt_::bigint,
                     prof = pf, st = pr ->> 'st', hm = md, hopt = ho where id = p_id;
  update mp_nodes set z = pf[2] where id = sg.n0 and (z is null or z0 is null);   -- はしの点の高さ（この線だけのはしは、決めた高さに）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = sg.n1 and (z is null or z1 is null);
  -- 使用料は新しい形の区画で決めなおす
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', p_id, 'cost', amt_);
end $$;

create or replace function public.mp_seg_height(p_id bigint, p_mode text, p_prof real[], p_rack boolean, p_dry boolean, p_opt jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; pr jsonb; rk boolean; md text; nhm text; tiles int[]; cells int[]; base numeric; amt numeric := 0; scost numeric := 0;
        pf real[]; nw text; vl int; z0 real; z1 real; s record; g real; ozl text; nzl text; sts jsonb := '[]'::jsonb; ho jsonb;
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  zfo := coalesce(p_opt -> 'force' = 'true'::jsonb, false) and sg.gov and _is_admin(u);   -- 国の強行（DB の更新116）
  rk := sg.kind = 'rail' and coalesce(p_rack, sg.rack);
  md := case when p_mode in ('auto', 'el', 'ug', 'tn', 'fl', 'tz') then p_mode else 'auto' end;   -- tn：トンネル優先（DB の更新81）・fl：平坦（地上）・tz：高さを決める（DB の更新84）
  ho := _mp_hopt(md, coalesce(p_opt, '{}'::jsonb), sg.kind, rk);   -- 高さ・勾配の上限（DB の更新84）
  if md = 'tz' and not coalesce(ho ? 'zt', false) then raise exception '高さ（m）を入れてください'; end if;
  nhm := case when p_prof is not null then 'man' else md end;
  if not p_dry then perform _mp_lock(sg.own_u, sg.own_c); end if;
  tiles := _mp_tiles(sg.pts);
  cells := _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl);
  z0 := _mp_end_z(sg.n0, p_id); z1 := _mp_end_z(sg.n1, p_id);
  pr := _mp_prof_make2(sg.pts, sg.kind, sg.cls, z0, z1, md, rk, p_prof, cells, tiles, least(0.4, sg.len / 3)::real, (sg.len - least(0.4, sg.len / 3))::real, array[sg.id], false,
                       _mp_dep_fx(sg.id, 0, false, sg.len), case when zfo then coalesce(ho, '{}'::jsonb) || jsonb_build_object('force', true) else ho end);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  zfc := zfc || coalesce(pr -> 'fc', '[]'::jsonb);
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
    amt := _mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(sg.pts, nw), rk, _mp_st_map(sg.pts, sg.st), sg.rack, base, _mp_trmul(sg.dbl, sg.quad), 0) + scost;
  end if;
  amt := round(amt);
  vl := case when sg.kind = 'rail' then case when rk then least(30, _mp_vlim(_mp_minr(sg.pts))) else _mp_vlim(_mp_minr(sg.pts)) end else sg.vlim end;
  if p_dry then
    return (pr - 'ok' - 'ns' - 'fc') || jsonb_build_object('cost', amt, 'vlim', vl, 'rack', rk, 'hm', nhm, 'ho', ho, 'stas', sts, 'z0', z0, 'z1', z1, 'len', round(sg.len::numeric, 2))
      || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;
  end if;
  if amt > 0 then
    perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt::bigint, sg.kind, format('%sの高さ（%s）', case when sg.kind = 'rail' then '線路' else '道路' end,
                    case nhm when 'man' then '高さを手で決めた' when 'el' then '高架' when 'ug' then '地下' when 'tn' then 'トンネル優先' when 'fl' then '平坦' when 'tz' then '高さを決めた' else '地形に合わせる' end || case when rk and not sg.rack then '・アプト式' else '' end));
  end if;
  update mp_segs set prof = pf, st = nw, rack = rk, hm = nhm, hopt = ho, vlim = vl, cost = cost + amt::bigint where id = p_id;
  update mp_nodes set z = pf[2] where id = sg.n0 and (z is null or z0 is null);
  update mp_nodes set z = pf[array_length(pf, 1)] where id = sg.n1 and (z is null or z1 is null);
  if sg.kind = 'rail' and vl is distinct from sg.vlim then perform _mp_routes_fix(sg.own_u, sg.own_c, array[p_id]); end if;   -- この線を通る系統だけ（DB の更新94）
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  for s in select id, x, y from mp_stations where seg = p_id loop
    perform _mp_chg('sta', s.id, 'set', box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3)));
  end loop;
  return jsonb_build_object('id', p_id, 'cost', amt);
end $$;

create or replace function public.mp_sta_build(p_kind text, p_seg bigint, p_x real, p_y real, p_plat int, p_tracks int, p_name text, p_as text, p_dry boolean, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; span real; tiles int[]; cost numeric; sid bigint; pt record; nm text := left(trim(coalesce(p_name, '')), 20); sub int[];
        pcs int[]; oc int[]; need jsonb; lfee numeric := 0; zp real; zl text;
        zfo boolean := false; zfc jsonb := '[]'::jsonb; zh text;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  zfo := pa.gv and p_kind = 'rail' and coalesce(p_force, false);   -- 国の強行（DB の更新116）：ホームのカーブ・ホームにかかる建物でも つくる
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
    if _mp_minr(sub) < 8 then
      if not zfo then raise exception 'ホームはカーブのゆるいところ（半径400m以上）に作ります'; end if;
      zfc := zfc || jsonb_build_array(jsonb_build_array('rs', round((_mp_minr(sub) * 50)::numeric)));
    end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + span) / 2 + 1)
       or exists (select 1 from mp_depots t where t.seg = p_seg and abs(t.at - s) < (span + (_mp_dep_dim(t.kind, t.size))[1]) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
    tiles := _mp_tiles(sub);
    pcs := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_line_cells(sub, greatest(0.5, (0.22 * p_tracks + 0.18) * 2.5)::real) z,
                    lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
    -- 高さ（t108）：ホームの高さ。地下駅（地面−15m より深い）は建物の下、高架駅は低い建物の上（屋根＋5m）にも作れる
    zp := case when sg.prof is not null then _mp_pz(sg.prof, s) end;
    zh := _mp_bld_hit_z(pcs, zp);
    if zh is not null then
      if not zfo then raise exception 'ホームが建物のある土地にかかります'; end if;
      zfc := zfc || jsonb_build_array(jsonb_build_array('b', zh));
    end if;
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
    'lease', round(lfee), 'need', need, 'zl', zl) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end; end if;
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

create or replace function public.mp_sta_height(p_id bigint, p_lv text, p_dry boolean, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; sg mp_segs; c record; o record; smp record;
        ids bigint[] := '{}'; rvs boolean[] := '{}'; offs real[] := '{}'; lens real[] := '{}'; cp int[] := '{}'; p int[]; m int; gp real; tl real := 0;
        cs_ real[] := '{}'; cz_ real[] := '{}'; cur real[]; fx real[] := '{}'; wfx real[]; j int; i int;
        sc real; hp real; ozl text; nlv text; oc real; og real; olv text; ozc real; bdeep boolean;
        a0 real; a1 real; rr real; pr jsonb; wp real[]; sub real[]; comb real[]; z0 real; z1 real; nd0 bigint; nd1 bigint; za real; zb real;
        md text; ho jsonb; rk boolean; wpts int[]; err text; amt numeric := 0; scost numeric := 0; sa numeric; tiles int[]; nst text; zc real; hit text; pcs int[];
        subs jsonb := '{}'::jsonb; nseg int := 0; k text; cg float8;
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_id;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  if p_lv is null or p_lv not in ('G', 'E', 'U') then raise exception '高さは 地上駅・高架駅・地下駅 からえらんでください'; end if;
  nlv := nullif(p_lv, 'G');
  select * into sg from mp_segs where id = st.seg;
  if not found then raise exception '駅の線路が見つかりません'; end if;
  if not _mp_mine(u, sg.own_u, sg.own_c) or sg.gov <> (st.own_u is null and st.own_c is null) then raise exception 'ほかの人の線路にある駅は、高さを変えられません'; end if;   -- 国の駅は国の線路の上（DB の更新101）
  zfo := coalesce(p_force, false) and sg.gov and _is_admin(u);   -- 国の強行（DB の更新116）
  ozl := _mp_sta_lv(st.seg, st.at, st.x, st.y);
  if ozl is not distinct from nlv then raise exception 'いまと同じ高さです'; end if;
  if not p_dry then perform _mp_lock(st.own_u, st.own_c); end if;
  -- 線の高さのえらびかた（駅の線のもの。勾配の上限も）
  md := case when sg.hm in ('el', 'ug', 'tn', 'fl') then sg.hm when sg.hm = 'tz' and coalesce(sg.hopt ? 'zt', false) then 'tz' else 'auto' end;
  ho := nullif(case when md = 'tz' then sg.hopt else coalesce(sg.hopt, '{}'::jsonb) - 'zt' - 'zr' end, '{}'::jsonb);
  -- ホームの区画。上に建物があれば、地下駅は地面より 15m 下に
  pcs := (select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from _mp_sta_cells(p_id) z, lateral unnest(array[z.x, z.y]) with ordinality u2(v, o));
  bdeep := p_lv = 'U' and _mp_bld_hit_z(pcs, null) is not null;
  -- 1本の線に（_mp_fix_xing と同じ。つなぎ目の点は1つに）・いまの高さ（1マスごと）・車庫と駅のところ
  --   （えらんだ駅は新しい高さ。ほかの駅は いまの高さ ±6m で、同じ種類（地上・高架・地下）のまま）
  for c in select * from _mp_chain(st.seg) order by ord loop
    select * into sg from mp_segs where id = c.id;
    p := case when c.rev then _mp_rev(sg.pts) else sg.pts end;
    m := coalesce(array_length(cp, 1), 0);
    if m > 0 then
      gp := sqrt(((p[1] - cp[m - 1]) / 100.0) ^ 2 + ((p[2] - cp[m]) / 100.0) ^ 2);
      if gp < 0.03 then cp := cp || p[3:]; else cp := cp || p; tl := tl + gp; end if;
    else cp := p; end if;
    ids := ids || c.id; rvs := rvs || c.rev; offs := offs || tl; lens := lens || sg.len;
    fx := fx || _mp_dep_fx(c.id, tl, c.rev, sg.len);
    for smp in select q.s, q.g from _mp_gsamp(sg.pts) q loop
      cs_ := cs_ || (tl + case when c.rev then sg.len - smp.s else smp.s end)::real;
      cz_ := cz_ || case when sg.prof is null then smp.g else _mp_pz(sg.prof, smp.s) end;
    end loop;
    for o in select * from mp_stations t where t.seg = c.id and t.kind = 'rail' loop
      oc := tl + case when c.rev then sg.len - o.at else o.at end;
      og := _mp_gz(o.x / 100.0, o.y / 100.0);
      if o.id = p_id then
        sc := oc; hp := o.plat / 100.0 + 0.1;
        fx := fx || array[oc - hp, oc + hp, case p_lv when 'E' then og + 6.5 when 'U' then og - 60 else og - 7.5 end,
                                            case p_lv when 'E' then og + 40 when 'U' then og - case when bdeep then 15.5 else 8.5 end else og + 5.5 end]::real[];
      else
        olv := coalesce(_mp_sta_lv(o.seg, o.at, o.x, o.y), 'G');
        ozc := case when sg.prof is null then og else _mp_pz(sg.prof, o.at) end;
        fx := fx || array[oc - o.plat / 100.0 - 0.1, oc + o.plat / 100.0 + 0.1,
                          case olv when 'E' then greatest(og + 6.2, ozc - 6) when 'U' then ozc - 6 else greatest(og - 7.8, ozc - 6) end,
                          case olv when 'E' then ozc + 6 when 'U' then least(og - 8.2, ozc + 6) else least(og + 5.8, ozc + 6) end]::real[];
      end if;
    end loop;
    tl := tl + sg.len;
  end loop;
  if sc is null then raise exception '駅の線路が見つかりません'; end if;
  cur := (select array_agg(u2.v order by q.s, q.k, u2.o) from unnest(cs_, cz_) with ordinality q(s, z, k), lateral unnest(array[q.s, q.z]) with ordinality u2(v, o));
  -- はしの点：ほかの線もつながっていれば その高さ
  select * into sg from mp_segs where id = ids[1]; nd0 := case when rvs[1] then sg.n1 else sg.n0 end; z0 := _mp_end_z(nd0, ids[1]);
  select * into sg from mp_segs where id = ids[array_length(ids, 1)]; nd1 := case when rvs[array_length(ids, 1)] then sg.n0 else sg.n1 end; z1 := _mp_end_z(nd1, ids[array_length(ids, 1)]);
  select * into sg from mp_segs where id = st.seg;
  rk := coalesce((select bool_and(s2.rack) from mp_segs s2 where s2.id = any(ids)), false);
  -- 前後を広げながら解く（区間のはしは、いまの高さ）
  foreach rr in array array[6, 12, 24, 48]::real[] loop
    a0 := greatest(0, sc - hp - rr); a1 := least(tl, sc + hp + rr);
    if a0 < 0.5 then a0 := 0; end if;
    if a1 > tl - 0.5 then a1 := tl; end if;
    wfx := '{}';
    for j in 1..coalesce(array_length(fx, 1), 0) / 4 loop
      if fx[4 * j - 2] > a0 and fx[4 * j - 3] < a1 then wfx := wfx || array[fx[4 * j - 3] - a0, fx[4 * j - 2] - a0, fx[4 * j - 1], fx[4 * j]]; end if;
    end loop;
    wpts := _mp_sub(cp, a0, a1);
    za := case when a0 = 0 then z0 else _mp_pz(cur, a0) end; zb := case when a1 = tl then z1 else _mp_pz(cur, a1) end;
    pr := _mp_prof_make2(wpts, 'rail', 'rail', za, zb, md, rk, null::real[], _mp_seg_cells_arr(wpts, 'rail', sg.w, sg.dbl), _mp_tiles(wpts),
                         case when a0 = 0 then 0.4 else 0 end::real, (a1 - a0 - case when a1 = tl then 0.4 else 0 end)::real, ids, false, wfx, ho);
    if not (pr ->> 'ok')::boolean then   -- いまの線が急なら、区間の中だけ その急さまで（‰）
      select max(abs(q.z2 - q.z1) / greatest((q.s2 - q.s1) * 50, 0.5)) into cg
        from (select cur[2 * gi - 1] s1, cur[2 * gi] z1, cur[2 * gi + 1] s2, cur[2 * gi + 2] z2 from generate_series(1, array_length(cur, 1) / 2 - 1) gi) q where q.s2 > a0 and q.s1 < a1;
      if coalesce(cg, 0) > 0.03 then
        pr := _mp_prof_make2(wpts, 'rail', 'rail', za, zb, md, rk, null::real[], _mp_seg_cells_arr(wpts, 'rail', sg.w, sg.dbl), _mp_tiles(wpts),
                             case when a0 = 0 then 0.4 else 0 end::real, (a1 - a0 - case when a1 = tl then 0.4 else 0 end)::real, ids, false, wfx,
                             coalesce(ho, '{}'::jsonb) || jsonb_build_object('gx', least(150, ceil(cg * 1000) + 1)));
      end if;
    end if;
    exit when (pr ->> 'ok')::boolean;
    err := pr ->> 'err';
    exit when a0 = 0 and a1 = tl;
  end loop;
  if not coalesce((pr ->> 'ok')::boolean, false) and zfo then   -- 国の強行（DB の更新116）：いちばん広い区間で、勾配の上限をこえても
    a0 := greatest(0, sc - hp - 48); a1 := least(tl, sc + hp + 48);
    if a0 < 0.5 then a0 := 0; end if;
    if a1 > tl - 0.5 then a1 := tl; end if;
    wfx := '{}';
    for j in 1..coalesce(array_length(fx, 1), 0) / 4 loop
      if fx[4 * j - 2] > a0 and fx[4 * j - 3] < a1 then wfx := wfx || array[fx[4 * j - 3] - a0, fx[4 * j - 2] - a0, fx[4 * j - 1], fx[4 * j]]; end if;
    end loop;
    wpts := _mp_sub(cp, a0, a1);
    za := case when a0 = 0 then z0 else _mp_pz(cur, a0) end; zb := case when a1 = tl then z1 else _mp_pz(cur, a1) end;
    pr := _mp_prof_make2(wpts, 'rail', 'rail', za, zb, md, rk, null::real[], _mp_seg_cells_arr(wpts, 'rail', sg.w, sg.dbl), _mp_tiles(wpts),
                         case when a0 = 0 then 0.4 else 0 end::real, (a1 - a0 - case when a1 = tl then 0.4 else 0 end)::real, ids, false, wfx,
                         coalesce(ho, '{}'::jsonb) || jsonb_build_object('force', true));
    zfc := zfc || coalesce(pr -> 'fc', '[]'::jsonb);
  end if;
  if not coalesce((pr ->> 'ok')::boolean, false) then raise exception '%', coalesce(err, 'この駅は、この高さにできません'); end if;
  wp := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 区間の中は決めた縦断、外は いまの高さ
  comb := '{}';
  for j in 1..array_length(wp, 1) / 2 loop comb := comb || array[wp[2 * j - 1] + a0, wp[2 * j]]; end loop;
  for j in 1..array_length(cs_, 1) loop
    if cs_[j] < a0 - 0.01 or cs_[j] > a1 + 0.01 then comb := comb || array[cs_[j], cz_[j]]; end if;
  end loop;
  comb := (select array_agg(u2.v order by q.s, q.gi, u2.o) from (select comb[2 * gi - 1] s, comb[2 * gi] z, gi from generate_series(1, array_length(comb, 1) / 2) gi) q,
                   lateral unnest(array[q.s, q.z]) with ordinality u2(v, o));
  -- ホームが建物にかからないか（地下駅は地面より 15m 下・高架駅は屋根より 5m 上なら かからない）
  zc := _mp_pz(comb, sc);
  hit := _mp_bld_hit_z(pcs, zc);
  if hit is not null then
    if not zfo then raise exception 'ホームが建物（%）にかかります', hit; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('b', hit));
  end if;
  -- 区間にかかる線ごとの新しい縦断と工事費（つくりが高くなるマスの差）
  for i in 1..array_length(ids, 1) loop
    continue when not (a0 < offs[i] + lens[i] - 0.01 and a1 > offs[i] + 0.01);
    select * into sg from mp_segs where id = ids[i];
    sub := _mp_prof_sub(comb, offs[i], offs[i] + lens[i]);
    if rvs[i] then sub := _mp_prof_rev(sub, lens[i]); end if;
    nst := _mp_st_of(sg.pts, sub);
    sa := 0;
    if not sg.gov then
      tiles := _mp_tiles(sg.pts);
      sa := round(_mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(sg.pts, nst), sg.rack, _mp_st_map(sg.pts, sg.st), sg.rack, _mp_rate('rail'),
                              _mp_trmul(sg.dbl, sg.quad), 0));
    end if;
    amt := amt + sa; nseg := nseg + 1;
    subs := subs || jsonb_build_object(ids[i]::text, jsonb_build_object('pf', to_jsonb(sub), 'st', nst, 'c', sa));
  end loop;
  -- 駅の差（地下駅 2.5倍・高架駅 1.5倍）
  scost := round(greatest(0, _mp_sta_cost(st.tracks, st.plat, (st.x / 100.0)::real, (st.y / 100.0)::real, nlv) - _mp_sta_cost(st.tracks, st.plat, (st.x / 100.0)::real, (st.y / 100.0)::real, ozl)));
  if p_dry then
    return (pr - 'ok' - 'ns' - 'prof' - 'fc') || jsonb_build_object('prof', to_jsonb(wp), 'cur', to_jsonb(_mp_prof_sub(cur, a0, a1)), 'len', round((a1 - a0)::numeric, 2),
      'sta', jsonb_build_array(round((sc - hp - a0)::numeric, 2), round((sc + hp - a0)::numeric, 2)), 'from', coalesce(ozl, 'G'), 'to', p_lv,
      'cost', amt + scost, 'scost', scost, 'segs', nseg, 'm', round(((a1 - a0) * 50)::numeric)) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;
  end if;
  if amt + scost > 0 then
    perform _mp_pay(st.own_u, st.own_c, false, (amt + scost)::bigint, 'sta', format('駅「%s」の高さ（%s → %s）', st.name,
      case coalesce(ozl, 'G') when 'E' then '高架駅' when 'U' then '地下駅' else '地上駅' end, case p_lv when 'E' then '高架駅' when 'U' then '地下駅' else '地上駅' end));
  end if;
  for k in select jsonb_object_keys(subs) loop
    select * into sg from mp_segs where id = k::bigint for update;
    sub := array(select v::real from jsonb_array_elements_text(subs -> k -> 'pf') v);
    update mp_segs set prof = sub, st = subs -> k ->> 'st', hm = coalesce(hm, 'auto'), cost = cost + (subs -> k ->> 'c')::bigint where id = sg.id;
    update mp_nodes set z = _mp_pz(sub, 0) where id = sg.n0;
    update mp_nodes set z = _mp_pz(sub, sg.len) where id = sg.n1;
    perform _mp_chg('seg', sg.id, 'set', sg.bb);
    for o in select t.id, t.x, t.y from mp_stations t where t.seg = sg.id loop
      perform _mp_chg('sta', o.id, 'set', box(point(o.x / 100.0 - 3, o.y / 100.0 - 3), point(o.x / 100.0 + 3, o.y / 100.0 + 3)));
    end loop;
  end loop;
  return jsonb_build_object('id', p_id, 'cost', amt + scost, 'lv', p_lv);
end $$;

-- だれが呼べるか（形の変わった関数は 作りなおしたので もういちど）
revoke all on function public._mp_prof_make2(int[], text, text, real, real, text, boolean, real[], int[], int[], real, real, bigint[], boolean, real[], jsonb) from public, anon, authenticated;
revoke all on function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) to authenticated;
revoke all on function public.mp_seg_edit(bigint, int[], int[], boolean, boolean) from public, anon;
grant execute on function public.mp_seg_edit(bigint, int[], int[], boolean, boolean) to authenticated;
revoke all on function public.mp_seg_height(bigint, text, real[], boolean, boolean, jsonb) from public, anon;
grant execute on function public.mp_seg_height(bigint, text, real[], boolean, boolean, jsonb) to authenticated;
revoke all on function public.mp_sta_build(text, bigint, real, real, int, int, text, text, boolean, boolean) from public, anon;
grant execute on function public.mp_sta_build(text, bigint, real, real, int, int, text, text, boolean, boolean) to authenticated;
revoke all on function public.mp_sta_height(bigint, text, boolean, boolean) from public, anon;
grant execute on function public.mp_sta_height(bigint, text, boolean, boolean) to authenticated;
-- 待つ時間（作りなおすと消えるので もういちど）：線をひく・直す 60秒・線の高さ 20秒・駅の高さ 60秒
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '60s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean, boolean) set statement_timeout = '60s';
alter function public.mp_seg_height(bigint, text, real[], boolean, boolean, jsonb) set statement_timeout = '20s';
alter function public.mp_sta_height(bigint, text, boolean, boolean) set statement_timeout = '60s';
