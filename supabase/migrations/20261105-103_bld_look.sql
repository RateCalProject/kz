-- 建物の見た目（外観）と向き：建物ごとに 見た目の番号（1〜10）と 向き（正面の方角。15度ずつ）を持つ。3D の地図で、同じ種類の建物でも 見た目をえらべ、向きを変えられる
--   建てるときは無料。そのあと 見た目を変えるのは 外装工事（建てたときの工事費の 10%。いちばん安くて 1万 X）、
--   向きを変えるのは 曳家工事（30%。いちばん安くて 3万 X）。国庫へ。向きを決めていない建物は、3D の地図で 近くの道にそろえる
--   前からある建物（まだ どちらも えらんでいない）も、はじめの1回は無料。国の建物は 管理者だけ（無料）
-- サービスエリア・パーキングエリア：高速道路のそば（50m 以内）にだけ建てられる 建物の種類を足す
-- 小物：3D の編集モードで 自分の土地に置く（自販機・ベンチ・植木・灯籠・お地蔵さんなど。置くときに お金・国庫へ）
-- 1階のお店の看板の色（横線）：建物の持ち主と その部屋を借りている会社が、何度でも無料で えらべる

alter table public.mp_blds add column if not exists look smallint check (look between 1 and 10);   -- 見た目（外観）の番号。null は まだえらんでいない（3D の地図では id から自動。DB の更新103）
alter table public.mp_blds add column if not exists rot smallint check (rot >= 0 and rot < 360 and rot % 15 = 0);   -- 向き（正面の方角。北 0・東 90・南 180・西 270。15度ずつ）。null は自動（3D の地図で 近くの道にそろえる。DB の更新103）
alter table public.mp_units add column if not exists sc text[] check (sc is null or (cardinality(sc) between 1 and 3 and array_to_string(sc, ',') ~ '^#[0-9a-f]{6}(,#[0-9a-f]{6}){0,2}$'));   -- 1階のお店の看板の色（横線。3つまで。持ち主・入っている会社がえらぶ。DB の更新103）
create table if not exists public.mp_props (   -- 小物（3D の編集モードで 自分の土地に置く。自販機・ベンチ・植木など。DB の更新103）
  id         bigserial primary key,
  parcel     bigint not null references public.mp_parcels(id) on delete cascade,
  kind       text not null,                 -- _mp_prop_kinds のキー
  x          int not null,                  -- 位置（1/100 マス）
  y          int not null,
  rot        smallint not null default 0 check (rot >= 0 and rot < 360 and rot % 15 = 0),   -- 正面の方角（北 0・東 90・南 180・西 270）
  col        text check (col ~ '^#[0-9a-f]{6}$'),   -- 色（えらべる小物）
  cost       bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists mp_props_xy on public.mp_props (x, y);
create index if not exists mp_props_parcel on public.mp_props (parcel);
alter table public.mp_props enable row level security;

-- 見た目を変える 外装工事の費用（X）：建てたときの工事費の 10%。いちばん安くて 1万 X（DB の更新103）
create or replace function public._mp_look_cost(c bigint) returns bigint
language sql immutable set search_path = public as $$
  select greatest(10000, round(coalesce(c, 0) * 0.1))::bigint
$$;

-- 向きを変える 曳家工事（建物を動かす工事）の費用（X）：建てたときの工事費の 30%。いちばん安くて 3万 X（DB の更新103）
create or replace function public._mp_rot_cost(c bigint) returns bigint
language sql immutable set search_path = public as $$
  select greatest(30000, round(coalesce(c, 0) * 0.3))::bigint
$$;

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
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld,
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

create or replace function public.mp_bld_get(p_bld bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b mp_blds; p mp_parcels; me_cs int[]; mine boolean; pr jsonb; one boolean;
begin
  perform _mp_ok(u);
  select * into b from mp_blds where id = p_bld;
  if not found then raise exception '建物が見つかりません'; end if;
  select * into p from mp_parcels where id = b.parcel;
  me_cs := array(select id from companies where owner = u);
  mine := coalesce(p.own_u = u or p.own_c = any(me_cs), false);
  select x into pr from jsonb_array_elements(_mp_bld_presets()) x where x ->> 'k' = b.kind;
  one := coalesce((pr ->> 'one')::boolean, false);
  return jsonb_build_object('id', b.id, 'parcel', b.parcel, 'kind', b.kind, 'kname', pr ->> 'n', 'shape', b.shape, 'floors', b.floors, 'fm2', b.fm2,
    'name', b.name, 'cost', b.cost, 'rent_lv', b.rent_lv, 'opt', b.opt, 'built_at', b.built_at, 'mine', mine, 'one', one, 'gov', p.gov,
    'own_as', case when mine and p.own_c is not null then (select c.cid from companies c where c.id = p.own_c) when mine then 'me' end,
    'owner', _mp_pname(p.own_u, p.own_c, p.gov), 'addr', (_mp_addr(_mp_t5(b.cells[1]), _mp_t5(b.cells[2]), b.cells[1], b.cells[2]) ->> 'text') || ' ' || _mp_ban(p.ban, p.eda),
    'dem', b.dem, 'mr', b.mr,
    -- 見た目（外観）と向き（DB の更新103）：look_ok 変えられる（持ち主・国の建物は管理者）・style_free まだ どちらも えらんでいない（無料）
    --   look_cost 外装工事（見た目）・rot_cost 曳家工事（向き）の費用
    'look', b.look, 'rot', b.rot, 'look_ok', mine or (p.gov and _is_admin(u)), 'style_free', p.gov or (b.look is null and b.rot is null),
    'look_cost', case when p.gov then 0 else _mp_look_cost(b.cost) end, 'rot_cost', case when p.gov then 0 else _mp_rot_cost(b.cost) end,
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'f', x.floor, 'no', x.no, 'room', _mp_room(x.floor, x.no, one), 'use', x.use, 'm2', x.m2, 'mode', x.mode,
                'ask', x.ask, 'tk', x.t_kind, 'tn', case when x.t_kind = 'corp' then (select name from companies where id = x.t_c) else x.t_name end,
                'tmine', x.t_c = any(me_cs), 'rent', round(x.rent), 'mr', round((b.mr ->> x.use)::numeric * x.m2), 'since', x.since,
                'sc', x.sc, 'can_sc', x.floor = 1 and x.use = 'shop' and (mine or (p.gov and _is_admin(u)) or (x.t_kind = 'corp' and x.t_c = any(me_cs)))) order by x.floor, x.no), '[]'::jsonb)
              from mp_units x where x.bld = b.id),
    'day', case when mine then (select jsonb_build_object(
              'rent', coalesce(sum(x.rent) filter (where x.t_kind is not null), 0)::bigint,
              'occ', count(*) filter (where x.t_kind is not null or x.mode = 'self'), 'n', count(*)) from mp_units x where x.bld = b.id) end,
    'sc', _mp_sc_info(b.id, u),
    -- 港（フェリーターミナル。t54o）・空港（t54p）：乗り場・置き場・船（飛行機）の数・航路（路線）の数。k：ship・air、rwy：滑走路（m）、gates：ゲート
    'port', case when _mp_term_kind(b.kind) is not null then (select jsonb_build_object('sta', s.id, 'dep', (select d.id from mp_depots d where d.bld = b.id), 'name', s.name, 'ln', s.lend,
               'k', s.kind, 'rwy', case when s.kind = 'air' then s.plat end, 'gates', case when s.kind = 'air' then s.tracks end,
               'n', (select count(*) from mp_cars c join mp_depots d on d.id = c.depot where d.bld = b.id), 'cap', (select d.cap from mp_depots d where d.bld = b.id),
               'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'n', r.name, 'c', r.color) order by r.id), '[]'::jsonb) from mp_routes r where s.id = any(r.stops)))
             from mp_stations s where s.bld = b.id) end);
end $$;

-- 建物の見た目（外観）と向きをえらぶ・変える（DB の更新103）
--   p_look：1〜10（型ごとの数は画面がきめる）。null は そのまま
--   p_rot：正面の方角（北 0・東 90・南 180・西 270。15度ずつ）。-1 は自動（近くの道にそろえる）。null は そのまま
--   まだ どちらも えらんでいない建物（建てた直後・前からある建物）は無料。そのあと 見た目を変えるのは 外装工事（_mp_look_cost）、
--   向きを変えるのは 曳家工事（_mp_rot_cost）。両方なら 両方の費用（国庫へ）。国の建物は 国（管理者）だけ（無料）
create or replace function public.mp_bld_look(p_bld bigint, p_look int, p_rot int, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; b mp_blds; p mp_parcels; cost bigint := 0; nm text; lk smallint; rt smallint; free boolean; chl boolean; chr boolean; x0 int; y0 int; x1 int; y1 int;
begin
  perform _mp_ok(u);
  if p_look is not null and (p_look < 1 or p_look > 10) then raise exception '見た目の番号は 1〜10 です'; end if;
  if p_rot is not null and p_rot <> -1 and (p_rot < 0 or p_rot >= 360 or p_rot % 15 <> 0) then raise exception '向きは 0〜345度（15度ずつ）です'; end if;
  select * into pa from _mp_party(u, p_as);
  select * into b from mp_blds where id = p_bld for update;
  if not found then raise exception '建物が見つかりません'; end if;
  select * into p from mp_parcels where id = b.parcel;
  if p.gov then
    if not pa.gv then raise exception '国の建物の見た目は、国（管理者）だけが変えられます'; end if;
  elsif not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, pa.gv) then raise exception 'あなた（この名義）の建物ではありません'; end if;
  lk := case when p_look is null then b.look else p_look end;
  rt := case when p_rot is null then b.rot when p_rot = -1 then null else p_rot end;
  chl := lk is distinct from b.look; chr := rt is distinct from b.rot;
  if not chl and not chr then return jsonb_build_object('ok', true, 'look', b.look, 'rot', b.rot, 'cost', 0); end if;
  free := p.gov or (b.look is null and b.rot is null);   -- はじめの1回（建てた直後・前からある建物）は無料
  if not free then
    cost := case when chl then _mp_look_cost(b.cost) else 0 end + case when chr then _mp_rot_cost(b.cost) else 0 end;
    nm := coalesce(nullif(b.name, ''), (select x ->> 'n' from jsonb_array_elements(_mp_bld_presets()) x where x ->> 'k' = b.kind), '建物');
    perform _mp_pay(pa.pu, pa.pc, false, cost, 'bld', case when chl and chr then format('%sの外装工事と曳家工事（見た目と向きを変えた）', nm)
                                                         when chr then format('%sの曳家工事（向きを変えた）', nm) else format('%sの外装工事（見た目を変えた）', nm) end);
  end if;
  update mp_blds set look = lk, rot = rt where id = b.id;
  x0 := (p.bb[1])[0]; y0 := (p.bb[1])[1]; x1 := (p.bb[0])[0] - 1; y1 := (p.bb[0])[1] - 1;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(x0), _mp_t5(y0)), point(_mp_t5(x1) + 1, _mp_t5(y1) + 1)));
  return jsonb_build_object('ok', true, 'look', lk, 'rot', rt, 'cost', cost);
end $$;

create or replace function public._mp_bld_presets() returns jsonb
language sql immutable as $$
  select '[
   {"k":"house","n":"一戸建て","use":"home","one":true,"z":"abcehik","cpm":300,"f0":1,"f1":3,"min":1,"max":6,"sh":["full","L"],"cat":"home","c":"#c47b4e"},
   {"k":"apart","n":"アパート","use":"home","u":40,"z":"abcek","cpm":320,"f0":2,"f1":3,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#9aa7b3"},
   {"k":"mansion","n":"マンション","use":"home","u":70,"z":"bcdek","cpm":600,"f0":4,"f1":15,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"opt":["shop1"],"cat":"home","c":"#d9d4cc"},
   {"k":"tower","n":"タワーマンション","use":"home","u":75,"z":"cd","cpm":900,"f0":20,"f1":45,"min":16,"max":200,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#cfd6de"},
   {"k":"shop","n":"店舗つき住宅","use":"home","u":50,"g1":"shop","z":"abcdek","cpm":350,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"cat":"home","c":"#e6a06e"},
   {"k":"zakkyo","n":"雑居ビル","use":"office","u":60,"g1":"shop","g2":"shop","z":"cd","cpm":650,"f0":3,"f1":10,"min":2,"max":12,"sh":["full","slab"],"cat":"biz","c":"#c9b8a6"},
   {"k":"office","n":"オフィスビル","use":"office","u":0,"z":"cd","cpm":800,"f0":5,"f1":30,"min":6,"max":120,"sh":["full","slab","L","tower"],"opt":["shop1"],"cat":"biz","c":"#aebdd0"},
   {"k":"sky","n":"超高層ビル","use":"office","u":0,"g1":"shop","g2":"shop","z":"d","cpm":1100,"f0":30,"f1":60,"min":25,"max":400,"sh":["tower"],"cat":"biz","c":"#9fb3cc","fx":{"office":0.04,"shop":0.03}},
   {"k":"mall","n":"ショッピングセンター","use":"shop","u":200,"z":"cde","cpm":450,"f0":1,"f1":4,"min":20,"max":1600,"sh":["full","slab","ro"],"cat":"shop","c":"#e8d2b0","fx":{"shop":0.06}},
   {"k":"factory","n":"工場","use":"factory","one":true,"z":"ef","cpm":250,"f0":1,"f1":2,"min":10,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#b8b8b0","fx":{"home":-0.03}},
   {"k":"warehouse","n":"倉庫","use":"warehouse","one":true,"z":"efgk","cpm":200,"f0":1,"f1":3,"min":4,"max":800,"sh":["full","slab"],"cat":"logi","c":"#c2b59b"},
   {"k":"port","n":"港湾施設","use":"port","one":true,"z":"gk","cpm":500,"f0":1,"f1":1,"min":10,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#9ab3c0","opts":["ore","crude"]},
   {"k":"farm","n":"田畑","use":"farm","one":true,"z":"h","cpm":10,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#a9cf73","opts":["wheat"],"pat":"rows"},
   {"k":"parking","n":"駐車場","use":"parking","one":true,"z":"abcdefghk","cpm":30,"f0":0,"f1":0,"min":1,"max":400,"sh":["full"],"cat":"park","c":"#bdbdbd","pat":"lines"},
   {"k":"pkbld","n":"立体駐車場","use":"parking","u":0,"z":"bcdefk","cpm":400,"f0":2,"f1":8,"min":6,"max":400,"sh":["full","slab"],"cat":"park","c":"#b0b0b0"},
   {"k":"es","n":"小学校","use":"school","one":true,"z":"abcek","cpm":350,"f0":1,"f1":4,"min":10,"max":400,"sh":["full","slab","L","ko"],"sc":"es","cat":"school","c":"#d9b77e"},
   {"k":"jhs","n":"中学校","use":"school","one":true,"z":"abcek","cpm":350,"f0":1,"f1":4,"min":10,"max":400,"sh":["full","slab","L","ko"],"sc":"jhs","cat":"school","c":"#c9a16a"},
   {"k":"hs","n":"高校","use":"school","one":true,"z":"abcdek","cpm":400,"f0":1,"f1":6,"min":12,"max":600,"sh":["full","slab","L","ko"],"sc":"hs","cat":"school","c":"#b98e5e"},
   {"k":"univ","n":"大学","use":"school","one":true,"z":"abcdehk","cpm":500,"f0":1,"f1":20,"min":20,"max":1600,"sh":["full","slab","L","ko","ro","tower"],"sc":"univ","cat":"school","c":"#a65a46","fx":{"home":0.08,"shop":0.04}},
   {"k":"voc","n":"専門学校","use":"school","one":true,"z":"bcdek","cpm":600,"f0":2,"f1":15,"min":3,"max":200,"sh":["full","slab","tower"],"sc":"voc","cat":"school","c":"#b7a2c9"},
   {"k":"mill","n":"製粉工場","use":"factory","one":true,"z":"efgk","cpm":300,"f0":1,"f1":4,"min":10,"max":1600,"sh":["full","slab"],"mk":"flour","cat":"ind","c":"#d8c9a3"},
   {"k":"foodf","n":"食品工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":4,"min":10,"max":1600,"sh":["full","slab"],"mk":"food","cat":"ind","c":"#e3b98a"},
   {"k":"steelw","n":"製鉄所","use":"factory","one":true,"z":"fgk","cpm":400,"f0":1,"f1":3,"min":40,"max":1600,"sh":["full","slab"],"mk":"steel","cat":"ind","c":"#7d7f86","fx":{"home":-0.05}},
   {"k":"carf","n":"自動車工場","use":"factory","one":true,"z":"ef","cpm":350,"f0":1,"f1":3,"min":30,"max":1600,"sh":["full","slab"],"mk":"car","cat":"ind","c":"#9fb4c8"},
   {"k":"petro","n":"石油化学工場","use":"factory","one":true,"z":"fgk","cpm":450,"f0":1,"f1":3,"min":30,"max":1600,"sh":["full","slab"],"mk":"chem","cat":"ind","c":"#c7c2a0","fx":{"home":-0.05}},
   {"k":"elecf","n":"半導体・家電工場","use":"factory","one":true,"z":"ef","cpm":500,"f0":1,"f1":5,"min":10,"max":1600,"sh":["full","slab"],"mk":"elec","cat":"ind","c":"#b8d0d8"},
   {"k":"railf","n":"鉄道車両工場","use":"factory","one":true,"z":"ef","cpm":350,"f0":1,"f1":2,"min":30,"max":1600,"sh":["full","slab"],"mk":"railcar","cat":"ind","c":"#8f9e8a"},
   {"k":"hira","n":"平屋","use":"home","one":true,"z":"abcehik","cpm":280,"f0":1,"f1":1,"min":1,"max":8,"sh":["full","L"],"cat":"home","c":"#b9845a","dm":1.05},
   {"k":"nisetai","n":"二世帯住宅","use":"home","u":0,"z":"abcek","cpm":320,"f0":2,"f1":3,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#b77e57","rl":1.1,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"sankai","n":"三階建て住宅","use":"home","one":true,"z":"abcdek","cpm":330,"f0":3,"f1":3,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#a9704c","rl":1.05},
   {"k":"kyosho","n":"狭小住宅","use":"home","one":true,"z":"bcdek","cpm":360,"f0":2,"f1":3,"min":1,"max":2,"sh":["full"],"cat":"home","c":"#9b6a4e","rl":0.95,"dm":1.1},
   {"k":"kodate","n":"建売住宅","use":"home","one":true,"z":"abcek","cpm":270,"f0":2,"f1":2,"min":1,"max":4,"sh":["full","L"],"cat":"home","c":"#c98a5c","rl":0.95,"dm":1.1},
   {"k":"chumon","n":"注文住宅","use":"home","one":true,"z":"abcek","cpm":400,"f0":2,"f1":3,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#b5654a","rl":1.2,"dm":0.95},
   {"k":"eco","n":"エコハウス","use":"home","one":true,"z":"abcek","cpm":450,"f0":2,"f1":2,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#5d7f6a","rl":1.15},
   {"k":"yokan","n":"洋館","use":"home","one":true,"z":"abhik","cpm":650,"f0":2,"f1":3,"min":4,"max":20,"sh":["full","L","ko"],"cat":"home","c":"#8c5a4a","rl":1.6,"dm":0.75},
   {"k":"gotei","n":"豪邸","use":"home","one":true,"z":"abhik","cpm":900,"f0":1,"f1":3,"min":8,"max":40,"sh":["full","L","ko","ro"],"cat":"home","c":"#6b4b3a","rl":2.2,"dm":0.6},
   {"k":"wafu","n":"和風邸宅","use":"home","one":true,"z":"abhik","cpm":800,"f0":1,"f1":2,"min":6,"max":30,"sh":["full","L","ko"],"cat":"home","c":"#4f5a58","rl":1.9,"dm":0.65},
   {"k":"kominka","n":"古民家","use":"home","one":true,"z":"abhik","cpm":200,"f0":1,"f1":2,"min":3,"max":20,"sh":["full","L"],"cat":"home","c":"#6d5c48","rl":0.8,"dm":0.8},
   {"k":"machiya","n":"町家","use":"home","u":50,"g1":"shop","z":"bcdk","cpm":380,"f0":2,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#5b4636","rl":1.1},
   {"k":"log","n":"ログハウス","use":"home","one":true,"z":"ahik","cpm":300,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"home","c":"#9b6b3c","rl":1.1,"dm":0.7},
   {"k":"villa","n":"別荘","use":"home","one":true,"z":"hi","cpm":500,"f0":1,"f1":2,"min":4,"max":30,"sh":["full","L"],"cat":"home","c":"#7aa0a8","rl":1.5,"dm":0.5},
   {"k":"nagaya","n":"長屋","use":"home","u":35,"z":"abcek","cpm":250,"f0":1,"f1":2,"min":2,"max":12,"sh":["slab","full"],"cat":"home","c":"#7b6a58","rl":0.7,"dm":1.1,"dn":["{}長屋"]},
   {"k":"bunka","n":"文化住宅","use":"home","u":30,"z":"abcek","cpm":240,"f0":2,"f1":2,"min":2,"max":12,"sh":["full","slab"],"cat":"home","c":"#a08f78","rl":0.65,"dm":1.15,"dn":["{}文化","{}荘"]},
   {"k":"mokuapa","n":"木造アパート","use":"home","u":35,"z":"abcek","cpm":280,"f0":2,"f1":2,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#b39a7a","rl":0.85,"dm":1.05,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"tekkotsu","n":"鉄骨アパート","use":"home","u":40,"z":"abcek","cpm":340,"f0":2,"f1":3,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#9fa7ad","rl":0.95,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"gakusei","n":"学生アパート","use":"home","u":20,"z":"bcdek","cpm":320,"f0":2,"f1":4,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#a7b4bf","rl":0.8,"pp":1.2,"dn":["{}荘","コーポ{}"]},
   {"k":"designapa","n":"デザイナーズアパート","use":"home","u":45,"z":"abcdek","cpm":480,"f0":2,"f1":3,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#e8e3da","rl":1.35,"dm":0.9,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"share","n":"シェアハウス","use":"home","u":14,"z":"abcdek","cpm":360,"f0":2,"f1":3,"min":2,"max":8,"sh":["full"],"cat":"home","c":"#d1b48c","rl":0.9,"dm":1.1,"dn":["シェアハウス{}"]},
   {"k":"shataku","n":"社宅","use":"home","u":60,"z":"bcdek","cpm":450,"f0":3,"f1":6,"min":6,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#c8c2b5","rl":0.8,"dm":1.2,"dn":["{}社宅"]},
   {"k":"ryo","n":"社員寮","use":"home","u":18,"z":"bcdefk","cpm":400,"f0":2,"f1":6,"min":4,"max":40,"sh":["full","slab"],"cat":"home","c":"#bfb6a6","rl":0.6,"dm":1.2,"pp":1.2,"dn":["{}寮"]},
   {"k":"gakuryo","n":"学生寮","use":"home","u":16,"z":"abcdek","cpm":420,"f0":2,"f1":8,"min":4,"max":60,"sh":["full","slab"],"cat":"home","c":"#c4b9a3","rl":0.6,"pp":1.2,"dn":["{}学生寮"]},
   {"k":"senior","n":"高齢者向け住宅","use":"home","u":45,"z":"abcdek","cpm":600,"f0":2,"f1":6,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d6cbb8","rl":1.2,"dm":1.1,"pp":0.6,"dn":["{}シニアレジデンス"]},
   {"k":"danchi","n":"団地","use":"home","u":50,"z":"bcdek","cpm":420,"f0":4,"f1":5,"min":20,"max":600,"sh":["slab","L","full"],"cat":"home","c":"#d9d6cc","rl":0.75,"dm":1.15,"dn":["{}団地"]},
   {"k":"koei","n":"公営住宅","use":"home","u":55,"z":"bcdek","cpm":430,"f0":3,"f1":10,"min":10,"max":400,"sh":["slab","L","full"],"cat":"home","c":"#d2cfc4","rl":0.6,"dm":1.3,"dn":["{}住宅"]},
   {"k":"lowman","n":"低層マンション","use":"home","u":70,"z":"abcdek","cpm":600,"f0":2,"f1":4,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#e2ddd4","rl":1.15,"dm":0.95,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"midman","n":"中層マンション","use":"home","u":70,"z":"bcdek","cpm":620,"f0":5,"f1":9,"min":6,"max":100,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#dcd7ce","dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"highman","n":"高層マンション","use":"home","u":70,"z":"bcdk","cpm":700,"f0":10,"f1":19,"min":10,"max":160,"sh":["slab","L","full","tower"],"opt":["shop1"],"cat":"home","c":"#d5d9de","rl":1.05,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"luxman","n":"高級マンション","use":"home","u":110,"z":"abcdk","cpm":950,"f0":3,"f1":15,"min":8,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#c9c1b4","rl":1.7,"dm":0.75,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"designman","n":"デザイナーズマンション","use":"home","u":60,"z":"bcdk","cpm":800,"f0":3,"f1":10,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#ebe8e2","rl":1.35,"dm":0.9,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"petman","n":"ペット可マンション","use":"home","u":70,"z":"bcdek","cpm":650,"f0":3,"f1":10,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d8cfc0","rl":1.1,"dm":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"oneroom","n":"ワンルームマンション","use":"home","u":22,"z":"bcdk","cpm":650,"f0":3,"f1":12,"min":2,"max":40,"sh":["full","slab"],"cat":"home","c":"#cfd2d4","rl":1.0,"dm":1.15,"pp":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"family","n":"ファミリーマンション","use":"home","u":85,"z":"bcdek","cpm":620,"f0":4,"f1":14,"min":6,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#dfd8cb","dm":1.05,"pp":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"smartman","n":"スマートマンション","use":"home","u":65,"z":"bcdek","cpm":750,"f0":5,"f1":15,"min":6,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d2dbe0","rl":1.2,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"okushon","n":"億ション","use":"home","u":150,"z":"cd","cpm":1300,"f0":5,"f1":30,"min":10,"max":120,"sh":["slab","L","full","tower"],"cat":"home","c":"#b8ad9c","rl":2.6,"dm":0.55,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"servapa","n":"サービスアパートメント","use":"home","u":50,"z":"cd","cpm":900,"f0":5,"f1":20,"min":6,"max":80,"sh":["slab","full","tower"],"cat":"home","c":"#c7cdd2","rl":1.5,"dm":0.85,"dn":["{}サービスアパートメント"]},
   {"k":"supertower","n":"超高層マンション","use":"home","u":75,"z":"cd","cpm":1050,"f0":40,"f1":60,"min":30,"max":300,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#c4ccd6","rl":1.25,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"menshin","n":"免震タワーマンション","use":"home","u":75,"z":"cd","cpm":1150,"f0":25,"f1":50,"min":25,"max":300,"sh":["tower"],"cat":"home","c":"#bcc6d1","rl":1.35,"dm":0.95,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"stantower","n":"駅前タワーマンション","use":"home","u":70,"z":"cd","cpm":1000,"f0":25,"f1":45,"min":16,"max":200,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#c8d0d9","rl":1.2,"dm":1.1,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"tenpoman","n":"店舗つきマンション","use":"home","u":65,"g1":"shop","z":"bcdek","cpm":620,"f0":4,"f1":12,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d6cec2","rl":1.0,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"getaba","n":"下駄ばきアパート","use":"home","u":40,"g1":"shop","z":"bcdek","cpm":400,"f0":3,"f1":5,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#b7aa98","rl":0.9,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"kanban","n":"看板建築","use":"home","u":50,"g1":"shop","z":"bcdk","cpm":380,"f0":2,"f1":3,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#8a9a8a"},
   {"k":"shotennaga","n":"商店長屋","use":"home","u":40,"g1":"shop","z":"bcdk","cpm":300,"f0":2,"f1":2,"min":2,"max":12,"sh":["slab","full"],"cat":"home","c":"#8f7a62","rl":0.85,"dn":["{}長屋"]},
   {"k":"complexres","n":"複合マンション","use":"home","mix":[[0.15,"shop"],[0.4,"office"],[1,"home"]],"us":{"shop":60,"office":0,"home":70},"z":"cd","cpm":750,"f0":6,"f1":20,"min":8,"max":120,"sh":["slab","L","ko","ro","full","tower"],"cat":"home","c":"#d1d4d0","rl":1.05,"dn":["{}プレイス"]},
   {"k":"konbini","n":"コンビニ","use":"shop","one":true,"z":"abcdehk","cpm":300,"f0":1,"f1":1,"min":2,"max":12,"sh":["full"],"cat":"shop","c":"#f0f0ee","rl":1.1,"dm":1.2,"dn":["{}コンビニ"]},
   {"k":"super","n":"スーパー","use":"shop","one":true,"z":"bcdek","cpm":330,"f0":1,"f1":2,"min":10,"max":200,"sh":["full"],"cat":"shop","c":"#e9d8b4","rl":1.0,"dm":1.1,"fx":{"home":0.05},"dn":["{}スーパー"]},
   {"k":"bigsuper","n":"大型スーパー","use":"shop","one":true,"z":"cde","cpm":380,"f0":1,"f1":3,"min":40,"max":600,"sh":["full","slab"],"cat":"shop","c":"#e2cfa8","dm":1.0,"fx":{"home":0.06,"shop":0.03},"dn":["{}大型スーパー"]},
   {"k":"drug","n":"ドラッグストア","use":"shop","one":true,"z":"bcdek","cpm":320,"f0":1,"f1":2,"min":4,"max":60,"sh":["full"],"cat":"shop","c":"#e7eef2","dm":1.1,"dn":["{}ドラッグストア"]},
   {"k":"kaitenzushi","n":"回転寿司","use":"shop","one":true,"z":"bcdek","cpm":400,"f0":1,"f1":2,"min":4,"max":20,"sh":["full"],"cat":"shop","c":"#e4c9a8","rl":1.05,"dm":1.15,"dn":["{}回転寿司"]},
   {"k":"dollar","n":"100円ショップ","use":"shop","one":true,"z":"bcdek","cpm":320,"f0":1,"f1":2,"min":4,"max":40,"sh":["full"],"cat":"shop","c":"#f2e0c2","rl":0.85,"dm":1.25,"dn":["{}100円ショップ"]},
   {"k":"books","n":"書店","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":3,"min":2,"max":30,"sh":["full"],"cat":"shop","c":"#d8c6a6","rl":0.9,"dm":0.95,"dn":["{}書店"]},
   {"k":"kaden","n":"家電量販店","use":"shop","one":true,"z":"cde","cpm":420,"f0":1,"f1":6,"min":20,"max":400,"sh":["full","slab"],"cat":"shop","c":"#dfe4ea","fx":{"shop":0.03},"dn":["{}家電"]},
   {"k":"homecenter","n":"ホームセンター","use":"shop","one":true,"z":"cdef","cpm":280,"f0":1,"f1":2,"min":60,"max":1200,"sh":["full","slab"],"cat":"shop","c":"#e6d9c0","rl":0.8,"dm":1.1,"dn":["{}ホームセンター"]},
   {"k":"fashion","n":"衣料品店","use":"shop","one":true,"z":"bcdk","cpm":420,"f0":1,"f1":3,"min":2,"max":40,"sh":["full"],"cat":"shop","c":"#ead7da","rl":1.05,"dn":["{}衣料品店"]},
   {"k":"depart","n":"百貨店","use":"shop","u":300,"z":"cd","cpm":900,"f0":5,"f1":12,"min":60,"max":800,"sh":["full","slab"],"cat":"shop","c":"#d8c3a5","rl":1.3,"dm":0.95,"fx":{"shop":0.12,"office":0.04},"dn":["{}百貨店","{}デパート"]},
   {"k":"fashionbldg","n":"ファッションビル","use":"shop","u":60,"z":"cd","cpm":850,"f0":5,"f1":12,"min":10,"max":200,"sh":["full","slab","tower"],"cat":"shop","c":"#e3cfd6","rl":1.3,"dm":0.95,"fx":{"shop":0.06},"dn":["{}ファッションビル"]},
   {"k":"ekibiru","n":"駅ビル","use":"shop","mix":[[0.5,"shop"],[1,"office"]],"us":{"shop":80,"office":0},"z":"cd","cpm":850,"f0":3,"f1":12,"min":10,"max":200,"sh":["full","slab"],"cat":"shop","c":"#d6ccbd","rl":1.25,"dm":1.1,"fx":{"shop":0.08},"dn":["{}駅ビル"]},
   {"k":"famires","n":"ファミリーレストラン","use":"shop","one":true,"z":"bcdek","cpm":380,"f0":1,"f1":2,"min":4,"max":30,"sh":["full"],"cat":"shop","c":"#efc89a","dn":["{}ファミリーレストラン"]},
   {"k":"ramen","n":"ラーメン屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#d9a066","rl":1.1,"dm":1.1,"dn":["{}ラーメン屋"]},
   {"k":"soba","n":"そば屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#9c7a52","dn":["{}そば屋"]},
   {"k":"sushi","n":"寿司屋","use":"shop","one":true,"z":"bcdk","cpm":500,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#c9b08a","rl":1.4,"dm":0.85,"dn":["{}寿司屋"]},
   {"k":"kissa","n":"喫茶店","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#a47b55","rl":0.95,"dn":["{}喫茶店"]},
   {"k":"cafe","n":"カフェ","use":"shop","one":true,"z":"bcdk","cpm":450,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#b88a5e","rl":1.2,"dn":["{}カフェ"]},
   {"k":"izakaya","n":"居酒屋","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"cat":"shop","c":"#a8613e","rl":1.05,"dm":1.05,"dn":["{}居酒屋"]},
   {"k":"yakiniku","n":"焼肉店","use":"shop","one":true,"z":"bcdk","cpm":420,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"shop","c":"#8f4a35","rl":1.15,"dn":["{}焼肉店"]},
   {"k":"fastfood","n":"ファストフード店","use":"shop","one":true,"z":"bcdek","cpm":400,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"shop","c":"#e9b44c","rl":1.05,"dm":1.15,"dn":["{}ファストフード店"]},
   {"k":"bakery","n":"パン屋","use":"shop","one":true,"z":"abcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#dcb07a","dn":["{}パン屋"]},
   {"k":"cake","n":"ケーキ屋","use":"shop","one":true,"z":"abcdk","cpm":420,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#efd1d6","rl":1.15,"dm":0.9,"dn":["{}ケーキ屋"]},
   {"k":"wagashi","n":"和菓子屋","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#b98f7a","dn":["{}和菓子屋"]},
   {"k":"flower","n":"花屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":1,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#e6b8c8","rl":0.9,"dn":["{}花屋"]},
   {"k":"yaoya","n":"八百屋","use":"shop","one":true,"z":"bcdk","cpm":280,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#9fbf6f","rl":0.85,"dm":1.05,"dn":["{}八百屋"]},
   {"k":"sakanaya","n":"魚屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#8fb3c4","rl":0.85,"dn":["{}魚屋"]},
   {"k":"nikuya","n":"肉屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#c47f74","rl":0.85,"dn":["{}肉屋"]},
   {"k":"sakaya","n":"酒屋","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#a3866a","rl":0.95,"dn":["{}酒屋"]},
   {"k":"zakka","n":"雑貨店","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#e0cdb5","rl":1.05,"dn":["{}雑貨店"]},
   {"k":"stationery","n":"文房具店","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#c8cfd8","rl":0.85,"dn":["{}文房具店"]},
   {"k":"toy","n":"おもちゃ屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"cat":"shop","c":"#f0c56a","rl":0.95,"dn":["{}おもちゃ屋"]},
   {"k":"megane","n":"メガネ・時計店","use":"shop","one":true,"z":"bcdk","cpm":450,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#b9c2cc","rl":1.2,"dm":0.85,"dn":["{}メガネ・時計店"]},
   {"k":"bicycle","n":"自転車店","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#9fb6a0","rl":0.9,"dn":["{}自転車店"]},
   {"k":"furuhon","n":"古本屋","use":"shop","one":true,"z":"bcdk","cpm":280,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#a69276","rl":0.8,"dn":["{}古本屋"]},
   {"k":"shichiya","n":"質屋","use":"shop","one":true,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#8d8476","rl":1.1,"dm":0.8,"dn":["{}質屋"]},
   {"k":"pharmacy","n":"調剤薬局","use":"shop","one":true,"z":"abcdek","cpm":380,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#dfeaf0","rl":1.1,"dm":1.05,"dn":["{}調剤薬局"]},
   {"k":"biyou","n":"美容室","use":"shop","one":true,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#e9c9d3","rl":1.05,"dn":["{}美容室"]},
   {"k":"riyou","n":"理容室","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#c2d0e0","rl":0.85,"dn":["{}理容室"]},
   {"k":"cleaning","n":"クリーニング店","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#d3e2ea","rl":0.85,"dn":["{}クリーニング店"]},
   {"k":"dealer","n":"カーディーラー","use":"shop","one":true,"z":"cdef","cpm":450,"f0":1,"f1":2,"min":10,"max":100,"sh":["full"],"cat":"shop","c":"#c9d4de","rl":1.3,"dm":0.8,"dn":["{}自動車販売"]},
   {"k":"gas","n":"ガソリンスタンド","use":"shop","one":true,"z":"bcdefghk","cpm":350,"f0":1,"f1":1,"min":6,"max":40,"sh":["full"],"cat":"shop","c":"#e4dfcf","rl":1.0,"dn":["{}給油所"]},
   {"k":"arcadeshop","n":"商店街（アーケード）","use":"shop","u":40,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":6,"max":120,"sh":["slab","full"],"cat":"shop","c":"#d9c3a1","rl":0.95,"dm":1.1,"fx":{"shop":0.05},"dn":["{}商店街"]},
   {"k":"outlet","n":"アウトレットモール","use":"shop","u":120,"z":"cdeh","cpm":400,"f0":1,"f1":2,"min":200,"max":1600,"sh":["full","slab","ro"],"cat":"shop","c":"#e7d6bd","rl":0.9,"fx":{"hotel":0.05},"dn":["{}アウトレット"]},
   {"k":"michinoeki","n":"道の駅","use":"shop","u":60,"z":"hi","cpm":300,"f0":1,"f1":1,"min":20,"max":400,"sh":["full","slab"],"cat":"shop","c":"#cdb98f","rl":0.8,"dm":1.2,"dn":["道の駅 {}"]},
   {"k":"ichiba","n":"市場","use":"shop","u":25,"z":"cdegk","cpm":250,"f0":1,"f1":1,"min":10,"max":200,"sh":["full","slab"],"cat":"shop","c":"#c9b48e","rl":0.8,"dm":1.15,"dn":["{}市場"]},
   {"k":"yatai","n":"屋台村","use":"shop","u":12,"z":"bcdk","cpm":200,"f0":1,"f1":1,"min":4,"max":60,"sh":["full"],"cat":"shop","c":"#b7865c","rl":0.75,"dm":1.2,"dn":["{}屋台村"]},
   {"k":"smalloffice","n":"小さなオフィスビル","use":"office","u":0,"z":"cde","cpm":600,"f0":3,"f1":6,"min":2,"max":20,"sh":["full","slab"],"cat":"biz","c":"#b9c4cf","rl":0.9,"dn":["{}ビル"]},
   {"k":"pencil","n":"ペンシルビル","use":"office","u":0,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":12,"min":1,"max":4,"sh":["full"],"cat":"biz","c":"#c0c8d0","rl":0.95,"dn":["{}ビル"]},
   {"k":"midoffice","n":"中規模オフィスビル","use":"office","u":0,"z":"cd","cpm":820,"f0":8,"f1":20,"min":10,"max":160,"sh":["full","slab","L"],"cat":"biz","c":"#aab8c8","dn":["{}ビル","{}センタービル"]},
   {"k":"bigoffice","n":"大規模オフィスビル","use":"office","u":0,"z":"d","cpm":900,"f0":15,"f1":35,"min":40,"max":400,"sh":["full","slab","L","tower"],"opt":["shop1"],"cat":"biz","c":"#a2b2c5","rl":1.1,"dn":["{}センタービル","{}ビルディング"]},
   {"k":"hq","n":"本社ビル","use":"office","u":0,"z":"cd","cpm":1000,"f0":10,"f1":40,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#8fa2b8","rl":1.25,"dm":0.9,"dn":["{}本社ビル"]},
   {"k":"intelligent","n":"インテリジェントビル","use":"office","u":0,"z":"cd","cpm":1150,"f0":10,"f1":40,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#9cb6cc","rl":1.35,"dm":0.95,"dn":["{}インテリジェントビル"]},
   {"k":"skyoffice","n":"超高層オフィスビル","use":"office","u":0,"g1":"shop","g2":"shop","z":"d","cpm":1300,"f0":40,"f1":70,"min":40,"max":600,"sh":["tower"],"cat":"biz","c":"#8ea8c4","rl":1.3,"fx":{"office":0.05,"shop":0.04},"dn":["{}タワー","{}スカイタワー"]},
   {"k":"complex","n":"複合ビル","use":"office","u":0,"mix":[[0.25,"shop"],[1,"office"]],"us":{"shop":60,"office":0},"z":"cd","cpm":900,"f0":6,"f1":25,"min":8,"max":200,"sh":["full","slab","tower"],"cat":"biz","c":"#b3bfca","rl":1.1,"dn":["{}スクエア"]},
   {"k":"it","n":"ITオフィス","use":"office","u":0,"z":"cd","cpm":850,"f0":5,"f1":20,"min":6,"max":120,"sh":["full","slab"],"cat":"biz","c":"#a8c3cf","rl":1.1,"dm":1.1,"pp":1.2,"dn":["{}ITオフィス"]},
   {"k":"startup","n":"スタートアップビル","use":"office","u":30,"z":"cd","cpm":650,"f0":3,"f1":8,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#bccad0","rl":0.95,"dm":1.15,"dn":["{}スタートアップビル"]},
   {"k":"coworking","n":"コワーキングスペース","use":"office","u":20,"z":"cd","cpm":700,"f0":2,"f1":8,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#c7d3d8","rl":1.15,"dm":1.05,"pp":1.3,"dn":["{}コワーキングスペース"]},
   {"k":"rentalmtg","n":"貸会議室ビル","use":"office","u":40,"z":"cd","cpm":700,"f0":3,"f1":12,"min":2,"max":60,"sh":["full","slab"],"cat":"biz","c":"#bdc6cf","dn":["{}貸会議室ビル"]},
   {"k":"lawoffice","n":"法律事務所ビル","use":"office","u":60,"z":"cd","cpm":750,"f0":3,"f1":10,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#a9b1bb","rl":1.15,"dn":["{}法律事務所ビル"]},
   {"k":"ad","n":"広告代理店ビル","use":"office","u":0,"z":"cd","cpm":950,"f0":6,"f1":25,"min":10,"max":200,"sh":["full","slab","tower"],"cat":"biz","c":"#b6a9c4","rl":1.2,"dn":["{}広告代理店ビル"]},
   {"k":"publisher","n":"出版社","use":"office","u":0,"z":"cd","cpm":800,"f0":4,"f1":12,"min":4,"max":80,"sh":["full","slab"],"cat":"biz","c":"#b5b0a5","dn":["{}出版"]},
   {"k":"newspaper","n":"新聞社","use":"office","u":0,"z":"cd","cpm":900,"f0":6,"f1":20,"min":10,"max":200,"sh":["full","slab"],"cat":"biz","c":"#a7a39a","rl":1.05,"dn":["{}新聞社"]},
   {"k":"tvstation","n":"放送局","use":"office","u":0,"z":"cd","cpm":1100,"f0":5,"f1":30,"min":40,"max":600,"sh":["full","slab","tower"],"cat":"biz","c":"#9bb0c6","rl":1.3,"dm":0.8,"fx":{"office":0.05},"dn":["{}放送センター"]},
   {"k":"bankhq","n":"銀行の本店","use":"office","u":0,"z":"cd","cpm":1150,"f0":8,"f1":30,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#94a1ad","rl":1.35,"dm":0.85,"fx":{"office":0.05},"dn":["{}銀行本店"]},
   {"k":"bankbranch","n":"銀行の支店","use":"office","u":0,"z":"bcdk","cpm":800,"f0":2,"f1":5,"min":2,"max":30,"sh":["full"],"cat":"biz","c":"#a5b0ba","rl":1.1,"dn":["{}支店"]},
   {"k":"shinkin","n":"信用金庫","use":"office","u":0,"z":"bcdk","cpm":700,"f0":2,"f1":4,"min":2,"max":30,"sh":["full"],"cat":"biz","c":"#a9b6b0","dn":["{}信用金庫"]},
   {"k":"securities","n":"証券会社","use":"office","u":0,"z":"cd","cpm":1000,"f0":6,"f1":25,"min":6,"max":160,"sh":["full","slab"],"cat":"biz","c":"#9eaabd","rl":1.25,"dn":["{}証券ビル"]},
   {"k":"insurance","n":"保険会社","use":"office","u":0,"z":"cd","cpm":950,"f0":8,"f1":30,"min":10,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#a3b4c0","rl":1.1,"dn":["{}生命ビル"]},
   {"k":"postoffice","n":"郵便局","use":"office","u":0,"z":"abcdek","cpm":600,"f0":1,"f1":4,"min":4,"max":60,"sh":["full","slab"],"cat":"biz","c":"#d98a7a","rl":0.9,"dm":1.2,"dn":["{}郵便局"]},
   {"k":"travel","n":"旅行代理店ビル","use":"office","u":0,"z":"cd","cpm":700,"f0":2,"f1":6,"min":2,"max":30,"sh":["full","slab"],"cat":"biz","c":"#b9cbd6","rl":0.95,"fx":{"hotel":0.03},"dn":["{}旅行代理店ビル"]},
   {"k":"lab","n":"研究所","use":"office","u":0,"z":"cdef","cpm":750,"f0":2,"f1":8,"min":20,"max":800,"sh":["full","slab"],"cat":"biz","c":"#b7c2b7","rl":0.9,"dm":1.05,"dn":["{}研究所"]},
   {"k":"datacenter","n":"データセンター","use":"office","u":0,"z":"cdef","cpm":1100,"f0":2,"f1":6,"min":20,"max":600,"sh":["full","slab"],"cat":"biz","c":"#7f8d99","rl":1.2,"dm":1.1,"pp":0.1,"dn":["{}データセンター"]},
   {"k":"callcenter","n":"コールセンター","use":"office","u":0,"z":"cde","cpm":650,"f0":3,"f1":10,"min":10,"max":200,"sh":["full","slab"],"cat":"biz","c":"#b0bcc8","rl":0.85,"dm":1.1,"pp":1.5,"dn":["{}コールセンター"]},
   {"k":"bizhotel","n":"ビジネスホテル","use":"hotel","one":true,"z":"cde","cpm":700,"f0":5,"f1":15,"min":3,"max":60,"sh":["full","slab","tower"],"sc":"bizhotel","cat":"hotel","c":"#c9b9a8","dn":["ホテル{}","{}ホテル"]},
   {"k":"stahotel","n":"駅前ホテル","use":"hotel","one":true,"z":"cd","cpm":750,"f0":6,"f1":20,"min":4,"max":80,"sh":["full","slab","tower"],"sc":"stahotel","cat":"hotel","c":"#c2b4a4","dn":["{}駅前ホテル"]},
   {"k":"cityhotel","n":"シティホテル","use":"hotel","one":true,"z":"cd","cpm":900,"f0":8,"f1":30,"min":20,"max":300,"sh":["full","slab","L","tower"],"sc":"cityhotel","cat":"hotel","c":"#b8a48c","dn":["{}シティホテル","ホテル{}"]},
   {"k":"luxhotel","n":"高級ホテル","use":"hotel","one":true,"z":"cd","cpm":1400,"f0":10,"f1":50,"min":30,"max":400,"sh":["tower","full","slab"],"sc":"luxhotel","cat":"hotel","c":"#a38d6f","fx":{"shop":0.04},"dn":["ホテル{}","グランドホテル{}"]},
   {"k":"resort","n":"リゾートホテル","use":"hotel","one":true,"z":"abhik","cpm":900,"f0":3,"f1":15,"min":40,"max":1600,"sh":["slab","L","ko","full"],"sc":"resort","cat":"hotel","c":"#d6c6a2","fx":{"shop":0.03},"dn":["{}リゾートホテル"]},
   {"k":"ryokan","n":"旅館","use":"hotel","one":true,"z":"abchik","cpm":650,"f0":1,"f1":4,"min":6,"max":200,"sh":["L","ko","full"],"sc":"ryokan","cat":"hotel","c":"#6f6658","dn":["旅館 {}","{}旅館"]},
   {"k":"onsenryokan","n":"温泉旅館","use":"hotel","one":true,"z":"hi","cpm":800,"f0":2,"f1":8,"min":10,"max":400,"sh":["L","ko","full"],"sc":"onsenryokan","cat":"hotel","c":"#5f5a52","dn":["{}温泉旅館"]},
   {"k":"minshuku","n":"民宿","use":"hotel","one":true,"z":"abhik","cpm":350,"f0":1,"f1":3,"min":2,"max":30,"sh":["full","L"],"sc":"minshuku","cat":"hotel","c":"#8c7a62","dn":["民宿 {}"]},
   {"k":"pension","n":"ペンション","use":"hotel","one":true,"z":"ahik","cpm":450,"f0":2,"f1":3,"min":3,"max":30,"sh":["full","L"],"sc":"pension","cat":"hotel","c":"#b5876a","dn":["ペンション {}"]},
   {"k":"capsule","n":"カプセルホテル","use":"hotel","one":true,"z":"cd","cpm":650,"f0":3,"f1":10,"min":1,"max":20,"sh":["full"],"sc":"capsule","cat":"hotel","c":"#b9c0c6","dn":["{}カプセルホテル"]},
   {"k":"guesthouse","n":"ゲストハウス","use":"hotel","one":true,"z":"bcdk","cpm":400,"f0":2,"f1":4,"min":1,"max":10,"sh":["full"],"sc":"guesthouse","cat":"hotel","c":"#c4a98a","dn":["ゲストハウス {}"]},
   {"k":"condo","n":"コンドミニアム","use":"hotel","one":true,"z":"cdh","cpm":900,"f0":5,"f1":30,"min":10,"max":200,"sh":["slab","L","tower","full"],"sc":"condo","cat":"hotel","c":"#cbc3b3","dn":["{}コンドミニアム"]},
   {"k":"clinic","n":"診療所","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":4,"min":1,"max":10,"sh":["full"],"sc":"clinic","cat":"med","c":"#e3ecef","dn":["{}クリニック"]},
   {"k":"dental","n":"歯科医院","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"sc":"dental","cat":"med","c":"#e9f0f2","dn":["{}歯科医院"]},
   {"k":"pedi","n":"小児科医院","use":"hospital","one":true,"z":"abcdek","cpm":550,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"sc":"pedi","cat":"med","c":"#f0e7d8","fx":{"home":0.03},"dn":["{}こどもクリニック"]},
   {"k":"eye","n":"眼科","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"sc":"eye","cat":"med","c":"#dfe8ef","dn":["{}眼科"]},
   {"k":"vet","n":"動物病院","use":"hospital","one":true,"z":"abcdek","cpm":550,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"sc":"vet","cat":"med","c":"#e2ead9","dn":["{}動物病院"]},
   {"k":"obgyn","n":"産婦人科","use":"hospital","one":true,"z":"bcdek","cpm":800,"f0":2,"f1":6,"min":4,"max":40,"sh":["full","slab"],"sc":"obgyn","cat":"med","c":"#f0dfe2","dn":["{}レディースクリニック"]},
   {"k":"hospital","n":"総合病院","use":"hospital","one":true,"z":"bcdek","cpm":1000,"f0":4,"f1":15,"min":30,"max":600,"sh":["full","slab","L","tower"],"sc":"hospital","cat":"med","c":"#e8eef2","fx":{"home":0.05,"shop":0.03},"dn":["{}総合病院"]},
   {"k":"erhosp","n":"救急病院","use":"hospital","one":true,"z":"bcdek","cpm":1100,"f0":4,"f1":12,"min":20,"max":400,"sh":["full","slab","L"],"sc":"erhosp","cat":"med","c":"#e6e1e1","fx":{"home":0.04},"dn":["{}救急病院"]},
   {"k":"bighosp","n":"大病院","use":"hospital","one":true,"z":"bcdehk","cpm":1200,"f0":8,"f1":30,"min":80,"max":1600,"sh":["full","slab","L","ko","tower"],"sc":"bighosp","cat":"med","c":"#dfe7ec","fx":{"home":0.06,"shop":0.04},"dn":["{}医療センター"]},
   {"k":"nursing","n":"老人ホーム","use":"hospital","one":true,"z":"abcdehk","cpm":600,"f0":2,"f1":8,"min":6,"max":200,"sh":["full","slab","L"],"sc":"nursing","cat":"med","c":"#e4dccd","dn":["{}老人ホーム"]},
   {"k":"care","n":"介護施設","use":"hospital","one":true,"z":"abcdehk","cpm":550,"f0":1,"f1":4,"min":4,"max":120,"sh":["full","slab","L"],"sc":"care","cat":"med","c":"#ded7c8","dn":["{}介護センター"]},
   {"k":"dayserv","n":"デイサービスセンター","use":"hospital","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":2,"max":30,"sh":["full"],"sc":"dayserv","cat":"med","c":"#e8e0cf","dn":["デイサービス{}"]},
   {"k":"cinema","n":"映画館","use":"leisure","one":true,"z":"cde","cpm":800,"f0":2,"f1":8,"min":10,"max":200,"sh":["full","slab"],"sc":"cinema","cat":"fun","c":"#5c5f6e","dn":["{}シネマ"]},
   {"k":"theater","n":"劇場","use":"leisure","one":true,"z":"cd","cpm":1000,"f0":3,"f1":10,"min":20,"max":300,"sh":["full","slab"],"sc":"theater","cat":"fun","c":"#8a4f45","fx":{"shop":0.03},"dn":["{}劇場"]},
   {"k":"hall","n":"コンサートホール","use":"leisure","one":true,"z":"cd","cpm":1000,"f0":3,"f1":10,"min":20,"max":400,"sh":["full","slab"],"sc":"hall","cat":"fun","c":"#9b7b63","dn":["{}ホール"]},
   {"k":"livehouse","n":"ライブハウス","use":"leisure","one":true,"z":"cd","cpm":600,"f0":1,"f1":4,"min":2,"max":20,"sh":["full"],"sc":"livehouse","cat":"fun","c":"#4f4a55","dn":["ライブハウス{}"]},
   {"k":"bowling","n":"ボウリング場","use":"leisure","one":true,"z":"cde","cpm":500,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"bowling","cat":"fun","c":"#c96d5a","dn":["{}ボウル"]},
   {"k":"arcade","n":"ゲームセンター","use":"leisure","one":true,"z":"cd","cpm":550,"f0":1,"f1":4,"min":2,"max":60,"sh":["full"],"sc":"arcade","cat":"fun","c":"#d77fb0","dn":["ゲーム{}"]},
   {"k":"karaoke","n":"カラオケ店","use":"leisure","one":true,"z":"cd","cpm":600,"f0":2,"f1":8,"min":2,"max":40,"sh":["full"],"sc":"karaoke","cat":"fun","c":"#c98bd6","dn":["カラオケ{}"]},
   {"k":"pachinko","n":"パチンコ店","use":"leisure","one":true,"z":"cde","cpm":600,"f0":1,"f1":3,"min":6,"max":120,"sh":["full","slab"],"sc":"pachinko","cat":"fun","c":"#e3a83a","fx":{"home":-0.03},"dn":["{}ホール"]},
   {"k":"kbshop","n":"場外馬券売り場","use":"leisure","one":true,"z":"cdef","cpm":700,"f0":2,"f1":8,"min":20,"max":400,"sh":["full","slab"],"sc":"kbshop","cat":"fun","c":"#5f8a62","fx":{"shop":0.03},"dn":["{}場外馬券売り場"]},
   {"k":"batting","n":"バッティングセンター","use":"leisure","one":true,"z":"cdefh","cpm":300,"f0":1,"f1":1,"min":10,"max":120,"sh":["full"],"sc":"batting","cat":"fun","c":"#7fae7a","dn":["{}バッティングセンター"]},
   {"k":"sportsclub","n":"スポーツクラブ","use":"leisure","one":true,"z":"bcdk","cpm":700,"f0":2,"f1":6,"min":4,"max":80,"sh":["full","slab"],"sc":"sportsclub","cat":"fun","c":"#7aa3c8","dn":["{}スポーツクラブ"]},
   {"k":"pool","n":"屋内プール","use":"leisure","one":true,"z":"bcdek","cpm":800,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"pool","cat":"fun","c":"#7cc2d8","dn":["{}プール"]},
   {"k":"skate","n":"スケートリンク","use":"leisure","one":true,"z":"cde","cpm":800,"f0":1,"f1":2,"min":20,"max":200,"sh":["full","slab"],"sc":"skate","cat":"fun","c":"#a9d4e6","dn":["{}スケートリンク"]},
   {"k":"superonsen","n":"スーパー銭湯","use":"leisure","one":true,"z":"cdeh","cpm":600,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"superonsen","cat":"fun","c":"#b78d6c","dn":["{}の湯"]},
   {"k":"sento","n":"銭湯","use":"leisure","one":true,"z":"abcdek","cpm":400,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"sc":"sento","cat":"fun","c":"#7d9bb0","dn":["{}湯"]},
   {"k":"wedding","n":"結婚式場","use":"leisure","one":true,"z":"bcdhk","cpm":1000,"f0":2,"f1":6,"min":10,"max":200,"sh":["full","L","ko"],"sc":"wedding","cat":"fun","c":"#efe6da","dn":["{}迎賓館","{}会館"]},
   {"k":"arena","n":"アリーナ","use":"leisure","one":true,"z":"cde","cpm":900,"f0":2,"f1":5,"min":60,"max":800,"sh":["full","ro"],"sc":"arena","cat":"fun","c":"#a7b0b8","fx":{"shop":0.04,"hotel":0.04},"dn":["{}アリーナ"]},
   {"k":"baseball","n":"野球場","use":"leisure","one":true,"z":"cdeh","cpm":700,"f0":1,"f1":2,"min":300,"max":1600,"sh":["ro","full"],"sc":"baseball","cat":"fun","c":"#6fa35a","fx":{"shop":0.05,"hotel":0.05},"dn":["{}球場","{}スタジアム"]},
   {"k":"soccer","n":"サッカースタジアム","use":"leisure","one":true,"z":"cdeh","cpm":700,"f0":1,"f1":2,"min":300,"max":1600,"sh":["ro","full"],"sc":"soccer","cat":"fun","c":"#5f9a62","fx":{"shop":0.05,"hotel":0.05},"dn":["{}スタジアム"]},
   {"k":"convention","n":"展示場","use":"leisure","one":true,"z":"cdefgk","cpm":700,"f0":1,"f1":4,"min":100,"max":1600,"sh":["full","slab"],"sc":"convention","cat":"fun","c":"#b7c0c9","fx":{"hotel":0.12,"shop":0.04},"dn":["{}国際展示場","{}メッセ"]},
   {"k":"aquarium","n":"水族館","use":"leisure","one":true,"z":"cdgk","cpm":1200,"f0":2,"f1":5,"min":30,"max":400,"sh":["full","slab","L"],"sc":"aquarium","cat":"fun","c":"#5f9fc2","fx":{"hotel":0.08},"dn":["{}水族館"]},
   {"k":"artmuseum","n":"美術館","use":"leisure","one":true,"z":"abcdek","cpm":1100,"f0":2,"f1":5,"min":20,"max":400,"sh":["full","L","ko"],"sc":"artmuseum","cat":"fun","c":"#d0c8bc","dn":["{}美術館"]},
   {"k":"museum","n":"博物館","use":"leisure","one":true,"z":"abcdek","cpm":1000,"f0":2,"f1":6,"min":20,"max":400,"sh":["full","L","ko"],"sc":"museum","cat":"fun","c":"#bcb3a4","dn":["{}博物館"]},
   {"k":"science","n":"科学館","use":"leisure","one":true,"z":"bcdek","cpm":1000,"f0":2,"f1":5,"min":20,"max":300,"sh":["full","L"],"sc":"science","cat":"fun","c":"#a7bccb","dn":["{}科学館"]},
   {"k":"shrine","n":"神社","use":"leisure","one":true,"z":"abcdehik","cpm":600,"f0":1,"f1":1,"min":4,"max":400,"sh":["full","L"],"sc":"shrine","cat":"fun","c":"#c0392b","dn":["{}神社"]},
   {"k":"temple","n":"寺","use":"leisure","one":true,"z":"abcdehik","cpm":700,"f0":1,"f1":2,"min":6,"max":600,"sh":["full","L","ko"],"sc":"temple","cat":"fun","c":"#5a5550","dn":["{}寺","{}院"]},
   {"k":"church","n":"教会","use":"leisure","one":true,"z":"abcdek","cpm":800,"f0":1,"f1":3,"min":2,"max":60,"sh":["full"],"sc":"church","cat":"fun","c":"#d9d4cc","dn":["{}教会"]},
   {"k":"golfrange","n":"ゴルフ練習場","use":"leisure","one":true,"z":"cdefh","cpm":120,"f0":0,"f1":0,"min":40,"max":600,"sh":["full"],"sc":"golfrange","cat":"fun","c":"#86bf6a","pat":"lawn","dn":["{}ゴルフガーデン"]},
   {"k":"golf","n":"ゴルフ場","use":"leisure","one":true,"z":"hi","cpm":60,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"golf","cat":"fun","c":"#78b05e","fx":{"hotel":0.05},"pat":"golf","dn":["{}カントリークラブ"]},
   {"k":"tennis","n":"テニスコート","use":"leisure","one":true,"z":"abcdehk","cpm":100,"f0":0,"f1":0,"min":6,"max":200,"sh":["full"],"sc":"tennis","cat":"fun","c":"#5f9e6e","pat":"court","dn":["{}テニスクラブ"]},
   {"k":"athletics","n":"陸上競技場","use":"leisure","one":true,"z":"bcdehk","cpm":200,"f0":0,"f1":0,"min":200,"max":1600,"sh":["full"],"sc":"athletics","cat":"fun","c":"#93c56a","pat":"track","dn":["{}陸上競技場"]},
   {"k":"amuse","n":"遊園地","use":"leisure","one":true,"z":"cdeh","cpm":300,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"amuse","cat":"fun","c":"#e6c3d6","fx":{"hotel":0.15,"shop":0.04},"pat":"amuse","dn":["{}ランド","{}遊園地"]},
   {"k":"tpark","n":"テーマパーク","use":"leisure","one":true,"z":"cdefgh","cpm":500,"f0":0,"f1":0,"min":3000,"max":10000,"sh":["full"],"sc":"tpark","cat":"fun","c":"#efc7de","fx":{"hotel":0.3,"shop":0.08},"pat":"tpark","dn":["{}ランド","{}パーク"]},
   {"k":"zoo","n":"動物園","use":"leisure","one":true,"z":"abcdehk","cpm":150,"f0":0,"f1":0,"min":200,"max":1600,"sh":["full"],"sc":"zoo","cat":"fun","c":"#a9c98a","fx":{"hotel":0.06},"pat":"trees","dn":["{}動物園"]},
   {"k":"botanical","n":"植物園","use":"leisure","one":true,"z":"abcdehk","cpm":100,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"botanical","cat":"fun","c":"#9fcf8f","pat":"trees","dn":["{}植物園"]},
   {"k":"camp","n":"キャンプ場","use":"leisure","one":true,"z":"hi","cpm":30,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"camp","cat":"fun","c":"#7fb070","pat":"trees","dn":["{}キャンプ場"]},
   {"k":"fishing","n":"釣り堀","use":"leisure","one":true,"z":"cdeh","cpm":80,"f0":0,"f1":0,"min":10,"max":200,"sh":["full"],"sc":"fishing","cat":"fun","c":"#7fb8d4","pat":"water","dn":["{}釣り堀"]},
   {"k":"ski","n":"スキー場","use":"leisure","one":true,"z":"i","cpm":80,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"ski","cat":"fun","c":"#eef3f6","fx":{"hotel":0.1},"pat":"snow","dn":["{}スキー場"]},
   {"k":"nursery","n":"保育園","use":"school","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":2,"max":20,"sh":["full","L"],"sc":"nursery","cat":"school","c":"#f2d49b","fx":{"home":0.03},"dn":["{}保育園"]},
   {"k":"kinder","n":"幼稚園","use":"school","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":3,"max":30,"sh":["full","L"],"sc":"kinder","cat":"school","c":"#f5c98a","fx":{"home":0.03},"dn":["{}幼稚園"]},
   {"k":"esjhs","n":"小中一貫校","use":"school","one":true,"z":"abcek","cpm":380,"f0":2,"f1":5,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"esjhs","cat":"school","c":"#d4b07a","fx":{"home":0.04},"dn":["{}学園"]},
   {"k":"jhshs","n":"中高一貫校","use":"school","one":true,"z":"abcdek","cpm":420,"f0":2,"f1":6,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"jhshs","cat":"school","c":"#b9935f","dn":["{}学院","{}学園"]},
   {"k":"techhs","n":"工業高校","use":"school","one":true,"z":"bcdefk","cpm":400,"f0":2,"f1":5,"min":30,"max":800,"sh":["full","slab","L"],"sc":"techhs","cat":"school","c":"#a98e6c","dn":["{}工業高校"]},
   {"k":"comhs","n":"商業高校","use":"school","one":true,"z":"bcdek","cpm":400,"f0":2,"f1":5,"min":20,"max":600,"sh":["full","slab","L"],"sc":"comhs","cat":"school","c":"#b49a72","dn":["{}商業高校"]},
   {"k":"jc","n":"短期大学","use":"school","one":true,"z":"abcdek","cpm":500,"f0":2,"f1":8,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"jc","cat":"school","c":"#b07a5e","dn":["{}短期大学"]},
   {"k":"cram","n":"学習塾","use":"school","one":true,"z":"bcdk","cpm":500,"f0":2,"f1":5,"min":1,"max":10,"sh":["full"],"sc":"cram","cat":"school","c":"#c8b3d6","dn":["{}ゼミナール"]},
   {"k":"prep","n":"予備校","use":"school","one":true,"z":"cd","cpm":650,"f0":4,"f1":12,"min":4,"max":60,"sh":["full","slab"],"sc":"prep","cat":"school","c":"#b2a3c9","dn":["{}予備校"]},
   {"k":"eikaiwa","n":"英会話教室","use":"school","one":true,"z":"bcdk","cpm":500,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"sc":"eikaiwa","cat":"school","c":"#a9c3df","dn":["{}英会話スクール"]},
   {"k":"music","n":"音楽学校","use":"school","one":true,"z":"bcdek","cpm":700,"f0":2,"f1":6,"min":6,"max":100,"sh":["full","slab","L"],"sc":"music","cat":"school","c":"#c7a9b8","dn":["{}音楽学院"]},
   {"k":"cook","n":"調理師学校","use":"school","one":true,"z":"bcdek","cpm":650,"f0":2,"f1":6,"min":4,"max":80,"sh":["full","slab"],"sc":"cook","cat":"school","c":"#d9b48f","dn":["{}調理師学校"]},
   {"k":"driving","n":"自動車教習所","use":"school","one":true,"z":"cdefh","cpm":80,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"driving","cat":"school","c":"#c9c9c9","pat":"course","dn":["{}自動車教習所"]},
   {"k":"machikoba","n":"町工場","use":"factory","one":true,"z":"bcefk","cpm":220,"f0":1,"f1":2,"min":1,"max":10,"sh":["full","slab"],"cat":"ind","c":"#a9a49a","rl":0.9,"dm":1.1,"fx":{"home":-0.02},"dn":["{}製作所"]},
   {"k":"print","n":"印刷工場","use":"factory","one":true,"z":"cef","cpm":280,"f0":1,"f1":3,"min":6,"max":200,"sh":["full","slab"],"cat":"ind","c":"#b4b8bd","dn":["{}印刷"]},
   {"k":"textile","n":"繊維工場","use":"factory","one":true,"z":"ef","cpm":240,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#c2b8c6","rl":0.9,"dn":["{}紡績"]},
   {"k":"paper","n":"製紙工場","use":"factory","one":true,"z":"fgk","cpm":260,"f0":1,"f1":2,"min":60,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#c9c4b5","rl":0.95,"fx":{"home":-0.05},"dn":["{}製紙"]},
   {"k":"machine","n":"機械工場","use":"factory","one":true,"z":"ef","cpm":280,"f0":1,"f1":2,"min":20,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#a6adb3","rl":1.05,"dn":["{}機械"]},
   {"k":"metal","n":"金属加工工場","use":"factory","one":true,"z":"ef","cpm":270,"f0":1,"f1":2,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#9ca3a8","fx":{"home":-0.04},"dn":["{}金属"]},
   {"k":"parts","n":"部品工場","use":"factory","one":true,"z":"ef","cpm":280,"f0":1,"f1":3,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#adb5ba","rl":1.05,"dn":["{}工業"]},
   {"k":"precision","n":"精密機械工場","use":"factory","one":true,"z":"ef","cpm":380,"f0":1,"f1":4,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#c3ccd3","rl":1.25,"dm":0.95,"dn":["{}精機"]},
   {"k":"pharma","n":"薬品工場","use":"factory","one":true,"z":"ef","cpm":420,"f0":1,"f1":4,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#d6e2e6","rl":1.3,"dn":["{}製薬"]},
   {"k":"cosme","n":"化粧品工場","use":"factory","one":true,"z":"ef","cpm":380,"f0":1,"f1":3,"min":10,"max":400,"sh":["full","slab"],"cat":"ind","c":"#e6d3dc","rl":1.2,"dn":["{}化粧品"]},
   {"k":"beverage","n":"飲料工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":3,"min":40,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#b9d1db","rl":1.05,"dn":["{}飲料"]},
   {"k":"beer","n":"ビール工場","use":"factory","one":true,"z":"efh","cpm":320,"f0":1,"f1":3,"min":60,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#d8b26a","rl":1.1,"fx":{"hotel":0.02},"dn":["{}ビール"]},
   {"k":"sake","n":"酒蔵","use":"factory","one":true,"z":"bcefhk","cpm":350,"f0":1,"f1":2,"min":4,"max":100,"sh":["full","L"],"cat":"ind","c":"#4d4a46","rl":1.15,"dm":0.9,"dn":["{}酒造"]},
   {"k":"confect","n":"製菓工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":3,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#e9cfae","rl":1.05,"dn":["{}製菓"]},
   {"k":"breadf","n":"パン工場","use":"factory","one":true,"z":"ef","cpm":290,"f0":1,"f1":2,"min":10,"max":400,"sh":["full","slab"],"cat":"ind","c":"#e4c491","dn":["{}製パン"]},
   {"k":"frozen","n":"冷凍食品工場","use":"factory","one":true,"z":"ef","cpm":330,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#c8dbe4","rl":1.05,"dn":["{}食品"]},
   {"k":"furniture","n":"家具工場","use":"factory","one":true,"z":"ef","cpm":260,"f0":1,"f1":2,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#a98c6c","rl":0.95,"dn":["{}木工"]},
   {"k":"glass","n":"ガラス工場","use":"factory","one":true,"z":"ef","cpm":290,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#bcd6da","dn":["{}硝子"]},
   {"k":"cement","n":"セメント工場","use":"factory","one":true,"z":"fgk","cpm":260,"f0":1,"f1":2,"min":100,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#b8b6b0","rl":0.9,"fx":{"home":-0.06},"dn":["{}セメント"]},
   {"k":"recycle","n":"リサイクル工場","use":"factory","one":true,"z":"efgk","cpm":260,"f0":1,"f1":2,"min":20,"max":600,"sh":["full","slab"],"cat":"ind","c":"#9fb39a","rl":0.9,"fx":{"home":-0.03},"dn":["{}リサイクルセンター"]},
   {"k":"garbage","n":"ごみ処理場","use":"factory","one":true,"z":"fgk","cpm":450,"f0":1,"f1":3,"min":60,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#8f969c","rl":0.8,"dm":1.3,"fx":{"home":-0.08},"dn":["{}クリーンセンター"]},
   {"k":"thermal","n":"火力発電所","use":"factory","one":true,"z":"fgk","cpm":500,"f0":1,"f1":3,"min":200,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#7c8288","rl":1.3,"pp":0.2,"fx":{"home":-0.05},"dn":["{}火力発電所"]},
   {"k":"shipyard","n":"造船所","use":"factory","one":true,"z":"gk","cpm":350,"f0":1,"f1":2,"min":200,"max":1600,"sh":["full","slab"],"sea":true,"mk":"ship","cat":"ind","c":"#8ea2ae","rl":1.2,"dn":["{}造船所"]},
   {"k":"water","n":"浄水場","use":"factory","one":true,"z":"efghik","cpm":300,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"ind","c":"#9cc4d6","rl":0.9,"pp":0.1,"pat":"water","dn":["{}浄水場"]},
   {"k":"solar","n":"太陽光発電所","use":"factory","one":true,"z":"efghik","cpm":80,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"ind","c":"#3d5a80","pp":0.02,"pat":"solar","dn":["{}メガソーラー"]},
   {"k":"wind","n":"風力発電所","use":"factory","one":true,"z":"ghik","cpm":120,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"ind","c":"#cfe3c4","pp":0.01,"pat":"wind","dn":["{}ウインドファーム"]},
   {"k":"smallwh","n":"小さな倉庫","use":"warehouse","one":true,"z":"cdefgk","cpm":180,"f0":1,"f1":2,"min":1,"max":20,"sh":["full","slab"],"cat":"logi","c":"#c7bba3","rl":0.95,"dn":["{}倉庫"]},
   {"k":"whbldg","n":"倉庫ビル","use":"warehouse","one":true,"z":"cdefgk","cpm":300,"f0":3,"f1":8,"min":20,"max":600,"sh":["full","slab"],"cat":"logi","c":"#b9ae98","dn":["{}倉庫ビル"]},
   {"k":"dc","n":"物流センター","use":"warehouse","one":true,"z":"efgk","cpm":280,"f0":1,"f1":5,"min":100,"max":1600,"sh":["full","slab"],"cat":"logi","c":"#c4b9a5","rl":1.15,"dm":1.1,"pp":1.5,"dn":["{}ロジスティクスセンター"]},
   {"k":"coldwh","n":"冷凍倉庫","use":"warehouse","one":true,"z":"efgk","cpm":380,"f0":1,"f1":4,"min":20,"max":800,"sh":["full","slab"],"cat":"logi","c":"#cfe0e6","rl":1.35,"dn":["{}冷蔵倉庫"]},
   {"k":"delivery","n":"配送センター","use":"warehouse","one":true,"z":"cdef","cpm":240,"f0":1,"f1":2,"min":20,"max":600,"sh":["full","slab"],"cat":"logi","c":"#cdbf9f","rl":1.05,"dm":1.1,"dn":["{}配送センター"]},
   {"k":"truckterm","n":"トラックターミナル","use":"warehouse","one":true,"z":"efgk","cpm":200,"f0":1,"f1":1,"min":60,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#b6ab92","dn":["{}トラックターミナル"]},
   {"k":"trunk","n":"トランクルーム","use":"warehouse","u":10,"z":"bcdek","cpm":250,"f0":1,"f1":4,"min":1,"max":20,"sh":["full","slab"],"cat":"logi","c":"#d2c7b1","rl":1.2,"dn":["{}トランクルーム"]},
   {"k":"wholesale","n":"卸売市場","use":"warehouse","one":true,"z":"cdegk","cpm":300,"f0":1,"f1":3,"min":60,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#c8b48e","fx":{"shop":0.04},"dn":["{}卸売市場"]},
   {"k":"oiltank","n":"油槽所","use":"warehouse","one":true,"z":"gk","cpm":350,"f0":1,"f1":1,"min":40,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#d9d9d2","rl":1.1,"pp":0.2,"dn":["{}油槽所"]},
   {"k":"container","n":"コンテナヤード","use":"warehouse","one":true,"z":"gk","cpm":60,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"logi","c":"#c26a4a","pat":"container","dn":["{}コンテナヤード"]},
   {"k":"fishport","n":"漁港","use":"port","one":true,"z":"ghk","cpm":300,"f0":1,"f1":1,"min":6,"max":400,"sh":["full"],"sea":true,"cat":"port","c":"#8fb0bf","rl":0.8,"dm":1.1,"dn":["{}漁港"]},
   {"k":"airfield","n":"飛行場（コミューター）","use":"port","one":true,"z":"efghk","cpm":3000,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"port","c":"#b7bec5","air":true,"gov":true,"rwy":800,"gates":2,"hangar":4,"pp":1.2,"rl":0.4,"dn":["{}飛行場"]},
   {"k":"airport_s","n":"地方空港","use":"port","one":true,"z":"efghk","cpm":5000,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"cat":"port","c":"#b2b9c1","air":true,"gov":true,"rwy":1500,"gates":4,"hangar":8,"pp":1.5,"rl":0.4,"dn":["{}空港"]},
   {"k":"airport_m","n":"空港","use":"port","one":true,"z":"efgh","cpm":8000,"f0":0,"f1":0,"min":900,"max":3200,"sh":["full"],"cat":"port","c":"#adb4bc","air":true,"gov":true,"rwy":2500,"gates":8,"hangar":16,"pp":2,"rl":0.4,"dn":["{}空港"]},
   {"k":"airport_l","n":"国際空港","use":"port","one":true,"z":"efgh","cpm":12000,"f0":0,"f1":0,"min":1500,"max":6400,"sh":["full"],"cat":"port","c":"#a8b0b8","air":true,"gov":true,"rwy":3000,"gates":16,"hangar":30,"pp":3,"rl":0.4,"dn":["{}国際空港"]},
   {"k":"ferry","n":"フェリーターミナル","use":"port","one":true,"z":"gk","cpm":600,"f0":1,"f1":3,"min":20,"max":600,"sh":["full"],"sea":true,"cat":"port","c":"#a7c0cf","pp":1.5,"fx":{"hotel":0.04},"dn":["{}フェリーターミナル"]},
   {"k":"containerport","n":"コンテナふ頭","use":"port","one":true,"z":"gk","cpm":450,"f0":1,"f1":1,"min":100,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#8c9fae","rl":1.15,"opts":["ore","crude"],"dn":["{}コンテナふ頭"]},
   {"k":"oilport","n":"石油基地","use":"port","one":true,"z":"gk","cpm":500,"f0":1,"f1":1,"min":40,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#b7b9b1","rl":1.1,"opts":["crude"],"rb":1.3,"dn":["{}石油基地"]},
   {"k":"marina","n":"マリーナ","use":"port","one":true,"z":"ghk","cpm":400,"f0":1,"f1":1,"min":10,"max":400,"sh":["full"],"sea":true,"cat":"port","c":"#9fc7d8","rl":1.2,"dm":0.8,"fx":{"hotel":0.04},"dn":["{}マリーナ"]},
   {"k":"mugi","n":"麦畑","use":"farm","one":true,"z":"h","cpm":10,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#e2c666","opts":["wheat"],"rb":1.3,"pat":"rows","dn":["{}麦畑"]},
   {"k":"hatake","n":"畑","use":"farm","one":true,"z":"h","cpm":8,"f0":0,"f1":0,"min":2,"max":1600,"sh":["full"],"cat":"farm","c":"#b9a36a","opts":["wheat"],"pat":"rows"},
   {"k":"paddy","n":"田んぼ","use":"farm","one":true,"z":"h","cpm":12,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#8fc28a","rl":1.05,"pat":"paddy"},
   {"k":"kaju","n":"果樹園","use":"farm","one":true,"z":"hi","cpm":20,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#88b05e","rl":1.3,"dm":0.9,"pat":"trees","dn":["{}果樹園"]},
   {"k":"cha","n":"茶畑","use":"farm","one":true,"z":"hi","cpm":15,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#6f9f55","rl":1.2,"pat":"rows","dn":["{}茶園"]},
   {"k":"vineyard","n":"ぶどう畑","use":"farm","one":true,"z":"hi","cpm":20,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#7f8f4e","rl":1.25,"pat":"rows","dn":["{}ワイナリー"]},
   {"k":"flowerfield","n":"花畑","use":"farm","one":true,"z":"hi","cpm":15,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#e9b6cf","rl":1.1,"fx":{"hotel":0.03},"pat":"flowers","dn":["{}フラワーパーク"]},
   {"k":"ranch","n":"牧場","use":"farm","one":true,"z":"hi","cpm":10,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"farm","c":"#b8d48c","rl":0.9,"pat":"lawn","dn":["{}牧場"]},
   {"k":"forestry","n":"植林地","use":"farm","one":true,"z":"i","cpm":5,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"farm","c":"#5d8a4f","rl":0.6,"pat":"trees"},
   {"k":"greenhouse","n":"ビニールハウス","use":"farm","one":true,"z":"h","cpm":60,"f0":1,"f1":1,"min":2,"max":400,"sh":["full","slab"],"cat":"farm","c":"#e8f1ee","rl":1.6},
   {"k":"chicken","n":"養鶏場","use":"farm","one":true,"z":"h","cpm":80,"f0":1,"f1":1,"min":10,"max":400,"sh":["full","slab"],"cat":"farm","c":"#d9cfb6","rl":1.2,"fx":{"home":-0.04},"dn":["{}養鶏場"]},
   {"k":"coinpark","n":"コインパーキング","use":"parking","one":true,"z":"abcdefghk","cpm":40,"f0":0,"f1":0,"min":1,"max":60,"sh":["full"],"cat":"park","c":"#c4c4c4","rl":1.2,"dm":0.95,"pat":"lines"},
   {"k":"tsukigime","n":"月極駐車場","use":"parking","one":true,"z":"abcdefghk","cpm":25,"f0":0,"f1":0,"min":2,"max":200,"sh":["full"],"cat":"park","c":"#bababa","rl":0.9,"dm":1.1,"pat":"lines"},
   {"k":"bigpark","n":"大型駐車場","use":"parking","one":true,"z":"cdefghk","cpm":25,"f0":0,"f1":0,"min":60,"max":1600,"sh":["full"],"cat":"park","c":"#b5b5b5","rl":0.85,"pat":"lines"},
   {"k":"bikepark","n":"自転車置き場","use":"parking","one":true,"z":"bcdk","cpm":20,"f0":0,"f1":0,"min":1,"max":40,"sh":["full"],"cat":"park","c":"#c9c3b5","rl":0.7,"dm":1.3,"pat":"lines"},
   {"k":"mechpark","n":"機械式駐車場","use":"parking","u":0,"z":"cd","cpm":600,"f0":3,"f1":10,"min":1,"max":20,"sh":["full"],"cat":"park","c":"#a9adb1","rl":1.3,"dn":["{}パーキングタワー"]},
   {"k":"busterm","n":"バスターミナル","use":"parking","u":0,"z":"cd","cpm":400,"f0":1,"f1":2,"min":20,"max":400,"sh":["full","slab"],"cat":"park","c":"#b9c2c9","pp":20,"fx":{"shop":0.03},"dn":["{}バスターミナル"]},
   {"k":"cityhall","n":"市役所","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"plaza","n":"広場","use":"plaza","one":true,"z":"abcdefghik","cpm":40,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"uhq","n":"大学の本部","use":"school","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ukan","n":"大学の校舎","use":"school","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ulab","n":"大学の研究棟","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ulib","n":"大学の図書館","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uhall","n":"大学の講堂","use":"school","u":0,"z":"abcdefghik","cpm":800,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ugym","n":"大学の体育館","use":"school","u":0,"z":"abcdefghik","cpm":450,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uunion","n":"学生会館","use":"school","u":0,"z":"abcdefghik","cpm":500,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"udorm","n":"学生寮","use":"home","u":0,"z":"abcdefghik","cpm":400,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"uhosp","n":"大学病院","use":"hospital","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"umus","n":"大学の博物館","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uschool","n":"附属学校","use":"school","u":0,"z":"abcdefghik","cpm":450,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"hs"},
   {"k":"ugh","n":"温室","use":"farm","u":0,"z":"abcdefghik","cpm":200,"f0":1,"f1":2,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ufield","n":"グラウンド","use":"plaza","one":true,"z":"abcdefghik","cpm":30,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ufarm","n":"実験農場","use":"farm","one":true,"z":"abcdefghik","cpm":10,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ugreen","n":"緑地","use":"plaza","one":true,"z":"abcdefghik","cpm":20,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"uave","n":"並木道","use":"plaza","one":true,"z":"abcdefghik","cpm":40,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"prefhall","n":"府県庁","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"govhall","n":"官庁","use":"office","u":0,"z":"abcdefghik","cpm":1100,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"diet","n":"国会議事堂","use":"office","u":0,"z":"abcdefghik","cpm":2500,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"court","n":"裁判所","use":"office","u":0,"z":"abcdefghik","cpm":1300,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"kantei","n":"首相官邸","use":"office","u":0,"z":"abcdefghik","cpm":1800,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natlib","n":"国立図書館","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"milhq","n":"司令部","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"wardoffice","n":"区役所","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"townhall","n":"町村役場","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"gpost","n":"郵便局","use":"office","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"police","n":"警察署","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"firest","n":"消防署","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"publib","n":"図書館","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"civic","n":"市民会館","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"pgym","n":"体育館","use":"office","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":5,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"cityhosp","n":"市立病院","use":"office","u":0,"z":"abcdefghik","cpm":1100,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"cleanfac","n":"清掃工場","use":"office","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":6,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"pwater","n":"浄水場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true,"pat":"water"},
   {"k":"natmus","n":"国立博物館","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natart","n":"国立美術館","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"nattheater","n":"国立劇場","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natstad","n":"国立競技場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true,"pat":"track"},
   {"k":"keiba","n":"競馬場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":20000,"sh":["full"],"gov":true,"pat":"keiba","c":"#cfe0b4","fx":{"shop":0.05,"hotel":0.1}},
   {"k":"hangar","n":"格納庫","use":"warehouse","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":1,"min":16,"max":400,"sh":["full","slab"],"gov":true,"c":"#8d9196"},
   {"k":"ctower","n":"管制塔","use":"office","u":0,"z":"abcdefghik","cpm":1500,"f0":4,"f1":12,"min":1,"max":9,"sh":["tower","full"],"gov":true,"c":"#c9cdd2"},
   {"k":"barracks","n":"隊舎","use":"home","u":30,"z":"abcdefghik","cpm":350,"f0":3,"f1":6,"min":6,"max":120,"sh":["slab","L","ko","full"],"gov":true,"c":"#b9b29a"},
   {"k":"mro","n":"航空機整備工場","use":"factory","one":true,"z":"abcdefghik","cpm":400,"f0":1,"f1":2,"min":30,"max":800,"sh":["full","slab"],"gov":true,"c":"#9aa1a8"},
   {"k":"fueltank","n":"燃料タンク","use":"warehouse","one":true,"z":"abcdefghik","cpm":250,"f0":1,"f1":1,"min":4,"max":400,"sh":["full"],"gov":true,"c":"#d8d8d0"},
   {"k":"radar","n":"レーダー基地","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":3,"min":2,"max":60,"sh":["full"],"gov":true,"c":"#c0c6cc"},
   {"k":"milschool","n":"士官学校","use":"office","u":0,"z":"abcdefghik","cpm":700,"f0":2,"f1":6,"min":20,"max":800,"sh":["full","slab","L","ko"],"gov":true,"c":"#a89a7c"},
   {"k":"navpier","n":"軍港の岸壁","use":"port","one":true,"z":"abcdefghik","cpm":500,"f0":1,"f1":1,"min":20,"max":1600,"sh":["full"],"sea":true,"gov":true,"c":"#8a9aa6"},
   {"k":"drydock","n":"乾ドック","use":"factory","one":true,"z":"abcdefghik","cpm":450,"f0":1,"f1":1,"min":60,"max":1600,"sh":["full","slab"],"sea":true,"gov":true,"c":"#7f8f99"},
   {"k":"arsenal","n":"海軍工廠","use":"factory","one":true,"z":"abcdefghik","cpm":400,"f0":1,"f1":4,"min":40,"max":1600,"sh":["full","slab"],"gov":true,"c":"#8b8e84"},
   {"k":"uminoie","n":"海の家","use":"shop","u":0,"z":"aghik","cpm":200,"f0":1,"f1":1,"min":1,"max":6,"sh":["full"],"sea":true,"cat":"shop","c":"#e8c88a","dn":["海の家 {}"]},
   {"k":"seaside","n":"シーサイドハウス","use":"hotel","one":true,"z":"abhik","cpm":500,"f0":1,"f1":2,"min":2,"max":12,"sh":["full","L"],"sea":true,"sc":"guesthouse","cat":"hotel","c":"#9ec9d6","dn":["シーサイドハウス {}"]},
   {"k":"beachhouse","n":"ビーチハウス","use":"home","one":true,"z":"abhik","cpm":600,"f0":1,"f1":2,"min":3,"max":20,"sh":["full","L"],"sea":true,"cat":"home","c":"#d9e4e8","rl":1.6,"dm":0.6},
   {"k":"cottage","n":"コテージ","use":"hotel","one":true,"z":"ahik","cpm":420,"f0":1,"f1":2,"min":2,"max":10,"sh":["full","L"],"sc":"pension","cat":"hotel","c":"#a77b55","dn":["{}コテージ"]},
   {"k":"glamping","n":"グランピング施設","use":"leisure","one":true,"z":"hik","cpm":150,"f0":1,"f1":1,"min":20,"max":400,"sh":["full"],"sc":"camp","cat":"fun","c":"#c9b48a","dn":["{}グランピング"]},
   {"k":"beachclub","n":"ビーチクラブ","use":"leisure","one":true,"z":"cdghk","cpm":600,"f0":1,"f1":3,"min":6,"max":100,"sh":["full","L"],"sea":true,"sc":"pool","cat":"fun","c":"#5fb3c8","dn":["{}ビーチクラブ"]},
   {"k":"oceanview","n":"オーシャンビューホテル","use":"hotel","one":true,"z":"abcdhik","cpm":950,"f0":5,"f1":25,"min":20,"max":800,"sh":["slab","L","tower"],"sea":true,"sc":"resort","cat":"hotel","c":"#e3d9c6","fx":{"shop":0.03},"dn":["{}オーシャンビューホテル"]},
   {"k":"resortcondo","n":"リゾートマンション","use":"home","u":70,"z":"bcdhk","cpm":700,"f0":5,"f1":20,"min":10,"max":200,"sh":["slab","L","tower"],"cat":"home","c":"#e6e0d4","rl":1.4},
   {"k":"aquapark","n":"ウォーターパーク","use":"leisure","one":true,"z":"cdhk","cpm":400,"f0":1,"f1":2,"min":60,"max":1600,"sh":["full"],"sc":"pool","cat":"fun","c":"#4fb0d8","dn":["{}ウォーターパーク"]},
   {"k":"teitaku","n":"邸宅","use":"home","one":true,"z":"abhik","cpm":800,"f0":2,"f1":3,"min":6,"max":30,"sh":["full","L","ko"],"cat":"home","c":"#7a5a48","rl":1.9,"dm":0.65},
   {"k":"poolvilla","n":"プールつき邸宅","use":"home","one":true,"z":"abhik","cpm":1000,"f0":1,"f1":3,"min":10,"max":50,"sh":["full","L","ko"],"cat":"home","c":"#f0ede6","rl":2.4,"dm":0.55},
   {"k":"residence","n":"高級低層レジデンス","use":"home","u":120,"z":"abck","cpm":900,"f0":3,"f1":6,"min":8,"max":80,"sh":["full","L","ko","ro"],"cat":"home","c":"#cdb89a","rl":2.0},
   {"k":"terrace","n":"テラスハウス","use":"home","u":80,"z":"abcek","cpm":380,"f0":2,"f1":3,"min":3,"max":12,"sh":["slab","full"],"cat":"home","c":"#c8a27c"},
   {"k":"courtyard","n":"中庭のある家","use":"home","one":true,"z":"abhik","cpm":550,"f0":1,"f1":2,"min":6,"max":20,"sh":["ko","ro"],"cat":"home","c":"#a8806a","rl":1.3},
   {"k":"koban","n":"交番","use":"office","u":0,"z":"abcdefghik","cpm":800,"f0":1,"f1":2,"min":1,"max":2,"sh":["full"],"gov":true,"c":"#e8e2d0"},
   {"k":"hokenjo","n":"保健所","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":2,"f1":5,"min":4,"max":40,"sh":["full","slab"],"gov":true,"c":"#d5e3e6"},
   {"k":"zeimusho","n":"税務署","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":3,"f1":8,"min":4,"max":60,"sh":["full","slab"],"gov":true,"c":"#c9c3b5"},
   {"k":"kishodai","n":"気象台","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":2,"f1":5,"min":4,"max":80,"sh":["full","tower"],"gov":true,"c":"#dfe6ea"},
   {"k":"lighthouse","n":"灯台","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":3,"f1":8,"min":1,"max":4,"sh":["tower","full"],"sea":true,"gov":true,"c":"#ffffff"},
   {"k":"cemetery","n":"霊園","use":"plaza","one":true,"z":"abcdefghik","cpm":60,"f0":0,"f1":0,"min":10,"max":800,"sh":["full"],"gov":true,"c":"#a9b39a"},
   {"k":"sewage","n":"下水処理場","use":"factory","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":2,"min":40,"max":800,"sh":["full","slab"],"gov":true,"c":"#9fb8a8"},
   {"k":"geihinkan","n":"迎賓館","use":"office","u":0,"z":"abcdefghik","cpm":2000,"f0":2,"f1":3,"min":40,"max":800,"sh":["full","ko"],"gov":true,"c":"#efe7d6"},
   {"k":"embassy","n":"大使館","use":"office","u":0,"z":"abcd","cpm":1200,"f0":2,"f1":8,"min":4,"max":60,"sh":["full","L","ko"],"cat":"biz","c":"#d8d2c4","dn":["{}大使館"]},
   {"k":"radiotower","n":"電波塔","use":"office","u":0,"z":"abcdefghik","cpm":2000,"f0":30,"f1":100,"min":4,"max":40,"sh":["tower"],"cat":"biz","c":"#d94f3d","dn":["{}タワー"]},
   {"k":"obstower","n":"展望タワー","use":"leisure","one":true,"z":"cdk","cpm":1800,"f0":20,"f1":90,"min":4,"max":60,"sh":["tower"],"sc":"science","cat":"fun","c":"#e8e3d6","dn":["{}タワー"]},
   {"k":"castle","n":"城","use":"leisure","one":true,"z":"abcdehik","cpm":1500,"f0":3,"f1":6,"min":20,"max":800,"sh":["full"],"sc":"museum","cat":"fun","c":"#f2efe8","dn":["{}城"]},
   {"k":"garden","n":"日本庭園","use":"leisure","one":true,"z":"abcdehik","cpm":120,"f0":0,"f1":0,"min":10,"max":800,"sh":["full"],"sc":"botanical","cat":"fun","c":"#7fb06a","dn":["{}庭園"]},
   {"k":"observatory","n":"天文台","use":"leisure","one":true,"z":"hik","cpm":900,"f0":1,"f1":3,"min":4,"max":100,"sh":["full"],"sc":"science","cat":"fun","c":"#e9eef2","dn":["{}天文台"]},
   {"k":"domestadium","n":"ドーム球場","use":"leisure","one":true,"z":"cdefk","cpm":1500,"f0":4,"f1":8,"min":400,"max":1600,"sh":["full"],"sc":"baseball","cat":"fun","c":"#e8ecef","dn":["{}ドーム"]},
   {"k":"bigtemple","n":"大寺院","use":"leisure","one":true,"z":"abcdehik","cpm":900,"f0":1,"f1":5,"min":20,"max":800,"sh":["full","L","ko"],"sc":"temple","cat":"fun","c":"#8b3a2a","dn":["{}寺"]},
   {"k":"taisha","n":"大社","use":"leisure","one":true,"z":"abcdehik","cpm":800,"f0":1,"f1":1,"min":40,"max":1600,"sh":["full","L"],"sc":"shrine","cat":"fun","c":"#b03a2e","dn":["{}大社"]},
   {"k":"substation","n":"変電所","use":"factory","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":1,"min":4,"max":100,"sh":["full"],"cat":"ind","c":"#a0a4a8","fx":{"home":-0.02}},
   {"k":"hydro","n":"水力発電所","use":"factory","one":true,"z":"hi","cpm":600,"f0":1,"f1":3,"min":10,"max":200,"sh":["full"],"cat":"ind","c":"#8fa9b8"},
   {"k":"geothermal","n":"地熱発電所","use":"factory","one":true,"z":"hik","cpm":500,"f0":1,"f1":2,"min":10,"max":200,"sh":["full"],"cat":"ind","c":"#b3a58f"},
   {"k":"heliport","n":"ヘリポート","use":"parking","one":true,"z":"cdefgk","cpm":200,"f0":0,"f1":0,"min":4,"max":40,"sh":["full"],"cat":"park","c":"#9da39f"},
   {"k":"glassoffice","n":"ガラス張りのオフィスビル","use":"office","u":0,"z":"cd","cpm":1000,"f0":8,"f1":40,"min":8,"max":200,"sh":["slab","tower","L"],"opt":["shop1"],"cat":"biz","c":"#8fb4cf"},
   {"k":"twintower","n":"ツインタワー","use":"office","u":0,"g1":"shop","z":"d","cpm":1200,"f0":30,"f1":55,"min":40,"max":400,"sh":["tower"],"cat":"biz","c":"#a3b8cc","fx":{"office":0.05}},
   {"k":"mixeduse","n":"複合商業ビル","use":"shop","u":150,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":20,"min":10,"max":400,"sh":["full","slab","L"],"cat":"shop","c":"#d9c3a5"},
   {"k":"sa","n":"サービスエリア","use":"shop","u":120,"xw":true,"one":true,"z":"cdefhi","cpm":420,"f0":1,"f1":2,"min":40,"max":600,"sh":["full"],"cat":"shop","c":"#e2c48f","dm":1.3,"dn":["{}サービスエリア"]},
   {"k":"pa","n":"パーキングエリア","use":"shop","u":80,"xw":true,"one":true,"z":"cdefhi","cpm":320,"f0":1,"f1":1,"min":10,"max":200,"sh":["full"],"cat":"shop","c":"#d6cba8","dm":1.1,"dn":["{}パーキングエリア"]}
]'::jsonb
$$;

-- 高速道路のそばか（筆の まわり 1マス＝50m 以内に 高速の線がとおる。x0〜x1・y0〜y1 は区画。サービスエリア・パーキングエリア。DB の更新103）
create or replace function public._mp_near_exp(x0 int, y0 int, x1 int, y1 int) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from mp_segs s where s.kind = 'road' and s.cls = 'exp'
                   and s.bb && box(point(x0 / 5.0 - 1, y0 / 5.0 - 1), point((x1 + 1) / 5.0 + 1, (y1 + 1) / 5.0 + 1))
                   and exists (select 1 from generate_series(1, coalesce(array_length(s.pts, 1), 0) / 2 - 1) i
                                where lseg(point(s.pts[2 * i - 1] / 100.0, s.pts[2 * i] / 100.0), point(s.pts[2 * i + 1] / 100.0, s.pts[2 * i + 2] / 100.0))
                                      ?# box(point(x0 / 5.0 - 1, y0 / 5.0 - 1), point((x1 + 1) / 5.0 + 1, (y1 + 1) / 5.0 + 1))))
$$;

create or replace function public._mp_bld_check(p mp_parcels, p_kind text, p_shape text, p_floors int, p_opt text) returns jsonb
language plpgsql stable set search_path = public as $$
declare pr jsonb; zs text; zr jsonb; cv real := 1; far real := 99; mf int := 99; pcs int[]; cs int[]; nmax int; cnt int; fm2 int; f0 int; f1 int; fl int; plan jsonb;
        x0 int; y0 int; x1 int; y1 int; bad text; rent numeric := 0; lv numeric; z text;
begin
  select b into pr from jsonb_array_elements(_mp_bld_presets()) b where b ->> 'k' = p_kind;
  if pr is null then raise exception '建物の種類がちがいます'; end if;
  if coalesce((pr ->> 'gov')::boolean, false) and not exists (select 1 from companies c where c.id = p.own_c and c.official and not c.ai) then
    raise exception '%は国の建物です', pr ->> 'n';   -- t61：国営の会社（風の芽帝国空軍・海軍など）は、国の建物の種類（格納庫・管制塔・岸壁…）も持てる
  end if;
  if p.n < (pr ->> 'min')::int then raise exception '%には %区画（%㎡）以上の土地がいります', pr ->> 'n', pr ->> 'min', (pr ->> 'min')::int * 100; end if;
  if p.n > (pr ->> 'max')::int then raise exception '%は %区画（%㎡）までの土地に建てます（分筆してください）', pr ->> 'n', pr ->> 'max', (pr ->> 'max')::int * 100; end if;
  x0 := (p.bb[1])[0]; y0 := (p.bb[1])[1]; x1 := (p.bb[0])[0] - 1; y1 := (p.bb[0])[1] - 1;
  -- 用途地域（筆のすべてのマス）。いちばんきびしい決まりで
  select string_agg(distinct _mp_zname(c.z), '・') filter (where position(c.z in (pr ->> 'z')) = 0) into zs
    from (select distinct _mp_t5(x) tx, _mp_t5(y) ty from mp_pcells where parcel = p.id) t, lateral _mp_cell(t.tx, t.ty) c;
  if zs is not null then raise exception '用途地域で建てられません（%）', zs; end if;
  for z in select distinct c.z from (select distinct _mp_t5(x) tx, _mp_t5(y) ty from mp_pcells where parcel = p.id) t, lateral _mp_cell(t.tx, t.ty) c loop
    zr := _mp_zone_rule(z); cv := least(cv, (zr ->> 'cv')::real); far := least(far, (zr ->> 'far')::real); mf := least(mf, (zr ->> 'mf')::int);
  end loop;
  if coalesce((pr ->> 'sea')::boolean, false) and not exists (select 1 from generate_series(_mp_t5(x0) - 2, _mp_t5(x1) + 2) gx, generate_series(_mp_t5(y0) - 2, _mp_t5(y1) + 2) gy, lateral _mp_cell(gx, gy) cc where cc.t in ('S', 'D')) then
    raise exception '%は海のそばに建てます', pr ->> 'n';
  end if;
  if coalesce((pr ->> 'xw')::boolean, false) and not _mp_near_exp(x0, y0, x1, y1) then   -- サービスエリア・パーキングエリア（DB の更新103）
    raise exception '%は高速道路のそば（50m 以内）に建てます', pr ->> 'n';
  end if;
  -- 道路・線路・駅・車庫のかかっていない区画
  pcs := array(select v from (select pc.x, pc.y, row_number() over (order by pc.y, pc.x) rn from mp_pcells pc where pc.parcel = p.id
                                and not exists (select 1 from _mp_busy_cells(x0, y0, x1, y1) b where b.x = pc.x and b.y = pc.y)) q,
                lateral unnest(array[q.x, q.y]) with ordinality u(v, o) order by q.rn, u.o);
  if coalesce(array_length(pcs, 1), 0) = 0 then raise exception '道路・線路・駅・車庫がかかっている土地には建てられません'; end if;
  f0 := (pr ->> 'f0')::int; f1 := (pr ->> 'f1')::int;
  if f1 = 0 then     -- 平らなもの（田畑・駐車場）：あいている区画ぜんぶ
    cs := pcs; cnt := array_length(cs, 1) / 2; fm2 := cnt * 100; fl := 0;
  else
    nmax := greatest(1, floor(p.n * cv + 0.5)::int);
    if not (coalesce(p_shape, 'full') = any(array(select jsonb_array_elements_text(pr -> 'sh')))) then raise exception 'この建物には、その形はえらべません'; end if;
    cs := _mp_bld_shape(pcs, coalesce(p_shape, 'full'), nmax);
    cnt := coalesce(array_length(cs, 1), 0) / 2;
    if cnt = 0 then raise exception 'この土地の形では、その形の建物は建てられません'; end if;
    fm2 := cnt * 85;
    f1 := least(f1, mf, floor(p.n * 100 * far / fm2)::int);
    if f1 < f0 then raise exception 'この土地では%は%階までしか建てられません（%は%階から。用途地域の容積率）', pr ->> 'n', greatest(f1, 0), pr ->> 'n', f0; end if;
    fl := least(f1, greatest(f0, coalesce(p_floors, f0)));
  end if;
  plan := _mp_bld_plan(pr, fl, fm2, p_opt);
  lv := p.val::numeric / greatest(p.n * 100, 1);
  select coalesce(sum(_mp_unit_mr(e ->> 'use', lv) * (e ->> 'm2')::int), 0) * coalesce((pr ->> 'rl')::numeric, 1) into rent from jsonb_array_elements(plan) e;
  return jsonb_build_object('kind', p_kind, 'name', pr ->> 'n', 'shape', coalesce(p_shape, 'full'), 'cells', to_jsonb(cs), 'fm2', fm2, 'f0', f0, 'f1', f1, 'floors', fl,
    'units', jsonb_array_length(plan), 'uses', (select jsonb_object_agg(us, n) from (select e ->> 'use' us, count(*) n from jsonb_array_elements(plan) e group by 1) q),
    'total_m2', case when fl = 0 then fm2 else fm2 * fl end, 'cost', round(case when fl = 0 then fm2 else fm2 * fl end * (pr ->> 'cpm')::numeric)::bigint,
    'rent_day', round(rent), 'cv', cv, 'far', far, 'plan', plan);
end $$;

create or replace function public.mp_bld_options(p_parcel bigint, p_as text, p_cat text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; p mp_parcels; pr jsonb; out jsonb := '[]'::jsonb; zs text; zl text[]; zr jsonb; cv real := 1; far real := 99; mf int := 99;
        x0 int; y0 int; x1 int; y1 int; pcs int[]; npcs int; seaok boolean; expok boolean; nmax int; shc jsonb := '{}'::jsonb; sh text; cnt int; fm2 int; f0 int; f1 int; fl int;
        best jsonb; why text; plan jsonb; lv numeric; rent numeric; tot int; zz text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into p from mp_parcels where id = p_parcel;
  if not found or not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false) then raise exception 'あなた（この名義）の土地ではありません'; end if;
  x0 := (p.bb[1])[0]; y0 := (p.bb[1])[1]; x1 := (p.bb[0])[0] - 1; y1 := (p.bb[0])[1] - 1;
  zl := array(select distinct c.z from (select distinct _mp_t5(x) tx, _mp_t5(y) ty from mp_pcells where parcel = p.id) t, lateral _mp_cell(t.tx, t.ty) c);
  foreach zz in array zl loop
    zr := _mp_zone_rule(zz); cv := least(cv, (zr ->> 'cv')::real); far := least(far, (zr ->> 'far')::real); mf := least(mf, (zr ->> 'mf')::int);
  end loop;
  seaok := exists (select 1 from generate_series(_mp_t5(x0) - 2, _mp_t5(x1) + 2) gx, generate_series(_mp_t5(y0) - 2, _mp_t5(y1) + 2) gy, lateral _mp_cell(gx, gy) cc where cc.t in ('S', 'D'));
  expok := _mp_near_exp(x0, y0, x1, y1);   -- 高速道路のそば（サービスエリア・パーキングエリア。DB の更新103）
  pcs := array(select v from (select pc.x, pc.y, row_number() over (order by pc.y, pc.x) rn from mp_pcells pc where pc.parcel = p.id
                                and not exists (select 1 from _mp_busy_cells(x0, y0, x1, y1) bc where bc.x = pc.x and bc.y = pc.y)) q,
                lateral unnest(array[q.x, q.y]) with ordinality uu(v, o) order by q.rn, uu.o);
  npcs := coalesce(array_length(pcs, 1), 0) / 2;
  nmax := greatest(1, floor(p.n * cv + 0.5)::int);
  lv := p.val::numeric / greatest(p.n * 100, 1);
  for pr in select b from jsonb_array_elements(_mp_bld_presets()) b where not coalesce((b ->> 'gov')::boolean, false) and (p_cat is null or b ->> 'cat' = p_cat) loop
    best := null; why := null;
    if p.n < (pr ->> 'min')::int then why := format('%sには %s区画（%s㎡）以上の土地がいります', pr ->> 'n', pr ->> 'min', (pr ->> 'min')::int * 100);
    elsif p.n > (pr ->> 'max')::int then why := format('%sは %s区画（%s㎡）までの土地に建てます（分筆してください）', pr ->> 'n', pr ->> 'max', (pr ->> 'max')::int * 100);
    else
      zs := (select string_agg(_mp_zname(z1), '・') from unnest(zl) z1 where position(z1 in (pr ->> 'z')) = 0);
      if zs is not null then why := format('用途地域で建てられません（%s）', zs);
      elsif coalesce((pr ->> 'sea')::boolean, false) and not seaok then why := format('%sは海のそばに建てます', pr ->> 'n');
      elsif coalesce((pr ->> 'xw')::boolean, false) and not expok then why := format('%sは高速道路のそば（50m 以内）に建てます', pr ->> 'n');
      elsif npcs = 0 then why := '道路・線路・駅・車庫がかかっている土地には建てられません';
      end if;
    end if;
    if why is null then
      f0 := (pr ->> 'f0')::int; f1 := (pr ->> 'f1')::int;
      if f1 = 0 then
        best := jsonb_build_object('shape', 'full', 'fl', 0, 'fm2', npcs * 100);
      else
        for sh in select jsonb_array_elements_text(pr -> 'sh') loop
          if not shc ? sh then shc := shc || jsonb_build_object(sh, coalesce(array_length(_mp_bld_shape(pcs, sh, nmax), 1), 0) / 2); end if;
          cnt := (shc ->> sh)::int;
          if cnt = 0 then why := coalesce(why, 'この土地の形では、その形の建物は建てられません'); continue; end if;
          fm2 := cnt * 85;
          fl := least(f1, mf, floor(p.n * 100 * far / fm2)::int);
          if fl < f0 then why := coalesce(why, format('この土地では%sは%s階までしか建てられません（%sは%s階から。用途地域の容積率）', pr ->> 'n', greatest(fl, 0), pr ->> 'n', f0)); continue; end if;
          if best is null or fm2 * fl > (best ->> 'fm2')::int * (best ->> 'fl')::int then best := jsonb_build_object('shape', sh, 'fl', fl, 'fm2', fm2); end if;
        end loop;
      end if;
    end if;
    if best is not null then
      fl := (best ->> 'fl')::int; fm2 := (best ->> 'fm2')::int;
      plan := _mp_bld_plan(pr, fl, fm2, '');
      select coalesce(sum(_mp_unit_mr(e ->> 'use', lv) * (e ->> 'm2')::int), 0) * coalesce((pr ->> 'rl')::numeric, 1) into rent from jsonb_array_elements(plan) e;
      tot := case when fl = 0 then fm2 else fm2 * fl end;
      out := out || jsonb_build_array(jsonb_build_object('k', pr ->> 'k', 'ok', true, 'shape', best -> 'shape', 'f1', fl, 'total_m2', tot,
               'cost', round(tot * (pr ->> 'cpm')::numeric), 'rent_day', round(rent), 'units', jsonb_array_length(plan)));
    else
      out := out || jsonb_build_array(jsonb_build_object('k', pr ->> 'k', 'ok', false, 'why', why));
    end if;
  end loop;
  return out;
end $$;

-- 小物の種類（名前・置くときのお金 X。DB の更新103）
create or replace function public._mp_prop_kinds() returns jsonb
language sql immutable as $$
  select '{"vend":{"n":"自動販売機","c":20000},"bench":{"n":"ベンチ","c":5000},"planter":{"n":"プランター","c":3000},"shrub":{"n":"植木","c":4000},
           "tree":{"n":"大きな木","c":8000},"sakura":{"n":"桜の木","c":12000},"bikes":{"n":"自転車置き場","c":6000},"lantern":{"n":"石灯籠","c":15000},
           "jizo":{"n":"お地蔵さん","c":30000},"hokora":{"n":"小さな祠","c":50000},"parasol":{"n":"パラソルとテーブル","c":8000},"slide":{"n":"すべり台","c":40000},
           "swing":{"n":"ブランコ","c":35000},"gomi":{"n":"ゴミ置き場","c":10000},"nobori":{"n":"のぼり旗","c":2000},"lamp":{"n":"外灯","c":12000},
           "sign":{"n":"看板","c":10000},"shed":{"n":"物置","c":25000},"doghouse":{"n":"犬小屋","c":8000}}'::jsonb
$$;

-- 小物の種類（画面の一覧に。DB の更新103）
create or replace function public.mp_prop_kinds() returns jsonb
language sql stable security definer set search_path = public as $$ select _mp_prop_kinds() $$;

-- 小物を さわれるか（土地の持ち主。国の土地は 国（管理者））。土地をかえす（DB の更新103）
create or replace function public._mp_prop_party(p_parcel bigint, pu uuid, pc int, gv boolean) returns mp_parcels
language plpgsql set search_path = public as $$
declare p mp_parcels;
begin
  select * into p from mp_parcels where id = p_parcel for update;
  if not found then raise exception '土地が見つかりません'; end if;
  if p.gov then if not gv then raise exception '国の土地には 国（管理者）だけが置けます'; end if;
  elsif not _mp_same(p.own_u, p.own_c, false, pu, pc, gv) then raise exception 'あなた（この名義）の土地ではありません'; end if;
  return p;
end $$;

-- 小物を置く（自分の土地の中。置くときに お金（国庫へ。国の土地は無料）。土地ごとに 6＋区画×2（80まで）。DB の更新103）
--   p_x, p_y：位置（1/100 マス）・p_rot：正面の方角（15度ずつ）・p_col：色（#rrggbb。えらべる小物だけ）
create or replace function public.mp_prop_put(p_parcel bigint, p_kind text, p_x int, p_y int, p_rot int, p_col text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; p mp_parcels; kd jsonb; zcost bigint; nmax int; zid bigint; zc text;
begin
  perform _mp_ok(u);
  kd := _mp_prop_kinds() -> p_kind;
  if kd is null then raise exception '小物の種類がちがいます'; end if;
  if p_rot is null or p_rot < 0 or p_rot >= 360 or p_rot % 15 <> 0 then raise exception '向きは 0〜345度（15度ずつ）です'; end if;
  zc := nullif(lower(btrim(coalesce(p_col, ''))), '');
  if zc is not null and zc !~ '^#[0-9a-f]{6}$' then raise exception '色は #rrggbb です'; end if;
  select * into pa from _mp_party(u, p_as);
  p := _mp_prop_party(p_parcel, pa.pu, pa.pc, pa.gv);
  if p_x is null or p_y is null or not exists (select 1 from mp_pcells c where c.parcel = p.id and c.x = floor(p_x / 20.0)::int and c.y = floor(p_y / 20.0)::int) then
    raise exception '自分の土地の中に置いてください';
  end if;
  nmax := least(80, 6 + p.n * 2);
  if (select count(*) from mp_props where parcel = p.id) >= nmax then raise exception 'この土地に置ける小物は %こまでです', nmax; end if;
  zcost := case when p.gov then 0 else (kd ->> 'c')::bigint end;
  perform _mp_pay(pa.pu, pa.pc, false, zcost, 'bld', format('%sを置いた', kd ->> 'n'));
  insert into mp_props(parcel, kind, x, y, rot, col, cost) values (p.id, p_kind, p_x, p_y, p_rot, zc, zcost) returning id into zid;
  perform _mp_chg('land', null, 'set', box(point(floor(p_x / 100.0), floor(p_y / 100.0)), point(floor(p_x / 100.0) + 1, floor(p_y / 100.0) + 1)));
  return jsonb_build_object('ok', true, 'id', zid, 'cost', zcost);
end $$;

-- 小物を動かす・回す・色を変える（同じ土地の中。無料。null は そのまま。DB の更新103）
create or replace function public.mp_prop_set(p_id bigint, p_x int, p_y int, p_rot int, p_col text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; p mp_parcels; o mp_props; zx int; zy int; zc text;
begin
  perform _mp_ok(u);
  select * into o from mp_props where id = p_id for update;
  if not found then raise exception '小物が見つかりません'; end if;
  select * into pa from _mp_party(u, p_as);
  p := _mp_prop_party(o.parcel, pa.pu, pa.pc, pa.gv);
  zx := coalesce(p_x, o.x); zy := coalesce(p_y, o.y);
  if not exists (select 1 from mp_pcells c where c.parcel = p.id and c.x = floor(zx / 20.0)::int and c.y = floor(zy / 20.0)::int) then raise exception '自分の土地の中に置いてください'; end if;
  if p_rot is not null and (p_rot < 0 or p_rot >= 360 or p_rot % 15 <> 0) then raise exception '向きは 0〜345度（15度ずつ）です'; end if;
  zc := case when p_col is null then o.col else nullif(lower(btrim(p_col)), '') end;
  if zc is not null and zc !~ '^#[0-9a-f]{6}$' then raise exception '色は #rrggbb です'; end if;
  update mp_props set x = zx, y = zy, rot = coalesce(p_rot, o.rot), col = zc where id = o.id;
  perform _mp_chg('land', null, 'set', box(point(floor(least(o.x, zx) / 100.0), floor(least(o.y, zy) / 100.0)), point(floor(greatest(o.x, zx) / 100.0) + 1, floor(greatest(o.y, zy) / 100.0) + 1)));
  return jsonb_build_object('ok', true);
end $$;

-- 小物をかたづける（お金は もどらない。DB の更新103）
create or replace function public.mp_prop_del(p_id bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; o mp_props;
begin
  perform _mp_ok(u);
  select * into o from mp_props where id = p_id for update;
  if not found then raise exception '小物が見つかりません'; end if;
  select * into pa from _mp_party(u, p_as);
  perform _mp_prop_party(o.parcel, pa.pu, pa.pc, pa.gv);
  delete from mp_props where id = o.id;
  perform _mp_chg('land', null, 'set', box(point(floor(o.x / 100.0), floor(o.y / 100.0)), point(floor(o.x / 100.0) + 1, floor(o.y / 100.0) + 1)));
  return jsonb_build_object('ok', true);
end $$;

-- 1階のお店の看板の色（横線。3つまで・何度でも無料。DB の更新103）：建物の持ち主か、その部屋を借りている会社。p_sc が空なら もとの色に
create or replace function public.mp_unit_colors(p_unit bigint, p_sc text[], p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; x mp_units; b mp_blds; p mp_parcels; zc text[];
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into x from mp_units where id = p_unit for update;
  if not found then raise exception '部屋が見つかりません'; end if;
  if x.floor <> 1 or x.use <> 'shop' then raise exception '看板の色は 1階のお店の部屋だけです'; end if;
  select * into b from mp_blds where id = x.bld;
  select * into p from mp_parcels where id = b.parcel;
  if not ((p.gov and pa.gv) or (not p.gov and _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, pa.gv)) or (x.t_kind = 'corp' and pa.pc is not null and x.t_c = pa.pc)) then
    raise exception 'この部屋の看板の色は、建物の持ち主か 入っている会社だけが変えられます';
  end if;
  zc := case when p_sc is null or cardinality(p_sc) = 0 then null else array(select lower(btrim(c)) from unnest(p_sc) c) end;
  if zc is not null and (cardinality(zc) > 3 or exists (select 1 from unnest(zc) c where c !~ '^#[0-9a-f]{6}$')) then raise exception '色は #rrggbb で 3つまでです'; end if;
  update mp_units set sc = zc where id = x.id;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5((p.bb[1])[0]::int), _mp_t5((p.bb[1])[1]::int)), point(_mp_t5((p.bb[0])[0]::int - 1) + 1, _mp_t5((p.bb[0])[1]::int - 1) + 1)));
  return jsonb_build_object('ok', true, 'sc', zc);
end $$;


revoke all on function public._mp_near_exp(int, int, int, int) from public, anon, authenticated;
revoke all on function public._mp_prop_kinds() from public, anon, authenticated;
revoke all on function public._mp_prop_party(bigint, uuid, int, boolean) from public, anon, authenticated;
revoke all on function public.mp_prop_kinds() from public, anon;
grant execute on function public.mp_prop_kinds() to authenticated;
revoke all on function public.mp_prop_put(bigint, text, int, int, int, text, text) from public, anon;
grant execute on function public.mp_prop_put(bigint, text, int, int, int, text, text) to authenticated;
revoke all on function public.mp_prop_set(bigint, int, int, int, text, text) from public, anon;
grant execute on function public.mp_prop_set(bigint, int, int, int, text, text) to authenticated;
revoke all on function public.mp_prop_del(bigint, text) from public, anon;
grant execute on function public.mp_prop_del(bigint, text) to authenticated;
revoke all on function public.mp_unit_colors(bigint, text[], text) from public, anon;
grant execute on function public.mp_unit_colors(bigint, text[], text) to authenticated;
revoke all on function public._mp_look_cost(bigint) from public, anon, authenticated;
revoke all on function public._mp_rot_cost(bigint) from public, anon, authenticated;
revoke all on function public.mp_bld_look(bigint, int, int, text) from public, anon;
grant execute on function public.mp_bld_look(bigint, int, int, text) to authenticated;
