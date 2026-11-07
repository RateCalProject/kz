-- DB の更新127：街歩きの 通信（乗っている 列車・乗り物の中の 位置 r を ほかの人に。すわる m=6）・見た目（髪の色 12・はだの色 10・髪型 10）
--   r：'t|系統|列車|何両目|x|z|向き'（列車の中）か 'v|運転する人の しるし|x|y|z'（乗り物の上）。受けとった端末が 自分の 列車・乗り物の 位置から 組み立てる

alter table public.av_pos add column if not exists r text;   -- 乗っているもの（DB の更新127）
drop function if exists public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[], int, bigint);
create or replace function public.av_step(p_k text, p_x double precision, p_y double precision, p_f double precision, p_h double precision,
                                          p_m int default 0, p_v int default 0, p_known text[] default null, p_i int default 0, p_c bigint default null, p_r text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zo jsonb; zc jsonb;
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
  insert into av_pos as a (k, user_id, x, y, f, h, m, v, i, r, at)
  values (p_k, zu, p_x, p_y, p_f, p_h, least(7, greatest(0, coalesce(p_m, 0))), coalesce(p_v, 0), least(31, greatest(0, coalesce(p_i, 0))),
          case when p_r ~ '^[tv]\|[A-Za-z0-9_.:|-]{1,100}$' then p_r end, now())   -- うごき 0〜7（6 すわる）・持ち物（DB の更新122）・乗っているもの r（DB の更新127）
  on conflict (k) do update set x = excluded.x, y = excluded.y, f = excluded.f, h = excluded.h, m = excluded.m, v = excluded.v, i = excluded.i, r = excluded.r, at = excluded.at;
  if random() < 0.02 then delete from av_pos a where a.at < now() - interval '1 minute'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', a.k, 'x', round(a.x::numeric, 4), 'y', round(a.y::numeric, 4), 'f', round(a.f::numeric, 4),
                                               'h', round(a.h::numeric, 2), 'm', a.m, 'v', a.v, 'i', a.i, 'a', round(extract(epoch from (now() - a.at)) * 1000))
                            || case when a.r is not null then jsonb_build_object('r', a.r) else '{}'::jsonb end
                            || case when a.k = any (coalesce(p_known[1:60], '{}'::text[])) then '{}'::jsonb else _av_me_json(a.user_id) end
                            order by a.zd), '[]'::jsonb)
    into zo
    from (select q.*, (q.x - p_x) ^ 2 + (q.y - p_y) ^ 2 zd from av_pos q
           where q.k <> p_k and q.at > now() - interval '12 seconds' and abs(q.x - p_x) < 8 and abs(q.y - p_y) < 8
           order by zd limit 30) a;
  -- チャット（DB の更新122）：近く（400m）の 1分以内のもの。p_c より あとのもの（はじめは 1分ぶん）。新しいほうから 20こまで
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'k', c.k, 't', c.t, 'n', (select p.nickname from profiles p where p.id = c.user_id),
                                               'a', round(extract(epoch from (now() - c.at)) * 1000)) order by c.id), '[]'::jsonb)
    into zc
    from (select q.* from av_chat q where q.id > coalesce(p_c, 0) and q.at > now() - interval '1 minute' and abs(q.x - p_x) < 8 and abs(q.y - p_y) < 8
           order by q.id desc limit 20) c;
  return jsonb_build_object('o', zo, 'c', zc);
end $$;
revoke all on function public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[], int, bigint, text) from public, anon;
grant execute on function public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[], int, bigint, text) to authenticated;

create or replace function public.av_set(p_code text, p_look jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zc text; zh int; zs int; zy int;
begin
  select s.code into zc from av_skins s where s.code = p_code and s.enabled;
  if zc is null then raise exception 'その見た目は ありません'; end if;
  if zc <> 'base' and not _is_admin(zu) and not exists (select 1 from av_own o where o.user_id = zu and o.code = zc) then   -- 管理者は ぜんぶ（DB の更新121）
    raise exception 'その見た目は まだ持っていません（スキンガチャで当たります）';
  end if;
  -- 髪の色 h 0〜11・はだの色 s 0〜9・髪型 y 0〜9（DB の更新127）
  select case when m.look->>'h' ~ '^([0-9]|1[01])$' then (m.look->>'h')::int end, case when m.look->>'s' ~ '^[0-9]$' then (m.look->>'s')::int end,
         case when m.look->>'y' ~ '^[0-9]$' then (m.look->>'y')::int end
    into zh, zs, zy from av_me m where m.user_id = zu;
  if p_look is not null and jsonb_typeof(p_look) = 'object' then
    if coalesce(p_look->>'h', '') ~ '^([0-9]|1[01])$' then zh := (p_look->>'h')::int; end if;
    if coalesce(p_look->>'s', '') ~ '^[0-9]$' then zs := (p_look->>'s')::int; end if;
    if coalesce(p_look->>'y', '') ~ '^[0-9]$' then zy := (p_look->>'y')::int; end if;
  end if;
  insert into av_me(user_id, code, look, at) values (zu, zc, jsonb_build_object('h', coalesce(zh, 0), 's', coalesce(zs, 0), 'y', coalesce(zy, 0)), now())
  on conflict (user_id) do update set code = excluded.code, look = excluded.look, at = now();
  return _av_me_json(zu);
end $$;
revoke all on function public.av_set(text, jsonb) from public, anon;
grant execute on function public.av_set(text, jsonb) to authenticated;
