-- DB の更新115：番線ごとに 優先する種別・駅の 直通の会社へのメモ
--   駅の発着番線（trk）の 番線ごとに k：優先する種別（8つまで）。列車の番線は その種別の番線 → 決めていない番線 → ほかの種別の番線 の順にえらぶ
--   （待避する列車は 待避線が先。採時駅で番線を決めた列車は そのまま）。この駅を通る系統の時刻は 決めたときに組みなおす
--   駅に 直通の会社へのメモ（200文字まで。だれでも見られる）。書くと、この駅を通る ほかの名義の系統の持ち主に しらせる（10分に1回まで）
--   地図（mp_area）と系統（mp_dia）の駅に mm（メモ）。発着番線を見る（mp_sta_trk）に この駅を通る列車の種別（kinds）とメモ

alter table public.mp_stations add column if not exists memo text;          -- 直通の会社へのメモ（200文字まで。DB の更新115）
alter table public.mp_stations add column if not exists memo_at timestamptz;  -- メモを書いた（しらせたとき）

drop function if exists public._mp_pick_trk(jsonb, int, boolean);
-- 番線をえらぶ：その向き（dir 1 下り・-1 上り）で使える番線のうち、待避（side）なら待避線から。優先する種別（kind。DB の更新115）の番線 → 決めていない番線 → ほかの種別の番線。
--   そのあと side なら待避線（なければ番号の大きいほう）、そうでなければ本線（番号の小さいほう）
create or replace function public._mp_pick_trk(trk jsonb, dir int, side boolean, kind text default null) returns int
language sql immutable as $$
  select coalesce((select e.k::int from jsonb_array_elements(trk) with ordinality e(v, k)
                    where e.v ->> 'd' in (case when dir = -1 then 'up' else 'down' end, 'both') and coalesce(e.v ->> 'm', 'main') <> 'pass'   -- 通過線には止まらない（t62）
                    order by case when side then e.v ->> 'm' = 'side' end desc nulls last,   -- 待避する列車は 待避線から
                             case when jsonb_typeof(e.v -> 'k') = 'array' and jsonb_array_length(e.v -> 'k') > 0
                                  then case when kind is not null and (e.v -> 'k') ? kind then 0 else 2 end else 1 end,   -- 優先する種別（DB の更新115）：その種別の番線 → 決めていない番線 → ほかの種別の番線
                             (e.v ->> 'm' = case when side then 'side' else 'main' end) desc, (e.v ->> 'd' = 'both'),
                             case when side then -e.k else e.k end limit 1), 1)
$$;
revoke all on function public._mp_pick_trk(jsonb, int, boolean, text) from public, anon, authenticated;

create or replace function public._mp_train_times(tr mp_trains, hold jsonb, waits bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare r mp_routes; perf jsonb; n int; ord int[]; i int; k int; t int; arr int; dep int; spec jsonb; sc jsonb := '[]'::jsonb; ws text[] := '{}';
        st mp_stations; lastStop int; run int; trk int; dw int; flen real; stop boolean;
        lq boolean[]; qx boolean;   -- 複々線（DB の更新86）
        lpm int[]; ldz int[]; pneed int; pm int; dzp int := 6; lgm int[]; gok int;   -- 電化方式・デッドセクション（DB の更新87）・軌間（99）
        e jsonb; ci bigint; o mp_ops; cp jsonb; ka int; kb int; cx jsonb := '[]'::jsonb; cw text; nmax int; x jsonb; skipped bigint; k0 int; k1 int;
begin
  select * into r from mp_routes where id = tr.route;
  perf := case when tr.form is not null then _mp_form_perf(tr.form) end;
  n := array_length(r.stops, 1);
  ord := case when tr.dir = 1 then array(select generate_series(1, n)) else array(select generate_series(n, 1, -1)) end;
  dw := r.dwell;
  lq := case when r.kind = 'rail' then case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_q', true), '')::boolean[] else _mp_leg_quad(r.legs) end end;   -- 組みなおしのあいだは1回だけ計算したもの（DB の更新88）
  qx := r.kind = 'rail' and _mp_kprio(r.own_u, r.own_c, tr.kind) <= 3;   -- 急行線を走る列車（優先番号 3 まで。DB の更新86）
  -- 走る区間（途中始発・途中止まり。2026-10-28）：走る順の k0 番目から k1 番目まで
  k0 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sa, false), 1); k1 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sb, true), n);   -- 環状線：始発は走る順で前の、終着はうしろのほう
  if k0 >= k1 then ws := ws || '始発駅と終着駅の順がちがいます（系統の端から端まで走ります）'::text; k0 := 1; k1 := n; end if;
  if perf is null then ws := ws || '編成が決まっていません（走りません）'::text; end if;
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
        where l.lo >= least(ord[k0], ord[k1]) and l.lo < greatest(ord[k0], ord[k1]) and not (l.v ->> 'e')::boolean) then   -- 走る区間だけ
    ws := ws || '電化していない区間があります（電車は走れません）'::text;
  end if;
  -- 電化方式（DB の更新87）：走る区間の方式を、編成が ぜんぶ走れるか
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean then
    if current_setting('mp.li_r', true) = r.id::text then   -- 組みなおしのあいだは1回だけ計算したもの（DB の更新88）
      lpm := nullif(current_setting('mp.li_pm', true), '')::int[]; ldz := nullif(current_setting('mp.li_dz', true), '')::int[];
    else lpm := _mp_leg_pm(r.legs); ldz := _mp_leg_dz(r.legs); end if;
    pm := coalesce((perf ->> 'ps')::int, 1);
    pneed := (select coalesce(bit_or(lpm[lo]), 0) from generate_series(least(ord[k0], ord[k1]), greatest(ord[k0], ord[k1]) - 1) lo);
    if pneed & ~pm <> 0 then
      ws := ws || format('%s の区間があります（この編成は %s だけ。走れません）', _mp_ps_names(pneed & ~pm), _mp_ps_names(pm));
    end if;
  end if;
  -- 軌間（DB の更新99）：走る区間の線路の軌間に、編成が合うか（三線軌条は2つの軌間）
  if perf is not null and r.kind = 'rail' then
    lgm := case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_gm', true), '')::int[] else _mp_leg_gm(r.legs) end;
    gok := (select coalesce(bit_and(lgm[lo]), 15) from generate_series(least(ord[k0], ord[k1]), greatest(ord[k0], ord[k1]) - 1) lo);
    if coalesce((perf ->> 'gm')::int, 2) & ~gok <> 0 then
      ws := ws || format('軌間のちがう区間があります（この編成は %s。走れません）', _mp_gauge_names(coalesce((perf ->> 'gm')::int, 2)));
    end if;
  end if;
  -- 変電所（DB の更新89）：走る区間に、電気の来ていない（変電所から遠い）電化した線があれば走れない
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean
     and exists (select 1 from unnest(case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_fd', true), '')::boolean[] else _mp_leg_fed(r.legs) end) with ordinality x(f, lo)
                  where x.lo >= least(ord[k0], ord[k1]) and x.lo < greatest(ord[k0], ord[k1]) and not x.f) then   -- 組みなおしのあいだは系統ごとに1回だけ計算したもの
    ws := ws || '変電所から遠く、電気が来ていない区間があります（変電所をつくってください。電車は走れません）'::text;
  end if;
  -- 飛行機：滑走路の短い空港には離着陸できない（t54p）
  if perf is not null and r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then
    ws := ws || format('滑走路の短い空港があります（%sm以上いります。飛びません）', perf ->> 'rwy');
  end if;
  -- 連結：つなぐ運用・つなぐ駅と切りはなす駅（走る順の何番目か）
  for e, ci in select z.v, z.o from jsonb_array_elements(coalesce(tr.cpl, '[]'::jsonb)) with ordinality z(v, o) loop
    cw := null; o := null; cp := null;
    select * into o from mp_ops where id = (e ->> 'op')::bigint;
    if o.id is null then cw := '連結する運用が見つかりません';
    elsif r.kind <> 'rail' or o.kind <> 'rail' then cw := 'バスは連結できません';
    elsif o.form is null then cw := format('運用 %s に編成が入っていません', o.num);
    elsif perf is null then cw := 'この列車の編成が決まっていません';
    else
      cp := _mp_form_perf(o.form);
      if cp is null then cw := format('運用 %s に編成が入っていません', o.num); end if;
    end if;
    ka := case when e ->> 'a' is null then k0 else _mp_kpos(r.stops, tr.dir, (e ->> 'a')::bigint, false) end;
    kb := case when e ->> 'b' is null then k1 else _mp_kpos(r.stops, tr.dir, (e ->> 'b')::bigint, true) end;
    if cw is null then
      if ka is null or kb is null then cw := '連結する駅がこの系統にありません';
      elsif ka < k0 or kb > k1 then cw := '連結する駅が、この列車の走る区間にありません';
      elsif ka >= kb then cw := '連結する駅は、切りはなす駅より前にしてください';
      else
        skipped := case when ka > k0 and r.stops[ord[ka]] = any(tr.skip) then r.stops[ord[ka]] when kb < k1 and r.stops[ord[kb]] = any(tr.skip) then r.stops[ord[kb]] end;
        if skipped is not null then cw := format('%s にこの列車は止まりません（連結・切りはなしができません）', (select name from mp_stations where id = skipped)); end if;
      end if;
    end if;
    cx := cx || jsonb_build_array(jsonb_build_object('op', (e ->> 'op')::bigint, 'num', o.num, 'f', o.form,
             'a', case when ka is not null then r.stops[ord[ka]] end, 'b', case when kb is not null then r.stops[ord[kb]] end, 'ka', ka, 'kb', kb,
             'n', (cp ->> 'n')::int, 'len', (cp ->> 'len')::real, 'v', cw is null, 'ok', cw is null, 'w', cw, 'cp', cp));
  end loop;
  -- 両数：駅ごとに足して 16両まで（こえるときは連結しない）
  if exists (select 1 from jsonb_array_elements(cx) c where (c ->> 'v')::boolean) then
    nmax := (select max(coalesce((perf ->> 'n')::int, 0) + coalesce((select sum((c ->> 'n')::int) from jsonb_array_elements(cx) c
                                                   where (c ->> 'v')::boolean and (c ->> 'ka')::int <= kk and kk <= (c ->> 'kb')::int), 0))
             from generate_series(1, n) kk);
    if nmax > 16 then
      cx := (select jsonb_agg(case when (c.v ->> 'v')::boolean then c.v || jsonb_build_object('v', false, 'ok', false, 'w', format('連結すると %s両になります（16両まで）', nmax)) else c.v end order by c.o)
               from jsonb_array_elements(cx) with ordinality c(v, o));
    end if;
  end if;
  -- 性能：いちばん弱い編成にあわせる
  for x in select c from jsonb_array_elements(cx) c where (c ->> 'v')::boolean loop
    perf := perf || jsonb_build_object('acc', least((perf ->> 'acc')::real, coalesce((x -> 'cp' ->> 'acc')::real, (perf ->> 'acc')::real)),
                                       'dec', least(coalesce((perf ->> 'dec')::real, 3.5), coalesce((x -> 'cp' ->> 'dec')::real, 3.5)),
                                       'vmax', least((perf ->> 'vmax')::real, coalesce((x -> 'cp' ->> 'vmax')::real, (perf ->> 'vmax')::real)));
  end loop;
  flen := coalesce((perf ->> 'len')::real, 0);
  t := tr.dep; lastStop := ord[k0];
  for k in k0..k1 loop
    i := ord[k];
    select * into st from mp_stations where id = r.stops[i];
    spec := tr.tt -> (r.stops[i]::text);
    stop := k = k0 or k = k1 or not (r.stops[i] = any(tr.skip));
    trk := coalesce((spec ->> 't')::int, _mp_pick_trk(_mp_sta_trk(st), tr.dir, st.id = any(coalesce(waits, '{}'))
                       or (qx and coalesce(coalesce(lq[i - 1], lq[i]) and coalesce(lq[i], lq[i - 1]), false)), tr.kind));   -- 種別：番線ごとに優先する種別（DB の更新115）   -- 複々線の中の駅：急行線の列車は待避線の番線（DB の更新86）
    if trk > st.tracks then ws := ws || format('%s に %s番線はありません', st.name, trk); trk := st.tracks; end if;
    if stop and r.kind = 'rail' and (_mp_sta_trk(st) -> (trk - 1) ->> 'm') = 'pass' then
      ws := ws || format('%s の %s番線は通過線です（ホームがないので止まれません）', st.name, trk);   -- t62
    end if;
    if k = k0 then
      arr := null; dep := tr.dep + coalesce((hold ->> st.id::text)::int, 0); t := dep;
    else
      if not stop then continue; end if;
      -- 前に止まった駅からここまで（通過駅をまとめて）
      run := _mp_leg_time(r, least(lastStop, i), greatest(lastStop, i), perf);
      if ldz is not null then run := run + dzp * (select coalesce(sum(ldz[lo]), 0) from generate_series(least(lastStop, i), greatest(lastStop, i) - 1) lo)::int; end if;   -- デッドセクションは惰行で通る（1か所 6秒。DB の更新87）
      arr := t + run;
      if spec ? 'a' then
        if (spec ->> 'a')::int < arr then ws := ws || format('%s 着 %s は早すぎます（いちばん早くて %s）', st.name, _mp_hms((spec ->> 'a')::int), _mp_hms(arr));
        else arr := (spec ->> 'a')::int; end if;
      end if;
      if k = k1 then dep := null;
      else
        dep := arr + dw;
        if spec ? 'd' then
          if (spec ->> 'd')::int < arr + 10 then ws := ws || format('%s 発 %s は早すぎます（いちばん早くて %s）', st.name, _mp_hms((spec ->> 'd')::int), _mp_hms(arr + 10));
          else dep := (spec ->> 'd')::int; end if;
        end if;
        dep := dep + coalesce((hold ->> st.id::text)::int, 0);   -- 待避・続行
      end if;
    end if;
    -- ホームの長さ（連結している編成もふくめて）
    if stop and r.kind = 'rail' then
      flen := coalesce((perf ->> 'len')::real, 0) + coalesce((select sum((c ->> 'len')::real) from jsonb_array_elements(cx) c
                                                              where (c ->> 'v')::boolean and (c ->> 'ka')::int <= k and k <= (c ->> 'kb')::int), 0);
      if flen > st.plat then ws := ws || format('%s のホーム（%sm）より編成（%sm）が長いです', st.name, st.plat, flen); end if;
    end if;
    sc := sc || jsonb_build_array(jsonb_build_array(r.stops[i], arr, dep, trk));
    if dep is not null then t := dep; end if;
    lastStop := i;
  end loop;
  -- 連結の時刻（つなぐ駅を出る時刻・切りはなす駅に着く時刻）
  cx := coalesce((select jsonb_agg((c.v - 'cp' - 'ka' - 'kb') || jsonb_build_object(
          'ta', (select (s.v ->> 2)::int from jsonb_array_elements(sc) with ordinality s(v, so) where (s.v ->> 0)::bigint = (c.v ->> 'a')::bigint order by s.so limit 1),
          'tb', (select (s.v ->> 1)::int from jsonb_array_elements(sc) with ordinality s(v, so) where (s.v ->> 0)::bigint = (c.v ->> 'b')::bigint order by s.so desc limit 1)) order by c.o)
        from jsonb_array_elements(cx) with ordinality c(v, o)), '[]'::jsonb);
  return jsonb_build_object('sc', sc, 'ws', to_jsonb(ws), 'cx', cx);
end $$;

create or replace function public.mp_sta_trk(p_sta bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); st mp_stations;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_sta;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  return jsonb_build_object('id', st.id, 'name', st.name, 'tracks', st.tracks, 'trk', _mp_sta_trk(st), 'custom', st.trk is not null, 'mine', _mp_mine(u, st.own_u, st.own_c), 'pf', st.pf,   -- pf：ホームの形（DB の更新107）
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb) from mp_routes r where st.id = any(r.stops)),
    'kinds', (select coalesce(jsonb_agg(q.kind order by q.p, q.kind), '[]'::jsonb) from (select t.kind, min(_mp_kprio(r.own_u, r.own_c, t.kind)) p
                from mp_trains t join mp_routes r on r.id = t.route where st.id = any(r.stops) group by t.kind limit 40) q),   -- この駅を通る列車の種別（DB の更新115）
    'memo', st.memo);
end $$;

create or replace function public.mp_sta_trk_set(p_sta bigint, p_trk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; v jsonb; nv jsonb := '[]'::jsonb; rr bigint; st2 mp_stations; zk jsonb; zx text;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_sta for update;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  st2 := st; st2.trk := null;
  if p_trk is not null then
    if jsonb_typeof(p_trk) <> 'array' or jsonb_array_length(p_trk) <> greatest(st.tracks, 1) then raise exception '番線の数があっていません'; end if;
    for v in select x from jsonb_array_elements(p_trk) x loop
      if not (v ->> 'd' in ('down', 'up', 'both') and v ->> 'm' in ('main', 'side', 'pass')) then raise exception '番線の使いかたがちがいます'; end if;   -- pass：通過線（t62）
      -- 優先する種別（DB の更新115）：8つまで・1つ 12文字まで。同じものは1つに
      zk := '[]'::jsonb;
      if jsonb_typeof(v -> 'k') = 'array' then
        for zx in select distinct on (btrim(y)) btrim(y) from jsonb_array_elements_text(v -> 'k') y where btrim(y) <> '' loop
          if char_length(zx) > 12 or zx ~ '[[:cntrl:]]' then raise exception '種別の名前は12文字までです'; end if;
          zk := zk || to_jsonb(zx);
        end loop;
        if jsonb_array_length(zk) > 8 then raise exception '優先する種別は 番線ごとに8つまでです'; end if;
      end if;
      nv := nv || jsonb_build_array(jsonb_build_object('d', v ->> 'd', 'm', v ->> 'm') || case when jsonb_array_length(zk) > 0 then jsonb_build_object('k', zk) else '{}'::jsonb end);
    end loop;
    -- 止まる列車のために、下り・上りそれぞれ、ホームのある番線（通過線でない）がいる
    if not exists (select 1 from jsonb_array_elements(nv) zv where zv ->> 'd' in ('down', 'both') and zv ->> 'm' <> 'pass') then raise exception '下りの列車が止まれる番線（ホームのある番線）がありません'; end if;
    if not exists (select 1 from jsonb_array_elements(nv) zv where zv ->> 'd' in ('up', 'both') and zv ->> 'm' <> 'pass') then raise exception '上りの列車が止まれる番線（ホームのある番線）がありません'; end if;
    if st.pf is not null and _mp_pf_err(st.pf, nv, greatest(st.tracks, 1)) is not null then raise exception '%（ホームの形も いっしょに変えてください）', _mp_pf_err(st.pf, nv, greatest(st.tracks, 1)); end if;   -- DB の更新107
  end if;
  update mp_stations set trk = case when p_trk is null then null else nv end,
         pf = case when p_trk is null and st.pf is not null and _mp_pf_err(st.pf, _mp_sta_trk(st2), greatest(st.tracks, 1)) is not null then null else st.pf end where id = p_sta;   -- いつもの決まりにもどして ホームの形とあわなければ おまかせに（DB の更新107）
  for rr in select r.id from mp_routes r where p_sta = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_sta, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'trk', (select _mp_sta_trk(s) from mp_stations s where s.id = p_sta));
end $$;

create or replace function public.mp_area(p_x0 int, p_y0 int, p_x1 int, p_y1 int, p_lod int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b box; r jsonb; me_cs int[]; adm boolean;
begin
  perform _mp_ok(u);
  if p_x1 - p_x0 > 6000 or p_y1 - p_y0 > 6000 then raise exception '範囲が広すぎます'; end if;
  if p_lod = 0 and (p_x1 - p_x0) * (p_y1 - p_y0) > 360000 then p_lod := 1; end if;
  b := box(point(p_x0, p_y0), point(p_x1, p_y1));
  me_cs := array(select id from companies where owner = u);
  adm := _is_admin(u);   -- 国の駅・車両基地・系統は、管理者のもの（DB の更新101）
  select jsonb_build_object(
    'segs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(_mp_thin(s.pts, case p_lod when 0 then 1 when 1 then 3 when 2 then 8 else 16 end)), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
                  'o', case when s.gov then 'gov' when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.gov and _is_admin(u)), 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1),
                  'ctl', case when s.own_u = u or s.own_c = any(me_cs) or (s.gov and _is_admin(u)) then to_jsonb(s.ctl) end)
                  || case when s.snowp > 0 then jsonb_build_object('sp', s.snowp) else '{}'::jsonb end
                  || case when s.prof is not null and p_lod <= 1 then jsonb_build_object('pf', to_jsonb(s.prof), 'st', s.st) else '{}'::jsonb end   -- 高さ（t108）
                  || case when s.rack then jsonb_build_object('rk', 1) else '{}'::jsonb end || case when s.hm is not null then jsonb_build_object('hm', s.hm) else '{}'::jsonb end
                  || case when s.hopt is not null then jsonb_build_object('ho', s.hopt) else '{}'::jsonb end   -- 高さの数値（DB の更新84）
                  || case when s.sig > 0 then jsonb_build_object('sg', s.sig) else '{}'::jsonb end   -- 信号の段（DB の更新85）
                  || case when s.quad then jsonb_build_object('q', 1) else '{}'::jsonb end   -- 複々線（DB の更新86）
                  || case when s.elec and s.ps > 0 then jsonb_build_object('ps', s.ps) else '{}'::jsonb end   -- 電化方式（DB の更新87）
                  || case when s.kind = 'rail' and (s.gauge <> 1067 or s.g2 is not null or s.slp <> 0 or (s.elec and s.cat <> 0) or s.nw <> 0)
                          then jsonb_strip_nulls(jsonb_build_object('ga', nullif(s.gauge, 1067), 'g2', s.g2, 'sl', nullif(s.slp, 0), 'ct', case when s.elec then nullif(s.cat, 0) end, 'nw', nullif(s.nw, 0)))
                          else '{}'::jsonb end   -- 線路の規格（DB の更新99）
                  || case when s.kind = 'rail' and s.elec then jsonb_strip_nulls(jsonb_build_object('fd', _mp_feed(s.id))) else '{}'::jsonb end), '[]'::jsonb)   -- 電気をとどける変電所（DB の更新89）
               from mp_segs s where s.bb && b and (p_lod = 0 or s.kind = 'rail' or s.cls in ('exp', 'nat', 'pref') or (p_lod = 1 and s.art))
                 and (p_lod < 2 or s.kind = 'rail' or s.cls in ('exp', 'nat'))
                 and (p_lod < 3 or s.kind = 'rail' or s.cls = 'exp')),   -- lod 3（とても遠く。t108）：線路と高速だけ
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'k', n.kind, 'x', n.x, 'y', n.y, 'n', n.name, 'nk', n.nk)), '[]'::jsonb)
               from mp_nodes n where p_lod < 3 and (n.name is not null or p_lod = 0) and n.x between p_x0 * 100 and p_x1 * 100 and n.y between p_y0 * 100 and p_y1 * 100
                 and (n.name is not null or exists (select 1 from mp_segs s where s.n0 = n.id and not s.gov) or exists (select 1 from mp_segs s where s.n1 = n.id and not s.gov))),
    'stas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'seg', s.seg, 'at', s.at, 'x', s.x, 'y', s.y, 'a', s.ang, 'pl', s.plat, 'tr', s.tracks, 'n', s.name, 'ln', s.lend, 'b', s.bld,
                  'tk', case when s.kind = 'rail' then _mp_sta_trk(s) end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.own_u is null and s.own_c is null and adm), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))
                  || case when s.melt then jsonb_build_object('ml', 1) else '{}'::jsonb end
                  || case when s.pf is not null then jsonb_build_object('pf', s.pf) else '{}'::jsonb end   -- ホームの形（DB の更新107）
                  || case when s.memo is not null then jsonb_build_object('mm', s.memo) else '{}'::jsonb end   -- 直通の会社へのメモ（DB の更新115）
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld, 'st', d.sta,   -- st：留置線の駅（DB の更新105）
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false) or (d.own_u is null and d.own_c is null and adm)) || case when d.plows > 0 then jsonb_build_object('pw', d.plows) else '{}'::jsonb end), '[]'::jsonb)
               from mp_depots d where d.x between (p_x0 - 13) * 100 and (p_x1 + 13) * 100 and d.y between (p_y0 - 13) * 100 and (p_y1 + 13) * 100 and p_lod < 2),
    -- 航路（t54o）：海の上の折れ線（区間ごと。1/100 マス）
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'k', r.kind, 'c', r.color, 'n', r.name, 'ok', r.ok, 'mine', coalesce(r.own_u = u or r.own_c = any(me_cs), false) or (r.own_u is null and r.own_c is null and adm),
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
    -- 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている部屋の割合（%）, 1 他人・2 自分・3 国, 見た目（1〜10。null は自動）, 向き（0〜345度。null は自動）,
    --        1階のお店の看板の色（部屋の番号の順に [c1, c2, c3] か null。どれも決めていなければ null）]（DB の更新103）
    'blds', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(b.id, b.parcel, b.kind, b.floors, to_jsonb(b.cells), b.name,
                  (select round(100.0 * count(*) filter (where x.t_kind is not null or x.mode = 'self') / greatest(count(*), 1)) from mp_units x where x.bld = b.id),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end, b.look, b.rot,
                  (select case when bool_or(x.sc is not null) then jsonb_agg(to_jsonb(x.sc) order by x.no) end from mp_units x where x.bld = b.id and x.floor = 1 and x.use = 'shop'))), '[]'::jsonb)
               from mp_blds b join mp_parcels pa on pa.id = b.parcel where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    -- 小物（DB の更新103）：[id, 種類, x, y（1/100 マス）, 向き, 色, 1 自分の]
    'props', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(pr.id, pr.kind, pr.x, pr.y, pr.rot, pr.col,
                  case when (pa.gov and adm) or coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 1 else 0 end)), '[]'::jsonb)
               from mp_props pr join mp_parcels pa on pa.id = pr.parcel where pr.x >= p_x0 * 100 and pr.x < p_x1 * 100 and pr.y >= p_y0 * 100 and pr.y < p_y1 * 100) end,
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
    -- アトラクション（DB の更新91）：[id, 建物, 種類, x, y（マス）]
    'attrs', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(a.id, a.bld, a.kind, round(a.x::numeric, 2), round(a.y::numeric, 2))), '[]'::jsonb)
               from mp_attrs a where a.x between p_x0 - 2 and p_x1 + 2 and a.y between p_y0 - 2 and p_y1 + 2) end,
    -- 変電所（DB の更新89）：[id, 場所, 名前, 方式, 大きさ, 容量, 負荷, 止まっている, 自分の, 持ち主のキー]
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', ss.id, 'x', ss.x, 'y', ss.y, 'n', ss.name, 'ps', ss.ps, 'sz', ss.sz, 'cap', ss.cap, 'ld', ss.load,
                  'tr', coalesce(ss.trip > now(), false), 'mine', coalesce(ss.own_u = u or ss.own_c = any(me_cs), false) or (ss.gov and _is_admin(u)),
                  'o', case when ss.gov then 'gov' when ss.own_u is not null then 'u:' || ss.own_u else 'c:' || ss.own_c end)), '[]'::jsonb)
               from mp_subs ss where p_lod < 2 and ss.x between (p_x0 - 3) * 100 and (p_x1 + 3) * 100 and ss.y between (p_y0 - 3) * 100 and (p_y1 + 3) * 100),
    -- 地下街（DB の更新109）：[id, 駅, 点（1/100 マス）, 名前, 自分の]
    'ugm', (select coalesce(jsonb_agg(jsonb_build_array(g.id, g.sta, to_jsonb(g.pts), g.name, coalesce(g.own_u = u or g.own_c = any(me_cs), false))), '[]'::jsonb)
               from mp_ugm g where p_lod < 2 and g.bb && box(point(p_x0 - 1, p_y0 - 1), point(p_x1 + 1, p_y1 + 1))),
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1, 'park2', 1, 'spec', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）・park2：テーマパークとアトラクション（DB の更新91）
  return r;
end $$;

create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean; zlp int[];
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  zlp := _mp_leg_pw(r);   -- 線の電化（DB の更新106）
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'mine', mine, 'gov', r.own_u is null and r.own_c is null, 'ok', r.ok, 'why', r.why, 'dwell', r.dwell,
    'owner', _mp_pname(r.own_u, r.own_c, false), 'timing', to_jsonb(r.timing), 'last', r.last, 'xwait', r.xwait,
    -- 支線（DB の更新70）：本線と、この系統から分かれる支線（jct：分かれる駅）
    'parent', (select jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'jct', (select coalesce(jsonb_agg(distinct s.name), '[]'::jsonb) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid
                       where z.sid = any(p.stops) and (not (r.stops[z.o - 1] = any(p.stops)) or not (r.stops[z.o + 1] = any(p.stops))))) from mp_routes p where p.id = r.parent),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'color', b.color, 'jct', (select coalesce(jsonb_agg(distinct s.name), '[]'::jsonb) from unnest(b.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid
                       where z.sid = any(r.stops) and (not (b.stops[z.o - 1] = any(r.stops)) or not (b.stops[z.o + 1] = any(r.stops))))) order by b.id), '[]'::jsonb)
                   from mp_routes b where b.parent = r.id),
    'undo', case when mine then (select jsonb_build_object('what', h.what, 'at', h.at, 'n', (select count(*) from mp_dia_hist x where x.route = r.id))
                                   from mp_dia_hist h where h.route = r.id order by h.id desc limit 1) end,
    -- 列車に入れられる運用（持ち主の、同じ種類の運用）
    'ops', case when mine then (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'num', o.num, 'form', o.form, 'fname', f.name,
                                   'n', (select count(*) from mp_cars c where c.form = o.form)) order by o.num), '[]'::jsonb)
                                  from mp_ops o left join mp_forms f on f.id = o.form
                                 where o.own_u is not distinct from r.own_u and o.own_c is not distinct from r.own_c and o.kind = r.kind) end,
    'today', _mp_today(), 'ord', true,   -- 運転整理（DB の更新100）
    'stops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'tracks', s.tracks, 'plat', s.plat, 'trk', _mp_sta_trk(s), 'x', s.x, 'y', s.y)
                               || case when s.memo is not null then jsonb_build_object('mm', s.memo, 'mo', _mp_pname(s.own_u, s.own_c, s.own_u is null and s.own_c is null)) else '{}'::jsonb end   -- 駅のメモと 駅の持ち主（DB の更新115）
                               order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats, 'hpat', case when mine then r.hpat end, 'agrp', case when mine then r.agrp end,   -- agrp：運用の あてる先（DB の更新106）   -- hpat：1時間の型（DB の更新104）
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
                 'lay', t.lay,   -- 折り返しを待つ（DB の更新105）
                 'lpw', case when jsonb_array_length(t.sched) > 1 then _mp_train_lpw(r.stops, zlp, t.dir, (t.sched -> 0 ->> 0)::bigint, (t.sched -> (jsonb_array_length(t.sched) - 1) ->> 0)::bigint) end,   -- 走る線の電化（DB の更新106）
                 'fser', fi.ser, 'fn', fi.n, 'fpw', case when fi.n > 0 then case when fi.fel then coalesce(fi.fps, 0) else 0 end end,   -- 編成の電化方式（DB の更新104：0 非電化・1 直流・2 交流50Hz・4 交流60Hz を足したもの。null は編成なし）   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk,   -- 編成の工事中（DB の更新60）
                 'sub', (select jsonb_agg(jsonb_build_array(s.day, extract(epoch from s.t0)::bigint, sf.name) order by s.t0) from mp_subst s join mp_forms sf on sf.id = s.sub
                          where s.train = t.id and s.t1 > now() - interval '1 day')   -- 予備編成の代走（DB の更新80）：［運行日, 発車, 予備編成］
               ) || case when fi.fm is not null then jsonb_build_object('fm', fi.fm) else '{}'::jsonb end   -- fm：モデルのある系列の編成の形式（下り方から［形式, 役割, 向き］。DB の更新107）
               order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk,
                                                          bool_or(ty.elec) fel, bit_and(ty.ps::int) filter (where ty.elec) fps,
                                                          case when bool_or(se.mdl is not null) then jsonb_agg(jsonb_build_array(ty.label, ty.role, ty.face) order by c.pos) end fm   -- 3D のモデル（DB の更新107）
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;

-- 駅の 直通の会社へのメモ（DB の更新115）：200文字まで（空で消す）。だれでも見られる（地図の駅・系統の駅）。
--   書くと、この駅を通る ほかの名義の系統の持ち主に しらせる（同じ駅は 10分に1回まで）
create or replace function public.mp_sta_memo_set(p_sta bigint, p_memo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; zm text; zq record; zn int := 0; zw uuid;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_sta for update;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  zm := nullif(btrim(regexp_replace(coalesce(p_memo, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  if char_length(coalesce(zm, '')) > 200 then raise exception 'メモは200文字までです'; end if;
  if zm is not distinct from st.memo then return jsonb_build_object('ok', true, 'memo', zm, 'told', 0); end if;
  update mp_stations set memo = zm, memo_at = case when zm is not null and (st.memo_at is null or st.memo_at < now() - interval '10 minutes') then now() else memo_at end where id = p_sta;
  if zm is not null and (st.memo_at is null or st.memo_at < now() - interval '10 minutes') then
    for zq in select distinct r.own_u, r.own_c from mp_routes r
               where p_sta = any(r.stops) and not (r.own_u is not distinct from st.own_u and r.own_c is not distinct from st.own_c) and (r.own_u is not null or r.own_c is not null) loop
      zw := coalesce(zq.own_u, (select owner from companies where id = zq.own_c));
      if zw is null or zw = u then continue; end if;
      perform _notice_l(zw, format('【国土】駅「%s」（%s）に 直通の会社へのメモがあります：「%s」', st.name, _mp_pname(st.own_u, st.own_c, st.own_u is null and st.own_c is null), zm),
        jsonb_build_object('go', 'map', 'k', 'bldAt', 'cx', floor(st.x / 20.0)::int, 'cy', floor(st.y / 20.0)::int), null);
      zn := zn + 1;
    end loop;
  end if;
  perform _mp_chg('sta', p_sta, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'memo', zm, 'told', zn);
end $$;
revoke all on function public.mp_sta_memo_set(bigint, text) from public, anon;
grant execute on function public.mp_sta_memo_set(bigint, text) to authenticated;

-- 時刻を組みなおすので 20秒まで（作りなおすと消えるので もういちど）
alter function public.mp_sta_trk_set(bigint, jsonb) set statement_timeout = '20s';
