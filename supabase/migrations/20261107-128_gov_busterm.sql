-- 国のバスターミナル（t70・DB の更新128）：国（管理者）が 道路の上に バスターミナル（国のバス停・のりば 2〜8）を つくれる。
-- 工事費・維持費は なし。はじめから貸し出し（1系統・1日の使用料 ＝ バス停の維持費 × のりばの数。国庫へ。国が あとで変えられる）。
-- ほかの人・会社のバス系統は、使用料で 系統に入れられる（いままでの 貸し出しの バス停と同じ）
create or replace function public.mp_sta_build(p_kind text, p_seg bigint, p_x real, p_y real, p_plat int, p_tracks int, p_name text, p_as text, p_dry boolean, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; span real; tiles int[]; cost numeric; sid bigint; pt record; nm text := left(trim(coalesce(p_name, '')), 20); sub int[];
        pcs int[]; oc int[]; need jsonb; lfee numeric := 0; zp real; zl text;
        zfo boolean := false; zfc jsonb := '[]'::jsonb; zh text;   -- 国の強行（DB の更新116）
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  zfo := pa.gv and p_kind = 'rail' and coalesce(p_force, false);   -- 国の強行（DB の更新116）：ホームのカーブ・ホームにかかる建物でも つくる
  if pa.gv and p_kind not in ('rail', 'bus') then raise exception '国がつくれるのは 鉄道の駅と バスターミナルです'; end if;   -- 国は鉄道の駅（DB の更新101）とバスターミナル（DB の更新128）
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
    span := 0.4; p_plat := 0;
    p_tracks := case when pa.gv then greatest(2, least(8, coalesce(p_tracks, 4))) else 1 end;   -- 国のバスターミナル（DB の更新128）：のりば 2〜8
    select * into pt from _mp_at(sg.pts, s);
    tiles := array[floor(pt.x)::int, floor(pt.y)::int];
    cost := case when pa.gv then 0 else _mp_rate('stop') end;   -- 国の工事は無料
  else raise exception '作るものがちがいます'; end if;
  if p_dry then return jsonb_build_object('cost', round(cost), 'up_day', case when pa.gv then 0 when p_kind = 'rail' then round(_mp_rate('up_sta') * (1 + 0.25 * (p_tracks - 1))) else _mp_rate('up_stop') end,
    'lease', round(lfee), 'need', need, 'zl', zl) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end; end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, round(cost)::bigint, 'sta', format('%s「%s」の工事', case when p_kind = 'rail' then '駅' when pa.gv then 'バスターミナル' else 'バス停' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_stations(kind, seg, at, x, y, ang, plat, tracks, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, round(pt.x * 100), round(pt.y * 100), pt.ang, p_plat, p_tracks, nm, pa.pu, pa.pc, round(cost))
  returning id into sid;
  if pa.gv and p_kind = 'bus' then update mp_stations set lend = round(_mp_rate('up_stop') * p_tracks) where id = sid; end if;   -- 国のバスターミナル：はじめから だれでも 使える（1系統・1日の使用料は国庫へ。DB の更新128）
  perform _mp_occ_set(sid, case when p_kind = 'rail' then 'sta' else 'stop' end, tiles);
  if p_kind = 'rail' then perform _mp_lease_set('sta', sid, pa.pu, pa.pc, pa.gv); end if;
  if p_kind = 'rail' then begin perform _mp_prof_redo(p_seg); exception when others then raise warning 'mp sta level: %', sqlerrm; end; end if;   -- 駅のところを水平に（DB の更新108）
  perform _mp_chg('sta', sid, 'set', box(point(pt.x - 3, pt.y - 3), point(pt.x + 3, pt.y + 3)));
  return jsonb_build_object('id', sid, 'cost', round(cost));
end $$;

