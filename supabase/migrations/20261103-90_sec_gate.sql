-- セキュリティ：攻撃をすぐ止める「見はり」（API を呼ぶたびに1回。PostgREST の db_pre_request）・止める（人・回線・ぜんぶ）・管理者の画面（管理 → セキュリティ）
--   止めている人・回線は 403。ぜんぶ止める（メンテナンス）のときは、管理者だけ使える
--   1分に とても多く呼ぶ人・回線、重い操作（時刻の組みなおしなど）を とても多く呼ぶ人は、自動で止める（10分・2回目 1時間・3回目から 24時間）。管理者に知らせる
--   見はりの中でエラーになったときは、止めない（ふつうに通す）
-- 念のため：ログインなしで呼べる関数は、ゲストをはじめるのと見はりだけにする（いくつかの更新で、ログインなしでも呼べる関数がのこっていた。中で止めていたので害はなし）
-- バージョン：サーバーに入っている DB の更新の番号（app_ver。画面の 設定 → プロフィール に出す）

create table if not exists public.sec_blocks (   -- 止めている人・回線（k：'u:' || 人の id・'ip:' || 回線・'*' ぜんぶ）。DB の更新90
  k      text primary key,
  until  timestamptz not null,
  reason text not null default '',
  auto   boolean not null default false,       -- 見はりが自動で止めた
  by_u   uuid,                                 -- 止めた管理者
  n      int not null default 1,               -- 24時間のうちに自動で止めた回数
  at     timestamptz not null default now()
);
create unlogged table if not exists public.sec_hits (   -- API の呼び出し（1回1行。10分ほどで消す。k：'u:' || 人・'ip:' || 回線。h：重い操作）
  k  text not null,
  at timestamptz not null default now(),
  h  boolean not null default false
);
create index if not exists sec_hits_k on public.sec_hits (k, at);
create table if not exists public.sec_log (   -- 止めた・解除した・ぜんぶ止めた の記録
  id   bigserial primary key,
  at   timestamptz not null default now(),
  k    text not null,
  ev   text not null,                          -- auto 自動で止めた・block 管理者が止めた・unblock 解除
  note text not null default ''
);
alter table public.sec_blocks enable row level security;
alter table public.sec_hits enable row level security;
alter table public.sec_log enable row level security;
revoke all on public.sec_blocks, public.sec_hits, public.sec_log from public, anon, authenticated;
revoke all on sequence public.sec_log_id_seq from public, anon, authenticated;

-- 見はりの決まり：1分に 人 2400回・回線 6000回・重い操作（時刻の組みなおしなど、時間の制限をのばした関数）60回。
--   app_settings 'sec_limits' に {"u": 3000, "ip": 8000, "h": 80} のように書くと変えられる
create or replace function public._sec_lim(p text) returns int
language plpgsql stable set search_path = public as $$
declare v int;
begin
  begin v := (select (nullif(value, '')::jsonb ->> p)::int from app_settings where key = 'sec_limits'); exception when others then v := null; end;
  return coalesce(v, case p when 'u' then 2400 when 'ip' then 6000 when 'h' then 60 else 1000000 end);
end $$;
-- 止めたもののことば（管理者の画面・知らせ用）
create or replace function public._sec_label(p_k text) returns text
language sql stable set search_path = public as $$
  select case when p_k = '*' then 'ぜんぶ（メンテナンス）'
              when p_k like 'u:%' then coalesce((select format('%s（ID %s）', p.nickname, p.account_no) from profiles p
                                                  where p.id = case when substr(p_k, 3) ~ '^[0-9a-f-]{36}$' then substr(p_k, 3)::uuid end), 'ID のない人')
              when p_k like 'ip:%' then '回線 ' || substr(p_k, 4) else p_k end
$$;
-- 管理者に知らせる（🔔）
create or replace function public._sec_tell(t text) returns void
language sql set search_path = public as $$
  select _notice_l(btrim(x)::uuid, '【セキュリティ】' || t, jsonb_build_object('go', 'sec'), null)
    from app_settings s, unnest(string_to_array(s.value, ',')) x where s.key = 'admins' and btrim(x) ~ '^[0-9a-f-]{36}$'
$$;
-- 自動で止める：1回目 10分・24時間のうちの2回目 1時間・3回目から 24時間。管理者に知らせる。止めた長さのことばを返す
create or replace function public._sec_auto(p_k text, p_why text) returns text
language plpgsql set search_path = public as $$
declare b sec_blocks; nn int := 1; d interval; dt text;
begin
  select * into b from sec_blocks x where x.k = p_k;
  if found and b.auto and b.at > now() - interval '24 hours' then nn := b.n + 1; end if;
  d := case when nn >= 3 then interval '24 hours' when nn = 2 then interval '1 hour' else interval '10 minutes' end;
  dt := case when nn >= 3 then '24時間' when nn = 2 then '1時間' else '10分' end;
  insert into sec_blocks as x(k, until, reason, auto, n, at) values (p_k, now() + d, p_why, true, nn, now())
    on conflict (k) do update set until = greatest(x.until, excluded.until), reason = excluded.reason, auto = true, n = excluded.n, at = now(), by_u = null;
  insert into sec_log(k, ev, note) values (p_k, 'auto', format('%s止めました（%s）', dt, p_why));
  if (select count(*) from sec_log l where l.ev = 'auto' and l.at > now() - interval '10 minutes') <= 5 then   -- 知らせは10分に5回まで（たくさんの回線からのとき）
    perform _sec_tell(format('%s を%s止めました（%s）。管理 → セキュリティ で解除できます', _sec_label(p_k), dt, p_why));
  end if;
  return dt;
end $$;
-- 見はり（PostgREST の db_pre_request：API を呼ぶたびに、本体の前に1回）
--   1. 止めている人・回線（管理者はとおす）、ぜんぶ止めているとき（メンテナンス。管理者だけとおす）は 403
--   2. 呼び出しを数える（書きこめる呼び出しだけ）。1分に多すぎる人・回線は、自動で止める（その呼び出しはとおし、つぎから 403）
--   見はりの中でエラーになったときは、止めない（ふつうに通す）
create or replace function public.sec_gate() returns void
language plpgsql security definer set search_path = public as $$
declare cl jsonb; sub text; ip text; pth text; b sec_blocks; nu int := 0; hu int := 0; ni int := 0; hv boolean := false; msg text; adm boolean;
begin
  begin
    cl := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    if cl ->> 'role' = 'service_role' then return; end if;
    sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), cl ->> 'sub');   -- auth.uid() と同じ
    sub := case when sub ~ '^[0-9a-f-]{36}$' then sub end;
    ip := _req_ip();
    pth := coalesce(current_setting('request.path', true), '');
    -- 1. 止めているもの（人・回線を先に見る）
    select x.* into b from sec_blocks x where x.k in ('*', 'u:' || coalesce(sub, '-'), 'ip:' || coalesce(ip, '-')) and x.until > now()
     order by (x.k = '*'), x.until desc limit 1;
    if found then
      adm := sub is not null and _is_admin(sub::uuid);
      if not adm then
        msg := case when b.k = '*' then 'ただいまメンテナンス中です。しばらくしてから、もう一度ためしてください'
                    else format('この操作は、いまできません%s%s', case when b.until < now() + interval '5 years' then '（' || to_char(b.until at time zone 'Asia/Tokyo', 'FMMM"月"FMDD"日" HH24:MI') || ' まで）' else '' end,
                                case when b.auto then '。短いあいだに とても多くの操作がありました' else '' end) end;
      end if;
    end if;
    -- 2. 数える（読むだけの呼び出しは数えない）
    if msg is null and current_setting('transaction_read_only', true) = 'off' then
      hv := pth like '/rpc/%' and exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = substr(pth, 6)
                                              and array_to_string(p.proconfig, ',') like '%statement_timeout%');
      if sub is not null then
        insert into sec_hits(k, h) values ('u:' || sub, hv);
        select count(*), count(*) filter (where x.h) into nu, hu from sec_hits x where x.k = 'u:' || sub and x.at > now() - interval '1 minute';
      end if;
      if ip is not null then
        insert into sec_hits(k) values ('ip:' || ip);
        select count(*) into ni from sec_hits x where x.k = 'ip:' || ip and x.at > now() - interval '1 minute';
      end if;
      if nu > _sec_lim('u') or hu > _sec_lim('h') or ni > _sec_lim('ip') then
        adm := coalesce(adm, sub is not null and _is_admin(sub::uuid));
        if not adm then
          if hu > _sec_lim('h') then perform _sec_auto('u:' || sub, format('重い操作が1分に %s回', hu));
          elsif nu > _sec_lim('u') then perform _sec_auto('u:' || sub, format('1分に %s回', nu));
          else perform _sec_auto('ip:' || ip, format('この回線から1分に %s回', ni)); end if;
        end if;
      end if;
      if random() < 0.002 then delete from sec_hits x where x.at < now() - interval '10 minutes'; end if;
    end if;
  exception when others then msg := null;   -- 見はりのエラーでは止めない
  end;
  if msg is not null then raise sqlstate 'PT403' using message = msg; end if;
end $$;

-- 管理者：見はりのようす・止めているもの・この10分で多い人と回線・記録
create or replace function public.sec_admin_list() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); cfg text;
begin
  if coalesce(_role(u), '') <> 'admin' then raise exception '管理者だけが使えます'; end if;
  select array_to_string(s.setconfig, ',') into cfg from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator' and s.setdatabase = 0;
  return jsonb_build_object(
    'set', coalesce(cfg, '') like '%pgrst.db_pre_request=public.sec_gate%',
    'on', exists (select 1 from sec_hits x where x.at > now() - interval '10 minutes'),
    'lim', jsonb_build_object('u', _sec_lim('u'), 'ip', _sec_lim('ip'), 'h', _sec_lim('h')),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('k', b.k, 'who', _sec_label(b.k), 'until', to_char(b.until at time zone 'Asia/Tokyo', 'FMMM/FMDD HH24:MI'),
                 'forever', b.until > now() + interval '5 years', 'reason', b.reason, 'auto', b.auto, 'n', b.n) order by (b.k <> '*'), b.at desc), '[]'::jsonb)
                 from sec_blocks b where b.until > now()),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('k', z.k, 'who', _sec_label(z.k), 'n', z.n, 'h', z.h) order by z.n desc), '[]'::jsonb)
              from (select x.k, count(*) n, count(*) filter (where x.h) h from sec_hits x where x.at > now() - interval '10 minutes' group by x.k order by count(*) desc limit 10) z),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('at', to_char(l.at at time zone 'Asia/Tokyo', 'FMMM/FMDD HH24:MI'), 'who', _sec_label(l.k), 'ev', l.ev, 'note', l.note) order by l.id desc), '[]'::jsonb)
              from (select * from sec_log order by id desc limit 30) l));
end $$;
-- 管理者：止める。p_who：'*'（ぜんぶ）・回線（IP）・人の ID。p_min：何分（0 か null は ずっと）
create or replace function public.sec_admin_block(p_who text, p_min int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); w text := btrim(coalesce(p_who, '')); kk text; p profiles; mins int := coalesce(nullif(p_min, 0), 52560000); rs text := left(btrim(coalesce(p_reason, '')), 80);
begin
  if coalesce(_role(u), '') <> 'admin' then raise exception '管理者だけが使えます'; end if;
  if mins < 1 then raise exception '止める長さが正しくありません'; end if;
  if w = '*' then kk := '*';
  elsif w ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' or (w ~ '^[0-9a-fA-F:]+$' and w like '%:%') then kk := 'ip:' || lower(w);
  else
    select * into p from profiles where account_no = w;
    if not found then raise exception 'その人（ID）は見つかりません'; end if;
    if _is_admin(p.id) then raise exception '管理者は止められません'; end if;
    kk := 'u:' || p.id;
  end if;
  insert into sec_blocks as x(k, until, reason, auto, by_u, n, at) values (kk, now() + make_interval(mins => mins), rs, false, u, 1, now())
    on conflict (k) do update set until = excluded.until, reason = excluded.reason, auto = false, by_u = excluded.by_u, n = 1, at = now();
  insert into sec_log(k, ev, note) values (kk, 'block', case when mins >= 52560000 then 'ずっと' else mins || '分' end || case when rs <> '' then '・' || rs else '' end);
  return jsonb_build_object('k', kk, 'who', _sec_label(kk));
end $$;
-- 管理者：解除する
create or replace function public.sec_admin_unblock(p_k text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); n int;
begin
  if coalesce(_role(u), '') <> 'admin' then raise exception '管理者だけが使えます'; end if;
  delete from sec_blocks where k = p_k;
  get diagnostics n = row_count;
  if n > 0 then insert into sec_log(k, ev, note) values (p_k, 'unblock', ''); end if;
  return jsonb_build_object('k', p_k, 'n', n);
end $$;
-- バージョン：サーバーに入っている DB の更新の番号（update.sh の記録 kz_ops.migrations から。ないときは null）
create or replace function public.app_ver() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v int; a timestamptz;
begin
  if to_regclass('kz_ops.migrations') is null then return jsonb_build_object('db', null); end if;
  execute 'select max((regexp_match(name, ''^[0-9]+-([0-9]+)_''))[1]::int), max(applied_at) from kz_ops.migrations' into v, a;
  return jsonb_build_object('db', v, 'at', to_char(a at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI'));
exception when others then return jsonb_build_object('db', null);
end $$;

-- 念のため：ログインなしで呼べる関数は、ゲストをはじめるのと見はりだけ。_ ではじまる関数はログインしても呼べない
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig); end if;
  end loop;
end $$;
grant execute on function public.guest_signup(text, text) to anon, authenticated;
grant execute on function public.sec_gate() to anon, authenticated;
grant execute on function public.sec_admin_list(), public.sec_admin_block(text, int, text), public.sec_admin_unblock(text), public.app_ver() to authenticated;
-- 見はりを PostgREST につなぐ（API を呼ぶたびに sec_gate）。つなげないときは知らせだけ（ほかは入る。管理 → セキュリティ に「まだ」と出る）
do $$
begin
  execute 'alter role authenticator set pgrst.db_pre_request to ''public.sec_gate''';
  perform pg_notify('pgrst', 'reload config');
exception when others then raise notice '見はりを PostgREST につなげませんでした（%）', sqlerrm;
end $$;
