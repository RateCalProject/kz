-- 広告を見て 🎫 チケットをもらう → チケットでガチャ（X ガチャ・国有地ガチャ）
--   Google のきまり：見てもらうもの（チケット）は、もらった本人だけが、このサイトの中だけで使える（送れない）。チケットに期限はない
--   ad_begin()：見る前に呼ぶ（1日の回数・ゲストを見て、しるし（トークン）を返す）
--   ad_end(しるし)：見おわったら呼ぶ。チケットを ad_tix 枚（標準 1）。はじめてから5秒たっていないもの・30分より古いもの・2回目はわたさない
--   gacha_pull('x', 1 か 10)：X ガチャ（1回 チケット1枚）。gacha_pull('land')：国有地ガチャ（gacha_land_cost 枚。標準 10。本登録の人だけ）
--     X は国が発行してわたす（所得には入れない。お祝いと同じ）。ゲストは 40,000 X をこえる分を、本登録したときにわたす（gift_pending）
--     国有地：国が時価で売っている土地（mp_gov_sale）から1筆。建物ごと、ただで自分のものに（買った値段 0）。はずれは gacha_land_miss X
--   ad_info()：きょう見た回数・上限・チケット・ガチャの確率・自分の結果（20件）
--   ad_admin(設定)：管理者だけ。設定を変える・ようす（きょう・7日）
--   設定（app_settings）：ad_day（1日に見られる回数。標準 30。0 で止める）・ad_tix（1回の枚数。標準 1）・ad_guest（'0' でゲストは見られない）
--     gacha_x（X ガチャの表 '額:重み,…'。標準 '200:5000,500:3000,1500:1500,5000:450,50000:50'＝平均 950 X）
--     gacha_land_p（国有地の当たり。1万分のいくつ。標準 50＝0.5%）・gacha_land_cost（標準 10）・gacha_land_miss（はずれの X。標準 2000）

create table if not exists public.ad_views (
  id      bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,                                   -- 日本時間の日（1日の回数を数える）
  tok     uuid not null default gen_random_uuid(),
  st      timestamptz not null default now(),              -- 見はじめ（ほんとうの時刻）
  done    timestamptz,                                     -- 見おわってチケットをわたした
  amt     bigint not null default 0                        -- わたしたチケットの枚数
);
create index if not exists ad_views_u_idx on public.ad_views(user_id, day);
create unique index if not exists ad_views_tok_idx on public.ad_views(tok);
create index if not exists ad_views_day_idx on public.ad_views(day) where done is not null;
alter table public.ad_views enable row level security;
revoke all on public.ad_views from anon, authenticated;

create table if not exists public.ad_tix (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  n       int not null default 0,                          -- いまのチケット
  got     int not null default 0,                          -- これまでにもらった
  used    int not null default 0                           -- これまでに使った
);
alter table public.ad_tix enable row level security;
revoke all on public.ad_tix from anon, authenticated;

create table if not exists public.gacha_log (
  id      bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind    text not null,                                   -- x / land
  cost    int not null,                                    -- 使ったチケット
  x       bigint not null default 0,                       -- 当たった X（10連は合計）
  parcel  bigint,                                          -- 当たった土地（筆）
  detail  jsonb,
  at      timestamptz not null default now()
);
create index if not exists gacha_log_u_idx on public.gacha_log(user_id, id desc);
create index if not exists gacha_log_at_idx on public.gacha_log(at);
alter table public.gacha_log enable row level security;
revoke all on public.gacha_log from anon, authenticated;

create or replace function public._ad_cfg(k text, d bigint) returns bigint
language sql stable set search_path = public as $$
  select coalesce((select nullif(regexp_replace(value, '[^0-9]', '', 'g'), '')::bigint from app_settings where key = k), d)
$$;

-- X ガチャの表 [[額, 重み], …]（額の小さい順）。おかしいときは null
create or replace function public._gx_parse(s text) returns jsonb
language plpgsql immutable as $$
declare r jsonb := '[]'; p text; a bigint; w bigint; n int := 0;
begin
  foreach p in array string_to_array(regexp_replace(coalesce(s, ''), '[\s　]', '', 'g'), ',') loop
    if p = '' then continue; end if;
    if p !~ '^\d{1,9}:\d{1,7}$' then return null; end if;
    a := split_part(p, ':', 1)::bigint; w := split_part(p, ':', 2)::bigint;
    if a > 100000000 or w < 1 or w > 1000000 then return null; end if;
    r := r || jsonb_build_array(jsonb_build_array(a, w)); n := n + 1;
  end loop;
  if n < 1 or n > 20 then return null; end if;
  return (select jsonb_agg(e order by (e->>0)::bigint) from jsonb_array_elements(r) e);
end $$;
create or replace function public._gx_table() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(_gx_parse((select value from app_settings where key = 'gacha_x')), _gx_parse('200:5000,500:3000,1500:1500,5000:450,50000:50'))
$$;
create or replace function public._gx_draw(t jsonb) returns bigint
language plpgsql volatile as $$
declare r numeric; e jsonb;
begin
  r := random() * (select sum((x->>1)::numeric) from jsonb_array_elements(t) x);
  for e in select x from jsonb_array_elements(t) x loop
    r := r - (e->>1)::numeric;
    if r < 0 then return (e->>0)::bigint; end if;
  end loop;
  return (t->-1->>0)::bigint;
end $$;

-- ガチャの中身（確率は画面に出す）
create or replace function public._gacha_json() returns jsonb
language sql stable set search_path = public as $$
  with t as (select e, (select sum((x->>1)::numeric) from jsonb_array_elements(_gx_table()) x) tot from jsonb_array_elements(_gx_table()) e),
       g as (select count(*) n, min(p.sale) lo, max(p.sale) hi from mp_gov_sale s join mp_parcels p on p.id = s.parcel
              where p.gov and p.own_u is null and p.own_c is null and p.sale is not null)
  select jsonb_build_object(
    'x', (select jsonb_agg(jsonb_build_object('amt', (e->>0)::bigint, 'p', round((e->>1)::numeric * 100 / tot, 3)) order by (e->>0)::bigint) from t),
    'ev', (select round(sum((e->>0)::numeric * (e->>1)::numeric / tot)) from t),
    'land', jsonb_build_object('cost', greatest(1, _ad_cfg('gacha_land_cost', 10)), 'p', round(_ad_cfg('gacha_land_p', 50) / 100.0, 3),
                               'miss', _ad_cfg('gacha_land_miss', 2000), 'left', g.n, 'lo', g.lo, 'hi', g.hi))
    from g
$$;

create or replace function public._ad_json(u uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('n', (select count(*) from ad_views v where v.user_id = u and v.day = (_now() at time zone 'Asia/Tokyo')::date and v.done is not null),
    'max', _ad_cfg('ad_day', 30), 'per', least(10, greatest(1, _ad_cfg('ad_tix', 1))),
    'tix', coalesce((select n from ad_tix where user_id = u), 0),
    'guest', _is_guest(u), 'guest_ok', _ad_cfg('ad_guest', 1) <> 0,
    'on', _ad_cfg('ad_day', 30) > 0 and (not _is_guest(u) or _ad_cfg('ad_guest', 1) <> 0))
$$;

-- 広告を見られるか（だめなら理由を出す）
create or replace function public._ad_check(u uuid, d date) returns void
language plpgsql stable set search_path = public as $$
declare mx bigint := _ad_cfg('ad_day', 30);
begin
  if mx <= 0 then raise exception 'いまは広告でチケットをもらえません'; end if;
  if _is_guest(u) and _ad_cfg('ad_guest', 1) = 0 then raise exception '広告でチケットをもらえるのは本登録した人だけです（設定 → プロフィール）'; end if;
  if (select count(*) from ad_views v where v.user_id = u and v.day = d and v.done is not null) >= mx then
    raise exception 'きょうの広告は %回 まで見ました。あしたまた見られます', mx;
  end if;
end $$;

create or replace function public.ad_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  return _ad_json(u) || jsonb_build_object('gacha', _gacha_json(),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', g.kind, 'cost', g.cost, 'x', g.x, 'land', g.detail->'land', 'items', g.detail->'items',
                       'at_ms', (extract(epoch from g.at) * 1000)::bigint) order by g.id desc)
                       from (select * from gacha_log where user_id = u order by id desc limit 20) g), '[]'::jsonb));
end $$;

create or replace function public.ad_begin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); d date := (_now() at time zone 'Asia/Tokyo')::date; t uuid;
begin
  perform pg_advisory_xact_lock(7630, hashtext(u::text));
  perform _ad_check(u, d);
  delete from ad_views v where v.user_id = u and v.done is null and v.st < now() - interval '30 minutes';
  if (select count(*) from ad_views v where v.user_id = u and v.day = d) >= _ad_cfg('ad_day', 30) * 4 + 20 then
    raise exception 'きょうは広告をたくさん開きました。あしたまた見られます';
  end if;
  insert into ad_views(user_id, day) values (u, d) returning tok into t;
  return _ad_json(u) || jsonb_build_object('tok', t);
end $$;

create or replace function public.ad_end(p_tok uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); v record; k int := least(10, greatest(1, _ad_cfg('ad_tix', 1)))::int;
begin
  perform pg_advisory_xact_lock(7630, hashtext(u::text));
  select * into v from ad_views x where x.tok = p_tok and x.user_id = u for update;
  if not found then raise exception '広告の記録が見つかりません。もう一度見てください'; end if;
  if v.done is not null then raise exception 'この広告の分は、もう受けとっています'; end if;
  if now() < v.st + interval '5 seconds' then raise exception '広告を最後まで見ると受けとれます'; end if;
  if now() > v.st + interval '30 minutes' then raise exception '時間がたちすぎました。もう一度見てください'; end if;
  perform _ad_check(u, v.day);
  update ad_views set done = now(), amt = k where id = v.id;
  insert into ad_tix(user_id, n, got) values (u, k, k)
  on conflict (user_id) do update set n = ad_tix.n + excluded.n, got = ad_tix.got + excluded.got;
  return _ad_json(u) || jsonb_build_object('got', k);
end $$;

-- ガチャを引く
create or replace function public.gacha_pull(p_kind text, p_times int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); g boolean := _is_guest(u); k int := coalesce(p_times, 1); cost int; have int; t jsonb; i int; a bigint;
        sx bigint := 0; items jsonb := '[]'; b bigint; now_x bigint := 0; later bigint := 0; p mp_parcels; c record; addr text; land jsonb; won boolean := false;
begin
  perform pg_advisory_xact_lock(7631, hashtext(u::text));
  if p_kind = 'x' then
    if k not in (1, 10) then raise exception '1回か10連をえらんでください'; end if;
    cost := k;
  elsif p_kind = 'land' then
    if g then raise exception '国有地ガチャは、本登録してから引けます（設定 → プロフィール）'; end if;
    perform _mp_ok(u);
    k := 1; cost := greatest(1, _ad_cfg('gacha_land_cost', 10))::int;
  else
    raise exception 'ガチャの種類がちがいます';
  end if;
  select n into have from ad_tix where user_id = u for update;
  if coalesce(have, 0) < cost then raise exception 'チケットが足りません（%枚いります。いまは %枚）', cost, coalesce(have, 0); end if;
  update ad_tix set n = n - cost, used = used + cost where user_id = u;
  if p_kind = 'x' then
    t := _gx_table();
    for i in 1..k loop
      a := _gx_draw(t); sx := sx + a; items := items || to_jsonb(a);
    end loop;
  else
    if random() * 10000 < _ad_cfg('gacha_land_p', 50) then
      select pa.* into p from mp_gov_sale s join mp_parcels pa on pa.id = s.parcel
       where pa.gov and pa.own_u is null and pa.own_c is null and pa.sale is not null
       order by random() limit 1 for update of pa skip locked;
      won := found;
    end if;
    if won then
      addr := (select _mp_addr(_mp_t5((p.bb[1])[0]::int), _mp_t5((p.bb[1])[1]::int), null, null) ->> 'text') || ' ' || _mp_ban(p.ban, p.eda);
      select x, y into c from mp_pcells where parcel = p.id order by y, x limit 1;
      -- 土地を使う申請はなくなる（買ったときと同じ）
      perform _notice(w, format('【国土】土地を使う申請（%s）は、持ち主が変わったのでなくなりました。新しい持ち主に申請してください。', addr))
         from (select distinct coalesce(q.req_u, (select owner from companies where id = q.req_c)) w from mp_landreq q where q.parcel = p.id and q.st = 'wait') z where w is not null and w <> u;
      delete from mp_landreq where parcel = p.id;
      update mp_parcels set own_u = u, own_c = null, gov = false, price = 0, sale = null, rent = null, bought_at = now() where id = p.id;
      delete from mp_gov_sale where parcel = p.id;
      perform _mp_chg('land', null, 'set', box(point(_mp_t5((p.bb[1])[0]::int), _mp_t5((p.bb[1])[1]::int)), point(_mp_t5((p.bb[0])[0]::int) + 1, _mp_t5((p.bb[0])[1]::int) + 1)));
      land := jsonb_build_object('id', p.id, 'addr', addr, 'm2', p.n * 100, 'val', p.sale, 'bld', p.bld is not null, 'x', c.x, 'y', c.y);
      perform _notice_l(u, format('【国土】国有地ガチャで、土地 %s（%s㎡・時価 %s X%s）が当たりました！ もう、あなたの土地です。', addr, p.n * 100, _fmt(p.sale),
                                  case when p.bld is not null then '・建物つき' else '' end),
                        jsonb_build_object('go', 'map', 'k', 'spot', 'x', c.x, 'y', c.y), null);
    else
      sx := greatest(0, _ad_cfg('gacha_land_miss', 2000)); items := items || to_jsonb(sx);
    end if;
  end if;
  -- X をわたす（国が発行）。ゲストは 40,000 X まで。こえた分は本登録のときに
  if sx > 0 then
    now_x := sx;
    if g then
      select balance into b from profiles where id = u;
      now_x := greatest(0, least(sx, 40000 - coalesce(b, 0)));
    end if;
    later := sx - now_x;
    if now_x > 0 then
      update profiles set balance = balance + now_x where id = u;
      perform _log(u, 'gacha', 0, now_x, jsonb_build_object('title', case when p_kind = 'x' then 'X ガチャ' else '国有地ガチャ（はずれ）' end, 'n', k));
      update treasury set issued_total = issued_total + now_x where id = 1;     -- 国が発行して渡す
    end if;
    if later > 0 then insert into gift_pending(user_id, amount, title) values (u, later, 'ガチャ（ゲストのとき）'); end if;
  end if;
  insert into gacha_log(user_id, kind, cost, x, parcel, detail)
  values (u, p_kind, cost, sx, case when won then p.id end, jsonb_build_object('items', items, 'later', later, 'land', land));
  return _ad_json(u) || jsonb_build_object('kind', p_kind, 'items', items, 'x', sx, 'later', later, 'land', land, 'balance', (select balance from profiles where id = u));
end $$;

-- 管理者：設定（p_set のキーだけ変える）とようす
create or replace function public.ad_admin(p_set jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); d date := (_now() at time zone 'Asia/Tokyo')::date; s jsonb := coalesce(p_set, '{}'::jsonb); v bigint;
  t0 timestamptz := (d::timestamp at time zone 'Asia/Tokyo'); t7 timestamptz := ((d - 6)::timestamp at time zone 'Asia/Tokyo');
begin
  if _role(u) is distinct from 'admin' then raise exception '管理者だけが使えます'; end if;
  if s ? 'ad_day' then
    v := (s->>'ad_day')::bigint; if v < 0 or v > 100 then raise exception '1日の回数は 0〜100 にしてください'; end if;
    insert into app_settings(key, value) values ('ad_day', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'ad_tix' then
    v := (s->>'ad_tix')::bigint; if v < 1 or v > 10 then raise exception '1回の枚数は 1〜10 にしてください'; end if;
    insert into app_settings(key, value) values ('ad_tix', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'ad_guest' then
    insert into app_settings(key, value) values ('ad_guest', case when (s->>'ad_guest')::boolean then '1' else '0' end) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'gacha_x' then
    if _gx_parse(s->>'gacha_x') is null then raise exception 'X ガチャの表は「額:重み」をカンマでつないでください（例 200:5000,500:3000。20こまで）'; end if;
    insert into app_settings(key, value) values ('gacha_x', regexp_replace(s->>'gacha_x', '[\s　]', '', 'g')) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'gacha_land_p' then
    v := (s->>'gacha_land_p')::bigint; if v < 0 or v > 10000 then raise exception '国有地の当たりは 1万分の 0〜10000 にしてください'; end if;
    insert into app_settings(key, value) values ('gacha_land_p', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'gacha_land_cost' then
    v := (s->>'gacha_land_cost')::bigint; if v < 1 or v > 1000 then raise exception '国有地ガチャの枚数は 1〜1000 にしてください'; end if;
    insert into app_settings(key, value) values ('gacha_land_cost', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'gacha_land_miss' then
    v := (s->>'gacha_land_miss')::bigint; if v < 0 or v > 1000000 then raise exception 'はずれの X は 0〜1,000,000 にしてください'; end if;
    insert into app_settings(key, value) values ('gacha_land_miss', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'tix_self' then     -- ためしに自分にチケット（広告が出せるようになる前に、ガチャをためすため）
    v := (s->>'tix_self')::bigint; if v < 1 or v > 1000 then raise exception '自分にわたすチケットは 1〜1000 枚にしてください'; end if;
    insert into ad_tix(user_id, n, got) values (u, v, v) on conflict (user_id) do update set n = ad_tix.n + excluded.n, got = ad_tix.got + excluded.got;
  end if;
  return jsonb_build_object('ad_day', _ad_cfg('ad_day', 30), 'ad_tix', least(10, greatest(1, _ad_cfg('ad_tix', 1))), 'ad_guest', _ad_cfg('ad_guest', 1) <> 0,
    'gacha_x', coalesce((select value from app_settings where key = 'gacha_x'), '200:5000,500:3000,1500:1500,5000:450,50000:50'),
    'gacha_land_p', _ad_cfg('gacha_land_p', 50), 'gacha_land_cost', greatest(1, _ad_cfg('gacha_land_cost', 10)), 'gacha_land_miss', _ad_cfg('gacha_land_miss', 2000),
    'gacha', _gacha_json(), 'my_tix', coalesce((select n from ad_tix where user_id = u), 0),
    'today', jsonb_build_object('ads', (select count(*) from ad_views where day = d and done is not null),
      'users', (select count(distinct user_id) from ad_views where day = d and done is not null),
      'pulls', (select count(*) from gacha_log where at >= t0), 'x', (select coalesce(sum(x), 0) from gacha_log where at >= t0),
      'lands', (select count(*) from gacha_log where parcel is not null and at >= t0)),
    'week', jsonb_build_object('ads', (select count(*) from ad_views where day > d - 7 and done is not null),
      'users', (select count(distinct user_id) from ad_views where day > d - 7 and done is not null),
      'pulls', (select count(*) from gacha_log where at >= t7), 'x', (select coalesce(sum(x), 0) from gacha_log where at >= t7),
      'lands', (select count(*) from gacha_log where parcel is not null and at >= t7)));
end $$;

revoke all on function public._ad_cfg(text, bigint) from public, anon, authenticated;
revoke all on function public._gx_parse(text) from public, anon, authenticated;
revoke all on function public._gx_table() from public, anon, authenticated;
revoke all on function public._gx_draw(jsonb) from public, anon, authenticated;
revoke all on function public._gacha_json() from public, anon, authenticated;
revoke all on function public._ad_json(uuid) from public, anon, authenticated;
revoke all on function public._ad_check(uuid, date) from public, anon, authenticated;
revoke all on function public.ad_info() from public, anon;
grant execute on function public.ad_info() to authenticated;
revoke all on function public.ad_begin() from public, anon;
grant execute on function public.ad_begin() to authenticated;
revoke all on function public.ad_end(uuid) from public, anon;
grant execute on function public.ad_end(uuid) to authenticated;
revoke all on function public.gacha_pull(text, int) from public, anon;
grant execute on function public.gacha_pull(text, int) to authenticated;
revoke all on function public.ad_admin(jsonb) from public, anon;
grant execute on function public.ad_admin(jsonb) to authenticated;
