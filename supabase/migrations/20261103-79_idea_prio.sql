-- 意見箱の優先度：管理者と副管理者が、意見箱の意見に 1〜5（1がいちばん先）か「却下」をつける（idea_prio）
--   送った人の「送った意見」と、管理者の受信箱・意見の一覧に「▶︎1」「▶︎副官による却下」のように出る
--   副管理者は意見箱の意見を読める（送った人の名前と ID は出ない。ほかの問い合わせは見えない。返事・解決済みは管理者だけ）
--   自分が送った意見にはつけられない。管理者がつけた優先度は、副管理者は変えられない
--   意見の一覧（管理者・副管理者）：idea_inbox

alter table public.support_threads add column if not exists prio smallint check (prio between 0 and 5);   -- 意見箱の優先度：1〜5（1がいちばん先）・0 は却下・null はまだ（DB の更新79）
alter table public.support_threads add column if not exists prio_role text check (prio_role in ('admin', 'sub'));   -- 優先度をつけた人の役割（つけたとき）
alter table public.support_threads add column if not exists prio_by uuid references public.profiles(id) on delete set null;   -- 優先度をつけた人
alter table public.support_threads add column if not exists prio_at timestamptz;

-- 問い合わせの一覧の1行（side = user：本人から見る／staff：管理者から見る／sub：副管理者から見る。意見箱の意見だけ）
create or replace function public._sp_json(t public.support_threads, side text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', t.id, 'subject', t.subject, 'status', t.status, 'closed_by', t.closed_by,
    'user', case when side = 'staff' then jsonb_build_object('nickname', p.nickname, 'uid', p.account_no, 'badge', _badge(p.id)) end,
    'unread', side <> 'sub' and exists (select 1 from support_msgs m where m.thread_id = t.id and m.from_staff = (side = 'user')
                        and m.id > case when side = 'user' then t.user_seen else t.staff_seen end),
    'last', (select left(m.body, 60) from support_msgs m where m.thread_id = t.id order by m.id desc limit 1),
    'n', (select count(*) from support_msgs m where m.thread_id = t.id),
    -- 意見箱の優先度（DB の更新79）：1〜5（1がいちばん先）・0 は却下・null はまだ。prio_by はつけた人の役割（admin / sub）
    'prio', t.prio, 'prio_by', t.prio_role,
    'prio_who', case when side = 'staff' then (select q.nickname from profiles q where q.id = t.prio_by) end,
    'at', _dlabel(t.last_at), 'time', to_char(t.last_at at time zone 'Asia/Tokyo', 'HH24:MI'))
  from profiles p where p.id = t.user_id
$$;

-- 問い合わせのやりとり（開くと既読）。副管理者は、意見箱の意見だけ読める（DB の更新79）
create or replace function public.support_thread(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); t support_threads; side text; mx bigint;
begin
  select * into t from support_threads where id = p_id;
  if not found then raise exception '問い合わせが見つかりません'; end if;
  side := case when t.user_id = u then 'user' when _is_admin(u) then 'staff'
               when t.subject like '【意見箱】%' and _role(u) = 'sub' then 'sub' end;   -- 副管理者は意見箱の意見だけ（DB の更新79）
  if side is null then raise exception '問い合わせが見つかりません'; end if;
  select max(id) into mx from support_msgs where thread_id = t.id;
  if side = 'user' and coalesce(mx, 0) > t.user_seen then update support_threads set user_seen = mx where id = t.id;
  elsif side = 'staff' and coalesce(mx, 0) > t.staff_seen then update support_threads set staff_seen = mx where id = t.id; end if;
  select * into t from support_threads where id = p_id;
  return _sp_json(t, side) || jsonb_build_object('side', side, 'can_send', t.status = 'open' and side <> 'sub',
    'can_prio', side in ('staff', 'sub') and t.subject like '【意見箱】%' and not (side = 'sub' and coalesce(t.prio_role, '') = 'admin'),
    'msgs', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'staff', m.from_staff, 'body', m.body,
               'who', case when side = 'staff' and m.from_staff then (select nickname from profiles where id = m.author) end,
               'mine', m.author = u, 'at', _dlabel(m.created_at), 'time', to_char(m.created_at at time zone 'Asia/Tokyo', 'HH24:MI')) order by m.id), '[]'::jsonb)
             from support_msgs m where m.thread_id = t.id));
end $$;

-- 意見箱の意見の一覧（管理者・副管理者だけ）。新しい300件（受付中が先）。副管理者には、送った人を出さない（DB の更新79）
create or replace function public.idea_inbox() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r text := _role(u);
begin
  if r is null then raise exception '意見箱の意見を見られるのは、管理者と副管理者だけです'; end if;
  return jsonb_build_object('role', r,
    'ideas', (select coalesce(jsonb_agg(_sp_json(t, case when r = 'admin' then 'staff' else 'sub' end)
                 || jsonb_build_object('mine', t.user_id = u, 'can_prio', t.user_id <> u and not (r = 'sub' and coalesce(t.prio_role, '') = 'admin'))
                 order by (t.status = 'open') desc, t.last_at desc), '[]'::jsonb)
              from (select * from support_threads where subject like '【意見箱】%' order by (status = 'open') desc, last_at desc limit 300) t));
end $$;

-- 意見箱の優先度をつける（管理者・副管理者）。p_prio：1〜5（1がいちばん先）・0 は却下・null はなしにもどす（DB の更新79）
--   自分が送った意見にはつけられない。管理者がつけた優先度は、副管理者は変えられない。送った人の「送った意見」にも出る
create or replace function public.idea_prio(p_id bigint, p_prio int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); r text := _role(u); t support_threads;
begin
  if r is null then raise exception '優先度をつけられるのは、管理者と副管理者だけです'; end if;
  if p_prio is not null and (p_prio < 0 or p_prio > 5) then raise exception '優先度は 1〜5 か「却下」です'; end if;
  select * into t from support_threads where id = p_id and subject like '【意見箱】%' for update;
  if not found then raise exception '意見が見つかりません'; end if;
  if t.user_id = u then raise exception '自分が送った意見には、優先度をつけられません'; end if;
  if r = 'sub' and coalesce(t.prio_role, '') = 'admin' then raise exception '管理者がつけた優先度は、副管理者は変えられません'; end if;
  update support_threads set prio = p_prio, prio_role = case when p_prio is null then null else r end,
         prio_by = case when p_prio is null then null else u end, prio_at = case when p_prio is null then null else _now() end
   where id = t.id;
  return support_thread(t.id);
end $$;

-- 関数の権限：一覧と優先度はログインした人（中で管理者・副管理者だけにしぼる）。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_sp_json', 'support_thread', 'idea_inbox', 'idea_prio') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
