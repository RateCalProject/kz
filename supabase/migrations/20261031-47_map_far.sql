-- 地図：遠くを軽く見る。3D の遠くの地形（あらい版）と、遠くの建物（かんたんな形）を読む関数（見るだけ。ゲームの決まりは変えない）
--   mp_chunk_lo：チャンクの地形を 16×16 に（ふつうの 1/16）。mp_blds_lite：192 マス四方の建物（種類・階・外がわの四角）
--   建物のかんたんな形はサーバーにとっておき（mp_lite_cache）、みんなで使う。土地・建物が変わるか6時間で作りなおす

create table if not exists public.mp_lite_cache (
  i    int not null,
  j    int not null,
  ver  bigint not null,              -- 作ったときの mp_changes の ver
  data jsonb not null,
  at   timestamptz not null default now(),
  primary key (i, j)
);
alter table public.mp_lite_cache enable row level security;
revoke all on public.mp_lite_cache from anon, authenticated;

-- 地形の あらい版（t・e・z を 16×16 に）
create or replace function public.mp_chunk_lo(p_keys int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r jsonb;
begin
  perform _mp_ok(u);
  if coalesce(array_length(p_keys, 1), 0) > 512 then raise exception '一度に読めるのは256チャンクまでです'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('cx', c.cx, 'cy', c.cy,
           't', (select string_agg(chr(get_byte(c.tb, s.k)), '' order by s.n) from _mp_lo_idx() s),
           'e', (select string_agg(chr(get_byte(c.eb, s.k)), '' order by s.n) from _mp_lo_idx() s),
           'z', (select string_agg(chr(get_byte(c.zb, s.k)), '' order by s.n) from _mp_lo_idx() s))), '[]'::jsonb)
    into r
    from (select ch.cx, ch.cy, convert_to(ch.t, 'UTF8') tb, convert_to(ch.e, 'UTF8') eb, convert_to(ch.z, 'UTF8') zb
            from mp_chunks ch join (select p_keys[2 * i - 1] kx, p_keys[2 * i] ky from generate_series(1, coalesce(array_length(p_keys, 1), 0) / 2) i) k
              on ch.cx = k.kx and ch.cy = k.ky) c;
  return r;
end $$;
-- 16×16 のとりかた：4マスごとのまん中（バイトの位置。0 から）
create or replace function public._mp_lo_idx() returns table(n int, k int)
language sql immutable as $$
  select g, (4 * (g / 16) + 2) * 64 + 4 * (g % 16) + 2 from generate_series(0, 255) g
$$;

-- 0〜4095 を B64 の2文字に（はみ出したら はし）
create or replace function public._mp_b64n(v int) returns text
language sql immutable as $$
  select substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', least(greatest(v, 0), 4095) / 64 + 1, 1)
      || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', least(greatest(v, 0), 4095) % 64 + 1, 1)
$$;

-- 建物のかんたんな形（192 マス四方。i, j はそのます目）
--   返す：k（種類の一覧）・b（建物ごとに 12文字：種類の番号・階・x0＋64・y0＋64・はば・高さ を 2文字ずつ（B64）。x0・y0 は ます目の左上から、10m の区画で）
--   作ってから2分は、変わっていてもそのまま返す（遠くの見た目なので。作りなおしが多くなりすぎないように）
create or replace function public.mp_blds_lite(p_i int, p_j int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); c mp_lite_cache; v bigint; bx box; d jsonb; ox int := p_i * 960; oy int := p_j * 960;
begin
  perform _mp_ok(u);
  if p_i is null or p_j is null or abs(p_i) > 400 or abs(p_j) > 400 then raise exception '範囲がちがいます'; end if;
  v := coalesce((select max(ver) from mp_changes), 0);
  bx := box(point(p_i * 192, p_j * 192), point((p_i + 1) * 192, (p_j + 1) * 192));
  select * into c from mp_lite_cache where i = p_i and j = p_j;
  if found and (c.at > now() - interval '2 minutes' or c.at > now() - interval '6 hours'
     and (c.ver = v or (coalesce((select min(ver) from mp_changes), 0) <= c.ver + 1
                        and not exists (select 1 from mp_changes x where x.ver > c.ver and x.kind = 'land' and (x.bb is null or x.bb && bx))))) then
    if c.ver < v then update mp_lite_cache set ver = v where i = p_i and j = p_j and ver < v; end if;
    return c.data;
  end if;
  with b as (
    select bl.id, bl.kind, bl.floors, min(bl.cells[2 * g - 1]) x0, min(bl.cells[2 * g]) y0, max(bl.cells[2 * g - 1]) x1, max(bl.cells[2 * g]) y1
      from mp_blds bl, generate_series(1, array_length(bl.cells, 1) / 2) g
     where point(bl.cells[1], bl.cells[2]) <@ box(point(ox, oy), point(ox + 959.5, oy + 959.5))
     group by bl.id, bl.kind, bl.floors
  ), k as (select kind, row_number() over (order by kind) - 1 ki from (select distinct kind from b) z)
  select jsonb_build_object('i', p_i, 'j', p_j, 'k', coalesce((select jsonb_agg(kind order by ki) from k), '[]'::jsonb),
           'b', coalesce((select string_agg(_mp_b64n(k.ki::int) || _mp_b64n(greatest(b.floors, 0)) || _mp_b64n(b.x0 - ox + 64) || _mp_b64n(b.y0 - oy + 64)
                                            || _mp_b64n(b.x1 - b.x0 + 1) || _mp_b64n(b.y1 - b.y0 + 1), '' order by b.y0, b.x0, b.id) from b join k on k.kind = b.kind), ''))
    into d;
  insert into mp_lite_cache(i, j, ver, data, at) values (p_i, p_j, v, d, now())
  on conflict (i, j) do update set ver = excluded.ver, data = excluded.data, at = excluded.at;
  return d;
end $$;

revoke all on function public._mp_lo_idx() from public, anon, authenticated;
revoke all on function public._mp_b64n(int) from public, anon, authenticated;
revoke all on function public.mp_chunk_lo(int[]) from public, anon;
grant execute on function public.mp_chunk_lo(int[]) to authenticated;
revoke all on function public.mp_blds_lite(int, int) from public, anon;
grant execute on function public.mp_blds_lite(int, int) to authenticated;
