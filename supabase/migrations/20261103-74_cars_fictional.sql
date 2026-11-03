-- 更新72で入れた車両の名前を、架空の名前にした（更新72のファイルも、あとで架空の名前とコードに書きかえた。
--   そのときに、この更新の名前の書きかえ・改番の部分はけした。DB にはもう入っている）
--   122系の説明に、ほかの車両の名前を書かない。編成のきまり（_mp_form_rule_t）の電源車の説明も架空の名前に

update public.mp_series set note = '通勤形電車（最高100km/h・4ドア・ロングシート）。Mp と M で1組（ユニット）' where code = '122-0';

-- 編成のきまり（電源車の名前。DB の更新74）
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
