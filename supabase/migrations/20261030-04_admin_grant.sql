-- 管理：国庫から渡す（2026-10-30・管理者だけ）
--   管理の「国のお金」タブから、人（ID。空なら自分）に X を渡せるようにする
--   「新しく発行して渡す」は国庫の発行額がふえる。「国庫の残高から渡す」は国庫が減る（たりなければ止める）
--   受けとった人には、お知らせと「国庫から支給」の記録が残る。相手の所持金は返さない（所持金は本人だけ）
--   AI・国のアカウントには渡せない（AI会社へは「AI会社」の欄から）

-- 渡す相手を確かめる（名前とIDだけ）
create or replace function public.admin_grant_who(p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); p profiles;
begin
  if coalesce(_role(u), '') <> 'admin' then raise exception '管理者だけが使えます'; end if;
  if nullif(btrim(coalesce(p_uid, '')), '') is null then select * into p from profiles where id = u;
  else select * into p from profiles where account_no = btrim(p_uid); end if;
  if not found then raise exception 'その人は見つかりません'; end if;
  if p.ai is not null then raise exception 'AI・国のアカウントには渡せません'; end if;
  return jsonb_build_object('name', p.nickname, 'uid', p.account_no, 'badge', _badge(p.id), 'self', p.id = u);
end $$;

-- 渡す
create or replace function public.admin_grant(p_uid text, p_amount bigint, p_from text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); p profiles; tr treasury; nt text := left(btrim(coalesce(p_note, '')), 60);
begin
  if coalesce(_role(u), '') <> 'admin' then raise exception '管理者だけが使えます'; end if;
  if nullif(btrim(coalesce(p_uid, '')), '') is null then select * into p from profiles where id = u;
  else select * into p from profiles where account_no = btrim(p_uid); end if;
  if not found then raise exception 'その人は見つかりません'; end if;
  if p.ai is not null then raise exception 'AI・国のアカウントには渡せません'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000000000000 then raise exception '額は1 X〜1000兆 X にしてください'; end if;
  if coalesce(p_from, '') not in ('mint', 'bal') then raise exception 'どこから渡すかをえらんでください'; end if;
  select * into tr from treasury where id = 1 for update;
  if p_from = 'bal' and tr.balance < p_amount then raise exception '国庫の残高がたりません'; end if;
  if p_from = 'mint' then
    update treasury set issued_total = issued_total + p_amount where id = 1;   -- 発行して、そのまま渡す（国庫の残高は変わらない）
  else
    update treasury set balance = balance - p_amount where id = 1;
  end if;
  update profiles set balance = balance + p_amount where id = p.id;
  perform _log(p.id, 'grant', 0, p_amount, jsonb_build_object('note', coalesce(nullif(nt, ''), '国庫から支給'), 'from', p_from));
  perform _notice(p.id, format('国庫から %s X を受けとりました。', to_char(p_amount, 'FM999,999,999,999,999,999'))
                        || case when nt <> '' then format('（%s）', nt) else '' end);
  return jsonb_build_object('ok', true, 'name', p.nickname, 'uid', p.account_no, 'self', p.id = u, 'amount', p_amount, 'from', p_from);
end $$;

revoke all on function public.admin_grant_who(text) from public, anon;
grant execute on function public.admin_grant_who(text) to authenticated;
revoke all on function public.admin_grant(text, bigint, text, text) from public, anon;
grant execute on function public.admin_grant(text, bigint, text, text) to authenticated;
