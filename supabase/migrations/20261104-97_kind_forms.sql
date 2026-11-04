-- 運用を自動で組む を、種別ごとに：種別ごとに使う編成をえらんで、1回でわりあてる（前は種別ごとに何回も わりあてていた）。えらびかたは系統に保存して、次にひらいたときに出す

alter table public.mp_routes add column if not exists kform jsonb;   -- 種別ごとの編成 {種別: [編成, …]}（運用を自動で組む → 種別ごと。DB の更新97）

-- 運用を自動で組む（種別ごと。DB の更新97）：種別ごとに えらんだ編成を、その種別の列車にわりあてる（1回で。時刻の組みなおしは さいごの1回だけ。やりなおしの記録も1つ）。
--   p_map：{種別: [編成, …]}。編成をえらばなかった種別の列車は いまのまま。えらばなかった種別の列車に入っている編成は使わない。同じ編成を2つの種別には えらべない
--   わりあてかたは mp_train_autoform と同じ（時刻の順に、始発駅にいて2分前にあいている編成。いなければ、まだ使っていない編成）。えらびかたは系統に保存（kform）
--   p_dry：保存してある えらびかた を返すだけ（いまもある、この名義の編成だけ）
create or replace function public.mp_train_autoform_k(p_route bigint, p_map jsonb, p_as text, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; e record; fz bigint[]; allf bigint[] := '{}'; ks text[] := '{}'; kf jsonb := '{}'::jsonb; perf jsonb; x bigint; kn text;
        t record; i int; best int; n int; locs bigint[]; frees int[]; ops bigint[]; nok int := 0; nng int := 0; nbusy int; res jsonb := '{}'::jsonb; kok int; kng int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_dry then
    return jsonb_build_object('kform', coalesce((select jsonb_object_agg(z.kk, z.v) from (
             select q.key kk, jsonb_agg(f.id order by w.o) v from jsonb_each(coalesce(r.kform, '{}'::jsonb)) q
               cross join lateral jsonb_array_elements_text(case when jsonb_typeof(q.value) = 'array' then q.value else '[]'::jsonb end) with ordinality w(fid, o)
               join mp_forms f on f.id = w.fid::bigint and f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc
              group by q.key) z), '{}'::jsonb));
  end if;
  -- 種別ごとの編成をしらべる
  for e in select q.key kk, q.value v from jsonb_each(coalesce(p_map, '{}'::jsonb)) q order by q.key loop
    if jsonb_typeof(e.v) <> 'array' then raise exception '編成のえらびかたが読めません'; end if;
    if char_length(e.kk) > 20 then raise exception '種別の名前が長すぎます'; end if;
    fz := array(select z2.x from (select distinct on (z.x) z.x, z.o from (select w.v::bigint x, w.o from jsonb_array_elements_text(e.v) with ordinality w(v, o)) z order by z.x, z.o) z2 order by z2.o);
    if coalesce(cardinality(fz), 0) = 0 then continue; end if;
    foreach x in array fz loop
      if not exists (select 1 from mp_forms where id = x and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc) then raise exception '編成が見つかりません'; end if;
      perf := _mp_form_perf(x);
      if (perf ->> 'rail')::boolean <> (r.kind = 'rail') then raise exception '%', case when r.kind = 'rail' then '鉄道の系統にはバスを使えません' else 'バスの系統には電車を使えません' end; end if;
    end loop;
    if fz && allf then raise exception '同じ編成を2つの種別にえらんでいます（%）', e.kk; end if;
    allf := allf || fz; ks := ks || e.kk; kf := kf || jsonb_build_object(e.kk, to_jsonb(fz));
  end loop;
  if cardinality(ks) = 0 then raise exception '種別ごとに編成をえらんでください'; end if;
  if not exists (select 1 from mp_trains where route = p_route and day is null and kind = any(ks)) then raise exception 'その種別の列車がありません'; end if;
  -- えらばなかった種別の列車（毎日の列車）に入っている編成は使わない
  nbusy := (select count(*) from unnest(allf) z(x) where exists (select 1 from mp_trains tr where tr.route = p_route and tr.day is null and tr.form = z.x and not (tr.kind = any(ks))));
  perform _mp_dia_snap(p_route, format('運用を自動で組んだ（種別ごと：%s）', array_to_string(ks, '・')));
  update mp_trains set form = null, op = null where route = p_route and day is null and kind = any(ks);
  -- わりあてる順と、始発・終着の駅と時刻は、いまの時刻から（mp_train_autoform は ここで いちど時刻を組みなおすが、編成のない時刻になるだけなので しない。
  --   組みなおしは さいごの1回だけ：大きな系統では 1回 5秒くらい かかる）
  foreach kn in array ks loop
    fz := array(select z.x from (select w.v::bigint x, w.o from jsonb_array_elements_text(kf -> kn) with ordinality w(v, o)) z
                 where not exists (select 1 from mp_trains tr where tr.route = p_route and tr.day is null and tr.form = z.x and not (tr.kind = any(ks))) order by z.o);
    n := coalesce(cardinality(fz), 0); kok := 0; kng := 0;
    if n > 0 then
      ops := array(select _mp_op_of_form(z.x) from unnest(fz) with ordinality z(x, o) order by z.o);   -- 編成ごとの運用（なければつくる）
      locs := array_fill(null::bigint, array[n]); frees := array_fill(-1, array[n]);
    end if;
    for t in select tr.id, (tr.sched -> 0 ->> 0)::bigint fs, (tr.sched -> 0 ->> 2)::int ft,
                    (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 0)::bigint es, (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 1)::int et
               from mp_trains tr where tr.route = p_route and tr.day is null and tr.kind = kn and jsonb_array_length(tr.sched) > 1 order by 3, 1 loop
      best := null;
      for i in 1..n loop   -- 始発駅にいて、まにあう編成のうち、いちばん早くあいたもの
        if locs[i] = t.fs and frees[i] + 120 <= t.ft and (best is null or frees[i] < frees[best]) then best := i; end if;
      end loop;
      if best is null then for i in 1..n loop if locs[i] is null then best := i; exit; end if; end loop; end if;
      if best is null then kng := kng + 1; continue; end if;
      update mp_trains set form = fz[best], op = ops[best] where id = t.id;
      locs[best] := t.es; frees[best] := t.et; kok := kok + 1;
    end loop;
    res := res || jsonb_build_object(kn, jsonb_build_object('ok', kok, 'none', kng, 'forms', n));
    nok := nok + kok; nng := nng + kng;
  end loop;
  perform _mp_resched(p_route);
  update mp_routes set kform = kf where id = p_route;
  return jsonb_build_object('ok', nok, 'none', nng, 'used', (select count(distinct form) from mp_trains where route = p_route and form is not null), 'busy', nbusy, 'kinds', res);
end $$;

-- 関数の権限：ログインした人。時刻を組みなおすので60秒まで（重い操作として数える）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mp_train_autoform_k' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
alter function public.mp_train_autoform_k(bigint, jsonb, text, boolean) set statement_timeout = '60s';
