-- DB の更新122：街を歩く（t68）：しゃがむ・ジャンプ・持ち物（E）・近くの人との チャット（/・Z）。122系に 3D のモデル
--   av_pos に i（持ち物の番号）。うごき m は 0〜5（0 止まる・1 歩く・2 走る・3 しゃがむ・4 しゃがんで歩く・5 ジャンプした）
--   av_step(…, p_i 持ち物, p_c 受けとった チャットの番号)：近くの人の 持ち物 i と、近く（400m）の チャット（1分以内・20こまで。c）も返す
--   av_chat：チャット（ログを残さない表。10分で消す）。av_say(しるし, ことば)：60文字まで。URL・メールアドレス・電話番号は 書けない。1.5秒に1回・1分に15回まで
--   122系0番台（mp_series 122-0）に 3D のモデル（mdl = 'r122'。map/m3car.js）

alter table public.av_pos add column if not exists i smallint not null default 0;   -- 持ち物（DB の更新122）

-- 持ち物・チャット（p_i・p_c）を足すので、前の形（DB の更新119）を けしてから
drop function if exists public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[]);
-- 自分の位置を送って、近く（400m）の人の位置を受けとる（DB の更新119）。持ち物・チャットも（DB の更新122）
create or replace function public.av_step(p_k text, p_x double precision, p_y double precision, p_f double precision, p_h double precision,
                                          p_m int default 0, p_v int default 0, p_known text[] default null, p_i int default 0, p_c bigint default null) returns jsonb
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
  insert into av_pos as a (k, user_id, x, y, f, h, m, v, i, at)
  values (p_k, zu, p_x, p_y, p_f, p_h, least(5, greatest(0, coalesce(p_m, 0))), coalesce(p_v, 0), least(31, greatest(0, coalesce(p_i, 0))), now())   -- うごき 0〜5・持ち物（DB の更新122）
  on conflict (k) do update set x = excluded.x, y = excluded.y, f = excluded.f, h = excluded.h, m = excluded.m, v = excluded.v, i = excluded.i, at = excluded.at;
  if random() < 0.02 then delete from av_pos a where a.at < now() - interval '1 minute'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', a.k, 'x', round(a.x::numeric, 4), 'y', round(a.y::numeric, 4), 'f', round(a.f::numeric, 4),
                                               'h', round(a.h::numeric, 2), 'm', a.m, 'v', a.v, 'i', a.i, 'a', round(extract(epoch from (now() - a.at)) * 1000))
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
revoke all on function public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[], int, bigint) from public, anon;
grant execute on function public.av_step(text, double precision, double precision, double precision, double precision, int, int, text[], int, bigint) to authenticated;

-- 街を歩く人の チャット（DB の更新122）。ログを残さない（10分で消す。サーバーを入れなおすと 空になる）
create unlogged table if not exists public.av_chat (
  id      bigserial primary key,
  k       text not null,                                                   -- 言った人の しるし（av_walk）
  user_id uuid not null references public.profiles(id) on delete cascade,
  x       double precision not null,                                       -- 言った場所（マス）
  y       double precision not null,
  t       text not null,                                                   -- ことば（60文字まで）
  at      timestamptz not null default now()
);
create index if not exists av_chat_at_idx on public.av_chat(at);
create index if not exists av_chat_user_idx on public.av_chat(user_id, at);
alter table public.av_chat enable row level security;
revoke all on public.av_chat from anon, authenticated;
revoke all on sequence public.av_chat_id_seq from anon, authenticated;

-- チャットを言う（DB の更新122）：近く（400m）の 歩いている人に 見える。60文字まで。URL・メールアドレス・電話番号は 書けない。1.5秒に1回・1分に15回まで
create or replace function public.av_say(p_k text, p_t text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zx double precision; zy double precision; zt text; zh text; zn int; zid bigint;
begin
  if p_k is null or not exists (select 1 from av_walk w where w.k = p_k and w.user_id = zu and w.at > now() - interval '1 day') then
    raise exception 'walk_k：歩くしるしが古くなりました';
  end if;
  if 'walk' = any(_beta_games()) and not _is_admin(zu) then raise exception '街を歩くのは もうすぐ できるようになります（カミングスーン）'; end if;
  select a.x, a.y into zx, zy from av_pos a where a.k = p_k and a.user_id = zu and a.at > now() - interval '30 seconds';
  if not found then raise exception 'いまは 街に いません（もう一度 歩きはじめてください）'; end if;
  zt := btrim(regexp_replace(regexp_replace(coalesce(p_t, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  if zt = '' then raise exception 'ことばを 入れてください'; end if;
  if char_length(zt) > 60 then raise exception 'チャットは 60文字までです'; end if;
  -- しらべる文（全角の 英数字・記号は 半角に）
  zh := lower(translate(zt, '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ＠．：／－ー―‐',
                              '0123456789abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz@.:/----'));
  if zh ~ '(https?:|www\.|[a-z0-9-]+\.(com|net|org|jp|io|co|me|info|xyz|ly|gg|tv|app|dev)([^a-z]|$))' then raise exception 'URL は 書けません'; end if;
  if zh ~ '[a-z0-9._%+-]+@[a-z0-9-]+\.' then raise exception 'メールアドレスは 書けません'; end if;
  if zh ~ '(^|[^0-9])0[0-9]{9,10}([^0-9]|$)' or zh ~ '(^|[^0-9])0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}([^0-9]|$)' then raise exception '電話番号は 書けません'; end if;
  perform pg_advisory_xact_lock(7633, hashtext(zu::text));
  if exists (select 1 from av_chat c where c.user_id = zu and c.at > now() - interval '1.5 seconds') then raise exception 'すこし まってから 送ってください'; end if;
  select count(*) into zn from av_chat c where c.user_id = zu and c.at > now() - interval '1 minute';
  if zn >= 15 then raise exception 'チャットは 1分に 15回までです'; end if;
  insert into av_chat(k, user_id, x, y, t) values (p_k, zu, zx, zy, zt) returning id into zid;
  if random() < 0.05 then delete from av_chat c where c.at < now() - interval '10 minutes'; end if;
  return jsonb_build_object('id', zid, 't', zt);
end $$;
revoke all on function public.av_say(text, text) from public, anon;
grant execute on function public.av_say(text, text) to authenticated;

update public.mp_series set mdl = 'r122' where code = '122-0' and mdl is null;   -- 122系に 3D のモデル（map/m3car.js。DB の更新122）
