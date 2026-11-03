-- 車両をふやす（2つずつ）：
--   特急形電車：178系・379系
--   急行形電車：166系・168系（166系ともつなげる）
--   客車：15系・52系。機関車がひっぱる
--   機関車：EF68形（電気）・DD52形（ディーゼル）
--   急行形気動車：キハ62系・キハ116系（急行むけ）
--   一般形気動車：キハ44系（キハ62系ともつなげる）・キハ127系
--   編成のきまり（_mp_form_rule_t）：機関車は先頭か最後・客車には緩急車。気動車は両はしが運転台つき（両運転台の車は1両でも）
--   系列に「つなげる仲間」（mp_series.grp）を足す
--   加速（_mp_form_perf）：形式の起動加速度を上限に。気動車・機関車は力を少なめに数える。冷房・暖房は機関車をのぞいて見る
--   改造（mp_car_work）：トイレは客車・気動車にもつけられる。機関車には冷房・暖房・トイレはいらない

alter table public.mp_series add column if not exists grp text;   -- つなげる仲間（同じ grp の系列どうしは1つの編成にできる。null はその系列だけ。DB の更新71）
insert into public.mp_series(code, name, kind, note, ord, grp) values
  ('178', '178系', 'emu', '特急形電車。最高120km/h・リクライニングシート・冷房・トイレ。Mp と M で1組（ユニット）。グリーン車（T）も入れられる', 20, null),
  ('379', '379系', 'emu', '特急形電車。最高130km/h・VVVF・リクライニングシート・冷房・トイレ。Mp と M で1組（ユニット）。グリーン車（T）も入れられる', 21, null),
  ('166', '166系', 'emu', '急行形電車。最高110km/h・ボックスシート・トイレ。冷房はグリーン車だけ。Mp と M で1組（ユニット）。グリーン車（T）も入れられる。168系ともつなげる', 30, '166'),
  ('168', '168系', 'emu', '急行形電車。最高110km/h・ボックスシート・冷房・トイレ・ブレーキが強い。Mp と M で1組（ユニット）。グリーン車（T）も入れられる。166系ともつなげる', 31, '166'),
  ('15PC', '15系客車', 'pc', '客車（急行・団体むけ）。最高110km/h・ボックスシート・冷房・トイレ。機関車がひっぱる', 40, null),
  ('52PC', '52系客車', 'pc', '客車（普通列車むけ）。最高95km/h・セミクロスシート・トイレ。冷房なし。機関車がひっぱる', 41, null),
  ('EF68', 'EF68形', 'loco', '電気機関車（直流）。2,550kW・最高110km/h。客車をひっぱる。電化した線だけ', 50, null),
  ('DD52', 'DD52形', 'loco', 'ディーゼル機関車。1,620kW・最高95km/h。客車をひっぱる。電化していない線も走れる', 51, null),
  ('KH62', 'キハ62系', 'dmu', '急行形気動車。エンジン2基・最高95km/h・ボックスシート・トイレ。電化していない線も走れる。キハ44系ともつなげる', 60, 'KH62'),
  ('KH116', 'キハ116系', 'dmu', '急行形気動車。エンジン1基 420PS・最高110km/h・リクライニングシート・冷房・トイレ。電化していない線も走れる', 61, null),
  ('KH44', 'キハ44系', 'dmu', '一般形気動車。エンジン1基 220PS・最高95km/h・セミクロスシート・トイレ。電化していない線も走れる。キハ62系ともつなげる', 70, 'KH62'),
  ('KH127', 'キハ127系', 'dmu', '一般形気動車。小さくて軽い・エンジン1基 330PS・最高95km/h・ロングシート・冷房・トイレ。電化していない線も走れる', 71, null)
on conflict (code) do nothing;
-- 形式（acc：起動加速度の上限 km/h/s。null は出力と重さだけで決まる）
insert into public.mp_types(code, series, label, role, face, num_from, num_to, len, cap, seats, mass, power, panto, cab, vmax, acc, dec, elec, heat, ac, toilet, price, upkeep, life, note, ord, nbase) values
  ('Tc17800o', '178', 'Tc17800', 'Tc', '奇数向き', 1, 1999, 21, 56, 56, 43.0, 0, 0, true, 120, 1.6, 3.5, true, true, true, true, 75000000, 20000, 365, '制御車（運転台つき・モーターなし・トイレ）。0001〜', 1010, '178'),
  ('Mp17800', '178', 'Mp17800', 'Mp', '', 2001, 3999, 20.5, 72, 72, 47.0, 480, 1, false, 120, 1.6, 3.5, true, true, true, false, 90000000, 26000, 365, '電動車（パンタグラフ1基・120kW×4）。2001〜', 1020, '178'),
  ('M17800', '178', 'M17800', 'M', '', 4001, 5999, 20.5, 72, 72, 46.0, 480, 0, false, 120, 1.6, 3.5, true, true, true, true, 85000000, 25000, 365, '電動車（パンタグラフなし・120kW×4・トイレ。Mp と組で走る）。4001〜', 1030, '178'),
  ('T17800', '178', 'T17800', 'T', '', 8001, 9999, 20.5, 48, 48, 40.0, 0, 0, false, 120, 1.6, 3.5, true, true, true, true, 82000000, 22000, 365, 'グリーン車（モーターなし・ゆったりした座席・トイレ）。8001〜', 1040, '178'),
  ('Tc17800e', '178', 'Tc17800', 'Tc', '偶数向き', 6001, 7999, 21, 56, 56, 43.0, 0, 0, true, 120, 1.6, 3.5, true, true, true, true, 75000000, 20000, 365, '制御車（運転台つき・モーターなし・トイレ）。6001〜', 1050, '178'),
  ('Tc37900o', '379', 'Tc37900', 'Tc', '奇数向き', 1, 1999, 21, 52, 52, 36.0, 0, 0, true, 130, 2.0, 4.0, true, true, true, true, 95000000, 18000, 365, '制御車（運転台つき・モーターなし・トイレ）。0001〜', 1110, '379'),
  ('Mp37900', '379', 'Mp37900', 'Mp', '', 2001, 3999, 21, 64, 64, 40.0, 560, 1, false, 130, 2.0, 4.0, true, true, true, false, 115000000, 22000, 365, '電動車（パンタグラフ1基・VVVF）。2001〜', 1120, '379'),
  ('M37900', '379', 'M37900', 'M', '', 4001, 5999, 21, 64, 64, 39.0, 560, 0, false, 130, 2.0, 4.0, true, true, true, true, 108000000, 21000, 365, '電動車（パンタグラフなし・VVVF・トイレ。Mp と組で走る）。4001〜', 1130, '379'),
  ('T37900', '379', 'T37900', 'T', '', 8001, 9999, 21, 40, 40, 35.0, 0, 0, false, 130, 2.0, 4.0, true, true, true, true, 100000000, 20000, 365, 'グリーン車（モーターなし・ゆったりした座席・トイレ）。8001〜', 1140, '379'),
  ('Tc37900e', '379', 'Tc37900', 'Tc', '偶数向き', 6001, 7999, 21, 52, 52, 36.0, 0, 0, true, 130, 2.0, 4.0, true, true, true, true, 95000000, 18000, 365, '制御車（運転台つき・モーターなし・トイレ）。6001〜', 1150, '379'),
  ('Tc16600o', '166', 'Tc16600', 'Tc', '奇数向き', 1, 1999, 20, 90, 76, 36.0, 0, 0, true, 110, 1.8, 3.5, true, true, false, true, 55000000, 14000, 365, '制御車（運転台つき・モーターなし・トイレ）。0001〜', 1210, '166'),
  ('Mp16600', '166', 'Mp16600', 'Mp', '', 2001, 3999, 20, 100, 84, 45.0, 480, 1, false, 110, 1.8, 3.5, true, true, false, false, 65000000, 20000, 365, '電動車（パンタグラフ1基・120kW×4）。2001〜', 1220, '166'),
  ('M16600', '166', 'M16600', 'M', '', 4001, 5999, 20, 100, 84, 44.0, 480, 0, false, 110, 1.8, 3.5, true, true, false, true, 60000000, 19000, 365, '電動車（パンタグラフなし・120kW×4・トイレ。Mp と組で走る）。4001〜', 1230, '166'),
  ('T16600', '166', 'T16600', 'T', '', 8001, 9999, 20, 64, 64, 38.0, 0, 0, false, 110, 1.8, 3.5, true, true, true, true, 60000000, 15000, 365, 'グリーン車（モーターなし・冷房・トイレ）。8001〜', 1240, '166'),
  ('Tc16600e', '166', 'Tc16600', 'Tc', '偶数向き', 6001, 7999, 20, 90, 76, 36.0, 0, 0, true, 110, 1.8, 3.5, true, true, false, true, 55000000, 14000, 365, '制御車（運転台つき・モーターなし・トイレ）。6001〜', 1250, '166'),
  ('Tc16800o', '168', 'Tc16800', 'Tc', '奇数向き', 1, 1999, 20, 90, 76, 38.0, 0, 0, true, 110, 1.8, 4.0, true, true, true, true, 62000000, 15000, 365, '制御車（運転台つき・モーターなし・冷房・トイレ）。0001〜', 1310, '168'),
  ('Mp16800', '168', 'Mp16800', 'Mp', '', 2001, 3999, 20, 100, 84, 47.0, 480, 1, false, 110, 1.8, 4.0, true, true, true, false, 72000000, 21000, 365, '電動車（パンタグラフ1基・120kW×4・冷房）。2001〜', 1320, '168'),
  ('M16800', '168', 'M16800', 'M', '', 4001, 5999, 20, 100, 84, 46.0, 480, 0, false, 110, 1.8, 4.0, true, true, true, true, 68000000, 20000, 365, '電動車（パンタグラフなし・120kW×4・冷房・トイレ。Mp と組で走る）。4001〜', 1330, '168'),
  ('T16800', '168', 'T16800', 'T', '', 8001, 9999, 20, 64, 64, 40.0, 0, 0, false, 110, 1.8, 4.0, true, true, true, true, 64000000, 16000, 365, 'グリーン車（モーターなし・冷房・トイレ）。8001〜', 1340, '168'),
  ('Tc16800e', '168', 'Tc16800', 'Tc', '偶数向き', 6001, 7999, 20, 90, 76, 38.0, 0, 0, true, 110, 1.8, 4.0, true, true, true, true, 62000000, 15000, 365, '制御車（運転台つき・モーターなし・冷房・トイレ）。6001〜', 1350, '168'),
  ('Oha15', '15PC', 'オハ15', 'P', '', 1, 999, 21.3, 100, 88, 33.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 40000000, 9000, 365, '普通車（座席88・冷房・トイレ）。001〜', 1410, 'オハ15'),
  ('Suhafu15', '15PC', 'スハフ15', 'P', '緩急車', 1, 999, 21.3, 76, 64, 37.0, 0, 0, false, 110, null, 3.0, false, true, true, true, 48000000, 11000, 365, '緩急車（車掌室と、冷房の電気をつくる発電機つき。座席64・トイレ）。001〜', 1420, 'スハフ15'),
  ('Oha52', '52PC', 'オハ52', 'P', '', 1, 999, 20, 112, 80, 32.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 30000000, 7000, 365, '普通車（座席80・トイレ）。001〜', 1510, 'オハ52'),
  ('Ohafu52', '52PC', 'オハフ52', 'P', '緩急車', 1, 999, 20, 100, 72, 31.0, 0, 0, false, 95, null, 3.0, false, true, false, true, 32000000, 8000, 365, '緩急車（車掌室つき。座席72・トイレ）。001〜', 1520, 'オハフ52'),
  ('EF68', 'EF68', 'EF68', 'L', '', 1, 999, 16.8, 0, 0, 96.0, 2550, 2, true, 110, 2.0, 3.0, true, true, false, false, 260000000, 50000, 365, '電気機関車（パンタグラフ2基・運転台は両はし）。客車をひっぱる。001〜', 1610, 'EF68'),
  ('DD52', 'DD52', 'DD52', 'L', '', 1, 999, 18.0, 0, 0, 84.0, 1620, 0, true, 95, 1.8, 3.0, false, true, false, false, 220000000, 60000, 365, 'ディーゼル機関車（エンジン2基・運転台はまん中）。客車をひっぱる。001〜', 1710, 'DD52'),
  ('Kiha62o', 'KH62', 'キハ62', 'Dc', '奇数向き', 1, 499, 21.3, 100, 84, 41.0, 265, 0, true, 95, null, 3.5, false, true, false, true, 55000000, 20000, 365, '運転台つき（エンジン2基 180PS×2・トイレ）。001〜', 1810, 'キハ62'),
  ('Kiro62', 'KH62', 'キロ62', 'D', '', 1, 499, 21.3, 64, 64, 42.0, 265, 0, false, 95, null, 3.5, false, true, true, true, 62000000, 21000, 365, 'グリーン車（運転台なし・エンジン2基 180PS×2・冷房・トイレ）。001〜', 1820, 'キロ62'),
  ('Kiha62e', 'KH62', 'キハ62', 'Dc', '偶数向き', 501, 999, 21.3, 100, 84, 41.0, 265, 0, true, 95, null, 3.5, false, true, false, true, 55000000, 20000, 365, '運転台つき（エンジン2基 180PS×2・トイレ）。501〜', 1830, 'キハ62'),
  ('Kiha116', 'KH116', 'キハ116', 'Dc', '両運転台', 1, 999, 20, 76, 56, 39.0, 309, 0, true, 110, null, 4.0, false, true, true, true, 70000000, 16000, 365, '両運転台（1両でも走れる）。エンジン1基 420PS・リクライニングシート・冷房・トイレ。001〜', 1910, 'キハ116'),
  ('Kiha117', 'KH116', 'キハ117', 'Dc', '奇数向き', 1, 999, 20, 80, 60, 38.0, 309, 0, true, 110, null, 4.0, false, true, true, true, 66000000, 15000, 365, '片運転台（キハ118と2両で1組）。エンジン1基 420PS・冷房・トイレ。001〜', 1920, 'キハ117'),
  ('Kiha118', 'KH116', 'キハ118', 'Dc', '偶数向き', 1, 999, 20, 84, 64, 37.5, 309, 0, true, 110, null, 4.0, false, true, true, false, 64000000, 15000, 365, '片運転台（キハ117と2両で1組）。エンジン1基 420PS・冷房。001〜', 1930, 'キハ118'),
  ('Kiha44', 'KH44', 'キハ44', 'Dc', '両運転台', 1, 999, 21.3, 96, 66, 37.0, 162, 0, true, 95, null, 3.5, false, true, false, true, 52000000, 17000, 365, '両運転台（1両でも走れる）。エンジン1基 220PS・トイレ。001〜', 2010, 'キハ44'),
  ('Kiha49o', 'KH44', 'キハ49', 'Dc', '奇数向き', 1, 499, 21.3, 100, 70, 36.0, 162, 0, true, 95, null, 3.5, false, true, false, true, 48000000, 16000, 365, '片運転台（偶数向きと2両で1組）。エンジン1基 220PS・トイレ。001〜', 2020, 'キハ49'),
  ('Kiha49e', 'KH44', 'キハ49', 'Dc', '偶数向き', 501, 999, 21.3, 100, 70, 36.0, 162, 0, true, 95, null, 3.5, false, true, false, false, 48000000, 16000, 365, '片運転台（奇数向きと2両で1組）。エンジン1基 220PS。501〜', 2030, 'キハ49'),
  ('Kiha127', 'KH127', 'キハ127', 'Dc', '両運転台', 1, 999, 16.3, 100, 36, 27.0, 243, 0, true, 95, null, 4.0, false, true, true, true, 60000000, 14000, 365, '両運転台（1両でも走れる）。エンジン1基 330PS・冷房・トイレ。001〜', 2110, 'キハ127')
on conflict (code) do nothing;

-- 編成の性能（加速は 形式の起動加速度が上限・気動車と機関車の力。冷房・暖房は機関車をのぞいて。DB の更新71）
create or replace function public._mp_form_perf(fid bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare r record; acc real; rail boolean;
begin
  select count(*) n, sum(t.len) len, sum(t.cap) cap, sum(t.seats) seats, sum(t.mass) mass, sum(t.power) pw, min(t.vmax) vmax, min(t.dec) dcc,
         min(t.acc) bacc, bool_or(t.elec) elec, bool_and(c.ac) filter (where t.role <> 'L') ac, bool_and(c.heat) filter (where t.role <> 'L') heat, bool_or(c.toilet) toilet, min(c.cond) cond,
         bool_or(c.busy_until > now()) busy, min(t.series) series, bool_and(t.role not in ('Bus', 'Truck', 'Ship', 'Air')) israil, sum(t.upkeep) upkeep,
         bool_or(t.role = 'Ship') isship, sum(t.load) load, bool_or(t.role = 'Air') isair, max(t.rwy) rwy,
         -- 加速につかえる力（DB の更新71）：気動車はエンジンの力が液体変速機で6割、機関車は重い客車をひくので 電気45%・ディーゼル40%
         sum(t.power * case when t.role in ('Dc', 'D') then 0.6 when t.role = 'L' then case when t.elec then 0.45 else 0.4 end else 1 end) epw
    into r from mp_cars c join mp_types t on t.code = c.type where c.form = fid;
  if r.n = 0 then return null; end if;
  rail := r.israil;
  -- 加速度（km/h/s）：乗っている人（定員の半分・1人 55kg）もふくめた重さで
  --   上限は3.5と、形式の起動加速度（acc。特急形などは ゆっくり。DB の更新71）
  acc := case when rail then least(3.5, coalesce(r.bacc, 3.5), 0.38 * r.epw / greatest(1, r.mass + r.cap * 0.5 * 0.055)) else coalesce(r.bacc, 3.5) end;
  return jsonb_build_object('n', r.n, 'len', r.len, 'cap', r.cap, 'seats', r.seats, 'mass', round(r.mass::numeric, 1), 'kw', r.pw,
    'acc', round(acc::numeric, 2), 'dec', r.dcc, 'vmax', r.vmax, 'elec', r.elec, 'ac', coalesce(r.ac, false), 'heat', coalesce(r.heat, false), 'toilet', r.toilet,
    'cond', round(r.cond::numeric), 'busy', coalesce(r.busy, false), 'series', r.series, 'rail', rail, 'upkeep', r.upkeep,
    'ship', coalesce(r.isship, false), 'load', coalesce(r.load, 0), 'air', coalesce(r.isair, false), 'rwy', r.rwy);
end $$;

-- 編成のきまりを見る（形式の列。先頭から順に。よければ null、だめならわけ）。機関車と客車・気動車（DB の更新71）
create or replace function public._mp_form_rule_t(tps text[]) returns text
language plpgsql stable set search_path = public as $$
declare n int := coalesce(array_length(tps, 1), 0); a mp_types; b mp_types; nm int; nmp int; ns int; nbus int; ks text[]; nl int; np int; nf int;
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
  select count(*) filter (where t.role = 'Mp'), count(*) filter (where t.role = 'M') into nmp, nm from unnest(tps) x join mp_types t on t.code = x;
  if nmp = 0 then return 'パンタグラフつきの電動車（Mp）が1両もありません（走れません）'; end if;
  if nm > nmp then return format('M（%s両）が Mp（%s両）より多いです。M は Mp と組で使います', nm, nmp); end if;
  return null;
end $$;

-- 車両の改造・検査・更新工事。トイレは客車・気動車にも・機関車にはいらない（DB の更新71）
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
    if p_kind = 'toilet' and c.role not in ('Tc', 'T', 'P', 'Dc', 'D') then skip := skip || ' ' || c.num || '（トイレは Tc・T・客車・気動車に）'; continue; end if;
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

-- 関数の権限：だれでも（ログインなし）は呼べない。改造（mp_car_work）はログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_form_perf', '_mp_form_rule_t', 'mp_car_work') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
