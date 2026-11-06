-- DB の更新118：3D の街を歩く（自分の人を動かす・ほかの人もリアルタイムに見える）・見た目（スキン）・スキンガチャ（🎫20枚）
--   av_skins：見た目の表（base：組み立ての人の服・mmd：MMD のモデル）。rare（N・R・SR）・w（スキンガチャの重み。0 は出ない）・
--     look（服の形と色。MMD は 身長など）・file（MMD のモデルのファイル）・credit（作者の表示。ライセンス）
--   av_own：持っている見た目（当たった回数）。av_me：いまの見た目（code・look：髪とはだの色）
--   av_walk：歩くときの しるし（歩きはじめるたびに 新しく。ほかの人には これだけが見える。名前と見た目は av_who で）
--   av_info()：見た目の表（確率・持っている数）・いまの見た目・スキンガチャの枚数。av_set(code, look)：見た目を変える（持っているものだけ）
--   av_walk_start()：歩きはじめる（しるしを返す）。av_who(しるし[])：しるし → 名前・見た目（1日まで・50こまで）
--   gacha_pull('skin')：スキンガチャ（gacha_skin_cost 枚。標準 20。ゲストも引ける）。もう持っている見た目が出たら、チケットを gacha_skin_dup 枚（標準 5）もどす
--   ad_admin：gacha_skin_cost（1〜1000）・gacha_skin_dup（0〜1000）。ad_info：スキンガチャの表・持っている見た目

-- 3D の街を歩く・見た目（スキン）・スキンガチャ（DB の更新118）
create table if not exists public.av_skins (
  code    text primary key,
  name    text not null,
  kind    text not null default 'base' check (kind in ('base', 'mmd')),   -- base：組み立ての人（服の形と色）・mmd：MMD のモデル
  rare    text not null default 'N',                                       -- N・R・SR（base の ふだん着は -）
  w       int not null default 0 check (w >= 0),                           -- スキンガチャの重み（0 は出ない）
  look    jsonb not null default '{}'::jsonb,                              -- base：t（形）・c1（上）・c2（下）・c3（くつ・小物）。mmd：h（身長 m）・m（使うモーフ）
  file    text,                                                            -- mmd：モデルのファイル（サイトの中）
  credit  text,                                                            -- 作者の表示（ライセンス）
  sort    int not null default 0,
  enabled boolean not null default true
);
alter table public.av_skins enable row level security;
revoke all on public.av_skins from anon, authenticated;

create table if not exists public.av_own (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code    text not null references public.av_skins(code) on delete cascade,
  n       int not null default 1,                                          -- 当たった回数
  at      timestamptz not null default now(),
  primary key (user_id, code)
);
alter table public.av_own enable row level security;
revoke all on public.av_own from anon, authenticated;

create table if not exists public.av_me (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code    text not null default 'base',                                    -- いまの見た目
  look    jsonb not null default '{}'::jsonb,                              -- h（髪の色 0〜5）・s（はだの色 0〜3）
  at      timestamptz not null default now()
);
alter table public.av_me enable row level security;
revoke all on public.av_me from anon, authenticated;

create table if not exists public.av_walk (
  k       text primary key,                                                -- しるし（歩きはじめるたびに 新しく。ほかの人には これだけが見える）
  user_id uuid not null references public.profiles(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists av_walk_u_idx on public.av_walk(user_id, at desc);
create index if not exists av_walk_at_idx on public.av_walk(at);
alter table public.av_walk enable row level security;
revoke all on public.av_walk from anon, authenticated;

-- はじめの見た目：ふだん着（だれでも）・服（N 6つ・R 4つ）・MMD のモデル（SR）。確率は N 60%・R 30%・SR 10%
insert into public.av_skins(code, name, kind, rare, w, look, file, credit, sort) values
  ('base', 'ふだん着', 'base', '-', 0, '{"t":"tee","c1":"#e8e4da","c2":"#4a5568","c3":"#3b3b3b"}', null, null, 0),
  ('b_hoodie_red', 'あかいパーカー', 'base', 'N', 1000, '{"t":"hoodie","c1":"#c4473a","c2":"#2d3440","c3":"#f2f2f2"}', null, null, 10),
  ('b_hoodie_navy', 'こんのパーカー', 'base', 'N', 1000, '{"t":"hoodie","c1":"#2c3e66","c2":"#6b6f76","c3":"#e9e9e9"}', null, null, 11),
  ('b_tee_white', 'しろいTシャツ', 'base', 'N', 1000, '{"t":"tee","c1":"#f4f4f2","c2":"#3c5a8a","c3":"#c9c9c9"}', null, null, 12),
  ('b_jersey_green', 'みどりのジャージ', 'base', 'N', 1000, '{"t":"jersey","c1":"#2e7d4f","c2":"#2e7d4f","c3":"#f5f5f5"}', null, null, 13),
  ('b_shirt_blue', 'みずいろのシャツ', 'base', 'N', 1000, '{"t":"shirt","c1":"#9cc3e6","c2":"#d8cfb8","c3":"#6b4b34"}', null, null, 14),
  ('b_coat_beige', 'ベージュのコート', 'base', 'N', 1000, '{"t":"coat","c1":"#c9b38c","c2":"#3a3f47","c3":"#5a3d2b"}', null, null, 15),
  ('b_suit_black', 'くろいスーツ', 'base', 'R', 750, '{"t":"suit","c1":"#23262b","c2":"#23262b","c3":"#9b2335"}', null, null, 20),
  ('b_rain_yellow', 'きいろのレインコート', 'base', 'R', 750, '{"t":"rain","c1":"#f2c230","c2":"#3b4a5a","c3":"#2a6fb0"}', null, null, 21),
  ('b_happi', 'はっぴ', 'base', 'R', 750, '{"t":"happi","c1":"#2b4c8c","c2":"#f4f1e8","c3":"#d33f33"}', null, null, 22),
  ('b_work', '作業着とヘルメット', 'base', 'R', 750, '{"t":"work","c1":"#5b6b4f","c2":"#5b6b4f","c3":"#f0c419"}', null, null, 23),
  ('mmd_uka', 'うか', 'mmd', 'SR', 1000, '{"h":1.6,"m":["まばたき"]}', 'map/skins/uka/MS_Uka.pmx',
   'CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society（CC BY 4.0）', 100)
on conflict (code) do nothing;

-- 見た目（DB の更新118）：名前・いまの見た目（code）・髪とはだの色（l）。見た目が なくなっていたら ふだん着
create or replace function public._av_me_json(zu uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('n', (select p.nickname from profiles p where p.id = zu),
    'c', coalesce((select s.code from av_me m join av_skins s on s.code = m.code and s.enabled where m.user_id = zu), 'base'),
    'l', coalesce((select m.look from av_me m where m.user_id = zu), '{}'::jsonb))
$$;
revoke all on function public._av_me_json(uuid) from public, anon, authenticated;

-- 見た目の表（確率・持っている数）・いまの見た目・スキンガチャの枚数
create or replace function public.av_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare zu uuid := _me_g(); zt numeric;
begin
  select sum(s.w) into zt from av_skins s where s.enabled and s.w > 0;
  return jsonb_build_object(
    'skins', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'kind', s.kind, 'rare', s.rare, 'look', s.look, 'file', s.file, 'credit', s.credit,
               'p', case when s.w > 0 and zt > 0 then round(s.w * 100.0 / zt, 2) end, 'n', coalesce(o.n, 0)) order by s.sort, s.code)
             from av_skins s left join av_own o on o.user_id = zu and o.code = s.code where s.enabled), '[]'::jsonb),
    'me', _av_me_json(zu),
    'cost', greatest(1, _ad_cfg('gacha_skin_cost', 20)), 'dup', greatest(0, _ad_cfg('gacha_skin_dup', 5)),
    'tix', coalesce((select t.n from ad_tix t where t.user_id = zu), 0));
end $$;
revoke all on function public.av_info() from public, anon;
grant execute on function public.av_info() to authenticated;

-- 見た目を変える（持っているものだけ。ふだん着は だれでも）。look：髪の色 h（0〜5）・はだの色 s（0〜3）。なければ 前のまま
create or replace function public.av_set(p_code text, p_look jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zc text; zh int; zs int;
begin
  select s.code into zc from av_skins s where s.code = p_code and s.enabled;
  if zc is null then raise exception 'その見た目は ありません'; end if;
  if zc <> 'base' and not exists (select 1 from av_own o where o.user_id = zu and o.code = zc) then
    raise exception 'その見た目は まだ持っていません（スキンガチャで当たります）';
  end if;
  select case when m.look->>'h' ~ '^[0-5]$' then (m.look->>'h')::int end, case when m.look->>'s' ~ '^[0-3]$' then (m.look->>'s')::int end
    into zh, zs from av_me m where m.user_id = zu;
  if p_look is not null and jsonb_typeof(p_look) = 'object' then
    if coalesce(p_look->>'h', '') ~ '^[0-5]$' then zh := (p_look->>'h')::int; end if;
    if coalesce(p_look->>'s', '') ~ '^[0-3]$' then zs := (p_look->>'s')::int; end if;
  end if;
  insert into av_me(user_id, code, look, at) values (zu, zc, jsonb_build_object('h', coalesce(zh, 0), 's', coalesce(zs, 0)), now())
  on conflict (user_id) do update set code = excluded.code, look = excluded.look, at = now();
  return _av_me_json(zu);
end $$;
revoke all on function public.av_set(text, jsonb) from public, anon;
grant execute on function public.av_set(text, jsonb) to authenticated;

-- 歩きはじめる：新しい しるし（ほかの人には これだけが見える。1人 5つまで・2日で消す）
create or replace function public.av_walk_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  perform pg_advisory_xact_lock(7632, hashtext(zu::text));
  delete from av_walk w where w.at < now() - interval '2 days';
  delete from av_walk w where w.k in (select x.k from av_walk x where x.user_id = zu order by x.at desc offset 4);
  insert into av_walk(k, user_id) values (zk, zu);
  return jsonb_build_object('k', zk) || _av_me_json(zu);
end $$;
revoke all on function public.av_walk_start() from public, anon;
grant execute on function public.av_walk_start() to authenticated;

-- しるし → 名前・見た目（ほかの人を見せる。1日まで・50こまで）
create or replace function public.av_who(p_ks text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare zu uuid := _me_g();
begin
  if zu is null or p_ks is null or cardinality(p_ks) = 0 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('k', w.k) || _av_me_json(w.user_id))
                     from av_walk w where w.k = any (p_ks[1:50]) and w.at > now() - interval '1 day'), '[]'::jsonb);
end $$;
revoke all on function public.av_who(text[]) from public, anon;
grant execute on function public.av_who(text[]) to authenticated;

create or replace function public._gacha_json() returns jsonb
language sql stable set search_path = public as $$
  with t as (select e, (select sum((x->>1)::numeric) from jsonb_array_elements(_gx_table()) x) tot from jsonb_array_elements(_gx_table()) e),
       g as (select count(*) n, min(p.sale) lo, max(p.sale) hi from mp_gov_sale s join mp_parcels p on p.id = s.parcel
              where p.gov and p.own_u is null and p.own_c is null and p.sale is not null)
  select jsonb_build_object(
    'x', (select jsonb_agg(jsonb_build_object('amt', (e->>0)::bigint, 'p', round((e->>1)::numeric * 100 / tot, 3)) order by (e->>0)::bigint) from t),
    'ev', (select round(sum((e->>0)::numeric * (e->>1)::numeric / tot)) from t),
    'land', jsonb_build_object('cost', greatest(1, _ad_cfg('gacha_land_cost', 10)), 'p', round(_ad_cfg('gacha_land_p', 50) / 100.0, 3),
                               'miss', _ad_cfg('gacha_land_miss', 2000), 'left', g.n, 'lo', g.lo, 'hi', g.hi),
    -- スキンガチャ（DB の更新118）：枚数・もう持っていたら もどす枚数・出るもの（確率）
    'skin', jsonb_build_object('cost', greatest(1, _ad_cfg('gacha_skin_cost', 20)), 'dup', greatest(0, _ad_cfg('gacha_skin_dup', 5)),
      'list', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'kind', s.kind, 'rare', s.rare, 'credit', s.credit,
                 'p', round(s.w * 100.0 / (select sum(z.w) from av_skins z where z.enabled and z.w > 0), 2)) order by s.sort, s.code)
               from av_skins s where s.enabled and s.w > 0), '[]'::jsonb)))
    from g
$$;

create or replace function public.ad_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  return _ad_json(u) || jsonb_build_object('gacha', _gacha_json(),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', g.kind, 'cost', g.cost, 'x', g.x, 'land', g.detail->'land', 'items', g.detail->'items', 'skin', g.detail->'skin',
                       'at_ms', (extract(epoch from g.at) * 1000)::bigint) order by g.id desc)
                       from (select * from gacha_log where user_id = u order by id desc limit 20) g), '[]'::jsonb),
    'skin_own', coalesce((select jsonb_object_agg(o.code, o.n) from av_own o where o.user_id = u), '{}'::jsonb));   -- 持っている見た目（DB の更新118）
end $$;

create or replace function public.gacha_pull(p_kind text, p_times int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); g boolean := _is_guest(u); k int := coalesce(p_times, 1); cost int; have int; t jsonb; i int; a bigint;
        sx bigint := 0; items jsonb := '[]'; b bigint; now_x bigint := 0; later bigint := 0; p mp_parcels; c record; addr text; land jsonb; won boolean := false;
        zsc text; zsn int; zsb int := 0; zsk jsonb;
begin
  perform pg_advisory_xact_lock(7631, hashtext(u::text));
  if p_kind = 'x' then
    if k not in (1, 10) then raise exception '1回か10連をえらんでください'; end if;
    cost := k;
  elsif p_kind = 'land' then
    if g then raise exception '国有地ガチャは、本登録してから引けます（設定 → プロフィール）'; end if;
    perform _mp_ok(u);
    k := 1; cost := greatest(1, _ad_cfg('gacha_land_cost', 10))::int;
  elsif p_kind = 'skin' then   -- スキンガチャ（DB の更新118。ゲストも引ける）
    k := 1; cost := greatest(1, _ad_cfg('gacha_skin_cost', 20))::int;
    if not exists (select 1 from av_skins s where s.enabled and s.w > 0) then raise exception 'いまはスキンガチャを引けません'; end if;
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
  elsif p_kind = 'skin' then
    -- 重みのとおりに1つ。もう持っていたら チケットを gacha_skin_dup 枚 もどす（使った枚数まで）
    select c2.code into zsc
      from (select s.code, sum(s.w) over (order by s.sort, s.code) cum, sum(s.w) over () tot from av_skins s where s.enabled and s.w > 0) c2,
           (select random() zr) q
     where q.zr * c2.tot < c2.cum order by c2.cum limit 1;
    if zsc is null then raise exception 'いまはスキンガチャを引けません'; end if;
    insert into av_own as o (user_id, code, n) values (u, zsc, 1)
    on conflict (user_id, code) do update set n = o.n + 1, at = now()
    returning o.n into zsn;
    if zsn > 1 then
      zsb := least(cost, greatest(0, _ad_cfg('gacha_skin_dup', 5)))::int;
      if zsb > 0 then update ad_tix set n = n + zsb, used = used - zsb where user_id = u; end if;
    end if;
    select jsonb_build_object('code', s.code, 'name', s.name, 'rare', s.rare, 'kind', s.kind, 'look', s.look, 'file', s.file, 'credit', s.credit,
                              'dup', zsn > 1, 'n', zsn, 'back', zsb)
      into zsk from av_skins s where s.code = zsc;
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
  values (u, p_kind, cost, sx, case when won then p.id end, jsonb_build_object('items', items, 'later', later, 'land', land, 'skin', zsk));
  return _ad_json(u) || jsonb_build_object('kind', p_kind, 'items', items, 'x', sx, 'later', later, 'land', land, 'skin', zsk, 'balance', (select balance from profiles where id = u));
end $$;

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
  if s ? 'gacha_skin_cost' then   -- スキンガチャ（DB の更新118）
    v := (s->>'gacha_skin_cost')::bigint; if v < 1 or v > 1000 then raise exception 'スキンガチャの枚数は 1〜1000 にしてください'; end if;
    insert into app_settings(key, value) values ('gacha_skin_cost', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'gacha_skin_dup' then
    v := (s->>'gacha_skin_dup')::bigint; if v < 0 or v > 1000 then raise exception 'もどすチケットは 0〜1000 枚にしてください'; end if;
    insert into app_settings(key, value) values ('gacha_skin_dup', v::text) on conflict (key) do update set value = excluded.value;
  end if;
  if s ? 'tix_self' then     -- ためしに自分にチケット（広告が出せるようになる前に、ガチャをためすため）
    v := (s->>'tix_self')::bigint; if v < 1 or v > 1000 then raise exception '自分にわたすチケットは 1〜1000 枚にしてください'; end if;
    insert into ad_tix(user_id, n, got) values (u, v, v) on conflict (user_id) do update set n = ad_tix.n + excluded.n, got = ad_tix.got + excluded.got;
  end if;
  return jsonb_build_object('ad_day', _ad_cfg('ad_day', 30), 'ad_tix', least(10, greatest(1, _ad_cfg('ad_tix', 1))), 'ad_guest', _ad_cfg('ad_guest', 1) <> 0,
    'gacha_x', coalesce((select value from app_settings where key = 'gacha_x'), '200:5000,500:3000,1500:1500,5000:450,50000:50'),
    'gacha_land_p', _ad_cfg('gacha_land_p', 50), 'gacha_land_cost', greatest(1, _ad_cfg('gacha_land_cost', 10)), 'gacha_land_miss', _ad_cfg('gacha_land_miss', 2000),
    'gacha_skin_cost', greatest(1, _ad_cfg('gacha_skin_cost', 20)), 'gacha_skin_dup', greatest(0, _ad_cfg('gacha_skin_dup', 5)),
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

