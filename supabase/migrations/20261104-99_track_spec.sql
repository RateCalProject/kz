-- 線路の規格：軌間（1435・1372・1067・762mm）と三線軌条・枕木（木・RC・PC・スラブ）・架線（直接吊架・シンプル・ツインシンプル・コンパウンド・ヘビーシンプル・剛体・第三軌条）・防音壁
--   軌間が合わない列車は走れない（三線軌条は2つの軌間）。規格ごとに 上限の速さ・工事費・維持費がちがう（架線の上限は電車だけ）。第三軌条は 直流750V（第三軌条の電車だけ）
--   ツインシンプル・コンパウンドは電気を遠くまで送れる（変電所が とどく遠さ 1.5倍）。いまの線路は 1067mm・PC枕木・シンプルカテナリー（いまの速さは変わらない）
--   線路の騒音：家の近くを速く・たくさん走ると、まわりの地価とまちの成長が少し下がる（防音壁・トンネルで へらせる。毎日 朝4時に計算）
--   線路を1本にする（mp_seg_merge）：つなぎ目で となりの線と結合。設定がちがうときは、えらんだ線にそろえる（そろえる工事費）
--   新しい軌間の車両（名前は架空）：S310系・S580系・S900系（300km/h）・S120系（第三軌条）・Y250系・Y15形・K20形・KD10形

-- 線路の規格（DB の更新99）：軌間・三線軌条・枕木・架線・防音壁。いまの線路は 1067mm・PC枕木・シンプルカテナリー・防音壁なし
alter table public.mp_segs add column if not exists gauge smallint not null default 1067;   -- 軌間（mm）：762・1067・1372・1435
alter table public.mp_segs add column if not exists g2 smallint;                             -- 三線軌条の2つめの軌間（mm。null は なし）
alter table public.mp_segs add column if not exists slp smallint not null default 0;          -- 枕木：0 PC・1 木・2 RC・3 スラブ
alter table public.mp_segs add column if not exists cat smallint not null default 0;          -- 架線（電化した線）：0 シンプルカテナリー・1 直接吊架式・2 ツインシンプル・3 コンパウンド・4 ヘビーシンプル・5 剛体架線・6 第三軌条（直流750V）
alter table public.mp_segs add column if not exists nw smallint not null default 0;           -- 防音壁：0 なし・1 防音壁・2 高い防音壁
create table if not exists public.mp_noise (   -- 線路の騒音（DB の更新99）：マス（50m）ごとの大きさ（0〜3）。毎日（朝4時）に計算しなおす
  x int not null, y int not null, lv real not null, primary key (x, y)
);
alter table public.mp_noise enable row level security;
revoke all on public.mp_noise from public, anon, authenticated;
alter table public.mp_types add column if not exists gauge smallint not null default 1067;   -- 軌間（mm。DB の更新99）。バス・船・飛行機は見ない

-- 新しい軌間の車両（DB の更新99。名前とコードは架空）：標準軌（1435mm）の通勤形・特急形・高速電車・第三軌条の地下鉄電車、1372mm の通勤形・小さな電車、762mm の軽便電車・軽便気動車
insert into public.mp_series(code, name, kind, note, ord, grp, yr, sets) values
  ('S310', 'S310系', 'emu', '標準軌（1435mm）の通勤形電車（2000年代・VVVF）。最高110km/h・4ドア・ロングシート・冷房。1435mm の線路（三線軌条もふくむ）だけ走れる', 150, null, 2006,
   '[{"n":"4両","t":["S310-Tc31000","S310-Mp31000","S310-M31000","S310-Tc31000"]},{"n":"8両","t":["S310-Tc31000","S310-Mp31000","S310-M31000","S310-T31000","S310-T31000","S310-Mp31000","S310-M31000","S310-Tc31000"]}]'::jsonb),
  ('S580', 'S580系', 'emu', '標準軌（1435mm）の特急形電車（2010年代・VVVF）。最高130km/h・リクライニングシート・冷房・トイレ。1435mm の線路だけ走れる', 151, null, 2012,
   '[{"n":"4両","t":["S580-Tsc58000","S580-Mp58000","S580-M58000","S580-Tc58000"]},{"n":"6両","t":["S580-Tsc58000","S580-Mp58000","S580-M58000","S580-Mp58000","S580-M58000","S580-Tc58000"]}]'::jsonb),
  ('S900', 'S900系', 'emu', '標準軌（1435mm）の高速電車（交流 50Hz・60Hz）。最高300km/h・リクライニングシート・冷房・トイレ。速く走るには 1435mm・PCかスラブ枕木・ヘビーシンプルカテナリーの線路が いる', 152, null, 2015,
   '[{"n":"8両","t":["S900-Mc90000","S900-M90000","S900-Mp90000","S900-Ms90000","S900-M90000","S900-Mp90000","S900-M90000","S900-Mc90000"]},{"n":"16両","t":["S900-Mc90000","S900-M90000","S900-Mp90000","S900-M90000","S900-M90000","S900-Mp90000","S900-M90000","S900-Ms90000","S900-Ms90000","S900-M90000","S900-Mp90000","S900-M90000","S900-M90000","S900-Mp90000","S900-M90000","S900-Mc90000"]}]'::jsonb),
  ('S120', 'S120系', 'emu', '第三軌条（直流750V）の地下鉄電車（標準軌 1435mm）。最高90km/h・4ドア・ロングシート・冷房。架線ではなく第三軌条の線だけ走れる', 153, null, 2008,
   '[{"n":"4両","t":["S120-Tc1200","S120-M1200","S120-M1200","S120-Tc1200"]},{"n":"6両","t":["S120-Tc1200","S120-M1200","S120-T1200","S120-M1200","S120-M1200","S120-Tc1200"]}]'::jsonb),
  ('Y250', 'Y250系', 'emu', '1372mm の通勤形電車（2000年代・VVVF）。最高110km/h・4ドア・ロングシート・冷房。1372mm の線路だけ走れる', 154, null, 2004,
   '[{"n":"4両","t":["Y250-Tc25000","Y250-Mp25000","Y250-M25000","Y250-Tc25000"]},{"n":"8両","t":["Y250-Tc25000","Y250-Mp25000","Y250-M25000","Y250-T25000","Y250-T25000","Y250-Mp25000","Y250-M25000","Y250-Tc25000"]}]'::jsonb),
  ('Y15', 'Y15形', 'emu', '1372mm の小さな電車（1両・両運転台・長さ13.5m）。最高70km/h・冷房。直接吊架式の架線でも走れる', 155, null, 1998,
   '[{"n":"1両","t":["Y15-Y15"]},{"n":"2両","t":["Y15-Y15","Y15-Y15"]}]'::jsonb),
  ('K20', 'K20形', 'emu', '762mm（特殊狭軌）の軽便電車（小さな車体・長さ15m）。最高60km/h・冷房。762mm の線路だけ走れる', 156, null, 1990,
   '[{"n":"2両","t":["K20-Mc20","K20-Tc20"]},{"n":"3両","t":["K20-Mc20","K20-Tc20","K20-Mc20"]}]'::jsonb),
  ('KD10', 'KD10形', 'dmu', '762mm（特殊狭軌）の軽便気動車（小さな車体・両運転台・長さ11m）。最高55km/h・冷房。電化していない線も走れる', 157, null, 1985,
   '[{"n":"1両","t":["KD10-KD10"]},{"n":"2両","t":["KD10-KD10","KD10-KD10"]}]'::jsonb)
on conflict (code) do nothing;
insert into public.mp_types(code, series, label, role, face, num_from, num_to, len, cap, seats, mass, power, panto, cab, vmax, acc, dec, elec, heat, ac, toilet, price, upkeep, life, note, ord, nbase, cls, rooms, fn, npad, ps, gauge) values
  ('S310-Tc31000', 'S310', 'Tc31000', 'Tc', '', 1, 1999, 20.0, 136, 48, 28.0, 0, 0, true, 110, 3.0, 4.2, true, true, true, false, 50000000, 12000, 365, '制御車（運転台）。0001〜', 3900, '310', '', 0, '{}', 4, 1, 1435),
  ('S310-Mp31000', 'S310', 'Mp31000', 'Mp', '', 2001, 3999, 20.0, 144, 54, 36.0, 760, 1, false, 110, 3.0, 4.2, true, true, true, false, 66000000, 17000, 365, '電動車（パンタグラフ・VVVF 190kW×4）。2001〜', 3910, '310', '', 0, '{}', 4, 1, 1435),
  ('S310-M31000', 'S310', 'M31000', 'M', '', 4001, 5999, 20.0, 144, 54, 35.0, 760, 0, false, 110, 3.0, 4.2, true, true, true, false, 62000000, 16000, 365, '電動車（VVVF 190kW×4）。4001〜', 3920, '310', '', 0, '{}', 4, 1, 1435),
  ('S310-T31000', 'S310', 'T31000', 'T', '', 8001, 8999, 20.0, 144, 54, 26.0, 0, 0, false, 110, 3.0, 4.2, true, true, true, false, 42000000, 11000, 365, '付随車。8001〜', 3930, '310', '', 0, '{}', 4, 1, 1435),
  ('S580-Tsc58000', 'S580', 'Tsc58000', 'Tc', '', 1, 999, 21.0, 36, 36, 36.0, 0, 0, true, 130, 2.0, 4.2, true, true, true, true, 115000000, 22000, 365, '制御車（運転台・グリーン席・トイレ）。0001〜', 3940, '580', 'G', 0, '{}', 4, 1, 1435),
  ('S580-Mp58000', 'S580', 'Mp58000', 'Mp', '', 2001, 2999, 21.0, 68, 68, 41.0, 920, 1, false, 130, 2.0, 4.2, true, true, true, false, 120000000, 24000, 365, '電動車（パンタグラフ・VVVF 230kW×4）。2001〜', 3950, '580', '', 0, '{}', 4, 1, 1435),
  ('S580-M58000', 'S580', 'M58000', 'M', '', 4001, 4999, 21.0, 72, 72, 40.0, 920, 0, false, 130, 2.0, 4.2, true, true, true, false, 115000000, 23000, 365, '電動車（VVVF 230kW×4）。4001〜', 3960, '580', '', 0, '{}', 4, 1, 1435),
  ('S580-Tc58000', 'S580', 'Tc58000', 'Tc', '', 1001, 1999, 21.0, 56, 56, 35.0, 0, 0, true, 130, 2.0, 4.2, true, true, true, true, 100000000, 20000, 365, '制御車（運転台・トイレ）。1001〜', 3970, '580', '', 0, '{}', 4, 1, 1435),
  ('S900-Mc90000', 'S900', 'Mc90000', 'M', '', 1, 999, 26.0, 70, 70, 46.0, 1220, 0, true, 300, 2.6, 4.5, true, true, true, false, 260000000, 46000, 365, '先頭の電動車（運転台・305kW×4）。0001〜', 3980, '900', '', 0, '{}', 4, 6, 1435),
  ('S900-Mp90000', 'S900', 'Mp90000', 'Mp', '', 2001, 2999, 25.0, 100, 100, 45.0, 1220, 1, false, 300, 2.6, 4.5, true, true, true, true, 245000000, 44000, 365, '電動車（パンタグラフ・変圧器・305kW×4・トイレ）。2001〜', 3990, '900', '', 0, '{}', 4, 6, 1435),
  ('S900-M90000', 'S900', 'M90000', 'M', '', 4001, 4999, 25.0, 100, 100, 44.0, 1220, 0, false, 300, 2.6, 4.5, true, true, true, false, 235000000, 42000, 365, '電動車（305kW×4）。4001〜', 4000, '900', '', 0, '{}', 4, 6, 1435),
  ('S900-Ms90000', 'S900', 'Ms90000', 'M', '', 6001, 6999, 25.0, 68, 68, 45.0, 1220, 0, false, 300, 2.6, 4.5, true, true, true, true, 265000000, 47000, 365, '電動車（グリーン席・305kW×4・トイレ）。6001〜', 4010, '900', 'G', 0, '{}', 4, 6, 1435),
  ('S120-Tc1200', 'S120', 'Tc1200', 'Tc', '', 1, 999, 18.0, 124, 44, 26.0, 0, 0, true, 90, 3.3, 4.5, true, true, true, false, 48000000, 11000, 365, '制御車（運転台）。0001〜', 4020, '120', '', 0, '{}', 4, 8, 1435),
  ('S120-M1200', 'S120', 'M1200', 'M', '', 2001, 3999, 18.0, 132, 50, 32.0, 560, 0, false, 90, 3.3, 4.5, true, true, true, false, 60000000, 15000, 365, '電動車（第三軌条から電気をとる集電靴・VVVF 140kW×4）。2001〜', 4030, '120', '', 0, '{}', 4, 8, 1435),
  ('S120-T1200', 'S120', 'T1200', 'T', '', 8001, 8999, 18.0, 132, 50, 24.0, 0, 0, false, 90, 3.3, 4.5, true, true, true, false, 40000000, 10000, 365, '付随車。8001〜', 4040, '120', '', 0, '{}', 4, 8, 1435),
  ('Y250-Tc25000', 'Y250', 'Tc25000', 'Tc', '', 1, 1999, 20.0, 136, 48, 28.0, 0, 0, true, 110, 3.0, 4.2, true, true, true, false, 48000000, 12000, 365, '制御車（運転台）。0001〜', 4050, '250', '', 0, '{}', 4, 1, 1372),
  ('Y250-Mp25000', 'Y250', 'Mp25000', 'Mp', '', 2001, 3999, 20.0, 144, 54, 35.0, 680, 1, false, 110, 3.0, 4.2, true, true, true, false, 63000000, 16000, 365, '電動車（パンタグラフ・VVVF 170kW×4）。2001〜', 4060, '250', '', 0, '{}', 4, 1, 1372),
  ('Y250-M25000', 'Y250', 'M25000', 'M', '', 4001, 5999, 20.0, 144, 54, 34.0, 680, 0, false, 110, 3.0, 4.2, true, true, true, false, 59000000, 15000, 365, '電動車（VVVF 170kW×4）。4001〜', 4070, '250', '', 0, '{}', 4, 1, 1372),
  ('Y250-T25000', 'Y250', 'T25000', 'T', '', 8001, 8999, 20.0, 144, 54, 26.0, 0, 0, false, 110, 3.0, 4.2, true, true, true, false, 40000000, 10000, 365, '付随車。8001〜', 4080, '250', '', 0, '{}', 4, 1, 1372),
  ('Y15-Y15', 'Y15', 'Y15', 'Mp', '', 1, 99, 13.5, 80, 24, 19.0, 240, 1, true, 70, 3.5, 4.5, true, true, true, false, 60000000, 9000, 365, '1両の小さな電車（両運転台・パンタグラフ・60kW×4）。1〜', 4090, 'Y15', '', 0, '{}', 1, 1, 1372),
  ('K20-Mc20', 'K20', 'Mc20', 'Mp', '', 1, 99, 15.0, 70, 28, 17.0, 180, 1, true, 60, 2.8, 4.0, true, true, true, false, 38000000, 8000, 365, '電動車（運転台・パンタグラフ・45kW×4）。1〜', 4100, 'K20', '', 0, '{}', 1, 1, 762),
  ('K20-Tc20', 'K20', 'Tc20', 'Tc', '', 101, 199, 15.0, 72, 30, 11.0, 0, 0, true, 60, 2.8, 4.0, true, true, true, false, 26000000, 6000, 365, '制御車（運転台）。101〜', 4110, 'K20', '', 0, '{}', 1, 1, 762),
  ('KD10-KD10', 'KD10', 'KD10', 'Dc', '', 1, 99, 11.0, 50, 24, 10.0, 110, 0, true, 55, null, 4.0, false, true, true, false, 25000000, 6000, 365, '軽便気動車（両運転台・ディーゼル 110kW）。1〜', 4120, 'KD10', '', 0, '{}', 1, 1, 762)
on conflict (code) do nothing;

-- 線路の規格（DB の更新99）のきまり
--   軌間のしるし：762 → 1・1067 → 2・1372 → 4・1435 → 8（三線軌条は 2つを足したもの）
create or replace function public._mp_gbit(g int) returns int
language sql immutable as $$ select case g when 762 then 1 when 1067 then 2 when 1372 then 4 when 1435 then 8 else 0 end $$;
-- 軌間の名前（しるしから）：「1067mm・1435mm」
create or replace function public._mp_gauge_names(m int) returns text
language sql immutable as $$
  select coalesce(nullif(concat_ws('・', case when m & 1 <> 0 then '762mm' end, case when m & 2 <> 0 then '1067mm' end, case when m & 4 <> 0 then '1372mm' end, case when m & 8 <> 0 then '1435mm' end), ''), 'なし')
$$;
-- 上限の速さ（km/h）：軌間 762 70・1067 160・1372 130・1435 300（三線軌条は 130 まで）。枕木 PC 285・木 100・RC 130・スラブ 300
create or replace function public._mp_gauge_v(g int) returns int
language sql immutable as $$ select case g when 762 then 70 when 1372 then 130 when 1435 then 300 else 160 end $$;
create or replace function public._mp_slp_v(s int) returns int
language sql immutable as $$ select case s when 1 then 100 when 2 then 130 when 3 then 300 else 285 end $$;
-- 架線（電車だけ。km/h）：シンプル 130・直接吊架 85・ツインシンプル 130・コンパウンド 160・ヘビーシンプル 300・剛体 110・第三軌条 90
create or replace function public._mp_cat_v(c int) returns int
language sql immutable as $$ select case c when 1 then 85 when 3 then 160 when 4 then 300 when 5 then 110 when 6 then 90 else 130 end $$;
-- 列車ぜんぶの上限（軌間・三線軌条・枕木・アプト式）
create or replace function public._mp_seg_v(g int, g2 int, s int, rack boolean) returns int
language sql immutable as $$
  select least(_mp_gauge_v(g), case when g2 is not null then least(130, _mp_gauge_v(g2)) else 300 end, _mp_slp_v(s), case when rack then 30 else 300 end)
$$;
-- 工事費・維持費の倍率：軌間（762 0.7・1067 1・1372 1.05・1435 1.1）
create or replace function public._mp_gauge_mul(g int) returns numeric
language sql immutable as $$ select (case g when 762 then 0.7 when 1372 then 1.05 when 1435 then 1.1 else 1 end)::numeric $$;
-- 枕木：工事費（木 0.9・RC 0.95・PC 1・スラブ 1.5）・維持費（木 1.5・RC 1.15・PC 1・スラブ 0.6）・取りかえ（線路の工事費の 木 0.2・RC 0.25・PC 0.3・スラブ 0.8）
create or replace function public._mp_slp_bmul(s int) returns numeric
language sql immutable as $$ select (case s when 1 then 0.9 when 2 then 0.95 when 3 then 1.5 else 1 end)::numeric $$;
create or replace function public._mp_slp_umul(s int) returns numeric
language sql immutable as $$ select (case s when 1 then 1.5 when 2 then 1.15 when 3 then 0.6 else 1 end)::numeric $$;
create or replace function public._mp_slp_rep(s int) returns numeric
language sql immutable as $$ select (case s when 1 then 0.2 when 2 then 0.25 when 3 then 0.8 else 0.3 end)::numeric $$;
-- 架線：工事費（電化 1マスの倍率。tun：トンネルの中）直接吊架 0.6・シンプル 1・ツインシンプル 1.4・コンパウンド 1.6・ヘビーシンプル 1.8・剛体 1.3（トンネルの中 0.8）・第三軌条 0.9（トンネルの中 0.6）
create or replace function public._mp_cat_mul(c int, tun boolean) returns numeric
language sql immutable as $$
  select (case c when 1 then 0.6 when 2 then 1.4 when 3 then 1.6 when 4 then 1.8 when 5 then case when tun then 0.8 else 1.3 end when 6 then case when tun then 0.6 else 0.9 end else 1 end)::numeric
$$;
-- 架線の工事費の倍率（線の つくり：マスごとの G・V・T・B から。トンネルのところだけ ちがう）
create or replace function public._mp_cat_cmul(c int, codes text[]) returns numeric
language sql immutable as $$ select coalesce((select avg(_mp_cat_mul(c, x = 'T')) from unnest(codes) x), _mp_cat_mul(c, false)) $$;
-- 架線の維持費の倍率：直接吊架 0.8・シンプル 1・ツインシンプル 1.25・コンパウンド 1.35・ヘビーシンプル 1.5・剛体 0.9・第三軌条 1.1
create or replace function public._mp_cat_umul(c int) returns numeric
language sql immutable as $$ select (case c when 1 then 0.8 when 2 then 1.25 when 3 then 1.35 when 4 then 1.5 when 5 then 0.9 when 6 then 1.1 else 1 end)::numeric $$;
-- 電気を遠くまで送れる架線：変電所が とどく遠さの倍率（ツインシンプル・コンパウンド 1.5・ヘビーシンプル 1.2）
create or replace function public._mp_cat_reach(c int) returns real
language sql immutable as $$ select (case c when 2 then 1.5 when 3 then 1.5 when 4 then 1.2 else 1 end)::real $$;
-- 防音壁（1マス。トンネルの中は いらない）：工事費（防音壁 12万・高い防音壁 25万）・維持費（1日 100・200）
create or replace function public._mp_nw_cost(n int) returns numeric
language sql immutable as $$ select (case n when 1 then 120000 when 2 then 250000 else 0 end)::numeric $$;
create or replace function public._mp_nw_upk(n int) returns numeric
language sql immutable as $$ select (case n when 1 then 100 when 2 then 200 else 0 end)::numeric $$;
-- 線路の維持費の倍率（1マス・1日。単線・複線の倍率に かける）：軌間 × 三線軌条（1.5）× 枕木 × 電化（1.3 × 架線）
create or replace function public._mp_trk_upk(g int, g2 int, s int, el boolean, c int) returns numeric
language sql immutable as $$ select _mp_gauge_mul(g) * case when g2 is not null then 1.5 else 1 end * _mp_slp_umul(s) * case when el then 1.3 * _mp_cat_umul(c) else 1 end $$;
-- 名前
create or replace function public._mp_slp_name(s int) returns text
language sql immutable as $$ select case s when 1 then '木' when 2 then 'RC' when 3 then 'スラブ' else 'PC' end $$;
create or replace function public._mp_cat_name(c int) returns text
language sql immutable as $$
  select case c when 1 then '直接吊架式' when 2 then 'ツインシンプルカテナリー' when 3 then 'コンパウンドカテナリー' when 4 then 'ヘビーシンプルカテナリー' when 5 then '剛体架線' when 6 then '第三軌条' else 'シンプルカテナリー' end
$$;
-- 速さの区切り（runs：[[m, km/h], …]）に、上限の速さのところ（iv：[はじめ m, おわり m, km/h, …]）をかける。さかいで区切る（まん中が上限の中なら上限まで）
create or replace function public._mp_runs_cap(runs jsonb, iv real[]) returns jsonb
language plpgsql immutable as $$
declare nr jsonb := '[]'::jsonb; e jsonb; pos real := 0; a real; b real; p0 real; x real; vv int; mid real; j int; n int := coalesce(array_length(iv, 1), 0) / 3; bs real[];
begin
  if n = 0 or runs is null then return runs; end if;
  bs := array(select distinct c from (select iv[3 * k - 2] c from generate_series(1, n) k union select iv[3 * k - 1] from generate_series(1, n) k) z order by c);
  for e in select v from jsonb_array_elements(runs) v loop
    a := pos; b := pos + (e ->> 0)::real; p0 := a;
    for x in select distinct c from unnest(bs || b) c where c > a + 0.05 and c <= b order by c loop
      vv := (e ->> 1)::int; mid := (p0 + x) / 2;
      for j in 1..n loop
        if mid between iv[3 * j - 2] and iv[3 * j - 1] then vv := least(vv, iv[3 * j]::int); end if;
      end loop;
      nr := nr || jsonb_build_array(jsonb_build_array(round((x - p0)::numeric, 1), vv)); p0 := x;
    end loop;
    pos := b;
  end loop;
  return nr;
end $$;
-- 速さの区切りの、となりあう同じ速さを まとめる
create or replace function public._mp_runs_merge(runs jsonb) returns jsonb
language plpgsql immutable as $$
declare p jsonb := '[]'::jsonb; e jsonb; v int; lastv int := -1; lastm real := 0;
begin
  for e in select q from jsonb_array_elements(coalesce(runs, '[]'::jsonb)) q loop
    v := (e ->> 1)::int;
    if v = lastv then lastm := lastm + (e ->> 0)::real;
    else
      if lastv >= 0 then p := p || jsonb_build_array(jsonb_build_array(round(lastm::numeric, 1), lastv)); end if;
      lastv := v; lastm := (e ->> 0)::real;
    end if;
  end loop;
  if lastv >= 0 then p := p || jsonb_build_array(jsonb_build_array(round(lastm::numeric, 1), lastv)); end if;
  return p;
end $$;

-- 編成の車両の軌間は そろえる（DB の更新99）：車両を編成に入れたとき（文のおわりに）しらべる
create or replace function public._mp_cars_gauge_chk() returns trigger
language plpgsql set search_path = public as $$
declare m int;
begin
  if new.form is null then return null; end if;
  select bit_or(_mp_gbit(t.gauge)) into m from mp_cars c join mp_types t on t.code = c.type
   where c.form = new.form and t.role not in ('Bus', 'Truck', 'Ship', 'Air');
  if m is not null and (m & (m - 1)) <> 0 then raise exception '軌間のちがう車両は、同じ編成にできません（%）', _mp_gauge_names(m); end if;
  return null;
end $$;
drop trigger if exists mp_cars_gauge on public.mp_cars;
create constraint trigger mp_cars_gauge after insert or update of form on public.mp_cars for each row execute function public._mp_cars_gauge_chk();

-- 系統の駅と駅のあいだ（legs）ごとの、走れる軌間のしるし（線路ぜんぶが通せる軌間。三線軌条は2つ。線路がなければ 15。DB の更新99）
create or replace function public._mp_leg_gm(legs jsonb) returns int[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(coalesce((select bit_and(_mp_gbit(s.gauge) | coalesce(_mp_gbit(s.g2), 0)) from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g join mp_segs s on s.id = (g ->> 0)::bigint where s.kind = 'rail'), 15) order by k), '{}')
    from jsonb_array_elements(coalesce(legs, '[]'::jsonb)) with ordinality q(l, k)
$$;

-- 線路の騒音（DB の更新99）：毎日（朝4時）。線路ごとに 1日の列車の本数 ×（速さ ÷ 100km/h）²（速さは 線の上限と、走る編成の最高速度の小さいほう）÷ 600
--   × 枕木（スラブ 1.25・木 1.05）× 防音壁（防音壁 0.5・高い防音壁 0.25）× つくり（高架 1.15・橋 1.6・トンネル 0）。
--   そのマスに 半分・となりの4マスに 4分の1・ななめの4マスに 0.15（線にそって足すと、線の上が だいたい その大きさ）。3 まで
--   騒音は、まわりの地価（住居 15%・商業 8% まで）と、まちの成長（いちばん大きいところで 4割 おそく）を下げる
create or replace function public._mp_noise_day() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  delete from mp_noise where true;
  insert into mp_noise(x, y, lv)
  with fv as (select c.form, min(t.vmax) vm from mp_cars c join mp_types t on t.code = c.type where c.form is not null group by c.form),
       rt as (select t.route, count(*) n, max(fv.vm) vm from mp_trains t join fv on fv.form = t.form where t.day is null group by t.route),
       rs as (select distinct ro.id rid, (g ->> 0)::bigint sid   -- 系統が通る線（同じ線は 系統ごとに1回）
                from mp_routes ro cross join lateral jsonb_array_elements(ro.legs) l cross join lateral jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
               where ro.kind = 'rail' and ro.ok),
       sr as materialized (select rs.sid, sum(rt.n) n, max(rt.vm) vm from rs join rt on rt.route = rs.rid group by rs.sid),
       sl as (select sg.pts, sg.st,
                     (sr.n / 600.0) * (least(sg.vlim, _mp_seg_v(sg.gauge, sg.g2, sg.slp, sg.rack), case when sg.elec then _mp_cat_v(sg.cat) else 999 end, coalesce(sr.vm, 100)) / 100.0) ^ 2
                     * case sg.slp when 3 then 1.25 when 1 then 1.05 else 1 end * case sg.nw when 1 then 0.5 when 2 then 0.25 else 1 end lv
                from sr join mp_segs sg on sg.id = sr.sid where sg.kind = 'rail'),
       tl as materialized (select sl.lv, _mp_tiles(sl.pts) tl, _mp_st_tiles(sl.pts, sl.st) cd from sl where sl.lv >= 0.02),   -- 1本に1回だけ（まとめないと マスごとに計算しなおす）
       pt as materialized (select t.tl[2 * c.i - 1] x, t.tl[2 * c.i] y, least(3, t.lv * case c.code when 'V' then 1.15 when 'B' then 1.6 else 1 end) lv
                from tl t cross join lateral unnest(t.cd) with ordinality c(code, i) where c.code <> 'T' and 2 * c.i <= coalesce(array_length(t.tl, 1), 0))
  select p.x + dx, p.y + dy, least(3, sum(p.lv * case when dx = 0 and dy = 0 then 0.5 when dx = 0 or dy = 0 then 0.25 else 0.15 end))::real
    from pt p cross join generate_series(-1, 1) dx cross join generate_series(-1, 1) dy
   group by 1, 2 having sum(p.lv * case when dx = 0 and dy = 0 then 0.5 when dx = 0 or dy = 0 then 0.25 else 0.15 end) >= 0.05;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public._mp_ps_names(m int) returns text
language sql immutable as $$
  select coalesce(nullif(concat_ws('・', case when m & 1 <> 0 then '直流' end, case when m & 2 <> 0 then '交流50Hz' end, case when m & 4 <> 0 then '交流60Hz' end, case when m & 8 <> 0 then '第三軌条' end), ''), 'なし')
$$;
create or replace function public._mp_sub_r(ps smallint) returns real
language sql immutable as $$ select (case when ps = 0 then 200 when ps = 3 then 80 else 800 end)::real $$;
create or replace function public._mp_sub_spec(ps smallint, sz smallint) returns jsonb
language sql immutable as $$
  select case when ps = 0 then jsonb_build_object('cap', (array[3000, 6000, 12000])[sz + 1], 'cost', (array[60000000, 110000000, 200000000])[sz + 1], 'upk', (array[20000, 35000, 60000])[sz + 1])
              when ps = 3 then jsonb_build_object('cap', (array[1500, 3000, 6000])[sz + 1], 'cost', (array[45000000, 80000000, 150000000])[sz + 1], 'upk', (array[16000, 28000, 48000])[sz + 1])   -- 第三軌条（直流750V。DB の更新99）
              else jsonb_build_object('cap', (array[10000, 20000, 40000])[sz + 1], 'cost', (array[90000000, 160000000, 290000000])[sz + 1], 'upk', (array[24000, 42000, 72000])[sz + 1]) end
$$;
create or replace function public._mp_feed(sid bigint) returns bigint
language sql stable set search_path = public as $$
  select v.id from mp_segs s join mp_subs v on v.ps = s.ps and v.own_u is not distinct from s.own_u and v.own_c is not distinct from s.own_c and v.gov = s.gov
   where s.id = sid and s.kind = 'rail' and s.elec and (s.bb <-> point(v.x / 100.0, v.y / 100.0)) <= _mp_sub_r(s.ps) * _mp_cat_reach(s.cat)   -- 電気を遠くまで送れる架線（DB の更新99）
   order by s.bb <-> point(v.x / 100.0, v.y / 100.0), v.id limit 1
$$;
create or replace function public._mp_split(sid bigint, s real) returns bigint
language plpgsql set search_path = public as $$
declare sg mp_segs; q record; nid bigint; pa int[]; pb int[]; bid bigint; ta int[]; tb int[]; prev jsonb; fa real[]; fb real[];
begin
  select * into sg from mp_segs where id = sid for update;
  if s < 0.3 or s > sg.len - 0.3 then raise exception '線のはしの近くでは分けられません'; end if;
  select * into q from _mp_at(sg.pts, s);
  insert into mp_nodes(kind, x, y, z) values (sg.kind, round(q.x * 100), round(q.y * 100), case when sg.prof is not null then _mp_pz(sg.prof, s) end) returning id into nid;   -- 高さ（t108）
  pa := _mp_sub(sg.pts, 0, s); pb := _mp_sub(sg.pts, s, sg.len);
  fa := _mp_prof_sub(sg.prof, 0, s); fb := _mp_prof_sub(sg.prof, s, sg.len);   -- 縦断（なければ null）
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color, snowp, prof, st, rack, hm, hopt, sig, quad, ps, gauge, g2, slp, cat, nw)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then least(case when sg.rack then 30 else 300 end, _mp_vlim(_mp_minr(pb))) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color,   -- color：路線カラーもそのまま（2026-10-29）
          sg.snowp, fb, _mp_st_of(pb, fb), sg.rack, sg.hm, sg.hopt, sg.sig, sg.quad, sg.ps, sg.gauge, sg.g2, sg.slp, sg.cat, sg.nw)   -- 雪よけ・高さ・アプト式もそのまま（t108）。高さの数値も（DB の更新84）・信号の段も（85）
  returning id into bid;   -- 線路の規格（軌間・枕木・架線・防音壁）も そのまま（DB の更新99）
  update mp_segs set pts = pa, ctl = null, bb = _mp_bb(pa), len = _mp_len(pa), vlim = case when kind = 'rail' then least(case when rack then 30 else 300 end, _mp_vlim(_mp_minr(pa))) else vlim end, n1 = nid,
                     prof = fa, st = _mp_st_of(pa, fa) where id = sid;
  ta := _mp_tiles(pa); tb := _mp_tiles(pb);
  delete from mp_occ where what = sg.kind and ref = sid;
  perform _mp_occ_set(sid, sg.kind, ta); perform _mp_occ_set(bid, sg.kind, tb);
  -- 使用料は、分けたあとの線ごとに区画で決めなおす（前から使っていた区画の使用料はそのまま）
  prev := (select jsonb_object_agg(e.x || ',' || e.y, e.fee) from mp_leases e where e.ref_kind = 'seg' and e.ref = sid);
  perform _mp_lease_set('seg', sid, sg.own_u, sg.own_c, sg.gov, prev);
  perform _mp_lease_set('seg', bid, sg.own_u, sg.own_c, sg.gov, prev);
  -- 駅・車庫は、後ろ半分にあるものを新しい線へ
  update mp_stations set seg = bid, at = at - s where seg = sid and at > s;
  update mp_depots set seg = bid, at = at - s where seg = sid and at > s;
  update mp_occ o set ref = o.ref where false;   -- （駅・車庫のマスは駅・車庫の番号なので、そのまま）
  perform _mp_chg('seg', sid, 'set', sg.bb);
  perform _mp_chg('seg', bid, 'set', sg.bb);
  return nid;
end $$;
create or replace function public._mp_seg_join2(xid bigint, yid bigint) returns bigint
language plpgsql set search_path = public as $$
declare x mp_segs; y mp_segs; nd bigint; xr boolean; yr boolean; px int[]; py int[]; pm int[]; lx real; jl real; n int; d real; fx real[]; fy real[]; fm real[];
begin
  select * into x from mp_segs where id = xid for update;
  select * into y from mp_segs where id = yid for update;
  if x.id is null or y.id is null or x.id = y.id or x.kind <> 'rail' or y.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  nd := case when x.n1 is not null and x.n1 in (y.n0, y.n1) then x.n1 when x.n0 is not null and x.n0 in (y.n0, y.n1) then x.n0 end;
  if nd is null then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if (select count(*) from mp_segs s where s.n0 = nd or s.n1 = nd) <> 2 then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if not (x.own_u is not distinct from y.own_u and x.own_c is not distinct from y.own_c and x.gov = y.gov) then raise exception 'ほかの会社の線路にはつなげません'; end if;
  if x.dbl <> y.dbl or x.elec <> y.elec then raise exception '単線と複線、電化と非電化がかわるところは、またげません（線路の設定をそろえてください）'; end if;
  if x.rack <> y.rack then raise exception 'アプト式とそうでない線路のつなぎ目は、またげません（線路の高さの設定をそろえてください）'; end if;
  if x.elec and x.ps <> y.ps then raise exception '電化方式がかわるところ（デッドセクション）は、またげません'; end if;   -- DB の更新87
  if x.quad <> y.quad then raise exception '複線と複々線がかわるところは、またげません（線路の設定をそろえてください）'; end if;   -- DB の更新86
  if x.gauge <> y.gauge or x.g2 is distinct from y.g2 then raise exception '軌間のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;   -- DB の更新99
  if x.slp <> y.slp then raise exception '枕木のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;
  if x.elec and x.cat <> y.cat then raise exception '架線のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;
  if x.nw <> y.nw then raise exception '防音壁のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;
  if x.sig <> y.sig then raise exception '信号のちがう線路のつなぎ目は、またげません（線路の信号をそろえてください）'; end if;   -- DB の更新85
  if x.name <> '' and y.name <> '' and x.name <> y.name then raise exception '名前のちがう線路のつなぎ目は、またげません（線路の名前をそろえてください）'; end if;
  xr := x.n1 is distinct from nd;   -- x は nd で終わるように
  yr := y.n0 is distinct from nd;   -- y は nd から始まるように
  px := case when xr then _mp_rev(x.pts) else x.pts end;
  py := case when yr then _mp_rev(y.pts) else y.pts end;
  n := array_length(px, 1);
  d := sqrt(((py[1] - px[n - 1]) / 100.0) ^ 2 + ((py[2] - px[n]) / 100.0) ^ 2);
  pm := px || case when d < 0.03 then py[3:] else py end;
  lx := _mp_len(px); jl := lx + case when d < 0.03 then 0 else d end;
  if _mp_minr(_mp_sub(pm, greatest(0, lx - 1.5), least(_mp_len(pm), lx + 1.5))) < 3 then raise exception 'つなぎ目のカーブがきつすぎて、またげません'; end if;
  -- 高さ（t108）：縦断もつなぐ（縦断のないほうは地面どおり）
  if x.prof is not null or y.prof is not null then
    fx := case when x.prof is null then _mp_prof_ground(px) when xr then _mp_prof_rev(x.prof, x.len) else x.prof end;
    fy := case when y.prof is null then _mp_prof_ground(py) when yr then _mp_prof_rev(y.prof, y.len) else y.prof end;
    fm := _mp_prof_cat(fx, fy, jl);
  end if;
  -- 駅・車庫の位置（はじめからの長さ）を、1本にした線の上に
  update mp_stations set at = case when xr then x.len - at else at end where seg = x.id;
  update mp_depots set at = case when xr then x.len - at else at end where seg = x.id;
  update mp_stations set seg = x.id, at = jl + case when yr then y.len - at else at end where seg = y.id;
  update mp_depots set seg = x.id, at = jl + case when yr then y.len - at else at end where seg = y.id;
  -- 使っているマス・使用料は x へ（同じ区画は1つに）
  delete from mp_occ o where o.what = 'rail' and o.ref = y.id and exists (select 1 from mp_occ o2 where o2.what = 'rail' and o2.ref = x.id and o2.x = o.x and o2.y = o.y);
  update mp_occ set ref = x.id where what = 'rail' and ref = y.id;
  delete from mp_leases l where l.ref_kind = 'seg' and l.ref = y.id and exists (select 1 from mp_leases l2 where l2.ref_kind = 'seg' and l2.ref = x.id and l2.x = l.x and l2.y = l.y);
  update mp_leases set ref = x.id where ref_kind = 'seg' and ref = y.id;
  update mp_segs set pts = pm, ctl = null, bb = _mp_bb(pm), len = _mp_len(pm),
                     n0 = case when xr then x.n1 else x.n0 end, n1 = case when yr then y.n0 else y.n1 end,
                     name = case when x.name <> '' then x.name else y.name end, cost = x.cost + y.cost, color = coalesce(x.color, y.color),
                     prof = fm, st = _mp_st_of(pm, fm), hm = case when fm is null then null when x.prof is null then y.hm when y.prof is null then x.hm when x.hm = y.hm and x.hopt is not distinct from y.hopt then x.hm else 'man' end,
                     hopt = case when fm is null then null when x.prof is null then y.hopt when y.prof is null then x.hopt when x.hm = y.hm and x.hopt is not distinct from y.hopt then x.hopt end,   -- 高さの数値（DB の更新84）
                     vlim = case when x.rack then least(30, _mp_vlim(_mp_minr(pm))) else _mp_vlim(_mp_minr(pm)) end
   where id = x.id;
  delete from mp_segs where id = y.id;
  delete from mp_nodes where id = nd;
  perform _mp_chg('seg', y.id, 'del', y.bb);
  perform _mp_chg('seg', x.id, 'set', _mp_bb(pm));
  return x.id;
end $$;
create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); pws smallint := least(2, greatest(0, coalesce((p_opts ->> 'ps')::int, 0)))::smallint; elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text; ho jsonb;
        sga smallint; sg2 smallint; ssl smallint; sct smallint; snw smallint;   -- 線路の規格（DB の更新99）
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_kind not in ('road', 'rail') then raise exception '作るものがちがいます'; end if;
  if p_kind = 'rail' then cls := 'rail'; if pa.gv then raise exception '線路は人か会社で作ります'; end if; end if;
  if p_kind = 'road' then
    if pa.gv then if cls not in ('exp', 'nat', 'pref', 'city', 'lane') then cls := 'city'; end if;
    else cls := 'priv'; end if;
    dbl := false; elec := false; quad := false;
    ln_ := least(case when cls = 'priv' then 2 else 4 end, greatest(case when cls in ('exp', 'nat') then 2 else 0 end,
             coalesce(ln_, case cls when 'exp' then 2 when 'nat' then 2 when 'pref' then 1 when 'city' then 1 when 'lane' then 0 else 1 end)));
    if cls = 'lane' then ln_ := 0; end if;
  else ln_ := 0; end if;
  perform _mp_geom_ok(p_pts);
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  if exists (select 1 from mp_segs s where s.kind = p_kind and s.bb && _mp_bb(p_pts) and s.pts = p_pts) then raise exception '同じところに、同じ線がもうあります'; end if;
  tiles := _mp_tiles(p_pts); ln := _mp_len(p_pts); rmin := _mp_minr(p_pts);
  if p_kind = 'rail' and not pa.gv then   -- 鉄道の免許（t108）：免許のない市区町村には引けない
    bad := _mp_lic_need(pa.pu, pa.pc, tiles);
    if bad is not null then raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', bad; end if;
  end if;
  if array_length(tiles, 1) / 2 > _mp_rate('max_tiles') then raise exception '一度に引けるのは %マスまでです。分けて引いてください', _mp_rate('max_tiles'); end if;
  if p_kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if p_kind = 'road' and rmin < 0.7 then raise exception 'カーブがきつすぎます'; end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  if quad then dbl := true; end if;   -- 複々線（DB の更新86）は複線のうち
  -- 線路の規格（DB の更新99）：p_opts の gauge・g2（三線軌条）・slp（枕木）・cat（架線）・nw（防音壁）。ないときは 1067mm・PC・シンプル・なし。第三軌条は 直流750V
  sga := case when (p_opts ->> 'gauge')::int in (762, 1067, 1372, 1435) then (p_opts ->> 'gauge')::int else 1067 end;
  sg2 := case when (p_opts ->> 'g2')::int in (762, 1067, 1372, 1435) and (p_opts ->> 'g2')::int <> sga then (p_opts ->> 'g2')::int end;
  ssl := least(3, greatest(0, coalesce((p_opts ->> 'slp')::int, 0)));
  sct := case when elec then least(6, greatest(0, coalesce((p_opts ->> 'cat')::int, 0))) else 0 end;
  snw := least(2, greatest(0, coalesce((p_opts ->> 'nw')::int, 0)));
  if p_kind <> 'rail' then sga := 1067; sg2 := null; ssl := 0; sct := 0; snw := 0; end if;
  if sct = 6 then pws := 3; end if;
  sw := case when p_kind = 'rail' then case when quad then 0.8 when dbl then 0.5 else 0.36 end else _mp_road_w(cls, ln_) end;
  cells := _mp_seg_cells_arr(p_pts, p_kind, sw, dbl);
  -- 高さ（t108）：縦断を決める。交差する線（線路どうしは 10m 上か下。道路とは、どちらも地面なら踏切・交差点）・建物（屋根＋5m より上か、地面−15m より下）・
  --   駅のホーム・車庫・バス停（±10m）・滑走路（下だけ）は、上か下を通る（つなぐはしの 20m はのぞく）。はしの高さは、つなぐ先と同じ
  if md not in ('auto', 'el', 'ug', 'tn', 'fl', 'tz') then md := 'auto'; end if;   -- tn：トンネル優先（DB の更新81）・fl：平坦（地上）・tz：高さを決める（DB の更新84）
  if p_kind <> 'rail' then rk := false; end if;
  ho := _mp_hopt(md, p_opts, p_kind, rk);   -- 高さ・勾配の上限（DB の更新84）
  if md = 'tz' and not coalesce(ho ? 'zt', false) then md := 'auto'; end if;
  if jsonb_typeof(p_opts -> 'prof') = 'array' then upf := array(select v::real from jsonb_array_elements_text(p_opts -> 'prof') v); end if;
  nhm := case when upf is not null then 'man' else md end;
  z0 := _mp_att_z(p_from, p_pts[1], p_pts[2]); z1 := _mp_att_z(p_to, p_pts[2 * np - 1], p_pts[2 * np]);
  ea := case when p_from is null then 0 else least(0.4, ln / 3) end; eb := case when p_to is null then ln else ln - least(0.4, ln / 3) end;
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], ho);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：マスごとに、つくり（地面・高架・トンネル・橋）と地形の倍率 ×（1 ＋ まちの係数）。アプト式は 1.3倍
  base := case when p_kind = 'rail' then _mp_rate('rail') * _mp_gauge_mul(sga) * case when sg2 is not null then 1.4 else 1 end * _mp_slp_bmul(ssl) else _mp_rate('road') * _mp_road_mul(cls, ln_) end;   -- 軌間・三線軌条・枕木（DB の更新99）
  if not pa.gv then   -- 国の工事は無料（t57b）：工事費の計算もしない
    cost := _mp_st_cost(tiles, ters, _mp_st_tiles(p_pts, pr ->> 'st'), rk, null, false, base, _mp_trmul(dbl, quad), case when elec then _mp_rate('elec') * _mp_cat_cmul(sct, _mp_st_tiles(p_pts, pr ->> 'st')) else 0 end)
            + _mp_nw_cost(snw) * (select count(*) from unnest(_mp_st_tiles(p_pts, pr ->> 'st')) c where c <> 'T');   -- 架線の種類・防音壁（DB の更新99）
  end if;
  cost := round(cost);
  vl := case when p_kind = 'rail' then case when rk then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else _mp_road_v(cls, ln_) end;
  select * into lq from _mp_lease_quote(cells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(cells, pa.pu, pa.pc, pa.gv);
  if p_dry then
    return jsonb_build_object('cost', cost, 'lease', round(lq.fee), 'own', lq.own, 'other', lq.other, 'state', lq.state, 'pub', lq.pub,
      'tiles', array_length(tiles, 1) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50),
      'vlim', vl, 'lanes', ln_, 've', case when p_kind = 'rail' and elec then _mp_cat_v(sct) end,
      'vtop', case when p_kind = 'rail' then least(_mp_seg_v(sga, sg2, ssl, rk), (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)) else _mp_road_v(cls, ln_) end,
      'need', need, 'hm', nhm, 'ho', ho, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns');   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt, quad, ps, gauge, g2, slp, cat, nw)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho, quad, case when elec then pws else 0 end, sga, sg2, ssl, sct, snw)
  returning id into sid;
  update mp_nodes set z = pf[2] where id = n0 and z is null;   -- はしの点の高さ（つないだ先は同じ高さ）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = n1 and z is null;
  perform _mp_occ_set(sid, p_kind, tiles);
  perform _mp_lease_set('seg', sid, pa.pu, pa.pc, pa.gv);
  -- 系統の道すじは、行きどまりの線（はしの1つしか ほかの線とつながらない・線のとちゅうにつないでいない）では変わらないので、見なおさない（DB の更新81）
  if p_kind = 'rail' then
    perform _mp_renet(pa.pu, pa.pc);
    if coalesce(p_from ? 'seg', false) or coalesce(p_to ? 'seg', false)
       or (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) >= 2 then
      -- 線のとちゅうから分かれた 行きどまりの線（はしの1つだけが、線のとちゅうにつながる）：道すじが変わるのは、分けた線を通る系統だけ（DB の更新94）
      perform _mp_routes_fix(pa.pu, pa.pc,
        case when coalesce(p_from ? 'seg', false) <> coalesce(p_to ? 'seg', false)
              and (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) = 1
             then array[coalesce((p_from ->> 'seg')::bigint, (p_to ->> 'seg')::bigint)] end);
    end if;
  end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee));
end $$;
create or replace function public.mp_seg_edit(p_id bigint, p_ctl int[], p_pts int[], p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); sg mp_segs; me_cs int[]; tiles int[]; old int[]; newt int[] := '{}'; ters text[]; ln real; rmin real; amt_ numeric := 0; mul real[]; i int; base numeric; lq record; a mp_nodes; b mp_nodes; np int := array_length(p_pts, 1) / 2; bad text;
        ncells int[]; need jsonb; md text; pr jsonb; pf real[]; z0 real; z1 real; vl int; ho jsonb;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  if exists (select 1 from mp_stations where seg = p_id) or exists (select 1 from mp_depots where seg = p_id) then raise exception '駅や車庫のある線は、形を変えられません（先に駅・車庫をこわしてください）'; end if;
  perform _mp_geom_ok(p_pts);
  select * into a from mp_nodes where id = sg.n0; select * into b from mp_nodes where id = sg.n1;
  if a.id is not null and sqrt(((a.x - p_pts[1]) / 100.0) ^ 2 + ((a.y - p_pts[2]) / 100.0) ^ 2) > 0.6 then raise exception 'はしの点は動かせません（はじめ）'; end if;
  if b.id is not null and sqrt(((b.x - p_pts[2 * np - 1]) / 100.0) ^ 2 + ((b.y - p_pts[2 * np]) / 100.0) ^ 2) > 0.6 then raise exception 'はしの点は動かせません（おわり）'; end if;
  tiles := _mp_tiles(p_pts); ln := _mp_len(p_pts); rmin := _mp_minr(p_pts);
  if sg.kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if array_length(tiles, 1) / 2 > _mp_rate('max_tiles') then raise exception '長すぎます'; end if;
  old := _mp_tiles(sg.pts);
  -- 新しく通るマス
  for i in 1..array_length(tiles, 1) / 2 loop
    if not exists (select 1 from generate_series(1, array_length(old, 1) / 2) j where old[2 * j - 1] = tiles[2 * i - 1] and old[2 * j] = tiles[2 * i]) then
      newt := newt || tiles[2 * i - 1] || tiles[2 * i];
    end if;
  end loop;
  ters := _mp_ters(newt);
  if sg.kind = 'rail' and not sg.gov then   -- 鉄道の免許（t108）：免許のない市区町村には引けない
    bad := _mp_lic_need(sg.own_u, sg.own_c, newt);
    if bad is not null then raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', bad; end if;
  end if;
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  ncells := _mp_seg_cells_arr(p_pts, sg.kind, sg.w, sg.dbl);
  -- 高さ（t108）：縦断を決めなおす。交差する線・建物・駅のホーム・車庫・バス停・滑走路は、上か下を通る（はしの 20m はのぞく）
  md := case when sg.hm in ('el', 'ug', 'tn', 'fl') then sg.hm when sg.hm = 'tz' and coalesce(sg.hopt ? 'zt', false) then 'tz' else 'auto' end;   -- 平坦・高さを決める（DB の更新84）も
  ho := nullif(case when md = 'tz' then sg.hopt else coalesce(sg.hopt, '{}'::jsonb) - 'zt' - 'zr' end, '{}'::jsonb);   -- 勾配の上限は そのまま
  z0 := _mp_end_z(sg.n0, p_id); z1 := _mp_end_z(sg.n1, p_id);
  pr := _mp_prof_make2(p_pts, sg.kind, sg.cls, z0, z1, md, sg.rack, null::real[], ncells, tiles, least(0.4, ln / 3)::real, (ln - least(0.4, ln / 3))::real, array[p_id], false, null::real[], ho);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：新しく通るマスはぜんぶ、前から通るマスは つくりが高くなった分だけ
  base := case when sg.kind = 'rail' then _mp_rate('rail') * _mp_gauge_mul(sg.gauge) * case when sg.g2 is not null then 1.4 else 1 end * _mp_slp_bmul(sg.slp) else _mp_rate('road') * _mp_road_mul(sg.cls, sg.lanes) end;
  if not sg.gov then   -- 国の工事は無料（t57b）
    amt_ := _mp_st_cost(tiles, _mp_ters(tiles), _mp_st_tiles(p_pts, pr ->> 'st'), sg.rack, _mp_st_map(sg.pts, sg.st), sg.rack, base,
                        _mp_trmul(sg.dbl, sg.quad), case when sg.elec then _mp_rate('elec') * _mp_cat_cmul(sg.cat, _mp_st_tiles(p_pts, pr ->> 'st')) else 0 end + case when sg.kind = 'rail' then _mp_nw_cost(sg.nw) else 0 end);   -- 線路の規格（DB の更新99）
  end if;
  amt_ := round(amt_);
  vl := case when sg.kind = 'rail' then case when sg.rack then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else sg.vlim end;
  select * into lq from _mp_lease_quote(ncells, sg.own_u, sg.own_c, sg.gov);
  -- 新しく通る他人の筆は、貸出料があるか申請が許可されているときだけ（前から通っている区画はそのまま）
  need := _mp_land_need(ncells, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  if p_dry then return jsonb_build_object('cost', amt_, 'lease', round(lq.fee), 'tiles', array_length(tiles, 1) / 2, 'new', coalesce(array_length(newt, 1), 0) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50), 'vlim', vl,
    'vtop', least(_mp_seg_v(sg.gauge, sg.g2, sg.slp, sg.rack), (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)), 'need', need,
    'hm', md, 'ho', ho, 'rack', sg.rack, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns'); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, format('%sの引きなおし', case when sg.kind = 'rail' then '線路' else '道路' end));
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  delete from mp_occ where what = sg.kind and ref = p_id;
  perform _mp_occ_set(p_id, sg.kind, tiles);
  update mp_segs set ctl = p_ctl, pts = p_pts, bb = _mp_bb(p_pts), len = ln, vlim = vl, cost = cost + amt_::bigint,
                     prof = pf, st = pr ->> 'st', hm = md, hopt = ho where id = p_id;
  update mp_nodes set z = pf[2] where id = sg.n0 and (z is null or z0 is null);   -- はしの点の高さ（この線だけのはしは、決めた高さに）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = sg.n1 and (z is null or z1 is null);
  -- 使用料は新しい形の区画で決めなおす
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', p_id, 'cost', amt_);
end $$;
create or replace function public.mp_seg_opts(p_id bigint, p_dbl boolean, p_elec boolean, p_name text, p_dry boolean, p_lanes int default null, p_quad boolean default null, p_ps int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ters text[]; amt_ numeric := 0; i int; base numeric; nl int; what text := ''; mul real[]; what2 text; wc int[]; need jsonb;
        nq boolean; nd boolean; m0 numeric; m1 numeric; rid bigint; ne boolean; nps smallint;   -- ne・nps：電化・電化方式（DB の更新87）
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  ters := _mp_ters(_mp_tiles(sg.pts));
  if not sg.gov then mul := case when sg.st is null then _mp_cmuls(_mp_tiles(sg.pts), ters) else _mp_st_muls(sg.pts, ters, sg.st, sg.rack) end; end if;   -- 国の工事は無料（t57b）。縦断のある線は つくりの倍率（t108）
  nq := sg.kind = 'rail' and coalesce(p_quad, sg.quad);
  nd := sg.kind = 'rail' and (coalesce(p_dbl, sg.dbl) or nq);
  ne := sg.kind = 'rail' and coalesce(p_elec, sg.elec);
  nps := case when ne then case when coalesce(p_ps, sg.ps) = 3 then 3 else least(2, greatest(0, coalesce(p_ps, sg.ps))) end::smallint else sg.ps end;   -- 3：第三軌条（直流750V。DB の更新99）
  if sg.kind = 'rail' then
    base := _mp_rate('rail');
    m0 := _mp_trmul(sg.dbl, sg.quad); m1 := _mp_trmul(nd, nq);
    if not sg.gov then
      for i in 1..array_length(ters, 1) loop
        if m1 > m0 then amt_ := amt_ + base * mul[i] * (m1 - m0); end if;
        if coalesce(p_elec, sg.elec) and not sg.elec then amt_ := amt_ + _mp_rate('elec');
        elsif ne and sg.elec and nps <> sg.ps then amt_ := amt_ + _mp_rate('elec') * 0.6; end if;   -- 電化方式を変える（架線と変電の設備を取りかえる。DB の更新87）
      end loop;
    end if;
    what := case when nq and not sg.quad then '複々線化' when nd and not sg.dbl then '複線化' else '' end || case when coalesce(p_elec, sg.elec) and not sg.elec then '電化' when ne and sg.elec and nps <> sg.ps then '電化方式の変更' else '' end;
    nl := sg.lanes;
  else
    nl := coalesce(p_lanes, sg.lanes);
    if sg.cls = 'lane' then nl := 0; end if;
    nl := least(case when sg.cls = 'priv' then 2 else 4 end, greatest(case when sg.cls in ('exp', 'nat') then 2 else 0 end, nl));
    if nl > sg.lanes and not sg.gov then
      for i in 1..array_length(ters, 1) loop
        amt_ := amt_ + _mp_rate('road') * (_mp_road_mul(sg.cls, nl) - _mp_road_mul(sg.cls, sg.lanes)) * mul[i];
      end loop;
    end if;
    if nl > sg.lanes then what := format('拡幅（片側%s車線）', nl); end if;
  end if;
  amt_ := coalesce(round(amt_), 0);
  if (sg.kind = 'rail' and ((nd and not sg.dbl) or (nq and not sg.quad))) or (sg.kind = 'road' and nl > sg.lanes) then
    wc := _mp_seg_cells_arr(sg.pts, sg.kind, case when sg.kind = 'rail' then case when nq then 0.8 else 0.5 end else _mp_road_w(sg.cls, nl) end, nd);
    what2 := _mp_bld_hit(wc);
    if what2 is not null then raise exception '建物のある土地（%）にかかるので、はばを広げられません', left(what2, 60); end if;
    -- 広げたところが他人の筆にかかるときは、貸出料があるか申請が許可されているときだけ
    need := _mp_land_need(wc, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  end if;
  if p_dry then return jsonb_build_object('cost', amt_, 'lanes', nl, 'need', need, 'quad', nq, 'ps', nps); end if;
  perform _mp_land_stop(need);
  if amt_ > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, case when sg.kind = 'rail' then '線路の' else '道路の' end || what); end if;
  update mp_segs set dbl = case when kind = 'rail' then nd else false end, quad = case when kind = 'rail' then nq else false end,
         elec = case when kind = 'rail' then coalesce(p_elec, elec) else false end, ps = nps,
         cat = case when kind <> 'rail' then cat when nps = 3 then 6 when cat = 6 then 0 else cat end,   -- 第三軌条は 直流750V だけ（DB の更新99）
         name = coalesce(left(p_name, 30), name),
         lanes = nl,
         w = case when kind = 'rail' then case when nq then 0.8 when nd then 0.5 else 0.36 end else _mp_road_w(cls, nl) end,
         vlim = case when kind = 'rail' then vlim else _mp_road_v(cls, nl) end,
         cost = cost + amt_::bigint
   where id = p_id;
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c, array[p_id]); end if;   -- この線を通る系統だけ（DB の更新94）
  if sg.kind = 'rail' and (nq is distinct from sg.quad or nps is distinct from sg.ps) then   -- 複々線・電化方式（DB の更新87）：通る系統の時刻を計算しなおす（道すじは同じなので _mp_routes_fix ではしない）
    for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = p_id loop
      perform _mp_resched(rid);
    end loop;
  end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  return jsonb_build_object('id', p_id, 'cost', amt_, 'lanes', nl, 'quad', nq, 'ps', nps);
end $$;
create or replace function public._mp_leg_from(g jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare it jsonb; sg mp_segs; m real; total real := 0; ell boolean := true; sgl boolean := false; p jsonb; pe jsonb; runs jsonb := '[]'::jsonb;
        cp int[] := '{}'; sub int[]; s0 real; s1 real; nc int; rail boolean := false;
        rpos real := 0; va real[] := '{}'; ve real[] := '{}'; vc int; vx int; he boolean := false;   -- 上限の速さのところ [はじめ, おわり, km/h, …]（m）：va 列車ぜんぶ（軌間・三線軌条・枕木・アプト式）・ve 電車（＋架線。DB の更新99）
begin
  for it in select * from jsonb_array_elements(g) loop
    select * into sg from mp_segs where id = (it ->> 0)::bigint;
    if not found then return null; end if;
    s0 := (it ->> 1)::real; s1 := (it ->> 2)::real;
    m := abs(s1 - s0) * 50;
    if m < 0.01 then continue; end if;
    total := total + m;
    if sg.kind = 'rail' then
      rail := true; ell := ell and sg.elec; sgl := sgl or not sg.dbl;
      vc := _mp_seg_v(sg.gauge, sg.g2, sg.slp, sg.rack);
      vx := case when sg.elec then least(vc, _mp_cat_v(sg.cat)) else vc end;
      if vc < 300 then va := va || array[rpos, rpos + m, vc]; end if;
      if vx < 300 then ve := ve || array[rpos, rpos + m, vx]; end if;
      if vx < vc then he := true; end if;
      rpos := rpos + m;
      sub := case when s0 <= s1 then _mp_sub(sg.pts, s0, s1) else _mp_rev(_mp_sub(sg.pts, s1, s0)) end;
      nc := coalesce(array_length(cp, 1), 0);
      if nc >= 2 and cp[nc - 1] = sub[1] and cp[nc] = sub[2] then sub := sub[3:]; end if;
      cp := cp || sub;
    else
      runs := runs || jsonb_build_array(jsonb_build_array(m, sg.vlim));
    end if;
  end loop;
  if rail then cp := _mp_resample(cp, 0.5); runs := _mp_vruns(cp, 0, _mp_len(cp)); end if;
  -- 上限の速さ：p は列車ぜんぶ（アプト式は 30km/h まで）、pe は電車（架線の上限も。p とちがうときだけ。DB の更新99）
  --   さいごの区切りは はしまで（長さの丸めで、はしに上限のないところが のこらないように）
  if coalesce(array_length(va, 1), 0) >= 3 and va[array_length(va, 1) - 1] >= rpos - 0.01 then va[array_length(va, 1) - 1] := 1e9; end if;
  if coalesce(array_length(ve, 1), 0) >= 3 and ve[array_length(ve, 1) - 1] >= rpos - 0.01 then ve[array_length(ve, 1) - 1] := 1e9; end if;
  p := _mp_runs_merge(_mp_runs_cap(runs, va));
  if he then pe := _mp_runs_merge(_mp_runs_cap(runs, ve)); end if;
  return jsonb_build_object('d', round(total::numeric, 1), 'p', p, 'e', ell, 's', sgl, 'g', g)
         || case when pe is not null and pe is distinct from p then jsonb_build_object('pe', pe) else '{}'::jsonb end;
end $$;
create or replace function public._mp_leg_time(r mp_routes, i0 int, i1 int, perf jsonb) returns int
language plpgsql set search_path = public as $$
declare key text; t int; p jsonb := '[]'::jsonb; i int; cut real := 1;
        ue boolean := false;   -- 電車は 架線の上限の速さ（leg の pe。DB の更新99）
begin
  if r.kind = 'rail' and coalesce((perf ->> 'elec')::boolean, false) then ue := exists (select 1 from generate_series(i0, i1 - 1) k where (r.legs -> (k - 1)) ? 'pe'); end if;
  key := _mp_pkey(perf) || case when ue then 'e' else '' end || ':' || i0 || '-' || i1;
  t := (r.runt ->> key)::int;
  if t is not null then return t; end if;
  for i in i0..i1 - 1 loop p := p || (r.legs -> (i - 1) -> case when ue and (r.legs -> (i - 1)) ? 'pe' then 'pe' else 'p' end); end loop;
  if r.kind = 'bus' then cut := 0.75; end if;   -- 信号・混雑
  t := _mp_run(p, coalesce((perf ->> 'acc')::real, case when r.kind = 'bus' then 3.6 when r.kind = 'ship' then 0.15 else 2 end),
               coalesce((perf ->> 'dec')::real, case when r.kind = 'ship' then 0.2 else 3.5 end),
               coalesce((perf ->> 'vmax')::real, case when r.kind = 'bus' then 80 when r.kind = 'ship' then 30 else 100 end), cut);
  if r.kind = 'bus' then t := t + 6 * (select count(*) from generate_series(i0, i1 - 1) k, jsonb_array_elements(r.legs -> (k - 1) -> 'g'))::int; end if;  -- 交差点
  if r.kind = 'ship' then t := t + _mp_rate('ship_dock')::int; end if;   -- 船：港を出る・港に入る（t54o）
  if r.kind = 'air' then   -- 飛行機：地上走行・離陸・上昇・降下・着陸（air_ovh 秒）＋ 巡航（最高速度の8割で。t54p）
    t := _mp_rate('air_ovh')::int + round(coalesce((select sum((r.legs -> (k - 1) ->> 'd')::real) from generate_series(i0, i1 - 1) k), 0)
                                          / (coalesce((perf ->> 'vmax')::real, 500) * 0.8 / 3.6))::int;
  end if;
  update mp_routes set runt = runt || jsonb_build_object(key, t) where id = r.id;
  return t;
end $$;
create or replace function public._mp_legs_near(a jsonb, b jsonb) returns boolean
language sql stable set search_path = public as $$
  select jsonb_array_length(coalesce(a, '[]'::jsonb)) = jsonb_array_length(coalesce(b, '[]'::jsonb))
     and not exists (select 1 from jsonb_array_elements(coalesce(a, '[]'::jsonb)) with ordinality x(l, k)
                       join jsonb_array_elements(coalesce(b, '[]'::jsonb)) with ordinality y(m, j) on j = x.k
                      where (x.l - 'g' - 'p' - 'd') is distinct from (y.m - 'g' - 'p' - 'd')
                         or abs(coalesce((x.l ->> 'd')::real, 0) - coalesce((y.m ->> 'd')::real, 0)) > 1
                         or abs(_mp_ptime(x.l -> 'p') - _mp_ptime(y.m -> 'p')) > 1)
     and _mp_leg_quad(a) = _mp_leg_quad(b) and _mp_leg_pm(a) = _mp_leg_pm(b) and _mp_leg_dz(a) = _mp_leg_dz(b)
     and _mp_leg_fed(a) = _mp_leg_fed(b) and _mp_leg_sig(a) = _mp_leg_sig(b) and _mp_leg_gm(a) = _mp_leg_gm(b)   -- 軌間（DB の更新99）
$$;
create or replace function public._mp_li_put(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes;
begin
  select * into r from mp_routes where id = rid;
  if not found or r.kind <> 'rail' then perform set_config('mp.li_r', '', true); return; end if;
  perform set_config('mp.li_q', coalesce(_mp_leg_quad(r.legs)::text, ''), true);
  perform set_config('mp.li_pm', coalesce(_mp_leg_pm(r.legs)::text, ''), true);
  perform set_config('mp.li_dz', coalesce(_mp_leg_dz(r.legs)::text, ''), true);
  perform set_config('mp.li_fd', coalesce(_mp_leg_fed(r.legs)::text, ''), true);   -- 変電所から電気が来ているか（DB の更新89）
  perform set_config('mp.li_gm', coalesce(_mp_leg_gm(r.legs)::text, ''), true);   -- 走れる軌間（DB の更新99）
  perform set_config('mp.li_r', rid::text, true);
end $$;
create or replace function public._mp_train_times(tr mp_trains, hold jsonb, waits bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare r mp_routes; perf jsonb; n int; ord int[]; i int; k int; t int; arr int; dep int; spec jsonb; sc jsonb := '[]'::jsonb; ws text[] := '{}';
        st mp_stations; lastStop int; run int; trk int; dw int; flen real; stop boolean;
        lq boolean[]; qx boolean;   -- 複々線（DB の更新86）
        lpm int[]; ldz int[]; pneed int; pm int; dzp int := 6; lgm int[]; gok int;   -- 電化方式・デッドセクション（DB の更新87）・軌間（99）
        e jsonb; ci bigint; o mp_ops; cp jsonb; ka int; kb int; cx jsonb := '[]'::jsonb; cw text; nmax int; x jsonb; skipped bigint; k0 int; k1 int;
begin
  select * into r from mp_routes where id = tr.route;
  perf := case when tr.form is not null then _mp_form_perf(tr.form) end;
  n := array_length(r.stops, 1);
  ord := case when tr.dir = 1 then array(select generate_series(1, n)) else array(select generate_series(n, 1, -1)) end;
  dw := r.dwell;
  lq := case when r.kind = 'rail' then case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_q', true), '')::boolean[] else _mp_leg_quad(r.legs) end end;   -- 組みなおしのあいだは1回だけ計算したもの（DB の更新88）
  qx := r.kind = 'rail' and _mp_kprio(r.own_u, r.own_c, tr.kind) <= 3;   -- 急行線を走る列車（優先番号 3 まで。DB の更新86）
  -- 走る区間（途中始発・途中止まり。2026-10-28）：走る順の k0 番目から k1 番目まで
  k0 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sa, false), 1); k1 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sb, true), n);   -- 環状線：始発は走る順で前の、終着はうしろのほう
  if k0 >= k1 then ws := ws || '始発駅と終着駅の順がちがいます（系統の端から端まで走ります）'::text; k0 := 1; k1 := n; end if;
  if perf is null then ws := ws || '編成が決まっていません（走りません）'::text; end if;
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
        where l.lo >= least(ord[k0], ord[k1]) and l.lo < greatest(ord[k0], ord[k1]) and not (l.v ->> 'e')::boolean) then   -- 走る区間だけ
    ws := ws || '電化していない区間があります（電車は走れません）'::text;
  end if;
  -- 電化方式（DB の更新87）：走る区間の方式を、編成が ぜんぶ走れるか
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean then
    if current_setting('mp.li_r', true) = r.id::text then   -- 組みなおしのあいだは1回だけ計算したもの（DB の更新88）
      lpm := nullif(current_setting('mp.li_pm', true), '')::int[]; ldz := nullif(current_setting('mp.li_dz', true), '')::int[];
    else lpm := _mp_leg_pm(r.legs); ldz := _mp_leg_dz(r.legs); end if;
    pm := coalesce((perf ->> 'ps')::int, 1);
    pneed := (select coalesce(bit_or(lpm[lo]), 0) from generate_series(least(ord[k0], ord[k1]), greatest(ord[k0], ord[k1]) - 1) lo);
    if pneed & ~pm <> 0 then
      ws := ws || format('%s の区間があります（この編成は %s だけ。走れません）', _mp_ps_names(pneed & ~pm), _mp_ps_names(pm));
    end if;
  end if;
  -- 軌間（DB の更新99）：走る区間の線路の軌間に、編成が合うか（三線軌条は2つの軌間）
  if perf is not null and r.kind = 'rail' then
    lgm := case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_gm', true), '')::int[] else _mp_leg_gm(r.legs) end;
    gok := (select coalesce(bit_and(lgm[lo]), 15) from generate_series(least(ord[k0], ord[k1]), greatest(ord[k0], ord[k1]) - 1) lo);
    if coalesce((perf ->> 'gm')::int, 2) & ~gok <> 0 then
      ws := ws || format('軌間のちがう区間があります（この編成は %s。走れません）', _mp_gauge_names(coalesce((perf ->> 'gm')::int, 2)));
    end if;
  end if;
  -- 変電所（DB の更新89）：走る区間に、電気の来ていない（変電所から遠い）電化した線があれば走れない
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean
     and exists (select 1 from unnest(case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_fd', true), '')::boolean[] else _mp_leg_fed(r.legs) end) with ordinality x(f, lo)
                  where x.lo >= least(ord[k0], ord[k1]) and x.lo < greatest(ord[k0], ord[k1]) and not x.f) then   -- 組みなおしのあいだは系統ごとに1回だけ計算したもの
    ws := ws || '変電所から遠く、電気が来ていない区間があります（変電所をつくってください。電車は走れません）'::text;
  end if;
  -- 飛行機：滑走路の短い空港には離着陸できない（t54p）
  if perf is not null and r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then
    ws := ws || format('滑走路の短い空港があります（%sm以上いります。飛びません）', perf ->> 'rwy');
  end if;
  -- 連結：つなぐ運用・つなぐ駅と切りはなす駅（走る順の何番目か）
  for e, ci in select z.v, z.o from jsonb_array_elements(coalesce(tr.cpl, '[]'::jsonb)) with ordinality z(v, o) loop
    cw := null; o := null; cp := null;
    select * into o from mp_ops where id = (e ->> 'op')::bigint;
    if o.id is null then cw := '連結する運用が見つかりません';
    elsif r.kind <> 'rail' or o.kind <> 'rail' then cw := 'バスは連結できません';
    elsif o.form is null then cw := format('運用 %s に編成が入っていません', o.num);
    elsif perf is null then cw := 'この列車の編成が決まっていません';
    else
      cp := _mp_form_perf(o.form);
      if cp is null then cw := format('運用 %s に編成が入っていません', o.num); end if;
    end if;
    ka := case when e ->> 'a' is null then k0 else _mp_kpos(r.stops, tr.dir, (e ->> 'a')::bigint, false) end;
    kb := case when e ->> 'b' is null then k1 else _mp_kpos(r.stops, tr.dir, (e ->> 'b')::bigint, true) end;
    if cw is null then
      if ka is null or kb is null then cw := '連結する駅がこの系統にありません';
      elsif ka < k0 or kb > k1 then cw := '連結する駅が、この列車の走る区間にありません';
      elsif ka >= kb then cw := '連結する駅は、切りはなす駅より前にしてください';
      else
        skipped := case when ka > k0 and r.stops[ord[ka]] = any(tr.skip) then r.stops[ord[ka]] when kb < k1 and r.stops[ord[kb]] = any(tr.skip) then r.stops[ord[kb]] end;
        if skipped is not null then cw := format('%s にこの列車は止まりません（連結・切りはなしができません）', (select name from mp_stations where id = skipped)); end if;
      end if;
    end if;
    cx := cx || jsonb_build_array(jsonb_build_object('op', (e ->> 'op')::bigint, 'num', o.num, 'f', o.form,
             'a', case when ka is not null then r.stops[ord[ka]] end, 'b', case when kb is not null then r.stops[ord[kb]] end, 'ka', ka, 'kb', kb,
             'n', (cp ->> 'n')::int, 'len', (cp ->> 'len')::real, 'v', cw is null, 'ok', cw is null, 'w', cw, 'cp', cp));
  end loop;
  -- 両数：駅ごとに足して 16両まで（こえるときは連結しない）
  if exists (select 1 from jsonb_array_elements(cx) c where (c ->> 'v')::boolean) then
    nmax := (select max(coalesce((perf ->> 'n')::int, 0) + coalesce((select sum((c ->> 'n')::int) from jsonb_array_elements(cx) c
                                                   where (c ->> 'v')::boolean and (c ->> 'ka')::int <= kk and kk <= (c ->> 'kb')::int), 0))
             from generate_series(1, n) kk);
    if nmax > 16 then
      cx := (select jsonb_agg(case when (c.v ->> 'v')::boolean then c.v || jsonb_build_object('v', false, 'ok', false, 'w', format('連結すると %s両になります（16両まで）', nmax)) else c.v end order by c.o)
               from jsonb_array_elements(cx) with ordinality c(v, o));
    end if;
  end if;
  -- 性能：いちばん弱い編成にあわせる
  for x in select c from jsonb_array_elements(cx) c where (c ->> 'v')::boolean loop
    perf := perf || jsonb_build_object('acc', least((perf ->> 'acc')::real, coalesce((x -> 'cp' ->> 'acc')::real, (perf ->> 'acc')::real)),
                                       'dec', least(coalesce((perf ->> 'dec')::real, 3.5), coalesce((x -> 'cp' ->> 'dec')::real, 3.5)),
                                       'vmax', least((perf ->> 'vmax')::real, coalesce((x -> 'cp' ->> 'vmax')::real, (perf ->> 'vmax')::real)));
  end loop;
  flen := coalesce((perf ->> 'len')::real, 0);
  t := tr.dep; lastStop := ord[k0];
  for k in k0..k1 loop
    i := ord[k];
    select * into st from mp_stations where id = r.stops[i];
    spec := tr.tt -> (r.stops[i]::text);
    stop := k = k0 or k = k1 or not (r.stops[i] = any(tr.skip));
    trk := coalesce((spec ->> 't')::int, _mp_pick_trk(_mp_sta_trk(st), tr.dir, st.id = any(coalesce(waits, '{}'))
                       or (qx and coalesce(coalesce(lq[i - 1], lq[i]) and coalesce(lq[i], lq[i - 1]), false))));   -- 複々線の中の駅：急行線の列車は待避線の番線（DB の更新86）
    if trk > st.tracks then ws := ws || format('%s に %s番線はありません', st.name, trk); trk := st.tracks; end if;
    if stop and r.kind = 'rail' and (_mp_sta_trk(st) -> (trk - 1) ->> 'm') = 'pass' then
      ws := ws || format('%s の %s番線は通過線です（ホームがないので止まれません）', st.name, trk);   -- t62
    end if;
    if k = k0 then
      arr := null; dep := tr.dep + coalesce((hold ->> st.id::text)::int, 0); t := dep;
    else
      if not stop then continue; end if;
      -- 前に止まった駅からここまで（通過駅をまとめて）
      run := _mp_leg_time(r, least(lastStop, i), greatest(lastStop, i), perf);
      if ldz is not null then run := run + dzp * (select coalesce(sum(ldz[lo]), 0) from generate_series(least(lastStop, i), greatest(lastStop, i) - 1) lo)::int; end if;   -- デッドセクションは惰行で通る（1か所 6秒。DB の更新87）
      arr := t + run;
      if spec ? 'a' then
        if (spec ->> 'a')::int < arr then ws := ws || format('%s 着 %s は早すぎます（いちばん早くて %s）', st.name, _mp_hms((spec ->> 'a')::int), _mp_hms(arr));
        else arr := (spec ->> 'a')::int; end if;
      end if;
      if k = k1 then dep := null;
      else
        dep := arr + dw;
        if spec ? 'd' then
          if (spec ->> 'd')::int < arr + 10 then ws := ws || format('%s 発 %s は早すぎます（いちばん早くて %s）', st.name, _mp_hms((spec ->> 'd')::int), _mp_hms(arr + 10));
          else dep := (spec ->> 'd')::int; end if;
        end if;
        dep := dep + coalesce((hold ->> st.id::text)::int, 0);   -- 待避・続行
      end if;
    end if;
    -- ホームの長さ（連結している編成もふくめて）
    if stop and r.kind = 'rail' then
      flen := coalesce((perf ->> 'len')::real, 0) + coalesce((select sum((c ->> 'len')::real) from jsonb_array_elements(cx) c
                                                              where (c ->> 'v')::boolean and (c ->> 'ka')::int <= k and k <= (c ->> 'kb')::int), 0);
      if flen > st.plat then ws := ws || format('%s のホーム（%sm）より編成（%sm）が長いです', st.name, st.plat, flen); end if;
    end if;
    sc := sc || jsonb_build_array(jsonb_build_array(r.stops[i], arr, dep, trk));
    if dep is not null then t := dep; end if;
    lastStop := i;
  end loop;
  -- 連結の時刻（つなぐ駅を出る時刻・切りはなす駅に着く時刻）
  cx := coalesce((select jsonb_agg((c.v - 'cp' - 'ka' - 'kb') || jsonb_build_object(
          'ta', (select (s.v ->> 2)::int from jsonb_array_elements(sc) with ordinality s(v, so) where (s.v ->> 0)::bigint = (c.v ->> 'a')::bigint order by s.so limit 1),
          'tb', (select (s.v ->> 1)::int from jsonb_array_elements(sc) with ordinality s(v, so) where (s.v ->> 0)::bigint = (c.v ->> 'b')::bigint order by s.so desc limit 1)) order by c.o)
        from jsonb_array_elements(cx) with ordinality c(v, o)), '[]'::jsonb);
  return jsonb_build_object('sc', sc, 'ws', to_jsonb(ws), 'cx', cx);
end $$;
create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb; rfid bigint; nsub int; orf real; sb2 bigint;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
        lfd boolean[]; rsh jsonb; sube jsonb := '{}'::jsonb; sk text; sf real; sbx record; ld int;   -- 変電所（DB の更新89）
        trk jsonb := '{}'::jsonb; xkb real;   -- 競馬場のお客（DB の更新92）
        lgm int[];   -- 走れる軌間（DB の更新99）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  -- 競馬場（DB の更新92）：この1時間のレースの来場者が、近くの駅・バス停で乗り降りする（系統ごと）。うまくいかなくても、ふだんどおり
  begin trk := _mp_track_riders(h); exception when others then trk := '{}'::jsonb; raise warning 'mp track riders: %', sqlerrm; end;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    lfd := case when r.kind = 'rail' then _mp_leg_fed(r.legs) end; rsh := case when r.kind = 'rail' then _mp_route_feed(r.legs) end;   -- 変電所（DB の更新89）
    lgm := case when r.kind = 'rail' then _mp_leg_gm(r.legs) end;   -- 軌間（DB の更新99）
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null then continue; end if;
      dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      -- 編成の工事中（検査・改造・転属・納車）にかかる列車は運休：始発駅を出てから終点に着くまでのどこかが、工事の時間にかかるもの（DB の更新60）
      --   予備編成（DB の更新80）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走。予定は mp_subst）
      rfid := tr.fid;
      if _mp_form_busy(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) then
        begin rfid := _mp_subst_ok(tr.id, d0, tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)); exception when others then rfid := null; end;
        if rfid is not null then perf := _mp_form_perf(rfid); end if;
        if rfid is null or perf is null then nwk := nwk + 1; continue; end if;
        nsub := nsub + 1;
      end if;
      -- 持ち主が運休にした列車（1本ずつ・編成ごと。DB の更新60）
      begin if _mp_cxl_on(tr.id, d0, tr.fid, dep_abs) then ncan := ncan + 1; continue; end if; exception when others then null; end;
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
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and (select coalesce(bit_or(x.m), 0) from unnest(_mp_leg_pm(r.legs)) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) & ~coalesce((perf ->> 'ps')::int, 1) <> 0 then continue; end if;   -- 電化方式がちがう区間は走れない（DB の更新87）
      if r.kind = 'rail' and lgm is not null and coalesce((perf ->> 'gm')::int, 2) & ~(select coalesce(bit_and(x.m), 15) from unnest(lgm) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) <> 0 then continue; end if;   -- 軌間のちがう区間は走れない（DB の更新99）
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from unnest(lfd) with ordinality x(f, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib) and not x.f) then continue; end if;   -- 変電所から遠く、電気が来ていない区間は走れない（DB の更新89）
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
      end if;
      -- 変電所の負荷（DB の更新89）：電車・電気機関車は、走る区間の変電所に 出力 × 0.45 × 走る時間（1時間まで）× 長さの割合
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and rsh is not null then
        for sk, sf in select key, value::real from jsonb_each_text(rsh) loop
          sube := sube || jsonb_build_object(sk, coalesce((sube ->> sk)::real, 0) + coalesce((perf ->> 'kw')::real, 0) * 0.45 * least(rt, 3600) * sf * cf);
        end loop;
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        -- 予備編成（DB の更新82）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走）
        sb2 := case when rfid = tr.fid then _mp_subst_pick(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) end;
        if sb2 is null then
          broke := broke + 1;
          update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
          continue;
        end if;
        insert into mp_subst(train, day, orig, sub, own_u, own_c, t0, t1)
          select tr.id, d0, tr.fid, sb2, f.own_u, f.own_c, to_timestamp(dep_abs), to_timestamp(dep_abs + rt) from mp_forms f where f.id = tr.fid
        on conflict (train, day) do update set orig = excluded.orig, sub = excluded.sub, t0 = excluded.t0, t1 = excluded.t1, made_at = now();
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''),
                                    format('故障のため予備編成「%s」が代走（%s）', (select name from mp_forms where id = sb2), to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        rfid := sb2; perf := _mp_form_perf(sb2); nsub := nsub + 1;
        if perf is null then broke := broke + 1; continue; end if;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）。区間折り返しは走った分だけ（DB の更新82）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800) * coalesce(orf, 1);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = rfid;   -- 代走なら予備編成がいたむ（DB の更新80）
      -- 連結している編成（つなぐ駅から切りはなす駅まで）：その分いたみ、定員は走る時間のわりあいで足す
      ccap := 0;
      for ce in select c.v from jsonb_array_elements(tr.cplx) c(v)
                 where coalesce((c.v ->> 'ok')::boolean, false) and exists (select 1 from mp_ops ox where ox.id = (c.v ->> 'op')::bigint and ox.form = (c.v ->> 'f')::bigint) loop
        cperf := _mp_form_perf((ce ->> 'f')::bigint);
        if cperf is null or _mp_form_busy((ce ->> 'f')::bigint, to_timestamp(dep_abs + coalesce((ce ->> 'ta')::int - tr.dep, 0)), to_timestamp(dep_abs + coalesce((ce ->> 'tb')::int - tr.dep, rt))) then continue; end if;   -- 工事中の編成はつながない（DB の更新60）
        crt := greatest(60, coalesce((ce ->> 'tb')::int - (ce ->> 'ta')::int, rt));
        update mp_cars c set cond = greatest(0, cond - 0.035 * crt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
         where form = (ce ->> 'f')::bigint;
        ccap := ccap + (cperf ->> 'cap')::int * least(1, crt / greatest(rt, 1));
      end loop;
      if ev is not null then dsum := dsum + coalesce((ev ->> 'dly')::float8, 0); nd := nd + 1; end if;   -- 終点での遅れ（秒）
      nrun := nrun + 1;   -- 走った列車（回送・試運転もふくむ。乗り入れの線路使用料。DB の更新60）
      if tr.kind in ('回送', '試運転') then continue; end if;   -- お客は乗せない
      nok := nok + 1; secs := secs + rt / cf;
      if tr.dir = 1 then tph1 := tph1 + cf; cap1 := cap1 + round(((perf ->> 'cap')::int + ccap) * cf)::int; else tph2 := tph2 + cf; cap2 := cap2 + round(((perf ->> 'cap')::int + ccap) * cf)::int; end if;
      acn := acn + case when (perf ->> 'ac')::boolean then 1 else 0 end; htn := htn + case when (perf ->> 'heat')::boolean then 1 else 0 end;
      toil := toil + case when (perf ->> 'toilet')::boolean then 1 else 0 end;
      -- 料金の席と設備（DB の更新72）：グリーン席、夜行の寝台と個室、食堂車・ラウンジ・展望車、荷物車・郵便車（走る km）
      xg := xg + coalesce((perf ->> 'g')::real, 0) * cf;
      if xnight then xa := xa + coalesce((perf ->> 'a')::real, 0) * cf; xb := xb + coalesce((perf ->> 'b')::real, 0) * cf; xrm := xrm + coalesce((perf ->> 'rooms')::real, 0) * cf; end if;
      xdin := xdin + case when (perf ->> 'din')::boolean then 1 else 0 end;
      xlng := xlng + case when (perf ->> 'lng')::boolean or (perf ->> 'obs')::boolean then 1 else 0 end;
      xbag := xbag + coalesce((perf ->> 'bag')::real, 0) * km * cf;
    end loop;
    ran := ran || jsonb_build_object(r.id::text, nrun);
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
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'shop', nwk, 'trust', round(r.trust::numeric, 2)) where id = r.id;
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
    if km > 50 then comf := comf * (1 + 0.05 * xdin / nok + 0.05 * xlng / nok); end if;   -- 食堂車・ラウンジ・展望車のある列車は、長い系統で少し人気（DB の更新72）
    dem := pop * _mp_rate(case r.kind when 'rail' then 'g_rail' when 'ship' then 'g_ship' when 'air' then 'g_air' else 'g_bus' end) * _mp_hourf(hh) * q * comf * share;
    -- 運行の乱れ：遅れが大きいほど お客がへる（平均 10分で 1割・いちばん 3割）。信頼（0.7〜1）もかける
    dem := dem * coalesce(r.trust, 1) * (1 - least(0.3, dsum / greatest(nd, 1) / 60 / 100));
    xkb := coalesce((trk ->> r.id::text)::real, 0) * least(1.2, greatest(0.7, q));   -- 競馬場のお客（DB の更新92）：遅い線は少し へる
    dem := dem + xkb;
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
    -- 料金（DB の更新72）：グリーン席は乗る人の8%まで（席は1時間に2回転）。寝台は長い系統の夜行だけ（80km をこえるとふえ、680km で4割）。
    --   寝台に乗りたい人の3割は A寝台、のこりは B寝台。個室はそのうち（A の半分・B の2割。1室ごと）。料金は運賃の グリーン1倍・B寝台3倍・A寝台6倍・個室3倍（mp_rates で変えられる）
    --   食堂車：乗る人の5%が食事（1人 600 X）。荷物車・郵便車：1両 1km ごとに 120 X
    xfee := 0; xmeal := 0; xbagr := 0;
    if r.kind = 'rail' then
      xug := least(served * 0.08, xg * 2);
      xus := served * least(0.4, greatest(0, (km - 80) / 600.0));
      xua := least(xus * 0.3, xa); xub := least(xus - xua, xb); xur := least(xrm, xua * 0.5 + xub * 0.2);
      xfee := fare * (xug * coalesce(_mp_rate('fee_g'), 1) + xub * coalesce(_mp_rate('fee_b'), 3) + xua * coalesce(_mp_rate('fee_a'), 6) + xur * coalesce(_mp_rate('fee_room'), 3));
      if xdin > 0 and km > 30 then xmeal := served * 0.05 * xdin / nok * coalesce(_mp_rate('meal'), 600); end if;
      xbagr := xbag * coalesce(_mp_rate('bag_km'), 120);
    end if;
    rev := floor(served * fare + xfee + xmeal + xbagr);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'shop', nwk, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0), 'kb', nullif(round(case when dem > 0 then served * xkb / dem else 0 end), 0)));   -- kb：競馬場のお客（DB の更新92）   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 変電所（DB の更新89）：この1時間の負荷（平均 × 1.6 を いちばん多いときとみる）。容量をこえたら電圧の低下、1.5倍をこえたら停止（3時間に1回まで）
  for sbx in select vs.* from mp_subs vs loop
    ld := round(coalesce((sube ->> sbx.id::text)::real, 0) / 3600 * 1.6);
    update mp_subs set load = ld where id = sbx.id;
    if ld > sbx.cap and (sbx.ev_at is null or sbx.ev_at < h - interval '3 hours') and (sbx.trip is null or sbx.trip < now()) then
      begin perform _mp_sub_event(sbx.id, ld); exception when others then raise warning 'mp sub event: %', sqlerrm; end;
    end if;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when kind = 'rail' then _mp_trk_upk(gauge, g2, slp, elec, cat) else 1 end + case when kind = 'rail' then len * _mp_nw_upk(nw) else 0 end a, '線路・道路' k   -- 規格（DB の更新99）
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
      union all select own_u, own_c, upk, '変電所' from mp_subs where not gov   -- 変電所（DB の更新89）
      union all select p.own_u, p.own_c, (_mp_attr_kinds() -> a.kind ->> 'upk')::numeric, 'アトラクション' from mp_attrs a join mp_blds b on b.id = a.bld join mp_parcels p on p.id = b.parcel where not p.gov   -- DB の更新91
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
      join lateral (select coalesce((ran ->> ro.id::text)::int, 0) n) cnt on cnt.n > 0   -- ほんとうに走った列車だけ（運休・工事中・故障はのぞく。DB の更新60）
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
create or replace function public._mp_form_perf(fid bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare r record; acc real; rail boolean;
begin
  select count(*) n, sum(t.len) len, sum(t.cap) cap, sum(t.seats) seats, sum(t.mass) mass, sum(t.power) pw, min(t.vmax) vmax, min(t.dec) dcc,
         min(t.acc) bacc, bool_or(t.elec) elec, bool_and(c.ac) filter (where t.cap > 0) ac, bool_and(c.heat) filter (where t.cap > 0) heat,   -- 冷房・暖房は、人が乗る車で見る（機関車・電源車・荷物車をのぞく。DB の更新72）
         bool_or(c.toilet) toilet, min(c.cond) cond,
         bool_or(c.busy_until > now()) busy, min(t.series) series, bool_and(t.role not in ('Bus', 'Truck', 'Ship', 'Air')) israil, sum(t.upkeep) upkeep,
         bool_or(t.role = 'Ship') isship, sum(t.load) load, bool_or(t.role = 'Air') isair, max(t.rwy) rwy,
         -- 加速につかえる力（DB の更新71）：気動車はエンジンの力が液体変速機で6割、機関車は重い客車をひくので 電気45%・ディーゼル40%
         --   蒸気機関車は 50%（低い速さで力が出る。DB の更新78）
         sum(t.power * case when t.role in ('Dc', 'D') then 0.6 when t.role = 'L' then case when t.elec then 0.45 when 'stm' = any(t.fn) then 0.5 else 0.4 end else 1 end) epw,
         -- 料金の席と設備（DB の更新72）：グリーン席・A寝台・B寝台・個室の数・食堂車（ビュフェ）・ラウンジ・展望車・荷物車と郵便車の両数・電源車
         sum(case when t.cls = 'G' then t.cap else 0 end) xg, sum(case when t.cls = 'A' then t.cap else 0 end) xa, sum(case when t.cls = 'B' then t.cap else 0 end) xb, sum(t.rooms) xrm,
         bool_or(t.fn && array['din', 'buf']) xdin, bool_or('lng' = any(t.fn)) xlng, bool_or('obs' = any(t.fn)) xobs,
         count(*) filter (where t.fn && array['bag', 'mail']) xbag, bool_or('pow' = any(t.fn)) xpow,
         -- 機関車と客車の両数・蒸気機関車（水と石炭で走れる km。重連なら短いほう。DB の更新78）
         count(*) filter (where t.role = 'L') xnl, count(*) filter (where t.role = 'P') xnp,
         min(t.wkm) filter (where 'stm' = any(t.fn)) xwkm, min(t.ckm) filter (where 'stm' = any(t.fn)) xckm,
         bit_and(t.ps::int) filter (where t.elec) xps, bit_or(_mp_gbit(t.gauge)) filter (where t.role not in ('Bus', 'Truck', 'Ship', 'Air')) xgm   -- 走れる電化方式（電化のいる車ぜんぶが走れるもの。DB の更新87）
    into r from mp_cars c join mp_types t on t.code = c.type where c.form = fid;
  if r.n = 0 then return null; end if;
  rail := r.israil;
  -- 加速度（km/h/s）：乗っている人（定員の半分・1人 55kg）もふくめた重さで
  --   上限は3.5と、形式の起動加速度（acc。特急形などは ゆっくり。DB の更新71）
  acc := case when rail then least(3.5, coalesce(r.bacc, 3.5), 0.38 * r.epw / greatest(1, r.mass + r.cap * 0.5 * 0.055)) else coalesce(r.bacc, 3.5) end;
  return jsonb_build_object('n', r.n, 'len', r.len, 'cap', r.cap, 'seats', r.seats, 'mass', round(r.mass::numeric, 1), 'kw', r.pw,
    'acc', round(acc::numeric, 2), 'dec', r.dcc, 'vmax', r.vmax, 'elec', r.elec, 'ac', coalesce(r.ac, false), 'heat', coalesce(r.heat, false), 'toilet', r.toilet,
    'cond', round(r.cond::numeric), 'busy', coalesce(r.busy, false), 'series', r.series, 'rail', rail, 'upkeep', r.upkeep,
    'ship', coalesce(r.isship, false), 'load', coalesce(r.load, 0), 'air', coalesce(r.isair, false), 'rwy', r.rwy)
    || jsonb_strip_nulls(jsonb_build_object('g', nullif(r.xg, 0), 'a', nullif(r.xa, 0), 'b', nullif(r.xb, 0), 'rooms', nullif(r.xrm, 0),
         'din', nullif(r.xdin, false), 'lng', nullif(r.xlng, false), 'obs', nullif(r.xobs, false), 'bag', nullif(r.xbag, 0), 'pow', nullif(r.xpow, false),
         'nl', nullif(r.xnl, 0), 'np', nullif(r.xnp, 0), 'wkm', r.xwkm, 'ckm', r.xckm, 'ps', r.xps, 'gm', r.xgm));   -- gm：軌間のしるし（DB の更新99）
end $$;
create or replace function public.mp_sub_build(p_seg bigint, p_x real, p_y real, p_sz int, p_name text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; q record; p record; sp jsonb; sz smallint := least(2, greatest(0, coalesce(p_sz, 1)))::smallint; nm text; rr real; nid bigint;
        newf bigint[]; rid bigint; nr int := 0; cst bigint; x record;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_seg;
  if not found or sg.kind <> 'rail' then raise exception '線路が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  if not sg.elec then raise exception '電化した線路にだけ つくれます'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y);
  if q.dist > 1 then raise exception '線路の上をえらんでください'; end if;
  select * into p from _mp_at(sg.pts, q.s);
  if exists (select 1 from mp_subs v where (v.x - p.x * 100)::float8 ^ 2 + (v.y - p.y * 100)::float8 ^ 2 < 40000) then raise exception 'すぐ近く（100m 以内）に変電所があります'; end if;
  sp := _mp_sub_spec(sg.ps, sz); rr := _mp_sub_r(sg.ps);
  cst := case when sg.gov then 0 else (sp ->> 'cost')::bigint end;
  nm := left(coalesce(nullif(btrim(p_name), ''), _mp_sub_name(round(p.x * 100)::int, round(p.y * 100)::int)), 30);
  -- 電気が新しく来る線（いまは来ていない、同じ持ち主・方式の電化した線で、とどくところ）
  newf := array(select x2.id from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = sg.ps and x2.own_u is not distinct from sg.own_u and x2.own_c is not distinct from sg.own_c
                  and x2.gov = sg.gov and (x2.bb <-> point(p.x, p.y)) <= rr * _mp_cat_reach(x2.cat) and _mp_feed(x2.id) is null);
  if p_dry then
    return jsonb_build_object('cost', cst, 'cap', sp -> 'cap', 'upk', sp -> 'upk', 'ps', sg.ps, 'name', nm, 'newfed', coalesce(array_length(newf, 1), 0), 'km', round((rr * 50 / 1000)::numeric));
  end if;
  perform _mp_lock(sg.own_u, sg.own_c);
  if cst > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, cst, 'rail', format('変電所「%s」の工事（%s）', nm, case sz when 0 then '小' when 1 then '中' else '大' end)); end if;
  insert into mp_subs(seg, x, y, own_u, own_c, gov, ps, sz, cap, upk, name, cost)
    values (sg.id, round(p.x * 100), round(p.y * 100), sg.own_u, sg.own_c, sg.gov, sg.ps, sz, (sp ->> 'cap')::int, (sp ->> 'upk')::int, nm, cst) returning id into nid;
  -- 地図：変電所のまわりと、電気をうけとる線（エアセクションが変わる）
  perform _mp_chg('seg', sg.id, 'set', box(point(p.x - 3, p.y - 3), point(p.x + 3, p.y + 3)));
  for x in select x2.id, x2.bb from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = sg.ps and x2.own_u is not distinct from sg.own_u and x2.own_c is not distinct from sg.own_c
             and x2.gov = sg.gov and (x2.bb <-> point(p.x, p.y)) <= rr * _mp_cat_reach(x2.cat) loop
    perform _mp_chg('seg', x.id, 'set', x.bb);
  end loop;
  for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
              where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = any(newf) loop
    perform _mp_resched(rid); nr := nr + 1;
  end loop;
  return jsonb_build_object('id', nid, 'cost', cst, 'name', nm, 'routes', nr);
end $$;
create or replace function public.mp_sub_del(p_id bigint, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); v mp_subs; me_cs int[]; lost bigint[]; rid bigint; nr int := 0; rts bigint[]; x record;
begin
  perform _mp_ok(u);
  select * into v from mp_subs where id = p_id;
  if not found then raise exception '変電所が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(v.own_u = u or v.own_c = any(me_cs) or (v.gov and _is_admin(u)), false) then raise exception 'あなたの変電所ではありません'; end if;
  -- この変電所だけが電気をとどけている線（こわすと電気が来なくなる）
  lost := array(select x2.id from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = v.ps and x2.own_u is not distinct from v.own_u and x2.own_c is not distinct from v.own_c
                  and x2.gov = v.gov and _mp_feed(x2.id) = p_id
                  and not exists (select 1 from mp_subs w where w.id <> p_id and w.ps = x2.ps and w.own_u is not distinct from x2.own_u and w.own_c is not distinct from x2.own_c and w.gov = x2.gov
                                    and (x2.bb <-> point(w.x / 100.0, w.y / 100.0)) <= _mp_sub_r(x2.ps) * _mp_cat_reach(x2.cat)));
  rts := array(select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = any(lost));
  if p_dry then return jsonb_build_object('lost', coalesce(array_length(lost, 1), 0), 'routes', coalesce(array_length(rts, 1), 0)); end if;
  perform _mp_lock(v.own_u, v.own_c);
  for x in select x2.id, x2.bb from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = v.ps and x2.own_u is not distinct from v.own_u and x2.own_c is not distinct from v.own_c
             and x2.gov = v.gov and _mp_feed(x2.id) = p_id loop
    perform _mp_chg('seg', x.id, 'set', x.bb);
  end loop;
  delete from mp_subs where id = p_id;
  perform _mp_chg('seg', coalesce(v.seg, 0), 'set', box(point(v.x / 100.0 - 3, v.y / 100.0 - 3), point(v.x / 100.0 + 3, v.y / 100.0 + 3)));
  foreach rid in array coalesce(rts, '{}'::bigint[]) loop perform _mp_resched(rid); nr := nr + 1; end loop;
  return jsonb_build_object('id', p_id, 'lost', coalesce(array_length(lost, 1), 0), 'routes', nr);
end $$;
create or replace function public.mp_area(p_x0 int, p_y0 int, p_x1 int, p_y1 int, p_lod int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b box; r jsonb; me_cs int[];
begin
  perform _mp_ok(u);
  if p_x1 - p_x0 > 6000 or p_y1 - p_y0 > 6000 then raise exception '範囲が広すぎます'; end if;
  if p_lod = 0 and (p_x1 - p_x0) * (p_y1 - p_y0) > 360000 then p_lod := 1; end if;
  b := box(point(p_x0, p_y0), point(p_x1, p_y1));
  me_cs := array(select id from companies where owner = u);
  select jsonb_build_object(
    'segs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(_mp_thin(s.pts, case p_lod when 0 then 1 when 1 then 3 when 2 then 8 else 16 end)), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
                  'o', case when s.gov then 'gov' when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.gov and _is_admin(u)), 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1),
                  'ctl', case when s.own_u = u or s.own_c = any(me_cs) or (s.gov and _is_admin(u)) then to_jsonb(s.ctl) end)
                  || case when s.snowp > 0 then jsonb_build_object('sp', s.snowp) else '{}'::jsonb end
                  || case when s.prof is not null and p_lod <= 1 then jsonb_build_object('pf', to_jsonb(s.prof), 'st', s.st) else '{}'::jsonb end   -- 高さ（t108）
                  || case when s.rack then jsonb_build_object('rk', 1) else '{}'::jsonb end || case when s.hm is not null then jsonb_build_object('hm', s.hm) else '{}'::jsonb end
                  || case when s.hopt is not null then jsonb_build_object('ho', s.hopt) else '{}'::jsonb end   -- 高さの数値（DB の更新84）
                  || case when s.sig > 0 then jsonb_build_object('sg', s.sig) else '{}'::jsonb end   -- 信号の段（DB の更新85）
                  || case when s.quad then jsonb_build_object('q', 1) else '{}'::jsonb end   -- 複々線（DB の更新86）
                  || case when s.elec and s.ps > 0 then jsonb_build_object('ps', s.ps) else '{}'::jsonb end   -- 電化方式（DB の更新87）
                  || case when s.kind = 'rail' and (s.gauge <> 1067 or s.g2 is not null or s.slp <> 0 or (s.elec and s.cat <> 0) or s.nw <> 0)
                          then jsonb_strip_nulls(jsonb_build_object('ga', nullif(s.gauge, 1067), 'g2', s.g2, 'sl', nullif(s.slp, 0), 'ct', case when s.elec then nullif(s.cat, 0) end, 'nw', nullif(s.nw, 0)))
                          else '{}'::jsonb end   -- 線路の規格（DB の更新99）
                  || case when s.kind = 'rail' and s.elec then jsonb_strip_nulls(jsonb_build_object('fd', _mp_feed(s.id))) else '{}'::jsonb end), '[]'::jsonb)   -- 電気をとどける変電所（DB の更新89）
               from mp_segs s where s.bb && b and (p_lod = 0 or s.kind = 'rail' or s.cls in ('exp', 'nat', 'pref') or (p_lod = 1 and s.art))
                 and (p_lod < 2 or s.kind = 'rail' or s.cls in ('exp', 'nat'))
                 and (p_lod < 3 or s.kind = 'rail' or s.cls = 'exp')),   -- lod 3（とても遠く。t108）：線路と高速だけ
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'k', n.kind, 'x', n.x, 'y', n.y, 'n', n.name, 'nk', n.nk)), '[]'::jsonb)
               from mp_nodes n where p_lod < 3 and (n.name is not null or p_lod = 0) and n.x between p_x0 * 100 and p_x1 * 100 and n.y between p_y0 * 100 and p_y1 * 100
                 and (n.name is not null or exists (select 1 from mp_segs s where s.n0 = n.id and not s.gov) or exists (select 1 from mp_segs s where s.n1 = n.id and not s.gov))),
    'stas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'seg', s.seg, 'at', s.at, 'x', s.x, 'y', s.y, 'a', s.ang, 'pl', s.plat, 'tr', s.tracks, 'n', s.name, 'ln', s.lend, 'b', s.bld,
                  'tk', case when s.kind = 'rail' then _mp_sta_trk(s) end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))
                  || case when s.melt then jsonb_build_object('ml', 1) else '{}'::jsonb end
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld,
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false)) || case when d.plows > 0 then jsonb_build_object('pw', d.plows) else '{}'::jsonb end), '[]'::jsonb)
               from mp_depots d where d.x between (p_x0 - 13) * 100 and (p_x1 + 13) * 100 and d.y between (p_y0 - 13) * 100 and (p_y1 + 13) * 100 and p_lod < 2),
    -- 航路（t54o）：海の上の折れ線（区間ごと。1/100 マス）
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'k', r.kind, 'c', r.color, 'n', r.name, 'ok', r.ok, 'mine', coalesce(r.own_u = u or r.own_c = any(me_cs), false),
                  'w', (select coalesce(jsonb_agg(l -> 'w'), '[]'::jsonb) from jsonb_array_elements(r.legs) l))), '[]'::jsonb)
               from mp_routes r where r.kind in ('ship', 'air') and r.bb && b),   -- t54p：空の路線も
    -- 滑走路（t57）：両はし [x0, y0, x1, y1]（1/100 マス）・はば（マス）・番号・長さ・空港
    'rwys', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'p', jsonb_build_array(r.x0, r.y0, r.x1, r.y1), 'w', r.w, 'n', r.name, 'len', r.len, 'st', r.st,
                  'sn', (select s.name from mp_stations s where s.id = r.st))), '[]'::jsonb)
               from mp_rwys r where box(point(least(r.x0, r.x1) / 100.0, least(r.y0, r.y1) / 100.0), point(greatest(r.x0, r.x1) / 100.0, greatest(r.y0, r.y1) / 100.0)) && b),
    -- 筆：[id, 行ごとの区画のならび [y, x0, x1, …], 1 他人・2 自分・3 国, 売り出し, 建物, 地番, 持ち主のキー]
    'parcels', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(pa.id,
                  (select jsonb_agg(v order by rn.y, rn.x0, u.o) from (
                      select y, min(x) x0, max(x) x1 from (select x, y, x - row_number() over (partition by y order by x) g from mp_pcells where parcel = pa.id) z group by y, g) rn,
                     lateral unnest(array[rn.y, rn.x0, rn.x1]) with ordinality u(v, o)),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end, pa.sale, pa.bld, _mp_ban(pa.ban, pa.eda),
                  case when pa.gov then 'gov' when pa.own_u is not null then 'u:' || pa.own_u else 'c:' || pa.own_c end)), '[]'::jsonb)
               from mp_parcels pa where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    -- 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている部屋の割合（%）, 1 他人・2 自分・3 国]
    'blds', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(b.id, b.parcel, b.kind, b.floors, to_jsonb(b.cells), b.name,
                  (select round(100.0 * count(*) filter (where x.t_kind is not null or x.mode = 'self') / greatest(count(*), 1)) from mp_units x where x.bld = b.id),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end)), '[]'::jsonb)
               from mp_blds b join mp_parcels pa on pa.id = b.parcel where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    'places', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'k', p.k, 'n', p.name, 'x', p.x, 'y', p.y, 't', p.type, 'pop', p.pop, 'par', p.parent)
                  || case when p.k = 'island' then jsonb_build_object('sz', (p.extra ->> 'n')::int) else '{}'::jsonb end), '[]'::jsonb)   -- 島（t54k2）：sz＝陸のマスの数
               from mp_places p where p.pt <@ b and p.k in ('pref', 'muni', 'ward', 'river', 'spot', 'island') and (p_lod < 2 or p.k in ('pref', 'muni')) and (p_lod < 3 or p.k = 'pref')),
    -- 町字の名前：[id, 種類, 名前, x, y]（町・大字は lod 1 から、丁目・字は lod 0）
    'chos', (select coalesce(jsonb_agg(jsonb_build_array(m.id, m.kind, m.name, m.x, m.y)), '[]'::jsonb)
               from mp_cho m where m.pt <@ b and m.gone is null and (p_lod = 0 or (p_lod = 1 and m.kind in ('cho', 'oaza')))),
    'names', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
               select distinct 'u:' || pa.own_u k, (select nickname from profiles where id = pa.own_u) v from mp_parcels pa where p_lod = 0 and pa.own_u is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'c:' || pa.own_c, (select name from companies where id = pa.own_c) from mp_parcels pa where p_lod = 0 and pa.own_c is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'u:' || s.own_u, (select nickname from profiles where id = s.own_u) from mp_segs s where s.own_u is not null and s.bb && b
               union select distinct 'c:' || s.own_c, (select name from companies where id = s.own_c) from mp_segs s where s.own_c is not null and s.bb && b) z where v is not null),
    -- アトラクション（DB の更新91）：[id, 建物, 種類, x, y（マス）]
    'attrs', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(a.id, a.bld, a.kind, round(a.x::numeric, 2), round(a.y::numeric, 2))), '[]'::jsonb)
               from mp_attrs a where a.x between p_x0 - 2 and p_x1 + 2 and a.y between p_y0 - 2 and p_y1 + 2) end,
    -- 変電所（DB の更新89）：[id, 場所, 名前, 方式, 大きさ, 容量, 負荷, 止まっている, 自分の, 持ち主のキー]
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', ss.id, 'x', ss.x, 'y', ss.y, 'n', ss.name, 'ps', ss.ps, 'sz', ss.sz, 'cap', ss.cap, 'ld', ss.load,
                  'tr', coalesce(ss.trip > now(), false), 'mine', coalesce(ss.own_u = u or ss.own_c = any(me_cs), false) or (ss.gov and _is_admin(u)),
                  'o', case when ss.gov then 'gov' when ss.own_u is not null then 'u:' || ss.own_u else 'c:' || ss.own_c end)), '[]'::jsonb)
               from mp_subs ss where p_lod < 2 and ss.x between (p_x0 - 3) * 100 and (p_x1 + 3) * 100 and ss.y between (p_y0 - 3) * 100 and (p_y1 + 3) * 100),
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1, 'park2', 1, 'spec', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）・park2：テーマパークとアトラクション（DB の更新91）
  return r;
end $$;
create or replace function public.mp_seg_speed(p_id bigint, p_x real, p_y real) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); sg mp_segs; runs jsonb; here int; acc real := 0; e jsonb; at_m real; pr record;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id;
  if not found then raise exception '線が見つかりません'; end if;
  if p_x is not null and p_y is not null then select * into pr from _mp_proj(sg.pts, p_x, p_y); at_m := pr.s * 50; end if;
  if sg.kind <> 'rail' then
    return jsonb_build_object('here', sg.vlim, 'min', sg.vlim, 'max', sg.vlim, 'len', round(sg.len * 50), 'at', round(at_m), 'runs', jsonb_build_array(jsonb_build_array(round(sg.len * 50), sg.vlim)));
  end if;
  runs := _mp_vruns(sg.pts, 0, sg.len);
  runs := _mp_runs_merge(_mp_runs_cap(runs, array[0, 1e9, _mp_seg_v(sg.gauge, sg.g2, sg.slp, sg.rack)]::real[]));   -- 軌間・枕木・アプト式の上限（DB の更新99）
  for e in select v from jsonb_array_elements(runs) v loop
    acc := acc + (e ->> 0)::real;
    if at_m is not null and here is null and acc >= at_m - 0.5 then here := (e ->> 1)::int; end if;
  end loop;
  return jsonb_build_object('here', coalesce(here, (runs -> -1 ->> 1)::int), 'at', round(at_m), 'len', round(sg.len * 50), 'runs', runs,
    'min', (select min((v ->> 1)::int) from jsonb_array_elements(runs) v), 'max', (select max((v ->> 1)::int) from jsonb_array_elements(runs) v),
    'rmin', round(least(_mp_minr(sg.pts), 99999) * 50), 've', case when sg.elec then _mp_cat_v(sg.cat) end);   -- ve：電車の上限（架線）
end $$;
create or replace function public._mp_value(px int, py int) returns bigint
language plpgsql stable set search_path = public as $$
declare c record; b numeric; d real; zm numeric; v numeric; rd boolean; st real; nz real;
begin
  select * into c from _mp_cell(px, py);
  if c.t is null or c.t in ('S', 'D', 'R', 'L') then return null; end if;
  if c.z = 'j' then return null; end if;                           -- 公園は国のもの
  b := _mp_rate('land_' || c.t);
  d := _mp_dens(px + 0.5, py + 0.5);
  zm := case c.z when 'd' then 1.6 when 'c' then 1.3 when 'b' then 1.0 when 'a' then 0.9 when 'e' then 0.9 when 'f' then 0.8 when 'g' then 1.0 when 'h' then 0.6 when 'i' then 0.5 when 'k' then 1.0 else 1.0 end;
  rd := exists (select 1 from mp_occ o where o.what = 'road' and o.x between px - 1 and px + 1 and o.y between py - 1 and py + 1);
  select max(1 - sqrt(((s.x / 100.0 - px - 0.5) ^ 2 + (s.y / 100.0 - py - 0.5) ^ 2)) / _mp_rate('sta_r')) into st
    from mp_stations s where s.kind = 'rail' and s.x between (px - 16) * 100 and (px + 17) * 100 and s.y between (py - 16) * 100 and (py + 17) * 100;
  v := b * (1 + _mp_rate('dens_k') * d) * zm * case when rd then _mp_rate('road_mul') else 1 end * (1 + _mp_rate('sta_mul') * greatest(coalesce(st, 0), 0));
  -- 線路の騒音（DB の更新99）：住居 15%・用途地域なし 10%・商業と準工業 8% まで下がる（騒音 2 で いちばん）
  nz := (select n.lv from mp_noise n where n.x = px and n.y = py);
  if nz is not null then v := v * (1 - case when c.z in ('a', 'b', 'k') then 0.15 when c.z = '-' then 0.1 when c.z in ('c', 'd', 'e') then 0.08 else 0 end * least(1, nz / 2)); end if;
  return greatest(100, round(v / 100) * 100)::bigint;
end $$;
create or replace function public._mp_tick_day() returns void
language plpgsql set search_path = public as $$
declare o record; amt bigint; c record; ns int; rr bigint; nzc real;
begin
  -- 過ぎた日の臨時列車を消す（その系統の時刻・ぶつかりを見なおす）
  for rr in select distinct route from mp_trains where day is not null and day < _mp_today() loop
    delete from mp_trains where route = rr and day is not null and day < _mp_today();
    perform _mp_resched(rr);
  end loop;
  -- 地価の見なおし（筆：区画ごとの評価額・地価の合計）。t59：AIの会社・国営の会社の筆は7日に1回
  perform _mp_noise_day();   -- 線路の騒音（DB の更新99）：地価とまちの成長に
  perform _mp_parcel_vals_day();
  -- 建物の入りやすさ・相場（地価が変わったので）
  perform _mp_bld_tick_day();
  -- 固定資産税（筆ごと・評価額で。国の筆はなし）
  for o in select own_u, own_c, sum(val) v, count(*) n from mp_parcels where not gov group by own_u, own_c loop
    if o.own_c is not null and _mp_ai_quiet(o.own_c) then continue; end if;   -- t59：AIの会社・国営の会社の建物（町の景色）は税なし
    amt := round(o.v * _mp_rate('prop_tax'));
    if amt > 0 then perform _mp_soft_pay(o.own_u, o.own_c, false, amt, 'tax', format('固定資産税（%s筆）', o.n)); end if;
  end loop;
  -- まちの成長：駅（列車の走っている系統の駅）の近くのまちは早く育つ
  for c in select * from mp_centers loop
    select count(*) into ns from mp_stations s where s.kind = 'rail' and (s.x / 100.0 - c.x) ^ 2 + (s.y / 100.0 - c.y) ^ 2 < (c.sg * 1.5) ^ 2
       and exists (select 1 from mp_routes r where r.ok and s.id = any(r.stops) and exists (select 1 from mp_trains t where t.route = r.id and t.form is not null));
    -- 線路の騒音（DB の更新99）：まんなか（sg の中）の騒音の平均で、成長が 4割まで おそくなる
    nzc := coalesce((select sum(n.lv) from mp_noise n where n.x between floor(c.x - c.sg)::int and ceil(c.x + c.sg)::int and n.y between floor(c.y - c.sg)::int and ceil(c.y + c.sg)::int
                      and (n.x + 0.5 - c.x) ^ 2 + (n.y + 0.5 - c.y) ^ 2 < c.sg ^ 2), 0) / greatest(1, pi() * c.sg ^ 2);
    update mp_centers set dp = dp * (1 + (_mp_rate('grow') + case when ns > 0 then _mp_rate('grow_sta') * least(3, ns) else 0 end) * (1 - 0.4 * least(1, 2 * nzc))) where id = c.id;
  end loop;
  update mp_routes set catch = null where catch is not null;   -- 利用できる人を見なおす（t59s：WHERE をつける。Supabase の safeupdate）
  delete from mp_hours where hour < now() - interval '35 days';
  delete from mp_changes where at < now() - interval '3 days';
  delete from mp_ledger where created_at < now() - interval '60 days';
  delete from mp_sclog where at < now() - interval '3 days';
end $$;
create or replace function public.mp_spot(p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); tx int := _mp_t5(p_x); ty int := _mp_t5(p_y); c record; pa mp_parcels; me_cs int[]; d real; r jsonb; why text; pub boolean; cv bigint; cv0 bigint; rw text;
begin
  perform _mp_ok(u);
  me_cs := array(select id from companies where owner = u);
  select * into c from _mp_cell(tx, ty);
  if c.t is null then return jsonb_build_object('x', p_x, 'y', p_y, 'none', true); end if;
  select p.* into pa from mp_pcells pc join mp_parcels p on p.id = pc.parcel where pc.x = p_x and pc.y = p_y;
  pub := exists (select 1 from _mp_pub_cells(p_x, p_y, p_x, p_y));
  -- 滑走路（t57）
  rw := (select r.name from mp_occ o join mp_rwys r on r.id = o.ref where o.what = 'rwy' and o.x = tx and o.y = ty
           and exists (select 1 from _mp_rwy_cells(r.x0, r.y0, r.x1, r.y1, r.w) q where q.x = p_x and q.y = p_y) limit 1);
  d := _mp_dens(tx + 0.5, ty + 0.5);
  cv := _mp_mcval(tx, ty); cv0 := _mp_cval(tx, ty);   -- 地価（売り買い）・評価額（税・家賃・使用料のもと）
  why := case when pa.id is not null then case when pa.sale is null then '持ち主がいます（売りに出ていません）' end
              when c.t in ('S', 'D', 'R', 'L') then '水の上は買えません' when c.z = 'j' then '公園は国の土地です'
              when rw is not null then '空港の滑走路です（国の土地）'
              when pub then '公道（国・県・市の道路）の土地です' when cv is null then '買えない土地です' end;
  select jsonb_build_object('x', p_x, 'y', p_y, 'tx', tx, 'ty', ty, 'addr', _mp_addr(tx, ty, p_x, p_y),
    'ter', case c.t when 'D' then '海（深い）' when 'S' then '海' when 'R' then '川' when 'L' then '湖' when 'B' then '砂浜' when 'P' then '平地' when 'F' then '林'
                    when 'H' then '丘' when 'M' then '山' when 'K' then '高い山' end, 't', c.t, 'elev', greatest(c.e, 0),
    'zone', c.z, 'zname', _mp_zname(c.z),
    'chimoku', case when rw is not null then '空港用地（滑走路）' when pub then '公衆用道路' when pa.id is null and exists (select 1 from mp_leases e join mp_segs s on s.id = e.ref where e.x = p_x and e.y = p_y and e.ref_kind = 'seg' and s.kind = 'rail') then '鉄道用地'
                    else _mp_chimoku(c.t, c.z, pa.bld, d) end,
    'dens', round(d * 400), 'nz', (select round(n.lv::numeric, 2) from mp_noise n where n.x = tx and n.y = ty), 'cval', cv,   -- nz：線路の騒音（DB の更新99）
     'cval0', case when cv0 is distinct from cv then cv0 end, 'pub', pub, 'buy', why is null, 'why', why,
    'parcel', case when pa.id is null then null else jsonb_build_object('id', pa.id, 'ban', _mp_ban(pa.ban, pa.eda), 'n', pa.n, 'val', coalesce(pa.mval, pa.val),
                 'val0', case when coalesce(pa.mval, pa.val) is distinct from pa.val then pa.val end, 'sale', pa.sale, 'gov', pa.gov,
                 'owner', _mp_pname(pa.own_u, pa.own_c, pa.gov), 'mine', coalesce(pa.own_u = u or pa.own_c = any(me_cs), false),
                 'bld', pa.bld, 'price', pa.price,
                 -- 貸出料（1区画・1日）・標準の使用料・申請（持ち主には返事まちの数、ほかの人には自分の名義の申請）
                 'rent', pa.rent, 'std', _mp_land_std(pa.id),
                 'nreq', case when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then (select count(*) from mp_landreq q where q.parcel = pa.id and q.st = 'wait') end,
                 'reqs', case when not coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then
                           (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'who', _mp_pname(q.req_u, q.req_c, false), 'as', case when q.req_u is not null then 'me' else (select cid from companies where id = q.req_c) end,
                                     'st', q.st, 'fee', q.fee, 'reply', q.reply) order by q.id), '[]'::jsonb)
                              from mp_landreq q where q.parcel = pa.id and (q.req_u = u or q.req_c = any(me_cs))) end,
                 'b', (select jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'floors', b.floors, 'cost', b.cost,
                          'n', (select count(*) from mp_units x where x.bld = b.id), 'occ', (select count(*) from mp_units x where x.bld = b.id and (x.t_kind is not null or x.mode = 'self')),
                          'rent', (select coalesce(round(sum(x.rent)), 0) from mp_units x where x.bld = b.id and x.t_kind is not null),
                          'oncell', exists (select 1 from mp_bcells bc where bc.bld = b.id and bc.x = p_x and bc.y = p_y))
                         from mp_blds b where b.parcel = pa.id),
                 'bb', jsonb_build_array((pa.bb[1])[0], (pa.bb[1])[1], (pa.bb[0])[0], (pa.bb[0])[1])) end,
    'on', (select coalesce(jsonb_agg(jsonb_build_object('what', o.what, 'ref', o.ref,
              'name', case o.what when 'road' then (select case s.cls when 'exp' then '高速道路' when 'nat' then '国道' when 'pref' then _mp_pref_road(_mp_pref_type(tx, ty)) when 'city' then '市道' else '私道' end
                                                          || case when s.name <> '' then '（' || s.name || '）' else '' end from mp_segs s where s.id = o.ref)
                                  when 'rail' then (select '線路' || case when s.name <> '' then '（' || s.name || '）' else '' end || '・' || _mp_pname(s.own_u, s.own_c, s.gov) from mp_segs s where s.id = o.ref)
                                  when 'sta' then (select case s.kind when 'rail' then '駅：' else 'バス停：' end || s.name from mp_stations s where s.id = o.ref)
                                  when 'stop' then (select 'バス停：' || s.name from mp_stations s where s.id = o.ref)
                                  when 'dep' then (select '車庫：' || d2.name from mp_depots d2 where d2.id = o.ref)
                                  when 'rwy' then (select '滑走路 ' || r2.name || '（' || to_char(r2.len, 'FM999,999') || 'm・' || coalesce((select s3.name from mp_stations s3 where s3.id = r2.st), '') || '）'
                                                     from mp_rwys r2 where r2.id = o.ref) else o.what end)), '[]'::jsonb)
           from mp_occ o where o.x = tx and o.y = ty and o.what <> 'bld'),
    'leases', (select coalesce(jsonb_agg(jsonb_build_object('who', _mp_pname(e.pay_u, e.pay_c, e.pay_gov), 'fee', round(e.fee, 1), 'what', e.ref_kind)), '[]'::jsonb)
           from mp_leases e where e.x = p_x and e.y = p_y)) into r;
  return r;
end $$;
-- 線路の規格を変える工事費（DB の更新99。1マスごと・国の線は よぶ前に 0 にする）
--   改軌：線路 × 0.5 × 新しい軌間の倍率 × 単線・複線の倍率（三線軌条なら 1.4倍）・三線軌条を足す：線路 × 0.35 × 単線・複線の倍率
--   枕木の取りかえ：線路 × 新しい枕木（木 0.2・RC 0.25・PC 0.3・スラブ 0.8）× 単線・複線の倍率・架線の取りかえ：電化 × 新しい架線の倍率 × 0.8
--   防音壁：（新しい − いま）× トンネルの外のマス。へらす（三線軌条をやめる・防音壁をへらす）のは無料
create or replace function public._mp_spec_cost(s mp_segs, ng int, ng2 int, nsl int, nct int, nnw int) returns numeric
language plpgsql stable set search_path = public as $$
declare cd text[] := _mp_st_tiles(s.pts, s.st); nt int; tm numeric := _mp_trmul(s.dbl, s.quad); r numeric := _mp_rate('rail'); c numeric := 0;
begin
  nt := coalesce(array_length(cd, 1), 0);
  if ng <> s.gauge then c := c + r * 0.5 * _mp_gauge_mul(ng) * tm * nt * case when ng2 is not null then 1.4 else 1 end;
  elsif ng2 is not null and ng2 is distinct from s.g2 then c := c + r * 0.35 * tm * nt; end if;
  if nsl <> s.slp then c := c + r * _mp_slp_rep(nsl) * tm * nt; end if;
  if s.elec and nct <> s.cat then c := c + _mp_rate('elec') * _mp_cat_cmul(nct, cd) * 0.8 * nt; end if;
  if nnw > s.nw then c := c + (_mp_nw_cost(nnw) - _mp_nw_cost(s.nw)) * (select count(*) from unnest(cd) x where x <> 'T'); end if;
  return round(c);
end $$;
-- 2本の線の設定のちがい（1本にするとき。DB の更新99）
create or replace function public._mp_seg_difs(k mp_segs, o mp_segs) returns text[]
language sql immutable as $$
  select array_remove(array[
    case when k.dbl <> o.dbl or k.quad <> o.quad then '単線・複線' end,
    case when k.elec <> o.elec then '電化' end,
    case when k.elec and o.elec and k.ps <> o.ps then '電化方式' end,
    case when k.sig <> o.sig then '信号' end,
    case when k.gauge <> o.gauge or k.g2 is distinct from o.g2 then '軌間' end,
    case when k.slp <> o.slp then '枕木' end,
    case when k.elec and o.elec and k.cat <> o.cat then '架線' end,
    case when k.nw <> o.nw then '防音壁' end,
    case when k.snowp <> o.snowp then '雪よけ' end,
    case when k.name <> '' and o.name <> '' and k.name <> o.name then '名前' end], null)
$$;
-- 線路の規格を変える（DB の更新99）：p_spec {gauge, g2（0 は 三線軌条をやめる）, slp, cat, nw}（ないものは いまのまま）。p_chain：分かれ道までの、つながった線ぜんぶ
--   架線は電化した線だけ。第三軌条にすると 直流750V（第三軌条の電車だけ走れる）、第三軌条から架線にすると 直流1500V
--   p_dry：見つもり（工事費・上限の速さ・1日の維持費・走れなくなる列車の数）
create or replace function public.mp_seg_spec(p_id bigint, p_spec jsonb, p_chain boolean, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ids bigint[]; s mp_segs; amt numeric := 0; a numeric; lm real := 0; nseg int := 0;
        ng int; ng2 int; nsl int; nct int; nnw int; nps int; cmp boolean := false; rts bigint[]; rid bigint; nr int := 0;
        up0 numeric := 0; up1 numeric := 0; tm numeric; vmin int; vemin int; nbad int := 0; newm jsonb := '{}'::jsonb; wh text;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id;
  if not found or sg.kind <> 'rail' then raise exception '線路が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then raise exception '規格をえらんでください'; end if;
  if p_spec ? 'gauge' and not coalesce((p_spec ->> 'gauge')::int in (762, 1067, 1372, 1435), false) then raise exception '軌間は 762・1067・1372・1435mm から えらんでください'; end if;
  if coalesce((p_spec ->> 'g2')::int, 0) <> 0 and not ((p_spec ->> 'g2')::int in (762, 1067, 1372, 1435)) then raise exception '三線軌条の軌間がちがいます'; end if;
  if p_spec ? 'slp' and not coalesce((p_spec ->> 'slp')::int between 0 and 3, false) then raise exception '枕木の種類がちがいます'; end if;
  if p_spec ? 'cat' and not coalesce((p_spec ->> 'cat')::int between 0 and 6, false) then raise exception '架線の種類がちがいます'; end if;
  if p_spec ? 'nw' and not coalesce((p_spec ->> 'nw')::int between 0 and 2, false) then raise exception '防音壁の種類がちがいます'; end if;
  ids := case when coalesce(p_chain, false) then array(select c.id from _mp_chain(p_id) c order by c.ord) else array[p_id] end;
  if not p_dry then perform _mp_lock(sg.own_u, sg.own_c); end if;
  for s in select x.* from mp_segs x where x.id = any(ids) order by x.id loop
    ng := coalesce((p_spec ->> 'gauge')::int, s.gauge);
    ng2 := case when p_spec ? 'g2' then nullif(coalesce((p_spec ->> 'g2')::int, 0), 0) else s.g2 end;
    if ng2 = ng then ng2 := null; end if;
    nsl := coalesce((p_spec ->> 'slp')::int, s.slp);
    nct := case when s.elec then coalesce((p_spec ->> 'cat')::int, s.cat) else s.cat end;
    nnw := coalesce((p_spec ->> 'nw')::int, s.nw);
    nps := case when not s.elec then s.ps when nct = 6 then 3 when s.ps = 3 then 0 else s.ps end;   -- 第三軌条は 直流750V
    continue when ng = s.gauge and ng2 is not distinct from s.g2 and nsl = s.slp and nct = s.cat and nnw = s.nw;
    nseg := nseg + 1; lm := lm + s.len;
    if ng <> s.gauge or ng2 is distinct from s.g2 or nps <> s.ps then cmp := true; end if;
    a := case when s.gov then 0 else _mp_spec_cost(s, ng, ng2, nsl, nct, nnw) end;
    amt := amt + a;
    tm := s.len * _mp_rate('up_rail') * case when s.quad then 2.6 when s.dbl then 1.6 else 1 end;
    up0 := up0 + tm * _mp_trk_upk(s.gauge, s.g2, s.slp, s.elec, s.cat) + s.len * _mp_nw_upk(s.nw);
    up1 := up1 + tm * _mp_trk_upk(ng, ng2, nsl, s.elec, nct) + s.len * _mp_nw_upk(nnw);
    vmin := least(coalesce(vmin, 999), _mp_seg_v(ng, ng2, nsl, s.rack));
    if s.elec then vemin := least(coalesce(vemin, 999), _mp_cat_v(nct)); end if;
    newm := newm || jsonb_build_object(s.id::text, _mp_gbit(ng) | coalesce(_mp_gbit(ng2), 0));
    if not p_dry then
      update mp_segs set gauge = ng, g2 = ng2, slp = nsl, cat = nct, nw = nnw, ps = nps, cost = cost + a::bigint where id = s.id;
      perform _mp_chg('seg', s.id, 'set', s.bb);
    end if;
  end loop;
  if nseg = 0 then raise exception 'いまと同じ規格です'; end if;
  rts := array(select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and (g ->> 0)::bigint = any(ids));
  if p_dry then
    -- 走れなくなる列車（この線を通る系統の、毎日の列車）：新しい軌間に合わない編成
    nbad := (select count(*) from mp_trains t join mp_routes ro on ro.id = t.route
              cross join lateral (select bit_or(_mp_gbit(ty.gauge)) gm from mp_cars c join mp_types ty on ty.code = c.type where c.form = t.form and ty.role not in ('Bus', 'Truck', 'Ship', 'Air')) f
             where ro.id = any(coalesce(rts, '{}'::bigint[])) and t.form is not null and t.day is null and f.gm is not null
               and exists (select 1 from jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                            where newm ? (g ->> 0) and (f.gm & ~((newm ->> (g ->> 0))::int)) <> 0));
    return jsonb_build_object('cost', amt, 'segs', nseg, 'm', round((lm * 50)::numeric), 'routes', coalesce(array_length(rts, 1), 0),
      'v', vmin, 've', vemin, 'up0', round(up0), 'up1', round(up1), 'bad', nbad);
  end if;
  if amt > 0 then
    wh := concat_ws('・', case when p_spec ? 'gauge' and (p_spec ->> 'gauge')::int <> sg.gauge then format('改軌 %smm', p_spec ->> 'gauge') end,
                         case when coalesce((p_spec ->> 'g2')::int, 0) <> 0 then format('三線軌条 %smm', p_spec ->> 'g2') end,
                         case when p_spec ? 'slp' and (p_spec ->> 'slp')::int <> sg.slp then _mp_slp_name((p_spec ->> 'slp')::int) || '枕木' end,
                         case when p_spec ? 'cat' and (p_spec ->> 'cat')::int <> sg.cat and sg.elec then _mp_cat_name((p_spec ->> 'cat')::int) end,
                         case when coalesce((p_spec ->> 'nw')::int, 0) > sg.nw then case (p_spec ->> 'nw')::int when 2 then '高い防音壁' else '防音壁' end end);
    perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt::bigint, 'rail', format('線路の規格（%s・%sm）', coalesce(nullif(wh, ''), '変更'), round((lm * 50)::numeric)));
  end if;
  perform _mp_routes_fix(sg.own_u, sg.own_c, ids);   -- 上限の速さが変わった系統の時刻（道すじは同じ）
  if cmp then   -- 軌間・電化方式：走れるかを見なおす
    foreach rid in array coalesce(rts, '{}'::bigint[]) loop perform _mp_resched(rid); nr := nr + 1; end loop;
  end if;
  return jsonb_build_object('cost', amt, 'segs', nseg, 'routes', nr, 'v', vmin, 've', vemin);
end $$;
-- 線路を1本にする（DB の更新99）：つなぎ目（分かれ道のない点）で となりの線と結合する。p_keep の線の設定（単線・複線・電化・方式・信号・規格・雪よけ・名前・色）に、もう1本をそろえる
--   そろえる工事費は、それぞれの設定を変えるのと同じ（へらす分は無料）。アプト式とそうでない線は 1本にできない
--   p_b が null：1本にできる となりの線（はし・名前・長さ・設定のちがい）を返す。p_dry：見つもり（工事費・ちがい・つなげるか）
create or replace function public.mp_seg_merge(p_a bigint, p_b bigint, p_keep bigint, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a mp_segs; b mp_segs; k mp_segs; o mp_segs; o2 mp_segs; me_cs int[]; nd bigint; c1 jsonb; cost numeric := 0; need jsonb; jerr text; r jsonb;
        dopt boolean; dsig boolean; dspec boolean; dsnow boolean;
begin
  perform _mp_ok(u);
  select * into a from mp_segs where id = p_a;
  if not found or a.kind <> 'rail' then raise exception '線路が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(a.own_u = u or a.own_c = any(me_cs) or (a.gov and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  if p_b is null then
    return jsonb_build_object('cands', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'n', s.name, 'm', round((s.len * 50)::numeric), 'end', case when e.nd = a.n0 then 0 else 1 end,
               'rack', s.rack <> a.rack, 'dif', to_jsonb(_mp_seg_difs(a, s))) order by e.nd = a.n1, s.id)
      from (select unnest(array[a.n0, a.n1]) nd) e join mp_segs s on (s.n0 = e.nd or s.n1 = e.nd) and s.id <> a.id
     where e.nd is not null and s.kind = 'rail' and s.own_u is not distinct from a.own_u and s.own_c is not distinct from a.own_c and s.gov = a.gov
       and (select count(*) from mp_segs q where q.n0 = e.nd or q.n1 = e.nd) = 2), '[]'::jsonb));
  end if;
  select * into b from mp_segs where id = p_b;
  if not found or b.kind <> 'rail' or b.id = a.id then raise exception '線路が見つかりません'; end if;
  if not (b.own_u is not distinct from a.own_u and b.own_c is not distinct from a.own_c and b.gov = a.gov) then raise exception 'ほかの持ち主の線路とは、1本にできません'; end if;
  nd := case when a.n1 is not null and a.n1 in (b.n0, b.n1) then a.n1 when a.n0 is not null and a.n0 in (b.n0, b.n1) then a.n0 end;
  if nd is null or (select count(*) from mp_segs q where q.n0 = nd or q.n1 = nd) <> 2 then raise exception 'となりあっていない線か、分かれ道のある点です（1本にできません）'; end if;
  if p_keep is not null and p_keep not in (a.id, b.id) then raise exception 'そろえる線は、えらんだ2本のどちらかです'; end if;
  if p_keep = b.id then k := b; o := a; else k := a; o := b; end if;
  if k.rack <> o.rack then raise exception 'アプト式の線と そうでない線は、1本にできません（高さの設定で そろえてください）'; end if;
  dopt := k.dbl <> o.dbl or k.quad <> o.quad or k.elec <> o.elec or (k.elec and k.ps <> o.ps);
  dsig := k.sig <> o.sig;
  dspec := k.gauge <> o.gauge or k.g2 is distinct from o.g2 or k.slp <> o.slp or (k.elec and k.cat <> o.cat) or k.nw <> o.nw;
  dsnow := k.snowp <> o.snowp;
  if p_dry then
    if dopt then c1 := mp_seg_opts(o.id, k.dbl, k.elec, null, true, null, k.quad, k.ps); cost := cost + coalesce((c1 ->> 'cost')::numeric, 0); need := c1 -> 'need'; end if;
    if dsig then cost := cost + coalesce((mp_seg_sig(o.id, k.sig, false, true) ->> 'cost')::numeric, 0); end if;
    if dspec and not o.gov then
      o2 := o;
      if k.elec and not o.elec then o2.elec := true; o2.cat := case when k.ps = 3 then 6 else 0 end; end if;
      cost := cost + _mp_spec_cost(o2, k.gauge, k.g2, k.slp, case when k.elec then k.cat else o2.cat end, k.nw);
    end if;
    if dsnow then cost := cost + coalesce((mp_seg_snow(o.id, k.snowp, true) ->> 'cost')::numeric, 0); end if;
    -- つなげるか（つなぎ目のカーブなど）：設定をそろえたつもりで ためして、もどす
    begin
      update mp_segs set dbl = k.dbl, quad = k.quad, elec = k.elec, ps = k.ps, sig = k.sig, gauge = k.gauge, g2 = k.g2, slp = k.slp, cat = k.cat, nw = k.nw, snowp = k.snowp, name = k.name where id = o.id;
      perform _mp_seg_join2(k.id, o.id);
      raise exception '__dry__';
    exception when others then
      if sqlerrm <> '__dry__' then jerr := sqlerrm; end if;
    end;
    return jsonb_build_object('cost', round(cost), 'keep', k.id, 'other', o.id, 'dif', to_jsonb(_mp_seg_difs(k, o)), 'need', need, 'err', jerr,
      'm', round(((k.len + o.len) * 50)::numeric));
  end if;
  -- そろえる（それぞれの工事。工事費もそれぞれ払う）→ 1本にする（どこかでだめなら、ぜんぶ取り消し）
  if dopt then perform mp_seg_opts(o.id, k.dbl, k.elec, k.name, false, null, k.quad, k.ps); end if;
  if dsig then perform mp_seg_sig(o.id, k.sig, false, false); end if;
  if dspec then
    select * into o from mp_segs where id = o.id;
    if o.gauge <> k.gauge or o.g2 is distinct from k.g2 or o.slp <> k.slp or (o.elec and o.cat <> k.cat) or o.nw <> k.nw then
      perform mp_seg_spec(o.id, jsonb_build_object('gauge', k.gauge, 'g2', coalesce(k.g2, 0), 'slp', k.slp, 'cat', k.cat, 'nw', k.nw), false, false);
    end if;
  end if;
  if dsnow then perform mp_seg_snow(o.id, k.snowp, false); end if;
  update mp_segs set name = k.name, color = k.color where id = o.id and (name is distinct from k.name or color is distinct from k.color);
  r := mp_seg_join(k.id, o.id);
  return r || jsonb_build_object('cost', round(cost));
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。mp_seg_spec・mp_seg_merge は ログインした人（中で持ち主かをしらべる）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_gbit', '_mp_gauge_names', '_mp_gauge_v', '_mp_slp_v', '_mp_cat_v', '_mp_seg_v', '_mp_gauge_mul', '_mp_slp_bmul', '_mp_slp_umul', '_mp_slp_rep', '_mp_cat_mul', '_mp_cat_cmul', '_mp_cat_umul', '_mp_cat_reach', '_mp_nw_cost', '_mp_nw_upk', '_mp_trk_upk', '_mp_slp_name', '_mp_cat_name', '_mp_runs_cap', '_mp_runs_merge', '_mp_cars_gauge_chk', '_mp_leg_gm', '_mp_noise_day', '_mp_spec_cost', '_mp_seg_difs', 'mp_seg_spec', 'mp_seg_merge') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 時刻を組みなおす操作は 60秒まで（create or replace で消えた設定も もどす）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '60s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean) set statement_timeout = '60s';
alter function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean, int) set statement_timeout = '60s';
alter function public.mp_sub_build(bigint, real, real, int, text, boolean) set statement_timeout = '60s';
alter function public.mp_sub_del(bigint, boolean) set statement_timeout = '60s';
alter function public.mp_seg_spec(bigint, jsonb, boolean, boolean) set statement_timeout = '60s';
alter function public.mp_seg_merge(bigint, bigint, bigint, boolean) set statement_timeout = '60s';

-- いまの線路の騒音を 計算しておく（地価・まちの成長には、次の朝4時から）
select _mp_noise_day() noise_tiles;
