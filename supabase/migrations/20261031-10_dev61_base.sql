-- 首都まわりの町づくり（t61）：若宮基地の飛行場（国の空港。発着口はぜんぶ国の認可制）と、滑走路2本（滑走路にかかる町の小道だけをこわす）
-- もう飛行場があれば作らない。滑走路が引けないとき（あとから建物などができた）は、引かずに知らせる
do $$
declare bid bigint; sid bigint; r record; q jsonb; rid bigint; n int; nm text; bad int; x0 int; y0 int; x1 int; y1 int;
begin
  select b.id into bid from mp_blds b join mp_parcels p on p.id = b.parcel where p.gov and b.kind = 'airport_m' and b.name = '若宮基地';
  if bid is null then
    begin   -- 土地があいていない（あとから筆・道路などができた）ときは、飛行場を作らずに先へ（2026-10-31 なおし）
      bid := _mp_gov_build(array(select vv from generate_series(840, 874) yy, generate_series(-735, -706) xx, lateral unnest(array[xx, yy]) vv), 'airport_m', 0, 'full', null, '若宮基地');
    exception when others then
      raise warning '若宮基地：飛行場を作れませんでした（%）。飛行場と滑走路は作らずに先へ進みます', sqlerrm;
      return;
    end;
  end if;
  select id into sid from mp_stations where bld = bid and kind = 'air';
  if sid is null then raise warning '若宮基地の乗り場ができませんでした。滑走路は引かずに先へ進みます'; return; end if;
  update mp_slots set lic = true where st = sid and not lic;   -- 発着口はぜんぶ国の認可制（入札に出さない）
  perform _mp_chg('sta', sid, 'set', (select box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3)) from mp_stations s where s.id = sid));
  for r in select * from (values (-15650, 14110, -14690, 19610), (-16550, 14590, -15650, 19690)) v(x0, y0, x1, y1) loop
    if exists (select 1 from mp_rwys w where w.st = sid and w.x0 = r.x0 and w.y0 = r.y0 and w.x1 = r.x1 and w.y1 = r.y1) then continue; end if;
    -- 滑走路にかかる道路：町の小道（国・持ち主なし・駅やバス停なし・系統が通らない）だけなら こわす。ほかの道路がかかっていたら引かない
    create temp table if not exists _rwc (x int, y int) on commit drop; delete from _rwc where true;
    insert into _rwc select * from _mp_rwy_cells(r.x0, r.y0, r.x1, r.y1, 1.2);
    create temp table if not exists _rws (id bigint) on commit drop; delete from _rws where true;
    insert into _rws select distinct s.id from mp_segs s, lateral _mp_line_cells(s.pts, _mp_seg_r(s.kind, s.w, s.dbl)) c
     where s.bb && box(point(least(r.x0, r.x1) / 100.0 - 2, least(r.y0, r.y1) / 100.0 - 2), point(greatest(r.x0, r.x1) / 100.0 + 2, greatest(r.y0, r.y1) / 100.0 + 2))
       and exists (select 1 from _rwc w where w.x = c.x and w.y = c.y);
    select count(*) into bad from _rws w join mp_segs s on s.id = w.id
     where s.kind <> 'road' or not s.gov or s.own_u is not null or s.own_c is not null or s.art or s.cls <> 'lane'
        or exists (select 1 from mp_stations st where st.seg = s.id) or exists (select 1 from mp_depots d where d.seg = s.id)
        or exists (select 1 from mp_routes ro, jsonb_array_elements(coalesce(ro.legs, '[]'::jsonb)) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) gg where (gg ->> 0)::bigint = s.id);
    if bad > 0 then raise warning '若宮基地：滑走路（%）にかかる道路のうち、こわせないものが % 本あるので、引きませんでした', _mp_rwy_name(r.x0, r.y0, r.x1, r.y1), bad; continue; end if;
    for rid in select id from _rws loop perform _mp_seg_remove(rid); end loop;
    q := _mp_rwy_check(r.x0, r.y0, r.x1, r.y1, 1.2);
    if not (q ->> 'ok')::boolean or (q ->> 'sta')::bigint is distinct from sid then
      raise warning '若宮基地：滑走路（%）を引けませんでした（%）', _mp_rwy_name(r.x0, r.y0, r.x1, r.y1), coalesce(q ->> 'msg', '若宮基地からはなれています'); continue;
    end if;
    nm := _mp_rwy_name(r.x0, r.y0, r.x1, r.y1);
    insert into mp_rwys(st, x0, y0, x1, y1, len, w, name, cost) values (sid, r.x0, r.y0, r.x1, r.y1, (q ->> 'len')::int, 1.2, nm, 0) returning id into rid;
    insert into mp_occ(x, y, what, ref) select distinct _mp_t5(c.x), _mp_t5(c.y), 'rwy', rid from _mp_rwy_cells(r.x0, r.y0, r.x1, r.y1, 1.2) c on conflict do nothing;
    perform _mp_air_plat(sid); perform _mp_rwy_names(sid);
    perform _mp_chg('rwy', rid, 'set', (select box(point(least(min(w.x0), min(w.x1)) / 100.0 - 2, least(min(w.y0), min(w.y1)) / 100.0 - 2), point(greatest(max(w.x0), max(w.x1)) / 100.0 + 2, greatest(max(w.y0), max(w.y1)) / 100.0 + 2)) from mp_rwys w where w.st = sid));
  end loop;
  perform _mp_chg('sta', sid, 'set', (select box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3)) from mp_stations s where s.id = sid));
  raise warning '若宮基地：滑走路 % 本・発着口 % こ（ぜんぶ認可制）', (select count(*) from mp_rwys where st = sid), (select count(*) from mp_slots where st = sid);
end $$;
