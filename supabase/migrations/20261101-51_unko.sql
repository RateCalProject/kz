-- 列車の遅れ・運転見合わせ（運行の乱れ）：雪・大雨・強風（地図の天気と同じ式）・人と接触・急病のお客さま・車両の点検・信号の確認・線路内の点検
--   自分の線なら🔔で対応を 1〜3 でえらぶ（正しいと早く回復・まちがえると もっと遅れる。10分えらばないと現場の判断＝安全なほう）
--   運転見合わせ中に始発駅を出る列車は運休（運賃なし）。遅れが大きいほど お客がへる。見合わせが長いときは振替輸送をたのめる
--   たのまずに合わせて1時間より長く止めると、その線の「信頼」が下がる（お客が少しへる。1日に1％ずつもどる）
--   5分ごとの処理（_mp_unko_tick）。天気の関数（_wx_*）は map/wx.js と同じ式（風を新しく入れた）

-- ---------------------------------------------------------------------
-- 系統の信頼（運行の乱れの対応で下がる。0.7〜1。お客の数にかける）
alter table public.mp_routes add column if not exists trust real not null default 1;

-- 運行の乱れ
create table if not exists public.mp_unko (
  id bigserial primary key,
  kind text not null,                   -- wind・rain・snow（天気）・person（人と接触）・sick（急病のお客さま）・car（車両）・signal（信号）・track（線路内）
  sub text not null default '',         -- くわしい原因（ことば）
  sta bigint,                           -- 起きた駅（天気は いちばんひどいところの駅）
  x int not null, y int not null,       -- 場所（駅と同じ ×100 マス）
  routes bigint[] not null,             -- かかわる系統（鉄道）
  own_u uuid, own_c int,                -- 対応をえらぶ人（駅の持ち主・天気は系統の持ち主）。どちらもなし＝国
  lv int not null,                      -- 正しい対応：1 いつもどおり・2 徐行・点検しながら・3 運転見合わせ
  sev real, sevmax real,                -- 強さ（風：最大瞬間 m/s・雨：1時間 mm・雪：1時間 cm）。いまと、これからの いちばん強いところ（予報）
  t0 timestamptz not null default now(),
  dur int not null,                     -- 正しく対応したときの長さ（秒）
  ask_until timestamptz,                -- えらべるのは いつまで
  pick int, pick_at timestamptz, pick_auto boolean,
  wins jsonb not null default '[]'::jsonb,   -- 列車の速さ：[[はじめ, おわり（1970年からの秒）, 速さ（0 止まる・0.6 徐行）], …]
  t_end timestamptz,                    -- 窓のおわり（ここから遅れがもどる）
  st text not null default 'ask',       -- ask（対応をえらぶのを待つ）・run（対応中）・done（おわり）
  furi bigint[] not null default '{}',  -- 振替輸送をたのんだ系統
  log jsonb not null default '[]'::jsonb     -- [[1970年からの秒, ことば], …]（先の時刻のものは、その時刻になってから見せる）
);
create index if not exists mp_unko_live on public.mp_unko (st) where st <> 'done';
create index if not exists mp_unko_routes on public.mp_unko using gin (routes);
create index if not exists mp_unko_tend on public.mp_unko (t_end);
alter table public.mp_unko enable row level security;
revoke all on public.mp_unko from public, anon, authenticated;
revoke all on sequence public.mp_unko_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 国土の天気（map/wx.js と同じ式）：サーバーでも、列車の遅れ（雪・大雨・強風）を決めるのに使う
--   場所（マス）と時刻（ミリ秒）だけで決まる。乱数の種は固定（だれが見ても同じ）
-- ---------------------------------------------------------------------
-- 場所と時刻だけで決まる乱数（−1〜1）。wx.js の hash3（Math.imul：32ビットのかけ算）と同じ
create or replace function public._wx_h3(i int, j int, k int, s int) returns float8
language plpgsql immutable parallel safe as $$
declare h bigint;
begin
  h := ((i::bigint * 668265261) & 4294967295) # ((j::bigint * 374761393) & 4294967295) # ((k::bigint * 461845907) & 4294967295) # ((s::bigint * -2048144789) & 4294967295);
  h := ((h # (h >> 15)) * 739982445) & 4294967295;
  h := ((h # (h >> 12)) * 695872825) & 4294967295;
  h := h # (h >> 15);
  return h::float8 / 4294967296 * 2 - 1;
end $$;
-- なめらかな雑音（場所 a km・時刻 b 時間の格子）
create or replace function public._wx_noise(xk float8, yk float8, th float8, a float8, b float8, s int) returns float8
language plpgsql immutable parallel safe as $$
declare fx float8 := xk / a; fy float8 := yk / a; ft float8 := th / b; i int; j int; k int; u float8; v float8; w float8; r float8 := 0; t float8;
begin
  i := floor(fx); j := floor(fy); k := floor(ft);
  t := fx - i; u := t * t * (3 - 2 * t);
  t := fy - j; v := t * t * (3 - 2 * t);
  t := ft - k; w := t * t * (3 - 2 * t);
  r := r + _wx_h3(i, j, k, s) * (1 - u) * (1 - v) * (1 - w);
  r := r + _wx_h3(i + 1, j, k, s) * u * (1 - v) * (1 - w);
  r := r + _wx_h3(i, j + 1, k, s) * (1 - u) * v * (1 - w);
  r := r + _wx_h3(i + 1, j + 1, k, s) * u * v * (1 - w);
  r := r + _wx_h3(i, j, k + 1, s) * (1 - u) * (1 - v) * w;
  r := r + _wx_h3(i + 1, j, k + 1, s) * u * (1 - v) * w;
  r := r + _wx_h3(i, j + 1, k + 1, s) * (1 - u) * v * w;
  r := r + _wx_h3(i + 1, j + 1, k + 1, s) * u * v * w;
  return r;
end $$;
-- 気温のずれ（何日も）・雲（半日）・気圧（高気圧・低気圧）。どれも西から東へ動く
create or replace function public._wx_na(xk float8, yk float8, th float8) returns float8
language sql immutable parallel safe as $$ select 0.8::float8 * _wx_noise(xk - 28 * th, yk, th, 450, 70, 11) + 0.5::float8 * _wx_noise(xk - 20 * th, yk, th, 1100, 220, 12) $$;
create or replace function public._wx_nc(xk float8, yk float8, th float8) returns float8
language sql immutable parallel safe as $$ select 0.8::float8 * _wx_noise(xk - 32 * th, yk, th, 170, 20, 21) + 0.4::float8 * _wx_noise(xk - 32 * th, yk, th, 55, 6, 22) $$;
create or replace function public._wx_np(xk float8, yk float8, th float8) returns float8
language sql immutable parallel safe as $$ select 0.8::float8 * _wx_noise(xk - 30 * th, yk, th, 380, 48, 31) + 0.45::float8 * _wx_noise(xk - 24 * th, yk, th, 900, 120, 32) $$;
-- 雑音のちらばり（wx.js の SA・SC・SP）と、雲の分布（QC：3000 この並び）。いつも同じ点ではかるので、だれでも同じ
create table if not exists public.mp_wx_k (k text primary key, v float8 not null);
create table if not exists public.mp_wx_qc (i int primary key, v float8 not null);
create index if not exists mp_wx_qc_v on public.mp_wx_qc (v, i);
alter table public.mp_wx_k enable row level security;
alter table public.mp_wx_qc enable row level security;
revoke all on public.mp_wx_k, public.mp_wx_qc from public, anon, authenticated;
do $$
declare q float8; v float8; i int; sa float8; sc float8; sp float8;
begin
  if (select count(*) from mp_wx_qc) = 3000 then return; end if;
  delete from mp_wx_k; delete from mp_wx_qc;
  q := 0; for i in 0..2999 loop v := _wx_na(i * 37.3::float8, i * 11.7::float8, i * 53.1::float8); q := q + v * v; end loop; sa := sqrt(q / 3000);
  q := 0; for i in 0..2999 loop v := _wx_nc(i * 37.3::float8, i * 11.7::float8, i * 53.1::float8); q := q + v * v; end loop; sc := sqrt(q / 3000);
  q := 0; for i in 0..2999 loop v := _wx_np(i * 37.3::float8, i * 11.7::float8, i * 53.1::float8); q := q + v * v; end loop; sp := sqrt(q / 3000);
  insert into mp_wx_k values ('sa', sa), ('sc', sc), ('sp', sp);
  insert into mp_wx_qc(i, v)
    select (row_number() over (order by z.v) - 1)::int, z.v
      from (select 0.75::float8 * _wx_nc(g.n * 97.1::float8, g.n * 41.3::float8, g.n * 13.7::float8) / sc
                   - 0.65::float8 * (_wx_np(g.n * 97.1::float8, g.n * 41.3::float8, g.n * 13.7::float8) / sp) v
              from generate_series(0, 2999) g(n)) z;
end $$;
-- 雲の分布の何番目か（0〜1）：wx.js の cdf と同じ（v より小さいものの数 ÷ 3000）
create or replace function public._wx_cdf(v float8) returns float8
language sql stable parallel safe set search_path = public as $$
  select coalesce((select q.i from mp_wx_qc q where q.v >= $1 order by q.v, q.i limit 1), 3000) / 3000.0::float8
$$;
-- その時刻・その場所の天気：T（℃）・wet（雨か雪が降っている）・inten（強さ 0〜1）・cl（雲）・p（hPa）・kind（snow・sleet・rain・''）
--   x・y はマス、e は標高 m、ms は 1970年からのミリ秒
create or replace function public._wx_core(x float8, y float8, e float8, ms bigint, out t float8, out wet boolean, out inten float8, out cl float8, out p float8, out kind text, out zp float8)
language plpgsql stable parallel safe set search_path = public as $$
declare jj bigint := ms + 32400000; yy int; y0 bigint; y1 bigint; th float8; c float8; s float8; c2 float8; hr float8; h float8;
        xk float8 := x * 0.05::float8; yk float8 := y * 0.05::float8; dn float8 := (54 - y) * 0.05::float8; base float8; pw float8; cu float8; amp float8; an float8; tc float8; g float8;
        d float8; n float8; v float8; dur float8; uu float8; kk float8;
        sa float8; sc float8; sp float8;
begin
  select max(case when q.k = 'sa' then q.v end), max(case when q.k = 'sc' then q.v end), max(case when q.k = 'sp' then q.v end) into sa, sc, sp from mp_wx_k q;
  -- 季節・時刻（日本時間）：wx.js の tinfo
  yy := extract(year from (date '1970-01-01' + (jj / 86400000)::int));
  y0 := ((make_date(yy, 1, 1) - date '1970-01-01')::bigint) * 86400000; y1 := ((make_date(yy + 1, 1, 1) - date '1970-01-01')::bigint) * 86400000;
  d := (jj - y0)::float8 / 86400000;
  th := 2 * pi() * ((jj - y0)::float8 / (y1 - y0)::float8 - 14.5::float8 / 365.25::float8);
  c := cos(th); s := sin(th); c2 := cos(2 * th); hr := (jj % 86400000)::float8 / 3600000; h := ms::float8 / 3600000;
  zp := _wx_np(xk, yk, h) / sp;
  base := 21.35::float8 - 7.83::float8 * c + 0.944::float8 * s + 0.785::float8 * c2;
  -- 雨・雪の降る割合：wx.js の wetP
  pw := 0.13::float8 + 0.11::float8 * exp(-(((d - 170) / 20) * ((d - 170) / 20))) + 0.05::float8 * exp(-(((d - 255) / 18) * ((d - 255) / 18))) - 0.03::float8 * c;
  n := greatest(0::float8, least(1::float8, dn / 300));
  pw := pw + n * (0.05::float8 + 0.22::float8 * greatest(0::float8, c));
  if dn < 0 then pw := pw + 0.03::float8 * least(1::float8, -dn / 300); end if;
  pw := greatest(0.05::float8, least(0.6::float8, pw));
  cu := _wx_cdf(0.75::float8 * _wx_nc(xk, yk, h) / sc - 0.65::float8 * zp);
  wet := cu > 1 - pw; inten := case when wet then (cu - (1 - pw)) / pw else 0 end;
  cl := case when wet then 1 when cu > 1 - pw - 0.28::float8 then 1 when cu > 1 - pw - 0.5::float8 then 0.5 else 0 end;
  amp := (3.75::float8 + 0.75::float8 * c) * (case when wet then 0.4::float8 when cl = 1 then 0.6::float8 when cl > 0 then 0.9::float8 else 1.2::float8 end);
  an := (2.4::float8 + 1.6::float8 * c) * _wx_na(xk, yk, h) / sa;
  -- 1日の気温の形：wx.js の diurnal
  if hr >= 6 and hr < 14.5 then dur := -cos(pi() * (hr - 6) / 8.5::float8);
  else uu := hr - 14.5::float8 + 24; if uu >= 24 then uu := uu - 24; end if; uu := uu / 15.5::float8; dur := cos(pi() * power(uu, 0.6::float8)); end if;
  v := base + amp * dur + an - (case when wet and c < 0 then 1.2::float8 else 0 end);
  -- 上と下をなめらかにおさえる：wx.js の soft(v, −2, 31, 3)
  if v > 31 - 3 then tc := 31 - 3 + 3 * tanh((v - 31 + 3) / 3);
  elsif v < -2 + 3 then tc := -2 + 3 + 3 * tanh((v + 2 - 3) / 3);
  else tc := v; end if;
  g := case when dn > 0 then (0.028::float8 + 0.012::float8 * c) * dn else (0.008::float8 + 0.004::float8 * c) * dn end;
  t := tc - g - 0.0065::float8 * greatest(0::float8, coalesce(e, 0));
  p := 1013 - 7 * zp + 6 * greatest(0::float8, c) * (-xk / 400) + 4 * greatest(0::float8, -c) * (yk / 400);
  kind := case when not wet then '' when t <= 0.6::float8 then 'snow' when t < 2.4::float8 then 'sleet' else 'rain' end;
end $$;
-- 1時間の雨（mm）・雪（cm）：wx.js の rainMM・snowCM
create or replace function public._wx_mm(inten float8) returns float8
language sql immutable parallel safe as $$ select least(100::float8, 0.3::float8 + 2.5::float8 * (power(greatest(1e-9::float8, 1 - inten), -0.6::float8) - 1)) $$;
create or replace function public._wx_cm(inten float8) returns float8
language sql immutable parallel safe as $$ select least(20::float8, 0.2::float8 + 1.2::float8 * (power(greatest(1e-9::float8, 1 - inten), -0.5::float8) - 1)) $$;
-- 風：地上の平均風速（m/s）・最大瞬間・ふいてくる向き（北 0・東 90）。wx.js の wind と同じ
create or replace function public._wx_wind(x float8, y float8, ms bigint, out spd float8, out gust float8, out dir int)
language plpgsql stable parallel safe set search_path = public as $$
declare o record; xk float8 := x * 0.05::float8; yk float8 := y * 0.05::float8; h float8 := ms::float8 / 3600000; c float8; sp float8; gx float8; gy float8; st float8; ue float8; vn float8;
        jj bigint := ms + 32400000; yy int; y0 bigint; y1 bigint; th float8;
begin
  select q.v into sp from mp_wx_k q where q.k = 'sp';
  yy := extract(year from (date '1970-01-01' + (jj / 86400000)::int));
  y0 := ((make_date(yy, 1, 1) - date '1970-01-01')::bigint) * 86400000; y1 := ((make_date(yy + 1, 1, 1) - date '1970-01-01')::bigint) * 86400000;
  th := 2 * pi() * ((jj - y0)::float8 / (y1 - y0)::float8 - 14.5::float8 / 365.25::float8); c := cos(th);
  gx := ((1013 - 7 * (_wx_np(xk + 20, yk, h) / sp) + 6 * greatest(0::float8, c) * (-(xk + 20) / 400) + 4 * greatest(0::float8, -c) * (yk / 400))
       - (1013 - 7 * (_wx_np(xk - 20, yk, h) / sp) + 6 * greatest(0::float8, c) * (-(xk - 20) / 400) + 4 * greatest(0::float8, -c) * (yk / 400))) / 40 * 100;
  gy := ((1013 - 7 * (_wx_np(xk, yk + 20, h) / sp) + 6 * greatest(0::float8, c) * (-xk / 400) + 4 * greatest(0::float8, -c) * ((yk + 20) / 400))
       - (1013 - 7 * (_wx_np(xk, yk - 20, h) / sp) + 6 * greatest(0::float8, c) * (-xk / 400) + 4 * greatest(0::float8, -c) * ((yk - 20) / 400))) / 40 * 100;
  o := _wx_core(x, y, 0, ms);
  st := case when o.wet and o.inten > 0.8 then 10 * ((o.inten - 0.8::float8) / 0.2::float8) * ((o.inten - 0.8::float8) / 0.2::float8) else 0 end;
  spd := 0.6::float8 + sqrt(gx * gx + gy * gy) + st; gust := spd * 1.6::float8;
  ue := gy * 0.8660254037844387::float8 - gx * 0.5::float8; vn := gy * 0.5::float8 + gx * 0.8660254037844387::float8;
  dir := ((round(atan2(ue, vn) * 180 / pi())::int + 180) % 360 + 360) % 360;
end $$;

-- ---------------------------------------------------------------------
-- 運行の乱れ：天気（その場所・その時刻）の強さ。風：最大瞬間 20m/s から 2（徐行）・25m/s から 3（見合わせ）、
--   雨：1時間 30mm から 2・50mm から 3、雪：1時間 3cm から 2・7cm から 3
create or replace function public._mp_unko_wxk(x float8, y float8, e float8, ms bigint, k text, out lv int, out sev float8)
language plpgsql stable set search_path = public as $$
declare o record; w record;
begin
  lv := 0; sev := 0;
  if k = 'wind' then
    w := _wx_wind(x, y, ms); sev := w.gust; lv := case when sev >= 25 then 3 when sev >= 20 then 2 else 0 end; return;
  end if;
  o := _wx_core(x, y, e, ms);
  if k = 'rain' and o.kind = 'rain' then sev := _wx_mm(o.inten); lv := case when sev >= 50 then 3 when sev >= 30 then 2 else 0 end; end if;
  if k = 'snow' and o.kind = 'snow' then sev := _wx_cm(o.inten); lv := case when sev >= 7 then 3 when sev >= 3 then 2 else 0 end; end if;
end $$;
-- いちばんひどいもの（風・雨・雪のどれか）
create or replace function public._mp_unko_wxat(x float8, y float8, e float8, ms bigint, out kind text, out lv int, out sev float8)
language plpgsql stable set search_path = public as $$
declare o record; w record; v float8; l int;
begin
  kind := null; lv := 0; sev := 0;
  o := _wx_core(x, y, e, ms);
  if o.kind = 'rain' then v := _wx_mm(o.inten); l := case when v >= 50 then 3 when v >= 30 then 2 else 0 end; if l > lv then kind := 'rain'; lv := l; sev := v; end if; end if;
  if o.kind = 'snow' then v := _wx_cm(o.inten); l := case when v >= 7 then 3 when v >= 3 then 2 else 0 end; if l > lv then kind := 'snow'; lv := l; sev := v; end if; end if;
  w := _wx_wind(x, y, ms);
  l := case when w.gust >= 25 then 3 when w.gust >= 20 then 2 else 0 end;
  if l > lv then kind := 'wind'; lv := l; sev := w.gust; end if;
end $$;

-- ことば：原因・場所・対応
create or replace function public._mp_unko_why(z mp_unko) returns text
language sql stable set search_path = public as $$
  select case z.kind when 'wind' then format('強い風（最大瞬間 %sm/s）', round(z.sev)) when 'rain' then format('強い雨（1時間に %smm）', round(z.sev))
                     when 'snow' then format('強い雪（1時間に %scm）', round(z.sev)) else z.sub end
$$;
create or replace function public._mp_unko_where(z mp_unko) returns text
language sql stable set search_path = public as $$
  select coalesce((select name || '駅' from mp_stations where id = z.sta), '線路') || case when z.kind in ('wind', 'rain', 'snow') then 'のあたり' else '' end
$$;
create or replace function public._mp_unko_pickt(p int) returns text
language sql immutable as $$ select case p when 1 then 'いつもどおり運転する' when 2 then '徐行・点検しながら運転する' else '運転を見合わせる' end $$;

-- 系統の列車の速さ（いくつかの運行の乱れをあわせる）：[[はじめ, おわり, 速さ], …]（時刻の順・かさならない・速さ 1 のところはない）。なければ null
--   ta〜tb（1970年からの秒）にかかる窓だけ
create or replace function public._mp_unko_pc(rid bigint, ta float8, tb float8) returns jsonb
language sql stable set search_path = public as $$
  with w as (select (e ->> 0)::float8 a, (e ->> 1)::float8 b, (e ->> 2)::float8 r
               from mp_unko z, jsonb_array_elements(z.wins) e
              where z.routes @> array[rid] and z.t0 < to_timestamp(tb) and coalesce(z.t_end, now() + interval '1 day') > to_timestamp(ta)
                and (e ->> 1)::float8 > ta and (e ->> 0)::float8 < tb and (e ->> 1)::float8 > (e ->> 0)::float8 and (e ->> 2)::float8 < 1),
       bp as (select distinct v from (select a v from w union all select b from w) q),
       sg as (select v a, lead(v) over (order by v) b from bp)
  select jsonb_agg(jsonb_build_array(s.a, s.b, s.r) order by s.a)
    from (select sg.a, sg.b, (select min(w.r) from w where w.a <= sg.a and w.b >= sg.b) r from sg where sg.b is not null) s
   where s.r is not null and s.r < 1
$$;
-- 時刻 t の速さ（0 止まる・0.6 徐行・1 ふつう）
create or replace function public._mp_unko_rate(pc jsonb, t float8) returns float8
language sql immutable as $$
  select coalesce((select min((e ->> 2)::float8) from jsonb_array_elements(pc) e where (e ->> 0)::float8 <= t and t < (e ->> 1)::float8), 1)
$$;
-- d0 に始発駅を出た列車の、時刻 t の遅れ（秒）。止まる・徐行で遅れ、窓のあとは 1秒に 0.1秒ずつ取りもどす（map.js の unkoDly と同じ）
create or replace function public._mp_unko_dly(pc jsonb, d0 float8, t float8) returns float8
language plpgsql immutable as $$
declare e jsonb; a float8; b float8; r float8; d float8 := 0; s float8 := d0; x float8;
begin
  if pc is null or t <= d0 then return 0; end if;
  for e in select v from jsonb_array_elements(pc) v loop
    a := (e ->> 0)::float8; b := (e ->> 1)::float8; r := (e ->> 2)::float8;
    if b <= s then continue; end if;
    if a >= t then exit; end if;
    if a > s then d := greatest(0, d - 0.1 * (a - s)); s := a; end if;
    x := least(b, t); d := d + (1 - r) * (x - s); s := x;
  end loop;
  if t > s then d := greatest(0, d - 0.1 * (t - s)); end if;
  return d;
end $$;

-- 対応を決める（えらんだ・現場の判断）：列車の速さの窓を作る
--   正しい：予定どおり（2 は予定の長さだけ徐行・3 は予定の長さ＋点検10分だけ止まる）
--   慎重すぎ：遅れが大きくなる（1 のときに 2・3 は 20分の徐行・見合わせ。2 のときに 3 は止まる）
--   あまい：しばらくすると、トラブルで長く止まる（のこりの 1.5 倍・30分より長く）。その人の線の信頼が下がる
create or replace function public._mp_unko_apply(p_id bigint, p_pick int, p_auto boolean) returns void
language plpgsql set search_path = public as $$
declare z mp_unko; td float8 := extract(epoch from now()); t0 float8; te float8; ww jsonb; f float8; len float8; tr text; lg jsonb; ed float8;
begin
  select * into z from mp_unko where id = p_id for update;
  if not found or z.st <> 'ask' then return; end if;
  t0 := extract(epoch from z.t0); te := t0 + z.dur; td := greatest(td, t0);
  ww := case when td > t0 then jsonb_build_array(jsonb_build_array(t0, td, (z.wins -> 0 ->> 2)::float8)) else '[]'::jsonb end;   -- えらぶまで：仮の対応
  lg := jsonb_build_array(jsonb_build_array(td, format('対応：%s（%s）', _mp_unko_pickt(p_pick), case when p_auto and z.own_u is null and z.own_c is null then '国'
                                                                                                   when p_auto then '現場の判断' else _mp_pname(z.own_u, z.own_c, false) end)));
  if p_pick = z.lv then
    if z.lv = 2 then ww := ww || jsonb_build_array(jsonb_build_array(td, greatest(td + 300, te), 0.6));
    elsif z.lv = 3 then ww := ww || jsonb_build_array(jsonb_build_array(td, greatest(td + 600, te + 600), 0)); end if;
  elsif p_pick > z.lv then
    if z.lv = 1 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + 1200, case when p_pick = 2 then 0.6 else 0 end));
    else ww := ww || jsonb_build_array(jsonb_build_array(td, greatest(td + 600, te + 600), 0)); end if;
  else
    f := case when z.kind in ('wind', 'rain', 'snow') then 600 else 360 end;
    len := greatest(1800, 1.5 * (te - td));
    if p_pick = 2 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + f, 0.6)); end if;
    ww := ww || jsonb_build_array(jsonb_build_array(td + f, td + f + len, 0));
    tr := case z.kind when 'wind' then '架線に飛来物がひっかかりました' when 'rain' then '線路に土砂が流れこみました' when 'snow' then 'ポイントが雪で動かなくなりました'
                      when 'person' then '現場の確認がやりなおしになりました' when 'car' then '車両の故障が大きくなりました（車両を交換します）'
                      when 'signal' then '信号の故障が広がりました' else '線路の安全確認がやりなおしになりました' end;
    lg := lg || jsonb_build_array(jsonb_build_array(td + f, tr || '。運転を見合わせています'));
    update mp_routes set trust = greatest(0.7, trust - 0.03) where id = any(z.routes) and own_u is not distinct from z.own_u and own_c is not distinct from z.own_c;
  end if;
  ed := coalesce((select max((e ->> 1)::float8) from jsonb_array_elements(ww) e), td);
  update mp_unko set pick = p_pick, pick_at = to_timestamp(td), pick_auto = p_auto, wins = ww, t_end = to_timestamp(ed), st = 'run', log = log || lg where id = p_id;
end $$;

-- 起きた：記録して、対応をえらぶ人（人でないとき＝国・AI・国営は、すぐに正しく対応）と、かかわる線の持ち主に知らせる（🔔）
create or replace function public._mp_unko_new(p_kind text, p_sub text, p_sta bigint, p_x int, p_y int, p_routes bigint[], p_lv int, p_sev real, p_sevmax real, p_dur int,
                                               p_ou uuid, p_oc int) returns bigint
language plpgsql set search_path = public as $$
declare z mp_unko; ts0 float8 := extract(epoch from now()); human boolean; prov float8; who uuid; q record; txt text; fc text;
begin
  human := (p_ou is not null and not exists (select 1 from profiles where id = p_ou and ai is not null))
        or (p_oc is not null and exists (select 1 from companies c where c.id = p_oc and c.ai is null and not coalesce(c.official, false)
                                           and not exists (select 1 from profiles p where p.id = c.owner and p.ai is not null)));
  prov := case when p_kind in ('wind', 'rain', 'snow') then 0.6 else 0 end;   -- えらぶまで：天気は徐行、ほかは その場で止まる
  insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end)
    values (p_kind, coalesce(p_sub, ''), p_sta, p_x, p_y, p_routes, p_ou, p_oc, p_lv, p_sev, p_sevmax, p_dur, to_timestamp(ts0 + 600),
            jsonb_build_array(jsonb_build_array(ts0, ts0 + 600, prov)), to_timestamp(ts0 + 600))
    returning * into z;
  fc := case when z.kind in ('wind', 'rain', 'snow') and z.sevmax > z.sev + 0.5 then format('（これから %s ぐらいまで強くなる予報）',
          case z.kind when 'wind' then round(z.sevmax) || 'm/s' when 'rain' then round(z.sevmax) || 'mm' else round(z.sevmax) || 'cm' end) else '' end;
  txt := _mp_unko_where(z) || 'で' || _mp_unko_why(z);
  update mp_unko set log = jsonb_build_array(jsonb_build_array(ts0, txt || fc)) where id = z.id;
  if not human then perform _mp_unko_apply(z.id, p_lv, true); end if;
  -- 知らせ（🔔）。えらぶ人には「えらんでください」
  if human then
    who := coalesce(p_ou, (select owner from companies where id = p_oc));
    perform _notice_l(who, format('【運行】%s：%s%s。対応をえらんでください（10分以内。国土 → 🚦運行情報）',
                                  (select string_agg(r.name, '・' order by r.id) from mp_routes r where r.id = any(p_routes) and r.own_u is not distinct from p_ou and r.own_c is not distinct from p_oc),
                                  txt, fc), jsonb_build_object('go', 'map', 'k', 'unko', 'id', z.id), null);
  end if;
  for q in select coalesce(r.own_u, c.owner) u, string_agg(r.name, '・' order by r.id) nm from mp_routes r left join companies c on c.id = r.own_c
            where r.id = any(p_routes) and not (r.own_u is not distinct from p_ou and r.own_c is not distinct from p_oc) and (r.own_u is not null or r.own_c is not null)
            group by 1 loop
    if q.u is not null and q.u is distinct from who then
      perform _notice_l(q.u, format('【運行】%sで%sのため、%sにも遅れが出ています（国土 → 🚦運行情報）', _mp_unko_where(z), _mp_unko_why(z), q.nm),
                        jsonb_build_object('go', 'map', 'k', 'unko', 'id', z.id), null);
    end if;
  end loop;
  return z.id;
end $$;

-- 天気：系統 rid の駅を6つまで見て、いちばんひどいところ。ひどければ（徐行より上）、4時間先まで予報を見て、長さと いちばん強いところを決めて運行の乱れを作る。
--   同じ持ち主・同じ原因で、40km より近くに さっき（30分以内）起きたものがあれば、そこに系統を入れる。ms は見る時刻（1970年からのミリ秒）
create or replace function public._mp_unko_wxr(rid bigint, ms bigint) returns bigint
language plpgsql set search_path = public as $$
declare r record; uz mp_unko; q record; n int; m int; i int; sid bigint; sx int; sy int; se float8;
        blv int := 0; bsev float8 := 0; bkind text; bsid bigint; bx int; by_ int; be float8; mx int; mxs float8; kk int;
begin
  select ro.id, ro.own_u, ro.own_c, ro.stops into r from mp_routes ro where ro.id = rid;
  if not found or coalesce(array_length(r.stops, 1), 0) < 2 then return null; end if;
  n := array_length(r.stops, 1); m := least(n, 6);
  for i in 0..m - 1 loop
    sid := r.stops[1 + (i * (n - 1)) / greatest(1, m - 1)];
    select x, y into sx, sy from mp_stations where id = sid;
    if not found then continue; end if;
    se := coalesce((_mp_cell(floor(sx / 100.0)::int, floor(sy / 100.0)::int)).e, 0);
    q := _mp_unko_wxat(sx / 100.0, sy / 100.0, se, ms);
    if q.lv > blv or (q.lv = blv and q.lv > 0 and q.sev > bsev) then blv := q.lv; bsev := q.sev; bkind := q.kind; bsid := sid; bx := sx; by_ := sy; be := se; end if;
  end loop;
  if blv < 2 then return null; end if;
  select * into uz from mp_unko where st <> 'done' and kind = bkind and own_u is not distinct from r.own_u and own_c is not distinct from r.own_c
     and t0 > now() - interval '30 minutes' and abs(x - bx) < 80000 and abs(y - by_) < 80000 order by id desc limit 1;
  if found then update mp_unko set routes = routes || r.id where id = uz.id and not (routes @> array[r.id]); return uz.id; end if;
  mx := blv; mxs := bsev; kk := 0;
  while kk < 16 loop
    q := _mp_unko_wxk(bx / 100.0, by_ / 100.0, be, ms + (kk + 1) * 900000, bkind);
    exit when q.lv < 2;
    kk := kk + 1; mx := greatest(mx, q.lv); mxs := greatest(mxs, q.sev);
  end loop;
  return _mp_unko_new(bkind, '', bsid, bx, by_, array[r.id], mx, bsev::real, mxs::real, (kk + 1) * 900, r.own_u, r.own_c);
end $$;

-- 5分ごと：対応の期限・おわり・天気・人と接触など（駅ごと）・1日1回の信頼のもどり
create or replace function public._mp_unko_tick() returns void
language plpgsql set search_path = public as $$
declare uz mp_unko; r record; s record; q record; ms bigint := floor(extract(epoch from now()) * 1000)::bigint; bk int := ((extract(epoch from now())::bigint / 300) % 3)::int;
        hh int := extract(hour from now() at time zone 'Asia/Tokyo')::int; hw real; stp float8; last text;
        tp jsonb; tw float8; tpk jsonb; ou uuid; oc int; dd int;
        TPL constant jsonb := '[["person", "人と接触", 3, 40, 75, 3], ["sick", "急病のお客さまの救護", 1, 5, 10, 4],
                                ["car", "車両の点検（ドアの不具合）", 2, 10, 20, 3], ["car", "車両の点検（ブレーキから異音）", 3, 25, 45, 1.5],
                                ["signal", "信号の確認（信号が赤のまま）", 2, 15, 25, 2], ["signal", "信号の確認（停電で信号が消えた）", 3, 30, 60, 1],
                                ["track", "線路内の点検（線路に人が立ち入った）", 2, 10, 20, 2], ["track", "線路内の点検（倒木・落下物）", 3, 30, 50, 1],
                                ["track", "線路内の点検（動物と接触）", 2, 15, 30, 1.5], ["track", "線路内の点検（小石。異常なし）", 1, 3, 6, 2]]'::jsonb;
begin
  if not exists (select 1 from mp_wx_k) then return; end if;
  -- 1) 10分えらばなかった：現場の判断（安全なほう：正しい対応より1つ慎重。見合わせが正しいときは見合わせ）
  for uz in select * from mp_unko where st = 'ask' and ask_until <= now() order by id loop
    perform _mp_unko_apply(uz.id, least(3, uz.lv + 1), true);
  end loop;
  -- 2) おわり（窓がおわった）。合わせて1時間より長く止めて、振替輸送をたのまなかった線は、信頼が下がる
  for uz in select * from mp_unko where st = 'run' and t_end <= now() order by id loop
    stp := (select coalesce(sum((e ->> 1)::float8 - (e ->> 0)::float8), 0) from jsonb_array_elements(uz.wins) e where (e ->> 2)::float8 = 0);
    if stp >= 3600 then update mp_routes set trust = greatest(0.7, trust - 0.05) where id = any(uz.routes) and not (id = any(uz.furi)); end if;
    last := case when (select (e ->> 2)::float8 from jsonb_array_elements(uz.wins) e order by (e ->> 1)::float8 desc limit 1) = 0 then '運転を再開しました（遅れが出ています）'
                 when jsonb_array_length(uz.wins) > 0 then 'ふだんの速さにもどりました（遅れが出ています）' else 'ふだんどおり運転しています' end;
    update mp_unko set st = 'done', log = log || jsonb_build_array(jsonb_build_array(extract(epoch from uz.t_end), last)) where id = uz.id;
  end loop;
  -- 3) 天気：系統ごと（15分に1回）
  for r in select ro.id from mp_routes ro
            where ro.ok and ro.kind = 'rail' and ro.id % 3 = bk and coalesce(array_length(ro.stops, 1), 0) >= 2
              and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
              and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[ro.id] and z.kind in ('wind', 'rain', 'snow')) loop
    perform _mp_unko_wxr(r.id, ms);
  end loop;
  -- 4) 人と接触・急病・車両・信号・線路内：駅ごと（1時間に 0.02％×人の多さ。朝夕は多く、夜は少ない）
  hw := case when hh < 5 then 0.15 when hh = 5 then 0.6 when hh between 6 and 9 or hh between 16 and 19 then 1.6 else 1 end;
  for s in select st.id, st.x, st.y, st.own_u, st.own_c, w.rs, w.pop
             from (select u.sid, array_agg(distinct ro.id order by ro.id) rs, max((ro.catch ->> u.sid::text)::real) pop
                     from mp_routes ro, unnest(ro.stops) u(sid)
                    where ro.ok and ro.kind = 'rail' and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
                    group by u.sid) w join mp_stations st on st.id = w.sid loop
    if random() >= 0.0002 / 12 * hw * greatest(0.3, least(3, coalesce(s.pop, 5000) / 20000.0)) then continue; end if;
    if exists (select 1 from mp_unko z where z.st <> 'done' and z.kind not in ('wind', 'rain', 'snow') and (z.sta = s.id or z.routes && s.rs)) then continue; end if;
    tw := random() * (select sum((e ->> 5)::float8) from jsonb_array_elements(TPL) e); tpk := null;
    for tp in select e from jsonb_array_elements(TPL) e loop
      tw := tw - (tp ->> 5)::float8; if tw <= 0 then tpk := tp; exit; end if;
    end loop;
    tpk := coalesce(tpk, TPL -> 0);
    dd := ((tpk ->> 3)::int + floor(random() * ((tpk ->> 4)::int - (tpk ->> 3)::int + 1))::int) * 60;
    -- えらぶ人：駅の持ち主（なければ、はじめの系統の持ち主）
    if s.own_u is not null or s.own_c is not null then ou := s.own_u; oc := s.own_c;
    else select ro.own_u, ro.own_c into ou, oc from mp_routes ro where ro.id = s.rs[1]; end if;
    perform _mp_unko_new(tpk ->> 0, tpk ->> 1, s.id, s.x, s.y, s.rs, (tpk ->> 2)::int, null, null, dd, ou, oc);
  end loop;
  -- 5) 1日1回（朝4時台）：信頼が1％もどる。30日より前の記録はけす
  if hh = 4 and not exists (select 1 from mp_state where k = 'unko_day' and v >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') then
    update mp_routes set trust = least(1, trust + 0.01) where trust < 1;
    delete from mp_unko where st = 'done' and t_end < now() - interval '30 days';
    insert into mp_state values ('unko_day', now()) on conflict (k) do update set v = excluded.v;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 運行情報（国じゅう）：いま乱れているもの・3時間以内におわったもの。p_as（自分・会社）がえらぶ人なら「me」
create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int;
begin
  begin select x.pu, x.pc into pu, pc from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; end;
  return jsonb_build_object('now', extract(epoch from now()), 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi)) order by r.id), '[]'::jsonb)
                 from mp_routes r where r.id = any(z.routes)),
    'lv', case when z.st <> 'ask' then z.lv end, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st,
    'log', (select coalesce(jsonb_agg(l order by (l ->> 0)::float8), '[]'::jsonb) from jsonb_array_elements(z.log) l where (l ->> 0)::float8 <= extract(epoch from now()) + 1),
    'by', _mp_pname(z.own_u, z.own_c, false),
    'me', (pu is not null or pc is not null) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'));
end $$;

-- 対応をえらぶ（1 いつもどおり・2 徐行・点検しながら・3 運転見合わせ）
create or replace function public.mp_unko_pick(p_id bigint, p_pick int, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; z mp_unko;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_pick is null or p_pick not in (1, 2, 3) then raise exception '1・2・3 からえらんでください'; end if;
  select * into z from mp_unko where id = p_id for update;
  if not found then raise exception '運行情報が見つかりません'; end if;
  if not (z.own_u is not distinct from pa.pu and z.own_c is not distinct from pa.pc) or pa.gv then
    raise exception 'この対応をえらべるのは「%」です（名義を切りかえてください）', _mp_pname(z.own_u, z.own_c, false);
  end if;
  if z.st <> 'ask' then raise exception 'もう対応が決まっています'; end if;
  perform _mp_unko_apply(z.id, p_pick, false);
  select * into z from mp_unko where id = p_id;
  return jsonb_build_object('ok', true, 'right', p_pick = z.lv, 'lv', z.lv, 'tend', extract(epoch from z.t_end));
end $$;

-- 振替輸送をたのむ（運転見合わせ中・これから見合わせるとき。自分の線だけ）：近く（約750m）のほかの線がお客をはこぶ。
--   はらうのは毎時の処理で（運休した列車のお客 × 7割 × 運賃の半分）。たのむと、長く止めても信頼は下がらない
create or replace function public.mp_unko_furi(p_id bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; z mp_unko; mine bigint[]; nb int; t float8 := extract(epoch from now());
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into z from mp_unko where id = p_id for update;
  if not found then raise exception '運行情報が見つかりません'; end if;
  select array_agg(id) into mine from mp_routes where id = any(z.routes) and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and not (id = any(z.furi));
  if mine is null then raise exception 'たのめる線がありません（自分の線で、まだたのんでいないもの）'; end if;
  if z.st = 'ask' and (z.wins -> 0 ->> 2)::float8 > 0 then raise exception '先に対応（運転見合わせ）をえらんでください'; end if;
  if not exists (select 1 from jsonb_array_elements(z.wins) e where (e ->> 2)::float8 = 0 and (e ->> 1)::float8 > t + 300) then
    raise exception '運転見合わせ中（あと5分より長く止まるとき）だけ、たのめます';
  end if;
  select count(*) into nb from mp_routes p
   where p.ok and p.kind in ('rail', 'bus') and not (p.id = any(z.routes))
     and exists (select 1 from mp_routes ro, unnest(ro.stops) b(sid) join mp_stations s1 on s1.id = b.sid, unnest(p.stops) a(sid) join mp_stations s2 on s2.id = a.sid
                  where ro.id = any(mine) and abs(s1.x - s2.x) < 1500 and abs(s1.y - s2.y) < 1500);
  if nb = 0 then raise exception '近く（約750m）に、お客をはこんでもらえる ほかの線（鉄道・バス）がありません'; end if;
  update mp_unko set furi = furi || mine,
         log = log || jsonb_build_array(jsonb_build_array(t, format('%s：振替輸送をたのみました（ほかの %s 系統）', _mp_pname(pa.pu, pa.pc, pa.gv), nb))) where id = z.id;
  return jsonb_build_object('ok', true, 'partners', nb);
end $$;

-- 振替輸送の精算（毎時の処理から）：運休した列車のお客（lost 人）の7割を、近くのほかの線の持ち主に分けて、運賃の半分をはらう
create or replace function public._mp_unko_furi_pay(r mp_routes, lost real, fare real) returns void
language plpgsql set search_path = public as $$
declare p record; n int; per real; amt bigint; paid bigint;
begin
  if lost < 1 or fare <= 0 then return; end if;
  -- 近く（約750m）に駅・バス停があって、同じ乱れで止まっていない線の持ち主
  select count(*) into n from (select distinct p2.own_u, p2.own_c from mp_routes p2
     where p2.ok and p2.kind in ('rail', 'bus') and p2.id <> r.id
       and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[p2.id] and z.routes @> array[r.id])
       and exists (select 1 from unnest(r.stops) b(sid) join mp_stations s1 on s1.id = b.sid, unnest(p2.stops) a(sid) join mp_stations s2 on s2.id = a.sid
                    where abs(s1.x - s2.x) < 1500 and abs(s1.y - s2.y) < 1500)) d;
  if n = 0 then return; end if;
  per := lost * 0.7 / n;
  for p in select distinct p2.own_u u, p2.own_c c from mp_routes p2
     where p2.ok and p2.kind in ('rail', 'bus') and p2.id <> r.id
       and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[p2.id] and z.routes @> array[r.id])
       and exists (select 1 from unnest(r.stops) b(sid) join mp_stations s1 on s1.id = b.sid, unnest(p2.stops) a(sid) join mp_stations s2 on s2.id = a.sid
                    where abs(s1.x - s2.x) < 1500 and abs(s1.y - s2.y) < 1500) loop
    if p.u is not distinct from r.own_u and p.c is not distinct from r.own_c then continue; end if;   -- 自分のほかの線：お金は動かない
    amt := round(per * fare * 0.5);
    if amt <= 0 then continue; end if;
    paid := _mp_soft_pay(r.own_u, r.own_c, false, amt, 'fee', format('振替輸送の精算（%s・%s人）', r.name, round(per)));
    if paid > 0 and (p.u is not null or p.c is not null) then
      perform _mp_earn(p.u, p.c, false, paid, 'fare', format('振替輸送（%sのお客・%s人）', r.name, round(per)));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 毎時の処理（系統の運賃など）：運行の乱れ（運休・遅れ・信頼・振替輸送の精算）を入れた
create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour');
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null;
    if r.kind = 'rail' then begin upc := _mp_unko_pc(r.id, h0, h0 + 3600 * 4); exception when others then upc := null; end; end if;   -- うまくいかなくても、ふだんどおり
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null or (perf ->> 'busy')::boolean then continue; end if;
      -- 走る区間（途中始発・途中止まり。2026-10-28）：系統のうちの何割を走るか（cf）。本数・定員はその割合で数える
      cf := 1; ia := 1; ib := coalesce(array_length(r.stops, 1), 1);
      if tr.sa is not null or tr.sb is not null then
        ia := _mp_rpos(r.stops, tr.dir, (tr.sched -> 0 ->> 0)::bigint, false); ib := _mp_rpos(r.stops, tr.dir, (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 0)::bigint, true);   -- 環状線
        if ia is not null and ib is not null and km > 0 then
          cf := greatest(0.05, least(1, coalesce((select sum((l.v ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality l(v, lo) where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib)), 0) / 1000 / km));
        else ia := 1; ib := coalesce(array_length(r.stops, 1), 1); end if;
      end if;
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
            where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib) and not (l.v ->> 'e')::boolean) then continue; end if;
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      if upc is not null then
        dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
        if _mp_unko_rate(upc, dep_abs) = 0 then ncan := ncan + 1; continue; end if;   -- 運転見合わせで運休（運賃なし・車両はいたまない）
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        broke := broke + 1;
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        continue;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = tr.fid;
      -- 連結している編成（つなぐ駅から切りはなす駅まで）：その分いたみ、定員は走る時間のわりあいで足す
      ccap := 0;
      for ce in select c.v from jsonb_array_elements(tr.cplx) c(v)
                 where coalesce((c.v ->> 'ok')::boolean, false) and exists (select 1 from mp_ops ox where ox.id = (c.v ->> 'op')::bigint and ox.form = (c.v ->> 'f')::bigint) loop
        cperf := _mp_form_perf((ce ->> 'f')::bigint);
        if cperf is null or (cperf ->> 'busy')::boolean then continue; end if;
        crt := greatest(60, coalesce((ce ->> 'tb')::int - (ce ->> 'ta')::int, rt));
        update mp_cars c set cond = greatest(0, cond - 0.035 * crt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
         where form = (ce ->> 'f')::bigint;
        ccap := ccap + (cperf ->> 'cap')::int * least(1, crt / greatest(rt, 1));
      end loop;
      if upc is not null then dsum := dsum + _mp_unko_dly(upc, dep_abs, dep_abs + rt); nd := nd + 1; end if;   -- 終点での遅れ（秒）
      if tr.kind in ('回送', '試運転') then continue; end if;   -- お客は乗せない
      nok := nok + 1; secs := secs + rt / cf;
      if tr.dir = 1 then tph1 := tph1 + cf; cap1 := cap1 + round(((perf ->> 'cap')::int + ccap) * cf)::int; else tph2 := tph2 + cf; cap2 := cap2 + round(((perf ->> 'cap')::int + ccap) * cf)::int; end if;
      acn := acn + case when (perf ->> 'ac')::boolean then 1 else 0 end; htn := htn + case when (perf ->> 'heat')::boolean then 1 else 0 end;
      toil := toil + case when (perf ->> 'toilet')::boolean then 1 else 0 end;
    end loop;
    -- 運休した列車のお客（きのうの同じ時間のお客 × 運休の割合）：振替輸送をたのんでいれば、近くのほかの線へ（精算）
    lost := 0;
    if ncan > 0 then
      lost := coalesce((select x.served from mp_hours x where x.route = r.id and x.hour = date_trunc('hour', h) - interval '1 day'), 0)::real * ncan / (ncan + nok);
      if lost >= 1 and exists (select 1 from mp_unko z where z.furi @> array[r.id] and z.t0 < h and coalesce(z.t_end, now()) > h - interval '1 hour') then
        begin
          perform _mp_unko_furi_pay(r, lost, case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * greatest(1.5, least(15, km * 0.45)) else 0 end);
        exception when others then raise warning 'mp unko furi: %', sqlerrm; end;
      end if;
    end if;
    if nok = 0 then
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'trust', round(r.trust::numeric, 2)) where id = r.id;
      continue;
    end if;
    -- 乗りたい人（この1時間）
    pop := coalesce((select sum(v::text::real) from jsonb_each(catch) e(k, v)), 0);
    -- ほかの系統とのとりあい：駅のまわりに止まる、ほかの系統の本数
    share := coalesce((select avg(1.0 / (1 + coalesce((select count(*) from mp_routes r2 join mp_stations s2 on s2.id = any(r2.stops)
                         where r2.id <> r.id and r2.ok and r2.kind = r.kind and abs(s2.x - s.x) < 1200 and abs(s2.y - s.y) < 1200), 0) * 0.5))
                       from mp_stations s where s.id = any(r.stops)), 1);
    spd := case when secs > 0 then km / greatest(secs / nok / 3600.0, 0.01) else 30 end;
    q := least(1.5, greatest(0.5, spd / 30.0));
    if r.kind = 'ship' then q := case when spd > 40 then 1.3 else 1 end; end if;   -- 船：島へは船しかないので遅くても減らない（高速船は少しふえる。t54o）
    if r.kind = 'air' then q := least(1.0, greatest(0.2, km / 60)); end if;   -- 飛行機：近いところへは鉄道・バスで行く人が多い（60km より短いと減る。t54p）
    comf := 1;
    if mo in (6, 7, 8, 9) then comf := comf * (0.8 + 0.2 * acn / nok); end if;
    if mo in (12, 1, 2) then comf := comf * (0.8 + 0.2 * htn / nok); end if;
    if km > 30 then comf := comf * (0.9 + 0.1 * toil / nok); end if;
    dem := pop * _mp_rate(case r.kind when 'rail' then 'g_rail' when 'ship' then 'g_ship' when 'air' then 'g_air' else 'g_bus' end) * _mp_hourf(hh) * q * comf * share;
    -- 運行の乱れ：遅れが大きいほど お客がへる（平均 10分で 1割・いちばん 3割）。信頼（0.7〜1）もかける
    dem := dem * coalesce(r.trust, 1) * (1 - least(0.3, dsum / greatest(nd, 1) / 60 / 100));
    if r.kind = 'air' then   -- 飛行機：本数が少なくても予約して乗る・座席の数まで（立って乗れない。t54p）
      dem1 := dem / 2 * tph1::real / (tph1 + 0.5); dem2 := dem / 2 * tph2::real / (tph2 + 0.5);
      served := floor(least(dem1, cap1) + least(dem2, cap2));
    else
      dem1 := dem / 2 * tph1::real / (tph1 + 3); dem2 := dem / 2 * tph2::real / (tph2 + 3);
      served := floor(least(dem1, cap1 * 1.5 * 2) + least(dem2, cap2 * 1.5 * 2));
    end if;
    trip := case when r.kind = 'ship' then greatest(1.5, km * 0.85) when r.kind = 'air' then km else greatest(1.5, least(15, km * 0.45)) end;   -- 船はほとんどの人が向こう岸まで（t54o）・飛行機は終点まで
    fare := case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * trip
                 when r.kind = 'ship' then _mp_rate('ship_fare') + _mp_rate('ship_km') * trip
                 when r.kind = 'air' then _mp_rate('air_fare') + _mp_rate('air_km') * trip
                 else _mp_rate('bus_fare') + _mp_rate('bus_km') * greatest(0, trip - 3) end;
    rev := floor(served * fare);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, o.amt::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
    ) z where pu is not null or pc is not null group by pu, pc   -- 国のもの（国の空港。t54q）は国庫から国庫なので、なし
  loop
    amt := round(o.amt / 24.0);
    if amt > 0 then perform _mp_soft_pay(o.pu, o.pc, false, amt, 'upkeep', format('維持費（%s）', o.ks)); end if;
  end loop;
  -- 使用料：払う人 → 区画の筆の持ち主（筆がなければ国庫）。自分の筆になっていればなし。同じ人の同じ区画は1回（線路と駅のホームが重なるところなど）
  for o in select e.pay_u, e.pay_c, sum(e.fee) fee, p.own_u lu, p.own_c lc
             from (select distinct on (l.x, l.y, l.pay_u, l.pay_c) l.x, l.y, l.pay_u, l.pay_c, l.fee from mp_leases l where not l.pay_gov order by l.x, l.y, l.pay_u, l.pay_c, l.fee desc) e
             left join mp_pcells pc on pc.x = e.x and pc.y = e.y left join mp_parcels p on p.id = pc.parcel
            where p.id is null or not _mp_same(p.own_u, p.own_c, false, e.pay_u, e.pay_c, false)
            group by e.pay_u, e.pay_c, p.own_u, p.own_c loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', '土地の使用料');
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', '土地の使用料（受けとり）');
    end if;
  end loop;
  -- 他社のバス停の使用料（1系統・1日）：系統の持ち主 → バス停の持ち主
  for o in select ro.own_u pay_u, ro.own_c pay_c, sx.own_u lu, sx.own_c lc, sx.kind sk, sum(x.fee) fee
             from mp_stopuse x join mp_routes ro on ro.id = x.route join mp_stations sx on sx.id = x.stop
            where x.fee > 0 and not _mp_same(sx.own_u, sx.own_c, false, ro.own_u, ro.own_c, false)
            group by ro.own_u, ro.own_c, sx.own_u, sx.own_c, sx.kind loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', case when o.sk = 'ship' then '港の使用料' when o.sk = 'air' then '空港の使用料' else 'バス停の使用料' end);
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', case when o.sk = 'ship' then '港の使用料（受けとり）' when o.sk = 'air' then '空港の使用料（受けとり）' else 'バス停の使用料（受けとり）' end);
    end if;
  end loop;
  -- 乗り入れの線路使用料（t54j）：この1時間に始発を出た列車（回送・試運転もふくむ）× 持ち主の線路の km × 1列車・1km の使用料。系統の持ち主 → 線路の持ち主
  for o in
    select ro.own_u gu, ro.own_c gc, hk.hu, hk.hc, sum(cnt.n * hk.km * th.fee) amt, sum(cnt.n) n, sum(cnt.n * hk.km) km
      from mp_routes ro
      join lateral (select count(*) n from mp_trains x where x.route = ro.id and not x.bad and x.form is not null
                       and ((x.dep - t0 + 86400) % 86400) < 3600 and (x.day is null or x.day = d0)) cnt on cnt.n > 0
      join lateral (select s.own_u hu, s.own_c hc, sum(abs((g ->> 2)::real - (g ->> 1)::real) * 50 / 1000.0) km
                      from jsonb_array_elements(ro.legs) l, jsonb_array_elements(l -> 'g') g join mp_segs s on s.id = (g ->> 0)::bigint
                     where not (s.own_u is not distinct from ro.own_u and s.own_c is not distinct from ro.own_c) and not s.gov
                     group by s.own_u, s.own_c) hk on true
      join mp_thru th on th.st = 'ok' and th.fee > 0 and th.hu is not distinct from hk.hu and th.hc is not distinct from hk.hc
                     and th.gu is not distinct from ro.own_u and th.gc is not distinct from ro.own_c
     where ro.ok and ro.kind = 'rail'
     group by ro.own_u, ro.own_c, hk.hu, hk.hc
  loop
    amt := round(o.amt);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.gu, o.gc, false, amt, 'lease', format('線路使用料（乗り入れ・%s本・%skm）', o.n, round(o.km::numeric, 1)));
    if amt > 0 then perform _mp_earn(o.hu, o.hc, false, amt, 'lease_in', format('線路使用料（乗り入れの受けとり・%s本）', o.n)); end if;
  end loop;
  -- 建物：町の人の出入り・家賃・テナントの家賃・店などの売上
  perform _mp_bld_tick_hour(h);
  -- 学校・工場・物流（t54k）。うまくいかなくても、ほかの1時間の分はそのまま
  begin perform _mp_sc_tick_hour(h); exception when others then raise warning 'mp sc: %', sqlerrm; end;
end $$;

-- 5分ごと：運行の乱れ（pg_cron があるとき）
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-unko', '*/5 * * * *', 'select public._mp_unko_tick()');
  end if;
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない。運行情報・対応・振替輸送は、ログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_wx\_%' or p.proname like '\_mp\_unko\_%' or p.proname like 'mp\_unko\_%' or p.proname = '_mp_tick_hour') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
