-- 人をさがす（people_search）：同じ名前の人を見分けやすくする（送金・請求・訴えで、ニックネームから相手のIDをえらぶため）。
--   はじめた月（人のページと同じ）と、名前がまるごと同じか を返す。名前がまるごと同じ人を先に。全角・半角、大文字・小文字は同じとみる

create or replace function public.people_search(p_q text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); q text := btrim(coalesce(p_q, '')); lk text; nq text;
begin
  if q = '' then   -- 何も入れないとき：フレンド
    return (select coalesce(jsonb_agg(_person_card(p, u) || jsonb_build_object('since', to_char(p.created_at at time zone 'Asia/Tokyo', 'YYYY"年"FMMM"月"')) order by p.nickname), '[]'::jsonb) from (
              select * from profiles p where _is_friend(u, p.id) order by p.nickname limit 50) p);
  end if;
  q := ltrim(q, '@');
  -- 全角・半角、大文字・小文字は同じとみる（DB の更新96）
  nq := lower(normalize(q, NFKC));
  lk := '%' || replace(replace(replace(nq, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- 名前がまるごと同じ人を先に（同じ名前の人が何人いても、30人の中に入る）。since：はじめた月・same：名前がまるごと同じ（同じ名前の人を見分ける。DB の更新96）
  return (select coalesce(jsonb_agg(_person_card(z.pr, u) || jsonb_build_object('since', to_char((z.pr).created_at at time zone 'Asia/Tokyo', 'YYYY"年"FMMM"月"'), 'same', z.sm)
                                    order by ((z.pr).account_no = q) desc, z.sm desc, _is_friend(u, (z.pr).id) desc, (z.pr).nickname, (z.pr).account_no), '[]'::jsonb) from (
            select x pr, lower(normalize(x.nickname, NFKC)) = nq sm from profiles x
             where (x.account_no = q or lower(normalize(x.nickname, NFKC)) like lk) and x.ai is null and not _is_guest(x.id)
             order by (x.account_no = q) desc, (lower(normalize(x.nickname, NFKC)) = nq) desc, x.nickname, x.account_no limit 30) z);
end $$;

-- 関数の権限：ログインした人（ゲストもさがせる。ゲストは一覧に出ない）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'people_search' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
