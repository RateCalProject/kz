-- 建物をさがす（情報タブ：30件ずつ・上限なし）・お気に入り物件（1人10件まで）：
--   mp_bld_find：名前か種類（病院・ホテル・マンション など）に ことばをふくむ建物を、30件ずつ（p_off から）。名前が同じ・前があう・国の建物・高い建物の順
--   mp_bld_fav：お気に入りに入れる・はずす。mp_bld_favs：お気に入りの一覧（住所・種類・階・持ち主・売り出し・テナント募集）
--   名前のない建物（家など）は出さない。人の名前・自宅ではさがせない（地図の「さがす」と同じ）

create table if not exists public.mp_bld_fav (       -- お気に入り物件
  u   uuid not null references public.profiles(id) on delete cascade,
  bld bigint not null references public.mp_blds(id) on delete cascade,
  at  timestamptz not null default now(),
  primary key (u, bld)
);
alter table public.mp_bld_fav enable row level security;
revoke all on public.mp_bld_fav from public, anon, authenticated;

-- 建物1つの見出し（一覧・お気に入り）。pr はプリセット（_mp_bld_pmap）
create or replace function public._mp_bld_card(b mp_blds, pr jsonb, fav boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', b.id, 'n', b.name, 'k', b.kind, 'kn', coalesce(pr -> b.kind ->> 'n', b.kind), 'cat', pr -> b.kind ->> 'cat',
    'fl', b.floors, 'cx', b.cells[1], 'cy', b.cells[2],
    'addr', coalesce(_mp_addr(_mp_t5(b.cells[1]), _mp_t5(b.cells[2]), b.cells[1], b.cells[2]) ->> 'text', ''),
    'own', case when p.gov then '国' else nullif(_mp_pname(p.own_u, p.own_c, false), '') end,
    'sale', p.sale,
    'ten', (select count(*) from mp_units x where x.bld = b.id and x.mode = 'corp' and x.t_kind is null),
    'ask', (select min(x.ask) from mp_units x where x.bld = b.id and x.mode = 'corp' and x.t_kind is null),
    'fav', fav)
    from mp_parcels p where p.id = b.parcel
$$;

-- 建物をさがす：30件ずつ。n はぜんぶの数、more は つづきがあるか
create or replace function public.mp_bld_find(p_q text, p_off int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _me_g(); q text := _mp_qnorm(p_q); off int := greatest(0, coalesce(p_off, 0)); pr jsonb := _mp_bld_pmap(); ks text[]; n int; out jsonb;
begin
  perform _mp_ok(me);
  if char_length(coalesce(q, '')) < 1 then return jsonb_build_object('n', 0, 'list', '[]'::jsonb, 'more', false); end if;
  ks := array(select e.k from jsonb_each(pr) e(k, v) where e.v ->> 'n' like '%' || q || '%');   -- 種類の名前（病院・ホテル…）
  select count(*) into n from mp_blds b where b.name <> '' and (b.name like '%' || q || '%' or b.kind = any(ks));
  select coalesce(jsonb_agg(_mp_bld_card(b, pr, exists (select 1 from mp_bld_fav f where f.u = me and f.bld = b.id)) order by z.o), '[]'::jsonb) into out
    from (select b.id, row_number() over (order by (b.name = q) desc, (b.name like q || '%') desc, (b.name like '%' || q || '%') desc, p.gov desc, b.floors desc, b.id) o
            from mp_blds b join mp_parcels p on p.id = b.parcel
           where b.name <> '' and (b.name like '%' || q || '%' or b.kind = any(ks))
           order by (b.name = q) desc, (b.name like q || '%') desc, (b.name like '%' || q || '%') desc, p.gov desc, b.floors desc, b.id
           offset off limit 30) z join mp_blds b on b.id = z.id;
  return jsonb_build_object('n', n, 'list', out, 'more', off + 30 < n);
end $$;

-- お気に入り物件に入れる（p_on）・はずす。1人10件まで
create or replace function public.mp_bld_fav(p_bld bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _me();
begin
  perform _mp_ok(me);
  if not exists (select 1 from mp_blds where id = p_bld) then raise exception '建物が見つかりません'; end if;
  perform pg_advisory_xact_lock(hashtext('mp_bld_fav:' || me::text));
  if coalesce(p_on, true) then
    if not exists (select 1 from mp_bld_fav f where f.u = me and f.bld = p_bld) then
      if (select count(*) from mp_bld_fav f where f.u = me) >= 10 then raise exception 'お気に入り物件は10件までです（どれかを はずしてから入れてください）'; end if;
      insert into mp_bld_fav(u, bld) values (me, p_bld);
    end if;
  else
    delete from mp_bld_fav f where f.u = me and f.bld = p_bld;
  end if;
  return jsonb_build_object('on', coalesce(p_on, true), 'ids', (select coalesce(jsonb_agg(f.bld order by f.at), '[]'::jsonb) from mp_bld_fav f where f.u = me));
end $$;

-- お気に入り物件の一覧（入れた順）
create or replace function public.mp_bld_favs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _me_g(); pr jsonb := _mp_bld_pmap();
begin
  perform _mp_ok(me);
  return (select coalesce(jsonb_agg(_mp_bld_card(b, pr, true) order by f.at), '[]'::jsonb) from mp_bld_fav f join mp_blds b on b.id = f.bld where f.u = me);
end $$;

revoke all on function public._mp_bld_card(mp_blds, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.mp_bld_find(text, int) from public, anon;
grant execute on function public.mp_bld_find(text, int) to authenticated;
revoke all on function public.mp_bld_fav(bigint, boolean) from public, anon;
grant execute on function public.mp_bld_fav(bigint, boolean) to authenticated;
revoke all on function public.mp_bld_favs() from public, anon;
grant execute on function public.mp_bld_favs() to authenticated;
