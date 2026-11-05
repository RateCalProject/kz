-- DB の更新109：駅直結ビル・地下街
--   駅直結ビル（建物の新しい種類 ekichoku）：自分の駅（同じ持ち主・その人の会社）のとなり（ホームから 20m 以内）の土地に建てる。
--     1階は「駅ナカのお店」（はじめは自分で動かす。客は となりの駅の乗り降りの人（250m 以内の駅）と まわりの人）。2階から上は 階ごとに テナントに貸す
--   地下街（mp_ugm）：自分の駅から 道路の下に のばす（25m〜1km）。駅の乗り降りの人が お店に来る（1時間ごとに 売り上げ・維持費）
create table if not exists public.mp_ugm (    -- 地下街（DB の更新109）
  id    bigserial primary key,
  sta   bigint not null references public.mp_stations(id) on delete cascade,   -- 出入りする駅
  own_u uuid references public.profiles(id) on delete set null,
  own_c int references public.companies(id) on delete set null,
  pts   int[] not null,                -- 折れ線（1/100 マス）。はじめの点は 駅のそば
  len   real not null,                 -- 長さ（マス）
  bb    box not null,                  -- 範囲（マス）
  name  text not null default '',
  cost  bigint not null default 0,
  st    jsonb,                         -- いまのようす（1時間ごと）：n 1日の客・cap 入れる人・pool 来る見こみ
  created_at timestamptz not null default now()
);
create index if not exists mp_ugm_sta on public.mp_ugm (sta);
create index if not exists mp_ugm_bb on public.mp_ugm using gist (bb);
alter table public.mp_ugm enable row level security;

create or replace function public._mp_bld_presets() returns jsonb
language sql immutable as $$
  select '[
   {"k":"house","n":"一戸建て","use":"home","one":true,"z":"abcehik","cpm":300,"f0":1,"f1":3,"min":1,"max":6,"sh":["full","L"],"cat":"home","c":"#c47b4e"},
   {"k":"apart","n":"アパート","use":"home","u":40,"z":"abcek","cpm":320,"f0":2,"f1":3,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#9aa7b3"},
   {"k":"mansion","n":"マンション","use":"home","u":70,"z":"bcdek","cpm":600,"f0":4,"f1":15,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"opt":["shop1"],"cat":"home","c":"#d9d4cc"},
   {"k":"tower","n":"タワーマンション","use":"home","u":75,"z":"cd","cpm":900,"f0":20,"f1":45,"min":16,"max":200,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#cfd6de"},
   {"k":"shop","n":"店舗つき住宅","use":"home","u":50,"g1":"shop","z":"abcdek","cpm":350,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"cat":"home","c":"#e6a06e"},
   {"k":"zakkyo","n":"雑居ビル","use":"office","u":60,"g1":"shop","g2":"shop","z":"cd","cpm":650,"f0":3,"f1":10,"min":2,"max":12,"sh":["full","slab"],"cat":"biz","c":"#c9b8a6"},
   {"k":"office","n":"オフィスビル","use":"office","u":0,"z":"cd","cpm":800,"f0":5,"f1":30,"min":6,"max":120,"sh":["full","slab","L","tower"],"opt":["shop1"],"cat":"biz","c":"#aebdd0"},
   {"k":"sky","n":"超高層ビル","use":"office","u":0,"g1":"shop","g2":"shop","z":"d","cpm":1100,"f0":30,"f1":60,"min":25,"max":400,"sh":["tower"],"cat":"biz","c":"#9fb3cc","fx":{"office":0.04,"shop":0.03}},
   {"k":"mall","n":"ショッピングセンター","use":"shop","u":200,"z":"cde","cpm":450,"f0":1,"f1":4,"min":20,"max":1600,"sh":["full","slab","ro"],"cat":"shop","c":"#e8d2b0","fx":{"shop":0.06}},
   {"k":"factory","n":"工場","use":"factory","one":true,"z":"ef","cpm":250,"f0":1,"f1":2,"min":10,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#b8b8b0","fx":{"home":-0.03}},
   {"k":"warehouse","n":"倉庫","use":"warehouse","one":true,"z":"efgk","cpm":200,"f0":1,"f1":3,"min":4,"max":800,"sh":["full","slab"],"cat":"logi","c":"#c2b59b"},
   {"k":"port","n":"港湾施設","use":"port","one":true,"z":"gk","cpm":500,"f0":1,"f1":1,"min":10,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#9ab3c0","opts":["ore","crude"]},
   {"k":"farm","n":"田畑","use":"farm","one":true,"z":"h","cpm":10,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#a9cf73","opts":["wheat"],"pat":"rows"},
   {"k":"parking","n":"駐車場","use":"parking","one":true,"z":"abcdefghk","cpm":30,"f0":0,"f1":0,"min":1,"max":400,"sh":["full"],"cat":"park","c":"#bdbdbd","pat":"lines"},
   {"k":"pkbld","n":"立体駐車場","use":"parking","u":0,"z":"bcdefk","cpm":400,"f0":2,"f1":8,"min":6,"max":400,"sh":["full","slab"],"cat":"park","c":"#b0b0b0"},
   {"k":"es","n":"小学校","use":"school","one":true,"z":"abcek","cpm":350,"f0":1,"f1":4,"min":10,"max":400,"sh":["full","slab","L","ko"],"sc":"es","cat":"school","c":"#d9b77e"},
   {"k":"jhs","n":"中学校","use":"school","one":true,"z":"abcek","cpm":350,"f0":1,"f1":4,"min":10,"max":400,"sh":["full","slab","L","ko"],"sc":"jhs","cat":"school","c":"#c9a16a"},
   {"k":"hs","n":"高校","use":"school","one":true,"z":"abcdek","cpm":400,"f0":1,"f1":6,"min":12,"max":600,"sh":["full","slab","L","ko"],"sc":"hs","cat":"school","c":"#b98e5e"},
   {"k":"univ","n":"大学","use":"school","one":true,"z":"abcdehk","cpm":500,"f0":1,"f1":20,"min":20,"max":1600,"sh":["full","slab","L","ko","ro","tower"],"sc":"univ","cat":"school","c":"#a65a46","fx":{"home":0.08,"shop":0.04}},
   {"k":"voc","n":"専門学校","use":"school","one":true,"z":"bcdek","cpm":600,"f0":2,"f1":15,"min":3,"max":200,"sh":["full","slab","tower"],"sc":"voc","cat":"school","c":"#b7a2c9"},
   {"k":"mill","n":"製粉工場","use":"factory","one":true,"z":"efgk","cpm":300,"f0":1,"f1":4,"min":10,"max":1600,"sh":["full","slab"],"mk":"flour","cat":"ind","c":"#d8c9a3"},
   {"k":"foodf","n":"食品工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":4,"min":10,"max":1600,"sh":["full","slab"],"mk":"food","cat":"ind","c":"#e3b98a"},
   {"k":"steelw","n":"製鉄所","use":"factory","one":true,"z":"fgk","cpm":400,"f0":1,"f1":3,"min":40,"max":1600,"sh":["full","slab"],"mk":"steel","cat":"ind","c":"#7d7f86","fx":{"home":-0.05}},
   {"k":"carf","n":"自動車工場","use":"factory","one":true,"z":"ef","cpm":350,"f0":1,"f1":3,"min":30,"max":1600,"sh":["full","slab"],"mk":"car","cat":"ind","c":"#9fb4c8"},
   {"k":"petro","n":"石油化学工場","use":"factory","one":true,"z":"fgk","cpm":450,"f0":1,"f1":3,"min":30,"max":1600,"sh":["full","slab"],"mk":"chem","cat":"ind","c":"#c7c2a0","fx":{"home":-0.05}},
   {"k":"elecf","n":"半導体・家電工場","use":"factory","one":true,"z":"ef","cpm":500,"f0":1,"f1":5,"min":10,"max":1600,"sh":["full","slab"],"mk":"elec","cat":"ind","c":"#b8d0d8"},
   {"k":"railf","n":"鉄道車両工場","use":"factory","one":true,"z":"ef","cpm":350,"f0":1,"f1":2,"min":30,"max":1600,"sh":["full","slab"],"mk":"railcar","cat":"ind","c":"#8f9e8a"},
   {"k":"hira","n":"平屋","use":"home","one":true,"z":"abcehik","cpm":280,"f0":1,"f1":1,"min":1,"max":8,"sh":["full","L"],"cat":"home","c":"#b9845a","dm":1.05},
   {"k":"nisetai","n":"二世帯住宅","use":"home","u":0,"z":"abcek","cpm":320,"f0":2,"f1":3,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#b77e57","rl":1.1,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"sankai","n":"三階建て住宅","use":"home","one":true,"z":"abcdek","cpm":330,"f0":3,"f1":3,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#a9704c","rl":1.05},
   {"k":"kyosho","n":"狭小住宅","use":"home","one":true,"z":"bcdek","cpm":360,"f0":2,"f1":3,"min":1,"max":2,"sh":["full"],"cat":"home","c":"#9b6a4e","rl":0.95,"dm":1.1},
   {"k":"kodate","n":"建売住宅","use":"home","one":true,"z":"abcek","cpm":270,"f0":2,"f1":2,"min":1,"max":4,"sh":["full","L"],"cat":"home","c":"#c98a5c","rl":0.95,"dm":1.1},
   {"k":"chumon","n":"注文住宅","use":"home","one":true,"z":"abcek","cpm":400,"f0":2,"f1":3,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#b5654a","rl":1.2,"dm":0.95},
   {"k":"eco","n":"エコハウス","use":"home","one":true,"z":"abcek","cpm":450,"f0":2,"f1":2,"min":2,"max":8,"sh":["full","L"],"cat":"home","c":"#5d7f6a","rl":1.15},
   {"k":"yokan","n":"洋館","use":"home","one":true,"z":"abhik","cpm":650,"f0":2,"f1":3,"min":4,"max":20,"sh":["full","L","ko"],"cat":"home","c":"#8c5a4a","rl":1.6,"dm":0.75},
   {"k":"gotei","n":"豪邸","use":"home","one":true,"z":"abhik","cpm":900,"f0":1,"f1":3,"min":8,"max":40,"sh":["full","L","ko","ro"],"cat":"home","c":"#6b4b3a","rl":2.2,"dm":0.6},
   {"k":"wafu","n":"和風邸宅","use":"home","one":true,"z":"abhik","cpm":800,"f0":1,"f1":2,"min":6,"max":30,"sh":["full","L","ko"],"cat":"home","c":"#4f5a58","rl":1.9,"dm":0.65},
   {"k":"kominka","n":"古民家","use":"home","one":true,"z":"abhik","cpm":200,"f0":1,"f1":2,"min":3,"max":20,"sh":["full","L"],"cat":"home","c":"#6d5c48","rl":0.8,"dm":0.8},
   {"k":"machiya","n":"町家","use":"home","u":50,"g1":"shop","z":"bcdk","cpm":380,"f0":2,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#5b4636","rl":1.1},
   {"k":"log","n":"ログハウス","use":"home","one":true,"z":"ahik","cpm":300,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"home","c":"#9b6b3c","rl":1.1,"dm":0.7},
   {"k":"villa","n":"別荘","use":"home","one":true,"z":"hi","cpm":500,"f0":1,"f1":2,"min":4,"max":30,"sh":["full","L"],"cat":"home","c":"#7aa0a8","rl":1.5,"dm":0.5},
   {"k":"nagaya","n":"長屋","use":"home","u":35,"z":"abcek","cpm":250,"f0":1,"f1":2,"min":2,"max":12,"sh":["slab","full"],"cat":"home","c":"#7b6a58","rl":0.7,"dm":1.1,"dn":["{}長屋"]},
   {"k":"bunka","n":"文化住宅","use":"home","u":30,"z":"abcek","cpm":240,"f0":2,"f1":2,"min":2,"max":12,"sh":["full","slab"],"cat":"home","c":"#a08f78","rl":0.65,"dm":1.15,"dn":["{}文化","{}荘"]},
   {"k":"mokuapa","n":"木造アパート","use":"home","u":35,"z":"abcek","cpm":280,"f0":2,"f1":2,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#b39a7a","rl":0.85,"dm":1.05,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"tekkotsu","n":"鉄骨アパート","use":"home","u":40,"z":"abcek","cpm":340,"f0":2,"f1":3,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#9fa7ad","rl":0.95,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"gakusei","n":"学生アパート","use":"home","u":20,"z":"bcdek","cpm":320,"f0":2,"f1":4,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#a7b4bf","rl":0.8,"pp":1.2,"dn":["{}荘","コーポ{}"]},
   {"k":"designapa","n":"デザイナーズアパート","use":"home","u":45,"z":"abcdek","cpm":480,"f0":2,"f1":3,"min":2,"max":12,"sh":["full","slab","L"],"cat":"home","c":"#e8e3da","rl":1.35,"dm":0.9,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"share","n":"シェアハウス","use":"home","u":14,"z":"abcdek","cpm":360,"f0":2,"f1":3,"min":2,"max":8,"sh":["full"],"cat":"home","c":"#d1b48c","rl":0.9,"dm":1.1,"dn":["シェアハウス{}"]},
   {"k":"shataku","n":"社宅","use":"home","u":60,"z":"bcdek","cpm":450,"f0":3,"f1":6,"min":6,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#c8c2b5","rl":0.8,"dm":1.2,"dn":["{}社宅"]},
   {"k":"ryo","n":"社員寮","use":"home","u":18,"z":"bcdefk","cpm":400,"f0":2,"f1":6,"min":4,"max":40,"sh":["full","slab"],"cat":"home","c":"#bfb6a6","rl":0.6,"dm":1.2,"pp":1.2,"dn":["{}寮"]},
   {"k":"gakuryo","n":"学生寮","use":"home","u":16,"z":"abcdek","cpm":420,"f0":2,"f1":8,"min":4,"max":60,"sh":["full","slab"],"cat":"home","c":"#c4b9a3","rl":0.6,"pp":1.2,"dn":["{}学生寮"]},
   {"k":"senior","n":"高齢者向け住宅","use":"home","u":45,"z":"abcdek","cpm":600,"f0":2,"f1":6,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d6cbb8","rl":1.2,"dm":1.1,"pp":0.6,"dn":["{}シニアレジデンス"]},
   {"k":"danchi","n":"団地","use":"home","u":50,"z":"bcdek","cpm":420,"f0":4,"f1":5,"min":20,"max":600,"sh":["slab","L","full"],"cat":"home","c":"#d9d6cc","rl":0.75,"dm":1.15,"dn":["{}団地"]},
   {"k":"koei","n":"公営住宅","use":"home","u":55,"z":"bcdek","cpm":430,"f0":3,"f1":10,"min":10,"max":400,"sh":["slab","L","full"],"cat":"home","c":"#d2cfc4","rl":0.6,"dm":1.3,"dn":["{}住宅"]},
   {"k":"lowman","n":"低層マンション","use":"home","u":70,"z":"abcdek","cpm":600,"f0":2,"f1":4,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#e2ddd4","rl":1.15,"dm":0.95,"dn":["{}ハイツ","{}荘","コーポ{}"]},
   {"k":"midman","n":"中層マンション","use":"home","u":70,"z":"bcdek","cpm":620,"f0":5,"f1":9,"min":6,"max":100,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#dcd7ce","dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"highman","n":"高層マンション","use":"home","u":70,"z":"bcdk","cpm":700,"f0":10,"f1":19,"min":10,"max":160,"sh":["slab","L","full","tower"],"opt":["shop1"],"cat":"home","c":"#d5d9de","rl":1.05,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"luxman","n":"高級マンション","use":"home","u":110,"z":"abcdk","cpm":950,"f0":3,"f1":15,"min":8,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#c9c1b4","rl":1.7,"dm":0.75,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"designman","n":"デザイナーズマンション","use":"home","u":60,"z":"bcdk","cpm":800,"f0":3,"f1":10,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#ebe8e2","rl":1.35,"dm":0.9,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"petman","n":"ペット可マンション","use":"home","u":70,"z":"bcdek","cpm":650,"f0":3,"f1":10,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d8cfc0","rl":1.1,"dm":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"oneroom","n":"ワンルームマンション","use":"home","u":22,"z":"bcdk","cpm":650,"f0":3,"f1":12,"min":2,"max":40,"sh":["full","slab"],"cat":"home","c":"#cfd2d4","rl":1.0,"dm":1.15,"pp":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"family","n":"ファミリーマンション","use":"home","u":85,"z":"bcdek","cpm":620,"f0":4,"f1":14,"min":6,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#dfd8cb","dm":1.05,"pp":1.1,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"smartman","n":"スマートマンション","use":"home","u":65,"z":"bcdek","cpm":750,"f0":5,"f1":15,"min":6,"max":120,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d2dbe0","rl":1.2,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"okushon","n":"億ション","use":"home","u":150,"z":"cd","cpm":1300,"f0":5,"f1":30,"min":10,"max":120,"sh":["slab","L","full","tower"],"cat":"home","c":"#b8ad9c","rl":2.6,"dm":0.55,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"servapa","n":"サービスアパートメント","use":"home","u":50,"z":"cd","cpm":900,"f0":5,"f1":20,"min":6,"max":80,"sh":["slab","full","tower"],"cat":"home","c":"#c7cdd2","rl":1.5,"dm":0.85,"dn":["{}サービスアパートメント"]},
   {"k":"supertower","n":"超高層マンション","use":"home","u":75,"z":"cd","cpm":1050,"f0":40,"f1":60,"min":30,"max":300,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#c4ccd6","rl":1.25,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"menshin","n":"免震タワーマンション","use":"home","u":75,"z":"cd","cpm":1150,"f0":25,"f1":50,"min":25,"max":300,"sh":["tower"],"cat":"home","c":"#bcc6d1","rl":1.35,"dm":0.95,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"stantower","n":"駅前タワーマンション","use":"home","u":70,"z":"cd","cpm":1000,"f0":25,"f1":45,"min":16,"max":200,"sh":["tower"],"opt":["shop1"],"cat":"home","c":"#c8d0d9","rl":1.2,"dm":1.1,"dn":["{}タワー","{}タワーレジデンス"]},
   {"k":"tenpoman","n":"店舗つきマンション","use":"home","u":65,"g1":"shop","z":"bcdek","cpm":620,"f0":4,"f1":12,"min":4,"max":60,"sh":["slab","L","ko","ro","full"],"cat":"home","c":"#d6cec2","rl":1.0,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"getaba","n":"下駄ばきアパート","use":"home","u":40,"g1":"shop","z":"bcdek","cpm":400,"f0":3,"f1":5,"min":2,"max":16,"sh":["full","slab","L"],"cat":"home","c":"#b7aa98","rl":0.9,"dn":["{}マンション","{}レジデンス","{}パレス"]},
   {"k":"kanban","n":"看板建築","use":"home","u":50,"g1":"shop","z":"bcdk","cpm":380,"f0":2,"f1":3,"min":1,"max":4,"sh":["full"],"cat":"home","c":"#8a9a8a"},
   {"k":"shotennaga","n":"商店長屋","use":"home","u":40,"g1":"shop","z":"bcdk","cpm":300,"f0":2,"f1":2,"min":2,"max":12,"sh":["slab","full"],"cat":"home","c":"#8f7a62","rl":0.85,"dn":["{}長屋"]},
   {"k":"complexres","n":"複合マンション","use":"home","mix":[[0.15,"shop"],[0.4,"office"],[1,"home"]],"us":{"shop":60,"office":0,"home":70},"z":"cd","cpm":750,"f0":6,"f1":20,"min":8,"max":120,"sh":["slab","L","ko","ro","full","tower"],"cat":"home","c":"#d1d4d0","rl":1.05,"dn":["{}プレイス"]},
   {"k":"konbini","n":"コンビニ","use":"shop","one":true,"z":"abcdehk","cpm":300,"f0":1,"f1":1,"min":2,"max":12,"sh":["full"],"cat":"shop","c":"#f0f0ee","rl":1.1,"dm":1.2,"dn":["{}コンビニ"]},
   {"k":"super","n":"スーパー","use":"shop","one":true,"z":"bcdek","cpm":330,"f0":1,"f1":2,"min":10,"max":200,"sh":["full"],"cat":"shop","c":"#e9d8b4","rl":1.0,"dm":1.1,"fx":{"home":0.05},"dn":["{}スーパー"]},
   {"k":"bigsuper","n":"大型スーパー","use":"shop","one":true,"z":"cde","cpm":380,"f0":1,"f1":3,"min":40,"max":600,"sh":["full","slab"],"cat":"shop","c":"#e2cfa8","dm":1.0,"fx":{"home":0.06,"shop":0.03},"dn":["{}大型スーパー"]},
   {"k":"drug","n":"ドラッグストア","use":"shop","one":true,"z":"bcdek","cpm":320,"f0":1,"f1":2,"min":4,"max":60,"sh":["full"],"cat":"shop","c":"#e7eef2","dm":1.1,"dn":["{}ドラッグストア"]},
   {"k":"kaitenzushi","n":"回転寿司","use":"shop","one":true,"z":"bcdek","cpm":400,"f0":1,"f1":2,"min":4,"max":20,"sh":["full"],"cat":"shop","c":"#e4c9a8","rl":1.05,"dm":1.15,"dn":["{}回転寿司"]},
   {"k":"dollar","n":"100円ショップ","use":"shop","one":true,"z":"bcdek","cpm":320,"f0":1,"f1":2,"min":4,"max":40,"sh":["full"],"cat":"shop","c":"#f2e0c2","rl":0.85,"dm":1.25,"dn":["{}100円ショップ"]},
   {"k":"books","n":"書店","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":3,"min":2,"max":30,"sh":["full"],"cat":"shop","c":"#d8c6a6","rl":0.9,"dm":0.95,"dn":["{}書店"]},
   {"k":"kaden","n":"家電量販店","use":"shop","one":true,"z":"cde","cpm":420,"f0":1,"f1":6,"min":20,"max":400,"sh":["full","slab"],"cat":"shop","c":"#dfe4ea","fx":{"shop":0.03},"dn":["{}家電"]},
   {"k":"homecenter","n":"ホームセンター","use":"shop","one":true,"z":"cdef","cpm":280,"f0":1,"f1":2,"min":60,"max":1200,"sh":["full","slab"],"cat":"shop","c":"#e6d9c0","rl":0.8,"dm":1.1,"dn":["{}ホームセンター"]},
   {"k":"fashion","n":"衣料品店","use":"shop","one":true,"z":"bcdk","cpm":420,"f0":1,"f1":3,"min":2,"max":40,"sh":["full"],"cat":"shop","c":"#ead7da","rl":1.05,"dn":["{}衣料品店"]},
   {"k":"depart","n":"百貨店","use":"shop","u":300,"z":"cd","cpm":900,"f0":5,"f1":12,"min":60,"max":800,"sh":["full","slab"],"cat":"shop","c":"#d8c3a5","rl":1.3,"dm":0.95,"fx":{"shop":0.12,"office":0.04},"dn":["{}百貨店","{}デパート"]},
   {"k":"fashionbldg","n":"ファッションビル","use":"shop","u":60,"z":"cd","cpm":850,"f0":5,"f1":12,"min":10,"max":200,"sh":["full","slab","tower"],"cat":"shop","c":"#e3cfd6","rl":1.3,"dm":0.95,"fx":{"shop":0.06},"dn":["{}ファッションビル"]},
   {"k":"ekibiru","n":"駅ビル","use":"shop","mix":[[0.5,"shop"],[1,"office"]],"us":{"shop":80,"office":0},"z":"cd","cpm":850,"f0":3,"f1":12,"min":10,"max":200,"sh":["full","slab"],"cat":"shop","c":"#d6ccbd","rl":1.25,"dm":1.1,"fx":{"shop":0.08},"dn":["{}駅ビル"]},
   {"k":"ekichoku","n":"駅直結ビル","use":"shop","mix":[[0.4,"shop"],[1,"office"]],"us":{"shop":100000,"office":100000},"z":"abcdefghk","cpm":700,"f0":2,"f1":30,"min":3,"max":200,"sh":["full","slab","L"],"sc":"ekichoku","self1":true,"sta":true,"cat":"shop","c":"#d3cbbd","rl":1.15,"dm":1.1,"fx":{"shop":0.05},"dn":["{}駅ビル"]},
   {"k":"famires","n":"ファミリーレストラン","use":"shop","one":true,"z":"bcdek","cpm":380,"f0":1,"f1":2,"min":4,"max":30,"sh":["full"],"cat":"shop","c":"#efc89a","dn":["{}ファミリーレストラン"]},
   {"k":"ramen","n":"ラーメン屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#d9a066","rl":1.1,"dm":1.1,"dn":["{}ラーメン屋"]},
   {"k":"soba","n":"そば屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#9c7a52","dn":["{}そば屋"]},
   {"k":"sushi","n":"寿司屋","use":"shop","one":true,"z":"bcdk","cpm":500,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#c9b08a","rl":1.4,"dm":0.85,"dn":["{}寿司屋"]},
   {"k":"kissa","n":"喫茶店","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#a47b55","rl":0.95,"dn":["{}喫茶店"]},
   {"k":"cafe","n":"カフェ","use":"shop","one":true,"z":"bcdk","cpm":450,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#b88a5e","rl":1.2,"dn":["{}カフェ"]},
   {"k":"izakaya","n":"居酒屋","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"cat":"shop","c":"#a8613e","rl":1.05,"dm":1.05,"dn":["{}居酒屋"]},
   {"k":"yakiniku","n":"焼肉店","use":"shop","one":true,"z":"bcdk","cpm":420,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"shop","c":"#8f4a35","rl":1.15,"dn":["{}焼肉店"]},
   {"k":"fastfood","n":"ファストフード店","use":"shop","one":true,"z":"bcdek","cpm":400,"f0":1,"f1":2,"min":2,"max":10,"sh":["full"],"cat":"shop","c":"#e9b44c","rl":1.05,"dm":1.15,"dn":["{}ファストフード店"]},
   {"k":"bakery","n":"パン屋","use":"shop","one":true,"z":"abcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#dcb07a","dn":["{}パン屋"]},
   {"k":"cake","n":"ケーキ屋","use":"shop","one":true,"z":"abcdk","cpm":420,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#efd1d6","rl":1.15,"dm":0.9,"dn":["{}ケーキ屋"]},
   {"k":"wagashi","n":"和菓子屋","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#b98f7a","dn":["{}和菓子屋"]},
   {"k":"flower","n":"花屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":1,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#e6b8c8","rl":0.9,"dn":["{}花屋"]},
   {"k":"yaoya","n":"八百屋","use":"shop","one":true,"z":"bcdk","cpm":280,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#9fbf6f","rl":0.85,"dm":1.05,"dn":["{}八百屋"]},
   {"k":"sakanaya","n":"魚屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#8fb3c4","rl":0.85,"dn":["{}魚屋"]},
   {"k":"nikuya","n":"肉屋","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#c47f74","rl":0.85,"dn":["{}肉屋"]},
   {"k":"sakaya","n":"酒屋","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#a3866a","rl":0.95,"dn":["{}酒屋"]},
   {"k":"zakka","n":"雑貨店","use":"shop","one":true,"z":"bcdk","cpm":380,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#e0cdb5","rl":1.05,"dn":["{}雑貨店"]},
   {"k":"stationery","n":"文房具店","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#c8cfd8","rl":0.85,"dn":["{}文房具店"]},
   {"k":"toy","n":"おもちゃ屋","use":"shop","one":true,"z":"bcdk","cpm":350,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"cat":"shop","c":"#f0c56a","rl":0.95,"dn":["{}おもちゃ屋"]},
   {"k":"megane","n":"メガネ・時計店","use":"shop","one":true,"z":"bcdk","cpm":450,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#b9c2cc","rl":1.2,"dm":0.85,"dn":["{}メガネ・時計店"]},
   {"k":"bicycle","n":"自転車店","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#9fb6a0","rl":0.9,"dn":["{}自転車店"]},
   {"k":"furuhon","n":"古本屋","use":"shop","one":true,"z":"bcdk","cpm":280,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#a69276","rl":0.8,"dn":["{}古本屋"]},
   {"k":"shichiya","n":"質屋","use":"shop","one":true,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#8d8476","rl":1.1,"dm":0.8,"dn":["{}質屋"]},
   {"k":"pharmacy","n":"調剤薬局","use":"shop","one":true,"z":"abcdek","cpm":380,"f0":1,"f1":2,"min":1,"max":6,"sh":["full"],"cat":"shop","c":"#dfeaf0","rl":1.1,"dm":1.05,"dn":["{}調剤薬局"]},
   {"k":"biyou","n":"美容室","use":"shop","one":true,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":1,"max":4,"sh":["full"],"cat":"shop","c":"#e9c9d3","rl":1.05,"dn":["{}美容室"]},
   {"k":"riyou","n":"理容室","use":"shop","one":true,"z":"bcdk","cpm":320,"f0":1,"f1":2,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#c2d0e0","rl":0.85,"dn":["{}理容室"]},
   {"k":"cleaning","n":"クリーニング店","use":"shop","one":true,"z":"bcdk","cpm":300,"f0":1,"f1":2,"min":1,"max":3,"sh":["full"],"cat":"shop","c":"#d3e2ea","rl":0.85,"dn":["{}クリーニング店"]},
   {"k":"dealer","n":"カーディーラー","use":"shop","one":true,"z":"cdef","cpm":450,"f0":1,"f1":2,"min":10,"max":100,"sh":["full"],"cat":"shop","c":"#c9d4de","rl":1.3,"dm":0.8,"dn":["{}自動車販売"]},
   {"k":"gas","n":"ガソリンスタンド","use":"shop","one":true,"z":"bcdefghk","cpm":350,"f0":1,"f1":1,"min":6,"max":40,"sh":["full"],"cat":"shop","c":"#e4dfcf","rl":1.0,"dn":["{}給油所"]},
   {"k":"arcadeshop","n":"商店街（アーケード）","use":"shop","u":40,"z":"bcdk","cpm":400,"f0":1,"f1":2,"min":6,"max":120,"sh":["slab","full"],"cat":"shop","c":"#d9c3a1","rl":0.95,"dm":1.1,"fx":{"shop":0.05},"dn":["{}商店街"]},
   {"k":"outlet","n":"アウトレットモール","use":"shop","u":120,"z":"cdeh","cpm":400,"f0":1,"f1":2,"min":200,"max":1600,"sh":["full","slab","ro"],"cat":"shop","c":"#e7d6bd","rl":0.9,"fx":{"hotel":0.05},"dn":["{}アウトレット"]},
   {"k":"michinoeki","n":"道の駅","use":"shop","u":60,"z":"hi","cpm":300,"f0":1,"f1":1,"min":20,"max":400,"sh":["full","slab"],"cat":"shop","c":"#cdb98f","rl":0.8,"dm":1.2,"dn":["道の駅 {}"]},
   {"k":"ichiba","n":"市場","use":"shop","u":25,"z":"cdegk","cpm":250,"f0":1,"f1":1,"min":10,"max":200,"sh":["full","slab"],"cat":"shop","c":"#c9b48e","rl":0.8,"dm":1.15,"dn":["{}市場"]},
   {"k":"yatai","n":"屋台村","use":"shop","u":12,"z":"bcdk","cpm":200,"f0":1,"f1":1,"min":4,"max":60,"sh":["full"],"cat":"shop","c":"#b7865c","rl":0.75,"dm":1.2,"dn":["{}屋台村"]},
   {"k":"smalloffice","n":"小さなオフィスビル","use":"office","u":0,"z":"cde","cpm":600,"f0":3,"f1":6,"min":2,"max":20,"sh":["full","slab"],"cat":"biz","c":"#b9c4cf","rl":0.9,"dn":["{}ビル"]},
   {"k":"pencil","n":"ペンシルビル","use":"office","u":0,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":12,"min":1,"max":4,"sh":["full"],"cat":"biz","c":"#c0c8d0","rl":0.95,"dn":["{}ビル"]},
   {"k":"midoffice","n":"中規模オフィスビル","use":"office","u":0,"z":"cd","cpm":820,"f0":8,"f1":20,"min":10,"max":160,"sh":["full","slab","L"],"cat":"biz","c":"#aab8c8","dn":["{}ビル","{}センタービル"]},
   {"k":"bigoffice","n":"大規模オフィスビル","use":"office","u":0,"z":"d","cpm":900,"f0":15,"f1":35,"min":40,"max":400,"sh":["full","slab","L","tower"],"opt":["shop1"],"cat":"biz","c":"#a2b2c5","rl":1.1,"dn":["{}センタービル","{}ビルディング"]},
   {"k":"hq","n":"本社ビル","use":"office","u":0,"z":"cd","cpm":1000,"f0":10,"f1":40,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#8fa2b8","rl":1.25,"dm":0.9,"dn":["{}本社ビル"]},
   {"k":"intelligent","n":"インテリジェントビル","use":"office","u":0,"z":"cd","cpm":1150,"f0":10,"f1":40,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#9cb6cc","rl":1.35,"dm":0.95,"dn":["{}インテリジェントビル"]},
   {"k":"skyoffice","n":"超高層オフィスビル","use":"office","u":0,"g1":"shop","g2":"shop","z":"d","cpm":1300,"f0":40,"f1":70,"min":40,"max":600,"sh":["tower"],"cat":"biz","c":"#8ea8c4","rl":1.3,"fx":{"office":0.05,"shop":0.04},"dn":["{}タワー","{}スカイタワー"]},
   {"k":"complex","n":"複合ビル","use":"office","u":0,"mix":[[0.25,"shop"],[1,"office"]],"us":{"shop":60,"office":0},"z":"cd","cpm":900,"f0":6,"f1":25,"min":8,"max":200,"sh":["full","slab","tower"],"cat":"biz","c":"#b3bfca","rl":1.1,"dn":["{}スクエア"]},
   {"k":"it","n":"ITオフィス","use":"office","u":0,"z":"cd","cpm":850,"f0":5,"f1":20,"min":6,"max":120,"sh":["full","slab"],"cat":"biz","c":"#a8c3cf","rl":1.1,"dm":1.1,"pp":1.2,"dn":["{}ITオフィス"]},
   {"k":"startup","n":"スタートアップビル","use":"office","u":30,"z":"cd","cpm":650,"f0":3,"f1":8,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#bccad0","rl":0.95,"dm":1.15,"dn":["{}スタートアップビル"]},
   {"k":"coworking","n":"コワーキングスペース","use":"office","u":20,"z":"cd","cpm":700,"f0":2,"f1":8,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#c7d3d8","rl":1.15,"dm":1.05,"pp":1.3,"dn":["{}コワーキングスペース"]},
   {"k":"rentalmtg","n":"貸会議室ビル","use":"office","u":40,"z":"cd","cpm":700,"f0":3,"f1":12,"min":2,"max":60,"sh":["full","slab"],"cat":"biz","c":"#bdc6cf","dn":["{}貸会議室ビル"]},
   {"k":"lawoffice","n":"法律事務所ビル","use":"office","u":60,"z":"cd","cpm":750,"f0":3,"f1":10,"min":2,"max":40,"sh":["full","slab"],"cat":"biz","c":"#a9b1bb","rl":1.15,"dn":["{}法律事務所ビル"]},
   {"k":"ad","n":"広告代理店ビル","use":"office","u":0,"z":"cd","cpm":950,"f0":6,"f1":25,"min":10,"max":200,"sh":["full","slab","tower"],"cat":"biz","c":"#b6a9c4","rl":1.2,"dn":["{}広告代理店ビル"]},
   {"k":"publisher","n":"出版社","use":"office","u":0,"z":"cd","cpm":800,"f0":4,"f1":12,"min":4,"max":80,"sh":["full","slab"],"cat":"biz","c":"#b5b0a5","dn":["{}出版"]},
   {"k":"newspaper","n":"新聞社","use":"office","u":0,"z":"cd","cpm":900,"f0":6,"f1":20,"min":10,"max":200,"sh":["full","slab"],"cat":"biz","c":"#a7a39a","rl":1.05,"dn":["{}新聞社"]},
   {"k":"tvstation","n":"放送局","use":"office","u":0,"z":"cd","cpm":1100,"f0":5,"f1":30,"min":40,"max":600,"sh":["full","slab","tower"],"cat":"biz","c":"#9bb0c6","rl":1.3,"dm":0.8,"fx":{"office":0.05},"dn":["{}放送センター"]},
   {"k":"bankhq","n":"銀行の本店","use":"office","u":0,"z":"cd","cpm":1150,"f0":8,"f1":30,"min":20,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#94a1ad","rl":1.35,"dm":0.85,"fx":{"office":0.05},"dn":["{}銀行本店"]},
   {"k":"bankbranch","n":"銀行の支店","use":"office","u":0,"z":"bcdk","cpm":800,"f0":2,"f1":5,"min":2,"max":30,"sh":["full"],"cat":"biz","c":"#a5b0ba","rl":1.1,"dn":["{}支店"]},
   {"k":"shinkin","n":"信用金庫","use":"office","u":0,"z":"bcdk","cpm":700,"f0":2,"f1":4,"min":2,"max":30,"sh":["full"],"cat":"biz","c":"#a9b6b0","dn":["{}信用金庫"]},
   {"k":"securities","n":"証券会社","use":"office","u":0,"z":"cd","cpm":1000,"f0":6,"f1":25,"min":6,"max":160,"sh":["full","slab"],"cat":"biz","c":"#9eaabd","rl":1.25,"dn":["{}証券ビル"]},
   {"k":"insurance","n":"保険会社","use":"office","u":0,"z":"cd","cpm":950,"f0":8,"f1":30,"min":10,"max":300,"sh":["full","slab","tower"],"cat":"biz","c":"#a3b4c0","rl":1.1,"dn":["{}生命ビル"]},
   {"k":"postoffice","n":"郵便局","use":"office","u":0,"z":"abcdek","cpm":600,"f0":1,"f1":4,"min":4,"max":60,"sh":["full","slab"],"cat":"biz","c":"#d98a7a","rl":0.9,"dm":1.2,"dn":["{}郵便局"]},
   {"k":"travel","n":"旅行代理店ビル","use":"office","u":0,"z":"cd","cpm":700,"f0":2,"f1":6,"min":2,"max":30,"sh":["full","slab"],"cat":"biz","c":"#b9cbd6","rl":0.95,"fx":{"hotel":0.03},"dn":["{}旅行代理店ビル"]},
   {"k":"lab","n":"研究所","use":"office","u":0,"z":"cdef","cpm":750,"f0":2,"f1":8,"min":20,"max":800,"sh":["full","slab"],"cat":"biz","c":"#b7c2b7","rl":0.9,"dm":1.05,"dn":["{}研究所"]},
   {"k":"datacenter","n":"データセンター","use":"office","u":0,"z":"cdef","cpm":1100,"f0":2,"f1":6,"min":20,"max":600,"sh":["full","slab"],"cat":"biz","c":"#7f8d99","rl":1.2,"dm":1.1,"pp":0.1,"dn":["{}データセンター"]},
   {"k":"callcenter","n":"コールセンター","use":"office","u":0,"z":"cde","cpm":650,"f0":3,"f1":10,"min":10,"max":200,"sh":["full","slab"],"cat":"biz","c":"#b0bcc8","rl":0.85,"dm":1.1,"pp":1.5,"dn":["{}コールセンター"]},
   {"k":"bizhotel","n":"ビジネスホテル","use":"hotel","one":true,"z":"cde","cpm":700,"f0":5,"f1":15,"min":3,"max":60,"sh":["full","slab","tower"],"sc":"bizhotel","cat":"hotel","c":"#c9b9a8","dn":["ホテル{}","{}ホテル"]},
   {"k":"stahotel","n":"駅前ホテル","use":"hotel","one":true,"z":"cd","cpm":750,"f0":6,"f1":20,"min":4,"max":80,"sh":["full","slab","tower"],"sc":"stahotel","cat":"hotel","c":"#c2b4a4","dn":["{}駅前ホテル"]},
   {"k":"cityhotel","n":"シティホテル","use":"hotel","one":true,"z":"cd","cpm":900,"f0":8,"f1":30,"min":20,"max":300,"sh":["full","slab","L","tower"],"sc":"cityhotel","cat":"hotel","c":"#b8a48c","dn":["{}シティホテル","ホテル{}"]},
   {"k":"luxhotel","n":"高級ホテル","use":"hotel","one":true,"z":"cd","cpm":1400,"f0":10,"f1":50,"min":30,"max":400,"sh":["tower","full","slab"],"sc":"luxhotel","cat":"hotel","c":"#a38d6f","fx":{"shop":0.04},"dn":["ホテル{}","グランドホテル{}"]},
   {"k":"resort","n":"リゾートホテル","use":"hotel","one":true,"z":"abhik","cpm":900,"f0":3,"f1":15,"min":40,"max":1600,"sh":["slab","L","ko","full"],"sc":"resort","cat":"hotel","c":"#d6c6a2","fx":{"shop":0.03},"dn":["{}リゾートホテル"]},
   {"k":"ryokan","n":"旅館","use":"hotel","one":true,"z":"abchik","cpm":650,"f0":1,"f1":4,"min":6,"max":200,"sh":["L","ko","full"],"sc":"ryokan","cat":"hotel","c":"#6f6658","dn":["旅館 {}","{}旅館"]},
   {"k":"onsenryokan","n":"温泉旅館","use":"hotel","one":true,"z":"hi","cpm":800,"f0":2,"f1":8,"min":10,"max":400,"sh":["L","ko","full"],"sc":"onsenryokan","cat":"hotel","c":"#5f5a52","dn":["{}温泉旅館"]},
   {"k":"minshuku","n":"民宿","use":"hotel","one":true,"z":"abhik","cpm":350,"f0":1,"f1":3,"min":2,"max":30,"sh":["full","L"],"sc":"minshuku","cat":"hotel","c":"#8c7a62","dn":["民宿 {}"]},
   {"k":"pension","n":"ペンション","use":"hotel","one":true,"z":"ahik","cpm":450,"f0":2,"f1":3,"min":3,"max":30,"sh":["full","L"],"sc":"pension","cat":"hotel","c":"#b5876a","dn":["ペンション {}"]},
   {"k":"capsule","n":"カプセルホテル","use":"hotel","one":true,"z":"cd","cpm":650,"f0":3,"f1":10,"min":1,"max":20,"sh":["full"],"sc":"capsule","cat":"hotel","c":"#b9c0c6","dn":["{}カプセルホテル"]},
   {"k":"guesthouse","n":"ゲストハウス","use":"hotel","one":true,"z":"bcdk","cpm":400,"f0":2,"f1":4,"min":1,"max":10,"sh":["full"],"sc":"guesthouse","cat":"hotel","c":"#c4a98a","dn":["ゲストハウス {}"]},
   {"k":"condo","n":"コンドミニアム","use":"hotel","one":true,"z":"cdh","cpm":900,"f0":5,"f1":30,"min":10,"max":200,"sh":["slab","L","tower","full"],"sc":"condo","cat":"hotel","c":"#cbc3b3","dn":["{}コンドミニアム"]},
   {"k":"clinic","n":"診療所","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":4,"min":1,"max":10,"sh":["full"],"sc":"clinic","cat":"med","c":"#e3ecef","dn":["{}クリニック"]},
   {"k":"dental","n":"歯科医院","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"sc":"dental","cat":"med","c":"#e9f0f2","dn":["{}歯科医院"]},
   {"k":"pedi","n":"小児科医院","use":"hospital","one":true,"z":"abcdek","cpm":550,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"sc":"pedi","cat":"med","c":"#f0e7d8","fx":{"home":0.03},"dn":["{}こどもクリニック"]},
   {"k":"eye","n":"眼科","use":"hospital","one":true,"z":"abcdek","cpm":600,"f0":1,"f1":3,"min":1,"max":8,"sh":["full"],"sc":"eye","cat":"med","c":"#dfe8ef","dn":["{}眼科"]},
   {"k":"vet","n":"動物病院","use":"hospital","one":true,"z":"abcdek","cpm":550,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"sc":"vet","cat":"med","c":"#e2ead9","dn":["{}動物病院"]},
   {"k":"obgyn","n":"産婦人科","use":"hospital","one":true,"z":"bcdek","cpm":800,"f0":2,"f1":6,"min":4,"max":40,"sh":["full","slab"],"sc":"obgyn","cat":"med","c":"#f0dfe2","dn":["{}レディースクリニック"]},
   {"k":"hospital","n":"総合病院","use":"hospital","one":true,"z":"bcdek","cpm":1000,"f0":4,"f1":15,"min":30,"max":600,"sh":["full","slab","L","tower"],"sc":"hospital","cat":"med","c":"#e8eef2","fx":{"home":0.05,"shop":0.03},"dn":["{}総合病院"]},
   {"k":"erhosp","n":"救急病院","use":"hospital","one":true,"z":"bcdek","cpm":1100,"f0":4,"f1":12,"min":20,"max":400,"sh":["full","slab","L"],"sc":"erhosp","cat":"med","c":"#e6e1e1","fx":{"home":0.04},"dn":["{}救急病院"]},
   {"k":"bighosp","n":"大病院","use":"hospital","one":true,"z":"bcdehk","cpm":1200,"f0":8,"f1":30,"min":80,"max":1600,"sh":["full","slab","L","ko","tower"],"sc":"bighosp","cat":"med","c":"#dfe7ec","fx":{"home":0.06,"shop":0.04},"dn":["{}医療センター"]},
   {"k":"nursing","n":"老人ホーム","use":"hospital","one":true,"z":"abcdehk","cpm":600,"f0":2,"f1":8,"min":6,"max":200,"sh":["full","slab","L"],"sc":"nursing","cat":"med","c":"#e4dccd","dn":["{}老人ホーム"]},
   {"k":"care","n":"介護施設","use":"hospital","one":true,"z":"abcdehk","cpm":550,"f0":1,"f1":4,"min":4,"max":120,"sh":["full","slab","L"],"sc":"care","cat":"med","c":"#ded7c8","dn":["{}介護センター"]},
   {"k":"dayserv","n":"デイサービスセンター","use":"hospital","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":2,"max":30,"sh":["full"],"sc":"dayserv","cat":"med","c":"#e8e0cf","dn":["デイサービス{}"]},
   {"k":"cinema","n":"映画館","use":"leisure","one":true,"z":"cde","cpm":800,"f0":2,"f1":8,"min":10,"max":200,"sh":["full","slab"],"sc":"cinema","cat":"fun","c":"#5c5f6e","dn":["{}シネマ"]},
   {"k":"theater","n":"劇場","use":"leisure","one":true,"z":"cd","cpm":1000,"f0":3,"f1":10,"min":20,"max":300,"sh":["full","slab"],"sc":"theater","cat":"fun","c":"#8a4f45","fx":{"shop":0.03},"dn":["{}劇場"]},
   {"k":"hall","n":"コンサートホール","use":"leisure","one":true,"z":"cd","cpm":1000,"f0":3,"f1":10,"min":20,"max":400,"sh":["full","slab"],"sc":"hall","cat":"fun","c":"#9b7b63","dn":["{}ホール"]},
   {"k":"livehouse","n":"ライブハウス","use":"leisure","one":true,"z":"cd","cpm":600,"f0":1,"f1":4,"min":2,"max":20,"sh":["full"],"sc":"livehouse","cat":"fun","c":"#4f4a55","dn":["ライブハウス{}"]},
   {"k":"bowling","n":"ボウリング場","use":"leisure","one":true,"z":"cde","cpm":500,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"bowling","cat":"fun","c":"#c96d5a","dn":["{}ボウル"]},
   {"k":"arcade","n":"ゲームセンター","use":"leisure","one":true,"z":"cd","cpm":550,"f0":1,"f1":4,"min":2,"max":60,"sh":["full"],"sc":"arcade","cat":"fun","c":"#d77fb0","dn":["ゲーム{}"]},
   {"k":"karaoke","n":"カラオケ店","use":"leisure","one":true,"z":"cd","cpm":600,"f0":2,"f1":8,"min":2,"max":40,"sh":["full"],"sc":"karaoke","cat":"fun","c":"#c98bd6","dn":["カラオケ{}"]},
   {"k":"pachinko","n":"パチンコ店","use":"leisure","one":true,"z":"cde","cpm":600,"f0":1,"f1":3,"min":6,"max":120,"sh":["full","slab"],"sc":"pachinko","cat":"fun","c":"#e3a83a","fx":{"home":-0.03},"dn":["{}ホール"]},
   {"k":"kbshop","n":"場外馬券売り場","use":"leisure","one":true,"z":"cdef","cpm":700,"f0":2,"f1":8,"min":20,"max":400,"sh":["full","slab"],"sc":"kbshop","cat":"fun","c":"#5f8a62","fx":{"shop":0.03},"dn":["{}場外馬券売り場"]},
   {"k":"batting","n":"バッティングセンター","use":"leisure","one":true,"z":"cdefh","cpm":300,"f0":1,"f1":1,"min":10,"max":120,"sh":["full"],"sc":"batting","cat":"fun","c":"#7fae7a","dn":["{}バッティングセンター"]},
   {"k":"sportsclub","n":"スポーツクラブ","use":"leisure","one":true,"z":"bcdk","cpm":700,"f0":2,"f1":6,"min":4,"max":80,"sh":["full","slab"],"sc":"sportsclub","cat":"fun","c":"#7aa3c8","dn":["{}スポーツクラブ"]},
   {"k":"pool","n":"屋内プール","use":"leisure","one":true,"z":"bcdek","cpm":800,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"pool","cat":"fun","c":"#7cc2d8","dn":["{}プール"]},
   {"k":"skate","n":"スケートリンク","use":"leisure","one":true,"z":"cde","cpm":800,"f0":1,"f1":2,"min":20,"max":200,"sh":["full","slab"],"sc":"skate","cat":"fun","c":"#a9d4e6","dn":["{}スケートリンク"]},
   {"k":"superonsen","n":"スーパー銭湯","use":"leisure","one":true,"z":"cdeh","cpm":600,"f0":1,"f1":3,"min":10,"max":200,"sh":["full","slab"],"sc":"superonsen","cat":"fun","c":"#b78d6c","dn":["{}の湯"]},
   {"k":"sento","n":"銭湯","use":"leisure","one":true,"z":"abcdek","cpm":400,"f0":1,"f1":2,"min":1,"max":8,"sh":["full"],"sc":"sento","cat":"fun","c":"#7d9bb0","dn":["{}湯"]},
   {"k":"wedding","n":"結婚式場","use":"leisure","one":true,"z":"bcdhk","cpm":1000,"f0":2,"f1":6,"min":10,"max":200,"sh":["full","L","ko"],"sc":"wedding","cat":"fun","c":"#efe6da","dn":["{}迎賓館","{}会館"]},
   {"k":"arena","n":"アリーナ","use":"leisure","one":true,"z":"cde","cpm":900,"f0":2,"f1":5,"min":60,"max":800,"sh":["full","ro"],"sc":"arena","cat":"fun","c":"#a7b0b8","fx":{"shop":0.04,"hotel":0.04},"dn":["{}アリーナ"]},
   {"k":"baseball","n":"野球場","use":"leisure","one":true,"z":"cdeh","cpm":700,"f0":1,"f1":2,"min":300,"max":1600,"sh":["ro","full"],"sc":"baseball","cat":"fun","c":"#6fa35a","fx":{"shop":0.05,"hotel":0.05},"dn":["{}球場","{}スタジアム"]},
   {"k":"soccer","n":"サッカースタジアム","use":"leisure","one":true,"z":"cdeh","cpm":700,"f0":1,"f1":2,"min":300,"max":1600,"sh":["ro","full"],"sc":"soccer","cat":"fun","c":"#5f9a62","fx":{"shop":0.05,"hotel":0.05},"dn":["{}スタジアム"]},
   {"k":"convention","n":"展示場","use":"leisure","one":true,"z":"cdefgk","cpm":700,"f0":1,"f1":4,"min":100,"max":1600,"sh":["full","slab"],"sc":"convention","cat":"fun","c":"#b7c0c9","fx":{"hotel":0.12,"shop":0.04},"dn":["{}国際展示場","{}メッセ"]},
   {"k":"aquarium","n":"水族館","use":"leisure","one":true,"z":"cdgk","cpm":1200,"f0":2,"f1":5,"min":30,"max":400,"sh":["full","slab","L"],"sc":"aquarium","cat":"fun","c":"#5f9fc2","fx":{"hotel":0.08},"dn":["{}水族館"]},
   {"k":"artmuseum","n":"美術館","use":"leisure","one":true,"z":"abcdek","cpm":1100,"f0":2,"f1":5,"min":20,"max":400,"sh":["full","L","ko"],"sc":"artmuseum","cat":"fun","c":"#d0c8bc","dn":["{}美術館"]},
   {"k":"museum","n":"博物館","use":"leisure","one":true,"z":"abcdek","cpm":1000,"f0":2,"f1":6,"min":20,"max":400,"sh":["full","L","ko"],"sc":"museum","cat":"fun","c":"#bcb3a4","dn":["{}博物館"]},
   {"k":"science","n":"科学館","use":"leisure","one":true,"z":"bcdek","cpm":1000,"f0":2,"f1":5,"min":20,"max":300,"sh":["full","L"],"sc":"science","cat":"fun","c":"#a7bccb","dn":["{}科学館"]},
   {"k":"shrine","n":"神社","use":"leisure","one":true,"z":"abcdehik","cpm":600,"f0":1,"f1":1,"min":4,"max":400,"sh":["full","L"],"sc":"shrine","cat":"fun","c":"#c0392b","dn":["{}神社"]},
   {"k":"temple","n":"寺","use":"leisure","one":true,"z":"abcdehik","cpm":700,"f0":1,"f1":2,"min":6,"max":600,"sh":["full","L","ko"],"sc":"temple","cat":"fun","c":"#5a5550","dn":["{}寺","{}院"]},
   {"k":"church","n":"教会","use":"leisure","one":true,"z":"abcdek","cpm":800,"f0":1,"f1":3,"min":2,"max":60,"sh":["full"],"sc":"church","cat":"fun","c":"#d9d4cc","dn":["{}教会"]},
   {"k":"golfrange","n":"ゴルフ練習場","use":"leisure","one":true,"z":"cdefh","cpm":120,"f0":0,"f1":0,"min":40,"max":600,"sh":["full"],"sc":"golfrange","cat":"fun","c":"#86bf6a","pat":"lawn","dn":["{}ゴルフガーデン"]},
   {"k":"golf","n":"ゴルフ場","use":"leisure","one":true,"z":"hi","cpm":60,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"golf","cat":"fun","c":"#78b05e","fx":{"hotel":0.05},"pat":"golf","dn":["{}カントリークラブ"]},
   {"k":"tennis","n":"テニスコート","use":"leisure","one":true,"z":"abcdehk","cpm":100,"f0":0,"f1":0,"min":6,"max":200,"sh":["full"],"sc":"tennis","cat":"fun","c":"#5f9e6e","pat":"court","dn":["{}テニスクラブ"]},
   {"k":"athletics","n":"陸上競技場","use":"leisure","one":true,"z":"bcdehk","cpm":200,"f0":0,"f1":0,"min":200,"max":1600,"sh":["full"],"sc":"athletics","cat":"fun","c":"#93c56a","pat":"track","dn":["{}陸上競技場"]},
   {"k":"amuse","n":"遊園地","use":"leisure","one":true,"z":"cdeh","cpm":300,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"amuse","cat":"fun","c":"#e6c3d6","fx":{"hotel":0.15,"shop":0.04},"pat":"amuse","dn":["{}ランド","{}遊園地"]},
   {"k":"tpark","n":"テーマパーク","use":"leisure","one":true,"z":"cdefgh","cpm":500,"f0":0,"f1":0,"min":3000,"max":10000,"sh":["full"],"sc":"tpark","cat":"fun","c":"#efc7de","fx":{"hotel":0.3,"shop":0.08},"pat":"tpark","dn":["{}ランド","{}パーク"]},
   {"k":"zoo","n":"動物園","use":"leisure","one":true,"z":"abcdehk","cpm":150,"f0":0,"f1":0,"min":200,"max":1600,"sh":["full"],"sc":"zoo","cat":"fun","c":"#a9c98a","fx":{"hotel":0.06},"pat":"trees","dn":["{}動物園"]},
   {"k":"botanical","n":"植物園","use":"leisure","one":true,"z":"abcdehk","cpm":100,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"botanical","cat":"fun","c":"#9fcf8f","pat":"trees","dn":["{}植物園"]},
   {"k":"camp","n":"キャンプ場","use":"leisure","one":true,"z":"hi","cpm":30,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"camp","cat":"fun","c":"#7fb070","pat":"trees","dn":["{}キャンプ場"]},
   {"k":"fishing","n":"釣り堀","use":"leisure","one":true,"z":"cdeh","cpm":80,"f0":0,"f1":0,"min":10,"max":200,"sh":["full"],"sc":"fishing","cat":"fun","c":"#7fb8d4","pat":"water","dn":["{}釣り堀"]},
   {"k":"ski","n":"スキー場","use":"leisure","one":true,"z":"i","cpm":80,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"sc":"ski","cat":"fun","c":"#eef3f6","fx":{"hotel":0.1},"pat":"snow","dn":["{}スキー場"]},
   {"k":"nursery","n":"保育園","use":"school","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":2,"max":20,"sh":["full","L"],"sc":"nursery","cat":"school","c":"#f2d49b","fx":{"home":0.03},"dn":["{}保育園"]},
   {"k":"kinder","n":"幼稚園","use":"school","one":true,"z":"abcdek","cpm":450,"f0":1,"f1":2,"min":3,"max":30,"sh":["full","L"],"sc":"kinder","cat":"school","c":"#f5c98a","fx":{"home":0.03},"dn":["{}幼稚園"]},
   {"k":"esjhs","n":"小中一貫校","use":"school","one":true,"z":"abcek","cpm":380,"f0":2,"f1":5,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"esjhs","cat":"school","c":"#d4b07a","fx":{"home":0.04},"dn":["{}学園"]},
   {"k":"jhshs","n":"中高一貫校","use":"school","one":true,"z":"abcdek","cpm":420,"f0":2,"f1":6,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"jhshs","cat":"school","c":"#b9935f","dn":["{}学院","{}学園"]},
   {"k":"techhs","n":"工業高校","use":"school","one":true,"z":"bcdefk","cpm":400,"f0":2,"f1":5,"min":30,"max":800,"sh":["full","slab","L"],"sc":"techhs","cat":"school","c":"#a98e6c","dn":["{}工業高校"]},
   {"k":"comhs","n":"商業高校","use":"school","one":true,"z":"bcdek","cpm":400,"f0":2,"f1":5,"min":20,"max":600,"sh":["full","slab","L"],"sc":"comhs","cat":"school","c":"#b49a72","dn":["{}商業高校"]},
   {"k":"jc","n":"短期大学","use":"school","one":true,"z":"abcdek","cpm":500,"f0":2,"f1":8,"min":20,"max":600,"sh":["full","slab","L","ko"],"sc":"jc","cat":"school","c":"#b07a5e","dn":["{}短期大学"]},
   {"k":"cram","n":"学習塾","use":"school","one":true,"z":"bcdk","cpm":500,"f0":2,"f1":5,"min":1,"max":10,"sh":["full"],"sc":"cram","cat":"school","c":"#c8b3d6","dn":["{}ゼミナール"]},
   {"k":"prep","n":"予備校","use":"school","one":true,"z":"cd","cpm":650,"f0":4,"f1":12,"min":4,"max":60,"sh":["full","slab"],"sc":"prep","cat":"school","c":"#b2a3c9","dn":["{}予備校"]},
   {"k":"eikaiwa","n":"英会話教室","use":"school","one":true,"z":"bcdk","cpm":500,"f0":1,"f1":3,"min":1,"max":6,"sh":["full"],"sc":"eikaiwa","cat":"school","c":"#a9c3df","dn":["{}英会話スクール"]},
   {"k":"music","n":"音楽学校","use":"school","one":true,"z":"bcdek","cpm":700,"f0":2,"f1":6,"min":6,"max":100,"sh":["full","slab","L"],"sc":"music","cat":"school","c":"#c7a9b8","dn":["{}音楽学院"]},
   {"k":"cook","n":"調理師学校","use":"school","one":true,"z":"bcdek","cpm":650,"f0":2,"f1":6,"min":4,"max":80,"sh":["full","slab"],"sc":"cook","cat":"school","c":"#d9b48f","dn":["{}調理師学校"]},
   {"k":"driving","n":"自動車教習所","use":"school","one":true,"z":"cdefh","cpm":80,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"sc":"driving","cat":"school","c":"#c9c9c9","pat":"course","dn":["{}自動車教習所"]},
   {"k":"machikoba","n":"町工場","use":"factory","one":true,"z":"bcefk","cpm":220,"f0":1,"f1":2,"min":1,"max":10,"sh":["full","slab"],"cat":"ind","c":"#a9a49a","rl":0.9,"dm":1.1,"fx":{"home":-0.02},"dn":["{}製作所"]},
   {"k":"print","n":"印刷工場","use":"factory","one":true,"z":"cef","cpm":280,"f0":1,"f1":3,"min":6,"max":200,"sh":["full","slab"],"cat":"ind","c":"#b4b8bd","dn":["{}印刷"]},
   {"k":"textile","n":"繊維工場","use":"factory","one":true,"z":"ef","cpm":240,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#c2b8c6","rl":0.9,"dn":["{}紡績"]},
   {"k":"paper","n":"製紙工場","use":"factory","one":true,"z":"fgk","cpm":260,"f0":1,"f1":2,"min":60,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#c9c4b5","rl":0.95,"fx":{"home":-0.05},"dn":["{}製紙"]},
   {"k":"machine","n":"機械工場","use":"factory","one":true,"z":"ef","cpm":280,"f0":1,"f1":2,"min":20,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#a6adb3","rl":1.05,"dn":["{}機械"]},
   {"k":"metal","n":"金属加工工場","use":"factory","one":true,"z":"ef","cpm":270,"f0":1,"f1":2,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#9ca3a8","fx":{"home":-0.04},"dn":["{}金属"]},
   {"k":"parts","n":"部品工場","use":"factory","one":true,"z":"ef","cpm":280,"f0":1,"f1":3,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#adb5ba","rl":1.05,"dn":["{}工業"]},
   {"k":"precision","n":"精密機械工場","use":"factory","one":true,"z":"ef","cpm":380,"f0":1,"f1":4,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#c3ccd3","rl":1.25,"dm":0.95,"dn":["{}精機"]},
   {"k":"pharma","n":"薬品工場","use":"factory","one":true,"z":"ef","cpm":420,"f0":1,"f1":4,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#d6e2e6","rl":1.3,"dn":["{}製薬"]},
   {"k":"cosme","n":"化粧品工場","use":"factory","one":true,"z":"ef","cpm":380,"f0":1,"f1":3,"min":10,"max":400,"sh":["full","slab"],"cat":"ind","c":"#e6d3dc","rl":1.2,"dn":["{}化粧品"]},
   {"k":"beverage","n":"飲料工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":3,"min":40,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#b9d1db","rl":1.05,"dn":["{}飲料"]},
   {"k":"beer","n":"ビール工場","use":"factory","one":true,"z":"efh","cpm":320,"f0":1,"f1":3,"min":60,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#d8b26a","rl":1.1,"fx":{"hotel":0.02},"dn":["{}ビール"]},
   {"k":"sake","n":"酒蔵","use":"factory","one":true,"z":"bcefhk","cpm":350,"f0":1,"f1":2,"min":4,"max":100,"sh":["full","L"],"cat":"ind","c":"#4d4a46","rl":1.15,"dm":0.9,"dn":["{}酒造"]},
   {"k":"confect","n":"製菓工場","use":"factory","one":true,"z":"ef","cpm":300,"f0":1,"f1":3,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#e9cfae","rl":1.05,"dn":["{}製菓"]},
   {"k":"breadf","n":"パン工場","use":"factory","one":true,"z":"ef","cpm":290,"f0":1,"f1":2,"min":10,"max":400,"sh":["full","slab"],"cat":"ind","c":"#e4c491","dn":["{}製パン"]},
   {"k":"frozen","n":"冷凍食品工場","use":"factory","one":true,"z":"ef","cpm":330,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#c8dbe4","rl":1.05,"dn":["{}食品"]},
   {"k":"furniture","n":"家具工場","use":"factory","one":true,"z":"ef","cpm":260,"f0":1,"f1":2,"min":10,"max":600,"sh":["full","slab"],"cat":"ind","c":"#a98c6c","rl":0.95,"dn":["{}木工"]},
   {"k":"glass","n":"ガラス工場","use":"factory","one":true,"z":"ef","cpm":290,"f0":1,"f1":2,"min":20,"max":800,"sh":["full","slab"],"cat":"ind","c":"#bcd6da","dn":["{}硝子"]},
   {"k":"cement","n":"セメント工場","use":"factory","one":true,"z":"fgk","cpm":260,"f0":1,"f1":2,"min":100,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#b8b6b0","rl":0.9,"fx":{"home":-0.06},"dn":["{}セメント"]},
   {"k":"recycle","n":"リサイクル工場","use":"factory","one":true,"z":"efgk","cpm":260,"f0":1,"f1":2,"min":20,"max":600,"sh":["full","slab"],"cat":"ind","c":"#9fb39a","rl":0.9,"fx":{"home":-0.03},"dn":["{}リサイクルセンター"]},
   {"k":"garbage","n":"ごみ処理場","use":"factory","one":true,"z":"fgk","cpm":450,"f0":1,"f1":3,"min":60,"max":1200,"sh":["full","slab"],"cat":"ind","c":"#8f969c","rl":0.8,"dm":1.3,"fx":{"home":-0.08},"dn":["{}クリーンセンター"]},
   {"k":"thermal","n":"火力発電所","use":"factory","one":true,"z":"fgk","cpm":500,"f0":1,"f1":3,"min":200,"max":1600,"sh":["full","slab"],"cat":"ind","c":"#7c8288","rl":1.3,"pp":0.2,"fx":{"home":-0.05},"dn":["{}火力発電所"]},
   {"k":"shipyard","n":"造船所","use":"factory","one":true,"z":"gk","cpm":350,"f0":1,"f1":2,"min":200,"max":1600,"sh":["full","slab"],"sea":true,"mk":"ship","cat":"ind","c":"#8ea2ae","rl":1.2,"dn":["{}造船所"]},
   {"k":"water","n":"浄水場","use":"factory","one":true,"z":"efghik","cpm":300,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"ind","c":"#9cc4d6","rl":0.9,"pp":0.1,"pat":"water","dn":["{}浄水場"]},
   {"k":"solar","n":"太陽光発電所","use":"factory","one":true,"z":"efghik","cpm":80,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"ind","c":"#3d5a80","pp":0.02,"pat":"solar","dn":["{}メガソーラー"]},
   {"k":"wind","n":"風力発電所","use":"factory","one":true,"z":"ghik","cpm":120,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"ind","c":"#cfe3c4","pp":0.01,"pat":"wind","dn":["{}ウインドファーム"]},
   {"k":"smallwh","n":"小さな倉庫","use":"warehouse","one":true,"z":"cdefgk","cpm":180,"f0":1,"f1":2,"min":1,"max":20,"sh":["full","slab"],"cat":"logi","c":"#c7bba3","rl":0.95,"dn":["{}倉庫"]},
   {"k":"whbldg","n":"倉庫ビル","use":"warehouse","one":true,"z":"cdefgk","cpm":300,"f0":3,"f1":8,"min":20,"max":600,"sh":["full","slab"],"cat":"logi","c":"#b9ae98","dn":["{}倉庫ビル"]},
   {"k":"dc","n":"物流センター","use":"warehouse","one":true,"z":"efgk","cpm":280,"f0":1,"f1":5,"min":100,"max":1600,"sh":["full","slab"],"cat":"logi","c":"#c4b9a5","rl":1.15,"dm":1.1,"pp":1.5,"dn":["{}ロジスティクスセンター"]},
   {"k":"coldwh","n":"冷凍倉庫","use":"warehouse","one":true,"z":"efgk","cpm":380,"f0":1,"f1":4,"min":20,"max":800,"sh":["full","slab"],"cat":"logi","c":"#cfe0e6","rl":1.35,"dn":["{}冷蔵倉庫"]},
   {"k":"delivery","n":"配送センター","use":"warehouse","one":true,"z":"cdef","cpm":240,"f0":1,"f1":2,"min":20,"max":600,"sh":["full","slab"],"cat":"logi","c":"#cdbf9f","rl":1.05,"dm":1.1,"dn":["{}配送センター"]},
   {"k":"truckterm","n":"トラックターミナル","use":"warehouse","one":true,"z":"efgk","cpm":200,"f0":1,"f1":1,"min":60,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#b6ab92","dn":["{}トラックターミナル"]},
   {"k":"trunk","n":"トランクルーム","use":"warehouse","u":10,"z":"bcdek","cpm":250,"f0":1,"f1":4,"min":1,"max":20,"sh":["full","slab"],"cat":"logi","c":"#d2c7b1","rl":1.2,"dn":["{}トランクルーム"]},
   {"k":"wholesale","n":"卸売市場","use":"warehouse","one":true,"z":"cdegk","cpm":300,"f0":1,"f1":3,"min":60,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#c8b48e","fx":{"shop":0.04},"dn":["{}卸売市場"]},
   {"k":"oiltank","n":"油槽所","use":"warehouse","one":true,"z":"gk","cpm":350,"f0":1,"f1":1,"min":40,"max":1200,"sh":["full","slab"],"cat":"logi","c":"#d9d9d2","rl":1.1,"pp":0.2,"dn":["{}油槽所"]},
   {"k":"container","n":"コンテナヤード","use":"warehouse","one":true,"z":"gk","cpm":60,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"logi","c":"#c26a4a","pat":"container","dn":["{}コンテナヤード"]},
   {"k":"fishport","n":"漁港","use":"port","one":true,"z":"ghk","cpm":300,"f0":1,"f1":1,"min":6,"max":400,"sh":["full"],"sea":true,"cat":"port","c":"#8fb0bf","rl":0.8,"dm":1.1,"dn":["{}漁港"]},
   {"k":"airfield","n":"飛行場（コミューター）","use":"port","one":true,"z":"efghk","cpm":3000,"f0":0,"f1":0,"min":100,"max":1600,"sh":["full"],"cat":"port","c":"#b7bec5","air":true,"gov":true,"rwy":800,"gates":2,"hangar":4,"pp":1.2,"rl":0.4,"dn":["{}飛行場"]},
   {"k":"airport_s","n":"地方空港","use":"port","one":true,"z":"efghk","cpm":5000,"f0":0,"f1":0,"min":400,"max":1600,"sh":["full"],"cat":"port","c":"#b2b9c1","air":true,"gov":true,"rwy":1500,"gates":4,"hangar":8,"pp":1.5,"rl":0.4,"dn":["{}空港"]},
   {"k":"airport_m","n":"空港","use":"port","one":true,"z":"efgh","cpm":8000,"f0":0,"f1":0,"min":900,"max":3200,"sh":["full"],"cat":"port","c":"#adb4bc","air":true,"gov":true,"rwy":2500,"gates":8,"hangar":16,"pp":2,"rl":0.4,"dn":["{}空港"]},
   {"k":"airport_l","n":"国際空港","use":"port","one":true,"z":"efgh","cpm":12000,"f0":0,"f1":0,"min":1500,"max":6400,"sh":["full"],"cat":"port","c":"#a8b0b8","air":true,"gov":true,"rwy":3000,"gates":16,"hangar":30,"pp":3,"rl":0.4,"dn":["{}国際空港"]},
   {"k":"ferry","n":"フェリーターミナル","use":"port","one":true,"z":"gk","cpm":600,"f0":1,"f1":3,"min":20,"max":600,"sh":["full"],"sea":true,"cat":"port","c":"#a7c0cf","pp":1.5,"fx":{"hotel":0.04},"dn":["{}フェリーターミナル"]},
   {"k":"containerport","n":"コンテナふ頭","use":"port","one":true,"z":"gk","cpm":450,"f0":1,"f1":1,"min":100,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#8c9fae","rl":1.15,"opts":["ore","crude"],"dn":["{}コンテナふ頭"]},
   {"k":"oilport","n":"石油基地","use":"port","one":true,"z":"gk","cpm":500,"f0":1,"f1":1,"min":40,"max":1600,"sh":["full"],"sea":true,"cat":"port","c":"#b7b9b1","rl":1.1,"opts":["crude"],"rb":1.3,"dn":["{}石油基地"]},
   {"k":"marina","n":"マリーナ","use":"port","one":true,"z":"ghk","cpm":400,"f0":1,"f1":1,"min":10,"max":400,"sh":["full"],"sea":true,"cat":"port","c":"#9fc7d8","rl":1.2,"dm":0.8,"fx":{"hotel":0.04},"dn":["{}マリーナ"]},
   {"k":"mugi","n":"麦畑","use":"farm","one":true,"z":"h","cpm":10,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#e2c666","opts":["wheat"],"rb":1.3,"pat":"rows","dn":["{}麦畑"]},
   {"k":"hatake","n":"畑","use":"farm","one":true,"z":"h","cpm":8,"f0":0,"f1":0,"min":2,"max":1600,"sh":["full"],"cat":"farm","c":"#b9a36a","opts":["wheat"],"pat":"rows"},
   {"k":"paddy","n":"田んぼ","use":"farm","one":true,"z":"h","cpm":12,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#8fc28a","rl":1.05,"pat":"paddy"},
   {"k":"kaju","n":"果樹園","use":"farm","one":true,"z":"hi","cpm":20,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#88b05e","rl":1.3,"dm":0.9,"pat":"trees","dn":["{}果樹園"]},
   {"k":"cha","n":"茶畑","use":"farm","one":true,"z":"hi","cpm":15,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#6f9f55","rl":1.2,"pat":"rows","dn":["{}茶園"]},
   {"k":"vineyard","n":"ぶどう畑","use":"farm","one":true,"z":"hi","cpm":20,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#7f8f4e","rl":1.25,"pat":"rows","dn":["{}ワイナリー"]},
   {"k":"flowerfield","n":"花畑","use":"farm","one":true,"z":"hi","cpm":15,"f0":0,"f1":0,"min":4,"max":1600,"sh":["full"],"cat":"farm","c":"#e9b6cf","rl":1.1,"fx":{"hotel":0.03},"pat":"flowers","dn":["{}フラワーパーク"]},
   {"k":"ranch","n":"牧場","use":"farm","one":true,"z":"hi","cpm":10,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"farm","c":"#b8d48c","rl":0.9,"pat":"lawn","dn":["{}牧場"]},
   {"k":"forestry","n":"植林地","use":"farm","one":true,"z":"i","cpm":5,"f0":0,"f1":0,"min":40,"max":1600,"sh":["full"],"cat":"farm","c":"#5d8a4f","rl":0.6,"pat":"trees"},
   {"k":"greenhouse","n":"ビニールハウス","use":"farm","one":true,"z":"h","cpm":60,"f0":1,"f1":1,"min":2,"max":400,"sh":["full","slab"],"cat":"farm","c":"#e8f1ee","rl":1.6},
   {"k":"chicken","n":"養鶏場","use":"farm","one":true,"z":"h","cpm":80,"f0":1,"f1":1,"min":10,"max":400,"sh":["full","slab"],"cat":"farm","c":"#d9cfb6","rl":1.2,"fx":{"home":-0.04},"dn":["{}養鶏場"]},
   {"k":"coinpark","n":"コインパーキング","use":"parking","one":true,"z":"abcdefghk","cpm":40,"f0":0,"f1":0,"min":1,"max":60,"sh":["full"],"cat":"park","c":"#c4c4c4","rl":1.2,"dm":0.95,"pat":"lines"},
   {"k":"tsukigime","n":"月極駐車場","use":"parking","one":true,"z":"abcdefghk","cpm":25,"f0":0,"f1":0,"min":2,"max":200,"sh":["full"],"cat":"park","c":"#bababa","rl":0.9,"dm":1.1,"pat":"lines"},
   {"k":"bigpark","n":"大型駐車場","use":"parking","one":true,"z":"cdefghk","cpm":25,"f0":0,"f1":0,"min":60,"max":1600,"sh":["full"],"cat":"park","c":"#b5b5b5","rl":0.85,"pat":"lines"},
   {"k":"bikepark","n":"自転車置き場","use":"parking","one":true,"z":"bcdk","cpm":20,"f0":0,"f1":0,"min":1,"max":40,"sh":["full"],"cat":"park","c":"#c9c3b5","rl":0.7,"dm":1.3,"pat":"lines"},
   {"k":"mechpark","n":"機械式駐車場","use":"parking","u":0,"z":"cd","cpm":600,"f0":3,"f1":10,"min":1,"max":20,"sh":["full"],"cat":"park","c":"#a9adb1","rl":1.3,"dn":["{}パーキングタワー"]},
   {"k":"busterm","n":"バスターミナル","use":"parking","u":0,"z":"cd","cpm":400,"f0":1,"f1":2,"min":20,"max":400,"sh":["full","slab"],"cat":"park","c":"#b9c2c9","pp":20,"fx":{"shop":0.03},"dn":["{}バスターミナル"]},
   {"k":"cityhall","n":"市役所","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"plaza","n":"広場","use":"plaza","one":true,"z":"abcdefghik","cpm":40,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"uhq","n":"大学の本部","use":"school","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ukan","n":"大学の校舎","use":"school","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ulab","n":"大学の研究棟","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ulib","n":"大学の図書館","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uhall","n":"大学の講堂","use":"school","u":0,"z":"abcdefghik","cpm":800,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"ugym","n":"大学の体育館","use":"school","u":0,"z":"abcdefghik","cpm":450,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uunion","n":"学生会館","use":"school","u":0,"z":"abcdefghik","cpm":500,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"udorm","n":"学生寮","use":"home","u":0,"z":"abcdefghik","cpm":400,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"uhosp","n":"大学病院","use":"hospital","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"umus","n":"大学の博物館","use":"school","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"univ"},
   {"k":"uschool","n":"附属学校","use":"school","u":0,"z":"abcdefghik","cpm":450,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true,"sc":"hs"},
   {"k":"ugh","n":"温室","use":"farm","u":0,"z":"abcdefghik","cpm":200,"f0":1,"f1":2,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ufield","n":"グラウンド","use":"plaza","one":true,"z":"abcdefghik","cpm":30,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ufarm","n":"実験農場","use":"farm","one":true,"z":"abcdefghik","cpm":10,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"ugreen","n":"緑地","use":"plaza","one":true,"z":"abcdefghik","cpm":20,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"uave","n":"並木道","use":"plaza","one":true,"z":"abcdefghik","cpm":40,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"prefhall","n":"府県庁","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"govhall","n":"官庁","use":"office","u":0,"z":"abcdefghik","cpm":1100,"f0":1,"f1":80,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"diet","n":"国会議事堂","use":"office","u":0,"z":"abcdefghik","cpm":2500,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"court","n":"裁判所","use":"office","u":0,"z":"abcdefghik","cpm":1300,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"kantei","n":"首相官邸","use":"office","u":0,"z":"abcdefghik","cpm":1800,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natlib","n":"国立図書館","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"milhq","n":"司令部","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"wardoffice","n":"区役所","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":40,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"townhall","n":"町村役場","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"gpost","n":"郵便局","use":"office","u":0,"z":"abcdefghik","cpm":700,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"police","n":"警察署","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":20,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"firest","n":"消防署","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"publib","n":"図書館","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"civic","n":"市民会館","use":"office","u":0,"z":"abcdefghik","cpm":1000,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"pgym","n":"体育館","use":"office","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":5,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"cityhosp","n":"市立病院","use":"office","u":0,"z":"abcdefghik","cpm":1100,"f0":1,"f1":30,"min":1,"max":1600,"sh":["full","tower"],"gov":true},
   {"k":"cleanfac","n":"清掃工場","use":"office","u":0,"z":"abcdefghik","cpm":600,"f0":1,"f1":6,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"pwater","n":"浄水場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true,"pat":"water"},
   {"k":"natmus","n":"国立博物館","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natart","n":"国立美術館","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"nattheater","n":"国立劇場","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":1,"f1":10,"min":1,"max":1600,"sh":["full"],"gov":true},
   {"k":"natstad","n":"国立競技場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":1600,"sh":["full"],"gov":true,"pat":"track"},
   {"k":"keiba","n":"競馬場","use":"office","u":0,"z":"abcdefghik","cpm":300,"f0":0,"f1":0,"min":1,"max":20000,"sh":["full"],"gov":true,"pat":"keiba","c":"#cfe0b4","fx":{"shop":0.05,"hotel":0.1}},
   {"k":"hangar","n":"格納庫","use":"warehouse","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":1,"min":16,"max":400,"sh":["full","slab"],"gov":true,"c":"#8d9196"},
   {"k":"ctower","n":"管制塔","use":"office","u":0,"z":"abcdefghik","cpm":1500,"f0":4,"f1":12,"min":1,"max":9,"sh":["tower","full"],"gov":true,"c":"#c9cdd2"},
   {"k":"barracks","n":"隊舎","use":"home","u":30,"z":"abcdefghik","cpm":350,"f0":3,"f1":6,"min":6,"max":120,"sh":["slab","L","ko","full"],"gov":true,"c":"#b9b29a"},
   {"k":"mro","n":"航空機整備工場","use":"factory","one":true,"z":"abcdefghik","cpm":400,"f0":1,"f1":2,"min":30,"max":800,"sh":["full","slab"],"gov":true,"c":"#9aa1a8"},
   {"k":"fueltank","n":"燃料タンク","use":"warehouse","one":true,"z":"abcdefghik","cpm":250,"f0":1,"f1":1,"min":4,"max":400,"sh":["full"],"gov":true,"c":"#d8d8d0"},
   {"k":"radar","n":"レーダー基地","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":1,"f1":3,"min":2,"max":60,"sh":["full"],"gov":true,"c":"#c0c6cc"},
   {"k":"milschool","n":"士官学校","use":"office","u":0,"z":"abcdefghik","cpm":700,"f0":2,"f1":6,"min":20,"max":800,"sh":["full","slab","L","ko"],"gov":true,"c":"#a89a7c"},
   {"k":"navpier","n":"軍港の岸壁","use":"port","one":true,"z":"abcdefghik","cpm":500,"f0":1,"f1":1,"min":20,"max":1600,"sh":["full"],"sea":true,"gov":true,"c":"#8a9aa6"},
   {"k":"drydock","n":"乾ドック","use":"factory","one":true,"z":"abcdefghik","cpm":450,"f0":1,"f1":1,"min":60,"max":1600,"sh":["full","slab"],"sea":true,"gov":true,"c":"#7f8f99"},
   {"k":"arsenal","n":"海軍工廠","use":"factory","one":true,"z":"abcdefghik","cpm":400,"f0":1,"f1":4,"min":40,"max":1600,"sh":["full","slab"],"gov":true,"c":"#8b8e84"},
   {"k":"uminoie","n":"海の家","use":"shop","u":0,"z":"aghik","cpm":200,"f0":1,"f1":1,"min":1,"max":6,"sh":["full"],"sea":true,"cat":"shop","c":"#e8c88a","dn":["海の家 {}"]},
   {"k":"seaside","n":"シーサイドハウス","use":"hotel","one":true,"z":"abhik","cpm":500,"f0":1,"f1":2,"min":2,"max":12,"sh":["full","L"],"sea":true,"sc":"guesthouse","cat":"hotel","c":"#9ec9d6","dn":["シーサイドハウス {}"]},
   {"k":"beachhouse","n":"ビーチハウス","use":"home","one":true,"z":"abhik","cpm":600,"f0":1,"f1":2,"min":3,"max":20,"sh":["full","L"],"sea":true,"cat":"home","c":"#d9e4e8","rl":1.6,"dm":0.6},
   {"k":"cottage","n":"コテージ","use":"hotel","one":true,"z":"ahik","cpm":420,"f0":1,"f1":2,"min":2,"max":10,"sh":["full","L"],"sc":"pension","cat":"hotel","c":"#a77b55","dn":["{}コテージ"]},
   {"k":"glamping","n":"グランピング施設","use":"leisure","one":true,"z":"hik","cpm":150,"f0":1,"f1":1,"min":20,"max":400,"sh":["full"],"sc":"camp","cat":"fun","c":"#c9b48a","dn":["{}グランピング"]},
   {"k":"beachclub","n":"ビーチクラブ","use":"leisure","one":true,"z":"cdghk","cpm":600,"f0":1,"f1":3,"min":6,"max":100,"sh":["full","L"],"sea":true,"sc":"pool","cat":"fun","c":"#5fb3c8","dn":["{}ビーチクラブ"]},
   {"k":"oceanview","n":"オーシャンビューホテル","use":"hotel","one":true,"z":"abcdhik","cpm":950,"f0":5,"f1":25,"min":20,"max":800,"sh":["slab","L","tower"],"sea":true,"sc":"resort","cat":"hotel","c":"#e3d9c6","fx":{"shop":0.03},"dn":["{}オーシャンビューホテル"]},
   {"k":"resortcondo","n":"リゾートマンション","use":"home","u":70,"z":"bcdhk","cpm":700,"f0":5,"f1":20,"min":10,"max":200,"sh":["slab","L","tower"],"cat":"home","c":"#e6e0d4","rl":1.4},
   {"k":"aquapark","n":"ウォーターパーク","use":"leisure","one":true,"z":"cdhk","cpm":400,"f0":1,"f1":2,"min":60,"max":1600,"sh":["full"],"sc":"pool","cat":"fun","c":"#4fb0d8","dn":["{}ウォーターパーク"]},
   {"k":"teitaku","n":"邸宅","use":"home","one":true,"z":"abhik","cpm":800,"f0":2,"f1":3,"min":6,"max":30,"sh":["full","L","ko"],"cat":"home","c":"#7a5a48","rl":1.9,"dm":0.65},
   {"k":"poolvilla","n":"プールつき邸宅","use":"home","one":true,"z":"abhik","cpm":1000,"f0":1,"f1":3,"min":10,"max":50,"sh":["full","L","ko"],"cat":"home","c":"#f0ede6","rl":2.4,"dm":0.55},
   {"k":"residence","n":"高級低層レジデンス","use":"home","u":120,"z":"abck","cpm":900,"f0":3,"f1":6,"min":8,"max":80,"sh":["full","L","ko","ro"],"cat":"home","c":"#cdb89a","rl":2.0},
   {"k":"terrace","n":"テラスハウス","use":"home","u":80,"z":"abcek","cpm":380,"f0":2,"f1":3,"min":3,"max":12,"sh":["slab","full"],"cat":"home","c":"#c8a27c"},
   {"k":"courtyard","n":"中庭のある家","use":"home","one":true,"z":"abhik","cpm":550,"f0":1,"f1":2,"min":6,"max":20,"sh":["ko","ro"],"cat":"home","c":"#a8806a","rl":1.3},
   {"k":"koban","n":"交番","use":"office","u":0,"z":"abcdefghik","cpm":800,"f0":1,"f1":2,"min":1,"max":2,"sh":["full"],"gov":true,"c":"#e8e2d0"},
   {"k":"hokenjo","n":"保健所","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":2,"f1":5,"min":4,"max":40,"sh":["full","slab"],"gov":true,"c":"#d5e3e6"},
   {"k":"zeimusho","n":"税務署","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":3,"f1":8,"min":4,"max":60,"sh":["full","slab"],"gov":true,"c":"#c9c3b5"},
   {"k":"kishodai","n":"気象台","use":"office","u":0,"z":"abcdefghik","cpm":900,"f0":2,"f1":5,"min":4,"max":80,"sh":["full","tower"],"gov":true,"c":"#dfe6ea"},
   {"k":"lighthouse","n":"灯台","use":"office","u":0,"z":"abcdefghik","cpm":1200,"f0":3,"f1":8,"min":1,"max":4,"sh":["tower","full"],"sea":true,"gov":true,"c":"#ffffff"},
   {"k":"cemetery","n":"霊園","use":"plaza","one":true,"z":"abcdefghik","cpm":60,"f0":0,"f1":0,"min":10,"max":800,"sh":["full"],"gov":true,"c":"#a9b39a"},
   {"k":"sewage","n":"下水処理場","use":"factory","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":2,"min":40,"max":800,"sh":["full","slab"],"gov":true,"c":"#9fb8a8"},
   {"k":"geihinkan","n":"迎賓館","use":"office","u":0,"z":"abcdefghik","cpm":2000,"f0":2,"f1":3,"min":40,"max":800,"sh":["full","ko"],"gov":true,"c":"#efe7d6"},
   {"k":"embassy","n":"大使館","use":"office","u":0,"z":"abcd","cpm":1200,"f0":2,"f1":8,"min":4,"max":60,"sh":["full","L","ko"],"cat":"biz","c":"#d8d2c4","dn":["{}大使館"]},
   {"k":"radiotower","n":"電波塔","use":"office","u":0,"z":"abcdefghik","cpm":2000,"f0":30,"f1":100,"min":4,"max":40,"sh":["tower"],"cat":"biz","c":"#d94f3d","dn":["{}タワー"]},
   {"k":"obstower","n":"展望タワー","use":"leisure","one":true,"z":"cdk","cpm":1800,"f0":20,"f1":90,"min":4,"max":60,"sh":["tower"],"sc":"science","cat":"fun","c":"#e8e3d6","dn":["{}タワー"]},
   {"k":"castle","n":"城","use":"leisure","one":true,"z":"abcdehik","cpm":1500,"f0":3,"f1":6,"min":20,"max":800,"sh":["full"],"sc":"museum","cat":"fun","c":"#f2efe8","dn":["{}城"]},
   {"k":"garden","n":"日本庭園","use":"leisure","one":true,"z":"abcdehik","cpm":120,"f0":0,"f1":0,"min":10,"max":800,"sh":["full"],"sc":"botanical","cat":"fun","c":"#7fb06a","dn":["{}庭園"]},
   {"k":"observatory","n":"天文台","use":"leisure","one":true,"z":"hik","cpm":900,"f0":1,"f1":3,"min":4,"max":100,"sh":["full"],"sc":"science","cat":"fun","c":"#e9eef2","dn":["{}天文台"]},
   {"k":"domestadium","n":"ドーム球場","use":"leisure","one":true,"z":"cdefk","cpm":1500,"f0":4,"f1":8,"min":400,"max":1600,"sh":["full"],"sc":"baseball","cat":"fun","c":"#e8ecef","dn":["{}ドーム"]},
   {"k":"bigtemple","n":"大寺院","use":"leisure","one":true,"z":"abcdehik","cpm":900,"f0":1,"f1":5,"min":20,"max":800,"sh":["full","L","ko"],"sc":"temple","cat":"fun","c":"#8b3a2a","dn":["{}寺"]},
   {"k":"taisha","n":"大社","use":"leisure","one":true,"z":"abcdehik","cpm":800,"f0":1,"f1":1,"min":40,"max":1600,"sh":["full","L"],"sc":"shrine","cat":"fun","c":"#b03a2e","dn":["{}大社"]},
   {"k":"substation","n":"変電所","use":"factory","one":true,"z":"abcdefghik","cpm":300,"f0":1,"f1":1,"min":4,"max":100,"sh":["full"],"cat":"ind","c":"#a0a4a8","fx":{"home":-0.02}},
   {"k":"hydro","n":"水力発電所","use":"factory","one":true,"z":"hi","cpm":600,"f0":1,"f1":3,"min":10,"max":200,"sh":["full"],"cat":"ind","c":"#8fa9b8"},
   {"k":"geothermal","n":"地熱発電所","use":"factory","one":true,"z":"hik","cpm":500,"f0":1,"f1":2,"min":10,"max":200,"sh":["full"],"cat":"ind","c":"#b3a58f"},
   {"k":"heliport","n":"ヘリポート","use":"parking","one":true,"z":"cdefgk","cpm":200,"f0":0,"f1":0,"min":4,"max":40,"sh":["full"],"cat":"park","c":"#9da39f"},
   {"k":"glassoffice","n":"ガラス張りのオフィスビル","use":"office","u":0,"z":"cd","cpm":1000,"f0":8,"f1":40,"min":8,"max":200,"sh":["slab","tower","L"],"opt":["shop1"],"cat":"biz","c":"#8fb4cf"},
   {"k":"twintower","n":"ツインタワー","use":"office","u":0,"g1":"shop","z":"d","cpm":1200,"f0":30,"f1":55,"min":40,"max":400,"sh":["tower"],"cat":"biz","c":"#a3b8cc","fx":{"office":0.05}},
   {"k":"mixeduse","n":"複合商業ビル","use":"shop","u":150,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":20,"min":10,"max":400,"sh":["full","slab","L"],"cat":"shop","c":"#d9c3a5"},
   {"k":"sa","n":"サービスエリア","use":"shop","u":120,"xw":true,"one":true,"z":"cdefhi","cpm":420,"f0":1,"f1":2,"min":40,"max":600,"sh":["full"],"cat":"shop","c":"#e2c48f","dm":1.3,"dn":["{}サービスエリア"]},
   {"k":"pa","n":"パーキングエリア","use":"shop","u":80,"xw":true,"one":true,"z":"cdefhi","cpm":320,"f0":1,"f1":1,"min":10,"max":200,"sh":["full"],"cat":"shop","c":"#d6cba8","dm":1.1,"dn":["{}パーキングエリア"]}
]'::jsonb
$$;

create or replace function public._mp_sc_kinds() returns jsonb
language sql immutable as $$
  select '{
    "es": {"n":"小学校","use":"school","spp":10,"r":16,"age":0.06,"rs":0,"fee":200,"w":0.05,"acc":false,"loc":false},
    "jhs": {"n":"中学校","use":"school","spp":11,"r":30,"age":0.03,"rs":0,"fee":230,"w":0.1,"acc":false,"loc":false},
    "hs": {"n":"高校","use":"school","spp":12,"r":100,"age":0.03,"rs":0,"fee":320,"w":0.8,"acc":true,"loc":false},
    "univ": {"n":"大学","use":"school","spp":18,"r":300,"age":0.035,"rs":0,"fee":650,"w":1.0,"acc":true,"loc":false},
    "voc": {"n":"専門学校","use":"school","spp":9,"r":200,"age":0.012,"rs":0,"fee":500,"w":0.9,"acc":true,"loc":false},
    "nursery": {"n":"保育園","use":"school","spp":8,"r":10,"age":0.02,"rs":0,"fee":400,"w":0.05,"acc":false,"loc":false},
    "kinder": {"n":"幼稚園","use":"school","spp":8,"r":12,"age":0.02,"rs":0,"fee":300,"w":0.05,"acc":false,"loc":false},
    "esjhs": {"n":"小中一貫校","use":"school","spp":10,"r":30,"age":0.04,"rs":0,"fee":220,"w":0.1,"acc":false,"loc":false},
    "jhshs": {"n":"中高一貫校","use":"school","spp":12,"r":100,"age":0.015,"rs":0,"fee":380,"w":0.7,"acc":true,"loc":false},
    "techhs": {"n":"工業高校","use":"school","spp":14,"r":120,"age":0.008,"rs":0,"fee":320,"w":0.8,"acc":true,"loc":false},
    "comhs": {"n":"商業高校","use":"school","spp":12,"r":120,"age":0.008,"rs":0,"fee":320,"w":0.8,"acc":true,"loc":false},
    "jc": {"n":"短期大学","use":"school","spp":15,"r":200,"age":0.006,"rs":0,"fee":550,"w":0.9,"acc":true,"loc":false},
    "cram": {"n":"学習塾","use":"school","spp":5,"r":20,"age":0.02,"rs":0,"fee":250,"w":0.2,"acc":false,"loc":false},
    "prep": {"n":"予備校","use":"school","spp":6,"r":150,"age":0.004,"rs":0,"fee":600,"w":0.9,"acc":true,"loc":false},
    "driving": {"n":"自動車教習所","use":"school","spp":60,"r":150,"age":0.001,"rs":0,"fee":1500,"w":0.5,"acc":true,"loc":false},
    "eikaiwa": {"n":"英会話教室","use":"school","spp":6,"r":40,"age":0.004,"rs":0,"fee":400,"w":0.4,"acc":true,"loc":false},
    "music": {"n":"音楽学校","use":"school","spp":12,"r":150,"age":0.002,"rs":0,"fee":600,"w":0.8,"acc":true,"loc":false},
    "cook": {"n":"調理師学校","use":"school","spp":10,"r":150,"age":0.002,"rs":0,"fee":550,"w":0.8,"acc":true,"loc":false},
    "bizhotel": {"n":"ビジネスホテル","use":"hotel","spp":25,"r":60,"age":0.0015,"rs":0.012,"fee":1000,"w":1.0,"acc":true,"loc":true},
    "cityhotel": {"n":"シティホテル","use":"hotel","spp":40,"r":100,"age":0.001,"rs":0.01,"fee":1800,"w":1.0,"acc":true,"loc":true},
    "luxhotel": {"n":"高級ホテル","use":"hotel","spp":70,"r":200,"age":0.0004,"rs":0.004,"fee":4000,"w":0.8,"acc":true,"loc":true},
    "resort": {"n":"リゾートホテル","use":"hotel","spp":60,"r":300,"age":0.0005,"rs":0.002,"fee":3000,"w":0.5,"acc":false,"loc":true,"pk":[7,8],"op":[1,2]},
    "ryokan": {"n":"旅館","use":"hotel","spp":35,"r":200,"age":0.0006,"rs":0.004,"fee":1600,"w":0.8,"acc":true,"loc":true,"pk":[9,10,11]},
    "onsenryokan": {"n":"温泉旅館","use":"hotel","spp":40,"r":300,"age":0.0005,"rs":0.003,"fee":2200,"w":0.6,"acc":false,"loc":true,"pk":[12,1,2],"op":[7,8]},
    "minshuku": {"n":"民宿","use":"hotel","spp":30,"r":200,"age":0.0004,"rs":0.002,"fee":900,"w":0.6,"acc":false,"loc":true,"pk":[7,8]},
    "pension": {"n":"ペンション","use":"hotel","spp":35,"r":200,"age":0.0003,"rs":0.002,"fee":1200,"w":0.5,"acc":false,"loc":true,"pk":[7,8,12]},
    "capsule": {"n":"カプセルホテル","use":"hotel","spp":6,"r":40,"age":0.0008,"rs":0.01,"fee":300,"w":1.0,"acc":true,"loc":true},
    "guesthouse": {"n":"ゲストハウス","use":"hotel","spp":12,"r":100,"age":0.0004,"rs":0.005,"fee":450,"w":1.0,"acc":true,"loc":true},
    "stahotel": {"n":"駅前ホテル","use":"hotel","spp":28,"r":60,"age":0.001,"rs":0.015,"fee":1100,"w":1.0,"acc":true,"loc":true},
    "ekichoku": {"n":"駅ナカのお店","use":"shop","spp":1.5,"r":4,"rr":5,"age":0.003,"rs":0.06,"fee":100,"w":0,"acc":false,"loc":true},
    "condo": {"n":"コンドミニアム","use":"hotel","spp":50,"r":200,"age":0.0003,"rs":0.003,"fee":2200,"w":0.6,"acc":false,"loc":true,"pk":[7,8]},
    "clinic": {"n":"診療所","use":"hospital","spp":8,"r":16,"age":0.02,"rs":0,"fee":400,"w":0.2,"acc":false,"loc":false},
    "dental": {"n":"歯科医院","use":"hospital","spp":10,"r":16,"age":0.008,"rs":0,"fee":450,"w":0.1,"acc":false,"loc":false},
    "vet": {"n":"動物病院","use":"hospital","spp":12,"r":30,"age":0.003,"rs":0,"fee":500,"w":0.1,"acc":false,"loc":false},
    "hospital": {"n":"総合病院","use":"hospital","spp":25,"r":100,"age":0.01,"rs":0,"fee":1200,"w":0.6,"acc":true,"loc":false},
    "bighosp": {"n":"大病院","use":"hospital","spp":30,"r":200,"age":0.006,"rs":0,"fee":1600,"w":0.8,"acc":true,"loc":false},
    "erhosp": {"n":"救急病院","use":"hospital","spp":30,"r":120,"age":0.004,"rs":0,"fee":1500,"w":0.4,"acc":true,"loc":false},
    "pedi": {"n":"小児科医院","use":"hospital","spp":10,"r":20,"age":0.006,"rs":0,"fee":350,"w":0.1,"acc":false,"loc":false,"pk":[12,1,2]},
    "eye": {"n":"眼科","use":"hospital","spp":10,"r":30,"age":0.005,"rs":0,"fee":400,"w":0.2,"acc":false,"loc":false},
    "obgyn": {"n":"産婦人科","use":"hospital","spp":20,"r":60,"age":0.002,"rs":0,"fee":900,"w":0.3,"acc":false,"loc":false},
    "nursing": {"n":"老人ホーム","use":"hospital","spp":40,"r":60,"age":0.002,"rs":0,"fee":1300,"w":0.05,"acc":false,"loc":false},
    "care": {"n":"介護施設","use":"hospital","spp":35,"r":40,"age":0.002,"rs":0,"fee":1100,"w":0.05,"acc":false,"loc":false},
    "dayserv": {"n":"デイサービスセンター","use":"hospital","spp":15,"r":20,"age":0.004,"rs":0,"fee":500,"w":0.05,"acc":false,"loc":false},
    "cinema": {"n":"映画館","use":"leisure","spp":3,"r":100,"age":0.004,"rs":0.01,"fee":120,"w":0.8,"acc":true,"loc":true},
    "theater": {"n":"劇場","use":"leisure","spp":4,"r":200,"age":0.001,"rs":0.005,"fee":200,"w":0.9,"acc":true,"loc":true},
    "hall": {"n":"コンサートホール","use":"leisure","spp":4,"r":200,"age":0.001,"rs":0.005,"fee":180,"w":0.9,"acc":true,"loc":true},
    "livehouse": {"n":"ライブハウス","use":"leisure","spp":3,"r":100,"age":0.001,"rs":0.008,"fee":150,"w":0.9,"acc":true,"loc":true},
    "bowling": {"n":"ボウリング場","use":"leisure","spp":8,"r":60,"age":0.002,"rs":0.003,"fee":300,"w":0.5,"acc":false,"loc":true},
    "arcade": {"n":"ゲームセンター","use":"leisure","spp":3,"r":40,"age":0.005,"rs":0.01,"fee":120,"w":0.5,"acc":true,"loc":true},
    "karaoke": {"n":"カラオケ店","use":"leisure","spp":4,"r":40,"age":0.005,"rs":0.01,"fee":160,"w":0.6,"acc":true,"loc":true},
    "pachinko": {"n":"パチンコ店","use":"leisure","spp":4,"r":40,"age":0.004,"rs":0.008,"fee":200,"w":0.4,"acc":false,"loc":true},
    "kbshop": {"n":"場外馬券売り場","use":"leisure","spp":8,"r":200,"age":0.003,"rs":0.006,"fee":400,"w":0.6,"acc":true,"loc":false,"kb":true},
    "batting": {"n":"バッティングセンター","use":"leisure","spp":10,"r":40,"age":0.001,"rs":0.002,"fee":300,"w":0.3,"acc":false,"loc":true,"pk":[3,4,5,7,8]},
    "golfrange": {"n":"ゴルフ練習場","use":"leisure","spp":30,"r":60,"age":0.001,"rs":0,"fee":500,"w":0.2,"acc":false,"loc":true},
    "golf": {"n":"ゴルフ場","use":"leisure","spp":500,"r":400,"age":0.0003,"rs":0,"fee":8000,"w":0.2,"acc":false,"loc":false,"pk":[3,4,5,9,10,11],"op":[12,1,2]},
    "tennis": {"n":"テニスコート","use":"leisure","spp":60,"r":40,"age":0.0008,"rs":0,"fee":600,"w":0.2,"acc":false,"loc":false,"pk":[3,4,5,9,10,11],"op":[12,1,2]},
    "sportsclub": {"n":"スポーツクラブ","use":"leisure","spp":8,"r":40,"age":0.006,"rs":0.003,"fee":250,"w":0.4,"acc":true,"loc":true},
    "pool": {"n":"屋内プール","use":"leisure","spp":10,"r":40,"age":0.003,"rs":0,"fee":300,"w":0.3,"acc":false,"loc":false,"pk":[7,8]},
    "skate": {"n":"スケートリンク","use":"leisure","spp":12,"r":100,"age":0.001,"rs":0.002,"fee":400,"w":0.5,"acc":true,"loc":false,"pk":[12,1,2],"op":[7,8]},
    "baseball": {"n":"野球場","use":"leisure","spp":4,"r":300,"age":0.0015,"rs":0.004,"fee":150,"w":1.2,"acc":true,"loc":false,"pk":[3,4,5,7,8,9],"op":[12,1,2]},
    "soccer": {"n":"サッカースタジアム","use":"leisure","spp":4,"r":300,"age":0.0012,"rs":0.004,"fee":150,"w":1.2,"acc":true,"loc":false,"op":[12,1]},
    "arena": {"n":"アリーナ","use":"leisure","spp":5,"r":200,"age":0.001,"rs":0.004,"fee":180,"w":1.0,"acc":true,"loc":true},
    "athletics": {"n":"陸上競技場","use":"leisure","spp":8,"r":200,"age":0.0008,"rs":0.002,"fee":120,"w":1.0,"acc":true,"loc":false,"pk":[3,4,5,9,10,11]},
    "amuse": {"n":"遊園地","use":"leisure","spp":15,"r":400,"age":0.002,"rs":0.004,"fee":700,"w":1.0,"acc":true,"loc":false,"pk":[3,4,5,7,8],"op":[12,1,2]},
    "tpark": {"n":"テーマパーク","use":"leisure","spp":20,"r":600,"age":0.004,"rs":0.008,"fee":1200,"w":1.0,"acc":true,"loc":false,"pk":[3,4,5,7,8,12],"op":[1,2,6]},
    "aquarium": {"n":"水族館","use":"leisure","spp":6,"r":300,"age":0.0015,"rs":0.004,"fee":300,"w":0.9,"acc":true,"loc":true,"pk":[7,8]},
    "zoo": {"n":"動物園","use":"leisure","spp":30,"r":300,"age":0.0015,"rs":0.003,"fee":400,"w":0.9,"acc":true,"loc":false,"pk":[3,4,5,9,10,11],"op":[12,1,2]},
    "botanical": {"n":"植物園","use":"leisure","spp":40,"r":200,"age":0.0008,"rs":0.001,"fee":300,"w":0.7,"acc":true,"loc":false,"pk":[3,4,5]},
    "artmuseum": {"n":"美術館","use":"leisure","spp":8,"r":200,"age":0.001,"rs":0.003,"fee":250,"w":0.9,"acc":true,"loc":true},
    "museum": {"n":"博物館","use":"leisure","spp":8,"r":200,"age":0.001,"rs":0.003,"fee":220,"w":0.9,"acc":true,"loc":false},
    "science": {"n":"科学館","use":"leisure","spp":8,"r":200,"age":0.001,"rs":0.002,"fee":220,"w":0.8,"acc":true,"loc":false,"pk":[7,8]},
    "superonsen": {"n":"スーパー銭湯","use":"leisure","spp":6,"r":60,"age":0.004,"rs":0.003,"fee":300,"w":0.4,"acc":false,"loc":true,"pk":[12,1,2]},
    "sento": {"n":"銭湯","use":"leisure","spp":4,"r":12,"age":0.01,"rs":0,"fee":120,"w":0.05,"acc":false,"loc":false,"pk":[12,1,2]},
    "wedding": {"n":"結婚式場","use":"leisure","spp":30,"r":200,"age":0.0003,"rs":0.002,"fee":1500,"w":0.8,"acc":true,"loc":true,"pk":[5,6,10,11]},
    "convention": {"n":"展示場","use":"leisure","spp":8,"r":300,"age":0.0008,"rs":0.006,"fee":200,"w":1.0,"acc":true,"loc":true},
    "camp": {"n":"キャンプ場","use":"leisure","spp":100,"r":400,"age":0.0004,"rs":0,"fee":1500,"w":0.3,"acc":false,"loc":false,"pk":[7,8],"op":[12,1,2]},
    "fishing": {"n":"釣り堀","use":"leisure","spp":30,"r":40,"age":0.0005,"rs":0,"fee":500,"w":0.2,"acc":false,"loc":false},
    "shrine": {"n":"神社","use":"leisure","spp":10,"r":40,"age":0.01,"rs":0.002,"fee":80,"w":0.3,"acc":false,"loc":false,"pk":[1]},
    "temple": {"n":"寺","use":"leisure","spp":10,"r":40,"age":0.006,"rs":0.002,"fee":100,"w":0.3,"acc":false,"loc":false,"pk":[8,11]},
    "church": {"n":"教会","use":"leisure","spp":8,"r":40,"age":0.004,"rs":0,"fee":80,"w":0.2,"acc":false,"loc":false,"pk":[12]},
    "ski": {"n":"スキー場","use":"leisure","spp":400,"r":400,"age":0.0006,"rs":0,"fee":4000,"w":0.3,"acc":false,"loc":false,"pk":[12,1,2],"op":[5,6,7,8,9,10]}
  }'::jsonb
$$;

-- 名義の人（会社なら その会社の持ち主）。国は null（DB の更新109）
create or replace function public._mp_pperson(pu uuid, pc int) returns uuid
language sql stable set search_path = public as $$
  select coalesce(pu, (select c.owner from companies c where c.id = pc))
$$;

-- 筆のとなり（ホームの区画から 2区画＝20m 以内）にある、同じ人（その人の会社もふくむ）の鉄道の駅。いちばん近いもの（DB の更新109：駅直結ビル）
create or replace function public._mp_sta_touch(p mp_parcels) returns bigint
language sql stable set search_path = public as $$
  select zt.id from mp_stations zt
   where zt.kind = 'rail' and zt.seg is not null
     and zt.x between ((p.bb[1])[0] / 5.0 - 12) * 100 and ((p.bb[0])[0] / 5.0 + 12) * 100
     and zt.y between ((p.bb[1])[1] / 5.0 - 12) * 100 and ((p.bb[0])[1] / 5.0 + 12) * 100
     and _mp_pperson(p.own_u, p.own_c) is not null and _mp_pperson(zt.own_u, zt.own_c) = _mp_pperson(p.own_u, p.own_c)
     and exists (select 1 from _mp_sta_cells(zt.id) zc join mp_pcells zp on zp.parcel = p.id and abs(zp.x - zc.x) <= 2 and abs(zp.y - zc.y) <= 2)
   order by (zt.x / 100.0 - ((p.bb[1])[0] + (p.bb[0])[0]) / 10.0) ^ 2 + (zt.y / 100.0 - ((p.bb[1])[1] + (p.bb[0])[1]) / 10.0) ^ 2
   limit 1
$$;

create or replace function public._mp_bld_check(p mp_parcels, p_kind text, p_shape text, p_floors int, p_opt text) returns jsonb
language plpgsql stable set search_path = public as $$
declare pr jsonb; zs text; zr jsonb; cv real := 1; far real := 99; mf int := 99; pcs int[]; cs int[]; nmax int; cnt int; fm2 int; f0 int; f1 int; fl int; plan jsonb;
        x0 int; y0 int; x1 int; y1 int; bad text; rent numeric := 0; lv numeric; z text; zsta bigint;
begin
  select b into pr from jsonb_array_elements(_mp_bld_presets()) b where b ->> 'k' = p_kind;
  if pr is null then raise exception '建物の種類がちがいます'; end if;
  if coalesce((pr ->> 'gov')::boolean, false) and not exists (select 1 from companies c where c.id = p.own_c and c.official and not c.ai) then
    raise exception '%は国の建物です', pr ->> 'n';   -- t61：国営の会社（風の芽帝国空軍・海軍など）は、国の建物の種類（格納庫・管制塔・岸壁…）も持てる
  end if;
  if p.n < (pr ->> 'min')::int then raise exception '%には %区画（%㎡）以上の土地がいります', pr ->> 'n', pr ->> 'min', (pr ->> 'min')::int * 100; end if;
  if p.n > (pr ->> 'max')::int then raise exception '%は %区画（%㎡）までの土地に建てます（分筆してください）', pr ->> 'n', pr ->> 'max', (pr ->> 'max')::int * 100; end if;
  x0 := (p.bb[1])[0]; y0 := (p.bb[1])[1]; x1 := (p.bb[0])[0] - 1; y1 := (p.bb[0])[1] - 1;
  -- 用途地域（筆のすべてのマス）。いちばんきびしい決まりで
  select string_agg(distinct _mp_zname(c.z), '・') filter (where position(c.z in (pr ->> 'z')) = 0) into zs
    from (select distinct _mp_t5(x) tx, _mp_t5(y) ty from mp_pcells where parcel = p.id) t, lateral _mp_cell(t.tx, t.ty) c;
  if zs is not null then raise exception '用途地域で建てられません（%）', zs; end if;
  for z in select distinct c.z from (select distinct _mp_t5(x) tx, _mp_t5(y) ty from mp_pcells where parcel = p.id) t, lateral _mp_cell(t.tx, t.ty) c loop
    zr := _mp_zone_rule(z); cv := least(cv, (zr ->> 'cv')::real); far := least(far, (zr ->> 'far')::real); mf := least(mf, (zr ->> 'mf')::int);
  end loop;
  if coalesce((pr ->> 'sea')::boolean, false) and not exists (select 1 from generate_series(_mp_t5(x0) - 2, _mp_t5(x1) + 2) gx, generate_series(_mp_t5(y0) - 2, _mp_t5(y1) + 2) gy, lateral _mp_cell(gx, gy) cc where cc.t in ('S', 'D')) then
    raise exception '%は海のそばに建てます', pr ->> 'n';
  end if;
  if coalesce((pr ->> 'xw')::boolean, false) and not _mp_near_exp(x0, y0, x1, y1) then   -- サービスエリア・パーキングエリア（DB の更新103）
    raise exception '%は高速道路のそば（50m 以内）に建てます', pr ->> 'n';
  end if;
  if coalesce((pr ->> 'sta')::boolean, false) then   -- 駅直結ビル（DB の更新109）：自分の駅のとなり
    zsta := _mp_sta_touch(p);
    if zsta is null then raise exception '%は自分の駅のとなり（ホームから 20m 以内）に建てます', pr ->> 'n'; end if;
  end if;
  -- 道路・線路・駅・車庫のかかっていない区画
  pcs := array(select v from (select pc.x, pc.y, row_number() over (order by pc.y, pc.x) rn from mp_pcells pc where pc.parcel = p.id
                                and not exists (select 1 from _mp_busy_cells(x0, y0, x1, y1) b where b.x = pc.x and b.y = pc.y)) q,
                lateral unnest(array[q.x, q.y]) with ordinality u(v, o) order by q.rn, u.o);
  if coalesce(array_length(pcs, 1), 0) = 0 then raise exception '道路・線路・駅・車庫がかかっている土地には建てられません'; end if;
  f0 := (pr ->> 'f0')::int; f1 := (pr ->> 'f1')::int;
  if f1 = 0 then     -- 平らなもの（田畑・駐車場）：あいている区画ぜんぶ
    cs := pcs; cnt := array_length(cs, 1) / 2; fm2 := cnt * 100; fl := 0;
  else
    nmax := greatest(1, floor(p.n * cv + 0.5)::int);
    if not (coalesce(p_shape, 'full') = any(array(select jsonb_array_elements_text(pr -> 'sh')))) then raise exception 'この建物には、その形はえらべません'; end if;
    cs := _mp_bld_shape(pcs, coalesce(p_shape, 'full'), nmax);
    cnt := coalesce(array_length(cs, 1), 0) / 2;
    if cnt = 0 then raise exception 'この土地の形では、その形の建物は建てられません'; end if;
    fm2 := cnt * 85;
    f1 := least(f1, mf, floor(p.n * 100 * far / fm2)::int);
    if f1 < f0 then raise exception 'この土地では%は%階までしか建てられません（%は%階から。用途地域の容積率）', pr ->> 'n', greatest(f1, 0), pr ->> 'n', f0; end if;
    fl := least(f1, greatest(f0, coalesce(p_floors, f0)));
  end if;
  plan := _mp_bld_plan(pr, fl, fm2, p_opt);
  lv := p.val::numeric / greatest(p.n * 100, 1);
  select coalesce(sum(_mp_unit_mr(e ->> 'use', lv) * (e ->> 'm2')::int), 0) * coalesce((pr ->> 'rl')::numeric, 1) into rent from jsonb_array_elements(plan) e;
  return jsonb_build_object('kind', p_kind, 'name', pr ->> 'n', 'shape', coalesce(p_shape, 'full'), 'cells', to_jsonb(cs), 'fm2', fm2, 'f0', f0, 'f1', f1, 'floors', fl,
    'units', jsonb_array_length(plan), 'uses', (select jsonb_object_agg(us, n) from (select e ->> 'use' us, count(*) n from jsonb_array_elements(plan) e group by 1) q),
    'total_m2', case when fl = 0 then fm2 else fm2 * fl end, 'cost', round(case when fl = 0 then fm2 else fm2 * fl end * (pr ->> 'cpm')::numeric)::bigint,
    'rent_day', round(rent), 'cv', cv, 'far', far, 'plan', plan) || case when zsta is null then '{}'::jsonb else jsonb_build_object('sta', zsta) end;
end $$;

create or replace function public.mp_bld_options(p_parcel bigint, p_as text, p_cat text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; p mp_parcels; pr jsonb; out jsonb := '[]'::jsonb; zs text; zl text[]; zr jsonb; cv real := 1; far real := 99; mf int := 99;
        x0 int; y0 int; x1 int; y1 int; pcs int[]; npcs int; seaok boolean; expok boolean; nmax int; shc jsonb := '{}'::jsonb; sh text; cnt int; fm2 int; f0 int; f1 int; fl int;
        best jsonb; why text; plan jsonb; lv numeric; rent numeric; tot int; zz text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into p from mp_parcels where id = p_parcel;
  if not found or not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false) then raise exception 'あなた（この名義）の土地ではありません'; end if;
  x0 := (p.bb[1])[0]; y0 := (p.bb[1])[1]; x1 := (p.bb[0])[0] - 1; y1 := (p.bb[0])[1] - 1;
  zl := array(select distinct c.z from (select distinct _mp_t5(x) tx, _mp_t5(y) ty from mp_pcells where parcel = p.id) t, lateral _mp_cell(t.tx, t.ty) c);
  foreach zz in array zl loop
    zr := _mp_zone_rule(zz); cv := least(cv, (zr ->> 'cv')::real); far := least(far, (zr ->> 'far')::real); mf := least(mf, (zr ->> 'mf')::int);
  end loop;
  seaok := exists (select 1 from generate_series(_mp_t5(x0) - 2, _mp_t5(x1) + 2) gx, generate_series(_mp_t5(y0) - 2, _mp_t5(y1) + 2) gy, lateral _mp_cell(gx, gy) cc where cc.t in ('S', 'D'));
  expok := _mp_near_exp(x0, y0, x1, y1);   -- 高速道路のそば（サービスエリア・パーキングエリア。DB の更新103）
  pcs := array(select v from (select pc.x, pc.y, row_number() over (order by pc.y, pc.x) rn from mp_pcells pc where pc.parcel = p.id
                                and not exists (select 1 from _mp_busy_cells(x0, y0, x1, y1) bc where bc.x = pc.x and bc.y = pc.y)) q,
                lateral unnest(array[q.x, q.y]) with ordinality uu(v, o) order by q.rn, uu.o);
  npcs := coalesce(array_length(pcs, 1), 0) / 2;
  nmax := greatest(1, floor(p.n * cv + 0.5)::int);
  lv := p.val::numeric / greatest(p.n * 100, 1);
  for pr in select b from jsonb_array_elements(_mp_bld_presets()) b where not coalesce((b ->> 'gov')::boolean, false) and (p_cat is null or b ->> 'cat' = p_cat) loop
    best := null; why := null;
    if p.n < (pr ->> 'min')::int then why := format('%sには %s区画（%s㎡）以上の土地がいります', pr ->> 'n', pr ->> 'min', (pr ->> 'min')::int * 100);
    elsif p.n > (pr ->> 'max')::int then why := format('%sは %s区画（%s㎡）までの土地に建てます（分筆してください）', pr ->> 'n', pr ->> 'max', (pr ->> 'max')::int * 100);
    else
      zs := (select string_agg(_mp_zname(z1), '・') from unnest(zl) z1 where position(z1 in (pr ->> 'z')) = 0);
      if zs is not null then why := format('用途地域で建てられません（%s）', zs);
      elsif coalesce((pr ->> 'sea')::boolean, false) and not seaok then why := format('%sは海のそばに建てます', pr ->> 'n');
      elsif coalesce((pr ->> 'xw')::boolean, false) and not expok then why := format('%sは高速道路のそば（50m 以内）に建てます', pr ->> 'n');
      elsif coalesce((pr ->> 'sta')::boolean, false) and _mp_sta_touch(p) is null then why := format('%sは自分の駅のとなり（ホームから 20m 以内）に建てます', pr ->> 'n');   -- 駅直結ビル（DB の更新109）
      elsif npcs = 0 then why := '道路・線路・駅・車庫がかかっている土地には建てられません';
      end if;
    end if;
    if why is null then
      f0 := (pr ->> 'f0')::int; f1 := (pr ->> 'f1')::int;
      if f1 = 0 then
        best := jsonb_build_object('shape', 'full', 'fl', 0, 'fm2', npcs * 100);
      else
        for sh in select jsonb_array_elements_text(pr -> 'sh') loop
          if not shc ? sh then shc := shc || jsonb_build_object(sh, coalesce(array_length(_mp_bld_shape(pcs, sh, nmax), 1), 0) / 2); end if;
          cnt := (shc ->> sh)::int;
          if cnt = 0 then why := coalesce(why, 'この土地の形では、その形の建物は建てられません'); continue; end if;
          fm2 := cnt * 85;
          fl := least(f1, mf, floor(p.n * 100 * far / fm2)::int);
          if fl < f0 then why := coalesce(why, format('この土地では%sは%s階までしか建てられません（%sは%s階から。用途地域の容積率）', pr ->> 'n', greatest(fl, 0), pr ->> 'n', f0)); continue; end if;
          if best is null or fm2 * fl > (best ->> 'fm2')::int * (best ->> 'fl')::int then best := jsonb_build_object('shape', sh, 'fl', fl, 'fm2', fm2); end if;
        end loop;
      end if;
    end if;
    if best is not null then
      fl := (best ->> 'fl')::int; fm2 := (best ->> 'fm2')::int;
      plan := _mp_bld_plan(pr, fl, fm2, '');
      select coalesce(sum(_mp_unit_mr(e ->> 'use', lv) * (e ->> 'm2')::int), 0) * coalesce((pr ->> 'rl')::numeric, 1) into rent from jsonb_array_elements(plan) e;
      tot := case when fl = 0 then fm2 else fm2 * fl end;
      out := out || jsonb_build_array(jsonb_build_object('k', pr ->> 'k', 'ok', true, 'shape', best -> 'shape', 'f1', fl, 'total_m2', tot,
               'cost', round(tot * (pr ->> 'cpm')::numeric), 'rent_day', round(rent), 'units', jsonb_array_length(plan)));
    else
      out := out || jsonb_build_array(jsonb_build_object('k', pr ->> 'k', 'ok', false, 'why', why));
    end if;
  end loop;
  return out;
end $$;

create or replace function public.mp_bld_build(p_parcel bigint, p_kind text, p_shape text, p_floors int, p_opt text, p_name text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; p mp_parcels; q jsonb; bid bigint; x0 int; y0 int; x1 int; y1 int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国は建物を建てません'; end if;
  select * into p from mp_parcels where id = p_parcel for update;
  if not found or not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false) then raise exception 'あなた（この名義）の土地ではありません'; end if;
  if p.bld is not null then raise exception 'もう建物があります（先にこわしてください）'; end if;
  if char_length(coalesce(p_name, '')) > 30 then raise exception '名前は30文字までです'; end if;
  q := _mp_bld_check(p, p_kind, p_shape, p_floors, p_opt);
  if nullif(btrim(coalesce(p_name, '')), '') is null and q ? 'sta' then   -- 駅直結ビル（DB の更新109）：はじめの名前は 駅の名前から
    p_name := left((select regexp_replace(s.name, '駅$', '') from mp_stations s where s.id = (q ->> 'sta')::bigint) || '駅ビル', 30);
  end if;
  perform _mp_pay(pa.pu, pa.pc, false, (q ->> 'cost')::bigint, 'bld', format('%s（%s㎡）を建てた', q ->> 'name', q ->> 'total_m2'));
  bid := _mp_bld_make(p.id, q, p_opt, p_name, (q ->> 'cost')::bigint, false);
  perform _mp_sc_touch(bid);   -- 施設なら、客をすぐ数える（t54m）
  if _mp_term_kind(p_kind) is not null then perform _mp_port_open(bid); end if;   -- フェリーターミナル：港（乗り場・船の置き場。t54o）・空港：乗り場・駐機場（t54p）
  x0 := (p.bb[1])[0]; y0 := (p.bb[1])[1]; x1 := (p.bb[0])[0] - 1; y1 := (p.bb[0])[1] - 1;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(x0), _mp_t5(y0)), point(_mp_t5(x1) + 1, _mp_t5(y1) + 1)));
  return (q - 'plan') || jsonb_build_object('id', bid, 'bname', (select name from mp_blds where id = bid));
end $$;

create or replace function public._mp_sc_init(bid bigint) returns void
language plpgsql set search_path = public as $$
declare b mp_blds; pr jsonb; cx real; cy real;
begin
  select * into b from mp_blds where id = bid; if not found then return; end if;
  select x into pr from jsonb_array_elements(_mp_bld_presets()) x where x ->> 'k' = b.kind;
  if pr is null or not (pr ? 'sc' or pr ? 'mk') then return; end if;
  select avg(b.cells[2 * i - 1] + 0.5) / 5, avg(b.cells[2 * i] + 0.5) / 5 into cx, cy from generate_series(1, array_length(b.cells, 1) / 2) i;
  insert into mp_sc(bld, prod, grp, x, y, lv) values (bid, pr ->> 'mk', pr ->> 'sc', cx, cy, case when pr ->> 'mk' in ('railcar', 'ship') then 0.9 else 1 end)   -- 車両・船は定価の90%から
    on conflict (bld) do nothing;
  -- 学校・特殊工場は、はじめは「自分で使う」（建てた人・会社が動かす。入居募集・テナント募集にも変えられる）
  if coalesce((pr ->> 'self1')::boolean, false) then   -- 駅直結ビル（DB の更新109）：1階（はじめの部屋）だけ。上の階は テナント募集のまま
    update mp_units set mode = 'self' where id = (select zu.id from mp_units zu where zu.bld = bid order by zu.floor, zu.no limit 1) and t_kind is null and mode = 'npc';
  else
    update mp_units set mode = 'self' where bld = bid and t_kind is null and mode = 'npc';
  end if;
end $$;

create or replace function public._mp_sc_school_calc(h timestamptz, p_only bigint default null) returns void
language plpgsql set search_path = public as $$
declare kd jsonb := _mp_sc_kinds(); mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
begin
  -- 駅の1日の乗り降り（系統の24時間の乗った人 × 2 を、止まる駅で分ける）
  drop table if exists _sflow;
  create temp table _sflow on commit drop as
    select st.id, st.x / 100.0 sx, st.y / 100.0 sy, sum(coalesce(hs.s, 0) * 2.0 / greatest(array_length(r.stops, 1), 1)) flow
      from mp_routes r join mp_stations st on st.id = any(r.stops)
      left join lateral (select sum(hh.served) s from mp_hours hh where hh.route = r.id and hh.hour > h - interval '24 hours') hs on true
     where r.ok group by st.id, st.x, st.y;
  drop table if exists _scs;
  create temp table _scs on commit drop as
    select s.bld, s.grp, s.x, s.y, s.lv, op.ok, op.npc, op.gv, op.m2,
           -- t59h：町の景色（AIの会社・国営の会社）の施設は、客を分けあわない（プレイヤーの施設の客をへらさない）
           case when (op.ok or op.npc) and not (p.own_c is not null and _mp_ai_quiet(p.own_c)) then floor(op.m2 / (kd -> s.grp ->> 'spp')::real)::int + coalesce(at_.cap, 0)::int else 0 end cap, 0::real pool, 1::real acc,
           coalesce(at_.ap, 0)::real aap,   -- アトラクション（DB の更新91）：定員がふえ、来たい人も ふえる
           coalesce((b.dem -> 'fx' ->> (kd -> s.grp ->> 'use'))::real, 0) fxv, p.val::numeric / greatest(p.n * 100, 1) lvm2
      from mp_sc s join mp_blds b on b.id = s.bld join mp_parcels p on p.id = b.parcel, lateral _mp_sc_op(s.bld, h) op
      left join lateral (select sum((_mp_attr_kinds() -> a.kind ->> 'cap')::int) cap,
                                sum((_mp_attr_kinds() -> a.kind ->> 'ap')::real * _mp_attr_fresh(a.at, h)
                                    * case when coalesce(_mp_attr_kinds() -> a.kind -> 'pk', '[]'::jsonb) @> to_jsonb(mo) then 1.3 else 1 end) ap
                           from mp_attrs a where a.bld = s.bld) at_ on true
     where s.grp is not null and kd ? s.grp;
  create index on _scs (grp, x);   -- 5×5（DB の更新52）：同じ種類の近くの施設を、索引でさがす（施設が多くなっても速く）
  analyze _scs;
  -- 駅で通えるか：列車の走る駅が 750m 以内 → 1・バス停が 500m 以内 → 0.8・どちらもない → 0.5（acc の種類だけ）
  update _scs t set acc = case when not coalesce((kd -> t.grp ->> 'acc')::boolean, false) then 1
      when exists (select 1 from mp_stations st where st.kind = 'rail' and st.x between (t.x - 15) * 100 and (t.x + 15) * 100 and st.y between (t.y - 15) * 100 and (t.y + 15) * 100
                     and (st.x / 100.0 - t.x) ^ 2 + (st.y / 100.0 - t.y) ^ 2 <= 225 and exists (select 1 from mp_routes r where r.ok and st.id = any(r.stops))) then 1
      when exists (select 1 from mp_stations st where st.kind = 'bus' and st.x between (t.x - 10) * 100 and (t.x + 10) * 100 and st.y between (t.y - 10) * 100 and (t.y + 10) * 100
                     and (st.x / 100.0 - t.x) ^ 2 + (st.y / 100.0 - t.y) ^ 2 <= 100 and exists (select 1 from mp_routes r where r.ok and st.id = any(r.stops))) then 0.8
      else 0.5 end
   where cap > 0 and (p_only is null or t.bld = p_only);
  -- 来る人：まわりの人 × わりあい ＋ 近くの駅の乗り降り × わりあい。駅で通えるか・まわりの建物の効果（fx）・季節
  update _scs t set pool = (_mp_catch(t.x, t.y, (kd -> t.grp ->> 'r')::real) * (kd -> t.grp ->> 'age')::real
                            + coalesce((kd -> t.grp ->> 'rs')::real, 0) * coalesce((select sum(f.flow) from _sflow f where f.sx between t.x - coalesce((kd -> t.grp ->> 'rr')::real, 15) and t.x + coalesce((kd -> t.grp ->> 'rr')::real, 15) and f.sy between t.y - coalesce((kd -> t.grp ->> 'rr')::real, 15) and t.y + coalesce((kd -> t.grp ->> 'rr')::real, 15)
                                                                                     and (f.sx - t.x) ^ 2 + (f.sy - t.y) ^ 2 <= coalesce((kd -> t.grp ->> 'rr')::real, 15) ^ 2), 0))   -- rr：駅をさがす はんい（マス。駅直結ビルは 5。DB の更新109）
                           * t.acc * greatest(0.1, 1 + t.fxv) * (1 + t.aap)
                           * case when coalesce(kd -> t.grp -> 'pk', '[]'::jsonb) @> to_jsonb(mo) then 1.3 when coalesce(kd -> t.grp -> 'op', '[]'::jsonb) @> to_jsonb(mo) then 0.75 else 1 end
   where cap > 0 and (p_only is null or t.bld = p_only);
  -- 同じ種類の施設で分けあう（通える範囲の中の定員のわりあい）。人・会社の施設は、値段の水準が高いと減る。値段（1人・1日）：地価が高いと高い（loc の種類）
  update mp_sc s set st = jsonb_build_object('n', q.n, 'cap', q.cap, 'pool', round(q.pool), 'acc', q.acc, 'at', h, 'fee', round((kd -> q.grp ->> 'fee')::numeric * round(q.lv::numeric, 2) * q.locf))
    from (select t.bld, t.grp, t.lv, t.cap, t.pool, t.acc,
                 case when coalesce((kd -> t.grp ->> 'loc')::boolean, false) then greatest(0.6, least(8, sqrt(t.lvm2 / 2500.0))) else 1 end locf,
                 case when t.cap = 0 then 0 else least(t.cap, floor(t.pool * t.cap
                   / greatest(1, (select sum(u.cap) from _scs u where u.grp = t.grp and u.cap > 0 and u.x between t.x - (kd -> t.grp ->> 'r')::real and t.x + (kd -> t.grp ->> 'r')::real
                                     and u.y between t.y - (kd -> t.grp ->> 'r')::real and t.y + (kd -> t.grp ->> 'r')::real
                                     and (u.x - t.x) ^ 2 + (u.y - t.y) ^ 2 <= ((kd -> t.grp ->> 'r')::real) ^ 2))
                   * power(case when t.ok and not t.gv then greatest(t.lv, 0.5) else 1 end, -1.5)))::int end n
            from _scs t where p_only is null or t.bld = p_only) q
   where s.bld = q.bld;
  drop table if exists _scs; drop table if exists _sflow;
end $$;

create or replace function public._mp_sc_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare gd jsonb := _mp_goods(); rc jsonb := _mp_sc_recipes(); kd jsonb := _mp_sc_kinds();
        imul numeric := _mp_rate('sc_imp'); mmul numeric := _mp_rate('sc_mkt'); tb numeric := _mp_rate('truck_base'); tk numeric := _mp_rate('truck_km');
        fkm numeric := _mp_rate('sc_food_km'); smul numeric := _mp_rate('sc_shop'); rcm2 numeric := _mp_rate('rc_m2'); keep numeric := _mp_rate('sc_keep');
        fa record; cb record; sp record; gk text; kq numeric; need numeric; qq numeric; have numeric; mk numeric; uc numeric; amt bigint; shp bigint; bal numeric;
        gp numeric; wt numeric; buf numeric; tq numeric; ta numeric; ts numeric; nn int; mul numeric;
        rdm2 numeric := _mp_rate('rd_m2'); trkkm numeric := _mp_rate('trk_tkm'); capl numeric; ownq numeric; tr2 record;
        fp record; dkm numeric; ff bigint; ffs numeric;   -- t54o：フェリー（海をこえる荷物）
        kbw numeric;   -- 場外馬券売り場（DB の更新92）
begin
  -- 学校：生徒
  perform _mp_sc_school_calc(h);
  -- 場外馬券売り場（DB の更新92）：この1時間（h-1 〜 h）のレースの数と格。ふだんの1日（昼・夕方・夜・深夜で 50レースくらい）で1日分の手数料
  kbw := coalesce((select sum(_mp_race_w(kr.grade)) from keiba_races kr where kr.post >= h - interval '1 hour' and kr.post < h), 0) / 50.0;
  -- 施設の売上（人・会社が動かしている施設）：学校は授業料、宿泊は宿泊料、医療・福祉は診療報酬など、娯楽は入場料など
  for fa in select scx.bld, scx.grp, (scx.st ->> 'n')::int sn, coalesce((scx.st ->> 'fee')::numeric, (kd -> scx.grp ->> 'fee')::numeric) fee, kd -> scx.grp ->> 'use' fuse,
                   coalesce(nullif(blx.name, ''), kd -> scx.grp ->> 'n') name, opx.pu, opx.pc,
                   least(1, extract(epoch from h - blx.built_at) / 3600.0)::numeric fr      -- 建ててから1時間たっていなければ、その分だけ
              from mp_sc scx join mp_blds blx on blx.id = scx.bld, lateral _mp_sc_op(scx.bld, h) opx
             where scx.grp is not null and opx.ok and not opx.gv and coalesce((scx.st ->> 'n')::int, 0) > 0 loop
    amt := round(fa.sn * fa.fee * case when fa.grp = 'kbshop' then kbw else 1.0 / 24 end * fa.fr);   -- 場外馬券売り場は、レースのある時間だけ（DB の更新92）
    if amt > 0 then
      perform _mp_earn(fa.pu, fa.pc, false, amt, case when fa.fuse = 'school' then 'tuition' else 'fee' end,
                       format(case when fa.grp = 'kbshop' then '馬券の手数料：%s（%s人）' else case fa.fuse when 'school' then '授業料：%s（%s人）' when 'hotel' then '宿泊料：%s（%s人）' when 'hospital' then '診療報酬など：%s（%s人）'
                                           when 'shop' then 'お店の売り上げ：%s（%s人）' else '入場料など：%s（%s人）' end end, fa.name, fa.sn));
      insert into mp_sclog(at, bld, k, qty, amt) values (h, fa.bld, 'fee', fa.sn, amt);
    end if;
  end loop;

  -- この1時間に動いている工場・田畑・港（人・会社が動かしているもの）
  drop table if exists _sco;
  create temp table _sco on commit drop as
    select scx.bld, scx.prod, scx.imp, scx.lv, scx.x, scx.y, blx.kind,
           coalesce(nullif(blx.name, ''), _mp_bld_pmap() -> blx.kind ->> 'n', '') name,
           opx.pu, opx.pc, opx.m2 * coalesce((_mp_bld_pmap() -> blx.kind ->> 'rb')::numeric, 1) m2, _mp_sc_owes(opx.pu, opx.pc) owes,
           least(1, extract(epoch from h - blx.built_at) / 3600.0)::numeric fr      -- 建ててから1時間たっていなければ、その分だけつくる
      from mp_sc scx join mp_blds blx on blx.id = scx.bld, lateral _mp_sc_op(scx.bld, h) opx
     where scx.prod is not null and rc ? scx.prod and opx.ok and not opx.gv;

  -- 1) つくる（材料の在庫の分だけ。田畑・港は材料なし）
  for fa in select * from _sco o where o.prod not in ('railcar', 'ship') and not o.owes order by o.bld loop
    mk := (rc -> fa.prod ->> 'r')::numeric * fa.m2 / 24 * fa.fr;
    for gk, kq in select e.key, e.value::text::numeric from jsonb_each(rc -> fa.prod -> 'in') e loop
      have := coalesce((select stk.qty from mp_stock stk where stk.bld = fa.bld and stk.good = gk), 0);
      mk := least(mk, have / kq);
    end loop;
    mk := floor(mk * 10000) / 10000;
    if mk <= 0 then continue; end if;
    for gk, kq in select e.key, e.value::text::numeric from jsonb_each(rc -> fa.prod -> 'in') e loop
      update mp_stock stk set qty = greatest(0, stk.qty - round(mk * kq, 4)) where stk.bld = fa.bld and stk.good = gk;
      insert into mp_sclog(at, bld, k, good, qty) values (h, fa.bld, 'use', gk, round(mk * kq, 4));
    end loop;
    insert into mp_stock(bld, good, qty) values (fa.bld, fa.prod, mk) on conflict (bld, good) do update set qty = mp_stock.qty + excluded.qty;
    amt := round(mk * (gd -> fa.prod ->> 'p')::numeric * (rc -> fa.prod ->> 'oc')::numeric);
    if amt > 0 then amt := _mp_soft_pay(fa.pu, fa.pc, false, amt, 'goods', rc -> fa.prod ->> 'ocn'); end if;
    insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'make', fa.prod, mk, 0);
    if amt > 0 then insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'cost', fa.prod, 0, amt); end if;
  end loop;

  -- 自分のトラック（t54l）：名義ごとの1時間の輸送力（t・km）。積める重さ × trk_tkm ÷ 24。納車まち・工事中・状態が20より悪いものはのぞく。
  --   営業所のまわり 20km の道が混んでいると、へる（いちばん半分。DB の更新67）
  --   1t 運ぶごとに（距離 + 10km）分を使う（積みおろし）。動いているトラックターミナル1つごとに +10%（3つまで）
  drop table if exists _trk;
  create temp table _trk on commit drop as
    select cx.own_u pu, cx.own_c pc, (sum(tx.load * coalesce(jf.f, 1)) * trkkm / 24.0)::numeric cap, 0::numeric used, count(*) n
      from mp_cars cx join mp_types tx on tx.code = cx.type
      left join lateral (select 1 - 0.5 * _mp_jam_idx(dp.x / 100.0, dp.y / 100.0) f from mp_depots dp where dp.id = cx.depot) jf on true   -- 渋滞（DB の更新67）
     where tx.role = 'Truck' and tx.load > 0 and (cx.busy_until is null or cx.busy_until <= h) and cx.cond >= 20
     group by cx.own_u, cx.own_c;
  update _trk t2 set cap = t2.cap * (1 + 0.1 * least(3, (select count(*) from mp_blds bt, lateral _mp_sc_op(bt.id, h) ot
                                                         where bt.kind = 'truckterm' and ot.ok and not ot.gv and ot.pu is not distinct from t2.pu and ot.pc is not distinct from t2.pc))) where true;

  -- 2) 仕入れ（トラック）：材料のいる工場が、近くの工場・田畑・港の在庫から買う（市場の値段＋運送費）。輸入のほうが安いとき・足りないときは輸入。
  --   自分のトラックで運べる分は運送費なし。海をこえるときは、航路のフェリーにトラックをのせる（のせられる重さまで。運賃は航路の持ち主に。t54o）
  perform _mp_ferry_links(h);
  for cb in select * from _sco o where not o.owes and (rc -> o.prod -> 'in') <> '{}'::jsonb order by random() loop
    for gk, kq in select e.key, e.value::text::numeric from jsonb_each(rc -> cb.prod -> 'in') e loop
      if cb.prod = 'railcar' then need := greatest(1, floor(cb.m2 / rcm2)) * 3 * 35;   -- 3日分（1両 35t くらい）
      elsif cb.prod = 'ship' then need := cb.m2 * _mp_rate('sy_tpd') * 3 * _mp_rate('sy_steel');   -- 造船所：3日分（t54o）
      else need := (rc -> cb.prod ->> 'r')::numeric * cb.m2 * kq;                         -- 1日分
      end if;
      if cb.prod = 'car' then need := need + greatest(1, floor(cb.m2 / rdm2)) * 2 * 10; end if;   -- 自動車工場：バス・トラックの注文の分（2日分・1台 10t くらい）
      need := round(need - coalesce((select stk.qty from mp_stock stk where stk.bld = cb.bld and stk.good = gk), 0), 4);
      if need <= 0.001 then continue; end if;
      gp := (gd -> gk ->> 'p')::numeric; wt := (gd -> gk ->> 'wt')::numeric;
      for sp in select o.bld, o.name, o.pu, o.pc, stk.qty, (sqrt((o.x - cb.x) ^ 2 + (o.y - cb.y) ^ 2) * 0.05 * 1.25)::numeric km, o.x sx, o.y sy
                  from _sco o join mp_stock stk on stk.bld = o.bld and stk.good = gk
                 where o.prod = gk and o.bld <> cb.bld and stk.qty > 0.001
                 order by 6, o.bld loop
        select * into fp from _mp_ferry_pick(sp.sx, sp.sy, cb.x, cb.y, cb.pu, cb.pc);
        if fp.n = 1 and fp.f_route is null then continue; end if;   -- 海の向こう：フェリーがない（のせられない）
        dkm := case when fp.n = 1 then fp.tkm else sp.km end;        -- トラックで走る km（フェリーのときは港まで・港から）
        uc := gp + wt * (tb + tk * dkm) + case when fp.n = 1 then wt * fp.fare else 0 end;
        if uc > gp * imul then if fp.n = 1 then continue; end if; exit; end if;   -- 輸入のほうが安い
        bal := _mp_bal(cb.pu, cb.pc) - 2;
        qq := floor(least(need, sp.qty, greatest(bal, 0) / uc, case when fp.n = 1 then fp.room / wt else need end) * 1000) / 1000;
        if qq <= 0 then if fp.n = 1 then continue; end if; exit; end if;
        -- 自分のトラックで運べる分（運送費なし）
        ownq := 0; capl := coalesce((select t2.cap - t2.used from _trk t2 where t2.pu is not distinct from cb.pu and t2.pc is not distinct from cb.pc), 0);
        if capl > 0.001 then
          ownq := least(qq, capl / (dkm + 10));
          update _trk t2 set used = t2.used + ownq * (dkm + 10) where t2.pu is not distinct from cb.pu and t2.pc is not distinct from cb.pc;
          insert into mp_sclog(at, bld, k, good, qty, amt, peer, km) values (h, cb.bld, 'own', gk, ownq, 0, sp.bld, dkm);
        end if;
        amt := round(qq * gp); shp := round((qq - ownq) * wt * (tb + tk * dkm));
        if fp.n = 1 then   -- フェリー（トラックをのせる）
          perform _mp_ferry_use(fp.f_route, fp.f_dir, qq * wt);
          ff := round(qq * wt * fp.fare);
          if ff > 0 then
            perform _mp_pay(cb.pu, cb.pc, false, ff, 'ship', format('フェリー（トラック）：%s %s・海 %skm', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), round(fp.skm::numeric, 1)));
            perform _mp_earn(fp.f_ru, fp.f_rc, false, ff, 'ferry', format('フェリーの運賃（トラック・%s %s）', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u')));
          end if;
          insert into mp_sclog(at, bld, k, good, qty, amt, peer, km) values (h, cb.bld, 'ferry', gk, qq, ff, sp.bld, fp.skm);
        end if;
        update mp_stock stk set qty = greatest(0, stk.qty - qq) where stk.bld = sp.bld and stk.good = gk;
        insert into mp_stock(bld, good, qty) values (cb.bld, gk, qq) on conflict (bld, good) do update set qty = mp_stock.qty + excluded.qty;
        perform _mp_pay(cb.pu, cb.pc, false, amt, 'goods', format('仕入れ：%s %s（%s から・%skm）', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), sp.name, round(sp.km, 1)));
        perform _mp_earn(sp.pu, sp.pc, false, amt, 'sales', format('売上：%s %s（%s へ・%skm）', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), cb.name, round(sp.km, 1)));
        if shp > 0 then perform _mp_pay(cb.pu, cb.pc, false, shp, 'ship', format('運送費（トラック）：%s %s・%skm', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u'), round(sp.km, 1))); end if;
        insert into mp_sclog(at, bld, k, good, qty, amt, peer, km) values (h, cb.bld, 'buy', gk, qq, amt, sp.bld, sp.km), (h, sp.bld, 'sell', gk, qq, amt, cb.bld, sp.km),
                                                                          (h, cb.bld, 'ship', gk, qq, shp, sp.bld, sp.km);
        need := need - qq;
        exit when need <= 0.001;
      end loop;
      -- 輸入
      if need > 0.001 and cb.imp then
        bal := _mp_bal(cb.pu, cb.pc) - 2;
        qq := floor(least(need, greatest(bal, 0) / (gp * imul)) * 1000) / 1000;
        if qq > 0 then
          amt := round(qq * gp * imul);
          perform _mp_pay(cb.pu, cb.pc, false, amt, 'goods', format('輸入：%s %s', gd -> gk ->> 'n', _mp_fmtq(qq, gd -> gk ->> 'u')));
          insert into mp_stock(bld, good, qty) values (cb.bld, gk, qq) on conflict (bld, good) do update set qty = mp_stock.qty + excluded.qty;
          insert into mp_sclog(at, bld, k, good, qty, amt) values (h, cb.bld, 'imp', gk, qq, amt);
        end if;
      end if;
    end loop;
  end loop;

  -- 3) 食品をお店へ（人・会社・町の人が入っているお店。床の広さで売れる量。30km まで。近いお店から）
  if exists (select 1 from _sco o join mp_stock stk on stk.bld = o.bld and stk.good = 'food' where o.prod = 'food' and stk.qty > 0.001) then
    drop table if exists _shop; drop table if exists _marg;
    create temp table _shop on commit drop as
      select ux.id, (blx.cells[1] + 0.5) / 5.0 sx, (blx.cells[2] + 0.5) / 5.0 sy, (ux.m2 * _mp_rate('sc_food') / 24)::numeric dem,
             case when ux.t_kind = 'corp' then null else pcl.own_u end pu, case when ux.t_kind = 'corp' then ux.t_c else pcl.own_c end pc,
             ((ux.mode = 'self' and ux.t_kind is null) or (ux.t_kind = 'corp' and ux.t_c is not null)) pl
        from mp_units ux join mp_blds blx on blx.id = ux.bld join mp_parcels pcl on pcl.id = blx.parcel
       where ux.use = 'shop' and not pcl.gov and (ux.t_kind is not null or ux.mode = 'self') and blx.built_at < h - interval '1 hour';
    create temp table _marg (pu uuid, pc int, a numeric) on commit drop;
    drop table if exists _ffare;
    create temp table _ffare (ru uuid, rc int, a numeric, q numeric) on commit drop;   -- フェリーの運賃（食品をお店へ。t54o）
    gp := (gd -> 'food' ->> 'p')::numeric; wt := (gd -> 'food' ->> 'wt')::numeric;
    for fa in select o.*, stk.qty from _sco o join mp_stock stk on stk.bld = o.bld and stk.good = 'food' where o.prod = 'food' and stk.qty > 0.001 order by o.bld loop
      have := fa.qty; tq := 0; ta := 0; ts := 0; nn := 0;
      for sp in select shx.id, shx.dem, shx.pu, shx.pc, shx.pl, (sqrt((shx.sx - fa.x) ^ 2 + (shx.sy - fa.y) ^ 2) * 0.05 * 1.25)::numeric km, shx.sx, shx.sy
                  from _shop shx
                 where shx.dem > 0.00001 and shx.sx between fa.x - fkm / 0.0625 and fa.x + fkm / 0.0625 and shx.sy between fa.y - fkm / 0.0625 and fa.y + fkm / 0.0625
                 order by 6, shx.id loop
        exit when sp.km > fkm;
        select * into fp from _mp_ferry_pick(fa.x, fa.y, sp.sx, sp.sy, fa.pu, fa.pc);   -- 海の向こうのお店：フェリー（t54o）
        if fp.n = 1 and (fp.f_route is null or fp.room < 0.001) then continue; end if;
        qq := least(have, sp.dem, case when fp.n = 1 then fp.room / wt else have end);
        if fp.n = 1 then
          perform _mp_ferry_use(fp.f_route, fp.f_dir, qq * wt);
          ffs := qq * wt * fp.fare;
          if ffs > 0 then insert into _ffare values (fp.f_ru, fp.f_rc, ffs, qq); end if;
        end if;
        update _shop shx set dem = shx.dem - qq where shx.id = sp.id;
        -- 自分のトラックで運べる分（運送費なし）
        ownq := 0; capl := coalesce((select t2.cap - t2.used from _trk t2 where t2.pu is not distinct from fa.pu and t2.pc is not distinct from fa.pc), 0);
        if capl > 0.001 then
          ownq := least(qq, capl / (case when fp.n = 1 then fp.tkm else sp.km end + 10));
          update _trk t2 set used = t2.used + ownq * (case when fp.n = 1 then fp.tkm else sp.km end + 10) where t2.pu is not distinct from fa.pu and t2.pc is not distinct from fa.pc;
        end if;
        have := have - qq; tq := tq + qq; ta := ta + qq * gp; ts := ts + (qq - ownq) * wt * (tb + tk * case when fp.n = 1 then fp.tkm else sp.km end); nn := nn + 1;
        if sp.pl then insert into _marg values (sp.pu, sp.pc, qq * gp * smul); end if;
        exit when have <= 0.00001;
      end loop;
      if tq > 0 then
        update mp_stock stk set qty = greatest(0, stk.qty - tq) where stk.bld = fa.bld and stk.good = 'food';
        amt := round(ta); shp := round(ts);
        perform _mp_earn(fa.pu, fa.pc, false, amt, 'sales', format('お店に売った：食品 %s（%s軒）', _mp_fmtq(tq, 't'), nn));
        if shp > 0 then shp := _mp_soft_pay(fa.pu, fa.pc, false, shp, 'ship', format('運送費（トラック）：お店 %s軒へ', nn)); end if;
        insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'shop', 'food', tq, amt);
        if shp > 0 then insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'ship', 'food', tq, shp); end if;
      end if;
      -- フェリーの運賃（海の向こうのお店へ。航路の持ち主ごと）
      for tr2 in select f.ru, f.rc, sum(f.a) a, sum(f.q) q from _ffare f group by f.ru, f.rc loop
        ff := round(tr2.a);
        if ff > 0 then
          ff := _mp_soft_pay(fa.pu, fa.pc, false, ff, 'ship', format('フェリー（トラック）：食品 %s', _mp_fmtq(tr2.q, 't')));
          if ff > 0 then perform _mp_earn(tr2.ru, tr2.rc, false, ff, 'ferry', format('フェリーの運賃（トラック・食品 %s）', _mp_fmtq(tr2.q, 't'))); end if;
          insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'ferry', 'food', tr2.q, ff);
        end if;
      end loop;
      delete from _ffare where true;
    end loop;
    -- 人・会社が使っているお店：小売のもうけ
    for fa in select m.pu, m.pc, sum(m.a) a from _marg m group by m.pu, m.pc loop
      amt := round(fa.a);
      if amt > 0 then perform _mp_earn(fa.pu, fa.pc, false, amt, 'sales', '食品の販売（お店のもうけ）'); end if;
    end loop;
    drop table if exists _shop; drop table if exists _marg;
  end if;

  -- 4) 市場に売る：最後の品（自動車・家電・半導体は1倍、お店に売れのこった食品は 0.85倍）はぜんぶ。ほかは sc_keep 日分（6時間分）をこえた分。いまはつくらない・使わない品目もぜんぶ
  for fa in select o.*, stk.good, stk.qty from _sco o join mp_stock stk on stk.bld = o.bld where stk.qty > 0.001 order by o.bld, stk.good loop
    if (rc -> fa.prod -> 'in') ? fa.good then continue; end if;          -- 材料
    if fa.good = fa.prod then buf := case when gd -> fa.good ? 'fin' then 0 else (rc -> fa.prod ->> 'r')::numeric * fa.m2 * keep end;
    else buf := 0; end if;
    qq := floor((fa.qty - buf) * 10000) / 10000;
    if qq <= 0.0005 or not (gd ? fa.good) then continue; end if;
    mul := case when gd -> fa.good ->> 'fin' = 'mkt' then 1 else mmul end;
    amt := round(qq * (gd -> fa.good ->> 'p')::numeric * mul);
    update mp_stock stk set qty = greatest(0, stk.qty - qq) where stk.bld = fa.bld and stk.good = fa.good;
    if amt > 0 then perform _mp_earn(fa.pu, fa.pc, false, amt, 'sales', format('市場に売った：%s %s', gd -> fa.good ->> 'n', _mp_fmtq(qq, gd -> fa.good ->> 'u'))); end if;
    insert into mp_sclog(at, bld, k, good, qty, amt) values (h, fa.bld, 'mkt', fa.good, qq, amt);
  end loop;
  -- 自分のトラックのいたみ（その1時間に使ったわりあいで。寿命をすぎると2倍）
  for tr2 in select * from _trk t2 where t2.used > 0 loop
    update mp_cars c set cond = greatest(0, c.cond - 0.035 * least(1, tr2.used / greatest(tr2.cap, 0.001))
                                             * case when now() - c.born > make_interval(days => (select ty.life from mp_types ty where ty.code = c.type) * (1 + c.renewed)) then 2 else 1 end)
     where c.own_u is not distinct from tr2.pu and c.own_c is not distinct from tr2.pc and (c.busy_until is null or c.busy_until <= h) and c.cond >= 20
       and c.type in (select ty.code from mp_types ty where ty.role = 'Truck');
  end loop;
  delete from mp_stock stk where stk.qty <= 0.0001;
  drop table if exists _sco; drop table if exists _trk;
end $$;

-- 地下街（DB の更新109）：きまり
--   はば 14m（通路 6m ＋ 両がわの お店 4m ずつ）。工事費 1m 30,000 X・維持費 1m 1日 40 X。お店の広さ 1m 8㎡（1.5㎡ で 1日 1人）
--   客：駅の1日の乗り降り × 8%（同じ駅の地下街で 長さで分ける）。1人 100 X
create or replace function public._mp_ugm_k() returns jsonb
language sql immutable as $$ select '{"w":14,"cpm":30000,"upm":40,"spm":8,"spp":1.5,"rs":0.08,"fee":100,"min":0.5,"max":20,"free":1.2,"near":1.0}'::jsonb $$;
-- 駅の1日の乗り降り（系統の24時間の乗った人 × 2 を、止まる駅で分ける。_mp_sc_school_calc と同じ）
create or replace function public._mp_ugm_flow(p_sta bigint, h timestamptz) returns real
language sql stable set search_path = public as $$
  select coalesce(sum(coalesce(hs.s, 0) * 2.0 / greatest(array_length(r.stops, 1), 1)), 0)::real
    from mp_routes r left join lateral (select sum(hh.served) s from mp_hours hh where hh.route = r.id and hh.hour > h - interval '24 hours' and hh.hour <= h) hs on true
   where r.ok and p_sta = any(r.stops)
$$;
-- 地下街の線を確かめる：p_pts［x0, y0, x1, y1, …］（1/100 マス）。はじめの点は 駅のそば（ホームから 50m 以内）。
--   駅のそば（ホームから 60m）より先は 道路の下（道路のはばの中 ＋ 5m。高速道路はのぞく）。長さ 25m〜1km・点 2〜80。ほかの地下街と重ならない（10m）
--   返す：{ok, why, len（マス）, m, cost, up（1日の維持費）, cap, flow, pool, n（見こみ）, rev（1日の売り上げの見こみ）, bb, bad［[x, y]…］（道路の下でないところ）, ov（重なるところ）}
create or replace function public._mp_ugm_chk(p_sta bigint, p_pts int[], pu uuid, pc int, p_skip bigint default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare zk jsonb := _mp_ugm_k(); zs mp_stations; zsg mp_segs; zn int := coalesce(array_length(p_pts, 1), 0) / 2; zl real := 0; zi int; zj int; zj0 int; zm int;
        zax real; zay real; zbx real; zby real; zd real; zx real; zy real; zsub int[]; zhw real; zpd real; zbad jsonb := '[]'::jsonb; znb int := 0; zov jsonb := '[]'::jsonb; zno int := 0;
        zwhy text; zfl real; zol real; zcap int; zpool real; zcnt int;
begin
  select * into zs from mp_stations where id = p_sta;
  if not found or zs.kind <> 'rail' or zs.seg is null then raise exception '鉄道の駅ではありません'; end if;
  if _mp_pperson(pu, pc) is null or _mp_pperson(zs.own_u, zs.own_c) is distinct from _mp_pperson(pu, pc) then raise exception '地下街は 自分の駅から つくります'; end if;
  if coalesce(array_length(p_pts, 1), 0) % 2 <> 0 or zn < 2 or zn > 80 then raise exception '地下街の点の数がちがいます（2〜80）'; end if;
  if exists (select 1 from unnest(p_pts) v where v is null) then raise exception '地下街の点がちがいます'; end if;
  select * into zsg from mp_segs where id = zs.seg;
  zsub := _mp_sub(zsg.pts, greatest(0, zs.at - zs.plat / 100.0), least(zsg.len, zs.at + zs.plat / 100.0));
  zhw := (0.22 * greatest(1, zs.tracks) + 0.18) / 2;   -- ホームのはばの半分（マス）
  for zi in 1..zn - 1 loop
    zl := zl + sqrt(((p_pts[2 * zi + 1] - p_pts[2 * zi - 1]) / 100.0) ^ 2 + ((p_pts[2 * zi + 2] - p_pts[2 * zi]) / 100.0) ^ 2);
  end loop;
  if (_mp_proj(zsub, p_pts[1] / 100.0, p_pts[2] / 100.0)).dist > (zk ->> 'near')::real + zhw then zwhy := '地下街は 駅のそば（ホームから 50m 以内）から はじめます';
  elsif zl < (zk ->> 'min')::real then zwhy := '地下街は 25m 以上にします';
  elsif zl > (zk ->> 'max')::real then zwhy := '地下街は 1km までです';
  else
    -- 10m（0.2 マス）ごとに しらべる
    for zi in 1..zn - 1 loop
      zax := p_pts[2 * zi - 1] / 100.0; zay := p_pts[2 * zi] / 100.0; zbx := p_pts[2 * zi + 1] / 100.0; zby := p_pts[2 * zi + 2] / 100.0;
      zd := sqrt((zbx - zax) ^ 2 + (zby - zay) ^ 2);
      zm := greatest(1, ceil(zd / 0.2)::int);
      zj0 := case when zi = 1 then 0 else 1 end;
      for zj in zj0..zm loop
        zx := zax + (zbx - zax) * zj / zm; zy := zay + (zby - zay) * zj / zm;
        zpd := (_mp_proj(zsub, zx, zy)).dist;
        if zpd > (zk ->> 'free')::real + zhw and not exists (
             select 1 from mp_segs zr where zr.kind = 'road' and zr.cls <> 'exp' and zr.bb && box(point(zx - 1, zy - 1), point(zx + 1, zy + 1))
                and (_mp_proj(zr.pts, zx, zy)).dist <= zr.w / 2 + 0.1) then
          znb := znb + 1;
          if jsonb_array_length(zbad) < 40 then zbad := zbad || jsonb_build_array(jsonb_build_array(round(zx * 100), round(zy * 100))); end if;
        end if;
        if zpd > zhw + 0.3 and exists (
             select 1 from mp_ugm zg where zg.id is distinct from p_skip and zg.bb && box(point(zx - 0.5, zy - 0.5), point(zx + 0.5, zy + 0.5))
                and (_mp_proj(zg.pts, zx, zy)).dist < 0.2) then
          zno := zno + 1;
          if jsonb_array_length(zov) < 40 then zov := zov || jsonb_build_array(jsonb_build_array(round(zx * 100), round(zy * 100))); end if;
        end if;
      end loop;
    end loop;
    if znb > 0 then zwhy := format('道路の下でないところがあります（約%sm）。駅のそばから先は 道路の上をなぞります', znb * 10);
    elsif zno > 0 then zwhy := format('ほかの地下街と重なっています（約%sm）', zno * 10);
    end if;
  end if;
  zfl := _mp_ugm_flow(p_sta, now());
  zol := coalesce((select sum(zg.len) from mp_ugm zg where zg.sta = p_sta and zg.id is distinct from p_skip), 0);
  zcap := floor(zl * 50 * (zk ->> 'spm')::real / (zk ->> 'spp')::real)::int;
  zpool := zfl * (zk ->> 'rs')::real;
  zcnt := least(zcap, floor(zpool * zl / greatest(zl + zol, 0.01)))::int;
  return jsonb_build_object('ok', zwhy is null, 'why', zwhy, 'len', round(zl::numeric, 3), 'm', round(zl * 50),
    'cost', round(zl * 50) * (zk ->> 'cpm')::bigint, 'up', round(zl * 50 * (zk ->> 'upm')::real), 'cap', zcap, 'flow', round(zfl), 'pool', round(zpool),
    'n', zcnt, 'rev', zcnt * (zk ->> 'fee')::int, 'fee', (zk ->> 'fee')::int, 'w', (zk ->> 'w')::int, 'others', (select count(*) from mp_ugm zg where zg.sta = p_sta and zg.id is distinct from p_skip),
    'sname', zs.name, 'bad', zbad, 'ov', zov,
    'bb', jsonb_build_array((select min(p_pts[2 * i - 1]) from generate_series(1, zn) i), (select min(p_pts[2 * i]) from generate_series(1, zn) i),
                            (select max(p_pts[2 * i - 1]) from generate_series(1, zn) i), (select max(p_pts[2 * i]) from generate_series(1, zn) i)));
end $$;
-- 地下街をつくる（p_dry なら見つもりだけ）。名前が空なら「駅の名前＋地下街」（同じ駅の2つ目から 番号）
create or replace function public.mp_ugm_build(p_sta bigint, p_pts int[], p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; zq jsonb; zid bigint; znm text; zbase text; zn int; zb jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国は地下街をつくりません'; end if;
  if char_length(coalesce(p_name, '')) > 30 then raise exception '名前は30文字までです'; end if;
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;
  zq := _mp_ugm_chk(p_sta, p_pts, pa.pu, pa.pc, null);
  if coalesce(p_dry, false) then return zq; end if;
  if not (zq ->> 'ok')::boolean then raise exception '%', zq ->> 'why'; end if;
  zbase := left(coalesce((select regexp_replace(s.name, '駅$', '') from mp_stations s where s.id = p_sta), ''), 24) || '地下街';
  znm := nullif(btrim(coalesce(p_name, '')), '');
  if znm is null then
    znm := zbase; zn := 1;
    while exists (select 1 from mp_ugm zg where zg.sta = p_sta and zg.name = znm) loop zn := zn + 1; znm := zbase || zn; end loop;   -- 2つ目から 番号
  end if;
  perform _mp_pay(pa.pu, pa.pc, false, (zq ->> 'cost')::bigint, 'bld', format('地下街「%s」（%sm）をつくった', znm, zq ->> 'm'));
  zb := zq -> 'bb';
  insert into mp_ugm(sta, own_u, own_c, pts, len, bb, name, cost)
    values (p_sta, pa.pu, pa.pc, p_pts, (zq ->> 'len')::real,
            box(point((zb ->> 0)::int / 100.0, (zb ->> 1)::int / 100.0), point((zb ->> 2)::int / 100.0, (zb ->> 3)::int / 100.0)), znm, (zq ->> 'cost')::bigint)
    returning id into zid;
  perform _mp_chg('ugm', zid, 'set', (select bb from mp_ugm where id = zid));
  return (zq - 'bad' - 'ov') || jsonb_build_object('id', zid, 'name', znm);
end $$;
-- 地下街のようす（地図でタップしたとき）
create or replace function public.mp_ugm_get(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); zg mp_ugm; zk jsonb := _mp_ugm_k(); me_cs int[]; zmine boolean;
begin
  perform _mp_ok(u);
  select * into zg from mp_ugm where id = p_id;
  if not found then raise exception '地下街がありません（こわされたかもしれません）'; end if;
  me_cs := array(select id from companies where owner = u);
  zmine := coalesce(zg.own_u = u or zg.own_c = any(me_cs), false);
  return jsonb_build_object('id', zg.id, 'name', zg.name, 'sta', zg.sta, 'sname', (select name from mp_stations where id = zg.sta),
    'm', round(zg.len * 50), 'w', (zk ->> 'w')::int, 'mine', zmine, 'who', _mp_pname(zg.own_u, zg.own_c, false),
    'n', (zg.st ->> 'n')::int, 'cap', coalesce((zg.st ->> 'cap')::int, floor(zg.len * 50 * (zk ->> 'spm')::real / (zk ->> 'spp')::real)::int), 'pool', (zg.st ->> 'pool')::int,
    'fee', (zk ->> 'fee')::int, 'up', case when zmine then round(zg.len * 50 * (zk ->> 'upm')::real) end,
    'rev', case when zmine and zg.st ? 'n' then (zg.st ->> 'n')::int * (zk ->> 'fee')::int end,
    'cost', case when zmine then zg.cost end, 'at', zg.created_at);
end $$;
-- 地下街の名前を変える
create or replace function public.mp_ugm_set(p_id bigint, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); zg mp_ugm; znm text := btrim(coalesce(p_name, ''));
begin
  perform _mp_ok(u);
  select * into zg from mp_ugm where id = p_id for update;
  if not found then raise exception '地下街がありません'; end if;
  if not coalesce(zg.own_u = u or zg.own_c in (select id from companies where owner = u), false) then raise exception 'あなたの地下街ではありません'; end if;
  if znm = '' or char_length(znm) > 30 then raise exception '名前は1〜30文字です'; end if;
  update mp_ugm set name = znm where id = p_id;
  perform _mp_chg('ugm', p_id, 'set', zg.bb);
  return jsonb_build_object('id', p_id, 'name', znm);
end $$;
-- 地下街をこわす（工事費はもどらない）
create or replace function public.mp_ugm_del(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); zg mp_ugm;
begin
  perform _mp_ok(u);
  select * into zg from mp_ugm where id = p_id for update;
  if not found then raise exception '地下街がありません'; end if;
  if not coalesce(zg.own_u = u or zg.own_c in (select id from companies where owner = u), false) then raise exception 'あなたの地下街ではありません'; end if;
  delete from mp_ugm where id = p_id;   -- 地図へは トリガー（_mp_ugm_gone）で知らせる
  return jsonb_build_object('id', p_id, 'name', zg.name);
end $$;
-- 地下街がなくなったら（こわした・駅がなくなった）地図に知らせる
create or replace function public._mp_ugm_gone() returns trigger
language plpgsql set search_path = public as $$
begin
  perform _mp_chg('ugm', old.id, 'del', old.bb);
  return old;
end $$;
drop trigger if exists mp_ugm_gone on public.mp_ugm;
create trigger mp_ugm_gone after delete on public.mp_ugm for each row execute function public._mp_ugm_gone();
-- 1時間ごと（_mp_tick）：地下街の客・売り上げ・維持費
create or replace function public._mp_ugm_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare zk jsonb := _mp_ugm_k(); zg record; zamt bigint; zup bigint;
begin
  if not exists (select 1 from mp_ugm) then return; end if;
  for zg in
    with zf as (select zs.sta, _mp_ugm_flow(zs.sta, h) flow, sum(zs.len) tl from mp_ugm zs group by zs.sta)
    select g.id, g.own_u, g.own_c, g.name, g.len, g.created_at, zf.flow,
           floor(g.len * 50 * (zk ->> 'spm')::real / (zk ->> 'spp')::real)::int cap,
           least(floor(g.len * 50 * (zk ->> 'spm')::real / (zk ->> 'spp')::real), floor(zf.flow * (zk ->> 'rs')::real * g.len / greatest(zf.tl, 0.01)))::int n
      from mp_ugm g join zf on zf.sta = g.sta order by g.id
  loop
    update mp_ugm set st = jsonb_build_object('n', zg.n, 'cap', zg.cap, 'pool', round(zg.flow * (zk ->> 'rs')::real), 'at', h) where id = zg.id;
    if zg.own_u is null and zg.own_c is null then continue; end if;
    zamt := round(zg.n * (zk ->> 'fee')::int / 24.0 * greatest(0, least(1, extract(epoch from h - zg.created_at) / 3600.0)));   -- つくってから1時間たっていなければ、その分だけ
    if zamt > 0 then perform _mp_earn(zg.own_u, zg.own_c, false, zamt, 'fee', format('地下街の売り上げ：%s（%s人）', zg.name, zg.n)); end if;
    zup := round(zg.len * 50 * (zk ->> 'upm')::real / 24.0);
    if zup > 0 then perform _mp_soft_pay(zg.own_u, zg.own_c, false, zup, 'upkeep', format('維持費（地下街：%s）', zg.name)); end if;
  end loop;
end $$;

create or replace function public._mp_tick() returns void
language plpgsql set search_path = public as $$
declare last timestamptz; h timestamptz; n int := 0;
begin
  if not exists (select 1 from mp_chunks limit 1) then return; end if;
  select v into last from mp_state where k = 'hour' for update;
  h := date_trunc('hour', now());
  if last is null then insert into mp_state values ('hour', h) on conflict (k) do update set v = excluded.v; return; end if;
  last := greatest(last, h - interval '12 hours');
  begin perform _mp_subst_plan_all(); exception when others then raise warning 'mp subst: %', sqlerrm; end;   -- 予備編成の代走の予定（DB の更新80）
  while last < h and n < 12 loop
    last := last + interval '1 hour'; n := n + 1;
    begin perform _mp_tick_hour(last); exception when others then raise warning 'mp hour: %', sqlerrm; end;
    begin perform _mp_ugm_hour(last); exception when others then raise warning 'mp ugm: %', sqlerrm; end;   -- 地下街（DB の更新109）
    if extract(hour from last at time zone 'Asia/Tokyo') = 4 then
      begin perform _mp_tick_day(); exception when others then raise warning 'mp day: %', sqlerrm; end;
    end if;
  end loop;
  begin perform _mp_slot_tick(); exception when others then raise warning 'mp slot: %', sqlerrm; end;   -- 発着口の入札・権利の期限（t57）
  begin perform _mp_prof_fill_some(4, 3000); exception when others then raise warning 'mp prof fill: %', sqlerrm; end;   -- 古い線路の縦断（DB の更新108）
  begin perform _mp_tmp_back(); exception when others then raise warning 'mp tmp: %', sqlerrm; end;   -- 期間つき増結の車両を入れ替え枠にもどす（DB の更新80）
  update mp_state set v = last where k = 'hour';
end $$;

create or replace function public.mp_area(p_x0 int, p_y0 int, p_x1 int, p_y1 int, p_lod int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b box; r jsonb; me_cs int[]; adm boolean;
begin
  perform _mp_ok(u);
  if p_x1 - p_x0 > 6000 or p_y1 - p_y0 > 6000 then raise exception '範囲が広すぎます'; end if;
  if p_lod = 0 and (p_x1 - p_x0) * (p_y1 - p_y0) > 360000 then p_lod := 1; end if;
  b := box(point(p_x0, p_y0), point(p_x1, p_y1));
  me_cs := array(select id from companies where owner = u);
  adm := _is_admin(u);   -- 国の駅・車両基地・系統は、管理者のもの（DB の更新101）
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
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.own_u is null and s.own_c is null and adm), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))
                  || case when s.melt then jsonb_build_object('ml', 1) else '{}'::jsonb end
                  || case when s.pf is not null then jsonb_build_object('pf', s.pf) else '{}'::jsonb end   -- ホームの形（DB の更新107）
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld, 'st', d.sta,   -- st：留置線の駅（DB の更新105）
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false) or (d.own_u is null and d.own_c is null and adm)) || case when d.plows > 0 then jsonb_build_object('pw', d.plows) else '{}'::jsonb end), '[]'::jsonb)
               from mp_depots d where d.x between (p_x0 - 13) * 100 and (p_x1 + 13) * 100 and d.y between (p_y0 - 13) * 100 and (p_y1 + 13) * 100 and p_lod < 2),
    -- 航路（t54o）：海の上の折れ線（区間ごと。1/100 マス）
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'k', r.kind, 'c', r.color, 'n', r.name, 'ok', r.ok, 'mine', coalesce(r.own_u = u or r.own_c = any(me_cs), false) or (r.own_u is null and r.own_c is null and adm),
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
    -- 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている部屋の割合（%）, 1 他人・2 自分・3 国, 見た目（1〜10。null は自動）, 向き（0〜345度。null は自動）,
    --        1階のお店の看板の色（部屋の番号の順に [c1, c2, c3] か null。どれも決めていなければ null）]（DB の更新103）
    'blds', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(b.id, b.parcel, b.kind, b.floors, to_jsonb(b.cells), b.name,
                  (select round(100.0 * count(*) filter (where x.t_kind is not null or x.mode = 'self') / greatest(count(*), 1)) from mp_units x where x.bld = b.id),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end, b.look, b.rot,
                  (select case when bool_or(x.sc is not null) then jsonb_agg(to_jsonb(x.sc) order by x.no) end from mp_units x where x.bld = b.id and x.floor = 1 and x.use = 'shop'))), '[]'::jsonb)
               from mp_blds b join mp_parcels pa on pa.id = b.parcel where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    -- 小物（DB の更新103）：[id, 種類, x, y（1/100 マス）, 向き, 色, 1 自分の]
    'props', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(pr.id, pr.kind, pr.x, pr.y, pr.rot, pr.col,
                  case when (pa.gov and adm) or coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 1 else 0 end)), '[]'::jsonb)
               from mp_props pr join mp_parcels pa on pa.id = pr.parcel where pr.x >= p_x0 * 100 and pr.x < p_x1 * 100 and pr.y >= p_y0 * 100 and pr.y < p_y1 * 100) end,
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
    -- 地下街（DB の更新109）：[id, 駅, 点（1/100 マス）, 名前, 自分の]
    'ugm', (select coalesce(jsonb_agg(jsonb_build_array(g.id, g.sta, to_jsonb(g.pts), g.name, coalesce(g.own_u = u or g.own_c = any(me_cs), false))), '[]'::jsonb)
               from mp_ugm g where p_lod < 2 and g.bb && box(point(p_x0 - 1, p_y0 - 1), point(p_x1 + 1, p_y1 + 1))),
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1, 'park2', 1, 'spec', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）・park2：テーマパークとアトラクション（DB の更新91）
  return r;
end $$;


revoke all on function public._mp_pperson(uuid, int) from public, anon, authenticated;
revoke all on function public._mp_sta_touch(mp_parcels) from public, anon, authenticated;
revoke all on function public._mp_ugm_k() from public, anon, authenticated;
revoke all on function public._mp_ugm_flow(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._mp_ugm_chk(bigint, int[], uuid, int, bigint) from public, anon, authenticated;
revoke all on function public._mp_ugm_gone() from public, anon, authenticated;
revoke all on function public._mp_ugm_hour(timestamptz) from public, anon, authenticated;
revoke all on function public.mp_ugm_build(bigint, int[], text, text, boolean) from public, anon;
revoke all on function public.mp_ugm_get(bigint) from public, anon;
revoke all on function public.mp_ugm_set(bigint, text) from public, anon;
revoke all on function public.mp_ugm_del(bigint) from public, anon;
grant execute on function public.mp_ugm_build(bigint, int[], text, text, boolean) to authenticated;
grant execute on function public.mp_ugm_get(bigint) to authenticated;
grant execute on function public.mp_ugm_set(bigint, text) to authenticated;
grant execute on function public.mp_ugm_del(bigint) to authenticated;
