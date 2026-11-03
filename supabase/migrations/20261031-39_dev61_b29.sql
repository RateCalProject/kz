-- 首都まわりの町づくり（t61）建物 29/29（3棟）：梁川 3
-- 持ち主：風の芽製作所（ふつうの建物）・国営の会社・AIの会社（町の景色）。あいていない区画（あとから筆・道路などができた）はとばす
create or replace function pg_temp.dev_build(x0 int, y0 int, x1 int, y1 int, p_kind text, p_shape text, p_floors int, p_co int, p_name text) returns bigint
language plpgsql set search_path = public as $f$
-- _mp_ai_build と同じこと（四角の区画・町の人で満室）。持ち主はふつうの会社でもよい（風の芽製作所）。
-- たくさん建てても遅くならないように、筆のある区画は四角の範囲で、地形・町字はマスごとに しらべる
declare n int := (x1 - x0 + 1) * (y1 - y0 + 1); ck text; nck int; bad int; pid bigint; p mp_parcels; q jsonb; bid bigint;
begin
  if not exists (select 1 from companies where id = p_co and status = 'active') then raise exception '会社がありません'; end if;
  select count(*) into bad from mp_pcells pc where pc.x between x0 and x1 and pc.y between y0 and y1;
  if bad > 0 then raise exception '筆のある区画が %つあります', bad; end if;
  select count(*) into bad from (select x, y from _mp_busy_cells(x0, y0, x1, y1) union select x, y from _mp_pub_cells(x0, y0, x1, y1)) z;
  if bad > 0 then raise exception '道路・線路・駅・車庫・滑走路がかかる区画が %つあります', bad; end if;
  select count(*) into bad from generate_series(_mp_t5(x0), _mp_t5(x1)) tx, generate_series(_mp_t5(y0), _mp_t5(y1)) ty, lateral _mp_cell(tx, ty) c
   where c.t is null or c.t in ('S', 'D', 'R', 'L', 'M', 'K') or c.z = 'j';
  if bad > 0 then raise exception '水・山・公園のマスが %つあります', bad; end if;
  select count(distinct c), min(c) into nck, ck from (select _mp_cho_at(tx, ty) c from generate_series(_mp_t5(x0), _mp_t5(x1)) tx, generate_series(_mp_t5(y0), _mp_t5(y1)) ty) z;
  if nck <> 1 or ck is null then raise exception '町字がちがう区画がまざっています'; end if;
  perform 1 from mp_cho where id = ck for update;
  insert into mp_parcels(own_u, own_c, gov, cho, ban, eda, n, bb, price, val, mval)
    values (null, p_co, false, ck, coalesce((select max(pp.ban) from mp_parcels pp where pp.cho = ck), 0) + 1, 0, n, box(point(x0, y0), point(x1 + 1, y1 + 1)), 0, 0, 0)
    returning id into pid;
  insert into mp_pcells(x, y, parcel) select xx, yy, pid from generate_series(x0, x1) xx, generate_series(y0, y1) yy;
  -- 評価額・地価（_mp_parcel_vals と同じ計算。この筆だけ）
  update mp_parcels pp set val = v.val, mval = v.mval from (
    select coalesce(sum(t.n * coalesce(tv.cv, 0)), 0)::bigint val, coalesce(sum(t.n * coalesce(tv.mv, 0)), 0)::bigint mval
      from (select _mp_t5(xx) tx, _mp_t5(yy) ty, count(*) n from generate_series(x0, x1) xx, generate_series(y0, y1) yy group by 1, 2) t, lateral _mp_tvals(t.tx, t.ty) tv) v
   where pp.id = pid;
  select * into p from mp_parcels where id = pid;
  q := _mp_bld_check(p, p_kind, p_shape, p_floors, '');
  bid := _mp_bld_make(pid, q, '', p_name, 0, true);
  perform _mp_chg('land', null, 'set', box(point(_mp_t5(x0), _mp_t5(y0)), point(_mp_t5(x1) + 1, _mp_t5(y1) + 1)));
  return bid;
end $f$;

do $$
declare co jsonb; kz int; r record; ok int := 0; ng int := 0; e text;
begin
  co := (select jsonb_object_agg(n.k, c.id) from (values ('af', '風の芽帝国空軍'), ('konjuu', '紺野住宅'), ('konkan', '紺野観光'), ('konsho', '紺野商事'), ('kusres', '玖珠リゾート開発'), ('kusuhama', '玖珠浜観光'), ('nanhome', '南陽ホーム'), ('nankan', '南陽観光'), ('np01', '帝都日報'), ('np02', '瑠璃新聞'), ('np03', '風の芽経済新聞'), ('np04', '東雲新報'), ('np05', '八洲スポーツ'), ('np06', '暁新聞'), ('np07', '八洲政経新聞'), ('np08', '帝国時事通信'), ('np09', 'The Kazenome Herald'), ('np10', '若芽こども新聞'), ('np11', '鉄道新報'), ('np12', '帝国産業新聞'), ('np13', '八洲農業新聞'), ('np14', '蹄音'), ('np15', '帝国軍事新報'), ('np16', '証券タイムズ'), ('np17', 'ルリポスト'), ('np18', '紺野新報'), ('np19', '藍幡民報'), ('np20', '南陽島タイムス'), ('np21', '若宮新聞'), ('np22', '玖珠日日新聞'), ('np23', '柚野新聞'), ('np24', '夕凪タイムズ'), ('nv', '風の芽帝国海軍'), ('rinkai', '瑠璃湾臨海工業'), ('teito', '帝都中央不動産'), ('wbutsu', '若宮物流'), ('wseiko', '若宮精工')) n(k, nm)
          join companies c on c.name = n.nm and c.status = 'active' and (c.ai or c.official));
  kz := (select min(id) from companies where name in ('風の芽製作所', '株式会社風の芽製作所') and status = 'active');
  if kz is null or (select count(*) from companies where name in ('風の芽製作所', '株式会社風の芽製作所') and status = 'active') <> 1 then
    raise exception '風の芽製作所（会社）が見つかりません';
  end if;
  co := co || jsonb_build_object('kz', kz);

  if exists (select 1 from (values ('teito')) v(k) where not co ? v.k) then raise exception '持ち主の会社がそろっていません（08 の更新を先に）'; end if;
  for r in select * from (values
    (154, 597, 161, 604, 'oilport', 'full', 1, 'teito', ''),
    (135, 599, 139, 603, 'whbldg', 'full', 3, 'teito', ''),
    (146, 602, 151, 607, 'warehouse', 'full', 3, 'teito', '')) v(x0, y0, x1, y1, k, sh, fl, ow, nm) loop
    begin
      perform pg_temp.dev_build(r.x0, r.y0, r.x1, r.y1, r.k, r.sh, r.fl, (co ->> r.ow)::int, r.nm);
      ok := ok + 1;
    exception when others then ng := ng + 1; e := sqlerrm;
    end;
  end loop;
  raise warning '町づくり 29/29：建てた % 棟・とばした % 棟（さいごのわけ：%）', ok, ng, coalesce(e, 'なし');
end $$;
