-- 準備中のゲームを みんなが遊べるようにする：競艇・競輪・競り市・花札こいこい・釣り・馬主（前は管理者だけ）。ほかの準備中のもの（あれば）は そのまま
--   管理 → ゲーム で、ゲームごとに 公開・準備中 を えらべるようにする（admin_beta_get・admin_beta_set）

-- いま準備中のゲームを公開する（app_settings の beta_games から消す。ないときは前の決まりの一覧から）
insert into app_settings(key, value)
  values ('beta_games', array_to_string(array(select y from unnest(_beta_games()) y where y not in ('boat', 'bike', 'auction', 'koikoi', 'fishing', 'owner')), ','))
  on conflict (key) do update set value = excluded.value;

create or replace function public._beta_games() returns text[]
language sql stable set search_path = public as $$
  select array(select x from unnest(string_to_array(replace(coalesce((select value from app_settings where key = 'beta_games'),
                                                                     ''), ' ', ''), ',')) x where x <> '')   -- ないときは、ぜんぶ公開（DB の更新95）
$$;
-- 管理 → ゲーム で えらべる準備中のゲーム（DB の更新95）：[キー, 名前]。競艇と競輪は いっしょ（サーバーは boat で見ている）
create or replace function public._beta_keys() returns jsonb
language sql immutable as $$
  select '[["boat","競艇・競輪"],["auction","競り市"],["koikoi","花札こいこい"],["fishing","釣り"],["owner","馬主"],["map","国土（地図）"]]'::jsonb
$$;
-- ゲームの公開のようす（管理者）
create or replace function public.admin_beta_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me(); b text[] := _beta_games();
begin
  if not _is_admin(u) then raise exception '管理者だけです'; end if;
  return jsonb_build_object('list', to_jsonb(b),
    'games', (select jsonb_agg(jsonb_build_object('k', z.e ->> 0, 'n', z.e ->> 1, 'open', not ((z.e ->> 0) = any(b) or ((z.e ->> 0) = 'boat' and 'bike' = any(b)))) order by z.o)
                from jsonb_array_elements(_beta_keys()) with ordinality z(e, o)));
end $$;
-- 準備中にするゲームを決める（管理者）。p_beta：準備中にするキー（ほかは公開）。一覧にないキー（ほかの準備中のもの）は そのまま
create or replace function public.admin_beta_set(p_beta text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); ks text[] := array(select e ->> 0 from jsonb_array_elements(_beta_keys()) e); nb text[]; x text;
begin
  if not _is_admin(u) then raise exception '管理者だけです'; end if;
  foreach x in array coalesce(p_beta, '{}'::text[]) loop
    if not (x = any(ks) or x = 'bike') then raise exception 'ゲームの名前がちがいます（%）', x; end if;
  end loop;
  nb := array(select distinct y from unnest(coalesce(p_beta, '{}'::text[]) || case when 'boat' = any(coalesce(p_beta, '{}'::text[])) then array['bike'] else '{}'::text[] end) y order by y)
        || array(select y from unnest(_beta_games()) y where not (y = any(ks) or y = 'bike'));
  insert into app_settings(key, value) values ('beta_games', array_to_string(nb, ',')) on conflict (key) do update set value = excluded.value;
  return admin_beta_get();
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。管理の関数は、ログインした人（中で管理者かをしらべる）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_beta_games', '_beta_keys', 'admin_beta_get', 'admin_beta_set') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
