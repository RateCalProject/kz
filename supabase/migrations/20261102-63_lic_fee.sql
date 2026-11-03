-- 鉄道の免許の申請料を変える：県は 県の人口 × 5 X（前は 10 X）。市区町村・区ごとの申請も、人口 × 5 X の3分の1 がかかる（どちらも1万 X 単位で切り上げ）：
--   申請のときにはらい、却下・取り下げのときは返す。市区町村・区は1つ 1万 X から。もう免許がある・申請中の県・市区町村は申請できない
--   app_settings：lic_fee_pref（1人あたり X）・lic_fee_muni_div（市区町村は県の何分の1か）。この更新の前に申請したものは そのまま

insert into public.app_settings(key, value) values ('lic_fee_pref', '5') on conflict (key) do update set value = excluded.value;
insert into public.app_settings(key, value) values ('lic_fee_muni_div', '3') on conflict (key) do nothing;

-- 県の免許の申請料：県の人口 × lic_fee_pref（1人あたり X）を 1万 X 単位で切り上げ。lic_fee_pref_min（X）より安くはしない
create or replace function public._mp_lic_pfee_of(pop numeric) returns bigint
language sql stable set search_path = public as $$
  select greatest(coalesce((select value from app_settings where key = 'lic_fee_pref_min'), '1000000')::bigint,
                  (ceil(coalesce(pop, 0) * coalesce((select value from app_settings where key = 'lic_fee_pref'), '5')::numeric / 10000) * 10000)::bigint)
$$;
-- 市区町村・区の申請料：人口 × lic_fee_pref ÷ lic_fee_muni_div（県の3分の1）を 1万 X 単位で切り上げ。1万 X から
create or replace function public._mp_lic_mfee(a text) returns bigint
language sql stable set search_path = public as $$
  select greatest(10000::bigint, (ceil(coalesce((select p.pop from mp_places p where p.id = a), 0)
           * coalesce((select value from app_settings where key = 'lic_fee_pref'), '5')::numeric
           / greatest(coalesce((select value from app_settings where key = 'lic_fee_muni_div'), '3')::numeric, 1) / 10000) * 10000)::bigint)
$$;

-- 市区町村をさがす（申請の画面）：名前に q をふくむ市区町村・区（20まで）。fee：その市区町村の申請料
create or replace function public.mp_lic_find(p_q text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); q text := btrim(coalesce(p_q, ''));
begin
  perform _mp_ok(u);
  if q = '' then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'n', _mp_area_text(p.id), 'k', p.k, 'pop', p.pop, 'fee', _mp_lic_mfee(p.id)) order by (p.name = q or p.name || coalesce(p.type, '') = q) desc, p.pop desc nulls last), '[]'::jsonb)
            from (select * from mp_places p where p.k in ('muni', 'ward') and (p.name || coalesce(p.type, '')) like '%' || q || '%' order by p.pop desc nulls last limit 20) p);
end $$;
-- 地図の点（マス）の市区町村。fee：その市区町村の申請料
create or replace function public.mp_lic_at(p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); a text;
begin
  perform _mp_ok(u);
  a := (_mp_cell(p_x, p_y)).a;
  if a is null or not exists (select 1 from mp_places where id = a and k in ('muni', 'ward')) then return null; end if;
  return jsonb_build_object('id', a, 'n', _mp_area_text(a), 'fee', _mp_lic_mfee(a));
end $$;

-- 申請する：市区町村・区・県（あわせて1〜30）・概要（10〜2000字）・計画の線（なくてもよい）
--   申請料（lic_fee_apply）があれば、はらう（却下でも返さない・取り下げは返す）
--   人口による申請料（県は 人口 × lic_fee_pref、市区町村・区は その lic_fee_muni_div 分の1）もはらう（却下・取り下げなら返す）
--   もう免許がある・申請中の県・市区町村は申請できない
create or replace function public.mp_lic_apply(p_areas text[], p_note text, p_pts int[], p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; ar text[]; pf text[]; mu text[]; have text[]; x text; dup text; note text := btrim(coalesce(p_note, ''));
        fee bigint := coalesce((select value from app_settings where key = 'lic_fee_apply'), '0')::bigint; pfee bigint := 0; mfee bigint := 0; l mp_lic; r record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国は免許なしで線路を引けます'; end if;
  have := _mp_lic_areas(pa.pu, pa.pc);
  if '*' = any(have) then raise exception '全国の免許があるので、申請はいりません'; end if;
  -- 県（その県の市町村・区ぜんぶ）
  pf := array(select distinct q.id from unnest(coalesce(p_areas, '{}')) q(id) join mp_places p on p.id = q.id and p.k = 'pref');
  foreach x in array pf loop
    if exists (select 1 from mp_lic h where h.st in ('ok', 'ask') and h.own_u is not distinct from pa.pu and h.own_c is not distinct from pa.pc and x = any(h.areas)) then
      raise exception '%の免許は、もう持っているか、申請しています', _mp_area_text(x);
    end if;
    pfee := pfee + _mp_lic_pfee(x);
  end loop;
  -- 市区町村・区（申請する県の中のもの・申請する市の区は、県・市の免許にふくまれるので はずす）
  mu := array(select distinct q.id from unnest(coalesce(p_areas, '{}')) q(id) join mp_places p on p.id = q.id and p.k in ('muni', 'ward')
               where not (p.k = 'muni' and p.parent = any(pf))
                 and not (p.k = 'ward' and exists (select 1 from mp_places m where m.id = p.parent and m.parent = any(pf))));
  mu := array(select a from unnest(mu) a where not exists (select 1 from mp_places w where w.id = a and w.k = 'ward' and w.parent = any(mu)));
  select string_agg(coalesce(nullif(_mp_area_text(z.a), ''), z.a), '・') into dup
    from (select a from unnest(mu) a
           where a = any(have) or exists (select 1 from mp_lic h where h.st = 'ask' and h.own_u is not distinct from pa.pu and h.own_c is not distinct from pa.pc and a = any(h.areas))
           limit 3) z;
  if dup is not null then raise exception 'もう免許があるか、申請中です：%（はずしてください）', dup; end if;
  mfee := coalesce((select sum(_mp_lic_mfee(a)) from unnest(mu) a), 0);
  ar := pf || mu;
  if coalesce(cardinality(ar), 0) = 0 then raise exception '市区町村か県をえらんでください'; end if;
  if cardinality(ar) > 30 then raise exception '市区町村と県は、あわせて 30 までです（分けて申請してください）'; end if;
  if char_length(note) < 10 then raise exception '概要を書いてください（10字より長く。どこからどこまで、どんな線か）'; end if;
  if char_length(note) > 2000 then raise exception '概要は 2000字までです'; end if;
  if p_pts is not null and (array_length(p_pts, 1) is null or array_length(p_pts, 1) % 2 <> 0 or array_length(p_pts, 1) > 400) then raise exception '計画の線が正しくありません（点は200こまで）'; end if;
  if (select count(*) from mp_lic where st = 'ask' and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc) >= 3 then raise exception '審査をまっている申請が 3つあります（おわってから申請してください）'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  if fee > 0 then perform _mp_pay(pa.pu, pa.pc, false, fee, 'lic', '鉄道の免許の申請料'); end if;
  if pfee + mfee > 0 then
    perform _mp_pay(pa.pu, pa.pc, false, pfee + mfee, 'lic', '鉄道の免許の申請料（' || concat_ws('・',
      case when cardinality(pf) > 0 then '県：' || (select string_agg(_mp_area_text(y), '・') from unnest(pf) y) end,
      case when cardinality(mu) > 0 then '市区町村 ' || cardinality(mu) end) || '）');
  end if;
  insert into mp_lic(own_u, own_c, areas, note, pts, fee, pfee) values (pa.pu, pa.pc, ar, note, p_pts, fee, pfee + mfee) returning * into l;
  -- 審査する人に知らせる
  for r in select p.id from profiles p where _mp_lic_rev(p.id) and p.id <> u loop
    perform _notice_l(r.id, format('【鉄道の免許】%s さんから申請があります（%s）。国土 → ≡ → 鉄道の免許 → 審査', _mp_pname(pa.pu, pa.pc, false),
                                   (select string_agg(coalesce(nullif(_mp_area_text(a), ''), a), '・') from unnest(ar[1:3]) a) || case when cardinality(ar) > 3 then ' ほか' else '' end
                                   || case when cardinality(pf) > 0 then '・県の免許' else '' end),
                      jsonb_build_object('go', 'map', 'k', 'lic'), null);
  end loop;
  return _mp_lic_json(l);
end $$;

-- 自分（名義）の免許と申請。rev：審査する人か。all：全国の免許。prefs：県の一覧（県の申請料・持っているか・申請中か）。pper・pmin・mdiv：申請料の決まり
create or replace function public.mp_lic_mine(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record; hv text[];
begin
  perform _mp_ok(u);
  begin select * into pa from _mp_party(u, p_as); exception when others then select u pu, null::int pc, false gv into pa; end;
  hv := _mp_lic_have(pa.pu, pa.pc);
  return jsonb_build_object('rev', _mp_lic_rev(u), 'gov', coalesce(pa.gv, false), 'fee', coalesce((select value from app_settings where key = 'lic_fee_apply'), '0')::bigint,
    'fee2', coalesce((select value from app_settings where key = 'lic_fee_grant'), '0')::bigint,
    'have', _mp_lic_names(hv), 'all', '*' = any(hv),
    'pper', coalesce((select value from app_settings where key = 'lic_fee_pref'), '5')::numeric, 'pmin', coalesce((select value from app_settings where key = 'lic_fee_pref_min'), '1000000')::bigint,
    'mdiv', coalesce((select value from app_settings where key = 'lic_fee_muni_div'), '3')::numeric,
    'list', (select coalesce(jsonb_agg(_mp_lic_json(l) order by l.id desc), '[]'::jsonb) from mp_lic l where l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc and not l.auto),
    'pend', case when _mp_lic_rev(u) then (select count(*) from mp_lic where st = 'ask') end,
    'prefs', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'n', _mp_area_text(p.id), 'munis', s.n, 'pop', s.pop, 'fee', _mp_lic_pfee_of(s.pop), 'have', p.id = any(hv),
                                         'ask', exists (select 1 from mp_lic l where l.st = 'ask' and l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc and p.id = any(l.areas)))
                                       order by s.pop desc), '[]'::jsonb)
                from mp_places p join (select m.parent, count(*) n, sum(m.pop) pop from mp_places m where m.k = 'muni' group by m.parent) s on s.parent = p.id
               where p.k = 'pref'));
end $$;

-- 許可・却下（ことばをそえる）。許可で免許料があれば、はらう（たりなければ未払いになる）。却下なら人口による申請料は返す
create or replace function public.mp_lic_decide(p_id bigint, p_ok boolean, p_reply text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); l mp_lic; who uuid; fee2 bigint := coalesce((select value from app_settings where key = 'lic_fee_grant'), '0')::bigint; rep text := left(btrim(coalesce(p_reply, '')), 1000);
begin
  perform _mp_ok(u);
  if not _mp_lic_rev(u) then raise exception '審査する人だけが決められます'; end if;
  if p_ok is null then raise exception '許可か却下をえらんでください'; end if;
  select * into l from mp_lic where id = p_id for update;
  if not found then raise exception '申請が見つかりません'; end if;
  if l.st <> 'ask' then raise exception 'もう決まっています'; end if;
  if not p_ok and rep = '' then raise exception '却下するときは、理由を書いてください'; end if;
  update mp_lic set st = case when p_ok then 'ok' else 'ng' end, by_u = u, reply = nullif(rep, ''), decided_at = now() where id = p_id;
  if p_ok and fee2 > 0 then perform _mp_soft_pay(l.own_u, l.own_c, false, fee2, 'lic', '鉄道の免許の免許料'); end if;   -- 足りなければ未払いに
  if not p_ok and l.pfee > 0 then perform _mp_earn(l.own_u, l.own_c, false, l.pfee, 'lic', '鉄道の免許の申請料（却下されたので返す）'); end if;
  who := coalesce(l.own_u, (select owner from companies where id = l.own_c));
  perform _notice_l(who, format('【鉄道の免許】%s：%s%s', case when p_ok then '許可されました' else '却下されました' end,
                                (select string_agg(coalesce(nullif(_mp_area_text(a), ''), a), '・') from unnest(l.areas[1:3]) a) || case when cardinality(l.areas) > 3 then ' ほか' else '' end,
                                case when rep <> '' then '（' || left(rep, 80) || '）' else '' end
                                || case when not p_ok and l.pfee > 0 then '。申請料は返しました' else '' end),
                    jsonb_build_object('go', 'map', 'k', 'lic'), null);
  return jsonb_build_object('ok', true);
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_lic_pfee_of', '_mp_lic_mfee', 'mp_lic_find', 'mp_lic_at', 'mp_lic_apply', 'mp_lic_mine', 'mp_lic_decide') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
