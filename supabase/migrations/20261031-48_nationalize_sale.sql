-- 国有化販売：あなたと あなたの会社の建物のうち、自分で建てていないもの（町づくりで置いたもの）を国のものにして、時価で売りに出す。売れたお金は国庫へ
--   のこす（持ち主もそのまま）：国や市の建物（府県庁・市役所・交番・消防署・空港・軍など）・学校・病院・発電所・変電所・ごみ処理場・浄水場など
--   国の土地（筆）も、売りに出ていればふつうに買えるようにする。国が売る値段は、毎時、時価（毎朝見なおす地価）にあわせる
--   管理者が「国」として売り出しの値段を変える・やめることもできる（そのときは時価にあわせるのをやめる）

create table if not exists public.mp_gov_sale (
  parcel bigint primary key references public.mp_parcels(id) on delete cascade,
  at     timestamptz not null default now()
);
alter table public.mp_gov_sale enable row level security;
revoke all on public.mp_gov_sale from anon, authenticated;

-- 国が売る筆の値段を、時価にあわせる
create or replace function public._mp_gov_sale_sync() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  update mp_parcels p set sale = greatest(100, coalesce(p.mval, p.val, 0))
    from mp_gov_sale g
   where g.parcel = p.id and p.gov and p.sale is not null and p.sale <> greatest(100, coalesce(p.mval, p.val, 0));
  get diagnostics n = row_count;
  delete from mp_gov_sale g where not exists (select 1 from mp_parcels p where p.id = g.parcel and p.gov and p.sale is not null);
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-gov-sale', '41 * * * *', 'select public._mp_gov_sale_sync()');
  end if;
end $$;

-- 売りに出ている筆を買う（＋取得税：値段と評価額の小さいほうの3%）。国の筆も、売りに出ていれば買える（お金は国庫へ。t63）
create or replace function public.mp_parcel_buy(p_id bigint, p_as text, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; p mp_parcels; tax bigint; addr text;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if pa.gv then raise exception '国は土地を買いません'; end if;
  select * into p from mp_parcels where id = p_id for update;
  if not found then raise exception '土地（筆）が見つかりません'; end if;
  if p.sale is null then raise exception '売りに出ていません'; end if;
  if _mp_same(p.own_u, p.own_c, false, pa.pu, pa.pc, false) then raise exception '自分の土地です'; end if;
  tax := ceil(least(p.sale, greatest(p.val, 0)) * 0.03);
  if p_dry then return jsonb_build_object('price', p.sale, 'tax', tax, 'total', p.sale + tax, 'n', p.n); end if;
  addr := (select _mp_addr(_mp_t5((p.bb[1])[0]::int), _mp_t5((p.bb[1])[1]::int), null, null) ->> 'text') || ' ' || _mp_ban(p.ban, p.eda);
  perform _mp_pay(pa.pu, pa.pc, false, p.sale + tax, 'land', format('土地 %s（%s㎡）を買った（取得税 %s X をふくむ）', _mp_ban(p.ban, p.eda), p.n * 100, tax));
  perform _mp_earn(p.own_u, p.own_c, p.gov, p.sale, 'land', format('土地 %s（%s㎡）が売れた', _mp_ban(p.ban, p.eda), p.n * 100));   -- 国の筆なら国庫に入ったまま
  if not p.gov then perform _notice(coalesce(p.own_u, (select owner from companies where id = p.own_c)), format('【国土】売りに出していた土地（%s）が %s X で売れました。', addr, _fmt(p.sale))); end if;
  -- 貸出料と申請は、新しい持ち主が決めなおす（作ってあるものの使用料はそのまま、新しい持ち主へ）
  perform _notice(w, format('【国土】土地を使う申請（%s）は、持ち主が変わったのでなくなりました。新しい持ち主に申請してください。', addr))
     from (select distinct coalesce(q.req_u, (select owner from companies where id = q.req_c)) w from mp_landreq q where q.parcel = p.id and q.st = 'wait') z where w is not null and w <> u;
  delete from mp_landreq where parcel = p.id;
  update mp_parcels set own_u = pa.pu, own_c = pa.pc, gov = false, price = p.sale, sale = null, rent = null, bought_at = now() where id = p.id;
  delete from mp_gov_sale where parcel = p.id;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5((p.bb[1])[0]::int), _mp_t5((p.bb[1])[1]::int)), point(_mp_t5((p.bb[0])[0]::int) + 1, _mp_t5((p.bb[0])[1]::int) + 1)));
  return jsonb_build_object('price', p.sale, 'tax', tax, 'total', p.sale + tax, 'n', p.n);
end $$;
-- 売りに出す（p_price が null なら売るのをやめる）。管理者が「国」として、国の筆も（t63。国が値段を決めたら、時価にあわせるのをやめる）
create or replace function public.mp_parcel_sell(p_ids bigint[], p_price bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; n int := 0; p mp_parcels;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_price is not null and (p_price < 100 or p_price > 10000000000000000) then raise exception '値段は100 X 〜 1京 X にしてください'; end if;
  for p in select * from mp_parcels where id = any(p_ids)
             and case when pa.gv then gov else own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and not gov end for update loop
    update mp_parcels set sale = p_price where id = p.id;
    if pa.gv then delete from mp_gov_sale where parcel = p.id; end if;
    n := n + 1;
    perform _mp_chg('land', null, 'set', box(point(_mp_t5((p.bb[1])[0]::int), _mp_t5((p.bb[1])[1]::int)), point(_mp_t5((p.bb[0])[0]::int) + 1, _mp_t5((p.bb[0])[1]::int) + 1)));
  end loop;
  if n = 0 then raise exception 'あなた（この名義）の土地がありません'; end if;
  return jsonb_build_object('n', n);
end $$;

-- =====================================================================
-- いちどだけ：管理者の建物の国有化販売
--   あなた（風の芽製作所の持ち主）と、あなたの会社（国営でない・AI でない）の建物のうち、建てた費用が 0 のもの（町づくりなどで置いたもの＝自分で建てていないもの）
--   のこす（持ち主もそのまま）：国や市の建物（プリセットの gov）・学校・病院・発電所・変電所・ごみ処理場・浄水場など
--   国の筆にして、時価で売りに出す（mp_gov_sale）。自分で使っていた部屋は、入居募集にもどす。土地を使う申請は消す
-- =====================================================================
do $$
declare me uuid; cos int[]; ids bigint[]; nk int; nb int;
begin
  select owner into me from companies where name in ('風の芽製作所', '株式会社風の芽製作所') and status = 'active' order by id limit 1;
  if me is null and (select count(*) from profiles where _role(id) = 'admin' and ai is null) = 1 then
    select id into me from profiles where _role(id) = 'admin' and ai is null;
  end if;
  if me is null then raise warning '国有化販売：管理者が見つからないので、何もしませんでした'; return; end if;
  cos := array(select id from companies where owner = me and status = 'active' and not coalesce(official, false) and not coalesce(ai, false));
  create temp table _nat_keep on commit drop as
    select b ->> 'k' k from jsonb_array_elements(_mp_bld_presets()) b
     where coalesce((b ->> 'gov')::boolean, false) or b ->> 'cat' in ('school', 'med') or coalesce(b ->> 'n', '') ~ '発電所|変電所|処理場|浄水場|清掃工場|焼却';
  ids := array(select pa.id from mp_parcels pa join mp_blds bl on bl.parcel = pa.id
                where not pa.gov and (pa.own_u = me or pa.own_c = any(cos)) and bl.cost = 0
                  and not exists (select 1 from _nat_keep k where k.k = bl.kind));
  select count(*) into nk from mp_parcels pa join mp_blds bl on bl.parcel = pa.id
   where not pa.gov and (pa.own_u = me or pa.own_c = any(cos)) and bl.cost = 0 and exists (select 1 from _nat_keep k where k.k = bl.kind);
  if coalesce(array_length(ids, 1), 0) = 0 then raise warning '国有化販売：あてはまる建物はありませんでした（のこした建物 % 棟）', nk; return; end if;
  perform _mp_parcel_vals(ids);   -- 地価を いまの値に
  delete from mp_landreq where parcel = any(ids);
  update mp_units u set mode = 'npc', ask = null from mp_blds bl where bl.id = u.bld and bl.parcel = any(ids) and u.mode = 'self';
  update mp_parcels set own_u = null, own_c = null, gov = true, sale = greatest(100, coalesce(mval, val, 0)), rent = null where id = any(ids);
  insert into mp_gov_sale(parcel) select unnest(ids) on conflict do nothing;
  nb := array_length(ids, 1);
  perform _mp_chg('land', null, 'set', null);   -- 地図を読みなおす
  perform _notice(me, format('【国土】国有化販売：あなたと、あなたの会社の建物のうち、自分で建てていない %s 棟を国のものにして、時価で売りに出しました（国や市の建物・学校・病院・発電所などの %s 棟は、そのまま）。', _fmt(nb), _fmt(nk)));
  raise warning '国有化販売：% 棟を国のものにして、時価で売りに出しました（のこした建物 % 棟）', nb, nk;
end $$;

revoke all on function public._mp_gov_sale_sync() from public, anon, authenticated;
