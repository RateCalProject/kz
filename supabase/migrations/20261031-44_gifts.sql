-- お祝いの配布（2026-10-31）：はじめての配布を 110,000 X に。毎年 元日・旧正月・建国記念の日（2月11日）に 80,000 X ずつ。いまいる人に 300,000 X（1回だけ）
--   はじめての配布：ゲストは 10,000 X ではじめて、本登録したときに 残りの 100,000 X（ゲストの所持金は 40,000 X までのため）
--   お祝いの日：日本時間の0時すぎに、AI・国のアカウントをのぞく全員へ（毎分の処理 ailinax-gift）。ゲストの分は、本登録したときにまとめて渡す
--   いまいる人の 300,000 X：この更新を入れたときに配る（ゲストは本登録したときに）。お知らせと「お祝いの配布」の記録が残る
--   配るお金は国が新しく発行する（国庫の発行額にのせる。国庫の残高は変わらない）。所得ではないので税金はかからない
--   これからの「はじめての配布」も、国庫の発行額にのせる
--   額と日は app_settings で変えられる：gift_welcome・gift_welcome_guest・gift_holiday（X）・gift_founding（'MM-DD'）

create table if not exists public.gift_runs (
  k      text primary key,                  -- 'YYYY-MM-DD:newyear' など（同じ k は2回配らない）
  day    date,                              -- お祝いの日（日本時間）
  title  text not null,
  amount bigint not null,                   -- 1人あたり
  n      int not null default 0,            -- 渡した人数
  ng     int not null default 0,            -- ゲスト（本登録したときに渡す）の人数
  at     timestamptz not null default now()
);
alter table public.gift_runs enable row level security;
revoke all on public.gift_runs from anon, authenticated;

create table if not exists public.gift_pending (
  id      bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount  bigint not null check (amount > 0),
  title   text not null,
  at      timestamptz not null default now()
);
create index if not exists gift_pending_user_idx on public.gift_pending(user_id);
alter table public.gift_pending enable row level security;
revoke all on public.gift_pending from anon, authenticated;

-- 旧正月（中国の暦の1月1日）
create table if not exists public.lunar_new_year (
  y int primary key,
  d date not null
);
alter table public.lunar_new_year enable row level security;
revoke all on public.lunar_new_year from anon, authenticated;
insert into public.lunar_new_year(y, d) values
  (2027, '2027-02-06'), (2028, '2028-01-26'), (2029, '2029-02-13'), (2030, '2030-02-03'), (2031, '2031-01-23'), (2032, '2032-02-11'), (2033, '2033-01-31'), (2034, '2034-02-19'),
  (2035, '2035-02-08'), (2036, '2036-01-28'), (2037, '2037-02-15'), (2038, '2038-02-04'), (2039, '2039-01-24'), (2040, '2040-02-12'), (2041, '2041-02-01'), (2042, '2042-01-22'),
  (2043, '2043-02-10'), (2044, '2044-01-30'), (2045, '2045-02-17'), (2046, '2046-02-06'), (2047, '2047-01-26'), (2048, '2048-02-14'), (2049, '2049-02-02'), (2050, '2050-01-23'),
  (2051, '2051-02-11'), (2052, '2052-02-01'), (2053, '2053-02-19'), (2054, '2054-02-08'), (2055, '2055-01-28'), (2056, '2056-02-15'), (2057, '2057-02-04'), (2058, '2058-01-24'),
  (2059, '2059-02-12'), (2060, '2060-02-02'), (2061, '2061-01-21'), (2062, '2062-02-09'), (2063, '2063-01-29'), (2064, '2064-02-17'), (2065, '2065-02-05'), (2066, '2066-01-26'),
  (2067, '2067-02-14'), (2068, '2068-02-03'), (2069, '2069-01-23'), (2070, '2070-02-11'), (2071, '2071-01-31'), (2072, '2072-02-19'), (2073, '2073-02-07'), (2074, '2074-01-27'),
  (2075, '2075-02-15'), (2076, '2076-02-05'), (2077, '2077-01-24'), (2078, '2078-02-12'), (2079, '2079-02-02'), (2080, '2080-01-22'), (2081, '2081-02-09'), (2082, '2082-01-29'),
  (2083, '2083-02-17'), (2084, '2084-02-06'), (2085, '2085-01-26'), (2086, '2086-02-14'), (2087, '2087-02-03'), (2088, '2088-01-24'), (2089, '2089-02-10'), (2090, '2090-01-30'),
  (2091, '2091-02-18'), (2092, '2092-02-07'), (2093, '2093-01-27'), (2094, '2094-02-15'), (2095, '2095-02-05'), (2096, '2096-01-25'), (2097, '2097-02-12'), (2098, '2098-02-01'),
  (2099, '2099-01-21')
on conflict (y) do nothing;

-- 額（おかしな値なら決まりの額）
create or replace function public._gift_amt(k text) returns bigint
language sql stable set search_path = public as $$
  select coalesce((select case when value ~ '^[0-9]{1,13}$' then value::bigint end from app_settings where key = 'gift_' || k),
                  case k when 'welcome' then 110000 when 'welcome_guest' then 10000 when 'holiday' then 80000 else 0 end)
$$;

-- 建国記念の日（決まりは2月11日。app_settings の gift_founding＝'MM-DD' で変えられる）
create or replace function public._gift_founding(p_y int) returns date
language plpgsql stable set search_path = public as $$
declare v text := (select value from app_settings where key = 'gift_founding');
begin
  if v ~ '^[0-9]{1,2}-[0-9]{1,2}$' then
    begin
      return make_date(p_y, split_part(v, '-', 1)::int, split_part(v, '-', 2)::int);
    exception when others then
      null;
    end;
  end if;
  return make_date(p_y, 2, 11);
end $$;

-- その年のお祝いの日（日本時間）
create or replace function public._gift_days(p_y int) returns table(k text, day date, title text)
language sql stable set search_path = public as $$
  select 'newyear', make_date(p_y, 1, 1), '新年（元日）のお祝い'
  union all
  select 'lunar', l.d, '旧正月のお祝い' from lunar_new_year l where l.y = p_y
  union all
  select 'founding', _gift_founding(p_y), '建国記念の日のお祝い'
$$;

-- みんなに配る（同じ k は1回だけ）。AI・国はのぞく。ゲストの分は、本登録したときに渡す。いま渡した人数を返す
create or replace function public._gift_give(p_k text, p_day date, p_title text, p_amt bigint, p_msg text default null) returns int
language plpgsql security definer set search_path = public as $$
declare vn int := 0; vg int := 0;
begin
  if coalesce(p_amt, 0) <= 0 then return 0; end if;
  insert into gift_runs(k, day, title, amount) values (p_k, p_day, p_title, p_amt) on conflict (k) do nothing;
  if not found then return 0; end if;
  -- 本登録の人：いま渡す（記録とお知らせも）
  with x as (
    update profiles p set balance = p.balance + p_amt
     where p.ai is null and not _is_guest(p.id)
    returning p.id, p.balance
  ), l as (
    insert into tx_log(user_id, game, bet, payout, balance_after, detail)
    select id, 'gift', 0, p_amt, balance, jsonb_build_object('title', p_title) from x
    returning user_id
  )
  insert into notices(user_id, body)
  select user_id, coalesce(p_msg, format('【お祝い】%sとして %s X を受けとりました。', p_title, _fmt(p_amt))) from l;
  get diagnostics vn = row_count;
  -- ゲスト：とっておいて、本登録したときに渡す
  with g as (
    insert into gift_pending(user_id, amount, title)
    select p.id, p_amt, p_title from profiles p where p.ai is null and _is_guest(p.id)
    returning user_id
  )
  insert into notices(user_id, body)
  select user_id, format('【お祝い】%sとして %s X が届いています。本登録（メールの確認）をすると受けとれます（設定 → プロフィール）。', p_title, _fmt(p_amt)) from g;
  get diagnostics vg = row_count;
  update treasury set issued_total = issued_total + p_amt * vn where id = 1;     -- 国が発行して配る（ゲストの分は渡すときに）
  update gift_runs set n = vn, ng = vg where k = p_k;
  return vn;
end $$;

-- 本登録した人に、ゲストのときにとっておいた分を渡す（ログインのとき ensure_profile から）
create or replace function public._gift_pay_pending(u uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare t bigint := 0; r record;
begin
  if not exists (select 1 from gift_pending where user_id = u) or _is_guest(u) then return 0; end if;
  for r in delete from gift_pending where user_id = u returning amount, title loop
    update profiles set balance = balance + r.amount where id = u;
    perform _log(u, 'gift', 0, r.amount, jsonb_build_object('title', r.title));
    t := t + r.amount;
  end loop;
  if t > 0 then
    update treasury set issued_total = issued_total + t where id = 1;
    perform _notice(u, format('【お祝い】本登録したので、ゲストのときにとっておいた %s X を受けとりました。', _fmt(t)));
  end if;
  return t;
end $$;

-- 毎分：お祝いの日（日本時間）なら配る。サーバーが止まっていたときのため、2日前まで見る
create or replace function public._gift_tick() returns int
language plpgsql security definer set search_path = public as $$
declare t date := (_now() at time zone 'Asia/Tokyo')::date; i int; r record; n int := 0; a bigint := _gift_amt('holiday');
begin
  if not pg_try_advisory_xact_lock(7610) then return -1; end if;
  for i in 0..2 loop
    for r in select * from _gift_days(extract(year from t - i)::int) g where g.day = t - i loop
      n := n + _gift_give(to_char(r.day, 'YYYY-MM-DD') || ':' || r.k, r.day, r.title, a,
                          case when r.k = 'newyear' then format('【お祝い】あけましておめでとうございます！ 新年（元日）のお祝いとして %s X を受けとりました。', _fmt(a)) end);
    end loop;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-gift', '* * * * *', 'select public._gift_tick()');
  end if;
end $$;

-- ログイン（ensure_profile）：はじめての配布を 110,000 X に（ゲストは 10,000 X で、残りは本登録したときに）。発行額にものせる
--   本登録した人には、ゲストのときにとっておいた分をここで渡す
create or replace function public.ensure_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); up boolean := false; gtb jsonb; g boolean := _is_guest(u);
        w bigint := _gift_amt('welcome'); w0 bigint;
begin
  w0 := case when g then least(_gift_amt('welcome_guest'), w, 40000) else w end;   -- ゲストの所持金は 40,000 X まで
  insert into profiles(id, nickname, balance)
  values (u, case when g then 'ゲスト' else 'プレイヤー' end || lpad(_rint(10000)::text, 4, '0'), w0)
  on conflict (id) do nothing;
  if found then
    perform _log(u, 'start', 0, w0, '{"note":"はじめての配布"}');
    update treasury set issued_total = issued_total + w0 where id = 1;    -- 国が発行して配る
    if g and w > w0 then
      insert into gift_pending(user_id, amount, title) values (u, w - w0, 'はじめての配布（本登録）');
    end if;
  end if;
  update profiles set account_no = _new_acct() where id = u and account_no is null;
  update profiles set last_seen_at = _now() where id = u;
  perform _mail_seen(u);
  up := _guest_verify(u);     -- ゲストがメールのリンクで入った（メールを確認できた）ら本登録
  -- 本登録の人に、ゲストのときにとっておいたお祝いを渡す。万一失敗してもログインは止めない
  if up or not g then
    begin
      perform _gift_pay_pending(u);
    exception when others then
      raise warning 'gift pending failed: %', sqlerrm;
    end;
  end if;
  -- 締めの日を過ぎていたら、税の締め（調査・差し押さえ・給付金）をここで行う
  -- 万一失敗してもログインは止めない
  begin
    perform _tax_tick();
  exception when others then
    raise warning 'tax tick failed: %', sqlerrm;
  end;
  begin
    gtb := _gt_brief(u);
  exception when others then
    raise warning 'game tasks failed: %', sqlerrm; gtb := null;
  end;
  return (select jsonb_build_object('nickname', nickname, 'balance', balance, 'tax', _tax_badge(u),
            'account_no', account_no, 'is_admin', _is_admin(u), 'role', _role(u), 'event', _is_event(u), 'badge', _badge(u), 'prefs', prefs, 'guest', _is_guest(u),
            'guest_info', _guest_json(u), 'upgraded', up, 'beta', _beta_list(u), 'gt', gtb)
            from profiles where id = u);
end $$;

revoke all on function public._gift_amt(text) from public, anon, authenticated;
revoke all on function public._gift_founding(int) from public, anon, authenticated;
revoke all on function public._gift_days(int) from public, anon, authenticated;
revoke all on function public._gift_give(text, date, text, bigint, text) from public, anon, authenticated;
revoke all on function public._gift_pay_pending(uuid) from public, anon, authenticated;
revoke all on function public._gift_tick() from public, anon, authenticated;

-- いまいる人に 300,000 X（1回だけ。ゲストは本登録したときに）
select public._gift_give('once:everyone300k', null, 'みんなへのお祝い', 300000,
  '【お祝い】はじめての配布が 110,000 X になったのにあわせて、いまいる人みんなに 300,000 X を配りました。これからは毎年、元日・旧正月・建国記念の日（2月11日）に 80,000 X ずつ配ります。');
