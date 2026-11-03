-- 車両をふやす（特急形・急行形の電車、機関車、気動車、客車と寝台車）・料金・編成のプリセット：
--   更新71の車両は、だれも買っていなければ消して入れなおす（122系はそのまま）
--   特急形電車 178系・378系、急行形電車 166系・168系、機関車 EF68形・DD52形、急行形気動車 キハ62系・キハ116系、一般形気動車 キハ44系・キハ128形
--   客車は18系・52系、寝台車は28系から（座席・グリーン・A寝台・B寝台・個室・食堂・展望・荷物・郵便・電源車）
--   形式に 等級（cls）・個室の数（rooms）・設備（fn）・車番のけた（npad）。系列に よく使う編成（sets）・登場年（yr）
--   28系などは電源車がいる・パンタグラフのある付随車（Tp。378系）も数える（編成のきまり）。冷房・暖房は人が乗る車で見る（電源車・荷物車・郵便車をのぞく）
--   料金（_mp_tick_hour）：グリーン席・夜行の寝台と個室は料金を足す。食堂車は食事の売り上げ、荷物車・郵便車は走った km の分。食堂・ラウンジ・展望車は長い系統で少し人気
--   編成のプリセット（mp_fsets・mp_fset_save・mp_fset_del）：自分で保存した形式のならび。車両の一覧（mp_cars_list）にのせる

alter table public.mp_types add column if not exists cls text not null default '';     -- 等級（DB の更新72）：G グリーン（1等）・A A寝台（1等寝台）・B B寝台（2等・3等寝台）。'' はふつう
alter table public.mp_types add column if not exists rooms int not null default 0;     -- 個室の数（個室料金は1室ごと）
alter table public.mp_types add column if not exists fn text[] not null default '{}';  -- 設備：din 食堂車・buf ビュフェ・lng ラウンジ・obs 展望車・bag 荷物車・mail 郵便車・pow 電源車・np 電源車がいる車
alter table public.mp_types add column if not exists npad int;                         -- 車番の番号のけた（1 は0でうめない：ナハ18-1。null は3けたか4けた）
alter table public.mp_series add column if not exists sets jsonb not null default '[]'::jsonb;   -- よく使う編成（プリセット）：[{"n": 名前, "t": [形式…]}]。"@L" は、えらんだ機関車
alter table public.mp_series add column if not exists yr int;                          -- 登場した年
create table if not exists public.mp_fsets (      -- 編成のプリセット（自分で保存した形式のならび。DB の更新72）
  id    bigserial primary key,
  u     uuid not null references public.profiles(id) on delete cascade,
  name  text not null,
  types text[] not null,
  pfx   text not null default '',     -- 編成番号のはじめ（例：L）。注文するときに続きの番号をすすめる
  at    timestamptz not null default now(),
  unique (u, name)
);
alter table public.mp_fsets enable row level security;

-- 更新71の架空の名前の車両：だれも買っていなければ消す。買った人がいれば、注文できなくするだけ
delete from public.mp_serials s where s.type in (select t.code from public.mp_types t where t.series in ('178', '379', '166', '168', '15PC', '52PC', 'EF68', 'DD52', 'KH62', 'KH116', 'KH44', 'KH127'))
   and not exists (select 1 from public.mp_cars c where c.type = s.type);
delete from public.mp_types t where t.series in ('178', '379', '166', '168', '15PC', '52PC', 'EF68', 'DD52', 'KH62', 'KH116', 'KH44', 'KH127') and not exists (select 1 from public.mp_cars c where c.type = t.code);
update public.mp_types set on_sale = false where series in ('178', '379', '166', '168', '15PC', '52PC', 'EF68', 'DD52', 'KH62', 'KH116', 'KH44', 'KH127');
delete from public.mp_series s where s.code in ('178', '379', '166', '168', '15PC', '52PC', 'EF68', 'DD52', 'KH62', 'KH116', 'KH44', 'KH127') and not exists (select 1 from public.mp_types t where t.series = s.code);

-- 系列・形式（DB の更新72。名前とコードは架空。あとで書きかえたもの）
insert into public.mp_series(code, name, kind, note, ord, grp, yr, sets) values
  ('E178', '178系', 'emu', '交直流特急形電車（1960年代）。最高120km/h・リクライニングシート・冷房・トイレ。Mp17800（パンタグラフ）と M17800 で1組（ユニット）。グリーン車（Ts17800）・食堂車（Td17800）も', 20, null, 1968, '[{"n":"6両","t":["E178-Tc17800","E178-Mp17800","E178-M17800","E178-Mp17800","E178-M17800","E178-Tc17800"]},{"n":"9両（グリーン1）","t":["E178-Tc17800","E178-Mp17800","E178-M17800","E178-Ts17800","E178-Mp17800","E178-M17800","E178-Mp17800","E178-M17800","E178-Tc17800"]},{"n":"11両（グリーン2・食堂）","t":["E178-Tc17800","E178-Mp17800","E178-M17800","E178-Ts17800","E178-Ts17800","E178-Td17800","E178-Mp17800","E178-M17800","E178-Mp17800","E178-M17800","E178-Tc17800"]},{"n":"12両（グリーン・食堂）","t":["E178-Tc17800","E178-Mp17800","E178-M17800","E178-Mp17800","E178-M17800","E178-Ts17800","E178-Td17800","E178-Mp17800","E178-M17800","E178-Mp17800","E178-M17800","E178-Tc17800"]}]'::jsonb),
  ('E378', '378系', 'emu', '交直流特急形電車（2000年代・VVVF）。最高130km/h・リクライニングシート・冷房・トイレ。パンタグラフは付随車（Tp37800・Tpc37800）にのり、となりの電動車と1組', 21, null, 2001, '[{"n":"基本6両","t":["E378-Tsc37800","E378-Tp37800","E378-M37800","E378-T37800","E378-Tp37800","E378-Mc37800"]},{"n":"付属3両","t":["E378-Tpc37800","E378-M37800","E378-Tc37800"]},{"n":"9両（6＋3）","t":["E378-Tsc37800","E378-Tp37800","E378-M37800","E378-T37800","E378-Tp37800","E378-Mc37800","E378-Tpc37800","E378-M37800","E378-Tc37800"]},{"n":"12両（6＋3＋3）","t":["E378-Tsc37800","E378-Tp37800","E378-M37800","E378-T37800","E378-Tp37800","E378-Mc37800","E378-Tpc37800","E378-M37800","E378-Tc37800","E378-Tpc37800","E378-M37800","E378-Tc37800"]}]'::jsonb),
  ('E166', '166系', 'emu', '直流急行形電車（1960年代）。最高110km/h・ボックスシート・トイレ（冷房はグリーン車から）。Mc16600 と Mp16600（パンタグラフ）で1組。基本は Mc＋Mp＋Tc の3両。168系ともつなげる', 30, 'E166', 1963, '[{"n":"基本3両","t":["E166-Mc16600","E166-Mp16600","E166-Tc16600"]},{"n":"6両","t":["E166-Mc16600","E166-Mp16600","E166-Tc16600","E166-Mc16600","E166-Mp16600","E166-Tc16600"]},{"n":"急行11両（グリーン2・ビュフェ）","t":["E166-Mc16600","E166-Mp16600","E166-Ts16600","E166-Ts16600","E166-Tb16600","E166-Mc16600","E166-Mp16600","E166-Tc16600","E166-Mc16600","E166-Mp16600","E166-Tc16600"]},{"n":"急行12両（グリーン2・ビュフェ）","t":["E166-Mc16600","E166-Mp16600","E166-Ts16600","E166-Ts16600","E166-Tb16600","E166-Mc16600","E166-Mp16600","E166-Tc16600","E166-Mc16600","E166-Mp16600","E166-Tc16600","E166-Tc16600"]}]'::jsonb),
  ('E168', '168系', 'emu', '直流急行形電車（急な坂で補助の機関車と協調運転できる）。最高110km/h・ボックスシート・冷房・トイレ。Mc16800 と Mp16800（パンタグラフ）で1組。166系ともつなげる', 31, 'E166', 1968, '[{"n":"基本3両","t":["E168-Mc16800","E168-Mp16800","E168-Tc16800"]},{"n":"急行9両","t":["E168-Mc16800","E168-Mp16800","E168-Tc16800","E168-Mc16800","E168-Mp16800","E168-Tc16800","E168-Mc16800","E168-Mp16800","E168-Tc16800"]},{"n":"急行10両（グリーン1）","t":["E168-Mc16800","E168-Mp16800","E168-Ts16800","E168-Tc16800","E168-Mc16800","E168-Mp16800","E168-Tc16800","E168-Mc16800","E168-Mp16800","E168-Tc16800"]},{"n":"急行12両（グリーン2・ビュフェ）","t":["E168-Mc16800","E168-Mp16800","E168-Ts16800","E168-Ts16800","E168-Tb16800","E168-Tc16800","E168-Mc16800","E168-Mp16800","E168-Tc16800","E168-Mc16800","E168-Mp16800","E168-Tc16800"]}]'::jsonb),
  ('LEF68', 'EF68形', 'loco', '直流電気機関車（2,550kW）。電化した線だけ。500番台は寝台特急の客車（28系）をひく装備つきで最高110km/h', 50, null, 1965, '[]'::jsonb),
  ('LDD52', 'DD52形', 'loco', 'ディーゼル機関車（1,100PS×2）。電化していない線も走れる。最高95km/h', 51, null, 1962, '[]'::jsonb),
  ('DKH62', 'キハ62系', 'dmu', '急行形気動車（1960年代）。最高95km/h・ボックスシート・トイレ。電化していない線も走れる。キロ62・キロ63（グリーン車）は運転台なし。キハ44系ともつなげる', 60, 'DKH62', 1961, '[{"n":"2両","t":["DKH62-Kiha62","DKH62-Kiha63"]},{"n":"急行4両（グリーン・冷房の電源車）","t":["DKH62-Kiha62","DKH62-Kiro63","DKH62-Kiha62","DKH62-Kiha69"]},{"n":"急行5両","t":["DKH62-Kiha62","DKH62-Kiro63","DKH62-Kiha62","DKH62-Kiha63","DKH62-Kiha62"]}]'::jsonb),
  ('DKH116', 'キハ116系', 'dmu', '急行形気動車（1990年代・急行むけ）。最高100km/h・回転リクライニングシート・冷房。電化していない線も走れる', 61, null, 1990, '[{"n":"1両","t":["DKH116-Kiha116"]},{"n":"2両","t":["DKH116-Kiha117","DKH116-Kiha118"]},{"n":"急行3両","t":["DKH116-Kiha116","DKH116-Kiha117","DKH116-Kiha118"]},{"n":"4両","t":["DKH116-Kiha117","DKH116-Kiha118","DKH116-Kiha117","DKH116-Kiha118"]}]'::jsonb),
  ('DKH44', 'キハ44系', 'dmu', '一般形気動車（1970年代）。エンジン1基 220PS・最高95km/h・セミクロスシート。電化していない線も走れる。キハ44は1両でも走れる。キハ62系ともつなげる', 70, 'DKH62', 1977, '[{"n":"1両","t":["DKH44-Kiha44"]},{"n":"2両（両開き扉）","t":["DKH44-Kiha49","DKH44-Kiha49-1000"]},{"n":"2両（デッキつき）","t":["DKH44-Kiha49-500","DKH44-Kiha49-1500"]},{"n":"3両","t":["DKH44-Kiha49","DKH44-Kiha44","DKH44-Kiha49-1000"]}]'::jsonb),
  ('DKH128', 'キハ128形', 'dmu', '一般形気動車（1990年代・ローカル線のワンマン）。長さ16.3mの小さな両運転台・最高95km/h・冷房。電化していない線も走れる', 71, null, 1992, '[{"n":"1両","t":["DKH128-Kiha128"]},{"n":"2両","t":["DKH128-Kiha128","DKH128-Kiha128"]}]'::jsonb),
  ('P18', '18系客車', 'pc', '軽量客車（1950年代・急行と普通むけ）。座席車・寝台車（B寝台は3段・A寝台は2段のプルマン式）・食堂車・サロンカー・郵便車。最高95km/h。冷房は改造した形式だけ。機関車がひっぱる', 40, null, 1955, '[{"n":"普通4両","t":["@L","P18-Nahafu18","P18-Naha18","P18-Naha18","P18-Nahafu18"]},{"n":"急行（座席9両・グリーン1）","t":["@L","P18-Nahafu19","P18-Naha19","P18-Naha19","P18-Naha19","P18-Naro18","P18-Naha19","P18-Naha19","P18-Naha19","P18-Nahafu19"]},{"n":"寝台急行10両（郵便・A寝台・食堂）","t":["@L","P18-Oyu18","P18-Orone18","P18-Nahane19","P18-Nahane19","P18-Nahane19","P18-Nahane19","P18-Oshi18","P18-Naha19","P18-Nahafu19"]},{"n":"寝台急行12両（冷房）","t":["@L","P18-Ohanefu18","P18-Orone18","P18-Orone18","P18-Ohane19","P18-Ohane19","P18-Ohane19","P18-Suhane18","P18-Suhane18","P18-Oshi19","P18-Oro18","P18-Naha19","P18-Nahafu19"]}]'::jsonb),
  ('P28', '28系客車', 'pc', '寝台特急（ブルートレイン）の客車（1950年代の終わりから）。全車冷房・空気ばね。電源車（マニ28・カニ28 など）から電気をもらうので、電源車がいる。最高110km/h', 41, null, 1958, '[{"n":"寝台特急8両","t":["@L","P28-Kani28","P28-Narone29","P28-Nashi28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahanefu28"]},{"n":"寝台特急15両（座席車つき）","t":["@L","P28-Kani29","P28-Narone27","P28-Naro28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nashi28","P28-Nahanefu26","P28-Narone29","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahanefu28"]},{"n":"寝台特急15両（個室・A寝台が多い）","t":["@L","P28-Kani28","P28-Narone28","P28-Narone27","P28-Narone29","P28-Narone29","P28-Narone29","P28-Nahane28","P28-Naro28","P28-Nashi28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahane28","P28-Nahanefu28"]}]'::jsonb),
  ('P52', '52系客車', 'pc', '普通列車むけの客車（1970年代・赤い車体）。自動扉・セミクロスシート。最高95km/h・冷房なし。トイレは緩急車だけ', 42, null, 1977, '[{"n":"普通3両","t":["@L","P52-Ohafu52","P52-Oha52","P52-Ohafu52"]},{"n":"普通4両","t":["@L","P52-Ohafu52","P52-Oha52","P52-Oha52","P52-Ohafu52"]},{"n":"荷物・郵便つき6両","t":["@L","P52-Mani52","P52-Suyuni52","P52-Ohafu52","P52-Oha52","P52-Oha52","P52-Ohafu52"]},{"n":"寒い地方の普通4両","t":["@L","P52-Ohafu53","P52-Oha53","P52-Oha53","P52-Ohafu53"]}]'::jsonb),
  ('TENP', '展望車・特ロ', 'pc', '1等展望車と特別2等車（特ロ）。特急で18系とつないで走った。展望車は最後尾に。最高95km/h', 43, null, 1938, '[{"n":"特急10両（展望車つき）","t":["@L","P18-Nahafu19","P18-Naha19","P18-Naha19","P18-Naha19","P18-Oshi18","TENP-Suro56","TENP-Suro56","P18-Naro18","TENP-Maite56"]},{"n":"特急9両（展望車つき）","t":["@L","P18-Nahafu18","P18-Naha18","P18-Naha18","P18-Naha18","P18-Oshi18","TENP-Suro58","TENP-Suro58","TENP-Maite47"]}]'::jsonb)
on conflict (code) do nothing;
insert into public.mp_types(code, series, label, role, face, num_from, num_to, len, cap, seats, mass, power, panto, cab, vmax, acc, dec, elec, heat, ac, toilet, price, upkeep, life, note, ord, nbase, cls, rooms, fn, npad) values
  ('E178-Tc17800', 'E178', 'Tc17800', 'Tc', '', 1, 1999, 21.6, 56, 56, 41.0, 0, 0, true, 120, 1.6, 4.0, true, true, true, true, 75000000, 20000, 365, '制御車（運転台・トイレ。編成に電気を送る発電機つき）。0001〜', 3010, '178', '', 0, '{}', 4),
  ('E178-Mp17800', 'E178', 'Mp17800', 'Mp', '', 2001, 3999, 20.5, 64, 64, 45.0, 480, 1, false, 120, 1.6, 4.0, true, true, true, false, 90000000, 26000, 365, '電動車（パンタグラフ・変圧器・120kW×4。M17800と1組。車販準備室）。2001〜', 3020, '178', '', 0, '{}', 4),
  ('E178-M17800', 'E178', 'M17800', 'M', '', 4001, 5999, 20.5, 72, 72, 40.2, 480, 0, false, 120, 1.6, 4.0, true, true, true, true, 85000000, 25000, 365, '電動車（制御器・120kW×4・トイレ。Mp17800と1組）。4001〜', 3030, '178', '', 0, '{}', 4),
  ('E178-Ts17800', 'E178', 'Ts17800', 'T', '', 8001, 8499, 20.5, 48, 48, 38.0, 0, 0, false, 120, 1.6, 4.0, true, true, true, true, 82000000, 22000, 365, 'グリーン車（リクライニングシート・トイレ・車掌室）。8001〜', 3040, '178', 'G', 0, '{}', 4),
  ('E178-Td17800', 'E178', 'Td17800', 'T', '', 8501, 8999, 20.5, 0, 40, 41.0, 0, 0, false, 120, 1.6, 4.0, true, true, true, false, 95000000, 30000, 365, '食堂車（40席。旅客の定員にはふくまない）。8501〜', 3050, '178', '', 0, '{din}', 4),
  ('E378-Tsc37800', 'E378', 'Tsc37800', 'Tc', '', 1, 999, 21.6, 36, 36, 37.0, 0, 0, true, 130, 1.8, 4.2, true, true, true, true, 110000000, 22000, 365, 'グリーン車の先頭車（運転台・非貫通）。0001〜', 3060, '378', 'G', 0, '{}', 4),
  ('E378-Tp37800', 'E378', 'Tp37800', 'Tp', '', 7001, 7999, 21.1, 68, 68, 40.0, 0, 1, false, 130, 1.8, 4.2, true, true, true, true, 100000000, 20000, 365, '付随車（パンタグラフ・変圧器。となりの M37800 と1組）。7001〜', 3070, '378', '', 0, '{}', 4),
  ('E378-M37800', 'E378', 'M37800', 'M', '', 4001, 5999, 21.1, 72, 72, 39.0, 980, 0, false, 130, 1.8, 4.2, true, true, true, false, 120000000, 24000, 365, '電動車（VVVF・245kW×4）。4001〜', 3080, '378', '', 0, '{}', 4),
  ('E378-T37800', 'E378', 'T37800', 'T', '', 8001, 8999, 21.1, 46, 46, 36.0, 0, 0, false, 130, 1.8, 4.2, true, true, true, true, 95000000, 19000, 365, '付随車（車掌室・車販準備室・多目的室）。8001〜', 3090, '378', '', 0, '{}', 4),
  ('E378-Mc37800', 'E378', 'Mc37800', 'M', '', 6001, 6999, 21.6, 64, 64, 40.0, 980, 0, true, 130, 1.8, 4.2, true, true, true, false, 125000000, 25000, 365, '制御電動車（運転台・245kW×4。付属編成とつなぐ側）。6001〜', 3100, '378', '', 0, '{}', 4),
  ('E378-Tpc37800', 'E378', 'Tpc37800', 'Tp', '', 3001, 3999, 21.6, 56, 56, 40.0, 0, 1, true, 130, 1.8, 4.2, true, true, true, true, 105000000, 21000, 365, '制御車（運転台・パンタグラフ・変圧器。付属編成）。3001〜', 3110, '378', '', 0, '{}', 4),
  ('E378-Tc37800', 'E378', 'Tc37800', 'Tc', '', 1001, 1999, 21.6, 54, 54, 36.0, 0, 0, true, 130, 1.8, 4.2, true, true, true, true, 100000000, 20000, 365, '制御車（運転台・車いすで使えるトイレ。付属編成）。1001〜', 3120, '378', '', 0, '{}', 4),
  ('E166-Mc16600', 'E166', 'Mc16600', 'M', '', 4001, 5999, 20.0, 76, 76, 39.8, 480, 0, true, 110, 1.8, 3.5, true, true, false, true, 68000000, 20000, 365, '制御電動車（運転台・制御器・120kW×4・トイレ。Mp16600と1組）。4001〜', 3130, '166', '', 0, '{}', 4),
  ('E166-Mp16600', 'E166', 'Mp16600', 'Mp', '', 2001, 3999, 20.0, 84, 84, 38.0, 480, 1, false, 110, 1.8, 3.5, true, true, false, true, 65000000, 19000, 365, '電動車（パンタグラフ・発電機・120kW×4。Mc16600と1組）。2001〜', 3140, '166', '', 0, '{}', 4),
  ('E166-Tc16600', 'E166', 'Tc16600', 'Tc', '', 1, 1999, 20.0, 76, 76, 34.6, 0, 0, true, 110, 1.8, 3.5, true, true, false, true, 52000000, 14000, 365, '制御車（運転台・トイレ）。0001〜', 3150, '166', '', 0, '{}', 4),
  ('E166-Ts16600', 'E166', 'Ts16600', 'T', '', 8001, 8499, 20.0, 48, 48, 36.0, 0, 0, false, 110, 1.8, 3.5, true, true, true, true, 60000000, 15000, 365, 'グリーン車（リクライニングシート・冷房・トイレ）。8001〜', 3160, '166', 'G', 0, '{}', 4),
  ('E166-Tb16600', 'E166', 'Tb16600', 'T', '', 8501, 8999, 20.0, 36, 36, 37.0, 0, 0, false, 110, 1.8, 3.5, true, true, false, false, 70000000, 20000, 365, 'ビュフェ（そばコーナー）と普通席36の合造車。8501〜', 3170, '166', '', 0, '{buf}', 4),
  ('E168-Mc16800', 'E168', 'Mc16800', 'M', '', 4001, 5999, 20.0, 76, 76, 40.0, 480, 0, true, 110, 1.8, 3.5, true, true, true, true, 74000000, 21000, 365, '制御電動車（運転台・補助の機関車との協調運転・120kW×4・冷房・トイレ。Mp16800と1組）。4001〜', 3180, '168', '', 0, '{}', 4),
  ('E168-Mp16800', 'E168', 'Mp16800', 'Mp', '', 2001, 3999, 20.0, 84, 84, 38.0, 480, 1, false, 110, 1.8, 3.5, true, true, true, true, 72000000, 20000, 365, '電動車（パンタグラフ・発電機・120kW×4・冷房。Mc16800と1組）。2001〜', 3190, '168', '', 0, '{}', 4),
  ('E168-Tc16800', 'E168', 'Tc16800', 'Tc', '', 1, 1999, 20.0, 76, 76, 35.0, 0, 0, true, 110, 1.8, 3.5, true, true, true, true, 60000000, 15000, 365, '制御車（運転台・補助の機関車との連絡装置・冷房・トイレ）。0001〜', 3200, '168', '', 0, '{}', 4),
  ('E168-Ts16800', 'E168', 'Ts16800', 'T', '', 8001, 8499, 20.0, 48, 48, 36.0, 0, 0, false, 110, 1.8, 3.5, true, true, true, true, 66000000, 16000, 365, 'グリーン車（リクライニングシート・冷房・トイレ）。8001〜', 3210, '168', 'G', 0, '{}', 4),
  ('E168-Tb16800', 'E168', 'Tb16800', 'T', '', 8501, 8999, 20.0, 36, 36, 37.0, 0, 0, false, 110, 1.8, 3.5, true, true, false, false, 76000000, 21000, 365, 'ビュフェと普通席36の合造車。8501〜', 3220, '168', '', 0, '{buf}', 4),
  ('LEF68-EF68', 'LEF68', 'EF68', 'L', '', 1, 499, 16.5, 0, 0, 96.0, 2550, 2, true, 100, 1.5, 3.0, true, true, false, false, 260000000, 50000, 365, '一般形（貨物むけ）。最高100km/h', 3230, 'EF68', '', 0, '{}', 1),
  ('LEF68-EF68-500', 'LEF68', 'EF68 500番台', 'L', '', 501, 999, 16.5, 0, 0, 96.0, 2550, 2, true, 110, 1.5, 3.0, true, true, false, false, 280000000, 52000, 365, '500番台（寝台特急の客車をひく装備・特急色）。最高110km/h', 3240, 'EF68', '', 0, '{}', 1),
  ('LDD52-DD52', 'LDD52', 'DD52', 'L', '', 501, 999, 18.0, 0, 0, 84.0, 1618, 0, true, 95, 1.2, 3.0, false, true, false, false, 220000000, 60000, 365, '500番台（重連形：2両をひとりで運転できる・暖房の蒸気発生装置つき）', 3250, 'DD52', '', 0, '{}', 1),
  ('DKH62-Kiha62', 'DKH62', 'キハ62', 'Dc', '', 1, 999, 21.3, 84, 84, 38.0, 265, 0, true, 95, null, 3.5, false, true, false, true, 55000000, 20000, 365, '運転台つき（エンジン2基 180PS×2・トイレ）', 3260, 'キハ62', '', 0, '{}', 1),
  ('DKH62-Kiha63', 'DKH62', 'キハ63', 'Dc', '', 1, 999, 21.3, 84, 84, 33.1, 132, 0, true, 95, null, 3.5, false, true, false, true, 48000000, 16000, 365, '運転台つき（エンジン1基 180PS・トイレ）', 3270, 'キハ63', '', 0, '{}', 1),
  ('DKH62-Kiro63', 'DKH62', 'キロ63', 'D', '', 1, 999, 21.3, 52, 52, 35.0, 132, 0, false, 95, null, 3.5, false, true, true, true, 58000000, 17000, 365, 'グリーン車（運転台なし・エンジン1基・リクライニングシート・冷房）', 3280, 'キロ63', 'G', 0, '{}', 1),
  ('DKH62-Kiro62', 'DKH62', 'キロ62', 'D', '', 1, 999, 21.3, 52, 52, 39.0, 265, 0, false, 95, null, 3.5, false, true, false, true, 62000000, 19000, 365, 'グリーン車（運転台なし・エンジン2基）', 3290, 'キロ62', 'G', 0, '{}', 1),
  ('DKH62-Kiha69', 'DKH62', 'キハ69', 'Dc', '', 1, 999, 21.3, 84, 84, 43.0, 368, 0, true, 95, null, 3.5, false, true, true, false, 70000000, 22000, 365, '運転台つき（大きなエンジン 500PS・冷房。冷房の電気をとなりの車にも送る）', 3300, 'キハ69', '', 0, '{}', 1),
  ('DKH116-Kiha116', 'DKH116', 'キハ116', 'Dc', '両運転台', 1, 999, 20.0, 52, 52, 29.4, 309, 0, true, 100, 1.8, 4.0, false, true, true, true, 70000000, 16000, 365, '両運転台（1両でも走れる）。エンジン1基 420PS・トイレ', 3310, 'キハ116', '', 0, '{}', 1),
  ('DKH116-Kiha117', 'DKH116', 'キハ117', 'Dc', '奇数向き', 1, 999, 20.0, 60, 60, 28.9, 309, 0, true, 100, 1.8, 4.0, false, true, true, true, 66000000, 15000, 365, '片運転台（キハ118と2両で1組）。エンジン1基 420PS・トイレ', 3320, 'キハ117', '', 0, '{}', 1),
  ('DKH116-Kiha118', 'DKH116', 'キハ118', 'Dc', '偶数向き', 1, 999, 20.0, 64, 64, 28.4, 309, 0, true, 100, 1.8, 4.0, false, true, true, false, 64000000, 15000, 365, '片運転台（キハ117と2両で1組）。エンジン1基 420PS', 3330, 'キハ118', '', 0, '{}', 1),
  ('DKH44-Kiha44', 'DKH44', 'キハ44', 'Dc', '両運転台', 1, 999, 21.3, 96, 66, 37.3, 162, 0, true, 95, null, 3.5, false, true, false, true, 52000000, 17000, 365, '両運転台（1両でも走れる）・トイレ', 3340, 'キハ44', '', 0, '{}', 1),
  ('DKH44-Kiha49', 'DKH44', 'キハ49', 'Dc', '', 1, 499, 21.3, 124, 76, 35.5, 162, 0, true, 95, null, 3.5, false, true, false, true, 48000000, 16000, 365, '片運転台・両開きの扉（近郊形）・トイレ', 3350, 'キハ49', '', 0, '{}', 1),
  ('DKH44-Kiha49-1000', 'DKH44', 'キハ49 1000番台', 'Dc', '', 1001, 1499, 21.3, 128, 80, 35.1, 162, 0, true, 95, null, 3.5, false, true, false, false, 46000000, 15000, 365, '片運転台・両開きの扉・トイレなし（0番台と2両で）', 3360, 'キハ49', '', 0, '{}', 1),
  ('DKH44-Kiha49-500', 'DKH44', 'キハ49 500番台', 'Dc', '', 501, 999, 21.3, 108, 74, 35.9, 162, 0, true, 95, null, 3.5, false, true, false, true, 48000000, 16000, 365, '片運転台・片引戸とデッキ（寒い地方むけ）・トイレ', 3370, 'キハ49', '', 0, '{}', 1),
  ('DKH44-Kiha49-1500', 'DKH44', 'キハ49 1500番台', 'Dc', '', 1501, 1999, 21.3, 116, 82, 35.6, 162, 0, true, 95, null, 3.5, false, true, false, false, 46000000, 15000, 365, '片運転台・デッキ・トイレなし（500番台と2両で）', 3380, 'キハ49', '', 0, '{}', 1),
  ('DKH128-Kiha128', 'DKH128', 'キハ128', 'Dc', '両運転台', 1, 199, 16.3, 112, 49, 27.7, 243, 0, true, 95, null, 4.0, false, true, true, false, 60000000, 14000, 365, '0番台（ステンレス・ロングシート・エンジン1基 330PS）', 3390, 'キハ128', '', 0, '{}', 1),
  ('DKH128-Kiha128-200', 'DKH128', 'キハ128 200番台', 'Dc', '両運転台', 201, 299, 16.3, 105, 49, 26.7, 184, 0, true, 95, null, 4.0, false, true, true, false, 56000000, 13000, 365, '200番台（普通鋼・エンジン1基 250PS）', 3400, 'キハ128', '', 0, '{}', 1),
  ('DKH128-Kiha128-300', 'DKH128', 'キハ128 300番台', 'Dc', '両運転台', 301, 999, 16.3, 112, 49, 27.7, 243, 0, true, 95, null, 4.0, false, true, true, false, 62000000, 14000, 365, '300番台（ステンレス・セミクロスシート・エンジン1基 330PS）', 3410, 'キハ128', '', 0, '{}', 1),
  ('P18-Naha18', 'P18', 'ナハ18', 'P', '', 1, 999, 20.0, 88, 88, 23.8, 0, 0, false, 95, null, 3.0, false, true, false, true, 26000000, 6000, 365, '3等座席車（のちの普通車）。軽量客車の基本形', 3420, 'ナハ18', '', 0, '{}', 1),
  ('P18-Nahafu18', 'P18', 'ナハフ18', 'P', '緩急車', 1, 999, 20.0, 80, 80, 24.5, 0, 0, false, 95, null, 3.0, false, true, false, true, 28000000, 6500, 365, 'ナハ18 の緩急車（車掌室つき）', 3430, 'ナハフ18', '', 0, '{}', 1),
  ('P18-Naha19', 'P18', 'ナハ19', 'P', '', 1, 999, 20.0, 88, 88, 24.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 27000000, 6000, 365, '改良形（蛍光灯・1枚の開き戸）', 3440, 'ナハ19', '', 0, '{}', 1),
  ('P18-Nahafu19', 'P18', 'ナハフ19', 'P', '緩急車', 1, 999, 20.0, 80, 80, 25.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 29000000, 6500, 365, 'ナハ19 の緩急車（車掌室つき）', 3450, 'ナハフ19', '', 0, '{}', 1),
  ('P18-Naro18', 'P18', 'ナロ18', 'P', '', 1, 999, 20.0, 48, 48, 28.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 40000000, 9000, 365, '特別2等車（のちのグリーン車）。リクライニングシート・広い車体（特急むけ）', 3460, 'ナロ18', 'G', 0, '{}', 1),
  ('P18-Oro18', 'P18', 'オロ18', 'P', '', 1, 999, 20.0, 48, 48, 32.0, 0, 0, false, 95, null, 3.0, false, true, true, true, 46000000, 10000, 365, 'ナロ18 を冷房化（自分の発電機）', 3470, 'オロ18', 'G', 0, '{}', 1),
  ('P18-Nahane18', 'P18', 'ナハネ18', 'P', '', 1, 999, 20.5, 60, 60, 26.5, 0, 0, false, 95, null, 3.0, false, true, false, true, 34000000, 8000, 365, '3等寝台車（のちのB寝台・3段）', 3480, 'ナハネ18', 'B', 0, '{}', 1),
  ('P18-Nahanefu18', 'P18', 'ナハネフ18', 'P', '緩急車', 1, 999, 20.5, 54, 54, 27.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 35000000, 8500, 365, 'ナハネ18 の1区画を車掌室にした緩急車（3段）', 3490, 'ナハネフ18', 'B', 0, '{}', 1),
  ('P18-Nahane19', 'P18', 'ナハネ19', 'P', '', 1, 999, 20.5, 54, 54, 27.5, 0, 0, false, 95, null, 3.0, false, true, false, true, 35000000, 8000, 365, '寝台の間を広げた改良形（9区画・3段）', 3500, 'ナハネ19', 'B', 0, '{}', 1),
  ('P18-Nahanefu19', 'P18', 'ナハネフ19', 'P', '緩急車', 1, 999, 20.5, 54, 54, 28.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 36000000, 8500, 365, 'ナハネ19 の緩急車（団体列車むけ・3段）', 3510, 'ナハネフ19', 'B', 0, '{}', 1),
  ('P18-Ohane19', 'P18', 'オハネ19', 'P', '', 1, 999, 20.5, 54, 54, 31.5, 0, 0, false, 95, null, 3.0, false, true, true, true, 40000000, 9500, 365, 'ナハネ19 を冷房化（3段）', 3520, 'オハネ19', 'B', 0, '{}', 1),
  ('P18-Ohanefu18', 'P18', 'オハネフ18', 'P', '緩急車', 1, 999, 20.5, 54, 54, 32.0, 0, 0, false, 95, null, 3.0, false, true, true, true, 41000000, 10000, 365, 'ナハネフ18 を冷房化した緩急車（3段）', 3530, 'オハネフ18', 'B', 0, '{}', 1),
  ('P18-Ohane18', 'P18', 'オハネ18', 'P', '', 1, 999, 20.0, 54, 54, 32.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 33000000, 8000, 365, '古い客車の台枠と台車に、新しい車体（3段）', 3540, 'オハネ18', 'B', 0, '{}', 1),
  ('P18-Suhane18', 'P18', 'スハネ18', 'P', '', 1, 999, 20.0, 54, 54, 36.0, 0, 0, false, 95, null, 3.0, false, true, true, true, 38000000, 9000, 365, 'オハネ18 を冷房化（3段）', 3550, 'スハネ18', 'B', 0, '{}', 1),
  ('P18-Orone18', 'P18', 'オロネ18', 'P', '', 1, 999, 20.5, 28, 28, 34.0, 0, 0, false, 95, null, 3.0, false, true, true, true, 55000000, 13000, 365, '2等寝台車（のちのA寝台）。2段のプルマン式・冷房（自分の発電機）・空気ばね台車', 3560, 'オロネ18', 'A', 0, '{}', 1),
  ('P18-Oronefu18', 'P18', 'オロネフ18', 'P', '緩急車', 1, 999, 20.5, 28, 28, 34.0, 0, 0, false, 95, null, 3.0, false, true, true, true, 56000000, 13500, 365, 'オロネ18 の緩急車（2段のプルマン式）', 3570, 'オロネフ18', 'A', 0, '{}', 1),
  ('P18-Oshi18', 'P18', 'オシ18', 'P', '', 1, 999, 20.0, 0, 40, 34.0, 0, 0, false, 95, null, 3.0, false, true, true, false, 50000000, 14000, 365, '食堂車（40席。旅客の定員にはふくまない）', 3580, 'オシ18', '', 0, '{din}', 1),
  ('P18-Oshi19', 'P18', 'オシ19', 'P', '', 1, 999, 20.0, 0, 30, 33.0, 0, 0, false, 95, null, 3.0, false, true, true, false, 46000000, 12000, 365, 'サロンカー（寝台急行で寝台をつくるあいだ乗客が待つラウンジ。ビュフェつき）', 3590, 'オシ19', '', 0, '{lng,buf}', 1),
  ('P18-Oyu18', 'P18', 'オユ18', 'P', '', 1, 999, 20.0, 0, 0, 27.0, 0, 0, false, 95, null, 3.0, false, true, false, false, 30000000, 7000, 365, '郵便車（区分室つき・荷重8t。人は乗らない）', 3600, 'オユ18', '', 0, '{mail}', 1),
  ('P18-Suyu19', 'P18', 'スユ19', 'P', '', 1, 999, 20.0, 0, 0, 26.0, 0, 0, false, 95, null, 3.0, false, true, false, false, 28000000, 7000, 365, '郵便車（護送便・荷重13t。人は乗らない）', 3610, 'スユ19', '', 0, '{mail}', 1),
  ('P28-Narone28', 'P28', 'ナロネ28', 'P', '', 1, 999, 20.5, 18, 18, 31.5, 0, 0, false, 110, null, 3.0, false, true, true, true, 80000000, 20000, 365, '1等寝台の個室（1人用10室・2人用4室）', 3620, 'ナロネ28', 'A', 14, '{np}', 1),
  ('P28-Narone29', 'P28', 'ナロネ29', 'P', '', 1, 999, 20.5, 28, 28, 30.5, 0, 0, false, 110, null, 3.0, false, true, true, true, 66000000, 16000, 365, '2等寝台（のちのA寝台）。2段のプルマン式', 3630, 'ナロネ29', 'A', 0, '{np}', 1),
  ('P28-Narone27', 'P28', 'ナロネ27', 'P', '', 1, 999, 20.5, 22, 22, 31.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 72000000, 18000, 365, '1人用個室6室と、2段のプルマン式の寝台', 3640, 'ナロネ27', 'A', 6, '{np}', 1),
  ('P28-Nahane28', 'P28', 'ナハネ28', 'P', '', 1, 999, 20.5, 54, 54, 29.5, 0, 0, false, 110, null, 3.0, false, true, true, true, 50000000, 12000, 365, '3等寝台（のちのB寝台・3段）。いちばん多い形式', 3650, 'ナハネ28', 'B', 0, '{np}', 1),
  ('P28-Nahanefu28', 'P28', 'ナハネフ28', 'P', '緩急車', 1, 999, 20.5, 48, 48, 30.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 56000000, 13500, 365, '緩急車。流線形で、最後尾に展望室（3段）', 3660, 'ナハネフ28', 'B', 0, '{obs,np}', 1),
  ('P28-Nahanefu29', 'P28', 'ナハネフ29', 'P', '緩急車', 1, 999, 20.5, 48, 48, 30.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 54000000, 13000, 365, '緩急車。貫通形で、分けたりつないだりできる（3段）', 3670, 'ナハネフ29', 'B', 0, '{np}', 1),
  ('P28-Nahanefu27', 'P28', 'ナハネフ27', 'P', '緩急車', 1, 999, 20.5, 42, 42, 29.5, 0, 0, false, 110, null, 3.0, false, true, true, true, 54000000, 13000, 365, '緩急車。ナハフ28 の流線形の車体を使った展望室つき（3段）', 3680, 'ナハネフ27', 'B', 0, '{obs,np}', 1),
  ('P28-Nahanefu26', 'P28', 'ナハネフ26', 'P', '緩急車', 1, 999, 20.5, 42, 42, 29.5, 0, 0, false, 110, null, 3.0, false, true, true, true, 52000000, 12500, 365, '緩急車。ナハフ29 を寝台車にした貫通形（3段）', 3690, 'ナハネフ26', 'B', 0, '{np}', 1),
  ('P28-Naro28', 'P28', 'ナロ28', 'P', '', 1, 999, 20.5, 48, 48, 29.5, 0, 0, false, 110, null, 3.0, false, true, true, true, 60000000, 14000, 365, '特別2等車（のちのグリーン車）。リクライニングシート', 3700, 'ナロ28', 'G', 0, '{np}', 1),
  ('P28-Naha28', 'P28', 'ナハ28', 'P', '', 1, 999, 20.5, 64, 64, 29.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 44000000, 10000, 365, '3等座席車（のちの普通車）。売店つき', 3710, 'ナハ28', '', 0, '{np}', 1),
  ('P28-Nahafu28', 'P28', 'ナハフ28', 'P', '緩急車', 1, 999, 20.5, 68, 68, 28.4, 0, 0, false, 110, null, 3.0, false, true, true, true, 48000000, 11000, 365, '座席の緩急車。流線形で展望室つき', 3720, 'ナハフ28', '', 0, '{obs,np}', 1),
  ('P28-Nahafu29', 'P28', 'ナハフ29', 'P', '緩急車', 1, 999, 20.5, 60, 60, 29.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 46000000, 10500, 365, '座席の緩急車。貫通形・売店つき', 3730, 'ナハフ29', '', 0, '{np}', 1),
  ('P28-Nashi28', 'P28', 'ナシ28', 'P', '', 1, 999, 20.5, 0, 40, 30.5, 0, 0, false, 110, null, 3.0, false, true, true, false, 72000000, 20000, 365, '食堂車（40席・電気の厨房。旅客の定員にはふくまない）', 3740, 'ナシ28', '', 0, '{din,np}', 1),
  ('P28-Mani28', 'P28', 'マニ28', 'P', '緩急車', 1, 999, 17.5, 0, 0, 40.6, 0, 0, false, 110, null, 3.0, false, true, false, false, 85000000, 25000, 365, '電源車（ディーゼル発電機 250kVA×2）と荷物室（3t）・車掌室。人は乗らない', 3750, 'マニ28', '', 0, '{pow,bag}', 1),
  ('P28-Kani28', 'P28', 'カニ28', 'P', '緩急車', 1, 999, 20.0, 0, 0, 46.0, 0, 0, false, 110, null, 3.0, false, true, false, false, 90000000, 26000, 365, '電源車の標準形（荷物室5t・車掌室）。人は乗らない', 3760, 'カニ28', '', 0, '{pow,bag}', 1),
  ('P28-Kani29', 'P28', 'カニ29', 'P', '緩急車', 1, 999, 20.0, 0, 0, 59.0, 0, 2, false, 110, null, 3.0, false, true, false, false, 100000000, 30000, 365, '電源車（ディーゼル発電機と、パンタグラフで電気をとる電動発電機。荷物室2t・車掌室）。人は乗らない', 3770, 'カニ29', '', 0, '{pow,bag}', 1),
  ('P28-Maya28', 'P28', 'マヤ28', 'P', '', 1, 999, 20.0, 0, 0, 44.0, 0, 0, false, 110, null, 3.0, false, true, false, false, 70000000, 20000, 365, '簡易電源車（分けて走る編成のために）。人は乗らない', 3780, 'マヤ28', '', 0, '{pow}', 1),
  ('P52-Oha52', 'P52', 'オハ52', 'P', '', 1, 999, 20.0, 112, 80, 27.3, 0, 0, false, 95, null, 3.0, false, true, false, false, 30000000, 7000, 365, '普通車（自動扉・デッキつき）', 3790, 'オハ52', '', 0, '{}', 1),
  ('P52-Ohafu52', 'P52', 'オハフ52', 'P', '緩急車', 1, 999, 20.0, 92, 64, 27.6, 0, 0, false, 95, null, 3.0, false, true, false, true, 32000000, 7500, 365, '緩急車（車掌室・トイレ）', 3800, 'オハフ52', '', 0, '{}', 1),
  ('P52-Oha53', 'P52', 'オハ53', 'P', '', 1, 999, 20.0, 112, 80, 28.2, 0, 0, false, 95, null, 3.0, false, true, false, false, 32000000, 7500, 365, '寒い地方むけ（二重窓）', 3810, 'オハ53', '', 0, '{}', 1),
  ('P52-Ohafu53', 'P52', 'オハフ53', 'P', '緩急車', 1, 999, 20.0, 92, 64, 29.8, 0, 0, false, 95, null, 3.0, false, true, false, true, 34000000, 8000, 365, '寒い地方むけの緩急車（二重窓・車掌室・トイレ）', 3820, 'オハフ53', '', 0, '{}', 1),
  ('P52-Mani52', 'P52', 'マニ52', 'P', '緩急車', 1, 999, 20.0, 0, 0, 28.6, 0, 0, false, 95, null, 3.0, false, true, false, true, 28000000, 7000, 365, '荷物車（荷重13t・車掌室）。人は乗らない', 3830, 'マニ52', '', 0, '{bag}', 1),
  ('P52-Suyuni52', 'P52', 'スユニ52', 'P', '緩急車', 1, 999, 20.0, 0, 0, 31.5, 0, 0, false, 95, null, 3.0, false, true, false, false, 30000000, 7500, 365, '郵便荷物車（荷物4t・郵便4t・車掌室）。人は乗らない', 3840, 'スユニ52', '', 0, '{mail,bag}', 1),
  ('TENP-Maite47', 'TENP', 'マイテ47', 'P', '緩急車', 1, 999, 20.0, 16, 16, 45.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 90000000, 22000, 365, '1等展望車（1930年代）。最後尾の展望室・車掌室', 3850, 'マイテ47', 'G', 0, '{obs}', 1),
  ('TENP-Maite56', 'TENP', 'マイテ56', 'P', '緩急車', 1, 999, 20.0, 17, 17, 45.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 95000000, 23000, 365, '1等展望車（1930年代）。開放室と区分室・展望室・車掌室', 3860, 'マイテ56', 'G', 0, '{obs}', 1),
  ('TENP-Suro56', 'TENP', 'スロ56', 'P', '', 1, 999, 20.0, 48, 48, 37.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 45000000, 10000, 365, '特別2等車（1950年代）。リクライニングシート。18系の急行にもよくつないだ', 3870, 'スロ56', 'G', 0, '{}', 1),
  ('TENP-Suro58', 'TENP', 'スロ58', 'P', '', 1, 999, 20.0, 44, 44, 37.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 42000000, 10000, 365, '特別2等車（1950年）。リクライニングシートの客車', 3880, 'スロ58', 'G', 0, '{}', 1)
on conflict (code) do nothing;

-- 車番（車番のけた npad。DB の更新72）
create or replace function public._mp_carnum(t mp_types, n int) returns text
language sql immutable as $$
  select coalesce(t.nbase, regexp_replace(t.label, '^(Tc|Tp|Mc|Mp|M|T)(?=[0-9])', '')) || '-'
         || lpad(n::text, greatest(length(n::text), coalesce(t.npad, case when t.num_to >= 1000 then 4 else 3 end)), '0')
$$;

-- 編成の性能（料金の席と設備も。DB の更新72）
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
         sum(t.power * case when t.role in ('Dc', 'D') then 0.6 when t.role = 'L' then case when t.elec then 0.45 else 0.4 end else 1 end) epw,
         -- 料金の席と設備（DB の更新72）：グリーン席・A寝台・B寝台・個室の数・食堂車（ビュフェ）・ラウンジ・展望車・荷物車と郵便車の両数・電源車
         sum(case when t.cls = 'G' then t.cap else 0 end) xg, sum(case when t.cls = 'A' then t.cap else 0 end) xa, sum(case when t.cls = 'B' then t.cap else 0 end) xb, sum(t.rooms) xrm,
         bool_or(t.fn && array['din', 'buf']) xdin, bool_or('lng' = any(t.fn)) xlng, bool_or('obs' = any(t.fn)) xobs,
         count(*) filter (where t.fn && array['bag', 'mail']) xbag, bool_or('pow' = any(t.fn)) xpow
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
         'din', nullif(r.xdin, false), 'lng', nullif(r.xlng, false), 'obs', nullif(r.xobs, false), 'bag', nullif(r.xbag, 0), 'pow', nullif(r.xpow, false)));
end $$;

-- 編成のきまり（電源車・パンタグラフのある付随車 Tp。DB の更新72）
create or replace function public._mp_form_rule_t(tps text[]) returns text
language plpgsql stable set search_path = public as $$
declare n int := coalesce(array_length(tps, 1), 0); a mp_types; b mp_types; nm int; nmp int; nmo int; ns int; nbus int; ks text[]; nl int; np int; nf int;
begin
  if n = 0 then return '車両をえらんでください'; end if;
  if exists (select 1 from unnest(tps) x where not exists (select 1 from mp_types t where t.code = x)) then return '形式が見つかりません'; end if;
  select count(*) into nbus from unnest(tps) x join mp_types t on t.code = x where t.role = 'Bus';
  if nbus > 0 then return case when n = 1 then null else 'バスは1台ずつです' end; end if;
  if exists (select 1 from unnest(tps) x join mp_types t on t.code = x where t.role = 'Ship') then return case when n = 1 then null else '船は1隻ずつです' end; end if;
  if exists (select 1 from unnest(tps) x join mp_types t on t.code = x where t.role = 'Air') then return case when n = 1 then null else '飛行機は1機ずつです' end; end if;
  if n > 16 then return '1編成は16両までです'; end if;
  select * into a from mp_types where code = tps[1];
  select * into b from mp_types where code = tps[n];
  -- 種類（電車・気動車・機関車・客車）と、つなげる仲間（系列の grp。null はその系列だけ）の数
  select array_agg(distinct s.kind), count(distinct coalesce(s.grp, s.code)) into ks, ns
    from unnest(tps) x join mp_types t on t.code = x join mp_series s on s.code = t.series;
  -- 機関車と客車（DB の更新71）：機関車（L）を先頭か最後に1両以上。客車（P）には緩急車を1両以上。系列はまぜてよい
  if ks && array['loco', 'pc'] then
    if not ks <@ array['loco', 'pc'] then return '機関車・客車には、電車や気動車をつなげません'; end if;
    select count(*) filter (where t.role = 'L'), count(*) filter (where t.role = 'P'), count(*) filter (where t.role = 'P' and t.face = '緩急車') into nl, np, nf
      from unnest(tps) x join mp_types t on t.code = x;
    if nl = 0 then return '客車だけでは走れません。機関車（L）を1両以上つないでください'; end if;
    if a.role <> 'L' and b.role <> 'L' then return '機関車（L）は先頭か最後につないでください'; end if;
    if np > 0 and nf = 0 then return '客車には緩急車（車掌室つき。スハフ・オハフなど）を1両以上つないでください'; end if;
    -- 電源車（DB の更新72）：28系などは、冷房や電灯の電気を電源車（マニ28・カニ28 など）からもらう
    if exists (select 1 from unnest(tps) x join mp_types t on t.code = x where 'np' = any(t.fn))
       and not exists (select 1 from unnest(tps) x join mp_types t on t.code = x where 'pow' = any(t.fn)) then
      return 'この客車には電源車（マニ28・カニ28 など）がいります（冷房や電灯の電気を電源車からもらいます）';
    end if;
    return null;
  end if;
  -- 気動車（DB の更新71）：両はしは運転台つきの Dc（奇数向きと偶数向き。両運転台の車はどちらでも）。1両で走れるのは両運転台の車だけ
  if 'dmu' = any(ks) then
    if ks <> array['dmu'] then return '気動車には、電車をつなげません'; end if;
    if ns > 1 then return 'この組み合わせの気動車はつなげません（同じ系列か、「つなげる」と書いてある系列どうしだけ）'; end if;
    if n = 1 then return case when a.face = '両運転台' then null else '1両で走れるのは両運転台の車だけです（片運転台の車は2両以上で）' end; end if;
    if not a.cab or not b.cab then return '両はしは運転台つきの車（Dc）にしてください'; end if;
    if a.face in ('奇数向き', '偶数向き') and a.face = b.face then return format('両はしの向きが同じです（%s が2両）。奇数向きと偶数向きを1両ずつ（両運転台の車はどちらでも）', a.face); end if;
    return null;
  end if;
  -- 電車
  if ns > 1 then return 'ちがう系列の車両はつなげません'; end if;
  if n = 1 then return '電車は2両以上で編成にします（両はしに運転台つきの車）'; end if;
  if not a.cab or not b.cab then return '両はしは運転台つきの車（Tc）にしてください'; end if;
  if a.face <> '' and b.face <> '' and a.face = b.face then return format('両はしの向きが同じです（%s が2両）。奇数向きと偶数向きを1両ずつ', a.face); end if;
  -- まん中の運転台つきの車は、中間封じ込め（運転台は使わない）としてそのまま入れられる（t54h）
  -- パンタグラフのある車は Mp（電動車）と Tp（付随車。378系の Tp37800・Tpc37800 など。DB の更新72）。M はその数まで
  select count(*) filter (where t.role in ('Mp', 'Tp')), count(*) filter (where t.role = 'M'), count(*) filter (where t.role in ('Mp', 'M'))
    into nmp, nm, nmo from unnest(tps) x join mp_types t on t.code = x;
  if nmo = 0 then return '電動車（モーターのある車）が1両もありません（走れません）'; end if;
  if nmp = 0 then return 'パンタグラフのある車（Mp・Tp）が1両もありません（走れません）'; end if;
  if nm > nmp then return format('M（%s両）が、パンタグラフのある車（Mp・Tp %s両）より多いです。M はパンタグラフのある車と組で使います', nm, nmp); end if;
  return null;
end $$;

-- 車両の改造（トイレは Tp にも。DB の更新72）
create or replace function public.mp_car_work(p_cars bigint[], p_kind text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; c record; cost bigint := 0; n int := 0; hrs int; skip text := ''; label text; one bigint; subs bigint := 0; sb bigint; busn int := 0; ids bigint[] := '{}';
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  hrs := case p_kind when 'ac' then 24 when 'heat' then 6 when 'toilet' then 12 when 'inspect' then 4 when 'renew' then 48 when 'snow' then 48 else null end;
  label := case p_kind when 'ac' then '冷房化' when 'heat' then '暖房の取りつけ' when 'toilet' then 'トイレの取りつけ' when 'inspect' then '検査' when 'renew' then '更新工事' when 'snow' then '雪の対策' end;
  if hrs is null then raise exception '工事の種類がちがいます'; end if;
  if not coalesce(p_dry, false) then   -- 同じ名義の操作は1つずつ・車両をおさえる（2回押しても二重にならないように。DB の更新60）
    perform _mp_lock(pa.pu, pa.pc);
    perform 1 from mp_cars where id = any(p_cars) for update;
  end if;
  for c in select x.*, t.role, t.price tprice, t.cab, (select _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int) from mp_depots d where d.id = x.depot) zn
             from mp_cars x join mp_types t on t.code = x.type
            where x.id = any(p_cars) and x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc loop
    if c.busy_until > now() then skip := skip || ' ' || c.num || '（工事中・納車前）'; continue; end if;
    if p_kind in ('ac', 'heat', 'toilet') and c.role = 'L' then skip := skip || ' ' || c.num || '（機関車にはいりません）'; continue; end if;   -- DB の更新71
    if p_kind = 'ac' and c.ac then skip := skip || ' ' || c.num || '（冷房あり）'; continue; end if;
    if p_kind = 'heat' and c.heat then skip := skip || ' ' || c.num || '（暖房あり）'; continue; end if;
    if p_kind = 'toilet' and c.toilet then skip := skip || ' ' || c.num || '（トイレあり）'; continue; end if;
    if p_kind = 'toilet' and c.role not in ('Tc', 'T', 'Tp', 'P', 'Dc', 'D') then skip := skip || ' ' || c.num || '（トイレは Tc・T・Tp・客車・気動車に）'; continue; end if;   -- Tp：DB の更新72
    if p_kind = 'snow' and c.snow then skip := skip || ' ' || c.num || '（雪の対策ずみ）'; continue; end if;
    if p_kind = 'snow' and c.role in ('Ship', 'Air') then skip := skip || ' ' || c.num || '（船・飛行機はいりません）'; continue; end if;
    one := case p_kind when 'ac' then 8000000 when 'heat' then 2000000 when 'toilet' then 5000000 when 'inspect' then round(c.tprice * 0.03)
                       when 'renew' then round(c.tprice * 0.3) when 'snow' then case when c.role in ('Bus', 'Truck') then _mp_snowc('bus') else _mp_snowc('car') end end;
    if p_kind = 'snow' then   -- 車庫が雪国なら補助金（国がはらう）
      sb := case when pa.gv then 0 else round(one * _mp_snow_sub(coalesce(c.zn, 0))) end; subs := subs + sb; one := one - sb;
      if c.role in ('Bus', 'Truck') then busn := busn + 1; end if;
    end if;
    if c.role in ('Bus', 'Truck') and p_kind in ('ac', 'toilet') then one := round(one * 0.3); end if;
    cost := cost + one; n := n + 1; ids := ids || c.id;
    if not p_dry then
      update mp_cars set busy_from = now(), busy_until = now() + make_interval(hours => case when p_kind = 'snow' and c.role in ('Bus', 'Truck') then 6 else hrs end), busy_kind = p_kind,
             ac = ac or p_kind = 'ac', heat = heat or p_kind = 'heat', toilet = toilet or p_kind = 'toilet', snow = snow or p_kind = 'snow',
             cond = case when p_kind = 'inspect' then least(100, cond + 35) when p_kind = 'renew' then 100 else cond end,
             renewed = renewed + case when p_kind = 'renew' then 1 else 0 end
       where id = c.id and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    end if;
  end loop;
  if n = 0 then raise exception 'できる車両がありません%', case when skip <> '' then '（' || left(trim(skip), 120) || '）' else '' end; end if;
  if not p_dry then perform _mp_pay(pa.pu, pa.pc, false, cost, case when p_kind = 'snow' then 'snow' else 'car' end,
                                    format(case when (select bool_and(t.role = 'Ship') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '船の%s（%s隻）'
                                                when (select bool_and(t.role = 'Air') from mp_cars x join mp_types t on t.code = x.type where x.id = any(p_cars))
                                                then '飛行機の%s（%s機）' else '車両の%s（%s両）' end, label, n)
                                    || case when subs > 0 then format('（補助金 %s X）', _mp_snow_x(subs)) else '' end); end if;
  return jsonb_build_object('n', n, 'cost', cost, 'hours', case when p_kind = 'snow' and busn = n then 6 else hrs end, 'skip', trim(skip), 'sub', subs,
    -- 工事のあいだに運休になる列車（のべ。DB の更新60）
    'trains', case when p_dry then _mp_form_runs(array(select distinct x.form from mp_cars x where x.id = any(ids) and x.form is not null), now(),
                                                 now() + make_interval(hours => case when p_kind = 'snow' and busn = n then 6 else hrs end)) end);
end $$;

-- 1時間ごとの運賃（料金・食堂・荷物と郵便。DB の更新72）
create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0;
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null then continue; end if;
      dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      -- 編成の工事中（検査・改造・転属・納車）にかかる列車は運休：始発駅を出てから終点に着くまでのどこかが、工事の時間にかかるもの（DB の更新60）
      if _mp_form_busy(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) then nwk := nwk + 1; continue; end if;
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
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0)));   -- うち料金・食堂・荷物と郵便（DB の更新72）
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

-- 自分（名義）の車両・編成の一覧（編成のプリセットも。DB の更新72）
create or replace function public.mp_cars_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return jsonb_build_object(
    'cars', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'num', c.num, 'role', t.role, 'face', t.face, 'label', t.label, 'depot', c.depot, 'form', c.form, 'pos', c.pos,
               'cond', round(c.cond::numeric), 'heat', c.heat, 'ac', c.ac, 'toilet', c.toilet, 'snow', c.snow, 'renewed', c.renewed,
               'age', floor(extract(epoch from now() - c.born) / 86400), 'life', t.life,
               'busy', case when c.busy_until > now() then c.busy_kind end, 'until', case when c.busy_until > now() then c.busy_until end, 'price', c.price,
               'xfer', exists (select 1 from mp_xfers x where x.st = 'offer' and c.id = any(x.cars)))
               order by c.depot, c.form nulls last, c.pos, c.num), '[]'::jsonb)
             from mp_cars c join mp_types t on t.code = c.type where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'depot', f.depot, 'perf', _mp_form_perf(f.id),
               'trains', (select count(*) from mp_trains tr where tr.form = f.id),
               'op', (select jsonb_build_object('id', o.id, 'num', o.num) from mp_ops o where o.form = f.id),
               'xfer', (select x.id from mp_xfers x where x.form = f.id and x.st = 'offer' limit 1)) order by f.name), '[]'::jsonb)
             from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'cap', d.cap, 'x', d.x, 'y', d.y,
               'n', (select count(*) from mp_cars c where c.depot = d.id), 'plows', d.plows, 'zone', _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int), 'pub', d.own_u is null and d.own_c is null and not pa.gv) order by d.own_u is null and d.own_c is null, d.id), '[]'::jsonb)
             from mp_depots d where (d.own_u is not distinct from pa.pu and d.own_c is not distinct from pa.pc)
                                 or (d.kind = 'air' and d.bld is not null and _mp_gov_term(d.bld))),   -- 国の空港の駐機場（みんなで使う。t54q）
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from mp_types t where t.on_sale),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ord), '[]'::jsonb) from mp_series s),
    'fsets', _mp_fset_json(u));   -- 編成のプリセット（DB の更新72）
end $$;

-- 編成のプリセット（自分で保存した形式のならび。ログインした人ごと・30こまで）
create or replace function public._mp_fset_json(uid uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'types', to_jsonb(f.types), 'pfx', f.pfx) order by f.name), '[]'::jsonb)
    from mp_fsets f where f.u = uid
$$;
create or replace function public.mp_fset_save(p_name text, p_types text[], p_pfx text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _me(); nm text := left(trim(coalesce(p_name, '')), 24); n int := coalesce(array_length(p_types, 1), 0);
begin
  perform _mp_ok(uid);
  if nm = '' then raise exception 'プリセットの名前を入れてください'; end if;
  if n = 0 or n > 16 then raise exception 'プリセットは1〜16両です'; end if;
  if exists (select 1 from unnest(p_types) x where not exists (select 1 from mp_types t where t.code = x)) then raise exception '形式が見つかりません'; end if;
  if exists (select 1 from unnest(p_types) x join mp_types t on t.code = x where t.role in ('Bus', 'Truck', 'Ship', 'Air')) then raise exception 'プリセットは鉄道の車両だけです'; end if;
  if not exists (select 1 from mp_fsets f where f.u = uid and f.name = nm) and (select count(*) from mp_fsets f where f.u = uid) >= 30 then
    raise exception 'プリセットは30こまでです（いらないものを消してください）';
  end if;
  insert into mp_fsets(u, name, types, pfx) values (uid, nm, p_types, left(regexp_replace(coalesce(p_pfx, ''), '\s', '', 'g'), 8))
    on conflict (u, name) do update set types = excluded.types, pfx = excluded.pfx, at = now();
  return _mp_fset_json(uid);
end $$;
create or replace function public.mp_fset_del(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := _me();
begin
  perform _mp_ok(uid);
  delete from mp_fsets f where f.id = p_id and f.u = uid;
  return _mp_fset_json(uid);
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。プリセット・車両の一覧はログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_carnum', '_mp_form_perf', '_mp_form_rule_t', '_mp_tick_hour', '_mp_fset_json', 'mp_cars_list', 'mp_car_work', 'mp_fset_save', 'mp_fset_del') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
