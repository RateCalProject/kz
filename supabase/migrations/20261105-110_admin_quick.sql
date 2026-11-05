-- DB の更新110：管理者の車両は すぐ納車
--   管理者（app_settings 'admins'）が注文した車両（鉄道・バス・トラック・船・飛行機。自分・自分の会社・国の名義）は、注文してすぐ とどく（ふつうは 3〜48時間）。
--   鉄道車両工場（プレイヤーの工場）への注文も、とどくのは すぐ（工場の順番・代金・鉄鋼は いつもどおり）

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
  if _is_admin(u) then hrs := 0; end if;   -- 管理者の車両は すぐ納車（DB の更新110）
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
  if _is_admin(u) then hrs := 0; end if;   -- 管理者の車両は すぐ納車（DB の更新110）
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

