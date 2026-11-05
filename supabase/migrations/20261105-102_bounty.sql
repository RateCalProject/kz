-- 報告のお礼：運営への問い合わせに 種類（ふつう・エラー（不具合）の報告・セキュリティの報告）をえらべる
--   エラー・セキュリティの報告で、管理者が重要・貴重と判断したら、国庫から本人へ お礼を贈る（エラー 4,000〜160,000 X・セキュリティ 4,000〜2,560,000 X）
--   1件に1回。税金（所得）にはしない。やりとりに のこり、本人に通知が届く

-- 問い合わせの種類（q ふつう・bug エラー（不具合）の報告・sec セキュリティの報告）と、報告のお礼（DB の更新102）
alter table public.support_threads add column if not exists kind text not null default 'q' check (kind in ('q', 'bug', 'sec'));
alter table public.support_threads add column if not exists reward bigint check (reward between 4000 and 2560000);   -- 贈ったお礼（X）。null はまだ
alter table public.support_threads add column if not exists reward_at timestamptz;
alter table public.support_threads add column if not exists reward_by uuid references public.profiles(id) on delete set null;   -- 贈った管理者
alter table public.treasury add column if not exists bounty_total bigint not null default 0;   -- 報告のお礼（累計）

-- 報告のお礼の はんい（X）：エラー（不具合）の報告は 4,000〜160,000、セキュリティの報告は 4,000〜2,560,000（DB の更新102）
create or replace function public._sp_bounty() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('min', 4000, 'bug', 160000, 'sec', 2560000)
$$;

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
    -- 種類（q ふつう・bug エラーの報告・sec セキュリティの報告）と、贈った お礼（DB の更新102）
    'kind', t.kind, 'reward', t.reward, 'reward_at', case when t.reward_at is not null then _dlabel(t.reward_at) end,
    'prio_who', case when side = 'staff' then (select q.nickname from profiles q where q.id = t.prio_by) end,
    'at', _dlabel(t.last_at), 'time', to_char(t.last_at at time zone 'Asia/Tokyo', 'HH24:MI'))
  from profiles p where p.id = t.user_id
$$;

create or replace function public.support_list() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); adm boolean := _is_admin(u);
begin
  return jsonb_build_object('admin', adm, 'kinds', true, 'bounty', _sp_bounty(),   -- 種類をえらべる・お礼の はんい（DB の更新102）
    'threads', (select coalesce(jsonb_agg(_sp_json(t, 'user') order by (t.status = 'open') desc, t.last_at desc), '[]'::jsonb)
                  from (select * from support_threads where user_id = u order by (status = 'open') desc, last_at desc limit 50) t),
    'inbox', case when adm then (select coalesce(jsonb_agg(_sp_json(t, 'staff') order by (t.status = 'open') desc, t.last_at desc), '[]'::jsonb)
                  from (select * from support_threads order by (status = 'open') desc, last_at desc limit 100) t) end);
end $$;

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
    'can_reward', side = 'staff' and t.reward is null and t.user_id <> u and not _is_guest(t.user_id), 'bounty', _sp_bounty(),   -- 報告のお礼（管理者。DB の更新102）
    'msgs', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'staff', m.from_staff, 'body', m.body,
               'who', case when side = 'staff' and m.from_staff then (select nickname from profiles where id = m.author) end,
               'mine', m.author = u, 'at', _dlabel(m.created_at), 'time', to_char(m.created_at at time zone 'Asia/Tokyo', 'HH24:MI')) order by m.id), '[]'::jsonb)
             from support_msgs m where m.thread_id = t.id));
end $$;

drop function if exists public.support_open(text, text);   -- 種類（p_kind）を足したので（DB の更新102）
create or replace function public.support_open(p_subject text, p_body text, p_kind text default 'q') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); me profiles; tid bigint; mid bigint; who uuid;
  sj text := btrim(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:]]', ' ', 'g')); bd text := btrim(coalesce(p_body, ''));
  kd text := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'q');   -- 種類：q ふつう・bug エラーの報告・sec セキュリティの報告（DB の更新102）
begin
  sj := btrim(regexp_replace(sj, '^【意見箱】', ''));   -- 意見箱は idea_send で（数えかたがちがうので）
  if char_length(sj) < 1 or char_length(sj) > 40 then raise exception '件名は1〜40文字です'; end if;
  if char_length(bd) < 1 or char_length(bd) > 2000 then raise exception '内容は1〜2000文字です'; end if;
  if kd not in ('q', 'bug', 'sec') then raise exception '問い合わせの種類がちがいます'; end if;
  perform pg_advisory_xact_lock(7310, hashtext(u::text));
  if (select count(*) from support_threads where user_id = u and status = 'open' and subject not like '【意見箱】%') >= 3 then
    raise exception '受付中の問い合わせは3件までです（解決済みにすると、新しく問い合わせられます）';
  end if;
  if (select count(*) from support_threads where user_id = u and created_at > _now() - interval '1 day' and subject not like '【意見箱】%') >= 5 then
    raise exception '新しい問い合わせは1日5件までです';
  end if;
  select * into me from profiles where id = u;
  insert into support_threads(user_id, subject, kind, last_at, created_at) values (u, sj, kd, _now(), _now()) returning id into tid;
  insert into support_msgs(thread_id, from_staff, author, body, created_at) values (tid, false, u, bd, _now()) returning id into mid;
  update support_threads set user_seen = mid where id = tid;
  for who in select * from _admin_ids() loop
    continue when who = u;
    perform _notice_l(who, case kd when 'bug' then format('【問い合わせ】%s さん（ID %s）からエラーの報告が届きました：%s', me.nickname, me.account_no, sj)
                                   when 'sec' then format('【問い合わせ】%s さん（ID %s）からセキュリティの報告が届きました：%s', me.nickname, me.account_no, sj)
                                   else format('【問い合わせ】%s さん（ID %s）から問い合わせが届きました：%s', me.nickname, me.account_no, sj) end,
                      jsonb_build_object('go', 'sp', 't', tid), u);
  end loop;
  return support_thread(tid);
end $$;

-- 報告のお礼を贈る（管理者だけ。DB の更新102）：エラー（不具合）・セキュリティの報告で、重要・貴重と判断したとき。
--   p_kind：bug エラーの報告（4,000〜160,000 X）・sec セキュリティの報告（4,000〜2,560,000 X）。国庫から本人へ。1件に1回。税金（所得）にはしない
--   やりとりに「報告のお礼」が のこり、本人に通知が届く。問い合わせの種類も、えらんだものにする
create or replace function public.support_reward(p_id bigint, p_kind text, p_amt bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); t support_threads; bt jsonb := _sp_bounty(); mn bigint; mx bigint; mid bigint; lbl text; amt text;
begin
  if not _is_admin(u) then raise exception '管理者だけが使えます'; end if;
  if coalesce(p_kind, '') not in ('bug', 'sec') then raise exception 'お礼の種類をえらんでください（エラー・セキュリティ）'; end if;
  mn := (bt ->> 'min')::bigint; mx := (bt ->> p_kind)::bigint;
  if p_amt is null or p_amt < mn or p_amt > mx then
    raise exception 'お礼は % X から % X までです', to_char(mn, 'FM9,999,999'), to_char(mx, 'FM9,999,999');
  end if;
  select * into t from support_threads where id = p_id for update;
  if not found then raise exception '問い合わせが見つかりません'; end if;
  if t.reward is not null then raise exception 'この報告には、もうお礼を贈りました'; end if;
  if t.user_id = u then raise exception '自分の報告には贈れません'; end if;
  if _is_guest(t.user_id) then raise exception 'ゲストには贈れません（本登録した人だけです）'; end if;
  update treasury set balance = balance - p_amt, bounty_total = bounty_total + p_amt where id = 1 and balance >= p_amt;
  if not found then raise exception '国庫のお金が足りません'; end if;
  perform _give(t.user_id, p_amt);
  perform _log(t.user_id, 'bounty', 0, p_amt, jsonb_build_object('thread', t.id, 'kind', p_kind));   -- 税金（所得）には入れない（_income の種類にない）
  lbl := case p_kind when 'sec' then 'セキュリティの報告' else 'エラーの報告' end; amt := to_char(p_amt, 'FM9,999,999');
  insert into support_msgs(thread_id, from_staff, author, body, created_at)
  values (t.id, true, u, format('【報告のお礼】%sへのお礼として、%s X を贈りました。ありがとうございました（税金はかかりません）', lbl, amt), _now()) returning id into mid;
  update support_threads set kind = p_kind, reward = p_amt, reward_at = _now(), reward_by = u, last_at = _now(), staff_seen = mid where id = t.id;
  perform _notice_l(t.user_id, format('【問い合わせ】報告のお礼として %s X が届きました：%s', amt, t.subject), jsonb_build_object('go', 'sp', 't', t.id), null);
  return support_thread(t.id);
end $$;


revoke all on function public._sp_bounty() from public, anon, authenticated;
revoke all on function public.support_open(text, text, text) from public, anon;
grant execute on function public.support_open(text, text, text) to authenticated;
revoke all on function public.support_reward(bigint, text, bigint) from public, anon;
grant execute on function public.support_reward(bigint, text, bigint) to authenticated;
