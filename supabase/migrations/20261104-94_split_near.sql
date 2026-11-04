-- 線のとちゅうから分かれ道をつくるのを軽くする：分けた線を通る系統は、道すじが ほとんど同じなら（通る線の番号と、分けたところの制限速度が少しかわるだけ）、
--   道すじだけ書きかえて、時刻は組みなおさない（前は 列車の多い系統ごとに 3秒くらいかかり、都心で線をひくと 7〜8秒かかっていた）
--   使用料を決めなおすときは、使用料が前から決まっている区画・使用料のいらない区画（自分の筆）の地価をしらべない（線を2つに分けるとき、長い線では 1秒くらいかかっていた）
--   線の操作のあと、系統の道すじを出しなおすのは、その線を通る系統だけにする（行きどまりの分かれ道・線を1本にする・消す・設定・高さ。
--   新しくつながったところができるときと、線の形を変えたときは、前と同じく ぜんぶ）

-- 制限速度どおりに走ったときの秒（駅と駅のあいだ1つ。くらべる用。DB の更新94）
create or replace function public._mp_ptime(p jsonb) returns real
language sql immutable as $$
  select coalesce(sum((e ->> 0)::real / greatest((e ->> 1)::real, 1) * 3.6), 0)::real from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
$$;
-- 系統の道すじ（legs）が ほとんど同じか（DB の更新94）：駅と駅のあいだの数・電化・単線が同じで、長さのちがいが 1m まで、
--   制限速度どおりに走ったときの秒のちがいが 1秒まで、複々線・電化方式・デッドセクション・変電所・信号が同じ。
--   ちがってよいのは、通る線の番号と位置（線を2つに分けたとき）と、分けたところの制限速度の少しのちがい（カーブの見かたの点が少しずれる）
create or replace function public._mp_legs_near(a jsonb, b jsonb) returns boolean
language sql stable set search_path = public as $$
  select jsonb_array_length(coalesce(a, '[]'::jsonb)) = jsonb_array_length(coalesce(b, '[]'::jsonb))
     and not exists (select 1 from jsonb_array_elements(coalesce(a, '[]'::jsonb)) with ordinality x(l, k)
                       join jsonb_array_elements(coalesce(b, '[]'::jsonb)) with ordinality y(m, j) on j = x.k
                      where (x.l - 'g' - 'p' - 'd') is distinct from (y.m - 'g' - 'p' - 'd')
                         or abs(coalesce((x.l ->> 'd')::real, 0) - coalesce((y.m ->> 'd')::real, 0)) > 1
                         or abs(_mp_ptime(x.l -> 'p') - _mp_ptime(y.m -> 'p')) > 1)
     and _mp_leg_quad(a) = _mp_leg_quad(b) and _mp_leg_pm(a) = _mp_leg_pm(b) and _mp_leg_dz(a) = _mp_leg_dz(b)
     and _mp_leg_fed(a) = _mp_leg_fed(b) and _mp_leg_sig(a) = _mp_leg_sig(b)
$$;

drop function if exists public._mp_routes_fix(uuid, int);   -- p_only を足した（DB の更新94）
create or replace function public._mp_routes_fix(pu uuid, pc int, p_only bigint[] default null) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; i int; leg jsonb; lg jsonb; bad text; ids bigint[] := '{}'; lgs jsonb[] := '{}'; bads text[] := '{}'; same boolean[] := '{}'; k int;
        fp0 text;   -- DB の更新88
        near boolean[] := '{}';   -- DB の更新94
begin
  -- 1. 系統ごとに、線路の道すじを出しなおす
  --    p_only（DB の更新94）：その線を通らない系統は、道すじが変わらないので出しなおさない（線を分けて行きどまりの線をつないだ・線を1本にした・消した・
  --    設定を変えたときで、新しくつながったところがないとき。道すじは線の長さとつながりだけで決まるので）
  for r in select * from mp_routes x where x.kind = 'rail' and ((x.own_u is not distinct from pu and x.own_c is not distinct from pc)
             or exists (select 1 from mp_thru t where t.hu is not distinct from pu and t.hc is not distinct from pc and t.gu is not distinct from x.own_u and t.gc is not distinct from x.own_c)) loop
    if p_only is not null and not exists (select 1 from jsonb_array_elements(r.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g where (g ->> 0)::bigint = any(p_only)) then
      ids := ids || r.id; lgs := lgs || r.legs; bads := bads || case when r.ok then null else coalesce(r.why, '') end; same := same || true; near := near || false;
      continue;
    end if;
    lg := '[]'::jsonb; bad := null;
    for i in 1..array_length(r.stops, 1) - 1 loop
      leg := _mp_rail_path(r.own_u, r.own_c, r.stops[i], r.stops[i + 1]);
      if leg is null then bad := format('%s → %s の線路がつながっていません', (select name from mp_stations where id = r.stops[i]), (select name from mp_stations where id = r.stops[i + 1])); exit; end if;
      lg := lg || jsonb_build_array(leg);
    end loop;
    ids := ids || r.id; lgs := lgs || lg; bads := bads || bad;
    same := same || coalesce((bad is null and r.ok and r.legs = lg) or (bad is not null and not r.ok and r.why is not distinct from bad), false);
    near := near || coalesce(bad is null and r.ok and r.legs <> lg and _mp_legs_near(r.legs, lg), false);   -- DB の更新94
  end loop;
  -- 2.（2026-10-28）どの系統も前とまったく同じなら、何もしない（時刻も前のまま）。前は線路を1本つくるたびに、ぜんぶの系統の時刻を組みなおしていて、8秒の制限をこえていた
  if coalesce(array_length(ids, 1), 0) = 0 or true = all(same) then return; end if;
  -- 2.5 道すじが ほとんど同じ系統（線のとちゅうから分かれ道をつくって、通る線が2つに分かれただけ）は、道すじだけ書きかえて、時刻は前のまま（DB の更新94）。
  --     前は ここでも時刻をぜんぶ組みなおしていて、列車の多い系統が通る線から分かれ道をつくると 1系統 3秒くらい かかっていた
  for k in 1..array_length(ids, 1) loop
    if not same[k] and near[k] then
      update mp_routes set legs = lgs[k] where id = ids[k];   -- 走る時間のメモ（runt）も前のまま（時刻と同じ道すじの見かた）
      same[k] := true;
    end if;
  end loop;
  if true = all(same) then return; end if;
  -- 3. 道すじが変わった系統だけ、書きかえて時刻を組みなおす（DB の更新88）。
  --    前は どれか1つ変わると、ぜんぶの系統（乗り入れもふくむ）を組みなおしていて、大きい路線網のまん中で線を分けると（分かれ道をつくると）20秒の制限をこえていた
  fp0 := _mp_routes_fp(ids);   -- 組みなおす前の、列車の時刻・待避・注意・走れるか
  for k in 1..array_length(ids, 1) loop
    if not same[k] then
      update mp_routes set legs = case when bads[k] is null then lgs[k] else mp_routes.legs end, ok = bads[k] is null, why = bads[k], runt = '{}'::jsonb where id = ids[k];
      if bads[k] is null then perform _mp_resched(ids[k]); end if;
    end if;
  end loop;
  -- 4. 組みなおした結果が前とまったく同じなら、ほかの系統はそのまま。変わったら、前と同じように ほかの系統も組みなおす（待避・番線のかさなりが変わるので）
  if _mp_routes_fp(ids) is distinct from fp0 then
    for k in 1..array_length(ids, 1) loop
      if same[k] and bads[k] is null then perform _mp_resched(ids[k]); end if;
    end loop;
  end if;
end $$;

create or replace function public._mp_lease_set(rk text, rid bigint, pu uuid, pc int, gv boolean, prev jsonb default null) returns numeric
language plpgsql set search_path = public as $$
declare total numeric; cells int[];
begin
  prev := coalesce(prev, (select jsonb_object_agg(e.x || ',' || e.y, e.fee) from mp_leases e where e.ref_kind = rk and e.ref = rid), '{}'::jsonb);
  delete from mp_leases where ref_kind = rk and ref = rid;
  if gv then return 0; end if;
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

create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); pws smallint := least(2, greatest(0, coalesce((p_opts ->> 'ps')::int, 0)))::smallint; elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
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
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt, quad, ps)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho, quad, case when elec then pws else 0 end)
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
    perform _mp_renet(a.own_u, a.own_c); perform _mp_routes_fix(a.own_u, a.own_c, ch);   -- 1本にした線を通る系統だけ（DB の更新94）
  end if;
  select * into s from mp_segs where id = m;
  return jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(s.pts), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
    'o', case when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end, 'mine', true, 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1), 'ctl', to_jsonb(s.ctl));
end $$;

create or replace function public.mp_seg_opts(p_id bigint, p_dbl boolean, p_elec boolean, p_name text, p_dry boolean, p_lanes int default null, p_quad boolean default null, p_ps int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ters text[]; amt_ numeric := 0; i int; base numeric; nl int; what text := ''; mul real[]; what2 text; wc int[]; need jsonb;
        nq boolean; nd boolean; m0 numeric; m1 numeric; rid bigint; ne boolean; nps smallint;   -- ne・nps：電化・電化方式（DB の更新87）
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
  ne := sg.kind = 'rail' and coalesce(p_elec, sg.elec);
  nps := case when ne then least(2, greatest(0, coalesce(p_ps, sg.ps)))::smallint else sg.ps end;
  if sg.kind = 'rail' then
    base := _mp_rate('rail');
    m0 := _mp_trmul(sg.dbl, sg.quad); m1 := _mp_trmul(nd, nq);
    if not sg.gov then
      for i in 1..array_length(ters, 1) loop
        if m1 > m0 then amt_ := amt_ + base * mul[i] * (m1 - m0); end if;
        if coalesce(p_elec, sg.elec) and not sg.elec then amt_ := amt_ + _mp_rate('elec');
        elsif ne and sg.elec and nps <> sg.ps then amt_ := amt_ + _mp_rate('elec') * 0.6; end if;   -- 電化方式を変える（架線と変電の設備を取りかえる。DB の更新87）
      end loop;
    end if;
    what := case when nq and not sg.quad then '複々線化' when nd and not sg.dbl then '複線化' else '' end || case when coalesce(p_elec, sg.elec) and not sg.elec then '電化' when ne and sg.elec and nps <> sg.ps then '電化方式の変更' else '' end;
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
  if p_dry then return jsonb_build_object('cost', amt_, 'lanes', nl, 'need', need, 'quad', nq, 'ps', nps); end if;
  perform _mp_land_stop(need);
  if amt_ > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, case when sg.kind = 'rail' then '線路の' else '道路の' end || what); end if;
  update mp_segs set dbl = case when kind = 'rail' then nd else false end, quad = case when kind = 'rail' then nq else false end,
         elec = case when kind = 'rail' then coalesce(p_elec, elec) else false end, ps = nps,
         name = coalesce(left(p_name, 30), name),
         lanes = nl,
         w = case when kind = 'rail' then case when nq then 0.8 when nd then 0.5 else 0.36 end else _mp_road_w(cls, nl) end,
         vlim = case when kind = 'rail' then vlim else _mp_road_v(cls, nl) end,
         cost = cost + amt_::bigint
   where id = p_id;
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c, array[p_id]); end if;   -- この線を通る系統だけ（DB の更新94）
  if sg.kind = 'rail' and (nq is distinct from sg.quad or nps is distinct from sg.ps) then   -- 複々線・電化方式（DB の更新87）：通る系統の時刻を計算しなおす（道すじは同じなので _mp_routes_fix ではしない）
    for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = p_id loop
      perform _mp_resched(rid);
    end loop;
  end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  return jsonb_build_object('id', p_id, 'cost', amt_, 'lanes', nl, 'quad', nq, 'ps', nps);
end $$;

create or replace function public._mp_seg_remove(p_id bigint) returns void
language plpgsql set search_path = public as $$
declare sg mp_segs;
begin
  select * into sg from mp_segs where id = p_id;
  if not found then return; end if;
  delete from mp_occ where what = sg.kind and ref = p_id;
  perform _mp_lease_del('seg', p_id);
  delete from mp_leases where ref_kind = 'sta' and ref in (select id from mp_stations where seg = p_id);
  delete from mp_leases where ref_kind = 'dep' and ref in (select id from mp_depots where seg = p_id);
  delete from mp_stations where seg = p_id;
  delete from mp_depots where seg = p_id;
  delete from mp_segs where id = p_id;
  delete from mp_nodes n where n.id in (sg.n0, sg.n1) and n.name is null and not exists (select 1 from mp_segs s where s.n0 = n.id or s.n1 = n.id);
  if sg.kind = 'rail' then perform _mp_renet(sg.own_u, sg.own_c); perform _mp_routes_fix(sg.own_u, sg.own_c, array[p_id]); end if;   -- 消した線を通っていた系統だけ（DB の更新94）
  perform _mp_chg('seg', p_id, 'del', sg.bb);
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
  if sg.kind = 'rail' and vl is distinct from sg.vlim then perform _mp_routes_fix(sg.own_u, sg.own_c, array[p_id]); end if;   -- この線を通る系統だけ（DB の更新94）
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  for s in select id, x, y from mp_stations where seg = p_id loop
    perform _mp_chg('sta', s.id, 'set', box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3)));
  end loop;
  return jsonb_build_object('id', p_id, 'cost', amt);
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_ptime', '_mp_legs_near', '_mp_routes_fix', '_mp_lease_set', '_mp_seg_remove') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
-- 作りなおした関数の 待つ時間（作りなおすと消えるので、前と同じに。DB の更新88：線の操作は60秒・高さは20秒）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mp_seg_build', 'mp_seg_join', 'mp_seg_opts', 'mp_seg_height') loop
    execute format('alter function %s set statement_timeout = %L', f.sig, case when f.proname = 'mp_seg_height' then '20s' else '60s' end);
  end loop;
end $$;
