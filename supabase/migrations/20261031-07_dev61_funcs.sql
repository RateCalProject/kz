-- 首都まわりの町づくり（t61）の準備：国営の会社（風の芽帝国空軍・海軍など）は、国の建物の種類（格納庫・管制塔・岸壁など）の建物も持てるようにする
-- （_mp_bld_check のこの1か所だけを変える。何度流しても同じ）
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
