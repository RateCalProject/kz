-- 複々線：線路を「複々線」にできる（急行線と緩行線。工事費は複線の 1.7倍・維持費も多い・はばも広い）。
--   複々線の駅と駅のあいだでは、急行線（優先番号 3 まで：特急・急行・快速）と緩行線（4 から：普通・回送など）の列車は、追いこし・追いこされを見ない（待避しなくてよい）。
--   複々線の中の駅では、急行線の列車は待避線の番線に止まる（3・4番線など）。mp_seg_opts は p_quad をうけとる（前の形は消す）

alter table public.mp_segs add column if not exists quad boolean not null default false;   -- 複々線（DB の更新86）：複線が2つ（急行線と緩行線）。複々線なら dbl も true

-- 線路のはば（複々線。DB の更新86）：線路は w が 0.75 以上（複々線 0.8）なら 1.1 区画
create or replace function public._mp_seg_r(kind text, w real, dbl boolean) returns real
language sql immutable as $$ select greatest(0.5, case when kind = 'rail' then case when w >= 0.75 then 1.1 when dbl then 0.75 else 0.5 end else w * 2.5 end)::real $$;
-- 線路の工事費の倍率（DB の更新86）：単線 1・複線 dbl_mul・複々線 dbl_mul × 1.7
create or replace function public._mp_trmul(dbl boolean, quad boolean) returns numeric
language sql stable as $$ select case when quad then public._mp_rate('dbl_mul') * 1.7 when dbl then public._mp_rate('dbl_mul') else 1 end $$;
-- 系統の駅と駅のあいだ（legs）ごとに、ぜんぶ複々線か（DB の更新86）
create or replace function public._mp_leg_quad(legs jsonb) returns boolean[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(coalesce((select bool_and(s.quad) from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g join mp_segs s on s.id = (g ->> 0)::bigint), false) order by k), '{}')
    from jsonb_array_elements(coalesce(legs, '[]'::jsonb)) with ordinality q(l, k)
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
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color, snowp, prof, st, rack, hm, hopt, sig, quad)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then least(case when sg.rack then 30 else 300 end, _mp_vlim(_mp_minr(pb))) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color,   -- color：路線カラーもそのまま（2026-10-29）
          sg.snowp, fb, _mp_st_of(pb, fb), sg.rack, sg.hm, sg.hopt, sg.sig, sg.quad)   -- 雪よけ・高さ・アプト式もそのまま（t108）。高さの数値も（DB の更新84）・信号の段も（85）
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
  if x.quad <> y.quad then raise exception '複線と複々線がかわるところは、またげません（線路の設定をそろえてください）'; end if;   -- DB の更新86
  if x.sig <> y.sig then raise exception '信号のちがう線路のつなぎ目は、またげません（線路の信号をそろえてください）'; end if;   -- DB の更新85
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
                  || case when s.hopt is not null then jsonb_build_object('ho', s.hopt) else '{}'::jsonb end   -- 高さの数値（DB の更新84）
                  || case when s.sig > 0 then jsonb_build_object('sg', s.sig) else '{}'::jsonb end   -- 信号の段（DB の更新85）
                  || case when s.quad then jsonb_build_object('q', 1) else '{}'::jsonb end), '[]'::jsonb)   -- 複々線（DB の更新86）
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）
  return r;
end $$;

create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
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
  if p_kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if p_kind = 'road' and rmin < 0.7 then raise exception 'カーブがきつすぎます'; end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  if quad then dbl := true; end if;   -- 複々線（DB の更新86）は複線のうち
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
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], ho);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：マスごとに、つくり（地面・高架・トンネル・橋）と地形の倍率 ×（1 ＋ まちの係数）。アプト式は 1.3倍
  base := case when p_kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(cls, ln_) end;
  if not pa.gv then   -- 国の工事は無料（t57b）：工事費の計算もしない
    cost := _mp_st_cost(tiles, ters, _mp_st_tiles(p_pts, pr ->> 'st'), rk, null, false, base, _mp_trmul(dbl, quad), case when elec then _mp_rate('elec') else 0 end);
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
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt, quad)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho, quad)
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
                        _mp_trmul(sg.dbl, sg.quad), case when sg.elec then _mp_rate('elec') else 0 end);
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
    amt := _mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(sg.pts, nw), rk, _mp_st_map(sg.pts, sg.st), sg.rack, base, _mp_trmul(sg.dbl, sg.quad), 0) + scost;
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
                              _mp_trmul(sg.dbl, sg.quad), 0));
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

create or replace function public.mp_seg_sig(p_id bigint, p_sig int, p_chain boolean, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ids bigint[]; amt numeric := 0; s record; a numeric; per jsonb := '{}'::jsonb; rid bigint; nr int := 0; lm real := 0; rts bigint[];
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id;
  if not found or sg.kind <> 'rail' then raise exception '線路が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  if p_sig is null or p_sig not in (0, 1, 2) then raise exception '信号は 自動閉塞・ATC・移動閉塞 からえらんでください'; end if;
  ids := case when coalesce(p_chain, false) then array(select c.id from _mp_chain(p_id) c order by c.ord) else array[p_id] end;
  if not exists (select 1 from mp_segs x where x.id = any(ids) and x.sig <> p_sig) then raise exception 'いまと同じ信号です'; end if;
  if not p_dry then perform _mp_lock(sg.own_u, sg.own_c); end if;
  for s in select x.id, x.len, x.sig, x.gov, x.dbl, x.quad, x.pts from mp_segs x where x.id = any(ids) loop
    lm := lm + s.len;
    a := 0;
    if not s.gov and p_sig > s.sig then
      a := round((case p_sig when 2 then 0.8 when 1 then 0.4 else 0 end - case s.sig when 2 then 0.8 when 1 then 0.4 else 0 end) * _mp_rate('rail')
                 * (coalesce(array_length(_mp_tiles(s.pts), 1), 0) / 2) * _mp_trmul(s.dbl, s.quad));
    end if;
    amt := amt + a; per := per || jsonb_build_object(s.id::text, a);
  end loop;
  rts := array(select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and (g ->> 0)::bigint = any(ids));
  if p_dry then
    return jsonb_build_object('cost', amt, 'segs', array_length(ids, 1), 'm', round((lm * 50)::numeric), 'routes', coalesce(array_length(rts, 1), 0),
      'now', (select jsonb_agg(distinct x.sig) from mp_segs x where x.id = any(ids)));
  end if;
  if amt > 0 then
    perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt::bigint, 'rail', format('線路の信号（%s・%sm）', case p_sig when 2 then '移動閉塞' when 1 then 'ATC' else '自動閉塞' end, round((lm * 50)::numeric)));
  end if;
  update mp_segs x set sig = p_sig, cost = x.cost + coalesce((per ->> x.id::text)::bigint, 0) where x.id = any(ids);
  for s in select x.id, x.bb from mp_segs x where x.id = any(ids) loop perform _mp_chg('seg', s.id, 'set', s.bb); end loop;
  foreach rid in array coalesce(rts, '{}'::bigint[]) loop perform _mp_resched(rid); nr := nr + 1; end loop;
  return jsonb_build_object('cost', amt, 'segs', array_length(ids, 1), 'routes', nr, 'sig', p_sig);
end $$;

create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb; rfid bigint; nsub int; orf real; sb2 bigint;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null then continue; end if;
      dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      -- 編成の工事中（検査・改造・転属・納車）にかかる列車は運休：始発駅を出てから終点に着くまでのどこかが、工事の時間にかかるもの（DB の更新60）
      --   予備編成（DB の更新80）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走。予定は mp_subst）
      rfid := tr.fid;
      if _mp_form_busy(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) then
        begin rfid := _mp_subst_ok(tr.id, d0, tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)); exception when others then rfid := null; end;
        if rfid is not null then perf := _mp_form_perf(rfid); end if;
        if rfid is null or perf is null then nwk := nwk + 1; continue; end if;
        nsub := nsub + 1;
      end if;
      -- 持ち主が運休にした列車（1本ずつ・編成ごと。DB の更新60）
      begin if _mp_cxl_on(tr.id, d0, tr.fid, dep_abs) then ncan := ncan + 1; continue; end if; exception when others then null; end;
      -- 走る区間（途中始発・途中止まり。2026-10-28）：系統のうちの何割を走るか（cf）。本数・定員はその割合で数える
      cf := 1; ia := 1; ib := coalesce(array_length(r.stops, 1), 1);
      if tr.sa is not null or tr.sb is not null then
        ia := _mp_rpos(r.stops, tr.dir, (tr.sched -> 0 ->> 0)::bigint, false); ib := _mp_rpos(r.stops, tr.dir, (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 0)::bigint, true);   -- 環状線
        if ia is not null and ib is not null and km > 0 then
          cf := greatest(0.05, least(1, coalesce((select sum((l.v ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality l(v, lo) where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib)), 0) / 1000 / km));
        else ia := 1; ib := coalesce(array_length(r.stops, 1), 1); end if;
      end if;
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
            where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib) and not (l.v ->> 'e')::boolean) then continue; end if;
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        -- 予備編成（DB の更新82）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走）
        sb2 := case when rfid = tr.fid then _mp_subst_pick(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) end;
        if sb2 is null then
          broke := broke + 1;
          update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
          continue;
        end if;
        insert into mp_subst(train, day, orig, sub, own_u, own_c, t0, t1)
          select tr.id, d0, tr.fid, sb2, f.own_u, f.own_c, to_timestamp(dep_abs), to_timestamp(dep_abs + rt) from mp_forms f where f.id = tr.fid
        on conflict (train, day) do update set orig = excluded.orig, sub = excluded.sub, t0 = excluded.t0, t1 = excluded.t1, made_at = now();
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''),
                                    format('故障のため予備編成「%s」が代走（%s）', (select name from mp_forms where id = sb2), to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        rfid := sb2; perf := _mp_form_perf(sb2); nsub := nsub + 1;
        if perf is null then broke := broke + 1; continue; end if;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）。区間折り返しは走った分だけ（DB の更新82）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800) * coalesce(orf, 1);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = rfid;   -- 代走なら予備編成がいたむ（DB の更新80）
      -- 連結している編成（つなぐ駅から切りはなす駅まで）：その分いたみ、定員は走る時間のわりあいで足す
      ccap := 0;
      for ce in select c.v from jsonb_array_elements(tr.cplx) c(v)
                 where coalesce((c.v ->> 'ok')::boolean, false) and exists (select 1 from mp_ops ox where ox.id = (c.v ->> 'op')::bigint and ox.form = (c.v ->> 'f')::bigint) loop
        cperf := _mp_form_perf((ce ->> 'f')::bigint);
        if cperf is null or _mp_form_busy((ce ->> 'f')::bigint, to_timestamp(dep_abs + coalesce((ce ->> 'ta')::int - tr.dep, 0)), to_timestamp(dep_abs + coalesce((ce ->> 'tb')::int - tr.dep, rt))) then continue; end if;   -- 工事中の編成はつながない（DB の更新60）
        crt := greatest(60, coalesce((ce ->> 'tb')::int - (ce ->> 'ta')::int, rt));
        update mp_cars c set cond = greatest(0, cond - 0.035 * crt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
         where form = (ce ->> 'f')::bigint;
        ccap := ccap + (cperf ->> 'cap')::int * least(1, crt / greatest(rt, 1));
      end loop;
      if ev is not null then dsum := dsum + coalesce((ev ->> 'dly')::float8, 0); nd := nd + 1; end if;   -- 終点での遅れ（秒）
      nrun := nrun + 1;   -- 走った列車（回送・試運転もふくむ。乗り入れの線路使用料。DB の更新60）
      if tr.kind in ('回送', '試運転') then continue; end if;   -- お客は乗せない
      nok := nok + 1; secs := secs + rt / cf;
      if tr.dir = 1 then tph1 := tph1 + cf; cap1 := cap1 + round(((perf ->> 'cap')::int + ccap) * cf)::int; else tph2 := tph2 + cf; cap2 := cap2 + round(((perf ->> 'cap')::int + ccap) * cf)::int; end if;
      acn := acn + case when (perf ->> 'ac')::boolean then 1 else 0 end; htn := htn + case when (perf ->> 'heat')::boolean then 1 else 0 end;
      toil := toil + case when (perf ->> 'toilet')::boolean then 1 else 0 end;
      -- 料金の席と設備（DB の更新72）：グリーン席、夜行の寝台と個室、食堂車・ラウンジ・展望車、荷物車・郵便車（走る km）
      xg := xg + coalesce((perf ->> 'g')::real, 0) * cf;
      if xnight then xa := xa + coalesce((perf ->> 'a')::real, 0) * cf; xb := xb + coalesce((perf ->> 'b')::real, 0) * cf; xrm := xrm + coalesce((perf ->> 'rooms')::real, 0) * cf; end if;
      xdin := xdin + case when (perf ->> 'din')::boolean then 1 else 0 end;
      xlng := xlng + case when (perf ->> 'lng')::boolean or (perf ->> 'obs')::boolean then 1 else 0 end;
      xbag := xbag + coalesce((perf ->> 'bag')::real, 0) * km * cf;
    end loop;
    ran := ran || jsonb_build_object(r.id::text, nrun);
    -- 運休した列車のお客（きのうの同じ時間のお客 × 運休の割合）：振替輸送をたのんでいれば、近くのほかの線へ（精算）
    lost := 0;
    if ncan > 0 then
      lost := coalesce((select x.served from mp_hours x where x.route = r.id and x.hour = date_trunc('hour', h) - interval '1 day'), 0)::real * ncan / (ncan + nok);
      if lost >= 1 and exists (select 1 from mp_unko z where z.furi @> array[r.id] and z.t0 < h and coalesce(z.t_end, now()) > h - interval '1 hour') then
        begin
          perform _mp_unko_furi_pay(r, lost, case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * greatest(1.5, least(15, km * 0.45)) else 0 end);
        exception when others then raise warning 'mp unko furi: %', sqlerrm; end;
      end if;
    end if;
    if nok = 0 then
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'shop', nwk, 'trust', round(r.trust::numeric, 2)) where id = r.id;
      continue;
    end if;
    -- 乗りたい人（この1時間）
    pop := coalesce((select sum(v::text::real) from jsonb_each(catch) e(k, v)), 0);
    -- ほかの系統とのとりあい：駅のまわりに止まる、ほかの系統の本数
    share := coalesce((select avg(1.0 / (1 + coalesce((select count(*) from mp_routes r2 join mp_stations s2 on s2.id = any(r2.stops)
                         where r2.id <> r.id and r2.ok and r2.kind = r.kind and abs(s2.x - s.x) < 1200 and abs(s2.y - s.y) < 1200), 0) * 0.5))
                       from mp_stations s where s.id = any(r.stops)), 1);
    spd := case when secs > 0 then km / greatest(secs / nok / 3600.0, 0.01) else 30 end;
    q := least(1.5, greatest(0.5, spd / 30.0));
    if r.kind = 'ship' then q := case when spd > 40 then 1.3 else 1 end; end if;   -- 船：島へは船しかないので遅くても減らない（高速船は少しふえる。t54o）
    if r.kind = 'air' then q := least(1.0, greatest(0.2, km / 60)); end if;   -- 飛行機：近いところへは鉄道・バスで行く人が多い（60km より短いと減る。t54p）
    comf := 1;
    if mo in (6, 7, 8, 9) then comf := comf * (0.8 + 0.2 * acn / nok); end if;
    if mo in (12, 1, 2) then comf := comf * (0.8 + 0.2 * htn / nok); end if;
    if km > 30 then comf := comf * (0.9 + 0.1 * toil / nok); end if;
    if km > 50 then comf := comf * (1 + 0.05 * xdin / nok + 0.05 * xlng / nok); end if;   -- 食堂車・ラウンジ・展望車のある列車は、長い系統で少し人気（DB の更新72）
    dem := pop * _mp_rate(case r.kind when 'rail' then 'g_rail' when 'ship' then 'g_ship' when 'air' then 'g_air' else 'g_bus' end) * _mp_hourf(hh) * q * comf * share;
    -- 運行の乱れ：遅れが大きいほど お客がへる（平均 10分で 1割・いちばん 3割）。信頼（0.7〜1）もかける
    dem := dem * coalesce(r.trust, 1) * (1 - least(0.3, dsum / greatest(nd, 1) / 60 / 100));
    if r.kind = 'air' then   -- 飛行機：本数が少なくても予約して乗る・座席の数まで（立って乗れない。t54p）
      dem1 := dem / 2 * tph1::real / (tph1 + 0.5); dem2 := dem / 2 * tph2::real / (tph2 + 0.5);
      served := floor(least(dem1, cap1) + least(dem2, cap2));
    else
      dem1 := dem / 2 * tph1::real / (tph1 + 3); dem2 := dem / 2 * tph2::real / (tph2 + 3);
      served := floor(least(dem1, cap1 * 1.5 * 2) + least(dem2, cap2 * 1.5 * 2));
    end if;
    trip := case when r.kind = 'ship' then greatest(1.5, km * 0.85) when r.kind = 'air' then km else greatest(1.5, least(15, km * 0.45)) end;   -- 船はほとんどの人が向こう岸まで（t54o）・飛行機は終点まで
    fare := case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * trip
                 when r.kind = 'ship' then _mp_rate('ship_fare') + _mp_rate('ship_km') * trip
                 when r.kind = 'air' then _mp_rate('air_fare') + _mp_rate('air_km') * trip
                 else _mp_rate('bus_fare') + _mp_rate('bus_km') * greatest(0, trip - 3) end;
    -- 料金（DB の更新72）：グリーン席は乗る人の8%まで（席は1時間に2回転）。寝台は長い系統の夜行だけ（80km をこえるとふえ、680km で4割）。
    --   寝台に乗りたい人の3割は A寝台、のこりは B寝台。個室はそのうち（A の半分・B の2割。1室ごと）。料金は運賃の グリーン1倍・B寝台3倍・A寝台6倍・個室3倍（mp_rates で変えられる）
    --   食堂車：乗る人の5%が食事（1人 600 X）。荷物車・郵便車：1両 1km ごとに 120 X
    xfee := 0; xmeal := 0; xbagr := 0;
    if r.kind = 'rail' then
      xug := least(served * 0.08, xg * 2);
      xus := served * least(0.4, greatest(0, (km - 80) / 600.0));
      xua := least(xus * 0.3, xa); xub := least(xus - xua, xb); xur := least(xrm, xua * 0.5 + xub * 0.2);
      xfee := fare * (xug * coalesce(_mp_rate('fee_g'), 1) + xub * coalesce(_mp_rate('fee_b'), 3) + xua * coalesce(_mp_rate('fee_a'), 6) + xur * coalesce(_mp_rate('fee_room'), 3));
      if xdin > 0 and km > 30 then xmeal := served * 0.05 * xdin / nok * coalesce(_mp_rate('meal'), 600); end if;
      xbagr := xbag * coalesce(_mp_rate('bag_km'), 120);
    end if;
    rev := floor(served * fare + xfee + xmeal + xbagr);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'shop', nwk, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0)));   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
    ) z where pu is not null or pc is not null group by pu, pc   -- 国のもの（国の空港。t54q）は国庫から国庫なので、なし
  loop
    amt := round(o.amt / 24.0);
    if amt > 0 then perform _mp_soft_pay(o.pu, o.pc, false, amt, 'upkeep', format('維持費（%s）', o.ks)); end if;
  end loop;
  -- 使用料：払う人 → 区画の筆の持ち主（筆がなければ国庫）。自分の筆になっていればなし。同じ人の同じ区画は1回（線路と駅のホームが重なるところなど）
  for o in select e.pay_u, e.pay_c, sum(e.fee) fee, p.own_u lu, p.own_c lc
             from (select distinct on (l.x, l.y, l.pay_u, l.pay_c) l.x, l.y, l.pay_u, l.pay_c, l.fee from mp_leases l where not l.pay_gov order by l.x, l.y, l.pay_u, l.pay_c, l.fee desc) e
             left join mp_pcells pc on pc.x = e.x and pc.y = e.y left join mp_parcels p on p.id = pc.parcel
            where p.id is null or not _mp_same(p.own_u, p.own_c, false, e.pay_u, e.pay_c, false)
            group by e.pay_u, e.pay_c, p.own_u, p.own_c loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', '土地の使用料');
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', '土地の使用料（受けとり）');
    end if;
  end loop;
  -- 他社のバス停の使用料（1系統・1日）：系統の持ち主 → バス停の持ち主
  for o in select ro.own_u pay_u, ro.own_c pay_c, sx.own_u lu, sx.own_c lc, sx.kind sk, sum(x.fee) fee
             from mp_stopuse x join mp_routes ro on ro.id = x.route join mp_stations sx on sx.id = x.stop
            where x.fee > 0 and not _mp_same(sx.own_u, sx.own_c, false, ro.own_u, ro.own_c, false)
            group by ro.own_u, ro.own_c, sx.own_u, sx.own_c, sx.kind loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', case when o.sk = 'ship' then '港の使用料' when o.sk = 'air' then '空港の使用料' else 'バス停の使用料' end);
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', case when o.sk = 'ship' then '港の使用料（受けとり）' when o.sk = 'air' then '空港の使用料（受けとり）' else 'バス停の使用料（受けとり）' end);
    end if;
  end loop;
  -- 乗り入れの線路使用料（t54j）：この1時間に始発を出た列車（回送・試運転もふくむ）× 持ち主の線路の km × 1列車・1km の使用料。系統の持ち主 → 線路の持ち主
  for o in
    select ro.own_u gu, ro.own_c gc, hk.hu, hk.hc, sum(cnt.n * hk.km * th.fee) amt, sum(cnt.n) n, sum(cnt.n * hk.km) km
      from mp_routes ro
      join lateral (select coalesce((ran ->> ro.id::text)::int, 0) n) cnt on cnt.n > 0   -- ほんとうに走った列車だけ（運休・工事中・故障はのぞく。DB の更新60）
      join lateral (select s.own_u hu, s.own_c hc, sum(abs((g ->> 2)::real - (g ->> 1)::real) * 50 / 1000.0) km
                      from jsonb_array_elements(ro.legs) l, jsonb_array_elements(l -> 'g') g join mp_segs s on s.id = (g ->> 0)::bigint
                     where not (s.own_u is not distinct from ro.own_u and s.own_c is not distinct from ro.own_c) and not s.gov
                     group by s.own_u, s.own_c) hk on true
      join mp_thru th on th.st = 'ok' and th.fee > 0 and th.hu is not distinct from hk.hu and th.hc is not distinct from hk.hc
                     and th.gu is not distinct from ro.own_u and th.gc is not distinct from ro.own_c
     where ro.ok and ro.kind = 'rail'
     group by ro.own_u, ro.own_c, hk.hu, hk.hc
  loop
    amt := round(o.amt);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.gu, o.gc, false, amt, 'lease', format('線路使用料（乗り入れ・%s本・%skm）', o.n, round(o.km::numeric, 1)));
    if amt > 0 then perform _mp_earn(o.hu, o.hc, false, amt, 'lease_in', format('線路使用料（乗り入れの受けとり・%s本）', o.n)); end if;
  end loop;
  -- 建物：町の人の出入り・家賃・テナントの家賃・店などの売上
  perform _mp_bld_tick_hour(h);
  -- 学校・工場・物流（t54k）。うまくいかなくても、ほかの1時間の分はそのまま
  begin perform _mp_sc_tick_hour(h); exception when others then raise warning 'mp sc: %', sqlerrm; end;
end $$;

create or replace function public._mp_dispatch(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; n int; km real[]; capd boolean[]; capu boolean[]; tr mp_trains; res jsonb; hld jsonb; waits bigint[]; tai_ jsonb; ws text[];
        ta int[]; td int[]; stp boolean[]; ord int[]; e jsonb; p int; q int; x int; a int; b int; kk int; jj int; it int; si int; j int; need int; conf boolean;
        sdir int[] := '{}'; sday date[] := '{}'; snum text[] := '{}'; sarr int[]; sdep int[]; m int := 0; skips int[]; cap boolean[]; H constant int := 60; key text;
        smin int[] := '{}'; smax int[] := '{}'; tmin int; tmax int;
        slen real[] := '{}'; sacc real[] := '{}'; sstp boolean[]; mlen real; macc real; pf jsonb; va real; vc real; ga int; gb int; ca int; cb int; gw int; HB constant int := 150;   -- t62：自動閉塞
        lsg int[]; lv int;   -- 信号の段（駅と駅のあいだごと。DB の更新85）
        lq boolean[]; sexp boolean[] := '{}'; myx boolean;   -- 複々線（DB の更新86）：駅と駅のあいだが複々線か・急行線を走る列車か（優先番号 3 まで）
        sprio int[] := '{}'; srid bigint[] := '{}'; mypr int; et record; kn int; a0 int; a1 int; edir int; eord int[]; estp boolean[]; k0d int; k1d int; kc int;
begin
  select * into r from mp_routes where id = rid;
  n := coalesce(array_length(r.stops, 1), 0);
  if r.kind <> 'rail' or n < 2 then
    for tr in select * from mp_trains where route = rid loop
      res := _mp_train_times(tr, '{}'::jsonb, '{}'::bigint[]);
      update mp_trains set sched = res -> 'sc', warn = nullif(array_to_string(array(select jsonb_array_elements_text(res -> 'ws')), ' / '), ''), cplx = res -> 'cx',
             hold = '{}'::jsonb, tai = '[]'::jsonb where id = tr.id;
    end loop;
    return;
  end if;
  -- 駅の km（系統の駅の順）と、待避できる駅（向きごとに使える番線が2つ以上）
  km := array(select coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q2(l, kq) where kq < o), 0) from generate_series(1, n) o);
  lsg := _mp_leg_sig(r.legs);   -- 信号の段（DB の更新85）
  lq := _mp_leg_quad(r.legs);   -- 複々線（DB の更新86）
  capd := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('down', 'both')) >= 2
                   and exists (select 1 from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('down', 'both') and coalesce(v ->> 'm', 'main') <> 'pass')   -- 通過線（t62）
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  capu := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both')) >= 2
                   and exists (select 1 from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both') and coalesce(v ->> 'm', 'main') <> 'pass')
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  -- ほかの系統の列車（2026-10-28・xwait のとき）：この系統の駅を2つ以上通る列車を、先に決まった列車として入れる（相手の時刻は変えない）。
  --   こちらがゆずるのは、優先番号が小さい列車（同じなら、系統の番号が小さいほう）だけ。通るだけの駅（相手の系統にもある駅）は距離でわりふる
  if coalesce(r.xwait, false) then
    for et in select t.num, t.day, t.sched, ro.id rid2, ro.stops st2, _mp_kprio(ro.own_u, ro.own_c, t.kind) pr, t.form
                from mp_trains t join mp_routes ro on ro.id = t.route
               where ro.id <> rid and ro.kind = 'rail' and ro.stops && r.stops and not t.bad and jsonb_array_length(t.sched) > 1 loop
      ta := array_fill(null::int, array[n]); td := array_fill(null::int, array[n]); estp := array_fill(false, array[n]); kn := 0;
      for e in select v from jsonb_array_elements(et.sched) v loop
        p := array_position(r.stops, (e ->> 0)::bigint);
        if p is null then continue; end if;
        if estp[p] then p := _mp_rpos(r.stops, 1, (e ->> 0)::bigint, true); if estp[p] then continue; end if; end if;   -- 環状線：同じ駅の2回目
        ta[p] := coalesce((e ->> 1)::int, (e ->> 2)::int); td[p] := coalesce((e ->> 2)::int, (e ->> 1)::int); estp[p] := true; kn := kn + 1;
      end loop;
      if kn < 2 then continue; end if;
      a0 := array_position(estp, true); a1 := n + 1 - array_position(array(select estp[g] from generate_series(n, 1, -1) g), true);
      edir := case when td[a0] <= ta[a1] then 1 else -1 end;
      eord := case when edir = -1 then array(select generate_series(n, 1, -1)) else array(select generate_series(1, n)) end;
      for kk in 1..n loop
        x := eord[kk];
        if estp[x] or x < a0 or x > a1 or not (r.stops[x] = any(et.st2)) then continue; end if;
        p := null; q := null;
        for jj in reverse kk - 1..1 loop if estp[eord[jj]] then p := eord[jj]; exit; end if; end loop;
        for jj in kk + 1..n loop if estp[eord[jj]] then q := eord[jj]; exit; end if; end loop;
        if p is null or q is null then continue; end if;
        td[x] := td[p] + round((ta[q] - td[p]) * abs(km[x] - km[p]) / greatest(abs(km[q] - km[p]), 0.001))::int;
        ta[x] := td[x];
      end loop;
      m := m + 1; sdir := sdir || edir; sday := sday || et.day; snum := snum || et.num;
      smin := smin || (select min(v) from unnest(ta || td) v); smax := smax || (select max(v) from unnest(ta || td) v);
      sprio := sprio || et.pr; srid := srid || et.rid2; sexp := sexp || (et.pr <= 3);
      pf := case when et.form is not null then _mp_form_perf(et.form) end; slen := slen || coalesce((pf ->> 'len')::real, 100); sacc := sacc || coalesce((pf ->> 'acc')::real, 2);
      if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[estp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[estp]; end if;
    end loop;
  end if;
  for tr in select x2.* from mp_trains x2 where x2.route = rid
             order by (x2.day is not null), x2.day, _mp_kprio(r.own_u, r.own_c, x2.kind), x2.dep, x2.id loop
    mypr := _mp_kprio(r.own_u, r.own_c, tr.kind);
    myx := mypr <= 3;   -- 急行線を走る（複々線のところ。DB の更新86）
    pf := case when tr.form is not null then _mp_form_perf(tr.form) end;
    mlen := coalesce((pf ->> 'len')::real, 100) + coalesce((select sum((c ->> 'len')::real) from jsonb_array_elements(coalesce(tr.cplx, '[]'::jsonb)) c where coalesce((c ->> 'v')::boolean, false)), 0);
    macc := coalesce((pf ->> 'acc')::real, 2);
    ord := case when tr.dir = -1 then array(select generate_series(n, 1, -1)) else array(select generate_series(1, n)) end;
    cap := case when tr.dir = -1 then capu else capd end;
    hld := '{}'::jsonb; waits := '{}'; tai_ := '[]'::jsonb; ws := '{}'; skips := '{}';
    for it in 1..16 loop
      res := _mp_train_times(tr, hld, waits);
      -- 駅ごとの時刻（系統の駅の順）：止まる駅は着・発、通過する駅は前後の止まる駅から距離でわりふる
      ta := array_fill(null::int, array[n]); td := array_fill(null::int, array[n]); stp := array_fill(false, array[n]); kc := 1;
      for e in select v from jsonb_array_elements(res -> 'sc') v loop
        while kc <= n and r.stops[ord[kc]] <> (e ->> 0)::bigint loop kc := kc + 1; end loop;   -- 走る順に見る（環状線：同じ駅は前のほうから）
        if kc > n then continue; end if;
        p := ord[kc]; kc := kc + 1;
        ta[p] := coalesce((e ->> 1)::int, (e ->> 2)::int); td[p] := coalesce((e ->> 2)::int, (e ->> 1)::int); stp[p] := true;
      end loop;
      for kk in 1..n loop
        x := ord[kk];
        if stp[x] then continue; end if;
        p := null; q := null;
        for jj in reverse kk - 1..1 loop if stp[ord[jj]] then p := ord[jj]; exit; end if; end loop;
        for jj in kk + 1..n loop if stp[ord[jj]] then q := ord[jj]; exit; end if; end loop;
        if p is null or q is null then continue; end if;
        td[x] := td[p] + round((ta[q] - td[p]) * abs(km[x] - km[p]) / greatest(abs(km[q] - km[p]), 0.001))::int;
        ta[x] := td[x];
      end loop;
      -- 先に決めた同じ向きの列車と、となりの駅のあいだごとに見る
      --   （2026-10-28）時刻の幅（いちばん早い〜おそい）が1分半以上はなれている列車は、どの区間でもぶつからないので見ない（結果は前と同じ。本数の2乗で重かった）
      tmin := (select min(v) from unnest(ta || td) v); tmax := (select max(v) from unnest(ta || td) v);
      -- 走る区間の、はじめとおわりの駅（走る順の何番目か。途中始発・途中止まり）
      k0d := coalesce((select min(kq) from generate_series(1, n) kq where stp[ord[kq]]), 1); k1d := coalesce((select max(kq) from generate_series(1, n) kq where stp[ord[kq]]), n);
      conf := false;
      for si in 1..m loop
        if sdir[si] <> tr.dir or si = any(skips) then continue; end if;
        if tr.day is null and sday[si] is not null then continue; end if;
        if tr.day is not null and sday[si] is not null and sday[si] <> tr.day then continue; end if;
        if tmin is null or smax[si] is null or smax[si] + HB + 30 < tmin or smin[si] > tmax + HB then continue; end if;
        if sprio[si] is not null and (sprio[si] > mypr or (sprio[si] = mypr and srid[si] > rid)) then continue; end if;   -- ほかの系統の、ゆずらなくてよい列車
        for kk in 1..n - 1 loop
          a := ord[kk]; b := ord[kk + 1];
          if ta[b] is null or td[a] is null or sarr[si][b] is null or sdep[si][a] is null then continue; end if;
          if coalesce(lq[least(a, b)], false) and sexp[si] is distinct from myx then continue; end if;   -- 複々線：急行線と緩行線は べつの線路なので、追いこし・追いこされを見ない（DB の更新86）
          if td[a] >= sdep[si][a] then
            -- うしろを走る（自動閉塞・t62）：前の列車のうしろ 30m まで。a を出るとき・b に入るときに、前の列車が（長さ＋30m）はなれている。
            --   b に前の列車が止まっていて、同じ番線に入るとき（こちらも b に止まる・こちらは通過でも、その向きに通れる番線がほかにない）は、前の列車が b を出てから
            va := abs(km[b] - km[a]) / greatest(sarr[si][b] - sdep[si][a], 1);   -- 前の列車の、この区間の平均の速さ（m/s）
            lv := coalesce(lsg[least(a, b)], 0);   -- この区間の信号の段（DB の更新85）
            ga := case when sstp[si][a] then _mp_clr_stop2(slen[si], sacc[si], lv) else _mp_clr_pass2(slen[si], va, lv) end;
            gb := _mp_clr_pass2(slen[si], va * case lv when 2 then 0.9 when 1 then 0.75 else 0.6 end, lv);   -- 信号が強いほど、b のあたりでも速いまま つめられる
            need := greatest(sdep[si][a] + ga - td[a], sarr[si][b] + gb - ta[b]);
            if sstp[si][b] and (stp[b] or not cap[b]) then need := greatest(need, sdep[si][b] + _mp_clr_stop2(slen[si], sacc[si], lv) - ta[b]); end if;
            if need > 0 then
              j := null; for jj in reverse kk..1 loop if stp[ord[jj]] then j := jj; exit; end if; end loop;
              key := r.stops[ord[j]]::text;
              hld := jsonb_set(hld, array[key], to_jsonb(coalesce((hld ->> key)::int, 0) + need));
              tai_ := tai_ || jsonb_build_array(jsonb_build_object('s', r.stops[ord[j]], 'by', snum[si], 'sec', need, 'f', true));
              conf := true; exit;
            end if;
          else
            -- 前を走る：うしろの列車（si）に追いつかれないか（こちらが a・b を出て、長さ＋30m はなれるまでに、si が来ない）
            vc := abs(km[b] - km[a]) / greatest(ta[b] - td[a], 1);
            lv := coalesce(lsg[least(a, b)], 0);   -- この区間の信号の段（DB の更新85）
            ca := case when stp[a] then _mp_clr_stop2(mlen, macc, lv) else _mp_clr_pass2(mlen, vc, lv) end;
            cb := case when stp[b] then _mp_clr_stop2(mlen, macc, lv) else _mp_clr_pass2(mlen, vc, lv) end;
            if sdep[si][a] < td[a] + ca or sarr[si][b] < td[b] + cb or sarr[si][a] < td[a] + ca then
              -- 追いつかれる。つぎの駅で待避できて、そこまでは追いこされないなら、つぎの駅で
              if sarr[si][b] >= ta[b] + _mp_clr_pass2(mlen, vc * case lv when 2 then 0.9 when 1 then 0.75 else 0.6 end, lv) and stp[b] and cap[b] and kk + 1 < k1d and sdep[si][a] >= td[a] + ca and sarr[si][a] >= td[a] + ca then continue; end if;
              j := null; for jj in reverse kk..1 loop if stp[ord[jj]] and (cap[ord[jj]] or jj = k0d) then j := jj; exit; end if; end loop;
              if j is null then
                ws := ws || format('%s に追いつかれます（待避できる駅がありません）', snum[si]); skips := skips || si; conf := true; exit;
              end if;
              -- 待避する駅で、うしろの列車が出て（通って）、その長さ＋30m はなれてから出る
              lv := coalesce(case when j < n then lsg[least(ord[j], ord[j + 1])] end, case when j > 1 then lsg[least(ord[j], ord[j - 1])] end, 0);   -- 待避する駅の先の信号の段（DB の更新85）
              gw := case when sstp[si][ord[j]] then _mp_clr_stop2(slen[si], sacc[si], lv)
                         when j < n and sarr[si][ord[j + 1]] is not null then _mp_clr_pass2(slen[si], abs(km[ord[j + 1]] - km[ord[j]]) / greatest(sarr[si][ord[j + 1]] - sdep[si][ord[j]], 1), lv)
                         else _mp_clr_pass2(slen[si], null, lv) end;
              need := greatest(sdep[si][ord[j]] + gw - td[ord[j]], 1);
              key := r.stops[ord[j]]::text;
              hld := jsonb_set(hld, array[key], to_jsonb(coalesce((hld ->> key)::int, 0) + need));
              if not (r.stops[ord[j]] = any(waits)) and j > k0d then waits := waits || r.stops[ord[j]]; end if;
              tai_ := tai_ || jsonb_build_array(jsonb_build_object('s', r.stops[ord[j]], 'by', snum[si], 'sec', need, 'f', j = k0d));
              conf := true; exit;
            end if;
          end if;
        end loop;
        if conf then exit; end if;
      end loop;
      if not conf then exit; end if;
      if it = 16 then ws := ws || '待避・続行がおさまりません（時刻を見なおしてください）'::text; end if;
    end loop;
    -- 駅ごとにまとめる（待避：f = false・続行と始発でおそく出る：f = true）
    tai_ := coalesce((select jsonb_agg(jsonb_build_object('s', z.s, 'by', z.bys, 'sec', z.sec, 'f', z.f) order by z.o)
                       from (select (v ->> 's')::bigint s, (v ->> 'f')::boolean f, sum((v ->> 'sec')::int) sec, jsonb_agg(distinct v ->> 'by') bys, min(o) o
                               from jsonb_array_elements(tai_) with ordinality w(v, o) group by 1, 2) z), '[]'::jsonb);
    update mp_trains set sched = res -> 'sc', cplx = res -> 'cx', hold = hld, tai = tai_,
           warn = nullif(array_to_string(array(select jsonb_array_elements_text(res -> 'ws')) || ws, ' / '), '') where id = tr.id;
    -- 決まった列車にくわえる
    m := m + 1; sdir := sdir || tr.dir; sday := sday || tr.day; snum := snum || tr.num; smin := smin || tmin; smax := smax || tmax; sprio := sprio || null::int; srid := srid || rid; sexp := sexp || myx;
    slen := slen || mlen; sacc := sacc || macc;
    if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[stp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[stp]; end if;
  end loop;
end $$;

create or replace function public._mp_train_times(tr mp_trains, hold jsonb, waits bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare r mp_routes; perf jsonb; n int; ord int[]; i int; k int; t int; arr int; dep int; spec jsonb; sc jsonb := '[]'::jsonb; ws text[] := '{}';
        st mp_stations; lastStop int; run int; trk int; dw int; flen real; stop boolean;
        lq boolean[]; qx boolean;   -- 複々線（DB の更新86）
        e jsonb; ci bigint; o mp_ops; cp jsonb; ka int; kb int; cx jsonb := '[]'::jsonb; cw text; nmax int; x jsonb; skipped bigint; k0 int; k1 int;
begin
  select * into r from mp_routes where id = tr.route;
  perf := case when tr.form is not null then _mp_form_perf(tr.form) end;
  n := array_length(r.stops, 1);
  ord := case when tr.dir = 1 then array(select generate_series(1, n)) else array(select generate_series(n, 1, -1)) end;
  dw := r.dwell;
  lq := case when r.kind = 'rail' then _mp_leg_quad(r.legs) end; qx := r.kind = 'rail' and _mp_kprio(r.own_u, r.own_c, tr.kind) <= 3;   -- 急行線を走る列車（優先番号 3 まで。DB の更新86）
  -- 走る区間（途中始発・途中止まり。2026-10-28）：走る順の k0 番目から k1 番目まで
  k0 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sa, false), 1); k1 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sb, true), n);   -- 環状線：始発は走る順で前の、終着はうしろのほう
  if k0 >= k1 then ws := ws || '始発駅と終着駅の順がちがいます（系統の端から端まで走ります）'::text; k0 := 1; k1 := n; end if;
  if perf is null then ws := ws || '編成が決まっていません（走りません）'::text; end if;
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
        where l.lo >= least(ord[k0], ord[k1]) and l.lo < greatest(ord[k0], ord[k1]) and not (l.v ->> 'e')::boolean) then   -- 走る区間だけ
    ws := ws || '電化していない区間があります（電車は走れません）'::text;
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
                       or (qx and coalesce(coalesce(lq[i - 1], lq[i]) and coalesce(lq[i], lq[i - 1]), false))));   -- 複々線の中の駅：急行線の列車は待避線の番線（DB の更新86）
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

-- 線の設定：前の形（p_quad なし）は消して、p_quad つきにする
drop function if exists public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int);
-- 線の設定：複線・電化・名前・車線。複々線（DB の更新86）：p_quad（線路だけ。複々線は複線のうち。null は いまのまま）。
--   工事費は つくりの倍率 ×（新しい倍率 − いまの倍率。単線 1・複線 dbl_mul・複々線 dbl_mul × 1.7）。はばが広がるところは建物・他人の筆を見る。
--   複々線にする・やめると、通る系統の時刻（待避・続行）を計算しなおす
create or replace function public.mp_seg_opts(p_id bigint, p_dbl boolean, p_elec boolean, p_name text, p_dry boolean, p_lanes int default null, p_quad boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ters text[]; amt_ numeric := 0; i int; base numeric; nl int; what text := ''; mul real[]; what2 text; wc int[]; need jsonb;
        nq boolean; nd boolean; m0 numeric; m1 numeric; rid bigint;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  ters := _mp_ters(_mp_tiles(sg.pts));
  if not sg.gov then mul := case when sg.st is null then _mp_cmuls(_mp_tiles(sg.pts), ters) else _mp_st_muls(sg.pts, ters, sg.st, sg.rack) end; end if;   -- 国の工事は無料（t57b）。縦断のある線は つくりの倍率（t108）
  nq := sg.kind = 'rail' and coalesce(p_quad, sg.quad);
  nd := sg.kind = 'rail' and (coalesce(p_dbl, sg.dbl) or nq);
  if sg.kind = 'rail' then
    base := _mp_rate('rail');
    m0 := _mp_trmul(sg.dbl, sg.quad); m1 := _mp_trmul(nd, nq);
    if not sg.gov then
      for i in 1..array_length(ters, 1) loop
        if m1 > m0 then amt_ := amt_ + base * mul[i] * (m1 - m0); end if;
        if coalesce(p_elec, sg.elec) and not sg.elec then amt_ := amt_ + _mp_rate('elec'); end if;
      end loop;
    end if;
    what := case when nq and not sg.quad then '複々線化' when nd and not sg.dbl then '複線化' else '' end || case when coalesce(p_elec, sg.elec) and not sg.elec then '電化' else '' end;
    nl := sg.lanes;
  else
    nl := coalesce(p_lanes, sg.lanes);
    if sg.cls = 'lane' then nl := 0; end if;
    nl := least(case when sg.cls = 'priv' then 2 else 4 end, greatest(case when sg.cls in ('exp', 'nat') then 2 else 0 end, nl));
    if nl > sg.lanes and not sg.gov then
      for i in 1..array_length(ters, 1) loop
        amt_ := amt_ + _mp_rate('road') * (_mp_road_mul(sg.cls, nl) - _mp_road_mul(sg.cls, sg.lanes)) * mul[i];
      end loop;
    end if;
    if nl > sg.lanes then what := format('拡幅（片側%s車線）', nl); end if;
  end if;
  amt_ := coalesce(round(amt_), 0);
  if (sg.kind = 'rail' and ((nd and not sg.dbl) or (nq and not sg.quad))) or (sg.kind = 'road' and nl > sg.lanes) then
    wc := _mp_seg_cells_arr(sg.pts, sg.kind, case when sg.kind = 'rail' then case when nq then 0.8 else 0.5 end else _mp_road_w(sg.cls, nl) end, nd);
    what2 := _mp_bld_hit(wc);
    if what2 is not null then raise exception '建物のある土地（%）にかかるので、はばを広げられません', left(what2, 60); end if;
    -- 広げたところが他人の筆にかかるときは、貸出料があるか申請が許可されているときだけ
    need := _mp_land_need(wc, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  end if;
  if p_dry then return jsonb_build_object('cost', amt_, 'lanes', nl, 'need', need, 'quad', nq); end if;
  perform _mp_land_stop(need);
  if amt_ > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, case when sg.kind = 'rail' then '線路の' else '道路の' end || what); end if;
  update mp_segs set dbl = case when kind = 'rail' then nd else false end, quad = case when kind = 'rail' then nq else false end,
         elec = case when kind = 'rail' then coalesce(p_elec, elec) else false end,
         name = coalesce(left(p_name, 30), name),
         lanes = nl,
         w = case when kind = 'rail' then case when nq then 0.8 when nd then 0.5 else 0.36 end else _mp_road_w(cls, nl) end,
         vlim = case when kind = 'rail' then vlim else _mp_road_v(cls, nl) end,
         cost = cost + amt_::bigint
   where id = p_id;
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  if sg.kind = 'rail' and nq is distinct from sg.quad then   -- 複々線：通る系統の待避・続行を計算しなおす（道すじは同じなので _mp_routes_fix ではしない）
    for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = p_id loop
      perform _mp_resched(rid);
    end loop;
  end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  return jsonb_build_object('id', p_id, 'cost', amt_, 'lanes', nl, 'quad', nq);
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_seg_r', '_mp_trmul', '_mp_leg_quad', '_mp_split', '_mp_seg_join2', 'mp_area', 'mp_seg_build', 'mp_seg_edit', 'mp_seg_opts',
                                                         'mp_seg_height', 'mp_sta_height', 'mp_seg_sig', '_mp_tick_hour', '_mp_dispatch', '_mp_train_times') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 作りなおした関数のタイムアウト（create or replace で消えるので、もう一度）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '20s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean) set statement_timeout = '20s';
alter function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean) set statement_timeout = '20s';
alter function public.mp_seg_height(bigint, text, real[], boolean, boolean, jsonb) set statement_timeout = '20s';
alter function public.mp_sta_height(bigint, text, boolean) set statement_timeout = '60s';
alter function public.mp_seg_sig(bigint, int, boolean, boolean) set statement_timeout = '60s';
