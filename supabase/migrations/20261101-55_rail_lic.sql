-- 鉄道の免許（t108）：線路を引くには、その市区町村の免許がいる。国土 → ≡ →「🚃 鉄道の免許」で、市区町村をえらび、どんな線を引くかの概要（と計画の線）を書いて申請 → 審査（許可・却下）
--   免許のない市区町村には、線路を新しく引けない・形を変えて広げられない（国の工事はいらない）。いまの線路がある市区町村の免許は、はじめから持っている

create table if not exists public.mp_lic (          -- 鉄道の免許（申請・審査・免許）
  id     bigserial primary key,
  own_u  uuid references public.profiles(id) on delete cascade,
  own_c  int references public.companies(id) on delete cascade,
  areas  text[] not null,                          -- 市区町村・区の id（市の免許は、その市の区もふくむ）
  note   text not null default '',                 -- 概要：どこからどこまで、どんな線を引くか
  pts    int[],                                    -- 計画の線（1/100 マス。なくてもよい）
  st     text not null default 'ask' check (st in ('ask', 'ok', 'ng', 'cancel')),
  fee    bigint not null default 0,                -- はらった申請料
  by_u   uuid references public.profiles(id) on delete set null,   -- 審査した人
  reply  text,                                     -- 審査のことば
  auto   boolean not null default false,           -- はじめから持っている（いま線路がある市区町村）
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists mp_lic_own on public.mp_lic (own_u, own_c, st);
create index if not exists mp_lic_st on public.mp_lic (st, created_at);
alter table public.mp_lic enable row level security;
insert into public.app_settings(key, value) values ('lic_fee_apply', '0'), ('lic_fee_grant', '0') on conflict (key) do nothing;

-- 審査する人
create or replace function public._mp_lic_rev(u uuid) returns boolean
language sql stable set search_path = public as $$
  select coalesce(_is_admin(u), false) or exists (select 1 from profiles p where p.id = u and p.account_no = any(string_to_array(replace(coalesce((select value from app_settings where key = 'licreviewers'), ''), ' ', ''), ',')))
$$;
-- 免許のある市区町村・区（市の免許はその市の区もふくむ）
create or replace function public._mp_lic_areas(pu uuid, pc int) returns text[]
language sql stable set search_path = public as $$
  with a as (select distinct unnest(l.areas) id from mp_lic l where l.st = 'ok' and l.own_u is not distinct from pu and l.own_c is not distinct from pc)
  select coalesce(array_agg(id), '{}') from (select id from a union select p.id from mp_places p where p.k = 'ward' and p.parent in (select id from a)) z
$$;
-- 線路を引くマス（[x, y, …]）のうち、免許のない市区町村の名前（5つまで）。なければ null。区域のわからないところ・海は見ない
create or replace function public._mp_lic_need(pu uuid, pc int, tiles int[]) returns text
language plpgsql stable set search_path = public as $$
declare ok text[]; a text; seen text[] := '{}'; miss text[] := '{}'; i int;
begin
  if coalesce(array_length(tiles, 1), 0) < 2 then return null; end if;
  ok := _mp_lic_areas(pu, pc);
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
-- 名前（〇〇県〇〇市〇〇区）
create or replace function public._mp_lic_names(ids text[]) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'n', coalesce(nullif(_mp_area_text(x.id), ''), x.id)) order by x.o), '[]'::jsonb) from unnest(ids) with ordinality x(id, o)
$$;
create or replace function public._mp_lic_json(l mp_lic) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', l.id, 'st', l.st, 'areas', _mp_lic_names(l.areas), 'note', l.note, 'pts', to_jsonb(l.pts), 'fee', l.fee, 'reply', l.reply, 'auto', l.auto,
    'by', (select nickname from profiles where id = l.by_u), 'who', _mp_pname(l.own_u, l.own_c, false),
    'at', extract(epoch from l.created_at), 'dec', extract(epoch from l.decided_at))
$$;

-- 市区町村をさがす（申請の画面）：名前に q をふくむ市区町村・区（20まで）
create or replace function public.mp_lic_find(p_q text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); q text := btrim(coalesce(p_q, ''));
begin
  perform _mp_ok(u);
  if q = '' then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'n', _mp_area_text(p.id), 'k', p.k, 'pop', p.pop) order by (p.name = q or p.name || coalesce(p.type, '') = q) desc, p.pop desc nulls last), '[]'::jsonb)
            from (select * from mp_places p where p.k in ('muni', 'ward') and (p.name || coalesce(p.type, '')) like '%' || q || '%' order by p.pop desc nulls last limit 20) p);
end $$;
-- 地図の点（マス）の市区町村
create or replace function public.mp_lic_at(p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); a text;
begin
  perform _mp_ok(u);
  a := (_mp_cell(p_x, p_y)).a;
  if a is null or not exists (select 1 from mp_places where id = a and k in ('muni', 'ward')) then return null; end if;
  return jsonb_build_object('id', a, 'n', _mp_area_text(a));
end $$;

-- 申請する：市区町村・区（1〜30）・概要（10〜2000字）・計画の線（なくてもよい）。申請料があれば、はらう（却下でも返さない・取り下げは返す）
create or replace function public.mp_lic_apply(p_areas text[], p_note text, p_pts int[], p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; ar text[]; note text := btrim(coalesce(p_note, '')); fee bigint := coalesce((select value from app_settings where key = 'lic_fee_apply'), '0')::bigint; l mp_lic; r record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国は免許なしで線路を引けます'; end if;
  ar := array(select distinct a from unnest(coalesce(p_areas, '{}')) a where exists (select 1 from mp_places p where p.id = a and p.k in ('muni', 'ward')));
  if coalesce(cardinality(ar), 0) = 0 then raise exception '市区町村をえらんでください'; end if;
  if cardinality(ar) > 30 then raise exception '市区町村は 30 までです（分けて申請してください）'; end if;
  if char_length(note) < 10 then raise exception '概要を書いてください（10字より長く。どこからどこまで、どんな線か）'; end if;
  if char_length(note) > 2000 then raise exception '概要は 2000字までです'; end if;
  if p_pts is not null and (array_length(p_pts, 1) is null or array_length(p_pts, 1) % 2 <> 0 or array_length(p_pts, 1) > 400) then raise exception '計画の線が正しくありません（点は200こまで）'; end if;
  if (select count(*) from mp_lic where st = 'ask' and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc) >= 3 then raise exception '審査をまっている申請が 3つあります（おわってから申請してください）'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  if fee > 0 then perform _mp_pay(pa.pu, pa.pc, false, fee, 'lic', '鉄道の免許の申請料'); end if;
  insert into mp_lic(own_u, own_c, areas, note, pts, fee) values (pa.pu, pa.pc, ar, note, p_pts, fee) returning * into l;
  -- 審査する人に知らせる
  for r in select p.id from profiles p where _mp_lic_rev(p.id) and p.id <> u loop
    perform _notice_l(r.id, format('【鉄道の免許】%s さんから申請があります（%s）。国土 → ≡ → 鉄道の免許 → 審査', _mp_pname(pa.pu, pa.pc, false),
                                   (select string_agg(coalesce(nullif(_mp_area_text(a), ''), a), '・') from unnest(ar[1:3]) a) || case when cardinality(ar) > 3 then ' ほか' else '' end),
                      jsonb_build_object('go', 'map', 'k', 'lic'), null);
  end loop;
  return _mp_lic_json(l);
end $$;

-- 自分（名義）の免許と申請。rev：審査する人か
create or replace function public.mp_lic_mine(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  begin select * into pa from _mp_party(u, p_as); exception when others then select u pu, null::int pc, false gv into pa; end;
  return jsonb_build_object('rev', _mp_lic_rev(u), 'gov', coalesce(pa.gv, false), 'fee', coalesce((select value from app_settings where key = 'lic_fee_apply'), '0')::bigint,
    'fee2', coalesce((select value from app_settings where key = 'lic_fee_grant'), '0')::bigint,
    'have', _mp_lic_names(array(select distinct unnest(l.areas) from mp_lic l where l.st = 'ok' and l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc)),
    'list', (select coalesce(jsonb_agg(_mp_lic_json(l) order by l.id desc), '[]'::jsonb) from mp_lic l where l.own_u is not distinct from pa.pu and l.own_c is not distinct from pa.pc and not l.auto),
    'pend', case when _mp_lic_rev(u) then (select count(*) from mp_lic where st = 'ask') end);
end $$;

-- 取り下げ（審査の前だけ。申請料は返す）
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
  if l.fee > 0 then perform _mp_earn(l.own_u, l.own_c, false, l.fee, 'lic', '鉄道の免許の申請料（取り下げたので返す）'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 審査：まっているもの（古い順）と、30日以内に決めたもの
create or replace function public.mp_lic_review() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me();
begin
  perform _mp_ok(u);
  if not _mp_lic_rev(u) then raise exception '審査する人だけが見られます'; end if;
  return jsonb_build_object(
    'ask', (select coalesce(jsonb_agg(_mp_lic_json(l) || jsonb_build_object('have', _mp_lic_names(_mp_lic_areas(l.own_u, l.own_c))) order by l.id), '[]'::jsonb) from mp_lic l where l.st = 'ask'),
    'done', (select coalesce(jsonb_agg(_mp_lic_json(l) order by l.decided_at desc), '[]'::jsonb)
               from (select * from mp_lic where st in ('ok', 'ng') and not auto and decided_at > now() - interval '30 days' order by decided_at desc limit 50) l));
end $$;

-- 許可・却下（ことばをそえる）。許可で免許料があれば、はらう（たりなければ未払いになる）
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
  who := coalesce(l.own_u, (select owner from companies where id = l.own_c));
  perform _notice_l(who, format('【鉄道の免許】%s：%s%s', case when p_ok then '許可されました' else '却下されました' end,
                                (select string_agg(coalesce(nullif(_mp_area_text(a), ''), a), '・') from unnest(l.areas[1:3]) a) || case when cardinality(l.areas) > 3 then ' ほか' else '' end,
                                case when rep <> '' then '（' || left(rep, 80) || '）' else '' end),
                    jsonb_build_object('go', 'map', 'k', 'lic'), null);
  return jsonb_build_object('ok', true);
end $$;

-- いま線路を持っている人・会社は、その線路がある市区町村の免許を、はじめから持っている
with seg as materialized (select s.own_u, s.own_c, public._mp_tiles(s.pts) tl from public.mp_segs s
                           where s.kind = 'rail' and not s.gov and (s.own_u is not null or s.own_c is not null)),
     cel as materialized (select seg.own_u, seg.own_c, (public._mp_cell(seg.tl[2 * i - 1], seg.tl[2 * i])).a a
                            from seg cross join lateral generate_series(1, array_length(seg.tl, 1) / 2) i)
insert into public.mp_lic(own_u, own_c, areas, note, st, auto, decided_at)
select cel.own_u, cel.own_c, array_agg(distinct cel.a), 'いまの線路がある市区町村（はじめから持っている免許）', 'ok', true, now()
  from cel
 where cel.a is not null and exists (select 1 from public.mp_places p where p.id = cel.a and p.k in ('muni', 'ward'))
   and not exists (select 1 from public.mp_lic l where l.auto)
 group by cel.own_u, cel.own_c;

create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; mul real[]; cells int[]; sw real; need jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_kind not in ('road', 'rail') then raise exception '作るものがちがいます'; end if;
  if p_kind = 'rail' then cls := 'rail'; if pa.gv then raise exception '線路は人か会社で作ります'; end if; end if;
  if p_kind = 'road' then
    if pa.gv then if cls not in ('exp', 'nat', 'pref', 'city', 'lane') then cls := 'city'; end if;
    else cls := 'priv'; end if;
    dbl := false; elec := false;
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
  if not pa.gv then mul := _mp_cmuls(tiles, ters); end if;   -- 国の工事は無料（t57b）：工事費の計算もしない
  sw := case when p_kind = 'rail' then case when dbl then 0.5 else 0.36 end else _mp_road_w(cls, ln_) end;
  cells := _mp_seg_cells_arr(p_pts, p_kind, sw, dbl);
  -- 駅のホーム・車庫・バス停にかかるところは通れない（区画で見る。つなぐはしの 20m はのぞく）。建物のある筆（区画）も通れない
  bad := _mp_seg_blocked(tiles, case when p_from is null and p_to is null then cells
           else _mp_seg_cells_arr(_mp_sub(p_pts, case when p_from is null then 0 else least(0.4, ln / 3) end, case when p_to is null then ln else ln - least(0.4, ln / 3) end), p_kind, sw, dbl) end);
  if bad is not null then raise exception '%にかかるので、通れません（線をずらしてください）', left(bad, 80); end if;
  bad := _mp_bld_hit(cells);
  if bad is not null then raise exception '建物のある土地（%）は通れません', left(bad, 60); end if;
  base := case when p_kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(cls, ln_) end;
  if not pa.gv then
    for i in 1..array_length(ters, 1) loop
      cost := cost + base * mul[i] * case when dbl then _mp_rate('dbl_mul') else 1 end + case when elec then _mp_rate('elec') else 0 end;
    end loop;
  end if;
  cost := round(cost);
  select * into lq from _mp_lease_quote(cells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(cells, pa.pu, pa.pc, pa.gv);
  if p_dry then
    return jsonb_build_object('cost', cost, 'lease', round(lq.fee), 'own', lq.own, 'other', lq.other, 'state', lq.state, 'pub', lq.pub,
      'tiles', array_length(tiles, 1) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50),
      'vlim', case when p_kind = 'rail' then _mp_vlim(rmin) else _mp_road_v(cls, ln_) end, 'lanes', ln_,
      'vtop', case when p_kind = 'rail' then (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v) else _mp_road_v(cls, ln_) end,
      'tunnel', (select count(*) from unnest(ters) t where t in ('M', 'K')), 'bridge', (select count(*) from unnest(ters) t where t in ('R', 'L', 'S')), 'need', need);
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, case when p_kind = 'rail' then _mp_vlim(rmin) else _mp_road_v(cls, ln_) end, n0, n1, cost)
  returning id into sid;
  perform _mp_occ_set(sid, p_kind, tiles);
  perform _mp_lease_set('seg', sid, pa.pu, pa.pc, pa.gv);
  if p_kind = 'rail' then perform _mp_renet(pa.pu, pa.pc); perform _mp_routes_fix(pa.pu, pa.pc); end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee));
end $$;
create or replace function public.mp_seg_edit(p_id bigint, p_ctl int[], p_pts int[], p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); sg mp_segs; me_cs int[]; tiles int[]; old int[]; newt int[] := '{}'; ters text[]; ln real; rmin real; amt_ numeric := 0; mul real[]; i int; base numeric; lq record; a mp_nodes; b mp_nodes; np int := array_length(p_pts, 1) / 2; bad text;
        ncells int[]; need jsonb;
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
  if sg.kind = 'rail' and not sg.gov then   -- 鉄道の免許（t108）：免許のない市区町村には引けない
    bad := _mp_lic_need(sg.own_u, sg.own_c, newt);
    if bad is not null then raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', bad; end if;
  end if;
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  if not sg.gov then mul := _mp_cmuls(newt, ters); end if;   -- 国の工事は無料（t57b）
  bad := _mp_seg_blocked(tiles, _mp_seg_cells_arr(_mp_sub(p_pts, least(0.4, ln / 3), ln - least(0.4, ln / 3)), sg.kind, sg.w, sg.dbl));
  if bad is not null then raise exception '%にかかるので、通れません（線をずらしてください）', left(bad, 80); end if;
  ncells := _mp_seg_cells_arr(p_pts, sg.kind, sg.w, sg.dbl);
  bad := _mp_bld_hit(ncells);
  if bad is not null then raise exception '建物のある土地（%）は通れません', left(bad, 60); end if;
  base := case when sg.kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(sg.cls, sg.lanes) end;
  if not sg.gov then
    for i in 1..coalesce(array_length(ters, 1), 0) loop
      amt_ := amt_ + base * mul[i] * case when sg.dbl then _mp_rate('dbl_mul') else 1 end + case when sg.elec then _mp_rate('elec') else 0 end;
    end loop;
  end if;
  amt_ := round(amt_);
  select * into lq from _mp_lease_quote(ncells, sg.own_u, sg.own_c, sg.gov);
  -- 新しく通る他人の筆は、貸出料があるか申請が許可されているときだけ（前から通っている区画はそのまま）
  need := _mp_land_need(ncells, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  if p_dry then return jsonb_build_object('cost', amt_, 'lease', round(lq.fee), 'tiles', array_length(tiles, 1) / 2, 'new', coalesce(array_length(newt, 1), 0) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50), 'vlim', _mp_vlim(rmin),
    'vtop', (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v), 'need', need); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, format('%sの引きなおし', case when sg.kind = 'rail' then '線路' else '道路' end));
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  delete from mp_occ where what = sg.kind and ref = p_id;
  perform _mp_occ_set(p_id, sg.kind, tiles);
  update mp_segs set ctl = p_ctl, pts = p_pts, bb = _mp_bb(p_pts), len = ln, vlim = case when kind = 'rail' then _mp_vlim(rmin) else vlim end, cost = cost + amt_::bigint where id = p_id;
  -- 使用料は新しい形の区画で決めなおす
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  perform _mp_chg('seg', p_id, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', p_id, 'cost', amt_);
end $$;
create or replace function public.mp_sta_build(p_kind text, p_seg bigint, p_x real, p_y real, p_plat int, p_tracks int, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; span real; tiles int[]; cost numeric; sid bigint; pt record; nm text := left(trim(coalesce(p_name, '')), 20); sub int[];
        pcs int[]; oc int[]; need jsonb; lfee numeric := 0;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '駅・バス停は人か会社で作ります'; end if;
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  select * into sg from mp_segs where id = p_seg;
  if not found then raise exception '線が見つかりません'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y); s := q.s;
  if q.dist > 1.2 then raise exception '線の上をえらんでください'; end if;
  if p_kind = 'rail' and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if p_kind = 'rail' and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if nm = '' then raise exception '名前をつけてください'; end if;
  if p_kind = 'rail' then
    if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, false) then raise exception '駅は自分（この名義）の線路の上に作ります'; end if;
    if p_plat < 20 or p_plat > 400 or p_plat % 20 <> 0 then raise exception 'ホームの長さは20m単位で、20〜400mです'; end if;
    if p_tracks < 1 or p_tracks > 8 then raise exception '番線の数は1〜8です'; end if;
    span := p_plat / 50.0;
    if s - span / 2 < 0.3 or s + span / 2 > sg.len - 0.3 then raise exception 'ホームが線路からはみ出します（線路のはしから離すか、ホームを短くしてください）'; end if;
    sub := _mp_sub(sg.pts, s - span / 2, s + span / 2);   -- ホームの線（先に1回だけ）
    if _mp_minr(sub) < 8 then raise exception 'ホームはカーブのゆるいところ（半径400m以上）に作ります'; end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + span) / 2 + 1)
       or exists (select 1 from mp_depots t where t.seg = p_seg and abs(t.at - s) < (span + (_mp_dep_dim(t.kind, t.size))[1]) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
    tiles := _mp_tiles(sub);
    pcs := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_line_cells(sub, greatest(0.5, (0.22 * p_tracks + 0.18) * 2.5)::real) z,
                    lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
    if _mp_bld_hit(pcs) is not null then raise exception 'ホームが建物のある土地にかかります'; end if;
    -- ホームが他人の筆にかかるところ（線路の区画はのぞく）は、貸出料があるか申請が許可されているときだけ。使用料もかかる
    oc := _mp_seg_cells_arr(_mp_sub(sg.pts, greatest(0, s - span / 2 - 1), least(sg.len, s + span / 2 + 1)), 'rail', sg.w, sg.dbl);   -- ホームの前後 50m までの線路
    need := _mp_land_need(pcs, pa.pu, pa.pc, false, oc);
    with c as (select distinct pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i),
         o as materialized (select distinct oc[2 * i - 1] x, oc[2 * i] y from generate_series(1, coalesce(array_length(oc, 1), 0) / 2) i)
    select coalesce(sum(coalesce(_mp_land_fee(p.id, pa.pu, pa.pc), _mp_land_std(p.id))), 0) into lfee
      from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y join mp_parcels p on p.id = pcl.parcel
     where not exists (select 1 from o where o.x = c.x and o.y = c.y) and (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false);
    select * into pt from _mp_at(sg.pts, s);
    cost := (_mp_rate('sta_base') + p_tracks * p_plat * _mp_rate('sta_m')) * (1 + _mp_rate('urb_sta') * _mp_dens(pt.x, pt.y));
  elsif p_kind = 'bus' then
    if sg.kind <> 'road' then raise exception 'バス停は道路の上に作ります'; end if;
    if exists (select 1 from mp_stations t where t.seg = p_seg and t.kind = 'bus' and abs(t.at - s) < 3) then raise exception '近くにほかのバス停があります'; end if;
    span := 0.4; p_plat := 0; p_tracks := 1;
    select * into pt from _mp_at(sg.pts, s);
    tiles := array[floor(pt.x)::int, floor(pt.y)::int];
    cost := _mp_rate('stop');
  else raise exception '作るものがちがいます'; end if;
  if p_dry then return jsonb_build_object('cost', round(cost), 'up_day', case when p_kind = 'rail' then round(_mp_rate('up_sta') * (1 + 0.25 * (p_tracks - 1))) else _mp_rate('up_stop') end,
    'lease', round(lfee), 'need', need); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, false, round(cost)::bigint, 'sta', format('%s「%s」の工事', case when p_kind = 'rail' then '駅' else 'バス停' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_stations(kind, seg, at, x, y, ang, plat, tracks, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, round(pt.x * 100), round(pt.y * 100), pt.ang, p_plat, p_tracks, nm, pa.pu, pa.pc, round(cost))
  returning id into sid;
  perform _mp_occ_set(sid, case when p_kind = 'rail' then 'sta' else 'stop' end, tiles);
  if p_kind = 'rail' then perform _mp_lease_set('sta', sid, pa.pu, pa.pc, false); end if;
  perform _mp_chg('sta', sid, 'set', box(point(pt.x - 3, pt.y - 3), point(pt.x + 3, pt.y + 3)));
  return jsonb_build_object('id', sid, 'cost', round(cost));
end $$;
create or replace function public.mp_dep_build(p_kind text, p_seg bigint, p_x real, p_y real, p_side int, p_size text, p_name text, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; sg mp_segs; q record; s real; lt real; wt real; gap real := 0.9; dim real[]; cap int; cost numeric; tiles int[]; ters text[]; bad text; lq record; did bigint; pt record; dcells int[];
        nm text := left(trim(coalesce(p_name, '')), 20); side int := case when p_side < 0 then -1 else 1 end; need jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '車庫は人か会社で作ります'; end if;
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  select * into sg from mp_segs where id = p_seg;
  if not found then raise exception '線が見つかりません'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y); s := q.s;
  if q.dist > 1.2 then raise exception '線の上をえらんでください'; end if;
  if p_kind = 'rail' and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if p_kind = 'rail' and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then   -- 鉄道の免許（t108）
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  if nm = '' then raise exception '名前をつけてください'; end if;
  if p_kind = 'rail' then
    if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, false) then raise exception '車両基地は自分（この名義）の線路の横に作ります'; end if;
    if coalesce(p_size, '') like 'T%' then   -- 線路をなぞった大きさ（長さ20m単位・留置線の数）
      if p_size !~ '^T[0-9]{2,4}x[0-9]{1,2}$' then raise exception '車両基地の大きさが読めません'; end if;
      if split_part(substr(p_size, 2), 'x', 1)::int not between 40 and 1000 or split_part(substr(p_size, 2), 'x', 1)::int % 20 <> 0 then raise exception '車両基地の長さは20m単位で、40〜1000mです'; end if;
      if split_part(p_size, 'x', 2)::int not between 1 and 20 then raise exception '留置線は1〜20本です'; end if;
      dim := _mp_dep_dim('rail', p_size); lt := dim[1]; wt := dim[2]; gap := dim[3]; cap := dim[4]::int;
      cost := _mp_rate('dep_base') + cap * _mp_rate('dep_car');
    else
      lt := case p_size when 'L' then 10 when 'M' then 7 else 5 end; wt := case p_size when 'L' then 4 when 'M' then 3 else 2 end;
      cap := case p_size when 'L' then 120 when 'M' then 48 else 16 end;
      cost := _mp_rate('dep_' || case when p_size in ('S', 'M', 'L') then p_size else 'S' end);
    end if;
  elsif p_kind = 'bus' then
    if sg.kind <> 'road' then raise exception 'バスの営業所は道路の横に作ります'; end if;
    lt := case p_size when 'M' then 5 else 3 end; wt := case p_size when 'M' then 3 else 2 end;
    cap := case p_size when 'M' then 60 else 20 end;
    cost := _mp_rate('bdep_' || case when p_size = 'M' then 'M' else 'S' end);
  else raise exception '作るものがちがいます'; end if;
  if s - lt / 2 < 0.2 or s + lt / 2 > sg.len - 0.2 then raise exception '線のはしからはみ出します'; end if;
  if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + lt) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
  tiles := _mp_dep_tiles_g(sg.pts, s, side, lt, wt, gap);
  ters := _mp_ters(tiles);
  if '?' = any(ters) or 'D' = any(ters) or 'S' = any(ters) or 'R' = any(ters) or 'L' = any(ters) then raise exception '水の上や地図のないところには作れません'; end if;
  select string_agg(distinct o.x || ',' || o.y, ' ') into bad from mp_occ o
    join (select tiles[2 * i - 1] x, tiles[2 * i] y from generate_series(1, array_length(tiles, 1) / 2) i) t on t.x = o.x and t.y = o.y
   where not (o.what = sg.kind and o.ref = p_seg);
  if bad is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', left(bad, 60); end if;
  select * into pt from _mp_at(sg.pts, s);
  dcells := (select coalesce(array_agg(u.v order by z.y, z.x, u.o), '{}') from _mp_dep_cells(pt.x, pt.y, pt.ang, side, p_kind, coalesce(p_size, 'S')) z, lateral unnest(array[z.x, z.y]) with ordinality u(v, o));
  if _mp_bld_hit(dcells) is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', _mp_bld_hit(dcells); end if;
  select * into lq from _mp_lease_quote(dcells, pa.pu, pa.pc, false);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(dcells, pa.pu, pa.pc, false);
  if p_dry then return jsonb_build_object('cost', round(cost), 'lease', round(lq.fee), 'cap', cap, 'tiles', array_length(tiles, 1) / 2,
    'up_day', round(_mp_rate(case when p_kind = 'rail' then 'up_dep' else 'up_bdep' end) * case when coalesce(p_size, '') like 'T%' then greatest(1, cap / 24.0) when p_size = 'L' then 5 when p_size = 'M' then 2.5 else 1 end), 'need', need); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, false, round(cost)::bigint, 'dep', format('%s「%s」の工事', case when p_kind = 'rail' then '車両基地' else '営業所' end, nm));
  select * into pt from _mp_at(sg.pts, s);
  insert into mp_depots(kind, seg, at, side, size, x, y, ang, cap, name, own_u, own_c, cost)
  values (p_kind, p_seg, s, side, coalesce(p_size, 'S'), round(pt.x * 100), round(pt.y * 100), pt.ang, cap, nm, pa.pu, pa.pc, round(cost))
  returning id into did;
  perform _mp_occ_set(did, 'dep', tiles);
  perform _mp_lease_set('dep', did, pa.pu, pa.pc, false);
  perform _mp_chg('dep', did, 'set', box(point(pt.x - greatest(8, lt / 2 + gap + wt + 1), pt.y - greatest(8, lt / 2 + gap + wt + 1)),
                                         point(pt.x + greatest(8, lt / 2 + gap + wt + 1), pt.y + greatest(8, lt / 2 + gap + wt + 1))));
  return jsonb_build_object('id', did, 'cost', round(cost), 'cap', cap);
end $$;
create or replace function public.admin_staff() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me();
begin
  if not _is_admin(u) then raise exception '管理者だけが使えます'; end if;
  return jsonb_build_object('sub', _staff_list('subadmins'), 'event', _staff_list('eventmakers'), 'lic', _staff_list('licreviewers'), 'lic', _staff_list('licreviewers'));
end $$;
create or replace function public.admin_staff_set(p_kind text, p_ids text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); k text; ids text[]; a text; old text[]; pid uuid; nm text; lbl text;
begin
  if not _is_admin(u) then raise exception '管理者だけが使えます'; end if;
  k := case p_kind when 'sub' then 'subadmins' when 'event' then 'eventmakers' when 'lic' then 'licreviewers' end;
  if k is null then raise exception '役割をえらんでください'; end if;
  lbl := case p_kind when 'sub' then '副管理者' when 'lic' then '鉄道の審査' else 'イベント製作者' end;
  select coalesce(array_agg(distinct z) filter (where z <> ''), '{}') into ids
    from unnest(regexp_split_to_array(coalesce(p_ids, ''), '[\s,、，]+')) z;
  if array_length(ids, 1) > 20 then raise exception '%は20人までです', lbl; end if;
  foreach a in array ids loop
    select id, nickname into pid, nm from profiles where account_no = a and ai is null;
    if not found then raise exception 'ID %の人が見つかりません', a; end if;
    if _is_guest(pid) then raise exception '%さんはゲストなので、%にできません', nm, lbl; end if;
    if _is_admin(pid) then raise exception '%さんは管理者です', nm; end if;
  end loop;
  old := string_to_array(replace(coalesce((select value from app_settings where key = k), ''), ' ', ''), ',');
  insert into app_settings(key, value) values (k, array_to_string(ids, ',')) on conflict (key) do update set value = excluded.value;
  -- なった人・はずれた人に知らせる
  for pid in select p.id from profiles p where p.account_no = any(ids) and not (p.account_no = any(coalesce(old, '{}'))) loop
    perform _notice(pid, case p_kind when 'sub' then '【お知らせ】副管理者になりました。設定 → 管理 から、企業や上場の審査・訴えの審理などができます。'
                              when 'lic' then '【お知らせ】鉄道の審査をする役になりました。国土 → ≡ →「🚃 鉄道の免許」→「審査」から、鉄道の免許の申請を審査できます。'
                              when 'lic' then '【お知らせ】鉄道の審査をする役になりました。国土 → ≡ →「🚃 鉄道の免許」→「審査」から、鉄道の免許の申請を審査できます。'
                              else '【お知らせ】イベント製作者になりました。設定 → 管理 から、臨時のレースとお知らせバナーをつくれます。' end);
  end loop;
  for pid in select p.id from profiles p where p.account_no = any(coalesce(old, '{}')) and not (p.account_no = any(ids)) loop
    perform _notice(pid, format('【お知らせ】%sからはずれました。', lbl));
  end loop;
  return admin_staff();
end $$;
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '20s';
alter function public.mp_seg_edit(bigint, int[], int[], boolean) set statement_timeout = '20s';
revoke all on function public.mp_lic_find(text) from public, anon;
grant execute on function public.mp_lic_find(text) to authenticated;
revoke all on function public.mp_lic_at(int, int) from public, anon;
grant execute on function public.mp_lic_at(int, int) to authenticated;
revoke all on function public.mp_lic_apply(text[], text, int[], text) from public, anon;
grant execute on function public.mp_lic_apply(text[], text, int[], text) to authenticated;
revoke all on function public.mp_lic_mine(text) from public, anon;
grant execute on function public.mp_lic_mine(text) to authenticated;
revoke all on function public.mp_lic_cancel(bigint, text) from public, anon;
grant execute on function public.mp_lic_cancel(bigint, text) to authenticated;
revoke all on function public.mp_lic_review() from public, anon;
grant execute on function public.mp_lic_review() to authenticated;
revoke all on function public.mp_lic_decide(bigint, boolean, text) from public, anon;
grant execute on function public.mp_lic_decide(bigint, boolean, text) to authenticated;
revoke all on function public._mp_lic_rev(uuid) from public, anon, authenticated;
revoke all on function public._mp_lic_areas(uuid, int) from public, anon, authenticated;
revoke all on function public._mp_lic_need(uuid, int, int[]) from public, anon, authenticated;
revoke all on function public._mp_lic_names(text[]) from public, anon, authenticated;
revoke all on function public._mp_lic_json(mp_lic) from public, anon, authenticated;
