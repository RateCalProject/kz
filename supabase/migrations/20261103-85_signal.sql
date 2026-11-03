-- 信号の強化：線路ごとに 自動閉塞（ふつう・いまのまま）・ATC（車内信号）・移動閉塞 をえらべる。強いほど、前の列車につめて走れる
--   （前の列車のうしろ 30m → 20m → 10m。駅で前の列車が出てから入れるまでも早い）。上げる工事費は 1マス 線路の 0.4・0.8 倍（複線はその倍率）。下げるのは無料
--   待避・続行と番線のかさなりは、駅と駅のあいだ（駅）の線路の信号で見る。信号が ちがう線路のつなぎ目は、1本にできない

alter table public.mp_segs add column if not exists sig smallint not null default 0;   -- 信号の段（DB の更新85）：0 自動閉塞（ふつう）・1 ATC（車内信号）・2 移動閉塞

-- 信号の段ごとの「はなれるまで」（DB の更新85）：前の列車のうしろ 自動閉塞 30m・ATC 20m・移動閉塞 10m まで近づける。いちばん短い秒も 8・6・5（止まっていた）／4・3・2（走っている）
--   段 0 は _mp_clr_stop・_mp_clr_pass と同じ。待避・続行では、つぎの駅のあたりの前の列車の速さを 平均の 0.6・0.75・0.9 倍とみる（強いほど、速いまま つめられる）
create or replace function public._mp_clr_stop2(len double precision, acc double precision, lv int) returns int
language sql immutable as $$
  select greatest(case lv when 2 then 5 when 1 then 6 else 8 end, ceil(sqrt(2 * (coalesce(len, 100) + case lv when 2 then 10 when 1 then 20 else 30 end) / greatest(coalesce(acc, 2) / 3.6, 0.15))))::int
$$;
create or replace function public._mp_clr_pass2(len double precision, v double precision, lv int) returns int
language sql immutable as $$
  select greatest(case lv when 2 then 2 when 1 then 3 else 4 end, ceil((coalesce(len, 100) + case lv when 2 then 10 when 1 then 20 else 30 end) / greatest(coalesce(v, 10), 3)))::int
$$;
-- 系統の駅と駅のあいだ（legs）ごとの信号の段（通る線路のうち いちばん弱いもの。DB の更新85）
create or replace function public._mp_leg_sig(legs jsonb) returns int[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(coalesce((select min(s.sig) from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g join mp_segs s on s.id = (g ->> 0)::bigint), 0)::int order by k), '{}')
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
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color, snowp, prof, st, rack, hm, hopt, sig)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then least(case when sg.rack then 30 else 300 end, _mp_vlim(_mp_minr(pb))) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color,   -- color：路線カラーもそのまま（2026-10-29）
          sg.snowp, fb, _mp_st_of(pb, fb), sg.rack, sg.hm, sg.hopt, sg.sig)   -- 雪よけ・高さ・アプト式もそのまま（t108）。高さの数値も（DB の更新84）・信号の段も（85）
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
                  || case when s.sig > 0 then jsonb_build_object('sg', s.sig) else '{}'::jsonb end), '[]'::jsonb)   -- 信号の段（DB の更新85）
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）
  return r;
end $$;

create or replace function public._mp_dispatch(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; n int; km real[]; capd boolean[]; capu boolean[]; tr mp_trains; res jsonb; hld jsonb; waits bigint[]; tai_ jsonb; ws text[];
        ta int[]; td int[]; stp boolean[]; ord int[]; e jsonb; p int; q int; x int; a int; b int; kk int; jj int; it int; si int; j int; need int; conf boolean;
        sdir int[] := '{}'; sday date[] := '{}'; snum text[] := '{}'; sarr int[]; sdep int[]; m int := 0; skips int[]; cap boolean[]; H constant int := 60; key text;
        smin int[] := '{}'; smax int[] := '{}'; tmin int; tmax int;
        slen real[] := '{}'; sacc real[] := '{}'; sstp boolean[]; mlen real; macc real; pf jsonb; va real; vc real; ga int; gb int; ca int; cb int; gw int; HB constant int := 150;   -- t62：自動閉塞
        lsg int[]; lv int;   -- 信号の段（駅と駅のあいだごと。DB の更新85）
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
      sprio := sprio || et.pr; srid := srid || et.rid2;
      pf := case when et.form is not null then _mp_form_perf(et.form) end; slen := slen || coalesce((pf ->> 'len')::real, 100); sacc := sacc || coalesce((pf ->> 'acc')::real, 2);
      if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[estp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[estp]; end if;
    end loop;
  end if;
  for tr in select x2.* from mp_trains x2 where x2.route = rid
             order by (x2.day is not null), x2.day, _mp_kprio(r.own_u, r.own_c, x2.kind), x2.dep, x2.id loop
    mypr := _mp_kprio(r.own_u, r.own_c, tr.kind);
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
    m := m + 1; sdir := sdir || tr.dir; sday := sday || tr.day; snum := snum || tr.num; smin := smin || tmin; smax := smax || tmax; sprio := sprio || null::int; srid := srid || rid;
    slen := slen || mlen; sacc := sacc || macc;
    if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[stp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[stp]; end if;
  end loop;
end $$;

create or replace function public._mp_resched(rid bigint) returns void
language plpgsql set search_path = public as $$
declare tr mp_trains; a record; b record; r mp_routes; w text; fid bigint; lsta bigint; lt int; lnum text; dd date; ldated bigint; ldci int; pass int;
        sk jsonb; wl real; cl real; sr jsonb; stw boolean;   -- 蒸気機関車の補給（DB の更新78）
begin
  perform _mp_dispatch(rid);   -- 時刻（待避・続行もふくめて）
  select * into r from mp_routes where id = rid;
  -- 番線：同じ駅・同じ番線に、重なる（t62：自動閉塞。前の列車が出て、長さ＋30m はなれるまで。前は前後30秒ずつ。駅の線の信号が強ければ 20m・10m。DB の更新85）
  --   （2026-10-28）前は列車の組ごとに sched をひらいていて「本数の2乗×駅数の2乗」かかり、列車をまとめて足すと8秒の制限をこえていた。
  --   いまは駅ごとの発着を1回だけ表にして、駅・番線でつなぐ。注意書きも、列車ごとにまとめて1回で書く（中身は前と同じ）
  --   さらに10分ごとの枠（bk）でもつなぐ：重なる2つは、両方の最初の枠のおそいほう（greatest(p)）で1回だけ出会う
  with pf as materialized (   -- 編成ごとの長さ・加速（「出てから はなれるまで」の秒は、駅の信号の段で）
    select f.form, (q.p ->> 'len')::real len, (q.p ->> 'acc')::real acc
      from (select distinct t.form from mp_trains t where t.route in (select id from mp_routes where stops && r.stops) and t.form is not null) f,
           lateral (select _mp_form_perf(f.form) p) q),
  sl as materialized (   -- 駅の線の信号の段（DB の更新85）
    select s2.id, coalesce(sg.sig, 0)::int lv from mp_stations s2 left join mp_segs sg on sg.id = s2.seg
     where s2.id in (select unnest(ro.stops) from mp_routes ro where ro.stops && r.stops)),
  st as materialized (
    select z.*, floor(least(z.ta, z.td + z.clr) / 600.0)::int p, floor(greatest(z.ta, z.td + z.clr) / 600.0)::int q from (
      select t.id, t.route, t.num, t.day, s.v ->> 0 sta, s.v ->> 3 trk,
             coalesce((s.v ->> 1)::int, (s.v ->> 2)::int) ta, coalesce((s.v ->> 2)::int, (s.v ->> 1)::int) td,
             _mp_clr_stop2((select pf.len from pf where pf.form = t.form), (select pf.acc from pf where pf.form = t.form), coalesce((select sl.lv from sl where sl.id = (s.v ->> 0)::bigint), 0)) clr
        from mp_trains t cross join lateral jsonb_array_elements(t.sched) s(v)
       where t.route in (select id from mp_routes where stops && r.stops) and s.v ->> 0 is not null and s.v ->> 3 is not null) z),
  sb as materialized (select st.*, w10.bk from st cross join lateral generate_series(st.p, st.q) w10(bk)),
  c as materialized (
    select t1.id i1, t2.id i2, t1.num n1, t2.num n2, t1.trk, (select name from mp_stations where id = t1.sta::bigint) sn
      from sb t1 join sb t2 on t2.sta = t1.sta and t2.trk = t1.trk and t2.bk = t1.bk and t1.id < t2.id
     where t1.bk = greatest(t1.p, t2.p)
       and (t1.route = rid or t2.route = rid)
       and (t1.day is null or t2.day is null or t1.day = t2.day)
       and t1.ta < t2.td + t2.clr and t2.ta < t1.td + t1.clr),
  g as (
    select z.id, string_agg(z.m, ' / ') m from (
      select c.i1 id, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n2) m from c
      union all select c.i2, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n1) from c) z group by z.id)
  update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id and t.route = rid;
  -- 単線：となりの駅のあいだ（単線のある区間）に、反対向きの列車が同じ時刻にいる（となりの駅は lead で1回ずつ）
  if r.kind = 'rail' then
    with x as materialized (
      select z.id, z.dir, z.day, z.num, z.sa, z.sb, z.d, z.a from (
        select t.id, t.dir, t.day, t.num, (e.v ->> 0)::bigint sa, (lead(e.v) over w ->> 0)::bigint sb, (e.v ->> 2)::int d, (lead(e.v) over w ->> 1)::int a, lead(e.v) over w nx
          from mp_trains t, jsonb_array_elements(t.sched) with ordinality e(v, o)
         where t.route = rid and t.dir in (1, -1)
        window w as (partition by t.id order by e.o)) z
       where z.nx is not null),
    c as materialized (
      select x1.id i1, x2.id i2, x1.num n1, x2.num n2, x1.sa, x1.sb
        from x x1 join x x2 on x2.sa = x1.sb and x2.sb = x1.sa
       where x1.dir = 1 and x2.dir = -1
         and x1.d < x2.a and x2.d < x1.a and (x1.day is null or x2.day is null or x1.day = x2.day)
         and exists (select 1 from generate_series(array_position(r.stops, x1.sa),
                       (select min(z.o) from unnest(r.stops) with ordinality z(s, o) where z.s = x1.sb and z.o > array_position(r.stops, x1.sa))::int - 1) k
                      where (r.legs -> (k - 1) ->> 's')::boolean)),
    g as (
      select z.id, string_agg(z.m, ' / ') m from (
        select c.i1 id, format('単線の区間（%s〜%s）で %s とすれちがえません', (select s.name from mp_stations s where s.id = c.sa), (select s.name from mp_stations s where s.id = c.sb), c.n2) m from c
        union all select c.i2, format('単線の区間で %s とすれちがえません', c.n1) from c) z group by z.id)
    update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id;
  end if;
  update mp_trains set bad = true where route = rid and form is null;
  -- 編成のつながり：編成ごとに時刻の順に見て、前に走る列車の終点から2分以上あけて出られる列車だけが走る（走れない列車は bad）
  --   連結（cplx）も、その編成の走りとして見る（つなぐ駅を出てから、切りはなす駅に着くまで）。まにあわない連結は、つながない（ok = false）
  --   連結する列車が走るかどうかは、ほかの編成の結果で決まるので、2回まわす
  for pass in 1..2 loop
    for fid in select z.f from (select distinct form f from mp_trains where route = rid and form is not null
                                union select distinct (c ->> 'f')::bigint from mp_trains t, jsonb_array_elements(t.cplx) c where t.route = rid and (c ->> 'v')::boolean) z
                order by z.f loop
      -- 毎日の列車
      lsta := null; lt := null; lnum := null;
      sk := _mp_form_steam(fid); wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車（DB の更新78）：1日のはじめは水も石炭も満タン
      for a in select * from _mp_form_runs(fid) x where x.day is null order by x.ft, x.tid, x.ci loop
        if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
        w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0);
        if w is null and sk is not null then   -- 補給（DB の更新78）：止まる駅の給水・給炭で、駅のあいだを走りきれるか
          sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
          w := sr ->> 'w';
          if w is null then wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real;
          elsif a.ci > 0 then w := replace(w, '【補給】', '') || '（連結しません）'; end if;
        end if;
        perform _mp_run_mark(a.tid, a.ci, w);
        if w is null then lsta := a.es; lt := a.et; lnum := a.num; end if;
      end loop;
      -- 臨時列車：その日の毎日の列車とあわせて見る。臨時列車のせいで毎日の列車がまにあわなくなるときは、臨時列車のほうが走れない（連結しない）
      for dd in select distinct x.day from _mp_form_runs(fid) x where x.day is not null loop
        lsta := null; lt := null; lnum := null; ldated := null; ldci := null;
        wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車：その日のはじめは満タン（DB の更新78）
        for a in select * from _mp_form_runs(fid) x where x.day is null or x.day = dd order by x.ft, x.tid, x.ci loop
          if a.day is null and not a.ok then continue; end if;   -- 毎日の走りで走れないもの（つながないもの）は、とばす
          if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
          w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0); stw := false;
          if w is null and sk is not null then   -- 補給（DB の更新78）
            sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
            if sr ->> 'w' is not null then
              stw := true;
              w := case when a.day is not null and a.ci > 0 then replace(sr ->> 'w', '【補給】', '') || '（連結しません）' else sr ->> 'w' end;
            else wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real; end if;
          end if;
          if a.day is not null then
            perform _mp_run_mark(a.tid, a.ci, w);
            if w is null then lsta := a.es; lt := a.et; lnum := a.num; ldated := a.tid; ldci := a.ci; end if;
          else
            if w is not null and ldated is not null then
              perform _mp_run_mark(ldated, ldci, format(case when ldci > 0 then case when stw then 'この臨時列車のあと、%s の水か石炭がたりなくなります（連結しません）' else 'この臨時列車のあと、%s にまにあいません（連結しません）' end
                                                             else case when stw then '【補給】この臨時列車のあと、%s の水か石炭がたりなくなります（走れません）' else '【編成】この臨時列車のあと、%s にまにあいません（走れません）' end end, a.num));
            end if;
            lsta := a.es; lt := a.et; lnum := a.num; ldated := null;
            if stw then wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real; end if;   -- 毎日の列車は走るので、そのあとは ふだんどおりに（満タンとみる）
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  if r.kind = 'air' then perform _mp_slot_mark(); end if;   -- 発着口（t57）：出る空港・1時間ごとに、持っている発着口の数まで
end $$;

-- 信号の段を変える（DB の更新85）：0 自動閉塞（ふつう）・1 ATC（車内信号）・2 移動閉塞。強いほど、前の列車につめて走れる（うしろ 30m → 20m → 10m。駅の入れかわりも早い）
--   p_chain：分かれ道のない点でつながる同じ持ち主の線路も いっしょに。工事費は上げる分だけ（1マス ATC 0.4・移動閉塞 0.8 × 線路の工事費。複線はその倍率。国の線は無料）。
--   下げるのは無料（返金なし）。維持費は変わらない。通る系統の時刻（待避・続行）を計算しなおす
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
  for s in select x.id, x.len, x.sig, x.gov, x.dbl, x.pts from mp_segs x where x.id = any(ids) loop
    lm := lm + s.len;
    a := 0;
    if not s.gov and p_sig > s.sig then
      a := round((case p_sig when 2 then 0.8 when 1 then 0.4 else 0 end - case s.sig when 2 then 0.8 when 1 then 0.4 else 0 end) * _mp_rate('rail')
                 * (coalesce(array_length(_mp_tiles(s.pts), 1), 0) / 2) * case when s.dbl then _mp_rate('dbl_mul') else 1 end);
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

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_clr_stop2', '_mp_clr_pass2', '_mp_leg_sig', '_mp_dispatch', '_mp_resched', '_mp_split', '_mp_seg_join2', 'mp_area', 'mp_seg_sig') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 信号を変えると、通る系統の時刻を計算しなおすので60秒まで
alter function public.mp_seg_sig(bigint, int, boolean, boolean) set statement_timeout = '60s';
