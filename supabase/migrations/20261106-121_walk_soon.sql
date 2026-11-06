-- DB の更新121：スキンガチャを「準備中（カミングスーン）」に（管理 → ゲーム の 準備中のしくみ。skin）。3D の街を歩く（walk）も 準備中にできる
--   はじめは スキンガチャだけ 準備中（街を歩くのは みんな。持っている見た目は 着られる）。管理者は いつでも使える。管理 → ゲーム で「みんなが遊べる」にすると 公開
--   準備中のあいだ、管理者のほかは gacha_pull('skin')（街を歩くが 準備中なら av_walk_start・av_step も）を使えない（画面は「カミングスーン」）
--   管理者は 見た目（スキン）を ぜんぶ持っている あつかい（av_info・av_set・ad_info）

create or replace function public._beta_keys() returns jsonb
language sql immutable as $$
  select '[["boat","競艇・競輪"],["auction","競り市"],["koikoi","花札こいこい"],["fishing","釣り"],["owner","馬主"],["map","国土（地図）"],["walk","3D の街を歩く"],["skin","スキンガチャ"]]'::jsonb
$$;

create or replace function public.av_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare zu uuid := _me_g(); zt numeric; za boolean := _is_admin(zu); zb text[] := _beta_games();
begin
  select sum(s.w) into zt from av_skins s where s.enabled and s.w > 0;
  return jsonb_build_object(
    'skins', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'kind', s.kind, 'rare', s.rare, 'look', s.look, 'file', s.file, 'credit', s.credit,
               'p', case when s.w > 0 and zt > 0 then round(s.w * 100.0 / zt, 2) end, 'n', case when za then greatest(coalesce(o.n, 0), 1) else coalesce(o.n, 0) end) order by s.sort, s.code)   -- 管理者は ぜんぶ持っている（DB の更新121）
             from av_skins s left join av_own o on o.user_id = zu and o.code = s.code where s.enabled), '[]'::jsonb),
    'me', _av_me_json(zu),
    'cost', greatest(1, _ad_cfg('gacha_skin_cost', 20)), 'dup', greatest(0, _ad_cfg('gacha_skin_dup', 5)),
    'tix', coalesce((select t.n from ad_tix t where t.user_id = zu), 0),
    'admin', za, 'soon', jsonb_build_object('walk', 'walk' = any(zb), 'skin', 'skin' = any(zb)));   -- 準備中（DB の更新121）
end $$;

create or replace function public.av_set(p_code text, p_look jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zc text; zh int; zs int;
begin
  select s.code into zc from av_skins s where s.code = p_code and s.enabled;
  if zc is null then raise exception 'その見た目は ありません'; end if;
  if zc <> 'base' and not _is_admin(zu) and not exists (select 1 from av_own o where o.user_id = zu and o.code = zc) then   -- 管理者は ぜんぶ（DB の更新121）
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

create or replace function public.av_walk_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  if 'walk' = any(_beta_games()) and not _is_admin(zu) then raise exception '街を歩くのは もうすぐ できるようになります（カミングスーン）'; end if;   -- 準備中（DB の更新121）
  perform pg_advisory_xact_lock(7632, hashtext(zu::text));
  delete from av_walk w where w.at < now() - interval '2 days';
  delete from av_walk w where w.k in (select x.k from av_walk x where x.user_id = zu order by x.at desc offset 4);
  insert into av_walk(k, user_id) values (zk, zu);
  return jsonb_build_object('k', zk) || _av_me_json(zu);
end $$;

create or replace function public.av_step(p_k text, p_x double precision, p_y double precision, p_f double precision, p_h double precision,
                                          p_m int default 0, p_v int default 0, p_known text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zo jsonb;
begin
  if p_k is null or not exists (select 1 from av_walk w where w.k = p_k and w.user_id = zu and w.at > now() - interval '1 day') then
    raise exception 'walk_k：歩くしるしが古くなりました';
  end if;
  if coalesce(p_m, 0) >= 0 and 'walk' = any(_beta_games()) and not _is_admin(zu) then raise exception '街を歩くのは もうすぐ できるようになります（カミングスーン）'; end if;   -- 準備中（DB の更新121）
  if coalesce(p_m, 0) < 0 then   -- やめた
    delete from av_pos a where a.k = p_k;
    return jsonb_build_object('o', '[]'::jsonb);
  end if;
  -- NaN・無限大も ここで はねる（PostgreSQL では NaN が いちばん大きい）
  if p_x is null or p_y is null or p_f is null or p_h is null or abs(p_x) > 100000 or abs(p_y) > 100000 or abs(p_f) > 100 or abs(p_h) > 1000 then
    raise exception '位置が おかしいです';
  end if;
  insert into av_pos as a (k, user_id, x, y, f, h, m, v, at)
  values (p_k, zu, p_x, p_y, p_f, p_h, least(2, greatest(0, coalesce(p_m, 0))), coalesce(p_v, 0), now())
  on conflict (k) do update set x = excluded.x, y = excluded.y, f = excluded.f, h = excluded.h, m = excluded.m, v = excluded.v, at = excluded.at;
  if random() < 0.02 then delete from av_pos a where a.at < now() - interval '1 minute'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', a.k, 'x', round(a.x::numeric, 4), 'y', round(a.y::numeric, 4), 'f', round(a.f::numeric, 4),
                                               'h', round(a.h::numeric, 2), 'm', a.m, 'v', a.v, 'a', round(extract(epoch from (now() - a.at)) * 1000))
                            || case when a.k = any (coalesce(p_known[1:60], '{}'::text[])) then '{}'::jsonb else _av_me_json(a.user_id) end
                            order by a.zd), '[]'::jsonb)
    into zo
    from (select q.*, (q.x - p_x) ^ 2 + (q.y - p_y) ^ 2 zd from av_pos q
           where q.k <> p_k and q.at > now() - interval '12 seconds' and abs(q.x - p_x) < 8 and abs(q.y - p_y) < 8
           order by zd limit 30) a;
  return jsonb_build_object('o', zo);
end $$;

create or replace function public.ad_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  return _ad_json(u) || jsonb_build_object('gacha', _gacha_json(),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', g.kind, 'cost', g.cost, 'x', g.x, 'land', g.detail->'land', 'items', g.detail->'items', 'skin', g.detail->'skin',
                       'at_ms', (extract(epoch from g.at) * 1000)::bigint) order by g.id desc)
                       from (select * from gacha_log where user_id = u order by id desc limit 20) g), '[]'::jsonb),
    'skin_own', case when _is_admin(u)   -- 持っている見た目（DB の更新118）。管理者は ぜんぶ（DB の更新121）
                     then coalesce((select jsonb_object_agg(s.code, greatest(coalesce(o.n, 0), 1)) from av_skins s left join av_own o on o.user_id = u and o.code = s.code where s.enabled), '{}'::jsonb)
                     else coalesce((select jsonb_object_agg(o.code, o.n) from av_own o where o.user_id = u), '{}'::jsonb) end);
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
    if 'skin' = any(_beta_games()) and not _is_admin(u) then raise exception 'スキンガチャは もうすぐ 引けるようになります（カミングスーン）'; end if;   -- 準備中（DB の更新121）
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

-- はじめは スキンガチャだけ 準備中に（ほかの準備中のものは そのまま）
insert into public.app_settings(key, value) values ('beta_games', 'skin')
on conflict (key) do update set value = (select string_agg(distinct y, ',' order by y) from unnest(string_to_array(app_settings.value, ',') || array['skin']) y where y <> '');
