-- 機関車と客車を別の注文に：客車は客車だけの編成で注文できる（機関車をつなぐまで走れない・運用に入れられない）。機関車は1両ずつ注文して、
--   入れ替え枠（編成に入っていない車両）から客車の編成の先頭か最後につなぐ。機関車をはずした編成は運用からはずれる。編成のきまりのわけを運用でも出す
-- 蒸気機関車5形式（名前は架空）：C46形（小形タンク）・7660形（古い小形）・C64形（旅客用）・D55形（貨物用）・C66形（大形の急行用）
--   水と石炭で走れる km（形式ごと）。駅に給水設備（3,000万 X）・給炭設備（6,000万 X）をつくる（mp_sta_sup）。止まる駅で補給し、
--   駅のあいだで水か石炭がたりなくなる列車は走れない（【補給】のわけ）。1日のはじめは満タン。蒸気機関車の加速の力は 50%

alter table public.mp_types add column if not exists wkm int;   -- 蒸気機関車：水で走れる km（DB の更新78）
alter table public.mp_types add column if not exists ckm int;   -- 蒸気機関車：石炭で走れる km
alter table public.mp_stations add column if not exists water boolean not null default false;   -- 給水設備（蒸気機関車の補給。DB の更新78）
alter table public.mp_stations add column if not exists coal boolean not null default false;    -- 給炭設備

-- 蒸気機関車（DB の更新78。名前は架空）：小形タンク機・古い小形機・旅客用・貨物用・大形の急行用。水と石炭は、給水・給炭できる駅で補給する
insert into public.mp_series(code, name, kind, note, ord, grp, yr, sets) values
  ('LC46', 'C46形', 'loco', '小形タンク機関車（1930年代）。水と石炭を車体にのせる（水で約60km・石炭で約140km 走れる）。最高85km/h。電化していない線も走れる', 52, null, 1932, '[]'::jsonb),
  ('L7660', '7660形', 'loco', '古い小形の蒸気機関車（1910年代・テンダー機）。軽くて扱いやすい。水で約90km・石炭で約220km。最高95km/h', 53, null, 1914, '[]'::jsonb),
  ('LC64', 'C64形', 'loco', '旅客用の蒸気機関車（1930年代・テンダー機）。速くて軽い。水で約140km・石炭で約320km。最高100km/h', 54, null, 1937, '[]'::jsonb),
  ('LD55', 'D55形', 'loco', '貨物用の蒸気機関車（1930年代・テンダー機）。動輪が4軸で力もち。水で約120km・石炭で約280km。最高85km/h', 55, null, 1936, '[]'::jsonb),
  ('LC66', 'C66形', 'loco', '大形の急行用蒸気機関車（1940年代・テンダー機）。いちばん速く、力も大きい。水で約160km・石炭で約360km。最高110km/h', 56, null, 1948, '[]'::jsonb)
on conflict (code) do nothing;
insert into public.mp_types(code, series, label, role, face, num_from, num_to, len, cap, seats, mass, power, panto, cab, vmax, acc, dec, elec, heat, ac, toilet, price, upkeep, life, note, ord, nbase, cls, rooms, fn, npad, wkm, ckm) values
  ('LC46-C46', 'LC46', 'C46', 'L', '', 1, 999, 12.6, 0, 0, 66.0, 450, 0, true, 85, 1.0, 2.5, false, true, false, false, 140000000, 70000, 365, 'タンク機（1C2）。短い支線や入れかえむけ', 3251, 'C46', '', 0, '{stm}', 1, 60, 140),
  ('L7660-7660', 'L7660', '7660', 'L', '', 1, 999, 16.8, 0, 0, 85.0, 460, 0, true, 95, 0.9, 2.5, false, true, false, false, 110000000, 65000, 365, 'テンダー機（1C）。ローカル線の旅客列車むけ', 3252, '7660', '', 0, '{stm}', 1, 90, 220),
  ('LC64-C64', 'LC64', 'C64', 'L', '', 1, 999, 20.3, 0, 0, 115.0, 950, 0, true, 100, 1.0, 2.5, false, true, false, false, 210000000, 85000, 365, 'テンダー機（2C1）。急行・普通の旅客列車むけ', 3253, 'C64', '', 0, '{stm}', 1, 140, 320),
  ('LD55-D55', 'LD55', 'D55', 'L', '', 1, 999, 19.7, 0, 0, 125.0, 940, 0, true, 85, 0.9, 2.5, false, true, false, false, 220000000, 90000, 365, 'テンダー機（1D1）。重い列車・坂の多い線むけ', 3254, 'D55', '', 0, '{stm}', 1, 120, 280),
  ('LC66-C66', 'LC66', 'C66', 'L', '', 1, 999, 21.5, 0, 0, 145.0, 1190, 0, true, 110, 1.0, 2.5, false, true, false, false, 260000000, 100000, 365, 'テンダー機（2C2）。特急・急行むけ', 3255, 'C66', '', 0, '{stm}', 1, 160, 360)
on conflict (code) do nothing;

-- 客車のプリセットから機関車（@L）をのぞく（客車だけの編成で注文して、機関車はあとでつなぐ。DB の更新78）
update public.mp_series s set sets = (select coalesce(jsonb_agg(case when jsonb_typeof(x.v -> 't') = 'array'
           then jsonb_set(x.v, '{t}', coalesce((select jsonb_agg(e.e order by e.o) from jsonb_array_elements(x.v -> 't') with ordinality e(e, o) where e.e <> '"@L"'::jsonb), '[]'::jsonb))
           else x.v end order by x.o), '[]'::jsonb) from jsonb_array_elements(s.sets) with ordinality x(v, o))
 where s.kind = 'pc' and s.sets::text like '%@L%';

-- 蒸気機関車の補給（DB の更新78）：編成の蒸気機関車が、水と石炭で走れる km（重連なら短いほう）。蒸気機関車がなければ null
create or replace function public._mp_form_steam(fid bigint) returns jsonb
language sql stable set search_path = public as $$
  select case when count(*) > 0 then jsonb_build_object('w', min(t.wkm), 'c', min(t.ckm)) end
    from mp_cars c join mp_types t on t.code = c.type where c.form = fid and 'stm' = any(t.fn)
$$;
-- 1つの走り（列車、または連結：fs で つないで es で切りはなす）を、止まる駅の順に見る。給水・給炭できる駅で満タンにする。
--   wl・cl：走りのはじめに のこっている km。たりなくなれば w にわけ、たりれば のこりの wl・cl を返す
create or replace function public._mp_steam_run(tid bigint, fs bigint, es bigint, wkm real, ckm real, wl real, cl real) returns jsonb
language plpgsql stable set search_path = public as $$
declare t mp_trains; r mp_routes; n int; cum real[]; e jsonb; sid bigint; idx int; pidx int; psid bigint; d real; on_ boolean := false; st record; k int := 0;
begin
  if wkm is null or ckm is null then return jsonb_build_object('wl', wl, 'cl', cl); end if;
  select * into t from mp_trains where id = tid;
  select * into r from mp_routes where id = t.route;
  n := coalesce(array_length(r.stops, 1), 0);
  if n < 2 or r.kind <> 'rail' then return jsonb_build_object('wl', wl, 'cl', cl); end if;
  cum := array(select coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, kq) where kq < o), 0) / 1000 from generate_series(1, n) o);   -- 系統の駅の km
  for e in select s.v from jsonb_array_elements(t.sched) with ordinality s(v, so) order by s.so loop
    sid := (e ->> 0)::bigint;
    if not on_ then if sid = fs then on_ := true; else continue; end if; end if;   -- この走りの はじめの駅から
    -- 系統の何番目か（走る向きで、前に止まった駅のつぎ。環状線は同じ駅が2回ある）
    if pidx is null then idx := _mp_rpos(r.stops, t.dir, sid, false);
    elsif t.dir = 1 then idx := (select min(z.o) from unnest(r.stops) with ordinality z(s, o) where z.s = sid and z.o > pidx);
    else idx := (select max(z.o) from unnest(r.stops) with ordinality z(s, o) where z.s = sid and z.o < pidx); end if;
    if idx is null then exit; end if;
    if pidx is not null then
      d := abs(cum[idx] - cum[pidx]);
      if wl - d < 0 then
        return jsonb_build_object('w', format('【補給】%s〜%s で水がなくなります（水で走れるのは %skm。とちゅうの止まる駅に給水設備をつくるか、止まる駅をふやしてください）',
                                              (select name from mp_stations where id = psid), (select name from mp_stations where id = sid), round(wkm)), 'wl', wl, 'cl', cl);
      end if;
      if cl - d < 0 then
        return jsonb_build_object('w', format('【補給】%s〜%s で石炭がなくなります（石炭で走れるのは %skm。とちゅうの止まる駅に給炭設備をつくるか、止まる駅をふやしてください）',
                                              (select name from mp_stations where id = psid), (select name from mp_stations where id = sid), round(ckm)), 'wl', wl, 'cl', cl);
      end if;
      wl := wl - d; cl := cl - d;
    end if;
    select s.water, s.coal into st from mp_stations s where s.id = sid;   -- この駅で補給
    if coalesce(st.water, false) then wl := wkm; end if;
    if coalesce(st.coal, false) then cl := ckm; end if;
    pidx := idx; psid := sid;
    if sid = es and k > 0 then exit; end if;   -- 走りの おわりの駅（環状線は、はじめの駅にもどったところ）
    k := k + 1;
  end loop;
  return jsonb_build_object('wl', wl, 'cl', cl);
end $$;
-- 駅の給水・給炭の設備（蒸気機関車の補給。DB の更新78）：p_kind 'water' 給水（3,000万 X）・'coal' 給炭（6,000万 X）。
--   p_on = false ではずす（返金なし）。この駅を通る系統で、蒸気機関車の列車があれば時刻とわけを見なおす
create or replace function public.mp_sta_sup(p_id bigint, p_kind text, p_on boolean, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s mp_stations; me_cs int[]; gv boolean; cost bigint; nm text; bx box; has boolean; rid bigint; nr int := 0;
begin
  perform _mp_ok(u);
  if p_kind is null or p_kind not in ('water', 'coal') then raise exception '給水（water）か給炭（coal）をえらんでください'; end if;
  select * into s from mp_stations where id = p_id for update;
  if not found or s.kind <> 'rail' then raise exception '鉄道の駅をえらんでください'; end if;
  me_cs := array(select id from companies where owner = u);
  gv := s.own_u is null and s.own_c is null;
  if not coalesce(s.own_u = u or s.own_c = any(me_cs) or (gv and _is_admin(u)), false) then raise exception 'あなたの駅ではありません'; end if;
  nm := case p_kind when 'water' then '給水設備' else '給炭設備' end;
  has := case p_kind when 'water' then s.water else s.coal end;
  if coalesce(p_on, true) then
    if has then raise exception 'もう%があります', nm; end if;
    cost := case p_kind when 'water' then 30000000 else 60000000 end;
  else
    if not has then raise exception '%はありません', nm; end if;
    cost := 0;
  end if;
  if not coalesce(p_dry, false) then
    perform _mp_lock(s.own_u, s.own_c);
    if cost > 0 then perform _mp_pay(s.own_u, s.own_c, gv, cost, 'sta', format('%s（%s駅）', nm, s.name)); end if;
    if p_kind = 'water' then update mp_stations set water = coalesce(p_on, true) where id = p_id;
    else update mp_stations set coal = coalesce(p_on, true) where id = p_id; end if;
    bx := box(point(s.x / 100.0 - 3, s.y / 100.0 - 3), point(s.x / 100.0 + 3, s.y / 100.0 + 3));
    perform _mp_chg('sta', p_id, 'set', bx);
    for rid in select ro.id from mp_routes ro where ro.kind = 'rail' and p_id = any(ro.stops)
                 and exists (select 1 from mp_trains t join mp_cars c on c.form = t.form join mp_types y on y.code = c.type where t.route = ro.id and 'stm' = any(y.fn)) loop
      perform _mp_resched(rid); nr := nr + 1;
    end loop;
  end if;
  return jsonb_build_object('on', coalesce(p_on, true), 'kind', p_kind, 'cost', cost, 'routes', nr);
end $$;

create or replace function public._mp_form_rule_x(tps text[], p_run boolean) returns text
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
    -- 客車だけの編成（DB の更新78）：持てるが、機関車をつなぐまで走れない（運用に入れられない）
    if nl = 0 and p_run then return '客車だけでは走れません。機関車（L）をつないでください（入れ替え枠の機関車を「🚂 機関車をつなぐ」で）'; end if;
    if nl > 0 and a.role <> 'L' and b.role <> 'L' then return '機関車（L）は先頭か最後につないでください'; end if;
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

create or replace function public._mp_form_rule_t(tps text[]) returns text
language sql stable set search_path = public as $$ select _mp_form_rule_x(tps, true) $$;

create or replace function public._mp_form_rule_s(tps text[]) returns text
language sql stable set search_path = public as $$ select _mp_form_rule_x(tps, false) $$;

create or replace function public._mp_form_srule(cars bigint[]) returns text
language sql stable set search_path = public as $$
  select _mp_form_rule_s(array(select c.type from unnest(cars) with ordinality z(id, o) join mp_cars c on c.id = z.id order by z.o))
$$;

create or replace function public.mp_form_order(p_types text[], p_name text, p_depot bigint, p_as text, p_dry boolean, p_maker bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; d mp_depots; why text; nc int := coalesce(array_length(p_types, 1), 0); have int; k text; t mp_types; i int;
        cnt jsonb := '{}'::jsonb; s int; nums text[] := '{}'; cost bigint := 0; up bigint := 0; fid bigint; nm text := left(trim(coalesce(p_name, '')), 20); hrs int := 6; ky text; vv text; cid bigint;
        mk jsonb; lst bigint := 0;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '車両は人か会社で持ちます'; end if;
  if not coalesce(p_dry, false) then perform _mp_lock(pa.pu, pa.pc); end if;   -- 同じ名義の操作は1つずつ（車庫の空き・車番がかさならないように。DB の更新60）
  if nc = 0 then raise exception '形式をえらんでください'; end if;
  if exists (select 1 from unnest(p_types) x where not exists (select 1 from mp_types y where y.code = x and y.on_sale)) then raise exception 'その形式は注文できません'; end if;
  if exists (select 1 from unnest(p_types) x join mp_types y on y.code = x where y.role in ('Bus', 'Truck', 'Ship', 'Air')) then raise exception 'バス・トラック・船・飛行機は1台ずつ注文してください'; end if;
  why := _mp_form_rule_s(p_types);   -- 客車だけの編成も注文できる（機関車はあとでつなぐ。DB の更新78）
  if why is not null then raise exception '%', why; end if;
  if nm = '' then raise exception '編成番号を入れてください'; end if;
  if exists (select 1 from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc and f.name = nm) then raise exception '編成番号「%」はもうあります', nm; end if;
  select * into d from mp_depots where id = p_depot;
  if not found or not _mp_same(d.own_u, d.own_c, false, pa.pu, pa.pc, false) then raise exception '車籍を置く車庫をえらんでください（この名義の車庫）'; end if;
  if d.kind <> 'rail' then raise exception '電車は車両基地に置きます'; end if;
  select count(*) into have from mp_cars where depot = p_depot;
  if have + nc > d.cap then raise exception '車庫がいっぱいです（%両まで・いま%両）', d.cap, have; end if;
  k := _mp_okey(pa.pu, pa.pc);
  -- 車番：形式ごとに、持ち主の続きから
  for i in 1..nc loop
    select * into t from mp_types where code = p_types[i];
    s := coalesce((select z.n from mp_serials z where z.owner = k and z.type = t.code), 0) + coalesce((cnt ->> t.code)::int, 0);
    if t.num_from + s > t.num_to then raise exception '%の車番がいっぱいです（%〜%）', t.label, t.num_from, t.num_to; end if;
    nums := nums || _mp_carnum(t, t.num_from + s);
    cnt := cnt || jsonb_build_object(t.code, coalesce((cnt ->> t.code)::int, 0) + 1);
    cost := cost + t.price; up := up + t.upkeep;
  end loop;
  lst := cost;
  if p_maker is not null then   -- 鉄道車両工場（払い・鉄鋼はここで）
    mk := _mp_maker_order(p_maker, pa.pu, pa.pc, p_types, p_dry);
    cost := (mk ->> 'cost')::bigint; hrs := (mk ->> 'hours')::int;
  end if;
  if p_dry then return jsonb_build_object('cost', cost, 'nums', to_jsonb(nums), 'hours', hrs, 'upkeep', up, 'n', nc, 'maker', mk ->> 'maker', 'self', mk -> 'self', 'steel', mk -> 'steel'); end if;
  if p_maker is null then perform _mp_pay(pa.pu, pa.pc, false, cost, 'car', format('編成「%s」（%s両）を注文', nm, nc)); end if;
  insert into mp_forms(name, own_u, own_c, depot) values (nm, pa.pu, pa.pc, p_depot) returning id into fid;
  for i in 1..nc loop
    select * into t from mp_types where code = p_types[i];
    insert into mp_cars(type, num, own_u, own_c, depot, form, pos, heat, ac, toilet, busy_from, busy_until, busy_kind, price)
    values (t.code, nums[i], pa.pu, pa.pc, p_depot, fid, i, t.heat, t.ac, t.toilet, now(), now() + make_interval(hours => hrs), 'deliver',
            case when mk is null then t.price else round(t.price::numeric * cost / greatest(lst, 1))::bigint end)
    returning id into cid;
    insert into mp_car_hist(car, k, num, type, ou, oc, d) values (cid, 'new', nums[i], t.code, pa.pu, pa.pc,
      jsonb_build_object('dep', d.name) || case when mk is not null then jsonb_build_object('maker', mk ->> 'maker') else '{}'::jsonb end);
  end loop;
  for ky, vv in select * from jsonb_each_text(cnt) loop
    insert into mp_serials(owner, type, n) values (k, ky, vv::int) on conflict (owner, type) do update set n = mp_serials.n + excluded.n;
  end loop;
  return jsonb_build_object('id', fid, 'name', nm, 'nums', to_jsonb(nums), 'cost', cost, 'hours', hrs);
end $$;

create or replace function public.mp_form_set(p_form bigint, p_cars bigint[], p_name text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; why text; dep bigint; nd int; f mp_forms; i int; old bigint[]; fee bigint := 0; nbusy int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  perform _mp_lock(pa.pu, pa.pc);   -- 同じ名義の操作は1つずつ（DB の更新60）
  perform 1 from mp_cars where id = any(p_cars) for update;   -- 車両をおさえてから持ち主を見る（ゆずる・廃車と同時にならないように）
  if exists (select 1 from unnest(p_cars) x where not exists (select 1 from mp_cars c where c.id = x and c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc)) then
    raise exception 'この名義の車両ではないものがあります';
  end if;
  if (select count(distinct x) from unnest(p_cars) x) <> coalesce(array_length(p_cars, 1), 0) then raise exception '同じ車両が2回入っています'; end if;
  select count(distinct depot), min(depot) into nd, dep from mp_cars where id = any(p_cars);
  if nd > 1 then raise exception 'ちがう車庫の車両はつなげません（先に転属を）'; end if;
  select count(*) into nbusy from mp_cars where id = any(p_cars) and busy_until > now() and busy_kind <> 'deliver';
  if nbusy > 0 then raise exception '検査・改造・転属中の車両があります'; end if;
  why := _mp_form_srule(p_cars);   -- 客車だけの編成も組める（機関車をつなぐまで走れない。DB の更新78）
  if why is not null then raise exception '%', why; end if;
  -- 編成番号（持ち主ごとに1つずつ）
  if p_form is null and trim(coalesce(p_name, '')) = '' then raise exception '編成番号を入れてください'; end if;
  if trim(coalesce(p_name, '')) <> '' and exists (select 1 from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc
                                                     and x.name = left(trim(p_name), 20) and x.id is distinct from p_form) then
    raise exception '編成番号「%」はもうあります', left(trim(p_name), 20);
  end if;
  if p_form is not null then
    select * into f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
    if not found then raise exception '編成が見つかりません'; end if;
    old := array(select id from mp_cars where form = p_form order by pos);
    if old is distinct from p_cars then fee := 100000 * (select count(*) from unnest(p_cars) x where not (x = any(old))) + 50000; end if;   -- 組みかえの手間
  end if;
  -- ほかの編成から抜く（抜かれた編成は、のこりの車でもう一度きまりを見る → だめなら運用から外す）
  update mp_cars set form = null, pos = 0 where id = any(p_cars) and form is distinct from p_form;
  if p_form is null then
    insert into mp_forms(name, own_u, own_c, depot) values (left(trim(p_name), 20), pa.pu, pa.pc, dep) returning * into f;
  else
    update mp_cars set form = null, pos = 0 where form = p_form and not (id = any(p_cars));
    update mp_forms set name = coalesce(nullif(left(trim(p_name), 20), ''), name), depot = dep where id = p_form;
  end if;
  for i in 1..array_length(p_cars, 1) loop update mp_cars set form = f.id, pos = i where id = p_cars[i]; end loop;
  if fee > 0 then perform _mp_pay(pa.pu, pa.pc, false, fee, 'car', format('編成「%s」の組みかえ', f.name)); end if;
  -- 空になった編成・きまりに合わなくなった編成は、運用と列車からはずす
  perform _mp_form_drop(array(select x.id from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.id <> f.id
                      and _mp_form_rule(array(select c.id from mp_cars c where c.form = x.id order by c.pos)) is not null), '編成が組みかわったので、運用からはずれました');
  -- この編成が走れなくなったら（機関車をはずした など）、運用からはずす（DB の更新78）
  if _mp_form_rule(array(select c.id from mp_cars c where c.form = f.id order by c.pos)) is not null then
    perform _mp_form_drop(array[f.id], '機関車がないので、運用からはずれました（機関車をつなぐと、運用にもどせます）');
  end if;
  delete from mp_forms x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and not exists (select 1 from mp_cars c where c.form = x.id);
  -- 組みかえた編成の列車（運用）は、時刻を計算しなおす（長さ・性能が変わる）
  perform _mp_resched(rr) from _mp_form_routes(f.id) rr;
  return jsonb_build_object('id', f.id, 'perf', _mp_form_perf(f.id), 'fee', fee);
end $$;

create or replace function public.mp_op_save(p_id bigint, p_num text, p_form bigint, p_note text, p_kind text, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; o mp_ops; nm text := left(trim(coalesce(p_num, '')), 12); kd text; f mp_forms; other bigint; othernum text; oid_ bigint; rids bigint[]; why text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '運用は人か会社でつくります'; end if;
  if nm = '' then raise exception '運用番号を入れてください'; end if;
  if p_id is not null then
    select * into o from mp_ops where id = p_id and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc for update;
    if not found then raise exception '運用が見つかりません'; end if;
    kd := o.kind;
  else kd := case when p_kind in ('bus', 'ship', 'air') then p_kind else 'rail' end; end if;
  if exists (select 1 from mp_ops x where x.own_u is not distinct from pa.pu and x.own_c is not distinct from pa.pc and x.num = nm and x.id is distinct from p_id) then
    raise exception '運用番号「%」はもうあります', nm;
  end if;
  if p_form is not null then
    select * into f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    if not found then raise exception '編成が見つかりません'; end if;
    if _mp_form_kind(p_form) <> kd then   -- t54o：船の運用には船だけ
      raise exception '%', case kd when 'rail' then '鉄道の運用には電車だけを入れられます' when 'ship' then '船の運用には船だけを入れられます' when 'air' then '飛行機の運用には飛行機だけを入れられます' else 'バスの運用にはバスだけを入れられます' end;
    end if;
    why := _mp_form_rule(array(select c.id from mp_cars c where c.form = p_form order by c.pos));   -- わけも出す（DB の更新78）
    if why is not null then raise exception '編成のきまりに合っていません：%', why; end if;
    select id, num into other, othernum from mp_ops where form = p_form and id is distinct from p_id;
    if other is not null then
      update mp_ops set form = null where id = other;
      update mp_trains set form = null where op = other;
    end if;
  end if;
  if p_id is null then
    insert into mp_ops(own_u, own_c, kind, num, form, note) values (pa.pu, pa.pc, kd, nm, p_form, left(coalesce(p_note, ''), 200)) returning id into oid_;
  else
    update mp_ops set num = nm, form = p_form, note = left(coalesce(p_note, ''), 200) where id = p_id;
    oid_ := p_id;
    update mp_trains set form = p_form where op = p_id;
  end if;
  -- 列車の時刻・ぶつかりを見なおす（連結している列車も）
  rids := array(select distinct route from mp_trains where op = oid_ or op = other
                   or cpl @> jsonb_build_array(jsonb_build_object('op', oid_)) or (other is not null and cpl @> jsonb_build_array(jsonb_build_object('op', other))));
  perform _mp_resched(x) from unnest(rids) x;
  return jsonb_build_object('id', oid_, 'moved_from', othernum);
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
         min(t.wkm) filter (where 'stm' = any(t.fn)) xwkm, min(t.ckm) filter (where 'stm' = any(t.fn)) xckm
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
         'nl', nullif(r.xnl, 0), 'np', nullif(r.xnp, 0), 'wkm', r.xwkm, 'ckm', r.xckm));
end $$;

create or replace function public._mp_run_mark(tid bigint, ci int, w text) returns void
language plpgsql set search_path = public as $$
begin
  if ci = 0 then
    update mp_trains set bad = w is not null,
           warn = nullif(concat_ws(' / ', nullif(regexp_replace(coalesce(warn, ''), '( / )?【(編成|補給)】[^/]*', '', 'g'), ''), w), '') where id = tid;
  else
    update mp_trains set cplx = jsonb_set(cplx, array[(ci - 1)::text], (cplx -> (ci - 1)) || jsonb_build_object('ok', w is null, 'w', w))
     where id = tid and jsonb_array_length(cplx) >= ci;
  end if;
end $$;

create or replace function public._mp_resched(rid bigint) returns void
language plpgsql set search_path = public as $$
declare tr mp_trains; a record; b record; r mp_routes; w text; fid bigint; lsta bigint; lt int; lnum text; dd date; ldated bigint; ldci int; pass int;
        sk jsonb; wl real; cl real; sr jsonb; stw boolean;   -- 蒸気機関車の補給（DB の更新78）
begin
  perform _mp_dispatch(rid);   -- 時刻（待避・続行もふくめて）
  select * into r from mp_routes where id = rid;
  -- 番線：同じ駅・同じ番線に、重なる（t62：自動閉塞。前の列車が出て、長さ＋30m はなれるまで。前は前後30秒ずつ）
  --   （2026-10-28）前は列車の組ごとに sched をひらいていて「本数の2乗×駅数の2乗」かかり、列車をまとめて足すと8秒の制限をこえていた。
  --   いまは駅ごとの発着を1回だけ表にして、駅・番線でつなぐ。注意書きも、列車ごとにまとめて1回で書く（中身は前と同じ）
  --   さらに10分ごとの枠（bk）でもつなぐ：重なる2つは、両方の最初の枠のおそいほう（greatest(p)）で1回だけ出会う
  with pf as materialized (   -- 編成ごとの「出てから はなれるまで」の秒
    select f.form, _mp_clr_stop((q.p ->> 'len')::real, (q.p ->> 'acc')::real) clr
      from (select distinct t.form from mp_trains t where t.route in (select id from mp_routes where stops && r.stops) and t.form is not null) f,
           lateral (select _mp_form_perf(f.form) p) q),
  st as materialized (
    select z.*, floor(least(z.ta, z.td + z.clr) / 600.0)::int p, floor(greatest(z.ta, z.td + z.clr) / 600.0)::int q from (
      select t.id, t.route, t.num, t.day, s.v ->> 0 sta, s.v ->> 3 trk,
             coalesce((s.v ->> 1)::int, (s.v ->> 2)::int) ta, coalesce((s.v ->> 2)::int, (s.v ->> 1)::int) td,
             coalesce((select pf.clr from pf where pf.form = t.form), _mp_clr_stop(null, null)) clr
        from mp_trains t cross join lateral jsonb_array_elements(t.sched) s(v)
       where t.route in (select id from mp_routes where stops && r.stops) and s.v ->> 0 is not null and s.v ->> 3 is not null) z),
  sb as materialized (select st.*, w10.bk from st cross join lateral generate_series(st.p, st.q) w10(bk)),
  c as materialized (
    select t1.id i1, t2.id i2, t1.num n1, t2.num n2, t1.trk, (select name from mp_stations where id = t1.sta::bigint) sn
      from sb t1 join sb t2 on t2.sta = t1.sta and t2.trk = t1.trk and t2.bk = t1.bk and t1.id < t2.id
     where t1.bk = greatest(t1.p, t2.p)
       and (t1.route = rid or t2.route = rid)
       and (t1.day is null or t2.day is null or t1.day = t2.day)
       and t1.ta < t2.td + t2.clr and t2.ta < t1.td + t1.clr),
  g as (
    select z.id, string_agg(z.m, ' / ') m from (
      select c.i1 id, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n2) m from c
      union all select c.i2, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n1) from c) z group by z.id)
  update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id and t.route = rid;
  -- 単線：となりの駅のあいだ（単線のある区間）に、反対向きの列車が同じ時刻にいる（となりの駅は lead で1回ずつ）
  if r.kind = 'rail' then
    with x as materialized (
      select z.id, z.dir, z.day, z.num, z.sa, z.sb, z.d, z.a from (
        select t.id, t.dir, t.day, t.num, (e.v ->> 0)::bigint sa, (lead(e.v) over w ->> 0)::bigint sb, (e.v ->> 2)::int d, (lead(e.v) over w ->> 1)::int a, lead(e.v) over w nx
          from mp_trains t, jsonb_array_elements(t.sched) with ordinality e(v, o)
         where t.route = rid and t.dir in (1, -1)
        window w as (partition by t.id order by e.o)) z
       where z.nx is not null),
    c as materialized (
      select x1.id i1, x2.id i2, x1.num n1, x2.num n2, x1.sa, x1.sb
        from x x1 join x x2 on x2.sa = x1.sb and x2.sb = x1.sa
       where x1.dir = 1 and x2.dir = -1
         and x1.d < x2.a and x2.d < x1.a and (x1.day is null or x2.day is null or x1.day = x2.day)
         and exists (select 1 from generate_series(array_position(r.stops, x1.sa),
                       (select min(z.o) from unnest(r.stops) with ordinality z(s, o) where z.s = x1.sb and z.o > array_position(r.stops, x1.sa))::int - 1) k
                      where (r.legs -> (k - 1) ->> 's')::boolean)),
    g as (
      select z.id, string_agg(z.m, ' / ') m from (
        select c.i1 id, format('単線の区間（%s〜%s）で %s とすれちがえません', (select s.name from mp_stations s where s.id = c.sa), (select s.name from mp_stations s where s.id = c.sb), c.n2) m from c
        union all select c.i2, format('単線の区間で %s とすれちがえません', c.n1) from c) z group by z.id)
    update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id;
  end if;
  update mp_trains set bad = true where route = rid and form is null;
  -- 編成のつながり：編成ごとに時刻の順に見て、前に走る列車の終点から2分以上あけて出られる列車だけが走る（走れない列車は bad）
  --   連結（cplx）も、その編成の走りとして見る（つなぐ駅を出てから、切りはなす駅に着くまで）。まにあわない連結は、つながない（ok = false）
  --   連結する列車が走るかどうかは、ほかの編成の結果で決まるので、2回まわす
  for pass in 1..2 loop
    for fid in select z.f from (select distinct form f from mp_trains where route = rid and form is not null
                                union select distinct (c ->> 'f')::bigint from mp_trains t, jsonb_array_elements(t.cplx) c where t.route = rid and (c ->> 'v')::boolean) z
                order by z.f loop
      -- 毎日の列車
      lsta := null; lt := null; lnum := null;
      sk := _mp_form_steam(fid); wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車（DB の更新78）：1日のはじめは水も石炭も満タン
      for a in select * from _mp_form_runs(fid) x where x.day is null order by x.ft, x.tid, x.ci loop
        if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
        w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0);
        if w is null and sk is not null then   -- 補給（DB の更新78）：止まる駅の給水・給炭で、駅のあいだを走りきれるか
          sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
          w := sr ->> 'w';
          if w is null then wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real;
          elsif a.ci > 0 then w := replace(w, '【補給】', '') || '（連結しません）'; end if;
        end if;
        perform _mp_run_mark(a.tid, a.ci, w);
        if w is null then lsta := a.es; lt := a.et; lnum := a.num; end if;
      end loop;
      -- 臨時列車：その日の毎日の列車とあわせて見る。臨時列車のせいで毎日の列車がまにあわなくなるときは、臨時列車のほうが走れない（連結しない）
      for dd in select distinct x.day from _mp_form_runs(fid) x where x.day is not null loop
        lsta := null; lt := null; lnum := null; ldated := null; ldci := null;
        wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車：その日のはじめは満タン（DB の更新78）
        for a in select * from _mp_form_runs(fid) x where x.day is null or x.day = dd order by x.ft, x.tid, x.ci loop
          if a.day is null and not a.ok then continue; end if;   -- 毎日の走りで走れないもの（つながないもの）は、とばす
          if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
          w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0); stw := false;
          if w is null and sk is not null then   -- 補給（DB の更新78）
            sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
            if sr ->> 'w' is not null then
              stw := true;
              w := case when a.day is not null and a.ci > 0 then replace(sr ->> 'w', '【補給】', '') || '（連結しません）' else sr ->> 'w' end;
            else wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real; end if;
          end if;
          if a.day is not null then
            perform _mp_run_mark(a.tid, a.ci, w);
            if w is null then lsta := a.es; lt := a.et; lnum := a.num; ldated := a.tid; ldci := a.ci; end if;
          else
            if w is not null and ldated is not null then
              perform _mp_run_mark(ldated, ldci, format(case when ldci > 0 then case when stw then 'この臨時列車のあと、%s の水か石炭がたりなくなります（連結しません）' else 'この臨時列車のあと、%s にまにあいません（連結しません）' end
                                                             else case when stw then '【補給】この臨時列車のあと、%s の水か石炭がたりなくなります（走れません）' else '【編成】この臨時列車のあと、%s にまにあいません（走れません）' end end, a.num));
            end if;
            lsta := a.es; lt := a.et; lnum := a.num; ldated := null;
            if stw then wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real; end if;   -- 毎日の列車は走るので、そのあとは ふだんどおりに（満タンとみる）
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  if r.kind = 'air' then perform _mp_slot_mark(); end if;   -- 発着口（t57）：出る空港・1時間ごとに、持っている発着口の数まで
end $$;

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
    'fsets', _mp_fset_json(u),   -- 編成のプリセット（DB の更新72）
    'lsplit', true);   -- 機関車と客車を別に注文する（DB の更新78）
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
                  || case when s.rack then jsonb_build_object('rk', 1) else '{}'::jsonb end || case when s.hm is not null then jsonb_build_object('hm', s.hm) else '{}'::jsonb end), '[]'::jsonb)
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）
  return r;
end $$;

-- 関数の権限：給水・給炭はログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_form_rule_x', '_mp_form_rule_t', '_mp_form_rule_s', '_mp_form_srule', 'mp_form_order', 'mp_form_set', 'mp_op_save',
                                                       '_mp_form_perf', '_mp_run_mark', '_mp_resched', 'mp_cars_list', 'mp_area', '_mp_form_steam', '_mp_steam_run', 'mp_sta_sup') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 時刻を組みなおす関数の待ち時間（作りなおすと消えるので、もう一度）・給水と給炭は通る系統の時刻を見なおすので60秒まで（DB の更新78）
alter function public.mp_form_set(bigint, bigint[], text, text) set statement_timeout = '20s';
alter function public.mp_op_save(bigint, text, bigint, text, text, text) set statement_timeout = '20s';
alter function public.mp_sta_sup(bigint, text, boolean, boolean) set statement_timeout = '60s';
