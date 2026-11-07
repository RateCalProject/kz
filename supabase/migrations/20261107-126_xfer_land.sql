-- DB の更新126：編成・車両の譲渡を 受けとるとき、陸上輸送費をはらって どこの車庫へも送れる（線路がつながっていなくても）。社長あてなら 社長の会社の車庫にも置ける。
--   転属・譲渡の履歴（この名義の車両の 転属・回送・陸送・譲渡を 新しい順に）

-- 送る費用と時間（車両ごとに いまの車庫から）：同じ線路でつながっていれば回送（形式の値段の0.5%・2時間）、ちがえば陸送（3%・12時間）。バスは回送、船・飛行機は回航
create or replace function public._mp_xfer_ship(p_cars bigint[], d mp_depots) returns jsonb
language plpgsql stable set search_path = public as $$
declare zc record; zcost bigint := 0; zh int := 0; zland boolean := false; zsame boolean; zr numeric; zhr int;
begin
  for zc in select cc.id, t.price tprice, s.seg sseg, s.x sx, s.y sy from mp_cars cc join mp_types t on t.code = cc.type left join mp_depots s on s.id = cc.depot where cc.id = any(p_cars) loop
    zsame := d.kind = 'rail' and zc.sseg is not null and d.seg is not null and (select net from mp_segs where id = zc.sseg) is not distinct from (select net from mp_segs where id = d.seg)
             and (select net from mp_segs where id = d.seg) is not null;
    zr := case when d.kind in ('bus', 'ship', 'air') or zsame then 0.005 else 0.03 end;
    zhr := case when d.kind = 'bus' then 2 when d.kind = 'air' then 2
                when d.kind = 'ship' then greatest(3, ceil(sqrt(((d.x - coalesce(zc.sx, d.x)) / 100.0) ^ 2 + ((d.y - coalesce(zc.sy, d.y)) / 100.0) ^ 2) * 0.05 * 1.3 / 25))::int
                when zsame then 2 else 12 end;
    if d.kind = 'rail' and not zsame then zland := true; end if;
    zcost := zcost + round(coalesce(zc.tprice, 0) * zr); zh := greatest(zh, zhr);
  end loop;
  return jsonb_build_object('cost', zcost, 'hours', greatest(zh, 2),
    'how', case when d.kind in ('ship', 'air') then '回航' when d.kind = 'bus' or not zland then '回送' else '陸送' end);
end $$;
revoke all on function public._mp_xfer_ship(bigint[], mp_depots) from public, anon, authenticated;

-- とどいた申しこみを 置ける車庫（受けとる名義の車庫。社長あてなら 社長の会社の車庫も）と、それぞれの 送る費用・時間
create or replace function public.mp_xfer_deps(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); zcs int[]; zx mp_xfers; zids bigint[]; zk text;
begin
  perform _mp_ok(u);
  zcs := array(select id from companies where owner = u);
  select * into zx from mp_xfers where id = p_id and st = 'offer';
  if not found or not coalesce(zx.to_u = u or zx.to_c = any(zcs), false) then raise exception '申しこみが見つかりません'; end if;
  zids := case when zx.form is not null then array(select id from mp_cars where form = zx.form) else zx.cars end;
  zk := coalesce((select case when bool_or(ty.role = 'Ship') then 'ship' when bool_or(ty.role = 'Air') then 'air' when bool_or(ty.role in ('Bus', 'Truck')) then 'bus' else 'rail' end
                    from mp_cars c join mp_types ty on ty.code = c.type where c.id = any(zids)), 'rail');
  return jsonb_build_object('kind', zk, 'n', coalesce(array_length(zids, 1), 0), 'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'cap', d.cap,
            'n', (select count(*) from mp_cars c where c.depot = d.id), 'co', case when zx.to_u is not null and d.own_c is not null then _mp_pname(null, d.own_c, false) end,
            'ship', _mp_xfer_ship(zids, d)) order by (d.own_c is not null and zx.to_u is not null), d.name), '[]'::jsonb)
           from mp_depots d
          where d.kind = zk and (_mp_dep_ok(d, zx.to_u, zx.to_c)
                 or (zx.to_u = u and d.own_u is null and d.own_c = any(zcs) and (select status from companies where id = d.own_c) = 'active'))));
end $$;
revoke all on function public.mp_xfer_deps(bigint) from public, anon;
grant execute on function public.mp_xfer_deps(bigint) to authenticated;

-- 受けとる：p_depot は受けとる名義の車庫（社長あてなら 社長の会社の車庫でもよい。そのときは 会社が受けとる）。代金と 陸上輸送費をはらう
create or replace function public.mp_xfer_accept(p_id bigint, p_depot bigint, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); me_cs int[]; x mp_xfers; f mp_forms; d mp_depots; ncar int; have int; nm text; k text; c record; s int; t mp_types; rail boolean; tonm text; fromnm text; n0 text; knd text;
        zq jsonb;
begin
  perform _mp_ok(u);
  me_cs := array(select id from companies where owner = u);
  select * into x from mp_xfers where id = p_id and st = 'offer' for update;
  if not found or not coalesce(x.to_u = u or x.to_c = any(me_cs), false) then raise exception '申しこみが見つかりません'; end if;
  -- 社長あてなら、社長の会社の車庫にも置ける（その会社が受けとる。DB の更新126）
  select * into d from mp_depots where id = p_depot;
  if found and x.to_u = u and not _mp_dep_ok(d, x.to_u, x.to_c) and d.own_u is null and d.own_c = any(me_cs) then
    x.to_u := null; x.to_c := d.own_c;
    update mp_xfers set to_u = null, to_c = d.own_c where id = x.id;
  end if;
  if x.to_c is not null and (select status from companies where id = x.to_c) <> 'active' then raise exception 'この会社は、いまは使えません'; end if;
  perform _mp_lock(x.to_u, x.to_c);   -- 受けとる名義の操作は1つずつ（車庫の空き・車番。DB の更新60）
  tonm := _mp_pname(x.to_u, x.to_c, false); fromnm := _mp_pname(x.from_u, x.from_c, false);
  -- 1両ずつ（t54h）
  if x.form is null then
    ncar := coalesce(array_length(x.cars, 1), 0);
    perform 1 from mp_cars where id = any(x.cars) for update;
    if ncar = 0 or (select count(*) from mp_cars where id = any(x.cars) and own_u is not distinct from x.from_u and own_c is not distinct from x.from_c and form is null) <> ncar then
      raise exception 'この車両は、もう相手のものではないか、編成に入っています';
    end if;
    knd := coalesce((select case when bool_or(ty.role = 'Ship') then 'ship' when bool_or(ty.role = 'Air') then 'air' when bool_or(ty.role in ('Bus', 'Truck')) then 'bus' else 'rail' end
                       from mp_cars cc join mp_types ty on ty.code = cc.type where cc.id = any(x.cars)), 'rail');   -- t54o：船も
    select * into d from mp_depots where id = p_depot;
    if not found or not _mp_dep_ok(d, x.to_u, x.to_c) then raise exception '車籍を置く車庫をえらんでください（受けとる名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
    if d.kind <> knd then raise exception '%', case knd when 'rail' then '電車は車両基地に置きます' when 'ship' then '船は港に置きます' when 'air' then '飛行機は空港の駐機場に置きます' else 'バスは営業所に置きます' end; end if;
    select count(*) into have from mp_cars where depot = p_depot;
    if have + ncar > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
    if x.price > 0 then
      perform _mp_pay(x.to_u, x.to_c, false, x.price, 'car', format('車両%s両をゆずり受けた', ncar));
      perform _mp_earn(x.from_u, x.from_c, false, x.price, 'car', format('車両%s両をゆずった', ncar));
    end if;
    zq := _mp_xfer_ship(x.cars, d);   -- 陸上輸送費（受けとる名義が はらう。DB の更新126）
    if (zq->>'cost')::bigint > 0 then perform _mp_pay(x.to_u, x.to_c, false, (zq->>'cost')::bigint, 'car', format('ゆずり受けた車両%s両を「%s」へ%s', ncar, d.name, zq->>'how')); end if;
    k := _mp_okey(x.to_u, x.to_c);
    for c in select cc.id, cc.type, cc.num from mp_cars cc where cc.id = any(x.cars) order by array_position(x.cars, cc.id) loop
      select * into t from mp_types where code = c.type;
      s := coalesce((select z.n from mp_serials z where z.owner = k and z.type = t.code), 0);
      if t.num_from + s > t.num_to then raise exception '%の車番がいっぱいです（%〜%）', t.label, t.num_from, t.num_to; end if;
      insert into mp_serials(owner, type, n) values (k, t.code, s + 1) on conflict (owner, type) do update set n = excluded.n;
      update mp_cars set num = _mp_carnum(t, t.num_from + s), own_u = x.to_u, own_c = x.to_c, depot = p_depot,
             busy_from = case when busy_until > now() then busy_from else now() end, busy_until = greatest(coalesce(busy_until, now()), now() + make_interval(hours => (zq->>'hours')::int)), busy_kind = 'move' where id = c.id;
      insert into mp_car_hist(car, k, num, type, ou, oc, d) values (c.id, 'xfer', _mp_carnum(t, t.num_from + s), c.type, x.to_u, x.to_c, jsonb_build_object('from', fromnm, 'to', tonm, 'num0', c.num, 'dep', d.name, 'how', zq->>'how'));
    end loop;
    update mp_xfers set st = 'done', decided_at = now() where id = x.id;
    perform _notice_l(coalesce(x.from_u, (select owner from companies where id = x.from_c)),
      format('【国土】車両%s両の譲渡を、%sが受けとりました（%s X）。', ncar, tonm, _fmt(x.price)), jsonb_build_object('go', 'map', 'k', 'xfer'), null);
    return jsonb_build_object('n', ncar, 'price', x.price, 'ship', zq);
  end if;
  select * into f from mp_forms where id = x.form for update;
  if not found or not (f.own_u is not distinct from x.from_u and f.own_c is not distinct from x.from_c) then raise exception 'この編成は、もう相手のものではありません'; end if;
  ncar := (select count(*) from mp_cars where form = f.id);
  if ncar = 0 then raise exception 'この編成には車両がありません'; end if;
  knd := _mp_form_kind(f.id);   -- t54o：船も
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_dep_ok(d, x.to_u, x.to_c) then raise exception '車籍を置く車庫をえらんでください（受けとる名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
  if d.kind <> knd then raise exception '%', case knd when 'rail' then '電車は車両基地に置きます' when 'ship' then '船は港に置きます' when 'air' then '飛行機は空港の駐機場に置きます' else 'バスは営業所に置きます' end; end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + ncar > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  nm := coalesce(nullif(left(trim(coalesce(p_name, '')), 20), ''), f.name);
  if exists (select 1 from mp_forms y where y.own_u is not distinct from x.to_u and y.own_c is not distinct from x.to_c and y.name = nm) then
    raise exception '編成番号「%」はもうあります（ちがう編成番号を入れてください）', nm;
  end if;
  -- 代金（受けとる名義 → ゆずる名義）
  if x.price > 0 then
    perform _mp_pay(x.to_u, x.to_c, false, x.price, 'car', format('編成「%s」（%s両）をゆずり受けた', f.name, ncar));
    perform _mp_earn(x.from_u, x.from_c, false, x.price, 'car', format('編成「%s」（%s両）をゆずった', f.name, ncar));
  end if;
  zq := _mp_xfer_ship(array(select cc.id from mp_cars cc where cc.form = f.id), d);   -- 陸上輸送費（DB の更新126）
  if (zq->>'cost')::bigint > 0 then perform _mp_pay(x.to_u, x.to_c, false, (zq->>'cost')::bigint, 'car', format('ゆずり受けた編成「%s」を「%s」へ%s', f.name, d.name, zq->>'how')); end if;
  -- ゆずる側の運用・列車からはずす
  perform _mp_form_drop(array[f.id], '編成をゆずったので、運用からはずれました');
  -- 車番は、受けとる名義の続きに
  k := _mp_okey(x.to_u, x.to_c);
  for c in select cc.id, cc.type, cc.num from mp_cars cc where cc.form = f.id order by cc.pos loop
    select * into t from mp_types where code = c.type;
    s := coalesce((select z.n from mp_serials z where z.owner = k and z.type = t.code), 0);
    if t.num_from + s > t.num_to then raise exception '%の車番がいっぱいです（%〜%）', t.label, t.num_from, t.num_to; end if;
    insert into mp_serials(owner, type, n) values (k, t.code, s + 1) on conflict (owner, type) do update set n = excluded.n;
    update mp_cars set num = _mp_carnum(t, t.num_from + s), own_u = x.to_u, own_c = x.to_c, depot = p_depot,
           busy_from = case when busy_until > now() then busy_from else now() end, busy_until = greatest(coalesce(busy_until, now()), now() + make_interval(hours => (zq->>'hours')::int)), busy_kind = 'move' where id = c.id;
    insert into mp_car_hist(car, k, num, type, ou, oc, d) values (c.id, 'xfer', _mp_carnum(t, t.num_from + s), c.type, x.to_u, x.to_c, jsonb_build_object('from', fromnm, 'to', tonm, 'num0', c.num, 'dep', d.name, 'form', nm, 'how', zq->>'how'));
  end loop;
  update mp_forms set own_u = x.to_u, own_c = x.to_c, depot = p_depot, name = nm where id = f.id;
  update mp_xfers set st = 'done', decided_at = now() where id = x.id;
  perform _notice_l(coalesce(x.from_u, (select owner from companies where id = x.from_c)),
    format('【国土】編成「%s」（%s両）の譲渡を、%sが受けとりました（%s X）。', f.name, ncar, tonm, _fmt(x.price)), jsonb_build_object('go', 'map', 'k', 'xfer'), null);
  return jsonb_build_object('id', f.id, 'name', nm, 'n', ncar, 'price', x.price, 'ship', zq);
end $$;

-- 転属・譲渡の履歴（この名義の車両。新しい順に 200件。同じときに いっしょに動いた車両は まとめる）
create or replace function public.mp_move_log(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return (select coalesce(jsonb_agg(jsonb_build_object('at', z.at, 'k', z.k, 'd', z.d, 'nums', z.nums, 'n', z.n) order by z.at desc), '[]'::jsonb) from (
            select date_trunc('second', h.at) at, h.k, h.d - 'num0' d, jsonb_agg(h.num order by h.num) nums, count(*) n
              from mp_car_hist h
             where h.k in ('move', 'xfer') and h.ou is not distinct from pa.pu and h.oc is not distinct from pa.pc
             group by date_trunc('second', h.at), h.k, h.d - 'num0'
             order by 1 desc limit 200) z);
end $$;
revoke all on function public.mp_move_log(text) from public, anon;
grant execute on function public.mp_move_log(text) to authenticated;
