-- 国土 5×5 の準備（新しい土地を入れる前に入れてよい。いまの地図・ゲームの決まりは変わらない）
--   1) 大きい島は、島のマスをチャンクごとに（mp_islchunk：陸がぜんぶ同じ島のチャンク）。マスで持つと 1,400万行になるので
--   2) 島の判定（_mp_isl_at）：マス（mp_isltile）になければ、チャンク（mp_islchunk）を見る
--   3) 人口のかたまり（mp_centers）が 332 から 約7,500 になるので、1マスの人口（_mp_dens）・円の中の人（_mp_catch）は、
--      とどく範囲の四角（rb）の索引で、かかわるものだけを見る（答えは今と同じ）

create table if not exists public.mp_islchunk (       -- 島のチャンク（陸がぜんぶ同じ島のチャンク）。本土・本土とまじるチャンクはない
  cx int not null, cy int not null, isl text not null,
  primary key (cx, cy)
);
alter table public.mp_islchunk enable row level security;
revoke all on public.mp_islchunk from public, anon, authenticated;

-- 島（mp_isltile・mp_islchunk）：そのマスの島（本土は null）
create or replace function public._mp_isl_at(tx int, ty int) returns text
language sql stable set search_path = public as $$
  select coalesce((select isl from mp_isltile where x = tx and y = ty), (select isl from mp_islchunk where cx = tx >> 6 and cy = ty >> 6))
$$;

-- 人口のかたまりの、とどく範囲（_mp_dens の「sg × 14 + 40 マス」の四角）
alter table public.mp_centers add column if not exists rb box
  generated always as (box(point(x - (sg * 14 + 40), y - (sg * 14 + 40)), point(x + (sg * 14 + 40), y + (sg * 14 + 40)))) stored;
create index if not exists mp_centers_rb on public.mp_centers using gist (rb);

-- 1マスの人口（人）
create or replace function public._mp_dens(px real, py real) returns real
language sql stable set search_path = public as $$
  select coalesce(sum(c.dp / (pi() * c.sg * c.sg) / power(1 + ((px - c.x) ^ 2 + (py - c.y) ^ 2) / (c.sg * c.sg), 2)), 0)::real
    from mp_centers c where c.rb && box(point(px, py), point(px, py)) and abs(px - c.x) < c.sg * 14 + 40 and abs(py - c.y) < c.sg * 14 + 40
$$;
-- 半径 r の円の中の人（まちの分。大まかな式：人口のかたまりごとに、円の中の割合を足す）
create or replace function public._mp_catch(px real, py real, r real) returns real
language sql stable set search_path = public as $$
  select coalesce(sum(c.dp * (
           -- かたまりの中心から d の円（半径 r）の中の割合 ≒ r² / (sg² + r² + d²) をもとに、遠いほど小さく
           (r * r) / (c.sg * c.sg + r * r + ((px - c.x) ^ 2 + (py - c.y) ^ 2)) / (1 + ((px - c.x) ^ 2 + (py - c.y) ^ 2) / (c.sg * c.sg + r * r)))), 0)::real
    from mp_centers c where c.rb && box(point(px - r, py - r), point(px + r, py + r)) and abs(px - c.x) < c.sg * 14 + r + 40 and abs(py - c.y) < c.sg * 14 + r + 40
$$;
