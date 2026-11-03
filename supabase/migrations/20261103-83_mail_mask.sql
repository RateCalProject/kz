-- 登録者のメールアドレスを、管理者の画面でも伏せ字にする（例 ab•••@g•••.com）。メールでさがすのは、アドレスがまるごと同じときだけ。
--   どうしても見るときは、理由を書いて「メールを表示」（admin_user_email）。表示した記録（日時・管理者・理由）は、その人の画面に出る

create table if not exists public.admin_mail_views (   -- 管理者が登録者のメールアドレスを表示した記録（DB の更新83）
  id     bigserial primary key,
  admin  uuid references public.profiles(id) on delete set null,
  target uuid references public.profiles(id) on delete cascade,
  why    text not null,
  at     timestamptz not null default now()
);
create index if not exists admin_mail_views_target on public.admin_mail_views (target, at desc);
alter table public.admin_mail_views enable row level security;
revoke all on public.admin_mail_views from public, anon, authenticated;
revoke all on sequence public.admin_mail_views_id_seq from public, anon, authenticated;

-- メールアドレスの伏せ字（DB の更新83）：はじめの2文字（短ければ1文字）と、ドメインのはじめの1文字・さいごの「.○○」だけ（例 ab•••@g•••.com）
create or replace function public._mail_mask(e text) returns text
language sql immutable as $$
  select case when e is null or e = '' then e
              when position('@' in e) = 0 then left(e, 1) || '•••'
              else left(split_part(e, '@', 1), case when length(split_part(e, '@', 1)) <= 2 then 1 else 2 end) || '•••@'
                   || left(split_part(e, '@', 2), 1) || '•••'
                   || case when position('.' in split_part(e, '@', 2)) > 0 then '.' || reverse(split_part(reverse(split_part(e, '@', 2)), '.', 1)) else '' end end
$$;
-- 登録者のメールアドレスを表示する（管理者だけ。DB の更新83）：理由（4〜200文字）を書くと表示して、記録にのこす
create or replace function public.admin_user_email(p_uid text, p_why text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); p profiles; w text := btrim(coalesce(p_why, '')); e text;
begin
  if _role(u) is distinct from 'admin' then raise exception 'メールアドレスを見られるのは管理者だけです'; end if;
  if char_length(w) < 4 or char_length(w) > 200 then raise exception '表示する理由を書いてください（4〜200文字。記録にのこります）'; end if;
  select * into p from profiles where account_no = btrim(coalesce(p_uid, ''));
  if not found then raise exception 'その人は見つかりません'; end if;
  select to_jsonb(a) ->> 'email' into e from auth.users a where a.id = p.id;
  insert into admin_mail_views(admin, target, why) values (u, p.id, w);
  return jsonb_build_object('email', e);
end $$;

create or replace function public._user_row(p public.profiles, adm boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('uid', p.account_no, 'nickname', p.nickname, 'badge', _badge(p.id),
    'joined', to_char(p.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'),
    'seen', case when p.last_seen_at is null then null else to_char(p.last_seen_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') end,
    'mail_at', case when p.mail_verified_at is null then null else to_char(p.mail_verified_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD') end,
    'email', case when adm then _mail_mask((select to_jsonb(a)->>'email' from auth.users a where a.id = p.id)) end,   -- 管理者にも伏せ字（DB の更新83。見るときは admin_user_email）
    'banned_until', case when p.banned_until > _now() then to_char(p.banned_until at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') end,
    'debt', case when adm then _debt(p.id) > 0 end,
    'new', _now() < p.created_at + interval '7 days',
    'corps', (select count(*) from companies c where c.owner = p.id and c.status in ('pending', 'active', 'suspended')),
    'guest', (select to_char(_guest_until(g.id) at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') from guests g where g.id = p.id))
$$;

create or replace function public.admin_users(p_q text, p_filter text, p_offset int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); rl text := _role(u); adm boolean := _role(u) = 'admin';
  q text := btrim(coalesce(p_q, '')); f text := coalesce(p_filter, ''); ofs int := greatest(coalesce(p_offset, 0), 0);
  ids uuid[]; n int;
begin
  if rl is distinct from 'admin' then raise exception '登録者の情報は管理者だけが見られます'; end if;
  if f = 'debt' and not adm then raise exception '税の滞納でしぼれるのは管理者だけです'; end if;
  select array_agg(z.id order by z.created_at desc, z.id), count(*) into ids, n from (
    select p.id, p.created_at from profiles p
     where p.ai is null and (q = '' or p.account_no = q or p.nickname ilike '%' || q || '%'
            or (adm and q like '%@%' and exists (select 1 from auth.users a where a.id = p.id and lower(to_jsonb(a)->>'email') = lower(q))))   -- メールは、まるごと同じときだけ（DB の更新83）
       and case f when 'new' then p.created_at > _now() - interval '7 days'
                  when 'banned' then coalesce(p.banned_until > _now(), false)
                  when 'debt' then _debt(p.id) > 0
                  when 'staff' then _role(p.id) is not null
                  when 'guest' then exists (select 1 from guests g where g.id = p.id)
                  else true end) z;
  return jsonb_build_object('total', n, 'more', ofs + 50 < n,
    'items', (select coalesce(jsonb_agg(_user_row(p, adm) order by array_position(ids, p.id)), '[]'::jsonb)
                from profiles p where p.id = any(coalesce(ids[ofs + 1 : ofs + 50], '{}'::uuid[]))),
    'all', (select count(*) from profiles where ai is null),
    'today', (select count(*) from profiles where ai is null and created_at >= (date_trunc('day', _now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')),
    'week', (select count(*) from profiles where ai is null and created_at > _now() - interval '7 days'),
    'active7', (select count(*) from profiles where ai is null and last_seen_at > _now() - interval '7 days'),
    'guests', (select count(*) from guests));
end $$;

create or replace function public.admin_user(p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); rl text := _role(u); adm boolean := _role(u) = 'admin'; p profiles; au jsonb;
begin
  if rl is distinct from 'admin' then raise exception '登録者の情報は管理者だけが見られます'; end if;
  select * into p from profiles where account_no = btrim(coalesce(p_uid, ''));
  if not found then raise exception 'その人は見つかりません'; end if;
  if adm then select to_jsonb(a) into au from auth.users a where a.id = p.id; end if;
  return _user_row(p, adm) || jsonb_build_object(
    'role', _role(p.id),
    'providers', case when adm then coalesce(au->'raw_app_meta_data'->'providers', '[]'::jsonb) end,
    'last_sign_in', case when au->>'last_sign_in_at' is null then null
                         else to_char((au->>'last_sign_in_at')::timestamptz at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') end,
    'mail_ok', p.mail_verified_at is not null and p.mail_verified_at >= _now() - interval '183 days',
    'send_ok', _now() >= coalesce(p.ok7_at, p.created_at + interval '7 days'),
    'debt_amount', case when adm then _debt(p.id) end,
    'evasion', case when adm then (select count(*) from tax_returns where user_id = p.id and evasion) end,
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('cid', c.cid, 'name', c.name, 'kind', c.kind, 'status', _cstat(c.status)) order by c.id), '[]'::jsonb)
                    from companies c where c.owner = p.id and c.status <> 'rejected'),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('cid', c.cid, 'name', c.name, 'role', m.role, 'desk', m.desk) order by m.joined_at), '[]'::jsonb)
               from corp_members m join companies c on c.id = m.company_id where m.user_id = p.id),
    'cases_filed', (select count(*) from court_cases where plaintiff = p.id),
    'cases_against', (select count(*) from court_cases where defendant_user = p.id),
    'friends', (select count(*) from friends where status = 'ok' and (from_user = p.id or to_user = p.id)),
    'posts', (select count(*) from posts where user_id = p.id),
    'pubs', (select count(*) from pubs where author = p.id and status <> 'deleted'),
    'desk', (select count(*) from desk_threads where user_id = p.id),
    'last_play', (select to_char(max(created_at) at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') from tx_log where user_id = p.id),
    -- メールアドレスを表示した記録（新しい10こ。DB の更新83）：[日時, 表示した管理者, 理由]
    'mail_views', case when adm then (select coalesce(jsonb_agg(jsonb_build_array(to_char(v.at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), coalesce(q.nickname, '—'), v.why) order by v.at desc), '[]'::jsonb)
                                       from (select * from admin_mail_views x where x.target = p.id order by x.at desc limit 10) v left join profiles q on q.id = v.admin) end);
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。管理の関数はログインした人（中で管理者だけにしぼる）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mail_mask', 'admin_user_email', '_user_row', 'admin_users', 'admin_user') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
