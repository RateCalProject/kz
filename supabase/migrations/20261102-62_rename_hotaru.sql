-- 地名を変える：柳岬市 → 蛍石市（蛍石県の県庁所在地）：
--   市役所・合同庁舎・郵便局（国の建物で、名前が「柳岬」ではじまるもの）・柳岬JCT・柳岬IC も「蛍石」に。いま住民登録している人の住民票の住所も
--   錦岬湖 → 南ほたる湖 は、地図の画面のファイル（map/nature.json）のほう（DB には湖の名前はない）
--   もう変えてあるとき・国土 5×5 がまだのときは、なにもしない

do $$
declare c text := (select m.id from public.mp_places m join public.mp_places p on p.id = m.parent and p.k = 'pref' and p.name = '蛍石'
                    where m.k = 'muni' and m.name = '柳岬' and m.type = '市' limit 1);
begin
  if c is null then raise notice '柳岬市が見つかりません（もう変えてあるか、国土 5×5 がまだ）'; return; end if;
  update public.mp_places set name = '蛍石' where id = c;
  -- 国の建物（市の名前のついたもの）
  update public.mp_blds b set name = '蛍石' || substr(b.name, 3)
    from public.mp_parcels p where p.id = b.parcel and p.gov and b.name like '柳岬%';
  -- 高速道路の JCT・IC
  update public.mp_nodes set name = '蛍石' || substr(name, 3) where name in ('柳岬JCT', '柳岬IC');
  -- 住民票の住所（いま住民登録している人。前の住所・届け出の記録は そのまま）
  update public.mp_jm set addr = replace(addr, '柳岬市', '蛍石市') where muni = c and addr like '%柳岬市%';
end $$;
