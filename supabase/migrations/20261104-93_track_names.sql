-- 競馬場の名前を、実在の競馬場と同じにしない：おいた場所の地名から（まん中の市区町村の名前＋競馬場。実在の競馬場の地名になるときは県の名前、それもだめなら「風の芽」。
--   ほかの会場の競馬場と同じ名前なら「第二」）。管理者は名前を変えられる（国土の管理 → 競馬場 →「名前」。空にすると地名から）。もうおいてある競馬場の名前も、地名からの名前にする

alter table public.mp_tracks add column if not exists nm text;   -- 管理者がつけた名前（null なら、おいた場所の地名から。DB の更新93）

-- 実在の競馬場（いまのもの・むかしのもの・トレーニングセンター・よび名）の地名か（DB の更新93）。競馬場の名前に使わない
create or replace function public._mp_track_ng(b text) returns boolean
language sql immutable as $$
  select b is null or btrim(b) = '' or btrim(b) = any(array['札幌','函館','福島','新潟','中山','東京','中京','京都','阪神','小倉',
    '門別','帯広','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀',
    '旭川','岩見沢','北見','上山','三条','宇都宮','足利','高崎','紀三井寺','春木','益田','福山','中津','荒尾','長居','鳴尾',
    '府中','淀','仁川','美浦','栗東','宮崎','中央','地方','東海','九州','北海道','ばんえい'])
$$;
-- 競馬場の名前（おいた場所の地名から：まん中の市区町村の名前＋競馬場。実在の競馬場の地名になるときは県の名前、それもだめなら「風の芽」。
--   ほかの会場の競馬場と同じ名前になるときは「第二」「第三」）
create or replace function public._mp_track_autoname(p_k text, p_x int, p_y int) returns text
language plpgsql stable set search_path = public as $$
declare c record; ar mp_places; mu mp_places; pr mp_places; b text; vn text; i int;
begin
  select * into c from _mp_cell(_mp_t5(p_x), _mp_t5(p_y));
  select * into ar from mp_places where id = c.a;
  if ar.k = 'ward' then select * into mu from mp_places where id = ar.parent; else mu := ar; end if;
  select * into pr from mp_places where id = mu.parent;
  b := mu.name;
  if _mp_track_ng(b) then b := pr.name; end if;
  if _mp_track_ng(b) then b := '風の芽'; end if;
  for i in 1..3 loop
    vn := b || (array['', '第二', '第三'])[i] || '競馬場';
    exit when not exists (select 1 from mp_tracks t join mp_blds x on x.id = t.bld where t.k <> p_k and x.name = vn);
  end loop;
  return vn;
end $$;

create or replace function public.mp_track_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  perform _mp_ok(u);
  return (select jsonb_agg(jsonb_build_object('k', v.k, 'bld', t.bld, 'dir', coalesce(t.dir, 'h'), 'wh', to_jsonb(_mp_track_wh(v.k, 'h')),
            'rect', case when t.bld is not null then jsonb_build_array(t.x0, t.y0, t.x1, t.y1) end,
            'x', case when t.bld is not null then t.x0 + (t.x1 - t.x0 + 1) / 2 end, 'y', case when t.bld is not null then t.y0 + (t.y1 - t.y0 + 1) / 2 end,
            'addr', case when t.bld is not null then _mp_addr(_mp_t5(t.x0 + (t.x1 - t.x0 + 1) / 2), _mp_t5(t.y0 + (t.y1 - t.y0 + 1) / 2), t.x0 + (t.x1 - t.x0 + 1) / 2, t.y0 + (t.y1 - t.y0 + 1) / 2) ->> 'text' end,
            'name', (select b.name from mp_blds b where b.id = t.bld), 'nm', t.nm, 'auto', t.nm is null)   -- 名前（DB の更新93）。nm：管理者がつけた名前
            order by v.o)
    from (values ('府中', 1), ('京都', 2), ('中京', 3)) v(k, o) left join mp_tracks t on t.k = v.k and t.bld is not null);
end $$;
drop function if exists public.mp_track_place(text, int, int, text, boolean);   -- 名前（p_name）を足した（DB の更新93）
create or replace function public.mp_track_place(p_k text, p_x int, p_y int, p_dir text, p_dry boolean default true, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); dr text := coalesce(p_dir, 'h'); wh int[]; x0 int; y0 int; x1 int; y1 int; ck jsonb; old mp_tracks; opid bigint; pid bigint; bid bigint; chk text; n int; cs int[];
        cnm text := nullif(btrim(coalesce(p_name, '')), ''); bnm text;
begin
  perform _mp_admin(u);
  if p_k is null or p_k not in ('府中', '京都', '中京') then raise exception '競馬の会場は 府中・京都・中京 の3つです'; end if;
  if dr not in ('h', 'v') then raise exception '向きは 横（h）か 縦（v）です'; end if;
  if p_x is null or p_y is null then raise exception '場所がありません'; end if;
  if char_length(cnm) > 30 then raise exception '名前は30文字までです'; end if;
  wh := _mp_track_wh(p_k, dr);
  x0 := p_x - wh[1] / 2; y0 := p_y - wh[2] / 2; x1 := x0 + wh[1] - 1; y1 := y0 + wh[2] - 1;
  select * into old from mp_tracks where k = p_k and bld is not null;
  cnm := coalesce(cnm, old.nm);   -- 管理者が名前をつけていれば、場所を変えても そのまま（DB の更新93）
  ck := _mp_track_check(x0, y0, x1, y1, old.bld)
        || jsonb_build_object('rect', jsonb_build_array(x0, y0, x1, y1), 'dir', dr, 'moved', old.bld is not null,
                              'addr', _mp_addr(_mp_t5(p_x), _mp_t5(p_y), p_x, p_y) ->> 'text',
                              'name', coalesce(cnm, _mp_track_autoname(p_k, p_x, p_y)), 'auto', cnm is null);
  if p_dry then return ck; end if;
  if not (ck ->> 'ok')::boolean then raise exception 'ここには おけません（%）', _mp_track_why(ck); end if;
  -- いまの競馬場（場所を変えるとき）：筆ごととりのぞく（建物・競馬場の行も消える）
  if old.bld is not null then
    opid := (select b.parcel from mp_blds b where b.id = old.bld);
    delete from mp_parcels where id = opid;
    perform _mp_chg('land', null, 'set', box(point(_mp_t5(old.x0), _mp_t5(old.y0)), point(_mp_t5(old.x1) + 1, _mp_t5(old.y1) + 1)));
  end if;
  -- 町字：区画のいちばん多い町字
  select z.cho_k into chk from (select _mp_cho_at(gx, gy) cho_k, sum((least(x1, gx * 5 + 4) - greatest(x0, gx * 5) + 1) * (least(y1, gy * 5 + 4) - greatest(y0, gy * 5) + 1)) nc
                                  from generate_series(_mp_t5(x0), _mp_t5(x1)) gx, generate_series(_mp_t5(y0), _mp_t5(y1)) gy group by 1) z
   where z.cho_k is not null order by z.nc desc, z.cho_k limit 1;
  if chk is null then raise exception '町字がわかりません'; end if;
  perform 1 from mp_cho where id = chk for update;   -- 地番をとる（同じ町字の同時の買いものを順番に）
  n := wh[1] * wh[2];
  insert into mp_parcels(own_u, own_c, gov, cho, ban, eda, n, bb, price, val, mval)
    values (null, null, true, chk, coalesce((select max(p.ban) from mp_parcels p where p.cho = chk), 0) + 1, 0, n, box(point(x0, y0), point(x1 + 1, y1 + 1)), 0, 0, 0)
    returning id into pid;
  insert into mp_pcells(x, y, parcel) select gx, gy, pid from generate_series(x0, x1) gx, generate_series(y0, y1) gy;
  perform _mp_parcel_vals(array[pid]);
  cs := array(select q.v from generate_series(y0, y1) gy, generate_series(x0, x1) gx, lateral unnest(array[gx, gy]) with ordinality q(v, o) order by gy, gx, q.o);
  bnm := coalesce(cnm, _mp_track_autoname(p_k, p_x, p_y));   -- 名前：管理者がつけた名前か、おいた場所の地名から（実在の競馬場の名前にしない。DB の更新93）
  bid := _mp_bld_make(pid, jsonb_build_object('kind', 'keiba', 'shape', 'full', 'floors', 0, 'cells', to_jsonb(cs), 'fm2', n * 100, 'plan', '[]'::jsonb), '', bnm, 0, false);
  insert into mp_tracks(k, bld, x0, y0, x1, y1, dir, nm, at) values (p_k, bid, x0, y0, x1, y1, dr, cnm, now())
    on conflict (k) do update set bld = excluded.bld, x0 = excluded.x0, y0 = excluded.y0, x1 = excluded.x1, y1 = excluded.y1, dir = excluded.dir, nm = excluded.nm, at = excluded.at;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(x0), _mp_t5(y0)), point(_mp_t5(x1) + 1, _mp_t5(y1) + 1)));
  return ck || jsonb_build_object('id', bid, 'name', bnm);
end $$;
-- 競馬場の名前を変える（管理者。DB の更新93）：30文字まで。空にすると、おいた場所の地名から
create or replace function public.mp_track_rename(p_k text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); t mp_tracks; vnm text := nullif(btrim(coalesce(p_name, '')), ''); bnm text;
begin
  perform _mp_admin(u);
  select * into t from mp_tracks where k = p_k;
  if not found or t.bld is null then raise exception 'この競馬場は、まだ地図においていません'; end if;
  if char_length(vnm) > 30 then raise exception '名前は30文字までです'; end if;
  update mp_tracks set nm = vnm where k = p_k;
  bnm := coalesce(vnm, _mp_track_autoname(p_k, t.x0 + (t.x1 - t.x0 + 1) / 2, t.y0 + (t.y1 - t.y0 + 1) / 2));
  update mp_blds set name = bnm where id = t.bld;
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(t.x0), _mp_t5(t.y0)), point(_mp_t5(t.x1) + 1, _mp_t5(t.y1) + 1)));
  return jsonb_build_object('k', p_k, 'name', bnm, 'auto', vnm is null);
end $$;

-- もうおいてある競馬場（DB の更新92 で「会場の名前＋競馬場」にしたもの）を、地名からの名前にする
do $$
declare t record;
begin
  for t in select * from mp_tracks where bld is not null and nm is null order by k loop
    update mp_blds set name = _mp_track_autoname(t.k, t.x0 + (t.x1 - t.x0 + 1) / 2, t.y0 + (t.y1 - t.y0 + 1) / 2) where id = t.bld;
    perform _mp_chg('land', null, 'set', box(point(_mp_t5(t.x0), _mp_t5(t.y0)), point(_mp_t5(t.x1) + 1, _mp_t5(t.y1) + 1)));
  end loop;
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人（管理の関数は中で管理者かをしらべる）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_track_ng', '_mp_track_autoname', 'mp_track_list', 'mp_track_place', 'mp_track_rename') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 競馬場をおく（DB の更新92・93）は、広い土地をしらべるので60秒まで
alter function public.mp_track_place(text, int, int, text, boolean, text) set statement_timeout = '60s';
