-- 国も鉄道を：管理者が名義「国（役所）」で、線路・駅・車両基地をつくり、車両・編成・運用・種別・系統・列車を持って走らせられる
--   国の工事は無料（道路と同じ）。他人の土地を通っても、土地の申請も使用料もいらない。鉄道の免許もいらない。車両は国庫から買う
--   国の駅・車両基地・系統は、管理者のもの（地図・ダイヤ）。国の系統の運賃は国庫のまま。国の維持費はなし（国庫から国庫）
--   国の線の運行の乱れは、名義「国」で対応をえらべる

create or replace function public._mp_okey(pu uuid, pc int) returns text
language sql immutable as $$ select case when pu is not null then 'u:' || pu when pc is not null then 'c:' || pc else 'gov' end $$;
create or replace function public._mp_mine(u uuid, pu uuid, pc int) returns boolean
language sql stable set search_path = public as $$ select coalesce(pu = u, false) or exists (select 1 from companies c where c.id = pc and c.owner = u) or (pu is null and pc is null and _is_admin(u)) $$;
create or replace function public._mp_land_need(cells int[], pu uuid, pc int, gv boolean, old int[] default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb; cand int[];
begin
  if gv or (pu is null and pc is null) or coalesce(array_length(cells, 1), 0) < 2 then return null; end if;   -- 国（持ち主なし）は申請しない（DB の更新101）
  with c as (select distinct cells[2 * i - 1] x, cells[2 * i] y from generate_series(1, array_length(cells, 1) / 2) i),
       o as materialized (select distinct old[2 * i - 1] x, old[2 * i] y from generate_series(1, coalesce(array_length(old, 1), 0) / 2) i),
       hc as materialized (select c.x, c.y, pcl.parcel from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y where not exists (select 1 from o where o.x = c.x and o.y = c.y)),
       bad as (select p.id from (select distinct parcel from hc) h join mp_parcels p on p.id = h.parcel
                where (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, pu, pc, false) and _mp_land_fee(p.id, pu, pc) is null)
  select coalesce(array_agg(u.v order by z.x, z.y, u.o), '{}') into cand
    from (select hc.x, hc.y from hc join bad on bad.id = hc.parcel) z, lateral unnest(array[z.x, z.y]) with ordinality u(v, o);
  if coalesce(array_length(cand, 1), 0) = 0 then return null; end if;
  -- 公道の区画はのぞく（まわりを通る国の線だけで見る）
  with c as (select distinct cand[2 * i - 1] x, cand[2 * i] y from generate_series(1, array_length(cand, 1) / 2) i),
       pb as materialized (select * from _mp_pub_of(cand)),
       hit as (select pcl.parcel, count(*) n from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y
                where not exists (select 1 from pb where pb.x = c.x and pb.y = c.y) group by pcl.parcel)
  select jsonb_agg(jsonb_build_object('id', p.id, 'label', _mp_parcel_label(p.id), 'owner', _mp_pname(p.own_u, p.own_c, false), 'n', hit.n,
           'wait', exists (select 1 from mp_landreq q where q.parcel = p.id and q.st = 'wait' and q.req_u is not distinct from pu and q.req_c is not distinct from pc),
           'no', exists (select 1 from mp_landreq q where q.parcel = p.id and q.st = 'no' and q.req_u is not distinct from pu and q.req_c is not distinct from pc))
           order by p.id) into r
    from (select * from hit order by parcel limit 30) hit join mp_parcels p on p.id = hit.parcel;
  return r;
end $$;
create or replace function public._mp_lease_set(rk text, rid bigint, pu uuid, pc int, gv boolean, prev jsonb default null) returns numeric
language plpgsql set search_path = public as $$
declare total numeric; cells int[];
begin
  prev := coalesce(prev, (select jsonb_object_agg(e.x || ',' || e.y, e.fee) from mp_leases e where e.ref_kind = rk and e.ref = rid), '{}'::jsonb);
  delete from mp_leases where ref_kind = rk and ref = rid;
  if gv or (pu is null and pc is null) then return 0; end if;   -- 国（持ち主なし）は使用料なし（DB の更新101）
  cells := (select coalesce(array_agg(u.v order by z.n, u.o), '{}') from (select q.x, q.y, row_number() over () n from (select distinct x, y from _mp_struct_cells(rk, rid)) q) z,
              lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
  -- 公道の区画は、まわりを通る国の線だけで見る。地価はマスごとに1回（同じマスの区画は同じ地価）
  with c as (select distinct cells[2 * i - 1] x, cells[2 * i] y from generate_series(1, coalesce(array_length(cells, 1), 0) / 2) i),
       pub as materialized (select * from _mp_pub_of(cells)),
       v0 as materialized (select c.x, c.y, p.own_u lu, p.own_c lc, p.id pid
               from c left join pub on pub.x = c.x and pub.y = c.y
                      left join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y left join mp_parcels p on p.id = pcl.parcel
              where pub.x is null),
       -- 地価・貸出料は、使用料が前から決まっていなくて、使用料のいる区画（国の土地・他人の筆）だけ しらべる（DB の更新94。線を2つに分けるときは しらべなくてよい）
       nd as materialized (select v0.* from v0 where not (prev ? (v0.x || ',' || v0.y))
                             and ((v0.pid is null and rk <> 'sta') or (v0.pid is not null and not _mp_same(v0.lu, v0.lc, false, pu, pc, false)))),
       tv as materialized (select z.tx, z.ty, coalesce(_mp_cval(z.tx, z.ty), 120) cv from (select distinct _mp_t5(nd.x) tx, _mp_t5(nd.y) ty from nd) z),
       v as (select v0.*, tv.cv from v0 left join tv on tv.tx = _mp_t5(v0.x) and tv.ty = _mp_t5(v0.y)),
       pf as materialized (select d.pid, _mp_land_fee(d.pid, pu, pc) f from (select distinct nd.pid from nd where nd.pid is not null) d),
       ins as (insert into mp_leases(x, y, ref_kind, ref, pay_u, pay_c, fee)
               select v.x, v.y, rk, rid, pu, pc,
                      coalesce((prev ->> (v.x || ',' || v.y))::numeric,
                               case when v.pid is null then round(v.cv * _mp_rate('lease_gov'), 3)
                                    else coalesce(pf.f, round(v.cv * _mp_rate('lease'), 3)) end)
                 from v left join pf on pf.pid = v.pid
                where ((v.pid is null and rk <> 'sta')
                    or (v.pid is not null and not _mp_same(v.lu, v.lc, false, pu, pc, false) and (rk <> 'sta' or v.lu is not null or v.lc is not null)))
                  -- 駅：線路の区画は線路の使用料に入っている
                  and (rk <> 'sta' or not exists (select 1 from mp_leases e2 join mp_stations st on st.id = rid where e2.x = v.x and e2.y = v.y and e2.ref_kind = 'seg' and e2.ref = st.seg))
               returning fee)
  select coalesce(sum(fee), 0) into total from ins;
  return total;
end $$;
create or replace function public._mp_lease_quote(cells int[], pu uuid, pc int, gv boolean, out fee numeric, out own int, out other int, out state int, out pub int)
language plpgsql stable set search_path = public as $$
begin
  fee := 0; own := 0; other := 0; state := 0; pub := 0;
  gv := coalesce(gv, false) or (pu is null and pc is null);   -- 国（持ち主なし）は使用料なし（DB の更新101）
  if coalesce(array_length(cells, 1), 0) < 2 then return; end if;
  -- 公道の区画は、まわりを通る国の線だけで見る。地価はマスごとに1回
  with c as (select distinct cells[2 * i - 1] x, cells[2 * i] y from generate_series(1, array_length(cells, 1) / 2) i),
       pb as materialized (select * from _mp_pub_of(cells)),
       tv as materialized (select z.tx, z.ty, coalesce(_mp_cval(z.tx, z.ty), 120) cv from (select distinct _mp_t5(c.x) tx, _mp_t5(c.y) ty from c) z),
       v0 as (select c.x, c.y, pb.x is not null ispub, p.id pid, p.own_u lu, p.own_c lc, tv.cv
               from c left join pb on pb.x = c.x and pb.y = c.y
                      join tv on tv.tx = _mp_t5(c.x) and tv.ty = _mp_t5(c.y)
                      left join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y left join mp_parcels p on p.id = pcl.parcel),
       pf as materialized (select d.pid, _mp_land_fee(d.pid, pu, pc) f from (select distinct v0.pid from v0 where v0.pid is not null) d),
       v as (select v0.*, pf.f lf from v0 left join pf on pf.pid = v0.pid)
  select coalesce(sum(case when gv or ispub or (pid is not null and _mp_same(lu, lc, false, pu, pc, false)) then 0
                           when pid is null then cv * _mp_rate('lease_gov') else coalesce(lf, cv * _mp_rate('lease')) end), 0),
         count(*) filter (where not gv and not ispub and pid is not null and _mp_same(lu, lc, false, pu, pc, false)),
         count(*) filter (where not gv and not ispub and pid is not null and not _mp_same(lu, lc, false, pu, pc, false)),
         count(*) filter (where not gv and not ispub and pid is null),
         count(*) filter (where gv or ispub)
    into fee, own, other, state, pub from v;
  fee := round(fee, 1);
end $$;
create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); pws smallint := least(2, greatest(0, coalesce((p_opts ->> 'ps')::int, 0)))::smallint; elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text; ho jsonb;
        sga smallint; sg2 smallint; ssl smallint; sct smallint; snw smallint;   -- 線路の規格（DB の更新99）
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
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
  if p_kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if p_kind = 'road' and rmin < 0.7 then raise exception 'カーブがきつすぎます'; end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
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
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], ho);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
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
      'need', need, 'hm', nhm, 'ho', ho, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns');   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
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
create or replace function public.mp_sta_build(p_kind text, p_seg bigint, p_x real, p_y real, p_plat int, p_tracks int, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; span real; tiles int[]; cost numeric; sid bigint; pt record; nm text := left(trim(coalesce(p_name, '')), 20); sub int[];
        pcs int[]; oc int[]; need jsonb; lfee numeric := 0; zp real; zl text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
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
    if _mp_minr(sub) < 8 then raise exception 'ホームはカーブのゆるいところ（半径400m以上）に作ります'; end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + span) / 2 + 1)
       or exists (select 1 from mp_depots t where t.seg = p_seg and abs(t.at - s) < (span + (_mp_dep_dim(t.kind, t.size))[1]) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
    tiles := _mp_tiles(sub);
    pcs := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_line_cells(sub, greatest(0.5, (0.22 * p_tracks + 0.18) * 2.5)::real) z,
                    lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
    -- 高さ（t108）：ホームの高さ。地下駅（地面−15m より深い）は建物の下、高架駅は低い建物の上（屋根＋5m）にも作れる
    zp := case when sg.prof is not null then _mp_pz(sg.prof, s) end;
    if _mp_bld_hit_z(pcs, zp) is not null then raise exception 'ホームが建物のある土地にかかります'; end if;
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
    'lease', round(lfee), 'need', need, 'zl', zl); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, round(cost)::bigint, 'sta', format('%s「%s」の工事', case when p_kind = 'rail' then '駅' else 'バス停' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_stations(kind, seg, at, x, y, ang, plat, tracks, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, round(pt.x * 100), round(pt.y * 100), pt.ang, p_plat, p_tracks, nm, pa.pu, pa.pc, round(cost))
  returning id into sid;
  perform _mp_occ_set(sid, case when p_kind = 'rail' then 'sta' else 'stop' end, tiles);
  if p_kind = 'rail' then perform _mp_lease_set('sta', sid, pa.pu, pa.pc, pa.gv); end if;
  perform _mp_chg('sta', sid, 'set', box(point(pt.x - 3, pt.y - 3), point(pt.x + 3, pt.y + 3)));
  return jsonb_build_object('id', sid, 'cost', round(cost));
end $$;
create or replace function public.mp_dep_build(p_kind text, p_seg bigint, p_x real, p_y real, p_side int, p_size text, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; lt real; wt real; gap real := 0.9; dim real[]; cap int; cost numeric; tiles int[]; ters text[]; bad text; lq record; did bigint; pt record; dcells int[];
        nm text := left(trim(coalesce(p_name, '')), 20); side int := case when p_side < 0 then -1 else 1 end; need jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv and p_kind <> 'rail' then raise exception 'バスの営業所は人か会社で作ります'; end if;   -- 国は鉄道の車両基地だけ（DB の更新101）
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
    if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, pa.gv) then raise exception '車両基地は自分（この名義）の線路の横に作ります'; end if;
    if coalesce(p_size, '') like 'T%' then   -- 線路をなぞった大きさ（長さ20m単位・留置線の数）
      if p_size !~ '^T[0-9]{2,4}x[0-9]{1,2}$' then raise exception '車両基地の大きさが読めません'; end if;
      if split_part(substr(p_size, 2), 'x', 1)::int not between 40 and 1000 or split_part(substr(p_size, 2), 'x', 1)::int % 20 <> 0 then raise exception '車両基地の長さは20m単位で、40〜1000mです'; end if;
      if split_part(p_size, 'x', 2)::int not between 1 and 20 then raise exception '留置線は1〜20本です'; end if;
      dim := _mp_dep_dim('rail', p_size); lt := dim[1]; wt := dim[2]; gap := dim[3]; cap := dim[4]::int;
      cost := _mp_rate('dep_base') + cap * _mp_rate('dep_car');
    else
      lt := case p_size when 'L' then 10 when 'M' then 7 else 5 end; wt := case p_size when 'L' then 4 when 'M' then 3 else 2 end;
      cap := case p_size when 'L' then 120 when 'M' then 48 else 16 end;
      cost := _mp_rate('dep_' || case when p_size in ('S', 'M', 'L') then p_size else 'S' end);
    end if;
  elsif p_kind = 'bus' then
    if sg.kind <> 'road' then raise exception 'バスの営業所は道路の横に作ります'; end if;
    lt := case p_size when 'M' then 5 else 3 end; wt := case p_size when 'M' then 3 else 2 end;
    cap := case p_size when 'M' then 60 else 20 end;
    cost := _mp_rate('bdep_' || case when p_size = 'M' then 'M' else 'S' end);
  else raise exception '作るものがちがいます'; end if;
  if pa.gv then cost := 0; end if;   -- 国の工事は無料（DB の更新101）
  if s - lt / 2 < 0.2 or s + lt / 2 > sg.len - 0.2 then raise exception '線のはしからはみ出します'; end if;
  if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + lt) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
  tiles := _mp_dep_tiles_g(sg.pts, s, side, lt, wt, gap);
  ters := _mp_ters(tiles);
  if '?' = any(ters) or 'D' = any(ters) or 'S' = any(ters) or 'R' = any(ters) or 'L' = any(ters) then raise exception '水の上や地図のないところには作れません'; end if;
  select string_agg(distinct o.x || ',' || o.y, ' ') into bad from mp_occ o
    join (select tiles[2 * i - 1] x, tiles[2 * i] y from generate_series(1, array_length(tiles, 1) / 2) i) t on t.x = o.x and t.y = o.y
   where not (o.what = sg.kind and o.ref = p_seg);
  if bad is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', left(bad, 60); end if;
  select * into pt from _mp_at(sg.pts, s);
  if sg.prof is not null and abs(_mp_pz(sg.prof, s) - _mp_gz(pt.x, pt.y)) > 5 then raise exception '車庫は、線が地面の高さのところに作ります（高架・地下・橋のところには作れません）'; end if;   -- 高さ（t108）
  dcells := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_dep_cells(pt.x, pt.y, pt.ang, side, p_kind, coalesce(p_size, 'S')) z, lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
  if _mp_bld_hit(dcells) is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', _mp_bld_hit(dcells); end if;
  select * into lq from _mp_lease_quote(dcells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(dcells, pa.pu, pa.pc, pa.gv);
  if p_dry then return jsonb_build_object('cost', round(cost), 'lease', round(lq.fee), 'cap', cap, 'tiles', array_length(tiles, 1) / 2,
    'up_day', case when pa.gv then 0 else round(_mp_rate(case when p_kind = 'rail' then 'up_dep' else 'up_bdep' end) * case when coalesce(p_size, '') like 'T%' then greatest(1, cap / 24.0) when p_size = 'L' then 5 when p_size = 'M' then 2.5 else 1 end) end, 'need', need); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, round(cost)::bigint, 'dep', format('%s「%s」の工事', case when p_kind = 'rail' then '車両基地' else '営業所' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_depots(kind, seg, at, side, size, x, y, ang, cap, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, side, coalesce(p_size, 'S'), round(pt.x * 100), round(pt.y * 100), pt.ang, cap, nm, pa.pu, pa.pc, round(cost))
  returning id into did;
  perform _mp_occ_set(did, 'dep', tiles);
  perform _mp_lease_set('dep', did, pa.pu, pa.pc, pa.gv);
  perform _mp_chg('dep', did, 'set', box(point(pt.x - greatest(8, lt / 2 + gap + wt + 1), pt.y - greatest(8, lt / 2 + gap + wt + 1)),
                                         point(pt.x + greatest(8, lt / 2 + gap + wt + 1), pt.y + greatest(8, lt / 2 + gap + wt + 1))));
  return jsonb_build_object('id', did, 'cost', round(cost), 'cap', cap);
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
  update mp_stations set plat = p_plat, tracks = p_tracks, cost = st.cost + addc, trk = ntrk where id = p_id;
  delete from mp_occ where what = 'sta' and ref = p_id;
  perform _mp_occ_set(p_id, 'sta', tiles);
  perform _mp_lease_set('sta', p_id, st.own_u, st.own_c, false);
  for rr in select r.id from mp_routes r where p_id = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_id, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'cost', addc, 'plat', p_plat, 'tracks', p_tracks);
end $$;
create or replace function public.mp_car_order(p_type text, p_n int, p_depot bigint, p_as text, p_dry boolean, p_maker bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; t mp_types; d mp_depots; have int; k text; s int; i int; nums text[] := '{}'; cost bigint; cid bigint; fid bigint; hrs int; fnm text; mk jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;   -- 同じ名義の操作は1つずつ（車庫の空き・車番がかさならないように。DB の更新60）
  select * into t from mp_types where code = p_type and on_sale;
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
  if exists (select 1 from unnest(p_types) x where not exists (select 1 from mp_types y where y.code = x and y.on_sale)) then raise exception 'その形式は注文できません'; end if;
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
create or replace function public.mp_op_save(p_id bigint, p_num text, p_form bigint, p_note text, p_kind text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; o mp_ops; nm text := left(trim(coalesce(p_num, '')), 12); kd text; f mp_forms; other bigint; othernum text; oid_ bigint; rids bigint[]; why text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国も運用をつくれる（DB の更新101）
  if nm = '' then raise exception '運用番号を入れてください'; end if;
  if p_id is not null then
    select * into o from mp_ops where id = p_id and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
    if not found then raise exception '運用が見つかりません'; end if;
    kd := o.kind;
  else kd := case when p_kind in ('bus', 'ship', 'air') then p_kind else 'rail' end; end if;
  if exists (select 1 from mp_ops x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.num = nm and x.id is distinct from p_id) then
    raise exception '運用番号「%」はもうあります', nm;
  end if;
  if p_form is not null then
    select * into f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    if not found then raise exception '編成が見つかりません'; end if;
    if _mp_form_kind(p_form) <> kd then   -- t54o：船の運用には船だけ
      raise exception '%', case kd when 'rail' then '鉄道の運用には電車だけを入れられます' when 'ship' then '船の運用には船だけを入れられます' when 'air' then '飛行機の運用には飛行機だけを入れられます' else 'バスの運用にはバスだけを入れられます' end;
    end if;
    why := _mp_form_rule(array(select c.id from mp_cars c where c.form = p_form order by c.pos));   -- わけも出す（DB の更新78）
    if why is not null then raise exception '編成のきまりに合っていません：%', why; end if;
    select id, num into other, othernum from mp_ops where form = p_form and id is distinct from p_id;
    if other is not null then
      update mp_ops set form = null where id = other;
      update mp_trains set form = null where op = other;
    end if;
    -- 予備編成を運用に入れたら、予備ではなくなる（DB の更新80）
    update mp_forms set spare = false where id = p_form and spare;
    delete from mp_subst where sub = p_form and t1 > now();
  end if;
  if p_id is null then
    insert into mp_ops(own_u, own_c, kind, num, form, note) values (pa.pu, pa.pc, kd, nm, p_form, left(coalesce(p_note, ''), 200)) returning id into oid_;
  else
    update mp_ops set num = nm, form = p_form, note = left(coalesce(p_note, ''), 200) where id = p_id;
    oid_ := p_id;
    update mp_trains set form = p_form where op = p_id;
  end if;
  -- 列車の時刻・ぶつかりを見なおす（連結している列車も）
  rids := array(select distinct route from mp_trains where op = oid_ or op = other
                   or cpl @> jsonb_build_array(jsonb_build_object('op', oid_)) or (other is not null and cpl @> jsonb_build_array(jsonb_build_object('op', other))));
  perform _mp_resched(x) from unnest(rids) x;
  perform _mp_subst_plan(pa.pu, pa.pc);   -- 代走の予定を見なおす（DB の更新80）
  return jsonb_build_object('id', oid_, 'moved_from', othernum);
end $$;
create or replace function public.mp_ops_bulk(p_ids bigint[], p_act text, p_arg jsonb, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; ids bigint[]; rids bigint[]; rr bigint; n int; nt int; fr text; tw text; nn text; o record; mins int; kd text; lbl text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国の運用も（DB の更新101）
  ids := array(select x.id from mp_ops x where x.id = any(coalesce(p_ids, '{}')) and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc);
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then raise exception '運用をえらんでください'; end if;
  if n > 500 then raise exception '一度に500の運用までです'; end if;
  if p_act not in ('del', 'unform', 'note', 'rename', 'shift', 'kind') then raise exception 'することがちがいます'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  -- 変わる系統（この運用の列車・この運用を連結している列車）
  rids := array(select distinct t.route from mp_trains t where t.op = any(ids)
                 or exists (select 1 from jsonb_array_elements(t.cpl) c where (c ->> 'op')::bigint = any(ids)));
  select count(*) into nt from mp_trains where op = any(ids);
  if p_act = 'rename' then
    fr := coalesce(p_arg ->> 'from', ''); tw := coalesce(p_arg ->> 'to', '');
    if fr = '' then raise exception '置きかえる文字を入れてください'; end if;
    create temp table if not exists _mp_ren (id bigint, nn text) on commit drop;
    truncate _mp_ren;
    insert into _mp_ren select x.id, left(trim(replace(x.num, fr, tw)), 12) from mp_ops x where x.id = any(ids) and strpos(x.num, fr) > 0;
    if not exists (select 1 from _mp_ren) then raise exception '「%」がある運用番号はありません', fr; end if;
    select z.nn into nn from _mp_ren z where z.nn = '' limit 1;
    if found then raise exception '運用番号が空になる運用があります'; end if;
    select z.nn into nn from _mp_ren z group by z.nn having count(*) > 1 limit 1;
    if found then raise exception '置きかえると、運用番号「%」が2つになります', nn; end if;
    select z.nn into nn from _mp_ren z join mp_ops y on y.num = z.nn and y.own_u is not distinct from pa.pu and y.own_c is not distinct from pa.pc
     where not exists (select 1 from _mp_ren w where w.id = y.id) limit 1;
    if found then raise exception '運用番号「%」はもうあります', nn; end if;
    -- いったん仮の番号にしてから（入れかわるときにぶつからないように）
    update mp_ops x set num = '~' || x.id::text from _mp_ren z where z.id = x.id;
    update mp_ops x set num = z.nn from _mp_ren z where z.id = x.id;
    n := (select count(*) from _mp_ren);
    return jsonb_build_object('ok', true, 'n', n);
  end if;
  if p_act = 'note' then
    update mp_ops set note = left(coalesce(p_arg ->> 'note', ''), 200) where id = any(ids);
    return jsonb_build_object('ok', true, 'n', n);
  end if;
  if p_act = 'shift' then
    mins := (p_arg ->> 'min')::int;
    if mins is null or mins = 0 or abs(mins) > 720 then raise exception 'ずらす分は −720〜720 です（0 はなし）'; end if;
    if exists (select 1 from mp_trains t where t.op = any(ids) and (t.dep + mins * 60 < 0 or t.dep + mins * 60 >= 86400)) then
      raise exception 'ずらすと、0時〜24時の外に出る列車があります';
    end if;
  end if;
  if p_act = 'kind' then
    kd := left(trim(coalesce(p_arg ->> 'kind', '')), 8);
    if kd = '' then raise exception '種別をえらんでください'; end if;
  end if;
  lbl := case p_act when 'del' then format('運用を %s つ消した', n) when 'unform' then format('運用 %s つの編成をはずした', n)
                    when 'shift' then format('運用 %s つの列車を %s分ずらした', n, mins) else format('運用 %s つの列車を「%s」にした', n, kd) end;
  foreach rr in array rids loop perform _mp_dia_snap(rr, lbl); end loop;
  if p_act = 'del' then
    update mp_trains set op = null, form = null where op = any(ids);
    update mp_trains set cpl = coalesce((select jsonb_agg(c.v order by c.o) from jsonb_array_elements(cpl) with ordinality c(v, o) where not ((c.v ->> 'op')::bigint = any(ids))), '[]'::jsonb)
     where exists (select 1 from jsonb_array_elements(cpl) c where (c ->> 'op')::bigint = any(ids));
    delete from mp_ops where id = any(ids);
  elsif p_act = 'unform' then
    update mp_ops set form = null where id = any(ids);
    update mp_trains set form = null where op = any(ids);
  elsif p_act = 'shift' then
    update mp_trains set dep = dep + mins * 60,
           tt = coalesce((select jsonb_object_agg(e.k, case when jsonb_typeof(e.v) = 'object' then
                            e.v || case when e.v ? 'a' then jsonb_build_object('a', (e.v ->> 'a')::int + mins * 60) else '{}'::jsonb end
                                || case when e.v ? 'd' then jsonb_build_object('d', (e.v ->> 'd')::int + mins * 60) else '{}'::jsonb end else e.v end)
                          from jsonb_each(tt) e(k, v)), '{}'::jsonb)
     where op = any(ids);
  elsif p_act = 'kind' then
    update mp_trains set kind = kd where op = any(ids);
  end if;
  foreach rr in array rids loop perform _mp_resched(rr); perform _mp_chg('route', rr, 'set', null); end loop;
  return jsonb_build_object('ok', true, 'n', n, 'trains', nt, 'routes', coalesce(array_length(rids, 1), 0));
end $$;
create or replace function public.mp_op_backup_save(p_label text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; bid bigint;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国の運用も（DB の更新101）
  perform _mp_lock(pa.pu, pa.pc);
  bid := _mp_op_backup_put(pa.pu, pa.pc, p_label);
  return jsonb_build_object('id', bid, 'list', mp_op_backup_list(p_as));
end $$;
create or replace function public.mp_op_backup_restore(p_id bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; b mp_op_backups; d jsonb; e jsonb; o mp_ops; fid bigint; rids bigint[]; rr bigint; keep text[]; nt int; ndel int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国の運用も（DB の更新101）
  select * into b from mp_op_backups x where x.id = p_id and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc;
  if not found then raise exception 'バックアップが見つかりません'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  d := b.data;
  perform _mp_op_backup_put(pa.pu, pa.pc, 'もどす前（自動）', b.id);   -- もどす前の運用ものこす
  keep := array(select x ->> 'num' from jsonb_array_elements(d -> 'ops') x);
  -- 変わる系統：いま運用・連結がある列車と、バックアップの列車
  rids := array(select distinct t.route from mp_trains t join mp_routes r on r.id = t.route
                 where r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc
                   and (t.op is not null or jsonb_array_length(coalesce(t.cpl, '[]'::jsonb)) > 0
                        or t.id in (select (x ->> 'id')::bigint from jsonb_array_elements(d -> 'trains') x)));
  foreach rr in array rids loop perform _mp_dia_snap(rr, 'バックアップから運用をもどした'); end loop;
  -- 1) バックアップにない運用を消す（その列車は運用なし・編成なし。連結からもはずす）
  update mp_trains t set op = null, form = null
   where t.op in (select o2.id from mp_ops o2 where o2.own_u is not distinct from pa.pu and o2.own_c is not distinct from pa.pc and not (o2.num = any(keep)));
  update mp_trains t set cpl = coalesce((select jsonb_agg(c.v order by c.o) from jsonb_array_elements(t.cpl) with ordinality c(v, o)
                                           where (c.v ->> 'op')::bigint in (select o2.id from mp_ops o2 where o2.num = any(keep) and o2.own_u is not distinct from pa.pu and o2.own_c is not distinct from pa.pc)), '[]'::jsonb)
   where jsonb_array_length(coalesce(t.cpl, '[]'::jsonb)) > 0
     and t.route in (select r.id from mp_routes r where r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc);
  delete from mp_ops o2 where o2.own_u is not distinct from pa.pu and o2.own_c is not distinct from pa.pc and not (o2.num = any(keep));
  get diagnostics ndel = row_count;
  -- 2) バックアップの運用をつくる・直す（編成はいったんはずして、3) で入れる）
  update mp_ops o2 set form = null where o2.own_u is not distinct from pa.pu and o2.own_c is not distinct from pa.pc;
  for e in select x from jsonb_array_elements(d -> 'ops') x loop
    o := null;
    select * into o from mp_ops x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.num = e ->> 'num';
    if o.id is null then
      insert into mp_ops(own_u, own_c, num, kind, note) values (pa.pu, pa.pc, left(e ->> 'num', 12), coalesce(e ->> 'kind', 'rail'), coalesce(e ->> 'note', ''));
    else
      update mp_ops set kind = coalesce(e ->> 'kind', kind), note = coalesce(e ->> 'note', '') where id = o.id;
    end if;
  end loop;
  -- 3) 編成（いまもある、この名義の編成だけ。1つの編成は1つの運用）
  for e in select x from jsonb_array_elements(d -> 'ops') x where x ->> 'form' is not null loop
    fid := (select f.id from mp_forms f where f.id = (e ->> 'form')::bigint and f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc);
    if fid is null or exists (select 1 from mp_ops x where x.form = fid) then continue; end if;
    update mp_ops x set form = fid where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.num = e ->> 'num';
  end loop;
  -- 4) 列車：そのときの運用・連結（いまもある、この名義の系統の列車だけ）
  update mp_trains t set op = o2.id, form = null,
         cpl = coalesce((select jsonb_agg(jsonb_build_object('op', o3.id, 'a', c.v -> 'a', 'b', c.v -> 'b') order by c.o)
                           from jsonb_array_elements(coalesce(x.v -> 'cpl', '[]'::jsonb)) with ordinality c(v, o)
                           join mp_ops o3 on o3.num = c.v ->> 'op' and o3.own_u is not distinct from pa.pu and o3.own_c is not distinct from pa.pc), '[]'::jsonb)
    from jsonb_array_elements(d -> 'trains') x(v)
    left join mp_ops o2 on o2.num = x.v ->> 'op' and o2.own_u is not distinct from pa.pu and o2.own_c is not distinct from pa.pc
   where t.id = (x.v ->> 'id')::bigint and t.route in (select r.id from mp_routes r where r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc);
  get diagnostics nt = row_count;
  -- 5) 列車の編成は、その運用の編成
  update mp_trains t set form = o2.form from mp_ops o2
   where t.op = o2.id and o2.own_u is not distinct from pa.pu and o2.own_c is not distinct from pa.pc and t.form is distinct from o2.form;
  foreach rr in array rids loop perform _mp_resched(rr); perform _mp_chg('route', rr, 'set', null); end loop;
  return jsonb_build_object('ok', true, 'ops', jsonb_array_length(d -> 'ops'), 'trains', nt, 'del', ndel, 'routes', coalesce(array_length(rids, 1), 0), 'list', mp_op_backup_list(p_as));
end $$;
create or replace function public.mp_op_import(p_data jsonb, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; e jsonb; tj jsonb; i int; j int; errs text[] := '{}'; warns text[] := '{}'; sumv jsonb := '[]'::jsonb;
        o mp_ops; r mp_routes; nm text; kd text; dir_ int; dep_ int; dy date; tt jsonb; sk bigint[]; sid bigint; kk text; vv jsonb; a_ int; d_ int; tr_ int;
        rowsv jsonb := '[]'::jsonb; fid bigint; opnum text; nadd int; ndel int; rids bigint[] := '{}'; cnt jsonb := '{}'::jsonb; oid_ bigint; x jsonb;
        lbl text; okind text; repl bigint[] := '{}'; other bigint; nops int;
        fnums text[]; cl jsonb; ce jsonb; cnum text; ca bigint; cb bigint; ns int; ka int; kb int; oids bigint[] := '{}'; sa_ bigint; sb_ bigint;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国の列車も（DB の更新101）
  if p_data is null or jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data -> '運用') is distinct from 'array' then raise exception 'ファイルの形がちがいます（「運用」の一覧がありません）'; end if;
  nops := jsonb_array_length(p_data -> '運用');
  if nops > 200 then raise exception '運用は一度に200までです'; end if;
  -- ファイルにある運用番号（連結の相手にできる）
  fnums := array(select nullif(left(trim(coalesce(z ->> '運用番号', '')), 12), '') from jsonb_array_elements(p_data -> '運用') z);
  -- 1) 調べる
  for i in 0..nops - 1 loop
    e := p_data -> '運用' -> i;
    opnum := nullif(left(trim(coalesce(e ->> '運用番号', '')), 12), '');
    o := null; okind := null;
    if opnum is not null then
      select * into o from mp_ops where own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and num = opnum;
      if o.id is not null then okind := o.kind; repl := repl || o.id; end if;
      if okind is null and e ->> '種類' in ('鉄道', 'バス', '船', '飛行機') then okind := case e ->> '種類' when 'バス' then 'bus' when '船' then 'ship' when '飛行機' then 'air' else 'rail' end; end if;
    end if;
    lbl := coalesce(opnum, '（運用なし）');
    -- 編成（書いてあるときだけ）
    if opnum is not null and e ? '編成' and jsonb_typeof(e -> '編成') = 'string' then
      fid := (select id from mp_forms where own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and name = e ->> '編成');
      if fid is null then errs := errs || format('運用 %s：編成「%s」が見つかりません', lbl, e ->> '編成'); end if;
    end if;
    nadd := 0;
    if e ? '列車' and jsonb_typeof(e -> '列車') <> 'array' then errs := errs || format('運用 %s：「列車」は一覧にしてください', lbl); continue; end if;
    for j in 0..coalesce(jsonb_array_length(e -> '列車'), 0) - 1 loop
      tj := e -> '列車' -> j;
      nm := left(trim(coalesce(tj ->> '列車番号', '')), 12);
      x := null; r := null;
      -- 系統（系統id か、名前）
      if (tj ->> '系統id') ~ '^\d+$' then
        select * into r from mp_routes where id = (tj ->> '系統id')::bigint and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
      end if;
      if r.id is null and coalesce(tj ->> '系統', '') <> '' then
        if (select count(*) from mp_routes where name = tj ->> '系統' and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc) > 1 then
          errs := errs || format('運用 %s の %s本目（%s）：系統「%s」が2つ以上あります（系統id で指定してください）', lbl, j + 1, nm, tj ->> '系統'); continue;
        end if;
        select * into r from mp_routes where name = tj ->> '系統' and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
      end if;
      if r.id is null then errs := errs || format('運用 %s の %s本目（%s）：系統が見つかりません', lbl, j + 1, nm); continue; end if;
      if okind is null then okind := r.kind; end if;
      if opnum is not null and okind <> r.kind then errs := errs || format('運用 %s の %s本目（%s）：鉄道とバスの列車は、同じ運用に入れられません', lbl, j + 1, nm); continue; end if;
      if nm = '' then errs := errs || format('運用 %s の %s本目：列車番号がありません', lbl, j + 1); continue; end if;
      dir_ := case when tj ->> '向き' in ('下り', '1') then 1 when tj ->> '向き' in ('上り', '-1') then -1 end;
      if dir_ is null then errs := errs || format('運用 %s の %s本目（%s）：向きは「下り」か「上り」です', lbl, j + 1, nm); continue; end if;
      dep_ := _mp_hm_parse(tj ->> '始発');
      if dep_ is null or dep_ >= 86400 then errs := errs || format('運用 %s の %s本目（%s）：始発の時刻が読めません（HH:MM）', lbl, j + 1, nm); continue; end if;
      dy := null;
      if coalesce(tj ->> '日付', '') <> '' then
        if (tj ->> '日付') !~ '^\d{4}-\d{2}-\d{2}$' then errs := errs || format('運用 %s の %s本目（%s）：日付が読めません（YYYY-MM-DD）', lbl, j + 1, nm); continue; end if;
        begin dy := (tj ->> '日付')::date; exception when others then dy := null; end;
        if dy is null or dy < _mp_today() or dy > _mp_today() + 60 then errs := errs || format('運用 %s の %s本目（%s）：日付は今日から60日先までです', lbl, j + 1, nm); continue; end if;
      end if;
      -- 途中始発・途中止まり（2026-10-28）：走る順で 始発駅 → 終着駅
      sa_ := null; sb_ := null;
      if coalesce(tj ->> '始発駅', '') <> '' then
        sa_ := _mp_route_sta(r.stops, tj ->> '始発駅');
        if sa_ is null then errs := errs || format('運用 %s の %s本目（%s）：駅「%s」はこの系統にありません', lbl, j + 1, nm, tj ->> '始発駅'); continue; end if;
      end if;
      if coalesce(tj ->> '終着駅', '') <> '' then
        sb_ := _mp_route_sta(r.stops, tj ->> '終着駅');
        if sb_ is null then errs := errs || format('運用 %s の %s本目（%s）：駅「%s」はこの系統にありません', lbl, j + 1, nm, tj ->> '終着駅'); continue; end if;
      end if;
      ns := array_length(r.stops, 1);
      ka := coalesce(_mp_kpos(r.stops, dir_, sa_, false), 1); kb := coalesce(_mp_kpos(r.stops, dir_, sb_, true), ns);   -- 環状線（2026-10-29）
      if ka >= kb then errs := errs || format('運用 %s の %s本目（%s）：始発駅は、終着駅より前（走る順）にしてください', lbl, j + 1, nm); continue; end if;
      sa_ := case when ka > 1 then sa_ end; sb_ := case when kb < ns then sb_ end;
      -- 採時駅の指定
      tt := '{}'::jsonb;
      if jsonb_typeof(tj -> '採時') = 'object' then
        for kk, vv in select * from jsonb_each(tj -> '採時') loop
          sid := _mp_route_sta(r.stops, kk);
          if sid is null then errs := errs || format('運用 %s の %s本目（%s）：駅「%s」はこの系統にありません', lbl, j + 1, nm, kk); x := 'null'; exit; end if;
          if not (sid = any(r.timing)) then warns := warns || format('運用 %s の %s本目（%s）：「%s」は採時駅ではないので、時刻の指定はつかいません', lbl, j + 1, nm, kk); continue; end if;
          a_ := case when coalesce(vv ->> '着', '') <> '' then _mp_hm_parse(vv ->> '着') end;
          d_ := case when coalesce(vv ->> '発', '') <> '' then _mp_hm_parse(vv ->> '発') end;
          tr_ := case when (vv ->> '番線') ~ '^\d+$' then (vv ->> '番線')::int end;
          if (coalesce(vv ->> '着', '') <> '' and a_ is null) or (coalesce(vv ->> '発', '') <> '' and d_ is null) then
            errs := errs || format('運用 %s の %s本目（%s）：「%s」の時刻が読めません', lbl, j + 1, nm, kk); x := 'null'; exit;
          end if;
          tt := tt || jsonb_build_object(sid::text, jsonb_strip_nulls(jsonb_build_object('a', a_, 'd', d_, 't', tr_)));
        end loop;
        if x is not null then continue; end if;
      end if;
      -- 通過する駅
      sk := '{}';
      if jsonb_typeof(tj -> '通過') = 'array' then
        for kk in select * from jsonb_array_elements_text(tj -> '通過') loop
          sid := _mp_route_sta(r.stops, kk);
          if sid is null then errs := errs || format('運用 %s の %s本目（%s）：駅「%s」はこの系統にありません', lbl, j + 1, nm, kk); x := 'null'; exit; end if;
          sk := sk || sid;
        end loop;
        if x is not null then continue; end if;
      end if;
      -- 連結（鉄道だけ・3つまで。つなぐ駅は切りはなす駅より前）
      cl := '[]'::jsonb;
      if jsonb_typeof(tj -> '連結') = 'array' and jsonb_array_length(tj -> '連結') > 0 then
        if r.kind <> 'rail' then errs := errs || format('運用 %s の %s本目（%s）：バスは連結できません', lbl, j + 1, nm); continue; end if;
        if jsonb_array_length(tj -> '連結') > 3 then errs := errs || format('運用 %s の %s本目（%s）：連結できるのは3つの運用までです', lbl, j + 1, nm); continue; end if;
        ns := array_length(r.stops, 1);
        for ce in select v from jsonb_array_elements(tj -> '連結') v loop
          cnum := nullif(left(trim(coalesce(ce ->> '運用番号', '')), 12), '');
          if cnum is null then errs := errs || format('運用 %s の %s本目（%s）：連結の運用番号がありません', lbl, j + 1, nm); x := 'null'; exit; end if;
          if cnum = opnum then errs := errs || format('運用 %s の %s本目（%s）：連結する運用が、この列車の運用と同じです', lbl, j + 1, nm); x := 'null'; exit; end if;
          if not (cnum = any(fnums) or exists (select 1 from mp_ops y where y.own_u is not distinct from pa.pu and y.own_c is not distinct from pa.pc and y.num = cnum and y.kind = 'rail')) then
            errs := errs || format('運用 %s の %s本目（%s）：連結する運用 %s が見つかりません', lbl, j + 1, nm, cnum); x := 'null'; exit;
          end if;
          if cl @> jsonb_build_array(jsonb_build_object('num', cnum)) then errs := errs || format('運用 %s の %s本目（%s）：同じ運用を2回は連結できません', lbl, j + 1, nm); x := 'null'; exit; end if;
          ca := null; cb := null;
          if coalesce(ce ->> 'つなぐ駅', '') <> '' then
            ca := _mp_route_sta(r.stops, ce ->> 'つなぐ駅');
            if ca is null then errs := errs || format('運用 %s の %s本目（%s）：駅「%s」はこの系統にありません', lbl, j + 1, nm, ce ->> 'つなぐ駅'); x := 'null'; exit; end if;
          end if;
          if coalesce(ce ->> '切りはなす駅', '') <> '' then
            cb := _mp_route_sta(r.stops, ce ->> '切りはなす駅');
            if cb is null then errs := errs || format('運用 %s の %s本目（%s）：駅「%s」はこの系統にありません', lbl, j + 1, nm, ce ->> '切りはなす駅'); x := 'null'; exit; end if;
          end if;
          ka := coalesce(_mp_kpos(r.stops, dir_, ca, false), 1); kb := coalesce(_mp_kpos(r.stops, dir_, cb, true), ns);
          if ka >= kb then errs := errs || format('運用 %s の %s本目（%s）：連結する駅は、切りはなす駅より前にしてください', lbl, j + 1, nm); x := 'null'; exit; end if;
          cl := cl || jsonb_build_array(jsonb_build_object('num', cnum, 'a', case when ka > 1 then ca end, 'b', case when kb < ns then cb end));
        end loop;
        if x is not null then continue; end if;
      end if;
      rowsv := rowsv || jsonb_build_array(jsonb_build_object('i', i, 'route', r.id, 'num', nm, 'kind', left(coalesce(nullif(trim(tj ->> '種別'), ''), '普通'), 8),
                 'dir', dir_, 'dep', dep_, 'day', dy, 'tt', tt, 'skip', to_jsonb(sk), 'cpl', cl, 'sa', sa_, 'sb', sb_));
      cnt := cnt || jsonb_build_object(r.id::text, coalesce((cnt ->> r.id::text)::int, 0) + 1);
      nadd := nadd + 1;
    end loop;
    ndel := case when o.id is not null then (select count(*) from mp_trains t where t.op = o.id) else 0 end;
    -- form：ファイルに「編成」があるときだけ（null は編成なしにする）
    sumv := sumv || jsonb_build_array(jsonb_build_object('num', opnum, 'new', opnum is not null and o.id is null, 'add', nadd, 'del', ndel)
               || case when opnum is not null and e ? '編成' then jsonb_build_object('form', e -> '編成') else '{}'::jsonb end);
  end loop;
  -- 系統ごとの列車は900本まで（2026-10-28 に400本から）
  for kk in select * from jsonb_object_keys(cnt) loop
    if (select count(*) from mp_trains t where t.route = kk::bigint and not (t.op is not null and t.op = any(repl))) + (cnt ->> kk)::int > 900 then
      errs := errs || format('系統「%s」の列車が900本をこえます', (select name from mp_routes where id = kk::bigint));
    end if;
  end loop;
  if p_dry or array_length(errs, 1) > 0 then
    return jsonb_build_object('ok', coalesce(array_length(errs, 1), 0) = 0, 'ops', sumv, 'errors', to_jsonb(errs[1:50]), 'nerr', coalesce(array_length(errs, 1), 0),
      'warns', to_jsonb(warns[1:30]), 'trains', jsonb_array_length(rowsv));
  end if;
  -- 2) 入れる（変わる系統は、前のダイヤをおぼえておく）
  rids := array(select distinct x2::bigint from (select jsonb_object_keys(cnt) x2 union select t.route::text from mp_trains t where t.op = any(repl)) z);
  perform _mp_dia_snap(x3, '運用ファイルを読みこんだ') from unnest(rids) x3;
  -- 2a) 運用をつくる・直す（その運用の列車は消す）
  for i in 0..nops - 1 loop
    e := p_data -> '運用' -> i;
    opnum := nullif(left(trim(coalesce(e ->> '運用番号', '')), 12), '');
    oid_ := null;
    if opnum is not null then
      select * into o from mp_ops where own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and num = opnum;
      if o.id is null then
        okind := coalesce((select (rw ->> 'route')::bigint from jsonb_array_elements(rowsv) rw where (rw ->> 'i')::int = i limit 1)::text, '');
        okind := coalesce((select kind from mp_routes where id = nullif(okind, '')::bigint), case e ->> '種類' when 'バス' then 'bus' when '船' then 'ship' when '飛行機' then 'air' else 'rail' end);
        insert into mp_ops(own_u, own_c, kind, num, note) values (pa.pu, pa.pc, okind, opnum, left(coalesce(e ->> 'メモ', ''), 200)) returning * into o;
      elsif e ? 'メモ' then update mp_ops set note = left(coalesce(e ->> 'メモ', ''), 200) where id = o.id;
      end if;
      oid_ := o.id;
      -- 編成（書いてあるときだけ。ほかの運用に入っていれば、そちらからはずす）
      if e ? '編成' then
        fid := case when jsonb_typeof(e -> '編成') = 'string' then (select id from mp_forms where own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and name = e ->> '編成') end;
        if fid is not null then
          select id into other from mp_ops where form = fid and id <> oid_;
          if other is not null then
            update mp_ops set form = null where id = other; update mp_trains set form = null where op = other;
            rids := rids || array(select distinct route from mp_trains where op = other);
          end if;
        end if;
        update mp_ops set form = fid where id = oid_;
      end if;
      delete from mp_trains t using mp_routes r2 where r2.id = t.route and t.op = oid_ and r2.own_u is not distinct from pa.pu and r2.own_c is not distinct from pa.pc;
    end if;
    oids := oids || oid_;
  end loop;
  -- 2b) 列車を入れる（編成は運用の編成。連結の運用番号は運用に）
  for i in 0..nops - 1 loop
    oid_ := oids[i + 1];
    insert into mp_trains(route, dir, num, kind, dep, form, op, day, tt, skip, cpl, sa, sb)
    select (rw ->> 'route')::bigint, (rw ->> 'dir')::int, rw ->> 'num', rw ->> 'kind', (rw ->> 'dep')::int, (select form from mp_ops where id = oid_), oid_,
           nullif(rw ->> 'day', '')::date, rw -> 'tt', coalesce(array(select jsonb_array_elements_text(rw -> 'skip')::bigint), '{}'),
           coalesce((select jsonb_agg(jsonb_build_object('op', y.id, 'a', (c.v ->> 'a')::bigint, 'b', (c.v ->> 'b')::bigint) order by c.o)
                       from jsonb_array_elements(rw -> 'cpl') with ordinality c(v, o)
                       join mp_ops y on y.num = c.v ->> 'num' and y.own_u is not distinct from pa.pu and y.own_c is not distinct from pa.pc and y.kind = 'rail' and y.id is distinct from oid_), '[]'::jsonb),
           nullif(rw ->> 'sa', '')::bigint, nullif(rw ->> 'sb', '')::bigint
      from jsonb_array_elements(rowsv) rw where (rw ->> 'i')::int = i;
  end loop;
  -- 連結している列車の系統も見なおす（相手の運用の編成が変わったかもしれない）
  rids := rids || array(select distinct t.route from mp_trains t join mp_routes r3 on r3.id = t.route
                         where r3.own_u is not distinct from pa.pu and r3.own_c is not distinct from pa.pc and t.cpl <> '[]'::jsonb);
  perform _mp_resched(x4) from (select distinct unnest(rids) x4) z;
  return jsonb_build_object('ok', true, 'ops', sumv, 'trains', jsonb_array_length(rowsv), 'warns', to_jsonb(warns[1:30]), 'routes', coalesce(array_length(rids, 1), 0));
end $$;
create or replace function public.mp_kinds_set(p_items jsonb, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; v jsonb; nm text; pr int; i int := 0; seen text[] := '{}'; rr bigint;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  -- 国の種別も（DB の更新101）
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception '種別の形がちがいます'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception '種別は30までです'; end if;
  delete from mp_kinds where own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  for v in select x from jsonb_array_elements(p_items) x loop
    nm := left(trim(coalesce(v ->> 'name', '')), 8);
    pr := case when (v ->> 'prio') ~ '^\d$' then (v ->> 'prio')::int end;
    if nm = '' then raise exception '種別の名前を入れてください'; end if;
    if nm = '各停' then nm := '普通'; end if;
    if pr is null then raise exception '優先番号は 0〜9 です'; end if;
    if nm = any(seen) then raise exception '種別「%」が2つあります', nm; end if;
    seen := seen || nm; i := i + 1;
    insert into mp_kinds(own_u, own_c, name, prio, ord) values (pa.pu, pa.pc, nm, pr, i);
  end loop;
  for rr in select r.id from mp_routes r where r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc and r.kind = 'rail' loop perform _mp_resched(rr); end loop;
  return _mp_kinds_of(pa.pu, pa.pc);
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
  if not _mp_mine(u, sg.own_u, sg.own_c) or sg.gov <> (st.own_u is null and st.own_c is null) then raise exception 'ほかの人の線路にある駅は、高さを変えられません'; end if;   -- 国の駅は国の線路の上（DB の更新101）
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
create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean;
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
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
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats,
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
                 'fser', fi.ser, 'fn', fi.n,   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk,   -- 編成の工事中（DB の更新60）
                 'sub', (select jsonb_agg(jsonb_build_array(s.day, extract(epoch from s.t0)::bigint, sf.name) order by s.t0) from mp_subst s join mp_forms sf on sf.id = s.sub
                          where s.train = t.id and s.t1 > now() - interval '1 day')   -- 予備編成の代走（DB の更新80）：［運行日, 発車, 予備編成］
               ) order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
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
        lfd boolean[]; rsh jsonb; sube jsonb := '{}'::jsonb; sk text; sf real; sbx record; ld int;   -- 変電所（DB の更新89）
        trk jsonb := '{}'::jsonb; xkb real;   -- 競馬場のお客（DB の更新92）
        lgm int[];   -- 走れる軌間（DB の更新99）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  -- 競馬場（DB の更新92）：この1時間のレースの来場者が、近くの駅・バス停で乗り降りする（系統ごと）。うまくいかなくても、ふだんどおり
  begin trk := _mp_track_riders(h); exception when others then trk := '{}'::jsonb; raise warning 'mp track riders: %', sqlerrm; end;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    lfd := case when r.kind = 'rail' then _mp_leg_fed(r.legs) end; rsh := case when r.kind = 'rail' then _mp_route_feed(r.legs) end;   -- 変電所（DB の更新89）
    lgm := case when r.kind = 'rail' then _mp_leg_gm(r.legs) end;   -- 軌間（DB の更新99）
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0)
                 and not exists (select 1 from mp_cxl zc where zc.train = t.id and zc.day = d0 and zc.ordk = 'v') loop   -- その日は運転整理の列車が かわりに走る（運休とは数えない。DB の更新100）
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
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and (select coalesce(bit_or(x.m), 0) from unnest(_mp_leg_pm(r.legs)) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) & ~coalesce((perf ->> 'ps')::int, 1) <> 0 then continue; end if;   -- 電化方式がちがう区間は走れない（DB の更新87）
      if r.kind = 'rail' and lgm is not null and coalesce((perf ->> 'gm')::int, 2) & ~(select coalesce(bit_and(x.m), 15) from unnest(lgm) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) <> 0 then continue; end if;   -- 軌間のちがう区間は走れない（DB の更新99）
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from unnest(lfd) with ordinality x(f, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib) and not x.f) then continue; end if;   -- 変電所から遠く、電気が来ていない区間は走れない（DB の更新89）
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
      end if;
      -- 変電所の負荷（DB の更新89）：電車・電気機関車は、走る区間の変電所に 出力 × 0.45 × 走る時間（1時間まで）× 長さの割合
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and rsh is not null then
        for sk, sf in select key, value::real from jsonb_each_text(rsh) loop
          sube := sube || jsonb_build_object(sk, coalesce((sube ->> sk)::real, 0) + coalesce((perf ->> 'kw')::real, 0) * 0.45 * least(rt, 3600) * sf * cf);
        end loop;
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
    xkb := coalesce((trk ->> r.id::text)::real, 0) * least(1.2, greatest(0.7, q));   -- 競馬場のお客（DB の更新92）：遅い線は少し へる
    dem := dem + xkb;
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0), 'kb', nullif(round(case when dem > 0 then served * xkb / dem else 0 end), 0)));   -- kb：競馬場のお客（DB の更新92）   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 変電所（DB の更新89）：この1時間の負荷（平均 × 1.6 を いちばん多いときとみる）。容量をこえたら電圧の低下、1.5倍をこえたら停止（3時間に1回まで）
  for sbx in select vs.* from mp_subs vs loop
    ld := round(coalesce((sube ->> sbx.id::text)::real, 0) / 3600 * 1.6);
    update mp_subs set load = ld where id = sbx.id;
    if ld > sbx.cap and (sbx.ev_at is null or sbx.ev_at < h - interval '3 hours') and (sbx.trip is null or sbx.trip < now()) then
      begin perform _mp_sub_event(sbx.id, ld); exception when others then raise warning 'mp sub event: %', sqlerrm; end;
    end if;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, o.pu is null and o.pc is null, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when kind = 'rail' then _mp_trk_upk(gauge, g2, slp, elec, cat) else 1 end + case when kind = 'rail' then len * _mp_nw_upk(nw) else 0 end a, '線路・道路' k   -- 規格（DB の更新99）
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
      union all select own_u, own_c, upk, '変電所' from mp_subs where not gov   -- 変電所（DB の更新89）
      union all select p.own_u, p.own_c, (_mp_attr_kinds() -> a.kind ->> 'upk')::numeric, 'アトラクション' from mp_attrs a join mp_blds b on b.id = a.bld join mp_parcels p on p.id = b.parcel where not p.gov   -- DB の更新91
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
create or replace function public._mp_unko_furi_pay(r mp_routes, lost real, fare real) returns void
language plpgsql set search_path = public as $$
declare p record; n int; per real; amt bigint; paid bigint;
begin
  if lost < 1 or fare <= 0 then return; end if;
  -- 近く（約750m）に駅・バス停があって、同じ乱れで止まっていない線の持ち主
  select count(*) into n from (select distinct p2.own_u, p2.own_c from mp_routes p2
     where p2.ok and p2.kind in ('rail', 'bus') and p2.id <> r.id
       and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[p2.id] and z.routes @> array[r.id])
       and exists (select 1 from unnest(r.stops) b(sid) join mp_stations s1 on s1.id = b.sid, unnest(p2.stops) a(sid) join mp_stations s2 on s2.id = a.sid
                    where abs(s1.x - s2.x) < 1500 and abs(s1.y - s2.y) < 1500)) d;
  if n = 0 then return; end if;
  per := lost * 0.7 / n;
  for p in select distinct p2.own_u u, p2.own_c c from mp_routes p2
     where p2.ok and p2.kind in ('rail', 'bus') and p2.id <> r.id
       and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[p2.id] and z.routes @> array[r.id])
       and exists (select 1 from unnest(r.stops) b(sid) join mp_stations s1 on s1.id = b.sid, unnest(p2.stops) a(sid) join mp_stations s2 on s2.id = a.sid
                    where abs(s1.x - s2.x) < 1500 and abs(s1.y - s2.y) < 1500) loop
    if p.u is not distinct from r.own_u and p.c is not distinct from r.own_c then continue; end if;   -- 自分のほかの線：お金は動かない
    amt := round(per * fare * 0.5);
    if amt <= 0 then continue; end if;
    paid := case when r.own_u is null and r.own_c is null then amt   -- 国の系統は国庫から（DB の更新101）
                 else _mp_soft_pay(r.own_u, r.own_c, false, amt, 'fee', format('振替輸送の精算（%s・%s人）', r.name, round(per))) end;
    if paid > 0 and (p.u is not null or p.c is not null) then
      perform _mp_earn(p.u, p.c, false, paid, 'fare', format('振替輸送（%sのお客・%s人）', r.name, round(per)));
    end if;
  end loop;
end $$;
create or replace function public.mp_unko_pick(p_id bigint, p_pick int, p_as text, p_wide boolean default null, p_ori boolean default null, p_det boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; z mp_unko; dj jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_pick is null or p_pick not between 1 and 5 then raise exception '1〜5 からえらんでください'; end if;
  select * into z from mp_unko where id = p_id for update;
  if not found then raise exception '運行情報が見つかりません'; end if;
  if z.kind = 'snowstop' then raise exception '冬の運休は、対応をえらべません（雪の対策がすむと、15分ほどで再開します）'; end if;
  if not (z.own_u is not distinct from pa.pu and z.own_c is not distinct from pa.pc) then   -- 国の線（持ち主なし）は名義「国」で（DB の更新101）
    raise exception 'この対応をえらべるのは「%」です（名義を切りかえてください）', _mp_pname(z.own_u, z.own_c, false);
  end if;
  if z.st = 'done' or (z.st = 'run' and coalesce(z.t_end, now()) <= now() and now() >= z.t0 + make_interval(secs => z.dur)) then raise exception 'この乱れは、もうおわっています'; end if;
  if z.st = 'run' and z.pick = p_pick and (p_wide is null or p_wide = z.wide) and (p_ori is null or p_ori = z.ori) and (p_det is null or p_det = (z.det is not null)) then
    raise exception 'いまと同じ対応です';
  end if;
  if p_wide is not null and p_wide is distinct from z.wide then update mp_unko set wide = p_wide where id = p_id; end if;   -- 範囲：乱れの区間だけ・全線（DB の更新60）
  -- 区間折り返し・迂回（DB の更新82。鉄道の、区間だけの乱れ）
  if (coalesce(p_ori, false) or coalesce(p_det, false)) and (coalesce(z.mode, 'rail') <> 'rail' or coalesce(p_wide, z.wide)) then
    raise exception '区間折り返し・迂回は、鉄道の「乱れの区間だけ」のときにえらべます';
  end if;
  if p_ori is not null and p_ori is distinct from z.ori then update mp_unko set ori = p_ori where id = p_id; end if;
  if p_det is not null then
    if p_det then
      dj := _mp_unko_det(p_id);
      if dj is null then raise exception '迂回できる線路がありません（区間の手前と先の駅を、区間を通らずにつなぐ自分の線路がいります。電化した区間は、電化した線路で）'; end if;
    end if;
    update mp_unko set det = dj where id = p_id;
  end if;
  perform _mp_unko_apply(z.id, p_pick, false);
  select * into z from mp_unko where id = p_id;
  return jsonb_build_object('ok', true, 'pick', z.pick, 'tend', extract(epoch from z.t_end), 'wide', z.wide, 'ori', z.ori, 'det', z.det);
end $$;
create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 3, 'aioff', case when gv then null else _mp_unko_off(pu, pc) end, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null or gv) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi),
                         'zi', q.zi, 'zt', _mp_unko_zt(r.id, q.zi),
                         'det', case when q.zi is not null and z.det is not null then (z.det ->> r.id::text)::float8 end) order by r.id), '[]'::jsonb)   -- 区間（DB の更新60）・迂回の速さ（DB の更新82）
                 from mp_routes r cross join lateral (select _mp_unko_zi(z, r.id) zi) q where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st, 'wide', z.wide, 'ori', z.ori, 'det', z.det is not null,
    'log', (select coalesce(jsonb_agg(l order by (l ->> 0)::float8), '[]'::jsonb) from jsonb_array_elements(z.log) l where (l ->> 0)::float8 <= extract(epoch from now()) + 1),
    'by', _mp_pname(z.own_u, z.own_c, false),
    'me', (pu is not null or pc is not null or gv) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,   -- 国の線は名義「国」で（DB の更新101）
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') when z.own_u is null and _is_admin(u) then 'gov' end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'),
    -- 持ち主が決めた運休（1本：きのうから・編成ごと：おわって6時間まで）：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の]（DB の更新60）
    'cx', (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.train, c.day, c.form, extract(epoch from c.t0), extract(epoch from e.t1), c.unko,
                    (pu is not null or pc is not null or gv) and c.own_u is not distinct from pu and c.own_c is not distinct from pc) order by c.id), '[]'::jsonb)
             from mp_cxl c left join mp_unko z2 on z2.id = c.unko
             cross join lateral (select coalesce(c.t1, case when z2.st = 'done' then greatest(z2.t_end, z2.t0 + make_interval(secs => z2.dur)) end) t1) e
            where c.ordk is null and ((c.day is not null and c.day >= today - 1) or (c.form is not null and coalesce(e.t1, 'infinity'::timestamptz) > now() - interval '6 hours'))));   -- 運転整理の分は mp_dia で（DB の更新100）
end $$;

-- 時刻を組みなおす操作の待ち時間（create or replace で消えた設定も もどす）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '60s';
alter function public.mp_sta_height(bigint, text, boolean) set statement_timeout = '60s';
alter function public.mp_unko_pick(bigint, int, text, boolean, boolean, boolean) set statement_timeout = '20s';
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mp_sta_resize', 'mp_op_save', 'mp_ops_bulk', 'mp_op_backup_restore', 'mp_op_import', 'mp_kinds_set') loop
    execute format('alter function %s set statement_timeout = %L', f.sig, '20s');
  end loop;
end $$;
