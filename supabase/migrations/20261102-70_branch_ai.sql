-- 支線と、AI でダイヤを直すしくみ：
--   支線：系統に「本線」をつけられる（本線の駅から分かれる系統。鉄道は、本線と支線の「ほかの系統と待避・続行」をオンにする）。本線を消すと、支線はふつうの系統にもどる
--   ダイヤの取りこみ（mp_dia_import）：AI などで直した列車の一覧を、まとめて入れる。見つもってから取りこむ。まちがいは行ごとに返す。「↶ 取り消す」でもどせる
--   系統の一覧（mp_routes_list）とダイヤ（mp_dia）に、本線・支線（分かれる駅）を足す

-- 支線（DB の更新70）：本線の駅から分かれる系統。parent に本線をおぼえる（本線を消すと、支線はふつうの系統にもどる）
alter table public.mp_routes add column if not exists parent bigint references public.mp_routes(id) on delete set null;   -- 支線のときの本線（DB の更新70）

-- 支線にする・やめる（同じ名義・同じ種類の系統。本線と同じ駅が1つ以上いる。鉄道は、本線と支線の「ほかの系統と待避・続行」をオンにする）
--   p_parent：本線の系統（null で支線をやめる）
create or replace function public.mp_route_branch(p_route bigint, p_parent bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; p mp_routes; x bigint; k int := 0;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_parent is null then
    update mp_routes set parent = null where id = r.id;
    perform _mp_chg('route', r.id, 'set', null);
    return jsonb_build_object('ok', true, 'parent', null);
  end if;
  if p_parent = r.id then raise exception '自分を本線にはできません'; end if;
  select * into p from mp_routes where id = p_parent and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '本線の系統が見つかりません（同じ名義の系統だけです）'; end if;
  if r.kind not in ('rail', 'bus') then raise exception '支線にできるのは、鉄道とバスの系統だけです'; end if;
  if p.kind <> r.kind then raise exception '本線と支線は、同じ種類（鉄道どうし・バスどうし）にしてください'; end if;
  if not (r.stops && p.stops) then raise exception '本線と同じ駅が1つもありません（支線は、本線の駅から分かれます）'; end if;
  -- 本線の本線…をたどって、自分にもどらない（ぐるぐるにしない）
  x := p.parent;
  while x is not null and k < 30 loop
    if x = r.id then raise exception 'その系統は、この系統の支線です（入れかえるときは、先に支線をやめてください）'; end if;
    x := (select z.parent from mp_routes z where z.id = x); k := k + 1;
  end loop;
  update mp_routes set parent = p.id where id = r.id;
  -- 鉄道：同じ線路を走るので、たがいに待避・続行する（優先番号の小さい列車が先）
  if r.kind = 'rail' then
    if not coalesce(r.xwait, false) then update mp_routes set xwait = true where id = r.id; perform _mp_resched(r.id); end if;
    if not coalesce(p.xwait, false) then update mp_routes set xwait = true where id = p.id; perform _mp_resched(p.id); end if;
  end if;
  perform _mp_chg('route', r.id, 'set', null);
  perform _mp_chg('route', p.id, 'set', null);
  return jsonb_build_object('ok', true, 'parent', p.id, 'pname', p.name);
end $$;

-- ダイヤの取りこみ（DB の更新70）：AI などで直した列車の一覧を、まとめて入れる（見つもり p_dry → 取りこむ。あとで「↶ 取り消す」でもどせる）
--   p_rows：[{line, id, del, num, dir, kind, dep, op, day, skip, tt, sa, sb}, …]（駅・運用は id。時刻は 0時からの秒。画面が AI 用の文字から直したもの）
--     id がある：その列車を直す（書いた項目だけ。書かなかった項目は いまのまま）。del: true は消す
--     id がない：新しい列車（num・dir・dep は必ず）。skip を書かなければ、種別の停車駅パターン
--   p_replace：書かなかった列車を消す（まるごと入れかえ）
--   まちがいは行ごとに集めて返す（1つでもあれば、何も変えない）。採時駅でない駅の時刻は使わない（notes）
create or replace function public.mp_dia_import(p_route bigint, p_rows jsonb, p_replace boolean, p_dry boolean, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; e jsonb; ln int; ix int; errs jsonb := '[]'::jsonb; notes jsonb := '[]'::jsonb; t mp_trains; ns int; nid bigint;
        nadd int := 0; nupd int := 0; ndel int := 0; keep bigint[] := '{}'; gone bigint[] := '{}'; n int;
        v_num text; v_kind text; v_dir int; v_dep int; v_op bigint; v_form bigint; v_day date; v_skip bigint[]; v_tt jsonb; v_sa bigint; v_sb bigint;
        k0 int; k1 int; o mp_ops; pf record; kk text; vv jsonb; pat bigint[];
        b_n int; b_ov int; b_bad int; a_n int; a_ov int; a_bad int; probs jsonb := '[]'::jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception '列車の一覧の形がちがいます'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception '一度に入れられるのは2000行までです'; end if;
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  ns := coalesce(array_length(r.stops, 1), 0);
  select count(*), count(*) filter (where warn ~ 'とかさなります'), count(*) filter (where bad) into b_n, b_ov, b_bad from mp_trains where route = r.id;
  a_n := b_n; a_ov := b_ov; a_bad := b_bad;
  begin
    if not p_dry then perform _mp_dia_snap(r.id, 'ダイヤを取りこんだ'); end if;
    for e, ix in select z.x, z.q::int from jsonb_array_elements(p_rows) with ordinality z(x, q) loop
      ln := ix;
      begin
        if jsonb_typeof(e) <> 'object' then raise exception '列車の形がちがいます'; end if;
        ln := coalesce(nullif(e ->> 'line', '')::int, ix);
        t := null;
        if e ->> 'id' is not null then
          select * into t from mp_trains where id = (e ->> 'id')::bigint and route = r.id;
          if not found then raise exception '列車（id %）が この系統にありません。新しい列車なら id を書かないでください', e ->> 'id'; end if;
          if t.id = any(keep) or t.id = any(gone) then raise exception '同じ列車（id %）が2回あります', t.id; end if;
        end if;
        if coalesce((e ->> 'del')::boolean, false) then
          -- 消す
          if t.id is null then raise exception '消す列車の id がありません'; end if;
          delete from mp_trains where id = t.id;
          gone := gone || t.id; ndel := ndel + 1;
        else
          v_dir := case when e ? 'dir' then (e ->> 'dir')::int else coalesce(t.dir, 1) end;
          if v_dir is null or v_dir not in (1, -1) then raise exception '向き（dir）は 下り か 上り です'; end if;
          v_num := case when e ? 'num' then left(trim(coalesce(e ->> 'num', '')), 12) else t.num end;
          if coalesce(v_num, '') = '' then raise exception '列車番号（num）がありません'; end if;
          v_kind := case when e ? 'kind' then left(coalesce(nullif(trim(e ->> 'kind'), ''), '普通'), 8) else coalesce(t.kind, '普通') end;
          v_dep := case when e ? 'dep' then (e ->> 'dep')::int else t.dep end;
          if v_dep is null then raise exception '始発駅を出る時刻（dep）がありません'; end if;
          if v_dep < 0 or v_dep >= 86400 then raise exception '始発駅を出る時刻（dep）は 0:00〜23:59:59 です'; end if;
          -- 運用（書いたときだけ。null は運用なし）
          if e ? 'op' then
            v_op := (e ->> 'op')::bigint; v_form := null;
            if v_op is not null then
              select * into o from mp_ops where id = v_op and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
              if not found then raise exception '運用が見つかりません'; end if;
              if o.kind <> r.kind then raise exception '運用の種類が、この系統とちがいます'; end if;
              v_form := o.form;
            end if;
          else v_op := t.op; v_form := t.form;
          end if;
          -- 臨時列車の日付（null は毎日）
          v_day := case when e ? 'day' then nullif(e ->> 'day', '')::date else t.day end;
          if v_day is not null and v_day is distinct from t.day and (v_day < _mp_today() or v_day > _mp_today() + 60) then
            raise exception '臨時列車の日付は、きょうから60日先までです';
          end if;
          -- 始発駅・終着駅（途中から・途中まで。null は系統の端）
          v_sa := case when e ? 'sa' then (e ->> 'sa')::bigint else t.sa end;
          v_sb := case when e ? 'sb' then (e ->> 'sb')::bigint else t.sb end;
          if (v_sa is not null and not (v_sa = any(r.stops))) or (v_sb is not null and not (v_sb = any(r.stops))) then raise exception '始発駅・終着駅が、この系統にありません'; end if;
          -- 通過する駅。書いていない新しい列車は、種別の停車駅パターン（あれば）
          if e ? 'skip' then
            v_skip := array(select x::bigint from jsonb_array_elements_text(coalesce(e -> 'skip', '[]'::jsonb)) x);
            if exists (select 1 from unnest(v_skip) x where not (x = any(r.stops))) then raise exception '通過する駅が、この系統にありません'; end if;
          elsif t.id is not null then v_skip := t.skip;
          else
            pat := array(select x::text::bigint from jsonb_array_elements(coalesce(r.pats -> v_kind, '[]'::jsonb)) x);
            v_skip := '{}';
            if cardinality(pat) > 0 then
              select * into pf from _mp_pat_fit(r.stops, v_dir, v_sa, v_sb, pat);
              if not pf.ok then raise exception '種別「%」の停車駅のパターンでは、止まる駅が2つより少なくなります', v_kind; end if;
              v_sa := pf.nsa; v_sb := pf.nsb; v_skip := pf.nskip;
            end if;
          end if;
          k0 := coalesce(_mp_kpos(r.stops, v_dir, v_sa, false), 1);
          k1 := coalesce(_mp_kpos(r.stops, v_dir, v_sb, true), ns);
          if k0 >= k1 then raise exception '始発駅は、終着駅より前（走る順）にしてください'; end if;
          v_sa := case when k0 > 1 then v_sa end; v_sb := case when k1 < ns then v_sb end;
          -- 採時駅の着・発・番線（採時駅でない駅は使わない）
          if e ? 'tt' then
            v_tt := '{}'::jsonb;
            for kk, vv in select * from jsonb_each(coalesce(e -> 'tt', '{}'::jsonb)) loop
              if not (kk::bigint = any(r.stops)) then raise exception '時刻を決める駅が、この系統にありません'; end if;
              if not (kk::bigint = any(r.timing)) then
                notes := notes || jsonb_build_object('line', ln, 'msg', format('「%s」は採時駅ではないので、時刻・番線の指定は使いません', (select s.name from mp_stations s where s.id = kk::bigint)));
              else
                if coalesce((vv ->> 'a')::int, 0) not between 0 and 86399 or coalesce((vv ->> 'd')::int, 0) not between 0 and 86399 then raise exception '時刻は 0:00〜23:59:59 です'; end if;
                if coalesce((vv ->> 't')::int, 1) not between 1 and 99 then raise exception '番線がちがいます'; end if;
                v_tt := v_tt || jsonb_build_object(kk, jsonb_strip_nulls(jsonb_build_object('a', (vv ->> 'a')::int, 'd', (vv ->> 'd')::int, 't', (vv ->> 't')::int)));
              end if;
            end loop;
          else v_tt := coalesce(t.tt, '{}'::jsonb);
          end if;
          v_skip := coalesce(v_skip, '{}');
          if t.id is null then
            insert into mp_trains(route, dir, num, kind, dep, form, op, day, tt, skip, cpl, sa, sb)
            values (r.id, v_dir, v_num, v_kind, v_dep, v_form, v_op, v_day, v_tt, v_skip, '[]'::jsonb, v_sa, v_sb) returning id into nid;
            keep := keep || nid; nadd := nadd + 1;
          else
            keep := keep || t.id;
            if (t.dir, t.num, t.kind, t.dep, t.form, t.op, t.day, t.tt, t.skip, t.sa, t.sb) is distinct from (v_dir, v_num, v_kind, v_dep, v_form, v_op, v_day, v_tt, v_skip, v_sa, v_sb) then
              update mp_trains set dir = v_dir, num = v_num, kind = v_kind, dep = v_dep, form = v_form, op = v_op, day = v_day, tt = v_tt, skip = v_skip, sa = v_sa, sb = v_sb,
                     cpl = (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(cpl) c where (c ->> 'op')::bigint is distinct from v_op)
               where id = t.id;
              nupd := nupd + 1;
            end if;
          end if;
        end if;
      exception when others then
        if jsonb_array_length(errs) < 100 then errs := errs || jsonb_build_object('line', ln, 'msg', sqlerrm); end if;
      end;
    end loop;
    if p_replace and jsonb_array_length(errs) = 0 then
      select count(*) into n from mp_trains where route = r.id and not (id = any(keep));
      delete from mp_trains where route = r.id and not (id = any(keep));
      ndel := ndel + n;
    end if;
    if (select count(*) from mp_trains where route = r.id) > 900 then errs := errs || jsonb_build_object('line', 0, 'msg', '1つの系統の列車は900本までです'); end if;
    if jsonb_array_length(errs) > 0 then raise exception 'mp_dia_import_err'; end if;
    if nadd + nupd + ndel = 0 then raise exception 'mp_dia_import_none'; end if;   -- 変わるところがない（取り消しの記録ものこさない）
    perform _mp_resched(r.id);
    select count(*), count(*) filter (where warn ~ 'とかさなります'), count(*) filter (where bad) into a_n, a_ov, a_bad from mp_trains where route = r.id;
    probs := coalesce((select jsonb_agg(jsonb_build_object('num', z.num, 'dir', z.dir, 'dep', z.dep, 'warn', z.warn, 'bad', z.bad) order by z.dep, z.num)
                         from (select num, dir, dep, warn, bad from mp_trains where route = r.id and id = any(keep) and (warn is not null or bad) order by dep, num limit 30) z), '[]'::jsonb);
    if p_dry then raise exception 'mp_dia_import_dry'; end if;   -- 見つもり：ここまでの変更を取り消す（数はのこる）
  exception when raise_exception then
    if sqlerrm not in ('mp_dia_import_dry', 'mp_dia_import_err', 'mp_dia_import_none') then raise; end if;
  end;
  if not p_dry and jsonb_array_length(errs) = 0 and nadd + nupd + ndel > 0 then perform _mp_chg('route', r.id, 'set', null); end if;
  return jsonb_build_object('ok', jsonb_array_length(errs) = 0, 'dry', p_dry, 'errs', errs, 'notes', notes, 'add', nadd, 'upd', nupd, 'del', ndel,
    'before', jsonb_build_object('n', b_n, 'ov', b_ov, 'bad', b_bad), 'after', jsonb_build_object('n', a_n, 'ov', a_ov, 'bad', a_bad), 'probs', probs);
end $$;

-- 系統と列車（ダイヤグラム・時刻表を描く分）。本線・支線（DB の更新70）
create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean;
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'mine', mine, 'ok', r.ok, 'why', r.why, 'dwell', r.dwell,
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
    'today', _mp_today(),
    'stops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'tracks', s.tracks, 'plat', s.plat, 'trk', _mp_sta_trk(s), 'x', s.x, 'y', s.y) order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats,
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'fser', fi.ser, 'fn', fi.n,   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk   -- 編成の工事中（DB の更新60）
               ) order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;

-- 系統の一覧（自分の名義）。支線の本線（DB の更新70）
create or replace function public.mp_routes_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'ok', r.ok, 'why', r.why, 'parent', r.parent,   -- 支線の本線（DB の更新70）
            'stops', (select jsonb_agg(s.name order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
            'km', round(((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l) / 1000)::numeric, 1),
            'trains', (select count(*) from mp_trains t where t.route = r.id), 'warn', (select count(*) from mp_trains t where t.route = r.id and t.warn is not null),
            'thru', (select coalesce(jsonb_agg(distinct _mp_pname(s.own_u, s.own_c, false)), '[]'::jsonb) from jsonb_array_elements(r.legs) l, jsonb_array_elements(l -> 'g') g
                       join mp_segs s on s.id = (g ->> 0)::bigint where r.kind = 'rail' and not (s.own_u is not distinct from r.own_u and s.own_c is not distinct from r.own_c)),
            'last', r.last) order by r.id), '[]'::jsonb)
          from mp_routes r where r.own_u is not distinct from pa.pu and r.own_c is not distinct from pa.pc);
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。支線・取りこみ・ダイヤ・系統の一覧は、ログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mp_route_branch', 'mp_dia_import', 'mp_dia', 'mp_routes_list') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
-- 時刻を組みなおすので、60秒まで待つ（支線：本線と支線の2つ・取りこみ：見つもりと取りこみ）
alter function public.mp_route_branch(bigint, bigint, text) set statement_timeout = '60s';
alter function public.mp_dia_import(bigint, jsonb, boolean, boolean, text) set statement_timeout = '60s';
