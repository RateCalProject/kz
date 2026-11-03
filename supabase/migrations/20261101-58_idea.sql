-- 意見箱を送りやすく：ゲストも送れる（1日3件まで）・本登録の人は1日10件まで。意見箱は「運営への問い合わせ」の受付中3件・1日5件に数えない。
--   ひとことだけ・くわしくだけでも送れる。ゲストも、自分の意見箱の返事に書きこめる・解決済みにできる

-- 意見箱に送る（役所 → 意見箱）。p_kind：提案・使いにくい・不具合・その他。p_sub ひとこと（28文字まで）・p_body くわしく（2000文字まで）。どちらかがあればよい
create or replace function public.idea_send(p_kind text, p_sub text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); g boolean; me profiles; tid bigint; mid bigint; who uuid; k text; lim int;
  sj text := btrim(regexp_replace(coalesce(p_sub, ''), '[[:cntrl:]]', ' ', 'g')); bd text := btrim(coalesce(p_body, ''));
begin
  if u is null then raise exception 'ログインしてください'; end if;
  g := _is_guest(u);
  k := case when p_kind in ('提案', '使いにくい', '不具合', 'その他') then p_kind else 'その他' end;
  if sj = '' and bd = '' then raise exception '意見を書いてください'; end if;
  if sj = '' then sj := btrim(left(regexp_replace(bd, '\s+', ' ', 'g'), 28)); end if;
  sj := left(sj, 28);
  if bd = '' then bd := sj; end if;
  if char_length(bd) > 2000 then raise exception 'くわしくは2000文字までです'; end if;
  perform pg_advisory_xact_lock(7310, hashtext(u::text));
  lim := case when g then 3 else 10 end;
  if (select count(*) from support_threads where user_id = u and subject like '【意見箱】%' and created_at > _now() - interval '1 day') >= lim then
    raise exception '意見箱は1日%件までです（あしたまた送ってください）', lim;
  end if;
  if g and (select count(*) from support_threads t join guests q on q.id = t.user_id where t.subject like '【意見箱】%' and t.created_at > _now() - interval '1 hour') >= 30 then
    raise exception 'いま意見箱が混みあっています（少し時間をおいてから送ってください）';
  end if;
  select * into me from profiles where id = u;
  insert into support_threads(user_id, subject, last_at, created_at) values (u, left('【意見箱】' || k || '：' || sj, 40), _now(), _now()) returning id into tid;
  insert into support_msgs(thread_id, from_staff, author, body, created_at) values (tid, false, u, bd, _now()) returning id into mid;
  update support_threads set user_seen = mid where id = tid;
  for who in select * from _admin_ids() loop
    continue when who = u;
    perform _notice_l(who, format('【意見箱】%s さん（ID %s%s）から意見が届きました：%s', coalesce(me.nickname, 'ゲスト'), coalesce(me.account_no::text, '—'), case when g then '・ゲスト' else '' end, k || '：' || sj),
                      jsonb_build_object('go', 'sp', 't', tid), u);
  end loop;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;
revoke all on function public.idea_send(text, text, text) from public, anon;
grant execute on function public.idea_send(text, text, text) to authenticated;

-- 問い合わせる（受付中は3件まで・新しいものは1日5件まで。意見箱は数えない）
create or replace function public.support_open(p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); me profiles; tid bigint; mid bigint; who uuid;
  sj text := btrim(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:]]', ' ', 'g')); bd text := btrim(coalesce(p_body, ''));
begin
  sj := btrim(regexp_replace(sj, '^【意見箱】', ''));   -- 意見箱は idea_send で（数えかたがちがうので）
  if char_length(sj) < 1 or char_length(sj) > 40 then raise exception '件名は1〜40文字です'; end if;
  if char_length(bd) < 1 or char_length(bd) > 2000 then raise exception '内容は1〜2000文字です'; end if;
  perform pg_advisory_xact_lock(7310, hashtext(u::text));
  if (select count(*) from support_threads where user_id = u and status = 'open' and subject not like '【意見箱】%') >= 3 then
    raise exception '受付中の問い合わせは3件までです（解決済みにすると、新しく問い合わせられます）';
  end if;
  if (select count(*) from support_threads where user_id = u and created_at > _now() - interval '1 day' and subject not like '【意見箱】%') >= 5 then
    raise exception '新しい問い合わせは1日5件までです';
  end if;
  select * into me from profiles where id = u;
  insert into support_threads(user_id, subject, last_at, created_at) values (u, sj, _now(), _now()) returning id into tid;
  insert into support_msgs(thread_id, from_staff, author, body, created_at) values (tid, false, u, bd, _now()) returning id into mid;
  update support_threads set user_seen = mid where id = tid;
  for who in select * from _admin_ids() loop
    continue when who = u;
    perform _notice_l(who, format('【問い合わせ】%s さん（ID %s）から問い合わせが届きました：%s', me.nickname, me.account_no, sj),
                      jsonb_build_object('go', 'sp', 't', tid), u);
  end loop;
  return support_thread(tid);
end $$;

-- 返事を書く（本人も管理者も）。ゲストは、自分の意見箱にだけ書ける
create or replace function public.support_send(p_id bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); t support_threads; side text; me profiles; mid bigint; who uuid; quiet boolean; bd text := btrim(coalesce(p_body, ''));
begin
  select * into t from support_threads where id = p_id for update;
  if not found then raise exception '問い合わせが見つかりません'; end if;
  if _is_guest(u) and not (t.user_id = u and t.subject like '【意見箱】%') then perform _me(); end if;   -- ゲストではできません（本登録すると使えます）
  side := case when t.user_id = u then 'user' when _is_admin(u) then 'staff' end;
  if side is null then raise exception '問い合わせが見つかりません'; end if;
  if t.status <> 'open' then raise exception 'この問い合わせは解決済みです（つづきは新しく問い合わせてください）'; end if;
  if char_length(bd) < 1 or char_length(bd) > 2000 then raise exception '内容は1〜2000文字です'; end if;
  if (select count(*) from support_msgs where thread_id = t.id) >= 300 then raise exception 'この問い合わせはやりとりが多くなりました（つづきは新しく問い合わせてください）'; end if;
  if (select count(*) from support_msgs where author = u and created_at > _now() - interval '1 hour') >= 60 then
    raise exception '少し時間をおいてください（1時間に60通まで）';
  end if;
  quiet := exists (select 1 from support_msgs m where m.thread_id = t.id and m.from_staff = (side = 'staff')
                     and m.id > case when side = 'staff' then t.user_seen else t.staff_seen end);
  insert into support_msgs(thread_id, from_staff, author, body, created_at) values (t.id, side = 'staff', u, bd, _now()) returning id into mid;
  update support_threads set last_at = _now(),
         user_seen = case when side = 'user' then mid else user_seen end,
         staff_seen = case when side = 'staff' then mid else staff_seen end
   where id = t.id;
  if quiet then
    null;
  elsif side = 'staff' then
    perform _notice_l(t.user_id, format('【問い合わせ】運営から返事が届きました：%s', t.subject), jsonb_build_object('go', 'sp', 't', t.id), null);
  else
    select * into me from profiles where id = u;
    for who in select * from _admin_ids() loop
      continue when who = u;
      perform _notice_l(who, format('【問い合わせ】%s さんから、問い合わせ「%s」に返事が届きました', me.nickname, t.subject), jsonb_build_object('go', 'sp', 't', t.id), u);
    end loop;
  end if;
  return support_thread(t.id);
end $$;

-- 解決済みにする（どちらからでも）。ゲストは、自分の意見箱だけ
create or replace function public.support_close(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); t support_threads; side text;
begin
  select * into t from support_threads where id = p_id for update;
  if not found then raise exception '問い合わせが見つかりません'; end if;
  if _is_guest(u) and not (t.user_id = u and t.subject like '【意見箱】%') then perform _me(); end if;
  side := case when t.user_id = u then 'user' when _is_admin(u) then 'staff' end;
  if side is null then raise exception '問い合わせが見つかりません'; end if;
  if t.status <> 'open' then raise exception 'この問い合わせはもう解決済みです'; end if;
  update support_threads set status = 'closed', closed_by = side where id = t.id;
  if side = 'staff' then
    perform _notice_l(t.user_id, format('【問い合わせ】問い合わせ「%s」は、運営が解決済みにしました', t.subject), jsonb_build_object('go', 'sp', 't', t.id), null);
  end if;
  return support_thread(t.id);
end $$;
