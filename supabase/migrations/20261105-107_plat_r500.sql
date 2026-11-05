-- DB の更新107：ホームの形（島式・相対式・島式＋相対式・頭端式）・500形（管理者だけ・3D のモデル）
--   駅ごとに、番線のあいだ（両はしも）の どこに ホームがあるか（pf）。番線は 駅の向きの左から 1番線・2番線…（地図と同じ）
--   ホームの形と 番線の使いかた（下り・上り／本線・待避線・通過線）を いっしょに決める（mp_sta_pf_set）。地図（mp_area）と 発着番線（mp_sta_trk）に pf
--   まえからの まちがい：発着番線を決める（mp_sta_trk_set）が「v があいまい」で 決められなかったのを直す
--   系列に adm（管理者だけ：ためし）・mdl（3D のモデル）。風の芽製作所 500形（Mc・Tc・Tcg）を 管理者だけ 注文できるように。
--   系統と列車（mp_dia）に、モデルのある系列の編成の形式（fm：下り方から［形式, 役割, 向き］）
alter table public.mp_series add column if not exists adm boolean not null default false;   -- 管理者だけ（ためし。DB の更新107）：ほかの人の注文の一覧に出さない
alter table public.mp_series add column if not exists mdl text;   -- 3D のモデル（map/m3car.js のキー。DB の更新107）
alter table public.mp_stations add column if not exists pf text;   -- ホームの形（DB の更新107）：番線のあいだ（両はしも）ごとに P（ホーム）・-（なし）。はじめの T は頭端式。null は おまかせ

-- 風の芽製作所 500形（DB の更新107。管理者だけ：ためし）：18m・2ドア・ワンマン対応・貫通形の地方用電車。直流
insert into public.mp_series(code, name, kind, note, ord, grp, yr, sets, adm, mdl) values
  ('R500', '500形', 'emu', '風の芽製作所の 地方用電車（18m・2ドア・ワンマン対応・貫通形・VVVF・直流）。最高110km/h・セミクロスシート・冷房。Mc＋Tc の2両で1組。4・6両は 半室グリーンの Tcg 入り', 160, null, null,
   '[{"n":"2両","t":["R500-Mc","R500-Tc"]},{"n":"4両（半室グリーン）","t":["R500-Mc","R500-Tc","R500-Mc","R500-Tcg"]},{"n":"6両（半室グリーン）","t":["R500-Mc","R500-Tc","R500-Mc","R500-Tc","R500-Mc","R500-Tcg"]}]'::jsonb, true, 'r500')
on conflict (code) do nothing;
insert into public.mp_types(code, series, label, role, face, num_from, num_to, len, cap, seats, mass, power, panto, cab, vmax, acc, dec, elec, heat, ac, toilet, price, upkeep, life, note, ord, nbase, cls, rooms, fn, npad, ps, gauge) values
  ('R500-Mc', 'R500', 'Mc500', 'Mp', '奇数向き', 501, 549, 18.0, 128, 44, 35.5, 520, 1, true, 110, 3.0, 4.2, true, true, true, false, 56000000, 14000, 365, '電動車（運転台・シングルアームパンタ・VVVF 130kW×4）。車いすスペースあり。501〜', 4100, 'Mc', '', 0, '{}', 3, 1, 1067),
  ('R500-Tc', 'R500', 'Tc500', 'Tc', '偶数向き', 551, 579, 18.0, 130, 46, 30.5, 0, 0, true, 110, 3.0, 4.2, true, true, true, false, 44000000, 11000, 365, '制御車（運転台・SIV・CP・蓄電池）。551〜', 4110, 'Tc', '', 0, '{}', 3, 1, 1067),
  ('R500-Tcg', 'R500', 'Tcg500', 'Tc', '偶数向き', 581, 599, 18.0, 72, 40, 31.5, 0, 0, true, 110, 3.0, 4.2, true, true, true, false, 52000000, 13000, 365, '制御車・半室グリーン（運転台がわの半分が 2＋2 のリクライニング席。ゲームでは グリーン車）。4・6両の 最後に。581〜', 4120, 'Tcg', 'G', 0, '{}', 3, 1, 1067)
on conflict (code) do nothing;

-- ホームの形をしらべる（DB の更新107）：pf と 番線の使いかた trk（番線の数 n）。まちがいの文か null（よい）
--   ホームのない番線は 通過線だけ。となりが 通過線だけの ホームは つくらない
create or replace function public._mp_pf_err(p_pf text, p_trk jsonb, p_n int) returns text
language plpgsql immutable as $$
declare zg text; zk int;
begin
  if p_pf is null then return null; end if;
  zg := case when left(p_pf, 1) = 'T' then substr(p_pf, 2) else p_pf end;
  if zg !~ '^[P-]+$' or length(zg) <> p_n + 1 then return 'ホームの形が読めません（番線の数とあっていません）'; end if;
  if position('P' in zg) = 0 then return 'ホームが1つもありません'; end if;
  for zk in 1..p_n loop
    if coalesce(p_trk -> (zk - 1) ->> 'm', 'main') <> 'pass' and substr(zg, zk, 1) <> 'P' and substr(zg, zk + 1, 1) <> 'P' then
      return format('%s番線にホームがありません（ホームのない番線は 通過線にしてください）', zk);
    end if;
  end loop;
  for zk in 1..p_n + 1 loop
    if substr(zg, zk, 1) = 'P' and not ((zk > 1 and coalesce(p_trk -> (zk - 2) ->> 'm', 'main') <> 'pass') or (zk <= p_n and coalesce(p_trk -> (zk - 1) ->> 'm', 'main') <> 'pass')) then
      return 'となりが通過線だけのホームがあります（そのホームは なくしてください）';
    end if;
  end loop;
  return null;
end $$;

create or replace function public.mp_sta_trk_set(p_sta bigint, p_trk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; v jsonb; nv jsonb := '[]'::jsonb; rr bigint; st2 mp_stations;
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
      nv := nv || jsonb_build_array(jsonb_build_object('d', v ->> 'd', 'm', v ->> 'm'));
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

-- ホームの形を決める（DB の更新107）：p_pf（null は おまかせ）と 番線の使いかた p_trk（null は いまのまま）。この駅を通る系統の時刻を計算しなおす
create or replace function public.mp_sta_pf_set(p_sta bigint, p_pf text, p_trk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; zt jsonb; ze text;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_sta for update;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  if p_pf is not null and length(p_pf) > 12 then raise exception 'ホームの形が読めません'; end if;
  if p_trk is not null then
    update mp_stations set pf = null where id = p_sta;   -- 番線の使いかたは 新しいホームの形で しらべる
    perform mp_sta_trk_set(p_sta, p_trk);
    select * into st from mp_stations where id = p_sta;
  end if;
  zt := _mp_sta_trk(st);
  ze := _mp_pf_err(p_pf, zt, greatest(st.tracks, 1));
  if ze is not null then raise exception '%', ze; end if;
  update mp_stations set pf = p_pf where id = p_sta;
  perform _mp_chg('sta', p_sta, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'pf', p_pf, 'trk', zt);
end $$;

create or replace function public.mp_sta_trk(p_sta bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); st mp_stations;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_sta;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  return jsonb_build_object('id', st.id, 'name', st.name, 'tracks', st.tracks, 'trk', _mp_sta_trk(st), 'custom', st.trk is not null, 'mine', _mp_mine(u, st.own_u, st.own_c), 'pf', st.pf,   -- pf：ホームの形（DB の更新107）
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb) from mp_routes r where st.id = any(r.stops)));
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
  for rr in select r.id from mp_routes r where p_id = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_id, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'cost', addc, 'plat', p_plat, 'tracks', p_tracks);
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1, 'park2', 1, 'spec', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）・park2：テーマパークとアトラクション（DB の更新91）
  return r;
end $$;

-- 系列を 注文の一覧に出すか（DB の更新107）：管理者だけ（adm）の系列は 管理者だけ
create or replace function public._mp_type_vis(p_series text, u uuid) returns boolean
language sql stable set search_path = public as $$
  select not coalesce((select s.adm from mp_series s where s.code = p_series), false) or _is_admin(u)
$$;

create or replace function public.mp_boot() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); r jsonb;
begin
  perform _mp_ok(u);
  select jsonb_build_object(
    'me', u, 'admin', _is_admin(u),
    'as', jsonb_build_array(jsonb_build_object('as', 'me', 'name', (select nickname from profiles where id = u) || '（自分）', 'k', 'u:' || u))
          || coalesce((select jsonb_agg(jsonb_build_object('as', c.cid, 'name', c.name, 'k', 'c:' || c.id) order by c.id) from companies c where c.owner = u and c.status = 'active'), '[]'::jsonb)
          || case when _is_admin(u) then jsonb_build_array(jsonb_build_object('as', 'gov', 'name', '国（役所）', 'k', 'gov')) else '[]'::jsonb end,
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from mp_types t where t.on_sale and _mp_type_vis(t.series, u)),   -- 管理者だけの系列（DB の更新107）
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ord), '[]'::jsonb) from mp_series s where not s.adm or _is_admin(u)),
    'rates', (select jsonb_object_agg(k, _mp_rate(k)) from unnest(array['rail','road','dbl_mul','elec','sta_base','sta_m','stop','dep_S','dep_M','dep_L','bdep_S','bdep_M',
              'lease','lease_gov','fare_base','fare_km','bus_fare','bus_km','catch_rail','catch_bus','max_tiles','up_rail','up_road','up_sta','up_stop','up_dep','up_bdep','prop_tax','urb_k','urb_sta']) k),
    'ver', coalesce((select max(ver) from mp_changes), 0),
    'world', _mp_world(),
    'bld', _mp_bld_presets(), 'goods', _mp_goods(), 'sck', _mp_sc_kinds(), 'rcp', _mp_sc_recipes(),
    'scr', jsonb_build_object('rc_m2', _mp_rate('rc_m2'), 'rd_m2', _mp_rate('rd_m2'), 'rc_parts', _mp_rate('rc_parts'), 'imp', _mp_rate('sc_imp'), 'mkt', _mp_rate('sc_mkt'), 'trk', _mp_rate('trk_tkm'), 'sy_tpd', _mp_rate('sy_tpd')), 'zr', (select jsonb_object_agg(z, _mp_zone_rule(z)) from unnest(array['a','b','c','d','e','f','g','h','i']) z),
    'home', (select jsonb_build_object('text', _mp_home_text(h), 'x', h.x, 'y', h.y, 'bld', h.bld) from mp_homes h where h.u = _me())) into r;
  return r;
end $$;

create or replace function public.mp_cars_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return jsonb_build_object(
    'cars', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'num', c.num, 'role', t.role, 'face', t.face, 'label', t.label, 'depot', c.depot, 'form', c.form, 'pos', c.pos,
               'cond', round(c.cond::numeric), 'heat', c.heat, 'ac', c.ac, 'toilet', c.toilet, 'snow', c.snow, 'renewed', c.renewed,
               'age', floor(extract(epoch from now() - c.born) / 86400), 'life', t.life,
               'busy', case when c.busy_until > now() then c.busy_kind end, 'until', case when c.busy_until > now() then c.busy_until end, 'price', c.price,
               'xfer', exists (select 1 from mp_xfers x where x.st = 'offer' and c.id = any(x.cars)),
               'tmp', case when c.form is not null then c.tmp_until end)   -- 期間つき増結：入れ替え枠にもどる時刻（DB の更新80）
               order by c.depot, c.form nulls last, c.pos, c.num), '[]'::jsonb)
             from mp_cars c join mp_types t on t.code = c.type where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'depot', f.depot, 'perf', _mp_form_perf(f.id),
               'trains', (select count(*) from mp_trains tr where tr.form = f.id),
               'op', (select jsonb_build_object('id', o.id, 'num', o.num) from mp_ops o where o.form = f.id),
               'xfer', (select x.id from mp_xfers x where x.form = f.id and x.st = 'offer' limit 1),
               -- 予備編成（DB の更新80）：subn 予備として代走する回・subby この編成のかわりに予備編成が走る回（これからのもの）
               'spare', f.spare, 'subn', (select count(*) from mp_subst s where s.sub = f.id and s.t1 > now()), 'subby', (select count(*) from mp_subst s where s.orig = f.id and s.t1 > now())) order by f.name), '[]'::jsonb)
             from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'cap', d.cap, 'x', d.x, 'y', d.y,
               'n', (select count(*) from mp_cars c where c.depot = d.id), 'plows', d.plows, 'zone', _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int), 'pub', d.own_u is null and d.own_c is null and not pa.gv) order by d.own_u is null and d.own_c is null, d.id), '[]'::jsonb)
             from mp_depots d where d.size not like 'R%' and ((d.own_u is not distinct from pa.pu and d.own_c is not distinct from pa.pc)   -- 留置線は のぞく（DB の更新105）
                                 or (d.kind = 'air' and d.bld is not null and _mp_gov_term(d.bld)))),   -- 国の空港の駐機場（みんなで使う。t54q）
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from mp_types t where t.on_sale and _mp_type_vis(t.series, u)),   -- 管理者だけの系列（DB の更新107）
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ord), '[]'::jsonb) from mp_series s where not s.adm or _is_admin(u)),
    'fsets', _mp_fset_json(u),   -- 編成のプリセット（DB の更新72）
    'lsplit', true);   -- 機関車と客車を別に注文する（DB の更新78）
end $$;

create or replace function public.mp_car_order(p_type text, p_n int, p_depot bigint, p_as text, p_dry boolean, p_maker bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; t mp_types; d mp_depots; have int; k text; s int; i int; nums text[] := '{}'; cost bigint; cid bigint; fid bigint; hrs int; fnm text; mk jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;   -- 同じ名義の操作は1つずつ（車庫の空き・車番がかさならないように。DB の更新60）
  select * into t from mp_types where code = p_type and on_sale and _mp_type_vis(series, u);   -- 管理者だけの系列（DB の更新107）
  if not found then raise exception 'その形式は注文できません'; end if;
  if pa.gv and _mp_role_kind(t.role) <> 'rail' then raise exception '国が持てるのは、鉄道の車両だけです'; end if;   -- 国の鉄道（DB の更新101）
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
  if p_maker is null then perform _mp_pay(pa.pu, pa.pc, pa.gv, cost, 'car', format(case when t.role = 'Ship' then '%s を %s隻 注文' when t.role = 'Air' then '%s を %s機 注文' else '%s を %s両 注文' end, t.label, p_n)); end if;
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

create or replace function public.mp_form_order(p_types text[], p_name text, p_depot bigint, p_as text, p_dry boolean, p_maker bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; d mp_depots; why text; nc int := coalesce(array_length(p_types, 1), 0); have int; k text; t mp_types; i int;
        cnt jsonb := '{}'::jsonb; s int; nums text[] := '{}'; cost bigint := 0; up bigint := 0; fid bigint; nm text := left(trim(coalesce(p_name, '')), 20); hrs int := 6; ky text; vv text; cid bigint;
        mk jsonb; lst bigint := 0;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国も鉄道の編成を持てる（国庫から買う。DB の更新101）
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;   -- 同じ名義の操作は1つずつ（車庫の空き・車番がかさならないように。DB の更新60）
  if nc = 0 then raise exception '形式をえらんでください'; end if;
  if exists (select 1 from unnest(p_types) x where not exists (select 1 from mp_types y where y.code = x and y.on_sale and _mp_type_vis(y.series, u))) then raise exception 'その形式は注文できません'; end if;   -- 管理者だけの系列（DB の更新107）
  if exists (select 1 from unnest(p_types) x join mp_types y on y.code = x where y.role in ('Bus', 'Truck', 'Ship', 'Air')) then raise exception 'バス・トラック・船・飛行機は1台ずつ注文してください'; end if;
  why := _mp_form_rule_s(p_types);   -- 客車だけの編成も注文できる（機関車はあとでつなぐ。DB の更新78）
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
  if p_maker is null then perform _mp_pay(pa.pu, pa.pc, pa.gv, cost, 'car', format('編成「%s」（%s両）を注文', nm, nc)); end if;
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
    'stops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'tracks', s.tracks, 'plat', s.plat, 'trk', _mp_sta_trk(s), 'x', s.x, 'y', s.y) order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
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


revoke all on function public._mp_pf_err(text, jsonb, int) from public, anon, authenticated;
revoke all on function public._mp_type_vis(text, uuid) from public, anon, authenticated;
revoke all on function public.mp_sta_pf_set(bigint, text, jsonb) from public, anon;
grant execute on function public.mp_sta_pf_set(bigint, text, jsonb) to authenticated;
alter function public.mp_sta_pf_set(bigint, text, jsonb) set statement_timeout = '20s';
alter function public.mp_sta_trk_set(bigint, jsonb) set statement_timeout = '20s';
alter function public.mp_sta_resize(bigint, int, int, boolean) set statement_timeout = '20s';
