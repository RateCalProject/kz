-- 車両の系列・形式のコード（中だけで使う名前）を、架空の名前にあわせる（画面に出る名前・車番・性能・値段はそのまま）：
--   系列は E178・E378・E166・E168・LEF68・LDD52・DKH62・DKH116・DKH44・DKH128・P18・P28・P52（展望車・特ロの TENP はそのまま）、
--   形式は「系列のコード-形式の名前」（E178-Tc17800・LEF68-EF68-500・DKH62-Kiha62・P28-Narone28 など）
--   買った車両・車歴・車番の続き・系列のプリセット・自分で保存したプリセット・つなげる仲間（grp）も、新しいコードに
--   編成のきまり（_mp_form_rule_t）の中の説明から、ほかの車両の名前を消す

-- 系列：名前 → 新しいコード（更新72で入れた、年代のある系列だけ）
create temp table _sm76 (name text primary key, new text not null unique) on commit drop;
insert into _sm76(name, new) values
  ('178系', 'E178'),
  ('378系', 'E378'),
  ('166系', 'E166'),
  ('168系', 'E168'),
  ('EF68形', 'LEF68'),
  ('DD52形', 'LDD52'),
  ('キハ62系', 'DKH62'),
  ('キハ116系', 'DKH116'),
  ('キハ44系', 'DKH44'),
  ('キハ128形', 'DKH128'),
  ('18系客車', 'P18'),
  ('28系客車', 'P28'),
  ('52系客車', 'P52'),
  ('展望車・特ロ', 'TENP');
-- 形式：系列の名前・形式の名前 → 新しいコード
create temp table _tm76 (sname text not null, label text not null, new text not null unique, primary key (sname, label)) on commit drop;
insert into _tm76(sname, label, new) values
  ('178系', 'Tc17800', 'E178-Tc17800'),
  ('178系', 'Mp17800', 'E178-Mp17800'),
  ('178系', 'M17800', 'E178-M17800'),
  ('178系', 'Ts17800', 'E178-Ts17800'),
  ('178系', 'Td17800', 'E178-Td17800'),
  ('378系', 'Tsc37800', 'E378-Tsc37800'),
  ('378系', 'Tp37800', 'E378-Tp37800'),
  ('378系', 'M37800', 'E378-M37800'),
  ('378系', 'T37800', 'E378-T37800'),
  ('378系', 'Mc37800', 'E378-Mc37800'),
  ('378系', 'Tpc37800', 'E378-Tpc37800'),
  ('378系', 'Tc37800', 'E378-Tc37800'),
  ('166系', 'Mc16600', 'E166-Mc16600'),
  ('166系', 'Mp16600', 'E166-Mp16600'),
  ('166系', 'Tc16600', 'E166-Tc16600'),
  ('166系', 'Ts16600', 'E166-Ts16600'),
  ('166系', 'Tb16600', 'E166-Tb16600'),
  ('168系', 'Mc16800', 'E168-Mc16800'),
  ('168系', 'Mp16800', 'E168-Mp16800'),
  ('168系', 'Tc16800', 'E168-Tc16800'),
  ('168系', 'Ts16800', 'E168-Ts16800'),
  ('168系', 'Tb16800', 'E168-Tb16800'),
  ('18系客車', 'ナハ18', 'P18-Naha18'),
  ('18系客車', 'ナハフ18', 'P18-Nahafu18'),
  ('18系客車', 'ナハ19', 'P18-Naha19'),
  ('18系客車', 'ナハフ19', 'P18-Nahafu19'),
  ('18系客車', 'ナロ18', 'P18-Naro18'),
  ('18系客車', 'オロ18', 'P18-Oro18'),
  ('18系客車', 'ナハネ18', 'P18-Nahane18'),
  ('18系客車', 'ナハネフ18', 'P18-Nahanefu18'),
  ('18系客車', 'ナハネ19', 'P18-Nahane19'),
  ('18系客車', 'ナハネフ19', 'P18-Nahanefu19'),
  ('18系客車', 'オハネ19', 'P18-Ohane19'),
  ('18系客車', 'オハネフ18', 'P18-Ohanefu18'),
  ('18系客車', 'オハネ18', 'P18-Ohane18'),
  ('18系客車', 'スハネ18', 'P18-Suhane18'),
  ('18系客車', 'オロネ18', 'P18-Orone18'),
  ('18系客車', 'オロネフ18', 'P18-Oronefu18'),
  ('18系客車', 'オシ18', 'P18-Oshi18'),
  ('18系客車', 'オシ19', 'P18-Oshi19'),
  ('18系客車', 'オユ18', 'P18-Oyu18'),
  ('18系客車', 'スユ19', 'P18-Suyu19'),
  ('28系客車', 'ナロネ28', 'P28-Narone28'),
  ('28系客車', 'ナロネ29', 'P28-Narone29'),
  ('28系客車', 'ナロネ27', 'P28-Narone27'),
  ('28系客車', 'ナハネ28', 'P28-Nahane28'),
  ('28系客車', 'ナハネフ28', 'P28-Nahanefu28'),
  ('28系客車', 'ナハネフ29', 'P28-Nahanefu29'),
  ('28系客車', 'ナハネフ27', 'P28-Nahanefu27'),
  ('28系客車', 'ナハネフ26', 'P28-Nahanefu26'),
  ('28系客車', 'ナロ28', 'P28-Naro28'),
  ('28系客車', 'ナハ28', 'P28-Naha28'),
  ('28系客車', 'ナハフ28', 'P28-Nahafu28'),
  ('28系客車', 'ナハフ29', 'P28-Nahafu29'),
  ('28系客車', 'ナシ28', 'P28-Nashi28'),
  ('28系客車', 'マニ28', 'P28-Mani28'),
  ('28系客車', 'カニ28', 'P28-Kani28'),
  ('28系客車', 'カニ29', 'P28-Kani29'),
  ('28系客車', 'マヤ28', 'P28-Maya28'),
  ('52系客車', 'オハ52', 'P52-Oha52'),
  ('52系客車', 'オハフ52', 'P52-Ohafu52'),
  ('52系客車', 'オハ53', 'P52-Oha53'),
  ('52系客車', 'オハフ53', 'P52-Ohafu53'),
  ('52系客車', 'マニ52', 'P52-Mani52'),
  ('52系客車', 'スユニ52', 'P52-Suyuni52'),
  ('展望車・特ロ', 'マイテ47', 'TENP-Maite47'),
  ('展望車・特ロ', 'マイテ56', 'TENP-Maite56'),
  ('展望車・特ロ', 'スロ56', 'TENP-Suro56'),
  ('展望車・特ロ', 'スロ58', 'TENP-Suro58'),
  ('EF68形', 'EF68', 'LEF68-EF68'),
  ('EF68形', 'EF68 500番台', 'LEF68-EF68-500'),
  ('DD52形', 'DD52', 'LDD52-DD52'),
  ('キハ62系', 'キハ62', 'DKH62-Kiha62'),
  ('キハ62系', 'キハ63', 'DKH62-Kiha63'),
  ('キハ62系', 'キロ63', 'DKH62-Kiro63'),
  ('キハ62系', 'キロ62', 'DKH62-Kiro62'),
  ('キハ62系', 'キハ69', 'DKH62-Kiha69'),
  ('キハ116系', 'キハ116', 'DKH116-Kiha116'),
  ('キハ116系', 'キハ117', 'DKH116-Kiha117'),
  ('キハ116系', 'キハ118', 'DKH116-Kiha118'),
  ('キハ44系', 'キハ44', 'DKH44-Kiha44'),
  ('キハ44系', 'キハ49', 'DKH44-Kiha49'),
  ('キハ44系', 'キハ49 1000番台', 'DKH44-Kiha49-1000'),
  ('キハ44系', 'キハ49 500番台', 'DKH44-Kiha49-500'),
  ('キハ44系', 'キハ49 1500番台', 'DKH44-Kiha49-1500'),
  ('キハ128形', 'キハ128', 'DKH128-Kiha128'),
  ('キハ128形', 'キハ128 200番台', 'DKH128-Kiha128-200'),
  ('キハ128形', 'キハ128 300番台', 'DKH128-Kiha128-300');

-- 名前で見つける（もう新しいコードになっているものは、そのまま）
do $$
declare ms int; mt int;
begin
  select count(*) into ms from _sm76 m where not exists (select 1 from public.mp_series s where s.name = m.name and s.yr is not null);
  select count(*) into mt from _tm76 m where not exists (select 1 from public.mp_types t join public.mp_series s on s.code = t.series
                                                          where s.yr is not null and s.name = m.sname and t.label = m.label);
  if ms > 0 or mt > 0 then raise exception '系列 % こ・形式 % こが、名前で見つかりません（DB の更新74 のあとに入れてください）', ms, mt; end if;
  if exists (select 1 from public.mp_series s join _sm76 m on m.new = s.code where s.yr is null or s.name <> m.name) then
    raise exception '新しい系列のコードが、もうほかで使われています';
  end if;
  if exists (select 1 from public.mp_types t join _tm76 m on m.new = t.code join public.mp_series s on s.code = t.series
              where s.yr is null or s.name <> m.sname or t.label <> m.label) then
    raise exception '新しい形式のコードが、もうほかで使われています';
  end if;
end $$;
create temp table _sc76 on commit drop as
  select s.code old, m.new from public.mp_series s join _sm76 m on m.name = s.name where s.yr is not null and s.code <> m.new;
create temp table _tc76 on commit drop as
  select t.code old, m.new, coalesce(c.new, t.series) nser
    from public.mp_types t join public.mp_series s on s.code = t.series join _tm76 m on m.sname = s.name and m.label = t.label
    left join _sc76 c on c.old = t.series
   where s.yr is not null and t.code <> m.new;

-- 新しいコードの系列・形式をつくる（中身は同じ）→ 使っているところを新しいコードに → 前のコードの系列・形式をけす
insert into public.mp_series select (jsonb_populate_record(null::public.mp_series, to_jsonb(s) || jsonb_build_object('code', c.new))).*
  from public.mp_series s join _sc76 c on c.old = s.code;
insert into public.mp_types select (jsonb_populate_record(null::public.mp_types, to_jsonb(t) || jsonb_build_object('code', c.new, 'series', c.nser))).*
  from public.mp_types t join _tc76 c on c.old = t.code;
update public.mp_cars x set type = c.new from _tc76 c where x.type = c.old;
update public.mp_car_hist x set type = c.new from _tc76 c where x.type = c.old;
update public.mp_serials x set type = c.new from _tc76 c where x.type = c.old;
update public.mp_fsets f set types = array(select coalesce(c.new, u.e) from unnest(f.types) with ordinality u(e, o) left join _tc76 c on c.old = u.e order by u.o)
 where f.types && array(select old from _tc76);
update public.mp_series s set sets = (select coalesce(jsonb_agg(case when jsonb_typeof(x.v -> 't') = 'array'
           then jsonb_set(x.v, '{t}', (select coalesce(jsonb_agg(to_jsonb(coalesce(c.new, e.e)) order by e.o), '[]'::jsonb)
                                         from jsonb_array_elements_text(x.v -> 't') with ordinality e(e, o) left join _tc76 c on c.old = e.e))
           else x.v end order by x.o), '[]'::jsonb)
         from jsonb_array_elements(s.sets) with ordinality x(v, o))
 where jsonb_typeof(s.sets) = 'array' and exists (select 1 from jsonb_array_elements(s.sets) x(v), jsonb_array_elements_text(case when jsonb_typeof(x.v -> 't') = 'array' then x.v -> 't' else '[]'::jsonb end) e(e)
                                                  join _tc76 c on c.old = e.e);
update public.mp_series s set grp = c.new from _sc76 c where s.grp = c.old;
delete from public.mp_types t using _tc76 c where t.code = c.old;
delete from public.mp_series s using _sc76 c where s.code = c.old;
do $$
begin
  if exists (select 1 from public.mp_types t join public.mp_series s on s.code = t.series where s.yr is not null and t.code not in (select new from _tm76)) then
    raise exception '新しいコードにならなかった形式があります';
  end if;
end $$;

-- 編成のきまり（説明のことばだけ。DB の更新76）
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

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_mp_form_rule_t' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
