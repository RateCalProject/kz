-- 線の高さのえらびかたをふやす：平坦（地上。地面の高さの範囲の中で いちばん平らに）・高さを決める（標高か地面からの高さ m に合わせる）・勾配の上限（‰）。
--   今ある駅の高さを変える（地上駅・高架駅・地下駅。駅の前後の線路の高さを決めなおす）
--   mp_seg_height は p_opt（高さ・勾配の上限）をうけとる（前の形は消す）。地図の hgt2 で、このサーバーかどうかを見分ける

alter table public.mp_segs add column if not exists hopt jsonb;   -- 高さのえらびかたの数値（DB の更新84）：{zt: 高さ m, zr: 地面から, gm: 勾配の上限 ‰}

-- 縦断を いちばん平らに（DB の更新84）：点 cs ごとの範囲 lo〜hi を通る、いちばん短い折れ線（ぴんと張った糸）。勾配のいちばん急なところも、いちばんゆるくなる
--   v0・v1：はしが自由なとき、そのはしの外のずっと遠くにおく点の高さ（null なら、そのはしは lo＝hi で決まっている）
create or replace function public._mp_taut(cs real[], lo real[], hi real[], v0 real, v1 real) returns real[]
language plpgsql immutable as $$
declare n int := array_length(cs, 1); m int; s float8[] := '{}'; a float8[] := '{}'; b float8[] := '{}'; z float8[]; ee float8 := 1e5;
        ap int; za float8; ub float8; lb float8; ju int; jl int; j int; su float8; sl float8; k int; off int := 0; out real[] := '{}';
begin
  if n is null or n < 2 then return lo; end if;
  if v0 is not null then s := s || (cs[1] - ee); a := a || v0::float8; b := b || v0::float8; off := 1; end if;
  for k in 1..n loop s := s || cs[k]::float8; a := a || lo[k]::float8; b := b || hi[k]::float8; end loop;
  if v1 is not null then s := s || (cs[n] + ee); a := a || v1::float8; b := b || v1::float8; end if;
  m := array_length(s, 1);
  z := array_fill(0::float8, array[m]);
  ap := 1; za := (a[1] + b[1]) / 2; z[1] := za;
  while ap < m loop
    ub := 'infinity'; lb := '-infinity'; ju := null; jl := null; j := ap + 1;
    loop
      su := (b[j] - za) / (s[j] - s[ap]); sl := (a[j] - za) / (s[j] - s[ap]);
      if sl > ub + 1e-12 then   -- 上のふちの点 ju で折れる
        for k in ap + 1..ju loop z[k] := za + ub * (s[k] - s[ap]); end loop;
        ap := ju; za := b[ju]; z[ap] := za; exit;
      end if;
      if su < lb - 1e-12 then   -- 下のふちの点 jl で折れる
        for k in ap + 1..jl loop z[k] := za + lb * (s[k] - s[ap]); end loop;
        ap := jl; za := a[jl]; z[ap] := za; exit;
      end if;
      if su < ub then ub := su; ju := j; end if;
      if sl > lb then lb := sl; jl := j; end if;
      if j = m then   -- おわりまで まっすぐ（おわりは決まっているので lb＝ub）
        for k in ap + 1..m loop z[k] := za + (lb + ub) / 2 * (s[k] - s[ap]); end loop;
        ap := m; exit;
      end if;
      j := j + 1;
    end loop;
  end loop;
  for k in 1..n loop out := out || least(hi[k], greatest(lo[k], z[k + off]))::real; end loop;
  return out;
end $$;
-- 平坦（DB の更新84）：縦断 z（地形に合わせた答え）を、点ごとの「地面のまま」の範囲 blo〜bhi（z がそこから出ているところは z まで広げる）の中で いちばん平らに
--   lo〜hi（はしの高さ・川の上の橋・車庫・手で決めた高さ・上下をよけるところ）はそのまま
create or replace function public._mp_prof_flat(cs real[], z real[], lo real[], hi real[], blo real[], bhi real[]) returns real[]
language plpgsql immutable as $$
declare n int := array_length(cs, 1); k int; tl real[] := '{}'; th real[] := '{}';
begin
  for k in 1..n loop
    tl := tl || greatest(lo[k], least(blo[k], z[k]));
    th := th || least(hi[k], greatest(bhi[k], z[k]));
  end loop;
  return _mp_taut(cs, tl, th, case when th[1] - tl[1] < 0.01 then null else z[1] end, case when th[n] - tl[n] < 0.01 then null else z[n] end);
end $$;
-- 縦断の点をへらす（DB の更新84）：まっすぐ（2cm 以内）にならぶ点は1つの線に（64点ごとには のこす）
create or replace function public._mp_prof_simp(pf real[]) returns real[]
language plpgsql immutable as $$
declare n int := coalesce(array_length(pf, 1), 0) / 2; out real[]; i int; j int; a int := 1; ok boolean; zj real;
begin
  if n <= 2 then return pf; end if;
  out := array[pf[1], pf[2]];
  for i in 2..n - 1 loop
    ok := i + 1 - a <= 64;
    if ok then
      for j in a + 1..i loop
        zj := pf[2 * a] + (pf[2 * i + 2] - pf[2 * a]) * (pf[2 * j - 1] - pf[2 * a - 1]) / greatest(1e-6, pf[2 * i + 1] - pf[2 * a - 1]);
        if abs(zj - pf[2 * j]) > 0.02 then ok := false; exit; end if;
      end loop;
    end if;
    if not ok then out := out || array[pf[2 * i - 1], pf[2 * i]]; a := i; end if;
  end loop;
  return out || array[pf[2 * n - 1], pf[2 * n]];
end $$;
-- 高さのえらびかたの数値（DB の更新84）：高さを決める（tz）の高さ zt（m。標高は −300〜4000・地面からは −150〜150）と zr（地面から）、
--   勾配の上限 gm（‰。5 から、ふつうの上限（線路 35・アプト式 70・道路 80）より小さいときだけ）。なければ null
create or replace function public._mp_hopt(md text, o jsonb, kind text, rk boolean) returns jsonb
language sql immutable as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'zt', case when md = 'tz' and jsonb_typeof(o -> 'zt') = 'number' then
            case when o -> 'zr' = 'true'::jsonb then round(least(150, greatest(-150, (o ->> 'zt')::numeric)), 1) else round(least(4000, greatest(-300, (o ->> 'zt')::numeric)), 1) end end,
    'zr', case when md = 'tz' and jsonb_typeof(o -> 'zt') = 'number' and o -> 'zr' = 'true'::jsonb then true end,
    'gm', case when jsonb_typeof(o -> 'gm') = 'number' and (o ->> 'gm')::numeric < case when kind = 'road' then 80 when rk then 70 else 35 end
               then round(greatest(5, (o ->> 'gm')::numeric)) end)), '{}'::jsonb)
$$;

create or replace function public._mp_prof_make2(p int[], kind text, cls text, z0 real, z1 real, mode text, rack boolean, upf real[], cells int[], tiles int[], ea real, eb real, oseg bigint[], xonly boolean, fx real[], opt jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare sm record; ss real[] := '{}'; gg real[] := '{}'; tt text[] := '{}'; S real; ns int; n int; k int; j int; i int; it int;
        cs real[] := '{}'; an real[]; tg real[] := '{}'; lo real[]; hi real[]; d real[] := '{}'; z real[]; pf real[]; o record;
        o_s0 real[] := '{}'; o_s1 real[] := '{}'; o_zb real[] := '{}'; o_zt real[] := '{}'; o_g real[] := '{}'; o_lv boolean[] := '{}'; o_nm text[] := '{}'; o_k text[] := '{}';
        o_ka int[] := '{}'; o_kb int[] := '{}'; ord int[]; no int := 0; fi int;
        za real; zb_ real; zm real; ka int; kb int; side text; sides text[]; z2 real[]; lo2 real[]; hi2 real[]; mg real := 0; st text := ''; zz real; lx int := 0; xs jsonb := '[]'::jsonb;
        tun int := 0; via int := 0; brg int := 0; acc real; cnt int; G real; off real; wr real[] := '{}'; w0 real; nu int;
        gb real[]; ge real[]; tw int := 20; wv real; jj int;
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
    for k in 1..n - 1 loop d := d || (G * (cs[k + 1] - cs[k]) * 50)::real; end loop;   -- 勾配の上限（DB の更新84。決めなければ _mp_hd と同じ）
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
-- 縦断を決めて、しらべる（いままでの呼び出し。数値 opt なし。DB の更新84 から _mp_prof_make2 を呼ぶ）
create or replace function public._mp_prof_make(p int[], kind text, cls text, z0 real, z1 real, mode text, rack boolean, upf real[], cells int[], tiles int[], ea real, eb real, oseg bigint[], xonly boolean, fx real[]) returns jsonb
language sql stable set search_path = public as $$
  select _mp_prof_make2(p, kind, cls, z0, z1, mode, rack, upf, cells, tiles, ea, eb, oseg, xonly, fx, null::jsonb)
$$;

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
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color, snowp, prof, st, rack, hm, hopt)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then least(case when sg.rack then 30 else 300 end, _mp_vlim(_mp_minr(pb))) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color,   -- color：路線カラーもそのまま（2026-10-29）
          sg.snowp, fb, _mp_st_of(pb, fb), sg.rack, sg.hm, sg.hopt)   -- 雪よけ・高さ・アプト式もそのまま（t108）。高さの数値も（DB の更新84）
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
                     prof = fm, st = _mp_st_of(pm, fm), hm = case when fm is null then null when x.prof is null then y.hm when y.prof is null then x.hm when x.hm = y.hm and x.hopt is not distinct from y.hopt then x.hm else 'man' end,
                     hopt = case when fm is null then null when x.prof is null then y.hopt when y.prof is null then x.hopt when x.hm = y.hm and x.hopt is not distinct from y.hopt then x.hopt end,   -- 高さの数値（DB の更新84）
                     vlim = case when x.rack then least(30, _mp_vlim(_mp_minr(pm))) else _mp_vlim(_mp_minr(pm)) end
   where id = x.id;
  delete from mp_segs where id = y.id;
  delete from mp_nodes where id = nd;
  perform _mp_chg('seg', y.id, 'del', y.bb);
  perform _mp_chg('seg', x.id, 'set', _mp_bb(pm));
  return x.id;
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
                  || case when s.rack then jsonb_build_object('rk', 1) else '{}'::jsonb end || case when s.hm is not null then jsonb_build_object('hm', s.hm) else '{}'::jsonb end
                  || case when s.hopt is not null then jsonb_build_object('ho', s.hopt) else '{}'::jsonb end), '[]'::jsonb)   -- 高さの数値（DB の更新84）
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
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）
  return r;
end $$;

create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text; ho jsonb;
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
  if md not in ('auto', 'el', 'ug', 'tn', 'fl', 'tz') then md := 'auto'; end if;   -- tn：トンネル優先（DB の更新81）・fl：平坦（地上）・tz：高さを決める（DB の更新84）
  if p_kind <> 'rail' then rk := false; end if;
  ho := _mp_hopt(md, p_opts, p_kind, rk);   -- 高さ・勾配の上限（DB の更新84）
  if md = 'tz' and not coalesce(ho ? 'zt', false) then md := 'auto'; end if;
  if jsonb_typeof(p_opts -> 'prof') = 'array' then upf := array(select v::real from jsonb_array_elements_text(p_opts -> 'prof') v); end if;
  nhm := case when upf is not null then 'man' else md end;
  z0 := _mp_att_z(p_from, p_pts[1], p_pts[2]); z1 := _mp_att_z(p_to, p_pts[2 * np - 1], p_pts[2 * np]);
  ea := case when p_from is null then 0 else least(0.4, ln / 3) end; eb := case when p_to is null then ln else ln - least(0.4, ln / 3) end;
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], ho);
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
      'need', need, 'hm', nhm, 'ho', ho, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns');   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho)
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
        ncells int[]; need jsonb; md text; pr jsonb; pf real[]; z0 real; z1 real; vl int; ho jsonb;
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
  md := case when sg.hm in ('el', 'ug', 'tn', 'fl') then sg.hm when sg.hm = 'tz' and coalesce(sg.hopt ? 'zt', false) then 'tz' else 'auto' end;   -- 平坦・高さを決める（DB の更新84）も
  ho := nullif(case when md = 'tz' then sg.hopt else coalesce(sg.hopt, '{}'::jsonb) - 'zt' - 'zr' end, '{}'::jsonb);   -- 勾配の上限は そのまま
  z0 := _mp_end_z(sg.n0, p_id); z1 := _mp_end_z(sg.n1, p_id);
  pr := _mp_prof_make2(p_pts, sg.kind, sg.cls, z0, z1, md, sg.rack, null::real[], ncells, tiles, least(0.4, ln / 3)::real, (ln - least(0.4, ln / 3))::real, array[p_id], false, null::real[], ho);
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
    'hm', md, 'ho', ho, 'rack', sg.rack, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns'); end if;
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

-- 線の高さを変える：前の形（p_opt なし）は消して、p_opt つきにする
drop function if exists public.mp_seg_height(bigint, text, real[], boolean, boolean);
create or replace function public.mp_seg_height(p_id bigint, p_mode text, p_prof real[], p_rack boolean, p_dry boolean, p_opt jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; pr jsonb; rk boolean; md text; nhm text; tiles int[]; cells int[]; base numeric; amt numeric := 0; scost numeric := 0;
        pf real[]; nw text; vl int; z0 real; z1 real; s record; g real; ozl text; nzl text; sts jsonb := '[]'::jsonb; ho jsonb;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
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
                       _mp_dep_fx(sg.id, 0, false, sg.len), ho);
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
    return (pr - 'ok' - 'ns') || jsonb_build_object('cost', amt, 'vlim', vl, 'rack', rk, 'hm', nhm, 'ho', ho, 'stas', sts, 'z0', z0, 'z1', z1, 'len', round(sg.len::numeric, 2));
  end if;
  if amt > 0 then
    perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt::bigint, sg.kind, format('%sの高さ（%s）', case when sg.kind = 'rail' then '線路' else '道路' end,
                    case nhm when 'man' then '高さを手で決めた' when 'el' then '高架' when 'ug' then '地下' when 'tn' then 'トンネル優先' when 'fl' then '平坦' when 'tz' then '高さを決めた' else '地形に合わせる' end || case when rk and not sg.rack then '・アプト式' else '' end));
  end if;
  update mp_segs set prof = pf, st = nw, rack = rk, hm = nhm, hopt = ho, vlim = vl, cost = cost + amt::bigint where id = p_id;
  update mp_nodes set z = pf[2] where id = sg.n0 and (z is null or z0 is null);
  update mp_nodes set z = pf[array_length(pf, 1)] where id = sg.n1 and (z is null or z1 is null);
  if sg.kind = 'rail' and vl is distinct from sg.vlim then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  for s in select id, x, y from mp_stations where seg = p_id loop
    perform _mp_chg('sta', s.id, 'set', box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3)));
  end loop;
  return jsonb_build_object('id', p_id, 'cost', amt);
end $$;

-- 駅の高さを変える（DB の更新84）：地上駅（G）・高架駅（E）・地下駅（U）。駅のホームの前後の線路の縦断を決めなおす
--   （分かれ道のない点でつながる同じ持ち主の線路もいっしょに。前後 8・16・32マスの順に、とどくまで広げる。区間の外の高さは、いまのまま）。
--   ほかの駅・車庫のところは、いまの高さのまま。線の高さのえらびかた（地形に合わせる・トンネル優先・平坦・高さを決める など）は、駅の線のもの。
--   ホームの上に建物があれば、地下駅は地面より 15m 下に。工事費：つくりが高くなるマス（地面 → 高架・トンネルなど）の差と、駅の差（地下駅 2.5倍・高架駅 1.5倍）。もどしても返金なし
create or replace function public.mp_sta_height(p_id bigint, p_lv text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; sg mp_segs; c record; o record; smp record;
        ids bigint[] := '{}'; rvs boolean[] := '{}'; offs real[] := '{}'; lens real[] := '{}'; cp int[] := '{}'; p int[]; m int; gp real; tl real := 0;
        cs_ real[] := '{}'; cz_ real[] := '{}'; cur real[]; fx real[] := '{}'; wfx real[]; j int; i int;
        sc real; hp real; ozl text; nlv text; oc real; og real; olv text; ozc real; bdeep boolean;
        a0 real; a1 real; rr real; pr jsonb; wp real[]; sub real[]; comb real[]; z0 real; z1 real; nd0 bigint; nd1 bigint; za real; zb real;
        md text; ho jsonb; rk boolean; wpts int[]; err text; amt numeric := 0; scost numeric := 0; sa numeric; tiles int[]; nst text; zc real; hit text; pcs int[];
        subs jsonb := '{}'::jsonb; nseg int := 0; k text; cg float8;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_id;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  if p_lv is null or p_lv not in ('G', 'E', 'U') then raise exception '高さは 地上駅・高架駅・地下駅 からえらんでください'; end if;
  nlv := nullif(p_lv, 'G');
  select * into sg from mp_segs where id = st.seg;
  if not found then raise exception '駅の線路が見つかりません'; end if;
  if sg.gov or not _mp_mine(u, sg.own_u, sg.own_c) then raise exception 'ほかの人の線路にある駅は、高さを変えられません'; end if;
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
  if hit is not null then raise exception 'ホームが建物（%）にかかります', hit; end if;
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
                              case when sg.dbl then _mp_rate('dbl_mul') else 1 end, 0));
    end if;
    amt := amt + sa; nseg := nseg + 1;
    subs := subs || jsonb_build_object(ids[i]::text, jsonb_build_object('pf', to_jsonb(sub), 'st', nst, 'c', sa));
  end loop;
  -- 駅の差（地下駅 2.5倍・高架駅 1.5倍）
  scost := round(greatest(0, _mp_sta_cost(st.tracks, st.plat, (st.x / 100.0)::real, (st.y / 100.0)::real, nlv) - _mp_sta_cost(st.tracks, st.plat, (st.x / 100.0)::real, (st.y / 100.0)::real, ozl)));
  if p_dry then
    return (pr - 'ok' - 'ns' - 'prof') || jsonb_build_object('prof', to_jsonb(wp), 'cur', to_jsonb(_mp_prof_sub(cur, a0, a1)), 'len', round((a1 - a0)::numeric, 2),
      'sta', jsonb_build_array(round((sc - hp - a0)::numeric, 2), round((sc + hp - a0)::numeric, 2)), 'from', coalesce(ozl, 'G'), 'to', p_lv,
      'cost', amt + scost, 'scost', scost, 'segs', nseg, 'm', round(((a1 - a0) * 50)::numeric));
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

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_taut', '_mp_prof_flat', '_mp_prof_simp', '_mp_hopt', '_mp_prof_make2', '_mp_prof_make', '_mp_split', '_mp_seg_join2',
                                                         'mp_area', 'mp_seg_build', 'mp_seg_edit', 'mp_seg_height', 'mp_sta_height') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 作りなおした関数のタイムアウト（create or replace で消えるので、もう一度）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '20s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean) set statement_timeout = '20s';
alter function public.mp_seg_height(bigint, text, real[], boolean, boolean, jsonb) set statement_timeout = '20s';
-- 駅の高さを変えるのは、縦断を何回か解くので60秒まで
alter function public.mp_sta_height(bigint, text, boolean) set statement_timeout = '60s';
