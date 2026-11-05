-- DB の更新104：ダイヤグラムと列車運用を 種別ごとに組む（停車駅は 種別の停車駅のパターン）
--   1時間の型でつくる（パターンダイヤ）mp_train_pattern：毎時 同じ分に出る列車の型（種別・向き・分・走る区間）を、何時から何時まで くりかえす。型は系統に のこす（hpat）
--   運用番号を種別ごとにまとめる mp_ops_renum_kind（例：快速は 101・102…）。運用の一覧（mp_ops_list）に 走る種別（ks）
--   系統と列車（mp_dia）に 列車の編成の電化方式（fpw：直流・交流・交直流・非電化で しぼりこむ）
alter table public.mp_routes add column if not exists hpat jsonb;   -- 1時間の型（パターンダイヤ）{rows: [{k, d, m, sa, sb, pre}], h0, h1, rep}（DB の更新104）

-- 1時間の型でつくる（パターンダイヤ。DB の更新104）：毎時 同じ分に出る列車の型（行ごとに 種別・向き・分・走る区間・列車番号の頭）を、
--   p_h0 時から p_h1 時まで（p_h1 時ちょうどの前まで）くりかえして つくる。停車駅は 種別の停車駅のパターン（走る区間のうちで。mp_train_bulk と同じ）
--   p_rows：[{k: 種別, d: 1 下り・-1 上り・0 両方, m: [分（0〜59）, …], sa: 始発駅か null, sb: 終着駅か null, pre: 列車番号の頭}]（20行まで。1行の分は30こまで）
--     両方（d 0）の上りは、sa と sb を入れかえて走る（下りが A→B なら、上りは B→A）
--   p_replace：その時間帯に出る、型の向きの 毎日の列車を消してから つくる（臨時列車は そのまま）
--   列車番号：向きごとに 発車の順で 時×100 ＋（下り 1・3・5…／上り 2・4・6…）。頭のある行は 頭＋番号。1時間に1つの向きで49本まで
--   p_dry：つくらずに、つくる本数（n）・消す本数（del）・行ごとの本数（rows）を返す。つくったら 型を系統に のこす（hpat）
create or replace function public.mp_train_pattern(p_route bigint, p_rows jsonb, p_h0 int, p_h1 int, p_replace boolean, p_as text, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; e record; ns int; zk text; zd int; zm int[]; zsa bigint; zsb bigint; zpre text; dd int;
        k0 int; k1 int; sa_ bigint; sb_ bigint; pf record; spec jsonb := '[]'::jsonb; norm jsonb := '[]'::jsonb; zdirs int[] := '{}';
        zn int; zdel int := 0; zhave int; zmax int; zrows jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_h0 is null or p_h1 is null or p_h0 < 0 or p_h1 > 24 or p_h0 >= p_h1 then raise exception '時刻がちがいます'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception '型の行を1つ以上つくってください'; end if;
  if jsonb_array_length(p_rows) > 20 then raise exception '型の行は20までです'; end if;
  ns := array_length(r.stops, 1);
  for e in select x.value v, x.ordinality::int o from jsonb_array_elements(p_rows) with ordinality x loop
    if jsonb_typeof(e.v) <> 'object' then raise exception '型の行が読めません（%行目）', e.o; end if;
    zk := left(coalesce(nullif(trim(e.v ->> 'k'), ''), '普通'), 8);
    zd := case when e.v ->> 'd' in ('1', '-1', '0') then (e.v ->> 'd')::int else 1 end;
    if jsonb_typeof(e.v -> 'm') is distinct from 'array' then raise exception '発車の分がありません（%行目）', e.o; end if;
    if exists (select 1 from jsonb_array_elements_text(e.v -> 'm') q where q !~ '^[0-9]{1,2}$') then raise exception '発車の分は 0〜59 です（%行目）', e.o; end if;
    zm := array(select distinct q::int from jsonb_array_elements_text(e.v -> 'm') q order by 1);
    if coalesce(cardinality(zm), 0) = 0 then raise exception '発車の分がありません（%行目）', e.o; end if;
    if cardinality(zm) > 30 or zm[cardinality(zm)] > 59 then raise exception '発車の分は 0〜59 で、1行に30こまでです（%行目）', e.o; end if;
    if coalesce(e.v ->> 'sa', '') !~ '^[0-9]*$' or coalesce(e.v ->> 'sb', '') !~ '^[0-9]*$' then raise exception '始発駅・終着駅がこの系統にありません（%行目）', e.o; end if;
    zsa := nullif(e.v ->> 'sa', '')::bigint; zsb := nullif(e.v ->> 'sb', '')::bigint;
    if (zsa is not null and not (zsa = any(r.stops))) or (zsb is not null and not (zsb = any(r.stops))) then raise exception '始発駅・終着駅がこの系統にありません（%行目）', e.o; end if;
    zpre := left(coalesce(trim(e.v ->> 'pre'), ''), 4);
    norm := norm || jsonb_build_object('k', zk, 'd', zd, 'm', to_jsonb(zm), 'sa', zsa, 'sb', zsb, 'pre', zpre);
    foreach dd in array case when zd = 0 then array[1, -1] else array[zd] end loop
      -- 走る区間（両方の上りは、始発と終着を入れかえる）。途中始発・途中止まりと 停車駅のパターンは mp_train_bulk と同じ
      sa_ := case when zd = 0 and dd = -1 then zsb else zsa end; sb_ := case when zd = 0 and dd = -1 then zsa else zsb end;
      k0 := coalesce(_mp_kpos(r.stops, dd, sa_, false), 1);
      k1 := coalesce(_mp_kpos(r.stops, dd, sb_, true), ns);
      if k0 >= k1 then raise exception '始発駅は、終着駅より前（走る順）にしてください（%行目）', e.o; end if;
      sa_ := case when k0 > 1 then sa_ end; sb_ := case when k1 < ns then sb_ end;
      select * into pf from _mp_pat_fit(r.stops, dd, sa_, sb_,
        coalesce(array(select x::bigint from jsonb_array_elements_text(r.pats -> zk) x where x::bigint = any(r.stops)), '{}'));
      if not pf.ok then raise exception '止まる駅が2つ以上ありません（%行目。走る区間と、停車駅のパターンをみなおしてください）', e.o; end if;
      if not (dd = any(zdirs)) then zdirs := zdirs || dd; end if;
      spec := spec || jsonb_build_object('rn', e.o, 'd', dd, 'k', zk, 'pre', zpre, 'm', to_jsonb(zm), 'skip', to_jsonb(coalesce(pf.nskip, '{}')), 'sa', pf.nsa, 'sb', pf.nsb);
    end loop;
  end loop;
  -- つくる列車：時 × 分。列車番号は 向きと時ごとに 発車の順（同じ分なら 行の順）
  select count(*), coalesce(max(z.i), 0) into zn, zmax from (
    select row_number() over (partition by (s ->> 'd')::int, h order by mm::int, (s ->> 'rn')::int) - 1 i
      from jsonb_array_elements(spec) s cross join generate_series(p_h0, p_h1 - 1) h cross join jsonb_array_elements_text(s -> 'm') mm) z;
  if zmax >= 49 then raise exception '1時間に、1つの向きで49本までです'; end if;
  if p_replace then
    select count(*) into zdel from mp_trains where route = p_route and day is null and dir = any(zdirs) and dep >= p_h0 * 3600 and dep < p_h1 * 3600;
  end if;
  select count(*) into zhave from mp_trains where route = p_route;
  if zhave - zdel + zn > 900 then raise exception '1つの系統の列車は900本までです（いま %本・消す %本・つくる %本）', zhave, zdel, zn; end if;
  select coalesce(jsonb_agg(jsonb_build_object('rn', q.rn, 'n', q.c) order by q.rn), '[]'::jsonb) into zrows
    from (select (s ->> 'rn')::int rn, sum(jsonb_array_length(s -> 'm') * (p_h1 - p_h0))::int c from jsonb_array_elements(spec) s group by 1) q;
  if p_dry then return jsonb_build_object('n', zn, 'del', zdel, 'rows', zrows); end if;
  perform _mp_dia_snap(p_route, case when zdel > 0 then format('1時間の型で列車を %s本 つくった（%s本 消した）', zn, zdel) else format('1時間の型で列車を %s本 つくった', zn) end);
  if p_replace and zdel > 0 then
    delete from mp_trains where route = p_route and day is null and dir = any(zdirs) and dep >= p_h0 * 3600 and dep < p_h1 * 3600;
  end if;
  insert into mp_trains(route, dir, num, kind, dep, form, op, day, skip, sa, sb)
  select p_route, z.d, left(z.pre || (z.h * 100 + case when z.d = -1 then 2 else 1 end + 2 * z.i)::text, 12), z.k, z.dep, null, null, null, z.skip, z.sa, z.sb
    from (select (s ->> 'd')::int d, s ->> 'k' k, s ->> 'pre' pre, h, h * 3600 + mm::int * 60 dep,
                 array(select x::bigint from jsonb_array_elements_text(s -> 'skip') x) skip, nullif(s ->> 'sa', '')::bigint sa, nullif(s ->> 'sb', '')::bigint sb,
                 row_number() over (partition by (s ->> 'd')::int, h order by mm::int, (s ->> 'rn')::int) - 1 i
            from jsonb_array_elements(spec) s cross join generate_series(p_h0, p_h1 - 1) h cross join jsonb_array_elements_text(s -> 'm') mm) z
   order by z.d desc, z.dep;
  update mp_routes set hpat = jsonb_build_object('rows', norm, 'h0', p_h0, 'h1', p_h1, 'rep', coalesce(p_replace, false)) where id = p_route;
  perform _mp_resched(p_route);
  return jsonb_build_object('n', zn, 'del', zdel, 'rows', zrows);
end $$;

-- 運用番号を種別ごとにまとめる（DB の更新104）：この系統の毎日の列車が入っている運用を、その運用が この系統で いちばん多く走る種別
--   （同じ本数なら 早く出るほう）で分けて、種別ごとに この系統での はじめの発車の順に、頭＋番号（はじめの番号から1ずつ）を つけなおす（例：快速は 101・102…）
--   p_map：{種別: {pre: 頭（4文字まで）, st: はじめの番号（数字1〜4けた。0 ではじめると その けた数）}}。書いていない種別の運用は そのまま
--   運用番号は名義で1つ：ほかの運用と だぶるときは つけなおさない（dup）。つけなおす前に、運用のバックアップを自動でとる
--   p_dry：つけなおさずに、新しい番号の一覧（list：[{id, k, old, new}]）と だぶり（dup）を返す
create or replace function public.mp_ops_renum_kind(p_route bigint, p_map jsonb, p_as text, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; e record; o record; zl jsonb := '[]'::jsonb; zdup jsonb; zpre text; zst text; zw int; zv int; zi int; zn int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object' then raise exception '種別ごとの番号のつけかたが読めません'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  for e in select q.key kk, q.value v from jsonb_each(p_map) q order by q.key loop
    if jsonb_typeof(e.v) <> 'object' then raise exception '種別ごとの番号のつけかたが読めません'; end if;
    zpre := left(coalesce(trim(e.v ->> 'pre'), ''), 4);
    zst := coalesce(nullif(trim(e.v ->> 'st'), ''), '1');
    if zst !~ '^[0-9]{1,4}$' then raise exception 'はじめの番号は 数字（4けたまで）です（%）', e.kk; end if;
    zw := char_length(zst); zv := zst::int; zi := 0;
    for o in select z.op, x.num from (
               select t.op, t.kind, min(min(t.dep)) over (partition by t.op) f0,
                      row_number() over (partition by t.op order by count(*) desc, min(t.dep)) rk
                 from mp_trains t where t.route = p_route and t.day is null and t.op is not null group by t.op, t.kind) z
               join mp_ops x on x.id = z.op and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc
              where z.rk = 1 and z.kind = e.kk
              order by z.f0, z.op loop
      if zv + zi > 9999 then raise exception '番号が 9999 をこえます（%）', e.kk; end if;
      zl := zl || jsonb_build_object('id', o.op, 'k', e.kk, 'old', o.num, 'new', left(zpre || lpad((zv + zi)::text, zw, '0'), 12));
      zi := zi + 1;
    end loop;
  end loop;
  -- だぶり：新しい番号どうし・つけなおさない ほかの運用の番号
  select coalesce(jsonb_agg(distinct q.nw), '[]'::jsonb) into zdup from (
    select l ->> 'new' nw from jsonb_array_elements(zl) l group by 1 having count(*) > 1
    union all
    select l ->> 'new' from jsonb_array_elements(zl) l
     where exists (select 1 from mp_ops x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.num = l ->> 'new'
                     and not exists (select 1 from jsonb_array_elements(zl) l2 where (l2 ->> 'id')::bigint = x.id))) q;
  zn := (select count(*) from jsonb_array_elements(zl) l where l ->> 'old' is distinct from l ->> 'new');
  if p_dry then return jsonb_build_object('list', zl, 'dup', zdup, 'n', zn); end if;
  if jsonb_array_length(zdup) > 0 then raise exception '運用番号「%」が ほかの運用と だぶります（頭か はじめの番号を変えてください）', zdup ->> 0; end if;
  if zn = 0 then return jsonb_build_object('list', zl, 'dup', zdup, 'n', 0); end if;
  perform _mp_op_backup_put(pa.pu, pa.pc, '運用番号をつけなおす前（自動）');
  -- いちど仮の番号にしてから（入れかえで だぶらないように）
  update mp_ops x set num = '~#' || x.id from jsonb_array_elements(zl) l where x.id = (l ->> 'id')::bigint and x.num is distinct from l ->> 'new';
  update mp_ops x set num = l ->> 'new' from jsonb_array_elements(zl) l where x.id = (l ->> 'id')::bigint and x.num = '~#' || x.id;
  return jsonb_build_object('list', zl, 'dup', zdup, 'n', zn);
end $$;

create or replace function public.mp_ops_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return jsonb_build_object(
    'ops', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'num', o.num, 'kind', o.kind, 'form', o.form, 'fname', f.name, 'note', o.note,
              'perf', case when f.id is not null then _mp_form_perf(f.id) end,
              'trains', (select count(*) from mp_trains t where t.op = o.id),
              'daily', (select count(*) from mp_trains t where t.op = o.id and t.day is null),
              'bad', (select count(*) from mp_trains t where t.op = o.id and t.bad),
              'warn', (select count(*) from mp_trains t where t.op = o.id and t.warn is not null),   -- 注意のある列車（2026-10-28：エラーの運用の絞り込み）
              'cpl', (select count(*) from mp_trains t where t.cpl @> jsonb_build_array(jsonb_build_object('op', o.id))),
              'first', (select min(t.dep) from mp_trains t where t.op = o.id and t.day is null),
              'last', (select max(t.dep) from mp_trains t where t.op = o.id and t.day is null),
              'routes', (select coalesce(jsonb_agg(distinct r.name), '[]'::jsonb) from mp_trains t join mp_routes r on r.id = t.route where t.op = o.id),
              'ks', (select coalesce(jsonb_agg(distinct t.kind), '[]'::jsonb) from mp_trains t where t.op = o.id))   -- 走る種別（DB の更新104：種別で しぼりこむ）
              order by o.num), '[]'::jsonb)
             from mp_ops o left join mp_forms f on f.id = o.form where o.own_u is not distinct from pa.pu and o.own_c is not distinct from pa.pc),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'op', (select o.num from mp_ops o where o.form = f.id), 'perf', _mp_form_perf(f.id),
              'ok', _mp_form_rule(array(select c.id from mp_cars c where c.form = f.id order by c.pos)) is null) order by f.name), '[]'::jsonb)
             from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc),
    'free', (select count(*) from mp_trains t join mp_routes r on r.id = t.route where t.op is null and r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc));
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
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats, 'hpat', case when mine then r.hpat end,   -- hpat：1時間の型（DB の更新104）
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
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


revoke all on function public.mp_train_pattern(bigint, jsonb, int, int, boolean, text, boolean) from public, anon;
grant execute on function public.mp_train_pattern(bigint, jsonb, int, int, boolean, text, boolean) to authenticated;
alter function public.mp_train_pattern(bigint, jsonb, int, int, boolean, text, boolean) set statement_timeout = '60s';
revoke all on function public.mp_ops_renum_kind(bigint, jsonb, text, boolean) from public, anon;
grant execute on function public.mp_ops_renum_kind(bigint, jsonb, text, boolean) to authenticated;
alter function public.mp_ops_renum_kind(bigint, jsonb, text, boolean) set statement_timeout = '20s';
