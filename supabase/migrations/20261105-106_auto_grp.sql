-- DB の更新106：運用を自動で組む（あてる先ごと）
--   あてる先（種別・区間・向き・時間帯・走る線の電化で決めた 列車のまとまり）ごとに 使う編成をえらんで わりあてる（mp_train_autoform_g）。あてる先は系統に のこす（agrp）
--   系統と列車（mp_dia）に、列車が走る線の電化（lpw：1 直流・2 交流・4 非電化 を足したもの）
alter table public.mp_routes add column if not exists agrp jsonb;   -- 運用を自動で組む の あてる先（DB の更新106）[{n, k, z, d, t0, t1, pw, f}]

-- 系統の駅と駅のあいだごとの 線の電化（DB の更新106）：1 直流・2 交流・4 非電化 を足したもの（通る線ぜんぶ）
create or replace function public._mp_leg_pw(r mp_routes) returns int[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(coalesce((select bit_or(case when not s.elec then 4 when s.ps = 0 then 1 else 2 end)
                                        from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g join mp_segs s on s.id = (g ->> 0)::bigint), 0)::int order by k), '{}')
    from jsonb_array_elements(coalesce(r.legs, '[]'::jsonb)) with ordinality q(l, k)
$$;

-- 列車が走る線の電化（DB の更新106）：始発駅 fs から終着駅 es まで（系統の順）の あいだの lp を足したもの
create or replace function public._mp_train_lpw(stops bigint[], lp int[], dir int, fs bigint, es bigint) returns int
language sql immutable set search_path = public as $$
  select coalesce(bit_or(lp[k]), 0)::int from generate_series(least(_mp_rpos(stops, dir, fs, false), _mp_rpos(stops, dir, es, true)),
                                                         greatest(_mp_rpos(stops, dir, fs, false), _mp_rpos(stops, dir, es, true)) - 1) k
$$;

-- 運用を自動で組む（あてる先ごと。DB の更新106）：あてる先（種別・区間・向き・時間帯・走る線の電化で決めた 毎日の列車のまとまり）ごとに えらんだ編成を、
--   そのまとまりの列車にわりあてる。列車は 上から順に 最初にあてはまる あてる先に入る。どれにも入らない列車・編成をえらんでいない あてる先の列車は いまのまま
--   p_groups：[{n: 名前, k: [種別], z: ["始発駅>終着駅"], d: 0|1|-1, t0: 秒|null, t1: 秒|null（始発を出る時刻 t0 以上 t1 未満）, pw: 0〜4, f: [編成]}]（20まで。空の k・z は すべて）
--     pw（走る線の電化）：0 すべて・1 直流の区間だけ・2 交流の区間だけ・3 直流と交流の両方・4 非電化の区間がある
--   わりあてかたは mp_train_autoform_k と同じ（時刻の順に、始発駅にいて2分前にあいている編成。いなければ、まだ使っていない編成）。
--   1つの編成は1つの あてる先だけ。わりあてなおさない列車に入っている編成は使わない。あてる先は系統に保存（agrp）
--   p_dry：保存してある あてる先を返すだけ（編成は いまもある、この名義のものだけ）
create or replace function public.mp_train_autoform_g(p_route bigint, p_groups jsonb, p_as text, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; e record; zg jsonb := '[]'::jsonb; zallf bigint[] := '{}'; zf bigint[]; zx bigint; zperf jsonb; zlp int[];
        zmap jsonb; t record; i int; best int; n int; locs bigint[]; frees int[]; ops bigint[]; nok int := 0; nng int := 0; nbusy int; res jsonb := '[]'::jsonb;
        kok int; kng int; gi int; zbusy bigint[];
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_dry then
    return jsonb_build_object('agrp', coalesce((select jsonb_agg(q.g || jsonb_build_object('f', coalesce((
             select jsonb_agg(f.id order by w.o) from jsonb_array_elements_text(case when jsonb_typeof(q.g -> 'f') = 'array' then q.g -> 'f' else '[]'::jsonb end) with ordinality w(fid, o)
               join mp_forms f on f.id = w.fid::bigint and f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc), '[]'::jsonb)) order by q.o)
             from jsonb_array_elements(case when jsonb_typeof(r.agrp) = 'array' then r.agrp else '[]'::jsonb end) with ordinality q(g, o)), '[]'::jsonb),
           'kform', r.kform);
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then raise exception 'あてる先を1つ以上つくってください'; end if;
  if jsonb_array_length(p_groups) > 20 then raise exception 'あてる先は20までです'; end if;
  -- あてる先の形をそろえる・編成をしらべる
  for e in select q.g, q.o::int o from jsonb_array_elements(p_groups) with ordinality q(g, o) loop
    if jsonb_typeof(e.g) <> 'object' then raise exception 'あてる先が読めません（%つめ）', e.o; end if;
    zf := array(select z2.x from (select distinct on (z.x) z.x, z.o from (select w.v::bigint x, w.o from jsonb_array_elements_text(case when jsonb_typeof(e.g -> 'f') = 'array' then e.g -> 'f' else '[]'::jsonb end) with ordinality w(v, o)
                                                                      where w.v ~ '^[0-9]{1,18}$') z order by z.x, z.o) z2 order by z2.o);
    foreach zx in array zf loop
      if not exists (select 1 from mp_forms where id = zx and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc) then raise exception '編成が見つかりません'; end if;
      zperf := _mp_form_perf(zx);
      if (zperf ->> 'rail')::boolean <> (r.kind = 'rail') then raise exception '%', case when r.kind = 'rail' then '鉄道の系統にはバスを使えません' else 'バスの系統には電車を使えません' end; end if;
    end loop;
    if zf && zallf then raise exception '同じ編成を2つのあてる先にえらんでいます（%つめ）', e.o; end if;
    zallf := zallf || zf;
    zg := zg || jsonb_build_object('n', left(coalesce(e.g ->> 'n', ''), 20),
      'k', coalesce((select jsonb_agg(distinct left(v, 8)) from jsonb_array_elements_text(case when jsonb_typeof(e.g -> 'k') = 'array' then e.g -> 'k' else '[]'::jsonb end) v), '[]'::jsonb),
      'z', coalesce((select jsonb_agg(distinct v) from jsonb_array_elements_text(case when jsonb_typeof(e.g -> 'z') = 'array' then e.g -> 'z' else '[]'::jsonb end) v where v ~ '^[0-9]{1,18}>[0-9]{1,18}$'), '[]'::jsonb),
      'd', case when e.g ->> 'd' in ('1', '-1') then (e.g ->> 'd')::int else 0 end,
      't0', case when e.g ->> 't0' ~ '^[0-9]{1,6}$' then least(90000, (e.g ->> 't0')::int) end,
      't1', case when e.g ->> 't1' ~ '^[0-9]{1,6}$' then least(90000, (e.g ->> 't1')::int) end,
      'pw', case when e.g ->> 'pw' in ('1', '2', '3', '4') then (e.g ->> 'pw')::int else 0 end,
      'f', to_jsonb(zf));
  end loop;
  if cardinality(zallf) = 0 then raise exception 'あてる先ごとに編成をえらんでください'; end if;
  -- 列車ごとの あてる先（上から最初にあてはまるもの。その あてる先に 編成がなければ わりあてなおさない）
  zlp := _mp_leg_pw(r);
  select coalesce(jsonb_object_agg(z.id::text, z.gi), '{}'::jsonb) into zmap from (
    select a.id, (select min(q.o) from jsonb_array_elements(zg) with ordinality q(g, o)
                   where (jsonb_array_length(q.g -> 'k') = 0 or q.g -> 'k' ? a.kind)
                     and (jsonb_array_length(q.g -> 'z') = 0 or q.g -> 'z' ? (a.fs::text || '>' || a.es::text))
                     and ((q.g ->> 'd')::int = 0 or (q.g ->> 'd')::int = a.dir)
                     and (q.g ->> 't0' is null or a.ft >= (q.g ->> 't0')::int)
                     and (q.g ->> 't1' is null or a.ft < (q.g ->> 't1')::int)
                     and case (q.g ->> 'pw')::int when 1 then a.lp = 1 when 2 then a.lp = 2 when 3 then a.lp & 3 = 3 when 4 then a.lp & 4 = 4 else true end)::int gi
      from (select t2.id, t2.kind, t2.dir, (t2.sched -> 0 ->> 0)::bigint fs, (t2.sched -> (jsonb_array_length(t2.sched) - 1) ->> 0)::bigint es,
                   coalesce((t2.sched -> 0 ->> 2)::int, t2.dep) ft,
                   _mp_train_lpw(r.stops, zlp, t2.dir, (t2.sched -> 0 ->> 0)::bigint, (t2.sched -> (jsonb_array_length(t2.sched) - 1) ->> 0)::bigint) lp
              from mp_trains t2 where t2.route = p_route and t2.day is null and jsonb_array_length(t2.sched) > 1) a) z
   where z.gi is not null and jsonb_array_length(zg -> (z.gi - 1) -> 'f') > 0;
  if zmap = '{}'::jsonb then raise exception 'あてはまる列車がありません（あてる先の条件と、編成をえらんだ あてる先を みなおしてください）'; end if;
  -- わりあてなおさない毎日の列車に入っている編成は使わない
  zbusy := array(select distinct t2.form from mp_trains t2 where t2.route = p_route and t2.day is null and t2.form is not null and not zmap ? t2.id::text and t2.form = any(zallf));
  nbusy := coalesce(cardinality(zbusy), 0);
  perform _mp_dia_snap(p_route, format('運用を自動で組んだ（あてる先ごと：%sつ）', jsonb_array_length(zg)));
  update mp_trains set form = null, op = null where route = p_route and day is null and zmap ? id::text;
  -- あてる先ごとに（時刻の順に、始発駅にいて2分前にあいている編成。いなければ、まだ使っていない編成）。組みなおしは さいごの1回だけ
  for gi in 1 .. jsonb_array_length(zg) loop
    zf := array(select w.v::bigint from jsonb_array_elements_text(zg -> (gi - 1) -> 'f') with ordinality w(v, o) where not (w.v::bigint = any(coalesce(zbusy, '{}'))) order by w.o);
    n := coalesce(cardinality(zf), 0); kok := 0; kng := 0;
    if n > 0 then
      ops := array(select _mp_op_of_form(z.x) from unnest(zf) with ordinality z(x, o) order by z.o);
      locs := array_fill(null::bigint, array[n]); frees := array_fill(-1, array[n]);
    end if;
    for t in select tr.id, (tr.sched -> 0 ->> 0)::bigint fs, (tr.sched -> 0 ->> 2)::int ft,
                    (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 0)::bigint es, (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 1)::int et
               from mp_trains tr where tr.route = p_route and tr.day is null and (zmap ->> tr.id::text)::int = gi and jsonb_array_length(tr.sched) > 1 order by 3, 1 loop
      best := null;
      for i in 1..n loop
        if locs[i] = t.fs and frees[i] + 120 <= t.ft and (best is null or frees[i] < frees[best]) then best := i; end if;
      end loop;
      if best is null then for i in 1..n loop if locs[i] is null then best := i; exit; end if; end loop; end if;
      if best is null then kng := kng + 1; continue; end if;
      update mp_trains set form = zf[best], op = ops[best] where id = t.id;
      locs[best] := t.es; frees[best] := t.et; kok := kok + 1;
    end loop;
    res := res || jsonb_build_object('i', gi, 'ok', kok, 'none', kng, 'forms', n);
    nok := nok + kok; nng := nng + kng;
  end loop;
  perform _mp_resched(p_route);
  update mp_routes set agrp = zg where id = p_route;
  return jsonb_build_object('ok', nok, 'none', nng, 'used', (select count(distinct form) from mp_trains where route = p_route and form is not null), 'busy', nbusy, 'groups', res);
end $$;

create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean; zlp int[];
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  zlp := _mp_leg_pw(r);   -- 線の電化（DB の更新106）
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
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats, 'hpat', case when mine then r.hpat end, 'agrp', case when mine then r.agrp end,   -- agrp：運用の あてる先（DB の更新106）   -- hpat：1時間の型（DB の更新104）
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
                 'lay', t.lay,   -- 折り返しを待つ（DB の更新105）
                 'lpw', case when jsonb_array_length(t.sched) > 1 then _mp_train_lpw(r.stops, zlp, t.dir, (t.sched -> 0 ->> 0)::bigint, (t.sched -> (jsonb_array_length(t.sched) - 1) ->> 0)::bigint) end,   -- 走る線の電化（DB の更新106）
                 'fser', fi.ser, 'fn', fi.n, 'fpw', case when fi.n > 0 then case when fi.fel then coalesce(fi.fps, 0) else 0 end end,   -- 編成の電化方式（DB の更新104：0 非電化・1 直流・2 交流50Hz・4 交流60Hz を足したもの。null は編成なし）   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk,   -- 編成の工事中（DB の更新60）
                 'sub', (select jsonb_agg(jsonb_build_array(s.day, extract(epoch from s.t0)::bigint, sf.name) order by s.t0) from mp_subst s join mp_forms sf on sf.id = s.sub
                          where s.train = t.id and s.t1 > now() - interval '1 day')   -- 予備編成の代走（DB の更新80）：［運行日, 発車, 予備編成］
               ) order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk,
                                                          bool_or(ty.elec) fel, bit_and(ty.ps::int) filter (where ty.elec) fps
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;


revoke all on function public._mp_leg_pw(mp_routes) from public, anon, authenticated;
revoke all on function public._mp_train_lpw(bigint[], int[], int, bigint, bigint) from public, anon, authenticated;
revoke all on function public.mp_train_autoform_g(bigint, jsonb, text, boolean) from public, anon;
grant execute on function public.mp_train_autoform_g(bigint, jsonb, text, boolean) to authenticated;
alter function public.mp_train_autoform_g(bigint, jsonb, text, boolean) set statement_timeout = '60s';
