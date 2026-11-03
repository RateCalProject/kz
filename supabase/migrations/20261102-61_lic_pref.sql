-- 鉄道の免許を県ごとにも申請できる（お金がかかる）・管理者の本人の名義には全国の免許：
--   国土 → ≡ →「🚃 鉄道の免許」→「申請する」の「県ごとに申請する」で県をえらぶ。県の免許は、その県の市町村・区ぜんぶ（あとでふえた市町村もふくむ）
--   県の申請料は 県の人口 × 10 X（1万 X 単位で切り上げ・100万 X から。app_settings の lic_fee_pref・lic_fee_pref_min）。審査は市区町村と同じ。却下・取り下げなら返す
--   全国の免許をもつ名義は、どこにでも線路を引ける（申請はいらない）

alter table public.mp_lic add column if not exists pfee bigint not null default 0;   -- 県の免許の申請料（却下・取り下げなら返す。DB の更新61）
insert into public.app_settings(key, value) values ('lic_fee_pref', '10'), ('lic_fee_pref_min', '1000000') on conflict (key) do nothing;

-- 県の免許の申請料：県の人口 × lic_fee_pref（1人あたり X）を 1万 X 単位で切り上げ。lic_fee_pref_min（X）より安くはしない
create or replace function public._mp_lic_pfee_of(pop numeric) returns bigint
language sql stable set search_path = public as $$
  select greatest(coalesce((select value from app_settings where key = 'lic_fee_pref_min'), '1000000')::bigint,
                  (ceil(coalesce(pop, 0) * coalesce((select value from app_settings where key = 'lic_fee_pref'), '10')::numeric / 10000) * 10000)::bigint)
$$;
create or replace function public._mp_lic_pfee(p text) returns bigint
language sql stable set search_path = public as $$
  select _mp_lic_pfee_of((select sum(m.pop) from mp_places m where m.k = 'muni' and m.parent = p))
$$;
-- 免許のある市区町村・区（市の免許はその市の区もふくむ・県の免許はその県の市町村と区ぜんぶ）。全国の免許があれば {*}
create or replace function public._mp_lic_areas(pu uuid, pc int) returns text[]
language sql stable set search_path = public as $$
  with a as (select distinct unnest(l.areas) id from mp_lic l where l.st = 'ok' and l.own_u is not distinct from pu and l.own_c is not distinct from pc),
       mu as (select a.id from a where a.id <> '*'
              union select m.id from mp_places m where m.k = 'muni' and m.parent in (select a.id from a join mp_places p on p.id = a.id and p.k = 'pref'))
  select case when exists (select 1 from a where a.id = '*') then array['*']::text[]
              else coalesce((select array_agg(z.id) from (select mu.id from mu union select w.id from mp_places w where w.k = 'ward' and w.parent in (select mu.id from mu)) z), '{}') end
$$;
-- 持っている免許（見せる用）：全国なら {*}。県の免許にふくまれる市町村・区は はぶく。県が先、あとは名前の順
create or replace function public._mp_lic_have(pu uuid, pc int) returns text[]
language sql stable set search_path = public as $$
  with raw as (select distinct unnest(l.areas) a from mp_lic l where l.st = 'ok' and l.own_u is not distinct from pu and l.own_c is not distinct from pc),
       pf as (select raw.a from raw join mp_places p on p.id = raw.a and p.k = 'pref')
  select case when exists (select 1 from raw where raw.a = '*') then array['*']::text[]
    else coalesce((select array_agg(z.a order by z.isp desc, z.t) from (
           select raw.a, coalesce(p.k = 'pref', false) isp, coalesce(_mp_area_text(raw.a), raw.a) t from raw left join mp_places p on p.id = raw.a
            where not coalesce(p.k = 'muni' and p.parent in (select pf.a from pf), false)
              and not coalesce(p.k = 'ward' and exists (select 1 from mp_places c where c.id = p.parent and c.parent in (select pf.a from pf)), false)) z), '{}') end
$$;
-- 線路を引くマス（[x, y, …]）のうち、免許のない市区町村の名前（5つまで）。なければ null。区域のわからないところ・海は見ない。全国の免許なら null
create or replace function public._mp_lic_need(pu uuid, pc int, tiles int[]) returns text
language plpgsql stable set search_path = public as $$
declare ok text[]; a text; seen text[] := '{}'; miss text[] := '{}'; i int;
begin
  if coalesce(array_length(tiles, 1), 0) < 2 then return null; end if;
  ok := _mp_lic_areas(pu, pc);
  if '*' = any(ok) then return null; end if;   -- 全国の免許（DB の更新61）
  for i in 1..array_length(tiles, 1) / 2 loop
    a := (_mp_cell(tiles[2 * i - 1], tiles[2 * i])).a;
    if a is null or a = any(seen) then continue; end if;
    seen := seen || a;
    if a = any(ok) or not exists (select 1 from mp_places p where p.id = a and p.k in ('muni', 'ward')) then continue; end if;
    miss := miss || a;
  end loop;
  if cardinality(miss) = 0 then return null; end if;
  return (select string_agg(coalesce(nullif(_mp_area_text(m), ''), m), '・') from unnest(miss[1:5]) m) || case when cardinality(miss) > 5 then ' ほか' else '' end;
end $$;
-- 名前（〇〇県〇〇市〇〇区）。k：pref（県ぜんぶ）・muni・ward・all（全国）
create or replace function public._mp_lic_names(ids text[]) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id,
           'n', case when x.id = '*' then '全国' else coalesce(nullif(_mp_area_text(x.id), ''), x.id) end,
           'k', case when x.id = '*' then 'all' else (select p.k from mp_places p where p.id = x.id) end) order by x.o), '[]'::jsonb)
    from unnest(ids) with ordinality x(id, o)
$$;
create or replace function public._mp_lic_json(l mp_lic) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', l.id, 'st', l.st, 'areas', _mp_lic_names(l.areas), 'note', l.note, 'pts', to_jsonb(l.pts), 'fee', l.fee, 'pfee', l.pfee, 'reply', l.reply, 'auto', l.auto,
    'by', (select nickname from profiles where id = l.by_u), 'who', _mp_pname(l.own_u, l.own_c, false),
    'at', extract(epoch from l.created_at), 'dec', extract(epoch from l.decided_at))
$$;

-- 申請する：市区町村・区・県（あわせて1〜30）・概要（10〜2000字）・計画の線（なくてもよい）
--   申請料があれば、はらう（却下でも返さない・取り下げは返す）。県は、県の申請料もはらう（却下・取り下げなら返す）
create or replace function public.mp_lic_apply(p_areas text[], p_note text, p_pts int[], p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; ar text[]; pf text[]; x text; note text := btrim(coalesce(p_note, ''));
        fee bigint := coalesce((select value from app_settings where key = 'lic_fee_apply'), '0')::bigint; pfee bigint := 0; l mp_lic; r record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国は免許なしで線路を引けます'; end if;
  if '*' = any(_mp_lic_areas(pa.pu, pa.pc)) then raise exception '全国の免許があるので、申請はいりません'; end if;
  -- 県（その県の市町村・区ぜんぶ。県の申請料がかかる）
  pf := array(select distinct q.id from unnest(coalesce(p_areas, '{}')) q(id) join mp_places p on p.id = q.id and p.k = 'pref');
  foreach x in array pf loop
    if exists (select 1 from mp_lic h where h.st in ('ok', 'ask') and h.own_u is not distinct from pa.pu and h.own_c is not distinct from pa.pc and x = any(h.areas)) then
      raise exception '%の免許は、もう持っているか、申請しています', _mp_area_text(x);
    end if;
    pfee := pfee + _mp_lic_pfee(x);
  end loop;
  -- 市区町村・区（申請する県の中のものは、県の免許にふくまれるので はずす）
  ar := array(select distinct q.id from unnest(coalesce(p_areas, '{}')) q(id) join mp_places p on p.id = q.id and p.k in ('muni', 'ward')
               where not (p.k = 'muni' and p.parent = any(pf))
                 and not (p.k = 'ward' and exists (select 1 from mp_places m where m.id = p.parent and m.parent = any(pf))));
  ar := pf || ar;
  if coalesce(cardinality(ar), 0) = 0 then raise exception '市区町村か県をえらんでください'; end if;
  if cardinality(ar) > 30 then raise exception '市区町村と県は、あわせて 30 までです（分けて申請してください）'; end if;
  if char_length(note) < 10 then raise exception '概要を書いてください（10字より長く。どこからどこまで、どんな線か）'; end if;
  if char_length(note) > 2000 then raise exception '概要は 2000字までです'; end if;
  if p_pts is not null and (array_length(p_pts, 1) is null or array_length(p_pts, 1) % 2 <> 0 or array_length(p_pts, 1) > 400) then raise exception '計画の線が正しくありません（点は200こまで）'; end if;
  if (select count(*) from mp_lic where st = 'ask' and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc) >= 3 then raise exception '審査をまっている申請が 3つあります（おわってから申請してください）'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  if fee > 0 then perform _mp_pay(pa.pu, pa.pc, false, fee, 'lic', '鉄道の免許の申請料'); end if;
  if pfee > 0 then perform _mp_pay(pa.pu, pa.pc, false, pfee, 'lic', '鉄道の免許の申請料（県：' || (select string_agg(_mp_area_text(y), '・') from unnest(pf) y) || '）'); end if;
  insert into mp_lic(own_u, own_c, areas, note, pts, fee, pfee) values (pa.pu, pa.pc, ar, note, p_pts, fee, pfee) returning * into l;
  -- 審査する人に知らせる
  for r in select p.id from profiles p where _mp_lic_rev(p.id) and p.id <> u loop
    perform _notice_l(r.id, format('【鉄道の免許】%s さんから申請があります（%s）。国土 → ≡ → 鉄道の免許 → 審査', _mp_pname(pa.pu, pa.pc, false),
                                   (select string_agg(coalesce(nullif(_mp_area_text(a), ''), a), '・') from unnest(ar[1:3]) a) || case when cardinality(ar) > 3 then ' ほか' else '' end
                                   || case when cardinality(pf) > 0 then '・県の免許' else '' end),
                      jsonb_build_object('go', 'map', 'k', 'lic'), null);
  end loop;
  return _mp_lic_json(l);
end $$;

-- 自分（名義）の免許と申請。rev：審査する人か。all：全国の免許。prefs：県の一覧（県の申請料・持っているか・申請中か）
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
    'pper', coalesce((select value from app_settings where key = 'lic_fee_pref'), '10')::numeric, 'pmin', coalesce((select value from app_settings where key = 'lic_fee_pref_min'), '1000000')::bigint,
    'list', (select coalesce(jsonb_agg(_mp_lic_json(l) order by l.id desc), '[]'::jsonb) from mp_lic l where l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc and not l.auto),
    'pend', case when _mp_lic_rev(u) then (select count(*) from mp_lic where st = 'ask') end,
    'prefs', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'n', _mp_area_text(p.id), 'munis', s.n, 'pop', s.pop, 'fee', _mp_lic_pfee_of(s.pop), 'have', p.id = any(hv),
                                         'ask', exists (select 1 from mp_lic l where l.st = 'ask' and l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc and p.id = any(l.areas)))
                                       order by s.pop desc), '[]'::jsonb)
                from mp_places p join (select m.parent, count(*) n, sum(m.pop) pop from mp_places m where m.k = 'muni' group by m.parent) s on s.parent = p.id
               where p.k = 'pref'));
end $$;

-- 取り下げ（審査の前だけ。申請料も県の申請料も返す）
create or replace function public.mp_lic_cancel(p_id bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; l mp_lic;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into l from mp_lic where id = p_id for update;
  if not found or not (l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc) then raise exception '申請が見つかりません'; end if;
  if l.st <> 'ask' then raise exception 'もう審査がおわっています'; end if;
  update mp_lic set st = 'cancel', decided_at = now() where id = p_id;
  if l.fee + l.pfee > 0 then perform _mp_earn(l.own_u, l.own_c, false, l.fee + l.pfee, 'lic', '鉄道の免許の申請料（取り下げたので返す）'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 審査：まっているもの（古い順）と、30日以内に決めたもの。have：申請した名義が いま持っている免許（県・全国はそのまま）
create or replace function public.mp_lic_review() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me();
begin
  perform _mp_ok(u);
  if not _mp_lic_rev(u) then raise exception '審査する人だけが見られます'; end if;
  return jsonb_build_object(
    'ask', (select coalesce(jsonb_agg(_mp_lic_json(l) || jsonb_build_object('have', _mp_lic_names(_mp_lic_have(l.own_u, l.own_c))) order by l.id), '[]'::jsonb)
              from mp_lic l where l.st = 'ask'),
    'done', (select coalesce(jsonb_agg(_mp_lic_json(l) order by l.decided_at desc), '[]'::jsonb)
               from (select * from mp_lic where st in ('ok', 'ng') and not auto and decided_at > now() - interval '30 days' order by decided_at desc limit 50) l));
end $$;

-- 許可・却下（ことばをそえる）。許可で免許料があれば、はらう（たりなければ未払いになる）。却下なら県の申請料は返す
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
  if not p_ok and l.pfee > 0 then perform _mp_earn(l.own_u, l.own_c, false, l.pfee, 'lic', '鉄道の免許の申請料（県。却下されたので返す）'); end if;
  who := coalesce(l.own_u, (select owner from companies where id = l.own_c));
  perform _notice_l(who, format('【鉄道の免許】%s：%s%s', case when p_ok then '許可されました' else '却下されました' end,
                                (select string_agg(coalesce(nullif(_mp_area_text(a), ''), a), '・') from unnest(l.areas[1:3]) a) || case when cardinality(l.areas) > 3 then ' ほか' else '' end,
                                case when rep <> '' then '（' || left(rep, 80) || '）' else '' end
                                || case when not p_ok and l.pfee > 0 then '。県の申請料は返しました' else '' end),
                    jsonb_build_object('go', 'map', 'k', 'lic'), null);
  return jsonb_build_object('ok', true);
end $$;

-- 管理者の本人の名義には、全国の免許（はじめから持っている免許として。もう持っていれば足さない）
insert into public.mp_lic(own_u, own_c, areas, note, st, auto, decided_at)
select a.id, null, array['*'], '全国の免許（管理者）', 'ok', true, now()
  from (select distinct x::uuid id from unnest(string_to_array(replace(coalesce((select value from public.app_settings where key = 'admins'), ''), ' ', ''), ',')) x
         where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') a
 where exists (select 1 from public.profiles p where p.id = a.id)
   and not exists (select 1 from public.mp_lic l where l.own_u = a.id and l.own_c is null and l.st = 'ok' and '*' = any(l.areas));

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_lic_pfee_of', '_mp_lic_pfee', '_mp_lic_have', '_mp_lic_areas', '_mp_lic_need', '_mp_lic_names', '_mp_lic_json',
                                                        'mp_lic_apply', 'mp_lic_mine', 'mp_lic_cancel', 'mp_lic_review', 'mp_lic_decide') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
