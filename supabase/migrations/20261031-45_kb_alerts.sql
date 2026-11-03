-- 競馬：レースの予定を5日先まで見られるように。3つまでえらんで、発走の35分前と20分前にお知らせ（🔔）
--   番組（kb_program）を5日先までつくっておく（毎分の処理 ailinax-kb-alert で1日ずつ）。出走馬は、いままでどおり当日に決まる
--   kb_sched(日)・kb_alert_set(日, 番号, つける/はずす)。発走前の通知は1人3つまで。発走から1時間で消す

create table if not exists public.kb_alerts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  no      int not null,
  post    timestamptz not null,
  label   text not null,                        -- お知らせの文（京都 11R 帝都風の芽賞（G1））
  s35     boolean not null default false,       -- 35分前を出した
  s20     boolean not null default false,       -- 20分前を出した
  at      timestamptz not null default now(),
  primary key (user_id, day, no)
);
create index if not exists kb_alerts_post_idx on public.kb_alerts(post);
alter table public.kb_alerts enable row level security;
revoke all on public.kb_alerts from anon, authenticated;

-- 番組を5日先まで（呼び出しごとに1日ずつ。近い日から）
create or replace function public._kb_prog_ahead() returns void
language plpgsql volatile set search_path = public as $$
declare t date := _kb_jday(_now()); i int;
begin
  for i in 1..5 loop
    if not exists (select 1 from kb_program p where p.day = t + i) then
      perform _kb_prog_day(t + i);
      return;
    end if;
  end loop;
end $$;

-- 自分の通知（発走前のもの）
create or replace function public._kb_alerts_json(u uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'no', a.no, 'post_ms', _kb_ms(a.post), 'label', a.label,
           'id', (select r.id from keiba_races r where r.day = a.day and r.no = a.no)) order by a.post), '[]'::jsonb)
    from kb_alerts a where a.user_id = u and a.post > _now()
$$;

-- その日のレース（きょう〜5日後）
create or replace function public.kb_sched(p_day date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); t date := _kb_jday(_now()); d date := coalesce(p_day, _kb_jday(_now()));
begin
  if d < t or d > t + 5 then raise exception '見られるのは、きょうから5日後までです'; end if;
  if not exists (select 1 from kb_program p where p.day = least(t + 5, greatest(d, t + 1))) then
    begin
      perform _kb_prog_ahead();
    exception when others then
      raise warning 'kb prog ahead: %', sqlerrm;
    end;
  end if;
  return jsonb_build_object(
    'now_ms', _kb_ms(_now()), 'day', d, 'today', t, 'max', 3,
    'races', (select coalesce(jsonb_agg(z.j order by z.post, z.no), '[]'::jsonb) from (
        select r.post, r.no, jsonb_build_object('no', r.no, 'id', r.id, 'rnum', r.rnum, 'post_ms', _kb_ms(r.post), 'venue', v.name,
                 'name', r.name, 'grade', r.grade, 'surface', r.surface, 'dist', r.dist, 'status', _kb_status(r),
                 'alert', exists (select 1 from kb_alerts a where a.user_id = u and a.day = d and a.no = r.no)) j
          from keiba_races r join keiba_venues v on v.id = r.venue where r.day = d
        union all
        select p.post, p.no, jsonb_build_object('no', p.no, 'id', null, 'rnum', p.rnum, 'post_ms', _kb_ms(p.post), 'venue', v.name,
                 'name', p.name, 'grade', p.grade, 'surface', p.surface, 'dist', p.dist, 'status', 'plan',
                 'alert', exists (select 1 from kb_alerts a where a.user_id = u and a.day = d and a.no = p.no)) j
          from kb_program p join keiba_venues v on v.id = p.venue
         where p.day = d and not exists (select 1 from keiba_races r where r.day = d and r.no = p.no)) z),
    'alerts', _kb_alerts_json(u));
end $$;

-- 通知をつける・はずす
create or replace function public.kb_alert_set(p_day date, p_no int, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); t date := _kb_jday(_now()); pt timestamptz; lb text;
begin
  if coalesce(p_on, true) then
    if p_day is null or p_day < t or p_day > t + 5 then raise exception '通知をつけられるのは、きょうから5日後までのレースです'; end if;
    select r.post, format('%s %sR %s', v.name, r.rnum, r.name) || coalesce('（' || r.grade || '）', '') into pt, lb
      from keiba_races r join keiba_venues v on v.id = r.venue where r.day = p_day and r.no = p_no;
    if pt is null then
      select p.post, format('%s %sR %s', v.name, p.rnum, p.name) || coalesce('（' || p.grade || '）', '') into pt, lb
        from kb_program p join keiba_venues v on v.id = p.venue where p.day = p_day and p.no = p_no;
    end if;
    if pt is null then raise exception 'そのレースは見つかりません'; end if;
    if pt <= _now() + interval '20 minutes' then raise exception '発走の20分前をすぎたレースには、通知をつけられません'; end if;
    perform pg_advisory_xact_lock(7620, hashtext(u::text));
    if not exists (select 1 from kb_alerts a where a.user_id = u and a.day = p_day and a.no = p_no)
       and (select count(*) from kb_alerts a where a.user_id = u and a.post > _now()) >= 3 then
      raise exception '通知は3つまでです（ほかのレースの通知をはずしてから、つけてください）';
    end if;
    insert into kb_alerts(user_id, day, no, post, label) values (u, p_day, p_no, pt, lb)
    on conflict (user_id, day, no) do update set post = excluded.post, label = excluded.label;
  else
    delete from kb_alerts a where a.user_id = u and a.day = p_day and a.no = p_no;
  end if;
  return jsonb_build_object('alerts', _kb_alerts_json(u), 'max', 3);
end $$;

-- 毎分：35分前・20分前のお知らせ。番組を5日先まで
create or replace function public._kb_alert_tick() returns void
language plpgsql security definer set search_path = public as $$
declare r record; nw timestamptz := _now();
begin
  if not pg_try_advisory_xact_lock(7621) then return; end if;
  -- 20分前（まだ35分前を出していなくても、こちらだけ出す）
  for r in update kb_alerts set s20 = true, s35 = true
            where not s20 and post - interval '20 minutes' <= nw and post > nw
           returning user_id, day, no, post, label loop
    perform _notice_l(r.user_id, format('【競馬】発走まであと%s分：%s（%s 発走）', greatest(1, ceil(extract(epoch from (r.post - nw)) / 60))::int,
                        r.label, to_char(r.post at time zone 'Asia/Tokyo', 'FMHH24:MI')),
                      jsonb_build_object('go', 'race', 'day', r.day, 'no', r.no), null);
  end loop;
  -- 35分前（おくれて2分より前になったら、出さずに印だけ）
  for r in update kb_alerts set s35 = true
            where not s35 and post - interval '35 minutes' <= nw
           returning user_id, day, no, post, label loop
    if nw < r.post - interval '33 minutes' then
      perform _notice_l(r.user_id, format('【競馬】発走まであと%s分：%s（%s 発走）', greatest(1, ceil(extract(epoch from (r.post - nw)) / 60))::int,
                          r.label, to_char(r.post at time zone 'Asia/Tokyo', 'FMHH24:MI')),
                        jsonb_build_object('go', 'race', 'day', r.day, 'no', r.no), null);
    end if;
  end loop;
  delete from kb_alerts where post < nw - interval '1 hour';
  begin
    perform _kb_prog_ahead();
  exception when others then
    raise warning 'kb prog ahead: %', sqlerrm;
  end;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-kb-alert', '* * * * *', 'select public._kb_alert_tick()');
  end if;
end $$;

revoke all on function public._kb_prog_ahead() from public, anon, authenticated;
revoke all on function public._kb_alerts_json(uuid) from public, anon, authenticated;
revoke all on function public._kb_alert_tick() from public, anon, authenticated;
revoke all on function public.kb_sched(date) from public, anon;
grant execute on function public.kb_sched(date) to authenticated;
revoke all on function public.kb_alert_set(date, int, boolean) from public, anon;
grant execute on function public.kb_alert_set(date, int, boolean) to authenticated;

-- 番組を、いま5日先までつくる
select public._kb_prog_ahead(); select public._kb_prog_ahead(); select public._kb_prog_ahead(); select public._kb_prog_ahead(); select public._kb_prog_ahead();
