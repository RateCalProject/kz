-- テーマパーク：30ha（3,000区画）〜100ha の大きな遊園地（建物の種類 tpark。来場者は まわり 30km の人から。入場料 1人 1,200 X）
--   町字がちがう筆も、合わせて 3,000区画以上なら合筆できる（テーマパークの土地。区画のいちばん多い筆の町字・地番をのこす）
-- アトラクション：遊園地・テーマパークに、観覧車・ジェットコースターなど9種類（土地 150区画ごとに1つ・同じものは3つまで）。
--   定員（ふえる来場者のわく）と人気（来たい人が何割ふえるか）がふえる。人気は つくってから2年で半分まで下がる。維持費は1日ごと。地図に絵

create table if not exists public.mp_attrs (   -- アトラクション（DB の更新91）：遊園地・テーマパークの中の乗りもの・ショー
  id    bigserial primary key,
  bld   bigint not null references public.mp_blds(id) on delete cascade,
  kind  text not null,                       -- _mp_attr_kinds のキー
  x     real not null, y real not null,      -- 場所（マス）
  name  text not null default '',
  cost  bigint not null default 0,
  at    timestamptz not null default now()   -- つくった時刻（新しいほど人気。2年で半分まで下がる）
);
create index if not exists mp_attrs_bld on public.mp_attrs (bld);
create index if not exists mp_attrs_xy on public.mp_attrs (x, y);
alter table public.mp_attrs enable row level security;
revoke all on public.mp_attrs from public, anon, authenticated;
revoke all on sequence public.mp_attrs_id_seq from public, anon, authenticated;

-- アトラクションの種類（DB の更新91）：工事費・1日の定員（ふえる来場者のわく）・人気（来たい人が何割ふえるか）・維持費（1日）・r 半径（マス。地図の絵の大きさ）。pk：その月は人気が 1.3倍
create or replace function public._mp_attr_kinds() returns jsonb
language sql immutable as $$
  select '{
    "wheel":   {"n":"観覧車","cost":300000000,"cap":3000,"ap":0.10,"upk":150000,"r":1},
    "coaster": {"n":"ジェットコースター","cost":800000000,"cap":4000,"ap":0.18,"upk":400000,"r":1.6},
    "merry":   {"n":"メリーゴーラウンド","cost":60000000,"cap":1200,"ap":0.03,"upk":30000,"r":0.4},
    "cups":    {"n":"コーヒーカップ","cost":40000000,"cap":1000,"ap":0.02,"upk":20000,"r":0.4},
    "haunt":   {"n":"お化け屋敷","cost":80000000,"cap":900,"ap":0.04,"upk":40000,"r":0.5},
    "water":   {"n":"ウォーターライド","cost":500000000,"cap":2500,"ap":0.12,"upk":250000,"r":1.2,"pk":[7,8]},
    "drop":    {"n":"フリーフォール","cost":250000000,"cap":1500,"ap":0.07,"upk":120000,"r":0.35},
    "kart":    {"n":"ゴーカート","cost":70000000,"cap":1000,"ap":0.03,"upk":35000,"r":0.9},
    "show":    {"n":"ショー劇場","cost":200000000,"cap":2000,"ap":0.06,"upk":100000,"r":0.7}
  }'::jsonb
$$;
-- アトラクションを いくつまで つくれるか（土地の広さ 150区画ごとに1つ。遊園地 4ha で2つ・テーマパーク 30ha で20こ）
create or replace function public._mp_attr_max(n int) returns int
language sql immutable as $$ select greatest(1, floor(coalesce(n, 0) / 150.0)::int) $$;
-- アトラクションの人気の新しさ（つくってから2年で半分まで下がる）
create or replace function public._mp_attr_fresh(t timestamptz, h timestamptz) returns real
language sql immutable as $$ select greatest(0.5, 1 - 0.25 * extract(epoch from h - t) / 31557600)::real $$;
-- 遊園地・テーマパークのアトラクションの一覧（建物のシート用。だれでも見られる）
create or replace function public.mp_attr_list(p_bld bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b mp_blds; p mp_parcels; me_cs int[];
begin
  perform _mp_ok(u);
  select * into b from mp_blds where id = p_bld;
  if not found then raise exception '建物が見つかりません'; end if;
  if b.kind not in ('amuse', 'tpark') then return jsonb_build_object('park', false); end if;
  select * into p from mp_parcels where id = b.parcel;
  me_cs := array(select id from companies where owner = u);
  return jsonb_build_object('park', true, 'max', _mp_attr_max(p.n), 'mine', coalesce(p.own_u = u or p.own_c = any(me_cs), false), 'kinds', _mp_attr_kinds(),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'k', a.kind, 'n', a.name, 'cost', a.cost, 'at', to_char(a.at at time zone 'Asia/Tokyo', 'YYYY-MM-DD'),
                 'fresh', round(_mp_attr_fresh(a.at, now())::numeric, 2)) order by a.id), '[]'::jsonb) from mp_attrs a where a.bld = b.id));
end $$;
-- アトラクションをつくる（自分の遊園地・テーマパークに。場所は、ほかのアトラクションから いちばん遠いところを自動で）
create or replace function public.mp_attr_build(p_bld bigint, p_kind text, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; b mp_blds; p mp_parcels; k jsonb; n int; nk int; mx int; cst bigint; nm text; cx real; cy real; rr real; bx real; by_ real; aid bigint; stp int;
        kr real; ex0 real; ey0 real; ex1 real; ey1 real;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into b from mp_blds where id = p_bld for update;
  if not found or b.kind not in ('amuse', 'tpark') then raise exception 'アトラクションは、遊園地・テーマパークにだけ つくれます'; end if;
  select * into p from mp_parcels where id = b.parcel;
  if not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false) then raise exception 'あなた（この名義）の建物ではありません'; end if;
  k := _mp_attr_kinds() -> p_kind;
  if k is null then raise exception 'アトラクションの種類がちがいます'; end if;
  n := (select count(*) from mp_attrs where bld = b.id); nk := (select count(*) from mp_attrs where bld = b.id and kind = p_kind); mx := _mp_attr_max(p.n);
  if n >= mx then raise exception 'この広さでは、アトラクションは %こまでです（土地 150区画ごとに1つ）', mx; end if;
  if nk >= 3 then raise exception '同じアトラクションは3つまでです'; end if;
  cst := (k ->> 'cost')::bigint;
  nm := left(coalesce(nullif(btrim(p_name), ''), (k ->> 'n') || case when nk > 0 then (nk + 1)::text else '' end), 30);
  if p_dry then
    return jsonb_build_object('cost', cst, 'cap', (k ->> 'cap')::int, 'ap', (k ->> 'ap')::real, 'upk', (k ->> 'upk')::int, 'name', nm, 'n', n, 'max', mx);
  end if;
  -- 場所：建物の区画（多いときは 2000 ほどに間引く）のうち、
  --   1. 建物のはし（いちばん外の区画の行・列）から、そのアトラクションの半径 ＋ 20m より内がわ
  --   2. ほかのアトラクションの はしから いちばん遠いところ（はじめの1つは まん中にいちばん近いところ）
  stp := greatest(1, (array_length(b.cells, 1) / 2) / 2000);
  kr := coalesce((k ->> 'r')::real, 0.6);
  select avg(b.cells[2 * i - 1] + 0.5) / 5, avg(b.cells[2 * i] + 0.5) / 5, min(b.cells[2 * i - 1]) / 5.0, min(b.cells[2 * i]) / 5.0, (max(b.cells[2 * i - 1]) + 1) / 5.0, (max(b.cells[2 * i]) + 1) / 5.0
    into cx, cy, ex0, ey0, ex1, ey1 from generate_series(1, array_length(b.cells, 1) / 2) i;
  select z.x, z.y into bx, by_ from (
    select (b.cells[2 * i - 1] + 0.5) / 5.0 x, (b.cells[2 * i] + 0.5) / 5.0 y from generate_series(1, array_length(b.cells, 1) / 2) i where i % stp = 0) z
   order by (z.x >= ex0 + kr + 0.4 and z.x <= ex1 - kr - 0.4 and z.y >= ey0 + kr + 0.4 and z.y <= ey1 - kr - 0.4) desc,
            coalesce((select min(sqrt((a.x - z.x) ^ 2 + (a.y - z.y) ^ 2) - coalesce((_mp_attr_kinds() -> a.kind ->> 'r')::real, 0.6)) from mp_attrs a where a.bld = b.id),
                     -sqrt((z.x - cx) ^ 2 + (z.y - cy) ^ 2)) desc
   limit 1;
  perform _mp_lock(pa.pu, pa.pc);
  perform _mp_pay(pa.pu, pa.pc, false, cst, 'bld', format('アトラクション「%s」をつくった（%s）', nm, coalesce(nullif(b.name, ''), '遊園地')));
  insert into mp_attrs(bld, kind, x, y, name, cost) values (b.id, p_kind, bx, by_, nm, cst) returning id into aid;
  perform _mp_chg('land', null, 'set', box(point(floor(bx) - 2, floor(by_) - 2), point(floor(bx) + 3, floor(by_) + 3)));
  perform _mp_sc_touch(b.id);   -- 来場者をすぐ数えなおす
  return jsonb_build_object('id', aid, 'cost', cst, 'name', nm);
end $$;
-- アトラクションをこわす（返金なし）
create or replace function public.mp_attr_del(p_attr bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; a mp_attrs; b mp_blds; p mp_parcels;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into a from mp_attrs where id = p_attr;
  if not found then raise exception 'アトラクションが見つかりません'; end if;
  select * into b from mp_blds where id = a.bld;
  select * into p from mp_parcels where id = b.parcel;
  if not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false) then raise exception 'あなた（この名義）の建物ではありません'; end if;
  delete from mp_attrs where id = p_attr;
  perform _mp_chg('land', null, 'set', box(point(floor(a.x) - 2, floor(a.y) - 2), point(floor(a.x) + 3, floor(a.y) + 3)));
  perform _mp_sc_touch(b.id);
  return jsonb_build_object('id', p_attr, 'name', a.name);
end $$;

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
   {"k":"mixeduse","n":"複合商業ビル","use":"shop","u":150,"g1":"shop","z":"cd","cpm":800,"f0":5,"f1":20,"min":10,"max":400,"sh":["full","slab","L"],"cat":"shop","c":"#d9c3a5"}
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
                            + coalesce((kd -> t.grp ->> 'rs')::real, 0) * coalesce((select sum(f.flow) from _sflow f where f.sx between t.x - 15 and t.x + 15 and f.sy between t.y - 15 and t.y + 15
                                                                                     and (f.sx - t.x) ^ 2 + (f.sy - t.y) ^ 2 <= 225), 0))
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

create or replace function public.mp_parcel_merge(p_ids bigint[], p_as text, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; ps mp_parcels[]; keep mp_parcels; n int; ncell int; reach int; ck text; xcho boolean;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  ps := array(select p from mp_parcels p where p.id = any(p_ids) order by p.ban, p.eda for update);
  n := coalesce(array_length(ps, 1), 0);
  if n < 2 then raise exception '筆を2つ以上えらんでください'; end if;
  if n <> (select count(distinct x) from unnest(p_ids) x) then raise exception '土地（筆）が見つかりません'; end if;
  if exists (select 1 from unnest(ps) p where not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false)) then raise exception 'あなた（この名義）の土地ではないものがあります'; end if;
  xcho := (select count(distinct p.cho) from unnest(ps) p) > 1;   -- 町字をまたぐのは、テーマパークの広さ（3,000区画）からだけ（DB の更新91）
  if exists (select 1 from unnest(ps) p where p.bld is not null) then raise exception '建物のある筆は合筆できません（先にこわしてください）'; end if;
  if exists (select 1 from unnest(ps) p where p.sale is not null) then raise exception '売りに出している筆は合筆できません'; end if;
  -- つながっているか（区画の上下左右）
  ncell := (select count(*) from mp_pcells where parcel = any(p_ids));
  with recursive r(x, y) as (
    (select x, y from mp_pcells where parcel = any(p_ids) order by y, x limit 1)
    union
    select c.x, c.y from r join mp_pcells c on c.parcel = any(p_ids) and ((c.x = r.x + 1 and c.y = r.y) or (c.x = r.x - 1 and c.y = r.y) or (c.x = r.x and c.y = r.y + 1) or (c.x = r.x and c.y = r.y - 1))
  ) select count(*) into reach from r;
  if reach < ncell then raise exception 'となりあっていない筆があります'; end if;
  if xcho and ncell < 3000 then raise exception '町字がちがう筆は合筆できません（合わせて 3,000区画（30ha）以上なら、テーマパークの土地として町字をまたいで合筆できます）'; end if;
  keep := ps[1];
  if xcho then   -- 町字をまたぐとき：区画のいちばん多い筆の町字・地番をのこす
    keep := (select p from unnest(ps) p order by (select count(*) from mp_pcells c where c.parcel = p.id) desc, p.ban, p.eda limit 1);
  end if;
  if p_dry then return jsonb_build_object('ban', _mp_ban(keep.ban, keep.eda), 'n', ncell, 'xcho', xcho); end if;
  -- 貸出料は、どの筆も同じときだけのこす。許可は、どの筆でも許可されている名義だけのこす（使用料は高いほう）
  update mp_parcels set rent = case when (select count(distinct coalesce(p.rent, -1)) from unnest(ps) p) = 1 then keep.rent end where id = keep.id;
  update mp_landreq q set fee = (select max(q2.fee) from mp_landreq q2 where q2.parcel = any(p_ids) and q2.st = 'ok' and q2.req_u is not distinct from q.req_u and q2.req_c is not distinct from q.req_c)
   where q.parcel = keep.id and q.st = 'ok';
  delete from mp_landreq q where q.parcel = keep.id and q.st = 'ok'
     and (select count(distinct q2.parcel) from mp_landreq q2 where q2.parcel = any(p_ids) and q2.st = 'ok' and q2.req_u is not distinct from q.req_u and q2.req_c is not distinct from q.req_c) < n;
  update mp_pcells set parcel = keep.id where parcel = any(p_ids) and parcel <> keep.id;
  update mp_parcels set n = ncell, price = (select sum(p.price) from unnest(ps) p), val = (select sum(p.val) from unnest(ps) p), mval = (select sum(coalesce(p.mval, p.val)) from unnest(ps) p),
    bb = (select box(point(min(x), min(y)), point(max(x) + 1, max(y) + 1)) from mp_pcells where parcel = keep.id) where id = keep.id;
  delete from mp_parcels where id = any(p_ids) and id <> keep.id;
  perform _mp_chg('land', null, 'set', (select box(point(_mp_t5((bb[1])[0]::int), _mp_t5((bb[1])[1]::int)), point(_mp_t5((bb[0])[0]::int) + 1, _mp_t5((bb[0])[1]::int) + 1)) from mp_parcels where id = keep.id));
  return jsonb_build_object('id', keep.id, 'ban', _mp_ban(keep.ban, keep.eda), 'n', ncell, 'xcho', xcho);
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1, 'park2', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）・park2：テーマパークとアトラクション（DB の更新91）
  return r;
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
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    lfd := case when r.kind = 'rail' then _mp_leg_fed(r.legs) end; rsh := case when r.kind = 'rail' then _mp_route_feed(r.legs) end;   -- 変電所（DB の更新89）
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0)));   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
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
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
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

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_attr_kinds', '_mp_attr_max', '_mp_attr_fresh', '_mp_bld_presets', '_mp_sc_kinds', '_mp_sc_school_calc', '_mp_tick_hour',
                                                         'mp_attr_list', 'mp_attr_build', 'mp_attr_del', 'mp_parcel_merge', 'mp_area') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
