-- 路線カラー・線路をさがす（2026-10-30）
-- ・線路（mp_segs）に色（color）を足す。持ち主が決めて、だれが見ても地図にその色で出る（お金はかからない）
-- ・新しい関数：mp_seg_color（色をつける）・mp_seg_routes（その線路を通る系統）・mp_seg_find（非電化・単線をさがす）
-- ・変える関数：mp_area・mp_seg_join（色も返す）、_mp_split・_mp_seg_join2（分ける・1本にするとき色をそのまま）
-- ・画面（map.js）は、これを入れたあとに出す（ブランチ next/line-color）。入れるだけなら、いまの画面はそのまま動く

alter table public.mp_segs add column if not exists color text;
create or replace function public._mp_split(sid bigint, s real) returns bigint
language plpgsql set search_path = public as $$
declare sg mp_segs; q record; nid bigint; pa int[]; pb int[]; bid bigint; ta int[]; tb int[]; prev jsonb;
begin
  select * into sg from mp_segs where id = sid for update;
  if s < 0.3 or s > sg.len - 0.3 then raise exception '線のはしの近くでは分けられません'; end if;
  select * into q from _mp_at(sg.pts, s);
  insert into mp_nodes(kind, x, y) values (sg.kind, round(q.x * 100), round(q.y * 100)) returning id into nid;
  pa := _mp_sub(sg.pts, 0, s); pb := _mp_sub(sg.pts, s, sg.len);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then _mp_vlim(_mp_minr(pb)) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color)   -- color：路線カラーもそのまま（2026-10-29）
  returning id into bid;
  update mp_segs set pts = pa, ctl = null, bb = _mp_bb(pa), len = _mp_len(pa), vlim = case when kind = 'rail' then _mp_vlim(_mp_minr(pa)) else vlim end, n1 = nid where id = sid;
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
declare x mp_segs; y mp_segs; nd bigint; xr boolean; yr boolean; px int[]; py int[]; pm int[]; lx real; jl real; n int; d real;
begin
  select * into x from mp_segs where id = xid for update;
  select * into y from mp_segs where id = yid for update;
  if x.id is null or y.id is null or x.id = y.id or x.kind <> 'rail' or y.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  nd := case when x.n1 is not null and x.n1 in (y.n0, y.n1) then x.n1 when x.n0 is not null and x.n0 in (y.n0, y.n1) then x.n0 end;
  if nd is null then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if (select count(*) from mp_segs s where s.n0 = nd or s.n1 = nd) <> 2 then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if not (x.own_u is not distinct from y.own_u and x.own_c is not distinct from y.own_c and x.gov = y.gov) then raise exception 'ほかの会社の線路にはつなげません'; end if;
  if x.dbl <> y.dbl or x.elec <> y.elec then raise exception '単線と複線、電化と非電化がかわるところは、またげません（線路の設定をそろえてください）'; end if;
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
  update mp_segs set pts = pm, ctl = null, bb = _mp_bb(pm), len = _mp_len(pm), vlim = _mp_vlim(_mp_minr(pm)),
                     n0 = case when xr then x.n1 else x.n0 end, n1 = case when yr then y.n0 else y.n1 end,
                     name = case when x.name <> '' then x.name else y.name end, cost = x.cost + y.cost, color = coalesce(x.color, y.color)
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
    'segs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(_mp_thin(s.pts, case p_lod when 0 then 1 when 1 then 3 else 8 end)), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
                  'o', case when s.gov then 'gov' when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.gov and _is_admin(u)), 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1),
                  'ctl', case when s.own_u = u or s.own_c = any(me_cs) or (s.gov and _is_admin(u)) then to_jsonb(s.ctl) end)), '[]'::jsonb)
               from mp_segs s where s.bb && b and (p_lod = 0 or s.kind = 'rail' or s.cls in ('exp', 'nat', 'pref') or (p_lod = 1 and s.art))
                 and (p_lod < 2 or s.kind = 'rail' or s.cls in ('exp', 'nat'))),
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'k', n.kind, 'x', n.x, 'y', n.y, 'n', n.name, 'nk', n.nk)), '[]'::jsonb)
               from mp_nodes n where (n.name is not null or p_lod = 0) and n.x between p_x0 * 100 and p_x1 * 100 and n.y between p_y0 * 100 and p_y1 * 100
                 and (n.name is not null or exists (select 1 from mp_segs s where s.n0 = n.id and not s.gov) or exists (select 1 from mp_segs s where s.n1 = n.id and not s.gov))),
    'stas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'seg', s.seg, 'at', s.at, 'x', s.x, 'y', s.y, 'a', s.ang, 'pl', s.plat, 'tr', s.tracks, 'n', s.name, 'ln', s.lend, 'b', s.bld,
                  'tk', case when s.kind = 'rail' then _mp_sta_trk(s) end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld,
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false))), '[]'::jsonb)
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
               from mp_places p where p.pt <@ b and p.k in ('pref', 'muni', 'ward', 'river', 'spot', 'island') and (p_lod < 2 or p.k in ('pref', 'muni'))),
    -- 町字の名前：[id, 種類, 名前, x, y]（町・大字は lod 1 から、丁目・字は lod 0）
    'chos', (select coalesce(jsonb_agg(jsonb_build_array(m.id, m.kind, m.name, m.x, m.y)), '[]'::jsonb)
               from mp_cho m where m.pt <@ b and m.gone is null and (p_lod = 0 or (p_lod = 1 and m.kind in ('cho', 'oaza')))),
    'names', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
               select distinct 'u:' || pa.own_u k, (select nickname from profiles where id = pa.own_u) v from mp_parcels pa where p_lod = 0 and pa.own_u is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'c:' || pa.own_c, (select name from companies where id = pa.own_c) from mp_parcels pa where p_lod = 0 and pa.own_c is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'u:' || s.own_u, (select nickname from profiles where id = s.own_u) from mp_segs s where s.own_u is not null and s.bb && b
               union select distinct 'c:' || s.own_c, (select name from companies where id = s.own_c) from mp_segs s where s.own_c is not null and s.bb && b) z where v is not null),
    'ver', coalesce((select max(ver) from mp_changes), 0)) into r;
  return r;
end $$;
create or replace function public.mp_seg_join(p_a bigint, p_b bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a mp_segs; me_cs int[]; ch bigint[]; m bigint; i int; s mp_segs;
begin
  perform _mp_ok(u);
  select * into a from mp_segs where id = p_a;
  if not found or a.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(a.own_u = u or a.own_c = any(me_cs), false) then raise exception 'あなたの線ではありません'; end if;
  perform _mp_lock(a.own_u, a.own_c);
  m := p_a;
  if p_b is not null and p_b <> p_a then
    ch := _mp_seg_chain(p_a, p_b);
    if ch is null then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
    for i in 2..array_length(ch, 1) loop m := _mp_seg_join2(m, ch[i]); end loop;
    perform _mp_renet(a.own_u, a.own_c); perform _mp_routes_fix(a.own_u, a.own_c);
  end if;
  select * into s from mp_segs where id = m;
  return jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(s.pts), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
    'o', case when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end, 'mine', true, 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1), 'ctl', to_jsonb(s.ctl));
end $$;
create or replace function public.mp_seg_color(p_id bigint, p_color text, p_all boolean, p_route bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; col text := lower(nullif(trim(coalesce(p_color, '')), '')); x record; n int := 0; rs bigint[];
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  if sg.kind <> 'rail' then raise exception '色をつけられるのは線路だけです'; end if;
  if col is not null and col !~ '^#[0-9a-f]{6}$' then raise exception '色がちがいます（#rrggbb）'; end if;
  if p_route is not null then
    rs := array(select distinct (g ->> 0)::bigint from mp_routes r, jsonb_array_elements(r.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g where r.id = p_route and r.kind = 'rail');
    if not sg.id = any(rs) then raise exception 'この線路を通らない系統です'; end if;
  end if;
  for x in select s.id, s.bb from mp_segs s
            where s.kind = 'rail' and (s.id = sg.id or ((coalesce(p_all, false) and sg.name <> '' and s.name = sg.name or s.id = any(rs))
                  and s.own_u is not distinct from sg.own_u and s.own_c is not distinct from sg.own_c and s.gov = sg.gov))
              and s.color is distinct from col for update loop
    update mp_segs set color = col where id = x.id;
    perform _mp_chg('seg', x.id, 'set', x.bb);   -- 見ている人の地図も読みなおす
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n, 'color', col);
end $$;
create or replace function public.mp_seg_routes(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id;
  if not found or sg.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  return jsonb_build_object(
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'n', r.name, 'c', r.color) order by r.name, r.id), '[]'::jsonb) from mp_routes r
                where r.kind = 'rail' and exists (select 1 from jsonb_array_elements(r.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g where (g ->> 0)::bigint = sg.id)),
    'same', case when sg.name <> '' then (select count(*) from mp_segs s where s.kind = 'rail' and s.name = sg.name and s.own_u is not distinct from sg.own_u and s.own_c is not distinct from sg.own_c and s.gov = sg.gov) else 0 end);
end $$;
create or replace function public.mp_seg_find(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return coalesce((
    with my_r as (select r.name, r.legs from mp_routes r where r.kind = 'rail' and r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc and not pa.gv),
         used as (select (g ->> 0)::bigint sid, array_agg(distinct m.name order by m.name) rn
                    from my_r m, jsonb_array_elements(m.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g group by 1)
    select jsonb_agg(jsonb_build_object('id', s.id, 'n', s.name, 'len', round(s.len::numeric * 50), 'dbl', s.dbl, 'el', s.elec, 'col', s.color,
             'mine', case when pa.gv then s.gov else (not s.gov and s.own_u is not distinct from pa.pu and s.own_c is not distinct from pa.pc) end,
             'own', _mp_pname(s.own_u, s.own_c, s.gov), 'routes', coalesce(to_jsonb(us.rn), '[]'::jsonb),
             'bb', jsonb_build_array(round(((s.bb[1])[0])::numeric, 1), round(((s.bb[1])[1])::numeric, 1), round(((s.bb[0])[0])::numeric, 1), round(((s.bb[0])[1])::numeric, 1)))
             order by s.name, s.id)
      from mp_segs s left join used us on us.sid = s.id
     where s.kind = 'rail' and (not s.dbl or not s.elec)
       and ((case when pa.gv then s.gov else (not s.gov and s.own_u is not distinct from pa.pu and s.own_c is not distinct from pa.pc) end) or us.sid is not null)), '[]'::jsonb);
end $$;
alter function public.mp_seg_join(bigint, bigint) set statement_timeout = '20s';
revoke all on function public.mp_seg_color(bigint, text, boolean, bigint) from public, anon;
grant execute on function public.mp_seg_color(bigint, text, boolean, bigint) to authenticated;
revoke all on function public.mp_seg_routes(bigint) from public, anon;
grant execute on function public.mp_seg_routes(bigint) to authenticated;
revoke all on function public.mp_seg_find(text) from public, anon;
grant execute on function public.mp_seg_find(text) to authenticated;
revoke all on function public._mp_split(bigint, real) from public, anon, authenticated;
revoke all on function public._mp_seg_join2(bigint, bigint) from public, anon, authenticated;
