-- DB の更新124：街歩きに フレンドを よぶ
--   歩いている人が フレンドを よぶと、その人に 通知（【街歩き】）が とどく。よばれた人は 10分のあいだ、よんだ人の近くから 歩きはじめられる
--   （よんだ人が いま 歩いているときだけ。よんだ人の位置は よばれた人にだけ わたす）。招待は ログを残さない（av_inv。1時間で消す）

-- 街歩きの 招待（DB の更新124）。ログを残さない（1時間で消す。サーバーを入れなおすと 空になる）
create unlogged table if not exists public.av_inv (
  id        bigserial primary key,
  from_user uuid not null references public.profiles(id) on delete cascade,   -- よんだ人
  to_user   uuid not null references public.profiles(id) on delete cascade,   -- よばれた人（フレンド）
  at        timestamptz not null default now()
);
create index if not exists av_inv_to_idx on public.av_inv(to_user, at desc);
create index if not exists av_inv_from_idx on public.av_inv(from_user, at desc);
alter table public.av_inv enable row level security;
revoke all on public.av_inv from anon, authenticated;
revoke all on sequence public.av_inv_id_seq from anon, authenticated;

-- フレンドを よぶ（DB の更新124）：自分が いま 歩いているときだけ。同じ人には 1分に1回・10分に 10回まで。よばれた人に 通知（おすと 近くから 歩く）
create or replace function public.av_invite(p_k text, p_to text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare zu uuid := _me_g(); zt record; zn text; za text; zid bigint;
begin
  if p_k is null or not exists (select 1 from av_walk w where w.k = p_k and w.user_id = zu and w.at > now() - interval '1 day') then
    raise exception 'walk_k：歩くしるしが古くなりました';
  end if;
  if 'walk' = any(_beta_games()) and not _is_admin(zu) then raise exception '街を歩くのは もうすぐ できるようになります（カミングスーン）'; end if;
  if not exists (select 1 from av_pos a where a.k = p_k and a.user_id = zu and a.at > now() - interval '30 seconds') then
    raise exception 'いまは 街に いません（もう一度 歩きはじめてください）';
  end if;
  select * into zt from _find_id(p_to);
  if zt.rid is null or zt.rid = zu or not _is_friend(zu, zt.rid) then raise exception 'よべるのは フレンドだけです'; end if;
  perform pg_advisory_xact_lock(7634, hashtext(zu::text));
  if exists (select 1 from av_inv i where i.from_user = zu and i.to_user = zt.rid and i.at > now() - interval '1 minute') then
    raise exception '同じ人を よぶのは 1分に 1回までです';
  end if;
  if (select count(*) from av_inv i where i.from_user = zu and i.at > now() - interval '10 minutes') >= 10 then raise exception 'よぶのは 10分に 10回までです'; end if;
  if random() < 0.1 then delete from av_inv i where i.at < now() - interval '1 hour'; end if;
  insert into av_inv(from_user, to_user) values (zu, zt.rid) returning id into zid;
  select p.nickname, p.account_no into zn, za from profiles p where p.id = zu;
  perform _notice_l(zt.rid, format('【街歩き】%s（ID %s）が 街歩きに よんでいます。10分のあいだ、ここを おすと その人の近くから 歩きはじめます。', zn, za),
                    jsonb_build_object('go', 'map', 'k', 'walk', 'i', zid), zu);
  return jsonb_build_object('ok', true, 'n', zt.rname);
end $$;
revoke all on function public.av_invite(text, text) from public, anon;
grant execute on function public.av_invite(text, text) to authenticated;

-- とどいている 招待（DB の更新124）：10分以内・よんだ人が いま 歩いている。人ごとに 新しいもの 1つ（5人まで）
create or replace function public.av_invites() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare zu uuid := _me_g();
begin
  if zu is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('i', z.id, 'n', p.nickname) order by z.id desc)
                     from (select distinct on (i.from_user) i.id, i.from_user from av_inv i
                            where i.to_user = zu and i.at > now() - interval '10 minutes' and _is_friend(zu, i.from_user)
                              and exists (select 1 from av_pos a where a.user_id = i.from_user and a.at > now() - interval '30 seconds')
                            order by i.from_user, i.id desc) z
                     join profiles p on p.id = z.from_user
                    where z.id in (select y.id from av_inv y where y.to_user = zu order by y.id desc limit 50)), '[]'::jsonb);
end $$;
revoke all on function public.av_invites() from public, anon;
grant execute on function public.av_invites() to authenticated;

-- 招待で 歩きはじめる（DB の更新124）：よんだ人の いまの位置（よばれた人にだけ。10分まで・その人が 歩いているときだけ）
create or replace function public.av_join(p_i bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare zu uuid := _me_g(); zv av_inv; zx double precision; zy double precision; zf double precision;
begin
  if 'walk' = any(_beta_games()) and not _is_admin(zu) then raise exception '街を歩くのは もうすぐ できるようになります（カミングスーン）'; end if;
  select * into zv from av_inv i where i.id = p_i and i.to_user = zu;
  if not found or zv.at < now() - interval '10 minutes' then raise exception 'この招待は もう つかえません（10分まで）'; end if;
  if not _is_friend(zu, zv.from_user) then raise exception 'よべるのは フレンドだけです'; end if;
  select a.x, a.y, a.f into zx, zy, zf from av_pos a where a.user_id = zv.from_user and a.at > now() - interval '30 seconds' order by a.at desc limit 1;
  if not found then raise exception 'よんだ人は いま 街を歩いていません'; end if;
  return jsonb_build_object('x', round(zx::numeric, 4), 'y', round(zy::numeric, 4), 'f', round(zf::numeric, 4), 'n', (select p.nickname from profiles p where p.id = zv.from_user));
end $$;
revoke all on function public.av_join(bigint) from public, anon;
grant execute on function public.av_join(bigint) to authenticated;
