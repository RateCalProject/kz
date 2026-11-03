-- 予備編成：編成を「予備」にすると、運用に入れずに待機して、同じ車庫の同じ形式・両数の編成が検査・改造・転属・納車のあいだ、
--   その列車をかわりに走る（代走）。代走の予定は72時間先まで立てて（mp_subst）、毎時と、工事・転属・組みかえ・運用・予備を変えたときに見なおす
--   列車の情報・ダイヤに「代走」と予備編成を出す。予備編成を運用に入れると予備ではなくなる（mp_form_spare）
-- 期間つき増結：入れ替え枠の車両を編成の先頭がわ・最後がわに増結（機関車の編成は客車のとなりに）。期間（時間）をつけると、すぎたら
--   はずして入れ替え枠にもどす（毎時。持ち主に通知）。期間はあとから変えられる（mp_form_add・mp_car_tmp・_mp_tmp_back）

alter table public.mp_forms add column if not exists spare boolean not null default false;   -- 予備編成（DB の更新80）：運用に入れず、同じ車庫・同じ形式と両数の編成が工事中のとき、かわりに走る（代走）
alter table public.mp_cars add column if not exists tmp_until timestamptz;   -- 期間つき増結（DB の更新80）：この時刻をすぎたら編成からはずれて、入れ替え枠にもどる
create table if not exists public.mp_subst (      -- 予備編成の代走（DB の更新80）：列車の1回（train・day）を、予備編成 sub が orig のかわりに走る
  id      bigserial primary key,
  train   bigint not null references public.mp_trains(id) on delete cascade,
  day     date not null,                -- 運行日（日本時間。始発駅を出る日）
  orig    bigint not null references public.mp_forms(id) on delete cascade,   -- 工事中の編成（もとの編成）
  sub     bigint not null references public.mp_forms(id) on delete cascade,   -- 走る予備編成
  own_u   uuid, own_c int,              -- 編成の名義
  t0      timestamptz not null,         -- 始発駅を出る
  t1      timestamptz not null,         -- 終点に着く
  made_at timestamptz not null default now(),
  unique (train, day)
);
create index if not exists mp_subst_sub on public.mp_subst (sub, t0);
create index if not exists mp_subst_orig on public.mp_subst (orig);
create index if not exists mp_subst_own on public.mp_subst (own_u, own_c);
alter table public.mp_subst enable row level security;
revoke all on public.mp_subst from public, anon, authenticated;
revoke all on sequence public.mp_subst_id_seq from public, anon, authenticated;

-- 編成の中身（形式と両数）：予備編成がかわりに走れるか（同じ形式が同じ両数。ならびはとわない。DB の更新80）
create or replace function public._mp_form_key(fid bigint) returns text
language sql stable set search_path = public as $$
  select string_agg(c.type, ',' order by c.type) from mp_cars c where c.form = fid
$$;
-- 列車 tid が ta〜tb に走る回（運行日 d・始発駅を出る a・終点に着く b）。毎日の列車は日ごと、臨時列車はその日だけ（DB の更新80）
create or replace function public._mp_train_runs(tid bigint, ta timestamptz, tb timestamptz) returns table(d date, a timestamptz, b timestamptz)
language sql stable set search_path = public as $$
  select x.dd, x.aa, x.bb
    from mp_trains t
    cross join lateral (select g::date dd from generate_series(((ta at time zone 'Asia/Tokyo')::date - 1)::timestamp, ((tb at time zone 'Asia/Tokyo')::date)::timestamp, interval '1 day') g) dz
    cross join lateral (select dz.dd, (dz.dd::timestamp + make_interval(secs => t.dep)) at time zone 'Asia/Tokyo' aa,
                               (dz.dd::timestamp + make_interval(secs => coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) from jsonb_array_elements(t.sched) s(v)), t.dep))) at time zone 'Asia/Tokyo' bb) x
   where t.id = tid and not coalesce(t.bad, false) and jsonb_array_length(t.sched) > 1 and (t.day is null or t.day = dz.dd)
     and x.aa < tb and x.bb > ta
$$;
-- 予備編成 sp が、工事中の編成 orig のかわりに a〜b を走れるか：同じ名義・同じ車庫・同じ形式と両数・運用に入っていない・その時間（前後5分）に工事中でない
create or replace function public._mp_subst_can(sp bigint, orig bigint, a timestamptz, b timestamptz) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from mp_forms s join mp_forms o on o.id = orig
                  where s.id = sp and s.spare and s.id <> o.id and s.own_u is not distinct from o.own_u and s.own_c is not distinct from o.own_c and s.depot = o.depot
                    and not exists (select 1 from mp_ops p where p.form = s.id)
                    and not exists (select 1 from mp_trains t where t.form = s.id)
                    and _mp_form_key(s.id) = _mp_form_key(o.id)
                    and not _mp_form_busy(s.id, a - interval '5 minutes', b + interval '5 minutes'))
$$;
-- orig のかわりに a〜b を走る予備編成をえらぶ（ほかの代走と時間がかさならないもの）。同じ編成の代走をしているものを先に、つぎに状態のよいもの
create or replace function public._mp_subst_pick(orig bigint, a timestamptz, b timestamptz) returns bigint
language sql stable set search_path = public as $$
  select s.id from mp_forms o join mp_forms s on s.spare and s.id <> o.id and s.own_u is not distinct from o.own_u and s.own_c is not distinct from o.own_c and s.depot = o.depot
   where o.id = orig and _mp_subst_can(s.id, orig, a, b)
     and not exists (select 1 from mp_subst q where q.sub = s.id and q.t0 < b + interval '5 minutes' and q.t1 > a - interval '5 minutes')
   order by exists (select 1 from mp_subst q where q.sub = s.id and q.orig = o.id) desc, (select min(c.cond) from mp_cars c where c.form = s.id) desc nulls last, s.id
   limit 1
$$;
-- この編成に、かわりに走れる予備編成があるか（時間は見ない。工事の見つもりで出す）
create or replace function public._mp_subst_has(fid bigint) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from mp_forms o join mp_forms s on s.spare and s.id <> o.id and s.own_u is not distinct from o.own_u and s.own_c is not distinct from o.own_c and s.depot = o.depot
                  where o.id = fid and not exists (select 1 from mp_ops p where p.form = s.id) and _mp_form_key(s.id) = _mp_form_key(o.id))
$$;
-- 列車の1回（p_tid・p_day、p_a〜p_b）を走る予備編成（なければ null）：予定があれば、まだ使えるか見てそれを。なければここでえらんで予定に入れる
create or replace function public._mp_subst_ok(p_tid bigint, p_day date, p_orig bigint, p_a timestamptz, p_b timestamptz) returns bigint
language plpgsql set search_path = public as $$
declare v mp_subst; v_sp bigint;
begin
  select * into v from mp_subst where train = p_tid and day = p_day;
  if found then
    if v.orig = p_orig and _mp_subst_can(v.sub, p_orig, p_a, p_b) then return v.sub; end if;
    delete from mp_subst where id = v.id;
  end if;
  v_sp := _mp_subst_pick(p_orig, p_a, p_b);
  if v_sp is null then return null; end if;
  insert into mp_subst(train, day, orig, sub, own_u, own_c, t0, t1)
    select p_tid, p_day, p_orig, v_sp, o.own_u, o.own_c, p_a, p_b from mp_forms o where o.id = p_orig
  on conflict (train, day) do update set orig = excluded.orig, sub = excluded.sub, t0 = excluded.t0, t1 = excluded.t1, made_at = now();
  return v_sp;
end $$;
-- 予備編成の代走の予定（名義ごと）：これから72時間に走るはずの列車のうち、編成が工事中（検査・改造・転属・納車）でとまる回に予備編成をわりあてる。
--   合わなくなった予定（工事がおわった・予備をやめた・中身が変わった・列車の編成が変わった など）は消す。すんだ予定は3日のこす
create or replace function public._mp_subst_plan(pu uuid, pc int) returns int
language plpgsql set search_path = public as $$
declare v record; v_n int := 0; v_tb timestamptz := now() + interval '72 hours';
begin
  delete from mp_subst s where s.own_u is not distinct from pu and s.own_c is not distinct from pc and s.t1 < now() - interval '3 days';
  delete from mp_subst s where s.own_u is not distinct from pu and s.own_c is not distinct from pc and s.t1 > now()
     and (not exists (select 1 from mp_trains t where t.id = s.train and t.form = s.orig and not coalesce(t.bad, false))
          or not _mp_form_busy(s.orig, s.t0, s.t1) or not _mp_subst_can(s.sub, s.orig, s.t0, s.t1));
  delete from mp_subst s where s.own_u is not distinct from pu and s.own_c is not distinct from pc and s.t1 > now()   -- 同じ予備編成で時間がかさなるものは、あとのほうを消す
     and exists (select 1 from mp_subst q where q.sub = s.sub and q.id < s.id and q.t0 < s.t1 + interval '5 minutes' and q.t1 > s.t0 - interval '5 minutes');
  if not exists (select 1 from mp_forms f where f.spare and f.own_u is not distinct from pu and f.own_c is not distinct from pc) then return 0; end if;
  for v in
    select t.id tid, t.form fid, r.d rd, r.a ra, r.b rb
      from mp_forms f join mp_trains t on t.form = f.id
      cross join lateral _mp_train_runs(t.id, now(), v_tb) r
     where f.own_u is not distinct from pu and f.own_c is not distinct from pc and not f.spare
       and exists (select 1 from mp_cars c where c.form = f.id and c.busy_until > now())
       and _mp_form_busy(f.id, r.a, r.b)
       and not exists (select 1 from mp_subst s where s.train = t.id and s.day = r.d)
     order by r.a
  loop
    if _mp_subst_ok(v.tid, v.rd, v.fid, v.ra, v.rb) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
-- 予備編成のある名義（と、予定ののこっている名義）の代走の予定を見なおす（毎時）
create or replace function public._mp_subst_plan_all() returns void
language plpgsql set search_path = public as $$
declare v record;
begin
  for v in select distinct z.own_u, z.own_c from (select f.own_u, f.own_c from mp_forms f where f.spare union select s.own_u, s.own_c from mp_subst s) z loop
    begin perform _mp_subst_plan(v.own_u, v.own_c); exception when others then raise warning 'mp subst %/%: %', v.own_u, v.own_c, sqlerrm; end;
  end loop;
end $$;
-- 期間つき増結：期間がおわった車両を編成からはずして、入れ替え枠にもどす（毎時。DB の更新80）。のこりの編成がきまりに合わなければ運用からはずす
create or replace function public._mp_tmp_back() returns int
language plpgsql set search_path = public as $$
declare v record; v_left bigint[]; v_n int := 0; v_who uuid;
begin
  update mp_cars set tmp_until = null where tmp_until is not null and form is null;
  for v in select x.id, x.name, x.own_u, x.own_c, array_agg(c.id order by c.pos) ids, string_agg(c.num, '・' order by c.pos) nums
             from mp_cars c join mp_forms x on x.id = c.form where c.tmp_until <= now() group by x.id, x.name, x.own_u, x.own_c loop
    update mp_cars set form = null, pos = 0, tmp_until = null where id = any(v.ids);
    v_left := array(select c.id from mp_cars c where c.form = v.id order by c.pos);
    if coalesce(array_length(v_left, 1), 0) = 0 then
      perform _mp_form_drop(array[v.id], '編成の車両がなくなったので、運用からはずれました');
      delete from mp_forms where id = v.id;
    else
      update mp_cars c set pos = z.o from unnest(v_left) with ordinality z(id, o) where c.id = z.id;
      if _mp_form_rule(v_left) is not null then
        perform _mp_form_drop(array[v.id], '増結の期間がおわって車両をはずしたら、編成のきまりに合わなくなったので、運用からはずれました');
        update mp_forms set spare = false where id = v.id;
      end if;
      perform _mp_resched(rr) from _mp_form_routes(v.id) rr;
    end if;
    v_who := coalesce(v.own_u, (select owner from companies where id = v.own_c));
    if v_who is not null then
      perform _notice_l(v_who, format('【国土】増結の期間がおわったので、編成「%s」から %s（%s両）をはずして、入れ替え枠にもどしました', v.name, v.nums, array_length(v.ids, 1)),
                        jsonb_build_object('go', 'map', 'k', 'cars'), null);
    end if;
    v_n := v_n + array_length(v.ids, 1);
  end loop;
  return v_n;
end $$;
-- 予備編成にする・やめる（DB の更新80）：予備編成は運用に入れず、同じ車庫の同じ形式・両数の編成が検査・改造・転属・納車のあいだ、
--   その列車をかわりに走る（代走）。運用に入れると予備ではなくなる
create or replace function public.mp_form_spare(p_form bigint, p_on boolean, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; v_on boolean := coalesce(p_on, false);
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  perform _mp_lock(pa.pu, pa.pc);
  perform 1 from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
  if not found then raise exception '編成が見つかりません'; end if;
  if _mp_form_kind(p_form) <> 'rail' then raise exception '予備編成にできるのは鉄道の編成だけです'; end if;
  if v_on then
    if exists (select 1 from mp_ops o where o.form = p_form) then raise exception '運用に入っている編成は予備にできません（運用からはずしてください）'; end if;
    if exists (select 1 from mp_trains t where t.form = p_form) then raise exception '列車に入っている編成は予備にできません'; end if;
    if _mp_form_rule(array(select c.id from mp_cars c where c.form = p_form order by c.pos)) is not null then
      raise exception 'この編成は走れないので、予備にできません（編成のきまりに合っていません）';
    end if;
  end if;
  update mp_forms set spare = v_on where id = p_form;
  if not v_on then delete from mp_subst where sub = p_form and t1 > now(); end if;
  perform _mp_subst_plan(pa.pu, pa.pc);
  return jsonb_build_object('id', p_form, 'spare', v_on, 'subn', (select count(*) from mp_subst s where s.sub = p_form and s.t1 > now()));
end $$;
-- 入れ替え枠の車両を編成に増結する（DB の更新80）。p_at：head（先頭がわ）・tail（最後がわ）。機関車のある編成は、機関車の内がわ（客車のとなり）に入れる
--   p_hours 時間たつと、はずして入れ替え枠にもどす（null はずっと）。組みかえの手間は 1両 10万 X ＋ 5万 X。p_dry なら見つもり
create or replace function public.mp_form_add(p_form bigint, p_cars bigint[], p_at text, p_hours int, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; v_f mp_forms; v_cur bigint[]; v_seq bigint[]; v_k int; v_len int; v_why text; v_res jsonb; v_cnt int := coalesce(array_length(p_cars, 1), 0);
        v_until timestamptz := case when p_hours is not null then now() + make_interval(hours => p_hours) end;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into v_f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '編成が見つかりません'; end if;
  if v_cnt = 0 then raise exception '増結する車両をえらんでください'; end if;
  if p_hours is not null and (p_hours < 1 or p_hours > 24 * 90) then raise exception '期間は1時間から90日までです'; end if;
  if (select count(distinct x) from unnest(p_cars) x) <> v_cnt then raise exception '同じ車両が2回入っています'; end if;
  if exists (select 1 from unnest(p_cars) x where not exists (select 1 from mp_cars c where c.id = x and c.form is null and c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc)) then
    raise exception '入れ替え枠（編成に入っていない車両）からえらんでください';
  end if;
  if exists (select 1 from mp_cars c where c.id = any(p_cars) and c.depot is distinct from v_f.depot) then raise exception 'ちがう車庫の車両は増結できません（先に転属を）'; end if;
  v_cur := array(select c.id from mp_cars c where c.form = p_form order by c.pos);
  v_len := coalesce(array_length(v_cur, 1), 0);
  if p_at = 'tail' then   -- 最後がわ：うしろに続く機関車の前
    v_k := v_len;
    while v_k > 0 and exists (select 1 from mp_cars c join mp_types t on t.code = c.type where c.id = v_cur[v_k] and t.role = 'L') loop v_k := v_k - 1; end loop;
    if v_k = 0 then v_k := v_len; end if;   -- 機関車だけの編成：最後に
  else                    -- 先頭がわ：前に続く機関車のあと
    v_k := 0;
    while v_k < v_len and exists (select 1 from mp_cars c join mp_types t on t.code = c.type where c.id = v_cur[v_k + 1] and t.role = 'L') loop v_k := v_k + 1; end loop;
    if v_k = v_len then v_k := 0; end if;   -- 機関車だけの編成：先頭に
  end if;
  v_seq := v_cur[1:v_k] || p_cars || v_cur[v_k + 1:v_len];
  v_why := _mp_form_rule(v_seq);
  if v_why is not null then raise exception '増結すると走れません：%', v_why; end if;
  if coalesce(p_dry, false) then
    return jsonb_build_object('fee', 100000 * v_cnt + 50000, 'until', v_until, 'n', array_length(v_seq, 1),
      'seq', (select jsonb_agg(c.num order by z.o) from unnest(v_seq) with ordinality z(id, o) join mp_cars c on c.id = z.id),
      'cap0', coalesce((_mp_form_perf(p_form) ->> 'cap')::int, 0),
      'cap', (select coalesce(sum(t.cap), 0) from unnest(v_seq) z(id) join mp_cars c on c.id = z.id join mp_types t on t.code = c.type),
      'len', (select coalesce(sum(t.len), 0) from unnest(v_seq) z(id) join mp_cars c on c.id = z.id join mp_types t on t.code = c.type));
  end if;
  v_res := mp_form_set(p_form, v_seq, v_f.name, p_as);
  if v_until is not null then update mp_cars set tmp_until = v_until where id = any(p_cars) and form = p_form; end if;
  return v_res || jsonb_build_object('until', v_until, 'n', array_length(v_seq, 1));
end $$;
-- 増結の期間を変える（DB の更新80）：p_hours 時間たったらもどす。null なら期間をなくす（ずっと編成に入れておく）
create or replace function public.mp_car_tmp(p_cars bigint[], p_hours int, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; v_n int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_hours is not null and (p_hours < 1 or p_hours > 24 * 90) then raise exception '期間は1時間から90日までです'; end if;
  update mp_cars set tmp_until = case when p_hours is null then null else now() + make_interval(hours => p_hours) end
   where id = any(p_cars) and form is not null and tmp_until is not null and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception '増結した車両（期間つき）をえらんでください'; end if;
  return jsonb_build_object('n', v_n, 'until', case when p_hours is not null then now() + make_interval(hours => p_hours) end);
end $$;

create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb; rfid bigint; nsub int;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
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
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        broke := broke + 1;
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        continue;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0)));   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
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

create or replace function public._mp_tick() returns void
language plpgsql set search_path = public as $$
declare last timestamptz; h timestamptz; n int := 0;
begin
  if not exists (select 1 from mp_chunks limit 1) then return; end if;
  select v into last from mp_state where k = 'hour' for update;
  h := date_trunc('hour', now());
  if last is null then insert into mp_state values ('hour', h) on conflict (k) do update set v = excluded.v; return; end if;
  last := greatest(last, h - interval '12 hours');
  begin perform _mp_subst_plan_all(); exception when others then raise warning 'mp subst: %', sqlerrm; end;   -- 予備編成の代走の予定（DB の更新80）
  while last < h and n < 12 loop
    last := last + interval '1 hour'; n := n + 1;
    begin perform _mp_tick_hour(last); exception when others then raise warning 'mp hour: %', sqlerrm; end;
    if extract(hour from last at time zone 'Asia/Tokyo') = 4 then
      begin perform _mp_tick_day(); exception when others then raise warning 'mp day: %', sqlerrm; end;
    end if;
  end loop;
  begin perform _mp_slot_tick(); exception when others then raise warning 'mp slot: %', sqlerrm; end;   -- 発着口の入札・権利の期限（t57）
  begin perform _mp_tmp_back(); exception when others then raise warning 'mp tmp: %', sqlerrm; end;   -- 期間つき増結の車両を入れ替え枠にもどす（DB の更新80）
  update mp_state set v = last where k = 'hour';
end $$;

create or replace function public.mp_cars_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return jsonb_build_object(
    'cars', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'num', c.num, 'role', t.role, 'face', t.face, 'label', t.label, 'depot', c.depot, 'form', c.form, 'pos', c.pos,
               'cond', round(c.cond::numeric), 'heat', c.heat, 'ac', c.ac, 'toilet', c.toilet, 'snow', c.snow, 'renewed', c.renewed,
               'age', floor(extract(epoch from now() - c.born) / 86400), 'life', t.life,
               'busy', case when c.busy_until > now() then c.busy_kind end, 'until', case when c.busy_until > now() then c.busy_until end, 'price', c.price,
               'xfer', exists (select 1 from mp_xfers x where x.st = 'offer' and c.id = any(x.cars)),
               'tmp', case when c.form is not null then c.tmp_until end)   -- 期間つき増結：入れ替え枠にもどる時刻（DB の更新80）
               order by c.depot, c.form nulls last, c.pos, c.num), '[]'::jsonb)
             from mp_cars c join mp_types t on t.code = c.type where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'depot', f.depot, 'perf', _mp_form_perf(f.id),
               'trains', (select count(*) from mp_trains tr where tr.form = f.id),
               'op', (select jsonb_build_object('id', o.id, 'num', o.num) from mp_ops o where o.form = f.id),
               'xfer', (select x.id from mp_xfers x where x.form = f.id and x.st = 'offer' limit 1),
               -- 予備編成（DB の更新80）：subn 予備として代走する回・subby この編成のかわりに予備編成が走る回（これからのもの）
               'spare', f.spare, 'subn', (select count(*) from mp_subst s where s.sub = f.id and s.t1 > now()), 'subby', (select count(*) from mp_subst s where s.orig = f.id and s.t1 > now())) order by f.name), '[]'::jsonb)
             from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'cap', d.cap, 'x', d.x, 'y', d.y,
               'n', (select count(*) from mp_cars c where c.depot = d.id), 'plows', d.plows, 'zone', _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int), 'pub', d.own_u is null and d.own_c is null and not pa.gv) order by d.own_u is null and d.own_c is null, d.id), '[]'::jsonb)
             from mp_depots d where (d.own_u is not distinct from pa.pu and d.own_c is not distinct from pa.pc)
                                 or (d.kind = 'air' and d.bld is not null and _mp_gov_term(d.bld))),   -- 国の空港の駐機場（みんなで使う。t54q）
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from mp_types t where t.on_sale),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ord), '[]'::jsonb) from mp_series s),
    'fsets', _mp_fset_json(u),   -- 編成のプリセット（DB の更新72）
    'lsplit', true);   -- 機関車と客車を別に注文する（DB の更新78）
end $$;

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

create or replace function public.mp_op_save(p_id bigint, p_num text, p_form bigint, p_note text, p_kind text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; o mp_ops; nm text := left(trim(coalesce(p_num, '')), 12); kd text; f mp_forms; other bigint; othernum text; oid_ bigint; rids bigint[]; why text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '運用は人か会社でつくります'; end if;
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

create or replace function public.mp_form_set(p_form bigint, p_cars bigint[], p_name text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; why text; dep bigint; nd int; f mp_forms; i int; old bigint[]; fee bigint := 0; nbusy int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  perform _mp_lock(pa.pu, pa.pc);   -- 同じ名義の操作は1つずつ（DB の更新60）
  perform 1 from mp_cars where id = any(p_cars) for update;   -- 車両をおさえてから持ち主を見る（ゆずる・廃車と同時にならないように）
  if exists (select 1 from unnest(p_cars) x where not exists (select 1 from mp_cars c where c.id = x and c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc)) then
    raise exception 'この名義の車両ではないものがあります';
  end if;
  if (select count(distinct x) from unnest(p_cars) x) <> coalesce(array_length(p_cars, 1), 0) then raise exception '同じ車両が2回入っています'; end if;
  select count(distinct depot), min(depot) into nd, dep from mp_cars where id = any(p_cars);
  if nd > 1 then raise exception 'ちがう車庫の車両はつなげません（先に転属を）'; end if;
  select count(*) into nbusy from mp_cars where id = any(p_cars) and busy_until > now() and busy_kind <> 'deliver';
  if nbusy > 0 then raise exception '検査・改造・転属中の車両があります'; end if;
  why := _mp_form_srule(p_cars);   -- 客車だけの編成も組める（機関車をつなぐまで走れない。DB の更新78）
  if why is not null then raise exception '%', why; end if;
  -- 編成番号（持ち主ごとに1つずつ）
  if p_form is null and trim(coalesce(p_name, '')) = '' then raise exception '編成番号を入れてください'; end if;
  if trim(coalesce(p_name, '')) <> '' and exists (select 1 from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc
                                                     and x.name = left(trim(p_name), 20) and x.id is distinct from p_form) then
    raise exception '編成番号「%」はもうあります', left(trim(p_name), 20);
  end if;
  if p_form is not null then
    select * into f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
    if not found then raise exception '編成が見つかりません'; end if;
    old := array(select id from mp_cars where form = p_form order by pos);
    if old is distinct from p_cars then fee := 100000 * (select count(*) from unnest(p_cars) x where not (x = any(old))) + 50000; end if;   -- 組みかえの手間
  end if;
  -- ほかの編成から抜く（抜かれた編成は、のこりの車でもう一度きまりを見る → だめなら運用から外す）
  update mp_cars set form = null, pos = 0, tmp_until = null where id = any(p_cars) and form is distinct from p_form;   -- ほかから来た車は、増結の期間なし（DB の更新80）
  if p_form is null then
    insert into mp_forms(name, own_u, own_c, depot) values (left(trim(p_name), 20), pa.pu, pa.pc, dep) returning * into f;
  else
    update mp_cars set form = null, pos = 0, tmp_until = null where form = p_form and not (id = any(p_cars));
    update mp_forms set name = coalesce(nullif(left(trim(p_name), 20), ''), name), depot = dep where id = p_form;
  end if;
  for i in 1..array_length(p_cars, 1) loop update mp_cars set form = f.id, pos = i where id = p_cars[i]; end loop;
  if fee > 0 then perform _mp_pay(pa.pu, pa.pc, false, fee, 'car', format('編成「%s」の組みかえ', f.name)); end if;
  -- 空になった編成・きまりに合わなくなった編成は、運用と列車からはずす
  perform _mp_form_drop(array(select x.id from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.id <> f.id
                      and _mp_form_rule(array(select c.id from mp_cars c where c.form = x.id order by c.pos)) is not null), '編成が組みかわったので、運用からはずれました');
  -- この編成が走れなくなったら（機関車をはずした など）、運用からはずす（DB の更新78）
  if _mp_form_rule(array(select c.id from mp_cars c where c.form = f.id order by c.pos)) is not null then
    perform _mp_form_drop(array[f.id], '機関車がないので、運用からはずれました（機関車をつなぐと、運用にもどせます）');
    update mp_forms set spare = false where id = f.id and spare;   -- 走れない編成は予備にしない（DB の更新80）
  end if;
  delete from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and not exists (select 1 from mp_cars c where c.form = x.id);
  -- 組みかえた編成の列車（運用）は、時刻を計算しなおす（長さ・性能が変わる）
  perform _mp_resched(rr) from _mp_form_routes(f.id) rr;
  perform _mp_subst_plan(pa.pu, pa.pc);   -- 代走の予定を見なおす（中身が変わると予備編成が合わなくなる。DB の更新80）
  return jsonb_build_object('id', f.id, 'perf', _mp_form_perf(f.id), 'fee', fee);
end $$;

create or replace function public.mp_form_del(p_form bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  perform _mp_lock(pa.pu, pa.pc);   -- 同じ名義の操作は1つずつ（DB の更新60）
  perform 1 from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;   -- ゆずると同時にならないように
  if not found then raise exception '編成が見つかりません'; end if;
  if exists (select 1 from mp_cars c join mp_types t on t.code = c.type where c.form = p_form and t.role in ('Bus', 'Ship', 'Air')) then raise exception 'バス・船・飛行機はばらせません'; end if;
  perform _mp_form_drop(array[p_form], '編成がばらされたので、運用からはずれました');
  update mp_cars set form = null, pos = 0, tmp_until = null where form = p_form;
  delete from mp_forms where id = p_form;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mp_car_work(p_cars bigint[], p_kind text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; c record; cost bigint := 0; n int := 0; hrs int; skip text := ''; label text; one bigint; subs bigint := 0; sb bigint; busn int := 0; ids bigint[] := '{}';
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  hrs := case p_kind when 'ac' then 24 when 'heat' then 6 when 'toilet' then 12 when 'inspect' then 4 when 'renew' then 48 when 'snow' then 48 else null end;
  label := case p_kind when 'ac' then '冷房化' when 'heat' then '暖房の取りつけ' when 'toilet' then 'トイレの取りつけ' when 'inspect' then '検査' when 'renew' then '更新工事' when 'snow' then '雪の対策' end;
  if hrs is null then raise exception '工事の種類がちがいます'; end if;
  if not coalesce(p_dry, false) then   -- 同じ名義の操作は1つずつ・車両をおさえる（2回押しても二重にならないように。DB の更新60）
    perform _mp_lock(pa.pu, pa.pc);
    perform 1 from mp_cars where id = any(p_cars) for update;
  end if;
  for c in select x.*, t.role, t.price tprice, t.cab, (select _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int) from mp_depots d where d.id = x.depot) zn
             from mp_cars x join mp_types t on t.code = x.type
            where x.id = any(p_cars) and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc loop
    if c.busy_until > now() then skip := skip || ' ' || c.num || '（工事中・納車前）'; continue; end if;
    if p_kind in ('ac', 'heat', 'toilet') and c.role = 'L' then skip := skip || ' ' || c.num || '（機関車にはいりません）'; continue; end if;   -- DB の更新71
    if p_kind = 'ac' and c.ac then skip := skip || ' ' || c.num || '（冷房あり）'; continue; end if;
    if p_kind = 'heat' and c.heat then skip := skip || ' ' || c.num || '（暖房あり）'; continue; end if;
    if p_kind = 'toilet' and c.toilet then skip := skip || ' ' || c.num || '（トイレあり）'; continue; end if;
    if p_kind = 'toilet' and c.role not in ('Tc', 'T', 'Tp', 'P', 'Dc', 'D') then skip := skip || ' ' || c.num || '（トイレは Tc・T・Tp・客車・気動車に）'; continue; end if;   -- Tp：DB の更新72
    if p_kind = 'snow' and c.snow then skip := skip || ' ' || c.num || '（雪の対策ずみ）'; continue; end if;
    if p_kind = 'snow' and c.role in ('Ship', 'Air') then skip := skip || ' ' || c.num || '（船・飛行機はいりません）'; continue; end if;
    one := case p_kind when 'ac' then 8000000 when 'heat' then 2000000 when 'toilet' then 5000000 when 'inspect' then round(c.tprice * 0.03)
                       when 'renew' then round(c.tprice * 0.3) when 'snow' then case when c.role in ('Bus', 'Truck') then _mp_snowc('bus') else _mp_snowc('car') end end;
    if p_kind = 'snow' then   -- 車庫が雪国なら補助金（国がはらう）
      sb := case when pa.gv then 0 else round(one * _mp_snow_sub(coalesce(c.zn, 0))) end; subs := subs + sb; one := one - sb;
      if c.role in ('Bus', 'Truck') then busn := busn + 1; end if;
    end if;
    if c.role in ('Bus', 'Truck') and p_kind in ('ac', 'toilet') then one := round(one * 0.3); end if;
    cost := cost + one; n := n + 1; ids := ids || c.id;
    if not p_dry then
      update mp_cars set busy_from = now(), busy_until = now() + make_interval(hours => case when p_kind = 'snow' and c.role in ('Bus', 'Truck') then 6 else hrs end), busy_kind = p_kind,
             ac = ac or p_kind = 'ac', heat = heat or p_kind = 'heat', toilet = toilet or p_kind = 'toilet', snow = snow or p_kind = 'snow',
             cond = case when p_kind = 'inspect' then least(100, cond + 35) when p_kind = 'renew' then 100 else cond end,
             renewed = renewed + case when p_kind = 'renew' then 1 else 0 end
       where id = c.id and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    end if;
  end loop;
  if n = 0 then raise exception 'できる車両がありません%', case when skip <> '' then '（' || left(trim(skip), 120) || '）' else '' end; end if;
  if not p_dry then perform _mp_pay(pa.pu, pa.pc, false, cost, case when p_kind = 'snow' then 'snow' else 'car' end,
                                    format(case when (select bool_and(t.role = 'Ship') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '船の%s（%s隻）'
                                                when (select bool_and(t.role = 'Air') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '飛行機の%s（%s機）' else '車両の%s（%s両）' end, label, n)
                                    || case when subs > 0 then format('（補助金 %s X）', _mp_snow_x(subs)) else '' end); end if;
  if not p_dry then perform _mp_subst_plan(pa.pu, pa.pc); end if;   -- 予備編成の代走の予定（DB の更新80）
  return jsonb_build_object('n', n, 'cost', cost, 'hours', case when p_kind = 'snow' and busn = n then 6 else hrs end, 'skip', trim(skip), 'sub', subs,
    -- 工事のあいだに運休になる列車（のべ。DB の更新60）
    'trains', case when p_dry then _mp_form_runs(array(select distinct x.form from mp_cars x where x.id = any(ids) and x.form is not null), now(),
                                                 now() + make_interval(hours => case when p_kind = 'snow' and busn = n then 6 else hrs end)) end,
    -- 予備編成がかわりに走れる編成（DB の更新80）
    'spare', case when p_dry then (select jsonb_agg(f.name order by f.name) from mp_forms f where f.id in (select x.form from mp_cars x where x.id = any(ids) and x.form is not null) and _mp_subst_has(f.id)) end);
end $$;

create or replace function public.mp_car_move(p_cars bigint[], p_depot bigint, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; d mp_depots; nd int; src mp_depots; same boolean; cost bigint := 0; hrs int; c record; n int := 0; have int; forms bigint[];
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if not coalesce(p_dry, false) then   -- 同じ名義の操作は1つずつ・車両をおさえる（DB の更新60）
    perform _mp_lock(pa.pu, pa.pc);
    perform 1 from mp_cars where id = any(p_cars) for update;
  end if;
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_dep_ok(d, pa.pu, pa.pc) then raise exception 'うつす先の車庫をえらんでください（この名義の車庫）'; end if;   -- 国の空港の駐機場も（t54q）
  select count(distinct depot) into nd from mp_cars where id = any(p_cars);
  if nd <> 1 then raise exception '同じ車庫の車両をえらんでください'; end if;
  select x.* into src from mp_depots x where x.id = (select depot from mp_cars where id = p_cars[1]);
  if src.id = d.id then raise exception 'もうその車庫の車両です'; end if;
  if src.kind <> d.kind then raise exception '電車は車両基地、バスは営業所、船は港、飛行機は空港にしか置けません'; end if;
  if d.kind = 'air' and exists (select 1 from mp_cars xc join mp_types xt on xt.code = xc.type where xc.id = any(p_cars) and coalesce(xt.rwy, 0) > coalesce((select xs.plat from mp_stations xs where xs.bld = d.bld and xs.kind = 'air'), 0)) then
    raise exception '「%」の滑走路（%m）では離着陸できない飛行機があります', d.name, (select s.plat from mp_stations s where s.bld = d.bld and s.kind = 'air');   -- t54p
  end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + array_length(p_cars, 1) > d.cap then raise exception 'うつす先の車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  same := d.kind = 'rail' and (select net from mp_segs where id = src.seg) = (select net from mp_segs where id = d.seg);
  hrs := case when d.kind = 'bus' then 2 when d.kind = 'ship' then greatest(3, ceil(sqrt(((d.x - src.x) / 100.0) ^ 2 + ((d.y - src.y) / 100.0) ^ 2) * 0.05 * 1.3 / 25))::int   -- 船：回航（およそ25km/h）
              when d.kind = 'air' then 2   -- 飛行機：回航（飛んでいく。t54p）
              when same then 2 else 12 end;
  for c in select x.*, t.price tprice from mp_cars x join mp_types t on t.code = x.type
            where x.id = any(p_cars) and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc loop
    if c.busy_until > now() then raise exception '%は工事中・納車前です', c.num; end if;
    cost := cost + round(c.tprice * case when d.kind in ('bus', 'ship', 'air') or same then 0.005 else 0.03 end); n := n + 1;
  end loop;
  if n <> array_length(p_cars, 1) then raise exception 'この名義の車両ではないものがあります'; end if;
  if p_dry then return jsonb_build_object('cost', cost, 'hours', hrs,
    'trains', _mp_form_runs(array(select f.id from mp_forms f where f.id in (select x.form from mp_cars x where x.id = any(p_cars) and x.form is not null)
                                    and not exists (select 1 from mp_cars o where o.form = f.id and not (o.id = any(p_cars)))), now(), now() + make_interval(hours => hrs)),   -- 編成ごと動くときの運休（DB の更新60）
    'how', case when d.kind = 'bus' then '回送' when d.kind in ('ship', 'air') then '回航' when same then '回送（線路でつながっています）' else '陸送（線路でつながっていません）' end); end if;
  perform _mp_pay(pa.pu, pa.pc, false, cost, 'car', format(case when d.kind = 'ship' then '%s隻を「%s」へ回航' when d.kind = 'air' then '%s機を「%s」へ回航' else '%s両を「%s」へ転属' end, n, d.name));
  insert into mp_car_hist(car, k, num, type, ou, oc, d)
    select cc.id, 'move', cc.num, cc.type, cc.own_u, cc.own_c, jsonb_build_object('dep', src.name, 'to', d.name, 'how', case when d.kind in ('ship', 'air') then '回航' when same or d.kind = 'bus' then '回送' else '陸送' end)
      from mp_cars cc where cc.id = any(p_cars);
  -- 編成ぜんぶが動くなら編成ごと。一部だけなら、その車は編成から外れる
  forms := array(select distinct form from mp_cars where id = any(p_cars) and form is not null);
  update mp_cars set form = null, pos = 0 where id = any(p_cars) and form is not null
     and exists (select 1 from mp_cars o where o.form = mp_cars.form and not (o.id = any(p_cars)));
  update mp_cars set depot = p_depot, busy_from = now(), busy_until = now() + make_interval(hours => hrs), busy_kind = 'move'
   where id = any(p_cars) and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  update mp_forms f set depot = p_depot where f.id = any(forms) and not exists (select 1 from mp_cars cc where cc.form = f.id and cc.depot <> p_depot);
  perform _mp_form_drop(array(select x from unnest(forms) x where _mp_form_rule(array(select cc.id from mp_cars cc where cc.form = x order by cc.pos)) is not null),
                        '編成が組みかわったので、運用からはずれました');
  delete from mp_forms f where f.id = any(forms) and not exists (select 1 from mp_cars cc where cc.form = f.id);
  perform _mp_subst_plan(pa.pu, pa.pc);   -- 予備編成の代走の予定（DB の更新80）
  return jsonb_build_object('n', n, 'cost', cost, 'hours', hrs);
end $$;

-- 関数の権限：予備・増結・期間はログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_form_key', '_mp_train_runs', '_mp_subst_can', '_mp_subst_pick', '_mp_subst_has', '_mp_subst_ok', '_mp_subst_plan', '_mp_subst_plan_all', '_mp_tmp_back', 'mp_form_spare', 'mp_form_add', 'mp_car_tmp', '_mp_tick_hour', '_mp_tick', 'mp_cars_list', 'mp_dia', 'mp_op_save', 'mp_form_set', 'mp_form_del', 'mp_car_work', 'mp_car_move') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 時刻を組みなおす関数の待ち時間（作りなおすと消えるので、もう一度）。増結・予備・工事・転属も、時刻と代走の予定を見なおすので20秒まで（DB の更新80）
alter function public.mp_form_set(bigint, bigint[], text, text) set statement_timeout = '20s';
alter function public.mp_op_save(bigint, text, bigint, text, text, text) set statement_timeout = '20s';
alter function public.mp_form_add(bigint, bigint[], text, int, text, boolean) set statement_timeout = '20s';
alter function public.mp_form_spare(bigint, boolean, text) set statement_timeout = '20s';
alter function public.mp_car_work(bigint[], text, text, boolean) set statement_timeout = '20s';
alter function public.mp_car_move(bigint[], bigint, text, boolean) set statement_timeout = '20s';
