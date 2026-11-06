-- DB の更新119：街を歩く人の位置を サーバーで やりとりする（Supabase Realtime は使わない。サーバーと それぞれの端末のあいだだけ）
--   av_pos：歩いている人の いまの位置（しるしごと。ログを残さない表。12秒 送ってこない人は 見せない・1分で消す）
--   av_step(しるし, x, y, 足もとの高さ, 向き, うごき, 見た目の番号, 知っている しるし[])：自分の位置を送って、近く（400m）の人の位置を受けとる（30人まで）。
--     知らない人（と 見た目を変えた人）だけ、名前と見た目（n・c・l）もつける。うごき：0 止まる・1 歩く・2 走る・-1 やめた（自分の位置を消す）
--   端末は、受けとった位置・向き・うごきから その人を組み立てて、つぎの位置まで なめらかに動かす

-- 街を歩く人の いまの位置（DB の更新119）。ログを残さない（サーバーを入れなおすと 空になる。それでよい）
create unlogged table if not exists public.av_pos (
  k       text primary key,                                                -- 歩くときの しるし（av_walk）
  user_id uuid not null references public.profiles(id) on delete cascade,
  x       double precision not null,                                       -- 位置（マス）
  y       double precision not null,
  f       double precision not null,                                       -- 足もとの高さ（3D）
  h       real not null default 0,                                         -- 向き
  m       smallint not null default 0,                                     -- 0 止まる・1 歩く・2 走る
  v       int not null default 0,                                          -- 見た目の番号（変えたら かわる）
  at      timestamptz not null default now()
);
create index if not exists av_pos_at_idx on public.av_pos(at);
alter table public.av_pos enable row level security;
revoke all on public.av_pos from anon, authenticated;

-- 自分の位置を送って、近く（400m）の人の位置を受けとる（DB の更新119）
create or replace function public.av_step(p_k text, p_x double precision, p_y double precision, p_f double precision, p_h double precision,
                                          p_m int default 0, p_v int default 0, p_known text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zo jsonb;
begin
  if p_k is null or not exists (select 1 from av_walk w where w.k = p_k and w.user_id = zu and w.at > now() - interval '1 day') then
    raise exception 'walk_k：歩くしるしが古くなりました';
  end if;
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
revoke all on function public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[]) from public, anon;
grant execute on function public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[]) to authenticated;
