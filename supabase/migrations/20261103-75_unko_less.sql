-- AI の運行の乱れを、だいたい半分に減らす：
--   天気：乱れになる基準（気をつける）を少し上げる（とても危ないの基準・高温・ひょうはそのまま）。
--     強い風（最大瞬間）鉄道 22m/s・バス 27m/s・船 17m/s・飛行機 21m/s、強い雨（1時間）鉄道 40mm・バス 50mm・飛行機 70mm、
--     強い雪（1時間）鉄道 4cm・バスと飛行機 3cm、濃霧（見通し）飛行機 300m・船 350m・バス 80m
--   人と接触・急病・機材・事故など（駅ごと）：起きる見こみを半分に
--   運行情報（mp_unko_list）の wx を 3 に（地図の「運転規制の目安」を新しい基準で出す）

-- 天気の乱れの段階（DB の更新75：乱れになる基準を少し上げる）
create or replace function public._mp_unko_lvl(md text, k text, v float8) returns int
language sql immutable as $$
  select case
    -- 乱れになる基準（2）は、DB の更新75 で少し上げた（とても危ない 3 はそのまま）
    when k = 'wind' then case md when 'bus' then case when v >= 30 then 3 when v >= 27 then 2 else 0 end
                                 when 'ship' then case when v >= 20 then 3 when v >= 17 then 2 else 0 end
                                 when 'air' then case when v >= 25 then 3 when v >= 21 then 2 else 0 end
                                 else case when v >= 25 then 3 when v >= 22 then 2 else 0 end end
    when k = 'rain' then case md when 'bus' then case when v >= 70 then 3 when v >= 50 then 2 else 0 end
                                 when 'ship' then 0
                                 when 'air' then case when v >= 90 then 3 when v >= 70 then 2 else 0 end
                                 else case when v >= 50 then 3 when v >= 40 then 2 else 0 end end
    when k = 'snow' then case md when 'bus' then case when v >= 5 then 3 when v >= 3 then 2 else 0 end
                                 when 'ship' then 0
                                 when 'air' then case when v >= 5 then 3 when v >= 3 then 2 else 0 end
                                 else case when v >= 7 then 3 when v >= 4 then 2 else 0 end end
    when k = 'fog' then case md when 'air' then case when v < 150 then 3 when v < 300 then 2 else 0 end   -- 濃霧：見通し（m。DB の更新66）
                                when 'ship' then case when v < 200 then 3 when v < 350 then 2 else 0 end
                                when 'bus' then case when v < 80 then 2 else 0 end
                                else 0 end
    when k = 'heat' then case when md = 'rail' and v >= 36 then 2 else 0 end   -- 高温：レールがのびる（℃）
    when k = 'hail' then case when md = 'air' then 2 else 0 end                -- ひょう：機体の点検
    else 0 end
$$;

-- 運行の乱れ（5分ごと）：駅ごとの人と接触などを半分に（DB の更新75）
create or replace function public._mp_unko_tick() returns void
language plpgsql set search_path = public as $$
declare uz mp_unko; r record; s record; ms bigint := floor(extract(epoch from now()) * 1000)::bigint; bk int := ((extract(epoch from now())::bigint / 300) % 3)::int;
        hh int := extract(hour from now() at time zone 'Asia/Tokyo')::int; hw real; stp float8; last text;
        tp jsonb; tw float8; tpk jsonb; ou uuid; oc int; dd int; T jsonb; pr float8;
        TPL constant jsonb := '{
          "rail": [["person", "人と接触", 3, 40, 75, 3], ["sick", "急病のお客さまの救護", 1, 5, 10, 4],
                   ["car", "車両の点検（ドアの不具合）", 2, 10, 20, 3], ["car", "車両の点検（ブレーキから異音）", 3, 25, 45, 1.5],
                   ["signal", "信号の確認（信号が赤のまま）", 2, 15, 25, 2], ["signal", "信号の確認（停電で信号が消えた）", 3, 30, 60, 1],
                   ["track", "線路内の点検（線路に人が立ち入った）", 2, 10, 20, 2], ["track", "線路内の点検（倒木・落下物）", 3, 30, 50, 1],
                   ["track", "線路内の点検（動物と接触）", 2, 15, 30, 1.5], ["track", "線路内の点検（小石。異常なし）", 1, 3, 6, 2]],
          "air":  [["car", "機材の点検（エンジンの警告）", 2, 30, 90, 2], ["car", "機材の故障（交換の機体を手配）", 3, 60, 180, 1],
                   ["bird", "バードストライク（機体の点検）", 2, 30, 60, 1.5], ["rwy", "滑走路の点検", 2, 15, 40, 1.5],
                   ["atc", "管制の混雑（出発の順番待ち）", 1, 15, 45, 2], ["sick", "急病のお客さまの救護", 1, 10, 30, 1]],
          "ship": [["car", "エンジンの点検", 2, 20, 60, 2], ["car", "エンジンの故障", 3, 60, 180, 1],
                   ["wave", "うねりで揺れが大きい", 2, 30, 90, 1.5], ["sick", "急病のお客さまの救護", 1, 10, 20, 1.5]],
          "bus":  [["accident", "交通事故（車どうしの接触）", 2, 15, 40, 2], ["accident", "交通事故で通行止め", 3, 30, 90, 1],
                   ["car", "車両の点検", 2, 10, 30, 2], ["sick", "急病のお客さまの救護", 1, 5, 15, 2]]}'::jsonb;
begin
  if not exists (select 1 from mp_wx_k) then return; end if;
  -- 1) 10分えらばなかった：現場の判断（安全なほう）
  for uz in select * from mp_unko where st = 'ask' and ask_until <= now() order by id loop
    perform _mp_unko_apply(uz.id, case uz.lv when 1 then 2 when 2 then 3 else 5 end, true);
  end loop;
  -- 2) おわり（窓がおわった）。合わせて1時間より長く止めて、振替輸送をたのまなかった線は、信頼が下がる
  for uz in select * from mp_unko where st = 'run' and t_end <= now() and now() >= t0 + make_interval(secs => dur) order by id loop
    stp := (select coalesce(sum((e ->> 1)::float8 - (e ->> 0)::float8), 0) from jsonb_array_elements(uz.wins) e where (e ->> 2)::float8 = 0);
    if stp >= 3600 then update mp_routes set trust = greatest(0.7, trust - 0.05) where id = any(uz.routes) and not (id = any(uz.furi)); end if;
    last := case when (select (e ->> 2)::float8 from jsonb_array_elements(uz.wins) e order by (e ->> 1)::float8 desc limit 1) = 0
                   then case uz.mode when 'rail' then '運転を再開しました（遅れが出ています）' else '運航・運行を再開しました（遅れが出ています）' end
                 when jsonb_array_length(uz.wins) > 0 then 'ふだんの速さにもどりました（遅れが出ています）' else 'ふだんどおり運行しています' end;
    update mp_unko set st = 'done', log = log || jsonb_build_array(jsonb_build_array(extract(epoch from greatest(uz.t_end, uz.t0 + make_interval(secs => uz.dur))), last)) where id = uz.id;
  end loop;
  -- 3) 天気：系統ごと（15分に1回）。鉄道・バス・船・飛行機（風・雨・雪・濃霧・高温・ひょう。DB の更新66）
  for r in select ro.id from mp_routes ro
            where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and ro.id % 3 = bk and coalesce(array_length(ro.stops, 1), 0) >= 2
              and not _mp_unko_off(ro.own_u, ro.own_c)   -- AI の乱れをオフにした名義の系統はのぞく（DB の更新73）
              and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
              and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[ro.id] and z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail')) loop
    perform _mp_unko_wxr(r.id, ms);
  end loop;
  -- 4) 人と接触・急病・機材・事故など：駅・空港・港・バス停ごと（人の多さ・朝夕は多く、夜は少ない）
  hw := case when hh < 5 then 0.15 when hh = 5 then 0.6 when hh between 6 and 9 or hh between 16 and 19 then 1.6 else 1 end;
  for s in select st.id, st.x, st.y, st.own_u, st.own_c, w.rs, w.pop, w.k
             from (select u.sid, ro.kind k, array_agg(distinct ro.id order by ro.id) rs, max((ro.catch ->> u.sid::text)::real) pop
                     from mp_routes ro, unnest(ro.stops) u(sid)
                    where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
                      and not _mp_unko_off(ro.own_u, ro.own_c)   -- AI の乱れをオフにした名義の系統はのぞく（DB の更新73）
                    group by u.sid, ro.kind) w join mp_stations st on st.id = w.sid loop
    pr := case s.k when 'rail' then 0.0001 when 'air' then 0.00015 when 'ship' then 0.0001 else 0.000015 end;   -- バス停は数が多いので少なく（DB の更新75 で、ぜんぶ半分に）
    if random() >= pr / 12 * hw * greatest(0.3, least(3, coalesce(s.pop, 5000) / 20000.0)) then continue; end if;
    if exists (select 1 from mp_unko z where z.st <> 'done' and z.kind not in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') and (z.sta = s.id or z.routes && s.rs)) then continue; end if;
    T := TPL -> s.k;
    tw := random() * (select sum((e ->> 5)::float8) from jsonb_array_elements(T) e); tpk := null;
    for tp in select e from jsonb_array_elements(T) e loop
      tw := tw - (tp ->> 5)::float8; if tw <= 0 then tpk := tp; exit; end if;
    end loop;
    tpk := coalesce(tpk, T -> 0);
    dd := ((tpk ->> 3)::int + floor(random() * ((tpk ->> 4)::int - (tpk ->> 3)::int + 1))::int) * 60;
    -- えらぶ人：駅の持ち主（なければ、はじめの系統の持ち主）
    if s.own_u is not null or s.own_c is not null then ou := s.own_u; oc := s.own_c;
    else select ro.own_u, ro.own_c into ou, oc from mp_routes ro where ro.id = s.rs[1]; end if;
    if _mp_unko_off(ou, oc) then continue; end if;   -- 対応をえらぶ名義が AI の乱れをオフにしている駅（DB の更新73）
    perform _mp_unko_new(tpk ->> 0, tpk ->> 1, s.id, s.x, s.y, s.rs, (tpk ->> 2)::int, null, null, dd, ou, oc);
  end loop;
  -- 5) 1日1回（朝4時台）：信頼が1％もどる。30日より前の記録はけす
  if hh = 4 and not exists (select 1 from mp_state where k = 'unko_day' and v >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') then
    update mp_routes set trust = least(1, trust + 0.01) where trust < 1;
    delete from mp_unko where st = 'done' and t_end < now() - interval '30 days';
    insert into mp_state values ('unko_day', now()) on conflict (k) do update set v = excluded.v;
  end if;
end $$;

-- 運行情報（wx 3：新しい天気の基準。DB の更新75）
create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 3, 'aioff', case when gv then null else _mp_unko_off(pu, pc) end, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null or gv) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi),
                         'zi', q.zi, 'zt', _mp_unko_zt(r.id, q.zi)) order by r.id), '[]'::jsonb)   -- 乱れがきく区間（駅の何番目〜何番目。null は全線。DB の更新60）
                 from mp_routes r cross join lateral (select _mp_unko_zi(z, r.id) zi) q where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st, 'wide', z.wide,
    'log', (select coalesce(jsonb_agg(l order by (l ->> 0)::float8), '[]'::jsonb) from jsonb_array_elements(z.log) l where (l ->> 0)::float8 <= extract(epoch from now()) + 1),
    'by', _mp_pname(z.own_u, z.own_c, false),
    'me', (pu is not null or pc is not null) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'),
    -- 持ち主が決めた運休（1本：きのうから・編成ごと：おわって6時間まで）：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の]（DB の更新60）
    'cx', (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.train, c.day, c.form, extract(epoch from c.t0), extract(epoch from e.t1), c.unko,
                    (pu is not null or pc is not null or gv) and c.own_u is not distinct from pu and c.own_c is not distinct from pc) order by c.id), '[]'::jsonb)
             from mp_cxl c left join mp_unko z2 on z2.id = c.unko
             cross join lateral (select coalesce(c.t1, case when z2.st = 'done' then greatest(z2.t_end, z2.t0 + make_interval(secs => z2.dur)) end) t1) e
            where (c.day is not null and c.day >= today - 1) or (c.form is not null and coalesce(e.t1, 'infinity'::timestamptz) > now() - interval '6 hours')));
end $$;

-- 関数の権限（作りなおしても変わらないが、念のため）：運行情報はログインした人。_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_unko_lvl', '_mp_unko_tick', 'mp_unko_list') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
